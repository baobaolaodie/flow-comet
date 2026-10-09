---
name: flow-comet-plan
description: "Use only when explicitly invoked as /flow-comet-plan or routed by the flow-comet entry/runtime to the plan Node; complete Plan for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

<!-- 手写区详细协议见 ../flow-comet/reference/entry-detail.md（可选阅读） -->

# Plan

## Node Goal

Complete the `plan` Node for `flow-comet`.

Responsibility: 拆原子任务（XML 格式）+ 波次划分。生成 TASK.md。

## Guidance

### 必填段清单（结构+存在级）

| 文件 | guard 强制段（缺失 = BLOCKED） | 其余模板段（模板要求，guard 不拦） |
|------|-------------------------------|-----------------------------------|
| TASK.md | 至少一个 `<task>` 块 + 每个任务含 `<verify>` 字段 | `id` / `name` / `read_files` / `write_files` / `action` / `done` 等字段（执行纪律，review 把关） |

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B；「填得好不好」由 review 把关。

> **模板权威**：本节点产出工件的段形唯一权威 = `flow-kit/templates/**`；`.specs/archive/**` 是历史证据、**不是模板来源**——不得以「上一轮就是这么写的」对齐段形。

波次散文一致性：`## 波次划分` 中标记为并行（[P]）的任务必须与 XML 任务 `parallel="true"` 一致——新 change 不一致 BLOCKED（旧 change WARN 渐进）。

### 波次形态约束（依赖驱动多趟 · 规划期必守）

**约束本体**：并行任务按依赖关系组织——每个并行任务显式声明 `depends_on`，合法性只取决于依赖图本身：`depends_on` 无环且引用的任务都存在，规划即合法。全并行、全串行、串→并、并→串四种基本形态与任意混排序列（如 `S→P→S`、`P→S→P`）一律放行——引擎按依赖拓扑自动分趟（每趟委托全部依赖已满足的并行任务，趟间回串行消化），混排序列由多趟路由按依赖拓扑自动分趟消化，并行任务的先后位置不受任何限制。

**硬性拦截（规划出口 BLOCKED，附恢复指引）**：任务块结构（至少一个 `<task>` 块）/ 每任务 `<verify>` 字段 / 任务图依赖环 / 缺失依赖（`depends_on` 引用不存在的任务 id）/ 并行写写冲突（并行任务 `write_files` 重叠）——任一项不成立即在规划出口被 BLOCKED（读写重叠仅 WARN），按提示修正后重新 exit 即可通过。任务间依赖不得成环（如 A→B→A），也不得构成不可满足的依赖链。

**警示**：落笔时先画依赖方向再标 [P]，避免出口返工。

**理由**：引擎委托节点为多趟访问设计——按依赖分趟循环消化，序列形态自由度交给依赖声明表达。flow-kit 上游模板未载此约束，以本条为准。

### 规划期任务边界与 [P] 语义

- **① 同一文件 ⇒ 同一任务**：一个文件只能有一个任务 owner；必须拆分时，在波次划分中显式排序并写明拆分理由与依赖方向，不得把同一文件的两处改动拆成无依赖的两个任务。
- **② [P] 只给本波确有并发同伴的任务**：`parallel="true"` 仅适用于同波确有其他可并行同伴、且 write_files 互不重叠的任务；孤立任务一律串行——「互不冲突」只是必要条件，不等于应标 `[P]`。
- **③ [P] × direct 模式**：`[P]` 任务只在 `subagent-execute` 节点委托消化；direct 模式只放行**串行任务**的主代理直写，`parallel="true"` 任务在 direct 下仍必须委托——direct 不是并行任务的逃生口。共享工作区下以 `write_files` 互斥 + 提交时点（提交前 diff 边界）作为并行子代理的相互隔离纪律。
- **④ 四属性可满足（并行安全的契约对象）**：标 `[P]` 前确认**并行安全四属性**（① 写权限 · ② 提交隔离 · ③ 验证隔离 · ④ 集成纪律）都能满足——worktree 只是「① 写权限」的实现之一，**不是** `[P]` 的前提。四属性的**含义与三平台通道**以入口册「并行委派契约（四属性）· 三平台通道」为单一来源，本节只点名不复述（同一口径两处表达必分叉）。

**上游语义显式覆盖**：flow-kit 上游（`flow-kit/prompts/3-task.md` 等 vendored 只读文件）的宽松语义——「无冲突即可标 [P]」「同层即同波并行」——以本节为准（显式覆盖；上游只读，不做修改）。

# Plan

## Node Goal

This node decomposes the technical design into atomic, executable tasks with clear file boundaries, dependency declarations, and wave-based parallel execution plans. It produces TASK.md in XML format, which serves as the execution manifest for the dev and subagent-execute nodes. The quality of task decomposition directly determines implementation efficiency and boundary safety.

## Guidance

### Prerequisites

- `.specs/<change-id>/REQUIREMENT.md` must exist (from open node).
- `.specs/<change-id>/DESIGN.md` or `DESIGN-lite.md` must exist (from design node).
- For frontend/UI projects: `.specs/<change-id>/UI-DESIGN.md` must exist.
- The agent must read DESIGN.md section 0 (tech stack selected) — verify commands, dependency management, and directory structure must match the selected stack.
- The agent must NOT invent tech stack, touched modules, forbidden list, or write_files boundaries — all must come from DESIGN.md.

### Steps

1. **Artifact preflight gate**: Check all required upstream artifacts exist. If any missing, stop and output: `Rule R2.7 triggered: plan missing <artifact>. Return to <phase> first.` Do not proceed without all artifacts.

2. **Read DESIGN.md sections 0 and 0.5**: Understand the tech stack (for verify commands) and the architecture alignment (for file boundaries — touched modules, reuse targets, forbidden list).

3. **Decompose by file conflict (vertical slices)**: Split tasks by file conflict, NOT by horizontal layers. Each task should be a vertical slice (one feature through model/API/UI) not a horizontal layer (all models first, then all APIs). Target: 2-10 minutes per task in fresh context. Do not split one file across tasks; if unavoidable, declare explicit order and reason.

4. **Mark parallel tasks with [P]**: only tasks with a genuine concurrent companion in the same wave and non-overlapping write_files get `parallel="true"`; isolated tasks are serial; under direct mode `[P]` tasks are still delegated at subagent-execute. Each `[P]` task must also satisfy the four parallel-safety properties (write permission / commit isolation / verification isolation / integration discipline) — the contract object, with worktree as but one implementation of write permission and never a precondition; the entry SKILL's contract section is the single source for the per-platform channel facts.

5. **Declare depends_on**: Each task explicitly declares which tasks it depends on.

6. **Populate 7 required fields per task**:
   - `id`: Format T01, T02, T02-1 etc. Continuous numbering.
   - `name`: One sentence.
   - `read_files`: Files the task is allowed to read. Must include reuse targets from DESIGN 0.5. Supports glob patterns.
   - `write_files`: Files the task is allowed to create/modify/delete. Must NOT include forbidden modules from DESIGN 0.5. Strictly controlled.
   - `action`: What to do (intent, not code).
   - `verify`: One executable verification command (matching tech stack from DESIGN section 0).
   - `done`: One sentence completion criteria, corresponding to an AC sub-item.

7. **Wave division**: Group tasks by dependency graph:
   - Cross layer = sequential execution.
   - Same-layer tasks may carry `parallel="true"` only when the wave genuinely contains a concurrent companion and their `write_files` do not overlap; an isolated task stays serial.
   - Flow-comet override: the permissive flow-kit upstream semantics — "no conflict ⇒ [P]" and "same layer = same wave, parallel" — are superseded by this node's rule; the vendored upstream files stay read-only and are not modified.
   - Output wave diagram: `Wave 1: T01[P], T02[P]` etc.; isolated tasks appear as serial steps.

8. **LESSONS scan**: Grep `.specs/LESSONS.md` for keywords related to planned file paths or actions. If active lessons hit, declare difference or confirm still applies.

The full task decomposition protocol, XML template, and constraints are in:
- `flow-kit/prompts/3-task.md` (TASK phase)

### Completion reasoning

This node is truly done when:
- `.specs/<change-id>/TASK.md` exists in XML format.
- At least one `<task>` block exists; every task carries a `<verify>` field (the full seven-field shape — id/name/read_files/write_files/action/verify/done — is the execution discipline, review-checked; guard enforces the subset).
- Every `verify` field is an executable command (not a description).
- Every `write_files` is strictly within DESIGN.md touched + new modules range (not in forbidden list).
- Every `[P]` mark has a genuine concurrent companion in its wave with non-overlapping `write_files`; isolated tasks are serial (a fully serial plan is valid when no genuine companion exists).
- Wave division diagram is clear and has no circular dependencies.
- Task numbering is continuous.

### Red flags

- **Agent thought**: "Split by layer first — models, then services, then endpoints." **Actual risk**: Horizontal layering creates artificial dependencies and blocks parallel execution. Always slice vertically by file conflict.
- **Agent thought**: "verify: tests should pass" is good enough. **Actual risk**: Vague verify commands cannot be executed. Must be specific: `pytest tests/test_x.py -v` not "tests should pass".
- **Agent thought**: "write_files can include any file the task might touch." **Actual risk**: Including DESIGN forbidden list modules in write_files bypasses R7.3 + R6.5 boundary enforcement. Strict control is mandatory.
- **Agent thought**: "Same layer means these tasks can all be marked [P]." **Actual risk**: A same-layer task with no concurrent companion, or with overlapping `write_files`, would be delegated as parallel in violation of this node's rule. Mark `[P]` by companion and write boundaries, never by layer alone.
- **Agent thought**: "read_files and write_files are the same thing." **Actual risk**: read_files includes reuse targets and reference modules; write_files is strictly the modification boundary. They serve different purposes (B3 old-project guardrail).

## Entry Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry plan
```

## Skill Implementation

The plan node loads `flow-comet-task` to perform task decomposition. It reads DESIGN.md sections 0 and 0.5 for tech stack and architecture alignment, then produces TASK.md with XML-formatted atomic tasks, wave division, and parallel markers. Each task has strict read_files/write_files boundaries derived from DESIGN.md module analysis.

## Required Skill Calls

| Skill | Enforcement | Reason |
|-------|-------------|--------|
| `flow-comet-task` | Required for task decomposition | Provides XML template, wave division protocol, and file boundary rules |

**加载声明（阶段层 · 双步硬规则）**：本节点技能已由入口路由经 Skill 工具加载（你正在阅读的就是它）；本节点 Required Skill Calls 的加载与声明同样不可跳过：

1. **用 Skill 工具加载** `flow-comet-task`（本节点 Required Skill Call）。**不得跳过**——只读取 SKILL.md 文件不叫加载；真正让 flow-comet-task 指令生效的是 Skill 工具把它注入本次会话。
2. 加载完成后**立即**运行声明命令（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load plan flow-comet-task --prompt flow-kit/prompts/3-task.md
```

> **跑 skill-load 声明命令 ≠ 加载**：声明只把“哪次会话加载了哪个 skill、按哪份协议工作”写进状态供 exit/record 核对；真正加载只有第 1 步的 Skill 工具能做到。

## Output Schemas

Schema: `flowkit.plan.v1`

| Schema ID | Artifact Kind | Required | Path |
|-----------|--------------|----------|------|
| `task-plan` | file | yes | `.specs/<change-id>/TASK.md` |

Evidence: `plan-summary` (required)

## Evidence Record

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs record plan '{"summary":"TASK.md produced with N tasks in M waves, K parallel"}'
```

## Guardrails

| Guardrail ID | Label | Validation Type |
|--------------|-------|-----------------|
| `plan-artifacts` | TASK.md exists with XML tasks | artifact-exists |
| `task-fields-complete` | All tasks have 7 required fields | 执行纪律（review 把关），guard 不校验 |
| `write-files-safe` | No write_files in DESIGN forbidden list | 执行纪律（review 把关），guard 不校验 |
| `has-parallel` | At least 1 [P] task (if applicable) | 执行纪律（review 把关），guard 不校验 |

## Exit Check

```bash
node .claude/skills/flow-comet/scripts/workflow-guard.mjs exit plan --apply
```

If the script prints `SKILL: flow-comet-execute`, load that Skill next.

## Recovery

1. Re-run entry check to confirm workflow state.
2. Read `.specs/<change-id>/TASK.md` — if exists with all tasks having 7 fields and wave diagram, plan phase is done.
3. If TASK.md exists but incomplete (missing fields, no wave diagram), resume from the first incomplete task.
4. Do not repeat completed decomposition. Resume from the first incomplete artifact.
