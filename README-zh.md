<div align="right">

[English](README.md) · [中文](README-zh.md)

</div>

<p align="center">
  <img src="assets/readme/hero.svg" width="100%" alt="flow-comet —— 项目徽标与名称，右侧是引擎的八个节点排成的轨道，每一段转换上都有一道闸门" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow?style=flat" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js_%E2%89%A518-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js 18+" /></a>
  <a href="https://github.com/baobaolaodie/flow-comet/actions"><img src="https://img.shields.io/github/actions/workflow/status/baobaolaodie/flow-comet/ci.yml?style=flat" alt="CI status" /></a>
  <a href="CHANGELOG-zh.md"><img src="https://img.shields.io/badge/version-1.6.4-blue.svg" alt="Version 1.6.4" /></a>
</p>

<p align="center">
  <a href="https://claude.ai/code"><img src="https://img.shields.io/badge/Claude_Code-D97757?style=flat&logo=claude&logoColor=white" alt="Claude Code" /></a>
  <a href="https://github.com/openai/codex"><img src="https://img.shields.io/badge/Codex-10A37F?style=flat&logoColor=white" alt="Codex" /></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek_Harness-4D6BFE?style=flat&logoColor=white" alt="DeepSeek Harness" /></a>
  <a href="https://github.com/rihebty/flow-kit"><img src="https://img.shields.io/badge/flow--kit-4CAF50?style=flat" alt="flow-kit" /></a>
</p>

---

## 快速开始

三步，在你的项目目录下执行：

```bash
# 1. 全局安装 CLI（Node.js 18+）
npm install -g flow-comet

# 2. 进入你的项目
cd <你的项目>

# 3. 把 flow-comet 装进这个项目
fcomet init
```

`fcomet` 与 `flow-comet` 是同一个安装器的两个命令名。只要其它参数已经表达了意图，`init` 词元可以省略（`fcomet --target <dir>` 等价）；`--target` 本身也可省略，缺省为当前目录。**不带任何参数**时只打印用法并非零退出，不会安装。在交互式终端里，未传 `--platform` 的运行会询问装哪个平台——方向键选择器会预选探测到的平台，回退提示则以探测到的平台为回车默认值（多平台痕迹并存时为 Claude Code）；非交互用 `--platform claude-code`、`--platform codex`、`--platform dsh`，或用逗号组合（如 `--platform claude-code,dsh`）与 `--platform all`。重复执行同一条命令是**幂等更新**。升级全局包只换 CLI——要让项目里的副本更新，需在该项目重跑 `fcomet init`。

**验证**：

```bash
fcomet --version                                   # 已安装的 CLI 版本
cat .claude/skills/flow-comet/INSTALLED_VERSION    # 写进本项目的版本标识
```

安装器把标识写到：Claude Code 为 `.claude/skills/flow-comet/INSTALLED_VERSION`，Codex 为 `.agents/skills/...`，dsh 为 `.dsh/skills/...`。它记录这份副本的来源版本：npm 安装写**随包发布的版本**；从仓库 clone 安装写该仓库的 `git describe` 值（clone 领先 tag 时才带 `-<n>-g<hash>` 后缀）。

## 怎么用

在项目里开一个会话，调用工作流：

- **Claude Code** —— `/flow-comet`
- **Codex** —— 调用该技能（`/use flow-comet`，或直接用自然语言说要走 flow-comet 工作流）
- **DeepSeek Harness** —— 调用 `flow-comet` 技能

首次调用会先确认范围，然后自动创建该 change 的分支、初始化状态并进入第一个节点，在 `.specs/` 下产出这个 change 的 `CHANGE.md` / `REQUIREMENT.md`。此后每个阶段自动路由——你只需要回答决策点（范围、技术栈、破坏性变更、审查发现、归档确认）。项目首次使用时会检测到缺少项目上下文，并在开始前提议用你既有的文档生成一份。

想知道它走到哪儿了，直接问它就行——也可以在项目里用命令行 `status` / `next` 查看（各平台路径见[安装](docs/INSTALLATION-zh.md)）。

工件放在 `.specs/<change-id>/`；归档时整体迁到 `.specs/archive/<日期>-<change-id>/`，并在 `.specs/CHANGELOG.md` 顶部追加一行。逐节点的走查——包括工作流在底层实际执行什么、以及需要手动驱动节点时怎么做——见[使用](docs/USAGE-zh.md)。

## 选择平台

| 平台 | 技能安装到 | Hook / 桥接 | 首次使用 |
|---|---|---|---|
| Claude Code（默认） | `.claude/skills/` | `settings.local.json` → `hooks.PreToolUse` | 需信任该工作区；无头会话需预先接受该信任 |
| Codex | `.agents/skills/` | `.codex/hooks.json`，另在 `AGENTS.md` 注入托管块 | 首次需信任项目 hook（交互式）；脚本化运行传自动化开关 |
| DeepSeek Harness（dsh） | `.dsh/skills/` | `$DSH_HOME` 下的全局桥接 loader，另在 `AGENTS.md` 注入托管块 | 无 hook 信任步骤 |

前置条件、四种安装方式、各平台的验证步骤、以及重置（purge 是删除并重建，**不是卸载**）行为：见[安装](docs/INSTALLATION-zh.md)。

## 真实运行产物

一次完整 8 节点运行会留下下面这条工件链——[一次真实归档的 change](docs/examples/processor-pipeline/)（端到端测试项目，2026-08-13），保留在本仓库里作为质量参照：CHANGE / REQUIREMENT / DESIGN / TASK / 六段 SUMMARY / 带处置标记的 REVIEW / TEST / UAT / KNOWN-ISSUES / skill-load 声明标记。

```
processor-pipeline/            （归档 change，完整产物集）
├── CHANGE.md / REQUIREMENT.md / DESIGN.md / TASK.md
├── T01~T06-SUMMARY.md          （六段 SUMMARY）
├── REVIEW.md                   （发现区带处置标记）
├── TEST.md / UAT.md            （verify 出口真实执行测试命令）
├── KNOWN-ISSUES.md
└── .skill-loads/               （11 个 skill-load 声明标记）
```

下面是本项目真实会话的两张未编辑截图：一张是会话进行到 4 小时以上时工作流技能仍正常加载，另一张是 5 小时会话末尾、验证出口已经跑完测试命令。

<p align="center">
  <img src="assets/readme/proof-board.png" width="100%" alt="两张终端截图：会话进行到四小时时技能正常加载，以及五小时运行末尾完成验证" />
</p>

## 它怎么运转

流程是 flow-kit 的 9 个阶段；引擎把它们跑成 8 个节点。CHANGE 与 REQUIREMENT 由 `open` 覆盖，TEST 与 REVIEW 由 `review` 覆盖，DEV 则按执行模式跑成 `execute` 或 `subagent-execute`。每个节点的出口都先被校验，下一个节点才会打开——`verify` 出口会真实执行 `TEST.md` 里的命令——每个节点的工件都落在 `.specs/<change-id>/` 下。

<p align="center">
  <img src="assets/readme/workflow.gif" width="100%" alt="动效示意图：flow-kit 的 9 个阶段映射到引擎的 8 个节点——CHANGE 与 REQUIREMENT 合并为 open，TEST 与 REVIEW 合并为 review，DEV 按执行模式跑成 execute 或 subagent-execute，每段转换都有一道闸门" />
</p>

手动驱动一个节点、每个节点产出什么工件、以及两套命令面，见[使用](docs/USAGE-zh.md)；引擎保证什么、节点出口如何被校验，见[核心机制](docs/MECHANISM-zh.md)。

## 为什么用 flow-comet

1. **把"靠自觉"变成"靠机器"**——每个阶段出入口都有脚本校验：工件齐不齐、节段填没填、验证命令跑没跑、任务有没有越界，机器逐项检查并阻断。
2. **断了线、换了会话也不丢进度**——进行到哪一步永远从 `.specs/` 工件推导，不靠对话记忆；随时重开从正确节点继续。
3. **实现与协调分离，且分离是被强制执行的**——实现交给全新上下文的子代理完成，必须交回经验证的契约；守卫先按调用方身份判定、再解析路径，独立工作树只是写权限的一种实现而非前提。协调者被禁止写源码，越出当前节点范围的写入会被 hook 拒绝。三层防线本身见[核心机制](docs/MECHANISM-zh.md)。

### 相关项目

<p align="center">
  <img src="assets/readme/related-projects.svg" width="100%" alt="flow-comet 与各外部项目的关系：五家的思路经 flow-kit 汇聚，comet 是现已解耦的早期机制参考，brooks-lint 是可选集成" />
</p>

| 项目 | 它是什么、怎么运作 | 与 flow-comet 的关系 |
|---|---|---|
| **flow-kit** | 纯 Markdown 方法论包：9 阶段流程、`.specs/` 模板、R1–R8 规则，零运行时。阶段 prompt 由人手动加载，状态经 `.md` 工件传递。安装时锁定一个具体提交。 | **依赖 —— 底座，同时是汇聚点。** flow-comet 是它的执行自动化层：模板、规则与工件形态都继承上游，本仓只追加上游没有的增量段；工件形态以模板为唯一权威，没有上游模板的文档（`UAT`、归档的遗留清单）只查存在性。下表各家的思路经它汇聚而来。 |
| **OpenSpec**（Fission-AI） | 规范驱动开发框架：编码前加一层轻量规范。`openspec/` 目录下每个变更一套 `proposal` / `specs` / `design` / `tasks`；默认档流程为 propose → apply → sync → archive。 | **经 flow-kit 汇聚**（思想来源）。独立使用时更轻：没有状态机，也没有阶段门。 |
| **Superpowers**（obra） | agentic 技能框架 + 完整开发方法论，按平台分别安装，覆盖 Claude Code、Codex、Cursor、Gemini CLI 等。技能按上下文触发，靠指令约束。 | **经 flow-kit 汇聚**（思想来源，部分重叠）。纪律写在技能文本里、依赖模型自觉；flow-comet 把同款纪律机器校验化。 |
| **comet**（rpamis） | 可恢复的长任务工作流 + 技能平台：五阶段状态机、阶段守卫、hook 写入拦截。`/comet` 按配置路由，默认走 Native 分支。 | **早期机制参考，现已解耦。** hook 注入形态与脚本管状态来自这里；命名已解耦、状态不互通。只有它的 Classic 分支才带 OpenSpec + Superpowers 血统。 |
| **GSD** | 规范驱动的元提示与上下文工程工作流：里程碑 → 阶段 → 计划；每个 agent 一个全新上下文窗口 + 按范围裁剪的载荷；工作树隔离 + UAT 门。 | **经 flow-kit 汇聚**（思想来源，同类）。fresh-context 执行与阶段门思想一致；路由靠提示词而非脚本强制。 |
| **spec-kit**（GitHub） | SDD 工具包：Specify → Plan → Tasks → Implement → Converge。每阶段把 markdown 工件喂给下一阶段；任务块带顺序 ID、`[P]` 并行标记与文件路径。 | **经 flow-kit 汇聚**（思想来源，同类）。flow-kit 的 TASK 模板继承的正是这个任务块形态；阶段迁移无强制。 |
| **claude-task-master** | 通过 MCP 与 CLI 的 AI 驱动任务管理：PRD 解析 → 任务分解 → 依赖图 → next_task 编排。许可为 MIT with Commons Clause。 | **经 flow-kit 汇聚**（补足）。只管任务层：没有阶段门、没有工件校验、没有写权限。 |
| **brooks-lint**（hyhmrright） | 第三方审查引擎，以十二本经典工程书为判据：六类生产码 + 六类测试腐化风险，发现按 Symptom → Source → Consequence → Remedy 给出，含 0–100 健康分与六个模式。 | **可选集成（MIT，非依赖）。** 装了它时，六个命令中的五个为自查与审查轮提供诊断；缺席时工作流沿声明的降级链继续。 |

**适用场景**：flow-comet 面向耗时数小时、跨多会话的开发 change。三个平台共用同一份契约——写权限、提交隔离、验证隔离、集成纪律——但**实测深度各不相同**，逐平台覆盖情况写在[核心机制](docs/MECHANISM-zh.md#并行委派)里。它不是通用 CI/CD 或项目管理工具；其他平台（Gemini / Cursor）不保证支持。

## 推荐搭配：brooks-lint

质量检查建立在 [brooks-lint](https://github.com/hyhmrright/brooks-lint) 的腐化风险框架之上——它是一个第三方（MIT）审查引擎，以十二本经典工程书为判据。装上它时，逐任务的六维自查、review 节点的代码质量轮与测试质量检查都会走它，`health` 侧命令把它的结果并入自己的报告；没装时工作流照样跑完，沿声明的降级链继续并如实声明。它不是依赖，flow-comet 侧无需任何配置；它的安装器覆盖的平台比本项目更多，各平台的验证深度也不同——细节见[安装](docs/INSTALLATION-zh.md)。

## 与上游项目的关系

flow-comet 自动化的是 [flow-kit](https://github.com/rihebty/flow-kit) 的方法学——阶段、工件、规则与模板都是继承而非重造。两个项目**不共享文件**：flow-kit 以只读、锁定的依赖形式被消费，本仓库保留一份 vendored 副本仅作格式基准。可以借用什么、分歧如何声明，写在[贡献指南](CONTRIBUTING-zh.md#借用边界)的「借用边界」一节。

## 文档

| 文档 | 它是下列内容的唯一权威处 |
|---|---|
| [安装](docs/INSTALLATION-zh.md) | 前置条件、四种安装方式、平台选择、安装验证、以及重置（purge 是删除并重建，非卸载） |
| [使用](docs/USAGE-zh.md) | 8 节点工作流、节点生命周期与其命令、工件、分支模式、执行模式、用户入口 |
| [核心机制](docs/MECHANISM-zh.md) | 行为契约、三条防线、守卫校验、自定义协议 |
| [故障排查](docs/TROUBLESHOOTING-zh.md) | 按症状分节：安装、首次运行、节点卡住、平台 |
| [版本](docs/VERSIONS-zh.md) | 版本语义、版本记录位置、发布清单 |
| [变更日志](CHANGELOG-zh.md) | 逐版本历史 |
| [贡献指南](CONTRIBUTING-zh.md) | 贡献流程与借用边界 |
| [安全](SECURITY.md) | 漏洞上报方式 |

## 贡献

完整指南见 [CONTRIBUTING-zh.md](CONTRIBUTING-zh.md)——分支模型（`feature → dev → main`）、PR 流程、合并规则与提交规范。速览：

1. 从 `dev` 开分支：`git checkout dev && git checkout -b feat/<描述>`
2. 修改 skill/脚本请改 `.flow-comet/skills/`（权威源）；TDD——先写 RED 场景
3. 运行回归：`node .flow-comet/skills/flow-comet/scripts/guard-self-test.mjs` → `ALL 350 SCENARIOS PASSED`
4. 开 PR 合入 `dev`（squash——change 级提交）；发布 PR `dev → main`（merge——change 级提交进入 main，每次发布后 dev 不再领先）

CI 在每个 PR 与 push 时自动强制仓库约定：回归、安装器可复现性、工作流与双语镜像质量、PR 纪律、版本一致性、死链。本地 hook（提交/推送消息检测）通过 `node scripts/install-commit-hook.mjs` 安装——完整指南见 [CONTRIBUTING-zh.md](CONTRIBUTING-zh.md)。

## License

[MIT](LICENSE) © 2026 baobaolaodie

flow-comet 依赖 [flow-kit](https://github.com/rihebty/flow-kit)（MIT）。它的机制形态借鉴自 [Comet](https://github.com/rpamis/comet)（MIT），但**不依赖**它。
