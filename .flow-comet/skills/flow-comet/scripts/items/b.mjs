// items/b.mjs — 条目分区：A 组尾部（Fix 回路三项）+ B 组条目（声明机制：skill-load / record / exit 校验）
//
// 数据层约定：同 items/a.mjs 头注（只承载 ENTRIES；夹具从 lib/system-fixtures.mjs 取；组文件之间零 import）。
// 组界：本文件先承载 A 组尾部三项、再承载 B 组条目——与套件入口的拼接顺序一致（见 items/a.mjs 头注）。

import fs from 'fs';
import path from 'path';
import { assertExit, assertNotOut, assertOut, runGuard, runHandoff, runState, writeFile, writeState } from '../lib/test-helpers.mjs';
import { serialTaskBlock, fixBatchParallelTaskText, fixBatchTwoFixTaskText, fixBatchHistoryWithStaleExecuteExit, writeFixBatchFixture, CHANGE_ID, readStateFile, writeIntakeArtifacts, fullContract, execSummaryFixture, fixBatchReviewDoc, completeFixTaskAndRecord, assertNodeLine, assertNotNodeLine } from '../lib/system-fixtures.mjs';

export const ENTRIES = [

  {
    // review 源 Fix 闭环（真实命令链路）：execute 已首次完成、review 驻留 +「Fix 任务」段追加
    // pending 修复任务 → 直接 exit review --apply 被拦（旧绕过路径会静默跳过 execute 生命周期）；
    // next 受控归位 execute 并写盘 → 完成修复任务后 record/exit execute --apply 回源 review →
    // review 出口门禁真实执行（发现条目缺处置标记仍 BLOCKED，补齐后通过）并推进 verify。
    // 修复前 next 停在 review（无 NODE: execute / 无归位审计行）→ 本项应失败（RED 锚）。
    name: 'A21 review 源 Fix 闭环：next 归位 execute → 出口回源 review → 审查出口真实执行（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending' });

      // ① 旧绕过路径：Fix 任务仍 pending 时直接 exit review --apply → 新 change BLOCKED + 恢复指引
      const bypass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(bypass, 1);
      assertOut(bypass, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(bypass, 'Fix 批次');
      assertOut(bypass, 'entry execute');
      assertOut(bypass, 'workflow-state.mjs next');
      assertNotOut(bypass, 'ALL CHECKS PASSED');
      let st = readStateFile(dir);
      if (st.currentNode !== 'review' || st.completedNodes.includes('review')) {
        throw new Error('越界 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }

      // 首轮计数与 verify 失败计数互相独立：先记一次 verify 失败，归位不得改动其计数。
      assertExit(runState(['verify-fail'], dir, env), 0);
      // ② next 受控归位 execute：显式审计行 + 真实写盘（不得停在源节点）
      const nxt = runState(['next'], dir, env);
      assertExit(nxt, 0);
      assertOut(nxt, 'FIX-BATCH: 归位 execute（源节点 review）（第 1/3 轮）');
      assertNodeLine(nxt, 'execute');
      assertNotNodeLine(nxt, 'review');
      st = readStateFile(dir);
      if (st.currentNode !== 'execute') {
        throw new Error('归位后 currentNode 应为 execute，实际 ' + JSON.stringify(st.currentNode));
      }
      if (st.completedNodes.includes('review')) {
        throw new Error('归位不得把源节点标完成: ' + JSON.stringify(st.completedNodes));
      }
      if (!st.evidence?.review) {
        throw new Error('归位不得清掉源节点证据: ' + JSON.stringify(st.evidence));
      }
      if (st.fixRoundsByChange?.ch !== 1) {
        throw new Error('首轮受控归位应计数 1: ' + JSON.stringify(st.fixRoundsByChange));
      }
      if (st.verifyFailuresByChange?.ch !== 1) {
        throw new Error('Fix 轮次计数不得改写 verify 失败计数: ' + JSON.stringify(st.verifyFailuresByChange));
      }

      // ③ 完成修复任务（标 done + 逐任务 SUMMARY + 重载声明 + record execute）
      completeFixTaskAndRecord(dir, env);

      // 收口前基线（只读）：出口前后完成节点集合不变，目的地仍为未完成的 review
      const a21Before = readStateFile(dir);
      // ④ exit execute --apply 跑四类出口后回源 review（REVIEW.md 在场也不得按产物跳 verify）
      const ex = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(ex, 0);
      assertOut(ex, 'ALL CHECKS PASSED');
      assertOut(ex, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNodeLine(ex, 'review');
      assertNotNodeLine(ex, 'verify');
      assertNotOut(ex, 'RETURN: 回源节点');
      assertNotOut(ex, '未分类');
      st = readStateFile(dir);
      if (st.currentNode !== 'review' || st.completedNodes.includes('review')) {
        throw new Error('回源后应停在未完成的 review: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }
      if (JSON.stringify(st.completedNodes) !== JSON.stringify(a21Before.completedNodes)) {
        throw new Error('Fix 回源收尾不得改写完成节点集合（仅审计行分类变化）: 收口前 '
          + JSON.stringify(a21Before.completedNodes) + ' 收口后 ' + JSON.stringify(st.completedNodes));
      }
      const a21PostNext = runState(['next'], dir, env);
      assertExit(a21PostNext, 0);
      assertNodeLine(a21PostNext, 'review');

      // ⑤ 回源 review 出口门禁真实执行：缺处置标记 → BLOCKED；补齐后同出口通过并推进 verify
      assertExit(runState(['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'review'], dir, env), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', fixBatchReviewDoc(false));
      const gate = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(gate, 1);
      assertOut(gate, 'BLOCKED');
      assertOut(gate, '处置');
      assertNotOut(gate, 'ALL CHECKS PASSED');
      st = readStateFile(dir);
      if (st.currentNode !== 'review' || st.completedNodes.includes('review')) {
        throw new Error('审查出口 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', fixBatchReviewDoc(true));
      const pass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(pass, 0);
      assertOut(pass, 'ALL CHECKS PASSED');
      assertNodeLine(pass, 'verify');
      st = readStateFile(dir);
      if (st.currentNode !== 'verify' || !st.completedNodes.includes('review')) {
        throw new Error('审查出口通过后应推进 verify: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }
      if (st.fixRoundsByChange?.ch !== 1) {
        throw new Error('审查出口通过不得清零 Fix 轮次计数: ' + JSON.stringify(st.fixRoundsByChange));
      }
      if (st.verifyFailuresByChange?.ch !== 1) {
        throw new Error('审查出口不得改写 verify 失败计数: ' + JSON.stringify(st.verifyFailuresByChange));
      }
    },
  },
  {
    // verify 源 Fix 回程（真实命令链路）：review 已完成、verify 驻留 + pending 修复任务；
    // TEST/UAT 已在场（正常产物推导会跳过未出口的 verify 去 archive）→ 修复前 next 停在 verify /
    // 产物推导会跳过 verify；修复后 next 归位 execute，exit execute --apply 回源 verify 并真实跑
    // verify 出口（验证命令落盘副作用文件 + 推进 archive）。
    name: 'A22 verify 源 Fix 回程：回 verify 而非跳过 archive + verify 出口真实执行（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const gateMarker = path.join(dir, 'verify-gate-ran.txt');
      writeFixBatchFixture(dir, { kind: 'verify', fixStatus: 'pending' });

      // ① 旧绕过路径：pending 修复任务时直接 exit verify --apply → BLOCKED，且验证命令未被执行
      const bypass = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(bypass, 1);
      assertOut(bypass, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(bypass, 'entry execute');
      assertNotOut(bypass, 'ALL CHECKS PASSED');
      if (fs.existsSync(gateMarker)) throw new Error('越界 BLOCK 不得执行 verify 验证命令');
      let st = readStateFile(dir);
      if (st.currentNode !== 'verify' || st.completedNodes.includes('verify')) {
        throw new Error('越界 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }

      // ② next 受控归位 execute（源节点 verify）
      const nxt = runState(['next'], dir, env);
      assertExit(nxt, 0);
      assertOut(nxt, 'FIX-BATCH: 归位 execute（源节点 verify）');
      assertNodeLine(nxt, 'execute');
      assertNotNodeLine(nxt, 'verify');
      st = readStateFile(dir);
      if (st.currentNode !== 'execute') {
        throw new Error('归位后 currentNode 应为 execute，实际 ' + JSON.stringify(st.currentNode));
      }

      // ③ 完成修复任务并 record execute
      completeFixTaskAndRecord(dir, env);

      // 收口前基线（只读）：出口前后完成节点集合不变，目的地仍为未完成的 verify
      const a22Before = readStateFile(dir);
      // ④ exit execute --apply：不按产物跳过 verify → 回源 verify（不是 archive）
      const ex = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(ex, 0);
      assertOut(ex, 'ALL CHECKS PASSED');
      assertOut(ex, 'FIX-BATCH: 回源节点 verify（execute 出口已完成）');
      assertNodeLine(ex, 'verify');
      assertNotNodeLine(ex, 'archive');
      assertNotOut(ex, 'RETURN: 回源节点');
      assertNotOut(ex, '未分类');
      st = readStateFile(dir);
      if (st.currentNode !== 'verify' || st.completedNodes.includes('verify')) {
        throw new Error('回源后应停在未完成的 verify: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }
      if (JSON.stringify(st.completedNodes) !== JSON.stringify(a22Before.completedNodes)) {
        throw new Error('Fix 回源收尾不得改写完成节点集合（仅审计行分类变化）: 收口前 '
          + JSON.stringify(a22Before.completedNodes) + ' 收口后 ' + JSON.stringify(st.completedNodes));
      }
      const a22PostNext = runState(['next'], dir, env);
      assertExit(a22PostNext, 0);
      assertNodeLine(a22PostNext, 'verify');

      // ⑤ 回源 verify 出口真实执行：验证命令落盘 + 推进 archive
      assertExit(runState(['skill-load', 'verify', 'flow-comet-verify', '--prompt', 'flow-kit/prompts/7-integration.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'verify'], dir, env), 0);
      const vf = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(vf, 0);
      assertOut(vf, 'ALL CHECKS PASSED');
      assertNodeLine(vf, 'archive');
      if (!fs.existsSync(gateMarker) || fs.readFileSync(gateMarker, 'utf8') !== 'GATE-RAN') {
        throw new Error('verify 出口未真实执行 TEST.md 验证命令（副作用文件缺失/内容不符）');
      }
      st = readStateFile(dir);
      if (st.currentNode !== 'archive' || !st.completedNodes.includes('verify')) {
        throw new Error('验证出口通过后应推进 archive: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }
    },
  },
  {
    // 越界拦截 + done-but-unclosed 回放 + 旧 change 兼容（真实命令链路）：
    // ① 新 change review/pending → BLOCKED + state 不变；
    // ② 事故回放——Fix 任务全 done 但 history 最新 exit execute 签名仍是追加前值
    //    （从未重跑 execute 出口）→ 同出口 BLOCKED + state 字节零改写（修复前被错误断言为通过）；
    // ③ 正对照——按指引 entry execute + exit execute --apply 真闭合后，review 出口通过；
    // ④⑤ verify 源 pending / done-but-unclosed 同样 BLOCKED 且验证命令不执行，⑥ 闭合后通过；
    // ⑦⑧⑨ 旧 change（无 new change 标记）同形态渐进 WARN 放行、next 归位可达、验证出口真实执行。
    name: 'A23 Fix 越界拦截与旧 change 渐进：源节点直接 exit BLOCK（新）/WARN（旧）不卡死（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const gateMarker = path.join(dir, 'verify-gate-ran.txt');
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');

      // ① 新 change review 源 + pending：直接 exit review --apply → BLOCKED + 恢复指引 + state 不变
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending' });
      const rBlock = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(rBlock, 1);
      assertOut(rBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(rBlock, '未跑出口');
      assertOut(rBlock, '恢复');
      assertOut(rBlock, 'entry execute');
      assertOut(rBlock, 'workflow-state.mjs next');
      assertNotOut(rBlock, 'ALL CHECKS PASSED');
      let st = readStateFile(dir);
      if (st.currentNode !== 'review' || st.completedNodes.includes('review')) {
        throw new Error('review 源越界 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }

      // ② 事故回放形态：Fix 任务已全 done，但 history 最新 exit execute 记录的是追加前签名
      //（done 后从未再跑 execute 出口）→ 修复前静默放行，修复后必须 BLOCKED + state 字节零改写
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'done' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', execSummaryFixture('T-FIX-01'));
      const doneUnclosed = readStateFile(dir);
      doneUnclosed.history = fixBatchHistoryWithStaleExecuteExit();
      writeState(dir, doneUnclosed);
      const doneBytes = fs.readFileSync(statePath, 'utf8');
      const rDoneBlock = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(rDoneBlock, 1);
      assertOut(rDoneBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(rDoneBlock, 'entry execute');
      assertOut(rDoneBlock, 'workflow-state.mjs next');
      assertNotOut(rDoneBlock, 'ALL CHECKS PASSED');
      if (fs.readFileSync(statePath, 'utf8') !== doneBytes) {
        throw new Error('done-but-unclosed 越界 BLOCK 不得改写 state 字节');
      }

      // ③ 正对照：同夹具按指引真闭合（entry execute → 完成声明/record → exit execute --apply 写当前
      //    签名并回源 review）→ 再 exit review --apply 通过（拦截只针对未闭合态，不误伤正常路径）
      assertExit(runGuard(['entry', 'execute'], dir, env), 0);
      completeFixTaskAndRecord(dir, env);
      const rClosedExit = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(rClosedExit, 0);
      assertOut(rClosedExit, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(rClosedExit, 'RETURN: 回源节点');
      assertNodeLine(rClosedExit, 'review');
      assertExit(runState(['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'review'], dir, env), 0);
      const rReviewPass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(rReviewPass, 0);
      assertOut(rReviewPass, 'ALL CHECKS PASSED');
      assertNotOut(rReviewPass, 'BLOCKED');
      assertNodeLine(rReviewPass, 'verify');

      // ③b 并行 Fix 任务（可委托 parallel pending）+ review 源（真实命令链路）：
      // 直接 exit review BLOCKED；next 归位 subagent-execute；完成委托后第二趟
      // exit subagent-execute --apply 回源 review；源节点出口真实执行并推进 verify。
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending', parallelFix: true });
      const pBypass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(pBypass, 1);
      assertOut(pBypass, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNotOut(pBypass, 'ALL CHECKS PASSED');
      let pSt = readStateFile(dir);
      if (pSt.currentNode !== 'review' || pSt.completedNodes.includes('review')) {
        throw new Error('并行越界 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: pSt.currentNode, completedNodes: pSt.completedNodes }));
      }
      const pNext = runState(['next'], dir, env);
      assertExit(pNext, 0);
      assertOut(pNext, 'FIX-BATCH: 归位 subagent-execute（源节点 review）');
      assertNodeLine(pNext, 'subagent-execute');
      assertNotNodeLine(pNext, 'execute');
      pSt = readStateFile(dir);
      if (pSt.currentNode !== 'subagent-execute') {
        throw new Error('并行回退归位后 currentNode 应为 subagent-execute，实际 ' + JSON.stringify(pSt.currentNode));
      }
      // 完成并行修复任务：标记 done + 摘要 + 真实 handoff request/result + skill-load/record。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchParallelTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P-FIX-01-SUMMARY.md', execSummaryFixture('P-FIX-01'));
      // 委托前先加载节点技能声明（新 change 两层加载模型：request 命令要求标记在位）。
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      for (const taskId of ['T01', 'P-FIX-01']) {
        assertExit(runHandoff(['request', taskId, taskId + ' 委托', '--write-files', 'src/' + taskId.toLowerCase() + '.mjs'], dir), 0);
        assertExit(runHandoff(['result', taskId, fullContract('abcd1234abcd1234abcd1234abcd1234abcd1234', taskId)], dir), 0);
      }
      assertExit(runState(['record', 'subagent-execute', '{"summary":"parallel fix delegated and collected"}'], dir, env), 0);
      const pExit = runGuard(['exit', 'subagent-execute', '--apply'], dir, env);
      assertExit(pExit, 0);
      assertOut(pExit, 'ALL CHECKS PASSED');
      assertOut(pExit, 'FIX-BATCH: 回源节点 review（subagent-execute 出口已完成）');
      assertNotOut(pExit, 'RETURN: 回源节点');
      assertNodeLine(pExit, 'review');
      pSt = readStateFile(dir);
      if (pSt.currentNode !== 'review') {
        throw new Error('并行修复第二趟出口应回源 review，实际 ' + JSON.stringify(pSt.currentNode));
      }
      assertExit(runState(['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'review'], dir, env), 0);
      const pReviewPass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(pReviewPass, 0);
      assertOut(pReviewPass, 'ALL CHECKS PASSED');
      assertNodeLine(pReviewPass, 'verify');
      // ④ 新 change verify 源 + pending：直接 exit verify --apply → BLOCKED，验证命令未执行
      fs.rmSync(gateMarker, { force: true });
      writeFixBatchFixture(dir, { kind: 'verify', fixStatus: 'pending' });
      const vBlock = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(vBlock, 1);
      assertOut(vBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(vBlock, 'entry execute');
      assertNotOut(vBlock, 'ALL CHECKS PASSED');
      if (fs.existsSync(gateMarker)) throw new Error('越界 BLOCK 不得执行 verify 验证命令');
      st = readStateFile(dir);
      if (st.currentNode !== 'verify' || st.completedNodes.includes('verify')) {
        throw new Error('verify 源越界 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }

      // ⑤ verify 源 done-but-unclosed 回放（独立复核实跑形态）：review 已完成 + TEST/UAT 在场
      //（原路径会跳过 verify 去 archive）+ 全 done + 最新 execute exit 签名过时 → BLOCKED，验证命令
      // 不执行、state 字节零改写；⑥ 按指引闭合后 exit verify 真实执行验证命令并推进 archive
      writeFixBatchFixture(dir, { kind: 'verify', fixStatus: 'done' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', execSummaryFixture('T-FIX-01'));
      const verifyDoneUnclosed = readStateFile(dir);
      verifyDoneUnclosed.history = fixBatchHistoryWithStaleExecuteExit();
      writeState(dir, verifyDoneUnclosed);
      const verifyDoneBytes = fs.readFileSync(statePath, 'utf8');
      const vDoneBlock = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(vDoneBlock, 1);
      assertOut(vDoneBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(vDoneBlock, 'entry execute');
      assertNotOut(vDoneBlock, 'ALL CHECKS PASSED');
      if (fs.existsSync(gateMarker)) throw new Error('done-but-unclosed 越界 BLOCK 不得执行 verify 验证命令');
      if (fs.readFileSync(statePath, 'utf8') !== verifyDoneBytes) {
        throw new Error('verify done-but-unclosed 越界 BLOCK 不得改写 state 字节');
      }
      assertExit(runGuard(['entry', 'execute'], dir, env), 0);
      completeFixTaskAndRecord(dir, env);
      const vClosedExit = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(vClosedExit, 0);
      assertOut(vClosedExit, 'FIX-BATCH: 回源节点 verify（execute 出口已完成）');
      assertNotOut(vClosedExit, 'RETURN: 回源节点');
      assertNodeLine(vClosedExit, 'verify');
      assertExit(runState(['skill-load', 'verify', 'flow-comet-verify', '--prompt', 'flow-kit/prompts/7-integration.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'verify'], dir, env), 0);
      const vPass = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(vPass, 0);
      assertOut(vPass, 'ALL CHECKS PASSED');
      assertNodeLine(vPass, 'archive');
      if (!fs.existsSync(gateMarker) || fs.readFileSync(gateMarker, 'utf8') !== 'GATE-RAN') {
        throw new Error('闭合后 verify 出口未真实执行 TEST.md 验证命令（副作用文件缺失/内容不符）');
      }

      // ⑦ 旧 change review 源 + pending：直接 exit review --apply → FIX-BATCH WARN 渐进放行（不 BLOCK、不死结）
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending', newChange: false });
      const oldExit = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(oldExit, 0);
      assertOut(oldExit, 'FIX-BATCH WARN');
      assertNotOut(oldExit, 'BLOCKED');
      assertOut(oldExit, 'ALL CHECKS PASSED');
      assertNodeLine(oldExit, 'execute'); // pending 修复任务使路由继续回 execute（流程未卡死）
      st = readStateFile(dir);
      if (st.currentNode !== 'execute') {
        throw new Error('旧 change 渐进放行后 currentNode 应为 execute，实际 ' + JSON.stringify(st.currentNode));
      }

      // ⑧ 旧 change next 入口：pending 修复 + 源节点驻留 → 不新增 BLOCK，归位 execute 可继续
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending', newChange: false });
      const oldNext = runState(['next'], dir, env);
      assertExit(oldNext, 0);
      assertNotOut(oldNext, 'BLOCKED');
      assertOut(oldNext, 'FIX-BATCH: 归位 execute（源节点 review）');
      assertNodeLine(oldNext, 'execute');
      st = readStateFile(dir);
      if (st.currentNode !== 'execute') {
        throw new Error('旧 change next 归位后 currentNode 应为 execute，实际 ' + JSON.stringify(st.currentNode));
      }

      // ⑨ 旧 change verify 源 + pending：直接 exit verify --apply → WARN 渐进且验证出口真实执行、不卡死
      fs.rmSync(gateMarker, { force: true });
      writeFixBatchFixture(dir, { kind: 'verify', fixStatus: 'pending', newChange: false });
      const oldVerify = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(oldVerify, 0);
      assertOut(oldVerify, 'FIX-BATCH WARN');
      assertNotOut(oldVerify, 'BLOCKED');
      assertOut(oldVerify, 'ALL CHECKS PASSED');
      assertNodeLine(oldVerify, 'execute'); // pending 修复任务使路由继续回 execute
      if (!fs.existsSync(gateMarker) || fs.readFileSync(gateMarker, 'utf8') !== 'GATE-RAN') {
        throw new Error('旧 change verify 出口未真实执行 TEST.md 验证命令（渐进不等于跳过门禁）');
      }

      // ⑩ 多波次真实 Fix：第一波收口后追加第二波；第三趟收口时历史最新签名已等于当前签名、
      //    更早签名仍发散——全量签名扫描不得被最新签名覆盖，仍须保留 FIX-BATCH 锚。
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending' });
      assertExit(runState(['next'], dir, env), 0); // 受控归位 execute
      completeFixTaskAndRecord(dir, env); // 第一波：单修复任务 done + 声明/record
      const wave1 = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(wave1, 0);
      assertOut(wave1, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(wave1, 'RETURN: 回源节点');
      // 第二波：追加第二个修复任务（任务集签名发散）→ 归位 → 两任务完成后收口
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTwoFixTaskText('pending', 'pending'));
      const wave2Next = runState(['next'], dir, env);
      assertExit(wave2Next, 0);
      assertOut(wave2Next, 'FIX-BATCH: 归位 execute（源节点 review）');
      assertNodeLine(wave2Next, 'execute');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTwoFixTaskText('done', 'done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', execSummaryFixture('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-02-SUMMARY.md', execSummaryFixture('T-FIX-02'));
      assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      assertExit(runState(['record', 'execute', '{"summary":"fix wave two executed","parallelTakeoverApproved":true}'], dir, env), 0);
      const wave2 = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(wave2, 0);
      assertOut(wave2, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(wave2, 'RETURN: 回源节点');
      // 第三趟（把工作归属置回 execute 后直达真实出口，不改任务集）：历史最新签名已==当前签名、
      // 更早签名仍发散——全量签名扫描不得被最新签名覆盖，仍须保留 FIX-BATCH 锚。
      const stWave3 = readStateFile(dir);
      stWave3.currentNode = 'execute';
      writeState(dir, stWave3);
      const wave3 = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(wave3, 0);
      assertOut(wave3, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(wave3, 'RETURN: 回源节点');
      const waveState = readStateFile(dir);
      const waveExits = (waveState.history || []).filter((event) =>
        event && event.event === 'exit-applied' && (event.node === 'execute' || event.node === 'subagent-execute'));
      if (waveExits.length < 3) {
        throw new Error('多波次收口应留下至少三条 execute 家族出口事件: ' + JSON.stringify(waveExits));
      }
      const latestSignature = waveExits[waveExits.length - 1].taskSetSignature;
      if (latestSignature !== waveExits[waveExits.length - 2].taskSetSignature) {
        throw new Error('第三趟收口后最新签名应已等于当前任务集签名（夹具前提）');
      }
      if (latestSignature === waveExits[0].taskSetSignature) {
        throw new Error('多波次任务集签名应已发散（夹具前提）: ' + latestSignature);
      }

      // ⑪ 源未 entry 的真实 Fix：分类只认历史签名/Fix 结构标记，不依赖 enteredNodes → 仍 FIX-BATCH
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending' });
      const noEntryState = readStateFile(dir);
      noEntryState.enteredNodes = (noEntryState.enteredNodes || []).filter((nodeId) => nodeId !== 'review');
      writeState(dir, noEntryState);
      const noEntryNext = runState(['next'], dir, env);
      assertExit(noEntryNext, 0);
      assertOut(noEntryNext, 'FIX-BATCH: 归位 execute（源节点 review）');
      completeFixTaskAndRecord(dir, env);
      const noEntryExit = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(noEntryExit, 0);
      assertOut(noEntryExit, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(noEntryExit, 'RETURN: 回源节点');
      assertNodeLine(noEntryExit, 'review');

      // ⑫ 旧态证据不足：无签名历史、无 Fix 标记 → 中性未分类 RETURN，不 BLOCK、不冒充 Fix、不卡死
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n## 任务清单\n\n' + serialTaskBlock('T01', 'done') + '\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', execSummaryFixture('T01'));
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: { execute: { summary: 'first pass executed' }, review: { summary: 'review reopened' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      assertExit(runState(['record', 'execute', '{"summary":"legacy state closure","parallelTakeoverApproved":true}'], dir, env), 0);
      const legacyExit = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(legacyExit, 0);
      assertOut(legacyExit, 'RETURN: 回源节点 review（execute 出口已完成；旧 state 缺闭合/修复证据，未分类）');
      assertNotOut(legacyExit, 'FIX-BATCH');
      assertNotOut(legacyExit, 'BLOCKED');
      assertNodeLine(legacyExit, 'review');
      const legacyState = readStateFile(dir);
      if (legacyState.currentNode !== 'review') {
        throw new Error('旧态未分类回程应停在 review: ' + JSON.stringify(legacyState.currentNode));
      }

      // ⑬ 受控归位轮次真实链路（review 源）：第 1~3 轮输出「第 n/3 轮」并递增计数；第 4 轮新
      //    change BLOCK（state 字节零改写、currentNode 保持 review）；用户显式授权（嵌套证据）
      //    后放行；verify 失败计数与轮次计数各自独立；旧 change 第 4 轮渐进 WARN 放行。
      const fixRoundsText = (statuses) => '# TASK\n\n## 任务清单\n\n' + serialTaskBlock('T01', 'done')
        + '\n\n## Fix 任务（来自 REVIEW / INTEGRATION）\n\n'
        + statuses.map((s, i) => serialTaskBlock('T-FIX-0' + (i + 1), s)).join('\n') + '\n';
      const doneStatuses = (n) => Array.from({ length: n }, () => 'done');
      const assertRoundCounters = (round, label) => {
        const s = readStateFile(dir);
        if (s.fixRoundsByChange?.ch !== round) {
          throw new Error(label + ' 受控归位轮次应为 ' + round + ': ' + JSON.stringify(s.fixRoundsByChange));
        }
        if (s.verifyFailuresByChange?.ch !== 2) {
          throw new Error(label + ' 不得改写 verify 失败计数（应保持 2）: ' + JSON.stringify(s.verifyFailuresByChange));
        }
      };
      const completeFixRound = (n) => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixRoundsText(doneStatuses(n)));
        for (let i = 1; i <= n; i++) {
          writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-0' + i + '-SUMMARY.md', execSummaryFixture('T-FIX-0' + i));
        }
        assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
        // entry 记录 taskHash：签名值必须带算法版本前缀（新链路 vN 前缀形态）
        assertExit(runGuard(['entry', 'execute'], dir, env), 0);
        const stHash = readStateFile(dir);
        if (!/^v1:[0-9a-f]{64}$/.test(String(stHash.taskHash))) {
          throw new Error('execute entry 应写入带算法版本前缀的任务集签名: ' + JSON.stringify(stHash.taskHash));
        }
        assertExit(runState(['record', 'execute', '{"summary":"fix round ' + n + ' executed","parallelTakeoverApproved":true}'], dir, env), 0);
        const closed = runGuard(['exit', 'execute', '--apply'], dir, env);
        assertExit(closed, 0);
        assertOut(closed, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
        const stEvent = readStateFile(dir);
        const lastExit = [...(stEvent.history || [])].reverse()
          .find((e) => e.event === 'exit-applied' && e.node === 'execute');
        if (!lastExit || lastExit.signatureAlgo !== 'v1' || !/^v1:[0-9a-f]{64}$/.test(String(lastExit.taskSetSignature))) {
          throw new Error('execute 出口事件应携带算法版本元数据（signatureAlgo + vN 前缀签名）: ' + JSON.stringify(lastExit));
        }
        if (stEvent.currentNode !== 'review') {
          throw new Error('第 ' + n + ' 轮收口应回到未完成的 review: ' + JSON.stringify(stEvent.currentNode));
        }
      };

      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending' });
      // verify 失败计数先落到 2——后续 4 轮归位都不得触碰该值
      assertExit(runState(['verify-fail'], dir, env), 0);
      const vfTwo = runState(['verify-fail'], dir, env);
      assertExit(vfTwo, 0);
      assertOut(vfTwo, 'VERIFY-FAIL: 2/3');
      for (let round = 1; round <= 3; round++) {
        const rollback = runState(['next'], dir, env);
        assertExit(rollback, 0);
        assertOut(rollback, 'FIX-BATCH: 归位 execute（源节点 review）');
        assertOut(rollback, '（第 ' + round + '/3 轮）');
        assertRoundCounters(round, '第 ' + round + ' 轮');
        completeFixRound(round);
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixRoundsText([...doneStatuses(round), 'pending']));
      }
      // 第 4 轮：新 change BLOCK；state 字节零改写、currentNode 保持 review、轮次仍为 3
      const round4Bytes = fs.readFileSync(statePath, 'utf8');
      const round4Block = runState(['next'], dir, env);
      assertExit(round4Block, 1);
      assertOut(round4Block, 'BLOCKED');
      assertOut(round4Block, '第 4 轮需用户决策');
      assertOut(round4Block, '继续修');
      assertOut(round4Block, '停止');
      assertOut(round4Block, 'fixRoundOverride');
      if (fs.readFileSync(statePath, 'utf8') !== round4Bytes) {
        throw new Error('第 4 轮 BLOCK 不得改写 state 字节（currentNode/计数均不得变化）');
      }
      let round4State = readStateFile(dir);
      if (round4State.currentNode !== 'review') {
        throw new Error('第 4 轮 BLOCK 不得改写 currentNode: ' + JSON.stringify(round4State.currentNode));
      }
      assertRoundCounters(3, '第 4 轮 BLOCK 后');
      // F5 真实链路：不完整授权（仅 round，缺 at/source）按未授权 fail-closed——仍 BLOCK 且
      // state 字节零改写；随后补全完整三元组才放行（BLOCK → 非法形态仍 BLOCK → 完整授权 → 放行）。
      round4State.evidence.review = {
        ...(round4State.evidence.review || {}),
        fixRoundOverride: { round: 4 },
      };
      writeState(dir, round4State);
      const incompleteBytes = fs.readFileSync(statePath, 'utf8');
      const round4Incomplete = runState(['next'], dir, env);
      assertExit(round4Incomplete, 1);
      assertOut(round4Incomplete, 'BLOCKED');
      assertNotOut(round4Incomplete, '（第 4/3 轮）');
      if (fs.readFileSync(statePath, 'utf8') !== incompleteBytes) {
        throw new Error('F5 缺 at/source 的不完整授权必须 fail-closed：state 字节零改写');
      }
      assertRoundCounters(3, 'F5 不完整授权 BLOCK 后');
      if (readStateFile(dir).currentNode !== 'review') {
        throw new Error('F5 不完整授权不得改写 currentNode（应保持 review）');
      }
      // 用户显式授权：嵌套 evidence 补全 round/at/source 三元组 → 同一入口放行第 4 轮
      round4State = readStateFile(dir);
      round4State.evidence.review = {
        ...(round4State.evidence.review || {}),
        fixRoundOverride: { round: 4, at: new Date().toISOString(), source: 'user' },
      };
      writeState(dir, round4State);
      const round4Authorized = runState(['next'], dir, env);
      assertExit(round4Authorized, 0);
      assertOut(round4Authorized, 'FIX-BATCH: 归位 execute（源节点 review）（第 4/3 轮）');
      round4State = readStateFile(dir);
      if (round4State.currentNode !== 'execute' || round4State.fixRoundsByChange?.ch !== 4) {
        throw new Error('授权后应放行第 4 轮并计数到 4: '
          + JSON.stringify({ currentNode: round4State.currentNode, rounds: round4State.fixRoundsByChange }));
      }
      completeFixRound(4);
      // 轮次计数不影响 verify 预算：同一 change 继续失败到 3/3 仍可用，第 4 次才超限
      const vfThree = runState(['verify-fail'], dir, env);
      assertExit(vfThree, 0);
      assertOut(vfThree, 'VERIFY-FAIL: 3/3');
      const vfFour = runState(['verify-fail'], dir, env);
      assertExit(vfFour, 1);
      assertOut(vfFour, '超限');
      if (readStateFile(dir).fixRoundsByChange?.ch !== 4) {
        throw new Error('verify 失败累计不得改写 Fix 轮次计数: ' + JSON.stringify(readStateFile(dir).fixRoundsByChange));
      }
      // 旧 change 第 4 轮渐进：WARN 后照常归位（不 BLOCK、不卡死）
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending', newChange: false });
      const oldRoundState = readStateFile(dir);
      oldRoundState.fixRoundsByChange = { ch: 3 };
      writeState(dir, oldRoundState);
      const oldRound4 = runState(['next'], dir, env);
      assertExit(oldRound4, 0);
      assertOut(oldRound4, 'FIX-BATCH WARN');
      assertOut(oldRound4, '（第 4/3 轮）');
      assertNotOut(oldRound4, 'BLOCKED');
      const oldRoundAfter = readStateFile(dir);
      if (oldRoundAfter.currentNode !== 'execute' || oldRoundAfter.fixRoundsByChange?.ch !== 4) {
        throw new Error('旧 change 第 4 轮应渐进归位并计数: '
          + JSON.stringify({ currentNode: oldRoundAfter.currentNode, rounds: oldRoundAfter.fixRoundsByChange }));
      }

      // ⑭ 签名算法版本可判别（真实命令链路）：跨版本（v2 事件 vs 当前 v1）不做同版本比对——
      //    不得把正常回程误判为未闭合 Fix；同版本 legacy 裸 hex 按既有语义参与（②⑤ 已锚）。
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'done' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', execSummaryFixture('T-FIX-01'));
      const versionSkewState = readStateFile(dir);
      versionSkewState.history = [{
        event: 'exit-applied', node: 'execute', change: CHANGE_ID, at: '2026-09-20T00:00:00.000Z',
        taskSetSignature: 'v2:' + '0'.repeat(64), signatureAlgo: 'v2',
      }];
      writeState(dir, versionSkewState);
      // 清掉本项先前 verify 子场景遗留的 TEST/UAT，使回程路由确定为 verify（夹具前提）
      fs.rmSync(path.join(dir, '.specs', CHANGE_ID, 'TEST.md'), { force: true });
      fs.rmSync(path.join(dir, '.specs', CHANGE_ID, 'UAT.md'), { force: true });
      assertExit(runState(['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'review'], dir, env), 0);
      const skewExit = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(skewExit, 0);
      assertOut(skewExit, 'ALL CHECKS PASSED');
      assertNotOut(skewExit, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNodeLine(skewExit, 'verify');

    },
  },

  // ---------- B. 声明机制（skill-load / record / exit 校验） ----------

  {
    name: 'B1 skill-load：声明标记写入（协议归属）',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      const res = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir);
      assertExit(res, 0);
      assertOut(res, 'SKILL-LOAD: open flow-comet-change');
      const markerPath = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json');
      if (!fs.existsSync(markerPath)) throw new Error('标记文件未生成: ' + markerPath);
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.node !== 'open' || marker.skill !== 'flow-comet-change') {
        throw new Error('标记 node/skill 字段不符: ' + JSON.stringify(marker));
      }
      if (marker.protocol !== '0-change.md') {
        throw new Error('标记 protocol 应为 --prompt 参数的 basename: ' + JSON.stringify(marker.protocol));
      }
      if (typeof marker.at !== 'string' || Number.isNaN(Date.parse(marker.at))) {
        throw new Error('标记缺 ISO 时间戳: ' + JSON.stringify(marker));
      }
    },
  },

  {
    name: 'B2 skill-load：非法参数拒绝且不落标记',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const noArgs = runState(['skill-load'], dir);
      assertExit(noArgs, 1);
      assertOut(noArgs, 'skill-load requires <node> <skill>');
      const badNode = runState(['skill-load', 'bogus', 'flow-comet-change'], dir);
      assertExit(badNode, 1);
      assertOut(badNode, 'skill-load node 非法');
      const badSkill = runState(['skill-load', 'open', 'bad/name'], dir);
      assertExit(badSkill, 1);
      assertOut(badSkill, 'skill-load skill 名非法');
      // --prompt 越界（不在 flow-kit/prompts/ 下）
      const badPrompt = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'reference/workflow-protocol.json'], dir);
      assertExit(badPrompt, 1);
      assertOut(badPrompt, 'skill-load --prompt 路径必须位于 flow-kit/prompts/ 下');
      // 全部拒绝后 .skill-loads/ 不产生任何标记
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      if (fs.existsSync(loadsDir) && fs.readdirSync(loadsDir).length > 0) {
        throw new Error('非法参数不应写入标记: ' + fs.readdirSync(loadsDir).join(', '));
      }
    },
  },

  {
    name: 'B3 record：缺声明标记拦截',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '缺少对应声明标记');
      assertOut(res, 'workflow-state.mjs skill-load open flow-comet-change');
      // 拦截先于写入——evidence 不得落库
      const st = readStateFile(dir);
      if (st.evidence && st.evidence.open) throw new Error('拦截后不应写入 evidence: ' + JSON.stringify(st.evidence.open));
    },
  },

  {
    name: 'B4 record：声明后记录通过',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change'], dir), 0);
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 0);
      assertOut(res, 'EVIDENCE: open');
      const st = readStateFile(dir);
      if (!st.evidence.open || st.evidence.open.summary !== 'done') {
        throw new Error('record 未写入 evidence: ' + JSON.stringify(st.evidence));
      }
    },
  },

  {
    name: 'B5 record：声明时间序自洽拦截',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      // 标记 at 晚于记录时间（手工构造未来时间戳）→ 标记必须先于记录声明
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2999-12-31T00:00:00.000Z' }, null, 2) + '\n');
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '标记必须先于记录声明');
    },
  },

  {
    name: 'B6 record：损坏声明标记 fail-closed',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json', '{oops\n');
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '声明标记损坏');
    },
  },

  {
    name: 'B7 record：委托范围条目豁免（有委托通过 / 无委托拦截）',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev'], dir), 0);
      const payload = JSON.stringify({ summary: 'delegated', completedChecks: ['required-skill:subagent-execute.flow-comet-dev'] });
      // 无委托记录 → 拦截（handoff scope 条目以共用证据库的委托记录为证据）
      const blocked = runState(['record', 'subagent-execute', payload], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, '无委托记录');
      // 委托并回传契约后 → 通过(request 声明边界——新 change 强制 write_files 来源)
      assertExit(runHandoff(['request', 'T01', 'T01 委托', '--write-files', 'src/t1.mjs'], dir), 0);
      assertExit(runHandoff(['result', 'T01', JSON.stringify({
        commitHash: 'deadbeef',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t1.mjs' },
        redEvidence: { command: 'node --check src/t1.mjs' },
      })], dir), 0);
      const pass = runState(['record', 'subagent-execute', payload], dir);
      assertExit(pass, 0);
      assertOut(pass, 'EVIDENCE: subagent-execute');
    },
  },

  {
    name: 'B8 exit：协议声明标记校验（record 自动补通过 / 手动声明 / 空协议·损坏拦截）',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      writeIntakeArtifacts(dir);
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      // ① M5: record 自动补声明标记 → 出口通过（无需手动 skill-load）
      assertExit(runState(['record', 'open', '{"summary":"intake complete"}'], dir), 0);
      const autoMarker = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json');
      if (!fs.existsSync(autoMarker)) throw new Error('record 自动声明标记缺失: open-flow-comet-change.json');
      assertExit(runGuard(['entry', 'open'], dir), 0);
      const rAuto = runGuard(['exit', 'open'], dir);
      assertExit(rAuto, 0);
      assertOut(rAuto, 'ALL CHECKS PASSED');
      assertNotOut(rAuto, 'BLOCKED');
      // ② 手动 skill-load --prompt（protocol = basename）覆盖自动标记 → 出口通过
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      const rPass = runGuard(['exit', 'open'], dir);
      assertExit(rPass, 0);
      assertOut(rPass, 'ALL CHECKS PASSED');
      assertNotOut(rPass, 'BLOCKED');
      // ③ 未传 --prompt → 标记 protocol = null → 拦截（fail-closed；open 两个 requiredSkillCalls 均覆盖为 null）
      assertExit(runState(['skill-load', 'open', 'flow-comet-change'], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-requirement'], dir), 0);
      const rNull = runGuard(['exit', 'open'], dir);
      assertExit(rNull, 1);
      assertOut(rNull, 'exit 缺协议声明标记');
      // ④ 损坏标记（protocol 非本节点协议集）→ 拦截（fail-closed）
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '9-other.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const rCorrupt = runGuard(['exit', 'open'], dir);
      assertExit(rCorrupt, 1);
      assertOut(rCorrupt, 'exit 缺协议声明标记');
    },
  },

  {
    name: 'B9 旧项目兼容：record 自动补声明后照常通过',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      // 旧格式记录：completedChecks 无 required-skill 条目 → 不校验标记,通过
      const rA = runState(['record', 'open', JSON.stringify({ summary: 'legacy', completedChecks: ['unit-tests'] })], dir);
      assertExit(rA, 0);
      assertOut(rA, 'EVIDENCE: open');
      // 无 completedChecks 的纯 summary 记录 → 通过（record 自动补声明标记）
      assertExit(runState(['record', 'open', JSON.stringify({ summary: 'plain' })], dir), 0);
      // 出口：record 已自动补标记 → 无兼容警告,正常通过
      writeIntakeArtifacts(dir);
      assertExit(runGuard(['entry', 'open'], dir), 0);
      const rC = runGuard(['exit', 'open'], dir);
      assertExit(rC, 0);
      assertOut(rC, 'ALL CHECKS PASSED');
      assertNotOut(rC, 'SKILL-LOAD WARN');
    },
  },
];
