# 执行质量规格 · 批次 A（P0）执行规格

- **日期**: 2026-08-04
- **状态**: 待执行
- **依据**: `docs/flow-comet-execution-quality-spec.md` 原则 A + C（部分）+ D（部分），用户 2026-08-04 确认"统一委托子代理"
- **权威源**: `.comet/bundle-drafts/flow-comet/`；三处同步到 bundles + 赛事系统安装副本

---

## 改动清单（只改下列文件，不扩大范围）

### 改动 A1 · hook guard 白名单收窄 execute + 注释更新

**文件**: `skills/flow-comet/scripts/comet-hook-guard.mjs`

**现状**（PHASE_WRITE_WHITELIST）:
```js
'execute':          [''],       // 串行实现：主代理合法写源码 + SUMMARY
'subagent-execute': ['.specs/'],// 协调者只写 .specs 工件；源码必须由 worktree 子代理写（子代理 cwd 无 .comet/state → hook 放行）
```

**改法**: execute 与 subagent-execute 统一（都委托子代理 → 协调者都只写 .specs）：
```js
'execute':          ['.specs/'],// 协调者只写 .specs 工件；源码由 worktree 子代理写（统一委托子代理）
'subagent-execute': ['.specs/'],// 协调者只写 .specs 工件；源码必须由 worktree 子代理写（子代理 cwd 无 .comet/state → hook 放行）
```
同步更新文件头第 17 行附近注释（'execute 串行实现需要写源码 + SUMMARY' → 改为两节点都是协调者）。

### 改动 A2 · workflow-state.mjs 协调者禁令扩展到 execute

**文件**: `skills/flow-comet/scripts/workflow-state.mjs`

**现状**:
```js
if (nodeId === 'subagent-execute') {
  console.log('COORDINATOR: 你是协调者，不是执行者。禁止在主会话直接修改源码；只能通过 Agent 工具 worktree isolation 委托子代理；子代理回传后仅更新 TASK.md / SUMMARY / handoff evidence。');
}
```

**改法**: 条件改为 `nodeId === 'execute' || nodeId === 'subagent-execute'`。同时 `status` 命令的 `coordinatorMode` 字段判断也改为 `['execute','subagent-execute'].includes(detectedNode)`。

### 改动 A3 · workflow-guard.mjs：entry 禁令扩展 + exit execute 校验扩展

**文件**: `skills/flow-comet/scripts/workflow-guard.mjs`

**3a. entry 协调者禁令扩展**:
**现状**: `if (node.id === 'subagent-execute') { console.log('COORDINATOR: ...'); }`
**改法**: `if (node.id === 'execute' || node.id === 'subagent-execute') { ... }`（同一禁令文本）

**3b. exit execute 校验扩展为"所有 done 任务需 handoff"**:
**现状**（P0-A 校验，约 2001-2043 行）:
```js
// 串行 pending → BLOCKED
const serialPending = tasks.filter(t => !t.parallel && t.status !== 'done');
if (serialPending.length > 0) { ... BLOCKED ... }

const executeEvidence = state.evidence['execute'];
const parallelTakeoverApproved = !!(executeEvidence && executeEvidence.parallelTakeoverApproved);

if (!parallelTakeoverApproved) {
  // parallel 被标记 done 但无 handoffResult → 越俎代庖
  const he = state.evidence['subagent-execute'];
  const results = he && he.handoffResult ? he.handoffResult : {};
  const unauthorized = tasks.filter(t => t.parallel && t.status === 'done' && !results[t.id]);
  if (unauthorized.length > 0) { ... BLOCKED ... }
}
```

**改法**: 统一委托后，**所有**被标记 done 的任务（无论串行/并行）都应有 handoff 记录（记录在 subagent-execute evidence，作为统一委托证据库）。改为：
```js
// 串行 pending → BLOCKED（execute 任务没做完）
const serialPending = tasks.filter(t => !t.parallel && t.status !== 'done');
if (serialPending.length > 0) { ... BLOCKED ... }

const executeEvidence = state.evidence['execute'];
const takeoverApproved = !!(executeEvidence && executeEvidence.parallelTakeoverApproved);

if (!takeoverApproved) {
  // 所有 done 任务无 handoffResult → 越俎代庖（统一委托后只能由子代理完成）
  const he = state.evidence['subagent-execute'];
  const results = he && he.handoffResult ? he.handoffResult : {};
  const unauthorized = tasks.filter(t => t.status === 'done' && !results[t.id]);
  if (unauthorized.length > 0) {
    console.error('BLOCKED: 任务被主代理直接标记 done（越俎代庖），统一委托下只能由子代理完成并记录 handoff: ' + unauthorized.map(t => t.id).join(', '));
    console.error('解决: 回退这些任务的 done 标记，重新委托子代理；或用 workflow-state.mjs record execute \'{"parallelTakeoverApproved":true}\' 显式豁免');
    process.exit(1);
  }
  // parallel 仍 pending → 合法（下一步 determineNode 路由到 subagent-execute）
}
```

### 改动 A4 · execute SKILL 统一委托协议

**文件**: `skills/flow-comet-execute/SKILL.md`

**现状**: "### 任务范围"段（只处理 parallel=false）+ "### Steps" 段 1-15（主代理逐任务执行 TDD/verify/SUMMARY）

**改法**:
1. **任务范围段**：补一句——"本节点不直接写实现代码。所有 pending 任务统一通过 Agent 工具委托 fresh-context 子代理执行（加载 flow-comet-dev + 回传 Return Contract）。"
2. **Steps 段改写**：主代理步骤改为协调者流程：
   ```
   ### Steps（协调者流程，统一委托子代理）
   对 TASK.md 每个 pending 串行任务，协调者执行：
   1. 读 task 块，构造 handoff request：`workflow-handoff.mjs request <task-id>`（含 task 全文 + DESIGN §0/§0.5 + AC + read/write_files）
   2. 用 Agent 工具（isolation: "worktree"）委托子代理；handoff prompt 要求：加载 flow-comet-dev、执行 TDD/verify/6 维自查/越界检查、写 `<task-id>-SUMMARY.md`、回传 Return Contract（含 selfReview）
   3. 子代理回传后，用 `workflow-handoff.mjs result <task-id> '<JSON>'` 记录（Return Contract 含 commitHash + greenEvidence + selfReview）
   4. 验收 SUMMARY（含 ## 自检方法），TASK.md 标 done
   5. 下一个 pending 任务
   ```
   （原 Steps 1-14 的 TDD/LESSONS/verify/6 维/越界/commit 协议**移入 handoff prompt 作为子代理的强制协议**，协调者不亲自执行）
3. **Return Contract 对非代码任务说明**：纯文档/纯配置任务子代理回传时，greenEvidence 允许 `{"command":"N/A (non-code task)","output":"..."}`（command 字段存在即可通过 W1-D 校验）

### 改动 A5 · subagent-execute SKILL 职责明确为并行委托

**文件**: `skills/flow-comet-subagent-execute/SKILL.md`

**现状**: "This node parallelizes execution by delegating independent tasks (marked `parallel="true"`...)" + Red flag "Only tasks explicitly marked parallel should be delegated"

**改法**:
1. 顶部职责段补一句职责分工："execute 节点负责**串行委托**（非 parallel 任务，一次一个），本节点负责**并行委托**（`parallel="true"` 任务，同 wave 多任务同时发）。两者共用同一委托证据库（handoff 记录在 subagent-execute evidence）。"
2. Red flag 保留（仍只委托 parallel 任务——这是与 execute 的职责边界），但措辞微调为"execute 的串行委托走 execute 节点，本节点只并行委托 parallel 任务"。

### 改动 A6 · workflow-handoff.mjs 注释补充（证据库语义）

**文件**: `skills/flow-comet/scripts/workflow-handoff.mjs`

**现状**: 头部注释 "Record subagent handoff evidence"，写死到 subagent-execute evidence

**改法**: 头部注释补一句："evidence 统一记录在 subagent-execute 名下作为**委托证据库**——execute（串行委托）与 subagent-execute（并行委托）共用。不改成节点参数，保持最小改动。" 代码逻辑不动。

### 改动 A7 · flow-comet-dev SKILL 同步 Return Contract selfReview 说明

**文件**: `skills/flow-comet-dev/SKILL.md`

**现状**: 第 19 行 "6 维自查：优先调用 /brooks-review..."

**改法**: 补一句——"回传 Return Contract 时 `selfReview` 字段必填：`brooks-review` 或 `builtin-quickcheck`；builtin 时 SUMMARY 需声明 `## 自检方法` 并注明 brooks-lint 不可用原因。"

### 改动 A8 · SUMMARY 必填段非空校验 + 自检方法字段强制（C1 + D1）

**文件**: `skills/flow-comet/scripts/workflow-guard.mjs`（W1-B 段，约 1981-2000 行）

**现状**:
```js
if (node.id === 'execute' || node.id === 'subagent-execute') {
  const changeDir = path.join(runRoot, '.specs', state.activeChange ?? '');
  const violations = await verifySummaries(changeDir);   // 只查三个段标题存在
  if (violations.length > 0) { ... BLOCKED ... }
  // brooks-lint 自检方法审计：只看文字
  ...
}
```

**改法**: 在 W1-B 内新增两段校验（所有 `*-SUMMARY.md`）：
```js
// C1: 6 维自查段非空——逐维有实质内容（每维标题后到下一维，非空白字符 ≥ 10）
//    越界检查段含实际 diff 记录（含 "diff" 或 "越界" 字样且非空）
const sixDim = content.match(/##\s*6\s*维自查[\s\S]*?(?=\n##|\n---|\Z)/i);
if (sixDim && sixDim[0].replace(/#{1,6}\s*R\d|##\s*6\s*维自查/g, '').trim().length < 10) {
  violations.push(f + ' 的 6 维自查段无实质内容');
}

// D1: 生产代码任务必填 ## 自检方法，声明 brooks-review 或 builtin-quickcheck
const method = content.match(/##\s*自检方法\s*\n\s*([a-z-]+)/i);
if (!method) {
  violations.push(f + ' 缺 ## 自检方法 字段（必须声明 brooks-review 或 builtin-quickcheck）');
} else if (/builtin/.test(method[1]) && !/brooks-lint 不可用|插件不可用|unavailable|N\/A/i.test(content)) {
  console.error('BROOKS-LINT WARN: ' + f + ' 使用 builtin-quickcheck 但未声明 brooks-lint 不可用原因');
}
```
（`violations.length > 0` → BLOCKED 已有逻辑覆盖）

---

## 三处同步

改动后同步到：
- `.comet/bundles/flow-comet/`（同级结构）
- 安装副本 `D:/LongYinHaHa/大学/大创/赛事系统/.claude/skills/flow-comet/`（及子 skill）

用 `diff -r` / sha256 校验一致。

## 验证场景

1. **A1（execute 白名单）**: currentNode=execute，协调者写源码 → BLOCKED；写 .specs → 放行；worktree（无 state）写源码 → 放行
2. **A2/A3a（禁令扩展）**: `next`/`entry execute` → 输出 COORDINATOR 行
3. **A3b（统一委托越俎代庖）**: exit execute 时串行任务 done 无 handoff → BLOCKED；有 handoff → PASS；parallel pending → PASS 路由 subagent-execute
4. **A8（C1 非空）**: SUMMARY 6 维自查只有标题 → BLOCKED
5. **A8（D1 自检方法）**: 缺 `## 自检方法` → BLOCKED；builtin 无原因 → WARN；builtin 有原因 → 通过
6. **回归**: `node --check` 三个 .mjs + 现有 fix-overreach 验证（subagent-execute 白名单/exit execute parallel 检测）不退化

## 约束

1. 只改上述 7 处，禁止扩大范围
2. 禁止改 workflow-protocol.json 和 .comet/config.yaml
3. SKILL.md 只动手写区（上半部分），不碰 kernel Auto 区
4. 验证场景在临时目录构造（不污染真实 .specs）
5. 保持原有 BLOCKED/process.exit(1)/WARN 风格

## 回传要求

1. 改动文件清单（路径 + 对应改动编号）
2. 每个验证场景真实命令 + 输出
3. 三处同步 diff/sha256 校验结果
4. 遗留问题 / 风险
