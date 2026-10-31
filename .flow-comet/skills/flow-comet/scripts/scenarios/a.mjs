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
  assertTrue,
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
  engineCodeText,
  engineScriptFiles,
  engineScriptTexts,
  handoffFor,
  strictSummary,
  summaryContent,
  timeUtilsModule,
  writeCustomProtocol,
} from '../lib/test-fixtures.mjs';
import {
  assertStateBytesUnchanged,
  fixBatchTaskText,
  readStateBytes,
  scenarioProtocolPath,
} from '../lib/test-assertions.mjs';
// 命令文本的唯一实现（平台化脚本根 + 整条路径加引号）：m2 直接以它作为期望值，断言运行期
// 输出与 handoff 的 PREFLIGHT 同源同形——不是「看起来都像命令」。
import { scriptCommand } from '../lib/state-explain.mjs';
// 单一来源静态锁（COORDINATOR 常量的落点与取用面）：与套件其它单源锚共用同一判据实现。
import { singleSourceImportProblems } from '../lib/text-anchor-checks.mjs';

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

  // 2: open exit 模板缺席——CHANGE.md 缺 Why 段：命名段判据跳过，但跳过必须可见（C9）
  // 模板整份缺席（夹具没有 flow-kit/templates/）时 pick 不再回落到命名段兜底正则 ⇒ 「缺必填段」
  // 判据不生效；但「不阻断」不等于「静默通过」——产出物结构门禁必须逐工件报到「未校验（模板缺失）」，
  // 跳过因此自证（L-079）。模板在场但该段名缺席时 fallback 仍生效，见 TA-21 的反向构造。
  {
    name: '02 open exit 模板缺席：CHANGE 缺 Why 段不阻断，但显式报到「未校验（模板缺失）」',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## 变更目标\n\n## 方案\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 0);
      assertOut(res, '未校验（模板缺失）: CHANGE.md');
      assertNotOut(res, '缺必填段');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 3: open exit BLOCKED——REQUIREMENT.md 缺验收段（且无 Given 豁免）
  // 判据面是模板派生的段名表，故夹具带 REQUIREMENT 模板：模板缺席时该判据按 C9 跳过（见第 2 例），
  // 这里测的是「模板在场」的真实路径。
  {
    name: '03 open exit BLOCKED：REQUIREMENT 缺验收段',
    run: (dir) => {
      writeFile(dir, 'flow-kit/templates/REQUIREMENT.md',
        '# REQUIREMENT 模板\n\n## 用户故事（User Story）\n## 验收准则（Acceptance Criteria）\n');
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
  // 同第 3 例：判据面是模板派生的段名表，夹具带 DESIGN 模板（模板缺席时该判据按 C9 跳过）。
  {
    name: '05 design exit BLOCKED：缺决策清单',
    run: (dir) => {
      writeFile(dir, 'flow-kit/templates/DESIGN.md', '# DESIGN 模板\n\n## 0. 技术栈选型\n## 1. 技术决策清单\n');
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
    name: '08 execute exit 通过（enter 后未改 TASK，签名匹配）+ 未 exit 时 status/next 共用节点视图（含 coordinatorMode 同源与协调者行）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      // enter 时脚本自动记录 taskHash（写回 state）
      const entryView = runGuard(['entry', 'execute'], dir);
      assertExit(entryView, 0);
      // m10 跨输出面锚：entry 与 next 打印的是**同一句**协调者纪律（单一来源）。入口侧先独立断言
      // 口径 token 与旧句零残留；与 next 的逐字相等在下方 nextView 之后比对。
      const entryCoordinatorLine = entryView.output.split('\n').find((line) => line.startsWith('COORDINATOR: '));
      if (!entryCoordinatorLine) {
        throw new Error('entry execute 缺 COORDINATOR 行\n实际输出:\n' + entryView.output);
      }
      for (const token of ['按平台的身份通道委托子代理', '同一身份判据', '不要求隔离区', '「写权限」的一种实现', '共享工作区同样受支持']) {
        if (!entryCoordinatorLine.includes(token)) {
          throw new Error('entry execute 的 COORDINATOR 行缺现行口径 ' + token + '：' + entryCoordinatorLine);
        }
      }
      assertNotOut(entryView, '只能通过 Agent 工具 worktree isolation 委托子代理');
      // exit 前补 SUMMARY + handoff（不碰 TASK.md）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      // AC-2 正向锚：裸 exit（不带 --apply）是节点收尾的全链预演——跑完整门禁但不落盘，并显式
      // 提示 --apply 才推进。反向对照在场景 14（--preflight 通过路径不得打印 --apply 引导）：
      // 两个只读面各守一侧，preflight 只跑结构子集、裸 exit 必须真跑到「可落盘」这一步。
      const bareExitBytes = readStateBytes(dir);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertOut(res, 'APPLY: rerun with --apply');
      assertStateBytesUnchanged(dir, bareExitBytes, '裸 exit（不带 --apply）是全链预演：门禁全过后也不得改写 state');
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

      // ---------- 节点视图收敛（in-place 扩展） ----------
      // 构造「execute 已 entry 未 exit、产物推导已指向其后继 review」的态：此前 status 只报
      // 推导节点 review、next 的进行中保护报 execute——同一事实两处说法。收敛后 status 增
      // routeNode（= next 的 NODE）与 ROUTE: 三视图对账行；next 增 WHY: 停留原因与 execute
      // 家族的 PREFLIGHT: 预检提示；既有 currentNode（产物推导）/ stateCurrentNode（state
      // 原值）语义逐字不变，且两条命令都不写 state。
      // 说明：不新增场景条目是本仓「场景数 = 受检面计数」约束下的 in-place 扩展形态（同场景 15）。
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n');
      const viewState = JSON.parse(readStateBytes(dir));
      viewState.completedNodes = ['open', 'design', 'plan'];
      viewState.enteredNodes = ['open', 'design', 'plan', 'execute'];
      viewState.evidence = {
        ...viewState.evidence,
        open: { summary: 'open complete' },
        design: { summary: 'design complete' },
        plan: { summary: 'plan complete' },
      };
      writeState(dir, viewState);
      const viewBytes = readStateBytes(dir);
      const statusView = runState(['status'], dir);
      assertExit(statusView, 0);
      const statusRouteNode = (statusView.output.match(/"routeNode":\s*"([^"]+)"/) ?? [])[1];
      if (statusRouteNode !== 'execute') {
        throw new Error('status.routeNode 应为进行中节点 execute（= next 的 NODE），实际: '
          + JSON.stringify(statusRouteNode) + '\n实际输出:\n' + statusView.output);
      }
      assertOut(statusView, '"currentNode": "review"'); // 产物推导语义不变（SUMMARY 已齐 → review）
      assertOut(statusView, '"stateCurrentNode": "execute"'); // state 原值语义不变
      // m3：coordinatorMode 与 routeNode 同源（One predicate）——进行中态下 routeNode=execute 而
      // 产物推导是 review；旧口径（按 detectedNode 计算）会在同一响应里给出 false，即两个「当前
      // 节点」口径并存。断言取其在 route 视图上的取值，锁住二者不再分叉。
      assertOut(statusView, '"coordinatorMode": true');
      const routeLine = statusView.output.split('\n').find((line) => line.startsWith('ROUTE: '));
      if (!routeLine) throw new Error('status 缺少 ROUTE: 诊断行\n实际输出:\n' + statusView.output);
      for (const token of ['derived=review', 'state=execute', 'route=execute', '先 exit execute']) {
        if (!routeLine.includes(token)) throw new Error('ROUTE: 行缺少 ' + token + '：' + routeLine);
      }
      assertStateBytesUnchanged(dir, viewBytes, 'status 是只读视图（ROUTE 诊断不得写 state）');
      const nextView = runState(['next'], dir);
      assertExit(nextView, 0);
      const nextNode = (nextView.output.match(/^NODE: (.+)$/m) ?? [])[1];
      if (nextNode !== statusRouteNode) {
        throw new Error('status.routeNode 与 next 的 NODE 不一致（同一事实两处说法）：'
          + JSON.stringify(statusRouteNode) + ' vs ' + JSON.stringify(nextNode));
      }
      const whyLine = nextView.output.split('\n').find((line) => line.startsWith('WHY: '));
      if (!whyLine) throw new Error('next 缺少 WHY: 停留原因行\n实际输出:\n' + nextView.output);
      if (!whyLine.includes('已 entry 未 exit')) {
        throw new Error('WHY: 行应说明进行中原因（已 entry 未 exit）：' + whyLine);
      }
      assertOut(nextView, 'PREFLIGHT: ');
      // 平台化形态：脚本路径整条加引号，命令在引号之后接 exit <节点> --preflight（裸脚本名的旧
      // 形态由 m2 的解析断言与反向锚共同排除）。预检节点取路由视图（= NODE 行），且必须与
      // 「完整 exit（不带 --apply）才是全链预演」的说明句同行——同一个 PREFLIGHT 不再指两条命令。
      assertOut(nextView, 'workflow-guard.mjs" exit execute --preflight');
      assertOut(nextView, '做结构预检（只跑结构性门禁，不写 state、不推进状态）');
      assertOut(nextView, '完整 exit（不带 --apply）是节点收尾的全链预演');
      assertNotOut(nextView, '（不带 --apply）预检——跑完整出口门禁');
      assertStateBytesUnchanged(dir, viewBytes, 'next 进行中保护不得写 state（routeNode 与 NODE 同源）');

      // m2：next 的 PREFLIGHT 行必须与 handoff result 的平台化形态同源——命令从输出解析后，
      // 逐字等于脚本命令单一实现的产物（同一 scriptsDir / runRoot），而不是裸脚本名。
      const preflightCommand = (nextView.output.match(/PREFLIGHT: 可运行 (node .+?) 做结构预检/) ?? [])[1];
      if (!preflightCommand) {
        throw new Error('next 的 PREFLIGHT 行缺可解析的平台化命令（应为 node "<脚本路径>" exit <节点> --preflight）：\n'
          + nextView.output);
      }
      const expectedPreflightCommand = scriptCommand({
        scriptsDir: SCRIPTS_DIR, runRoot: dir, script: 'workflow-guard.mjs', args: ['exit', 'execute', '--preflight'],
      });
      if (preflightCommand !== expectedPreflightCommand) {
        throw new Error('next 的 PREFLIGHT 命令未走平台化单一实现：'
          + JSON.stringify(preflightCommand) + '（期望 ' + JSON.stringify(expectedPreflightCommand) + '）');
      }
      // 反向锚：裸脚本名形态（旧输出）不得残留——它正是「照抄到非 .claude 安装会落空」的形态。
      assertNotOut(nextView, 'PREFLIGHT: 可运行 workflow-guard.mjs');
      // 两个输出面同形：同一节点下 handoff result 打印的同一条命令必须逐字相同（不是各写一份）。
      // handoff 侧的路由视图要解析协议（与 next 同一判定），而 runHandoff 默认不注入协议副本——
      // 显式传入场景协议路径（与 runState 的默认注入同源）。
      const handoffPre = runHandoff(['result', 'T01', '{"greenEvidence":{"command":"node --check src/t1.mjs"},"redEvidence":{"command":"node --check src/t1.mjs"}}'], dir, {
        FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir),
      });
      assertExit(handoffPre, 0);
      const handoffPreflightCommand = (handoffPre.output.match(/PREFLIGHT: SUMMARY 结构尚未校验——可运行 (node .+?) 做结构预检/) ?? [])[1];
      if (!handoffPreflightCommand) {
        throw new Error('handoff result 的 PREFLIGHT 行缺可解析的平台化命令：\n' + handoffPre.output);
      }
      if (handoffPreflightCommand !== preflightCommand) {
        throw new Error('两处 PREFLIGHT 命令形态不一致（next vs handoff result）：'
          + JSON.stringify(preflightCommand) + ' vs ' + JSON.stringify(handoffPreflightCommand));
      }

      // m10：COORDINATOR 行按现行架构口径——三平台按身份通道委托、worktree 只是「写权限」的
      // 一种实现、不要求隔离区。旧句（只能 worktree isolation）写回即红。
      assertOut(nextView, 'COORDINATOR: ');
      assertOut(nextView, '按平台的身份通道委托子代理');
      assertOut(nextView, '同一身份判据');
      assertOut(nextView, '不要求隔离区');
      assertOut(nextView, '「写权限」的一种实现');
      assertOut(nextView, '共享工作区同样受支持');
      assertNotOut(nextView, '只能通过 Agent 工具 worktree isolation 委托子代理');
      // 跨输出面：entry 与 next 的 COORDINATOR 行必须逐字相同（同一常量/同一措辞）——写回任一处
      // 的旧句都会同时破坏 token 断言与这条逐字相等锚。
      const nextCoordinatorLine = nextView.output.split('\n').find((line) => line.startsWith('COORDINATOR: '));
      if (!nextCoordinatorLine) {
        throw new Error('next 缺 COORDINATOR 行\n实际输出:\n' + nextView.output);
      }
      if (entryCoordinatorLine !== nextCoordinatorLine) {
        throw new Error('entry 与 next 的 COORDINATOR 行不一致（同一纪律两个输出面必须逐字相同）：'
          + '\nentry: ' + entryCoordinatorLine + '\nnext : ' + nextCoordinatorLine);
      }
      // 常量落点与取用面（单一来源的静态锁）：协调者禁令是**一个知识**，实现只许一处、取用面只许
      // 具名 import。两处各写一份在措辞演进时必然分叉（本 change 初版即因此留下两种口径），而
      // 上面的运行期相等锚只在两处恰好同值时成立——**落点错了它看不见**（两份副本可以逐字相同）。
      // 故另锚这一层：① 定义面唯一且落在中立模块（状态命令族与门禁族都只是取用方）；② 消费方不得
      // 自带第二份定义、不得绕过单源取用。反向边（状态命令族 → 门禁族）随迁位消失——套件里直接
      // 断言它没有回来：状态命令族的**代码层**不得再出现门禁模块的名字。
      const engineTexts = engineScriptTexts();
      const singleSourceProblems = singleSourceImportProblems({
        symbol: 'COORDINATOR_NOTICE',
        sourceRel: 'lib/state-explain.mjs',
        texts: engineTexts,
      });
      if (singleSourceProblems.length > 0) {
        throw new Error('协调者禁令的单一来源被破坏（' + singleSourceProblems.join('; ') + '）');
      }
      const flowCode = engineCodeText(engineTexts.get('lib/state-commands-flow.mjs') ?? '');
      if (flowCode.includes('guard-gates')) {
        throw new Error('状态命令族不得依赖门禁族（反向边）：lib/state-commands-flow.mjs 的代码层仍引用 guard-gates');
      }

      // ---------- record 的节点视图同源（in-place 扩展） ----------
      // 缺陷形态：runRecord 写证据后用 determineNode（产物推导）打印 NEXT/NODE，未走共享视图——
      // 就在上面这个「currentNode=execute 已 entry 未 exit、产物推导已指向 review」的态里，
      // record execute 报 review，而 next 报 execute、status.routeNode 报 execute：每完成一个节点
      // 都会看到与两条命令相反的「下一节点」，正是本 change 要消灭的同一事实两处说法（L-067）。
      // record 是**第三个**节点视图输出面，故判据取「三面同一节点」而不是各自断言节点名。
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/execute-flow-comet-execute.json',
        JSON.stringify({
          node: 'execute',
          skill: 'flow-comet-execute',
          protocol: '3-execute.md',
          templates: ['SUMMARY'],
          at: '2026-08-01T00:00:00.000Z',
        }, null, 2) + '\n');
      const recordView = runState(['record', 'execute', '{"summary":"execute recorded while in progress"}'], dir);
      assertExit(recordView, 0);
      const recordNode = (recordView.output.match(/^NODE: (.+)$/m) ?? [])[1];
      if (recordNode !== 'execute') {
        throw new Error('record 处于进行中态：NODE 应为路由视图 execute（不是产物推导的 review），实际: '
          + JSON.stringify(recordNode) + '\nrecord 输出:\n' + recordView.output);
      }
      if (recordNode !== nextNode || recordNode !== statusRouteNode) {
        throw new Error('record 的 NODE 与 next / status.routeNode 不同源（同一事实三处说法）：'
          + JSON.stringify({ record: recordNode, next: nextNode, statusRouteNode })
          + '\nrecord 输出:\n' + recordView.output + '\nnext 输出:\n' + nextView.output);
      }
      // record 也会经 printNext 打出 COORDINATOR 行（execute 家族）——它是同一常量的第三个输出面，
      // 一并锁进「逐字相等」：任一处另写一份措辞都会在这里红。
      const recordCoordinatorLine = recordView.output.split('\n').find((line) => line.startsWith('COORDINATOR: '));
      if (recordCoordinatorLine !== nextCoordinatorLine) {
        throw new Error('record 的 COORDINATOR 行与 entry / next 不一致（同一常量、同一 printNext 实现）：'
          + '\nnext  : ' + nextCoordinatorLine + '\nrecord: ' + recordCoordinatorLine);
      }

      // ---------- Fix 归位态的节点视图（in-place 扩展） ----------
      // 缺陷复现：currentNode=review、REVIEW.md 在场、TASK 有 pending 修复任务时，next 的
      // FIX-BATCH 分支先于共享视图返回并打印 NODE: execute，status 只走共享视图——它按「进行中
      // 保护」报 routeNode=review，ROUTE: 行还叫人「先 exit review」，真去 exit 会被
      // 「存在未归位/未跑出口的 Fix 批次」拦下。修复后 status 只读消费同一归位决策
      // （resolveFixRollbackDecision 是纯读：不写盘、不计轮次），routeNode 与指引都指向归位目标。
      const fixTaskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const fixState = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: {
          open: { summary: 'open complete' },
          design: { summary: 'design complete' },
          plan: { summary: 'plan complete' },
          execute: { summary: 'first pass executed' },
          review: { summary: 'review in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      writeFile(dir, fixTaskPath, fixBatchTaskText('pending'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 结论\n\n修复任务已追加，待归位 execute 跑完其出口。\n');
      writeState(dir, fixState);
      const fixBytes = readStateBytes(dir);
      const fixStatus = runState(['status'], dir);
      assertExit(fixStatus, 0);
      assertStateBytesUnchanged(dir, fixBytes, 'Fix 归位态下 status 是只读视图（归位决策只读消费，不写盘）');
      const fixRouteNode = (fixStatus.output.match(/"routeNode":\s*"([^"]+)"/) ?? [])[1];
      const fixRouteLine = fixStatus.output.split('\n').find((line) => line.startsWith('ROUTE: '));
      if (!fixRouteLine) throw new Error('status 缺少 ROUTE: 诊断行\n实际输出:\n' + fixStatus.output);
      const fixNext = runState(['next'], dir);
      assertExit(fixNext, 0);
      assertOut(fixNext, 'FIX-BATCH: 归位 execute（源节点 review）');
      const fixNextNode = (fixNext.output.match(/^NODE: (.+)$/m) ?? [])[1];
      if (fixNextNode !== 'execute') {
        throw new Error('Fix 归位态下 next 应打印 NODE: execute，实际: ' + JSON.stringify(fixNextNode)
          + '\n实际输出:\n' + fixNext.output);
      }
      if (fixRouteNode !== fixNextNode) {
        throw new Error('Fix 归位态下 status.routeNode 与 next 的 NODE 不一致（status 把执行者指向了会被 FIX-BATCH 拦下的节点）：'
          + JSON.stringify(fixRouteNode) + ' vs ' + JSON.stringify(fixNextNode)
          + '\nstatus 输出:\n' + fixStatus.output + '\nnext 输出:\n' + fixNext.output);
      }
      if (fixRouteLine.includes('先 exit review')) {
        throw new Error('Fix 归位态下 ROUTE: 不得让用户先去 exit 会被 FIX-BATCH 拦下的源节点：' + fixRouteLine);
      }
      for (const token of ['Fix 批次', '归位 execute']) {
        if (!fixRouteLine.includes(token)) throw new Error('ROUTE: 行缺少归位指引 ' + token + '：' + fixRouteLine);
      }
      // 同源不只在 NODE 上：next 的 FIX-BATCH 分支也要有一行 WHY（与共享视图同一段文案实现），
      // 且该行点名的节点与 status.routeNode 相同——否则两边节点相同、解释却各自一份。
      const fixWhyLine = fixNext.output.split('\n').find((line) => line.startsWith('WHY: '));
      if (!fixWhyLine) {
        throw new Error('Fix 归位态下 next 缺少 WHY: 解释行（应与共享视图同源）\n实际输出:\n' + fixNext.output);
      }
      if (!fixWhyLine.includes(fixRouteNode)) {
        throw new Error('WHY: 行点名的节点应与 status.routeNode 一致（' + JSON.stringify(fixRouteNode) + '）：' + fixWhyLine);
      }
      if (!fixWhyLine.includes('Fix 批次')) {
        throw new Error('WHY: 行应说明这是 Fix 批次归位（而不是产物推导/进行中保护）：' + fixWhyLine);
      }
      // 归位写盘仍只属于 next 的 FIX-BATCH 分支（既有契约：受控归位改写 currentNode，见场景 253a）；
      // 视图路径本身不得写 state——归位后重跑 next 走共享视图，字节零变化。
      const stateAfterRollback = JSON.parse(readStateBytes(dir));
      if (stateAfterRollback.currentNode !== 'execute') {
        throw new Error('Fix 归位态下 next 应把 currentNode 归位 execute，实际 '
          + JSON.stringify(stateAfterRollback.currentNode));
      }
      const bytesAfterRollback = readStateBytes(dir);
      const nextAfterRollback = runState(['next'], dir);
      assertExit(nextAfterRollback, 0);
      assertOut(nextAfterRollback, 'NODE: execute');
      assertStateBytesUnchanged(dir, bytesAfterRollback, '归位后的共享视图路径不得改写 state');

      // handoff result 侧同源（缺陷复现）：Fix 归位态下 state.currentNode=review，取原值会打印
      // exit review——该节点此刻正被 Fix 批次门禁拦着；路由视图是 execute。两处提示（next /
      // handoff result）必须同一节点，且都带结构预检与全链预演两句。
      writeState(dir, fixState);
      const fixHandoff = runHandoff(['result', 'T02',
        '{"greenEvidence":{"command":"node --check src/t2.mjs"},"redEvidence":{"command":"node --check src/t2.mjs"}}'], dir, {
        FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir),
      });
      assertExit(fixHandoff, 0);
      const fixHandoffCommand = (fixHandoff.output.match(/PREFLIGHT: SUMMARY 结构尚未校验——可运行 (node .+?) 做结构预检/) ?? [])[1];
      if (!fixHandoffCommand) {
        throw new Error('Fix 归位态下 handoff result 的 PREFLIGHT 行缺可解析命令：\n' + fixHandoff.output);
      }
      const expectedFixHandoffCommand = scriptCommand({
        scriptsDir: SCRIPTS_DIR, runRoot: dir, script: 'workflow-guard.mjs', args: ['exit', 'execute', '--preflight'],
      });
      if (fixHandoffCommand !== expectedFixHandoffCommand) {
        throw new Error('Fix 归位态下 handoff result 的预检节点应取路由视图 execute（不是 state.currentNode 原值 review）：'
          + JSON.stringify(fixHandoffCommand) + '（期望 ' + JSON.stringify(expectedFixHandoffCommand) + '）');
      }

      // 保护谓词的路由序号条件（反过度保护）：verify 驻留但 REVIEW.md 缺失 → 产物推导回退
      // review（derived 在 currentNode 之前，不是路由后继），进行中保护不得把路由钉在 verify 上；
      // status 与 next 都必须报产物推导的 review，next 的漂移校正随之落盘。
      writeFile(dir, fixTaskPath, fixBatchTaskText('done'));
      fs.rmSync(path.join(dir, '.specs/' + CHANGE_ID, 'REVIEW.md'));
      writeState(dir, {
        ...fixState,
        currentNode: 'verify',
        completedNodes: [...fixState.completedNodes, 'review'],
        enteredNodes: [...fixState.enteredNodes, 'verify'],
        evidence: { ...fixState.evidence, verify: { summary: 'verify in progress' } },
      });
      const driftStatus = runState(['status'], dir);
      assertExit(driftStatus, 0);
      const driftRouteNode = (driftStatus.output.match(/"routeNode":\s*"([^"]+)"/) ?? [])[1];
      if (driftRouteNode !== 'review') {
        throw new Error('derived 不在 currentNode 之后时不得套用进行中保护（routeNode 应为产物推导的 review），实际: '
          + JSON.stringify(driftRouteNode) + '\nstatus 输出:\n' + driftStatus.output);
      }
      // m3 的另一侧取值：非进行中态 routeNode 不是 execute 家族 → coordinatorMode=false
      // （与「同源」一起锁住取值域，不能只在一个方向上成立）。
      assertOut(driftStatus, '"coordinatorMode": false');
      const driftNext = runState(['next'], dir);
      assertExit(driftNext, 0);
      assertOut(driftNext, 'NODE: review');
      if (JSON.parse(readStateBytes(dir)).currentNode !== 'review') {
        throw new Error('非后继形态应被产物权威校正回 review，实际 state.currentNode: '
          + JSON.stringify(JSON.parse(readStateBytes(dir)).currentNode) + '\nnext 输出:\n' + driftNext.output);
      }

      // 序号条件的边界（反过度收窄）：execute 家族是同一个多趟**循环**，execute ⇄ subagent-execute
      // 在 route 里的一前一后不是先后关系。波次收齐后只剩串行 pending 时（派生回到 execute 的
      // 趟间回边），保护必须继续生效——否则 next 会把 currentNode 推回 execute，波次的出口再也
      // 无法重跑（L-060 型死结）。
      writeFile(dir, fixTaskPath, fixBatchTaskText('pending'));
      writeState(dir, {
        ...fixState,
        currentNode: 'subagent-execute',
        completedNodes: ['open', 'design', 'plan', 'execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        evidence: { ...fixState.evidence, 'subagent-execute': { summary: 'wave delegated' } },
      });
      const waveBytes = readStateBytes(dir);
      const waveStatus = runState(['status'], dir);
      assertExit(waveStatus, 0);
      const waveRouteNode = (waveStatus.output.match(/"routeNode":\s*"([^"]+)"/) ?? [])[1];
      if (waveRouteNode !== 'subagent-execute') {
        throw new Error('执行家族内的趟间回边不得套用路由序号条件（routeNode 应为进行中的 subagent-execute），实际: '
          + JSON.stringify(waveRouteNode) + '\nstatus 输出:\n' + waveStatus.output);
      }
      const waveNext = runState(['next'], dir);
      assertExit(waveNext, 0);
      assertOut(waveNext, 'NODE: subagent-execute');
      assertStateBytesUnchanged(dir, waveBytes, '执行家族回边仍属进行中保护：next 不得把 currentNode 推回 execute');
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

  // 14: 串行 pending 未完成 → BLOCKED；in-place 扩展：结构化预检（exit --preflight）
  // 缺陷形态：每任务预检被设想的时点（result 已记、尚未标 done）在完整出口链里必先撞更早的
  // 进展类门禁——串行 pending 排在模板保真门之前，结构问题根本报不出来。本例用同一夹具证明：
  // ① 完整 exit（不带 --apply）仍报进展类问题（对照锚），且此刻还没到结构门；
  // ② --preflight 首报结构问题、不报串行 pending，且只读（state 字节零改写 + 不写提示账本）；
  // ③ 旧 change 只 WARN 不阻断；④ 参数防护 fail-closed（--preflight+--apply / 非 exit 命令 /
  // 未知节点）；⑤ 通过时提示不误导（不打印 --apply 引导），结构干净也不放行推进（完整 exit 照旧拦）。
  // 同缺陷的第二形态（⑥⑦⑧，in-place 追加）：空 open 节点曾因「入口三件只查在场者」一件都没查、
  // 直接打印 ALL CHECKS PASSED——⑥ 要求缺件必须 BLOCK 且逐项给路径 + 模板指针；⑦ 要求缺件与结构
  // 问题同轮报告（先列缺失件、再列结构问题）；⑧ 要求工件齐但缺段时仍回到既有两阶段结构报文
  // （首段只报类别计数）。三者都断言 state 字节零改写（预检仍只读）。
  // 反向构造：把预检实现改回「跑全链」⇒ ② 的旧 change 分支落进完整出口链、被串行 pending 拦下
  // （期望 exit 0 实际 1，断言红）；让预检写 state ⇒ ②/⑥⑦⑧ 的字节断言红；写提示账本 ⇒ ① 的账本
  // 断言红；去掉声明工件存在性判据 ⇒ ⑥ 的 BLOCK 断言红（回到打印 ALL CHECKS PASSED 的假绿）。
  {
    name: '14 execute exit BLOCKED：串行 pending 未完成 + --preflight 结构化预检（结构先报/只读/分级/参数防护）',
    run: (dir) => {
      // SUMMARY 模板（夹具自带：两种检出形态下都确定，不依赖 vendored 模板在场）。H2 段集 = 登记表
      // 登记的全部 SUMMARY 段（含条件段）——坏 SUMMARY 的缺陷因此只暴露在「段形」这一层。
      writeFile(dir, 'flow-kit/templates/SUMMARY.md', [
        '# SUMMARY 模板',
        '',
        '## 做了什么（一段话）',
        '## 改动文件',
        '## verify 输出（必填）',
        '## 6 维自查（生产代码改动必填 · 来自 4-dev 步骤 4）',
        '## 数据库迁移（涉及 schema 变更必填 · 来自 4-dev 步骤 1.7 / R4.5）',
        '## 越界检查（必填 · 来自 4-dev 步骤 5 / R6.5 / B3 老项目护栏）',
        '## 破坏性变更（涉及破坏性改动必填 · 来自 4-dev 步骤 1.8 / R4.6 / B4 老项目护栏）',
        '## 决策与偏离（如有）',
        '## 是否触发新工作',
        '## 完成判定',
        '',
      ].join('\n'));
      const st = baseState('execute');
      st.newChange = true;
      st.enteredNodes = ['execute'];
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['P02']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' + TASK_P2);
      // 坏 SUMMARY：关键段齐（关键段门能过），但段形不合模板——标题缺 `# SUMMARY:`
      // 前缀、首部四字段缺席、段序偏离、缺「是否触发新工作」「完成判定」。这正是只有模板保真门
      // 才判、因而被更早的进展门挡住的结构问题。
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const serialExit = runGuard(['exit', 'execute'], dir);
      assertExit(serialExit, 1);
      assertOut(serialExit, '串行 pending');
      assertNotOut(serialExit, '模板结构校验失败');

      // ① 结构化预检：同一夹具下首报结构问题（不得报进展类）；且只读（state 字节与账本零改写）
      const preflightBytes = readStateBytes(dir);
      const pre = runGuard(['exit', 'execute', '--preflight'], dir);
      assertExit(pre, 1);
      assertOut(pre, 'PREFLIGHT: ');
      assertOut(pre, 'T01-SUMMARY.md 模板结构校验失败');
      assertOut(pre, '（模板: flow-kit/templates/SUMMARY.md）');
      assertOut(pre, '缺段 2 项'); // 首段形态：类别计数（缺段不列段名）
      assertNotOut(pre, '缺段 2 项:');
      assertNotOut(pre, '串行 pending');
      assertNotOut(pre, 'ALL CHECKS PASSED');
      assertStateBytesUnchanged(dir, preflightBytes, '--preflight 只读：不得写 state');
      assertTrue(!fs.existsSync(path.join(dir, '.specs', CHANGE_ID, '.template-hints.json')),
        '--preflight 不得写模板提示账本（.template-hints.json）');

      // ② 分级不变：同一坏 SUMMARY 在旧 change 只 WARN 不阻断（预检不得把旧 change 升级成 BLOCK）
      writeState(dir, { ...st, newChange: false });
      const oldChangeBytes = readStateBytes(dir);
      const oldChangePre = runGuard(['exit', 'execute', '--preflight'], dir);
      assertExit(oldChangePre, 0);
      assertOut(oldChangePre, 'TEMPLATE-STRUCTURE WARN');
      assertNotOut(oldChangePre, 'BLOCKED');
      assertStateBytesUnchanged(dir, oldChangeBytes, '旧 change 预检同样只读');
      writeState(dir, st);
      const restoredBytes = readStateBytes(dir);

      // ③ 参数防护 fail-closed：--preflight 与 --apply 同时给 ⇒ 用法错误（只读/写盘无合法语义）
      const conflict = runGuard(['exit', 'execute', '--preflight', '--apply'], dir);
      assertExit(conflict, 1);
      assertOut(conflict, '用法错误');
      assertOut(conflict, '--apply');
      assertStateBytesUnchanged(dir, restoredBytes, '用法错误路径不得写 state');
      const wrongCommand = runGuard(['entry', 'execute', '--preflight'], dir);
      assertExit(wrongCommand, 1);
      assertOut(wrongCommand, '用法错误');
      assertOut(wrongCommand, '只能与 exit');

      // ③b 未知参数 fail-closed（复审）：exit 的参数解析此前只认 --apply / --preflight 两个**已知**
      // token，其余一律忽略——于是「参数说错了但仍然跑」。两种真实形态都被这套语义接住：
      //   · `--bogus` 被静默忽略 ⇒ 一次看起来成功的预演（只读面被误当成通过）；
      //   · `--prefligh`（笔误）既不是预检、也不报错 ⇒ 静默走**完整出口链**，预检被当成全链预演。
      // 判据：未知 `--*` 一律用法错误（非零退出），且**不得**进入任何门禁链（不打印进展类报错）。
      // 正对照紧随其后（④：合法 `--preflight` 仍 exit 0 + ALL CHECKS PASSED）——同一夹具、单变量。
      const typo = runGuard(['exit', 'execute', '--prefligh'], dir);
      assertExit(typo, 1);
      assertOut(typo, '用法错误');
      assertOut(typo, '--prefligh');
      assertNotOut(typo, '串行 pending');
      assertStateBytesUnchanged(dir, restoredBytes, '笔误参数的用法错误路径不得写 state');
      const unknownPair = runGuard(['exit', 'execute', '--prefilter', '--bogus'], dir);
      assertExit(unknownPair, 1);
      assertOut(unknownPair, '用法错误');
      assertOut(unknownPair, '--prefilter');
      assertOut(unknownPair, '--bogus');
      assertNotOut(unknownPair, '串行 pending');
      assertStateBytesUnchanged(dir, restoredBytes, '未知参数的用法错误路径不得写 state');

      // ④ 结构干净 ⇒ 预检通过，且不打印 --apply 引导（预检不落盘，那行会误导）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      const okBytes = readStateBytes(dir);
      const ok = runGuard(['exit', 'execute', '--preflight'], dir);
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
      assertOut(ok, 'PREFLIGHT: structural checks only');
      assertNotOut(ok, 'APPLY: rerun with --apply');
      assertStateBytesUnchanged(dir, okBytes, '预检通过路径不得写 state');
      // 结构干净 ≠ 进展完成：串行 pending 仍在，完整 exit 照旧拦（预检不越权放行推进）
      const stillBlocked = runGuard(['exit', 'execute'], dir);
      assertExit(stillBlocked, 1);
      assertOut(stillBlocked, '串行 pending');

      // ⑤ 未知节点照既有报错（--preflight 不得把未知节点变成静默通过）
      const unknown = runGuard(['exit', 'no-such-node', '--preflight'], dir);
      assertExit(unknown, 1);
      assertOut(unknown, 'Unknown workflow Node: no-such-node');

      // 预检与完整出口共用同一结构报告器：父段正文留下 N/A 意图痕迹、却写不进白名单时，
      // 「该怎么写」属结构面反馈，预检必须一并带出——自持一份只读副本的实现会丢掉这一段，
      // 于是同一条结构问题在预检里只说「缺子段」、在收尾时却还给写法，两种模式的反馈不一致。
      // 夹具：6 维自查段写成「见 N/A …」（剥掉包裹后开头是实词，不算整段不适用），两条结构子段
      // 因此仍要求；该段保留 brooks-review 字样，关键段门照常通过。
      const adviceSummary = strictSummary('T01')
        .replace('- 功能: 通过（brooks-review 已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
          '见 N/A（六维由 brooks-review 覆盖）')
        .replace('### 已知接受 + 理由\n\n- 无（夹具）。\n\n### 已知小问题\n\n- 无（夹具）。\n\n', '');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', adviceSummary);
      const adviceBytes = readStateBytes(dir);
      const advice = runGuard(['exit', 'execute', '--preflight'], dir);
      assertExit(advice, 1);
      assertOut(advice, '缺结构子段 2 项');
      assertOut(advice, '若要整段不适用');
      assertOut(advice, '包裹符号本身就被接受');
      assertStateBytesUnchanged(dir, adviceBytes, '预检的写法建议路径同样只读');

      // ⑥ 空 open 节点（本缺陷的原始形态）：全新 change 的 `.specs/<id>/` 空目录、无 CHANGE.md /
      // REQUIREMENT.md。改前结构子集只查「在场者」⇒ 一件都没查、打印 ALL CHECKS PASSED（假绿）。
      // 本节点声明的 file 类工件（open: CHANGE.md + REQUIREMENT.md）是否在场是**结构事实**，不是
      // 进展判定：缺失必须 BLOCK，逐项给路径，并给一句「先创建该工件（按模板路径）」的指引。
      const openState = { ...baseState('open'), newChange: true, enteredNodes: ['open'] };
      fs.rmSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true, force: true });
      writeState(dir, openState);
      const emptyOpenBytes = readStateBytes(dir);
      const emptyOpen = runGuard(['exit', 'open', '--preflight'], dir);
      assertExit(emptyOpen, 1);
      assertOut(emptyOpen, 'BLOCKED');
      assertOut(emptyOpen, '.specs/' + CHANGE_ID + '/CHANGE.md');
      assertOut(emptyOpen, '.specs/' + CHANGE_ID + '/REQUIREMENT.md');
      assertOut(emptyOpen, '模板: flow-kit/templates/CHANGE.md');
      assertNotOut(emptyOpen, 'ALL CHECKS PASSED');
      assertStateBytesUnchanged(dir, emptyOpenBytes, '缺件预检同样只读：不得写 state');
      assertTrue(!fs.existsSync(path.join(dir, '.specs', CHANGE_ID, '.template-hints.json')),
        '缺件预检不得写模板提示账本（.template-hints.json）');

      // ⑦ 缺件与结构问题同轮报告（先列缺失件，再列结构问题）：CHANGE.md 在场但缺模板段、
      // REQUIREMENT.md 仍缺席 ⇒ 两类都要报——存在性不再被「在场才查」吞掉结构报告的时机。
      writeFile(dir, 'flow-kit/templates/CHANGE.md',
        '# CHANGE 模板\n\n## Why（为什么做）\n## What（做什么）\n## 影响面\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md',
        '# CHANGE: 夹具\n\n## Why（为什么做）\n\n理由。\n\n## 影响面\n\n夹具。\n');
      const mixedBytes = readStateBytes(dir);
      const mixed = runGuard(['exit', 'open', '--preflight'], dir);
      assertExit(mixed, 1);
      assertOut(mixed, 'BLOCKED');
      assertOut(mixed, '.specs/' + CHANGE_ID + '/REQUIREMENT.md');
      assertOut(mixed, 'CHANGE.md 模板结构校验失败');
      assertOut(mixed, '缺段 1 项'); // 首段形态：类别计数（缺段不列段名）
      assertNotOut(mixed, '缺段 1 项:');
      assertNotOut(mixed, 'ALL CHECKS PASSED');
      assertTrue(mixed.output.indexOf('.specs/' + CHANGE_ID + '/REQUIREMENT.md')
        < mixed.output.indexOf('CHANGE.md 模板结构校验失败'),
      '同轮报告应先列缺失工件、再列结构问题\n实际输出:\n' + mixed.output);
      assertStateBytesUnchanged(dir, mixedBytes, '缺件 + 结构问题同轮的预检只读');

      // ⑧ 工件齐但缺段（本缺陷修复后不得倒退的既有语义）：补上结构完整的 REQUIREMENT.md，
      // CHANGE.md 仍缺一段 ⇒ 只剩两阶段结构报文，且首段只报类别计数、不列段名。
      writeFile(dir, 'flow-kit/templates/REQUIREMENT.md',
        '# REQUIREMENT 模板\n\n## 用户故事（User Story）\n## 验收准则（AC）\n## 范围切分\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', [
        '# REQUIREMENT: 夹具',
        '',
        '## 用户故事（User Story）',
        '',
        '夹具故事。',
        '',
        '## 验收准则（AC）',
        '',
        '- AC-1: 夹具。',
        '',
        '## 范围切分',
        '',
        '### v1（本次必做）',
        '',
        '- 夹具。',
        '',
        '### v2（下一轮考虑，不本次）',
        '',
        '- 无。',
        '',
        '### out（永远不做）',
        '',
        '- 无。',
        '',
      ].join('\n'));
      const structureOnlyBytes = readStateBytes(dir);
      const structureOnly = runGuard(['exit', 'open', '--preflight'], dir);
      assertExit(structureOnly, 1);
      assertOut(structureOnly, 'BLOCKED: CHANGE.md 模板结构校验失败');
      assertOut(structureOnly, '缺段 1 项');
      assertNotOut(structureOnly, '缺段 1 项:');
      assertNotOut(structureOnly, '声明工件缺失');
      assertNotOut(structureOnly, 'ALL CHECKS PASSED');
      assertStateBytesUnchanged(dir, structureOnlyBytes, '两阶段结构报文路径同样只读');
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
      // 无 exit 推进史（completedNodes 空）→ 进行中保护不触发，routeNode 与产物推导同一节点
      // （反过度修复锚：若把「导入后继保护」放宽到无推进史形态，本断言即红）
      assertOut(res, '"routeNode": "codereview"');
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
