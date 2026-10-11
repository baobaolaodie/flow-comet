# 受控重校（`replan` · execute 源）

> **读者对象**：`execute` / `subagent-execute` 相位上发现计划有缺陷、需要重新校验并重签任务集的协调者与执行者。
> **何时读**：要判定该不该走 `replan` 重校任务集、或出口报「任务集签名不匹配」时读。
>
> 本文件内容**逐字搬运**自入口册 `flow-comet` 的「受控重校」段原文（搬运，不重写）；入口册与 `flow-comet-execute` 册只留要点句与条件句。

## 规格全文（入口册原文搬运）

### 受控重校（`replan` · execute 源）

计划在执行中被证明有缺陷、任务集因此需要修订时，用受控重校重新校验并重签任务集——不跳节点、不重置任何完成态：

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs replan "<reason>" --authorized-by <source> [--continue-round <n>]
```

- **何时用**：`currentNode` 停在 `execute` / `subagent-execute`，且任务集在进入该节点后被修订、出口因此报「签名不匹配」时；修订后的任务集必须自身合法。
- **授权**：每次调用都需要用户显式授权——`--authorized-by` 记录授权来源，位置参数记录原因；引擎把授权留痕写入当前节点的嵌套证据（`state.evidence.<node>.replanAuthorization`）。缺授权、值为空/纯空白或形态非法一律 BLOCKED，且 state 字节零改写。
- **上限与显式续轮**：每 change 最多 3 轮；第 4 次 BLOCKED 并给出「继续 / 停止」人工裁决指引。人工裁决「继续」须追加 `--continue-round <n>`（正整数，且 n ≥ 已用轮次 + 1）作显式续轮授权：满足则放行并计入下一轮，审计行打印续轮标记；未到上限即传该参数、或轮次不足一律 BLOCKED 且零改写。轮次与审计事件记入 `state.history`（事件类型 `replan-applied`），成功输出 `REPLAN: <node> 重新校验通过（授权源 <source>；第 n/3 轮；备份 <file>）` 与 `REASON: <text>` 两行。
- **备份**：改写前自动落 state 快照 `.specs/<change-id>/replan-backups/<UTC ISO>-pre-replan.json`（时间戳中的 `:` 替换为 `-`），并记录 sha256 指纹，供审查核验与手工回滚。
- **幂等与零改写**：目标形态已成立时的重复同形态调用 = 空操作（输出 `REPLAN: 空操作——…`，不备份、不计数、不写事件、不改写 state），不会静默跳过。
- **绝不豁免校验**：`replan` 只做「重新校验 + 重新签名」——判据与 plan 出口同源，处置按路径分列：**replan 重校**——任务块 / 每任务 `<verify>` / 任务图（依赖环 / 缺失依赖）任一不成立，或并行写冲突的写写（write∩write）成立，一律 BLOCKED（状态零改写）；读写（read∩write）仅 WARN 不阻断；7 字段完整性只在「新模板形态（含 `<name>`）+ 新 change」缺字段时 BLOCKED，其余情形 WARN 渐进。**plan 出口**——任务块 / 每任务 `<verify>` 缺失一律 BLOCKED；任务图的依赖环 / 缺失依赖与并行写冲突的写写，对新 change BLOCKED、旧 change WARN 渐进；读写对新旧 change 均仅 WARN。它不是绕过签名门禁，而是把「签名不匹配」重新收敛为「匹配」。
