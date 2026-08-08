<div align="right">

[English](USAGE.md) · [中文](USAGE-zh.md)

</div>

# 使用

## 8 节点工作流

```
open → design → plan → execute ⇄ subagent-execute → review → verify → archive
```

**与 flow-kit 9 阶段的映射**：`open` 节点产出 CHANGE 与 REQUIREMENT 两阶段工件（`CHANGE.md` + `REQUIREMENT.md`）；其余一一对应（design=设计阶段；execute/subagent-execute=DEV/TEST 执行拆分；review/verify/archive=REVIEW/INTEGRATION/ARCHIVE 收尾）。

路由由脚本从 `.specs/` 工件**自动推导**（determineNode）：文件不齐 → 停在对应节点；任务未完成 → 停在 execute；全部完成 → 依次推进 review/verify/archive。

### 逐节点职责

| 节点 | 职责 | 关键产物 | 出口校验（guard） |
|------|------|---------|------------------|
| **open** | CHANGE 反问 + 需求分析（AC 推导） | `CHANGE.md` / `REQUIREMENT.md` / CONTEXT 术语更新 | 必填段（模板派生）：`## Why` / `## 用户故事` / 验收段；CONTEXT 孤立追加段检测 |
| **design** | 技术栈选型 + 架构对齐 + 决策 | `DESIGN.md`（§0 技术栈 / §0.5 架构对齐 / 决策清单 / 风险） | §0 段 + `## 决策清单`（模板派生，支持编号） |
| **plan** | 原子任务拆分（XML）+ 波次划分 | `TASK.md`（`<task>` 块含 7 字段 + parallel 标记） | task 块存在 + verify 字段；TASK 签名哈希（enter 记录） |
| **execute** | 串行任务执行（协调者委托子代理） | `<task-id>-SUMMARY.md` | SUMMARY 六段 + 6 维自查 + 强制 `## 自检方法`；TASK 签名比对；越俎代庖检测 |
| **subagent-execute** | parallel 任务并行委托（wave） | 同上（每任务一份 SUMMARY） | 同上 + handoff evidence（Return Contract） |
| **review** | 双轮审查（spec 合规 + 代码质量） | `REVIEW.md`（Critical/发现/结论） | ≥100B + 必填段 |
| **verify** | 集成验证 + UAT + 失败诊断（≤3 轮） | `TEST.md` / `UAT.md` / LESSONS 提名 | 验证命令真实执行；UAT 必填段；LESSONS 编号/位置检测 |
| **archive** | LESSONS 提名 + 归档 + 分支收尾 | `.specs/archive/<date>-<id>/` / CHANGELOG | 分支校验（新模式）；CHANGELOG 倒序检测 |

## 分支模式

以下分支操作均由 Claude 在 skill 协议下**自动执行**（无需手动 git）：

- 首次 `/flow-comet` 调用自动创建 `change/<change-id>` 分支（git 仓库时），全流程在分支上进行；分支前缀可配置（`init --branch-prefix <prefix>`，如 `feat/`，须以 `/` 结尾，默认 `change/`）
- 归档时收尾：自动合并回主分支 + 删除分支（`enablePrReview=true` 时先推送 + PR；**merge 前暂停等你确认**）
- 分支-状态一致性：`status`/`next` 检测分支与 activeChange 不符 → WARN（不 BLOCK）
- **向后兼容**：无分支的旧 change 照常运行（分支校验仅新模式生效）

## 执行模式（executionMode）

| 模式 | 语义 | 何时用 |
|------|------|--------|
| `subagent`（默认） | 统一委托子代理：协调者构造 handoff → Agent worktree 委托 → 收集 Return Contract → 验收标 done | 默认质量兜底 |
| `direct`（逃生口） | 主代理直接执行串行任务（需加载 flow-comet-dev 完整协议） | 用户显式切换（`workflow-state.mjs execution-mode direct`）后 |

`directOverride` 记录"当前处于用户确认的 direct"，切回 subagent 时自动清除。

## Express 路径（低风险降级）

CHANGE.md 头部含 `express: true`（低风险判定：改动 ≤3 文件、无后端 schema/API/数据库变更、无安全/认证/并发、纯前端重构/文案/简单 bug 修复）时自动降级：

- **review** 只执行 Round 1（spec 合规）+ Round 1.5（契约核对），跳过代码质量轮与 UI 轮
- **TEST/UAT** 用最小矩阵（只第 1 轮功能 + 核心 AC 手动确认）；REVIEW.md 标注 "express 审查"

## 用户入口

在目标项目打开 Claude Code，输入：

| 入口 | 用途 |
|------|------|
| `/flow-comet` | 启动或继续 8 节点工作流（自动检测活跃 change，路由到当前节点） |
| `/flow-comet-compose` | 组合已安装 skill 生成自定义协议（横向命令，不属于 8 节点流程——见 [PROTOCOL-zh.md](PROTOCOL-zh.md)） |
| `/flow-comet-evolve` | 扫描已归档 change 的 DESIGN §9，批量评审沉积候选（横向） |
| `/flow-comet-health` | 周期健康检查：CONTEXT 一致性 / LESSONS 扫描 / 技术债 / 冗余（横向） |

## 流程中的决策点

flow-comet 在以下节点**暂停并向你确认**（其余全部自动推进）：

| 节点 | 决策点 |
|------|--------|
| 首次调用 | change 主题与范围（存在多个合法解释时） |
| design | 技术栈选型（5~6 张候选卡） |
| execute | 破坏性变更检测（R4.6）；Schema 迁移（R4.5） |
| review | REVIEW 的 Critical 项处理 |
| verify | UAT 连续失败第 4 次：「继续修 / 停止」 |
| archive | 归档与 merge change 分支到 main（不可逆操作） |
| 归档前置 | PR approve（`enablePrReview` 开启时） |

## 脚本速查（引擎内部，Claude 自动执行）

以下脚本由 flow-comet skill 在流程中**自动运行**——正常使用无需手动执行，仅在故障排查或高级场景使用。路径：`<目标项目>/.claude/skills/flow-comet/scripts/`：

```bash
node workflow-state.mjs status             # 当前状态 + 分支一致性
node workflow-state.mjs init <id> [--branch-prefix <prefix>]   # 初始化 change（自动建分支，前缀默认 change/）
node workflow-state.mjs next               # 获取下一节点与 SKILL
node workflow-state.mjs record <node> '{...}'                  # 记录节点证据
node workflow-state.mjs config set enablePrReview true         # 开启 PR 审查
node workflow-state.mjs execution-mode <subagent|direct>       # 切换执行模式（direct 需确认）
node workflow-guard.mjs entry/exit <node> [--apply]            # 节点门禁
node workflow-handoff.mjs request|result|status                # 子代理委托交接
```

**子代理委托**（execute/subagent-execute 节点，由 Claude 自动执行）：按 TASK.md 解析 write_files → `workflow-handoff.mjs request` → Agent 工具（`isolation: "worktree"`）委托并回传 Return Contract → `result` 记录证据 → guard 校验委托合法性。
