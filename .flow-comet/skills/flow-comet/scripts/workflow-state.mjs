#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveProtocol, readProtocolFile, validateProtocolSchema, NODE_PROTOCOL_FILES, SKILL_PROTOCOL_FILES, inspectWorkflowPathSegments } from './protocol-utils.mjs';
import { validateStateFields, verifyFailuresFor, setVerifyFailuresFor, looksLikeObjectLiteral, writeJsonAtomic, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME, toPersistedProtocolPath } from './state-schema.mjs';
import { isValidTimestamp, daysSince, isArchivedAfterTimestamp, hasSection9, nowTimestamp, parseTimestamp, EVOLVE_STALE_DAYS, EVOLVE_DUE_NEW_ARCHIVE_CHANGES } from './time-utils.mjs';
import { probeProject, classify, printDetection, validateContext, printGenerationGuide, extractContextStructure, skipInit } from './context-init.mjs';
import { taskOpeningAttrs, taskBlocks } from './task-parsing.mjs';
import { route, resolveNextNode, hasSubagentNode, protocolTaskFilePath, resolveFixRollbackDecision, resolveFixRollbackState, applyFixRollbackRound, resolveFixReturnNode, resolveReentryDecision, resolveReplanDecision, analyzeDependencyGraph, findParallelWriteConflicts, isSingleSegmentChangeName, REENTRY_ROUND_LIMIT, REENTRY_TARGET_NODE_IDS, REPLAN_ROUND_LIMIT, EXECUTE_FAMILY_NODE_IDS } from './route-node.mjs';

const command = process.argv[2] ?? 'status';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const runRoot = process.cwd();
// 协议解析: 协议路径统一由 resolveProtocol 解析——优先级：--protocol CLI 参数 → FLOW_COMET_PROTOCOL
// 环境变量 → 内置默认 reference/workflow-protocol.json。--protocol 为全局参数（可放在 command
// 之后的任意位置）；cliArgs = 去掉 command 后的剩余参数数组。
const protocolPath = resolveProtocol(packageRoot, runRoot, process.argv.slice(3));
// 状态文件路径（单一来源：state-schema.mjs 的运行时路径常量）
const statePath = path.join(runRoot, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME);
const specsRoot = path.join(runRoot, '.specs');

// 内置节点常量: 内置 8 节点常量（供其他用途参照——如 guard 的节点→协议映射对照；skill-load 的 node
// 参数校验已改为当前协议节点集合动态读取——compose 自定义协议节点可声明）
const BUILTIN_NODES = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify', 'archive'];

// 节点协议映射(单一来源): NODE_PROTOCOL_FILES 来自 protocol-utils.mjs(M5 record 自动补声明标记的 protocol 归属)

async function readJson(file) {
  // 容忍 UTF-8 BOM（外部写入如会话 Write 可能带 BOM）
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^﻿/, ''));
}

// JSON 写盘统一走状态层单一来源的原子写（state-schema.mjs 的 writeJsonAtomic → writeFileAtomic）：
// 先写同目录临时文件再 rename 覆盖目标——目标要么旧内容、要么新内容，不会出现被截断的半写状态；
// 写失败（磁盘满 / 权限 / 目标被占用）清理临时文件后抛出，调用方按 fail-closed 处理。mkdir recursive
// 由该实现承担（.skill-loads/ 等标记目录不存在时创建）；状态下发是单写者形态（机器字段只由脚本通道写）。

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

// 契约解析失败判定（单一来源）：looksLikeObjectLiteral 由 state-schema.mjs 导出——
// trim 后以 {/[ 开头 → 视作"形似对象字面量"；若 JSON.parse 失败 → fail-closed。

// --json-file 路径校验:解析后必须位于项目根内(拒绝相对/绝对形式的越界路径,
// 如 ../..、其他盘符——防读取任意文件内容进 evidence)。runRoot 内的绝对路径合法
// (场景内文件常见写法,与 record/handoff 的既有用法一致)。符号链接解析后的实际路径
// 同样必须在项目根内(词法校验不防 symlink 穿越——realpath 后再次校验)。
// 非字符串/空值(如 --json-file 为最后一个参数)→ 用法错误,不落 path.resolve
// (修复前 undefined 抛 TypeError、空串解析为 runRoot 报 EISDIR——报类型错误而非用法错误)
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

async function findActiveChange() {
  // 1. Read from state file if exists
  if (await fileExists(statePath)) {
    const state = await readJson(statePath);
    // completed 检查优先于 activeChange 分支——归档完成态（无论 activeChange 是否残留）
    // 一律不识别为 active（防归档残留目录/残留字段误判， 主修复）
    if (state.status === 'completed') return null;
    if (state.activeChange) {
      const changeDir = path.join(specsRoot, state.activeChange);
      if (await fileExists(changeDir)) return state.activeChange;
    }
  }
  // 2. Scan .specs/ for directories with TASK.md (active flow-kit changes)
  // 注:  曾尝试按 archive/ 对应归档跳过残留目录——但会误伤同名新 change（既有实证），已撤回。
  // 「state 缺失 + 归档残留」为已知限制（对比报告已记录"捡残留桩"共性问题）；归档后正常态由
  // 上文 completed 分支覆盖（ 主修复）
  try {
    const entries = await fs.readdir(specsRoot, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'archive' || entry.name === 'health' || entry.name === 'evolve' || entry.name === 'adr') continue;
      const taskFile = path.join(specsRoot, entry.name, 'TASK.md');
      if (await fileExists(taskFile)) candidates.push(entry.name);
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      // Return the most recently modified
      const withTime = await Promise.all(candidates.map(async c => ({
        name: c,
        mtime: (await fs.stat(path.join(specsRoot, c, 'TASK.md'))).mtimeMs
      })));
      withTime.sort((a, b) => b.mtime - a.mtime);
      return withTime[0].name;
    }
  } catch {}
  return null;
}

// ---------- skill-load 声明标记（completedChecks 真实性校验配套） ----------

// --prompt 原始参数提取（skill-load 专用参数）：--protocol 由 resolveProtocol 全局解析
// （CLI > env > 默认）为工作流协议 JSON——skill-load 曾用 --protocol 传 prompt 路径，主仓真实链路
// 必现撞车（markdown 被当协议 JSON 解析 → 启动报错「workflow protocol file is not valid JSON」，
// 已实证）。改名 --prompt 后与全局协议解析彻底解耦；此处仅取用户显式传入的原始值，供 skill-load
// 的 flow-kit/prompts/ 归属校验与标记记录。
function findPromptArg(cliArgs) {
  for (let index = 0; index < cliArgs.length; index++) {
    const arg = cliArgs[index];
    if (arg === '--prompt') {
      const value = cliArgs[index + 1];
      if (typeof value !== 'string' || value === '') return null;
      return value;
    }
    if (typeof arg === 'string' && arg.startsWith('--prompt=')) {
      const value = arg.slice('--prompt='.length);
      return value === '' ? null : value;
    }
  }
  return null;
}

// flow-kit/prompts/ 归属校验（相对或绝对路径，前缀校验）——flow-kit 为 vendored 上游，
// 协议提示只读引用；skill-load 声明的 --prompt 必须位于其 prompts 目录下。
// 相对路径：字符串前缀必须为 flow-kit/prompts/；绝对路径：路径段中必须含 flow-kit/prompts。
function protocolUnderFlowKitPrompts(value) {
  const normalized = String(value).replaceAll('\\', '/');
  if (!path.isAbsolute(value)) {
    return normalized.startsWith('flow-kit/prompts/');
  }
  const segments = normalized.split('/').filter((s) => s !== '');
  for (let index = 0; index <= segments.length - 2; index++) {
    if (segments[index] === 'flow-kit' && segments[index + 1] === 'prompts') return true;
  }
  return false;
}

// requiredSkillCalls scope 分类——按协议 requiredSkillCalls 查 <node>.<skill> 绑定：
// main scope = 协调者加载（如 flow-comet-subagent-execute），要求协调者 skill-load 标记；
// handoff scope = 子代理加载（如 subagent-execute 节点的 flow-comet-dev），协调者不加载它。
// 协议外条目（无绑定 / 非 main / 非 handoff scope）→ null（fail-closed：仍按 main 处理要标记）。
function findRequiredSkillBinding(protocol, nodeId, skillName) {
  const node = (protocol.nodes ?? []).find((n) => n.id === nodeId);
  if (!node) return null;
  return (node.requiredSkillCalls ?? []).find((binding) => binding.skill === skillName) ?? null;
}

// 标记目录解析——活动路径 .specs/<change-id>/.skill-loads/ 优先；归档路径兜底
// （archive 节点「先移目录后 record/exit」顺序下 change 目录已在 .specs/archive/<前缀>-<change-id>/，
// 标记只随目录移动——只查活动路径会误报缺失）。归档扫描匹配后缀 -<change-id>（前缀可含日期等，
// 与协议 flowkit.archive.v1 的 archive/*-<change-id> artifact 路径同构）。两者皆无 → null。
async function findSkillLoadsDir(changeName) {
  const activeDir = path.join(specsRoot, changeName, '.skill-loads');
  if (await fileExists(activeDir)) {
    return { dir: activeDir, display: '.specs/' + changeName + '/.skill-loads/' };
  }
  const archiveRoot = path.join(specsRoot, 'archive');
  const entries = await fs.readdir(archiveRoot).catch(() => []);
  for (const entry of entries) {
    if (!entry.endsWith('-' + changeName)) continue;
    const candidate = path.join(archiveRoot, entry, '.skill-loads');
    if (await fileExists(candidate)) {
      return { dir: candidate, display: '.specs/archive/' + entry + '/.skill-loads/' };
    }
  }
  return null;
}

// completedChecks 真实性校验。解析 completedChecks 的 required-skill:<node>.<skill>
// 条目 → 对应声明标记 .specs/<change-id>/.skill-loads/<node>-<skill>.json 必须存在（内置节点常量，缺失 →
// BLOCKED + 指引先加载 skill 并运行 skill-load）；标记 at 必须 ≤ 本次记录时间（交叉自洽：
// 标记先于记录声明；ISO-8601 UTC 字符串字典序 = 时间序）。仅校验本次 record 写入的
// completedChecks（旧 change 兼容：旧 evidence 不追溯——由调用方只传本次 parsed.completedChecks）。
// 条目按协议 requiredSkillCalls scope 分类——handoff scope 条目（子代理加载的 skill，
// 如 subagent-execute 节点的 flow-comet-dev）豁免标记，以共用证据库 evidence['subagent-execute']
// 的 handoffResult（有委托记录即满足）为证据；main scope / 协议外条目仍要求标记（fail-closed）。
// 诚实边界：标记是"声明"而非物理证明——运行时没有 Skill 调用观察点，脚本无法确认执行者
// 真实加载过该 skill；标记仅证明"执行者主动声明已加载"，由流程纪律兜底。handoff 条目的证据
// 同样不是物理证明——它是子代理回传的 Return Contract 委托声明（子代理自称已加载并执行），
// 由 handoff result 的 commitHash/greenEvidence 审计性兜底。
// 返回 { ok: true } 或 { ok: false, reason }（fail-closed：无 active change / 标记损坏同样 BLOCK）。
// 节点技能加载声明标记存在性（技能加载前置门·方案 A）：校验 .skill-loads/ 下
// 是否有该节点的声明标记 <node>-*.json（任一 skill 标记即算已声明——与 guard exit 侧的
// 「exit 协议声明标记校验」同构：按 <node>- 前缀扫描；活动路径优先，归档路径兜底）。
// 记录/委托前置门在「先加载技能（Skill 工具）并 skill-load 声明」之前拦截"先干活后补声明"。
// 诚实边界：标记是执行者自我声明，非物理证明（与 verifySkillLoadMarkers 同语义）。
async function hasNodeSkillDeclaration(nodeId, changeName) {
  if (!nodeId || !changeName) return false;
  const activeDir = path.join(specsRoot, changeName, '.skill-loads');
  const prefix = nodeId + '-';
  const scan = async (dir) => {
    try {
      const entries = await fs.readdir(dir);
      return entries.some((f) => f.startsWith(prefix) && f.endsWith('.json'));
    } catch {
      return false;
    }
  };
  if (await scan(activeDir)) return true;
  const archived = await findSkillLoadsDir(changeName);
  if (archived !== null && archived.dir !== activeDir) return scan(archived.dir);
  return false;
}

async function verifySkillLoadMarkers(completedChecks, changeName, recordTime, protocol, state) {
  if (!Array.isArray(completedChecks)) return { ok: true };
  const required = [];
  for (const check of completedChecks) {
    if (typeof check !== 'string' || !check.startsWith('required-skill:')) continue;
    const spec = check.slice('required-skill:'.length);
    const dot = spec.lastIndexOf('.');
    if (dot <= 0 || dot === spec.length - 1) {
      return { ok: false, reason: 'completedChecks 条目格式非法（应为 required-skill:<node>.<skill>）: ' + check };
    }
    required.push({ raw: check, node: spec.slice(0, dot), skill: spec.slice(dot + 1) });
  }
  if (required.length === 0) return { ok: true };
  if (!changeName) {
    return { ok: false, reason: 'completedChecks 含 required-skill 条目但无 active change——无法定位声明标记（先运行 init <change-id>）' };
  }
  for (const item of required) {
    // handoff scope 条目豁免标记——子代理加载的 skill（协调者不加载它，无法诚实
    // 声明加载），以共用证据库 handoffResult 的委托记录为证据；无委托记录 → BLOCK（不静默
    // 放行，指引先委托并回传 handoff result）
    const binding = findRequiredSkillBinding(protocol, item.node, item.skill);
    if (binding && binding.scope === 'handoff') {
      const handoff = state?.evidence?.['subagent-execute']?.handoffResult;
      const hasDelegation = !!(
        handoff &&
        typeof handoff === 'object' &&
        !Array.isArray(handoff) &&
        Object.keys(handoff).length > 0
      );
      if (!hasDelegation) {
        return {
          ok: false,
          reason: 'completedChecks 条目 ' + item.raw + ' 为 handoff scope（' + item.node +
            ' 节点的 ' + item.skill + ' 由子代理加载，协调者无需 skill-load 标记）但共用证据库' +
            ' evidence[subagent-execute].handoffResult 无委托记录——先委托子代理并回传 Return Contract（workflow-handoff.mjs result <task-id> <contract>）',
        };
      }
      continue;
    }
    // 标记路径解析——活动路径优先，归档路径兜底（archive 节点「先移目录后 record」
    // 顺序下标记只在 .specs/archive/*-<change-id>/.skill-loads/）；两处都找不到 → BLOCK + 指引
    // （不静默放行）。展示路径补 .specs/ 前缀便于用户定位。
    const markerName = item.node + '-' + item.skill + '.json';
    const activeDisplay = '.specs/' + path.posix.join(changeName, '.skill-loads', markerName);
    const activePath = path.join(specsRoot, changeName, '.skill-loads', markerName);
    let markerPath = await fileExists(activePath) ? activePath : null;
    let markerDisplay = activeDisplay;
    if (!markerPath) {
      const loadsDir = await findSkillLoadsDir(changeName);
      if (loadsDir !== null) {
        const altPath = path.join(loadsDir.dir, markerName);
        if (await fileExists(altPath)) {
          markerPath = altPath;
          markerDisplay = loadsDir.display + markerName;
        }
      }
    }
    if (!markerPath) {
      return {
        ok: false,
        reason: 'completedChecks 条目 ' + item.raw + ' 缺少对应声明标记 ' + activeDisplay +
          '（归档路径也未找到）——先加载该 skill 并运行 workflow-state.mjs skill-load ' + item.node + ' ' + item.skill,
      };
    }
    let marker;
    try {
      marker = await readJson(markerPath);
    } catch {
      return { ok: false, reason: '声明标记损坏（非法 JSON，需重新运行 skill-load）: ' + markerDisplay };
    }
    // 交叉自洽——标记 at 必须 ≤ 本次记录时间（标记先于记录声明）
    if (typeof marker.at !== 'string' || marker.at > recordTime) {
      return {
        ok: false,
        reason: '声明标记时间序非法（标记 at=' + JSON.stringify(marker.at) + ' 不早于本次记录时间 ' + recordTime +
          '）——标记必须先于记录声明（重新运行 skill-load）',
      };
    }
  }
  return { ok: true };
}

// ---------- 节点完成判定 · determineNode 数据化：完成标志从协议 outputSchemas 推导 ----------
// （节点完成判定核心抽取 · 依赖感知路由）: 节点完成判定核心已迁至共享模块 route-node.mjs——
// determineNode 保持既有签名与返回语义，仅改为委托 resolveNextNode（行为逐字等价，重构保持锚：
// 输出与抽取前 200 版一致）。route / buildNodeCompletionFlags / pathPatternExists / nodeFlagsComplete /
// protocolTaskFilePath / hasSubagentNode 已随抽取移至 route-node.mjs（单一实现，根治 guard 与
// 状态机双实现漂移的根治（单一实现决策）。
async function determineNode(changeName, protocol, completedNodes = []) {
  return resolveNextNode({ runRoot, changeName, protocol, completedNodes });
}

// 正常推进豁免判定——exit --apply 会把 currentNode 推进到下一节点（如 open exit 后
// currentNode=design，该节点尚未开始故 evidence 无记录），随后按 SKILL 协议调 next（正常路径）
// 不应被  误拦为"疑似未 exit"。判定三条件：① completedNodes 非空；② 最后一个已完成节点
// 存在 evidence（exit --apply 必须带证据通过——证据存在证明该 exit 真实发生，排除伪造/漂移状态，
// 如 review 无 evidence）；③ currentNode 是下一个合法路由目标——**路由后继优先**（exit --apply
// 把 currentNode 推进到共享路由判定 resolveNextNode 的结果，平行转换 plan→subagent-execute、
// 趟间回流 subagent-execute→execute 等即由此产生；next 正常推进豁免识别路由后继，与 guard
// NEXT 同源），静态直接后继兜底（串行推进原语义，旧态/序列流不回归）。与  回退豁免独立判断
// （回退 = TASK.md 有 pending 回退修复任务；本豁免 = 正常推进后继）。真乱序（currentNode
// 既非路由后继也非静态后继）仍维持  严格 BLOCK。
async function normalAdvanceExempt(state, protocol, completedNodes, currentNode, changeName) {
  if (completedNodes.length === 0) return false;
  const lastNodeId = completedNodes[completedNodes.length - 1];
  const routeIds = route(protocol).map((node) => node.id);
  const lastIdx = routeIds.indexOf(lastNodeId);
  if (lastIdx < 0) return false;
  const lastEvidence = state.evidence && typeof state.evidence === 'object'
    ? state.evidence[lastNodeId]
    : null;
  // 审查补充（2026-08-08）：evidence 必须是对象且含非空 summary（空对象 {} 可绕过豁免，
  // 真实流程 exit 强制 summary——此处严格化防止手动修改 state 绕过）
  const hasExitEvidence = !!(
    lastEvidence &&
    typeof lastEvidence === 'object' &&
    !Array.isArray(lastEvidence) &&
    typeof lastEvidence.summary === 'string' &&
    lastEvidence.summary.trim() !== ''
  );
  if (!hasExitEvidence) return false;
  // 路由后继判定（与 guard 出口同源）：currentNode === resolveNextNode(completedNodes) 即
  // 正常推进后的下一路由目标（含平行转换与趟间回流）；文件推导失败（异常态）不豁免。
  try {
    const routingNext = await determineNode(changeName, protocol, completedNodes);
    if (routingNext === currentNode) return true;
  } catch {
    return false;
  }
  // 静态直接后继兜底（串行推进原语义，向后兼容旧态不回归）
  return lastIdx + 1 < routeIds.length && routeIds[lastIdx + 1] === currentNode;
}

async function readState() {
  if (await fileExists(statePath)) {
    const st = await readJson(statePath);
    // 兼容旧 state：无 executionMode / directOverride 时补默认（subagent 默认，direct 是显式逃生口）
    if (st.executionMode === undefined) st.executionMode = 'subagent';
    if (st.directOverride === undefined) st.directOverride = false;
    // E1: branchMode 默认 true（git 仓库时 init 会判定为 true；非 git 仓库 init 纠正为 false；
    // status/next 显示以实时 git 检测为准——非 git 仓库显示 BRANCH: none）
    if (st.branchMode === undefined) st.branchMode = true;
    if (st.enablePrReview === undefined) st.enablePrReview = false;
    // 分支前缀（init --branch-prefix 记录；旧 state 缺省 'change/' 向后兼容）
    if (st.branchPrefix === undefined) st.branchPrefix = 'change/';
    return st;
  }
  return { activeChange: null, currentNode: null, completedNodes: [], evidence: {}, verifyFailures: 0, executionMode: 'subagent', directOverride: false, branchMode: true, enablePrReview: false };
}

// ---------- E1 · 分支模式辅助（git 仓库检测 + 分支名） ----------

// git 仓库检测：`git rev-parse --is-inside-work-tree` 成功且输出 true
function isInsideWorkTree() {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' });
    return String(out).trim() === 'true';
  } catch {
    return false;
  }
}

// 当前分支名；非 git 仓库 / detached HEAD 失败 → null
function gitBranchName() {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' });
    return String(out).trim() || null;
  } catch {
    return null;
  }
}

// 分支是否存在（本地分支）
function branchExists(name) {
  try {
    const out = execFileSync('git', ['branch', '--format', '%(refname:short)'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' });
    return String(out).split('\n').map(s => s.trim()).includes(name);
  } catch {
    return false;
  }
}

// E1: status/next 追加分支信息——BRANCH: <当前分支> | 一致性: ok|mismatch
// mismatch（activeChange 存在但当前分支不是 change/<activeChange>）→ WARN 不 BLOCK；非 git 仓库 → BRANCH: none
function printBranchLine(activeChange, branchPrefix = 'change/') {
  const branch = gitBranchName();
  if (branch === null) {
    console.log('BRANCH: none');
    return;
  }
  const expected = branchPrefix + activeChange;
  const consistent = branch === expected;
  console.log('BRANCH: ' + branch + ' | 一致性: ' + (consistent ? 'ok' : 'mismatch'));
  if (!consistent) {
    console.error('WARN: 分支与 activeChange 不一致——先 git checkout ' + expected + ' 再继续');
  }
}

// ---------- evolve 到期提示（AC-18：达阈值才输出，未达阈值零噪音） ----------

// 该时刻之后归档、且 DESIGN.md 带 §9 的 change 数。归档时刻取目录名日期前缀（flow-kit 约定
// archive/<YYYY-MM-DD>-<change-id>，该标签随提交固化、跨 clone 稳定）；「归档于何时」与「§9 是否
// 在场」两个判定都走 time-utils 单一来源——不在本脚本内联第二份表达式（L-067）。
// 读取失败 / 非目录 / 无 DESIGN.md / 无 §9 一律不计入（不误报）。
async function countSection9ArchivesSince(timestamp) {
  const archiveRoot = path.join(specsRoot, 'archive');
  let entries = [];
  try {
    entries = await fs.readdir(archiveRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !isArchivedAfterTimestamp(entry.name, timestamp)) continue;
    let design = '';
    try {
      design = await fs.readFile(path.join(archiveRoot, entry.name, 'DESIGN.md'), 'utf8');
    } catch {
      continue;
    }
    if (hasSection9(design)) count += 1;
  }
  return count;
}

// 到期提示：`last_evolve_at` 距今 > 60 天，或其后新增 ≥ 5 个带 §9 的归档 change → 输出一行；
// 否则**不打印任何行**（AC-18 反例锚：未达阈值零噪音）。旧 state 无该字段 = 从未跑过 evolve →
// 静默（本批不强制未接入 evolve 的项目补字段：无基线可判时不制造噪音）。提示行内不含花括号——
// status 的 JSON 块按「首个 { 到末个 }」截取（既有消费方 parseStatusJson 同形）。
async function printEvolveDueHint(state) {
  const lastEvolveAt = state && typeof state.last_evolve_at === 'string' ? state.last_evolve_at : '';
  if (!isValidTimestamp(lastEvolveAt)) return;
  const elapsedDays = daysSince(lastEvolveAt);
  if (Number.isNaN(elapsedDays)) return;
  const staleByAge = elapsedDays > EVOLVE_STALE_DAYS;
  const newArchives = await countSection9ArchivesSince(lastEvolveAt);
  const staleByCount = newArchives >= EVOLVE_DUE_NEW_ARCHIVE_CHANGES;
  if (!staleByAge && !staleByCount) return;
  const reasons = [];
  if (staleByAge) {
    reasons.push('距今 ' + Math.floor(elapsedDays) + ' 天，超阈值 ' + EVOLVE_STALE_DAYS + ' 天');
  }
  if (staleByCount) {
    reasons.push('其后新增 ' + newArchives + ' 个带 §9 的归档 change，达阈值 ' + EVOLVE_DUE_NEW_ARCHIVE_CHANGES + ' 个');
  }
  console.log('EVOLVE-DUE: 上次架构沉淀 ' + lastEvolveAt + '（' + reasons.join('；')
    + '）——建议显式调用 evolve（/flow-comet-evolve）同步 CONTEXT.md');
}

// C6: writeState 写入前校验已知字段类型（fail-closed：非法 → BLOCKED 拒绝写入，不修复不猜测）
// 未知字段允许（前向兼容）；缺字段允许（readState 默认补）；只校验存在字段的类型。
// 内置节点常量: 校验表已迁移到 state-schema.mjs（唯一来源），行为与迁移前的内联表完全一致（对第一个非法字段输出后退出）
async function writeState(state) {
  const bad = validateStateFields(state);
  if (bad.length) {
    console.error('BLOCKED: state 字段类型非法: ' + bad[0]);
    process.exit(1);
  }
  await writeJsonAtomic(statePath, state);
}

// .specs/ 下必须存在名字「逐字相等」的目录条目（change 名唯一性判据）。大小写不敏感文件系统
// （Windows / 默认 macOS）会把「CH」解析到 .specs/ch、「Archive」解析到归档区，但 activeChange
// 存的是变体字符串——轮次事件按 activeChange 精确匹配（配额被换键重置）、保留名检查按小写归一，
// 故 change 名必须等于真实目录名，大小写/空白变体一律拒绝（fail-closed）。
async function hasExactSpecsEntry(changeName) {
  let entries = [];
  try {
    entries = await fs.readdir(specsRoot);
  } catch {
    return false;
  }
  return entries.includes(changeName);
}

// 受控重入路径边界（单一 helper：change 名形态 + realpath 直接子目录 + symlink/junction 逃逸）。
// change 名必须是单段目录名（形态单一权威在 route-node.mjs，与综合判定同源）；目录必须真实存在、
// 非 symlink/junction、realpath 归一后仍在 .specs/ 内、且名字与真实目录条目逐字相等。物理包含性
// 判定复用 protocol-utils 的路径段扫描（单一权威，不写第二份路径判据）；任何越界 / 链接形态 /
// 名字变体一律 BLOCK（fail-closed）。
async function inspectReentryChangeDir(changeName) {
  if (typeof changeName !== 'string' || changeName.trim() === '') {
    return { ok: false, reason: 'no-active-change' };
  }
  if (!isSingleSegmentChangeName(changeName)) {
    return { ok: false, reason: 'change-name-invalid' };
  }
  const changeDir = path.join(specsRoot, changeName);
  let inspection;
  try {
    inspection = await inspectWorkflowPathSegments(specsRoot, changeDir, 'reenter change dir', 'directory');
  } catch (error) {
    return { ok: false, reason: 'change-dir-escape', detail: error && error.message ? error.message : String(error) };
  }
  if (!inspection.exists) return { ok: false, reason: 'change-dir-missing' };
  if (!(await hasExactSpecsEntry(changeName))) return { ok: false, reason: 'change-name-invalid' };
  return { ok: true, changeDir };
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
      console.log('COORDINATOR: 你是协调者，不是执行者。禁止在主会话直接修改源码；只能通过 Agent 工具 worktree isolation 委托子代理；子代理回传后仅更新 TASK.md / SUMMARY / handoff evidence。');
      console.log('EXECUTION-MODE: ' + (executionMode === 'direct' ? 'direct' : 'subagent'));
    }
  }
}

// ---------- bridge-check（只读 dsh 桥接健康检查 · 六判定态） ----------

// 版本戳锚点正则（契约定稿见 T02-SUMMARY「版本戳标记行格式契约」/ DESIGN §9.3）：
// 独立整行、行首无缩进、冒号后恰一个空格、行尾无其它字符。格式禁动（§9.5）。
const BRIDGE_VERSION_RE = /^\/\/ BRIDGE_VERSION: ([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/m;

// dev 态后缀归一（bridge-check 版本比较）：git describe 开发态形态为
// `<发布版本>-<领先提交数>-g<hash>`（例：`1.5.1-11-g93d96c0`，hash 十六进制、大小写不敏感）。
// 两侧仅在比较前剥这一种后缀、按基础版本比较——开发态载体与同基础版本的发布 loader 判健康；
// 语义化预发布标识（如 `1.5.0-rc.3`）不是 dev 态后缀、不得剥离（否则会把预发布放行成基础版本）。
// 归一仅用于比较，不改变读取到的原始值（失配报告需同时打印原始值与归一值）。
const BRIDGE_DEV_SUFFIX_RE = /-\d+-g[0-9a-f]+$/i;
function normalizeBridgeBaseVersion(version) {
  return String(version).replace(BRIDGE_DEV_SUFFIX_RE, '');
}

// $DSH_HOME 解析——与 prepare-env.mjs resolveDshHome 同语义（显式 DSH_HOME > ~/.dsh）。
// 安装器函数位于仓库根 scripts/，技能包脚本不能跨模块 import，语义复刻保持单点契约
// （套件断言保证双侧不漂移）。
function resolveDshHomeForBridgeCheck() {
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME);
  return path.join(os.homedir(), '.dsh');
}

// cordis.patch.yml 托管块标记——与 prepare-env.mjs MANAGED_CORDIS_START/END 同值复刻
// （技能包自包含；标记为安装器读-合并-写幂等替换边界，格式禁动）。
const MANAGED_CORDIS_START = '# --- flow-comet managed ---';
const MANAGED_CORDIS_END = '# --- end flow-comet managed ---';

// 判定态：健康 / 不适用 / 文件缺失 / 未挂载 / 版本偏斜 / 重复注册。
// 严格只读零写入零网络；失配（FAIL）exit 非 0；无法识别形态 → 近似性声明告警（WARN）
// 不定论不误杀（行扫描对无法识别形态的手写极端 YAML 只告警不定论，不误判为失配；
// 仅明确失配才强制非零退出）。
async function runBridgeCheck() {
  const report = { pass: [], warn: [], fail: [] };
  // ⑥ 非 dsh 项目 →「不适用」exit 0（AC-11）：会话项目根无 .dsh/skills/flow-comet
  // （未安装 dsh 平台副本）即不适用，其余检查全部跳过。
  if (!(await fileExists(path.join(runRoot, '.dsh', 'skills', 'flow-comet')))) {
    console.log('[NA] bridge-check: 不适用（本项目未安装 dsh 平台副本）——项目根无 .dsh/skills/flow-comet');
    console.log('bridge-check: 不适用（exit 0）');
    return;
  }

  const dshHome = resolveDshHomeForBridgeCheck();
  const loaderPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
  const patchPath = path.join(dshHome, 'cordis.patch.yml');
  const installedVersionPath = path.join(__dirname, '..', 'INSTALLED_VERSION');

  // ① loader 文件存在性（$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs）
  const loaderExists = await fileExists(loaderPath);
  if (loaderExists) {
    report.pass.push('loader 文件存在: ' + loaderPath);
  } else {
    report.fail.push('loader 文件缺失: ' + loaderPath);
  }

  // ② cordis.patch.yml 托管块存在性与 insert 形态（含 - insert: 与 name: 'file://…'；
  //    L-048：id-targeted patch 形态无 insert → 确认为错误形态失配）
  //    ＋ ③ 块内 file:// 目标可达
  let patchContent = null;
  try {
    patchContent = await fs.readFile(patchPath, 'utf8');
  } catch {
    patchContent = null;
  }
  if (patchContent === null) {
    report.fail.push(
      '未挂载: ' + patchPath + ' 不存在——' +
      (loaderExists ? 'loader 存在但未挂载（不会监听任何项目）' : '托管块无从指向 loader')
    );
  } else {
    const startIdx = patchContent.indexOf(MANAGED_CORDIS_START);
    const endIdx = patchContent.indexOf(MANAGED_CORDIS_END);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      report.fail.push(
        '未挂载: ' + patchPath + ' 中不存在托管块（' + MANAGED_CORDIS_START + ' … ' + MANAGED_CORDIS_END +
        '）——' + (loaderExists ? 'loader 存在但未挂载（不会监听任何项目）' : '')
      );
    } else {
      // 块内容 = 起始标记行尾之后、结束标记之前
      let blockStart = patchContent.indexOf('\n', startIdx);
      blockStart = blockStart === -1 ? endIdx : blockStart + 1;
      const block = patchContent.slice(blockStart, endIdx);
      const hasInsert = /^\s*- insert:\s*$/m.test(block);
      const fileUrlMatch = /name:\s*'file:\/\/([^']+)'/.exec(block);
      const hasIdLine = /^\s*- id:\s*dsh-flow-comet-bridge\s*$/m.test(block);

      if (hasInsert && fileUrlMatch) {
        report.pass.push('cordis.patch.yml 托管块: 存在且 insert 形态（含 - insert: 与 name: \'file://…\'）');
        // ③ file:// 目标可达性（捕获组含 file:// 后的整段——'file://' + 捕获即完整 URL；
        // fileURLToPath 按平台归一 Windows 盘符与 POSIX 根路径）
        let targetPath = null;
        try {
          targetPath = fileURLToPath('file://' + fileUrlMatch[1]);
        } catch (error) {
          targetPath = null;
        }
        if (targetPath === null) {
          report.warn.push('近似性声明: 托管块 file:// 引用无法解析为本地路径（' + fileUrlMatch[0] + '）——无法核验目标可达性，不定论');
        } else if (await fileExists(targetPath)) {
          if (targetPath === loaderPath) {
            report.pass.push('块内 file:// 目标可达且与期望 loader 路径一致: ' + targetPath);
          } else {
            report.fail.push('托管块 file:// 目标与期望 loader 路径不符: ' + targetPath + ' ≠ ' + loaderPath);
          }
        } else {
          report.fail.push('托管块指向的 loader 文件缺失: ' + targetPath + '（file:// 目标不可达）');
        }
      } else if (hasInsert && !fileUrlMatch) {
        // insert 形态在但无 name: 'file://…' 行——部分可识别、目标不可核验：
        // 近似性声明告警，不定论不误杀（不 forced 非零）
        report.warn.push('近似性声明: 托管块为 insert 形态但未识别到 name: \'file://…\' 行——无法核验 file:// 目标是否可达，不定论');
      } else if (hasIdLine && !hasInsert) {
        // L-048 确认形态：id-targeted patch（- id: ... 无 - insert:）——
        // dsh applyEntryPatches 对不存在的 id 报 entry not found 并跳过，loader 不会加载
        report.fail.push('托管块为 id-targeted patch 形态（含 - id: dsh-flow-comet-bridge 但无 - insert:）——确认为错误形态失配（dsh 不会加载该 loader）');
      } else {
        report.warn.push('近似性声明: 托管块内容无法识别为已知形态（未见 - insert: / - id: dsh-flow-comet-bridge / name: \'file://…\'）——不判失配，不定论');
      }
    }
  }

  // ④ 托管块外同 id 重复注册（AC-10b；块内安装器写入的固有条目不计）
  let outside = '';
  if (patchContent !== null) {
    if (patchContent.includes(MANAGED_CORDIS_START) && patchContent.includes(MANAGED_CORDIS_END)) {
      const sIdx = patchContent.indexOf(MANAGED_CORDIS_START);
      const eIdx = patchContent.indexOf(MANAGED_CORDIS_END);
      outside = patchContent.slice(0, sIdx) + patchContent.slice(eIdx + MANAGED_CORDIS_END.length);
    } else {
      outside = patchContent; // 无托管块：全文件视为块外
    }
  }
  const dupMatches = outside.match(/^\s*-\s+id:\s*['"]?dsh-flow-comet-bridge['"]?\s*$/gm) ?? [];
  if (dupMatches.length > 0) {
    report.fail.push('重复注册: cordis.patch.yml 托管块外另有 ' + dupMatches.length + ' 处同 id 注册行（dsh-flow-comet-bridge）——可能重复加载');
  } else {
    report.pass.push('重复注册检查: 托管块外无同 id（dsh-flow-comet-bridge）注册行');
  }

  // ⑤ loader BRIDGE_VERSION 戳 vs 项目 INSTALLED_VERSION 基础版本比较（两原始值都打印；
  //    比较前剥离 dev 态后缀——见 normalizeBridgeBaseVersion；
  //    契约锚点正则见 T02-SUMMARY「版本戳标记行格式契约」）
  let loaderStamp = null;
  let installedVersion = null;
  if (loaderExists) {
    try {
      const loaderText = await fs.readFile(loaderPath, 'utf8');
      const stampMatch = BRIDGE_VERSION_RE.exec(loaderText);
      if (stampMatch) {
        loaderStamp = stampMatch[1];
      } else {
        report.warn.push('近似性声明: loader 未提取到 BRIDGE_VERSION 戳（锚点正则 /^\\/\\/ BRIDGE_VERSION: ([0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?)$/m 无命中——非语义化版本标记或缺失）——无法比对版本，不定论');
      }
    } catch {
      report.warn.push('近似性声明: loader 文件读取失败——无法比对版本，不定论');
    }
  }
  try {
    installedVersion = (await fs.readFile(installedVersionPath, 'utf8')).trim();
  } catch {
    report.warn.push('近似性声明: 无法读取项目 INSTALLED_VERSION（' + installedVersionPath + '）——无法比对版本，不定论');
  }
  if (loaderStamp !== null && installedVersion !== null) {
    // 比较前两侧按基础版本归一（剥离 git describe dev 态后缀；预发布标识不剥）。
    // 原始值逐字相同 → 既有发布态严格一致报告保持不变；
    // 原始值不同但归一基础版本一致 → dev 态同基础，判健康（同时打印两原始值与基础版本）；
    // 归一后仍不同 → 版本偏斜：保留原「loader 原始戳 != 项目原始戳」配对（兼容既有报告读取），
    // 再补打印两侧归一基础版本，便于操作者识别 dev 态后缀。
    const loaderBase = normalizeBridgeBaseVersion(loaderStamp);
    const installedBase = normalizeBridgeBaseVersion(installedVersion);
    if (loaderBase === installedBase) {
      if (loaderStamp === installedVersion) {
        report.pass.push('版本一致性: loader BRIDGE_VERSION=' + loaderStamp + ' == 项目 INSTALLED_VERSION=' + installedVersion);
      } else {
        report.pass.push('版本一致性: loader BRIDGE_VERSION=' + loaderStamp + ' ~= 项目 INSTALLED_VERSION=' + installedVersion + '（dev 态后缀归一后基础版本 ' + loaderBase + ' 一致）');
      }
    } else {
      report.fail.push('版本偏斜: loader BRIDGE_VERSION=' + loaderStamp + ' != 项目 INSTALLED_VERSION=' + installedVersion + '（归一基础版本: loader=' + loaderBase + ' / installed=' + installedBase + '）——两值如上');
    }
  }

  // 逐项人读报告（AC-7~10：全过 exit 0 / 任一失配 exit 非 0）
  console.log('bridge-check: 只读检查（DSH_HOME=' + dshHome + ' · 项目根=' + runRoot + '）');
  for (const line of report.pass) console.log('[OK] ' + line);
  for (const line of report.warn) console.log('[WARN] ' + line);
  for (const line of report.fail) console.log('[FAIL] ' + line);
  if (report.fail.length > 0) {
    console.log('bridge-check: 失配 ' + report.fail.length + ' 项——exit 1');
    process.exitCode = 1;
  } else if (report.warn.length > 0) {
    console.log('bridge-check: 未发现明确失配，含 ' + report.warn.length + ' 项近似性声明告警（不定论，不误杀）——exit 0');
  } else {
    console.log('bridge-check: 健康（全部检查通过）——exit 0');
  }
}

// ---------- intel-scan 双落点一致性（init 的检测侧） ----------
// `last_intel_scan` 是**双落点**字段：引擎 state（机器真相、schema 校验）与 `.specs/CONTEXT.md` 的
// `## intel-scan 元数据` 段（项目可见）。段行的改写——含改写前备份与结构校验——只有 context-scan
// 一条通道一份实现；init 侧因此**不写段**（在第二处复制段行改写判据必然与前者分叉），只承担两条：
//   ① 形态对齐：state 侧取值一律经 time-utils 的 nowTimestamp()（本地时间 + 显式偏移），与
//      context-scan 写入的形态同源；历史 `Z` 形态继续可解析（不迁移）。
//   ② 漂移可见：写完后与段侧取值比对——不一致（含**同一时刻的两种形态**、段内取值不可解析）即
//      输出可见提示并点名收敛命令；一致则静默（不误报）。
const INTEL_SECTION_NAME = 'intel-scan 元数据';
const INTEL_FIELD_NAME = 'last_intel_scan';

// 段侧取值词元的归一：字段值可能写成 `` `2026-…` ``（markdown 引号）或裸值——引号不是形态差异，
// 归一后再比对（否则引号形态会让提示恒亮 = 噪声，把「提示」变成没人看的行）。
function normalizeIntelFieldValue(value) {
  return String(value).trim().replace(/^`+/, '').replace(/`+$/, '').trim();
}

// 漂移判定（纯函数）：两侧取值不一致时返回差异类别，一致（或任一侧缺席）返回 null（不误报）。
function intelScanDriftKind(stateValue, sectionValue) {
  if (typeof stateValue !== 'string' || typeof sectionValue !== 'string') return null;
  if (stateValue === sectionValue) return null;
  const atSection = parseTimestamp(sectionValue);
  if (Number.isNaN(atSection)) return '段内取值不是合法时间戳';
  const atState = parseTimestamp(stateValue);
  if (!Number.isNaN(atState) && atState === atSection) return '同刻不同形态';
  return '刻与形态均不一致';
}

// 双落点比对（读盘 + 输出）：段侧文档缺席 / 段或缺字段不在场 = 无可比对面 → 静默（不无中生有）；
// 检出漂移 → 可见提示（stdout，与 INIT-* 提示同族且不阻断 init），点名两侧取值与收敛命令。
async function reportIntelScanDrift(contextFile, stateValue) {
  let contextText;
  try {
    contextText = await fs.readFile(contextFile, 'utf8');
  } catch {
    return; // 段侧文档不可读 = 无可比对面
  }
  const fields = extractContextStructure(contextText).metadata[INTEL_SECTION_NAME];
  if (!fields || !fields[INTEL_FIELD_NAME]) return; // 段或缺字段不在场 = 无可比对面
  const landed = normalizeIntelFieldValue(fields[INTEL_FIELD_NAME].value);
  const kind = intelScanDriftKind(stateValue, landed);
  if (kind === null) return;
  console.log('INIT-NOTICE: ' + INTEL_FIELD_NAME + ' 双落点不一致（' + kind + '）——引擎 state = '
    + stateValue + '；`.specs/CONTEXT.md` 的 `## ' + INTEL_SECTION_NAME + '` 段 = ' + landed
    + '。本命令只写 state（该段行的写通道是 context-scan）；运行 context-scan 即把两处收敛为'
    + '同刻同形态（冲突时以 state 为准）。');
}

async function main() {
  // 协议解析: 协议加载 = resolveProtocol 解析路径 + 受保护读取 + fail-closed schema 校验
  // （读失败/校验失败直接 throw，沿用现有错误处理风格）
  const protocol = await readProtocolFile(runRoot, protocolPath);
  validateProtocolSchema(protocol);

  if (command === 'bridge-check') {
    // 只读 dsh 桥接健康检查：零写入零网络；
    // 不依赖协议/状态，直接执行后返回。
    await runBridgeCheck();
    return;
  }

  if (command === 'init') {
    const changeName = process.argv[3];
    if (!changeName) throw new Error('init requires a change name.');
    // trim 后校验:带前导/尾随空白的输入(如 " --help")不得绕过 flag 检测;
    // 纯空白与缺参同义
    const normalizedChangeName = changeName.trim();
    if (!normalizedChangeName) throw new Error('init requires a change name.');
    // 参数误用防护:以 -- 开头的参数(如 --help)是选项不是 change 名——报错并提示用法,
    // 防止被当作 change id 执行(自动开 change、建分支、写状态——有破坏性)
    if (normalizedChangeName.startsWith('--')) {
      throw new Error('init: ' + normalizedChangeName + ' looks like a flag, not a change name. Usage: workflow-state.mjs init <change-id> [--branch-prefix <prefix>] [--init-context|--init-skip]');
    }
    // --branch-prefix <prefix>（缺省 'change/'）；--init-context / --init-skip（自动初始化检测授权）
    let branchPrefix = 'change/';
    let initContext = false;
    let initSkip = false;
    const initArgs = process.argv.slice(4);
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
      }
    }
    // 自动初始化检测（前置步骤）：读旧 state（项目级字段跨 change 保留）→ 探测 → 判决 → 提示/执行
    // 生成职责：--init-context 时 CONTEXT 缺失 → 输出 INIT-GENERATE 指引，由 agent 全量阅读生成
    // （intel-scan 语义）；生成后重跑 → 脚本校验 7 段结构 → 通过写 last_intel_scan（确定性校验）。
    let prevState = null;
    try { prevState = await readState(); } catch { prevState = null; }
    const probe = await probeProject(runRoot, prevState);
    const verdict = classify(probe, prevState);
    let ctxValid = null; // null=未进入校验（非 init-context 或已新鲜）；true/false=校验结果
    if (initContext || initSkip) {
      // 显式授权路径：--init-context 生成协作（agent 生成 + 脚本校验）；--init-skip 记 none
      if (initContext) {
        // 显式 --init-context 总是校验结构（含 verdict=skip 新鲜/记忆场景）——防 CONTEXT 损坏漏检
        let ctxExists = false;
        try { await fs.access(path.join(runRoot, '.specs', 'CONTEXT.md')); ctxExists = true; } catch { /* 文件不存在 */ }
        if (ctxExists) {
          const { missingSections, formatIssues } = await validateContext(runRoot);
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
            await printGenerationGuide(runRoot, probe, { rewrite: true, problems });
          }
        } else if (verdict !== 'skip') {
          await printGenerationGuide(runRoot, probe);
        }
        // verdict=skip（记忆 A 拒绝 / 新鲜 B）且 CONTEXT 缺失 → 尊重既有决策，不输出
      }
      if (initSkip && !initContext) {
        console.log('INIT-SKIPPED: 已记录跳过初始化。');
      }
    } else {
      await printDetection(runRoot, probe, verdict);
    }
    // F（2026-08-10）：init 同 id 重跑防护——.specs/<id>/ 已存在或 activeChange 相同 → WARN 不阻断
    //（向后兼容；正常流程 init 只在 open 前执行一次，防护针对误操作清空进度）
    let specsDirExists = false;
    try { await fs.access(path.join(specsRoot, changeName)); specsDirExists = true; } catch { /* 目录不存在 */ }
    if (prevState?.activeChange === changeName || specsDirExists) {
      console.error('WARN: change ' + changeName + ' 已存在——重跑 init 将重置节点状态（completedNodes/evidence 清空）。若需继续已有 change，请用 advance/select 而非重跑 init。');
    }
    // E1: branchMode 自动判定——git 仓库（cwd=runRoot）→ true；非 git 仓库 → false
    const branchMode = isInsideWorkTree();
    const state = {
      activeChange: changeName,
      // 协议来源绑定：init 解析出的协议路径持久化（项目根相对 POSIX；旧 state 缺字段 = 未绑定，
      // 归属/节点门禁按渐进语义回退环境变量/默认协议）
      protocolPath: toPersistedProtocolPath(runRoot, protocolPath),
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
      // R6: 新 change 标记——init 即新 change(严格模式开启,不依赖 entry;旧 change 无此字段渐进兼容)
      newChange: true,
      // M1: 进入证据容器——entry 追加节点;R2 检测未 entry(新 change 强制)
      enteredNodes: [],
      createdAt: new Date().toISOString(),
      // 项目级上下文字段跨 change 保留（迁移旧 state；--init-context 刷新扫描时间；--init-skip 记拒绝）
      ...(prevState?.ai_context_doc !== undefined ? { ai_context_doc: prevState.ai_context_doc } : {}),
      ...(initSkip ? { ai_context_doc: 'none' } : {}),
      // last_intel_scan 仅在校验通过后写入（agent 生成 → 脚本校验 7 段 → 记录扫描时间）；形态一律经
      // time-utils 的 nowTimestamp()（本地时间 + 显式偏移）——与 context-scan 的落点形态同源，不在本
      // 脚本内联第二份格式化。段侧**不在本命令的写面内**（该段行的改写与备份只有 context-scan 一份
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
    await reportIntelScanDrift(path.join(specsRoot, 'CONTEXT.md'), state.last_intel_scan);
    // init 创建 .specs/<id>/ 目录——文件即真相从 init 起成立，findActiveChange 立即可识别
    //（此前 init 后 next/status 报 No active change，与 SKILL 启动协议 init → next 矛盾）
    const specsChangeDir = path.join(specsRoot, changeName);
    await fs.mkdir(specsChangeDir, { recursive: true });
    // E1 + : 分支创建——branchMode && 当前分支 ≠ <prefix><id> && 分支不存在 → git checkout -b
    // 前缀由 --branch-prefix 指定（缺省 'change/'，向后兼容；可适配仓库自身分支规范如 feat/）
    // 失败 → WARN 不 BLOCK，继续纯文件模式（向后兼容）
    const expectedBranch = branchPrefix + changeName;
    // 空仓库状态(带到 BRANCH 输出——声称与实际一致:空仓库无分支)
    let emptyRepo = false;
    if (branchMode) {
      const currentBranch = gitBranchName();
      // M8: 空仓库检测——无提交(git rev-parse HEAD 失败)时分支创建不可行,输出提示
      // (不 BLOCK;纯文件模式继续)并跳过分支创建——警告与行为一致(修复前 BRANCH 行
      // 仍声称分支已创建,与实际矛盾)
      try {
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runRoot, stdio: 'pipe' });
      } catch {
        emptyRepo = true;
      }
      if (emptyRepo) {
        console.error('INIT EMPTY-REPO WARN: 仓库无提交(git 空仓库),无法创建 ' + expectedBranch + ' 分支——先 git commit 初始提交再 init 启用分支模式,或继续纯文件模式');
      } else if (currentBranch !== null && currentBranch !== expectedBranch && !branchExists(expectedBranch)) {
        try {
          execFileSync('git', ['checkout', '-b', expectedBranch], { cwd: runRoot, stdio: 'pipe' });
        } catch {
          console.error('WARN: 创建分支 ' + expectedBranch + ' 失败——继续纯文件模式（分支功能降级；可稍后手动 git checkout -b ' + expectedBranch + '）');
        }
      }
    }
    console.log('Initialized: ' + changeName);
    console.log('BRANCH: ' + (branchMode && !emptyRepo ? expectedBranch : 'none（非 git 仓库或空仓库）'));
    // init 输出取协议首节点（与  的 state.currentNode 一致——内置协议 = open，行为不变）
    printNext(protocol, route(protocol)[0]?.id ?? 'open');
    return;
  }

  if (command === 'status') {
    const changeName = await findActiveChange();
    if (!changeName) {
      console.log(JSON.stringify({ status: 'no-change', message: 'No active change in .specs/' }, null, 2));
      // 到期提示属**项目级**元数据（与是否有 active change 无关）：无活跃 change 时同样按阈值输出
      await printEvolveDueHint(await readState());
      return;
    }
    const state = await readState();
    const detectedNode = await determineNode(changeName, protocol, state.completedNodes);
    // 派生视图（ADR-013 决策 11；2026-09-28 PR 审查采纳改为事件为准）：被强制推进的节点以
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
      completedNodes: state.completedNodes,
      forcedNodes,
      executionMode: state.executionMode ?? 'subagent',
      directOverride: state.directOverride ?? false,
      branchMode: isInsideWorkTree(),
      enablePrReview: state.enablePrReview ?? false,
      artifactRoot: '.specs/' + changeName,
      coordinatorMode: EXECUTE_FAMILY_NODE_IDS.has(detectedNode),
      // G14: 新旧 change 标记——newChange true = 新 change(严格模式);false/缺失 = 旧 change(渐进)
      newChange: state.newChange === true
    }, null, 2));
    printBranchLine(changeName, state.branchPrefix ?? 'change/');
    await printEvolveDueHint(state);
    return;
  }

  if (command === 'next') {
    const changeName = await findActiveChange();
    if (!changeName) {
      console.log('NEXT: done');
      console.log('MESSAGE: No active change. Run: node workflow-state.mjs init <change-name>');
      return;
    }
    const state = await readState();
    const completedArr = Array.isArray(state.completedNodes) ? state.completedNodes : [];
    // Fix 回退显式分支——必须早于「疑似未 exit」门禁与进行中漂移保护：
    // review/verify 驻留 + TASK 有 pending 修复任务（串行/并行）或未闭合家族出口签名时，把工作
    // 归属受控归位共享谓词返回的 execute 家族目标（写盘）并显式输出 NODE: <目标>，不再依赖
    // inProgress 保护副作用（修复前并行任务 next 输出仍停在源节点）。判定复用 route-node 共享纯函数。
    const fixRollbackDecision = await resolveFixRollbackDecision({
      runRoot, changeName, protocol, completedNodes: completedArr, currentNode: state.currentNode,
      history: state.history,
    });
    if (fixRollbackDecision) {
      const sourceNode = state.currentNode;
      // 轮次计数与阈值/授权判定全部走共享 helper：分支②不计数；第 4 轮新 change 先 BLOCK
      // （此处尚未写盘，满足不写 currentNode），旧 change WARN 后照常归位。
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
      printBranchLine(changeName, state.branchPrefix ?? 'change/');
      return;
    }
    // Fix 回程豁免——exit execute --apply 二次完成把 currentNode 回推源节点后，
    // 源节点产物（REVIEW.md / TEST.md+UAT.md）已在场会让 resolveNextNode 跳过尚未 exit 的
    // 源节点；仅当源节点未完成、任务全 done、firstIncompletePostExecNode === currentNode
    // 且 resolveNextNode 确实会跳过该节点时显式放行（只读不改写 state）。artifactNext ===
    // currentNode 的形态落回既有正常逻辑（normalAdvanceExempt 覆盖），不放宽豁免面。
    const fixReturnNode = state.activeChange
      ? await resolveFixReturnNode({ runRoot, changeName, protocol, completedNodes: completedArr })
      : null;
    if (fixReturnNode !== null && fixReturnNode === state.currentNode) {
      const artifactNext = await resolveNextNode({ runRoot, changeName, protocol, completedNodes: completedArr });
      const routeIds = route(protocol).map((node) => node.id);
      const artifactNextIdx = routeIds.indexOf(artifactNext);
      const currentIdx = routeIds.indexOf(state.currentNode);
      // 「跳过」必须是产物存在性把路由推到源节点之后；artifactNext 落在源节点之前（如 execute
      // 产物缺失时回退到 execute）不是合法回程态，落回既有门禁，防止越界放宽（既有门禁反例锚）。
      const skipsForward = artifactNext !== state.currentNode
        && currentIdx >= 0
        && artifactNextIdx > currentIdx;
      if (skipsForward) {
        console.log('RETURN: 回程源节点 ' + fixReturnNode + '（源节点产物在场且未出口；保留源节点跑出口）');
        printNext(protocol, state.currentNode, state.executionMode ?? 'subagent');
        printBranchLine(changeName, state.branchPrefix ?? 'change/');
        return;
      }
    }
    // 节点顺序校验（严格模式）——state.currentNode 非 null、不在 completedNodes、
    // 且 evidence 无该节点记录 → 上一节点从未 exit 就推进 → BLOCKED（exit 1）。
    // 状态漂移校正保留：已完成节点（currentNode ∈ completedNodes，或 evidence 已记录——
    // 节点已被 record/exit 处理过）正常推进不受影响；本校验只拦"证据完全缺失的疑似跳阶段"。
    // 豁免（两种独立判断，任一成立即放行）： 回退豁免（TASK.md 有 pending 回退修复任务 回 execute）；
    //  正常推进豁免（currentNode 是 completedNodes 最后节点 exit 推进的正常下一节点，
    // 见 normalAdvanceExempt）——真乱序（跳节点）仍严格 BLOCK
    if (state.currentNode && !completedArr.includes(state.currentNode)) {
      const nodeEvidence = state.evidence && typeof state.evidence === 'object'
        ? state.evidence[state.currentNode]
        : null;
      const hasEvidence = !!(nodeEvidence && typeof nodeEvidence === 'object' && !Array.isArray(nodeEvidence));
      if (!hasEvidence) {
        // 回退豁免（显式分支已先行；此处按共享谓词保留门禁层语义，不再内联第二份判定）——
        // review/verify 发现缺陷追加 pending 修复任务后回 execute 的修复任务标准回退路径放行
        // （否则被严格模式误拦为"未 exit 跳阶段"）；豁免条件不满足时维持严格 BLOCK
        const rollbackExempt = await resolveFixRollbackState({
          runRoot, changeName, protocol, completedNodes: completedArr, currentNode: state.currentNode,
          history: state.history,
        });
        // 正常推进豁免——exit --apply 推进 currentNode 到下一节点后按 SKILL 协议调 next
        // （正常路径）不拦截；与  回退豁免独立判断（详见 normalAdvanceExempt 注释）
        const advanceExempt = await normalAdvanceExempt(state, protocol, completedArr, state.currentNode, changeName);
        if (!rollbackExempt && !advanceExempt) {
          console.error('BLOCKED: 疑似未 exit 节点 ' + state.currentNode + '，先 workflow-guard.mjs exit ' + state.currentNode + ' --apply');
          console.error('恢复: 确认当前节点实际已完成 → 用 exit <节点> --apply 正常推进；节点状态漂移/卡死 → 用 workflow-state.mjs advance（强制推进）或 select（切换 change）；禁止手改 state 机器字段');
          process.exit(1);
        }
      }
    }
    const detectedNode = await determineNode(changeName, protocol, state.completedNodes);
    // 单趟零进展防呆（三重防呆决策之二·状态机侧）：路由落在 execute/subagent-execute，但既无可委托的并行任务
    // （依赖已满足集合为空）又无串行 pending，且 TASK 未全 done——剩余 pending 全部是依赖无法满足的
    // 孤儿并行任务（数据异常：depends_on 引用不存在的任务 id 或执行期出现依赖环）→ BLOCKED，
    // 防止静默路由到无法推进的节点造成死循环/死等。协议无 subagent-execute 节点时不适用
    // （parallel 任务由 execute 直接消化，无孤儿语义）。依赖环的常规拦截点在 plan 出口（guard 前置），
    // 此处兜底执行期数据异常（如手改 TASK 绕过签名校验的极端态）。
    if (EXECUTE_FAMILY_NODE_IDS.has(detectedNode)) {
      if (hasSubagentNode(protocol)) {
        try {
          const zpBlocks = taskBlocks(await fs.readFile(protocolTaskFilePath(protocol, changeName, specsRoot), 'utf8'));
          const zpAttrs = zpBlocks.map(taskOpeningAttrs).filter(Boolean);
          const zpPending = zpAttrs.filter((a) => a.status === 'pending');
          if (zpPending.length > 0) {
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
              console.error('BLOCKED: 路由零进展——既无可委托的并行任务（依赖已满足集合为空）也无串行 pending，但 TASK 尚有 ' + zpPending.length + ' 个未完成任务');
              console.error('疑似孤儿并行任务依赖无法满足（检查 depends_on）：' + zpPending.map((a) => a.id).join(', ') + '——修正 depends_on 为真实存在且无环的任务 id 后重试；执行期出现此异常请核对 TASK.md 是否被手改');
              process.exit(1);
            }
          }
        } catch {}
      }
    }
    // 状态漂移自动校正——以文件产物为准（determineNode）校正 state.currentNode。
    // 进行中节点保护:currentNode 未 exit(不在 completedNodes)且已记录 evidence(record 过)
    // → 视为节点进行中(可能 exit 被内容级拦截后重跑),不校正推走——否则被拦截节点
    // 的 exit 前置校验(currentNode 匹配)无法重跑,advance/select 均不恢复 → 死结(实测教训)
    const currentNodeEvidence = state.currentNode && state.evidence && typeof state.evidence === 'object'
      ? state.evidence[state.currentNode]
      : null;
    // 进行中节点保护扩展：保护从"已 record"扩展为"已 entry（enteredNodes 含该节点）且未 exit"。
    // 已 entry 但未 record 的节点（如刚进入、产物已齐、premature next）同样视为进行中——
    // 不校正推走（否则该节点 exit 前置 currentNode 校验无法重跑 → 死结）。旧 state 无
    // enteredNodes 时回退到 evidence 判定（既有语义不回归）。
    const currentNodeEntered = !!(
      state.enteredNodes && Array.isArray(state.enteredNodes) && state.enteredNodes.includes(state.currentNode)
    );
    const routeIds = route(protocol).map((n) => n.id);
    const currentNodeIdx = state.currentNode ? routeIds.indexOf(state.currentNode) : -1;
    // 推导为 currentNode 的**路由后继**（与 guard 出口同源：把 currentNode 视为已完成再加入
    // completedNodes 求 resolveNextNode）→ 该节点产物已齐待 exit、路由自然推进到 detectedNode
    // （平行转换 plan→subagent-execute、趟间回流 subagent-execute→execute 均属此形态）→ 保护。
    // 反过度修复锚（同族：产物全齐但无推进史形态）：completedNodes 为空（无任何 exit 推进史，currentNode 仅是初始
    // 陈旧节点）时不做路由后继保护——产物推导继续生效推进到最终节点（自定义协议产物全齐的
    // 「部分完成但产物齐」形态仍路由到最后节点）。静态直接后继兜底（串行推进原语义）。
    // 推导跳跃/跨节点或回退 → 产物权威校正(漂移,防过度修复)。
    const routingSuccessorOfCurrent = state.currentNode
      ? await determineNode(changeName, protocol, [...completedArr, state.currentNode])
      : null;
    const routingSuccessorProtects = !!(completedArr.length > 0
      && routingSuccessorOfCurrent !== null
      && routingSuccessorOfCurrent === detectedNode);
    const derivedIsDirectSuccessor = currentNodeIdx >= 0
      && currentNodeIdx + 1 < routeIds.length
      && routeIds[currentNodeIdx + 1] === detectedNode;
    const derivedIsSuccessor = routingSuccessorProtects || derivedIsDirectSuccessor;
    const inProgress = !!(
      state.currentNode
      && !completedArr.includes(state.currentNode)
      && (currentNodeEntered
        || (currentNodeEvidence && typeof currentNodeEvidence === 'object' && !Array.isArray(currentNodeEvidence)))
      && derivedIsSuccessor
    );
    if (!inProgress && state.currentNode !== detectedNode) {
      state.currentNode = detectedNode;
      await writeState(state);
    }
    // 进行中节点保护:不校正时输出也跟随 currentNode(而非产物推导的 detectedNode——
    // 否则 state 保持 review 但输出 NODE: verify,执行者按输出 action 仍然死结)
    const printNode = inProgress ? state.currentNode : detectedNode;
    printNext(protocol, printNode, state.executionMode ?? 'subagent');
    printBranchLine(changeName, state.branchPrefix ?? 'change/');
    return;
  }

  if (command === 'select') {
    const changeName = process.argv[3];
    if (!changeName) throw new Error('select requires a change name.');
    // change 名必须是 .specs/ 下的单段目录名（形态单一权威在 route-node.mjs）：拒绝路径分隔符、
    // . / .. 与保留目录 archive（归档区不是活跃 change）——多段路径会把归档目录等非 change
    // 目录选成 activeChange，进而污染后续命令的 change 归属与轮次派生。
    if (!isSingleSegmentChangeName(changeName)) {
      throw new Error('select change 名必须是 .specs/ 下的单段目录名（拒绝路径分隔符、. / .. 与保留目录 archive）: '
        + JSON.stringify(changeName));
    }
    const changeDir = path.join(specsRoot, changeName);
    // 目录必须真实存在且不是 symlink/junction、realpath 归一后仍在 .specs/ 内（复用路径段扫描
    // 单一权威）；越界 / 链接形态一律拒绝，不把非真实目录选为 activeChange。
    let inspection;
    try {
      inspection = await inspectWorkflowPathSegments(specsRoot, changeDir, 'select change dir', 'directory');
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

  if (command === 'skill-load') {
    // 协议解析: 执行者加载节点 skill 后运行 skill-load <node> <skill> [--prompt <path>]，
    // 写入声明标记 .specs/<change-id>/.skill-loads/<node>-<skill>.json（{ node, skill, protocol, at }），
    // record 校验 completedChecks 的 required-skill 条目以此为准（内置节点常量）。
    // 诚实边界：标记是"声明"而非物理证明——运行时没有 Skill 调用观察点，脚本无法确认执行者
    // 真实加载过该 skill；标记仅记录"执行者主动声明已加载"，由流程纪律兜底。
    const nodeId = process.argv[3];
    const skillName = process.argv[4];
    if (!nodeId || !skillName) {
      throw new Error('skill-load requires <node> <skill>. 用法: workflow-state.mjs skill-load <node> <skill> [--prompt <path>]');
    }
    // 参数校验：node 为当前协议节点集合之一（动态读取协议 nodes[].id——内置 +
    // 自定义，compose 自定义协议节点可声明）；协议外节点名依然非法（fail-closed）。
    // BUILTIN_NODES 仅作内置常量保留（其他用途参照），skill-load 校验不再依赖它。
    const protocolNodeIds = (protocol.nodes ?? []).map((n) => n.id);
    if (!protocolNodeIds.includes(nodeId)) {
      throw new Error('skill-load node 非法: ' + nodeId + '（协议节点: ' + protocolNodeIds.join('/') + '）');
    }
    if (!/^[A-Za-z0-9-]+$/.test(skillName)) {
      throw new Error('skill-load skill 名非法（仅允许字母数字连字符）: ' + skillName);
    }
    // --prompt 归属校验：路径必须位于 flow-kit/prompts/ 下（相对或绝对，前缀校验；
    // flow-kit 为 vendored 上游，协议提示只读引用）。协议加载本身由 resolveProtocol 全局
    // 处理（含受保护读取）——--protocol 语义不变（工作流协议 JSON）；此处仅校验用户显式传入的
    // --prompt 原始值（skill-load 专属参数，不再与全局协议解析共用 --protocol）。
    const promptArg = findPromptArg(process.argv.slice(3));
    if (promptArg !== null && !protocolUnderFlowKitPrompts(promptArg)) {
      throw new Error('skill-load --prompt 路径必须位于 flow-kit/prompts/ 下（flow-kit 为 vendored 上游，协议提示只读引用）: ' + promptArg);
    }
    // 声明标记写入：.skill-loads/ 目录不存在时创建（writeJsonAtomic 自带 mkdir recursive）；
    // 同 node-skill 重复调用覆盖（记录最新声明）
    const changeName = await findActiveChange();
    if (!changeName) {
      // 归档后场景:change 目录已移入 .specs/archive/(无活跃 change)——skill-load 不可用,
      // 但 record 的声明自动化(M5)仍可写归档路径标记——消息如实引导（真实运行实证反馈）
      throw new Error('skill-load requires an active change（先运行 init <change-id>;若该 change 已归档,声明标记由 record 自动补写——M5 会写入归档路径的 .skill-loads/）');
    }
    // 标记 protocol 字段 = --prompt 参数的 basename（如 0-change.md）——与 guard exit
    // 校验的 节点协议映射 表 basename 精确比对同值（真实链路 skill-load → exit 一致）；未传 --prompt →
    // null（无协议声明，exit 校验 fail-closed）。修复前旧实现写 resolveProtocol 解析后的完整
    // 绝对路径，与 节点协议映射 表 basename 比对必然失败（真实链路必 BLOCKED——机制实际不可用）。
    const marker = { node: nodeId, skill: skillName, protocol: promptArg === null ? null : path.basename(promptArg), at: new Date().toISOString() };
    // specsRoot 已含 .specs/，相对路径为 <change-id>/.skill-loads/<node>-<skill>.json
    const markerRel = path.posix.join(changeName, '.skill-loads', nodeId + '-' + skillName + '.json');
    await writeJsonAtomic(path.join(specsRoot, markerRel), marker);
    console.log('SKILL-LOAD: ' + nodeId + ' ' + skillName + ' → .skill-loads/' + nodeId + '-' + skillName + '.json');
    return;
  }

  if (command === 'record') {
    const nodeId = process.argv[3];
    if (!nodeId) throw new Error('record requires a Node id.');
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
    const recordArgs = process.argv.slice(4);
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
    try {
      parsed = raw ? JSON.parse(raw) : {};
      if (typeof parsed !== 'object' || Array.isArray(parsed)) parsed = { summary: String(parsed) };
    } catch {
      // 契约解析失败 fail-closed:payload 形似对象但 JSON.parse 失败 → 报错并
      // process.exit(1),不写 evidence——防状态污染（旧语义把不可解析 raw 静默作
      // summary 字符串落库 = 静默落脏）
      // 消息按参数来源分级（设计语义 / AC-3）:--json-file 传入且文件内容损坏 →
      // "文件内容不是合法 JSON" + 长度元数据;内联传参损坏 → 保留 --json-file 建议。
      // 安全(bot 审查):错误消息只含固定前缀 + 长度元数据,绝不打印 raw 内容(含截断)。
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
    // completedChecks 真实性校验（skill-load 声明标记）——解析本次 record 写入的
    // completedChecks 的 required-skill:<node>.<skill> 条目 → 对应声明标记必须存在（内置节点常量，
    // 缺失 → BLOCKED + 指引先加载 skill 并运行 skill-load）；标记 at 必须 ≤ 本次记录时间
    // （交叉自洽：标记先于记录声明）。仅校验本次写入的 payload，旧 evidence 不追溯（旧 change 兼容）。
    const recordedAt = new Date().toISOString();
    // 标记归属 change 与 evidence 一致：优先 state.activeChange，缺失时回退 findActiveChange（与
    // 下方 NEXT 推导同语义）；两者皆无 → verifySkillLoadMarkers 内 fail-closed BLOCK。
    // 传入 protocol + state——按 requiredSkillCalls scope 分类条目（handoff scope 豁免标记，
    // 以共用证据库 handoffResult 为证据）
    const markerChange = state.activeChange || await findActiveChange();
    const markerCheck = await verifySkillLoadMarkers(parsed.completedChecks, markerChange, recordedAt, protocol, state);
    if (!markerCheck.ok) {
      console.error('BLOCKED: ' + markerCheck.reason);
      process.exit(1);
    }
    // 技能加载前置门（方案 A）：节点完成记录必须先有本节点
    // skill-load 声明标记——无论 payload 是否含 completedChecks 都校验（堵"先干活后补
    // 声明"旁路）：缺失 → 新 change BLOCK / 旧 change 渐进 WARN。指引先加载技能并运行
    // skill-load 再重试。handoff scope 技能（子代理加载）不要求协调者声明（与
    // verifySkillLoadMarkers 的 scope 豁免一致）——本门按 <node>-*.json 存在性判定，
    // 与 guard exit 侧协议声明标记校验同构。仅对存在于当前协议的节点生效（协议外节点名
    // 的记录不适用前置门），无 active change 时无法定位标记而不重复报错（遗留兼容）。
    const recordNodeDef = (protocol.nodes ?? []).find((n) => n.id === nodeId);
    if (recordNodeDef && markerChange) {
      const declaredForNode = await hasNodeSkillDeclaration(nodeId, markerChange);
      if (!declaredForNode) {
        const loadGuide = '先加载技能（用 Skill 工具，禁止跳过）并运行 workflow-state.mjs skill-load ' + nodeId + ' <skill> 再重试';
        if (state.newChange === true) {
          console.error('BLOCKED: 节点 ' + nodeId + ' 缺少技能加载声明标记（.skill-loads/' + nodeId + '-*.json）——' + loadGuide);
          process.exit(1);
        }
        console.error('WARN: 节点 ' + nodeId + ' 缺少技能加载声明标记（.skill-loads/' + nodeId + '-*.json）——' + loadGuide + '（旧 change 渐进不阻断，记录继续）');
      }
    }
    // M5: 声明自动化——record 时按协议 requiredSkillCalls 自动补写缺失的声明标记
    // (执行者无需手动 skill-load;标记如实记录"节点完成即视为其实现/协议技能已加载",
    // 由 record 代记;与手动 skill-load 标记同体系,exit 协议声明校验共用)
    // 新 change 下 required 条目停用自动补写(手动声明唯一路径,否则抵消前置门);
    // 旧 change 保留 M5 兜底(渐进兼容)。
    if (recordNodeDef && markerChange && state.newChange !== true) {
      const recordProtoFiles = NODE_PROTOCOL_FILES[nodeId] ?? [];
      // M5 标记目录解析:活动路径优先;change 已归档(活动目录不存在但归档目录存在)
      // 时写归档路径——防重建已归档的活动目录(归档移动语义;与 findSkillLoadsDir 双路径一致)。
      // 跳过条件:活动与归档均无 .skill-loads **且活动 change 目录已不存在**(归档移动后)
      // ——此时 writeJsonAtomic 的 mkdir recursive 会把已归档的活动目录残留回来(修复前实测缺陷);
      // 活动 change 目录仍存在(正常流程)时创建 .skill-loads 子目录是 M5 的正常职责,不跳过
      const activeLoadsDir = path.join(specsRoot, markerChange, '.skill-loads');
      let targetLoadsDir = activeLoadsDir;
      if (!(await fileExists(activeLoadsDir))) {
        const archived = await findSkillLoadsDir(markerChange);
        if (archived !== null && archived.dir !== activeLoadsDir) {
          targetLoadsDir = archived.dir;
        } else if (archived === null && !(await fileExists(path.join(runRoot, '.specs', markerChange)))) {
          targetLoadsDir = null;
        }
      }
      if (targetLoadsDir !== null) {
        for (const binding of recordNodeDef.requiredSkillCalls ?? []) {
          // handoff scope 技能由子代理加载(协调者不声明)——不自动补协调者标记
          // (2026-08-16 修复:此前无条件写标记,与 verifySkillLoadMarkers 的 scope 豁免不一致)
          if (binding.scope === 'handoff') continue;
          const markerFile = path.join(targetLoadsDir, nodeId + '-' + binding.skill + '.json');
          let markerExists = false;
          try { await fs.access(markerFile); markerExists = true; } catch { /* 标记不存在 */ }
          if (!markerExists) {
            // 自动补的 protocol 字段按 skill 归属协议文件(如 open 的 requirement 标记应写
            // 1-requirement.md 而非节点首文件 0-change.md——修复前所有 skill 都写首文件,
            // 标记的协议归属语义错误;exit 校验只查归属集合故能通过,但标记不可信)
            const skillProtoFiles = SKILL_PROTOCOL_FILES[binding.skill] ?? [];
            await writeJsonAtomic(markerFile, {
              node: nodeId,
              skill: binding.skill,
              protocol: skillProtoFiles.length > 0 ? skillProtoFiles[0] : null,
              at: recordedAt,
              auto: true,
            });
          }
        }
      }
    }
    state.evidence[nodeId] = {
      ...(state.evidence[nodeId] || {}),
      ...parsed,
      recordedAt,
    };
    await writeState(state);
    console.log('EVIDENCE: ' + nodeId);
    const changeName = state.activeChange || await findActiveChange();
    const nextNode = changeName ? await determineNode(changeName, protocol, state.completedNodes) : null;
    printNext(protocol, nextNode ?? null, state.executionMode ?? 'subagent');
    return;
  }

  if (command === 'config') {
    // E1: 配置命令——config set <key> <value>；branchMode 只读（init 自动判定），enablePrReview 手动
    // 开关，last_evolve_at 为 evolve 元数据时刻（形态校验 fail-closed，写通道唯一）
    const sub = process.argv[3];
    const key = process.argv[4];
    const value = process.argv[5];
    if (sub !== 'set') throw new Error('config 仅支持 set 子命令。用法: workflow-state.mjs config set <key> <value>');
    if (!key || value === undefined) throw new Error('config set 需要 key 和 value。用法: workflow-state.mjs config set <key> <value>');
    if (key === 'branchMode') {
      console.error('BLOCKED: branchMode 由 init 自动判定，不可手动设置');
      process.exit(1);
    }
    if (key === 'enablePrReview') {
      if (value !== 'true' && value !== 'false') {
        console.error('BLOCKED: config set 值非法（enablePrReview 必须为 true 或 false）: ' + value);
        process.exit(1);
      }
      const state = await readState();
      state.enablePrReview = value === 'true';
      await writeState(state);
      console.log('CONFIG: enablePrReview = ' + state.enablePrReview);
      return;
    }
    // evolve 元数据时间戳（脚本不直写 state，项目级字段一律经本通道）。形态非法 → BLOCK
    // 且**零改写**（校验先于读 state 与写盘；writeState 侧的字段校验表是第二道闸，同一判据）。
    if (key === 'last_evolve_at') {
      if (!isValidTimestamp(value)) {
        console.error('BLOCKED: config set 值非法（last_evolve_at 必须为本地时间 + 显式偏移形态 '
          + 'YYYY-MM-DDTHH:mm:ss±HH:mm，兼容历史 Z 形态）: ' + value);
        process.exit(1);
      }
      const state = await readState();
      state.last_evolve_at = value;
      await writeState(state);
      console.log('CONFIG: last_evolve_at = ' + state.last_evolve_at);
      return;
    }
    console.error('BLOCKED: 未知配置键: ' + key + '（支持: enablePrReview, last_evolve_at；branchMode 由 init 自动判定）');
    process.exit(1);
  }

  if (command === 'execution-mode') {
    const mode = process.argv[3];
    if (mode !== 'subagent' && mode !== 'direct') {
      console.error('BLOCKED: execution-mode 参数必须为 subagent 或 direct，收到: ' + String(mode));
      process.exit(1);
    }
    const state = await readState();
    state.executionMode = mode;
    // direct 是逃生口：必须用户显式调用，并记录 directOverride；切回 subagent 时清除
    // （directOverride 恒等于"当前是否处于用户确认的 direct"——再次切 direct 必须重新确认，无历史歧义）
    state.directOverride = mode === 'direct';
    if (mode === 'direct') {
      // 授权审计留痕：direct 是用户决策点不可自决——协调者显式调用本命令即授权事件，写入授权
      // 审计字段（guard 出口校验须存在授权记录；执行者绕过脚本手改 state 字段无授权记录 → BLOCK）。
      console.error('DIRECT-AUTH: direct=逃生口须用户显式授权——本命令即授权留痕（directOverrideAt 写入）');
      state.directOverrideAt = new Date().toISOString();
      state.directOverrideSource = 'execution-mode';
    } else {
      // 切回 subagent 清除授权留痕（directOverride 一并清除——既有语义保持）
      delete state.directOverrideAt;
      delete state.directOverrideSource;
    }
    await writeState(state);
    console.log('EXECUTION-MODE: ' + state.executionMode + (state.directOverride ? ' (directOverride)' : ''));
    return;
  }

  if (command === 'verify-fail') {
    const state = await readState();
    // W2-A: 机器计数——连续 3 次失败后（第 4 次）BLOCKED，要求用户决策（继续修 / 停止）
    // 计数按当前 change 存储(verifyFailuresByChange)——切换 change 后计数独立,互不串扰;
    // 旧顶层字段首次读取时迁移并入当前 change(旧 state 兼容)
    const count = verifyFailuresFor(state);
    if (count >= 3) {
      console.error('verify 失败超限，需用户决策（verifyFailures=' + count + '）。继续修 / 停止？');
      process.exit(1);
    }
    setVerifyFailuresFor(state, count + 1);
    await writeState(state);
    console.log('VERIFY-FAIL: ' + (count + 1) + '/3');
    return;
  }

  if (command === 'advance') {
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

  if (command === 'reenter') {
    // 受控重入（archive 源回边）：archive 已 entry 且归档移动尚未发生时，用户显式授权把工作归属
    // 退回执行家族 / review / verify 之一。命令形态：reenter <target> --authorized-by <source>
    // --reason <text> [--continue-round <n>]。编排顺序：参数防护 → 路径边界（change 名单段 +
    // realpath 直接子目录）→ 单一权威判定（目标 / change 名 / 上限 / 幂等 / 源 / 授权）→ 备份
    // （包含性复核）→ 转移 → 授权留痕 → 审计事件 → REENTRY 行。全部判定集中在 route-node.mjs
    // 纯函数（本命令只做编排与落盘，禁止内联第二份）；BLOCK 与空操作路径一律在写盘前返回
    // （state 字节零改写）。
    const target = process.argv[3];
    const reentryTargetList = [...REENTRY_TARGET_NODE_IDS].join(', ');
    const reenterUsage = '用法: workflow-state.mjs reenter <target> --authorized-by <source> --reason <text>'
      + ' [--continue-round <n>]（target 白名单: ' + reentryTargetList + '）';
    if (typeof target !== 'string' || target === '' || target.startsWith('--')) {
      console.error('BLOCKED: reenter 缺少目标节点。' + reenterUsage);
      process.exit(1);
    }
    let authorizedBy = null;
    let reason = null;
    let continuationRound = null;
    const reenterArgs = process.argv.slice(4);
    for (let index = 0; index < reenterArgs.length; index += 1) {
      const arg = reenterArgs[index];
      // 支持 --name value 与 --name=value 两种形态；--protocol 为全局参数（协议路径已由
      // resolveProtocol 统一解析），命令面只做占位透传。
      let key = arg;
      let value = null;
      if (typeof arg === 'string' && arg.startsWith('--')) {
        const eq = arg.indexOf('=');
        if (eq > 0) {
          key = arg.slice(0, eq);
          value = arg.slice(eq + 1);
        }
      }
      if (key === '--protocol') {
        if (value === null) index += 1;
        continue;
      }
      if (key === '--continue-round') {
        // 续轮授权只在达到轮次上限后生效：命令面收正整数，形态合法性与「是否已到上限」由
        // 单一权威综合判定裁决（本处只做数值形态防护，fail-closed，先于任何读盘）。
        let consumedNext = false;
        if (value === null) {
          value = reenterArgs[index + 1];
          consumedNext = true;
        }
        const parsedRound = typeof value === 'string' && value.trim() !== '' && !value.startsWith('--')
          ? Number(value.trim())
          : Number.NaN;
        if (!Number.isInteger(parsedRound) || parsedRound <= 0) {
          console.error('BLOCKED: reenter --continue-round 需要正整数取值，实际 ' + JSON.stringify(value) + '。' + reenterUsage);
          process.exit(1);
        }
        continuationRound = parsedRound;
        if (consumedNext) index += 1;
        continue;
      }
      if (key === '--authorized-by' || key === '--reason') {
        let consumedNext = false;
        if (value === null) {
          value = reenterArgs[index + 1];
          consumedNext = true;
        }
        // 缺值 / 空值 / 纯空白 / 取下个选项名当值 → 一律用法错误（fail-closed，先于任何读盘）
        if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
          console.error('BLOCKED: reenter ' + key + ' 需要非空取值。' + reenterUsage);
          process.exit(1);
        }
        if (key === '--authorized-by') authorizedBy = value.trim();
        else reason = value.trim();
        if (consumedNext) index += 1;
        continue;
      }
      console.error('BLOCKED: reenter 未知参数 ' + JSON.stringify(arg) + '。' + reenterUsage);
      process.exit(1);
    }
    if (authorizedBy === null) {
      console.error('BLOCKED: reenter 需要显式授权 --authorized-by <source>（授权不可自决）。' + reenterUsage);
      process.exit(1);
    }
    if (reason === null) {
      console.error('BLOCKED: reenter 需要 --reason <text> 说明重入原因。' + reenterUsage);
      process.exit(1);
    }
    const state = await readState();
    const badFields = validateStateFields(state);
    if (badFields.length > 0) {
      // history 存在但非数组等类型损坏在此 fail-closed：不得由本命令静默清空覆盖审计历史。
      console.error('BLOCKED: state 字段类型非法: ' + badFields[0]);
      process.exit(1);
    }
    // 原始 state（未经 readState 兼容默认值叠加）：落盘时只写「原始键集 + 本次实际改动的字段」，
    // 兼容默认值不得随重入回写（最小旧 state 的键集保持逐项不变）。
    const rawState = (await fileExists(statePath)) ? await readJson(statePath) : null;
    // 路径边界：change 名必须是 .specs/ 下的单段真实目录（realpath 归一后是 .specs 直接子目录，
    // 且路径上无 symlink/junction）。归档移动已发生（目录不在原位）、change 已 completed、
    // change 名畸形（多段 / . / .. / 保留目录 archive）与链接逃逸一律 BLOCK。该边界先于综合
    // 判定执行——completed 与已移动形态必须无条件 BLOCK（不被空操作分支短路）。
    const changeName = typeof state.activeChange === 'string' ? state.activeChange : '';
    const changeBoundary = await inspectReentryChangeDir(changeName);
    const changeDirPresent = changeBoundary.ok
      ? true
      : (changeBoundary.reason === 'change-dir-missing' ? false : null);
    const movedOrCompletedMessage = 'BLOCKED: 归档移动已发生或 change 已 completed（.specs/'
      + (changeName || '<未知>') + '/ 在场=' + changeDirPresent + '，status=' + JSON.stringify(state.status)
      + '）——受控重入只覆盖归档移动前的运行形态；请走人工处置、新 change 或 hotfix 路径。';
    if (state.status === 'completed' || changeDirPresent === false) {
      console.error(movedOrCompletedMessage);
      process.exit(1);
    }
    if (!changeBoundary.ok) {
      const boundaryMessages = {
        'no-active-change': '当前没有活跃 change（activeChange 缺失或为空）——先 select <change-id>',
        'change-name-invalid': 'change 名非法 ' + JSON.stringify(changeName)
          + '——必须是 .specs/ 下的单段目录名（拒绝路径分隔符、. / .. 与保留目录 archive）',
        'change-dir-escape': 'change 目录路径越界或跨越符号链接 / junction（' + changeBoundary.detail
          + '）——受控重入与备份只允许落在 .specs/<change-id>/ 真实目录内',
      };
      console.error('BLOCKED: ' + boundaryMessages[changeBoundary.reason]);
      process.exit(1);
    }
    const changeDir = changeBoundary.changeDir;
    // 授权形态的 round / at 由引擎派生（命令面只承载授权来源、原因与上限后的续轮轮次）：普通轮次
    // 以合法占位值过形态门；落盘轮次一律取综合判定返回的 round（由本 change 历史事件派生），
    // 不在此内联第二份轮次推导。
    const authorizedAt = new Date().toISOString();
    const decision = resolveReentryDecision({
      protocol,
      state,
      target,
      authorization: { round: 1, at: authorizedAt, source: authorizedBy, target },
      continuationRound,
    });
    if (!decision.ok) {
      if (decision.reason === 'round-limit-reached') {
        console.error('BLOCKED: 本 change 受控重入已达上限（' + decision.used + '/' + decision.limit
          + ' 轮）。需要人工裁决：继续（显式授权后在同一命令加 --continue-round <n>，n 为不小于第 '
          + (decision.used + 1) + ' 轮的正整数，须与 --authorized-by / --reason 同次传入）/ 停止（保持归档态，不再重入）。');
        process.exit(1);
      }
      const guidance = {
        'target-not-allowed': '目标节点 ' + JSON.stringify(target) + ' 不在受控重入白名单（'
          + reentryTargetList + '）——请显式指定白名单内目标',
        'target-not-enabled': '目标节点 ' + JSON.stringify(target)
          + ' 在当前协议中未启用（disabled）——请检查协议或改选已启用目标',
        'no-active-change': '当前没有活跃 change（activeChange 缺失或为空）——先 select <change-id>',
        'change-name-invalid': 'change 名非法 ' + JSON.stringify(changeName)
          + '——必须是 .specs/ 下的单段目录名（拒绝路径分隔符、. / .. 与保留目录 archive）',
        'source-not-archive': '受控重入只覆盖 archive 源（当前节点 ' + JSON.stringify(state.currentNode)
          + '）——正常推进请走 next / record / exit 既有通道',
        'continuation-not-required': '--continue-round 只在达到轮次上限后需要（当前 ' + decision.used + '/'
          + decision.limit + ' 轮）——上限前请直接以 --authorized-by / --reason 发起',
      }[decision.reason] || ('授权形态不合法（' + decision.reason + '）——需要用户显式传入 --authorized-by <source>');
      console.error('BLOCKED: ' + guidance);
      process.exit(1);
    }
    if (decision.action === 'noop') {
      console.log('REENTRY: 空操作——workflow 已处于目标形态（' + target
        + '，完成标记已是目标前驱交集）；未备份、未计数、未改写 state。');
      return;
    }
    if (decision.action !== 'apply') {
      console.error('BLOCKED: 受控重入判定返回未知动作 ' + JSON.stringify(decision.action) + '——按 fail-closed 拒绝。');
      process.exit(1);
    }
    const round = decision.round;
    const source = decision.authorization.source;
    const at = decision.authorization.at;
    const continuationAuthorized = decision.continuationAuthorized === true;
    // 备份：重入前 state 全量快照（文件原始字节，UTF-8 BOM 按可解析形态落盘）；文件名
    // <UTC ISO 净化>-pre-<target>.json；审计指纹 = 备份文件字节的 sha256（可核验）。
    const backupDir = path.join(changeDir, '.reentry-backups');
    const backupFile = at.replace(/:/g, '-') + '-pre-' + target + '.json';
    const backupPath = path.join(backupDir, backupFile);
    const backupRecord = path.relative(runRoot, backupPath).split(path.sep).join('/');
    const snapshotBytes = Buffer.from((await fs.readFile(statePath, 'utf8')).replace(/^\uFEFF/, ''), 'utf8');
    const fingerprint = createHash('sha256').update(snapshotBytes).digest('hex');
    const existingHistory = Array.isArray(rawState?.history) ? rawState.history : [];
    let backupWritten = false;
    try {
      if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
        throw new Error('state 文件缺失或形态非法，无法重入');
      }
      // 备份写入路径的物理包含性复核（单一权威路径段扫描）：备份目录与备份文件逐段
      // lstat + realpath——任何 symlink/junction 逃出 .specs/ 一律拒绝，不写任何字节。
      await fs.mkdir(backupDir, { recursive: true });
      await inspectWorkflowPathSegments(specsRoot, backupDir, 'reenter backup dir', 'directory');
      await fs.writeFile(backupPath, snapshotBytes);
      backupWritten = true;
      await inspectWorkflowPathSegments(specsRoot, backupPath, 'reenter backup file', 'file');
      // 授权留痕：嵌套写入被重入目标节点的 evidence（授权记录 + 备份指针 + 指纹 + 原因 +
      // 续轮标记）。只改 evidence 的目标节点键，其余键按原始键集逐项保留。
      const existingEvidence = rawState.evidence && typeof rawState.evidence === 'object' && !Array.isArray(rawState.evidence)
        ? rawState.evidence
        : {};
      const targetEvidence = existingEvidence[decision.target]
        && typeof existingEvidence[decision.target] === 'object'
        && !Array.isArray(existingEvidence[decision.target])
        ? existingEvidence[decision.target]
        : {};
      const authorizationRecord = {
        round,
        at,
        source,
        target: decision.target,
        backup: backupRecord,
        fingerprint,
        reason,
        ...(continuationAuthorized ? { continuationAuthorized: true } : {}),
      };
      // 落盘形态 = 原始 state 键集 + 本次实际改动的四类机器字段与审计字段——转移语义
      // （currentNode := target / completedNodes := 前驱交集 / status := running）与审计
      // （evidence 留痕 + history 追加事件）之外的字段逐项不变；readState 的兼容默认值不回写。
      const persisted = { ...rawState };
      persisted.currentNode = decision.target;
      persisted.completedNodes = decision.completedNodes.slice();
      persisted.status = 'running';
      persisted.evidence = {
        ...existingEvidence,
        [decision.target]: { ...targetEvidence, reentryAuthorization: authorizationRecord },
      };
      // 审计事件：append-only 追加 reentry-applied；change 字段是跨 change 轮次隔离的唯一依据。
      persisted.history = existingHistory.concat([{
        event: 'reentry-applied',
        from: 'archive',
        to: decision.target,
        round,
        authorization: { round, at, source, target: decision.target },
        backup: backupRecord,
        fingerprint,
        at,
        change: changeName,
        reason,
        ...(continuationAuthorized ? { continuationAuthorized: true } : {}),
      }]);
      const persistedBad = validateStateFields(persisted);
      if (persistedBad.length > 0) throw new Error('state 字段类型非法: ' + persistedBad[0]);
      await writeState(persisted);
    } catch (error) {
      // 写盘失败：回滚本次调用创建的孤儿备份（state 由原子写保证不被截断），原始错误照常上抛。
      if (backupWritten) {
        try { await fs.rm(backupPath, { force: true }); } catch { /* 清理失败不掩盖原始错误 */ }
      }
      throw error;
    }
    const roundLabel = continuationAuthorized
      ? '第 ' + round + ' 轮（显式授权续轮，上限 ' + REENTRY_ROUND_LIMIT + '）'
      : '第 ' + round + '/' + REENTRY_ROUND_LIMIT + ' 轮';
    console.log('REENTRY: archive → ' + decision.target + '（授权源 ' + source + '；' + roundLabel
      + '；备份 ' + backupRecord + '）');
    console.log('REASON: ' + reason);
    return;
  }

  if (command === 'replan') {
    // 受控计划重校重签（ADR-013）：计划在执行中被证明有缺陷时，唯一合规的重签入口——只在
    // execute / subagent-execute 相位可用、停原位（不跳节点、不改 completedNodes），先把任务集
    // 重新校验（依赖图 + 任务字段，绝不豁免）再重录 state.taskHash。命令形态：
    // replan <reason> --authorized-by <source> [--continue-round <n>]。
    // 编排顺序与 reenter 同构：参数防护 → 读 state → 单一权威判定（相位/change → 授权 →
    // 上限与续轮 → 幂等空操作）→ 重校 → 备份（sha256）→ 重签 → 双写留痕 → REPLAN/REASON 行；
    // 全部判定集中在 route-node.mjs 纯函数族，BLOCK 与空操作路径一律在写盘前返回（字节零改写）。
    const replanUsage = '用法: workflow-state.mjs replan <reason> --authorized-by <source> [--continue-round <n>]';
    const replanReason = process.argv[3];
    if (typeof replanReason !== 'string' || replanReason.trim() === '' || replanReason.startsWith('--')) {
      console.error('BLOCKED: replan 缺少原因（位置参数 <reason> 必填且非空）。' + replanUsage);
      process.exit(1);
    }
    const reason = replanReason.trim();
    let authorizedBy = null;
    let continuationRound = null;
    const replanArgs = process.argv.slice(4);
    for (let index = 0; index < replanArgs.length; index += 1) {
      const arg = replanArgs[index];
      // 支持 --name value 与 --name=value 两种形态；--protocol 为全局参数（协议路径已由
      // resolveProtocol 统一解析），命令面只做占位透传。
      let key = arg;
      let value = null;
      if (typeof arg === 'string' && arg.startsWith('--')) {
        const eq = arg.indexOf('=');
        if (eq > 0) {
          key = arg.slice(0, eq);
          value = arg.slice(eq + 1);
        }
      }
      if (key === '--protocol') {
        if (value === null) index += 1;
        continue;
      }
      if (key === '--continue-round') {
        // 续轮授权只在达到轮次上限后生效：命令面收正整数，形态合法性与「是否已到上限」由
        // 单一权威综合判定裁决（本处只做数值形态防护，fail-closed，先于任何读盘）。
        let consumedNext = false;
        if (value === null) {
          value = replanArgs[index + 1];
          consumedNext = true;
        }
        const parsedRound = typeof value === 'string' && value.trim() !== '' && !value.startsWith('--')
          ? Number(value.trim())
          : Number.NaN;
        if (!Number.isInteger(parsedRound) || parsedRound <= 0) {
          console.error('BLOCKED: replan --continue-round 需要正整数取值，实际 ' + JSON.stringify(value) + '。' + replanUsage);
          process.exit(1);
        }
        continuationRound = parsedRound;
        if (consumedNext) index += 1;
        continue;
      }
      if (key === '--authorized-by') {
        let consumedNext = false;
        if (value === null) {
          value = replanArgs[index + 1];
          consumedNext = true;
        }
        // 缺值 / 空值 / 纯空白 / 取下个选项名当值 → 一律用法错误（fail-closed，先于任何读盘）
        if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
          console.error('BLOCKED: replan --authorized-by 需要非空取值。' + replanUsage);
          process.exit(1);
        }
        authorizedBy = value.trim();
        if (consumedNext) index += 1;
        continue;
      }
      console.error('BLOCKED: replan 未知参数 ' + JSON.stringify(arg) + '。' + replanUsage);
      process.exit(1);
    }
    if (authorizedBy === null) {
      console.error('BLOCKED: replan 需要显式授权 --authorized-by <source>（授权不可自决）。' + replanUsage);
      process.exit(1);
    }
    const state = await readState();
    const badFields = validateStateFields(state);
    if (badFields.length > 0) {
      // history 存在但非数组等类型损坏在此 fail-closed：不得由本命令静默清空覆盖审计历史。
      console.error('BLOCKED: state 字段类型非法: ' + badFields[0]);
      process.exit(1);
    }
    // 原始 state（未经 readState 兼容默认值叠加）：备份取文件原始字节，落盘只写「原始键集 +
    // 本次实际改动的字段」——兼容默认值不得随重校回写（与受控重入同纪律）。
    const rawState = (await fileExists(statePath)) ? await readJson(statePath) : null;
    const changeName = typeof state.activeChange === 'string' ? state.activeChange : '';
    // 任务内容读取（fail-closed）：不可读 / 为空 → 交由综合判定返回 task-content-missing
    // block（缺 TASK.md 时不得以「空任务集签名」判幂等空操作放行，L-079）。
    let taskContent = null;
    try {
      taskContent = await fs.readFile(protocolTaskFilePath(protocol, changeName, specsRoot), 'utf8');
    } catch { taskContent = null; }
    // 授权形态的 round / at 由引擎派生（命令面只承载授权来源、原因与上限后的续轮轮次）：普通
    // 轮次以合法占位值过形态门；落盘轮次一律取综合判定返回的 round（由本 change 历史事件派生），
    // 不在此内联第二份轮次推导。
    const authorizedAt = new Date().toISOString();
    const decision = resolveReplanDecision({
      protocol,
      state,
      authorization: { round: 1, at: authorizedAt, source: authorizedBy, reason, node: state.currentNode },
      continuationRound,
      taskContent,
    });
    if (!decision.ok) {
      if (decision.reason === 'round-limit-reached') {
        console.error('BLOCKED: 本 change 计划重校已达上限（' + decision.used + '/' + decision.limit
          + ' 轮）。需要人工裁决：继续（显式授权后在同一命令加 --continue-round <n>，n 为不小于第 '
          + (decision.used + 1) + ' 轮的正整数，须与 --authorized-by / <reason> 同次传入）/ 停止（保持现状，不再重校）。');
        process.exit(1);
      }
      const replanGuidance = {
        'no-active-change': '当前没有活跃 change（activeChange 缺失或为空）——先 select <change-id>',
        'change-name-invalid': 'change 名非法 ' + JSON.stringify(changeName)
          + '——必须是 .specs/ 下的单段目录名（拒绝路径分隔符、. / .. 与保留目录 archive）',
        'phase-not-allowed': 'replan 只在 execute / subagent-execute 相位可用（当前节点 '
          + JSON.stringify(state.currentNode) + '）——其余相位请走既有推进 / 受控重入通道',
        'continuation-not-required': '--continue-round 只在达到轮次上限后需要（当前 ' + decision.used + '/'
          + decision.limit + ' 轮）——上限前请直接以 --authorized-by / <reason> 发起',
        'task-content-missing': '任务内容缺失或不可读（.specs/<change>/TASK.md 不存在 / 为空）——按 fail-closed 拒绝重签',
      }[decision.reason] || ('授权形态不合法（' + decision.reason + '）——需要用户显式传入 --authorized-by <source>');
      console.error('BLOCKED: ' + replanGuidance);
      process.exit(1);
    }
    if (decision.action === 'noop') {
      console.log('REPLAN: 空操作——state.taskHash 已与当前 TASK.md 同签（' + decision.node
        + '），无需重校；未备份、未计数、未写事件、未改写 state。');
      return;
    }
    if (decision.action !== 'apply') {
      console.error('BLOCKED: replan 判定返回未知动作 ' + JSON.stringify(decision.action) + '——按 fail-closed 拒绝。');
      process.exit(1);
    }
    // 重校（ADR-013 决策 3：replan 绝不做校验豁免）：任务块 / <verify> / 任务图（依赖环与
    // 缺失依赖——analyzeDependencyGraph 单一实现，与 plan 出口同源）/ 7 字段完整性。任一失败
    // → BLOCK，状态零改写（本段全部先于备份与写盘）。
    const taskList = taskBlocks(taskContent);
    if (taskList.length === 0) {
      console.error('BLOCKED: TASK.md 无 <task> 块——replan 不做校验豁免，拒绝重签（状态零改写）。');
      process.exit(1);
    }
    const missingVerify = taskList.filter((block) => !/<verify>/.test(block));
    if (missingVerify.length > 0) {
      console.error('BLOCKED: TASK.md 中 ' + missingVerify.length
        + ' 个 task 缺 <verify> 字段——replan 不做校验豁免，拒绝重签（状态零改写）。');
      process.exit(1);
    }
    const depGraph = analyzeDependencyGraph(taskList);
    if (depGraph.cyclic || depGraph.missing.length > 0) {
      const detail = depGraph.cyclic
        ? '依赖环（拓扑排序无解，涉及任务: ' + depGraph.cycleIds.join(', ') + '）'
        : '依赖不存在的任务: ' + depGraph.missing.map((m) => m.id + '→' + m.dep).join(', ');
      console.error('BLOCKED: TASK.md ' + detail
        + '——依赖图不可满足（任务的依赖链必须存在且无环）；replan 不做校验豁免，拒绝重签（状态零改写）'
        + '；恢复: 调整任务 depends_on——移除成环引用或改为真实存在的任务 id 后重试');
      process.exit(1);
    }
    // 任务字段完整性（与 plan 出口同一判据）：新模板形态（含 <name>）且新 change → BLOCK；
    // 旧式一字段形态 / 旧 change 保持渐进 WARN（不放大既有语义）。
    const replanTask7Required = ['name', 'read_files', 'write_files', 'action', 'verify', 'done', 'depends_on'];
    const replanTask7NewFormat = taskList.some((block) => /<name\b/i.test(block));
    const replanTask7Broken = [];
    for (const block of taskList) {
      const missing = replanTask7Required.filter((field) => !new RegExp('</?' + field + '\\b', 'i').test(block));
      if (missing.length > 0) {
        const idAttr = (taskOpeningAttrs(block) || {}).id || '?';
        replanTask7Broken.push((idAttr !== '?' ? idAttr + ' ' : '') + '缺 ' + missing.join('/'));
      }
    }
    if (replanTask7Broken.length > 0) {
      if (replanTask7NewFormat && state.newChange === true) {
        console.error('BLOCKED: TASK.md 任务缺 7 字段（name/read_files/write_files/action/verify/done/depends_on）: '
          + replanTask7Broken.join('; ') + '；恢复: 对照 flow-kit/templates/TASK.md 补齐每个 <task> 的缺字段后重试；replan 不做校验豁免');
        process.exit(1);
      }
      console.error('TASK-7FIELD WARN: TASK.md ' + replanTask7Broken.join('; ')
        + (replanTask7NewFormat ? '（旧 change 渐进，不阻断）' : '（旧式一字段模板形态，渐进不阻断）'));
    }
    // 路径边界：change 名必须是 .specs/ 下的单段真实目录（realpath 归一后仍在 .specs/ 内、
    // 无 symlink/junction 逃逸；复用受控路径边界实现）——备份落点必须先通过该边界。
    const changeBoundary = await inspectReentryChangeDir(changeName);
    if (!changeBoundary.ok) {
      const boundaryMessages = {
        'no-active-change': '当前没有活跃 change（activeChange 缺失或为空）——先 select <change-id>',
        'change-name-invalid': 'change 名非法 ' + JSON.stringify(changeName)
          + '——必须是 .specs/ 下的单段目录名（拒绝路径分隔符、. / .. 与保留目录 archive）',
        'change-dir-missing': '.specs/' + (changeName || '<未知>') + '/ 目录不存在——重校备份必须具备真实 change 目录落点',
        'change-dir-escape': 'change 目录路径越界或跨越符号链接 / junction（' + changeBoundary.detail
          + '）——受控重校与备份只允许落在 .specs/<change-id>/ 真实目录内',
      };
      console.error('BLOCKED: ' + (boundaryMessages[changeBoundary.reason] || ('change 目录边界异常（' + changeBoundary.reason + '）')));
      process.exit(1);
    }
    const changeDir = changeBoundary.changeDir;
    // 并行写冲突校验（2026-09-28 PR 审查采纳）：replan 不做校验豁免——重校后的任务集若含
    // 本趟可运行（依赖已满足）的并行任务且 write_files 重叠，与 plan 出口使用同一实现
    // （route-node.findParallelWriteConflicts 单一来源）在此 BLOCK；必须早于备份与任何写盘，
    // BLOCK 路径 state 字节零改写。read∩write 弱判与 plan 出口同风格——仅 WARN 不阻断。
    // 同文件跨任务且无依赖路径（第三族）同样在此消费：与 plan 出口同判据、同分级（新 change
    // BLOCKED / 旧 change WARN），消息同族（任务对 `a×b(files)` + 恢复指引「补显式 depends_on 或
    // 合并为一个任务」）——replan 是执行期唯一合法的任务集修订通道，不得成为该形态的豁免口。
    const { writeConflicts, crossTaskConflicts, readWarnings } = await findParallelWriteConflicts(path.join(runRoot, '.specs', changeName));
    if (writeConflicts.length > 0) {
      console.error('BLOCKED: replan 检测到并行写冲突（'
        + writeConflicts.map((c) => c.a + '↔' + c.b + ': ' + c.files.join(',')).join('; ')
        + '）——replan 不做校验豁免，状态零改写；恢复: 调整 write_files 消除重叠后重试');
      process.exit(1);
    }
    if (crossTaskConflicts.length > 0) {
      const crossDetail = crossTaskConflicts.map((c) => c.a + '×' + c.b + '(' + c.files.join(',') + ')').join('; ');
      const crossGuide = '；恢复: 补显式 depends_on 或合并为一个任务后重试';
      if (state.newChange === true) {
        console.error('BLOCKED: TASK.md 同文件跨任务且无依赖路径: ' + crossDetail
          + '——replan 不做校验豁免，状态零改写' + crossGuide);
        process.exit(1);
      }
      console.error('WARN: TASK.md 同文件跨任务且无依赖路径（旧 change 渐进不阻断）: ' + crossDetail + crossGuide);
    }
    if (readWarnings.length > 0) {
      console.error('WARN: TASK.md 并行任务 read∩write 隐式依赖嫌疑（一方读取对方写路径，建议补显式 depends_on 声明）: '
        + readWarnings.map((c) => c.a + '×' + c.b + '(' + c.files.join(',') + ')').join('; '));
    }
    const round = decision.round;
    const source = decision.authorization.source;
    const at = decision.authorization.at;
    const continuationAuthorized = decision.continuationAuthorized === true;
    const taskSetSignatureValue = decision.taskSetSignature;
    if (typeof taskSetSignatureValue !== 'string' || taskSetSignatureValue === '') {
      console.error('BLOCKED: replan 未能派生当前任务集签名——按 fail-closed 拒绝（状态零改写）。');
      process.exit(1);
    }
    // 备份：重签前 state 全量快照（文件原始字节，UTF-8 BOM 按可解析形态落盘）；文件名
    // <UTC ISO 净化>-pre-replan.json；审计指纹 = 备份文件字节的 sha256（可核验）。
    const backupDir = path.join(changeDir, 'replan-backups');
    const backupFile = at.replace(/:/g, '-') + '-pre-replan.json';
    const backupPath = path.join(backupDir, backupFile);
    const backupRecord = path.relative(runRoot, backupPath).split(path.sep).join('/');
    const snapshotBytes = Buffer.from((await fs.readFile(statePath, 'utf8')).replace(/^\uFEFF/, ''), 'utf8');
    const fingerprint = createHash('sha256').update(snapshotBytes).digest('hex');
    const existingHistory = Array.isArray(rawState?.history) ? rawState.history : [];
    let backupWritten = false;
    try {
      if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
        throw new Error('state 文件缺失或形态非法，无法重校重签');
      }
      // 备份写入路径的物理包含性复核（单一权威路径段扫描）：备份目录与备份文件逐段
      // lstat + realpath——任何 symlink/junction 逃出 .specs/ 一律拒绝，不写任何字节。
      await fs.mkdir(backupDir, { recursive: true });
      await inspectWorkflowPathSegments(specsRoot, backupDir, 'replan backup dir', 'directory');
      await fs.writeFile(backupPath, snapshotBytes);
      backupWritten = true;
      await inspectWorkflowPathSegments(specsRoot, backupPath, 'replan backup file', 'file');
      // 双写留痕（ADR-013 决策 8）：① evidence.<node>.replanAuthorization（节点级授权 + 备份
      // 指纹）；② history 追加 replan-applied（跨 change 审计检索）。落盘形态 = 原始 state
      // 键集 + 本次实际改动的三处（taskHash / evidence / history），其余字段逐项不变。
      const existingEvidence = rawState.evidence && typeof rawState.evidence === 'object' && !Array.isArray(rawState.evidence)
        ? rawState.evidence
        : {};
      const nodeEvidence = existingEvidence[decision.node]
        && typeof existingEvidence[decision.node] === 'object'
        && !Array.isArray(existingEvidence[decision.node])
        ? existingEvidence[decision.node]
        : {};
      const authorizationRecord = {
        round,
        at,
        source,
        reason,
        backup: backupRecord,
        fingerprint,
        ...(continuationAuthorized ? { continuationAuthorized: true } : {}),
      };
      const persisted = { ...rawState };
      persisted.taskHash = taskSetSignatureValue;
      persisted.evidence = {
        ...existingEvidence,
        [decision.node]: { ...nodeEvidence, replanAuthorization: authorizationRecord },
      };
      persisted.history = existingHistory.concat([{
        event: 'replan-applied',
        change: changeName,
        node: decision.node,
        round,
        reason,
        authorizedBy: source,
        taskSetSignature: taskSetSignatureValue,
        backup: backupRecord,
        fingerprint,
        at,
        ...(continuationAuthorized ? { continuationAuthorized: true } : {}),
      }]);
      const persistedBad = validateStateFields(persisted);
      if (persistedBad.length > 0) throw new Error('state 字段类型非法: ' + persistedBad[0]);
      await writeState(persisted);
    } catch (error) {
      // 写盘失败：回滚本次调用创建的孤儿备份（state 由原子写保证不被截断），原始错误照常上抛。
      if (backupWritten) {
        try { await fs.rm(backupPath, { force: true }); } catch { /* 清理失败不掩盖原始错误 */ }
      }
      throw error;
    }
    const roundLabel = continuationAuthorized
      ? '第 ' + round + ' 轮（显式授权续轮，上限 ' + REPLAN_ROUND_LIMIT + '）'
      : '第 ' + round + '/' + REPLAN_ROUND_LIMIT + ' 轮';
    console.log('REPLAN: ' + decision.node + ' 重新校验通过（授权源 ' + source + '；' + roundLabel
      + '；备份 ' + backupRecord + '）');
    console.log('REASON: ' + reason);
    return;
  }

  throw new Error('Unknown command: ' + command + '. Use: init, status, next, select, record, verify-fail, advance, execution-mode, config, skill-load, bridge-check, reenter, replan');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
