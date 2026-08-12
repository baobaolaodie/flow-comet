# DESIGN: 赛事列表按场地筛选

- **Change ID**: test-schedule-venue-filter
- **关联**: `@.specs/test-schedule-venue-filter/REQUIREMENT.md`、`@.specs/CONTEXT.md`、`@flow-kit/reference/tech-stacks.md`
- **作者**: AI（Architect 角色）+ 人工 review

---

## 0. 技术栈选定

> 由 2-design 步骤 0 锁定。变栈视为开新 CHANGE（R7.1）。

- **选定**: 沿用现有 monorepo 栈（FastAPI + React SPA），不引入新框架
- **前端**: React 19 / TypeScript 6 / Vite 8 / Ant Design 6（Select + Table，沿用现有组件）
- **后端**: FastAPI + SQLAlchemy 2.0（async）+ Pydantic v2
- **数据库**: MySQL 8.0（生产）/ 内存 SQLite（测试）
- **部署**: docker-compose（nginx + uvicorn 多实例）
- **关键依赖**: `sqlalchemy.select` 子查询（沿用 `crud_tournament.py:128` 的 `Event.event_type` 过滤写法）、Ant Design `Select`/`Table`
- **理由**: 变更仅是"列表接口加一个可选查询参数 + 一个只读聚合接口 + 前端一个下拉"，没有任何理由引入新栈
- **明确排除**: GraphQL（单字段过滤用不上）、服务端渲染框架（列表页已是 SPA）

---

## 0.5 既有架构对齐（brownfield 必填 · 来自 2-design 步骤 0.5 / B2 老项目护栏）

### 0.5.1 本次 change 触碰的既有模块

```
触碰模块（grep 出来的实际清单）：
- app/api/v1/endpoints/tournaments.py:35 list_tournaments（既有 · 新增 venue_id 参数）
- app/crud/crud_tournament.py:87 get_multi_with_filter（既有 · 新增 venue_id 过滤分支）
- app/schemas/tournament.py:109 TournamentResponse（既有 · 新增 venue_names 字段）
- app/services/tournament_service.py set_tournament_list_counts（既有 · venue_names 批量预取并入此处）
- frontend/src/api/adminApi.ts:113 fetchAdminTournaments（既有 · 透传 venue_id）
- frontend/src/api/tournaments.ts:13 fetchTournaments（既有 · TournamentQueryParams 加 venue_id）
- frontend/src/pages/admin/AdminTournaments.tsx（既有 · 加场地筛选 Select + 表格场地列）
- frontend/src/types/tournament.ts（既有 · Tournament 类型加 venue_names?）

新增能力（既有模块内新增函数，不新建文件）：
- app/crud/crud_venue.py（既有模块，见 0.5.2 表）新增 get_active_venues_all()（全量启用场地聚合；既有 get_active_venues_by_tournament 保留按赛事语义）
- app/api/v1/endpoints/tournaments.py 内新增 GET /tournaments/venues 子路由（挂同一 router，不新建文件）
- frontend/src/api/adminApi.ts 新增 fetchAllVenues()（既有文件内加函数，不新建文件）

测试与文档文件（tests/*.py、README/CHANGELOG 等）随各任务 write_files 新增，不在此列举——以 TASK.md 的 write_files 边界为准。

禁动清单（与本次无关，AI 不许"顺手"碰）：
- app/crud/crud_schedule.py:254 起的 venue_availability 排班 CRUD
- app/services/search_service.py（ES 全文搜索路径）
- frontend/src/pages/admin/AdminSchedules.tsx 的"场地管理" Tab
- app/crud/crud_tournament.py 的 total 计数实现（select().all() 后 len()，既有风格，不动）
```

### 0.5.2 既有抽象沿用对照表

| 本次需要 | 既有有没有？路径 | 决定 |
|---|---|---|
| 子查询过滤写法 | `crud_tournament.py:128` `Tournament.id.in_(select(Event.tournament_id)...)` | 沿用同款 `Venue.tournament_id` 子查询 |
| 列表批量预取助手 | `set_tournament_list_counts`（`app/services/tournament_service.py`） | 沿用，`venue_names` 预取并入其中 |
| 启用场地查询 | `crud_venue.py:48` `get_active_venues_by_tournament`（按赛事） | 复用其 `is_active` 过滤语义；全量聚合需新查询 |
| 场地下拉数据源（前端） | `adminApi.ts:641` `fetchVenues(eventId)`（按 event 粒度） | 不适用 → 新增 `fetchAllVenues()` |
| API 错误处理 | `app/core/exceptions.py` + `getErrMsg` | 沿用 |
| 前端筛选 Select | `AdminTournaments.tsx:68` `statusFilter` 用 `Select` | 沿用同款受控 Select 模式 |

### 0.5.3 沿用模式 vs 引入新模式

```
- 数据访问：**沿用** CRUD 类模式（crud_tournament.py 内加参数，不新建 repo）
- 过滤写法：**沿用** 子查询 `Tournament.id.in_(...)` 模式（与 event_type 过滤一致）
- 前端加载：**沿用** `loadList` + `useCallback` + `useEffect` 的既有数据流
- 场地下拉数据：**引入轻量新模式** `GET /tournaments/venues` 一次性拉全量 → 前端 state 缓存（理由：全量场地数量少（≤几十），无需按赛事轮询）
```

---

## 1. 决策清单

| # | 决策 | 备选 | 选择理由 | 取舍代价 |
|---|---|---|---|---|
| D1 | 场地过滤用 `Tournament.id.in_(SELECT venue.tournament_id WHERE venue.id=?)` 子查询 | JOIN + DISTINCT / EXISTS | 与既有 `event_type` 过滤写法（`crud_tournament.py:128`）一致，`count_query` 与 `query` 双语句共用同一 filter，保持 `total` 口径统一 | EXISTS 语义在 SQLite/MySQL 一致但索引路径略不同；子查询已由 `venues.tournament_id` 索引覆盖 |
| D2 | `venue_names` 走批量预取（一次 `SELECT venue WHERE tournament_id IN (...)`）挂进 `set_tournament_list_counts` | 每行 lazy load / 响应里内嵌 venue 列表 | 沿用既有批量助手，防 N+1（列表页 15 行/页，多 1 条批量查询可接受） | `set_tournament_list_counts` 调用点需要一并传 venue 名映射；detail 接口（`get_tournament_detail`）不在本次范围 |
| D3 | 场地下拉数据源新增 `GET /tournaments/venues`（admin-only，`is_active=True`） | 复用 `fetchVenues(eventId)` 按赛事拉 | 管理端需要跨赛事的全量启用场地聚合，现有接口是 event 粒度，语义不符 | 新增一个只读接口，需注册路由 + 权限检查（多 ~20 行） |
| D4 | 前端场地名展示用 `venue_names: string[]` 计算字段 | 后端拼 `"示例体育馆"` 字符串 | 字段保持数组，前端 `join("、")` 渲染，为将来多场馆留扩展 | 前端多一次 map 逻辑，成本可忽略 |

## 2. 数据流 / 架构图

```
管理员操作：
  AdminTournaments.tsx
      │  mount / 切场地
      ▼
  fetchAllVenues() ──GET /tournaments/venues──▶ [GET /tournaments/venues] 路由
      │  (Select 下拉 options: {id,name})                 │ SELECT id,name FROM venues
      ▼                                                   │   WHERE is_active=1
  fetchAdminTournaments({venue_id})                        │   ORDER BY name
      │  ──GET /tournaments?venue_id=N──▶ list_tournaments(venue_id)
      │                                                   │   ├─ 若有 keyword → ES 搜索（venue_id 并入 filters，见 §5 风险 R3）
      │                                                   ▼   └─ 回退 / 无关键词
      ▼                                                   crud.get_multi_with_filter(venue_id)
      │                                                 Tournament.id.in_(
      │                                                   SELECT tournament_id FROM venues
      │                                                   WHERE id = :venue_id )
      │                                                   └─ set_tournament_list_counts(items)
      │                                                         └─ + venue_names 批量预取
      ▼
  Table 渲染：场地列 = items[].venue_names.join("、") 或 "—"
```

## 3. 关键状态机（如有）

无状态机变更。`venue_id` 是纯查询参数，筛选条件以 AND 叠加（AC-3），不引入任何业务状态转移。

## 4. ADR 索引

- D1（过滤语义）可逆性低：`venues.tournament_id` 非空 FK 决定了"筛场地 = 筛该场地所属赛事"，此为既有 schema 的事实约束而非本次引入。若未来做多对多，AC-1 语义自动扩展（EXISTS/子查询对多场馆同样正确）。**暂不写独立 ADR**，语义记入 CONTEXT 术语表"场地筛选"与 AC-1。

## 5. 风险

| # | 风险 | 影响 | 概率 | 缓解 |
|---|---|---|---|---|
| R1 | `venue_names` 在 `set_tournament_list_counts` 里新增批量查询，若 `tournament_id` 未索引会慢 | 列表页 P95 上升 | 低 | `venues.tournament_id` 为 FK 自带索引（MySQL 8 InnoDB）；SQLite 测试同样建索引；测试断言批量查询次数（防回归成 N+1） |
| R2 | 产品预期"多赛事共享一个场馆"与现有 1 场 1 馆 schema 冲突 | 功能可用性低于预期 | 中 | AC-1 已把语义定为"赛事包含该场地"；REVIEW 时以 AC 为准，产品侧如需多对多开新 CHANGE（已列 v2/out） |
| R3 | `keyword` 走 ES 搜索路径时，venue_id 过滤需并入 ES filters，否则 ES 命中的赛事未按场地过滤 | 关键词 + 场地叠加时返回集错误 | 中 | DESIGN 明确：ES 分支的 `filters["venue_id"]=venue_id` 透传；ES 搜索不可用回退 MySQL LIKE 分支的 `get_multi_with_filter` 同样处理；测试覆盖 AC-3 的 keyword 组合 |
| R4 | 新增只读接口 `GET /tournaments/venues` 未挂管理员依赖 | 未授权用户可枚举全部场地 | 低 | 路由函数签名加 `_: CurrentAdmin = Depends(get_current_admin)`（与既有 admin 接口一致） |
| R5 | 长期债务：`venues.tournament_id` 1:1 绑定限制场地复用 | 多赛事共用场馆需迁移 | 中 | 已记 CONTEXT 技术债表；不做本次范围 |

## 6. 不在范围

- `venues` 表结构 / 迁移（多对多）
- 场地可用时间排班（`VenueAvailability`）
- 用户端赛事列表的场地展示
- 赛事详情接口 `get_tournament_detail` 的 `venue_names`（本次仅列表响应）
- 场地筛选结果的 CSV 导出

---

## 9. 架构沉淀建议（本 change 完成后供 `A-evolve` 同步用 · 软约束）

> 这是**给未来的礼物**，不是必填。

### 9.1 新增的可复用抽象（建议 append 到 CONTEXT 「既有抽象索引」段）

| 路径 | 能力 | 触发场景 | 复用建议 |
|---|---|---|---|
| `app/crud/crud_tournament.py:87` `get_multi_with_filter` 的 venue_id 分支 | 按子查询过滤列表 | 任何"按关联实体存在性过滤列表"的需求 | 沿用 `Tournament.id.in_(subq)` 模式写新过滤分支 |
| `app/services/tournament_service.py` `set_tournament_list_counts` 扩展 | 列表项附加聚合字段的批量预取 | 列表响应需要 `*_count` / `*_names` 类计算字段 | 所有列表页新计算字段并入此助手，禁止逐行查询 |

### 9.2 新增 / 改变的项目级技术决策（建议 append 到 CONTEXT「已锁技术决策」段 · 或将来升 ARCHITECTURE.md「ADR 列表」）

| 决策 | 取值 | 影响范围 | 推翻代价 |
|---|---|---|---|
| 列表过滤用子查询而非 JOIN | 沿用 event_type 写法 | 所有 crud 列表过滤 | 低，局部改写 |
| 列表计算字段集中批量预取 | `set_tournament_list_counts` | 列表响应 schema | 中，需同步 schema 与助手 |

### 9.3 新增 / 修改的跨模块契约（API / Schema / 事件总线）（建议 append 到 CONTEXT「跨模块契约」段）

```
- GET /tournaments?venue_id=<int,ge=1>（可选；存在时按"赛事包含该场地"过滤）
- GET /tournaments/venues（admin-only）→ { code, message, data: [{id,name}] }，is_active=True，按 name 排序
- TournamentResponse 新增可选字段 venue_names: string[]（默认 []）
```

### 9.4 新增 / 升级的依赖（建议 append 到 CONTEXT「技术栈」段）

| 包 | 版本 | 用途 | 是否替换既有 |
|---|---|---|---|
| 无 | — | 未引入新依赖 | 否 |

### 9.5 禁动清单变化（建议 patch CONTEXT「禁动清单」段）

```
- 新增禁动：crud_tournament.py get_multi_with_filter 的 total 计数实现（select().all() 后 len()，既有风格，后续性能 change 再动）
```

---

> 本文件不包含完整代码实现。函数签名、伪代码、接口定义可以；函数体不行。
