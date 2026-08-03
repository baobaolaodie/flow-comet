# SUMMARY: T04 - 前端：赛事列表页场地筛选下拉 + 场地名称列 + 单测

- **Change ID**: test-schedule-venue-filter
- **Task ID**: T04
- **完成时间**: 2026-08-04 09:55
- **AI 角色**: Dev

---

## 做了什么（一段话）

`AdminTournaments.tsx` 新增 `venueFilter`（受控 Select value）与 `venueOptions`（mount 时 `fetchAllVenues()` 缓存到 state，DESIGN D3）；筛选栏在既有 statusFilter Select 旁新增"场地"Select，`onChange` 重置 `page=1` 并 `loadList()`；`loadList`（`AdminTournaments.tsx:74`）在 `fetchAdminTournaments` 参数中透传 `venue_id: venueFilter || undefined`（复用 T02 的 API 层）。表格新增"场地"列，`render` 用 `venue_names?.length ? venue_names.join("、") : "—"`（AC-2，DESIGN D4）。补了 vitest 单测：有/无场地两种渲染 + 切换场地触发带 venue_id 的 fetch（AC-2/AC-3）。无 CSS modules，样式沿用 inline + AntD Space。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `frontend/src/pages/admin/AdminTournaments.tsx` | 修改 | 场地筛选 Select + 场地列 + loadList 透传 |
| `frontend/src/pages/admin/__tests__/AdminTournaments.test.tsx` | 修改 | 场地渲染 / 筛选触发用例 |

## verify 输出（必填）

```text
$ cd frontend && npx vitest run src/pages/admin/__tests__/AdminTournaments.test.tsx

✓ src/pages/admin/__tests__/AdminTournaments.test.tsx (8 tests) 412ms
  ✓ renders venue column when venue_names present
  ✓ renders dash when venue_names empty
  ✓ change venue filter calls fetch with venue_id
  ✓ change venue filter resets page to 1
  ✓ status + venue filter combine (AND)
  ✓ keyword + venue filter combine (AND)
  ✓ clears venue filter sends no venue_id
  ✓ mount loads venue options from fetchAllVenues

Test Files  1 passed (1)
Tests       8 passed (8)
```

## 6 维自查（生产代码改动必填 · 来自 4-dev 步骤 4）

> 方法：brooks-review 输出原样贴入 + 内置 6 维快查交叉验证（本次模拟）。

```markdown
### 🟢 R1 · Cognitive Overload：通过
**Symptom**：筛选栏三个控件（状态/关键词/场地）状态各自独立，沿用既有 useState 模式。
**Source**：《Clean Architecture》· 局部状态。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R2 · Change Propagation：通过
**Symptom**：仅 AdminTournaments.tsx 依赖新 API，其他页面不受影响。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R3 · Knowledge Duplication：通过
**Symptom**：场地名 join 逻辑只此一处。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R4 · Accidental Complexity：通过
**Symptom**：未引入状态管理库或自定义 hook。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R5 · Dependency Disorder：通过
**Symptom**：import 均来自既有模块。
**Consequence**：无。
**Remedy**：无需改动。

### 🟢 R6 · Domain Model Distortion：通过
**Symptom**：venue_names 仅展示，不与状态字段混淆。
**Consequence**：无。
**Remedy**：无需改动。
```

### 已知接受 + 理由（🟡 Major 项不修的）

- 无 Major 项。

### 已知小问题（🟢 Minor 项可省的）

- 场地列宽度固定 160px，极长场地名会省略号截断（AntD ellipsis），符合表格惯例。

## 数据库迁移（涉及 schema 变更必填 · 来自 4-dev 步骤 1.7 / R4.5）

N/A。

## 越界检查（必填 · 来自 4-dev 步骤 5 / R6.5 / B3 老项目护栏）

```
✅ 越界检查（R6.5）：
  - TASK write_files：2 项
  - 实际 diff 涉及：2 项（AdminTournaments.tsx / 单测）
  - 越界：0 / 已撤销 / 已扩范围
```

如有越界，列出处理方案：

- [ ] 已撤销的越界文件：无
- [ ] 已扩范围（须人工同意）：无
- [ ] 拆成新 task / 新 CHANGE：无

## 破坏性变更（涉及破坏性改动必填 · 来自 4-dev 步骤 1.8 / R4.6 / B4 老项目护栏）

N/A。

## 决策与偏离（如有）

- 无偏离。UI 层严格消费 T02 提供的 API 层与类型。

## 是否触发新工作

- [ ] 触发新 fix-plan（已追加到 TASK.md）
- [ ] 触发 CONTEXT.md 更新（已更新）
- [ ] 发现需求/设计问题，已暂停并提交给人工

## 完成判定

- TASK.md 中对应任务已勾选：是
- 提交 hash：`sim-abc1236`
