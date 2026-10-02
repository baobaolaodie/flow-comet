#!/usr/bin/env node
// evolve.mjs — 架构沉淀同步（横向命令）：只读扫描归档 change 的设计文档沉淀段 → 候选清单；
// 逐项应用 → patch 项目级文档 + 落 EVOLVE 报告 + 双落点时间戳。
//
// 用法：
//   node evolve.mjs scan [--root <项目根>] [--stdout]
//   node evolve.mjs apply <候选 id> [<候选 id> ...] [--root <项目根>] [--scanner <执行工具>] [--stdout]
//   node evolve.mjs --help | -h
//
// 单一权威（L-067）：「沉淀段在场」判定（hasSection9）与归档窗口判定（isArchivedAfterTimestamp）
// 一律 import time-utils.mjs；时间形态 / 解析 / 天差走 nowTimestamp / formatLocalDate /
// parseTimestamp / daysSince——本模块不内联第二份时间正则，也不自行拼接时间字符串。
// 「改写前备份」的命名族与失败处置走 state-schema.mjs 的 backupBeforeWrite（单一来源）——
// 本模块不再自持 `.bak-` 命名族与复制调用（第二处表达）。
// 模板段标题的归一走 route-node.mjs 导出的共享实现（normalizeHeading），不另起一份。
// 协议路径走 state-schema.mjs 的 resolveProtocolPathWithState（唯一选择器），不自持候选布局表。
// 侧命令 CLI 契约（parseSideCommandArgs）也落本模块：三条横向命令共用一份解析——
// 本模块在导入时不执行命令（另两条在导入时即跑 main），是唯一可被安全导入的一方。
//
// 只读边界：scan 零写入；apply 的写入面只有三处——项目级文档（CONTEXT.md / ARCHITECTURE.md）、
// .specs/evolve/ 下的报告、以及 state 的 last_evolve_at（经 workflow-state.mjs 的 config set
// 通道写入，本脚本不直写 state 文件）。扫描内容严格限定在归档设计文档的沉淀段。

import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeHeading } from './route-node.mjs';
import {
  writeFileAtomic,
  backupBeforeWrite,
  EVOLVE_METADATA_SECTION,
  EVOLVE_METADATA_FIELDS,
  resolveProtocolPathWithState,
  RUNTIME_DIR,
  RUNTIME_STATE_FILE_NAME,
} from './state-schema.mjs';
import {
  archiveDateFromName,
  daysSince,
  formatLocalDate,
  hasSection9,
  isArchivedAfterTimestamp,
  nowTimestamp,
  parseTimestamp,
  EVOLVE_DUE_NEW_ARCHIVE_CHANGES,
  EVOLVE_STALE_DAYS,
} from './time-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 技能包根（协议默认落点与子进程 workflow-state.mjs 同源推导：脚本目录的上一级）
const packageRoot = path.resolve(__dirname, '..');

const SPECS_DIR = '.specs';
const ARCHIVE_DIR = 'archive';
const REPORT_DIR = 'evolve';
const DESIGN_FILE = 'DESIGN.md';
const CONTEXT_FILE = 'CONTEXT.md';
const ARCHITECTURE_FILE = 'ARCHITECTURE.md';
const DOC_CONTEXT = SPECS_DIR + '/' + CONTEXT_FILE;
const DOC_ARCHITECTURE = SPECS_DIR + '/' + ARCHITECTURE_FILE;
const STATE_SCRIPT = 'workflow-state.mjs';
// `## evolve 元数据` 的段名与三字段名来自 state-schema.mjs 的单一常量集（写方 = 本节 / 校验方 =
// context-init.mjs 的格式校验同源）；段侧字段序即常量序，双落点首字段与 state 的 STATE_KEY 同名。
const EVOLVE_SECTION = EVOLVE_METADATA_SECTION;
const [STATE_KEY, SCANNER_FIELD, SUGGESTION_FIELD] = EVOLVE_METADATA_FIELDS;
const SOURCE_PREFIX = '来源 @.specs/' + ARCHIVE_DIR + '/';

// 候选落点：目标文档 + 目标段。段名按模板标题的前缀匹配（标题常带括注后缀）。
// 落点判定只看子段标题的关键词（上游把沉淀分五类：抽象 / 决策 / 契约 / 依赖 / 禁动清单）。
const TARGETS = {
  abstract: { doc: DOC_CONTEXT, section: '既有抽象索引', level: 2, label: '既有抽象索引' },
  decision: { doc: DOC_CONTEXT, section: '已锁决策', level: 2, label: '已锁决策' },
  dependency: { doc: DOC_CONTEXT, section: '技术栈', level: 2, label: '技术栈' },
  forbidden: { doc: DOC_CONTEXT, section: '禁动清单', level: 3, parent: '既有抽象索引', label: '既有抽象索引 · 禁动清单' },
  contract: { doc: DOC_ARCHITECTURE, section: '跨模块契约', level: 2, label: '跨模块契约' },
};
const KIND_RULES = [
  { kind: 'forbidden', pattern: /禁动清单/ },
  { kind: 'abstract', pattern: /可复用抽象|抽象索引/ },
  { kind: 'dependency', pattern: /依赖/ },
  { kind: 'contract', pattern: /契约|跨模块|事件总线|API|Schema/ },
  { kind: 'decision', pattern: /技术决策|已锁决策|ADR/ },
];
const KIND_LABELS = { abstract: '抽象', decision: '决策', dependency: '依赖', forbidden: '禁动', contract: '契约' };
// 围栏块内的「无沉淀建议」声明——块整段为声明时不产出候选（表格行 / 列表项不走此判定）
const NO_SEDIMENT_BLOCK = /无架构层面沉淀建议|无沉淀建议|无新增可复用抽象/;

function fail(message) {
  console.error('BLOCKED: ' + message);
  process.exit(1);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function usage() {
  return [
    '用法:',
    '  node evolve.mjs scan [--root <项目根>] [--stdout]',
    '  node evolve.mjs apply <候选 id> [<候选 id> ...] [--root <项目根>] [--scanner <执行工具>] [--stdout]',
    '  node evolve.mjs --help | -h',
    '说明:',
    '  --root <目录>    项目根（缺省 = 当前目录；`--root=<目录>` 等号形等价）',
    '  --scanner <文本> apply 落盘报告里的执行工具名（缺省 flow-comet-evolve）',
    '  --stdout         scan 本就零写入且全量输出到标准输出；apply 时把本次追加进报告的内容原样输出',
    '  --help, -h       打印本用法后退出（不做任何读写）',
  ].join('\n');
}

// ---------- 侧命令 CLI 契约（单一来源） ----------
// 根相对 POSIX 路径标签：三条横向命令的 CLI 摘要行与工件段落都要把绝对路径显示成项目根相对形态
// （跨机器可读、可直接粘回命令行）。此前 evolve 内联、context-scan 自持一份同名助手——同一显示
// 决定的第二份表达；现由本模块（侧命令共享助手的既有落点）导出，三条命令同源消费。
export function relativeLabel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

// 三条横向命令（evolve / health / context-scan）共用本解析器：`--root <目录>` 与 `--root=<目录>`
// 两种形态、`--stdout`、`--help`/`-h`、未知参数**各只在此处表达一次**——此前三份自写脚手架必然分叉
// （一条不支持等号形、`--help` 只有一条有、错误构造三份各写一遍）。位置参数语义（evolve 的
// scan|apply 子命令与候选 id）与命令自有取值开关由调用方声明，本解析器不认识任何业务词元。
// 契约要点：用法错误一律 throw（各命令顶层错误处理决定前缀，退出码统一 1）；`--help` 在位置参数
// 之前短路（子命令之后写 `--help` 也只看用法）；取值开关悬空与未知参数一律可见报错，不静默忽略。
export function parseSideCommandArgs(argv, { usage: usageText, valueOptions = {}, positionals = null } = {}) {
  if (typeof usageText !== 'string' || usageText.trim() === '') {
    throw new Error('parseSideCommandArgs 需要非空用法文本（--help 与用法错误共用同一份）');
  }
  const options = { root: process.cwd(), rootArg: null, stdout: false, help: false, values: {}, tokens: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') { options.help = true; continue; }
    if (token === '--stdout') { options.stdout = true; continue; }
    if (token === '--root' || token.startsWith('--root=')) {
      const value = token === '--root' ? argv[i + 1] : token.slice('--root='.length);
      if (typeof value !== 'string' || value.trim() === '') throw new Error('--root 需要一个目录参数\n' + usageText);
      options.root = path.resolve(value.trim());
      options.rootArg = value;
      if (token === '--root') i += 1;
      continue;
    }
    const flag = Object.keys(valueOptions).find((name) => token === name || token.startsWith(name + '='));
    if (flag) {
      const value = token === flag ? argv[i + 1] : token.slice(flag.length + 1);
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(flag + ' 需要' + valueOptions[flag] + '\n' + usageText);
      }
      options.values[flag] = value;
      if (token === flag) i += 1;
      continue;
    }
    if (token.startsWith('-') && token !== '-') throw new Error('未知参数: ' + token + '\n' + usageText);
    options.tokens.push(token);
  }
  if (options.help) return options;
  if (positionals) positionals(options);
  return options;
}

// evolve 的位置参数语义：首词元是子命令，apply 的其余词元是候选 id（scan 不接受位置参数）。
// 返回 { error } 形态沿用本命令既有约定（main 走 fail() → BLOCKED + exit 1）。
export function parseArgs(argv) {
  const options = parseSideCommandArgs(argv, {
    usage: usage(),
    valueOptions: { '--scanner': '一段文本' },
    positionals: (parsed) => {
      parsed.command = parsed.tokens[0] ?? '';
      parsed.ids = parsed.tokens.slice(1);
    },
  });
  options.scanner = options.values['--scanner'] ?? 'flow-comet-evolve';
  if (options.help) return options;
  if (options.command !== 'scan' && options.command !== 'apply') {
    return { error: '未知子命令: ' + (options.command || '(空)') + '\n' + usage() };
  }
  if (options.command === 'scan' && options.ids.length > 0) {
    return { error: 'scan 不接受位置参数: ' + options.ids[0] };
  }
  if (options.command === 'apply' && options.ids.length === 0) {
    return { error: 'apply 需要至少一个候选 id\n' + usage() };
  }
  return options;
}

// ---------- 段定位（Markdown 结构操作，非沉淀段判据） ----------

// 行尾归一：CRLF 文档按行切开后每行尾部带 `\r`，而行首/行尾锚定的正则里 `.` 不匹配 `\r`
// （`## 名称\r` 会整行失配）——解析前统一剥掉行尾回退符，写回时再按文档自身的行尾约定拼。
function stripCr(line) {
  return String(line ?? '').replace(/\r$/, '');
}

function headingOf(line) {
  const matched = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(stripCr(line));
  if (!matched) return null;
  return { level: matched[1].length, title: normalizeHeading(matched[2]) };
}

function sectionEnd(lines, start, level, to) {
  for (let i = start + 1; i < to; i++) {
    const heading = headingOf(lines[i]);
    if (heading && heading.level <= level) return i;
  }
  return to;
}

// 按标题层级定位段；标题以给定名前缀开头即命中（模板标题带括注后缀，归一委托共享实现）
function findSection(lines, name, level, from = 0, to = lines.length) {
  const wanted = normalizeHeading(name);
  if (wanted === '') return null;
  for (let i = from; i < to; i++) {
    const heading = headingOf(lines[i]);
    if (!heading || heading.level !== level) continue;
    if (!heading.title.startsWith(wanted)) continue;
    return { start: i, end: sectionEnd(lines, i, level, to) };
  }
  return null;
}

// 段内插入点：段体末尾，但跳过尾部的空行、分隔线与引用注记（条目插在正文之后、尾注之前）
function bodyInsertIndex(lines, section) {
  let at = section.end;
  while (at > section.start + 1) {
    const text = lines[at - 1].trim();
    if (text === '' || text === '---' || text.startsWith('>')) { at -= 1; continue; }
    break;
  }
  return at;
}

function locateInsertion(lines, target) {
  if (target.parent) {
    const parent = findSection(lines, target.parent, 2);
    if (parent) {
      const sub = findSection(lines, target.section, target.level, parent.start + 1, parent.end);
      if (sub) return sub;
      return parent;
    }
  }
  return findSection(lines, target.section, target.level);
}

// ---------- 沉淀段解析（严格限定在沉淀段切片内） ----------

// 切出沉淀段：起始行由 hasSection9 判定（单一权威），段体止于同级或更高级标题。
export function locateSedimentSection(text) {
  const lines = String(text ?? '').split('\n');
  const start = lines.findIndex((line) => hasSection9(line));
  if (start < 0) return null;
  const heading = /^(#{1,6})/.exec(lines[start]);
  const level = heading ? heading[1].length : 2;
  return { lines: lines.slice(start, sectionEnd(lines, start, level, lines.length)) };
}

function isTableSeparator(line) {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line);
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

// 段内候选抽取：表格数据行一条、列表项一条、围栏块整块一条（块取首行作条目）。
// 子段标题决定落点类别；围栏块内整段只有「无沉淀建议」时不产出候选（表格行与列表项本身就是
// 逐条陈述，不做内容过滤——「无新增」一类条目照实列出，由评审逐条决定去留）。
export function parseSedimentCandidates(sectionLines) {
  const found = [];
  let subsection = '';
  let i = 0;
  const push = (cells) => {
    const parts = cells.map((cell) => String(cell).trim()).filter((cell) => cell.length > 0);
    if (parts.length === 0) return;
    found.push({ subsection, title: parts[0], detail: parts.slice(1).join(' · ') });
  };
  while (i < sectionLines.length) {
    const line = stripCr(sectionLines[i]);
    const heading = /^(#{2,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (heading) { subsection = heading[2].trim(); i += 1; continue; }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < sectionLines.length && /^\s*\|/.test(stripCr(sectionLines[i]))) {
        if (!isTableSeparator(stripCr(sectionLines[i]))) rows.push(splitTableRow(stripCr(sectionLines[i])));
        i += 1;
      }
      for (const cells of rows.slice(1)) push(cells); // 首行是表头
      continue;
    }
    if (/^\s*```/.test(line)) {
      const block = [];
      i += 1;
      while (i < sectionLines.length && !/^\s*```/.test(stripCr(sectionLines[i]))) {
        block.push(stripCr(sectionLines[i]).trim());
        i += 1;
      }
      i += 1;
      const content = block.filter((text) => text.length > 0);
      // 块首行若是列表项，剥掉列表符号后作条目（条目文本不带 Markdown 列表标记）
      const first = content.length > 0 ? content[0].replace(/^[-*][ \t]+/, '') : '';
      if (first.length > 0 && !NO_SEDIMENT_BLOCK.test(content.join(' '))) push([first]);
      continue;
    }
    const bullet = /^\s*[-*][ \t]+(.*)$/.exec(line);
    if (bullet) {
      const parts = [bullet[1].trim()];
      i += 1;
      while (i < sectionLines.length && /^\s+\S/.test(stripCr(sectionLines[i]))
        && !/^\s*[-*][ \t]+/.test(stripCr(sectionLines[i])) && !/^\s*\|/.test(stripCr(sectionLines[i]))) {
        parts.push(stripCr(sectionLines[i]).trim());
        i += 1;
      }
      push([parts.join(' ')]);
      continue;
    }
    i += 1;
  }
  return found;
}

function targetFor(subsection) {
  for (const rule of KIND_RULES) {
    if (rule.pattern.test(subsection)) return { kind: rule.kind, ...TARGETS[rule.kind] };
  }
  return { kind: 'abstract', ...TARGETS.abstract };
}

function candidateEntry(candidate) {
  const detail = candidate.detail ? ' · ' + candidate.detail : '';
  return '- ' + candidate.title + detail + ' · ' + SOURCE_PREFIX + candidate.dirName + '/' + DESIGN_FILE;
}

function candidateComment(candidate, ts) {
  return '  <!-- flow-comet-evolve ' + formatLocalDate(parseTimestamp(ts)) + ': from ' + candidate.id + ' -->';
}

function nextSuggestion() {
  return '约 ' + EVOLVE_STALE_DAYS + ' 天后，或新增 ≥ ' + EVOLVE_DUE_NEW_ARCHIVE_CHANGES + ' 个带 §9 内容的 change 之后';
}

// ---------- 扫描 ----------

async function readText(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return null; }
}

async function pathExists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

// 写盘走状态层单一来源的原子写（state-schema.mjs 的 writeFileAtomic）：目标文档要么是旧内容、
// 要么是新内容，不会留下被截断的半写状态。
// state 读取三态（**单一实现**：本导出同时是 context-scan 的读入口）：**不在场**（文件缺失）/ 可读 /
// **损坏**（在场但解析不出状态对象）。两者必须分开——把损坏折叠成「没有状态」，增量窗口会静默退化
// 为全量，措辞还把不可信状态说成正常冷启动。读失败（权限 / 目录占位）同样按不可信处理，不冒充
// 「不在场」。调用方按 `exists && state === null` 判损坏并 fail-closed。
export async function readStateInfo(root) {
  const file = path.join(root, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { exists: false, state: null };
    return { exists: true, state: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return { exists: true, state: null };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { exists: true, state: null };
  }
  return { exists: true, state: parsed };
}

// 损坏态的统一处置（单一表达）：状态不可信 → fail-closed，绝不按「首次运行」放行，也不写任何东西。
function unreadableStateError(root) {
  return new Error('引擎状态文件在场但无法解析（' + RUNTIME_DIR + '/' + RUNTIME_STATE_FILE_NAME
    + '，根 ' + root + '）——本次零写入、零候选；先修复该文件再重跑'
    + '（项目本未接入时删除它，即回到「state 不在场」口径）');
}

export async function scanProject(root) {
  const stateInfo = await readStateInfo(root);
  if (stateInfo.exists && stateInfo.state === null) throw unreadableStateError(root);
  const stored = stateInfo.state && typeof stateInfo.state[STATE_KEY] === 'string'
    ? stateInfo.state[STATE_KEY].trim() : '';
  const baseline = stored !== '' && !Number.isNaN(parseTimestamp(stored)) ? stored : '';
  // 三态措辞互斥（单一表达）：「首次运行」只限「state 可读且字段缺席」——不在场与损坏各有自己的
  // 说法，任何一个都不得冒充冷启动（措辞即判定，误导性措辞等于把缺陷藏起来）。
  const baselineNote = baseline !== '' ? ''
    : !stateInfo.exists ? '无基线（state 不在场——项目未接入，按全量扫描）'
      : stored === '' ? '无基线（首次运行，全量扫描）'
        : '上次沉淀时间不可解析（按全量扫描）';

  const archiveRoot = path.join(root, SPECS_DIR, ARCHIVE_DIR);
  let names = [];
  try {
    names = (await fs.readdir(archiveRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch { names = []; }

  const changes = [];
  for (const dirName of names) {
    const text = await readText(path.join(archiveRoot, dirName, DESIGN_FILE));
    const section = text === null ? null : locateSedimentSection(text);
    const parsed = section === null ? [] : parseSedimentCandidates(section.lines);
    const candidates = parsed.map((item, index) => ({
      ...item,
      ...targetFor(item.subsection),
      id: dirName + '#' + (index + 1),
      dirName,
    }));
    changes.push({
      dirName,
      archiveDate: archiveDateFromName(dirName),
      hasDesign: text !== null,
      hasSediment: section !== null,
      candidates,
      inWindow: baseline === '' ? true : isArchivedAfterTimestamp(dirName, baseline),
    });
  }
  const scanned = changes.filter((change) => change.inWindow);
  return {
    root,
    state: stateInfo.state,
    stateExists: stateInfo.exists,
    baseline,
    baselineNote,
    changes,
    scanned,
    candidates: scanned.flatMap((change) => change.candidates),
  };
}

function describeWindow(plan) {
  const since = plan.baseline === ''
    ? '窗口 起始 = ' + plan.baselineNote
    : '窗口 起始 = ' + plan.baseline + '（距今 ' + daysSince(plan.baseline).toFixed(1) + ' 天）';
  const withSediment = plan.scanned.filter((change) => change.hasSediment).length;
  return since + ' · 归档 ' + plan.changes.length + ' 个 · 窗口内 ' + plan.scanned.length
    + ' 个 · 含沉淀段 ' + withSediment + ' 个';
}

function changeSummary(change) {
  if (!change.hasDesign) return change.dirName + '（无 ' + DESIGN_FILE + '）';
  if (!change.hasSediment) return change.dirName + '（无沉淀段）';
  return change.dirName + '（候选 ' + change.candidates.length + ' 条）';
}

function candidateLine(candidate) {
  const target = candidate.doc + '「' + candidate.label + '」';
  const detail = candidate.detail ? ' · ' + candidate.detail : '';
  return '  [' + candidate.id + '] ' + KIND_LABELS[candidate.kind] + ' · ' + candidate.title + detail
    + '\n        目标 ' + target;
}

async function printScan(plan, out = console) {
  out.log('EVOLVE: 扫描 ' + plan.root + '/' + SPECS_DIR + '/' + ARCHIVE_DIR + '/*/' + DESIGN_FILE
    + ' 的沉淀段（只读，零写入）');
  out.log('EVOLVE: ' + describeWindow(plan));
  if (plan.candidates.length === 0) {
    out.log('EVOLVE: 候选 0 条（窗口内没有待沉淀条目）');
  } else {
    out.log('候选清单（' + plan.candidates.length + ' 条）：');
    for (const candidate of plan.candidates) out.log(candidateLine(candidate));
    const missingDocs = [];
    for (const doc of new Set(plan.candidates.map((candidate) => candidate.doc))) {
      if (!(await pathExists(path.join(plan.root, doc)))) missingDocs.push(doc);
    }
    for (const doc of missingDocs) {
      out.log('EVOLVE: 目标文档不在场 ' + doc + '——该文档内的候选在 apply 前需先建立它');
    }
  }
  if (plan.scanned.length > 0) {
    out.log('EVOLVE: 已扫 change 清单：' + plan.scanned.map(changeSummary).join(' · '));
  }
  out.log('EVOLVE: 应用请执行 evolve.mjs apply <id> --root <根>（未应用的候选不会写入）');
}

// ---------- 应用 ----------

function fieldLine(key, value) {
  return '- **' + key + '**: `' + value + '`';
}

// 双落点之段侧：在场则就地更新三字段，缺席则新建成段（段为可选段，缺席不报错）。eol = 文档行尾约定
function upsertEvolveSection(lines, ts, scanner, eol = '') {
  const fields = [[STATE_KEY, ts], [SCANNER_FIELD, scanner], [SUGGESTION_FIELD, nextSuggestion()]];
  const section = findSection(lines, EVOLVE_SECTION, 2);
  if (!section) {
    const lastText = [...lines].reverse().find((line) => line.trim() !== '') ?? '';
    if (lastText.trim() !== '---') lines.push(eol, '---' + eol);
    lines.push(eol, '## ' + EVOLVE_SECTION + eol, eol,
      ...fields.map(([key, value]) => fieldLine(key, value) + eol), eol);
    return;
  }
  const missing = [];
  for (const [key, value] of fields) {
    const pattern = new RegExp('^\\s*[-*]\\s*\\*\\*' + escapeRegExp(key) + '\\*\\*\\s*:');
    let replaced = false;
    for (let i = section.start + 1; i < section.end; i++) {
      if (pattern.test(lines[i])) { lines[i] = fieldLine(key, value) + eol; replaced = true; break; }
    }
    if (!replaced) missing.push(fieldLine(key, value) + eol);
  }
  if (missing.length > 0) lines.splice(bodyInsertIndex(lines, section), 0, ...missing);
}

// 落盘一个目标文档：备份（共享助手，单一来源）→ 追加条目 → 同批更新元数据段（仅 CONTEXT.md）。
// 插入行沿用文档自身的行尾约定——CRLF 文档里插入 LF 行会造成同一文件两种行尾。
async function patchDocument(root, doc, entries, ts, scanner, out = console) {
  const file = path.join(root, doc);
  const original = await fs.readFile(file, 'utf8');
  const eol = original.includes('\r\n') ? '\r' : '';
  const lines = original.split('\n');
  const written = [];
  const present = [];
  for (const candidate of entries) {
    const entry = candidateEntry(candidate);
    const insertion = locateInsertion(lines, candidate);
    if (!insertion) {
      throw new Error('目标段未找到: ' + candidate.doc + '「' + candidate.label + '」');
    }
    const body = lines.slice(insertion.start + 1, insertion.end).join('\n');
    if (body.includes(entry) || body.includes(candidateComment(candidate, ts).trim())) {
      present.push(candidate);
      continue;
    }
    lines.splice(bodyInsertIndex(lines, insertion), 0, entry + eol, candidateComment(candidate, ts) + eol);
    written.push(candidate);
    out.log('EVOLVE-APPLY: [' + candidate.id + '] → ' + candidate.doc + '「' + candidate.label + '」');
  }
  if (doc === DOC_CONTEXT) upsertEvolveSection(lines, ts, scanner, eol);
  const updated = lines.join('\n');
  if (updated !== original) {
    await backupBeforeWrite(file, ts);
    await writeFileAtomic(file, updated);
  }
  return { written, present };
}

function reportBlocks(plan, ts, requested, applied, present) {
  const lines = [];
  lines.push('## 扫描范围', '');
  lines.push('- 起始：' + (plan.baseline === ''
    ? plan.baselineNote + '（窗口内 = 全部归档 change）'
    : plan.baseline + '（距今 ' + daysSince(plan.baseline).toFixed(1) + ' 天）之后归档的 change'));
  lines.push('- 归档 ' + plan.changes.length + ' 个 · 窗口内 ' + plan.scanned.length + ' 个 · 含沉淀段 '
    + plan.scanned.filter((change) => change.hasSediment).length + ' 个');
  lines.push('- 已扫 change 清单：', '');
  lines.push('  | 归档 change | 归档日期 | 沉淀段 | 候选 |', '  |---|---|---|---|');
  for (const change of plan.scanned) {
    lines.push('  | ' + change.dirName + ' | ' + (change.archiveDate ?? '未按日期命名') + ' | '
      + (change.hasDesign ? (change.hasSediment ? '有' : '无') : '无设计文档') + ' | ' + change.candidates.length + ' |');
  }
  lines.push('', '## 候选汇总', '');
  lines.push('- 候选 ' + plan.candidates.length + ' 条 · 本次应用 ' + applied.length + ' 条 · 未应用 '
    + (plan.candidates.length - applied.length) + ' 条');
  lines.push('', '## 应用 patch', '');
  if (applied.length === 0) {
    lines.push('- （无——本次没有新增写入；已在场条目见下方跳过项）');
  } else {
    for (const candidate of applied) {
      lines.push('- [' + candidate.id + '] → `' + candidate.doc + '`「' + candidate.label + '」');
      lines.push('  - ' + candidateEntry(candidate));
    }
  }
  lines.push('', '## 跳过项 + 理由', '');
  if (present.length === 0) {
    lines.push('- （无）');
  } else {
    for (const candidate of present) {
      lines.push('- [' + candidate.id + '] 目标段已存在该条目（重复应用按幂等处理，未重复写入）');
    }
  }
  lines.push('', '## 未应用项（保留在报告中，可凭 id 继续 apply）', '');
  const pending = plan.candidates.filter((candidate) => !requested.some((item) => item.id === candidate.id));
  if (pending.length === 0) {
    lines.push('- （无）');
  } else {
    for (const candidate of pending) {
      lines.push('- [' + candidate.id + '] ' + KIND_LABELS[candidate.kind] + ' · ' + candidate.title
        + ' → `' + candidate.doc + '`「' + candidate.label + '」');
    }
  }
  lines.push('', '## 双落点时间戳', '');
  lines.push('- `state.' + STATE_KEY + '` = `' + ts + '`（经 ' + STATE_SCRIPT + ' 的 config set 通道写入）');
  lines.push('- `' + DOC_CONTEXT + '`「## ' + EVOLVE_SECTION + '」= `' + ts + '`（同批写入，取值一致；冲突以 state 为准）');
  lines.push('', '## 下次建议同步时间', '');
  lines.push('- ' + nextSuggestion());
  lines.push('');
  return lines;
}

async function writeReport(root, plan, ts, requested, applied, present) {
  const date = formatLocalDate(parseTimestamp(ts));
  const dir = path.join(root, SPECS_DIR, REPORT_DIR);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, date + '-EVOLVE.md');
  const exists = await pathExists(file);
  const blocks = reportBlocks(plan, ts, requested, applied, present);
  const body = exists
    ? ['', '---', '', '> 运行 ' + ts + ' · 应用 ' + applied.length + ' 条（在场 ' + present.length + ' 条）', '', ...blocks].join('\n')
    : ['# 架构演进同步 · ' + date, '', ...blocks].join('\n');
  await fs.appendFile(file, body, 'utf8');
  // 本次追加的正文回传调用方：`--stdout` 原样输出**本次写入的内容**（与落盘块逐字节相同，
  // 不是一个重新渲染的近似物——重渲染会与落盘漂移，恰好是「--stdout 与落盘一致」的反面）。
  return { file, body };
}

// state 通道的协议路径（单一来源）：子进程 workflow-state.mjs 的受保护读取要求协议文件位于项目根内，
// 而「协议在哪」的唯一权威是 state-schema.mjs 的 resolveProtocolPathWithState（state.protocolPath >
// FLOW_COMET_PROTOCOL 环境变量 > 内置默认，与 guard 同一入口）。本模块只把该选择结果透传给子进程
// （FLOW_COMET_PROTOCOL），**不再自持候选布局表**：那张表是第二套「协议在哪」的表达——state 已绑定
// 协议的项目会被它盖过（绑定静默失效，判定落到另一份协议上），布局变化也无人提醒。
function writeStateTimestamp(root, ts, state, out = console) {
  const resolved = resolveProtocolPathWithState({ packageRoot, runRoot: root, state, cliArgs: [] });
  const result = spawnSync(process.execPath, [path.join(__dirname, STATE_SCRIPT), 'config', 'set', STATE_KEY, ts], {
    cwd: root,
    env: { ...process.env, FLOW_COMET_PROTOCOL: resolved.protocolPath },
    encoding: 'utf8',
  });
  const text = ((result.stdout ?? '') + (result.stderr ?? '')).trim();
  if (text !== '') out.log(text);
  if (result.status !== 0) {
    throw new Error('state 写入通道失败（时间戳未推进；项目级文档已落盘、报告未落盘，重跑同一命令按幂等处理）'
      + '——协议路径来源 ' + resolved.source + '（' + resolved.protocolPath + '），按 state.protocolPath > '
      + 'FLOW_COMET_PROTOCOL > 内置默认的顺序解析且不回退候选布局：请修正 state.protocolPath'
      + ' 或把它指向项目内的协议副本后重试');
  }
}

async function runScan(options, out = console) {
  const plan = await scanProject(options.root);
  await printScan(plan, out);
  return plan;
}

// 写入前预检：每个候选的目标段都能定位。多目标文档时先全验后写——避免「第一份已写、第二份
// 抛错」的半成品（预检失败即零改动退出）。
async function validateInsertions(root, requested) {
  const texts = new Map();
  for (const candidate of requested) {
    if (!texts.has(candidate.doc)) {
      texts.set(candidate.doc, (await fs.readFile(path.join(root, candidate.doc), 'utf8')).split('\n'));
    }
    if (!locateInsertion(texts.get(candidate.doc), candidate)) {
      fail('目标段未找到: ' + candidate.doc + '「' + candidate.label + '」（本次零改动）');
    }
  }
}

async function runApply(options, out = console) {
  const plan = await scanProject(options.root);
  const index = new Map();
  for (const change of plan.changes) {
    for (const candidate of change.candidates) index.set(candidate.id, candidate);
  }
  const unknown = options.ids.filter((id) => !index.has(id));
  if (unknown.length > 0) {
    fail('候选 id 未找到: ' + unknown.join(', ') + '（可用: ' + ([...index.keys()].join(', ') || '无') + '）');
  }
  const requested = options.ids.map((id) => index.get(id));
  const absent = [];
  for (const candidate of requested) {
    if (!(await pathExists(path.join(options.root, candidate.doc)))) {
      absent.push('[' + candidate.id + '] → ' + candidate.doc);
    }
  }
  if (absent.length > 0) {
    fail('目标文档不在场，本次零改动: ' + absent.join('；')
      + '（跨模块契约类条目需先建立 ' + DOC_ARCHITECTURE + '，或改落 ' + DOC_CONTEXT + '）');
  }

  out.log('EVOLVE: 应用 ' + requested.length + ' 条候选（根 ' + options.root + '）');
  out.log('EVOLVE: ' + describeWindow(plan));
  await validateInsertions(options.root, requested);
  const ts = nowTimestamp();
  const byDoc = new Map();
  for (const candidate of requested) {
    if (!byDoc.has(candidate.doc)) byDoc.set(candidate.doc, []);
    byDoc.get(candidate.doc).push(candidate);
  }
  const applied = [];
  const present = [];
  for (const [doc, entries] of byDoc) {
    const result = await patchDocument(options.root, doc, entries, ts, options.scanner, out);
    applied.push(...result.written);
    present.push(...result.present);
  }

  writeStateTimestamp(options.root, ts, plan.state, out);
  const readBack = await readStateInfo(options.root);
  if (!readBack.state || readBack.state[STATE_KEY] !== ts) {
    throw new Error('state 回读不一致: 期望 ' + ts + ' 实得 ' + String(readBack.state && readBack.state[STATE_KEY]));
  }

  const report = await writeReport(options.root, plan, ts, requested, applied, present);
  out.log('EVOLVE-REPORT: ' + relativeLabel(options.root, report.file));
  if (options.stdout) out.log(report.body);
  out.log('EVOLVE: 双落点一致 state = ' + ts + ' · 段 = ' + ts + '（state 为唯一真相）');
  out.log('EVOLVE-OK');
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.error) fail(options.error);
  if (options.help) { console.log(usage()); return; }
  if (options.command === 'scan') await runScan(options);
  else await runApply(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main(process.argv.slice(2)).catch((error) => {
    console.error('BLOCKED: ' + error.message);
    process.exit(1);
  });
}
