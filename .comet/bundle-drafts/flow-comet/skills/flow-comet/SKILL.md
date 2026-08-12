---
name: flow-comet
description: "Use when the user wants the flow-comet managed workflow for flow-kit 9 阶段工作流的 workflow-kernel 实现。工件直接读写 .specs/, explicitly invokes /flow-comet, or persisted workflow state identifies one unambiguous active run. Route through this entry Skill; do not invoke its internal Node Skills directly."
---

<!-- 手写区详细协议见 GUIDANCE.md（可选阅读） -->

# flow-comet

## Decision Core

---
name: flow-comet
description: "flow-kit 9 阶段工作流 + 自动状态管理。工件直接读写 .specs/，不经过 OpenSpec。Use when the user invokes /flow-comet or wants to start/continue a structured development workflow."
---

# flow-comet

flow-kit 9 阶段工作流的 workflow-kernel 实现。保留 flow-kit 的全部产物模板、规则体系和 LESSONS 知识库，用脚本自动管理状态和阶段路由。

**工件根目录：`.specs/<change-id>/`**

## Decision Core

### 自动节点检测

**Step 0：确定当前节点与意图**

1. 检查 workflow protocol 的有序 Node 列表（open→design→plan→execute→subagent-execute→review→verify→archive）。
2. 运行 `node .claude/skills/flow-comet/scripts/workflow-state.mjs status` 确认检测到的节点。
3. 若脚本输出与文件产物冲突（如脚本说 execute 但 TASK.md 不存在），以文件为准，先纠正状态再继续。
4. 若用户描述的工作明显属于更后面的 Node（如"验证结果"但 design 尚未完成），暂停并说明前序 Node 必须先完成。
5. 若用户描述的工作属于已标记完成的更早 Node，视为纠正——重置该 Node 的完成状态并重新进入。

**Step 1：flow-kit 产物门禁**

| 目标节点 | 必须已有的上游工件 | 缺失时动作 |
|---------|-----------------|-----------|
| open | 无 | 直接进入 |
| design | CHANGE.md + REQUIREMENT.md | 回 open 补齐 |
| plan | DESIGN.md（或 DESIGN-lite.md） | 回 design 补齐 |
| execute | TASK.md | 回 plan 补齐 |
| subagent-execute | TASK.md（含 parallel=true pending 任务） | 回 execute 串行执行 |
| review | 所有 task status="done" | 回 execute 补齐 |
| verify | REVIEW.md | 回 review 补齐 |
| archive | UAT.md | 回 verify 补齐 |

**Step 2：读取下一个节点**

运行 `node .claude/skills/flow-comet/scripts/workflow-state.mjs next`。若返回的 NODE 与 Step 0 产物检测不一致，以产物为准。

### Resume 规则

- 每次上下文恢复，重新执行 Step 0 和 Step 2。不信任对话历史。
- 产物文件（`.specs/<id>/`）是唯一真相源。脚本状态只是加速器。
- 若状态显示某 Node 已完成但预期 artifact 缺失，视为未完成并重新进入。
- 若用户在某个 Node 中途恢复但话题变了，确认是继续当前 Node 还是开始新的。

### 决策分类与决策点

先分类再行动：

| 分类 | 定义 | 处理 |
|------|------|------|
| 用户决策 | ≥2 个会改变范围/行为/风险/不可逆结果的合法选项 | 用 AskUserQuestion 问（优先）或文本回退；相邻选择合并为一个问题，不重问已持久化选择 |
| 自动处理 | 唯一安全下一步 | 直接执行并汇报，不许制造确认 |
| 停止条件 | guard 失败 / 缺依赖 / 状态损坏 | 报告阻塞与恢复条件，无合法动作时才升级为用户决策 |
| 手动交接 | `NEXT: manual`（若有） | 不是用户决策，直接继续 |

**决策点清单（挂到四分类下）**：
- **用户决策**：首次调用且主题/范围有多个合法解释；技术栈选型（5~6 卡，design 节点内暂停）；破坏性变更检测（R4.6，execute 节点内暂停展示引用图）；Schema 迁移（R4.5，execute 节点内暂停）；REVIEW Critical 项（review 节点暂停等人工确认）；UAT 失败超限（第 4 次，机器计数 verifyFailures，verify 节点暂停）；归档操作（不可逆，archive 节点暂停等最终确认）；切换 executionMode 到 direct（execute 节点内暂停，需用户确认，记录 directOverride）；合并 change 分支到 main（归档收尾，merge 前暂停等用户确认）；PR approve（enablePrReview 开启时，archive 前置，等用户/GitHub approve）
- **自动处理**：唯一安全下一步直接执行；flow-kit 反问协议要求确认（CHANGE/REQUIREMENT/DESIGN）按 flow-kit 规则暂停等待
- **停止条件**：Node guard 失败时先自动诊断并执行唯一安全修复；缺依赖或状态损坏导致无法继续时报告停止条件与恢复条件；只有恢复方式存在多个会改变范围或风险的合法选项时，才升级为用户决策

### Red Flags

| Agent 想法 | 实际风险 |
|-----------|---------|
| "这是小改动，不用走完整流程" | 可走最短路径但不能跳过阶段门禁 |
| "REQUIREMENT 可以跳过，直接写代码" | R2.2：没有 REQUIREMENT 不能进 DESIGN |
| "verify 通过了所以可以归档" | 还要检查 REVIEW.md 的 Critical 项是否全部处理 |
| "上下文恢复后从上次对话继续" | 始终重新读取状态和产物文件，对话记忆不可靠 |
| "LESSONS.md 不用扫" | R1.8：每个 DEV 任务必须扫描 |
| "测试从实现派生就行" | R5.1：测试必须从 AC 派生 |
| "guard 失败了，让用户决定" | 先自动诊断并执行唯一安全修复；无合法动作时才报告停止条件 |
| "subagent-execute 阶段，我直接改源码更快" | 协调者禁令：subagent-execute 阶段主会话禁止写源码（hook 白名单只允许 .specs/），必须 worktree 委托子代理 |

## Workflow Nodes

| 节点 | Kind | 职责 | Output Schema |
|------|------|------|---------------|
| open | control | CHANGE 反问 + REQUIREMENT 需求 | flowkit.intake.v1 |
| design | control | 技术决策 + ADR | flowkit.design.v1 |
| plan | control | 拆原子任务 | flowkit.plan.v1 |
| execute | control | TDD 开发 + 自查（串行） | flowkit.execution.v1 |
| subagent-execute | handoff | [P] 并行任务委托 | flowkit.handoff.v1 |
| review | control | 4 轮审查 | flowkit.review.v1 |
| verify | control | 集成验证 + UAT | flowkit.verify.v1 |
| archive | control | 归档 + LESSONS | flowkit.archive.v1 |

## Skill Bindings

| 节点 | Implementation | Required Calls | Enforcement |
|------|---------------|----------------|-------------|
| open | flow-comet-open | flow-comet-change, flow-comet-requirement | guarded |
| design | flow-comet-design | flow-comet-design, flow-comet-ui-design (advisory，不要求声明) | guarded |
| plan | flow-comet-plan | flow-comet-task | guarded |
| execute | flow-comet-execute | flow-comet-dev | guarded |
| subagent-execute | flow-comet-subagent-execute | flow-comet-dev (handoff) | handoff-guarded |
| review | flow-comet-review | flow-comet-review, flow-comet-test | guarded |
| verify | flow-comet-verify | flow-comet-integration | guarded |
| archive | flow-comet-archive | flow-comet-integration | guarded |

**节点 skill 加载声明**：进入节点、加载节点 skill 后**立即**运行声明命令，记录本次加载使用的 skill 与协议文件（open/review 等涉及多个协议文件的节点，每个协议文件对应一条声明命令）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load <node> <skill> --prompt flow-kit/prompts/<阶段>.md
```

节点退出（exit）与证据记录（record）会核对声明标记。声明如实记录执行者动作——加载了哪个 skill、按哪份协议工作——**不等于产出证明**；产出是否正确由产物结构校验与门禁把关。

## Guardrails And Evidence

| 节点 | Guardrail | Validation | Description |
|------|-----------|-----------|-------------|
| open | intake-artifacts | artifact-exists | CHANGE.md + REQUIREMENT.md exist |
| design | design-artifacts | artifact-exists | DESIGN.md exists |
| plan | plan-artifacts | artifact-exists | TASK.md exists |
| execute | build-evidence | artifact-exists | At least one SUMMARY.md |
| subagent-execute | handoff-evidence | evidence-only | Handoff evidence recorded |
| review | review-evidence | artifact-exists | REVIEW.md exists |
| verify | verify-evidence | artifact-exists | TEST.md or UAT.md exists |
| archive | archive-evidence | state-transition | Archive completed |

## Runtime And Recovery

### Startup Protocol

1. Run `node .claude/skills/flow-comet/scripts/workflow-state.mjs status` to detect active change and current node.
2. If no active change and user wants to start new work: `node .claude/skills/flow-comet/scripts/workflow-state.mjs init <change-name>`. **init 自动检测项目上下文**：需要初始化时输出提示（同意重跑 `init <id> --init-context` 全量生成 CONTEXT.md / 拒绝 `--init-skip`）；CONTEXT.md 已存在且新鲜时完全静默——详见 `reference/init-detection.md`。
3. **: `init` 输出即首次路由（NODE: 内置 open 或协议首节点）——直接加载该节点 Skill 并执行（产出工件）。`next` 在节点完成（`guard exit <node> --apply` 推进）后用于获取下一节点；init 后立即 `next` 会命中节点顺序门禁（open 未 exit → BLOCKED，符合节点顺序门禁语义）。

### Resume Rules (every context resume)

- **Re-detect from scratch**: on every context resume, re-run Startup Protocol. Do not trust conversation history.
- **Trust files over state**: if the script says a Node is DONE but its expected artifacts are missing, treat the Node as incomplete and re-enter it.
- **Drift handling**: if the user's request belongs to a different Node than the one returned by `next`, pause and confirm which Node to enter.

### Node Boundary Rules

- Before leaving a Node, run `node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit <node> --apply` to advance state.
- If the guard fails, do not proceed — present the guard output and ask the user how to fix it.
- If the user wants to redo a completed Node, reset its completion state and re-enter rather than creating a parallel path.

### Evidence Recording

After completing a Node:
```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record <node-id> '{"summary":"完成摘要"}'
```

### Artifact Paths

All artifacts in `.specs/<change-id>/`. Cross-change files in `.specs/` (CONTEXT.md, LESSONS.md, CHANGELOG.md).

### Scripts

| 脚本 | 用途 |
|------|------|
| `workflow-state.mjs` | 状态管理：init/status/next/select/record/advance |
| `workflow-guard.mjs` | 节点门禁：entry/exit/verify 检查 |
| `workflow-handoff.mjs` | 子代理交接：request/result/status |
| `comet-plan.mjs` | plan 状态查询 |
| `comet-check.mjs` | workflow contract 检查 |
| `comet-hook-guard.mjs` | 文件写入边界守卫（phase 白名单：subagent-execute 阶段只允许 .specs/） |

### 机器拥有字段

以下字段只能由 `workflow-state.mjs` 和 `workflow-guard.mjs` 脚本管理，不应被手动编辑：

| 字段 | 说明 | 管理者 |
|------|------|--------|
| `currentNode` | 当前活动节点 | workflow-state.mjs next/advance |
| `completedNodes` | 已完成节点列表 | workflow-guard.mjs exit --apply |
| `evidence` | 节点证据记录 | workflow-state.mjs record |
| `verifyFailures` | verify 失败计数 | workflow-guard.mjs (auto-increment) |
| `status` | 运行状态 | workflow-guard.mjs exit --apply |
| `executionMode` | subagent/direct，execute 执行模式 | workflow-state.mjs execution-mode |
| `directOverride` | direct 是否用户显式确认 | workflow-state.mjs execution-mode direct |

手动修改这些字段可能导致 guard 校验不一致。若需修正状态，使用 `workflow-state.mjs advance` 或 `workflow-state.mjs select`。

The route, Output Schemas, required Skill calls, and recovery state are defined by `reference/workflow-protocol.json`.


## Workflow Nodes

1. `flow-comet-open` - Open (control). Responsibility: CHANGE 反问 + REQUIREMENT 需求分析。生成 CHANGE.md 和 REQUIREMENT.md。 Required Skills: `flow-comet-change`, `flow-comet-requirement`. Output Schemas: `flowkit.intake.v1`.
2. `flow-comet-design` - Design (control). Responsibility: 技术栈选型 + ADR + 数据流。生成 DESIGN.md。 Required Skills: `flow-comet-design`, `flow-comet-ui-design`. Output Schemas: `flowkit.design.v1`.
3. `flow-comet-plan` - Plan (control). Responsibility: 拆原子任务（XML 格式）+ 波次划分。生成 TASK.md。 Required Skills: `flow-comet-task`. Output Schemas: `flowkit.plan.v1`.
4. `flow-comet-execute` - Execute (control). Responsibility: 按 TASK.md 逐任务执行：TDD + 6 维自查 + LESSONS 扫描 + diff 边界 verify。 Required Skills: `flow-comet-dev`. Output Schemas: `flowkit.execution.v1`. 进入前读 `reference/dirty-worktree.md` 做 dirty-worktree 归属检查。
5. `flow-comet-subagent-execute` - Subagent Execute (handoff). Responsibility: 委托 [P] 并行任务给子代理，要求加载 flow-comet-dev 并回传 evidence。 Required Skills: `flow-comet-dev`. Output Schemas: `flowkit.handoff.v1`.
6. `flow-comet-review` - Review (control). Responsibility: 4 轮审查（spec 合规 + 代码质量 + UI 视觉 + 可选）。生成 REVIEW.md。 Required Skills: `flow-comet-review`, `flow-comet-test`. Output Schemas: `flowkit.review.v1`.
7. `flow-comet-verify` - Verify (control). Responsibility: 集成验证 + UAT + 失败诊断。生成 TEST.md + UAT.md。 Required Skills: `flow-comet-integration`. Output Schemas: `flowkit.verify.v1`. 进入前读 `reference/dirty-worktree.md` 做 dirty-worktree 归属检查。verify 失败自动重试 ≤ 3 次（机器计数 verifyFailures，`node workflow-state.mjs verify-fail`）；第 4 次失败必须暂停问用户「继续修 / 停止」。exit verify 会真实执行 TEST.md `## 验证命令` 段声明的命令（严格版）。
8. `flow-comet-archive` - Archive (control). Responsibility: LESSONS 提名 + 归档到 .specs/archive/ + CHANGELOG 更新。 Required Skills: `flow-comet-integration`. Output Schemas: `flowkit.archive.v1`.

## Skill Bindings

- `open`: implementation `flow-comet-open` (require); required calls `flow-comet-change`, `flow-comet-requirement`; augmentations none.
- `design`: implementation `flow-comet-design` (require); required calls `flow-comet-design`, `flow-comet-ui-design` (advisory——仅前端项目触发，不要求 skill-load 声明；record D3 只校验执行者实际声明的条目); augmentations none.
- `plan`: implementation `flow-comet-plan` (require); required calls `flow-comet-task`; augmentations none.
- `execute`: implementation `flow-comet-execute` (require); required calls `flow-comet-dev`; augmentations none.
- `subagent-execute`: implementation `flow-comet-subagent-execute` (require); required calls `flow-comet-dev`; augmentations none.
- `review`: implementation `flow-comet-review` (require); required calls `flow-comet-review`, `flow-comet-test`; augmentations none.
- `verify`: implementation `flow-comet-verify` (require); required calls `flow-comet-integration`; augmentations none.
- `archive`: implementation `flow-comet-archive` (require); required calls `flow-comet-integration`; augmentations none.

**节点 skill 加载声明**：加载节点 skill 后立即运行 `node flow-comet/scripts/workflow-state.mjs skill-load <node> <skill> --prompt flow-kit/prompts/<阶段>.md` 记录本次加载（多协议节点每个协议文件一条命令）；exit/record 会核对声明标记。声明如实记录加载动作，不等于产出证明——正确性由产物门禁校验把关。

## Guardrails And Evidence

- `open.intake-artifacts`: CHANGE.md + REQUIREMENT.md exist (artifact-exists).
- `design.design-artifacts`: DESIGN.md exists (artifact-exists).
- `plan.plan-artifacts`: TASK.md exists (artifact-exists).
- `execute.build-evidence`: SUMMARY.md produced (artifact-exists).
- `subagent-execute.handoff-evidence`: Handoff evidence recorded (evidence-only).
- `review.review-evidence`: REVIEW.md exists (artifact-exists).
- `verify.verify-evidence`: TEST.md or UAT.md exists (artifact-exists).
- `archive.archive-evidence`: Archive completed (state-transition).

## Workflow References

- Route, Output Schemas, required Skill calls, and recovery state: `reference/workflow-protocol.json`.
- Resolved source Skill evidence and composition provenance: `reference/resolved-skills.json`.

## Runtime And Recovery

### Startup Protocol

1. Run `node flow-comet/scripts/workflow-state.mjs status` to read current state.
2. If the workflow is not started, confirm scope with the user, then run `node flow-comet/scripts/workflow-state.mjs init`.
3. **: `init` 输出即首次路由（NODE: 内置 open 或协议首节点）——直接加载该节点 Skill 执行；`next` 在节点 exit 后用于推进（init 后立即 next 命中节点顺序门禁属预期）。Do not load multiple Skills at once.

### Resume Rules (every context resume)

- **Re-detect from scratch**: on every context resume, re-run the Startup Protocol. Do not trust conversation history for current-Node detection — context compaction may have discarded critical state.
- **Trust files over state**: if the script says a Node is DONE but its expected artifacts or evidence are missing, treat the Node as incomplete and re-enter it. File evidence is the source of truth.
- **Drift handling**: if the user's request belongs to a different Node than the one returned by `next`, pause and confirm which Node to enter. Do not silently follow the script if the user's intent conflicts.

### Node Boundary Rules

- Before leaving a Node, run `node flow-comet/scripts/workflow-guard.mjs exit <node> --apply` to advance state and record evidence.
- If the guard fails, do not proceed — present the guard output and ask the user how to fix it.
- If the user wants to redo a completed Node, reset its completion state and re-enter rather than creating a parallel path.

The route, Output Schemas, required Skill calls, and recovery state are defined by `reference/workflow-protocol.json`.
