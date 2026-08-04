---
name: flow-comet-plan
description: "Use only when explicitly invoked as /flow-comet-plan or routed by the flow-comet entry/runtime to the plan Node; complete Plan for flow-comet. Do not use for ordinary standalone tasks or as the workflow entry."
---

# Plan

## Node Goal

Complete the `plan` Node for `flow-comet`.

Responsibility: 拆原子任务（XML 格式）+ 波次划分。生成 TASK.md。

## Guidance

### 必填段清单（exit guard 校验，结构+存在级）

| 文件 | 必填段 |
|------|--------|
| TASK.md | 每个 `<task>` 含 `id` / `name` / `read_files` / `write_files` / `action` / `verify` / `done` 7 字段 |

**缺失任一必填段 = 节点未完成**，exit guard 校验（见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B）。

