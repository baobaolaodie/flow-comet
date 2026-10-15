// replan-node.mjs — 受控计划重校重签判定（replan · 与 reentry 族同构 · 纯函数）
// 计划在执行中被证明有缺陷时的受控通道：仅 execute / subagent-execute 相位可用，停原位重校重签
// （不跳节点、不改 completedNodes）。相位与 change 名 / 授权形态 / 轮次上限 / 幂等空操作的全部判定
// 集中在本模块：replan 子命令只做编排与落盘，禁止内联第二份。
// 纯函数：无 fs / console / process.exit / state 写入。信号统一用 structured result：非法 / 未授权
// 返回 { ok:false, action:'block', reason:'<machine-code>' }，不抛异常。
// 依赖方向：只依赖 task-graph.mjs（协议节点启用 / change 名形态 / 事件归属 / 任务集签名与版本语义）。
import {
  protocolNodeEnabled,
  isSingleSegmentChangeName,
  historyEventBelongsToChange,
  taskSetSignature,
  sameTaskSetSignature,
} from './task-graph.mjs';

// 可调用相位白名单：execute 家族两个节点；调用方不得内联。
export const REPLAN_PHASE_NODE_IDS = new Set(['execute', 'subagent-execute']);

// 每 change 轮次上限：与 reentry 的轮次上限同值、语义独立；调用方禁止内联阈值，必须引用本常量。
export const REPLAN_ROUND_LIMIT = 3;

// 相位 / change 名判定（步骤 1）：currentNode ∈ execute 家族 ∩ 协议 enabled；activeChange 必须是
// 合法单段 change 名（复用 isSingleSegmentChangeName）。协议缺失 / 非对象 / 节点未启用一律
// fail-closed（解析失败不得静默放行）。
export function replanSourceDecision({ protocol, currentNode, activeChange } = {}) {
  if (typeof activeChange !== 'string' || activeChange.trim() === '') {
    return { ok: false, reason: 'no-active-change' };
  }
  if (!isSingleSegmentChangeName(activeChange)) {
    return { ok: false, reason: 'change-name-invalid' };
  }
  if (!REPLAN_PHASE_NODE_IDS.has(currentNode)
    || !protocol || typeof protocol !== 'object'
    || !protocolNodeEnabled(protocol, currentNode)) {
    return { ok: false, reason: 'phase-not-allowed' };
  }
  return { ok: true, reason: 'replan-phase' };
}

// 授权形态 fail-closed 解析（步骤 2）：round 为正整数，at / source / reason 均为非空（去空白）
// 字符串，authorization.node 与调用相位一致；任一项非法 → 未授权，不抛异常。
// 形态与 reentry 授权（parseReentryAuthorization）同族，禁止第二份字段校验。
export function parseReplanAuthorization({ authorization, node } = {}) {
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
  if (typeof authorization.reason !== 'string' || authorization.reason.trim() === '') {
    return { ok: false, reason: 'reason-invalid' };
  }
  if (typeof node !== 'string' || node === '' || authorization.node !== node) {
    return { ok: false, reason: 'node-mismatch' };
  }
  return {
    ok: true,
    reason: 'authorized',
    authorization: {
      round: authorization.round,
      at: authorization.at.trim(),
      source: authorization.source.trim(),
      reason: authorization.reason.trim(),
      node,
    },
  };
}

// 上限后的续轮授权形态（步骤 3）：授权形态复用 parseReplanAuthorization（单一权威——不复制第二份
// 字段校验）；本函数只追加续轮特有约束：round 必须覆盖即将执行的轮次（已用轮次 + 1，与 reentry
// 续轮同语义），否则视为未授权 fail-closed。未达上限时调用方不得传续轮授权。本函数只做形态判定，
// 不读 history。
export function parseReplanContinuationAuthorization({ authorization, node, used } = {}) {
  const parsed = parseReplanAuthorization({ authorization, node });
  if (!parsed.ok) return parsed;
  if (typeof used !== 'number' || !Number.isInteger(used) || used < 0
    || parsed.authorization.round < used + 1) {
    return { ok: false, reason: 'round-below-required' };
  }
  return { ok: true, reason: 'continuation-authorized', authorization: parsed.authorization };
}

// 轮次派生（步骤 3）：统计 state.history 中本 change 的 replan-applied 事件数；change 归属过滤复用
// historyEventBelongsToChange（单一权威）。跨 change 隔离依赖事件 change 字段；无 change 字段的旧
// 事件按 legacy 形态参与（replan-applied 为既有事件类型，legacy 形态实际不会出现）。history 缺失 /
// 非数组 = 无事件（旧 state 形态，0 轮）。
export function replanRoundCount({ history, changeName } = {}) {
  if (!Array.isArray(history)) return 0;
  let count = 0;
  for (const event of history) {
    if (!event || event.event !== 'replan-applied') continue;
    if (!historyEventBelongsToChange(event, changeName)) continue;
    count += 1;
  }
  return count;
}

// 上限判定（步骤 3）：已用轮次 < REPLAN_ROUND_LIMIT 或持有合法续轮授权 → 放行并给出本轮序号
// （nextRound = 已用 + 1，供审计事件与 REPLAN 行使用）；否则 blocked（调用方必须先于任何 state
// 写盘返回，保证字节零改写）。阈值只从 REPLAN_ROUND_LIMIT 取。
export function replanRoundDecision({ history, changeName, continuationAuthorized = false } = {}) {
  const used = replanRoundCount({ history, changeName });
  if (used < REPLAN_ROUND_LIMIT) {
    return { ok: true, reason: 'round-available', used, nextRound: used + 1, limit: REPLAN_ROUND_LIMIT };
  }
  if (continuationAuthorized === true) {
    return { ok: true, reason: 'round-available-continuation', used, nextRound: used + 1, limit: REPLAN_ROUND_LIMIT };
  }
  return { ok: false, reason: 'round-limit-reached', used, limit: REPLAN_ROUND_LIMIT };
}

// 空操作判定（步骤 4）：目标形态已成立 = state.taskHash 已与当前 TASK.md 签名同签（复用
// sameTaskSetSignature / taskSetSignature 既有版本语义——算法版本偏斜按不可比处理，不误拦）
// → noop（调用方零备份 / 零轮次 / 零事件 / 零改写）。判定本身不改写输入；返回 taskSetSignature
// 供调用方重签 / 写审计事件（避免第二份签名计算导致漂移）。
// 依赖缺失 fail-closed：taskContent 缺失 / 非字符串 / 空串 → 不允许判空操作（缺 TASK.md 时签名
// 退化为空任务集，放行会掩盖「文件不可读」），由调用方按重校失败 BLOCK。
export function replanNoOpDecision({ state, taskContent } = {}) {
  if (typeof taskContent !== 'string' || taskContent === '') {
    return { noop: false, reason: 'task-content-missing', taskSetSignature: null };
  }
  const signature = taskSetSignature(taskContent);
  const same = sameTaskSetSignature(state?.taskHash, signature);
  return same
    ? { noop: true, reason: 'noop-target-satisfied', taskSetSignature: signature }
    : { noop: false, reason: 'target-state-not-satisfied', taskSetSignature: signature };
}

// 受控重校综合判定（单一权威聚合判定 · 供 replan 子命令单点调用），返回三态 action：
//   'block'（ok:false，调用方零写盘返回）、
//   'noop' （目标形态已成立，调用方零写盘提示；仅当调用方传入 taskContent 时参与聚合）、
//   'apply'（ok:true，携带 changeName / node / 本轮 round / 归一授权；taskContent 在场时附带
//            当前任务集签名，供调用方直接重签 / 写事件）。
// 判定顺序：相位与 change 名（步骤 1）→ 授权形态（步骤 2）→ 上限与续轮（步骤 3）→ 幂等短路
// （步骤 4）；任何 block 分支都先于 state 写盘，保证字节零改写。幂等短路不得越过上限判定——
// 达到上限的 change 未持显式续轮授权时一律走人工裁决路径（与 reentry 族判定顺序同构）。
// taskContent 为可选入参：提供时在授权 / 轮次通过后聚合空操作判定（缺失 / 非字符串 / 空串
// → block，fail-closed）；未提供时返回 apply/block 两态，由调用方单独调用 replanNoOpDecision
// （两处判定同源，调用方不得复制判据）。
export function resolveReplanDecision({ protocol, state, authorization, continuationRound, taskContent } = {}) {
  const currentChange = state?.activeChange;
  const node = state?.currentNode;
  const source = replanSourceDecision({ protocol, currentNode: node, activeChange: currentChange });
  if (!source.ok) return { ok: false, action: 'block', reason: source.reason };
  const parsed = parseReplanAuthorization({ authorization, node });
  if (!parsed.ok) return { ok: false, action: 'block', reason: parsed.reason };
  const used = replanRoundCount({ history: state?.history, changeName: currentChange });
  const atLimit = used >= REPLAN_ROUND_LIMIT;
  let continuationAuthorized = false;
  if (atLimit) {
    const continuation = parseReplanContinuationAuthorization({
      authorization: continuationRound === undefined || continuationRound === null
        ? null
        : {
          ...(authorization && typeof authorization === 'object' && !Array.isArray(authorization) ? authorization : {}),
          round: continuationRound,
        },
      node,
      used,
    });
    if (!continuation.ok) {
      return { ok: false, action: 'block', reason: 'round-limit-reached', used, limit: REPLAN_ROUND_LIMIT };
    }
    continuationAuthorized = true;
  } else if (continuationRound !== undefined && continuationRound !== null) {
    return { ok: false, action: 'block', reason: 'continuation-not-required', used, limit: REPLAN_ROUND_LIMIT };
  }
  if (taskContent !== undefined) {
    if (typeof taskContent !== 'string' || taskContent === '') {
      return { ok: false, action: 'block', reason: 'task-content-missing' };
    }
    const noop = replanNoOpDecision({ state, taskContent });
    if (noop.noop) {
      return {
        ok: true,
        action: 'noop',
        reason: noop.reason,
        changeName: currentChange,
        node,
        taskSetSignature: noop.taskSetSignature,
      };
    }
  }
  const round = replanRoundDecision({
    history: state?.history,
    changeName: currentChange,
    continuationAuthorized,
  });
  if (!round.ok) {
    return { ok: false, action: 'block', reason: round.reason, used: round.used, limit: round.limit };
  }
  return {
    ok: true,
    action: 'apply',
    reason: 'replan-authorized',
    changeName: currentChange,
    node,
    round: round.nextRound,
    continuationAuthorized,
    authorization: parsed.authorization,
    ...(taskContent !== undefined ? { taskSetSignature: taskSetSignature(taskContent) } : {}),
  };
}
