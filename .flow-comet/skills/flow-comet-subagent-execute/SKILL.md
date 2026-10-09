---
name: flow-comet-subagent-execute
description: "Use only when explicitly invoked as /flow-comet-subagent-execute or routed by the flow-comet entry/runtime to the subagent-execute Node; complete Subagent Execute for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

<!-- 手写区详细协议见 ../flow-comet/reference/entry-detail.md（可选阅读） -->

# Subagent Execute

## Node Goal

Complete the `subagent-execute` Node for `flow-comet`.

Responsibility: 委托 [P] 并行任务给子代理，要求加载 flow-comet-dev 并回传 evidence。

职责分工（趟次协作）：本节点负责**并行委托**（`parallel="true"` 且依赖已满足的任务，同一趟内同时发出）——委托节点可多次往返：每趟委托当时全部依赖已满足的并行任务，趟间由 execute 节点串行消化，直至不存在依赖已满足的可并行 pending 且无串行残留。execute 节点负责**串行委托**（非 parallel 任务，一次一个）。两者共用同一委托证据库（handoff 记录在 subagent-execute evidence）。序列形态不是本节点的关注点：全并行、全串行、串→并、并→串及任意混排均合法（合法性只取决于 `depends_on` 无环且引用存在；依赖环与缺失依赖已在 plan 出口拦截并附恢复指引），到达本节点的任务序列由多趟路由按依赖拓扑自动分趟消化。

> **平台事实与判级口径（证据与过程记录）**：Codex 原生多代理 `multi_agent` 为 stable、默认启用，「Codex 不能委派 / 不使用并行委托」**不是平台事实**——该**机制缺口**已由身份分派（载荷 `agent_id`）关闭（**三平台均可并行委派，差异只在谁建树**）；三平台通道对照表、逐平台载荷字段与判级口径（证实 / 推翻 / 未覆盖）、已知边界、旧结论留档、headless 子面实测订正见 `reference/platform-facts.md`：**要判定某平台的能力边界、或要引用某条平台结论时读它。**
> **并行安全四属性契约**：契约对象是**四属性**，不是 worktree——`worktree` 只是属性①「写权限」的**实现之一**，不是契约本身；「一律 worktree」的口号已作废（本仓决策：契约对象 = 四属性，worktree 降为实现之一）。三平台在同一判据下平行对等，**唯一差异是「谁建树」**。
>
> | # | 属性 | 含义 | 满足形态 |
> |---|------|------|----------|
> | ① | **写权限** | 每个写者必须有一条被守卫认可的写入通道 | **身份分派**（CC / Codex 载荷含 `agent_id` ⇒ 子代理语义；dsh 桥接以环境变量 `FLOW_COMET_AGENT_DEPTH` 透传正整数身份深度，**并同时注入桥接通道标记 `FLOW_COMET_AGENT_DEPTH_SOURCE`——守卫要求标记与深度同时在场才接受该通道**）——**worktree 只是本属性的实现之一**，不是必须；**最小保护集除外**：身份在场时 `.flow-comet/flow-comet-state.json` 与 `reference/workflow-protocol.json` 仍受拦（三平台一致 BLOCKED） |
> | ② | **提交隔离** | 提交只含自己 `write_files` 的字面路径 | 提交面 pathspec 纪律五要素（见 Guidance 同名小节） |
> | ③ | **验证隔离** | 同一时刻只有一个写者：全量判据不得与在飞写者并行 | 出口校验锚 = `handoffRequests` 有 request 无对应 `handoffResult` ⇒ 新 change BLOCKED / 旧 change WARN；全部有 result ⇒ 放行；无证据 ⇒ 零输出（**已撤回的 request 不构成在飞委托**：`workflow-handoff.mjs withdraw <task-id> --by <来源>` 在原记录上留痕 `withdrawnAt` + `withdrawnBy`，已撤回 = 终态、历史不删） |
> | ④ | **集成纪律** | 机制选择 / 顺序 / 审计 / 冲突处置四项均有明文规则 | 集成纪律四要素（见 Guidance 同名小节） |
>
> **写面含 gitignored 面的任务（四属性映射 · 与其他任务同一判据）**：任务 `write_files` 全为 gitignored 字面路径时，四属性的满足方式不变——① **写权限**仍走**身份通道**（载荷 `agent_id` / 环境变量身份深度 ⇒ 子代理语义放行，项目内任意路径可写（含 gitignored）；gitignored 只是路径属性，不是通道差异）；② **提交隔离**走既有 **`noCommit` 资格**（request 按 `.gitignore` 命中记 `noCommit:true` ⇒ 任务零提交，「提交只含自己 `write_files` 的字面路径」由**无提交**满足，不是放宽校验；资格 fail-closed：glob / `..` 越界 / 非 git 仓 / tracked 文件 / 链接逃逸一律不授予，result 时刻按同一判据重验，失败即撤销资格）；③④ 与其他任务同形（同一时刻单写者 + 集成四要素）。**并行 × 零提交**因此合法：任务可标 `parallel="true"` 并被并行委派，出口校验按 request 的 `noCommit` 资格豁免缺 `commitHash`。
> **留痕的边界（诚实声明 · 与 `directOverride` / `completedChecks` / `reentryAuthorization` 同族）**：留痕记录的是「**发生过委派**」，**不是**对执行者身份的物理证明——`handoffRequests` / `handoffResult` 只证明协调者写下过 request 与 result 两条记录，不证明写入确实由子代理完成；与 `completedChecks` 只能记录声明、`directOverride` 只能记录授权、`reentryAuthorization` 只能记录授权源同理。声明与事实不符属流程违规，验收以 transcript 可见的委派触发为准。
>
> **dsh 平台委托方式（实测核对）**：dsh 的子代理是平台**进程内子代理**（不创建独立工作区）——写入守卫按**会话身份分派**：桥接**不再短路**，而是把身份深度以环境变量 `FLOW_COMET_AGENT_DEPTH` **连同通道标记 `FLOW_COMET_AGENT_DEPTH_SOURCE`** 透传给守卫（**身份与最小保护集的整条判定统一由守卫拥有**，单一实现；守卫要求标记与深度同时在场才接受该通道——CC / Codex 生成的 hook 直接调守卫、不走桥接，继承来的深度变量不构成身份）；身份深度为正整数 ⇒ 放行（**最小保护集除外**）、**项目内任意路径可写（含 gitignored）**，因此**无需隔离区**；直接委托即可，不需要 worktree（**无需隔离区 ≠ 无需边界**：`write_files` 互斥与提交时点纪律仍是硬前置）。**通用边界**：同一工作区内的并行子代理会看到彼此未提交的中间态——任务的 `write_files` 边界与提交时点即相互隔离纪律（本节点第 1 步的 write_files 互斥检查因此仍是硬前置）。
>
> **受支持路径（三平台同一判据，差异只在谁建树）**：① **CC 平台**——直接委托子代理（守卫按身份分派放行）；`Agent` 工具的 `isolation: "worktree"` 是属性①的一种实现（**非强制**，见步骤 3）；② **dsh 平台**——直接委托平台进程内子代理（守卫按身份分派放行，**无需隔离区**；保持 `write_files` 边界与提交时点纪律）；③ **Codex 平台**——直接委托原生子代理（`spawn_agent` 等，守卫按身份分派放行；默认共享工作区，保持 `write_files` 边界与提交时点纪律）。**建树选择的适用面**：协调者显式 `git worktree add <路径>`（手工建树）**是受支持的建树选择**——在委派 prompt 里指定 `workdir`，写入由身份通道放行（原生子代理无自动建树）；**以建树绕过边界**不受支持——用独立树规避协调者禁令 / 最小保护集 / `write_files` 互斥与提交时点纪律 / handoff 与 Return Contract 证据，或把 worktree 当作四属性的替代品。headless 子面实测见 `reference/platform-facts.md`（仅 `codex exec`，不得外推）。
> **不提供/不使用规避通道**：绕开守卫命令级检测的写法（如用 Python `open()` 等 File API 直写）**不是受支持路径**——它绕过的是写入防线本身（防线失效时无拦截、无记录），与三层防御的设计相反。需要越出边界时一律走上面的受支持路径，或如实上报 BLOCKED，**不得以更换工具形态绕过**。handoff 记录（workflow-handoff request/result）与 Return Contract 校验机制不变。

## Guidance

### 必填段清单（结构+存在级）

| 文件 | guard 强制段（缺失 = BLOCKED） | 其余模板段（模板要求，guard 不拦） |
|------|-------------------------------|-----------------------------------|
| SUMMARY.md | `## verify 输出` / `## 6 维自查`（须含实质内容）/ `## 越界检查` / `## 自检方法` | `## 做了什么` / `## 改动文件` 等（执行纪律，review 把关） |

> **注意**：flow-kit 的 SUMMARY 模板**不含 `## 自检方法` 段**——该段是 flow-comet 的强制增量（guard 校验自检方法声明）。使用 `flow-kit/templates/SUMMARY.md` 填写后，**必须按上方必填段清单补写 `## 自检方法` 段**，否则新 change 的 exit 会被 BLOCKED。
>
> **无 parallel 任务时**：若路由到此节点但 TASK.md 无 `parallel="true" status="pending"` 任务（如全部任务已被 execute 串行处理），按常规流程记录证据后直接退出（entry → record → exit），不要空转等待。

加载声明（阶段层 · 双步硬规则）见下文 Required Skill Calls 节。

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B；「填得好不好」由 review 把关。

> **模板权威**：本节点产出工件的段形唯一权威 = `flow-kit/templates/**`；`.specs/archive/**` 是历史证据、**不是模板来源**——不得以「上一轮就是这么写的」对齐段形。

# Subagent Execute

## Node Goal

This node parallelizes execution by delegating independent tasks (marked `parallel="true"` in TASK.md) to separate subagents. Each subagent loads the full `flow-comet-dev` protocol and operates within its task's `read_files`/`write_files` boundaries. This node produces handoff evidence for each delegated task and marks them done in TASK.md after all subagents complete. It exists to exploit parallelism when tasks have no file conflicts. All three platforms (Claude Code / Codex / dsh) can delegate in parallel under one identity-based criterion; the only difference is who creates the tree (Claude Code may create one via `isolation: "worktree"`; Codex and dsh share the workspace). The contract object is the four parallel-safety attributes — worktree isolation is one optional implementation of attribute ①, not a requirement (see the four-attribute contract and the platform channel table above).

Division of labor (pass-based collaboration): this node handles parallel delegation (`parallel="true"` tasks whose dependencies are satisfied — all of them dispatched concurrently within a pass) and may be entered multiple times across passes: each pass delegates every currently eligible parallel task, serial tasks are digested by the `execute` node between passes, and the node counts as complete only when no dependency-satisfied parallel task and no serial task remains. The `execute` node handles serial delegation (non-parallel tasks, one at a time). Both share the same delegation evidence library (handoff recorded under subagent-execute evidence). Sequence shape is not this node's concern: all-parallel, all-serial, serial→parallel, parallel→serial, and any mixed interleaving are all legal (legality depends only on an acyclic `depends_on` graph whose references all exist; cycles and missing dependencies are already intercepted at the plan exit with recovery guidance), and any sequence reaching this node is digested pass by pass by multi-pass routing along the dependency topology.

## Guidance

### 协调者禁令（最高优先级）

主会话是协调者，不是执行者。禁止在主会话直接修改源码或执行实现。源码只能委托子代理完成，**委托形态按平台（差异只在谁建树）**：**CC = 直接委托子代理**（`isolation: "worktree"` 是属性①的可选实现，非强制）；**dsh = 直接委托平台进程内子代理（无需隔离区；无需隔离区 ≠ 无需边界）**；**Codex = 直接委托原生子代理（`spawn_agent` 等，默认共享工作区）**——三平台同一身份判据放行，见上方「并行安全四属性契约」；三平台通道对照表与平台判级口径见 `reference/platform-facts.md`。子代理派发失败时，主会话**不得接管实现**——记录当前任务为 BLOCKED 并走 Recovery。协调者只允许更新：TASK.md（标记 done）、`<task>-SUMMARY.md`、handoff evidence（workflow-handoff.mjs result）。

### 提交面 pathspec 纪律（要点 · 全文见 `reference/commit-discipline.md`）

**适用条件**：并发写者共处一个工作树时（CC 非 worktree 委托 / Codex 共享工作区 / dsh 进程内子代理）本条生效；**各自独立工作区（worktree 等）内的局部 `reset` / `clean` 不在禁令内**——但只要本趟有**任一**共享工作区的写者，本条即覆盖整个并行趟。

五要素（缺一不可）：

1. **`git add -- <自己字面路径>`**：逐条字面路径（取自本任务 `write_files`），禁用 `.` / `-A` / `-u` 等宽泛形态。
2. **`git commit -- <同一路径>`**：路径集与上一步**逐字一致**——提交只含自己的文件。
3. **锁失败重试**：并发提交会撞 `index.lock` / `cannot lock ref`，**失败即重试**，不得因此改用宽泛命令。
4. **禁裸 `add` / `commit -a` / `stash` / `clean` / `reset`**：它们作用于整个共享工作区。
5. **为什么**：并发写者共享**同一索引与工作树**，宽泛命令有**并发索引竞态**（把同伴半成品纳入自己的提交），`stash` / `clean` / `reset` 还会直接破坏同伴的未提交工作。

**并行波次另加两条**：禁用 `git commit --amend`（HEAD 会被并行写者推进——确需修正必须**先断言 `git rev-parse HEAD` 等于自己刚提交的哈希**，否则改用**新提交追加**）；**误改后的自救通道**是第 4 条的定向例外——先断言 HEAD 即被误改的那次提交，再 `git reset --soft <自己的父提交>`（**只用 `--soft`**），最后以 **pathspec** 重建自己的提交；**无合法修复通道时人会暗改**（见 ADR-013 记录的同型教训）。

> **要判定提交边界、撞上锁或误改要收拾时读 `reference/commit-discipline.md`**：五要素逐条判据、命令完整形态与实测依据在该文件。

### 集成纪律（要点 · 全文见 `reference/commit-discipline.md`）

四要素：

1. **机制选择**：优先 **`git merge --no-ff`**（保留父子关系、可审计；comet 先例：集成用 `--no-ff`、交付用 `--ff-only`）；冲突难解时**降级 `git cherry-pick` 并强制记因**。
2. **顺序（确定性规则）**：按 `depends_on` 的**拓扑序**（被依赖者先入），同一拓扑层内按 **task id 升序**——**不得依赖书写顺序** / 提交到达顺序 / 完成先后等运行期不确定量。
3. **审计留痕**：每次集成输出一行 `INTEGRATE: <task-id> <commitHash> → <集成提交>`（降级路径记降级原因），映射记入该趟流程记录；**判级**：审计行是**执行纪律**（review 把关），本节点不声称存在机械门禁校验它。
4. **冲突处置（两类分别动作）**：**机械冲突**（不改用户可见行为）执行者**可自行解决**，解决后必须跑**合并后验证**并在审计行记因；**语义冲突**（两侧对同一行为 / 契约 / 接口给出不同语义）**必须中止集成并上抛**（记 BLOCKED + 恢复指引，由协调者 / 用户裁决）——**不得**由执行者自行拍板。

> **要在集成前定规则、或遇冲突 / 降级要判定时读 `reference/commit-discipline.md`**：四要素的完整判据与 comet 先例在该文件。

### 受控重入打开的修复场景（archive 源）

缺陷在归档后才暴露、且归档移动尚未发生时，可先由用户显式授权把工作归属退回本节点或 `execute` / `review` / `verify`，再按常规委托与出口流程完成修复。命令：`node .claude/skills/flow-comet/scripts/workflow-state.mjs reenter <target> --authorized-by <source> --reason <text> [--continue-round <n>]`。要点：**每次调用都需要用户显式授权**（不得由执行者自决）；每 change 上限 3 轮，达上限后凭 `--continue-round <n>`（n ≥ 已用轮次 + 1）显式续轮；重入前自动落 state 快照（`.specs/<change-id>/.reentry-backups/`）；成功打印 `REENTRY:` 行与 `REASON: <text>` 行（与 `FIX-BATCH` / `RETURN` 行三态可区分）。归档移动已发生或 change 已 `completed` ⇒ 重入 BLOCKED（走人工处置或新 change，**不得静默跳过**）；重入只改工作归属——不写闭合标记、不跳过本节点入口 / 出口门禁，重入后仍按本节点常规流程校验委托证据与 write_files 边界。

> **要核对授权留痕 / 轮次与续轮审计 / 备份指纹 / 归档侧重入边界时读 `reference/fix-loop.md`**：受控重入的完整规格在该文件。

### Prerequisites

- `.specs/<change-id>/TASK.md` must exist with at least one task marked `parallel="true"` and `status="pending"`.
- `.specs/<change-id>/DESIGN.md` or `DESIGN-lite.md` must exist.
- `.specs/LESSONS.md` must exist (or be created).
- Delegation capability, split by platform: **Claude Code** requires the `Agent` tool (subagents are delegated with it; `isolation: "worktree"` is one optional implementation of attribute ①, not a requirement); **dsh** requires the platform's in-process delegation capability (subagents carry an identity depth > 0, share the workspace, and need no isolation directory); **Codex** requires the platform's native multi-agent capability (real, stable and default-enabled — its regular usage is the interactive CLI — and its subagents share the workspace by default). All three platforms delegate under the same identity criterion (payload `agent_id` for Claude Code / Codex; the bridge-forwarded identity signal for dsh), so the only difference is who creates the tree. A manually created `git worktree` **is a supported tree-creation choice** (see the "受支持路径" section above): point the delegation prompt at its `workdir` and the write is admitted through the identity channel (native subagents do not create a tree automatically). What is **not** supported is **using a tree to bypass the boundaries** — evading the coordinator prohibition / the minimum protection set / `write_files` mutual exclusion and commit-timing discipline / handoff and Return Contract evidence, or treating the worktree as a substitute for the four attributes.

### Steps

0. **委托前检查清单（必做——走 worktree 隔离形态时，未 commit 的工件不会被 worktree 子代理看到，曾导致子代理空上下文运行）**：
   - ① `git status --short`：change 工件（`.specs/<change-id>/`）**必须已 commit**——**走 worktree 隔离形态时**（CC `isolation: "worktree"`），未 commit 的工件对 worktree 子代理不可见（harness 从已提交 HEAD 创建 worktree）；共享工作区形态（CC 非 worktree 委托 / Codex / dsh）无此限制，但**内联上下文仍是推荐做法**
   - ② `git log --oneline -1`：确认 HEAD 位置（change 分支）
   - ③ 委托 prompt **必须内联任务块全文 + 相关 AC**（worktree 基线可能不是 change 分支——harness 行为不可控；共享工作区形态虽可见工件，内联仍是唯一可靠路径）
   - ④ **子代理会话 Skill 工具可用性（委托前探测）**：委托 prompt 必须要求子代理开工前确认本会话是否具备 Skill 工具——具备时用 Skill 工具加载 `flow-comet-dev`；不可用时按 Read 加载节点 SKILL + `flow-kit/prompts/4-dev.md` 协议执行，并在 Return Contract 回传 `"skillToolFallback": "<降级替代形态，如 file-read>"`（SUMMARY「自检方法」段同步声明该替代形态并注明未执行 Skill 工具注入）。**禁止把 Read 声称为已注入**；委托 prompt 未写明该口径 = 委托前检查未完成，不得发出委托
   - **Red Flag**：worktree 工件不可见 / 基线不确定时**禁止继续委托**——先 commit 或内联上下文
   - 委托后：子代理回报 commitHash 后校验存在性（`git cat-file -e <commitHash>`，workflow-handoff result 已有 W2-D git show 校验兜底）

1. **Identify parallel tasks**: Read TASK.md and find all tasks with `parallel="true"` and `status="pending"`. Verify they are genuinely independent (no file conflicts between them — check `write_files` do not overlap).

2. **For each parallel task, create handoff request**: Use `workflow-handoff.mjs request <task-id>` to register the handoff. **委托即记 request**——直接记录 result 而无对应 request 时,write_files 允许列表为空会被 BLOCKED(新 change 强制委托边界),补 request 后再重录 result 即可。
   > 若不传 `--write-files`，脚本会自动从 TASK.md 对应 task 的 `<write_files>` 块解析（orchestrator 无需手动从 TASK.md 提取文件列表）。
   **归属纪律**：request 会校验任务的并行属性与原始 `currentNode`——并行 pending 任务只归属本节点，串行 pending 任务归属 `execute`；错误节点的新 change 请求会被 BLOCK，并按输出运行 `workflow-state next` 与 `entry <目标节点>` 恢复后再重试。
   The handoff prompt must include:
   - The task's full XML block from TASK.md.
   - DESIGN.md sections 0 and 0.5 for context.
   - REQUIREMENT.md ACs relevant to this task.
   - Explicit instruction to **use the Skill 工具** to load `flow-comet-dev` and follow its full protocol `flow-kit/prompts/4-dev.md`（不得跳过——读取 SKILL.md 文件不叫加载，跑声明命令也不叫加载；加载 = Skill 工具把 skill 注入会话）。
   - **Skill 工具不可用时的降级口径（与上一条并排内联）**：子代理会话不具备 Skill 工具时，按 Read 加载节点 SKILL + `flow-kit/prompts/4-dev.md` 协议执行，Return Contract 回传 `"skillToolFallback": "<降级替代形态，如 file-read>"`，SUMMARY「自检方法」段同步声明该替代形态并注明未执行 Skill 工具注入；**禁止把 Read 声称为已完成 Skill 工具注入**。
   - Explicit requirement to return `completedChecks` in the Return Contract containing `required-skill:subagent-execute.flow-comet-dev`（证明已加载 implementation skill；guard W1-D 严格校验，缺失 → exit BLOCKED，无旧 change 豁免）。Skill 工具不可用而走降级时该条目标记仍按契约回传，但必须与 `skillToolFallback` 降级声明并排出现——只回传标记而无声明视为不实声明，orchestrator 不得记录 result。
   - The task's `read_files` and `write_files` boundaries.
   - Instruction to produce `<task-id>-SUMMARY.md` in `.specs/<change-id>/` following the `flow-kit/templates/SUMMARY.md` template（标题/首部/段序保真，另补 flow-comet 增量 `## 自检方法` 段）。
   - **提交边界警告**:提交**只含该任务 write_files 范围内的文件**(含测试文件)——不得包含 TASK.md 与其他协调者维护的 .specs 工件(新 change 提交越界 BLOCKED;实测子代理提交含 TASK.md 被 W2-D 拦截)。**提交从属规则**:任务专属的 `<task-id>-SUMMARY.md`(位于 `.specs/<change-id>/`,是 flow-comet 强制产物)允许随任务提交属流程默认豁免——目标仓库的既有规定优先,若目标仓库忽略清单等既有规定拒绝其入库,被拒即为正确行为,严禁 force-add 强加越库提交;委托校验对任务摘要的豁免属于校验宽容度,不是入库指令。

   - **提交面 pathspec 纪律（五要素，见 Guidance 同名小节）**：子代理必须用 `git add -- <自己字面路径>` + `git commit -- <同一路径>`，锁失败重试，禁裸 `add` / `commit -a` / `stash` / `clean` / `reset`（适用条件：**多个写者共享同一工作区**；各自独立工作区内的局部 `reset` / `clean` 不在禁令内）。
   - **集成纪律（四要素，见 Guidance 同名小节）**：协调者集成时优先 `git merge --no-ff`；降级 `cherry-pick` 必须记因；集成顺序按 `depends_on` 拓扑序 + 同层 task id 升序；冲突按**机械冲突 / 语义冲突**两类分别处置（后者必须中止并上抛）。

3. **Delegate to subagents**（三平台同一判据，差异只在谁建树）: **Claude Code 平台**：直接委托子代理——守卫按**身份判据优先于路径判据**放行（载荷含 `agent_id` ⇒ 子代理语义）；`Agent` 工具的 `isolation: "worktree"` 是属性①的一种实现（**可选，非强制**，见「并行安全四属性契约」）；`.claude/worktrees/**` 路径前缀通道仍为兼容通道。**dsh 平台**：直接委托平台进程内子代理——守卫按会话身份分派（身份深度为正整数 ⇒ 放行（**最小保护集除外**）、项目内任意路径可写（含 gitignored）），**无需隔离区**；同一工作区的并行子代理会看到彼此未提交中间态，靠 `write_files` 边界互斥与提交时点作相互隔离纪律（**无需隔离区 ≠ 无需边界**）。**Codex 平台**：直接委托原生子代理（`spawn_agent` 等）——守卫按身份分派放行（真机实测：载荷含 `agent_id` / `agent_type`）；默认**共享工作区**，同样靠 `write_files` 边界互斥与提交时点纪律。**建树选择的适用面**：协调者显式 `git worktree add <路径>`（手工建树）**是受支持的建树选择**——在委派 prompt 里指定 `workdir`，写入由身份通道放行（原生子代理无自动建树）；**以建树绕过边界**不受支持——用独立树规避协调者禁令 / 最小保护集 / `write_files` 互斥与提交时点纪律 / handoff 与 Return Contract 证据，或把 worktree 当作四属性的替代品。**不得用 File API 直写等规避通道代替**（绕过写入防线不是受支持路径）。Each subagent (all three platforms):
   - Reads TASK.md for its specific task block.
   - Executes the full TDD protocol (RED/GREEN/REFACTOR). **纯文档/纯配置任务无生产代码可测时，`redEvidence` 与 `greenEvidence` 均允许 `{"command":"N/A (non-code task)","output":"..."}` 形态**（guard W1-D 接受此形状；不得伪造测试输出）。
   - Greps existing abstractions (R6.4).
   - Scans LESSONS (R1.8).
   - Runs verify command and records real output.
   - Performs self-review (brooks-lint or 6-dimension quick check).
   - Performs diff boundary check (R6.5).
   - Makes atomic commit with format `<type>(<scope>): <subject>` (scope optional: short subsystem noun; change-id, dates and task ids must NOT be used as scope; task id goes in the commit body as a `Task: <task-id>` trailer).
   - Writes `<task-id>-SUMMARY.md` to `.specs/<change-id>/`.
   - Returns evidence via `workflow-handoff.mjs result <task-id>`.

4. **Collect evidence**: After all subagents complete, verify each returned:
   - SUMMARY.md exists in `.specs/<change-id>/` and is **模板保真**（按 `flow-kit/templates/SUMMARY.md`：标题 `# SUMMARY:` / 首部 4 字段 / 段序一致，含 `## 自检方法` 段）。
   - Verify output is real (not fabricated).
   - Handoff evidence is recorded.

5. **Mark done**: Update TASK.md — set `status="done"` for all completed parallel tasks.

6. **Record overall evidence**: Run `node .claude/skills/flow-comet/scripts/workflow-state.mjs record subagent-execute '<evidence JSON>'` to record completion.

7. **Exit check**: Run exit check.

## Return Contract（子代理必须回传）

每个被委托的子代理，完成时必须在最终回复中回传以下结构化信息（缺任一项，orchestrator 不得记录 handoff result）：

```json
{
  "status": "DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT",
  "taskId": "T0X",
  "commitHash": "<git commit sha>",
  "changedFiles": ["<file>", "..."],
  "completedChecks": ["required-skill:subagent-execute.flow-comet-dev"],
  "redEvidence": { "command": "<RED 失败测试命令>", "output": "<真实失败输出片段>" },
  "greenEvidence": { "command": "<GREEN 通过测试命令>", "output": "<真实通过输出片段>" },
  "riskSignals": ["cross-module | security | concurrency | migration | public-api | 200+lines | none"],
  "concerns": "<可选：未解决的疑虑>",
  "skillToolFallback": "<仅 Skill 工具不可用时回传：降级替代形态（如 file-read），未执行 Skill 工具注入>"
}
```

- `status=DONE` 才视为完成；`BLOCKED` / `NEEDS_CONTEXT` 需 orchestrator 处理。
- `redEvidence` / `greenEvidence` 缺任一 → 视为未执行 TDD，orchestrator 拒绝记录；**新 change 下 guard 强制 BLOCKED**（旧 change WARN 渐进）。
- `completedChecks` 必须含 `required-skill:subagent-execute.flow-comet-dev`（子代理加载 implementation skill 的证明）；缺任一项 → guard exit 严格 BLOCKED（W1-D，无旧 change 豁免），orchestrator 不得以旧格式/补录方式绕过。
- **Skill 工具不可用降级（如实声明）**：子代理会话不具备 Skill 工具时，按 Read 加载节点 SKILL + 协议执行并在 Return Contract 回传 `"skillToolFallback": "<降级替代形态，如 file-read>"`（SUMMARY「自检方法」段同步声明该替代形态并注明未执行 Skill 工具注入）；此时 `completedChecks` 的 `required-skill:...` 标记仍按契约保留，但必须与降级声明并排出现——只回传标记而无降级声明视为不实声明，orchestrator 不得记录 result；具备 Skill 工具时不得回传该字段。**该字段是声明、不是物理证明**：回执只能记录会话的声明，读 SKILL.md 与真实 Skill 注入在机器可读证据上不可区分（与 `directOverride` / `completedChecks` 同族的诚实边界）——声明与事实不符属流程违规，验收以 transcript 可见的 Skill 工具触发为准。
- `riskSignals` 非 `none` 时，orchestrator 应将该任务标记为 review 节点的高优先级审查对象。
- 子代理回传后，orchestrator 用 `workflow-handoff.mjs result <task-id> '<JSON>'` 记录；guard exit subagent-execute 会校验 commitHash + greenEvidence + completedChecks（W1-D，严格）。

### Completion reasoning

This node is truly done when:
- All delegated parallel tasks have `status="done"` in TASK.md.
- Every delegated task has a `<task-id>-SUMMARY.md` that is template-faithful (title `# SUMMARY:`, header fields, section order — per `flow-kit/templates/SUMMARY.md`, plus the `## 自检方法` section) in `.specs/<change-id>/`.
- Handoff evidence (request + result) is recorded for each task.
- No subagent exceeded its `write_files` boundary.
- No serial tasks were delegated (only `parallel="true"` tasks).

### Red flags

- **Agent thought**: "This task looks independent, I'll delegate it." **Actual risk**: Delegating tasks that are not marked `parallel="true"` bypasses the wave division logic. execute 的串行委托走 execute 节点，本节点只并行委托 parallel 任务。
- **Agent thought**: "Subagent can figure out what to do from context." **Actual risk**: Subagent not loading `flow-comet-dev` means it skips TDD, LESSONS scan, diff boundary check, and self-review. The handoff prompt must explicitly require flow-comet-dev.
- **Agent thought**: "Subagent might need to touch related files for context." **Actual risk**: Subagent exceeding `write_files` boundaries creates merge conflicts with other parallel subagents. Strict boundary enforcement is mandatory.
- **Agent thought**: "One subagent finished, mark it done immediately." **Actual risk**: Marking tasks done before all subagents complete can cause issues if a later subagent fails and needs to reference completed work. Wait for all, then batch mark.

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry subagent-execute
```

## Skill Implementation

The subagent-execute node identifies all `parallel="true"` pending tasks in TASK.md, creates handoff requests via `workflow-handoff.mjs`, and delegates each to a fresh-context subagent (identity-based write channel on all three platforms; worktree isolation is one optional implementation of attribute ①) with `flow-comet-dev` loaded. Each subagent executes the full dev protocol independently, follows the commit-pathspec discipline (five elements) and the integration discipline (four elements) recorded above, and the orchestrator collects evidence and marks tasks done after all subagents complete.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-dev` | Required in each subagent's prompt | Provides TDD, LESSONS scan, diff boundary, self-review protocol for each parallel task |

**加载声明（阶段层 · 双步硬规则）**：本节点技能已由入口路由经 Skill 工具加载（你正在阅读的就是它）；本节点 Required Skill Calls 的加载与声明同样不可跳过：

1. **用 Skill 工具加载** `flow-comet-dev`。**不得跳过**——只读取 SKILL.md 文件不叫加载；真正让 flow-comet-dev 指令生效的是 Skill 工具把它注入本次会话。本节点的 flow-comet-dev 为 handoff scope——协调者在此声明（声明标记的自动补写不覆盖 handoff scope，必须手动声明），各子代理在各自会话按 `flow-kit/prompts/4-dev.md` 协议用 Skill 工具加载并执行；协调者构造 handoff prompt 时按 `flow-kit/prompts/4-dev.md` + `flow-kit/templates/SUMMARY.md` 引用子代理的 dev 协议与交付模板。
2. 加载完成后**立即**运行声明命令（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load subagent-execute flow-comet-dev --prompt flow-kit/prompts/4-dev.md
```

> **跑 skill-load 声明命令 ≠ 加载**：声明只把“哪次会话加载了哪个 skill、按哪份协议工作”写进状态供 exit/record 核对；真正加载只有第 1 步的 Skill 工具能做到。

## Output Schemas

Schema: `flowkit.handoff.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `task-summaries` | file | yes | `.specs/<change-id>/*-SUMMARY.md` (one per delegated task) |
| `handoff-evidence` | evidence | yes | Recorded via workflow-handoff.mjs |

Evidence: `handoff-request` (required per task), `handoff-result` (required per task)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record subagent-execute '{"summary":"N parallel tasks delegated and completed, handoff evidence recorded for each"}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `handoff-evidence` | Handoff evidence recorded for each task | evidence-only |
| `parallel-only` | Only parallel="true" tasks delegated | 执行纪律（review 把关），guard 不校验 |
| `boundary-safe` | No subagent exceeded write_files | 新 change 提交越界 BLOCKED（handoff 记录时校验），旧 change WARN 渐进 |
| `summaries-exist` | SUMMARY.md exists for each delegated task | artifact-exists |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit subagent-execute --apply
```

If the script prints `SKILL: flow-comet-review`, load that Skill next.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Read `.specs/<change-id>/TASK.md` — identify which parallel tasks are still `status="pending"`.
3. Check for existing `<task-id>-SUMMARY.md` files — tasks with summaries are done even if TASK.md not updated.
4. Re-delegate only the remaining pending parallel tasks.
5. If a subagent failed mid-execution, check for `<task-id>-PROGRESS.md` and use its "excluded solutions" to avoid repeating failures.
