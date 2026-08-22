<div align="right">

[English](VERSIONS.md) · [中文](VERSIONS-zh.md)

</div>

# 版本与兼容性

## 版本策略

| 项 | 说明 |
|----|------|
| **当前版本** | v1.5.0-rc.1。发布真相：[CHANGELOG-zh.md](../CHANGELOG-zh.md) + git tag（发布步骤创建）；README 徽章镜像；`skills/flow-comet/INSTALLED_VERSION` 为安装副本元数据（源仓库 git describe）。dsh 平台（经 `prepare-env --platform dsh`）在项目级技能副本中携带同一版本标识；无独立 npm 包（留后续）。v1.0.0 = 首个稳定版：8 节点工作流 + 三层防线 + guard 校验体系 |
| **版本策略** | 语义化版本：新功能发布 → minor（1.2.0）、bug 修复 → patch（1.1.1）、破坏性变更 → major（2.0.0）；每次功能发布完成时 bump |
| **bundle 版本解耦** | `bundle.yaml`/`skill.yaml` 的 version 保持 1.0.0（与发布版本解耦）；git tag + CHANGELOG 是版本唯一事实来源 |

## 依赖

| 类型 | 项 |
|------|-----|
| **必需** | [flow-kit](https://github.com/rihebty/flow-kit)（方法论与工件模板）；Claude Code |
| **平台** | Claude Code（skill 体系，默认）；Codex（技能/规则/hook 经 `prepare-env --platform codex`，见[安装](INSTALLATION-zh.md#平台)）；DeepSeek Harness（项目级技能 + 全局桥接 loader，经 `prepare-env --platform dsh`，见[安装](INSTALLATION-zh.md#方案-c--deepseek-harnessdsh-平台)）；不保证 Gemini/Cursor |
| **运行时** | Node.js ESM（Node ≥ 18）；工件语言与项目主语言一致 |

## 兼容策略

- 旧 change/旧 state 自动补默认字段（executionMode/branchMode/enablePrReview）；无分支 change 照常运行——向后兼容
- 旧 change 重入渐进 WARN 不 BLOCK（redEvidence/greenEvidence 缺失、纯字符串 handoff）
- 回归基线（两级）：`guard-self-test.mjs` 171 场景 + `system-test.mjs` 61 项全绿（每次改动后必须）
- dsh 平台：项目级技能副本携带与 flow-comet 发布版本同步的 `INSTALLED_VERSION` 标识；卸载经 `prepare-env --purge --platform dsh --yes`（见[安装](INSTALLATION-zh.md#方案-c--deepseek-harnessdsh-平台)）

## 发布 checklist（每次发布收尾）

发布按**批次**进行：`dev` 积累功能改动后统一发布（一个发布 PR 对应一个批次）。发布前呈现**发布审批单**（包含改动 / 验证结果 / 版本号）并取得一次审批。

1. 更新 CHANGELOG（Added/Changed/Fixed——含 PR 链接）
2. 更新 README 版本徽章 + 版本状态
3. `git tag vX.Y.Z` + push --tags
4. prepare-env 发布到全部已安装副本（主仓 `.claude/` + 各目标项目）——功能改动时
5. 将 `dev` fast-forward 同步到 `main`（发布 merge 后立即执行）——发布 PR merge 使 dev tip 成为 main 祖先，dev 上 `git merge main` 为零提交 fast-forward，dev 与 main 完全一致（无 sync merge 提交）
