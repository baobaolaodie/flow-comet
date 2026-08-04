# 批次 D 执行规格：GUIDANCE 全量推广 + state 校验统一

- **日期**: 2026-08-04
- **状态**: 待执行
- **依据**: 批次 C 遗留（C9 只做 open 试点；C6 校验不覆盖 guard/handoff 写入路径）+ 结构探查
- **权威源**: `.comet/bundle-drafts/flow-comet/`；同步到 bundles + 赛事系统安装副本 + e2e

---

## 〇、结构探查结论（已完成）

18 个 SKILL.md 分两类：
- **双 frontmatter 型（5 个，有双区重复）**: `flow-comet`（主）、`flow-comet-design`、`flow-comet-open`（已试点）、`flow-comet-plan`、`flow-comet-subagent-execute`——结构为 frontmatter(1) → 手写区 → frontmatter(2) → kernel Auto 区（含重复的 Entry Check/Output Schema/Recovery）
- **单 frontmatter 型（13 个，无重复）**: archive/change/dev/evolve/execute/health/integration/requirement/review/task/test/ui-design/verify——手写+kernel 段单区混合，无漂移问题，**不需要分离**

## 一、D1 · GUIDANCE 引用式分离推广（剩余 4 个双 frontmatter skill）

**模式**（open 试点已验证）：GUIDANCE.md = 第一个 frontmatter + 手写区内容（到第二个 frontmatter 前）逐字节副本；SKILL.md 手写区位置（第一个 frontmatter 后、`# <skill>` 前）插入一行 `<!-- 手写区详细协议见 GUIDANCE.md（可选阅读） -->`；第二个 frontmatter 起的 Auto 区**零改动**。

**对象**: `flow-comet/SKILL.md`（手写区为 6-10 行 "# flow-comet + ## Decision Core" 薄内容）、`flow-comet-design/SKILL.md`、`flow-comet-plan/SKILL.md`、`flow-comet-subagent-execute/SKILL.md`。open 已有 GUIDANCE.md 不动。

**验证**: 每个 SKILL.md frontmatter 完整（`--- name/description ---` 开头）、`grep -n "^---$"` 数量不变、Auto 区内容 diff 为空（只加引用行）、GUIDANCE.md 与手写区 `diff --strip-trailing-cr` 一致。

## 二、D3 · state 写入校验统一（C6 覆盖补齐）

**问题**: 批次 C C6 只给 `workflow-state.mjs` 的 writeState 加了字段校验；`workflow-guard.mjs` 的 3 处 state 写入（1999 行 C3 taskHash / 2262 / 2367）与 `workflow-handoff.mjs` 的 writeState（23-26 行）绕过校验。

**方案**: 抽公共校验模块，三脚本共享（避免校验逻辑三份复制漂移）：
1. **新文件** `scripts/state-schema.mjs`：
   - 导出 `STATE_FIELD_VALIDATORS`（8 字段，从 workflow-state.mjs C6 的现有表原样迁移：activeChange/currentNode string|null、completedNodes array、evidence object、verifyFailures number≥0、executionMode enum、directOverride boolean、taskHash string|undefined）
   - 导出 `validateStateFields(state)`：存在字段逐一校验，返回非法字段名数组（空 = 合法）；调用方负责 BLOCKED/exit 处理
2. `workflow-state.mjs`：writeState 改为 `import { validateStateFields } from './state-schema.mjs'`，非法时保留现有 `BLOCKED: state 字段类型非法: <field>` + exit 1 行为
3. `workflow-guard.mjs`：3 处 `writeJson(file, state)` 调用前调用 `validateStateFields(state)`，非法 → 同样 BLOCKED + exit 1（注意 import 放文件头，与现有 import 并列；不要动 writeJson 本身——它可能还写其他 JSON）
4. `workflow-handoff.mjs`：writeState 内调用 `validateStateFields(state)`，非法 → `BLOCKED: state 字段类型非法: <field>` + exit 1

**约束**: 校验表定义唯一来源 = state-schema.mjs（workflow-state.mjs 里删除内联表）；行为与批次 C C6 完全一致（未知字段放行、缺字段放行）；不破坏 C3 的 taskHash 写入（taskHash string 合法）。

## 三、验证场景

1. **D1**: 4 个 skill 的 SKILL.md frontmatter 数量不变 + Auto 区零改动（git diff 只显示引用行）+ GUIDANCE.md 与手写区一致
2. **D3**: `node scripts/guard-self-test.mjs` 全量 17/17 回归通过（批次 C 基线）
3. **D3**: guard 路径——伪造 state 含 `verifyFailures:"bad"` → `workflow-guard.mjs entry execute` 写 taskHash 时 BLOCKED（真实命令输出）
4. **D3**: handoff 路径——伪造 state 含非法字段 → `workflow-handoff.mjs request` BLOCKED（真实命令输出）
5. **D3**: workflow-state.mjs 回归——合法 state 正常写入 + 非法拒绝（批次 C 已有场景复跑）

## 四、三处同步 + 推送

- 同步到 `.comet/bundles/flow-comet/skills/` + 赛事系统安装副本 + e2e，`diff --strip-trailing-cr` 校验
- `comet bundle compile flow-comet --platform claude` dry-run 确认文件数（当前 42，新增 GUIDANCE×4 + state-schema.mjs → 47）
- 全部完成后 `git push origin main`（用户已确认补完后再推）

## 约束

1. 只改规格列出的文件；禁改 workflow-protocol.json / .comet/config.yaml
2. SKILL.md 只动手写区（引用行），Auto 区零触碰
3. 保持 BLOCKED / WARN / exit(1) 风格；向后兼容（旧 state 无字段跳过）
4. 验证临时目录不留残留

## 回传要求

1. 改动文件清单（路径 + 改动编号）
2. 每个验证场景真实命令 + 输出
3. compile dry-run 文件数确认
4. 遗留风险
