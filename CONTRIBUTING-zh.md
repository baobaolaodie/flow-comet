<div align="right">

[English](CONTRIBUTING.md) · [中文](CONTRIBUTING-zh.md)

</div>

# 贡献指南

感谢你为 flow-comet 做贡献。本指南覆盖分支模型、PR 流程、合并规则与代码规范——仓库受这些规则保护，遵循它们能让协作顺畅。

## 分支模型

```
feat/xxx ──PR（squash）──▶ dev          （集成分支——change 级提交）
                                          │
dev ──PR(merge)──▶ main    （发布分支——每次发布 1 个 merge 提交；dev 的 change 级提交进入 main）
```

| 分支 | 角色 | 合并方式 | 历史 |
|------|------|---------|------|
| `main` | 发布分支 | **merge** | 发布 PR 把 dev 的 change 级提交合入 main（每次发布 1 个 merge 提交）；每个 PR 的提交永久保留在 main |
| `dev` | 集成分支 | **squash** | 每个 PR 一条 change 级提交——PR 的修复明细在该 PR 的 Commits 列表可查 |
| `feat/*` | 开发分支 | — | 工作历史，合并后删除 |

**为什么这样拆分**：`dev` 承载每个 PR 的**一条 change 级提交**（squash）——稳定、可读的提交序列，每个 PR 是一个单元；PR 的提交历史（每个 TDD 修复）仍可在该 PR 的 Commits 列表查看。`main` 通过**每次发布一个 merge 提交**获得 dev 的全部 change 级提交——PR 历史永久成为 main 的一部分；发布 merge 后 dev 的 tip 成为 main 的祖先，dev 不再领先 main（dev 上不累积已发布历史）。

## PR 流程

1. **从 `dev` 创建功能分支**（前缀 `feat/`；bug 修复用 `fix/`）——**所有改动（含文档）必须经 feature 分支，禁止直接 commit 到 `dev`**：

   ```bash
   git checkout dev
   git checkout -b feat/<描述>
   ```

2. **在功能分支上开发**——遵循下方[开发规范](#开发规范)。
3. **开 PR 合入 `dev`**（base `dev`，head `feat/<描述>`）。**使用仓库 PR 模板**（`.github/PULL_REQUEST_TEMPLATE.md`——改动范围/验证/自查勾选）。PR 描述写明改了什么、为什么、验证证据。**保留完整清单**：涉及项勾 `[x]`、未涉及项留 `[ ]`——**不要删除未勾选项**（清单是 reviewer 判断完整性的依据）。
4. **合并门禁通过**——required CI checks 必须通过（见下方审核要求）；合并前由用户（维护者）审核批准。
5. **合入 `dev`**——用 **squash** 合并：每个 PR 一条 **change 级提交**（PR 的提交仍可在该 PR 的 Commits 列表查看）。`dev` **积累改动**——不要每个改动都发布。
6. **发布 PR（批次）**——`dev` 积累一组相关改动（功能批次或维护批次）后，开**一个**发布 PR 合入 `main`（base `main`，head `dev`）。以 **merge** 合并——merge 提交把 dev 的全部 change 级提交带入 main；dev 的 tip 成为 main 的祖先，发布后 dev 不再领先 main。发布 PR 标题/正文承载公开面发布摘要。
7. 合并后删除 feature 分支。

**维护批次**：纯文档/清理类改动（无行为影响）可积累在一个分支（如 `docs/maintenance-<日期>`）作为**一个** PR 合入 `dev`——减少 PR 数量且不丢可追溯性。

## 分支保护（参考）

| 规则 | `main` | `dev` |
|------|--------|-------|
| require status checks（CI job） | ✅（regression / pr-policy / quality / installer / docs-links——合并必需；release-consistency 仅发布面运行，不 required） | ✅（同上） |
| 禁 force push | ✅ | ✅ |
| 禁删除 | ✅ | ✅ |
| stale review 失效 | ✅ | ✅ |

**发布后**：将 `dev` fast-forward 同步到 `main`——发布 PR merge 后 dev 的 tip 是 main 的祖先，一次零提交的 fast-forward 即可让 dev 与 main 完全一致（在下一个开发 PR 合入 dev 之前立即执行）：

```bash
git checkout dev
git merge main        # fast-forward——dev 与 main 完全一致
git push origin dev
```

dev tip 是 main 祖先正是 fast-forward 成立的原因：不会产生 sync merge 提交。

**hotfix 之后**（hotfix 直接 squash 进 `main`），同步 dev 以免落后 main：

```bash
git checkout dev
git merge --no-ff main -m "sync: main → dev（hotfix <描述>）"
git push origin dev
```

**hotfix 快路径**（生产紧急修复，不等 dev 发布节奏）：

```bash
git checkout main
git checkout -b hotfix/<描述>
# 修复 → 提交（fix: subject）→ 测试
# hotfix 以 squash 合并——1 个干净提交进 main（发布 PR 用 merge；hotfix 用 squash 保持紧急修复原子性）
git checkout main && git merge --squash hotfix/<描述> && git commit -m "fix: hotfix <描述>"
git checkout dev && git merge --no-ff main -m "sync: main → dev（hotfix <描述>）"
git branch -d hotfix/<描述>
```

## 新贡献者入门

1. **读 README** —— 快速开始展示了一个最小工作流。
2. **选一个入门 issue** —— 标记为 `good first issue` 的 issue 适合新贡献者。
3. **准备环境** —— Node.js ≥ 18；clone 仓库；运行一次 `node scripts/install-commit-hook.mjs`（本地提交/推送消息检查）。
4. **验证基线** —— 运行回归套件（见下方开发环境）。
5. **不确定改动是否被需要？** 先开 issue —— issue 模板会引导你提供所需上下文。

## 开发环境

- **运行时**：Node.js ≥ 18（ESM）
- **仓库**：clone 后先验证回归基线可跑：
  `node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs` → `ALL 167 SCENARIOS PASSED`（统一测试集两级基线，另需 `system-test.mjs` → `ALL SYSTEM TESTS PASSED`，61 项）
- **创作环境**：Claude Code（skill/hook 在 Claude Code 会话中运行）；hook 通过 `prepare-env` 安装到你的项目 `.claude/`（同一安装器服务 Codex（`--platform codex`）与 DeepSeek Harness（dsh，`--platform dsh`）——项目级技能树、AGENTS.md 托管规则与全局桥接 loader）
- **机制相关工作**：动手改脚本前先读 [docs/MECHANISM.md](docs/MECHANISM.md) 了解机制语义（行为层）

### CI 强制检查与本地 hook

CI 在每个 PR 与 push 时自动运行——服务端强制仓库约定（回归套件含场景数与公开产物代号自检、脚本语法、BOM 防线、安装器可复现性（覆盖 Claude Code / Codex / DeepSeek Harness（dsh）三个平台）、workflow yaml 有效性、PR 模板完整性、提交规范（Conventional Commits）、版本一致性、CHANGELOG PR 链接、死链）。

**本地 hook**（clone 后安装一次）：

```bash
node scripts/install-commit-hook.mjs   # 设置 core.hooksPath → .githooks/
```

hook 在提交与推送时拒绝含过程代号（修复编号、批次代号、场景编号等——本项目的工程约定，非通用词表）的提交信息。提交信息是公开产物，请保持平实描述（见下方提交规范）。

推送前运行回归基线：

```bash
node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs   # → ALL 167 SCENARIOS PASSED
```

其余由 CI 处理。

## Issues（报告 bug / 提 feature）

开 Issue 时写清描述：

- **Bug**：实际行为 vs 期望、复现步骤（或确切的 BLOCKED/WARN 消息）、环境（Node 版本、安装方式）
- **Feature 提案**：目标、想要的工作流、你设想的 skill 组合（自定义协议见 [PROTOCOL-zh.md](docs/PROTOCOL-zh.md)）

Issue 确认后：bug 用 `fix/` 分支、feature 用 `feat/` 分支——都按[PR 流程](#pr-流程)合入 `dev`。

## 开发规范

- **权威源**：skill/脚本改动在 `.comet/bundle-drafts/flow-comet/skills/`（单一权威源；`.claude/` 副本是安装产物——用 `prepare-env` 更新，勿手改）
- **TDD**：每个机制修复先写 RED 场景（`guard-self-test.mjs`——确认以正确原因失败）→ GREEN → 全量回归
- **回归基线**：`node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs` → `ALL 167 SCENARIOS PASSED`（统一测试集两级基线，另需 `system-test.mjs` → `ALL SYSTEM TESTS PASSED`，61 项）（每次改动后必须）
- **文档同步**：行为层文档在 `docs/`（中英双语——改文档时两语同步）；实现细节不进公开文档
- **双语纪律**：英文文档不含中文（语言切换器、flow-kit 工件段名、运行时消息原文除外）；中文文档不含英文长句（命令、URL、专有术语除外）
- **向后兼容**：旧 change/旧 state 照常工作——渐进 WARN 优先于 BLOCK
- **公开文档不使用代号、编号或行话**：README/docs/CHANGELOG/提交信息保持一致

## 提交规范

[Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

> **提交信息是公开产物**——在 GitHub 的 git 历史中可见。请写纯描述：**不使用代号、编号或行话**。与 CHANGELOG 和公开文档同一语言标准。示例：`fix: brooks 6 维自查两级降级路径`。

```
<type>(<scope>): <subject>

feat:      新功能 / 新机制
fix:       bug 修复（机制、脚本、hook）
refactor:  保持行为不变的重构
perf:      性能优化
docs:      文档（README、docs/、CHANGELOG）
test:      仅测试改动（guard-self-test 场景）
build:     构建/工具改动（脚本、安装器）
ci:        CI 管道改动
chore:     工具、发布收尾
revert:    回滚之前的提交
```

示例：

```
fix: init state 补 status:'running' + hook 判定三层语义
docs: README 重构为多文档中英双语结构
test: BOM 容忍场景——带 UTF-8 BOM 的 state/evidence 文件正常解析
```

**分支前缀对齐**：前缀应与改动类型匹配，而非固定默认。按开发方式二选一：

- **纯 git 开发**（不经 flow-comet 工作流）：`git checkout -b feat/<描述>`（或 `fix/` 等）——见[PR 流程](#pr-流程)
- **经 flow-comet 工作流开发**：`init` 自动建分支——指定匹配的前缀：

```bash
# 权威源路径（开发态）；安装副本路径随平台：Claude Code .claude/skills/ / Codex .agents/skills/
node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/workflow-state.mjs init <change-id> --branch-prefix feat/   # 功能开发
node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/workflow-state.mjs init <change-id> --branch-prefix fix/    # bug 修复
node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/workflow-state.mjs init <change-id> --branch-prefix docs/   # 文档
```

内置默认前缀是 `change/`（与既有 change 向后兼容）；本仓库规范要求显式指定类型前缀，使分支与改动类型一致——与手动 `feat/`/`fix/` 分支同一惯例。

## 审核要求

- **PR 描述**：改了什么、为什么、验证证据（测试输出、真实会话证据）
- **范围**：代码改动 → 伴随测试 + 回归；文档改动 → 两语同步
- **合并门禁**：required CI checks 必须通过；合并前由用户（维护者）审核批准。

## Bot 审查（CodeRabbit / Sourcery）

- **仅供参考**：bot 评论是建议而非要求——bot 也会出错。以你自己的判断（与维护者审核）为准，不要盲从 bot 建议。
- **可执行 vs 信息性**：bot 评论提出具体修改要求（修复、澄清、补测试）才算*可执行*；信息性评论（总结、提问、赞许）无需处理。
- **合并前处理**：每条可执行的 bot 评论必须处理——修复它，或在其线程内回复说明拒绝理由。完成后解决线程。
- **保持 PR 时间线干净**：在 bot 评论的线程内回复，不要在时间线新开 @ 评论。行内评论用线程回复；整体 review（无线程）用引用原文的 quote reply。
- **Bot checks 与 required CI checks**：只有 CI job（regression / pr-policy / quality / installer / docs-links）是合并必需。Bot checks（CodeRabbit / Sourcery）是信息性的——在 checks 面板可能显示 pending 或被限流，不阻塞合并。

## CHANGELOG 写作规范

- **开发 PR（→ dev）**：行为变化记入 CHANGELOG 的 `Unreleased` 段（新增/变更/修复，双语）——PR 自身更新 CHANGELOG。
- **发布前（dev 上）**：版本号在 dev 上定好——`Unreleased` 整理为 `[X.Y.Z] - 日期` 版本段，链接该批次已合并的开发 PR。
- **发布 PR（dev → main）**：不更新 CHANGELOG——版本段已在 dev 上；发布 PR 只把它合并进 main。
- **main**：从不单独编辑 CHANGELOG——通过发布 PR 合并获得版本段。
- **发布后**：dev 自动与 main 树一致（发布 PR 把 dev 合入 main 历史），重新开启 `Unreleased` 段积累下一批次。

## 保持 PR 更新

PR 打开期间，保持与 `dev` 同步：

```bash
git fetch origin
git rebase origin/dev        # 把 feature 分支 rebase 到最新 dev
# 有冲突先解决，然后：
node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs   # 重跑回归
git push --force-with-lease origin feat/<描述>            # feature 分支允许 force push
```

你自己的 feature 分支允许 force push（无保护）；新推送会使旧 approve 失效（dismiss stale reviews），更新后请重新请求审核。

## 发布流程（维护者）

**发布审批单**——每次发布前向用户呈现以下清单并取得**一次**审批，然后连续执行完整发布（合并发布 PR + 三处发布 + tag），不再逐步询问：

```markdown
## 发布审批单

- 包含改动：PR 列表 + 每项一句话摘要
- 验证结果：回归（167 场景）/ 安装副本验证
- 版本：X.Y.Z（文档批次可不 bump）
```

**发布步骤**：五步清单（CHANGELOG → README 徽章 → tag → prepare-env 分发 → dev 同步）见 [VERSIONS-zh.md](docs/VERSIONS-zh.md)。

**发布 PR 要点**：
- 发布 PR（dev → main）天然列出 dev 的全部 change 级提交（dev 是 change 级提交序列）——这是设计；合并后这些提交经每次发布的一个 merge 提交进入 main
- 用 `gh pr merge --merge` 合并——merge 提交消息为 GitHub 默认（`Merge pull request #N from dev`，公开面语言）；发布 PR 标题与正文承载发布摘要，过程细节不会进入 main 的历史
