# 自动初始化检测（init 前置步骤）

> 每次 `init` 新 change 前，flow-comet 自动检测项目上下文状态，按需提示初始化；无需记忆任何独立命令。

## 触发与流程

```
workflow-state.mjs init <change-id> [--init-context | --init-skip]
  │
  ├─ 自动检测（无参数时）：探测项目上下文 → 判决 → 提示或静默
  ├─ --init-context：同意初始化——CONTEXT 缺失 → 输出 INIT-GENERATE 指引（agent 生成）；
  │    生成后重跑 → 脚本校验 7 段 → INIT-DONE + 写 last_intel_scan；缺段 → INIT-VALIDATE-FAILED
  ├─ --init-skip：拒绝初始化——记录跳过，后续不再提示
  └─ 原 init 行为（分支创建 / 状态写入）不变
```

## 判决表

| 情形 | 行为 |
|------|------|
| 已记录跳过（`--init-skip`，`ai_context_doc: none`） | 静默（沿用上次决策） |
| CONTEXT.md 已存在且扫描 ≤ 90 天 | 静默（零打扰） |
| CONTEXT.md 已存在但扫描 > 90 天 | 提示"可重跑刷新"（不强制） |
| 无 CONTEXT.md + 检测到既有 AI 文档（AGENTS.md / CLAUDE.md / .cursor / .windsurf / Copilot / Cline 等） | 提示（列出文档）→ 同意后：读取并整合既有文档（出处标注）+ 代码探测，生成 CONTEXT.md |
| 无 CONTEXT.md + 无既有文档 + 有代码上下文 | 提示 → 同意后：代码探测生成 CONTEXT.md |
| 新项目（无代码上下文） | 提示 → 同意后：生成骨架（占位随流程沉淀） |

## 初始化生成内容（脚本探测 + agent 生成协作）

- **职责拆分**：脚本只做确定性部分——探测 / 判决 / 提示 / 7 段结构校验 / `last_intel_scan` 写入；**生成由 agent 执行**（intel-scan 全量阅读语义，脚本不做智能整合）
- **生成流程**：`--init-context` 且 CONTEXT 缺失 → 脚本输出 `INIT-GENERATE` 指引（源文档列表 + 代码信号）→ agent 全量阅读既有文档与代码，生成 `.specs/CONTEXT.md` → 重跑 `init <id> --init-context` → 脚本校验 7 段 → 通过输出 `INIT-DONE` 并写 `last_intel_scan`；缺段输出 `INIT-VALIDATE-FAILED`（不写扫描时间，补全后重跑）
- `.specs/CONTEXT.md`：项目概要 / 技术栈 / 域语言 / 已锁决策 / 默认偏好 / 既有抽象索引 / 扫描元数据 七段（模板对齐）
- 既有文档整合（agent 执行）：关键决策映射进对应段，出处标注 `来自 <文档>:<行号>`；文件顶部「源文档」段列出引用；**既有文档本身不改动**；既有 CONTEXT 的累积术语/决策在刷新时保留（跨 change 长期累积语义）
- 代码探测（agent 执行）：依赖文件识别（package.json 等 → 技术栈）、常见目录探测（抽象索引）
- 成本：约 15-30k tokens（仅首次；提示中如实告知）

## 生成质量要求（agent 执行基准，2026-08-10 真实项目端到端验证沉淀）

> 脚本只校验「填没填」（7 段 + 模板格式存在级）；「好不好」由以下质量清单把关（agent 生成时逐项自检，真实项目端到端验证实证：模板条目格式漏做会被用户抓出）。

1. **模板对照**：生成/重写前先读 `flow-kit/templates/CONTEXT.md`（未检测到时按 7 段基准）——段标题、条目格式、元数据字段与模板一致。
2. **条目格式**：已锁决策条目用模板格式 `- [YYYY-MM-DD] 决策内容 — 来自 @.specs/<change-id>/DESIGN.md`（新决策带日期；既有累积决策沿用原文日期）；intel-scan 元数据含 `last_intel_scan` / `scanner` / `下次重扫建议` 三字段。
3. **累积保留**：既有 CONTEXT.md 的术语表、已锁决策、默认行为**全部保留**（跨 change 长期累积语义）——不能只保留关键词行或丢失表格行。
4. **出处标注**：整合自既有文档/既有 CONTEXT 的内容带 `来自 <doc>:<line>` 标注（文件顶部「源文档」段列出引用）；**既有文档本身零写入**。
5. **技术栈真实**：代码探测结果如实反映项目（依赖文件/目录信号），不臆造栈卡片。
6. **生成后重跑校验**：写完 `.specs/CONTEXT.md` 后重跑 `init <change-id> --init-context`，脚本 7 段 + 格式校验通过（INIT-DONE）才算完成；校验失败按 `INIT-VALIDATE-FAILED` 列出的问题修正后重跑。

## 拒绝与记忆

- `--init-skip`：记录跳过（`ai_context_doc: none`），后续 init 不再提示
- `--init-context`：刷新扫描时间（90 天时效重新起算）

## 与既有机制的关系

- 不新增命令（init 的参数扩展）；无参数行为 = 原行为 + 检测提示
- 已存在 CONTEXT.md 的项目（90 天内）完全静默，行为零变化
- 生成文件位于 `.specs/`（流程工件目录），既有文档零写入
