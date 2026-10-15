// 场景组 b — 委托链路 · 签名与机制交互 · hook 写白名单 · 初始化与状态兼容
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import {
  assertExit,
  assertNotOut,
  assertOut,
  baseState,
  runGuard,
  runHandoff,
  runHook,
  runState,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  TASK_DONE,
  TASK_P1,
  TASK_P2_PENDING,
  TASK_T03_PENDING,
  TASK_TFIX,
  composeState,
  customProtocol,
  handoffFor,
  summaryContent,
  writeCustomProtocol,
} from '../lib/test-fixtures.mjs';
import {
  runGuardWithProtocol,
  runStateWithProtocol,
} from '../lib/test-assertions.mjs';

export const ENTRIES = [

  // ----------  场景（handoff completedChecks 严格校验，handoff-guarded 落实） ----------

  // 34: subagent-execute exit 通过——handoff result 的 completedChecks 含 required-skill 条目 → exit 0
  {
    name: '34 subagent-execute exit 通过：handoff 含 completedChecks',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = {
        summary: 'delegated and collected',
        handoffResult: handoffFor(['P01']),
      };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 35: subagent-execute exit BLOCKED——handoff result 缺 completedChecks（严格模式，无旧 change 豁免）
  // → exit 1：旧格式/缺 completedChecks 的 handoff 在 subagent-execute 重入时被硬性拦截
  {
    name: '35 subagent-execute exit BLOCKED：handoff 缺 completedChecks',
    run: (dir) => {
      const st = baseState('subagent-execute');
      const hr = handoffFor(['P01']);
      delete hr['P01'].result.completedChecks;
      st.evidence['subagent-execute'] = { summary: 'delegated and collected', handoffResult: hr };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'completedChecks');
    },
  },

  // ----------  场景（next 节点顺序校验，严格模式） ----------

  // 36: next BLOCKED——currentNode=open 未 exit（completedNodes 空 + evidence 无 open 记录）
  // → 上一节点未 exit 就推进 → 严格拦截，输出恢复指令（先 exit open --apply）
  {
    name: '36 next BLOCKED：currentNode=open 未 exit（completedNodes 空）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 open');
      assertOut(res, 'workflow-guard.mjs exit open --apply');
    },
  },

  // 37: next 正常——open 已 exit（completedNodes 含 open）+ 当前节点 evidence 已记录 → 正常推进
  // （状态漂移校正保留：已完成节点正常推进不受严格校验影响）
  {
    name: '37 next 正常：open 已 exit 后正常推进',
    run: (dir) => {
      const st = baseState('design');
      st.completedNodes = ['open'];
      st.evidence.design = { summary: 'design in progress' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: design');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // ----------  场景（redEvidence 时间顺序校验） ----------

  // 38: handoff result 时间顺序通过——先记录 redEvidence（TDD RED），再补 greenEvidence（GREEN）
  // → 两次均通过；且 evidence 中 redEvidence/greenEvidence 附带 recordedAt 时间戳
  // （重录保留 red 首次记录时间，green 为补录时间——时序可审计）
  {
    name: '38 handoff red 先于 green 通过（redEvidence/greenEvidence 附带 recordedAt）',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const redOnly = '{"redEvidence":{"command":"node --check src/p1.mjs"}}';
      const res1 = runHandoff(['result', 'P01', redOnly], dir);
      assertExit(res1, 0);
      assertOut(res1, 'HANDOFF RESULT: P01');
      const both = '{"redEvidence":{"command":"node --check src/p1.mjs"},"greenEvidence":{"command":"node --check src/p1.mjs"}}';
      const res2 = runHandoff(['result', 'P01', both], dir);
      assertExit(res2, 0);
      assertOut(res2, 'HANDOFF RESULT: P01');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const rec = st.evidence['subagent-execute'].handoffResult['P01'].result;
      if (!rec.redEvidence.recordedAt || typeof rec.redEvidence.recordedAt !== 'string') {
        throw new Error('redEvidence 未附带 recordedAt: ' + JSON.stringify(rec.redEvidence));
      }
      if (!rec.greenEvidence.recordedAt || typeof rec.greenEvidence.recordedAt !== 'string') {
        throw new Error('greenEvidence 未附带 recordedAt: ' + JSON.stringify(rec.greenEvidence));
      }
    },
  },

  // 39: handoff result BLOCKED——已记录 greenEvidence（无 redEvidence）后同批补录 redEvidence
  // → redEvidence 事后补录（TDD 要求 RED 先于 GREEN），exit 1
  {
    name: '39 handoff BLOCKED：greenEvidence 后同批补录 redEvidence',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const greenOnly = '{"greenEvidence":{"command":"node --check src/p1.mjs"}}';
      const res1 = runHandoff(['result', 'P01', greenOnly], dir);
      assertExit(res1, 0);
      const backfill = '{"greenEvidence":{"command":"node --check src/p1.mjs"},"redEvidence":{"command":"node --check src/p1.mjs"}}';
      const res2 = runHandoff(['result', 'P01', backfill], dir);
      assertExit(res2, 1);
      assertOut(res2, 'redEvidence 事后补录');
    },
  },

  // ----------  场景（C3 签名行尾规范化 + 回退豁免） ----------

  // 40: execute exit 通过——TASK.md 从 LF 行尾改写为 CRLF（bash heredoc → python os.linesep
  // 跨工具编辑），任务集逻辑未变 → 签名一致（行尾规范化），不误报"任务集被修改"
  {
    name: '40 execute exit 通过：TASK LF→CRLF 行尾变化签名一致',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      // LF 版本任务集（enter 时记录签名）
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 同一任务集改写为 CRLF 行尾（仅行尾差异，逻辑内容不变）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF.replace(/\n/g, '\r\n'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent()); // M2: 新 change 强制 done 任务须有 SUMMARY
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 41: execute exit BLOCKED——TASK.md 任务内容实际变化（改 action 文本）→ 签名不同 → 严格拦截
  {
    name: '41 execute exit BLOCKED：任务内容变化签名不同',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 逻辑内容变化（T01 action 文本被改），行尾保持 LF 不变
      const changed = taskLF.replace('实现 T01', '实现 T01 并补充单元测试');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', changed);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'TASK.md 任务集被修改');
    },
  },

  // 42: next 回退豁免通过——verify 未 exit（completedNodes 无 verify + evidence 无 verify 记录）
  // 但 TASK.md 存在 pending 修复任务且 determineNode 推导为 execute → 允许标准回退路径
  // （verify 发现缺陷 → 回 execute），不 BLOCK，输出 NODE: execute
  {
    name: '42 next 回退豁免：verify 未 exit + pending 修复任务 → 允许回 execute',
    run: (dir) => {
      const st = baseState('verify');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      // 前置产物（preExec 门控：open/design/plan 的 CHANGE/REQUIREMENT/DESIGN/TASK）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      // 既有 done 任务 + verify 阶段追加的 pending 修复任务
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P1 + TASK_TFIX);
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 43: next 维持严格 BLOCK——verify 未 exit（evidence 无 verify 记录）且 TASK.md 无 pending
  // 任务（非修复回退）→ 豁免不成立 → 维持  严格拦截，输出恢复指令
  {
    name: '43 next 维持 BLOCK：无 pending 任务（非修复任务回退）',
    run: (dir) => {
      const st = baseState('verify');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      // 全部 done（无 pending）——正常推进场景不豁免
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P1);
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 verify');
      assertOut(res, 'workflow-guard.mjs exit verify --apply');
    },
  },

  // ----------  场景（C3 签名标记类属性剥离——completed_at 误报修复） ----------

  // 44: execute exit 通过——enter 后子代理在 task 开标签追加 completed_at 标记属性
  // （标记 task done 的时序属性，纯状态标记不影响任务集逻辑）→ 签名不受标记属性影响，不误报 BLOCK
  {
    name: '44 execute exit 通过：追加 completed_at 标记属性签名一致',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 子代理标记 task done：T01 开标签追加 completed_at 属性（其余逻辑内容不变）
      const marked = taskLF.replace('id="T01"', 'id="T01" completed_at="2026-08-07"');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', marked);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent()); // M2: 新 change 强制 done 任务须有 SUMMARY
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 45: execute exit BLOCKED——追加 completed_at 标记属性 + 任务内容（action）实际变化
  // → 标记属性剥离不越界：内容仍签名敏感 → 严格拦截"任务集被修改"
  {
    name: '45 execute exit BLOCKED：completed_at 标记属性 + action 变化签名不同',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 内容实际变化（T01 action 文本被改）+ 同时追加 completed_at 标记属性
      const changed = taskLF
        .replace('id="T01"', 'id="T01" completed_at="2026-08-07"')
        .replace('实现 T01', '实现 T01（改）');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', changed);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'TASK.md 任务集被修改');
    },
  },

  // ----------  场景（next 正常推进豁免——exit 推进后的正常 next 不再被误拦） ----------

  // 46: next 正常推进豁免通过——open exit --apply 已把 currentNode 推进到 design（completedNodes=['open']、
  // design 尚未开始故 evidence 无 design 记录），随后按 SKILL 协议调 next（正常路径）→ 不 BLOCK，
  // 输出 NODE: design（ 误拦回归：修复前此状态被 BLOCK 为"疑似未 exit 节点 design"；
  // open 的 evidence 证明该 exit 真实发生过，满足 normalAdvanceExempt）
  {
    name: '46 next 正常：open exit 推进后 currentNode=design 无 evidence（修复任务回退豁免）',
    run: (dir) => {
      const st = baseState('design');
      st.completedNodes = ['open'];
      st.evidence.open = { summary: 'open done' };
      writeState(dir, st);
      // open exit 已通过的产物（design 尚未开始，无 DESIGN.md）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: design');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 47: next 维持严格 BLOCK——真乱序跳节点：currentNode=review 但 completedNodes 仅 ['open']
  // （open 已 exit 且有 evidence）→ review 不是 open 的路由直接后继（open 的后继是 design）
  // →  豁免不成立（回退豁免也不成立：TASK.md 无 pending）→ 严格拦截核心价值
  // 保持（跳节点仍严格拦截），输出恢复指令
  {
    name: '47 next BLOCKED：跳节点乱序（completedNodes 仅 open，currentNode=review）',
    run: (dir) => {
      const st = baseState('review');
      st.completedNodes = ['open'];
      st.evidence.open = { summary: 'open done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 review');
      assertOut(res, 'workflow-guard.mjs exit review --apply');
    },
  },

  // ----------  场景（机制交互组合——两个机制同时作用，防单机制测试盲区） ----------

  // 48: 组合盲区 A（对照组 A 撞出）——record 覆盖语义 × 越俎代庖检测：先经 workflow-handoff
  // result 正确记录 T01 的 Return Contract（含 completedChecks），随后 record subagent-execute
  // '{"handoffResult":{}}'（浅合并整体替换 handoffResult 键）把已记录的 handoff 覆盖丢失 →
  // exit execute 的越俎代庖检测（统一委托下 done 任务必须有 handoff）BLOCK——
  // 组合语义：record 的"整体覆盖"不是无害操作，会连带破坏委托证明链（T01 合法 done 变越俎代庖）
  {
    name: '48 execute exit BLOCKED：record 覆盖 handoff（越俎代庖）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      // ① workflow-handoff result 正确记录 T01 的 Return Contract（含 completedChecks）
      const res = runHandoff(['result', 'T01', JSON.stringify({
        commitHash: 'abcd1234',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t1.mjs' },
        redEvidence: { command: 'node --check src/t1.mjs' },
      })], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF RESULT: T01');
      // ② record subagent-execute '{"handoffResult":{}}' 整体覆盖 evidence['subagent-execute']
      //（浅合并替换 handoffResult 键）→ 已记录的 T01 handoff 丢失（对照组 A 踩坑路径）
      assertExit(runStateWithProtocol(dir, ['record', 'subagent-execute', '{"handoffResult":{}}']), 0);
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const hr = st2.evidence['subagent-execute'] && st2.evidence['subagent-execute'].handoffResult;
      if (!hr || hr['T01']) {
        throw new Error('record 未整体覆盖 handoffResult（T01 应被覆盖丢失）: ' + JSON.stringify(st2.evidence['subagent-execute']));
      }
      // ③ exit execute：T01 done 但 handoff 已被覆盖丢失 → 越俎代庖 BLOCK
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 1);
      assertOut(res2, '越俎代庖');
    },
  },

  // 49（多趟语义翻转）：路由 × 节点推进——subagent-execute 已 completed（第一波 parallel 全 done +
  // exit，completedNodes 含该节点）后，第二波 parallel 任务（P02，depends 已满足）出现时：
  // next 重新路由回 subagent-execute（多趟循环路由——委托进入谓词每趟重新求值，单趟限制已移除）；
  // entry subagent-execute 仍放行（completedNodes 含该节点允许重入——每趟完整 entry 检查不绕过）
  {
    name: '49 next 二次路由回 subagent-execute + entry 重入（多趟语义）',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2_PENDING + TASK_T03_PENDING);
      const st = baseState('subagent-execute');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      st.evidence['subagent-execute'] = { summary: 'wave1 delegated and collected' };
      writeState(dir, st);
      // ① next：第二波 eligible 并行存在 → 多趟路由回该节点（旧单趟「不回流」行为已移除）
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // ② entry subagent-execute：completedNodes 含该节点仍可重入（每趟完整 entry 检查）
      const res2 = runGuard(['entry', 'subagent-execute'], dir);
      assertExit(res2, 0);
      assertOut(res2, 'ENTRY OK');
    },
  },

  // ---------- 校验补充场景（协议 schema nodes 校验 / 豁免 summary 严格化 / hook 声明模式 fail-closed） ----------

  // 50: validateProtocolSchema 拒绝空 node（自定义协议 nodes 含空对象 → 加载报错 fail-closed）
  {
    name: '50 自定义协议空 node：schema 校验拒绝（审查补充）',
    run: (dir) => {
      const badProtocol = customProtocol();
      badProtocol.nodes.push({});
      writeFile(dir, 'bad-protocol.json', JSON.stringify(badProtocol, null, 2) + '\n');
      const res = runState(['status', '--protocol', path.join(dir, 'bad-protocol.json')], dir);
      assertExit(res, 1);
      assertOut(res, 'workflow protocol node must have a non-empty string id');
    },
  },

  // 51: normalAdvanceExempt 空对象 evidence 不豁免（completedNodes 最后节点 evidence 是 {} → next BLOCK）
  {
    name: '51 next BLOCKED：豁免节点 evidence 为空对象（审查补充）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'tdd',
        completedNodes: ['brainstorm'],
        evidence: { brainstorm: {} },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runState(['next', '--protocol', custom], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
    },
  },

  // 52: 协议声明 writeWhitelist 未列出节点 → hook BLOCK（fail-closed）
  {
    name: '52 hook BLOCKED：writeWhitelist 未声明节点（审查补充）',
    run: (dir) => {
      const custom = customProtocol();
      custom.writeWhitelist = { brainstorm: ['.specs/'] };
      writeFile(dir, 'partial-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running', currentNode: 'tdd' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'partial-protocol.json') });
      assertExit(res, 2);
      assertOut(res, '未在协议 writeWhitelist 中声明');
    },
  },

  // ----------  场景（分支前缀可配置，适配仓库规范） ----------

  // 53: init --branch-prefix feat/ → 分支创建为 feat/<id>（适配仓库规范如 feat/）
  {
    name: '53 init --branch-prefix feat/ 创建 feat/<id> 分支',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const res = runStateWithProtocol(dir, ['init', 'prefix-test', '--branch-prefix', 'feat/']);
      assertExit(res, 0);
      assertOut(res, 'BRANCH: feat/prefix-test');
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      if (branch !== 'feat/prefix-test') {
        throw new Error('期望分支 feat/prefix-test，实际 ' + branch);
      }
    },
  },

  // 54: 一致性校验用 state.branchPrefix（status 显示 ok）
  {
    name: '54 status 一致性：branchPrefix=feat/ 分支 feat/<id> → ok',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['checkout', '-b', 'feat/pref-state'], { cwd: dir, stdio: 'ignore' });
      const st = baseState('open');
      st.activeChange = 'pref-state';
      st.branchPrefix = 'feat/';
      writeState(dir, st);
      writeFile(dir, '.specs/pref-state/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/pref-state/REQUIREMENT.md', '# REQUIREMENT\n## 用户故事\nx\n## 验收准则（AC）\nx\n');
      const res = runStateWithProtocol(dir, ['status']);
      assertExit(res, 0);
      assertOut(res, '一致性: ok');
    },
  },

  // ----------  场景（init 写 status + hook 判定对齐） ----------

  // 55: init 生成的 state 必须含 status:'running'（当前缺——hook 判定不一致的根源）
  {
    name: '55 init state 含 status: running',
    run: (dir) => {
      const res = runStateWithProtocol(dir, ['init', 'tf15-st']);
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.status !== 'running') {
        throw new Error('init state 缺 status: running，实际: ' + JSON.stringify(st.status));
      }
    },
  },

  // 56: init 后（open 阶段）越权写源码 → hook BLOCK（当前因 status undefined 放行——三层防线缺口）
  {
    name: '56 hook BLOCKED：init 后越权写源码',
    run: (dir) => {
      const initRes = runStateWithProtocol(dir, ['init', 'tf15-hk']);
      assertExit(initRes, 0);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 2);
    },
  },

  // 57: status:'completed'（归档后状态）→ hook 放行（当前 exit 1 拦截全部写入）
  {
    name: '57 hook 放行：status completed 归档后状态',
    run: (dir) => {
      writeState(dir, composeState({ status: 'completed', activeChange: null, currentNode: null }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'anything.md') } });
      assertExit(res, 0);
    },
  },

  // ----------  场景（init 创建 .specs/<id>/ 目录，findActiveChange 立即可识别） ----------

  // 58: init 后 next 识别 active change（当前因 .specs/<id>/ 目录未建报 No active change）
  {
    name: '58 init 后 next 识别 active change',
    run: (dir) => {
      const initRes = runStateWithProtocol(dir, ['init', 'tf16-dir']);
      assertExit(initRes, 0);
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 open');
      assertNotOut(res, 'No active change');
    },
  },

  // ----------  场景（归档完成态不兜底识别残留目录） ----------

  // 59: state 为归档完成态（completed + activeChange null）→ .specs/ 顶层残留目录（含 TASK.md）不被兜底识别
  {
    name: '59 归档后残留目录不误判为 active',
    run: (dir) => {
      writeState(dir, composeState({ status: 'completed', activeChange: null, currentNode: null }));
      writeFile(dir, '.specs/stale/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/stale/TASK.md', '# TASK\n');
      const res = runStateWithProtocol(dir, ['status']);
      assertExit(res, 0);
      assertOut(res, 'no-change');
      assertNotOut(res, 'stale');
    },
  },

  // ----------  场景（init currentNode 按协议首节点） ----------

  // 60: 自定义协议 init → currentNode = 协议首节点 brainstorm（当前硬编码 open——）
  {
    name: '60 init currentNode 按协议首节点',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const initRes = runState(['init', 'tf18-cp'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(initRes, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.currentNode !== 'brainstorm') {
        throw new Error('init currentNode 应为协议首节点 brainstorm，实际: ' + JSON.stringify(st.currentNode));
      }
    },
  },

  // ---------- 补齐场景（兼容分支固化） ----------

  // 61: 旧 state（无 status 字段但有 activeChange）→ hook 按 running 处理（fail-closed 向后兼容，行为固化）
  {
    name: '61 hook fail-closed：旧 state 无 status 有 activeChange 按 running（既有修复固化）',
    run: (dir) => {
      const st = baseState('open');
      delete st.status;
      st.activeChange = 'legacy-change';
      writeState(dir, st);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 2);
    },
  },

  // 62: init 后（open 阶段）合法写 .specs/ 工件 → hook 放行（ 正确 RED：
  // 修复前 init 无 status → hook「not running」throw exit 1 拦截合法写入——open 阶段无法产出工件）
  {
    name: '62 hook 放行：init 后写 .specs/ 工件',
    run: (dir) => {
      const initRes = runStateWithProtocol(dir, ['init', 'tf15-ok']);
      assertExit(initRes, 0);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'tf15-ok', 'CHANGE.md') } });
      assertExit(res, 0);
      assertOut(res, 'NODE: open');
    },
  },

  // 63: 新 change 与旧归档同名（state 缺失时走扫描兜底）→ 应识别为 active（ 扩展边界：
  // archivedIds 剥日期前缀匹配不得误伤同名新 change）
  {
    name: '63 同名新 change 不被归档检查误跳过',
    run: (dir) => {
      writeFile(dir, '.specs/sci-notation/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/sci-notation/TASK.md', '# TASK\n');
      writeFile(dir, '.specs/archive/2026-08-08-sci-notation/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runStateWithProtocol(dir, ['status']);
      assertExit(res, 0);
      assertOut(res, '"change": "sci-notation"');
    },
  },

  // ---------- 边界补充场景 ----------

  // 64: record 命令的 --protocol 参数不得污染 payload（：payload 解析前剥离）
  {
    name: '64 record --protocol 不污染 payload',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const initRes = runStateWithProtocol(dir, ['init', 'tf14-rec']);
      assertExit(initRes, 0);
      const res = runState(['record', 'open', '{"summary":"x","completedChecks":["a"]}', '--protocol', custom], dir);
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const ev = st.evidence.open || {};
      if (ev.summary !== 'x') {
        throw new Error('summary 被污染，应为 "x"，实际: ' + JSON.stringify(ev.summary));
      }
      if (ev.completedChecks === undefined) {
        throw new Error('completedChecks 丢失（payload 未解析为对象）: ' + JSON.stringify(ev));
      }
    },
  },

  // 65: 自定义协议未声明 writeWhitelist 时，非内置节点写源码 → BLOCK（ 方案 B：
  // 协调者默认 .specs/——当前 fail-open 放行）
  {
    name: '65 自定义节点未声明白名单写源码 BLOCK',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 2);
    },
  },

  // 66: 自定义协议未声明白名单时，写 .specs/ 工件 → 放行（ 协调者默认的正面）
  {
    name: '66 自定义节点未声明白名单写工件放行',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'NODE: brainstorm');
    },
  },

  // 67: 旧格式 state（无 status 字段 + 无 activeChange + 无 currentNode——归档批次的升级场景）
  // → hook 放行（：无 activeChange 与无 state 文件同语义——当前被「not running」拦截）
  {
    name: '67 旧 state 无 status 无 activeChange hook 放行',
    run: (dir) => {
      const st = baseState('open');
      delete st.status;
      st.activeChange = null;
      st.currentNode = null;
      writeState(dir, st);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 0);
    },
  },

  // 68: writeWhitelist 路径支持 <change-id> 占位符（：协议复用自动适配——
  // 与 artifacts paths 同机制——当前字面匹配失败 BLOCK）
  {
    name: '68 writeWhitelist change-id 占位符',
    run: (dir) => {
      const custom = customProtocol();
      custom.writeWhitelist = { brainstorm: ['.specs/<change-id>/'] };
      writeFile(dir, 'ph-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running' }));
      // 写 .specs/compose-demo/（占位符替换为 activeChange=compose-demo）→ 放行
      const r1 = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'ph-protocol.json') });
      assertExit(r1, 0);
      // 写 .specs/other/（不在白名单）→ BLOCK
      const r2 = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'other', 'x.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'ph-protocol.json') });
      assertExit(r2, 2);
    },
  },

  // 69: 自定义协议 init 输出 NODE: 协议首节点（：printNext 硬编码 open——输出与 state 不一致）
  {
    name: '69 init 输出 NODE 协议首节点',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const res = runState(['init', 'tf17-out'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'NODE: brainstorm');
      assertNotOut(res, 'NODE: open');
    },
  },

  // 70: state completed + activeChange 非空（残留值）→ status 应 no-change（：
  // completed 检查优先于 activeChange 分支——当前 activeChange 分支先命中误判）
  {
    name: '70 completed state 残留 activeChange 不误判',
    run: (dir) => {
      const st = composeState({ status: 'completed', currentNode: null });
      st.activeChange = 'stale-id';
      writeState(dir, st);
      writeFile(dir, '.specs/stale-id/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/stale-id/TASK.md', '# TASK\n');
      const res = runStateWithProtocol(dir, ['status']);
      assertExit(res, 0);
      assertOut(res, 'no-change');
    },
  },

  // 71: 自定义协议未声明 state.statePath（最小 schema）→ hook 不崩溃，写 .specs/ 放行
  // （：statePath 缺省回退 .flow-comet/flow-comet-state.json——与 workflow-state 硬编码一致；
  //  当前空值解析崩溃 exit 1 全量拦截）
  {
    name: '71 无 statePath 协议 hook 不崩溃',
    run: (dir) => {
      const custom = customProtocol();
      delete custom.state;
      writeFile(dir, 'nostate-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'nostate-protocol.json') });
      assertExit(res, 0);
    },
  },

  // 72: state 文件带 UTF-8 BOM（外部写入如会话 Write）→ status 正常输出（：
  // 读端 JSON.parse 应容忍 BOM——当前崩）
  {
    name: '72 state 带 BOM 正常读取',
    run: (dir) => {
      const st = composeState({ status: 'running' });
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.flow-comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), raw, 'utf8');
      writeFile(dir, '.specs/compose-demo/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runStateWithProtocol(dir, ['status']);
      assertExit(res, 0);
      assertOut(res, '"status": "running"');
    },
  },

  // 73: hook 读带 BOM 的 state → 判定正常（——hook readStateJson 的 BOM 容忍）
  {
    name: '73 hook 读带 BOM state 正常',
    run: (dir) => {
      const st = baseState('open');
      st.status = 'running';
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.flow-comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), raw, 'utf8');
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'CHANGE.md') } });
      assertExit(res, 0);
      assertOut(res, 'NODE: open');
    },
  },

  // ----------  场景（builtin 降级须含缓存尝试证据） ----------

  // 74: builtin-quickcheck 声明 + 不可用原因但无缓存尝试证据 → BROOKS-LINT WARN
  // （：防「未尝试 Read 插件缓存协议文件」的偷懒降级——修复前不校验 = RED）
  {
    name: '74 builtin 无缓存尝试证据 → WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbuiltin-quickcheck — brooks-lint 不可用（Skill 仅返回占位，插件执行体未加载），按协议降级内置 R1~R6 快查',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 75: cache-brooks 声明（两级降级路径第 2 级——读缓存手动执行成功）→ 放行
  // （ 补：guard method 正则须识别 cache-brooks——修复前正则不匹配 → 全文无 brooks-review/builtin → BLOCKED = RED）
  {
    name: '75 cache-brooks 声明 → 放行',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\ncache-brooks — 已 Read 插件缓存协议文件手动执行完整审查（4-element + file:line + 书引用），结果见「6 维自查」',
        sixDim: '## 6 维自查\n\n- 功能: 通过（cache-brooks 审查已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 76: builtin-quickcheck 声明 + 不可用原因 + 含缓存尝试证据（已 Read 插件缓存协议文件）→ 无 WARN 放行
  // （ 正面：两级降级路径的第 2 级被正确执行后的合法态）
  {
    name: '76 builtin 含缓存尝试证据 → 无 WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbuiltin-quickcheck — 已尝试 Skill 加载（仅占位）并已 Read 插件缓存协议文件（~/.claude/plugins/cache/brooks-lint-marketplace/...）手动执行，仍不可行，brooks-lint 不可用，按协议降级内置 R1~R6 快查',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 77: guard 读带 BOM 的 state → 正常（——guard readStateJson 的 BOM 容忍）
  {
    name: '77 guard 读带 BOM state 正常',
    run: (dir) => {
      const st = baseState('open');
      st.status = 'running';
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.flow-comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), raw, 'utf8');
      writeFile(dir, '.specs/compose-demo/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runGuardWithProtocol(dir, ['entry', 'open']);
      assertExit(res, 0);
    },
  },

  // ----------  场景（worktree 委托链路，验证问题实录） ----------

  // 78: 路由诊断——「未找到可委托并行块」诊断的在场/静默边界。期望随 multipass-exit-hardening
  // ROUTE WARN 前置条件语义更新（ROUTE WARN 增加存在任一 status=pending 的前置条件）：① 夹具存在可解析 pending
  // 任务（串行 pending + 并行全 done）且无可委托并行块 → ROUTE WARN 保持在场（检测失败纠偏可见
  // ——信息量保留）；② 旧模板无 status 属性形态（无可解析 pending）→ 按新前置条件静默
  // （原「旧模板也告警」行为被设计性取代）。
  // nextNode 只看 completedNodes——路由触发场景 = exit plan（completed 后 nextNode=execute → 路由检查）
  {
    name: '78 路由诊断：有 pending 无可委托并行 WARN 在场 / 无可解析 pending 静默',
    run: (dir) => {
      const st = baseState('plan');
      st.completedNodes = ['open', 'design'];
      st.evidence.plan = { summary: 'executed' };
      writeState(dir, st);
      // 上游工件（open=CHANGE+REQUIREMENT、design=DESIGN-lite、plan=TASK）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n## 用户故事\nx\n## 验收准则（AC）\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN-lite.md', '# DESIGN-lite\n## 决策清单\n- d1: x\n');
      // ① 可解析 pending 在场且剩余全串行（并行已 done、串行 pending、无缺 status 畸形块）
      // → M4 静默（P→S 收尾转换无噪音——① 语义随扩展翻转）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P01" parallel="true" status="done">\n  <action>do</action>\n  <verify>echo ok</verify>\n</task>\n' +
        '<task id="T01" parallel="false" status="pending">\n  <action>do serial</action>\n  <verify>echo ok</verify>\n</task>\n');
      const res = runGuardWithProtocol(dir, ['exit', 'plan', '--apply']);
      assertExit(res, 0);
      assertNotOut(res, 'ROUTE WARN');
      // ② 旧模板无 status 属性（无可解析 pending）→ 前置条件跳过诊断 → 静默
      //（① 的 --apply 已把 currentNode 推进到 execute——先复位 state 再独立跑第二半）
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T02" parallel="true">\n  <action>do legacy</action>\n  <verify>echo ok</verify>\n</task>\n');
      const resLegacy = runGuardWithProtocol(dir, ['exit', 'plan', '--apply']);
      assertExit(resLegacy, 0);
      assertNotOut(resLegacy, 'ROUTE WARN');
    },
  },

  // 79: C4 catch 可见化——非 git 仓库 → entry execute 输出 C4-CHECK SKIP
  // （检测失败也要可见——修复前 catch 静默 = RED）
  {
    name: '79 C4 catch 非 git 仓库输出 SKIP',
    run: (dir) => {
      const st = baseState('execute');
      writeState(dir, st);
      const res = runGuardWithProtocol(dir, ['entry', 'execute']);
      assertExit(res, 0);
      assertOut(res, 'C4-CHECK SKIP');
    },
  },

  // 80: handoff result commitHash 存在性校验——不存在 → HANDOFF ERROR（固化：校验已存在（W2-D），经确认）
  {
    name: '80 handoff result 无效 commitHash → ERROR（batch-H 固化）',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
      const payload = JSON.stringify({
        status: 'DONE',
        commitHash: 'deadbeef00000000000000000000000000000000',
        redEvidence: { command: 'echo red', output: 'red' },
        greenEvidence: { command: 'echo green', output: 'green' },
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        riskSignals: ['none'],
      });
      const res = runHandoff(['result', 'T01', payload], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF ERROR: commitHash 无效或 git show 失败');
    },
  },

  // 81: entry/exit WARN COUNT 汇总行——构造 BROOKS-LINT WARN → exit 输出 WARN COUNT
  // （ F：可观测性——修复前无汇总行 = RED）
  {
    name: '81 exit 输出 WARN COUNT 汇总',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbuiltin-quickcheck — brooks-lint 不可用（Skill 仅返回占位，插件执行体未加载），按协议降级内置 R1~R6 快查',
      }));
      const res = runGuardWithProtocol(dir, ['exit', 'execute']);
      assertExit(res, 0);
      assertOut(res, 'BROOKS-LINT WARN');
      assertOut(res, 'WARN COUNT:');
    },
  },

  // 82: 空退出行为固化——全 parallel 任务 exit execute → task-summaries BLOCKED（现状保护，H1 文档一致化的行为锚点）
  {
    name: '82 全 parallel exit execute BLOCKED 产物（batch-H 固化）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" parallel="true" status="pending">\n  <action>do</action>\n</task>\n<task id="T02" parallel="true" status="pending">\n  <action>do2</action>\n</task>\n');
      const res = runGuardWithProtocol(dir, ['exit', 'execute']);
      assertExit(res, 1);
      assertOut(res, 'missing Output Schema artifacts');
    },
  },

  // 83~91: 自动初始化检测（auto-init-detection）——脚本确定性探测/判决/提示 + agent 生成协作
  // 生成职责：--init-context 时 CONTEXT 缺失 → INIT-GENERATE 指引（不生成、
  // 不写 last_intel_scan），由 agent 全量阅读生成；生成后重跑 → 脚本校验 7 段 → 通过写 last_intel_scan。
  // 83: CONTEXT 缺失 + 有代码上下文 → init 输出 INIT-NEEDED 且不自动生成（基础探测）
  {
    name: '83 CONTEXT 缺失 + 有代码 → init 输出 INIT-NEEDED 不生成',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      assertOut(res, 'INIT-NEEDED');
      if (fs.existsSync(path.join(dir, '.specs', 'CONTEXT.md'))) throw new Error('CONTEXT 不应被自动生成');
    },
  },

  // 84: --init-skip → state.ai_context_doc='none'，下次 init 不再提示（拒绝路径）
  {
    name: '84 --init-skip 记 none 且下次 init 静默',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-skip']);
      const st1 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st1.ai_context_doc !== 'none') throw new Error('ai_context_doc 应为 none');
      const res2 = runStateWithProtocol(dir, ['init', CHANGE_ID + '-2']);
      if (res2.output.includes('INIT-NEEDED') || res2.output.includes('INIT-HINT')) throw new Error('下次 init 不应再提示');
    },
  },

  // 85: CONTEXT 新鲜（last_intel_scan ≤90 天）→ init 零初始化输出（新鲜路径）
  {
    name: '85 CONTEXT 新鲜 → init 零初始化输出',
    run: (dir) => {
      writeState(dir, { ...baseState('open'), last_intel_scan: new Date(Date.now() - 10 * 864e5).toISOString() });
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      if (res.output.includes('INIT-NEEDED') || res.output.includes('INIT-HINT')) throw new Error('不应有初始化提示');
    },
  },

  // 86: 有 CONTEXT 无扫描记录（旧项目迁移）→ INIT-HINT 文案不得含 null
  {
    name: '86 有 CONTEXT 无扫描记录 → INIT-HINT 文案无 null',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      assertOut(res, 'INIT-HINT');
      if (res.output.includes('null')) throw new Error('INIT-HINT 不应含 "null"（无扫描记录时用友好文案）');
    },
  },

  // 87: CONTEXT 缺失 + --init-context → INIT-GENERATE 指引且不生成、不写 last_intel_scan（生成协作第一步）
  {
    name: '87 --init-context 无 CONTEXT → INIT-GENERATE 指引不生成',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      if (fs.existsSync(path.join(dir, '.specs', 'CONTEXT.md'))) throw new Error('CONTEXT 不应由脚本生成（生成职责在 agent）');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('校验通过前不应写 last_intel_scan');
    },
  },

  // 88: CONTEXT 缺失 + 既有 AI 文档 + --init-context → INIT-GENERATE 指引含源文档列表
  {
    name: '88 --init-context 指引含源文档列表',
    run: (dir) => {
      writeFile(dir, 'CLAUDE.md', '# CLAUDE\n项目约定：使用 kebab-case 命名。\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      assertOut(res, 'CLAUDE.md');
    },
  },

  // 89: CONTEXT 缺失 + 代码信号 + --init-context → INIT-GENERATE 指引含代码信号
  {
    name: '89 --init-context 指引含代码信号',
    run: (dir) => {
      writeFile(dir, 'requirements.txt', 'pytest\n');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      assertOut(res, '代码信号');
    },
  },

  // 90: CONTEXT 已存在且 7 段 + 模板格式完整 + --init-context → INIT-DONE + last_intel_scan 写入（生成协作第二步）
  {
    name: '90 CONTEXT 7 段+格式完整 --init-context → INIT-DONE + state 写入',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- [2026-08-01] 决策一\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-DONE');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.last_intel_scan) throw new Error('校验通过后应写 last_intel_scan');
    },
  },

  // 91: CONTEXT 存在但缺段 + --init-context → INIT-VALIDATE-FAILED 重写指引 + 不写 last_intel_scan。
  // ② 段名判定须为**精确标题**匹配（非全文 includes）：段名变体（`## 技术栈补充`）与正文文本提及
  // 都不得算作段存在——旧 includes 判据下二者会假通过（校验放行 + 写 last_intel_scan）。
  // ③ 标题解析须先排除围栏代码块：代码示例里的 `## 段名` 不是段（否则缺段仍能假通过并写扫描时间）。
  {
    name: '91 CONTEXT 缺段 --init-context → 重写指引不写 state（含围栏代码块段名不假通过）',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      let res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      assertOut(res, '重写');
      let st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('校验失败不应写 last_intel_scan');
      // ② 段名变体（含正文提及）不满足必填段
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈补充\nx\n## 域语言说明\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策说明\n- [2026-08-01] 决策一\n## 默认偏好补充\nx\n## 既有抽象索引附录\nx\n## intel-scan 元数据附录\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n正文提及 域语言 与 默认偏好 与 既有抽象索引（文本非标题）。\n');
      res = runStateWithProtocol(dir, ['init', CHANGE_ID + '-2', '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('段名变体不应通过校验（不应写 last_intel_scan）');
      // ③ 围栏代码块内的 `## 段名` 不计入标题集合：缺 `## 默认偏好`，但三种围栏形态——
      //    带语言标注的反引号围栏、缩进 2 空格的波浪线围栏、波浪线围栏——内都出现该段名。
      //    标题正则若不跟踪围栏边界，就会把这些示例行当成段存在 → 假通过并写扫描时间（RED）。
      writeFile(dir, '.specs/CONTEXT.md', [
        '# CONTEXT',
        '## 项目概要', 'x',
        '## 技术栈', 'x',
        '## 域语言', '| 术语 | 定义 |', '|---|---|', '| 例 | 定义 |',
        '## 已锁决策', '- [2026-08-01] 决策一',
        '## 既有抽象索引', 'x',
        '## intel-scan 元数据', '- **last_intel_scan**: x', '- **scanner**: x', '- **下次重扫建议**: x',
        '示例（以下均为代码示例，不是段）：',
        '```markdown', '## 默认偏好', '- 反引号围栏内的示例', '```',
        '  ~~~', '## 默认偏好', '  ~~~',
        '~~~text', '## 默认偏好', '~~~',
        '',
      ].join('\n'));
      res = runStateWithProtocol(dir, ['init', CHANGE_ID + '-3', '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('围栏内的段名不应通过校验（不应写 last_intel_scan）');
    },
  },

  // 92: CONTEXT 7 段齐全但模板格式不满足（已锁决策无日期前缀）→ 格式校验失败重写指引 + 不写 state
  {
    name: '92 CONTEXT 格式不满足模板 → 重写指引不写 state',
    run: (dir) => {
      // 7 段齐全但已锁决策条目缺 [YYYY-MM-DD] 日期前缀（模板格式）
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- 决策缺日期前缀\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      assertOut(res, '日期');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('格式校验失败不应写 last_intel_scan');
    },
  },

  // 93: 新项目骨架 CONTEXT（已锁决策仅占位）→ 占位放行 INIT-DONE（DF-5：占位不是裸条目）
  {
    name: '93 新项目占位 CONTEXT → 校验通过 INIT-DONE',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\n新项目骨架\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| （待沉淀） | 随 change 逐步补充 |\n## 已锁决策\n- （待沉淀——后续 change 按时间倒序追加）\n## 默认偏好\n- 待补充\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-DONE');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.last_intel_scan) throw new Error('占位 CONTEXT 校验通过应写 last_intel_scan');
    },
  },

  // 94: CONTEXT 已满足模板但无扫描记录 + init 无参数 → 提示"记录扫描时间"（C 文案优化——
  // agent 生成后未重跑的悬空态，误导性"扫描时间未知/刷新"文案不出现）
  {
    name: '94 CONTEXT 就绪无扫描记录 → 提示记录扫描时间',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- [2026-08-01] 决策一\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      assertOut(res, '记录扫描时间');
      if (res.output.includes('刷新')) throw new Error('CONTEXT 已就绪不应提示"刷新"（应提示记录扫描时间）');
    },
  },

  // 95: init 同 id 重跑（.specs/<id>/ 已存在）→ WARN 防护输出且不阻断（F）
  {
    name: '95 init 同 id 重跑 → WARN 防护不阻断',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      runStateWithProtocol(dir, ['init', CHANGE_ID]);
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      assertOut(res, 'WARN: change ' + CHANGE_ID + ' 已存在');
      assertOut(res, '重置节点状态');
    },
  },

  // 96~97: 端到端验证实证的校验误报修复
  // 96: 自检方法段内后续行声明方法（子代理把方法名写在列表后续行）→ 放行无 WARN
  // （修复前 guard 正则只匹配段后第一行 → 全文有 cache-brooks 声明 → 误报 BROOKS-LINT WARN = RED）
  {
    name: '96 自检方法段后续行声明 → 放行',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\n- flow-comet-dev Skill 加载成功\n- 自检：第 1 级 brooks-review 返回占位 → 第 2 级 Read 插件缓存协议文件手动执行（selfReview: cache-brooks）',
        sixDim: '## 6 维自查\n\n- 功能: 通过（cache-brooks 审查已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 97: handoff changedFiles 含任务专属 SUMMARY(.specs/<change-id>/<task-id>-SUMMARY.md,
  // 精确豁免路径)→ 不报越界 WARN;其他 *-SUMMARY.md(非本任务路径)仍判越界
  // (修复前 W2-D 以 endsWith('-SUMMARY.md') 全量豁免 + 前缀匹配 = RED;真实 commitHash 供 git show 校验)
  {
    name: '97 handoff 含 SUMMARY 文件 → 无越界 WARN',
    run: (dir) => {
      const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      g(['init', '-q']);
      g(['config', 'user.email', 't@t']);
      g(['config', 'user.name', 't']);
      writeFile(dir, 'test_stats.py', 'def f():\n    pass\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', '# T01-SUMMARY\n## 做了什么\nx\n');
      // 只提交指定文件（场景运行器预置的 reference/ 协议文件不入提交集）
      g(['add', 'test_stats.py', '.specs/' + CHANGE_ID + '/T01-SUMMARY.md']);
      g(['commit', '-qm', 'init']);
      const hash = g(['rev-parse', 'HEAD']).stdout.trim();
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = {
        handoffRequests: { T01: { writeFiles: ['test_stats.py'] } },
        handoffResult: {},
      };
      writeState(dir, st);
      const res = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', commitHash: hash,
        changedFiles: ['test_stats.py', '.specs/' + CHANGE_ID + '/T01-SUMMARY.md'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check test_stats.py', output: 'ok' },
      })], dir);
      assertExit(res, 0);
      if (res.output.includes('超出 writeFiles 范围')) throw new Error('任务专属 SUMMARY 不应报越界 WARN');
    },
  },
];
