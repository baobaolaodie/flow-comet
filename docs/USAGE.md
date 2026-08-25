<div align="right">

[English](USAGE.md) · [中文](USAGE-zh.md)

</div>

# Usage

## The 8-node workflow

```
open → design → plan → execute ⇄ subagent-execute → review → verify → archive
```

**Mapping to flow-kit's 9 stages**: the `open` node produces both CHANGE and REQUIREMENT artifacts (`CHANGE.md` + `REQUIREMENT.md`); the rest map one-to-one (design = design stage; execute/subagent-execute = DEV/TEST execution split; review/verify/archive = REVIEW/INTEGRATION/ARCHIVE).

Routing is **derived from `.specs/` artifacts** (determineNode): missing files → the node stops there; unfinished tasks → stays at execute; everything done → advances through review/verify/archive.

**Multi-pass routing between `execute` and `subagent-execute`** is dependency-topology driven: each pass enters `subagent-execute` to delegate the parallel tasks whose dependencies (`<depends_on>`) are satisfied, returns to `execute` for the runnable serial tasks between waves, and re-enters `subagent-execute` when the next parallel wave becomes eligible — alternating until no runnable task remains, then advancing to `review`. There is **no single-pass limit**: mixed topologies (serial → parallel → serial → parallel) are legal and are digested pass by pass by dependency topology; dependency cycles or missing dependencies are rejected at the plan exit (see [TROUBLESHOOTING](TROUBLESHOOTING.md)).

### Node responsibilities

| Node | Responsibility | Key artifacts | Exit validation (guard) |
|------|---------------|---------------|------------------------|
| **open** | CHANGE clarification + requirements (AC derivation) | `CHANGE.md` / `REQUIREMENT.md` / CONTEXT terms | Required sections (template-derived): `## Why` / `## 用户故事` / acceptance; CONTEXT orphan-section detection |
| **design** | Tech-stack selection + architecture alignment + decisions | `DESIGN.md` (§0 stack / §0.5 architecture / decision list / risks) | §0 sections + `## 决策清单` (template-derived, numbered) |
| **plan** | Atomic task breakdown (XML) + wave planning | `TASK.md` (`<task>` blocks with 7 fields + parallel markers) | task blocks + verify field |
| **execute** | Serial task execution (coordinator delegates subagents; re-entered on each pass) | `<task-id>-SUMMARY.md` | SUMMARY six sections + 6-dimension self-check + mandatory `## 自检方法`; TASK signature hash (recorded at enter, compared at exit); takeover detection |
| **subagent-execute** | Parallel task delegation (waves; re-entered per dependency topology) | same (one SUMMARY per task) | same + handoff evidence (Return Contract) |
| **review** | 4-round review (spec compliance / code quality / UI visual / optional) | `REVIEW.md` (Critical/findings/conclusion) | ≥100B + required sections |
| **verify** | Integration verification + UAT + failure diagnosis (≤3 rounds) | `TEST.md` / `UAT.md` / LESSONS nominations | verification commands actually executed; UAT.md exists; LESSONS numbering/placement |
| **archive** | LESSONS nominations + archive + branch wrap-up | `.specs/archive/<date>-<id>/` / CHANGELOG | branch check (new mode); CHANGELOG ordering + registration hint |

## Artifacts

All workflow artifacts live in `.specs/` (project-level) and `.specs/<change-id>/` (per change):

| File | Location | Purpose | Produced at |
|------|----------|---------|-------------|
| `CHANGE.md` | change dir | change proposal (Why/What/impact/scope-exclusion/acceptance line) | open |
| `REQUIREMENT.md` | change dir | requirements + ACs (Given/When/Then) + v1·v2·out scope split | open |
| `DESIGN.md` | change dir | technical decisions (§0 stack/§0.5 architecture/decision list/risks) | design |
| `TASK.md` | change dir | atomic tasks (XML 7 fields + parallel markers + wave planning) | plan |
| `<task-id>-SUMMARY.md` | change dir | per-task report (six sections: what/changed files/verify output/6-dim self-check/boundary check/self-check method) | execute / subagent-execute |
| `<task-id>-PROGRESS.md` | change dir | mid-task context-window snapshot (temporary, deleted on completion, useful info migrated to SUMMARY) | execute (temporary) |
| `TEST.md` | change dir | 5-tier test pyramid + verification commands + UAT script | review |
| `REVIEW.md` | change dir | review report (Critical/findings/conclusion) | review |
| `UAT.md` | change dir | acceptance results (per-item pass/fail) | verify |
| `CONTEXT.md` | `.specs/` | project-level shared context (glossary/locked decisions/defaults) | open (append each time) |
| `LESSONS.md` | `.specs/` | cross-task failure knowledge base (L-NNN numbered entries) | verify / archive |
| `CHANGELOG.md` | `.specs/` | change log (table, newest date first) | archive |
| `.comet/flow-comet-state.json` | `.comet/` | state machine (activeChange/currentNode/completedNodes/evidence/…) | throughout (script-managed) |

> **Append placement discipline**: CONTEXT terms → glossary table, decisions → locked-decision list; LESSONS → entries section by L-NNN; STATE/CHANGELOG → top (reverse order); rollback fixes → `## Fix 任务` section — guard detects violations (progressive WARN).

## Workflow discipline

- **`.specs/` artifacts are never committed**: SUMMARY / handoff / TASK and all other workflow artifacts stay in the working tree. If `git add` rejects them, that is correct behavior — **force-add (`-f`) is forbidden**.
- **JSON payloads travel by file**: `record` and `workflow-handoff` payloads should be written to a UTF-8 file and passed with `--json-file <file>` instead of inline arguments — avoids Windows PowerShell quote stripping and silent JSON corruption.
- **SUMMARY template discipline**: every SUMMARY must contain a `## 自检方法` section, placed **after the bounds check** (`## 越界检查`); the 6-dimension self-check must declare one of the three self-review values — `brooks-review` (full Skill review), `cache-brooks` (manual execution from the plugin-cache protocol files), or `builtin-quickcheck` (built-in fallback — must declare the unavailability reason and the cache-attempt evidence).
- **Pseudo-parallel hint**: if a parallel task's `write_files` contain only test files (`tests/` / `test_` prefixes) and no production code file, the plan exit emits a progressive **WARN** (not a BLOCK) listing the task ids and suggesting to add a `depends_on` declaration or merge the task into a vertical slice (production code + its tests in one task).

## Branch mode

All branch operations are **executed automatically by Claude under the skill protocol** (no manual git):

- First `/flow-comet` call creates the `change/<id>` branch (git repos), workflow runs on it; prefix configurable (`init --branch-prefix <prefix>`, e.g. `feat/`; a trailing `/` is added automatically if missing, default `change/`)
- Archive wrap-up: merges back to main + deletes the branch (`enablePrReview=true` pushes + PR first; **pauses for your confirmation before merge**)
- Branch-state consistency: `status`/`next` detect branch/activeChange mismatch → WARN (not BLOCK)
- **Backward compatible**: old changes without a branch run unchanged (branch checks apply to new mode only)

## Execution modes (executionMode)

| Mode | Semantics | When |
|------|-----------|------|
| `subagent` (default) | Unified delegation: coordinator builds handoff → Agent worktree delegation → collects Return Contract → marks done | Default quality guarantee |
| `direct` (escape hatch) | Main agent executes serial tasks directly (must load full flow-comet-dev protocol) | After explicit user switch (`workflow-state.mjs execution-mode direct`) |

`directOverride` records "currently in user-confirmed direct" and is cleared when switching back to subagent.

## User entry points

In the target project, open a Claude Code session and enter (Codex: invoke the skill via `/use flow-comet` or natural language — same entry semantics):

| Entry | Purpose |
|-------|---------|
| `/flow-comet` | Start or continue the 8-node workflow (auto-detects active change, routes to current node) |
| `/flow-comet-compose` | Compose installed skills into a custom protocol (side command, not part of the 8-node flow — see [PROTOCOL.md](PROTOCOL.md)) |
| `/flow-comet-evolve` | Scan archived changes' DESIGN §9, review sediment candidates in bulk (side) |
| `/flow-comet-health` | Periodic health check: CONTEXT consistency / LESSONS scan / tech debt / redundancy (side) |

## Decision points

flow-comet **pauses for your confirmation** at these points (everything else advances automatically):

| Node | Decision point |
|------|----------------|
| First call | change scope (when multiple valid interpretations exist) |
| design | tech-stack selection (5–6 candidate cards) |
| execute | destructive change detection (R4.6); schema migration (R4.5) |
| review | Critical findings handling |
| verify | 4th consecutive UAT failure: "continue / stop" |
| archive | archiving + merging the change branch to main (irreversible) |
| pre-archive | PR approve (when `enablePrReview` is on) |

## Script reference (executed automatically by Claude)

These scripts are **run automatically by the flow-comet skill** — you normally never run them manually; use only for troubleshooting or advanced scenarios. Path: `<target project>/.claude/skills/flow-comet/scripts/` (Claude Code; Codex: `<target project>/.agents/skills/flow-comet/scripts/`):

```bash
node workflow-state.mjs status             # current state + branch consistency
node workflow-state.mjs init <id> [--branch-prefix <prefix>] [--init-context|--init-skip]   # init change (auto branch, prefix default change/; --init-context prompts context generation — the agent reads existing docs and generates CONTEXT.md, re-run after generation to validate and record the scan timestamp; --init-skip records skip)
node workflow-state.mjs next               # next node + SKILL
node workflow-state.mjs record <node> '{...}' [--json-file <path>]   # record node evidence (--json-file reads the payload from a file, avoiding Windows PowerShell quote stripping)
node workflow-state.mjs config set enablePrReview true         # enable PR review
node workflow-state.mjs execution-mode <subagent|direct>       # switch execution mode (direct needs confirmation)
node workflow-guard.mjs entry/exit <node> [--apply]            # node gates
node workflow-handoff.mjs request|result|status [--json-file <path>]  # subagent delegation handoff (--json-file same as record)
node workflow-state.mjs skill-load <node> <skill> [--prompt <path>]  # skill-load declaration (run by Claude; --prompt points at flow-kit/prompts/)
node workflow-state.mjs verify-fail                            # verify failure counter (3 retries, 4th BLOCKED)
```

**Subagent delegation** (execute/subagent-execute nodes, executed by Claude): parse write_files from TASK.md → `workflow-handoff.mjs request` → Agent tool (`isolation: "worktree"`) delegation with Return Contract → `result` records evidence → guard validates the delegation.
