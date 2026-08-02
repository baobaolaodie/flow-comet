---
name: flow-comet-plan
description: "Use only when explicitly invoked as /flow-comet-plan or routed by the flow-comet entry/runtime to the plan Node; complete Plan for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Plan

## Node Goal

Complete the `plan` Node for `flow-comet`.

Responsibility: 拆原子任务（XML 格式）+ 波次划分。生成 TASK.md。

## Guidance

---
name: flow-comet-plan
description: "Plan node for flow-comet: produces TASK.md with atomic tasks, wave division, and parallel markers. Do not use for ordinary standalone tasks."
---

# Plan

## Node Goal

This node decomposes the technical design into atomic, executable tasks with clear file boundaries, dependency declarations, and wave-based parallel execution plans. It produces TASK.md in XML format, which serves as the execution manifest for the dev and subagent-execute nodes. The quality of task decomposition directly determines implementation efficiency and boundary safety.

## Guidance

### Prerequisites

- `.specs/<change-id>/REQUIREMENT.md` must exist (from open node).
- `.specs/<change-id>/DESIGN.md` or `DESIGN-lite.md` must exist (from design node).
- For frontend/UI projects: `.specs/<change-id>/UI-DESIGN.md` must exist.
- The agent must read DESIGN.md section 0 (tech stack selected) — verify commands, dependency management, and directory structure must match the selected stack.
- The agent must NOT invent tech stack, touched modules, forbidden list, or write_files boundaries — all must come from DESIGN.md.

### Steps

1. **Artifact preflight gate**: Check all required upstream artifacts exist. If any missing, stop and output: `Rule R2.7 triggered: plan missing <artifact>. Return to <phase> first.` Do not proceed without all artifacts.

2. **Read DESIGN.md sections 0 and 0.5**: Understand the tech stack (for verify commands) and the architecture alignment (for file boundaries — touched modules, reuse targets, forbidden list).

3. **Decompose by file conflict (vertical slices)**: Split tasks by file conflict, NOT by horizontal layers. Each task should be a vertical slice (one feature through model/API/UI) not a horizontal layer (all models first, then all APIs). Target: 2-10 minutes per task in fresh context.

4. **Mark parallel tasks with [P]**: Tasks that have no file conflicts with each other get `parallel="true"`. They form the same execution wave.

5. **Declare depends_on**: Each task explicitly declares which tasks it depends on.

6. **Populate 7 required fields per task**:
   - `id`: Format T01, T02, T02-1 etc. Continuous numbering.
   - `name`: One sentence.
   - `read_files`: Files the task is allowed to read. Must include reuse targets from DESIGN 0.5. Supports glob patterns.
   - `write_files`: Files the task is allowed to create/modify/delete. Must NOT include forbidden modules from DESIGN 0.5. Strictly controlled.
   - `action`: What to do (intent, not code).
   - `verify`: One executable verification command (matching tech stack from DESIGN section 0).
   - `done`: One sentence completion criteria, corresponding to an AC sub-item.

7. **Wave division**: Group tasks by dependency graph:
   - Same layer = same wave (parallel execution).
   - Cross layer = sequential execution.
   - Output wave diagram: `Wave 1 (parallel): T01[P], T02[P]` etc.

8. **LESSONS scan**: Grep `.specs/LESSONS.md` for keywords related to planned file paths or actions. If active lessons hit, declare difference or confirm still applies.

The full task decomposition protocol, XML template, and constraints are in:
- `flow-kit/prompts/3-task.md` (TASK phase)

### Completion reasoning

This node is truly done when:
- `.specs/<change-id>/TASK.md` exists in XML format.
- Every task has all 7 required fields (id, name, read_files, write_files, action, verify, done).
- Every `verify` field is an executable command (not a description).
- Every `write_files` is strictly within DESIGN.md touched + new modules range (not in forbidden list).
- At least 1 task is marked `[P]` (parallel), unless all tasks are genuinely serial.
- Wave division diagram is clear and has no circular dependencies.
- Task numbering is continuous.

### Red flags

- **Agent thought**: "Split by layer first — models, then services, then endpoints." **Actual risk**: Horizontal layering creates artificial dependencies and blocks parallel execution. Always slice vertically by file conflict.
- **Agent thought**: "verify: tests should pass" is good enough. **Actual risk**: Vague verify commands cannot be executed. Must be specific: `pytest tests/test_x.py -v` not "tests should pass".
- **Agent thought**: "write_files can include any file the task might touch." **Actual risk**: Including DESIGN forbidden list modules in write_files bypasses R7.3 + R6.5 boundary enforcement. Strict control is mandatory.
- **Agent thought**: "All tasks are serial, no need for [P] marking." **Actual risk**: Failing to identify parallel opportunities wastes execution time. Most changes have at least some independent tasks.
- **Agent thought**: "read_files and write_files are the same thing." **Actual risk**: read_files includes reuse targets and reference modules; write_files is strictly the modification boundary. They serve different purposes (B3 old-project guardrail).

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry plan
```

## Skill Implementation

The plan node loads `flow-comet-task` to perform task decomposition. It reads DESIGN.md sections 0 and 0.5 for tech stack and architecture alignment, then produces TASK.md with XML-formatted atomic tasks, wave division, and parallel markers. Each task has strict read_files/write_files boundaries derived from DESIGN.md module analysis.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-task` | Required for task decomposition | Provides XML template, wave division protocol, and file boundary rules |

## Output Schemas

Schema: `flowkit.plan.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `task-plan` | file | yes | `.specs/<change-id>/TASK.md` |

Evidence: `plan-summary` (required)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record plan '{"summary":"TASK.md produced with N tasks in M waves, K parallel"}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `plan-artifacts` | TASK.md exists with XML tasks | artifact-exists |
| `task-fields-complete` | All tasks have 7 required fields | content-check |
| `write-files-safe` | No write_files in DESIGN forbidden list | content-check |
| `has-parallel` | At least 1 [P] task (if applicable) | content-check |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit plan --apply
```

If the script prints `SKILL: flow-comet-execute`, load that Skill next.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Read `.specs/<change-id>/TASK.md` — if exists with all tasks having 7 fields and wave diagram, plan phase is done.
3. If TASK.md exists but incomplete (missing fields, no wave diagram), resume from the first incomplete task.
4. Do not repeat completed decomposition. Resume from the first incomplete artifact.


## Entry Check

```bash
node flow-comet/scripts/workflow-guard.mjs entry plan
```

## Skill Implementation

Load `flow-comet-task` for this Node. Operation: `require`.

## Required Skill Calls

- Load `flow-comet-task` during this Node and record completed check `required-skill:plan.flow-comet-task`. Reason: 拆原子任务

## Augmentations

- This Node has no declared augmentations.

## Output Schemas

- `flowkit.plan.v1`: TASK.md Required evidence: `plan-summary`. Required artifacts: `task-plan` at `<change-id>/TASK.md`.

## Evidence Record

```bash
node flow-comet/scripts/workflow-state.mjs record plan '{"summary":"record the real Node result","completedChecks":[]}'
```

## Guardrails

- `plan-artifacts`: TASK.md exists (artifact-exists).

## Exit Check

```bash
node flow-comet/scripts/workflow-guard.mjs exit plan --apply
```

If the script prints `SKILL: flow-comet-execute`, load that Skill next.

## Recovery

Read `reference/workflow-protocol.json` and the configured workflow state. Resume the first Node that is not listed in `completedNodes`.
