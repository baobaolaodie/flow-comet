// state-schema.mjs: state 字段类型校验表（唯一来源）
// 批次 D D3：自 workflow-state.mjs C6 内联表原样迁移，供 workflow-state / workflow-guard / workflow-handoff 三脚本共用。
// 语义（与批次 C C6 完全一致）：存在字段逐一校验；未知字段放行（前向兼容）；缺字段放行（readState 默认补）；
// 只校验存在字段的类型。调用方负责 BLOCKED / exit(1) 处理。

export const STATE_FIELD_VALIDATORS = [
  { field: 'activeChange', check: (v) => typeof v === 'string' || v === null },
  { field: 'currentNode', check: (v) => typeof v === 'string' || v === null },
  { field: 'completedNodes', check: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string') },
  { field: 'evidence', check: (v) => typeof v === 'object' && v !== null && !Array.isArray(v) },
  { field: 'verifyFailures', check: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 },
  { field: 'executionMode', check: (v) => v === 'subagent' || v === 'direct' },
  { field: 'directOverride', check: (v) => typeof v === 'boolean' },
  { field: 'taskHash', check: (v) => typeof v === 'string' || v === undefined },
  // E5: 批次 E 新增字段（readState 默认补后类型校验；旧 state 缺失字段放行）
  { field: 'branchMode', check: (v) => typeof v === 'boolean' },
  { field: 'enablePrReview', check: (v) => typeof v === 'boolean' },
];

// 返回非法字段名数组（空 = 合法）。仅校验存在字段；unknown / 缺失字段一律放行。
export function validateStateFields(state) {
  const bad = [];
  if (state && typeof state === 'object') {
    for (const { field, check } of STATE_FIELD_VALIDATORS) {
      if (Object.prototype.hasOwnProperty.call(state, field) && !check(state[field])) {
        bad.push(field);
      }
    }
  }
  return bad;
}
