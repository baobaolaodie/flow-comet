---
name: flow-comet-archive
description: "Use only when explicitly invoked as /flow-comet-archive or routed by the flow-comet entry/runtime to the archive Node; complete Archive for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Archive

## Node Goal

Complete the `archive` Node for `flow-comet`.

Responsibility: LESSONS 提名 + 归档到 .specs/archive/ + CHANGELOG 更新。

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
   - Save to `.specs/LESSONS.md` — 新条目编号 = 当前最大编号 + 1,插入 `## 条目区` 末尾(文件内升序,继续现有编号),**禁止文件尾追加与乱序插入**。
   - **Do NOT archive LESSONS.md** — it is a project-level permanent file that accumulates across changes.

4. **Check existing lessons for superseded/deprecated**: Scan existing active lessons in `.specs/LESSONS.md`. If this change's lessons or outcomes supersede or deprecate existing entries, update their status accordingly.

5. **Compile the leftover issues list (problem-handling principle)**: Before the move, collect everything that remains open or known-limited in this change:
   - REVIEW.md findings marked `[转待办]` (deferred — recorded but not fixed) plus any known limitations captured during the change.
   - Write `.specs/<change-id>/KNOWN-ISSUES.md` — each entry: issue description, why it was deferred, and where it may surface again.
   - The file moves with the change into `.specs/archive/<YYYY-MM-DD>-<change-id>/` (archived alongside the other artifacts), so the leftover issues never silently vanish after archive.
   - If there are no leftovers, still state that explicitly in the file (e.g. "无遗留问题" / "No known leftover issues").

6. **Move change to archive**: After user confirmation:
   - Move `.specs/<change-id>/` to `.specs/archive/<YYYY-MM-DD>-<change-id>/`.
   - Date format: YYYY-MM-DD of the archive date.
   - Verify the move completed successfully (source no longer exists, destination has all files).
   - **git 索引同步**:移动含 `.skill-loads/` 等隐藏目录时,用 `git mv` 逐项移动或移动后用 `git add -A .specs/` 同步索引——文件系统 `mv` 后 git 索引不同步,`git checkout` 会从树恢复残留文件(实测:归档后 checkout 恢复 9 个 .skill-loads 源路径文件)。

7. **Update CHANGELOG.md**: 在 `.specs/CHANGELOG.md` **顶部**按日期倒序插入新条目（倒序约定：新条目永远在最新日期行之上；文件不存在则从模板创建）。若项目既有 CHANGELOG 采用其他格式（如 `## 日期 + 列表`），**跟随项目既有格式**在顶部插入（不强制转表格——保持仓库一致性；guard 的倒序检测只针对表格格式行）:
   - 表格格式: `| YYYY-MM-DD | <change-id> | one-line summary | PR link | new L-NNN entries |`

8. **Update STATE.md（可选决策日志）**: 若项目维护 `STATE.md`，新决策日志条目**顶部**插入（倒序约定，**禁止文件尾追加**）。flow-comet 的活动 change 状态由 `.comet/flow-comet-state.json` 管理——STATE.md 无 active change 字段，不需要也不应手动清除。

9. **Notify user of architecture sedimentation + leftover issues**: Check DESIGN.md section 9 for sedimentation suggestions. If N > 0 suggestions exist, tell user — and always explicitly enumerate the leftover issues from KNOWN-ISSUES.md in the archive notification (they must not silently disappear after archive):
   ```
   Archived to .specs/archive/<YYYY-MM-DD>-<change-id>/
   遗留问题清单（KNOWN-ISSUES.md，随工件归档）: <each leftover issue, or 无>
   This change's DESIGN section 9 has N architecture sedimentation candidates, deferred for batch sync.
   Recommended: run A-evolve workflow after >= 5 changes or 60 days to batch-review and patch CONTEXT.md.
   ```

10. **Record evidence**: Run `node .claude/skills/flow-comet/scripts/workflow-state.mjs record archive '<evidence JSON>'` to record archive completion.

11. **Exit check**: Run exit check.

### 归档提交（R4.1 交付闭环）

1. 用显式路径 stage：只 stage 本 change 可归属路径（原活动路径、实际归档路径、改过的主 spec）
2. `git diff --cached --stat` 检查后，单一 commit：`chore: archive <change-id>`
3. 按用户确认的交付方式 push / 建 PR（如用 git 流水线）
4. 归档操作（移动文件）必须用户确认后才执行（不可逆）

### 分支收尾（branchMode=true 时）

分支模式下（`branchMode=true`，git 仓库 + init 已建 `change/<id>` 分支）在完成上述归档提交后执行收尾：

1. 确认当前分支 = `change/<id>`（`git branch --show-current`；entry archive 已校验，异常先切回）
2. `git checkout <默认分支> && git merge change/<id>`——冲突时**提示用户处理，禁止自动解决冲突**。默认分支不一定是 `main`（如 e2e 项目是 `master`）——先探测：`git symbolic-ref refs/remotes/origin/HEAD`（取 `origin/xxx` 的 xxx；无远端时 `git symbolic-ref --short HEAD` 的默认分支或 `git branch` 列第一个非 change 分支）
3. `git branch -d change/<id>` 删除已合并分支
4. `.specs/archive/` 归档照旧——分支合并是收尾动作，不是新节点

**`enablePrReview=true` 时**（用户已开启 PR 审查）：**先推送分支 + 创建 PR，PR approve 后再走合并**——

1. `git push -u origin change/<id>` 推送分支
2. 创建 PR：`gh pr create` 或提示用户手动在 GitHub 创建
3. PR approve 后回到第 2 步的合并流程（`git checkout main && git merge change/<id>`）

The full archive protocol and templates are in:
- `flow-kit/prompts/7-integration.md` (INTEGRATION phase, archive + LESSONS sections)

### Completion reasoning

This node is truly done when:
- `.specs/<change-id>/` has been moved to `.specs/archive/<YYYY-MM-DD>-<change-id>/`.
- `.specs/CHANGELOG.md` has been updated with the change entry.
- `.specs/LESSONS.md` has been updated with any qualifying new lessons.
- `.specs/archive/<YYYY-MM-DD>-<change-id>/KNOWN-ISSUES.md` exists (leftover issues compiled and archived; explicit "无遗留" when none).
- The archive notification explicitly enumerated the leftover issues list.
- STATE.md decision log has been updated (if the project keeps one; active change state lives in the state machine).
- User has confirmed the archive operation.
- LESSONS.md has NOT been moved or archived (it remains project-level).

### Red flags

- **Agent thought**: "Archive is just moving files, no need to ask." **Actual risk**: Archiving without user confirmation is irreversible — if the user wanted to add something or the change is not actually complete, the archive operation cannot be undone. Always ask first.
- **Agent thought**: "LESSONS.md is part of the change, archive it too." **Actual risk**: Archiving LESSONS.md with the change removes project-level knowledge that should persist across changes. LESSONS.md is permanent and must stay in `.specs/`.
- **Agent thought**: "No lessons to nominate, skip the scan." **Actual risk**: Even if no lessons qualify, the scan must be performed and documented. Skipping means potentially valuable knowledge is lost.
- **Agent thought**: "Update CONTEXT.md with DESIGN section 9 suggestions during archive." **Actual risk**: Directly updating CONTEXT.md during archive violates the A-evolve workflow. Section 9 suggestions are deferred for batch sync, not applied immediately.
- **Agent thought**: "Archived, done — the leftover issues will sort themselves out." **Actual risk**: Deferred findings and known limitations that are not compiled into KNOWN-ISSUES.md silently vanish after the archive move. Compile the leftover list before moving and enumerate it in the archive notification.

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry archive
```

## Skill Implementation

Load `flow-comet-archive` for this Node. Operation: `require`.

The archive node scans all SUMMARY.md files for lessons (applying > 30min debugging / cross-task applicability / 6-month retry criteria), adds qualifying lessons to `.specs/LESSONS.md`, moves the change directory to `.specs/archive/`, and updates `.specs/CHANGELOG.md`. It requires user confirmation before the irreversible file move.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-integration` | Required for LESSONS nomination protocol | Provides nomination criteria and LESSONS.md format |

Load `flow-comet-integration` during this Node and record completed check `required-skill:archive.flow-comet-integration`. Reason: 归档 + LESSONS

**加载声明**：加载本 skill 后**立即**运行声明命令（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load archive flow-comet-integration --prompt flow-kit/prompts/7-integration.md
```

## Augmentations

This Node has no declared augmentations.

## Output Schemas

Schema: `flowkit.archive.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `archive-dir` | directory | yes | `.specs/archive/<YYYY-MM-DD>-<change-id>/` |
| `known-issues` | file | required | `.specs/archive/<YYYY-MM-DD>-<change-id>/KNOWN-ISSUES.md` (leftover issues list, archived with the change; 无遗留也显式写「无遗留问题」——guard 强制存在) |
| `changelog-entry` | file | yes | `.specs/CHANGELOG.md` (inserted at the top, reverse-chronological) |
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
| `changelog-updated` | CHANGELOG.md has new entry | 执行纪律（review 把关），guard 不校验（倒序位置有 WARN 渐进检查） |
| `lessons-preserved` | LESSONS.md still in .specs/ (not archived) | 执行纪律（review 把关），guard 不校验 |
| `user-confirmed` | User confirmed archive before execution | 执行纪律（review 把关），guard 不校验 |

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
