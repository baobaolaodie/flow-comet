# 执行质量规格 · 批次 B（P1）执行规格

- **日期**: 2026-08-04
- **状态**: 待执行
- **依据**: `docs/flow-comet-execution-quality-spec.md` 原则 B + C（部分）+ 用户 2026-08-04 确认的 executionMode 方案（对齐 Comet 的"显式选择 build_mode + 强制所选"，结合扬弃⑥ 人机分工）
- **权威源**: `.comet/bundle-drafts/flow-comet/`；三处同步到 bundles + 赛事系统安装副本
- **前序**: 批次 A（P0）已完成并 commit（8b6b2b9）——execute 统一委托子代理 + C1/D1 校验已生效

---

## 〇、批次 A 遗留确认

- A3（handoff 串行委托）已在批次 A 完成：execute SKILL 协调者流程已使用 `workflow-handoff.mjs request/result`，workflow-handoff 注释已补证据库语义。**不再重复做。**

---

## 一、executionMode：从"强制执行者"到"强制质量协议 + 可选执行者"

### 背景
批次 A 统一委托子代理 = 用"强制执行者=子代理"补"主代理执行时流程强制不足"的短板。Comet 证明**执行者不是质量关键，质量协议强制才是**——Comet 允许主代理执行（`executing-plans`），但强制加载该 skill + TDD，质量仍好。结合扬弃⑥（执行模式是用户决策点）与边界（不引入 Superpowers / 校验结构+存在级），引入 `executionMode`：

- **`subagent`**（默认）: 现状——协调者 + 统一委托 + 白名单 `.specs/` + 协调者禁令。质量兜底。
- **`direct`**（受控逃生口）: 主代理直接执行串行任务，但三重强制——用户显式确认 + 加载 flow-comet-dev 协议 + guard 内容校验兜底（C1/D1 已生效）。

### 改动 M1 · workflow-state.mjs 支持 executionMode

**文件**: `skills/flow-comet/scripts/workflow-state.mjs`

**现状**: init 无 executionMode 字段；无切换命令。

**改法**:
1. `init` 命令 state 增加 `executionMode: 'subagent'`、`directOverride: false`
2. `readState` 默认补 `executionMode: 'subagent'`、`directOverride: false`（兼容旧 state）
3. 新增命令 `execution-mode <subagent|direct>`：
   - `subagent` → `executionMode='subagent'`，`directOverride` 不变
   - `direct` → **必须用户显式调用**，设 `executionMode='direct'` + `directOverride=true`（对齐 Comet `direct_override`；逃生口不是默认）
   - 非法参数 → 报错 exit 1
4. `status` 输出 JSON 增加 `executionMode` + `directOverride`；`next` 的 `printNext` 在 COORDINATOR 行后追加 `EXECUTION-MODE: subagent|direct`

### 改动 M2 · hook-guard 白名单感知 executionMode

**文件**: `skills/flow-comet/scripts/comet-hook-guard.mjs`

**现状**: `PHASE_WRITE_WHITELIST` 静态表，execute/subagent-execute 都 `.specs/`。

**改法**: 白名单检查逻辑改为**读 state.executionMode 动态决定**：
```js
// 在读取 currentNode 后，同时读 executionMode
const stateFile = path.join(runRoot, '.comet', 'flow-comet-state.json');
let currentNode = null;
let executionMode = 'subagent';
try {
  const st = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  currentNode = st.currentNode;
  executionMode = st.executionMode ?? 'subagent';
} catch {}

// 白名单：direct 模式下 execute 允许写源码（主代理直接执行串行任务）
const executeWhitelist = executionMode === 'direct' ? [''] : ['.specs/'];
const PHASE_WRITE_WHITELIST = {
  ...
  'execute':          executeWhitelist,  // subagent: .specs/（协调者）；direct: 允许所有（主代理直写）
  'subagent-execute': ['.specs/'],       // 始终协调者（parallel 仍委托）
  ...
};
```
**边界**: direct 只放宽 execute；subagent-execute 始终 `.specs/`（parallel 任务必须委托，防 execute 吞 parallel 回归）。

### 改动 M3 · workflow-guard exit execute 感知 executionMode

**文件**: `skills/flow-comet/scripts/workflow-guard.mjs`

**现状**: P0-A 校验"所有 done 任务需 handoff"（统一委托下）。

**改法**: 读取 `state.executionMode` 分支：
```js
const executionMode = state.executionMode ?? 'subagent';
if (!takeoverApproved) {
  const he = state.evidence['subagent-execute'];
  const results = he && he.handoffResult ? he.handoffResult : {};
  let unauthorized;
  if (executionMode === 'direct') {
    // direct: 串行任务主代理直写（不需 handoff）；parallel 仍必须委托
    unauthorized = tasks.filter(t => t.parallel && t.status === 'done' && !results[t.id]);
  } else {
    // subagent（默认）: 所有 done 任务需 handoff
    unauthorized = tasks.filter(t => t.status === 'done' && !results[t.id]);
  }
  if (unauthorized.length > 0) { ... BLOCKED ... }
}
```

### 改动 M4 · execute SKILL 双模式

**文件**: `skills/flow-comet-execute/SKILL.md`

**现状**: "### 执行模型（统一委托子代理）"（批次 A 改写）。

**改法**: 执行模型段改为双模式，读 `workflow-state.mjs status` 的 executionMode：
```
### 执行模型（按 executionMode，用户显式选择）
- subagent（默认）: 统一委托子代理——协调者流程（构造 handoff → Agent worktree 委托 → 收集 Return Contract → 验收标 done）
- direct（逃生口，需用户显式切换）: 主代理直接执行串行任务——但必须加载 flow-comet-dev 完整协议
  （TDD/6 维自查/越界检查/原子 commit），SUMMARY 必填段 + ## 自检方法 强制（guard 校验兜底）
无论哪种模式：parallel="true" 任务始终由 subagent-execute 并行委托，不在此节点执行。
```

### 改动 M5 · flow-comet/SKILL.md 主入口

**文件**: `skills/flow-comet/SKILL.md`

**改法**:
1. "### 机器拥有字段"表加：
   | `executionMode` | subagent/direct，execute 执行模式 | workflow-state.mjs execution-mode |
   | `directOverride` | direct 是否用户显式确认 | workflow-state.mjs execution-mode direct |
2. "决策分类与决策点"清单加一条（用户决策）:
   - 切换 executionMode 到 direct（execute 节点内暂停，需用户确认，记录 directOverride）

### 改动 M6 · B1 七节点必填段清单内联（模板强制）

**文件**: 7 个节点 SKILL（open/design/plan/execute/subagent-execute/review/verify）

**现状**: SKILL 只"引用" flow-kit 模板，必填段靠自觉。

**改法**: 每个节点 SKILL 的 Guidance 顶部新增"### 必填段清单"表：

| 节点 | 文件 | 必填段清单 |
|------|------|-----------|
| open | flow-comet-open | CHANGE.md: `## 变更目标`/`## 变更范围`/`## 影响面`/`## 风险`；REQUIREMENT.md: `## 用户故事`/`## 验收标准`/`## 范围切分` |
| design | flow-comet-design | DESIGN.md: `## 0. 技术栈选定`/`## 0.5 架构对齐`/`## 决策清单`/`## 风险` |
| plan | flow-comet-plan | TASK.md: 每个 `<task>` 含 `name/read_files/write_files/action/verify/done` 7 字段 |
| execute | flow-comet-execute | SUMMARY.md: `## 做了什么`/`## 改动文件`/`## verify 输出`/`## 6 维自查`/`## 越界检查`/`## 自检方法` |
| subagent-execute | flow-comet-subagent-execute | 同 execute |
| review | flow-comet-review | REVIEW.md: `## Critical`/`## 发现`/`## 结论` |
| verify | flow-comet-verify | TEST.md: `## 测试矩阵`/`## 验证命令`；UAT.md: `## 验收结果` |

> 每表加一句："**缺失任一必填段 = 节点未完成**，exit guard 校验（见 workflow-guard.mjs NODE_TRANSITION_GATES / W1-B）。"

### 改动 M7 · C2 CHANGE/REQUIREMENT/DESIGN 出口校验

**文件**: `skills/flow-comet/scripts/workflow-guard.mjs`

**现状**: NODE_TRANSITION_GATES 只查文件存在；open exit 查 REQUIREMENT 含 `## 验收标准`；design 查含 §0。

**改法**: 在 exit 的对应节点分支补段存在校验（结构+存在级，不做语义）：
```js
// open exit: CHANGE.md 含 ## 变更目标；REQUIREMENT.md 含 ## 用户故事
if (node.id === 'open' && state.activeChange) {
  const changeDir = path.join(runRoot, '.specs', state.activeChange);
  for (const [file, section] of [['CHANGE.md', '## 变更目标'], ['REQUIREMENT.md', '## 用户故事']]) {
    const p = path.join(changeDir, file);
    if (await fileExists(p)) {
      const text = await fs.readFile(p, 'utf8');
      if (!text.includes(section)) {
        console.error('BLOCKED: ' + file + ' 缺必填段 ' + section);
        process.exit(1);
      }
    }
  }
}
// design exit: DESIGN.md 含 ## 决策清单
if (node.id === 'design' && state.activeChange) {
  ... 检查 DESIGN.md 含 '## 决策清单' ...
}
```

---

## 三处同步

改动后同步到：
- `.comet/bundles/flow-comet/skills/`（同级）
- 安装副本 `D:/LongYinHaHa/大学/大创/赛事系统/.claude/skills/`

用 `diff --strip-trailing-cr` 校验一致（注意 bundles 路径含 `skills/` 层）。

## 验证场景

1. **M1**: `execution-mode direct` → state 变 `executionMode:'direct'` + `directOverride:true`；`status` 输出字段
2. **M2**: direct 模式下 execute 写源码 → 放行；subagent 模式下 execute 写源码 → BLOCKED；subagent-execute 无论模式写源码 → BLOCKED
3. **M3**: direct + 串行 done 无 handoff → PASS（不需 handoff）；direct + parallel done 无 handoff → BLOCKED；subagent + 串行 done 无 handoff → BLOCKED
4. **M6**: 7 个节点 SKILL 含必填段清单表 → 文本检查
5. **M7**: open exit 缺 `## 变更目标` → BLOCKED；design exit 缺 `## 决策清单` → BLOCKED
6. **回归**: `node --check` 三个 .mjs + 批次 A 场景不退化（execute/subagent-execute 白名单、exit execute 越俎代庖检测）

## 约束

1. 只改规格列出的文件，禁止扩大范围；禁止改 workflow-protocol.json 和 .comet/config.yaml
2. SKILL.md 只动手写区（上半部分），不碰 kernel Auto 区
3. executionMode 默认 subagent（direct 是逃生口，需用户显式切换，不做默认）
4. 验证场景在临时目录构造，不留测试残留
5. 保持 BLOCKED/process.exit(1)/WARN 风格

## 回传要求

1. 改动文件清单（路径 + 对应改动编号）
2. 每个验证场景真实命令 + 输出
3. 三处同步校验结果（diff --strip-trailing-cr）
4. 遗留问题 / 风险
