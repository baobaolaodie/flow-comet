---
name: flow-comet-dev
description: "flow-kit DEV 阶段协议：TDD + 6 维自查 + diff 边界 verify + LESSONS 扫描 + R4.5 Schema 迁移 + R4.6 破坏性变更。Comet execute/subagent-execute 的 flow-kit 增强。"
---

# flow-kit DEV Protocol

本 Skill 为 Comet execute 阶段提供 flow-kit 的完整开发规则集。

## 加载

读取 `flow-kit/prompts/4-dev.md` 并按其执行。以下是核心规则摘要（完整内容以 prompt 文件为准）：

### 必跑检查

1. **沿用既有抽象 grep（R6.4）**：写代码前 grep 同类抽象，找到了 import 用
2. **LESSONS 扫描（R1.8）**：grep `.specs/LESSONS.md`，命中 active 条目必须声明差异
3. **TDD（RED→GREEN→REFACTOR）**：先写失败测试，再写最少代码通过
4. **6 维自查**：优先调用 `/brooks-review`（主会话已装 brooks-lint）；仅当插件确实不可用（如子代理环境未加载）才用内置 R1~R6 快查，并在 SUMMARY 记录"brooks-lint 不可用"。回传 Return Contract 时 `selfReview` 字段必填：`brooks-review` 或 `builtin-quickcheck`；builtin 时 SUMMARY 需声明 `## 自检方法` 并注明 brooks-lint 不可用原因。
5. **diff 边界 verify（R6.5）**：`git diff --name-only` 与 TASK write_files 比对，越界必须回滚
6. **原子提交**：`<type>(<change-id>): <task-id> <subject>`

### 条件检查

7. **Schema 迁移协议（R4.5）**：涉及 ORM model 变更时，必须生成迁移文件（含 up/down）
8. **破坏性变更协议（R4.6）**：删 ≥5 行 / 改公共接口时，grep 引用图 + 反问用户

### 上下文恢复

- **断点恢复**：新会话时 `workflow-state.mjs status` 自动检测当前 change 和 pending task，从上次断点继续
- **反重复检查**：恢复后读 `.specs/LESSONS.md` 确认不在已排除方案里（R1.8）
- **进度记录**：TASK.md 的 `status="done|pending"` + SUMMARY.md 就是进度，不需要额外的 PROGRESS.md 或 STATE.md

## 产物

- 代码改动
- `.specs/<change-id>/<task-id>-SUMMARY.md`（使用 `flow-kit/templates/SUMMARY.md`）

## Comet 集成

每个 task 通过 Comet execute 或 subagent-execute 执行。子代理执行时必须加载本 Skill 并回传 evidence。
