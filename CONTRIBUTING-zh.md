<div align="right">

[English](CONTRIBUTING.md) · [中文](CONTRIBUTING-zh.md)

</div>

# 贡献指南

感谢你为 flow-comet 做贡献。本指南覆盖分支模型、PR 流程、合并规则与代码规范——仓库受这些规则保护，遵循它们能让协作顺畅。

## 分支模型

```
feature/xxx ──PR（merge commit）──▶ dev        （集成分支——历史完整）
                                          │
dev ──PR（squash）──▶ main               （发布分支——历史干净）
```

| 分支 | 角色 | 合并方式 | 历史 |
|------|------|---------|------|
| `main` | 发布分支 | **squash** | 干净——每次发布/功能批次一条 |
| `dev` | 集成分支 | **merge commit** | 完整——每个 feature 提交保留、可追溯 |
| `feature/*` | 开发分支 | — | 工作历史，合并后删除 |

**为什么这样拆分**：`dev` 保留每个 TDD 修复的完整历史（可追溯性——每个提交是一个 RED→GREEN 闭环）；`main` 保持干净，便于发布与变更日志管理。

## PR 流程

1. **从 `dev` 创建功能分支**（前缀 `feature/`；bug 修复用 `fix/`）：

   ```bash
   git checkout dev
   git checkout -b feature/<描述>
   ```

2. **在功能分支上开发**——遵循下方[开发规范](#开发规范)。
3. **开 PR 合入 `dev`**（base `dev`，head `feature/<描述>`）。PR 描述写明：改了什么、为什么、验证证据。
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
docs:      文档（README、docs/、CHANGELOG）
chore:     工具、发布收尾
test:      仅测试改动（guard-self-test 场景）
```

示例：

```
fix: init state 补 status:'running' + hook 判定三层语义
docs: README 重构为多文档中英双语结构
test: D-22 补测——S74/S75 BOM 容忍场景
```

## 审核要求

- **PR 描述**：改了什么、为什么、验证证据（测试输出、真实会话证据）
- **范围**：代码改动 → 伴随测试 + 回归；文档改动 → 两语同步
- **1 个 approving review**（分支保护）；新推送使旧 approve 失效（dismiss stale reviews）

## 发布流程（维护者）

每次发布（见 [VERSIONS-zh.md](docs/VERSIONS-zh.md)）：

1. 更新 CHANGELOG（Added/Changed/Fixed——双语）
2. 更新 README 版本徽章
3. `git tag vX.Y.Z` + push --tags（发布 PR 合入 main 后）
4. prepare-env 发布到全部已安装副本（主仓 `.claude/` + 各目标项目）——发布后逐一验证各副本 `guard-self-test`
