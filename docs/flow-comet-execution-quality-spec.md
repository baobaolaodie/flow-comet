# flow-comet 执行质量改进规格：子代理化 + 模板强制 + 内容级校验

- **日期**: 2026-08-04
- **状态**: 待评审
- **定位**: 架构级改进规格，解决"真实执行产出质量低于模拟测试"的落差。确立四条原则，再映射到具体改动。
- **前身**: `docs/flow-comet-sublation-spec.md`（七原则扬弃，本规格是其"执行质量"维度的补全）
- **触发证据**: 2026-08-03 模拟测试（subagent 按 flow-kit 模板走，产出高质量）vs 真实执行（主代理依赖脚本路由，产出工件缩水 + 跳过 brooks-lint 不被发现）

---

## 一、背景：模拟 vs 真实的执行引擎差异

| | 昨天模拟 | 今天真实 |
|---|---|---|
| 执行者 | **子代理**，按 flow-kit 模板逐阶段走（读全套 0-change~7-integration） | **主代理**，依赖脚本 `next` 路由 + 主代理记忆 |
| 质量来源 | 模板是**强制输入**，逐段填 | 模板是**参考**，填多少靠自觉 |
| 脚本 bug 影响 | 几乎不暴露（子代理不依赖脚本路由） | 全暴露（路由错，执行者跟着错） |
| 结果 | 饱满、模板齐全 | 结构齐全但内容缩水 + 过程纪律丢失 |

**结论**: flow-comet 的扬弃只自动化了"结构"（路由/guard/hook/hash），没自动化"内容"（模板填写纪律与执行引擎）。本规格把这两块补上，全部在扬弃边界内。

---

## 二、扬弃框架：四条新原则

| 原则 | 吸收什么 | 形式 | 边界（不做什么） |
|------|---------|------|-----------------|
| A · 执行引擎子代理化 | Comet subagent-driven：主代理协调者、fresh-context 子代理执行 | SKILL 执行模型 + handoff | 不引入 Superpowers；worktree 非强制（可共享 cwd 委托） |
| B · 模板强制输入 | flow-kit 模板即质量清单 | 节点 SKILL 内联必填段骨架 | 不复制 flow-kit 全套文档，只内联"必填字段清单" |
| C · guard 内容级校验 | Comet collectClassicEvidence 的"非空"检查 | guard 脚本（结构+存在级） | **不做语义判断**（"填得好不好"留 review）；只判"填没填" |
| D · brooks-lint 调用可验证 | Comet evidence 结构化回传 | Return Contract `selfReview` 字段 + guard | 不强制真实运行 brooks（成本高）；校验"声明 + 原因" |

---

## 三、原则 A · 执行引擎子代理化

### Comet 对照
Comet build 阶段用 subagent-driven-development：每个 task 一个 fresh implementer，主会话只做协调者。

### flow-comet 现状
- execute 节点 = **主代理串行执行**（SKILL 说"execute 遍历 TASK.md 逐任务执行"）
- subagent-execute 节点 = **仅 parallel 任务**委托子代理
- 主代理既做协调又写代码，两条线挤占 → 纪律丢失（跳过 brooks、工件缩水）

### 扬弃决策: **execute 统一委托子代理（用户 2026-08-04 确认）**

主代理不再直接写实现代码。**所有 execute 任务统一通过 `Agent` 工具委托 fresh-context 子代理**，子代理加载 `flow-comet-dev` + 回传 Return Contract（含 selfReview）。execute 与 subagent-execute 都成为"协调者节点"，区别只在**委托方式**：execute 串行委托（一次一个，按 wave 顺序），subagent-execute 并行委托（同 wave 多任务同时）。主代理只保留：TASK.md 状态维护、SUMMARY/evidence 收集、验收。

**吸收**：
- 主代理职责收敛为协调者：派发 → 收集 → 验收（TASK.md 标 done / SUMMARY 归档 / handoff 记录）
- 消除"复杂/简单"判定——避免执行者把任务归为"简单"快跑、退回原状（质量兜底优先于执行成本）

**改动 A1 · execute SKILL 执行模型改写**：
- 文件: `flow-comet-execute/SKILL.md`
- 现状: 步骤 1-14"For each pending task... execute the following sequence"（主代理逐任务执行）
- 改法: 步骤开头改为统一委托协议：
  ```
  ### 执行模型（统一委托子代理）
  本节点不直接写实现代码。每个 pending task 用 Agent 工具（fresh context）委托子代理，
  子代理加载 flow-comet-dev + 回传 Return Contract（含 selfReview）。协调者只做：
  1) 读取 task 块，构造 handoff request（含 task 全文 + DESIGN §0/§0.5 + AC + read/write_files）
  2) 委托子代理（worktree isolation，见改动 A4 的 hook 白名单依赖）
  3) 收集 Return Contract + SUMMARY，验收后 TASK.md 标 done
  4) 记录 handoff evidence
  ```
- 保留 TDD/verify/SUMMARY 步骤作为**子代理的强制协议**（不变，移入手 handoff prompt）

**改动 A2 · subagent-execute 职责明确为"并行委托"**：
- 文件: `flow-comet-subagent-execute/SKILL.md`
- 现状: "只委托 `parallel="true"` 任务"（Red flag: "Only tasks explicitly marked parallel should be delegated"）
- 改法: 明确职责分工——execute 负责**串行委托**（非 parallel 任务），subagent-execute 负责**并行委托**（`parallel="true"` 任务，同 wave 多任务同时发）。协调者禁令保留并扩展到两个节点。

**改动 A3 · handoff request 支持 execute 串行委托**：
- 文件: `workflow-handoff.mjs` + `flow-comet-execute/SKILL.md`
- 现状: handoff 仅 subagent-execute 节点使用，按 parallel 任务注册
- 改法: handoff request 不限定 parallel；execute 节点委托时同样注册 handoff + 记录 Return Contract

**改动 A4 · execute hook 白名单收窄 + 协调者禁令扩展**：
- 文件: `comet-hook-guard.mjs` + `workflow-state.mjs` + `workflow-guard.mjs`
- 现状: `execute: ['']`（允许所有）；协调者禁令仅 subagent-execute
- 改法:
  - `execute` 白名单 `['']` → `['.specs/']`（execute 统一委托后，主代理不再写源码）
  - `printNext`/`entry` 的协调者禁令扩展到 `execute` 和 `subagent-execute` 两节点
- **依赖**: 子代理必须 worktree isolation（cwd 无 state → hook 放行）；共享 cwd 子代理会被白名单误拦（与 subagent-execute 现状一致）

### 扬弃边界（不做）
- ❌ 不引入 Superpowers `subagent-driven-development`（flow-comet 用自有 handoff 机制）
- ❌ 不强制 worktree isolation 之外的额外隔离（worktree isolation 是 hook 白名单收窄的硬依赖，必须保留）

---

## 四、原则 B · 模板强制输入

### Comet 对照
Comet 通过 guard 校验 proposal/design/tasks 存在且非空、语言匹配。

### flow-comet 现状
- SKILL 只"引用" flow-kit 模板（"见 `flow-kit/templates/SUMMARY.md`"、"用 `flow-kit/prompts/4-dev.md`"）
- 执行者填多少靠自觉 → 工件缩水

### 扬弃决策: **节点 SKILL 内联必填段骨架（必填字段清单）**

**吸收**：
- 每个节点 SKILL 的 Guidance 顶部新增"必填段清单"（markdown 表格：段名 / 必填理由 / 缺失后果）
- 必填段声明为"缺失即节点未完成"（与 guard 联动，见原则 C）

**改动 B1 · 节点 SKILL 内联必填段清单**：

| 节点 | SKILL 文件 | 必填段清单 |
|------|-----------|-----------|
| open | flow-comet-open | CHANGE.md: `## 变更目标（WHY）`/`## 变更范围`/`## 影响面`/`## 风险`；REQUIREMENT.md: `## 用户故事`/`## 验收标准`（AC）/`## 范围切分` |
| design | flow-comet-design | DESIGN.md: `## 0. 技术栈选定`/`## 0.5 架构对齐`/`## 决策清单`/`## 风险` |
| plan | flow-comet-plan | TASK.md: 每个 `<task>` 含 `name/read_files/write_files/action/verify/done` 7 字段 |
| execute | flow-comet-execute | SUMMARY.md: `## 做了什么`/`## 改动文件`/`## verify 输出`/`## 6 维自查`/`## 越界检查`/`## 自检方法` |
| subagent-execute | flow-comet-subagent-execute | 同 execute（子代理回传的 SUMMARY 同要求） |
| review | flow-comet-review | REVIEW.md: `## Critical`/`## 发现`/`## 结论` |
| verify | flow-comet-verify | TEST.md: `## 测试矩阵`/`## 验证命令`；UAT.md: `## 验收结果` |

### 扬弃边界（不做）
- ❌ 不复制 flow-kit 全套模板到 flow-comet（SKILL 仍指向 flow-kit 文档，只是内联"必填清单"）

---

## 五、原则 C · guard 内容级校验（结构+存在，不做语义）

### Comet 对照
Comet 校验"非空 + 结构"。flow-comet 现状只查"文件存在 + 含某段"。

### 扬弃决策: **从"文件存在"升到"必填段非空"**

**吸收**：guard exit 校验必填段**存在且非空**（正则匹配段标题 + 段内实质内容长度阈值），不做语义判断。

**改动 C1 · SUMMARY 必填段非空校验**：
- 文件: `workflow-guard.mjs`（W1-B 校验扩展）
- 现状: 只查 `SUMMARY_REQUIRED_SECTIONS` 三个段标题存在
- 改法: 每段加"非空"检查——段标题后到下一段标题前，非空白字符数 ≥ N（如 6 维自查每维 ≥ 1 行实质内容，越界检查含 `write_files` 与实际 diff 对比）

**改动 C2 · CHANGE/REQUIREMENT/DESIGN 出口校验**：
- 文件: `workflow-guard.mjs`（NODE_TRANSITION_GATES 扩展）
- 现状: open exit 查 REQUIREMENT 含 `## 验收标准`；design 查含 §0
- 改法: open exit 补 CHANGE 含 `## 变更目标`；REQUIREMENT 补 `## 用户故事`；design 补 `## 决策清单`

### 扬弃边界（不做）
- ❌ 不做内容语义判断（"6 维自查写得对不对"留 review）
- ❌ 不校验"AC 与实现是否一致"（review 阶段职责）

---

## 六、原则 D · brooks-lint 调用可验证

### 问题（调查确认）
- brooks-lint 插件正常（全局 1.3.0），SKILL 要求"优先 /brooks-review"
- guard 检查是**文字级 WARN**（6 维自查段含 "brooks-review" 字样即通过）
- 昨天模拟：SUMMARY 写了 brooks-review 字样 → 文字通过 → "显示没问题"
- 昨天真实（T04）：跳过 /brooks-review 用内置快查 → guard 无法区分 → 缺陷未被发现
- 根因: guard 无法验证"是否真实调用特定 skill"（agent 行为，hook 难拦截）

### 扬弃决策: **把"是否用 brooks-lint"结构化，guard 校验声明 + 原因**

**改动 D1 · SUMMARY `## 自检方法` 字段强制**：
- 文件: `workflow-guard.mjs`（W1-B 内扩展）
- 改法:
  ```js
  // 生产代码任务必填 ## 自检方法，声明 brooks-review 或 builtin-quickcheck
  const method = content.match(/##\s*自检方法\s*\n\s*([a-z-]+)/i);
  if (!method) {
    console.error('BLOCKED: ' + f + ' 缺 ## 自检方法 字段（生产代码任务必须声明 brooks-review 或 builtin-quickcheck）');
    process.exit(1);
  }
  if (/builtin/.test(method[1]) && !/brooks-lint 不可用|插件不可用|unavailable/i.test(content)) {
    console.error('BROOKS-LINT WARN: ' + f + ' 使用 builtin-quickcheck 但未声明 brooks-lint 不可用原因');
  }
  ```

**改动 D2 · SKILL 明确字段**：
- 文件: `flow-comet-dev/SKILL.md` + `flow-comet-execute/SKILL.md`
- 现状: execute:55 已要求 `## 自检方法` 字段（declare brooks-review or builtin-quickcheck）
- 改法: flow-comet-dev 同步补"必填 `## 自检方法`"；补充"worktree 子代理若无法加载全局 brooks-lint → 声明 builtin + 原因，或由协调者汇总阶段补跑 /brooks-review"

### 扬弃边界（不做）
- ❌ 不强制真实运行 brooks-lint（每次 exit 跑一次成本高，且子代理环境不可控）
- ❌ 不做"brooks 输出质量"判断（留 review）

---

## 七、从原则到改动映射

| 原则 | 改动项 | 涉及文件 | 优先级 |
|------|--------|---------|--------|
| A | execute 统一委托子代理 | flow-comet-execute/SKILL.md | P0 |
| A | subagent-execute 职责明确为并行委托 | flow-comet-subagent-execute/SKILL.md | P0 |
| A | handoff 支持 execute 串行委托 | workflow-handoff.mjs + SKILL | P1 |
| A | execute hook 白名单收窄 + 协调者禁令扩展到 execute | comet-hook-guard + workflow-state + workflow-guard | P0 |
| B | 7 节点 SKILL 内联必填段清单 | 7 个节点 SKILL.md | P1 |
| C | SUMMARY 必填段非空校验 | workflow-guard.mjs | P0 |
| C | CHANGE/REQUIREMENT/DESIGN 出口补校验 | workflow-guard.mjs | P1 |
| D | `## 自检方法` 字段强制 + builtin 原因校验 | workflow-guard.mjs | P0 |
| D | dev/execute SKILL 同步自检方法要求 | flow-comet-dev/execute SKILL | P1 |
| — | 全部完成后三处同步 + node --check + 验证场景 | — | — |

---

## 八、执行策略

**批次 A（P0，先做）**：
- execute SKILL 执行模型（统一委托子代理）
- subagent-execute 职责明确为并行委托
- execute hook 白名单收窄 + 协调者禁令扩展到 execute
- SUMMARY 必填段非空校验（含 6 维每维 ≥ 1 行）
- `## 自检方法` 字段强制（D1）

**批次 B（P1，批次 A 后）**：
- handoff 串行委托
- 7 节点必填段清单内联
- CHANGE/REQUIREMENT/DESIGN 出口校验

**每批次后**: 三处同步（drafts/bundles/安装副本）+ `node --check` + 验证场景 + 现有功能回归。

---

## 九、验证场景

1. **A（execute 统一委托）**: execute 节点所有任务调用 Agent 委托，SUMMARY 有 Return Contract（含 selfReview）→ 通过
2. **A（execute 白名单）**: execute 阶段主代理写源码 → BLOCKED（白名单只允许 .specs/）；worktree 子代理写源码 → 放行
3. **C（SUMMARY 非空）**: 6 维自查只有标题无内容 → BLOCKED
4. **D（自检方法缺失）**: 生产代码 SUMMARY 缺 `## 自检方法` → BLOCKED
5. **D（builtin 无原因）**: 声明 builtin-quickcheck 但无"插件不可用"说明 → WARN
6. **D（builtin 有原因）**: 声明 builtin + "brooks-lint 不可用" → 通过
7. **B（必填段清单）**: 每个节点 SKILL 含必填段清单表 → 文本检查通过

---

## 十、与 sublation-spec 的关系

本规格是 sublation-spec 的**执行质量补全**：
- 原则 A 扩展扬弃⑥（人机分工）——从"决策分工"到"执行分工"
- 原则 C 扩展扬弃②（证据驱动）——从"文件存在"到"段非空"
- 原则 D 是扬弃② 在 brooks-lint 上的具体落地
- 不推翻 sublation-spec 已锁决策（不引入 Superpowers / 不做语义校验）
