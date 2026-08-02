#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// workflow-handoff.mjs: Record subagent handoff evidence
// Usage:
//   node workflow-handoff.mjs request <task-id> <description>  -- record handoff request
//   node workflow-handoff.mjs result <task-id> <result>        -- record handoff result
//   node workflow-handoff.mjs status                           -- show all handoff evidence

const runRoot = process.cwd();
const statePath = path.join(runRoot, '.comet', 'flow-comet-state.json');

async function fileExists(f) { try { await fs.access(f); return true; } catch { return false; } }

async function readState() {
  if (await fileExists(statePath)) return JSON.parse(await fs.readFile(statePath, 'utf8'));
  return { activeChange: null, currentNode: null, completedNodes: [], evidence: {} };
}

async function writeState(state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function main() {
  const action = process.argv[2] ?? 'status';
  const state = await readState();

  if (action === 'request') {
    const taskId = process.argv[3];
    const desc = process.argv.slice(4).join(' ');
    if (!taskId) { console.error('Usage: workflow-handoff.mjs request <task-id> <description>'); process.exit(1); }
    state.evidence = state.evidence || {};
    state.evidence['subagent-execute'] = state.evidence['subagent-execute'] || {};
    if (!state.evidence['subagent-execute'].handoffRequests) {
      state.evidence['subagent-execute'].handoffRequests = {};
    }
    state.evidence['subagent-execute'].handoffRequests[taskId] = {
      description: desc || 'pending', requestedAt: new Date().toISOString()
    };
    await writeState(state);
    console.log('HANDOFF REQUEST: ' + taskId);
    return;
  }

  if (action === 'result') {
    const taskId = process.argv[3];
    const result = process.argv.slice(4).join(' ');
    if (!taskId) { console.error('Usage: workflow-handoff.mjs result <task-id> <result>'); process.exit(1); }
    state.evidence = state.evidence || {};
    state.evidence['subagent-execute'] = state.evidence['subagent-execute'] || {};
    state.evidence['subagent-execute'].handoffResult = state.evidence['subagent-execute'].handoffResult || {};
    state.evidence['subagent-execute'].handoffResult[taskId] = {
      result: result || 'completed', completedAt: new Date().toISOString()
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
