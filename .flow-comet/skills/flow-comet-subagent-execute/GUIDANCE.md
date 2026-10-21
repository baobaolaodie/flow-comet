---
name: flow-comet-subagent-execute
description: "Use only when explicitly invoked as /flow-comet-subagent-execute or routed by the flow-comet entry/runtime to the subagent-execute Node; complete Subagent Execute for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Subagent Execute

## Node Goal

Complete the `subagent-execute` Node for `flow-comet`.

Responsibility: 委托 [P] 并行任务给子代理，要求加载 flow-comet-dev 并回传 evidence。

职责分工：execute 节点负责**串行委托**（非 parallel 任务，一次一个），本节点负责**并行委托**（`parallel="true"` 任务，同 wave 多任务同时发）。两者共用同一委托证据库（handoff 记录在 subagent-execute evidence）。

## Guidance

### 必填段清单（结构+存在级）

段形唯一权威 = `flow-kit/templates/SUMMARY.md` + 登记表 `../flow-comet/reference/artifact-templates.json`（模板缺席时出口输出「未校验（模板缺失）」）。

| 文件 | 无条件段（缺席 = BLOCKED） | 条件段与增量段（在场才校验 / 位置按登记表） |
|------|---------------------------|-------------------------------------------|
| SUMMARY.md | `## 做了什么（一段话）` / `## 改动文件` / `## verify 输出` / `## 6 维自查`（须含实质内容）/ `## 越界检查` / `## 是否触发新工作` / `## 完成判定` | 条件段：`## 数据库迁移`（涉 schema 变更）/ `## 破坏性变更` / `## 决策与偏离`——标题必须在场，不涉及时写「不适用」；增量段：`## 自检方法`（紧随 `## 越界检查` 或位于骨架段之后，须声明自检方法名）与 `## LESSONS 扫描`（紧随自检方法之后或文末，逐条回应命中的 `L-NNN`），两者均必填 |

声明本次读到的模板：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load subagent-execute flow-comet-subagent-execute --prompt flow-kit/prompts/4-dev.md --templates SUMMARY.md
```

加载顺序：先 `READ PROMPT:`（步骤权威），有模板的节点再 `READ TEMPLATE:`（段形权威）；design 前端另有一行条件提示词 `2a-ui-design`。

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B；「填得好不好」由 review 把关。

### 委托前写写拦截（第二道锚保持）

plan 出口已做文件级依赖检测（写写强判：新 change BLOCKED / 旧 change WARN；读写弱判：无显式 depends_on 关联对 WARN；伪并行 WARN 并存渐进）——委托前既有 write∩write 拦截**保持为第二道防线**（`BLOCKED: parallel tasks write_files 冲突`，行为与消息既有语义不变）。并行委托前仍校验本趟并行任务的 `write_files` 交集，plan 出口检测的提示/拦截不改变委托前拦截。

