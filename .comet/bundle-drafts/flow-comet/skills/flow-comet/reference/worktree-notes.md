---
name: worktree-notes
description: "跨仓库 worktree 场景笔记：isolation:worktree 挂载在会话项目根、W2-D 提交校验跨仓库失效属预期降级、规避方式与验证命令。"
---

# Worktree 跨仓库场景笔记

## 1. worktree 挂载位置：会话项目根，不是子代理目标项目

Agent 工具 `isolation: "worktree"` 创建的 worktree 挂在**会话项目根**（`git worktree list` 确认），不是子代理要工作的目标项目仓库。

跨仓库 dogfood / 多仓库场景下：

- worktree 内容来自**父项目**（会话项目）的当前分支快照，与子代理目标仓库无关
- 子代理产物不会自动进入目标仓库，需手动搬运：在目标仓库内用 `git show <branch>:<path>` 取回内容，或先 `git log --all --oneline -- <path>` 定位产物所在 commit 再 cherry-pick / 复制
- 不要在子代理里假设"我就在目标仓库里"——先确认 cwd 与 worktree 根

## 2. W2-D 提交文件子集校验的预期降级

W2-D 用 `git show <commitHash>` 校验提交文件子集。当产物 commit 属于**其他仓库**（不属于当前仓库）时该校验失效：`git show` 找不到该 commit，报 HANDOFF ERROR，但**不阻断记录**——协调者仍记录 handoff，流程继续。属预期降级，不是 bug，不需要修复。

## 3. 规避方式

1. **委托 prompt 内联全部上游上下文**：AC / 设计 / 任务块全文写进委托 prompt，子代理不依赖 worktree 里的工件
2. **委托前 commit 上游工件**：把 `.specs/<change>/` 工件先 commit，配合批次 C 的 C4 WORKTREE WARN（entry execute / entry subagent-execute 检测未提交工件并提示）
3. **单仓库场景不受影响**：worktree 与目标项目同根（同一仓库）时无此问题

## 4. 验证方法

```bash
git worktree list                # 确认 worktree 挂在哪个仓库/分支（会话项目根）
git ls-tree <branch> <path>      # 确认产物在目标仓库哪个分支、路径是否存在
```
