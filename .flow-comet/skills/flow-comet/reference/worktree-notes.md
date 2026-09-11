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

## 4.2. 运行时状态文件的跟踪风险(测试载体实证 2026-08-15)

测试载体(如演练项目)若 git 跟踪 `.flow-comet/flow-comet-state.json`(主仓 gitignore 它,载体可能不同),**恢复/回退操作不得用 `git reset --hard`**——会连带把运行时状态回退到历史版本,状态机倒退(端到端验证实证事故:回退后重跑 init + 重录证据恢复,耗时约 10 分钟)。恢复工件用精确 `git checkout -- <path>`(只回退指定文件),不用整树 reset。

## 4.5. Codex 平台的 worktree 委托差异(实测 2026-08-14)

Codex 环境的子代理(spawn_agent)无 `isolation:"worktree"` 参数——自动 worktree 假定仅 Claude Code 适用。**受支持的工作流是串行执行:Codex 不使用并行委托**——任务逐个走 `execute` 节点交付(写边界天然互斥),直到守卫也能识别手工 worktree 路径为止(属机制变更,尚未落地)。**手工 `git worktree add <路径> -b <分支>` + 在 worktree 内 `codex exec` 委托不是受支持路径(不应使用)**:守卫按 `.claude/worktrees/**` 前缀识别隔离区,手工建出的路径不在该前缀下、不被放行覆盖,写入仍会被协调者白名单拦截——详见下方「hook 会话 root 继承」段。worktree-notes 第 3 节的"委托 prompt 内联全部上游上下文"在 Codex 同样适用且是唯一可靠路径(串行委托时同样建议内联)。**注意**:worktree 同样不含 `flow-kit/` 与 `.agents/`(它们是目标仓库内容,不在 worktree 快照内)——委托 prompt 内联必须覆盖这些依赖。

**hook 会话 root 继承(实测 2026-08-15,与 CC 语义不同;2026-09-12 修订)**:Codex worktree 子代理的**会话 root 仍是主仓库**——写入守卫 hook 以主仓库 `.flow-comet/flow-comet-state.json` 的 `currentNode`/`executionMode` 判定白名单,`execute`/`subagent-execute` 阶段协调者白名单 `.specs/` 会**拦截子代理在 worktree 内写源码**(此前文档声称"worktree 内无 .codex/ → hook 不生效"与实测不符,已修正)。**处理方式(2026-09-12 修订——受支持路径)**:两平台判据不同,覆盖面也不同。CC 侧守卫按路径前缀识别隔离区(`.claude/worktrees/**` 内写入放行);Codex 无 `Agent` 工具的 `isolation: "worktree"` 能力,手工 `git worktree add <任意路径>` 建出的路径不在该前缀下、**不被放行覆盖**,写入仍会被协调者白名单拦截。故 **Codex 平台要求串行执行:不使用并行委托**——任务逐个走 `execute` 节点交付,直到守卫也能识别手工 worktree(属机制变更)。**已废弃的绕过手段(不应使用)**:用 Python `open()` 等 File API 直写曾被记为命令级检测缺口的规避通道——它**绕过写入守卫防线**,不是受支持做法,现明确废止,不得再作为委托方案使用。协调者层面的辅助做法(不改变上述结论):委托 prompt 内联全部上游上下文,验收产物时按 write_files 边界核对。CC 平台的 worktree 子代理在 v1.5.0-rc.2 之前无此问题:runRoot 取进程 cwd(即 worktree 内),区内无 state → 按设计放行;该版起的锚定链把 runRoot 锚到主仓库(`CLAUDE_PROJECT_DIR`),隔离子代理会被误判为协调者而遭白名单拦截——守卫已对 worktree 隔离区放行(区内写源码不受协调者白名单约束,见机制文档 1.4)。

## 5. change 分支 + worktree 组合

分支模式（`branchMode=true`，git 仓库 + init 自动创建 `change/<id>` 分支）下：

- **子代理 worktree 从 change 分支分出**：`isolation: "worktree"` 基于**当前分支**（change/<id>）快照创建，子代理看到的是该分支内容——委托前必须 commit 上游工件，否则子代理看不到未提交改动（同第 3 节规避方式）
- **协调者产物提取路径不变**：仍用 `git show <branch>:<path>` 从 worktree 取回产物，`<branch>` 此时是 `change/<id>`（可用 `git ls-tree change/<id> <path>` 确认存在）
- **分支模式下归档全程在 change/<id> 分支上执行**：entry/exit archive 校验当前分支 = `change/<id>`（提前切走会被 BLOCKED）；**归档 exit 完成后**再做合并收尾——切到默认分支（先探测，不假设 main，如 e2e 项目是 master）`git checkout <默认分支> && git merge change/<id>`，合并完成后 `git branch -d change/<id>` 删除分支
