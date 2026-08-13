<div align="right">

[English](README.md) · [中文](README-zh.md)

</div>

# flow-comet 产物示例 — processor-pipeline

**本示例是真实归档的 change**——flow-comet-e2e 假项目中一次完整 8 节点流程(open → design → plan → execute → subagent-execute → review → verify → archive)的全部工件,2026-08-13 归档。作为当前产物体系(六段 SUMMARY/REVIEW 处置标记/skill-load 声明标记)下完整 change 产物的质量参照。

## 场景:processor 包管道化增强

e2e 项目 `processor/` 包(纯 Python 数据处理库:dedupe / chunk / sort / stats)的 brownfield 改造:新增 `pipe` 组合函数 + 各处理器参数增强(dedupe `key`、chunk `max_size`、sort `key`/`reverse`),含全量回归(82 既有测试 → 101,零破坏)。本 change 覆盖完整机制面:并行委托(T01/T02,独立模块)、串行委托(T03/T04)、依赖组合任务(T05)、收口任务(T06)。

## 工件清单(按 flow-kit 9 阶段顺序)

| 文件 | 阶段 | 说明 |
|------|------|------|
| CHANGE.md | open | 变更提案(Why/What/影响面/范围排除/验收线) |
| REQUIREMENT.md | open | 需求 + AC(Given/When/Then)+ 范围切分 |
| DESIGN.md | design | 技术决策(§0 技术栈/§0.5 架构对齐/决策清单/风险) |
| TASK.md | plan | 原子任务(XML + 波次划分 + 7 字段) |
| T01-SUMMARY.md | subagent-execute | 六段 SUMMARY(做了什么/改动文件/verify 输出/6 维自查/越界检查/自检方法) |
| T02-SUMMARY.md | subagent-execute | 六段 SUMMARY |
| T03-SUMMARY.md | execute | 六段 SUMMARY |
| T04-SUMMARY.md | execute | 六段 SUMMARY |
| T05-SUMMARY.md | execute | 六段 SUMMARY |
| T06-SUMMARY.md | execute | 六段 SUMMARY(全量回归 + 文档) |
| REVIEW.md | review | 审查报告(发现区带处置标记 `[已修]/[升级]/[转待办]`) |
| TEST.md | verify | 5 轮测试金字塔 + `## 验证命令`(verify 出口真实执行) |
| UAT.md | verify | 验收结果(逐 AC pass/fail) |
| KNOWN-ISSUES.md | archive | 遗留跟进项(REVIEW 的 [转待办] 发现) |
| `.skill-loads/` | 全程 | skill-load 声明标记(11 个——每个节点-技能声明一条) |

## 用途

- **对照质量标准**:新 change 的工件可与本示例逐段比对,确认必填段是否齐全
- **理解 flow-kit 模板**:示例是 `flow-kit/templates/` 模板的填充实例
- **验证 flow-comet guard**:本示例通过全部 guard 校验且无警告——open/design/plan/execute/review exit 全部 PASS;verify 出口真实执行 `pytest -q`(101 passed);SUMMARY 声明自检方法,REVIEW 发现项带处置标记

## 注意

- 本示例是 e2e 假项目的真实归档 change——代码路径引用指向 e2e 的 `processor/` 包(不随本仓库分发);工件是流程的真实产出,非模拟
- 工件语言跟随示例项目的主语言(中文)——按 flow-kit R8.1
