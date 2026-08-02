#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const action = process.argv[2] ?? 'verify';
const nodeId = process.argv[3] ?? null;
const apply = process.argv.includes('--apply');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runRoot = process.cwd();
const specsRoot = path.join(runRoot, '.specs');
const statePath = path.join(runRoot, '.comet', 'flow-comet-state.json');

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function readState() {
  if (await fileExists(statePath)) return JSON.parse(await fs.readFile(statePath, 'utf8'));
  return { activeChange: null, currentNode: null, completedNodes: [], evidence: {} };
}

async function writeState(state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function findActiveChange() {
  const state = await readState();
  if (state.activeChange && await fileExists(path.join(specsRoot, state.activeChange))) {
    return state.activeChange;
  }
  try {
    const entries = await fs.readdir(specsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || ['archive', 'health', 'evolve', 'adr'].includes(entry.name)) continue;
      if (await fileExists(path.join(specsRoot, entry.name, 'TASK.md'))) return entry.name;
    }
  } catch {}
  return null;
}

const NODE_ORDER = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify', 'archive'];

// Prerequisites: what artifacts must exist before entering each node
const PREREQS = {
  open: [],
  design: ['CHANGE.md', 'REQUIREMENT.md'],
  plan: ['DESIGN.md'], // or DESIGN-lite.md
  execute: ['TASK.md'],
  'subagent-execute': ['TASK.md'],
  review: ['TASK.md'], // Also checks all tasks are done (special check in checkNode)
  verify: ['REVIEW.md'],
  archive: ['UAT.md']
};

// Output artifacts: what each node should produce
const OUTPUTS = {
  open: ['CHANGE.md', 'REQUIREMENT.md'],
  design: ['DESIGN.md'], // or DESIGN-lite.md
  plan: ['TASK.md'],
  execute: [], // At least one SUMMARY.md
  'subagent-execute': [], // Evidence recorded in state
  review: ['REVIEW.md'],
  verify: [], // TEST.md or UAT.md
  archive: []
};

async function checkFile(changeDir, name) {
  if (name === 'DESIGN.md') {
    return await fileExists(path.join(changeDir, 'DESIGN.md'))
      || await fileExists(path.join(changeDir, 'DESIGN-lite.md'));
  }
  return await fileExists(path.join(changeDir, name));
}

async function checkNode(changeName, nodeId) {
  const changeDir = path.join(specsRoot, changeName);
  const results = [];

  // Check prerequisites (from previous nodes)
  const prereqs = PREREQS[nodeId] || [];
  for (const p of prereqs) {
    const exists = await checkFile(changeDir, p);
    results.push({ check: `prereq: ${p}`, ok: exists });
  }

  // Check this node's output artifacts
  const outputs = OUTPUTS[nodeId] || [];
  for (const o of outputs) {
    const exists = await checkFile(changeDir, o);
    results.push({ check: `output: ${o}`, ok: exists });
  }

  // Special checks
  if (nodeId === 'execute') {
    const taskFile = path.join(changeDir, 'TASK.md');
    if (await fileExists(taskFile)) {
      const content = await fs.readFile(taskFile, 'utf8');
      const pending = (content.match(/<task[^>]*status="pending"/g) || []).length;
      const done = (content.match(/<task[^>]*status="done"/g) || []).length;
      results.push({ check: `tasks: pending=${pending} done=${done}`, ok: true });
      if (pending > 0) {
        results.push({ check: 'all-tasks-done', ok: false, detail: `${pending} tasks still pending` });
      }
    } else {
      results.push({ check: 'TASK.md', ok: false });
    }
  }

  if (nodeId === 'review') {
    // Check all tasks are done before allowing review
    const taskFile = path.join(changeDir, 'TASK.md');
    if (await fileExists(taskFile)) {
      const content = await fs.readFile(taskFile, 'utf8');
      const pending = (content.match(/<task[^>]*status="pending"/g) || []).length;
      if (pending > 0) {
        results.push({ check: 'prereq: all-tasks-done', ok: false, detail: `${pending} tasks still pending` });
      }
    }
  }

  if (nodeId === 'verify') {
    // TEST.md (review's output) is an input to verify; UAT.md (verify's output) completes it.
    // Requiring only UAT.md keeps verify mandatory and aligns with determineNode + archive prereq.
    const hasUat = await fileExists(path.join(changeDir, 'UAT.md'));
    results.push({ check: 'output: UAT.md', ok: hasUat });
  }

  // GAP-1: archive must have UAT.md as prereq (not just output)
  if (nodeId === 'archive') {
    const hasUat = await fileExists(path.join(changeDir, 'UAT.md'));
    results.push({ check: 'output: UAT.md', ok: hasUat });
  }

  // GAP-4: execute must have at least one SUMMARY.md (build-evidence)
  if (nodeId === 'execute') {
    const files = await fs.readdir(changeDir).catch(() => []);
    const summaries = files.filter(f => f.endsWith('-SUMMARY.md'));
    results.push({ check: 'output: *-SUMMARY.md', ok: summaries.length > 0 });
  }

  // GAP-3: subagent-execute must have handoff evidence
  if (nodeId === 'subagent-execute') {
    try {
      const state = JSON.parse(await fs.readFile(path.join(runRoot, '.comet', 'flow-comet-state.json'), 'utf8'));
      const handoff = (state.evidence || {})['subagent-execute'] || {};
      const hasRequests = handoff.handoffRequests && Object.keys(handoff.handoffRequests).length > 0;
      const hasResults = handoff.handoffResult && Object.keys(handoff.handoffResult).length > 0;
      results.push({ check: 'output: handoff-evidence', ok: hasRequests || hasResults });
    } catch {
      results.push({ check: 'output: handoff-evidence', ok: false });
    }
  }

  return results;
}

async function main() {
  if (!nodeId) {
    console.error('Usage: workflow-guard.mjs <entry|exit|verify> <node-id> [--apply]');
    process.exit(1);
  }

  const changeName = await findActiveChange();
  if (!changeName) {
    console.log('BLOCKED: No active change in .specs/');
    process.exit(1);
  }

  const checks = await checkNode(changeName, nodeId);
  const failures = checks.filter(c => !c.ok);
  const passed = failures.length === 0;

  if (action === 'entry') {
    // For entry, only check prerequisites (not outputs)
    const prereqFailures = checks.filter(c => c.check.startsWith('prereq:') && !c.ok);
    if (prereqFailures.length === 0) {
      console.log(`ENTRY OK: ${nodeId}`);
    } else {
      console.log(`BLOCKED: ${nodeId} prerequisites not met:`);
      for (const f of prereqFailures) console.log(`  MISSING: ${f.check}`);
      const idx = NODE_ORDER.indexOf(nodeId);
      if (idx > 0) console.log(`  HINT: Complete ${NODE_ORDER[idx - 1]} first.`);
      process.exit(1);
    }
    return;
  }

  if (action === 'exit') {
    // For exit, check that outputs exist
    const outputFailures = checks.filter(c => c.check.startsWith('output:') && !c.ok);
    // For execute, also check all tasks are done
    const taskFailures = checks.filter(c => c.check === 'all-tasks-done' && !c.ok);

    const exitOk = outputFailures.length === 0 && taskFailures.length === 0;

    if (exitOk) {
      if (apply) {
        const state = await readState();
        if (!state.completedNodes.includes(nodeId)) {
          state.completedNodes.push(nodeId);
        }
        state.evidence[nodeId] = state.evidence[nodeId] || {};
        state.evidence[nodeId].exitCheck = 'passed';
        state.evidence[nodeId].exitAt = new Date().toISOString();
        // Write state FIRST so the subprocess sees updated completedNodes
        await writeState(state);
        // Then use workflow-state.mjs next to determine the actual next node
        try {
          const { execSync } = await import('child_process');
          const nextOutput = execSync('node .claude/skills/flow-comet/scripts/workflow-state.mjs next', { encoding: 'utf8', timeout: 10000 });
          const nodeMatch = nextOutput.match(/^NODE: (.+)$/m);
          if (nodeMatch) {
            state.currentNode = nodeMatch[1];
          } else {
            // Fallback to linear order
            const idx = NODE_ORDER.indexOf(nodeId);
            if (idx >= 0 && idx < NODE_ORDER.length - 1) {
              state.currentNode = NODE_ORDER[idx + 1];
            }
          }
        } catch {
          // Fallback to linear order
          const idx = NODE_ORDER.indexOf(nodeId);
          if (idx >= 0 && idx < NODE_ORDER.length - 1) {
            state.currentNode = NODE_ORDER[idx + 1];
          }
        }
        await writeState(state);
        console.log(`EXIT OK: ${nodeId} -> ${state.currentNode} (applied)`);
      } else {
        console.log(`EXIT OK: ${nodeId} (dry-run, use --apply to advance)`);
      }
    } else {
      console.log(`BLOCKED: ${nodeId} not complete:`);
      for (const f of [...outputFailures, ...taskFailures]) {
        console.log(`  ${f.detail || 'MISSING: ' + f.check}`);
      }
      process.exit(1);
    }
    return;
  }

  if (action === 'verify') {
    console.log(`=== Verify: ${nodeId} (${changeName}) ===`);
    for (const c of checks) {
      const status = c.ok ? 'PASS' : 'FAIL';
      const detail = c.detail ? ` (${c.detail})` : '';
      console.log(`  [${status}] ${c.check}${detail}`);
    }
    console.log(passed ? 'ALL CHECKS PASSED' : 'BLOCKED');
    if (!passed) process.exit(1);
    return;
  }

  console.error('Unknown action: ' + action);
  process.exit(1);
}

main().catch(error => { console.error(error.message); process.exit(1); });
