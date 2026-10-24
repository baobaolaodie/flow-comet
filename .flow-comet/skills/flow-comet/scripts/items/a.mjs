// items/a.mjs — A 组条目（状态机与路由）
//
// 数据层约定：本文件只承载条目数据（`export const ENTRIES = [...]`，计数派生按此聚合，见
// lib/count-derivation.mjs）；夹具一律从 `lib/system-fixtures.mjs` 取，组文件之间零 import。
//
// 组界：条目序列按组文件规模上限**连续分区**，A 组尾部三项（Fix 回路）落在 items/b.mjs 头部——
// 文件是序列的连续分区，条目名保留机制面前缀（先例：场景元素 250c 由 scenarios/i 移入 scenarios/j）。
// 分区只搬文件、不动条目顺序与名字：system-test 的逐项输出顺序与文案因此逐字节不变。

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { assertEqual, assertExit, assertNotOut, assertOut, assertTrue, baseState, runGuard, runHandoff, runState, writeFile, writeState } from '../lib/test-helpers.mjs';
import { archiveRecordJson, multiWaveTaskContent, explainContractProblems, assertExplainFailClosed, explainReverseConstructionProblems, CHANGE_ID, readStateFile, gitInit, gitBranch, writeIntakeArtifacts, fullContract, execSummaryFixture, assertNodeLine, driveThroughDesign } from '../lib/system-fixtures.mjs';

// skill-load 的模板声明（节点级，C3/AC-13 加载链）：参数化的委托驱动按节点查表——夹具是真实命令
// 序列，声明集合要与节点映射一致（集合不一致时引擎按 C11 fail-closed 拦截）。
const TEMPLATE_DECLARATION = {
  open: 'CHANGE.md,REQUIREMENT.md',
  design: 'DESIGN.md',
  plan: 'TASK.md',
  execute: 'SUMMARY.md',
  'subagent-execute': 'SUMMARY.md',
  review: 'REVIEW.md,TEST.md',
};

function skillLoadArgs(nodeId, skill, prompt) {
  const args = ['skill-load', nodeId, skill, '--prompt', prompt];
  if (TEMPLATE_DECLARATION[nodeId]) args.push('--templates', TEMPLATE_DECLARATION[nodeId]);
  return args;
}

export const ENTRIES = [
  // ---------- A. 状态机与路由 ----------

  {
    name: 'A1 init：状态写入与工件目录创建',
    run: (dir) => {
      const res = runState(['init', CHANGE_ID], dir);
      assertExit(res, 0);
      assertOut(res, 'Initialized: ' + CHANGE_ID);
      assertOut(res, 'NODE: open');
      assertOut(res, 'BRANCH: none');
      const st = readStateFile(dir);
      if (st.activeChange !== CHANGE_ID) throw new Error('activeChange 应为 ' + CHANGE_ID);
      if (st.currentNode !== 'open') throw new Error('currentNode 应为 open: ' + JSON.stringify(st.currentNode));
      if (st.status !== 'running') throw new Error('status 应为 running');
      if (st.branchMode !== false) throw new Error('非 git 仓库 branchMode 应为 false');
      if (!fs.existsSync(path.join(dir, '.specs', CHANGE_ID))) throw new Error('.specs/<id>/ 目录未创建');
    },
  },

  {
    name: 'A2 init 分支模式：--branch-prefix 创建指定前缀分支',
    run: (dir) => {
      gitInit(dir);
      const res = runState(['init', 'br-test', '--branch-prefix', 'feat/'], dir);
      assertExit(res, 0);
      assertOut(res, 'BRANCH: feat/br-test');
      if (gitBranch(dir) !== 'feat/br-test') throw new Error('期望分支 feat/br-test，实际 ' + gitBranch(dir));
      const st = readStateFile(dir);
      if (st.branchPrefix !== 'feat/') throw new Error('branchPrefix 应为 feat/: ' + JSON.stringify(st.branchPrefix));
      // 分支一致性：status 显示 ok
      const status = runState(['status'], dir);
      assertExit(status, 0);
      assertOut(status, 'BRANCH: feat/br-test | 一致性: ok');
      // 非法前缀拒绝
      const bad = runState(['init', 'br-bad', '--branch-prefix', ''], dir);
      assertExit(bad, 1);
      assertOut(bad, '--branch-prefix requires a non-empty prefix');
    },
  },

  {
    name: 'A3 init 同 id 重跑：防护提示不阻断',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const res = runState(['init', CHANGE_ID], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: change ' + CHANGE_ID + ' 已存在');
      assertOut(res, '重置节点状态');
    },
  },

  {
    name: 'A4 status/explain：节点推导、节点现问契约（逐字段对账 + fail-closed + 只读）与无活跃兜底',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      // 无产物 → 首节点
      const s1 = runState(['status'], dir);
      assertExit(s1, 0);
      assertOut(s1, '"currentNode": "open"');
      // 上游工件齐 → 推导下一节点
      writeIntakeArtifacts(dir);
      const s2 = runState(['status'], dir);
      assertExit(s2, 0);
      assertOut(s2, '"currentNode": "design"');
      // —— explain <node>：节点现问契约（真实子进程，零 mock；契约声明源 = 协议 JSON）——
      // 8 节点逐个逐字段对账（label / kind / outputSchema 名与描述 / artifact / evidence / guardrail /
      // requiredSkillCall / 三条命令）+ 三种 fail-closed 形态 + 只读性 + 反向构造（声明副本抽掉一条
      // guardrail / 一个 artifact、改一条 schema 描述 ⇒ 对账必报；判据与探针见模块级单一实现）。
      const protocolDecl = JSON.parse(fs.readFileSync(path.join(dir, 'reference', 'workflow-protocol.json'), 'utf8'));
      const stateFilePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const stateHashBefore = createHash('sha256').update(fs.readFileSync(stateFilePath)).digest('hex');
      const statusBefore = runState(['status'], dir);
      const explainOutputs = new Map();
      for (const protocolNode of protocolDecl.nodes) {
        const res = runState(['explain', protocolNode.id], dir);
        assertExit(res, 0);
        assertOut(res, 'NODE: ' + protocolNode.id);
        explainOutputs.set(protocolNode.id, res.output);
      }
      const contractProblems = explainContractProblems(protocolDecl, explainOutputs);
      assertTrue(contractProblems.length === 0,
        'explain 输出与协议 JSON 声明不一致: ' + contractProblems.join('; '));
      // 只读性：调用前后状态文件 sha256 全等 + status 读数逐字不变（explain 不写 state、不改路由）
      assertEqual(createHash('sha256').update(fs.readFileSync(stateFilePath)).digest('hex'), stateHashBefore,
        'explain 改写了状态文件（只读通道被破坏）');
      assertEqual(runState(['status'], dir).output, statusBefore.output, 'explain 改动了路由读数（只读通道被破坏）');
      assertExplainFailClosed(dir, protocolDecl);
      const probeProblems = explainReverseConstructionProblems(dir, protocolDecl, explainOutputs);
      assertTrue(probeProblems.length === 0, '反向构造判别力缺失: ' + probeProblems.join('; '));
      // 无 state 无工件 → no-change 兜底
      fs.rmSync(path.join(dir, '.flow-comet'), { recursive: true });
      const s3 = runState(['status'], dir);
      assertExit(s3, 0);
      assertOut(s3, '"status": "no-change"');
    },
  },

  {
    name: 'A5 next：推进与状态漂移校正',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md', '--templates', 'CHANGE.md,REQUIREMENT.md'], dir), 0);
      writeIntakeArtifacts(dir);
      assertExit(runState(['record', 'open', '{"summary":"intake complete"}'], dir), 0);
      // 真实出口：exit open --apply（未激活声明机制 → 兼容警告 + 通过）
      assertExit(runGuard(['entry', 'open'], dir), 0);
      const exitRes = runGuard(['exit', 'open', '--apply'], dir);
      assertExit(exitRes, 0);
      assertOut(exitRes, 'ALL CHECKS PASSED');
      let st = readStateFile(dir);
      if (!st.completedNodes.includes('open')) throw new Error('completedNodes 应含 open: ' + JSON.stringify(st.completedNodes));
      // 正常推进：next → design
      const n1 = runState(['next'], dir);
      assertExit(n1, 0);
      assertOut(n1, 'NODE: design');
      assertNotOut(n1, 'BLOCKED');
      // 漂移校正：手工把 currentNode 改回 open（已完成节点）→ next 以文件推导为准校正
      st = readStateFile(dir);
      st.currentNode = 'open';
      writeState(dir, st);
      const n2 = runState(['next'], dir);
      assertExit(n2, 0);
      assertOut(n2, 'NODE: design');
      const stAfter = readStateFile(dir);
      if (stAfter.currentNode !== 'design') throw new Error('漂移应被校正为 design: ' + JSON.stringify(stAfter.currentNode));
    },
  },

  {
    name: 'A6 next：未出口节点严格拦截',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runState(['next'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED: 疑似未 exit 节点 open');
      assertOut(res, 'workflow-guard.mjs exit open --apply');
    },
  },

  {
    name: 'A7 select：切换项目与缺失拒绝',
    run: (dir) => {
      assertExit(runState(['init', 'sel-a'], dir), 0);
      // 第二个活跃 change 目录（模拟多 change 并存）
      writeFile(dir, '.specs/sel-b/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runState(['select', 'sel-b'], dir);
      assertExit(res, 0);
      assertOut(res, 'Selected: sel-b');
      const st = readStateFile(dir);
      if (st.activeChange !== 'sel-b') throw new Error('activeChange 应为 sel-b: ' + JSON.stringify(st.activeChange));
      // 不存在的 change → 拒绝
      const missing = runState(['select', 'no-such'], dir);
      assertExit(missing, 1);
      assertOut(missing, 'Change not found');
    },
  },

  {
    name: 'A8 advance：节点推进',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      writeIntakeArtifacts(dir);
      const res = runState(['advance'], dir);
      assertExit(res, 0);
      assertOut(res, 'Advanced to: design');
      const st = readStateFile(dir);
      if (!st.completedNodes.includes('open')) throw new Error('completedNodes 应含 open: ' + JSON.stringify(st.completedNodes));
      if (st.currentNode !== 'design') throw new Error('currentNode 应为 design');
      // 无活跃 change → 提示不推进
      const st2 = readStateFile(dir);
      st2.activeChange = null;
      writeState(dir, st2);
      const none = runState(['advance'], dir);
      assertExit(none, 0);
      assertOut(none, 'No active change. Use select first.');
    },
  },

  {
    name: 'A9 record：基础证据记录',
    run: (dir, outcomes) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--templates', 'CHANGE.md,REQUIREMENT.md'], dir), 0);
      // JSON payload → evidence 写入 + next 提示
      const res = runState(['record', 'open', '{"summary":"recorded"}'], dir);
      assertExit(res, 0);
      assertOut(res, 'EVIDENCE: open');
      assertOut(res, 'NODE: open');
      const st = readStateFile(dir);
      if (!st.evidence.open || st.evidence.open.summary !== 'recorded') {
        throw new Error('record 未写入 evidence: ' + JSON.stringify(st.evidence));
      }
      if (typeof st.evidence.open.recordedAt !== 'string') throw new Error('evidence 应附带 recordedAt');
      // 非 JSON payload → 按 summary 字符串记录
      assertExit(runState(['record', 'open', 'plain text'], dir), 0);
      const st2 = readStateFile(dir);
      if (st2.evidence.open.summary !== 'plain text') throw new Error('非 JSON payload 应按 summary 记录');
      // --json-file:从文件读 JSON payload(规避 Windows PowerShell 引号剥离)
      fs.writeFileSync(path.join(dir, 'payload.json'), '{"summary":"from-file"}', 'utf8');
      const rf = runState(['record', 'open', '--json-file', 'payload.json'], dir);
      assertExit(rf, 0);
      const st3 = readStateFile(dir);
      if (st3.evidence.open.summary !== 'from-file') throw new Error('--json-file payload 未生效');
      // --json-file 越界路径(解析后出项目根)→ 拒绝(防读取任意文件进 evidence)
      const outsideFile = path.join(dir, '..', 'outside.json');
      fs.writeFileSync(outsideFile, '{"summary":"outside"}', 'utf8');
      const rfBad = runState(['record', 'open', '--json-file', outsideFile], dir);
      assertExit(rfBad, 1);
      assertOut(rfBad, '必须在项目根内');
      // --json-file 符号链接越界(realpath 校验):链接到项目根外的符号链接 → 拒绝。
      // 平台限制:Windows 创建符号链接需开发者模式/管理员——创建失败时显式跳过并说明,
      // 不静默(POSIX/CI 真实覆盖该负例)
      const outsideTarget = path.join(dir, '..', 'outside-symlink-target.json');
      fs.writeFileSync(outsideTarget, '{"summary":"outside"}', 'utf8');
      const symlinkPath = path.join(dir, 'payload-link.json');
      // 平台限制:Windows 创建符号链接需开发者模式/管理员——创建失败时登记显式「不适用（平台原因）」
      // 并由运行器逐条出声（不复用条件分支的静默跳过:未验证 ≠ 通过）。
      // 仅 symlink 创建包在 try 内——断言移出 catch,防断言失败被误报为平台跳过
      // (修复前 try 包住 runState/断言,真实回归会被吞为"平台不支持跳过")
      let symlinkCreated = false;
      try {
        fs.symlinkSync(outsideTarget, symlinkPath);
        symlinkCreated = true;
      } catch (e) {
        outcomes.notApplicablePlatform('A9 --json-file 符号链接越界负例',
          '本平台不支持创建符号链接（' + e.code + '）');
      }
      if (symlinkCreated) {
        const rfSym = runState(['record', 'open', '--json-file', 'payload-link.json'], dir);
        assertExit(rfSym, 1);
        assertOut(rfSym, '符号链接');
      }
      // 缺 node 参数 → 拒绝
      const noNode = runState(['record'], dir);
      assertExit(noNode, 1);
      assertOut(noNode, 'record requires a Node id.');
      // --json-file 缺值(最后一个参数)→ 用法错误而非类型错误(修复前 path.resolve
      // 对 undefined 抛 TypeError——报类型错误而非用法错误,此处应 RED)
      const missingVal = runState(['record', 'open', '--json-file'], dir);
      assertExit(missingVal, 1);
      assertOut(missingVal, '--json-file requires a path argument');
      if (missingVal.output.includes('ERR_INVALID_ARG_TYPE')) {
        throw new Error('--json-file 缺值不应报类型错误');
      }
      // --json-file 空串(--json-file= 形式)→ 同样用法错误(修复前解析为项目根报 EISDIR)
      const emptyVal = runState(['record', 'open', '--json-file='], dir);
      assertExit(emptyVal, 1);
      assertOut(emptyVal, '--json-file requires a path argument');
    },
  },

  {
    name: 'A10 execution-mode：direct 切换与记录',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const d = runState(['execution-mode', 'direct'], dir);
      assertExit(d, 0);
      assertOut(d, 'EXECUTION-MODE: direct (directOverride)');
      let st = readStateFile(dir);
      if (st.executionMode !== 'direct' || st.directOverride !== true) {
        throw new Error('direct 模式应记录 directOverride=true: ' + JSON.stringify({ executionMode: st.executionMode, directOverride: st.directOverride }));
      }
      const s = runState(['execution-mode', 'subagent'], dir);
      assertExit(s, 0);
      assertOut(s, 'EXECUTION-MODE: subagent');
      st = readStateFile(dir);
      if (st.executionMode !== 'subagent' || st.directOverride !== false) {
        throw new Error('切回 subagent 应清除 directOverride: ' + JSON.stringify(st.directOverride));
      }
      // 非法参数拒绝
      const bad = runState(['execution-mode', 'bogus'], dir);
      assertExit(bad, 1);
      assertOut(bad, 'BLOCKED: execution-mode 参数必须为 subagent 或 direct');
    },
  },

  {
    name: 'A11 config：配置设置与非法值拒绝',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const ok = runState(['config', 'set', 'enablePrReview', 'true'], dir);
      assertExit(ok, 0);
      assertOut(ok, 'CONFIG: enablePrReview = true');
      const st = readStateFile(dir);
      if (st.enablePrReview !== true) throw new Error('enablePrReview 应为 true');
      // branchMode 只读拒绝
      const branch = runState(['config', 'set', 'branchMode', 'true'], dir);
      assertExit(branch, 1);
      assertOut(branch, 'BLOCKED: branchMode 由 init 自动判定');
      // 值非法拒绝
      const bad = runState(['config', 'set', 'enablePrReview', 'maybe'], dir);
      assertExit(bad, 1);
      assertOut(bad, 'BLOCKED: config set 值非法');
      // 未知键拒绝
      const unknown = runState(['config', 'set', 'foo', 'bar'], dir);
      assertExit(unknown, 1);
      assertOut(unknown, 'BLOCKED: 未知配置键');
    },
  },

  {
    name: 'A12 verifyFailures:切换 change 后计数独立(按 change 存储)',
    run: (dir) => {
      // ① init ch-a + verify-fail 两次(2/3,未超限)
      assertExit(runState(['init', 'ch-a', '--init-skip'], dir), 0);
      assertExit(runState(['verify-fail'], dir), 0);
      const r2 = runState(['verify-fail'], dir);
      assertExit(r2, 0);
      assertOut(r2, 'VERIFY-FAIL: 2/3');
      // ② 切换到 ch-b(目录需存在)→ verify-fail 从 1 起——按 change 存储后计数独立
      // (若实现仍用全局计数 2,此处输出 3/3——断言 1/3 即 RED)
      writeFile(dir, '.specs/ch-b/CHANGE.md', '# CHANGE\n## Why\nx\n');
      assertExit(runState(['select', 'ch-b'], dir), 0);
      const r3 = runState(['verify-fail'], dir);
      assertExit(r3, 0);
      assertOut(r3, 'VERIFY-FAIL: 1/3');
      // ③ ch-b 独立计数:连续 3 次后第 4 次 BLOCK
      assertExit(runState(['verify-fail'], dir), 0);
      assertExit(runState(['verify-fail'], dir), 0);
      const r7 = runState(['verify-fail'], dir);
      assertExit(r7, 1);
      assertOut(r7, '超限');
      // ④ 切回 ch-a:原计数保留(2 → 可再失败 1 次,第 4 次 BLOCK;不串扰不回零)
      assertExit(runState(['select', 'ch-a'], dir), 0);
      const r8 = runState(['verify-fail'], dir);
      assertExit(r8, 0);
      assertOut(r8, 'VERIFY-FAIL: 3/3');
      const r9 = runState(['verify-fail'], dir);
      assertExit(r9, 1);
      assertOut(r9, '超限');
    },
  },

  {
    name: 'A13 多趟路由真实链路:并→串→并交替与多波依赖,NODE 行在 execute/subagent-execute 间多次交替直至全部 done',
    run: (dir) => {
      driveThroughDesign(dir);
      // 混排 TASK:双并行开路 → 串行衔接(依赖双并行)→ 收尾并行(依赖串行衔接)——依赖驱动的
      // 分趟序列:并行趟 → 串行趟 → 并行趟 → review 门控(多趟正向行为)。
      // 驱动遵循真实协调者流程:execute 趟内先消化其全部串行 pending(标 done 并委托留证)再 exit;
      // 委托趟内委派全部可并行后才能退(每趟合取完成判定)。
      // 对未实现循环路由的引擎本用例 RED 属预期(单趟限制下委托节点完成后不再路由回)。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        multiWaveTaskContent({ P01: 'pending', P02: 'pending', S01: 'pending', P03: 'pending' }));
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md', '--templates', 'TASK.md'], dir), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan done"}'], dir), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const rPlan = runGuard(['exit', 'plan', '--apply'], dir);
      assertExit(rPlan, 0);
      assertOut(rPlan, 'ALL CHECKS PASSED');
      // 首趟路由:首波双并行无前置依赖 → 直接进入委托节点
      assertOut(rPlan, 'NODE: subagent-execute');
      // 两层加载模型:执行域两节点的手动声明标记(record 前置门;一次声明后续趟次复用)
      assertExit(runState(['skill-load', 'execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md', '--templates', 'SUMMARY.md'], dir), 0);
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md', '--templates', 'SUMMARY.md'], dir), 0);

      // 单趟完成动作:TASK.md 标 done(status 变更不影响任务集签名)+ SUMMARY 夹具 + 真实 handoff 委托回传
      const completeTasks = (ids) => {
        for (const id of ids) {
          writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', execSummaryFixture(id));
          assertExit(runHandoff(['request', id, id + ' 委托', '--write-files', 'src/' + id.toLowerCase() + '.mjs'], dir), 0);
          assertExit(runHandoff(['result', id, fullContract('abcd1234abcd1234abcd1234abcd1234abcd1234', id)], dir), 0);
        }
      };
      const markDone = (statusMap) => writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', multiWaveTaskContent(statusMap));
      // 单趟驱动:record → entry → exit --apply,断言 NODE 行路由到期望节点(可观测性不变式)
      let lastPassResult = null;
      const drivePass = (node, expectNext, label) => {
        assertExit(runState(['record', node, '{"summary":"' + label + '"}'], dir), 0);
        assertExit(runGuard(['entry', node], dir), 0);
        const res = runGuard(['exit', node, '--apply'], dir);
        assertExit(res, 0);
        assertOut(res, 'ALL CHECKS PASSED');
        lastPassResult = res;
        const m = res.output.match(/^NODE: ([a-z-]+)\s*$/m);
        if (!m) throw new Error('exit ' + node + '(' + label + ')输出缺 NODE 行:\n' + res.output);
        if (m[1] !== expectNext) {
          throw new Error(label + ' 后路由期望 NODE: ' + expectNext + ',实际 NODE: ' + m[1] +
            '(多趟循环路由未生效——委托节点应可重入直至无剩余可并行)\n实际输出:\n' + res.output);
        }
      };

      // 趟 1 · subagent-execute:首波双并行委托完成 → 趟间回串行(串行衔接依赖此时已满足)
      markDone({ P01: 'done', P02: 'done', S01: 'pending', P03: 'pending' });
      completeTasks(['P01', 'P02']);
      drivePass('subagent-execute', 'execute', 'parallel-wave-1');

      // 归属门禁事故回放（真实命令链路）：波 1 收口后工作归属在 execute（尚有串行衔接待办），
      // 此刻对未消化的并行 pending 任务发起委托 → 新 change BLOCK（state 字节零改写、不落请求）。
      // P03 依赖未满足：恢复指引以 workflow-state next 实际输出为准（next 按串行消化输出
      // execute），不得固定指向 entry subagent-execute；随后原链路照跑（串行衔接完成后并行收尾正常委托）。
      const ownershipEnv = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const ownershipStatePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const ownershipBytesBefore = fs.readFileSync(ownershipStatePath, 'utf8');
      const wrongNodeRequest = runHandoff(['request', 'P03', 'P03 委托', '--write-files', 'src/p03.mjs'], dir, ownershipEnv);
      assertExit(wrongNodeRequest, 1);
      assertOut(wrongNodeRequest, 'BLOCKED');
      assertOut(wrongNodeRequest, '当前不可委托');
      assertOut(wrongNodeRequest, '依赖未满足');
      assertOut(wrongNodeRequest, '未完成: S01');
      assertOut(wrongNodeRequest, '原始 currentNode=execute');
      assertOut(wrongNodeRequest, 'workflow-state next');
      assertOut(wrongNodeRequest, '若输出 execute 表示依赖未满足');
      assertOut(wrongNodeRequest, '待任务变为可委托');
      // 反锚：不得固定指引 next 不会输出的节点（按该指引进入会被 currentNode 门禁拦成死路）
      assertNotOut(wrongNodeRequest, 'entry subagent-execute');
      assertNotOut(wrongNodeRequest, 'HANDOFF REQUEST');
      if (fs.readFileSync(ownershipStatePath, 'utf8') !== ownershipBytesBefore) {
        throw new Error('归属门禁 BLOCK 不得改写 state 字节（含 handoffRequests）');
      }
      const ownershipState = readStateFile(dir);
      if (ownershipState.evidence?.['subagent-execute']?.handoffRequests?.P03) {
        throw new Error('归属门禁 BLOCK 不得落 handoffRequests: '
          + JSON.stringify(ownershipState.evidence?.['subagent-execute']?.handoffRequests));
      }
      // 指引与 next 实际输出一致：依赖未满足 → next 输出 execute（串行消化），无 entry 死路
      const routeAfterBlock = runState(['next'], dir, ownershipEnv);
      assertExit(routeAfterBlock, 0);
      assertNodeLine(routeAfterBlock, 'execute');

      // 趟 2 · execute:先消化本趟全部串行 pending(串行衔接,标 done 并委托留证)——
      // 确认无串行残留后才 exit → 收尾并行依赖满足 → 再次进入委托节点
      // (旧引擎单趟限制下此处不再路由回——本断言即多趟语义回归锚)
      markDone({ P01: 'done', P02: 'done', S01: 'done', P03: 'pending' });
      completeTasks(['S01']);
      drivePass('execute', 'subagent-execute', 'serial-wave-1');

      // 趟 3 · subagent-execute:收尾并行委托完成 → 全部 done → 出口照常门控进 review(循环终止语义不变)
      markDone({ P01: 'done', P02: 'done', S01: 'done', P03: 'done' });
      completeTasks(['P03']);
      // 收口前基线（只读）：出口 NODE 与完成节点集合之外零改写，收尾前后仅审计行文本变化
      const pass3Before = readStateFile(dir);
      drivePass('subagent-execute', 'review', 'parallel-wave-2');
      const pass3 = lastPassResult;
      // 正常多趟收尾：无 Fix 结构标记且历史签名全等 → 中性 RETURN，不得出现 FIX-BATCH 锚
      assertOut(pass3, 'RETURN: 回源节点 review（subagent-execute 出口已完成；正常多趟收尾，非 Fix 回修）');
      assertNotOut(pass3, 'FIX-BATCH');
      assertNodeLine(pass3, 'review');
      const pass3After = readStateFile(dir);
      if (JSON.stringify(pass3After.completedNodes) !== JSON.stringify(pass3Before.completedNodes)) {
        throw new Error('正常多趟收尾不得改写完成节点集合（审计行分类零副作用）: 收口前 '
          + JSON.stringify(pass3Before.completedNodes) + ' 收口后 ' + JSON.stringify(pass3After.completedNodes));
      }
      if (pass3After.currentNode !== 'review' || pass3After.completedNodes.includes('review')) {
        throw new Error('正常多趟收尾应停在未完成的 review: ' + JSON.stringify(pass3After));
      }
      const pass3PostNext = runState(['next'], dir);
      assertExit(pass3PostNext, 0);
      assertNodeLine(pass3PostNext, 'review');

      const st = readStateFile(dir);
      if (st.currentNode !== 'review') {
        throw new Error('全部任务 done 后应停在 review 门控前: ' + JSON.stringify(st.currentNode));
      }
      console.log('  多趟路由:subagent-execute→execute→subagent-execute→review 三趟两交替 + 归属门禁 BLOCK 后原链路续跑 ✓');
    },
  },

  {
    name: 'A14 plan 出口依赖环负例:BLOCK 含 depends_on 恢复指引,按指引调环后恢复通过',
    run: (dir) => {
      driveThroughDesign(dir);
      // 负例:X1↔X2 互相依赖成环(结构死锁——任何一趟都无法开工)→ plan 出口前置拦截。
      // 校验语义:依赖图无环 + 趟次可满足;BLOCK 消息附 depends_on 调整恢复指引(恢复类断言面)。
      const cyclic =
        '<task id="C1" status="pending"><action>实现 C1</action><write_files>src/c1.mjs</write_files><verify>node --check src/c1.mjs</verify></task>\n' +
        '<task id="X1" parallel="true" status="pending"><action>实现 X1</action><write_files>src/x1.mjs</write_files><verify>node --check src/x1.mjs</verify><depends_on>X2</depends_on></task>\n' +
        '<task id="X2" parallel="true" status="pending"><action>实现 X2</action><write_files>src/x2.mjs</write_files><verify>node --check src/x2.mjs</verify><depends_on>X1</depends_on></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + cyclic);
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md', '--templates', 'TASK.md'], dir), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan drafted"}'], dir), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const blocked = runGuard(['exit', 'plan', '--apply'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      // 恢复指引关键词:指明调整 depends_on(而非笼统报错)
      assertOut(blocked, 'depends_on');
      if (!/(环|循环|cycle|拓扑|topolog)/i.test(blocked.output)) {
        throw new Error('plan 出口 BLOCK 应含依赖环/拓扑校验语义关键词(环/循环/cycle/拓扑):\n' + blocked.output);
      }
      // 恢复类:按指引调整 depends_on(X1/X2 改依赖 C1)消环 → 同一出口重跑通过
      const recovered =
        '<task id="C1" status="pending"><action>实现 C1</action><write_files>src/c1.mjs</write_files><verify>node --check src/c1.mjs</verify></task>\n' +
        '<task id="X1" parallel="true" status="pending"><action>实现 X1</action><write_files>src/x1.mjs</write_files><verify>node --check src/x1.mjs</verify><depends_on>C1</depends_on></task>\n' +
        '<task id="X2" parallel="true" status="pending"><action>实现 X2</action><write_files>src/x2.mjs</write_files><verify>node --check src/x2.mjs</verify><depends_on>C1</depends_on></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + recovered);
      const ok = runGuard(['exit', 'plan', '--apply'], dir);
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
      // 恢复后路由:并行依赖未满足(C1 仍 pending)→ execute 开工
      assertOut(ok, 'NODE: execute');
    },
  },

  {
    // 路由时序收敛（真实命令链路）：多趟拓扑（并行开路 → 串行衔接 → 并行收尾 → 串行收尾）逐节点
    // guard exit --apply 后运行 workflow-state next——断言两侧 NODE 逐节点一致（修复前 guard 出口
    // 镜像缺「串行 pending → execute」回流，并行收尾后直接落到 review，与权威 next 偏差）。
    name: 'A15 多趟路由时序收敛：逐节点 exit --apply 后 next NODE 与 guard 出口 NODE 一致',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap) => {
        const blk = (id, parallel, deps) =>
          '<task id="' + id + '"' + (parallel ? ' parallel="true"' : '') +
          ' status="' + (statusMap[id] === 'done' ? 'done' : 'pending') + '">' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
          (deps ? '<depends_on>' + deps + '</depends_on>' : '') + '</task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
          blk('P01', true, '') + blk('P02', true, '') +
          blk('S01', false, 'P01,P02') +
          blk('P03', true, 'S01') + blk('P04', true, 'S01') +
          blk('S02', false, 'P03,P04'));
      };
      const runNext = () => runState(['next'], dir, env);
      const nodeOf = (out) => (out.match(/^NODE: ([a-z-]+)$/m) || [])[1] ?? null;
      const completeTasks = (ids) => {
        for (const id of ids) {
          writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', execSummaryFixture(id));
          assertExit(runHandoff(['request', id, id + ' 委托', '--write-files', 'src/' + id.toLowerCase() + '.mjs'], dir), 0);
          assertExit(runHandoff(['result', id, fullContract('abcd1234abcd1234abcd1234abcd1234abcd1234', id)], dir), 0);
        }
      };
      // drive 收敛面参数化：委托跳转/趟间回串行态（guard 出口 NODE 与 next 可确认面不一致——
      // next 对「currentNode 无 evidence 且非固定路由后继」的委托跳转态按正常推进豁免不放行，
      // 仅断言 guard 侧 NODE；直接后继/回流态（next 可确认）才做双侧收敛断言。
      const drive = (nodeId, skill, prompt, prepare, { expectedNode, converge = true } = {}) => {
        assertExit(runState(skillLoadArgs(nodeId, skill, prompt), dir, env), 0);
        prepare();
        assertExit(runGuard(['entry', nodeId], dir), 0);
        const res = runGuard(['exit', nodeId, '--apply'], dir);
        assertExit(res, 0);
        const n1 = nodeOf(res.output);
        if (expectedNode && n1 !== expectedNode) {
          throw new Error('节点 ' + nodeId + ' 出口后 guard NODE(' + n1 + ') != 期望(' + expectedNode +
            ')\nguard:\n' + res.output);
        }
        if (!converge) return;
        const nxt = runNext();
        assertExit(nxt, 0);
        const n2 = nodeOf(nxt.output);
        if (n1 !== n2) {
          throw new Error('节点 ' + nodeId + ' 出口后 guard NODE(' + n1 + ') != next NODE(' + n2 +
            ')\nguard:\n' + res.output + '\nnext:\n' + nxt.output);
        }
      };
      const writeSummary = (ids) => { for (const id of ids) writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', execSummaryFixture(id)); };
      driveThroughDesign(dir);
      // 预置多趟 TASK 并推进到 review 门控前（逐节点收敛断言）
      writeTask({ P01: 'pending', P02: 'pending', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
      drive('plan', 'flow-comet-plan', 'flow-kit/prompts/3-task.md', () => assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0),
        { expectedNode: 'subagent-execute', converge: false });
      drive('subagent-execute', 'flow-comet-subagent-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
        writeSummary(['P01', 'P02']);
        completeTasks(['P01', 'P02']);
        // 委托收集后按真实链路 record 节点总结（浅合并保留 handoffResult）——guard exit
        // 的 schema evidence 前置需要非空 summary（缺则 BLOCK，与场景级委托出口同形态）。
        assertExit(runState(['record', 'subagent-execute', '{"summary":"wave 1 delegated and collected"}'], dir, env), 0);
      }, { expectedNode: 'execute', converge: false });
      drive('execute', 'flow-comet-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'pending', P04: 'pending', S02: 'pending' });
        writeSummary(['S01']);
        completeTasks(['S01']);
        // execute 节点自身证据（guard exit 校验节点 evidence 须有记录）——真实链路中
        // 串行任务完成后协调者 record execute 节点总结。
        assertExit(runState(['record', 'execute', '{"summary":"serial wave complete"}'], dir, env), 0);
      }, { expectedNode: 'subagent-execute', converge: true });
      drive('subagent-execute', 'flow-comet-subagent-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'pending' });
        writeSummary(['P03', 'P04']);
        completeTasks(['P03', 'P04']);
        assertExit(runState(['record', 'subagent-execute', '{"summary":"wave 2 delegated and collected"}'], dir, env), 0);
      }, { expectedNode: 'execute', converge: true });
      drive('execute', 'flow-comet-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'done' });
        writeSummary(['S02']);
        completeTasks(['S02']);
        assertExit(runState(['record', 'execute', '{"summary":"final serial wave complete"}'], dir, env), 0);
      }, { expectedNode: 'review', converge: true });
      drive('review', 'flow-comet-review', 'flow-kit/prompts/6-review.md', () => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
          '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nreview passed，无遗留问题。\n');
        assertExit(runState(['record', 'review', '{"summary":"review complete"}'], dir, env), 0);
      }, { expectedNode: 'verify', converge: true });
      drive('verify', 'flow-comet-verify', 'flow-kit/prompts/7-integration.md', () => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```\necho ok\n```\n');
        writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
        assertExit(runState(['record', 'verify', '{"summary":"verify complete"}'], dir, env), 0);
      }, { expectedNode: 'archive', converge: true });
      // 归档出口：两侧均 NEXT: done
      assertExit(runState(['skill-load', 'archive', 'flow-comet-archive', '--prompt', 'flow-kit/prompts/7-integration.md'], dir, env), 0);
      writeFile(dir, '.specs/archive/2026-08-28-' + CHANGE_ID + '/KNOWN-ISSUES.md', '# 遗留问题\n\n无。\n');
      // 归档提名随证据落盘：本 change 写了 6 份任务 SUMMARY（并行 4 份 + 串行 2 份，扫描份数按
      // 同一清单对账）。提名门缺字段即拦，与本条被测的路由收敛判据无关。
      assertExit(runState(['record', 'archive',
        archiveRecordJson('archive complete', ['P01', 'P02', 'S01', 'P03', 'P04', 'S02'])], dir, env), 0);
      assertExit(runGuard(['entry', 'archive'], dir), 0);
      const res = runGuard(['exit', 'archive', '--apply'], dir);
      assertExit(res, 0);
      assertOut(res, 'NEXT: done');
      const nxt = runNext();
      assertExit(nxt, 0);
      assertOut(nxt, 'NEXT: done');
    },
  },

  {
    // 并行文件依赖检出（真实命令链路）：write∩write 重叠强判前移 plan 出口——同波次并行任务
    // 写同一路径（链式重命名的 .txt 事故面）→ 新 change BLOCKED（含重叠路径与 depends_on
    // 恢复指引）；按指引补显式 depends_on 后同出口恢复通过。read∩write 弱判：无显式关联并行对
    // 一方读取对方写路径 → WARN 提示不 BLOCK（渐进）。同一文件跨任务族：两个未完成任务写入面
    // 重叠且彼此无依赖路径（串行拆分同样拦截）→ 新 change BLOCKED（消息含任务对与重叠文件）；
    // 补显式 depends_on 后放行；旧 change 形态仅 WARN 不阻断；修复任务族（id 带修复前缀）
    // 不参与该族——其顺序由修复生命周期保证，回修同一文件是必然形态。修复前 plan 出口无这些
    // 检测 = 预期 RED。
    name: 'A16 plan 出口文件依赖检出：写写重叠 BLOCK 与恢复 + glob 单侧/双侧/不重叠 + 读写弱判 WARN + 同文件跨任务无依赖路径（真实命令）',
    run: (dir) => {
      driveThroughDesign(dir);
      const planEnv = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // 非 --apply 出口（弱判/强判阶段不推进状态，避免 apply 后 currentNode 偏离 plan）
      const exitPlanNoApply = () => runGuard(['exit', 'plan'], dir, planEnv);
      const exitPlanApply = () => runGuard(['exit', 'plan', '--apply'], dir, planEnv);
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md', '--templates', 'TASK.md'], dir), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan drafted"}'], dir), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const planTask = (taskBody) => writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + taskBody);
      const C1 = '<task id="C1" status="pending"><action>实现 C1</action><write_files>src/c1.mjs</write_files><verify>node --check src/c1.mjs</verify></task>\n';
      // 弱判（渐进）：无显式关联并行对 read∩write → WARN 提示不 BLOCK
      planTask(
        C1 +
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><read_files>shared-context.md</read_files><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>shared-context.md</write_files><verify>node --check shared-context.md</verify></task>\n');
      const weakRes = exitPlanNoApply();
      assertExit(weakRes, 0);
      assertOut(weakRes, 'read∩write');
      assertOut(weakRes, 'shared-context.md');
      assertNotOut(weakRes, 'BLOCKED');
      // 强判（负例）：P01/P02 同波次并行写同一 .txt 路径（无 depends_on）→ BLOCKED 含恢复指引
      planTask(
        C1 +
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n');
      const blocked = exitPlanNoApply();
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, 'bak_a.txt');
      assertOut(blocked, 'depends_on');
      // glob 形态重叠（单侧元字符 × 字面路径）：修复前逐字相等判定漏检 ⇒ 静默放行（本段即 RED）；
      // 反向构造：改为互不重叠 / 段数不等 / 段内不匹配 ⇒ 放行（判据不恒真空过）；双侧 glob ⇒ 保守判重叠。
      const globPair = (firstWrite, secondWrite, secondDeps = '') =>
        C1 +
        '<task id="G01" parallel="true" status="pending"><action>实现 G01</action><write_files>' + firstWrite + '</write_files><verify>node --check src/x.mjs</verify></task>\n' +
        '<task id="G02" parallel="true" status="pending"><action>实现 G02</action><write_files>' + secondWrite + '</write_files><verify>node --check src/x.mjs</verify>' + secondDeps + '</task>\n';
      planTask(globPair('src/glob/*.mjs', 'src/glob/foo.mjs'));
      const globBlocked = exitPlanNoApply();
      assertExit(globBlocked, 1);
      assertOut(globBlocked, 'BLOCKED');
      assertOut(globBlocked, 'G01×G02');
      assertOut(globBlocked, 'src/glob/*.mjs');
      assertOut(globBlocked, 'src/glob/foo.mjs');
      assertOut(globBlocked, 'depends_on');
      planTask(globPair('src/glob/*.mjs', 'src/glob/deep/foo.mjs'));
      const depthMismatch = exitPlanNoApply();
      assertExit(depthMismatch, 0);
      assertNotOut(depthMismatch, 'BLOCKED');
      planTask(globPair('src/glob/*.mjs', 'src/glob/foo.js'));
      const suffixMismatch = exitPlanNoApply();
      assertExit(suffixMismatch, 0);
      assertNotOut(suffixMismatch, 'BLOCKED');
      planTask(globPair('src/glob/*.mjs', 'src/glob/*.js'));
      const doubleGlob = exitPlanNoApply();
      assertExit(doubleGlob, 1);
      assertOut(doubleGlob, 'BLOCKED');
      assertOut(doubleGlob, 'G01×G02');
      // 恢复（真实链路）：按指引补显式 depends_on（重叠路径不改）⇒ 同一出口放行
      planTask(globPair('src/glob/*.mjs', 'src/glob/foo.mjs', '<depends_on>G01</depends_on>'));
      const globRecovered = exitPlanNoApply();
      assertExit(globRecovered, 0);
      assertOut(globRecovered, 'ALL CHECKS PASSED');
      assertNotOut(globRecovered, 'BLOCKED');
      // 同一文件跨任务族（负例）：两个非修复任务写入同一文件、彼此无依赖路径（串行拆分同样构成
      // 「未显式排序的同文件多任务」）→ 新 change BLOCKED，消息含任务对与重叠文件 + 恢复指引。
      // 同夹具并列一对修复任务（id 带修复前缀）写同一文件且无依赖路径——该族不参与判定，
      // 消息中不得出现它们（其顺序由修复生命周期保证）。
      const fixPair =
        '<task id="T-FIX-01" status="pending"><action>修复 F1</action><write_files>src/fix.mjs</write_files><verify>node --check src/fix.mjs</verify></task>\n' +
        '<task id="T-FIX-02" status="pending"><action>修复 F2</action><write_files>src/fix.mjs</write_files><verify>node --check src/fix.mjs</verify></task>\n';
      const sameFileTask = (id, depsElement) =>
        '<task id="' + id + '" status="pending"><action>实现 ' + id + '</action><write_files>src/x.mjs</write_files>' +
        '<verify>node --check src/x.mjs</verify>' + depsElement + '</task>\n';
      const sameFilePairNoDeps = sameFileTask('X1', '') + sameFileTask('X2', '');
      const sameFilePairWithDeps = sameFileTask('X1', '') + sameFileTask('X2', '<depends_on>X1</depends_on>');
      planTask(C1 + sameFilePairNoDeps + fixPair);
      const sameFileBlocked = exitPlanNoApply();
      assertExit(sameFileBlocked, 1);
      assertOut(sameFileBlocked, 'BLOCKED');
      assertOut(sameFileBlocked, '同文件跨任务且无依赖路径');
      assertOut(sameFileBlocked, 'X1×X2');
      assertOut(sameFileBlocked, 'src/x.mjs');
      assertOut(sameFileBlocked, 'depends_on');
      assertNotOut(sameFileBlocked, 'T-FIX-01');
      assertNotOut(sameFileBlocked, 'src/fix.mjs');
      // 修复任务族谓词边界（唯一谓词 = id 前缀 + 「位于 Fix 段内」两条边界，只在引擎内表达一次）：
      // ① 形似而非修复编号的 id 不属修复族——「前缀后缺连字符」的形似编号在旧判据的宽松前缀下
      //    整对被放过；正确判据下它与同文件无依赖路径对一律 BLOCKED。
      const lookalikeFixPair =
        '<task id="T-FIXUP-01" status="pending"><action>实现 T-FIXUP-01</action><write_files>src/lookalike.mjs</write_files><verify>node --check src/lookalike.mjs</verify></task>\n' +
        '<task id="T-FIXUP-02" status="pending"><action>实现 T-FIXUP-02</action><write_files>src/lookalike.mjs</write_files><verify>node --check src/lookalike.mjs</verify></task>\n';
      planTask(C1 + lookalikeFixPair);
      const lookalikeBlocked = exitPlanNoApply();
      assertExit(lookalikeBlocked, 1);
      assertOut(lookalikeBlocked, 'BLOCKED');
      assertOut(lookalikeBlocked, '同文件跨任务且无依赖路径');
      assertOut(lookalikeBlocked, 'T-FIXUP-01×T-FIXUP-02');
      assertOut(lookalikeBlocked, 'src/lookalike.mjs');
      // ② Fix 段内、id 不带修复前缀的修复任务同属修复族——旧判据只认 id 前缀，会把段内这对当普通
      //    参与者误 BLOCK；正确判据下段内任务整体不参与该族 → 出口放行且无该族消息。
      const fixSectionPair =
        '<task id="F01" status="pending"><action>修复 F01</action><write_files>src/fix-section.mjs</write_files><verify>node --check src/fix-section.mjs</verify></task>\n' +
        '<task id="F02" status="pending"><action>修复 F02</action><write_files>src/fix-section.mjs</write_files><verify>node --check src/fix-section.mjs</verify></task>\n';
      planTask(C1 + '\n## Fix 任务\n\n' + fixSectionPair);
      const fixSectionRes = exitPlanNoApply();
      assertExit(fixSectionRes, 0);
      assertNotOut(fixSectionRes, '同文件跨任务且无依赖路径');
      assertNotOut(fixSectionRes, 'BLOCKED');
      // 旧 change 形态（无新 change 标记）：同形态仅 WARN 渐进不阻断，恢复指引仍在
      planTask(C1 + sameFilePairNoDeps + fixPair);
      const sameFileState = readStateFile(dir);
      delete sameFileState.newChange;
      writeState(dir, sameFileState);
      const sameFileWarn = exitPlanNoApply();
      assertExit(sameFileWarn, 0);
      assertOut(sameFileWarn, 'WARN');
      assertOut(sameFileWarn, '同文件跨任务且无依赖路径');
      assertOut(sameFileWarn, 'X1×X2');
      assertNotOut(sameFileWarn, 'BLOCKED');
      writeState(dir, { ...sameFileState, newChange: true });
      // 恢复：按指引补显式 depends_on，且 **P02 保持写原重叠路径 bak_a.txt**
      // （不改路径避开重叠）——证明「补 depends_on 解决原重叠」而非「改路径避开重叠」；补依赖后
      // P02 跨趟（dep 未满足，不在本趟可运行集合）→ 同波次并行对只剩 P01 → 重叠消失 → 同出口通过。
      // 同一文件跨任务族同批恢复：X2 补 depends_on X1（重叠路径不改）；并列的修复任务对保持无依赖
      // ——该族不参与判定，故不影响本出口通过。
      planTask(
        C1 +
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify><depends_on>P01</depends_on></task>\n' +
        sameFilePairWithDeps + fixPair);
      const ok = exitPlanApply();
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
      assertNotOut(ok, 'BLOCKED');
      assertNotOut(ok, '同文件跨任务且无依赖路径');
    },
  },

  {
    // 多趟平行转换后 next 可达且与 guard 出口一致（真实命令链路）：在 A15 的收敛链路之上，
    // 把此前排除在收敛断言面外的两个平行转换点（plan→subagent-execute、subagent-execute→execute
    // 趟间回流）也纳入 next 收敛断言——修复前 next 在这些转换点被误拦为“疑似未 exit”，预期失败。
    name: 'A17 多趟平行转换后 next 可达：各转换点 next 与 guard 出口 NODE 一致（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap) => {
        const blk = (id, parallel, deps) =>
          '<task id="' + id + '"' + (parallel ? ' parallel="true"' : '') +
          ' status="' + (statusMap[id] === 'done' ? 'done' : 'pending') + '">' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
          (deps ? '<depends_on>' + deps + '</depends_on>' : '') + '</task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
          blk('P01', true, '') + blk('P02', true, '') +
          blk('S01', false, 'P01,P02') +
          blk('P03', true, 'S01') + blk('P04', true, 'S01') +
          blk('S02', false, 'P03,P04'));
      };
      const runNext = () => runState(['next'], dir, env);
      const nodeOf = (out) => (out.match(/^NODE: ([a-z-]+)$/m) || [])[1] ?? null;
      const completeTasks = (ids) => {
        for (const id of ids) {
          writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', execSummaryFixture(id));
          assertExit(runHandoff(['request', id, id + ' 委托', '--write-files', 'src/' + id.toLowerCase() + '.mjs'], dir), 0);
          assertExit(runHandoff(['result', id, fullContract('abcd1234abcd1234abcd1234abcd1234abcd1234', id)], dir), 0);
        }
      };
      // drive 收敛面全量：每个转换点（含平行跳转与趟间回流）都断言 next 可达且与 guard 出口 NODE 一致
      const drive = (nodeId, skill, prompt, prepare, { expectedNode } = {}) => {
        assertExit(runState(skillLoadArgs(nodeId, skill, prompt), dir, env), 0);
        prepare();
        assertExit(runGuard(['entry', nodeId], dir), 0);
        const res = runGuard(['exit', nodeId, '--apply'], dir);
        assertExit(res, 0);
        const n1 = nodeOf(res.output);
        if (expectedNode && n1 !== expectedNode) {
          throw new Error('节点 ' + nodeId + ' 出口后 guard NODE(' + n1 + ') != 期望(' + expectedNode +
            ')\nguard:\n' + res.output);
        }
        const nxt = runNext();
        assertExit(nxt, 0);
        const n2 = nodeOf(nxt.output);
        if (n1 !== n2) {
          throw new Error('节点 ' + nodeId + ' 出口后 guard NODE(' + n1 + ') != next NODE(' + n2 +
            ')\nguard:\n' + res.output + '\nnext:\n' + nxt.output);
        }
      };
      const writeSummary = (ids) => { for (const id of ids) writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', execSummaryFixture(id)); };
      driveThroughDesign(dir);
      writeTask({ P01: 'pending', P02: 'pending', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
      // ① plan 出口 → subagent-execute（平行跳转——修复前 next 误拦）
      drive('plan', 'flow-comet-plan', 'flow-kit/prompts/3-task.md', () => assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0),
        { expectedNode: 'subagent-execute' });
      // ② 首波并行委托完成 → 趟间回串行 execute（平行回流——修复前 next 误拦）
      drive('subagent-execute', 'flow-comet-subagent-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
        writeSummary(['P01', 'P02']);
        completeTasks(['P01', 'P02']);
        assertExit(runState(['record', 'subagent-execute', '{"summary":"wave 1 delegated and collected"}'], dir, env), 0);
      }, { expectedNode: 'execute' });
      // ③ 串行衔接完成 → 第二波并行可委托
      drive('execute', 'flow-comet-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'pending', P04: 'pending', S02: 'pending' });
        writeSummary(['S01']);
        completeTasks(['S01']);
        assertExit(runState(['record', 'execute', '{"summary":"serial wave complete"}'], dir, env), 0);
      }, { expectedNode: 'subagent-execute' });
      // ④ 第二波并行委托完成 → 收尾串行回流 execute
      drive('subagent-execute', 'flow-comet-subagent-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'pending' });
        writeSummary(['P03', 'P04']);
        completeTasks(['P03', 'P04']);
        assertExit(runState(['record', 'subagent-execute', '{"summary":"wave 2 delegated and collected"}'], dir, env), 0);
      }, { expectedNode: 'execute' });
      // ⑤ 收尾串行完成 → review（后随 review→verify→archive 同 A15 形态）
      drive('execute', 'flow-comet-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'done' });
        writeSummary(['S02']);
        completeTasks(['S02']);
        assertExit(runState(['record', 'execute', '{"summary":"final serial wave complete"}'], dir, env), 0);
      }, { expectedNode: 'review' });
      drive('review', 'flow-comet-review', 'flow-kit/prompts/6-review.md', () => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
          '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nreview passed，无遗留问题。\n');
        assertExit(runState(['record', 'review', '{"summary":"review complete"}'], dir, env), 0);
      }, { expectedNode: 'verify' });
      drive('verify', 'flow-comet-verify', 'flow-kit/prompts/7-integration.md', () => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```\necho ok\n```\n');
        writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
        assertExit(runState(['record', 'verify', '{"summary":"verify complete"}'], dir, env), 0);
      }, { expectedNode: 'archive' });
      // 归档出口：两侧均 NEXT: done
      assertExit(runState(['skill-load', 'archive', 'flow-comet-archive', '--prompt', 'flow-kit/prompts/7-integration.md'], dir, env), 0);
      writeFile(dir, '.specs/archive/2026-08-28-' + CHANGE_ID + '/KNOWN-ISSUES.md', '# 遗留问题\n\n无。\n');
      // 归档提名随证据落盘：本 change 写了 6 份任务 SUMMARY（并行 4 份 + 串行 2 份，扫描份数按
      // 同一清单对账）。提名门缺字段即拦，与本条被测的路由收敛判据无关。
      assertExit(runState(['record', 'archive',
        archiveRecordJson('archive complete', ['P01', 'P02', 'S01', 'P03', 'P04', 'S02'])], dir, env), 0);
      assertExit(runGuard(['entry', 'archive'], dir), 0);
      const resArch = runGuard(['exit', 'archive', '--apply'], dir);
      assertExit(resArch, 0);
      assertOut(resArch, 'NEXT: done');
      const nxt = runNext();
      assertExit(nxt, 0);
      assertOut(nxt, 'NEXT: done');
    },
  },

  {
    // 漂移容忍 exit 系统锚（真实命令链路）：execute 产物/证据齐（单任务完成 +
    // SUMMARY + record execute + entry execute）→ 构造欠账漂移态（currentNode 漂移到文件推导
    // 下一节点 review，execute 未进 completedNodes）→ 容错 exit execute --apply 补齐欠账。
    // 修复前 currentNode 校验直接 BLOCK → 预期失败（RED 锚）；场景级同语义锚见自测套件。
    name: 'A18 漂移容忍 exit：execute 欠账经容错路径补齐（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap) => {
        const blk = (id, status) =>
          '<task id="' + id + '" status="' + status + '">' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify></task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + blk('S01', statusMap.S01 ?? 'pending'));
      };
      // 驱动至 plan 出口（真实命令：init→open→design 见 driveThroughDesign，随后 plan 三连）
      driveThroughDesign(dir);
      writeTask({ S01: 'pending' });
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md', '--templates', 'TASK.md'], dir, env), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      assertExit(runGuard(['exit', 'plan', '--apply'], dir), 0);
      // execute 完整完成（产物 + record + entry，真实命令）——仅差 completedNodes（欠账）
      writeTask({ S01: 'done' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/S01-SUMMARY.md', execSummaryFixture('S01'));
      assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md', '--templates', 'SUMMARY.md'], dir, env), 0);
      assertExit(runState(['record', 'execute', '{"summary":"executed","parallelTakeoverApproved":true}'], dir, env), 0);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // R-1 欠账漂移态：currentNode 漂移到文件推导下一节点 review（execute 未 completed）
      const st = readStateFile(dir);
      st.currentNode = 'review';
      writeState(dir, st);
      // 容错 exit execute --apply → 补齐欠账（completedNodes 补 execute）
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      const stAfter = readStateFile(dir);
      if (!stAfter.completedNodes.includes('execute')) {
        throw new Error('容错 exit execute --apply 后 completedNodes 应含 execute（欠账补齐）;实际: ' + stAfter.completedNodes.join(','));
      }
    },
  },

  {
    // 路由诊断静默扩展系统锚（真实命令链路）：波 1 并行完成后剩余串行 pending
    // （P→S 收尾转换）→ subagent-execute 出口无 ROUTE WARN 噪音；畸形 parallel（parallel=true
    // 缺 status）+ 串行 pending → ROUTE WARN 仍报（结构校验严格保持）。场景级同语义见自测套件对应锚。
    name: 'A19 路由诊断静默扩展：P→S 收尾无噪音 / 畸形块仍报（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap, extra) => {
        const blk = (id, parallel, status, deps) =>
          '<task id="' + id + '"' + (parallel ? ' parallel="true"' : ' parallel="false"') +
          ' status="' + status + '">' +
          '<name>任务-' + id + '</name><read_files>src/*</read_files>' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
          '<done>AC-' + id + '</done><depends_on>' + (deps || '') + '</depends_on></task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
          (extra ? extra
            : blk('P01', true, statusMap.P01 ?? 'pending', '') + blk('S01', false, statusMap.S01 ?? 'pending', 'P01')));
      };
      driveThroughDesign(dir);
      writeTask({ P01: 'pending', S01: 'pending' });
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md', '--templates', 'TASK.md'], dir, env), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      assertExit(runGuard(['exit', 'plan', '--apply'], dir), 0);
      // 波 1：并行任务完成（SUMMARY+handoff）→ P→S 收尾（串行尾任务 pending）；
      // 发起委托前先 skill-load 声明（handoff request 前置门——先声明再发起委托，与既有委托链同序）
      writeTask({ P01: 'done', S01: 'pending' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', execSummaryFixture('P01'));
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-subagent-execute', '--prompt', 'flow-kit/prompts/4-dev.md', '--templates', 'SUMMARY.md'], dir, env), 0);
      assertExit(runHandoff(['request', 'P01', 'P01 委托', '--write-files', 'src/p01.mjs'], dir), 0);
      assertExit(runHandoff(['result', 'P01', fullContract('abcd1234abcd1234abcd1234abcd1234abcd1234', 'P01')], dir), 0);
      assertExit(runState(['record', 'subagent-execute', '{"summary":"wave 1 delegated and collected"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'subagent-execute'], dir), 0);
      const resWave = runGuard(['exit', 'subagent-execute', '--apply'], dir);
      assertExit(resWave, 0);
      assertNotOut(resWave, 'ROUTE WARN'); // 剩余 pending 全串行（P→S 收尾）→ 静默
      // 畸形块仍报：parallel 缺 status（但 7 字段齐）+ 串行 pending → ROUTE WARN 保持
      // （构造 plan 出口态，既有出口同款夹具形态；新 change 下畸形块亦须过结构门再达诊断）
      const st = readStateFile(dir);
      st.currentNode = 'plan';
      st.completedNodes = ['open', 'design'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P03" parallel="true"><name>任务-P03（畸形并行，缺 status）</name><read_files>src/*</read_files>' +
        '<action>实现 P03</action><write_files>src/p03.mjs</write_files><verify>node --check src/p03.mjs</verify>' +
        '<done>AC-P03</done><depends_on></depends_on></task>\n' +
        '<task id="S02" parallel="false" status="pending"><name>任务-S02（串行）</name><read_files>src/*</read_files>' +
        '<action>实现 S02</action><write_files>src/s02.mjs</write_files><verify>node --check src/s02.mjs</verify>' +
        '<done>AC-S02</done><depends_on></depends_on></task>\n');
      assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const resMal = runGuard(['exit', 'plan', '--apply'], dir);
      assertExit(resMal, 0);
      assertOut(resMal, 'ROUTE WARN'); // 畸形块仍报（结构校验严格保持）
    },
  },

  {
    // directOverride 授权约束系统锚（真实命令链路）：执行者自切 direct 无授权（绕过脚本手改
    // state——修复后 hook 会拦截此类工具写；此处直接构造越权形态验证 guard 出口拦截）→
    // execute 出口 BLOCKED + 恢复指引；协调者授权路径（execution-mode direct 真实命令写入
    // 授权留痕）→ 出口通过。场景级同语义见自测套件对应锚。
    name: 'A20 directOverride 授权约束：自切 direct 无授权 BLOCK / 协调者授权通过（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap) => {
        const blk = (id, status) =>
          '<task id="' + id + '" status="' + status + '">' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify></task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + blk('S01', statusMap.S01 ?? 'pending'));
      };
      // 驱动至 execute（真实命令：init→open→design→plan 出口）
      driveThroughDesign(dir);
      writeTask({ S01: 'pending' });
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md', '--templates', 'TASK.md'], dir, env), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      assertExit(runGuard(['exit', 'plan', '--apply'], dir), 0);
      // execute 完整完成（产物 + record + entry，真实命令）
      writeTask({ S01: 'done' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/S01-SUMMARY.md', execSummaryFixture('S01'));
      assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md', '--templates', 'SUMMARY.md'], dir, env), 0);
      assertExit(runState(['record', 'execute', '{"summary":"executed"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 执行者自切 direct（directOverride=true 但无授权审计记录——B 方案前的自切/遗留形态）
      const st = readStateFile(dir);
      st.executionMode = 'direct';
      st.directOverride = true;
      writeState(dir, st);
      const rBlock = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(rBlock, 1);
      assertOut(rBlock, 'BLOCKED');
      assertOut(rBlock, 'directOverride');
      // 协调者授权路径：execution-mode direct（脚本写入授权留痕）→ exit 通过
      const auth = runState(['execution-mode', 'direct'], dir, env);
      assertExit(auth, 0);
      assertOut(auth, 'DIRECT-AUTH');
      const stAuth = readStateFile(dir);
      if (typeof stAuth.directOverrideAt !== 'string' || stAuth.directOverrideAt.trim() === '') {
        throw new Error('协调者授权后 state 应含 directOverrideAt 审计字段: ' + JSON.stringify(stAuth.directOverrideAt));
      }
      const rPass = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(rPass, 0);
      assertOut(rPass, 'ALL CHECKS PASSED');
    },
  },
];
