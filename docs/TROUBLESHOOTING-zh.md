# 故障排查

对号入座找症状，然后执行给出的命令。以下都假定你在安装过的项目内。

## 症状

### 安装

**`fcomet: command not found`** —— CLI 不在 PATH 上。重跑 `npm install -g flow-comet`，确认 `npm prefix -g` 在 PATH 中；`node --version` 必须 ≥ 18。

**命令打印用法并非零退出** —— 那正是无参数行为：不带任何参数时安装器只打印用法。补上意图即可：`fcomet init`，或 `fcomet --target <dir>`，或 `--platform <名字>`。

**装错了平台** —— 显式指定重跑：`fcomet init --platform claude-code`、`--platform codex`、`--platform dsh`，或逗号组合 / `all`。重跑是幂等的，且不会删除托管技能目录之外的既有内容；目录内的清理按位置判定——请勿在其中存放自有文件。

**`.gitignore` 没被更新** —— 确认是在项目里跑的（不是在 flow-comet 仓库自身内——那里 `.flow-comet/` 必须保持被跟踪）。托管条目是追加的，不会替换既有行。

### 首次运行

**Claude Code 从不拦截越界写入** —— hook 要通过宿主能找到的 shell 执行。Windows 上需把 Git Bash 的位置告知平台后重试；无头会话还需预先接受工作区信任。

**Codex 什么都不拦** —— 项目 hook 仅在信任被接受后（交互式 `/hooks`）执行，或由脚本化运行传入 `--dangerously-bypass-hook-trust`。两者都没有时，hook 根本不会执行。

**dsh：写入未被拦截** —— 在项目里跑只读自检：`node .dsh/skills/flow-comet/scripts/workflow-state.mjs bridge-check`，它会报告 loader 是否存在、`$DSH_HOME` 托管块是否挂载、是否只注册一次、loader 版本戳与项目标识是否一致。重跑 `fcomet init --platform dsh` 会同时重写 loader 与托管块。

### 节点卡住

**`BLOCKED: … 未执行 entry 直接 exit`** —— 新 change 的每个节点都要先进入：先跑 `workflow-guard.mjs entry <node> --apply`。

**`BLOCKED: … 缺少技能加载声明标记`** —— 加载该节点技能并声明：`workflow-state.mjs skill-load <node> <skill>`，然后重做 `record` 与出口。

**`BLOCKED: … 模板保真校验失败`** —— 节点文档缺少 flow-kit 模板规定的首部字段或段。对照 `flow-kit/templates/<DOC>.md` 补上被点名的字段或段。

**`BLOCKED: … TASK.md 任务集被修改（签名不匹配）`** —— 进入执行节点后任务集被改动。恢复任务清单后重新进入节点（或把新工作作为任务在进入前加好），不要在流程中途改任务。

**`BLOCKED: done 任务 … 缺少 <id>-SUMMARY.md`** —— 每个完成任务都要有摘要文档且含模板各段。补写它，或把该任务回退为未完成。

**`BLOCKED: … 任务被主代理直接标记 done（越俎代庖）`** —— 默认执行模式下协调会话不得亲自完成任务。请委托，或用 `workflow-state.mjs record execute '{"parallelTakeoverApproved":true}'` 显式声明接管。

**`verify` 超时或命令非零退出** —— 出口会执行 `TEST.md` 的命令块。先自己跑那条命令看输出；确实需要更长时间的套件，可用文档化的 `FLOW_COMET_VERIFY_TIMEOUT_MS` 环境变量放宽预算。

**`BLOCKED: missing Output Schema artifacts`** —— 归档出口要求归档目录与其遗留清单。把 change 目录移入 `.specs/archive/<日期>-<change-id>/`，并确保其内存在 `KNOWN-ISSUES.md`（无遗留也要显式写明）。

### 平台

**移动项目后 Codex hook 失效** —— Codex hook 记录的是安装时的绝对路径。在新位置重跑 `fcomet init --platform codex`。

**dsh 报版本偏斜** —— loader 版本戳与项目标识不一致。重跑 `fcomet init --platform dsh`（两者都会被重写），再用 `bridge-check` 复查。从 clone 安装时一侧带开发态后缀属正常。

### 升级与重置

**`npm install -g flow-comet` 之后项目还是旧版本** —— 升级全局包只换 CLI。在该项目重跑 `fcomet init`；它会覆盖生成文件且是幂等的。

**我想重来** —— `fcomet init --purge --yes --platform <平台>` 会删除该平台的生成物并重建。它是删除并重建，**不是卸载**：Claude Code 会移除整个 `.claude/`（自定义内容请另置），Codex 只移除 flow-comet 技能与托管条目，`flow-kit/` 永不被删。删除清单会在动手前打印；`--yes` 是第二次确认。
