// state-schema.mjs: state 字段类型校验表（唯一来源）
// 批次 D 内置节点常量：自 workflow-state.mjs C6 内联表原样迁移，供 workflow-state / workflow-guard / workflow-handoff 三脚本共用。
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
  // M1/M7: 节点进入标记（entry 写入,exit 检测未 entry;enteredNodes 非空 = enter 机制激活 = 新 change,
  // 供渐进 WARN 的新旧区分与 enter 证据检测使用;旧 state 缺失放行)
  { field: 'enteredNodes', check: (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string')) || v === undefined || v === null },
  // E5: 批次 E 新增字段（readState 默认补后类型校验；旧 state 缺失字段放行）
  { field: 'branchMode', check: (v) => typeof v === 'boolean' },
  { field: 'enablePrReview', check: (v) => typeof v === 'boolean' },
  // 机制说明-14: 分支前缀（init --branch-prefix 可配置，适配仓库自身分支规范；缺省 'change/'）
  { field: 'branchPrefix', check: (v) => typeof v === 'string' },
  // auto-init-detection: 项目上下文字段（'none' = 用户拒绝初始化；路径 = 用户指定文档）
  { field: 'ai_context_doc', check: (v) => typeof v === 'string' || v === null },
  // auto-init-detection: 上次全量初始化扫描时间（ISO 日期字符串或 null）
  { field: 'last_intel_scan', check: (v) => typeof v === 'string' || v === null },
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
