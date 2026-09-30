---
name: worktree-notes
description: "跨仓库 worktree 场景笔记：isolation:worktree 挂载在会话项目根、W2-D 提交校验跨仓库失效属预期降级、规避方式与验证命令。"
---

# Worktree 跨仓库场景笔记

## 1. worktree 挂载位置：会话项目根，不是子代理目标项目

Agent 工具 `isolation: "worktree"` 创建的 worktree 挂在**会话项目根**（`git worktree list` 确认），不是子代理要工作的目标项目仓库。

跨仓库端到端 / 多仓库场景下：

- worktree 内容来自**父项目**（会话项目）的当前分支快照，与子代理目标仓库无关
- 子代理产物不会自动进入目标仓库，需手动搬运：在目标仓库内用 `git show <branch>:<path>` 取回内容，或先 `git log --all --oneline -- <path>` 定位产物所在 commit 再 cherry-pick / 复制
- 不要在子代理里假设"我就在目标仓库里"——先确认 cwd 与 worktree 根

## 2. W2-D 提交文件子集校验的预期降级

W2-D 用 `git show <commitHash>` 校验提交文件子集。当产物 commit 属于**其他仓库**（不属于当前仓库）时该校验失效：`git show` 找不到该 commit，报 HANDOFF ERROR，但**不阻断记录**——协调者仍记录 handoff，流程继续。属预期降级，不是 bug，不需要修复。

## 3. 规避方式

1. **委托 prompt 内联全部上游上下文**：AC / 设计 / 任务块全文写进委托 prompt，子代理不依赖 worktree 里的工件
2. **委托前 commit 上游工件**：把 `.specs/<change>/` 工件先 commit，配合脏检查 WORKTREE WARN（entry execute / entry subagent-execute 检测未提交工件并提示）
3. **单仓库场景不受影响**：worktree 与目标项目同根（同一仓库）时无此问题
4. **委托回报后立即提取**：子代理回报 commitHash 后**立即**用 `git show <branch>:<path>` 提取产物到目标仓库——worktree 任务结束清理后，提交对象可能不可见（悬挂对象被回收/分支删除），回报时提取可避免产物丢失

## 4. 验证方法

```bash
git worktree list                # 确认 worktree 挂在哪个仓库/分支（会话项目根）
git ls-tree <branch> <path>      # 确认产物在目标仓库哪个分支、路径是否存在
```

## 4.2. 运行时状态文件的跟踪风险(测试载体实证 2026-08-15)

测试载体(如演练项目)若 git 跟踪 `.flow-comet/flow-comet-state.json`(主仓 gitignore 它,载体可能不同),**恢复/回退操作不得用 `git reset --hard`**——会连带把运行时状态回退到历史版本,状态机倒退(端到端验证实证事故:回退后重跑 init + 重录证据恢复,耗时约 10 分钟)。恢复工件用精确 `git checkout -- <path>`(只回退指定文件),不用整树 reset。

## 4.5. Codex 平台的原生多代理与当前支持面（依据 2026-09-30 记录订正）

**平台事实**:Codex 的常规用法是交互式 CLI(`codex` 无子命令)与会话内 agent,`codex exec` 只是 headless 子面;原生多代理 `multi_agent` 为 stable、默认启用(`codex features list` 可查),本机真实交互式会话日志中记录到 `spawn_agent` / `wait_agent` / `close_agent` 的实际调用。因此「Codex 不能委派 / 不使用并行委托」**不是平台事实**。

**flow-comet 当前支持面(机制缺口)**:Codex 的原生子代理形态(`spawn_agent`)无自动 worktree 假定——现有守卫 / 白名单 / 隔离模型未覆盖该形态;在后续契约(须先由覆盖交互式会话与原生子代理的探针得出结论,再据此决定是否修改引擎)落地前,flow-comet 在 Codex 上**不派遣并行子代理**——任务逐个走 `execute` 节点交付(写边界天然互斥)。这是 flow-comet 现阶段的支持面限制,**不是平台能力边界**。**手工 `git worktree add <路径> -b <分支>` + 在 worktree 内 `codex exec` 委托不是受支持路径(不应使用),也不得作为绕过手段**。**委托 prompt 内联上游上下文(第 3 节)在 Codex 同样适用,且是串行交付时的唯一可靠路径**。**注意**:worktree 同样不含 `flow-kit/` 与 `.agents/`(它们是目标仓库内容,不在 worktree 快照内)——委托 prompt 内联必须覆盖这些依赖。

**headless 子面实测与 hook 会话 root 订正(依据 2026-09-30 真机重测;codex-cli 0.146.0 / Windows;仅 `codex exec --json --ephemeral` headless 子面;不得外推为平台结论)**:旧结论「手工 worktree 内的写入会被协调者白名单拦住、会话 root 仍是主仓库」被**推翻并收窄**——实测 hook 进程 cwd == 载荷 `cwd` == 会话工作根(cwd=项目 / `-C` / 手工 worktree 三形态一致);**Codex 原生子代理(`spawn_agent`)形态未覆盖,不得外推**。手工 worktree 形态下相对路径写入**不会**被拦:worktree 通常缺 gitignored 运行态 state → 守卫走「无活跃 workflow」放行;若 hook 命令仍指向主仓安装副本(runRoot 外),守卫因「workflow protocol file must stay inside the project root」报错退出,Codex 将 hook 失败降级为非阻塞 → 写入照常落地。**静态喂测(独立复现)**:守卫白名单只覆盖**解析后仍在 runRoot 内**的目标;`Write/Edit` 的 `file_path` 解析为 runRoot 外时跳过判定(**fail-open**,已知缺口、未闭合),而 Bash 写命令同目标仍 `decision:block`(两分支不对称)。**`apply_patch`**:会触发 PreToolUse,但 `tool_name="Bash"`、补丁正文在 `tool_input.command`(heredoc)、**无 `file_path`**;守卫不解析补丁体 → 目标不被提取、放行。独立复验复现了载荷与守卫盲区;**「文件确实落盘」子项在复验环境因 apply_patch shim 失败未复现(首次真机重测环境曾落盘)**——两环境存在差异,按此如实理解。**hook 触发条件**:隔离 `CODEX_HOME` 无持久信任时默认 headless **不执行**项目 hook;`hooks` 特性默认 enabled、可被项目配置/开关覆盖;`codex_hooks` 是 deprecated 别名;per-invocation 信任是必要因素之一,但独立复验显示 trust-only 触发**不稳定**(3/21;补 `--dangerously-bypass-approvals-and-sandbox` 后 5/5)——**不得写成稳定/确定性保证**。持久信任与交互式 TUI 形态未覆盖。

**已废弃的绕过手段(不应使用)**:用 Python `open()` 等 File API 直写曾被记为命令级检测缺口的规避通道——它**绕过写入守卫防线**,不是受支持做法,现明确废止,不得再作为委托方案使用。CC 平台的 worktree 子代理在 v1.5.0-rc.2 之前无此问题:runRoot 取进程 cwd(即 worktree 内),区内无 state → 按设计放行;该版起的锚定链把 runRoot 锚到主仓库(`CLAUDE_PROJECT_DIR`),隔离子代理会被误判为协调者而遭白名单拦截——守卫已对 worktree 隔离区放行(区内写源码不受协调者白名单约束,见机制文档 1.4)。

## 4.6. dsh 平台的委托形态:进程内子代理,无需 worktree / 隔离区(实测核对)

dsh 的子代理是**平台进程内子代理**——不创建独立工作区,委托方与子代理在同一工作区运行。写入守卫按**会话身份分派**:子代理 `delegationDepth` 大于 0 时直接放行、**项目内任意路径可写(含 gitignored)**;协调者身份(`delegationDepth` 为 0 或缺失)才走白名单。因此 **dsh 委托不需要 worktree,也不存在隔离区**——直接委托即可。

三平台对照:

| 平台 | 委托形态 | 隔离区 | 说明 |
|---|---|---|---|
| Claude Code | `Agent` 工具 `isolation: "worktree"` | 有(`.claude/worktrees/**`,守卫放行) | 并行委托需隔离;委托前 commit 上游工件(见第 3 节) |
| dsh | 平台进程内子代理 | **无**——无需创建 | 写入守卫按会话身份分派放行;同工作区并行靠 `write_files` 边界与提交时点作相互隔离纪律 |
| Codex | 原生多代理（`multi_agent` 默认启用；交互式真实使用 `spawn_agent`） | flow-comet 当前未覆盖该形态（机制缺口） | headless 子面实测见 4.5，不得外推 |

**同一工作区的通用边界**:进程内并行子代理会看到彼此未提交的中间态——任务的 `write_files` 边界互斥与提交时点(见第 3 节第 2/4 条)就是相互隔离纪律;dsh 上发起并行委托前同样必须先确认 `write_files` 互不重叠。

## 5. change 分支 + worktree 组合

分支模式（`branchMode=true`，git 仓库 + init 自动创建 `change/<id>` 分支）下：

- **子代理 worktree 从 change 分支分出**：`isolation: "worktree"` 基于**当前分支**（change/<id>）快照创建，子代理看到的是该分支内容——委托前必须 commit 上游工件，否则子代理看不到未提交改动（同第 3 节规避方式）
- **协调者产物提取路径不变**：仍用 `git show <branch>:<path>` 从 worktree 取回产物，`<branch>` 此时是 `change/<id>`（可用 `git ls-tree change/<id> <path>` 确认存在）
- **分支模式下归档全程在 change/<id> 分支上执行**：entry/exit archive 校验当前分支 = `change/<id>`（提前切走会被 BLOCKED）；**归档 exit 完成后**再做合并收尾——切到默认分支（先探测，不假设 main，如 e2e 项目是 master）`git checkout <默认分支> && git merge change/<id>`，合并完成后 `git branch -d change/<id>` 删除分支
