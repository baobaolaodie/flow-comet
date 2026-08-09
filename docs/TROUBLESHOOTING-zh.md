<div align="right">

[English](TROUBLESHOOTING.md) · [中文](TROUBLESHOOTING-zh.md)

</div>

# 故障排查

| 现象 | 原因 | 处理 |
|------|------|------|
| `BLOCKED: 归档必须在 change/<id> 分支上进行` | 在错误分支执行 archive（分支模式） | `git checkout change/<id>` 后重试 |
| `WARN: 分支与 activeChange 不一致` | 分支与状态漂移 | `git checkout change/<activeChange>`（按 WARN 提示）后继续 |
| `WORKTREE WARN: .specs/<change>/ 有未提交工件` | 委托前工件未 commit | commit 工件，或在委托 prompt 内联上下文 |
| `BLOCKED: TASK.md 任务集被修改` | execute 期间增删任务/改 action/改边界 | 回退 TASK.md 到 enter 时内容（仅标记 done 合法） |
| `BLOCKED: state 字段类型非法` | state 文件被直改坏 | 修复字段类型或从备份/git 历史恢复 `.comet/flow-comet-state.json` |
| `WARN: CONTEXT.md 检测到孤立追加段` | 术语/决策被尾部追加成新段 | 把内容移入术语表表格/已锁决策清单 |
| `WARN: LESSONS.md 条目编号乱序/区外` | 新条目未按 L-NNN 插入条目区 | 按编号插入 `## 条目区`（或 `## 活跃条目`） |
| `BROOKS-LINT WARN: 使用 builtin-quickcheck 未声明原因` | SUMMARY 缺"插件不可用"说明 | 在 SUMMARY 的 `## 自检方法` 段补原因 |
| `BROOKS-LINT WARN: 使用 builtin-quickcheck 但未声明缓存尝试证据` | builtin 降级声明但无「已读插件缓存协议文件」证据 | 在 SUMMARY 的 `## 自检方法` 段声明：已 Read 插件缓存协议文件（如 `~/.claude/plugins/cache/brooks-lint-marketplace/.../brooks-review/`）手动执行完整 brooks 流程后才降级 |
| `BLOCKED: verify 已失败 N/3` / `BLOCKED: verify 已失败 4 次，需用户决策` | 自动重试 ≤3 次；第 4 次失败需人工决策 | 暂停，人工决策「继续修 / 停止」 |
| `BLOCKED: 疑似未 exit 节点 <node>` | `next` 检测到节点顺序非法（跳节点/未 exit） | 按提示执行 `workflow-guard.mjs exit <node> --apply`（回退场景见提示） |
| `BLOCKED: workflow protocol node must have a non-empty string id` | 自定义协议 `nodes[]` 含空/非法元素 | 修复协议 JSON：每个节点 `id` 非空字符串且避开内置 8 节点 id |
| `BLOCKED: 未在协议 writeWhitelist 中声明` | 写入路径超出自定义协议白名单（fail-closed） | 在协议 `writeWhitelist` 声明该节点允许的路径前缀，或改用内置协议 |
| `--protocol <path> 加载失败` | 协议路径不存在 / schemaVersion 或 kind 不符 | 检查路径；确认 `schemaVersion: 1`、`kind: "workflow-kernel"` |
| `ROUTE WARN: 未找到 parallel="true" status="pending" 的任务块` | TASK.md task 标签缺 `status="pending"` 属性（或属性顺序错） | 在每个 task 标签中 `parallel="true"` 之后补 `status="pending"`（属性顺序：parallel 在 status 前） |
| `C4-CHECK SKIP: <原因>` | worktree 脏检查被跳过（非 git 仓库，或 git 命令失败） | 非 git 项目下属预期；git 仓库中出现则 git 命令失败——按原因排查 |
| `WARN COUNT: N` | entry/exit 汇总行——本次调用共 N 条 WARN | 逐条检查该行上方的 WARN |
| `Unexpected token ... is not valid JSON`（state） | state 文件带 UTF-8 BOM 或内容损坏 | 重写 state 文件（无 BOM；脚本自 1.2.1 起容忍 BOM） |
| `PreToolUse:Write hook error: ... non-blocking`（claude -p） | SDK CLI 模式把 hook 退出码降级为 non-blocking | `claude -p` 下属预期；主会话 TUI 会阻止写入（exit 2） |
