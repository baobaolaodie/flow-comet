---
name: flow-comet
description: "Use when the user wants the flow-comet managed workflow for flow-kit 9 阶段工作流的 workflow-kernel 实现。工件直接读写 .specs/, explicitly invokes /flow-comet, or persisted workflow state identifies one unambiguous active run. Route through this entry Skill; do not invoke its internal Node Skills directly."
---

<!-- 手写区详细协议见 GUIDANCE.md（可选阅读） -->

# flow-comet

## Decision Core

### 自动节点检测

**Step 0：确定当前节点与意图**

1. 检查 workflow protocol 的有序 Node 列表（open→design→plan→execute→subagent-execute→review→verify→archive）。
2. 运行 `node .claude/skills/flow-comet/scripts/workflow-state.mjs status` 确认检测到的节点。
3. 若脚本输出与文件产物冲突（如脚本说 execute 但 TASK.md 不存在），以文件为准，先纠正状态再继续。
4. 若用户描述的工作明显属于更后面的 Node（如"验证结果"但 design 尚未完成），暂停并说明前序 Node 必须先完成。
5. 若用户描述的工作属于已标记完成的更早 Node，视为纠正——重置该 Node 的完成状态并重新进入。

**Step 1：flow-kit 产物门禁**

| 目标节点 | 必须已有的上游工件 | 缺失时动作 |
|---------|-----------------|-----------|
| open | 无 | 直接进入 |
| design | CHANGE.md + REQUIREMENT.md | 回 open 补齐 |
| plan | DESIGN.md（或 DESIGN-lite.md） | 回 design 补齐 |
| execute | TASK.md | 回 plan 补齐 |
| subagent-execute | TASK.md（含 parallel=true pending 任务） | 回 execute 串行执行 |
| review | 所有 task status="done" | 回 execute 补齐 |
| verify | REVIEW.md | 回 review 补齐 |
| archive | UAT.md | 回 verify 补齐 |

**Step 2：读取下一个节点**

运行 `node .claude/skills/flow-comet/scripts/workflow-state.mjs next`。若返回的 NODE 与 Step 0 产物检测不一致，以产物为准。

### Resume 规则

- 每次上下文恢复，重新执行 Step 0 和 Step 2。不信任对话历史。
- 产物文件（`.specs/<id>/`）是唯一真相源。脚本状态只是加速器。
- 若状态显示某 Node 已完成但预期 artifact 缺失，视为未完成并重新进入。
- 若用户在某个 Node 中途恢复但话题变了，确认是继续当前 Node 还是开始新的。

### 决策分类与决策点

先分类再行动：

| 分类 | 定义 | 处理 |
|------|------|------|
| 用户决策 | ≥2 个会改变范围/行为/风险/不可逆结果的合法选项 | 用交互确认问（Claude Code 用 AskUserQuestion 优先；Codex 用文本提问+内联确认）或文本回退；相邻选择合并为一个问题，不重问已持久化选择 |
| 自动处理 | 唯一安全下一步 | 直接执行并汇报，不许制造确认 |
| 停止条件 | guard 失败 / 缺依赖 / 状态损坏 | 报告阻塞与恢复条件，无合法动作时才升级为用户决策 |
| 手动交接 | `NEXT: manual`（若有） | 不是用户决策，直接继续 |

**决策点清单（挂到四分类下）**：
- **用户决策**：首次调用且主题/范围有多个合法解释；技术栈选型（5~6 卡，design 节点内暂停）；破坏性变更检测（R4.6，execute 节点内暂停展示引用图）；Schema 迁移（R4.5，execute 节点内暂停）；REVIEW Critical 项（review 节点暂停等人工确认）；UAT 失败超限（第 4 次，机器计数 verifyFailures，verify 节点暂停）；归档操作（不可逆，archive 节点暂停等最终确认）；切换 executionMode 到 direct（execute 节点内暂停，需用户确认，记录 directOverride）；合并 change 分支到 main（归档收尾，merge 前暂停等用户确认）；PR approve（enablePrReview 开启时，archive 前置，等用户/GitHub approve）
- **自动处理**：唯一安全下一步直接执行；flow-kit 反问协议要求确认（CHANGE/REQUIREMENT/DESIGN）按 flow-kit 规则暂停等待
- **停止条件**：Node guard 失败时先自动诊断并执行唯一安全修复；缺依赖或状态损坏导致无法继续时报告停止条件与恢复条件；只有恢复方式存在多个会改变范围或风险的合法选项时，才升级为用户决策

### Red Flags

| Agent 想法 | 实际风险 |
|-----------|---------|
| "这是小改动，不用走完整流程" | 可走最短路径但不能跳过阶段门禁 |
| "REQUIREMENT 可以跳过，直接写代码" | R2.2：没有 REQUIREMENT 不能进 DESIGN |
| "verify 通过了所以可以归档" | 还要检查 REVIEW.md 的 Critical 项是否全部处理 |
| "上下文恢复后从上次对话继续" | 始终重新读取状态和产物文件，对话记忆不可靠 |
| "LESSONS.md 不用扫" | R1.8：每个 DEV 任务必须扫描 |
| "测试从实现派生就行" | R5.1：测试必须从 AC 派生 |
| "guard 失败了，让用户决定" | 先自动诊断并执行唯一安全修复；无合法动作时才报告停止条件 |
| "跳过 entry 直接 exit,反正没检查" | 新 change 未 entry 直接 exit → BLOCKED(进入检查不可跳过);旧 change WARN 渐进 |
| "SUMMARY 不写,任务先标 done" | 新 change done 任务缺 SUMMARY → BLOCKED(产物完整性强制);旧 change WARN 渐进 |
| "subagent-execute 阶段，我直接改源码更快" | 协调者禁令：subagent-execute 阶段主会话禁止写源码（hook 白名单只允许 .specs/，Write/Edit 与 Bash 写命令均物理拦截），必须委托子代理——委托走**身份通道**（三平台同一判据），worktree 只是「① 写权限」的实现之一，不是委托前提 |
| "用户要健康检查 / 同步架构，我给他 init 一个新 change" | 三条侧命令（evolve / health / context-scan）**不进 8 节点流程**——它们不路由、不 entry/exit、不写节点证据；按下方「侧命令」小节的命令面直接执行即可 |

## 侧命令（横向命令 · 不进 8 节点流程）

随包分发的三条**侧命令**不属于 8 节点流程：不参与节点路由，不被 `entry` / `exit` 门禁校验，也不会在流程里自动触发——一律由用户**显式调用**，涉及写入的动作要**人工逐项确认**。**上游对应物（只读基准，不修改）**：`flow-kit/prompts/{A-evolve,M-health,I-intel-scan}.md`——三条命令均已按本仓语义**显式覆盖**上游表述。**以下上游语义不采用**：① 把三条命令当作流程内的节点或自动触发项（上游各自成篇、不声明与 8 节点的关系）→ 本仓一律**显式调用**：不路由、不 `entry` / `exit`、不写节点证据；② 把三条命令的语义细则抄进入口册（同一口径两处表达）→ 本仓只在入口留**指针**，细则以各自技能册的「覆盖声明」为单一表达。**冲突处以各自技能册的「覆盖声明」与引擎实现为准**。用户表达下列意图时，**不要** `init` 新 change、**不要** `entry` / `exit` 任何节点，直接加载对应技能并按其协议执行：

| 命令 | 触发词（用户怎么说） | 用途 | 落盘产物 | 技能 |
|------|---------------------|------|---------|---------|
| `evolve` | 同步架构 / 整理沉淀 / evolve / 同步 CONTEXT | 扫归档 change 设计文档的架构沉淀段（`§9`）→ 候选清单 → **逐项** review 后 patch 项目级文档 | `.specs/evolve/<日期>-EVOLVE.md` | `flow-comet-evolve` |
| `health` | 健康检查 / health / 体检 / 技术债扫描 / 巡检 / 代码库健康度 | 确定性收集器出一份体检报告（代码体检工具在场时并入其 4 维结果并标注来源，缺席则显式降级声明） | `.specs/health/<日期>-HEALTH.md` | `flow-comet-health` |
| `context-scan` | 重扫上下文 / 刷新 CONTEXT / context-scan | 重跑上下文探测 → 与上次基线逐项比对（新增 / 消失 / 变更）→ 更新扫描时间 | `.specs/context-scan/<日期>-SCAN.md` | 无独立技能，按下方命令面直接执行 |

命令面（路径随安装平台替换——见「Scripts」小节的平台化说明；`--root` 缺省为当前目录）：

```bash
node .claude/skills/flow-comet/scripts/evolve.mjs scan [--root <项目根>]
node .claude/skills/flow-comet/scripts/evolve.mjs apply <候选 id> [<候选 id> ...] [--root <项目根>] [--scanner <执行工具>]
node .claude/skills/flow-comet/scripts/health.mjs [--root <项目根>] [--stdout]
node .claude/skills/flow-comet/scripts/context-scan.mjs [--root <项目根>] [--stdout]
```

**共同边界**：

- **只读优先**：任何写入都要显式参数或显式确认；侧命令不改业务代码，也不改 hook 判定语义。
- **不进 change 生命周期**：不写 `currentNode` / `completedNodes` / 节点证据，不替代任何节点产出。`evolve` 落 `last_evolve_at`、`context-scan` 落 `last_intel_scan`，两者都是**项目级元数据**，不是流程进展。
- **人工确认不可跳过**：`evolve` 的候选必须逐条 review 后才 `apply`，禁止一次性整批写入；`health` 只出报告与建议，是否立项由用户决定，它自己不开 change。
- **到期提示**：`node .claude/skills/flow-comet/scripts/workflow-state.mjs status` 在 `last_evolve_at` 距今 > 60 天，或该时刻之后新增 ≥ 5 个带 `§9` 的归档 change 时，输出一行 `EVOLVE-DUE:`（含上次沉淀时间与「建议显式调用 evolve」指引）；未达阈值**零输出**（从未跑过 evolve、无该字段的项目同样不提示）。提示只是提醒——不自动加载也不自动执行 `evolve`，是否同步由用户决定。
- **时间纪律（侧命令的产物与判断同一口径）**：人可见时间戳一律**本地时间 + 显式偏移**（`YYYY-MM-DDTHH:mm:ss±HH:mm`；生成走 `time-utils.mjs` 单一权威，禁裸 `new Date()` 拼接）；时间**比较一律 `Date.parse` 差值**（兼容历史 `Z` 形态，禁字符串字典序、禁目测字形）；**判活与判时以文件 mtime 或 git 时间为准，`date` 与代理注册表不作基准**（归档窗口另取归档目录名的日期前缀）。这三条已写入**验证阶梯**的「环境 / 过程纪律」条，侧命令的报告、基线与到期判定都按它执行。

## Workflow Nodes

| 节点 | Kind | 职责 | Output Schema |
|------|------|------|---------------|
| open | control | CHANGE 反问 + REQUIREMENT 需求 | flowkit.intake.v1 |
| design | control | 技术决策 + ADR | flowkit.design.v1 |
| plan | control | 拆原子任务 | flowkit.plan.v1 |
| execute | control | TDD 开发 + 自查（串行） | flowkit.execution.v1 |
| subagent-execute | handoff | [P] 并行任务委托 | flowkit.handoff.v1 |
| review | control | 4 轮审查 | flowkit.review.v1 |
| verify | control | 集成验证 + UAT | flowkit.verify.v1 |
| archive | control | 归档 + LESSONS | flowkit.archive.v1 |

> **并行任务路由（节点顺序是动态的 · 多趟语义）**：TASK 含依赖已满足的 `parallel="true" status="pending"` 任务时路由到 subagent-execute——每趟委托全部依赖已满足的并行任务；子代理返回后重新判定：仍有可并行 pending 就再次进入 subagent-execute（委托节点可多次往返），存在串行 pending 时回 execute 消化一趟再循环。委托节点的完成 = 不存在依赖已满足的可并行 pending 且无串行残留；并行/串行交错的混排序列合法，唯一前置拦截是依赖环（plan 出口校验并附恢复指引）。全部为串行任务时走 execute，行为不变。`next` 的输出始终是权威——以 `NODE:` 输出为准，不按静态顺序推断。

### 并行委派契约（四属性）· 三平台通道

并行委派的契约对象是**并行安全四属性**——worktree（隔离工作区）只是「① 写权限」的一种打包实现，**不是契约本身**，也不是并行委托的前提：

| 属性 | 含义（本节为口径单一来源） |
|------|---------------------------|
| ① 写权限 | 子代理写入目标的**放行依据**（含 gitignored 面）：身份在场 ⇒ 子代理语义放行；**最小保护集**（`.flow-comet/flow-comet-state.json`、`reference/workflow-protocol.json`）在身份在场时**仍拦** |
| ② 提交隔离 | 各写者只提交**自己的字面路径**（`git add -- <路径>` / `git commit -- <同一路径>`；多个写者共享同一工作区时禁裸 `add` / `commit -a` / `stash` / `clean` / `reset`） |
| ③ 验证隔离 | **同一时刻只有一个写者**（有 request 无对应 result 的在飞委托 ⇒ 不跑全量判据，待写入者收工后重跑） |
| ④ 集成纪律 | 协调者按确定性规则**显式、可审计**地集成（`merge --no-ff` 优先、冲突难解时降级 cherry-pick 并记因；机械冲突与语义冲突分别处置） |

**三平台通道（属性 × 平台）**——判级只取三态（**证实 / 推翻 / 未覆盖**）；**未覆盖 ≠ 已验证**，不得写成已支持：

| 属性 | Claude Code | Codex | dsh |
|------|-------------|-------|-----|
| ① 写权限 | 载荷 `agent_id` / `agent_type`——**证实**（真机实测：子代理载荷含二者、主会话载荷不含；与 Codex 同一判据） | 载荷 `agent_id` + `agent_type`——**证实**（实测：子代理载荷 12 键含二者、主线程 10 键不含）；守卫读 `agent_id`，与 CC 同一判据 | 桥接透传 `delegationDepth`——**证实**（0.1.7-rc.2 全接缝重认证；本批收窄为「最小保护集除外」） |
| ② 提交隔离 | pathspec 纪律（多写者共享同一工作区形态） | 同左 | 同左 |
| ③ 验证隔离 | `subagent-execute` 出口锚：有 request 无 result（新 change BLOCKED / 旧 change WARN 渐进） | 同左 | 同左 |
| ④ 集成纪律 | `merge --no-ff` 优先；降级 cherry-pick 必记因 | 同左 | 同左 |
| **谁建树**（三平台唯一差异） | 可选：harness `isolation: "worktree"` 建独立树，或共享工作区直写 | 协调者**显式** `git worktree add` 并在委派 prompt 指定 `workdir`（原生子代理无自动建树；**证实**：子代理可被指向独立目录并落盘），或共享工作区直写 | **不建树**：进程内子代理、同一工作区运行——**无需隔离区 ≠ 无需边界**（`write_files` 互斥 + 提交时点 + 最小保护集仍构成边界） |

**交互式 Codex 实测口径（口径以下文陈述为准；该次取证为**一次性工件**、已按仓库纪律清理——**分发产物不得把结论挂靠一次性路径**）**：交互式 Codex 会话触发 `PreToolUse`（启动有 hook 信任提示）· 原生子代理工具调用触发 · `spawn_agent` / `wait_agent` / `close_agent` 类调用各自触发 · 子代理可被指向独立 worktree · 全局 `~/.codex/hooks.json` 与项目级 hook **并存生效**（合并规则未覆盖）。

**已知边界（不得写成机械保证）**：① Codex 载荷 `cwd` = 会话根，**与实际工作目录无关**（实测证实）⇒ 路径判定在 Codex 上必错，故判定序为**身份先于路径**；② 身份判据是**声明式信任边界**——守卫读到的 `agent_id` 来自宿主载荷，本机制**不声称能证明**其真实来源；③ 该次实测结论只覆盖「Windows + 交互式 Codex TUI + 该版本」形态；CC 侧身份判据的真机实测条件同样是**限定形态**——**Windows + CC v2.1.177 + `permission_mode = bypassPermissions` + 一次性仓库载体**。`agent_type` 取值域、嵌套委派载荷、非 Windows 环境、非 `bypassPermissions` 权限模式**均未覆盖**（未覆盖 ≠ 已验证，不得写成已支持）。

**三平台 `cwd` 语义对照（真机实测新增的精确事实 · 「身份先于路径」的精确理由）**——同为载荷 `cwd`，三平台语义各不相同；下表**三行各自独立**，缺一行即口径残缺：

| 平台 | 载荷 `cwd` 的实际语义 | 对路径判定的影响 |
|------|----------------------|------------------|
| **Claude Code** | **子代理的工作目录**（`…\.claude\worktrees\<agent-id>`） | **路径判定是正确的** |
| **Codex** | **恒等于会话根**（子代理在 worktree 写入而 `cwd` 仍是主工程） | **路径判定必错** |
| **dsh** | 载荷**无** `cwd`（桥接另读会话 header cwd） | 路径判定**不适用** |

> ⇒ **不是「路径判定普遍不可靠」，而是三平台 `cwd` 语义各不相同（正确 / 恒错 / 无）——只有身份判据是三平台同义的**。该对照只解释**为什么必须身份优先**，**不构成**「可以改走路径判定」的依据：契约仍走**身份判据**（三条通道同义）。

**四属性的机制落点**：① 由守卫的身份短路 + 最小保护集承载（`comet-hook-guard.mjs`）· ② / ④ 见 `flow-comet-subagent-execute` 与 `flow-comet-execute` 两册的提交 / 集成纪律 · ③ 由 `subagent-execute` 出口校验承载。

## Skill Bindings

| 节点 | Implementation | Required Calls | Enforcement |
|------|---------------|----------------|-------------|
| open | flow-comet-open | flow-comet-change, flow-comet-requirement | guarded |
| design | flow-comet-design | flow-comet-design, flow-comet-ui-design (guarded，仅前端适用——前端须先 skill-load 声明) | guarded |
| plan | flow-comet-plan | flow-comet-task | guarded |
| execute | flow-comet-execute | flow-comet-dev | guarded |
| subagent-execute | flow-comet-subagent-execute | flow-comet-dev (handoff) | handoff-guarded |
| review | flow-comet-review | flow-comet-review, flow-comet-test | guarded |
| verify | flow-comet-verify | flow-comet-integration | guarded |
| archive | flow-comet-archive | flow-comet-integration | guarded |

**新 change 严格模式**：`init` 创建的 change 标记为"新"（`newChange: true`）——新 change 下全部内容级检查强制 BLOCKED（处置标记/缓存证据/波次散文/越权委托/SUMMARY 完整性/进入证据等）；旧 change（历史遗留,无标记）保持渐进 WARN。执行者可通过 `status` 确认当前 change 的新旧。

> **design 行绑定的前端适用性**：`flow-comet-ui-design` 与协议一致为 `guarded`，但只对**前端 change** 适用——前端项目须先用 Skill 工具加载该技能，再运行 `skill-load design flow-comet-ui-design --prompt flow-kit/prompts/2a-ui-design.md` 建标记，并在 record 载荷带 `required-skill:design.flow-comet-ui-design`（design 出口不再自动补写该条目，缺工件或缺声明即 BLOCKED 并给出恢复路径）；非前端项目不加载、不声明，出口打印可见的 `UI-DESIGN: skipped（非前端）` 后放行；旧 change 保持渐进，缺件仅 WARN。前端判据是**结构级**的：`CHANGE.md` 的「视觉调性」段在场，且段内的「不适用」标记成**结构形态**——该标记**独立行**、居**行首**（可带列表符号 / 引用 / 加粗），或写在适用性类标签（`适用性` / `适用范围` / `是否前端` / `视觉调性` / `前端` / `界面` / `适用`）的**字段值位**；标记之后须成**词形边界**（紧跟空白、标点或行尾），命中即回显**命中片段**自证。段内其它位置顺带提到「不适用」（如「不适用于暗色主题」）不算标注，仍判前端。

**节点技能两层加载模型（入口层 · 双步硬规则）**：路由到节点后，以下两步**都不可跳过**：

1. **用 Skill 工具加载该节点的 Implementation 技能**（见下方 Skill Bindings 表 Implementation 列，如 execute → flow-comet-execute）。**不得跳过**——只读取 SKILL.md 文件不叫加载；真正让该 skill 的指令生效的是 Skill 工具把它注入本次会话。
2. 随后按该节点 SKILL 的 Required Skill Calls，用 Skill 工具加载协议技能（与 Implementation 同名的条目已随路由加载，无需重复加载），加载完成后**立即**逐条运行声明命令（open/review 等涉及多个协议文件的节点，每个协议文件对应一条声明命令）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load <node> <skill> --prompt flow-kit/prompts/<阶段>.md
```

> **跑声明命令 ≠ 加载**：声明只把“哪次会话加载了哪个 skill、按哪份协议工作”写进状态供 exit/record 核对；真正加载只有第 1 步的 Skill 工具能做到。协议的引用示例：execute / subagent-execute 节点加载 flow-comet-dev 时用 `--prompt flow-kit/prompts/4-dev.md`（DEV 阶段协议），交付物按 `flow-kit/templates/SUMMARY.md` 模板填写并补写 `## 自检方法` 段。

节点退出（exit）与证据记录（record）会核对声明标记。声明如实记录执行者动作——加载了哪个 skill、按哪份协议工作——**不等于产出证明**；产出是否正确由产物结构校验与门禁把关。**技能加载前置门**：新 change 的 required 条目不再自动补写——handoff request / record 前必须已有本节点声明标记（先加载、再声明、后干活）；声明标记自动补写仅对旧 change 兜底（按协议 requiredSkillCalls 代记，标记带 `auto: true`），手动声明仍推荐（如实记录加载动作与协议文件）。

## Guardrails And Evidence

| 节点 | Guardrail | Validation | Description |
|------|-----------|-----------|-------------|
| open | intake-artifacts | artifact-exists | CHANGE.md + REQUIREMENT.md exist |
| design | design-artifacts | artifact-exists | DESIGN.md exists |
| plan | plan-artifacts | artifact-exists | TASK.md exists |
| execute | build-evidence | artifact-exists | At least one SUMMARY.md |
| subagent-execute | handoff-evidence | evidence-only | Handoff evidence recorded |
| review | review-evidence | artifact-exists | REVIEW.md exists |
| verify | verify-evidence | artifact-exists | TEST.md + UAT.md exist |
| archive | archive-evidence | state-transition | Archive completed |

## Runtime And Recovery

### Startup Protocol

1. Run `node .claude/skills/flow-comet/scripts/workflow-state.mjs status` to detect active change and current node.
2. If no active change and user wants to start new work: `node .claude/skills/flow-comet/scripts/workflow-state.mjs init <change-name>`. **init 自动检测项目上下文**：需要初始化时输出提示（同意重跑 `init <id> --init-context` 全量生成 CONTEXT.md / 拒绝 `--init-skip`）；CONTEXT.md 已存在且新鲜时完全静默——详见 `reference/init-detection.md`。项目本地分支规范非默认前缀时可用 `init <id> --branch-prefix <prefix>` 对齐（详见安装文档分支命名小节）。
3. **首次路由**: `init` 输出即首次路由（NODE: 内置 open 或协议首节点）——直接加载该节点 Skill 并执行（产出工件），一次只加载一个 Skill。`next` 在节点完成（`guard exit <node> --apply` 推进）后用于获取下一节点；init 后立即 `next` 会命中节点顺序门禁（open 未 exit → BLOCKED，符合节点顺序门禁语义）。

### Resume Rules (every context resume)

- **Re-detect from scratch**: on every context resume, re-run Startup Protocol. Do not trust conversation history.
- **Trust files over state**: if the script says a Node is DONE but its expected artifacts are missing, treat the Node as incomplete and re-enter it.
- **Drift handling**: if the user's request belongs to a different Node than the one returned by `next`, pause and confirm which Node to enter.

### Node Boundary Rules

- **节点顺序**:每个节点按 `entry <node>` → 产出工件 → `record <node>` → `exit <node> --apply` 执行(record 必须先于 exit——exit 校验 evidence 前置,缺证据会 BLOCKED)。
- Before leaving a Node, run `node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry <node>` then `exit <node> --apply` to advance state. **新 change 未 entry 直接 exit → BLOCKED**（旧 change WARN 渐进）——entry 的进入检查（协调者禁令/委托前检查/签名记录）不可跳过。
- If the guard fails, do not proceed past it — 先自动诊断并执行唯一安全修复（与 Decision Core 停止条件一致）；存在多个会改变范围/风险的合法恢复动作时，展示 guard 输出并询问用户。
- If the user wants to redo a completed Node, reset its completion state and re-enter rather than creating a parallel path.

### 受控重入（archive 源）

归档后发现缺陷、且归档移动尚未发生时，用受控重入把工作归属退回 `execute` / `subagent-execute` / `review` / `verify` 之一：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs reenter <target> --authorized-by <source> --reason <text> [--continue-round <n>]
```

- **何时用**：`currentNode` 停在 `archive`、`.specs/<change-id>/` 仍在原位（归档移动尚未发生）、`status !== 'completed'`，且存在必须回到既有生命周期才能完成的修复。
- **授权**：每次调用都需要用户显式授权——命令面 `--authorized-by` 记录授权来源、`--reason` 说明原因（原因随审计记录一并落盘）；引擎把授权留痕写入目标节点的嵌套证据（`state.evidence.<target>.reentryAuthorization`），缺授权或形态不合法一律 BLOCKED 且 state 字节零改写，授权不可由执行者自决（授权是声明式信任边界：`state` 只走脚本通道留痕，hook 拦工具不拦脚本，引擎按声明处理）。
- **上限与显式续轮**：每 change 最多 3 轮；第 4 次 BLOCKED 并给出「继续 / 停止」人工裁决指引。人工裁决「继续」须追加 `--continue-round <n>`（正整数，且 n ≥ 已用轮次 + 1）作显式续轮授权：满足则放行并计入下一轮、审计行打印 `第 n 轮（显式授权续轮，上限 3）`；未到上限即传该参数、或轮次不足一律 BLOCKED 且零改写。轮次与审计事件记入 `state.history`（事件类型 `reentry-applied`，含 `reason`；续轮时附 `continuationAuthorized: true`），成功输出 `REENTRY: archive → <target>（授权源 <source>；第 n/3 轮；备份 <file>）` 与 `REASON: <text>` 两行。
- **备份**：转移前自动落 state 快照 `.specs/<change-id>/.reentry-backups/<UTC ISO>-pre-<target>.json`（时间戳中的 `:` 替换为 `-`），并记录 sha256 指纹，供审查核验与手工回滚。
- **顺序**：命令成功后再写修复内容——archive 阶段写入白名单只放行 `.specs/<change-id>/KNOWN-ISSUES.md` 等少数路径；重入后写入权限跟随目标节点，此时才追加 Fix 任务 / 修改工件。
- **边界**：归档移动已发生或 change 已 `completed` → BLOCKED，走人工处置或新 change / hotfix；重复调用同一目标 → 空操作（输出 `REENTRY: 空操作——…`，不备份、不计数、不改写 state），不会静默跳过。

### 受控重校（`replan` · execute 源）

计划在执行中被证明有缺陷、任务集因此需要修订时，用受控重校重新校验并重签任务集——不跳节点、不重置任何完成态：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs replan "<reason>" --authorized-by <source> [--continue-round <n>]
```

- **何时用**：`currentNode` 停在 `execute` / `subagent-execute`，且任务集在进入该节点后被修订、出口因此报「签名不匹配」时；修订后的任务集必须自身合法。
- **授权**：每次调用都需要用户显式授权——`--authorized-by` 记录授权来源，位置参数记录原因；引擎把授权留痕写入当前节点的嵌套证据（`state.evidence.<node>.replanAuthorization`）。缺授权、值为空/纯空白或形态非法一律 BLOCKED，且 state 字节零改写。
- **上限与显式续轮**：每 change 最多 3 轮；第 4 次 BLOCKED 并给出「继续 / 停止」人工裁决指引。人工裁决「继续」须追加 `--continue-round <n>`（正整数，且 n ≥ 已用轮次 + 1）作显式续轮授权：满足则放行并计入下一轮，审计行打印续轮标记；未到上限即传该参数、或轮次不足一律 BLOCKED 且零改写。轮次与审计事件记入 `state.history`（事件类型 `replan-applied`），成功输出 `REPLAN: <node> 重新校验通过（授权源 <source>；第 n/3 轮；备份 <file>）` 与 `REASON: <text>` 两行。
- **备份**：改写前自动落 state 快照 `.specs/<change-id>/replan-backups/<UTC ISO>-pre-replan.json`（时间戳中的 `:` 替换为 `-`），并记录 sha256 指纹，供审查核验与手工回滚。
- **幂等与零改写**：目标形态已成立时的重复同形态调用 = 空操作（输出 `REPLAN: 空操作——…`，不备份、不计数、不写事件、不改写 state），不会静默跳过。
- **绝不豁免校验**：`replan` 只做「重新校验 + 重新签名」——判据与 plan 出口同源，处置按路径分列：**replan 重校**——任务块 / 每任务 `<verify>` / 任务图（依赖环 / 缺失依赖）任一不成立，或并行写冲突的写写（write∩write）成立，一律 BLOCKED（状态零改写）；读写（read∩write）仅 WARN 不阻断；7 字段完整性只在「新模板形态（含 `<name>`）+ 新 change」缺字段时 BLOCKED，其余情形 WARN 渐进。**plan 出口**——任务块 / 每任务 `<verify>` 缺失一律 BLOCKED；任务图的依赖环 / 缺失依赖与并行写冲突的写写，对新 change BLOCKED、旧 change WARN 渐进；读写对新旧 change 均仅 WARN。它不是绕过签名门禁，而是把「签名不匹配」重新收敛为「匹配」。

### Evidence Recording

After completing a Node:
```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record <node-id> '{"summary":"完成摘要"}'
```

### Artifact Paths

All artifacts in `.specs/<change-id>/`. Cross-change files in `.specs/` (CONTEXT.md, LESSONS.md, CHANGELOG.md).

> **模板权威**：工件段形以 `flow-kit/templates/**` 为唯一权威。
> **archive 定位与读法**：`.specs/archive/**` 是历史证据。**何时可读**：工作区文档明确要求（如断点续传 / 决策追溯），或某 guard 硬校验的约定在模板与 LESSONS 中查不到时；**读什么**：只取结构与证据；**不读什么**：不作为格式规范或决策依据，不得以归档工件对齐段形。

### Scripts

> **命令路径的平台化**：本文件命令统一为**权威源设计形态** `node .claude/skills/flow-comet/scripts/...`。安装时由 prepare-env 按平台处理——Claude Code 平台零替换（即此形态）；Codex 平台自动替换为 `node .agents/skills/flow-comet/scripts/...`（技能安装于 `.agents/skills/`，Codex 自动发现）。相对引用（`reference/`、`flow-kit/`）不替换——随技能目录整体复制，相对位置不变。手动复制（方案 C）仅面向 Claude Code；Codex 请用安装器。

| 脚本 | 用途 |
|------|------|
| `workflow-state.mjs` | 状态管理：init/status/next/select/record/advance/skill-load/execution-mode/config/verify-fail（verify 失败计数，第 4 次 BLOCKED）/reenter（archive 源受控重入）/replan（execute 源计划重校重签） |
| `workflow-state.mjs reenter` | 归档后受控重入：`reenter <target> --authorized-by <source> --reason <text> [--continue-round <n>]` 把工作归属退回 execute / subagent-execute / review / verify 之一（仅 archive 源、归档移动前、每次显式用户授权、每 change 上限 3 轮，超限继续需显式续轮授权） |
| `workflow-state.mjs replan` | 计划重校重签：`replan <reason> --authorized-by <source> [--continue-round <n>]` 在 execute / subagent-execute 相位重跑任务图与字段校验并重录任务集签名（仅这两个相位、每次显式授权、每 change 上限 3 轮、超限继续需显式续轮、缺授权或形态非法一律 BLOCKED 且零改写；写盘前落备份；重复同形态为空操作；只重校重签、绝不豁免校验） |
| `workflow-guard.mjs` | 节点门禁：entry/exit/verify 检查 |
| `workflow-handoff.mjs` | 子代理交接：request/result/status |
| `comet-plan.mjs` | 兼容别名入口（内容为 workflow-state 的别名壳） |
| `comet-check.mjs` | workflow contract 检查 |
| `comet-hook-guard.mjs` | 文件写入边界守卫（**身份判据先于路径判据**：载荷 `agent_id` / 桥接透传的 `delegationDepth` 在场 ⇒ 子代理语义放行；最小保护集 `.flow-comet/flow-comet-state.json` 与 `reference/workflow-protocol.json` 在身份在场时**仍拦**；无身份走 phase 白名单——subagent-execute 阶段只允许 .specs/，`.claude/worktrees/**` 前缀保留为兼容路径；`Write`/`Edit` 与 `Bash` 写命令两条判定路径同语义，runRoot 外一致拦截） |

### 机器拥有字段

以下字段只能由 `workflow-state.mjs` 和 `workflow-guard.mjs` 脚本管理，不应被手动编辑：

| 字段 | 说明 | 管理者 |
|------|------|--------|
| `currentNode` | 当前活动节点 | workflow-state.mjs next/advance/reenter |
| `completedNodes` | 已完成节点列表 | workflow-guard.mjs exit --apply / workflow-state.mjs reenter |
| `evidence` | 节点证据记录 | workflow-state.mjs record |
| `verifyFailures` | verify 失败计数 | workflow-guard.mjs (auto-increment) |
| `verifyFailuresByChange` | 按 change 隔离的失败计数（keyed by change-id） | workflow-state.mjs / state-schema.mjs helper |
| `status` | 运行状态 | workflow-guard.mjs exit --apply |
| `executionMode` | subagent/direct，execute 执行模式 | workflow-state.mjs execution-mode |
| `directOverride` | direct 是否用户显式确认 | workflow-state.mjs execution-mode direct |

手动修改这些字段可能导致 guard 校验不一致。若需修正状态，使用 `workflow-state.mjs advance` 或 `workflow-state.mjs select`。

`workflow-state.mjs reenter` 是 `currentNode` / `completedNodes` / `status` 的受控脚本写入点：它先落备份、写授权留痕与审计事件，再转移工作归属；除该命令与上述脚本外，不要用其他方式改这些字段。

The route, Output Schemas, required Skill calls, and recovery state are defined by `reference/workflow-protocol.json`.
- Resolved source Skill evidence and composition provenance: `reference/resolved-skills.json`.
