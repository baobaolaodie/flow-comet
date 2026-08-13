<div align="right">

[English](README.md) · [中文](README-zh.md)

</div>

# flow-comet artifact examples — processor-pipeline

**This is a real archived change** — the complete artifact set of a full 8-node flow-comet run (open → design → plan → execute → subagent-execute → review → verify → archive) in the flow-comet-e2e fake project, archived on 2026-08-13. Use it as the quality reference for what a complete change's artifacts look like under the current artifact system (six-section SUMMARYs, review disposition markers, skill-load declaration markers).

## Scenario: processor package pipeline enhancement

A brownfield change to the e2e project's `processor/` package (pure-Python data-processing library: dedupe / chunk / sort / stats): add a `pipe` composition function plus parameter enhancements (dedupe `key`, chunk `max_size`, sort `key`/`reverse`), with regression (82 existing tests → 101, zero breakage). The change exercises the full mechanism surface: parallel delegation (T01/T02, independent modules), serial delegation (T03/T04), a dependent combination task (T05), and a wrap-up task (T06).

## Artifact list (in flow-kit 9-stage order)

| File | Stage | Description |
|------|-------|-------------|
| CHANGE.md | open | Change proposal (Why/What/impact/scope-exclusion/acceptance line) |
| REQUIREMENT.md | open | Requirements + ACs (Given/When/Then) + scope split |
| DESIGN.md | design | Technical decisions (§0 stack / §0.5 architecture / decision list / risks) |
| TASK.md | plan | Atomic tasks (XML + wave planning + 7 fields) |
| T01-SUMMARY.md | subagent-execute | Six-section SUMMARY (what / changed files / verify output / 6-dim self-check / boundary check / self-check method) |
| T02-SUMMARY.md | subagent-execute | Six-section SUMMARY |
| T03-SUMMARY.md | execute | Six-section SUMMARY |
| T04-SUMMARY.md | execute | Six-section SUMMARY |
| T05-SUMMARY.md | execute | Six-section SUMMARY |
| T06-SUMMARY.md | execute | Six-section SUMMARY (full regression + docs) |
| REVIEW.md | review | Review report (findings with disposition markers `[已修]/[升级]/[转待办]`) |
| TEST.md | verify | 5-tier test pyramid + `## 验证命令` (actually executed at verify exit) |
| UAT.md | verify | Acceptance results (per-AC pass/fail) |
| KNOWN-ISSUES.md | archive | Follow-up items ([转待办] findings from REVIEW) |
| `.skill-loads/` | throughout | Skill-load declaration markers (11 files — one per node-skill declaration) |

## Usage

- **Quality reference**: compare new change artifacts section-by-section to confirm required sections
- **Understand flow-kit templates**: the example is a filled instance of the `flow-kit/templates/` templates
- **Verify flow-comet guard**: this example passed all guard validations with no warnings — open/design/plan/execute/review exits all PASS; verify exit really executed `pytest -q` (101 passed); SUMMARYs declare the self-check method, review findings carry disposition markers

## Notes

- This is a real archived change from the e2e fake project — code path references point to the e2e `processor/` package (not shipped here); artifacts are the actual production of the flow, not simulated
- Artifact language follows the example project's primary language (Chinese) — per flow-kit R8.1
