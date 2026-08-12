<div align="right">

[English](README.md) · [中文](README-zh.md)

</div>

# flow-comet artifact examples

Artifacts produced by a complete flow-comet run, for reference and comparison. **This is simulated data** — a synthetic project used to demonstrate artifact quality, not a real codebase.

## Scenario: venue filter for tournaments

A feature change in a simulated ping-pong tournament system: admins filter tournaments by venue on the tournament list page. Involves a backend API `venue_id` query parameter + a frontend filter dropdown.

## Artifact list (in flow-kit 9-stage order)

| File | Stage | Description |
|------|-------|-------------|
| CHANGE.md | open | Change proposal (Why/What/impact/scope-exclusion/risks) |
| REQUIREMENT.md | open | Requirements (AC Given/When/Then + scope split) |
| DESIGN.md | design | Technical decisions (§0 stack / §0.5 architecture / decision list / dataflow / risks) |
| TASK.md | plan | Atomic tasks (XML + wave planning + 7 fields) |
| T01-SUMMARY.md | subagent-execute | Parallel-task output (6-dimension self-check + boundary check) |
| T02-SUMMARY.md | subagent-execute | Parallel-task output |
| T03-SUMMARY.md | execute | Serial-task output |
| T04-SUMMARY.md | execute | Serial-task output |
| T05-SUMMARY.md | execute | Serial-task output (with regression tests) |
| REVIEW.md | review | 4-round review (spec compliance / 6-dimension diagnosis / UI visual / cross-model) |
| TEST.md | verify | 5-tier test pyramid (function/performance/security/compatibility/observability) |
| UAT.md | verify | User acceptance test results |

## Usage

- **Quality reference**: compare new change artifacts section-by-section to confirm required sections
- **Understand flow-kit templates**: the example is a filled instance of the `flow-kit/templates/` templates
- **Verify flow-comet guard**: this example passed all flow-comet guard validations (open/design/plan/execute/review/verify exits all PASS)

## Notes

- Artifact language follows the example project's primary language (Chinese) — per flow-kit R8.1
