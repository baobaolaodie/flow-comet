<div align="right">

[English](CHANGELOG.md) · [中文](CHANGELOG-zh.md)

</div>

# Changelog

本项目的所有显著变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。版本号记录于 git tag、本文档、README 徽章、[docs/VERSIONS-zh.md](docs/VERSIONS-zh.md) 与权威源 `skills/flow-comet/INSTALLED_VERSION`；`bundle.yaml` 的 version 保持 1.0.0（与发布流程解耦）。

## [Unreleased]

### 变更

- **dsh 写入包含性改为仅在流程运行中生效**：空闲态（无 state / 无 `activeChange` / `completed`）项目根外写入不再被桥接拦截，与 Claude Code / Codex 语义一致；解析失败或未知状态保持 fail-closed 拒绝。([#65](https://github.com/baobaolaodie/flow-comet/pull/65))
- **系统测试集扩展至 61 项**：新增 dsh 桥接流程态门断言（空闲放行 / 解析失败与未知状态 fail-closed）。([#65](https://github.com/baobaolaodie/flow-comet/pull/65))
- **回归套件新增波次分组一致性校验与契约解析失败检测场景**。([#66](https://github.com/baobaolaodie/flow-comet/pull/66))
- plan 出口新增波次分组一致性校验（混排 WARN(旧)/BLOCK(新)+恢复指引）；record/workflow-handoff 对解析失败的契约 payload fail-closed（报错提示 --json-file、不落脏数据）。([#66](https://github.com/baobaolaodie/flow-comet/pull/66))
- **工件模板保真与技能加载前置门**：新 change 的 SUMMARY / TASK / CHANGE / REQUIREMENT / DESIGN 须保持模板标题、首部字段与段序；handoff request / record 前须已有本节点 skill-load 声明（用 Skill 工具加载技能后声明，读 SKILL.md 文件不算加载）。([#67](https://github.com/baobaolaodie/flow-comet/pull/67))
- **零提交任务正式语义**：任务 `write_files` 为空且契约显式声明 `noCommit` 时跳过提交文件子集校验并输出可审计提示；`write_files` 非空任务即使声称零提交仍执行完整校验。([#67](https://github.com/baobaolaodie/flow-comet/pull/67))
- **回归套件新增两层技能加载模型守卫场景**；**工作流技能文档改为两层技能加载模型**：入口层先经 Skill 工具加载路由命中的节点实现技能、再加载协议技能；节点技能声明自身已由路由加载（同名 required 仅需声明）；旧自动补表述限定为旧 change 兜底并置于声明前置门之下；新增两个回归场景锁定声明命令一致性并禁止自加载与混淆句式。([#67](https://github.com/baobaolaodie/flow-comet/pull/67))
- **验证出口命令执行兼容受限沙箱会话**：管道式执行被拒（EPERM，如 dsh 受限会话）时，guard 以继承 stdio 重试同一命令——真实执行与退出码判定不变，降级捕获以 VERIFY-DEGRADED 行标记；非 EPERM 失败不降级。回归套件扩展至 169 场景。([#67](https://github.com/baobaolaodie/flow-comet/pull/67))

## [1.4.2] - 2026-08-18

新增 DeepSeek Harness（dsh）平台支持（安装器 + 桥接写拦截），回归套件扩展至 144 场景 / 系统测试 60 项，并修复 dsh 写入防护边界。([#60](https://github.com/baobaolaodie/flow-comet/pull/60))

### 新增

- **DeepSeek Harness（dsh）平台支持**：flow-comet 现经安装器安装到 dsh——`prepare-env --platform dsh` 把技能树项目级安装到 `<项目>/.dsh/skills/flow-comet`（dsh 以 rank 100 自动发现该目录、免重启，未安装该目录的项目不可见该技能——天然项目级），编排规则注入 AGENTS.md 托管区（非破坏合并），薄桥接 loader 全局挂载于 `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` 并在 `$DSH_HOME/cordis.patch.yml` 注入托管块（读-合并-写、保留 dsh-skin 等既有块、对所有 profile 生效）。桥接 loader 监听原生 `tools/pre-execute` waterfall 事件，把 dsh 工具调用映射到项目本地 guard 判定脚本（放行 / deny + BLOCK 消息与恢复指引 / 形状不符或异常退出 fail-closed 拒绝，Windows 8.3 短路径规范化），且仅当会话项目根存在 `.dsh/skills/flow-comet` 时才介入（窄监听——非 flow-comet 项目零拦截）。平台选择支持交互多选（方向键、按项目痕迹预勾选）与显式逗号多平台（`--platform dsh` / `claude-code,dsh` / `all`；旧 `both` 选项移除）。版本锚定：dsh `0.1.0-rc.6`。([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))

### 变更

- **回归套件扩展至 144 场景**：新增安装器平台选择链场景（显式单平台/逗号多平台/all/TTY 多选预勾选/痕迹探测/未知平台报错/both 拒绝/幂等重装）；dsh 适配保持引擎零改动——guard 判定核心经子进程调用原样复用。([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))
- **系统测试集从 55 项扩展至 60 项**：新增 dsh 平台断言（项目级 skill 安装与路径替换、版本标识、AGENTS.md 托管区用户内容保留、桥接 loader 语法与 home patch 读-合并-写注入、purge 清理恢复）。([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))

### 修复

- **dsh 平台写入包含性**：解析后越界项目根的写入目标在进入 guard 判定前即被拒绝（此前未解析目标会跳过白名单判定——fail-open）；Windows 8.3 短路径在判定前规范化。([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))
- **dsh 工具参数 fail-closed**：参数形状不符（缺 `file_path` / `command`、非对象参数）时输出 deny + WARN，不再静默放行。([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))
- **dsh 子代理执行**：工作流把任务委托给子代理时，被委托的子代理（以会话的子代理委托深度识别）作为执行者可写入源码——与其他平台 worktree 隔离语义一致；协调者仍受阶段写白名单约束。越界写入与参数形状不符对两者一律拒绝。([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))
- **dsh 判定前项目根 8.3 归一化**：调用项目本地 guard 前先把项目根规范化为长路径形态，修复一处 fail-open——8.3 短形态项目根曾使 guard 的词法路径解析跳过阶段写白名单（越权的协调者写入被放行）。([#PR](https://github.com/baobaolaodie/flow-comet/pull/60))

## [1.4.1] - 2026-08-16

安装器平台选择修复与发布模型变更（发布 PR 改 merge 合并）。([#56](https://github.com/baobaolaodie/flow-comet/pull/56)、[#57](https://github.com/baobaolaodie/flow-comet/pull/57))

### 修复

- **安装器平台选择**：交互提示新增 `3) both`（两个平台都装——交互专属选项，`--platform` 仍仅接受 `claude-code` 或 `codex`）；目标项目同时有 `.claude/` 与 `.codex/` 痕迹时，无 TTY 自动探测不再武断只装 Codex——默认安装 Claude Code（主平台）并输出提示；Codex 经 `--platform codex` 显式选择，both 经交互终端选择。

### 变更

- **发布模型**：发布 PR（`dev → main`）改为 merge 合并——dev 的 change 级提交永久进入 main，每次发布后 dev 不再累积领先 main。

## [1.4.0] - 2026-08-14

多平台安装器框架、平台模块化与真实产物示例。([#45](https://github.com/baobaolaodie/flow-comet/pull/45)、[#46](https://github.com/baobaolaodie/flow-comet/pull/46)、[#47](https://github.com/baobaolaodie/flow-comet/pull/47)、[#48](https://github.com/baobaolaodie/flow-comet/pull/48)、[#50](https://github.com/baobaolaodie/flow-comet/pull/50)、[#52](https://github.com/baobaolaodie/flow-comet/pull/52))

### 新增

- **skill-load 声明机制**：子代理按节点声明已加载的工作流技能；record 按协议要求的技能调用校验声明；exit 校验协议声明标记；交叉自洽时间序校验；与旧 change 向后兼容。
- **安装版本标识**：`prepare-env` 写入 `<项目>/.claude/skills/flow-comet/INSTALLED_VERSION`（取自源仓库 git 状态：发布 tag 上为 `1.4.0`，积累中的 dev 为 `1.4.0-N-g<hash>`）——issue 与 PR 可据此说明精确版本，含 dev 自上次发布以来的积累程度。
- **本地提交/推送 hook**：`install-commit-hook.mjs` 配置 commit-msg 与 pre-push hook，拒绝含过程代号的提交/推送消息（本项目的工程约定，非通用词表）。
- **多平台安装器框架**：`prepare-env` 现支持 Claude Code（默认，行为不变）与 Codex——平台描述符表驱动；TTY 交互式平台选择 + 显式 `--platform` 覆盖 + 自动探测既有 `.claude/` / `.codex/`；技能安装到各平台原生位置（Codex 为自动发现的 `.agents/skills/`）；SKILL/GUIDANCE 命令路径在安装时按平台重写（权威源保持 `.claude` 形态）；Codex 规则注入 AGENTS.md 托管区（Codex 的 `rules/` 目录服务于命令批准策略，非指令文件）；写入守卫 hook 完成 Codex 完全适配——Codex PreToolUse 拦截 Bash 工具调用，hook 从命令解析写入目标（PowerShell cmdlet、.NET File API、重定向）并经 `{"decision":"block"}` 拒绝越权写入（实测 Codex CLI 0.146.0；首次使用经 `/hooks` 信任 hook），Claude Code 输出保持不变。

### 变更

- **回归套件扩展至 137 场景**：`init` 拒绝以 `--` 开头的未知参数（如 `--help`），不再当作 change 名执行；覆盖 skill-load 声明、record 校验、exit 协议校验、交叉自洽时间序、旧兼容、审查发现项处置、产物完整性、委托归属、恢复指引、波次一致性、新 change 自检方法段强制、按 change 隔离的验证失败计数。
- **CI**：过程代号检查从服务端 PR 策略移至本地 hook；PR/issue 模板按实践重构（勾选项去重、关联 issue 段、基于版本、协议与安装版本字段）。
- **提交历史平实化**：52 条历史提交消息重写为纯描述（树不变）；重复提交去重。
- **文档**：README 布局重组（快速开始前置）与借势增强（GSD 链接、痛点引导、适用边界）；安装指南补卸载小节；发布清单去重为单一权威；术语全库统一。
- **系统测试集扩展至 55 项**（安装器版本标识、多平台安装器场景：Codex 安装冒烟、hook 平台分支契约、平台选择链、清理语义、平台描述符驱动安装冒烟、按 change 隔离的验证失败计数）。
- **合并门禁改为 CI status checks**：分支保护不再要求 approving review（单人账号无法自 approve）；required checks 为 CI 各 job；bot 审查（CodeRabbit / Sourcery）为意见层——贡献指南新增 bot 审查实践节（仅供参考、行内线程回复、合并前处理）。
- **示例重构为真实归档产物**：`docs/examples/` 现包含一次真实完整 8 节点 change 的全部工件（processor-pipeline，e2e 假项目运行）——六段 SUMMARY、REVIEW 发现区处置标记、skill-load 声明标记、verify 出口真实执行；移除旧模拟示例与过时产物截图，README 展示区指向真实产物。
- **全库文档检修**：技能指令去重（删除生成器模板残留与中部 frontmatter）、Comet 定位声称替换为 flow-comet 自身机制表述、逐节点门禁表对齐实际实现（未实现项标注为 review 把关的执行纪律）、双平台（Claude Code / Codex）适配（brooks-lint 调用方式、用户入口、安装文档）、回归基线在全部文档中提升为两级（引擎回归 + 系统测试集）、时效性更新（路线图状态、设计文档回填、交接文档归档）。
- **新 change 严格模式**：`init` 创建的 change 标记为"新"（`newChange`），全部内容级检查升级为拦截（处置标记/builtin 自检证据/波次散文一致性/越权委托/追加位置/进入证据/自检方法段）；旧 change 保持渐进警告。
- **执行遗漏防护**：节点进入被记录（新 change 未 entry 直接 exit 拦截；旧 change 渐进警告）；新 change 的已完成任务必须有对应 SUMMARY（拦截；旧 change 保持渐进警告）；新 change 的交接结果必须有 TDD RED 证据；record 自动补写技能加载声明标记；execute 新增显式空退出豁免；init 检测无提交仓库；安装器在 hook matcher 演进时清理残留的空 hook 组。

### 修复

- 产物路径推导尊重协议 `pathBase`（自定义协议声明项目根工件时正确推进）；不支持的根类型 fail-fast。
- 已完成任务须有对应任务摘要（渐进 WARN，不 BLOCK）。
- 委托的并行任务越权检测（execute 与 verify 出口）。
- BLOCKED 消息补恢复指引（advance / select / record）。
- 波次散文一致性：散文标记并行但任务标签缺并行属性时渐进 WARN。
- `init` 命令拒绝以 `--` 开头的参数（如 `--help`）——此前会被当作 change 名执行，自动开 change、建分支并写状态。
- dev-main 同步检查：dev 上有意删除的文件（如模板 md → forms 迁移）不再被误判为 dev 落后。
- 技能内缺失安装路径前缀的命令补全为权威源路径——两平台安装后均可执行。
- 过程代号检测正则覆盖 1~3 位场景编号（原先只拦两位）；文档扫描正则与单一来源重新同步；POSIX hook 文件在安装时补齐执行位。
- CI 双语镜像检查补 SECURITY 对（CoC 按设计豁免，与本地检查一致）；版本期望提取不再依赖失效的回退。
- 包元数据对齐：技能清单、references 与脚本 sideEffect 与实际分发一致。
- 机制文档与技能指引补严格模式显式表述（进入强制、SUMMARY 强制、命令级写入拦截进入 Red Flags）。
- 验证失败计数按变更隔离——切换变更不再继承另一变更的失败次数（旧状态自动迁移）。
- 归档强制遗留清单（无遗留也显式声明）；声明标记自动补录不再重建已归档的活动目录。
- 空仓库分支提示与行为一致——无法创建分支时不再声称已创建。
- 审查字段标签豁免精确到完整标签（如 "Source maps expose paths" 这类标题不再被误豁免处置校验）。
- `--json-file` 读取限定项目根内（record 与 handoff）。
- 安装器在 POSIX 执行位设置失败时显式报错（此前静默——git 会跳过不可执行的 hook）。
- 委托边界 writeFiles 匹配支持部分通配（如 `src/*.mjs`）——`*` 不跨 `/`、字面段保持精确（此前部分通配被字面比较，合法委托被误拦截）。
- `--json-file` 缺值/空值时报用法错误而非类型错误（record 与 handoff 一致）。
- 套件头注释与测试矩阵/遗留清单模板中的过时场景数引用（136）同步为 137。
- 平台文档的 PowerShell 输出编码指引改为显式 `[System.Text.Encoding]::UTF8` 表达式（双语）。
- 归档阶段 hook 白名单含 `.specs/<change-id>/`——遗留清单可在归档移动前写入变更目录（此前被拦截）。
- 归档出口新增 WARN：项目 CHANGELOG 未登记本 change 时提示补登记（渐进，新旧 change 一致）。

## [1.3.1] - 2026-08-11

文档与 CI 维护批次——无行为变更。([#31](https://github.com/baobaolaodie/flow-comet/pull/31)、[#33](https://github.com/baobaolaodie/flow-comet/pull/33)、[#34](https://github.com/baobaolaodie/flow-comet/pull/34)、[#35](https://github.com/baobaolaodie/flow-comet/pull/35)、[#36](https://github.com/baobaolaodie/flow-comet/pull/36)、[#37](https://github.com/baobaolaodie/flow-comet/pull/37)）

### 新增

- README 运行展示区（真实运行截图，双语）；flow-kit 简介与横向纵向对比（双语）。
- TROUBLESHOOTING 补 1.3.0 初始化消息条目（INIT-GENERATE / VALIDATE-FAILED / DONE，双语）。

### 变更

- CI：dev-main 同步检查改树级单向（仅 main 新增文件判定 dev 落后——修复 squash 发布后的误报）；分支前缀白名单补 `ci/`；commit message 规范检查限定开发 PR（发布 PR 携带历史批次为设计）；actionlint 升级 + 每周金丝雀。
- CHANGELOG 场景数修正 95→97（与实现一致）；CONTRIBUTING / INSTALLATION / USAGE 双语与措辞清理。
- 回归套件自检清单纳入 CHANGELOG（防条目场景数过时）；回归映射注释修正为实际场景数。

## [1.3.0] - 2026-08-10

自动项目上下文初始化（init 前置步骤）。([#30](https://github.com/baobaolaodie/flow-comet/pull/30)关闭未合并、[#32](https://github.com/baobaolaodie/flow-comet/pull/32)实际合入)

### 新增

- **自动初始化检测**：项目首次使用时，工作流自动检测项目上下文（`CONTEXT.md`）是否存在，缺失时提示初始化——检测到既有 AI 上下文文档（如 `CLAUDE.md` / `AGENTS.md`）会读取并整合（带出处标注，**绝不修改既有文件**）；上下文已存在且新鲜的项目完全静默。无需记忆任何独立命令。
- **agent 协作生成协议**：`init <id> --init-context` 改为协作模式——脚本负责确定性探测/判决/提示/校验，agent 全量阅读既有文档并探测代码库，生成模板对齐的 `CONTEXT.md`（七段结构 + 出处标注，既有术语/决策/默认行为**保留**）；脚本校验七段结构与模板关键格式（带日期决策条目/元数据字段/术语表），校验通过后才记录扫描时间——生成后重跑一次即完成交接。
- **模板感知指引**：生成提示会报告是否检测到 flow-kit 的 CONTEXT 模板，段名按模板校验（模板缺失时回退内置基准）。
- **场景数一致性自检**：回归套件在公开文档场景数与实际套件规模漂移时失败。
- guard 自测套件扩展至 97 场景（覆盖：提示不生成 / 生成指引 / 校验通过与失败 / 占位放行 / 指引文案）。

### 修复

- 无扫描记录（旧项目）时的新鲜度提示不再显示"null 天"——改为指向精确的下一步动作。
- 刷新项目上下文时保留既有 CONTEXT 的累积内容（术语/已锁决策/默认行为），不再覆盖丢失。
- 新项目骨架 CONTEXT（占位段）通过校验，不再被拒绝。
- 对已存在的 change id 重跑 `init` 时先警告再重置（防误操作丢进度）。
- agent 生成的 CONTEXT 条目格式错误（如反引号包裹日期）会被格式校验拦截并给出精确的重写提示。

> 注：1.2.4 及更早条目保留英文小节标题（Added/Changed/Fixed），为历史条目原文。

## [1.2.4] - 2026-08-09

文档与消息清理——公开内容统一为纯描述语言。

### Changed

- **公开内容清理**：提交规范要求纯描述（不使用代号、编号或行话——提交信息、PR 标题、变更日志同一标准）；脚本注释、场景名与运行时警告消息清理过程代号——行为不变（82/82 回归 + 真实运行验证）
- **变更日志条目补发布链接**（Keep a Changelog 惯例——公开追溯；v1.2.1~1.2.3 条目已回填）
- 贡献指南补公开产物纯语言规范。([#14](https://github.com/baobaolaodie/flow-comet/pull/14)、[#15](https://github.com/baobaolaodie/flow-comet/pull/15))

## [1.2.3] - 2026-08-09

worktree 委托链路修复。([#12](https://github.com/baobaolaodie/flow-comet/pull/12)、[#13](https://github.com/baobaolaodie/flow-comet/pull/13)、[#14](https://github.com/baobaolaodie/flow-comet/pull/14))

### Fixed

- **路由诊断**：TASK.md task 标签含 `parallel="true"` 但缺 `status="pending"`（旧模板形态）时，路由输出 `ROUTE WARN` 说明属性顺序要求——结构校验保持严格，检测失败可见（不再静默卡在 execute）
- **C4 检查可见化**：worktree 脏检查的 catch 块输出 `C4-CHECK SKIP: <原因>`（此前静默吞错——Windows 下 git 命令失败不可见）
- **WARN COUNT 汇总行**：entry/exit 输出末尾追加 `WARN COUNT: N`（不改变既有输出）
- **空退出文档-实现一致化**：execute SKILL 不再声称「空退出」路径（guard 实际三层 BLOCKED：evidence → 串行 pending → 产物）；文档改为正确路径（直接路由 subagent-execute / 显式 `parallelTakeoverApproved` 豁免）
- **委托前检查清单**：subagent-execute SKILL 强制委托前检查（git status / HEAD / 内联上下文）+ Red Flag；dirty-worktree 协议标注为委托前必做
- guard 自测套件扩展至 82 场景（RED→GREEN 正确失败原因，独立验证者 24 条独立构造断言复验）

### Changed

- Troubleshooting 新增条目（ROUTE WARN / C4-CHECK SKIP / WARN COUNT，双语）；场景数 77→82 全公开文档同步（历史条目不改）

## [1.2.2] - 2026-08-08

6 维自查的 brooks-lint 两级降级路径。([#8](https://github.com/baobaolaodie/flow-comet/pull/8)、[#9](https://github.com/baobaolaodie/flow-comet/pull/9))

### Fixed

- **brooks-lint 两级降级**：Skill 工具仅返回 "Launching skill" 占位时（worktree 子代理 skill 路由不稳定——插件执行体可能未注入），子代理 **Read 插件缓存协议文件手动执行完整 brooks 审查**（`selfReview: cache-brooks`），之后才降级内置 R1~R6 快查——加载失败时审查质量不降级
- **guard 校验降级证据**：`builtin-quickcheck` 声明必须同时含不可用原因**和**缓存尝试证据（缺任一 → 渐进 `BROOKS-LINT WARN`，不 BLOCK）
- **guard 识别 `cache-brooks`**：方法行/全文/6 维三处正则更新——干净声明放行无 WARN（此前会被误 BLOCK）
- guard 自测套件扩展至 77 场景（builtin 证据校验 + cache-brooks 接受；RED→GREEN 正确失败原因，两轮独立验证者复验）

### Changed

- Troubleshooting 新增 WARN 条目（双语）；公开 MECHANISM（双语）行为层补两级降级描述；场景数 74→77 全公开文档同步（README/INSTALLATION/MECHANISM/VERSIONS/CONTRIBUTING——历史条目不改）

## [1.2.1] - 2026-08-08

安装引导修复（init/hook/状态修复 + README 指引修复 + 独立验证修复）。([#1](https://github.com/baobaolaodie/flow-comet/pull/1)、[#4](https://github.com/baobaolaodie/flow-comet/pull/4)、[#6](https://github.com/baobaolaodie/flow-comet/pull/6)、[#10](https://github.com/baobaolaodie/flow-comet/pull/10))

### Fixed

- **init state 补 `status: 'running'` + hook 判定三层语义**：此前 init 不写 status，hook 对 status 未定义的 state 放行——open 阶段（首次 guard exit 前）三层防线第一层失效；且归档后 `completed` 状态被 hook 拦截全部写入。修复后：running（含旧 state 无 status 有 activeChange，fail-closed 向后兼容）→ 白名单校验；completed → 放行
- **init 创建 `.specs/<id>/` 目录**：此前 init 后 `next`/`status` 报「No active change. Run: init」（findActiveChange 要求目录存在），与 SKILL 启动协议（init → next）矛盾
- **findActiveChange 归档完成态不兜底扫描**：归档残留目录（含 TASK.md 的旧副本）不再被误判为 active change
- **init currentNode 按协议首节点**：自定义协议首节点非 open 时不再硬编码 open
- **record 命令剥离 `--protocol` 参数**：payload 解析前剥离，防 JSON 解析失败导致结构字段丢失
- **自定义节点协调者默认白名单**：未声明 writeWhitelist 时非内置节点默认 `['.specs/']`（写源码必须显式声明）——防 fail-open 防线出洞
- **旧 state 无 activeChange 放行**：旧 state（无 status + 无 activeChange）不再被 hook 全拦截
- **writeWhitelist 支持 `<change-id>` 占位符**：协议跨 change 复用自动适配
- **init 输出 NODE 取协议首节点**：与 state.currentNode 一致（此前硬编码 open）
- **findActiveChange completed 优先**：归档完成态下 activeChange 残留不再误判
- **hook statePath 缺省回退**：最小 schema 协议（无 state.statePath）不再崩溃
- **三脚本 JSON.parse 容忍 UTF-8 BOM**：外部写入（如会话 Write）带 BOM 的 state/evidence 正常读取
- guard 自测套件扩展至 74 场景（全量正反例 + 独立验证场景 + BOM 容忍）

### Changed

- **README 验证安装**改为四步（结构检查 / 配置可加载性 / 权威源 diff 一致性 / 真实环境冒烟）——guard-self-test 标注为**作者回归基线**（脚本逻辑自测，不依赖安装完整性，不是安装验证判据）
- README 快速开始补 flow-kit 前置依赖提示与新会话生效提示；Requirements 补 flow-kit 安装验证步骤；settings 注入说明补首次创建/已有文件两情形；hook command 补相对路径解析基准（项目根）
- **SKILL 启动协议文档修正**：init 输出即首次路由（NODE: open/协议首节点）；next 在节点 exit 后使用
- **README 重构为多文档结构**（中英双语）：README 索引 + docs/（INSTALLATION/USAGE/PROTOCOL/MECHANISM/TROUBLESHOOTING/VERSIONS）+ compose 示例；公开 repo 移除 VERIFICATION.md（验证记录不属于公开仓库范围）
- **hook blocking 语义实测确认**：主会话 TUI 生效（越权写物理阻止）；claude -p（SDK CLI）软拦截（仅日志）

## [1.2.0] - 2026-08-08

> PR 流程建立前的历史版本——无 PR 链接可引用。

自定义组合 skill（flow-comet-compose）+ 协议参数化 + 非破坏安装器。

### Added

- **flow-comet-compose 引导 skill**：交互式组合任意已安装 skill（superpowers/brooks-lint/自定义）为自定义协议 JSON，复用同一机制驱动（状态路由 + guard 校验 + hook 拦截），不取代内置 8 节点协议
- **协议参数化**：`resolveProtocol` 解析优先级（`--protocol` CLI → `FLOW_COMET_PROTOCOL` 环境变量 → 默认 `reference/workflow-protocol.json`）；`determineNode` 数据化——节点声明由协议 JSON 驱动（ADR-001）
- **特化校验按节点 id 绑定**：通用层防线协议无关（所有协议一律物理校验）；特化层仅内置节点 id 触发，自定义节点不误触发（ADR-002）
- **writeWhitelist 声明化**：协议可声明 hook 写白名单；解析失败用缺省表（fail-closed，防白名单出洞）
- **prepare-env 安装器**：从权威源 `.comet/bundle-drafts/flow-comet/` 生成/覆盖目标项目 `.claude/`（rules + skills + settings 注入）；settings 采用读-合并-写幂等注入（保留 permissions 等既有字段）；`--purge --yes` 显式破坏性重建
- **分支前缀可配置**：`--branch-prefix` 自定义 change 分支前缀（默认 `change/`）
- guard 自测套件扩展至 54 场景（自定义协议/组合场景/节点元素校验/豁免严格化/hook 声明 fail-closed/分支前缀正反例）

### Changed

- **单一权威源**：移除 `.comet/bundles/` 双目录（comet 有 eval/publish 分发才需要；flow-comet 只是复制安装——单一源 `bundle-drafts/`）；README 安装方案改为 prepare-env（方案 A）+ 手动复制（方案 B），删除 comet bundle 分发流程
- **prepare-env 非破坏化**：默认只覆盖生成物（rules/skills）+ settings 注入，不再无条件删除目标 `.claude/`

### Fixed

- **record 覆盖 handoff 越俎代庖**：record 命令整体覆盖 evidence key 时 BLOCK
- **节点乱序/完成标记**：completedChecks 校验、跳过节点 BLOCK
- **redEvidence 时序**：补 redEvidence 的时序校验
- **next 误拦修复**：豁免节点误拦修正
- **hook 声明 fail-closed**：协议 hook 声明解析失败时按缺省表拦截（审查补充）

## [1.1.0] - 2026-08-05

> PR 流程建立前的历史版本——无 PR 链接可引用。

change 分支 + PR 审查 + 追加位置纪律 + 文档重写。

### Added

- **change 分支模式**：`init` 自动创建 `change/<id>` 分支，全流程在分支上进行，归档时合并收尾（merge + 删除分支）
- **PR 审查**：`config set enablePrReview true` 开启，归档前推送分支 + 创建 PR，approve 后合并
- **分支-状态一致性校验**：`status`/`next` 检测分支与 activeChange 不符 → WARN（不 BLOCK）
- **追加位置纪律与结构检测**：CONTEXT 术语/决策插入既有结构段、LESSONS 按 L-NNN 编号插入条目区、STATE 决策日志顶部插入（倒序）、CHANGELOG 表格顶部插入、回退修复追加到 `## Fix 任务` 段；guard 检测（孤立追加段/编号乱序/条目区外/非倒序）WARN 渐进
- guard 自测套件扩展至 23 场景（分支校验 + 追加位置检测正反例）

### Changed

- README 全面重写为完整产品文档（生态关系 / 快速开始 / 工作流总览 / 工件体系 / 核心机制 / 设计原理 / Troubleshooting / 版本与兼容性）
- state-schema 补 `branchMode` / `enablePrReview` 字段校验（boolean）

### Fixed

- LESSONS 乱序检测改**分段**：多段编号体系（`## 活跃条目` / `## 已解决条目` 独立编号）不再误报

## [1.0.0] - 2026-08-04

> PR 流程建立前的历史版本——无 PR 链接可引用。

首个稳定版（8 节点工作流 + 三层防线 + guard 校验体系，经端到端真实项目验证）。

### Added

- 8 节点自动路由工作流（open → design → plan → execute ⇄ subagent-execute → review → verify → archive）
- 自有状态机（`.comet/flow-comet-state.json`）+ determineNode 文件推导 + 自动纠偏
- 三层防线（hook phase 白名单 / 协调者禁令 / exit 越俎代庖检测）
- guard 校验体系：段名模板派生、SUMMARY 六段 + 自检方法强制、TASK 签名哈希、verify 真实执行、verifyFailures 计数、state schema 校验（fail-closed）
- 执行引擎子代理化 + executionMode（subagent 默认 / direct 逃生口）+ Return Contract + handoff hash 溯源
- 横向命令（flow-comet-evolve / flow-comet-health）+ express 降级路径
- guard 自测套件（17 场景）+ 端到端真实项目验证（新项目与既有项目两类场景）
