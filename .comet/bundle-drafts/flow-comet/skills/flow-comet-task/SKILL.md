---
name: flow-comet-task
description: "flow-kit TASK 阶段协议：拆原子任务（XML 格式）、read_files/write_files 边界、波次划分、并行标记 [P]。Comet plan producer 的 flow-kit 实现。"
---

# flow-kit TASK Protocol

本 Skill 替代 Comet plan 阶段的默认实现，使用 flow-kit 的 TASK 拆解流程。

## 加载

读取 `flow-kit/prompts/3-task.md` 并按其执行。关键步骤：

1. **Artifact Preflight**：检查 REQUIREMENT.md + DESIGN.md 存在
2. **拆解原则**：
   - 大小：fresh context 2~10 分钟可完成
   - 粒度：按文件冲突切（垂直切片），不按层切
   - 并行标记 `[P]`：互不冲突的任务
   - 依赖：`depends_on: <task-id>`
3. **每任务 7 字段**：id / name / read_files / write_files / action / verify / done
4. **波次划分**：同层并行，跨层串行
5. **XML 格式**：便于 AI 解析与执行

## 产物

- `.specs/<change-id>/TASK.md`（XML 格式任务列表 + 波次划分图）

## Comet 集成

本 Skill 满足 `comet.plan.v1` Output Schema。TASK.md 完成后由 Comet 推进到 execute 阶段。
Comet 的 subagent-driven-development 可利用波次划分实现并行执行。
