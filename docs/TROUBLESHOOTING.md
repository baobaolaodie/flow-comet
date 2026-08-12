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
| `BLOCKED: 疑似未 exit 节点 <node>` | `next` detects illegal node order (skipped/not exited) | run `workflow-guard.mjs exit <node> --apply` per the hint (rollback scenarios see hint); when the node is actually done but the state is stuck/drifted, use `workflow-state.mjs advance` (force-advance — only after confirming the node really finished) or `select` |
| `BLOCKED: currentNode is <node>, cannot exit <target>` | trying to exit a node that is not the current one (state drift) | `workflow-state.mjs advance` (force-advance — only after confirming the current node really finished) or `select` to switch; never hand-edit the machine fields |
| `BLOCKED: missing evidence for Node <node>` | the node finished but its evidence record is missing | run `workflow-state.mjs record <node> '{"summary":"<完成摘要>"}'` to record evidence, then retry; for state drift use `advance`/`select` |
| `BLOCKED: workflow protocol node must have a non-empty string id` | custom protocol `nodes[]` contains empty/invalid element | fix protocol JSON: each node `id` non-empty string, avoid built-in 8-node ids |
| `BLOCKED: 未在协议 writeWhitelist 中声明` | write target outside the custom protocol whitelist (fail-closed) | declare the node's allowed path prefixes in protocol `writeWhitelist`, or use the built-in protocol |
| `--protocol <path> 加载失败` | protocol path missing / schemaVersion or kind mismatch | check the path; confirm `schemaVersion: 1`, `kind: "workflow-kernel"` |
| `ROUTE WARN: 未找到 parallel="true" status="pending" 的任务块` | TASK.md task tags lack the `status="pending"` attribute (or wrong attribute order) | add `status="pending"` after `parallel="true"` in each task tag (attribute order matters: parallel before status) |
| `C4-CHECK SKIP: <reason>` | worktree dirty-check skipped (not a git repo, or git command failed) | expected in non-git projects; if it appears in a git repo, the git command failed — check the reason |
| `WARN COUNT: N` | summary line on entry/exit — N warns were emitted this call | review each WARN above this line |
| `Unexpected token ... is not valid JSON` (state) | state file carries a UTF-8 BOM or corrupted content | rewrite the state file without BOM (scripts tolerate BOM since 1.2.1) |
| `PreToolUse:Write hook error: ... non-blocking` (claude -p) | SDK CLI mode downgrades hook exit codes to non-blocking | expected in `claude -p`; main TUI session blocks writes (exit 2) |
| `INIT-NEEDED: 项目上下文（CONTEXT.md）尚未初始化` | first use in a project — no project context yet | run `init <id> --init-context` to generate it (reads existing AI-context docs with attribution; ~15-30k tokens, first use only), or `--init-skip` to record the skip and stay silent on future inits |
| `INIT-HINT: 项目上下文（CONTEXT.md）已就绪（7 段 + 模板格式校验通过）但尚未记录扫描时间` / `INIT-HINT: 上次扫描已 X 天` | context exists but not recorded: template-valid CONTEXT with no scan record yet (generated but never re-run), or last scan older than 90 days | ready state: run `init <id> --init-context` to record the scan time (then silent for 90 days); stale state: optional refresh — not required |
| `INIT-GENERATE: 项目上下文未初始化——请生成 .specs/CONTEXT.md` (a template note follows: strictly follow `flow-kit/templates/CONTEXT.md` section names and entry formats when detected; otherwise use the 7-section baseline) | `--init-context` with no CONTEXT.md — first step of the generation collaboration | read the listed source docs in full and integrate them with attribution (`来自 <doc>:<line>`; originals are never written), probe the code (tech stack / existing abstractions), and produce the 7 sections against the template; re-run `init <id> --init-context` afterwards to validate and record the scan time |
| `INIT-VALIDATE-FAILED: CONTEXT.md 已存在但不满足模板（<原因>）` (`<原因>` = format issues / missing sections) | `--init-context` always validates and found CONTEXT.md missing sections or failing the template format checks | rewrite it — keep the accumulated terms/decisions (they accumulate across changes), attribute sources with `来自 <doc>:<line>`, never modify the originals; follow the template's section names and entry formats |
| `INIT-DONE: 项目上下文（CONTEXT.md）已就绪（7 段 + 模板格式校验通过）` / `INIT-DONE: 项目上下文已存在且新鲜，跳过生成。` | second step of the generation collaboration — re-running `init <id> --init-context` validated the 7-section structure and template format (or the context is still fresh within 90 days) | nothing to do — the scan time is recorded; no hints for the next 90 days |
