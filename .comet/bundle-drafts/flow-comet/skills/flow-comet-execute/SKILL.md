---
name: flow-comet-execute
description: "Use only when explicitly invoked as /flow-comet-execute or routed by the flow-comet entry/runtime to the execute Node; complete Execute for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Execute

## Node Goal

Complete the `execute` Node for `flow-comet`.

Responsibility: 按 TASK.md 逐任务执行：TDD + 6 维自查 + LESSONS 扫描 + diff 边界 verify。

This node executes all pending tasks from TASK.md one by one, applying the full dev protocol for each: TDD (RED/GREEN/REFACTOR), LESSONS scan, existing abstraction grep, self-review, diff boundary verification, and atomic commits. It produces a SUMMARY.md per task and marks each task as done in TASK.md. This is the core implementation node where code is actually written.

## Guidance

### 任务范围

execute 节点**只处理 `parallel="false"`（或未标注 parallel）的 pending 任务**。

- `parallel="true"` 的 pending 任务由 subagent-execute 节点负责委托
- execute 遍历 TASK.md 时，遇到 `parallel="true" status="pending"` 的任务块应**跳过**
- 若所有 pending 任务都是 parallel=true，execute 应视为无事可做，直接走 exit guard 让路由到 subagent-execute
- determineNode 路由逻辑会优先检测 parallel 任务并路由到 subagent-execute；若 determineNode 路由到了 execute，说明当前没有需要 execute 处理的任务（此时 execute 做空退出，让 guard 重新路由）

### Prerequisites

- `.specs/<change-id>/TASK.md` must exist with at least one `status="pending"` task.
- `.specs/<change-id>/DESIGN.md` or `DESIGN-lite.md` must exist — agent must read section 0 (tech stack) and section 0.5 (architecture alignment).
- `.specs/LESSONS.md` must exist (or be created from template if missing).
- For frontend/UI tasks: `.specs/<change-id>/UI-DESIGN.md` must exist.
- 若 `.specs/<change>/PROGRESS.md` 存在，必须先读取"已排除方案"段（R1.6 反重复），确认当前计划不在排除列表中。完成后删除 PROGRESS.md，有用信息迁移至 SUMMARY。

### Steps

For each pending task in TASK.md, execute the following sequence:

1. **Read task block**: Extract the `<task>` XML block. Read `action`, `read_files`, `write_files`, `verify`, `done`. If ambiguous, stop and ask — do not guess.

2. **Grep existing abstractions (R6.4)**: Before writing any code, grep the project for each capability mentioned in `action`. Check: HTTP clients, date formatting, state management, repository patterns, error handling, custom hooks. Use the actual grep commands from `4-dev.md` section 1.4.1. Record results in SUMMARY.md "6-dimension self-check" section.

3. **Scan LESSONS (R1.8)**: Grep `.specs/LESSONS.md` using keywords from task files and action. For each active hit: declare "Reviewed L-NNN, difference is X" or "Reviewed L-NNN, still applies, will not retry". If plan matches an active lesson exactly — stop and answer "difference from last time is X".

4. **UI task extra check (1.6)**: If task involves `.css`/`.tsx`/`.vue`/`.html` files or UI keywords: load UI-DESIGN.md, load `ui-anti-patterns.md`, load `frontend-engineer-rules.md` (sections 1, 2, 10 mandatory). Declare each hit from anti-patterns. Colors/fonts/spacing must come from CSS variables derived from UI-DESIGN.md frontmatter — no hardcoded values.

5. **Schema migration check (R4.5, section 1.7)**: If task involves table/field changes: declare schema diff, select migration mechanism (detect Prisma/Alembic/Rails/Knex/Flyway/Liquibase), generate reversible migration with up+down, detect DB credentials to decide whether to execute now or defer.

6. **Breaking change check (R4.6, section 1.8)**: If task deletes >= 5 lines, changes public exports, changes public API, or deletes files: grep reference graph, list impact, ask user for handling approach (direct delete + sync / deprecation period / codemod / abort).

7. **TDD (section 2)**: RED (write failing test from AC/done) -> confirm failure -> GREEN (minimal code to pass) -> confirm pass -> REFACTOR (improve under test protection). Exception: pure doc/config tasks can skip TDD with explanation in SUMMARY.

8. **Run verify (section 3)**: Execute the `<verify>` command. Paste real output into SUMMARY.md. Only proceed if verify passes.

9. **Self-review (section 4)**: MUST call `/brooks-review` if the skill tool is available. Only if the skill tool reports the plugin is unavailable may you fall back to the built-in R1-R6 quick check. The SUMMARY.md **must** include a `## 自检方法` field declaring which method was used: `brooks-review` or `builtin-quickcheck`. Critical must be fixed before commit.

10. **Diff boundary check (R6.5, section 5)**: Run `git diff --name-only HEAD` and `git status --short`. Compare against TASK.md `write_files`. Any out-of-boundary files must be reverted or explicitly approved. Record in SUMMARY.md "boundary check" section.

11. **Atomic commit (R4.1, section 5.5)**: Format: `<type>(<change-id>): <task-id> <subject>`. Code + test in same commit.

12. **Write SUMMARY.md (section 6)**: Use `flow-kit/templates/SUMMARY.md` template. Save to `.specs/<change-id>/<task-id>-SUMMARY.md`. Must include: what changed, which files, verify output, 6-dimension self-check, boundary check.

13. **Mark done (section 7)**: Update TASK.md task status to "done" with timestamp.

14. **Move to next pending task**: Repeat from step 1.

15. **All done**: Run exit check.

The full dev protocol, templates, and constraints are in:
- `flow-kit/prompts/4-dev.md` (DEV phase)

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
