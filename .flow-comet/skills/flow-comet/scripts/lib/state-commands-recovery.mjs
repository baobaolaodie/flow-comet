// state 命令族 · 恢复面（单一归属）：reenter（archive 源受控重入）/ replan（受控计划重校重签）。
// 全部判定集中在 route-node.mjs 纯函数族，本模块只做编排与落盘（BLOCK 与空操作路径一律在
// 写盘前返回，state 字节零改写）；argv = 进程参数原样。
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import {
  resolveReentryDecision, resolveReplanDecision, analyzeDependencyGraph, findParallelWriteConflicts,
  protocolTaskFilePath, REENTRY_ROUND_LIMIT, REENTRY_TARGET_NODE_IDS, REPLAN_ROUND_LIMIT,
} from '../route-node.mjs';
import { taskOpeningAttrs, taskBlocks } from '../task-parsing.mjs';
import { validateStateFields } from '../state-schema.mjs';
import { inspectWorkflowPathSegments } from '../protocol-utils.mjs';
import { fileExists, inspectReentryChangeDir, readJson, readState, runRootDir, specsDir, stateFile, writeState } from './state-io.mjs';

// reenter <target> --authorized-by <source> --reason <text> [--continue-round <n>]
// 受控重入（archive 源回边）：archive 已 entry 且归档移动尚未发生时，用户显式授权把工作归属
// 退回执行家族 / review / verify 之一。编排顺序：参数防护 → 路径边界（change 名单段 +
// realpath 直接子目录）→ 单一权威判定（目标 / change 名 / 上限 / 幂等 / 源 / 授权）→ 备份
// （包含性复核）→ 转移 → 授权留痕 → 审计事件 → REENTRY 行。
export async function runReenter(protocol, argv) {
  const target = argv[3];
  const reentryTargetList = [...REENTRY_TARGET_NODE_IDS].join(', ');
  const reenterUsage = '用法: workflow-state.mjs reenter <target> --authorized-by <source> --reason <text>'
    + ' [--continue-round <n>]（target 白名单: ' + reentryTargetList + '）';
  if (typeof target !== 'string' || target === '' || target.startsWith('--')) {
    console.error('BLOCKED: reenter 缺少目标节点。' + reenterUsage);
    process.exit(1);
  }
  let authorizedBy = null;
  let reason = null;
  let continuationRound = null;
  const reenterArgs = argv.slice(4);
  for (let index = 0; index < reenterArgs.length; index += 1) {
    const arg = reenterArgs[index];
    // 支持 --name value 与 --name=value 两种形态；--protocol 为全局参数（协议路径已由
    // resolveProtocol 统一解析），命令面只做占位透传。
    let key = arg;
    let value = null;
    if (typeof arg === 'string' && arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        key = arg.slice(0, eq);
        value = arg.slice(eq + 1);
      }
    }
    if (key === '--protocol') {
      if (value === null) index += 1;
      continue;
    }
    if (key === '--continue-round') {
      // 续轮授权只在达到轮次上限后生效：命令面收正整数，形态合法性与「是否已到上限」由
      // 单一权威综合判定裁决（本处只做数值形态防护，fail-closed，先于任何读盘）。
      let consumedNext = false;
      if (value === null) {
        value = reenterArgs[index + 1];
        consumedNext = true;
      }
      const parsedRound = typeof value === 'string' && value.trim() !== '' && !value.startsWith('--')
        ? Number(value.trim())
        : Number.NaN;
      if (!Number.isInteger(parsedRound) || parsedRound <= 0) {
        console.error('BLOCKED: reenter --continue-round 需要正整数取值，实际 ' + JSON.stringify(value) + '。' + reenterUsage);
        process.exit(1);
      }
      continuationRound = parsedRound;
      if (consumedNext) index += 1;
      continue;
    }
    if (key === '--authorized-by' || key === '--reason') {
      let consumedNext = false;
      if (value === null) {
        value = reenterArgs[index + 1];
        consumedNext = true;
      }
      // 缺值 / 空值 / 纯空白 / 取下个选项名当值 → 一律用法错误（fail-closed，先于任何读盘）
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
        console.error('BLOCKED: reenter ' + key + ' 需要非空取值。' + reenterUsage);
        process.exit(1);
      }
      if (key === '--authorized-by') authorizedBy = value.trim();
      else reason = value.trim();
      if (consumedNext) index += 1;
      continue;
    }
    console.error('BLOCKED: reenter 未知参数 ' + JSON.stringify(arg) + '。' + reenterUsage);
    process.exit(1);
  }
  if (authorizedBy === null) {
    console.error('BLOCKED: reenter 需要显式授权 --authorized-by <source>（授权不可自决）。' + reenterUsage);
    process.exit(1);
  }
  if (reason === null) {
    console.error('BLOCKED: reenter 需要 --reason <text> 说明重入原因。' + reenterUsage);
    process.exit(1);
  }
  const state = await readState();
  const badFields = validateStateFields(state);
  if (badFields.length > 0) {
    // history 存在但非数组等类型损坏在此 fail-closed：不得由本命令静默清空覆盖审计历史。
    console.error('BLOCKED: state 字段类型非法: ' + badFields[0]);
    process.exit(1);
  }
  // 原始 state（未经 readState 兼容默认值叠加）：落盘时只写「原始键集 + 本次实际改动的字段」，
  // 兼容默认值不得随重入回写（最小旧 state 的键集保持逐项不变）。
  const rawState = (await fileExists(stateFile())) ? await readJson(stateFile()) : null;
  // 路径边界：change 名必须是 .specs/ 下的单段真实目录（realpath 归一后是 .specs 直接子目录，
  // 且路径上无 symlink/junction）。归档移动已发生（目录不在原位）、change 已 completed、
  // change 名畸形（多段 / . / .. / 保留目录 archive）与链接逃逸一律 BLOCK。该边界先于综合
  // 判定执行——completed 与已移动形态必须无条件 BLOCK（不被空操作分支短路）。
  const changeName = typeof state.activeChange === 'string' ? state.activeChange : '';
  const changeBoundary = await inspectReentryChangeDir(changeName);
  const changeDirPresent = changeBoundary.ok
    ? true
    : (changeBoundary.reason === 'change-dir-missing' ? false : null);
  const movedOrCompletedMessage = 'BLOCKED: 归档移动已发生或 change 已 completed（.specs/'
    + (changeName || '<未知>') + '/ 在场=' + changeDirPresent + '，status=' + JSON.stringify(state.status)
    + '）——受控重入只覆盖归档移动前的运行形态；请走人工处置、新 change 或 hotfix 路径。';
  if (state.status === 'completed' || changeDirPresent === false) {
    console.error(movedOrCompletedMessage);
    process.exit(1);
  }
  if (!changeBoundary.ok) {
    const boundaryMessages = {
      'no-active-change': '当前没有活跃 change（activeChange 缺失或为空）——先 select <change-id>',
      'change-name-invalid': 'change 名非法 ' + JSON.stringify(changeName)
        + '——必须是 .specs/ 下的单段目录名（拒绝路径分隔符、. / .. 与保留目录 archive）',
      'change-dir-escape': 'change 目录路径越界或跨越符号链接 / junction（' + changeBoundary.detail
        + '）——受控重入与备份只允许落在 .specs/<change-id>/ 真实目录内',
    };
    console.error('BLOCKED: ' + boundaryMessages[changeBoundary.reason]);
    process.exit(1);
  }
  const changeDir = changeBoundary.changeDir;
  // 授权形态的 round / at 由引擎派生（命令面只承载授权来源、原因与上限后的续轮轮次）：普通轮次
  // 以合法占位值过形态门；落盘轮次一律取综合判定返回的 round（由本 change 历史事件派生），
  // 不在此内联第二份轮次推导。
  const authorizedAt = new Date().toISOString();
  const decision = resolveReentryDecision({
    protocol,
    state,
    target,
    authorization: { round: 1, at: authorizedAt, source: authorizedBy, target },
    continuationRound,
  });
  if (!decision.ok) {
    if (decision.reason === 'round-limit-reached') {
      console.error('BLOCKED: 本 change 受控重入已达上限（' + decision.used + '/' + decision.limit
        + ' 轮）。需要人工裁决：继续（显式授权后在同一命令加 --continue-round <n>，n 为不小于第 '
        + (decision.used + 1) + ' 轮的正整数，须与 --authorized-by / --reason 同次传入）/ 停止（保持归档态，不再重入）。');
      process.exit(1);
    }
    const guidance = {
      'target-not-allowed': '目标节点 ' + JSON.stringify(target) + ' 不在受控重入白名单（'
        + reentryTargetList + '）——请显式指定白名单内目标',
      'target-not-enabled': '目标节点 ' + JSON.stringify(target)
        + ' 在当前协议中未启用（disabled）——请检查协议或改选已启用目标',
      'no-active-change': '当前没有活跃 change（activeChange 缺失或为空）——先 select <change-id>',
      'change-name-invalid': 'change 名非法 ' + JSON.stringify(changeName)
        + '——必须是 .specs/ 下的单段目录名（拒绝路径分隔符、. / .. 与保留目录 archive）',
      'source-not-archive': '受控重入只覆盖 archive 源（当前节点 ' + JSON.stringify(state.currentNode)
        + '）——正常推进请走 next / record / exit 既有通道',
      'continuation-not-required': '--continue-round 只在达到轮次上限后需要（当前 ' + decision.used + '/'
        + decision.limit + ' 轮）——上限前请直接以 --authorized-by / --reason 发起',
    }[decision.reason] || ('授权形态不合法（' + decision.reason + '）——需要用户显式传入 --authorized-by <source>');
    console.error('BLOCKED: ' + guidance);
    process.exit(1);
  }
  if (decision.action === 'noop') {
    console.log('REENTRY: 空操作——workflow 已处于目标形态（' + target
      + '，完成标记已是目标前驱交集）；未备份、未计数、未改写 state。');
    return;
  }
  if (decision.action !== 'apply') {
    console.error('BLOCKED: 受控重入判定返回未知动作 ' + JSON.stringify(decision.action) + '——按 fail-closed 拒绝。');
    process.exit(1);
  }
  const round = decision.round;
  const source = decision.authorization.source;
  const at = decision.authorization.at;
  const continuationAuthorized = decision.continuationAuthorized === true;
  // 备份：重入前 state 全量快照（文件原始字节，UTF-8 BOM 按可解析形态落盘）；文件名
  // <UTC ISO 净化>-pre-<target>.json；审计指纹 = 备份文件字节的 sha256（可核验）。
  const backupDir = path.join(changeDir, '.reentry-backups');
  const backupFile = at.replace(/:/g, '-') + '-pre-' + target + '.json';
  const backupPath = path.join(backupDir, backupFile);
  const backupRecord = path.relative(runRootDir(), backupPath).split(path.sep).join('/');
  const snapshotBytes = Buffer.from((await fs.readFile(stateFile(), 'utf8')).replace(/^\uFEFF/, ''), 'utf8');
  const fingerprint = createHash('sha256').update(snapshotBytes).digest('hex');
  const existingHistory = Array.isArray(rawState?.history) ? rawState.history : [];
  let backupWritten = false;
  try {
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
      throw new Error('state 文件缺失或形态非法，无法重入');
    }
    // 备份写入路径的物理包含性复核（单一权威路径段扫描）：备份目录与备份文件逐段
    // lstat + realpath——任何 symlink/junction 逃出 .specs/ 一律拒绝，不写任何字节。
    await fs.mkdir(backupDir, { recursive: true });
    await inspectWorkflowPathSegments(specsDir(), backupDir, 'reenter backup dir', 'directory');
    await fs.writeFile(backupPath, snapshotBytes);
    backupWritten = true;
    await inspectWorkflowPathSegments(specsDir(), backupPath, 'reenter backup file', 'file');
    // 授权留痕：嵌套写入被重入目标节点的 evidence（授权记录 + 备份指针 + 指纹 + 原因 +
    // 续轮标记）。只改 evidence 的目标节点键，其余键按原始键集逐项保留。
    const existingEvidence = rawState.evidence && typeof rawState.evidence === 'object' && !Array.isArray(rawState.evidence)
      ? rawState.evidence
      : {};
    const targetEvidence = existingEvidence[decision.target]
      && typeof existingEvidence[decision.target] === 'object'
      && !Array.isArray(existingEvidence[decision.target])
      ? existingEvidence[decision.target]
      : {};
    const authorizationRecord = {
      round,
      at,
      source,
      target: decision.target,
      backup: backupRecord,
      fingerprint,
      reason,
      ...(continuationAuthorized ? { continuationAuthorized: true } : {}),
    };
    // 落盘形态 = 原始 state 键集 + 本次实际改动的四类机器字段与审计字段——转移语义
    // （currentNode := target / completedNodes := 前驱交集 / status := running）与审计
    // （evidence 留痕 + history 追加事件）之外的字段逐项不变；readState 的兼容默认值不回写。
    const persisted = { ...rawState };
    persisted.currentNode = decision.target;
    persisted.completedNodes = decision.completedNodes.slice();
    persisted.status = 'running';
    persisted.evidence = {
      ...existingEvidence,
      [decision.target]: { ...targetEvidence, reentryAuthorization: authorizationRecord },
    };
    // 审计事件：append-only 追加 reentry-applied；change 字段是跨 change 轮次隔离的唯一依据。
    persisted.history = existingHistory.concat([{
      event: 'reentry-applied',
      from: 'archive',
      to: decision.target,
      round,
      authorization: { round, at, source, target: decision.target },
      backup: backupRecord,
      fingerprint,
      at,
      change: changeName,
      reason,
      ...(continuationAuthorized ? { continuationAuthorized: true } : {}),
    }]);
    const persistedBad = validateStateFields(persisted);
    if (persistedBad.length > 0) throw new Error('state 字段类型非法: ' + persistedBad[0]);
    await writeState(persisted);
  } catch (error) {
    // 写盘失败：回滚本次调用创建的孤儿备份（state 由原子写保证不被截断），原始错误照常上抛。
    if (backupWritten) {
      try { await fs.rm(backupPath, { force: true }); } catch { /* 清理失败不掩盖原始错误 */ }
    }
    throw error;
  }
  const roundLabel = continuationAuthorized
    ? '第 ' + round + ' 轮（显式授权续轮，上限 ' + REENTRY_ROUND_LIMIT + '）'
    : '第 ' + round + '/' + REENTRY_ROUND_LIMIT + ' 轮';
  console.log('REENTRY: archive → ' + decision.target + '（授权源 ' + source + '；' + roundLabel
    + '；备份 ' + backupRecord + '）');
  console.log('REASON: ' + reason);
  return;
}

// replan <reason> --authorized-by <source> [--continue-round <n>]
// 受控计划重校重签（ADR-013）：计划在执行中被证明有缺陷时，唯一合规的重签入口——只在
// execute / subagent-execute 相位可用、停原位（不跳节点、不改 completedNodes），先把任务集
// 重新校验（依赖图 + 任务字段，绝不豁免）再重录 state.taskHash。编排顺序与 reenter 同构：
// 参数防护 → 读 state → 单一权威判定（相位/change → 授权 → 上限与续轮 → 幂等空操作）→
// 重校 → 备份（sha256）→ 重签 → 双写留痕 → REPLAN/REASON 行。
export async function runReplan(protocol, argv) {
  const replanUsage = '用法: workflow-state.mjs replan <reason> --authorized-by <source> [--continue-round <n>]';
  const replanReason = argv[3];
  if (typeof replanReason !== 'string' || replanReason.trim() === '' || replanReason.startsWith('--')) {
    console.error('BLOCKED: replan 缺少原因（位置参数 <reason> 必填且非空）。' + replanUsage);
    process.exit(1);
  }
  const reason = replanReason.trim();
  let authorizedBy = null;
  let continuationRound = null;
  const replanArgs = argv.slice(4);
  for (let index = 0; index < replanArgs.length; index += 1) {
    const arg = replanArgs[index];
    // 支持 --name value 与 --name=value 两种形态；--protocol 为全局参数（协议路径已由
    // resolveProtocol 统一解析），命令面只做占位透传。
    let key = arg;
    let value = null;
    if (typeof arg === 'string' && arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        key = arg.slice(0, eq);
        value = arg.slice(eq + 1);
      }
    }
    if (key === '--protocol') {
      if (value === null) index += 1;
      continue;
    }
    if (key === '--continue-round') {
      // 续轮授权只在达到轮次上限后生效：命令面收正整数，形态合法性与「是否已到上限」由
      // 单一权威综合判定裁决（本处只做数值形态防护，fail-closed，先于任何读盘）。
      let consumedNext = false;
      if (value === null) {
        value = replanArgs[index + 1];
        consumedNext = true;
      }
      const parsedRound = typeof value === 'string' && value.trim() !== '' && !value.startsWith('--')
        ? Number(value.trim())
        : Number.NaN;
      if (!Number.isInteger(parsedRound) || parsedRound <= 0) {
        console.error('BLOCKED: replan --continue-round 需要正整数取值，实际 ' + JSON.stringify(value) + '。' + replanUsage);
        process.exit(1);
      }
      continuationRound = parsedRound;
      if (consumedNext) index += 1;
      continue;
    }
    if (key === '--authorized-by') {
      let consumedNext = false;
      if (value === null) {
        value = replanArgs[index + 1];
        consumedNext = true;
      }
      // 缺值 / 空值 / 纯空白 / 取下个选项名当值 → 一律用法错误（fail-closed，先于任何读盘）
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
        console.error('BLOCKED: replan --authorized-by 需要非空取值。' + replanUsage);
        process.exit(1);
      }
      authorizedBy = value.trim();
      if (consumedNext) index += 1;
      continue;
    }
    console.error('BLOCKED: replan 未知参数 ' + JSON.stringify(arg) + '。' + replanUsage);
    process.exit(1);
  }
  if (authorizedBy === null) {
    console.error('BLOCKED: replan 需要显式授权 --authorized-by <source>（授权不可自决）。' + replanUsage);
    process.exit(1);
  }
  const state = await readState();
  const badFields = validateStateFields(state);
  if (badFields.length > 0) {
    // history 存在但非数组等类型损坏在此 fail-closed：不得由本命令静默清空覆盖审计历史。
    console.error('BLOCKED: state 字段类型非法: ' + badFields[0]);
    process.exit(1);
  }
  // 原始 state（未经 readState 兼容默认值叠加）：备份取文件原始字节，落盘只写「原始键集 +
  // 本次实际改动的字段」——兼容默认值不得随重校回写（与受控重入同纪律）。
  const rawState = (await fileExists(stateFile())) ? await readJson(stateFile()) : null;
  const changeName = typeof state.activeChange === 'string' ? state.activeChange : '';
  // 任务内容读取（fail-closed）：不可读 / 为空 → 交由综合判定返回 task-content-missing
  // block（缺 TASK.md 时不得以「空任务集签名」判幂等空操作放行）。
  let taskContent = null;
  try {
    taskContent = await fs.readFile(protocolTaskFilePath(protocol, changeName, specsDir()), 'utf8');
  } catch { taskContent = null; }
  // 授权形态的 round / at 由引擎派生（命令面只承载授权来源、原因与上限后的续轮轮次）：普通
  // 轮次以合法占位值过形态门；落盘轮次一律取综合判定返回的 round（由本 change 历史事件派生），
  // 不在此内联第二份轮次推导。
  const authorizedAt = new Date().toISOString();
  const decision = resolveReplanDecision({
    protocol,
    state,
    authorization: { round: 1, at: authorizedAt, source: authorizedBy, reason, node: state.currentNode },
    continuationRound,
    taskContent,
  });
  if (!decision.ok) {
    if (decision.reason === 'round-limit-reached') {
      console.error('BLOCKED: 本 change 计划重校已达上限（' + decision.used + '/' + decision.limit
        + ' 轮）。需要人工裁决：继续（显式授权后在同一命令加 --continue-round <n>，n 为不小于第 '
        + (decision.used + 1) + ' 轮的正整数，须与 --authorized-by / <reason> 同次传入）/ 停止（保持现状，不再重校）。');
      process.exit(1);
    }
    const replanGuidance = {
      'no-active-change': '当前没有活跃 change（activeChange 缺失或为空）——先 select <change-id>',
      'change-name-invalid': 'change 名非法 ' + JSON.stringify(changeName)
        + '——必须是 .specs/ 下的单段目录名（拒绝路径分隔符、. / .. 与保留目录 archive）',
      'phase-not-allowed': 'replan 只在 execute / subagent-execute 相位可用（当前节点 '
        + JSON.stringify(state.currentNode) + '）——其余相位请走既有推进 / 受控重入通道',
      'continuation-not-required': '--continue-round 只在达到轮次上限后需要（当前 ' + decision.used + '/'
        + decision.limit + ' 轮）——上限前请直接以 --authorized-by / <reason> 发起',
      'task-content-missing': '任务内容缺失或不可读（.specs/<change>/TASK.md 不存在 / 为空）——按 fail-closed 拒绝重签',
    }[decision.reason] || ('授权形态不合法（' + decision.reason + '）——需要用户显式传入 --authorized-by <source>');
    console.error('BLOCKED: ' + replanGuidance);
    process.exit(1);
  }
  if (decision.action === 'noop') {
    console.log('REPLAN: 空操作——state.taskHash 已与当前 TASK.md 同签（' + decision.node
      + '），无需重校；未备份、未计数、未写事件、未改写 state。');
    return;
  }
  if (decision.action !== 'apply') {
    console.error('BLOCKED: replan 判定返回未知动作 ' + JSON.stringify(decision.action) + '——按 fail-closed 拒绝。');
    process.exit(1);
  }
  // 重校（ADR-013 决策 3：replan 绝不做校验豁免）：任务块 / <verify> / 任务图（依赖环与
  // 缺失依赖——analyzeDependencyGraph 单一实现，与 plan 出口同源）/ 7 字段完整性。任一失败
  // → BLOCK，状态零改写（本段全部先于备份与写盘）。
  const taskList = taskBlocks(taskContent);
  if (taskList.length === 0) {
    console.error('BLOCKED: TASK.md 无 <task> 块——replan 不做校验豁免，拒绝重签（状态零改写）。');
    process.exit(1);
  }
  const missingVerify = taskList.filter((block) => !/<verify>/.test(block));
  if (missingVerify.length > 0) {
    console.error('BLOCKED: TASK.md 中 ' + missingVerify.length
      + ' 个 task 缺 <verify> 字段——replan 不做校验豁免，拒绝重签（状态零改写）。');
    process.exit(1);
  }
  const depGraph = analyzeDependencyGraph(taskList);
  if (depGraph.cyclic || depGraph.missing.length > 0) {
    const detail = depGraph.cyclic
      ? '依赖环（拓扑排序无解，涉及任务: ' + depGraph.cycleIds.join(', ') + '）'
      : '依赖不存在的任务: ' + depGraph.missing.map((m) => m.id + '→' + m.dep).join(', ');
    console.error('BLOCKED: TASK.md ' + detail
      + '——依赖图不可满足（任务的依赖链必须存在且无环）；replan 不做校验豁免，拒绝重签（状态零改写）'
      + '；恢复: 调整任务 depends_on——移除成环引用或改为真实存在的任务 id 后重试');
    process.exit(1);
  }
  // 任务字段完整性（与 plan 出口同一判据）：新模板形态（含 <name>）且新 change → BLOCK；
  // 旧式一字段形态 / 旧 change 保持渐进 WARN（不放大既有语义）。
  const replanTask7Required = ['name', 'read_files', 'write_files', 'action', 'verify', 'done', 'depends_on'];
  const replanTask7NewFormat = taskList.some((block) => /<name\b/i.test(block));
  const replanTask7Broken = [];
  for (const block of taskList) {
    const missing = replanTask7Required.filter((field) => !new RegExp('</?' + field + '\\b', 'i').test(block));
    if (missing.length > 0) {
      const idAttr = (taskOpeningAttrs(block) || {}).id || '?';
      replanTask7Broken.push((idAttr !== '?' ? idAttr + ' ' : '') + '缺 ' + missing.join('/'));
    }
  }
  if (replanTask7Broken.length > 0) {
    if (replanTask7NewFormat && state.newChange === true) {
      // 文案的集合字符串**从判据常量派生**（不得在此再写一遍字面集合——第二处同口径表达会在
      // 判据演进时静默落后于实现；构造方式不改变渲染结果）。
      console.error('BLOCKED: TASK.md 任务缺 7 字段（' + replanTask7Required.join('/') + '）: '
        + replanTask7Broken.join('; ') + '；恢复: 对照 flow-kit/templates/TASK.md 补齐每个 <task> 的缺字段后重试；replan 不做校验豁免');
      process.exit(1);
    }
    console.error('TASK-7FIELD WARN: TASK.md ' + replanTask7Broken.join('; ')
      + (replanTask7NewFormat ? '（旧 change 渐进，不阻断）' : '（旧式一字段模板形态，渐进不阻断）'));
  }
  // 路径边界：change 名必须是 .specs/ 下的单段真实目录（realpath 归一后仍在 .specs/ 内、
  // 无 symlink/junction 逃逸；复用受控路径边界实现）——备份落点必须先通过该边界。
  const changeBoundary = await inspectReentryChangeDir(changeName);
  if (!changeBoundary.ok) {
    const boundaryMessages = {
      'no-active-change': '当前没有活跃 change（activeChange 缺失或为空）——先 select <change-id>',
      'change-name-invalid': 'change 名非法 ' + JSON.stringify(changeName)
        + '——必须是 .specs/ 下的单段目录名（拒绝路径分隔符、. / .. 与保留目录 archive）',
      'change-dir-missing': '.specs/' + (changeName || '<未知>') + '/ 目录不存在——重校备份必须具备真实 change 目录落点',
      'change-dir-escape': 'change 目录路径越界或跨越符号链接 / junction（' + changeBoundary.detail
        + '）——受控重校与备份只允许落在 .specs/<change-id>/ 真实目录内',
    };
    console.error('BLOCKED: ' + (boundaryMessages[changeBoundary.reason] || ('change 目录边界异常（' + changeBoundary.reason + '）')));
    process.exit(1);
  }
  const changeDir = changeBoundary.changeDir;
  // 并行写冲突校验：replan 不做校验豁免——重校后的任务集若含
  // 本趟可运行（依赖已满足）的并行任务且 write_files 重叠，与 plan 出口使用同一实现
  // （route-node.findParallelWriteConflicts 单一来源）在此 BLOCK；必须早于备份与任何写盘，
  // BLOCK 路径 state 字节零改写。read∩write 弱判与 plan 出口同风格——仅 WARN 不阻断。
  // 同文件跨任务且无依赖路径（第三族）同样在此消费：与 plan 出口同判据、同分级（新 change
  // BLOCKED / 旧 change WARN），消息同族（任务对 `a×b(files)` + 恢复指引「补显式 depends_on 或
  // 合并为一个任务」）——replan 是执行期唯一合法的任务集修订通道，不得成为该形态的豁免口。
  const { writeConflicts, crossTaskConflicts, readWarnings } = await findParallelWriteConflicts(path.join(specsDir(), changeName));
  if (writeConflicts.length > 0) {
    console.error('BLOCKED: replan 检测到并行写冲突（'
      + writeConflicts.map((c) => c.a + '↔' + c.b + ': ' + c.files.join(',')).join('; ')
      + '）——replan 不做校验豁免，状态零改写；恢复: 调整 write_files 消除重叠后重试');
    process.exit(1);
  }
  if (crossTaskConflicts.length > 0) {
    const crossDetail = crossTaskConflicts.map((c) => c.a + '×' + c.b + '(' + c.files.join(',') + ')').join('; ');
    const crossGuide = '；恢复: 补显式 depends_on 或合并为一个任务后重试';
    if (state.newChange === true) {
      console.error('BLOCKED: TASK.md 同文件跨任务且无依赖路径: ' + crossDetail
        + '——replan 不做校验豁免，状态零改写' + crossGuide);
      process.exit(1);
    }
    console.error('WARN: TASK.md 同文件跨任务且无依赖路径（旧 change 渐进不阻断）: ' + crossDetail + crossGuide);
  }
  if (readWarnings.length > 0) {
    console.error('WARN: TASK.md 并行任务 read∩write 隐式依赖嫌疑（一方读取对方写路径，建议补显式 depends_on 声明）: '
      + readWarnings.map((c) => c.a + '×' + c.b + '(' + c.files.join(',') + ')').join('; '));
  }
  const round = decision.round;
  const source = decision.authorization.source;
  const at = decision.authorization.at;
  const continuationAuthorized = decision.continuationAuthorized === true;
  const taskSetSignatureValue = decision.taskSetSignature;
  if (typeof taskSetSignatureValue !== 'string' || taskSetSignatureValue === '') {
    console.error('BLOCKED: replan 未能派生当前任务集签名——按 fail-closed 拒绝（状态零改写）。');
    process.exit(1);
  }
  // 备份：重签前 state 全量快照（文件原始字节，UTF-8 BOM 按可解析形态落盘）；文件名
  // <UTC ISO 净化>-pre-replan.json；审计指纹 = 备份文件字节的 sha256（可核验）。
  const backupDir = path.join(changeDir, 'replan-backups');
  const backupFile = at.replace(/:/g, '-') + '-pre-replan.json';
  const backupPath = path.join(backupDir, backupFile);
  const backupRecord = path.relative(runRootDir(), backupPath).split(path.sep).join('/');
  const snapshotBytes = Buffer.from((await fs.readFile(stateFile(), 'utf8')).replace(/^\uFEFF/, ''), 'utf8');
  const fingerprint = createHash('sha256').update(snapshotBytes).digest('hex');
  const existingHistory = Array.isArray(rawState?.history) ? rawState.history : [];
  let backupWritten = false;
  try {
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
      throw new Error('state 文件缺失或形态非法，无法重校重签');
    }
    // 备份写入路径的物理包含性复核（单一权威路径段扫描）：备份目录与备份文件逐段
    // lstat + realpath——任何 symlink/junction 逃出 .specs/ 一律拒绝，不写任何字节。
    await fs.mkdir(backupDir, { recursive: true });
    await inspectWorkflowPathSegments(specsDir(), backupDir, 'replan backup dir', 'directory');
    await fs.writeFile(backupPath, snapshotBytes);
    backupWritten = true;
    await inspectWorkflowPathSegments(specsDir(), backupPath, 'replan backup file', 'file');
    // 双写留痕（ADR-013 决策 8）：① evidence.<node>.replanAuthorization（节点级授权 + 备份
    // 指纹）；② history 追加 replan-applied（跨 change 审计检索）。落盘形态 = 原始 state
    // 键集 + 本次实际改动的三处（taskHash / evidence / history），其余字段逐项不变。
    const existingEvidence = rawState.evidence && typeof rawState.evidence === 'object' && !Array.isArray(rawState.evidence)
      ? rawState.evidence
      : {};
    const nodeEvidence = existingEvidence[decision.node]
      && typeof existingEvidence[decision.node] === 'object'
      && !Array.isArray(existingEvidence[decision.node])
      ? existingEvidence[decision.node]
      : {};
    const authorizationRecord = {
      round,
      at,
      source,
      reason,
      backup: backupRecord,
      fingerprint,
      ...(continuationAuthorized ? { continuationAuthorized: true } : {}),
    };
    const persisted = { ...rawState };
    persisted.taskHash = taskSetSignatureValue;
    persisted.evidence = {
      ...existingEvidence,
      [decision.node]: { ...nodeEvidence, replanAuthorization: authorizationRecord },
    };
    persisted.history = existingHistory.concat([{
      event: 'replan-applied',
      change: changeName,
      node: decision.node,
      round,
      reason,
      authorizedBy: source,
      taskSetSignature: taskSetSignatureValue,
      backup: backupRecord,
      fingerprint,
      at,
      ...(continuationAuthorized ? { continuationAuthorized: true } : {}),
    }]);
    const persistedBad = validateStateFields(persisted);
    if (persistedBad.length > 0) throw new Error('state 字段类型非法: ' + persistedBad[0]);
    await writeState(persisted);
  } catch (error) {
    // 写盘失败：回滚本次调用创建的孤儿备份（state 由原子写保证不被截断），原始错误照常上抛。
    if (backupWritten) {
      try { await fs.rm(backupPath, { force: true }); } catch { /* 清理失败不掩盖原始错误 */ }
    }
    throw error;
  }
  const roundLabel = continuationAuthorized
    ? '第 ' + round + ' 轮（显式授权续轮，上限 ' + REPLAN_ROUND_LIMIT + '）'
    : '第 ' + round + '/' + REPLAN_ROUND_LIMIT + ' 轮';
  console.log('REPLAN: ' + decision.node + ' 重新校验通过（授权源 ' + source + '；' + roundLabel
    + '；备份 ' + backupRecord + '）');
  console.log('REASON: ' + reason);
  return;
}
