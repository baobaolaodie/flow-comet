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
   - Produce fix-plan: append to TASK.md as numbered fix tasks with full 7 fields and verify command.
   - Return to execute node for fix execution.
   - Re-run verification after fix.

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
| `lessons-updated` | file | yes | `.specs/LESSONS.md` (nominated lessons added) |

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
5. If fix tasks exist but not executed, return to execute node.
6. Count previous auto-retries (from UAT.md / machine-counted verifyFailures) to enforce R2.6 limit.
7. Resume from the first incomplete verification step.
