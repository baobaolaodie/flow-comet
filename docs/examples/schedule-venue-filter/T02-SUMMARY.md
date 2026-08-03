# SUMMARY: T02 - 前端：API 层扩展（fetchAllVenues + venue_id 透传 + 类型）

- **Change ID**: test-schedule-venue-filter
- **Task ID**: T02
- **完成时间**: 2026-08-04 09:20
- **AI 角色**: Dev（subagent，parallel 委托）

---

## 做了什么（一段话）

在 `frontend/src/api/adminApi.ts` 新增 `fetchAllVenues()`（GET `/tournaments/venues`，返回 `{id,name}[]`），并扩展 `fetchAdminTournaments` 参数签名支持 `venue_id?: number` 透传；`frontend/src/api/tournaments.ts` 的 `TournamentQueryParams` 增加 `venue_id?: number | null`；`frontend/src/types/tournament.ts` 的 `Tournament` 追加 `venue_names?: string[]`。同时补了 API 层参数拼装的 vitest 单测（断言 `venue_id` 仅在非空时进 query 参数，空值不发送）。未改动任何页面组件（页面 UI 属 T04 范围，见 DESIGN 波次划分）。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `frontend/src/api/adminApi.ts` | 修改 | 新增 `fetchAllVenues`；`fetchAdminTournaments` 增 `venue_id` 透传（`adminApi.ts:113`） |
| `frontend/src/api/tournaments.ts` | 修改 | `TournamentQueryParams` 增 `venue_id`（`tournaments.ts:4`） |
| `frontend/src/types/tournament.ts` | 修改 | `Tournament` 增 `venue_names?: string[]` |
| `frontend/src/api/__tests__/adminApi.venue.test.ts` | 新增 | API 层单测 |

## verify 输出（必填）

```text
$ cd frontend && npx vitest run src/api/__tests__/adminApi.venue.test.ts

✓ src/api/__tests__/adminApi.venue.test.ts (3 tests) 9ms
  ✓ fetchAllVenues 请求 GET /tournaments/venues 并返回 data.data
  ✓ fetchAdminTournaments 携带 venue_id 时拼入 query
  ✓ fetchAdminTournaments venue_id 为空时不发送该参数

Test Files  1 passed (1)
Tests       3 passed (3)
```

## 6 维自查（生产代码改动必填 · 来自 4-dev 步骤 4）

> 方法：brooks-review 输出原样贴入 + 内置 6 维快查交叉验证（本次模拟）。

```markdown
### 🟢 R1 · Cognitive Overload：通过
**Symptom**：fetchAllVenues 与既有 fetchVenues 命名相近但语义不同（全量 vs 按赛事）。
**Source**：《Clean Code》· 命名消除歧义。
**Consequence**：调用方需区分。
**Remedy**：函数 JSDoc 注明"全量启用场地，用于列表筛选下拉"，与 `fetchVenues(eventId)` 的按赛事语义区分。

### 🟢 R2 · Change Propagation：通过
**Symptom**：类型与 API 层同 commit 更新，无跨文件顺序依赖。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R3 · Knowledge Duplication：通过
**Symptom**：venue 字段类型只定义一处（types/tournament.ts）。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R4 · Accidental Complexity：通过
**Symptom**：未引入新库/新抽象。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R5 · Dependency Disorder：通过
**Symptom**：adminApi.ts 复用既有 apiClient，无新增依赖。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R6 · Domain Model Distortion：通过
**Symptom**：venue_names 是展示数据，类型层与后端 schema 对齐。
**Consequence**：无。
**Remedy**：无需改动。
```

### 已知接受 + 理由（🟡 Major 项不修的）

- 无 Major 项。

### 已知小问题（🟢 Minor 项可省的）

- `fetchAllVenues` 与 `fetchVenues` 前缀相似，靠 JSDoc 区分；若后续场地功能增多可收敛到 `venues.ts` 域模块，记入 backlog。

## 数据库迁移（涉及 schema 变更必填 · 来自 4-dev 步骤 1.7 / R4.5）

N/A。

## 越界检查（必填 · 来自 4-dev 步骤 5 / R6.5 / B3 老项目护栏）

```
✅ 越界检查（R6.5）：
  - TASK write_files：3 项 + 1 测试
  - 实际 diff 涉及：4 项（adminApi.ts / tournaments.ts / types/tournament.ts / adminApi.venue.test.ts）
  - 越界：0 / 已撤销 / 已扩范围
```

如有越界，列出处理方案：

- [ ] 已撤销的越界文件：无
- [ ] 已扩范围（须人工同意）：无
- [ ] 拆成新 task / 新 CHANGE：无

## 破坏性变更（涉及破坏性改动必填 · 来自 4-dev 步骤 1.8 / R4.6 / B4 老项目护栏）

N/A。

## 决策与偏离（如有）

- 无偏离。T02 仅做 API 层与类型，UI 在 T04 完成，符合波次划分。

## 是否触发新工作

- [ ] 触发新 fix-plan（已追加到 TASK.md）
- [ ] 触发 CONTEXT.md 更新（已更新）
- [ ] 发现需求/设计问题，已暂停并提交给人工

## 完成判定

- TASK.md 中对应任务已勾选：是
- 提交 hash：`sim-abc1234`
