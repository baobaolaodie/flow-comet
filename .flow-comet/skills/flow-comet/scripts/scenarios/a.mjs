// 场景组 a — 节点门禁 · 分支模式 · 归档与上下文警告 · 自定义协议
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
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
  SCRIPTS_DIR,
  TASK_DONE,
  TASK_P1,
  TASK_P2,
  composeState,
  engineScriptFiles,
  handoffFor,
  strictSummary,
  summaryContent,
  timeUtilsModule,
  writeCustomProtocol,
} from '../lib/test-fixtures.mjs';
import {
  assertStateBytesUnchanged,
  readStateBytes,
} from '../lib/test-assertions.mjs';

export const ENTRIES = [
  // 1: open exit 通过（模板段名 CHANGE "## Why（为什么做）" + REQUIREMENT "## 用户故事（User Story）" + 验收段）——带模板验证 C2 派生
  {
    name: '01 open exit 通过（模板段名）',
    run: (dir) => {
      writeFile(dir, 'flow-kit/templates/CHANGE.md', '# CHANGE 模板\n\n## Why（为什么做）\n## 范围（Scope）\n');
      writeFile(dir, 'flow-kit/templates/REQUIREMENT.md', '# REQUIREMENT 模板\n\n## 用户故事（User Story）\n## 验收准则（AC）\n## 非目标（Non-Goals）\n');
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 2: open exit BLOCKED——CHANGE.md 缺 Why 段
  {
    name: '02 open exit BLOCKED：CHANGE 缺 Why 段',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## 变更目标\n\n## 方案\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'CHANGE.md 缺必填段');
    },
  },

  // 3: open exit BLOCKED——REQUIREMENT.md 缺验收段（且无 Given 豁免）
  {
    name: '03 open exit BLOCKED：REQUIREMENT 缺验收段',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 需求分析\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '缺少验收标准');
    },
  },

  // 4: design exit 通过（## 0. + ## 1. 决策清单）——带模板，段名 "## 1. 技术决策清单" 只有模板派生能匹配（fallback 不匹配）
  {
    name: '04 design exit 通过（模板派生 技术决策清单）',
    run: (dir) => {
      writeFile(dir, 'flow-kit/templates/DESIGN.md', '# DESIGN 模板\n\n## 0. 技术栈选型\n## 1. 技术决策清单\n## 2. 数据流\n');
      const st = baseState('design');
      st.evidence.design = { summary: 'design done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈选型\n\n## 1. 技术决策清单\n');
      const res = runGuard(['exit', 'design'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 5: design exit BLOCKED——缺 ## 决策清单 段
  {
    name: '05 design exit BLOCKED：缺决策清单',
    run: (dir) => {
      const st = baseState('design');
      st.evidence.design = { summary: 'design done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      const res = runGuard(['exit', 'design'], dir);
      assertExit(res, 1);
      assertOut(res, '决策清单');
    },
  },

  // 6: plan exit 通过（task 块 + verify 字段）
  {
    name: '06 plan exit 通过（task 块 + verify）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 7: plan exit BLOCKED——无 <task> 块
  {
    name: '07 plan exit BLOCKED：无 task 块',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n（无任务块）\n');
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '无 <task> 块');
    },
  },

  // 8: execute exit 通过（enter 记录 taskHash + SUMMARY 六段 + 6 维实质 + 自检方法 + handoff 齐 + TASK 全 done）
  {
    name: '08 execute exit 通过（enter 后未改 TASK，签名匹配）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      // enter 时脚本自动记录 taskHash（写回 state）
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // exit 前补 SUMMARY + handoff（不碰 TASK.md）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      // 变体:自检方法段名带括号后缀(执行者按模板标题原样书写,如 "## 自检方法（声明 brooks-review 或 builtin-quickcheck）")
      // → 段名识别放宽后通过,无"旧格式"兼容 WARN
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法（声明 brooks-review 或 builtin-quickcheck）\n\nbrooks-review',
      }));
      const resVariant = runGuard(['exit', 'execute'], dir);
      assertExit(resVariant, 0);
      assertOut(resVariant, 'ALL CHECKS PASSED');
      assertNotOut(resVariant, 'BROOKS-LINT WARN');
      // 变体负例:段名匹配(含括号后缀,但括号说明不含方法词)且段内无自检方法声明
      // → 缺自检方法 BLOCKED(六维自查也须不含方法词——全文兼容检测会命中)
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法（声明自检方法）\n\n（未声明任何方法）',
        sixDim: '## 6 维自查\n\n- 功能: 通过\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const resVariantNeg = runGuard(['exit', 'execute'], dir);
      assertExit(resVariantNeg, 1);
      assertOut(resVariantNeg, '自检方法');
    },
  },

  // 9: execute exit BLOCKED——6 维自查仅 "### 🟢 R1" 标题无正文
  {
    name: '09 execute exit BLOCKED：6 维仅 🟢 标题无实质',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        sixDim: '## 6 维自查\n\n### 🟢 R1\n### 🟢 R2',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '无实质内容');
    },
  },

  // 10: execute exit BLOCKED——缺 ## 自检方法 且全文无 brooks-review/builtin 声明
  {
    name: '10 execute exit BLOCKED：缺自检方法且全文无声明',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        sixDim: '## 6 维自查\n\n- 功能: 通过\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
        method: '',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '自检方法');
    },
  },

  // 11: execute exit 兼容——旧格式无 ## 自检方法 但 6 维含 brooks-review → WARN 不 BLOCK
  {
    name: '11 execute exit 兼容：旧格式含 brooks-review → WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({ method: '' }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 12: execute exit BLOCKED——TASK 签名哈希不匹配（enter 后改 action）
  {
    name: '12 execute exit BLOCKED：TASK 签名不匹配（enter 后改 action）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      // enter 记录 taskHash
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // enter 后改 action → 任务集签名变化
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE.replace('实现 T01', '实现 T01（改）'));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '签名不匹配');
    },
  },

  // 13: 越俎代庖——parallel done 无 handoffResult → BLOCKED
  {
    name: '13 execute exit BLOCKED：parallel done 无 handoffResult（越俎代庖）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) }; // P02 无 handoff
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P2);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '越俎代庖');
    },
  },

  // 14: 串行 pending 未完成 → BLOCKED
  {
    name: '14 execute exit BLOCKED：串行 pending 未完成',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['P02']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' + TASK_P2);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '串行 pending');
    },
  },

  // 15: subagent-execute exit 通过（parallel 全 done + handoff 齐 + Return Contract 完整）
  // in-place 扩展（验证隔离三态 + 派遣留痕）：① 全部收工 ⇒ 放行（原断言）；② 有 request 无对应
  // result（写者未收工的既有可判形态）⇒ 新 change BLOCKED + 恢复指引 / 旧 change 渐进 WARN；
  // ③ 无该证据对象 ⇒ 零输出（不制造噪音）；④ 派遣留痕落在既有嵌套字段（零新增 state 顶层字段）
  // 的静态锚。反向构造：把出口校验的判据从「有 request 无 result」放宽成恒空 ⇒ ② 必红。
  {
    name: '15 subagent-execute exit 三态（在飞委托 BLOCK·全部收工放行·无证据零输出）+ 留痕嵌套锚',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = {
        summary: 'delegated and collected',
        handoffResult: handoffFor(['P01', 'P02']),
      };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2);
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, '在飞委托');

      // ①b 并行 × 零提交通过出口（AC-9）：parallel done 任务的留痕为「request 记 noCommit:true +
      //     result 回传无 commitHash 的零提交契约」⇒ 出口按该资格豁免缺 commitHash，不因并行维度
      //     而拦。判别力内建对照：同一并行任务去掉 request 的 noCommit 资格 ⇒ 必按缺 commitHash
      //     拦截——证明豁免由资格驱动，不是并行维度的恒真形态。
      const zeroParallelTask = '<task id="P01" status="done" parallel="true"><action>并行零提交</action>'
        + '<write_files>.specs/' + CHANGE_ID + '/P01-SUMMARY.md</write_files><verify>echo ok</verify></task>\n';
      const zeroParallelResult = (taskId) => ({
        result: {
          status: 'DONE', taskId, noCommit: true,
          completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
          redEvidence: { command: 'echo ok' },
          greenEvidence: { command: 'echo ok', output: 'ok' },
        },
      });
      const zeroParallel = { ...baseState('subagent-execute') };
      zeroParallel.evidence['subagent-execute'] = {
        summary: 'parallel zero-commit task collected',
        handoffRequests: { P01: { writeFiles: ['.specs/' + CHANGE_ID + '/P01-SUMMARY.md'], noCommit: true } },
        handoffResult: { P01: zeroParallelResult('P01') },
      };
      writeState(dir, zeroParallel);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + zeroParallelTask);
      const zeroParallelExit = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(zeroParallelExit, 0);
      assertNotOut(zeroParallelExit, '缺 commitHash');
      const unqualifiedParallel = JSON.parse(JSON.stringify(zeroParallel));
      delete unqualifiedParallel.evidence['subagent-execute'].handoffRequests.P01.noCommit;
      writeState(dir, unqualifiedParallel);
      const unqualifiedExit = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(unqualifiedExit, 1);
      assertOut(unqualifiedExit, '缺 commitHash');

      // ② 在飞委托（有 request 无对应 result）⇒ 新 change BLOCKED，报文点名未收工任务并给恢复指引
      const inFlight = { ...baseState('subagent-execute'), newChange: true };
      inFlight.enteredNodes = ['subagent-execute'];
      inFlight.evidence['subagent-execute'] = {
        summary: 'delegated, one writer still running',
        handoffRequests: {
          P01: { writeFiles: ['src/p1.mjs'] },
          P03: { writeFiles: ['src/p3.mjs'] },
        },
        handoffResult: handoffFor(['P01']),
      };
      writeState(dir, inFlight);
      const blocked = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, '在飞委托');
      assertOut(blocked, '待写入者收工后重跑');
      assertOut(blocked, 'P03');
      assertNotOut(blocked, 'P01（');
      // ②b 旧 change 同形态 ⇒ 渐进 WARN 不阻断（向后兼容硬约束），指引仍在
      const inFlightOld = { ...inFlight };
      delete inFlightOld.newChange;
      writeState(dir, inFlightOld);
      const warned = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(warned, 0);
      assertOut(warned, 'WARN');
      assertOut(warned, '在飞委托');
      assertOut(warned, '待写入者收工后重跑');
      // ③ 无该证据对象（从未进入委托节点）⇒ 零输出：判据不得在无证据形态下制造噪音
      const noEvidence = { ...baseState('subagent-execute') };
      noEvidence.evidence = {};
      writeState(dir, noEvidence);
      const silent = runGuard(['exit', 'subagent-execute'], dir);
      assertNotOut(silent, '在飞委托');
      assertNotOut(silent, '待写入者收工后重跑');

      // ②c 撤回通道（在飞委托族的 in-place 扩展）：被遗弃的 request 可经受支持接口撤回——撤回在
      //     **原记录**上加法式落留痕（withdrawnAt 时间戳 + withdrawnBy 来源），守卫按同一判据把已撤回
      //     的 request 移出在飞集合 ⇒ 出口放行；记录本身不删除（历史留痕），重新委托时撤回落痕转入
      //     previousWithdrawals 而非被静默丢弃。已撤回 = **终态**：重复撤回被拒、撤回后 result 被拒。
      //     判据要求留痕**两字段齐备**才成立（只写时间戳的手改形态仍按在飞处理——fail-closed）。
      //     反向构造：守卫不忽略已撤回的 request ⇒ ②c-3 必红；判据只看单一字段 ⇒ ②c-6 必红。
      const withdrawRequests = () => ({
        P01: { writeFiles: ['src/p1.mjs'] },
        P02: { writeFiles: ['src/p2.mjs'], requestedAt: '2026-10-07T00:00:00.000Z' },
      });
      const withdrawCase = { ...baseState('subagent-execute'), newChange: true };
      withdrawCase.enteredNodes = ['subagent-execute'];
      withdrawCase.evidence['subagent-execute'] = {
        summary: 'delegated, one request abandoned',
        handoffRequests: withdrawRequests(),
        handoffResult: handoffFor(['P01']),
      };
      writeState(dir, withdrawCase);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2);
      // 严格形态（newChange:true）下 done 任务须有对应 SUMMARY——补两份，使「撤回 ⇒ 出口放行」
      // 的断言落在**唯一**阻塞点（在飞委托）上，而不是被无关门禁干扰。
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', strictSummary('P01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P02-SUMMARY.md', strictSummary('P02'));
      // ②c-0 撤回前：P02 在飞 ⇒ 出口拦（撤回通道的必要性前提 + 恢复指引点名该命令）
      const beforeWithdraw = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(beforeWithdraw, 1);
      assertOut(beforeWithdraw, 'P02');
      assertOut(beforeWithdraw, 'workflow-handoff.mjs withdraw');
      // ②c-0b 前置拒绝（适用面自洽）：P01 已收工（handoffResult 在场）⇒ 撤回被拒（非零退出 + 报文
      //       写清为何拒 + 恢复指引），且 state 字节零改写（不落留痕、不动既有 request / result——
      //       撤回的适用面是「在飞且被遗弃的 request」，与动作自述一致）。
      //       反向构造：把该前置拒绝去掉 ⇒「撤回已收工的委托」又变 exit 0，本格必红。
      const bytesBeforeCompletedWithdraw = readStateBytes(dir);
      const completedWithdraw = runHandoff(['withdraw', 'P01', '--by', 'user'], dir);
      assertExit(completedWithdraw, 1);
      assertOut(completedWithdraw, '已收工');
      assertOut(completedWithdraw, 'handoffResult 在场');
      assertOut(completedWithdraw, '撤回只适用于被遗弃的 request');
      assertOut(completedWithdraw, '恢复:');
      assertNotOut(completedWithdraw, 'HANDOFF WITHDRAW');
      assertStateBytesUnchanged(dir, bytesBeforeCompletedWithdraw, '撤回已收工的委托被拒');
      // ②c-1 真实 CLI 撤回：缺 --by 先被拒（留痕来源不可缺省）⇒ 补齐后撤回成功
      const noBy = runHandoff(['withdraw', 'P02'], dir);
      assertExit(noBy, 1);
      assertOut(noBy, '--by');
      const withdrawn = runHandoff(['withdraw', 'P02', '--by', 'coordinator', '--reason', '零提交复验失败后作废'], dir);
      assertExit(withdrawn, 0);
      assertOut(withdrawn, 'HANDOFF WITHDRAW: P02');
      assertOut(withdrawn, 'withdrawnAt=');
      // ②c-2 留痕在场且历史不删：撤回两字段齐备，原 request 字段（writeFiles / requestedAt）原样保留
      const stWithdrawn = JSON.parse(readStateBytes(dir));
      const p02Withdrawn = stWithdrawn.evidence['subagent-execute'].handoffRequests.P02;
      if (typeof p02Withdrawn.withdrawnAt !== 'string' || p02Withdrawn.withdrawnAt.trim() === '') {
        throw new Error('撤回应落 withdrawnAt 时间戳: ' + JSON.stringify(p02Withdrawn));
      }
      // 时间纪律：新写入路径走 time-utils 单一权威 ⇒ 标准形态为本地时间 + 显式偏移；裸 Z 形态
      // （自行拼接的产物）在此必红，且 298 的白名单代数会同时漂移（两条判据互相印证）。
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(p02Withdrawn.withdrawnAt)) {
        throw new Error('withdrawnAt 应为标准形态（本地时间 + 显式偏移，走 time-utils 的 nowTimestamp）: '
          + JSON.stringify(p02Withdrawn.withdrawnAt));
      }
      if (Number.isNaN(timeUtilsModule.parseTimestamp(p02Withdrawn.withdrawnAt))) {
        throw new Error('withdrawnAt 应可被时间单一权威解析: ' + JSON.stringify(p02Withdrawn.withdrawnAt));
      }
      if (p02Withdrawn.withdrawnBy !== 'coordinator') {
        throw new Error('撤回应落 withdrawnBy 来源: ' + JSON.stringify(p02Withdrawn));
      }
      if (p02Withdrawn.withdrawReason !== '零提交复验失败后作废') {
        throw new Error('撤回原因应留痕: ' + JSON.stringify(p02Withdrawn));
      }
      if (!Array.isArray(p02Withdrawn.writeFiles) || p02Withdrawn.writeFiles[0] !== 'src/p2.mjs'
        || p02Withdrawn.requestedAt !== '2026-10-07T00:00:00.000Z') {
        throw new Error('撤回不得删除原 request 字段（writeFiles / requestedAt 应原样保留）: ' + JSON.stringify(p02Withdrawn));
      }
      // ②c-3 撤回后 ⇒ 出口放行（守卫忽略已撤回的 request；同一出口、同一 state 其余字段不变）
      const afterWithdraw = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(afterWithdraw, 0);
      assertOut(afterWithdraw, 'ALL CHECKS PASSED');
      assertNotOut(afterWithdraw, '在飞委托');
      // ②c-4 终态之一：重复撤回被拒，且不改写既有留痕
      const withdrawAgain = runHandoff(['withdraw', 'P02', '--by', 'coordinator'], dir);
      assertExit(withdrawAgain, 1);
      assertOut(withdrawAgain, '终态');
      const stAfterAgain = JSON.parse(readStateBytes(dir));
      if (stAfterAgain.evidence['subagent-execute'].handoffRequests.P02.withdrawnAt !== p02Withdrawn.withdrawnAt) {
        throw new Error('重复撤回不得改写既有撤回留痕');
      }
      // ②c-5 终态之二：已撤回的 request 不再接受 result（撤回语义不被事后「复活」绕过）
      const resultAfterWithdraw = runHandoff(['result', 'P02', '{"commitHash":"deadbee","completedChecks":[]}'], dir);
      assertExit(resultAfterWithdraw, 1);
      assertOut(resultAfterWithdraw, '已撤回（终态）');
      // ②c-6 判据要求留痕两字段齐备：抽掉 withdrawnBy（手改形态）⇒ 重新计为在飞委托 ⇒ 出口回收
      const strippedWithdraw = JSON.parse(readStateBytes(dir));
      delete strippedWithdraw.evidence['subagent-execute'].handoffRequests.P02.withdrawnBy;
      writeState(dir, strippedWithdraw);
      const restripped = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(restripped, 1);
      assertOut(restripped, '在飞委托');
      // ②c-7 撤回 → 重新委托：撤回落痕转入 previousWithdrawals，不被静默丢弃
      //     （先补回 ②c-6 抽掉的来源字段——那一抽是为验证判据要求两字段齐备，不是状态终态）
      strippedWithdraw.evidence['subagent-execute'].handoffRequests.P02.withdrawnBy = 'coordinator';
      writeState(dir, strippedWithdraw);
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/subagent-execute-flow-comet-dev.json',
        JSON.stringify({ node: 'subagent-execute', skill: 'flow-comet-dev', at: '2026-10-07T00:00:00.000Z' }, null, 2) + '\n');
      assertExit(runHandoff(['request', 'P02', '重新委托 P02', '--write-files', 'src/p2.mjs'], dir), 0);
      const stReRequest = JSON.parse(readStateBytes(dir));
      const p02ReRequested = stReRequest.evidence['subagent-execute'].handoffRequests.P02;
      if (p02ReRequested.withdrawnAt !== undefined) {
        throw new Error('重新委托应重置当前态（withdrawnAt 不得残留在当前字段）: ' + JSON.stringify(p02ReRequested));
      }
      if (!Array.isArray(p02ReRequested.previousWithdrawals) || p02ReRequested.previousWithdrawals.length !== 1
        || p02ReRequested.previousWithdrawals[0].withdrawnBy !== 'coordinator') {
        throw new Error('重新委托不得静默丢弃撤回落痕（应转入 previousWithdrawals）: ' + JSON.stringify(p02ReRequested));
      }
      // ②c-8 撤回只作用于已记录的 request：未知任务被拒、不新建记录
      const withdrawUnknown = runHandoff(['withdraw', 'P99', '--by', 'coordinator'], dir);
      assertExit(withdrawUnknown, 1);
      assertOut(withdrawUnknown, '无对应 request 记录');
      // ②c-9 前置拒绝的边界（与守卫同一把尺子）：handoffResult 的**显式 null 占位**读作未收工——
      //       守卫的两处消费方（在飞判据按 undefined / null，越俎代庖检测按 falsy）都把它读作
      //       「无结果」，故撤回仍可用，不给「出口拦 + 撤回拒」留下无出口的死角
      //       （真实链路：先 request，再落空占位，再撤回）。
      assertExit(runHandoff(['request', 'P03', '遗弃的在飞委托', '--write-files', 'src/p3.mjs'], dir), 0);
      const nullPlaceholderState = JSON.parse(readStateBytes(dir));
      nullPlaceholderState.evidence['subagent-execute'].handoffResult.P03 = null;
      writeState(dir, nullPlaceholderState);
      const nullPlaceholderWithdraw = runHandoff(['withdraw', 'P03', '--by', 'coordinator'], dir);
      assertExit(nullPlaceholderWithdraw, 0);
      assertOut(nullPlaceholderWithdraw, 'HANDOFF WITHDRAW: P03');

      // ④ 派遣留痕的静态锚（零新增 state 顶层字段）：留痕只允许落在既有嵌套字段
      //    evidence['subagent-execute'] 下——引擎脚本不得出现顶层留痕键赋值；受检面 = **引擎实现面**
      //（入口 ∪ `lib/**`，递归，由模块图派生——迁移到 `lib/` 的写盘路径不再掉出受检面）；
      //    顶层字段清单以状态字段校验器为单一来源（新增顶层字段必须先过校验器，否则本锚即红）。
      const engineSources = Object.fromEntries(engineScriptFiles()
        .map((script) => [script, fs.readFileSync(path.join(SCRIPTS_DIR, script), 'utf8')]));
      const traceShapeProblems = ({ scripts, handoff, schema }) => {
        const out = [];
        const topLevelTraceWriteRe = /\bstate\.(handoffRequests|handoffResult|delegationTrace|dispatchTrace|delegations)\b/;
        for (const [script, src] of Object.entries(scripts)) {
          const hit = src.match(topLevelTraceWriteRe);
          if (hit) {
            out.push(script + ' 出现留痕键的顶层形态「' + hit[0] + '」——留痕必须落在 evidence 嵌套字段（零新增 state 顶层字段）');
          }
        }
        if (!handoff.includes("state.evidence['subagent-execute'].handoffRequests")) {
          out.push('留痕未落在嵌套证据字段（既有同族形态）——顶层字段禁令的正面锚缺失');
        }
        const declaredFields = [...schema.matchAll(/\{ field: '([A-Za-z_$][\w$]*)'/g)].map((m) => m[1]);
        for (const traceKey of ['handoffRequests', 'handoffResult', 'delegationTrace', 'dispatchTrace']) {
          if (declaredFields.includes(traceKey)) {
            out.push('状态字段校验器声明了留痕顶层字段「' + traceKey + '」（应保持嵌套、零新增顶层字段）');
          }
        }
        const writtenTopLevel = [...handoff.matchAll(/\bstate\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]);
        const undeclared = [...new Set(writtenTopLevel)].filter((key) => !declaredFields.includes(key));
        if (undeclared.length > 0) {
          out.push('workflow-handoff.mjs 写入了未在状态字段校验器声明的顶层字段: ' + undeclared.join(', '));
        }
        return out;
      };
      const handoffSource = engineSources['workflow-handoff.mjs'];
      const schemaSource = engineSources['state-schema.mjs'];
      const traceSources = { scripts: engineSources, handoff: handoffSource, schema: schemaSource };
      for (const problem of traceShapeProblems(traceSources)) throw new Error(problem);
      // 反向构造（同一判据驱动）：逐项注入退化形态 ⇒ 必报（判据不恒真空过）。
      const traceProbes = [
        ['留痕键顶层赋值注入', {
          scripts: { ...engineSources, 'workflow-handoff.mjs': handoffSource + '\nstate.delegationTrace = {};\n' },
          handoff: handoffSource + '\nstate.delegationTrace = {};\n',
        }, '顶层形态'],
        ['嵌套落点改顶层', { handoff: handoffSource.replaceAll("state.evidence['subagent-execute'].handoffRequests", 'state.handoffRequests') }, '留痕未落在嵌套证据字段'],
        ['校验器声明留痕顶层字段', { schema: schemaSource.replace('export const STATE_FIELD_VALIDATORS = [', "export const STATE_FIELD_VALIDATORS = [\n  { field: 'delegationTrace', check: () => true },") }, '声明了留痕顶层字段'],
        ['未声明顶层字段写入', { handoff: handoffSource + '\nstate.undeclaredProbe = 1;\n' }, '未在状态字段校验器声明'],
      ];
      for (const [probeLabel, override, expected] of traceProbes) {
        const probed = { ...traceSources, ...override };
        if (!traceShapeProblems(probed).some((p) => p.includes(expected))) {
          throw new Error('反向构造判别力缺失（' + probeLabel + ' 未被判违规）');
        }
      }
    },
  },

  // 16: entry execute——未 commit 工件存在（git 仓库）→ WORKTREE WARN 不 BLOCK
  {
    name: '16 entry execute：未 commit 工件 → WORKTREE WARN',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      const st = baseState('execute');
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      const res = runGuard(['entry', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'WORKTREE WARN');
    },
  },

  // 17: entry execute——PROGRESS.md 存在 → WARNING（清窗恢复产物）
  {
    name: '17 entry execute：PROGRESS.md 存在 → WARNING',
    run: (dir) => {
      const st = baseState('execute');
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/PROGRESS.md', '# PROGRESS\n\n已排除方案: 无\n');
      const res = runGuard(['entry', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'PROGRESS.md 存在');
    },
  },

  // ---------- 分组场景（分支校验 + 追加位置检测） ----------

  // 18: entry archive 分支校验 BLOCKED（branchMode=true + activeChange + 当前分支非 change/<id>）
  // 注意：需初始 commit——unborn HEAD 下 git rev-parse --abbrev-ref HEAD 失败（按规格"失败跳过"不触发校验）
  {
    name: '18 entry archive BLOCKED：分支不是 change/<id>（branchMode）',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const st = baseState('archive');
      st.branchMode = true;
      writeState(dir, st);
      const res = runGuard(['entry', 'archive'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '归档必须在 change/' + CHANGE_ID + ' 分支上进行');
    },
  },

  // 19: entry archive 通过（当前分支 change/<id>）
  {
    name: '19 entry archive 通过：当前分支 change/<id>',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['checkout', '-b', 'change/' + CHANGE_ID], { cwd: dir, stdio: 'ignore' });
      const st = baseState('archive');
      st.branchMode = true;
      writeState(dir, st);
      const res = runGuard(['entry', 'archive'], dir);
      assertExit(res, 0);
      assertOut(res, 'ENTRY OK: archive');
    },
  },

  // 20: exit open——CONTEXT.md 孤立追加段 → WARN 不 BLOCK
  {
    name: '20 exit open WARN：CONTEXT.md 孤立追加段',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n\n## 术语（test-change 追加）\n\n某术语\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: CONTEXT.md 检测到孤立追加段');
    },
  },

  // 21: exit verify——LESSONS.md 条目编号乱序 → WARN 不 BLOCK；verify 命令 timeout 可配置：
  // ① 缺省 timeout（无 env）下耗时命令通过（缺省保持大值）；② env
  // FLOW_COMET_VERIFY_TIMEOUT_MS 覆盖生效——设小值后同耗时命令超时 BLOCK
  {
    name: '21 exit verify WARN：LESSONS.md 编号乱序 + verify timeout env 覆盖',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n## 条目区\n\n### L-002: b\n### L-001: a\n');
      const res = runGuard(['exit', 'verify'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: LESSONS.md 条目编号乱序');
      // 子断言:无区外条目时不得打印"条目在条目区外"WARN(误报修复——修复前
      // console.error 在 if(outside) 之外无条件执行,每次 exit 都刷一条空 WARN)
      assertNotOut(res, '条目在条目区外');
      // 子断言:## 验证命令 段标题带括号后缀(与 ## 自检方法 段括号后缀兼容风格一致)不误 BLOCK
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令（必填 · exit verify 真实执行）\n\n```bash\nnode -e "1"\n```\n');
      const resBracket = runGuard(['exit', 'verify'], dir);
      assertExit(resBracket, 0);
      assertOut(resBracket, 'ALL CHECKS PASSED');
      // ① 缺省 timeout（未设 env）保持大值：1.5s 耗时命令通过（若缺省被误改小 → 超时 RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "setTimeout(()=>{}, 1500)"\n```\n');
      const resDefault = runGuard(['exit', 'verify'], dir);
      assertExit(resDefault, 0);
      assertOut(resDefault, 'ALL CHECKS PASSED');
      // ② env 覆盖生效：FLOW_COMET_VERIFY_TIMEOUT_MS=500 时 1.5s 命令超时 → BLOCKED
      // （不设 env 时同命令走缺省 300s 会通过——env 覆盖被忽略即 RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "setTimeout(()=>{}, 1500)"\n```\n');
      const resEnv = runGuard(['exit', 'verify'], dir, { FLOW_COMET_VERIFY_TIMEOUT_MS: '500' });
      // 超时 kill 的 cmd 孙进程（node）孤儿化后短暂存活，其 cwd 锁定场景目录
      // （Windows：父 cmd 被杀、孙进程继续跑完自身定时器）——在断言前同步等待其
      // 自然退出，避免场景收尾 rmSync 因目录被占用而失败（EPERM/EBUSY）
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 2000)']);
      assertExit(resEnv, 1);
      assertOut(resEnv, 'BLOCKED: verify 命令失败');
      assertOut(resEnv, 'timeout 500ms');
      // 子断言:失败计数按 change 写入(guard 侧递增语义)
      const stFail = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!stFail.verifyFailuresByChange || stFail.verifyFailuresByChange[CHANGE_ID] !== 1) {
        throw new Error('exit verify 失败计数未按 change 写入: ' + JSON.stringify(stFail.verifyFailuresByChange));
      }
      // 子断言:再次失败递增(2/3);恢复快速命令后 exit --apply 成功清零当前 change
      const resEnv2 = runGuard(['exit', 'verify'], dir, { FLOW_COMET_VERIFY_TIMEOUT_MS: '500' });
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 2000)']);
      assertExit(resEnv2, 1);
      const stFail2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!stFail2.verifyFailuresByChange || stFail2.verifyFailuresByChange[CHANGE_ID] !== 2) {
        throw new Error('exit verify 失败计数未递增: ' + JSON.stringify(stFail2.verifyFailuresByChange));
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      // AC-5 隔离：verify 成功只清 verify 计数，不得清 Fix 归位轮次（预置计数，成功出口后核对）
      const stBeforePass = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      stBeforePass.fixRoundsByChange = { ...(stBeforePass.fixRoundsByChange || {}), [CHANGE_ID]: 2 };
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), JSON.stringify(stBeforePass, null, 2) + '\n');
      const resPass = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(resPass, 0);
      const stPass = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!stPass.verifyFailuresByChange || stPass.verifyFailuresByChange[CHANGE_ID] !== 0) {
        throw new Error('exit verify 成功未清零当前 change 计数: ' + JSON.stringify(stPass.verifyFailuresByChange));
      }
      if (stPass.fixRoundsByChange?.[CHANGE_ID] !== 2) {
        throw new Error('exit verify 成功不得清 Fix 归位轮次（计数隔离）: '
          + JSON.stringify(stPass.fixRoundsByChange));
      }
    },
  },

  // 22: exit archive——CHANGELOG.md 表格日期非倒序 → WARN 不 BLOCK;
  // 子断言:归档缺 KNOWN-ISSUES.md(遗留清单,协议 required 产物)→ BLOCKED
  {
    name: '22 exit archive WARN：CHANGELOG.md 表格日期非倒序',
    run: (dir) => {
      const st = baseState('archive');
      st.evidence.archive = { summary: 'archived' };
      writeState(dir, st);
      writeFile(dir, '.specs/archive/foo-' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/archive/foo-' + CHANGE_ID + '/KNOWN-ISSUES.md', '# KNOWN-ISSUES\n\n无遗留问题\n');
      writeFile(dir, '.specs/CHANGELOG.md', '# CHANGELOG\n\n| 日期 | 说明 |\n|------|------|\n| 2026-08-03 | a |\n| 2026-08-04 | b |\n');
      const res = runGuard(['exit', 'archive'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: CHANGELOG.md 表格日期非倒序');
      // 子断言:CHANGELOG 未登记本 change → WARN 渐进(归档收尾登记兜底——
      // 修复前无检测,执行者遗漏登记可静默进归档,此处应 RED)
      assertOut(res, '未登记本 change');
      // 子断言:登记后无未登记 WARN
      writeFile(dir, '.specs/CHANGELOG.md', '# CHANGELOG\n\n| 日期 | 说明 |\n|------|------|\n| 2026-08-15 | ' + CHANGE_ID + ' | 归档登记 |\n');
      const resRegistered = runGuard(['exit', 'archive'], dir);
      assertExit(resRegistered, 0);
      assertNotOut(resRegistered, '未登记本 change');
      // 子断言:归档缺 KNOWN-ISSUES.md(遗留清单为强制产物)→ BLOCKED
      fs.rmSync(path.join(dir, '.specs/archive/foo-' + CHANGE_ID, 'KNOWN-ISSUES.md'));
      const resMissing = runGuard(['exit', 'archive'], dir);
      assertExit(resMissing, 1);
      assertOut(resMissing, 'missing Output Schema artifacts');
    },
  },

  // 23: 旧 state 兼容（无 branchMode 字段 + 无分支）entry archive → exit 0（不触发分支校验）
  {
    name: '23 旧 state 兼容：无 branchMode 无分支 entry archive',
    run: (dir) => {
      const st = baseState('archive'); // 无 branchMode 字段（旧 state 形状）
      writeState(dir, st);
      const res = runGuard(['entry', 'archive'], dir);
      assertExit(res, 0);
      assertOut(res, 'ENTRY OK: archive');
    },
  },

  // ---------- 分组场景（自定义协议加载路由 + 通用层防线 + 特化校验绑定 + hook 白名单缺省） ----------

  // 24: 自定义协议加载路由（AC-2/3）——--protocol CLI 指向 <dir>/custom-protocol.json；
  // workflow-state status 按协议 outputSchemas 推导 currentNode：全部产物缺失 → 第 1 节点
  {
    name: '24 自定义协议加载路由：无产物 → 第 1 节点（brainstorm）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState());
      fs.mkdirSync(path.join(dir, '.specs', 'compose-demo'), { recursive: true });
      const res = runState(['status', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, '"currentNode": "brainstorm"');
    },
  },

  // 25: 自定义协议加载路由（AC-2/3）——仅第 1 节点产物 notes.md 存在 → 推第 2 节点
  {
    name: '25 自定义协议加载路由：仅 notes.md → 第 2 节点（tdd）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState());
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runState(['status', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, '"currentNode": "tdd"');
    },
  },

  // 26: 自定义协议加载路由（AC-2/3）——全部产物存在 → 最后节点
  {
    name: '26 自定义协议加载路由：产物齐全 → 最后节点（codereview）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState());
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      writeFile(dir, '.specs/compose-demo/T01-SUMMARY.md', '# T01-SUMMARY\n');
      writeFile(dir, '.specs/compose-demo/verdict.md', '# verdict\n');
      const res = runState(['status', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, '"currentNode": "codereview"');
    },
  },

  // 27: 通用层防线对自定义协议生效（AC-4）——自定义节点 exit 缺 evidence → BLOCKED（missing evidence）
  {
    name: '27 通用层防线（AC-4）：exit brainstorm 无 evidence → BLOCKED',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ currentNode: 'brainstorm', evidence: {} }));
      fs.mkdirSync(path.join(dir, '.specs', 'compose-demo'), { recursive: true });
      const res = runGuard(['exit', 'brainstorm', '--protocol', custom], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'missing evidence for Node brainstorm');
    },
  },

  // 28: 特化校验绑定反例（AC-5）——自定义节点 id（brainstorm）exit 不误触发内置 open 特化校验：
  // 场景内置 open 特化校验的诱饵（CHANGE.md 缺 Why + REQUIREMENT 缺验收段），若误触发必 BLOCKED
  {
    name: '28 特化校验绑定反例（AC-5b）：brainstorm exit 不误触发内置特化校验',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n'); // brainstorm 产物（artifact 门控）
      writeFile(dir, '.specs/compose-demo/CHANGE.md', '# CHANGE\n\n## 变更目标\n\n## 方案\n');
      writeFile(dir, '.specs/compose-demo/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 需求分析\n');
      const res = runGuard(['exit', 'brainstorm', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, '缺必填段');
      assertNotOut(res, '缺少验收标准');
    },
  },

  // 29: 协议 env 加载（AC-2/3）——FLOW_COMET_PROTOCOL 指向场景内自定义协议（无 --protocol CLI）
  // guard 从 env 加载自定义协议：若 env 被忽略（回退 packageRoot 内置 8 节点协议）→ Unknown Node 报错
  {
    name: '29 自定义协议 env 加载：FLOW_COMET_PROTOCOL 生效',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runGuard(['exit', 'brainstorm'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, 'Unknown workflow Node');
      // ③ state.protocolPath 持久化绑定优先于 FLOW_COMET_PROTOCOL env：env 指向内置协议
      // （无 brainstorm 节点），state 绑定自定义协议 → 仍按自定义协议通过。修复前 guard 只看
      // CLI/env → 走内置协议报 Unknown Node（RED）。
      const bound = composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
        protocolPath: 'custom-protocol.json',
      });
      writeState(dir, bound);
      const resBound = runGuard(['exit', 'brainstorm'], dir); // runGuard 默认 env=内置协议副本
      assertExit(resBound, 0);
      assertOut(resBound, 'ALL CHECKS PASSED');
      assertNotOut(resBound, 'Unknown workflow Node');
      // ④ state.protocolPath 绑定不可读 → fail-closed 不回退 env/默认协议，错误说明来源与
      // 不回退语义（归属门禁可跳过校验，节点门禁没有等价降级路径）。
      writeState(dir, composeState({ protocolPath: 'missing-protocol.json' }));
      const resBoundMissing = runGuard(['exit', 'brainstorm'], dir);
      assertExit(resBoundMissing, 1);
      assertOut(resBoundMissing, 'state.protocolPath');
      assertOut(resBoundMissing, '不回退');
      assertNotOut(resBoundMissing, 'Unknown workflow Node');
    },
  },

  // 30: hook 白名单缺省（AC-6）——自定义协议无 writeWhitelist → hook 回退内置缺省表。
  // a) 无活跃 state → 放行（不阻断）；b) 自定义节点 + 写 .specs/ → 放行；c) 内置 open + .specs/ → 放行；
  // d) 内置 open + 写源码 → BLOCKED（缺省表 open 仅允许 .specs/）
  {
    name: '30 hook 白名单缺省（AC-6）：协议无 writeWhitelist → 内置缺省表',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      // a) 无 state 文件 → 无活跃 workflow 放行
      const resA = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'index.ts') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(resA, 0);
      assertOut(resA, 'no active workflow');
      // b) 自定义协议 + 活跃 state（brainstorm）写 .specs/ 内文件 → 放行
      writeState(dir, composeState({ status: 'running' }));
      const resB = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(resB, 0);
      assertOut(resB, 'NODE: brainstorm');
      // c) 内置协议副本（同样无 writeWhitelist）+ open 写 .specs/ 内文件 → 缺省表放行
      const stC = baseState('open');
      stC.status = 'running';
      writeState(dir, stC);
      const resC = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'CHANGE.md') } });
      assertExit(resC, 0);
      assertOut(resC, 'NODE: open');
      // d) 内置协议副本 + open 写源码 → 缺省表拦截（BLOCKED exit 2）
      const resD = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'index.ts') } });
      assertExit(resD, 2);
      assertOut(resD, 'BLOCKED: phase "open" 不允许写入');
    },
  },

  // 31: --protocol CLI 优先于 env（AC-2）——env 指向内置副本（若 CLI 被忽略 → 内置协议无
  // brainstorm 节点 → Unknown Node 报错），CLI 指向自定义协议 → 走自定义协议通过
  {
    name: '31 --protocol CLI 优先于 FLOW_COMET_PROTOCOL env',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runGuard(['exit', 'brainstorm', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, 'Unknown workflow Node');
    },
  },

  // ----------  场景（自定义协议全部完成 → NEXT: done；部分完成仍走产物推导） ----------

  // 32: 自定义协议无 archive 节点，3 节点全部 exit 完成（completedNodes 含 brainstorm/tdd/codereview）
  // → next 输出 NEXT: done（修复前缺陷：determineNode 只按产物推导，全部完成仍输出 NODE: codereview）
  {
    name: '32 自定义协议全节点完成：next → NEXT: done',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'codereview',
        completedNodes: ['brainstorm', 'tdd', 'codereview'],
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      writeFile(dir, '.specs/compose-demo/T01-SUMMARY.md', '# T01-SUMMARY\n');
      writeFile(dir, '.specs/compose-demo/verdict.md', '# verdict\n');
      const res = runState(['next', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'NEXT: done');
      assertNotOut(res, 'NODE: codereview');
    },
  },

  // 33: 反例（防过度修复）——completedNodes 为空（部分完成）但产物全齐 → next 仍输出最后节点
  // codereview：产物推导继续生效，不因"全部完成 → done"判定误伤最后节点路由
  //  适配：currentNode=brainstorm 已记录 evidence（节点已工作）→ 不触发节点顺序 BLOCK；
  // completedNodes 仍为空，"部分完成但产物全齐 → 仍 NODE: codereview"断言保持不变
  {
    name: '33 反例：completedNodes 空但产物全齐 → 仍 NODE: codereview',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      writeFile(dir, '.specs/compose-demo/T01-SUMMARY.md', '# T01-SUMMARY\n');
      writeFile(dir, '.specs/compose-demo/verdict.md', '# verdict\n');
      const res = runState(['next', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'NODE: codereview');
      assertNotOut(res, 'NEXT: done');
    },
  },
];
