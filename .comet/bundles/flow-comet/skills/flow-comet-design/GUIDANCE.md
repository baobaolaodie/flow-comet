---
name: flow-comet-design
description: "Use only when explicitly invoked as /flow-comet-design or routed by the flow-comet entry/runtime to the design Node; complete Design for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Design

## Node Goal

Complete the `design` Node for `flow-comet`.

Responsibility: 技术栈选型 + ADR + 数据流。生成 DESIGN.md。

## Guidance

### 必填段清单（exit guard 校验，结构+存在级）

| 文件 | 必填段 |
|------|--------|
| DESIGN.md | `## 0. 技术栈选定` / `## 0.5 架构对齐` / `## 决策清单` / `## 风险` |

**缺失任一必填段 = 节点未完成**，exit guard 校验（见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B）。

