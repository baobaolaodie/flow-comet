---
name: flow-comet-subagent-execute
description: "Use only when explicitly invoked as /flow-comet-subagent-execute or routed by the flow-comet entry/runtime to the subagent-execute Node; complete Subagent Execute for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

<!-- 手写区详细协议见 GUIDANCE.md（可选阅读） -->

# Subagent Execute

## Node Goal

Complete the `subagent-execute` Node for `flow-comet`.

Responsibility: 委托 [P] 并行任务给子代理，要求加载 flow-comet-dev 并回传 evidence。

职责分工（趟次协作）：本节点负责**并行委托**（`parallel="true"` 且依赖已满足的任务，同一趟内同时发出）——委托节点可多次往返：每趟委托当时全部依赖已满足的并行任务，趟间由 execute 节点串行消化，直至不存在依赖已满足的可并行 pending 且无串行残留。execute 节点负责**串行委托**（非 parallel 任务，一次一个）。两者共用同一委托证据库（handoff 记录在 subagent-execute evidence）。序列形态不是本节点的关注点：全并行、全串行、串→并、并→串及任意混排均合法（合法性只取决于 `depends_on` 无环且引用存在；依赖环与缺失依赖已在 plan 出口拦截并附恢复指引），到达本节点的任务序列由多趟路由按依赖拓扑自动分趟消化。

> **Codex 平台委托方式（2026-08-13 调研修正 + 实测）**：Codex CLI 无 `--worktree` 一键 flag（openai/codex#12862 跟踪中），但 git worktree 是标准支持方式（Codex App 内置 worktree；子代理运行时自动创建 worktree 隔离）——本节点委托与 Claude Code 的 worktree 隔离语义对齐：协调者对每个 parallel 任务 `git worktree add <worktree路径> -b <分支>` → 在 worktree 内 `codex exec` 委托（fresh-context，prompt 内联任务块 + AC + 强制加载 flow-comet-dev 与回传 Return Contract，`</dev/null>` 防 stdin 卡住）→ 子代理回报 commitHash 后校验存在性 + 任务完成回收（`git worktree remove`）。
> **沙箱要求（实测 2026-08-13）**：worktree 的 `.git` 是主仓共享——`workspace-write`/`git-write-access` 沙箱均被 Codex 硬拦截（index.lock / objects / COMMIT_EDITMSG Permission denied）；子代理必须用 `sandbox_mode="danger-full-access"` 才能完成 git 提交（worktree 隔离已限定写范围，full-access 仅用于让 git 提交可行）。**信任边界**：`danger-full-access` 是宿主级信任边界（不隔离凭据/网络访问）——仅委托可信子代理，并移除委托环境中的不必要凭据。
> **hook 会话 root 继承（实测 2026-08-15）**：Codex worktree 子代理的会话 root 仍是主仓库，hook 以主仓库状态判定——`execute`/`subagent-execute` 阶段协调者白名单 `.specs/` 会拦截子代理在 worktree 内写源码（与 CC 子代理"无 state 放行"语义不同）。规避：子代理用 Python `open()` 等 File API 直写（命令级检测限制）或协调者代操作；详见 worktree-notes 4.5。handoff 记录（workflow-handoff request/result）与 Return Contract 校验机制不变。

## Guidance

### 必填段清单（结构+存在级）

| 文件 | guard 强制段（缺失 = BLOCKED） | 其余模板段（模板要求，guard 不拦） |
|------|-------------------------------|-----------------------------------|
| SUMMARY.md | `## verify 输出` / `## 6 维自查`（须含实质内容）/ `## 越界检查` / `## 自检方法` | `## 做了什么` / `## 改动文件` 等（执行纪律，review 把关） |

> **注意**：flow-kit 的 SUMMARY 模板**不含 `## 自检方法` 段**——该段是 flow-comet 的强制增量（guard 校验自检方法声明）。使用 `flow-kit/templates/SUMMARY.md` 填写后，**必须按上方必填段清单补写 `## 自检方法` 段**，否则新 change 的 exit 会被 BLOCKED。
>
> **无 parallel 任务时**：若路由到此节点但 TASK.md 无 `parallel="true" status="pending"` 任务（如全部任务已被 execute 串行处理），按常规流程记录证据后直接退出（entry → record → exit），不要空转等待。

加载声明（阶段层 · 双步硬规则）见下文 Required Skill Calls 节。

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B；「填得好不好」由 review 把关。

# Subagent Execute

## Node Goal

This node parallelizes execution by delegating independent tasks (marked `parallel="true"` in TASK.md) to separate subagents. Each subagent loads the full `flow-comet-dev` protocol and operates within its task's `read_files`/`write_files` boundaries. This node produces handoff evidence for each delegated task and marks them done in TASK.md after all subagents complete. It exists to exploit parallelism when tasks have no file conflicts.

Division of labor (pass-based collaboration): this node handles parallel delegation (`parallel="true"` tasks whose dependencies are satisfied — all of them dispatched concurrently within a pass) and may be entered multiple times across passes: each pass delegates every currently eligible parallel task, serial tasks are digested by the `execute` node between passes, and the node counts as complete only when no dependency-satisfied parallel task and no serial task remains. The `execute` node handles serial delegation (non-parallel tasks, one at a time). Both share the same delegation evidence library (handoff recorded under subagent-execute evidence). Sequence shape is not this node's concern: all-parallel, all-serial, serial→parallel, parallel→serial, and any mixed interleaving are all legal (legality depends only on an acyclic `depends_on` graph whose references all exist; cycles and missing dependencies are already intercepted at the plan exit with recovery guidance), and any sequence reaching this node is digested pass by pass by multi-pass routing along the dependency topology.

## Guidance

### 协调者禁令（最高优先级）

主会话是协调者，不是执行者。禁止在主会话直接修改源码或执行实现。源码只能通过 `Agent` 工具以 `isolation: "worktree"` 委托子代理完成。子代理派发失败时，主会话**不得接管实现**——记录当前任务为 BLOCKED 并走 Recovery。协调者只允许更新：TASK.md（标记 done）、`<task>-SUMMARY.md`、handoff evidence（workflow-handoff.mjs result）。

### Prerequisites

- `.specs/<change-id>/TASK.md` must exist with at least one task marked `parallel="true"` and `status="pending"`.
- `.specs/<change-id>/DESIGN.md` or `DESIGN-lite.md` must exist.
- `.specs/LESSONS.md` must exist (or be created).
- The orchestrating agent must have the `Agent` tool available for spawning subagents.

### Steps

0. **委托前检查清单（必做——未 commit 的工件不会被 worktree 子代理看到，曾导致子代理空上下文运行）**：
   - ① `git status --short`：change 工件（`.specs/<change-id>/`）**必须已 commit**——未 commit 时 worktree 子代理看不到工件（harness 从已提交 HEAD 创建 worktree）
   - ② `git log --oneline -1`：确认 HEAD 位置（change 分支）
   - ③ 委托 prompt **必须内联任务块全文 + 相关 AC**（worktree 基线可能不是 change 分支——harness 行为不可控，内联是唯一可靠路径）
   - **Red Flag**：worktree 工件不可见/基线不确定时**禁止继续委托**——先 commit 或内联上下文
   - 委托后：子代理回报 commitHash 后校验存在性（`git cat-file -e <commitHash>`，workflow-handoff result 已有 W2-D git show 校验兜底）

1. **Identify parallel tasks**: Read TASK.md and find all tasks with `parallel="true"` and `status="pending"`. Verify they are genuinely independent (no file conflicts between them — check `write_files` do not overlap).

2. **For each parallel task, create handoff request**: Use `workflow-handoff.mjs request <task-id>` to register the handoff. **委托即记 request**——直接记录 result 而无对应 request 时,write_files 允许列表为空会被 BLOCKED(新 change 强制委托边界),补 request 后再重录 result 即可。
   > 若不传 `--write-files`，脚本会自动从 TASK.md 对应 task 的 `<write_files>` 块解析（orchestrator 无需手动从 TASK.md 提取文件列表）。
   The handoff prompt must include:
   - The task's full XML block from TASK.md.
   - DESIGN.md sections 0 and 0.5 for context.
   - REQUIREMENT.md ACs relevant to this task.
   - Explicit instruction to **use the Skill 工具** to load `flow-comet-dev` and follow its full protocol `flow-kit/prompts/4-dev.md`（不得跳过——读取 SKILL.md 文件不叫加载，跑声明命令也不叫加载；加载 = Skill 工具把 skill 注入会话）。
   - Explicit requirement to return `completedChecks` in the Return Contract containing `required-skill:subagent-execute.flow-comet-dev`（证明已加载 implementation skill；guard W1-D 严格校验，缺失 → exit BLOCKED，无旧 change 豁免）。
   - The task's `read_files` and `write_files` boundaries.
   - Instruction to produce `<task-id>-SUMMARY.md` in `.specs/<change-id>/` following the `flow-kit/templates/SUMMARY.md` template（标题/首部/段序保真，另补 flow-comet 增量 `## 自检方法` 段）。
   - **提交边界警告**:提交**只含该任务 write_files 范围内的文件**(含测试文件)——不得包含 TASK.md 与其他协调者维护的 .specs 工件(新 change 提交越界 BLOCKED;实测子代理提交含 TASK.md 被 W2-D 拦截)。**提交从属规则**:任务专属的 `<task-id>-SUMMARY.md`(位于 `.specs/<change-id>/`,是 flow-comet 强制产物)允许随任务提交属流程默认豁免——目标仓库的既有规定优先,若目标仓库忽略清单等既有规定拒绝其入库,被拒即为正确行为,严禁 force-add 强加越库提交;委托校验对任务摘要的豁免属于校验宽容度,不是入库指令。

3. **Delegate to subagents**（强制 worktree isolation）: 所有并行子代理**必须**使用 `Agent` 工具的 `isolation: "worktree"`，**禁止共享 cwd 直接委托**——hook 白名单依赖 worktree 隔离：子代理 cwd 无 `.comet/flow-comet-state.json`（.gitignore 排除）时 hook 放行源码写入，共享 cwd 的子代理会被 subagent-execute 白名单误拦。Each subagent:
   - Reads TASK.md for its specific task block.
   - Executes the full TDD protocol (RED/GREEN/REFACTOR). **纯文档/纯配置任务无生产代码可测时，`redEvidence` 与 `greenEvidence` 均允许 `{"command":"N/A (non-code task)","output":"..."}` 形态**（guard W1-D 接受此形状；不得伪造测试输出）。
   - Greps existing abstractions (R6.4).
   - Scans LESSONS (R1.8).
   - Runs verify command and records real output.
   - Performs self-review (brooks-lint or 6-dimension quick check).
   - Performs diff boundary check (R6.5).
   - Makes atomic commit with format `<type>(<scope>): <subject>` (scope optional: short subsystem noun; change-id, dates and task ids must NOT be used as scope; task id goes in the commit body as a `Task: <task-id>` trailer).
   - Writes `<task-id>-SUMMARY.md` to `.specs/<change-id>/`.
   - Returns evidence via `workflow-handoff.mjs result <task-id>`.

4. **Collect evidence**: After all subagents complete, verify each returned:
   - SUMMARY.md exists in `.specs/<change-id>/` and is **模板保真**（按 `flow-kit/templates/SUMMARY.md`：标题 `# SUMMARY:` / 首部 4 字段 / 段序一致，含 `## 自检方法` 段）。
   - Verify output is real (not fabricated).
   - Handoff evidence is recorded.

5. **Mark done**: Update TASK.md — set `status="done"` for all completed parallel tasks.

6. **Record overall evidence**: Run `node .claude/skills/flow-comet/scripts/workflow-state.mjs record subagent-execute '<evidence JSON>'` to record completion.

7. **Exit check**: Run exit check.

## Return Contract（子代理必须回传）

每个被委托的子代理，完成时必须在最终回复中回传以下结构化信息（缺任一项，orchestrator 不得记录 handoff result）：

```json
{
  "status": "DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT",
  "taskId": "T0X",
  "commitHash": "<git commit sha>",
  "changedFiles": ["<file>", "..."],
  "completedChecks": ["required-skill:subagent-execute.flow-comet-dev"],
  "redEvidence": { "command": "<RED 失败测试命令>", "output": "<真实失败输出片段>" },
  "greenEvidence": { "command": "<GREEN 通过测试命令>", "output": "<真实通过输出片段>" },
  "riskSignals": ["cross-module | security | concurrency | migration | public-api | 200+lines | none"],
  "concerns": "<可选：未解决的疑虑>"
}
```

- `status=DONE` 才视为完成；`BLOCKED` / `NEEDS_CONTEXT` 需 orchestrator 处理。
- `redEvidence` / `greenEvidence` 缺任一 → 视为未执行 TDD，orchestrator 拒绝记录；**新 change 下 guard 强制 BLOCKED**（旧 change WARN 渐进）。
- `completedChecks` 必须含 `required-skill:subagent-execute.flow-comet-dev`（子代理加载 implementation skill 的证明）；缺任一项 → guard exit 严格 BLOCKED（W1-D，无旧 change 豁免），orchestrator 不得以旧格式/补录方式绕过。
- `riskSignals` 非 `none` 时，orchestrator 应将该任务标记为 review 节点的高优先级审查对象。
- 子代理回传后，orchestrator 用 `workflow-handoff.mjs result <task-id> '<JSON>'` 记录；guard exit subagent-execute 会校验 commitHash + greenEvidence + completedChecks（W1-D，严格）。

### Completion reasoning

This node is truly done when:
- All delegated parallel tasks have `status="done"` in TASK.md.
- Every delegated task has a `<task-id>-SUMMARY.md` that is template-faithful (title `# SUMMARY:`, header fields, section order — per `flow-kit/templates/SUMMARY.md`, plus the `## 自检方法` section) in `.specs/<change-id>/`.
- Handoff evidence (request + result) is recorded for each task.
- No subagent exceeded its `write_files` boundary.
- No serial tasks were delegated (only `parallel="true"` tasks).

### Red flags

- **Agent thought**: "This task looks independent, I'll delegate it." **Actual risk**: Delegating tasks that are not marked `parallel="true"` bypasses the wave division logic. execute 的串行委托走 execute 节点，本节点只并行委托 parallel 任务。
- **Agent thought**: "Subagent can figure out what to do from context." **Actual risk**: Subagent not loading `flow-comet-dev` means it skips TDD, LESSONS scan, diff boundary check, and self-review. The handoff prompt must explicitly require flow-comet-dev.
- **Agent thought**: "Subagent might need to touch related files for context." **Actual risk**: Subagent exceeding `write_files` boundaries creates merge conflicts with other parallel subagents. Strict boundary enforcement is mandatory.
- **Agent thought**: "One subagent finished, mark it done immediately." **Actual risk**: Marking tasks done before all subagents complete can cause issues if a later subagent fails and needs to reference completed work. Wait for all, then batch mark.

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry subagent-execute
```

## Skill Implementation

The subagent-execute node identifies all `parallel="true"` pending tasks in TASK.md, creates handoff requests via `workflow-handoff.mjs`, and delegates each to an isolated subagent (worktree isolation) with `flow-comet-dev` loaded. Each subagent executes the full dev protocol independently. The orchestrator collects evidence and marks tasks done after all subagents complete.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-dev` | Required in each subagent's prompt | Provides TDD, LESSONS scan, diff boundary, self-review protocol for each parallel task |

**加载声明（阶段层 · 双步硬规则）**：本节点技能已由入口路由经 Skill 工具加载（你正在阅读的就是它）；本节点 Required Skill Calls 的加载与声明同样不可跳过：

1. **用 Skill 工具加载** `flow-comet-dev`。**不得跳过**——只读取 SKILL.md 文件不叫加载；真正让 flow-comet-dev 指令生效的是 Skill 工具把它注入本次会话。本节点的 flow-comet-dev 为 handoff scope——协调者在此声明（声明标记的自动补写不覆盖 handoff scope，必须手动声明），各子代理在各自会话按 `flow-kit/prompts/4-dev.md` 协议用 Skill 工具加载并执行；协调者构造 handoff prompt 时按 `flow-kit/prompts/4-dev.md` + `flow-kit/templates/SUMMARY.md` 引用子代理的 dev 协议与交付模板。
2. 加载完成后**立即**运行声明命令（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load subagent-execute flow-comet-dev --prompt flow-kit/prompts/4-dev.md
```

> **跑 skill-load 声明命令 ≠ 加载**：声明只把“哪次会话加载了哪个 skill、按哪份协议工作”写进状态供 exit/record 核对；真正加载只有第 1 步的 Skill 工具能做到。

## Output Schemas

Schema: `flowkit.handoff.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `task-summaries` | file | yes | `.specs/<change-id>/*-SUMMARY.md` (one per delegated task) |
| `handoff-evidence` | evidence | yes | Recorded via workflow-handoff.mjs |

Evidence: `handoff-request` (required per task), `handoff-result` (required per task)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record subagent-execute '{"summary":"N parallel tasks delegated and completed, handoff evidence recorded for each"}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `handoff-evidence` | Handoff evidence recorded for each task | evidence-only |
| `parallel-only` | Only parallel="true" tasks delegated | 执行纪律（review 把关），guard 不校验 |
| `boundary-safe` | No subagent exceeded write_files | 新 change 提交越界 BLOCKED（handoff 记录时校验），旧 change WARN 渐进 |
| `summaries-exist` | SUMMARY.md exists for each delegated task | artifact-exists |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit subagent-execute --apply
```

If the script prints `SKILL: flow-comet-review`, load that Skill next.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Read `.specs/<change-id>/TASK.md` — identify which parallel tasks are still `status="pending"`.
3. Check for existing `<task-id>-SUMMARY.md` files — tasks with summaries are done even if TASK.md not updated.
4. Re-delegate only the remaining pending parallel tasks.
5. If a subagent failed mid-execution, check for `<task-id>-PROGRESS.md` and use its "excluded solutions" to avoid repeating failures.
