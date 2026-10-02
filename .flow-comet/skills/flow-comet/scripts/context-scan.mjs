#!/usr/bin/env node
// context-scan.mjs — 项目上下文重扫（侧命令 · 显式调用 · 不在 8 节点流程内）
//
// 干什么：对一个已接入的项目重跑上下文探测，产出扫描工件（快照 + 与上次基线的差异清单），
//   并把扫描时刻**双落点**更新——引擎 state 的 last_intel_scan 与 .specs/CONTEXT.md 的
//   `## intel-scan 元数据` 段（与首次接入路径同一字段语义；两处不一致时以 state 为准）。
//
// 单一来源：探测 / 判决 / 结构校验 / 补齐指引 / 结构提取一律复用 context-init.mjs 的导出；
//   时间戳一律走 time-utils.mjs（本地时间 + 显式偏移）；state 路径与字段校验走 state-schema.mjs。
//   本文件不复制其中任何一份实现——同一判据两份实现必然分叉。
//
// 边界：
//   · 不生成也不重写 CONTEXT.md 的内容（生成是 agent 全量阅读的职责）；只替换元数据字段那一行的
//     首个取值词元，行尾说明文字原样保留；改写该行**之前先落备份**（同目录 `.bak-<本地日期>`，
//     与 evolve 同形；复制不成功即整轮 fail-closed——目标文档与 state 都保持原值）；
//   · 结构或格式校验不通过时零元数据写入，只输出补齐指引（与首次接入同规则：校验通过才记录扫描时间）；
//   · 不新建 state 文件——项目没有接入过就没有状态可更新，输出提示即可，不凭空造状态；
//   · 工件落 .specs/context-scan/<日期>-SCAN.md；同日重扫覆盖同名工件（覆盖前的内容即本次基线）。
//
// 用法：node context-scan.mjs [--root <项目根>] [--stdout]
//   退出码 0 = 扫描完成；1 = 未通过（未初始化 / 结构或格式校验不通过 / 元数据未能双落点）。

import { promises as fs } from 'fs';
import path from 'path';
import { probeProject, classify, validateContext, printGenerationGuide, extractContextStructure } from './context-init.mjs';
// 参数解析走侧命令共用的单一实现（evolve.mjs 导出）：`--root` 两种形态 / `--stdout` / `--help` /
// 未知参数各只在一处表达，三条横向命令的 CLI 契约因此同形（本文件不再自写一份脚手架）。
// 同一模块另导出 state 三态读入口（readStateInfo）——本文件的读盘面与 evolve 共用同一条实现。
import { parseSideCommandArgs, readStateInfo } from './evolve.mjs';
import { archiveDateFromName, formatLocalDate, nowTimestamp, parseTimestamp } from './time-utils.mjs';
import { RUNTIME_DIR, RUNTIME_STATE_FILE_NAME, validateStateFields, writeJsonAtomic } from './state-schema.mjs';

// 工件目录与命名（横向命令不在 change 生命周期内，落独立的领域目录）
const SCAN_DIR_SEGMENT = 'context-scan';
const SCAN_SUFFIX = '-SCAN.md';
// 机器快照标记：下一次重扫据此取出上一份快照做逐项比对（人读段落不参与比对）
const SNAPSHOT_MARKER = '<!-- context-scan-snapshot -->';
// 元数据段与字段（与 context-init 的格式校验同一段名 / 字段名）
const INTEL_SECTION = 'intel-scan 元数据';
const INTEL_FIELD = 'last_intel_scan';
// 字段行形态：`- **last_intel_scan**: <取值词元> <说明…>`——替换只换取值词元，说明原样保留
const INTEL_FIELD_LINE = new RegExp('^(\\s*-\\s*\\*\\*' + INTEL_FIELD + '\\*\\*\\s*[:：]\\s*)(\\S+)([\\s\\S]*)$');

function relativeLabel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function usage() {
  return [
    '用法: node context-scan.mjs [--root <项目根>] [--stdout] [--help]',
    '  --root <路径>  项目根（缺省 = 当前目录；`--root=<路径>` 等号形等价）',
    '  --stdout       工件正文原样写到标准输出（与落盘内容一致）',
    '  --help, -h     打印本用法后退出（不扫描）',
    '说明: 工件落 .specs/context-scan/<日期>-SCAN.md；扫描时刻双落点（引擎 state + CONTEXT 段）。',
  ].join('\n');
}

async function readTextFile(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
}

// 读引擎 state：解析失败与文件缺失必须分开——缺失是「项目未接入」（照常出工件），
// 损坏是「状态不可信」（fail-closed，零元数据写入）。三态判定与 BOM 容忍**不再在本文件内联第二份**：
// 走 evolve.mjs 导出的 readStateInfo（同一条读入口被两条侧命令共用；第二条实现必然与另一条分叉）。

// 基线 = .specs/context-scan/ 下最近一份 `<日期>-SCAN.md`。排序取**文件名日期**（随工件固化），
// 不取 mtime——检出 / 复制会重写 mtime，据它判时间会得出相反结论。日期前缀的形态与日历
// 合法性判定复用 time-utils 的同一实现，本文件不另写一份日历校验。
async function listBaselines(root) {
  const dir = path.join(root, '.specs', SCAN_DIR_SEGMENT);
  let names;
  try { names = await fs.readdir(dir); } catch { return []; }
  return names
    .map((name) => ({ name, date: archiveDateFromName(name) }))
    .filter((entry) => entry.name.endsWith(SCAN_SUFFIX) && entry.date !== null)
    .sort((a, b) => (a.date + a.name).localeCompare(b.date + b.name))
    .map((entry) => ({ ...entry, file: path.join(dir, entry.name) }));
}

// 取既有工件的机器快照：无标记 / 解析失败一律返回 null，调用方按「无法比对」显式说明（不静默省略）
async function readSnapshot(file) {
  const text = await readTextFile(file);
  const at = text.indexOf(SNAPSHOT_MARKER);
  if (at === -1) return null;
  const block = /```json\r?\n([\s\S]*?)\r?\n```/.exec(text.slice(at));
  if (!block) return null;
  try { return JSON.parse(block[1]); } catch { return null; }
}

function buildSnapshot({ scannedAt, probe, verdict, validation, structure }) {
  const metadata = {};
  for (const [section, fields] of Object.entries(structure.metadata)) {
    metadata[section] = {};
    for (const [field, entry] of Object.entries(fields)) metadata[section][field] = entry.value;
  }
  return {
    scannedAt,
    verdict,
    probe: {
      hasContext: probe.hasContext,
      hasCodeContext: probe.hasCodeContext,
      aiDocs: [...probe.aiDocs].sort(),
      projectDocs: [...probe.projectDocs].sort(),
    },
    validation: {
      missingSections: [...validation.missingSections].sort(),
      formatIssues: [...validation.formatIssues].sort(),
    },
    context: {
      sections: structure.sections,
      abstractionIndex: structure.abstractionIndex,
      metadata,
    },
  };
}

// 差异可比项：维度（kind）+ 条目（key）→ 取值（value）。三态比对只吃这一份数据，
// 渲染层不再各自判断——同一事实的第二套判定会与快照漂移。
function comparableItems(snapshot) {
  const items = [];
  const add = (kind, key, value) => { items.push({ kind, key, value: String(value) }); };
  for (const doc of snapshot.probe.aiDocs) add('AI 上下文文档', doc, '在场');
  for (const doc of snapshot.probe.projectDocs) add('项目文档', doc, '在场');
  for (const name of snapshot.context.sections) add('CONTEXT 段', name, '在场');
  for (const [group, entries] of Object.entries(snapshot.context.abstractionIndex)) {
    for (const entry of entries) add('抽象索引条目', group + ' / ' + entry, '在场');
  }
  for (const [section, fields] of Object.entries(snapshot.context.metadata)) {
    for (const [field, value] of Object.entries(fields)) add('元数据字段', section + ' / ' + field, value);
  }
  add('探测标志', 'CONTEXT.md 在场', snapshot.probe.hasContext ? '是' : '否');
  add('探测标志', '代码上下文信号', snapshot.probe.hasCodeContext ? '有' : '无');
  add('判决', '初始化检测判决', snapshot.verdict);
  for (const name of snapshot.validation.missingSections) add('缺段', name, '缺失');
  for (const issue of snapshot.validation.formatIssues) add('格式问题', issue, '存在');
  return items;
}

function diffItems(before, after) {
  const byId = (items) => new Map(items.map((item) => [item.kind + '｜' + item.key, item]));
  const oldItems = byId(before);
  const newItems = byId(after);
  const diff = { added: [], removed: [], changed: [] };
  for (const [id, item] of newItems) {
    const previous = oldItems.get(id);
    if (!previous) diff.added.push(item);
    else if (previous.value !== item.value) diff.changed.push({ ...item, from: previous.value });
  }
  for (const [id, item] of oldItems) {
    if (!newItems.has(id)) diff.removed.push(item);
  }
  return diff;
}

function renderItemList(items, render) {
  if (items.length === 0) return ['- （无）'];
  return items.map(render);
}

function renderSnapshotLines(lines, snapshot) {
  lines.push('## 快照');
  lines.push('');
  lines.push('### 探测（复用初始化检测的探测口径）');
  lines.push('');
  lines.push('- CONTEXT.md 在场: ' + (snapshot.probe.hasContext ? '是' : '否'));
  lines.push('- 代码上下文信号: ' + (snapshot.probe.hasCodeContext ? '有' : '无'));
  lines.push('- AI 上下文文档: ' + (snapshot.probe.aiDocs.length > 0 ? snapshot.probe.aiDocs.join(' / ') : '无'));
  lines.push('- 项目文档: ' + (snapshot.probe.projectDocs.length > 0 ? snapshot.probe.projectDocs.join(' / ') : '无'));
  lines.push('');
  lines.push('### 结构校验');
  lines.push('');
  lines.push('- 段清单: ' + (snapshot.context.sections.length > 0 ? snapshot.context.sections.join(' / ') : '无'));
  lines.push('- 缺段: ' + (snapshot.validation.missingSections.length > 0 ? snapshot.validation.missingSections.join(' / ') : '无'));
  lines.push('- 格式问题: ' + (snapshot.validation.formatIssues.length > 0 ? snapshot.validation.formatIssues.join(' / ') : '无'));
  lines.push('');
  lines.push('### 抽象索引条目');
  lines.push('');
  const groups = Object.entries(snapshot.context.abstractionIndex);
  if (groups.length === 0) {
    lines.push('- （无——CONTEXT.md 没有抽象索引条目）');
  } else {
    for (const [group, entries] of groups) {
      lines.push('- **' + group + '**（' + entries.length + '）');
      // 条目行本身可能是列表项（`- **路径**：…`）——渲染时去掉行首标记，避免出现双破折号
      for (const entry of entries) lines.push('  - ' + entry.replace(/^[-*]\s+/, ''));
    }
  }
  lines.push('');
  lines.push('### 元数据段字段（本次更新前的取值）');
  lines.push('');
  const metadataSections = Object.entries(snapshot.context.metadata);
  if (metadataSections.length === 0) {
    lines.push('- （无）');
  } else {
    for (const [section, fields] of metadataSections) {
      for (const [field, value] of Object.entries(fields)) lines.push('- `' + section + '` · ' + field + ': ' + value);
    }
  }
  lines.push('');
}

function renderDiffLines(lines, { root, baseline, baselineSnapshot, diff }) {
  lines.push('## 差异');
  lines.push('');
  if (!baseline) {
    lines.push('> **本次为基线，无差异可比**——`.specs/' + SCAN_DIR_SEGMENT + '/` 下没有可比的既有工件。');
    lines.push('> 本次快照即后续重扫的比对基准。');
  } else if (!baselineSnapshot) {
    lines.push('> 基线 `' + relativeLabel(root, baseline.file) + '`（' + baseline.date + '）**不含可解析的机器快照**——');
    lines.push('> 本次无法逐项比对（不静默省略差异段）；本次快照仍落盘，作为下一次重扫的基准。');
  } else {
    const renderItem = (item) => '- ' + item.kind + ' · ' + item.key;
    lines.push('> 基线：`' + relativeLabel(root, baseline.file) + '`（' + baseline.date + '）——逐项比对本次快照与该基线。');
    lines.push('');
    lines.push('### 新增（' + diff.added.length + '）');
    lines.push('');
    lines.push(...renderItemList(diff.added, renderItem));
    lines.push('');
    lines.push('### 消失（' + diff.removed.length + '）');
    lines.push('');
    lines.push(...renderItemList(diff.removed, renderItem));
    lines.push('');
    lines.push('### 变更（' + diff.changed.length + '）');
    lines.push('');
    lines.push(...renderItemList(diff.changed, (item) => renderItem(item) + ': ' + item.from + ' → ' + item.value));
  }
  lines.push('');
}

function renderReport({ root, reportFile, snapshot, baseline, baselineSnapshot, diff }) {
  const lines = [];
  lines.push('# 项目上下文重扫报告 · ' + formatLocalDate());
  lines.push('');
  lines.push('- **扫描时刻**: ' + snapshot.scannedAt);
  lines.push('- **扫描根**: ' + root);
  lines.push('- **工件**: `' + relativeLabel(root, reportFile) + '`');
  lines.push('- **初始化检测判决**: ' + snapshot.verdict);
  lines.push('- **元数据更新**: `' + INTEL_FIELD + '` = ' + snapshot.scannedAt + '（引擎 state + `' + INTEL_SECTION + '` 段）');
  lines.push('');
  renderSnapshotLines(lines, snapshot);
  renderDiffLines(lines, { root, baseline, baselineSnapshot, diff });
  lines.push('## 机器快照');
  lines.push('');
  lines.push(SNAPSHOT_MARKER);
  lines.push('```json');
  lines.push(JSON.stringify(snapshot, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('> 本节是下一次重扫的比对输入（逐项快照）；上面的差异段由它与基线派生。');
  lines.push('');
  return lines.join('\n');
}

// 只替换元数据字段行的取值词元：段 / 字段由结构提取定位到原文行号，行尾说明文字原样保留。
// 段不在场或行形态不符 → 不写（fail-closed，由调用方报出原因，不猜不改）。
// 形态判定先做 `test` 再做替换：拿「替换结果与原行相等」当形态判据会把「同一秒内重扫」
// （取值未变 → 替换是无变化操作）误判成行形态不符，进而假 BLOCK。
function replaceContextTimestamp(contextText, structure, value) {
  const field = structure.metadata[INTEL_SECTION] ? structure.metadata[INTEL_SECTION][INTEL_FIELD] : undefined;
  if (!field) return { text: null, reason: '段或缺字段不在场' };
  const lines = contextText.split('\n');
  const line = lines[field.lineIndex];
  if (typeof line !== 'string') return { text: null, reason: '字段行号越界' };
  if (!INTEL_FIELD_LINE.test(line)) {
    return { text: null, reason: '字段行形态不符（取值词元之前须为 `**' + INTEL_FIELD + '**:`）' };
  }
  lines[field.lineIndex] = line.replace(INTEL_FIELD_LINE, (match, prefix, oldValue, suffix) => prefix + value + suffix);
  return { text: lines.join('\n'), reason: null };
}

// 写引擎 state 的扫描时刻：路径与字段校验走 state-schema 的既有导出；写盘走同一原子写导出
// （目标要么旧内容要么新内容，不出现半写状态；临时文件固定同目录，rename 不跨卷）。
async function writeStateTimestamp(stateFile, state, value) {
  const bad = validateStateFields({ ...state, [INTEL_FIELD]: value });
  if (bad.length > 0) return { updated: false, reason: '字段校验不通过: ' + bad.join(', ') };
  const next = { ...state };
  next[INTEL_FIELD] = value;
  await writeJsonAtomic(stateFile, next);
  return { updated: true, reason: null };
}

// 双落点更新扫描时刻：CONTEXT 段在前、state 在后——段写不进去就绝不动 state（避免半边更新）。
// 改写 CONTEXT.md 前先落一份备份，形态与 evolve 一致（同目录 `.bak-<本地日期>` 命名族、内容 =
// 改写前版本、复制失败即抛出 → 整轮 fail-closed）；同日重复改写同名覆盖（不堆积）；取值未变
// （同一秒内重扫）时既不改写也不落备份——无变化就没有可备份的「改写前版本」。
async function updateScanTimestamp({ root, contextFile, contextText, structure, stateInfo, stateFile, scannedAt }) {
  const contextUpdate = replaceContextTimestamp(contextText, structure, scannedAt);
  if (contextUpdate.text === null) {
    return { ok: false, reason: 'CONTEXT.md 的 `' + INTEL_SECTION + '` 段未更新（' + contextUpdate.reason + '）——state 保持原值，两处仍一致。' };
  }
  if (contextUpdate.text !== contextText) {
    const backupFile = contextFile + '.bak-' + formatLocalDate(parseTimestamp(scannedAt));
    await fs.copyFile(contextFile, backupFile);
    await fs.writeFile(contextFile, contextUpdate.text, 'utf8');
  }
  if (!stateInfo.exists) {
    console.log('CONTEXT-SCAN: state 未找到（' + relativeLabel(root, stateFile) + '）——项目未接入过，本次只更新 CONTEXT 段。');
    return { ok: true, stateUpdated: false };
  }
  const stateUpdate = await writeStateTimestamp(stateFile, stateInfo.state, scannedAt);
  if (!stateUpdate.updated) {
    return { ok: false, reason: '引擎 state 未更新（' + stateUpdate.reason + '）——CONTEXT 段已更新，两处暂时不一致；先修状态再重跑。' };
  }
  return { ok: true, stateUpdated: true };
}

// 结果摘要（前缀行供机检检索；--stdout 时先原样输出工件正文，便于消费方一次取全）
function printResult({ stdout, root, reportText, reportFile, baseline, baselineSnapshot, diff, scannedAt, stateUpdated }) {
  const output = [];
  if (stdout) output.push(reportText, '');
  output.push('CONTEXT-SCAN: 报告 `' + relativeLabel(root, reportFile) + '`');
  output.push('CONTEXT-SCAN: 基线 ' + (baseline
    ? '`' + relativeLabel(root, baseline.file) + '`（' + baseline.date + '）'
    : '无（本次为基线，无差异可比）'));
  if (!baseline) output.push('CONTEXT-SCAN: 差异 无（本次为基线，无差异可比）');
  else if (!baselineSnapshot) output.push('CONTEXT-SCAN: 差异 无（既有基线不含机器快照，无法比对）');
  else output.push('CONTEXT-SCAN: 差异 新增 ' + diff.added.length + ' / 消失 ' + diff.removed.length + ' / 变更 ' + diff.changed.length);
  output.push('CONTEXT-SCAN: ' + INTEL_FIELD + ' = ' + scannedAt
    + (stateUpdated ? '（引擎 state + CONTEXT 段）' : '（仅 CONTEXT 段）'));
  output.push('CONTEXT-SCAN-DONE');
  console.log(output.join('\n'));
}

// 前置门（两条，均零元数据写入）：
//   ① 结构 / 格式校验不通过 → 输出补齐指引（复用首次接入的同一指引）后 BLOCK；
//   ② 状态文件在场但解析失败 → 状态不可信，先修状态再扫。
// 返回 false = 已 BLOCK（原因已输出），调用方直接退出。
async function preflight({ root, probe, validation, contextText, stateInfo, stateFile }) {
  if (validation.missingSections.length > 0 || validation.formatIssues.length > 0) {
    const problems = [...validation.formatIssues, ...validation.missingSections.map((name) => '缺段 ' + name)];
    if (contextText === '') await printGenerationGuide(root, probe);
    else await printGenerationGuide(root, probe, { rewrite: true, problems });
    console.error('BLOCKED: CONTEXT.md 未通过结构校验——本次不写扫描时间；按上面的指引补齐后重跑 context-scan。');
    return false;
  }
  if (stateInfo.exists && stateInfo.state === null) {
    console.error('BLOCKED: 引擎状态文件无法解析（' + relativeLabel(root, stateFile) + '）——本次零写入，先修复状态再重跑。');
    return false;
  }
  return true;
}

async function main() {
  const options = parseSideCommandArgs(process.argv.slice(2), { usage: usage() });
  if (options.help) { console.log(usage()); return 0; }
  const root = options.root;
  const contextFile = path.join(root, '.specs', 'CONTEXT.md');
  const stateFile = path.join(root, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME);
  const scannedAt = nowTimestamp();

  // ① 探测 / 判决 / 结构校验 / 结构提取——一律复用 context-init 的导出（本文件不另写一套）
  const stateInfo = await readStateInfo(root);
  const probe = await probeProject(root, stateInfo.state);
  const verdict = classify(probe, stateInfo.state);
  const validation = await validateContext(root);
  const contextText = await readTextFile(contextFile);
  const structure = extractContextStructure(contextText);
  if (!await preflight({ root, probe, validation, contextText, stateInfo, stateFile })) return 1;

  // ② 快照与差异：基线 = 最近一份既有工件（同日重扫覆盖同名文件，覆盖前的内容即基线）
  const snapshot = buildSnapshot({ scannedAt, probe, verdict, validation, structure });
  const baselines = await listBaselines(root);
  const baseline = baselines.length > 0 ? baselines[baselines.length - 1] : null;
  const baselineSnapshot = baseline ? await readSnapshot(baseline.file) : null;
  const diff = baselineSnapshot ? diffItems(comparableItems(baselineSnapshot), comparableItems(snapshot)) : null;

  // ③ 双落点更新扫描时刻（失败即 BLOCK，零工件落盘——不谎称两处都写了）
  const update = await updateScanTimestamp({ root, contextFile, contextText, structure, stateInfo, stateFile, scannedAt });
  if (!update.ok) {
    console.error('BLOCKED: ' + update.reason);
    return 1;
  }

  // ④ 工件落盘（基线只在元数据写成功后才前进；同日重扫覆盖同名文件，覆盖前的内容即本次基线）
  const reportFile = path.join(root, '.specs', SCAN_DIR_SEGMENT, formatLocalDate() + SCAN_SUFFIX);
  const reportText = renderReport({ root, reportFile, snapshot, baseline, baselineSnapshot, diff });
  await fs.mkdir(path.dirname(reportFile), { recursive: true });
  await fs.writeFile(reportFile, reportText, 'utf8');

  printResult({ stdout: options.stdout, root, reportText, reportFile, baseline, baselineSnapshot, diff, scannedAt, stateUpdated: update.stateUpdated });
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error('BLOCKED: ' + (error && error.message ? error.message : String(error)));
    process.exitCode = 1;
  });
