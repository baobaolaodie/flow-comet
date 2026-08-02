#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    const parallelPending = (taskContent.match(/<task[^>]*parallel="true"[^>]*status="pending"/g) || []).length;
    const done = (taskContent.match(/<task[^>]*status="done"/g) || []).length;
    if (pending > 0) {
      // Every wave's parallel tasks are eligible for subagent-execute: the TASK.md wave
      // division guarantees same-wave tasks have disjoint write_files. Serial tasks (or
      // waves without parallel=true tasks) fall through to execute.
      const hasSubagentNode = route(protocol).some(n => n.id === 'subagent-execute');
      if (parallelPending > 0 && hasSubagentNode) return 'subagent-execute';
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
  if (await fileExists(statePath)) return readJson(statePath);
  return { activeChange: null, currentNode: null, completedNodes: [], evidence: {} };
}

async function writeState(state) {
  await writeJson(statePath, state);
}

function route(protocol) {
  return (protocol.nodes ?? []).filter(n => !n.disabled);
}

function generatedNodeSkillName(protocol, nodeId) {
  return protocol.name + '-' + nodeId;
}

function printNext(protocol, nodeId) {
  if (!nodeId) {
    console.log('NEXT: done');
    return;
  }
  console.log('NEXT: auto');
  console.log('NODE: ' + nodeId);
  console.log('SKILL: ' + generatedNodeSkillName(protocol, nodeId));
}

async function main() {
  const protocol = await readJson(protocolPath);

  if (command === 'init') {
    const changeName = process.argv[3];
    if (!changeName) throw new Error('init requires a change name.');
    const state = {
      activeChange: changeName,
      currentNode: 'open',
      completedNodes: [],
      evidence: {},
      createdAt: new Date().toISOString()
    };
    await writeState(state);
    console.log('Initialized: ' + changeName);
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
      artifactRoot: '.specs/' + changeName
    }, null, 2));
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
    printNext(protocol, detectedNode);
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
    state.evidence[nodeId] = {
      ...(state.evidence[nodeId] || {}),
      recordedAt: new Date().toISOString(),
      summary: process.argv.slice(4).join(' ') || 'recorded'
    };
    await writeState(state);
    console.log('EVIDENCE: ' + nodeId);
    const changeName = state.activeChange || await findActiveChange();
    const nextNode = changeName ? await determineNode(changeName, protocol, state.completedNodes) : null;
    printNext(protocol, nextNode ?? null);
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

  throw new Error('Unknown command: ' + command + '. Use: init, status, next, select, record, advance');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
