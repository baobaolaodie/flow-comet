# 修复回路（缺陷 → execute 生命周期 · 受控重入）

> **读者对象**：review / verify 发现缺陷后要开修复回路的人，以及归档后要把工作归属退回既有生命周期的协调者。
> **何时读**：要判定需开修复回路、要把工作归属受控归位 / 受控重入，或要核对归档侧重入边界时读。
>
> 本文件内容**逐字搬运**自 `flow-comet-verify`（「修复回路状态机路径」段全文）· `flow-comet`（受控重入完整规格）· `flow-comet-archive`（归档后发现缺陷）· `flow-comet-subagent-execute`（受控重入打开的修复场景）四册的原有段落（搬运，不重写）；各节点册只留要点句与条件句。

## 修复回路状态机路径

review / verify 发现缺陷后的修复必须回到 `execute` 节点生命周期内完成，禁止驻留源节点「顺手修完」；引擎按以下路径强制闭环（`<源节点>` 为 review 或 verify）：

1. **追加 Fix 任务**：在 `.specs/<change-id>/TASK.md` 的 `## Fix 任务` 段内追加编号修复任务（完整任务字段），**禁止文件尾追加**；任务集修订必须在 `entry` 之前完成。
2. **受控归位 execute**：运行 `workflow-state next`（完整命令：`node .claude/skills/flow-comet/scripts/workflow-state.mjs next`），或运行 `workflow-guard entry execute`（完整命令：`node .claude/skills/flow-comet/scripts/workflow-guard.mjs entry execute`）。处于 Fix 回退态（源节点驻留 + 存在 pending Fix 任务 + 当前路由判定为 execute）时，引擎把当前节点受控归位为 `execute`（`currentNode=execute`），并输出 `FIX-BATCH` 审计行（`next` 同时输出 `NODE: execute`）；用 `workflow-state.mjs status` 确认 `stateCurrentNode` 已是 `execute` 再开工；若未归位，先按 `next` / `status` 的输出核对任务状态与路由，不要未经归位硬开工。
3. **执行修复**：按 execute 节点生命周期完成全部 Fix 任务（委托/直写规则不变）；`entry execute` 刷新任务集签名，锁定追加后的任务集——归位后不得再增删任务或修改任务内容。
4. **跑 execute 四类出口**：`record execute` → `exit execute --apply`。四类出口门禁真实执行——**全任务 done / 逐任务 SUMMARY 完备 / 6 维自查 + 自检方法声明 / 任务集签名一致**；任一缺失即 BLOCKED 并给出恢复指引。通过后，引擎在 Fix 二次完成时把当前节点推回源节点（review 或 verify）。
   - **guard exit 回源审计行语义（Fix vs RETURN）**：真实修复回路二次完成保留 `FIX-BATCH: 回源节点 <源节点>`（真实 Fix 回炉的机器锚）；正常多趟收尾（任务集签名全等且无 Fix 标记）输出中性 `RETURN: 回源节点 <源节点>`（非 Fix 回修）；旧 state 缺闭合/修复证据（无签名事件且无 Fix 标记）输出 `RETURN: 回源节点 <源节点>（旧 state 缺闭合/修复证据，未分类）`，不冒充 Fix、不 BLOCK；上述分类只改审计行文本，路由与 state 写入零变化。此处 `RETURN:` 仅指审计行前缀，与子代理 handoff 的 Return Contract 无关。
5. **回源节点跑出口**：回到源节点后运行 `next`，Fix 回程豁免生效时应输出 `NODE: review` 或 `NODE: verify`（不会因源节点产物已存在而跳过）；若仍输出后续节点，说明回程条件未满足，先核对状态机归属与任务状态，不要继续推进。随后执行 `entry <源节点>` → `exit <源节点> --apply` 跑源节点出口门禁（即 entry/exit 源节点）；通过后继续正常路由（review → verify；verify → archive），必要时进入下一轮 Fix 闭环。
   - **`next` 回程审计行语义**：回程豁免行始终输出中性 `RETURN: 回程源节点 <源节点>`（源节点产物在场且未出口；保留源节点跑出口），不再输出 FIX-BATCH；受控归位行的 `FIX-BATCH: 归位 <execute 家族>` 保留（真实 Fix 回退行），两者不得混同。
6. **禁止绕过**：驻留源节点不归位、顺手改完后直接跑源节点 exit 收场会被 BLOCKED（存在未归位/未跑出口的修复回路），必须按上述路径恢复；不得用跳过归位或出口门禁的手段（含手动改写 `.flow-comet/flow-comet-state.json`）替代本路径。

**由受控重入打开的场景（archive 源）**：缺陷在归档后才暴露、且归档移动尚未发生时，可先由用户显式授权把工作归属退回 `execute` / `subagent-execute` / `review` / `verify` 之一，再按本节路径回到 execute 生命周期完成修复。重入命令：`node .claude/skills/flow-comet/scripts/workflow-state.mjs reenter <target> --authorized-by <source> --reason <text> [--continue-round <n>]`——每次调用都需要用户显式授权，每 change 上限 3 轮（达上限后凭显式续轮授权 `--continue-round <n>`（n ≥ 已用轮次 + 1）可继续并计入下一轮）；重入前自动落 state 备份快照（`.specs/<change-id>/.reentry-backups/`）；成功打印 `REENTRY: archive → <target>（授权源 <source>；第 n/3 轮；备份 <file>）` 与 `REASON: <text>` 行（续轮审计行为 `第 n 轮（显式授权续轮，上限 3）`），与 Fix 回炉的 `FIX-BATCH` 行、正常多趟收尾的 `RETURN` 行三态可区分。归档移动已发生或 change 已 `completed` 时重入 BLOCKED，须走人工处置或新 change，不得静默跳过。重入只改工作归属，不写任何闭合标记，也不跳过目标节点入口 / 出口与源节点出口门禁；重复调用同一目标为空操作（输出 `REENTRY: 空操作——…`，不备份、不计数、不改写 state）。

## 受控重入与归档侧边界

### 受控重入（archive 源）

归档后发现缺陷、且归档移动尚未发生时，用受控重入把工作归属退回 `execute` / `subagent-execute` / `review` / `verify` 之一：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs reenter <target> --authorized-by <source> --reason <text> [--continue-round <n>]
```

- **何时用**：`currentNode` 停在 `archive`、`.specs/<change-id>/` 仍在原位（归档移动尚未发生）、`status !== 'completed'`，且存在必须回到既有生命周期才能完成的修复。
- **授权**：每次调用都需要用户显式授权——命令面 `--authorized-by` 记录授权来源、`--reason` 说明原因（原因随审计记录一并落盘）；引擎把授权留痕写入目标节点的嵌套证据（`state.evidence.<target>.reentryAuthorization`），缺授权或形态不合法一律 BLOCKED 且 state 字节零改写，授权不可由执行者自决（授权是声明式信任边界：`state` 只走脚本通道留痕，hook 拦工具不拦脚本，引擎按声明处理）。
- **上限与显式续轮**：每 change 最多 3 轮；第 4 次 BLOCKED 并给出「继续 / 停止」人工裁决指引。人工裁决「继续」须追加 `--continue-round <n>`（正整数，且 n ≥ 已用轮次 + 1）作显式续轮授权：满足则放行并计入下一轮、审计行打印 `第 n 轮（显式授权续轮，上限 3）`；未到上限即传该参数、或轮次不足一律 BLOCKED 且零改写。轮次与审计事件记入 `state.history`（事件类型 `reentry-applied`，含 `reason`；续轮时附 `continuationAuthorized: true`），成功输出 `REENTRY: archive → <target>（授权源 <source>；第 n/3 轮；备份 <file>）` 与 `REASON: <text>` 两行。
- **备份**：转移前自动落 state 快照 `.specs/<change-id>/.reentry-backups/<UTC ISO>-pre-<target>.json`（时间戳中的 `:` 替换为 `-`），并记录 sha256 指纹，供审查核验与手工回滚。
- **顺序**：命令成功后再写修复内容——archive 阶段写入白名单只放行 `.specs/<change-id>/KNOWN-ISSUES.md` 等少数路径；重入后写入权限跟随目标节点，此时才追加 Fix 任务 / 修改工件。
- **边界**：归档移动已发生或 change 已 `completed` → BLOCKED，走人工处置或新 change / hotfix；重复调用同一目标 → 空操作（输出 `REENTRY: 空操作——…`，不备份、不计数、不改写 state），不会静默跳过。

### 归档后发现缺陷（受控重入）

归档已 entry 但归档移动尚未发生（`.specs/<change-id>/` 仍在原位、`status !== 'completed'`）时，review / verify / 执行阶段发现的新缺陷按下列边界处置：

- **未移动** → 受控重入：由用户显式授权后运行

  ```bash
  node .claude/skills/flow-comet/scripts/workflow-state.mjs reenter <target> --authorized-by <source> --reason <text> [--continue-round <n>]
  ```

  目标限 `execute` / `subagent-execute` / `review` / `verify` 之一；每次调用都需要用户显式授权，每 change 上限 3 轮（达上限后凭显式续轮授权 `--continue-round <n>`（n ≥ 已用轮次 + 1）可继续并计入下一轮）；命令先自动落 state 备份快照（`.specs/<change-id>/.reentry-backups/`），再转移工作归属，并打印 `REENTRY: archive → <target>（授权源 <source>；第 n/3 轮；备份 <file>）` 与 `REASON: <text>` 行（续轮审计行为 `第 n 轮（显式授权续轮，上限 3）`）。缺授权、目标越界、超上限或归档移动已发生一律 BLOCKED（state 字节零改写），不会静默跳过。
- **已移动 / 已合并** → 人工处置或新 change：归档移动已发生（`.specs/archive/<日期>-<change-id>/`）或 change 已 `completed` / 已合并时，受控重入不适用（不承诺把文件搬回原位）；走人工处置，或把修复放进新 change / hotfix，并在遗留清单里登记指针。

**写权限顺序（先转移后写 TASK）**：archive 阶段 hook 对 change 目录只放行 `KNOWN-ISSUES.md` 这一个精确文件（另有 `.specs/archive/`、`.specs/CHANGELOG.md`、`.specs/LESSONS.md`、`STATE.md`），TASK.md 的修复任务写入不在放行面内。顺序固定为：先跑 `reenter` 完成转移（写入权限随即跟随目标节点），再在目标节点权限内追加 Fix 任务 / 修改工件——不要试图在 archive 阶段先写 TASK.md。若重入成功后追加任务失败，用 `next` / `status` 核对归属；重复调用同一目标为空操作（不备份、不计数、不改写 state）。

### 受控重入打开的修复场景（archive 源）

缺陷在归档后才暴露、且归档移动尚未发生时，可先由用户显式授权把工作归属退回本节点或 `execute` / `review` / `verify`，再按常规委托与出口流程完成修复。重入命令：`node .claude/skills/flow-comet/scripts/workflow-state.mjs reenter <target> --authorized-by <source> --reason <text> [--continue-round <n>]`——每次调用都需要用户显式授权，每 change 上限 3 轮（达上限后凭显式续轮授权 `--continue-round <n>`（n ≥ 已用轮次 + 1）可继续并计入下一轮）；重入前自动落 state 备份快照（`.specs/<change-id>/.reentry-backups/`）；成功打印 `REENTRY: archive → <target>（授权源 <source>；第 n/3 轮；备份 <file>）` 与 `REASON: <text>` 行（续轮审计行为 `第 n 轮（显式授权续轮，上限 3）`），与 Fix 回炉的 `FIX-BATCH` 行、正常多趟收尾的 `RETURN` 行三态可区分。归档移动已发生或 change 已 `completed` 时重入 BLOCKED，须走人工处置或新 change，不得静默跳过。重入只改工作归属，不写任何闭合标记，也不跳过本节点入口 / 出口门禁；重入后并行任务的委托证据、write_files 边界与 Return Contract 校验与常规流程完全一致；重复调用同一目标为空操作（输出 `REENTRY: 空操作——…`，不备份、不计数、不改写 state）。
