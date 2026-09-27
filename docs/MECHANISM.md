# Core Mechanisms

The behaviour layer: what the engine guarantees, how a node's exit is validated, how execution is isolated, and how to run a workflow of your own on the same engine. Step-by-step usage lives in [Usage](USAGE.md); installation in [Installation](INSTALLATION.md).

## Behaviour contract

- **File as truth.** The state machine lives in a single file (`.flow-comet/flow-comet-state.json`) and is only ever advanced by the guard's exit command. Everything the engine needs to know about the work is derivable from the artifacts under `.specs/`; no progress is stored in a conversation, so any session can resume by re-reading them.
- **Gates, not advice.** Advancing from a node is a validated transition, not a suggestion: the guard checks the node's artifacts, their structure, the evidence recorded for the node, and the declarations the workflow requires.
- **Fail-closed by default.** When a decision cannot be proven safe — the protocol file cannot be read, the state or a payload cannot be parsed, the workflow status is unknown, a path cannot be shown to stay inside the project — the engine refuses instead of proceeding. Only clearly idle states (no change, or a completed change) are treated as unconstrained.
- **Declared boundaries.** Anything that looks like user authority — accepting a repair round past its cap, re-entering an archived change, taking over a task from the coordinator — must be an explicit, recorded declaration. The engine treats silence as refusal.

## Three defense layers

| Layer | What it does | Where it is enforced |
|---|---|---|
| ① Physical write interception | Before a tool writes, the platform hook checks the target against the current node's write whitelist; out-of-scope writes are refused in the platform itself | the platform's `PreToolUse` hook, installed by the installer |
| ② Guard validation | Node entry and exit are validated against evidence: required artifacts and sections, recorded node evidence, the skill-load declaration, the task-set signature, summaries for completed tasks, review dispositions, and the test commands that `verify` actually runs | the guard's `entry` / `exit` |
| ③ State and schema validation | Every state write is validated against the schema (field types, nested records), and unwritable shapes are rejected rather than silently normalized | the state machine's write path |

The same discipline gives the coordinator an enforced boundary: in the default execution mode the coordinating session may not carry out implementation tasks itself (the engine reports the takeover). Implementation is delegated to isolated subagents that must return a verifiable contract — a commit, the real output of their verification, and the checks they declared.

**Hook blocking semantics and their limits.** The hook blocks a write by exiting with status 2 and printing the reason; in an interactive platform session that is a refusal. Two platform-level preconditions are worth knowing, because when they are missing the hook *cannot* refuse even though the mechanism is intact:

- Claude Code runs the hook through the shell it can find; if the host cannot discover a Bash (for example Git Bash on Windows), the hook falls back to a shell where the installed command form does not run, and a non-zero status is not treated as a block. Giving the platform the path to a POSIX shell restores blocking.
- Codex only executes project hooks when its hook-trust has been accepted (interactive `/hooks`), or when a scripted run passes the platform's bypass flag. Without either, the hook is simply not executed.

Both are host preconditions rather than engine behaviour; with them satisfied, a real session refuses an out-of-scope write and allows the same write once the node permits it.

## Guard validation

At each node the guard answers a fixed set of questions; a "no" is a refusal with the reason and the command that fixes it:

| Question | Applies to |
|---|---|
| Was the entry recorded, and is the node's skill-load declaration present? | every node |
| Do the node's documents exist, with the template's header fields and section names? | `open`, `design`, `plan`, `review`, `archive` |
| Are all tasks complete, with a summary per completed task and an unchanged task set? | `execute`, `subagent-execute` |
| Did the verification actually run, and did it pass? | `verify` (runs the command block in `TEST.md`) |
| Does every review finding carry a disposition, and does a deferred major finding have a user ruling? | `review` |
| Are the archive directory and its leftover list in place? | `archive` |

Because the checks are structural, a payload that looks like a contract but cannot be parsed is rejected the same way a missing file is — the engine never guesses.

## Execution model

Work runs as a change: artifacts in `.specs/<change-id>/`, a git branch per change when the project is a git repository (`change/<change-id>`), and one node at a time. Implementation is delegated to subagents that work in isolation and return a contract; the coordinator may not write source in the default mode. A change that needs repair after review returns through the execution node's lifecycle rather than being patched in place, so the same exit gates apply to the repair as to the original work.

## Recovery

State is always re-derivable: `status` prints the machine view, `next` prints the node and the command to continue, `advance` forces the state forward when it is genuinely out of step, and `select <change-id>` switches to another change. A node that refuses an exit prints what is missing; the fix is always to add what the message names, never to edit the state file by hand.

## Custom protocols

`/flow-comet-compose` is a side command (not part of the 8-node flow) that guides you through composing any installed skill into a custom workflow protocol in JSON. The custom protocol is then driven by the same engine — state routing, guard validation and hook interception — with no new runtime capability required. The built-in 8-node protocol remains the default and is not replaced.

**Loading a protocol.** Priority is `--protocol <path>` (or `--protocol=<path>`) on the command line, then the `FLOW_COMET_PROTOCOL` environment variable (persistent when set in the platform's project environment), then the built-in default. Without an explicit choice, everything behaves exactly like the built-in protocol.

**Minimal structure.** A protocol declares `schemaVersion` (`1`), `kind`, `name`, a `nodes[]` array, an `outputSchemas[]` array, and optionally `writeWhitelist` and `taskFile`. Each node names the skill that implements it (`implementation.skill`) and the output schemas it must satisfy.

**Rules that make it work.**

1. **Every node must have artifacts** — each referenced schema must exist in `outputSchemas[]` with non-empty artifact paths; without artifacts there is nothing to validate or recover from.
2. **Every node must have evidence** — each schema carries its evidence ids, which is what `record` writes and the exit checks.
3. **Node ids must avoid the built-in eight** — `open`, `design`, `plan`, `execute`, `subagent-execute`, `review`, `verify` and `archive` are reserved.
4. **Write boundaries are declared** — a protocol may supply a whitelist (node id → allowed path prefixes, with a `<change-id>` placeholder so one protocol serves every change). When omitted, the built-in ids keep the built-in table and custom ids default to the coordinator whitelist, which allows writing under `.specs/` and requires an explicit declaration for anything else.
