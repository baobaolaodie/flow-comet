---
name: flow-comet-open
description: "Use only when explicitly invoked as /flow-comet-open or routed by the flow-comet entry/runtime to the open Node; complete Open for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Open

## Node Goal

Complete the `open` Node for `flow-comet`.

Responsibility: CHANGE 反问 + REQUIREMENT 需求分析。生成 CHANGE.md 和 REQUIREMENT.md。

## Guidance

### 必填段清单（exit guard 校验，结构+存在级）

| 文件 | 必填段 |
|------|--------|
| CHANGE.md | `## 变更目标` / `## 变更范围` / `## 影响面` / `## 风险` |
| REQUIREMENT.md | `## 用户故事` / `## 验收标准` / `## 范围切分` |

**缺失任一必填段 = 节点未完成**，exit guard 校验（见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B）。

