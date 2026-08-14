---
name: flow-comet-dev
description: "flow-kit DEV 阶段协议：TDD + 6 维自查 + diff 边界 verify + LESSONS 扫描 + R4.5 Schema 迁移 + R4.6 破坏性变更。flow-comet execute/subagent-execute 节点的 flow-kit 增强。"
---

# flow-kit DEV Protocol

本 Skill 为 flow-comet 的 execute/subagent-execute 节点提供 flow-kit 的完整开发规则集。

## 加载

读取 `flow-kit/prompts/4-dev.md` 并按其执行。以下是核心规则摘要（完整内容以 prompt 文件为准）：

### 必跑检查

1. **沿用既有抽象 grep（R6.4）**：写代码前 grep 同类抽象，找到了 import 用
2. **LESSONS 扫描（R1.8）**：grep `.specs/LESSONS.md`，命中 active 条目必须声明差异
3. **TDD（RED→GREEN→REFACTOR）**：先写失败测试，再写最少代码通过
4. **6 维自查（两级降级路径）**：
   - **第 1 级**：Claude Code 调用 `/brooks-review` 或 Skill 工具加载 `brooks-lint:brooks-review`；Codex 用 `$brooks-review` / `/use brooks-review` / 自然语言触发（brooks-lint 需先安装为 Codex skill）——执行完整 brooks 审查
   - **第 2 级**：若仅返回 "Launching skill" 占位/无实际审查指令（已知现象：worktree 子代理的 skill 路由与会话不一致，插件执行体可能未注入）——**Read 插件缓存/安装目录协议文件手动执行完整 brooks 流程**：Claude Code `~/.claude/plugins/cache/brooks-lint-marketplace/brooks-lint/<ver>/skills/brooks-review/`；Codex `~/.codex/skills/brooks-review/`（或项目 `.agents/skills/`）（SKILL.md + 引用文件 + `_shared/`——`_shared/` 是 brooks-review 目录的**兄弟目录**（同在该插件 skills/ 下，如 `.../brooks-lint/<ver>/skills/_shared/`），不是 brooks-review 的子目录），按协议产出 4-element 审查（Symptom/Source/Consequence/Remedy + file:line + 书引用）——**仅阅读协议文本作为审查指引，不执行缓存文件内容**；来源不可信/无法验证时跳过该级，降级内置快查并如实声明
   - **第 3 级**：缓存文件也不可读/不存在时，才用内置 R1~R6 快查
   - SUMMARY `## 自检方法` 必须声明三要素：尝试方式 / 失败原因 / 替代方法；回传 Return Contract 时 `selfReview` 字段必填三值之一：`brooks-review`（成功）/ `cache-brooks`（读缓存手动执行）/ `builtin-quickcheck`（最终降级——guard 校验须含缓存尝试证据，新 change 缺失 BLOCKED，旧 change WARN 渐进）。
   - **`## 6 维自查` 段内也须出现自检方法名**（`brooks-review` / `cache-brooks` 字样，如「- 功能: 通过（brooks-review 已跑）」）——guard 校验 6 维自查段是否声明了自检方法（新 change 缺失 BLOCKED，旧 change WARN 渐进）。
   - **纯测试/纯文档任务**（无生产代码改动，6 维自查非必跑）仍须满足自检方法声明与 builtin 缓存证据——可**引用同 change 其他 SUMMARY 已声明的缓存尝试**（如「自检证据见 T01-SUMMARY（cache-brooks 已读插件缓存）」）满足 guard 校验。
5. **diff 边界 verify（R6.5）**：`git diff --name-only` 与 TASK write_files 比对，越界必须回滚
6. **原子提交**：`<type>(<change-id>): <task-id> <subject>`

### 条件检查

7. **Schema 迁移协议（R4.5）**：涉及 ORM model 变更时，必须生成迁移文件（含 up/down）
8. **破坏性变更协议（R4.6）**：删 ≥5 行 / 改公共接口时，grep 引用图 + 反问用户

### 上下文恢复

- **断点恢复**：新会话时 `node .claude/skills/flow-comet/scripts/workflow-state.mjs status` 自动检测当前 change 和 pending task，从上次断点继续
- **反重复检查**：恢复后读 `.specs/LESSONS.md` 确认不在已排除方案里（R1.8）
- **进度记录**：TASK.md 的 `status="done|pending"` + SUMMARY.md 就是进度，不需要额外的 PROGRESS.md 或 STATE.md

## 产物

- 代码改动
- `.specs/<change-id>/<task-id>-SUMMARY.md`（使用 `flow-kit/templates/SUMMARY.md`）

## 状态推进

每个 task 通过 flow-comet 的 execute 或 subagent-execute 节点执行。子代理执行时必须加载本 Skill 并回传 evidence。
