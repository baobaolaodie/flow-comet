# flow-comet

**flow-kit 9 阶段开发工作流的自动化执行引擎** —— 面向 Claude Code 平台的 workflow-kernel 实现。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.2.1-blue.svg)](CHANGELOG.md)

flow-comet 把 flow-kit 的 9 阶段开发流程（CHANGE → REQUIREMENT → DESIGN → TASK → DEV → TEST → REVIEW → INTEGRATION → ARCHIVE）从"依赖人工纪律的手动流程"变成**可验证的确定状态机**：脚本控制阶段推进、guard 校验产物质量、hook 拦截跨阶段写入、子代理隔离并行执行——流程结构自动化，行为纪律保留。

> **平台适配**：本项目适配 Claude Code（skill 体系、`claude` CLI、`.claude/` 安装位置）。不保证适配其他平台（Codex / Gemini / Cursor 等）。

---

## 目录

- [生态关系](#生态关系)
- [快速开始](#快速开始)
- [工作流总览](#工作流总览)
- [工件体系](#工件体系)
- [核心机制](#核心机制)
- [自定义协议（flow-comet-compose）](#自定义协议flow-comet-compose)
- [设计原理](#设计原理)
- [Installation](#installation)
- [Usage](#usage)
- [Examples](#examples)
- [Architecture](#architecture)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

---

## 生态关系

flow-comet 站在三个项目的交汇点：

| 项目 | 定位 | 与 flow-comet 的关系 |
|------|------|---------------------|
| [flow-kit](https://github.com/rihebty/flow-kit) | **方法论与工件体系**：9 阶段流程定义、`.specs/` 文档模板（CHANGE/REQUIREMENT/DESIGN/TASK/…）、R1-R8 行为规则 | **依赖**——flow-comet 是它的执行自动化层，工件模板与规则由 flow-kit 定义 |
| [Comet](https://github.com/rpamis/comet) | **Skill Creator 生态**：workflow-kernel 的机制来源（bundle 创作/编译、hook guard 模式、状态机管理） | **机制来源**——flow-comet 借鉴 Comet CLI 的 bundle 创作模式；**运行时可选**（直接复制安装无需 Comet CLI） |
| **Comet Classic** | Comet 的经典工作流（OpenSpec + Superpowers 双星） | **不依赖**——flow-comet 是独立 workflow-kernel，不依赖 OpenSpec/Superpowers，状态与 classic **不互通**（自有 `.comet/flow-comet-state.json` 状态机 + 文件推导路由，避免双系统歧义） |

**一句话**：flow-kit 定义"做什么"，flow-comet 自动执行"怎么推进"，Comet 提供"创作与分发工具"——三者职责分离，flow-comet 运行时只强依赖 flow-kit。

---

## 快速开始

**5 分钟跑通第一个 change**（详细安装见 [Installation](#installation)）：

> **前置依赖**：目标项目需先安装 [flow-kit](https://github.com/rihebty/flow-kit)（见 [Installation Requirements](#requirements)，`git clone https://github.com/rihebty/flow-kit.git flow-kit`）——flow-comet 的产物模板与规则来自 flow-kit。

1. **安装**（方案 A：prepare-env 安装器，无 Comet CLI 依赖）——在 flow-comet 仓库内执行一次：

   ```bash
   cd <flow-comet 仓库>
   node scripts/prepare-env.mjs --target <目标项目绝对路径>
   ```

2. **打开目标项目**（新开会话，让 Claude Code 识别新安装的 skill），在 Claude Code 中输入：

   ```
   /flow-comet
   ```

   首次调用会先与你确认 change 主题与范围，然后**自动**完成：创建 `change/<id>` 分支 → 初始化状态 → 进入 open 节点 → 按 flow-kit 协议产出 `CHANGE.md` / `REQUIREMENT.md`。

3. **之后每个阶段**：flow-comet 自动路由（design → plan → execute → review → verify → archive）。你只需要在**决策点**回答 Claude 的问题（首次范围确认、技术栈选型、破坏性变更确认、REVIEW Critical 项、归档/merge 确认等），其余全部自动推进。

> 节点检测、状态推进、分支管理、产物校验全部由 Claude 在 flow-comet skill 协议下自动执行——**你不需要手动运行任何脚本**。需要排查或高级用法时见 [Usage](#usage) 的「脚本速查」。

---

## 工作流总览

### 8 节点流程

```
open → design → plan → execute ⇄ subagent-execute → review → verify → archive
```

**与 flow-kit 9 阶段的映射**：flow-comet 把 9 阶段收敛为 8 节点——`open` 节点产出 CHANGE 与 REQUIREMENT 两阶段工件（`CHANGE.md` + `REQUIREMENT.md`），其余一一对应（design=TASK 之前的设计阶段，execute/subagent-execute=DEV 与 TEST 的执行拆分，review/verify/archive 对应 REVIEW/INTEGRATION/ARCHIVE 收尾）。

路由由脚本从 `.specs/` 工件**自动推导**（determineNode）：文件不齐 → 停在对应节点；任务未完成 → 停在 execute；全部完成 → 依次推进 review/verify/archive。

### 逐节点说明

| 节点 | 职责 | 关键产物 | 出口校验（guard） |
|------|------|---------|------------------|
| **open** | CHANGE 反问 + 需求分析（AC 推导） | `CHANGE.md` / `REQUIREMENT.md` / CONTEXT 术语更新 | 必填段（模板派生）：`## Why` / `## 用户故事` / 验收段；CONTEXT 孤立追加段检测 |
| **design** | 技术栈选型 + 架构对齐 + 决策 | `DESIGN.md`（§0 技术栈 / §0.5 架构对齐 / 决策清单 / 风险） | §0 段 + `## 决策清单`（模板派生，支持编号） |
| **plan** | 原子任务拆分（XML）+ 波次划分 | `TASK.md`（`<task>` 块含 7 字段 + parallel 标记） | task 块存在 + verify 字段；TASK 签名哈希（enter 记录） |
| **execute** | 串行任务执行（协调者委托子代理） | `<task-id>-SUMMARY.md` | SUMMARY 六段 + 6 维自查非空 + `## 自检方法` 强制；TASK 签名比对；越俎代庖检测 |
| **subagent-execute** | parallel 任务并行委托（wave） | 同上（每任务一份 SUMMARY） | 同上 + handoff evidence（Return Contract） |
| **review** | 双轮审查（spec 合规 + 代码质量 6 维） | `REVIEW.md`（Critical/发现/结论） | ≥100B + 必填段 |
| **verify** | 集成验证 + UAT + 失败诊断（≤3 轮） | `TEST.md` / `UAT.md` / LESSONS 提名 | 验证命令真实执行；UAT 必填段；LESSONS 编号/位置检测 |
| **archive** | LESSONS 提名 + 归档 + 分支收尾 | `.specs/archive/<date>-<id>/` / CHANGELOG | 分支校验（新模式）；CHANGELOG 倒序检测 |

### 分支模式

以下分支操作均由 Claude 在 skill 协议下**自动执行**（无需手动 git 操作）：

- 首次调用 `/flow-comet` 自动创建 `change/<change-id>` 分支（git 仓库时），全流程在分支上进行；分支前缀可配置（`init --branch-prefix <prefix>`，如 `feat/`，须以 `/` 结尾，默认 `change/`）
- 归档时收尾：自动合并回主分支 + 删除分支（`enablePrReview=true` 时先推送 + PR；**merge 前暂停等你确认**）
- 分支-状态一致性：`status`/`next` 检测分支与 activeChange 不符 → WARN（不 BLOCK）
- **向后兼容**：无分支的旧 change 照常运行（分支校验仅新模式生效）

### 执行模式（executionMode）

| 模式 | 语义 | 何时用 |
|------|------|--------|
| `subagent`（默认） | 统一委托子代理：协调者构造 handoff → Agent worktree 委托 → 收集 Return Contract → 验收标 done | 默认质量兜底 |
| `direct`（逃生口） | 主代理直接执行串行任务（需加载 flow-comet-dev 完整协议） | 用户显式切换（`workflow-state.mjs execution-mode direct`）后 |

`directOverride` 记录"当前处于用户确认的 direct"，切回 subagent 时自动清除。

### Express 路径（低风险降级）

CHANGE.md 头部含 `express: true`（低风险判定：改动 ≤3 文件、无后端 schema/API/数据库变更、无安全/认证/并发、纯前端重构/文案/简单 bug 修复）时自动降级：

- **review** 只执行 Round 1（spec 合规）+ Round 1.5（契约核对），跳过代码质量轮与 UI 轮
- **TEST/UAT** 用最小矩阵（只第 1 轮功能 + 核心 AC 手动确认），REVIEW.md 标注 "express 审查"

---

## 工件体系

所有流程产物存放在 `.specs/`（项目级文件）与 `.specs/<change-id>/`（单次变更）：

| 文件 | 位置 | 用途 | 产出节点 |
|------|------|------|---------|
| `CHANGE.md` | change 目录 | 变更提案（Why/What/影响面/范围排除/验收线） | open |
| `REQUIREMENT.md` | change 目录 | 需求 + AC（Given/When/Then）+ v1·v2·out 范围切分 | open |
| `DESIGN.md` | change 目录 | 技术决策（§0 技术栈/§0.5 架构对齐/决策清单/风险） | design |
| `TASK.md` | change 目录 | 原子任务（XML 7 字段 + parallel 标记 + 波次划分） | plan |
| `<task-id>-SUMMARY.md` | change 目录 | 每任务完成报告（六段：做了什么/改动文件/verify 输出/6 维自查/越界检查/自检方法） | execute / subagent-execute |
| `<task-id>-PROGRESS.md` | change 目录 | 任务中途清窗快照（临时，恢复后删除） | execute（临时） |
| `TEST.md` | change 目录 | 5 轮测试金字塔 + 验证命令 + UAT 脚本 | review |
| `REVIEW.md` | change 目录 | 审查报告（Critical/发现/结论） | review |
| `UAT.md` | change 目录 | 验收结果（每项 pass/fail） | verify |
| `CONTEXT.md` | `.specs/` | 项目级共享上下文（术语表/已锁决策/默认偏好） | open（每次追加） |
| `LESSONS.md` | `.specs/` | 跨任务失败知识库（L-NNN 按编号插入） | verify / archive |
| `CHANGELOG.md` | `.specs/` | 变更日志（表格顶部按日期倒序插入） | archive |
| `.comet/flow-comet-state.json` | `.comet/` | 状态机（activeChange/currentNode/completedNodes/evidence/executionMode/branchMode/…） | 全程（脚本管理） |

> **追加位置纪律**：CONTEXT 术语→术语表表格、决策→已锁决策清单；LESSONS→条目区按 L-NNN 编号；STATE/CHANGELOG→顶部倒序；T-FIX→`## Fix 任务` 段——guard 检测（WARN 渐进）兜底。

---

## 核心机制

### 1. 状态机与路由（文件即真相）

- 单文件状态机 `.comet/flow-comet-state.json`；节点推进由 `workflow-guard.mjs exit <node> --apply` 门控
- **determineNode**：从 `.specs/` 工件实时推导当前节点（文件不齐→停在对应节点），不完全信任 state
- **P0-2 自动纠偏**：state 的 currentNode 与推导不一致时自动写回（`next` 触发）

### 2. 三层防线（越俎代庖防护）

| 层 | 机制 | 校验点 |
|----|------|--------|
| ① hook 物理拦截 | phase 白名单：execute/subagent-execute 协调者只写 `.specs/`；源码由 worktree 子代理写（cwd 无 state → 放行） | 写入目标路径 + currentNode 判定 |
| ② 协调者禁令 | `next`/`entry` 每次注入"你是协调者不是执行者"（direct 模式 execute 豁免） | 输出注入 |
| ③ exit 越俎代庖检测 | parallel 任务 done 必须有 handoffResult，否则 BLOCKED（`parallelTakeoverApproved` 显式豁免） | TASK.md + handoff evidence |

### 3. guard 校验体系（证据驱动推进）

| 机制 | 校验点 | 触发 |
|------|--------|------|
| 段名模板派生 | open/design exit 必填段名从 `flow-kit/templates/` 自动派生（模板缺失 fallback） | exit open/design |
| TASK 签名哈希 | enter 记录任务集签名（行尾规范化 + 剥离标记类属性 status/completed_at 等）→ exit 比对：增删任务/改 action/改边界 BLOCKED；标记 done/加标记属性合法 | enter/exit execute |
| 节点顺序 BLOCK | next 时 currentNode 未 exit（非正常推进后继）→ BLOCKED；exit 推进后的正常 next 豁免；T-FIX 回退豁免（TASK 有 pending T-FIX） | next |
| handoff completedChecks | 子代理回传的 Return Contract 必须含 required-skill completedChecks（skill 加载证据），缺失 BLOCKED | exit subagent-execute |
| redEvidence 时序 | handoff 中 redEvidence 必须先于 greenEvidence 真实存在；已记录 greenEvidence 后补录 redEvidence → BLOCKED | workflow-handoff result |
| SUMMARY 六段校验 | verify 输出/6 维自查（非空，按行过滤标题含 emoji）/越界检查 + `## 自检方法` 强制 | exit execute |
| verify 真实执行 | TEST.md `## 验证命令` 段真实运行（支持多行 `&&`）；verifyFailures 机器计数，第 4 次 BLOCKED | exit verify |
| 追加位置检测 | CONTEXT 孤立追加段 / LESSONS 编号乱序+区外 / STATE+CHANGELOG 非倒序 → WARN（渐进） | exit open/verify/archive |
| 委托前检查 | `.specs/<change>/` 未提交工件 → WORKTREE WARN；PROGRESS.md 存在 → 恢复警告 | entry execute |
| state schema 校验 | writeState 8 字段类型 fail-closed（state-schema.mjs 单一来源，三脚本共用） | 全部 state 写入 |

### 4. 执行模型（子代理化）

- **Return Contract**：子代理回传 `{status, commitHash, redEvidence, greenEvidence, completedChecks, riskSignals}`——缺 commitHash/greenEvidence/completedChecks BLOCK；redEvidence 缺失渐进 WARN；redEvidence 事后补录 BLOCK
- **handoff hash 溯源**：`git show <commitHash>` 校验提交文件 ⊆ write_files（自动从 TASK.md 解析，剥离 XML 注释）
- **write_files 冲突检测**：parallel 任务 write_files 不重叠才可同 wave 并行

### 5. 恢复协议

- 任意入口恢复：determineNode 从文件推导 + state 自动纠偏（不依赖对话历史）
- PROGRESS.md 恢复警告（R1.6 反重复）
- 分支-状态一致性校验

### 6. guard 自测套件（作者回归基线）

`scripts/guard-self-test.mjs`：63 场景覆盖全部 entry/exit 校验正反例（含分支校验、追加位置检测、自定义协议、组合场景），**作者每次改动后回归**（脚本自身机制自测——在自建临时环境模拟 state/协议/hook 输入，**不依赖安装完整性**，不是安装验证判据）：

```bash
node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs
# → ALL 63 SCENARIOS PASSED
```

---

## 自定义协议（flow-comet-compose）

`/flow-comet-compose` 是横向命令 skill（与 flow-comet-evolve / flow-comet-health 同类，**不属于 8 节点流程**）：引导你把任意已安装 skill 组合成自定义工作流协议（protocol JSON），生成后由同一套机制完整驱动（状态机路由 / guard 校验 / hook 拦截），无需新增任何运行时能力。内置 8 节点协议是默认工作流，**不可被取代**。

### 加载方式

| 方式 | 说明 |
|------|------|
| `--protocol <path>`（或 `--protocol=<path>`） | CLI 参数——由 Claude 在流程中自动附带 |
| `FLOW_COMET_PROTOCOL` | 环境变量——写入项目环境（如 `.claude/settings.json` 的 `env`）可持久生效 |

优先级：`--protocol` CLI 参数 > `FLOW_COMET_PROTOCOL` 环境变量 > 内置默认（resolveProtocol）。未显式指定时一切行为与内置协议完全一致（见下「与内置协议的关系」）。

### 协议最小结构

| 字段 | 说明 |
|------|------|
| `schemaVersion` | `1` |
| `kind` | `"workflow-kernel"` |
| `name` | 协议名 |
| `nodes[]` | 节点数组：`id`（避开内置 8 节点 id）、`implementation.skill`、`requiredSkillCalls`、`outputSchemas` |
| `outputSchemas[]` | 产物 schema：`artifacts[].paths` + `evidence` |
| `writeWhitelist`（可选） | hook 白名单（节点 id → 允许写入的路径前缀数组，**支持 `<change-id>` 占位符**——协议复用自动适配）；未声明时内置 id 用内置表、自定义 id 默认协调者白名单 `['.specs/']`（写源码必须声明） |
| `taskFile`（可选） | 任务文件路径，缺省 `TASK.md` |

### 强制最小规则

- **每节点必须有产物**：`outputSchemas` 引用的 schema 必须存在于顶层 `outputSchemas[]`，且 `artifacts[].paths` 非空——没有产物就无法做 guard 校验与恢复
- **每节点必须有 evidence**：每个 outputSchema 必须带 `evidence: [{ id, required }]`，供 `workflow-state.mjs record` 记录节点证据
- **节点 id 避开内置 8 节点 id**：`open` / `design` / `plan` / `execute` / `subagent-execute` / `review` / `verify` / `archive` 为保留 id，自定义协议不得复用——防止特化校验（ADR-002 语义）误触发

### 最小协议示例

```json
{
  "schemaVersion": 1,
  "kind": "workflow-kernel",
  "name": "compose-demo",
  "nodes": [
    { "id": "brainstorm",  "outputSchemas": ["compose.notes.v1"],    "requiredSkillCalls": [], "augmentations": [] },
    { "id": "tdd",         "outputSchemas": ["compose.tdd.v1"],      "requiredSkillCalls": [], "augmentations": [] },
    { "id": "codereview",  "outputSchemas": ["compose.verdict.v1"],  "requiredSkillCalls": [], "augmentations": [] }
  ],
  "outputSchemas": [
    {
      "id": "compose.notes.v1",
      "artifacts": [
        { "id": "notes", "kind": "file", "required": true,
          "paths": ["<change-id>/notes.md"], "pathBase": "specs-root" }
      ],
      "evidence": [ { "id": "notes", "required": true } ]
    }
  ],
  "writeWhitelist": { "brainstorm": [".specs/"] }
}
```

> 每个节点必须有非空 `outputSchemas` 引用 + 每条 schema 必须带 `evidence`；`writeWhitelist` 省略时内置 id 用内置表、自定义 id 用协调者默认 `['.specs/']`（D-16，写源码必须显式声明）。完整生成流程见 `/flow-comet-compose` skill 的「产物示例」。

### 与内置协议的关系

- **并存、互不干扰**：切换只需修改启动参数或环境变量
- **默认不可变**：自定义协议不持久化生效，未显式指定时一切行为与内置协议完全一致
- 内置 8 节点协议始终可用，作为默认工作流**不可被取代**

### 指引

详细交互流程见 `flow-comet-compose` skill；用法示例（最小 3 节点协议：头脑风暴 → TDD → 代码审查）见该 skill 的「产物示例」。

---

## 设计原理

为什么 flow-comet 这样设计：

- **文件即真相，不做事件溯源**：单文件状态机 + 从 `.specs/` 推导节点——简单且恢复不依赖历史
- **结构级校验，不做语义判断**：guard 判"填没填"（段名/非空/结构），"填得好不好"交给 review——校验轻、误报少
- **检测+纠偏，不做拦截**：agent 环境无法真正阻止 LLM 直改文件，机器字段靠检测与自动写回
- **状态不入库**：`.comet/` 保持 gitignore——分支切换共享同一份工作树状态，避免状态分裂
- **不并行 change、不强制 PR**：一次一个 active change（状态机模型简单）；PR 审查按需开启

---

## Installation

### Requirements

- [Claude Code](https://claude.ai/code)（已安装并认证）
- 目标项目已安装 [flow-kit](https://github.com/rihebty/flow-kit)：

```bash
cd <目标项目>
git clone https://github.com/rihebty/flow-kit.git flow-kit
```

  验证 flow-kit 安装成功：`ls <目标项目>/flow-kit/templates/` 应列出工件模板文件（CHANGE.md / REQUIREMENT.md 等）。

### 方案 A · prepare-env 安装器（推荐）

从本仓库使用 `prepare-env` 脚本自动化安装到目标项目（无需 Comet CLI）：

```bash
cd <本仓库>
node scripts/prepare-env.mjs --target <目标项目绝对路径>
```

`prepare-env` 会：
1. **生成/覆盖 `rules/` 与 `skills/`**（全部 flow-comet* skill，从权威源 `.comet/bundle-drafts/flow-comet/`）
2. **注入 hook 到 `settings.local.json`**——采用**读-合并-写**方式（参考 Comet 安装器）：保留目标项目既有的一切内容（`permissions`、自定义 hook、其他 matcher 组等），仅在 `hooks.PreToolUse` 中注入/更新 comet-hook-guard 条目（已存在的 comet hook 会被替换而不是重复追加——幂等）。**首次创建**（目标项目原本没有 `settings.local.json`）时只写入 hook 条目；**已有文件**时按读-合并-写保留既有字段

**非破坏设计**：默认**不会删除**目标项目 `.claude/` 下任何既有内容（`commands/`、自定义 skill、自定义配置全部保留）。显式传入 `--purge --yes` 才会删除整个 `.claude/` 后重建（打印删除清单 + 警告，用于 e2e 假项目等干净环境；`--yes` 为二次确认，防误传）。

```bash
# 查看将覆盖的生成物清单后确认（默认非破坏，安全）
node scripts/prepare-env.mjs --target <目标项目绝对路径>
# 破坏性重建（仅用于干净环境，会删除目标 .claude/ 全部内容；需 --yes 二次确认）
node scripts/prepare-env.mjs --target <目标项目绝对路径> --purge --yes
```

> **使用前提**：`prepare-env` 脚本必须在 flow-comet 仓库内运行（它从仓库的 `.comet/bundle-drafts/flow-comet/` 权威源读取安装内容），`--target` 指向目标项目。
>
> **覆盖说明**：`prepare-env` 会覆盖目标项目 `.claude/rules/` 与 `.claude/skills/` 下的 **flow-comet 生成物**——若你对 flow-comet 自身文件做过本地修改，会被权威源版本覆盖；`.claude/` 下其他内容（`commands/`、自定义 skill、自定义配置）不受影响。
>
> **更新已安装的 flow-comet**：重跑同一条方案 A 命令即可（幂等——覆盖生成物 + 合并注入 hook，既有配置保留）。
>
> **settings 保护**：若目标项目 `settings.local.json` 已存在且 JSON 非法，或 `hooks.PreToolUse` 不是数组结构，脚本会**中止注入并警告**（不覆盖用户配置），请手动按方案 B 添加 hook。

验证安装（无副作用，不创建 change）：

1. **结构检查**：`<目标项目>/.claude/skills/` 下 `flow-comet*` skill 目录数量与 prepare-env 输出一致（当前 19 个）+ `rules/flow-comet-orchestration.md` + `settings.local.json` 均存在
2. **配置可加载性**：`settings.local.json` 是合法 JSON；`hooks.PreToolUse[].command` 指向 `node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs` 且该文件存在
3. **一致性检查**：与权威源比对（在 flow-comet 仓库内执行，strip 行尾差异后应无差异）：`diff -r --strip-trailing-cr .comet/bundle-drafts/flow-comet/rules <目标项目>/.claude/rules` 与 `diff -r --strip-trailing-cr .comet/bundle-drafts/flow-comet/skills <目标项目>/.claude/skills`——**diff 无输出即通过**（无差异）
4. **真实环境冒烟**：**在目标项目目录内执行** `cd <目标项目> && node .claude/skills/flow-comet/scripts/workflow-state.mjs status`——期望输出 JSON 状态对象（全新项目为 `{"status": "no-change", ...}`，运行中为 `{"status": "running", "change": ...}`），证明脚本在真实 cwd 下可运行、无语法错误、能读状态

> 命令为 POSIX 风格（Git Bash / WSL / macOS 终端）；Windows 用户请在 Git Bash 中执行。

> **注意**：`guard-self-test.mjs` 的 63 场景是**作者回归基线**（脚本自身机制自测——在自建临时环境模拟 state/协议/hook 输入，不依赖安装完整性），不是安装验证判据；它通过只证明脚本逻辑没坏。

### 方案 B · 手动复制粘贴（无脚本环境兜底）

无法运行 prepare-env 时，手动复制与配置：

```bash
cd <本仓库>
SKILLS=.comet/bundle-drafts/flow-comet/skills
TARGET=<目标项目绝对路径>

# 1. 复制全部 flow-comet* skill（含 GUIDANCE 与脚本）
cp -r $SKILLS/flow-comet* "$TARGET/.claude/skills/"

# 2. 复制编排规则
cp .comet/bundle-drafts/flow-comet/rules/flow-comet-orchestration.md "$TARGET/.claude/rules/"
```

**3. 注册 hook（手动）**：在目标项目 `.claude/settings.local.json` 的 `hooks` 中**合并**以下片段（保留该文件既有内容，如 `permissions`）。hook command 的相对路径**相对于 Claude Code 的项目根**解析（即 `<目标项目>/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs`）：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs"
          }
        ]
      }
    ]
  }
}
```

> `settings.local.json` 是每个项目各自的本地配置（权限、hook、偏好），**prepare-env 只注入 hook 条目、不覆盖其他字段**；手动安装时同样遵循"合并而非覆盖"。

**4. 运行状态**：`.comet/flow-comet-state.json` 由 `init`（或首个 `/flow-comet` 调用）自动创建。

### 安装后的项目集成（仅当目标项目也使用 Comet 时适用）

> **适用条件**：以下定制只针对**已运行过 `comet init` 的目标项目**（其 CLAUDE.md 中存在 `<comet-ambient-resume>` 块）。未使用 Comet 的项目**跳过本段**——flow-comet 不依赖 Comet，有自己的状态机与文件推导恢复。

flow-comet 会**定制 `comet init` 注入的 `<comet-ambient-resume>` 块**（Comet 标准恢复协议）为 flow-comet 优先路由——否则恢复流程只会跑 Comet 标准探针，不会路由到 `/flow-comet`：

1. 若目标项目已运行过 `comet init`（CLAUDE.md 存在该块），将其内容替换为：

```markdown
<comet-ambient-resume>
<!-- Managed by Comet. Edits inside this block may be replaced by comet init/update. -->
<!-- Contract: comet.resume_probe.v2 -->
<!-- flow-comet overlay: project uses flow-comet as primary workflow -->

## Comet Ambient Resume

在这个仓库中，开始处理需要改动或调查的任务前，如果可能存在活跃 Comet workflow，按以下顺序检查：

### 优先级 1：flow-comet 路由（项目主工作流）

如果 `.claude/skills/flow-comet/SKILL.md` 存在（flow-comet 已安装）：

1. 检查 `.comet/current-change.json` 或运行 `comet state get <change> phase` 确认是否有活跃 change
2. 如有活跃 change 且 `phase=build`，直接进入 `/flow-comet`（不要运行 resume probe）
3. 如有活跃 change 但 phase 不是 build，按 flow-comet 的节点路由表决定入口
4. 如无活跃 change，用户明确要开发时进入 `/flow-comet`（它会路由到 open 阶段）

### 优先级 2：Comet 标准探针（flow-comet 不适用时）

仅当 flow-comet 未安装或用户明确调用 `/comet-classic` 时，运行标准探针：
`comet resume-probe . --stdin --json`

- 如果用户通过宿主明确调用任意 Comet Skill（例如 `/comet`、`/comet-classic`、`/comet-hotfix`），显式调用优先于本恢复协议。
- 如果 probe 返回 `auto_resume`，简短说明选中的 active change，并进入 `nextCommand` 指向的永久入口。
- 如果 probe 返回 `ask_user`，只问一个简短问题并等待用户回复。
- 如果 probe 返回 `out_of_scope` 或 `none`，不要进入 Comet workflow。
- 不能只因为存在 active change 就把无关任务挂到该 change。
</comet-ambient-resume>
```

2. **注意**：块头保留 `Managed by Comet` 标记——重跑 `comet init`/`comet update` 会把该块**覆盖回标准内容**，需重新应用本定制。

3. 若目标项目未运行过 `comet init`，本定制可选（flow-comet 不依赖 resume-probe，有自己的 `.comet/flow-comet-state.json` 状态机 + determineNode 文件推导恢复）。

**规则文件**（安装到 `.claude/rules/`）：
- `flow-comet-orchestration.md` — flow-comet 自带（prepare-env/方案 B 自动安装，标识 Entry Skill 与编排结构）
- `comet-workflow-guard.md` — Comet 生态规则（`comet init` 安装，Native/Classic 双 workflow 防串扰）

---



## Usage

### 用户入口

在目标项目打开 Claude Code，输入：

| 入口 | 用途 |
|------|------|
| `/flow-comet` | 启动或继续 8 节点工作流（自动检测活跃 change，路由到当前节点） |
| `/flow-comet-compose` | 组合已安装 skill 生成自定义协议（横向命令，不属于 8 节点流程，见[自定义协议](#自定义协议flow-comet-compose)） |
| `/flow-comet-evolve` | 扫描已归档 change 的 DESIGN §9，批量评审沉积候选（横向） |
| `/flow-comet-health` | 周期健康检查：CONTEXT 一致性 / LESSONS 扫描 / 技术债 / 冗余（横向） |

### 流程中的决策点

flow-comet 在以下节点**暂停并向你确认**（其余全部自动推进）：

| 节点 | 决策点 |
|------|--------|
| 首次调用 | change 主题与范围（存在多个合法解释时） |
| design | 技术栈选型（5~6 张候选卡） |
| execute | 破坏性变更检测（R4.6）；Schema 迁移（R4.5） |
| review | REVIEW 的 Critical 项处理 |
| verify | UAT 连续失败第 4 次：「继续修 / 停止」 |
| archive | 归档与 merge change 分支到 main（不可逆操作） |
| 归档前置 | PR approve（`enablePrReview` 开启时） |

### 脚本速查（引擎内部，Claude 自动执行）

以下脚本由 flow-comet skill 在流程中**自动运行**，**用户无需手动执行**——仅在故障排查或高级场景使用。路径为 `<目标项目>/.claude/skills/flow-comet/scripts/`：

```bash
node workflow-state.mjs status             # 当前状态 + 分支一致性
node workflow-state.mjs init <id> [--branch-prefix <prefix>]   # 初始化 change（自动建分支，前缀默认 change/）
node workflow-state.mjs next               # 获取下一节点与 SKILL
node workflow-state.mjs record <node> '{...}'                  # 记录节点证据
node workflow-state.mjs config set enablePrReview true         # 开启 PR 审查
node workflow-state.mjs execution-mode <subagent|direct>       # 切换执行模式（direct 需用户确认）
node workflow-guard.mjs entry/exit <node> [--apply]            # 节点门禁
node workflow-handoff.mjs request|result|status                # 子代理委托交接
```

**子代理委托**（execute/subagent-execute 节点，由 Claude 自动执行）：按 TASK.md 解析 write_files → `workflow-handoff.mjs request` 注册 → Agent 工具（`isolation: "worktree"`）委托子代理并回传 Return Contract → `result` 记录证据 → guard 校验委托合法性。

---

## Troubleshooting

| 现象 | 原因 | 处理 |
|------|------|------|
| `BLOCKED: 归档必须在 change/<id> 分支上进行` | 在错误分支执行 archive（分支模式） | `git checkout change/<id>` 后重试 |
| `WARN: 分支与 activeChange 不一致` | 分支与状态漂移 | `git checkout change/<activeChange>`（按 WARN 提示）后继续 |
| `WORKTREE WARN: .specs/<change>/ 有未提交工件` | 委托前工件未 commit | commit 工件，或在委托 prompt 内联上下文 |
| `BLOCKED: TASK.md 任务集被修改` | execute 期间增删任务/改 action/改边界 | 回退 TASK.md 到 enter 时内容（仅标记 done 是合法的） |
| `BLOCKED: state 字段类型非法` | state 文件被直改坏 | 修复字段类型或从备份/git 历史恢复 `.comet/flow-comet-state.json` |
| `WARN: CONTEXT.md 检测到孤立追加段` | 术语/决策被尾部追加成新段 | 把内容移入术语表表格/已锁决策清单 |
| `WARN: LESSONS.md 条目编号乱序/区外` | 新条目未按 L-NNN 插入条目区 | 按编号插入 `## 条目区`（或 `## 活跃条目`） |
| `BROOKS-LINT WARN: 使用 builtin-quickcheck 未声明原因` | SUMMARY 缺"插件不可用"说明 | 在 SUMMARY 的 `## 自检方法` 段补原因 |
| `BLOCKED: verify 失败超限（verifyFailures=3）` | UAT/自动化连续失败 3 次 | 暂停，人工决策「继续修 / 停止」（R2.6） |
| `BLOCKED: 疑似未 exit 节点 <node>` | `next` 检测到节点顺序非法（跳节点/未 exit） | 按提示执行 `workflow-guard.mjs exit <node> --apply`（T-FIX 回退场景见提示） |
| `BLOCKED: workflow protocol node must have a non-empty string id` | 自定义协议 `nodes[]` 含空/非法元素 | 修复协议 JSON：每个节点 `id` 为非空字符串且避开内置 8 节点 id |
| `BLOCKED: 未在协议 writeWhitelist 中声明` | 写入路径超出自定义协议白名单（fail-closed） | 在协议 `writeWhitelist` 声明该节点允许的路径前缀，或改用内置协议 |
| `--protocol <path> 加载失败` | 协议路径不存在 / schemaVersion 或 kind 不符 | 检查路径；确认 `schemaVersion: 1`、`kind: "workflow-kernel"` |

---

## Examples

[docs/examples/schedule-venue-filter/](docs/examples/schedule-venue-filter/) —— 12 个工件覆盖 open→archive 全链路的完整产物示例，对照 flow-kit 模板质量标准。

---

## Documentation

| 文档 | 说明 |
|------|------|
| [变更日志](CHANGELOG.md) | Keep a Changelog 风格，版本历史（当前 v1.2.1） |
| [产物示例](docs/examples/schedule-venue-filter/) | 全流程 12 个工件参考 |
| [验证记录](VERIFICATION.md) | 分发验证 |

**回归验证（作者基线）**：`node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs` → `ALL 63 SCENARIOS PASSED`。

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ flow-comet（本仓库）                                      │
│  ├─ .comet/bundle-drafts/  ★ 权威源（19 skills + scripts）│
│  ├─ docs/                   产物示例 / 验证记录           │
│  └─ 运行时（安装到目标项目）                               │
│      ├─ .claude/skills/flow-comet*   （skill 实现 + GUIDANCE）│
│      ├─ .claude/rules/                （编排规则）          │
│      ├─ .claude/settings.local.json   （hook 注册）        │
│      └─ .comet/flow-comet-state.json  （自有状态机）       │
└─────────────────────────────────────────────────────────┘
```

- **状态机**：`.comet/flow-comet-state.json`（activeChange/currentNode/completedNodes/evidence/verifyFailures/executionMode/directOverride/branchMode/enablePrReview/taskHash）
- **hooks**：`comet-hook-guard` 按 phase 白名单控制文件写入权限 + 路径安全校验（防 symlink 逃逸）。**不安装** comet 的 `comet-hook-router`（classic 专用，与 workflow-kernel 不兼容）
- **state 写入**：三脚本（state/guard/handoff）统一经 `state-schema.mjs` 字段校验（fail-closed）

---

## Limitations

- **仅 Claude Code 平台**：非 Claude Code 环境不保证可用
- **Return Contract 过渡规则**：旧格式纯字符串 handoff 豁免为 WARN；redEvidence/greenEvidence 缺失渐进 WARN（不 BLOCK），避免已有 change 重入被卡死
- **与 comet classic 不互通**：workflow-kernel 状态独立于 classic（设计决策，非缺陷）
- **无活跃 change 时 hook 放行**：`.comet/flow-comet-state.json` 不存在时 hook guard 降级放行所有写入（设计决策：无 workflow 时不限制文件操作）
- **hook blocking 语义**：PreToolUse hook 的 exit 2（blocking，阻止工具调用）在**主会话 TUI 实测生效**（2026-08-08 实测：越权写被物理阻止）；**claude -p（SDK CLI 模式）下非零退出被降级为 non-blocking**——仅日志记录拦截，写入不阻止（D-13）
- **worktree 挂载依赖**：Agent `isolation: "worktree"` 的 worktree 挂在**会话项目根**（非子代理目标项目）——跨仓库场景产物需 `git show <branch>:<path>` 手动搬运，W2-D 的 `git show` 校验降级（详见 `reference/worktree-notes.md`）
- **GUIDANCE 不经 lane 记录**：`<skill>-GUIDANCE.md` 与 SKILL.md 引用行不登记 authoring-lanes，重跑 `comet creator generate` 会清掉（bundle compile 不受影响）

---

## 版本与兼容性

| 项 | 说明 |
|----|------|
| **当前版本** | v1.2.1（记录于 [CHANGELOG.md](CHANGELOG.md) 与 git tag；v1.0.0 = 首个稳定版：8 节点工作流 + 三层防线 + guard 校验体系） |
| **版本策略** | 语义化版本：新功能发布 → minor（1.2.0）、bug 修复 → patch（1.1.1）、破坏性变更 → major（2.0.0）；每轮功能迭代完成时 bump |
| **bundle 版本解耦** | `bundle.yaml`/`skill.yaml` 的 version 保持 1.0.0（bundle 发布流程与版本号解耦）；git tag 与 CHANGELOG 是版本唯一事实来源 |
| **依赖（必需）** | [flow-kit](https://github.com/rihebty/flow-kit)（方法论与工件模板）；Claude Code |
| **平台** | Claude Code（skill 体系）；不保证 Codex/Gemini/Cursor |
| **运行时** | 脚本为 Node.js ESM（Node ≥ 18）；工件语言与项目主语言一致 |
| **兼容策略** | 旧 change/旧 state 自动补默认字段（executionMode/branchMode/enablePrReview），无分支 change 照常运行——向后兼容 |
| **回归基线** | `guard-self-test.mjs` 63 场景全绿（每次改动后必须） |

---

## Contributing

欢迎贡献。修改 skill/脚本请改 `.comet/bundle-drafts/flow-comet/skills/`（权威源），然后走发布流程（见 Installation 方案 A）。每次改动后运行 `guard-self-test.mjs` 回归（63 场景全绿为验收标准）。

---

## License

[MIT](LICENSE) © 2026 baobaolaodie

flow-comet 依赖 [flow-kit](https://github.com/rihebty/flow-kit)（MIT）和 [Comet](https://github.com/rpamis/comet)（MIT）。
