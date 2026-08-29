#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveProtocol, readProtocolFile, validateProtocolSchema, NODE_PROTOCOL_FILES, SKILL_PROTOCOL_FILES } from './protocol-utils.mjs';
import { validateStateFields, verifyFailuresFor, setVerifyFailuresFor, looksLikeObjectLiteral } from './state-schema.mjs';
import { probeProject, classify, printDetection, validateContext, printGenerationGuide, skipInit } from './context-init.mjs';
import { taskOpeningAttrs, taskBlocks } from './task-parsing.mjs';
import { route, resolveNextNode, hasSubagentNode, protocolTaskFilePath } from './route-node.mjs';

const command = process.argv[2] ?? 'status';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const runRoot = process.cwd();
// 协议解析: 协议路径统一由 resolveProtocol 解析——优先级：--protocol CLI 参数 → FLOW_COMET_PROTOCOL
// 环境变量 → 内置默认 reference/workflow-protocol.json。--protocol 为全局参数（可放在 command
// 之后的任意位置）；cliArgs = 去掉 command 后的剩余参数数组。
const protocolPath = resolveProtocol(packageRoot, runRoot, process.argv.slice(3));
const statePath = path.join(runRoot, '.comet', 'flow-comet-state.json');
const specsRoot = path.join(runRoot, '.specs');

// 内置节点常量: 内置 8 节点常量（供其他用途参照——如 guard 的节点→协议映射对照；skill-load 的 node
// 参数校验已改为当前协议节点集合动态读取——compose 自定义协议节点可声明）
const BUILTIN_NODES = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify', 'archive'];

// 节点协议映射(单一来源): NODE_PROTOCOL_FILES 来自 protocol-utils.mjs(M5 record 自动补声明标记的 protocol 归属)

async function readJson(file) {
  // 容忍 UTF-8 BOM（外部写入如会话 Write 可能带 BOM）
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^﻿/, ''));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

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

// 回退修复豁免判定——回退修复标准路径：review/verify 阶段发现缺陷 → TASK.md 追加
// pending 回退任务 → next 回 execute。三条件全满足才豁免（否则维持严格 BLOCK）：
// ① currentNode 为 review/verify（回退修复源节点）；② TASK.md 存在 status="pending" 任务块；
// ③ determineNode 推导为 execute（回退目标）。任一不满足 → 不豁免，保持严格拦截。
async function tFixRollbackExempt(changeName, protocol, currentNode, completedNodes) {
  if (currentNode !== 'review' && currentNode !== 'verify') return false;
  const taskPath = path.join(specsRoot, changeName, 'TASK.md');
  try {
    const taskContent = await fs.readFile(taskPath, 'utf8');
    // 开标签解析（与 determineNode 同一语义）：存在任一 status="pending" 任务块
    if (!taskBlocks(taskContent).some((b) => {
      const a = taskOpeningAttrs(b);
      return a && a.status === 'pending';
    })) return false;
    return (await determineNode(changeName, protocol, completedNodes)) === 'execute';
  } catch {
    return false;
  }
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

// C6: writeState 写入前校验已知字段类型（fail-closed：非法 → BLOCKED 拒绝写入，不修复不猜测）
// 未知字段允许（前向兼容）；缺字段允许（readState 默认补）；只校验存在字段的类型。
// 内置节点常量: 校验表已迁移到 state-schema.mjs（唯一来源），行为与批次 C C6 完全一致（对第一个非法字段输出后退出）
async function writeState(state) {
  const bad = validateStateFields(state);
  if (bad.length) {
    console.error('BLOCKED: state 字段类型非法: ' + bad[0]);
    process.exit(1);
  }
  await writeJson(statePath, state);
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
  if (nodeId === 'execute' || nodeId === 'subagent-execute') {
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

  // ⑤ loader BRIDGE_VERSION 戳 vs 项目 INSTALLED_VERSION 偏斜（两值都打印；
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
    if (loaderStamp === installedVersion) {
      report.pass.push('版本一致性: loader BRIDGE_VERSION=' + loaderStamp + ' == 项目 INSTALLED_VERSION=' + installedVersion);
    } else {
      report.fail.push('版本偏斜: loader BRIDGE_VERSION=' + loaderStamp + ' != 项目 INSTALLED_VERSION=' + installedVersion + '（两值如上）');
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
      // currentNode 取协议首节点（内置协议 = open，行为不变；自定义协议 = 首节点，如 brainstorm）
      currentNode: route(protocol)[0]?.id ?? 'open',
      completedNodes: [],
      evidence: {},
      verifyFailures: 0,
      // verifyFailures 按 change 存储——init 新 change 从零计数(切换 change 不串扰)
      verifyFailuresByChange: {},
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
      // last_intel_scan 仅在校验通过后写入（agent 生成 → 脚本校验 7 段 → 记录扫描时间）
      ...(ctxValid === true
        ? { last_intel_scan: new Date().toISOString() }
        : (prevState?.last_intel_scan !== undefined ? { last_intel_scan: prevState.last_intel_scan } : {}))
    };
    await writeState(state);
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
      return;
    }
    const state = await readState();
    const detectedNode = await determineNode(changeName, protocol, state.completedNodes);
    console.log(JSON.stringify({
      status: 'running',
      change: changeName,
      currentNode: detectedNode,
      stateCurrentNode: state.currentNode,
      completedNodes: state.completedNodes,
      executionMode: state.executionMode ?? 'subagent',
      directOverride: state.directOverride ?? false,
      branchMode: isInsideWorkTree(),
      enablePrReview: state.enablePrReview ?? false,
      artifactRoot: '.specs/' + changeName,
      coordinatorMode: ['execute', 'subagent-execute'].includes(detectedNode),
      // G14: 新旧 change 标记——newChange true = 新 change(严格模式);false/缺失 = 旧 change(渐进)
      newChange: state.newChange === true
    }, null, 2));
    printBranchLine(changeName, state.branchPrefix ?? 'change/');
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
    // 节点顺序校验（严格模式）——state.currentNode 非 null、不在 completedNodes、
    // 且 evidence 无该节点记录 → 上一节点从未 exit 就推进 → BLOCKED（exit 1）。
    // 状态漂移校正保留：已完成节点（currentNode ∈ completedNodes，或 evidence 已记录——
    // 节点已被 record/exit 处理过）正常推进不受影响；本校验只拦"证据完全缺失的疑似跳阶段"。
    // 豁免（两种独立判断，任一成立即放行）： 回退豁免（TASK.md 有 pending 回退修复任务 回 execute）；
    //  正常推进豁免（currentNode 是 completedNodes 最后节点 exit 推进的正常下一节点，
    // 见 normalAdvanceExempt）——真乱序（跳节点）仍严格 BLOCK
    const completedArr = Array.isArray(state.completedNodes) ? state.completedNodes : [];
    if (state.currentNode && !completedArr.includes(state.currentNode)) {
      const nodeEvidence = state.evidence && typeof state.evidence === 'object'
        ? state.evidence[state.currentNode]
        : null;
      const hasEvidence = !!(nodeEvidence && typeof nodeEvidence === 'object' && !Array.isArray(nodeEvidence));
      if (!hasEvidence) {
        // 回退豁免——review/verify 发现缺陷追加 pending 修复任务后回 execute 的
        // 修复任务标准回退路径放行（否则被  严格模式误拦为"未 exit 跳阶段"）；
        // 豁免条件不满足时维持严格 BLOCK
        const rollbackExempt = await tFixRollbackExempt(changeName, protocol, state.currentNode, completedArr);
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
    if (detectedNode === 'execute' || detectedNode === 'subagent-execute') {
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
    const changeDir = path.join(specsRoot, changeName);
    if (!(await fileExists(changeDir))) throw new Error('Change not found: ' + changeDir);
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
    // 声明标记写入：.skill-loads/ 目录不存在时创建（writeJson 自带 mkdir recursive）；
    // 同 node-skill 重复调用覆盖（记录最新声明）
    const changeName = await findActiveChange();
    if (!changeName) {
      // 归档后场景:change 目录已移入 .specs/archive/(无活跃 change)——skill-load 不可用,
      // 但 record 的声明自动化(M5)仍可写归档路径标记——消息如实引导(级 4 实证反馈)
      throw new Error('skill-load requires an active change（先运行 init <change-id>;若该 change 已归档,声明标记由 record 自动补写——M5 会写入归档路径的 .skill-loads/）');
    }
    // 标记 protocol 字段 = --prompt 参数的 basename（如 0-change.md）——与 guard exit
    // 校验的 节点协议映射 表 basename 精确比对同值（真实链路 skill-load → exit 一致）；未传 --prompt →
    // null（无协议声明，exit 校验 fail-closed）。修复前旧实现写 resolveProtocol 解析后的完整
    // 绝对路径，与 节点协议映射 表 basename 比对必然失败（真实链路必 BLOCKED——机制实际不可用）。
    const marker = { node: nodeId, skill: skillName, protocol: promptArg === null ? null : path.basename(promptArg), at: new Date().toISOString() };
    // specsRoot 已含 .specs/，相对路径为 <change-id>/.skill-loads/<node>-<skill>.json
    const markerRel = path.posix.join(changeName, '.skill-loads', nodeId + '-' + skillName + '.json');
    await writeJson(path.join(specsRoot, markerRel), marker);
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
      // ——此时 writeJson 的 mkdir recursive 会把已归档的活动目录残留回来(修复前实测缺陷);
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
            await writeJson(markerFile, {
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
    // E1: 配置命令——config set <key> <value>；branchMode 只读（init 自动判定），enablePrReview 手动开关
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
    console.error('BLOCKED: 未知配置键: ' + key + '（支持: enablePrReview；branchMode 由 init 自动判定）');
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
    if (!state.completedNodes.includes(state.currentNode)) {
      state.completedNodes.push(state.currentNode);
    }
    // Use determineNode to get the actual next node (reads TASK.md)
    const detected = await determineNode(state.activeChange, protocol, state.completedNodes);
    state.currentNode = detected;
    await writeState(state);
    console.log('Advanced to: ' + state.currentNode);
    return;
  }

  throw new Error('Unknown command: ' + command + '. Use: init, status, next, select, record, verify-fail, advance, execution-mode, config, skill-load, bridge-check');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
