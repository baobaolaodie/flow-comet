---
name: flow-comet-ui-design
description: "flow-kit 2a UI-DESIGN 阶段协议：美学方向 + design tokens + 反 AI-slop 自检。前端 change 触发（结构级判据见内文），非前端 change 显式跳过。"
---

# flow-kit UI-DESIGN Protocol

本 Skill 为前端项目提供 flow-kit 的 2a UI-DESIGN 阶段。

## 加载

读取 `flow-kit/prompts/2a-ui-design.md` 并按其执行。

## 关键检查

- `flow-kit/reference/ui-anti-patterns.md`（75 行可全读）
- `flow-kit/reference/ui-aesthetics.md`（仅查「5 维度」+ 「给 AI 的模板」节）
- 装了 ui-ux-pro-max / impeccable 时优先用它们

## 产物

- `.specs/<change-id>/UI-DESIGN.md`（含 design tokens frontmatter）

## 触发与跳过（前端判据 · 结构级）

判据只看 `.specs/<change-id>/CHANGE.md` 的 `## 视觉调性` 段（段名基准取自 `flow-kit/templates/CHANGE.md`），不做语义判断——判据的实现方是 design 出口的适用性门控，本表只描述契约：

| `## 视觉调性` 段 | 判定 | 本技能动作 |
|---|---|---|
| 段在场，段内**不含**字面「不适用」 | 前端 change | 必须加载本技能并产出 `.specs/<change-id>/UI-DESIGN.md` |
| 段在场，段内标注「不适用」 | 非前端 change | **显式跳过**：不加载、不产出；design 出口打印 `UI-DESIGN: skipped（非前端）` 后放行 |
| 段缺席 | 非前端 change | 同上按非前端处理——但缺席不留可读证据，故约定保留段并标注「不适用」（见 `flow-comet-change` 的标记约定） |

上游的语义信号（`flow-kit/prompts/2a-ui-design.md` 与 `4-dev` 的判定）：任务触碰 `.css` / `.scss` / `.tsx` / `.vue` / `.jsx` / `.html` / `.svelte` / 设计 token / 用户可见文案，或 `action` 含 button / 颜色 / 字体 / 卡片 / 布局 / 动画 / 主题 等关键词。

语义上判为前端、而 `## 视觉调性` 段已被标注「不适用」时：**回 open 阶段改段**再走本阶段——判据输入只有这一个段，不在 design / execute 里就地绕开它。反向同理：非前端 change 不要为了「保险」产出 UI-DESIGN.md。

## 强制等级（design 节点 · guarded）

`design` 节点对本技能的绑定等级 = **guarded**（见 `reference/workflow-protocol.json` 的 `requiredSkillCalls`）。前端 change 的完整动作是**先加载、再声明、后干活**：

1. 用 Skill 工具加载本技能（只读取 SKILL.md 文件不叫加载）；
2. 立即声明已加载：`node .claude/skills/flow-comet/scripts/workflow-state.mjs skill-load design flow-comet-ui-design --prompt flow-kit/prompts/2a-ui-design.md`；
3. 把 `required-skill:design.flow-comet-ui-design` 记进 design 节点的 evidence（`record` / handoff 载荷）。

design 出口的核对口径：

- **前端 change**：evidence 缺 `required-skill:design.flow-comet-ui-design` → 出口**不再自动补写**该条目，直接拦截（加载并声明后重试）；缺 `.specs/<change-id>/UI-DESIGN.md` → 新 change **BLOCKED**，恢复两条路——补齐工件，或在 `## 视觉调性` 段标注「不适用」改判非前端；旧 change 仅 **WARN** 渐进，不阻断。
- **非前端 change**：不要求 UI-DESIGN.md，也不要求上述声明，出口打印可见的 `UI-DESIGN: skipped（非前端）` 后放行——**显式跳过，不是静默省略**。
