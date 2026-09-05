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

| 文件 | guard 强制段（缺失 = BLOCKED） | 其余模板段（模板要求，guard 不拦） |
|------|-------------------------------|-----------------------------------|
| TASK.md | 至少一个 `<task>` 块 + 每个任务含 `<verify>` 字段 | `id` / `name` / `read_files` / `write_files` / `action` / `done` 等字段（执行纪律，review 把关） |

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B；「填得好不好」由 review 把关。

