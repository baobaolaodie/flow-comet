# 平台事实（三平台通道 · 判级口径 · 实测与边界）

> **读者对象**：在任一节点上引用平台结论、构造委派 prompt、或要写「某平台支持 / 不支持」措辞的执行者与协调者。
> **何时读**：要判定平台能力（能否并行委派 / 谁建树 / 写通道是什么）或引用平台判级口径时读。
>
> 本文件内容**逐字搬运**自 `flow-comet-subagent-execute` 与 `flow-comet` 两册的原有段落（搬运，不重写）；各节点册只留要点句与条件句。

## Codex 平台事实与当前支持面

> **Codex 平台事实与 flow-comet 当前支持面（2026-09-30 记录）**：**平台事实**——Codex 的常规用法是交互式 CLI（`codex` 无子命令）与会话内 agent，`codex exec` 只是 headless 子面；原生多代理 `multi_agent` 为 stable、默认启用（`codex features list` 可查），本机真实交互式会话日志中记录到 `spawn_agent` / `wait_agent` / `close_agent` 的实际调用——因此「Codex 不能委派 / 不使用并行委托」**不是平台事实**。**已关闭的机制缺口**——本节点此前记录「原生子代理形态未被守卫 / 白名单 / 隔离模型覆盖」的**机制缺口**，已由身份分派（载荷 `agent_id`）关闭：**三平台均可并行委派，差异只在谁建树**（Codex 无自动建树、默认共享工作区）；headless 子面实测见下（仅 `codex exec`，不得外推）。

## 通道对照表（subagent-execute 侧：四属性 × 三平台）

> **三平台通道对照表（四属性 × 三平台；差异只在「谁建树」）**：
>
> | 平台 | ① 写权限通道 | 谁建树 | ②③④ |
> |------|--------------|--------|-------|
> | **Claude Code** | 身份分派（载荷含 `agent_id` / `agent_type`——**证实**：真机实测子代理载荷含二者、主会话载荷不含，与 Codex 同一判据）；`.claude/worktrees/**` 路径前缀为**兼容通道**，不是唯一通道 | harness 可自动建树（`Agent` 工具的 `isolation: "worktree"`——①的一种实现，非强制） | 三平台同形 |
> | **Codex** | 身份分派（载荷含 `agent_id` / `agent_type`；真机实测：子代理载荷 12 键含 `agent_id`，主线程 10 键不含） | 无自动建树——默认**共享工作区** | 三平台同形 |
> | **dsh** | 身份分派（桥接以环境变量 `FLOW_COMET_AGENT_DEPTH` 透传正整数身份深度 **+ 通道标记 `FLOW_COMET_AGENT_DEPTH_SOURCE`**；0 / 缺失 / 无标记 = 协调者） | 平台**进程内子代理**，不建树 | 三平台同形 |

## 判级口径（三态）

> **判级口径（三态；未覆盖项显式标注、不得写成已支持）**：**证实**——Codex 交互式会话的原生子代理载荷含 `agent_id`（2026-10-04/05 真机会话实测）· CC 子代理载荷含 `agent_id` / `agent_type`（真机实测：子代理载荷含二者、主会话载荷不含，与 Codex 同一判据）· dsh 身份分派通道 · CC 的 `.claude/worktrees/**` 兼容通道（历史实证）。**推翻**——「Codex 载荷无身份字段」只对 `codex exec` headless 主线程成立，**不得外推**为平台结论。**未覆盖（显式标注，不得写成已支持）**——非 Windows 环境的 Codex 形态 · `agent_type` 取值域 · 嵌套委派载荷 · Codex hook 触发稳定性（实测 3/21；补 `--dangerously-bypass-approvals-and-sandbox` 后 5/5，**不得写成稳定保证**）· 非 `bypassPermissions` 权限模式下的载荷形态 · dsh 子代理能否带独立 cwd 的探针待补。

## 旧结论留档

> **旧结论（实测 2026-08-13；证据已不可复核，未纳入 2026-09-30 重测矩阵——不得作为现行结论）**：worktree 的 `.git` 是主仓共享——`workspace-write`/`git-write-access` 沙箱均被 Codex 硬拦截（index.lock / objects / COMMIT_EDITMSG Permission denied）；子代理必须用 `sandbox_mode="danger-full-access"` 才能完成 git 提交（worktree 隔离已限定写范围，full-access 仅用于让 git 提交可行）。**信任边界**：`danger-full-access` 是宿主级信任边界（不隔离凭据/网络访问）——仅委托可信子代理，并移除委托环境中的不必要凭据。以上仅作历史留档；现行结论以探针结论与后续契约为准。

## headless 子面实测与 hook 会话 root 订正

> **headless 子面实测与 hook 会话 root 订正（依据 2026-09-30 真机重测；codex-cli 0.146.0 / Windows；仅 `codex exec --json --ephemeral` headless 子面；不得外推为平台结论）**：旧结论「手工 worktree 内的写入会被协调者白名单拦住、会话 root 仍是主仓库」被**推翻并收窄**——实测 hook 进程 cwd == 载荷 `cwd` == 会话工作根（cwd=项目 / `-C` / 手工 worktree 三形态）；**Codex 原生子代理（`spawn_agent`）形态未覆盖，不得外推**。手工 worktree 形态下相对路径写入**不会**被拦：worktree 通常缺 gitignored 运行态 state → 守卫走「无活跃 workflow」放行；若 hook 命令仍指向主仓安装副本（runRoot 外），守卫因「workflow protocol file must stay inside the project root」报错退出，Codex 将 hook 失败降级为非阻塞 → 写入照常落地。**静态喂测（独立复现）**：守卫白名单只覆盖**解析后仍在 runRoot 内**的目标；`Write/Edit` 的 `file_path` 解析为 runRoot 外时跳过判定（**fail-open**，记录时点**未闭合**）——**该缺口现已被守卫关闭**：runRoot 外写入与 Bash 写命令分支**同判** `BLOCKED`（修复前的两分支不对称是历史形态），身份在场者由身份判据先行放行；记录时点的缺口表述作为边界留档保留，现行判据见守卫的 runRoot 外关断段。**`apply_patch`**：会触发 PreToolUse，但 `tool_name="Bash"`、补丁正文在 `tool_input.command`（heredoc）、**无 `file_path`**；记录时点守卫不解析补丁体 → 目标不被提取、放行（独立复验复现了载荷与守卫盲区）——**该缺口现已被守卫关闭**：补丁体按行语义解析出 `*** Update File:` / `*** Add File:` / `*** Delete File:` / `*** Move to:` 摘要行的目标后与其余写入形态**同流**（白名单与最小保护集共用同一判定入口），身份在场者仍受最小保护集拦截；「文件确实落盘」子项在复验环境因 apply_patch shim 失败未复现，首次真机重测环境曾落盘——按此差异如实理解。**hook 触发条件**：隔离 `CODEX_HOME` 无持久信任时默认 headless **不执行**项目 hook；`hooks` 特性默认 enabled、可被项目配置/开关覆盖；`codex_hooks` 是 deprecated 别名；per-invocation 信任是必要因素之一，但独立复验显示 trust-only 触发**不稳定**（3/21；补 `--dangerously-bypass-approvals-and-sandbox` 后 5/5）——**不得写成稳定/确定性保证**；持久信任与交互式 TUI 形态未覆盖。**CC 的判据不同**：CC 的守卫以**身份判据优先于路径判据**（载荷含 `agent_id` ⇒ 子代理语义）；`.claude/worktrees/**` 路径前缀通道仍然在场，属**兼容通道**（写入落在该区内即放行，`file_path` 与 Bash 命令两条判定路径同语义），不再是唯一通道。

## 入口册侧：三平台通道表与实测口径（原文搬运）

**三平台通道（属性 × 平台）**——判级只取三态（**证实 / 推翻 / 未覆盖**）；**未覆盖 ≠ 已验证**，不得写成已支持：

| 属性 | Claude Code | Codex | dsh |
|------|-------------|-------|-----|
| ① 写权限 | 载荷 `agent_id` / `agent_type`——**证实**（真机实测：子代理载荷含二者、主会话载荷不含；与 Codex 同一判据） | 载荷 `agent_id` + `agent_type`——**证实**（实测：子代理载荷 12 键含二者、主线程 10 键不含）；守卫读 `agent_id`，与 CC 同一判据 | 桥接透传 `delegationDepth` **+ 通道标记**（`FLOW_COMET_AGENT_DEPTH_SOURCE`，守卫要求两者同时在场才接受 env 面身份——继承来的深度变量不作数）——**证实**（0.1.7-rc.2 全接缝重认证；本批收窄为「最小保护集除外」） |
| ② 提交隔离 | pathspec 纪律（多写者共享同一工作区形态） | 同左 | 同左 |
| ③ 验证隔离 | `subagent-execute` 出口锚：有 request 无 result（新 change BLOCKED / 旧 change WARN 渐进） | 同左 | 同左 |
| ④ 集成纪律 | `merge --no-ff` 优先；降级 cherry-pick 必记因 | 同左 | 同左 |
| **谁建树**（三平台唯一差异） | 可选：harness `isolation: "worktree"` 建独立树，或共享工作区直写 | 协调者**显式** `git worktree add` 并在委派 prompt 指定 `workdir`（原生子代理无自动建树；**证实**：子代理可被指向独立目录并落盘），或共享工作区直写；**建树选择的适用面**：协调者显式 `git worktree add <路径>`（手工建树）**是受支持的建树选择**——在委派 prompt 里指定 `workdir`，写入由身份通道放行（原生子代理无自动建树）；**以建树绕过边界**不受支持——用独立树规避协调者禁令 / 最小保护集 / `write_files` 互斥与提交时点纪律 / handoff 与 Return Contract 证据，或把 worktree 当作四属性的替代品。 | **不建树**：进程内子代理、同一工作区运行——**无需隔离区 ≠ 无需边界**（`write_files` 互斥 + 提交时点 + 最小保护集仍构成边界） |

**交互式 Codex 实测口径（口径以下文陈述为准；该次取证为**一次性工件**、已按仓库纪律清理——**分发产物不得把结论挂靠一次性路径**）**：交互式 Codex 会话触发 `PreToolUse`（启动有 hook 信任提示）· 原生子代理工具调用触发 · `spawn_agent` / `wait_agent` / `close_agent` 类调用各自触发 · 子代理可被指向独立 worktree · 全局 `~/.codex/hooks.json` 与项目级 hook **并存生效**（合并规则未覆盖）。

**已知边界（不得写成机械保证）**：① Codex 载荷 `cwd` = 会话根，**与实际工作目录无关**（实测证实）⇒ 路径判定在 Codex 上必错，故判定序为**身份先于路径**；② 身份判据是**声明式信任边界**——守卫读到的 `agent_id` 来自宿主载荷，本机制**不声称能证明**其真实来源；③ 该次实测结论只覆盖「Windows + 交互式 Codex TUI + 该版本」形态；CC 侧身份判据的真机实测条件同样是**限定形态**——**Windows + CC v2.1.177 + `permission_mode = bypassPermissions` + 一次性仓库载体**。`agent_type` 取值域、嵌套委派载荷、非 Windows 环境、非 `bypassPermissions` 权限模式**均未覆盖**（未覆盖 ≠ 已验证，不得写成已支持）。

**三平台 `cwd` 语义对照（真机实测新增的精确事实 · 「身份先于路径」的精确理由）**——同为载荷 `cwd`，三平台语义各不相同；下表**三行各自独立**，缺一行即口径残缺：

| 平台 | 载荷 `cwd` 的实际语义 | 对路径判定的影响 |
|------|----------------------|------------------|
| **Claude Code** | **子代理的工作目录**（`…\.claude\worktrees\<agent-id>`） | **路径判定是正确的** |
| **Codex** | **恒等于会话根**（子代理在 worktree 写入而 `cwd` 仍是主工程） | **路径判定必错** |
| **dsh** | 载荷**无** `cwd`（桥接另读会话 header cwd） | 路径判定**不适用** |

> ⇒ **不是「路径判定普遍不可靠」，而是三平台 `cwd` 语义各不相同（正确 / 恒错 / 无）——只有身份判据是三平台同义的**。该对照只解释**为什么必须身份优先**，**不构成**「可以改走路径判定」的依据：契约仍走**身份判据**（三条通道同义）。
