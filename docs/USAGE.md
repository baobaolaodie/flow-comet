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

### Node responsibilities

| Node | Responsibility | Key artifacts | Exit validation (guard) |
|------|---------------|---------------|------------------------|
| **open** | CHANGE clarification + requirements (AC derivation) | `CHANGE.md` / `REQUIREMENT.md` / CONTEXT terms | Required sections (template-derived): `## Why` / `## 用户故事` / acceptance; CONTEXT orphan-section detection |
| **design** | Tech-stack selection + architecture alignment + decisions | `DESIGN.md` (§0 stack / §0.5 architecture / decision list / risks) | §0 sections + `## 决策清单` (template-derived, numbered) |
| **plan** | Atomic task breakdown (XML) + wave planning | `TASK.md` (`<task>` blocks with 7 fields + parallel markers) | task blocks + verify field; TASK signature hash (recorded at enter) |
| **execute** | Serial task execution (coordinator delegates subagents) | `<task-id>-SUMMARY.md` | SUMMARY six sections + 6-dimension self-check + mandatory `## 自检方法`; TASK signature compare; takeover detection |
| **subagent-execute** | Parallel task delegation (waves) | same (one SUMMARY per task) | same + handoff evidence (Return Contract) |
| **review** | Two-round review (spec compliance + code quality) | `REVIEW.md` (Critical/findings/conclusion) | ≥100B + required sections |
| **verify** | Integration verification + UAT + failure diagnosis (≤3 rounds) | `TEST.md` / `UAT.md` / LESSONS nominations | verification commands actually executed; UAT sections; LESSONS numbering/placement |
| **archive** | LESSONS nominations + archive + branch wrap-up | `.specs/archive/<date>-<id>/` / CHANGELOG | branch check (new mode); CHANGELOG ordering |

## Artifacts

All workflow artifacts live in `.specs/` (project-level) and `.specs/<change-id>/` (per change):

| File | Location | Purpose | Produced at |
|------|----------|---------|-------------|
| `CHANGE.md` | change dir | change proposal (Why/What/impact/scope-exclusion/acceptance line) | open |
| `REQUIREMENT.md` | change dir | requirements + ACs (Given/When/Then) + v1·v2·out scope split | open |
| `DESIGN.md` | change dir | technical decisions (§0 stack/§0.5 architecture/decision list/risks) | design |
| `TASK.md` | change dir | atomic tasks (XML 7 fields + parallel markers + wave planning) | plan |
| `<task-id>-SUMMARY.md` | change dir | per-task report (six sections: what/changed files/verify output/6-dim self-check/boundary check/self-check method) | execute / subagent-execute |
| `<task-id>-PROGRESS.md` | change dir | mid-task context-window snapshot (temporary, removed on resume) | execute (temporary) |
| `TEST.md` | change dir | 5-tier test pyramid + verification commands + UAT script | review |
| `REVIEW.md` | change dir | review report (Critical/findings/conclusion) | review |
| `UAT.md` | change dir | acceptance results (per-item pass/fail) | verify |
| `CONTEXT.md` | `.specs/` | project-level shared context (glossary/locked decisions/defaults) | open (append each time) |
| `LESSONS.md` | `.specs/` | cross-task failure knowledge base (L-NNN numbered entries) | verify / archive |
| `CHANGELOG.md` | `.specs/` | change log (table, newest date first) | archive |
| `.comet/flow-comet-state.json` | `.comet/` | state machine (activeChange/currentNode/completedNodes/evidence/…) | throughout (script-managed) |

> **Append placement discipline**: CONTEXT terms → glossary table, decisions → locked-decision list; LESSONS → entries section by L-NNN; STATE/CHANGELOG → top (reverse order); T-FIX → `## Fix 任务` section — guard detects violations (progressive WARN).

## Branch mode

All branch operations are **executed automatically by Claude under the skill protocol** (no manual git):

- First `/flow-comet` call creates the `change/<change-id>` branch (git repos), workflow runs on it; prefix configurable (`init --branch-prefix <prefix>`, e.g. `feat/`, must end with `/`, default `change/`)
- Archive wrap-up: merges back to main + deletes the branch (`enablePrReview=true` pushes + PR first; **pauses for your confirmation before merge**)
- Branch-state consistency: `status`/`next` detect branch/activeChange mismatch → WARN (not BLOCK)
- **Backward compatible**: old changes without a branch run unchanged (branch checks apply to new mode only)

## Execution modes (executionMode)

| Mode | Semantics | When |
|------|-----------|------|
| `subagent` (default) | Unified delegation: coordinator builds handoff → Agent worktree delegation → collects Return Contract → marks done | Default quality guarantee |
| `direct` (escape hatch) | Main agent executes serial tasks directly (must load full flow-comet-dev protocol) | After explicit user switch (`workflow-state.mjs execution-mode direct`) |

`directOverride` records "currently in user-confirmed direct" and is cleared when switching back to subagent.

## Express path (low-risk downgrade)

When CHANGE.md carries `express: true` (low-risk: ≤3 files, no backend schema/API/DB changes, no security/auth/concurrency, pure frontend refactor/copy/simple bug fix):

- **review** runs only Round 1 (spec compliance) + Round 1.5 (contract check), skipping code-quality and UI rounds
- **TEST/UAT** use a minimal matrix (Round 1 functionality + core AC manual confirmation); REVIEW.md is marked "express 审查"

## User entry points

In the target project, open Claude Code and enter:

| Entry | Purpose |
|-------|---------|
| `/flow-comet` | Start or continue the 8-node workflow (auto-detects active change, routes to current node) |
| `/flow-comet-compose` | Compose installed skills into a custom protocol (side command, not part of the 8-node flow — see [PROTOCOL.md](PROTOCOL.md)) |
| `/flow-comet-evolve` | Scan archived changes' DESIGN §9, batch-review sediment candidates (side) |
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

## Script reference (engine-internal, executed automatically by Claude)

These scripts are **run automatically by the flow-comet skill** — you normally never run them manually; use only for troubleshooting or advanced scenarios. Path: `<target project>/.claude/skills/flow-comet/scripts/`:

```bash
node workflow-state.mjs status             # current state + branch consistency
node workflow-state.mjs init <id> [--branch-prefix <prefix>]   # init change (auto branch, prefix default change/)
node workflow-state.mjs next               # next node + SKILL
node workflow-state.mjs record <node> '{...}'                  # record node evidence
node workflow-state.mjs config set enablePrReview true         # enable PR review
node workflow-state.mjs execution-mode <subagent|direct>       # switch execution mode (direct needs confirmation)
node workflow-guard.mjs entry/exit <node> [--apply]            # node gates
node workflow-handoff.mjs request|result|status                # subagent delegation handoff
```

**Subagent delegation** (execute/subagent-execute nodes, executed by Claude): parse write_files from TASK.md → `workflow-handoff.mjs request` → Agent tool (`isolation: "worktree"`) delegation with Return Contract → `result` records evidence → guard validates the delegation.
