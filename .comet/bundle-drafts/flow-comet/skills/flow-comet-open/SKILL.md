---
name: flow-comet-open
description: "Use only when explicitly invoked as /flow-comet-open or routed by the flow-comet entry/runtime to the open Node; complete Open for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Open

## Node Goal

Complete the `open` Node for `flow-comet`.

Responsibility: CHANGE 反问 + REQUIREMENT 需求分析。生成 CHANGE.md 和 REQUIREMENT.md。

## Guidance

### 必填段清单（exit guard 校验，结构+存在级）

| 文件 | 必填段 |
|------|--------|
| CHANGE.md | `## 变更目标` / `## 变更范围` / `## 影响面` / `## 风险` |
| REQUIREMENT.md | `## 用户故事` / `## 验收标准` / `## 范围切分` |

**缺失任一必填段 = 节点未完成**，exit guard 校验（见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B）。

---
name: flow-comet-open
description: "Open node for flow-comet: produces CHANGE.md + REQUIREMENT.md via structured questioning and AC derivation. First node in the flow — no upstream artifacts needed. Do not use for ordinary standalone tasks."
---

# Open

## Node Goal

This node transforms a vague user intent into a concrete change proposal (CHANGE.md) and verifiable requirements (REQUIREMENT.md). It is the entry point of the flow-comet workflow, combining the CHANGE and REQUIREMENT phases into a single node. The output artifacts serve as the foundation for all downstream design, planning, and implementation work.

## Guidance

### Prerequisites

- No upstream artifacts required — this is the first node in the flow.
- If `.specs/<change-id>/` already exists for the proposed id, the agent must auto-increment (`<id>-2`, `<id>-3`) to avoid collision.
- If `.specs/ARCHITECTURE.md` exists, it should be read for context but is not a blocking prerequisite.

### Steps

1. **Auto-generate change-id**: Extract 2-4 kebab-case keywords from user description. Check `.specs/<id>/` does not exist. Declare the id to the user in the first message. User does not need to confirm unless they want to change it.

2. **Architecture change detection (0.4)**: Evaluate against 5 criteria (module structure impact, ADR conflict, public contract change, capacity boundary, cross-service orchestration). If hit: present 3 options (run A-architect first / continue with architecture impact statement / re-classify). If ARCHITECTURE.md missing + hit: warn user. If not hit (90% of cases): skip silently.

3. **Frontend project identification (0.5)**: Check if description contains frontend keywords (website/web/page/UI/app/dashboard etc.). If yes: mark as frontend project and proceed to 0.6. If not: skip to step 4.

4. **Visual tone preselection (0.6, frontend only)**: Present 9 style cards (from ui-ux-pro-max if installed, else from `flow-kit/reference/ui-aesthetics.md`). Give 1 preferred + 1 backup recommendation. Exclude 1-3 unsuitable styles with reasons. Wait for user selection before proceeding.

5. **Structured questioning (step 1)**: Ask "why / who / what problem / when is done" in max 3 questions per round. Never skip this — do not assume requirements. Do not mix with tone cards in the same message.

6. **Impact assessment (step 2)**: Determine if new/modified REQUIREMENT.md needed, if architecture touched, if existing ACs affected.

7. **Scope exclusion (step 3)**: Explicitly write what this change will NOT do. At least 1 item required.

8. **Generate CHANGE.md (step 4)**: Use `flow-kit/templates/CHANGE.md` template. Save to `.specs/<change-id>/CHANGE.md`. Must contain: Why / What / Impact / Scope exclusion / Acceptance line. No implementation details allowed.

9. **Path recommendation (step 5)**: Based on impact, recommend full / medium / shortest path with reasoning.

10. **REQUIREMENT phase**: After user confirms CHANGE.md:
    - Write ACs in Given/When/Then format — each must be verifiable by one command or one manual operation.
    - Scope split: v1 (must do) / v2 (next time) / out (never). At least 1 item in v2 and 1 in out.
    - Extract terminology to `.specs/CONTEXT.md` (glossary + locked decisions + defaults).
    - List non-functional requirements explicitly (write "none" if none).
    - Stop and ask if any AC cannot be verified in one sentence.

11. **LESSONS scan**: Grep `.specs/LESSONS.md` for keywords related to this change. If active lessons hit, declare "difference is X" or "still applies, will not retry".

The full questioning protocol, anti-patterns, and templates are in:
- `flow-kit/prompts/0-change.md` (CHANGE phase)
- `flow-kit/prompts/1-requirement.md` (REQUIREMENT phase)

### Completion reasoning

This node is truly done when:
- `.specs/<change-id>/CHANGE.md` exists and user has confirmed it.
- `.specs/<change-id>/REQUIREMENT.md` exists with all ACs in Given/When/Then format.
- `.specs/CONTEXT.md` has been updated with at least 1 new term or decision.
- v1/v2/out scope split is populated in REQUIREMENT.md.
- At least 1 "out of scope" item exists in CHANGE.md.
- User has confirmed both artifacts.

### Red flags

- **Agent thought**: "User said enough, I can infer the rest." **Actual risk**: Skipping structured questioning leads to wrong requirements. Always ask, never assume.
- **Agent thought**: "CHANGE.md should describe how to implement." **Actual risk**: CHANGE.md is a proposal, not a design doc. Implementation details belong in DESIGN.md. Violates R3 role boundary.
- **Agent thought**: "No need for out-of-scope items, the scope is obvious." **Actual risk**: Without explicit scope exclusion, downstream phases will expand scope unchecked. At least 1 "out of scope" item is mandatory.
- **Agent thought**: "Architecture change detection is optional." **Actual risk**: Skipping 0.4 means a service-split or DB-migration-level change enters the flow without ADR alignment, causing DESIGN.md section 0.5 to be self-contradictory.
- **Agent thought**: "AC '界面要好看' is good enough." **Actual risk**: Non-verifiable ACs cannot be tested. Must stop and ask for measurable criteria.

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry open
```

## Skill Implementation

The open node loads `flow-comet-change` for the CHANGE phase (structured questioning, change-id generation, architecture detection, visual tone preselection) and `flow-comet-requirement` for the REQUIREMENT phase (AC derivation, scope split, terminology extraction). It produces two artifacts in `.specs/<change-id>/` and updates the project-level `.specs/CONTEXT.md`.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-change` | Required before CHANGE.md generation | Provides structured questioning protocol, architecture detection, and tone preselection |
| `flow-comet-requirement` | Required before REQUIREMENT.md generation | Provides AC format (Given/When/Then), scope split, and terminology extraction rules |

## Output Schemas

Schema: `flowkit.intake.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `change-doc` | file | yes | `.specs/<change-id>/CHANGE.md` |
| `requirement-doc` | file | yes | `.specs/<change-id>/REQUIREMENT.md` |
| `context-update` | file | yes | `.specs/CONTEXT.md` (append/update) |

Evidence: `intake-summary` (required)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record open '{"summary":"CHANGE.md + REQUIREMENT.md generated, user confirmed"}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `intake-artifacts` | CHANGE.md + REQUIREMENT.md exist | artifact-exists |
| `context-updated` | CONTEXT.md has new terms/decisions | artifact-exists |
| `scope-exclusion` | At least 1 out-of-scope item in CHANGE.md | content-check |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit open --apply
```

If the script prints `SKILL: flow-comet-design`, load that Skill next.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Read `.specs/<change-id>/CHANGE.md` — if exists and confirmed, skip CHANGE phase.
3. Read `.specs/<change-id>/REQUIREMENT.md` — if exists and confirmed, skip REQUIREMENT phase.
4. Resume from the first incomplete artifact. Do not repeat confirmed phases.
5. If CHANGE.md exists but REQUIREMENT.md does not, continue from REQUIREMENT phase only.


## Entry Check

```bash
node flow-comet/scripts/workflow-guard.mjs entry open
```

## Skill Implementation

Load `flow-comet-open` for this Node. Operation: `require`.

## Required Skill Calls

- Load `flow-comet-change` during this Node and record completed check `required-skill:open.flow-comet-change`. Reason: CHANGE 反问协议
- Load `flow-comet-requirement` during this Node and record completed check `required-skill:open.flow-comet-requirement`. Reason: REQUIREMENT 需求分析

## Augmentations

- This Node has no declared augmentations.

## Output Schemas

- `flowkit.intake.v1`: CHANGE.md + REQUIREMENT.md Required evidence: `intake-summary`. Required artifacts: `change-doc` at `<change-id>/CHANGE.md`; `requirement-doc` at `<change-id>/REQUIREMENT.md`.

## Evidence Record

```bash
node flow-comet/scripts/workflow-state.mjs record open '{"summary":"record the real Node result","completedChecks":[]}'
```

## Guardrails

- `intake-artifacts`: CHANGE.md + REQUIREMENT.md exist (artifact-exists).

## Exit Check

```bash
node flow-comet/scripts/workflow-guard.mjs exit open --apply
```

If the script prints `SKILL: flow-comet-design`, load that Skill next.

## Recovery

Read `reference/workflow-protocol.json` and the configured workflow state. Resume the first Node that is not listed in `completedNodes`.
