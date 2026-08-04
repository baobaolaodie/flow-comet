# 批次 C 执行规格：guard 自测 + 段名模板派生 + 任务签名哈希 + 委托前检查 + schema 校验

- **日期**: 2026-08-04
- **状态**: 待执行
- **依据**: 扬弃规格原则②③⑤⑦⑧ + dogfood 端到端验证发现（4 个 guard 逻辑 bug 全靠 dogfood 撞出、worktree 工件不可见、跨仓库 worktree 挂载、state 漂移）
- **权威源**: `.comet/bundle-drafts/flow-comet/`；三处同步到 bundles + 赛事系统安装副本 + e2e
- **执行顺序**: C-1（guard 4 改动）→ C-2（自测套件 + state/handoff）→ C-3（文档 + SKILL 评估）→ 收尾同步

---

## 〇、批次 C 目标

消灭 dogfood 暴露的 bug 类别（段名手抄漂移、guard 无自测、worktree 工件不可见、state 直改崩溃），补齐扬弃规格已设计未实现的欠账（TASK 哈希、PROGRESS WARNING、redEvidence 渐进校验、SKILL 结构治理）。

## 一、C1 · guard 自测套件（新文件，C-2 执行）

**文件**: `skills/flow-comet/scripts/guard-self-test.mjs`（与 workflow-guard.mjs 同级，新文件）

**结构**: 每个场景 = 独立临时目录（`fs.mkdtemp`）+ 伪造 `.comet/flow-comet-state.json`（currentNode + evidence 满足前置校验）+ `.specs/<change>/` 工件 → `execSync` 跑 `workflow-guard.mjs <entry|exit> <node>` → 断言退出码与输出关键词。场景跑完删除临时目录（不留残留）。

**场景清单**（覆盖已知全部 exit/entry 校验，按批次 C 最终逻辑写断言）：

| # | 场景 | 命令 | 期望 |
|---|------|------|------|
| 1 | open exit 通过（模板段名 CHANGE `## Why` + REQUIREMENT `## 用户故事` + 验收段） | exit open | exit 0 |
| 2 | open exit BLOCKED：CHANGE 缺 Why 段 | exit open | exit 1 + `BLOCKED` |
| 3 | open exit BLOCKED：REQUIREMENT 缺验收段 | exit open | exit 1 + `BLOCKED` |
| 4 | design exit 通过（`## 0.` + `## 1. 决策清单`） | exit design | exit 0 |
| 5 | design exit BLOCKED：缺决策清单 | exit design | exit 1 |
| 6 | plan exit 通过（task 块 + verify 字段） | exit plan | exit 0 |
| 7 | plan exit BLOCKED：无 task 块 | exit plan | exit 1 |
| 8 | execute exit 通过（SUMMARY 六段 + 6 维实质 + 自检方法 + handoff 齐 + TASK 全 done） | exit execute | exit 0 |
| 9 | execute exit BLOCKED：6 维自查仅 `### 🟢 R1` 标题无正文 | exit execute | exit 1 + `无实质内容` |
| 10 | execute exit BLOCKED：缺自检方法且全文无声明 | exit execute | exit 1 |
| 11 | execute exit 兼容：旧格式无自检方法但 6 维含 brooks-review → WARN | exit execute | exit 0 + `BROOKS-LINT WARN` |
| 12 | execute exit BLOCKED：TASK 签名哈希不匹配（enter 后改 action） | exit execute | exit 1 + `TASK 签名` |
| 13 | 越俎代庖：parallel done 无 handoffResult | exit execute | exit 1 |
| 14 | 串行 pending 未完成 | exit execute | exit 1 |
| 15 | subagent-execute exit 通过（parallel 全 done + handoff 齐） | exit subagent-execute | exit 0 |
| 16 | entry execute：未 commit 工件存在 → WARN | entry execute | exit 0 + WARN |
| 17 | entry execute：PROGRESS.md 存在 → WARN | entry execute | exit 0 + WARN |

**运行方式**: `node scripts/guard-self-test.mjs` → 全过 exit 0，输出 `ALL N SCENARIOS PASSED`；失败列出场景名 + 实际输出 + exit code，exit 1。

**约束**: 仅 node 内置模块（child_process/fs/os/path/crypto）；无网络；不依赖 flow-kit 模板目录存在（fallback 场景用内置段名）；临时目录清理。

## 二、C2 · 段名校验从模板自动派生（C-1 执行）

**文件**: `skills/flow-comet/scripts/workflow-guard.mjs`

**问题**: open/design exit 的段名校验是规格手抄硬编码（`## 变更目标` 与模板 `## Why（为什么做）` 脱节；`## 决策清单` 匹配不了模板 `## 1. 决策清单`；验收段漏 `## 验收准则（AC）`）。本次 dogfood 3 个 bug 属此类。

**改法**:
1. 新增 `templateSectionPatterns()`：读 `<runRoot>/flow-kit/templates/{CHANGE,REQUIREMENT,DESIGN}.md`，提取全部 `^##\s+(.+)$` 段名，正则化生成宽松匹配模式：
   - 去编号前缀（`1. ` → 可选 `\d+\.?\s*`）
   - 段名主体字面匹配，标题后缀容错（`## Why（为什么做）` 与 `## Why` 都接受）
   - 括号内容（如 `（AC）`）作为可选后缀
2. 模板目录/文件不存在时 **fallback 内置段名**（用当前已修正的正确值：CHANGE `## Why` 前缀、REQUIREMENT `## 用户故事`、DESIGN `## 决策清单` 编号可选、验收段 `验收准则|验收标准|AC`）——保证 flow-comet 仓库自身（无 flow-kit）与目标项目（有 flow-kit）行为一致。
3. 替换三处校验：
   - open exit CHANGE.md 段（现 `/^##\s*Why\b/im`）→ 用 CHANGE 模板派生模式
   - open exit REQUIREMENT 用户故事段（现 `/^##\s*用户故事/im`）→ 用 REQUIREMENT 模板派生模式
   - open exit 验收段（现 `/##\s*(验收准则|验收标准|AC|Acceptance Criteria)/i`）→ 用 REQUIREMENT 模板验收段派生模式
   - design exit 决策清单段（现 `/^##\s*\d*\.?\s*决策清单/m`）→ 用 DESIGN 模板派生模式
4. 模式生成后缓存（模块级变量，避免每次 exit 重复读文件）。

**约束**: 保持 BLOCKED 输出格式与现有错误文案（缺段名提示不变）；不改校验语义（仍是"结构+存在级"，只改段名基准来源）。

## 三、C3 · TASK.md 任务集签名哈希（C-1 执行）

**文件**: `skills/flow-comet/scripts/workflow-guard.mjs`

**问题**: execute/subagent-execute 中途修改 TASK.md（增删任务/改 action/改边界）不被检测（扬弃规格原则③ P1 欠账）。注意：全文 sha256 不可行——协调者执行中合法标记 `status="done"` 会变化。**用"任务集签名"**：提取所有 `<task ...>...</task>` 块，剥离 `status="..."` 属性后拼串，sha256。

**改法**:
1. 新增 `taskSetSignature(taskContent)`：`taskContent.match(/<task[\s\S]*?<\/task>/g)` → 每块 `.replace(/\s*status="[^"]*"/, '')` → 排序（防顺序漂移）→ 拼接 → `createHash('sha256')`。
2. enter execute / enter subagent-execute：若 TASK.md 存在 → 计算签名 → 写入 state 顶层字段 `taskHash`（guard 内实现 read-modify-write state JSON，与 workflow-state.mjs 字段结构一致，不破坏其他字段）。entry 校验已通过后执行。
3. exit execute / exit subagent-execute：重新计算签名 → 与 `state.taskHash` 比对 → 不一致 → `BLOCKED: TASK.md 任务集被修改（签名不匹配），execute 期间不允许增删任务/改 action/改边界`。
4. 无 taskHash（旧 state 重入）→ 跳过比对（向后兼容，不卡死旧 change）。
5. 任务标记 done 合法通过（status 已剥离）。

**约束**: 不引入新依赖；BLOCKED 风格；兼容旧 state（无 taskHash 跳过）。

## 四、C4 · 委托前工件 commit 检查（C-1 执行）

**文件**: `skills/flow-comet/scripts/workflow-guard.mjs`

**问题**: dogfood L-002——open/design/plan 工件未 commit 时 worktree 子代理看不到，靠 prompt 内联兜底。

**改法**: entry execute / entry subagent-execute 时：
1. 检查 `<runRoot>` 是否为 git 仓库（`git rev-parse --is-inside-work-tree` 失败 → 跳过）
2. `git status --porcelain -- .specs/<change>/` 输出非空 → `console.error('WORKTREE WARN: .specs/<change>/ 有未提交工件，worktree isolation 子代理将看不到它们——建议先 commit 或 prompt 内联上下文')`（WARN 不 BLOCKED）
3. 输出不含路径泄露（只提示目录级）。

## 五、C5 · 跨仓库 worktree 场景文档化（C-3 执行）

**文件**: `skills/flow-comet/reference/worktree-notes.md`（新文件，手写区文档，不动 kernel）

**内容**:
- Agent 工具 `isolation: "worktree"` 的 worktree 挂载在**会话项目根**（`git worktree list` 确认），不是子代理目标项目——跨仓库 dogfood/多仓库场景下 worktree 内容来自父项目，产物需手动搬运（`git show <branch>:<path>`）
- W2-D 提交文件子集校验（`git show <commitHash>`）在产物 commit 不属于当前仓库时失效（HANDOFF ERROR 但不阻断记录）——属预期降级
- 规避方式：① 委托 prompt 内联全部上游上下文（AC/设计/任务块全文）② 委托前 commit 上游工件（配合 C4 WARN）③ 单仓库场景不受影响
- 验证方法：`git worktree list` + `git ls-tree <branch> <path>`

## 六、C6 · writeState schema 校验（C-2 执行）

**文件**: `skills/flow-comet/scripts/workflow-state.mjs`

**问题**: LLM 直接改坏 state 文件导致脚本崩溃（原则⑤深化）。

**改法**: `writeState(state)` 写入前校验已知字段类型，非法 → `console.error('BLOCKED: state 字段类型非法: <field>')` + `process.exit(1)`（fail-closed 拒绝写入，不修复不猜测）：

| 字段 | 类型 | 附加 |
|------|------|------|
| activeChange | string 或 null | |
| currentNode | string 或 null | |
| completedNodes | array of string | |
| evidence | object | |
| verifyFailures | number | ≥0 |
| executionMode | 'subagent' \| 'direct' | |
| directOverride | boolean | |
| taskHash | string 或 undefined | 批次 C3 新增 |

未知字段允许（前向兼容）；缺字段允许（readState 默认补）；`taskHash` 等新字段 undefined 时跳过。

## 七、C7 · PROGRESS.md WARNING（C-1 执行）

**文件**: `skills/flow-comet/scripts/workflow-guard.mjs`

**改法**: entry execute 时若 `.specs/<change>/PROGRESS.md` 存在 → `console.error('WARNING: PROGRESS.md 存在（清窗恢复产物），先读"已排除方案"段（R1.6 反重复）')`（扬弃规格原则⑦ P2 欠账落地）。

## 八、C8 · Return Contract redEvidence 校验（C-2 执行）

**文件**: `skills/flow-comet/scripts/workflow-handoff.mjs` result 分支

**问题**: SKILL 文字约束"redEvidence/greenEvidence 缺任一 → orchestrator 拒绝记录"无脚本校验（扬弃规格 G-3 渐进策略）。

**改法**: result 分支解析 Return Contract 对象后：
- `greenEvidence` 缺失或 `greenEvidence.command` 非字符串 → `HANDOFF WARN: <task-id> 缺 greenEvidence（未执行 TDD GREEN？）`
- `redEvidence` 缺失或 `redEvidence.command` 非字符串 → `HANDOFF WARN: <task-id> 缺 redEvidence（未执行 TDD RED？）`
- 仍记录（渐进策略，不 BLOCK 不拒绝——避免卡死流程）；commitHash 非法格式维持现有 HANDOFF ERROR 行为不变。

## 九、C9 · SKILL Auto/Authored 分离评估（C-3 执行）

**依据**: 扬弃规格原则⑧（P2 欠账）。双区拼接导致 Entry Check / Output Schema / Recovery 在 SKILL.md 内重复（本次加载 open/design 等 skill 时肉眼可见）。

**执行**: 
1. 先读 `skills/flow-comet/reference/authoring-lanes.json` + `composition-report.md`，确认 bundle 创作流程对 SKILL.md 手写区/Auto 区的处理方式（哪些内容由 comet bundle compile 生成、手写区是否会被覆盖）
2. 若 bundle 流程"只生成 Auto 区、手写区保留"→ 实施分离：每个节点 SKILL.md 的手写区移到 `<node>-GUIDANCE.md`（新建），SKILL.md 手写区位置改为 `<!-- see <node>-GUIDANCE.md -->` 引用（保持 Auto 区不动）
3. 若 bundle 流程会整体重写 SKILL.md → **降级方案**：不移动手写区，只在 SKILL.md 顶部加一行 `<!-- 手写区详细协议见 <node>-GUIDANCE.md（可选阅读）-->` 并创建 GUIDANCE.md（内容 = 现有手写区副本），记为"引用式分离"
4. 两种方案都验证：`node --check` 无关（.md）；检查 skill 加载无语法破坏（frontmatter 完整性）

**风险**: 若无法确定 bundle 行为（comet CLI 不可在子代理环境运行），选降级方案并注明"待 bundle 编译后验证"。

---

## 三处同步（收尾执行）

改动后同步到：
- `.comet/bundles/flow-comet/skills/`（同级）
- 安装副本 `D:/LongYinHaHa/大学/大创/赛事系统/.claude/skills/`
- e2e `D:/LongYinHaHa/VSCode/flow-comet-e2e/.claude/skills/`

用 `diff --strip-trailing-cr` 校验一致。

## 验证场景（每子批次回传）

1. C-1：node --check + 每个改动的构造场景真实输出（open/design/plan exit 正反例、taskHash enter/exit、commit WARN、PROGRESS WARN）
2. C-2：guard-self-test.mjs 全量跑通（17 场景真实输出）+ writeState 非法字段拒绝 + handoff 缺 redEvidence WARN
3. C-3：worktree-notes.md 存在 + authoring-lanes 评估结论 + GUIDANCE 方案落地/降级说明

## 约束

1. 只改规格列出的文件，禁止扩大范围；禁止改 workflow-protocol.json 和 .comet/config.yaml
2. SKILL.md 只动手写区（上半部分），不碰 kernel Auto 区
3. 保持 BLOCKED / WARN / process.exit(1) 风格，不删功能
4. 验证用临时目录，不留残留
5. 向后兼容：旧 state/旧工件重入不卡死（taskHash 缺失跳过、模板缺失 fallback）

## 回传要求

1. 改动文件清单（路径 + 对应改动编号）
2. 每个验证场景真实命令 + 输出
3. 三处同步 diff 校验结果
4. 遗留问题 / 风险（含 C9 评估结论）
