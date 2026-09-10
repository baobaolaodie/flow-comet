---
name: flow-comet-health
description: "Use only when explicitly invoked as /flow-comet-health; periodic codebase health check: CONTEXT consistency, LESSONS scanning, tech-debt review, redundancy scan. Not part of the 8-node flow."
---

# flow-comet-health（横向命令 · 巡检）

## 触发

用户说「健康检查 / health / 体检 / 技术债扫描 / 巡检」。

## 前置依赖

- 装了 brooks-lint → 优先 `/brooks-health`（4 维综合体检；Codex 用 `$brooks-health`）
- 未装 brooks-lint → 用内置巡检清单降级

## 流程

1. 读 `.specs/CONTEXT.md` + `.specs/LESSONS.md` + 最近 1 份 `.specs/health/*.md`（对比基线）
2. 抽样 5 个最近改动频繁的 src/ 模块 + 5 个测试文件 + 最近 30 天 git log
3. 检查：
   - CONTEXT 与代码一致性（既有抽象索引是否过期）
   - LESSONS 是否需新增 / superseded
   - 技术债项（Pain × Spread 优先级）
   - 冗余（死代码 / 重复实现）——提示走 jscpd / knip / vulture 工具级扫描
4. 产出 `.specs/health/<date>.md` 报告 + 更新 CONTEXT 技术债段

## 边界

- 只读 + 报告，不自动改业务代码
- 发现的冗余/债项排入 backlog，不在本命令内修
