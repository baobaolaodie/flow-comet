---
name: worktree-notes
description: "跨仓库 worktree 场景与三平台委派通道笔记：isolation:worktree 挂载在会话项目根、Codex/dsh 身份通道与交互式实测（含载荷 cwd ≠ 实际工作目录）、W2-D 提交校验跨仓库失效属预期降级、规避方式与验证命令。"
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
2. **隔离工作区（worktree）委托前 commit 上游工件**：把 `.specs/<change>/` 工件先 commit，配合脏检查 WORKTREE WARN（entry execute / entry subagent-execute 检测未提交工件并提示）——该要求**只对隔离工作区形态成立**（树从已提交 HEAD 创建）；**共享工作区形态**（身份通道下的直接委托，如 dsh 进程内子代理）看得到未提交改动，但仍须按 `dirty-worktree.md` 澄清脏工作树归属
3. **单仓库场景不受影响**：worktree 与目标项目同根（同一仓库）时无此问题
4. **委托回报后立即提取**：子代理回报 commitHash 后**立即**用 `git show <branch>:<path>` 提取产物到目标仓库——worktree 任务结束清理后，提交对象可能不可见（悬挂对象被回收/分支删除），回报时提取可避免产物丢失

## 4. 验证方法

```bash
git worktree list                # 确认 worktree 挂在哪个仓库/分支（会话项目根）
git ls-tree <branch> <path>      # 确认产物在目标仓库哪个分支、路径是否存在
```

## 4.2. 运行时状态文件的跟踪风险(测试载体实证 2026-08-15)

测试载体(如演练项目)若 git 跟踪 `.flow-comet/flow-comet-state.json`(主仓 gitignore 它,载体可能不同),**恢复/回退操作不得用 `git reset --hard`**——会连带把运行时状态回退到历史版本,状态机倒退(端到端验证实证事故:回退后重跑 init + 重录证据恢复,耗时约 10 分钟)。恢复工件用精确 `git checkout -- <path>`(只回退指定文件),不用整树 reset。

## 4.5. Codex 平台：原生多代理与身份通道（交互式实测订正 2026-10-04/05）

**平台事实（交互式实测证实；取证记录见 `.specs/p9-codex-probe-2026-10-04.md`）**：Codex 的常规用法是交互式 CLI（`codex` 无子命令）与会话内 agent，`codex exec` 只是 headless 子面；原生多代理 `multi_agent` 为 stable、默认启用（`codex features list` 可查）。交互式会话**触发**项目级 `PreToolUse`（启动时有 hook 信任提示，用户选信任后生效）；**原生子代理的工具调用同样触发**；子代理载荷 **12 键、含 `agent_id` + `agent_type`**（主线程 10 键、两者皆无；本机实测 `agent_type=default`）；`spawn_agent` / `multi_agent_v1wait_agent` / `multi_agent_v1close_agent` 三种委派调用**各自触发** PreToolUse（派遣行为本身可观察）；子代理可被指向独立目录（worktree）并成功落盘；用户全局 `~/.codex/hooks.json` 与项目级 hook **并存生效**。

**同批推翻的三条旧结论**：①「Codex 载荷无身份字段」（`agent_id`/`agent_type` 皆无）——该结论**只对 `codex exec` headless 主线程成立**（见下方 headless 子面实测），交互式 + 原生子代理**有**；②「载荷含 `workdir`」——**不含**，子代理写调用 `tool_input` 只有 `command` 一个键；③「worktree 内写入被 hook 拦」——**不是 hook 拦的**：首次 `Set-Content` 报 PowerShell `PermissionDenied`（exit 1），加 `sandbox_permissions="require_escalated"` 后 exit 0 成功 ⇒ 拦截者是 **Codex 自身沙箱**，且可经提权越过（与 flow-comet 守卫是**两层独立防线**，不可互相替代，也不得把沙箱行为记成守卫行为）。

**已知边界（关键 · 不得写成机械保证）**：载荷 `cwd`（以及 hook 进程 cwd）**始终 = 会话根**，与子代理实际工作目录**无关**——子代理按 `workdir=<worktree>` 在其中成功写入，而载荷 `cwd` 仍是主工程（实测证据）。⇒ **路径判定在 Codex 上必错**（既有误拦也有误放，方向取决于白名单，且真实 `workdir` 不在载荷里、**无法通过读载荷修正**）；写边界判定必须基于**身份**（`agent_id`），判定序为**身份先于路径**。

**flow-comet 支持面（机制缺口已闭合，非平台能力边界）**：Codex **与其他两平台一样可并行委派**——缺的从来不是平台能力，而是守卫没读 `agent_id`（「有能力、通道未接通」，不是「无能力」）；本批身份分派已接通该通道。**「谁建树」是开放实现选择**：协调者可用 `git worktree add <路径> -b <分支>` **显式**建树并在委派 prompt 里指定 `workdir`（实测证实子代理可被指向独立目录；原生子代理**无**自动建树），也可以直接在共享工作区委托——两条路径都由身份通道放行，共享工作区形态另按 `write_files` 互斥 + 提交时点纪律约束。**委托 prompt 内联上游上下文（第 3 节）在 Codex 同样适用**（worktree 不含 `flow-kit/` 与 `.agents/` 等目标仓库内容，委托 prompt 内联必须覆盖这些依赖）。**未覆盖项不得外推**：`agent_type` 取值域（本机只见 `default`）· 嵌套委派（子代理再 spawn）载荷 · 非 Windows / 非 PowerShell 工具链 · `PostToolUse` 等其它事件载荷 · 全局 `~/.codex/hooks.json` 与项目级 hook 的**合并规则**（只观察到并存生效）· Codex hook 触发稳定性（见下 headless 记录）。

**headless 子面实测与 hook 会话 root 订正(2026-09-30 记录;codex-cli 0.146.0 / Windows;仅 `codex exec --json --ephemeral` headless 子面;不得外推为平台结论)**:旧结论「手工 worktree 内的写入会被协调者白名单拦住、会话 root 仍是主仓库」被**推翻并收窄**——实测 hook 进程 cwd == 载荷 `cwd` == 会话工作根(cwd=项目 / `-C` / 手工 worktree 三形态一致);**（记录时点结论：Codex 原生子代理形态未覆盖——该形态已由交互式探针补齐，见上 4.5；其路径判定仍受 `cwd` ≠ 实际工作目录限制，不得外推）**。手工 worktree 形态下相对路径写入**不会**被拦:worktree 通常缺 gitignored 运行态 state → 守卫走「无活跃 workflow」放行;若 hook 命令仍指向主仓安装副本(runRoot 外),守卫因「workflow protocol file must stay inside the project root」报错退出,Codex 将 hook 失败降级为非阻塞 → 写入照常落地。**静态喂测(独立复现)**:守卫白名单只覆盖**解析后仍在 runRoot 内**的目标;`Write/Edit` 的 `file_path` 解析为 runRoot 外时跳过判定(**fail-open**,记录时点**未闭合**;本批已闭合——runRoot 外与 Bash 分支同判,身份在场则由身份短路先放行),而 Bash 写命令同目标仍 `decision:block`(记录时点的两分支不对称)。**`apply_patch`**:会触发 PreToolUse,但 `tool_name="Bash"`、补丁正文在 `tool_input.command`(heredoc)、**无 `file_path`**;守卫不解析补丁体 → 目标不被提取、放行。独立复验复现了载荷与守卫盲区;**「文件确实落盘」子项在复验环境因 apply_patch shim 失败未复现(首次真机重测环境曾落盘)**——两环境存在差异,按此如实理解。**hook 触发条件**:隔离 `CODEX_HOME` 无持久信任时默认 headless **不执行**项目 hook;`hooks` 特性默认 enabled、可被项目配置/开关覆盖;`codex_hooks` 是 deprecated 别名;per-invocation 信任是必要因素之一,但独立复验显示 trust-only 触发**不稳定**(3/21;补 `--dangerously-bypass-approvals-and-sandbox` 后 5/5)——**不得写成稳定/确定性保证**。**（记录时点结论：持久信任与交互式 TUI 形态未覆盖——交互式 TUI 已由 2026-10-04/05 的交互式探针覆盖，见上 4.5；持久信任仍未覆盖。）**

**已废弃的绕过手段(不应使用)**:用 Python `open()` 等 File API 直写曾被记为命令级检测缺口的规避通道——它**绕过写入守卫防线**,不是受支持做法,现明确废止,不得再作为委托方案使用。CC 平台的 worktree 子代理在 v1.5.0-rc.2 之前无此问题:runRoot 取进程 cwd(即 worktree 内),区内无 state → 按设计放行;该版起的锚定链把 runRoot 锚到主仓库(`CLAUDE_PROJECT_DIR`),隔离子代理会被误判为协调者而遭白名单拦截——守卫已对 worktree 隔离区放行(区内写源码不受协调者白名单约束,见机制文档 1.4)。

## 4.6. dsh 平台:进程内子代理——**无需隔离区 ≠ 无需边界**(实测核对)

dsh 的子代理是**平台进程内子代理**——不创建独立工作区,委托方与子代理在同一工作区运行。写入边界按**身份**分派:桥接把 `delegationDepth` 作为身份信号透传给守卫(env `FLOW_COMET_AGENT_DEPTH`),身份与最小保护集的判定由守卫**单一实现**拥有(与 CC / Codex 的载荷 `agent_id` 归并为同一判据,禁第二份实现——`L-067`);身份在场 ⇒ 子代理语义放行,但目标命中**最小保护集**(`.flow-comet/flow-comet-state.json` / `reference/workflow-protocol.json`)时**仍拦**。

**「无需隔离区」说的是没有独立工作区,不是没有边界**:同一工作区下,任务的 `write_files` 互斥 + 提交时点(提交前 diff 边界,见第 3 节第 2/4 条)+ 最小保护集共同构成边界——dsh 上发起并行委托前同样必须先确认 `write_files` 互不重叠。

三平台对照（判级只取三态：**证实 / 推翻 / 未覆盖**；未覆盖项不得当已支持读）：

| 平台 | 委托形态 | 工作区（谁建树） | ① 写权限通道（判级） |
|---|---|---|---|
| Claude Code | `Agent` 工具（可带 `isolation: "worktree"`） | 可选独立树（harness 建；`.claude/worktrees/**` 前缀为兼容路径）或共享工作区 | 载荷 `agent_id` / `agent_type`——**证实**（真机实测：子代理载荷含二者、主会话载荷不含；与 Codex 同一判据） |
| dsh | 平台进程内子代理 | **不建树**——同一工作区运行 | 桥接透传 `delegationDepth`——**证实**（`0.1.7-rc.2` 全接缝重认证；本批收窄为「最小保护集除外」） |
| Codex | 原生多代理（`multi_agent` 默认启用；交互式真实使用 `spawn_agent`） | 共享工作区，或协调者**显式**建树并在委派 prompt 指定 `workdir`（实测证实；原生子代理无自动建树） | 载荷 `agent_id` + `agent_type`——**证实**（交互式实测；守卫读 `agent_id`，与 CC 同一判据） |

> `multi_agent` 的 headless 子面与 hook 触发面实测见 4.5（对应结论只在其标注的形态内成立，**不得外推**）。

**三平台 `cwd` 语义对照（真机实测新增的精确事实 · 「身份先于路径」的精确理由）**——同为载荷 `cwd`，三平台语义各不相同，逐行如下（三行各自独立，缺一行即口径残缺）：

| 平台 | 载荷 `cwd` 的实际语义 | 对路径判定的影响 |
|------|----------------------|------------------|
| **Claude Code** | **子代理的工作目录**（`…\.claude\worktrees\<agent-id>`） | **路径判定是正确的** |
| **Codex** | **恒等于会话根**（子代理在 worktree 写入而 `cwd` 仍是主工程，见 4.5） | **路径判定必错** |
| **dsh** | 载荷**无** `cwd`（桥接另读会话 header cwd，见 4.6） | 路径判定**不适用** |

> ⇒ **不是「路径判定普遍不可靠」，而是三平台 `cwd` 语义各不相同（正确 / 恒错 / 无）——只有身份判据是三平台同义的**。该对照只解释**为什么必须身份优先**，**不构成**「可以改走路径判定」的依据：契约仍走**身份判据**（三条通道同义）。本表与入口技能「三平台 `cwd` 语义对照」同口径（形态同源 + 漂移可见，`L-067`）。


## 5. change 分支 + worktree 组合

分支模式（`branchMode=true`，git 仓库 + init 自动创建 `change/<id>` 分支）下：

- **子代理 worktree 从 change 分支分出（隔离工作区形态专属）**：`isolation: "worktree"` 基于**当前分支**（change/<id>）快照创建，子代理看到的是该分支内容——该形态下委托前必须 commit 上游工件，否则子代理看不到未提交改动（同第 3 节规避方式）；**共享工作区形态**（身份通道下的直接委托）看得到未提交改动，不需要这一步，但委托前仍须按 `dirty-worktree.md` 澄清归属
- **协调者产物提取路径不变**：仍用 `git show <branch>:<path>` 从 worktree 取回产物，`<branch>` 此时是 `change/<id>`（可用 `git ls-tree change/<id> <path>` 确认存在）
- **分支模式下归档全程在 change/<id> 分支上执行**：entry/exit archive 校验当前分支 = `change/<id>`（提前切走会被 BLOCKED）；**归档 exit 完成后**再做合并收尾——切到默认分支（先探测，不假设 main，如 e2e 项目是 master）`git checkout <默认分支> && git merge change/<id>`，合并完成后 `git branch -d change/<id>` 删除分支
