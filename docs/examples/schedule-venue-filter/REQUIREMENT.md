# REQUIREMENT: 赛事列表按场地筛选

- **Change ID**: test-schedule-venue-filter
- **关联**: `@.specs/test-schedule-venue-filter/CHANGE.md`、`@.specs/CONTEXT.md`

---

## 用户故事

- **US-1**：作为管理员，我想在赛事列表页按场地筛选赛事，以便在多赛事并行筹办时快速收敛"在某个场馆办的赛事"清单，不用逐条点进详情核对。
- **US-2**：作为管理员，我想在赛事列表的行上直接看到该赛事关联的场地名称，以便在赛程编排前确认场地归属，无需跳转赛程管理页。
- **US-3**：作为后端集成方（老客户端），我想 `GET /tournaments` 的响应结构保持不变，以便本次新增筛选不破坏现有分页 / 状态筛选调用。

## 验收准则（AC）

每条用 Given / When / Then，必须可验证。

### AC-1 · 按场地过滤赛事

- **Given** 系统内存在启用场地 `v1（id=1，"市体育馆"）` 归属赛事 `A`、启用场地 `v2（id=2，"工人文化宫"）` 归属赛事 `B`，且 `GET /tournaments` 无需认证依赖之外的额外权限
- **When** 管理员调用 `GET /tournaments?venue_id=1`
- **Then** 返回 `items` 中仅包含赛事 `A`，`total` 为 1，且每项 `venue_names` 包含 `"市体育馆"`
- **验证方式**: `cd pingpong-tournament && pytest tests/test_api_tournaments_venue_filter.py -q` 的 `test_list_tournaments_filter_by_venue_id`

### AC-2 · 场地名称展示在列表项中

- **Given** 赛事 `A` 关联启用场地 `v1（name="市体育馆"）`
- **When** 前端加载赛事列表
- **Then** 赛事 `A` 所在行展示场地名 `"市体育馆"`（表格"场地"列）；若赛事未关联任何场地，该列显示 `—`
- **验证方式**: 前端单测 `frontend/src/pages/admin/__tests__/AdminTournaments.test.tsx` 的 `render venue column`；UAT-1

### AC-3 · 筛选与既有筛选叠加不冲突

- **Given** 列表页同时存在状态筛选（status）与关键词搜索（keyword）
- **When** 管理员选择场地 `v1` 且状态为"进行中（5）"
- **Then** 列表仅返回"包含场地 v1 且 status=5"的赛事，三个筛选条件以 AND 语义叠加
- **验证方式**: 后端 API 集成测试 `test_list_tournaments_venue_and_status_and_keyword`；UAT-2

### AC-4 · 全量场地下拉数据接口

- **Given** 系统内有启用场地 `v1`、`v2` 与一个停用场地 `v3`
- **When** 管理员调用 `GET /tournaments/venues`
- **Then** 返回 `[{id:1,name:"市体育馆"},{id:2,name:"工人文化宫"}]`，不含 `v3`，按 `name` 排序
- **验证方式**: 后端 API 集成测试 `test_list_all_active_venues`；UAT-1

### AC-5 · 响应向后兼容

- **Given** 客户端 A 使用旧版参数（无 `venue_id`）
- **When** 调用 `GET /tournaments?status=5`
- **Then** 响应结构字段与 `TournamentListResponse` 完全一致（`total/items/skip/limit`），`venue_names` 为新增可选字段且为数组，旧字段不删除
- **验证方式**: `pytest tests/test_api_tournaments_venue_filter.py::test_tournament_list_backward_compatible`；契约核对 `node .claude/skills/flow-comet/scripts/contract-check.mjs venue_names --project .`

---

## 范围切分

### v1（本次必做）

- `GET /tournaments` 新增可选 `venue_id` 参数（`ge=1`），空值不生效
- `GET /tournaments/venues` 新增管理员接口：全量启用场地 `{id,name}`，按 `name` 排序
- `TournamentResponse` 新增 `venue_names: list[str]` 计算字段（批量预取防 N+1）
- 前端 `AdminTournaments.tsx` 场地筛选下拉 + 表格场地列
- 前端 `fetchAdminTournaments` 透传 `venue_id`

### v2（下一轮考虑，不本次）

- 场地筛选结果可导出 CSV（当前导出功能只覆盖名单，见 `AdminRegistrations` 导出）
- 场地与赛事多对多（一张场地服务多个赛事），需迁移 `venues.tournament_id` 为关联表
- 用户端赛事列表页也展示场地名（本次仅管理端）

### out（永远不做）

- 按场地做赛事"批量开赛/批量发布"操作（赛事生命周期操作按赛事独立执行）
- 场地实时占用 / 排班日历（属 `VenueAvailability` 排班域，独立 feature）

---

## 非功能性需求

- **性能**: 列表接口 P95 ≤ 500ms（含 venue EXISTS 子查询 + `venue_names` 批量预取，沿用 `set_tournament_list_counts` 的批量模式）；`venue_names` 每赛事最多 1 次查询，禁止 N+1
- **可访问性**: 无（Select 沿用 Ant Design 内置 a11y，不新增自定义控件）
- **安全**: `GET /tournaments/venues` 仅管理员可调（沿用 `Depends(get_current_admin)`，与 `AdminSchedules` 的场地接口一致）；`venue_id` 做 `ge=1` 校验防负值注入
- **兼容性**: Chrome/Firefox/Safari/Edge 最新 -1；`GET /tournaments` 响应新增字段不改旧字段，老 TS 类型以可选字段接入
- **可观测性**: `venue_id` 筛选命中数记入现有 API 日志（沿用 `app/core/logging.py` 的 `logger`），不新增埋点

## 依赖与假设

- 依赖既有 `app/crud/crud_venue.py` 的 `venue_crud.get_venues_by_tournament` 与 `Venue.is_active` 字段（grep 已确认存在：`app/models/venue.py:53`）
- 依赖既有批量计数助手 `set_tournament_list_counts`（`app/services/tournament_service.py`）
- 假设：管理端此前没有"全量启用场地聚合查询"，需要新增接口（DESIGN 阶段 grep 复核，若已有则复用删除本接口）
- 假设：测试环境沿用内存 SQLite（`sqlite+aiosqlite://`），`EXISTS` 子查询在 SQLite 与 MySQL 语义一致

---

> AC 是 TEST 阶段派生用例的唯一来源，禁止在 TEST 阶段引入新 AC。
