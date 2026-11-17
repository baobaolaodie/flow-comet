---
name: flow-comet-plan
description: "Use only when explicitly invoked as /flow-comet-plan or routed by the flow-comet entry/runtime to the plan Node; complete Plan for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

<!-- 手写区详细协议见 GUIDANCE.md（可选阅读） -->

# Plan

## Node Goal

Complete the `plan` Node for `flow-comet`.

Responsibility: 拆原子任务（XML 格式）+ 波次划分。生成 TASK.md。

## Guidance

### 必填段清单（结构+存在级）

| 文件（模板 = `flow-kit/templates/<DOC>.md`） | 左栏 · 无条件段（模板 H2，缺席 / 空正文 = BLOCKED） | 右栏 · 条件段（**标题必须在场**，正文可写 `N/A`）/ 增量段（按登记位置） |
|------|------|------|
| TASK.md | 至少一个 `<task>` 块 + 每个任务含 `<verify>` 字段 + 新格式任务的 7 字段在场（`name` / `read_files` / `write_files` / `action` / `verify` / `done` / `depends_on`）；模板 5 个 H2 段 `## 波次划分` / `## 任务清单` / `## 状态字段说明` / `## 阻塞日志` / `## Fix 任务（来自 REVIEW / INTEGRATION）` | 无模板条件段、无增量段（5 个 H2 全部无条件）——任务块的 7 字段与任务图（依赖环 / 缺失依赖 / 并行写写冲突）属元素级判据，见下方「硬性拦截」段 |

首部字段 `Change ID` / `关联` 已在场时值不得为空（键集不强制）。

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B：任务块结构、每任务 `<verify>`、**新格式任务的 7 字段在场**、以及 TASK.md 的模板骨架（段标题 / 段序 / 首部字段值非空）都由 guard 拦（缺任一 = 出口 BLOCKED；其中 7 字段一项在「旧式一字段模板形态（无 `<name>`）」下仅 WARN——分级依据是模板形态，不是 change 新旧）；「填得好不好」——字段内容质量与任务粒度——由 review 把关。

> **模板权威**：本节点产出工件的段形 = **上游模板 + 本仓登记的增量段**——唯一权威 = `flow-kit/templates/**`（段与正文），条件段 / 结构子段 / 增量段与指纹由 `../flow-comet/reference/artifact-templates.json` 登记；`.specs/archive/**` 是历史证据、**不是模板来源**——不得以「上一轮就是这么写的」对齐段形。

加载顺序：先读 `READ PROMPT:`（`3-task`），再读 `READ TEMPLATE:`（`TASK`）。

波次散文一致性：`## 波次划分` 中标记为并行（[P]）的任务必须与 XML 任务 `parallel="true"` 一致——不一致 BLOCKED（同一形态一个判级）。波次投影一致性：`## 波次划分` 声明的波次必须等于任务的依赖层级（判据与恢复指引见下方「波次形态约束」）——不一致 BLOCKED（同一形态一个判级）；判不了按成因二分——**载体缺席**（`## 波次划分` 不在 / 段名无从派生）→ 打印「未校验（无波次段）」并跳过该判据（未验证 ≠ 通过），**内容不可判**（段在场而没有一行 Wave 行能落到真实任务 id）→ 出口打印 `TASK.md 波次划分段内容不可判`，一律 BLOCKED（同一形态一个判级）；任务集里的任务还必须被某条 Wave 行覆盖（修复族除外，漏写的以「未声明」点名）。

### 波次形态约束（依赖驱动多趟 · 规划期必守）

**约束本体**：并行任务按依赖关系组织——每个并行任务显式声明 `depends_on`，依赖面的合法性只取决于依赖图本身：`depends_on` 无环且引用的任务都存在，依赖面即合法；波次编号另按「波次 = 依赖层级的投影」（下一条）单独校验——依赖面合法不等于波次声明合法，两条判据各自独立拦截。全并行、全串行、串→并、并→串四种基本形态与任意混排序列（如 `S→P→S`、`P→S→P`）一律放行——引擎按依赖拓扑自动分趟（每趟委托全部依赖已满足的并行任务，趟间回串行消化），混排序列由多趟路由按依赖拓扑自动分趟消化，并行任务的先后位置不受任何限制。

**波次 = 依赖层级的投影（波次编号的判据）**：`## 波次划分` 里的波次编号不是自由排版，而是任务依赖层级的投影——① 每个任务的波次 = 其依赖中最晚波次的下一波（无依赖 = 第 1 波）；② 同波任务必须彼此没有依赖；③ 想让某任务晚一点跑，就写 `depends_on` 把顺序声明出来，而不是把它挪到后面的波却不声明。声明波次与依赖层级不一致（同波依赖 / 排在依赖之前 / 明明只需更早波次却排得更靠后）→ 出口 **BLOCKED**：明细逐条点名「任务 / 依赖 / 当前波 / 应到波」，并给两条恢复出路——把该任务移到第 N 波，或补 `depends_on` 把顺序声明出来（要保留当前波次，就把「它为何排在后面」的依赖写成显式 `depends_on`）。**判不了按成因二分**：**载体缺席**（无 `## 波次划分` 段 / 段名无从派生）→ 打印「未校验（无波次段）」并跳过该判据（未验证 ≠ 通过）；**内容不可判**（段在场而没有一行 Wave 行能落到真实任务 id——正文只写 `N/A`、Wave 行点的是不存在的 id、行首强调记号让 Wave 行不成立）→ 出口打印 `TASK.md 波次划分段内容不可判`，一律 BLOCKED（同一形态一个判级）。**覆盖义务**：TASK 里的每个非修复族任务都必须被某个 Wave 行覆盖（修复族不要求排进波次），漏写的任务在明细里以「未声明」的当前波逐条点名——没有「当前波」可挪，恢复出路是把它写进应到波的 Wave 行。`replan` 重校走同一判据、同一报文，不豁免。**与混排合法化并存**：本条只要求「波次编号与依赖层级一致」，不恢复旧的「并行块必须连续成组」形态约束——上面的串→并→串混排照旧合法，并行任务的先后位置照旧不受限制。

**硬性拦截（规划出口 BLOCKED，附恢复指引）**：任务块结构（至少一个 `<task>` 块）/ 每任务 `<verify>` 字段 / 新格式任务的 7 字段在场（集合见上表；缺任一即 BLOCKED——7 字段一项在旧式一字段模板形态下仅 WARN）/ 任务图依赖环 / 缺失依赖（`depends_on` 引用不存在的任务 id）/ 并行写写冲突（并行任务 `write_files` 重叠）/ 波次声明与依赖层级不一致（明细与两条恢复出路见上一条）——任一项不成立即在规划出口被 BLOCKED（读写重叠仅 WARN），按提示修正后重新 exit 即可通过。任务间依赖不得成环（如 A→B→A），也不得构成不可满足的依赖链。

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

6. **Populate 7 required fields per task** — `name` / `read_files` / `write_files` / `action` / `verify` / `done` / `depends_on` (the exact set the plan exit gate enforces). `id` is **not** one of the seven fields: it is an attribute of the `<task>` element (`<task id="T01" parallel="true" status="pending">`) — format T01, T02, T02-1 etc., continuous numbering. `depends_on` is a field, and its element must be present (write an empty element when the task has no dependency):
   - `name`: One sentence.
   - `read_files`: Files the task is allowed to read. Must include reuse targets from DESIGN 0.5. Supports glob patterns.
   - `write_files`: Files the task is allowed to create/modify/delete. Must NOT include forbidden modules from DESIGN 0.5. Strictly controlled.
   - `action`: What to do (intent, not code).
   - `verify`: One executable verification command (matching tech stack from DESIGN section 0).
   - `done`: One sentence completion criteria, corresponding to an AC sub-item.

7. **Wave division**: Group tasks by dependency graph:
   - **Waves are a projection of dependency levels**: each task's wave is one past the latest wave among its dependencies (no dependency = wave 1), and tasks in the same wave must not depend on one another; to make a task run later, declare the order with `depends_on` instead of moving it to a later wave without declaring it.
   - Cross layer = sequential execution.
   - Same-layer tasks may carry `parallel="true"` only when the wave genuinely contains a concurrent companion and their `write_files` do not overlap; an isolated task stays serial.
   - Flow-comet override: the permissive flow-kit upstream semantics — "no conflict ⇒ [P]" and "same layer = same wave, parallel" — are superseded by this node's rule; the vendored upstream files stay read-only and are not modified.
   - Output wave diagram: `Wave 1: T01[P], T02[P]` etc.; isolated tasks appear as serial steps.

   A declared wave that disagrees with the dependency level — a same-wave dependency, a task placed before its dependency, or a conservative placement later than needed — blocks at the plan exit: every mismatch is named as task / dependencies / declared wave / expected wave, together with the two ways out (move it to wave N, or add the `depends_on` that explains the order). When the section is absent (no `## 波次划分` section, or its name cannot be derived), the exit prints "not checked (no wave section)" and skips the rule — unverified is not a pass. When the section is present but no Wave line resolves to a real task (a body that only says N/A, a line naming an unknown id, a leading emphasis mark that breaks the line), the content cannot be judged: it blocks there. Every task in the set must be covered by some Wave line (the fix-task family excepted); a task the section never mentions is named with "undeclared" as its current wave, and the way out is to write it into the wave it should reach. `replan` runs the same judgement with the same wording. This rule constrains the agreement between wave numbers and dependency levels only: it does not bring back the old "parallel blocks must be contiguous" shape constraint, so the mixed-sequence freedom above stands (serial → parallel → serial stays legal).

8. **LESSONS scan**: Grep `.specs/LESSONS.md` for keywords related to planned file paths or actions. If active lessons hit, declare difference or confirm still applies.

The full task decomposition protocol, XML template, and constraints are in:
- `flow-kit/prompts/3-task.md` (TASK phase)

### Completion reasoning

This node is truly done when:
- `.specs/<change-id>/TASK.md` exists in XML format.
- At least one `<task>` block exists; every task carries a `<verify>` field, and the 7-field set `name` / `read_files` / `write_files` / `action` / `verify` / `done` / `depends_on` is present (`id` is an **attribute** of the `<task>` element, not a field) — field **presence** is enforced by the guard (missing any field on a new-format task = exit BLOCKED; a task set written in the old one-field template shape degrades to WARN — that tier follows the template shape, not the age of the change), while **field content quality** is judged by review.
- Every `verify` field is an executable command (not a description).
- Every `write_files` is strictly within DESIGN.md touched + new modules range (not in forbidden list).
- Every `[P]` mark has a genuine concurrent companion in its wave with non-overlapping `write_files`; isolated tasks are serial (a fully serial plan is valid when no genuine companion exists).
- Wave division diagram is clear and has no circular dependencies.
- Wave numbers agree with dependency levels: each wave is one past the latest dependency wave, and tasks sharing a wave have no dependencies between them (an absent wave section is reported as "not checked", never as a pass; a section whose content cannot be judged blocks).
- Task numbering is continuous.

### Red flags

- **Agent thought**: "Split by layer first — models, then services, then endpoints." **Actual risk**: Horizontal layering creates artificial dependencies and blocks parallel execution. Always slice vertically by file conflict.
- **Agent thought**: "verify: tests should pass" is good enough. **Actual risk**: Vague verify commands cannot be executed. Must be specific: `pytest tests/test_x.py -v` not "tests should pass".
- **Agent thought**: "write_files can include any file the task might touch." **Actual risk**: Including DESIGN forbidden list modules in write_files bypasses R7.3 + R6.5 boundary enforcement. Strict control is mandatory.
- **Agent thought**: "Same layer means these tasks can all be marked [P]." **Actual risk**: A same-layer task with no concurrent companion, or with overlapping `write_files`, would be delegated as parallel in violation of this node's rule. Mark `[P]` by companion and write boundaries, never by layer alone.
- **Agent thought**: "This task just feels like it should run later, so I'll put it in a later wave." **Actual risk**: A wave number is the dependency level projected onto the plan — moving a task to a later wave without declaring the dependency is exactly the mismatch the exit blocks. Declare `depends_on` instead of moving the wave.
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
2. 加载完成后**立即**运行声明命令（节点退出与证据记录会核对声明标记；声明如实记录加载动作，不等于产出证明）。`--templates` 声明本节点该读的产出物模板（plan → `TASK.md`）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load plan flow-comet-task --prompt flow-kit/prompts/3-task.md --templates TASK.md
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
| `task-fields-complete` | All tasks have 7 required fields | 结构在场（新格式任务缺任一字段 = 出口 BLOCKED；旧式一字段模板形态的缺项仅 WARN——按模板形态分级）——**字段内容质量**由 review 把关 |
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
