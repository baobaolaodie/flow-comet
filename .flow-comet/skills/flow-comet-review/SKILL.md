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
| REVIEW.md | 文件 ≥ 100 字节；发现区条目处置标记（`[已修]` / `[升级]` / `[转待办]`——新 change 缺失 BLOCKED,旧 change WARN 渐进）；**Major `[转待办]` 须有用户裁决记录**（同段、文末或单独段落「用户裁决：接受延期」+ 指向该条目 + `[升级]` 承接——单独段落与条目以空行分隔、位置不限）——缺失新 change BLOCKED / 旧 change WARN 渐进 | `## Critical` / `## 发现` / `## 结论` 等段（结构要求，guard 不拦段名） |

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B；「填得好不好」由 review 把关。

### 必查清单（review 逐项核对 · 执行者交付纪律）

- [ ] **工件模板保真**：每份交付工件（`*-SUMMARY.md` / TASK / CHANGE / REQUIREMENT / DESIGN）的**标题 / 首部字段 / 段序**与对应模板一致——SUMMARY 按 `flow-kit/templates/SUMMARY.md` 填写并含 `## 自检方法` 段；执行者按 `flow-kit/prompts/4-dev.md` 协议交付。
- [ ] **Skill 工具触发可见**：检查执行者交付的 transcript，**逐节点可见本节点 skill 用 Skill 工具加载**的触发记录——声明标记在 ≠ 已加载；只看到 `skill-load` 声明命令、看不到 Skill 工具触发 → 反馈并要求补证/重做。
- [ ] **Skill 工具不可用降级核验**：执行者会话具备 Skill 工具时，须见 Skill 工具加载节点 SKILL 的触发记录；不具备时（委托会话工具集无 Skill 工具），须按 Read 加载节点 SKILL + 协议，并在 Return Contract（`skillToolFallback: "降级，未执行 Skill 工具注入"`）与 SUMMARY「自检方法」段显式声明——**Read 不得被声称为已注入**。只回传 required-skill 标记而无降级声明 → 证据不完整，要求补声明；声明齐全的环境限制不判为代码缺陷。

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
   - Check every `*-SUMMARY.md` is **模板保真**（标题 `# SUMMARY:` / 首部 4 字段 / 段序一致，含 `## 自检方法` 段）——见下方「必查清单」。

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

8. **Generate fix tasks**: For all Critical and decided-to-fix Major findings, append to `.specs/<change-id>/TASK.md` as numbered fix tasks with full 7 fields — 追加到 TASK.md 的 `## Fix 任务` 段内（**禁止文件尾追加**）, then follow the「Fix 批次状态机路径」section below: home back to execute and run its four exit gates before review can be closed.

9. **Disposition markers (problem-handling principle)**: Every finding entry in the `## 发现` section of REVIEW.md — including Minor — must carry a **disposition marker** so findings never silently disappear after being recorded:
   - `[已修]` — fixed via a fix task (linked in the entry)
   - `[升级]` — escalated to the user for a decision (accept + reason recorded)
   - `[转待办]` — deferred to `.specs/<change-id>/KNOWN-ISSUES.md` at archive time
   - **Major 不得由 reviewer 自行 `[转待办]`**：Major 的延期属用户决策点，reviewer 须先标 `[升级]` 等用户裁决；用户接受延期后，在同段、文末或单独段落记录「用户裁决：接受延期」并指向该条目（由 `[升级]` 承接），方可标 `[转待办]`——单独段落与发现条目以空行分隔、可位于发现区中间，位置不限（guard 按独立段落匹配，不要求位于文末）。review exit 结构校验：Major 条目标 `[转待办]` 而缺上述记录 → 新 change BLOCKED / 旧 change WARN 渐进；Minor `[转待办]` 不受影响，`[升级]` / `[已修]` 的 Major 直接放行。
   The exit guard structurally checks these markers on the findings area: a missing marker **blocks** the exit for a new change, and is a non-blocking warning for a legacy change (to avoid deadlocking legacy reviews). Add markers to clear it.

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
- **Agent thought**: "This Major is not for this batch, I'll defer it to backlog myself." **Actual risk**: Major 延期属用户决策点——reviewer 自行 `[转待办]` 会被退出守卫拦截（新 change BLOCKED / 旧 change WARN）；须先 `[升级]` 等用户裁决，用户接受延期后才可记录裁决并转待办。

## Fix 批次状态机路径

review / verify 发现缺陷后的修复必须回到 `execute` 节点生命周期内完成，禁止驻留源节点「顺手修完」；引擎按以下路径强制闭环（`<源节点>` 为 review 或 verify）：

1. **追加 Fix 任务**：在 `.specs/<change-id>/TASK.md` 的 `## Fix 任务` 段内追加编号修复任务（完整任务字段），**禁止文件尾追加**；任务集修订必须在 `entry` 之前完成。
2. **受控归位 execute**：运行 `workflow-state next`（完整命令：`node .claude/skills/flow-comet/scripts/workflow-state.mjs next`），或运行 `workflow-guard entry execute`（完整命令：`node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry execute`）。处于 Fix 回退态（源节点驻留 + 存在 pending Fix 任务 + 当前路由判定为 execute）时，引擎把当前节点受控归位为 `execute`（`currentNode=execute`），并输出 `FIX-BATCH` 审计行（`next` 同时输出 `NODE: execute`）；用 `workflow-state.mjs status` 确认 `stateCurrentNode` 已是 `execute` 再开工；若未归位，先按 `next` / `status` 的输出核对任务状态与路由，不要未经归位硬开工。
3. **执行修复**：按 execute 节点生命周期完成全部 Fix 任务（委托/直写规则不变）；`entry execute` 刷新任务集签名，锁定追加后的任务集——归位后不得再增删任务或修改任务内容。
4. **跑 execute 四类出口**：`record execute` → `exit execute --apply`。四类出口门禁真实执行——**全任务 done / 逐任务 SUMMARY 完备 / 6 维自查 + 自检方法声明 / 任务集签名一致**；任一缺失即 BLOCKED 并给出恢复指引。通过后，引擎在 Fix 二次完成时把当前节点推回源节点（review 或 verify）。
   - **guard exit 回源审计行语义（Fix vs RETURN）**：真实修复批次二次完成保留 `FIX-BATCH: 回源节点 <源节点>`（真实 Fix 回炉的机器锚）；正常多趟收尾（任务集签名全等且无 Fix 标记）输出中性 `RETURN: 回源节点 <源节点>`（非 Fix 回修）；旧 state 缺闭合/修复证据（无签名事件且无 Fix 标记）输出 `RETURN: 回源节点 <源节点>（旧 state 缺闭合/修复证据，未分类）`，不冒充 Fix、不 BLOCK；上述分类只改审计行文本，路由与 state 写入零变化。此处 `RETURN:` 仅指审计行前缀，与子代理 handoff 的 Return Contract 无关。
5. **回源节点跑出口**：回到源节点后运行 `next`，Fix 回程豁免生效时应输出 `NODE: review` 或 `NODE: verify`（不会因源节点产物已存在而跳过）；若仍输出后续节点，说明回程条件未满足，先核对状态机归属与任务状态，不要继续推进。随后执行 `entry <源节点>` → `exit <源节点> --apply` 跑源节点出口门禁（即 entry/exit 源节点）；通过后继续正常路由（review → verify；verify → archive），必要时进入下一轮 Fix 闭环。
   - **`next` 回程审计行语义**：回程豁免行始终输出中性 `RETURN: 回程源节点 <源节点>`（源节点产物在场且未出口；保留源节点跑出口），不再输出 FIX-BATCH；受控归位行的 `FIX-BATCH: 归位 <execute 家族>` 保留（真实 Fix 回退行），两者不得混同。
6. **禁止绕过**：驻留源节点不归位、顺手改完后直接跑源节点 exit 收场会被 BLOCKED（存在未归位/未跑出口的 Fix 批次），必须按上述路径恢复；不得用跳过归位或出口门禁的手段（含手动改写 `.flow-comet/flow-comet-state.json`）替代本路径。

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

**加载声明（阶段层 · 双步硬规则）**：本节点技能已由入口路由经 Skill 工具加载（你正在阅读的就是它）；本节点 Required Skill Calls 的加载与声明同样不可跳过：

1. 本节点的同名条目已随路由加载——同名 required 条目（`flow-comet-review`）无需重复加载，仅需运行下方对应声明命令（只读取 SKILL.md 文件不叫加载，**不得跳过**真正的 Skill 工具注入步骤）。`flow-comet-test` 为本节点 Required Skill Call，每次 review **必须用 Skill 工具加载**。
2. 加载完成后**立即**运行声明命令，每个协议文件对应一条（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load review flow-comet-review --prompt flow-kit/prompts/6-review.md
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load review flow-comet-test --prompt flow-kit/prompts/5-test.md
```

> **跑 skill-load 声明命令 ≠ 加载**：声明只把“哪次会话加载了哪个 skill、按哪份协议工作”写进状态供 exit/record 核对；真正加载只有第 1 步的 Skill 工具能做到。

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
5. If fix tasks were generated but not executed, follow the「Fix 批次状态机路径」section below to home back to execute and run its four exit gates; return here only after execute exit passes, then run review's own exit.
6. Do not repeat completed review rounds.
