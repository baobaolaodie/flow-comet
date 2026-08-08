<div align="right">

[English](INSTALLATION.md) · [中文](INSTALLATION-zh.md)

</div>

# 安装

## 前置依赖

- [Claude Code](https://claude.ai/code)（已安装并认证）
- 目标项目已安装 [flow-kit](https://github.com/rihebty/flow-kit)：

```bash
cd <目标项目>
git clone https://github.com/rihebty/flow-kit.git flow-kit
```

验证 flow-kit：`ls <目标项目>/flow-kit/templates/` 应列出工件模板文件（CHANGE.md / REQUIREMENT.md 等）。

## 方案 A · prepare-env 安装器（推荐）

从本仓库自动化安装（无需 Comet CLI）：

```bash
cd <flow-comet 仓库>
node scripts/prepare-env.mjs --target <目标项目绝对路径>
```

`prepare-env` 会：

1. **生成/覆盖 `rules/` 与 `skills/`**——全部 flow-comet* skill，来源为权威源 `.comet/bundle-drafts/flow-comet/`
2. **注入 hook 到 `settings.local.json`**——读-合并-写：保留目标项目既有的一切（`permissions`、自定义 hook、其他 matcher 组），仅在 `hooks.PreToolUse` 中注入/更新 comet-hook-guard 条目（已存在的 comet hook 被替换而非重复追加——幂等）。**首次创建**（项目原本无此文件）只写入 hook 条目；**已有文件**按合并保留既有字段

**非破坏设计**：默认不删除目标项目 `.claude/` 下任何内容（`commands/`、自定义 skill、自定义配置全部保留）。显式 `--purge --yes` 才会删除整个 `.claude/` 后重建（打印删除清单 + 警告；`--yes` 为二次确认）。

```bash
# 查看将覆盖的清单后确认（默认非破坏，安全）
node scripts/prepare-env.mjs --target <目标项目绝对路径>
# 破坏性重建（仅用于干净环境；需 --yes 二次确认）
node scripts/prepare-env.mjs --target <目标项目绝对路径> --purge --yes
```

**使用前提**：脚本必须在 flow-comet 仓库内运行（从 `.comet/bundle-drafts/flow-comet/` 读取安装内容）；`--target` 指向目标项目。

**更新已安装的 flow-comet**：重跑同一条方案 A 命令即可（幂等——覆盖生成物 + 合并注入 hook，既有配置保留）。

### 验证安装（无副作用，不创建 change）

1. **结构检查**：`<目标项目>/.claude/skills/` 下 `flow-comet*` skill 目录数量与 prepare-env 输出一致（当前 19 个）+ `rules/flow-comet-orchestration.md` + `settings.local.json` 均存在
2. **配置可加载性**：`settings.local.json` 是合法 JSON；`hooks.PreToolUse[].command` 指向 `node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs` 且该文件存在
3. **一致性检查**（在 flow-comet 仓库内执行，strip 行尾后应无差异）：`diff -r --strip-trailing-cr .comet/bundle-drafts/flow-comet/rules <目标项目>/.claude/rules` 与 `.../skills`——**diff 无输出即通过**
4. **真实环境冒烟**（在目标项目目录内执行）：`cd <目标项目> && node .claude/skills/flow-comet/scripts/workflow-state.mjs status`——期望输出 JSON 状态对象（全新项目为 `{"status":"no-change",...}`，运行中为 `{"status":"running","change":...}`）

> 命令为 POSIX 风格（Git Bash / WSL / macOS 终端）；Windows 用户请在 Git Bash 中执行。
> **注意**：`guard-self-test.mjs`（74 场景）是**作者回归基线**（沙箱环境自测脚本逻辑——不依赖安装完整性，不是安装验证判据）。

## 方案 B · 手动复制（兜底）

无法运行 prepare-env 时：

```bash
cd <flow-comet 仓库>
SKILLS=.comet/bundle-drafts/flow-comet/skills
TARGET=<目标项目绝对路径>

# 1. 复制全部 flow-comet* skill（含 GUIDANCE 与脚本）
cp -r $SKILLS/flow-comet* "$TARGET/.claude/skills/"

# 2. 复制编排规则
cp .comet/bundle-drafts/flow-comet/rules/flow-comet-orchestration.md "$TARGET/.claude/rules/"
```

**3. 注册 hook（手动）**：在目标项目 `.claude/settings.local.json` 的 `hooks` 中**合并**以下片段（保留既有内容，如 `permissions`）。hook command 的相对路径**相对于 Claude Code 的项目根**解析（即 `<目标项目>/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs`）：

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

**4. 运行状态**：`.comet/flow-comet-state.json` 由 `init`（或首个 `/flow-comet` 调用）自动创建。

## 与 Comet 集成（仅当目标项目也使用 Comet 时适用）

> **适用条件**：以下定制只针对**已运行过 `comet init` 的目标项目**（其 CLAUDE.md 存在 `<comet-ambient-resume>` 块）。未使用 Comet 的项目**跳过本段**——flow-comet 不依赖 Comet，有自己的状态机与文件推导恢复。

flow-comet 会把 `comet init` 注入的 `<comet-ambient-resume>` 块定制为 flow-comet 优先路由（否则恢复流程只跑 Comet 标准探针，不会路由到 `/flow-comet`）：

1. 若目标项目已运行过 `comet init`，把该块替换为 flow-comet 优先版本（已安装 flow-comet 时路由到 `/flow-comet`，否则回退标准探针）。
2. **注意**：块头保留 `Managed by Comet` 标记——重跑 `comet init`/`comet update` 会覆盖回标准内容，需重新应用本定制。
3. 若目标项目从未运行 `comet init`，本定制可选（flow-comet 不依赖 resume-probe，有自己的状态机 + determineNode 文件推导恢复）。
