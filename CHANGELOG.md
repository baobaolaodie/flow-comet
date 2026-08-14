<div align="right">

[English](CHANGELOG.md) · [中文](CHANGELOG-zh.md)

</div>

# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/). Versions are recorded in git tags, this document, the README badge, [docs/VERSIONS.md](docs/VERSIONS.md) and the authoritative `skills/flow-comet/INSTALLED_VERSION`; `bundle.yaml` version stays 1.0.0 (decoupled from release versioning).

## Unreleased

### Changed

- **Documentation overhaul**: skill instructions deduplicated (generator-template remnants and mid-file frontmatter removed), Comet-positioning claims replaced with flow-comet's own mechanism descriptions, per-node guardrail tables aligned with the actual guard implementation (unimplemented items now marked as review-checked execution discipline), dual-platform (Claude Code / Codex) adaptation for brooks-lint invocation, user entries, and installation docs, the regression baseline promoted to the two-tier suite (guard self-test + system test) across all docs, and timeliness updates (roadmap state, design-doc backfill, archived handover notes).

### Changed

- **Execution-omission protection**: node entry is now recorded (exit warns if a node was exited without entering it); completed tasks require their summary for new changes (blocked — legacy changes keep the progressive warning); handoff results require TDD RED evidence for new changes; record auto-fills skill-load declaration markers; execute gains an explicit empty-exit exemption; init detects commit-less repositories.

### Fixed

- Skill commands that lacked the install-path prefix now carry the authoritative-source path — executable on both platforms after installation.
- Process-code detection regex now covers 1-3 digit scenario numbers (previously only two digits); the doc-scanner regex is back in sync with the single source; POSIX hook files get their executable bits set at install time.
- CI bilingual-mirror check now covers SECURITY (CoC excluded by design, matching the local checker); the version-expected extraction no longer relies on a dead fallback.
- Bundle metadata aligned: skills list, references, and script side effects match the actual distribution.

## [1.4.0] - 2026-08-13

Multi-platform installer framework, platform modularization, and real-artifact examples. ([#45](https://github.com/baobaolaodie/flow-comet/pull/45), [#46](https://github.com/baobaolaodie/flow-comet/pull/46), [#47](https://github.com/baobaolaodie/flow-comet/pull/47), [#48](https://github.com/baobaolaodie/flow-comet/pull/48), [#50](https://github.com/baobaolaodie/flow-comet/pull/50))

### Added

- **skill-load declaration mechanism**: subagents declare loaded workflow skills per node; record validates declarations against the protocol's required skill calls; exit checks protocol declaration markers; cross-consistency timestamp checks; backward compatible with legacy changes.
- **Installed version marker**: `prepare-env` writes `<project>/.claude/skills/flow-comet/INSTALLED_VERSION` from the source repo's git state (`1.4.0` on a release tag; `1.4.0-N-g<hash>` on accumulated dev) so issues and PRs can state the exact version — including how far dev has accumulated since the last release.
- **Local commit/push hooks**: `install-commit-hook.mjs` sets up commit-msg and pre-push hooks that reject messages carrying process codes (this project's own convention, not a universal list).
- **Multi-platform installer framework**: `prepare-env` now targets Claude Code (default, unchanged) or Codex via a platform-descriptor table — interactive platform selection (TTY) with an explicit `--platform` override and automatic detection of an existing `.claude/` / `.codex/`; skills install to each platform's native location (`.agents/skills/` for Codex, auto-discovered); SKILL/GUIDANCE command paths are rewritten at install time for non-default platforms (authoritative source stays in `.claude` form); Codex rules are injected into an AGENTS.md managed block (Codex's `rules/` directory serves command-approval policies, not instruction files); the write-guard hook gains full Codex adaptation — Codex PreToolUse intercepts Bash tool calls, the hook parses write targets from the command (PowerShell cmdlets, .NET File API, redirection) and denies out-of-scope writes via `{"decision":"block"}` (measured on Codex CLI 0.146.0; trust the hook on first use via `/hooks`), while the Claude Code output stays unchanged.

### Changed

- **Regression suite expanded to 134 scenarios**: `init` rejects unknown flag-like arguments (e.g. `--help`) instead of treating them as a change name; covering skill-load declarations, record validation, exit protocol checks, cross-consistency timestamps, legacy compatibility, review finding disposition, artifact completeness, delegation attribution, recovery guidance, and wave-wording consistency.
- **CI**: process-code checks moved from the server-side PR policy to local hooks; PR/issue templates reworked for practice (deduplicated checkboxes, related-issue section, based-on version, protocol and installed-version fields).
- **Commit history made jargon-free**: 52 historical commit messages rewritten to plain descriptions (tree unchanged); duplicate commits deduplicated.
- **Docs**: README reorganized (quick start moved up) with recognizable anchors (GSD link, pain-point intro, fit boundary); installation guide gained an uninstall section; release checklist deduplicated to a single source; terminology unified across docs.
- **System test suite expanded to 50 items** (installer version-marker check, multi-platform installer scenarios: Codex install smoke, hook platform contract, platform selection chain, purge semantics, platform-descriptor-driven install smoke).
- **Merge gate changed to CI status checks**: branch protection no longer requires an approving review (single-account repo cannot self-approve); required checks are the CI jobs; bot reviewers (CodeRabbit / Sourcery) are advisory — contributing guide gains a bot-reviewers section (advisory-only, threaded replies, resolve before merge).
- **Examples rebuilt from a real archived run**: `docs/examples/` now carries the complete artifact set of a real 8-node change (processor-pipeline, run in the e2e fake project) — six-section summaries, review findings with disposition markers, skill-load declaration markers, actually-executed verify; the simulated example and outdated artifact screenshots were removed, and the README showcase now points at the real artifacts.

### Fixed

- Artifact-path derivation respects protocol `pathBase` (custom protocols with project-root artifacts now advance correctly); fail-fast for unsupported roots.
- Done tasks require matching per-task summaries (progressive warning, not block).
- Overreach detection for delegated parallel tasks (execute and verify exits).
- Recovery guidance added to blocked messages (advance / select / record).
- Wave-wording consistency: prose marking a task parallel without the matching task attribute warns progressively.
- `init` command rejects arguments starting with `--` (e.g. `--help`) — previously treated as the change name, which auto-created a change, a branch, and state.
- dev-main sync check: files deliberately deleted on dev (e.g. the template md → forms migration) no longer counted as drift.

## [1.3.1] - 2026-08-11

Documentation and CI maintenance release — no behavior changes. ([#31](https://github.com/baobaolaodie/flow-comet/pull/31), [#33](https://github.com/baobaolaodie/flow-comet/pull/33), [#34](https://github.com/baobaolaodie/flow-comet/pull/34), [#35](https://github.com/baobaolaodie/flow-comet/pull/35), [#36](https://github.com/baobaolaodie/flow-comet/pull/36), [#37](https://github.com/baobaolaodie/flow-comet/pull/37))

### Added

- README run-demo section with real screenshots (bilingual); flow-kit introduction and comparison with alternatives (bilingual).
- TROUBLESHOOTING entries for the 1.3.0 initialization messages (INIT-GENERATE / VALIDATE-FAILED / DONE, bilingual).

### Changed

- CI: dev-main sync check is now tree-level and one-directional (only files main added count as dev behind — fixes false positives after squashed releases); branch-prefix allowlist gains `ci/`; commit-message convention check applies to development PRs only (release PRs carry accumulated history by design); actionlint upgrade with weekly canary job.
- CHANGELOG scenario count corrected 95 → 97 to match the implementation; bilingual wording cleanups across CONTRIBUTING / INSTALLATION / USAGE.
- Regression suite self-check list now includes CHANGELOG (prevents stale scenario counts in entries); regression mapping comment corrected to the actual count.

## [1.3.0] - 2026-08-10

Automatic project-context initialization (init pre-step). ([#30](https://github.com/baobaolaodie/flow-comet/pull/30), [#32](https://github.com/baobaolaodie/flow-comet/pull/32))

### Added

- **Automatic initialization detection**: on first use in a project, the workflow automatically detects whether a project context (`CONTEXT.md`) exists and prompts to initialize it when missing — existing AI-context documents (such as `CLAUDE.md` / `AGENTS.md`) are read and integrated with source attribution (existing files are never modified); projects with a fresh context run silently. No separate command to remember.
- **Agent-assisted generation protocol**: `init <id> --init-context` is now a collaboration — the script performs deterministic detection, decision, prompting, and validation, while the agent reads existing documents and probes the codebase to generate a template-aligned `CONTEXT.md` (seven sections, source-attribution citations, accumulated glossary/decisions/defaults preserved); the script validates the seven sections plus key template formats (dated decision entries, metadata fields, glossary table) and records the scan timestamp only after validation passes. A re-run after generation completes the handoff.
- **Template-aware guidance**: the generation prompt reports whether the flow-kit CONTEXT template is detected and validates section names against it (built-in fallback when the template is missing).
- **Scenario-count consistency check**: the regression suite now fails when public docs' scenario count drifts from the actual suite size.
- guard self-test suite expanded to 97 scenarios covering detection prompting, generation guidance, validation pass and fail, placeholder tolerance, and guidance wording.

### Fixed

- The freshness hint no longer shows "null days" when no scan record exists (legacy projects) — it points to the exact next action instead.
- Refreshing project context preserves accumulated CONTEXT content (glossary / locked decisions / defaults) instead of overwriting it.
- New-project skeleton CONTEXT (placeholder sections) passes validation instead of being rejected.
- Re-running `init` with an existing change id warns before resetting progress (protection against accidental progress loss).
- Agent-generated CONTEXT entries in the wrong format (e.g. backtick-wrapped dates) are caught by format validation with a precise rewrite hint.

## [1.2.4] - 2026-08-09

Documentation and message cleanup — public-facing content uses plain descriptive language throughout.

### Changed

- **Public-facing content cleanup**: commit-message convention now requires plain descriptions (no codes, numbers, or jargon — commit messages, PR titles, and CHANGELOG follow the same standard); script comments, scenario names, and runtime warning messages cleaned of process codes; behavior unchanged (82/82 regression + real-run verification).
- **CHANGELOG entries now link their release PRs** (Keep a Changelog practice — public traceability; v1.2.1~v1.2.3 entries backfilled).
- Contributing guide gains the plain-language convention for public artifacts. ([#14](https://github.com/baobaolaodie/flow-comet/pull/14), [#15](https://github.com/baobaolaodie/flow-comet/pull/15))

## [1.2.3] - 2026-08-09

Worktree delegation chain fixes (real-run report). ([#12](https://github.com/baobaolaodie/flow-comet/pull/12), [#13](https://github.com/baobaolaodie/flow-comet/pull/13), [#14](https://github.com/baobaolaodie/flow-comet/pull/14))

### Fixed

- **route diagnostic**: when TASK.md task tags carry `parallel="true"` without `status="pending"` (old template shape), the router now emits a `ROUTE WARN` explaining the required attribute order — structural validation stays strict, failures are visible instead of silently stalling in execute.
- **C4 check visible**: the worktree dirty-check catch block now prints `C4-CHECK SKIP: <reason>` (previously silently swallowed — Windows git-command failures were invisible).
- **WARN COUNT summary**: entry/exit output ends with a `WARN COUNT: N` summary line (appended; existing output unchanged).
- **Empty-exit documentation aligned with implementation**: the execute SKILL no longer claims an "empty exit" path (guard blocks it in three layers: evidence → serial pending → output-schema artifacts); documented correct paths (direct routing to subagent-execute / explicit `parallelTakeoverApproved` exemption).
- **Pre-delegation checklist**: subagent-execute SKILL now mandates a pre-delegation checklist (git status / HEAD / inline context) with a Red Flag; dirty-worktree protocol marked as mandatory before delegation.
- guard self-test suite expanded to 82 scenarios (RED→GREEN with correct failure reasons, verified by an independent reviewer with 24 independently constructed assertions).

### Changed

- Troubleshooting gains new entries (ROUTE WARN / C4-CHECK SKIP / WARN COUNT, bilingual); scenario counts 77→82 synced across all public docs (historical changelog entries unchanged).

## [1.2.2] - 2026-08-08

Self-review two-tier fallback for the 6-dimension check (brooks-lint). ([#8](https://github.com/baobaolaodie/flow-comet/pull/8), [#9](https://github.com/baobaolaodie/flow-comet/pull/9))

### Fixed

- **Two-tier fallback for brooks-lint**: when the Skill tool returns only a "Launching skill" placeholder (worktree subagent skill routing is unstable — plugin content may not be injected), the subagent now Reads the plugin-cache protocol files and executes the full brooks review manually (`selfReview: cache-brooks`) before falling back to the built-in R1~R6 quick check. Review quality is preserved even when loading fails.
- **Guard validates fallback evidence**: a `builtin-quickcheck` declaration must now state the unavailability reason **and** the cache-attempt evidence (missing either → progressive `BROOKS-LINT WARN`, never BLOCK).
- **Guard recognizes `cache-brooks`**: method/whole-content/six-dimension patterns updated — a clean `cache-brooks` declaration passes without WARN (previously mis-blocked).
- guard self-test suite expanded to 77 scenarios (builtin evidence checks + cache-brooks acceptance; RED→GREEN with correct failure reasons, verified by two independent reviewers).

### Changed

- Troubleshooting gains the new WARN entry (bilingual); public MECHANISM (bilingual) documents the two-tier fallback behavior layer; scenario counts 74→77 synced across all public docs (README/INSTALLATION/MECHANISM/VERSIONS/CONTRIBUTING — historical changelog entries unchanged).

## [1.2.1] - 2026-08-08

Installation-guide fixes (init/hook/state fixes + README guidance fixes + independently verified fixes). ([#1](https://github.com/baobaolaodie/flow-comet/pull/1), [#4](https://github.com/baobaolaodie/flow-comet/pull/4), [#6](https://github.com/baobaolaodie/flow-comet/pull/6), [#10](https://github.com/baobaolaodie/flow-comet/pull/10))

### Fixed

- **init state gains `status: 'running'` + three-tier hook semantics** : init previously did not write `status`, and the hook allowed writes on undefined-status state — the first defense layer was ineffective during open (before the first guard exit); archived `completed` states were also blocked from all writes. After: running (including legacy states without status but with activeChange — fail-closed backward compatible) → whitelist validation; completed → allowed
- **init creates `.specs/<id>/` directory** : previously `next`/`status` reported "No active change. Run: init" after init (findActiveChange requires the directory), contradicting the SKILL startup protocol
- **findActiveChange skips fallback scan on archived-complete state** : leftover archive directories (with TASK.md copies) are no longer misdetected as active changes
- **init currentNode follows the protocol's first node** : no longer hardcodes `open` when a custom protocol starts elsewhere
- **record strips `--protocol` from payload** : stripped before JSON parsing, preventing structural fields from being lost on parse failure
- **Custom-node coordinator-default whitelist** : undeclared non-built-in nodes default to `['.specs/']` (writing source code requires explicit declaration) — closes the fail-open gap
- **Legacy state without activeChange is allowed** : legacy states (no status + no activeChange) are no longer fully blocked by the hook
- **writeWhitelist supports the `<change-id>` placeholder** : protocols reuse across changes with automatic adaptation
- **init output NODE follows the protocol's first node** : consistent with state.currentNode (previously hardcoded open)
- **findActiveChange checks completed first** : archived-complete states with a residual activeChange are no longer misdetected
- **hook statePath falls back to default** : minimal-schema protocols (no `state.statePath`) no longer crash
- **Three scripts tolerate UTF-8 BOM in JSON.parse** : state/evidence files written by external tools (e.g. session Write) with BOM parse normally
- guard self-test suite expanded to 74 scenarios (full positive/negative cases + independent-verification scenarios + BOM tolerance)

### Changed

- **README installation verification** now has four steps (structure / config loadability / authoritative-source diff consistency / real-environment smoke test) — `guard-self-test` marked as the **author regression baseline** (script-logic self-test; does not depend on installation completeness; not an installation verification criterion)
- README Quick Start gains the flow-kit prerequisite hint and a new-session hint; Requirements gains a flow-kit verification step; settings injection documents first-time vs existing-file cases; hook command documents the project-root resolution base
- **SKILL startup protocol documentation corrected** : init output is the first route (NODE: open / protocol first node); `next` is used after a node exits
- **README restructured into multi-document layout** (bilingual): README index + docs/ (INSTALLATION/USAGE/PROTOCOL/MECHANISM/TROUBLESHOOTING/VERSIONS) + compose example; VERIFICATION.md removed from the public repo (verification records are out of scope for the public repository)
- **hook blocking semantics confirmed by measurement**: main TUI session blocks writes (physical interception); `claude -p` (SDK CLI mode) downgrades to non-blocking (log-only)

## [1.2.0] - 2026-08-08

> Historical version from before the PR workflow existed — no PR link available.

Custom skill composition (flow-comet-compose) + protocol parameterization + non-destructive installer.

### Added

- **flow-comet-compose guidance skill**: interactively composes any installed skill (superpowers/brooks-lint/custom) into a custom protocol JSON, driven by the same engine (state routing + guard validation + hook interception); does not replace the built-in 8-node protocol
- **Protocol parameterization**: `resolveProtocol` priority (`--protocol` CLI → `FLOW_COMET_PROTOCOL` env → default `reference/workflow-protocol.json`); `determineNode` data-driven — node declarations come from the protocol JSON (ADR-001)
- **Specialization validation bound by node id**: the general defense layer is protocol-agnostic (all protocols physically validated); specialization fires only for built-in node ids, never for custom ids (ADR-002)
- **writeWhitelist declaration**: protocols may declare hook write whitelists; parse failures fall back to the built-in table (fail-closed, no whitelist gaps)
- **prepare-env installer**: generates/overwrites the target project's `.claude/` (rules + skills + settings injection) from `.comet/bundle-drafts/flow-comet/`; settings use read-merge-write idempotent injection (preserving `permissions` etc.); `--purge --yes` for explicit destructive rebuild
- **Configurable branch prefix**: `--branch-prefix` customizes the change branch prefix (default `change/`)
- guard self-test suite expanded to 54 scenarios (custom protocols / composition / node-element validation / exemption tightening / hook-declaration fail-closed / branch-prefix positive-negative)

### Changed

- **Single authoritative source**: removed the `.comet/bundles/` dual directory (comet needs eval/publish distribution; flow-comet is copy-install only — single source `bundle-drafts/`); README installation now uses prepare-env (option A) + manual copy (option B), comet bundle distribution flow removed
- **prepare-env non-destructive**: overwrites only generated files (rules/skills) + settings injection by default; no longer unconditionally deletes the target `.claude/`

### Fixed

- **record overwriting handoff triggers takeover BLOCK** : record that replaces an evidence key wholesale is BLOCKED
- **Node ordering/completion markers**: completedChecks validation, skipped-node BLOCK 
- **redEvidence ordering** : redEvidence must precede greenEvidence
- **next false-block fix** : exempt-node mis-block corrected
- **hook declaration fail-closed**: protocol hook-declaration parse failures fall back to the built-in table (audit supplement)

## [1.1.0] - 2026-08-05

> Historical version from before the PR workflow existed — no PR link available.

Change branches + PR review + append-placement discipline + documentation rewrite.

### Added

- **Change branch mode**: `init` auto-creates the `change/<id>` branch; the whole flow runs on it; archive wraps up with merge + branch deletion
- **PR review**: `config set enablePrReview true`; push branch + create PR before archiving, merge after approve
- **Branch-state consistency check**: `status`/`next` detect branch/activeChange mismatch → WARN (not BLOCK)
- **Append-placement discipline and structural detection**: CONTEXT terms/decisions inserted into existing sections, LESSONS inserted by L-NNN into the entries section, STATE decision log inserted at top (reverse order), CHANGELOG table inserted at top, rollback fixes appended to `## Fix 任务`; guard detects (orphan sections / numbering disorder / outside entries / non-reverse order) as progressive WARN
- guard self-test suite expanded to 23 scenarios (branch checks + append-placement positive-negative)

### Changed

- README fully rewritten as a complete product document (ecosystem / quick start / workflow overview / artifacts / core mechanisms / design principles / troubleshooting / versions)
- state-schema gains `branchMode` / `enablePrReview` field validation (boolean)

### Fixed

- LESSONS disorder detection split by section: multi-section numbering (`## 活跃条目` / `## 已解决条目` independent numbering) no longer false-positives

## [1.0.0] - 2026-08-04

> Historical version from before the PR workflow existed — no PR link available.

First stable release (8-node workflow + three defense layers + guard validation, verified end-to-end in real projects).

### Added

- 8-node auto-routed workflow (open → design → plan → execute ⇄ subagent-execute → review → verify → archive)
- Own state machine (`.comet/flow-comet-state.json`) + determineNode file derivation + auto-correction
- Three defense layers (hook phase whitelist / coordinator prohibition / exit takeover detection)
- Guard validation system: template-derived section names, SUMMARY six sections + mandatory self-check method, TASK signature hash, real verify execution, verifyFailures counting, state schema validation (fail-closed)
- Subagent-based execution engine + executionMode (subagent default / direct escape hatch) + Return Contract + handoff hash provenance
- Side commands (flow-comet-evolve / flow-comet-health) + express downgrade path
- guard self-test suite (17 scenarios) + end-to-end real-project verification (new and existing projects)
