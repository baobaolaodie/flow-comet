<div align="right">

[English](INSTALLATION.md) · [中文](INSTALLATION-zh.md)

</div>

# 安装

## 前置依赖

- [Claude Code](https://claude.ai/code)（已安装并认证，默认平台）
- [Codex](https://github.com/openai/codex) CLI（已安装，实验性平台——技能/规则/hook 支持见下文[平台](#平台)）
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
node scripts/prepare-env.mjs --target <目标项目绝对路径>          # Claude Code（默认）
node scripts/prepare-env.mjs --target <目标项目绝对路径> --platform codex   # Codex（实验性）
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

### 平台

安装器默认面向 **Claude Code**（行为不变）。目标平台按以下顺序确定：显式 `--platform <claude-code|codex>` 优先；否则在交互式终端（TTY）提示选择；非交互环境（CI/脚本）探测目标项目既有 `.codex/` 或 `.claude/`，均无则默认 Claude Code。

| 平台 | 技能 | 编排规则 | 写入守卫 hook |
|------|------|----------|---------------|
| Claude Code（默认） | `.claude/skills/`（不变） | `.claude/rules/`（自动加载） | `settings.local.json` → `hooks.PreToolUse`（文本输出，exit 2 拦截） |
| Codex（实验性） | `.agents/skills/`（Codex 自动发现） | `AGENTS.md` 托管区（安装时内联；Codex 的 `rules/` 目录服务于命令批准策略，非指令文件） | `.codex/hooks.json`（matcher `apply_patch`；JSON 契约——拦截 `{"decision":"block"}` / 放行 `{}`） |

非默认平台上，SKILL/GUIDANCE 内的命令路径在安装时按平台实际技能位置重写（权威源保持 `.claude` 形态）。Codex 支持为实验性：8 节点流程尚未在 Codex 上完成端到端演练。

### 验证安装（无副作用，不创建 change）

1. **结构检查**：`<目标项目>/.claude/skills/` 下 `flow-comet*` skill 目录数量与 prepare-env 输出一致（当前 19 个）+ `rules/flow-comet-orchestration.md` + `settings.local.json` 均存在 + `skills/flow-comet/INSTALLED_VERSION`（随技能包分发的版本标识——`cat .claude/skills/flow-comet/INSTALLED_VERSION`；内容为基于的最近发布版本；prepare-env 安装且源仓库有 git 时更精确：`<发布版本>-<领先提交数>-g<hash>`）
2. **配置可加载性**：`settings.local.json` 是合法 JSON；`hooks.PreToolUse[].command` 指向 `node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs` 且该文件存在
3. **一致性检查**（在 flow-comet 仓库内执行，strip 行尾后应无差异）：`diff -r --strip-trailing-cr .comet/bundle-drafts/flow-comet/rules <目标项目>/.claude/rules` 与 `.../skills`——**diff 无输出即通过**
4. **真实环境冒烟**（在目标项目目录内执行）：`cd <目标项目> && node .claude/skills/flow-comet/scripts/workflow-state.mjs status`——期望输出 JSON 状态对象（全新项目为 `{"status":"no-change",...}`，运行中为 `{"status":"running","change":...}`）

> 命令为 POSIX 风格（Git Bash / WSL / macOS 终端）；Windows 用户请在 Git Bash 中执行。
> **注意**：`guard-self-test.mjs`（114 场景）是**作者回归基线**（沙箱环境自测脚本逻辑——不依赖安装完整性，不是安装验证判据）。

### 验证 Codex 安装（实验性）

1. **结构检查**：`<目标项目>/.agents/skills/` 下 `flow-comet*` skill 目录（19 个）+ `AGENTS.md` 托管区（`grep "Managed by flow-comet" <目标项目>/AGENTS.md`）+ `.codex/hooks.json` 托管 hook 条目 + `<目标项目>/.agents/skills/flow-comet/INSTALLED_VERSION`
2. **命令路径已重写**：`grep -c "\.claude/skills/flow-comet/scripts/" <目标项目>/.agents/skills/flow-comet/SKILL.md` → 0；`grep -c "\.agents/skills/flow-comet/scripts/" <目标项目>/.agents/skills/flow-comet/SKILL.md` → 非 0
3. **hook 契约冒烟**（在目标项目内执行）：向守卫喂越权写入目标，期望 JSON block 决策——`echo '{"tool_name":"Write","tool_input":{"file_path":"src/evil.py"}}' | node .agents/skills/flow-comet/scripts/comet-hook-guard.mjs before_tool --platform codex` → `{"decision":"block",...}`
4. **冒烟测试**（在目标项目内执行）：`cd <目标项目> && node .agents/skills/flow-comet/scripts/workflow-state.mjs status` → JSON 状态对象

> **注意**：Codex 支持为实验性——实测（Codex CLI 0.146.0）：技能自动发现、AGENTS.md 加载、工作流脚本可用；写入守卫 hook **不拦截** Codex 写入（Codex 写路径——PowerShell/exec 或 apply_patch——不向 PreToolUse 暴露 `file_path`），物理防线在 Codex 下缺失，纪律依赖协调者禁令与退出检测。hook 条目仍注入（未来版本兼容）。

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

## 卸载

从目标项目移除 flow-comet：

```bash
# 1. 删除 skill 目录与编排规则
rm -rf <目标项目>/.claude/skills/flow-comet*
rm <目标项目>/.claude/rules/flow-comet-orchestration.md

# 2. 从 .claude/settings.local.json 移除 hook 条目
#    （只删除 command 引用 comet-hook-guard.mjs 的 PreToolUse 条目，
#      其余内容如 permissions、自定义 hook、其他 matcher 组全部保留）

# 3. 可选：清理运行状态与流程工件
rm <目标项目>/.comet/flow-comet-state.json
rm -rf <目标项目>/.specs/          # 仅当不再需要流程工件时
```

## 与 Comet 集成（仅当目标项目也使用 Comet 时适用）

> **适用条件**：以下定制只针对**已运行过 `comet init` 的目标项目**（其 CLAUDE.md 存在 `<comet-ambient-resume>` 块）。未使用 Comet 的项目**跳过本段**——flow-comet 不依赖 Comet，有自己的状态机与文件推导恢复。
> 
> 模板语言随目标项目主语言（此处为中文示例）。复制以下内容替换目标项目的 CLAUDE.md 中的 `<comet-ambient-resume>` 块：
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

flow-comet 会把 `comet init` 注入的 `<comet-ambient-resume>` 块定制为 flow-comet 优先路由（否则恢复流程只跑 Comet 标准探针，不会路由到 `/flow-comet`）：

1. 若目标项目已运行过 `comet init`，把该块替换为 flow-comet 优先版本（已安装 flow-comet 时路由到 `/flow-comet`，否则回退标准探针）。
2. **注意**：块头保留 `Managed by Comet` 标记——重跑 `comet init`/`comet update` 会覆盖回标准内容，需重新应用本定制。
3. 若目标项目从未运行 `comet init`，本定制可选（flow-comet 不依赖 resume-probe，有自己的状态机 + determineNode 文件推导恢复）。
