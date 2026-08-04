---
name: flow-comet-execute
description: "Use only when explicitly invoked as /flow-comet-execute or routed by the flow-comet entry/runtime to the execute Node; complete Execute for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Execute

## Node Goal

Complete the `execute` Node for `flow-comet`.

Responsibility: 按 TASK.md 逐任务执行（**执行模式按 executionMode**：subagent 默认统一委托子代理、direct 逃生口主代理直写）。串行任务的 TDD + 6 维自查 + LESSONS 扫描 + diff 边界 verify 由执行者承担，无论哪种模式都必须加载 flow-comet-dev 协议。

This node is a coordinator. It does not write implementation code directly. It delegates all pending tasks to fresh-context subagents via the Agent tool (worktree isolation), each subagent applies the full dev protocol (TDD RED/GREEN/REFACTOR, LESSONS scan, existing abstraction grep, self-review, diff boundary verification, atomic commits) and returns a Return Contract. The coordinator records handoff evidence, verifies each SUMMARY, and marks tasks done in TASK.md.

## Guidance

### 必填段清单（exit guard 校验，结构+存在级）

| 文件 | 必填段 |
|------|--------|
| SUMMARY.md | `## 做了什么` / `## 改动文件` / `## verify 输出` / `## 6 维自查` / `## 越界检查` / `## 自检方法` |

**缺失任一必填段 = 节点未完成**，exit guard 校验（见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B）。

### 执行模型（按 executionMode，用户显式选择）

- **subagent（默认）**: 统一委托子代理——协调者流程（构造 handoff → Agent worktree 委托 → 收集 Return Contract → 验收标 done）
- **direct（逃生口，需用户显式切换）**: 主代理直接执行串行任务——但必须加载 flow-comet-dev 完整协议
  （TDD/6 维自查/越界检查/原子 commit），SUMMARY 必填段 + `## 自检方法` 强制（guard 校验兜底）
- 无论哪种模式：`parallel="true"` 任务始终由 subagent-execute 并行委托，不在此节点执行。

执行模式由 `node workflow-state.mjs status` 输出（`executionMode` / `directOverride`）决定，切换用 `node workflow-state.mjs execution-mode <subagent|direct>`。direct 是逃生口，必须用户显式调用才生效。

### 任务范围

execute 节点**只处理 `parallel="false"`（或未标注 parallel）的 pending 任务**。

本节点**不直接写实现代码**。所有 pending 任务统一通过 Agent 工具委托 fresh-context 子代理执行（加载 flow-comet-dev + 回传 Return Contract）。

- `parallel="true"` 的 pending 任务由 subagent-execute 节点负责并行委托
- execute 遍历 TASK.md 时，遇到 `parallel="true" status="pending"` 的任务块应**跳过**
- 若所有 pending 任务都是 parallel=true，execute 应视为无事可做，直接走 exit guard 让路由到 subagent-execute
- determineNode 路由逻辑会优先检测 parallel 任务并路由到 subagent-execute；若 determineNode 路由到了 execute，说明当前没有需要 execute 处理的任务（此时 execute 做空退出，让 guard 重新路由）

### Prerequisites

- `.specs/<change-id>/TASK.md` must exist with at least one `status="pending"` task.
- `.specs/<change-id>/DESIGN.md` or `DESIGN-lite.md` must exist — agent must read section 0 (tech stack) and section 0.5 (architecture alignment).
- `.specs/LESSONS.md` must exist (or be created from template if missing).
- For frontend/UI tasks: `.specs/<change-id>/UI-DESIGN.md` must exist.
- 若 `.specs/<change>/PROGRESS.md` 存在，必须先读取"已排除方案"段（R1.6 反重复），确认当前计划不在排除列表中。完成后删除 PROGRESS.md，有用信息迁移至 SUMMARY。

### Steps（subagent 模式 · 协调者流程，统一委托子代理）

对 TASK.md 每个 pending 串行任务，协调者执行：

1. **读 task 块，构造 handoff request**：读 `<task>` XML 块（`action` / `read_files` / `write_files` / `verify` / `done`）。若内容有歧义，停下询问——不要猜。构造 handoff request 内容：task 全文 + DESIGN §0/§0.5 + AC + read/write_files 边界。运行 `workflow-handoff.mjs request <task-id>` 记录。
2. **委托子代理**：用 Agent 工具（`isolation: "worktree"`）委托 fresh-context 子代理。handoff prompt 强制协议：加载 flow-comet-dev、执行 TDD（RED/GREEN/REFACTOR）、LESSONS 扫描、既有抽象 grep、verify、6 维自查、越界检查、原子 commit（`<type>(<change-id>): <task-id> <subject>`），写 `.specs/<change-id>/<task-id>-SUMMARY.md`，回传 Return Contract（含 commitHash + greenEvidence + selfReview）。
3. **记录 handoff result**：子代理回传后，运行 `workflow-handoff.mjs result <task-id> '<JSON>'` 记录（Return Contract 含 commitHash + greenEvidence + selfReview）。
4. **验收 SUMMARY，TASK.md 标 done**：确认 SUMMARY 含 `## 自检方法` 段（声明 brooks-review 或 builtin-quickcheck）、verify 输出真实、6 维自查与越界检查有实质内容；通过后在 TASK.md 将任务标 `status="done"` 并加时间戳。
5. **下一个 pending 任务**：重复步骤 1-4。

> 原 Steps 的 TDD / LESSONS / verify / 6 维自查 / 越界检查 / commit 协议**移入 handoff prompt 作为子代理的强制协议**，协调者不亲自执行。

> **Return Contract 非代码任务**：纯文档 / 纯配置任务子代理回传时，`greenEvidence` 允许 `{"command":"N/A (non-code task)","output":"..."}`（command 字段存在即可通过 W1-D 校验）。

The full dev protocol, templates, and constraints are in:
- `flow-kit/prompts/4-dev.md` (DEV phase) — 作为 handoff prompt 的子代理强制协议引用

### Completion reasoning

This node is truly done when:
- All tasks in TASK.md have `status="done"`.
- Every done task has a corresponding `<task-id>-SUMMARY.md` in `.specs/<change-id>/`.
- Every SUMMARY.md contains: verify output (real, not fabricated), 6-dimension self-check, boundary check.
- No REQUIREMENT.md or DESIGN.md has been modified during execution.
- No out-of-boundary files have been changed without explicit approval.

### Red flags

- **Agent thought**: "I'll write the code first, then grep for existing abstractions." **Actual risk**: Writing code without grepping first (R6.4 violation) leads to duplicate implementations. Must grep BEFORE writing.
- **Agent thought**: "LESSONS scan is optional for simple tasks." **Actual risk**: Skipping LESSONS scan (R1.8 violation) means repeating known failures. Even simple tasks can hit documented pitfalls.
- **Agent thought**: "verify passed in my head, marking done." **Actual risk**: Marking done without running verify (R2.4 violation) means untested code enters review. Must paste real output.
- **Agent thought**: "I see a bug in an adjacent file, let me fix it along the way." **Actual risk**: "Fixing along the way" without a new task or CHANGE violates R7.1 (scope control). Must stop and create a new task or CHANGE.
- **Agent thought**: "This task is taking long, let me skip the self-review." **Actual risk**: Skipping self-review defers quality issues to the review node, where they become Critical items requiring fix tasks. Better to catch early.
- **Agent thought**: "这个 parallel 任务小，我顺手在主会话做了。" **Actual risk**: 违反并行委托设计——subagent-execute 节点被静默跳过，丢失并行隔离与 write_files 冲突防护；且 execute 出口的 all-tasks-done 校验会 BLOCKED（parallel 无 handoffResult）。parallel="true" 任务只能由 subagent-execute 委托。

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry execute
```

## Skill Implementation

Load `flow-comet-execute` for this Node. Operation: `require`.

The execute node loads `flow-comet-dev` for each task execution. It iterates through all pending tasks in TASK.md, applying the full dev protocol: TDD, LESSONS scan, existing abstraction grep, self-review (brooks-lint or 6-dimension quick check), diff boundary verification, and atomic commits. Each task produces a SUMMARY.md and is marked done in TASK.md.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-dev` | Required for each task execution | Provides TDD protocol, LESSONS scan, 6-dimension self-check, diff boundary rules, schema migration, breaking change protocol |

Load `flow-comet-dev` during this Node and record completed check `required-skill:execute.flow-comet-dev`. Reason: TDD + 6 维自查 + R4.5 + R4.6

## Augmentations

This Node has no declared augmentations.

## Output Schemas

Schema: `flowkit.execution.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `task-summaries` | file | yes | `.specs/<change-id>/*-SUMMARY.md` (one per task) |
| `task-plan-updated` | file | yes | `.specs/<change-id>/TASK.md` (status="done" for all) |

Evidence: `implementation-summary` (required)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record execute '{"summary":"All N tasks completed, each with SUMMARY.md and verify output"}'
```

Generic template:
```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record execute '{"summary":"record the real Node result","completedChecks":[]}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `build-evidence` | At least one SUMMARY.md produced | artifact-exists |
| `all-tasks-done` | All tasks in TASK.md have status="done" | content-check |
| `verify-output-real` | Every SUMMARY.md has verify output (not fabricated) | content-check |
| `no-design-changes` | REQUIREMENT.md and DESIGN.md not modified | file-unchanged |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit execute --apply
```

After exit, run `node .claude/skills/flow-comet/scripts/workflow-state.mjs next` to get the next node.

If the script prints `SKILL: flow-comet-subagent-execute`, load that Skill next.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Read `.specs/<change-id>/TASK.md` — find first `status="pending"` task.
3. Read any existing `<task-id>-SUMMARY.md` files to confirm completed progress.
4. Check for `<task-id>-PROGRESS.md` files — if found, read "excluded solutions" section to avoid repeating failures (R1.6).
5. Resume from the first pending task. Do not repeat completed tasks.
6. If a PROGRESS.md exists for the current task, delete it after completion and migrate useful info to SUMMARY.md.

Generic fallback: read `.claude/skills/flow-comet/reference/workflow-protocol.json` and the configured workflow state; resume the first Node not listed in `completedNodes`.
