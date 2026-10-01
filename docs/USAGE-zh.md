# 使用

工作流如何运作、如何驱动一个节点、工件放在哪里，以及你实际会敲什么。

以下所有操作都在你安装过的项目内、用安装副本的引擎（Claude Code 为 `.claude/skills/flow-comet/scripts/`，Codex 为 `.agents/skills/...`，dsh 为 `.dsh/skills/...`）完成。flow-comet 检出里的权威源是给"开发 flow-comet 本身"用的；引擎同样会拒绝读取项目根之外的协议文件。

## 8 节点工作流

| # | 节点 | 职责 | 类型 |
|---|---|---|---|
| 1 | `open` | 框定 change：为什么做、做什么、范围、粗粒度验收线 | control |
| 2 | `design` | 技术栈决策、决策清单、数据流、风险、不在范围 | control |
| 3 | `plan` | 波次/任务拆解，带边界与每任务 verify 命令 | control |
| 4 | `execute` | 协调者按计划组织任务执行 | control |
| 5 | `subagent-execute` | 委托执行：handoff 请求 + Return Contract | handoff |
| 6 | `review` | 多轮审查；每条发现必须有处置 | control |
| 7 | `verify` | 集成验证；出口会**真实执行**测试命令 | control |
| 8 | `archive` | 汇总遗留、把 change 移入归档、登记 | control |

`next` 告诉你现在在哪；`status` 打印机器状态。两者都是只读命令。

## 你怎么用

每个会话调用一次工作流，之后它自己驱动自己。Claude Code 里就是入口技能 `/flow-comet`；Codex 里调用该技能（`/use flow-comet`）或用自然语言说明要走这个工作流；DeepSeek Harness 里调用 `flow-comet` 技能。首次调用会确认范围、创建该 change 的分支、初始化状态并进入第一个节点；此后工作流逐阶段路由，只在决策点停下来。

下面的节点生命周期是**工作流替你执行的东西**——也是你要亲手驱动某个节点时（恢复卡住的 change，或直接与引擎打交道）自己执行的东西。

## 驱动一个节点

每个节点都是同一条生命周期：守卫记录进入 → 你加载该节点技能 → 声明 → 干活 → 记录节点证据 → 守卫校验出口：

```bash
node <skills>/flow-comet/scripts/workflow-guard.mjs entry <node> --apply        # 守卫：进入
node <skills>/flow-comet/scripts/workflow-state.mjs  skill-load <node> <skill>  # 声明已加载的技能
node <skills>/flow-comet/scripts/workflow-state.mjs  record <node> '{"summary":"..."}'
node <skills>/flow-comet/scripts/workflow-guard.mjs exit <node> --apply         # 守卫：出口
```

`<skills>` 视平台为 `.claude/skills` / `.agents/skills` / `.dsh/skills`。两套命令分工明确：

| 命令 | 负责什么 |
|---|---|
| `workflow-guard.mjs` | `entry` / `exit` —— 门禁。出口校验该节点的工件、段、声明，并在 `verify` 时**真跑**测试命令 |
| `workflow-state.mjs` | `init`、`status`、`next`、`select`、`record`、`verify-fail`、`advance`、`execution-mode`、`config`、`skill-load`、`bridge-check`、`reenter`、`replan` —— 状态机与记账 |

节点的出口会在以下情况拒绝通过：工件不完整或形态不合规、缺少技能加载声明、或从未记录进入；每次拒绝都会打印原因与修复命令。状态不存放在对话里：随时用 `status` / `next` 重新推导。

## 工件

一个 change 位于 `.specs/<change-id>/`：

| 文件 | 由哪个节点写 | 内容 |
|---|---|---|
| `CHANGE.md` | `open` | 为什么 / 做什么 / 影响面 / 范围排除 / 粗粒度验收线 / 风险 |
| `REQUIREMENT.md` | `open` | 用户故事、验收准则、范围切分、非功能性需求 |
| `DESIGN.md` | `design` | 技术栈、决策清单、数据流、状态机、风险、§9 沉淀建议 |
| `TASK.md` | `plan` | 波次计划、任务块（name / read / write / action / verify / done / depends_on）、状态字段 |
| `<任务号>-SUMMARY.md` | `execute` | 每个完成任务一份：做了什么、改动文件、verify 输出、自检、越界检查 |
| `REVIEW.md` | `review` | 审查轮次与发现，每条带处置标记 |
| `TEST.md` | `review` | 五轮测试图景，以及 `verify` 会执行的 `## 验证命令` 块 |
| `UAT.md` | `verify` | 验收项与结果 |
| `KNOWN-ISSUES.md` | `archive` | 仍然开放或明确排除的事项 |
| `.skill-loads/` | 每个节点 | 声明标记，每节点每技能一份 |

归档时整个目录迁到 `.specs/archive/<YYYY-MM-DD>-<change-id>/`，并向 `.specs/CHANGELOG.md` 追加一行。`.specs/` 不纳入版本控制：它是工作的运行时记录，由安装器写入 `.gitignore` 的托管条目挡在仓库之外。

## 引擎强制的纪律

- **工件保真** —— 节点文档必须符合 flow-kit 模板的首部字段与段名，否则守卫拒绝出口。
- **先证据后出口** —— `record <node>` 写入节点证据，出口要求它存在（外加技能加载声明）。
- **摘要骨架** —— 每个完成任务都要有 `<任务号>-SUMMARY.md`，含模板规定的各段（包括自检与越界检查）。
- **测试真跑** —— `verify` 出口执行 `TEST.md` 里的命令块并统计失败；命令失败即阻断出口。
- **计划重校是受控通道** —— 计划在节点中途被证明有缺陷时，`replan "<原因>" --authorized-by <来源>` 是重新校验并重签任务集的唯一合规路径。它重跑 plan 出口同一套任务图与字段校验，因此绝不豁免任何门禁。每次调用都需要显式授权，每个 change 最多 3 轮（追加轮次只能走显式续轮参数），改写状态前先落状态备份，重复的同形态调用是空操作。
- **审查发现不消失** —— `REVIEW.md` 每条发现都要有处置标记（已修 / 升级 / 转待办）；把 Major 转待办需要用户裁决记录。
- **协调者边界** —— 默认的 `subagent` 执行模式下，协调会话不得亲自执行任务，引擎会报告越俎代庖；文档化豁免通道是显式声明 `record execute '{"parallelTakeoverApproved":true}'`。
- **归档完整** —— 归档出口要求归档目录与其内的 `KNOWN-ISSUES.md`（无遗留也要显式写明）。

## 分支模式与执行模式

在 git 项目里，引擎按 change 开分支：`init <change-id>` 会创建并切换到 `change/<change-id>`，`next` 会打印分支行；没有 git 的项目里该行显示 `none`。

执行模式默认 `subagent`（实现工作委托给隔离子代理，附 Return Contract）。`execution-mode direct` 切到协调者亲自执行并记录显式授权；`execution-mode subagent` 切回。

## 用户入口

| 入口 | 用途 |
|---|---|
| `/flow-comet` | 开始或继续 8 节点工作流——按工件推导当前节点并路由 |
| `/flow-comet-compose` | 把已安装技能组合成自定义协议（侧命令，不在 8 节点链上）——见[自定义协议](MECHANISM-zh.md#自定义协议) |

安装树里其余的技能目录（`flow-comet-open`、`-design`、`-plan`、`-execute`、`-subagent-execute`、`-review`、`-verify`、`-archive` 等）是工作流推进时按节点加载的技能，不需要你直接调用。另有两个仅以说明形式存在的侧能力（`flow-comet-evolve`、`flow-comet-health`），当前没有引擎支持。

## 决策与恢复

节点进行中偶尔需要你做决定。四类决策——用户决策 / 自动处理 / 停止条件 / 手动交接——与按节点列出的决策点都在技能树内的 `reference/decision-points.md`。

节点卡住时：`status` 看机器状态，`next` 看当前节点与继续命令，`advance` 在状态确实错位时强制推进，`select <change-id>` 切换 change。症状与处置按类分在[故障排查](TROUBLESHOOTING-zh.md)。
