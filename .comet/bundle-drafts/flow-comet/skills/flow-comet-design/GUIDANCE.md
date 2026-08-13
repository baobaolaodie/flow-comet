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

| 文件 | guard 强制段（缺失 = BLOCKED） | 其余模板段（模板要求，guard 不拦） |
|------|-------------------------------|-----------------------------------|
| DESIGN.md | `## 0.` 技术栈段 / `## 决策清单` | `## 0.5 架构对齐` / `## 风险` / `## 数据流` 等 |

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / templateSectionPatterns；「填得好不好」由 review 把关。

