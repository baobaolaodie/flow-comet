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

### 必填段清单（结构+存在级）

| 文件 | guard 强制段（缺失 = BLOCKED） | 其余模板段（模板要求，guard 不拦） |
|------|-------------------------------|-----------------------------------|
| DESIGN.md | `## 0.` 技术栈段 / `## 决策清单` | `## 0.5 架构对齐` / `## 风险` / `## 数据流` 等 |

> **决策清单段名须与模板精确一致**:guard 按 flow-kit 模板段名派生校验——模板段为 `## 1. 决策清单`(编号可选),**不要写成"技术决策清单"等变体**(2-design.md 指引的"技术决策"是内容要求,不是段名;实测:写变体段名会被拦截)。

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / templateSectionPatterns；「填得好不好」由 review 把关。

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
| `flow-comet-ui-design` | Advisory（仅前端项目触发） | Produces UI-DESIGN.md with design tokens, anti-AI-slop check, visual north star——advisory 条目不要求 skill-load 声明（record D3 只校验执行者实际声明的 guarded 条目） |

**加载声明（阶段层 · 双步硬规则）**：本节点技能已由入口路由经 Skill 工具加载（你正在阅读的就是它）；本节点 Required Skill Calls 的加载与声明同样不可跳过：

1. 本节点的同名条目已随路由加载——同名 required 条目（`flow-comet-design`）无需重复加载，仅需运行下方声明命令（只读取 SKILL.md 文件不叫加载，**不得跳过**真正的 Skill 工具注入步骤）。`flow-comet-ui-design` 为 advisory 条目——仅前端项目用 Skill 工具加载其已装副本，非前端项目不加载不声明；若前端项目把 `required-skill:design.flow-comet-ui-design` 记入 completedChecks，也必须先运行对应 skill-load 声明（D3 校验声明过的条目）。
2. 加载完成后**立即**运行声明命令（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load design flow-comet-design --prompt flow-kit/prompts/2-design.md
```

> **跑 skill-load 声明命令 ≠ 加载**：声明只把“哪次会话加载了哪个 skill、按哪份协议工作”写进状态供 exit/record 核对；真正加载只有第 1 步的 Skill 工具能做到。

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
| `architecture-aligned` | Section 0.5 populated for brownfield | 执行纪律（review 把关），guard 不校验 |
| `ui-design-artifacts` | UI-DESIGN.md exists for frontend projects | 执行纪律（review 把关），guard 不校验 |

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
