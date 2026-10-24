---
name: flow-comet-plan
description: "Use only when explicitly invoked as /flow-comet-plan or routed by the flow-comet entry/runtime to the plan Node; complete Plan for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Plan

## Node Goal

Complete the `plan` Node for `flow-comet`.

Responsibility: 拆原子任务（XML 格式）+ 波次划分。生成 TASK.md。

## Guidance

### 必填段清单（结构+存在级）

段形唯一权威 = `flow-kit/templates/TASK.md` + 登记表 `../flow-comet/reference/artifact-templates.json`（模板缺席时出口输出「未校验（模板缺失）」）。

| 文件 | 无条件段（缺席 = BLOCKED） | 条件段与增量段（在场才校验 / 位置按登记表） |
|------|---------------------------|-------------------------------------------|
| TASK.md | `## 波次划分` / `## 任务清单` / `## 状态字段说明` / `## 阻塞日志` / `## Fix 任务（来自 REVIEW / INTEGRATION）`（以上段形按模板）+ 至少一个 `<task>` 块 + 每个任务含 `<verify>` 字段 + 新格式任务的 7 字段在场（集合见本册 `SKILL.md`「必填段清单」表行；单一权威 = 技能脚本的 `lib/task-graph.mjs` 导出的 `TASK7_REQUIRED` 常量，本文不复述集合） | 无（任务规模 / 粒度 / 字段内容质量属模板要求，guard 不拦，由 review 把关）；`id` 是 `<task>` 元素的属性（不是字段：`<task id="T01" parallel="true" status="pending">`） |

声明本次读到的模板：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load plan flow-comet-plan --prompt flow-kit/prompts/3-task.md --templates TASK.md
```

加载顺序：先 `READ PROMPT:`（步骤权威），有模板的节点再 `READ TEMPLATE:`（段形权威）；design 前端另有一行条件提示词 `2a-ui-design`。

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B；「填得好不好」由 review 把关。

### 并行文件依赖检测（plan 出口 · 规划期自检）

在波次散文一致性、依赖图（`depends_on` 无环且引用存在）、7 字段同层，plan 出口还做文件级依赖检测：

- **写写强判**：本趟可运行的并行 pending 任务 `write_files` 有交集 → 新 change BLOCKED（消息含任务 id 对 × 重叠路径与恢复指引「补显式 depends_on 或拆为串行任务」）；旧 change WARN 渐进不阻断。
- **读写弱判**：仅对**无显式 depends_on 关联**的并行对探测一方 `read_files` 命中对方 `write_files` → WARN 提示（建议补显式 depends_on 声明），不 BLOCK；有显式关联=依赖已声明，跳过（合法拓扑零新增告警）。
- **路径按声明实际解析**：不做扩展名白名单过滤——txt/log/无扩展名路径同等检出（链式重命名事故面闭合）。
- **并存不干扰**：伪并行 WARN（并行任务全部仅写测试产物）与 read∩write 弱判各自独立渐进提示；委托前写写拦截保持为第二道防线。
- **多趟语义**：任务显式声明 `depends_on`，合法性只取决于依赖图（无环且引用存在）；全并行、全串行、串→并、并→串及任意混排均合法——引擎按依赖拓扑多趟分趟消化，并行任务先后位置不受限制。

