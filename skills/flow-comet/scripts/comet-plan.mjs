#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// comet-plan.mjs: Initialize plan state for a change
// Usage: node comet-plan.mjs <change-name>

const runRoot = process.cwd();
const specsRoot = path.join(runRoot, '.specs');
const statePath = path.join(runRoot, '.comet', 'flow-comet-state.json');

async function fileExists(f) { try { await fs.access(f); return true; } catch { return false; } }

async function main() {
  const changeName = process.argv[2];
  if (!changeName) {
    // Show current plan status
    if (await fileExists(statePath)) {
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      console.log(JSON.stringify({ activeChange: state.activeChange, currentNode: state.currentNode }, null, 2));
    } else {
      console.log('No active plan. Usage: node comet-plan.mjs <change-name>');
    }
    return;
  }

  const changeDir = path.join(specsRoot, changeName);
  const taskFile = path.join(changeDir, 'TASK.md');
  if (!(await fileExists(taskFile))) {
    console.error('TASK.md not found: ' + taskFile);
    process.exit(1);
  }

  // Read TASK.md to count tasks
  const content = await fs.readFile(taskFile, 'utf8');
  const pending = (content.match(/<task[^>]*status="pending"/g) || []).length;
  const done = (content.match(/<task[^>]*status="done"/g) || []).length;

  // Update state
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  let state = {};
  if (await fileExists(statePath)) {
    state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  }
  // Reset completedNodes when switching to a different change
  if (state.activeChange && state.activeChange !== changeName) {
    state.completedNodes = [];
    state.evidence = {};
  }
  state.activeChange = changeName;
  state.currentNode = state.currentNode || 'execute';
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify({
    change: changeName,
    tasks: { pending, done, total: pending + done },
    planPath: taskFile,
    statePath
  }, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
