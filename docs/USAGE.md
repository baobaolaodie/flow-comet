# Usage

How the workflow behaves, how a node is driven, where artifacts live, and what you actually invoke.

Everything here is done inside the project you installed into, with the installed copy of the engine (`.claude/skills/flow-comet/scripts/` for Claude Code, `.agents/skills/...` for Codex, `.dsh/skills/...` for dsh). The authoritative source in a flow-comet checkout is for developing flow-comet itself; the engine also refuses to read a protocol file from outside the project root.

## The 8-node workflow

| # | Node | Responsibility | Kind |
|---|---|---|---|
| 1 | `open` | Frame the change: why, what, scope, coarse acceptance line | control |
| 2 | `design` | Tech-stack decision, decisions list, data flow, risks, out of scope | control |
| 3 | `plan` | Wave/task breakdown with boundaries and a verify command per task | control |
| 4 | `execute` | Coordinator-led task execution against that plan | control |
| 5 | `subagent-execute` | Delegated task execution with a handoff request and a Return Contract | handoff |
| 6 | `review` | Multi-round review; findings must carry a disposition | control |
| 7 | `verify` | Integration verification; the exit actually runs the test commands | control |
| 8 | `archive` | Compile leftovers, move the change into the archive, record it | control |

`next` tells you where you are; `status` prints the machine state. Both are read-only.

## How you use it

You invoke the workflow once per session and it drives itself from there. In Claude Code that is the entry skill `/flow-comet`; in Codex, invoke the skill (`/use flow-comet`) or ask for the workflow in natural language; in DeepSeek Harness, invoke the `flow-comet` skill. The first call confirms scope, creates the change's branch, initializes the state and enters the first node; afterwards the workflow routes each stage and stops only at decision points.

The per-node lifecycle described below is what the workflow runs for you — and what you run yourself when you are driving a node by hand (recovering a stuck change, or working inside the engine).

## Driving a node

Every node has the same lifecycle. The guard records the entry, you load the node's skill, declare it, work, record the node's evidence, and the guard validates the exit:

```bash
node <skills>/flow-comet/scripts/workflow-guard.mjs entry <node> --apply        # guard: enter
node <skills>/flow-comet/scripts/workflow-state.mjs  skill-load <node> <skill>  # declare the loaded skill
node <skills>/flow-comet/scripts/workflow-state.mjs  record <node> '{"summary":"..."}'
node <skills>/flow-comet/scripts/workflow-guard.mjs exit <node> --apply         # guard: exit
```

`<skills>` is `.claude/skills` / `.agents/skills` / `.dsh/skills` depending on the platform. The two command surfaces are distinct:

| Command | What it owns |
|---|---|
| `workflow-guard.mjs` | `entry` / `exit` — the gates. Exits validate the node's artifacts, sections, declarations and (for `verify`) run the test commands |
| `workflow-state.mjs` | `init`, `status`, `next`, `select`, `record`, `verify-fail`, `advance`, `execution-mode`, `config`, `skill-load`, `bridge-check`, `reenter`, `replan` — the state machine and its bookkeeping |

A node's exit refuses to pass when its artifacts are incomplete or malformed, when the skill-load declaration is missing, or when the entry was never recorded; each refusal prints the reason and the command that fixes it. Nothing about the state is stored in the conversation: re-derive it with `status` / `next`.

## Artifacts

A change lives in `.specs/<change-id>/`:

| File | Written during | Holds |
|---|---|---|
| `CHANGE.md` | `open` | Why / what / impact / scope exclusions / coarse acceptance line / risks |
| `REQUIREMENT.md` | `open` | User stories, acceptance criteria, scope split, non-functional needs |
| `DESIGN.md` | `design` | Tech stack, decisions list, data flow, state machine, risks, §9 sedimentation notes |
| `TASK.md` | `plan` | Wave plan, task blocks (name / read / write / action / verify / done / depends_on), status fields |
| `<task-id>-SUMMARY.md` | `execute` | One per completed task: what was done, files changed, verify output, self-check, boundary check |
| `REVIEW.md` | `review` | Review rounds and findings, each with a disposition marker |
| `TEST.md` | `review` | The five-round test picture and the `## 验证命令` block that `verify` executes |
| `UAT.md` | `verify` | Acceptance items and their results |
| `KNOWN-ISSUES.md` | `archive` | Everything still open or explicitly out of scope |
| `.skill-loads/` | every node | The declaration markers, one per node and skill |

On archive the whole directory moves to `.specs/archive/<YYYY-MM-DD>-<change-id>/` and a row is appended to `.specs/CHANGELOG.md`. Nothing in `.specs/` is committed: it is the runtime record of the work, kept out of the repository by the entry the installer manages in `.gitignore`.

## Discipline the engine enforces

- **Artifact fidelity** — a node's document must match the flow-kit template's header fields and section names; the guard refuses an exit otherwise.
- **Evidence before exit** — `record <node>` writes the node's evidence, and the exit requires it (plus the skill-load declaration).
- **Summary skeleton** — every completed task needs its `<task-id>-SUMMARY.md` with the template's sections, including the self-check and the boundary check.
- **Tests actually run** — the `verify` exit executes the command block in `TEST.md` and counts failures; a failing command blocks the exit.
- **Plan re-validation is controlled** — when the plan is proven wrong mid-node, `replan "<reason>" --authorized-by <source>` is the only compliant way to re-validate and re-sign the task set. It re-runs the same task-graph and field checks the plan exit runs, so it never waives any gate. Every call needs an explicit authorization, is capped at 3 rounds per change (a further round only via the explicit continuation parameter), writes a state backup before it changes anything, and a repeated call of the same shape is a no-op.
- **Review findings stay visible** — each finding in `REVIEW.md` needs a disposition marker (fixed / escalated / deferred), and deferring a major finding asks for a user ruling.
- **Coordinator boundary** — in the default `subagent` execution mode the coordinating session may not carry out tasks itself; the engine reports a takeover instead. The documented escape hatch is an explicit `record execute '{"parallelTakeoverApproved":true}'` declaration.
- **Archive completeness** — the archive exit requires the archived directory and a `KNOWN-ISSUES.md` inside it (write "no leftovers" explicitly when there are none).

## Branch mode and execution mode

In a git project the engine works on a branch per change: `init <change-id>` creates and switches to `change/<change-id>`, and `next` reports the branch line. In a project without git the same line reports `none`.

Execution mode defaults to `subagent` (implementation delegated to isolated subagents with a Return Contract). `execution-mode direct` switches the coordinator to doing the work itself and records the explicit authorization; `execution-mode subagent` switches back.

## User entry points

| Entry | Purpose |
|---|---|
| `/flow-comet` | Start or continue the 8-node workflow — routes to the node the artifacts say you are on |
| `/flow-comet-compose` | Compose installed skills into a custom protocol (side command, not part of the 8-node flow) — see [Custom protocols](MECHANISM.md#custom-protocols) |

The remaining skill directories in the installed tree (`flow-comet-open`, `-design`, `-plan`, `-execute`, `-subagent-execute`, `-review`, `-verify`, `-archive`, …) are the per-node skills the workflow loads as it advances; you do not invoke them directly. Three further commands ship with the same tree — `evolve`, `health` and `context-scan` — each backed by a deterministic script on the engine side. They stay outside the 8-node flow and run only when you invoke them explicitly; [Side commands](MECHANISM.md#side-commands) covers what each one does.

## Decisions and recovery

During a node you will occasionally have to decide something. The four classes — user decision, auto-handled, stop condition, manual handover — and the per-node list of decision points are in `reference/decision-points.md` inside the skill tree.

When a node is stuck: `status` shows the machine state, `next` shows the node and the command to continue, `advance` forces the state forward when it is genuinely out of step, and `select <change-id>` switches to another change. Symptoms and their fixes are grouped in [Troubleshooting](TROUBLESHOOTING.md).
