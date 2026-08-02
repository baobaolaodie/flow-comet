---
name: flow-comet-subagent-execute
description: "Use only when explicitly invoked as /flow-comet-subagent-execute or routed by the flow-comet entry/runtime to the subagent-execute Node; complete Subagent Execute for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Subagent Execute

## Node Goal

Complete the `subagent-execute` Node for `flow-comet`.

Responsibility: 委托 [P] 并行任务给子代理，要求加载 flow-comet-dev 并回传 evidence。

## Guidance

---
name: flow-comet-subagent-execute
description: "Subagent Execute node for flow-comet: delegates parallel (parallel=true) tasks to subagents with flow-comet-dev loaded, collecting handoff evidence. Do not use for ordinary standalone tasks."
---

# Subagent Execute

## Node Goal

This node parallelizes execution by delegating independent tasks (marked `parallel="true"` in TASK.md) to separate subagents. Each subagent loads the full `flow-comet-dev` protocol and operates within its task's `read_files`/`write_files` boundaries. This node produces handoff evidence for each delegated task and marks them done in TASK.md after all subagents complete. It exists to exploit parallelism when tasks have no file conflicts.

## Guidance

### Prerequisites

- `.specs/<change-id>/TASK.md` must exist with at least one task marked `parallel="true"` and `status="pending"`.
- `.specs/<change-id>/DESIGN.md` or `DESIGN-lite.md` must exist.
- `.specs/LESSONS.md` must exist (or be created).
- The orchestrating agent must have the `Agent` tool available for spawning subagents.

### Steps

1. **Identify parallel tasks**: Read TASK.md and find all tasks with `parallel="true"` and `status="pending"`. Verify they are genuinely independent (no file conflicts between them — check `write_files` do not overlap).

2. **For each parallel task, create handoff request**: Use `workflow-handoff.mjs request <task-id>` to register the handoff. The handoff prompt must include:
   - The task's full XML block from TASK.md.
   - DESIGN.md sections 0 and 0.5 for context.
   - REQUIREMENT.md ACs relevant to this task.
   - Explicit instruction to load `flow-comet-dev` and follow its full protocol.
   - The task's `read_files` and `write_files` boundaries.
   - Instruction to produce `<task-id>-SUMMARY.md` in `.specs/<change-id>/`.

3. **Delegate to subagents**: Use the `Agent` tool with `isolation: "worktree"` for each parallel task. Each subagent:
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

### Completion reasoning

This node is truly done when:
- All delegated parallel tasks have `status="done"` in TASK.md.
- Every delegated task has a `<task-id>-SUMMARY.md` in `.specs/<change-id>/`.
- Handoff evidence (request + result) is recorded for each task.
- No subagent exceeded its `write_files` boundary.
- No serial tasks were delegated (only `parallel="true"` tasks).

### Red flags

- **Agent thought**: "This task looks independent, I'll delegate it." **Actual risk**: Delegating tasks that are not marked `parallel="true"` bypasses the wave division logic. Only tasks explicitly marked parallel should be delegated.
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
