// fix-loop-node.mjs — Fix 族判定与受控归位（单一权威实现）
// 承载：execute 家族之后首个未完成节点 / TASK.md 读取 / Fix 回因分类 / 受控归位轮次计数与审计文案 /
// Fix 回程节点推导。判定本身只读 TASK.md 与 state 证据（history · evidence），无 console 输出、
// 无 process.exit；唯一允许写 state 的是轮次计数 helper——它只被受控归位入口在目标命中后调用，
// 轮次字段的读写经 state-schema 单一来源。
// 「TASK.md + 路由」组合成的归位决策（resolveFixRollbackDecision）落在入口：它需要路由核心
// resolveNextNode，而路由核心留在入口（入口 → lib 单向依赖，不反向）。
// 依赖方向：本模块只依赖 task-graph.mjs 与既有共享模块。
import { promises as fs } from 'fs';
import path from 'path';
import { taskBlocks, taskOpeningAttrs } from '../task-parsing.mjs';
import { fixRoundsFor, setFixRoundsFor } from '../state-schema.mjs';
import {
  route,
  protocolTaskFilePath,
  EXECUTE_FAMILY_NODE_IDS,
  historyEventBelongsToChange,
  parseTaskSetSignature,
  taskSetSignature,
  fixTaskClassifier,
  fixTaskMarker,
} from './task-graph.mjs';

// execute 家族之后第一个未完成节点：按协议 route 顺序跳过全部 execute 家族节点，返回其后首个不在
// completedNodes 中的节点 id；协议无 execute 家族或后置节点全部完成 → null。
// 这里只做通用推导（内置协议 = review → verify → archive）；是否可作为 Fix 回程源由调用方
// （归位决策 / 出口推进）再用 review / verify 收窄（只覆盖内置源节点）。
export function firstIncompletePostExecNode({ protocol, completedNodes = [] }) {
  let sawExecuteFamily = false;
  for (const node of route(protocol)) {
    if (EXECUTE_FAMILY_NODE_IDS.has(node.id)) {
      sawExecuteFamily = true;
      continue;
    }
    if (sawExecuteFamily && !completedNodes.includes(node.id)) return node.id;
  }
  return null;
}

// 协议任务文件内容读取（taskFile 语义唯一来源）：不存在 / 不可读 → null；调用方各自按
// fail-closed 语义处理（回退判定 → false，回程推导 → null），不把访问类故障当成空任务集。
export async function readProtocolTaskContent(protocol, changeName, specsRoot) {
  try {
    return await fs.readFile(protocolTaskFilePath(protocol, changeName, specsRoot), 'utf8');
  } catch {
    return null;
  }
}

// 「未闭合 execute 生命周期」信号派生：取 history 中最后一次 exit-applied execute 家族事件
// 记录的 { signature, algo, node }；无家族出口事件 / 该事件无签名字段（旧 state）→ null（调用方按
// 旧 change 渐进放行）。只认最新一次家族出口——更早的签名被后续闭合覆盖。
// change 归属过滤经 historyEventBelongsToChange（单一权威）。算法版本：事件可带 signatureAlgo
// （新写形态），缺省按签名值解析出的版本（legacy 裸 hex = v1）；声明版本与值版本不一致的畸形事件
// → null（fail-closed，不参与闭合判定）。
export function latestExecuteExitEvent(history, changeName) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const event = history[i];
    if (!event || event.event !== 'exit-applied' || !EXECUTE_FAMILY_NODE_IDS.has(event.node)) continue;
    if (!historyEventBelongsToChange(event, changeName)) continue;
    if (typeof event.taskSetSignature !== 'string' || event.taskSetSignature === '') return null;
    const parsed = parseTaskSetSignature(event.taskSetSignature);
    if (parsed === null) return null;
    if (typeof event.signatureAlgo === 'string' && event.signatureAlgo !== '' && event.signatureAlgo !== parsed.algo) return null;
    return { signature: event.taskSetSignature, algo: parsed.algo, digest: parsed.digest, node: event.node };
  }
  return null;
}

// ---------- Fix 回因分类（共享纯函数 · 单一权威 · 展示层派生） ----------
// 出口回程分支在写本次 exit-applied 事件之前调用本分类器：只用既有字段派生证据（history 的
// execute 家族出口签名 + TASK 内容结构标记），零新增 state 字段 / 事件类型。判据：
//   divergence = 历史任一 execute 家族 exit-applied 事件记录的 taskSetSignature ≠ 当前任务集签名；
//   marker     = 模板派生的修复段内含 <task> 块，或全文任一任务 id 命中修复族前缀（唯一谓词
//                fixTaskClassifier / 其 id 边界常量 FIX_TASK_ID_PREFIX）；
//   divergence ∨ marker → 'fix'；有签名且不发散 → 'normal'；无签名且无标记 → 'unknown'
//   （旧 state 证据不足：中性输出、不 BLOCK，由调用方渲染）。
// 修复段标题由调用方传入（从 flow-kit/templates/TASK.md 的 H2 派生）；缺失 / 空串回退内置常量
// （task-graph 的 FIX_SECTION_TITLE_FALLBACK）。签名事件全量参与、不做「只看最新」短路——多波次
// 场景最新签名已被闭合写成当前签名，只看最新会漏判 fix。
// 回因分类唯一入口。签名：classifyFixReturnCause({ history, changeName, taskContent, fixSectionTitle })
// → 'fix' | 'normal' | 'unknown'。纯函数：无 fs / console / process.exit，不改既有路由判定语义。
// 算法版本：只让与当前任务集签名同版本的历史事件参与「signatureKnown / divergence」判定；跨版本
// 事件跳过（不可比），避免引擎升级后把正常多趟误判成 Fix。
export function classifyFixReturnCause({ history, changeName, taskContent, fixSectionTitle } = {}) {
  const current = parseTaskSetSignature(taskSetSignature(taskContent));
  let signatureKnown = false;
  let divergence = false;
  if (Array.isArray(history)) {
    for (const event of history) {
      if (!event || event.event !== 'exit-applied' || !EXECUTE_FAMILY_NODE_IDS.has(event.node)) continue;
      if (!historyEventBelongsToChange(event, changeName)) continue;
      if (typeof event.taskSetSignature !== 'string' || event.taskSetSignature === '') continue;
      const recorded = parseTaskSetSignature(event.taskSetSignature);
      if (recorded === null) continue;
      if (typeof event.signatureAlgo === 'string' && event.signatureAlgo !== '' && event.signatureAlgo !== recorded.algo) continue;
      if (current === null || recorded.algo !== current.algo) continue;
      signatureKnown = true;
      if (recorded.digest !== current.digest) divergence = true;
    }
  }
  if (divergence || fixTaskMarker(taskContent, fixSectionTitle)) return 'fix';
  return signatureKnown ? 'normal' : 'unknown';
}

// ---------- Fix 受控归位轮次（单一权威 · 唯一写点） ----------
// 仅受控归位入口在目标命中后调用本 helper，且只对决策 kind='pending' 计数；done-but-unclosed、
// 回因分类、verify 命令失败都不经此，也不得在调用方另行累加。
// 阈值语义：从第 4 轮起，新 change 返回 blocked（调用方必须先于任何 state 写盘退出，不得写入
// currentNode）；旧 change 返回 warn 后照常归位。用户显式授权记录为
// state.evidence[源节点].fixRoundOverride = { round, at, source }，覆盖到该轮即放行（不新增第二个顶层字段）。
// 完整授权形态：round 为正整数、at/source 均为非空字符串；任一缺失/类型非法/空串（含纯空白）
// 一律视为未授权 fail-closed——第 4 轮继续 BLOCK，调用方不写 currentNode、state 字节零改写。
// 审计行后缀由本 helper 统一给出，调用方禁止各自拼装。

function readFixRoundOverride(state, sourceNode) {
  if (typeof sourceNode !== 'string' || sourceNode === '') return null;
  const sourceEvidence = state && state.evidence && typeof state.evidence === 'object' && !Array.isArray(state.evidence)
    ? state.evidence[sourceNode]
    : null;
  const override = sourceEvidence && typeof sourceEvidence === 'object' && !Array.isArray(sourceEvidence)
    ? sourceEvidence.fixRoundOverride
    : null;
  if (!override || typeof override !== 'object' || Array.isArray(override)) return null;
  if (typeof override.round !== 'number' || !Number.isInteger(override.round) || override.round <= 0) return null;
  if (typeof override.at !== 'string' || override.at.trim() === '') return null;
  if (typeof override.source !== 'string' || override.source.trim() === '') return null;
  return { round: override.round };
}

const FIX_ROLLBACK_ROUND_LIMIT = 3;

const EMPTY_FIX_ROLLBACK_ROUND = Object.freeze({
  counted: false,
  blocked: false,
  warn: false,
  round: null,
  overrideUsed: false,
  auditSuffix: '',
  blockedMessage: null,
  warnMessage: null,
});

function fixRoundAuditSuffix(round) {
  return '（第 ' + round + '/' + FIX_ROLLBACK_ROUND_LIMIT + ' 轮）';
}

function fixRoundBlockedMessage(sourceNode, round) {
  return [
    'BLOCKED: Fix 批次受控归位已达 ' + FIX_ROLLBACK_ROUND_LIMIT + ' 轮上限，第 ' + round + ' 轮需用户决策（继续修/停止）——源节点 ' + sourceNode + '。',
    '恢复: 继续修 → 由用户显式授权后在 state.evidence.' + sourceNode + '.fixRoundOverride 记录 {"round":' + round + ',"at":"<时间>","source":"<授权来源>"} 再重试；停止 → 结束 Fix 批次并按流程处理（禁止手改 state 机器字段）。',
  ].join('\n');
}

export function applyFixRollbackRound({ state, sourceNode, decision }) {
  if (!state || !decision) return EMPTY_FIX_ROLLBACK_ROUND;
  if (decision.kind !== 'pending') return EMPTY_FIX_ROLLBACK_ROUND;
  const round = fixRoundsFor(state) + 1;
  const auditSuffix = fixRoundAuditSuffix(round);
  if (round <= FIX_ROLLBACK_ROUND_LIMIT) {
    setFixRoundsFor(state, round);
    return { ...EMPTY_FIX_ROLLBACK_ROUND, counted: true, round, auditSuffix };
  }
  const override = readFixRoundOverride(state, sourceNode);
  if (override !== null && override.round >= round) {
    setFixRoundsFor(state, round);
    return { ...EMPTY_FIX_ROLLBACK_ROUND, counted: true, round, overrideUsed: true, auditSuffix };
  }
  if (state.newChange === true) {
    return { ...EMPTY_FIX_ROLLBACK_ROUND, blocked: true, round, auditSuffix, blockedMessage: fixRoundBlockedMessage(sourceNode, round) };
  }
  setFixRoundsFor(state, round);
  return {
    ...EMPTY_FIX_ROLLBACK_ROUND,
    counted: true,
    warn: true,
    round,
    auditSuffix,
    warnMessage: 'FIX-BATCH WARN: Fix 批次受控归位已达 ' + FIX_ROLLBACK_ROUND_LIMIT + ' 轮上限，第 ' + round + ' 轮在旧 change 上渐进放行（建议用户显式授权并在 evidence 记录 fixRoundOverride）。',
  };
}

// Fix 回程节点推导（共享基础）：TASK.md 存在、至少一个任务块且全部 status="done" 时，
// 取 firstIncompletePostExecNode；仅当其 ∈ {review, verify}（内置回程源）才返回，否则 null。
// 仍有 pending / 零任务块 / TASK.md 缺失 → null（fail-closed）。「execute 本次 exit 前已在
// completedNodes」的二次完成条件由出口推进点判定，本函数只做 TASK + 路由推导。
export async function resolveFixReturnNode({ runRoot, changeName, protocol, completedNodes = [] }) {
  const taskContent = await readProtocolTaskContent(protocol, changeName, path.join(runRoot, '.specs'));
  if (taskContent === null) return null;
  const attrsList = taskBlocks(taskContent).map(taskOpeningAttrs).filter(Boolean);
  if (attrsList.length === 0) return null;
  if (!attrsList.every((attrs) => attrs.status === 'done')) return null;
  const node = firstIncompletePostExecNode({ protocol, completedNodes });
  return node === 'review' || node === 'verify' ? node : null;
}
