---
name: flow-comet-subagent-execute
description: "Use only when explicitly invoked as /flow-comet-subagent-execute or routed by the flow-comet entry/runtime to the subagent-execute Node; complete Subagent Execute for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

<!-- 手写区详细协议见 GUIDANCE.md（可选阅读） -->

# Subagent Execute

## Node Goal

Complete the `subagent-execute` Node for `flow-comet`.

Responsibility: 委托 [P] 并行任务给子代理，要求加载 flow-comet-dev 并回传 evidence。

职责分工：execute 节点负责**串行委托**（非 parallel 任务，一次一个），本节点负责**并行委托**（`parallel="true"` 任务，同 wave 多任务同时发）。两者共用同一委托证据库（handoff 记录在 subagent-execute evidence）。

## Guidance

### 必填段清单（exit guard 校验，结构+存在级）

| 文件 | 必填段 |
|------|--------|
| SUMMARY.md | `## 做了什么` / `## 改动文件` / `## verify 输出` / `## 6 维自查` / `## 越界检查` / `## 自检方法` |

**缺失任一必填段 = 节点未完成**，exit guard 校验（见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B）。

---
name: flow-comet-subagent-execute
description: "Subagent Execute node for flow-comet: delegates parallel (parallel=true) tasks to subagents with flow-comet-dev loaded, collecting handoff evidence. Do not use for ordinary standalone tasks."
---

# Subagent Execute

## Node Goal

This node parallelizes execution by delegating independent tasks (marked `parallel="true"` in TASK.md) to separate subagents. Each subagent loads the full `flow-comet-dev` protocol and operates within its task's `read_files`/`write_files` boundaries. This node produces handoff evidence for each delegated task and marks them done in TASK.md after all subagents complete. It exists to exploit parallelism when tasks have no file conflicts.

Division of labor: `execute` node handles serial delegation (non-parallel tasks, one at a time); this node handles parallel delegation (`parallel="true"` tasks, dispatching tasks of the same wave concurrently). Both share the same delegation evidence library (handoff recorded under subagent-execute evidence).

## Guidance

### 协调者禁令（最高优先级）

主会话是协调者，不是执行者。禁止在主会话直接修改源码或执行实现。源码只能通过 `Agent` 工具以 `isolation: "worktree"` 委托子代理完成。子代理派发失败时，主会话**不得接管实现**——记录当前任务为 BLOCKED 并走 Recovery。协调者只允许更新：TASK.md（标记 done）、`<task>-SUMMARY.md`、handoff evidence（workflow-handoff.mjs result）。

### Prerequisites

- `.specs/<change-id>/TASK.md` must exist with at least one task marked `parallel="true"` and `status="pending"`.
- `.specs/<change-id>/DESIGN.md` or `DESIGN-lite.md` must exist.
- `.specs/LESSONS.md` must exist (or be created).
- The orchestrating agent must have the `Agent` tool available for spawning subagents.

### Steps

1. **Identify parallel tasks**: Read TASK.md and find all tasks with `parallel="true"` and `status="pending"`. Verify they are genuinely independent (no file conflicts between them — check `write_files` do not overlap).

2. **For each parallel task, create handoff request**: Use `workflow-handoff.mjs request <task-id>` to register the handoff.
   > 若不传 `--write-files`，脚本会自动从 TASK.md 对应 task 的 `<write_files>` 块解析（orchestrator 无需手动从 TASK.md 提取文件列表）。
   The handoff prompt must include:
   - The task's full XML block from TASK.md.
   - DESIGN.md sections 0 and 0.5 for context.
   - REQUIREMENT.md ACs relevant to this task.
   - Explicit instruction to load `flow-comet-dev` and follow its full protocol.
   - The task's `read_files` and `write_files` boundaries.
   - Instruction to produce `<task-id>-SUMMARY.md` in `.specs/<change-id>/`.

3. **Delegate to subagents**（强制 worktree isolation）: 所有并行子代理**必须**使用 `Agent` 工具的 `isolation: "worktree"`，**禁止共享 cwd 直接委托**——hook 白名单依赖 worktree 隔离：子代理 cwd 无 `.comet/flow-comet-state.json`（.gitignore 排除）时 hook 放行源码写入，共享 cwd 的子代理会被 subagent-execute 白名单误拦。Each subagent:
   - Reads TASK.md for its specific task block.
   - Executes the full TDD protocol (RED/GREEN/REFACTOR).
   - Greps existing abstractions (R6.4).
   - Scans LESSONS (R1.8).
   - Runs verify command and records real output.
   - Performs self-review (brooks-lint or 6-dimension quick check).
   - Performs diff boundary check (R6.5).
   - Makes atomic commit with format `<type>(<change-id>): <task-id> <subject>`.
   - Writes `<task-id>-SUMMARY.md` to `.specs/<change-id>/`.
   - Returns evidence via `workflow-handoff.mjs result <task-id>`.

4. **Collect evidence**: After all subagents complete, verify each returned:
   - SUMMARY.md exists in `.specs/<change-id>/`.
   - Verify output is real (not fabricated).
   - Handoff evidence is recorded.

5. **Mark done**: Update TASK.md — set `status="done"` for all completed parallel tasks.

6. **Record overall evidence**: Run workflow-state.mjs to record completion.

7. **Exit check**: Run exit check.

## Return Contract（子代理必须回传）

每个被委托的子代理，完成时必须在最终回复中回传以下结构化信息（缺任一项，orchestrator 不得记录 handoff result）：

```json
{
  "status": "DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT",
  "taskId": "T0X",
  "commitHash": "<git commit sha>",
  "changedFiles": ["<file>", "..."],
  "redEvidence": { "command": "<RED 失败测试命令>", "output": "<真实失败输出片段>" },
  "greenEvidence": { "command": "<GREEN 通过测试命令>", "output": "<真实通过输出片段>" },
  "riskSignals": ["cross-module | security | concurrency | migration | public-api | 200+lines | none"],
  "concerns": "<可选：未解决的疑虑>"
}
```

- `status=DONE` 才视为完成；`BLOCKED` / `NEEDS_CONTEXT` 需 orchestrator 处理。
- `redEvidence` / `greenEvidence` 缺任一 → 视为未执行 TDD，orchestrator 拒绝记录。
- `riskSignals` 非 `none` 时，orchestrator 应将该任务标记为 review 节点的高优先级审查对象。
- 子代理回传后，orchestrator 用 `workflow-handoff.mjs result <task-id> '<JSON>'` 记录；guard exit subagent-execute 会校验 commitHash + greenEvidence（W1-D）。

### Completion reasoning

This node is truly done when:
- All delegated parallel tasks have `status="done"` in TASK.md.
- Every delegated task has a `<task-id>-SUMMARY.md` in `.specs/<change-id>/`.
- Handoff evidence (request + result) is recorded for each task.
- No subagent exceeded its `write_files` boundary.
- No serial tasks were delegated (only `parallel="true"` tasks).

### Red flags

- **Agent thought**: "This task looks independent, I'll delegate it." **Actual risk**: Delegating tasks that are not marked `parallel="true"` bypasses the wave division logic. execute 的串行委托走 execute 节点，本节点只并行委托 parallel 任务。
- **Agent thought**: "Subagent can figure out what to do from context." **Actual risk**: Subagent not loading `flow-comet-dev` means it skips TDD, LESSONS scan, diff boundary check, and self-review. The handoff prompt must explicitly require flow-comet-dev.
- **Agent thought**: "Subagent might need to touch related files for context." **Actual risk**: Subagent exceeding `write_files` boundaries creates merge conflicts with other parallel subagents. Strict boundary enforcement is mandatory.
- **Agent thought**: "One subagent finished, mark it done immediately." **Actual risk**: Marking tasks done before all subagents complete can cause issues if a later subagent fails and needs to reference completed work. Wait for all, then batch mark.

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry subagent-execute
```

## Skill Implementation

The subagent-execute node identifies all `parallel="true"` pending tasks in TASK.md, creates handoff requests via `workflow-handoff.mjs`, and delegates each to an isolated subagent (worktree isolation) with `flow-comet-dev` loaded. Each subagent executes the full dev protocol independently. The orchestrator collects evidence and marks tasks done after all subagents complete.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-dev` | Required in each subagent's prompt | Provides TDD, LESSONS scan, diff boundary, self-review protocol for each parallel task |
| `superpowers:subagent-driven-development` | Required for delegation pattern | Provides the Agent tool invocation pattern for parallel task execution |

## Output Schemas

Schema: `flowkit.handoff.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `task-summaries` | file | yes | `.specs/<change-id>/*-SUMMARY.md` (one per delegated task) |
| `handoff-evidence` | evidence | yes | Recorded via workflow-handoff.mjs |

Evidence: `handoff-request` (required per task), `handoff-result` (required per task)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record subagent-execute '{"summary":"N parallel tasks delegated and completed, handoff evidence recorded for each"}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `handoff-evidence` | Handoff evidence recorded for each task | evidence-only |
| `parallel-only` | Only parallel="true" tasks delegated | content-check |
| `boundary-safe` | No subagent exceeded write_files | content-check |
| `summaries-exist` | SUMMARY.md exists for each delegated task | artifact-exists |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit subagent-execute --apply
```

If the script prints `SKILL: flow-comet-review`, load that Skill next.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Read `.specs/<change-id>/TASK.md` — identify which parallel tasks are still `status="pending"`.
3. Check for existing `<task-id>-SUMMARY.md` files — tasks with summaries are done even if TASK.md not updated.
4. Re-delegate only the remaining pending parallel tasks.
5. If a subagent failed mid-execution, check for `<task-id>-PROGRESS.md` and use its "excluded solutions" to avoid repeating failures.


## Entry Check

```bash
node flow-comet/scripts/workflow-guard.mjs entry subagent-execute
```

## Skill Implementation

Load `flow-comet-subagent-execute` for this Node. Operation: `require`.

## Required Skill Calls

- When delegating this Node, the handoff prompt must require loading `flow-comet-dev` and returning evidence with completed check `required-skill:subagent-execute.flow-comet-dev`. Reason: 子代理加载 DEV 规则并回传 evidence

## Augmentations

- This Node has no declared augmentations.

## Output Schemas

- `flowkit.handoff.v1`: Subagent handoff Required evidence: `handoff-request`, `handoff-result`. Required artifacts: none.

## Evidence Record

```bash
node flow-comet/scripts/workflow-state.mjs record subagent-execute '{"summary":"record the real Node result","completedChecks":[]}'
```

## Guardrails

- `handoff-evidence`: Handoff evidence recorded (evidence-only).

## Exit Check

```bash
node flow-comet/scripts/workflow-guard.mjs exit subagent-execute --apply
```

If the script prints `SKILL: flow-comet-review`, load that Skill next.

## Recovery

Read `reference/workflow-protocol.json` and the configured workflow state. Resume the first Node that is not listed in `completedNodes`.
