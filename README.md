# flow-comet

flow-kit 9 阶段工作流的 [Comet](https://github.com/rpamis/comet) `workflow-kernel` 实现。用 Comet 的脚本自动化替代 flow-kit 的手动状态维护，同时保留 `.specs/` 文档体系。

```
CHANGE → REQUIREMENT → DESIGN → [UI-DESIGN] → TASK → DEV → TEST → REVIEW → INTEGRATION → ARCHIVE
```

## 特性

- **9 阶段节点路由**：`open → design → plan → execute → subagent-execute → review → verify → archive`，脚本自动检测状态并路由
- **状态自动管理**：`.comet/flow-comet-state.json`（替代手动 STATE.md）
- **节点门禁**：`workflow-guard.mjs` 强制上游工件存在 + 下游产物完整
- **并行执行**：`subagent-execute` 支持 wave 内并行任务委托（worktree 或主工作区退化）
- **TDD / LESSONS / diff 边界**：完整继承 flow-kit 的 R1-R8 规则与 LESSONS 知识库

## 依赖

| 依赖 | 用途 | 许可 | 获取 |
|---|---|---|---|
| [Comet](https://github.com/rpamis/comet) | workflow-kernel 运行时 + `comet bundle` 生命周期 | MIT（© 2026 rpamis） | npm 安装 |
| [flow-kit](https://github.com/rihebty/flow-kit) | 9 阶段协议（prompts/templates/reference），**外部依赖** | MIT（© 2026 rihebty） | clone 到目标项目根 `flow-kit/` |

> flow-kit 是独立开源项目，不随本仓库分发。目标项目使用 flow-comet 前需先安装 flow-kit。

## 安装

### 1. 准备目标项目

```bash
# 目标项目根目录安装 flow-kit（外部依赖）
git clone https://github.com/rihebty/flow-kit.git flow-kit
```

### 2. 分发 flow-comet

```bash
# 在本仓库根目录
comet bundle compile flow-comet --platform claude   # 验证可编译
comet bundle distribute flow-comet --platform claude --scope project   # 安装到目标项目 .claude/skills/
```

目标项目需：
- 已安装 Comet CLI
- 根目录有 `flow-kit/`（见步骤 1）
- `.gitignore` 处理 `.claude/` / `.comet/`（如需版本化）

## 使用

在目标项目输入 `/flow-comet` 启动。首次调用自动检测活跃 change 或初始化新 change。

## 仓库结构

```
└── .comet/
    ├── bundle-authoring/flow-comet.json   # bundle 元数据（draftPath/currentHash/eval/review）
    ├── bundle-drafts/flow-comet/          # ★ 权威源（contentDrafts：16 skills + rules + hooks）
    ├── bundles/flow-comet/                # 已发布 bundle（16 skills，可 distribute）
    └── config.yaml
```

> 修改 skill/脚本请改 `.comet/bundle-drafts/flow-comet/skills/`，然后 `comet bundle compile` 验证、`publish` 更新发布产物。

## 许可

[MIT](LICENSE) © 2026 baobaolaodie

flow-comet 依赖外部项目 flow-kit（MIT，Copyright (c) 2026 rihebty），详见 [flow-kit](https://github.com/rihebty/flow-kit)。
