// reentry-node.mjs — archive 源受控重入判定（单一权威 · 纯函数）
// archive 已 entry 且归档移动尚未发生时，用户显式授权把工作归属退到 execute 家族 / review /
// verify 的受控回边。目标白名单 / 源转移语义 / 授权形态 / 轮次上限 / 幂等空操作的全部判定集中在
// 本模块：reenter 子命令只做编排与落盘，禁止内联第二份。
// 纯函数：无 fs / console / process.exit / state 写入。信号统一用 structured result：非法 / 未授权
// 返回 { ok: false, reason: '<machine-code>' }，不抛异常。
// 依赖方向：只依赖 task-graph.mjs（协议节点顺序 / 启用 / change 名形态 / 事件归属）。
import {
  route,
  protocolNodeEnabled,
  isSingleSegmentChangeName,
  historyEventBelongsToChange,
} from './task-graph.mjs';

// 受控重入目标白名单：显式目标必须 ∈ 本集合 ∩ 协议 enabled 节点。
export const REENTRY_TARGET_NODE_IDS = new Set(['execute', 'subagent-execute', 'review', 'verify']);

// 每 change 轮次上限：3 轮；调用方禁止内联阈值，必须引用本常量。
export const REENTRY_ROUND_LIMIT = 3;

// 源判定（①）：currentNode === 'archive' 且 activeChange 是合法的单段 change 名。
// 源不是 archive / 没有活跃 change / change 名形态非法 → 未授权来源，返回 machine-code，不抛异常。
export function reentrySourceDecision({ currentNode, activeChange } = {}) {
  if (typeof activeChange !== 'string' || activeChange.trim() === '') {
    return { ok: false, reason: 'no-active-change' };
  }
  if (!isSingleSegmentChangeName(activeChange)) {
    return { ok: false, reason: 'change-name-invalid' };
  }
  if (currentNode !== 'archive') {
    return { ok: false, reason: 'source-not-archive' };
  }
  return { ok: true, reason: 'archive-source' };
}

// 目标判定（②）：target ∈ 白名单 ∩ 协议 enabled 节点。enabled 判定复用 protocolNodeEnabled
// （协议 enabled 语义唯一来源），本函数不写第二份解析；协议缺失 / 非对象按 fail-closed 返回未启用
// （解析失败不得静默放行）。
export function resolveReentryTarget({ protocol, target } = {}) {
  if (typeof target !== 'string' || !REENTRY_TARGET_NODE_IDS.has(target)) {
    return { ok: false, reason: 'target-not-allowed' };
  }
  if (!protocol || typeof protocol !== 'object' || !protocolNodeEnabled(protocol, target)) {
    return { ok: false, reason: 'target-not-enabled' };
  }
  return { ok: true, reason: 'target-allowed', target };
}

// 授权形态 fail-closed 解析（③）：round 为正整数、at / source 均为非空（去空白）字符串、
// authorization.target 与本次调用 target 一致；任一项非法 → 未授权，不抛异常。
// 形态与既有 Fix 轮次授权同源，禁止第二份校验。
export function parseReentryAuthorization({ authorization, target } = {}) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    return { ok: false, reason: 'authorization-missing' };
  }
  if (typeof authorization.round !== 'number' || !Number.isInteger(authorization.round) || authorization.round <= 0) {
    return { ok: false, reason: 'round-invalid' };
  }
  if (typeof authorization.at !== 'string' || authorization.at.trim() === '') {
    return { ok: false, reason: 'at-invalid' };
  }
  if (typeof authorization.source !== 'string' || authorization.source.trim() === '') {
    return { ok: false, reason: 'source-invalid' };
  }
  if (typeof target !== 'string' || target === '' || authorization.target !== target) {
    return { ok: false, reason: 'target-mismatch' };
  }
  return {
    ok: true,
    reason: 'authorized',
    authorization: {
      round: authorization.round,
      at: authorization.at.trim(),
      source: authorization.source.trim(),
      target,
    },
  };
}

// 上限后的续轮授权形态：达到上限后，用户可显式授权把轮次推进到下一轮。授权三元组形态复用
// parseReentryAuthorization（单一权威——不复制第二份字段校验）；本函数只追加续轮特有约束：
// round 必须覆盖即将执行的轮次（已用轮次 + 1，与既有 Fix 轮次授权的「覆盖即将执行轮次」语义同型），
// 否则视为未授权 fail-closed。未达上限时调用方不得传续轮授权（续轮只在人工裁决点需要）。
// 本函数只做形态判定，不读 history。
export function parseReentryContinuationAuthorization({ authorization, target, used } = {}) {
  const parsed = parseReentryAuthorization({ authorization, target });
  if (!parsed.ok) return parsed;
  if (typeof used !== 'number' || !Number.isInteger(used) || used < 0
    || parsed.authorization.round < used + 1) {
    return { ok: false, reason: 'round-below-required' };
  }
  return { ok: true, reason: 'continuation-authorized', authorization: parsed.authorization };
}

// 轮次派生（④）：统计 state.history 中本 change 的 reentry-applied 事件数，change 归属过滤调用
// historyEventBelongsToChange（单一权威——不在此内联第二份）。跨 change 隔离依赖事件的 change
// 字段：写入方（reenter 子命令）必须带 change；无 change 的旧事件按 legacy 形态参与（reentry-applied
// 为既有事件类型，legacy 形态实际不会出现）。history 缺失 / 非数组 = 无事件（旧 state 形态，0 轮）。
// 轮次只按事件条数派生，不读事件里的 round 字段。
export function reentryRoundCount({ history, changeName } = {}) {
  if (!Array.isArray(history)) return 0;
  let count = 0;
  for (const event of history) {
    if (!event || event.event !== 'reentry-applied') continue;
    if (!historyEventBelongsToChange(event, changeName)) continue;
    count += 1;
  }
  return count;
}

// 上限判定（⑤）：已用轮次 < REENTRY_ROUND_LIMIT 或持有合法续轮授权 → 放行并给出本轮序号
// （nextRound = 已用 + 1，供审计事件与 REENTRY 行使用）；否则 blocked（调用方必须先于任何 state
// 写盘返回，保证字节零改写）。阈值只从 REENTRY_ROUND_LIMIT 取。
export function reentryRoundDecision({ history, changeName, continuationAuthorized = false } = {}) {
  const used = reentryRoundCount({ history, changeName });
  if (used < REENTRY_ROUND_LIMIT) {
    return { ok: true, reason: 'round-available', used, nextRound: used + 1, limit: REENTRY_ROUND_LIMIT };
  }
  if (continuationAuthorized === true) {
    return { ok: true, reason: 'round-available-continuation', used, nextRound: used + 1, limit: REENTRY_ROUND_LIMIT };
  }
  return { ok: false, reason: 'round-limit-reached', used, limit: REENTRY_ROUND_LIMIT };
}

// 协议前驱推导（⑦ 的输入）：沿协议 success 边反向可达的全部祖先节点（传递闭包——对应前驱语义
// 「清掉目标及其后继」），按协议 route 顺序（disabled 过滤）排序；failure / pause 自环、target
// 自身与协议外节点不参与。顺序唯一来源是 route(protocol)，不另写节点排序。
function reentryPredecessors(protocol, target) {
  if (!protocol || typeof protocol !== 'object') return [];
  const order = route(protocol).map((node) => node.id);
  const ancestors = new Set();
  const queue = [target];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of protocol.edges ?? []) {
      if (!edge || edge.condition !== 'success' || edge.to !== current) continue;
      if (typeof edge.from !== 'string' || edge.from === '' || edge.from === target || ancestors.has(edge.from)) continue;
      ancestors.add(edge.from);
      queue.push(edge.from);
    }
  }
  return order.filter((id) => ancestors.has(id));
}

// 前驱交集（⑦）：completedNodes ∩ predecessors(target)，按协议节点顺序保留原顺序。completedNodes
// 中的协议外 / 重复项自然被过滤与去重；target 未知 / 未启用 → 空交集（fail-closed）。
export function reentryPredecessorIntersection({ protocol, target, completedNodes = [] } = {}) {
  const completed = Array.isArray(completedNodes) ? completedNodes : [];
  return reentryPredecessors(protocol, target).filter((id) => completed.includes(id));
}

// 空操作判定（⑥ · 幂等锚）：currentNode === target 且 completedNodes 已等于前驱交集结果
// （同序逐项相等）→ noop（调用方不备份 / 不计数 / 不写事件）；否则返回待落地的交集，调用方按
// 前驱语义覆盖 completedNodes。判定本身不改写输入。
export function reentryNoOpDecision({ currentNode, target, protocol, completedNodes = [] } = {}) {
  const completed = Array.isArray(completedNodes) ? completedNodes : [];
  const intersection = reentryPredecessorIntersection({ protocol, target, completedNodes: completed });
  const same = currentNode === target
    && completed.length === intersection.length
    && intersection.every((id, index) => completed[index] === id);
  return same
    ? { noop: true, reason: 'noop-target-satisfied', completedNodes: intersection }
    : { noop: false, reason: 'target-state-not-satisfied', completedNodes: intersection };
}

// 受控重入综合判定（单一权威聚合判定 · 供 reenter 子命令单点调用），返回三态 action：
//   'block'（ok:false，调用方零写盘返回）、
//   'noop' （目标形态已成立，调用方零写盘提示）、
//   'apply'（ok:true，携带 changeName / target / 待落地 completedNodes / 本轮 round / 归一授权）。
// 判定顺序：目标合法性（越界即使处于重复态也 BLOCK）→ change 名形态 → 上限 → 幂等短路 → 源 → 授权。
// 幂等短路必须先于源判定：目标形态已成立时 currentNode === target ≠ 'archive'，先判源会让空操作
// 判定永远不可达；但幂等短路不得越过上限判定——达到上限的 change 即使处于同目标形态也必须走人工
// 裁决路径（不得以空操作退出 0），也不得越过 change 名形态判定（畸形 change 名一律 BLOCK，不因形态
// 巧合而短路）。短路分支零写盘。调用方不得内联重排或复制其中任何一条判据。
export function resolveReentryDecision({ protocol, state, target, authorization, continuationRound } = {}) {
  const targetDecision = resolveReentryTarget({ protocol, target });
  if (!targetDecision.ok) return { ok: false, action: 'block', reason: targetDecision.reason };
  const activeChange = state?.activeChange;
  if (typeof activeChange !== 'string' || activeChange.trim() === '') {
    return { ok: false, action: 'block', reason: 'no-active-change' };
  }
  if (!isSingleSegmentChangeName(activeChange)) {
    return { ok: false, action: 'block', reason: 'change-name-invalid' };
  }
  const used = reentryRoundCount({ history: state?.history, changeName: activeChange });
  const atLimit = used >= REENTRY_ROUND_LIMIT;
  let continuationAuthorized = false;
  if (atLimit) {
    const continuation = parseReentryContinuationAuthorization({
      authorization: continuationRound === undefined || continuationRound === null
        ? null
        : {
          ...(authorization && typeof authorization === 'object' && !Array.isArray(authorization) ? authorization : {}),
          round: continuationRound,
        },
      target,
      used,
    });
    if (!continuation.ok) {
      return { ok: false, action: 'block', reason: 'round-limit-reached', used, limit: REENTRY_ROUND_LIMIT };
    }
    continuationAuthorized = true;
  } else if (continuationRound !== undefined && continuationRound !== null) {
    return { ok: false, action: 'block', reason: 'continuation-not-required', used, limit: REENTRY_ROUND_LIMIT };
  }
  const noop = reentryNoOpDecision({
    currentNode: state?.currentNode,
    target,
    protocol,
    completedNodes: state?.completedNodes,
  });
  if (noop.noop && !atLimit) {
    return { ok: true, action: 'noop', reason: noop.reason, target, completedNodes: noop.completedNodes };
  }
  const source = reentrySourceDecision({
    currentNode: state?.currentNode,
    activeChange,
  });
  if (!source.ok) return { ok: false, action: 'block', reason: source.reason };
  const parsed = parseReentryAuthorization({ authorization, target });
  if (!parsed.ok) return { ok: false, action: 'block', reason: parsed.reason };
  const round = reentryRoundDecision({ history: state?.history, changeName: activeChange, continuationAuthorized });
  if (!round.ok) {
    return { ok: false, action: 'block', reason: round.reason, used: round.used, limit: round.limit };
  }
  return {
    ok: true,
    action: 'apply',
    reason: 'reentry-authorized',
    changeName: activeChange,
    target,
    completedNodes: noop.completedNodes,
    round: round.nextRound,
    continuationAuthorized,
    authorization: parsed.authorization,
  };
}
