# flow-comet 改进规格（基于 comet + flow-kit 深度对比）

- **日期**: 2026-08-03
- **状态**: 待评审
- **定位**: 子代理修改 flow-comet 的可执行规格。每条改动含「文件 / 现状 / 改法 / 验收」。
- **扬弃原则**: 吸收 comet 的硬约束机制（状态机转移表 / 机器私有字段 / guard 深度校验 / hash 溯源 / 恢复协议 / Return Contract）；保留 flow-kit 的文档驱动哲学（`.specs/` 产物 / 9 阶段 / R1-R8 / SUMMARY 模板 / AC 派生测试）；拒绝引入与 `.specs/` 冲突的外部生态（OpenSpec 双星 / Superpowers prompts / native Runtime 完全托管）。

---

## 一、背景：为什么改

flow-comet 首次在真实项目全流程验证（schedule-preview-first）时，暴露了运行时脚本的深度不足：
1. `workflow-guard.mjs` 的 exit 路由与 `workflow-state.mjs` 的 determineNode 路由不一致（parallel 任务依赖感知缺失），已修，但**根因是状态机没有"转移前置条件"概念**。
2. guard 只查"文件存在性"，不校验 SUMMARY 内容质量、不真实跑命令——子代理产出空 SUMMARY 也能通过。
3. subagent-execute 没有 Return Contract——子代理自由发挥，质量靠 orchestrator prompt 运气。
4. 无 dirty-worktree 归属、无 verify 失败计数、无 hash 溯源——长会话/压缩后恢复靠 agent 自觉。

对照 comet 完整原理（状态机事件表 / 机器私有字段 / guard 三层 / hash 溯源 / 恢复协议 / 决策点四分类 / Return Contract），flow-comet 缺的是"硬约束层"。本规格补齐这一层，同时守住 flow-kit 哲学。

---

## 二、改动范围总览

| 波次 | 改动项 | 涉及文件 | 优先级 |
|------|--------|---------|--------|
| W1 | A. 状态机转移表 | workflow-guard.mjs | P0 |
| W1 | B. SUMMARY 关键段校验 | workflow-guard.mjs | P0 |
| W1 | C. verify 真实跑命令（严格版） | workflow-guard.mjs | P0 |
| W1 | D. 子代理 Return Contract | flow-comet-subagent-execute/SKILL.md + workflow-handoff.mjs + workflow-guard.mjs | P0 |
| W2 | A. verifyFailures 计数 | workflow-state.mjs + workflow-guard.mjs + flow-comet/SKILL.md | P1 |
| W2 | B. dirty-worktree 归属 | 新增 reference/dirty-worktree.md + flow-comet/SKILL.md | P1 |
| W2 | C. 决策点协议细化 | flow-comet/SKILL.md | P1 |
| W2 | D. handoff hash 完整版 | workflow-handoff.mjs + workflow-guard.mjs | P1 |
| W3 | A. 归档交付闭环 | flow-comet-archive/SKILL.md | P2 |
| W3 | B. 横向命令 A-evolve + M-health | 新增 flow-comet-evolve + flow-comet-health skill | P2 |

> 执行建议：W1 是核心（本期必做），W2 增强，W3 扩展。每波次完成后验证再进下一波次。全部波次完成后做三处同步 + 重新 eval + publish + compile/distribute（见十三节）。

---

## 三、W1-A · 状态机转移表（P0）

### 文件
`scripts/workflow-guard.mjs`（flow-comet skill 根下）

### 现状
`exit --apply` 只做：校验 evidence + artifacts + required-skill，然后 `completed.add(node.id)` + 写 history。**无"当前节点必须是 from"的转移前置约束**——理论上可从 execute 直接 exit archive（guard 不会拦）。

### 改法
新增一张节点转移门表，`exit` 时先校验"当前节点 == 被 exit 的节点"（comet 的 `from` 前置条件）：

```js
// 节点 → 合法 exit 的前置条件（对齐 flow-kit 阶段门 + flowkit.*.v1 evidence）
const NODE_TRANSITION_GATES = {
  open:             { evidence: ['intake-summary'],           artifacts: ['<change-id>/CHANGE.md', '<change-id>/REQUIREMENT.md'] },
  design:           { evidence: ['design-summary'],           artifacts: ['<change-id>/DESIGN.md'] },
  plan:             { evidence: ['plan-summary'],             artifacts: ['<change-id>/TASK.md'] },
  execute:          { evidence: ['implementation-summary'],   artifacts: ['<change-id>/*-SUMMARY.md'] },
  'subagent-execute':{ evidence: ['handoff-result'],          artifacts: ['<change-id>/*-SUMMARY.md'] },
  review:           { evidence: ['review-summary'],           artifacts: ['<change-id>/REVIEW.md'] },
  verify:           { evidence: ['verification-result'],      artifacts: ['<change-id>/TEST.md', '<change-id>/UAT.md'] },
  archive:          { evidence: ['archive-summary'],          artifacts: ['<change-id>/archive/*'] },
};
```

在 `exit` 分支开头（evidence 校验之前）加入：

```js
// W1-A: 转移前置约束——currentNode 必须等于被 exit 的节点（防跳阶段）
if (state.currentNode !== node.id) {
  console.error('BLOCKED: currentNode is ' + String(state.currentNode) + ', cannot exit ' + node.id + '.');
  process.exit(1);
}
// W1-A: 每个节点合法 exit 必须满足前置 evidence（对应 flowkit.*.v1 的 evidence）
const gate = NODE_TRANSITION_GATES[node.id];
if (gate) {
  for (const ev of gate.evidence) {
    if (!hasEvidenceField(evidence, ev)) {
      console.error('BLOCKED: node ' + node.id + ' exit requires evidence: ' + ev);
      process.exit(1);
    }
  }
}
```

### 验收
```bash
# 场景：伪造 state.currentNode=execute，尝试 exit archive → 应 BLOCKED
# 场景：正常 exit open（CHANGE.md + REQUIREMENT.md + intake-summary 齐全）→ 应 PASS
```

---

## 四、W1-B · SUMMARY 关键段校验（P0）

### 文件
`scripts/workflow-guard.mjs`

### 现状
`exit execute / subagent-execute` 只查 `*-SUMMARY.md` 文件存在（`missingRequiredArtifacts` 用 glob）。子代理产出空文件也能过。

### 改法
在 `exit` 的 execute / subagent-execute 分支，遍历 `.specs/<change>/` 下的 `*-SUMMARY.md`，校验每份含 flow-kit SUMMARY 模板的**三个必填段**：

```js
const SUMMARY_REQUIRED_SECTIONS = ['## verify 输出', '## 6 维自查', '## 越界检查'];

async function verifySummaries(changeDir, nodeId) {
  const dir = path.join(changeDir, '..'); // .specs/<change-id>/
  const files = (await fs.readdir(dir).catch(() => [])).filter(f => f.endsWith('-SUMMARY.md'));
  const violations = [];
  for (const f of files) {
    const content = await fs.readFile(path.join(dir, f), 'utf8');
    for (const section of SUMMARY_REQUIRED_SECTIONS) {
      if (!content.includes(section)) violations.push(`${f} 缺 ${section}`);
    }
  }
  return violations;
}
```

在 `exit` 分支，`if (node.id === 'execute' || node.id === 'subagent-execute')` 时调用，`violations.length > 0` → BLOCKED 并列出。

### 验收
```bash
# 场景：建一个空 -SUMMARY.md 的假任务 → exit execute 应 BLOCKED 并列出缺的段
# 场景：正常 SUMMARY（含三段）→ PASS
```

---

## 五、W1-C · verify 真实跑命令（P0 · 严格版）

### 文件
`scripts/workflow-guard.mjs`

### 现状
`exit verify` 只查 TEST.md / UAT.md 存在（`missingRequiredArtifacts`）。不真实跑验证命令。

### 改法（严格版 · 用户已确认）
在 `exit verify` 分支，读取项目验证命令并**真实执行**。命令来源（按优先级）：
1. `.specs/<change>/TEST.md` 中 `## 验证命令` 段（新建 TEST.md 必须含此段——**严格版对未来新 change 强制**）
2. `.comet/flow-comet-state.json` 的 `verifyCommand` 字段（若已记录）
3. 项目探测回退：`pingpong-tournament/pyproject.toml` → `pytest tests/ -q`；`frontend/package.json` → `npm test`（探测逻辑在 guard.mjs 实现，探测不到则 BLOCKED 并提示"TEST.md 需声明验证命令"）

实现：

```js
// W1-C: verify exit 必须真实跑命令（严格版）
// 过渡规则：历史归档 change 不受影响（不回读 archive/）；当前活跃 change 无命令段 → BLOCKED 提示补声明
const { execSync } = await import('child_process');
let verifyCommand = null;
// 1) TEST.md 的 ## 验证命令 段
const testDoc = path.join(runRoot, '.specs', state.activeChange, 'TEST.md');
if (await fileExists(testDoc)) {
  const text = await fs.readFile(testDoc, 'utf8');
  const m = text.match(/##\s*验证命令\s*\n\s*```[^\n]*\n([\s\S]*?)```/);
  if (m) verifyCommand = m[1].trim().split('\n')[0];
}
// 2) state 的 verifyCommand
if (!verifyCommand && state.verifyCommand) verifyCommand = state.verifyCommand;
// 3) 项目探测回退
if (!verifyCommand) {
  if (await fileExists(path.join(runRoot, 'pingpong-tournament', 'pyproject.toml'))) verifyCommand = 'cd pingpong-tournament && python -m pytest tests/ -q';
  else if (await fileExists(path.join(runRoot, 'frontend', 'package.json'))) verifyCommand = 'cd frontend && npm test';
}
if (!verifyCommand) {
  console.error('BLOCKED: TEST.md 需声明 ## 验证命令 段（严格版要求）');
  process.exit(1);
}
try {
  execSync(verifyCommand, { cwd: runRoot, stdio: 'pipe', timeout: 300000 });
} catch (e) {
  console.error('BLOCKED: verify 命令失败: ' + verifyCommand + '\n' + String(e.stdout || e.message).slice(0, 500));
  process.exit(1);
}
```

> 注：`execSync` 用 `await import('child_process')` 动态导入；`fileExists` 复用 guard.mjs 已有辅助。命令从 TEST.md 首行代码块取（`## 验证命令` 段内首个代码块首行）。超时 5 分钟防挂死。失败输出截断 500 字符提示。

### 验收
```bash
# 场景：TEST.md 含一个必然失败的命令 → exit verify 应 BLOCKED 并显示命令失败
# 场景：TEST.md 无命令段 + 无 state.verifyCommand + 无项目探测 → BLOCKED 提示需声明
# 场景：TEST.md 声明通过的命令 → PASS（真实执行成功）
```

---

## 六、W1-D · 子代理 Return Contract（P0）

### 文件
1. `flow-comet-subagent-execute/SKILL.md`
2. `scripts/workflow-handoff.mjs`
3. `scripts/workflow-guard.mjs`

### 现状
- SKILL.md 只要求子代理"写 SUMMARY.md"，无结构化回传契约。
- `workflow-handoff.mjs result` 只存 `{result, completedAt}`，无 commit hash / changed files / RED/GREEN 证据 / risk 信号。
- guard exit subagent-execute 只查 evidence 存在（`handoff-result`），不校验内容。

### 改法

**1) SKILL.md**：新增"Return Contract（子代理必须回传）"一节，强制子代理返回结构化 JSON：

```text
## Return Contract（子代理必须回传）

每个被委托的子代理，完成时必须在最终回复中回传以下结构化信息（缺任一项，orchestrator 不得记录 handoff result）：

```json
{
  "status": "DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT",
  "taskId": "T0X",
  "commitHash": "<git commit sha>",
  "changedFiles": ["<file>", "..."],
  "redEvidence": { "command": "<RED 失败测试命令>", "output": "<真实失败输出片段>" },
  "greenEvidence": { "command": "<GREEN 通过测试命令>", "output": "<真实通过输出片段>" },
  "riskSignals": ["cross-module | security | concurrency | migration | public-api | 200+lines | none"],
  "concerns": "<可选：未解决的疑虑>"
}
```

- `status=DONE` 才视为完成；`BLOCKED` / `NEEDS_CONTEXT` 需 orchestrator 处理。
- `redEvidence` / `greenEvidence` 缺任一 → 视为未执行 TDD，orchestrator 拒绝记录。
- `riskSignals` 非 `none` 时，orchestrator 应将该任务标记为 review 节点的高优先级审查对象。
```

**2) workflow-handoff.mjs**：`result` 命令扩展为接受 JSON 参数：

```bash
node workflow-handoff.mjs result <task-id> '<JSON>'
```

解析 JSON，若含 `commitHash` / `redEvidence` / `greenEvidence` 则存储（否则存原始字符串）：

```js
if (action === 'result') {
  const taskId = process.argv[3];
  const raw = process.argv.slice(4).join(' ');
  let parsed = raw;
  try { const j = JSON.parse(raw); parsed = j; } catch {}
  state.evidence['subagent-execute'].handoffResult = state.evidence['subagent-execute'].handoffResult || {};
  state.evidence['subagent-execute'].handoffResult[taskId] = {
    result: parsed, completedAt: new Date().toISOString()
  };
  await writeState(state);
  console.log('HANDOFF RESULT: ' + taskId);
  return;
}
```

**3) workflow-guard.mjs**：`exit subagent-execute` 时校验每个 delegated task 的 handoffResult：

```js
// W1-D: Return Contract 校验——每个 delegated task 的 result 必须含 commitHash + greenEvidence
if (node.id === 'subagent-execute') {
  const he = state.evidence['subagent-execute'];
  const results = he && he.handoffResult ? he.handoffResult : {};
  const violations = [];
  for (const [taskId, rec] of Object.entries(results)) {
    const r = typeof rec.result === 'object' ? rec.result : {};
    if (!r.commitHash) violations.push(`${taskId} 缺 commitHash`);
    if (!r.greenEvidence || !r.greenEvidence.command) violations.push(`${taskId} 缺 greenEvidence`);
  }
  if (violations.length > 0) {
    console.error('BLOCKED: Return Contract 校验失败: ' + violations.join('; '));
    process.exit(1);
  }
}
```

### 验收
```bash
# 场景：handoffResult 缺 commitHash → exit subagent-execute 应 BLOCKED
# 场景：handoffResult 含完整契约 → PASS
```

---

## 七、W2-A · verifyFailures 计数（P1）

### 文件
1. `scripts/workflow-state.mjs`
2. `scripts/workflow-guard.mjs`
3. `flow-comet/SKILL.md`

### 现状
`flow-comet-state.json` 无 verifyFailures 字段；UAT 失败重试靠 SKILL.md 文字（"≤3 轮"），无机器计数。

### 改法

**1) workflow-state.mjs**：
- `init` 时初始化 `verifyFailures: 0`
- `readState` 默认补 `verifyFailures: 0`（兼容旧状态文件）

**2) workflow-guard.mjs**：
- `exit verify --apply` 成功 → `verifyFailures = 0`
- 新增 `record verify-fail` 子命令（或 `workflow-state.mjs record verify-fail`）：`verifyFailures += 1`；`>= 3` 时打印"verify 失败超限，需用户决策"，此后退出码 1（BLOCKED）

**3) SKILL.md**（verify 节点）：
- 明确：verify 失败自动重试 ≤ 3 次（机器计数 verifyFailures）；第 4 次失败必须暂停问用户"继续修 / 停止"。

### 验收
```bash
# 场景：连续 3 次 verify-fail → 第 4 次 BLOCKED 要求用户决策
# 场景：verify-pass → verifyFailures 清零
```

---

## 八、W2-B · dirty-worktree 归属协议（P1）

### 文件
1. `reference/dirty-worktree.md`（新增）
2. `flow-comet/SKILL.md`（引用）

### 现状
无 dirty-worktree 处理。执行中若工作区有用户未提交改动，agent 可能覆盖或误当自己改动。

### 改法
新增 `reference/dirty-worktree.md`，内容对齐 comet `dirty-worktree.md`：

```markdown
# dirty-worktree 归属协议

## 触发
进入 execute / verify 节点前，运行：
git status --short
git diff --stat
git diff --cached --stat
git ls-files --others --exclude-standard

## 归属三分类
1. 属于当前 change → 吸收进当前任务，不重做
2. 不属于当前 change → 暂停问用户（并入 / 拆新 change / 不动 / 授权丢弃）
3. 来源不清 → 暂停报告，不推进阶段

## 构建产物排除
`??` 匹配 .gitignore（node_modules/dist/__pycache__ 等）自动跳过归属。

## 禁令
- 脏工作树只算代码证据，不自动推进 phase / 勾选 tasks
- 未弄清来源前禁止覆盖 / 还原 / 格式化 / 忽略用户改动
- 脏 diff 未解释禁止标记 verify 通过
```

SKILL.md 的 execute/verify 节点 Guidance 加一句"进入前读 `reference/dirty-worktree.md` 做归属检查"。

### 验收
```bash
# 文档存在 + SKILL.md 引用存在
# 场景：工作区有无关改动 → execute 入口提示做归属
```

---

## 九、W2-C · 决策点协议细化（P1）

### 文件
`flow-comet/SKILL.md`

### 现状
SKILL.md 有"决策分类与决策点"表，但粒度粗（"两个以上互斥且合法的范围解释→合并为一个问题"），缺四分类和防重问规则。

### 改法
把现有决策表扩展为四分类（对齐 comet decision-point.md）：

```markdown
## 决策分类与决策点

先分类再行动：

| 分类 | 定义 | 处理 |
|------|------|------|
| 用户决策 | ≥2 个会改变范围/行为/风险/不可逆结果的合法选项 | 用 AskUserQuestion 问（优先）或文本回退；相邻选择合并为一个问题，不重问已持久化选择 |
| 自动处理 | 唯一安全下一步 | 直接执行并汇报，不许制造确认 |
| 停止条件 | guard 失败 / 缺依赖 / 状态损坏 | 报告阻塞与恢复条件，无合法动作时才升级为用户决策 |
| 手动交接 | `NEXT: manual`（若有） | 不是用户决策，直接继续 |
```

保留现有决策点列表（架构检测 / 技术栈选型 / 破坏性变更 / schema 迁移 / REVIEW Critical / UAT 超限 / 归档），改为挂到四分类下。

### 验收
```bash
# SKILL.md 含四分类表
# 文本检查：AskUserQuestion 优先 + 不重问已持久化选择
```

---

## 十、W2-D · handoff hash 溯源（P1 · 完整版）

### 文件
1. `scripts/workflow-handoff.mjs`
2. `scripts/workflow-guard.mjs`

### 现状
无 hash 溯源。子代理回传的 commitHash 与 write_files 无对应校验。

### 改法（完整版 · 用户已确认）
- `request` 命令扩展：记录该 task 的 `writeFiles` 列表（从 TASK.md 的 `<write_files>` 解析，传给 `request` 命令）。
- `result` 校验：子代理回传 commitHash 后，用 `git show <commitHash> --name-only` 取提交文件列表，校验其**是 writeFiles 允许范围的子集**：

```js
// W2-D: 完整版 hash 校验——提交文件 ⊆ writeFiles 允许范围
if (action === 'result' && typeof parsed === 'object' && parsed.commitHash) {
  const commitHash = parsed.commitHash;
  // 用 git show 取提交文件列表
  const { execSync } = await import('child_process');
  try {
    const out = execSync(`git show ${commitHash} --name-only --format=`, { cwd: runRoot, encoding: 'utf8' });
    const committedFiles = out.split('\n').map(s => s.trim()).filter(Boolean);
    // writeFiles 来自该 task 的 request 记录（含 glob，本期做前缀匹配）
    const allowed = state.evidence['subagent-execute'].handoffRequests[taskId]?.writeFiles || [];
    const violations = committedFiles.filter(f => !allowed.some(a => f.startsWith(a.replace('*', ''))));
    if (violations.length > 0) {
      console.error('HANDOFF WARN: 提交文件超出 writeFiles 范围: ' + violations.join(', '));
      // 本期 warn 不阻断（commitHash 有效即可），越界留给 review 节点；如需硬阻断改 exit code 1
    }
  } catch {
    console.error('HANDOFF ERROR: commitHash 无效或 git show 失败: ' + commitHash);
  }
}
```

> **校验语义（用户确认）**：提交文件是 writeFiles 允许范围的**子集**，不是"严格等于"——writeFiles 里未实际改动的文件不算违规。允许范围用 `startsWith` 前缀匹配（含 glob 简单展开：`*` 前缀匹配）。

### 验收
```bash
# 场景：commitHash 有效 + 提交文件 ⊆ writeFiles → 无 WARN
# 场景：commitHash 有效 + 提交文件越界 → HANDOFF WARN 列出越界文件
# 场景：commitHash 无效（git show 失败）→ HANDOFF ERROR
```

---

## 十一、W3-A · 归档交付闭环（P2）

### 文件
`flow-comet-archive/SKILL.md`

### 现状
归档只做：移动文件到 `.specs/archive/<date>-<id>/` + 更新 CHANGELOG。无 commit / 远程交付协议。

### 改法
SKILL.md 的 Archive 节点补充：

```markdown
### 归档提交（R4.1 对齐 comet archive 交付闭环）

1. 用显式路径 stage：只 stage 本 change 可归属路径（原活动路径、实际归档路径、改过的主 spec）
2. `git diff --cached --stat` 检查后，单一 commit：`chore: archive <change-id>`
3. 按用户确认的交付方式 push / 建 PR（如用 git 流水线）
4. 归档操作（移动文件）必须用户确认后才执行（不可逆）
```

### 验收
```bash
# SKILL.md 含归档 commit 协议
# 场景：归档后 git 有单一 archive commit（手动验证）
```

---

## 十二、W3-B · 横向命令 A-evolve + M-health（P2）

### 文件
1. `flow-comet-evolve/SKILL.md`（新增）
2. `flow-comet-health/SKILL.md`（新增）

### 现状
flow-comet 无横向命令。flow-kit 有 I-intel-scan / A-architect / A-evolve / M-health / L-restyle。

### 改法（用户已确认：A-evolve + M-health 都要）
**1) 新增 `flow-comet-evolve/SKILL.md`**，对齐 flow-kit `A-evolve.md`：

```markdown
---
name: flow-comet-evolve
description: "Use only when explicitly invoked as /flow-comet-evolve; scan archived changes' DESIGN.md section 9, batch-review sediment candidates, patch CONTEXT.md. Not part of the 8-node flow."
---

# flow-comet-evolve（横向命令 · 架构沉淀）

## 触发
用户说「同步架构 / 整理沉淀 / evolve / 同步 CONTEXT」；或 STATE.md last_evolve_at > 60 天。

## 流程
1. 扫 `STATE.md` last_evolve_at 之后归档的 change
2. 只读每个 change 的 DESIGN.md § 9（禁止越界读 § 9 以外）
3. 聚合候选 → 贴给用户 review
4. 用户批准的才 patch `.specs/CONTEXT.md`（术语 / 已锁决策 / 抽象索引）
5. 更新 STATE.md last_evolve_at

## 边界
- 不写业务代码
- 不在本工作流改架构（需 A-architect 时提示用户）
- CONTEXT.md 更新统一走本命令或 I-intel-scan，不在 change 内直接改
```

**2) 新增 `flow-comet-health/SKILL.md`**，对齐 flow-kit `M-health.md` + `prompts/I-intel-scan.md` 的核心（代码库巡检）：

```markdown
---
name: flow-comet-health
description: "Use only when explicitly invoked as /flow-comet-health; periodic codebase health check: CONTEXT consistency, LESSONS scanning, tech-debt review, redundancy scan. Not part of the 8-node flow."
---

# flow-comet-health（横向命令 · 巡检）

## 触发
用户说「健康检查 / health / 体检 / 技术债扫描 / 巡检」。

## 前置依赖
- 装了 brooks-lint → 优先 `/brooks-health`（4 维综合体检）
- 未装 brooks-lint → 用内置巡检清单降级

## 流程
1. 读 `.specs/CONTEXT.md` + `.specs/LESSONS.md` + 最近 1 份 `.specs/health/*.md`（对比基线）
2. 抽样 5 个最近改动频繁的 src/ 模块 + 5 个测试文件 + 最近 30 天 git log
3. 检查：
   - CONTEXT 与代码一致性（既有抽象索引是否过期）
   - LESSONS 是否需新增 / superseded
   - 技术债项（Pain × Spread 优先级）
   - 冗余（死代码 / 重复实现）——提示走 jscpd / knip / vulture 工具级扫描
4. 产出 `.specs/health/<date>.md` 报告 + 更新 CONTEXT 技术债段

## 边界
- 只读 + 报告，不自动改业务代码
- 发现的冗余/债项排入 backlog，不在本命令内修
```

### 验收
```bash
# flow-comet-evolve/SKILL.md + flow-comet-health/SKILL.md 存在
# 文本检查：A-evolve 只读 DESIGN § 9 + 用户 review 后 patch + 不写业务代码
# 文本检查：M-health 优先 brooks-lint + 未装降级 + 只读报告不自动改码
```

---

## 十三、同步与验证（所有波次通用）

### 同步位置（三处必须一致）
| 位置 | 路径 | 角色 |
|------|------|------|
| 安装副本 | `赛事系统/.claude/skills/flow-comet/`（及其子 skill） | 当前项目运行时 |
| bundle-drafts | `flow-comet/.comet/bundle-drafts/flow-comet/skills/flow-comet/` | 权威源 |
| bundles | `flow-comet/.comet/bundles/flow-comet/skills/flow-comet/` | 编译产物 |

每处改动后，用 `diff` 校验三处一致：
```bash
diff -r 赛事系统/.claude/skills/flow-comet/scripts flow-comet/.comet/bundle-drafts/flow-comet/skills/flow-comet/scripts
```

### bundle hash 影响（重要 · 用户已确认重新 compile/distribute）

- **本期会改脚本 + skill 文档** → bundle currentHash 变 → 旧 eval 证据失效。
- 全部波次完成后，按序执行：
  1. 三处同步（安装副本 + bundle-drafts + bundles），diff 校验一致
  2. **重新 eval**：`comet eval .comet/bundle-drafts/flow-comet/skills/flow-comet/comet/eval.yaml --quick`（指向 bundle-drafts 内的 eval.yaml，占位符才能解析 + findRepositoryEvalContext 匹配）
  3. **publish**：`comet publish review <name>` → `comet publish approve <name> --reviewer <reviewer>` → `comet publish run <name> --platform claude`
  4. **compile + distribute**：`comet bundle compile <name> --platform claude` → `comet publish distribute <name> --platform claude --scope project`
- **不做**：本期不改 `workflow-protocol.json` 结构（避免额外 hash 失效）。若子代理实现中发现必须改 protocol，停下来报告，不自行改。
- `comet/eval.yaml` 若被改动 → evalManifestHash 变 → 需重新 eval（上面第 2 步已覆盖）。

### 回归验证（每波次后）
1. 语法检查：`node --check scripts/workflow-state.mjs` / `workflow-guard.mjs` / `workflow-handoff.mjs`
2. 现有功能回归：在 `赛事系统` 跑一遍 `node .claude/skills/flow-comet/scripts/workflow-state.mjs status` + `next`，确认路由正常
3. 新功能验收：按各改动项的验收场景实测

---

## 十四、给子代理的执行指令（主会话派发时用）

> 这段会复制进子代理 prompt，作为执行约束。

```
你是 flow-comet 改进执行者。按 `docs/flow-comet-improvement-spec.md` 规格执行指定波次。

约束：
1. 严格按规格的「文件 / 改法 / 验收」逐条改，不扩大范围
2. 只改规格列出的文件，禁止触碰 workflow-protocol.json（除非规格明确要求）
3. 每波次改完跑语法检查 + 验收场景，真实输出
4. 三处同步（安装副本 + bundle-drafts + bundles），diff 校验一致
5. 不引入 OpenSpec / Superpowers / native Runtime 依赖（扬弃边界）
6. 保留 flow-kit 哲学：`.specs/` 产物、R1-R8、SUMMARY 模板结构
7. 回传：改了哪些文件 / 每个改动对应规格哪条 / 验收输出 / 遗留问题
```

---

## 十五、已确认项（用户 2026-08-03 决策 + 扬弃校验结论）

> 用户给出 4 条个人意见，并授权以扬弃原则为校准基准。经校验，4 条全部符合扬弃原则，采纳；每条补一条实施约束（基于 comet/flow-kit 细节），确保不跑偏。

| # | 用户决策 | 扬弃校验 | 补充实施约束 |
|---|---------|---------|-------------|
| 1 | **严格**：每个 verify 必须声明命令 | ✅ 吸收 comet"guard 真实跑命令 + build/verify 证据不可互替" | **过渡规则**：严格版只对**未来新 change** 强制（新建 TEST.md 必须含 `## 验证命令` 段）；历史已归档 change 不受影响（不回溯改旧 TEST.md）。当前活跃 change 若 TEST.md 无命令段，允许补声明后继续 |
| 2 | **都要**：A-evolve + M-health | ✅ 横向命令是 flow-kit 哲学本身的组成部分（非 comet 外部生态），补全即"保留 flow-kit 完整体系" | **依赖确认**：M-health 用 brooks-lint（项目已装，属复用非引入）。若目标项目未装 brooks-lint，M-health 降级为内置巡检清单 |
| 3 | **完整版**：handoff hash 做 diff 对比 | ✅ 吸收 comet handoff_hash 溯源 | **校验语义明确**：`git show <commitHash> --name-only` 的提交文件 ⊆ 该任务 `write_files` 允许范围（含测试文件 / SUMMARY 等已在 write_files 内的文件），是"子集"不是"严格等于"——write_files 里未实际改动的文件不算违规 |
| 4 | **是**：改完重新 compile/distribute | ✅ bundle 生命周期是 comet workflow-kernel 机制，让改动生效到安装副本是必要的 | **硬性前置**：W1/W2/W3 改了脚本+skill 后 bundle hash 会变 → 旧 eval 证据失效 → distribute 前必须重新 `comet eval`（指向 bundle-drafts 内的 eval.yaml）+ `publish review/approve/run`，否则 bundle 状态从 ready 退回 draft |

**本期改动范围（采纳后）**：
- W1（P0）：A 状态机转移表 / B SUMMARY 关键段校验 / C verify 真实跑命令（严格版+过渡）/ D 子代理 Return Contract
- W2（P1）：A verifyFailures 计数 / B dirty-worktree 归属 / C 决策点四分类 / D handoff hash 完整版
- W3（P2）：A 归档交付闭环 / B 横向命令 A-evolve + M-health
- 收尾：三处同步 + 重新 eval + publish review/approve/run + compile/distribute

---

> 本规格是"扬弃"的落地：吸收 comet 硬约束，保留 flow-kit 哲学。子代理只执行规格，不自行设计。
