# SUMMARY: T03 - 后端：/tournaments/venues 全量启用场地下拉接口 + 集成测试

- **Change ID**: test-schedule-venue-filter
- **Task ID**: T03
- **完成时间**: 2026-08-04 09:40
- **AI 角色**: Dev

---

## 做了什么（一段话）

在 `tournaments.py` router 上新增 `GET /venues` 子路由（完整路径 `/tournaments/venues`），函数签名带 `_: CurrentAdmin = Depends(get_current_admin)` 做管理员鉴权（DESIGN R4）；在 `crud_venue.py` 新增 `get_active_venues_all()`：`SELECT id, name FROM venues WHERE is_active = 1 ORDER BY name`，语义上复用 `get_active_venues_by_tournament` 的 `is_active` 过滤但去掉 tournament 限定。补充 AC-4 集成测试，断言启用场地返回、停用场地被过滤、按 name 排序。偏离点：初始设计复用 `crud_venue.py:48` 的既有函数，发现该函数签名带必填 `tournament_id`，直接传 None 会破坏既有调用语义，故新增独立函数而非改签名。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `app/api/v1/endpoints/tournaments.py` | 修改 | 新增 `GET /tournaments/venues` 路由（admin-only） |
| `app/crud/crud_venue.py` | 修改 | 新增 `get_active_venues_all()` |
| `tests/test_api_tournaments_venue_filter.py` | 修改 | 追加 `test_list_all_active_venues` |

## verify 输出（必填）

```text
$ cd pingpong-tournament && pytest tests/test_api_tournaments_venue_filter.py::test_list_all_active_venues -q

tests/test_api_tournaments_venue_filter.py::test_list_all_active_venues PASSED
1 passed, 0 failed in 0.94s
```

## 6 维自查（生产代码改动必填 · 来自 4-dev 步骤 4）

> 方法：brooks-review 输出原样贴入 + 内置 6 维快查交叉验证（本次模拟）。

```markdown
### 🟢 R1 · Cognitive Overload：通过
**Symptom**：新函数与既有函数职责单一，注释注明"全量 vs 按赛事"。
**Source**：《Clean Code》· 单一职责。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R2 · Change Propagation：通过
**Symptom**：新路由不影响既有 /tournaments 各端点（同一 router 追加，路径唯一）。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R3 · Knowledge Duplication：通过
**Symptom**：is_active 过滤语义在两处 CRUD 重复（by_tournament / all），但查询形态不同（一个带 FK，一个全量）。
**Source**：《DRY》· 有代价地复用。
**Consequence**：语义重复但实现独立。
**Remedy**：加注释互相引用；不做抽象（抽象收益低，两函数都很短）。

### 🟢 R4 · Accidental Complexity：通过
**Symptom**：未引入额外参数对象或查询构造器。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R5 · Dependency Disorder：通过
**Symptom**：无新 import 环。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R6 · Domain Model Distortion：通过
**Symptom**：端点返回只读聚合，不触碰领域写路径。
**Consequence**：无。
**Remedy**：无需改动。
```

### 已知接受 + 理由（🟡 Major 项不修的）

- 无 Major 项。

### 已知小问题（🟢 Minor 项可省的）

- `get_active_venues_all` 与 `get_active_venues_by_tournament` 命名相近，靠注释区分。

## 数据库迁移（涉及 schema 变更必填 · 来自 4-dev 步骤 1.7 / R4.5）

N/A。

## 越界检查（必填 · 来自 4-dev 步骤 5 / R6.5 / B3 老项目护栏）

```
✅ 越界检查（R6.5）：
  - TASK write_files：3 项
  - 实际 diff 涉及：3 项（tournaments.py / crud_venue.py / 测试）
  - 越界：0 / 已撤销 / 已扩范围
```

如有越界，列出处理方案：

- [ ] 已撤销的越界文件：无
- [ ] 已扩范围（须人工同意）：无
- [ ] 拆成新 task / 新 CHANGE：无

## 破坏性变更（涉及破坏性改动必填 · 来自 4-dev 步骤 1.8 / R4.6 / B4 老项目护栏）

N/A。

## 决策与偏离（如有）

- 偏离：DESIGN 假设可复用 `get_active_venues_by_tournament` 语义，实际因必填 `tournament_id` 参数无法直接复用，新增独立 `get_active_venues_all`（见"做了什么"）。不改变对外契约（仍是 AC-4 的 `/tournaments/venues`）。

## 是否触发新工作

- [ ] 触发新 fix-plan（已追加到 TASK.md）
- [ ] 触发 CONTEXT.md 更新（已更新）
- [ ] 发现需求/设计问题，已暂停并提交给人工

## 完成判定

- TASK.md 中对应任务已勾选：是
- 提交 hash：`sim-abc1235`
