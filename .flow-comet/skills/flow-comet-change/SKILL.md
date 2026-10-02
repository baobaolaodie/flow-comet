---
name: flow-comet-change
description: "flow-kit CHANGE 阶段协议：反问澄清、change-id 自动生成、架构级变更检测、视觉调性预选。flow-comet open 节点的 flow-kit 增强。"
---

# flow-kit CHANGE Protocol

本 Skill 为 flow-comet 的 open 节点提供 flow-kit 的 CHANGE 反问协议。

> **模板权威**：本技能产出工件的段形唯一权威 = `flow-kit/templates/**`；`.specs/archive/**` 是历史证据、**不是模板来源**——不得以「上一轮就是这么写的」对齐段形。

## 加载

读取 `flow-kit/prompts/0-change.md` 并按其执行。关键步骤：

1. **自动生成 change-id**（kebab-case，2~4 词，检查 `.specs/<id>/` 不冲突）
2. **架构级变更检测**（步骤 0.4）：命中 5 类信号时暂停，引导先跑 A-architect
3. **前端项目识别**（步骤 0.5）：关键词判定是否为前端项目；判定结果按「视觉调性段的标记约定」落盘（非前端在该段标注「不适用」）
4. **视觉调性预选**（步骤 0.6，仅前端）：9 张调性卡片 + 推荐
5. **结构化反问**（步骤 1）：每轮最多 3 个问题
6. **影响面判定 + 范围排除**
7. **生成 CHANGE.md**（使用 `flow-kit/templates/CHANGE.md`）
8. **路径建议**：完整/中等/最短

## 产物

- `.specs/<change-id>/CHANGE.md`

## 视觉调性段的标记约定（前端 / 非前端）

`CHANGE.md` 的 `## 视觉调性` 段（段名取自 `flow-kit/templates/CHANGE.md`）不只承载调性选择，还是下游 design 出口判定「是否前端」的**结构级判据**——它的在场状态必须与项目实情一致：

- **前端项目**：按步骤 0.6 的预选结果填段（选定 / 理由 / 参考产品 / 明确排除），段内不得出现字面「不适用」。
- **非前端项目**：保留该段并在段内标注「不适用」两个字面（可附一句理由，例如「CLI 工具，无用户可见界面」）。段缺席同样按非前端处理，但缺席不留可读证据，故约定**显式标注**。
- **判据口径**（下游据此分派；判据的实现方 = design 出口的适用性门控，本节只描述契约，两者不一致时以引擎的输出行为为准）：段在场且段内不含「不适用」⇒ 判前端 ⇒ design 出口要求 `.specs/<change-id>/UI-DESIGN.md` 在场，并要求 `required-skill:design.flow-comet-ui-design` 真实声明（先加载、再声明）；段缺席或段内标注「不适用」⇒ 判非前端 ⇒ 出口打印 `UI-DESIGN: skipped（非前端）` 后放行，不要求 UI-DESIGN.md。
- **改判走本阶段**：change 进行中要改前端 / 非前端判定，回到这里改这一个段，不在 design / execute / verify 里就地绕开判据——改段即改变了 design 出口的判据输入。

## 状态推进

CHANGE.md 生成后，由 flow-comet 状态机（workflow-state/guard）推进节点。不需要手动维护 STATE.md。
