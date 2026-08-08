# flow-comet 产物示例

本目录包含 flow-comet 全流程产出的工件示例，用于参考和对照。

## 场景：赛事场地筛选器

模拟一个乒乓球赛事管理系统的功能变更：管理员在赛事列表页按场地筛选赛事。涉及后端 API 新增 venue_id 查询参数 + 前端列表页新增筛选下拉。

## 工件清单（按 flow-kit 9 阶段顺序）

| 文件 | 阶段 | 说明 |
|------|------|------|
| CHANGE.md | open | 变更提案（Why/What/影响面/范围排除/风险） |
| REQUIREMENT.md | open | 需求（AC Given/When/Then + 范围切分） |
| DESIGN.md | design | 技术决策（§0 技术栈 / §0.5 架构对齐 / 决策清单 / 数据流图 / 风险） |
| TASK.md | plan | 原子任务（XML 格式 + 波次划分 + 7 字段） |
| T01-SUMMARY.md | subagent-execute | 并行任务产出（6 维自查 + 越界检查） |
| T02-SUMMARY.md | subagent-execute | 并行任务产出 |
| T03-SUMMARY.md | execute | 串行任务产出 |
| T04-SUMMARY.md | execute | 串行任务产出 |
| T05-SUMMARY.md | execute | 串行任务产出（含回归测试） |
| REVIEW.md | review | 4 轮审查（Spec 合规 / 6 维诊断 / UI 视觉 / 跨模型） |
| TEST.md | verify | 5 轮测试金字塔（功能/性能/安全/兼容/可观测） |
| UAT.md | verify | 用户验收测试结果 |

## 用途

- **对照质量标准**：新 change 的工件可与本示例逐段比对，确认必填段是否齐全
- **理解 flow-kit 模板**：示例是 `flow-kit/templates/` 模板的填充实例
- **验证 flow-comet guard**：本示例通过了 flow-comet 的全部 guard 校验（open/design/plan/execute/review/verify exit 全部 PASS）

## 注意

- 这是模拟数据，不涉及真实项目代码
- 所有敏感信息已脱敏（电话号码、用户名等）
- 代码路径引用指向模拟的乒乓球赛事系统结构
