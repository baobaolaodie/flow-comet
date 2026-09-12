---
name: flow-comet-evolve
description: "Use only when explicitly invoked as /flow-comet-evolve; scan archived changes' DESIGN.md section 9, batch-review sediment candidates, patch CONTEXT.md. Not part of the 8-node flow."
---

# flow-comet-evolve（横向命令 · 架构沉淀）

## 触发

用户说「同步架构 / 整理沉淀 / evolve / 同步 CONTEXT」；或 STATE.md last_evolve_at > 60 天。

> **载体说明（沿用 flow-kit 约定）**：`STATE.md` 与 `last_evolve_at` 是 flow-kit 的约定（A-evolve.md 定义：GO.md 按 last_evolve_at 提示、evolve 读/写该字段）——项目需有按 flow-kit 维护的 STATE.md；flow-comet 引擎不自动创建/维护该字段，无 STATE.md 的项目触发本命令时按「无 last_evolve_at 基线」处理（扫描全部未沉淀的归档 change 并人工确认）。

## 流程

1. 扫 `STATE.md` last_evolve_at 之后归档的 change
2. 只读每个 change 的 DESIGN.md § 9（禁止越界读 § 9 以外）
3. 聚合候选 → 贴给用户 review
4. 用户批准的才 patch `.specs/CONTEXT.md`（术语 / 已锁决策 / 抽象索引）
5. 更新 STATE.md last_evolve_at

## 边界

- 不写业务代码
- 不在本工作流改架构（需 A-architect 时提示用户）
- CONTEXT.md 更新统一走本命令或 I-intel-scan，不在 change 内直接改
