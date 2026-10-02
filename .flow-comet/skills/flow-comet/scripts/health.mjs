#!/usr/bin/env node
// health.mjs — 横向命令 health（技能 flow-comet-health）的确定性收集器
//
// 报告分层：
//   · 确定性层：文件 / 结构可判项——项目上下文段与格式、经验条目编号连续性、技术债表项数、
//     可选工具在场判定、版本历史统计。每项都带计数与判据；同一冻结树两次运行逐字节一致。
//   · 增补层：代码体检工具（brooks-lint）在场时，由 agent 执行其 4 维体检并把结果并入同一份
//     报告、标注来源；脚本不执行 agent 技能，缺省保留占位而不伪造结论。
//   · 降级声明：可选外部工具不在场时显式声明原因。判据只锚「确定性层完整 + 降级声明可见」——
//     环境缺可选工具不构成失败（这些工具是可选项，不是依赖）。
//
// 只读边界：
//   · 读：.specs/CONTEXT.md、.specs/LESSONS.md、.specs/health/*.md（基线）、git 历史、
//     可选工具的在场探测（文件 / 路径判定）；
//   · 写：仅一份报告 .specs/health/<日期>-HEALTH.md；--stdout 时把同一份内容原样打到标准输出；
//   · 不写运行状态（不触碰 .flow-comet/flow-comet-state.json，不新增任何状态字段）；
//   · 时间一律走 time-utils.mjs 单一来源（本地时间 + 显式偏移），不在本文件内联第二份格式化。
//
// 复现性纪律：报告中的「机器可判项」必须可逐字节复现；两次运行允许不同的行由报告末尾的
// 「易变行声明」逐条列出（差异集合显式标注，不靠口头约定）。基线对比取「最近一份**日期不同**的
// 历史报告」——同日重跑不与自己对比，否则报告自我污染、复现性判据失效。

import { execFileSync } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateContext } from './context-init.mjs';
import { parseSideCommandArgs } from './evolve.mjs';
import { formatLocalDate, formatLocalTimestamp } from './time-utils.mjs';

const SELF_FILE = fileURLToPath(import.meta.url);
const SELF_DIR = path.dirname(SELF_FILE);

const CONTEXT_DISPLAY = '.specs/CONTEXT.md';
const LESSONS_DISPLAY = '.specs/LESSONS.md';
const HEALTH_DIR_DISPLAY = '.specs/health';
const REPORT_SUFFIX = '-HEALTH.md';
const REPORT_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

const GIT_TIMEOUT_MS = 20000;
const TOOL_TIMEOUT_MS = 120000;

// 条目编号标题：`### L-<三位数字>`（后接非数字 / 非字母，避免吞掉更长编号）
const LESSON_HEADING = /^### L-(\d{3})(?![\dA-Za-z])/;
// 技术债段标题（层级放宽到二~四级，容忍项目侧标题层级差异）
const DEBT_HEADING = /^#{2,4}[ \t]*技术债/;
// 表格分隔行（`|---|---|`）：表项计数须排除它，否则每张表多算一行
const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/;
// 提交主题的约定式类型前缀（`type(scope): subject` / `type!: subject`）
const COMMIT_KIND = /^([a-z][a-z-]*)(?:\([^)]*\))?!?:/;
// 快照行（`key=value`）：下份报告据此做增量对比
const SNAPSHOT_LINE = /^([a-z0-9_.]+)=(.*)$/;

const DEBT_ITEM_LIMIT = 20;
const KIND_ITEM_LIMIT = 12;

// 冗余工具探面（顺序固定：报告行序与快照判定随之稳定）。主语言首选项可执行，其余登记在场状态。
const REDUNDANCY_TOOLS = [
  { name: 'jscpd', dimension: '字面重复块（全语言）', runnable: true },
  { name: 'knip', dimension: '未用导出 / 孤立文件（JS / TS）', runnable: false },
  { name: 'ts-prune', dimension: '未用导出（TS）', runnable: false },
  { name: 'depcheck', dimension: '未用依赖（JS / TS）', runnable: false },
  { name: 'vulture', dimension: '死代码 / 未用导出（Python）', runnable: false },
];
const REDUNDANCY_TARGET_DIRS = ['src', 'lib', 'app', 'packages', 'scripts'];
const TOOL_PROBE_NOTE = '探面：`node_modules/.bin/` 与 `PATH`';

// 代码体检工具（brooks-lint）探测面：用户级缓存 / 用户技能目录 + 项目内三平台技能目录 + 可执行文件。
// 逐项判定并全部写进报告——「不在场」的结论必须能看到探测面，不能只给一句断言。
const BROOKS_SKILL = 'brooks-health';

function usage() {
  return [
    '用法: node health.mjs [--root <项目根>] [--stdout] [--help]',
    '  --root <路径>  项目根（缺省 = 当前目录；`--root=<路径>` 等号形等价）',
    '  --stdout       报告同时写到标准输出（与落盘内容逐字节相同）',
    '  --help, -h     打印本用法后退出（不产报告）',
    '说明: 只写 .specs/health/<日期>-HEALTH.md；不写运行状态、不改代码。',
  ].join('\n');
}

// 参数解析走侧命令共用的单一实现（evolve.mjs 导出的 parseSideCommandArgs）：`--root` 两种形态 /
// `--stdout` / `--help` / 未知参数各只在一处表达，三条横向命令的 CLI 契约因此同形。
// rootDisplay = 调用方原样给出的 --root 取值（报告里按人读形态回显与复现命令用）。
function parseArgs(argv) {
  const options = parseSideCommandArgs(argv, { usage: usage() });
  options.rootDisplay = options.rootArg ?? '.';
  return options;
}

async function fileExists(file) {
  if (!file) return false;
  try { await fs.access(file); return true; } catch { return false; }
}

async function readTextIfExists(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return null; }
}

// 报告内路径显示：项目根内用相对路径（跨机器稳定），用户主目录内用 `~` 简写，其余原样（正斜杠）。
function displayPath(runRoot, target) {
  const rel = path.relative(runRoot, target);
  if (rel === '') return '.';
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return './' + rel.split(path.sep).join('/');
  const homeRel = path.relative(os.homedir(), target);
  if (homeRel && !homeRel.startsWith('..') && !path.isAbsolute(homeRel)) return '~/' + homeRel.split(path.sep).join('/');
  return target.split(path.sep).join('/');
}

// ---------- 确定性层 1：项目上下文（CONTEXT.md）一致性 ----------
// 段清单与格式检查复用 context-init.mjs 的 validateContext（单一实现，不复制第二份判据）。
async function collectContext(runRoot) {
  const text = await readTextIfExists(path.join(runRoot, '.specs', 'CONTEXT.md'));
  const { missingSections, formatIssues } = await validateContext(runRoot);
  return {
    exists: text !== null,
    lineCount: text === null ? 0 : text.split('\n').length,
    missingSections: [...missingSections],
    formatIssues: [...formatIssues],
  };
}

// ---------- 确定性层 2：经验条目（LESSONS.md）编号连续性 ----------
function collectLessons(text) {
  const empty = { exists: text !== null, entries: 0, min: null, max: null, missing: [], duplicates: [] };
  if (text === null) return empty;
  const numbers = [];
  for (const line of text.split('\n')) {
    const m = LESSON_HEADING.exec(line);
    if (m) numbers.push(Number(m[1]));
  }
  if (numbers.length === 0) return empty;
  const seen = new Set(numbers);
  const duplicates = [...new Set(numbers.filter((n) => numbers.indexOf(n) !== numbers.lastIndexOf(n)))].sort((a, b) => a - b);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const missing = [];
  for (let n = min; n <= max; n += 1) if (!seen.has(n)) missing.push(n);
  return { exists: true, entries: numbers.length, min, max, missing, duplicates };
}

function formatLessonId(n) {
  return 'L-' + String(n).padStart(3, '0');
}

// 编号压缩：连续段写 `L-aaa~L-bbb`，单点写 `L-aaa`（长缺失清单也能一行读完）
function compressRanges(numbers) {
  if (numbers.length === 0) return '无';
  const parts = [];
  let start = numbers[0];
  let previous = numbers[0];
  for (let i = 1; i < numbers.length; i += 1) {
    const current = numbers[i];
    if (current === previous + 1) { previous = current; continue; }
    parts.push(start === previous ? formatLessonId(start) : formatLessonId(start) + '~' + formatLessonId(previous));
    start = current;
    previous = current;
  }
  parts.push(start === previous ? formatLessonId(start) : formatLessonId(start) + '~' + formatLessonId(previous));
  return parts.join(', ');
}

// ---------- 确定性层 3：技术债表项数 ----------
function collectDebt(text) {
  if (text === null) return { exists: false, rows: 0, items: [] };
  const lines = text.split('\n');
  const start = lines.findIndex((line) => DEBT_HEADING.test(line));
  if (start === -1) return { exists: false, rows: 0, items: [] };
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,4}[ \t]/.test(line) || /^-{3,}[ \t]*$/.test(line)) break;
    body.push(line);
  }
  const tableRows = body.map((line) => line.trim()).filter((line) => line.startsWith('|'));
  const contentRows = tableRows.filter((line) => !TABLE_SEPARATOR.test(line));
  const dataRows = contentRows.slice(1); // 首行 = 表头
  const items = dataRows
    .map((line) => (line.split('|')[1] ?? '').trim().replaceAll('`', ''))
    .filter((item) => item.length > 0);
  return { exists: true, rows: dataRows.length, items };
}

// ---------- 确定性层 4：冗余工具在场判定（+ 首选项在场则跑） ----------
function findOnPath(name) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter((dir) => dir.length > 0);
  const extensions = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : [''];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function probeTool(runRoot, name) {
  const localNames = process.platform === 'win32' ? [name + '.cmd', name + '.exe', name] : [name];
  for (const localName of localNames) {
    const candidate = path.join(runRoot, 'node_modules', '.bin', localName);
    if (await fileExists(candidate)) return candidate;
  }
  return findOnPath(name);
}

async function collectRedundancy(runRoot) {
  const targets = [];
  for (const dir of REDUNDANCY_TARGET_DIRS) {
    if (await fileExists(path.join(runRoot, dir))) targets.push(dir);
  }
  const tools = [];
  for (const tool of REDUNDANCY_TOOLS) {
    tools.push({ ...tool, path: await probeTool(runRoot, tool.name), reading: null, reason: null });
  }
  const primary = tools.find((tool) => tool.runnable && tool.path);
  if (!primary) return { targets, tools, run: null };
  if (targets.length === 0) {
    return { targets, tools, run: { status: 'degraded', reason: '无可扫源码目录（探面：' + REDUNDANCY_TARGET_DIRS.join(' / ') + '）' } };
  }
  return { targets, tools, run: await runJscpd(runRoot, primary.path, targets) };
}

// 首选工具（全语言 · 字面重复块）在场才跑；输出目录落在系统临时区并在结束时清理，不在项目内留产物。
// 跑不起来（版本差异 / 平台包装器限制 / 超时）→ 记降级原因，不中断报告。
async function runJscpd(runRoot, toolPath, targets) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-comet-health-'));
  try {
    execFileSync(toolPath, [
      ...targets,
      '--min-lines', '5',
      '--min-tokens', '50',
      '--reporters', 'json',
      '--output', outDir,
      '--silent',
    ], { cwd: runRoot, timeout: TOOL_TIMEOUT_MS, stdio: ['ignore', 'ignore', 'pipe'] });
    const raw = await fs.readFile(path.join(outDir, 'jscpd-report.json'), 'utf8');
    const total = JSON.parse(raw)?.statistics?.total ?? {};
    return {
      status: 'ok',
      clones: Number(total.clones ?? 0),
      duplicatedLines: Number(total.duplicatedLines ?? 0),
      percentage: Number(total.percentage ?? 0),
      targets,
    };
  } catch (error) {
    return { status: 'degraded', reason: '工具在场但运行未完成（' + String(error.message).split('\n')[0] + '）' };
  } finally {
    try { await fs.rm(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); } catch { /* 临时区清理失败不影响报告 */ }
  }
}

// ---------- 确定性层 5：版本历史统计（git） ----------
function runGit(runRoot, args) {
  try {
    return execFileSync('git', args, { cwd: runRoot, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function collectGit(runRoot) {
  if (runGit(runRoot, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return { isRepo: false, commits: null, head: null, headDate: null, kinds: [], recent: null };
  }
  const commits = runGit(runRoot, ['rev-list', '--count', 'HEAD']);
  const headLine = runGit(runRoot, ['log', '-1', '--pretty=%h|%cI']);
  const subjects = runGit(runRoot, ['log', '--pretty=%s']);
  const recent = runGit(runRoot, ['rev-list', '--count', '--since=30.days.ago', 'HEAD']);
  const counts = new Map();
  for (const subject of (subjects ?? '').split('\n')) {
    const m = COMMIT_KIND.exec(subject.trim());
    const kind = m ? m[1] : '（其它）';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const kinds = [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => (b.count - a.count) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  const [head, headDate] = (headLine ?? '').split('|');
  return {
    isRepo: true,
    commits: commits === null ? null : Number(commits),
    head: head || null,
    headDate: headDate || null,
    kinds,
    recent: recent === null ? null : Number(recent),
  };
}

// ---------- 增补层：代码体检工具在场探测 ----------
async function collectBrooks(runRoot) {
  const probes = [
    { label: 'Claude Code 插件缓存（用户级）', target: path.join(os.homedir(), '.claude', 'plugins', 'cache', 'brooks-lint-marketplace') },
    { label: 'Codex 用户技能目录', target: path.join(os.homedir(), '.codex', 'skills', BROOKS_SKILL) },
    { label: '项目技能目录（Claude Code）', target: path.join(runRoot, '.claude', 'skills', BROOKS_SKILL) },
    { label: '项目技能目录（Codex）', target: path.join(runRoot, '.agents', 'skills', BROOKS_SKILL) },
    { label: '项目技能目录（dsh）', target: path.join(runRoot, '.dsh', 'skills', BROOKS_SKILL) },
    { label: '可执行文件（PATH）', target: findOnPath(BROOKS_SKILL) },
  ];
  const resolved = [];
  for (const probe of probes) {
    resolved.push({ label: probe.label, display: probe.target ? displayPath(runRoot, probe.target) : null, hit: await fileExists(probe.target) });
  }
  return { present: resolved.some((probe) => probe.hit), probes: resolved };
}

// ---------- 基线：最近一份「日期不同」的历史报告 + 其读数快照 ----------
// 报告文件名约定（日期前缀 + 固定后缀）只在本函数里表达一次，避免与写盘路径各写一份字面量。
function reportDateOf(name) {
  if (!name.endsWith(REPORT_SUFFIX)) return null;
  const m = REPORT_DATE_PREFIX.exec(name);
  return m ? m[1] : null;
}

async function readBaseline(runRoot, currentDate) {
  const dir = path.join(runRoot, '.specs', 'health');
  let names;
  try { names = await fs.readdir(dir); } catch { return null; }
  const candidates = names
    .map((name) => ({ name, date: reportDateOf(name) }))
    .filter((entry) => entry.date !== null && entry.date !== currentDate)
    .map((entry) => entry.name)
    .sort();
  if (candidates.length === 0) return null;
  const name = candidates[candidates.length - 1];
  const text = await readTextIfExists(path.join(dir, name));
  if (text === null) return null;
  return { name, snapshot: parseSnapshot(text) };
}

function parseSnapshot(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith('## 读数快照'));
  if (start === -1) return {};
  const values = {};
  let fenced = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^## /.test(line)) break;
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    if (!fenced) continue;
    const m = SNAPSHOT_LINE.exec(line);
    if (m) values[m[1]] = m[2];
  }
  return values;
}

// ---------- 报告 ----------
// 报告按「一段一函数」拼装：每个渲染器只读自己那一段的读数并向输出追加行，
// 段落增删互不影响（也避免出现跨越整份报告的单一长函数）。
function renderHeader(push, input) {
  const { options, selfDisplay, date, timestamp } = input;
  push('# 健康巡检 · ' + date, '');
  push('- **报告文件**：`' + HEALTH_DIR_DISPLAY + '/' + date + REPORT_SUFFIX + '`');
  push('- **生成时间**：' + timestamp + '（易变行 · 见「易变行声明」）');
  push('- **扫描根**：`' + options.rootDisplay + '`');
  push('- **复现命令**：`node ' + selfDisplay + ' --root ' + options.rootDisplay + ' --stdout`');
  push('- **写入边界**：只写本报告文件；不改代码、不写运行状态文件（本命令不新增任何状态字段）');
  push('- **报告分层**：确定性层（机器可判 · 逐项带计数与判据）｜增补层（代码体检工具 4 维结果 · 可选）｜降级声明');
  push('- **判据**：只锚「确定性层完整 + 降级声明可见」——环境缺可选外部工具不构成失败', '');

  push('## 确定性层（机器可判）', '');
}

function renderContextSection(push, context, selfDirDisplay) {
  push('### 1 · 项目上下文一致性', '');
  push('- 文件：`' + CONTEXT_DISPLAY + '`（' + (context.exists ? '在场' : '缺失') + '）');
  push('- 文件行数：' + context.lineCount);
  push('- 缺失段（' + context.missingSections.length + '）：' + (context.missingSections.length === 0 ? '无' : context.missingSections.join(' · ')));
  push('- 格式问题（' + context.formatIssues.length + '）：' + (context.formatIssues.length === 0 ? '无' : context.formatIssues.join(' · ')));
  push('- 判据：段清单与格式检查复用 `context-init.mjs` 的校验导出（单一实现）；段清单由 `flow-kit/templates/CONTEXT.md` 派生，模板缺席时用内置七段基准');
  push('- 复现命令：`node --input-type=module -e "import {validateContext} from \'' + selfDirDisplay + '/context-init.mjs\'; const r=await validateContext(process.cwd()); console.log(JSON.stringify({missingSections:r.missingSections,formatIssues:r.formatIssues}))"`', '');
}

function renderLessonsSection(push, lessons) {
  push('### 2 · 经验条目编号连续性', '');
  push('- 文件：`' + LESSONS_DISPLAY + '`（' + (lessons.exists ? '在场' : '缺失') + '）');
  push('- 条目数：' + lessons.entries);
  push('- 编号区间：' + (lessons.min === null ? '无条目' : formatLessonId(lessons.min) + '~' + formatLessonId(lessons.max)));
  push('- 缺失编号（' + lessons.missing.length + '）：' + compressRanges(lessons.missing));
  push('- 重复编号（' + lessons.duplicates.length + '）：' + (lessons.duplicates.length === 0 ? '无' : lessons.duplicates.map(formatLessonId).join(', ')));
  push('- 判据：条目 = 行首 `### L-<三位数字>`（后接非数字 / 非字母）；缺失 = 区间内未出现的编号（压缩为区间写法）');
  push('- 复现命令：`grep -cE \'^### L-[0-9]{3}([^0-9A-Za-z]|$)\' ' + LESSONS_DISPLAY + '`', '');
}

function renderDebtSection(push, debt) {
  push('### 3 · 技术债表项数', '');
  push('- 段：`' + CONTEXT_DISPLAY + '` 的技术债段（' + (debt.exists ? '在场' : '缺失') + '）');
  push('- 表项数：' + debt.rows);
  if (debt.items.length > 0) {
    for (const item of debt.items.slice(0, DEBT_ITEM_LIMIT)) push('  - ' + item);
    if (debt.items.length > DEBT_ITEM_LIMIT) push('  - ……（仅列前 ' + DEBT_ITEM_LIMIT + ' 项，共 ' + debt.items.length + ' 项）');
  }
  push('- 判据：段内表格数据行计数（排除表头与分隔行）；段边界 = 下一个标题或分隔线');
  push('- 复现命令：`sed -n \'/^### 技术债/,/^---/p\' ' + CONTEXT_DISPLAY + ' | grep -c \'^|\'`（含表头与分隔行，减去 2 即表项数）', '');
}

function renderRedundancySection(push, redundancy, options, selfDisplay) {
  push('### 4 · 冗余扫描（可选工具 · 在场则跑）', '');
  push('- 源码目录探面：' + REDUNDANCY_TARGET_DIRS.map((dir) => '`' + dir + '`').join(' / ') + '（存在者才纳入扫描：' + (redundancy.targets.length === 0 ? '无' : redundancy.targets.map((dir) => '`' + dir + '`').join(' · ')) + '）');
  push('- 工具在场判定（' + TOOL_PROBE_NOTE + '）：', '');
  push('| 工具 | 维度 | 在场 | 读数 / 降级原因 |');
  push('|---|---|---|---|');
  for (const tool of redundancy.tools) {
    const reading = tool.runnable && tool.path && redundancy.run
      ? (redundancy.run.status === 'ok'
        ? '克隆块 ' + redundancy.run.clones + ' · 重复行 ' + redundancy.run.duplicatedLines + ' · 重复率 ' + redundancy.run.percentage + '%（目标：' + redundancy.run.targets.join(' ') + '）'
        : '未采集——' + redundancy.run.reason)
      : null;
    const cell = tool.path
      ? (reading ?? '在场但本次未采集（无稳定机读输出契约——由技能侧人工并入增补层）')
      : '未采集——' + TOOL_PROBE_NOTE + ' 均未命中';
    push('| `' + tool.name + '` | ' + tool.dimension + ' | ' + (tool.path ? '在场：`' + displayPath(options.root, tool.path) + '`' : '不在场') + ' | ' + cell + ' |');
  }
  push('');
  push('- 判据：在场判定 = 文件 / 路径可判（确定性）；读数由工具输出承担，未在场即记降级原因');
  push('- 复现命令：`node ' + selfDisplay + ' --root ' + options.rootDisplay + ' --stdout`（在场判定随环境变化，同一环境内可复现）', '');
}

function renderGitSection(push, git) {
  push('### 5 · 版本历史统计（git）', '');
  if (!git.isRepo) {
    push('- git 仓库：否——历史统计缺省（显式声明，不静默省略）');
  } else {
    push('- git 仓库：是');
    push('- 提交总数：' + (git.commits === null ? '不可判（HEAD 无法解析）' : git.commits));
    push('- 当前提交：' + (git.head ? '`' + git.head + '`（提交时间 ' + git.headDate + '）' : '不可判'));
    const kinds = git.kinds.slice(0, KIND_ITEM_LIMIT).map((entry) => entry.kind + ' ' + entry.count).join(' · ');
    push('- 提交类型分布：' + (kinds || '不可判') + (git.kinds.length > KIND_ITEM_LIMIT ? ' · ……（共 ' + git.kinds.length + ' 类）' : ''));
    push('- 最近 30 天提交数：' + (git.recent === null ? '不可判' : git.recent) + '（易变行 · 见「易变行声明」）');
    push('- 判据：类型前缀取提交主题的 `type(scope):` 形态，其余归「（其它）」；计数降序、同数按名称升序');
    push('- 复现命令：`git rev-list --count HEAD` · `git log --pretty=%s`');
  }
  push('');
}

function renderSupplementSection(push, brooks) {
  push('## 增补层（代码体检工具的 4 维结果 · 可选）', '');
  push('- **在场判定**：' + (brooks.present ? '在场' : '不在场——下列探测面逐项未命中（未安装 / 未加载）'));
  push('- **探测面（固定清单 · 逐项判定）**：');
  for (const probe of brooks.probes) {
    push('  - ' + (probe.hit ? '在场' : '不在场') + ' · ' + probe.label + '：' + (probe.display ? '`' + probe.display + '`' : '（未命中）'));
  }
  if (brooks.present) {
    push('- **取用方式**：agent 执行 `' + BROOKS_SKILL + '` 技能后，把 4 维结果**并入本段**（同一份报告，不另开文件）');
    push('- **来源标注（必填）**：`来源：' + BROOKS_SKILL + '（brooks-lint · <命中落点>）`');
  } else {
    push('- **降级**：4 维结果缺省；报告只由确定性层构成（判据不因缺可选工具而失败）');
  }
  push('- **4 维结果槽**（脚本不执行 agent 技能；未填充时保留占位，不伪造结论）：');
  push('  - 代码质量（生产代码风险分布）：');
  push('  - 架构（分层 / 依赖）：');
  push('  - 技术债（Pain × Spread 优先级）：');
  push('  - 测试质量：');
  push('');
}

function renderDegradationSection(push, redundancy, brooks) {
  const brooksLine = brooks.present
    ? '- **brooks-lint**：在场（见增补层探测面）——4 维结果由 agent 执行 `' + BROOKS_SKILL + '` 后并入并标注来源；未并入时本报告只含确定性层'
    : '- **brooks-lint**：不可用——探测面逐项未命中（未安装 / 未加载）；降级为内置确定性子集，4 维结果缺省';
  const jscpdTool = redundancy.tools.find((tool) => tool.name === 'jscpd');
  const jscpdLine = jscpdTool.path
    ? '- **jscpd**：在场——字面重复块读数见「冗余扫描」段'
    : '- **jscpd**：不在场（' + TOOL_PROBE_NOTE + '）——字面重复块未采集；建议 `npx jscpd <源码目录> --min-lines 5 --min-tokens 50` 后人工并入增补层';
  const others = redundancy.tools.filter((tool) => tool.name !== 'jscpd' && !tool.path).map((tool) => tool.name);
  push('## 降级声明', '');
  push(brooksLine);
  push(jscpdLine);
  if (others.length > 0) {
    push('- **' + others.join(' / ') + '**：不在场——未用导出 / 未用依赖 / 死代码维度未采集（按主语言选装其一即可）');
  }
  push('- **判据**：只锚「确定性层完整 + 降级声明可见」；上述工具均为**可选外部工具**（不构成依赖），缺席不影响本命令成功（退出码 0）');
  push('');
}

function renderSnapshotSection(push, snapshot) {
  push('## 读数快照（机器可读 · 供下次报告对比）', '');
  push('```text');
  for (const entry of snapshot) push(entry.key + '=' + entry.value);
  push('```', '');
}

function renderBaselineSection(push, baseline, snapshot) {
  push('## 与上次对比', '');
  if (!baseline) {
    push('- 基线：无（`' + HEALTH_DIR_DISPLAY + '` 下无日期不同的历史报告）——本次为该域首份报告，显式声明「无差异可比」，不静默省略');
  } else {
    push('- 基线：`' + HEALTH_DIR_DISPLAY + '/' + baseline.name + '`（取最近一份**日期不同**的历史报告——同日重跑不与自己对比，否则报告自我污染）');
    for (const entry of snapshot) {
      const previous = baseline.snapshot[entry.key];
      if (previous === undefined) { push('- `' + entry.key + '`：' + entry.value + '（基线无此读数）'); continue; }
      if (previous === entry.value) { push('- `' + entry.key + '`：' + previous + ' → ' + entry.value + '（无变化）'); continue; }
      const before = Number(previous);
      const after = Number(entry.value);
      const trend = Number.isFinite(before) && Number.isFinite(after)
        ? (after > before ? '（↑ ' + (after - before) + '）' : '（↓ ' + (before - after) + '）')
        : '（已变更）';
      push('- `' + entry.key + '`：' + previous + ' → ' + entry.value + trend);
    }
  }
  push('');
}

function renderVolatilitySection(push, selfDisplay, options) {
  push('## 易变行声明（两次运行的允许差异集合）', '');
  push('同一冻结树连续两次运行，除下列差异集合外，其余行（即全部机器可判项）逐字节一致：');
  push('1. 以 `- **生成时间**：` 开头的行（时刻本身）');
  push('2. 以 `- 最近 30 天提交数：` 开头的行（相对当前时刻滑动的统计窗口）');
  push('3. 报告文件名中的日期分量与「与上次对比」的基线选择（跨日运行时才会变化）');
  push('');
  push('验证方式：`node ' + selfDisplay + ' --root ' + options.rootDisplay + ' --stdout` 连续两次的差异应仅落在上述集合内。');
}

function renderReport(input) {
  const lines = [];
  const push = (...texts) => lines.push(...texts);
  renderHeader(push, input);
  renderContextSection(push, input.context, input.selfDirDisplay);
  renderLessonsSection(push, input.lessons);
  renderDebtSection(push, input.debt);
  renderRedundancySection(push, input.redundancy, input.options, input.selfDisplay);
  renderGitSection(push, input.git);
  renderSupplementSection(push, input.brooks);
  renderDegradationSection(push, input.redundancy, input.brooks);
  renderSnapshotSection(push, input.snapshot);
  renderBaselineSection(push, input.baseline, input.snapshot);
  renderVolatilitySection(push, input.selfDisplay, input.options);
  return lines.join('\n') + '\n';
}

function buildSnapshot(readings) {
  const { context, lessons, debt, redundancy, git, brooks } = readings;
  const jscpd = redundancy.tools.find((tool) => tool.name === 'jscpd');
  return [
    { key: 'context.exists', value: String(context.exists) },
    { key: 'context.lineCount', value: String(context.lineCount) },
    { key: 'context.missingSections', value: String(context.missingSections.length) },
    { key: 'context.formatIssues', value: String(context.formatIssues.length) },
    { key: 'lessons.exists', value: String(lessons.exists) },
    { key: 'lessons.entries', value: String(lessons.entries) },
    { key: 'lessons.min', value: lessons.min === null ? 'none' : String(lessons.min) },
    { key: 'lessons.max', value: lessons.max === null ? 'none' : String(lessons.max) },
    { key: 'lessons.missing', value: String(lessons.missing.length) },
    { key: 'lessons.duplicates', value: String(lessons.duplicates.length) },
    { key: 'debt.exists', value: String(debt.exists) },
    { key: 'debt.rows', value: String(debt.rows) },
    { key: 'redundancy.targets', value: redundancy.targets.length === 0 ? 'none' : redundancy.targets.join(',') },
    { key: 'redundancy.jscpd', value: jscpd.path ? (redundancy.run && redundancy.run.status === 'ok' ? 'ok' : 'present') : 'absent' },
    { key: 'git.isRepo', value: String(git.isRepo) },
    { key: 'git.commits', value: git.commits === null ? 'none' : String(git.commits) },
    { key: 'git.head', value: git.head ?? 'none' },
    { key: 'brooks.present', value: String(brooks.present) },
  ];
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) { console.log(usage()); return 0; }
  const stat = await fs.stat(options.root).catch(() => null);
  if (!stat || !stat.isDirectory()) throw new Error('项目根不可用（不是目录）: ' + options.root);

  const date = formatLocalDate();
  const timestamp = formatLocalTimestamp();
  const contextText = await readTextIfExists(path.join(options.root, '.specs', 'CONTEXT.md'));
  const lessonsText = await readTextIfExists(path.join(options.root, '.specs', 'LESSONS.md'));

  const context = await collectContext(options.root);
  const lessons = collectLessons(lessonsText);
  const debt = collectDebt(contextText);
  const redundancy = await collectRedundancy(options.root);
  const git = collectGit(options.root);
  const brooks = await collectBrooks(options.root);
  const baseline = await readBaseline(options.root, date);
  const snapshot = buildSnapshot({ context, lessons, debt, redundancy, git, brooks });

  const report = renderReport({
    options,
    selfDisplay: displayPath(options.root, SELF_FILE),
    selfDirDisplay: displayPath(options.root, SELF_DIR),
    date,
    timestamp,
    context,
    lessons,
    debt,
    redundancy,
    git,
    brooks,
    baseline,
    snapshot,
  });

  const reportPath = path.join(options.root, '.specs', 'health', date + REPORT_SUFFIX);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, report, 'utf8');
  if (options.stdout) process.stdout.write(report);
  return 0;
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error('health: ' + (error && error.message ? error.message : String(error)));
    process.exitCode = 1;
  });
