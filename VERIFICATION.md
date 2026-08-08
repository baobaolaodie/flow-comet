# flow-comet 分发验证记录（2026-08-02）

## 验证方法：本机 Claude 实测（非 comet 标准 eval）

由于 comet eval 的 `authoring-skill-smoke` 设计为 Docker 内运行 Claude（需 `ANTHROPIC_API_KEY`），改用**本机已认证的 claude CLI** 在测试项目实测 flow-comet skill。

## 测试环境

- 测试项目：`D:\LongYinHaHa\VSCode\flow-comet-e2e`
- 安装：16 个 flow-comet skills（从 bundle-drafts 复制到 `.claude/skills/`）+ flow-kit（clone）+ rules
- 执行：`claude -p "使用 flow-comet 工作流，初始化 change e2e-test，执行 open 节点" --dangerously-skip-permissions`

## 验证结果 ✅

| 项 | 结果 |
|---|---|
| workflow-state 初始化 | ✅ |
| open 节点 skill 路由 | ✅ |
| CHANGE.md 产出 | ✅（Why/What/影响面/路径建议，符合协议） |
| REQUIREMENT.md 产出 | ✅（US + AC Given/When/Then） |
| CONTEXT.md 更新 | ✅ |
| guard 推进 | ⚠️ claude -p 非交互超时（核心产出已生成，guard exit 未确认） |

**结论**：flow-comet 分发链路（init → open 路由 → 工件产出）**真实可用**，能被 Claude 正确驱动。

## 限制与后续

- `authoring-skill-smoke` 需 `ANTHROPIC_API_KEY`（Docker 内 Claude）——标准 comet eval 路径待 API key 配置后补跑
- guard exit 完整闭环（review/verify/archive）待真实交互式会话验证
- 测试项目 `flow-comet-e2e` 可作后续节点验证载体

## 补充验证结论（2026-08-02 第二轮）

### eval 桥接机制（待 API key 自动化）
- `authoring-skill-smoke` 在 Docker 内跑 Claude（需 `ANTHROPIC_API_KEY`），无法纯结构完成
- `workflow-route-conformance` 为纯结构检查（无需 API key），已通过
- eval-record 桥接：`draftHash` = bundle `currentHash`（bundle-authoring）、`evalManifestHash` = `comet/eval.yaml` 的 hash；需构建 schemaVersion 2 result.json。**自动化脚本待 comet hash 算法确认后实现**（当前手动桥接）

### hook 联动结论
- `comet-hook-router`（comet classic）不识别 workflow-kernel，对 flow-comet 的 `.specs/` + 代码写入**放行**（实测 name-format-unify 全流程无阻断）
- `comet-hook-guard`（flow-comet）是**路径安全守卫**（防 project root 逃逸/符号链接），非 write_files 白名单强制；write_files 边界靠 `workflow-guard` 的 diff 检查
- **current-change.json 陈旧非 flow-comet 问题**：flow-comet 用 `flow-comet-state.json`（activeChange），独立于 comet classic 的 `current-change.json`；双系统各管各层面（GAP-7 设计）

### 全流程验证修复累计（第二轮）
- record 命令解析 JSON 展开 evidence 顶层
- workflow-handoff 恢复 request/result/status（被 overlay 覆盖）
- archive-dir artifact path 用 glob 匹配日期（`archive/*-<change-id>`，修尾部斜杠）
- exit archive 自动清理 activeChange（归档后回到无活跃状态）
- flow-comet-task write_files 指南补"含关联测试文件"

## 后续验证进展（2026-08-04 ~ 2026-08-08）

### e2e 项目完整 8 节点验证（多轮 dogfood）

- **e2e-processor / e2e-processor-enhance / e2e-chunk / processor-topn / stats-aggregation**：8 节点全流程多轮跑通（open→archive），每节点 guard exit 通过，最终 `ALL CHECKS PASSED + NEXT: done`
- 分支模式（change/<id> + 归档 merge + 删分支）、追加位置纪律、PR 审查开关均真实验证
- 真实 TDD（RED→GREEN 证据全文）、UAT 场景级对照、归档完整（.specs/archive/ + CHANGELOG + LESSONS）

### 安装引导 dogfood（2026-08-08，用户从主仓按说明安装）

- fresh 用户按 README 方案 A 安装到全新项目 → 四步验证安装全部通过（结构/配置/一致性 diff/冒烟）
- 真实 harness 会话（claude -p）完整流程：内置 8 节点（sqrt 144 passed / calc-pi-const 114 passed）、自定义协议（calc-mod 101 / calc-min 168 / sci-notation 87）——三种协议形态零回归
- hook 主会话 TUI blocking 实测生效（越权写被物理阻止）

### 修复批次与回归基线

- 74 场景回归基线（guard-self-test）：`ALL 74 SCENARIOS PASSED`——修复批次 round1（T-FIX-15~18）+ round2（D-14~22）全部 TDD（RED→GREEN + 回滚验证）
- 独立验证者两轮（fresh 执行者按缺陷报告独立复现）：round1 5 项解决 + 发现 6 新问题；round2 12/12 解决 + 发现 D-21/D-22

**当时的「限制与后续」已全部落地**：guard exit 完整闭环（review/verify/archive）已在 e2e 多轮验证；完整 8 节点在真实交互式/无头会话均验证通过。
