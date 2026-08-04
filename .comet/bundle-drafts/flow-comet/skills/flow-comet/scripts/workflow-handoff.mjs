#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// workflow-handoff.mjs: Record subagent handoff evidence
// evidence 统一记录在 subagent-execute 名下作为委托证据库——execute（串行委托）与 subagent-execute（并行委托）共用。不改成节点参数，保持最小改动。
// Usage:
//   node workflow-handoff.mjs request <task-id> <description> [--write-files <files...>]  -- record handoff request (W2-D: optional writeFiles allow-list)
//   node workflow-handoff.mjs result <task-id> <result-or-JSON>  -- record handoff result (W1-D: JSON Return Contract; W2-D: commitHash subset check)
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
    const args = process.argv.slice(4);
    if (!taskId) { console.error('Usage: workflow-handoff.mjs request <task-id> <description> [--write-files <files...>]'); process.exit(1); }
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
    // P1-C: 若未显式传 --write-files，从 TASK.md 自动解析（orchestrator 无需手动提取文件列表）
    if (!writeFiles || writeFiles.length === 0) {
      try {
        const taskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
        const taskContent = await fs.readFile(taskFile, 'utf8');
        // 找到对应 task 块的 <write_files> 内容
        const taskRegex = new RegExp(`<task[^>]*id="${taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?<write_files>([\\s\\S]*?)</write_files>`, 'i');
        const match = taskContent.match(taskRegex);
        if (match) {
          const files = match[1].trim().split(/\s*\n\s*/).filter(f => f.trim());
          // 剥离 XML 注释（<!-- … -->）：TASK.md 模板 write_files 每行可带注释，保留会导致
          // W2-D 提交文件子集校验误报（f.startsWith('path  <!-- 注释 -->') 恒 false）
          writeFiles = files.map(f => f.trim().replace(/<!--[\s\S]*?-->/g, '').trim()).filter(Boolean);
        }
      } catch {}
    }
    state.evidence = state.evidence || {};
    state.evidence['subagent-execute'] = state.evidence['subagent-execute'] || {};
    if (!state.evidence['subagent-execute'].handoffRequests) {
      state.evidence['subagent-execute'].handoffRequests = {};
    }
    state.evidence['subagent-execute'].handoffRequests[taskId] = {
      description, requestedAt: new Date().toISOString(),
      ...(writeFiles.length ? { writeFiles } : {})
    };
    await writeState(state);
    console.log('HANDOFF REQUEST: ' + taskId);
    return;
  }

  if (action === 'result') {
    const taskId = process.argv[3];
    const raw = process.argv.slice(4).join(' ');
    if (!taskId) { console.error('Usage: workflow-handoff.mjs result <task-id> <result>'); process.exit(1); }
    // W1-D: 尝试解析 JSON（Return Contract）——解析失败则存原始字符串
    let parsed = raw;
    try { parsed = JSON.parse(raw); } catch {}
    state.evidence = state.evidence || {};
    state.evidence['subagent-execute'] = state.evidence['subagent-execute'] || {};
    state.evidence['subagent-execute'].handoffResult = state.evidence['subagent-execute'].handoffResult || {};
    // W2-D: 完整版 hash 校验——提交文件 ⊆ writeFiles 允许范围（子集，前缀匹配；越界仅 WARN）
    if (typeof parsed === 'object' && parsed !== null && parsed.commitHash && /^[0-9a-f]{7,40}$/i.test(String(parsed.commitHash))) {
      const commitHash = String(parsed.commitHash);
      const { execSync } = await import('child_process');
      try {
        const out = execSync(`git show ${commitHash} --name-only --format=`, { cwd: runRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const committedFiles = out.split('\n').map(s => s.trim()).filter(Boolean);
        const allowed = state.evidence['subagent-execute'].handoffRequests?.[taskId]?.writeFiles || [];
        // 空 writeFiles（request 未带 --write-files）时跳过子集校验——避免全量越界误报噪音
        if (allowed.length > 0) {
          const violations = committedFiles.filter(f => !allowed.some(a => f.startsWith(a.replace('*', ''))));
          if (violations.length > 0) {
            console.error('HANDOFF WARN: 提交文件超出 writeFiles 范围: ' + violations.join(', '));
          }
        }
      } catch {
        console.error('HANDOFF ERROR: commitHash 无效或 git show 失败: ' + commitHash);
      }
    } else if (typeof parsed === 'object' && parsed !== null && parsed.commitHash) {
      console.error('HANDOFF ERROR: commitHash 格式非法: ' + String(parsed.commitHash));
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
