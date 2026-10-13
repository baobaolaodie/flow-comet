// 场景组 f — 多趟路由核心 · 出口硬化 · 技能文本锁
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
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  HOOK,
  REPO_ROOT,
  SCRIPTS_DIR,
  TASK_P1,
  TASK_P2,
  TASK_P2_PENDING,
  TASK_VALID_ALL_SERIAL,
  TASK_VALID_PS,
  TASK_VALID_SP,
  handoffFor,
  renderMultiWaveTasks,
  runPlanExit,
  skillTreeDocFiles,
  summaryContent,
  writeIntakeArtifacts,
} from '../lib/test-fixtures.mjs';
import {
  runStateWithProtocol,
  scenarioProtocolPath,
} from '../lib/test-assertions.mjs';
import {
  COMMIT_DISCIPLINE_AUTHORITY_PHRASES,
  COMMIT_DISCIPLINE_ELEMENT_GROUPS,
  COMMIT_DISCIPLINE_REL,
  CONTRACT_EVIDENCE_AUTHORITY_PHRASES,
  DELEGATION_POINTER_RELS,
  IDENTITY_UPGRADE_AUTHORITY_PHRASES,
  IDENTITY_UPGRADE_ENTRY_PHRASES,
  IDENTITY_UPGRADE_STALE_PHRASES,
  PAIRED_GUIDANCE_ENTRY_REL,
  PAIRED_GUIDANCE_ENTRY_TARGET,
  PAIRED_GUIDANCE_POINTER_RE,
  PARALLEL_CONTRACT_BOOK_PHRASES,
  PLATFORM_FACTS_ONLY_PHRASES,
  PLATFORM_FACTS_REL,
  SKILL_TREE_ENTRY_BOOK,
  SKILL_TREE_EXPLICIT_REFERENCE_PREFIX,
  SKILL_TREE_REFERENCE_RE,
  TEMPLATE_AUTHORITY_SKILLS,
  delegationDisciplineProblems,
  identityUpgradeProblems,
  pairedGuidancePointerProblems,
  platformFactsAuthorityProblems,
  skillTreeReferenceProblems,
  task7SetAnchorProblems,
  templateAuthorityBody,
  templateAuthorityParagraphs,
  templateAuthorityProblems,
  templateAuthorityRegistrationProblems,
} from '../lib/text-anchor-checks.mjs';

export const ENTRIES = [

  // ---------- 场景（多趟路由核心——多趟推进完成 / 零进展防呆 / 委托节点二次进入完成判定 / 向后兼容等价） ----------

  // 172: 多波混合推进完成（AC-1/AC-2）——多波混合 TASK 经 next 分趟自动路由直至清空：
  // 无 eligible 并行时回串行消化（execute）；依赖满足即再入 subagent-execute（第二趟——
  // completedNodes 已含该节点仍路由回 = 多趟循环路由）；全部 done 后经产物门控进 review。
  // 旧引擎单趟限制下第三步会停留在 execute = 预期 RED。
  {
    name: '172 多波混合推进完成：分趟自动路由直至清空进 review',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const goNext = (currentNode, doneIds, completedExtra = []) => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + renderMultiWaveTasks(doneIds));
        writeState(dir, {
          activeChange: CHANGE_ID,
          currentNode,
          completedNodes: ['open', 'design', 'plan', ...completedExtra],
          evidence: {
            open: { summary: 'o' },
            design: { summary: 'd' },
            plan: { summary: 'p' },
            ...(completedExtra.includes('subagent-execute') ? { 'subagent-execute': { summary: 'wave delegated' } } : {}),
            ...(completedExtra.includes('execute') ? { execute: { summary: 'serial digested' } } : {}),
          },
          verifyFailures: 0,
          executionMode: 'subagent',
          directOverride: false,
        });
        return runStateWithProtocol(dir, ['next']);
      };
      // 趟 0：无可委托并行（P 波依赖 T01 未完成）、串行 T01 pending → execute
      let res = goNext('execute', []);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // 趟 1：T01 done → P01/P02 eligible → 第一趟委托
      res = goNext('execute', ['T01']);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // 趟间：P01/P02 done（第一趟委托收集完成）→ 回 execute 消化 T02（第二波未满足不抢跑）
      res = goNext('subagent-execute', ['T01', 'P01', 'P02'], ['subagent-execute']);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // 趟 2（多趟关键断言）：T02 done → P03/P04 eligible → 第二趟再入 subagent-execute
      //（真实链路中此处由 execute exit --apply 的平行路由镜像直接落点；next 级断言同一谓词）
      res = goNext('subagent-execute', ['T01', 'P01', 'P02', 'T02'], ['subagent-execute', 'execute']);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // 清空：全部 done + SUMMARY 在场 → 委托与串行均无残留 → review（产物门控照旧）。
      // 状态取真实链路形态：completedNodes 按路由序排列（末元素 = subagent-execute，
      // 其 exit --apply 已把 currentNode 推到 review——正常推进豁免放行 next）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      res = goNext('review', ['T01', 'P01', 'P02', 'T02', 'P03', 'P04'], ['execute', 'subagent-execute']);
      assertExit(res, 0);
      assertOut(res, 'NODE: review');
    },
  },

  // 173: 单趟零进展防呆（三重防呆决策之二·状态机侧）——TASK 仅剩依赖无法满足的孤儿并行任务（depends_on 引用
  // 不存在的 T99）：既无可委托并行又无串行 pending 且 TASK 未全 done → next 应 BLOCKED 防静默死锁。
  // 旧引擎无防呆静默路由 execute = 预期 RED。
  {
    name: '173 单趟零进展 BLOCK：孤儿并行依赖无法满足（检查 depends_on）',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T99</depends_on></task>\n');
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes: ['open', 'design', 'plan'],
        evidence: { open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '孤儿并行');
      assertOut(res, 'depends_on');
    },
  },

  // 174: 委托节点二次进入完成判定（AC-2 合取语义）——completedNodes 含 subagent-execute：
  // ① 仍有 eligible 并行 pending → next 返回 NODE: subagent-execute（未最终完成，继续委托）；
  // ② 并行全 done、仅串行 pending → NODE: execute（本趟委托完成，趟间回串行）；
  // ③ 全部 done + SUMMARY 在场 → NODE: review（可委托集合为空 ∧ 无串行 pending → 最终完成）。
  // 旧引擎①停留 execute = 预期 RED。
  {
    name: '174 委托节点二次进入完成判定：eligible 再入 → 趟间串行 → 清空进 review',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const pDone = (id, deps) =>
        '<task id="' + id + '" status="done" parallel="true"><action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files><verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
        (deps ? '<depends_on>' + deps + '</depends_on>' : '') + '</task>\n';
      const t03 = (status) =>
        '<task id="T03"' + (status ? ' status="' + status + '"' : '') + '><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
      // ① 第一波 P01 done + 第二波 P02（dep P01）pending eligible + 串行 T03 pending → 二次进入委托
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2_PENDING + t03(''));
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'subagent-execute',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        evidence: {
          open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' },
          execute: { summary: 'serial digested' }, 'subagent-execute': { summary: 'wave1 delegated' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      let res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // ② P02 也 done → 可委托集合为空、串行 T03 pending → 趟间回 execute
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + pDone('P02', 'P01') + t03(''));
      res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // ③ 全部 done + SUMMARY 在场 → 合取完成（无 eligible ∧ 无 serial pending）→ review
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + pDone('P02', 'P01') + t03('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/T03-SUMMARY.md', summaryContent());
      res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: review');
    },
  },

  // 175: 向后兼容等价断言（AC-3）——旧合法形态在新引擎下路由结果与旧期望一致（零行为漂移）：
  // 全串行 → execute；并→串首趟 → subagent-execute；并→串委托完成后（无新 eligible）→ execute；
  // 串→并首趟 → execute（先串行）。旧合法序列退化为单趟，行为不变。
  {
    name: '175 向后兼容等价：旧合法形态路由结果与旧期望一致',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const goNext = (taskContent, currentNode, completedExtra = [], withExecuteEvidence = false) => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + taskContent);
        writeState(dir, {
          activeChange: CHANGE_ID,
          currentNode,
          completedNodes: ['open', 'design', 'plan', ...completedExtra],
          evidence: {
            open: { summary: 'o' },
            design: { summary: 'd' },
            plan: { summary: 'p' },
            // withExecuteEvidence：模拟首趟串行消化已 record 过 execute（证据跨重入累积——
            // 真实链路 evidence 不清零；无标记 = 尚未进入过 execute 的干净态）
            ...(withExecuteEvidence ? { execute: { summary: 'serial pass recorded' } } : {}),
            ...(completedExtra.includes('subagent-execute') ? { 'subagent-execute': { summary: 'delegated' } } : {}),
          },
          verifyFailures: 0,
          executionMode: 'subagent',
          directOverride: false,
        });
        return runStateWithProtocol(dir, ['next']);
      };
      // ① 全串行（含依赖链）→ execute
      let res = goNext(TASK_VALID_ALL_SERIAL, 'execute');
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // ② 并→串（并存前+串在后）首趟 → subagent-execute（与旧引擎第一趟一致）
      res = goNext(TASK_VALID_PS, 'execute');
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // ③ 并→串委托完成后（并行全 done、无新 eligible）→ execute 消化串行（与旧引擎一致；
      // execute 已 record 过——证据累积，严格顺序校验放行）
      res = goNext(
        '<task id="P01" status="done" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
        '<task id="P02" status="done" parallel="true"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n' +
        '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify><depends_on>P01,P02</depends_on></task>\n',
        'execute', ['subagent-execute'], true);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // ④ 串→并（串在前+并在后）首趟 → execute 先串行（与旧引擎一致）
      res = goNext(TASK_VALID_SP, 'execute');
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
    },
  },

  // 176: 伪并行检测（多趟混排合法化后的语义盲区兜底）——并行任务 write_files 仅声明测试产物
  // 而无任何生产代码文件时，plan 出口输出 WARN（列任务 id 并给出 depends_on/垂直切片建议）
  // 且不阻断——渐进提示语义本身即断言点；write_files 混有生产文件的并行任务不触发。
  {
    name: '176 伪并行 WARN：仅写测试产物的并行任务提示依赖嫌疑且不阻断',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'plan',
        completedNodes: ['open', 'design'],
        evidence: { open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      // 正例：纯测试面并行任务 → WARN 列 id 并建议 depends_on；plan 出口仍通过
      let res = runPlanExit(dir,
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>tests/test_p1.mjs</write_files><verify>node --check tests/test_p1.mjs</verify></task>\n');
      assertExit(res, 0);
      assertOut(res, 'WARN: 伪并行检测');
      assertOut(res, 'P01');
      assertOut(res, 'depends_on');
      // 新形态 a：test 后缀文件（src/helper.test.mjs）——应 WARN
      res = runPlanExit(dir,
        '<task id="P01b" parallel="true" status="pending"><action>实现 P01b</action><write_files>src/helper.test.mjs</write_files><verify>node --check src/helper.test.mjs</verify></task>\n');
      assertExit(res, 0);
      assertOut(res, 'WARN: 伪并行检测');
      assertOut(res, 'P01b');
      // 新形态 b：__tests__/ 目录（__tests__/helper.test.ts）——应 WARN
      res = runPlanExit(dir,
        '<task id="P01c" parallel="true" status="pending"><action>实现 P01c</action><write_files>__tests__/helper.test.ts</write_files><verify>node --check __tests__/helper.test.ts</verify></task>\n');
      assertExit(res, 0);
      assertOut(res, 'WARN: 伪并行检测');
      assertOut(res, 'P01c');
      // 新形态 c：Windows 反斜杠分隔（tests\foo.test.mjs）——应 WARN
      res = runPlanExit(dir,
        '<task id="P01d" parallel="true" status="pending"><action>实现 P01d</action><write_files>tests\\foo.test.mjs</write_files><verify>node --check tests\\foo.test.mjs</verify></task>\n');
      assertExit(res, 0);
      assertOut(res, 'WARN: 伪并行检测');
      assertOut(res, 'P01d');
      // 新形态 d：多行注释块包裹（整块剥除后再解析，注释内容不得当生产文件）——仍 WARN
      res = runPlanExit(dir,
        '<task id="P01e" parallel="true" status="pending"><action>实现 P01e</action><write_files><!-- 规划备注\nsrc/fake.mjs\n-->tests/real.test.mjs</write_files><verify>node --check tests/real.test.mjs</verify></task>\n');
      assertExit(res, 0);
      assertOut(res, 'WARN: 伪并行检测');
      assertOut(res, 'P01e');
      // 反例：write_files 混有生产文件 → 不触发
      res = runPlanExit(dir,
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs\ntests/test_p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n');
      assertExit(res, 0);
      assertNotOut(res, '伪并行检测');
    },
  },

  // 177: hook 项目根判定兜底链（级3 实测暴露的 H5 残留缺口收口）——会话 cwd 漂移后：
  // ① 有 CLAUDE_PROJECT_DIR（CC hook env 注入）→ 越界写 BLOCKED / .specs 写放行；
  // ② 无任何 env → 自 cwd 向上锚定最近含 .flow-comet/flow-comet-state.json 的祖先，同样正确判定。
  // 修复前两种漂移形态下协议读取失败 → exit 1 报错式放行（越界写有痕放过）。
  {
    name: '177 hook 根判定兜底：cwd 漂移经变量/祖先锚定后正确拦截（H5 收口）',
    run: (dir) => {
      // running 态（review 节点白名单 .specs/）
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        status: 'running',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        evidence: {}, verifyFailures: 0, executionMode: 'subagent', directOverride: false,
      });
      fs.mkdirSync(path.join(dir, 'deep'), { recursive: true });
      const spawnDrift = (input, extraEnv) => {
        // 封闭性：剥离宿主可能注入的锚定变量，确保用例只测显式给定的锚定形态
        const inherited = { ...process.env };
        delete inherited.FLOW_COMET_RUN_ROOT;
        delete inherited.CLAUDE_PROJECT_DIR;
        const res = spawnSync(process.execPath, [HOOK, 'before_tool'], {
          cwd: path.join(dir, 'deep'),
          input: JSON.stringify(input),
          env: {
            ...inherited,
            FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir),
            ...extraEnv,
          },
          encoding: 'utf8', timeout: 60000,
        });
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      const evil = path.join(dir, 'evil', 'x.txt').split(path.sep).join('/');
      const inspec = path.join(dir, '.specs', 'ok.txt').split(path.sep).join('/');
      // ① CLAUDE_PROJECT_DIR 锚定
      let r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: evil } }, { CLAUDE_PROJECT_DIR: dir });
      assertExit(r, 2);
      assertOut(r, 'BLOCKED');
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: inspec } }, { CLAUDE_PROJECT_DIR: dir });
      assertExit(r, 0);
      assertOut(r, 'workflow-hook-guard-ok');
      // ② 无 env → 祖先锚定（dir 含 .flow-comet/flow-comet-state.json）
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: evil } }, {});
      assertExit(r, 2);
      assertOut(r, 'BLOCKED');
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: inspec } }, {});
      assertExit(r, 0);
      assertOut(r, 'workflow-hook-guard-ok');
      // ③ 相对 file_path 按锚定根解析（修复点：曾按漂移 cwd 解析，好写被误拦）
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: '.specs/ok.txt' } }, { CLAUDE_PROJECT_DIR: dir });
      assertExit(r, 0);
      assertOut(r, 'workflow-hook-guard-ok');
      // ④ 相对路径在项目内但白名单外 → 拦截
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: 'evil-rel/x.txt' } }, { CLAUDE_PROJECT_DIR: dir });
      assertExit(r, 2);
      assertOut(r, 'BLOCKED');
      // ⑤ 陈旧 CLAUDE_PROJECT_DIR（不存在的路径）→ 不采纳，落入祖先锚定仍正确判定
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: evil } }, { CLAUDE_PROJECT_DIR: path.join(dir, 'gone') });
      assertExit(r, 2);
      assertOut(r, 'BLOCKED');
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: inspec } }, { CLAUDE_PROJECT_DIR: path.join(dir, 'gone') });
      assertExit(r, 0);
      assertOut(r, 'workflow-hook-guard-ok');
    },
  },

  // ---------- 场景族（多趟出口与解析硬化 · AC-1~AC-7）：期望先行 TDD——部分场景对未修复引擎
  // RED 属预期中间态（GREEN 随引擎修复落地后于收口前全量确认）；BLOCKED 文案断言与设计决策
  // 的提示句逐字对齐；既有场景不受本族影响（编号连续接续）。

  // 178: S 开局混排拓扑 execute 首趟出口放行——T01[S] 已委托交付标 done、T02/T03[P] dep T01
  // pending（待下一趟委托）、T04[S] dep T02,T03 pending（依赖未满足）。串行 pending 判定收窄为
  // 「可运行串行」后，依赖未满足的中段串行 = 等后续波次的合法中间态 → 放行，多趟路由零干预续驱；
  // 未修复引擎按「全部 pending 串行」无条件拦截 → 对未修复引擎 RED。
  {
    name: '178 execute 出口放行：S 开局混排拓扑中段串行依赖未满足不再拦',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" parallel="false" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
        '<task id="T02" parallel="true" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T03" parallel="true" status="pending"><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T04" parallel="false" status="pending"><action>实现 T04</action><write_files>src/t4.mjs</write_files><verify>node --check src/t4.mjs</verify><depends_on>T02,T03</depends_on></task>\n' +
        '<task id="T05" parallel="false"><action>遗留无状态串行</action><write_files>src/t5.mjs</write_files><verify>node --check src/t5.mjs</verify></task>\n');
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 179: 可运行串行仍拦（保守边界不松动的负例锚）——同拓扑但 T04 depends_on 为空：
  // 依赖已满足、既未委托也未标 done 的串行 pending = 规划错误信号 → BLOCKED 且消息指明该任务 id。
  // 拦截语义与 id 明细既有引擎已具备 → 即刻绿锚，钉住判定收窄不弱化此向。
  {
    name: '179 execute 出口仍拦：可运行串行 pending BLOCKED 且消息含任务 id',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" parallel="false" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
        '<task id="T02" parallel="true" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T03" parallel="true" status="pending"><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T04" parallel="false" status="pending"><action>实现 T04</action><write_files>src/t4.mjs</write_files><verify>node --check src/t4.mjs</verify></task>\n');
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '串行 pending');
      assertOut(res, 'T04');
    },
  },

  // 180: 委托边界单行分号 write_files 自动解析正例——request 不带 --write-files 走 TASK.md
  // 自动解析，`a; b` 单行分号形态须切分为两条路径（与换行形态等价）；随后 result 回传恰好触碰
  // 这两个文件的提交，提交文件子集校验通过、不出现「超出 writeFiles 范围」误拦。
  {
    name: '180 handoff 分号单行 write_files 自动解析等价换行且 result 子集校验通过',
    run: (dir) => {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      writeFile(dir, 'src/todo_x.py', '# impl\n');
      writeFile(dir, 'tests/test_todo_x.py', '# test\n');
      // 只加任务切片文件——运行器预置的 reference/ 协议副本不属于本任务提交面
      git('add', 'src/todo_x.py');
      git('add', 'tests/test_todo_x.py');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'vertical slice');
      const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01"><action>实现 T01</action><write_files>src/todo_x.py; tests/test_todo_x.py</write_files><verify>node --check src/todo_x.py</verify></task>\n');
      const st = baseState('subagent-execute');
      st.newChange = true;
      writeState(dir, st);
      // 技能加载前置门材料：新 change 下 request 须有本节点声明标记
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/subagent-execute-flow-comet-dev.json',
        JSON.stringify({ node: 'subagent-execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resReq = runHandoff(['request', 'T01', 'delegate todo slice'], dir);
      assertExit(resReq, 0);
      assertOut(resReq, 'HANDOFF REQUEST: T01');
      // 自动解析结果与换行形态等价：单行分号切分为两条独立路径入库
      const stAfter = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const parsedFiles = stAfter.evidence['subagent-execute'].handoffRequests.T01.writeFiles;
      if (!Array.isArray(parsedFiles) || parsedFiles.length !== 2
        || !parsedFiles.includes('src/todo_x.py') || !parsedFiles.includes('tests/test_todo_x.py')) {
        throw new Error('request 自动解析未把单行分号 write_files 切分为两条路径: ' + JSON.stringify(parsedFiles));
      }
      const payload = JSON.stringify({
        status: 'DONE', taskId: 'T01', commitHash: hash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/todo_x.py', output: 'ok' },
        redEvidence: { command: 'node --check tests/test_todo_x.py', output: 'ok' },
      });
      const resResult = runHandoff(['result', 'T01', payload], dir);
      assertExit(resResult, 0);
      assertOut(resResult, 'HANDOFF RESULT: T01');
      assertNotOut(resResult, '超出 writeFiles 范围');
    },
  },

  // 181: 伪并行启发式分号容错（一景双断言）——① 并行任务 write_files 为单行分号垂直切片
  // （生产文件; 测试文件）：未修复引擎按整行匹配测试路径模式 → 误报 WARN（RED 取证点）；
  // 修复补分号二次切分后识别出生产文件 → 不误报。② 纯测试文件并行任务（换行形态）仍输出
  // WARN 且不阻断（真报保持）。WARN 明细行以「无生产代码文件: <任务id>」前缀区分两任务归属。
  {
    name: '181 伪并行检测分号容错：单行垂直切片不误报且纯测试并行任务仍告警',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'plan',
        completedNodes: ['open', 'design'],
        evidence: { open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      const res = runPlanExit(dir,
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>todo_x.py; tests/test_todo_x.py</write_files><verify>node --check todo_x.py</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>tests/test_p2.mjs\ntests/test_p2_helper.mjs</write_files><verify>node --check tests/test_p2.mjs</verify></task>\n');
      assertExit(res, 0); // WARN 渐进不阻断
      assertOut(res, 'WARN: 伪并行检测'); // ② 纯测试并行任务真报保持
      assertOut(res, '无生产代码文件: P02');
      assertNotOut(res, '无生产代码文件: P01'); // ① 分号垂直切片不误报
    },
  },

  // 182: 收尾态 ROUTE WARN 静默——TASK 全部任务 done 后，「未找到可委托并行块」诊断失去
  // 信息量（噪音只在收尾态出现）；增加存在 pending 任务前置条件后静默。未修复引擎无条件
  // 输出 → 对未修复引擎 RED。
  {
    name: '182 execute 出口静默：全部任务 done 后无 ROUTE WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      // 未分类并行任务（缺 status）自初始 TASK 在场——全部可解析任务 done 后，
      // 该任务按「缺 status 不视为 pending」文档语义保持静默（与既有「无可解析 pending 静默」
      // 案例锚同源），不误报路由警告。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2 +
        '<task id="P03" parallel="true"><action>实现 P03</action><write_files>src/p3.mjs</write_files><verify>node --check src/p3.mjs</verify></task>\n');
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/P02-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01', 'P02']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'ROUTE WARN');
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 183: 死结类 BLOCKED 补 advance 边界提示——可运行串行拦截分支的 BLOCKED 消息含逐字句
  // 「无可执行的常规恢复动作时，可用 workflow-state.mjs advance 渡过结构性死结」（仅死结分支
  // 提示，常规缺产物/缺证据情形不适用）。文案由引擎侧任务落地——未修复消息无该句 → RED。
  {
    name: '183 死结 BLOCKED 消息含 advance 边界提示逐字句',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 +
        '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>P01</depends_on></task>\n');
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '无可执行的常规恢复动作时，可用 workflow-state.mjs advance 渡过结构性死结');
    },
  },

  // 184: 技能文本混排合法化语义文本锁（in-place 扩展：模板权威整句 / 入口 archive 读法 /
  // 规划约束 / Codex 平台事实）——plan 与 subagent-execute 两 SKILL 权威源不得再含
  // 「连续块」「居首」旧波次形态约束表述，且依赖图语义描述（depends_on）在场、「用 Skill 工具」
  // 两层加载句式保持（措辞锁族既有锚不破坏）。
  // **逐字锁重定向（ADR-016）**：原「同一文字须在多册出现」的硬锁一律改为「单一权威 + 指针在场 +
  // 正文唯一」三件套，每条新锚自带反向构造（抽掉目标文字必红——判别句式，非裸子串）：
  //   ② 模板权威：14 册各自的锚句**即指向唯一权威 `flow-kit/templates/**` 的指针**（整句语义组合
  //      仍在场，缺任一册即红）；「该句只在 1 处」落在**册内一侧**（每册恰一处——同册复制第二份即红），
  //      并补「作者面唯一」：全部持锚行的分发文本必须同指 `flow-kit/templates/**`（指向别处即红）。
  //   ⑤ 平台事实：判别句随 `worktree-notes.md` 移出而迁入 `reference/platform-facts.md`（T07 已搬入）
  //      ——判据改为「权威文件在场 + 判别句在权威处 + 各引用册指针在场 + 判别句**不再回流册子**」。
  //   ⑥ 三块归一处：`reference/commit-discipline.md` 持 pathspec 五要素与集成四要素**全文**（权威处），
  //      两册只留要点句（**不再要求逐字一致**，逐字锁已作废）；权威处独有的「证据与判级」判别句
  //      回流任一册即红。
  //   ⑦ 入口册的 7 条字面量与「建树适用面两句」保留（能力契约锚）；`worktree-notes.md` 的 6 条整句
  //      随文件移出改锚到 `reference/platform-facts.md`，并断言各引用册指针在场。
  //   ⑧ 文本↔实现一致（文本不得说谎）：**保留原样**——它不是「多册同文字」类锁，本批不动。
  //   附：技能树正文的相对路径引用必须解析得到（本轮 `GUIDANCE.md` 改名曾造成 5 册死引用而零红灯）。
  //   附 2：成对展开文件的指针**不得指错**——「能解析 ≠ 指对了」：同目录带同名 `GUIDANCE.md` 的册，
  //     册首「手写区详细协议见 …」必须是本册裸文件名；入口册（展开版为 `reference/entry-detail.md`）
  //     是唯一例外。解析判据只证明目标**存在**，证明不了**指对了**——本附与之互补。
  // 文本存在级断言（结构级由其余场景族覆盖）。
  // in-place 扩展（委托契约纪律文本锁）：两册（委托册 / 串行册）各自须含四属性契约、提交面 pathspec
  // 纪律与集成纪律的**要点句与条件句**；旧表述零残留（无条件 worktree 口号仅允许被反驳形态、
  // 「未获机制明文放行」清零）；文本点名的实现常量 / 载荷键名 / 受保护目标与引擎实现逐项对照
  //（文本说 A、实现说 B 即红）。
  {
    name: '184a 技能文本锁：两层加载/依赖图既有锚 + 模板权威指针与登记',
    run: () => {
      const problems = [];
      // —— 既有锚（原文语义与失败消息保持）——
      for (const skillDir of ['flow-comet-plan', 'flow-comet-subagent-execute']) {
        const text = fs.readFileSync(path.join(SCRIPTS_DIR, '..', '..', skillDir, 'SKILL.md'), 'utf8');
        if (text.includes('连续块')) problems.push(skillDir + ' 含「连续块」旧形态约束表述');
        if (text.includes('居首')) problems.push(skillDir + ' 含「居首」旧位置约束表述');
        if (!text.includes('depends_on')) problems.push(skillDir + ' 缺依赖图语义描述（depends_on）');
        if (!text.includes('用 Skill 工具')) problems.push(skillDir + ' 缺「用 Skill 工具」两层加载句式');
      }
      // —— ② 模板权威（重定向后的三件套）——成员面与整句锚点取自模块级常量（单一来源）：
      // 9 个既有成员 + 5 个 flow-kit 阶段协议技能 = 14 个真实成员（含 task）；受检面另加
      // 入口册与入口展开册（两者是「短指针」形态的既有持有者）。
      const templateAuthoritySkills = TEMPLATE_AUTHORITY_SKILLS;
      const templateAuthorityDocs = new Map();
      for (const skillDir of templateAuthoritySkills) {
        templateAuthorityDocs.set(skillDir + '/SKILL.md',
          fs.readFileSync(path.join(SCRIPTS_DIR, '..', '..', skillDir, 'SKILL.md'), 'utf8'));
      }
      templateAuthorityDocs.set('flow-comet/SKILL.md', fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'SKILL.md'), 'utf8'));
      templateAuthorityDocs.set('flow-comet/reference/entry-detail.md',
        fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'reference', 'entry-detail.md'), 'utf8'));
      problems.push(...templateAuthorityProblems(templateAuthorityDocs));
      // 反向构造（同一判据驱动，逐条对应重定向后的两侧）：
      // ① 同一册复制第二份锚行 ⇒ 必报「只允许 1 处」（重复回潮的同册形态）；
      // ② 权威目标改指别处 ⇒ 必报「未指向」（单一权威侧）；
      // ③ **真实文本变异**（不再用合成 `'y'.repeat(n)` 串）：把入口册的声明块**原样**搬进另一册
      //    ——判据面里的那册原块被**替换**掉，故不触发「同册第二处锚句」，只可能由正文唯一判据
      //    发声 ⇒ 必报「第二份展开正文」（旧探针只证明比较器能用，证不了判据面选得对）；
      // ④ 抽掉某册锚句 ⇒ 必报该册缺声明（指针在场侧）。
      {
        const openRel = 'flow-comet-open/SKILL.md';
        const openText = templateAuthorityDocs.get(openRel);
        const anchorLine = openText.split(/\r?\n/).find((l) => l.includes('模板权威'));
        const entryBlock = templateAuthorityParagraphs(templateAuthorityDocs.get('flow-comet/SKILL.md'))[0] ?? '';
        const openBlock = templateAuthorityParagraphs(openText)[0] ?? '';
        if (entryBlock === '' || openBlock === '' || templateAuthorityBody(entryBlock) === '') {
          problems.push('正文唯一反向构造的前提不成立：入口册声明块缺失 / 无正文行（无法构造真实变异探针）');
        }
        const probes = [
          ['同册复制第二份锚行', new Map(templateAuthorityDocs).set(openRel, openText + '\n' + anchorLine + '\n'),
            '只允许 1 处'],
          ['权威目标改指别处', new Map(templateAuthorityDocs).set(openRel,
            openText.split('`flow-kit/templates/**`').join('`.specs/archive/**`')), '未指向'],
          ['入口册声明块原样搬进另一册', new Map(templateAuthorityDocs)
            .set(openRel, openText.split(openBlock).join(entryBlock)), '第二份展开正文'],
          ['抽掉某册锚句', new Map(templateAuthorityDocs).set(openRel,
            openText.split(anchorLine).join('（反向构造：抽掉锚句）')), '缺模板权威'],
        ];
        for (const [label, probed, expected] of probes) {
          if (!templateAuthorityProblems(probed).some((p) => p.includes(expected))) {
            problems.push('反向构造判别力缺失（模板权威: ' + label + ' 未被判违规）');
          }
        }
      }
      // 作者面完备性（判据 = **登记**，不是**计数相等**）：新增持锚文本必须**显式登记**在受检面
      // 常量里，否则报「未登记的权威声明」——报错指向真实动作（把新册登记进 `TEMPLATE_AUTHORITY_SKILLS`
      // 并同批加声明）。**不做计数相等**：同文件别处的判据注释明确反对「以总量取红」的自锁探针
      //（合法扩册会先撞红、报错方向指向锚而非真实动作）；受检面成员**缺**声明由
      // `templateAuthorityProblems` 的逐份「缺模板权威整句声明」覆盖，故登记判据**单向**判定即可。
      {
        const expectedHolders = [...templateAuthorityDocs.keys()].sort();
        const actualHolders = skillTreeDocFiles()
          .filter(([, file]) => fs.readFileSync(file, 'utf8').includes('模板权威'))
          .map(([rel]) => rel)
          .sort();
        problems.push(...templateAuthorityRegistrationProblems(actualHolders, expectedHolders));
        // 反向构造（同一判据驱动）：① 未登记的新持有者 ⇒ 必报「未登记」；② 同批登记（把新册加进
        // 受检面常量）⇒ **零问题**（合法扩册不再先红——旧计数相等判据正是在这一步撞红）。
        const registeredProbe = 'flow-comet-probe-node/SKILL.md';
        for (const [label, holders, expected, shouldReport] of [
          ['未登记的新持有者', [...actualHolders, registeredProbe], expectedHolders, true],
          ['同批登记后的新持有者', [...actualHolders, registeredProbe], [...expectedHolders, registeredProbe], false],
        ]) {
          const reported = templateAuthorityRegistrationProblems(holders, expected)
            .some((p) => p.includes(registeredProbe));
          if (reported !== shouldReport) {
            problems.push('反向构造判别力缺失（模板权威登记: ' + label + (shouldReport ? ' 未被判违规' : ' 被误判违规') + '）');
          }
        }
      }
      if (problems.length > 0) throw new Error('技能文本锁（模板权威族）不符: ' + problems.join('; '));
    },
  },

  // 184b: 技能树正文的相对路径引用必须解析得到——改名造成的 5 册死引用曾零红灯；含三层反向构造
  // （改写成不存在目标 / 抽掉引用不误报 / 显式跨册指针改回裸形态）。
  {
    name: '184b 技能文本锁：技能树正文相对路径引用可解析（含三层反向构造）',
    run: () => {
      const problems = [];
      // —— 附：技能树正文的相对路径引用必须解析得到（本轮改名造成 5 册死引用而**零红灯**）——
      {
        const skillsRootAbs = path.join(SCRIPTS_DIR, '..', '..');
        const treeDocs = new Map(skillTreeDocFiles().map(([rel, file]) => [rel, fs.readFileSync(file, 'utf8')]));
        problems.push(...skillTreeReferenceProblems(treeDocs, skillsRootAbs));
        // 反向构造（同一判据驱动）：① 把引用改写成不存在的目标 ⇒ 必报「解析不到」；
        // ② 抽掉引用 ⇒ 判据面收缩但**不误报**（证明判据只在引用在场时发声，不恒真）；
        // ③ **形态收窄侧**：把节点册里的一处**显式跨册**指针改回**裸形态** ⇒ 必报「解析不到」
        //（旧实现给裸形态合成「入口册册根」候选，这一改法当时**判绿**——正是假绿本身）。
        const sampleEntry = [...treeDocs].find(([, text]) => SKILL_TREE_REFERENCE_RE.test(text));
        SKILL_TREE_REFERENCE_RE.lastIndex = 0;
        if (!sampleEntry) {
          problems.push('相对路径引用判据的前提不成立：技能树里找不到任何 reference/ 相对引用');
        } else {
          const [sampleRel, sampleText] = sampleEntry;
          const sampleRef = sampleText.match(SKILL_TREE_REFERENCE_RE)[0];
          const broken = new Map(treeDocs).set(sampleRel,
            sampleText.split(sampleRef).join('reference/renamed-away-fixture.md'));
          if (!skillTreeReferenceProblems(broken, skillsRootAbs).some((p) => p.includes('解析不到'))) {
            problems.push('反向构造判别力缺失（死引用未被判「解析不到」）: ' + sampleRel + ' → ' + sampleRef);
          }
          const dropped = new Map(treeDocs).set(sampleRel, sampleText.split(sampleRef).join(''));
          if (skillTreeReferenceProblems(dropped, skillsRootAbs).some((p) => p.startsWith(sampleRel))) {
            problems.push('相对路径引用判据误报（抽掉引用后仍报该册）: ' + sampleRel);
          }
        }
        const explicitEntry = [...treeDocs].find(([rel, text]) => !rel.startsWith(SKILL_TREE_ENTRY_BOOK + '/')
          && text.includes(SKILL_TREE_EXPLICIT_REFERENCE_PREFIX));
        if (!explicitEntry) {
          problems.push('形态收窄反向构造的前提不成立：节点册里找不到显式跨册指针'
            + '（`' + SKILL_TREE_EXPLICIT_REFERENCE_PREFIX + 'reference/…`）');
        } else {
          const [nodeRel, nodeText] = explicitEntry;
          const explicitRef = nodeText.match(
            new RegExp('\\.\\.\\/flow-comet\\/reference\\/[A-Za-z0-9._-]+\\.(?:md|json)'))[0];
          const reverted = new Map(treeDocs).set(nodeRel,
            nodeText.split(explicitRef).join(explicitRef.replace(SKILL_TREE_EXPLICIT_REFERENCE_PREFIX, '')));
          if (!skillTreeReferenceProblems(reverted, skillsRootAbs).some((p) => p.includes('解析不到'))) {
            problems.push('反向构造判别力缺失（节点册指针改回裸形态未被判违规）: ' + nodeRel + ' → ' + explicitRef);
          }
        }
        // —— 附 2：成对展开文件的指针不得指错（上一条只证明目标**存在**，本条判**指对了**）——
        {
          const bookRels = [...treeDocs.keys()].filter((rel) => rel.endsWith('/SKILL.md')
            && !path.posix.dirname(rel).includes('/'));
          const hasOwnGuidance = (rel) => fs.existsSync(path.join(skillsRootAbs, path.posix.dirname(rel), 'GUIDANCE.md'));
          const pairedRels = bookRels.filter(hasOwnGuidance);
          const entryHasOwn = hasOwnGuidance(PAIRED_GUIDANCE_ENTRY_REL);
          // 前提：成对形态在场（否则判据空转）+ 入口册的例外目标在场（入口册无同名展开版时）。
          if (pairedRels.length === 0) {
            problems.push('成对指针判据的前提不成立：技能树里找不到任何带同目录 GUIDANCE.md 的册');
          }
          if (!entryHasOwn
            && !fs.existsSync(path.join(skillsRootAbs, path.posix.dirname(PAIRED_GUIDANCE_ENTRY_REL),
              PAIRED_GUIDANCE_ENTRY_TARGET))) {
            problems.push('成对指针判据的前提不成立：入口册展开版 ' + PAIRED_GUIDANCE_ENTRY_TARGET + ' 不在场（唯一例外无处指向）');
          }
          problems.push(...pairedGuidancePointerProblems(treeDocs, skillsRootAbs));
          // 反向构造（同一判据驱动）：① 带同目录 GUIDANCE 的册改指**入口册**展开版 ⇒ 必报「指错文档」；
          // ② 改指**另一册**的展开版 ⇒ 必报（另一侧形态，证明判据不靠"是否含 GUIDANCE.md 子串"恒真）；
          // ③ 入口册改指裸文件名 ⇒ 必报（唯一例外侧）；④ 抽掉指针 ⇒ 必报缺指针；⑤ 同册第二处指针 ⇒ 必报
          // 重复；⑥ 无配对展开版的册带指针 ⇒ 必报；⑦ 无配对展开版的册不带指针 ⇒ **零误报**（判据不恒真）。
          const pointerProbe = (rel, target) => new Map(treeDocs).set(rel,
            (treeDocs.get(rel) ?? '').replace(PAIRED_GUIDANCE_POINTER_RE,
              '<!-- 手写区详细协议见 ' + target + '（可选阅读） -->'));
          const probeRel = pairedRels.find((rel) => rel !== PAIRED_GUIDANCE_ENTRY_REL);
          const otherProbeRel = pairedRels.find((rel) => rel !== probeRel);
          const quietRel = bookRels.find((rel) => rel !== PAIRED_GUIDANCE_ENTRY_REL && !hasOwnGuidance(rel));
          const probeText = treeDocs.get(probeRel) ?? '';
          const pointerLine = probeText.match(PAIRED_GUIDANCE_POINTER_RE)?.[0] ?? '';
          if (!probeRel || !otherProbeRel || !quietRel || !pointerLine) {
            problems.push('成对指针反向构造的前提不成立：成对册不足两册 / 无无配对展开版的非入口册 / 探针册无指针行');
          } else {
            const probes = [
              ['册改指入口册展开版', pointerProbe(probeRel, '../flow-comet/reference/entry-detail.md'), '指错文档'],
              ['册改指另一册展开版', pointerProbe(probeRel,
                '../' + path.posix.dirname(otherProbeRel) + '/GUIDANCE.md'), '指错文档'],
              ['抽掉指针', new Map(treeDocs).set(probeRel, probeText.replace(PAIRED_GUIDANCE_POINTER_RE, '')),
                '缺「手写区详细协议见 …」指针'],
              ['同册第二处指针', new Map(treeDocs).set(probeRel, probeText + '\n' + pointerLine), '只允许 1 处'],
              ['无配对展开版的册带指针', new Map(treeDocs).set(quietRel,
                (treeDocs.get(quietRel) ?? '') + '\n' + pointerLine), '既无同目录 GUIDANCE.md 也非入口册'],
            ];
            if (!entryHasOwn) {
              probes.push(['入口册改指裸文件名', pointerProbe(PAIRED_GUIDANCE_ENTRY_REL, 'GUIDANCE.md'), '指错文档']);
            }
            for (const [label, probed, expected] of probes) {
              if (!pairedGuidancePointerProblems(probed, skillsRootAbs).some((p) => p.includes(expected))) {
                problems.push('反向构造判别力缺失（成对指针: ' + label + ' 未被判违规）');
              }
            }
          }
          if (!quietRel) {
            problems.push('成对指针反向构造的前提不成立：找不到无配对展开版的非入口册');
          } else if (pairedGuidancePointerProblems(new Map([[quietRel,
            (treeDocs.get(quietRel) ?? '').replace(PAIRED_GUIDANCE_POINTER_RE, '')]]), skillsRootAbs).length !== 0) {
            problems.push('成对指针判据误报（无配对展开版且不带指针的册被判违规）: ' + quietRel);
          }
        }
      }
      if (problems.length > 0) throw new Error('技能文本锁（相对路径引用族）不符: ' + problems.join('; '));
    },
  },

  // 184c: 纪律判别句式族——入口 archive 读法三要素、plan/task 判别句式 + GUIDANCE 委托消化、
  // Codex 平台事实与支持面（权威处唯一 + 引用册指针在场 + 判别句不回流）。
  {
    name: '184c 技能文本锁：入口 archive 读法 + 规划约束判别句 + Codex 平台事实',
    run: () => {
      const problems = [];
      // —— 入口 archive 读法：三要素关键词在场 ——
      {
        const entry = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'SKILL.md'), 'utf8');
        for (const keyword of ['flow-kit/templates', '何时可读', '不读什么']) {
          if (!entry.includes(keyword)) {
            problems.push('flow-comet/SKILL.md 缺「' + keyword + '」（入口 archive 读法三要素）');
          }
        }
      }
      // —— 规划约束：plan / task 判别句式 + GUIDANCE 委托消化 ——
      {
        const directLockPhrase = 'direct 不是并行任务的逃生口';
        const r15Keywords = {
          'flow-comet-plan': ['同一文件', '并发同伴', directLockPhrase],
          'flow-comet-task': ['同一文件', '并发同伴', directLockPhrase],
        };
        const planText = fs.readFileSync(path.join(SCRIPTS_DIR, '..', '..', 'flow-comet-plan', 'SKILL.md'), 'utf8');
        const taskText = fs.readFileSync(path.join(SCRIPTS_DIR, '..', '..', 'flow-comet-task', 'SKILL.md'), 'utf8');
        for (const [skillDir, keywords] of Object.entries(r15Keywords)) {
          const text = skillDir === 'flow-comet-plan' ? planText : taskText;
          for (const keyword of keywords) {
            if (!text.includes(keyword)) {
              problems.push(skillDir + '/SKILL.md 缺「' + keyword + '」（规划期约束判别句式）');
            }
          }
        }
        if (planText.includes('Same layer = same wave (parallel execution)')) {
          problems.push('flow-comet-plan/SKILL.md 残留「Same layer = same wave (parallel execution)」旧同层并行句');
        }
        if (!planText.includes('以本节为准')) {
          problems.push('flow-comet-plan/SKILL.md 缺「以本节为准」（上游宽松语义显式覆盖锚）');
        }
        if (taskText.includes('同层并行，跨层串行')) {
          problems.push('flow-comet-task/SKILL.md 残留「同层并行，跨层串行」旧波次句');
        }
        if (!taskText.includes('以本节点为准')) {
          problems.push('flow-comet-task/SKILL.md 缺「以本节点为准」（上游宽松语义显式覆盖锚）');
        }
        const guidanceRel = 'flow-comet/reference/entry-detail.md';
        const guidance = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'reference', 'entry-detail.md'), 'utf8');
        if (!guidance.includes('仍必须由 subagent-execute 委托消化')) {
          problems.push(guidanceRel + ' 缺「仍必须由 subagent-execute 委托消化」（direct 委托消化判别句）');
        }
      }
      // —— ⑤ Codex 平台事实与支持面（**判别句随 `worktree-notes.md` 移出技能树而迁入
      // `reference/platform-facts.md`**，ADR-016）：判据 = 权威文件在场 + 判别句在权威处
      //（含被反驳引用形态、适用范围限定、fail-open / 未闭合的现判据）+ 各引用册指针在场 +
      // **判别句不再回流册子**（权威处唯一——原「两处各自须含」的逐字锁已作废）。
      {
        const platformFactsRel = 'flow-comet/reference/platform-facts.md';
        const factsFile = path.join(SCRIPTS_DIR, '..', 'reference', 'platform-facts.md');
        const pointerBooks = [
          ['flow-comet-subagent-execute/SKILL.md', fs.readFileSync(path.join(SCRIPTS_DIR, '..', '..', 'flow-comet-subagent-execute', 'SKILL.md'), 'utf8')],
          ['flow-comet-execute/SKILL.md', fs.readFileSync(path.join(SCRIPTS_DIR, '..', '..', 'flow-comet-execute', 'SKILL.md'), 'utf8')],
          ['flow-comet/SKILL.md', fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'SKILL.md'), 'utf8')],
        ];
        if (!fs.existsSync(factsFile)) {
          problems.push(platformFactsRel + ' 不在场（判别句的唯一权威处缺失——原 worktree-notes 的锚无处可寻）');
        } else {
          const facts = fs.readFileSync(factsFile, 'utf8');
          problems.push(...platformFactsAuthorityProblems(platformFactsRel, facts, pointerBooks));
          // 反向构造（同一判据驱动）：① 权威处逐条抽掉判别句 ⇒ 必报缺句；② 判别句回流任一册 ⇒ 必报
          //（「权威处唯一」——原逐字锁**要求**两处各持一份，恰恰抓不到回流）；③ 旧独断句 / 旧过宽句
          // 还原进权威处 ⇒ 必报残留。
          for (const phrase of [...PLATFORM_FACTS_ONLY_PHRASES, 'fail-open', '未闭合']) {
            const stripped = facts.split(phrase).join('（反向构造：抽掉）');
            if (stripped === facts) continue;
            if (!platformFactsAuthorityProblems(platformFactsRel, stripped, pointerBooks)
              .some((p) => p.includes(phrase.slice(0, 20)))) {
              problems.push('反向构造判别力缺失（平台事实: 抽掉「' + phrase.slice(0, 20) + '…」未被判缺失）');
            }
          }
          for (const phrase of PLATFORM_FACTS_ONLY_PHRASES) {
            const injected = pointerBooks.map(([rel, text]) => [rel, text + '\n' + phrase + '\n']);
            if (!platformFactsAuthorityProblems(platformFactsRel, facts, injected)
              .some((p) => p.includes('回流了平台事实的证据正文'))) {
              problems.push('反向构造判别力缺失（平台事实: 把证据正文复制回册子未被判违规）');
            }
          }
          const revertedFacts = platformFactsAuthorityProblems(platformFactsRel,
            facts + '\n受支持的工作流仍是串行执行。写入仍会被协调者白名单拦截。\n', pointerBooks);
          for (const label of ['旧独断句', '旧过宽句']) {
            if (!revertedFacts.some((p) => p.includes(label))) {
              problems.push('反向构造判别力缺失（平台事实: 还原' + label + '未被判残留）');
            }
          }
          const revertedClaimFacts = platformFactsAuthorityProblems(platformFactsRel,
            facts + '\n不使用并行委托。\n', pointerBooks);
          if (!revertedClaimFacts.some((p) => p.includes('非被反驳引用形态'))) {
            problems.push('反向构造判别力缺失（平台事实: 还原裸旧独断句未被判违规）');
          }
          if (!platformFactsAuthorityProblems(platformFactsRel, facts, [
            // 抽掉指针按**文件名子串**（不带反引号、不带前缀）——指针形态从裸形态统一为显式跨册形态
            // 时本探针仍有效（形态变化不得让反向构造静默失效）。
            ...pointerBooks.slice(0, 1).map(([rel, text]) => [rel, text.split('reference/platform-facts.md').join('（反向构造：抽掉指针）')]),
            ...pointerBooks.slice(1),
          ]).some((p) => p.includes('引用册指针不在场'))) {
            problems.push('反向构造判别力缺失（平台事实: 抽掉引用册指针未被判违规）');
          }
        }
      }
      if (problems.length > 0) throw new Error('技能文本锁（纪律判别句式族）不符: ' + problems.join('; '));
    },
  },

  // 184d: 三块归一处（ADR-016）——pathspec / 集成纪律归 `reference/commit-discipline.md`、四属性
  // 契约归入口册与平台事实册；「要点句在场 + 权威处唯一 + 判别句不再要求两册逐字一致」。
  {
    name: '184d 技能文本锁：三块归一处与委托契约纪律要点句',
    run: () => {
      const problems = [];
      // —— ⑥ 三块归一处（ADR-016）：原「两册三块逐字一致（切片 ≥400 字符）+ 两册各持 41 条判别句」
      // 的逐字锁**作废**，改为「两册各自的要点句在场 + 权威处唯一 + 留正文的判别句逐句留原文但
      // **不再要求两册相同**」。归一处：pathspec 与集成 → `reference/commit-discipline.md` 全文；
      // 四属性契约 → 入口册 + `reference/platform-facts.md`。判别句按性质分流：属「该怎么干」的
      // 留两册正文（外部原则：非显然的坑留正文），属「证据与判级」的随平台事实移走。
      {
        const bookTexts = new Map([
          ['flow-comet-subagent-execute/SKILL.md', fs.readFileSync(path.join(SCRIPTS_DIR, '..', '..', 'flow-comet-subagent-execute', 'SKILL.md'), 'utf8')],
          ['flow-comet-execute/SKILL.md', fs.readFileSync(path.join(SCRIPTS_DIR, '..', '..', 'flow-comet-execute', 'SKILL.md'), 'utf8')],
        ]);
        const commitDisciplineText = fs.readFileSync(
          path.join(SCRIPTS_DIR, '..', 'reference', 'commit-discipline.md'), 'utf8');
        const elementDocs = new Map([...bookTexts, [COMMIT_DISCIPLINE_REL, commitDisciplineText]]);
        const authorityTexts = new Map([
          [COMMIT_DISCIPLINE_REL, commitDisciplineText],
          [PLATFORM_FACTS_REL, fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'reference', 'platform-facts.md'), 'utf8')],
          ['flow-comet/SKILL.md', fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'SKILL.md'), 'utf8')],
        ]);
        const disciplineSources = { books: bookTexts, elementDocs, authorityTexts };
        problems.push(...delegationDisciplineProblems(disciplineSources));
        // 反向构造（同一判据驱动）：逐条抽掉 ⇒ 必报；逐条回流 ⇒ 必报。判别力不依赖人工实验：
        // 要素级 token / 权威处判别句 / 能力契约判别句 / 条件句指针 / 证据与判级判别句五组各取全量。
        const subRel = 'flow-comet-subagent-execute/SKILL.md';
        const exRel = 'flow-comet-execute/SKILL.md';
        const strip = (text, phrase) => text.split(phrase).join('（反向构造：抽掉）');
        const withBook = (rel, text) => ({ ...disciplineSources, books: new Map(bookTexts).set(rel, text) });
        const withElementDoc = (rel, text) => ({ ...disciplineSources, elementDocs: new Map(elementDocs).set(rel, text) });
        const withAuthority = (rel, text) => ({ ...disciplineSources, authorityTexts: new Map(authorityTexts).set(rel, text) });
        for (const [label, tokens] of COMMIT_DISCIPLINE_ELEMENT_GROUPS) {
          const stripped = strip(elementDocs.get(subRel), tokens[0]);
          if (stripped === elementDocs.get(subRel)) continue;
          if (!delegationDisciplineProblems(withElementDoc(subRel, stripped)).some((p) => p.includes(label))) {
            problems.push('反向构造判别力缺失（' + label + ' 的要点 token 被抽掉未被判缺）');
          }
        }
        for (const phrase of COMMIT_DISCIPLINE_AUTHORITY_PHRASES) {
          if (!commitDisciplineText.includes(phrase)) continue; // 缺失已由真实判据报告
          if (!delegationDisciplineProblems(withAuthority(COMMIT_DISCIPLINE_REL, strip(commitDisciplineText, phrase)))
            .some((p) => p.includes(phrase.slice(0, 40)))) {
            problems.push('反向构造判别力缺失（抽掉 ' + COMMIT_DISCIPLINE_REL + ' 权威处判别句未被判缺）: '
              + phrase.slice(0, 40) + '…');
          }
          if (!delegationDisciplineProblems(withBook(subRel, bookTexts.get(subRel) + '\n' + phrase + '\n'))
            .some((p) => p.includes('回流了'))) {
            problems.push('反向构造判别力缺失（权威处正文回流册子未被判违规）: ' + phrase.slice(0, 40) + '…');
          }
        }
        for (const phrase of PARALLEL_CONTRACT_BOOK_PHRASES) {
          if (!bookTexts.get(exRel).includes(phrase)) continue;
          if (!delegationDisciplineProblems(withBook(exRel, strip(bookTexts.get(exRel), phrase)))
            .some((p) => p.includes(phrase.slice(0, 40)))) {
            problems.push('反向构造判别力缺失（抽掉四属性契约判别句未被判缺）: ' + phrase.slice(0, 40) + '…');
          }
        }
        for (const pointer of DELEGATION_POINTER_RELS) {
          const stripped = bookTexts.get(subRel).split(pointer).join('（反向构造：抽掉指针）');
          if (!delegationDisciplineProblems(withBook(subRel, stripped)).some((p) => p.includes('指针不在场'))) {
            problems.push('反向构造判别力缺失（抽掉条件句指针未被判违规）: ' + pointer);
          }
        }
        for (const phrase of CONTRACT_EVIDENCE_AUTHORITY_PHRASES) {
          if (!authorityTexts.get(PLATFORM_FACTS_REL).includes(phrase)) continue;
          if (!delegationDisciplineProblems(withAuthority(PLATFORM_FACTS_REL,
            strip(authorityTexts.get(PLATFORM_FACTS_REL), phrase))).some((p) => p.includes(phrase.slice(0, 40)))) {
            problems.push('反向构造判别力缺失（抽掉证据与判级判别句未被判缺）: ' + phrase.slice(0, 40) + '…');
          }
          if (!delegationDisciplineProblems(withBook(subRel, bookTexts.get(subRel) + '\n' + phrase + '\n'))
            .some((p) => p.includes('回流了证据与判级判别句'))) {
            problems.push('反向构造判别力缺失（证据与判级判别句回流册子未被判违规）: ' + phrase.slice(0, 40) + '…');
          }
        }
        // 旧表述零残留（原文语义与失败消息保持）：无条件 worktree 口号只允许以「已作废」的被反驳
        // 形态出现；「未获机制明文放行」现状表述一律清零（集成纪律已成文）。配逐条反向构造。
        const staleResidueProblems = (rel, text) => {
          const out = [];
          if (text.split('「一律 worktree」的口号已作废').join('').includes('一律 worktree')) {
            out.push(rel + ' 残留无条件 worktree 口号（非被反驳形态）');
          }
          if (text.includes('未获机制明文放行')) {
            out.push(rel + ' 残留「未获机制明文放行」现状表述（集成纪律已成文）');
          }
          return out;
        };
        for (const [rel, text] of bookTexts) {
          problems.push(...staleResidueProblems(rel, text));
          const revertedSlogan = text.split('「一律 worktree」的口号已作废').join('一律 worktree 是必须的');
          if (!staleResidueProblems(rel, revertedSlogan).some((p) => p.includes('无条件 worktree 口号'))) {
            problems.push(rel + ' 反向构造判别力缺失（还原无条件 worktree 口号未被判违规）');
          }
          const revertedStatus = text + '\n未获机制明文放行。\n';
          if (!staleResidueProblems(rel, revertedStatus).some((p) => p.includes('未获机制明文放行'))) {
            problems.push(rel + ' 反向构造判别力缺失（还原现状表述未被判违规）');
          }
        }
        // —— ⑦ CC 行判级升格 + 三平台 cwd 语义对照（真机实测落地）——重定向后判据 = 「权威处
        // 正文在场 + 各引用册指针在场 + **仅两处承载**」：入口册的 7 条字面量是**能力契约锚**（本
        // 批明文保留），原 `reference/worktree-notes.md` 的 6 条整句随文件移出技能树而改锚到
        // `reference/platform-facts.md`（T07 逐字搬入）；两组文本都不得散进其余册（唯一处 = 入口册
        // + 平台事实册）。锚一律取**段内独有判别句式**（裸子串会被同文件其它上下文满足而恒真——
        // ）；cwd 对照表**逐行有锚**（三行各自独立，缺任一行即判残缺）；旧「未覆盖」判级句零残留。
        const entrySkillText = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'SKILL.md'), 'utf8');
        const platformFactsText = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'reference', 'platform-facts.md'), 'utf8');
        const otherBooks = new Map([
          ['flow-comet-subagent-execute/SKILL.md', bookTexts.get('flow-comet-subagent-execute/SKILL.md')],
          ['flow-comet-execute/SKILL.md', bookTexts.get('flow-comet-execute/SKILL.md')],
        ]);
        for (const [, file] of skillTreeDocFiles()) {
          const rel = path.relative(path.join(SCRIPTS_DIR, '..', '..'), file).replaceAll('\\', '/');
          if (rel === 'flow-comet/SKILL.md' || rel === 'flow-comet/reference/platform-facts.md') continue;
          if (otherBooks.has(rel)) continue;
          otherBooks.set(rel, fs.readFileSync(file, 'utf8'));
        }
        const upgradeSources = { entry: entrySkillText, facts: platformFactsText, others: otherBooks };
        problems.push(...identityUpgradeProblems(upgradeSources));
        // 反向构造（同一判据驱动）：① 权威处 / 入口册逐句抽掉 ⇒ 必报该句缺失；② 把整句复制进
        // 其余任一册 ⇒ 必报「回流」（唯一处的方向——原两处锁**要求**多份，抓不到散播）；③ 旧判级
        // 句还原 ⇒ 必报残留。
        for (const [side, phrase] of [
          ...IDENTITY_UPGRADE_ENTRY_PHRASES.map((p) => ['entry', p]),
          ...IDENTITY_UPGRADE_AUTHORITY_PHRASES.map((p) => ['facts', p]),
        ]) {
          const source = side === 'entry' ? entrySkillText : platformFactsText;
          if (!source.includes(phrase)) continue; // 缺失已由真实判据报告
          const stripped = identityUpgradeProblems({
            ...upgradeSources, [side]: source.split(phrase).join('（反向构造：抽掉）'),
          });
          if (!stripped.some((p) => p.includes(phrase.slice(0, 40)))) {
            problems.push('反向构造判别力缺失（抽掉「CC 行升格 / 三平台 cwd 对照」判别句未被判缺）: '
              + phrase.slice(0, 40) + '…');
          }
        }
        const injectedBookRel = 'flow-comet-subagent-execute/SKILL.md';
        for (const phrase of [...IDENTITY_UPGRADE_ENTRY_PHRASES, ...IDENTITY_UPGRADE_AUTHORITY_PHRASES]) {
          const injected = identityUpgradeProblems({
            ...upgradeSources,
            others: new Map(otherBooks).set(injectedBookRel, otherBooks.get(injectedBookRel) + '\n' + phrase + '\n'),
          });
          if (!injected.some((p) => p.includes('回流'))) {
            problems.push('反向构造判别力缺失（cwd 对照 / CC 判级句散进其余册未被判违规）: ' + phrase.slice(0, 40) + '…');
          }
        }
        for (const stale of IDENTITY_UPGRADE_STALE_PHRASES) {
          const revertedUpgrade = identityUpgradeProblems({
            ...upgradeSources,
            entry: entrySkillText + '\n' + stale + '。\n',
            facts: platformFactsText + '\n' + stale + '。\n',
          });
          if (!revertedUpgrade.some((p) => p.includes('旧「未覆盖」判级表述'))) {
            problems.push('反向构造判别力缺失（还原旧「未覆盖」判级句未被判残留）: ' + stale);
          }
        }
        // —— 文本 ↔ 实现一致锚：文本点名的实现常量 / 载荷键名 / 受保护目标必须与引擎同值 ——
        const guardSrc = fs.readFileSync(path.join(SCRIPTS_DIR, 'comet-hook-guard.mjs'), 'utf8');
        // 桥接源位于**仓库根** scripts/（分发面脚本，非技能包内）——安装副本形态（目标项目）该面
        // 结构性缺席：缺席时该侧锚不适用，但必须**显式可见**（未验证 ≠ 通过），不得静默跳过。
        const bridgePath = path.join(REPO_ROOT, 'scripts', 'dsh-bridge.mjs');
        const bridgeSrc = fs.existsSync(bridgePath) ? fs.readFileSync(bridgePath, 'utf8') : null;
        if (bridgeSrc === null) {
          console.log('SKIP: 184 的桥接侧一致锚（仓库根 scripts/dsh-bridge.mjs 为权威源检出面）'
            + '——本次未校验「文本点名的身份透传变量与桥接注入处同值」，请在权威源检出重跑本套件');
        }
        const stateSchemaSrc = fs.readFileSync(path.join(SCRIPTS_DIR, 'state-schema.mjs'), 'utf8');
        const handoffSrc = fs.readFileSync(path.join(SCRIPTS_DIR, 'workflow-handoff.mjs'), 'utf8');
        // 出口校验（节点门禁）脚本的另一册：在飞委托判据落在 workflow-guard.mjs（hook 守卫只做写入
        // 拦截，两者同包不同册）——撤回留痕被判据消费这一条须在**该**源上核对。
        const workflowGuardSrc = fs.readFileSync(path.join(SCRIPTS_DIR, 'workflow-guard.mjs'), 'utf8');
        // 一致性判据（单一实现：真实判据与反向构造探针共用本函数）。
        const consistencyProblems = ({ guard, bridge, schema, handoff, workflowGuard, books }) => {
          const out = [];
          // ① 身份判据的载荷键：文本声称判据 = agent_id；引擎身份判据段必须读取该键。
          const regionStart = guard.indexOf('function payloadAgentIdentity');
          const regionEnd = guard.indexOf('const __dirname');
          if (regionStart < 0 || regionEnd <= regionStart) {
            out.push('comet-hook-guard.mjs 未找到身份判据段（文本与实现无法对照）');
          } else {
            const identityRegion = guard.slice(regionStart, regionEnd);
            if (!identityRegion.includes('input.agent_id')) {
              out.push('身份判据段未读取载荷 agent_id（文本声称的判据键与实现不一致）');
            }
            // ② agent_type 只是载荷形态描述、不是判据：身份判据段零使用（文本与实现逐字一致）。
            if (identityRegion.includes('agent_type')) {
              out.push('身份判据段使用了 agent_type（文本声称判据 = agent_id，二者不一致）');
            }
          }
          // ③ 身份透传的环境变量名单一：守卫读取处与桥接注入处同值（文本两侧同值）。
          if (!guard.includes('process.env.FLOW_COMET_AGENT_DEPTH')) {
            out.push('守卫未读取环境变量身份深度（与文本 / 桥接不一致）');
          }
          if (bridge === null) {
            // 结构性缺席（安装副本形态无仓库根 scripts/）：该侧锚不适用——可见 SKIP 由场景主体输出，
            // 此处不判违规也不静默当通过（未验证 ≠ 通过）。
          } else if (!bridge.includes('FLOW_COMET_AGENT_DEPTH')) {
            out.push('桥接未透传环境变量身份深度（与文本 / 守卫不一致）');
          }
          // ③b 桥接通道标记的名单一与值单一（env 面身份的作用域收紧）：守卫读取处、守卫判据常量、
          //     桥接注入处三处同值；缺任一处即「文本声称需标记自证、实现却直接认深度」的分叉。
          //     文本侧的判据由两册同锁块承载（见上方 contractLockPhrases 的标记判别句）。
          if (!guard.includes('process.env.FLOW_COMET_AGENT_DEPTH_SOURCE')) {
            out.push('守卫未读取桥接通道标记（env 面身份的作用域收紧无实现承载）');
          }
          if (!guard.includes("BRIDGE_DEPTH_CHANNEL_MARKER = 'dsh-bridge'")) {
            out.push('守卫缺桥接通道标记的判据常量（标记值无单一来源）');
          }
          if (bridge === null) {
            // 同上：安装副本形态无仓库根 scripts/，该侧锚不适用。
          } else if (!/FLOW_COMET_AGENT_DEPTH_SOURCE:\s*'dsh-bridge'/.test(bridge)) {
            out.push('桥接未注入桥接通道标记 ' + "'dsh-bridge'" + '（守卫要求标记在场，桥接不注入即通道失效）');
          }
          // ③c 撤回留痕的字段名与判据落点：文本点名的两个字段由单一实现判定，且守卫的在飞判据
          //     必须消费该实现（缺一即「文本说撤回可放行、实现仍按在飞拦」）。
          if (!schema.includes('withdrawnAt') || !schema.includes('withdrawnBy')) {
            out.push('撤回留痕字段名未落在单一判据实现（与文本声称的 withdrawnAt / withdrawnBy 不一致）');
          }
          if (!/handoffRequestWithdrawn\(requests\[taskId\]\)/.test(workflowGuard)) {
            out.push('在飞委托判据未消费撤回留痕判据（撤回的 request 仍会被计为在飞）');
          }
          // ④ 最小保护集的两个目标：实现侧取值来源（状态文件路径常量 + 协议解析结果）与文本字面同值。
          if (!schema.includes("RUNTIME_DIR = '.flow-comet'")
            || !schema.includes("RUNTIME_STATE_FILE_NAME = 'flow-comet-state.json'")) {
            out.push('状态文件路径常量与文本声称的受保护目标不一致');
          }
          if (!guard.includes('blockedStateFileTarget') || !guard.includes('blockedProtocolFileTarget')) {
            out.push('守卫缺最小保护集判定入口（文本声称的两个受保护目标无实现承载）');
          }
          // ⑤ 留痕字段与落点：文本点名的既有字段 = 实现写入的嵌套键（零新增 state 顶层字段）。
          if (!handoff.includes("state.evidence['subagent-execute'].handoffRequests")) {
            out.push('留痕未落在嵌套证据（与文本声称的同族嵌套形态不一致）');
          }
          // ⑥ 零提交资格字段与落库形态：文本声称「提交隔离走既有 noCommit 资格」——实现必须在
          //    request 侧真实记录该字段（文本说 A、实现说 B 即红）。
          if (!handoff.includes('noCommit: true')) {
            out.push('零提交资格落库形态与文本声称的 request 记录不一致（缺 noCommit: true）');
          }
          for (const [rel, text] of books) {
            if (!text.includes('.flow-comet/flow-comet-state.json')) {
              out.push(rel + ' 缺最小保护集目标字面（机器状态文件）');
            }
            if (!text.includes('reference/workflow-protocol.json')) {
              out.push(rel + ' 缺最小保护集目标字面（协议保护路径）');
            }
            if (!text.includes('handoffRequests') || !text.includes('handoffResult')) {
              out.push(rel + ' 缺留痕字段名（handoffRequests / handoffResult）');
            }
            if (!text.includes('noCommit')) {
              out.push(rel + ' 缺零提交资格字段名（noCommit）');
            }
            // 桥接通道标记名（env 面身份的作用域收紧）：两册文本须点名标记本身——只说「env 透传
            // 深度」会让读者以为继承来的深度变量也能当身份用（正是收紧前的缺口表述）。
            if (!text.includes('FLOW_COMET_AGENT_DEPTH_SOURCE')) {
              out.push(rel + ' 缺桥接通道标记名（文本声称 env 面身份需标记自证，却未点名标记）');
            }
          }
          return out;
        };
        const consistencySources = { guard: guardSrc, bridge: bridgeSrc, schema: stateSchemaSrc, handoff: handoffSrc, workflowGuard: workflowGuardSrc, books: bookTexts };
        problems.push(...consistencyProblems(consistencySources));
        // 反向构造（同一判据驱动）：逐项把实现侧常量改成与文本不同的值 ⇒ 必报（文本说 A、实现说 B 即红）。
        const consistencyProbes = [
          ['载荷键改名', { guard: guardSrc.replace('input.agent_id', 'input.agentId') }, 'agent_id'],
          ['agent_type 混入判据段', {
            guard: guardSrc.replace('function payloadAgentIdentity',
              "function payloadAgentIdentity(input) { const probe = input.agent_type;\n"),
          }, 'agent_type'],
          ['环境变量改名', { guard: guardSrc.replaceAll('FLOW_COMET_AGENT_DEPTH', 'FLOW_COMET_DEPTH') }, '环境变量身份深度'],
          // 桥接通道标记（env 面身份的作用域收紧）与撤回通道：逐项抽掉实现侧或文本侧的承载 ⇒ 必报。
          ['桥接标记读取抽掉', { guard: guardSrc.replaceAll('process.env.FLOW_COMET_AGENT_DEPTH_SOURCE', 'process.env.FLOW_COMET_DEPTH_SOURCE') }, '桥接通道标记'],
          ['桥接标记判据常量改名', { guard: guardSrc.replace("BRIDGE_DEPTH_CHANNEL_MARKER = 'dsh-bridge'", "BRIDGE_DEPTH_CHANNEL_MARKER = 'bridge'") }, '标记值无单一来源'],
          // 桥接源在安装副本形态结构性缺席（见上方 SKIP 行）：该探针不构造——未验证 ≠ 通过，
          // 由 SKIP 行显式声明；不构造也不得让整块判据崩掉（缺席面不得变成套件错误）。
          ...(bridgeSrc === null ? [] : [['桥接注入标记值漂移', { bridge: bridgeSrc.replaceAll("FLOW_COMET_AGENT_DEPTH_SOURCE: 'dsh-bridge'", "FLOW_COMET_AGENT_DEPTH_SOURCE: 'other'") }, '桥接未注入桥接通道标记']]),
          ['撤回留痕字段改名', { schema: stateSchemaSrc.replaceAll('withdrawnBy', 'cancelledBy') }, '撤回留痕字段名未落在单一判据实现'],
          ['在飞判据不消费撤回留痕', { workflowGuard: workflowGuardSrc.replace('handoffRequestWithdrawn(requests[taskId])', 'false') }, '在飞委托判据未消费撤回留痕判据'],
          ['文本侧桥接标记名缺失', { books: new Map([...bookTexts].map(([rel, text]) => [rel, text.split('FLOW_COMET_AGENT_DEPTH_SOURCE').join('（反向构造：抽掉）')])) }, '桥接通道标记名'],
          ['状态文件路径常量改名', { schema: stateSchemaSrc.replace("RUNTIME_STATE_FILE_NAME = 'flow-comet-state.json'", "RUNTIME_STATE_FILE_NAME = 'state.json'") }, '状态文件路径常量'],
          ['留痕落点改顶层', { handoff: handoffSrc.replaceAll("state.evidence['subagent-execute'].handoffRequests", 'state.handoffRequests') }, '留痕未落在嵌套证据'],
          ['零提交落库形态改名', { handoff: handoffSrc.replaceAll('noCommit: true', 'zeroCommitFlag: true') }, '零提交资格落库形态'],
          ['文本侧目标字面缺失', { books: new Map([...bookTexts].map(([rel, text]) => [rel, text.split('.flow-comet/flow-comet-state.json').join('（反向构造：抽掉）')])) }, '机器状态文件'],
          ['文本侧零提交字段缺失', { books: new Map([...bookTexts].map(([rel, text]) => [rel, text.split('noCommit').join('（反向构造：抽掉）')])) }, '零提交资格字段名'],
        ];
        for (const [probeLabel, override, expected] of consistencyProbes) {
          const probed = { ...consistencySources, ...override };
          if (!consistencyProblems(probed).some((p) => p.includes(expected))) {
            problems.push('反向构造判别力缺失（' + probeLabel + ' 未被判不一致）');
          }
        }
      }
      if (problems.length > 0) throw new Error('技能文本锁（三块归一处族）不符: ' + problems.join('; '));
    },
  },

  // 184e: 文本 ↔ 实现一致族——7 字段集合锚（枚举自 `workflow-guard.mjs` 的 `TASK7_REQUIRED`
  // 常量派生后逐处对账）+ 公开面口径机检（公开机制册判级一致 / 变更日志条目带编号 PR 链接 /
  // 已关闭缺口与建树适用面成文；公开面缺席时输出可见 SKIP）。
  {
    name: '184e 技能文本锁：7 字段集合文本↔实现一致 + 公开面口径机检',
    run: () => {
      const problems = [];
      // —— 7 字段集合的文本 ↔ 实现一致锚（文本不得说谎的**根治**面：任一处枚举分叉即红）——
      // 判据与反向构造探针见模块级 `task7SetAnchorProblems`（单一实现）：唯一权威 = `workflow-guard.mjs`
      // 的 `TASK7_REQUIRED` 常量（plan 出口判据的集合来源），技能树侧枚举**从该常量派生**后逐处对账——
      // 锚里不写第二份集合（第二份同口径表达会在判据演进时分叉）；覆盖双语形态与斜杠
      // 枚举形态，同批固化「文案落后于判据」静默面（两处 BLOCKED 文案从判据常量派生）。反向构造：
      // 任一处枚举改字段名（depends_on → id）/ 抽掉整处枚举 / 常量侧改名 / 文案回写字面集合 ⇒ 必红。
      problems.push(...task7SetAnchorProblems({
        guardSrc: fs.readFileSync(path.join(SCRIPTS_DIR, 'workflow-guard.mjs'), 'utf8'),
        stateSrc: fs.readFileSync(path.join(SCRIPTS_DIR, 'workflow-state.mjs'), 'utf8'),
        docs: new Map(skillTreeDocFiles().map(([rel, file]) => [rel, fs.readFileSync(file, 'utf8')])),
      }));
      // —— 公开面口径机检（文档不说假话）：公开机制册的判级须与技能册一致、公开变更日志的新增
      //    条目须带**编号** PR 链接、技能册的已关闭缺口与建树适用面须写成本文。三面各自可判，
      //    并配反向构造（抽掉新表述 / 还原旧表述 ⇒ 必报）。公开面在安装副本形态结构性缺席：
      //    缺席时输出可见 SKIP（未验证 ≠ 通过），不得静默当通过。
      {
        const publicDocRelPaths = ['docs/MECHANISM.md', 'docs/MECHANISM-zh.md', 'CHANGELOG.md', 'CHANGELOG-zh.md'];
        const publicDocs = new Map(publicDocRelPaths.map((rel) => {
          const abs = path.join(REPO_ROOT, rel);
          return [rel, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null];
        }));
        const missingDocFaces = [...publicDocs].filter(([, text]) => text === null).map(([rel]) => rel);
        if (missingDocFaces.length > 0) {
          console.log('SKIP: 184 的公开面口径锚（' + missingDocFaces.join(', ') + '）——本次检出无该公开文档面，'
            + '未校验「公开机制册判级与技能册一致 / 变更日志新增条目链接带编号 / 建树适用面成文」，请在权威源检出重跑本套件');
        }
        const subagentFaceText = fs.readFileSync(
          path.join(SCRIPTS_DIR, '..', '..', 'flow-comet-subagent-execute', 'SKILL.md'), 'utf8');
        const entryFaceText = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'SKILL.md'), 'utf8');
        // 第三面随 `worktree-notes.md` 移出技能树改读 `reference/platform-facts.md`（判别句新落点）。
        const factsFaceText = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'reference', 'platform-facts.md'), 'utf8');
        const treeScopeSentence = '**建树选择的适用面**';
        const treeBypassSentence = '**以建树绕过边界**不受支持';
        const staleTreeBan = '手工 `git worktree add <任意路径>` **不是受支持路径**';
        const gapClosureSentence = '该缺口现已被守卫关闭';
        // 公开变更日志的段切片（止于下一个版本标题）。
        const sectionAt = (text, start) => {
          const next = text.indexOf('\n## [', start + 1);
          return text.slice(start, next < 0 ? text.length : next);
        };
        const unreleasedSectionOf = (text) => {
          const start = text.indexOf('## [Unreleased]');
          return start < 0 ? null : sectionAt(text, start);
        };
        // 「最新条目段」（判据与反向构造共用同一切片，单一实现）：dev 态新增条目在 `## [Unreleased]`；
        // 发布结算把条目移入最新版本段、Unreleased 只留空标题——这是仓库既有发布形态（`v1.6.2` tag 即
        // 「空 Unreleased + 版本段」，`v1.6.1` tag 甚至无 Unreleased 段）。只切 Unreleased 段的实现
        // 在发布态必然失配，故：Unreleased 段有条目则取之，否则回退到最新版本段。
        const newestEntriesSectionOf = (text) => {
          const unreleased = unreleasedSectionOf(text);
          if (unreleased !== null && /^- /m.test(unreleased)) return unreleased;
          const versioned = text.search(/^## \[\d+\.\d+\.\d+/m);
          if (versioned >= 0) return sectionAt(text, versioned);
          return unreleased;
        };
        // 一致性判据（单一实现：真实判据与反向构造探针共用本函数）。
        const publicFaceProblems = ({ mechanism, mechanismZh, changelog, changelogZh, subagentBook, entryBook, factsBook }) => {
          const out = [];
          // 公开机制册双语判级：CC 行「证实 + 限定形态」，未覆盖项照旧标注，旧判级句零残留。
          const gradeCases = [
            ['docs/MECHANISM.md', mechanism,
              'payload `agent_id` / `agent_type` — **verified**, in a stated shape only',
              ['`agent_type`', 'nested delegations', 'non-Windows environments', 'remain uncovered'],
              'payload `agent_id` — **not yet covered**'],
            ['docs/MECHANISM-zh.md', mechanismZh,
              '载荷 `agent_id` / `agent_type`——**证实**，且**限定形态**',
              ['`agent_type` 取值域', '嵌套委派载荷', '非 Windows 环境', '仍未覆盖'],
              '载荷 `agent_id`——真机会话**尚未覆盖**'],
          ];
          for (const [rel, text, phrase, keep, stale] of gradeCases) {
            if (text === null) continue;
            if (!text.includes(phrase)) out.push(rel + ' 未把 CC 身份通道标为证实（缺判别句：' + phrase.slice(0, 30) + '…）');
            for (const item of keep) {
              if (!text.includes(item)) out.push(rel + ' 判级升格时丢了限定形态 / 未覆盖项（缺「' + item + '」）');
            }
            if (text.includes(stale)) out.push(rel + ' 残留旧判级表述「' + stale + '」');
          }
          // 公开变更日志：最新条目段的条目数与**条目行内**带编号 PR 链接数一致，且不得有空链接。
          // 计数面限定在条目行——版本段的摘要行另按惯例携带 PR 链接，段级计数会把摘要行读成条目失配。
          for (const [rel, text] of [['CHANGELOG.md', changelog], ['CHANGELOG-zh.md', changelogZh]]) {
            if (text === null) continue;
            const section = newestEntriesSectionOf(text);
            if (section === null) { out.push(rel + ' 缺 Unreleased 段与版本段（新增条目无处登记）'); continue; }
            const entryLines = section.split('\n').filter((line) => line.startsWith('- '));
            const entries = entryLines.length;
            const numbered = entryLines.reduce((n, line) => n + (line.match(/\/pull\/\d+/g) ?? []).length, 0);
            const bare = entryLines.reduce((n, line) => n + (line.match(/\/pull\/\)/g) ?? []).length, 0);
            if (bare > 0) out.push(rel + ' 新增条目含空 PR 链接（pull/ 无编号）×' + bare);
            if (entries > 0 && numbered !== entries) {
              out.push(rel + ' 新增条目与带编号 PR 链接数不一致（条目 ' + entries + ' / 链接 ' + numbered + '）');
            }
          }
          // 已关闭缺口：**权威处**（`reference/platform-facts.md`）的陈旧注释须以「已关闭 + 当前判据」
          // 形态在场（边界陈述保留）；两册**不得**再持该证据段正文（随平台事实移走——回流即红）。
          const gapCases = [
            [PLATFORM_FACTS_REL, factsBook, ['**fail-open**', '**未闭合**', '补丁体按行语义解析出']],
          ];
          for (const [rel, text, keep] of gapCases) {
            if (text === null) continue;
            if (!text.includes(gapClosureSentence)) {
              out.push(rel + ' 未把已关闭的守卫缺口写成本文（缺「' + gapClosureSentence + '」——陈旧注释仍在描述现状）');
            }
            for (const item of keep) {
              if (!text.includes(item)) out.push(rel + ' 已关闭缺口的当前判据 / 边界陈述缺失（缺「' + item + '」）');
            }
          }
          for (const [rel, text] of [['flow-comet-subagent-execute/SKILL.md', subagentBook]]) {
            if (text === null) continue;
            if (text.includes(gapClosureSentence)) {
              out.push(rel + ' 回流了已关闭缺口的证据段正文（缺「' + gapClosureSentence + '」段的权威处唯一）');
            }
          }
          // 建树适用面：三处同写「显式建树受支持 / 以建树绕过边界不受支持」（能力契约锚，ADR-016 保留），
          // 旧一刀切禁令零残留。
          for (const [rel, text] of [
            ['flow-comet/SKILL.md', entryBook],
            ['flow-comet-subagent-execute/SKILL.md', subagentBook],
            [PLATFORM_FACTS_REL, factsBook],
          ]) {
            if (text === null) continue;
            if (!text.includes(treeScopeSentence)) out.push(rel + ' 未写清建树适用面（缺「' + treeScopeSentence + '」）');
            if (!text.includes(treeBypassSentence)) out.push(rel + ' 未写清绕过面边界（缺「' + treeBypassSentence + '」）');
            if (text.includes(staleTreeBan)) {
              out.push(rel + ' 残留一刀切禁令「' + staleTreeBan + '…」（与入口册平台通道表口径相反）');
            }
          }
          return out;
        };
        // 面缺席（安装副本形态）时的 null 安全改写：缺席面既无真实判据也无反向构造，
        // 由上方 SKIP 行显式声明未验证；探针循环再跳过含缺席面的探针（不静默当通过）。
        const patchText = (text, from, to) => (text === null ? null : text.split(from).join(to));
        const publicFaceSources = {
          mechanism: publicDocs.get('docs/MECHANISM.md'),
          mechanismZh: publicDocs.get('docs/MECHANISM-zh.md'),
          changelog: publicDocs.get('CHANGELOG.md'),
          changelogZh: publicDocs.get('CHANGELOG-zh.md'),
          subagentBook: subagentFaceText,
          entryBook: entryFaceText,
          factsBook: factsFaceText,
        };
        problems.push(...publicFaceProblems(publicFaceSources));
        // 反向构造（同一判据驱动）：逐项抽掉新表述 / 还原旧表述 ⇒ 必报该问题。
        const publicFaceProbes = [
          ['公开册判级回退', {
            mechanism: patchText(publicFaceSources.mechanism, 'payload `agent_id` / `agent_type` — **verified**, in a stated shape only', 'payload `agent_id` — **not yet covered** in a real session, in a stated shape only'),
            mechanismZh: patchText(publicFaceSources.mechanismZh, '载荷 `agent_id` / `agent_type`——**证实**，且**限定形态**', '载荷 `agent_id`——真机会话**尚未覆盖**，且**限定形态**'),
          }, '残留旧判级表述'],
          ['公开册限定形态抽掉', {
            mechanism: patchText(publicFaceSources.mechanism, 'nested delegations', 'REMOVED'),
            mechanismZh: patchText(publicFaceSources.mechanismZh, '嵌套委派载荷', 'REMOVED'),
          }, '丢了限定形态'],
          ['已关闭缺口注解抽掉', {
            factsBook: publicFaceSources.factsBook.split(gapClosureSentence).join('REMOVED'),
          }, '未把已关闭的守卫缺口写成本文'],
          ['已关闭缺口证据回流册子', {
            subagentBook: publicFaceSources.subagentBook + '\n' + gapClosureSentence + '：补丁体按行语义解析出。\n',
          }, '回流了已关闭缺口的证据段正文'],
          ['建树适用面句抽掉', {
            entryBook: publicFaceSources.entryBook.split(treeScopeSentence).join('REMOVED'),
            subagentBook: publicFaceSources.subagentBook.split(treeScopeSentence).join('REMOVED'),
            factsBook: publicFaceSources.factsBook.split(treeScopeSentence).join('REMOVED'),
          }, '未写清建树适用面'],
          ['旧一刀切禁令还原', {
            subagentBook: publicFaceSources.subagentBook + '\n' + staleTreeBan + '，不得作为绕过手段。\n',
          }, '残留一刀切禁令'],
        ];
        // 链接编号反向构造（**两面各自取目标、各自断言**）：目标数据驱动——取「最新条目段」条目行内第一处
        // `/pull/<编号>`，两面各按自己的取值抽掉编号，两面都须报出空链接。写死批次编号的实现会在结算把
        // 条目移入版本段后恒不命中（判别力静默归零），批次更替后同样过期；只取英文侧编号的实现会让中文侧
        // 的判据在编号分叉或回归时不被覆盖。
        // 公开面缺席（安装副本形态）时不做该探针——上方 SKIP 行已显式声明未验证，不在此另报。
        const newestEntryLinkOf = (text) => ((newestEntriesSectionOf(text) ?? '')
          .split('\n').filter((line) => line.startsWith('- ')).join('\n')
          .match(/\/pull\/\d+/) ?? [null])[0];
        const changelogFacesPresent = publicFaceSources.changelog !== null && publicFaceSources.changelogZh !== null;
        if (changelogFacesPresent) {
          const linkEn = newestEntryLinkOf(publicFaceSources.changelog);
          const linkZh = newestEntryLinkOf(publicFaceSources.changelogZh);
          if (linkEn === null || linkZh === null) {
            problems.push('公开面口径反向构造目标缺失：最新条目段内无带编号 PR 链接（无从反证，不表示为通过）');
          } else {
            const strippedProblems = publicFaceProblems({
              ...publicFaceSources,
              changelog: patchText(publicFaceSources.changelog, linkEn, '/pull/'),
              changelogZh: patchText(publicFaceSources.changelogZh, linkZh, '/pull/'),
            });
            for (const rel of ['CHANGELOG.md', 'CHANGELOG-zh.md']) {
              if (!strippedProblems.some((problem) => problem.startsWith(rel + ' 新增条目含空 PR 链接'))) {
                problems.push('公开面口径反向构造判别力缺失（变更日志链接编号抽掉：' + rel + ' 未被判违规）');
              }
            }
          }
        }
        for (const [probeLabel, override, expected] of publicFaceProbes) {
          const probed = { ...publicFaceSources, ...override };
          // 含缺席面的探针不执行（该面既无真实判据也无反向构造）——上方 SKIP 行已显式声明未验证。
          if (Object.values(probed).some((value) => value === null)) continue;
          if (!publicFaceProblems(probed).some((problem) => problem.includes(expected))) {
            problems.push('公开面口径反向构造判别力缺失（' + probeLabel + ' 未被判违规）');
          }
        }
        // 发布结算形态锚（本判据在发布态失配的回归锚）：把 dev 态变更日志改写成发布结算后的形态——
        // Unreleased 只留空标题、条目连同条目行内的 PR 链接落在最新版本段——判据须零问题，且链接编号
        // 反向构造在此形态下仍必报（只切 Unreleased 段 + 写死批次编号的实现在此形态下必红）。
        {
          const settled = (text) => {
            if (text === null) return null;
            const section = unreleasedSectionOf(text);
            if (section === null) return null;
            // 树本身已是发布态（Unreleased 无条目）时无从构造该转换：此时真实判据与数据驱动探针
            // 已直接覆盖发布态，本锚跳过（不静默当通过——覆盖由上方真实判据承担）。
            if (!/^- /m.test(section)) return null;
            const headingStart = text.indexOf('## [Unreleased]');
            const nextVersion = text.indexOf('\n## [', headingStart + 1);
            if (nextVersion < 0) return null;
            const body = section.slice(section.indexOf('\n') + 1).replace(/^\n+/, '');
            // 前缀止于 Unreleased 标题行末——条目**只**出现在合成的版本段下（前缀若带到条目，判据仍会
            // 选中 Unreleased 段，本锚就变成空转的恒真锚）。
            return text.slice(0, headingStart + '## [Unreleased]'.length)
              + '\n\n## [9.9.9] - 2099-01-01\n\nA release gathering the settled work.\n\n' + body
              + text.slice(nextVersion);
          };
          const settledSources = {
            ...publicFaceSources,
            changelog: settled(publicFaceSources.changelog),
            changelogZh: settled(publicFaceSources.changelogZh),
          };
          if (Object.values(settledSources).every((value) => value !== null)) {
            // 构造自证：合成后 Unreleased 段须为空、最新条目段须是合成的版本段——否则本锚没有真正构造
            // 出发布形态（静默空转），直接判红。
            for (const [rel, text] of [['CHANGELOG.md', settledSources.changelog], ['CHANGELOG-zh.md', settledSources.changelogZh]]) {
              if (/^- /m.test(unreleasedSectionOf(text) ?? '')) {
                problems.push('发布结算形态锚构造失效（' + rel + '）：合成后 Unreleased 段仍带条目，未真正构造发布形态');
              }
              if (!/^## \[9\.9\.9\]/m.test(newestEntriesSectionOf(text) ?? '')) {
                problems.push('发布结算形态锚构造失效（' + rel + '）：最新条目段未回退到合成的版本段');
              }
            }
            const settledProblems = publicFaceProblems(settledSources);
            if (settledProblems.length > 0) {
              problems.push('发布结算形态（Unreleased 空标题 + 条目在最新版本段）下判据误报: ' + settledProblems.join('; '));
            }
            const settledLinkEn = newestEntryLinkOf(settledSources.changelog);
            const settledLinkZh = newestEntryLinkOf(settledSources.changelogZh);
            if (settledLinkEn === null || settledLinkZh === null) {
              problems.push('发布结算形态下链接编号反向构造目标缺失：最新条目段内无带编号 PR 链接');
            } else {
              const reversedProblems = publicFaceProblems({
                ...settledSources,
                changelog: patchText(settledSources.changelog, settledLinkEn, '/pull/'),
                changelogZh: patchText(settledSources.changelogZh, settledLinkZh, '/pull/'),
              });
              for (const rel of ['CHANGELOG.md', 'CHANGELOG-zh.md']) {
                if (!reversedProblems.some((problem) => problem.startsWith(rel + ' 新增条目含空 PR 链接'))) {
                  problems.push('发布结算形态下链接编号反向构造判别力缺失（抽掉条目行内编号：' + rel + ' 未被判违规）');
                }
              }
            }
          }
        }
      }
      if (problems.length > 0) throw new Error('技能文本混排合法化语义不符: ' + problems.join('; '));
    },
  },
];
