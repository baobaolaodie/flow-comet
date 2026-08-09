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
| CHANGE.md | `## Why（为什么做）` / `## 变更范围` / `## 影响面` / `## 风险` |
| REQUIREMENT.md | `## 用户故事` / `## 验收准则（AC）` / `## 范围切分` |

**缺失任一必填段 = 节点未完成**，exit guard 校验（见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B）。

### 分支创建

`workflow-state.mjs init <id>` 会自动创建 `change/<id>` 分支（git 仓库时：当前分支非 `change/<id>` 且分支不存在 → `git checkout -b change/<id>`）；**非 git 仓库跳过分支创建，纯文件模式照旧**。init 幂等：当前已在 `change/<id>` 分支时不重复创建。全流程在该分支上进行，归档收尾时合并回 main。

### CONTEXT 更新（位置纪律）

更新 `.specs/CONTEXT.md` 时**插入既有结构段内**，禁止新建尾部段：

- 术语 → 插入 `## 域语言（术语表）` 表格行；无该表格则插该段末尾
- 决策 → **段内**追加到 `## 已锁决策` 清单
- **禁止**新建 `## 术语（xxx 追加）` 类尾部段

