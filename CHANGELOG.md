# Changelog

本项目的所有显著变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。版本号仅记录于 git tag 与本文档；`bundle.yaml` 的 version 保持 1.0.0（与 bundle 发布流程解耦，见 README「版本与兼容性」）。

## [1.1.0] - 2026-08-05

批次 E（change 分支 + PR 审查 + 追加位置纪律）+ 文档重写。

### Added

- **change 分支模式**：`init` 自动创建 `change/<id>` 分支，全流程在分支上进行，归档时合并收尾（merge + 删除分支）
- **PR 审查**：`config set enablePrReview true` 开启，归档前推送分支 + 创建 PR，approve 后合并
- **分支-状态一致性校验**：`status`/`next` 检测分支与 activeChange 不符 → WARN（不 BLOCK）
- **追加位置纪律与结构检测**：CONTEXT 术语/决策插入既有结构段、LESSONS 按 L-NNN 编号插入条目区、STATE 决策日志顶部插入（倒序）、CHANGELOG 表格顶部插入、T-FIX 追加到 `## Fix 任务` 段；guard 检测（孤立追加段/编号乱序/条目区外/非倒序）WARN 渐进
- guard 自测套件扩展至 23 场景（分支校验 + 追加位置检测正反例）

### Changed

- README 全面重写为完整产品文档（生态关系 / 快速开始 / 工作流总览 / 工件体系 / 核心机制 / 设计原理 / Troubleshooting / 版本与兼容性）
- state-schema 补 `branchMode` / `enablePrReview` 字段校验（boolean）

### Fixed

- E7 LESSONS 乱序检测改**分段**：多段编号体系（`## 活跃条目` / `## 已解决条目` 独立编号）不再误报

## [1.0.0] - 2026-08-04

首个稳定版（批次 A-D 内部迭代，含两轮端到端 dogfood 验证）。

### Added

- 8 节点自动路由工作流（open → design → plan → execute ⇄ subagent-execute → review → verify → archive）
- 自有状态机（`.comet/flow-comet-state.json`）+ determineNode 文件推导 + P0-2 自动纠偏
- 三层防线（hook phase 白名单 / 协调者禁令 / exit 越俎代庖检测）
- guard 校验体系：段名模板派生、SUMMARY 六段 + 自检方法强制、TASK 签名哈希、verify 真实执行、verifyFailures 计数、state schema 校验（fail-closed）
- 执行引擎子代理化 + executionMode（subagent 默认 / direct 逃生口）+ Return Contract + handoff hash 溯源
- 横向命令（flow-comet-evolve / flow-comet-health）+ express 降级路径
- guard 自测套件（17 场景）+ 两轮端到端 dogfood 验证（greenfield + brownfield）
