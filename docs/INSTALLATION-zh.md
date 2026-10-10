# 安装

把 flow-comet 装进一个项目，使该项目里的 Claude Code / Codex / DeepSeek Harness 会话获得工作流技能、写入守卫 hook 与 flow-kit 工件模板。

## 前置条件

- **Node.js 18 或更高**（`node --version`）。
- **一个 agent 平台** —— Claude Code（默认）、Codex 或 DeepSeek Harness，任选其一；以后要装第二个，用不同的 `--platform` 重跑一次即可。
- **一个项目目录**。安装器只在该目录内写入（dsh 平台额外写 `$DSH_HOME` 的插件目录）。

flow-kit 由安装器自行获取：项目里已有的 `flow-kit/` 会被尊重，缺失的会被克隆并锁定，此后不再改动该目录。

## 方式 A · npm 包（推荐）

```bash
npm install -g flow-comet     # 1. 装 CLI（包名 flow-comet）
cd <你的项目>                  # 2. 进入要安装的项目
fcomet init                   # 3. 装进这个项目
```

包内提供同一安装器的两个命令名：`fcomet`（主）与 `flow-comet`（别名）。只要其它参数已表达意图，`init` 词元可省略——`fcomet --target <dir>` 等价于 `fcomet init --target <dir>`；`--target` 本身也可省略（缺省为当前目录）。**不带任何参数时，命令只打印用法并非零退出，不会安装。**

交互式终端首次运行会询问装哪个平台（方向键选择、空格切换、回车确认；默认 Claude Code）。非交互用 `--platform`：

```bash
fcomet init --platform claude-code
fcomet init --platform codex
fcomet init --platform dsh
fcomet init --platform claude-code,dsh     # 逗号组合
fcomet init --platform all                 # 三个平台一次装
```

**更新已装副本**：重跑同一条命令即可——生成物会被覆盖、hook 条目就地合并、项目里其它内容保持不变；它是幂等的（第二次运行后生成文件逐字节一致）。升级全局包（`npm install -g flow-comet`）只替换 CLI：项目里的副本要重跑 `fcomet init` 才会更新。

## 验证安装

```bash
fcomet --version                                    # 已安装的 CLI 版本
cat .claude/skills/flow-comet/INSTALLED_VERSION     # 写进本项目的版本标识
```

npm 安装时两者输出同一个值（该包对应的发布版本）。标识文件位于平台技能树内——`.claude/skills/flow-comet/INSTALLED_VERSION`、`.agents/skills/flow-comet/INSTALLED_VERSION` 或 `.dsh/skills/flow-comet/INSTALLED_VERSION`；从仓库 clone 安装时记录的是该 clone 的 `git describe` 值，clone 领先 tag 时会带 `-<n>-g<hash>` 后缀。

安装器应当产出的内容：

| 平台 | 技能树 | Hook / 桥接 | 额外产物 |
|---|---|---|---|
| Claude Code | `.claude/skills/`（19 个技能） | `.claude/settings.local.json` 中的一条 `PreToolUse` 条目，指向本项目技能树 | `.claude/rules/`（自动加载的编排说明） |
| Codex | `.agents/skills/`（19 个技能） | `.codex/hooks.json` 中的 `PreToolUse` 条目，以及 `.codex/config.toml` 里的 `hooks = true` | `AGENTS.md` 托管块 |
| DeepSeek Harness（dsh） | `.dsh/skills/`（19 个技能） | `$DSH_HOME/cordis.patch.yml` 托管块，指向复制到 `$DSH_HOME/plugins/` 的桥接 loader | `AGENTS.md` 托管块 |

三个平台都会同时得到 `flow-kit/`（模板与规则）以及一条管理 `.flow-comet/` 运行时目录的 `.gitignore` 条目。安装器是非破坏性的：项目里既有的内容不会被删除；已有的 `.gitignore` 保留原内容，只追加托管条目。「非破坏性」指的是你自己的内容：安装器会清理它自己上次生成、而当前技能包已不再包含的文件——仅限它安装在平台技能树下的 flow-comet 技能目录内，且归属无法判定时一律保留。

## 各平台首次使用

- **Claude Code** —— 会话要求时信任该项目工作区；无头会话需要预先接受该信任。项目 hook 随后随工作区一并受信。
- **Codex** —— 首次使用会要求你信任项目 hook（交互式 `/hooks` 流程）。脚本化或无头运行必须传平台的 hook 信任旁路开关，否则项目 hook 根本不会执行。
- **DeepSeek Harness（dsh）** —— 无 hook 信任步骤：桥接 loader 是安装器挂载的全局插件。在目标项目里启动会话并调用技能即可。

平台层行为（拦什么、边界在哪）见[核心机制](MECHANISM-zh.md)；按症状排查见[故障排查](TROUBLESHOOTING-zh.md)。

## 安装后移动项目

Codex 的 hook 命令写入的是**安装时项目的绝对路径**，因此项目被移动或改名后，hook 仍指向旧位置——在移动后的项目里重跑 `fcomet init` 即可改写。Claude Code 的 hook 通过平台自身的变量引用项目目录，没有这个问题；dsh 桥接是全局的，运行时再定位项目。

## 重置（purge）

`--purge --yes` 是**重置**：删除该平台的生成物后重建——是**删除并重建，不是卸载**。

```bash
fcomet init --purge --yes --platform claude-code
```

它会先打印警告与删除清单；`--yes` 是第二次确认，不加则什么都不删。删除范围按平台不同：

- **Claude Code** —— 整个 `.claude/` 被移除并重建，因此你放在那里的自定义内容要先移走。
- **Codex** —— 只删 `flow-comet*` 技能目录、托管 hook 条目与 `AGENTS.md` 托管块；`.agents/` 下的其它内容和你在 `AGENTS.md` 里写的内容都会保留（`.agents/` 与其它工具共享）。
- **DeepSeek Harness（dsh）** —— 项目侧技能树与托管块；`$DSH_HOME` 里的全局 loader 由安装器重写。
- **`flow-kit/` 永不被 purge 删除** —— 它不属于安装器的生成物范围，已有副本会保留。

## 方式 B · 从仓库 clone 直调安装器

用于开发 flow-comet 本身，或从源码检出安装：

```bash
git clone https://github.com/baobaolaodie/flow-comet
cd flow-comet
node scripts/prepare-env.mjs --target "<目标项目的绝对路径>" --platform claude-code
```

语义与方式 A 相同，两点差别：安装器从本仓库的权威源读取技能；写入的版本标识来自该 clone 的 `git describe`，而非已发布包。此处的 `--target` 用绝对路径；省略则装到当前目录。

## 方式 C · 手工复制（兜底）

把检出中的 `.flow-comet/skills/*` 复制到项目的平台目录（`.claude/skills/`、`.agents/skills/` 或 `.dsh/skills/`），让 `flow-kit/` 与之并列，并自行添加平台的 hook 条目。这样做绕过了安装器的合并、幂等与 `.gitignore` 处理——只在安装器确实无法运行时使用，并预期每次更新都要重做。

## 方式 D · DeepSeek Harness（dsh）

带 `--platform dsh` 安装会：把项目侧技能树写入 `.dsh/skills/`、向 `AGENTS.md` 注入托管块、把桥接 loader 复制到 `$DSH_HOME/plugins/`，并通过 `$DSH_HOME/cordis.patch.yml` 的托管块挂载它。其余无需操作：dsh 会自行发现 `.dsh/skills/`，loader 由宿主应用。

任一安装副本都提供只读自检：

```bash
node .dsh/skills/flow-comet/scripts/workflow-state.mjs bridge-check
```

它报告：loader 是否存在、托管块是否挂载、是否恰好注册一次、loader 版本戳与项目标识是否一致。之后要卸载该平台：`fcomet init --purge --platform dsh --yes`。

## 安装失败时

见[故障排查](TROUBLESHOOTING-zh.md)——按"安装 / 首次运行 / 节点卡住 / 平台"分节，每条给出现象与要执行的命令。安装类常见项包括：命令找不到、平台选错（带 `--platform` 重跑）、以及"打印用法并以非零退出"（那正是无参数行为）。
