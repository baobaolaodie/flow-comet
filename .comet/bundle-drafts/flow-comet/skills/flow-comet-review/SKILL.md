---
name: flow-comet-review
description: "Use only when explicitly invoked as /flow-comet-review or routed by the flow-comet entry/runtime to the review Node; complete Review for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Review

## Node Goal

Complete the `review` Node for `flow-comet`.

Responsibility: 4 轮审查（spec 合规 + 代码质量 + UI 视觉 + 可选）。生成 REVIEW.md。

This node performs a structured multi-round review of the implemented change, checking spec compliance, code quality across 6 decay dimensions, UI visual consistency (frontend only), and optional tech debt assessment. It produces REVIEW.md and generates numbered fix tasks for any Critical or Major findings. The review node is the quality gate before integration — nothing enters verify without passing this node's checks.

## Guidance

### 必填段清单（结构+存在级）

| 文件 | guard 强制段（缺失 = BLOCKED） | 其余模板段（模板要求，guard 不拦） |
|------|-------------------------------|-----------------------------------|
| REVIEW.md | 文件 ≥ 100 字节 | `## Critical` / `## 发现` / `## 结论` 等段（发现区条目须带处置标记 `[已修]` / `[升级]` / `[转待办]`——缺失 WARN 渐进） |

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B；「填得好不好」由 review 把关。

### Prerequisites

- All tasks in TASK.md must have `status="done"`.
- `<task-id>-SUMMARY.md` must exist for every completed task.
- `.specs/<change-id>/REQUIREMENT.md`, `DESIGN.md`, `TASK.md` must exist.
- `.specs/<change-id>/TEST.md` must exist (from 5-test or produced during review).
- For frontend projects: `.specs/<change-id>/UI-DESIGN.md` must exist.
- The reviewer agent must NOT modify code directly (R3.3) — only produce reports and fix tasks.

### Steps

1. **Round 1 — Spec compliance**: For each AC in REQUIREMENT.md:
   - Check if implemented (link to code/file).
   - Check if tested (link to TEST.md).
   - Check no out-of-scope content was introduced.
   - Check no unplanned features were added.
   - Check no DESIGN.md architecture was violated.

2. **Round 1.5 — Contract consistency check (O-8)**: For changes touching API contracts, state machines, or form validation, verify frontend/backend consistency — this catches silent enum/value mismatches that unit tests on each side miss:
   - **Enum/state values**: Backend status/type enums must match frontend maps (e.g. `ScheduleConfig.status` 0/2/3/4 vs frontend `SCHEDULE_STATUS_MAP`) — grep both sides, confirm the same values mean the same thing.
   - **Field names**: API response fields must match frontend TypeScript types (no silent rename / nested-vs-flat mismatch).
   - **Validation rules**: min/max/required conditions must align between backend Pydantic `Field(ge=...)` / conditional checks and frontend form rules (e.g. required only when a switch is enabled).
   - Record any mismatch as a Major finding with both file:line references (frontend + backend).

3. **Round 2 — Code quality (6 decay risks)**: Diagnose the diff across 6 dimensions from brooks-lint:
   - **R1 Cognitive Overload**: Is the code hard to understand? (>50 line functions, >3 nesting levels)
   - **R2 Change Propagation**: Does changing one thing break unrelated parts?
   - **R3 Knowledge Duplication**: Is the same business rule/constant expressed in multiple places? (Conceptual, not literal code duplication)
   - **R4 Accidental Complexity**: Is the code more complex than the problem requires?
   - **R5 Dependency Disorder**: Do dependencies flow consistently (high -> low layer)?
   - **R6 Domain Model Distortion**: Does the code faithfully reflect the business domain?

   Prefer `/brooks-review` (Claude Code; Codex: `$brooks-review` / `/use brooks-review` — brooks-lint installed) and paste output verbatim. The built-in 6-dimension quick check is a FALLBACK ONLY when brooks-lint is genuinely unavailable (e.g. subagent environment without the plugin) — then diagnose with 4-element format (Symptom/Source/Consequence/Remedy) with file:line references and book citations, and record "brooks-lint unavailable" in the review.

3.5. **Round 2.0 — TEST.md 5-round pyramid completeness**: Before code quality, verify TEST.md:
   - All 5 rounds have clear status (no unfilled).
   - Skipped rounds have reasons.
   - Round 1 (functional): every AC has coverage.
   - Round 2 (performance): if required, has actual/budget/baseline columns.
   - Round 3 (security): if required, has dependency/secret/SAST/OWASP records.
   - Round 4 (compatibility): if required, has browser matrix/migration/cross-version.
   - Round 5 (observability): if required, has log/metric/alert/health check.
   - Any gap -> mark Critical, return to 5-test first.

4. **Round 2.2 — Architecture dependency check (large changes)**: If change adds top-level modules, has dangerous imports, introduces new middleware/services, or spans >= 5 modules: run `/brooks-audit` (Codex: `$brooks-audit`; or draw simplified Mermaid dependency graph). Check for circular dependencies, reverse dependencies, cross-boundary imports.

5. **Round 3 — UI visual review (frontend only)**: If change has UI-DESIGN.md or touches UI files:
   - **3.1 Design tokens**: All colors from UI-DESIGN.md CSS variables? No hardcoded hex/font-size/spacing?
   - **3.2 Anti-pattern scan**: Check against `ui-anti-patterns.md` (fonts, colors, shadows, borders, animations, layout, copy, components).
   - **3.3 Visual north star**: If you only saw the implementation screenshot, would you recognize the declared visual tone?
   - **3.4 Accessibility quick check**: WCAG 2.1 AA contrast, keyboard reachable, focus ring visible, reduced-motion support, form label association, image alt text.

6. **Round 4 — Optional supplements**:
   - **4.1 Tech debt assessment**: If milestone/quarterly release, run `/brooks-debt` (Codex: `$brooks-debt`). Categorize findings into Critical (fix now) / Scheduled (next 1-3 iterations) / Monitored (record only).
   - **4.2 Cross-model spot-check**: If involves security/auth/concurrency/single function >80 lines/coverage drop: run same review with another model, record divergence.

7. **Severity grading**: Each finding gets:
   - Critical (must fix: data corruption, security, AC not met)
   - Major (should fix: design issues, significant regression)
   - Minor (optional: naming, style, small refactor)

8. **Generate fix tasks**: For all Critical and decided-to-fix Major findings, append to `.specs/<change-id>/TASK.md` as numbered fix tasks with full 7 fields — 追加到 TASK.md 的 `## Fix 任务` 段内（**禁止文件尾追加**）, then trigger return to execute node.

9. **Disposition markers (problem-handling principle)**: Every finding entry in the `## 发现` section of REVIEW.md — including Minor — must carry a **disposition marker** so findings never silently disappear after being recorded:
   - `[已修]` — fixed via a fix task (linked in the entry)
   - `[升级]` — escalated to the user for a decision (accept + reason recorded)
   - `[转待办]` — deferred to `.specs/<change-id>/KNOWN-ISSUES.md` at archive time
   The exit guard structurally checks these markers on the findings area (missing marker → non-blocking warning, to avoid deadlocking legacy reviews; add markers to clear it).

The full review protocol, templates, and checklists are in:
- `flow-kit/prompts/6-review.md` (REVIEW phase)
- `flow-kit/prompts/5-test.md` (TEST phase, for test pyramid completeness)

### Completion reasoning

This node is truly done when:
- `.specs/<change-id>/REVIEW.md` exists with all 3 mandatory rounds completed.
- Every finding has a severity label, file:line reference, and a disposition marker (`[已修]` / `[升级]` / `[转待办]`).
- All Critical items are either fixed (fix tasks generated) or explicitly accepted with user confirmation.
- 0 unacknowledged Critical items remain.
- TEST.md 5-round pyramid completeness has been verified.
- No code was directly modified by the reviewer (R3.3).

### Red flags

- **Agent thought**: "Code looks good, no issues found." **Actual risk**: Concluding without file:line references means the review was superficial. Every finding must point to specific code.
- **Agent thought**: "TEST.md exists, that's enough." **Actual risk**: Not checking test pyramid completeness means gaps in test coverage go undetected. Must verify all 5 rounds have clear status.
- **Agent thought**: "I'll fix this small issue directly." **Actual risk**: Reviewer modifying code violates R3.3. Must generate fix tasks instead.
- **Agent thought**: "Round 3 (UI) is optional." **Actual risk**: For frontend projects with UI changes, Round 3 is mandatory. Only non-frontend projects skip it.
- **Agent thought**: "6-dimension review is just a checklist." **Actual risk**: Without file:line references and book citations (when using built-in path), the review lacks rigor and fixability.
- **Agent thought**: "I'll record this Minor and move on." **Actual risk**: Findings (especially Minor) that are recorded without a disposition marker silently disappear — the exit guard warns on missing markers; every finding must be `[已修]`, `[升级]` (user decision), or `[转待办]` (tracked for archive).

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry review
```

## Skill Implementation

Load `flow-comet-review` for this Node. Operation: `require`.

The review node performs a structured 4-round review: spec compliance (Round 1), code quality with 6 decay dimensions + TEST.md completeness + architecture dependency check (Round 2), UI visual review for frontend (Round 3), and optional tech debt/cross-model supplements (Round 4). It produces REVIEW.md and generates fix tasks for Critical/Major findings. The reviewer does not modify code directly.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-test` | Required for test pyramid completeness check | Verifies TEST.md 5-round status before code quality review |
| `/brooks-review` | Preferred if installed | Provides book-backed 6-dimension code quality diagnosis |
| `/brooks-audit` | Conditional (large changes) | Provides architecture dependency graph with cycle detection |
| `/brooks-debt` | Conditional (milestones) | Provides tech debt prioritization with Pain x Spread |

Load `flow-comet-test` during this Node and record completed check `required-skill:review.flow-comet-test`. Reason: 测试金字塔完整性

**加载声明**：加载本 skill 后**立即**运行声明命令（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load review flow-comet-review --prompt flow-kit/prompts/6-review.md
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load review flow-comet-test --prompt flow-kit/prompts/5-test.md
```

## Augmentations

This Node has no declared augmentations.

## Output Schemas

Schema: `flowkit.review.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `review-doc` | file | yes | `.specs/<change-id>/REVIEW.md` |
| `fix-tasks` | file | conditional | `.specs/<change-id>/TASK.md` (numbered fix tasks appended) |

Evidence: `review-summary` (required)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record review '{"summary":"REVIEW.md produced: N Critical, M Major, K Minor. X fix tasks generated."}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `review-evidence` | REVIEW.md exists | artifact-exists |
| `critical-resolved` | 0 unacknowledged Critical items | 执行纪律（review 把关），guard 不校验 |
| `no-code-changes` | Reviewer did not modify code files | 执行纪律（review 把关），guard 不校验 |
| `test-pyramid-checked` | TEST.md 5-round completeness verified | 执行纪律（review 把关），guard 不校验 |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit review --apply
```

If the script prints `SKILL: flow-comet-verify`, load that Skill next.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Read `.specs/<change-id>/REVIEW.md` — if exists with all rounds completed and Critical resolved, review is done.
3. If REVIEW.md exists but incomplete, check which rounds are missing and resume from there.
4. If Critical items were found but fix tasks not yet generated, generate them now.
5. If fix tasks were generated but not executed, return to execute node.
6. Do not repeat completed review rounds.
