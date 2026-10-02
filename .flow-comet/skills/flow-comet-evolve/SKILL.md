---
name: flow-comet-evolve
description: "Use only when explicitly invoked as /flow-comet-evolve; scan archived changes' DESIGN.md section 9 through the engine command, review sediment candidates one by one, then patch CONTEXT.md with the approved ones. Not part of the 8-node flow."
---

# flow-comet-evolve（横向命令 · 架构沉淀）

## 触发

用户说「同步架构 / 整理沉淀 / evolve / 同步 CONTEXT」。本命令**只按显式调用与用户意图触发**——到期提示是提醒，不是自动加载条件。

**覆盖声明（上游 vendored 只读）**：上游对应物 = `flow-kit/prompts/A-evolve.md`（只读基准，不修改）。**以下上游语义不采用**：① 载体 = 仓库根 `STATE.md` 的 `last_evolve_at` / `last_evolve_promoted` → 本仓载体 = **引擎 state**（`last_evolve_at`）+ `.specs/CONTEXT.md` 的 `## evolve 元数据` 段（本仓 `docs/internal/ARCHITECTURE.md` §六明确**不吸收** STATE.md 式跨会话状态跟踪）；② 已扫 change 清单写回 `STATE.md` 数组 → 本仓写进 `.specs/evolve/<日期>-EVOLVE.md` 报告，**不进 state**。**沿用上游**：只扫 `DESIGN.md` §9、逐项人工确认、禁止批量 promote、报告落 `.specs/evolve/`、60 天 / ≥5 个带沉淀段 change 的建议阈值。`## evolve 元数据` 段的**段形权威 = `flow-kit/templates/CONTEXT.md`**（`## intel-scan 元数据` 为同源先例；校验实现在 `context-init.mjs`）。本命令语义与产物形态**以本节为准**。

**到期提示（引擎输出面）**：`node .claude/skills/flow-comet/scripts/workflow-state.mjs status` 在下列任一条件成立时输出一行 `EVOLVE-DUE:`（含上次沉淀时间、命中原因与「建议显式调用 evolve」指引）：`last_evolve_at` 距今 > 60 天，或该时刻之后新增 ≥ 5 个带 `§9` 的归档 change。未达阈值**不输出**（零噪音）；`last_evolve_at` 缺席（从未沉淀过）同样不提示——需要时手动跑本命令即可。

## 时间戳载体：引擎 state（不使用 STATE.md）

- **唯一真相** = `.flow-comet/flow-comet-state.json` 的 `last_evolve_at`，形态为**本地时间 + 显式偏移**（`YYYY-MM-DDTHH:mm:ss±HH:mm`；历史 `Z` 形态仍可解析，比较一律按解析后的时刻差值）
- **写入通道唯一** = `node .claude/skills/flow-comet/scripts/workflow-state.mjs config set last_evolve_at <值>`（脚本不直写 state 文件）
- **双落点**：同批更新 `.specs/CONTEXT.md` 的 `## evolve 元数据` 段（`last_evolve_at` / `scanner` / `下次建议` 三字段，对齐 `## intel-scan 元数据` 的字段语义）。两处取值必须一致，**冲突以 state 为准**
- 旧项目若在 `STATE.md` 维护过该字段：以引擎 state 为准；首次运行按「无基线」全量扫描并建立新基线

## 流程

### 1. 扫描（只读，工作区零改动）

```
node .claude/skills/flow-comet/scripts/evolve.mjs scan --root .
```

- 扫描范围 = `last_evolve_at` **之后归档**的 change（无基线 → 全部归档 change）；归档时刻取归档目录名的日期前缀（随提交固化，跨 clone / 检出稳定）
- **只读**每个 `.specs/archive/<日期>-<change-id>/DESIGN.md` 的架构沉淀段（第 9 节）——**不读该文档的其它段**，防 change 级冻结决策被错误升级为项目级
- 输出候选清单：`<归档目录名>#<序号>` + 条目 + 目标文档；并列出本次已扫的 change（含无沉淀段、无 `DESIGN.md` 的目录），扫描范围对用户完全可见
- 候选落点按沉淀子段归类：可复用抽象 / 禁动清单 → `CONTEXT.md`「既有抽象索引」；项目级技术决策 → `CONTEXT.md`「已锁决策」；依赖 → `CONTEXT.md`「技术栈」；跨模块契约 → `ARCHITECTURE.md`「跨模块契约」（该文档不在场时需先建立，否则应用会被拒绝且零改动）

### 2. 逐项 review（用户参与，不可跳过）

把候选清单贴给用户，**逐条**确认：接受 / 跳过（记理由）/ 编辑后接受。**严禁**一次性把整批直接写入。与 `CONTEXT.md` 现有条目重叠的冲突项必须显式提问，不允许默默接受。

### 3. 应用（只写批准的项）

```
node .claude/skills/flow-comet/scripts/evolve.mjs apply <候选 id> [<候选 id> ...] --root . --scanner "<执行工具>"
```

- 只 patch 批准的条目：写入前先备份目标文档（`.specs/CONTEXT.md.bak-<日期>`），只追加不删除既有内容，条目带来源标注（`来源 @.specs/archive/<目录>/DESIGN.md`）
- 重复应用同一条目按**幂等**处理（目标段已在场则不重复写入）
- 同批写双落点时间戳（`config set` 通道 + `## evolve 元数据` 段，取值一致）
- 落 `.specs/evolve/<日期>-EVOLVE.md` 报告：扫描范围 + 已扫 change 清单 + 候选处置 + 未应用项 + 双落点取值 + 下次建议
- 输出 `EVOLVE-OK` 才算应用成功；失败输出 `BLOCKED:` 原因且不留下半成品（文档写入与 state 写入同一命令内完成，失败可幂等重跑）

### 4. 收尾

把报告路径与写入清单交给用户复核；**未应用的候选**保留在报告里，可凭候选 id 继续 `apply`。下次建议时间 = 约 60 天后，或新增 ≥ 5 个带沉淀内容的 change 之后。

## 边界

- 不写业务代码；写入面只有项目级文档、`.specs/evolve/` 报告与 `last_evolve_at`
- **只读沉淀段**：扫描与解析都不触碰设计文档的其它段
- 只追加 / 更新，**不删除**既有内容；发现需要改架构（决策推翻 / ADR 弃用 / 依赖规则变更）→ 停下来提示用户走架构重审
- `CONTEXT.md` 的更新统一走本命令或 `context-scan`，不在 change 内直接改
