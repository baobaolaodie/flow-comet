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

hook blocking 语义（见已知限制）：PreToolUse hook 的 exit 2 在主会话 TUI 阻止工具调用；`claude -p`（SDK CLI 模式）下非零退出被降级为 non-blocking。

越界拦截的项目根兜底链：会话 cwd 漂移时按 `COMET_RUN_ROOT` → `CLAUDE_PROJECT_DIR` → 含 `.comet/flow-comet-state.json` **或** `.claude/skills/flow-comet` 的最近祖先 → cwd 锚定项目根，项目根外写入仍被拦截。

## 3. guard 校验体系（证据驱动推进）

| 机制 | 校验点 | 触发 |
|------|--------|------|
| 段名模板派生 | open/design exit 必填段名从 `flow-kit/templates/` 派生（模板缺失 fallback 内置） | exit open/design |
| TASK 签名哈希 | enter 记录任务集签名（行尾规范化 + 剥离标记类属性）→ exit 比对：增删任务/改 action/改边界 → BLOCKED；标记 done/加标记属性合法 | enter/exit execute |
| 节点顺序 BLOCK | next 时 currentNode 未 exit（非正常推进后继）→ BLOCKED；exit 推进后正常 next 豁免；回退豁免 | next |
| handoff completedChecks | 子代理 Return Contract 必须含 required-skill completedChecks（skill 加载证据），缺失 → BLOCKED | exit subagent-execute |
| 技能加载前置门 | 新 change 的 handoff request / record 前必须已有本节点 skill-load 声明标记；声明须在用 **Skill 工具**加载技能之后（读 SKILL.md 文件不算加载） | handoff request / record |
| redEvidence 时序 | redEvidence 必须先于 greenEvidence 真实存在；已记录 greenEvidence 后补录 redEvidence → BLOCKED | workflow-handoff result |
| 契约解析失败检测 | record / workflow-handoff result：形似对象字面量的 payload 却 JSON 解析失败 → 报错并提示 `--json-file`，**不写** state（fail-closed，不落脏数据） | record / workflow-handoff result |
| 疑似对象启发式边界 | 以 `{`/`[` 开头或含 `:`/`;` 的 payload 会被判为疑似对象字面量；若随后解析失败则 fail-closed 拒绝并提示 `--json-file`——处于该边界的合法纯文本会被保守拒绝（安全侧设计，不落脏数据） | record / workflow-handoff result |
| SUMMARY 六段 | verify 输出 / 6 维自查（非空）/ 越界检查 + 强制 `## 自检方法`——6 维自查段须声明 `brooks-review` 或 `cache-brooks`（两级降级：Skill 工具 → 仅返回 "Launching skill" 占位时 Read 插件缓存协议文件手动执行完整审查）；`builtin-quickcheck` 只出现在 `## 自检方法` 段（须声明不可用原因**和**缓存尝试证据；新 change 缺失 BLOCKED；旧 change WARN） | exit execute |
| 处置标记 | REVIEW.md 发现区条目须带 `[已修]`/`[升级]`/`[转待办]`(新 change 缺失 BLOCKED;旧 change WARN) | exit review |
| builtin 自检证据 | `builtin-quickcheck` 须声明不可用原因与插件缓存尝试证据(新 change 缺失 BLOCKED;旧 change WARN) | exit execute |
| 工件模板保真 | SUMMARY / TASK / CHANGE / REQUIREMENT / DESIGN 须保持模板标题、首部字段与段序；新 change 任一缺失 → 阻断 + 恢复指引，旧 change 仅告警 | exit execute / plan / open / design |
| 波次散文一致性 | 散文 `[P]` 标记须与任务 `parallel="true"` 一致(新 change 不一致 BLOCKED;旧 change WARN) | exit plan |
| 波次分组一致性 | 分组合法性由依赖图判定而非块位置：`depends_on` 无环且引用任务全部存在即合法；串/并混排（穿插）序列合法，由多趟路由按依赖拓扑分趟消化；仅依赖环或缺失依赖引用 BLOCK——新 change BLOCK 含 `depends_on` 调整指引，旧 change WARN | exit plan |
| 伪并行提示 | 并行任务声明的写入仅含测试文件时，plan 出口输出不阻断的警告（任务 id + 建议：声明显式 `depends_on` 或合并为垂直切片） | exit plan |
| 越权委托 | 并行 done 任务须经委托节点(新 change 未委托 BLOCKED;旧 change WARN) | exit execute/verify |
| verify 真实执行 | TEST.md `## 验证命令` 真实运行（支持多行 `&&`）；verifyFailures 机器计数**按变更隔离**（切换变更不继承另一变更的失败次数），第 4 次 → BLOCKED（超时可用 `FLOW_COMET_VERIFY_TIMEOUT_MS` 配置，默认 300s） | exit verify |
| 追加位置检测 | CONTEXT 孤立追加段 / LESSONS 编号乱序 / STATE+CHANGELOG 非倒序 → WARN（渐进） | exit open/verify/archive |
| 任务完成产物 | 每个 done 任务须有对应 <id>-SUMMARY.md；缺失 → WARN（渐进）（任务声称完成但产物不齐） | exit execute |
| 委托前检查 | `.specs/<change>/` 未提交工件 → WORKTREE WARN；PROGRESS.md 存在 → 恢复警告 | entry execute |
| state schema 校验 | writeState 字段类型 fail-closed（state-schema.mjs 单一来源，三脚本共用） | 全部 state 写入 |

## 4. 执行模型（子代理化）

- **Return Contract**：子代理回传 `{status, commitHash, redEvidence, greenEvidence, completedChecks, riskSignals}`——缺 commitHash/greenEvidence/completedChecks → BLOCK；缺 redEvidence → 渐进 WARN；redEvidence 事后补录 → BLOCK
- **handoff hash 溯源**：`git show <commitHash>` 校验提交文件 ⊆ write_files（从 TASK.md 自动解析，剥 XML 注释）
- **零提交任务**：request 侧 `write_files` 为空（或 request 记录了 `noCommit` 标记）即判定为零提交——result 跳过提交文件子集校验并输出可审计提示；零提交结果若携带 tracked 提交，新 change 阻断、旧 change 告警
- **write_files 冲突检测**：parallel 任务 write_files 不重叠才可同 wave 并行
- **多趟路由**：串/并交互的序列在依赖语义下合法——委托节点可多次进入，每趟按依赖拓扑委派全部依赖已满足的并行任务；等待后续波次的串行任务是合法趟间态

## 5. 恢复协议

- 任意入口恢复：determineNode 从文件推导 + state 自动纠偏（不依赖对话历史）
- PROGRESS.md 恢复警告（R1.6 反重复）
- 分支-状态一致性校验
- `advance` 逃生口：结构性死结且无常规恢复动作时，`workflow-state.mjs advance` 强制推进（使用后须重新 entry 本节点并重做交付记录）；常规缺产物/缺证据情形不适用

## 6. guard 自测套件（作者回归基线）

`scripts/guard-self-test.mjs`：**200 个场景**覆盖全部 entry/exit 校验正反例（分支校验、追加位置检测、自定义协议、组合场景、自动初始化检测）——与 `system-test.mjs`（67 项，真实命令序列覆盖全部机制面）构成两级回归基线，每次改动后必须（沙箱环境自测脚本逻辑；**不是**安装验证判据）：

```bash
node .claude/skills/flow-comet/scripts/guard-self-test.mjs
# → ALL 200 SCENARIOS PASSED
```

## 6.5 DeepSeek Harness（dsh）平台

在 DeepSeek Harness 上，flow-comet 经 **prepare-env 安装器**（`--platform dsh`）安装——无插件包、无 npm 包（留后续 / 1.5.0）；引擎零改动，guard 判定核心经子进程调用原样复用：

- **安装**：`node scripts/prepare-env.mjs --target <项目> --platform dsh`（最低 dsh `0.1.0-rc.6`；dev preview）。
- **项目级技能发现**：技能树安装到 `<项目>/.dsh/skills/flow-comet`；dsh 在 `<项目>/.dsh/skills/` 下以 rank 100 自动发现（文件监听、免重启）——**未安装该目录的项目不可见该技能**，因此激活天然是项目级的（无运行时痕迹判定、无 chicken-and-egg）。
- **拦截**：全局挂载在 `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` 的薄桥接 loader（`$DSH_HOME/cordis.patch.yml` 托管块，所有 profile 生效）监听 dsh 的 `tools/pre-execute` waterfall 事件，把工具参数映射到同一 guard 契约（`Write`/`Edit` → `file_path`，`Bash` → `command`），子进程调用项目本地 `comet-hook-guard.mjs`，流程运行中越权写入返回 `{kind:'deny', reason}`（BLOCK 消息 + 恢复指引）；参数形状不符与异常退出 fail-closed。Windows 8.3 路径下判定前把项目根规范化为长形态，避免 guard 的词法路径解析跳过白名单（fail-open）。
- **激活范围**：桥接仅当会话项目根含 `.dsh/skills/flow-comet` 时处理（窄监听）——非 flow-comet 项目零侵入。
- **执行者放行**：协调者把任务委托给子代理时，被委托的子代理（以会话的子代理委托深度识别）作为执行者写入源码、跳过阶段白名单——与其他平台 worktree 隔离语义一致；协调者仍受白名单约束。流程运行中越界写入与参数形状不符对两者一律拒绝。
- **包含性仅流程运行中生效**：空闲态（无 state / 无 `activeChange` / `completed`）项目根外写放行；解析失败 / 未知状态保持 fail-closed（拒绝）。
- **托管规则注入**：安装时把编排规则注入 `AGENTS.md` 的 `<!-- Managed by flow-comet prepare-env -->` 托管区（非破坏合并，标记与 Codex 共用）。

## 6.6 安装器行为（flow-kit 获取、loader 生命周期、bridge-check）

`prepare-env` 在安装中扩展了 flow-kit 获取、dsh loader 生命周期汇报与只读桥接健康检查：

- **flow-kit 获取（五态）**：平台循环前安装器确保 `<目标项目>/flow-kit/` 就位——缺失 → 克隆上游并检出锁定快照 commit `9b5dda7`；已存在的上游克隆（`.git` 存在且 `origin` remote 匹配）→ 只读 HEAD-vs-锁定点比对与差异影响报告（绝不改动）；已存在的同名非克隆目录（或 origin 无法确认）→ 跳过并给出手动指引；clone/checkout 网络失败 → WARN + 手动指引，安装继续（exit 0）；purge 永不包含 `flow-kit`（含 `--purge --yes`）。
- **dsh loader 版本迁移**：桥接 loader 携带内嵌版本戳（`// BRIDGE_VERSION: <version>`）；每次 dsh 安装先比对权威源戳与已装 loader 戳再覆盖，输出首次安装 / 升级 `A → B` / 降级 `A → B` / 版本一致。
- **bridge-check（只读）**：`workflow-state.mjs bridge-check` 对 dsh 桥接执行零写入、零网络的健康检查，共六态——健康（exit 0）、文件缺失 / 未挂载 / 版本偏斜 / 重复注册（exit 1）、不适用（exit 0，项目未安装 dsh 平台副本）。无法识别的 YAML 形态输出近似性声明告警（只告警不定论——绝不误杀）；仅明确失配强制非零退出。

## 7. 自动初始化检测（init 前置步骤）

`init` 时工作流自动检测项目上下文（`.specs/CONTEXT.md`）是否存在，按 A~F 判决：

- **A/B**：已记录上下文决策或上下文新鲜（≤ 90 天）→ 完全静默
- **C**：上下文存在但上次扫描超过 90 天 → 仅提示（不强制）
- **D**：无上下文 + 检测到既有 AI 上下文文档（CLAUDE.md / AGENTS.md / .cursor / .windsurf / Copilot / Cline）→ 提示列出；同意后读取并整合（出处标注 `来自 <doc>:<line>` + 源文档段）——**绝不修改既有文件**
- **E**：无上下文 + 有代码 → 提示；同意后全量生成（依赖/目录探测填充技术栈与抽象索引段）
- **F**：greenfield（无代码上下文）→ 提示；同意后生成骨架

显式参数授权（无阻塞提示，无头兼容）：`--init-context` 执行全量生成（约 15-30k tokens，仅首次，提示中如实告知）；`--init-skip` 记录 `ai_context_doc: none` 并静默后续提示。项目级字段（`ai_context_doc` / `last_intel_scan`）跨 change 保留；state-schema 校验（fail-closed，旧 state 缺省为 null）。

## 8. 执行遗漏防护

- **节点进入证据**：进入节点会被记录；未 entry 直接 exit——新 change BLOCKED（进入检查不可跳过：协调者禁令/委托前 commit 检查/签名记录），旧 change 渐进警告。
- **新 change 强制**：`init` 创建的 change 标记为"新"（`newChange`），内容级检查全面强制——已完成任务必须有对应 SUMMARY、交接结果必须有 TDD RED 证据、处置标记、builtin 自检证据、波次散文一致性、越权委托、追加位置；旧 change 保持渐进警告。
- **声明自动化**：旧 change 由 `record` 自动补写缺失的技能加载声明标记作兜底；新 change 必须先有本节点声明标记（技能加载前置门——无声明时委托请求与完成记录都会被拦截）。
- **显式空退出豁免**：execute 在显式声明（`emptyExitApproved`）后可在无串行任务时空退出；默认仍拦截。

## 设计原理

- **文件即真相，不做事件溯源**：单文件状态机 + 从 `.specs/` 推导节点——简单且恢复不依赖历史
- **结构级校验，不做语义判断**：guard 判"填没填"（段名/非空/结构），"填得好不好"交给 review——校验轻、误报少
- **检测+纠偏，不做拦截**：agent 环境无法真正阻止 LLM 直改文件，机器字段靠检测与自动写回
- **状态不入库**：`.comet/` 保持 gitignore——分支切换共享同一份工作树状态，避免状态分裂
- **不并行 change、不强制 PR**：一次一个 active change（状态机模型简单）；PR 审查按需开启

## 已知限制

- **平台**：Claude Code（默认）、Codex（技能/规则/hook 经多平台安装器）与 DeepSeek Harness（dsh——项目级技能 + 全局桥接 loader，经 `prepare-env --platform dsh`，见[安装](INSTALLATION-zh.md#方案-c--deepseek-harnessdsh-平台)）受支持；其他平台（Gemini/Cursor）不保证
- **Return Contract 过渡规则**：旧格式纯字符串 handoff 豁免为 WARN；redEvidence/greenEvidence 缺失渐进 WARN（不 BLOCK），避免旧 change 重入被卡死
- **与 Comet Classic 不互通**：workflow-kernel 状态独立于 classic（设计决策，非缺陷）
- **无活跃 change 时 hook 放行**：`.comet/flow-comet-state.json` 不存在时 hook guard 放行所有写入（设计决策：无 workflow 时不限制文件操作）
- **hook blocking 语义**：exit 2（blocking）在主会话 TUI 实测生效；`claude -p`（SDK CLI 模式）下非零退出降级为 non-blocking——写入被记录但不阻止
- **worktree 挂载依赖**：Agent `isolation: "worktree"` 的 worktree 挂在**会话项目根**（非子代理目标项目）——跨仓库产物需 `git show <branch>:<path>` 手动搬运，该场景下提交文件溯源校验（`git show` 子集检查）降级
- **GUIDANCE 不经创作清单记录**：`<skill>-GUIDANCE.md` 与 SKILL.md 引用行不登记创作清单，重跑 Skill 生成工具会清掉
