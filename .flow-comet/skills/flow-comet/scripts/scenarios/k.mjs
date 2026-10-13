// 场景组 k — 受控重入 · 计划重校重签 · 强制推进留痕
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';
import {
  assertExit,
  assertNotOut,
  assertOut,
  baseState,
  runGuard,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  CROSS_TASK_FIX_PAIR,
  CROSS_TASK_FIX_SECTION_PAIR,
  CROSS_TASK_MIXED_PAIR,
  CROSS_TASK_PLAIN_PAIR,
  FIX_PREFIX_LITERAL_TEXT,
  GUARD,
  SCRIPTS_DIR,
  STATE,
  TASK_DEP_CYCLE,
  TASK_MISSING_DEP,
  TASK_PARALLEL_READ_OVERLAP,
  TASK_PARALLEL_WRITE_CONFLICT,
  customProtocol,
  engineScriptFiles,
  fixFamilyBoundaryProblems,
  runPlanExit,
  strictSummary,
  writeIntakeArtifacts,
} from '../lib/test-fixtures.mjs';
import {
  REENTRY_EXPECTED_INTERSECTION,
  REENTRY_FULL_COMPLETED,
  REPLAN_STALE_SIGNATURE,
  REPLAN_TASK_INITIAL,
  REPLAN_TASK_NO_VERIFY,
  REPLAN_TASK_REVISED,
  advanceForcedEvent,
  assertOutMatches,
  assertReentryAuthorizationShape,
  assertReplanAuthorizationShape,
  assertReplanSignatureRecorded,
  assertStateBytesUnchanged,
  outputText,
  parseStatusJson,
  readScenarioProtocol,
  readScenarioState,
  readStateBytes,
  reentryArchiveState,
  reentryBackupFiles,
  reentryHistoryEvent,
  replanBackupFiles,
  replanEventsOf,
  replanExecuteState,
  replanHistoryEvent,
  requireRouteNodeExport,
  runReenter,
  runStateWithProtocol,
  writeReentryChangeDir,
} from '../lib/test-assertions.mjs';

export const ENTRIES = [

  // 259: 受控重入正例（AC-1 / AC-10）——archive 已 entry + 归档目录仍在原位 + 完整授权
  // 三元组 → 一次调用完成：备份落盘（全量快照 + 可核验 sha256 指纹）→ 转移落地
  // （currentNode=target / completedNodes=前驱交集 / status=running）→ 审计事件（含 change
  // 归属与授权留痕）→ 可审计的 REENTRY 行。
  {
    name: '259 受控重入正例：archive → verify 备份·转移·审计事件·授权留痕全链路',
    run: (dir) => {
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState());
      const beforeState = readScenarioState(dir);
      const res = runReenter(dir, 'verify', { source: 'user-approval', reason: '归档后发现缺陷，需回到验证节点' });
      assertExit(res, 0);
      assertOut(res, 'REENTRY');
      assertOut(res, 'archive');
      assertOut(res, 'verify');
      assertOut(res, '1/3');
      assertOut(res, 'user-approval');
      assertOut(res, 'REASON: 归档后发现缺陷，需回到验证节点');
      const st = readScenarioState(dir);
      if (st.currentNode !== 'verify') {
        throw new Error('转移应把 currentNode 置为 target(verify)，实际 ' + JSON.stringify(st.currentNode));
      }
      if (!isDeepStrictEqual(st.completedNodes, REENTRY_EXPECTED_INTERSECTION.verify)) {
        throw new Error('completedNodes 应为前驱交集 ' + JSON.stringify(REENTRY_EXPECTED_INTERSECTION.verify)
          + '，实际 ' + JSON.stringify(st.completedNodes));
      }
      if (st.status !== 'running') {
        throw new Error('重入应把 status 置为 running，实际 ' + JSON.stringify(st.status));
      }
      // 除四类机器字段与 evidence（授权留痕）外，state 其余字段逐项不变、不得新增/删除
      const mutable = new Set(['currentNode', 'completedNodes', 'status', 'history', 'evidence']);
      for (const key of Object.keys(st)) {
        if (mutable.has(key)) continue;
        if (!isDeepStrictEqual(beforeState[key], st[key])) {
          throw new Error('受控重入不得改写 ' + key + '：before=' + JSON.stringify(beforeState[key])
            + ' after=' + JSON.stringify(st[key]));
        }
      }
      for (const key of Object.keys(beforeState)) {
        if (!(key in st)) throw new Error('受控重入不得删除 state 字段: ' + key);
      }
      // history：旧前缀逐字稳定 + 恰新增一条 reentry-applied
      const history = Array.isArray(st.history) ? st.history : [];
      if (history.length !== beforeState.history.length + 1) {
        throw new Error('history 应恰新增 1 条，实际新增 ' + (history.length - beforeState.history.length)
          + '：' + JSON.stringify(history.slice(beforeState.history.length)));
      }
      if (!isDeepStrictEqual(history.slice(0, beforeState.history.length), beforeState.history)) {
        throw new Error('history 旧前缀被改写（既有事件必须逐字稳定）');
      }
      const event = history[history.length - 1];
      if (!event || event.event !== 'reentry-applied') {
        throw new Error('新增 history 事件应为 reentry-applied：' + JSON.stringify(event));
      }
      if (event.from !== 'archive' || event.to !== 'verify') {
        throw new Error('审计事件应记录 from=archive / to=verify，实际 '
          + JSON.stringify({ from: event.from, to: event.to }));
      }
      if (event.round !== 1) {
        throw new Error('首次重入轮次应为 1，实际 ' + JSON.stringify(event.round));
      }
      if (event.change !== CHANGE_ID) {
        throw new Error('reentry-applied 事件必须带 change 字段（跨 change 轮次隔离的唯一依据），实际 '
          + JSON.stringify(event.change));
      }
      if (typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at))) {
        throw new Error('审计事件应带可解析的 at 时间戳，实际 ' + JSON.stringify(event.at));
      }
      const authorization = event.authorization;
      if (!authorization || authorization.round !== 1 || authorization.source !== 'user-approval'
        || authorization.target !== 'verify'
        || typeof authorization.at !== 'string' || authorization.at.trim() === '') {
        throw new Error('审计事件 authorization 记录不完整（round / at / source / target 与本次调用绑定）：'
          + JSON.stringify(authorization));
      }
      if (typeof event.backup !== 'string' || event.backup.trim() === '') {
        throw new Error('审计事件应记录备份路径，实际 ' + JSON.stringify(event.backup));
      }
      if (typeof event.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(event.fingerprint)) {
        throw new Error('审计事件应记录 sha256 指纹（64 位小写十六进制），实际 ' + JSON.stringify(event.fingerprint));
      }
      // 授权嵌套留痕（evidence.<target>.reentryAuthorization）
      const record = st.evidence?.verify?.reentryAuthorization;
      if (!record) {
        throw new Error('evidence.verify.reentryAuthorization 授权留痕缺失：' + JSON.stringify(st.evidence));
      }
      if (record.round !== 1 || record.source !== 'user-approval' || record.target !== 'verify'
        || typeof record.at !== 'string' || record.at.trim() === '') {
        throw new Error('授权留痕字段不完整：' + JSON.stringify(record));
      }
      if (record.backup !== event.backup || record.fingerprint !== event.fingerprint) {
        throw new Error('授权留痕的 backup / fingerprint 应与审计事件一致：' + JSON.stringify({ record, event }));
      }
      // --reason 必须落盘（事件 + 嵌套授权记录）：只打印不落盘的必填参数无法支撑事后审计追溯
      if (event.reason !== '归档后发现缺陷，需回到验证节点') {
        throw new Error('审计事件应记录本次 --reason（可追溯），实际 ' + JSON.stringify(event.reason));
      }
      if (record.reason !== event.reason) {
        throw new Error('授权留痕的 reason 应与审计事件逐字一致：' + JSON.stringify({ record: record.reason, event: event.reason }));
      }
      // 备份：路径形态 + 全量快照语义 + 指纹可核验
      const backupPath = path.isAbsolute(event.backup) ? event.backup : path.join(dir, event.backup);
      if (!fs.existsSync(backupPath)) {
        throw new Error('备份文件不在场：' + backupPath);
      }
      const backupRel = path.relative(dir, backupPath).split(path.sep).join('/');
      if (!backupRel.startsWith('.specs/' + CHANGE_ID + '/.reentry-backups/')
        || !/-pre-verify\.json$/.test(path.basename(backupPath))) {
        throw new Error('备份路径应符合 .specs/<id>/.reentry-backups/<ISO>-pre-<target>.json，实际 ' + backupRel);
      }
      const backupBytes = fs.readFileSync(backupPath);
      const fingerprint = createHash('sha256').update(backupBytes).digest('hex');
      if (fingerprint !== event.fingerprint) {
        throw new Error('备份指纹与文件内容不一致（AC-9 可核验）：事件=' + event.fingerprint + ' 实算=' + fingerprint);
      }
      if (!isDeepStrictEqual(JSON.parse(backupBytes.toString('utf8')), beforeState)) {
        throw new Error('备份应为重入前 state 的全量快照');
      }
    },
  },

  // 260: 授权门禁 fail-closed（AC-2）——缺授权 / source 空串 / source 纯空白 → BLOCK、
  // state 字节零改写、零备份、零事件；授权形态（round 正整数、at / source 非空字符串、
  // target 与授权一致）由 route-node 纯函数单一权威判定（形态锚 + 合法形态放行对照）。
  {
    name: '260 授权 fail-closed：缺授权·空/纯空白 source BLOCK 零改写 + 形态纯函数锚',
    run: (dir) => {
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState());
      const bytes = readStateBytes(dir);
      const blockedCases = [
        ['缺授权（无 --authorized-by / --reason）', () => runReenter(dir, 'verify')],
        ['source 空串', () => runReenter(dir, 'verify', { source: '', reason: 'x' })],
        ['source 纯空白', () => runReenter(dir, 'verify', { source: '   ', reason: 'x' })],
      ];
      for (const [label, call] of blockedCases) {
        const res = call();
        assertExit(res, 1);
        assertOut(res, 'BLOCKED');
        assertStateBytesUnchanged(dir, bytes, label);
      }
      if (reentryBackupFiles(dir).length !== 0) {
        throw new Error('授权非法路径不得产生备份：' + JSON.stringify(reentryBackupFiles(dir)));
      }
      const st = readScenarioState(dir);
      const reentryEvents = (st.history || []).filter((e) => e.event === 'reentry-applied');
      if (reentryEvents.length !== 0) {
        throw new Error('授权非法路径不得写审计事件：' + JSON.stringify(reentryEvents));
      }
      // 授权形态纯函数锚：malformed 一律 ok:false，合法 ok:true（放行侧对照）
      const valid = { round: 1, at: '2026-09-20T00:00:00.000Z', source: 'user-approval', target: 'verify' };
      assertReentryAuthorizationShape(valid, 'verify', true, '合法三元组');
      const malformed = [
        ['缺 authorization', undefined],
        ['round=0', { ...valid, round: 0 }],
        ['round=-1', { ...valid, round: -1 }],
        ['round=1.5 非整数', { ...valid, round: 1.5 }],
        ['round="1" 类型错误', { ...valid, round: '1' }],
        ['round 缺失', { ...valid, round: undefined }],
        ['at=42 类型错误', { ...valid, at: 42 }],
        ['at 空串', { ...valid, at: '' }],
        ['at 纯空白', { ...valid, at: '  ' }],
        ['at 缺失', { ...valid, at: undefined }],
        ['source=[] 类型错误', { ...valid, source: [] }],
        ['source 空串', { ...valid, source: '' }],
        ['source 纯空白', { ...valid, source: '  ' }],
        ['source 缺失', { ...valid, source: undefined }],
        ['target 与授权不一致', { ...valid, target: 'execute' }],
      ];
      for (const [label, authorization] of malformed) {
        assertReentryAuthorizationShape(authorization, 'verify', false, label);
      }
      // 综合判定：archive 源 + 合法 target + 形态非法授权 → block（不抛异常），合法 → apply
      const decide = requireRouteNodeExport('resolveReentryDecision');
      const protocol = readScenarioProtocol(dir);
      const decideState = {
        activeChange: CHANGE_ID,
        currentNode: 'archive',
        completedNodes: [...REENTRY_FULL_COMPLETED],
        history: [],
      };
      for (const [label, authorization] of malformed) {
        const decision = decide({ protocol, state: decideState, target: 'verify', authorization });
        if (!decision || decision.ok !== false || decision.action !== 'block') {
          throw new Error('[' + label + '] resolveReentryDecision 应返回 block，实际 ' + JSON.stringify(decision));
        }
      }
      const applied = decide({ protocol, state: decideState, target: 'verify', authorization: valid });
      if (!applied || applied.ok !== true || applied.action !== 'apply' || applied.round !== 1) {
        throw new Error('合法授权 + archive 源应返回 apply / 第 1 轮，实际 ' + JSON.stringify(applied));
      }
    },
  },

  // 261a: 越界拦截（AC-5 / AC-6 / AC-7）——目标不在白名单 / 协议 disabled 节点 / 源不是 archive /
  // status=completed：一律 BLOCK 且 state 字节零改写。
  {
    name: '261a 受控重入越界：目标白名单 / disabled 节点 / 源非 archive / completed 全 BLOCK 零改写',
    run: (dir) => {
      writeReentryChangeDir(dir);
      // ① 目标不在白名单（design / open / archive 自身）
      for (const target of ['design', 'open', 'archive']) {
        writeReentryChangeDir(dir);
        writeState(dir, reentryArchiveState());
        const bytes = readStateBytes(dir);
        const res = runReenter(dir, target, { source: 'user-approval', reason: 'x' });
        assertExit(res, 1);
        assertOut(res, 'BLOCKED');
        assertStateBytesUnchanged(dir, bytes, '目标越界: ' + target);
      }
      // ② 协议 disabled 节点不可作目标（自定义协议禁用 verify）
      const customProtocolPath = path.join(dir, 'reentry-protocol-disabled.json');
      const customProtocol = readScenarioProtocol(dir);
      customProtocol.nodes.find((n) => n.id === 'verify').disabled = true;
      writeFile(dir, 'reentry-protocol-disabled.json', JSON.stringify(customProtocol, null, 2) + '\n');
      writeState(dir, reentryArchiveState());
      const bytesDisabled = readStateBytes(dir);
      const resDisabled = runReenter(dir, 'verify', {
        source: 'user-approval', reason: 'x', extra: ['--protocol', customProtocolPath],
      });
      assertExit(resDisabled, 1);
      assertOut(resDisabled, 'BLOCKED');
      assertStateBytesUnchanged(dir, bytesDisabled, '协议 disabled 节点');
      // ③ 源不是 archive（execute 驻留；目标 verify 形态未成立 → 不被空操作短路）
      writeState(dir, reentryArchiveState({ currentNode: 'execute' }));
      const bytesSource = readStateBytes(dir);
      const resSource = runReenter(dir, 'verify', { source: 'user-approval', reason: 'x' });
      assertExit(resSource, 1);
      assertOut(resSource, 'BLOCKED');
      assertStateBytesUnchanged(dir, bytesSource, '源不是 archive');
      // ④ status=completed（归档已出口 / 已发布形态）→ BLOCK + 人工处置或新 change 指引
      writeState(dir, reentryArchiveState({ status: 'completed' }));
      const bytesCompleted = readStateBytes(dir);
      const resCompleted = runReenter(dir, 'verify', { source: 'user-approval', reason: 'x' });
      assertExit(resCompleted, 1);
      assertOut(resCompleted, 'BLOCKED');
      assertOutMatches(resCompleted, /人工|新 ?change|hotfix/, 'status=completed 指引');
      assertStateBytesUnchanged(dir, bytesCompleted, 'status=completed');
    },
  },

  // 261b: 轮次族——归档移动已发生 / 超轮次上限（本 change 3 条事件后第 4 次）/ 轮次按 change 隔离
  // （他 change 的历史事件不占本 change 配额）——同族同时断言 BLOCK 与放行两态。
  {
    name: '261b 受控重入轮次：归档移动已发生 / 超上限 BLOCK + 跨 change 隔离放行',
    run: (dir) => {
      writeReentryChangeDir(dir);
      // ⑤ 归档移动已发生（.specs/<id>/ 不在原位，已搬入 .specs/archive/<日期>-<id>/）
      fs.rmSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true, force: true });
      writeFile(dir, '.specs/archive/2026-09-26-' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n已归档。\n');
      writeState(dir, reentryArchiveState());
      const bytesMoved = readStateBytes(dir);
      const resMoved = runReenter(dir, 'verify', { source: 'user-approval', reason: 'x' });
      assertExit(resMoved, 1);
      assertOut(resMoved, 'BLOCKED');
      assertOutMatches(resMoved, /人工|新 ?change|hotfix/, '归档移动已发生指引');
      assertStateBytesUnchanged(dir, bytesMoved, '归档移动已发生');
      // ⑥ 超轮次上限：本 change 已有 3 条 reentry-applied → 第 4 次 BLOCK + 「继续 / 停止」指引
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState({
        history: [reentryHistoryEvent(1), reentryHistoryEvent(2), reentryHistoryEvent(3)],
      }));
      const bytesCapped = readStateBytes(dir);
      const resCapped = runReenter(dir, 'verify', { source: 'user-approval', reason: 'x' });
      assertExit(resCapped, 1);
      assertOut(resCapped, 'BLOCKED');
      assertOut(resCapped, '继续');
      assertOut(resCapped, '停止');
      assertStateBytesUnchanged(dir, bytesCapped, '超轮次上限');
      // ⑦ 轮次跨 change 隔离：他 change 的 3 条事件不占本 change 配额 → 放行且为第 1 轮
      writeState(dir, reentryArchiveState({
        history: [
          reentryHistoryEvent(1, 'other-change'),
          reentryHistoryEvent(2, 'other-change'),
          reentryHistoryEvent(3, 'other-change'),
        ],
      }));
      const resIsolated = runReenter(dir, 'verify', { source: 'user-approval', reason: 'x' });
      assertExit(resIsolated, 0);
      assertOut(resIsolated, '1/3');
      const isolatedState = readScenarioState(dir);
      const appliedEvent = (isolatedState.history || [])
        .find((e) => e.event === 'reentry-applied' && e.change === CHANGE_ID);
      if (!appliedEvent || appliedEvent.round !== 1) {
        throw new Error('他 change 的轮次事件不应占用本 change 配额（本 change 应为第 1 轮），实际 '
          + JSON.stringify(appliedEvent));
      }
    },
  },

  // 261c: 换键绕过族——select 拒绝多段路径 / 保留目录名 / 大小写与首尾空白变体；change 键被换成
  // 归档相对路径时写盘前 BLOCK；history 非数组 fail-closed（不得静默清空审计历史）。
  {
    name: '261c 受控重入换键绕过：select 变体拒绝 / 相对路径 change 名 / 损坏 history 全 BLOCK',
    run: (dir) => {
      writeReentryChangeDir(dir);
      // select 族的前置：本 change 处于 archive 源可重入态（与 261b 的放行态同一形态）
      writeState(dir, reentryArchiveState());
      // ⑧ select 入口收紧：多段路径（归档相对路径形态）与保留目录名不得被选为 activeChange
      fs.mkdirSync(path.join(dir, '.specs', 'archive', '2026-09-26-' + CHANGE_ID), { recursive: true });
      const beforeSelect = readStateBytes(dir);
      assertExit(runStateWithProtocol(dir, ['select', 'archive/2026-09-26-' + CHANGE_ID]), 1);
      assertStateBytesUnchanged(dir, beforeSelect, 'select 归档相对路径');
      assertExit(runStateWithProtocol(dir, ['select', 'archive']), 1);
      assertStateBytesUnchanged(dir, beforeSelect, 'select 保留目录名');
      // ⑧b 名字变体族：保留目录名大小写变体（ARCHIVE/Archive）、真实目录名的大小写变体（CH）与
      // 首尾空白变体在大小写不敏感文件系统上同样可达，但会让 activeChange 与实际目录名不一致
      // （轮次事件按 activeChange 精确匹配 → 配额被换键重置）→ 一律拒绝且 state 字节零改写
      assertExit(runStateWithProtocol(dir, ['select', 'ARCHIVE']), 1);
      assertStateBytesUnchanged(dir, beforeSelect, 'select 保留目录名大小写变体');
      assertExit(runStateWithProtocol(dir, ['select', 'Archive']), 1);
      assertStateBytesUnchanged(dir, beforeSelect, 'select 保留目录名混合大小写变体');
      const caseVariant = String(CHANGE_ID).toUpperCase();
      if (caseVariant !== CHANGE_ID) {
        assertExit(runStateWithProtocol(dir, ['select', caseVariant]), 1);
        assertStateBytesUnchanged(dir, beforeSelect, 'select 真实目录名大小写变体');
      }
      assertExit(runStateWithProtocol(dir, ['select', ' ' + CHANGE_ID + ' ']), 1);
      assertStateBytesUnchanged(dir, beforeSelect, 'select 首尾空白变体');
      if (readScenarioState(dir).activeChange !== CHANGE_ID) {
        throw new Error('被拒绝的 select 不得改写 activeChange：' + JSON.stringify(readScenarioState(dir).activeChange));
      }
      // ⑨ change 键被换成归档相对路径（换键重置轮次配额的绕过形态）→ 写盘前 BLOCK：本 change 的
      // 3 条事件既不得被换键忽略，也不得产生新事件 / 备份 / 机器字段改写
      writeState(dir, reentryArchiveState({
        activeChange: 'archive/2026-09-26-' + CHANGE_ID,
        history: [reentryHistoryEvent(1), reentryHistoryEvent(2), reentryHistoryEvent(3)],
      }));
      const nestedBytes = readStateBytes(dir);
      const nestedBackupsBefore = reentryBackupFiles(dir).length;
      const nestedRes = runReenter(dir, 'verify', { source: 'user-approval', reason: '换键重入' });
      assertExit(nestedRes, 1);
      assertOut(nestedRes, 'BLOCKED');
      assertStateBytesUnchanged(dir, nestedBytes, '归档相对路径 change 名');
      if (reentryBackupFiles(dir).length !== nestedBackupsBefore) {
        throw new Error('归档相对路径 change 名不得产生备份');
      }
      // ⑩ history 存在但非数组 → fail-closed BLOCK，不得静默清空覆盖审计历史
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState({ history: 'corrupted-history' }));
      const corruptBytes = readStateBytes(dir);
      const corruptRes = runReenter(dir, 'verify', { source: 'user-approval', reason: 'history 损坏' });
      assertExit(corruptRes, 1);
      assertOut(corruptRes, 'BLOCKED');
      assertOut(corruptRes, 'history');
      assertStateBytesUnchanged(dir, corruptBytes, '非数组 history');
      if (readScenarioState(dir).history !== 'corrupted-history') {
        throw new Error('损坏的 history 不得被静默清空覆盖：' + JSON.stringify(readScenarioState(dir).history));
      }
      // ⑪ 备份写入包含性：.specs/<change> 为 junction（指向 runRoot 外）→ BLOCK 零改写，
      // runRoot 外不得出现任何备份字节
      const linkedOutsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-comet-reentry-outside-'));
      writeFile(linkedOutsideDir, 'CHANGE.md', '# CHANGE\n\n## Why\n\njunction 目标。\n');
      const linkedName = 'linked-change';
      fs.symlinkSync(linkedOutsideDir, path.join(dir, '.specs', linkedName), 'junction');
      writeState(dir, reentryArchiveState({ activeChange: linkedName }));
      const linkedBytes = readStateBytes(dir);
      const linkedRes = runReenter(dir, 'verify', { source: 'user-approval', reason: 'junction 逃逸' });
      assertExit(linkedRes, 1);
      assertOut(linkedRes, 'BLOCKED');
      assertStateBytesUnchanged(dir, linkedBytes, 'junction 逃逸');
      if (fs.existsSync(path.join(linkedOutsideDir, '.reentry-backups'))) {
        throw new Error('junction 逃逸不得在 runRoot 外产生备份：'
          + JSON.stringify(fs.readdirSync(path.join(linkedOutsideDir, '.reentry-backups'))));
      }
      fs.rmSync(linkedOutsideDir, { recursive: true, force: true });
      try { fs.rmSync(path.join(dir, '.specs', linkedName), { recursive: true, force: true }); } catch { /* 场景目录整体清理兜底 */ }
      // ⑫ 上限后的显式授权续轮（AC-7 后半句）：合法授权 → 放行并计下一轮（事件 / 授权留痕带
      // 续轮标记与原因）；授权轮次不足或未达上限即传续轮 → BLOCK 且 state 字节零改写
      const threeRounds = [reentryHistoryEvent(1), reentryHistoryEvent(2), reentryHistoryEvent(3)];
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState({ history: threeRounds }));
      const continued = runReenter(dir, 'verify', {
        source: 'admin-approval', reason: '上限后显式授权续轮', extra: ['--continue-round', '4'],
      });
      assertExit(continued, 0);
      assertOut(continued, 'REENTRY');
      assertOut(continued, '续轮');
      const continuedState = readScenarioState(dir);
      if (continuedState.currentNode !== 'verify') {
        throw new Error('续轮放行后 currentNode 应为 verify，实际 ' + JSON.stringify(continuedState.currentNode));
      }
      const continuedEvent = (continuedState.history || [])
        .filter((e) => e.event === 'reentry-applied')
        .pop();
      if (!continuedEvent || continuedEvent.round !== 4 || continuedEvent.change !== CHANGE_ID
        || continuedEvent.continuationAuthorized !== true
        || continuedEvent.reason !== '上限后显式授权续轮') {
        throw new Error('续轮审计事件字段不符（round=4 / change / 续轮标记 / reason）：' + JSON.stringify(continuedEvent));
      }
      const continuedRecord = continuedState.evidence?.verify?.reentryAuthorization;
      if (!continuedRecord || continuedRecord.continuationAuthorized !== true
        || continuedRecord.reason !== '上限后显式授权续轮') {
        throw new Error('续轮授权留痕不符：' + JSON.stringify(continuedRecord));
      }
      writeState(dir, reentryArchiveState({ history: threeRounds }));
      const insufficientBytes = readStateBytes(dir);
      const insufficient = runReenter(dir, 'verify', {
        source: 'admin-approval', reason: '轮次不足', extra: ['--continue-round', '3'],
      });
      assertExit(insufficient, 1);
      assertOut(insufficient, 'BLOCKED');
      assertStateBytesUnchanged(dir, insufficientBytes, '续轮授权轮次不足');
      writeState(dir, reentryArchiveState());
      const earlyBytes = readStateBytes(dir);
      const early = runReenter(dir, 'verify', {
        source: 'admin-approval', reason: '未达上限', extra: ['--continue-round', '4'],
      });
      assertExit(early, 1);
      assertOut(early, 'BLOCKED');
      assertStateBytesUnchanged(dir, earlyBytes, '未达上限即传续轮');
      // ⑬ 写盘失败路径：原子写因临时路径被占而失败 → 非零退出、state 不截断、本次孤儿备份回滚
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState());
      const atomicBytes = readStateBytes(dir);
      const atomicBackupsBefore = reentryBackupFiles(dir);
      const blockedTempDir = path.join(dir, '.flow-comet', 'flow-comet-state.json.tmp');
      fs.mkdirSync(blockedTempDir, { recursive: true });
      const atomicRes = runReenter(dir, 'verify', { source: 'user-approval', reason: '模拟写盘失败' });
      assertExit(atomicRes, 1);
      assertStateBytesUnchanged(dir, atomicBytes, '写盘失败路径');
      if (!isDeepStrictEqual(reentryBackupFiles(dir), atomicBackupsBefore)) {
        throw new Error('写盘失败必须回滚本次孤儿备份：before=' + JSON.stringify(atomicBackupsBefore)
          + ' after=' + JSON.stringify(reentryBackupFiles(dir)));
      }
      fs.rmSync(blockedTempDir, { recursive: true, force: true });
    },
  },

  // 262: 恢复链（AC-2 的「BLOCK → 补全授权 → 放行」/ 编排顺序 / 幂等重放）——未授权 BLOCK 且
  // 字节零改写、零备份；补齐授权三元组后放行（备份 + 转移 + 审计）；重复同目标调用 = 空操作
  // （放行 + 可见提示 + 零备份新增 + 零计数 + 零事件 + 字节零改写）。
  {
    name: '262 恢复链：未授权 BLOCK → 补全授权放行 → 重复同目标空操作（零副作用）',
    run: (dir) => {
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState());
      const blockedBytes = readStateBytes(dir);
      const resBlocked = runReenter(dir, 'verify');
      assertExit(resBlocked, 1);
      assertOut(resBlocked, 'BLOCKED');
      assertStateBytesUnchanged(dir, blockedBytes, '未授权 BLOCK');
      if (reentryBackupFiles(dir).length !== 0) {
        throw new Error('未授权 BLOCK 不得产生备份');
      }
      const resAllowed = runReenter(dir, 'verify', { source: 'user-approval', reason: '用户显式授权重入' });
      assertExit(resAllowed, 0);
      assertOut(resAllowed, 'REENTRY');
      const appliedState = readScenarioState(dir);
      if (appliedState.currentNode !== 'verify') {
        throw new Error('补全授权后应放行并把 currentNode 置为 verify，实际 ' + JSON.stringify(appliedState.currentNode));
      }
      const backupsAfterApply = reentryBackupFiles(dir);
      if (backupsAfterApply.length !== 1) {
        throw new Error('放行应恰产生 1 份备份，实际 ' + JSON.stringify(backupsAfterApply));
      }
      const appliedEvents = (appliedState.history || []).filter((e) => e.event === 'reentry-applied');
      if (appliedEvents.length !== 1) {
        throw new Error('放行应恰写 1 条 reentry-applied 事件，实际 ' + JSON.stringify(appliedEvents));
      }
      const noopBytes = readStateBytes(dir);
      const resNoop = runReenter(dir, 'verify', { source: 'user-approval', reason: '重复调用同目标' });
      assertExit(resNoop, 0);
      assertNotOut(resNoop, 'BLOCKED');
      if (outputText(resNoop).trim() === '') {
        throw new Error('空操作应打印一条可见提示');
      }
      assertStateBytesUnchanged(dir, noopBytes, '重复同目标空操作');
      if (!isDeepStrictEqual(reentryBackupFiles(dir), backupsAfterApply)) {
        throw new Error('空操作不得新增备份：' + JSON.stringify(reentryBackupFiles(dir)));
      }
      const noopState = readScenarioState(dir);
      if ((noopState.history || []).length !== (appliedState.history || []).length) {
        throw new Error('空操作不得写事件：history 长度由 ' + (appliedState.history || []).length
          + ' 变为 ' + (noopState.history || []).length);
      }
    },
  },

  // 263: 旧 change（无 newChange 字段 · AC-3 与本 change 的显式例外）——授权门禁对一切
  // change 无条件 fail-closed：旧 change 未授权同样 BLOCK（安全面不因 change 新旧降级）；
  // 合法授权放行并与新 change 走同一转移 / 审计路径。
  {
    name: '263 旧 change：未授权仍 BLOCK（显式例外）+ 合法授权放行',
    run: (dir) => {
      writeReentryChangeDir(dir);
      const legacyState = reentryArchiveState();
      delete legacyState.newChange;
      writeState(dir, legacyState);
      const blockedBytes = readStateBytes(dir);
      const resBlocked = runReenter(dir, 'verify');
      assertExit(resBlocked, 1);
      assertOut(resBlocked, 'BLOCKED');
      assertStateBytesUnchanged(dir, blockedBytes, '旧 change 未授权');
      if (reentryBackupFiles(dir).length !== 0) {
        throw new Error('旧 change 未授权 BLOCK 不得产生备份');
      }
      const resAllowed = runReenter(dir, 'verify', { source: 'user-approval', reason: '旧 change 显式授权' });
      assertExit(resAllowed, 0);
      assertOut(resAllowed, 'REENTRY');
      const st = readScenarioState(dir);
      if (st.currentNode !== 'verify') {
        throw new Error('旧 change 合法授权应放行并转移，实际 ' + JSON.stringify(st.currentNode));
      }
      if (!isDeepStrictEqual(st.completedNodes, REENTRY_EXPECTED_INTERSECTION.verify)) {
        throw new Error('旧 change 转移后 completedNodes 应为前驱交集，实际 ' + JSON.stringify(st.completedNodes));
      }
      const appliedEvent = (st.history || []).find((e) => e.event === 'reentry-applied');
      if (!appliedEvent || appliedEvent.change !== CHANGE_ID || appliedEvent.round !== 1) {
        throw new Error('旧 change 的审计事件应带 change 且为第 1 轮，实际 ' + JSON.stringify(appliedEvent));
      }
      // 最小旧 state（仅 7 个键、无 readState 兼容默认字段）：apply 只写本次实际改动的字段，
      // 兼容默认值不得随重入回写（键集逐项不变——「其余字段零改写」口径覆盖真实最小旧 state）
      const minimalLegacy = {
        activeChange: CHANGE_ID,
        currentNode: 'archive',
        completedNodes: [...REENTRY_FULL_COMPLETED],
        evidence: {},
        verifyFailures: 0,
        status: 'running',
        history: [{ event: 'exit-applied', node: 'verify', at: '2026-09-20T00:00:00.000Z', change: CHANGE_ID }],
      };
      writeState(dir, minimalLegacy);
      const minimalKeysBefore = Object.keys(readScenarioState(dir)).sort();
      const minimalRes = runReenter(dir, 'verify', { source: 'user-approval', reason: '最小旧 state 重入' });
      assertExit(minimalRes, 0);
      assertOut(minimalRes, 'REENTRY');
      const minimalAfter = readScenarioState(dir);
      const minimalKeysAfter = Object.keys(minimalAfter).sort();
      if (!isDeepStrictEqual(minimalKeysAfter, minimalKeysBefore)) {
        throw new Error('最小旧 state 重入后键集必须逐项不变（兼容默认值不得回写）：before='
          + JSON.stringify(minimalKeysBefore) + ' after=' + JSON.stringify(minimalKeysAfter));
      }
      for (const defaultKey of ['executionMode', 'directOverride', 'branchMode', 'enablePrReview', 'branchPrefix']) {
        if (defaultKey in minimalAfter) {
          throw new Error('readState 兼容默认字段不得随重入回写: ' + defaultKey);
        }
      }
    },
  },

  // 264: history 事件类型集合静态锚（唯一事件类型例外 / 禁止扩散）——扫描引擎生产脚本的
  // 事件类型字面量：写侧集合必须恰为 {exit-applied, reentry-applied, replan-applied,
  // advance-forced}（新增类型必须由引擎写侧真实落地 + 显式更新本锚，未落地即 RED），读侧集合
  // 必须 ⊆ 允许集（出现允许集外的事件类型即红）；另锚新的两类写点必须带跨 change 归属字段
  // （replan-applied → change）与「被跳过的出口门禁」标识（advance-forced → skipped：
  // exit:<node>），事件对象的动态断言在 259 / 263 / 受控计划重校场景族。
  {
    name: '264 history 事件类型集合静态锚：既有类型 + replan-applied / advance-forced（新增即红、判据不放宽）',
    run: () => {
      const allowed = ['exit-applied', 'reentry-applied', 'replan-applied', 'advance-forced'];
      const scripts = fs.readdirSync(SCRIPTS_DIR)
        .filter((f) => f.endsWith('.mjs') && f !== 'guard-self-test.mjs' && f !== 'system-test.mjs');
      const writers = new Set();
      const readers = new Set();
      const writeSites = new Map();
      for (const file of scripts) {
        const text = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
        for (const match of text.matchAll(/event:\s*'([a-z][a-z-]*)'/g)) {
          writers.add(match[1]);
          writeSites.set(match[1], { file, text, index: match.index });
        }
        for (const match of text.matchAll(/\.event\s*(?:===|!==)\s*'([a-z][a-z-]*)'/g)) {
          readers.add(match[1]);
        }
      }
      const extra = [...new Set([...writers, ...readers])].filter((type) => !allowed.includes(type));
      if (extra.length > 0) {
        throw new Error('history 事件类型出现允许集外的新类型（唯一事件类型例外不得扩散）: ' + extra.join(', ')
          + '；写侧=' + [...writers].join(',') + '；读侧=' + [...readers].join(','));
      }
      const missingWriters = allowed.filter((type) => !writers.has(type));
      if (missingWriters.length > 0) {
        throw new Error('history 事件类型写侧缺类型（受控通道未落地即 RED）: ' + missingWriters.join(', ')
          + '；实际写侧=' + [...writers].join(','));
      }
      // 跨 change 归属字段锚：轮次/配额按 change 隔离依赖事件的 change 字段（reentry / replan 同判据）
      const changeFieldTypes = ['reentry-applied', 'replan-applied'];
      for (const type of changeFieldTypes) {
        const site = writeSites.get(type);
        if (!site) throw new Error(type + ' 写点缺失（审计事件必须由引擎脚本写入）');
        const windowText = site.text.slice(site.index, site.index + 800);
        if (!/\bchange\s*:/.test(windowText)) {
          throw new Error(type + ' 写点必须带 change 字段（跨 change 轮次隔离依据）: ' + site.file);
        }
      }
      // 强制推进留痕锚：事件必须记录被跳过的出口门禁标识（skipped: ['exit:<node>']）
      const forcedSite = writeSites.get('advance-forced');
      if (!forcedSite) throw new Error('advance-forced 写点缺失（逃生口留痕必须由引擎脚本写入）');
      const forcedWindow = forcedSite.text.slice(forcedSite.index, forcedSite.index + 800);
      if (!/\bskipped\s*:/.test(forcedWindow)) {
        throw new Error('advance-forced 写点必须带 skipped 字段（记录被跳过的出口门禁）: ' + forcedSite.file);
      }
      if (!/exit:/.test(forcedWindow)) {
        throw new Error('advance-forced 写点的 skipped 值必须标识 exit:<node> 形态的门禁: ' + forcedSite.file);
      }
    },
  },

  // 265: 幂等锚（空操作判定）——目标形态已成立（currentNode=target 且 completedNodes 已等于
  // 前驱交集）时重复调用 = 空操作：放行 + 可见提示 + 不备份 / 不计数 / 不写事件 / state 字节
  // 零改写。夹具直接构造目标形态（不经 apply 路径），同时锁定判定顺序：空操作短路必须先于
  // 源判定——否则 currentNode=verify ≠ archive 会先被源门禁误 BLOCK；但空操作短路不得先于
  // 上限判定——达上限的同目标形态必须走人工裁决 BLOCK（不得以空操作退出 0）。
  {
    name: '265 幂等锚：目标形态已成立的重复调用 = 空操作（零备份·零计数·零事件·零改写），超限同目标仍 BLOCK',
    run: (dir) => {
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState({
        currentNode: 'verify',
        completedNodes: [...REENTRY_EXPECTED_INTERSECTION.verify],
      }));
      const bytes = readStateBytes(dir);
      const beforeHistoryLength = (readScenarioState(dir).history || []).length;
      const res = runReenter(dir, 'verify', { source: 'user-approval', reason: '重复调用同目标' });
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      if (outputText(res).trim() === '') {
        throw new Error('空操作应打印一条可见提示');
      }
      assertStateBytesUnchanged(dir, bytes, '目标形态已成立的空操作');
      if (reentryBackupFiles(dir).length !== 0) {
        throw new Error('空操作不得备份：' + JSON.stringify(reentryBackupFiles(dir)));
      }
      const st = readScenarioState(dir);
      if ((st.history || []).length !== beforeHistoryLength) {
        throw new Error('空操作不得写事件：history 长度由 ' + beforeHistoryLength + ' 变为 ' + (st.history || []).length);
      }
      if ((st.history || []).some((e) => e.event === 'reentry-applied')) {
        throw new Error('空操作不得写入 reentry-applied 事件');
      }
      // 上限判定必须先于空操作短路：达到上限的 change 即使处于同目标形态也走人工裁决 BLOCK，
      // 不得以空操作退出 0（幂等豁免不越过上限；state 仍字节零改写）
      writeState(dir, reentryArchiveState({
        currentNode: 'verify',
        completedNodes: [...REENTRY_EXPECTED_INTERSECTION.verify],
        history: [reentryHistoryEvent(1), reentryHistoryEvent(2), reentryHistoryEvent(3)],
      }));
      const cappedBytes = readStateBytes(dir);
      const cappedRes = runReenter(dir, 'verify', { source: 'user-approval', reason: '超限同目标' });
      assertExit(cappedRes, 1);
      assertOut(cappedRes, 'BLOCKED');
      assertOut(cappedRes, '继续');
      assertOut(cappedRes, '停止');
      assertNotOut(cappedRes, '空操作');
      assertStateBytesUnchanged(dir, cappedBytes, '超限同目标形态');
      if (reentryBackupFiles(dir).length !== 0) {
        throw new Error('超限同目标形态不得产生备份：' + JSON.stringify(reentryBackupFiles(dir)));
      }
      if ((readScenarioState(dir).history || []).length !== 3) {
        throw new Error('超限同目标形态不得追加审计事件');
      }
    },
  },

  // 266: replan 授权 fail-closed（AC-2 / ADR-013 决策 5）——缺 --authorized-by / 空串 /
  // 纯空白 / 缺 <reason> / 纯空白 reason → BLOCKED、state 字节（sha256）零改写、零备份、零事件；
  // 授权形态由 route-node 纯函数单一权威判定（malformed → block + 合法形态放行对照）。
  {
    name: '266 replan 授权 fail-closed：缺/空/纯空白授权与缺原因 → BLOCKED 零改写 + 形态纯函数锚',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_INITIAL);
      writeState(dir, replanExecuteState());
      // entry 形态：真实记录修订前的任务集签名（后续修订使其成为「到期签名」）
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
      const bytes = readStateBytes(dir);
      const shaBefore = createHash('sha256').update(bytes, 'utf8').digest('hex');
      const blockedCases = [
        ['缺 --authorized-by（仅位置 reason）', ['replan', '计划有缺陷：新增并行任务']],
        ['--authorized-by 空串', ['replan', '计划有缺陷：新增并行任务', '--authorized-by', '']],
        ['--authorized-by 纯空白', ['replan', '计划有缺陷：新增并行任务', '--authorized-by', '   ']],
        ['缺 <reason>（仅授权）', ['replan', '--authorized-by', 'user-approval']],
        ['<reason> 纯空白', ['replan', '   ', '--authorized-by', 'user-approval']],
      ];
      for (const [label, args] of blockedCases) {
        const res = runStateWithProtocol(dir, args);
        assertExit(res, 1);
        assertOut(res, 'BLOCKED');
        assertStateBytesUnchanged(dir, bytes, label);
        const shaNow = createHash('sha256').update(readStateBytes(dir), 'utf8').digest('hex');
        if (shaNow !== shaBefore) {
          throw new Error(label + '：state sha256 应零改写，实际 ' + shaNow + ' ≠ ' + shaBefore);
        }
      }
      if (replanBackupFiles(dir).length !== 0) {
        throw new Error('授权非法路径不得产生备份：' + JSON.stringify(replanBackupFiles(dir)));
      }
      if (replanEventsOf(readScenarioState(dir)).length !== 0) {
        throw new Error('授权非法路径不得写审计事件：' + JSON.stringify(replanEventsOf(readScenarioState(dir))));
      }
      // 授权形态纯函数锚：malformed 一律 ok:false；合法形态 ok:true 且归一化字段完整
      const valid = {
        round: 1,
        at: '2026-09-27T00:00:00.000Z',
        source: 'user-approval',
        reason: '计划有缺陷',
        node: 'execute',
      };
      const parsedValid = assertReplanAuthorizationShape(valid, 'execute', true, '合法授权三元组');
      if (!parsedValid.authorization || parsedValid.authorization.source !== 'user-approval'
        || parsedValid.authorization.reason !== '计划有缺陷' || parsedValid.authorization.node !== 'execute') {
        throw new Error('合法授权的归一化结果不完整：' + JSON.stringify(parsedValid.authorization));
      }
      const malformed = [
        ['缺 authorization', undefined],
        ['authorization 为数组', []],
        ['round=0', { ...valid, round: 0 }],
        ['round 非整数', { ...valid, round: 1.5 }],
        ['round 类型错误', { ...valid, round: '1' }],
        ['at 空串', { ...valid, at: '' }],
        ['at 纯空白', { ...valid, at: '  ' }],
        ['at 类型错误', { ...valid, at: 42 }],
        ['source 空串', { ...valid, source: '' }],
        ['source 纯空白', { ...valid, source: '  ' }],
        ['source 类型错误', { ...valid, source: [] }],
        ['node 与调用不一致', { ...valid, node: 'subagent-execute' }],
      ];
      for (const [label, authorization] of malformed) {
        assertReplanAuthorizationShape(authorization, 'execute', false, label);
      }
      // 综合判定的未授权路径：非法授权 → block（不抛异常、不写盘；零改写由上方 CLI 用例锚定）
      const decide = requireRouteNodeExport('resolveReplanDecision');
      const decideState = replanExecuteState();
      for (const [label, authorization] of malformed) {
        const decision = decide({ protocol: readScenarioProtocol(dir), state: decideState, authorization });
        if (!decision || decision.ok !== false || decision.action !== 'block') {
          throw new Error('[' + label + '] resolveReplanDecision 应返回 block，实际 ' + JSON.stringify(decision));
        }
      }
      // 纯函数族存在性锚（T03 交付面）：五项导出缺任一即本场景 RED
      requireRouteNodeExport('replanRoundCount');
      requireRouteNodeExport('replanRoundDecision');
      requireRouteNodeExport('replanNoOpDecision');
    },
  },

  // 267a: replan 校验不豁免（ADR-013 决策 3 / 明确 out：replan 绝不做校验豁免）——依赖环 /
  // 缺失依赖 / 缺 <verify> / 并行写冲突四类任务集在 replan 上一律 BLOCKED 且状态零改写；
  // 并且 plan 出口与 replan 对同一输入给出同一机器分类。
  {
    name: '267a replan 校验不豁免：四类任务集 BLOCKED 零改写 + 任务图分析/写冲突检测单源锚',
    run: async (dir) => {
      const cases = [
        ['依赖环', TASK_DEP_CYCLE, '依赖环', '依赖环'],
        ['依赖不存在的任务', TASK_MISSING_DEP, '依赖不存在的任务', '依赖'],
        ['缺 <verify> 字段', REPLAN_TASK_NO_VERIFY, '缺 <verify> 字段', 'verify'],
        ['并行写冲突', TASK_PARALLEL_WRITE_CONFLICT, 'write_files', '并行写冲突'],
      ];
      for (const [label, taskContent, planExpected, replanExpected] of cases) {
        // ① plan 出口（既有判定路径）对同一输入的机器分类
        const planState = baseState('plan');
        planState.evidence.plan = { summary: 'plan done' };
        planState.newChange = true;
        writeState(dir, planState);
        const planRes = runPlanExit(dir, taskContent);
        assertExit(planRes, 1);
        assertOut(planRes, 'BLOCKED');
        assertOut(planRes, planExpected);
        // ② replan 对同一输入：同一分类 + BLOCKED + state 零改写
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskContent);
        writeState(dir, replanExecuteState({ taskHash: REPLAN_STALE_SIGNATURE }));
        const bytes = readStateBytes(dir);
        const replanRes = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
        assertExit(replanRes, 1);
        assertOut(replanRes, 'BLOCKED');
        assertOut(replanRes, replanExpected);
        assertStateBytesUnchanged(dir, bytes, 'replan ' + label);
        // 显式 sha256 前后相同（字节零改写的独立哈希表达：断言覆盖完整契约而非关键词）
        const shaBefore = createHash('sha256').update(bytes).digest('hex');
        const shaAfter = createHash('sha256').update(readStateBytes(dir)).digest('hex');
        if (shaBefore !== shaAfter) {
          throw new Error(label + '：replan BLOCK 路径 state sha256 应前后相同，实际 '
            + shaBefore + ' → ' + shaAfter);
        }
        if (replanBackupFiles(dir).length !== 0) {
          throw new Error(label + '：校验失败路径不得产生备份');
        }
        if (replanEventsOf(readScenarioState(dir)).length !== 0) {
          throw new Error(label + '：校验失败路径不得写审计事件');
        }
      }
      // 读写弱判（read∩write，plan 出口同判据）：仅 WARN 不阻断——replan 照常重签、写重签前备份、
      // 写审计事件（覆盖写写强判之外的非阻断分支）。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', TASK_PARALLEL_READ_OVERLAP);
      writeState(dir, replanExecuteState({ taskHash: REPLAN_STALE_SIGNATURE }));
      const readWarnRes = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
      assertExit(readWarnRes, 0);
      assertOut(readWarnRes, 'REPLAN:');
      assertOut(readWarnRes, 'WARN: TASK.md 并行任务 read∩write 隐式依赖嫌疑');
      assertOut(readWarnRes, 'P02×P01(src/shared.mjs)');  // 输出为「读取方×写入方」（P02 读 P01 写路径）
      if (replanBackupFiles(dir).length !== 1) {
        throw new Error('read∩write 弱判不得阻断 replan：应恰有 1 份重签前备份，实际 '
          + replanBackupFiles(dir).length);
      }
      if (replanEventsOf(readScenarioState(dir)).length !== 1) {
        throw new Error('read∩write 弱判不得阻断 replan：应写入 1 条 replan-applied 审计事件，实际 '
          + replanEventsOf(readScenarioState(dir)).length);
      }
      // 同源结构锚：任务图分析全引擎只有一处定义，且位于 route-node.mjs（可由 replan 复用）
      const analyze = requireRouteNodeExport('analyzeDependencyGraph');
      const cyclicBlocks = TASK_DEP_CYCLE.match(/<task[\s\S]*?<\/task>/g) || [];
      const verdict = analyze(cyclicBlocks);
      if (!verdict || verdict.cyclic !== true || !Array.isArray(verdict.cycleIds) || verdict.cycleIds.length === 0) {
        throw new Error('route-node 导出的任务图分析对依赖环应返回 cyclic=true + cycleIds，实际 ' + JSON.stringify(verdict));
      }
      const missingVerdict = analyze(TASK_MISSING_DEP.match(/<task[\s\S]*?<\/task>/g) || []);
      if (!missingVerdict || missingVerdict.missing.length === 0 || missingVerdict.cyclic !== false) {
        throw new Error('route-node 导出的任务图分析对缺失依赖应返回 missing 明细，实际 ' + JSON.stringify(missingVerdict));
      }
      const engineScripts = engineScriptFiles();
      const definitionFiles = engineScripts.filter((file) =>
        /function\s+analyzeDependencyGraph\s*\(/.test(fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8')));
      if (definitionFiles.length !== 1 || definitionFiles[0] !== 'route-node.mjs') {
        throw new Error('任务图分析必须只有一份实现且位于 route-node.mjs（plan 出口与 replan 共用），实际定义处: '
          + JSON.stringify(definitionFiles));
      }
      const guardText = fs.readFileSync(GUARD, 'utf8');
      if (!/import[^;]*\banalyzeDependencyGraph\b[^;]*from\s*'\.\/route-node\.mjs'/.test(guardText)) {
        throw new Error('workflow-guard.mjs 必须静态 import route-node 的任务图分析（不得内联第二份判定）');
      }
      // 并行写冲突检测单源锚（CR-2 抽取）：全引擎只有一份定义且位于 route-node.mjs，
      // workflow-guard 静态 import 使用它（replan 与 plan 出口同一判据，禁止内联第二份）。
      const conflictDefinitionFiles = engineScripts.filter((file) =>
        /function\s+findParallelWriteConflicts\s*\(/.test(fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8')));
      if (conflictDefinitionFiles.length !== 1 || conflictDefinitionFiles[0] !== 'route-node.mjs') {
        throw new Error('并行写冲突检测必须只有一份实现且位于 route-node.mjs（plan 出口与 replan 共用），实际定义处: '
          + JSON.stringify(conflictDefinitionFiles));
      }
      if (!/import[^;]*\bfindParallelWriteConflicts\b[^;]*from\s*'\.\/route-node\.mjs'/.test(guardText)) {
        throw new Error('workflow-guard.mjs 必须静态 import route-node 的并行写冲突检测（不得内联第二份判定）');
      }
    },
  },

  // 267b: 同源静态锚（第三族：同文件跨任务且无依赖路径）——判定构件与结果产出在全引擎脚本里
  // 只能出现一次且位于 route-node.mjs；修复族「只表达一次」边界锚 + 该判据自身的合成夹具锚；
  // replan 侧结构锚（解构 / BLOCK 早于备份 / 消息与恢复指引与 plan 出口同族）。
  {
    name: '267b 第三族同源静态锚：构件唯一表达 + 修复族边界锚 + replan 消费锚',
    run: (dir) => {
      const engineScripts = engineScriptFiles();
      const guardText = fs.readFileSync(GUARD, 'utf8');
      // —— 本批 in-place 增锚（第三族：同文件跨任务且无依赖路径）——
      // ① 单一实现锚（结构事实而非注释声明）：第三族的构件（修复任务族前缀常量 / 任务对键 /
      //    依赖可达闭包）与结果产出在全引擎脚本里只能出现一次且位于 route-node.mjs——消费脚本
      //    内自建第二份（依赖闭包或写入面交集实现）会在此变红。
      for (const piece of ['FIX_TASK_ID_PREFIX', 'taskPairKey', 'reachableTaskIds']) {
        const pieceFiles = engineScripts.filter((file) =>
          new RegExp('\\b' + piece + '\\b').test(fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8')));
        if (pieceFiles.length !== 1 || pieceFiles[0] !== 'route-node.mjs') {
          throw new Error('第三族判定构件 ' + piece + ' 必须只出现在 route-node.mjs，实际: ' + JSON.stringify(pieceFiles));
        }
      }
      const crossTaskProducerFiles = engineScripts.filter((file) =>
        /const\s+crossTaskConflicts\s*=/.test(fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8')));
      if (crossTaskProducerFiles.length !== 1 || crossTaskProducerFiles[0] !== 'route-node.mjs') {
        throw new Error('第三族结果只能由 route-node.mjs 产出（不得在消费脚本内内联），实际: ' + JSON.stringify(crossTaskProducerFiles));
      }
      if (!/\bcrossTaskConflicts\b/.test(guardText)) {
        throw new Error('workflow-guard.mjs 必须消费 route-node 的第三族结果（plan 出口判定）');
      }
      // ①b 修复族约定「只表达一次」锚（判别力升级：按表达式形态计数，不再只数标识符名）——
      //     两条边界（id 前缀 / 「位于修复段内」）各只允许一处实现，第三族参与者排除与修复族
      //     标记必须共用同一分类器；第二份等价前缀表达式（含内联前缀判定）在此变红。
      //     旧锚只统计"哪个文件含该常量名"：第二份写法（不含该名字的等价正则）必然被放过——
      //     本锚即对该盲区的判别力补齐。
      for (const problem of fixFamilyBoundaryProblems()) {
        throw new Error('修复族约定未被唯一表达: ' + problem);
      }
      // ①b-1 该判据自身的夹具锚（常驻判别力，不依赖外部临时注入）：同源形态 → 无问题；
      //      逐条注入"同一约定被表达两次"的变体 → 逐条专项报告。夹具目录即判据的 scriptsDir
      //      接缝（合成引擎脚本，不被执行、只被扫描）。
      const engineFixtureDir = path.join(dir, 'engine-fixture');
      // 夹具文本的权威前缀表达式自模块常量拼接（不在夹具里再写一份字面量——同源才测得准）
      const canonicalPrefixDecl = 'const FIX_TASK_ID_PREFIX = ' + FIX_PREFIX_LITERAL_TEXT + ';';
      const canonicalEngine = [
        canonicalPrefixDecl,
        'function fixTaskClassifier(taskContent, fixSectionTitle) {',
        '  const section = fixSectionBody(taskContent, fixSectionTitle);',
        '  const sectionBlocks = new Set(section === null ? [] : taskBlocks(section));',
        '  return (block) => FIX_TASK_ID_PREFIX.test(taskOpeningAttrs(block).id) || sectionBlocks.has(block);',
        '}',
        'function fixTaskMarker(taskContent, fixSectionTitle) {',
        '  const isFixTask = fixTaskClassifier(taskContent, fixSectionTitle);',
        '  return taskBlocks(String(taskContent ?? "")).some((block) => isFixTask(block));',
        '}',
        'function collectCrossTaskConflicts({ taskContent = "", allBlocks = [] } = {}) {',
        '  const isFixTask = fixTaskClassifier(taskContent);',
        '  return allBlocks.filter((block) => !isFixTask(block));',
        '}',
        '',
      ].join('\n');
      const fixtureFileRel = path.join('engine-fixture', 'route-node.mjs');
      writeFile(dir, fixtureFileRel, canonicalEngine);
      const canonicalProblems = fixFamilyBoundaryProblems(engineFixtureDir);
      if (canonicalProblems.length !== 0) {
        throw new Error('唯一表达形态不得报问题（判据夹具模板）: ' + JSON.stringify(canonicalProblems));
      }
      const boundaryCases = [
        ['第二份前缀表达式', canonicalEngine + 'const legacyFixPrefix = /^(T-FIX|P-FIX)/i;\n',
          '第二份修复族 id 前缀表达式'],
        ['内联前缀判定（id 字面量）', canonicalEngine + 'const legacyIds = ["T-FIX-01"];\n',
          '修复族 id 字面量'],
        ['前缀边界被删', canonicalEngine.replace(canonicalPrefixDecl, 'const FIX_TASK_ID_PREFIX = /nope/;'),
          '修复族 id 前缀边界必须只表达一次'],
        ['段内成员判定第二份',
          canonicalEngine.replace('  return allBlocks.filter((block) => !isFixTask(block));',
            '  sectionBlocks.has({});\n  return allBlocks.filter((block) => !isFixTask(block));'),
          '段内成员判定）必须只表达一次'],
        ['消费方自持边界（不共用分类器）',
          canonicalEngine.replace('  const isFixTask = fixTaskClassifier(taskContent);',
            '  const isFixTask = () => false;'),
          '必须经唯一分类器判定修复族'],
      ];
      for (const [label, mutated, expected] of boundaryCases) {
        writeFile(dir, fixtureFileRel, mutated);
        const mutatedProblems = fixFamilyBoundaryProblems(engineFixtureDir);
        if (!mutatedProblems.some((p) => p.includes(expected))) {
          throw new Error('修复族边界反向夹具（' + label + '）未按预期报告「' + expected + '」: '
            + JSON.stringify(mutatedProblems));
        }
      }
      // ①c replan 消费锚（结构锚；replan 的真实命令链路由系统测试集承担，此处不重复造链路）：
      //     第三族必须①被解构（只解构两族 = 静默丢失该判据，即修订通道可静默引入该形态）、
      //     ②在 BLOCK 早于备份与写盘的位置判定、③消息与恢复指引与 plan 出口同族（新 change
      //     阻断 / 旧 change 渐进）。断言写成对 workflow-state.mjs 文本的结构判定。
      const stateText = fs.readFileSync(STATE, 'utf8');
      const destructured = stateText.match(/const\s*\{([^}]*)\}\s*=\s*await\s+findParallelWriteConflicts\s*\(/);
      if (destructured === null || !/\bcrossTaskConflicts\b/.test(destructured[1])) {
        throw new Error('workflow-state.mjs 的 replan 必须解构 route-node 第三族结果'
          + '（只解构两族即静默丢失该判据）: ' + JSON.stringify(destructured === null ? null : destructured[1].trim()));
      }
      const crossJudgeAt = stateText.indexOf('crossTaskConflicts.length > 0');
      const backupAt = stateText.indexOf('-pre-replan.json');
      if (crossJudgeAt < 0) {
        throw new Error('workflow-state.mjs 的 replan 未消费第三族（缺判定分支）');
      }
      if (backupAt < 0 || crossJudgeAt > backupAt) {
        throw new Error('replan 的第三族判定必须早于重签前备份（BLOCK 早于落盘的零改写语义）: '
          + '判定位置 ' + crossJudgeAt + ' / 备份位置 ' + backupAt);
      }
      for (const message of ['同文件跨任务且无依赖路径', '补显式 depends_on 或合并为一个任务']) {
        if (!stateText.includes(message)) {
          throw new Error('replan 的第三族消息必须与 plan 出口同族（缺「' + message + '」）');
        }
      }
      if (!/WARN: TASK\.md 同文件跨任务且无依赖路径（旧 change 渐进不阻断）/.test(stateText)) {
        throw new Error('replan 的第三族必须保留旧 change 渐进分支（WARN 不阻断）');
      }
    },
  },

  // 267c: 第三族的判定行为与出口链路——非修复同文件对命中、修复族对不参与（含段归属与 CRLF
  // 行尾归一）、plan 出口 BLOCKED 消息带任务对与重叠文件、混合夹具只报非修复对。
  {
    name: '267c 第三族行为与出口链路：判定命中 / 修复族排除 / BLOCKED 消息 / 混合夹具',
    run: async (dir) => {
      const findConflicts = requireRouteNodeExport('findParallelWriteConflicts');
      // ② 行为锚（直接驱动判定函数，plan 出口与 replan 共用同一实现）：非修复同文件对命中、
      //    修复任务族对不参与（其顺序由修复生命周期保证，回修同文件是必然形态）。

      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 任务清单\n\n' + CROSS_TASK_PLAIN_PAIR);
      const plainConflicts = await findConflicts(path.join(dir, '.specs', CHANGE_ID));
      if (plainConflicts.crossTaskConflicts.length !== 1
        || plainConflicts.crossTaskConflicts[0].files.join(',') !== 'src/shared.mjs') {
        throw new Error('非修复同文件无依赖对必须命中第三族: ' + JSON.stringify(plainConflicts.crossTaskConflicts));
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 任务清单\n\n' + CROSS_TASK_FIX_PAIR);
      const fixConflicts = await findConflicts(path.join(dir, '.specs', CHANGE_ID));
      if (fixConflicts.crossTaskConflicts.length !== 0 || fixConflicts.writeConflicts.length !== 0) {
        throw new Error('修复任务族对不得进入第三族（也不得进入写写强判）: ' + JSON.stringify(fixConflicts));
      }
      // ②-附 段归属分支 + 行尾归一（LF 与 CRLF 两形态都必须识别为修复族）：
      //     段内块来自 LF 归一后的段体，而待判 block 来自原文——Windows 下原文是 CRLF，
      //     不归一会让段内匹配失败 → 修复族对被当普通参与者误拦。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n## 任务清单\n\n' + CROSS_TASK_FIX_SECTION_PAIR);
      const sectionConflicts = await findConflicts(path.join(dir, '.specs', CHANGE_ID));
      if (sectionConflicts.crossTaskConflicts.length !== 0 || sectionConflicts.writeConflicts.length !== 0) {
        throw new Error('修复段内**非前缀 id** 的任务对不得进入第三族（段归属分支）: '
          + JSON.stringify(sectionConflicts));
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\r\n\r\n## 任务清单\r\n\r\n' + CROSS_TASK_FIX_SECTION_PAIR.replace(/\n/g, '\r\n'));
      const crlfConflicts = await findConflicts(path.join(dir, '.specs', CHANGE_ID));
      if (crlfConflicts.crossTaskConflicts.length !== 0 || crlfConflicts.writeConflicts.length !== 0) {
        throw new Error('CRLF 行尾下修复段归属判定必须一致（行尾归一口径）: ' + JSON.stringify(crlfConflicts));
      }
      // ③ 出口链路锚（新 change）：非修复对照对 → BLOCKED 且消息带任务对与重叠文件；
      //    修复族对 → exit 0 且不出现该族消息（BLOCKED / WARN 两形态都不许有）。
      const crossState = baseState('plan');
      crossState.evidence.plan = { summary: 'plan done' };
      crossState.newChange = true;
      writeState(dir, crossState);
      const plainRes = runPlanExit(dir, CROSS_TASK_PLAIN_PAIR);
      assertExit(plainRes, 1);
      assertOut(plainRes, 'BLOCKED');
      assertOut(plainRes, '同文件跨任务且无依赖路径');
      assertOut(plainRes, 'T01×T02');
      assertOut(plainRes, 'src/shared.mjs');
      assertOut(plainRes, 'depends_on');
      writeState(dir, crossState);
      const fixRes = runPlanExit(dir, CROSS_TASK_FIX_PAIR);
      assertExit(fixRes, 0);
      assertNotOut(fixRes, '同文件跨任务');
      assertNotOut(fixRes, 'BLOCKED');
      // ④ 混合夹具：两类并存 → 只报非修复对（修复族对不出现在消息里）
      writeState(dir, crossState);
      const mixedRes = runPlanExit(dir, CROSS_TASK_MIXED_PAIR);
      assertExit(mixedRes, 1);
      assertOut(mixedRes, 'BLOCKED');
      assertOut(mixedRes, 'T01×T02');
      assertNotOut(mixedRes, 'T-FIX-01×T-FIX-02');
    },
  },

  // 268: replan 轮次上限与显式续轮（AC-3 / ADR-013 决策 6）——按 history 中本 change 的
  // replan-applied 事件计数，上限 3：第 4 次 BLOCKED 且给出「继续 / 停止」人工裁决指引；
  // --continue-round <n> 满足 n ≥ 已用 + 1 才放行并计入下一轮（审计事件 / 授权留痕带续轮标记）；
  // n 不足则 BLOCK 零改写；轮次按 change 隔离（他 change 的事件不占本 change 配额）。
  {
    name: '268 replan 轮次上限 3 与显式续轮：超限 BLOCK 人工裁决·续轮放行计下一轮·授权不足 BLOCK·跨 change 隔离',
    run: (dir) => {
      const baseHistory = [replanHistoryEvent(1), replanHistoryEvent(2), replanHistoryEvent(3)];
      const blockedCases = [
        ['超限未续轮', []],
        ['续轮授权轮次不足（n=3 < 已用+1）', ['--continue-round', '3']],
      ];
      for (const [label, extra] of blockedCases) {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
        writeState(dir, replanExecuteState({ history: [...baseHistory], taskHash: REPLAN_STALE_SIGNATURE }));
        const bytes = readStateBytes(dir);
        const res = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval', ...extra]);
        assertExit(res, 1);
        assertOut(res, 'BLOCKED');
        assertOut(res, '继续');
        assertOut(res, '停止');
        assertStateBytesUnchanged(dir, bytes, label);
        if (replanBackupFiles(dir).length !== 0) {
          throw new Error(label + '：上限拦截不得产生备份');
        }
        if (replanEventsOf(readScenarioState(dir)).length !== 3) {
          throw new Error(label + '：上限拦截不得追加审计事件');
        }
      }
      // 显式续轮放行：n = 已用 + 1 → 计入第 4 轮（审计行标注续轮）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
      writeState(dir, replanExecuteState({ history: [...baseHistory], taskHash: REPLAN_STALE_SIGNATURE }));
      const continued = runStateWithProtocol(
        dir, ['replan', '计划缺陷重校（上限后显式续轮）', '--authorized-by', 'admin-approval', '--continue-round', '4']);
      assertExit(continued, 0);
      assertOut(continued, 'REPLAN');
      assertOut(continued, '续轮');
      const continuedState = readScenarioState(dir);
      const continuedEvents = replanEventsOf(continuedState);
      if (continuedEvents.length !== 4) {
        throw new Error('续轮放行应写入第 4 条 replan-applied 事件，实际 ' + JSON.stringify(continuedEvents.length));
      }
      const continuedEvent = continuedEvents[continuedEvents.length - 1];
      if (continuedEvent.round !== 4 || continuedEvent.change !== CHANGE_ID
        || continuedEvent.reason !== '计划缺陷重校（上限后显式续轮）'
        || continuedEvent.continuationAuthorized !== true) {
        throw new Error('续轮审计事件字段不符（round=4 / change / 续轮标记 / reason）：' + JSON.stringify(continuedEvent));
      }
      const continuedRecord = continuedState.evidence?.execute?.replanAuthorization;
      if (!continuedRecord || continuedRecord.continuationAuthorized !== true
        || continuedRecord.round !== 4 || continuedRecord.source !== 'admin-approval') {
        throw new Error('续轮授权留痕不符：' + JSON.stringify(continuedRecord));
      }
      assertReplanSignatureRecorded(continuedState, REPLAN_TASK_REVISED, '续轮放行');
      if (replanBackupFiles(dir).length !== 1) {
        throw new Error('续轮放行应产生一份备份，实际 ' + JSON.stringify(replanBackupFiles(dir)));
      }
      // 跨 change 隔离：他 change 的 3 条事件不占本 change 配额 → 本 change 为第 1 轮
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
      writeState(dir, replanExecuteState({
        history: [replanHistoryEvent(1, 'other-change'), replanHistoryEvent(2, 'other-change'), replanHistoryEvent(3, 'other-change')],
        taskHash: REPLAN_STALE_SIGNATURE,
      }));
      const isolated = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
      assertExit(isolated, 0);
      assertOut(isolated, 'REPLAN');
      assertOut(isolated, '1/3');
      const isolatedEvent = replanEventsOf(readScenarioState(dir)).find((e) => e.change === CHANGE_ID);
      if (!isolatedEvent || isolatedEvent.round !== 1) {
        throw new Error('他 change 的轮次事件不应占用本 change 配额（本 change 应为第 1 轮），实际 '
          + JSON.stringify(isolatedEvent));
      }
      // 轮次判定纯函数锚（阈值只从实现常量取——本锚同时锁上限 = 3）
      const roundCount = requireRouteNodeExport('replanRoundCount');
      if (roundCount({ history: baseHistory, changeName: CHANGE_ID }) !== 3) {
        throw new Error('replanRoundCount 应统计本 change 的 replan-applied 事件数（3）');
      }
      if (roundCount({ history: baseHistory, changeName: 'other-change' }) !== 0) {
        throw new Error('replanRoundCount 应按 change 过滤（他 change 应为 0）');
      }
      if (roundCount({ history: 'corrupted', changeName: CHANGE_ID }) !== 0) {
        throw new Error('replanRoundCount 对非数组 history 应返回 0（旧 state 形态）');
      }
      const roundDecision = requireRouteNodeExport('replanRoundDecision');
      const available = roundDecision({ history: [replanHistoryEvent(1)], changeName: CHANGE_ID });
      if (!available || available.ok !== true || available.nextRound !== 2 || available.limit !== 3) {
        throw new Error('replanRoundDecision 未达上限应放行并给出下一轮：' + JSON.stringify(available));
      }
      const capped = roundDecision({ history: baseHistory, changeName: CHANGE_ID });
      if (!capped || capped.ok !== false || capped.limit !== 3) {
        throw new Error('replanRoundDecision 达上限且无续轮应 blocked：' + JSON.stringify(capped));
      }
      const continuation = roundDecision({ history: baseHistory, changeName: CHANGE_ID, continuationAuthorized: true });
      if (!continuation || continuation.ok !== true || continuation.nextRound !== 4) {
        throw new Error('replanRoundDecision 持显式续轮授权应放行第 4 轮：' + JSON.stringify(continuation));
      }
    },
  },

  // 269: replan 幂等空操作（AC-5 / ADR-013 决策 9）——目标形态已成立（state.taskHash 已等于
  // 当前 TASK.md 签名）时重复调用 = 空操作：可见提示 + 零备份 / 零轮次计数 / 零事件 /
  // state 字节零改写（与 archive 重入的幂等锚同构）。
  {
    name: '269 replan 幂等空操作：重签后重复同形态 → 零备份·零轮次·零事件·零改写',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
      writeState(dir, replanExecuteState({ taskHash: REPLAN_STALE_SIGNATURE }));
      const first = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
      assertExit(first, 0);
      assertOut(first, 'REPLAN');
      const afterApply = readStateBytes(dir);
      const appliedState = readScenarioState(dir);
      if (replanEventsOf(appliedState).length !== 1) {
        throw new Error('首次重签应恰写 1 条 replan-applied 事件，实际 '
          + JSON.stringify(replanEventsOf(appliedState).length));
      }
      const backupsAfterApply = replanBackupFiles(dir);
      if (backupsAfterApply.length !== 1) {
        throw new Error('首次重签应恰产生一份备份，实际 ' + JSON.stringify(backupsAfterApply));
      }
      assertReplanSignatureRecorded(appliedState, REPLAN_TASK_REVISED, '首次重签');
      // 同形态重复调用 → 空操作（零副作用）
      const noop = runStateWithProtocol(dir, ['replan', '重复调用同形态', '--authorized-by', 'user-approval']);
      assertExit(noop, 0);
      assertOut(noop, '空操作');
      assertNotOut(noop, 'BLOCKED');
      assertStateBytesUnchanged(dir, afterApply, '重复同形态空操作');
      if (!isDeepStrictEqual(replanBackupFiles(dir), backupsAfterApply)) {
        throw new Error('空操作不得新增备份：' + JSON.stringify(replanBackupFiles(dir)));
      }
      if (replanEventsOf(readScenarioState(dir)).length !== 1) {
        throw new Error('空操作不得写审计事件（history 长度漂移）');
      }
      // 空操作判定纯函数存在性锚（T04 编排消费的判定点）
      requireRouteNodeExport('replanNoOpDecision');
    },
  },

  // 270: 重签后 execute 出口放行（AC-1）——entry 后修订任务集（计划外新增并行就绪任务）使
  // exit execute 撞签名门禁 → replan 重校重签 → 同一出口再跑通过（不再报签名不匹配）→
  // next 正常路由到委托节点；审计事件 / 授权留痕 / 备份快照齐备，重签值与会话当前 TASK.md 同签。
  {
    name: '270 replan 重签后 exit execute --apply 通过：修订任务集（含并行就绪任务）→ 签名 BLOCKED → 重签 → 出口放行',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_INITIAL);
      writeFile(dir, '.specs/' + CHANGE_ID + '/S01-SUMMARY.md', strictSummary('S01'));
      // 夹具忠实性修复（协调者授权 A · 夹具缺陷而非放宽带锚）：resolveNextNode 的 execute 前
      // 产物门控按文件存在性判定（不读 completedNodes）——路由到委托节点要求 open / design 的
      // 前置产物在场。此处补齐 CHANGE.md / REQUIREMENT.md / DESIGN.md（writeIntakeArtifacts
      // 三件全写，其定义内已含 DESIGN.md），使夹具与真实链路的产物现场一致；不改任何断言 / 锚 /
      // 判据 / 计数。
      writeIntakeArtifacts(dir);
      writeState(dir, replanExecuteState());
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 任务集修订（#119 死锁现场）：新增计划外的并行就绪任务
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
      const blockedBytes = readStateBytes(dir);
      const blocked = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, '签名不匹配');
      assertStateBytesUnchanged(dir, blockedBytes, '修订任务集后的签名门禁 BLOCK');
      // 受控重校重签
      const reason = '计划有缺陷：新增并行任务 P02';
      const beforeReplan = readScenarioState(dir);
      const res = runStateWithProtocol(dir, ['replan', reason, '--authorized-by', 'user-approval']);
      assertExit(res, 0);
      assertOut(res, 'REPLAN');
      assertOut(res, 'execute');
      assertOut(res, '1/3');
      assertOut(res, 'user-approval');
      assertOut(res, reason);
      const st = readScenarioState(dir);
      // 留痕（双写）：history 事件 + evidence.<node>.replanAuthorization
      const events = replanEventsOf(st);
      if (events.length !== 1) {
        throw new Error('重签应恰写 1 条 replan-applied 事件，实际 ' + JSON.stringify(events));
      }
      const event = events[0];
      if (event.change !== CHANGE_ID || event.node !== 'execute' || event.round !== 1
        || event.authorizedBy !== 'user-approval' || event.reason !== reason
        || typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at))) {
        throw new Error('replan-applied 事件字段不完整（change / node / round / reason / authorizedBy / at）：'
          + JSON.stringify(event));
      }
      const record = st.evidence?.execute?.replanAuthorization;
      if (!record || record.source !== 'user-approval' || record.reason !== reason || record.round !== 1
        || typeof record.at !== 'string' || record.at.trim() === '') {
        throw new Error('evidence.execute.replanAuthorization 授权留痕不完整：' + JSON.stringify(record));
      }
      // 重签值 = 当前 TASK.md 签名（事件同步记录同一签名）
      const signed = assertReplanSignatureRecorded(st, REPLAN_TASK_REVISED, '重签');
      if (!requireRouteNodeExport('sameTaskSetSignature')(event.taskSetSignature, signed)) {
        throw new Error('replan-applied 事件记录的签名应与 state.taskHash 同签：'
          + JSON.stringify({ event: event.taskSetSignature, state: st.taskHash }));
      }
      // 转移前备份：全量快照 + sha256 指纹在任何留痕面可核验（ADR-013 决策 7）
      const backups = replanBackupFiles(dir);
      if (backups.length !== 1) {
        throw new Error('重签应恰产生一份备份，实际 ' + JSON.stringify(backups));
      }
      if (!/-pre-replan\.json$/.test(backups[0])) {
        throw new Error('备份命名应为 <UTC ISO>-pre-replan.json，实际 ' + backups[0]);
      }
      const backupBytes = fs.readFileSync(path.join(dir, '.specs', CHANGE_ID, 'replan-backups', backups[0]));
      const backupState = JSON.parse(backupBytes.toString('utf8'));
      if (!isDeepStrictEqual(backupState, beforeReplan)) {
        throw new Error('备份应为重签前的 state 全量快照');
      }
      const fingerprint = createHash('sha256').update(backupBytes).digest('hex');
      const haystack = (JSON.stringify(st) + '\n' + outputText(res)).toLowerCase();
      if (!haystack.includes(fingerprint)) {
        throw new Error('备份 sha256 指纹未在任何留痕面出现（备份不可核验）: ' + fingerprint);
      }
      // 同一出口再跑：签名已重签 → 放行；并行就绪任务使 next 路由到委托节点
      const exitRes = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(exitRes, 0);
      assertOut(exitRes, 'ALL CHECKS PASSED');
      if (!/^NODE: subagent-execute$/m.test(outputText(exitRes))) {
        throw new Error('重签后出口应路由到委托节点（并行就绪任务），实际输出:\n' + outputText(exitRes));
      }
      const next = runStateWithProtocol(dir, ['next']);
      assertExit(next, 0);
      if (!/^NODE: subagent-execute$/m.test(outputText(next))) {
        throw new Error('next 应正常路由到 subagent-execute，实际输出:\n' + outputText(next));
      }
    },
  },

  // 271: advance 留痕 + 状态可见（AC-4）——advance 仍推进（语义不变），但必须写
  // history 事件 advance-forced（node + skipped: ['exit:<node>'] + reason: 'advance'）并打印
  // ADVANCE-AUDIT；status 输出派生字段 forcedNodes 以 history 中本 change 的 advance-forced
  // 事件为准——record 后 advance / replanAuthorization 留痕后
  // advance 两类真实反例都不得漏报；旧 state（无 history 字段）回退「completedNodes 含而
  // evidence 不含」判据（当时 advance 无痕，无事件可依）。
  // 正反断言：被强制推进的节点必现；有出口证据但未被强制的不现。
  {
    name: '271 advance 留痕：advance-forced 事件 + status.forcedNodes 派生视图（含反向断言）',
    run: (dir) => {
      assertExit(runStateWithProtocol(dir, ['init', CHANGE_ID]), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n推进留痕夹具。\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md',
        '# REQUIREMENT\n\n## 用户故事\n\nx\n\n## 验收准则（AC）\n\n- 通过\n');
      const res = runStateWithProtocol(dir, ['advance']);
      assertExit(res, 0);
      assertOut(res, 'Advanced to: design');
      assertOut(res, 'ADVANCE-AUDIT');
      assertOut(res, 'open');
      const st = readScenarioState(dir);
      const events = (st.history || []).filter((e) => e && e.event === 'advance-forced');
      if (events.length !== 1) {
        throw new Error('advance 应恰写 1 条 advance-forced 事件，实际 ' + JSON.stringify(events));
      }
      const event = events[0];
      if (event.change !== CHANGE_ID || event.node !== 'open') {
        throw new Error('advance-forced 事件应记录 change / 被推进节点，实际 ' + JSON.stringify(event));
      }
      if (!isDeepStrictEqual(event.skipped, ['exit:open'])) {
        throw new Error("advance-forced 事件应记录被跳过的出口门禁 skipped: ['exit:open']，实际 "
          + JSON.stringify(event.skipped));
      }
      if (event.reason !== 'advance') {
        throw new Error('advance-forced 事件应记录 reason: \'advance\'，实际 ' + JSON.stringify(event.reason));
      }
      if (typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at))) {
        throw new Error('advance-forced 事件应带可解析时间戳，实际 ' + JSON.stringify(event.at));
      }
      const status = runStateWithProtocol(dir, ['status']);
      assertExit(status, 0);
      const parsed = parseStatusJson(status);
      if (!Array.isArray(parsed.forcedNodes) || !parsed.forcedNodes.includes('open')) {
        throw new Error('status.forcedNodes 应包含被强制推进且无出口证据的 open，实际 '
          + JSON.stringify(parsed.forcedNodes));
      }
      if (parsed.forcedNodes.includes('design')) {
        throw new Error('status.forcedNodes 只能包含已完成节点，实际 ' + JSON.stringify(parsed.forcedNodes));
      }
      // 反向：有出口证据且未被 advance 强制的 completed 节点不得进入 forcedNodes；
      // 无出口证据但被 advance 强制的节点仍收录（事件判据）。事件派生下「强制」由 history 决定：
      // 夹具把 advance-forced 事件挂到 design（open 只留 exit 证据），反向断言语义保持不变。
      const st2 = readScenarioState(dir);
      st2.completedNodes = ['open', 'design'];
      st2.currentNode = 'plan';
      st2.evidence = { ...(st2.evidence || {}), open: { summary: 'open exited' } };
      st2.history = [advanceForcedEvent('design')];
      writeState(dir, st2);
      const status2 = runStateWithProtocol(dir, ['status']);
      assertExit(status2, 0);
      const parsed2 = parseStatusJson(status2);
      if (!Array.isArray(parsed2.forcedNodes) || !parsed2.forcedNodes.includes('design')) {
        throw new Error('无出口证据的 completed 节点应进入 forcedNodes，实际 ' + JSON.stringify(parsed2.forcedNodes));
      }
      if (parsed2.forcedNodes.includes('open')) {
        throw new Error('有出口证据的 completed 节点不得进入 forcedNodes，实际 ' + JSON.stringify(parsed2.forcedNodes));
      }
      // (i) 有 record 出口证据且被 advance 强制 → 必须出现（旧「缺 evidence」推断会漏报）
      const stRecord = replanExecuteState({
        completedNodes: ['open', 'design'],
        currentNode: 'plan',
        evidence: { open: { summary: 'record 出口证据（advance 事件之外的真实证据）' } },
        history: [advanceForcedEvent('open')],
      });
      writeState(dir, stRecord);
      const statusRecord = runStateWithProtocol(dir, ['status']);
      assertExit(statusRecord, 0);
      const parsedRecord = parseStatusJson(statusRecord);
      const failures271 = [];
      if (!Array.isArray(parsedRecord.forcedNodes) || !parsedRecord.forcedNodes.includes('open')) {
        failures271.push('(i) 有 record 证据且被 advance 强制的 open 应进入 forcedNodes，实际 '
          + JSON.stringify(parsedRecord.forcedNodes));
      }
      // (ii) 只有 replanAuthorization 授权留痕且被 advance 强制 → 必须出现（旧对象判据会漏报）
      const stAuth = replanExecuteState({
        completedNodes: ['open', 'design'],
        currentNode: 'plan',
        evidence: {
          open: { summary: 'open exited' },
          design: {
            replanAuthorization: {
              round: 1,
              at: '2026-09-28T00:00:00.000Z',
              source: 'user',
              reason: '计划重校',
              backup: '.specs/' + CHANGE_ID + '/replan-backups/x.json',
              fingerprint: '0'.repeat(64),
            },
          },
        },
        history: [advanceForcedEvent('design')],
      });
      writeState(dir, stAuth);
      const statusAuth = runStateWithProtocol(dir, ['status']);
      assertExit(statusAuth, 0);
      const parsedAuth = parseStatusJson(statusAuth);
      if (!Array.isArray(parsedAuth.forcedNodes) || !parsedAuth.forcedNodes.includes('design')) {
        failures271.push('(ii) 仅有 replanAuthorization 留痕且被 advance 强制的 design 应进入 forcedNodes，实际 '
          + JSON.stringify(parsedAuth.forcedNodes));
      }
      // (iv) 旧 state（无 history 字段）→ 回退「缺 evidence」判据仍生效
      const stLegacy = replanExecuteState({
        completedNodes: ['open', 'design'],
        currentNode: 'plan',
        evidence: { open: { summary: 'open exited' } },
      });
      delete stLegacy.history;
      writeState(dir, stLegacy);
      const statusLegacy = runStateWithProtocol(dir, ['status']);
      assertExit(statusLegacy, 0);
      const parsedLegacy = parseStatusJson(statusLegacy);
      if (!Array.isArray(parsedLegacy.forcedNodes) || !parsedLegacy.forcedNodes.includes('design')) {
        failures271.push('(iv) 旧 state（无 history）应回退缺 evidence 判据：design 应在 forcedNodes，实际 '
          + JSON.stringify(parsedLegacy.forcedNodes));
      }
      if (parsedLegacy.forcedNodes.includes('open')) {
        failures271.push('(iv) 旧 state（无 history）有出口证据的 open 不得进入 forcedNodes，实际 '
          + JSON.stringify(parsedLegacy.forcedNodes));
      }
      if (failures271.length > 0) {
        throw new Error('advance-forced 事件派生判据失败: ' + failures271.join(' | '));
      }
    },
  },
];
