---
name: flow-comet-archive
description: "Use only when explicitly invoked as /flow-comet-archive or routed by the flow-comet entry/runtime to the archive Node; complete Archive for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Archive

## Node Goal

Complete the `archive` Node for `flow-comet`.

Responsibility: LESSONS 提名 + 归档到 .specs/archive/ + CHANGELOG 更新。

## Guidance

---
name: flow-comet-archive
description: "Archive node for flow-comet: scans SUMMARY.md files for lessons, adds qualifying lessons to .specs/LESSONS.md, moves change to .specs/archive/, and updates CHANGELOG.md. Do not use for ordinary standalone tasks."
---

# Archive

## Node Goal

This node finalizes a completed change by extracting reusable lessons from the development process, archiving the change artifacts, and updating the project changelog. It ensures that hard-won knowledge (debugging > 30min, cross-task applicability, 6-month retry probability) is preserved in the project-level LESSONS.md, while change-specific artifacts are moved to the archive for future reference. This is the final node in the flow-comet workflow.

## Guidance

### Prerequisites

- `.specs/<change-id>/UAT.md` must exist with all items passed (from verify node).
- All `*-SUMMARY.md` files must exist for completed tasks.
- `.specs/<change-id>/REVIEW.md` must exist with all Critical resolved.
- The archive operation is irreversible (file move) — requires user confirmation before execution.

### Steps

1. **Scan SUMMARY.md files for lessons**: Read all `<task-id>-SUMMARY.md` files in `.specs/<change-id>/`. Focus on "decisions and deviations" sections. Also check any remaining `<task-id>-PROGRESS.md` "excluded solutions" sections.

2. **Apply nomination criteria**: For each potential lesson:
   - Debugging/trial-and-error took > 30 minutes -> nominate.
   - Error is not task-specific, other tasks would hit it too -> nominate.
   - Reasonable probability of retry within 6 months -> nominate.
   - Otherwise do not nominate (avoid pollution of LESSONS.md).

3. **Add qualifying lessons to LESSONS.md**: For each nominated lesson:
   - Assign next `L-NNN` number (continuing from existing).
   - Fill required fields: label, keywords, applicable tech stack, status (active).
   - Save to `.specs/LESSONS.md`.
   - **Do NOT archive LESSONS.md** — it is a project-level permanent file that accumulates across changes.

4. **Check existing lessons for superseded/deprecated**: Scan existing active lessons in `.specs/LESSONS.md`. If this change's lessons or outcomes supersede or deprecate existing entries, update their status accordingly.

5. **Move change to archive**: After user confirmation:
   - Move `.specs/<change-id>/` to `.specs/archive/<YYYY-MM-DD>-<change-id>/`.
   - Date format: YYYY-MM-DD of the archive date.
   - Verify the move completed successfully (source no longer exists, destination has all files).

6. **Update CHANGELOG.md**: Append one line to `.specs/CHANGELOG.md`:
   - Format: `| YYYY-MM-DD | <change-id> | one-line summary | PR link | new L-NNN entries |`
   - If CHANGELOG.md does not exist, create it from template.

7. **Update STATE.md**: Clear the active change field in the repository root `STATE.md`.

8. **Notify user of architecture sedimentation**: Check DESIGN.md section 9 for sedimentation suggestions. If N > 0 suggestions exist, tell user:
   ```
   Archived to .specs/archive/<YYYY-MM-DD>-<change-id>/
   This change's DESIGN section 9 has N architecture sedimentation candidates, deferred for batch sync.
   Recommended: run A-evolve workflow after >= 5 changes or 60 days to batch-review and patch CONTEXT.md.
   ```

9. **Record evidence**: Run workflow-state.mjs to record archive completion.

10. **Exit check**: Run exit check.

The full archive protocol and templates are in:
- `flow-kit/prompts/7-integration.md` (INTEGRATION phase, archive + LESSONS sections)

### Completion reasoning

This node is truly done when:
- `.specs/<change-id>/` has been moved to `.specs/archive/<YYYY-MM-DD>-<change-id>/`.
- `.specs/CHANGELOG.md` has been updated with the change entry.
- `.specs/LESSONS.md` has been updated with any qualifying new lessons.
- STATE.md has been updated (active change cleared).
- User has confirmed the archive operation.
- LESSONS.md has NOT been moved or archived (it remains project-level).

### Red flags

- **Agent thought**: "Archive is just moving files, no need to ask." **Actual risk**: Archiving without user confirmation is irreversible — if the user wanted to add something or the change is not actually complete, the archive operation cannot be undone. Always ask first.
- **Agent thought**: "LESSONS.md is part of the change, archive it too." **Actual risk**: Archiving LESSONS.md with the change removes project-level knowledge that should persist across changes. LESSONS.md is permanent and must stay in `.specs/`.
- **Agent thought**: "No lessons to nominate, skip the scan." **Actual risk**: Even if no lessons qualify, the scan must be performed and documented. Skipping means potentially valuable knowledge is lost.
- **Agent thought**: "Update CONTEXT.md with DESIGN section 9 suggestions during archive." **Actual risk**: Directly updating CONTEXT.md during archive violates the A-evolve workflow. Section 9 suggestions are deferred for batch sync, not applied immediately.

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry archive
```

## Skill Implementation

The archive node scans all SUMMARY.md files for lessons (applying > 30min debugging / cross-task applicability / 6-month retry criteria), adds qualifying lessons to `.specs/LESSONS.md`, moves the change directory to `.specs/archive/`, updates `.specs/CHANGELOG.md`, and clears STATE.md. It requires user confirmation before the irreversible file move.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-integration` | Required for LESSONS nomination protocol | Provides nomination criteria and LESSONS.md format |

## Output Schemas

Schema: `flowkit.archive.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `archive-dir` | directory | yes | `.specs/archive/<YYYY-MM-DD>-<change-id>/` |
| `changelog-entry` | file | yes | `.specs/CHANGELOG.md` (appended) |
| `lessons-updated` | file | conditional | `.specs/LESSONS.md` (if new lessons nominated) |

Evidence: `archive-summary` (required)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record archive '{"summary":"Change archived to .specs/archive/<date>-<id>/, N lessons added, CHANGELOG updated"}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `archive-evidence` | Archive directory exists, source removed | state-transition |
| `changelog-updated` | CHANGELOG.md has new entry | content-check |
| `lessons-preserved` | LESSONS.md still in .specs/ (not archived) | file-exists |
| `user-confirmed` | User confirmed archive before execution | process-check |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit archive --apply
```

If the script prints `NEXT: done`, summarize the workflow evidence and stop. The change is complete.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Check if `.specs/<change-id>/` still exists (not yet archived) or if `.specs/archive/<YYYY-MM-DD>-<change-id>/` exists (already archived).
3. If not yet archived: resume from the first incomplete step (lessons scan, archive move, CHANGELOG update).
4. If already archived but CHANGELOG not updated: update CHANGELOG.md manually.
5. If already archived but LESSONS not updated: scan SUMMARY.md files in the archive directory and update LESSONS.md.
6. If partially archived (source removed but destination incomplete): investigate and complete the move.


## Entry Check

```bash
node flow-comet/scripts/workflow-guard.mjs entry archive
```

## Skill Implementation

Load `flow-comet-archive` for this Node. Operation: `require`.

## Required Skill Calls

- Load `flow-comet-integration` during this Node and record completed check `required-skill:archive.flow-comet-integration`. Reason: 归档 + LESSONS

## Augmentations

- This Node has no declared augmentations.

## Output Schemas

- `flowkit.archive.v1`: Archive Required evidence: `archive-summary`. Required artifacts: `archive-dir` at `archive/<date>-<change-id>/`.

## Evidence Record

```bash
node flow-comet/scripts/workflow-state.mjs record archive '{"summary":"record the real Node result","completedChecks":[]}'
```

## Guardrails

- `archive-evidence`: Archive completed (state-transition).

## Exit Check

```bash
node flow-comet/scripts/workflow-guard.mjs exit archive --apply
```

If the script prints `NEXT: done`, summarize the workflow evidence and stop.

## Recovery

Read `reference/workflow-protocol.json` and the configured workflow state. Resume the first Node that is not listed in `completedNodes`.
