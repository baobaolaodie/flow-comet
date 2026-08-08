<div align="right">

[English](MECHANISM.md) · [中文](MECHANISM-zh.md)

</div>

# 核心机制（行为层）

本文档描述 flow-comet **做什么**——你使用时会观察到的行为与规则。实现细节（脚本逻辑、判定表、历史修复）在项目内部文档中。

## 1. 状态机与路由（文件即真相）

- 单文件状态机 `.comet/flow-comet-state.json`；节点推进由 `workflow-guard.mjs exit <node> --apply` 门控
- **determineNode**：从 `.specs/` 工件实时推导当前节点（文件不齐 → 停在对应节点），不完全信任 state
- **P0-2 自动纠偏**：state 的 currentNode 与推导不一致时自动写回（`next` 触发）

## 2. 三层防线（越俎代庖防护）

| 层 | 机制 | 校验点 |
|----|------|--------|
| ① hook 物理拦截 | phase 白名单：execute/subagent-execute 协调者只写 `.specs/`；源码由 worktree 子代理写（cwd 无 state → 放行） | 写入目标路径 + currentNode |
| ② 协调者禁令 | `next`/`entry` 每次注入"你是协调者不是执行者"（direct 模式 execute 豁免） | 输出注入 |
| ③ exit 越俎代庖检测 | parallel 任务 done 必须有 handoffResult，否则 BLOCKED（`parallelTakeoverApproved` 显式豁免） | TASK.md + handoff evidence |

hook blocking 语义：PreToolUse hook 的 exit 2（blocking——阻止工具调用）在**主会话 TUI 实测生效**；`claude -p`（SDK CLI 模式）下非零退出被降级为 non-blocking——写入被记录但不阻止。

## 3. guard 校验体系（证据驱动推进）

| 机制 | 校验点 | 触发 |
|------|--------|------|
| 段名模板派生 | open/design exit 必填段名从 `flow-kit/templates/` 派生（模板缺失 fallback 内置） | exit open/design |
| TASK 签名哈希 | enter 记录任务集签名（行尾规范化 + 剥离标记类属性）→ exit 比对：增删任务/改 action/改边界 → BLOCKED；标记 done/加标记属性合法 | enter/exit execute |
| 节点顺序 BLOCK | next 时 currentNode 未 exit（非正常推进后继）→ BLOCKED；exit 推进后正常 next 豁免；T-FIX 回退豁免 | next |
| handoff completedChecks | 子代理 Return Contract 必须含 required-skill completedChecks（skill 加载证据），缺失 → BLOCKED | exit subagent-execute |
| redEvidence 时序 | redEvidence 必须先于 greenEvidence 真实存在；已记录 greenEvidence 后补录 redEvidence → BLOCKED | workflow-handoff result |
| SUMMARY 六段 | verify 输出 / 6 维自查（非空）/ 越界检查 + 强制 `## 自检方法` | exit execute |
| verify 真实执行 | TEST.md `## 验证命令` 真实运行（支持多行 `&&`）；verifyFailures 机器计数，第 4 次 → BLOCKED | exit verify |
| 追加位置检测 | CONTEXT 孤立追加段 / LESSONS 编号乱序 / STATE+CHANGELOG 非倒序 → WARN（渐进） | exit open/verify/archive |
| 委托前检查 | `.specs/<change>/` 未提交工件 → WORKTREE WARN；PROGRESS.md 存在 → 恢复警告 | entry execute |
| state schema 校验 | writeState 字段类型 fail-closed（state-schema.mjs 单一来源，三脚本共用） | 全部 state 写入 |

## 4. 执行模型（子代理化）

- **Return Contract**：子代理回传 `{status, commitHash, redEvidence, greenEvidence, completedChecks, riskSignals}`——缺 commitHash/greenEvidence/completedChecks → BLOCK；缺 redEvidence → 渐进 WARN；redEvidence 事后补录 → BLOCK
- **handoff hash 溯源**：`git show <commitHash>` 校验提交文件 ⊆ write_files（从 TASK.md 自动解析，剥 XML 注释）
- **write_files 冲突检测**：parallel 任务 write_files 不重叠才可同 wave 并行

## 5. 恢复协议

- 任意入口恢复：determineNode 从文件推导 + state 自动纠偏（不依赖对话历史）
- PROGRESS.md 恢复警告（R1.6 反重复）
- 分支-状态一致性校验

## 6. guard 自测套件（作者回归基线）

`scripts/guard-self-test.mjs`：**74 场景**覆盖全部 entry/exit 校验正反例（分支校验、追加位置检测、自定义协议、组合场景）——作者每次改动后的回归基线（沙箱环境自测脚本逻辑；**不是**安装验证判据）：

```bash
node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs
# → ALL 74 SCENARIOS PASSED
```
