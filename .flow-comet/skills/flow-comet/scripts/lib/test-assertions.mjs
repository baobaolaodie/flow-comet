// test-assertions.mjs — 引擎套件的断言助手与受控链路夹具（单一来源）
//
// 定位：`guard-self-test.mjs` 的断言与「修复回路 / 受控重入 / 计划重校」三条受控链路的夹具
// 材料。`outputText`（spawn 结果的输出归一）在此单源导出：断言与文本锚判据共用同一归一
// 表达，消费方一律从本模块 import，不再各写一份。

import fs from 'fs';
import path from 'path';
import { isDeepStrictEqual } from 'util';
import {
  assertExit,
  assertOut,
  runGuard,
  runState,
  writeFile,
} from './test-helpers.mjs';
import {
  CHANGE_ID,
  handoffFor,
  routeNodeModule,
  runBridgeCheckFromCopy,
  strictSummary,
  writeInstalledCopyBridgeFixture,
} from './test-fixtures.mjs';

// 输出字符串归一化：spawnSync 原始结果的 .output 恒为数组 [null, stdout, stderr]
// （.includes 逐元素比较永不中关键字）；run* 助手已归一化为字符串。两种形态都归一后再
// 断言，保证共享助手对「数组（stdout+stderr 拼接）」与「既有字符串」形态都成立（回归兼容）。
export function outputText(res) {
  return Array.isArray(res?.output)
    ? String(res.stdout || '') + String(res.stderr || '')
    : String(res?.output || '');
}

// result 重验撤销审计断言（共享单一来源）：撤销后 request evidence 必须 noCommit=false，
// 且含非空、可被 Date 解析的 revokedAt 与失败类别对应的 revokeReason（缺任一即审计缺口）。
export function assertRevocationAudit(req, expectedReason, label) {
  if (!req || req.noCommit !== false) {
    throw new Error(label + '：撤销后 request evidence 应为 noCommit=false，实际 ' + JSON.stringify(req));
  }
  if (typeof req.revokedAt !== 'string' || req.revokedAt.trim() === '' || Number.isNaN(Date.parse(req.revokedAt))) {
    throw new Error(label + '：撤销应记录非空且可被 Date 解析的 revokedAt，实际 ' + JSON.stringify(req.revokedAt));
  }
  if (req.revokeReason !== expectedReason) {
    throw new Error(label + '：撤销应记录 revokeReason=' + expectedReason + '，实际 ' + JSON.stringify(req.revokeReason));
  }
}

// state 不变量断言（m-09 / AC-4 / AC-12）：白名单外深比 + history 旧前缀稳定 + 恰新增一条
// exit-applied 事件。白名单为点分路径（如 'currentNode' / 'evidence.execute.completedChecks'）。
// 判别力：实现若顺手写白名单外字段、重写 history 旧条目、多推/漏推出口事件即抛错。
export function omitStatePath(root, dottedPath) {
  const parts = String(dottedPath).split('.');
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cursor || typeof cursor !== 'object') return;
    cursor = cursor[parts[i]];
  }
  if (cursor && typeof cursor === 'object') delete cursor[parts[parts.length - 1]];
}

export function assertStateOnlyChanged(before, after, options = {}) {
  const label = options.label ? '[' + options.label + '] ' : '';
  const allowed = Array.isArray(options.allowed) ? options.allowed : [];
  const expectNewExitApplied = options.expectNewExitApplied === undefined ? 1 : options.expectNewExitApplied;
  const beforeCmp = JSON.parse(JSON.stringify(before));
  const afterCmp = JSON.parse(JSON.stringify(after));
  for (const p of allowed) {
    omitStatePath(beforeCmp, p);
    omitStatePath(afterCmp, p);
  }
  if (!isDeepStrictEqual(beforeCmp, afterCmp)) {
    throw new Error(label + '白名单外 state 深度不变量被破坏（allowed=' + JSON.stringify(allowed) + '）\n'
      + 'before=' + JSON.stringify(beforeCmp) + '\nafter=' + JSON.stringify(afterCmp));
  }
  const beforeHistory = Array.isArray(before?.history) ? before.history : [];
  const afterHistory = Array.isArray(after?.history) ? after.history : [];
  if (!isDeepStrictEqual(afterHistory.slice(0, beforeHistory.length), beforeHistory)) {
    throw new Error(label + 'history 旧前缀被改写（旧条目必须逐字稳定）');
  }
  const appended = afterHistory.slice(beforeHistory.length);
  if (appended.length !== expectNewExitApplied) {
    throw new Error(label + 'history 应恰新增 ' + expectNewExitApplied + ' 条，实际 ' + appended.length
      + '：' + JSON.stringify(appended));
  }
  for (const event of appended) {
    if (!event || event.event !== 'exit-applied') {
      throw new Error(label + '新增 history 条目应为 exit-applied：' + JSON.stringify(event));
    }
  }
  return appended;
}

// 安装副本版本比较断言单点（场景 193 多子锚共用）：构造安装副本夹具 → 以副本脚本跑真实
// bridge-check CLI → 断言 exit 与全部关键词（失败附子锚标签便于定位）。helper 只声明期望，
// bridge-check 语义仍由 CLI 真实输出承载。
export function assertInstalledCopyBridgeVersionCase(dir, { label, installedVersion, loaderStamp, expectedExit, expectedKeywords }) {
  const fixture = writeInstalledCopyBridgeFixture(dir, { installedVersion, loaderStamp });
  const res = runBridgeCheckFromCopy(dir, fixture.dshHome, fixture.skillCopy);
  try {
    assertExit(res, expectedExit);
    for (const keyword of expectedKeywords) assertOut(res, keyword);
  } catch (e) {
    throw new Error('[' + label + '] ' + e.message);
  }
}

// 子锚表构造：单字段对象工厂 + 表函数（run 回调保持线性短小；子锚增长不再推动回调膨胀）。
export function bridgeCopyVersionCase(label, installedVersion, loaderStamp, expectedExit, ...expectedKeywords) {
  return { label, installedVersion, loaderStamp, expectedExit, expectedKeywords };
}

// 场景 193 的安装副本版本比较子锚表——期望值全部从载体基础版本 baseVersion 派生：
// ② release 态严格相等；③ dev 态安装副本形态同基础健康；④ 两侧 dev 后缀同基础健康；
// ⑤ 基础版本失配仍 FAIL；⑥ 预发布标识不剥离仍 FAIL；⑦ release 对 release 失配仍 FAIL。
export function bridgeCopyVersionSubAnchorCases(baseVersion, devVersion) {
  const major = parseInt(baseVersion.split('.')[0], 10);
  const otherBase = (major + 9) + '.0.0';
  return [
    // ② release 态严格相等：两原始戳逐字相同 → 沿用 `==` 报告。
    bridgeCopyVersionCase('release 严格相等', baseVersion, baseVersion, 0,
      '[OK] 版本一致性: loader BRIDGE_VERSION=' + baseVersion + ' == 项目 INSTALLED_VERSION=' + baseVersion,
      'bridge-check: 健康（全部检查通过）——exit 0'),
    // ③ dev 态安装副本形态：载体戳为本副本自身形态（安装副本为 git describe 戳；权威源以发布
    // 标记 + 同构 dev 后缀构造）→ 归一后与同基础 loader 判健康。
    bridgeCopyVersionCase('dev 态安装副本同基础健康', devVersion, baseVersion, 0,
      '[OK] 版本一致性: loader BRIDGE_VERSION=' + baseVersion + ' ~= 项目 INSTALLED_VERSION=' + devVersion + '（dev 态后缀归一后基础版本 ' + baseVersion + ' 一致）',
      'bridge-check: 健康（全部检查通过）——exit 0'),
    // ④ 两侧 dev 后缀同基础：归一后健康（后缀位置无关性）。
    bridgeCopyVersionCase('两侧 dev 后缀同基础健康', baseVersion + '-3-gabcdef0', baseVersion + '-2-g1234567', 0,
      '[OK] 版本一致性: loader BRIDGE_VERSION=' + baseVersion + '-2-g1234567 ~= 项目 INSTALLED_VERSION=' + baseVersion + '-3-gabcdef0（dev 态后缀归一后基础版本 ' + baseVersion + ' 一致）',
      'bridge-check: 健康（全部检查通过）——exit 0'),
    // ⑤ 基础版本失配：两侧 dev 后缀归一后仍不同 → 原始戳配对 + 双方归一值 FAIL exit 1。
    bridgeCopyVersionCase('基础版本失配', otherBase + '-3-gabcdef0', baseVersion + '-2-g1234567', 1,
      '[FAIL] 版本偏斜: loader BRIDGE_VERSION=' + baseVersion + '-2-g1234567 != 项目 INSTALLED_VERSION=' + otherBase + '-3-gabcdef0（归一基础版本: loader=' + baseVersion + ' / installed=' + otherBase + '）——两值如上',
      'bridge-check: 失配 1 项——exit 1'),
    // ⑥ 预发布标识不剥离：-rc.N 不属 dev 态后缀 → 仍报偏斜 FAIL exit 1。
    bridgeCopyVersionCase('预发布标识不剥离', baseVersion, baseVersion + '-rc.3', 1,
      '[FAIL] 版本偏斜: loader BRIDGE_VERSION=' + baseVersion + '-rc.3 != 项目 INSTALLED_VERSION=' + baseVersion + '（归一基础版本: loader=' + baseVersion + '-rc.3 / installed=' + baseVersion + '）——两值如上',
      'bridge-check: 失配 1 项——exit 1'),
    // ⑦ release 对 release 失配：两侧均无 dev 后缀且不同 → 仍 FAIL exit 1。
    bridgeCopyVersionCase('release 对 release 失配', baseVersion, '9.9.9-fixture-skew', 1,
      '[FAIL] 版本偏斜: loader BRIDGE_VERSION=9.9.9-fixture-skew != 项目 INSTALLED_VERSION=' + baseVersion + '（归一基础版本: loader=9.9.9-fixture-skew / installed=' + baseVersion + '）——两值如上',
      'bridge-check: 失配 1 项——exit 1'),
  ];
}

// ---------- route-node 共享 Fix 判定纯函数锚（直接调用） ----------

// 协议副本由运行器在场景执行前复制到 <dir>/reference/（见底部运行段）。
export function readScenarioProtocol(dir) {
  return JSON.parse(fs.readFileSync(scenarioProtocolPath(dir), 'utf8'));
}

// 245~247 场景直接调用 route-node 纯函数：缺失导出在此显式报告（RED 定位到具体场景，
// 而不是整套件在模块加载期因命名绑定失败 abort）。
export function requireRouteNodeExport(name) {
  const fn = routeNodeModule?.[name];
  if (typeof fn !== 'function') {
    throw new Error('route-node.mjs 未导出共享 Fix 判定纯函数 ' + name + '（待实现）');
  }
  return fn;
}

// Fix 夹具任务块（串行；字段齐全以通过 task-parsing 解析）
export function fixTaskBlock(id, status) {
  return '<task id="' + id + '" parallel="false" status="' + status + '">'
    + '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>'
    + '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify></task>';
}

// Fix 批次（248~252）场景公共任务集：既有任务 T01 done + 修复任务（状态由参数指定）
export function fixBatchTaskText(fixStatus) {
  return '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n' + fixTaskBlock('T-FIX-01', fixStatus) + '\n';
}

// exit execute 二次完成回源场景公共夹具（场景族拆分后由三个顶层场景共享；每个场景仍在独立
// 临时目录运行，状态不跨场景共享）：家族证据与基础 state 的字段基线在此单一表达。
export function fixReturnFamilyEvidence(taskIds) {
  return {
    execute: { summary: 'fix batch executed', completedChecks: ['required-skill:execute.flow-comet-dev'] },
    'subagent-execute': { summary: 'delegated', handoffResult: handoffFor(taskIds) },
    review: { summary: 'review in progress' },
  };
}

export function fixReturnBaseState(overrides = {}) {
  return {
    activeChange: CHANGE_ID,
    currentNode: 'execute',
    completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
    enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
    evidence: fixReturnFamilyEvidence(['T01']),
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
    newChange: true,
    ...overrides,
  };
}

export const FIX_RETURN_FAMILY_COMPLETED = 'open,design,plan,execute,subagent-execute';

// 回源夹具的 REVIEW.md 正文：内容表达「审查未完成、Fix 批次待回源出口」，文件在场即触发
// 路由按产物跳过 review 的行为。
export const FIX_RETURN_REVIEW_TEXT = '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\n审查结论已记录；Fix 批次由 execute 完成，待回源重新出口。\n';

// 逐任务写入摘要夹具（id 列表由调用场景给出，未列出的任务不会凭空出现摘要）。
export function writeFixReturnSummaries(dir, taskIds) {
  for (const id of taskIds) {
    writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', strictSummary(id));
  }
}

// 并行 Fix 任务集（无依赖 → 可委托）：既有任务 T01 done + parallel 修复任务（状态由参数指定）。
export function fixBatchParallelTaskText(fixStatus) {
  return '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n'
    + '<task id="P-FIX-01" parallel="true" status="' + fixStatus + '">'
    + '<action>实现 P-FIX-01</action><write_files>src/p-fix-01.mjs</write_files>'
    + '<verify>node --check src/p-fix-01.mjs</verify></task>\n';
}

// 家族出口事件过时回放：最新 exit-applied 事件节点为 execute / subagent-execute，
// 签名仍是修复任务追加前的占位值（本批生命周期未闭合的信号；change 缺省 = 旧 state 兼容）。
export function fixBatchHistoryWithStaleFamilyExit(node = 'execute') {
  return [{ event: 'exit-applied', node, at: '2026-09-20T00:00:00.000Z', taskSetSignature: STALE_FIX_BATCH_SIGNATURE }];
}

// done-but-unclosed 回放夹具（历史事故形态）：history 中最新 exit-applied execute 事件记录的
// 签名仍是追加修复任务之前的占位值（与「既有任务 + 追加修复任务」当前任务集签名必然不等）——
// 机器信号 =「修复任务已标 done，但本批 execute 出口从未重新通过」。追加前的真实哈希值不影响
// 判据（只比较是否相等），占位常量让夹具与哈希算法实现解耦；旧 state 无该字段 → 渐进放行。
export const STALE_FIX_BATCH_SIGNATURE = '0'.repeat(64);
export function fixBatchHistoryWithStaleExecuteExit() {
  return [{ event: 'exit-applied', node: 'execute', at: '2026-09-20T00:00:00.000Z', taskSetSignature: STALE_FIX_BATCH_SIGNATURE }];
}

// 读取场景 state 的机器字段（Fix 批次场景的写盘断言：归位/回程真实落盘，不是只看输出）
export function readScenarioState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
}

// ---------- 受控重入（archive 源回边）场景材料（先写期望后执行） ----------
// archive 已 entry 且归档目录仍在原位时的受控重入契约（设计决策清单全部条目 /
// REQUIREMENT AC-1~AC-10）：CLI 入口为
// `workflow-state.mjs reenter <target> --authorized-by <source> --reason <text>`。
// 本段只装配夹具与断言助手；判定语义的唯一权威在 route-node.mjs（测试侧不复制生产判定）；
// 前驱交集期望值由内置协议 success 边独立推导，是测试判据的独立复算。

// 内置协议（route 顺序 open→design→plan→execute→subagent-execute→review→verify→archive）
// 下 predecessors(target) 的期望交集：success 边反向传递闭包，按协议顺序输出。
export const REENTRY_EXPECTED_INTERSECTION = {
  'execute': ['open', 'design', 'plan'],
  'subagent-execute': ['open', 'design', 'plan', 'execute'],
  'review': ['open', 'design', 'plan', 'execute', 'subagent-execute'],
  'verify': ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
};
export const REENTRY_FULL_COMPLETED = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify'];

// archive 已 entry 夹具（AC-1 初始状态）：归档目录仍在原位、status=running、前驱全已完成；
// overrides 覆盖旧 change（无 newChange 字段）/ status=completed / 轮次事件等形态。
// branchMode / enablePrReview / branchPrefix 显式在场——避免 readState 的旧 state 默认补齐
// 让「白名单外字段零改写」断言混入实现细节噪音。
export function reentryArchiveState(overrides = {}) {
  return {
    activeChange: CHANGE_ID,
    currentNode: 'archive',
    completedNodes: [...REENTRY_FULL_COMPLETED],
    enteredNodes: [...REENTRY_FULL_COMPLETED, 'archive'],
    evidence: {},
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
    newChange: true,
    status: 'running',
    branchMode: true,
    enablePrReview: false,
    branchPrefix: 'change/',
    history: [{ event: 'exit-applied', node: 'verify', at: '2026-09-20T00:00:00.000Z', change: CHANGE_ID }],
    ...overrides,
  };
}

// 归档目录仍在原位（移动边界判定的前提之一）：CHANGE.md + TASK.md 在场
export function writeReentryChangeDir(dir, changeName = CHANGE_ID) {
  writeFile(dir, '.specs/' + changeName + '/CHANGE.md', '# CHANGE\n\n## Why\n\n受控重入夹具。\n');
  writeFile(dir, '.specs/' + changeName + '/TASK.md', '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n');
}

// 受控重入 CLI（真实命令路径）：env 显式注入协议路径（门禁不得静默跳过）；
// extra 供 --protocol 等追加参数；reenter 未落地前本路径因 unknown subcommand 必然 RED。
export function runReenter(dir, target, options = {}) {
  const args = ['reenter', target];
  if (options.source !== undefined) args.push('--authorized-by', options.source);
  if (options.reason !== undefined) args.push('--reason', options.reason);
  if (Array.isArray(options.extra)) args.push(...options.extra);
  return runState(args, dir, {
    FLOW_COMET_PROTOCOL: options.protocol || scenarioProtocolPath(dir),
  });
}

// state 原始字节：BLOCK / 空操作路径的「字节零改写」判据（JSON 深比会漏掉格式化、键序与
// 序列化表示漂移——字节比较才是契约）。
export function readStateBytes(dir) {
  const file = path.join(dir, '.flow-comet', 'flow-comet-state.json');
  if (!fs.existsSync(file)) {
    throw new Error('state 文件缺失（夹具错误或命令删除了 state）: ' + file);
  }
  return fs.readFileSync(file, 'utf8');
}

export function assertStateBytesUnchanged(dir, before, label) {
  const after = readStateBytes(dir);
  if (after !== before) {
    throw new Error(label + '：要求 state 字节零改写，实际发生变化\nbefore:\n' + before + '\nafter:\n' + after);
  }
}

// 备份文件清单（备份路径规则 .specs/<change-id>/.reentry-backups/）：BLOCK / 空操作路径必须零新增。
export function reentryBackupFiles(dir, changeName = CHANGE_ID) {
  const backupDir = path.join(dir, '.specs', changeName, '.reentry-backups');
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).sort();
}

// 轮次事件夹具：change 归属字段是跨 change 隔离的唯一依据（写侧必须带 change）——
// 不带 change 的旧事件按 legacy 形态参与（reentry-applied 为新事件类型，实际不会出现）。
export function reentryHistoryEvent(roundNumber, changeName = CHANGE_ID) {
  return {
    event: 'reentry-applied',
    from: 'archive',
    to: 'verify',
    round: roundNumber,
    change: changeName,
    authorization: { round: roundNumber, at: '2026-09-20T00:00:00.000Z', source: 'user-approval', target: 'verify' },
    backup: '.specs/' + changeName + '/.reentry-backups/2026-09-20T00-00-00.000Z-pre-verify.json',
    fingerprint: '0'.repeat(64),
    at: '2026-09-20T00:00:00.000Z',
  };
}

// 授权形态纯函数锚（AC-2 的 guard-self-test 验证方式）：形态合法性由 route-node 的
// parseReentryAuthorization 单一权威判定，本助手只声明期望（malformed → ok:false）。
export function assertReentryAuthorizationShape(authorization, target, expectedOk, label) {
  const parse = requireRouteNodeExport('parseReentryAuthorization');
  const result = parse({ authorization, target });
  if (!result || result.ok !== expectedOk) {
    throw new Error('[' + label + '] 授权形态判定应为 ok=' + expectedOk + '，实际 ' + JSON.stringify(result));
  }
  return result;
}

// 输出正则断言（BLOCK 指引类断言的共享助手；精确关键词断言用 assertOut）。
export function assertOutMatches(res, pattern, label) {
  const text = outputText(res);
  if (!pattern.test(text)) {
    throw new Error((label || '输出') + ' 应匹配 ' + pattern + '，实际输出:\n' + text);
  }
}

// ---------- 受控计划重校重签（replan）与强制推进留痕（advance-forced）场景材料 ----------
// replan 是"计划在执行中被证明有缺陷"时的受控通道（ADR-013）：仅 execute / subagent-execute
// 相位可用、停原位、不跳节点——重新校验任务图与任务字段 → 重录 state.taskHash → 双写留痕
// （evidence.<node>.replanAuthorization + history 事件 replan-applied）。判定语义的唯一权威在
// route-node.mjs（测试侧不复制生产判定）；本段只装配夹具与断言助手。纯函数契约按
// reentry 族同构声明：
//   parseReplanAuthorization({ authorization, node })  // authorization = { round, at, source, reason, node }
//   replanRoundCount({ history, changeName })
//   replanRoundDecision({ history, changeName, continuationAuthorized })
//   replanNoOpDecision({ state, taskContent })
//   resolveReplanDecision({ protocol, state, authorization, continuationRound })
// 缺失导出由 requireRouteNodeExport 在场景内显式报告（RED 可定位到具体场景，不整套件 abort）。

// 修订前的任务集（entry 形态）：一个串行待办任务
export const REPLAN_TASK_INITIAL =
  '<task id="S01" status="pending" parallel="false"><action>实现 S01</action>'
  + '<write_files>src/s01.mjs</write_files><verify>node --check src/s01.mjs</verify></task>\n';
// 修订后的任务集（死锁现场）：原任务完成 + 计划外新增的并行就绪任务
export const REPLAN_TASK_REVISED =
  '<task id="S01" status="done" parallel="false"><action>实现 S01</action>'
  + '<write_files>src/s01.mjs</write_files><verify>node --check src/s01.mjs</verify></task>\n'
  + '<task id="P02" status="pending" parallel="true"><action>实现计划外新增的 P02</action>'
  + '<write_files>src/p02.mjs</write_files><verify>node --check src/p02.mjs</verify></task>\n';
// 缺 <verify> 字段的负例任务集（plan 出口与 replan 共用的任务字段校验）
export const REPLAN_TASK_NO_VERIFY =
  '<task id="S01" status="pending" parallel="false"><action>实现 S01</action>'
  + '<write_files>src/s01.mjs</write_files></task>\n';
// 过期签名占位（与哈希算法实现解耦：只比较是否相等/同版本，不依赖真实摘要值）
export const REPLAN_STALE_SIGNATURE = 'v1:' + '0'.repeat(64);

// replan 相位夹具：execute 已 entry、前序完成、证据齐备（execute 出口可通过）、TASK.md 在场。
// branchMode / enablePrReview / branchPrefix 显式在场——避免 readState 兼容默认值让「零改写」
// 口径混入实现细节噪音（与受控重入夹具同做法）。
export function replanExecuteState(overrides = {}) {
  return {
    activeChange: CHANGE_ID,
    currentNode: 'execute',
    completedNodes: ['open', 'design', 'plan'],
    enteredNodes: ['open', 'design', 'plan', 'execute'],
    evidence: {
      open: { summary: 'open done' },
      design: { summary: 'design done' },
      plan: { summary: 'plan done' },
      execute: { summary: 'implementation recorded' },
      'subagent-execute': { handoffResult: handoffFor(['S01']) },
    },
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
    newChange: true,
    status: 'running',
    branchMode: false,
    enablePrReview: false,
    branchPrefix: 'change/',
    history: [{ event: 'exit-applied', node: 'plan', at: '2026-09-27T00:00:00.000Z', change: CHANGE_ID }],
    ...overrides,
  };
}

// 备份目录/清单（replan 备份规则 .specs/<change-id>/replan-backups/）：BLOCK / 空操作路径零新增。
export function replanBackupFiles(dir, changeName = CHANGE_ID) {
  const backupDir = path.join(dir, '.specs', changeName, 'replan-backups');
  return fs.existsSync(backupDir) ? fs.readdirSync(backupDir).sort() : [];
}

// replan-applied 事件过滤（轮次按 change 从 history 派生——与受控重入同计数法）
export function replanEventsOf(state) {
  return (state.history || []).filter((e) => e && e.event === 'replan-applied');
}

// 轮次事件夹具：change 归属字段是跨 change 隔离的唯一依据（写侧必须带 change）
export function replanHistoryEvent(roundNumber, changeName = CHANGE_ID) {
  return {
    event: 'replan-applied',
    node: 'execute',
    round: roundNumber,
    change: changeName,
    reason: '计划重校',
    authorizedBy: 'user-approval',
    taskSetSignature: REPLAN_STALE_SIGNATURE,
    at: '2026-09-27T00:00:00.000Z',
  };
}

// advance-forced 事件夹具（status.forcedNodes 事件判据）：change 归属过滤与 advance 写侧同形——
// 派生只取 event / change / node，skipped 等字段保留以贴近真实事件。
export function advanceForcedEvent(node, changeName = CHANGE_ID) {
  return {
    event: 'advance-forced',
    change: changeName,
    node,
    skipped: ['exit:' + node],
    reason: 'advance',
    at: '2026-09-28T00:00:00.000Z',
  };
}

// 授权形态纯函数锚（AC-2 的 guard-self-test 验证方式）：形态合法性由 route-node 的
// parseReplanAuthorization 单一权威判定，本助手只声明期望（malformed → ok:false）。
export function assertReplanAuthorizationShape(authorization, node, expectedOk, label) {
  const parse = requireRouteNodeExport('parseReplanAuthorization');
  const result = parse({ authorization, node });
  if (!result || result.ok !== expectedOk) {
    throw new Error('[' + label + '] replan 授权形态判定应为 ok=' + expectedOk + '，实际 ' + JSON.stringify(result));
  }
  return result;
}

// 重签复核：state.taskHash 必须等于当前 TASK.md 的签名（同版本比较复用 route-node 既有实现，
// 不在此内联第二份判据）。
export function assertReplanSignatureRecorded(state, taskContent, label) {
  const same = requireRouteNodeExport('sameTaskSetSignature');
  const signature = requireRouteNodeExport('taskSetSignature')(taskContent);
  if (!same(state.taskHash, signature)) {
    throw new Error(label + '：state.taskHash 应重签为当前 TASK.md 的签名，实际 '
      + JSON.stringify(state.taskHash) + '，期望 ' + JSON.stringify(signature));
  }
  return signature;
}

// status 输出（JSON 块 + 尾巴行）解析：只取首个 { 到末个 } 之间的 JSON 对象。
export function parseStatusJson(res) {
  const text = outputText(res);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('status 输出缺少 JSON 块:\n' + text);
  return JSON.parse(text.slice(start, end + 1));
}

// 场景协议副本路径（单一来源）：以 dir 为基准的协议路径表达式只在此处出现一次；
// 调用面统一走下方助手。跨树（root）/ 安装副本（skillCopy）/ 自定义协议（options.protocol 或
// --protocol CLI）场景仍各自显式传路径，不经本助手（数据点保留）。
export function scenarioProtocolPath(dir) {
  return path.join(dir, 'reference', 'workflow-protocol.json');
}

// 场景内受控命令（replan / advance / status / next）：显式注入场景协议副本路径
// （依赖协议解析的门禁不得静默跳过；副本由运行器预置在 <dir>/reference/）。
export function runStateWithProtocol(dir, args) {
  return runState(args, dir, { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
}

// 同形 runGuard 助手（入口/出口门禁场景）：注入与 runStateWithProtocol 同一 FLOW_COMET_PROTOCOL 表达。
export function runGuardWithProtocol(dir, args) {
  return runGuard(args, dir, { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
}

// ---------- 伪造材料 ----------

