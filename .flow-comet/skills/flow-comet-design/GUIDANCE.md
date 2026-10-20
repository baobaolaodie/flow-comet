---
name: flow-comet-design
description: "Use only when explicitly invoked as /flow-comet-design or routed by the flow-comet entry/runtime to the design Node; complete Design for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Design

## Node Goal

Complete the `design` Node for `flow-comet`.

Responsibility: 技术栈选型 + ADR + 数据流。生成 DESIGN.md。

## Guidance

### 必填段清单（结构+存在级）

段形唯一权威 = `flow-kit/templates/DESIGN.md` + 登记表 `../flow-comet/reference/artifact-templates.json`（模板缺席时出口输出「未校验（模板缺失）」）。

| 文件 | 无条件段（缺席 = BLOCKED） | 条件段与增量段（在场才校验 / 结构子段随父段） |
|------|---------------------------|-------------------------------------------|
| DESIGN.md | `## 0. 技术栈选定` / `## 1. 决策清单` / `## 2. 数据流 / 架构图` / `## 5. 风险` / `## 6. 不在范围` | 条件段：`## 0.5 既有架构对齐`（标题必须在场；父段适用时其结构子段 0.5.1~0.5.3 必须同时在，整段写「不适用」才豁免）/ `## 3. 关键状态机` / `## 4. ADR 索引` / `## 9. 架构沉淀建议`（适用时子段 9.1~9.5 必须在场） |

前端 change 另生成 `UI-DESIGN.md`（标题形态 `# UI Design: <项目名>` + frontmatter 键齐备）；非前端须在 CHANGE.md 的 `## 视觉调性` 段以结构形态标注「不适用」。声明本次读到的模板：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load design flow-comet-design --prompt flow-kit/prompts/2-design.md --templates DESIGN.md
```

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / templateSectionPatterns；「填得好不好」由 review 把关。

