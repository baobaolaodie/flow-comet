// 场景组 j — Fix 回程（多趟收尾与签名元数据 / 回程豁免 / 越界拦截）· 受控归位 · 技能树文本锁
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界：场景序列按组文件规模上限连续分区——本文件先承载 J 组场景、后承载 K 组头部两项（259 · 260）；
// 分区只搬文件，场景名/内容与其在入口 `SCENARIOS` 里的拼接顺序均不变。

import fs from 'fs';
import path from 'path';
import {
  assertExit,
  assertNotOut,
  assertOut,
  runGuard,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  SCRIPTS_DIR,
  handoffFor,
  renderMultiWaveTasks,
  resolveComponentSkillFile,
  routeNodeModule,
  strictSummary,
  writeIntakeArtifacts,
} from '../lib/test-fixtures.mjs';
import {
  FIX_RETURN_FAMILY_COMPLETED,
  FIX_RETURN_REVIEW_TEXT,
  REENTRY_EXPECTED_INTERSECTION,
  REENTRY_FULL_COMPLETED,
  STALE_FIX_BATCH_SIGNATURE,
  assertReentryAuthorizationShape,
  assertStateBytesUnchanged,
  assertStateOnlyChanged,
  fixBatchHistoryWithStaleExecuteExit,
  fixBatchHistoryWithStaleFamilyExit,
  fixBatchParallelTaskText,
  fixBatchTaskText,
  fixReturnBaseState,
  fixReturnFamilyEvidence,
  fixTaskBlock,
  readScenarioProtocol,
  readScenarioState,
  readStateBytes,
  reentryArchiveState,
  reentryBackupFiles,
  requireRouteNodeExport,
  runReenter,
  runStateWithProtocol,
  writeFixReturnSummaries,
  writeReentryChangeDir,
} from '../lib/test-assertions.mjs';
import {
  FIX_LOOP_AUTHORITY_KEYWORDS,
  FIX_LOOP_AUTHORITY_REL,
  FIX_LOOP_BOOK_ELEMENT_GROUPS,
  fixLoopStateMachineProblems,
  fixLoopStateMachineSectionOf,
} from '../lib/text-anchor-checks.mjs';
import { createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';

export const ENTRIES = [

  // 250c: 多趟收尾与签名元数据——中性回程 / 多波次真实修复 / 任务集签名同版本三态。
  // 本场景族拆自原 250 单场景，断言与失败信息保持不变。
  {
    name: '250c 多趟收尾与签名元数据：中性回程、多波次修复、任务集签名三态',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      writeFixReturnSummaries(dir, ['T01', 'T-FIX-01']);
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', FIX_RETURN_REVIEW_TEXT);
      // state 不变量统一走 assertStateOnlyChanged（白名单外深比 + history 旧前缀稳定 + 恰新增
      // 一条 exit-applied）——白名单仅 currentNode（既有路由覆盖 next）、status（既有 apply 写
      // running/completed）、history（既有出口事件追加）；execute 证据的 completedChecks 已预置，
      // 不在白名单内假豁免。

      // 250b 正常多趟最终 exit：无 Fix 任务、历史家族出口签名 == 当前 TASK 签名 → 中性
      // RETURN（正常多趟收尾，非 Fix 回修）；不得出现 FIX-BATCH；NODE/state 与收口前一致。
      const normalTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n';
      const normalSignature = routeNodeModule.taskSetSignature(normalTaskText);
      writeFile(dir, taskPath, normalTaskText);
      writeState(dir, fixReturnBaseState({
        history: [{
          event: 'exit-applied', node: 'subagent-execute', change: CHANGE_ID,
          at: '2026-09-23T00:00:00.000Z', taskSetSignature: normalSignature,
        }],
      }));
      const beforeNormal = readScenarioState(dir);
      const resNormal = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resNormal, 0);
      assertOut(resNormal, 'RETURN: 回源节点 review（execute 出口已完成；正常多趟收尾，非 Fix 回修）');
      assertOut(resNormal, 'NODE: review');
      assertNotOut(resNormal, 'FIX-BATCH');
      assertNotOut(resNormal, 'NODE: verify');
      const afterNormal = readScenarioState(dir);
      if (afterNormal.currentNode !== 'review' || afterNormal.completedNodes.join(',') !== FIX_RETURN_FAMILY_COMPLETED) {
        throw new Error('正常多趟回程应只覆盖路由到 review 且 completedNodes 不变，实际 '
          + JSON.stringify({ currentNode: afterNormal.currentNode, completedNodes: afterNormal.completedNodes }));
      }
      const [normalAppended] = assertStateOnlyChanged(beforeNormal, afterNormal, {
        label: '250b 正常多趟回程',
        allowed: ['currentNode', 'status', 'history'],
      });
      // m-14 新版本元数据锚：exit-applied 事件带 signatureAlgo 且签名值为 vN:<digest> 形态
      if (!normalAppended || normalAppended.node !== 'execute' || normalAppended.change !== CHANGE_ID
        || normalAppended.taskSetSignature !== normalSignature
        || !/^v\d+:[0-9a-f]{64}$/.test(String(normalAppended.taskSetSignature))
        || normalAppended.signatureAlgo !== routeNodeModule.TASK_SET_SIGNATURE_ALGO) {
        throw new Error('正常多趟出口事件应记录本 change + vN:<digest> 签名 + signatureAlgo 元数据，实际 '
          + JSON.stringify(normalAppended));
      }
      const normalExit = (afterNormal.history || []).pop();
      if (!normalExit || normalExit.node !== 'execute' || normalExit.change !== CHANGE_ID
        || normalExit.taskSetSignature !== normalSignature) {
        throw new Error('正常多趟出口事件形状应与既有一致（node/change/taskSetSignature），实际 '
          + JSON.stringify(normalExit));
      }

      // 250c 多波次真实 Fix：历史旧签名 ≠ 当前、最新签名 == 当前（只看最新会漏判）→ 保留
      // FIX-BATCH（全量扫描）；TASK 含修复任务与结构标记。
      const multiWaveTaskText = fixBatchTaskText('done');
      const multiWaveSignature = routeNodeModule.taskSetSignature(multiWaveTaskText);
      writeFile(dir, taskPath, multiWaveTaskText);
      writeState(dir, fixReturnBaseState({
        evidence: fixReturnFamilyEvidence(['T01', 'T-FIX-01']),
        history: [
          {
            event: 'exit-applied', node: 'execute', change: CHANGE_ID,
            at: '2026-09-20T00:00:00.000Z', taskSetSignature: STALE_FIX_BATCH_SIGNATURE,
          },
          {
            event: 'exit-applied', node: 'subagent-execute', change: CHANGE_ID,
            at: '2026-09-24T00:00:00.000Z', taskSetSignature: multiWaveSignature,
          },
        ],
      }));
      const resMultiWave = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resMultiWave, 0);
      assertOut(resMultiWave, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertOut(resMultiWave, 'NODE: review');
      assertNotOut(resMultiWave, 'RETURN: 回源节点');

      writeFile(dir, '.specs/' + CHANGE_ID + '/T02-SUMMARY.md', strictSummary('T02'));
      // 250j~l m-14 C3 三态（guard exit 入口签名比对消费点）：同版本一致 → 放行；
      // 同版本不一致 → BLOCK；跨算法版本 → SIGNATURE-ALGO WARN 跳过比对不阻断。
      writeFile(dir, 'flow-kit/templates/TASK.md',
        '# TASK 模板\n\n## Fix Tasks（来自 REVIEW / INTEGRATION）\n');
      const renamedTplTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n'
        + '## Fix Tasks ##\n\n' + fixTaskBlock('T02', 'done') + '\n';
      writeFile(dir, taskPath, renamedTplTaskText);
      const c3Evidence = fixReturnFamilyEvidence(['T01', 'T02']);
      const c3Digest = routeNodeModule.parseTaskSetSignature(
        routeNodeModule.taskSetSignature(renamedTplTaskText))?.digest;
      writeState(dir, fixReturnBaseState({ evidence: c3Evidence, history: [], taskHash: routeNodeModule.taskSetSignature(renamedTplTaskText) }));
      const resC3Same = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resC3Same, 0);
      assertNotOut(resC3Same, 'BLOCKED');
      // 同版本不一致（占位 digest）→ 新 change BLOCK 任务集被修改
      writeState(dir, fixReturnBaseState({ evidence: c3Evidence, history: [], taskHash: 'v1:' + '0'.repeat(64) }));
      const resC3Diff = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resC3Diff, 1);
      assertOut(resC3Diff, 'BLOCKED: TASK.md 任务集被修改');
      // 跨算法版本（v2 值 + v2 声明）→ 不可比，WARN 跳过比对，不误拦任务集
      writeState(dir, fixReturnBaseState({ evidence: c3Evidence, history: [], taskHash: 'v2:' + c3Digest }));
      const resC3Skew = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resC3Skew, 0);
      assertOut(resC3Skew, 'SIGNATURE-ALGO WARN');
      assertNotOut(resC3Skew, 'BLOCKED: TASK.md 任务集被修改');
    },
  },
  // 251: exit execute --apply Fix 二次完成回源（verify 源）——TEST.md/UAT.md 已在场
  // （resolveNextNode 会按产物跳过 verify 去 archive）但 verify 未完成 → 受控回程 verify。
  {
    name: '251 exit execute --apply Fix 二次完成：回源 verify（TEST/UAT 在场但不按产物跳过）',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\n审查结论已记录；待回源 verify 重新出口。\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify'],
        evidence: {
          execute: { summary: 'fix batch executed' },
          'subagent-execute': { summary: 'delegated', handoffResult: handoffFor(['T01', 'T-FIX-01']) },
          review: { summary: 'review complete' },
          verify: { summary: 'verify in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      });
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertOut(res, 'FIX-BATCH: 回源节点 verify（execute 出口已完成）');
      assertOut(res, 'NODE: verify');
      assertNotOut(res, 'NODE: archive');
      const after = readScenarioState(dir);
      if (after.currentNode !== 'verify') {
        throw new Error('Fix 回程后 currentNode 应为 verify，实际 ' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 252: 越界拦截 + 恢复 + 旧 change 渐进——源节点（review/verify）驻留且 TASK 有 pending Fix
  // 任务时直接 exit 源节点收场：新 change BLOCKED 且含恢复指引（不许静默跳过 execute 出口门禁）；
  // 按指引 entry execute 归位 → 完成修复 → exit execute 回源节点可恢复；
  // done-but-unclosed 变体（全任务 done 但本批 execute 出口未重跑：history 最新 exit execute
  // 签名与当前任务集不等）同样 BLOCKED 且 state 零改写，闭合后源节点出口恢复通过；
  // 旧 change（无 newChange 标记）保持渐进 WARN 不阻断（向后兼容）。
  {
    name: '252 越界：源节点 + pending/done-but-unclosed Fix 直接 exit 源节点 BLOCK（新）/WARN（旧）+ 恢复闭环',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\n审查发现需修复项，Fix 任务已追加；待 execute 出口完成后重新出口。\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      const reviewState = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: {
          execute: { summary: 'first pass executed' },
          'subagent-execute': { summary: 'delegated', handoffResult: handoffFor(['T01']) },
          review: { summary: 'review in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ① 新 change：review 源直接 exit review --apply → BLOCKED + 恢复指引（不得静默放行）
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, reviewState);
      const resBlock = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(resBlock, 1);
      assertOut(resBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(resBlock, 'entry execute');
      assertNotOut(resBlock, 'ALL CHECKS PASSED');
      let after = readScenarioState(dir);
      if (after.currentNode !== 'review' || after.completedNodes.includes('review')) {
        throw new Error('BLOCK 不得改写 state（review 未完成/未推进），实际 '
          + JSON.stringify({ currentNode: after.currentNode, completedNodes: after.completedNodes }));
      }
      // ② 恢复：entry execute 受控归位 → 完成 Fix 任务并补 SUMMARY/handoff → exit execute 回源 review
      const recEntry = runGuard(['entry', 'execute'], dir);
      assertExit(recEntry, 0);
      assertOut(recEntry, 'FIX-BATCH: 受控归位 execute（源节点 review）');
      after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('恢复步 entry execute 应归位 execute，实际 ' + JSON.stringify(after.currentNode));
      }
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      after = readScenarioState(dir);
      after.evidence['subagent-execute'] = after.evidence['subagent-execute'] || {};
      after.evidence['subagent-execute'].handoffResult = {
        ...(after.evidence['subagent-execute'].handoffResult || {}),
        ...handoffFor(['T-FIX-01']),
      };
      writeState(dir, after);
      const recExit = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(recExit, 0);
      assertOut(recExit, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      if (readScenarioState(dir).currentNode !== 'review') {
        throw new Error('恢复闭环 exit execute 后应回源 review，实际 ' + JSON.stringify(readScenarioState(dir).currentNode));
      }
      // ③ 新 change：verify 源 + TEST/UAT 产物在场（原路径会跳过 verify 去 archive）→ 同样 BLOCKED
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, {
        ...reviewState,
        currentNode: 'verify',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify'],
        evidence: { ...reviewState.evidence, verify: { summary: 'verify in progress' } },
      });
      const resVerifyBlock = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(resVerifyBlock, 1);
      assertOut(resVerifyBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(resVerifyBlock, 'entry execute');
      assertNotOut(resVerifyBlock, 'ALL CHECKS PASSED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'verify' || after.completedNodes.includes('verify')) {
        throw new Error('verify 源 BLOCK 不得改写 state，实际 '
          + JSON.stringify({ currentNode: after.currentNode, completedNodes: after.completedNodes }));
      }
      // ③b 越界恢复指引优先于通用 entry 提示：同路径但无 enter 痕迹（enteredNodes 缺失）
      // 仍须给 Fix 恢复指引（不得被「未执行 entry 直接 exit」通用提示覆盖）。
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, { ...reviewState, enteredNodes: [] });
      const resNoEntryBlock = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(resNoEntryBlock, 1);
      assertOut(resNoEntryBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNotOut(resNoEntryBlock, '未执行 entry 直接 exit');
      // ③c 新 change done-but-unclosed（review 源）：Fix 任务已 done，但 history 最新 exit
      // execute 签名仍是追加前值（本批 execute 出口从未重跑）→ 必须 BLOCKED 且 state 字节零
      // 改写（修复前此路径静默放行为 NODE: verify / archive）。
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeState(dir, { ...reviewState, history: fixBatchHistoryWithStaleExecuteExit() });
      const staleReviewBytes = fs.readFileSync(statePath, 'utf8');
      const resDoneBlock = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(resDoneBlock, 1);
      assertOut(resDoneBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(resDoneBlock, 'entry execute');
      assertOut(resDoneBlock, 'workflow-state.mjs next');
      assertOut(resDoneBlock, '恢复');
      assertNotOut(resDoneBlock, 'ALL CHECKS PASSED');
      if (fs.readFileSync(statePath, 'utf8') !== staleReviewBytes) {
        throw new Error('done-but-unclosed BLOCK 不得改写 state 字节');
      }
      // ③c-2 恢复闭环：entry execute 归位 → 补 handoff → exit execute --apply 写当前签名 →
      // 回源 review → exit review 通过（闭合后 done 变体不再拦截）。
      const recDoneEntry = runGuard(['entry', 'execute'], dir);
      assertExit(recDoneEntry, 0);
      assertOut(recDoneEntry, 'FIX-BATCH: 受控归位 execute（源节点 review）');
      after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('done-but-unclosed 恢复步 entry execute 应归位 execute，实际 ' + JSON.stringify(after.currentNode));
      }
      after.evidence['subagent-execute'] = after.evidence['subagent-execute'] || {};
      after.evidence['subagent-execute'].handoffResult = {
        ...(after.evidence['subagent-execute'].handoffResult || {}),
        ...handoffFor(['T-FIX-01']),
      };
      writeState(dir, after);
      assertExit(runStateWithProtocol(dir, ['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md']), 0);
      const recDoneExit = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(recDoneExit, 0);
      assertOut(recDoneExit, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertOut(recDoneExit, 'NODE: review');
      assertExit(runStateWithProtocol(dir, ['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md']), 0);
      assertExit(runGuard(['entry', 'review'], dir), 0);
      const recDoneReview = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(recDoneReview, 0);
      assertOut(recDoneReview, 'ALL CHECKS PASSED');
      assertNotOut(recDoneReview, 'BLOCKED');
      // ③d 新 change done-but-unclosed（verify 源）：TEST/UAT 在场（原路径会跳过 verify 去
      // archive）+ 全 Fix 任务 done + 最新 exit execute 签名过时 → BLOCKED，验证命令未执行，
      // state 字节零改写；闭合后 exit verify 真实执行验证命令并推进 archive。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md',
        '# TEST\n\n## 验证命令\n\n```\nnode -e "require(\'fs\').writeFileSync(\'verify-gate-ran.txt\', \'GATE-RAN\')"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
      const gateMarker = path.join(dir, 'verify-gate-ran.txt');
      fs.rmSync(gateMarker, { force: true });
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeState(dir, {
        ...reviewState,
        currentNode: 'verify',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify'],
        evidence: { ...reviewState.evidence, review: { summary: 'review complete' }, verify: { summary: 'verify in progress' } },
        history: fixBatchHistoryWithStaleExecuteExit(),
      });
      const staleVerifyBytes = fs.readFileSync(statePath, 'utf8');
      const resDoneVerifyBlock = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(resDoneVerifyBlock, 1);
      assertOut(resDoneVerifyBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(resDoneVerifyBlock, 'entry execute');
      assertNotOut(resDoneVerifyBlock, 'ALL CHECKS PASSED');
      if (fs.existsSync(gateMarker)) throw new Error('done-but-unclosed verify BLOCK 不得执行验证命令');
      if (fs.readFileSync(statePath, 'utf8') !== staleVerifyBytes) {
        throw new Error('done-but-unclosed verify BLOCK 不得改写 state 字节');
      }
      const recDoneVerifyEntry = runGuard(['entry', 'execute'], dir);
      assertExit(recDoneVerifyEntry, 0);
      assertOut(recDoneVerifyEntry, 'FIX-BATCH: 受控归位 execute（源节点 verify）');
      after = readScenarioState(dir);
      after.evidence['subagent-execute'] = after.evidence['subagent-execute'] || {};
      after.evidence['subagent-execute'].handoffResult = {
        ...(after.evidence['subagent-execute'].handoffResult || {}),
        ...handoffFor(['T-FIX-01']),
      };
      writeState(dir, after);
      assertExit(runStateWithProtocol(dir, ['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md']), 0);
      const recDoneVerifyExit = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(recDoneVerifyExit, 0);
      assertOut(recDoneVerifyExit, 'FIX-BATCH: 回源节点 verify（execute 出口已完成）');
      assertOut(recDoneVerifyExit, 'NODE: verify');
      assertExit(runStateWithProtocol(dir, ['skill-load', 'verify', 'flow-comet-verify', '--prompt', 'flow-kit/prompts/7-integration.md']), 0);
      assertExit(runGuard(['entry', 'verify'], dir), 0);
      const recDoneVerify = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(recDoneVerify, 0);
      assertOut(recDoneVerify, 'ALL CHECKS PASSED');
      assertOut(recDoneVerify, 'NODE: archive');
      if (!fs.existsSync(gateMarker) || fs.readFileSync(gateMarker, 'utf8') !== 'GATE-RAN') {
        throw new Error('闭合后 verify 出口未真实执行 TEST.md 验证命令（副作用文件缺失/内容不符）');
      }
      // ④ 旧 change（无 newChange 标记）pending 同路径：渐进 WARN 不阻断（向后兼容）
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, { ...reviewState, newChange: false });
      const resOld = runGuard(['exit', 'review'], dir);
      assertExit(resOld, 0);
      assertOut(resOld, 'FIX-BATCH WARN');
      assertOut(resOld, 'ALL CHECKS PASSED');
      // ④b 过渡态渐进（feature 之前创建的 state 无 exit execute 签名字段）：全 done 也不得
      // 仅凭「签名缺席」误判未闭合——无签名记录 → done 变体不成立，源节点出口保持可走
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeState(dir, { ...reviewState, history: [{ event: 'exit-applied', node: 'execute', at: '2026-09-19T00:00:00.000Z' }] });
      const resLegacyState = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(resLegacyState, 0);
      assertNotOut(resLegacyState, 'BLOCKED');
      assertOut(resLegacyState, 'ALL CHECKS PASSED');
      // ⑤ 并行 Fix 任务（pending）+ review 源：直接 exit review 仍 BLOCKED；next/entry 归位
      // subagent-execute；修复后 exit subagent-execute --apply 为第二趟完成 → 回源 review，
      // 源节点出口随后真实执行（闭合后不得再拦）。
      writeFile(dir, taskPath, fixBatchParallelTaskText('pending'));
      writeState(dir, reviewState);
      const rParBlock = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(rParBlock, 1);
      assertOut(rParBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNotOut(rParBlock, 'ALL CHECKS PASSED');
      writeState(dir, reviewState);
      const rParNext = runStateWithProtocol(dir, ['next']);
      assertExit(rParNext, 0);
      assertOut(rParNext, 'FIX-BATCH: 归位 subagent-execute（源节点 review）');
      assertOut(rParNext, 'NODE: subagent-execute');
      assertNotOut(rParNext, 'NODE: execute');
      writeState(dir, reviewState);
      const rParEntry = runGuard(['entry', 'subagent-execute'], dir);
      assertExit(rParEntry, 0);
      assertOut(rParEntry, 'FIX-BATCH: 受控归位 subagent-execute（源节点 review）');
      after = readScenarioState(dir);
      if (after.currentNode !== 'subagent-execute') {
        throw new Error('并行回退态 entry subagent-execute 后 currentNode 应为 subagent-execute，实际 ' + JSON.stringify(after.currentNode));
      }
      writeFile(dir, taskPath, fixBatchParallelTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P-FIX-01-SUMMARY.md', strictSummary('P-FIX-01'));
      after.evidence['subagent-execute'] = after.evidence['subagent-execute'] || {};
      after.evidence['subagent-execute'].summary = 'parallel fix delegated and collected';
      after.evidence['subagent-execute'].handoffResult = {
        ...(after.evidence['subagent-execute'].handoffResult || {}),
        ...handoffFor(['P-FIX-01']),
      };
      writeState(dir, after);
      assertExit(runStateWithProtocol(dir, ['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md']), 0);
      const rParExit = runGuard(['exit', 'subagent-execute', '--apply'], dir);
      assertExit(rParExit, 0);
      assertOut(rParExit, 'FIX-BATCH: 回源节点 review（subagent-execute 出口已完成）');
      assertOut(rParExit, 'NODE: review');
      after = readScenarioState(dir);
      if (after.currentNode !== 'review') {
        throw new Error('并行修复第二趟出口后应回源 review，实际 ' + JSON.stringify(after.currentNode));
      }
      const parFamilyExit = (after.history || [])
        .filter((e) => e && e.event === 'exit-applied' && e.node === 'subagent-execute').pop();
      if (!parFamilyExit || parFamilyExit.change !== CHANGE_ID
        || typeof parFamilyExit.taskSetSignature !== 'string' || parFamilyExit.taskSetSignature === '') {
        throw new Error('并行修复出口应记录本 change + taskSetSignature 的家族出口事件，实际 ' + JSON.stringify(parFamilyExit));
      }
      assertExit(runStateWithProtocol(dir, ['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md']), 0);
      assertExit(runGuard(['entry', 'review'], dir), 0);
      const rParSource = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(rParSource, 0);
      assertOut(rParSource, 'ALL CHECKS PASSED');
      assertNotOut(rParSource, 'BLOCKED');
      // ⑥ verify 源 + 并行 pending：直接 exit verify 同样 BLOCKED（不得绕过家族生命周期）。
      writeFile(dir, taskPath, fixBatchParallelTaskText('pending'));
      writeState(dir, {
        ...reviewState,
        currentNode: 'verify',
        completedNodes: [...reviewState.completedNodes, 'review'],
        enteredNodes: [...reviewState.enteredNodes, 'verify'],
        evidence: { ...reviewState.evidence, review: { summary: 'review complete' }, verify: { summary: 'verify in progress' } },
      });
      const rParVerifyBlock = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(rParVerifyBlock, 1);
      assertOut(rParVerifyBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNotOut(rParVerifyBlock, 'ALL CHECKS PASSED');
      // ⑦ done-but-unclosed 并行变体：全 done + 最新家族出口事件（subagent-execute）签名过时
      // → 直接 exit review BLOCKED；entry 归位 subagent-execute；第二趟出口写当前签名并回源。
      writeFile(dir, taskPath, fixBatchParallelTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P-FIX-01-SUMMARY.md', strictSummary('P-FIX-01'));
      writeState(dir, { ...reviewState, history: fixBatchHistoryWithStaleFamilyExit('subagent-execute') });
      const rDoneParBlock = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(rDoneParBlock, 1);
      assertOut(rDoneParBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNotOut(rDoneParBlock, 'ALL CHECKS PASSED');
      const rDoneParEntry = runGuard(['entry', 'subagent-execute'], dir);
      assertExit(rDoneParEntry, 0);
      assertOut(rDoneParEntry, 'FIX-BATCH: 受控归位 subagent-execute（源节点 review）');
      after = readScenarioState(dir);
      after.evidence['subagent-execute'] = after.evidence['subagent-execute'] || {};
      after.evidence['subagent-execute'].handoffResult = {
        ...(after.evidence['subagent-execute'].handoffResult || {}),
        ...handoffFor(['P-FIX-01']),
      };
      writeState(dir, after);
      assertExit(runStateWithProtocol(dir, ['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md']), 0);
      const rDoneParExit = runGuard(['exit', 'subagent-execute', '--apply'], dir);
      assertExit(rDoneParExit, 0);
      assertOut(rDoneParExit, 'FIX-BATCH: 回源节点 review（subagent-execute 出口已完成）');
      if (readScenarioState(dir).currentNode !== 'review') {
        throw new Error('done-but-unclosed 并行变体闭合后应回源 review，实际 ' + JSON.stringify(readScenarioState(dir).currentNode));
      }
      // ④c change 隔离：history 最新 exit 事件属于另一个 change（state.history 跨 change 保留）
      // → 不得拿它当本 change 的闭合签名；本 change 无该字段的出口事件，done 变体不成立。
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeState(dir, {
        ...reviewState,
        history: [{
          event: 'exit-applied', node: 'execute', change: 'other-change',
          at: '2026-09-20T00:00:00.000Z', taskSetSignature: STALE_FIX_BATCH_SIGNATURE,
        }],
      });
      const resOtherChange = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(resOtherChange, 0);
      assertNotOut(resOtherChange, 'BLOCKED');
      assertOut(resOtherChange, 'ALL CHECKS PASSED');
    },
  },

  // 253a: next Fix 回退态显式归位——源节点（review / verify）驻留 + TASK 有 pending Fix 任务时，
  // next 必须显式归位 execute、写盘并输出审计行，不再依赖 inProgress 保护的副作用
  // （修复前 next 仍输出源节点）。串行族：review 源、verify 源各一段。
  {
    name: '253a next Fix 回退态显式归位：review/verify 源串行 pending',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const base = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: {
          execute: { summary: 'first pass executed' },
          review: { summary: 'review in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ① review 源：pending Fix 任务在场 → NODE: execute + 审计行 + 机器字段归位写盘
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, base);
      const resReview = runStateWithProtocol(dir, ['next']);
      assertExit(resReview, 0);
      assertOut(resReview, 'FIX-BATCH: 归位 execute（源节点 review）');
      assertOut(resReview, 'NODE: execute');
      assertNotOut(resReview, 'NODE: review');
      assertNotOut(resReview, 'NODE: verify');
      assertNotOut(resReview, 'BLOCKED');
      let after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('review 源回退态 next 后 currentNode 应为 execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // ② verify 源（review 已完成）→ 同样显式归位 + 审计行 + 写盘
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, {
        ...base,
        currentNode: 'verify',
        completedNodes: [...base.completedNodes, 'review'],
        enteredNodes: [...base.enteredNodes, 'verify'],
        evidence: { ...base.evidence, review: { summary: 'review complete' }, verify: { summary: 'verify in progress' } },
      });
      const resVerify = runStateWithProtocol(dir, ['next']);
      assertExit(resVerify, 0);
      assertOut(resVerify, 'FIX-BATCH: 归位 execute（源节点 verify）');
      assertOut(resVerify, 'NODE: execute');
      assertNotOut(resVerify, 'NODE: verify');
      assertNotOut(resVerify, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('verify 源回退态 next 后 currentNode 应为 execute，实际 ' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 253b: 非回退态不得归位——全 done（无 pending Fix 任务）与「无 pending 的回程态」两段：
  // state 侧无 Fix 因果时不得出现任何 FIX-BATCH 行，也不得把 currentNode 改到 execute。
  {
    name: '253b next Fix 回退态反例：无 pending 不归位 execute',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const base = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: {
          execute: { summary: 'first pass executed' },
          review: { summary: 'review in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ③ 反例：全 done（无 pending Fix 任务）→ 非回退态，不得归位 execute（回程逻辑另行覆盖）
      let after;
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nFix 批次由 execute 完成，待回源重新出口。\n');
      writeState(dir, base);
      const resNoFix = runStateWithProtocol(dir, ['next']);
      assertExit(resNoFix, 0);
      assertNotOut(resNoFix, 'FIX-BATCH: 归位 execute');
      // ③ 全局缺席：无 pending Fix 任务的回程态，state 侧无 Fix 因果——不得出现任何 FIX-BATCH
      // （含旧「回程源节点」误标形态；回程中性行由 RETURN 覆盖）
      assertNotOut(resNoFix, 'FIX-BATCH');
      assertNotOut(resNoFix, 'NODE: execute');
      assertOut(resNoFix, 'NODE: review');
      after = readScenarioState(dir);
      if (after.currentNode !== 'review') {
        throw new Error('无 pending 时不应归位 execute，实际 ' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 253c: done-but-unclosed 串行回退态——全 done 但 history 最新 exit execute 的签名仍是追加前的
  // 旧值：next 同样必须显式归位 execute（修复前 done 变体无恢复通道，next 停在源节点）。
  {
    name: '253c next Fix 回退态：done-but-unclosed（签名过时）仍归位',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const base = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: {
          execute: { summary: 'first pass executed' },
          review: { summary: 'review in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ④ done-but-unclosed 回退态（全 done + history 最新 exit execute 签名仍是追加前值）：
      // next 同样显式归位 execute（修复前 done 变体无恢复通道，next 停在源节点）。
      // 前置沿用该族的「全 done」夹具形态：TASK 全 done + 两个 done 任务的 SUMMARY + REVIEW.md。
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nFix 批次由 execute 完成，待回源重新出口。\n');
      let after;
      writeState(dir, { ...base, history: fixBatchHistoryWithStaleExecuteExit() });
      const resDoneRollback = runStateWithProtocol(dir, ['next']);
      assertExit(resDoneRollback, 0);
      assertOut(resDoneRollback, 'FIX-BATCH: 归位 execute（源节点 review）');
      assertOut(resDoneRollback, 'NODE: execute');
      assertNotOut(resDoneRollback, 'NODE: review');
      assertNotOut(resDoneRollback, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('done-but-unclosed 回退态 next 后 currentNode 应为 execute，实际 ' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 253d: 并行 pending Fix 任务的归位目标——review 源 / verify 源 / done-but-unclosed 并行变体：
  // 归位目标是事件记录的家族节点（subagent-execute），不得停在源节点、也不得错配回 execute。
  {
    name: '253d next Fix 回退态归位：并行 pending → subagent-execute（含 done-but-unclosed 变体）',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const base = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: {
          execute: { summary: 'first pass executed' },
          review: { summary: 'review in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ⑤ review 源 + 并行 pending Fix 任务：next 必须归位 subagent-execute（并行路由目标），
      // 不得停在源节点，也不得错配回 execute。
      let after;
      writeFile(dir, taskPath, fixBatchParallelTaskText('pending'));
      writeState(dir, base);
      const resParallelReview = runStateWithProtocol(dir, ['next']);
      assertExit(resParallelReview, 0);
      assertOut(resParallelReview, 'FIX-BATCH: 归位 subagent-execute（源节点 review）');
      assertOut(resParallelReview, 'NODE: subagent-execute');
      assertNotOut(resParallelReview, 'NODE: review');
      assertNotOut(resParallelReview, 'NODE: execute');
      assertNotOut(resParallelReview, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'subagent-execute') {
        throw new Error('review 源并行回退态 next 后 currentNode 应为 subagent-execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // ⑥ verify 源 + 并行 pending Fix 任务：同样归位 subagent-execute。
      writeFile(dir, taskPath, fixBatchParallelTaskText('pending'));
      writeState(dir, {
        ...base,
        currentNode: 'verify',
        completedNodes: [...base.completedNodes, 'review'],
        enteredNodes: [...base.enteredNodes, 'verify'],
        evidence: { ...base.evidence, review: { summary: 'review complete' }, verify: { summary: 'verify in progress' } },
      });
      const resParallelVerify = runStateWithProtocol(dir, ['next']);
      assertExit(resParallelVerify, 0);
      assertOut(resParallelVerify, 'FIX-BATCH: 归位 subagent-execute（源节点 verify）');
      assertOut(resParallelVerify, 'NODE: subagent-execute');
      assertNotOut(resParallelVerify, 'NODE: verify');
      assertNotOut(resParallelVerify, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'subagent-execute') {
        throw new Error('verify 源并行回退态 next 后 currentNode 应为 subagent-execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // ⑦ done-but-unclosed 并行变体（全 done + 最新 exit subagent-execute 签名过时）：
      // next 必须按事件记录的家族节点归位 subagent-execute。
      writeFile(dir, taskPath, fixBatchParallelTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P-FIX-01-SUMMARY.md', strictSummary('P-FIX-01'));
      writeState(dir, { ...base, history: fixBatchHistoryWithStaleFamilyExit('subagent-execute') });
      const resDoneParallel = runStateWithProtocol(dir, ['next']);
      assertExit(resDoneParallel, 0);
      assertOut(resDoneParallel, 'FIX-BATCH: 归位 subagent-execute（源节点 review）');
      assertOut(resDoneParallel, 'NODE: subagent-execute');
      assertNotOut(resDoneParallel, 'NODE: execute');
      assertNotOut(resDoneParallel, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'subagent-execute') {
        throw new Error('done-but-unclosed 并行变体 next 后 currentNode 应为 subagent-execute，实际 ' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 253e: next 入口的受控归位轮次纪律——第 1~3 轮逐轮放行并同步计数器；第 4 轮新 change BLOCK
  // 且 state 字节零改写；非法授权形态（缺 at/source）仍按未授权 fail-closed；完整三元组授权放行。
  {
    name: '253e next 受控归位轮次：1~3 轮递增 / 第 4 轮 BLOCK / 授权形态 fail-closed 与放行',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const base = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: {
          execute: { summary: 'first pass executed' },
          review: { summary: 'review in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ⑧ m-12 next 入口第 1~3 轮递增：逐轮重置驻留 review，审计后缀第 n/3 轮且计数器同步 +1
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      for (let round = 1; round <= 3; round += 1) {
        writeState(dir, base);
        const stRound = readScenarioState(dir);
        stRound.fixRoundsByChange = { [CHANGE_ID]: round - 1 };
        writeState(dir, stRound);
        const resRound = runStateWithProtocol(dir, ['next']);
        assertExit(resRound, 0);
        assertOut(resRound, 'FIX-BATCH: 归位 execute（源节点 review）（第 ' + round + '/3 轮）');
        const stAfterRound = readScenarioState(dir);
        if (stAfterRound.fixRoundsByChange?.[CHANGE_ID] !== round) {
          throw new Error('next 第 ' + round + ' 轮归位后计数器应为 ' + round + '，实际 '
            + JSON.stringify(stAfterRound.fixRoundsByChange));
        }
      }
      // ⑨ 第 4 轮新 change BLOCK：state 字节零改写（不写 currentNode、不写计数器）
      writeState(dir, { ...base, fixRoundsByChange: { [CHANGE_ID]: 3 } });
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const beforeRound4 = fs.readFileSync(statePath, 'utf8');
      const resRound4 = runStateWithProtocol(dir, ['next']);
      assertExit(resRound4, 1);
      assertOut(resRound4, 'BLOCKED: Fix 批次受控归位已达 3 轮上限');
      assertOut(resRound4, '继续修');
      assertOut(resRound4, '停止');
      if (fs.readFileSync(statePath, 'utf8') !== beforeRound4) {
        throw new Error('next 第 4 轮 BLOCK 必须 state 字节零改写');
      }
      const stBlocked = readScenarioState(dir);
      if (stBlocked.currentNode !== 'review' || stBlocked.fixRoundsByChange?.[CHANGE_ID] !== 3) {
        throw new Error('next 第 4 轮 BLOCK 后 currentNode/计数器不得改写，实际 '
          + JSON.stringify({ currentNode: stBlocked.currentNode, rounds: stBlocked.fixRoundsByChange }));
      }
      // ⑨b F5：非法授权形态（仅 round，缺 at/source）在 next 链路上仍按未授权 fail-closed——
      // 继续 BLOCK、state 字节零改写、currentNode 保持 review、计数器保持 3。
      const stBadOverride = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      stBadOverride.evidence.review.fixRoundOverride = { round: 4 };
      writeState(dir, stBadOverride);
      const badOverrideBytes = fs.readFileSync(statePath, 'utf8');
      const resBadOverride = runStateWithProtocol(dir, ['next']);
      assertExit(resBadOverride, 1);
      assertOut(resBadOverride, 'BLOCKED: Fix 批次受控归位已达 3 轮上限');
      assertNotOut(resBadOverride, '（第 4/3 轮）');
      if (fs.readFileSync(statePath, 'utf8') !== badOverrideBytes) {
        throw new Error('F5 缺 at/source 的授权形态必须在 next 链路上 state 字节零改写');
      }
      const stBadAfter = readScenarioState(dir);
      if (stBadAfter.currentNode !== 'review' || stBadAfter.fixRoundsByChange?.[CHANGE_ID] !== 3) {
        throw new Error('F5 缺 at/source 不得放行第 4 轮（currentNode 保持 review、计数保持 3），实际 '
          + JSON.stringify({ currentNode: stBadAfter.currentNode, rounds: stBadAfter.fixRoundsByChange }));
      }
      // ⑩ 用户显式授权（嵌套 evidence，完整三元组）→ next 第 4 轮放行并写盘
      const stOverride = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      stOverride.evidence.review.fixRoundOverride = { round: 4, at: '2026-09-25T00:00:00.000Z', source: 'fixture-user' };
      writeState(dir, stOverride);
      const resOverride = runStateWithProtocol(dir, ['next']);
      assertExit(resOverride, 0);
      assertOut(resOverride, '（第 4/3 轮）');
      const stAuthorized = readScenarioState(dir);
      if (stAuthorized.currentNode !== 'execute' || stAuthorized.fixRoundsByChange?.[CHANGE_ID] !== 4) {
        throw new Error('next 授权后第 4 轮应放行归位（currentNode=execute、计数器=4），实际 '
          + JSON.stringify({ currentNode: stAuthorized.currentNode, rounds: stAuthorized.fixRoundsByChange }));
      }
    },
  },

  // 254: next Fix 回程豁免（review 源）——exit execute --apply 把 currentNode 推回 review 后，
  // REVIEW.md 已在场会让 resolveNextNode 按产物跳过未出口的 review；next 必须在源节点未完成时
  // 显式放行 review（审计行 + 只读不改写 state），不依赖 inProgress 保护副作用；无 review 证据的
  // 引擎回程态同样放行（修复前缺审计行 / 漂移 verify / 无证据时 BLOCK）。
  {
    name: '254 next Fix 回程豁免：review 源（REVIEW.md 在场不跳过；无 inProgress 证据也不 BLOCK）',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nFix 批次由 execute 完成，待回源重新出口。\n');
      const completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      const base = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes,
        enteredNodes: [...completedNodes, 'review'],
        evidence: { execute: { summary: 'fix batch executed' }, review: { summary: 'review in progress' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ① 真实回程态（review 已 entry）→ 审计行 + NODE: review + state 只读不改写
      writeState(dir, base);
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'RETURN: 回程源节点 review');
      assertOut(res, 'NODE: review');
      assertNotOut(res, 'NODE: verify');
      assertNotOut(res, 'BLOCKED');
      let after = readScenarioState(dir);
      if (after.currentNode !== 'review' || after.completedNodes.join(',') !== completedNodes.join(',')) {
        throw new Error('回程豁免不得改写 state，实际 '
          + JSON.stringify({ currentNode: after.currentNode, completedNodes: after.completedNodes }));
      }
      // ② 引擎回程态（review 无 evidence/entered；末位已完成节点证据在场）→ 仍放行 review，不漂移 verify
      writeState(dir, {
        ...base,
        enteredNodes: completedNodes.slice(),
        evidence: { execute: { summary: 'fix batch executed' }, 'subagent-execute': { summary: 'delegated' } },
      });
      const resNoEvidence = runStateWithProtocol(dir, ['next']);
      assertExit(resNoEvidence, 0);
      assertOut(resNoEvidence, 'RETURN: 回程源节点 review');
      assertOut(resNoEvidence, 'NODE: review');
      assertNotOut(resNoEvidence, 'NODE: verify');
      assertNotOut(resNoEvidence, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'review') {
        throw new Error('无 inProgress 证据的回程态 next 后 currentNode 应保持 review，实际 ' + JSON.stringify(after.currentNode));
      }
      // ③ 无任何 evidence 的引擎回程态 → 回程豁免先于「疑似未 exit」门禁，不 BLOCK
      writeState(dir, { ...base, enteredNodes: [], evidence: {} });
      const resNoAnyEvidence = runStateWithProtocol(dir, ['next']);
      assertExit(resNoAnyEvidence, 0);
      assertOut(resNoAnyEvidence, 'RETURN: 回程源节点 review');
      assertOut(resNoAnyEvidence, 'NODE: review');
      assertNotOut(resNoAnyEvidence, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'review') {
        throw new Error('回程豁免不得因证据缺失被门禁改写 currentNode，实际 ' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 255: next Fix 回程豁免（verify 源）——TEST.md + UAT.md 已在场会让 resolveNextNode 按
  // 产物跳过未出口的 verify 去 archive；next 必须显式放行 verify（审计行 + 只读不改写 state）；
  // 无 verify 证据时不得漂移 archive；完全无证据时不得被「疑似未 exit」门禁 BLOCK。
  {
    name: '255 next Fix 回程豁免：verify 源（TEST/UAT 在场不跳过；不漂移 archive/不 BLOCK）',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nreview passed，待回源 verify 重新出口。\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```\necho ok\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
      const completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      const base = {
        activeChange: CHANGE_ID,
        currentNode: 'verify',
        completedNodes,
        enteredNodes: [...completedNodes, 'verify'],
        evidence: {
          execute: { summary: 'fix batch executed' },
          review: { summary: 'review complete' },
          verify: { summary: 'verify in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ① 真实回程态（verify 已 entry）→ 审计行 + NODE: verify + state 只读不改写
      writeState(dir, base);
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'RETURN: 回程源节点 verify');
      assertOut(res, 'NODE: verify');
      assertNotOut(res, 'NODE: archive');
      assertNotOut(res, 'BLOCKED');
      let after = readScenarioState(dir);
      if (after.currentNode !== 'verify' || after.completedNodes.join(',') !== completedNodes.join(',')) {
        throw new Error('回程豁免不得改写 state，实际 '
          + JSON.stringify({ currentNode: after.currentNode, completedNodes: after.completedNodes }));
      }
      // ② 引擎回程态（verify 无 evidence/entered；末位已完成节点证据在场）→ 不漂移 archive
      writeState(dir, {
        ...base,
        enteredNodes: completedNodes.slice(),
        evidence: { execute: { summary: 'fix batch executed' }, review: { summary: 'review complete' } },
      });
      const resNoEvidence = runStateWithProtocol(dir, ['next']);
      assertExit(resNoEvidence, 0);
      assertOut(resNoEvidence, 'RETURN: 回程源节点 verify');
      assertOut(resNoEvidence, 'NODE: verify');
      assertNotOut(resNoEvidence, 'NODE: archive');
      assertNotOut(resNoEvidence, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'verify') {
        throw new Error('无 inProgress 证据的回程态 next 后 currentNode 应保持 verify，实际 ' + JSON.stringify(after.currentNode));
      }
      // ③ 无任何 evidence → 回程豁免先于「疑似未 exit」门禁，不 BLOCK
      writeState(dir, { ...base, enteredNodes: [], evidence: {} });
      const resNoAnyEvidence = runStateWithProtocol(dir, ['next']);
      assertExit(resNoAnyEvidence, 0);
      assertOut(resNoAnyEvidence, 'RETURN: 回程源节点 verify');
      assertOut(resNoAnyEvidence, 'NODE: verify');
      assertNotOut(resNoAnyEvidence, 'BLOCKED');
    },
  },

  // 256: 负例回归——正常多趟中间态（execute 已完成 + 依赖已满足的 parallel pending 任务）
  // 必须照常路由 subagent-execute：回退谓词（源节点限制）与回程谓词（任务全 done 限制）都不成立，
  // 不得被 Fix 两态分支误分流到 review/verify，也不得输出 FIX-BATCH 审计行。
  {
    name: '256 负例：正常多趟中间态（execute 已完成 + 可委托 parallel pending）不误分流',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', renderMultiWaveTasks(['T01', 'P01', 'P02', 'T02']));
      for (const id of ['T01', 'P01', 'P02', 'T02']) {
        writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', strictSummary(id));
      }
      const completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes,
        enteredNodes: completedNodes.slice(),
        evidence: {
          execute: { summary: 'serial wave complete' },
          'subagent-execute': { summary: 'wave 1 delegated and collected' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      });
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      assertNotOut(res, 'NODE: review');
      assertNotOut(res, 'NODE: verify');
      assertNotOut(res, 'FIX-BATCH');
      assertNotOut(res, 'BLOCKED');
      const after = readScenarioState(dir);
      if (after.currentNode !== 'subagent-execute') {
        throw new Error('正常多趟中间态应路由 subagent-execute，实际 currentNode=' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 257: 旧 change 兼容——无 newChange: true 的回退态与回程态都不新增 BLOCK，
  // 且 NODE 输出与判定正确（回退 → execute；回程 → 源节点）。
  {
    name: '257 旧 change 兼容：无 newChange 的回退/回程态不新增 BLOCK 且 NODE 正确',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      const oldState = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes,
        enteredNodes: [...completedNodes, 'review'],
        evidence: { execute: { summary: 'first pass executed' }, review: { summary: 'review in progress' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        // newChange 缺省/null = 旧 change 渐进形态（newChange 校验只接受 true/缺失/null）
      };
      // ① 旧 change 回退态（pending Fix 任务）→ NODE: execute + 审计行，不得 BLOCK
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, oldState);
      const resRollback = runStateWithProtocol(dir, ['next']);
      assertExit(resRollback, 0);
      assertNotOut(resRollback, 'BLOCKED');
      assertOut(resRollback, 'FIX-BATCH: 归位 execute（源节点 review）');
      assertOut(resRollback, 'NODE: execute');
      // 旧 change 缺 fixRoundsByChange 字段 → 缺省 0，从第 1 轮计数且不 BLOCK（AC-5 旧兼容）
      assertOut(resRollback, '（第 1/3 轮）');
      const stLegacyRollback = readScenarioState(dir);
      if (stLegacyRollback.currentNode !== 'execute' || stLegacyRollback.fixRoundsByChange?.[CHANGE_ID] !== 1) {
        throw new Error('旧 change 回退态 next 后应归位 execute 且计数器缺省 0→1，实际 '
          + JSON.stringify({ currentNode: stLegacyRollback.currentNode, rounds: stLegacyRollback.fixRoundsByChange }));
      }
      // ② 旧 change 回程态（无 newChange 字段：全 done + REVIEW.md + 源节点未完成）→ NODE: review，不得 BLOCK
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\n待回源出口。\n');
      writeState(dir, oldState);
      const resReturn = runStateWithProtocol(dir, ['next']);
      assertExit(resReturn, 0);
      assertNotOut(resReturn, 'BLOCKED');
      assertOut(resReturn, 'RETURN: 回程源节点 review');
      assertOut(resReturn, 'NODE: review');
      assertNotOut(resReturn, 'NODE: verify');
      if (readScenarioState(dir).currentNode !== 'review') {
        throw new Error('旧 change 回程态 next 后 currentNode 应保持 review，实际 ' + JSON.stringify(readScenarioState(dir).currentNode));
      }
      // ③ 旧 change 无签名、无 Fix 标记的回程态（决策 2/3 旧态边界）：state 侧同样只输出中性
      // RETURN 回程行——缺 taskSetSignature、TASK 无 Fix 段/编号 → 不得冒充 FIX-BATCH。
      writeFile(dir, taskPath, '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n');
      writeState(dir, oldState);
      const resReturnNoMarker = runStateWithProtocol(dir, ['next']);
      assertExit(resReturnNoMarker, 0);
      assertNotOut(resReturnNoMarker, 'BLOCKED');
      assertNotOut(resReturnNoMarker, 'FIX-BATCH');
      assertOut(resReturnNoMarker, 'RETURN: 回程源节点 review（源节点产物在场且未出口；保留源节点跑出口）');
      assertOut(resReturnNoMarker, 'NODE: review');
      if (readScenarioState(dir).currentNode !== 'review') {
        throw new Error('旧 change 无标记回程态 next 后 currentNode 应保持 review，实际 ' + JSON.stringify(readScenarioState(dir).currentNode));
      }
    },
  },

  // 258: 三节点 SKILL 文本锁（AC-9 / T05 已落地）——execute/review/verify 均含
  // 「## 修复回路状态机路径」段，段内含受控归位 + 回源节点跑出口 + 禁止绕过；不得把
  // 直接 exit 源节点收场或 advance 当正常路径（反捷径文本锚）。
  // 布局感知（端到端冒烟副本缺陷）：技能树从 suite 脚本自身位置推导
  // （<skillsRoot>/flow-comet/scripts/ → 组件技能为 <skillsRoot> 下同级目录），权威源
  // .flow-comet/skills/ 与安装副本 .claude|.agents|.dsh/skills/ 同一相对布局通吃。
  {
    name: '258 技能文本锁：三节点 SKILL 含修复回路状态机路径（禁止直接 exit/advance 为正常路径）',
    run: (dir) => {
      const componentSkills = ['flow-comet-execute', 'flow-comet-review', 'flow-comet-verify'];
      // 布局感知回归锚（合成安装副本）：suite 位于 <skillsRoot>/flow-comet/scripts/ 时组件技能
      // 必须解析到同级 <skillsRoot>/<skill>/SKILL.md——与权威源 .flow-comet 布局无关
      //（旧实现硬编码 REPO_ROOT/.flow-comet/skills → 此锚变红）。
      const syntheticSkillsRoot = path.join(dir, 'synthetic-carrier', '.claude', 'skills');
      const syntheticScriptsDir = path.join(syntheticSkillsRoot, 'flow-comet', 'scripts');
      for (const nodeSkill of componentSkills) {
        writeFile(dir, path.join('synthetic-carrier', '.claude', 'skills', nodeSkill, 'SKILL.md'),
          '## 修复回路状态机路径\n\n受控归位（合成布局锚）\n');
        const expected = path.join(syntheticSkillsRoot, nodeSkill, 'SKILL.md');
        const resolved = resolveComponentSkillFile(nodeSkill, syntheticScriptsDir);
        if (resolved !== expected) {
          throw new Error('技能树布局感知解析错误：期望 ' + expected + '，实际 ' + resolved);
        }
      }
      // 显式失败锚（MECHANISM 三·6）：组件技能缺失时必须报错并给指引，不得静默跳过/空过。
      const emptyScriptsDir = path.join(dir, 'empty-carrier', '.dsh', 'skills', 'flow-comet', 'scripts');
      let missingError = null;
      try {
        resolveComponentSkillFile('flow-comet-execute', emptyScriptsDir);
      } catch (e) {
        missingError = e.message;
      }
      if (!missingError
        || !missingError.includes('技能树布局定位失败')
        || !missingError.includes(path.join('flow-comet-execute', 'SKILL.md'))) {
        throw new Error('组件技能缺失时未显式失败并给指引: ' + JSON.stringify(missingError));
      }
      // 真实三节点文本锁（ADR-016 重定向）：原「三册段正文 sha256 完全一致」的逐字锁**作废**，
      // 改为「三册各含要点句与条件句 + 该段正文**仅一处**（权威 = `reference/fix-loop.md`）+
      // 原 6 关键词与「禁 `advance` 作正常路径」断言**迁到权威处**」。判据抽成纯函数（单一实现：
      // 真实判据与反向构造探针共用），逐条自带反向构造。
      const componentTexts = new Map();
      for (const nodeSkill of componentSkills) {
        componentTexts.set(nodeSkill, fs.readFileSync(resolveComponentSkillFile(nodeSkill), 'utf8'));
      }
      const fixLoopAuthorityPath = path.join(SCRIPTS_DIR, '..', 'reference', 'fix-loop.md');
      if (!fs.existsSync(fixLoopAuthorityPath)) {
        throw new Error(FIX_LOOP_AUTHORITY_REL + ' 不在场（修复回路段的唯一权威处缺失）');
      }
      const fixLoopAuthorityText = fs.readFileSync(fixLoopAuthorityPath, 'utf8');
      const fixLoopSources = { books: componentTexts, authority: fixLoopAuthorityText };
      const fixLoopProblems = fixLoopStateMachineProblems(fixLoopSources);
      if (fixLoopProblems.length > 0) {
        throw new Error('修复回路状态机路径文本锁不符（重定向后判据）: ' + fixLoopProblems.join('; '));
      }
      // 反向构造（同一判据驱动，逐条对应重定向后的两侧）：
      // ① 逐册抽掉任一要点 token ⇒ 必报（三册各自的要点句在场）；
      // ② 权威处逐条抽掉关键词 ⇒ 必报（原 6 关键词已迁到权威处）；
      // ③ 把权威段落复制进任一册 ⇒ 必报「第二份正文」（正文唯一——原 sha256 锁**要求**三份一致，
      //    恰恰抓不到这一侧）；④ 册内还原 `advance` 捷径 / 直接 exit 收场 ⇒ 必报。
      const stripFixLoopToken = (text, token) => text.split(token).join('（反向构造：抽掉）');
      for (const [nodeSkill, text] of componentTexts) {
        for (const [label, tokens] of FIX_LOOP_BOOK_ELEMENT_GROUPS) {
          const probed = new Map(componentTexts).set(nodeSkill, stripFixLoopToken(text, tokens[0]));
          if (probed.get(nodeSkill) === text) continue;
          if (!fixLoopStateMachineProblems({ ...fixLoopSources, books: probed }).some((p) => p.includes(label))) {
            throw new Error('反向构造判别力缺失（' + nodeSkill + ' 抽掉「' + label + '」要点 token 未被判违规）');
          }
        }
      }
      for (const keyword of FIX_LOOP_AUTHORITY_KEYWORDS) {
        if (!fixLoopAuthorityText.includes(keyword)) continue; // 缺失已由真实判据报告
        if (!fixLoopStateMachineProblems({
          ...fixLoopSources, authority: stripFixLoopToken(fixLoopAuthorityText, keyword),
        }).some((p) => p.includes(keyword))) {
          throw new Error('反向构造判别力缺失（权威处抽掉关键词 «' + keyword + '» 未被判违规）');
        }
      }
      const fixLoopAuthoritySection = fixLoopStateMachineSectionOf(fixLoopAuthorityText);
      const copyInto = 'flow-comet-review';
      const reviewText = componentTexts.get(copyInto).replace(/\r\n/g, '\n');
      const reviewSection = fixLoopStateMachineSectionOf(reviewText);
      const duplicated = fixLoopStateMachineProblems({
        ...fixLoopSources,
        books: new Map(componentTexts).set(copyInto, reviewText.split(reviewSection).join(fixLoopAuthoritySection)),
      });
      if (!duplicated.some((p) => p.includes('第二份正文'))) {
        throw new Error('反向构造判别力缺失（权威段落整段回流册子未被判「第二份正文」）');
      }
      const advanceRel = 'flow-comet-verify';
      const advanceText = componentTexts.get(advanceRel).replace(/\r\n/g, '\n');
      const advanceSection = fixLoopStateMachineSectionOf(advanceText);
      const advanceProbe = new Map(componentTexts).set(advanceRel,
        advanceText.split(advanceSection).join(advanceSection + '\n用 advance 直接推进即可。\n'));
      if (!fixLoopStateMachineProblems({ ...fixLoopSources, books: advanceProbe })
        .some((p) => p.includes('advance'))) {
        throw new Error('反向构造判别力缺失（册内还原 advance 捷径未被判违规）');
      }
      const exitRel = 'flow-comet-review';
      const exitText = componentTexts.get(exitRel).replace(/\r\n/g, '\n');
      const exitSection = fixLoopStateMachineSectionOf(exitText);
      const directExitProbe = new Map(componentTexts).set(exitRel,
        exitText.split(exitSection).join(exitSection + '\n直接跑 exit review 收场即可。\n'));
      if (!fixLoopStateMachineProblems({ ...fixLoopSources, books: directExitProbe })
        .some((p) => p.includes('直接 exit'))) {
        throw new Error('反向构造判别力缺失（册内还原「直接 exit 收场」未被判违规）');
      }
    },
  },
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

];
