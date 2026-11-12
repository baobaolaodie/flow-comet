// state 命令族 · 流程面（单一归属）：init / status / next / select / record / advance。
// 本模块只编排各判定族的共享实现（state-io · state-determine · state-branch · state-evolve-hint ·
// state-intelscan · state-skillmarkers 与既有共享模块），不复制任何判据；argv = 进程参数原样
// （位置参数取值形态与入口分派前一致）。
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { route, hasSubagentNode, protocolTaskFilePath, resolveFixRollbackDecision, resolveFixRollbackState, applyFixRollbackRound, resolveFixReturnNode, isSingleSegmentChangeName, EXECUTE_FAMILY_NODE_IDS } from '../route-node.mjs';
import { taskOpeningAttrs, taskBlocks } from '../task-parsing.mjs';
import {
  NODE_PROTOCOL_FILES,
  declarationSkillTargets,
  inspectWorkflowPathSegments,
} from '../protocol-utils.mjs';
import { evidencePayloadProblems, looksLikeObjectLiteral, toPersistedProtocolPath } from '../state-schema.mjs';
import { formatLocalTimestamp, nowTimestamp } from '../time-utils.mjs';
import { probeProject, classify, printDetection, validateContext, printGenerationGuide } from '../context-init.mjs';
import { fileExists, findActiveChange, readState, writeState, specsDir, runRootDir, hasExactSpecsEntry, resolveChangeLocation, inFlightChangeName, stateFile, recoveryActionTextAt } from './state-io.mjs';
import { hasNodeSkillDeclaration, verifySkillLoadMarkers, verifyTemplateDeclaration } from './state-skillmarkers.mjs';
import { determineNode, normalAdvanceExempt } from './state-determine.mjs';
import { isInsideWorkTree, gitBranchName, branchExists, printBranchLine } from './state-branch.mjs';
import { printEvolveDueHint } from './state-evolve-hint.mjs';
import { reportIntelScanDrift } from './state-intelscan.mjs';
// 命令文本的唯一实现（平台化脚本根 + 整条路径加引号）：运行期 PREFLIGHT 与 handoff result /
// guard 恢复指引 / explain 的 COMMAND 行同源（L-067：同一推导两处表达必然分叉）。声明命令与守卫族
// 同一装配（declarationCommands）+ 本族的运行上下文（commandContext）——不再各拼一份文本。
import { commandContext, declarationCommands, protocolContextArgs, scriptCommand } from './state-explain.mjs';
// 协调者提示的单一来源：entry（门禁族）与 next / record（本模块）共用同一常量，各输出面逐字
// 一致。常量落在中立模块（state-explain）而不是门禁族——本模块只为一句措辞去依赖整个上游门禁面
// 是一条反向边——为此状态命令族不再 import 门禁族。
import { COORDINATOR_NOTICE } from './state-explain.mjs';

// 本模块位于 <技能包>/scripts/lib：脚本目录由自身位置推导一次（与 guard-evidence-gates 同形态）。
// 「自己在哪」是本模块可提供的事实，平台化与引号形态本身留在 state-explain。
const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --json-file 路径校验:解析后必须位于项目根内(拒绝相对/绝对形式的越界路径,
// 如 ../..、其他盘符——防读取任意文件内容进 evidence)。runRoot 内的绝对路径合法
// (场景内文件常见写法,与 record/handoff 的既有用法一致)。符号链接解析后的实际路径
// 同样必须在项目根内(词法校验不防 symlink 穿越——realpath 后再次校验)。
// 非字符串/空值(如 --json-file 为最后一个参数)→ 用法错误,不落 path.resolve
// (undefined 会抛 TypeError、空串解析为 runRoot 报 EISDIR——应是用法错误而非类型错误)
async function resolveJsonFileWithinRunRoot(jsonFile) {
  if (typeof jsonFile !== 'string' || jsonFile.trim() === '') {
    throw new Error('--json-file requires a path argument');
  }
  const runRoot = runRootDir();
  const abs = path.resolve(runRoot, jsonFile);
  const rel = path.relative(runRoot, abs);
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) {
    throw new Error('--json-file 路径必须在项目根内: ' + jsonFile);
  }
  // 统一对 runRoot 也 realpath——Windows 上 runRoot 可能是 8.3 短路径(如 LONGYI~1),
  // realpath 会展开为长路径,两者直接 relative 会误判越界
  const realRoot = await fs.realpath(runRoot);
  const real = await fs.realpath(abs);
  const realRel = path.relative(realRoot, real);
  if (path.isAbsolute(realRel) || realRel === '..' || realRel.startsWith('..' + path.sep)) {
    throw new Error('--json-file 路径经符号链接解析后越出项目根: ' + jsonFile);
  }
  return abs;
}

function generatedNodeSkillName(protocol, nodeId) {
  return protocol.name + '-' + nodeId;
}

function printNext(protocol, nodeId, executionMode = 'subagent') {
  if (!nodeId) {
    console.log('NEXT: done');
    return;
  }
  console.log('NEXT: auto');
  console.log('NODE: ' + nodeId);
  console.log('SKILL: ' + generatedNodeSkillName(protocol, nodeId));
  // 输出点名（机器点名下一节点技能）：下一节点实现技能必须经 Skill 工具加载——
  // skill 名取节点实现 skill（与 SKILL: 行一致；内置协议 = flow-comet-open 等）
  const implNode = (protocol.nodes ?? []).find((n) => n.id === nodeId);
  const implSkill = implNode && typeof implNode.implementation === 'object' && implNode.implementation !== null
    ? implNode.implementation.skill
    : null;
  if (implSkill) {
    console.log('LOAD SKILL: ' + implSkill + '（用 Skill 工具，禁止跳过）');
  }
  if (EXECUTE_FAMILY_NODE_IDS.has(nodeId)) {
    if (executionMode === 'direct' && nodeId === 'execute') {
      console.log('EXECUTION-MODE: direct（主代理直接执行串行任务，必须加载 flow-comet-dev 完整协议；parallel 任务仍由 subagent-execute 委托）');
    } else {
      // 现行架构口径（ADR-014 / 并行委派四属性契约）：委托按**平台的身份通道**判定，不是按
      // 建树方式；独立 worktree 只是「① 写权限」的一种实现，共享工作区同样受支持（边界来自
      // 互不重叠的任务写集、提交时点纪律与最小保护集）。文案取 guard-gates 的单一常量——
      // entry 与 next 逐字相同；旧句「只能通过 Agent 工具 worktree isolation 委托子代理」不得
      // 在任何一处复活。
      console.log('COORDINATOR: ' + COORDINATOR_NOTICE);
      console.log('EXECUTION-MODE: ' + (executionMode === 'direct' ? 'direct' : 'subagent'));
    }
  }
}

// ---------- 位置门（单一实现 · 身份在办时位置必须可解析） ----------
// 身份由状态判定（findActiveChange），位置由 state-io 的唯一解析器给出。两者分开之后出现一类新的
// 非法态：**身份在办但两处目录都没有**（running-orphan：目录被手工删除 / 搬移失败）。此时命令层
// 既不能照旧打 no-change（那是在说「没有在办 change」），也不能编一个节点出来——只能 fail-closed
// 点名两处路径。报文与退出码归本族（state-io 只回传 { ok, message }，自己不 exit），status / next /
// record 三面因此说同一句话。
async function requireChangeLocation(changeName, state) {
  const located = await resolveChangeLocation({
    root: runRootDir(),
    changeName,
    createdAt: state?.createdAt,
  });
  if (!located.ok) {
    console.error(located.message);
    process.exit(1);
  }
  return located.resolution;
}

// ---------- 节点视图（单一实现）：state 原值 / 产物推导 / 进行中保护 → 路由视图 ----------
// 「我现在该在哪个节点」只有这一份判定（同一事实两处实现必然分叉——LESSONS 的路由单一权威族）。
// 收敛前 next 内联一份、status 只报产物推导：同一 state 下两条命令报不同节点，执行者按任一输出
// 行动都可能撞上节点顺序门禁。收敛后三视图各归其位：
//   derivedNode = 产物推导（既有键 currentNode 的语义，逐字不变）；
//   stateNode   = state.currentNode 原值（既有键 stateCurrentNode 的语义，逐字不变）；
//   routeNode   = 经「进行中保护」/「Fix 受控归位」后的路由视图（next 的 NODE 行的唯一来源）。
// 纯判定：只读 state 与产物，不写 state、不打印（展示由各命令渲染）。
// 消费方：status / next（本模块）与 workflow-handoff 的 result 提示（import 本函数，不复制第二份
// 判定——Fix 归位态若在 handoff 侧另取 state.currentNode，会指到被 Fix 批次门禁拦下的源节点）。
//
// routeNode 为 null 是**合法取值**：此态 next 会 BLOCKED 且不打印 NODE（节点顺序门禁 / Fix 归位第 4
// 轮无授权 / 单趟零进展），视图不得编一个节点出来——编出来的那个就是「status 叫人去一个 next 不会去
// 的地方」。

// ---------- 「此态 next 会 BLOCKED」的只读判定（status 用） ----------
// next 有三条**不打印 NODE**、直接 BLOCKED 的分支：① Fix 受控归位第 4 轮无授权；② 节点顺序门禁
// （「疑似未 exit」）；③ 单趟零进展。只读视图若照常给节点，同一 state 下两条命令就是两个答案（执行者
// 按 status 动手必然撞 BLOCKED），故三个判定都在视图里求值、由 resolveNodeView 回报，next 消费同一
// 字段而不另判一份。
// BLOCKED 报文 → 单行原因（ROUTE: 行只放一句原因，完整报文与恢复指引仍由 next 打印）。
function blockedReason(message) {
  return String(message ?? '').split('\n')[0].replace(/^BLOCKED:\s*/, '');
}

// 单趟零进展防呆（三重防呆决策之二·状态机侧）：路由落在 execute/subagent-execute，但既无可委托的
// 并行任务（依赖已满足集合为空）又无串行 pending，且 TASK 尚未全 done——剩余 pending 全部是依赖
// 无法满足的孤儿并行任务（数据异常：depends_on 引用不存在的任务 id 或执行期出现依赖环）。命中即
// 返回 BLOCKED 报文（判定行 + 恢复指引行），否则 null。协议无 subagent-execute 节点时不适用
// （parallel 任务由 execute 直接消化，无孤儿语义）。依赖环的常规拦截点在 plan 出口（guard 前置），
// 此处兜底执行期数据异常（如手改 TASK 绕过签名校验的极端态）。
async function resolveZeroProgressBlock({ changeName, protocol, nodeId }) {
  if (!EXECUTE_FAMILY_NODE_IDS.has(nodeId)) return null;
  if (!hasSubagentNode(protocol)) return null;
  try {
    const zpBlocks = taskBlocks(await fs.readFile(protocolTaskFilePath(protocol, changeName, specsDir()), 'utf8'));
    const zpAttrs = zpBlocks.map(taskOpeningAttrs).filter(Boolean);
    const zpPending = zpAttrs.filter((a) => a.status === 'pending');
    if (zpPending.length === 0) return null;
    const zpDoneIds = new Set(zpAttrs.filter((a) => a.status === 'done' && a.id).map((a) => a.id));
    const zpEligible = zpBlocks.filter((block) => {
      const a = taskOpeningAttrs(block);
      if (!a || !a.parallel || a.status !== 'pending') return false;
      const depsMatch = block.match(/<depends_on>([\s\S]*?)<\/depends_on>/);
      if (!depsMatch || !depsMatch[1].trim()) return true;
      return depsMatch[1].trim().split(/[,\s]+/).filter(Boolean).every((d) => zpDoneIds.has(d));
    });
    const zpSerial = zpPending.filter((a) => !a.parallel);
    if (zpEligible.length === 0 && zpSerial.length === 0) {
      return [
        'BLOCKED: 路由零进展——既无可委托的并行任务（依赖已满足集合为空）也无串行 pending，但 TASK 尚有 ' + zpPending.length + ' 个未完成任务',
        '疑似孤儿并行任务依赖无法满足（检查 depends_on）：' + zpPending.map((a) => a.id).join(', ') + '——修正 depends_on 为真实存在且无环的任务 id 后重试；执行期出现此异常请核对 TASK.md 是否被手改',
      ].join('\n');
    }
  } catch {}
  return null;
}

// 节点顺序门禁（严格模式）→ BLOCKED 报文；判定与 next 的反例语义逐字不变（本函数自 next 内联判定
// 原样搬入，搬的是**同一份**判据与报文，不是第二份）：
// state.currentNode 非 null、不在 completedNodes、且 evidence 无该节点记录 → 上一节点从未 exit 就
// 推进。状态漂移校正保留：已完成节点（currentNode ∈ completedNodes，或 evidence 已记录——节点已被
// record/exit 处理过）正常推进不受影响；本判定只拦「证据完全缺失的疑似跳阶段」。
// 豁免两条（独立判断，任一成立即放行）：① 回退豁免（TASK.md 有 pending 回退修复任务 → execute 家族，
// 与 FIX-BATCH 决策同一谓词）；② 正常推进豁免（exit --apply 推进后的下一节点，见 normalAdvanceExempt）
// ——真乱序（跳节点）仍严格 BLOCK。
// 归属：next 曾内联这一份，而 status 照常给节点——同一 state 下「status 叫人 exit 一个 next 根本不会
// 打印的节点」。搬进共享视图后 next 只消费 view.blocked，两份判定不再可能分叉。
async function resolveNodeOrderBlock({ changeName, protocol, completedArr, state, changeDir = null }) {
  if (!state.currentNode || completedArr.includes(state.currentNode)) return null;
  const nodeEvidence = state.evidence && typeof state.evidence === 'object'
    ? state.evidence[state.currentNode]
    : null;
  if (nodeEvidence && typeof nodeEvidence === 'object' && !Array.isArray(nodeEvidence)) return null;
  const rollbackExempt = await resolveFixRollbackState({
    runRoot: runRootDir(), changeName, protocol, completedNodes: completedArr, currentNode: state.currentNode,
    history: state.history,
  });
  const advanceExempt = await normalAdvanceExempt(state, protocol, completedArr, state.currentNode, changeName, changeDir);
  if (rollbackExempt || advanceExempt) return null;
  // 第二行的恢复动作按目录在哪分叉——与出口侧（转移前置 / entry 记录门 / 证据门）同一实现
  // （state-io.recoveryActionTextAt）：目录已搬进归档时 advance / select 都走不通（select 要求活动
  // 目录在场，advance 的产物推导读活动路径），只给可执行的那一步（把目录移回活动位置）。活动态下
  // 该函数原样返回 activeText，输出因此与改动前逐字相同。
  return [
    'BLOCKED: 疑似未 exit 节点 ' + state.currentNode + '，先 workflow-guard.mjs exit ' + state.currentNode + ' --apply',
    '恢复: 确认当前节点实际已完成 → 用 exit <节点> --apply 正常推进；节点状态漂移/卡死 → '
      + recoveryActionTextAt(runRootDir(), changeName, '用 workflow-state.mjs advance（强制推进）或 select（切换 change）；禁止手改 state 机器字段'),
  ].join('\n');
}

// 回程态判定（与 next 的 RETURN 分支同一谓词）：resolveFixReturnNode 给出回程源节点、它就是
// state.currentNode，且产物推导确实把路由推到了它**之后**（跳过）⇒ next 保留源节点跑出口，路由视图
// 也只能是源节点。artifactNext 落在源节点之前（如 execute 产物缺失时回退）不是合法回程态——
// 回落既有门禁，不越界放宽。
async function resolveFixReturnTarget({ changeName, protocol, completedArr, state, derivedNode, currentNodeIdx, derivedIdx }) {
  if (!state.activeChange) return null;
  const sourceNode = await resolveFixReturnNode({
    runRoot: runRootDir(), changeName, protocol, completedNodes: completedArr,
  });
  if (sourceNode === null || sourceNode !== state.currentNode) return null;
  if (derivedNode === state.currentNode) return null;
  if (currentNodeIdx < 0 || derivedIdx <= currentNodeIdx) return null;
  return sourceNode;
}

// location = 位置门解析到的结果（state-io.resolveChangeDir）；缺省 null 时按 .specs/<changeName> 解析
// （既有形态）。产物推导必须与位置解析认同一个目录：目录搬进归档后仍按活动路径推导，视图会回退到
// 协议首节点（「移动后 record 打 NODE: open」的成因）。
export async function resolveNodeView({ changeName, protocol, state, location = null }) {
  const completedArr = Array.isArray(state.completedNodes) ? state.completedNodes : [];
  const changeDir = location === null ? null : location.relative;
  const derivedNode = await determineNode(changeName, protocol, completedArr, changeDir);
  // 进行中节点保护：currentNode 未 exit（不在 completedNodes）且已 entry（enteredNodes 含该节点）
  // 或已 record（evidence 记录过）→ 视为进行中（可能 exit 被内容级拦截后重跑），不校正推走——
  // 否则被拦截节点的 exit 前置校验（currentNode 匹配）无法重跑，advance/select 均不恢复 → 死结
  // （实测教训）。旧 state 无 enteredNodes 时回退 evidence 判定（既有语义不回归）。
  const currentNodeEvidence = state.currentNode && state.evidence && typeof state.evidence === 'object'
    ? state.evidence[state.currentNode]
    : null;
  const currentNodeEntered = !!(
    state.enteredNodes && Array.isArray(state.enteredNodes) && state.enteredNodes.includes(state.currentNode)
  );
  const routeIds = route(protocol).map((n) => n.id);
  const currentNodeIdx = state.currentNode ? routeIds.indexOf(state.currentNode) : -1;
  // 推导为 currentNode 的**路由后继**（与 guard 出口同源：把 currentNode 视为已完成再加入
  // completedNodes 求 resolveNextNode）→ 该节点产物已齐待 exit、路由自然推进到 derivedNode
  // （平行转换 plan→subagent-execute、趟间回流 subagent-execute→execute 均属此形态）→ 保护。
  // 反过度修复锚（同族：产物全齐但无推进史形态）：completedNodes 为空（无任何 exit 推进史，
  // currentNode 仅是初始陈旧节点）时不做路由后继保护——产物推导继续生效推进到最终节点。
  // 推导跳跃/跨节点或回退 → 产物权威校正(漂移,防过度修复)。静态直接后继兜底（串行推进原语义）。
  const routingSuccessorOfCurrent = state.currentNode
    ? await determineNode(changeName, protocol, [...completedArr, state.currentNode], changeDir)
    : null;
  // 「相等」还不是后继：等号只在两处推导同值时成立，派生的节点仍可能在 currentNode **之前**
  // （currentNode 之后的节点产物缺失 → 派生回退；或 Fix 归位把任务推回 execute）——此时按等号
  // 保护会把路由钉在 currentNode、吞掉产物权威校正（实测：verify 驻留 + REVIEW.md 缺失仍报
  // verify）。故补协议 route 顺序条件：derived 的下标必须严格大于 currentNode 的下标。
  // 两个例外都维持既有语义：① execute 家族之内——execute ⇄ subagent-execute 是同一个多趟
  // **循环**，route 里的一前一后不是先后关系（趟间回边本就是文档化转换）；波次收齐后只剩串行
  // pending 时若按序号判「之前」，next 会把 currentNode 推回 execute，波次出口再也无法重跑
  // （L-060 型死结）。② currentNode 不在协议 route 内（无先后可比）。
  const derivedIdx = routeIds.indexOf(derivedNode);
  const insideExecuteFamily = EXECUTE_FAMILY_NODE_IDS.has(derivedNode)
    && EXECUTE_FAMILY_NODE_IDS.has(state.currentNode);
  const derivedIsAfterCurrent = currentNodeIdx < 0
    || insideExecuteFamily
    || (derivedIdx >= 0 && derivedIdx > currentNodeIdx);
  const routingSuccessorProtects = !!(completedArr.length > 0
    && routingSuccessorOfCurrent !== null
    && routingSuccessorOfCurrent === derivedNode
    && derivedIsAfterCurrent);
  const derivedIsDirectSuccessor = currentNodeIdx >= 0
    && currentNodeIdx + 1 < routeIds.length
    && routeIds[currentNodeIdx + 1] === derivedNode;
  const derivedIsSuccessor = routingSuccessorProtects || derivedIsDirectSuccessor;
  const inProgress = !!(
    state.currentNode
    && !completedArr.includes(state.currentNode)
    && (currentNodeEntered
      || (currentNodeEvidence && typeof currentNodeEvidence === 'object' && !Array.isArray(currentNodeEvidence)))
    && derivedIsSuccessor
  );
  // Fix 受控归位（同一事实同一说法）：next 的 FIX-BATCH 分支在共享视图之前返回并打印归位目标，
  // status 只走共享视图 ⇒ 同一 state 下两条命令报不同节点，且 status 会叫人 exit 一个正在被
  // Fix 批次门禁拦下的源节点（C1）。此处只读消费同一决策（纯读：不写盘、不计轮次），命中即把
  // 归位目标作为路由视图——它是 next 的 NODE 行会打印的节点。
  const fixRollback = await resolveFixRollbackDecision({
    runRoot: runRootDir(),
    changeName,
    protocol,
    completedNodes: completedArr,
    currentNode: state.currentNode,
    history: state.history,
  });
  const fixRollbackTarget = fixRollback === null ? null : fixRollback.target;
  // 归位**只读预演**：next 在归位分支命中后会调 applyFixRollbackRound（唯一写点）计数，第 4 轮
  // 无授权时在任何写盘之前 BLOCK——status 若照常给节点，给的就是 next 根本不会打印的那个答案。
  // 预演在 state 的**副本**上跑同一 helper：阈值/授权/渐进放行的判据与 next 逐字同源（不是第二份
  // 实现），而真 state 的字段（含 fixRoundsByChange）不可能被改动，也不写盘（字节零改写）。
  const fixRollbackPreview = fixRollback === null
    ? null
    : applyFixRollbackRound({
      state: structuredClone(state),
      sourceNode: state.currentNode,
      decision: fixRollback,
    });
  // 三个 blocked 来源按 next 的分支顺序求值（同一先后，不是另一套优先级）：
  //   ① Fix 受控归位第 4 轮无授权（next 的 FIX-BATCH 分支最先 BLOCK）；
  //   ② 节点顺序门禁（next 的「疑似未 exit」）；
  //   ③ 单趟零进展。
  // 回程（fixReturnTarget）夹在 ② 之前：回程态下「源节点未出口」正是回程语义本身，顺序门禁不得推翻
  // next 的回程分支（next 的回程分支先于顺序门禁返回）；顺序门禁又先于零进展（零进展是路由落到
  // execute 家族后的形态，执行者先要处理当前节点）。零进展成立时不再求回程——与 next 的既有先后一致
  // （零进展态下回程分支不会被走到）。
  const fixRoundBlockedMessage = fixRollbackPreview?.blocked ? fixRollbackPreview.blockedMessage : null;
  const zeroProgressMessage = fixRoundBlockedMessage === null
    ? await resolveZeroProgressBlock({ changeName, protocol, nodeId: derivedNode })
    : null;
  const fixReturnTarget = fixRoundBlockedMessage === null && zeroProgressMessage === null
    ? await resolveFixReturnTarget({
      changeName, protocol, completedArr, state, derivedNode, currentNodeIdx, derivedIdx,
    })
    : null;
  const orderBlockedMessage = fixRoundBlockedMessage === null && fixReturnTarget === null
    ? await resolveNodeOrderBlock({ changeName, protocol, completedArr, state, changeDir })
    : null;
  const blockedMessage = fixRoundBlockedMessage ?? orderBlockedMessage ?? zeroProgressMessage;
  const blocked = blockedMessage === null
    ? null
    : { message: blockedMessage, reason: blockedReason(blockedMessage) };
  return {
    derivedNode,
    stateNode: state.currentNode ?? null,
    // 优先级与 next 的分支顺序一致：BLOCKED（不打印节点）→ Fix 归位 → 回程 → 进行中保护 → 产物推导。
    // Fix 归位优先于进行中保护：保护输出的是源节点，而归位态下源节点的动作（exit）会被拦下。
    routeNode: blocked !== null
      ? null
      : (fixRollbackTarget ?? fixReturnTarget ?? (inProgress ? state.currentNode : derivedNode)),
    inProgress,
    fixRollbackTarget,
    fixReturnTarget,
    blocked,
  };
}

// 人读诊断（status）：JSON 块之后的一行三视图对账——derived = 产物推导、state = state 原值、
// route = 路由视图（= next 的 NODE）；尾部原因与 printWhyLine 的分支一一对应（同一停留原因在四个
// 输出面上说同一句话）：Fix 归位态点名「先按 next 的 FIX-BATCH 归位」——此时源节点的 exit 会被 Fix
// 批次门禁拦下，指引不得指向它；回程态说明「产物在场且未出口、保留源节点跑出口」——否则两列并排
// 却不给原因，读起来就是「产物推导指向源节点」；进行中点名「先 exit 该节点」。
// 前缀严格为 `ROUTE: `。
// BLOCKED 态（route=null）与 next 的实际行为一致：next 此刻不打印 NODE 而是直接 BLOCKED，ROUTE: 行
// 因此明确写「next 将 BLOCKED：<原因>」并把人推回恢复指引，而不是编一个节点让人去跑。
function formatRouteLine(view) {
  const head = 'derived=' + (view.derivedNode ?? 'null') + '（产物推导）'
    + ' state=' + (view.stateNode ?? 'null') + '（state 原值）';
  if (view.blocked !== null) {
    return head + ' route=null（路由视图）；next 将 BLOCKED：' + view.blocked.reason + '（先按恢复指引处理）';
  }
  const tail = view.fixRollbackTarget
    ? '；Fix 批次：先按 next 的 FIX-BATCH 归位 ' + view.fixRollbackTarget + ' 并跑完其出口'
    : (view.fixReturnTarget
      ? '；回程：产物在场且未出口——保留源节点 ' + view.routeNode + ' 跑出口'
      : (view.inProgress
        ? '；进行中：' + view.stateNode + ' 已 entry 未 exit——先 exit ' + view.stateNode + ' 再推进'
        : ''));
  return head + ' route=' + (view.routeNode ?? 'null') + '（路由视图）' + tail;
}

// 人读诊断（next）：为什么停在这个节点。四种停留原因在同一实现里各有一段文案：
//   · Fix 受控归位——归位目标待跑出口（源节点此时 exit 会被 Fix 批次门禁拦下，指引不得指向 exit）；
//   · 回程——产物已在场把路由推后，但源节点未出口（保留源节点跑出口，不是「产物推导指向源节点」）；
//   · 进行中——已 entry 未 exit（保护生效），动作是 exit 本节点；
//   · 其余——产物推导。
// 共享节点视图路径、Fix 归位分支与回程分支都经本函数：同源不只在 NODE 行，解释行也是同一段文案。
function printWhyLine(view) {
  if (view.routeNode === null) return;
  let reason;
  if (view.fixRollbackTarget) {
    reason = 'Fix 批次归位 ' + view.fixRollbackTarget
      + (view.stateNode ? '（源节点 ' + view.stateNode + '）' : '')
      + '——先跑 ' + view.fixRollbackTarget + ' 四类出口，再回源节点 exit';
  } else if (view.fixReturnTarget) {
    // 回程态：节点停在源节点不是产物推导的结果（产物已把它推后），解释必须说清「为什么保留源节点」——
    // 否则 WHY: 行会把它读成「产物推导指向源节点（无进行中节点）」这类错因。
    reason = '回程源节点 ' + view.routeNode + '：产物在场且未出口，保留源节点跑出口';
  } else if (view.inProgress) {
    reason = '停在 ' + view.routeNode + '——已 entry 未 exit（进行中保护），先 exit ' + view.routeNode + ' 再推进';
  } else {
    reason = '产物推导指向 ' + view.routeNode + '（无进行中节点）';
  }
  console.log('WHY: ' + reason);
}

// 结构预检提示的命令段（单一实现，两个运行期输出面共用：next 与 handoff result）：--preflight 只跑
// 结构性门禁（不写 state、不写提示账本、不推进状态），它**不是**节点收尾的预演——完整 exit（不带
// --apply）才是全链预演。两句必须同行，否则同一个 PREFLIGHT 会被读成两条命令。节点由
// 调用方按**路由视图**传入（与 NODE 行同源），不得取 state 原值：Fix 归位态下源节点的 exit 会被
// Fix 批次门禁拦下。
export function structuralPreflightHint(nodeId) {
  // 命令文本与 handoff result 的 PREFLIGHT 走同一实现（scriptCommand）：平台化脚本根 + 整条
  // 路径加引号——裸脚本名在 codex / dsh 单平台安装上照抄会落空（pathReplacements 只处理 .md）。
  return '可运行 ' + scriptCommand({
    scriptsDir, runRoot: runRootDir(), script: 'workflow-guard.mjs', args: ['exit', nodeId, '--preflight'],
  }) + ' 做结构预检（只跑结构性门禁，不写 state、不推进状态）；完整 exit（不带 --apply）是节点收尾的全链预演';
}

// 预检提示（next）：只在 execute / subagent-execute 路由上打印——让每任务的模板结构反馈前移到
// 任务收尾，而不是攒到节点出口。贴什么命令、两句如何分工见 structuralPreflightHint（单一实现）。
function printPreflightLine(nodeId) {
  if (!nodeId || !EXECUTE_FAMILY_NODE_IDS.has(nodeId)) return;
  console.log('PREFLIGHT: ' + structuralPreflightHint(nodeId));
}

// ---------- init 覆盖在途 change：默认阻断 + --replace 留档 ----------
// 「进行中」的身份口径与 status / next / record 同一份（state.activeChange 非空 ∧ status ≠
// 'completed'，判据 = state-io.inFlightChangeName）：只有**另一个** change 在办才进闸门——同 id
// 重跑走既有 WARN 路径（不阻断，行为不变）。覆盖别的 change 会连同它的节点进度 / evidence 一起
// 清掉，是破坏性动作，故「沉默即拒绝」：必须显式 --replace <在途 change> --reason <非空原因>，
// 且放行前先把旧 state 按**原始字节**留档（快照 + 记录）到旧 change 目录的 recovery/。留档写不成
// 就不覆盖——旧状态不得无痕消失。无在途 change 时整段不进入：零备份、零新参数要求，正常 init 的
// 输出保持原样。
//
// 位置：留档落点走唯一解析器（resolveChangeLocation）而不是硬拼 .specs/<旧>/——在办 change 可能
// 已被搬进 .specs/archive/（移动后尚未 exit），留档必须跟着 change 走；两处都没有 / 多候选判不出
// 时拒绝覆盖（拿不准落点就不许销毁旧状态）。
//
// 返回：null（无需留档）或 RECOVERY 块要打印的信息；任何不合法的放行形态在这里 fail-closed
//（BLOCKED + 非零退出，state 字节零改写），调用方不重复判定。
async function gateInitOverInFlightChange({ protocolArgv, changeName, prevState, replaceChange, replaceReason }) {
  const inFlightChange = inFlightChangeName(prevState);
  if (!inFlightChange || inFlightChange === changeName) return null;
  const context = commandContext({ argv: protocolArgv, runRoot: runRootDir() });
  const stateDisplay = path.relative(runRootDir(), stateFile()).split(path.sep).join('/');
  const statusCommand = scriptCommand({
    scriptsDir: context.scriptsDir, runRoot: context.runRoot, script: 'workflow-state.mjs', args: ['status'],
  });
  // 恢复指引里的**那一条命令**：形态与 record / 声明命令同源（平台化脚本路径 + 整条加引号），
  // 参数面按本次实际调用生成（--protocol 上下文同样带上），照抄即可执行。
  const replaceCommand = scriptCommand({
    scriptsDir: context.scriptsDir,
    runRoot: context.runRoot,
    script: 'workflow-state.mjs',
    args: ['init', changeName, '--replace', inFlightChange, '--reason', '"<原因>"', ...protocolContextArgs(context)],
  });
  const inFlightShape = '（status: ' + String(prevState?.status ?? '-')
    + '，当前节点: ' + String(prevState?.currentNode ?? '-') + '）';
  const block = (lines) => {
    for (const line of lines) console.error(line);
    process.exit(1);
  };
  if (replaceChange === null) {
    block([
      'BLOCKED: 在途 change "' + inFlightChange + '" 尚未完成' + inFlightShape
        + '——init "' + changeName + '" 会覆盖它的机器状态（节点进度 / evidence），默认阻断；未改写任何状态。',
      '恢复: ① 先完成在途 change（查看进度: ' + statusCommand + '）；',
      '     ② 或确认覆盖并留档后重跑: ' + replaceCommand,
    ]);
  }
  if (replaceChange !== inFlightChange) {
    block([
      'BLOCKED: --replace 的 change 名 "' + replaceChange + '" 与在途 change "' + inFlightChange
        + '" 不一致——只能覆盖当前在办的那一个；未改写任何状态。',
      '恢复: ' + replaceCommand,
    ]);
  }
  if (replaceReason === null || replaceReason.trim() === '') {
    block([
      'BLOCKED: --replace "' + inFlightChange + '" 还需要非空的 --reason <原因文本>（原因会写进留档，'
        + '供事后追溯）；未改写任何状态。',
      '恢复: ' + replaceCommand,
    ]);
  }
  // change 名形态 = 单段目录名（与受控重入 / select 同一判据）：不合法就没有可落笔的留档位置
  if (!isSingleSegmentChangeName(inFlightChange)) {
    block([
      'BLOCKED: 在途 change 名 "' + inFlightChange + '" 不是单段目录名——拒绝在它名下写留档；未改写任何状态。',
      '恢复: 修正 ' + stateDisplay + ' 的 activeChange（机器字段由脚本通道写，不要手改）后重跑。',
    ]);
  }
  const location = await resolveChangeLocation({
    root: runRootDir(),
    changeName: inFlightChange,
    createdAt: prevState?.createdAt,
  });
  if (!location.ok) {
    block([
      'BLOCKED: 覆盖前必须先把在途 change "' + inFlightChange + '" 的旧状态留档，但它的目录解析不到——未改写任何状态。',
      '原因: ' + location.message.replace(/^BLOCKED: /, ''),
      '恢复: 先运行 ' + statusCommand + ' 查看位置解析结果，按提示恢复该目录后重跑。',
    ]);
  }
  const stamp = formatLocalTimestamp();
  const stampSafe = stamp.replace(/:/g, '-');
  const recoveryDir = path.join(location.resolution.dir, 'recovery');
  const recoveryDisplay = location.resolution.display + '/recovery';
  const snapshotName = stampSafe + '-pre-init.state.json';
  const recordName = stampSafe + '-pre-init.md';
  const snapshotDisplay = recoveryDisplay + '/' + snapshotName;
  const recordDisplay = recoveryDisplay + '/' + recordName;
  // 回滚 = 把快照字节原样写回状态文件。命令用 node + copyFileSync 而不是 cp / copy：cp 在 cmd 下
  // 不存在、copy 是内建命令且覆盖时会二次确认——两条路径参数各自加引号，跨平台整行可照抄。
  const rollbackCommand = 'node -e "require(\'fs\').copyFileSync(process.argv[1],process.argv[2])"'
    + ' "' + snapshotDisplay + '" "' + stateDisplay + '"';
  const recordLines = [
    '# 留档：init 覆盖在途 change "' + inFlightChange + '"',
    '',
    '- **时间**: ' + stamp,
    '- **init 目标**: ' + changeName,
    '- **覆盖前状态**: change `' + inFlightChange + '` · currentNode `' + String(prevState?.currentNode ?? '-')
      + '` · status `' + String(prevState?.status ?? '-') + '`',
    '- **原因**: ' + replaceReason,
    '- **快照**: ' + snapshotDisplay + '（旧状态文件的逐字节副本）',
    '- **回滚命令**（在项目根执行，恢复旧状态字节）:',
    '',
    '```bash',
    rollbackCommand,
    '```',
    '',
  ];
  try {
    // 逐字节：读原始 bytes、写同一份 bytes（BOM / 行尾都不改）——JSON 深比会漏掉格式化与序列化漂移
    const snapshotBytes = await fs.readFile(stateFile());
    await fs.mkdir(recoveryDir, { recursive: true });
    await fs.writeFile(path.join(recoveryDir, snapshotName), snapshotBytes);
    await fs.writeFile(path.join(recoveryDir, recordName), recordLines.join('\n'), 'utf8');
  } catch (error) {
    block([
      'BLOCKED: 在途 change "' + inFlightChange + '" 的旧状态留档写入失败（' + error.message + '）——未改写任何状态。',
      '恢复: 检查 ' + recoveryDisplay + '/ 的写权限后重跑同一条命令。',
    ]);
  }
  return {
    inFlight: inFlightChange,
    currentNode: String(prevState?.currentNode ?? '-'),
    status: String(prevState?.status ?? '-'),
    snapshotDisplay,
    recordDisplay,
    rollbackCommand,
  };
}

// init <change-id> [--branch-prefix <prefix>] [--init-context|--init-skip]
//      [--replace <在途 change> --reason <原因>]
// protocolPath = 入口 resolveProtocol 解析出的协议路径（协议来源绑定的持久化取值）
export async function runInit(protocol, argv, protocolPath) {
  const changeName = argv[3];
  if (!changeName) throw new Error('init requires a change name.');
  // trim 后校验:带前导/尾随空白的输入(如 " --help")不得绕过 flag 检测;
  // 纯空白与缺参同义
  const normalizedChangeName = changeName.trim();
  if (!normalizedChangeName) throw new Error('init requires a change name.');
  // 参数误用防护:以 -- 开头的参数(如 --help)是选项不是 change 名——报错并提示用法,
  // 防止被当作 change id 执行(自动开 change、建分支、写状态——有破坏性)
  if (normalizedChangeName.startsWith('--')) {
    throw new Error('init: ' + normalizedChangeName + ' looks like a flag, not a change name. Usage: workflow-state.mjs init <change-id> [--branch-prefix <prefix>] [--init-context|--init-skip] [--replace <in-flight-change> --reason <text>]');
  }
  // --branch-prefix <prefix>（缺省 'change/'）；--init-context / --init-skip（自动初始化检测授权）
  // --replace <在途 change> / --reason <原因>：覆盖另一个在途 change 的显式放行参数（缺省 = 默认阻断；
  // 取值形态在这里只做「有没有给 / 给了什么」，是否放行由下方覆盖闸门单点判定）
  let branchPrefix = 'change/';
  let initContext = false;
  let initSkip = false;
  let replaceChange = null;
  let replaceReason = null;
  const initArgs = argv.slice(4);
  for (let i = 0; i < initArgs.length; i++) {
    if (initArgs[i] === '--branch-prefix') {
      const value = initArgs[i + 1];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error('--branch-prefix requires a non-empty prefix (e.g. feat/)');
      }
      branchPrefix = value.trim().endsWith('/') ? value.trim() : value.trim() + '/';
    } else if (typeof initArgs[i] === 'string' && initArgs[i].startsWith('--branch-prefix=')) {
      const value = initArgs[i].slice('--branch-prefix='.length);
      if (value === '') {
        throw new Error('--branch-prefix requires a non-empty prefix (e.g. feat/)');
      }
      branchPrefix = value.endsWith('/') ? value : value + '/';
    } else if (initArgs[i] === '--init-context') {
      initContext = true;
    } else if (initArgs[i] === '--init-skip') {
      initSkip = true;
    } else if (initArgs[i] === '--replace' || initArgs[i] === '--reason') {
      // 空格形与等号形同义（与 --branch-prefix 的既有形态一致）：值缺失 / 空串不在这里 exit——
      // 形态不符的报文与退出码由下方覆盖闸门统一给出（同一件事一处措辞），这里只记录「给了什么」。
      const value = initArgs[i + 1];
      const text = typeof value === 'string' ? value.trim() : '';
      if (initArgs[i] === '--replace') replaceChange = text; else replaceReason = text;
    } else if (typeof initArgs[i] === 'string'
      && (initArgs[i].startsWith('--replace=') || initArgs[i].startsWith('--reason='))) {
      const equalsAt = initArgs[i].indexOf('=');
      const text = initArgs[i].slice(equalsAt + 1).trim();
      if (initArgs[i].slice(0, equalsAt) === '--replace') replaceChange = text; else replaceReason = text;
    }
  }
  // 自动初始化检测（前置步骤）：读旧 state（项目级字段跨 change 保留）→ 探测 → 判决 → 提示/执行
  // 生成职责：--init-context 时 CONTEXT 缺失 → 输出 INIT-GENERATE 指引，由 agent 全量阅读生成
  // （intel-scan 语义）；生成后重跑 → 脚本校验 7 段结构 → 通过写 last_intel_scan（确定性校验）。
  let prevState = null;
  try { prevState = await readState(); } catch { prevState = null; }
  // init 覆盖在途 change：默认阻断 + --replace 留档——判定与留档收在单一实现
  //（gateInitOverInFlightChange），本处只取它给出的留档信息用于成功路径的 RECOVERY 块。
  const initRecovery = await gateInitOverInFlightChange({
    protocolArgv: argv, changeName, prevState, replaceChange, replaceReason,
  });
  const probe = await probeProject(runRootDir(), prevState);
  const verdict = classify(probe, prevState);
  let ctxValid = null; // null=未进入校验（非 init-context 或已新鲜）；true/false=校验结果
  if (initContext || initSkip) {
    // 显式授权路径：--init-context 生成协作（agent 生成 + 脚本校验）；--init-skip 记 none
    if (initContext) {
      // 显式 --init-context 总是校验结构（含 verdict=skip 新鲜/记忆场景）——防 CONTEXT 损坏漏检
      let ctxExists = false;
      try { await fs.access(path.join(specsDir(), 'CONTEXT.md')); ctxExists = true; } catch { /* 文件不存在 */ }
      if (ctxExists) {
        const { missingSections, formatIssues } = await validateContext(runRootDir());
        if (missingSections.length === 0 && formatIssues.length === 0) {
          ctxValid = true;
          if (verdict === 'skip') {
            console.log('INIT-DONE: 项目上下文已存在且新鲜，跳过生成。');
          } else {
            console.log('INIT-DONE: 项目上下文（CONTEXT.md）已就绪（7 段 + 模板格式校验通过）。');
          }
        } else {
          // 存在但不满足模板（缺段/格式不符/损坏）——引导 agent 重写（保留既有累积内容）
          const problems = [...formatIssues, ...missingSections.map((s) => '缺段 ' + s)];
          await printGenerationGuide(runRootDir(), probe, { rewrite: true, problems });
        }
      } else if (verdict !== 'skip') {
        await printGenerationGuide(runRootDir(), probe);
      }
      // verdict=skip（记忆 A 拒绝 / 新鲜 B）且 CONTEXT 缺失 → 尊重既有决策，不输出
    }
    if (initSkip && !initContext) {
      console.log('INIT-SKIPPED: 已记录跳过初始化。');
    }
  } else {
    await printDetection(runRootDir(), probe, verdict);
  }
  // init 同 id 重跑防护——.specs/<id>/ 已存在或 activeChange 相同 → WARN 不阻断
  //（向后兼容；正常流程 init 只在 open 前执行一次，防护针对误操作清空进度）
  let specsDirExists = false;
  try { await fs.access(path.join(specsDir(), changeName)); specsDirExists = true; } catch { /* 目录不存在 */ }
  if (prevState?.activeChange === changeName || specsDirExists) {
    console.error('WARN: change ' + changeName + ' 已存在——重跑 init 将重置节点状态（completedNodes/evidence 清空）。若需继续已有 change，请用 advance/select 而非重跑 init。');
  }
  // E1: branchMode 自动判定——git 仓库 → true；非 git 仓库 → false。git 命令一律以运行根为 cwd
  //（state-branch 族统一取 runRootDir）——分支判定/创建与状态落点因此跟同一个根，不会一个走 cwd、
  // 一个走变量根。
  const branchMode = isInsideWorkTree();
  const state = {
    activeChange: changeName,
    // 协议来源绑定：init 解析出的协议路径持久化（项目根相对 POSIX；旧 state 缺字段 = 未绑定，
    // 归属/节点门禁按渐进语义回退环境变量/默认协议）
    protocolPath: toPersistedProtocolPath(runRootDir(), protocolPath),
    // currentNode 取协议首节点（内置协议 = open，行为不变；自定义协议 = 首节点，如 brainstorm）
    currentNode: route(protocol)[0]?.id ?? 'open',
    completedNodes: [],
    evidence: {},
    verifyFailures: 0,
    // verifyFailures 按 change 存储——init 新 change 从零计数(切换 change 不串扰)
    verifyFailuresByChange: {},
    // Fix 受控归位轮次按 change 存储——init 写空对象；旧 state 缺字段按 0 读取
    fixRoundsByChange: {},
    executionMode: 'subagent',
    directOverride: false,
    branchMode,
    enablePrReview: false,
    branchPrefix,
    status: 'running',
    // 进入证据容器——entry 追加节点;未 entry 检测强制
    enteredNodes: [],
    createdAt: new Date().toISOString(),
    // 项目级上下文字段跨 change 保留（迁移旧 state；--init-context 刷新扫描时间；--init-skip 记拒绝）
    ...(prevState?.ai_context_doc !== undefined ? { ai_context_doc: prevState.ai_context_doc } : {}),
    ...(initSkip ? { ai_context_doc: 'none' } : {}),
    // last_intel_scan 仅在校验通过后写入（agent 生成 → 脚本校验 7 段 → 记录扫描时间）；形态一律经
    // time-utils 的 nowTimestamp()（本地时间 + 显式偏移）——与 context-scan 的落点形态同源，不在本
    // 模块内联第二份格式化。段侧**不在本命令的写面内**（该段行的改写与备份只有 context-scan 一份
    // 实现）：两处取值不一致由 reportIntelScanDrift 检出并给出可见提示，不静默漂移。
    ...(ctxValid === true
      ? { last_intel_scan: nowTimestamp() }
      : (prevState?.last_intel_scan !== undefined ? { last_intel_scan: prevState.last_intel_scan } : {})),
    // last_evolve_at 同为**项目级**字段（evolve 的跨 change 基线，写通道 = config set）——init 换
    // change 必须原样保留：丢了它，增量窗口静默退化为全量扫描、到期提示从此不再触发（保留判据与
    // 上一行同形：字段缺席 = 从未跑过 evolve，不得凭空制造该字段——state-schema 不接受 null）
    ...(prevState?.last_evolve_at !== undefined ? { last_evolve_at: prevState.last_evolve_at } : {})
  };
  await writeState(state);
  // 扫描时刻的双落点一致性（state ↔ `.specs/CONTEXT.md` 的 `## intel-scan 元数据` 段）：本命令写
  // state 后即比对段侧取值——不一致（含同一时刻的两种形态）输出可见提示并点名收敛命令；一致或
  // 无可比对面则静默（不误报）。段行的写通道只有 context-scan，故此处是检测、不是第二份改写实现。
  await reportIntelScanDrift(path.join(specsDir(), 'CONTEXT.md'), state.last_intel_scan);
  // init 创建 .specs/<id>/ 目录——文件即真相从 init 起成立，findActiveChange 立即可识别
  //（init 不创建该目录时，next/status 会报 No active change，与 SKILL 启动协议 init → next 矛盾）
  const specsChangeDir = path.join(specsDir(), changeName);
  await fs.mkdir(specsChangeDir, { recursive: true });
  // 分支创建——branchMode && 当前分支 ≠ <prefix><id> && 分支不存在 → git checkout -b
  // 前缀由 --branch-prefix 指定（缺省 'change/'，向后兼容；可适配仓库自身分支规范如 feat/）
  // 失败 → WARN 不 BLOCK，继续纯文件模式（向后兼容）
  const expectedBranch = branchPrefix + changeName;
  // 空仓库状态(带到 BRANCH 输出——声称与实际一致:空仓库无分支)
  let emptyRepo = false;
  if (branchMode) {
    const currentBranch = gitBranchName();
    // 空仓库检测——无提交(git rev-parse HEAD 失败)时分支创建不可行,输出提示
    // (不 BLOCK;纯文件模式继续)并跳过分支创建——警告与行为一致(跳过时 BRANCH 行
    // 若仍声称分支已创建,即与实际矛盾)
    try {
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runRootDir(), stdio: 'pipe' });
    } catch {
      emptyRepo = true;
    }
    if (emptyRepo) {
      console.error('INIT EMPTY-REPO WARN: 仓库无提交(git 空仓库),无法创建 ' + expectedBranch + ' 分支——先 git commit 初始提交再 init 启用分支模式,或继续纯文件模式');
    } else if (currentBranch !== null && currentBranch !== expectedBranch && !branchExists(expectedBranch)) {
      try {
        execFileSync('git', ['checkout', '-b', expectedBranch], { cwd: runRootDir(), stdio: 'pipe' });
      } catch {
        console.error('WARN: 创建分支 ' + expectedBranch + ' 失败——继续纯文件模式（分支功能降级；可稍后手动 git checkout -b ' + expectedBranch + '）');
      }
    }
  }
  console.log('Initialized: ' + changeName);
  console.log('BRANCH: ' + (branchMode && !emptyRepo ? expectedBranch : 'none（非 git 仓库或空仓库）'));
  // 留档可见性：覆盖在途 change 的异常路径必须在成功输出里**看得见**——快照路径 + 回滚命令
  // 整行可照抄（回滚命令只在 RECOVERY 块里给一次，.md 记录里是同一行）。
  if (initRecovery) {
    console.log('RECOVERY: 在途 change "' + initRecovery.inFlight + '" 的状态已留档（覆盖前 currentNode: '
      + initRecovery.currentNode + ' · status: ' + initRecovery.status + '）');
    console.log('RECOVERY: 快照 ' + initRecovery.snapshotDisplay);
    console.log('RECOVERY: 记录 ' + initRecovery.recordDisplay);
    console.log('RECOVERY: 回滚 ' + initRecovery.rollbackCommand);
  }
  // init 输出取协议首节点（与 state.currentNode 一致——内置协议 = open，行为不变）
  printNext(protocol, route(protocol)[0]?.id ?? 'open');
  return;
}

// status：只读输出当前 change 与节点（派生视图 + 分支行 + evolve 到期提示）
export async function runStatus(protocol) {
  const changeName = await findActiveChange();
  if (!changeName) {
    console.log(JSON.stringify({ status: 'no-change', message: 'No active change in .specs/' }, null, 2));
    // 到期提示属**项目级**元数据（与是否有 active change 无关）：无活跃 change 时同样按阈值输出
    await printEvolveDueHint(await readState());
    return;
  }
  const state = await readState();
  // 位置门（先于任何视图）：身份在办但两处目录都没有 → fail-closed，**不得**回落到 no-change
  // （no-change 的语义是「没有在办 change」，与这里的事实相反）。
  const location = await requireChangeLocation(changeName, state);
  // 节点视图（与 next 共用同一判定）：currentNode 仍取产物推导（既有键语义逐字不变），
  // routeNode 才是经「进行中保护」后的路由视图（= next 的 NODE 行）。
  const nodeView = await resolveNodeView({ changeName, protocol, state, location });
  const detectedNode = nodeView.derivedNode;
  // 派生视图（ADR-013 决策 11；改为事件为准）：被强制推进的节点以
  // state.history 中本 change 的 advance-forced 事件为唯一判据——按 change 过滤（兼容旧事件
  // 无 change 字段），取 e.node 集合后与 completedNodes 求交。旧「completedNodes 含而 evidence
  // 不含」推断会漏报两类真实反例：① record 后被 advance；② replan/reenter 写授权留痕
  // （evidence.<node>.replanAuthorization）后被 advance。state.history === undefined 的旧 state
  // 无事件可依（advance 当时无痕）→ 回退本「缺 evidence」判据。
  const completedArr = Array.isArray(state.completedNodes) ? state.completedNodes : [];
  let forcedNodes;
  if (state.history === undefined) {
    const evidenceMap = state.evidence && typeof state.evidence === 'object' && !Array.isArray(state.evidence)
      ? state.evidence
      : {};
    forcedNodes = completedArr.filter((id) => {
      const record = evidenceMap[id];
      return !(record && typeof record === 'object' && !Array.isArray(record));
    });
  } else {
    const forcedSet = new Set(
      (Array.isArray(state.history) ? state.history : [])
        .filter((e) => e
          && e.event === 'advance-forced'
          && (typeof e.change !== 'string' || e.change === changeName))
        .map((e) => e.node)
    );
    forcedNodes = completedArr.filter((id) => forcedSet.has(id));
  }
  console.log(JSON.stringify({
    status: 'running',
    change: changeName,
    currentNode: detectedNode,
    stateCurrentNode: state.currentNode,
    // 增量字段：next 会打印的路由视图（进行中保护后的节点）；不写 state、既有键语义不变
    routeNode: nodeView.routeNode,
    completedNodes: state.completedNodes,
    forcedNodes,
    executionMode: state.executionMode ?? 'subagent',
    directOverride: state.directOverride ?? false,
    branchMode: isInsideWorkTree(),
    enablePrReview: state.enablePrReview ?? false,
    // 产物根 = 位置解析到的目录（活动 / 归档）：移动后仍报 .specs/<id> 就是在说一个不存在的落点。
    artifactRoot: location.display,
    // 与 routeNode 同一判定（One predicate）：本键回答「协调者模式是否生效」，必须指向路由视图
    // 那个节点——若另取产物推导，进行中态会在同一响应里给出两个「当前节点」口径（routeNode=
    // execute 而 coordinatorMode=false）。既有键名/类型/位置不变，只换判定来源。
    coordinatorMode: EXECUTE_FAMILY_NODE_IDS.has(nodeView.routeNode)
  }, null, 2));
  console.log('ROUTE: ' + formatRouteLine(nodeView));
  printBranchLine(changeName, state.branchPrefix ?? 'change/');
  await printEvolveDueHint(state);
  return;
}

// next：下一节点与技能（含 Fix 回退 / 回程 / 漂移校正分支）
export async function runNext(protocol) {
  const changeName = await findActiveChange();
  if (!changeName) {
    console.log('NEXT: done');
    console.log('MESSAGE: No active change. Run: node workflow-state.mjs init <change-name>');
    return;
  }
  const state = await readState();
  // 位置门（同 status）：解析不到就 fail-closed，不打印 NODE / NEXT: done——那是「没有在办 change」
  // 或「已无待跑节点」的措辞，两者都在说假话。
  const location = await requireChangeLocation(changeName, state);
  const completedArr = Array.isArray(state.completedNodes) ? state.completedNodes : [];
  // Fix 回退显式分支——必须早于「疑似未 exit」门禁与进行中漂移保护：
  // review/verify 驻留 + TASK 有 pending 修复任务（串行/并行）或未闭合家族出口签名时，把工作
  // 归属受控归位共享谓词返回的 execute 家族目标（写盘）并显式输出 NODE: <目标>，不再依赖
  // inProgress 保护副作用（否则并行任务 next 输出仍停在源节点）。判定复用 route-node 共享纯函数。
  const fixRollbackDecision = await resolveFixRollbackDecision({
    runRoot: runRootDir(), changeName, protocol, completedNodes: completedArr, currentNode: state.currentNode,
    history: state.history,
  });
  if (fixRollbackDecision) {
    const sourceNode = state.currentNode;
    // 轮次计数与阈值/授权判定全部走共享 helper：分支②不计数；第 4 轮无授权时先 BLOCK
    // （此处尚未写盘，满足不写 currentNode；单一判级，无按 change 新旧的放行侧）。
    const rollbackRound = applyFixRollbackRound({ state, sourceNode, decision: fixRollbackDecision });
    if (rollbackRound.blocked) {
      console.error(rollbackRound.blockedMessage);
      process.exit(1);
    }
    if (rollbackRound.warn) console.error(rollbackRound.warnMessage);
    state.currentNode = fixRollbackDecision.target;
    await writeState(state);
    console.log('FIX-BATCH: 归位 ' + fixRollbackDecision.target + '（源节点 ' + sourceNode + '）' + rollbackRound.auditSuffix);
    printNext(protocol, fixRollbackDecision.target, state.executionMode ?? 'subagent');
    // 解释行与共享视图同一实现（printWhyLine）：status 的 routeNode 与这行点名的节点是同一事实。
    printWhyLine({
      routeNode: fixRollbackDecision.target,
      stateNode: sourceNode,
      inProgress: false,
      fixRollbackTarget: fixRollbackDecision.target,
    });
    printPreflightLine(fixRollbackDecision.target);
    printBranchLine(changeName, state.branchPrefix ?? 'change/');
    return;
  }
  // Fix 回程豁免——exit execute --apply 二次完成把 currentNode 回推源节点后，
  // 源节点产物（REVIEW.md / TEST.md+UAT.md）已在场会让 resolveNextNode 跳过尚未 exit 的
  // 源节点；仅当源节点未完成、任务全 done、firstIncompletePostExecNode === currentNode
  // 且 resolveNextNode 确实会跳过该节点时显式放行（只读不改写 state）。artifactNext ===
  // currentNode 的形态落回既有正常逻辑（normalAdvanceExempt 覆盖），不放宽豁免面。
  // 本块只做「可能是回程态」的廉价前置筛选（源节点未完成 = 回程谓词的必要条件），真正的判定取共享
  // 视图的 fixReturnTarget——回程分支的 NODE 与 status.routeNode 是同一个值，源节点未 entry /
  // 无 evidence 的构造态里两者不再分叉（旧实现直接打印 state.currentNode，status 报产物后继）。
  const fixReturnNode = state.activeChange
    ? await resolveFixReturnNode({ runRoot: runRootDir(), changeName, protocol, completedNodes: completedArr })
    : null;
  if (fixReturnNode !== null && fixReturnNode === state.currentNode) {
    const returnView = await resolveNodeView({ changeName, protocol, state, location });
    if (returnView.fixReturnTarget !== null) {
      console.log('RETURN: 回程源节点 ' + returnView.fixReturnTarget + '（源节点产物在场且未出口；保留源节点跑出口）');
      printNext(protocol, returnView.routeNode, state.executionMode ?? 'subagent');
      printWhyLine(returnView);
      printBranchLine(changeName, state.branchPrefix ?? 'change/');
      return;
    }
  }
  // 节点视图（与 status 共用同一判定，见 resolveNodeView——节点顺序门禁也在其中，本命令不再内联
  // 第二份）：derivedNode 供零进展防呆与漂移校正使用，routeNode 才是输出节点（next 的 NODE 行）。
  const nodeView = await resolveNodeView({ changeName, protocol, state, location });
  const detectedNode = nodeView.derivedNode;
  // 此态 next 不打印 NODE、直接 BLOCKED（节点顺序门禁 / 单趟零进展 / Fix 归位第 4 轮无授权）：三个
  // 判定与报文都在共享视图里（resolveNodeOrderBlock / resolveZeroProgressBlock / applyFixRollbackRound
  // 的只读预演），本命令只消费而不另判一份——status 的「route=null + next 将 BLOCKED」来自同一字段，
  // 两边答案因此一致。Fix 第 4 轮在 FIX-BATCH 分支已先行 BLOCK，此处的 blocked 只会是顺序门禁或零进展。
  if (nodeView.blocked !== null) {
    console.error(nodeView.blocked.message);
    process.exit(1);
  }
  // 状态漂移自动校正——以文件产物为准（determineNode）校正 state.currentNode。进行中节点不校正
  // （已 entry / 已 record 且未 exit、路由仍在其后继）：判定统一在 resolveNodeView 内，本命令不再
  // 内联第二份（与 status 共用；被拦截节点若被推走，其 exit 前置 currentNode 校验无法重跑 → 死结）。
  if (!nodeView.inProgress && state.currentNode !== detectedNode) {
    state.currentNode = detectedNode;
    await writeState(state);
  }
  // 输出跟随路由视图：进行中时输出 state.currentNode（而非产物推导——否则 state 保持 review 但
  // 输出 NODE: verify，执行者按输出 action 仍然死结）；非进行中即产物推导节点。
  const printNode = nodeView.routeNode;
  printNext(protocol, printNode, state.executionMode ?? 'subagent');
  printWhyLine(nodeView);
  printPreflightLine(printNode);
  printBranchLine(changeName, state.branchPrefix ?? 'change/');
  return;
}

// select <change-id>：切换 activeChange（目录边界 + 名字逐字相等）
export async function runSelect(protocol, argv) {
  const changeName = argv[3];
  if (!changeName) throw new Error('select requires a change name.');
  // change 名必须是 .specs/ 下的单段目录名（形态单一权威在 route-node.mjs）：拒绝路径分隔符、
  // . / .. 与保留目录 archive（归档区不是活跃 change）——多段路径会把归档目录等非 change
  // 目录选成 activeChange，进而污染后续命令的 change 归属与轮次派生。
  if (!isSingleSegmentChangeName(changeName)) {
    throw new Error('select change 名必须是 .specs/ 下的单段目录名（拒绝路径分隔符、. / .. 与保留目录 archive）: '
      + JSON.stringify(changeName));
  }
  const changeDir = path.join(specsDir(), changeName);
  // 目录必须真实存在且不是 symlink/junction、realpath 归一后仍在 .specs/ 内（复用路径段扫描
  // 单一权威）；越界 / 链接形态一律拒绝，不把非真实目录选为 activeChange。
  let inspection;
  try {
    inspection = await inspectWorkflowPathSegments(specsDir(), changeDir, 'select change dir', 'directory');
  } catch (error) {
    throw new Error('Change not found or path unsafe: ' + changeDir + '（' + (error && error.message ? error.message : error) + '）');
  }
  if (!inspection.exists) throw new Error('Change not found: ' + changeDir);
  // 名字必须与 .specs/ 下真实目录条目逐字相等：大小写/空白变体（如 .specs/ch 用 'CH' 选中）
  // 在大小写不敏感文件系统上同样可达，但会把 activeChange 存成变体字符串——轮次事件按
  // activeChange 精确匹配（配额被换键重置）。名字变体一律拒绝，不得改写 activeChange。
  if (!(await hasExactSpecsEntry(changeName))) {
    throw new Error('select change 名必须与 .specs/ 下真实目录名逐字相等（大小写/空白变体会使 activeChange 与实际目录不一致）: '
      + JSON.stringify(changeName));
  }
  const state = await readState();
  state.activeChange = changeName;
  if (!state.currentNode) state.currentNode = await determineNode(changeName, protocol, state.completedNodes);
  await writeState(state);
  console.log('Selected: ' + changeName);
  return;
}

// record <node> <payload>：写证据（技能加载声明标记校验 + 前置门）
export async function runRecord(protocol, argv) {
  const nodeId = argv[3];
  if (!nodeId) throw new Error('record requires a Node id.');
  // 声明命令的运行上下文（脚本路径 / 运行根 / 包根 / 本次解析到的协议）：本命令的两处恢复指引都要
  // 打印可照抄的命令，一次取好往下传——各调用点各取一次就是同一事实的多处表达。
  const declarationContext = commandContext({ argv });
  const state = await readState();
  state.evidence = state.evidence || {};
  // 解析 JSON 参数并展开到 evidence 顶层（summary/completedChecks/output-schema evidence 等）；
  // 若不可解析则作为 summary 字符串
  // payload 解析前剥离 --protocol（及 --protocol=<p>）——resolveProtocol 已全局提取协议路径，
  // 此处仅防其拼入 payload 导致 JSON 解析失败（结构字段丢失）
  // --json-file <path>（或 --json-file=<path>）：从文件读 JSON payload——规避 Windows
  // PowerShell 传参剥离内嵌双引号导致 JSON 损坏（record 存成 {summary:...} 脏数据）
  let parsed = {};
  let jsonFile = null;
  const payloadArgs = [];
  const recordArgs = argv.slice(4);
  for (let i = 0; i < recordArgs.length; i++) {
    const arg = recordArgs[i];
    if (arg === '--protocol') { i += 1; continue; }
    if (typeof arg === 'string' && arg.startsWith('--protocol=')) continue;
    if (arg === '--json-file') {
      jsonFile = recordArgs[i + 1];
      i += 1;
      continue;
    }
    if (typeof arg === 'string' && arg.startsWith('--json-file=')) {
      jsonFile = arg.slice('--json-file='.length);
      continue;
    }
    payloadArgs.push(arg);
  }
  const raw = jsonFile !== null
    ? await fs.readFile(await resolveJsonFileWithinRunRoot(jsonFile), 'utf8')
    : payloadArgs.join(' ');
  // 契约解析失败判定（单一来源）：looksLikeObjectLiteral 由 state-schema.mjs 导出——
  // trim 后以 {/[ 开头 → 视作"形似对象字面量"；若 JSON.parse 失败 → fail-closed。
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    // 契约解析失败 fail-closed:payload 形似对象但 JSON.parse 失败 → 报错并
    // process.exit(1),不写 evidence——防状态污染（旧语义把不可解析 raw 静默作
    // summary 字符串落库 = 静默落脏）
    // 消息按参数来源分级:--json-file 传入且文件内容损坏 →
    // "文件内容不是合法 JSON" + 长度元数据;内联传参损坏 → 保留 --json-file 建议。
    // 安全:错误消息只含固定前缀 + 长度元数据,绝不打印 raw 内容(含截断)。
    if (looksLikeObjectLiteral(raw)) {
      if (jsonFile !== null) {
        console.error('文件内容不是合法 JSON (length=' + String(raw ?? '').length + ')');
      } else {
        console.error('payload looks like an object literal but is not valid JSON (length=' + String(raw ?? '').length + '); use --json-file <path> to pass the payload');
      }
      process.exit(1);
    }
    parsed = { summary: raw || 'recorded' };
  }
  // 载荷本身必须是对象（入口判据，先于形状校验与任何写盘）：JSON 可解析的非对象取值
  // （null / 数组 / 字符串 / 数字）旧实现两条路都错——null 一路放行到读 parsed.completedChecks 时
  // 抛 TypeError（报文是堆栈，既不说哪一步错了、也不说载荷该长什么样），数组/字符串/数字则被静默
  // 改写成 { summary: String(...) }（替调用方编了一份它没说过的载荷，证据从此不可按字段消费）。
  // 本判据只在本入口：形状表（state-schema.evidencePayloadProblems）判的是「对象各字段的类型」，
  // 载荷不是对象时它按设计放行——两件事各守自己边界内的事实，不互相越界。
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const payloadTypeName = parsed === null ? 'null' : (Array.isArray(parsed) ? 'array' : typeof parsed);
    console.error('ERROR: record 载荷必须是对象（当前是 ' + payloadTypeName + '）—— state 未改写');
    console.error('恢复: ' + scriptCommand({
      scriptsDir,
      runRoot: runRootDir(),
      script: 'workflow-state.mjs',
      args: ['record', nodeId, `'{"summary":"<本节点完成摘要>"}'`],
    }) + ' 用对象载荷重试；载荷里的引号被 shell 吞掉时改用 --json-file <path> 传入 JSON 文件'
      + '（cmd.exe 请把单引号换成双引号，并转义载荷里原有的双引号）');
    process.exit(1);
  }
  // 载荷形状校验（写入前 fail-closed；判定单一来源 = state-schema.evidencePayloadProblems）：
  // 类型错误的载荷不得落库——否则下游出口门禁只会报「缺 evidence: <schema>」，出错的是 record、
  // 报错的却是 exit，执行者得自己反推载荷该写什么形状。故在此拦下：点名字段路径与当前类型，
  // 给出可照抄的正确形态；只判类型/非空，取值是否合法（扫描份数、提名编号是否登记）仍归出口门禁。
  const shapeProblems = evidencePayloadProblems(parsed);
  if (shapeProblems.length > 0) {
    console.error('ERROR: record 载荷形状不合法（写入前拒绝，state 未改写）:');
    for (const problem of shapeProblems) {
      console.error('  ' + problem.field + ': ' + problem.message);
    }
    console.error('恢复: ' + scriptCommand({
      scriptsDir,
      runRoot: runRootDir(),
      script: 'workflow-state.mjs',
      args: ['record', nodeId, `'{"summary":"<本节点完成摘要>"}'`],
    }) + ' 用类型合法的载荷重试（summary 为非空字符串；completedChecks 为字符串数组；'
      + 'lessonsNomination 为 { scanned, nominated[], reasonIfNone }，nominated 元素是条目编号字符串）'
      + '；载荷里的引号被 shell 吞掉时改用 --json-file <path> 传入 JSON 文件'
      + '（cmd.exe 请把单引号换成双引号，并转义载荷里原有的双引号）');
    process.exit(1);
  }
  // completedChecks 真实性校验（skill-load 声明标记）——解析本次 record 写入的
  // completedChecks 的 required-skill:<node>.<skill> 条目 → 对应声明标记必须存在，
  // 缺失 → BLOCKED + 指引先加载 skill 并运行 skill-load；标记 at 必须 ≤ 本次记录时间
  // （交叉自洽：标记先于记录声明）。仅校验本次写入的 payload，旧 evidence 不追溯（旧 change 兼容）。
  const recordedAt = new Date().toISOString();
  // 身份与位置（与 status / next 同源；先于任何写盘与声明门）：身份在办 → 位置必须可解析；解析不到
  // 就 fail-closed（不写 evidence、不猜落点）。此前位置解析隐式散在两条取值路径上（标记归属与尾部
  // 节点视图各算一次），移动后两处会各自给出「目录不存在」的假答案。
  // 排序：载荷的形状校验在前（它判的是本命令自己的参数面，报的是「你怎么调用的」），位置门在后
  // （它判的是这次记录能不能落地）——两者都 fail-closed，但先把参数问题说清楚。
  const identityChange = state.activeChange || await findActiveChange();
  const location = identityChange === null ? null : await requireChangeLocation(identityChange, state);
  // 标记归属 change 与 evidence 一致：身份取值与 status / next / 尾部视图**同一份**（上方一次
  // 取好）；无身份 → verifySkillLoadMarkers 内 fail-closed BLOCK。
  // 传入 protocol + state——按 requiredSkillCalls scope 分类条目（handoff scope 豁免标记，
  // 以共用证据库 handoffResult 为证据）
  const markerChange = identityChange;
  const markerCheck = await verifySkillLoadMarkers(parsed.completedChecks, markerChange, recordedAt, protocol, state, declarationContext);
  if (!markerCheck.ok) {
    console.error('BLOCKED: ' + markerCheck.reason);
    process.exit(1);
  }
  // 技能加载前置门（方案 A）：节点完成记录必须先有本节点
  // skill-load 声明标记——无论 payload 是否含 completedChecks 都校验（堵"先干活后补
  // 声明"旁路）：缺失 → BLOCKED（单一判级）。指引先加载技能，再照抄派生出的
  // 声明命令（该节点每个必需技能各一条，全部协议文件 + 模板全清单）后重试。handoff scope 技能
  // （子代理加载）不要求协调者声明（与 verifySkillLoadMarkers 的 scope 豁免一致）——本门按
  // <node>-*.json 存在性判定，与 guard exit 侧协议声明标记校验同构。仅对存在于当前协议的节点生效
  // （协议外节点名的记录不适用前置门），无 active change 时无法定位标记而不重复报错（遗留兼容）。
  const recordNodeDef = (protocol.nodes ?? []).find((n) => n.id === nodeId);
  if (recordNodeDef && markerChange) {
    const declaredForNode = await hasNodeSkillDeclaration(nodeId, markerChange);
    if (!declaredForNode) {
      // 声明命令由协议派生（该节点每个必需技能各一条，每条都带该节点全部协议文件、模板全清单与
      // 协议上下文），与守卫侧恢复段同一装配：旧形态是手拼的 "skill-load <node> <skill>"——位置实参位
      // 写占位符在 bash 里是重定向，照抄直接语法失败；换成真名也只声明了一个技能、不带模板清单，
      // record 放行后 exit 还要再拦一次。
      const loadGuide = '先加载技能（用 Skill 工具，禁止跳过），再照抄下面的命令声明本节点技能加载'
        + '（同一 node-skill 重跑会覆写该标记）：\n  '
        + declarationCommands({
          node: recordNodeDef,
          skills: declarationSkillTargets(recordNodeDef),
          context: declarationContext,
        }).map((entry) => entry.command).join('\n  ')
        + '\n然后重试 record';
      console.error('BLOCKED: 节点 ' + nodeId + ' 缺少技能加载声明标记（.skill-loads/' + nodeId + '-*.json）——' + loadGuide);
      process.exit(1);
    }
    // 模板声明核对（C11）——声明标记里必须有与该节点映射一致的 templates 集合：缺失 / 多写 /
    // 漏写 / 错名 BLOCK（fail-closed，不让人「声明了但说得不对」）。
    // 自定义协议节点不比对（C12）；无活动 change / 声明机制未激活时不在这里报（见该函数的边界注释）。
    const templateCheck = await verifyTemplateDeclaration({
      protocol,
      nodeId,
      changeName: markerChange,
      commandContext: declarationContext,
    });
    if (!templateCheck.ok) {
      console.error('BLOCKED: ' + templateCheck.reason);
      process.exit(1);
    }
  }
  // 声明标记的唯一写入通道 = 执行者手动 skill-load（本命令不代记任何标记）：缺声明在上一道
  // 前置门已 BLOCKED，走到这里说明声明齐备。
  state.evidence[nodeId] = {
    ...(state.evidence[nodeId] || {}),
    ...parsed,
    recordedAt,
  };
  await writeState(state);
  console.log('EVIDENCE: ' + nodeId);
  // 节点视图与 next / status 同源（L-067 族）：record 也是「我现在该在哪个节点」的输出面。直接取
  // 产物推导会让三面在**进行中保护**生效时分叉（record 报 review，而 next / status.routeNode 报
  // execute）——故复用 resolveNodeView 的 routeNode：本命令不自持第二份判定，也不改变自己的写面
  // （record 只写证据，不写 currentNode，视图是纯读）。
  const changeName = identityChange;
  const nodeView = changeName ? await resolveNodeView({ changeName, protocol, state, location }) : null;
  // 边界态（next 会 BLOCKED、不打印 NODE）：record 是同一事实的第四个输出面，尾巴不得再声称
  // 「NEXT: done」——那是在说「没有下一节点了」，与 next 的 BLOCKED、status.routeNode=null 相反。
  // 命中时改打与 ROUTE: 行同源的一句（原因 + 先按恢复指引处理），NODE / SKILL 一律不打（next 此刻
  // 也不打）。blocked 来自共享视图在 state 副本上的只读预演：轮次与 currentNode 不动，本命令的写面
  // 仍只有它自己的证据。
  if (nodeView?.blocked) {
    console.log('NEXT: blocked（' + nodeView.blocked.reason + '；先按恢复指引处理）');
    return;
  }
  printNext(protocol, nodeView?.routeNode ?? null, state.executionMode ?? 'subagent');
  return;
}

// advance：强制推进（append-only 审计事件 + 跳过出口门禁的可见性）
export async function runAdvance(protocol) {
  const state = await readState();
  if (!state.activeChange) {
    console.log('No active change. Use select first.');
    return;
  }
  // 被强制推进的节点 = 推进前的 currentNode：exit 门禁未跑（无出口证据），这正是留痕与
  // 可见性的依据（ADR-013 决策 10/11）。advance 的推进语义保持不变，但每次使用都必须写
  // 审计事件并在输出显式列出被跳过的出口门禁。
  const forcedNode = state.currentNode;
  const forcedNodeId = typeof forcedNode === 'string' && forcedNode !== '' ? forcedNode : null;
  if (!state.completedNodes.includes(state.currentNode)) {
    state.completedNodes.push(state.currentNode);
  }
  // Use determineNode to get the actual next node (reads TASK.md)
  const detected = await determineNode(state.activeChange, protocol, state.completedNodes);
  state.currentNode = detected;
  if (forcedNodeId !== null) {
    // append-only 审计事件：change 供跨 change 检索，skipped 标识被跳过的出口门禁
    // （exit:<node>），reason 固定 'advance'（本 CLI 无其它原因面）。
    const existingHistory = Array.isArray(state.history) ? state.history : [];
    state.history = existingHistory.concat([{
      event: 'advance-forced',
      change: state.activeChange,
      node: forcedNode,
      skipped: ['exit:' + forcedNode],
      reason: 'advance',
      at: new Date().toISOString(),
    }]);
  }
  await writeState(state);
  console.log('Advanced to: ' + state.currentNode);
  if (forcedNodeId !== null) {
    console.log('ADVANCE-AUDIT: 跳过 ' + forcedNodeId + ' 的 exit 门禁；该节点无出口证据');
  }
  return;
}
