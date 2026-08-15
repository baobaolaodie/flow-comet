<div align="right">

[English](ECOSYSTEM.md) · [中文](ECOSYSTEM-zh.md)

</div>

# Ecosystem: flow-kit & Comet — roles, borrowing, and boundaries

flow-comet stands on two upstream projects: **flow-kit** provides the methodology and artifact system; **Comet** provides the mechanism patterns that flow-comet borrows heavily from. This document details what flow-comet depends on, what it borrows, and what it deliberately does not absorb.

## 1. flow-kit — the methodology layer (dependency)

flow-kit is a **pure-markdown methodology package** (not a tool — "clone it into the project root and it works, no runtime"). It defines the 9-stage flow, the R1-R8 behavior rules, and 13 artifact templates.

### What flow-comet depends on

| flow-kit | flow-comet usage |
|----------|------------------|
| **Stage protocols** (prompts/0-change, 1-requirement, 2-design, 3-task, 4-dev, 5-test, 6-review, 7-integration, 2a-ui-design) | The 8 nodes map onto the stage protocols (open combines 0-change + 1-requirement; 2a-ui-design is the optional frontend add-on); node skills state "flow-kit `<stage>` stage protocol" and read the flow-kit prompt files at execution time |
| **Artifact templates** (CHANGE/REQUIREMENT/DESIGN/TASK/SUMMARY/TEST/REVIEW/UAT/LESSONS/CONTEXT/…) | Artifact paths and required sections follow the templates exactly |
| **R1-R8 behavior rules** (fresh-context, artifact gates, anti-hallucination grep, destructive-change protocol, test discipline) | Rules are cited by number throughout flow-comet skills (R1.8, R4.5, R4.6, R5.1, R6.4, R6.5…) |
| **Artifact Preflight Gate** (GO.md / R2.7) | Ported as the node product-gate table (design requires CHANGE+REQUIREMENT, plan requires DESIGN, …) |
| **LESSONS knowledge base** (L-NNN entries, R1.8 scan) | Inherited with the same format and nomination rules |

### What flow-comet adds on top

- **State machine**: scripts (workflow-state/guard/handoff) own state, node routing, and advancement — flow-kit's manual discipline becomes machine-checked
- **Machine-owned fields**: currentNode/completedNodes/evidence/verifyFailures are script-exclusive; manual edits cause guard inconsistency
- **Deterministic recovery**: "files over state" — on every resume, re-derive from artifacts, never trust conversation history
- **Decision classification**: flow-kit's scattered confirmation points become a four-category decision system (user decision / automatic / stop condition / manual handoff)
- **Output Schemas**: each node binds a `flowkit.*.v1` contract in `reference/workflow-protocol.json`

### What flow-comet deliberately does not absorb

- **PROGRESS.md / STATE.md files**: cross-session state tracking is replaced by the state machine — flow-comet-dev explicitly states "TASK.md status + SUMMARY.md are the progress"; a temporary context-window snapshot (`.specs/<change-id>/<task-id>-PROGRESS.md`) remains for mid-task recovery and is deleted on completion
- **Side commands**: only evolve/health exist as separate skills; intel-scan/architect-style commands are not ported
- **Multi-IDE adapter layer** (`.windsurfrules`/`.cursorrules` installation paths)
- **Token budget tables** (flow-kit's cost modeling is not inherited)

## 2. Comet — the mechanism source (heavy borrowing)

Comet is a **resumable long-running task workflow and Skill platform for coding** (Node-only runtime; Native + Classic workflows; Skill Creator with eval and cross-platform publish). flow-comet does not depend on Comet at runtime — but **its mechanism patterns are borrowed extensively from Comet's Skill Creator**, in the form of an "absorb the artifact shape, drop the platform" approach.

### What flow-comet borrows from Comet (mechanism → flow-comet counterpart)

| # | Comet mechanism | flow-comet counterpart |
|---|---|---|
| 1 | **workflow-protocol.json as the single runtime source of truth** (schemaVersion/kind/nodes/edges/outputSchemas/state/evals) | `reference/workflow-protocol.json` — field-for-field isomorphic: kind `workflow-kernel`, 8 nodes, `flowkit.*.v1` output schemas, state with statePath/currentNodeField/completedNodesField/evidenceField |
| 2 | **Workflow Node model** (kind control/producer/action/handoff/guardrail + responsibility + requiredSkillCalls + outputSchemas + guardrails) | Node fields identical; `subagent-execute` is `handoff` kind; protection boundary preserved (open/execute/review/verify/archive only require/augment — not override; design/plan allow override) |
| 3 | **Skill Binding + enforcement levels** (guarded/handoff-guarded/evidence-only/advisory) | SKILL.md "Skill Bindings" table isomorphic |
| 4 | **Three contract-written scripts + three factory-generated scripts** (workflow-state/guard/handoff + comet-plan/check/hook-guard) | Same six scripts under `scripts/`; plus `protocol-utils.mjs` (protocol resolution, borrowing Comet's guard style) and `state-schema.mjs` |
| 5 | **determineNode / artifact-derived node detection** | `workflow-state.mjs` derives completion flags from protocol outputSchemas artifacts (`<change-id>` placeholder, required-only) |
| 6 | **guard --apply advancement + NEXT: protocol** (`NEXT: auto\|manual\|done` + `SKILL:`) | `workflow-guard.mjs entry/exit <node> --apply`; `workflow-state.mjs next` outputs `NEXT:` + `SKILL:` routing; init output is the first route |
| 7 | **Hook whitelist / fail-closed / protected paths** (before_tool + before_write descriptors, failure: block, symlink/junction detection, TOCTOU snapshot) | `comet-hook-guard.mjs` — same guard style; whitelist declared via protocol `writeWhitelist` with built-in fallback; execute narrows by executionMode (subagent/direct) |
| 8 | **Entry Skill dual-zone structure** (deterministic Auto zone: route table/Skill Bindings/Guardrails/Recovery + Authored zone: Decision Core with four mandatory sections) | SKILL.md isomorphic; Decision Core has the same four sections (auto node detection / resume rules / decision classification / Red Flags) |
| 9 | **Handoff evidence protocol** (handoff-kind nodes + subagent evidence return) | `workflow-handoff.mjs request/result/status` (writeFiles whitelist, JSON Return Contract, completedChecks validation, commitHash subset check) |
| 10 | **eval.yaml manifest** (comet.eval/v1alpha1 + qualityGates + routeConformance) | `comet/eval.yaml` isomorphic; `checks.yaml` (state_equals), `skill.yaml`, `guardrails.yaml` present (`engine.enabled: false` lives in `bundle.yaml`) |
| 11 | **bundle.yaml / resolved-skills.json / composition-report** | Isomorphic package structure (apiVersion comet/v1alpha1, SkillBundle, resources, platforms.requires) |
| 12 | **Multi-change selection semantics** (zero/one/ambiguous candidates → pause) | `findActiveChange` (state-first → `.specs/` scan; completed-first guard against archive leftovers) |

### What flow-comet deliberately does not absorb from Comet

- **Dual-projection state** (`.comet.yaml` user fields + `run-state.json` engine fields + `state-events.jsonl` audit trail): flow-comet uses a **single** `.comet/flow-comet-state.json` — no audit journal, no run/trajectory/checkpoint files
- **Native reliability stack** (mutation lock, transition journal, CAS, transactional archive, evidence freshness, repair/stagnation budgets): not adopted — the protocol state carries only currentNode/completedNodes/evidence
- **Eval platform** (pytest harness, Rubric/Pass@k/Pass^k, LangSmith, Docker isolation): flow-comet carries the eval.yaml **manifest only** (`engine.enabled: false`) — no eval runtime
- **Publish/distribute** (creator/publish/bundle backend, 33-platform installer, skill-preferences): not adopted — flow-comet is a local bundle draft
- **Context compression** (SHA256-compressed handoff packages), **auto_transition three-tier config**, **Engine Run** (deterministic step tables + completionEvals), **ambient resume probe / dashboard / doctor**: not adopted

## 3. The borrowing boundary

Comet's **eval (scientific evaluation) + publish/distribute (cross-platform distribution)** form a complete closed loop — `/comet-any create → comet eval evidence → review → publish → distribute`, with publish readiness bound to planHash/preferenceHash/current-draft-hash eval evidence/human approval. flow-comet borrows only the **creation artifact shape** (protocol, scripts, package structure, Decision Core) — evaluation and distribution remain out of scope (flow-comet is copy-installed; see [Installation](INSTALLATION.md)).

The borrowing follows a deliberate sublation principle: **absorb the mechanism's form and semantics; drop the platform machinery that requires distribution/eval infrastructure** (the same principle applied to flow-kit: absorb methodology and templates; drop files that the state machine replaces). This is why flow-comet stays a zero-dependency, copy-installable package while carrying the same mechanism DNA as Comet's Skill Creator.

## 4. One-line summary

- **flow-kit** defines *what* to produce (9-stage methodology, templates, R1-R8 rules) — flow-comet automates *how* to advance through it
- **Comet** defines *how to build workflow engines* (protocol-as-source-of-truth, script-owned state, guard gates, hook interception) — flow-comet borrows the mechanism patterns, drops the platform
