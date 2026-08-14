---
name: worktree-notes
description: "跨仓库 worktree 场景笔记：isolation:worktree 挂载在会话项目根、W2-D 提交校验跨仓库失效属预期降级、规避方式与验证命令。"
---

# Worktree 跨仓库场景笔记

## 1. worktree 挂载位置：会话项目根，不是子代理目标项目

Agent 工具 `isolation: "worktree"` 创建的 worktree 挂在**会话项目根**（`git worktree list` 确认），不是子代理要工作的目标项目仓库。

跨仓库端到端 / 多仓库场景下：

- worktree 内容来自**父项目**（会话项目）的当前分支快照，与子代理目标仓库无关
- 子代理产物不会自动进入目标仓库，需手动搬运：在目标仓库内用 `git show <branch>:<path>` 取回内容，或先 `git log --all --oneline -- <path>` 定位产物所在 commit 再 cherry-pick / 复制
- 不要在子代理里假设"我就在目标仓库里"——先确认 cwd 与 worktree 根

## 2. W2-D 提交文件子集校验的预期降级

W2-D 用 `git show <commitHash>` 校验提交文件子集。当产物 commit 属于**其他仓库**（不属于当前仓库）时该校验失效：`git show` 找不到该 commit，报 HANDOFF ERROR，但**不阻断记录**——协调者仍记录 handoff，流程继续。属预期降级，不是 bug，不需要修复。

## 3. 规避方式

1. **委托 prompt 内联全部上游上下文**：AC / 设计 / 任务块全文写进委托 prompt，子代理不依赖 worktree 里的工件
2. **委托前 commit 上游工件**：把 `.specs/<change>/` 工件先 commit，配合脏检查 WORKTREE WARN（entry execute / entry subagent-execute 检测未提交工件并提示）
3. **单仓库场景不受影响**：worktree 与目标项目同根（同一仓库）时无此问题
4. **委托回报后立即提取**：子代理回报 commitHash 后**立即**用 `git show <branch>:<path>` 提取产物到目标仓库——worktree 任务结束清理后，提交对象可能不可见（悬挂对象被回收/分支删除），回报时提取可避免产物丢失

## 4. 验证方法

```bash
git worktree list                # 确认 worktree 挂在哪个仓库/分支（会话项目根）
git ls-tree <branch> <path>      # 确认产物在目标仓库哪个分支、路径是否存在
```

## 4.5. Codex 平台的 worktree 委托差异(实测 2026-08-14)

Codex 环境的子代理(spawn_agent)无 `isolation:"worktree"` 参数——自动 worktree 假定仅 Claude Code 适用。Codex 协调者委托并行任务时须**手动** `git worktree add <路径> -b <分支>` + 在 worktree 内 `codex exec` 委托,或对并行任务串行收敛(写边界仍互斥)。worktree-notes 第 3 节的"委托 prompt 内联全部上游上下文"在 Codex 同样适用且是唯一可靠路径。

## 5. change 分支 + worktree 组合

分支模式（`branchMode=true`，git 仓库 + init 自动创建 `change/<id>` 分支）下：

- **子代理 worktree 从 change 分支分出**：`isolation: "worktree"` 基于**当前分支**（change/<id>）快照创建，子代理看到的是该分支内容——委托前必须 commit 上游工件，否则子代理看不到未提交改动（同第 3 节规避方式）
- **协调者产物提取路径不变**：仍用 `git show <branch>:<path>` 从 worktree 取回产物，`<branch>` 此时是 `change/<id>`（可用 `git ls-tree change/<id> <path>` 确认存在）
- **分支模式下归档前必须已切回主分支**：归档收尾在 main 上执行（`git checkout main && git merge change/<id>`）；entry archive 校验当前分支 = `change/<id>`，**合并前不得提前切走**，合并完成后 `git branch -d change/<id>` 删除分支
