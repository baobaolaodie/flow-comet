<div align="right">

[English](INSTALLATION.md) · [中文](INSTALLATION-zh.md)

</div>

# 安装

## 前置依赖

- [Claude Code](https://claude.ai/code)（已安装并认证，默认平台）
- [Codex](https://github.com/openai/codex) CLI（已安装——技能/规则/hook 支持见下文[平台](#平台)）
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）CLI `0.1.0-rc.6` 或更新（dsh 平台可选，见[方案 C](#方案-c--deepseek-harnessdsh-平台)）
- 目标项目已安装 [flow-kit](https://github.com/rihebty/flow-kit)——安装器会自动获取（锁定快照；已存在副本只读检测，见 [flow-kit 获取](#flow-kit-获取)）：

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
node scripts/prepare-env.mjs --target <目标项目绝对路径> --platform codex   # Codex
node scripts/prepare-env.mjs --target <目标项目绝对路径> --platform dsh     # DeepSeek Harness
node scripts/prepare-env.mjs --target <目标项目绝对路径> --platform claude-code,dsh   # 多平台，逗号分隔
node scripts/prepare-env.mjs --target <目标项目绝对路径> --platform all     # 全部平台
```

首次在交互终端运行会以方向键多选提示选择平台（方向键 + 空格勾选，回车确认；按目标项目既有痕迹预勾选——平台选择链见[平台](#平台)）：`@clack/prompts` 为主路径，依赖未安装/离线/stdin 无 raw mode 时自动回退 readline 数字/逗号多选；`FLOW_COMET_FORCE_READLINE=1` 测试钩子强制走回退。

`prepare-env` 会：

1. **生成/覆盖 `rules/` 与 `skills/`**——全部 flow-comet* skill，来源为权威源 `.comet/bundle-drafts/flow-comet/`
2. **注入 hook 到 `settings.local.json`**——读-合并-写：保留目标项目既有的一切（`permissions`、自定义 hook、其他 matcher 组），仅在 `hooks.PreToolUse` 中注入/更新 comet-hook-guard 条目（已存在的 comet hook 被替换而非重复追加——幂等）。**首次创建**（项目原本无此文件）只写入 hook 条目；**已有文件**按合并保留既有字段
3. **确保目标项目中的 `flow-kit`**——缺失时克隆上游并检出锁定快照；已存在的上游克隆只读检测（输出当前 HEAD 与锁定快照差异）；同名非克隆目录跳过并给出手动指引；网络失败仅告警并继续（见 [flow-kit 获取](#flow-kit-获取)）

**非破坏设计**：默认不删除目标项目安装根（Claude Code 为 `.claude/`，Codex 为 `.agents/`）下任何内容（`commands/`、自定义 skill、自定义配置全部保留）。显式 `--purge --yes` 才重置安装——删除生成物后重新生成到完整安装态（purge 是删除+重建，**不是卸载**）：Claude Code 上整删 `.claude/`；Codex 上只清 flow-comet 技能 + 托管 hook 条目 + AGENTS.md 托管区（`.agents/` 为多工具共享位置，用户条目保留）。打印删除清单 + 警告；`--yes` 为二次确认。

```bash
# 查看将覆盖的清单后确认（默认非破坏，安全）
node scripts/prepare-env.mjs --target <目标项目绝对路径>
# 破坏性重建（仅用于干净环境；需 --yes 二次确认）
node scripts/prepare-env.mjs --target <目标项目绝对路径> --purge --yes
```

**使用前提**：脚本必须在 flow-comet 仓库内运行（从 `.comet/bundle-drafts/flow-comet/` 读取安装内容）；`--target` 指向目标项目。

**更新已安装的 flow-comet**：重跑同一条方案 A 命令即可（幂等——覆盖生成物 + 合并注入 hook，既有配置保留）。

### flow-kit 获取

平台安装循环之前（平台无关，每次运行一次），`prepare-env` 会确保 `<目标项目>/flow-kit/` 就位：

- **缺失** → 安装器克隆上游并检出锁定快照 commit `9b5dda7`（上游无 tag，commit 是唯一精确锚；2026-08-23 实测与上游 HEAD 一致），随后打印带锁定短 SHA 的摘要。
- **已存在的上游克隆**（`.git` 存在且 `origin` remote URL 匹配 `github.com/rihebty/flow-kit`）→ 仅只读检测：比对当前 HEAD 与锁定快照并输出差异影响（安装器绝不在已有克隆上 fetch/checkout）。HEAD 一致则确认；不一致则告警 guard 段名基准与协议引用可能偏离锁定内容，并附手动对齐指引。
- **已存在的同名非克隆目录**（或 origin 无法确认归属）→ 跳过并给出手动指引（clone + checkout 命令）；绝不改动。
- **网络失败**（clone/checkout 出错）→ WARN + 手动获取指引（上游 URL + 目标路径）；安装继续且 exit 0——无 flow-kit 时 guard 段名基准回退内置 fallback、协议引用可能指向缺失文件，指引中如实说明。
- **purge 永不包含 `flow-kit`**（含 `--purge --yes`）：它不是本安装器的生成物域，由安装器首次创建的 flow-kit 在 purge 后残留属预期。

### hook 升级说明

注入的 hook 命令形态随版本演进：新版本经宿主的项目根变量引用守卫脚本，而非相对路径——会话工作目录漂移出项目根后拦截仍然命中。**重跑同一条方案 A 安装器命令即可原地升级托管 hook 条目**——安装器按条目指向的脚本识别托管条目、无论新旧形态一律替换为当前形态：不重复、不残留、无需手工清理旧配置。若经方案 B（手动复制）安装，请按上方第 3 步手工把条目更新为推荐命令形态。若工作目录漂移后越权写入不再被拦截（hook 日志出现 `Cannot find module ...comet-hook-guard`），即旧相对路径条目解析失效——处置同为重跑安装器；现象识别见[故障排查](TROUBLESHOOTING-zh.md)对应症状行。

> **fail-open 边界说明**：宿主把 hook 异常降级为 non-blocking 时，该次工具调用会被放行——flow-comet 无法改变宿主行为，只能消除崩溃本身。项目根引用自注入的项目根解析而非会话工作目录，守卫脚本恒可找到，`Cannot find module ...comet-hook-guard` 这一失效模式不再出现（此类崩溃概率归零）。

### 平台

安装器默认面向 **Claude Code**（行为不变）。目标平台按以下顺序确定：

1. **显式指定**：`--platform <claude-code|codex|dsh|claude-code,dsh|all>` 优先（无头/CI 兼容）。接受单平台、逗号分隔列表（按参数顺序安装）或 `all`（全部平台，按表格顺序）。未知平台报错（含逗号列表中的任一未知项——不得部分安装）。旧 `both` 已移除——`--platform both` 报错并提示改用逗号列表或 all。
2. **交互选择**：在交互式终端（有 TTY）运行且未指定 `--platform` 时，会以方向键多选提示（方向键 + 空格勾选，回车确认；`@clack/prompts` 为主路径）——依赖未安装/离线/stdin 无 raw mode 时自动回退 readline 数字/逗号多选（`FLOW_COMET_FORCE_READLINE=1` 测试钩子强制走回退）。Claude Code / Codex / dsh 按 `.claude/` / `.codex/` / `.dsh/` 痕迹预勾选；回车接受预勾选结果（兜底默认 Claude Code）。
3. **自动探测**：无 TTY（CI/脚本/管道）时按目标项目既有痕迹探测——仅 `.codex/` → Codex；仅 `.dsh/` → dsh；含 `.claude/` → Claude Code；**多痕迹并存 → 默认 Claude Code（主平台）并输出提示**（如需其它组合：交互终端运行多选，或显式 `--platform`）。
4. **默认兜底**：皆无痕迹 → Claude Code。

| 平台 | 技能 | 编排规则 | 写入守卫 hook |
|------|------|----------|---------------|
| Claude Code（默认） | `.claude/skills/`（不变） | `.claude/rules/`（自动加载） | `settings.local.json` → `hooks.PreToolUse`（文本输出，exit 2 拦截） |
| Codex | `.agents/skills/`（Codex 自动发现） | `AGENTS.md` 托管区（安装时内联；Codex 的 `rules/` 目录服务于命令批准策略，非指令文件） | `.codex/hooks.json`（matcher `*`——Codex PreToolUse 拦截 Bash 工具调用；经 `{"decision":"block"}` 拒绝） |
| dsh | `.dsh/skills/flow-comet`（dsh 以 rank 100 自动发现，免重启） | `AGENTS.md` 托管区（非破坏合并） | 全局桥接 loader——`$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` + `$DSH_HOME/cordis.patch.yml` 托管块（`tools/pre-execute` 拦截，所有 profile 生效） |

非默认平台上，SKILL/GUIDANCE 内的命令路径在安装时按平台实际技能位置重写（权威源保持 `.claude` 形态）。Codex 支持已完成端到端演练（Codex CLI 0.146.0 上 8 节点流程）；写入守卫 hook 拦截 Bash 写命令（PowerShell cmdlet、.NET File API、重定向）——命令级拦截覆盖主流模式，换写法可能绕过（Codex 平台限制）。dsh 平台在 `$DSH_HOME` 全局挂载薄桥接 loader（见[方案 C](#方案-c--deepseek-harnessdsh-平台)）——引擎零改动，guard 判定核心经子进程调用原样复用。

### 验证安装（无副作用，不创建 change）

1. **结构检查**：`<目标项目>/.claude/skills/` 下 `flow-comet*` skill 目录数量与 prepare-env 输出一致（当前 19 个）+ `rules/flow-comet-orchestration.md` + `settings.local.json` 均存在 + `skills/flow-comet/INSTALLED_VERSION`（随技能包分发的版本标识——`cat .claude/skills/flow-comet/INSTALLED_VERSION`；内容为基于的最近发布版本；prepare-env 安装且源仓库有 git 时更精确：`<发布版本>-<领先提交数>-g<hash>`）
2. **配置可加载性**：`settings.local.json` 是合法 JSON；`hooks.PreToolUse[].hooks[].command` 指向项目根变量绝对引用 `node %CLAUDE_PROJECT_DIR%\.claude\skills\flow-comet\scripts\comet-hook-guard.mjs`（POSIX 宿主：`node $CLAUDE_PROJECT_DIR/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs`）且 `<目标项目>/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs` 存在。Claude Code 运行 hook 时注入 `CLAUDE_PROJECT_DIR` = 项目根，路径自项目根解析而非会话工作目录——工作目录漂移出项目根后仍命中（与[hook 升级说明](#hook-升级说明)推荐的形态一致）
3. **一致性检查**（在 flow-comet 仓库内执行，strip 行尾后应无差异）：`diff -r --strip-trailing-cr .comet/bundle-drafts/flow-comet/rules <目标项目>/.claude/rules` 与 `.../skills`——**diff 无输出即通过**
4. **真实环境冒烟**（在目标项目目录内执行）：`cd <目标项目> && node .claude/skills/flow-comet/scripts/workflow-state.mjs status`——期望输出 JSON 状态对象（全新项目为 `{"status":"no-change",...}`，运行中为 `{"status":"running","change":...}`）

> 命令为 POSIX 风格（Git Bash / WSL / macOS 终端）；Windows 用户请在 Git Bash 中执行。
> **注意**：`guard-self-test.mjs`（206 场景）是**作者回归基线**（沙箱环境自测脚本逻辑——不依赖安装完整性，不是安装验证判据）。

### 在 Codex 上使用 flow-comet

实测于 Codex CLI 0.146.0——8 节点流程可完整跑通。

- **首次使用**：信任写入守卫 hook——交互会话运行 `/hooks` 信任 flow-comet hook 条目；脚本化自动化在 `codex exec` 传 `--dangerously-bypass-hook-trust`。
- **脚本化自动化**：`codex exec … </dev/null`——stdin 为管道时 Codex 会等待 stdin 关闭才开始（脚本/CI 驱动时加该重定向）。
- **执行模式**：execute 节点用 **direct** 模式（Codex 主代理直接实现；`execution-mode direct` 切换）。`subagent-execute` 节点把 `parallel="true"` 任务经 **git worktree** 委托（每任务一个 worktree：`git worktree add <路径> -b <分支>` → 在 worktree 内 `codex exec`，加载 flow-comet-dev 并回传 Return Contract → 校验 commitHash 后 `git worktree remove`）——worktree 隔离与 Claude Code 的委托语义一致；Codex CLI 无 `--worktree` 一键 flag（[openai/codex#12862](https://github.com/openai/codex/issues/12862) 跟踪中），由协调者显式管理 worktree。
- **Windows PowerShell 引号**：`node … '{"summary":"…"}'` 经 PowerShell 5.1 会丢失内嵌双引号——用 .NET `ProcessStartInfo`/`ArgumentList` 执行，或改用 Git Bash。
- **提交纪律**：工作流脚本校验产物而非 git 提交——execute 节点协议要求把任务标记 `status="done"` 并提交。
- **归档顺序**：`skill-load archive flow-comet-integration --prompt flow-kit/prompts/7-integration.md` 须在**复制归档目录之前**运行（声明标记随目录复制）。
- **中文工件写入（实测）**：会话 Bash 写中文经 PowerShell 管道可能损坏为字面 `?`（$OutputEncoding 编码）——用 Python 以 `encoding='utf-8'` 写文件、设置 `$OutputEncoding` 为 `[System.Text.Encoding]::UTF8`、或全 `\uXXXX` 转义规避；使用 `python` 的 `-c` 参数内嵌中文无损。
- **JSON 参数引号（实测）**：PowerShell 5.1 对原生命令传参剥离 JSON 内嵌双引号（handoff result / record 可能存成脏字符串）——用 `--json-file` 从文件读 JSON payload，或用 Git Bash 执行。
- **git 代操作（实测）**：codex 沙箱内 git 受限（init 分支创建失败、worktree 内无法自提交）——init 分支失败降级纯文件模式属预期；委托子代理的提交由协调者在沙箱外代操作，Return Contract 的 commitHash 仍可校验。
- **行首 `>` 误判（实测）**：hook 把命令行首 `>` 判为 shell 重定向（markdown 引用行被拦）——用 `>` 转义还原。

### 验证 Codex 安装

1. **结构检查**：`<目标项目>/.agents/skills/` 下 `flow-comet*` skill 目录（19 个）+ `AGENTS.md` 托管区（`grep "Managed by flow-comet" <目标项目>/AGENTS.md`）+ `.codex/hooks.json` 托管 hook 条目 + `<目标项目>/.agents/skills/flow-comet/INSTALLED_VERSION`
2. **命令路径已重写**：`grep -c "\.claude/skills/flow-comet/scripts/" <目标项目>/.agents/skills/flow-comet/SKILL.md` → 0；`grep -c "\.agents/skills/flow-comet/scripts/" <目标项目>/.agents/skills/flow-comet/SKILL.md` → 非 0
3. **hook 契约冒烟**（在目标项目内执行）：向守卫喂越权写入目标，期望 JSON block 决策——`echo '{"tool_name":"Write","tool_input":{"file_path":"src/evil.py"}}' | node .agents/skills/flow-comet/scripts/comet-hook-guard.mjs before_tool --platform codex` → `{"decision":"block",...}`
4. **冒烟测试**（在目标项目内执行）：`cd <目标项目> && node .agents/skills/flow-comet/scripts/workflow-state.mjs status` → JSON 状态对象

## 方案 B · 手动复制（兜底）

无法运行 prepare-env 时（面向 Claude Code；Codex 用户请优先方案 A——手动复制不执行平台路径替换）：

```bash
cd <flow-comet 仓库>
SKILLS=.comet/bundle-drafts/flow-comet/skills
TARGET=<目标项目绝对路径>

# 1. 复制全部 flow-comet* skill（含 GUIDANCE 与脚本）
cp -r $SKILLS/flow-comet* "$TARGET/.claude/skills/"

# 2. 复制编排规则
cp .comet/bundle-drafts/flow-comet/rules/flow-comet-orchestration.md "$TARGET/.claude/rules/"
```

**3. 注册 hook（手动）**：在目标项目 `.claude/settings.local.json` 的 `hooks` 中**合并**以下片段（保留既有内容，如 `permissions`）。命令经 Claude Code 的项目根变量引用守卫脚本（`CLAUDE_PROJECT_DIR`——hook 运行时宿主注入项目根；Windows 为 `%CLAUDE_PROJECT_DIR%`，POSIX 为 `$CLAUDE_PROJECT_DIR`），自项目根解析而非会话工作目录（即 `<目标项目>/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs`）：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node %CLAUDE_PROJECT_DIR%\\.claude\\skills\\flow-comet\\scripts\\comet-hook-guard.mjs"
          }
        ]
      }
    ]
  }
}
```

POSIX 宿主使用正斜杠命令形态：`node $CLAUDE_PROJECT_DIR/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs`。

> **升级说明**：以旧相对路径条目（`node .claude/skills/...`）安装的存量项目可原地升级——重跑方案 A 安装器即把旧条目替换为上面的项目根引用形态（托管条目按脚本名识别并覆盖，无需手工清理旧配置）。

**4. 运行状态**：`.comet/flow-comet-state.json` 由 `init`（或首个 `/flow-comet` 调用）自动创建。

## 方案 C · DeepSeek Harness（dsh）平台

DeepSeek Harness（dsh）经 **prepare-env 安装器**支持——与 Claude Code / Codex 同一入口，新增 dsh 平台描述符。无插件包、无 npm 包（npm 分发留后续 / 1.5.0）：

```bash
cd <flow-comet 仓库>
node scripts/prepare-env.mjs --target <目标项目绝对路径> --platform dsh
```

交互终端中 dsh 是多选选项之一（见[平台](#平台)）。

**最低 dsh 版本**：`0.1.0-rc.6`（dev preview；API 签名与技能发现 rank 可能变化——低于锚定版本时拦截可能静默失效）。

### 安装内容

1. **项目级技能树**——`<项目>/.dsh/skills/flow-comet`（含路径替换 `.claude/skills/flow-comet/scripts/` → `.dsh/skills/flow-comet/scripts/`（仅 `.md` 文件）与 `INSTALLED_VERSION` 版本标识）。dsh 经文件监听在 `<项目>/.dsh/skills/` 下以 **rank 100** 自动发现——免重启，且**未安装该目录的项目不可见该技能**，因此激活天然是项目级的（无运行时痕迹判定、无 chicken-and-egg）。
2. **AGENTS.md 托管区**——把编排规则注入 `<项目>/AGENTS.md` 的托管区（`<!-- Managed by flow-comet prepare-env -->` … `<!-- /Managed by flow-comet prepare-env -->`），非破坏合并——托管区外的用户内容保留。标记与 Codex 平台共用，任一平台的移除流程均可清理该区——卸载时仅在无其它平台仍使用该共用标记时才移除。
3. **全局桥接 loader**——在 `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` 挂载薄 loader，并在 `$DSH_HOME/cordis.patch.yml` 注入托管块（读-合并-写——保留 dsh-skin 等既有块；home patch 对所有 profile 生效）。loader 监听 dsh 原生 `tools/pre-execute` waterfall 事件，把工具参数映射到 guard 契约（`Write`/`Edit` → `file_path`，`Bash` → `command`），子进程调用项目本地 `comet-hook-guard.mjs`，流程运行中越权写入返回 `{kind:'deny', reason}`（BLOCK 消息 + 恢复指引）。仅当会话项目根含 `.dsh/skills/flow-comet` 时才处理（窄监听——非 flow-comet 项目零拦截）。参数形状不符与异常退出 fail-closed。写入包含性仅流程运行中生效：空闲态（无 state / 无 `activeChange` / `completed`）项目根外写放行；解析失败 / 未知状态保持 fail-closed。

> **注意——安装器会写你的 home 目录**：挂载桥接 loader 需写入 `$DSH_HOME`（默认 `~/.dsh`；解析：`$DSH_HOME` 环境变量 > `~/.dsh`）。这是设计内且**非破坏**的：`cordis.patch.yml` 读-合并-写（dsh-skin 等既有块保留；文件无法解析时安全报错退出而非覆盖），loader 文件按名添加/移除。恢复方式见下方 purge——只移除托管块与 loader 文件，其余全部保留。

### loader 版本治理

桥接 loader 携带内嵌版本戳（`scripts/dsh-bridge.mjs` 中的 `// BRIDGE_VERSION: <version>`）。每次 dsh 安装时，安装器从权威源 loader 与已安装 loader（如有）各提取一次版本戳，在覆盖前输出迁移结论：首次安装 / **升级 `A → B`** / **降级 `A → B`** / **版本一致**。该版本戳也是下方 `bridge-check` 的契约锚点。

### bridge-check（只读自检）

`workflow-state.mjs bridge-check`（各安装副本技能路径下可用）执行严格只读的 dsh 桥接健康检查——零写入、零网络。共六种判定态：

| 判定态 | 含义 | 退出码 |
|--------|------|--------|
| 健康 | loader 已安装且按 insert 形态挂载、引用的 `file://` 目标可达、无重复注册、loader 版本戳与项目 `INSTALLED_VERSION` 一致 | 0 |
| 文件缺失 | `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` 不存在 | 1 |
| 未挂载 | `$DSH_HOME/cordis.patch.yml` 无托管块（或 patch 文件不存在），或托管块形态错误（如 id-targeted 而非 insert） | 1 |
| 版本偏斜 | loader `BRIDGE_VERSION` 与项目 `INSTALLED_VERSION` 不一致 | 1 |
| 重复注册 | patch 文件在托管块外另有 `dsh-flow-comet-bridge` 注册行 | 1 |
| 不适用 | 项目根无 `.dsh/skills/flow-comet`（未安装 dsh 平台副本）——其余检查全部跳过 | 0 |

无法识别的 YAML 形态输出近似性声明告警（只告警不定论——绝不误杀）；只有明确失配才强制非零退出。

```bash
# 在目标项目内执行（dsh 安装形态）
node .dsh/skills/flow-comet/scripts/workflow-state.mjs bridge-check
```

### 在 dsh 上使用 flow-comet

- **首次使用**：无需信任 hook 步骤——桥接 loader 是安装器挂载的全局插件；在目标项目启动 dsh 会话并按名调用技能即可（rank 100 自动发现）。桥接仅当会话项目根含 `.dsh/skills/flow-comet` 时拦截——未安装项目零侵入。拦截仅流程运行中生效——空闲态（无 state / 无 `activeChange` / `completed`）项目根外写放行；解析失败 / 未知状态保持 fail-closed。
- **版本锚定**：dsh `0.1.0-rc.6` 为实测最低版本；低于它技能发现或拦截可能静默失效——请升级 dsh。
- **子代理执行**：被委托的子代理（以会话的子代理委托深度识别）作为执行者可写入源码——与其他平台 worktree 隔离语义一致；协调者仍受阶段写白名单约束。越界写入与参数形状不符对两者一律拒绝。子代理工具随 dsh 自带，全 profile 可用。
- **Windows**：包含性校验前先展开 8.3 短路径（项目内短路径不会被误判为越界）；判定前把项目根规范化为长形态，短形态项目根与规范化的写入目标不会错位成 fail-open。

### 验证 dsh 安装

1. **结构检查**：`<目标项目>/.dsh/skills/` 下存在 `flow-comet` 技能目录 + `AGENTS.md` 托管区（`grep "Managed by flow-comet" <目标项目>/AGENTS.md`）+ `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` + `$DSH_HOME/cordis.patch.yml` 托管块 + `<目标项目>/.dsh/skills/flow-comet/INSTALLED_VERSION`
2. **命令路径已重写**：`grep -c "\.claude/skills/flow-comet/scripts/" <目标项目>/.dsh/skills/flow-comet/SKILL.md` → 0；`grep -c "\.dsh/skills/flow-comet/scripts/" <目标项目>/.dsh/skills/flow-comet/SKILL.md` → 非零
3. **真实环境冒烟**（在目标项目目录内执行）：`cd <目标项目> && node .dsh/skills/flow-comet/scripts/workflow-state.mjs status`——期望输出 JSON 状态对象
4. **桥接健康（可选）**：`cd <目标项目> && node .dsh/skills/flow-comet/scripts/workflow-state.mjs bridge-check`——正确安装的 dsh 项目应为 `健康`（exit 0），未安装 dsh 平台副本的项目为 `不适用`（exit 0）

### 重置/重新生成（purge——不是卸载）

```bash
node scripts/prepare-env.mjs --target <目标项目绝对路径> --purge --platform dsh --yes
```

`--purge` 会**先删除生成物、随后重新生成**——purge 后 flow-comet **仍完整安装**（技能重新生成、AGENTS.md 托管区重新注入、全局桥接 loader 重新挂载）。purge 是用于干净重装的删除+重建式重置，**不是卸载**。

重置过程中会移除以下生成物（随后重新生成）：

- `<项目>/.dsh/skills/` 下 `flow-comet*` 条目（非 flow-comet 条目保留；空 `.dsh` 目录移除）
- AGENTS.md 托管区（文件与用户内容保留；仅在无其它平台仍使用该共用标记时移除）
- `$DSH_HOME/cordis.patch.yml` 托管块（dsh-skin 等既有块保留；移除后文件为空则删除文件本身）与 `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` loader 文件（仅在无其它 flow-comet 项目使用 dsh 时移除——loader 与 home patch 为全局产物）

**真实卸载需手动**（purge 不是卸载途径）：

```bash
# 1. 删除项目级技能树
rm -rf <目标项目>/.dsh/skills/flow-comet*

# 2. 删除 AGENTS.md 托管区
#    （只删除 `<!-- Managed by flow-comet prepare-env -->` … `<!-- /Managed by flow-comet prepare-env -->` 块，
#      文件其余内容全部保留）

# 3. 删除全局桥接 loader 与 home patch 托管块
#    （删除 $DSH_HOME/cordis.patch.yml 中的 `# --- flow-comet managed ---` … `# --- end flow-comet managed ---` 块，
#      以及 $DSH_HOME/plugins/dsh-flow-comet-bridge.mjs 文件）
```

**多项目语义**：每项目独立安装技能树（未安装该技能的项目不可见）；桥接 loader 全局一份，服务多个 flow-comet 项目（按会话项目判定——与 Claude Code 项目级 hook 等价）。

## 分支命名本地适配

引擎缺省把工作流分支建为 `change/<id>`。项目有本地分支规范时，在初始化 change 时传入自定义前缀：

```bash
cd <目标项目>
node .claude/skills/flow-comet/scripts/workflow-state.mjs init <id> --branch-prefix feat/
```

Codex 上同一 init 针对 `.agents/skills/flow-comet/scripts/workflow-state.mjs`，dsh 上针对 `.dsh/skills/flow-comet/scripts/workflow-state.mjs`（路径在安装时重写——见[平台](#平台)）。前缀缺尾部 `/` 时自动补全，`--branch-prefix feat` 与 `--branch-prefix feat/` 等价。

分支/状态一致性检查（`status`/`next`）会把当前分支与 activeChange 比对，不一致时输出一条 `WARN:`。该警告是**非阻断提示**而非错误——流程照常运行。消除方式是检出期望分支（`git checkout <prefix><activeChange>`）；完整现象表见[故障排查](TROUBLESHOOTING-zh.md)。工作流运行后的分支日常行为（自动创建、归档收尾、合并回主分支）见[使用](USAGE-zh.md)。

## 卸载

从目标项目移除 flow-comet（Claude Code / Codex 见下；DeepSeek Harness（dsh）见[方案 C](#方案-c--deepseek-harnessdsh-平台)的手动卸载步骤）：

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
