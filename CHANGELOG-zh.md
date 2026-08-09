<div align="right">

[English](CHANGELOG.md) · [中文](CHANGELOG-zh.md)

</div>

# Changelog

本项目的所有显著变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。版本号仅记录于 git tag 与本文档；`bundle.yaml` 的 version 保持 1.0.0（与发布流程解耦，见 README「版本与兼容性」）。

## [1.2.3] - 2026-08-09

worktree 委托链路修复。

### Fixed

- **路由诊断**：TASK.md task 标签含 `parallel="true"` 但缺 `status="pending"`（旧模板形态）时，路由输出 `ROUTE WARN` 说明属性顺序要求——结构校验保持严格，检测失败可见（不再静默卡在 execute）
- **C4 检查可见化**：worktree 脏检查的 catch 块输出 `C4-CHECK SKIP: <原因>`（此前静默吞错——Windows 下 git 命令失败不可见）
- **WARN COUNT 汇总行**：entry/exit 输出末尾追加 `WARN COUNT: N`（不改变既有输出）
- **空退出文档-实现一致化**：execute SKILL 不再声称「空退出」路径（guard 实际三层 BLOCKED：evidence → 串行 pending → 产物）；文档改为正确路径（直接路由 subagent-execute / 显式 `parallelTakeoverApproved` 豁免）
- **委托前检查清单**：subagent-execute SKILL 强制委托前检查（git status / HEAD / 内联上下文）+ Red Flag；dirty-worktree 协议标注为委托前必做
- guard 自测套件扩展至 82 场景（S79~S83；RED→GREEN 正确失败原因，独立验证者 24 条独立构造断言复验）

### Changed

- Troubleshooting 新增条目（ROUTE WARN / C4-CHECK SKIP / WARN COUNT，双语）；场景数 77→82 全公开文档同步（历史条目不改）

## [1.2.2] - 2026-08-08

6 维自查的 brooks-lint 两级降级路径。

### Fixed

- **brooks-lint 两级降级**：Skill 工具仅返回 "Launching skill" 占位时（worktree 子代理 skill 路由不稳定——插件执行体可能未注入），子代理 **Read 插件缓存协议文件手动执行完整 brooks 审查**（`selfReview: cache-brooks`），之后才降级内置 R1~R6 快查——加载失败时审查质量不降级
- **guard 校验降级证据**：`builtin-quickcheck` 声明必须同时含不可用原因**和**缓存尝试证据（缺任一 → 渐进 `BROOKS-LINT WARN`，不 BLOCK）
- **guard 识别 `cache-brooks`**：方法行/全文/6 维三处正则更新——干净声明放行无 WARN（此前会被误 BLOCK）
- guard 自测套件扩展至 77 场景（S76/S77/S78：builtin 证据校验 + cache-brooks 接受；RED→GREEN 正确失败原因，两轮独立验证者复验）

### Changed

- Troubleshooting 新增 WARN 条目（双语）；公开 MECHANISM（双语）行为层补两级降级描述；场景数 74→77 全公开文档同步（README/INSTALLATION/MECHANISM/VERSIONS/CONTRIBUTING——历史条目不改）

## [1.2.1] - 2026-08-08

安装引导修复（init/hook/状态修复 + README 指引修复 + 独立验证修复）。

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

首个稳定版（8 节点工作流 + 三层防线 + guard 校验体系，经端到端真实项目验证）。

### Added

- 8 节点自动路由工作流（open → design → plan → execute ⇄ subagent-execute → review → verify → archive）
- 自有状态机（`.comet/flow-comet-state.json`）+ determineNode 文件推导 + 自动纠偏
- 三层防线（hook phase 白名单 / 协调者禁令 / exit 越俎代庖检测）
- guard 校验体系：段名模板派生、SUMMARY 六段 + 自检方法强制、TASK 签名哈希、verify 真实执行、verifyFailures 计数、state schema 校验（fail-closed）
- 执行引擎子代理化 + executionMode（subagent 默认 / direct 逃生口）+ Return Contract + handoff hash 溯源
- 横向命令（flow-comet-evolve / flow-comet-health）+ express 降级路径
- guard 自测套件（17 场景）+ 端到端真实项目验证（新项目与既有项目两类场景）
