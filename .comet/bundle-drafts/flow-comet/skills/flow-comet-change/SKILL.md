---
name: flow-comet-change
description: "flow-kit CHANGE 阶段协议：反问澄清、change-id 自动生成、架构级变更检测、视觉调性预选。flow-comet open 节点的 flow-kit 增强。"
---

# flow-kit CHANGE Protocol

本 Skill 为 flow-comet 的 open 节点提供 flow-kit 的 CHANGE 反问协议。

## 加载

读取 `flow-kit/prompts/0-change.md` 并按其执行。关键步骤：

1. **自动生成 change-id**（kebab-case，2~4 词，检查 `.specs/<id>/` 不冲突）
2. **架构级变更检测**（步骤 0.4）：命中 5 类信号时暂停，引导先跑 A-architect
3. **前端项目识别**（步骤 0.5）：关键词判定是否为前端项目
4. **视觉调性预选**（步骤 0.6，仅前端）：9 张调性卡片 + 推荐
5. **结构化反问**（步骤 1）：每轮最多 3 个问题
6. **影响面判定 + 范围排除**
7. **生成 CHANGE.md**（使用 `flow-kit/templates/CHANGE.md`）
8. **路径建议**：完整/中等/最短

## 产物

- `.specs/<change-id>/CHANGE.md`

## 状态推进

CHANGE.md 生成后，由 flow-comet 状态机（workflow-state/guard）推进节点。不需要手动维护 STATE.md。
