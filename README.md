# flow-comet

**flow-kit 9 阶段工作流的 Comet `workflow-kernel` 实现** —— 面向 Claude Code 平台的开发工作流框架。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## About

flow-comet 解决的问题：flow-kit 的 9 阶段开发流程（CHANGE → REQUIREMENT → DESIGN → TASK → DEV → TEST → REVIEW → INTEGRATION → ARCHIVE）依赖手动维护状态和人工纪律。flow-comet 用 Comet 的 workflow-kernel 机制把这些流程**自动化为可验证的确定状态机**——脚本控制阶段推进、guard 校验产物质量、hook 拦截跨阶段写入，同时保留 flow-kit 的 `.specs/` 文档体系和 R1-R8 规则。

与 [Comet Classic](https://github.com/rpamis/comet)（OpenSpec + Superpowers 双星）不同，flow-comet 是独立的 workflow-kernel，不依赖 OpenSpec 或 Superpowers，状态不与 classic 互通。

> **平台适配**：本项目适配 Claude Code（skill 体系、`claude` CLI、`.claude/` 安装位置）。不保证适配其他平台（Codex / Gemini / Cursor 等）。

## Features

### 基础能力

- **8 节点自动路由**：`open → design → plan → execute → subagent-execute → review → verify → archive`，脚本读 TASK.md 工件自动检测状态并路由
- **自有状态机**：`.comet/flow-comet-state.json`，独立于 comet classic
- **evidence 自动化**：`record` 传 summary 即可，状态漂移自动校正
- **并行执行**：`subagent-execute` 按 wave 委托并行任务，依赖感知路由 + write_files 冲突检测
- **express 路径**：低风险 change 自动降级 review 与 TEST/UAT
- **横向命令**：`flow-comet-evolve`（架构沉淀）+ `flow-comet-health`（巡检）

### 硬约束层（吸收 Comet 机制）

基于真实项目全流程验证和 [Comet × flow-kit 扬弃分析](docs/flow-comet-sublation-spec.md)补强：

| 类别 | 机制 | 校验点 |
|------|------|--------|
| 状态机 | 转移门 | `exit` 校验 `currentNode === 被 exit 节点` + 前置 evidence |
| 产物质量 | 节点内容校验 | open 需 AC 段；design 需 §0 技术栈；plan 需 task 块+verify；review ≥ 100B |
| 产物质量 | SUMMARY 三段校验 | execute/subagent-execute 出口校验 verify 输出 / 6 维自查 / 越界检查 |
| 产物质量 | all-tasks-done | execute 出口检查 TASK.md 所有 task 为 done |
| 测试纪律 | verify 真实执行 | verify 出口真实跑 TEST.md `## 验证命令` 段（支持多行 `&&`） |
| 测试纪律 | verifyFailures 计数 | guard 自动递增，第 4 次 BLOCKED（无需 LLM 主动调用） |
| 子代理 | Return Contract | `{status, commitHash, redEvidence, greenEvidence, riskSignals}`，缺 hash/green 则 BLOCKED |
| 子代理 | handoff hash 溯源 | `git show` 校验提交文件 ⊆ writeFiles；未传 `--write-files` 时自动从 TASK.md 解析 |
| 写入控制 | phase 白名单 | hook guard 按 currentNode 控制文件写入权限（open/design 只允许 `.specs/`；execute 允许所有） |
| 审计 | brooks-lint 审计 | execute exit 检查 6 维自查是否声明 `/brooks-review`，未声明输出 WARN |
| 归档 | 交付闭环 | 单一 `chore: archive` commit + 显式路径 stage |

### 流程安全

完整继承 flow-kit 规则：TDD（RED→GREEN→REFACTOR）/ LESSONS 扫描 / diff 边界 / 角色红线 / 决策点四分类 / dirty-worktree 归属。

## Installation

### Requirements

- [Claude Code](https://claude.ai/code)（已安装并认证）
- [Comet CLI](https://github.com/rpamis/comet)（`npm install -g @rpamis/comet`）

### 1. 在目标项目安装 flow-kit

```bash
cd <目标项目>
git clone https://github.com/rihebty/flow-kit.git flow-kit
```

### 2. 分发 flow-comet 到目标项目

```bash
cd <本仓库>
comet bundle compile flow-comet --platform claude
comet publish distribute flow-comet --platform claude --scope project \
  --project <目标项目绝对路径> --confirm-executables
```

分发前可 `comet publish distribute flow-comet --preview` 检查将写入的文件。

### 3. 修改后的发布流程

```bash
# 修改 .comet/bundle-drafts/flow-comet/skills/ 后：
comet bundle compile flow-comet --platform claude
comet publish review flow-comet --platform claude
comet publish approve flow-comet --reviewer <reviewer>
comet publish run flow-comet --platform claude
comet publish distribute flow-comet --platform claude --scope project --project <目标> --confirm-executables
```

改动 skill/脚本会改变 bundle hash，必须重新 eval + publish + distribute。

## Usage

在目标项目输入 `/flow-comet` 启动。首次调用自动检测活跃 change 或初始化新 change。

## Examples

[docs/examples/schedule-venue-filter/](docs/examples/schedule-venue-filter/) —— 12 个工件覆盖 open→archive 全链路的完整产物示例，对照 flow-kit 模板质量标准。

## Documentation

| 文档 | 说明 |
|------|------|
| [扬弃规格](docs/flow-comet-sublation-spec.md) | Comet × flow-kit 七原则架构分析 + 改进决策 |
| [改进规格](docs/flow-comet-improvement-spec.md) | W1-W3 波次实现计划 |
| [产物示例](docs/examples/schedule-venue-filter/) | 全流程 12 个工件参考 |
| [验证记录](VERIFICATION.md) | 分发验证 |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ flow-comet（本仓库）                                      │
│  ├─ .comet/bundle-drafts/   ★ 权威源（16 skills + scripts）│
│  ├─ .comet/bundles/         已发布 bundle（可 distribute） │
│  ├─ docs/                   规格 / 示例 / 验证记录         │
│  └─ 运行时（安装到目标项目）                               │
│      ├─ .claude/skills/flow-comet*   （skill 实现）        │
│      ├─ .claude/rules/                （编排规则）          │
│      ├─ .claude/settings.local.json   （hook 注册）        │
│      └─ .comet/flow-comet-state.json  （自有状态机）       │
└─────────────────────────────────────────────────────────┘
```

- **状态机**：`.comet/flow-comet-state.json`（activeChange/currentNode/completedNodes/evidence/verifyFailures）
- **hooks**：`flow-comet-hook-guard` 按 phase 白名单控制文件写入权限 + 路径安全校验（防 symlink 逃逸）。**不安装** comet 的 `comet-hook-router`（classic 专用，与 workflow-kernel 不兼容）

## Limitations

- **仅 Claude Code 平台**：非 Claude Code 环境不保证可用
- **comet eval 需 API key**：容器内 eval 需 `ANTHROPIC_API_KEY`；无 key 时用手动桥接（`comet bundle eval-record`，详见 VERIFICATION.md）
- **Return Contract 过渡规则**：旧格式纯字符串 handoff 豁免为 WARN，避免已有 change 重入被卡死
- **与 comet classic 不互通**：workflow-kernel 状态独立于 classic（设计决策，非缺陷）
- **无活跃 change 时 hook 放行**：`.comet/flow-comet-state.json` 不存在时 hook guard 降级放行所有写入（设计决策：无 workflow 时不限制文件操作）

## Contributing

欢迎贡献。修改 skill/脚本请改 `.comet/bundle-drafts/flow-comet/skills/`（权威源），然后走发布流程（见 Installation 第 3 步）。

## License

[MIT](LICENSE) © 2026 baobaolaodie

flow-comet 依赖 [flow-kit](https://github.com/rihebty/flow-kit)（MIT）和 [Comet](https://github.com/rpamis/comet)（MIT）。
