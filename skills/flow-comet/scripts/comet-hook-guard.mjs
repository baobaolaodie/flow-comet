#!/usr/bin/env node
import { promises as fs, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// comet-hook-guard.mjs: Guard file writes against task boundaries
// Reads TASK.md to check if the target file is within the current task's write_files
// Receives file path from: argv[2] > FILE_PATH env > stdin JSON > empty

const runRoot = process.cwd();
const specsRoot = path.join(runRoot, '.specs');
const statePath = path.join(runRoot, '.comet', 'flow-comet-state.json');

function inputTarget() {
  // 1. Command line argument
  if (process.argv[2]) return process.argv[2];
  // 2. Environment variable (Claude Code hook system)
  if (process.env.FILE_PATH) return process.env.FILE_PATH;
  // 3. Stdin JSON (Claude Code hook system passes {tool_input: {file_path: ...}})
  if (process.stdin.isTTY) return '';
  try {
    const input = readFileSync(0, 'utf8');
    if (!input) return '';
    const parsed = JSON.parse(input);
    return typeof parsed.tool_input?.file_path === 'string' ? parsed.tool_input.file_path : '';
  } catch { return ''; }
}

async function fileExists(f) { try { await fs.access(f); return true; } catch { return false; } }

async function findActiveChange() {
  if (await fileExists(statePath)) {
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    if (state.activeChange && await fileExists(path.join(specsRoot, state.activeChange))) {
      return state.activeChange;
    }
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

async function getCurrentTask(changeName) {
  const taskFile = path.join(specsRoot, changeName, 'TASK.md');
  if (!(await fileExists(taskFile))) return null;
  const content = await fs.readFile(taskFile, 'utf8');
  // Find the first pending task
  const match = content.match(/<task id="([^"]+)"[^>]*status="pending"/);
  return match ? match[1] : null;
}

async function getTaskBoundaries(changeName, taskId) {
  const taskFile = path.join(specsRoot, changeName, 'TASK.md');
  const content = await fs.readFile(taskFile, 'utf8');
  // Extract the task block
  const taskRegex = new RegExp(`<task id="${taskId}"[\\s\\S]*?</task>`, 'i');
  const taskBlock = content.match(taskRegex);
  if (!taskBlock) return null;

  const writeMatch = taskBlock[0].match(/<write_files>([\s\S]*?)<\/write_files>/);
  if (!writeMatch) return null;

  const files = writeMatch[1].trim().split('\n')
    .map(f => f.trim().replace(/<!--.*?-->/g, '').trim())
    .filter(f => f && !f.startsWith('<'));
  return files;
}

async function main() {
  const targetFile = inputTarget();
  const taskArg = process.argv.indexOf('--task');
  const specifiedTask = taskArg >= 0 ? process.argv[taskArg + 1] : null;

  if (!targetFile) {
    console.log('PASS: no file specified');
    return;
  }

  const changeName = await findActiveChange();
  if (!changeName) {
    console.log('PASS: no active change');
    return;
  }

  const taskId = specifiedTask || await getCurrentTask(changeName);
  if (!taskId) {
    console.log('PASS: no pending task');
    return;
  }

  const boundaries = await getTaskBoundaries(changeName, taskId);
  if (!boundaries || boundaries.length === 0) {
    console.log('PASS: no write_files boundary for ' + taskId);
    return;
  }

  // Normalize the target path
  const normalizedTarget = path.relative(runRoot, path.resolve(targetFile)).replace(/\\/g, '/');

  // Check if target matches any boundary
  const allowed = boundaries.some(boundary => {
    const normalizedBoundary = boundary.replace(/\\/g, '/');
    if (normalizedBoundary.includes('*')) {
      // Simple glob: match prefix
      const prefix = normalizedBoundary.replace(/\*.*$/, '');
      return normalizedTarget.startsWith(prefix) || normalizedTarget.includes(prefix);
    }
    return normalizedTarget === normalizedBoundary || normalizedTarget.endsWith('/' + normalizedBoundary);
  });

  if (allowed) {
    console.log('PASS: ' + normalizedTarget + ' is within ' + taskId + ' write_files');
  } else {
    console.log('BLOCKED: ' + normalizedTarget + ' is NOT in ' + taskId + ' write_files');
    console.log('  Allowed: ' + boundaries.join(', '));
    process.exit(1);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
