<div align="right">

[English](TROUBLESHOOTING.md) · [中文](TROUBLESHOOTING-zh.md)

</div>

# Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `BLOCKED: 归档必须在 change/<id> 分支上进行` | archive executed on the wrong branch (branch mode) | `git checkout change/<id>` then retry |
| `WARN: 分支与 activeChange 不一致` | branch/state drift | `git checkout change/<activeChange>` (per WARN hint) then continue |
| `WORKTREE WARN: .specs/<change>/ 有未提交工件` | artifacts uncommitted before delegation | commit artifacts, or inline context in the delegation prompt |
| `BLOCKED: TASK.md 任务集被修改` | tasks added/removed, action/boundary changed during execute | revert TASK.md to its enter-time content (marking done is legal) |
| `BLOCKED: state 字段类型非法` | state file edited directly | fix field types or restore `.comet/flow-comet-state.json` from backup/git |
| `WARN: CONTEXT.md 检测到孤立追加段` | terms/decisions appended as a new tail section | move content into the glossary table / locked-decision list |
| `WARN: LESSONS.md 条目编号乱序/区外` | new entry not inserted by L-NNN in the entries section | insert by number into `## 条目区` (or `## 活跃条目`) |
| `BROOKS-LINT WARN: 使用 builtin-quickcheck 未声明原因` | SUMMARY missing "plugin unavailable" note | add the reason in SUMMARY's `## 自检方法` |
| `BROOKS-LINT WARN: 使用 builtin-quickcheck 但未声明缓存尝试证据` | builtin fallback declared without evidence of reading the plugin-cache protocol files | in SUMMARY's `## 自检方法`, state that you Read the plugin-cache protocol files (e.g. `~/.claude/plugins/cache/brooks-lint-marketplace/.../brooks-review/`) and executed manually before falling back |
| `BLOCKED: verify 已失败 N/3` / `BLOCKED: verify 已失败 4 次，需用户决策` | auto-retry up to 3 times; 4th failure requires human decision | pause, human decision: "continue / stop" |
| `BLOCKED: 疑似未 exit 节点 <node>` | `next` detects illegal node order (skipped/not exited) | run `workflow-guard.mjs exit <node> --apply` per the hint (T-FIX rollback scenarios see hint) |
| `BLOCKED: workflow protocol node must have a non-empty string id` | custom protocol `nodes[]` contains empty/invalid element | fix protocol JSON: each node `id` non-empty string, avoid built-in 8-node ids |
| `BLOCKED: 未在协议 writeWhitelist 中声明` | write target outside the custom protocol whitelist (fail-closed) | declare the node's allowed path prefixes in protocol `writeWhitelist`, or use the built-in protocol |
| `--protocol <path> 加载失败` | protocol path missing / schemaVersion or kind mismatch | check the path; confirm `schemaVersion: 1`, `kind: "workflow-kernel"` |
| `Unexpected token ... is not valid JSON` (state) | state file carries a UTF-8 BOM or corrupted content | rewrite the state file without BOM (scripts tolerate BOM since 1.2.1) |
| `PreToolUse:Write hook error: ... non-blocking` (claude -p) | SDK CLI mode downgrades hook exit codes to non-blocking | expected in `claude -p`; main TUI session blocks writes (exit 2) |
