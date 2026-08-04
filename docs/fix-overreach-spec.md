# flow-comet 越俎代庖修复规格

- **日期**: 2026-08-04
- **状态**: 待执行
- **定位**: 修复 flow-comet 中"主对话越俎代庖"问题——subagent-execute 阶段主代理直接写源码、execute 端点吞掉 parallel 任务。
- **背景**: 用户报告 flow-comet 在路由到 subagent-execute 时主代理不委托子代理而直接实现。经分析（sublation-spec ④ 失败封闭+白名单欠账 + 三层对比 Comet），根因有三：
  1. hook guard 白名单 `subagent-execute: ['']` 与 execute 无差别放行源码写入
  2. `next`/`entry` 输出无"协调者禁令"，约束只在 SKILL.md 一次性注入
  3. **execute 端点结构性矛盾**：`exit execute` 的 all-tasks-done 校验要求所有任务 done（含 parallel），而 execute SKILL 要求"跳过 parallel 任务"、determineNode 要求"parallel pending → subagent-execute"——三者矛盾，结构上逼着主代理在 execute 阶段串行标记 parallel 任务（越俎代庖）

---

## 改动清单（只改下列文件，不扩大范围）

### 改动 1 · hook guard 白名单收窄 subagent-execute（物理拦截）

**文件**: `.comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/comet-hook-guard.mjs`

**现状**（约第 17-25 行）:
```js
// '' 空字符串表示允许所有路径（execute / subagent-execute 需要写源码 + SUMMARY）
// '.specs/' 前缀表示只允许 .specs 目录下的文件
// 其他路径前缀精确匹配
const PHASE_WRITE_WHITELIST = {
  ...
  'execute':          [''],  // 允许所有（源码 + SUMMARY）
  'subagent-execute': [''],  // 允许所有
};
```

**改法**: `subagent-execute` 白名单改为 `['.specs/']`，并更新注释说明依赖：
```js
'execute':          [''],       // 串行实现：主代理合法写源码 + SUMMARY
'subagent-execute': ['.specs/'],// 协调者只写 .specs 工件；源码必须由 worktree 子代理写（子代理 cwd 无 .comet/state → hook 放行）
```

**副作用确认（必须验证）**:
- 协调者（主会话 cwd=项目根）在 subagent-execute 阶段写源码 → hook 读到 `.comet/flow-comet-state.json` 的 currentNode=subagent-execute → BLOCKED ✓
- worktree isolation 子代理 cwd=worktree 根 → 无 `.comet/flow-comet-state.json`（.gitignore 排除）→ currentNode=null → 放行 ✓
- 共享 cwd 子代理会被同一白名单误拦 → 因此 SKILL 必须强制 worktree isolation（改动 4）

### 改动 2 · workflow-state.mjs 协调者禁令输出

**文件**: `.comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/workflow-state.mjs`

**现状**: `printNext`（约第 132-140 行）只输出 `NEXT/NODE/SKILL` 三行。

**改法**: `printNext` 中当 `nodeId === 'subagent-execute'` 时追加一行协调者禁令：
```
COORDINATOR: 你是协调者，不是执行者。禁止在主会话直接修改源码；只能通过 Agent 工具 worktree isolation 委托子代理；子代理回传后仅更新 TASK.md / SUMMARY / handoff evidence。
```
同时 `status` 命令的 JSON 输出（约第 170-177 行）增加 `coordinatorMode: true` 字段（当 detectedNode 为 subagent-execute 时）。

### 改动 3 · workflow-guard.mjs：entry 禁令 + exit execute 修复

**文件**: `.comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/workflow-guard.mjs`

**3a. entry subagent-execute 输出禁令**: 在 entry 分支对 subagent-execute 输出与改动 2 相同的协调者禁令。

**3b. exit execute all-tasks-done 修复**（现约第 2001-2015 行）: 当前逻辑要求所有任务 done（含 parallel），与"execute 跳过 parallel"矛盾。改为区分串行/并行，并检测越俎代庖：

```js
// 解析 TASK.md 全部 task 的 {id, status, parallel}
const taskBlocks = taskContent.match(/<task[^>]*>[\s\S]*?<\/task>/g) || [];
const tasks = taskBlocks.map(block => ({
  id: (block.match(/id="([^"]+)"/) || [])[1] || null,
  status: (block.match(/status="([^"]+)"/) || [])[1] || null,
  parallel: /parallel="true"/.test(block),
})).filter(t => t.id);

// 串行 pending → BLOCKED（execute 任务没做完）
const serialPending = tasks.filter(t => !t.parallel && t.status !== 'done');
if (serialPending.length > 0) {
  console.error('BLOCKED: execute 出口仍有串行 pending 任务: ' + serialPending.map(t => t.id).join(', '));
  process.exit(1);
}

// parallel 被标记 done 但无 handoffResult → 越俎代庖（应由 subagent-execute 委托）→ BLOCKED
const he = state.evidence['subagent-execute'];
const results = he && he.handoffResult ? he.handoffResult : {};
const unauthorized = tasks.filter(t => t.parallel && t.status === 'done' && !results[t.id]);
if (unauthorized.length > 0) {
  console.error('BLOCKED: parallel 任务被串行标记 done（越俎代庖），只能由 subagent-execute 委托完成: ' + unauthorized.map(t => t.id).join(', '));
  console.error('解决: 回退这些任务的 done 标记，exit 后路由到 subagent-execute 委托；或用 workflow-state.mjs record execute \'{"parallelTakeoverApproved":true}\' 显式豁免');
  process.exit(1);
}
// parallel 仍 pending → 合法（下一步 determineNode 路由到 subagent-execute）
```

同时：**豁免机制**——在 `node.id === 'execute'` 的校验前，若 `evidence`（当前节点 evidence）含 `parallelTakeoverApproved: true`，则跳过 parallel-done 检测（只保留串行 pending 检测）。注意读取 `state.evidence['execute']?.parallelTakeoverApproved`。

### 改动 4 · flow-comet-subagent-execute/SKILL.md

**文件**: `.comet/bundle-drafts/flow-comet/skills/flow-comet-subagent-execute/SKILL.md`

**改法**:
1. 在 Guidance 开头（现有 "### Prerequisites" 之前）新增「协调者禁令」段：
   > **协调者禁令（最高优先级）**：主会话是协调者，不是执行者。禁止在主会话直接修改源码或执行实现。源码只能通过 `Agent` 工具以 `isolation: "worktree"` 委托子代理完成。子代理派发失败时，主会话**不得接管实现**——记录当前任务为 BLOCKED 并走 Recovery。协调者只允许更新：TASK.md（标记 done）、`<task>-SUMMARY.md`、handoff evidence（workflow-handoff.mjs result）。
2. 将步骤 3 中 worktree isolation 从"Each subagent: Use the Agent tool with `isolation: "worktree"`"明确为**强制**（因 hook 白名单依赖）：所有并行子代理必须 worktree isolation，禁止共享 cwd 直接委托。
3. Prerequisites 中 "The orchestrating agent must have the Agent tool" 保留。

### 改动 5 · flow-comet-execute/SKILL.md

**文件**: `.comet/bundle-drafts/flow-comet/skills/flow-comet-execute/SKILL.md`

**改法**: 在 "### Red flags" 段新增一条：
> - **Agent thought**: "这个 parallel 任务小，我顺手在主会话做了。" **Actual risk**: 违反并行委托设计——subagent-execute 节点被静默跳过，丢失并行隔离与 write_files 冲突防护；且 execute 出口的 all-tasks-done 校验会 BLOCKED（parallel 无 handoffResult）。parallel="true" 任务只能由 subagent-execute 委托。

### 改动 6 · flow-comet/SKILL.md 主入口

**文件**: `.comet/bundle-drafts/flow-comet/skills/flow-comet/SKILL.md`

**改法**:
1. "### Red Flags" 段新增：
   > | "subagent-execute 阶段，我直接改源码更快" | 协调者禁令：subagent-execute 阶段主会话禁止写源码（hook 白名单只允许 .specs/），必须 worktree 委托子代理 |
2. "### Scripts" 表中 `comet-hook-guard.mjs` 描述更新为"文件写入边界守卫（phase 白名单：subagent-execute 阶段只允许 .specs/）"。

### 改动 7 · 三处同步 + 验证

**同步**: bundle-drafts 改动后，同步到：
- `.comet/bundles/flow-comet/skills/flow-comet/`（及子 skill）
- 安装副本 `/d/LongYinHaHa/大学/大创/赛事系统/.claude/skills/flow-comet/`

用 `diff -r` 校验三处一致。

**验证**:
1. `node --check` 所有改动的 .mjs 脚本
2. 构造验证场景（在 flow-comet-e2e 仓库或临时目录）：
   - **场景 A（hook 拦截协调者）**: 伪造 `.comet/flow-comet-state.json` currentNode=subagent-execute，写项目根下源码文件 → 期望 hook 输出 BLOCKED exit 2
   - **场景 B（hook 放行 worktree）**: 同上但在一个无 state 文件的 worktree/临时目录写源码 → 期望放行
   - **场景 C（exit execute 越俎代庖）**: TASK.md 含 parallel done 无 handoff → 期望 BLOCKED
   - **场景 D（exit execute 串行 pending）**: TASK.md 含串行 pending → 期望 BLOCKED
   - **场景 E（exit execute 合法）**: 串行全 done + parallel pending → 期望 PASS 并路由 subagent-execute
   - **场景 F（next 禁令输出）**: `node workflow-state.mjs next` 在 subagent-execute 状态 → 期望输出 COORDINATOR 行
3. 记录每个场景的真实输出到回传

---

## 约束

1. **只改上述 7 处**，禁止扩大范围
2. **禁止修改** `workflow-protocol.json`（避免 hash 失效）和 `.comet/config.yaml`
3. 脚本改动保持原有错误处理风格（BLOCKED + process.exit(1) / WARN 不退出）
4. 不删除现有功能，保持向后兼容（旧 change 重入不卡死）
5. 改 SKILL.md 只动手写区（上半部分），不碰下半部分 kernel 生成的 Auto 区

## 回传要求

1. 改动文件清单（路径 + 对应改动编号）
2. 每个验证场景的真实命令 + 输出（证明行为符合预期）
3. 三处同步的 diff 校验结果
4. 遗留问题 / 风险（如有）
