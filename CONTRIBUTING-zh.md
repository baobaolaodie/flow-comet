<div align="right">

[English](CONTRIBUTING.md) · [中文](CONTRIBUTING-zh.md)

</div>

# 贡献指南

感谢你为 flow-comet 做贡献。本指南覆盖分支模型、PR 流程、合并规则与代码规范——仓库受这些规则保护，遵循它们能让协作顺畅。

## 分支模型

```
feat/xxx ──PR（merge commit）──▶ dev        （集成分支——历史完整）
                                          │
dev ──PR（squash）──▶ main               （发布分支——历史干净）
```

| 分支 | 角色 | 合并方式 | 历史 |
|------|------|---------|------|
| `main` | 发布分支 | **squash** | 干净——每次发布/功能批次一条 |
| `dev` | 集成分支 | **merge commit** | 完整——每个 feature 提交保留、可追溯 |
| `feat/*` | 开发分支 | — | 工作历史，合并后删除 |

**为什么这样拆分**：`dev` 保留每个 TDD 修复的完整历史（可追溯性——每个提交是一个 RED→GREEN 闭环）；`main` 保持干净，便于发布与变更日志管理。

## PR 流程

1. **从 `dev` 创建功能分支**（前缀 `feat/`；bug 修复用 `fix/`）：

   ```bash
   git checkout dev
   git checkout -b feat/<描述>
   ```

2. **在功能分支上开发**——遵循下方[开发规范](#开发规范)。
3. **开 PR 合入 `dev`**（base `dev`，head `feat/<描述>`）。PR 描述写明：改了什么、为什么、验证证据。
4. **获得审核 approve**——需要 1 个 approving review（分支保护）。
5. **合入 `dev`**——用 **merge commit**（保留 feature 历史）。
6. **发布 PR**——`dev` 就绪后，开 PR 合入 `main`（base `main`，head `dev`）。用 **squash** 合并——每次发布一条干净提交。
7. 合并后删除 feature 分支。

## 分支保护（参考）

| 规则 | `main` | `dev` |
|------|--------|-------|
| require pull request reviews | ✅（1 approve） | ✅（1 approve） |
| 禁 force push | ✅ | ❌ 允许（集成 rebase） |
| 禁删除 | ✅ | ✅ |
| stale review 失效 | ✅ | ✅ |

## 开发环境

- **运行时**：Node.js ≥ 18（ESM）
- **仓库**：clone 后先验证回归基线可跑：
  `node .claude/skills/flow-comet/scripts/guard-self-test.mjs` → `ALL 74 SCENARIOS PASSED`
- **创作环境**：Claude Code（skill/hook 在 Claude Code 会话中运行）；hook 通过 `prepare-env` 安装到你的项目 `.claude/`
- **机制相关工作**：动手改脚本前先读 [docs/MECHANISM.md](docs/MECHANISM.md) 了解机制语义（行为层）

## Issues（报告 bug / 提 feature）

开 Issue 时写清描述：

- **Bug**：实际行为 vs 期望、复现步骤（或确切的 BLOCKED/WARN 消息）、环境（Node 版本、安装方式）
- **Feature 提案**：目标、想要的工作流、你设想的 skill 组合（自定义协议见 [PROTOCOL-zh.md](docs/PROTOCOL-zh.md)）

Issue 确认后：bug 用 `fix/` 分支、feature 用 `feat/` 分支——都按[PR 流程](#pr-流程)合入 `dev`。

## 开发规范

- **权威源**：skill/脚本改动在 `.comet/bundle-drafts/flow-comet/skills/`（单一权威源；`.claude/` 副本是安装产物——用 `prepare-env` 更新，勿手改）
- **TDD**：每个机制修复先写 RED 场景（`guard-self-test.mjs`——确认以正确原因失败）→ GREEN → 全量回归
- **回归基线**：`node .claude/skills/flow-comet/scripts/guard-self-test.mjs` → `ALL 74 SCENARIOS PASSED`（每次改动后必须）
- **文档同步**：行为层文档在 `docs/`（中英双语——改文档时两语同步）；实现细节不进公开文档
- **向后兼容**：旧 change/旧 state 照常工作——渐进 WARN 优先于 BLOCK
- **公开文档无内部术语**：无批次编号（E-NN）、无 dogfood/T-FIX/D- 引用、无指向 `docs/internal/` 的链接

## 提交规范

[Conventional Commits](https://www.conventionalcommits.org/zh-CN/)：

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
node .claude/skills/flow-comet/scripts/workflow-state.mjs init <change-id> --branch-prefix feat/   # 功能开发
node .claude/skills/flow-comet/scripts/workflow-state.mjs init <change-id> --branch-prefix fix/    # bug 修复
node .claude/skills/flow-comet/scripts/workflow-state.mjs init <change-id> --branch-prefix docs/   # 文档
```

内置默认前缀是 `change/`（与既有 change 向后兼容）；本仓库规范要求显式指定类型前缀，使分支与改动类型一致——与手动 `feat/`/`fix/` 分支同一惯例。

## 审核要求

- **PR 描述**：改了什么、为什么、验证证据（测试输出、真实会话证据）
- **范围**：代码改动 → 伴随测试 + 回归；文档改动 → 两语同步
- **1 个 approving review**（分支保护）；新推送使旧 approve 失效（dismiss stale reviews）

## 保持 PR 更新

PR 打开期间，保持与 `dev` 同步：

```bash
git fetch origin
git rebase origin/dev        # 把 feature 分支 rebase 到最新 dev
# 有冲突先解决，然后：
node .claude/skills/flow-comet/scripts/guard-self-test.mjs   # 重跑回归
git push --force-with-lease origin feat/<描述>            # feature 分支允许 force push
```

你自己的 feature 分支允许 force push（无保护）；新推送会使旧 approve 失效（dismiss stale reviews），更新后请重新请求审核。

## 发布流程（维护者）

每次发布（见 [VERSIONS-zh.md](docs/VERSIONS-zh.md)）：

1. 更新 CHANGELOG（Added/Changed/Fixed——双语）
2. 更新 README 版本徽章
3. `git tag vX.Y.Z` + push --tags（发布 PR 合入 main 后）
4. prepare-env 发布到全部已安装副本（主仓 `.claude/` + 各目标项目）——发布后逐一验证各副本 `guard-self-test`
