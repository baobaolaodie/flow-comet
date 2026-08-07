#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveProtocol, readProtocolFile, validateProtocolSchema } from './protocol-utils.mjs';
import { validateStateFields } from './state-schema.mjs';

const command = process.argv[2] ?? 'status';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const runRoot = process.cwd();
// D1: 协议路径统一由 resolveProtocol 解析——优先级：--protocol CLI 参数 → FLOW_COMET_PROTOCOL
// 环境变量 → 内置默认 reference/workflow-protocol.json。--protocol 为全局参数（可放在 command
// 之后的任意位置）；cliArgs = 去掉 command 后的剩余参数数组。
const protocolPath = resolveProtocol(packageRoot, runRoot, process.argv.slice(3));
const statePath = path.join(runRoot, '.comet', 'flow-comet-state.json');
const specsRoot = path.join(runRoot, '.specs');

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function findActiveChange() {
  // 1. Read from state file if exists
  if (await fileExists(statePath)) {
    const state = await readJson(statePath);
    if (state.activeChange) {
      const changeDir = path.join(specsRoot, state.activeChange);
      if (await fileExists(changeDir)) return state.activeChange;
    }
    // T-FIX-17: 归档完成态（completed 且无 activeChange）→ 不扫描兜底——
    // 防归档残留目录（含 TASK.md 的旧副本）被误判为 active change（D-10）
    if (state.status === 'completed') return null;
  }
  // 2. Scan .specs/ for directories with TASK.md (active flow-kit changes)
  // 注: T-FIX-17 曾尝试按 archive/ 对应归档跳过残留目录——但会误伤同名新 change（S64 实证），已撤回。
  // 「state 缺失 + 归档残留」为已知限制（对比报告已记录"捡残留桩"共性问题）；归档后正常态由
  // 上文 completed 分支覆盖（T-FIX-17 主修复）
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

// ---------- D2 · determineNode 数据化：完成标志从协议 outputSchemas 推导 ----------

// 为每个节点构建"完成标志文件集"：遍历节点 outputSchemas 引用的 schema 的 artifacts
// （schema 在 protocol.outputSchemas 数组中按 id 查找），paths 中 <change-id> 替换为实际
// changeName，得到相对 .specs 根的路径数组。同一 artifact 的 paths 为互斥备选（命中任一即
// 该 artifact 存在，如 DESIGN.md / DESIGN-lite.md）；节点完成 = 标志文件集全部存在
// （required !== false 的 artifact 全部存在，与 workflow-guard missingRequiredArtifacts 同语义）。
// 返回 Map<nodeId, Array<{ id, paths }>>。
function buildNodeCompletionFlags(protocol, changeName) {
  const schemaById = new Map((protocol.outputSchemas ?? []).map((schema) => [schema.id, schema]));
  const flags = new Map();
  for (const node of protocol.nodes ?? []) {
    const artifacts = [];
    for (const schemaId of node.outputSchemas ?? []) {
      const schema = schemaById.get(schemaId);
      for (const artifact of schema?.artifacts ?? []) {
        if (artifact.required === false) continue; // 可选产物不是完成门控
        artifacts.push({
          id: schemaId + '.' + (artifact.id ?? 'artifact'),
          paths: (artifact.paths ?? []).map((p) => String(p).replaceAll('<change-id>', changeName)),
        });
      }
    }
    flags.set(node.id, artifacts);
  }
  return flags;
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
}

// 与 workflow-guard.mjs pathPatternExists 同语义的轻量 glob 存在检查：
// 按路径段逐段 walk，含 `*` 的段按正则匹配（`*` → `.*`，如 *-SUMMARY.md），命中任一真实路径即存在。
async function pathPatternExists(root, relativePattern) {
  const parts = String(relativePattern).split(/[\\/]+/).filter(Boolean);
  async function walk(current, index) {
    if (index >= parts.length) return fileExists(current);
    const part = parts[index];
    if (!part.includes('*')) return walk(path.join(current, part), index + 1);
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return false;
    }
    const matcher = new RegExp('^' + part.split('*').map(escapeRegExp).join('.*') + '$', 'u');
    for (const entry of entries) {
      if (matcher.test(entry.name) && (await walk(path.join(current, entry.name), index + 1))) {
        return true;
      }
    }
    return false;
  }
  return walk(root, 0);
}

// 节点完成判定 = 标志文件集全部存在（artifact 存在 = 其 paths 任一命中 glob）
async function nodeFlagsComplete(nodeFlags, nodeId) {
  for (const artifact of nodeFlags.get(nodeId) ?? []) {
    let present = false;
    for (const pattern of artifact.paths) {
      if (await pathPatternExists(specsRoot, pattern)) {
        present = true;
        break;
      }
    }
    if (!present) return false;
  }
  return true;
}

async function determineNode(changeName, protocol, completedNodes = []) {
  // T-FIX-03（dogfood D1）: 全部节点已完成 → 完成态，不产出最后节点。
  // 自定义协议无 archive 节点时，completedNodes 全齐后 next 仍会输出 NODE: <最后节点>
  // （产物推导只返回最后节点 id）——此处（产物推导之前）判定：route(protocol) 的所有节点
  // id 均已包含在 completedNodes 中 → 返回 null。printNext(null) 输出 "NEXT: done"；
  // status 的 currentNode = null 表示完成态。内置协议不受影响：archive exit 时 workflow-guard
  // 清 activeChange，findActiveChange 返回 null 先于 determineNode 触发；completedNodes 含
  // 全部 8 节点时同样返回 null，与"归档后无活跃 change"语义一致。
  const protocolNodeIds = route(protocol).map((n) => n.id);
  if (protocolNodeIds.length > 0 && protocolNodeIds.every((id) => completedNodes.includes(id))) {
    return null;
  }
  const changeDir = path.join(specsRoot, changeName);
  // D2: 节点完成标志从协议 outputSchemas 推导（内置协议缺省行为与现硬编码逐字节一致）
  const nodeFlags = buildNodeCompletionFlags(protocol, changeName);
  // 任务文件路径：协议可选 taskFile 字段（相对 changeDir），无声明时缺省 TASK.md。
  // 自定义协议无 taskFile 时 parallel 检测自然降级为串行（任务文件缺失 → 不路由 subagent-execute）。
  const taskFile = typeof protocol.taskFile === 'string' && protocol.taskFile !== ''
    ? protocol.taskFile
    : 'TASK.md';
  const taskPath = path.join(changeDir, taskFile);

  // 节点顺序 = 协议 nodes 顺序（disabled 过滤，见 route()）；execute/subagent-execute 由任务状态特判。
  // 按协议顺序拆分：execute/subagent-execute 之前的节点走产物门控（内置 = open → design → plan），
  // 之后的节点在任务全部 done 后按序门控（内置 = review → verify → archive）。
  const orderedNodes = route(protocol);
  const hasExecuteFamily = orderedNodes.some((n) => n.id === 'execute' || n.id === 'subagent-execute');
  const preExecNodes = [];
  const postExecNodes = [];
  let sawExecuteFamily = false;
  for (const node of orderedNodes) {
    if (node.id === 'execute' || node.id === 'subagent-execute') {
      sawExecuteFamily = true;
      continue;
    }
    if (sawExecuteFamily) postExecNodes.push(node);
    else preExecNodes.push(node);
  }

  // 前置产物门控：execute 之前的节点按序检查（内置协议 = open → design → plan）
  for (const node of preExecNodes) {
    if (!(await nodeFlagsComplete(nodeFlags, node.id))) return node.id;
  }

  // 协议无 execute/subagent-execute 节点：无任务状态特判，全部节点已按产物门控完成 → 当前处于最后节点
  if (!hasExecuteFamily) {
    return orderedNodes.length > 0 ? orderedNodes[orderedNodes.length - 1].id : 'archive';
  }

  // execute/subagent-execute 特判：解析任务文件 <task> 块 pending/done/parallel/depends_on（沿用现逻辑）
  try {
    const taskContent = await fs.readFile(taskPath, 'utf8');
    // Use <task ... status="..." to match only task tags, not documentation text
    const pending = (taskContent.match(/<task[^>]*status="pending"/g) || []).length;
    const done = (taskContent.match(/<task[^>]*status="done"/g) || []).length;
    if (pending > 0) {
      // P0 fix: 只检测依赖已满足的 parallel 任务，避免 Wave N+1 的 parallel 任务
      // 在 Wave N 串行任务未完成时就被路由到 subagent-execute
      const hasSubagentNode = route(protocol).some((n) => n.id === 'subagent-execute');
      if (hasSubagentNode) {
        // 收集所有 done 任务的 id
        const doneIds = new Set((taskContent.match(/<task[^>]*id="([^"]+)"[^>]*status="done"/g) || [])
          .map((m) => { const id = m.match(/id="([^"]+)"/); return id ? id[1] : null; })
          .filter(Boolean));
        // 检查 pending parallel 任务中是否有依赖已满足的
        const parallelBlocks = taskContent.match(/<task[^>]*parallel="true"[^>]*status="pending"[\s\S]*?<\/task>/g) || [];
        const eligibleParallel = parallelBlocks.filter((block) => {
          const depsMatch = block.match(/<depends_on>([\s\S]*?)<\/depends_on>/);
          if (!depsMatch || !depsMatch[1].trim()) return true; // 无依赖
          const deps = depsMatch[1].trim().split(/[,\s]+/).filter(Boolean);
          return deps.every((d) => doneIds.has(d));
        });
        if (eligibleParallel.length > 0) return 'subagent-execute';
      }
      return 'execute';
    }
    // 任务全部 done——execute 完成还需至少一份 SUMMARY（execute 产物门控，内置 = <change-id>/*-SUMMARY.md glob）
    if (!(await nodeFlagsComplete(nodeFlags, 'execute'))) return 'execute';
    // 后置产物门控：按协议顺序检查 execute 之后的节点（内置 = review → verify → archive）。
    // verify 的完成标志 = flowkit.verify.v1 全部 required artifacts（TEST.md + UAT.md）；自然流程中
    // TEST.md 由 review 产出、UAT.md 由 verify 产出，故"verify 看 UAT.md"的判定语义保持不变。
    for (const node of postExecNodes) {
      if (!(await nodeFlagsComplete(nodeFlags, node.id))) return node.id;
    }
    // 全部产物门控通过 → 当前处于协议最后一个节点（内置协议 = archive，与现硬编码 checks.uat → 'archive' 一致）
    return orderedNodes.length > 0 ? orderedNodes[orderedNodes.length - 1].id : 'archive';
  } catch {}

  return 'execute';
}

// T-FIX-09: T-FIX 回退豁免判定——T-FIX 标准回退路径：review/verify 阶段发现缺陷 → TASK.md 追加
// pending T-FIX 任务（含 T-FIX-NN）→ next 回 execute。三条件全满足才豁免（否则维持 T-FIX-05 严格 BLOCK）：
// ① currentNode 为 review/verify（T-FIX 回退源节点）；② TASK.md 存在 status="pending" 任务块；
// ③ determineNode 推导为 execute（回退目标）。任一不满足 → 不豁免，保持严格拦截。
async function tFixRollbackExempt(changeName, protocol, currentNode, completedNodes) {
  if (currentNode !== 'review' && currentNode !== 'verify') return false;
  const taskPath = path.join(specsRoot, changeName, 'TASK.md');
  try {
    const taskContent = await fs.readFile(taskPath, 'utf8');
    if (!/<task[^>]*status="pending"/.test(taskContent)) return false;
    return (await determineNode(changeName, protocol, completedNodes)) === 'execute';
  } catch {
    return false;
  }
}

// T-FIX-11: 正常推进豁免判定——exit --apply 会把 currentNode 推进到下一节点（如 open exit 后
// currentNode=design，该节点尚未开始故 evidence 无记录），随后按 SKILL 协议调 next（正常路径）
// 不应被 T-FIX-05 误拦为"疑似未 exit"。判定三条件：① completedNodes 非空；② 最后一个已完成节点
// 在路由列表（route(protocol)，disabled 过滤）中的直接后继 = currentNode（exit 推进的正常下一节点）；
// ③ 最后一个已完成节点存在 evidence（exit --apply 必须带证据通过——证据存在证明该 exit 真实发生，
// 排除伪造/漂移状态如 S43 类 review 无 evidence）。与 T-FIX-09 回退豁免独立判断（回退 = TASK.md
// 有 pending T-FIX；本豁免 = 正常推进后继）。真乱序（currentNode 不是 completedNodes 的后继）仍
// 维持 T-FIX-05 严格 BLOCK。
function normalAdvanceExempt(state, protocol, completedNodes, currentNode) {
  if (completedNodes.length === 0) return false;
  const lastNodeId = completedNodes[completedNodes.length - 1];
  const routeIds = route(protocol).map((node) => node.id);
  const lastIdx = routeIds.indexOf(lastNodeId);
  if (lastIdx < 0 || lastIdx + 1 >= routeIds.length) return false;
  if (routeIds[lastIdx + 1] !== currentNode) return false;
  const lastEvidence = state.evidence && typeof state.evidence === 'object'
    ? state.evidence[lastNodeId]
    : null;
  // 审查补充（2026-08-08）：evidence 必须是对象且含非空 summary（空对象 {} 可绕过豁免，
  // 真实流程 exit 强制 summary——此处严格化防止手动修改 state 绕过）
  return !!(
    lastEvidence &&
    typeof lastEvidence === 'object' &&
    !Array.isArray(lastEvidence) &&
    typeof lastEvidence.summary === 'string' &&
    lastEvidence.summary.trim() !== ''
  );
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
    // T-FIX-14: 分支前缀（init --branch-prefix 记录；旧 state 缺省 'change/' 向后兼容）
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
// D3: 校验表已迁移到 state-schema.mjs（唯一来源），行为与批次 C C6 完全一致（对第一个非法字段输出后退出）
async function writeState(state) {
  const bad = validateStateFields(state);
  if (bad.length) {
    console.error('BLOCKED: state 字段类型非法: ' + bad[0]);
    process.exit(1);
  }
  await writeJson(statePath, state);
}

function route(protocol) {
  return (protocol.nodes ?? []).filter(n => !n.disabled);
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
  if (nodeId === 'execute' || nodeId === 'subagent-execute') {
    if (executionMode === 'direct' && nodeId === 'execute') {
      console.log('EXECUTION-MODE: direct（主代理直接执行串行任务，必须加载 flow-comet-dev 完整协议；parallel 任务仍由 subagent-execute 委托）');
    } else {
      console.log('COORDINATOR: 你是协调者，不是执行者。禁止在主会话直接修改源码；只能通过 Agent 工具 worktree isolation 委托子代理；子代理回传后仅更新 TASK.md / SUMMARY / handoff evidence。');
      console.log('EXECUTION-MODE: ' + (executionMode === 'direct' ? 'direct' : 'subagent'));
    }
  }
}

async function main() {
  // D1: 协议加载 = resolveProtocol 解析路径 + 受保护读取 + fail-closed schema 校验
  // （读失败/校验失败直接 throw，沿用现有错误处理风格）
  const protocol = await readProtocolFile(runRoot, protocolPath);
  validateProtocolSchema(protocol);

  if (command === 'init') {
    const changeName = process.argv[3];
    if (!changeName) throw new Error('init requires a change name.');
    // T-FIX-14: --branch-prefix <prefix>（缺省 'change/'）；从剩余参数解析
    let branchPrefix = 'change/';
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
      }
    }
    // E1: branchMode 自动判定——git 仓库（cwd=runRoot）→ true；非 git 仓库 → false
    const branchMode = isInsideWorkTree();
    const state = {
      activeChange: changeName,
      // T-FIX-18: currentNode 取协议首节点（内置协议 = open，行为不变；自定义协议 = 首节点，如 brainstorm）
      currentNode: route(protocol)[0]?.id ?? 'open',
      completedNodes: [],
      evidence: {},
      verifyFailures: 0,
      executionMode: 'subagent',
      directOverride: false,
      branchMode,
      enablePrReview: false,
      branchPrefix,
      status: 'running',
      createdAt: new Date().toISOString()
    };
    await writeState(state);
    // T-FIX-16: init 创建 .specs/<id>/ 目录——文件即真相从 init 起成立，findActiveChange 立即可识别
    //（此前 init 后 next/status 报 No active change，与 SKILL 启动协议 init → next 矛盾）
    const specsChangeDir = path.join(specsRoot, changeName);
    await fs.mkdir(specsChangeDir, { recursive: true });
    // E1 + T-FIX-14: 分支创建——branchMode && 当前分支 ≠ <prefix><id> && 分支不存在 → git checkout -b
    // 前缀由 --branch-prefix 指定（缺省 'change/'，向后兼容；可适配仓库自身分支规范如 feat/）
    // 失败 → WARN 不 BLOCK，继续纯文件模式（向后兼容）
    const expectedBranch = branchPrefix + changeName;
    if (branchMode) {
      const currentBranch = gitBranchName();
      if (currentBranch !== null && currentBranch !== expectedBranch && !branchExists(expectedBranch)) {
        try {
          execFileSync('git', ['checkout', '-b', expectedBranch], { cwd: runRoot, stdio: 'pipe' });
        } catch {
          console.error('WARN: 创建分支 ' + expectedBranch + ' 失败——继续纯文件模式（分支功能降级；可稍后手动 git checkout -b ' + expectedBranch + '）');
        }
      }
    }
    console.log('Initialized: ' + changeName);
    console.log('BRANCH: ' + (branchMode ? expectedBranch : 'none（非 git 仓库）'));
    printNext(protocol, 'open');
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
      coordinatorMode: ['execute', 'subagent-execute'].includes(detectedNode)
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
    // T-FIX-05: 节点顺序校验（严格模式）——state.currentNode 非 null、不在 completedNodes、
    // 且 evidence 无该节点记录 → 上一节点从未 exit 就推进 → BLOCKED（exit 1）。
    // P0-2 漂移校正保留：已完成节点（currentNode ∈ completedNodes，或 evidence 已记录——
    // 节点已被 record/exit 处理过）正常推进不受影响；本校验只拦"证据完全缺失的疑似跳阶段"。
    // 豁免（两种独立判断，任一成立即放行）：T-FIX-09 回退豁免（TASK.md 有 pending T-FIX 回 execute）；
    // T-FIX-11 正常推进豁免（currentNode 是 completedNodes 最后节点 exit 推进的正常下一节点，
    // 见 normalAdvanceExempt）——真乱序（跳节点）仍严格 BLOCK
    const completedArr = Array.isArray(state.completedNodes) ? state.completedNodes : [];
    if (state.currentNode && !completedArr.includes(state.currentNode)) {
      const nodeEvidence = state.evidence && typeof state.evidence === 'object'
        ? state.evidence[state.currentNode]
        : null;
      const hasEvidence = !!(nodeEvidence && typeof nodeEvidence === 'object' && !Array.isArray(nodeEvidence));
      if (!hasEvidence) {
        // T-FIX-09: 回退豁免——review/verify 发现缺陷追加 pending T-FIX 任务后回 execute 的
        // T-FIX 标准回退路径放行（否则被 T-FIX-05 严格模式误拦为"未 exit 跳阶段"）；
        // 豁免条件不满足时维持严格 BLOCK
        const rollbackExempt = await tFixRollbackExempt(changeName, protocol, state.currentNode, completedArr);
        // T-FIX-11: 正常推进豁免——exit --apply 推进 currentNode 到下一节点后按 SKILL 协议调 next
        // （正常路径）不拦截；与 T-FIX-09 回退豁免独立判断（详见 normalAdvanceExempt 注释）
        const advanceExempt = normalAdvanceExempt(state, protocol, completedArr, state.currentNode);
        if (!rollbackExempt && !advanceExempt) {
          console.error('BLOCKED: 疑似未 exit 节点 ' + state.currentNode + '，先 workflow-guard.mjs exit ' + state.currentNode + ' --apply');
          process.exit(1);
        }
      }
    }
    const detectedNode = await determineNode(changeName, protocol, state.completedNodes);
    // P0-2: 状态漂移自动校正——以文件产物为准（determineNode），校正 state.currentNode
    if (state.currentNode !== detectedNode) {
      state.currentNode = detectedNode;
      await writeState(state);
    }
    printNext(protocol, detectedNode, state.executionMode ?? 'subagent');
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

  if (command === 'record') {
    const nodeId = process.argv[3];
    if (!nodeId) throw new Error('record requires a Node id.');
    const state = await readState();
    state.evidence = state.evidence || {};
    // 解析 JSON 参数并展开到 evidence 顶层（summary/completedChecks/output-schema evidence 等）；
    // 若不可解析则作为 summary 字符串
    let parsed = {};
    const raw = process.argv.slice(4).join(' ');
    try {
      parsed = raw ? JSON.parse(raw) : {};
      if (typeof parsed !== 'object' || Array.isArray(parsed)) parsed = { summary: String(parsed) };
    } catch {
      parsed = { summary: raw || 'recorded' };
    }
    state.evidence[nodeId] = {
      ...(state.evidence[nodeId] || {}),
      ...parsed,
      recordedAt: new Date().toISOString(),
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
    state.verifyFailures = state.verifyFailures ?? 0;
    // W2-A: 机器计数——连续 3 次失败后（第 4 次）BLOCKED，要求用户决策（继续修 / 停止）
    if (state.verifyFailures >= 3) {
      console.error('verify 失败超限，需用户决策（verifyFailures=' + state.verifyFailures + '）。继续修 / 停止？');
      process.exit(1);
    }
    state.verifyFailures += 1;
    await writeState(state);
    console.log('VERIFY-FAIL: ' + state.verifyFailures + '/3');
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

  throw new Error('Unknown command: ' + command + '. Use: init, status, next, select, record, verify-fail, advance, execution-mode, config');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
