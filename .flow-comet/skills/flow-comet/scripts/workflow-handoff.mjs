#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateStateFields, looksLikeObjectLiteral, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME } from './state-schema.mjs';
import { EXECUTE_FAMILY_NODE_IDS, protocolNodeEnabled, resolveDelegationTarget, taskDependencyEligibility } from './route-node.mjs';
import {
  resolveProtocol,
  readProtocolFile,
  validateProtocolSchema,
  inspectWorkflowPathSegments,
} from './protocol-utils.mjs';
import { taskAttrsById, taskBlocks, taskOpeningAttrs } from './task-parsing.mjs';

// workflow-handoff.mjs: Record subagent handoff evidence
// evidence 统一记录在 subagent-execute 名下作为委托证据库——execute（串行委托）与 subagent-execute（并行委托）共用。不改成节点参数，保持最小改动。
// Usage:
//   node workflow-handoff.mjs request <task-id> <description> [--write-files <files...>]  -- record handoff request (W2-D: optional writeFiles allow-list)
//   node workflow-handoff.mjs result <task-id> <result-or-JSON>  -- record handoff result (W1-D: JSON Return Contract; W2-D: commitHash subset check; : completedChecks 规范化; redEvidence 时间顺序校验)
//   node workflow-handoff.mjs status                           -- show all handoff evidence

// 归属门禁读取协议用：与其它脚本同源（packageRoot 默认协议；env 可覆盖），不消费 request 参数。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const runRoot = process.cwd();
// 状态文件路径（单一来源：state-schema.mjs 的运行时路径常量）
const statePath = path.join(runRoot, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME);

async function fileExists(f) { try { await fs.access(f); return true; } catch { return false; } }

// 技能加载声明标记存在性（技能加载前置门·方案 A）：校验 .skill-loads/ 下
// 是否有该节点的声明标记 <node>-*.json（任一 skill 标记即算已声明——与 guard exit 侧
// 的 exit 协议声明标记校验、workflow-state record 前置门同构：按 <node>- 前缀扫描；
// 活动路径优先，归档路径兜底）。委托前置门在「先加载技能（Skill 工具）并 skill-load
// 声明」之前拦截"先干活后补声明"。诚实边界：标记是自我声明，非物理证明。
async function nodeSkillDeclared(nodeId, changeName) {
  if (!nodeId || !changeName) return false;
  const prefix = nodeId + '-';
  const scan = async (dir) => {
    try {
      const entries = await fs.readdir(dir);
      return entries.some((f) => f.startsWith(prefix) && f.endsWith('.json'));
    } catch {
      return false;
    }
  };
  const activeDir = path.join(runRoot, '.specs', changeName, '.skill-loads');
  if (await scan(activeDir)) return true;
  const archiveRoot = path.join(runRoot, '.specs', 'archive');
  const archiveEntries = await fs.readdir(archiveRoot).catch(() => []);
  for (const entry of archiveEntries) {
    if (!entry.endsWith('-' + changeName)) continue;
    if (await scan(path.join(archiveRoot, entry, '.skill-loads'))) return true;
  }
  return false;
}

// 契约解析失败判定（单一来源）：looksLikeObjectLiteral 由 state-schema.mjs 导出——
// trim 后以 {/[ 开头 → 视作"形似对象字面量"；若 JSON.parse 失败 → fail-closed。

// --json-file 路径校验:解析后必须位于项目根内(与 record 同规则——拒绝越界路径,
// 防读取任意文件内容进 evidence;runRoot 内绝对路径合法)。符号链接解析后的实际路径
// 同样必须在项目根内(词法校验不防 symlink 穿越——realpath 后再次校验)。
// 非字符串/空值(如 --json-file 为最后一个参数)→ 用法错误,与 record 同消息
async function resolveJsonFileWithinRunRoot(jsonFile) {
  if (typeof jsonFile !== 'string' || jsonFile.trim() === '') {
    throw new Error('--json-file requires a path argument');
  }
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

// writeFiles 段感知 glob 匹配:按 / 分段,`*` 只匹配段内任意字符(不跨段);
// 精确条目要求完全相等(不用前缀匹配——src/foo 不得匹配 src/foobar);
// 段内含 * 的部分通配(如 src/*.test.js、src/*.mjs)转锚定正则匹配
// 路径分隔符归一（单一来源）：Windows 反斜杠 → POSIX `/`；matchWriteFilePattern 与
// F-6 字面路径资格判定共用（同口径两处实现必分叉——L-067）。
function toPosixPath(value) {
  return String(value).replace(/\\/g, '/');
}

function matchWriteFilePattern(file, pattern) {
  const f = toPosixPath(file);
  const p = toPosixPath(pattern);
  const fp = f.split('/');
  const pp = p.split('/');
  if (fp.length !== pp.length) return false;
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '*') continue;
    if (!pp[i].includes('*')) {
      if (pp[i] !== fp[i]) return false;
      continue;
    }
    // 段内 glob:`*` 匹配段内任意字符(不跨 /),其余字符字面匹配(锚定)
    const seg = new RegExp('^' + pp[i].split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*') + '$');
    if (!seg.test(fp[i])) return false;
  }
  return true;
}

// ---------- F-6 零提交资格（DESIGN 决策 7 · fail-closed） ----------
// 字面路径 → repo 相对 POSIX 路径归一：仅接受不含 glob 魔法（* ? [）的字面路径；拒绝绝对
// 路径（POSIX 前导 /、盘符前缀、UNC）与 .. 逃逸、空段。返回归一后相对路径，或 null（无资格）。
function literalRelativePosixPath(entry) {
  if (typeof entry !== 'string') return null;
  const raw = entry.trim();
  if (raw === '' || /[*?[]/.test(raw)) return null;
  const posix = toPosixPath(raw);
  if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) return null;
  const normalized = path.posix.normalize(posix);
  if (normalized === '' || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  // 必须位于 runRoot 内：解析后相对路径逐字复核（词法拒绝后的二次保险，含平台路径语义差异）
  const relToRoot = path.relative(runRoot, path.resolve(runRoot, normalized));
  if (relToRoot === '' || path.isAbsolute(relToRoot) || relToRoot === '..' || relToRoot.startsWith('..' + path.sep)) {
    return null;
  }
  return normalized;
}

// `check-ignore` 退出 1 时判别路径是否已被 index 跟踪（index-aware 默认下 tracked 不算 ignored）：
// 命中 → became-tracked，未命中 → 忽略规则变化。仅作失败归类，任一探测异常按未跟踪处理（仍 fail-closed）。
function gitIndexTracksPath(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: runRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 资格判定：全部字面路径 + runRoot 等于 git top-level 的 realpath + 逐路径
// `git check-ignore -q -- <repo-relative-path>` 退出 0（cwd=runRoot，数组参数、index-aware
// 默认：tracked 文件退出 1）→ eligible；任一不满足 → 带 reason 的 fail-closed 结论
//（request 侧只看 eligible、不记 noCommit、不阻断原流程；result 侧把 reason 写入撤销审计）。
// 不用 --no-index、不 import prepare-env（不分发）。
// 路径扫描增强（m-13）：runRoot 先 realpath 归一；对每个字面路径的最近已存在祖先逐段 lstat，
// 任一段为 symlink/junction（或物理逃出 runRoot）→ fail-closed（目标不存在不算失败）。
// 逐段扫描复用 protocol-utils 的单一权威，本处不得另写第二份 symlink/包含判据（L-067）。
// 失败类别（稳定机器码，作为 result 撤销审计的 revokeReason）：invalid-path（glob / 绝对路径 /
// `..` 逃逸等字面形态不成立）、stale-eligibility（忽略规则变化，路径不再被证明 gitignored）、
// became-tracked（路径已在 index 中）、symlink-junction-escape（祖先段 symlink/junction 或
// 物理越界）、non-git（非 git 仓 / runRoot 非 top-level / git 探测错误）。
async function classifyWriteFilesProvablyIgnored(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return { eligible: false, reason: 'invalid-path' };
  const relPaths = [];
  for (const entry of entries) {
    const rel = literalRelativePosixPath(entry);
    if (rel === null) return { eligible: false, reason: 'invalid-path' };
    relPaths.push(rel);
  }
  let realRoot;
  let realTop;
  try {
    realRoot = await fs.realpath(runRoot);
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: runRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const top = String(out).split('\n').map((s) => s.trim()).filter(Boolean)[0];
    if (!top) return { eligible: false, reason: 'non-git' };
    realTop = await fs.realpath(top);
  } catch {
    return { eligible: false, reason: 'non-git' }; // 非 git 仓 / git 不可用 / 命令错误
  }
  // windows 路径大小写不敏感（realpath 双方同源，仍按平台归一比较）
  const sameRoot = process.platform === 'win32'
    ? realRoot.toLowerCase() === realTop.toLowerCase()
    : realRoot === realTop;
  if (!sameRoot) return { eligible: false, reason: 'non-git' }; // runRoot 必须是 git top-level
  for (const rel of relPaths) {
    try {
      await inspectWorkflowPathSegments(realRoot, path.resolve(realRoot, rel), 'write_files 字面路径');
    } catch {
      return { eligible: false, reason: 'symlink-junction-escape' }; // 穿越 / 非目录祖先 / 物理越界
    }
    try {
      execFileSync('git', ['check-ignore', '-q', '--', rel], { cwd: runRoot, stdio: 'ignore' });
    } catch (error) {
      if (error && typeof error === 'object' && error.status === 1) {
        // check-ignore 退出 1 = 未命中忽略规则，或路径已被 index 跟踪（index-aware 默认）——
        // 用 ls-files 判别后落入既有失败归类。
        return { eligible: false, reason: gitIndexTracksPath(rel) ? 'became-tracked' : 'stale-eligibility' };
      }
      return { eligible: false, reason: 'non-git' }; // 命令错误等
    }
  }
  return { eligible: true, reason: null };
}

// 失败类别 → 审计文案（撤销 detail 与 revokeReason 机器码一一对应；新失败形态只在此扩展）。
const ZERO_COMMIT_REVOKE_REASON_TEXT = {
  'invalid-path': 'write_files 字面形态不成立（glob / 绝对路径 / .. 逃逸等）',
  'stale-eligibility': '.gitignore 变化（路径不再被证明 ignored）',
  'became-tracked': '路径变为 tracked',
  'symlink-junction-escape': 'symlink-junction 逃逸',
  'non-git': '非 git 仓 / runRoot 非 top-level / git 探测错误',
};

// ---------- m-13 result 零提交资格重验 ----------
// 仅当 request 记录 noCommit=true 且 writeFiles 非空时，在 result 时刻按同一增强资格重跑。
// 失败 → 撤销 request evidence 的 noCommit（置 false）并加法式记录 revokedAt（ISO 时间）与
// revokeReason（失败类别机器码——invalid-path / stale-eligibility / became-tracked /
// symlink-junction-escape / non-git）：
//   新 change → HANDOFF ERROR、不落 result（只落资格撤销），出口 W1-D 不再豁免缺 commitHash；
//   旧 change → HANDOFF WARN 后继续记录 result（出口 W1-D 同样不再豁免）。
// 返回 'skip'（形态不适用）/ 'pass'（资格仍成立）/ 'warn'（旧 change 已撤销）/ 'block'（新 change 已撤销）。
// 空 writeFiles、非 noCommit、无 request 记录均不扩大行为；未引用提交 / HEAD 移动 / TOCTOU /
// worktree 提交不可见等结构性 residual 由 T11/T12 文档登记，本函数不宣称已闭合。
async function revalidateResultZeroCommit(state, taskId, handoffReq) {
  if (!handoffReq || handoffReq.noCommit !== true) return 'skip';
  const entries = Array.isArray(handoffReq.writeFiles) ? handoffReq.writeFiles : [];
  if (entries.length === 0) return 'skip';
  const verdict = await classifyWriteFilesProvablyIgnored(entries);
  if (verdict.eligible) return 'pass';
  // 加法式撤销审计：noCommit=false（既有语义不变）+ revokedAt（ISO 时间）+ revokeReason
  //（失败类别，复用资格判定的失败归类）；每次撤销刷新为本次的 at/reason。
  handoffReq.noCommit = false;
  handoffReq.revokedAt = new Date().toISOString();
  handoffReq.revokeReason = verdict.reason;
  // 资格撤销先落盘（新旧 change 一致）：旧 change 后续若被其它门禁阻断，审计也不丢失，
  // 避免 WARN 声称已撤销而 state 仍是旧值。
  await writeState(state);
  const reasonText = ZERO_COMMIT_REVOKE_REASON_TEXT[verdict.reason] || verdict.reason;
  const detail = '任务 ' + taskId + ' 零提交资格 result 重验失败（' + reasonText + '）——request evidence noCommit=false, revokedAt=' + handoffReq.revokedAt + ', revokeReason=' + verdict.reason;
  if (state.newChange === true) {
    // 新 change 只落 request 资格撤销；此刻尚未默认 handoffResult，确保「不落 result」不是文案承诺
    console.error('HANDOFF ERROR: ' + detail + '；新 change 不落 result，出口校验不再豁免缺 commitHash。恢复: 修正 write_files / .gitignore 与路径形态后重新 request，或回传含合法 commitHash 的 Return Contract');
    return 'block';
  }
  console.error('HANDOFF WARN: ' + detail + '（旧 change 渐进，继续记录 result；出口校验不再豁免缺 commitHash）');
  return 'warn';
}

async function readState() {
  if (await fileExists(statePath)) return JSON.parse(await fs.readFile(statePath, 'utf8'));
  return { activeChange: null, currentNode: null, completedNodes: [], evidence: {} };
}

async function writeState(state) {
  // 内置节点常量: 与 workflow-state.mjs C6 同构——写入前校验已知字段类型（fail-closed），非法 → BLOCKED + exit 1
  const bad = validateStateFields(state);
  if (bad.length) {
    console.error('BLOCKED: state 字段类型非法: ' + bad[0]);
    process.exit(1);
  }
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ---------- request 归属门禁（只读判定） ----------
// 归属目标与依赖资格一律复用 route-node 的共享纯函数（单一权威）：门禁不在本文件内联
// 「parallel → 目标节点」映射。协议无对应 enabled 节点 → 跳过门禁（不产生归属 WARN）；
// 协议不可读 → 可见 WARN（含原因 +「本次未执行归属校验」）后放行，不静默、不新增硬 BLOCK。
// 判定只读 state 与协议：BLOCK 路径在首个 state.evidence 写入之前返回，state 字节零改写、不落请求记录。

// 协议读取（归属判定用）：协议路径走 protocol-utils 的统一解析（不消费 request 的 CLI 参数，
// 仅 env 覆盖 + packageRoot 默认协议）。读取/解析/schema 校验失败时不静默 skip：返回失败原因，
// 由调用方输出低噪声可见 WARN；新/旧 change 均不因此新增硬 BLOCK。
async function readOwnershipProtocol() {
  let protocolPath = null;
  try {
    protocolPath = resolveProtocol(packageRoot, runRoot);
    const protocol = await readProtocolFile(runRoot, protocolPath);
    validateProtocolSchema(protocol);
    return { protocol, failure: null };
  } catch (error) {
    return { protocol: null, failure: describeProtocolReadFailure(error, protocolPath) };
  }
}

// 协议读取失败原因归类（低噪声单行消息用；不打印堆栈、不回显文件内容）：
// 缺失 / 受保护路径拒绝 / JSON 解析失败 / schema 非法 / 其余原样归类。
function describeProtocolReadFailure(error, protocolPath) {
  const location = protocolPath === null ? '（路径未解析）' : '：' + protocolPath;
  const message = error && typeof error.message === 'string' ? error.message : String(error);
  if (error && error.code === 'ENOENT') return '协议文件不存在' + location;
  if (message.includes('must stay inside the project root')) {
    return '协议路径不在当前项目根内（受保护读取拒绝）' + location;
  }
  if (message.includes('is not valid JSON')) return '协议文件不是合法 JSON' + location;
  if (message.includes('protocol') || message.includes('schema')) {
    return '协议内容不合法：' + message;
  }
  return '协议读取失败：' + message;
}

// 路由事实：从 TASK.md 全文派生 done id 集合与目标任务块。解析走 task-parsing 的开标签
// 解析（与路由、guard 同一语义），不新增第二份正则。
function taskRouteFacts(taskContent, taskId) {
  const doneIds = new Set();
  let targetBlock = null;
  for (const block of taskBlocks(taskContent)) {
    const attrs = taskOpeningAttrs(block);
    if (!attrs) continue;
    if (attrs.status === 'done' && attrs.id) doneIds.add(attrs.id);
    if (taskId !== null && taskId !== undefined && attrs.id === String(taskId)) targetBlock = block;
  }
  return { doneIds, targetBlock };
}

// 归属判定：仅 status=pending 的任务参与；比较原始 state.currentNode（不取任何派生 currentNode）。
// 目标与依赖资格经 route-node 共享纯函数求得，与 next/路由使用同一判定。
// 返回 { verdict: 'skip' | 'pass' | 'not-entered' | 'mismatch' | 'not-delegable', ... }；
// skip 的 reason='protocol-unavailable' 携带 protocolFailure（调用方输出可见 WARN 后放行）。
async function assessRequestOwnership(state, taskAttrs, taskContent) {
  if (!taskAttrs || taskAttrs.status !== 'pending') return { verdict: 'skip', reason: 'not-pending' };
  const protocolRead = await readOwnershipProtocol();
  if (protocolRead.protocol === null) {
    return { verdict: 'skip', reason: 'protocol-unavailable', protocolFailure: protocolRead.failure };
  }
  const protocol = protocolRead.protocol;
  const { doneIds, targetBlock } = taskRouteFacts(taskContent, taskAttrs.id);
  const dependency = targetBlock
    ? taskDependencyEligibility(targetBlock, doneIds)
    : { eligible: false, deps: [], unmet: [] };
  const ownership = resolveDelegationTarget({
    taskAttrs,
    dependencyEligible: dependency.eligible,
    subagentNodeEnabled: protocolNodeEnabled(protocol, 'subagent-execute'),
    executeNodeEnabled: protocolNodeEnabled(protocol, 'execute'),
  });
  if (ownership.reason === 'not-pending' || ownership.reason === 'no-delegation-node') {
    return { verdict: 'skip', reason: ownership.reason };
  }
  if (ownership.reason === 'dependencies-unmet') {
    return { verdict: 'not-delegable', reason: ownership.reason, unmet: dependency.unmet };
  }
  if (state.currentNode !== ownership.targetNode) {
    return { verdict: 'mismatch', targetNode: ownership.targetNode, reason: ownership.reason };
  }
  const enteredNodes = Array.isArray(state.enteredNodes) ? state.enteredNodes : [];
  if (!enteredNodes.includes(ownership.targetNode)) {
    return { verdict: 'not-entered', targetNode: ownership.targetNode, reason: ownership.reason };
  }
  return { verdict: 'pass', reason: ownership.reason };
}

// 渲染归属判定结果（只输出与退出，不写 state）：
// 协议不可读 → 可见 WARN（含原因与「本次未执行归属校验」）后放行，不静默、不阻断。
// 不可委托 → 新 change BLOCK / 旧 change 可见 WARN 后继续；恢复指引以 workflow-state next 的
// 实际 NODE 输出为准，不固定指向 next 不会输出的节点（依赖未满足时路由按串行消化走 execute）。
// 归属目标不匹配 → 同样先按 next 的路由指引进入；正确节点未 entry → 可见 WARN 不阻断。
function reportRequestOwnership(state, taskId, taskAttrs, ownership) {
  const kind = taskAttrs && taskAttrs.parallel === true ? '并行' : '串行';
  const current = String(state.currentNode);
  if (ownership.verdict === 'skip' && ownership.reason === 'protocol-unavailable') {
    console.error('WARN: 任务 ' + taskId + ' 的委托归属校验未执行——协议不可读（'
      + ownership.protocolFailure + '）；本次未执行归属校验，请求照常记录（新/旧 change 均不因此阻断）');
    return;
  }
  if (ownership.verdict === 'not-delegable') {
    const unmet = Array.isArray(ownership.unmet) ? ownership.unmet : [];
    const detail = '任务 ' + taskId + '（' + kind + ' pending）当前不可委托：依赖未满足'
      + (unmet.length > 0 ? '（未完成: ' + unmet.join(', ') + '）' : '')
      + '；原始 currentNode=' + current;
    const guide = '恢复指引: 运行 workflow-state next，按输出的 NODE 进入；若输出 execute 表示依赖未满足'
      + '（该任务当前按串行消化），待任务变为可委托（next 输出对应委托节点）后再 request';
    if (state.newChange === true) {
      console.error('BLOCKED: ' + detail + '——' + guide + '；本次请求未写入 state，也未记录 handoffRequests');
      process.exit(1);
    }
    console.error('WARN: ' + detail + '（旧 change 渐进不阻断，请求照常记录）——' + guide);
    return;
  }
  if (ownership.verdict === 'mismatch') {
    const detail = '任务 ' + taskId + '（' + kind + ' pending）应归属节点 '
      + ownership.targetNode + '，原始 currentNode=' + current;
    const guide = '恢复指引: 运行 workflow-state next 查看当前路由，按 NODE 输出进入'
      + '（本任务归属节点 ' + ownership.targetNode + '：workflow-state entry ' + ownership.targetNode
      + ' 或 workflow-guard entry ' + ownership.targetNode + '）后再发起委托';
    if (state.newChange === true) {
      console.error('BLOCKED: ' + detail + '——' + guide + '；本次请求未写入 state，也未记录 handoffRequests');
      process.exit(1);
    }
    console.error('WARN: ' + detail + '（旧 change 渐进不阻断，请求照常记录）——' + guide);
    return;
  }
  if (ownership.verdict === 'not-entered') {
    console.error('WARN: 任务 ' + taskId + ' 的归属节点 ' + ownership.targetNode
      + ' 与原始 currentNode 一致，但该节点尚未 entry（enteredNodes 缺 ' + ownership.targetNode
      + '）——建议先运行 workflow-state entry ' + ownership.targetNode + ' 或 workflow-guard entry '
      + ownership.targetNode + ' 记录进入');
  }
}
async function main() {
  const action = process.argv[2] ?? 'status';
  const state = await readState();

  if (action === 'request') {
    const taskId = process.argv[3];
    const args = process.argv.slice(4);
    if (!taskId) { console.error('Usage: workflow-handoff.mjs request <task-id> <description> [--write-files <files...>]'); process.exit(1); }
    // 技能加载前置门（方案 A）：发起委托前校验 execute/subagent-execute
    // 本节点 skill-load 声明标记已存在（.skill-loads/<node>-*.json）——先加载节点技能（Skill 工具）
    // 并 skill-load 声明，再发起委托。缺失 → 新 change BLOCK / 旧 change 渐进 WARN。
    // 与零提交语义独立共存：本门只校验节点技能声明，不依赖任务 write_files 内容。
    const requestNode = state.currentNode;
    if (requestNode && EXECUTE_FAMILY_NODE_IDS.has(requestNode)) {
      const declared = await nodeSkillDeclared(requestNode, state.activeChange);
      if (!declared) {
        const loadGuide = '先加载技能（用 Skill 工具，禁止跳过）并运行 workflow-state.mjs skill-load ' + requestNode + ' <skill> 再发起委托';
        if (state.newChange === true) {
          console.error('BLOCKED: 节点 ' + requestNode + ' 缺少技能加载声明标记（.skill-loads/' + requestNode + '-*.json）——' + loadGuide);
          process.exit(1);
        }
        console.error('WARN: 节点 ' + requestNode + ' 缺少技能加载声明标记（.skill-loads/' + requestNode + '-*.json）——' + loadGuide + '（旧 change 渐进不阻断）');
      }
    }
    // W2-D: 可选 --write-files 记录该 task 允许写入的文件列表（含 glob），供 result 的提交文件子集校验
    let description = 'pending';
    let writeFiles = [];
    const wfIdx = args.indexOf('--write-files');
    if (wfIdx >= 0) {
      description = args.slice(0, wfIdx).join(' ') || 'pending';
      writeFiles = args.slice(wfIdx + 1).filter(a => !a.startsWith('--')).flatMap(a => a.split(/[, ]+/)).filter(Boolean);
    } else {
      description = args.join(' ') || 'pending';
    }
    // 若未显式传 --write-files，从 TASK.md 自动解析（orchestrator 无需手动提取文件列表）。
    // 解析三态（bot 评审收紧）：① 匹配到任务块且 <write_files> 存在 → 按内容分类；
    // ② 任务块缺失或块内无 <write_files> 元素 → 任务不可解析，新 change BLOCK，旧 change
    // WARN 且不设 noCommit（防未解析任务静默变零提交逃逸口）；③ TASK.md 读不到同 ②。
    // TASK.md 只读一次：任务开标签属性解析（归属门禁）复用 task-parsing.mjs；
    // 下方 write_files 元素提取沿用既有实现（该路径的解析策略不在本任务改动面内）。
    const taskFile = state.activeChange
      ? path.join(runRoot, '.specs', state.activeChange, 'TASK.md')
      : null;
    let taskContent = null;
    if (taskFile) {
      taskContent = await fs.readFile(taskFile, 'utf8').catch(() => null);
    }
    let taskResolved = false;
    let emptyWriteFilesElement = false;
    if (!writeFiles || writeFiles.length === 0) {
      if (taskContent !== null) {
        const taskRegex = new RegExp(`<task[^>]*id="${taskId.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}"[\\s\\S]*?<write_files>([\\s\\S]*?)</write_files>`, 'i');
        const match = taskContent.match(taskRegex);
        if (match) {
          taskResolved = true;
          // 分号容错：与 workflow-guard.mjs 伪并行启发式同源实现（分号容错双点内联，与 workflow-guard.mjs 同源互锚）
          // 先剥整块 HTML 注释再拆分——多行注释内容不得混入路径条目（与 workflow-guard 同口径）
          const files = match[1].replace(/<!--[\s\S]*?-->/g, '').trim().split(/\s*\n\s*/).map(f => f.trim()).filter(Boolean)
            .flatMap(f => f.split(';')).map(f => f.trim()).filter(Boolean);
          if (files.length > 0) { writeFiles = files; }
          else { emptyWriteFilesElement = true; }
        }
      }
      if (wfIdx >= 0) { taskResolved = true; emptyWriteFilesElement = false; }
    } else {
      taskResolved = true;
    }
    if (!taskResolved) {
      const msg = '委托任务不可解析：TASK.md 缺失、无匹配 <task id=' + taskId + '> 或任务缺 <write_files> 元素——无法判定零提交语义；修正 TASK.md 后重试';
      if (state.newChange === true) {
        console.error('BLOCKED: ' + msg);
        process.exit(1);
      }
      console.error('WARN: ' + msg + '（旧 change 渐进，不阻断，不记录 noCommit）');
    }
    // request 归属门禁：技能声明门之后、任务解析之后、首个 state.evidence 写入之前。
    // 只读判定；新 change 不匹配 → BLOCK（state 字节零改写、不落 handoffRequests）；旧 change → 可见 WARN 后照常记录。
    const parsedTask = taskAttrsById(taskContent, taskId);
    if (!parsedTask && wfIdx >= 0) {
      console.error('WARN: 显式 --write-files 且 TASK.md 无匹配任务 ' + taskId + '——无法判定 pending 与归属，跳过归属门禁（不阻断，照常记录）');
    }
    reportRequestOwnership(state, taskId, parsedTask, await assessRequestOwnership(state, parsedTask, taskContent));
    state.evidence = state.evidence || {};
    state.evidence['subagent-execute'] = state.evidence['subagent-execute'] || {};
    if (!state.evidence['subagent-execute'].handoffRequests) {
      state.evidence['subagent-execute'].handoffRequests = {};
    }
    const zeroEligible = taskResolved && emptyWriteFilesElement && writeFiles.length === 0;
    // F-6（DESIGN 决策 7）：非空 write_files 的「全部可证明 gitignored」资格——与空元素同语义，
    // 记 noCommit:true；不具资格 → 不记 noCommit、不阻断原流程（保持既有完整提交子集校验）。
    const literalIgnoredEligible = taskResolved && writeFiles.length > 0
      && (await classifyWriteFilesProvablyIgnored(writeFiles)).eligible;
    state.evidence['subagent-execute'].handoffRequests[taskId] = {
      description, requestedAt: new Date().toISOString(),
      ...(writeFiles.length ? { writeFiles } : {}),
      ...(zeroEligible || literalIgnoredEligible ? { noCommit: true } : {})
    };
    await writeState(state);
    if (literalIgnoredEligible) {
      console.error('HANDOFF 零提交资格: ' + taskId + ' — write_files 全部可证明 gitignored');
    }
    console.log('HANDOFF REQUEST: ' + taskId);
    return;
  }

  if (action === 'result') {
    const taskId = process.argv[3];
    // --json-file <path>(或 --json-file=<path>):从文件读 JSON payload——与 record 对齐,
    // 规避 Windows PowerShell 剥离内嵌双引号导致 JSON 损坏(存成脏字符串)
    let jsonFile = null;
    const resultArgs = [];
    const rawArgs = process.argv.slice(4);
    for (let i = 0; i < rawArgs.length; i++) {
      const arg = rawArgs[i];
      if (arg === '--json-file') { jsonFile = rawArgs[i + 1]; i += 1; continue; }
      if (typeof arg === 'string' && arg.startsWith('--json-file=')) { jsonFile = arg.slice('--json-file='.length); continue; }
      resultArgs.push(arg);
    }
    let raw = resultArgs.join(' ');
    if (jsonFile !== null) {
      raw = await fs.readFile(await resolveJsonFileWithinRunRoot(jsonFile), 'utf8');
    }
    if (!taskId) { console.error('Usage: workflow-handoff.mjs result <task-id> <result>'); process.exit(1); }
    // W1-D: 尝试解析 JSON（Return Contract）——解析失败则存原始字符串
    let parsed = raw;
    try { parsed = JSON.parse(raw); } catch {
      // 契约解析失败 fail-closed:payload 形似对象但 JSON.parse 失败 → 报错并
      // process.exit(1),不写 handoffResult——Return Contract 应为合法 JSON
      // （旧语义把不可解析 raw 静默存字符串 = 静默落脏,guard exit 误报
      // "非 Return Contract"掩盖真因）
      // 消息按参数来源分级（设计语义 / AC-3）:--json-file 传入且文件内容损坏 →
      // "文件内容不是合法 JSON" + 长度元数据;内联传参损坏 → 保留 --json-file 建议。
      // 安全(bot 审查):错误消息与 workflow-state record 统一——只含固定前缀 +
      // 长度元数据,绝不打印 raw 内容(含截断)。
      if (looksLikeObjectLiteral(raw)) {
        if (jsonFile !== null) {
          console.error('文件内容不是合法 JSON (length=' + String(raw ?? '').length + ')');
        } else {
          console.error('payload looks like an object literal but is not valid JSON (length=' + String(raw ?? '').length + '); use --json-file <path> to pass the payload');
        }
        process.exit(1);
      }
    }
    state.evidence = state.evidence || {};
    state.evidence['subagent-execute'] = state.evidence['subagent-execute'] || {};
    const handoffReq = state.evidence['subagent-execute'].handoffRequests?.[taskId];
    const hasRequest = !!handoffReq && typeof handoffReq === 'object';
    // m-13：result 重验在默认 handoffResult 之前——新 change 失败路径只落 request.noCommit=false，
    // 不落下空 handoffResult 充当 result 载体；重验通过/旧 change 之后才初始化结果容器。
    if (await revalidateResultZeroCommit(state, taskId, handoffReq) === 'block') process.exit(1);
    state.evidence['subagent-execute'].handoffResult = state.evidence['subagent-execute'].handoffResult || {};
    // 零提交任务语义：已有 request 记录且其写文件列表为空（无 tracked 写意图）或带 noCommit
    // 标记（空 write_files 或全部可证明 gitignored——request 侧 F-6 资格判定的结论）时，判定为
    // 零提交——跳过提交文件子集校验并输出可审计提示。契约侧 noCommit 声明仅作
    // 审计线索：写文件列表非空的任务即使契约声称零提交，仍执行完整提交文件子集校验（不可借
    // 零提交声明绕过真实提交检查）。无 request 记录的任务不适用零提交（保持既有完整校验）。
    // m-13：request.noCommit 在上述重验失败时已被撤销，故此处按撤销后的真实值重算。
    const reqWriteFiles = hasRequest ? (handoffReq.writeFiles || []) : [];
    const reqNoCommit = hasRequest && handoffReq.noCommit === true;
    const contractNoCommit = typeof parsed === 'object' && parsed !== null && parsed.noCommit === true;
    const isZeroCommit = hasRequest && (reqWriteFiles.length === 0 || reqNoCommit);
    if (isZeroCommit) {
      console.error('HANDOFF 零提交: ' + taskId + ' — 无 tracked 写文件（write_files 为空或全部可证明 gitignored），已跳过提交文件子集校验');
      // 零提交边界收紧（bot 评审实证逃逸口）：声明零提交的结果若携带含 tracked 文件的提交，
      // 等于从「空 write_files」旁路逃逸——新 change BLOCK / 旧 change WARN。探测异常降级
      // WARN 不阻断（对齐 M4 提交对象确认提示先例）。
      const zeroHash = (typeof parsed === 'object' && parsed !== null && parsed.commitHash && /^[0-9a-f]{7,40}$/i.test(String(parsed.commitHash)))
        ? String(parsed.commitHash) : null;
      if (zeroHash) {
        const { execSync } = await import('child_process');
        let committed = null;
        let probeFail = false;
        try {
          const out = execSync('git show ' + zeroHash + ' --name-only --format=', { cwd: runRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          committed = out.split('\n').map((s) => s.trim()).filter(Boolean);
        } catch {
          probeFail = true;
        }
        if (probeFail) {
          console.error('HANDOFF WARN: ' + taskId + ' 零提交提交对象不可校验——按确认提示语义不阻断');
        } else if (committed.length > 0) {
          const msg = taskId + ' 声明零提交但提交携带 tracked 文件: ' + committed.join(', ');
          if (state.newChange === true) {
            console.error('BLOCKED: ' + msg + '——回退越界文件或改按常规任务申报 write_files');
            process.exit(1);
          }
          console.error('HANDOFF WARN: ' + msg + '（旧 change 渐进，不阻断）');
        } else {
          console.error('HANDOFF 零提交: ' + taskId + ' — 提交为空，校验通过');
        }
      }
    } else if (contractNoCommit) {
      console.error('HANDOFF WARN: ' + taskId + ' — 契约声明零提交但 write_files 非空，仍执行完整提交文件子集校验（零提交声明不能绕过真实提交检查）');
    }
    // W2-D: 完整版 hash 校验——提交文件 ⊆ writeFiles 允许范围（子集，段感知匹配；越界仅 WARN）。
    // 零提交任务已在上方跳过（并输出可审计提示），此处只处理有提交哈希的常规任务。
    if (typeof parsed === 'object' && parsed !== null && parsed.commitHash && /^[0-9a-f]{7,40}$/i.test(String(parsed.commitHash))) {
      const commitHash = String(parsed.commitHash);
      if (!isZeroCommit) {
        const { execSync } = await import('child_process');
        try {
          const out = execSync(`git show ${commitHash} --name-only --format=`, { cwd: runRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          const committedFiles = out.split('\n').map(s => s.trim()).filter(Boolean);
          // 段感知精确匹配(writeFiles 条目按路径段 glob——src/foo 不匹配 src/foobar,
          // src/*.test.js 只匹配 src/ 下一层);*-SUMMARY.md 豁免收窄为精确的任务摘要路径
          // (.specs/<change-id>/<task-id>-SUMMARY.md——flow-comet 强制产物,非越界)
          const summaryExact = '.specs/' + state.activeChange + '/' + taskId + '-SUMMARY.md';
          const violations = committedFiles.filter(f => f !== summaryExact && !reqWriteFiles.some(a => matchWriteFilePattern(f, a)));
          if (violations.length > 0) {
            const currentState = await readState();
            if (currentState?.newChange === true) {
              console.error('BLOCKED: 提交文件超出 writeFiles 范围: ' + violations.join(', ') + '——新 change 强制委托边界;恢复: 回退越界文件或扩展 write_files');
              process.exit(1);
            }
            console.error('HANDOFF WARN: 提交文件超出 writeFiles 范围: ' + violations.join(', '));
          }
        } catch {
          console.error('HANDOFF ERROR: commitHash 无效或 git show 失败: ' + commitHash + '——协调者需确认原因(跨仓库 worktree 提交校验降级属预期,确认后继续)');
        }
      }
    } else if (typeof parsed === 'object' && parsed !== null && parsed.commitHash) {
      console.error('HANDOFF ERROR: commitHash 格式非法: ' + String(parsed.commitHash) + '——协调者需确认原因并记录(提交对象不可校验时,确认后继续)');
    }
    // redEvidence 时间顺序校验——重新 result 已存在 taskId 且该 task 已有 greenEvidence
    // 而无 redEvidence 时，新增 redEvidence 属于事后补录（TDD 要求 RED 先于 GREEN）→ BLOCKED。
    // 同批一次性回传 red+green 不受影响；已存在 redEvidence 的记录重录（补 green）同样不受影响
    const existing = state.evidence['subagent-execute'].handoffResult[taskId];
    if (existing && typeof existing.result === 'object' && existing.result !== null) {
      const old = existing.result;
      const hasGreen = !!(old.greenEvidence && typeof old.greenEvidence === 'object' && old.greenEvidence.command);
      const hasRed = !!(old.redEvidence && typeof old.redEvidence === 'object' && old.redEvidence.command);
      const newRed = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        && parsed.redEvidence && typeof parsed.redEvidence === 'object' && parsed.redEvidence.command;
      if (hasGreen && !hasRed && newRed) {
        console.error('BLOCKED: ' + taskId + ' redEvidence 事后补录（已记录 greenEvidence 而无 redEvidence——TDD 要求 RED 先于 GREEN，禁止事后补录掩盖缺 RED）');
        process.exit(1);
      }
    }
    // 解析 Return Contract 的 completedChecks 字段（数组），缺省记 []——规范化后随
    // result 一起存储，status 输出自然包含 completedChecks；guard W1-D 对条目做严格校验（
    // required-skill:subagent-execute.<skill>，无旧 change 豁免），此处不拦截只规范化
    // redEvidence/greenEvidence 写入 evidence 时附带 recordedAt 时间戳（时间顺序可
    // 审计；重录时保留同 key 首次记录时间，避免补录覆盖原始 RED/GREEN 时序）
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      parsed.completedChecks = Array.isArray(parsed.completedChecks) ? parsed.completedChecks : [];
      const now = new Date().toISOString();
      for (const key of ['redEvidence', 'greenEvidence']) {
        const ev = parsed[key];
        if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
          const prior = existing && typeof existing.result === 'object' && existing.result !== null
            && existing.result[key] && typeof existing.result[key] === 'object'
            && typeof existing.result[key].recordedAt === 'string'
            ? existing.result[key].recordedAt
            : null;
          parsed[key] = { ...ev, recordedAt: prior ?? now };
        }
      }
    }
    // C8: Return Contract 渐进校验——缺 greenEvidence/redEvidence（或 command 非字符串）仅 WARN 仍记录，
    // 不 BLOCK 不拒绝（避免卡死流程）；commitHash 非法格式维持上方现有 HANDOFF ERROR 行为不变
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      if (!parsed.greenEvidence || typeof parsed.greenEvidence !== 'object' || typeof parsed.greenEvidence.command !== 'string') {
        console.error('HANDOFF WARN: ' + taskId + ' 缺 greenEvidence（未执行 TDD GREEN？）');
      }
      if (!parsed.redEvidence || typeof parsed.redEvidence !== 'object' || typeof parsed.redEvidence.command !== 'string') {
        console.error('HANDOFF WARN: ' + taskId + ' 缺 redEvidence（未执行 TDD RED？）');
      }
    }
    state.evidence['subagent-execute'].handoffResult[taskId] = {
      result: parsed, completedAt: new Date().toISOString()
    };
    await writeState(state);
    console.log('HANDOFF RESULT: ' + taskId);
    return;
  }

  if (action === 'status') {
    const handoff = state.evidence?.['subagent-execute'] || {};
    console.log(JSON.stringify({
      activeChange: state.activeChange,
      handoffRequests: handoff.handoffRequests || {},
      handoffResults: handoff.handoffResult || {}
    }, null, 2));
    return;
  }

  console.error('Unknown action: ' + action + '. Use: request, result, status');
  process.exit(1);
}

main().catch(e => { console.error(e.message); process.exit(1); });
