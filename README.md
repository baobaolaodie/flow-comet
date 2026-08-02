# flow-comet

**flow-kit 9 阶段工作流的 Comet `workflow-kernel` 实现** —— 面向 **Claude Code** 平台的开发工作流框架。

flow-comet 用 [Comet](https://github.com/rpamis/comet) 的 workflow-kernel 机制实现 [flow-kit](https://github.com/rihebty/flow-kit) 的 9 阶段流程（CHANGE → REQUIREMENT → DESIGN → [UI-DESIGN] → TASK → DEV → TEST → REVIEW → INTEGRATION → ARCHIVE），用脚本自动化替代 flow-kit 的手动状态维护，同时保留 `.specs/` 文档体系。

> **⚠️ 平台适配**：本项目**适配 Claude Code**（Claude Code skill 体系、`claude` CLI、`.claude/` 安装位置）。**不保证适配其他平台**（Codex / Gemini / Cursor 等）。分发到其他平台前需自行验证兼容性。

---

## 特性

- **8 节点自动路由**：`open → design → plan → execute → subagent-execute → review → verify → archive`，脚本读 TASK.md 工件自动检测状态并路由
- **自有状态机**：`.comet/flow-comet-state.json`（独立于 comet classic 的 `current-change.json`；本框架不与 comet classic 状态互相干扰）
- **节点门禁**：`workflow-guard.mjs` 强制上游工件存在 + 下游产物完整 + evidence/artifact 校验
- **evidence 自动化**：`record` 传 summary 即可，`exit` 自动补 completedChecks + 状态漂移自动校正
- **express 路径**：低风险 change（CHANGE.md 标 `express: true`）自动降级 review（仅 Round 1+1.5）与 TEST/UAT（最小矩阵）
- **并行执行**：`subagent-execute` 按 wave 委托并行任务，guard 自动校验 wave 内 write_files 无冲突
- **契约核对**：`contract-check.mjs` 提取前后端枚举/校验供 review 比对
- **流程安全**：完整继承 flow-kit 的 R1-R8 规则（TDD / LESSONS 扫描 / diff 边界 / 角色红线）

## 依赖

| 依赖 | 用途 | 许可 | 获取 |
|---|---|---|---|
| [Comet](https://github.com/rpamis/comet) | workflow-kernel 运行时 + `comet bundle` 生命周期 | MIT | npm 全局安装 |
| [flow-kit](https://github.com/rihebty/flow-kit) | 9 阶段协议（prompts/templates/reference），**外部依赖** | MIT（© 2026 rihebty） | clone 到目标项目根 `flow-kit/` |

> flow-kit 是独立开源项目，不随本仓库分发。目标项目使用 flow-comet 前需先安装 flow-kit。
> **Claude Code** 是运行时环境（skill 执行），需已安装并认证。

## 安装（适配 Claude Code）

### 1. 准备目标项目（Claude Code 项目）

```bash
# 目标项目根目录安装 flow-kit（外部依赖）
git clone https://github.com/rihebty/flow-kit.git flow-kit
```

### 2. 分发 flow-comet（从本仓库，平台=claude）

```bash
comet bundle compile flow-comet --platform claude   # 验证可编译
comet bundle distribute flow-comet --platform claude --scope project   # 安装到目标项目 .claude/skills/
```

目标项目需：
- 已安装 Comet CLI + Claude Code
- 根目录有 `flow-kit/`（见步骤 1）
- 有 `.specs/` 工件体系
- `.gitignore` 处理 `.claude/` / `.comet/`（如需版本化）

## 使用（Claude Code 项目）

在目标项目输入 `/flow-comet` 启动。首次调用自动检测活跃 change 或初始化新 change。

## 架构说明

```
┌─────────────────────────────────────────────────────────┐
│ flow-comet（本仓库）                                      │
│  ├─ .comet/bundle-drafts/   ★ 权威源（16 skills + scripts）│
│  ├─ .comet/bundles/         已发布 bundle（可 distribute） │
│  └─ 运行时（安装到目标项目）                               │
│      ├─ .claude/skills/flow-comet*   （skill 实现）        │
│      ├─ .claude/rules/                （编排规则）          │
│      └─ .comet/flow-comet-state.json  （自有状态机）       │
└─────────────────────────────────────────────────────────┘
```

- **状态机**：flow-comet 用 `.comet/flow-comet-state.json`（activeChange/currentNode/evidence），独立于 comet classic 的 `current-change.json`
- **hooks**：仅安装 `flow-comet-hook-guard`（路径安全守卫）；**不安装** comet 的 `comet-hook-router`（它是 classic 专用，与 workflow-kernel 不兼容，会阻断写入）

## 限制与已知问题

- **仅 Claude Code 平台**：非 Claude Code 环境不保证可用
- **comet eval 需 API key**：`authoring-skill-smoke` 在 Docker 内跑 Claude，需 `ANTHROPIC_API_KEY`；`workflow-route-conformance` 为纯结构检查（无需）
- **eval-record 桥接**：`draftHash`/`evalManifestHash` 需手动构建 result.json（schemaVersion 2），无自动桥接
- **与 comet classic 关系**：本框架是 workflow-kernel（非 classic/native），不与 comet classic 状态互通（GAP-7 设计）

## 仓库结构

```
├── .comet/
│   ├── bundle-authoring/flow-comet.json   # bundle 元数据（draftPath/currentHash/eval/review）
│   ├── bundle-drafts/flow-comet/          # ★ 权威源（16 skills + rules + hooks）
│   ├── bundles/flow-comet/                # 已发布 bundle（可 distribute）
│   └── config.yaml
├── VERIFICATION.md                        # 分发验证记录
└── LICENSE                                # MIT
```

> 修改 skill/脚本请改 `.comet/bundle-drafts/flow-comet/skills/`，然后 `comet bundle compile` 验证、`publish` 更新发布产物。

## 许可

[MIT](LICENSE) © 2026 baobaolaodie

flow-comet 依赖外部项目 flow-kit（MIT，Copyright (c) 2026 rihebty），详见 [flow-kit](https://github.com/rihebty/flow-kit)。运行时依赖 Comet（MIT）与 Claude Code。
