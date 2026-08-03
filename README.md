# flow-comet

**flow-kit 9 阶段工作流的 Comet `workflow-kernel` 实现** —— 面向 **Claude Code** 平台的开发工作流框架。

flow-comet 用 [Comet](https://github.com/rpamis/comet) 的 workflow-kernel 机制实现 [flow-kit](https://github.com/rihebty/flow-kit) 的 9 阶段流程（CHANGE → REQUIREMENT → DESIGN → [UI-DESIGN] → TASK → DEV → TEST → REVIEW → INTEGRATION → ARCHIVE），用脚本自动化替代 flow-kit 的手动状态维护，同时保留 `.specs/` 文档体系。

> **⚠️ 平台适配**：本项目**适配 Claude Code**（Claude Code skill 体系、`claude` CLI、`.claude/` 安装位置）。**不保证适配其他平台**（Codex / Gemini / Cursor 等）。分发到其他平台前需自行验证兼容性。

---

## 特性

### 基础能力

- **8 节点自动路由**：`open → design → plan → execute → subagent-execute → review → verify → archive`，脚本读 TASK.md 工件自动检测状态并路由
- **自有状态机**：`.comet/flow-comet-state.json`（独立于 comet classic 的 `current-change.json`；本框架不与 comet classic 状态互相干扰）
- **evidence 自动化**：`record` 传 summary 即可，`exit` 自动补 completedChecks + 状态漂移自动校正（P0-2）
- **express 路径**：低风险 change（CHANGE.md 标 `express: true`）自动降级 review（仅 Round 1+1.5）与 TEST/UAT（最小矩阵）
- **并行执行**：`subagent-execute` 按 wave 委托并行任务，guard 自动校验 wave 内 write_files 无冲突 + 依赖感知路由（只委托依赖已满足的 parallel 任务）
- **契约核对**：`contract-check.mjs` 提取前后端枚举/校验供 review 比对
- **横向命令**：`flow-comet-evolve`（架构沉淀扫描）+ `flow-comet-health`（代码库巡检），独立于 8 节点流程
- **流程安全**：完整继承 flow-kit 的 R1-R8 规则（TDD / LESSONS 扫描 / diff 边界 / 角色红线）

### 硬约束层（2026-08 增强 · 吸收 comet 机制）

针对真实项目验证暴露的"guard 只查存在性、状态可跳转、子代理自由发挥"问题，补强为硬约束：

- **状态机转移门**：`exit` 校验 `currentNode === 被 exit 节点` + 每个节点前置 evidence（防跳阶段，对齐 comet 转移表 `from` 语义）
- **SUMMARY 关键段校验**：execute / subagent-execute 出口校验每份 `*-SUMMARY.md` 含 `verify 输出` / `6 维自查` / `越界检查` 三段（大小写不敏感 + 变体兼容）
- **verify 真实跑命令**：verify 出口真实执行 TEST.md `## 验证命令` 段声明的命令（严格版，历史归档 change 豁免）
- **子代理 Return Contract**：委托子代理必须回传 `{status, commitHash, redEvidence, greenEvidence, riskSignals}`，缺 commitHash / greenEvidence 则 BLOCKED（旧格式纯字符串豁免为 WARN）
- **verifyFailures 机器计数**：verify 失败自动重试 ≤ 3 次，第 4 次必须用户决策
- **handoff hash 溯源**：`result` 用 `git show <commitHash>` 校验提交文件 ⊆ writeFiles 允许范围（越界 WARN）
- **dirty-worktree 归属**：execute / verify 入口读 `reference/dirty-worktree.md` 做 git 三分类归属
- **决策点四分类**：用户决策 / 自动处理 / 停止条件 / 手动交接（`AskUserQuestion` 优先，不重问已持久化选择）
- **归档交付闭环**：归档单一 commit（`chore: archive <change-id>`）+ 显式路径 stage

## 依赖

| 依赖 | 用途 | 许可 | 获取 |
|---|---|---|---|
| [Comet](https://github.com/rpamis/comet) | workflow-kernel 运行时 + `comet bundle` 生命周期 | MIT | npm 全局安装 |
| [flow-kit](https://github.com/rihebty/flow-kit) | 9 阶段协议（prompts/templates/reference），**外部依赖** | MIT（© 2026 rihebty） | clone 到目标项目根 `flow-kit/` |

> flow-kit 是独立开源项目，不随本仓库分发。目标项目使用 flow-comet 前需先安装 flow-kit。
> **Claude Code** 是运行时环境（skill 执行），需已安装并认证。

## 安装与分发（适配 Claude Code）

### 1. 准备目标项目（Claude Code 项目）

```bash
# 目标项目根目录安装 flow-kit（外部依赖）
git clone https://github.com/rihebty/flow-kit.git flow-kit
```

### 2. 从本仓库分发到目标项目

```bash
# 在本仓库（flow-comet，含 bundle 状态）
comet bundle compile flow-comet --platform claude                       # 验证可编译
comet publish distribute flow-comet --platform claude --scope project \
  --project <目标项目绝对路径> --confirm-executables                    # 安装到目标项目 .claude/skills/
```

- `--project` 指定目标项目根（默认当前目录）；`--confirm-executables` 确认 hook 脚本披露
- 分发前先 `comet publish distribute flow-comet --preview` 检查将写入的文件与可执行披露

目标项目需：
- 已安装 Comet CLI + Claude Code
- 根目录有 `flow-kit/`（见步骤 1）
- 有 `.specs/` 工件体系
- `.gitignore` 处理 `.claude/` / `.comet/`（如需版本化）

### 3. 修改本仓库 skill/脚本后的发布流程

```bash
# 修改 .comet/bundle-drafts/flow-comet/skills/ 后：
comet bundle compile flow-comet --platform claude                       # 重算 currentHash
# 重新 eval（见"eval 桥接"）
comet publish review flow-comet --platform claude                       # 检查 readiness
comet publish approve flow-comet --reviewer <reviewer>                  # 人类批准
comet publish run flow-comet --platform claude                          # 发布到 .comet/bundles/
comet publish distribute flow-comet --platform claude --scope project --project <目标> --confirm-executables
```

> 改动 skill/脚本会改变 bundle currentHash → 旧 eval 证据自动失效（comet reconcile 机制）→ 必须重新 eval + publish + distribute。

## 使用（Claude Code 项目）

在目标项目输入 `/flow-comet` 启动。首次调用自动检测活跃 change 或初始化新 change。

## 架构说明

```
┌─────────────────────────────────────────────────────────┐
│ flow-comet（本仓库）                                      │
│  ├─ .comet/bundle-drafts/   ★ 权威源（16 skills + scripts）│
│  ├─ .comet/bundles/         已发布 bundle（可 distribute） │
│  ├─ docs/                   改进规格 / 验证记录             │
│  └─ 运行时（安装到目标项目）                               │
│      ├─ .claude/skills/flow-comet*   （skill 实现）        │
│      ├─ .claude/rules/                （编排规则）          │
│      └─ .comet/flow-comet-state.json  （自有状态机）       │
└─────────────────────────────────────────────────────────┘
```

- **状态机**：flow-comet 用 `.comet/flow-comet-state.json`（activeChange/currentNode/completedNodes/evidence/verifyFailures），独立于 comet classic 的 `current-change.json`
- **hooks**：仅安装 `flow-comet-hook-guard`（路径安全守卫）；**不安装** comet 的 `comet-hook-router`（它是 classic 专用，与 workflow-kernel 不兼容，会阻断写入）

## 限制与已知问题

- **仅 Claude Code 平台**：非 Claude Code 环境不保证可用
- **comet eval 需 API key**：容器内 eval（authoring-skill-smoke + workflow-route-conformance）需 Docker 内跑 Claude 的 `execution-identity` 验证，缺 `ANTHROPIC_API_KEY` 会失败（`RuntimeError: Could not verify eval Docker/Claude execution identity`）
- **eval 手动桥接**（无 API key 时的替代，项目惯例）：构建 schemaVersion 2 result.json + `comet bundle eval-record`：
  1. `draftHash` = bundle 当前 `currentHash`（`comet bundle compile` 后从 `.comet/bundle-authoring/<name>.json` 读）
  2. `evalManifestHash` = `sha256(生成版 comet/eval.yaml 原始字节)`（eval.yaml 未改则不变）
  3. 构建 `{schemaVersion:2, provider:'comet-eval', level:'quick', draftHash, evalManifestHash, tasks, treatments, passAtK, weightedScore, instabilityGap, failures, reports, passed, summary}`
  4. `comet bundle eval-record <name> --result <file>`（`resultMatchesCurrentDraft` 校验 hash 匹配才接受）
  > ⚠️ 手动桥接是 **deterministic-check-only** 证据，须在 summary 诚实标注，不伪装成容器内真跑
- **W1-D 过渡规则**：Return Contract 只对未来新委托强制；旧格式（纯字符串）handoff result 豁免为 WARN，避免已有 change 重入 subagent-execute 被卡死
- **与 comet classic 关系**：本框架是 workflow-kernel（非 classic/native），不与 comet classic 状态互通（GAP-7 设计）

## 仓库结构

```
├── .comet/
│   ├── bundle-authoring/flow-comet.json   # bundle 元数据（draftPath/currentHash/eval/review/ready）
│   ├── bundle-drafts/flow-comet/          # ★ 权威源（16 skills + rules + hooks）
│   ├── bundles/flow-comet/                # 已发布 bundle（可 distribute）
│   └── config.yaml
├── docs/
│   ├── flow-comet-improvement-spec.md     # 改进规格（扬弃 comet/flow-kit 的落地方案）
│   └── VERIFICATION.md                    # 分发验证记录
└── LICENSE                                # MIT
```

> 修改 skill/脚本请改 `.comet/bundle-drafts/flow-comet/skills/`，然后 `comet bundle compile` 验证、`publish` 更新发布产物（见"修改后的发布流程"）。

## 许可

[MIT](LICENSE) © 2026 baobaolaodie

flow-comet 依赖外部项目 flow-kit（MIT，Copyright (c) 2026 rihebty），详见 [flow-kit](https://github.com/rihebty/flow-kit)。运行时依赖 Comet（MIT）与 Claude Code。
