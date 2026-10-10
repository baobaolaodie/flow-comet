---
name: flow-comet-integration
description: "flow-kit INTEGRATION 阶段协议：集成验证 + UAT + 失败诊断（≤3 轮）+ LESSONS 提名 + 归档。flow-comet verify/archive 节点的 flow-kit 增强。"
---

# flow-kit INTEGRATION Protocol

本 Skill 为 flow-comet 的 verify 和 archive 节点提供 flow-kit 的集成验证和归档流程。

> **模板权威**：本技能产出工件的段形唯一权威 = `flow-kit/templates/**`；`.specs/archive/**` 是历史证据、**不是模板来源**——不得以「上一轮就是这么写的」对齐段形。

## 加载

读取 `flow-kit/prompts/7-integration.md` 并按其执行。

### 集成验证（verify 阶段）

1. **跑全套自动化**：全量单测 + 集成测试 + 类型检查 + 构建
2. **引导人工 UAT**：逐条执行 TEST.md 中的 UAT 脚本
3. **失败诊断**：root cause → fix-plan → 回到 execute 修复 → 重跑
   - **自动重试 ≤ 3 轮**（R2.6），超限暂停等人工决策

### LESSONS 提名（archive 前必跑 · 判据单一权威在本册）

扫描本次 change 的所有 `*-SUMMARY.md`（重点「决策与偏差」段）与遗留 `*-PROGRESS.md`（「已排除方案」段），按提名条件逐条筛选：
- 调试/试错耗时 > 30 分钟 → 提名
- 错因不限于本任务（其他任务也会撞上）→ 提名
- 6 个月内有合理概率被再次尝试 → 提名
- 其余一律不提名（避免污染 `.specs/LESSONS.md`）

提名动作：新条目编号 = 当前最大编号 + 1（续 `L-NNN`），插入 `## 条目区` 末尾（文件内升序，继续现有编号）——**禁止文件尾追加与乱序插入**；同时扫既有 active 条目，被本次结论取代 / 废弃的更新其状态。**不归档** `.specs/LESSONS.md`（项目级常驻，跨 change 累积）。

> 本段是提名判据的**单一权威**（本册同时是 verify 与 archive 两节点的 Required Skill，判据必然在上下文里）；各节点册的同口径表述一律**以本册为准**——同一口径多处表达必分叉。

### 归档（archive 阶段）

1. `.specs/<change-id>/` → `.specs/archive/<YYYY-MM-DD>-<change-id>/`
2. `.specs/CHANGELOG.md` 顶部按日期倒序插入一行——**跟随项目既有格式**（非表格格式同样在顶部插入，不强制转表格；guard 的倒序检测只针对表格格式行）——完整协议见 `flow-comet-archive` 册
3. **不归档** `.specs/LESSONS.md`（项目级常驻）
4. DESIGN.md § 9 架构沉淀建议留待 A-evolve 批量同步

## 产物

- `.specs/<change-id>/UAT.md`
- `.specs/archive/<YYYY-MM-DD>-<change-id>/`
- 更新的 `.specs/CHANGELOG.md` 和 `.specs/LESSONS.md`

## 状态推进

归档操作必须用户确认后才执行。失败诊断的自动重试由 verify 节点管理（机器计数 verifyFailures，≤3 次，第 4 次暂停等用户决策）。
