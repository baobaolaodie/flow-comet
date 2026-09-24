<div align="right">

[English](CHANGELOG.md) · [中文](CHANGELOG-zh.md)

</div>

# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/). Versions are recorded in nine places, kept in agreement by CI on the release surface: the release git tag; the README badge, [docs/VERSIONS.md](docs/VERSIONS.md) and this changelog, each in both languages; the authoritative `.flow-comet/skills/flow-comet/INSTALLED_VERSION`; and the npm package's `package.json` `version`.

## [Unreleased]

### Changed

- **The installer's messages use the tool's name**: the output prefix came from the script's own file name, so a command typed as `fcomet` reported every step under a name the user never used — and the usage line in the same output already said `fcomet init`, leaving one command with two names on one screen. The prefix is now `flow-comet`, which matches the tool however it is invoked (the packaged command, its alias, or the script in a repository clone).
- **The orchestration instructions installed into projects no longer carry stale wording or a non-entry**: the opening line described a "bundle" and a "portable control plane" — vocabulary this project dropped when it moved away from its predecessor's layout — and the script list included a two-line compatibility shim that is not an entry point to anything. The opening line now says plainly what the file is, and the shim is no longer advertised. A check keeps that text, which every project loads automatically, free of both.
- **The regression suite now checks the maintenance documents**: the self-test suite validates that references in the maintenance documents resolve and that the roadmap keeps its four sections (it skips where those documents are absent, as in a CI checkout), so drift that CI structurally cannot see is caught locally. The regression suite now runs 258 scenarios and the system test suite 78 items.
- **The documentation now matches the shipped behaviour**: the install guide no longer points at a retired state file or command; the npm channel is described as published; the release checklist includes the npm publish and GitHub Release steps; the Codex section describes serial delivery instead of manual worktree delegation; the force-push rule states its scope; and the Comet badge now carries a boundary note (the two projects no longer share files).
- **Repair batches now run through the execution lifecycle**: when the review or verify node reports defects, the follow-up work is routed back into the execution node and the reposition is recorded in the workflow state, so that node's four exit gates are actually evaluated — every task complete, every task summary present, the self-review evidence declared, and the task set unchanged since entry. Once the repairs pass, the workflow returns to the node that reported the defects and runs that node's own exit gate before continuing, instead of skipping it because its report already exists.
- **Repair-return audit lines are distinguishable again**: when a repair cycle re-enters the execution family and then returns control to the node that reported the defects, the printed line is classified by cause — a genuine repair batch keeps the dedicated repair label, while an ordinary multi-pass close-out prints a neutral return line instead of borrowing that label; a state without enough recorded evidence to tell the two apart prints the neutral line marked unclassified rather than guessing, and the line that keeps a source node in place so its own exit can run is always neutral. Routing, completed nodes and state writes are unchanged; only the audit text differs.
- **A delivery whose declared outputs are empty or all ignored can close without a commit**: a delegated task whose declared outputs are empty, or every one of them is covered by the repository's ignore rules, can now be handed off legally with no commit — the result may omit a commit hash and no handoff error is produced. Anything that cannot be proven to belong to that class still runs the full commit-subset check, and a result that claims no commit without that proof is rejected on a new change (warned on a legacy one), so the accepted form does not open a way around that check.
- **Checks that cannot apply on an installed copy say so explicitly**: the loader version-stamp check that only the authoritative source tree can run now reports "not applicable" when the suite runs from an installed copy, instead of returning silently and being counted as passed; the runner asserts a machine-readable outcome marker on both sides, so a missing or mismatched marker fails the check rather than slipping through.

### Fixed

- **The version marker no longer borrows the host repository's tags**: when the installer's own directory is not a repository root — the shape you get from a local package install, where the package sits under `node_modules/` — the version lookup walked up to the enclosing repository and reported *its* tag. That wrong value was both the answer to `--version` and the marker written into the project being installed, so an installed project could carry a version that belongs to something else. The lookup now trusts the repository only when the installer's directory is the repository root itself, and falls back to the version shipped inside the package otherwise. It also no longer lets the underlying git probe print its own error when there is no repository at all.
- **A repair batch can no longer be closed out from the reporting node directly**: the old path — staying on the node that reported the defects and exiting it there — is rejected with recovery guidance. It let the repair work skip the execution node's lifecycle entirely, so its four exit gates were never evaluated and produced no error, while the reporting node's own gate could still be skipped because its report already existed; the accepted route is now through the execution node and back through the reporting node's exit gate.

## [1.5.1] - 2026-09-14

Installer command-surface fix: a bare `fcomet` with no arguments no longer installs into the current directory (it prints its usage and exits non-zero), and `--version` / `-v` report the installed version instead of failing as an unknown argument. ([#103](https://github.com/baobaolaodie/flow-comet/pull/103))

### Added

- **The installer answers `--version`** (and `-v`): it prints the version identifier from the same source that ships inside the package and is written into installed projects, so the version of a global install can be checked without going through the package manager. Previously only `--help` was handled, and asking for the version exited non-zero with an "unknown argument" error.

### Fixed

- **A bare `fcomet` no longer installs into the current directory**: with no arguments at all the command now prints its usage and exits non-zero instead of running a full install — creating `.claude/`, fetching `flow-kit/` and appending to `.gitignore` — in whatever directory happened to be current. The `init` word remains optional whenever another argument expresses the intent, so `fcomet --target <dir>` is still equivalent to `fcomet init --target <dir>`.

## [1.5.0] - 2026-09-14

A release closing out the review follow-up after `1.5.0-rc.3`: the two defects found by external review are fixed — a context document whose headings carry a legal ATX closing marker no longer has sections that are present reported as missing, and the installer aborts rather than truncating a `.gitignore` it cannot read — the protected-path helpers now have a single implementation, and several statements that had gone stale are corrected. ([#100](https://github.com/baobaolaodie/flow-comet/pull/100))

### Fixed

- **A context document whose headings carry a legal closing marker no longer blocks the workflow**: an ATX heading that repeats its hashes at the end (for example `## Section name ##`) was stored with the trailing `##` as part of the section name, so the name comparison missed it and the structure check reported sections that are present as missing — the closing marker is now stripped (it must still be preceded by a space, so a section name that legitimately ends with `#` is left alone).
- **The installer no longer truncates a `.gitignore` it cannot read**: every read error was treated as "the file does not exist", so under an access failure (read denied, write allowed) the user's existing `.gitignore` was rewritten down to the managed entry alone. Only a genuinely absent file counts as first-time management now, and an access failure aborts the install instead — the same rule the installer already applied to its migration probe, now shared by both call sites.

### Changed

- **The protected-path helpers have a single implementation**: the write guard carried its own byte-identical copy of the path-containment, protected-path inspection and protected-file read helpers, so a fix to one copy never reached the other — the guard imports them from the shared module.
- **Stale statements corrected**: the path-base error message no longer claims that only the state machine withholds support (the guard rejects the same values, and the neighbouring comment now agrees), the dsh platform reference records the npm package as published and the AGENTS.md injection as certified, and the security policy names the installer's third-party dependency together with the boundary for reporting that package's own vulnerabilities upstream.
- **The changelog's own path reference is complete**: the authoritative version marker is now referred to as `.flow-comet/skills/flow-comet/INSTALLED_VERSION`, a path that resolves from the repository root.
- **Three skill descriptions match the behaviour they document**: the review reference states both outcomes for a missing disposition marker (blocking on a new change, a progressive warning on a legacy one), the evolve command explains that a stale timestamp only prompts an explicit invocation instead of triggering on its own, and the decision-points reference no longer files a terminal stop condition as a user decision.
- **The regression suite now runs 243 scenarios**; the system test suite is unchanged at 75 items.

## [1.5.0-rc.3] - 2026-09-14

Release candidate shipping the distribution and runtime-namespace batches accumulated after rc.2: the npm distribution channel (an installable package declaring its published contents as a `files` allow-list and exposing two command entries), the runtime namespace decoupled from Comet (`.flow-comet/` state file, authoritative source and `FLOW_COMET_RUN_ROOT`), the write guard and the workflow guard no longer reading Comet configuration, and the fixes carried in the same batch — the dsh bridge version stamp aligned with the release version, the POSIX hook command on every platform, the worktree-isolation release, and installer/migration hardening from external review. ([#93](https://github.com/baobaolaodie/flow-comet/pull/93)) ([#94](https://github.com/baobaolaodie/flow-comet/pull/94)) ([#95](https://github.com/baobaolaodie/flow-comet/pull/95)) ([#96](https://github.com/baobaolaodie/flow-comet/pull/96)) ([#97](https://github.com/baobaolaodie/flow-comet/pull/97)) ([#98](https://github.com/baobaolaodie/flow-comet/pull/98))

### Added

- **npm distribution channel**: flow-comet is now installable as an npm package that exposes the installer under two command names (`fcomet` and `flow-comet`), so a global install followed by `fcomet init` sets up a project in the current directory — `--target` is optional, and the installer also accepts an optional leading `init` word, so `fcomet init` and a bare `fcomet` are equivalent. The published contents are declared as a `files` allow-list (the skill tree, the orchestration rule, the installer and the dsh bridge script), so private and non-distributed artifacts stay out of the package structurally rather than through a deny-list. This batch made the package publishable, and the `1.5.0-rc.3` release published it — the first version available from the registry.

### Changed

- **Runtime namespace decoupled from Comet**: the workflow state file now lives at `.flow-comet/flow-comet-state.json`, the authoritative source moved to `.flow-comet/skills/` with the orchestration rule at `.flow-comet/rules/`, and the root-anchoring environment variable is renamed `FLOW_COMET_RUN_ROOT` (hard switch — the old variable is no longer read). The installer migrates an existing state file with a mandatory pre-migration backup (`.flow-comet/flow-comet-state.json.bak-<timestamp>`, kept after migration) and aborts without overwriting when the new and old locations both exist, when the old file is a symbolic link, or when it is not valid JSON; target-project ignore rules are handled conservatively (existing entries preserved verbatim, a `.flow-comet/` entry appended only when missing, idempotent on re-run).
- **Comet awareness layer removed from the write guard and the workflow guard**: neither reads Comet's `.comet/config.yaml` nor scans classic change directories — decisions follow the state file alone, and a retired overlay protocol kind no longer takes the overlay branch.
- **The migration step is explicitly temporary, with stated retirement conditions**: the installer's migration module is the only remaining place that references the old namespace, and it exists solely to move an existing state file once — it never enters a runtime path. It now documents how it is retired: it can be deleted in whole either at the next breaking release (when the migration window closes) or once install runs consistently report nothing left to migrate, so the transient reference cannot silently become permanent. The migration report also states plainly when everything was skipped, so a project can tell at a glance that the installer no longer needs to touch the old directory.
- **Regression suite expanded to 241 scenarios**; the system test suite now runs 75 items.
- **Counts are described rather than frozen where no check covers them**: several documents carried a hard-coded scenario or item count while not being part of the consistency self-check, so the number could go stale silently — this happened three times in this batch alone. Those places now say where the number comes from, and two table rows that had drifted apart between a skill and its guidance file are aligned, so the same class of staleness cannot recur unnoticed.
- **The package manifest version joins the release version surface**: the release-consistency check now reconciles nine places instead of eight — the npm package's `version` is compared with the README badge, this changelog, [docs/VERSIONS.md](docs/VERSIONS.md) and the authoritative `.flow-comet/skills/flow-comet/INSTALLED_VERSION`, so a package that would ship with a stale version fails the release check instead of reaching the registry.
- **The distribution surface is asserted rather than assumed**: the system test suite gained an item that inspects the real `npm pack` output for the package boundary and the two command entries, and reports an explicit "not applicable" when it runs from an installed copy (which carries no package manifest) instead of skipping silently; the CI installer job asserts the same boundary, so a stray private file or a dropped command entry fails a check rather than shipping.

### Removed

- **Residue manifests that no runtime path or guard gate read**: `bundle.yaml`, the hook descriptor files under `hooks/`, and the four manifest YAML files under `skills/flow-comet/comet/`.
- **The leftover Comet configuration in this repository**: `.comet/config.yaml` used the Comet project schema but was never active here — this repository has no classic change directory and nothing in the codebase reads it. It lived in this repository's tree and was committed here, so its removal was ours to make; the repository now contains no `.comet` directory at all.

### Fixed

- **dsh bridge loader version stamp aligned with the release version**: the loader's `BRIDGE_VERSION` now matches the release version (and the authoritative `INSTALLED_VERSION`), so the read-only bridge health check reports a version-consistent loader on a freshly installed project instead of version skew; the installer's overwrite reporting and the regression suites read the stamp from the authoritative source instead of a fixed value.
- **Worktree-isolated subagents are no longer misclassified as the coordinator**: the project-root anchoring chain (added in the previous release) resolved to the main repository through the host-provided variable, which sits above the isolated worktree — writes inside `.claude/worktrees/**` were then judged against the coordinator whitelist and blocked, even though a worktree subagent writing source is the intended design. The guard now releases that isolation prefix, with `../` traversal protection; the mechanism notes that previously read "the project hook does not apply to subagents" now state the condition under which that was true.
- **A failing state path now explains itself**: when the protocol's state path points at a file that does not exist, the guard reports the resolved path, detects a state file in the other runtime namespace (suggesting the project may not be migrated yet), and names the exact field to correct — instead of a bare "state does not exist". It still fails closed and never falls back.
- **The runtime state path now has a single source**: the literal was repeated across four scripts and a change to one would not alert the others; it now derives from one exported constant, with the write guard's added import measured at about 1.7 ms per invocation.
- **The Claude Code hook command now uses the POSIX form on every platform**: the installer previously emitted a cmd-style `%CLAUDE_PROJECT_DIR%` reference with backslash paths on Windows, but the host executes hook commands with bash semantics — the variable was never expanded and the backslashes were swallowed as escape characters, so the guard script failed to load on every tool call (the host downgraded the crashing hook to a non-blocking error, leaving writes unintercepted); the installer now emits the braced POSIX form on all platforms, and the regression suite verifies the generated command actually executes under the host's semantics.
- **Migration and installer hardening from external review**: four behaviours were corrected. (a) The worktree-isolation release now applies to writes detected from a Bash command, not only to those judged from a file path — previously the same write was allowed through one route and blocked through the other. (b) A path is treated as absent only when it genuinely does not exist; an access error such as a permission failure now surfaces and aborts instead of being silently read as "no legacy state", which could have left a project's state behind while reporting the migration complete. (c) A state file beginning with a UTF-8 BOM is accepted for validation, matching the runtime reader, while the backup and the migrated file keep the original bytes untouched. (d) The `--purge` confirmation is validated before any write, so a command that is ultimately rejected no longer modifies the target first.
- **The contract checker now covers the shared modules**: `protocol-utils`, `state-schema`, `task-parsing` and `route-node` are part of its required list — a copy missing one of them breaks every guard script at import time, yet the checker previously still reported success.
- **The worktree delegation notes no longer document a bypass**: the guidance that recommended writing through a direct File API to evade the write guard is marked as a withdrawn workaround and must not be used; on platforms without agent isolation the delegation step now requires serial execution instead.
- **Task attributes and CLI checks corrected from external review**: task parsing now accepts single-quoted attribute values (previously such a task was silently read as non-parallel, which skewed routing and skipped the parallel-write overlap check); the contract checker escapes the field name before building its regular expression (previously a field containing a bracket threw an error, and one such as `item[0]` matched unrelated text); `--project` now takes precedence over the working directory and rejects a missing value (previously an explicitly given root was silently ignored); and the context-initialization check matches exact headings instead of substrings (previously a heading variant — or even a mere mention in the body — passed the check and recorded a scan time).
- **The isolation-area release now verifies physical containment**: the release added earlier in this batch matched on the normalized path alone, so a symbolic link or junction inside the worktree that points outside it would still be released — and both judgement paths returned before any later containment check, leaving nothing to catch it. The release now resolves each path component and requires the target's real location to stay inside the intended worktree, deriving the landing point from the nearest existing ancestor when the target does not exist yet; resolution failures are refused rather than released. The check runs only when the prefix matches, so ordinary sessions pay nothing.
- **Context validation ignores headings inside fenced code**: the section check matched `##` lines wherever they appeared, so a file missing a required section could still pass if a code example happened to contain that heading — and the scan time was recorded as if the file were complete. Fenced code blocks are now tracked and excluded before the section set is collected.

## [1.5.0-rc.2] - 2026-09-01

Release candidate shipping the routing and installer batches accumulated after rc.1: dependency-driven multi-pass parallel routing (dependency gates, interleaved waves), write-guard hardening (project-root anchoring, state-file case variants), test-only parallel-task advisories, multi-pass exit hardening, `next` usable across parallel transitions, file-level dependency checks at planning exit, routing convergence under one shared decision, the executor authorization constraint for the direct escape hatch, and the flow-kit snapshot / dsh bridge loader governance. ([#75](https://github.com/baobaolaodie/flow-comet/pull/75)) ([#76](https://github.com/baobaolaodie/flow-comet/pull/76)) ([#77](https://github.com/baobaolaodie/flow-comet/pull/77)) ([#78](https://github.com/baobaolaodie/flow-comet/pull/78)) ([#79](https://github.com/baobaolaodie/flow-comet/pull/79)) ([#80](https://github.com/baobaolaodie/flow-comet/pull/80)) ([#81](https://github.com/baobaolaodie/flow-comet/pull/81)) ([#83](https://github.com/baobaolaodie/flow-comet/pull/83)) ([#84](https://github.com/baobaolaodie/flow-comet/pull/84))

### Added

- **Installer acquires flow-kit automatically**: `prepare-env` clones the upstream and checks out the locked snapshot commit (`9b5dda7`) when the target project lacks `flow-kit/`; an existing upstream clone is only inspected read-only (current HEAD vs the locked snapshot is reported with the difference impact); a same-name non-clone directory is skipped with guidance; a network failure warns and continues; purge never includes `flow-kit`.
- **dsh loader version governance and read-only bridge health check**: every dsh install compares the loader's embedded version stamp with the installed copy before overwriting and reports first install / upgrade / downgrade / version consistent; `workflow-state.mjs bridge-check` reports six states (healthy / file missing / not mounted / version skew / duplicate registration / not applicable) with zero writes and zero network.
- **Interactive platform selection upgraded to a direction-key multi-select**: `@clack/prompts` is now the primary TTY path (pinned exact version — the repository's only third-party dependency, used solely by the installer's interactive selection), with an automatic readline number/comma multi-select fallback when the dependency is not installed, offline, or stdin has no raw mode; `FLOW_COMET_FORCE_READLINE=1` forces the fallback for testing.

### Changed

- **Documentation aligned with repository conventions**: task summaries now defer to each repository's own ignore rules and are never force-added into version control, the commit convention adopts general optional scope semantics (short subsystem nouns; recommended but optional; management codes such as change-id must not be used as scope, and task numbers go in the commit body footer), branch naming alignment via `init --branch-prefix` is documented in the installation guide, and planners are told the wave-grouping constraint before plan exit.
- **Dependency-driven multi-pass parallel routing**: the delegation node can now be entered multiple times — each pass delegates every dependency-satisfied parallel task, interleaved parallel/serial sequences run in alternating passes instead of being rejected, planning exits validate dependency cycles rather than wave shapes (with recovery guidance on a cycle), and the delegation node counts as complete only when no dependency-satisfied parallel task and no serial task remains. **Write-guard hook injection hardened against directory drift**: the installer injects the hook command as a project-root-referencing form, re-running the installer upgrades older relative-path entries in place (idempotent, no residue), and the installation and troubleshooting guides document the upgrade step and the fail-open symptom signature.
- **Write-guard project-root resolution hardened against directory drift**: the hook now resolves its project root via `COMET_RUN_ROOT`, then `CLAUDE_PROJECT_DIR` (injected by Claude Code), then walks upward from the session working directory to the nearest project marker — a drifted session no longer degrades to an error-style pass-through for out-of-project writes.
- **Advisory pseudo-parallel detection at planning exit**: when a parallel task's declared writes consist exclusively of test files, the planning exit emits a non-blocking warning listing the task id and suggesting an explicit `depends_on` declaration or merging into a vertical slice — closing the implicit-dependency blind spot opened by interleaved multi-pass routing.
- **Multi-pass exit hardening**: the execute-exit serial-task check now respects declared task dependencies — serial tasks waiting on later passes no longer block progress, while genuinely runnable serial tasks still block with their ids and recovery guidance; single-line semicolon-separated write-file lists are accepted by both handoff auto-parsing and pseudo-parallel detection; the routing advisory warning stays silent once every task is done; dependency-deadlock blocks now include a boundary hint for the workflow-state `advance` escape hatch (with its re-entry obligation); and the planning and delegation skill texts now describe interleaved parallel/serial sequences as valid under dependency-graph semantics.
- **`next` usable across parallel transitions**: after a planning or delegation exit applies, `next` now recognizes the routing successor (the same derivation the guard uses for its reported next) instead of only the static direct successor — parallel transitions such as plan → delegation and delegation → execution between passes are no longer falsely blocked as a "probably not exited" node; recording evidence before exiting no longer drifts the current node forward prematurely, so the subsequent normal exit still works.
- **Regression suite expanded to 219 scenarios**; the system test suite now runs 73 items.
- **Write-guard state-file case variant closure, fail-closed task-completion routing, parallel-write path normalization, and the test matrix kept in sync**: on case-insensitive file systems the hook now blocks case variants of the state file (`.Comet/Flow-Comet-State.json`); task routing no longer treats a task missing a status as done (a malformed block keeps the flow in execution instead of routing to review early); parallel-write overlap detection normalizes declared paths (separator, dot segments, out-of-bounds) so path variants cannot bypass the overlap check; the system test's recovery fixture keeps the original overlap path while adding the dependency, proving the recovery works by dependency rather than by changing paths.
- **File-level dependency checks at planning exit**: overlap between parallel tasks' declared writes without an explicit dependency blocks new changes (with recovery guidance: declare the dependency or split serial) while legacy changes keep the warning; a parallel task reading another parallel task's write path gets a non-blocking implicit-dependency warning; extensions are resolved from the actual declared paths, closing the earlier `.txt`/extensionless blind spot.
- **Routing convergence under one shared decision**: the exit-reported next and `next` both derive from the shared routing module — including serial-pending reflow back to execution — so multi-pass exits and queried next no longer drift (regression-anchored).
- **Executor-controlled direct mode constrained**: switching to the direct escape hatch now requires an explicit authorization record (written by the coordinator's explicit switch); an executor's unauthorized switch is blocked, and the state file is guarded against manual tool writes — the escape hatch stays user-confirmed.

## [1.5.0-rc.1] - 2026-08-23

Release candidate consolidating the mechanism and skill robustness batch: artifact template fidelity, skill-load declaration front gate, the two-layer skill-loading model, formal zero-commit semantics, and verify-exit sandbox compatibility, plus dsh bridge idle-state containment and plan wave-grouping validation. ([#64](https://github.com/baobaolaodie/flow-comet/pull/64)) ([#65](https://github.com/baobaolaodie/flow-comet/pull/65)) ([#66](https://github.com/baobaolaodie/flow-comet/pull/66)) ([#67](https://github.com/baobaolaodie/flow-comet/pull/67))

### Changed

- **dsh write containment now applies only while the flow is running**: in the idle state (no state / no `activeChange` / `completed`) writes outside the project root are no longer intercepted by the bridge, matching Claude Code / Codex semantics; parse failures or unknown status stay fail-closed deny. ([#65](https://github.com/baobaolaodie/flow-comet/pull/65))
- **System test suite expanded to 61 items** with dsh bridge flow-state-gate assertions (idle pass / parse-failure & unknown-status fail-closed). ([#65](https://github.com/baobaolaodie/flow-comet/pull/65))
- **Regression suite gained wave-grouping consistency validation and contract payload parse-failure detection scenarios**. ([#66](https://github.com/baobaolaodie/flow-comet/pull/66))
- **Wave-grouping consistency check added at plan exit** (interleaved `[P]`/serial mixing warns on legacy changes and blocks on new changes, with recovery guidance); **record / workflow-handoff now fail closed on unparseable contract payloads** (error with a `--json-file` hint, nothing written to state). ([#66](https://github.com/baobaolaodie/flow-comet/pull/66))
- **Artifact template fidelity and skill-load front gate**: new changes must keep the template title, header fields, and section order for SUMMARY / TASK / CHANGE / REQUIREMENT / DESIGN; handoff requests and records now require the node's skill-load declaration, made after loading the skill with the Skill tool (reading the SKILL.md file is not loading). ([#67](https://github.com/baobaolaodie/flow-comet/pull/67))
- **Zero-commit task formal semantics**: a task with an empty `write_files` list and an explicit `noCommit` contract skips the commit-subset check with an auditable prompt; a non-empty task claiming `noCommit` still runs the full check. ([#67](https://github.com/baobaolaodie/flow-comet/pull/67))
- **Two-layer skill-loading model guard scenarios added to the regression suite**; **two-layer skill-loading model across workflow skills**: entry guidance now loads the routed node's implementation skill with the Skill tool before its required protocol calls; node skills state they are already loaded by routing (same-name required calls are declaration-only); the legacy auto-fill wording is qualified to legacy changes behind the declaration front gate; two regression scenarios pin declaration-command consistency and forbid self-loading and conflated phrasing. ([#67](https://github.com/baobaolaodie/flow-comet/pull/67))
- **Verify-exit command execution compatible with dsh headless sandboxed sessions**: when a piped spawn is denied (EPERM, observed in dsh headless one-shot runner sessions), the guard retries the same command with inherited stdio — real execution and exit-code judgment unchanged, a VERIFY-DEGRADED line marks the degraded capture; non-EPERM failures never degrade. ([#67](https://github.com/baobaolaodie/flow-comet/pull/67))
- **Zero-commit results may not carry tracked commits**: a result declaring noCommit whose commit contains tracked files is rejected on new changes (warn on legacy), closing an escape hatch around the commit-subset boundary; **intake documents enforce the Change ID header on new changes** (previously warn-only). Regression suite expanded to 171 scenarios. ([#67](https://github.com/baobaolaodie/flow-comet/pull/67))

## [1.4.2] - 2026-08-18

DeepSeek Harness (dsh) platform support with bridge-based write enforcement, expanded regression coverage (144 scenarios / 60 system tests), and dsh write-guard hardening. ([#60](https://github.com/baobaolaodie/flow-comet/pull/60))

### Added

- **DeepSeek Harness (dsh) platform support**: flow-comet now installs on dsh through the installer — `prepare-env --platform dsh` installs the skill tree project-locally at `<project>/.dsh/skills/flow-comet` (dsh auto-discovers skills there at rank 100 without a restart, and projects without that directory cannot see the skill — naturally project-level), injects the orchestration rules into an AGENTS.md managed block (non-destructive merge), and mounts a thin bridge loader globally at `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` with a managed block in `$DSH_HOME/cordis.patch.yml` (read-merge-write, preserves existing blocks such as dsh-skin, effective for all profiles). The bridge listens on the native `tools/pre-execute` waterfall event, maps dsh tool calls to the project-local guard decision script (allow / deny with BLOCK message and recovery guidance / fail-closed on shape mismatch or abnormal exit, Windows 8.3 short paths normalized), and only engages when the session's project root contains `.dsh/skills/flow-comet` (narrow listening — non flow-comet projects are untouched). Platform selection supports interactive multi-select (arrow keys, pre-checked from project traces) and explicit comma-separated platforms (`--platform dsh` / `claude-code,dsh` / `all`; the previous `both` option is removed). Version anchor: dsh `0.1.0-rc.6`. ([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))

### Changed

- **Regression suite expanded to 144 scenarios** with installer platform-selection chains (explicit single platform, comma-separated multi-platform, `all`, TTY multi-select with trace pre-checking, trace detection, unknown-platform errors, `both` rejection, idempotent re-install); the dsh adaptation keeps the engine untouched — the guard decision core is reused unchanged via subprocess calls. ([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))
- **System test suite expanded from 55 to 60 items** with dsh platform assertions (project-level skill install with path replacement and version marker, AGENTS.md managed block with user-content preservation, bridge loader syntax and home patch injection with read-merge-write, purge recovery). ([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))

### Fixed

- **Write containment on dsh**: writes whose target resolves outside the project root are now denied before reaching the guard decision (previously a non-resolved target skipped the whitelist judgment — fail-open); Windows 8.3 short paths are normalized before judgment. ([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))
- **Fail-closed on dsh tool arguments**: argument shape mismatches (missing `file_path` / `command`, non-object arguments) now produce a deny with WARN instead of being silently passed through. ([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))
- **Subagent execution on dsh**: when a workflow delegates tasks to subagents, delegated agents (identified by the session's subagent delegation depth) can write source code as the executor — matching the worktree-isolation semantics of the other platforms — while the coordinating agent remains subject to the phase write whitelist. Out-of-project writes and malformed tool arguments stay denied for both. ([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))
- **8.3 path normalization before the guard decision on dsh**: the project root is canonicalized to its long path form before the project-local guard is invoked, closing a fail-open where an 8.3 short-form project root made the guard's lexical path resolution skip the phase write whitelist (out-of-whitelist coordinator writes were allowed). ([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))

## [1.4.1] - 2026-08-16

Installer platform-selection fix and release-model change (release PRs now merge). ([#56](https://github.com/baobaolaodie/flow-comet/pull/56), [#57](https://github.com/baobaolaodie/flow-comet/pull/57))

### Fixed

- **Installer platform selection**: the interactive prompt now offers `3) both` (install to both Claude Code and Codex — an interactive-only option; `--platform` still accepts only `claude-code` or `codex`); no-TTY auto-detection no longer arbitrarily picks Codex when the target project has both `.claude/` and `.codex/` traces — it defaults to Claude Code (primary) with a hint; Codex remains reachable via `--platform codex`, and both via an interactive terminal.

### Changed

- **Release model**: release PRs (`dev → main`) now merge instead of squash — dev's change-level commits enter main permanently, and dev stops accumulating a lead over main after each release.

## [1.4.0] - 2026-08-14

Multi-platform installer framework, platform modularization, and real-artifact examples. ([#45](https://github.com/baobaolaodie/flow-comet/pull/45), [#46](https://github.com/baobaolaodie/flow-comet/pull/46), [#47](https://github.com/baobaolaodie/flow-comet/pull/47), [#48](https://github.com/baobaolaodie/flow-comet/pull/48), [#50](https://github.com/baobaolaodie/flow-comet/pull/50), [#52](https://github.com/baobaolaodie/flow-comet/pull/52))

### Added

- **skill-load declaration mechanism**: subagents declare loaded workflow skills per node; record validates declarations against the protocol's required skill calls; exit checks protocol declaration markers; cross-consistency timestamp checks; backward compatible with legacy changes.
- **Installed version marker**: `prepare-env` writes `<project>/.claude/skills/flow-comet/INSTALLED_VERSION` from the source repo's git state (`1.4.0` on a release tag; `1.4.0-N-g<hash>` on accumulated dev) so issues and PRs can state the exact version — including how far dev has accumulated since the last release.
- **Local commit/push hooks**: `install-commit-hook.mjs` sets up commit-msg and pre-push hooks that reject messages carrying process codes (this project's own convention, not a universal list).
- **Multi-platform installer framework**: `prepare-env` now targets Claude Code (default, unchanged) or Codex via a platform-descriptor table — interactive platform selection (TTY) with an explicit `--platform` override and automatic detection of an existing `.claude/` / `.codex/`; skills install to each platform's native location (`.agents/skills/` for Codex, auto-discovered); SKILL/GUIDANCE command paths are rewritten at install time for non-default platforms (authoritative source stays in `.claude` form); Codex rules are injected into an AGENTS.md managed block (Codex's `rules/` directory serves command-approval policies, not instruction files); the write-guard hook gains full Codex adaptation — Codex PreToolUse intercepts Bash tool calls, the hook parses write targets from the command (PowerShell cmdlets, .NET File API, redirection) and denies out-of-scope writes via `{"decision":"block"}` (measured on Codex CLI 0.146.0; trust the hook on first use via `/hooks`), while the Claude Code output stays unchanged.

### Changed

- **Regression suite expanded to 137 scenarios**: `init` rejects unknown flag-like arguments (e.g. `--help`) instead of treating them as a change name; covering skill-load declarations, record validation, exit protocol checks, cross-consistency timestamps, legacy compatibility, review finding disposition, artifact completeness, delegation attribution, recovery guidance, wave-wording consistency, self-check-method section enforcement for new changes, and per-change verification-failure isolation.
- **CI**: process-code checks moved from the server-side PR policy to local hooks; PR/issue templates reworked for practice (deduplicated checkboxes, related-issue section, based-on version, protocol and installed-version fields).
- **Commit history made jargon-free**: 52 historical commit messages rewritten to plain descriptions (tree unchanged); duplicate commits deduplicated.
- **Docs**: README reorganized (quick start moved up) with recognizable anchors (GSD link, pain-point intro, fit boundary); installation guide gained an uninstall section; release checklist deduplicated to a single source; terminology unified across docs.
- **System test suite expanded to 55 items** (installer version-marker check, multi-platform installer scenarios: Codex install smoke, hook platform contract, platform selection chain, purge semantics, platform-descriptor-driven install smoke, per-change verification-failure isolation).
- **Merge gate changed to CI status checks**: branch protection no longer requires an approving review (single-account repo cannot self-approve); required checks are the CI jobs; bot reviewers (CodeRabbit / Sourcery) are advisory — contributing guide gains a bot-reviewers section (advisory-only, threaded replies, resolve before merge).
- **Examples rebuilt from a real archived run**: `docs/examples/` now carries the complete artifact set of a real 8-node change (processor-pipeline, run in the e2e fake project) — six-section summaries, review findings with disposition markers, skill-load declaration markers, actually-executed verify; the simulated example and outdated artifact screenshots were removed, and the README showcase now points at the real artifacts.
- **Documentation overhaul**: skill instructions deduplicated (generator-template remnants and mid-file frontmatter removed), Comet-positioning claims replaced with flow-comet's own mechanism descriptions, per-node guardrail tables aligned with the actual guard implementation (unimplemented items now marked as review-checked execution discipline), dual-platform (Claude Code / Codex) adaptation for brooks-lint invocation, user entries, and installation docs, the regression baseline promoted to the two-tier suite (guard self-test + system test) across all docs, and timeliness updates (roadmap state, design-doc backfill, archived handover notes).
- **Strict mode for new changes**: changes created via `init` are marked new (`newChange`) and enforce all content-level checks as blocking (disposition markers, built-in self-check evidence, wave-wording consistency, overreach delegation, append placement, entry evidence, self-check-method section); legacy changes keep the progressive warnings.
- **Execution-omission protection**: node entry is now recorded (exit blocks on new changes when a node was exited without entering it); completed tasks require their summary for new changes (blocked — legacy changes keep the progressive warning); handoff results require TDD RED evidence for new changes; record auto-fills skill-load declaration markers; execute gains an explicit empty-exit exemption; init detects commit-less repositories; the installer cleans up stale empty hook groups when the hook matcher evolves.

### Fixed

- Artifact-path derivation respects protocol `pathBase` (custom protocols with project-root artifacts now advance correctly); fail-fast for unsupported roots.
- Done tasks require matching per-task summaries (progressive warning, not block).
- Overreach detection for delegated parallel tasks (execute and verify exits).
- Recovery guidance added to blocked messages (advance / select / record).
- Wave-wording consistency: prose marking a task parallel without the matching task attribute warns progressively.
- `init` command rejects arguments starting with `--` (e.g. `--help`) — previously treated as the change name, which auto-created a change, a branch, and state.
- dev-main sync check: files deliberately deleted on dev (e.g. the template md → forms migration) no longer counted as drift.
- Skill commands that lacked the install-path prefix now carry the authoritative-source path — executable on both platforms after installation.
- Process-code detection regex now covers 1-3 digit scenario numbers (previously only two digits); the doc-scanner regex is back in sync with the single source; POSIX hook files get their executable bits set at install time.
- CI bilingual-mirror check now covers SECURITY (CoC excluded by design, matching the local checker); the version-expected extraction no longer relies on a dead fallback.
- Bundle metadata aligned: skills list, references, and script side effects match the actual distribution.
- Mechanism docs and the skill guidance now state the strict-mode rules explicitly (entry enforcement, summary enforcement, and command-level write interception in the Red Flags).
- Verification-failure counting is now isolated per change — switching changes no longer carries over another change's failure count (legacy states migrate automatically).
- Archived changes now require the leftover-issues list (explicitly stating "no leftovers" when none); declaration-marker auto-fill no longer rebuilds an archived change's active directory.
- The empty-repository branch hint now matches behavior — no branch is claimed when none can be created.
- Review field-label exemption matches full labels only (a finding titled like "Source maps expose paths" is no longer mis-exempted from disposition validation).
- `--json-file` reads are restricted to paths inside the project root (record and handoff).
- The hook installer fails explicitly when POSIX executable bits cannot be set (previously silent — git would skip non-executable hooks).
- Delegation writeFiles matching supports partial-segment globs (e.g. `src/*.mjs`) with anchored per-segment matching — `*` never crosses `/` and literal segments stay exact (previously a partial glob was compared literally and blocked valid delegations).
- `--json-file` with a missing or empty value now reports a usage error instead of an internal type error (record and handoff).
- Stale scenario-count references (136) in the suite headers and the test-matrix / known-issues templates are synced to 137.
- PowerShell output-encoding guidance uses the explicit `[System.Text.Encoding]::UTF8` expression (bilingual).
- The archive-stage hook whitelist includes `.specs/<change-id>/` so the leftover-issues list can be written into the change directory before archiving (previously blocked).
- Archive exit warns when the project CHANGELOG has no entry for the change being archived (progressive, both new and legacy changes).

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
