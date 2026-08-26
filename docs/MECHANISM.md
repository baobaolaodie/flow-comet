<div align="right">

[English](MECHANISM.md) · [中文](MECHANISM-zh.md)

</div>

# Core Mechanisms (behavior layer)

This document describes what flow-comet **does** — the behaviors and rules you will observe while using it. Implementation details (script logic, decision tables, historical fixes) are out of scope here.

## 1. State machine and routing (file-as-truth)

- Single-file state machine `.comet/flow-comet-state.json`; node advancement is gated by `workflow-guard.mjs exit <node> --apply`
- **determineNode**: the current node is derived in real time from `.specs/` artifacts (missing files → stop at that node); state is not fully trusted
- **auto-correction**: when state's currentNode disagrees with derivation, it is written back automatically (triggered by `next`)

## 2. Three defense layers (takeover protection)

| Layer | Mechanism | Check point |
|-------|-----------|-------------|
| ① Hook physical interception | Phase whitelist: execute/subagent-execute coordinators may only write `.specs/`; source code is written by worktree subagents (no state in their cwd → allowed) | write target path + currentNode |
| ② Coordinator prohibition | `next`/`entry` inject "you are the coordinator, not the executor" each time (direct-mode execute exempt) | output injection |
| ③ Exit takeover detection | parallel tasks done must have handoffResult, otherwise BLOCKED (`parallelTakeoverApproved` explicit exemption) | TASK.md + handoff evidence |

Hook blocking semantics (see Limitations): PreToolUse hook exit 2 blocks in the main TUI session; in `claude -p` non-zero exits are downgraded to non-blocking.

Project-root fallback chain for interception: when the session cwd drifts, the project root is anchored via `COMET_RUN_ROOT` → `CLAUDE_PROJECT_DIR` → the nearest ancestor containing either `.comet/flow-comet-state.json` or `.claude/skills/flow-comet` → cwd, so out-of-project writes keep being intercepted.

## 3. Guard validation (evidence-driven advancement)

| Mechanism | Check point | Trigger |
|-----------|-------------|---------|
| Template-derived section names | open/design exit required section names derived from `flow-kit/templates/` (built-in fallback when templates missing) | exit open/design |
| TASK signature hash | enter records task-set signature (line-ending normalized + marker attributes stripped) → exit compares: add/remove tasks, change action/boundaries → BLOCKED; marking done/adding marker attributes → legal | enter/exit execute |
| Node order BLOCK | next when currentNode not exited (non-normal successor) → BLOCKED; normal next after exit advancement exempt; rollback exempt (pending rollback task in TASK) | next |
| handoff completedChecks | subagent Return Contract must carry required-skill completedChecks (skill-load evidence), missing → BLOCKED | exit subagent-execute |
| Skill-load front gate | new changes require the node's skill-load declaration marker to exist before handoff request / record; the declaration must follow loading the skill with the Skill tool (reading the SKILL.md file is not enough) | handoff request / record |
| redEvidence ordering | redEvidence must exist before greenEvidence; recording redEvidence after greenEvidence → BLOCKED | workflow-handoff result |
| Contract payload parse failure | record / workflow-handoff result: a payload that looks like an object literal but fails JSON parsing → error with a `--json-file` hint, and nothing is written to state (fail-closed, no dirty data) | record / workflow-handoff result |
| Suspicious-object heuristic boundary | a payload starting with `{`/`[` or containing `:`/`;` is treated as a likely object literal; if parsing then fails, the operation fails closed with a `--json-file` hint — a legitimate plain-text value at this boundary is conservatively rejected (safe-side design, no dirty state) | record / workflow-handoff result |
| SUMMARY six sections | verify output / 6-dimension self-check (non-empty) / boundary check + mandatory `## 自检方法` — the 6-dimension section must declare `brooks-review` or `cache-brooks` (two-tier fallback: Skill tool → if only a "Launching skill" placeholder is returned, Read the plugin-cache protocol files and execute the full review manually); `builtin-quickcheck` appears only under `## 自检方法` with the unavailable reason AND the cache-attempt evidence (new changes blocked; legacy warned) | exit execute |
| Disposition markers | REVIEW.md findings must carry a disposition marker (fixed/upgraded/deferred; new changes blocked; legacy warned) | exit review |
| builtin self-check evidence | `builtin-quickcheck` must state the unavailable reason AND the plugin-cache attempt (new changes blocked; legacy warned) | exit execute |
| Artifact template fidelity | SUMMARY / TASK / CHANGE / REQUIREMENT / DESIGN must keep the template title, header fields, and section order; new changes missing any part are blocked with recovery guidance, legacy changes warned | exit execute / plan / open / design |
| Wave-wording consistency | prose `[P]` markers must match task `parallel="true"` (new changes blocked; legacy warned) | exit plan |
| Wave grouping consistency | grouping validity is decided by the dependency graph, not by block position: acyclic `depends_on` with every referenced task present is legal; interleaved parallel/serial sequences are allowed and are consumed pass-by-pass by multi-pass routing in dependency-topology order; only a dependency cycle or a missing dependency reference blocks — new changes BLOCK with `depends_on` adjustment guidance, legacy changes WARN | exit plan |
| Pseudo-parallel advisory | when a parallel task declares only test files in its writes, the plan exit emits a non-blocking warning (task id + suggestion: declare an explicit `depends_on` or merge into a vertical slice) | exit plan |
| Overreach delegation | parallel done tasks require the delegation node exited (new changes blocked; legacy warned) | exit execute/verify |
| verify real execution | TEST.md `## 验证命令` actually runs (multi-line `&&` supported); verifyFailures machine-counted **per change** (switching changes does not carry over another change's count), 4th → BLOCKED (timeout configurable via `FLOW_COMET_VERIFY_TIMEOUT_MS`, default 300s) | exit verify |
| Append placement | CONTEXT orphan sections / LESSONS numbering-out-of-order / STATE+CHANGELOG non-reverse-order → WARN (progressive) | exit open/verify/archive |
| Task completion artifacts | every `done` task must have a matching `<id>-SUMMARY.md`; missing → progressive WARN (artifacts incomplete — the task claims done without its summary) | exit execute |
| Pre-delegation check | uncommitted artifacts in `.specs/<change>/` → WORKTREE WARN; PROGRESS.md present → recovery warning | entry execute |
| state schema validation | writeState field types fail-closed (state-schema.mjs single source, shared by three scripts) | all state writes |

## 4. Execution model (subagent-based)

- **Return Contract**: subagents return `{status, commitHash, redEvidence, greenEvidence, completedChecks, riskSignals}` — missing commitHash/greenEvidence/completedChecks → BLOCK; missing redEvidence → progressive WARN; redEvidence recorded after the fact → BLOCK
- **handoff hash provenance**: `git show <commitHash>` verifies committed files ⊆ write_files (auto-parsed from TASK.md, XML comments stripped)
- **Zero-commit tasks**: a request-side empty `write_files` list (or request-side `noCommit` marker) classifies the task as zero-commit — results skip the commit-subset check with an auditable prompt; zero-commit results carrying tracked files are blocked on new changes and warned on legacy changes
- **write_files conflict detection**: parallel tasks may share a wave only if their write_files do not overlap
- **Multi-pass routing**: interleaved parallel/serial task sequences are valid under dependency semantics — the delegation node can be entered multiple times, each pass delegating every dependency-satisfied parallel task in dependency-topology order; serial tasks waiting on later passes are a legal intermediate state

## 5. Recovery protocol

- Any-entry recovery: determineNode derives from files + state auto-correction (no conversation history needed)
- PROGRESS.md recovery warning (R1.6 anti-repetition)
- Branch-state consistency check
- `advance` escape hatch: for structural deadlocks with no routine recovery action, `workflow-state.mjs advance` forces advancement (you must re-enter the node and redo the delivery records afterwards); not for ordinary missing-artifact/missing-evidence cases

## 6. Guard self-test suite (author regression baseline)

`scripts/guard-self-test.mjs`: **197 scenarios** covering entry/exit validation positive/negative cases (branch checks, append-placement detection, custom protocols, composition scenarios, automatic initialization detection) — together with `system-test.mjs` (67 items, real command sequences across all mechanism surfaces) they form the two-tier regression baseline after every change (script-logic self-test in a sandboxed environment; **not** an installation verification criterion):

```bash
node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs
# → ALL 197 SCENARIOS PASSED
```

## 6.5 DeepSeek Harness (dsh) platform

On DeepSeek Harness, flow-comet is installed through the **prepare-env installer** (`--platform dsh`) — no plugin bundle, no npm package (a later / 1.5.0 item); the engine itself is untouched, the guard decision core is reused unchanged via subprocess calls:

- **Installation**: `node scripts/prepare-env.mjs --target <project> --platform dsh` (minimum dsh `0.1.0-rc.6`; dev preview).
- **Project-level skill discovery**: the skill tree is installed at `<project>/.dsh/skills/flow-comet`; dsh auto-discovers skills under `<project>/.dsh/skills/` at rank 100 (file watching, no restart) — projects **without that directory cannot see the skill**, so activation is naturally project-level (no runtime trace detection, no chicken-and-egg).
- **Interception**: a thin bridge loader mounted globally at `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` (managed block in `$DSH_HOME/cordis.patch.yml`, effective for all profiles) listens on dsh's `tools/pre-execute` waterfall event, maps tool arguments to the same guard contract (`Write`/`Edit` → `file_path`, `Bash` → `command`), calls the project-local `comet-hook-guard.mjs` in a child process, and returns `{kind:'deny', reason}` (BLOCK message + recovery guidance) for out-of-scope writes while the flow is running; shape mismatches and abnormal exits fail closed. On Windows 8.3 paths the project root is canonicalized to its long form before the guard decision, preventing the guard's lexical path resolution from skipping the whitelist (fail-open).
- **Activation scope**: the bridge only engages when the session project root contains `.dsh/skills/flow-comet` (narrow listening) — non-flow-comet projects are untouched.
- **Executor passthrough**: when the coordinator delegates tasks to subagents, the delegated agent (identified by the session's subagent delegation depth) writes source code as the executor and bypasses the phase whitelist — matching the worktree-isolation semantics of the other platforms — while the coordinating agent remains subject to the whitelist. Out-of-project writes and malformed tool arguments stay denied for both while the flow is running.
- **Containment is active only while the flow is running**: in the idle state (no state / no `activeChange` / `completed`) writes outside the project root are allowed; parse failures or unknown workflow status stay fail-closed (deny).
- **Managed rule injection**: installation injects the orchestration rule into `AGENTS.md` inside the `<!-- Managed by flow-comet prepare-env -->` block (non-destructive merge, marker shared with Codex).

## 6.6 Installer behaviors (flow-kit acquisition, loader lifecycle, bridge-check)

`prepare-env` extends the install with flow-kit acquisition, dsh loader lifecycle reporting, and a read-only bridge health check:

- **flow-kit acquisition (five states)**: before the platform loop the installer ensures `<target>/flow-kit/` — missing → clone the upstream and check out the locked snapshot commit `9b5dda7`; existing upstream clone (`.git` present with a matching `origin` remote) → read-only HEAD-vs-lock comparison and impact report (never modified); existing same-name non-clone directory (or an unreadable origin) → skip with manual guidance; clone/checkout network failure → WARN + manual guidance, install continues (exit 0); purge never includes `flow-kit` (including `--purge --yes`).
- **dsh loader version transitions**: the bridge loader carries an embedded version stamp (`// BRIDGE_VERSION: <version>`); each dsh install compares the authoritative stamp with the installed loader's stamp before overwriting and reports first install / upgrade `A → B` / downgrade `A → B` / version consistent.
- **bridge-check (read-only)**: `workflow-state.mjs bridge-check` runs a zero-write, zero-network health check over the dsh bridge with six states — healthy (exit 0), file missing / not mounted / version skew / duplicate registration (exit 1), and not applicable (exit 0, project without the dsh platform copy). Unrecognized YAML shapes produce approximation warnings (warn without deciding — never a false fail); only explicit mismatches force a non-zero exit.

## 7. Automatic initialization detection (init pre-step)

On `init`, the workflow automatically detects whether a project context (`.specs/CONTEXT.md`) exists and classifies the project (A~F):

- **A/B**: a context decision was recorded or the context is fresh (≤ 90 days) → fully silent
- **C**: context exists but the last scan is older than 90 days → hint only (non-blocking)
- **D**: no context + existing AI-context documents (CLAUDE.md / AGENTS.md / .cursor / .windsurf / Copilot / Cline) → prompt listing them; on approval, reads and integrates them with source attribution (`from <doc>:<line>` + a source-documents section) — **existing files are never modified**
- **E**: no context + code present → prompt; full generation on approval (dependency/directory probing fills the tech-stack and abstraction sections)
- **F**: greenfield (no code context) → prompt; skeleton generation on approval

Explicit parameter authorization (no blocking prompts, headless-safe): `--init-context` runs the full generation (≈15-30k tokens, first use only, stated in the prompt); `--init-skip` records `ai_context_doc: none` and silences future prompts. Project-level fields (`ai_context_doc`, `last_intel_scan`) persist across changes; state-schema validates them (fail-closed, legacy states default to null).


## 8. Execution-omission protection

- **Node entry evidence**: entering a node records it; exiting a node that was never entered — blocked on new changes (entry checks must not be skipped: coordinator prohibition, pre-delegation commit check, signature recording), progressive warning for legacy changes.
- **New-change enforcement**: changes created via `init` are marked new (`newChange`) and enforce all content-level checks as blocking — completed tasks require their matching summary, handoff results require TDD RED evidence, disposition markers, builtin self-check evidence, wave-wording consistency, overreach delegation, and append placement; legacy changes keep the progressive warnings.
- **Declaration automation**: for legacy changes `record` auto-fills missing skill-load declaration markers as a fallback; new changes require the node's declaration markers to exist first (the skill-load front gate blocks handoff requests and records without them).
- **Explicit empty-exit exemption**: execute may exit with no serial tasks when explicitly declared (`emptyExitApproved`); otherwise blocked by default.

## Design principles

- **File-as-truth, no event sourcing**: single-file state machine + node derivation from `.specs/` — simple, recovery never depends on history
- **Structural validation, no semantic judgment**: guard checks "filled or not" (sections/non-empty/structure); "good or not" is left to review — light validation, few false positives
- **Detect + correct, not intercept**: agents cannot truly be prevented from editing files directly; machine fields rely on detection and auto-correction
- **State stays out of version control**: `.comet/` is gitignored — branch switches share one working-tree state, avoiding state divergence
- **One change at a time, no forced PR**: a single active change keeps the state machine simple; PR review is opt-in

## Limitations

- **Platforms**: Claude Code (default), Codex (skills/rules/hook via the multi-platform installer), and DeepSeek Harness (dsh — project-level skill + global bridge loader via `prepare-env --platform dsh`, see [Installation](INSTALLATION.md#option-c--deepseek-harness-dsh-platform)) are supported; other platforms (Gemini/Cursor) not guaranteed
- **Return Contract transition rule**: legacy pure-string handoffs are exempt as WARN; missing redEvidence/greenEvidence is progressive WARN (not BLOCK) to avoid blocking legacy change re-entry
- **Not interoperable with Comet Classic**: workflow-kernel state is independent of classic (design decision, not a defect)
- **Hook allows writes when no active change**: when `.comet/flow-comet-state.json` is absent, the hook guard allows all writes (design decision: no workflow, no write restrictions)
- **Hook blocking semantics**: exit 2 (blocking) is verified working in the main TUI session; in `claude -p` (SDK CLI mode) non-zero exits are downgraded to non-blocking — writes logged but not prevented
- **Worktree mount dependency**: Agent `isolation: "worktree"` worktrees mount at the **session project root** (not the subagent's target project) — cross-repo artifacts need manual `git show <branch>:<path>` transport, and the commit-file provenance check (`git show` subset validation) is degraded in that case
- **GUIDANCE not tracked by the authoring record**: `<skill>-GUIDANCE.md` and SKILL.md reference lines are not recorded in the authoring manifest; re-running the Skill generator tool clears them
