---
name: flow-comet-requirement
description: "flow-kit REQUIREMENT 阶段协议：AC（Given/When/Then）+ v1·v2·out 范围切分 + 术语提取。flow-comet open 节点的 flow-kit 增强。"
---

# flow-kit REQUIREMENT Protocol

本 Skill 为 flow-comet 的 open 节点提供 flow-kit 的 REQUIREMENT 需求分析。

## 加载

读取 `flow-kit/prompts/1-requirement.md` 并按其执行。关键步骤：

1. **AC 编写**：每条 AC 使用 Given/When/Then 格式
2. **v1·v2·out 切分**：v1 本次必做 / v2 可推迟 / out 明确不做
3. **术语提取**：域语言表，写入 `.specs/CONTEXT.md`
4. **非功能性需求**：性能/安全/兼容性预算
5. **生成 REQUIREMENT.md**（使用 `flow-kit/templates/REQUIREMENT.md`）

## 产物

- `.specs/<change-id>/REQUIREMENT.md`
- `.specs/CONTEXT.md`（首次或需更新时）

## 状态推进

REQUIREMENT.md 是 design 节点的前置依赖。由 workflow-guard 检查产物完整性。
