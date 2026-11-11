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

| 文件（模板 = `flow-kit/templates/<DOC>.md`） | 左栏 · 无条件段（模板 H2，缺席 / 空正文 = BLOCKED） | 右栏 · 条件段（**标题必须在场**，正文可写 `N/A`）/ 增量段（按登记位置） |
|------|------|------|
| `REVIEW.md` | `## 第一轮 · Spec 合规审查` / `## 第二轮 · 代码质量审查（6 维衰退风险）` / `## 总结`；结构子段 `### 2.0 TEST.md 5 轮金字塔完整性` / `### 2.1` / `### 2.2` / `### 2.3` 在父段在场时必在场；文件 ≥ 100 字节；首部字段 `Change ID` / `审查时间` / `审查者` / `总体结论` 已在场时值不得为空（键集不强制） | **条件段**：`## 第三轮 · UI 视觉审查（仅前端）` / `## 第四轮 · 补充审查（按触发条件）`——标题必须在场，不适用写 `N/A`（其结构子段 `### 4.1` / `### 4.2` 在父段适用时必在场）；**增量段**：发现条目的**处置标记**（`[已修]` / `[升级]` / `[转待办]`，必填，写在 `### 2.2 6 维诊断 · 详细发现` 段内） |

发现写在模板外的 `## 发现` 而 `### 2.2` 无条目 → 一律 BLOCKED（条目记录在非模板位置等于静默丢弃）；**任何严重度的 `[转待办]` 都须有用户裁决记录**（同段、文末或单独段落「用户裁决：接受延期」+ 指向该条目 + `[升级]` 承接——单独段落与条目以空行分隔、位置不限），缺失一律 BLOCKED（同一形态一个判级）；**每条判为 Minor 的发现都要在条目块内写 `判 Minor：<一句话理由>`**（判据见下方「处置标记」条），与处置标记无关——缺这行同样一律 BLOCKED（同一形态一个判级）。

本出口**声明加载** `TEST.md` 并做 **5 轮完整性过程检查**（细目见 `flow-comet-test` 册）；`TEST.md` 的**结构骨架校验在 verify 出口**（`flowkit.verify.v1`），不在本出口——`## 验证命令` 增量段的执行与校验同样在 verify 出口。

**AC 覆盖**在这里只做汇总提示：`REQUIREMENT.md` 的验收准则每条都应在 `TEST.md` 的 1.1 测试矩阵里有对应行；真缺时出口打印一行 `REVIEW WARN: TEST.md 的 1.1 测试矩阵缺 AC 覆盖: AC-…`——一条汇总、不逐条刷屏、**不改变退出码**。权威判定在 verify 出口：缺覆盖 **BLOCKED**（点名编号 + 恢复句「在 TEST.md 的 1.1 测试矩阵为这些 AC 补行」；同一形态一个判级）。判不了按成因二分（与波次判据同口径）：**模板缺席**（段名无从派生）→ 打印「未校验（<原因>）」且不改退出码（未验证 ≠ 通过，也不冒充通过）；**内容不可判** → verify 出口打印 `AC 覆盖判据无法执行`，一律 BLOCKED（同一形态一个判级）。落在内容不可判一侧的有两种形态：承载段或段内清单读不出来（`REQUIREMENT.md` 的验收准则段被删掉 / `TEST.md` 的第 1 轮段被删掉 / `REQUIREMENT.md` 无 AC 编号 / 第 1 轮内无 1.1 测试矩阵段），以及 **change 自己的载体文件本身缺席**（`REQUIREMENT.md` 缺席 / `TEST.md` 缺席）——载体文件是这个 change 自己的东西，删掉它换不到「没有可判对象」。围栏代码块里的示例行也不算覆盖（矩阵段跨过围栏读段界，示例仍只是示例）。本出口对两支判不了都不打印（不制造噪音），只汇总真缺的编号。

guard 校验见 workflow-guard.mjs 的 review 出口门禁（发现区处置标记 / 发现位置 / 延期裁决（任何严重度）/ Minor 判定理由行 / 模板骨架）与模板骨架派生（段标题 / 段序 / 首部字段 / 增量段位置）；「填得好不好」由 review 自身把关。

> **模板权威**：本节点产出工件的段形 = **上游模板 + 本仓登记的增量段**——唯一权威 = `flow-kit/templates/**`（段与正文），条件段 / 结构子段 / 增量段与指纹由 `../flow-comet/reference/artifact-templates.json` 登记；`.specs/archive/**` 是历史证据、**不是模板来源**——不得以「上一轮就是这么写的」对齐段形。

加载顺序：先读 `READ PROMPT:`（`6-review`、`5-test`），再读 `READ TEMPLATE:`（`REVIEW`、`TEST`）。

### 必查清单（review 逐项核对 · 执行者交付纪律）

- [ ] **工件模板保真**：每份交付工件（`*-SUMMARY.md` / TASK / CHANGE / REQUIREMENT / DESIGN）的**标题 / 首部字段 / 段序**与对应模板一致——SUMMARY 按 `flow-kit/templates/SUMMARY.md` 填写并含 `## 自检方法` 段；执行者按 `flow-kit/prompts/4-dev.md` 协议交付。
- [ ] **Skill 工具触发可见**：检查执行者交付的 transcript，**逐节点可见本节点 skill 用 Skill 工具加载**的触发记录——声明标记在 ≠ 已加载；只看到 `skill-load` 声明命令、看不到 Skill 工具触发 → 反馈并要求补证/重做。
- [ ] **AC 覆盖**：看到出口打印的 `REVIEW WARN: TEST.md 的 1.1 测试矩阵缺 AC 覆盖` 时逐条核对缺失编号——要么在 1.1 矩阵补行（verify 出口会据此 BLOCK），要么在 REVIEW 里说明该 AC 为何无用例并按发现条目处理（处置标记 + 严重度）；**不得因为 review 出口只汇总、不阻断，就把缺口留给 verify 出口**。
- [ ] **Skill 工具不可用降级核验**：执行者会话具备 Skill 工具时，须见 Skill 工具加载节点 SKILL 的触发记录；不具备时（委托会话工具集无 Skill 工具），须按 Read 加载节点 SKILL + 协议，并在 Return Contract（`skillToolFallback: "<降级替代形态，如 file-read>"`）与 SUMMARY「自检方法」段显式声明——**Read 不得被声称为已注入（即未执行 Skill 工具注入，字段值必须写替代形态而非本说明）**。只回传 required-skill 标记而无降级声明 → 证据不完整，要求补声明；声明齐全的环境限制不判为代码缺陷。

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
   - Round 1 (functional): every AC has coverage — every acceptance criterion in `REQUIREMENT.md` reads a row in the 1.1 test matrix. When any is missing the review exit prints one summary line (`REVIEW WARN: TEST.md 的 1.1 测试矩阵缺 AC 覆盖: AC-…`) and keeps its exit code, while the verify exit is the authoritative gate: a new change blocks on the gap with the recovery line "add the rows to TEST.md's 1.1 test matrix", an older change warns. When the criterion cannot be judged the causes part ways (the same convention as the wave rule): a missing template — the section names cannot be derived — prints "not checked (<reason>)" and keeps the exit code, while content that cannot be judged is not a pass: the exit reports that the AC coverage rule cannot run, blocks a new change, warns on an older change and counts that warning. Two shapes fall on that side: the carrier section or the list inside it cannot be read (the acceptance section deleted from `REQUIREMENT.md`, the round-1 section deleted from `TEST.md`, no AC ids, or no 1.1 test matrix inside the round-1 section), and a carrier document of the change itself being gone — `REQUIREMENT.md` absent or `TEST.md` absent: the document belongs to this change, so deleting it is not "nothing to judge"; a sample row inside a fenced code block counts as neither coverage nor a declared criterion either, because the matrix section steps over fences while the sample stays a sample. This exit prints neither of the two not-judged branches.
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

7. **Severity grading**: Each finding gets one of three grades — **Major 是默认档位**：
   - Critical (must fix: data corruption, security, AC not met)
   - Major (should fix: design issues, significant regression) — **默认**：拿不准就判 Major
   - Minor (optional: naming, style, small refactor) — **仅当同时满足下方「Minor 的判据」全部五条**才可判；且该条目必须带一行 `判 Minor：<理由>`

8. **Generate fix tasks**: For all Critical and decided-to-fix Major findings, append to `.specs/<change-id>/TASK.md` as numbered fix tasks with full 7 fields — 追加到 TASK.md 的 `## Fix 任务` 段内（**禁止文件尾追加**）, then follow the「修复回路状态机路径」section below: home back to execute and run its four exit gates before review can be closed.

9. **Disposition markers (problem-handling principle)**: Every finding entry in the `## 发现` section of REVIEW.md — including Minor — must carry a **disposition marker** so findings never silently disappear after being recorded:
   - `[已修]` — fixed via a fix task (linked in the entry)
   - `[升级]` — escalated to the user for a decision (accept + reason recorded)
   - `[转待办]` — deferred to `.specs/<change-id>/KNOWN-ISSUES.md` at archive time；**延期在任何严重度上都是用户决策点**
   - **`[转待办]` 一律需用户裁决（Major 与 Minor 同一标准）**：延期不是 reviewer 能自行给出的处置。reviewer 须先标 `[升级]` 等用户裁决；用户接受延期后，在同段、文末或单独段落记录「用户裁决：接受延期」并指向该条目（由 `[升级]` 承接），方可标 `[转待办]`——单独段落与发现条目以空行分隔、可位于发现区中间，位置不限（guard 按独立段落匹配，不要求位于文末）。review exit 结构校验：条目标 `[转待办]` 而缺上述记录 → 一律 BLOCKED（同一形态一个判级）；`[升级]` / `[已修]` 的条目直接放行。
   - **Minor 的判据（五条全中才算 Minor，否则按 Major 处理）**：① 不改变任何行为与输出；② 不影响任何对外 / 对用户的表述（文档、报文、CHANGELOG）；③ 不新增或保留第二份等价实现；④ 不削弱任何断言或测试判别力；⑤ 不涉及跨平台 / 分发形态。**不满足任一条即按 Major 处理**——举证责任在「判 Minor」的一侧，不在「判 Major」的一侧。每条判为 Minor 的发现都必须带一行判定理由，形态固定为 `判 Minor：<一句话理由，对应①~⑤>`，写在条目块内、与条目标题之间不留空行，**与处置标记无关**（`[已修]` / `[升级]` / `[转待办]` 一律要：理由落在判定当时，而不是延期时再补）；缺该行 → 一律 BLOCKED（同一形态一个判级）。
   - **修复回路内不得延期**：在一次修复回路里新发现的条目，只能是 `[已修]` 或 `[升级]`（交用户裁决）——即使该条目已有用户裁决的延期记录在场，也不得把修复回路新增的发现标 `[转待办]`。回路是「把本轮引入的问题收干净」的窗口，不是继续开新账的入口。
   The exit guard structurally checks these markers on the findings area: a missing marker **blocks** the exit for a new change, and is a non-blocking warning for a legacy change (to avoid deadlocking legacy reviews). Add markers to clear it.

The full review protocol, templates, and checklists are in:
- `flow-kit/prompts/6-review.md` (REVIEW phase)
- `flow-kit/prompts/5-test.md` (TEST phase, for test pyramid completeness)

### Completion reasoning

This node is truly done when:
- `.specs/<change-id>/REVIEW.md` exists with all 3 mandatory rounds completed.
- Every finding has a severity label, file:line reference, and a disposition marker (`[已修]` / `[升级]` / `[转待办]`); every `[转待办]` has a recorded user ruling, and every Minor carries its `判 Minor：` reason line.
- All Critical items are either fixed (fix tasks generated) or explicitly accepted with user confirmation.
- 0 unacknowledged Critical items remain.
- TEST.md 5-round pyramid completeness has been verified.
- No code was directly modified by the reviewer (R3.3).

### Red flags

- **Agent thought**: "Code looks good, no issues found." **Actual risk**: Concluding without file:line references means the review was superficial. Every finding must point to specific code.
- **Agent thought**: "TEST.md exists, that's enough." **Actual risk**: Not checking test pyramid completeness means gaps in test coverage go undetected. Must verify all 5 rounds have clear status.
- **Agent thought**: "The exit only warned about the missing AC coverage, so it is not my problem." **Actual risk**: 汇总不阻断是分工，不是豁免——verify 出口会就同一份缺口 BLOCKED。缺口只有两条出路：在 1.1 矩阵补行，或把它作为发现条目按处置标记处理；把缺口留到 verify 等于把可修的问题变成一次节点返工。
- **Agent thought**: "I'll fix this small issue directly." **Actual risk**: Reviewer modifying code violates R3.3. Must generate fix tasks instead.
- **Agent thought**: "Round 3 (UI) is optional." **Actual risk**: For frontend projects with UI changes, Round 3 is mandatory. Only non-frontend projects skip it.
- **Agent thought**: "6-dimension review is just a checklist." **Actual risk**: Without file:line references and book citations (when using built-in path), the review lacks rigor and fixability.
- **Agent thought**: "I'll record this Minor and move on." **Actual risk**: 不带处置标记（或判了 Minor 却写不出 `判 Minor：` 理由）的发现等于静默丢弃——退出守卫按结构拦截；每条发现都必须是 `[已修]`、`[升级]`（交用户裁决）或 `[转待办]`（延期，须先有用户裁决）。
- **Agent thought**: "This finding is not for this batch, I'll defer it to backlog myself." **Actual risk**: 延期在任何严重度上都是用户决策点——Major 与 Minor 一视同仁；reviewer 自行 `[转待办]` 会被退出守卫拦下（一律 BLOCKED），须先 `[升级]` 等用户裁决，用户接受延期后才可记录裁决并转待办。
- **Agent thought**: "It's only naming and style, Minor is fine." **Actual risk**: Minor 的判据是五条全中而不是主观轻重——改行为、改对外表述、留第二份等价实现、削弱断言、触及跨平台面，任一条成立即按 Major 处理；宽判 Minor 正是遗留账不断增长的入口，判不准时默认 Major。
- **Agent thought**: "I'm in a fix loop, I'll defer this new one." **Actual risk**: 修复回路内新发现的条目只能 `[已修]` 或 `[升级]`——不得 `[转待办]`，即使裁决记录在场；这是纪律要求，守卫只看结构、看不出你在回路里第几轮。

## 修复回路状态机路径

review 发现 Critical / Major 后的修复必须回到 `execute` 节点生命周期内完成——**禁止驻留源节点「顺手修完」**（会被 BLOCKED）。要点：

1. **追加 Fix 任务**：把修复任务（完整任务字段）追加到 `.specs/<change-id>/TASK.md` 的 `## Fix 任务` 段内，**禁止文件尾追加**；任务集修订须在 `entry` 之前完成。
2. **受控归位 execute**：跑 `workflow-state next` 或 `workflow-guard entry execute` 触发受控归位（审计行 `FIX-BATCH: 归位`；`next` 同时输出 `NODE: execute`）；用 `status` 确认 `stateCurrentNode` 已是 `execute` 再开工，未归位不得硬开工。
3. **跑完 execute 四类出口**：`record execute` → `exit execute --apply`——全任务 done / 逐任务 SUMMARY 完备 / 6 维自查 + 自检方法声明 / 任务集签名一致，任一缺失即 BLOCKED；通过后引擎把当前节点推回 review。
4. **回源节点跑出口**：回到源节点后跑该节点出口门禁（`entry <源节点>` → `exit <源节点> --apply`），通过后继续 review → verify 的正常路由，必要时进入下一轮 Fix 闭环。
5. **禁止绕过**：驻留源节点不归位、顺手改完后直接跑源节点 exit 收场会被 BLOCKED；不得用跳过归位或出口门禁的手段（含手动改写 `.flow-comet/flow-comet-state.json`）替代本路径。
6. **回路内新发现的条目不得延期**：修复过程中（含回到 review 复检时）新发现的条目只能标 `[已修]` 或 `[升级]`（交用户裁决），**不得**标 `[转待办]`——即使已有用户裁决的延期记录在场。回路是把本轮引入的问题收干净的窗口，不是继续开新账的入口；守卫只做结构判定，这一条靠执行纪律。

**何时读完整规格**：要核对完整判据——Fix 任务与任务集签名的时序、受控归位的完整判定条件、`FIX-BATCH` / `RETURN` 审计行三态语义与回源节点的回程豁免、绕过的失败面与恢复指引——读 `../flow-comet/reference/fix-loop.md`（**当你 review 发现缺陷、要开修复回路把工作退回 execute 生命周期时读它**）。

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
2. 加载完成后**立即**运行声明命令，每个协议文件对应一条（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）。`--templates` 声明本节点该读的产出物模板（review → `REVIEW.md` + `TEST.md`，两条命令各写全清单）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load review flow-comet-review --prompt flow-kit/prompts/6-review.md --templates REVIEW.md,TEST.md
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load review flow-comet-test --prompt flow-kit/prompts/5-test.md --templates REVIEW.md,TEST.md
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
| `test-pyramid-checked` | TEST.md 5 轮金字塔的结构在场（各轮 H2 标题 + 结构子段）+ REVIEW 的 `### 2.0` 完整性小节 | 结构级（`### 2.0` 子段由 REVIEW 模板骨架在本出口强制；`TEST.md` 骨架由 verify 出口按登记表校验——缺席即 BLOCKED，条件轮写 `N/A` 放行）；5 轮内容质量仍由 review 自己把关 |

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
5. If fix tasks were generated but not executed, follow the「修复回路状态机路径」section below to home back to execute and run its four exit gates; return here only after execute exit passes, then run review's own exit.
6. Do not repeat completed review rounds.
