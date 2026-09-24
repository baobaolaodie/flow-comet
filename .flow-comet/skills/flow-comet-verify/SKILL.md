---
name: flow-comet-verify
description: "Use only when explicitly invoked as /flow-comet-verify or routed by the flow-comet entry/runtime to the verify Node; complete Verify for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Verify

## Node Goal

Complete the `verify` Node for `flow-comet`.

Responsibility: 集成验证 + UAT + 失败诊断（自动重试 ≤ 3 次，第 4 次失败暂停）。生成 UAT.md（TEST.md 前置已有）。

This node performs the final integration verification: running all automated tests, type checks, and builds, then guiding the human through UAT scripts from TEST.md. It produces UAT.md with pass/fail results for each item. If failures occur, it diagnoses root causes, generates fix tasks, and auto-retries ≤ 3 times (machine-counted verifyFailures); on the 4th failure it must pause and ask the user「继续修 / 停止」. This node is the final quality gate before archiving.

## Guidance

### 必填段清单（结构+存在级）

| 文件 | guard 强制段（缺失 = BLOCKED） | 其余模板段（模板要求，guard 不拦） |
|------|-------------------------------|-----------------------------------|
| TEST.md | `## 验证命令`（exit verify 真实执行） | `## 测试矩阵` 等段（5 轮金字塔，review 把关） |
| UAT.md | `## 验收结果` | 其余（执行纪律，review 把关） |

> **注意**：flow-kit 的 TEST 模板**不含 `## 验证命令` 段**——该段是 flow-comet 的强制增量（exit verify 会真实执行其中的命令并计数失败）。使用 `flow-kit/templates/TEST.md` 填写后，**必须按上方必填段清单补写 `## 验证命令` 段**，否则 exit verify 会被 BLOCKED。**排版约束**：`## 验证命令` 标题后必须**紧跟**代码块（` ``` `），标题与代码块之间**不得插入任何说明行**（如 blockquote 说明——guard 正则要求标题后直接是代码块）；段名可带括号后缀。UAT.md 同理：flow-kit 无独立 UAT 模板（UAT 脚本格式见 5-test.md 1.2 节），产出时按上方必填段清单写 `## 验收结果` 段。

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B；「填得好不好」由 review 把关。

### Prerequisites

- `.specs/<change-id>/REVIEW.md` must exist (from review node).
- All Critical items from REVIEW.md must be resolved (fixed or explicitly accepted).
- `.specs/<change-id>/TEST.md` must exist with UAT scripts.
- `.specs/<change-id>/REQUIREMENT.md` must exist for AC reference.

### Steps

1. **Run full automation**: Execute all automated checks and paste real output:
   - Full unit tests: `pytest tests/ -q` (or equivalent).
   - Integration/e2e tests: if available.
   - Type check: `tsc --noEmit` / `mypy` / equivalent.
   - Build: `npm run build` / `vite build` / equivalent.
   - Any failure -> immediately enter failure diagnosis (step 3).

2. **Guide human UAT**: Read TEST.md UAT scripts one by one. For each UAT item:
   - Present the scenario, preconditions, steps, and expected results.
   - Ask user: "Pass / Fail / Describe issue".
   - Record result in `.specs/<change-id>/UAT.md`.

3. **Failure diagnosis**: For any failure (automated test or UAT):
   - Switch to "Diagnose sub-role" — identify root cause, not symptom.
   - Produce fix-plan: append to TASK.md 的 `## Fix 任务` 段 as numbered fix tasks with full 7 fields and verify command — 禁止文件尾追加.
   - Follow the「Fix 批次状态机路径」section below: home back to execute, run its four exit gates, then return to verify.
   - Re-run verification after fix, then run verify's own exit gates.

4. **Auto-retry limit (R2.6)**: verify 失败自动重试 ≤ 3 次（机器计数 verifyFailures）；第 4 次失败必须暂停问用户「继续修 / 停止」。Do not auto-retry beyond 3 times.

5. **LESSONS nomination**: Before archiving, scan all `*-SUMMARY.md` "decisions and deviations" sections and any `*-PROGRESS.md` "excluded solutions" sections. Apply nomination criteria:
   - Debugging/trial-and-error took > 30 minutes -> nominate.
   - Error is not task-specific, other tasks would hit it too -> nominate.
   - Reasonable probability of retry within 6 months -> nominate.
   - Otherwise do not nominate (avoid pollution).
   - Add qualifying lessons to `.specs/LESSONS.md` with next L-NNN number — 新条目编号 = 当前最大编号 + 1,插入 `## 条目区` 末尾(文件内升序,继续现有编号),**禁止文件尾追加与乱序插入**.
   - Check existing active lessons for superseded/deprecated status.

The full verification protocol, UAT format, and failure diagnosis are in:
- `flow-kit/prompts/7-integration.md` (INTEGRATION phase, verification + UAT sections)
- `flow-kit/prompts/5-test.md` (TEST phase, for UAT script format)

### Completion reasoning

This node is truly done when:
- All automated checks pass with real output pasted.
- All UAT items have pass/fail recorded in `.specs/<change-id>/UAT.md`.
- verify 失败自动重试 ≤ 3 次（机器计数 verifyFailures），第 4 次失败已暂停问用户。
- All failures have been diagnosed and fix tasks generated.
- LESSONS have been nominated from SUMMARY.md files.

### Red flags

- **Agent thought**: "Tests passed last time, no need to run again." **Actual risk**: Claiming pass without pasting real output (R4.4 violation) means failures go undetected. Must run and paste.
- **Agent thought**: "This UAT item is similar to the last one, marking pass." **Actual risk**: UAT must be executed by the human, not assumed. Each item needs explicit human confirmation.
- **Agent thought**: "Auto-retry 4th time, maybe it'll work now." **Actual risk**: On the 4th failure (R2.6 violation), the problem is likely systematic, not transient. Must pause and ask the user「继续修 / 停止」.
- **Agent thought**: "Fix the failure directly, no need for a fix task." **Actual risk**: Bypassing the fix-task -> execute -> re-verify cycle means the fix is not properly tracked or tested. Must go through the proper loop.

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
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry verify
```

## Skill Implementation

Load `flow-comet-verify` for this Node. Operation: `require`.

The verify node loads `flow-comet-integration` for the verification protocol. It runs all automated checks (tests, type check, build), guides the human through UAT scripts from TEST.md, performs failure diagnosis with ≤3 auto-retries (4th failure pauses for human decision), and produces UAT.md. It also nominates lessons from SUMMARY.md files before the archive step.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-integration` | Required for verification protocol | Provides automation execution, UAT guidance, failure diagnosis, LESSONS nomination |

Load `flow-comet-integration` during this Node and record completed check `required-skill:verify.flow-comet-integration`. Reason: 集成验证 + UAT + LESSONS 提名

**加载声明（阶段层 · 双步硬规则）**：本节点技能已由入口路由经 Skill 工具加载（你正在阅读的就是它）；本节点 Required Skill Calls 的加载与声明同样不可跳过：

1. **用 Skill 工具加载** `flow-comet-integration`（本节点 Required Skill Call）。**不得跳过**——只读取 SKILL.md 文件不叫加载；真正让 flow-comet-integration 指令生效的是 Skill 工具把它注入本次会话。
2. 加载完成后**立即**运行声明命令（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load verify flow-comet-integration --prompt flow-kit/prompts/7-integration.md
```

> **跑 skill-load 声明命令 ≠ 加载**：声明只把“哪次会话加载了哪个 skill、按哪份协议工作”写进状态供 exit/record 核对；真正加载只有第 1 步的 Skill 工具能做。

## Augmentations

This Node has no declared augmentations.

## Output Schemas

Schema: `flowkit.verify.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `uat-doc` | file | yes | `.specs/<change-id>/UAT.md` |
| `test-doc` | file | yes | `.specs/<change-id>/TEST.md` (must already exist) |
| `lessons-updated` | file | conditional | `.specs/LESSONS.md` (if new lessons nominated；无合格条目时扫描本身即完成，不新增条目) |

Evidence: `verification-result` (required)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record verify '{"summary":"All automation passed, N UAT items verified (X pass, Y fail), Z lessons nominated"}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `verify-evidence` | UAT.md exists | artifact-exists |
| `automation-passed` | All automated checks pass (real output) | 执行纪律（review 把关），guard 不校验 |
| `retry-limit` | No more than 3 auto-retries（机器计数 verifyFailures，第 4 次 BLOCKED） | process-check |
| `lessons-nominated` | LESSONS.md updated with new entries（完成提名扫描；仅当有合格条目时更新——无合格条目不强制新增，避免噪音条目） | 执行纪律（review 把关），guard 不校验 |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit verify --apply
```

If the script prints `SKILL: flow-comet-archive`, load that Skill next.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Read `.specs/<change-id>/UAT.md` — check which items have results.
3. If UAT.md exists with all items passing, verification is done.
4. If UAT.md has failures, check if fix tasks were generated in TASK.md.
5. If fix tasks exist but have not gone through the execute lifecycle, follow the「Fix 批次状态机路径」section below: home back to execute, run its four exit gates, then return to verify and run verify's exit gates.
6. Count previous auto-retries (from UAT.md / machine-counted verifyFailures) to enforce R2.6 limit.
7. Resume from the first incomplete verification step.
