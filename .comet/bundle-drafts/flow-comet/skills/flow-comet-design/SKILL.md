---
name: flow-comet-design
description: "Use only when explicitly invoked as /flow-comet-design or routed by the flow-comet entry/runtime to the design Node; complete Design for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

<!-- 手写区详细协议见 GUIDANCE.md（可选阅读） -->

# Design

## Node Goal

Complete the `design` Node for `flow-comet`.

Responsibility: 技术栈选型 + ADR + 数据流。生成 DESIGN.md。

## Guidance

### 必填段清单（exit guard 校验，结构+存在级）

| 文件 | 必填段 |
|------|--------|
| DESIGN.md | `## 0. 技术栈选定` / `## 0.5 架构对齐` / `## 决策清单` / `## 风险` |

**缺失任一必填段 = 节点未完成**，exit guard 校验（见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B）。

---
name: flow-comet-design
description: "Design node for flow-comet: produces DESIGN.md (and UI-DESIGN.md for frontend) via tech stack selection, ADR, and architecture alignment. Do not use for ordinary standalone tasks."
---

# Design

## Node Goal

This node transforms requirements into an actionable technical design. It produces DESIGN.md with tech stack decisions, architecture alignment with existing modules, ADRs for reversible decisions, data flow diagrams, and risk assessment. For frontend projects, it additionally produces UI-DESIGN.md with design tokens and visual specifications. The output artifacts serve as the blueprint for task decomposition and implementation.

## Guidance

### Prerequisites

- `.specs/<change-id>/CHANGE.md` must exist (produced by open node).
- `.specs/<change-id>/REQUIREMENT.md` must exist (produced by open node).
- If `.specs/ARCHITECTURE.md` exists, it should be read (sections 2, 3, 4) for module boundaries, ADR conflicts, and cross-module contracts.
- `flow-kit/reference/tech-stacks.md` must be accessible for tech stack card selection.

### Steps

1. **Architecture change pre-check (0-)**: If CHANGE.md already has "Architecture Impact Statement" or "Post A-architect" marker, skip. Otherwise re-evaluate against the 5 criteria from `0-change.md` step 0.4.1. If hit + ARCHITECTURE.md exists: check ADR conflict. If hit + no ARCHITECTURE.md: present 3 options to user. If not hit: proceed.

2. **Tech stack preselection (section 0)**: Load `flow-kit/reference/tech-stacks.md`. Filter to 5-6 cards matching project type. Present with 1 preferred + 1 backup (reasoning from REQUIREMENT ACs + non-functional requirements). Exclude 1-2 with reasons. Wait for user selection. Exception: if CONTEXT.md has locked tech decisions, use those directly.

3. **Existing architecture alignment (section 0.5, brownfield only)**: This is the most critical step for existing projects:
   - **0.5.1 Touched modules**: Grep (not guess) actual modules that will be touched. List: existing modules to modify, existing modules to reuse, new modules to create, forbidden modules (DO NOT TOUCH).
   - **0.5.2 Align existing abstractions**: For each capability needed, check if existing code already provides it. Table format: "Need X | Existing Y exists | Decision: reuse" or "Need X | None exists | Decision: create (reason: first time)".
   - **0.5.3 Reuse vs new patterns**: For each key decision, declare "reuse" (with reference) or "introduce new" (with justification). New patterns require explicit reason.
   - **0.5.4 Write to DESIGN.md section 0.5**: All of the above goes into DESIGN.md.

4. **Technical decisions (section 1)**: Each decision must have: decision + alternatives + selection reason + trade-off cost. "Use best practice" is forbidden — must be specific.

5. **Data flow / architecture diagram (section 2)**: ASCII or Mermaid diagram showing data/event flow, key state machines, boundaries.

6. **ADR (section 3)**: For any decision that could be reversed later, write ADR to `.specs/adr/<NNN>-<title>.md` with Context / Decision / Consequences structure.

7. **Risk assessment (section 4)**: At least 3 risks (implementation / launch / long-term debt), each with mitigation.

8. **Out of scope (section 5)**: Explicitly list what this design does NOT solve but will need future attention.

9. **Architecture sedimentation suggestions (section 9)**: If this change introduces project-level reusable value (new abstractions, tech decisions, cross-module contracts, dependency changes, forbidden-list updates), fill section 9. Otherwise write "No architecture sedimentation suggestions for this change."

10. **UI-DESIGN.md (frontend only)**: If project is frontend, load `flow-comet-ui-design` skill. Produce design tokens (OKLCH colors, fonts, spacing, animation), anti-AI-slop check, visual north star.

11. **LESSONS scan**: Grep `.specs/LESSONS.md` for keywords related to touched modules or tech decisions. If active lessons hit, declare difference or confirm still applies.

The full design protocol, templates, and anti-patterns are in:
- `flow-kit/prompts/2-design.md` (DESIGN phase)
- `flow-kit/prompts/2a-ui-design.md` (UI-DESIGN phase, frontend only)

### Completion reasoning

This node is truly done when:
- `.specs/<change-id>/DESIGN.md` exists with section 0 (tech stack selected) populated.
- Section 0.5 (existing architecture alignment) is populated for brownfield projects.
- Each technical decision has alternatives + reason + trade-off.
- At least 1 data flow / architecture diagram exists.
- Risk section has at least 3 items with mitigations.
- User has confirmed tech stack and key decisions.
- For frontend: `.specs/<change-id>/UI-DESIGN.md` exists with design tokens.

### Red flags

- **Agent thought**: "Tech stack is obvious from the project, no need to ask." **Actual risk**: Choosing tech stack without user confirmation violates the interactive protocol. Always present cards and wait.
- **Agent thought**: "I know the module boundaries from memory." **Actual risk**: Not grepping actual module boundaries leads to DESIGN.md section 0.5 referencing non-existent paths or missing real touched modules. Must grep, not guess.
- **Agent thought**: "Section 0.5 is optional for small changes." **Actual risk**: Even small changes on brownfield projects can accidentally touch forbidden modules. Section 0.5 is mandatory when CONTEXT.md exists.
- **Agent thought**: "ADR is only for big decisions." **Actual risk**: Any decision that could be reversed later needs an ADR. Missing ADRs mean future changes cannot trace why the current approach was chosen.
- **Agent thought**: "DESIGN.md can include full code implementations." **Actual risk**: Violates R3.1 (Architect does not write implementation code). Pseudocode and function signatures are OK; full function bodies are not.

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry design
```

## Skill Implementation

The design node reads CHANGE.md and REQUIREMENT.md, then produces DESIGN.md through interactive tech stack selection, architecture alignment (grepping actual modules), technical decisions with ADRs, and risk assessment. For frontend projects, it additionally loads `flow-comet-ui-design` to produce UI-DESIGN.md with design tokens and visual specifications.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-ui-design` | Required for frontend projects | Produces UI-DESIGN.md with design tokens, anti-AI-slop check, visual north star |

**加载声明**：加载本 skill 后**立即**运行声明命令（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load design flow-comet-design --prompt flow-kit/prompts/2-design.md
```

## Output Schemas

Schema: `flowkit.design.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `design-doc` | file | yes | `.specs/<change-id>/DESIGN.md` or `.specs/<change-id>/DESIGN-lite.md` |
| `ui-design-doc` | file | yes (frontend) | `.specs/<change-id>/UI-DESIGN.md` |
| `adr-docs` | file | no | `.specs/adr/<NNN>-<title>.md` (0-N files) |

Evidence: `design-summary` (required)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record design '{"summary":"DESIGN.md produced with tech stack, architecture alignment, ADRs, risks"}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `design-artifacts` | DESIGN.md exists with section 0 | artifact-exists |
| `architecture-aligned` | Section 0.5 populated for brownfield | content-check |
| `ui-design-artifacts` | UI-DESIGN.md exists for frontend projects | artifact-exists (conditional) |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit design --apply
```

If the script prints `SKILL: flow-comet-plan`, load that Skill next.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Read `.specs/<change-id>/DESIGN.md` — if exists with section 0 populated and user confirmed, design phase is done.
3. If DESIGN.md exists but incomplete, resume from the first missing section (check 0, 0.5, 1-5, 9).
4. If frontend project: check `.specs/<change-id>/UI-DESIGN.md` existence.
5. Do not repeat confirmed decisions. Resume from the first incomplete artifact.


## Entry Check

```bash
node flow-comet/scripts/workflow-guard.mjs entry design
```

## Skill Implementation

Load `flow-comet-design` for this Node. Operation: `require`.

## Required Skill Calls

- Load `flow-comet-design` during this Node and record completed check `required-skill:design.flow-comet-design`. Reason: 技术栈选型 + ADR
- Load `flow-comet-ui-design` during this Node and record completed check `required-skill:design.flow-comet-ui-design`. Reason: UI-DESIGN（仅前端）

**加载声明**：加载本 skill 后**立即**运行声明命令（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）：

```bash
node flow-comet/scripts/workflow-state.mjs skill-load design flow-comet-design --prompt flow-kit/prompts/2-design.md
```

## Augmentations

- This Node has no declared augmentations.

## Output Schemas

- `flowkit.design.v1`: DESIGN.md Required evidence: `design-summary`. Required artifacts: `design-doc` at `<change-id>/DESIGN.md` or `<change-id>/DESIGN-lite.md`.

## Evidence Record

```bash
node flow-comet/scripts/workflow-state.mjs record design '{"summary":"record the real Node result","completedChecks":[]}'
```

## Guardrails

- `design-artifacts`: DESIGN.md exists (artifact-exists).

## Exit Check

```bash
node flow-comet/scripts/workflow-guard.mjs exit design --apply
```

If the script prints `SKILL: flow-comet-plan`, load that Skill next.

## Recovery

Read `reference/workflow-protocol.json` and the configured workflow state. Resume the first Node that is not listed in `completedNodes`.
