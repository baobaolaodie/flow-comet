---
name: flow-comet-verify
description: "Use only when explicitly invoked as /flow-comet-verify or routed by the flow-comet entry/runtime to the verify Node; complete Verify for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Verify

## Node Goal

Complete the `verify` Node for `flow-comet`.

Responsibility: 集成验证 + UAT + 失败诊断（≤3 轮）。生成 TEST.md + UAT.md。

## Guidance

---
name: flow-comet-verify
description: "Verify node for flow-comet: runs full automation (tests + type check + build), guides human UAT, performs failure diagnosis with max 3 auto-retries, and produces UAT.md. Do not use for ordinary standalone tasks."
---

# Verify

## Node Goal

This node performs the final integration verification: running all automated tests, type checks, and builds, then guiding the human through UAT scripts from TEST.md. It produces UAT.md with pass/fail results for each item. If failures occur, it diagnoses root causes, generates fix tasks, and auto-retries up to 3 rounds before pausing for human decision. This node is the final quality gate before archiving.

## Guidance

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
   - Produce fix-plan: append to TASK.md as `T-FIX-XX` with full 7 fields and verify command.
   - Return to execute node for fix execution.
   - Re-run verification after fix.

4. **Auto-retry limit (R2.6)**: Maximum 3 rounds of automatic retry. After 3rd round failure, pause and require human decision. Do not auto-retry beyond 3 rounds.

5. **LESSONS nomination**: Before archiving, scan all `*-SUMMARY.md` "decisions and deviations" sections and any `*-PROGRESS.md` "excluded solutions" sections. Apply nomination criteria:
   - Debugging/trial-and-error took > 30 minutes -> nominate.
   - Error is not task-specific, other tasks would hit it too -> nominate.
   - Reasonable probability of retry within 6 months -> nominate.
   - Otherwise do not nominate (avoid pollution).
   - Add qualifying lessons to `.specs/LESSONS.md` with next L-NNN number.
   - Check existing active lessons for superseded/deprecated status.

The full verification protocol, UAT format, and failure diagnosis are in:
- `flow-kit/prompts/7-integration.md` (INTEGRATION phase, verification + UAT sections)
- `flow-kit/prompts/5-test.md` (TEST phase, for UAT script format)

### Completion reasoning

This node is truly done when:
- All automated checks pass with real output pasted.
- All UAT items have pass/fail recorded in `.specs/<change-id>/UAT.md`.
- No more than 3 auto-retry rounds were used.
- All failures have been diagnosed and fix tasks generated.
- LESSONS have been nominated from SUMMARY.md files.

### Red flags

- **Agent thought**: "Tests passed last time, no need to run again." **Actual risk**: Claiming pass without pasting real output (R4.4 violation) means failures go undetected. Must run and paste.
- **Agent thought**: "This UAT item is similar to the last one, marking pass." **Actual risk**: UAT must be executed by the human, not assumed. Each item needs explicit human confirmation.
- **Agent thought**: "Auto-retry 4th time, maybe it'll work now." **Actual risk**: Beyond 3 retries (R2.6 violation), the problem is likely systematic, not transient. Must pause for human decision.
- **Agent thought**: "Fix the failure directly, no need for a fix task." **Actual risk**: Bypassing the fix-task -> execute -> re-verify cycle means the fix is not properly tracked or tested. Must go through the proper loop.

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry verify
```

## Skill Implementation

The verify node loads `flow-comet-integration` for the verification protocol. It runs all automated checks (tests, type check, build), guides the human through UAT scripts from TEST.md, performs failure diagnosis with max 3 auto-retries, and produces UAT.md. It also nominates lessons from SUMMARY.md files before the archive step.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-integration` | Required for verification protocol | Provides automation execution, UAT guidance, failure diagnosis, LESSONS nomination |

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
| `verify-evidence` | UAT.md exists with results | artifact-exists |
| `automation-passed` | All automated checks pass (real output) | content-check |
| `retry-limit` | No more than 3 auto-retry rounds | process-check |
| `lessons-nominated` | LESSONS.md updated with new entries | artifact-exists |

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
6. Count previous auto-retry rounds from UAT.md to enforce R2.6 limit.
7. Resume from the first incomplete verification step.


## Entry Check

```bash
node flow-comet/scripts/workflow-guard.mjs entry verify
```

## Skill Implementation

Load `flow-comet-verify` for this Node. Operation: `require`.

## Required Skill Calls

- Load `flow-comet-integration` during this Node and record completed check `required-skill:verify.flow-comet-integration`. Reason: 集成验证 + UAT + LESSONS 提名

## Augmentations

- This Node has no declared augmentations.

## Output Schemas

- `flowkit.verify.v1`: TEST.md + UAT.md Required evidence: `verification-result`. Required artifacts: `test-doc` at `<change-id>/TEST.md`; `uat-doc` at `<change-id>/UAT.md`.

## Evidence Record

```bash
node flow-comet/scripts/workflow-state.mjs record verify '{"summary":"record the real Node result","completedChecks":[]}'
```

## Guardrails

- `verify-evidence`: TEST.md or UAT.md exists (artifact-exists).

## Exit Check

```bash
node flow-comet/scripts/workflow-guard.mjs exit verify --apply
```

If the script prints `SKILL: flow-comet-archive`, load that Skill next.

## Recovery

Read `reference/workflow-protocol.json` and the configured workflow state. Resume the first Node that is not listed in `completedNodes`.
