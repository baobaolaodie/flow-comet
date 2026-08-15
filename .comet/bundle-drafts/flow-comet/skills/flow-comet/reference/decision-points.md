# Workflow Decision Classification

节点 skill 内嵌的交互确认点已作者化如下（与主 SKILL.md「决策分类与决策点」清单一致）。Do not infer that every Node or Output Schema requires confirmation. Classify each candidate into one of the four categories; pause only when at least two valid choices change scope, behavior, accepted risk, or an irreversible outcome.

## 四分类（真实用户决策 / 自动处理 / 停止条件 / 手动交接）

| 分类 | 定义 | 处理 |
|------|------|------|
| 用户决策 | ≥2 个会改变范围/行为/风险/不可逆结果的合法选项 | 用交互确认问（Claude Code 用 AskUserQuestion 优先；Codex 用文本提问+内联确认）或文本回退；相邻选择合并为一个问题，不重问已持久化选择 |
| 自动处理 | 唯一安全下一步 | 直接执行并汇报，不许制造确认 |
| 停止条件 | guard 失败 / 缺依赖 / 状态损坏 | 报告阻塞与恢复条件，无合法动作时才升级为用户决策 |
| 手动交接 | `NEXT: manual`（若有） | 不是用户决策，直接继续 |

## 作者化决策点清单（按节点）

### 用户决策（确认点，节点内暂停等待）

| 节点 | 决策点 | 触发条件 | 处理 |
|------|--------|---------|------|
| open | 首次调用主题/范围澄清 | 首次调用且主题/范围有多个合法解释 | 反问澄清后进入 |
| open | 视觉调性预选 | 仅前端项目（change 步骤 0.6） | 9 张调性卡片 + 推荐，用户选择 |
| design | 技术栈选型 | 5~6 卡筛选出 1 首选 + 1 备份 | 展示卡片 + 排除理由，等用户选择（CONTEXT 已锁技术决策时直接用） |
| execute | 破坏性变更检测（R4.6） | 命中破坏性变更信号 | 暂停展示引用图，用户确认后才继续 |
| execute | Schema 迁移（R4.5） | 检测到需要迁移 | 暂停等用户确认迁移方案 |
| execute | 切换 executionMode 到 direct | 用户要求 direct 模式 | 暂停确认，记录 directOverride |
| review | REVIEW Critical 项 | 审查发现 Critical 严重性项 | 暂停等人工确认处置 |
| verify | UAT 失败超限 | 第 4 次失败（机器计数 verifyFailures） | 暂停问用户「继续修 / 停止」（R2.6，≤3 次自动重试） |
| archive | 归档操作 | 移动文件到 .specs/archive/（不可逆） | 用户确认后才执行 |
| archive | 合并 change 分支到 main | 归档收尾 | merge 前暂停等用户确认 |
| archive | PR approve | enablePrReview 开启时（archive 前置） | 等用户/GitHub approve |

### 自动处理（唯一安全下一步，直接执行并汇报）

| 节点 | 决策点 | 处理 |
|------|--------|------|
| 全部 | 唯一安全下一步 | 直接执行并汇报，不许制造确认 |
| open/design | flow-kit 反问协议（CHANGE/REQUIREMENT/DESIGN）要求确认 | 按 flow-kit 规则暂停等待（协议要求的交互，非自由决策） |
| execute | verify 失败自动重试 | ≤ 3 次自动修复重试（机器计数 verifyFailures），不制造确认 |

### 停止条件（报告阻塞与恢复条件）

| 触发 | 处理 |
|------|------|
| Node guard 失败 | 先自动诊断并执行唯一安全修复；无合法动作时才升级为用户决策 |
| 缺依赖 / 状态损坏无法继续 | 报告停止条件与恢复条件；恢复方式存在多个会改变范围或风险的合法选项时才升级为用户决策 |

### 手动交接（非用户决策）

| 触发 | 处理 |
|------|------|
| 协议 `NEXT: manual`（若有） | 直接继续，不暂停询问 |

## 与节点 skill 的一致性

本清单作者化自节点 skill 内嵌确认点（open 调性预选——仅前端触发，记于节点技能 flow-comet-change，主 SKILL 清单不含 / design 技术栈 / execute 破坏性变更与 Schema 迁移与 direct 模式 / review Critical / verify 第 4 次失败 / archive 不可逆操作），与主 SKILL.md 决策点清单对应（主 SKILL 为汇总视角，前端专属确认点记于节点技能）；新增/调整节点 skill 确认点时同步本文件与主 SKILL。

### 机制性决策点（严格模式相关,非用户交互确认——机制自动判定,执行者须知）

| 节点 | 决策点 | 判定 |
|------|--------|------|
| execute | 空退出豁免 | 全 parallel 无串行可做时,须显式声明 `emptyExitApproved`(否则 BLOCKED);exit 输出 EMPTY-EXIT 审计 |
| execute | 越权委托豁免 | [P] 任务在 execute 完成属越权委托(新 change BLOCKED),须经 subagent-execute 委托或显式说明 |
| 各节点 | entry 强制 | 新 change 未 entry 直接 exit → BLOCKED(旧 change WARN 渐进) |
| 各节点 | 新旧判定 | init 写入 `newChange: true` = 新 change(严格模式);旧 change(无标记)渐进 WARN |
