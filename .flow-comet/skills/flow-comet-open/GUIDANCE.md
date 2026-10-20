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

段形唯一权威 = `flow-kit/templates/<DOC>.md` + 登记表 `../flow-comet/reference/artifact-templates.json`（模板缺席时出口输出「未校验（模板缺失）」，不回退任何内置段名副本）。

| 文件 | 无条件段（缺席 = BLOCKED） | 条件段与增量段（在场才校验 / 位置按登记表） |
|------|---------------------------|-------------------------------------------|
| CHANGE.md | `## Why（为什么做）` / `## What（做什么）` / `## 影响面` / `## 范围排除（这次不做）` / `## 验收线（粗粒度，不是 AC）` / `## 风险与未知` | 条件段 `## 视觉调性`：标题必须在场（前端项目填调性；非前端显式写「不适用」——缺席即 BLOCKED）；增量段 `## 架构层影响声明`（可选） |
| REQUIREMENT.md | `## 用户故事` / `## 验收准则（AC）` / `## 范围切分` / `## 非功能性需求` / `## 依赖与假设` | 无 |

段名宽容：省括号 / 换括号 / 大小写差异均按归一后的段名匹配，核心词不同即视为缺段。声明本次读到的模板（缺声明在 record 时被拦）：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load open flow-comet-change --prompt flow-kit/prompts/0-change.md --templates CHANGE.md,REQUIREMENT.md
```

guard 校验见 workflow-guard.mjs NODE_TRANSITION_GATES / templateSectionPatterns；「填得好不好」由 review 把关。

### 分支创建

`node .claude/skills/flow-comet/scripts/workflow-state.mjs init <id>` 会自动创建 `change/<id>` 分支（git 仓库时：当前分支非 `change/<id>` 且分支不存在 → `git checkout -b change/<id>`）；**非 git 仓库跳过分支创建，纯文件模式照旧**。init 幂等：当前已在 `change/<id>` 分支时不重复创建。全流程在该分支上进行，归档收尾时合并回 main。

### CONTEXT 更新（位置纪律）

更新 `.specs/CONTEXT.md` 时**插入既有结构段内**，禁止新建尾部段：

- 术语 → 插入 `## 域语言（术语表）` 表格行；无该表格则插该段末尾
- 决策 → **段内**追加到 `## 已锁决策` 清单
- **禁止**新建 `## 术语（xxx 追加）` 类尾部段

