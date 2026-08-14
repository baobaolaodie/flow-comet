#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateStateFields } from './state-schema.mjs';

// workflow-handoff.mjs: Record subagent handoff evidence
// evidence 统一记录在 subagent-execute 名下作为委托证据库——execute（串行委托）与 subagent-execute（并行委托）共用。不改成节点参数，保持最小改动。
// Usage:
//   node workflow-handoff.mjs request <task-id> <description> [--write-files <files...>]  -- record handoff request (W2-D: optional writeFiles allow-list)
//   node workflow-handoff.mjs result <task-id> <result-or-JSON>  -- record handoff result (W1-D: JSON Return Contract; W2-D: commitHash subset check; : completedChecks 规范化; redEvidence 时间顺序校验)
//   node workflow-handoff.mjs status                           -- show all handoff evidence

const runRoot = process.cwd();
const statePath = path.join(runRoot, '.comet', 'flow-comet-state.json');

async function fileExists(f) { try { await fs.access(f); return true; } catch { return false; } }

// --json-file 路径校验:解析后必须位于项目根内(与 record 同规则——拒绝越界路径,
// 防读取任意文件内容进 evidence;runRoot 内绝对路径合法)。符号链接解析后的实际路径
// 同样必须在项目根内(词法校验不防 symlink 穿越——realpath 后再次校验)
async function resolveJsonFileWithinRunRoot(jsonFile) {
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

// writeFiles 段感知 glob 匹配:按 / 分段,`*` 只匹配单段(不跨段);精确条目要求完全相等
// (不再用前缀匹配——src/foo 不得匹配 src/foobar;src/*.test.js 只匹配 src/ 下一层)
function matchWriteFilePattern(file, pattern) {
  const f = String(file).replace(/\\/g, '/');
  const p = String(pattern).replace(/\\/g, '/');
  const fp = f.split('/');
  const pp = p.split('/');
  if (fp.length !== pp.length) return false;
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '*') continue;
    if (pp[i] !== fp[i]) return false;
  }
  return true;
}

async function readState() {
  if (await fileExists(statePath)) return JSON.parse(await fs.readFile(statePath, 'utf8'));
  return { activeChange: null, currentNode: null, completedNodes: [], evidence: {} };
}

async function writeState(state) {
  // 内置节点常量: 与 workflow-state.mjs C6 同构——写入前校验已知字段类型（fail-closed），非法 → BLOCKED + exit 1
  const bad = validateStateFields(state);
  if (bad.length) {
    console.error('BLOCKED: state 字段类型非法: ' + bad[0]);
    process.exit(1);
  }
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
    // 若未显式传 --write-files，从 TASK.md 自动解析（orchestrator 无需手动提取文件列表）
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
    // --json-file <path>(或 --json-file=<path>):从文件读 JSON payload——与 record 对齐,
    // 规避 Windows PowerShell 剥离内嵌双引号导致 JSON 损坏(存成脏字符串)
    let jsonFile = null;
    const resultArgs = [];
    const rawArgs = process.argv.slice(4);
    for (let i = 0; i < rawArgs.length; i++) {
      const arg = rawArgs[i];
      if (arg === '--json-file') { jsonFile = rawArgs[i + 1]; i += 1; continue; }
      if (typeof arg === 'string' && arg.startsWith('--json-file=')) { jsonFile = arg.slice('--json-file='.length); continue; }
      resultArgs.push(arg);
    }
    let raw = resultArgs.join(' ');
    if (jsonFile !== null) {
      raw = await fs.readFile(await resolveJsonFileWithinRunRoot(jsonFile), 'utf8');
    }
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
        // 新 change 空允许列表 → BLOCK:委托边界必须有解析来源(TASK.md 的 write_files 或
        // request 显式 --write-files)——空列表跳过校验会让新 change 绕过写边界检查
        if (allowed.length === 0 && state?.newChange === true) {
          console.error('BLOCKED: 委托 ' + taskId + ' 的 write_files 允许列表为空——新 change 强制委托边界(检查 TASK.md 的 write_files 或 request 显式传 --write-files)');
          process.exit(1);
        }
        // 旧 change 空允许列表:保持跳过(兼容路径,避免历史噪音)
        if (allowed.length > 0) {
          // 段感知精确匹配(writeFiles 条目按路径段 glob——src/foo 不匹配 src/foobar,
          // src/*.test.js 只匹配 src/ 下一层);*-SUMMARY.md 豁免收窄为精确的任务摘要路径
          // (.specs/<change-id>/<task-id>-SUMMARY.md——flow-comet 强制产物,非越界)
          const summaryExact = '.specs/' + state.activeChange + '/' + taskId + '-SUMMARY.md';
          const violations = committedFiles.filter(f => f !== summaryExact && !allowed.some(a => matchWriteFilePattern(f, a)));
          if (violations.length > 0) {
            const currentState = await readState();
            if (currentState?.newChange === true) {
              console.error('BLOCKED: 提交文件超出 writeFiles 范围: ' + violations.join(', ') + '——新 change 强制委托边界;恢复: 回退越界文件或扩展 write_files');
              process.exit(1);
            }
            console.error('HANDOFF WARN: 提交文件超出 writeFiles 范围: ' + violations.join(', '));
          }
        }
      } catch {
        console.error('HANDOFF ERROR: commitHash 无效或 git show 失败: ' + commitHash + '——协调者需确认原因(跨仓库 worktree 提交校验降级属预期,确认后继续)');
      }
    } else if (typeof parsed === 'object' && parsed !== null && parsed.commitHash) {
      console.error('HANDOFF ERROR: commitHash 格式非法: ' + String(parsed.commitHash) + '——协调者需确认原因并记录(提交对象不可校验时,确认后继续)');
    }
    // redEvidence 时间顺序校验——重新 result 已存在 taskId 且该 task 已有 greenEvidence
    // 而无 redEvidence 时，新增 redEvidence 属于事后补录（TDD 要求 RED 先于 GREEN）→ BLOCKED。
    // 同批一次性回传 red+green 不受影响；已存在 redEvidence 的记录重录（补 green）同样不受影响
    const existing = state.evidence['subagent-execute'].handoffResult[taskId];
    if (existing && typeof existing.result === 'object' && existing.result !== null) {
      const old = existing.result;
      const hasGreen = !!(old.greenEvidence && typeof old.greenEvidence === 'object' && old.greenEvidence.command);
      const hasRed = !!(old.redEvidence && typeof old.redEvidence === 'object' && old.redEvidence.command);
      const newRed = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        && parsed.redEvidence && typeof parsed.redEvidence === 'object' && parsed.redEvidence.command;
      if (hasGreen && !hasRed && newRed) {
        console.error('BLOCKED: ' + taskId + ' redEvidence 事后补录（已记录 greenEvidence 而无 redEvidence——TDD 要求 RED 先于 GREEN，禁止事后补录掩盖缺 RED）');
        process.exit(1);
      }
    }
    // 解析 Return Contract 的 completedChecks 字段（数组），缺省记 []——规范化后随
    // result 一起存储，status 输出自然包含 completedChecks；guard W1-D 对条目做严格校验（
    // required-skill:subagent-execute.<skill>，无旧 change 豁免），此处不拦截只规范化
    // redEvidence/greenEvidence 写入 evidence 时附带 recordedAt 时间戳（时间顺序可
    // 审计；重录时保留同 key 首次记录时间，避免补录覆盖原始 RED/GREEN 时序）
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      parsed.completedChecks = Array.isArray(parsed.completedChecks) ? parsed.completedChecks : [];
      const now = new Date().toISOString();
      for (const key of ['redEvidence', 'greenEvidence']) {
        const ev = parsed[key];
        if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
          const prior = existing && typeof existing.result === 'object' && existing.result !== null
            && existing.result[key] && typeof existing.result[key] === 'object'
            && typeof existing.result[key].recordedAt === 'string'
            ? existing.result[key].recordedAt
            : null;
          parsed[key] = { ...ev, recordedAt: prior ?? now };
        }
      }
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
