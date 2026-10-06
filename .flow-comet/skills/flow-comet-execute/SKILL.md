---
name: flow-comet-execute
description: "Use only when explicitly invoked as /flow-comet-execute or routed by the flow-comet entry/runtime to the execute Node; complete Execute for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Execute

## Node Goal

Complete the `execute` Node for `flow-comet`.

Responsibility: 按 TASK.md 逐任务执行（**执行模式按 executionMode**：subagent 默认统一委托子代理、direct 逃生口主代理直写）。串行任务的 TDD + 6 维自查 + LESSONS 扫描 + diff 边界 verify 由执行者承担，无论哪种模式都必须加载 flow-comet-dev 协议。

In subagent mode (default) this node is a coordinator: it does not write implementation code directly — it delegates the pending serial tasks to fresh-context subagents (all three platforms delegate under one identity-based criterion; worktree isolation is one optional implementation of attribute ①, not a requirement — see the four-attribute contract below), each subagent applies the full dev protocol (TDD RED/GREEN/REFACTOR, LESSONS scan, existing abstraction grep, self-review, diff boundary verification, atomic commits) and returns a Return Contract. 趟次协作：并行委托节点（subagent-execute）可多次往返——每趟委托全部依赖已满足的并行任务，本节点在趟间消化串行任务，直至两者清空。The coordinator records handoff evidence, verifies each SUMMARY, and marks tasks done in TASK.md. In direct mode (escape hatch, user-confirmed) the main agent implements serial tasks directly — see 执行模型 below.

## Guidance

### 必填段清单（结构+存在级）

| 文件 | guard 强制段（缺失 = BLOCKED） | 其余模板段（模板要求，guard 不拦） |
|------|-------------------------------|-----------------------------------|
| SUMMARY.md | `## verify 输出` / `## 6 维自查`（须含实质内容）/ `## 越界检查` / `## 自检方法` | `## 做了什么` / `## 改动文件` 等（执行纪律，review 把关） |

> **注意**：flow-kit 的 SUMMARY 模板**不含 `## 自检方法` 段**——该段是 flow-comet 的强制增量（guard 校验自检方法声明）。使用 `flow-kit/templates/SUMMARY.md` 填写后，**必须按上方必填段清单补写 `## 自检方法` 段**（声明 brooks-review / cache-brooks / builtin-quickcheck 三值之一及降级证据），否则新 change 的 exit 会被 BLOCKED。

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B；「填得好不好」由 review 把关。

> **模板权威**：本节点产出工件的段形唯一权威 = `flow-kit/templates/**`；`.specs/archive/**` 是历史证据、**不是模板来源**——不得以「上一轮就是这么写的」对齐段形。

### 执行模型（按 executionMode，用户显式选择）

- **subagent（默认）**: 统一委托子代理——协调者流程（构造 handoff → 按平台通道委托（三平台同一身份判据；worktree 为属性①的可选实现）→ 收集 Return Contract → 验收标 done）
- **direct（逃生口，需用户显式切换）**: 主代理直接执行串行任务——但必须加载 flow-comet-dev 完整协议
  （TDD/6 维自查/越界检查/原子 commit），SUMMARY 必填段 + `## 自检方法` 强制（guard 校验兜底）
- 无论哪种模式：`parallel="true"` 任务始终由 subagent-execute 并行委托，不在此节点执行。

执行模式由 `node .claude/skills/flow-comet/scripts/workflow-state.mjs status` 输出（`executionMode` / `directOverride`）决定，切换用 `node .claude/skills/flow-comet/scripts/workflow-state.mjs execution-mode <subagent|direct>`。direct 是逃生口，必须用户显式调用才生效。

### 任务范围

execute 节点**只处理 `parallel="false"`（或未标注 parallel）的 pending 任务**。

**归属纪律**：request 会校验任务的并行属性与原始 `currentNode`——串行 pending 任务只归属本节点，并行 pending 任务归属 `subagent-execute`；错误节点的新 change 请求会被 BLOCK，并按输出运行 `workflow-state next` 与 `entry <目标节点>` 恢复后再重试。

**TASK 签名校验（C3，execute 期间）**：entry execute 时记录任务集签名（行尾规范化 + 标记属性剥离）；exit 时比对——execute 期间 TASK.md **只允许改开标签的标记属性**（`status` done/pending；时间戳如需记录写在开标签属性如 `completed_at`——签名剥离白名单允许；**禁止写入 action/其他 task 内容**），增删任务/改 action/改边界/改其他内容会在 exit 被 BLOCKED（签名不匹配）。回退修复任务（review/verify 发现缺陷追加）须先经 review 流程追加到 `## Fix 任务` 段，再按下方「修复回路状态机路径」受控归位 execute，并由 entry execute 刷新签名（端到端验证实证：直接注入任务会被签名拦截）。

本节点**不直接写实现代码**。所有 pending 任务统一委托 fresh-context 子代理执行（加载 flow-comet-dev + 回传 Return Contract）；委托通道按平台（差异只在谁建树），见下方「并行安全四属性契约」与三平台通道对照表。

- `parallel="true"` 的 pending 任务由 subagent-execute 节点负责并行委托
- execute 遍历 TASK.md 时，遇到 `parallel="true" status="pending"` 的任务块应**跳过**
- **全 parallel 任务时 execute 不得空退出（除非显式豁免）**：guard 的 exit 校验（evidence 前置 → 串行 pending 检测 → Output Schema 产物）会 BLOCKED——「空退出」默认不可达（实测确认）。正确路径：
  1. 正常流程下 determineNode 的 路由逻辑会**直接路由到 subagent-execute**（无需经过 execute 空退出）——协调者确认 路由逻辑生效（`NODE: subagent-execute`）后直接进入该节点
  2. 若已进入 execute 且确认无串行任务可做：按正常 exit 流程处理（record execute evidence + 满足产物校验），需要豁免越俎代庖检测时用 `record execute '{"parallelTakeoverApproved":true}'` 显式声明；[P] 任务由 execute 完成属越权委托——新 change BLOCKED（旧 change WARN 渐进）
  3. **显式空退出豁免（新 change 可用）**：确认全 parallel 无串行可做且无法路由时，用 `record execute '{"emptyExitApproved":true}'` 显式声明后 exit 通过（跳过串行 pending 与产物校验；防规划错误仍默认 BLOCKED——豁免须显式声明；exit 输出 EMPTY-EXIT 审计提示）
- determineNode 路由逻辑会优先检测依赖已满足的 parallel 任务并路由到 subagent-execute；若 determineNode 路由到了 execute，说明当前趟存在需要 execute 处理的串行任务（此时应执行而非空退出）——串行消化完成后再次路由，剩余并行任务回到 subagent-execute 的下一趟（多趟循环直至无可并行 pending 且无串行残留）

### 并行安全四属性契约与三平台通道对照表（两册同锁 · 与 subagent-execute 册同句同表）

> **并行安全四属性契约（两册同锁 · 逐字一致）**：契约对象是**四属性**，不是 worktree——`worktree` 只是属性①「写权限」的**实现之一**，不是契约本身；「一律 worktree」的口号已作废（本仓决策：契约对象 = 四属性，worktree 降为实现之一）。三平台在同一判据下平行对等，**唯一差异是「谁建树」**。
>
> | # | 属性 | 含义 | 满足形态 |
> |---|------|------|----------|
> | ① | **写权限** | 每个写者必须有一条被守卫认可的写入通道 | **身份分派**（CC / Codex 载荷含 `agent_id` ⇒ 子代理语义；dsh 桥接以环境变量 `FLOW_COMET_AGENT_DEPTH` 透传正整数身份深度）——**worktree 只是本属性的实现之一**，不是必须；**最小保护集除外**：身份在场时 `.flow-comet/flow-comet-state.json` 与 `reference/workflow-protocol.json` 仍受拦（三平台一致 BLOCKED） |
> | ② | **提交隔离** | 提交只含自己 `write_files` 的字面路径 | 提交面 pathspec 纪律五要素（见 Guidance 同名小节） |
> | ③ | **验证隔离** | 同一时刻只有一个写者：全量判据不得与在飞写者并行 | 出口校验锚 = `handoffRequests` 有 request 无对应 `handoffResult` ⇒ 新 change BLOCKED / 旧 change WARN；全部有 result ⇒ 放行；无证据 ⇒ 零输出 |
> | ④ | **集成纪律** | 机制选择 / 顺序 / 审计 / 冲突处置四项均有明文规则 | 集成纪律四要素（见 Guidance 同名小节） |
>
> **三平台通道对照表（四属性 × 三平台；差异只在「谁建树」）**：
>
> | 平台 | ① 写权限通道 | 谁建树 | ②③④ |
> |------|--------------|--------|-------|
> | **Claude Code** | 身份分派（载荷含 `agent_id`）；`.claude/worktrees/**` 路径前缀为**兼容通道**，不是唯一通道 | harness 可自动建树（`Agent` 工具的 `isolation: "worktree"`——①的一种实现，非强制） | 三平台同形 |
> | **Codex** | 身份分派（载荷含 `agent_id` / `agent_type`；真机实测：子代理载荷 12 键含 `agent_id`，主线程 10 键不含） | 无自动建树——默认**共享工作区** | 三平台同形 |
> | **dsh** | 身份分派（桥接以环境变量 `FLOW_COMET_AGENT_DEPTH` 透传正整数身份深度；0 / 缺失 = 协调者） | 平台**进程内子代理**，不建树 | 三平台同形 |
>
> **判级口径（三态；未覆盖项显式标注、不得写成已支持）**：**证实**——Codex 交互式会话的原生子代理载荷含 `agent_id`（2026-10-04/05 真机会话实测）· dsh 身份分派通道 · CC 的 `.claude/worktrees/**` 兼容通道（历史实证）。**推翻**——「Codex 载荷无身份字段」只对 `codex exec` headless 主线程成立，**不得外推**为平台结论。**未覆盖（显式标注，不得写成已支持）**——非 Windows 环境的 Codex 形态 · `agent_type` 取值域 · 嵌套委派载荷 · Codex hook 触发稳定性（实测 3/21；补 `--dangerously-bypass-approvals-and-sandbox` 后 5/5，**不得写成稳定保证**）· CC 隔离树的真实落点探针待补 · dsh 子代理能否带独立 cwd 的探针待补。

### 提交面 pathspec 纪律（五要素 · 带适用条件 · 两册同锁 · 逐字一致）

**适用条件（先读）**：本条纪律适用于「**多个写者共享同一工作区**」形态——并发写者同处一个工作树（CC 非 worktree 委托 / Codex 共享工作区 / dsh 进程内子代理）。**各自独立工作区（worktree 等）内的局部 `reset` / `clean` 不在禁令内**（那是写者对自有工作区的正常整理）；但只要本趟存在**任一**共享工作区的写者，本条即对整个并行趟生效。

五要素（缺一不可）：

1. **`git add -- <自己字面路径>`**：逐条字面路径（取自本任务 `write_files`），禁用 `.` / `-A` / `-u` 等宽泛形态。
2. **`git commit -- <同一路径>`**：提交以 pathspec 限定范围，保证提交只含自己的文件；路径集与上一步**逐字一致**。
3. **锁失败重试**：并发提交会撞 `index.lock` / `cannot lock ref`——**失败即重试**（临时仓真并发实测：20 提交 / 25 次锁失败全部重试成功）；不得因锁失败改用宽泛命令。
4. **禁裸 `add` / `commit -a` / `stash` / `clean` / `reset`**：无 pathspec 的 `git add`、`git commit -a`、`git stash`、`git clean`、`git reset` 一律禁止——它们作用于整个共享工作区。
5. **为什么**：并发写者共享**同一个索引与工作树**——宽泛命令存在**并发索引竞态**：一方 `add -A` 会把另一方的半成品纳入自己的提交（串味 / 多文件提交）；`stash` / `clean` / `reset` 更会直接破坏同伴的未提交工作。

**并行波次附加两条（与上列五要素并列适用 · 不改其语义与适用条件）**：

- **并行波次禁用 `git commit --amend`**：共享工作区下 HEAD 会被并行写者推进——`--amend` 改的是 **HEAD 指向的提交**、不一定是「你的提交」，会把同伴的提交连同提交信息一并改写（本仓实测撞过：amend 误改了另一并行任务的提交，经 `reset --soft` 复原，内容零损失）。确需修正时必须**先断言 `git rev-parse HEAD` 等于自己刚提交的哈希**，否则一律改用**新提交追加**。
- **误改后的自救通道（与上列第 4 条的定向例外）**：合法修复路径 = **先断言** `git rev-parse HEAD` 即被误改的那次提交，再 `git reset --soft <自己的父提交>` 回退（**只用 `--soft`**：只移动 HEAD、不动索引与工作树，同伴的未提交工作零影响），最后以 **pathspec** 重建自己的提交。纪律必须留出这条明路——让执行者**不必违规**（force-push / 手改历史）即可收拾；**无合法修复通道时人会暗改**（见 ADR-013 记录的同型教训）。

### 集成纪律（四要素 · 两册同锁 · 逐字一致）

1. **机制选择**：优先 **`git merge --no-ff`**（保留父子关系、可审计；comet 先例：集成用 `--no-ff`、交付用 `--ff-only`）；冲突难解时**降级 `git cherry-pick` 并强制记因**（审计行写明降级原因）——cherry-pick 丢失父子关系、审计弱，故只作降级路径。
2. **顺序（确定性规则）**：先按 `depends_on` 的**拓扑序**集成（被依赖者先入）；同一拓扑层内按 **task id 升序**（计划期固定的稳定键，与完成先后无关）。**不得依赖书写顺序** / 提交到达顺序 / 完成先后等运行期不确定量。
3. **审计留痕**：每次集成输出一行审计行 `INTEGRATE: <task-id> <commitHash> → <集成提交>`；降级路径为 `INTEGRATE: <task-id> <commitHash> via cherry-pick -- 降级原因：<原因>`。映射（task-id → commitHash → 集成提交）记入该趟流程记录（`<task-id>-SUMMARY.md` / handoff evidence 文本字段）。**判级**：审计行是**执行纪律**（review 把关），本节点不声称存在机械门禁校验它。
4. **冲突处置（两类分别动作）**：
   - **机械冲突**（不改用户可见行为：同一文件不同区域 / 相邻行 / 纯格式）：执行者**可自行解决**——解决后必须跑**合并后验证**（该任务 `verify` + 受影响任务的判据），并在审计行记录冲突与解决方式。
   - **语义冲突**（两侧对同一行为 / 契约 / 接口给出不同语义：同一函数语义分叉、同一 AC 的两种实现、公共 API 形状不一致）：**必须中止集成并上抛**（记 BLOCKED + 恢复指引），**不得**由执行者自行拍板；由协调者 / 用户裁决（补 `depends_on`、拆任务或开新 change）。

### Prerequisites

- `.specs/<change-id>/TASK.md` must exist with at least one `status="pending"` task.
- `.specs/<change-id>/DESIGN.md` or `DESIGN-lite.md` must exist — agent must read section 0 (tech stack) and section 0.5 (architecture alignment).
- `.specs/LESSONS.md` must exist (or be created from template if missing).
- For frontend/UI tasks: `.specs/<change-id>/UI-DESIGN.md` must exist.
- 若当前任务的 `<task-id>-PROGRESS.md`（位于 `.specs/<change>/`；与 Recovery 段及归档期 `*-PROGRESS.md` 扫描同口径）存在，必须先读取"已排除方案"段（R1.6 反重复），确认当前计划不在排除列表中。完成后删除该文件，有用信息迁移至 SUMMARY。
- 委托前按 `reference/dirty-worktree.md` 检查脏工作树（`.specs/<change-id>/` 未提交工件会触发 entry execute 的 WORKTREE WARN；verify 前为自查建议，无 guard 检查）。

### Steps（subagent 模式 · 协调者流程，统一委托子代理）

对 TASK.md 每个 pending 串行任务，协调者执行：

1. **读 task 块，构造 handoff request**：读 `<task>` XML 块（`action` / `read_files` / `write_files` / `verify` / `done`）。若内容有歧义，停下询问——不要猜。构造 handoff request 内容：task 全文 + DESIGN §0/§0.5 + AC + read/write_files 边界。运行 `node .claude/skills/flow-comet/scripts/workflow-handoff.mjs request <task-id>` 记录。**委托即记 request**——直接记录 result 而无对应 request 时,write_files 允许列表为空会被 BLOCKED(新 change 强制委托边界),补 request 后再重录 result 即可(执行者实证)。
2. **委托子代理**：按平台通道委托 fresh-context 子代理（三平台同一身份判据，差异只在谁建树；`isolation: "worktree"` 是属性①的可选实现，非强制——见「并行安全四属性契约」）。handoff prompt 强制协议：子代理用 **Skill 工具**加载 flow-comet-dev 并按 `flow-kit/prompts/4-dev.md` 协议执行（TDD RED/GREEN/REFACTOR、LESSONS 扫描、既有抽象 grep、verify、6 维自查、越界检查、原子 commit `<type>(<scope>): <subject>`（scope 推荐可选：子系统短词；禁 change-id/日期作 scope；任务号放提交正文尾注 Task: <task-id>，change-id 不入标题）），按 `flow-kit/templates/SUMMARY.md` 模板写 `.specs/<change-id>/<task-id>-SUMMARY.md`（标题/首部/段序保真，另补 flow-comet 增量 `## 自检方法` 段），回传 Return Contract（含 commitHash + greenEvidence + completedChecks + selfReview）。**SUMMARY 自引用 hash 注**：提交内容无法包含自身 hash——若子代理 amend 提交,SUMMARY 内记录的 commitHash 为 amend 前值属预期(文件集一致即可,以实际提交对象为准)。
   **提交从属规则**:任务专属的 `<task-id>-SUMMARY.md`(位于 `.specs/<change-id>/`,是 flow-comet 强制产物)允许随任务提交属流程默认豁免——目标仓库的既有规定优先,若目标仓库忽略清单等既有规定拒绝其入库,被拒即为正确行为,严禁 force-add 强加越库提交;委托校验对任务摘要的豁免属于校验宽容度,不是入库指令。
   **提交面 pathspec 纪律（五要素，见 Guidance 同名小节）**：handoff prompt 必须要求子代理用 `git add -- <自己字面路径>` + `git commit -- <同一路径>` 提交、锁失败重试、禁裸 `add` / `commit -a` / `stash` / `clean` / `reset`（适用条件：**多个写者共享同一工作区**；各自独立工作区内的局部 `reset` / `clean` 不在禁令内）。**集成纪律（四要素，见 Guidance 同名小节）**：协调者集成时优先 `git merge --no-ff`、降级 `cherry-pick` 记因、顺序按 `depends_on` 拓扑序 + 同层 task id 升序、冲突按机械 / 语义两类分别处置。
3. **记录 handoff result**：子代理回传后，运行 `node .claude/skills/flow-comet/scripts/workflow-handoff.mjs result <task-id> '<JSON>'` 记录（Return Contract 含 commitHash + greenEvidence + completedChecks + selfReview）。
4. **验收 SUMMARY，TASK.md 标 done**：确认 SUMMARY 按 `flow-kit/templates/SUMMARY.md` 填写且**模板保真**（标题 `# SUMMARY:` / 首部 4 字段 / 段序一致）、含 `## 自检方法` 段（声明 brooks-review / cache-brooks / builtin-quickcheck 三值之一）、verify 输出真实、6 维自查与越界检查有实质内容；通过后在 TASK.md 将任务标 `status="done"` 并加时间戳。
5. **下一个 pending 任务**：重复步骤 1-4。

> 原 Steps 的 TDD / LESSONS / verify / 6 维自查 / 越界检查 / commit 协议**移入 handoff prompt 作为子代理的强制协议**，协调者不亲自执行。
> **Return Contract 非代码任务**：纯文档 / 纯配置任务子代理回传时，`greenEvidence` 与 `redEvidence` 均允许 `{"command":"N/A (non-code task)","output":"..."}` 形态（command 字段存在即可通过 W1-D 校验；redEvidence 缺失在新 change 下仍会被 W1-D 拦截，因此必须显式提供此形态而非省略字段）。
> **Return Contract 的 completedChecks 统一契约**：子代理回传的 `completedChecks` 必须包含 `required-skill:subagent-execute.flow-comet-dev`——execute（串行委托）与 subagent-execute（并行委托）的 handoff 统一记录在 subagent-execute 证据库（共用证据库语义），guard 的 W1-D 对全部委托结果统一校验该契约。取值与节点自证命名（本节点自身证据用的 `required-skill:execute.flow-comet-dev`，见 Required Skill Calls）无关。**格式要求**：`completedChecks` 必须是**字符串数组**（如 `["required-skill:subagent-execute.flow-comet-dev"]`）——对象数组（如 `[{id, status}]`）会被 guard 的严格比较判"缺"→ exit BLOCKED。示例：
>
> - 正确：`"completedChecks": ["required-skill:subagent-execute.flow-comet-dev"]`
> - 错误：`"completedChecks": ["required-skill:execute.flow-comet-dev"]` —— 按 execute 域命名会被 W1-D 拦截（exit BLOCKED），子代理必须回传统一契约值
> - 错误：`"completedChecks": [{"id": "required-skill:subagent-execute.flow-comet-dev", "status": "done"}]` —— 对象数组会被严格比较判"缺"（必须为字符串数组）
> **Return Contract 的 skillToolFallback 声明**：子代理会话不具备 Skill 工具时，必须并排回传 `skillToolFallback` 声明降级替代形态（如 `file-read`）——该字段是**声明、不是物理证明**（回执只能记录声明，读 SKILL.md 与真实 Skill 注入在机器可读证据上不可区分）；只有 `required-skill` 标记而无降级声明视为不实声明，orchestrator 不得记录 result；具备 Skill 工具时不得回传该字段。

The full dev protocol, templates, and constraints are in:
- `flow-kit/prompts/4-dev.md` (DEV phase) — handoff prompt 的子代理强制协议（不再以“参照前一产物”转述——子代理必须显式按此协议执行并加载 flow-comet-dev）
- `flow-kit/templates/SUMMARY.md` (SUMMARY template) — 每份 `<task-id>-SUMMARY.md` 的填写模板（标题/首部/段序保真，另补 `## 自检方法` 段）

### Completion reasoning

This node is truly done when:
- All tasks in TASK.md have `status="done"`.
- Every done task has a corresponding `<task-id>-SUMMARY.md` in `.specs/<change-id>/`.
- Every SUMMARY.md is template-faithful (title `# SUMMARY:`, header fields, section order — per `flow-kit/templates/SUMMARY.md`, plus the `## 自检方法` section) and contains: verify output (real, not fabricated), 6-dimension self-check, and boundary check.
- No REQUIREMENT.md or DESIGN.md has been modified during execution.
- No out-of-boundary files have been changed without explicit approval.

### Red flags

- **Agent thought**: "I'll write the code first, then grep for existing abstractions." **Actual risk**: Writing code without grepping first (R6.4 violation) leads to duplicate implementations. Must grep BEFORE writing.
- **Agent thought**: "LESSONS scan is optional for simple tasks." **Actual risk**: Skipping LESSONS scan (R1.8 violation) means repeating known failures. Even simple tasks can hit documented pitfalls.
- **Agent thought**: "verify passed in my head, marking done." **Actual risk**: Marking done without running verify (R2.4 violation) means untested code enters review. Must paste real output.
- **Agent thought**: "I see a bug in an adjacent file, let me fix it along the way." **Actual risk**: "Fixing along the way" without a new task or CHANGE violates R7.1 (scope control). Must stop and create a new task or CHANGE.
- **Agent thought**: "This task is taking long, let me skip the self-review." **Actual risk**: Skipping self-review defers quality issues to the review node, where they become Critical items requiring fix tasks. Better to catch early.
- **Agent thought**: "这个 parallel 任务小，我顺手在主会话做了。" **Actual risk**: 违反并行委托设计——subagent-execute 节点被静默跳过，丢失并行隔离与 write_files 冲突防护；且 execute 出口的 all-tasks-done 校验会 BLOCKED（parallel 无 handoffResult）。parallel="true" 任务只能由 subagent-execute 委托。

## 修复回路状态机路径

review / verify 发现缺陷后的修复必须回到 `execute` 节点生命周期内完成，禁止驻留源节点「顺手修完」；引擎按以下路径强制闭环（`<源节点>` 为 review 或 verify）：

1. **追加 Fix 任务**：在 `.specs/<change-id>/TASK.md` 的 `## Fix 任务` 段内追加编号修复任务（完整任务字段），**禁止文件尾追加**；任务集修订必须在 `entry` 之前完成。
2. **受控归位 execute**：运行 `workflow-state next`（完整命令：`node .claude/skills/flow-comet/scripts/workflow-state.mjs next`），或运行 `workflow-guard entry execute`（完整命令：`node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry execute`）。处于 Fix 回退态（源节点驻留 + 存在 pending Fix 任务 + 当前路由判定为 execute）时，引擎把当前节点受控归位为 `execute`（`currentNode=execute`），并输出 `FIX-BATCH` 审计行（`next` 同时输出 `NODE: execute`）；用 `workflow-state.mjs status` 确认 `stateCurrentNode` 已是 `execute` 再开工；若未归位，先按 `next` / `status` 的输出核对任务状态与路由，不要未经归位硬开工。
3. **执行修复**：按 execute 节点生命周期完成全部 Fix 任务（委托/直写规则不变）；`entry execute` 刷新任务集签名，锁定追加后的任务集——归位后不得再增删任务或修改任务内容。
4. **跑 execute 四类出口**：`record execute` → `exit execute --apply`。四类出口门禁真实执行——**全任务 done / 逐任务 SUMMARY 完备 / 6 维自查 + 自检方法声明 / 任务集签名一致**；任一缺失即 BLOCKED 并给出恢复指引。通过后，引擎在 Fix 二次完成时把当前节点推回源节点（review 或 verify）。
   - **guard exit 回源审计行语义（Fix vs RETURN）**：真实修复回路二次完成保留 `FIX-BATCH: 回源节点 <源节点>`（真实 Fix 回炉的机器锚）；正常多趟收尾（任务集签名全等且无 Fix 标记）输出中性 `RETURN: 回源节点 <源节点>`（非 Fix 回修）；旧 state 缺闭合/修复证据（无签名事件且无 Fix 标记）输出 `RETURN: 回源节点 <源节点>（旧 state 缺闭合/修复证据，未分类）`，不冒充 Fix、不 BLOCK；上述分类只改审计行文本，路由与 state 写入零变化。此处 `RETURN:` 仅指审计行前缀，与子代理 handoff 的 Return Contract 无关。
5. **回源节点跑出口**：回到源节点后运行 `next`，Fix 回程豁免生效时应输出 `NODE: review` 或 `NODE: verify`（不会因源节点产物已存在而跳过）；若仍输出后续节点，说明回程条件未满足，先核对状态机归属与任务状态，不要继续推进。随后执行 `entry <源节点>` → `exit <源节点> --apply` 跑源节点出口门禁（即 entry/exit 源节点）；通过后继续正常路由（review → verify；verify → archive），必要时进入下一轮 Fix 闭环。
   - **`next` 回程审计行语义**：回程豁免行始终输出中性 `RETURN: 回程源节点 <源节点>`（源节点产物在场且未出口；保留源节点跑出口），不再输出 FIX-BATCH；受控归位行的 `FIX-BATCH: 归位 <execute 家族>` 保留（真实 Fix 回退行），两者不得混同。
6. **禁止绕过**：驻留源节点不归位、顺手改完后直接跑源节点 exit 收场会被 BLOCKED（存在未归位/未跑出口的修复回路），必须按上述路径恢复；不得用跳过归位或出口门禁的手段（含手动改写 `.flow-comet/flow-comet-state.json`）替代本路径。

**由受控重入打开的场景（archive 源）**：缺陷在归档后才暴露、且归档移动尚未发生时，可先由用户显式授权把工作归属退回 `execute` / `subagent-execute` / `review` / `verify` 之一，再按本节路径回到 execute 生命周期完成修复。重入命令：`node .claude/skills/flow-comet/scripts/workflow-state.mjs reenter <target> --authorized-by <source> --reason <text> [--continue-round <n>]`——每次调用都需要用户显式授权，每 change 上限 3 轮（达上限后凭显式续轮授权 `--continue-round <n>`（n ≥ 已用轮次 + 1）可继续并计入下一轮）；重入前自动落 state 备份快照（`.specs/<change-id>/.reentry-backups/`）；成功打印 `REENTRY: archive → <target>（授权源 <source>；第 n/3 轮；备份 <file>）` 与 `REASON: <text>` 行（续轮审计行为 `第 n 轮（显式授权续轮，上限 3）`），与 Fix 回炉的 `FIX-BATCH` 行、正常多趟收尾的 `RETURN` 行三态可区分。归档移动已发生或 change 已 `completed` 时重入 BLOCKED，须走人工处置或新 change，不得静默跳过。重入只改工作归属，不写任何闭合标记，也不跳过目标节点入口 / 出口与源节点出口门禁；重复调用同一目标为空操作（输出 `REENTRY: 空操作——…`，不备份、不计数、不改写 state）。

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry execute
```

## Skill Implementation

Load `flow-comet-execute` for this Node. Operation: `require`.

The execute node loads `flow-comet-dev` for each task execution. It iterates through all pending tasks in TASK.md, applying the full dev protocol: TDD, LESSONS scan, existing abstraction grep, self-review (brooks-lint or 6-dimension quick check), diff boundary verification, and atomic commits. Each task produces a SUMMARY.md and is marked done in TASK.md.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-dev` | Required for each task execution | Provides TDD protocol, LESSONS scan, 6-dimension self-check, diff boundary rules, schema migration, breaking change protocol |

Load `flow-comet-dev` during this Node and record completed check `required-skill:execute.flow-comet-dev`. Reason: TDD + 6 维自查 + R4.5 + R4.6

**加载声明（阶段层 · 双步硬规则）**：本节点技能已由入口路由经 Skill 工具加载（你正在阅读的就是它）；本节点 Required Skill Calls 的加载与声明同样不可跳过：

1. **用 Skill 工具加载** `flow-comet-dev`（本节点 Required Skill Call）。**不得跳过**——只读取 SKILL.md 文件不叫加载；真正让 flow-comet-dev 指令生效的是 Skill 工具把它注入本次会话。委托子代理时，子代理同样必须用 Skill 工具加载 flow-comet-dev（按 `flow-kit/prompts/4-dev.md` 协议执行）。
2. 加载完成后**立即**运行声明命令（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load execute flow-comet-dev --prompt flow-kit/prompts/4-dev.md
```

> **跑 skill-load 声明命令 ≠ 加载**：声明只把“哪次会话加载了哪个 skill、按哪份协议工作”写进状态供 exit/record 核对；真正加载只有第 1 步的 Skill 工具能做到。

## Augmentations

This Node has no declared augmentations.

## Output Schemas

Schema: `flowkit.execution.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `task-summaries` | file | yes | `.specs/<change-id>/*-SUMMARY.md` (one per task) |
| `task-plan-updated` | file | yes | `.specs/<change-id>/TASK.md` (status="done" for all) |

Evidence: `implementation-summary` (required)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record execute '{"summary":"All N tasks completed, each with SUMMARY.md and verify output"}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `build-evidence` | At least one SUMMARY.md produced | artifact-exists |
| `all-tasks-done` | All tasks in TASK.md have status="done"（pending 串行任务 → BLOCKED）；done 任务须有对应 SUMMARY（新 change 强制 BLOCKED，旧 change WARN 渐进） | content-check |
| `verify-output-real` | Every SUMMARY.md has verify output (not fabricated) | 执行纪律（review 把关），guard 不校验 |
| `no-design-changes` | REQUIREMENT.md and DESIGN.md not modified | 执行纪律（review 把关），guard 不校验 |
| `self-check-method` | Every SUMMARY.md declares `## 自检方法`（brooks-review / cache-brooks / builtin-quickcheck） | W1-B 段级校验 |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit execute --apply
```

After exit, run `node .claude/skills/flow-comet/scripts/workflow-state.mjs next` to get the next node.

If the script prints `SKILL: flow-comet-subagent-execute`, load that Skill next.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Read `.specs/<change-id>/TASK.md` — find first `status="pending"` task.
3. Read any existing `<task-id>-SUMMARY.md` files to confirm completed progress.
4. Check for `<task-id>-PROGRESS.md` files — if found, read "excluded solutions" section to avoid repeating failures (R1.6).
5. Resume from the first pending task. Do not repeat completed tasks.
6. If a PROGRESS.md exists for the current task, delete it after completion and migrate useful info to SUMMARY.md.
