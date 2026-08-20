// state-schema.mjs: state 字段类型校验表（唯一来源）
// 批次 D 内置节点常量：自 workflow-state.mjs C6 内联表原样迁移，供 workflow-state / workflow-guard / workflow-handoff 三脚本共用。
// 语义（与批次 C C6 完全一致）：存在字段逐一校验；未知字段放行（前向兼容）；缺字段放行（readState 默认补）；
// 只校验存在字段的类型。调用方负责 BLOCKED / exit(1) 处理。

// 疑似对象字面量判定（单一来源——DESIGN D1 / AC-1：workflow-state record 与
// workflow-handoff result 共用，两脚本不再各自定义）：trim 后以 {/[ 开头 → 视作
// "形似对象字面量"（常见于 Windows 传参剥离内嵌引号后的损坏 JSON 形态）。
// 收窄（bot 审查）：仅保留「{/[ 开头」一条——移除 :/; 包含判定，避免拒绝普通纯文本 payload。
// 行为契约（逐字等价）：raw 为 null/undefined 时按空串处理（String(raw ?? '')）。调用方负责 fail-closed。
export function looksLikeObjectLiteral(raw) {
  const text = String(raw ?? '').trim();
  return text.startsWith('{') || text.startsWith('[');
}

export const STATE_FIELD_VALIDATORS = [
  { field: 'activeChange', check: (v) => typeof v === 'string' || v === null },
  { field: 'currentNode', check: (v) => typeof v === 'string' || v === null },
  { field: 'completedNodes', check: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string') },
  { field: 'evidence', check: (v) => typeof v === 'object' && v !== null && !Array.isArray(v) },
  { field: 'verifyFailures', check: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 },
  // verifyFailures 按 change 存储:change-id → 非负整数计数(旧顶层字段为迁移通道,新 state 用本字段)
  { field: 'verifyFailuresByChange', check: (v) => (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)) || v === undefined || v === null },
  { field: 'executionMode', check: (v) => v === 'subagent' || v === 'direct' },
  { field: 'directOverride', check: (v) => typeof v === 'boolean' },
  { field: 'taskHash', check: (v) => typeof v === 'string' || v === undefined },
  // M1: 节点进入标记（entry 写入,exit 检测未 entry;旧 state 缺失放行)
  { field: 'enteredNodes', check: (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string')) || v === undefined || v === null },
  // R6: 新 change 标记（init 写入 true——新旧判定的确定性依据,不依赖 entry;旧 state 缺失 = 旧 change 渐进兼容)
  { field: 'newChange', check: (v) => v === true || v === undefined || v === null },
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

// ---------- verifyFailures 按 change 读写(单一来源——workflow-state verify-fail 与
// workflow-guard exit verify 共用) ----------

// 读取当前 change 的 verifyFailures 计数;旧顶层字段(verifyFailures,迁移通道)首次读取时
// 并入当前 change 的计数并清除(旧 state 兼容,不丢历史失败次数)。无 activeChange 时
// 保持旧语义(顶层字段)——verify-fail 只在运行中 workflow 使用,该分支为兼容兜底。
export function verifyFailuresFor(state) {
  if (!state.activeChange) return state.verifyFailures ?? 0;
  if (state.verifyFailuresByChange === undefined || state.verifyFailuresByChange === null) {
    state.verifyFailuresByChange = {};
  }
  if (typeof state.verifyFailures === 'number' && state.verifyFailures > 0) {
    state.verifyFailuresByChange[state.activeChange] = (state.verifyFailuresByChange[state.activeChange] ?? 0) + state.verifyFailures;
  }
  delete state.verifyFailures;
  return state.verifyFailuresByChange[state.activeChange] ?? 0;
}

// 写入当前 change 的 verifyFailures 计数(迁移完成后旧顶层字段不再出现)
export function setVerifyFailuresFor(state, value) {
  if (!state.activeChange) {
    state.verifyFailures = value;
    return;
  }
  if (state.verifyFailuresByChange === undefined || state.verifyFailuresByChange === null) {
    state.verifyFailuresByChange = {};
  }
  state.verifyFailuresByChange[state.activeChange] = value;
  delete state.verifyFailures;
}
