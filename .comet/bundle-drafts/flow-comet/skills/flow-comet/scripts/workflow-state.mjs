#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateStateFields } from './state-schema.mjs';

const command = process.argv[2] ?? 'status';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const runRoot = process.cwd();
const protocolPath = path.join(packageRoot, 'reference', 'workflow-protocol.json');
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
  }
  // 2. Scan .specs/ for directories with TASK.md (active flow-kit changes)
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

async function determineNode(changeName, protocol, completedNodes = []) {
  const changeDir = path.join(specsRoot, changeName);
  const checks = {
    change: await fileExists(path.join(changeDir, 'CHANGE.md')),
    requirement: await fileExists(path.join(changeDir, 'REQUIREMENT.md')),
    design: await fileExists(path.join(changeDir, 'DESIGN.md')) || await fileExists(path.join(changeDir, 'DESIGN-lite.md')),
    task: await fileExists(path.join(changeDir, 'TASK.md')),
    summaries: (await fs.readdir(changeDir).catch(() => [])).filter(f => f.endsWith('-SUMMARY.md')).length > 0,
    review: await fileExists(path.join(changeDir, 'REVIEW.md')),
    uat: await fileExists(path.join(changeDir, 'UAT.md')),
  };

  if (!checks.change) return 'open';
  if (!checks.requirement) return 'open';
  if (!checks.design) return 'design';
  if (!checks.task) return 'plan';

  // Check if all tasks are done
  try {
    const taskContent = await fs.readFile(path.join(changeDir, 'TASK.md'), 'utf8');
    // Use <task ... status="..." to match only task tags, not documentation text
    const pending = (taskContent.match(/<task[^>]*status="pending"/g) || []).length;
    const done = (taskContent.match(/<task[^>]*status="done"/g) || []).length;
    if (pending > 0) {
      // P0 fix: 只检测依赖已满足的 parallel 任务，避免 Wave N+1 的 parallel 任务
      // 在 Wave N 串行任务未完成时就被路由到 subagent-execute
      const hasSubagentNode = route(protocol).some(n => n.id === 'subagent-execute');
      if (hasSubagentNode) {
        // 收集所有 done 任务的 id
        const doneIds = new Set((taskContent.match(/<task[^>]*id="([^"]+)"[^>]*status="done"/g) || [])
          .map(m => { const id = m.match(/id="([^"]+)"/); return id ? id[1] : null; })
          .filter(Boolean));
        // 检查 pending parallel 任务中是否有依赖已满足的
        const parallelBlocks = taskContent.match(/<task[^>]*parallel="true"[^>]*status="pending"[\s\S]*?<\/task>/g) || [];
        const eligibleParallel = parallelBlocks.filter(block => {
          const depsMatch = block.match(/<depends_on>([\s\S]*?)<\/depends_on>/);
          if (!depsMatch || !depsMatch[1].trim()) return true; // 无依赖
          const deps = depsMatch[1].trim().split(/[,\s]+/).filter(Boolean);
          return deps.every(d => doneIds.has(d));
        });
        if (eligibleParallel.length > 0) return 'subagent-execute';
      }
      return 'execute';
    }
    // All tasks done — require at least one SUMMARY to proceed to review
    if (!checks.summaries) return 'execute';
    if (done > 0 && !checks.review) return 'review';
    // verify is mandatory after review: TEST.md (produced by review) is an INPUT to
    // verify, not its exit. Only UAT.md (verify's output) completes the node.
    if (checks.review && !checks.uat) return 'verify';
    if (checks.uat) return 'archive';
  } catch {}

  return 'execute';
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
function printBranchLine(activeChange) {
  const branch = gitBranchName();
  if (branch === null) {
    console.log('BRANCH: none');
    return;
  }
  const expected = 'change/' + activeChange;
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
  const protocol = await readJson(protocolPath);

  if (command === 'init') {
    const changeName = process.argv[3];
    if (!changeName) throw new Error('init requires a change name.');
    // E1: branchMode 自动判定——git 仓库（cwd=runRoot）→ true；非 git 仓库 → false
    const branchMode = isInsideWorkTree();
    const state = {
      activeChange: changeName,
      currentNode: 'open',
      completedNodes: [],
      evidence: {},
      verifyFailures: 0,
      executionMode: 'subagent',
      directOverride: false,
      branchMode,
      enablePrReview: false,
      createdAt: new Date().toISOString()
    };
    await writeState(state);
    // E1: 分支创建——branchMode && 当前分支 ≠ change/<id> && 分支不存在 → git checkout -b change/<id>
    // 失败 → WARN 不 BLOCK，继续纯文件模式（向后兼容）
    const expectedBranch = 'change/' + changeName;
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
    printBranchLine(changeName);
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
    const detectedNode = await determineNode(changeName, protocol, state.completedNodes);
    // P0-2: 状态漂移自动校正——以文件产物为准（determineNode），校正 state.currentNode
    if (state.currentNode !== detectedNode) {
      state.currentNode = detectedNode;
      await writeState(state);
    }
    printNext(protocol, detectedNode, state.executionMode ?? 'subagent');
    printBranchLine(changeName);
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
