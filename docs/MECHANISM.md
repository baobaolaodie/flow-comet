# Core Mechanisms

The behaviour layer: what the engine guarantees, how a node's exit is validated, how execution is isolated, and how to run a workflow of your own on the same engine. Step-by-step usage lives in [Usage](USAGE.md); installation in [Installation](INSTALLATION.md).

## Behaviour contract

- **File as truth.** The state machine lives in a single file (`.flow-comet/flow-comet-state.json`) and is only ever advanced by the guard's exit command. Everything the engine needs to know about the work is derivable from the artifacts under `.specs/`; no progress is stored in a conversation, so any session can resume by re-reading them.
- **Gates, not advice.** Advancing from a node is a validated transition, not a suggestion: the guard checks the node's artifacts, their structure, the evidence recorded for the node, and the declarations the workflow requires.
- **Fail-closed by default.** When a decision cannot be proven safe — the protocol file cannot be read, the state or a payload cannot be parsed, the workflow status is unknown, a path cannot be shown to stay inside the project — the engine refuses instead of proceeding. Only clearly idle states (no change, or a completed change) are treated as unconstrained.
- **Declared boundaries.** Anything that looks like user authority — accepting a repair round past its cap, re-entering an archived change, taking over a task from the coordinator — must be an explicit, recorded declaration. The engine treats silence as refusal.

### Installation cleanup

Reinstalling over an existing copy also removes what that copy should no longer hold: inside the skill directories the installer manages under the platform's skill tree, a path the current skill set no longer contains is deleted, so a page that was renamed or moved away does not stay behind in the installed copy. The cleanup is decided by location and it fails closed: nothing outside those directories is looked at, and inside them anything it cannot prove it manages is kept with the reason printed — a managed directory that is itself a link or that resolves outside the project, a symbolic link, a path whose type differs from the source, and a directory that is still non-empty once the removals are done. It runs before anything is copied, so a cleanup that cannot complete stops the run before the copy begins; a path that cannot be read is not treated as absent; each removal and each keep is printed; and a re-run removes nothing further.

What the installer manages is the current skill set itself, so a whole skill directory that is no longer part of it is never entered — a directory someone made by hand and one whose skill was removed cannot be told apart from the outside. That case is left to an explicit reset (`--purge`) rather than guessed at.

A reset (`--purge`, with its second confirmation) is the wider tool, and its reach is not confined to the project it is run in. It deletes the selected platforms' project-side generated artifacts and rebuilds them — and for the DeepSeek Harness the deletion reaches further, into the two shared pieces that are mounted globally: the bridge loader under `$DSH_HOME/plugins/` and the installer's managed block in `$DSH_HOME/cordis.patch.yml`. Those two belong to the harness home rather than to any project, and they are what every profile and every project already installed through that platform uses to intercept writes: a reset inside one project removes the shared face for all of them, then rebuilds it in the same run.

Three details decide whether that matters. The rebuild writes the version of the copy that ran the command into the shared loader, so a project installed at a different version reports the difference in its own health check; a run interrupted before the rebuild leaves the shared face removed until an install for that platform is run again from any project; and the shared face is touched only when that platform is one of the platforms being reset, so resetting another platform stays inside the project. Use the reset to discard a project's own generated artifacts — it is the documented handling both for a skill directory the installer cannot prove it manages and for uninstalling a platform — and not as a way to uninstall one project while leaving the others working, nor as a routine step.

### Skill text layering

The distributed books follow one rule about where a piece of content belongs. It decides whether you read something in the book in front of you or are sent elsewhere for it.

| Content | Where it goes |
|---|---|
| The node's own work instructions — its steps, its domain method, and the pitfalls particular to that node | the node book's body |
| A discipline or fact that several nodes need | one authoritative place, plus a sentence in each book that needs it saying when to read that place |
| Something the engine already holds — the output schemas, the gates, the commands, the evidence fields | asked for from the engine rather than copied into the book |
| The maintainer's own narrative — corrections, dates, retired conclusions | outside what is distributed |

The second row is the one you meet while working: a shared discipline is not repeated in every book that needs it, and each of those books carries a conditional sentence instead — the sentence names the authoritative file and says under what circumstance to open it. A shared file that no book points at is treated as unreachable, so the shared files are checked against the sentences that lead to them. From any book other than the entry one the pointer is written as an explicit path into the entry skill's `reference/` directory rather than as a bare relative one, because the bare form resolves against the book it is written in and would lead nowhere from a node book. The third row is why a book can send you to the engine for a node's requirements instead of printing them; the command is under [Guard validation](#guard-validation).

That rule replaced an earlier one that required the same text to appear in several books, and the checks now run the other way: every book that needs the content must carry the pointing sentence, the authority must be named as the single source, and the body must not appear a second time. Three details of that check belong to the contract rather than to how it is implemented. The pointing sentence is excluded from the body comparison, because holding it is what the design requires of every book — counting it would either fail the books that comply or say nothing at all. The bar for "appears a second time" is derived per pair from the shorter of the two bodies instead of being fixed in advance: a fixed bar once sat above the length of the bodies that actually exist, and a real duplicate passed unnoticed until the bar was derived. And the comparison covers the pairs whose text was still identical; a pair that had already drifted shares no body to compare, so it stays outside — a known gap, left for a later pass.

## Three defense layers

| Layer | What it does | Where it is enforced |
|---|---|---|
| ① Physical write interception | Before a tool writes, the platform hook checks the target against the current node's write whitelist; out-of-scope writes are refused in the platform itself | the platform's `PreToolUse` hook, installed by the installer |
| ② Guard validation | Node entry and exit are validated against evidence: required artifacts and sections, recorded node evidence, the skill-load declaration, the task-set signature, summaries for completed tasks, review dispositions, and the test commands that `verify` actually runs | the guard's `entry` / `exit` |
| ③ State and schema validation | Every state write is validated against the schema (field types, nested records), and unwritable shapes are rejected rather than silently normalized | the state machine's write path |

The same discipline gives the coordinator an enforced boundary: in the default execution mode the coordinating session may not carry out implementation tasks itself (the engine reports the takeover). Implementation is delegated to subagents that must return a verifiable contract — a commit, the real output of their verification, and the checks they declared. What makes parallel delegation safe is a contract of four attributes — write permission, commit isolation, verification isolation and integration discipline; an isolated worktree implements the first of them, but it is one option rather than the contract itself, and a shared workspace is a supported shape.

**Hook blocking semantics and their limits.** The hook blocks a write by exiting with status 2 and printing the reason; in an interactive platform session that is a refusal. Two platform-level preconditions are worth knowing, because when they are missing the hook *cannot* refuse even though the mechanism is intact:

- Claude Code runs the hook through the shell it can find; if the host cannot discover a Bash (for example Git Bash on Windows), the hook falls back to a shell where the installed command form does not run, and a non-zero status is not treated as a block. Giving the platform the path to a POSIX shell restores blocking.
- Codex only executes project hooks when its hook-trust has been accepted (interactive `/hooks`), or when a scripted run passes the platform's bypass flag. Without either, the hook is simply not executed.

Both are host preconditions rather than engine behaviour; with them satisfied, a real session refuses an out-of-scope write and allows the same write once the node permits it.

## Guard validation

At each node the guard answers a fixed set of questions; a "no" is a refusal with the reason and the command that fixes it:

| Question | Applies to |
|---|---|
| Was the entry recorded, and is the node's skill-load declaration present? | every node |
| Do the node's documents exist, with the template's header fields and section names? | `open`, `design`, `plan`, `execute`, `subagent-execute`, `review`, `verify`, `archive` — each node is judged only on the documents it writes (next table) |
| Are all tasks complete, with a summary per completed task and an unchanged task set? | `execute`, `subagent-execute` |
| Is the self-check declared, and does a degraded one carry its evidence? | `execute`, `subagent-execute` (the SUMMARY's self-check section) |
| Did the verification actually run, and did it pass? | `verify` (runs the command block in `TEST.md`) |
| Does every review finding carry a disposition, and does a deferred major finding have a user ruling? | `review` |
| Are the archive directory and its leftover list in place? | `archive` |

Template shape is answered per document rather than per node, because two nodes can write one document between them and one node writes two:

| Node | Documents whose shape is checked |
|---|---|
| `open` | `CHANGE.md`, `REQUIREMENT.md`, and the project's `CONTEXT.md` when it exists |
| `design` | `DESIGN.md`; on a frontend change also `UI-DESIGN.md`, whose shape is checked once it exists |
| `plan` | `TASK.md`, on top of the seven fields each task block must carry |
| `execute`, `subagent-execute` | every `<task-id>-SUMMARY.md` |
| `review` | `REVIEW.md` |
| `verify` | `TEST.md`; `UAT.md` has no upstream template and is checked for existence only |
| `archive` | none — its leftover list has no upstream template either, so only its existence is checked |

The template decides the skeleton; what a template cannot express comes from the registry that ships with the skill tree — which sections are conditional, which subsections are structural, which sections this repository adds on top, and the title form and header keys the message quotes. Four boundaries follow. A conditional section must keep its heading and may say `N/A` in its body; a section marked optional may be deleted outright; a structural subsection is required once its parent section applies, and is not required when the parent is `N/A` as a whole. Sections you add beyond the template are ignored rather than refused. And when the template — or the registry — is missing, the affected documents are reported as unchecked, never as passed: there is deliberately no built-in copy of the skeleton to fall back on.

A mismatch at any of those exits — `open`, `design`, `plan`, `execute`, `subagent-execute`, `review`, `verify` — prints `BLOCKED` with the template's path and one count per category; the section names themselves — `段名` in the message — are listed only when the same document fails again. `archive` stays out of that chain: its leftover list has no skeleton to compare against.

Because the checks are structural, a payload that looks like a contract but cannot be parsed is rejected the same way a missing file is — the engine never guesses.

The self-check is validated as a declaration, not as a judgement of quality: the summary must name how the six-dimension review was run — the review engine when it was available, the engine's protocol files read by hand when it could not be loaded, or the built-in quick check as the last resort — and the built-in form must also state why the engine was unavailable and what was read instead. That declaration is checked in two places, and they are separate: the self-check-method section must name the method, and the six-dimension section must carry the method name as well — a summary that declares the built-in quick check in the method section still needs `brooks-review` or `cache-brooks` in the six-dimension section, which is the requirement the troubleshooting page states from the other side. The engine checks the wording only; whether the review was any good remains a review-time judgement.

A node's requirements can also be asked for instead of looked up in the node books: `workflow-state.mjs explain <node>` prints that node's output schemas with their artifact paths and evidence ids, its guardrails, the skills it requires, the `TEMPLATE:` line for the documents it gates (a node without a template prints none), and its entry, exit and record commands in the form this installation runs them. Every line is derived from the protocol the engine already reads, so the answer cannot drift from what the gates enforce. The command is read-only — it writes no state and changes no routing — and an unknown node name is refused together with the list of the valid ones.

### Template snapshot and fingerprint

The registry pins the template set it was built from: `templateCommit` names the upstream commit, and every template carries the sha256 of its text after the same normalization the skeleton uses — the byte-order mark dropped and CRLF or CR folded to LF, so a line-ending difference does not change the fingerprint. That snapshot is checked where the templates can be materialized: the quality job checks out the upstream commit the registry names, recomputes every template's hash through the skeleton module the gates use, and fails on any difference, on a template that cannot be derived, or on a registry commit that disagrees with the one the installer locks. Moving the snapshot therefore takes one change that updates the registry and the installer's lock together.

At run time the fingerprint is a hint rather than a gate. The guard reads only the vendored checkout's `HEAD` — no git subprocess, nothing written — and prints `TEMPLATE-FINGERPRINT WARN` when that commit differs from the registry's, then keeps validating the skeleton against the registry snapshot; the line is printed at most once per project root in a process and never blocks a node. An uncommitted byte edit to a template does not raise it either: the per-template hashes are compared in the quality job, where the locked snapshot is present, not on every exit.

### Archive nomination

The archive exit reads the nomination record instead of trusting a summary sentence: `lessonsNomination` states how many task summaries were scanned, which lessons were nominated, and — when none were — why. The scan count must equal the number of `*-SUMMARY.md` files the change actually holds, wherever its directory sits when the exit runs; every nominated id must exist in `LESSONS.md` as a real entry; and an empty nomination list must carry a non-empty reason. Anything else is refused, together with the `record` command that replaces the evidence.

The check is structural like the rest: it proves the reading happened and the ids are real, not that the nominated lessons are worth keeping — that judgement stays in review. A change created before the rule is warned rather than blocked.

### Loading a node

Entering a node hands you its two pointers before any gate runs, always in the same order: `READ PROMPT:` names the protocol prompt under `flow-kit/prompts/` — the step authority, how this step is carried out — and `READ TEMPLATE:` names the template under `flow-kit/templates/` — the shape authority, what the artifact looks like. The order carries the meaning: the step first, the shape second. A node with no upstream template (`verify`, `archive`) prints only the prompt line, and a node with no bundled prompt prints only the template line. Neither line ever names a path that does not exist, and neither depends on the coordinator remembering to say it.

Both pointers are declared when the node's skill is loaded, which is what keeps the declaration auditable against the artifacts: `--prompt` must name one of the node's own protocol files, and a declaration pointing anywhere else is refused at the next entry together with the command that re-declares it; `--templates` must match the node's template set exactly, where a missing, extra or misspelled name is refused on a new change and only warned on an older one, a node whose set is empty omits the flag, and a custom protocol node follows the `templates` its own protocol declares. The declaration records what you were told to read; the artifact gates remain the proof that it was read.

### Declared overrides of the upstream protocol

The two authorities named above — the prompt for the step, the template for the shape — can disagree. Where an upstream prompt's own section numbering or section list departs from the template, neither side is followed silently: the divergence is declared, in the entry skill and in a node book where the override is narrower, as a named list of the upstream files that stay a read-only baseline, the upstream wording that is not adopted, what is carried over, and which declaration prevails where more than one applies.

An override is a declaration, not an edit: the vendored files under `flow-kit/prompts/` and `flow-kit/templates/` stay read-only, so every divergence remains auditable against an untouched upstream. The phase gate that refuses an out-of-order node strengthens the artifact gate rather than replacing it — the artifacts remain the truth, and the gate only moves a missing artifact from a late discovery to a refused exit.

## Execution model

Work runs as a change: artifacts in `.specs/<change-id>/`, a git branch per change when the project is a git repository (`change/<change-id>`), and one node at a time. Implementation is delegated to subagents under that four-attribute contract, and they return the contract's evidence; the coordinator may not write source in the default mode. A change that needs repair after review returns through the execution node's lifecycle rather than being patched in place, so the same exit gates apply to the repair as to the original work.

### Parallel delegation

The guard decides by identity, not by path: when the host marks the caller as a subagent, subagent semantics apply before any path is resolved, and the write whitelist that binds the coordinating session no longer decides the outcome. A minimal protected set — the state file and the protocol file — stays blocked for subagents either way, because editing those by hand is what breaks the state.

| Platform | Delegation | Workspace (who builds the tree) | Write-permission channel |
|---|---|---|---|
| Claude Code | the `Agent` tool | the harness may build an isolated tree, or the subagent shares the workspace | payload `agent_id` / `agent_type` — **verified**, in a stated shape only (Windows + Claude Code v2.1.177 + `permission_mode = bypassPermissions` + a one-off repository carrier); the value domain of `agent_type`, nested delegations and non-Windows environments remain uncovered |
| dsh | the platform's in-process subagent | none — the subagent shares the workspace | identity depth passed through the bridge together with its channel marker — **verified** |
| Codex | native multi-agent sessions | shared workspace, or a tree the coordinator builds explicitly | payload `agent_id` — **verified** in an interactive session |

Coverage is stated per row and stays that way: an uncovered item is not written as supported. The only platform difference left is who builds the tree. On a shared workspace the boundary comes from disjoint task write-sets, commit-time discipline and the minimal protected set.

## Recovery

State is always re-derivable: `status` prints the machine view, `next` prints the node and the command to continue, `advance` forces the state forward when it is genuinely out of step, and `select <change-id>` switches to another change. A node that refuses an exit prints its reason; the fix is always to add what the message names — the template path and a count per category on the first refusal, the section names on the next — never to edit the state file by hand.

## Side commands

Three commands ship with the installed skill tree but stay outside the 8-node flow: `evolve`, `health` and `context-scan`. They work on the project as a whole rather than inside a single change, so they never route, never pass a node's entry or exit gate, and never record node evidence. Nothing triggers them for you either: you invoke them explicitly. `evolve` asks you to approve its candidates one by one before it writes anything; `health` writes its report when you invoke it; and `context-scan` writes its report and its scan metadata when you invoke it.

| Command | Reach for it when | What it leaves behind |
|---|---|---|
| `evolve` | Architecture sediment has piled up in archived changes and should be reviewed and folded back into the project's own documents | A report under `.specs/evolve/<YYYY-MM-DD>-EVOLVE.md`, plus the project documents patched for the candidates you approved one by one |
| `health` | You want a periodic picture of the codebase and its debt before deciding what to pick up | A report under `.specs/health/<YYYY-MM-DD>-HEALTH.md`; the findings are advice, and turning one into work is a separate decision |
| `context-scan` | The project's context document should be re-probed and compared against the previous scan | A snapshot and the difference list under `.specs/context-scan/<YYYY-MM-DD>-SCAN.md` |

When a code-health tool is present, its four-dimension result is folded into the same report with its source named; when it is absent the report keeps an explicit degradation line. A missing optional tool never fails the command.

Two boundaries are worth keeping in mind. A side command never moves the workflow on: it records no progress and cannot stand in for a node's artifacts, so it is never a shortcut past a gate. It reports rather than decides as well: `evolve` writes only what you approve item by item, `health` leaves every finding for you to act on, and none of them opens a change on your behalf. The status view adds one line when architecture sediment is due — a reminder that suggests the command and runs nothing by itself.

The protocol composer is the one further side command and is described under [Custom protocols](#custom-protocols); the entry points and the platform-specific command paths are in [Usage](USAGE.md).

## Custom protocols

`/flow-comet-compose` is a side command (not part of the 8-node flow) that guides you through composing any installed skill into a custom workflow protocol in JSON. The custom protocol is then driven by the same engine — state routing, guard validation and hook interception — with no new runtime capability required. The built-in 8-node protocol remains the default and is not replaced.

**Loading a protocol.** Priority is `--protocol <path>` (or `--protocol=<path>`) on the command line, then the `FLOW_COMET_PROTOCOL` environment variable (persistent when set in the platform's project environment), then the built-in default. Without an explicit choice, everything behaves exactly like the built-in protocol.

**Minimal structure.** A protocol declares `schemaVersion` (`1`), `kind`, `name`, a `nodes[]` array, an `outputSchemas[]` array, and optionally `writeWhitelist` and `taskFile`. Each node names the skill that implements it (`implementation.skill`) and the output schemas it must satisfy.

**Rules that make it work.**

1. **Every node must have artifacts** — each referenced schema must exist in `outputSchemas[]` with non-empty artifact paths; without artifacts there is nothing to validate or recover from.
2. **Every node must have evidence** — each schema carries its evidence ids, which is what `record` writes and the exit checks.
3. **Node ids must avoid the built-in eight** — `open`, `design`, `plan`, `execute`, `subagent-execute`, `review`, `verify` and `archive` are reserved.
4. **Write boundaries are declared** — a protocol may supply a whitelist (node id → allowed path prefixes, with a `<change-id>` placeholder so one protocol serves every change). When omitted, the built-in ids keep the built-in table and custom ids default to the coordinator whitelist, which allows writing under `.specs/` and requires an explicit declaration for anything else.
