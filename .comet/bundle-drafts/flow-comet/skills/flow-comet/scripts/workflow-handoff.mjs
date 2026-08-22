#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateStateFields, looksLikeObjectLiteral } from './state-schema.mjs';

// workflow-handoff.mjs: Record subagent handoff evidence
// evidence 统一记录在 subagent-execute 名下作为委托证据库——execute（串行委托）与 subagent-execute（并行委托）共用。不改成节点参数，保持最小改动。
// Usage:
//   node workflow-handoff.mjs request <task-id> <description> [--write-files <files...>]  -- record handoff request (W2-D: optional writeFiles allow-list)
//   node workflow-handoff.mjs result <task-id> <result-or-JSON>  -- record handoff result (W1-D: JSON Return Contract; W2-D: commitHash subset check; : completedChecks 规范化; redEvidence 时间顺序校验)
//   node workflow-handoff.mjs status                           -- show all handoff evidence

const runRoot = process.cwd();
const statePath = path.join(runRoot, '.comet', 'flow-comet-state.json');

async function fileExists(f) { try { await fs.access(f); return true; } catch { return false; } }

// 技能加载声明标记存在性（技能加载前置门·方案 A）：校验 .skill-loads/ 下
// 是否有该节点的声明标记 <node>-*.json（任一 skill 标记即算已声明——与 guard exit 侧
// 的 exit 协议声明标记校验、workflow-state record 前置门同构：按 <node>- 前缀扫描；
// 活动路径优先，归档路径兜底）。委托前置门在「先加载技能（Skill 工具）并 skill-load
// 声明」之前拦截"先干活后补声明"。诚实边界：标记是自我声明，非物理证明。
async function nodeSkillDeclared(nodeId, changeName) {
  if (!nodeId || !changeName) return false;
  const prefix = nodeId + '-';
  const scan = async (dir) => {
    try {
      const entries = await fs.readdir(dir);
      return entries.some((f) => f.startsWith(prefix) && f.endsWith('.json'));
    } catch {
      return false;
    }
  };
  const activeDir = path.join(runRoot, '.specs', changeName, '.skill-loads');
  if (await scan(activeDir)) return true;
  const archiveRoot = path.join(runRoot, '.specs', 'archive');
  const archiveEntries = await fs.readdir(archiveRoot).catch(() => []);
  for (const entry of archiveEntries) {
    if (!entry.endsWith('-' + changeName)) continue;
    if (await scan(path.join(archiveRoot, entry, '.skill-loads'))) return true;
  }
  return false;
}

// 契约解析失败判定（单一来源）：looksLikeObjectLiteral 由 state-schema.mjs 导出——
// trim 后以 {/[ 开头 → 视作"形似对象字面量"；若 JSON.parse 失败 → fail-closed。

// --json-file 路径校验:解析后必须位于项目根内(与 record 同规则——拒绝越界路径,
// 防读取任意文件内容进 evidence;runRoot 内绝对路径合法)。符号链接解析后的实际路径
// 同样必须在项目根内(词法校验不防 symlink 穿越——realpath 后再次校验)。
// 非字符串/空值(如 --json-file 为最后一个参数)→ 用法错误,与 record 同消息
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

// writeFiles 段感知 glob 匹配:按 / 分段,`*` 只匹配段内任意字符(不跨段);
// 精确条目要求完全相等(不用前缀匹配——src/foo 不得匹配 src/foobar);
// 段内含 * 的部分通配(如 src/*.test.js、src/*.mjs)转锚定正则匹配
function matchWriteFilePattern(file, pattern) {
  const f = String(file).replace(/\\/g, '/');
  const p = String(pattern).replace(/\\/g, '/');
  const fp = f.split('/');
  const pp = p.split('/');
  if (fp.length !== pp.length) return false;
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '*') continue;
    if (!pp[i].includes('*')) {
      if (pp[i] !== fp[i]) return false;
      continue;
    }
    // 段内 glob:`*` 匹配段内任意字符(不跨 /),其余字符字面匹配(锚定)
    const seg = new RegExp('^' + pp[i].split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*') + '$');
    if (!seg.test(fp[i])) return false;
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
    // 技能加载前置门（方案 A）：发起委托前校验 execute/subagent-execute
    // 本节点 skill-load 声明标记已存在（.skill-loads/<node>-*.json）——先加载节点技能（Skill 工具）
    // 并 skill-load 声明，再发起委托。缺失 → 新 change BLOCK / 旧 change 渐进 WARN。
    // 与零提交语义独立共存：本门只校验节点技能声明，不依赖任务 write_files 内容。
    const requestNode = state.currentNode;
    if (requestNode && (requestNode === 'execute' || requestNode === 'subagent-execute')) {
      const declared = await nodeSkillDeclared(requestNode, state.activeChange);
      if (!declared) {
        const loadGuide = '先加载技能（用 Skill 工具，禁止跳过）并运行 workflow-state.mjs skill-load ' + requestNode + ' <skill> 再发起委托';
        if (state.newChange === true) {
          console.error('BLOCKED: 节点 ' + requestNode + ' 缺少技能加载声明标记（.skill-loads/' + requestNode + '-*.json）——' + loadGuide);
          process.exit(1);
        }
        console.error('WARN: 节点 ' + requestNode + ' 缺少技能加载声明标记（.skill-loads/' + requestNode + '-*.json）——' + loadGuide + '（旧 change 渐进不阻断）');
      }
    }
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
      ...(writeFiles.length ? { writeFiles } : {}),
      // 零提交任务：写文件列表为空（无 tracked 写意图）→ request 记录 noCommit 标记，
      // 供 result 侧判定并跳过提交文件子集校验（正式语义，可审计）
      ...(writeFiles.length === 0 ? { noCommit: true } : {})
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
    try { parsed = JSON.parse(raw); } catch {
      // 契约解析失败 fail-closed:payload 形似对象但 JSON.parse 失败 → 报错并
      // process.exit(1),不写 handoffResult——Return Contract 应为合法 JSON
      // （旧语义把不可解析 raw 静默存字符串 = 静默落脏,guard exit 误报
      // "非 Return Contract"掩盖真因）
      // 消息按参数来源分级（设计语义 / AC-3）:--json-file 传入且文件内容损坏 →
      // "文件内容不是合法 JSON" + 长度元数据;内联传参损坏 → 保留 --json-file 建议。
      // 安全(bot 审查):错误消息与 workflow-state record 统一——只含固定前缀 +
      // 长度元数据,绝不打印 raw 内容(含截断)。
      if (looksLikeObjectLiteral(raw)) {
        if (jsonFile !== null) {
          console.error('文件内容不是合法 JSON (length=' + String(raw ?? '').length + ')');
        } else {
          console.error('payload looks like an object literal but is not valid JSON (length=' + String(raw ?? '').length + '); use --json-file <path> to pass the payload');
        }
        process.exit(1);
      }
    }
    state.evidence = state.evidence || {};
    state.evidence['subagent-execute'] = state.evidence['subagent-execute'] || {};
    state.evidence['subagent-execute'].handoffResult = state.evidence['subagent-execute'].handoffResult || {};
    // 零提交任务语义：已有 request 记录且其写文件列表为空（无 tracked 写意图）或带 noCommit
    // 标记时，判定为零提交——跳过提交文件子集校验并输出可审计提示。契约侧 noCommit 声明仅作
    // 审计线索：写文件列表非空的任务即使契约声称零提交，仍执行完整提交文件子集校验（不可借
    // 零提交声明绕过真实提交检查）。无 request 记录的任务不适用零提交（保持既有完整校验）。
    const handoffReq = state.evidence['subagent-execute'].handoffRequests?.[taskId];
    const hasRequest = !!handoffReq && typeof handoffReq === 'object';
    const reqWriteFiles = hasRequest ? (handoffReq.writeFiles || []) : [];
    const reqNoCommit = hasRequest && handoffReq.noCommit === true;
    const contractNoCommit = typeof parsed === 'object' && parsed !== null && parsed.noCommit === true;
    const isZeroCommit = hasRequest && (reqWriteFiles.length === 0 || reqNoCommit);
    if (isZeroCommit) {
      console.error('HANDOFF 零提交: ' + taskId + ' — 无 tracked 写文件（write_files 为空），已跳过提交文件子集校验');
      // 零提交边界收紧（bot 评审实证逃逸口）：声明零提交的结果若携带含 tracked 文件的提交，
      // 等于从「空 write_files」旁路逃逸——新 change BLOCK / 旧 change WARN。探测异常降级
      // WARN 不阻断（对齐 M4 提交对象确认提示先例）。
      const zeroHash = (typeof parsed === 'object' && parsed !== null && parsed.commitHash && /^[0-9a-f]{7,40}$/i.test(String(parsed.commitHash)))
        ? String(parsed.commitHash) : null;
      if (zeroHash) {
        const { execSync } = await import('child_process');
        let committed = null;
        let probeFail = false;
        try {
          const out = execSync('git show ' + zeroHash + ' --name-only --format=', { cwd: runRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          committed = out.split('\n').map((s) => s.trim()).filter(Boolean);
        } catch {
          probeFail = true;
        }
        if (probeFail) {
          console.error('HANDOFF WARN: ' + taskId + ' 零提交提交对象不可校验——按确认提示语义不阻断');
        } else if (committed.length > 0) {
          const msg = taskId + ' 声明零提交但提交携带 tracked 文件: ' + committed.join(', ');
          if (state.newChange === true) {
            console.error('BLOCKED: ' + msg + '——回退越界文件或改按常规任务申报 write_files');
            process.exit(1);
          }
          console.error('HANDOFF WARN: ' + msg + '（旧 change 渐进，不阻断）');
        } else {
          console.error('HANDOFF 零提交: ' + taskId + ' — 提交为空，校验通过');
        }
      }
    } else if (contractNoCommit) {
      console.error('HANDOFF WARN: ' + taskId + ' — 契约声明零提交但 write_files 非空，仍执行完整提交文件子集校验（零提交声明不能绕过真实提交检查）');
    }
    // W2-D: 完整版 hash 校验——提交文件 ⊆ writeFiles 允许范围（子集，段感知匹配；越界仅 WARN）。
    // 零提交任务已在上方跳过（并输出可审计提示），此处只处理有提交哈希的常规任务。
    if (typeof parsed === 'object' && parsed !== null && parsed.commitHash && /^[0-9a-f]{7,40}$/i.test(String(parsed.commitHash))) {
      const commitHash = String(parsed.commitHash);
      if (!isZeroCommit) {
        const { execSync } = await import('child_process');
        try {
          const out = execSync(`git show ${commitHash} --name-only --format=`, { cwd: runRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          const committedFiles = out.split('\n').map(s => s.trim()).filter(Boolean);
          // 段感知精确匹配(writeFiles 条目按路径段 glob——src/foo 不匹配 src/foobar,
          // src/*.test.js 只匹配 src/ 下一层);*-SUMMARY.md 豁免收窄为精确的任务摘要路径
          // (.specs/<change-id>/<task-id>-SUMMARY.md——flow-comet 强制产物,非越界)
          const summaryExact = '.specs/' + state.activeChange + '/' + taskId + '-SUMMARY.md';
          const violations = committedFiles.filter(f => f !== summaryExact && !reqWriteFiles.some(a => matchWriteFilePattern(f, a)));
          if (violations.length > 0) {
            const currentState = await readState();
            if (currentState?.newChange === true) {
              console.error('BLOCKED: 提交文件超出 writeFiles 范围: ' + violations.join(', ') + '——新 change 强制委托边界;恢复: 回退越界文件或扩展 write_files');
              process.exit(1);
            }
            console.error('HANDOFF WARN: 提交文件超出 writeFiles 范围: ' + violations.join(', '));
          }
        } catch {
          console.error('HANDOFF ERROR: commitHash 无效或 git show 失败: ' + commitHash + '——协调者需确认原因(跨仓库 worktree 提交校验降级属预期,确认后继续)');
        }
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
