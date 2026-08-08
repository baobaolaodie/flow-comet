<div align="right">

[English](ECOSYSTEM.md) · [中文](ECOSYSTEM-zh.md)

</div>

# 生态：flow-kit 与 Comet——作用、借鉴与边界

flow-comet 站在两个上游项目之上：**flow-kit** 提供方法论与工件体系；**Comet** 提供 flow-comet 大量借鉴的机制范式。本文档详述 flow-comet 依赖什么、借鉴什么、明确不吸收什么。

## 1. flow-kit——方法论层（依赖）

flow-kit 是**纯 markdown 方法论包**（不是工具——"clone 到项目根目录就用，没有运行时"）。它定义了 9 阶段流程、R1-R8 行为规则与 14 个工件模板。

### flow-comet 依赖了什么

| flow-kit | flow-comet 的用法 |
|----------|------------------|
| **阶段协议**（prompts/0-change、1-requirement、3-task、4-dev、5-test、7-integration、2a-ui-design） | 8 节点一一对应；节点 skill 自述「flow-kit \<阶段\> 阶段协议」，执行时读取 flow-kit prompt 文件 |
| **工件模板**（CHANGE/REQUIREMENT/DESIGN/TASK/SUMMARY/TEST/REVIEW/UAT/LESSONS/CONTEXT/…） | 工件路径与必填段完全遵循模板 |
| **R1-R8 行为规则**（fresh-context、工件门禁、反幻觉 grep、破坏性变更协议、测试纪律） | flow-comet skill 中按编号逐条引用（R1.8、R4.5、R4.6、R5.1、R6.4、R6.5…） |
| **Artifact Preflight Gate**（GO.md / R2.7） | 移植为节点产物门禁表（design 需 CHANGE+REQUIREMENT、plan 需 DESIGN、…） |
| **LESSONS 知识库**（L-NNN 条目、R1.8 扫描） | 沿用相同格式与提名规则 |

### flow-comet 在之上加了什么

- **状态机**：脚本（workflow-state/guard/handoff）拥有状态、路由与推进——flow-kit 的手工纪律变成机器校验
- **机器拥有字段**：currentNode/completedNodes/evidence/verifyFailures 脚本独占；手动编辑导致 guard 校验不一致
- **确定性恢复**：「文件优先于状态」——每次恢复从工件重新推导，不信任对话历史
- **决策分类**：flow-kit 分散的人工确认点收敛为四分类决策体系（用户决策/自动处理/停止条件/手动交接）
- **Output Schema**：每节点绑定 `flowkit.*.v1` 契约于 `reference/workflow-protocol.json`

### flow-comet 明确不吸收

- **PROGRESS.md / STATE.md 文件**：其语义（清窗快照、跨会话状态）被状态机替代——flow-comet-dev 明确「TASK.md 的 status + SUMMARY.md 就是进度」
- **横向命令**：仅 evolve/health 以独立 skill 存在；intel-scan/architect 类命令未移植
- **多 IDE 适配层**（`.windsurfrules`/`.cursorrules` 安装路径）
- **Token 预算表**（flow-kit 的成本模型未继承）

## 2. Comet——机制来源（大量借鉴）

Comet 是**可恢复的长期任务工作流与 Skill 平台**（Node-only 运行时；Native + Classic 双工作流；Skill Creator 带 eval 与跨平台发布）。flow-comet 运行时**不依赖** Comet——但**机制范式大量借鉴自 Comet 的 Skill Creator**，方式是「吸收产物形态，丢弃平台」。

### flow-comet 从 Comet 借鉴了什么（机制 → flow-comet 对应）

| # | Comet 机制 | flow-comet 对应 |
|---|---|---|
| 1 | **workflow-protocol.json 作为唯一运行时事实源**（schemaVersion/kind/nodes/edges/outputSchemas/state/evals） | `reference/workflow-protocol.json`——**逐字段同构**：kind `workflow-kernel`、8 节点、`flowkit.*.v1` 产物 schema、state 含 statePath/currentNodeField/completedNodesField/evidenceField |
| 2 | **Workflow Node 模型**（kind control/producer/action/handoff/guardrail + responsibility + requiredSkillCalls + outputSchemas + guardrails） | 节点字段完全一致；`subagent-execute` 为 handoff kind；保护边界保留（open/execute/review/verify/archive 仅 require/augment 不可 override；design/plan 允许 override） |
| 3 | **Skill Binding + 强制级别**（guarded/handoff-guarded/evidence-only/advisory） | SKILL.md「Skill Bindings」表同构 |
| 4 | **三契约脚本 + 三工厂脚本**（workflow-state/guard/handoff + comet-plan/check/hook-guard） | `scripts/` 同名六脚本齐全；另抽出 `protocol-utils.mjs`（协议解析，借鉴 Comet guard 风格）与 `state-schema.mjs` |
| 5 | **determineNode / 产物推导节点检测** | `workflow-state.mjs` 从协议 outputSchemas artifacts 推导完成标志（`<change-id>` 占位、仅 required） |
| 6 | **guard --apply 推进 + NEXT: 协议**（`NEXT: auto\|manual\|done` + `SKILL:`） | `workflow-guard.mjs entry/exit <node> --apply`；`workflow-state.mjs next` 输出 `NEXT:` + `SKILL:` 路由；init 输出即首路由 |
| 7 | **Hook 白名单 / fail-closed / 受保护路径**（before_tool + before_write 描述符、failure: block、symlink/junction 检测、TOCTOU 快照） | `comet-hook-guard.mjs`——同款 guard 风格；白名单经协议 `writeWhitelist` 声明化（缺省表回退）；execute 按 executionMode 动态收窄（subagent/direct） |
| 8 | **Entry Skill 双区结构**（确定性 Auto 区：路由表/Skill Bindings/Guardrails/Recovery + Authored 区：Decision Core 四必填节） | SKILL.md 同构；Decision Core 含相同四节（自动节点检测/决策分类/停止条件/Red Flags） |
| 9 | **Handoff 证据协议**（handoff kind 节点 + 子代理证据回传） | `workflow-handoff.mjs request/result/status`（writeFiles 白名单、JSON Return Contract、completedChecks 校验、commitHash 子集检查） |
| 10 | **eval.yaml manifest**（comet.eval/v1alpha1 + qualityGates + routeConformance） | `comet/eval.yaml` 同构；`checks.yaml`（state_equals）、`skill.yaml`、`guardrails.yaml` 齐备 |
| 11 | **bundle.yaml / resolved-skills.json / composition-report** | 同构包结构（apiVersion comet/v1alpha1、SkillBundle、resources、platforms.requires） |
| 12 | **多 change 选择语义**（零/一/多候选 → 暂停） | `findActiveChange`（state 优先 → `.specs/` 扫描；completed 优先防归档残留） |

### flow-comet 明确不吸收

- **双投影状态**（`.comet.yaml` 用户字段 + `run-state.json` 引擎字段 + `state-events.jsonl` 审计）：flow-comet 只用**单一** `.comet/flow-comet-state.json`——无审计日志、无 run/trajectory/checkpoint 文件族
- **Native 可靠性栈**（mutation lock、transition journal、CAS、事务化归档、证据新鲜度、repair/stagnation 预算）：未采用——协议 state 仅 currentNode/completedNodes/evidence
- **Eval 平台本体**（pytest harness、Rubric/Pass@k/Pass^k、LangSmith、Docker 隔离）：flow-comet 只携带 eval.yaml **清单**（`engine.enabled: false`）——无 eval 运行时
- **Publish/分发**（creator/publish/bundle 后端、33 平台安装器、skill-preferences）：未采用——flow-comet 是本地 bundle draft
- **Context compression**（SHA256 压缩交接包）、**auto_transition 三层配置**、**Engine Run**（确定性 step 表 + completionEvals）、**ambient resume probe / dashboard / doctor**：未采用

## 3. 借鉴边界

Comet 的 **eval（科学评估）+ publish/distribute（跨平台分发）** 构成完整闭环——`/comet-any 创作 → comet eval 证据 → 审核 → 发布 → 分发`，发布就绪以 planHash/preferenceHash/当前 draft-hash eval 证据/人工批准四者绑定。flow-comet 只借鉴了**创作产物形态**（协议、脚本、包结构、Decision Core）——评估与分发不在范围（flow-comet 是复制安装；见[安装](INSTALLATION-zh.md)）。

借鉴遵循刻意的扬弃原则：**吸收机制的形式与语义，丢弃需要分发/评估基础设施的平台机制**（对 flow-kit 同理：吸收方法论与模板，丢弃被状态机替代的文件）。这正是 flow-comet 保持零依赖、复制即用的同时，携带与 Comet Skill Creator 相同的机制 DNA 的原因。

## 4. 一句话总结

- **flow-kit** 定义*产出什么*（9 阶段方法论、模板、R1-R8 规则）——flow-comet 自动化*如何推进*
- **Comet** 定义*如何构建工作流引擎*（协议即事实源、脚本拥有状态、guard 门禁、hook 拦截）——flow-comet 借鉴机制范式，丢弃平台
