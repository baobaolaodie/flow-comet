---
name: flow-comet-task
description: "flow-kit TASK 阶段协议：拆原子任务（XML 格式）、read_files/write_files 边界、波次划分、并行标记 [P]。flow-comet plan 节点的 flow-kit 实现。"
---

# flow-kit TASK Protocol

本 Skill 为 flow-comet 的 plan 节点提供 flow-kit 的 TASK 拆解流程。

## 加载

读取 `flow-kit/prompts/3-task.md` 并按其执行。关键步骤：

1. **Artifact Preflight**：检查 REQUIREMENT.md + DESIGN.md 存在
2. **拆解原则**：
   - 大小：fresh context 2~10 分钟可完成
   - 粒度：按文件冲突切（垂直切片），不按层切
   - 并行标记 `[P]`：互不冲突的任务
   - 波次形态：依赖驱动多趟语义——每个并行任务显式声明 `depends_on`（后波依赖前波任务），引擎按依赖拓扑自动分趟消化（每趟委托全部依赖已满足的并行任务，趟间回串行），混排序列（串→并→串／并→串→并等交错形态）合法，无需压扁成单一连续块；唯一硬性拦截是依赖环（如 A→B→A，规划出口 BLOCKED 并附恢复指引——调整涉环任务的 depends_on 后重新 exit 即可通过），跳过未满足依赖先跑并行同样被拦。落笔时先画依赖方向再标 [P]。flow-kit 上游模板未载此约束，以本条为准
   - 依赖：`depends_on: <task-id>`
3. **每任务 7 字段**：id / name / read_files / write_files / action / verify / done
   - **write_files 必须包含关联测试文件**：若任务修改组件/函数，且有关联测试直接 import 其本地导出（如 `src/**/__tests__/*.test.ts` 从组件文件 import），该测试文件**必须纳入该任务 write_files**。否则组件删除本地导出/改 import 后，关联测试会编译失败或断言失效（实测：改组件时破坏了关联测试文件）。
4. **波次划分**：同层并行，跨层串行
5. **XML 格式**：便于 AI 解析与执行

## 产物

- `.specs/<change-id>/TASK.md`（XML 格式任务列表 + 波次划分图）

## 状态推进

本 Skill 满足 `flowkit.plan.v1` Output Schema。TASK.md 完成后由 flow-comet 状态机推进到 execute 阶段。
并行任务由 subagent-execute 节点按依赖分趟委托执行——委托节点可多次往返，直至无依赖已满足的可并行 pending 且无串行残留。
