#!/usr/bin/env node
// evolve.mjs — 架构沉淀同步（横向命令）：只读扫描归档 change 的设计文档沉淀段 → 候选清单；
// 逐项应用 → patch 项目级文档 + 落 EVOLVE 报告 + 双落点时间戳。
//
// 用法：
//   node evolve.mjs scan [--root <项目根>]
//   node evolve.mjs apply <候选 id> [<候选 id> ...] [--root <项目根>] [--scanner <执行工具>]
//
// 单一权威（L-067）：「沉淀段在场」判定（hasSection9）与归档窗口判定（isArchivedAfterTimestamp）
// 一律 import time-utils.mjs；时间形态 / 解析 / 天差走 nowTimestamp / formatLocalDate /
// parseTimestamp / daysSince——本模块不内联第二份时间正则，也不自行拼接时间字符串。
// 模板段标题的归一走 route-node.mjs 导出的共享实现（normalizeHeading），不另起一份。
//
// 只读边界：scan 零写入；apply 的写入面只有三处——项目级文档（CONTEXT.md / ARCHITECTURE.md）、
// .specs/evolve/ 下的报告、以及 state 的 last_evolve_at（经 workflow-state.mjs 的 config set
// 通道写入，本脚本不直写 state 文件）。扫描内容严格限定在归档设计文档的沉淀段。

import { spawnSync } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeHeading } from './route-node.mjs';
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

const SPECS_DIR = '.specs';
const ARCHIVE_DIR = 'archive';
const REPORT_DIR = 'evolve';
const DESIGN_FILE = 'DESIGN.md';
const CONTEXT_FILE = 'CONTEXT.md';
const ARCHITECTURE_FILE = 'ARCHITECTURE.md';
const DOC_CONTEXT = SPECS_DIR + '/' + CONTEXT_FILE;
const DOC_ARCHITECTURE = SPECS_DIR + '/' + ARCHITECTURE_FILE;
const STATE_SCRIPT = 'workflow-state.mjs';
const EVOLVE_SECTION = 'evolve 元数据';
const STATE_KEY = 'last_evolve_at';
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
    '  node evolve.mjs scan [--root <项目根>]',
    '  node evolve.mjs apply <候选 id> [<候选 id> ...] [--root <项目根>] [--scanner <执行工具>]',
  ].join('\n');
}

export function parseArgs(argv) {
  const options = { command: argv[0] ?? '', ids: [], root: process.cwd(), scanner: 'flow-comet-evolve' };
  if (options.command !== 'scan' && options.command !== 'apply') {
    return { error: '未知子命令: ' + (options.command || '(空)') + '\n' + usage() };
  }
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--root') {
      const value = argv[++i];
      if (!value) return { error: '--root 需要一个目录参数' };
      options.root = path.resolve(value);
      continue;
    }
    if (token === '--scanner') {
      const value = argv[++i];
      if (!value) return { error: '--scanner 需要一段文本' };
      options.scanner = value;
      continue;
    }
    if (token.startsWith('--')) return { error: '未知参数: ' + token + '\n' + usage() };
    if (options.command !== 'apply') return { error: 'scan 不接受位置参数: ' + token };
    options.ids.push(token);
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

// 写盘走原子写（同目录临时文件 + rename，与引擎其余写盘同形）：目标文件要么是旧内容、
// 要么是新内容，不会留下被截断的半写状态。
async function writeFileAtomic(file, text) {
  const temporary = file + '.tmp';
  try {
    await fs.writeFile(temporary, text, 'utf8');
    await fs.rename(temporary, file);
  } catch (error) {
    try { await fs.rm(temporary, { force: true }); } catch { /* 清理失败不掩盖原始写错误 */ }
    throw error;
  }
}

async function readState(root) {
  const text = await readText(path.join(root, '.flow-comet', 'flow-comet-state.json'));
  if (text === null) return null;
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return null; }
}

export async function scanProject(root) {
  const state = await readState(root);
  const stored = state && typeof state[STATE_KEY] === 'string' ? state[STATE_KEY].trim() : '';
  const baseline = stored !== '' && !Number.isNaN(parseTimestamp(stored)) ? stored : '';
  const baselineNote = stored === '' ? '无基线（首次运行，全量扫描）'
    : baseline === '' ? '上次沉淀时间不可解析（按全量扫描）' : '';

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
    baseline,
    baselineNote,
    changes,
    scanned,
    candidates: scanned.flatMap((change) => change.candidates),
  };
}

function describeWindow(plan) {
  const since = plan.baseline === ''
    ? '窗口 起始 = ' + (plan.baselineNote || '无基线（首次运行，全量扫描）')
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
  const fields = [[STATE_KEY, ts], ['scanner', scanner], ['下次建议', nextSuggestion()]];
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

// 落盘一个目标文档：备份 → 追加条目 → 同批更新元数据段（仅 CONTEXT.md）。
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
    const backup = file + '.bak-' + formatLocalDate(parseTimestamp(ts));
    await fs.copyFile(file, backup);
    await writeFileAtomic(file, updated);
  }
  return { written, present };
}

function reportBlocks(plan, ts, requested, applied, present) {
  const lines = [];
  lines.push('## 扫描范围', '');
  lines.push('- 起始：' + (plan.baseline === ''
    ? (plan.baselineNote || '无基线（首次运行，全量扫描）')
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
  return file;
}

// state 通道的协议文件受保护读取要求协议位于项目根内。项目自带协议副本时显式指向它
// （项目自定义协议约定 `reference/workflow-protocol.json`；权威源布局另列一处），
// 其余情况沿用调用方环境——已装技能包的项目里，默认解析就落在项目根内。
function stateEnv(root) {
  const candidates = [
    path.join(root, 'reference', 'workflow-protocol.json'),
    path.join(root, '.flow-comet', 'skills', 'flow-comet', 'reference', 'workflow-protocol.json'),
  ];
  const found = candidates.find((file) => existsSync(file));
  if (!found) return { ...process.env };
  return { ...process.env, FLOW_COMET_PROTOCOL: found };
}

function writeStateTimestamp(root, ts, out = console) {
  const result = spawnSync(process.execPath, [path.join(__dirname, STATE_SCRIPT), 'config', 'set', STATE_KEY, ts], {
    cwd: root,
    env: stateEnv(root),
    encoding: 'utf8',
  });
  const text = ((result.stdout ?? '') + (result.stderr ?? '')).trim();
  if (text !== '') out.log(text);
  if (result.status !== 0) {
    throw new Error('state 写入通道失败（时间戳未推进；项目级文档已落盘、报告未落盘，重跑同一命令按幂等处理）'
      + '——若为协议文件不在项目根内的判定失败，请在项目内放置 reference/workflow-protocol.json 后重试');
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

  writeStateTimestamp(options.root, ts, out);
  const state = await readState(options.root);
  if (!state || state[STATE_KEY] !== ts) {
    throw new Error('state 回读不一致: 期望 ' + ts + ' 实得 ' + String(state && state[STATE_KEY]));
  }

  const report = await writeReport(options.root, plan, ts, requested, applied, present);
  out.log('EVOLVE-REPORT: ' + path.relative(options.root, report).split(path.sep).join('/'));
  out.log('EVOLVE: 双落点一致 state = ' + ts + ' · 段 = ' + ts + '（state 为唯一真相）');
  out.log('EVOLVE-OK');
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.error) fail(options.error);
  if (options.command === 'scan') await runScan(options);
  else await runApply(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main(process.argv.slice(2)).catch((error) => {
    console.error('BLOCKED: ' + error.message);
    process.exit(1);
  });
}
