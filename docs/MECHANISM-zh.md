<div align="right">

[English](MECHANISM.md) · [中文](MECHANISM-zh.md)

</div>

# 核心机制（行为层）

本文档描述 flow-comet **做什么**——你使用时会观察到的行为与规则。实现细节（脚本逻辑、判定表、历史修复）不在本文档范围。

## 1. 状态机与路由（文件即真相）

- 单文件状态机 `.comet/flow-comet-state.json`；节点推进由 `workflow-guard.mjs exit <node> --apply` 门控
- **determineNode**：从 `.specs/` 工件实时推导当前节点（文件不齐 → 停在对应节点），不完全信任 state
- **自动纠偏**：state 的 currentNode 与推导不一致时自动写回（`next` 触发）

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
| 节点顺序 BLOCK | next 时 currentNode 未 exit（非正常推进后继）→ BLOCKED；exit 推进后正常 next 豁免；回退豁免 | next |
| handoff completedChecks | 子代理 Return Contract 必须含 required-skill completedChecks（skill 加载证据），缺失 → BLOCKED | exit subagent-execute |
| redEvidence 时序 | redEvidence 必须先于 greenEvidence 真实存在；已记录 greenEvidence 后补录 redEvidence → BLOCKED | workflow-handoff result |
| SUMMARY 六段 | verify 输出 / 6 维自查（非空）/ 越界检查 + 强制 `## 自检方法`——6 维自查两级降级：`brooks-review`（Skill 工具）→ 仅返回 "Launching skill" 占位时 Read 插件缓存协议文件手动执行完整审查（`cache-brooks`）→ 最后才是内置 R1~R6 快查（`builtin-quickcheck` 须声明不可用原因**和**缓存尝试证据；缺证据 → 渐进 WARN） | exit execute |
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

`scripts/guard-self-test.mjs`：**95 场景**覆盖全部 entry/exit 校验正反例（分支校验、追加位置检测、自定义协议、组合场景、自动初始化检测）——作者每次改动后的回归基线（沙箱环境自测脚本逻辑；**不是**安装验证判据）：

```bash
node .claude/skills/flow-comet/scripts/guard-self-test.mjs
# → ALL 95 SCENARIOS PASSED
```

## 6·5 自动初始化检测（init 前置步骤）

`init` 时工作流自动检测项目上下文（`.specs/CONTEXT.md`）是否存在，按 A~F 判决：

- **A/B**：已记录上下文决策或上下文新鲜（≤ 90 天）→ 完全静默
- **C**：上下文存在但上次扫描超过 90 天 → 仅提示（不强制）
- **D**：无上下文 + 检测到既有 AI 上下文文档（CLAUDE.md / AGENTS.md / .cursor / .windsurf / Copilot / Cline）→ 提示列出；同意后读取并整合（出处标注 `来自 <doc>:<line>` + 源文档段）——**绝不修改既有文件**
- **E**：无上下文 + 有代码 → 提示；同意后全量生成（依赖/目录探测填充技术栈与抽象索引段）
- **F**：greenfield（无代码上下文）→ 提示；同意后生成骨架

显式参数授权（无阻塞提示，无头兼容）：`--init-context` 执行全量生成（约 15-30k tokens，仅首次，提示中如实告知）；`--init-skip` 记录 `ai_context_doc: none` 并静默后续提示。项目级字段（`ai_context_doc` / `last_intel_scan`）跨 change 保留；state-schema 校验（fail-closed，旧 state 缺省为 null）。

## 设计原理

- **文件即真相，不做事件溯源**：单文件状态机 + 从 `.specs/` 推导节点——简单且恢复不依赖历史
- **结构级校验，不做语义判断**：guard 判"填没填"（段名/非空/结构），"填得好不好"交给 review——校验轻、误报少
- **检测+纠偏，不做拦截**：agent 环境无法真正阻止 LLM 直改文件，机器字段靠检测与自动写回
- **状态不入库**：`.comet/` 保持 gitignore——分支切换共享同一份工作树状态，避免状态分裂
- **不并行 change、不强制 PR**：一次一个 active change（状态机模型简单）；PR 审查按需开启

## 已知限制

- **仅 Claude Code 平台**：不保证 Codex/Gemini/Cursor
- **Return Contract 过渡规则**：旧格式纯字符串 handoff 豁免为 WARN；redEvidence/greenEvidence 缺失渐进 WARN（不 BLOCK），避免旧 change 重入被卡死
- **与 Comet Classic 不互通**：workflow-kernel 状态独立于 classic（设计决策，非缺陷）
- **无活跃 change 时 hook 放行**：`.comet/flow-comet-state.json` 不存在时 hook guard 放行所有写入（设计决策：无 workflow 时不限制文件操作）
- **hook blocking 语义**：exit 2（blocking）在主会话 TUI 实测生效；`claude -p`（SDK CLI 模式）下非零退出降级为 non-blocking——写入被记录但不阻止
- **worktree 挂载依赖**：Agent `isolation: "worktree"` 的 worktree 挂在**会话项目根**（非子代理目标项目）——跨仓库产物需 `git show <branch>:<path>` 手动搬运，该场景下提交文件溯源校验（`git show` 子集检查）降级
- **GUIDANCE 不经创作清单记录**：`<skill>-GUIDANCE.md` 与 SKILL.md 引用行不登记创作清单，重跑 Skill 生成工具会清掉
