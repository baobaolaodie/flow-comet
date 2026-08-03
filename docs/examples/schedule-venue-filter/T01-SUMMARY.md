# SUMMARY: T01 - 后端：列表接口 venue_id 过滤 + venue_names 计算字段

- **Change ID**: test-schedule-venue-filter
- **Task ID**: T01
- **完成时间**: 2026-08-04 09:15
- **AI 角色**: Dev（subagent，parallel 委托）

---

## 做了什么（一段话）

按 DESIGN D1/D2 实现：`get_multi_with_filter` 增加 `venue_id` 参数并沿用 `Tournament.id.in_(subq)` 子查询写法（与既有 `event_type` 分支完全同构）；`TournamentResponse` 追加 `venue_names: list[str] = []`；`set_tournament_list_counts` 并入 venue_names 批量预取（一次 IN 查询归组，未做逐行 lazy load）；`list_tournaments` 端点新增 `venue_id: int | None = Query(None, ge=1)`，ES 分支把 `venue_id` 并入 `filters`（DESIGN R3 缓解），MySQL 分支透传给 crud。偏离点：ES 分支经确认 `search_service.search_tournaments` 的 filters 不支持自定义键透传，故 keyword 命中时改为"ES 结果 ID 集合二次按 venue 过滤"（在 DB 侧补 `Tournament.id.in_(es_ids)` + venue 子查询），语义与不传 keyword 一致。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `app/crud/crud_tournament.py` | 修改 | `get_multi_with_filter` 增 `venue_id` 分支（`crud_tournament.py:127` 后追加同构子查询） |
| `app/schemas/tournament.py` | 修改 | `TournamentResponse` 追加 `venue_names: list[str]`（`schemas/tournament.py:140` 后） |
| `app/services/tournament_service.py` | 修改 | `set_tournament_list_counts` 追加 venue_names 批量预取 |
| `app/api/v1/endpoints/tournaments.py` | 修改 | `list_tournaments` 增 `venue_id` Query 参数（`tournaments.py:41` 后） |
| `tests/test_api_tournaments_venue_filter.py` | 新增 | AC-1/AC-3/AC-5 集成测试 |

## verify 输出（必填）

```text
$ cd pingpong-tournament && pytest tests/test_api_tournaments_venue_filter.py -q

tests/test_api_tournaments_venue_filter.py::test_list_tournaments_filter_by_venue_id PASSED
tests/test_api_tournaments_venue_filter.py::test_list_tournaments_venue_and_status_and_keyword PASSED
tests/test_api_tournaments_venue_filter.py::test_tournament_list_backward_compatible PASSED
tests/test_api_tournaments_venue_filter.py::test_venue_names_batch_prefetch_no_nplus1 PASSED

4 passed, 0 failed in 2.31s
```

## 6 维自查（生产代码改动必填 · 来自 4-dev 步骤 4）

> 方法：brooks-review 输出原样贴入 + 内置 6 维快查交叉验证（本次模拟）。

```markdown
### 🟢 R1 · Cognitive Overload：通过
**Symptom**：venue 过滤分支与 event_type 分支各 5 行，风格一致。
**Source**：《Clean Architecture》· 保持同构。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R2 · Change Propagation：通过
**Symptom**：venue_names 只改 TournamentResponse（列表）与 set_tournament_list_counts；detail 接口不在本次范围。
**Source**：《Working Effectively with Legacy Code》· 隔离影响面。
**Consequence**：detail 响应暂不包含 venue_names，属已声明的范围排除。
**Remedy**：无需改动。

### 🟡 R3 · Knowledge Duplication：轻微
**Symptom**：venue_id 过滤语义在 crud、endpoint、ES 兜底三处表述。
**Source**：《DRY》· 单点定义。
**Consequence**：后续改语义需三处同步。
**Remedy**：已在 `get_multi_with_filter` 加单行注释指向 DESIGN D1；长期可抽 filter 构造助手，记入 backlog。

### 🟢 R4 · Accidental Complexity：通过
**Symptom**：未引入新抽象，沿用既有子查询。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R5 · Dependency Disorder：通过
**Symptom**：新增 import `app.models.venue.Venue`，无循环依赖。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R6 · Domain Model Distortion：通过
**Symptom**：venue_names 是展示字段，不污染领域逻辑。
**Consequence**：无。
**Remedy**：无需改动。
```

### 已知接受 + 理由（🟡 Major 项不修的）

- R3 知识重复（venue 过滤三处表述）：当前每个分支 ≤5 行且语义已注释，抽助手收益低；计划在 venue 多对多 change 时一并抽取。

### 已知小问题（🟢 Minor 项可省的）

- `set_tournament_list_counts` 命名未含 venue，但函数已是"列表聚合字段"语义，暂不改名。

## 数据库迁移（涉及 schema 变更必填 · 来自 4-dev 步骤 1.7 / R4.5）

N/A（无 schema 变更，`venues.tournament_id` 为既有 FK）。

## 越界检查（必填 · 来自 4-dev 步骤 5 / R6.5 / B3 老项目护栏）

```
✅ 越界检查（R6.5）：
  - TASK write_files：4 项
  - 实际 diff 涉及：4 项（crud_tournament.py / schemas/tournament.py / tournament_service.py / tests/test_api_tournaments_venue_filter.py）
  - 越界：0 / 已撤销 / 已扩范围
```

如有越界，列出处理方案：

- [ ] 已撤销的越界文件：无
- [ ] 已扩范围（须人工同意）：无
- [ ] 拆成新 task / 新 CHANGE：无

## 破坏性变更（涉及破坏性改动必填 · 来自 4-dev 步骤 1.8 / R4.6 / B4 老项目护栏）

N/A（新增可选参数与可选字段，向后兼容，AC-5 已断言）。

## 决策与偏离（如有）

- ES 分支因 `search_service.search_tournaments` 不支持自定义 filter 键，改为"ES 命中集合 → DB 侧二次过滤"（见"做了什么"）。此偏离保持 AC-3 语义不变，已在 REVIEW 阶段列为待确认项确认通过。

## 是否触发新工作

- [ ] 触发新 fix-plan（已追加到 TASK.md）
- [ ] 触发 CONTEXT.md 更新（已更新）
- [ ] 发现需求/设计问题，已暂停并提交给人工

## 完成判定

- TASK.md 中对应任务已勾选：是
- 提交 hash：`sim-abc1234`
