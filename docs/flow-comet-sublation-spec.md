# flow-comet 扬弃规格：基于 Comet × flow-kit × flow-comet 三层深度对比

- **日期**: 2026-08-03
- **状态**: 草案
- **定位**: 架构级改进规格。先确立原则（每个 Comet 原则怎么扬弃），再映射到具体改动。
- **前身**: `docs/flow-comet-improvement-spec.md`（W1-W3 波次计划，是本规格的实现层）。

---

## 一、扬弃框架：Comet 七原则 × flow-comet 处置

Comet 的设计哲学可提炼为七条原则。对每条原则，明确三个决策：

| 原则 | 吸收什么 | 形式 | 边界（不吸收什么） |
|------|---------|------|-------------------|
| ① 状态即文件 | 保留当前单文件状态机 | `.comet/flow-comet-state.json` | 不做双投影（ClassicState + RunState）、不做 trajectory 事件溯源 |
| ② 证据驱动推进 | **补齐所有节点的 exit 校验** | guard 脚本 | 不做内容语义校验（太重），保持"结构+存在"级别 |
| ③ 哈希绑定 | TASK.md 快照哈希 + handoff hash | 脚本 | 不做 checkpoint hash 链（Comet 独有复杂度） |
| ④ 失败封闭 + 白名单 | **实现 phase 级写入控制** | hook guard | 不做 Comet 的 Superpowers 槽位归属算法 |
| ⑤ 机器字段不可伪造 | **标记 state 中的机器字段** | SKILL.md 约束 + guard 校验 | 不做 Comet 的 `set` 命令拦截（脚本层面防不住 LLM 改文件） |
| ⑥ 人机分工 | 已实现四分类（W2-C） | SKILL.md | 不做 Comet 的 intent/resume-probe 启发式路由 |
| ⑦ 恢复协议 | 增强 determineNode + dirty-worktree | 脚本 + 参考文档 | 不做 pending-action journal（determineNode 已够用） |

---

## 二、原则 ①：状态即文件

### Comet 原则
`.comet.yaml` + `run-state.json` + `trajectory.jsonl` + `checkpoint.json`。双投影（人可读 YAML ↔ 机器 JSON）+ 事件溯源（每次迁移写 trajectory 事件 + hash 绑定的 checkpoint）。

### flow-comet 现状
单文件 `.comet/flow-comet-state.json`，由 `workflow-state.mjs` 读写。`determineNode` 从文件（.specs/ 产物）重新推导节点，不完全信任 state。

### 扬弃决策：**保留现状 + 补强**

**吸收**：
- 保留单文件状态机（比双投影简单，够用）
- 保留"文件即真相"原则（determineNode 从 .specs/ 推导，state 只是加速器）

**补强**：
- `init` 时写入 `createdAt` + `history` 数组（当前已做）
- state 中新增 `lastTransition: {from, to, at}` 字段（轻量版事件日志，只保留最近一次）

**不吸收**：
- ❌ 双投影（ClassicState YAML ↔ RunState JSON）—— flow-comet 只有 .specs/ 产物 + 单一 state，无"人可读状态"的需求
- ❌ trajectory.jsonl 事件溯源—— 对当前规模过度工程；history 数组已记录关键事件
- ❌ checkpoint hash 链—— 依赖事件溯源才有意义

---

## 三、原则 ②：证据驱动推进 ← 最大差距

### Comet 原则
阶段推进不靠"我说做完了"，而是靠 `collectClassicEvidence` 检查真实工件：proposal/design/tasks 存在且非空、语言匹配、handoff hash 一致、tasks 全勾、verification_report 存在。

### flow-comet 现状
**三层校验不匹配**（子代理发现 + 我验证确认）：

| 校验层 | 覆盖范围 | 来源 |
|--------|---------|------|
| `workflow-guard.mjs` 脚本实现 | execute/subagent-execute/verify 出口强校验（W1-A~D）；其余节点只查文件存在 | 脚本 |
| `workflow-protocol.json` kernel 定义 | 每节点 1 条主 guardrail（artifact-exists/evidence-only/state-transition） | 配置 |
| SKILL.md rich 版 | 每节点 2-4 条扩展 guardrail（all-tasks-done/no-design-changes/critical-resolved 等） | 文档 |

**问题**：open/design/plan/review 节点的 exit 几乎只做文件存在检查。SKILL.md 声称的扩展 guardrail 在脚本中零实现。

### 扬弃决策：**按节点分级补齐 exit 校验**

不做 Comet 的"内容语义校验"（如"语言匹配""proposal 至少 3 段"），而是做**结构+存在**级别的校验——比当前"文件存在"强，比 Comet 的"内容解析"轻。

| 节点 | 当前校验 | 补强 | 理由 |
|------|---------|------|------|
| **open** | CHANGE.md + REQUIREMENT.md 存在 | + REQUIREMENT.md 含 `## 验收标准` 段（正则） | 空 REQUIREMENT 不能进 design |
| **design** | DESIGN.md 存在 | + DESIGN.md 含 `## 0\.` 或 `## 0\.5` 段（技术栈/架构对齐） | DESIGN.md §0/§0.5 是下游所有节点的输入 |
| **plan** | TASK.md 存在 | + TASK.md 含 ≥1 个 `<task` 块 + 每个 `<task>` 含 `verify` 字段 | 空 TASK 或缺 verify 字段不能进 execute |
| **execute** | SUMMARY 存在 + 三段校验 | + **TASK.md 所有 `<task>` 块 `status="done"`** | 已发现的 G-6 缺陷 |
| **review** | REVIEW.md 存在 | + REVIEW.md 含 `## Critical` 或 `## 发现` 段 | 空 REVIEW 不能进 verify |
| **verify** | TEST.md + UAT.md 存在 + 真实跑命令 | 保持现状（已最强） | — |
| **archive** | archive 目录存在 | 保持现状（需用户确认） | — |

**不吸收**：
- ❌ Comet 的内容语义校验（语言匹配、proposal 段数、handoff markdown 可溯源标记）—— 过重
- ❌ Comet 的 build 命令真实执行 + 300s 超时（已在 verify 做了真实执行，build 阶段用 TDD verify 代替）

---

## 四、原则 ③：哈希绑定

### Comet 原则
`handoff_hash`（全源文件 sha256）、`context_hash`、`artifacts_hash`、checkpoint hash。所有跨阶段交接带哈希校验。"模型'记得做过'不如'哈希对得上'"。

### flow-comet 现状
- handoff hash：子代理回传 `commitHash`（W1-D），guard 用 `git show` 校验提交文件 ⊆ writeFiles（W2-D）
- 无 TASK.md 快照哈希（execute 中途修改 TASK.md 不被检测）

### 扬弃决策：**补 TASK.md 快照哈希**

**吸收**：
- enter execute 时对 TASK.md 计算 sha256，存入 state.taskHash
- exit execute 时重新计算，比对一致（TASK.md 在 execute 中途被修改 → BLOCKED）
- 理由：execute 是唯一一个"长时间运行 + 多任务串行"的节点，中途修改 TASK 会导致任务集漂移

**不吸收**：
- ❌ checkpoint hash 链（trajectory 事件级）—— 过度工程
- ❌ context_hash（CONTEXT.md 哈希）—— CONTEXT.md 在 change 内允许更新
- ❌ artifacts_hash（全部产物哈希）—— determineNode 已通过文件存在性隐式校验

---

## 五、原则 ④：失败封闭 + 白名单 ← 第二大差距

### Comet 原则
Hook guard 按 phase 精确控制文件写入权限：
- **open/design**：只允许 proposal/design/tasks/state/handoff/specs
- **build**：允许源码 + tasks/specs/state
- **verify**：只允许 tasks/state
- **archive**：只允许 state

对"无法判定目标"一律 BLOCKED（fail closed），绝不猜测放行。

### flow-comet 现状
`comet-hook-guard.mjs`（1644 行）只做路径安全检查（防 symlink 逃逸 + realpath 校验），**无 phase 级写入白名单**。意味着：
- open 阶段的 agent 可以直接改源码
- review 阶段的 agent 可以直接改源码
- 没有任何实时机制阻止跨阶段写入

### 扬弃决策：**实现轻量级 phase 写入白名单**

在 `comet-hook-guard.mjs` 的 `main()` 函数中，基于当前 `currentNode` 实施写入控制：

| 当前节点 | 允许写入 | 禁止写入 |
|---------|---------|---------|
| **open** | `.specs/<change>/*`, `.specs/CONTEXT.md`, `.specs/LESSONS.md` | `*.py`, `*.ts`, `*.tsx`, `*.js` 等源码 |
| **design** | 同 open + `.specs/adr/*` | 源码 |
| **plan** | `.specs/<change>/TASK.md` | 源码、REQUIREMENT.md、DESIGN.md |
| **execute** | 源码 + `.specs/<change>/*-SUMMARY.md` + `.specs/<change>/TASK.md`（标 done） | REQUIREMENT.md、DESIGN.md |
| **subagent-execute** | 同 execute | REQUIREMENT.md、DESIGN.md |
| **review** | `.specs/<change>/REVIEW.md` | 源码、REQUIREMENT.md、DESIGN.md、TASK.md |
| **verify** | `.specs/<change>/UAT.md`, `.specs/<change>/TEST.md`, `.specs/LESSONS.md` | 源码 |
| **archive** | `.specs/archive/*`, `.specs/CHANGELOG.md`, `.specs/LESSONS.md` | 源码、当前 change 产物 |

**实现形式**：在 hook-guard 中读 `.comet/flow-comet-state.json` 获取 `currentNode`，查白名单表，对写入目标路径做 `startsWith` 匹配。路径不匹配 → BLOCKED + 输出诊断信息。

**边界（不吸收）**：
- ❌ Comet 的 Superpowers 三槽归属算法（recorded 路径 > 命名匹配 > 首个合法槽）—— flow-comet 不用 Superpowers
- ❌ Comet 的 overlay 分支 hook（classic-hook-guard 与 native-hook-guard 双轨）—— flow-comet 只有一条 workflow-kernel 路径
- ❌ Comet 的多 change 共存时 selection 校验 —— flow-comet 一次只允许一个 active change

**关键约束**：此改动需要同步修改 hook guard 脚本和 guard 脚本——hook guard 负责实时拦截，guard 负责 exit 校验。两者共享白名单定义（避免重复维护）。

---

## 六、原则 ⑤：机器字段不可伪造

### Comet 原则
`archive_confirmation`、`verify_failures`、`classic_profile` 等字段只能由状态机 transition 更新，`set` 命令直接拒绝。`phase` 也不能手动 set（除非 `COMET_FORCE_PHASE=1` 修复逃生口）。

### flow-comet 现状
state.json 全字段可被 LLM 直接编辑（Write 工具）。`currentNode` 和 `completedNodes` 理论上只能由 `workflow-state.mjs advance` 更新，但 LLM 可以直接改文件。

### 扬弃决策：**标记 + 校验，不阻断**

**吸收**：
- 在 SKILL.md 中显式声明"机器拥有字段"清单：`currentNode`、`completedNodes`、`evidence`、`verifyFailures`、`status`
- 在 `workflow-state.mjs status` 输出中新增校验：若 `currentNode` 与 `determineNode` 推导结果不一致，打印 WARNING（已做自动纠偏）
- 在 `workflow-guard.mjs entry` 中校验：若 state 的 `currentNode` 与 determineNode 不一致 → 自动写回纠偏（已做 P0-2）

**不吸收**：
- ❌ Comet 的 `set` 命令拦截（Comet 能做到是因为它有命令层；flow-comet 只有脚本，LLM 可以直接用 Write 工具改文件）
- ❌ 文件锁定/只读权限 —— 在 agent 环境中无法真正阻止 LLM 写文件

**现实约束**：在 agent 环境中，"机器字段不可伪造"只能靠**检测+纠偏**，不能靠**拦截**。当前的 determineNode + 自动纠偏机制已是最优解。

---

## 七、原则 ⑥：人机分工

### Comet 原则
决策点四分类（用户决策/自动处理/停止条件/手动交接），只有真有两难时必须停。红旗清单防止 agent 自欺。

### flow-comet 现状
已实现四分类（W2-C，SKILL.md 决策分类与决策点表）。红旗清单隐含在 flow-kit 的各阶段 prompt 中（4-dev.md 的 Red Flags 等）。

### 扬弃决策：**保持现状，小幅增强**

**补强**：
- 在 flow-comet/SKILL.md 的决策点清单中，增加**归档确认**为用户决策点（不可逆操作，必须停）
- 统一 verify 重试的表述（当前"≤3 次"和"第 4 次"混用 → 统一为"3 次自动重试，第 4 次暂停"）

**不吸收**：
- ❌ Comet 的 IntentFrame + resume-probe 启发式路由（中英文词表 + token 匹配 → 误判 → 不必要打扰）—— flow-comet 用 determineNode 从文件推导更可靠
- ❌ Comet 的联合决策点（build 阶段一次收集 5 项配置）—— flow-comet 的 build 分散在 plan + execute 两阶段，无此需求

---

## 八、原则 ⑦：恢复协议

### Comet 原则
`context-recovery.md`：任意入口恢复都不依赖对话历史，先跑 `comet state check --recover` 取结构化恢复上下文。build 阶段特殊恢复（读 `.comet/subagent-progress.md` 检查点）。resume-probe 探针只读仓库状态。

### flow-comet 现状
- `determineNode` 从 .specs/ 文件推导节点（文件即真相）—— 已覆盖核心恢复需求
- `workflow-state.mjs next` 的 P0-2 自动纠偏 —— state 与文件不一致时自动校正
- dirty-worktree 归属协议（W2-B，reference/dirty-worktree.md）

### 扬弃决策：**保持现状 + 补两个场景**

**补强**：
- **execute 中途恢复**：当前 determineNode 看到 TASK.md 有 `status="done"` + `status="pending"` → 路由到 execute → execute 从头遍历 → 已 done 的任务被跳过。这是正确的行为。但 **PROGRESS.md 已排除方案** 的检查只在 SKILL.md 中作为文字规则存在，guard 脚本不校验。补一条：execute entry 时若 `.specs/<change>/PROGRESS.md` 存在 → WARNING（提示 agent 读取排除方案）。
- **subagent-execute 中途恢复**：当前 determineNode 看到有 pending parallel → 路由到 subagent-execute → 但已完成的 handoff result 可能部分丢失（context 压缩后）。补一条：subagent-execute entry 时读已有的 `handoffResult`，只委托未完成的任务。

**不吸收**：
- ❌ pending-action journal（Comet 的崩溃恢复机制）—— flow-comet 的 determineNode + state 自动纠偏已覆盖
- ❌ resume-probe 启发式探针 —— 不需要猜测用户意图
- ❌ subagent-progress.md 检查点（Comet 的 build 阶段详细进度）—— flow-comet 用 TASK.md status 字段作为检查点，粒度更粗但够用

---

## 九、新增：原则 ⑧ — SKILL 文件结构治理

### 问题
每个 flow-comet 节点 SKILL.md 是两份版本拼接（rich 手写版 + kernel 生成版），路径不同、语义微妙漂移。这是 bundle 创作流程的副产品（Authored 区 + Auto 区），但对维护者和 LLM 都造成混淆。

### 扬弃决策

**方案**：分离为两个文件
- `<node>-SKILL.md`（Auto 区）：由 comet bundle 自动生成，包含 frontmatter、路由表、Entry/Exit Check、Recovery、Output Schema
- `<node>-GUIDANCE.md`（Authored 区）：手写的详细步骤、Red Flags、扩展 guardrail、flow-kit 协议引用

SKILL.md（Auto 区）的 Guidance 段改为 `<!-- see <node>-GUIDANCE.md -->` 引用。

**边界**：
- 不改 workflow-protocol.json（避免 hash 失效）
- 不改 bundle 创作流程本身（Auto 区照常生成）
- 新结构向后兼容（LLM 仍读 SKILL.md，需要详细步骤时读 GUIDANCE.md）

---

## 十、从原则到改动映射

| 原则 | 改动项 | 涉及文件 | 优先级 |
|------|--------|---------|--------|
| ② 证据驱动 | open exit: REQUIREMENT 含 AC 段 | workflow-guard.mjs | P0 |
| ② 证据驱动 | design exit: DESIGN 含 §0 段 | workflow-guard.mjs | P0 |
| ② 证据驱动 | plan exit: TASK 含 task 块 + verify 字段 | workflow-guard.mjs | P0 |
| ② 证据驱动 | execute exit: **TASK.md 所有 task done**（G-6） | workflow-guard.mjs | P0 |
| ② 证据驱动 | review exit: REVIEW 含发现段 | workflow-guard.mjs | P1 |
| ② 证据驱动 | verify-fail 自动递增（G-2） | workflow-guard.mjs | P0 |
| ② 证据驱动 | verify 命令支持多行（M-5） | workflow-guard.mjs | P1 |
| ③ 哈希绑定 | TASK.md 快照哈希（enter/exit execute 比对） | workflow-guard.mjs + workflow-state.mjs | P1 |
| ④ 白名单 | phase 级写入控制 | comet-hook-guard.mjs | **P1**（结构性差距，但不影响正确性） |
| ⑤ 机器字段 | 状态字段声明 + WARNING | flow-comet/SKILL.md + workflow-state.mjs | P2 |
| ⑥ 人机分工 | verify 重试表述统一 | flow-comet/SKILL.md + flow-comet-verify/SKILL.md | P2 |
| ⑦ 恢复协议 | execute entry: PROGRESS.md WARNING | flow-comet-execute/SKILL.md | P2 |
| ⑦ 恢复协议 | subagent-execute: 跳过已完成 handoff | flow-comet-subagent-execute/SKILL.md | P2 |
| ⑧ SKILL 结构 | 分离 Auto/Authored 区 | 所有节点 SKILL.md | P2 |
| — | execute SKILL: 明确"只处理非 parallel 任务"（G-7 边界修正） | flow-comet-execute/SKILL.md | P0 |
| — | handoff 从 TASK.md 自动解析 write_files（G-4） | workflow-handoff.mjs + flow-comet-subagent-execute/SKILL.md | P1 |
| — | Return Contract 补齐 redEvidence 校验（G-3，渐进策略） | workflow-guard.mjs（当前只 WARN 不 BLOCK） | P2 |
| — | 清理 NODE_TRANSITION_GATES.artifacts 死数据（G-1） | workflow-guard.mjs | P2 |

### 与原 improvement-spec（W1-W3）的关系

原 spec 的 W1-W3 波次是本规格的**已实现子集**。本规格新增的改动项（以 ②④ 为主）是原 spec 未覆盖的结构性差距。执行时以本规格为准，原 spec 中已实现的部分直接复用。

---

## 十一、执行策略

**不做单次大改**，按依赖关系分批执行：

**批次 A（P0，本次执行）**：
- execute exit: all-tasks-done 校验
- verify-fail 自动递增
- execute SKILL 明确"只处理非 parallel"
- open/design/plan exit 补内容段校验

**批次 B（P1，批次 A 完成后）**：
- phase 级写入控制（hook guard）
- TASK.md 快照哈希
- verify 命令多行支持
- handoff write_files 自动解析
- review exit 补内容段校验

**批次 C（P2，长期）**：
- SKILL 文件结构分离
- Return Contract 完整校验
- 机器字段声明
- 恢复协议补强
- 死代码清理

每批次完成后：三处同步 + 语法检查 + 现有功能回归 + 收尾 eval/distribute。
