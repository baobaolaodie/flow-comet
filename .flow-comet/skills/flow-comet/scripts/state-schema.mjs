// state-schema.mjs: state 字段类型校验表（唯一来源）
// 批次 D 内置节点常量：自 workflow-state.mjs C6 内联表原样迁移，供 workflow-state / workflow-guard / workflow-handoff 三脚本共用。
// 语义（与批次 C C6 完全一致）：存在字段逐一校验；未知字段放行（前向兼容）；缺字段放行（readState 默认补）；
// 只校验存在字段的类型。调用方负责 BLOCKED / exit(1) 处理。

// ---------- 运行时路径常量（单一来源）----------
// 「状态文件在哪」曾是一个被独立表达在 6 处的决策（协议 state.statePath、workflow-state 默认值、
// workflow-handoff 默认值、comet-hook-guard 的 STATE_FILE_REL / 回退值 / runRoot 锚点 / 相位读取、
// workflow-guard 的跨命名空间探测常量、安装器迁移白名单）——改一处不会让另一处报警，主仓安装副本
// 滞后一轮即导致写入拦截全程静默失效且外观正常。此处收敛为唯一来源，各脚本 import 之，不再各自硬编码。
// 取值一律为「项目根相对路径、POSIX 分隔符」（与 workflowRelativeSegments /
// resolveWorkflowRelativePath 的归一化语义一致）；比较前调用方自行归一化。
export const RUNTIME_DIR = '.flow-comet';
export const RUNTIME_STATE_FILE_NAME = 'flow-comet-state.json';
export const RUNTIME_STATE_PATH = RUNTIME_DIR + '/' + RUNTIME_STATE_FILE_NAME;
// 旧命名空间（三方共占目录）。仅用于诊断探测与安装器迁移，绝不作为运行时回退路径（fail-closed 语义不变）。
// 只导出完整相对路径——消费方（guard 的跨命名空间探测）按整文件路径使用，导出裸目录名属于无消费方的
// 死 API 面（且会诱使调用方自行拼路径，重新引入第二处决策）。
export const LEGACY_RUNTIME_STATE_PATH = '.comet/' + RUNTIME_STATE_FILE_NAME;

// 疑似对象字面量判定（单一来源——设计语义 / AC-1：workflow-state record 与
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
  // Fix 受控归位轮次按 change 存储:change-id → 非负整数计数(与 verifyFailuresByChange 同型;
  // 旧 state 缺字段默认 0,旧 change 不因计数卡死)
  { field: 'fixRoundsByChange', check: (v) => (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)) || v === undefined || v === null },
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

// ---------- fixRounds 按 change 读写(单一来源——受控归位计数 helper 与两个归位入口共用) ----------

// 读取当前 change 的 Fix 受控归位轮次;旧 state 缺字段 / 缺当前 change 条目 → 0(不因计数卡死)。
// 该计数与 verifyFailuresByChange 各自独立:verify 成功只清 verify 失败计数,不清归位轮次。
export function fixRoundsFor(state) {
  if (!state || !state.activeChange) return 0;
  const rounds = state.fixRoundsByChange;
  if (!rounds || typeof rounds !== 'object' || Array.isArray(rounds)) return 0;
  const value = rounds[state.activeChange];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

// 写入当前 change 的 Fix 受控归位轮次(容器缺失时按需创建;无 activeChange 时为无操作)
export function setFixRoundsFor(state, value) {
  if (!state || !state.activeChange) return;
  if (!state.fixRoundsByChange || typeof state.fixRoundsByChange !== 'object' || Array.isArray(state.fixRoundsByChange)) {
    state.fixRoundsByChange = {};
  }
  state.fixRoundsByChange[state.activeChange] = value;
}
