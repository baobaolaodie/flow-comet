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

| 文件 | guard 强制段（缺失 = BLOCKED） | 其余模板段（模板要求，guard 不拦） |
|------|-------------------------------|-----------------------------------|
| SUMMARY.md | `## verify 输出` / `## 6 维自查`（须含实质内容）/ `## 越界检查` / `## 自检方法` | `## 做了什么` / `## 改动文件` 等（执行纪律，review 把关） |

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B；「填得好不好」由 review 把关。

