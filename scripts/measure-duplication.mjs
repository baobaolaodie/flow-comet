#!/usr/bin/env node
/**
 * measure-duplication.mjs — 跨册逐字重复测量（本地工具，gitignore 不随发布分发）
 *
 * 用途：把调查期三个一次性测量脚本（`.specs/measure-full.mjs` / `measure-dup.mjs` /
 * `measure-types.mjs`）的口径合并成一个可复跑的本地工具，给「一轮 15 册加载」的重复体量
 * 一个可对账的数字。只报数，不做体量门禁（`docs/internal/ARCHITECTURE.md` 不吸收 token 预算表）。
 *
 * 口径（与三个既有脚本逐条对齐，换脚本不改数）：
 *   · 一轮 = 15 册（入口册 + 14 节点/协议册）——清单是 `ROUND_BOOKS` 常量，不从文本手抄；
 *   · 逐字重复 = 空白归一后**完全相同**的行；归一 = 去 CR + 连续空格/制表符折成一个空格 + 去首尾
 *     （即 `measure-full` 的 `norm`，跨行折叠属 `measure-dup` 的节级口径，此处只用于节内容比对）；
 *   · 长行门槛 ≥ 60 字符（`measure-full` §1 口径）——**AC-1 的对账口径就是这一条**；
 *   · 逐字重复额外注入 = Σ 行长 ×（含该行的册数 − 1）
 *     —— 语义是「这一行只保留在最需要的一册里，一轮能少注入多少字符」；
 *   · 按节聚合 = 各重复行的**冗余副本**（同一行在册清单里非首次出现的那几册）按其所在节标题归并，
 *     各节合计恒等于上面的总额（脚本内自校，不满足即报错退出）；
 *   · 类型级 = `measure-types` 的类型正则口径，对照「同一类型不再出现在 ≥2 册正文」这条主判据。
 *
 * 只读：不写任何仓库文件；退出码 0（`.flow-comet/skills` 缺失或对账失败时 1）。
 * 用法：node scripts/measure-duplication.mjs [--root <项目根>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 一轮加载的册清单（15 册 = 入口册 + 14 节点/协议册）——口径常量，单一来源
const ROUND_BOOKS = [
  'flow-comet/SKILL.md',
  'flow-comet-open/SKILL.md', 'flow-comet-change/SKILL.md', 'flow-comet-requirement/SKILL.md',
  'flow-comet-design/SKILL.md', 'flow-comet-plan/SKILL.md', 'flow-comet-task/SKILL.md',
  'flow-comet-execute/SKILL.md', 'flow-comet-subagent-execute/SKILL.md', 'flow-comet-dev/SKILL.md',
  'flow-comet-review/SKILL.md', 'flow-comet-test/SKILL.md',
  'flow-comet-verify/SKILL.md', 'flow-comet-integration/SKILL.md', 'flow-comet-archive/SKILL.md',
];

// 长行门槛（字符数，空白归一后计）——与 measure-full §1 一致
const LONG_LINE_MIN = 60;

// 类型 → 识别正则（机械匹配，非语义判断；沿用 measure-types 的口径）
const TYPES = [
  ['A 跨节点规程·四属性契约', /并行安全四属性契约|属性①「写权限」|\| ① \| \*\*写权限\*\*/],
  ['A 跨节点规程·提交面 pathspec', /提交面 pathspec 纪律|pathspec 纪律五要素/],
  ['A 跨节点规程·集成纪律', /集成纪律（四要素|集成纪律四要素/],
  ['A 跨节点规程·修复回路', /修复回路状态机路径|受控归位 execute|回源节点/],
  ['A 跨节点规程·受控重入', /受控重入/],
  ['B 模板与格式·必填段清单', /必填段清单/],
  ['B 模板与格式·模板权威句', /模板权威/],
  ['B 模板与格式·SUMMARY 保真', /标题\/首部\/段序保真|段序保真|模板保真/],
  ['C 加载规程·两层加载/双步硬规则', /加载声明（阶段层|两层加载模型|双步硬规则/],
  ['C 加载规程·skill-load 声明', /skill-load 声明命令|跑 skill-load 声明命令/],
  ['C 加载规程·Skill 工具不可用降级', /skillToolFallback|Skill 工具不可用/],
  ['D 平台事实·三平台通道', /三平台通道|平台通道对照表/],
  ['D 平台事实·保护集', /最小保护集/],
  ['D 平台事实·Codex 实测/边界', /Codex|codex exec|headless/],
  ['D 平台事实·判定序身份先于路径', /身份判据优先于路径判据|身份先于路径|身份判据先于路径/],
  ['E 引擎语义·Entry/Exit Check', /## Entry Check|## Exit Check|workflow-guard\.mjs entry|workflow-guard\.mjs exit/],
  ['E 引擎语义·Output Schemas', /## Output Schemas|flowkit\.[a-z]+\.v1/],
  ['E 引擎语义·Guardrails 表', /## Guardrails|\| Guardrail ID/],
  ['E 引擎语义·Recovery', /## Recovery|## 恢复|Recovery 段/],
  ['E 引擎语义·机器字段', /机器拥有字段|currentNode.*completedNodes|directOverride/],
  ['E 引擎语义·reenter/replan 规格', /reenter <target>|replan <reason>|--continue-round/],
  ['E 引擎语义·审计行语义', /FIX-BATCH|RETURN: 回源节点|INTEGRATE:/],
  ['F 维护者叙事·订正与日期锚', /旧结论|订正|推翻|20\d\d-\d\d-\d\d/],
  ['F 维护者叙事·内部编号', /\b[WLHKS]-?\d{1,3}\b|\bC3\b|\bF-4\b|KI-\d+|L-\d{3}/],
];

const stripCr = (s) => s.replace(/\r/g, '');
const norm = (s) => stripCr(s).replace(/[ \t]+/g, ' ').trim();
const posix = (p) => p.split(path.sep).join('/');

function parseRoot(argv) {
  const i = argv.indexOf('--root');
  const given = i >= 0 ? argv[i + 1] : null;
  return given ? path.resolve(given) : path.resolve(__dirname, '..');
}

function walkMd(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

// 每行归属的节标题（最近的前置 H1~H6；文首无标题的行落在占位节）
function sectionOfLine(text) {
  const out = [];
  let cur = '（文首·无标题节）';
  for (const raw of stripCr(text).split('\n')) {
    const m = raw.match(/^#{1,6}\s+(.+?)\s*$/);
    if (m) cur = m[1];
    out.push(cur);
  }
  return out;
}

function loadTexts(skillsDir) {
  const texts = new Map();
  for (const abs of walkMd(skillsDir)) {
    const rel = posix(path.relative(skillsDir, abs));
    texts.set(rel, fs.readFileSync(abs, 'utf8'));
  }
  return texts;
}

// 长行索引：归一文本 → [{ 册, 行号, 节, 行长 }]
function indexLongLines(texts) {
  const index = new Map();
  for (const [file, text] of texts) {
    const sections = sectionOfLine(text);
    stripCr(text).split('\n').forEach((raw, i) => {
      const key = norm(raw);
      if (key.length < LONG_LINE_MIN) return;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ file, line: i + 1, section: sections[i], len: key.length });
    });
  }
  return index;
}

// 跨册重复条目（在 ≥2 个 md 文件里逐字相同）——与 measure-full §1 同口径
function crossFileDuplicates(index) {
  const dups = [];
  for (const [key, hits] of index) {
    if (new Set(hits.map((h) => h.file)).size < 2) continue;
    dups.push({ key, hits });
  }
  return dups;
}

const roundFilesOf = (hits) => ROUND_BOOKS.filter((f) => hits.some((h) => h.file === f));

function roundWasteTotal(dups) {
  return dups.reduce((acc, d) => {
    const n = roundFilesOf(d.hits).length;
    return acc + (n >= 2 ? d.key.length * (n - 1) : 0);
  }, 0);
}

// 冗余副本归属：每行在册清单里的**首次出现**视作权威副本，其余各册是该副本的重复
function redundantCopies(dups) {
  const rows = [];
  for (const d of dups) {
    const files = roundFilesOf(d.hits);
    for (const f of files.slice(1)) {
      const hit = d.hits.find((h) => h.file === f);
      rows.push({ file: f, section: hit.section, len: d.key.length, key: d.key });
    }
  }
  return rows;
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, { chars: 0, lines: 0, files: new Set() });
    const g = groups.get(k);
    g.chars += r.len;
    g.lines += 1;
    g.files.add(r.file);
  }
  return [...groups].sort((a, b) => b[1].chars - a[1].chars);
}

const bookLabel = (f) => path.basename(path.dirname(f)).replace(/^flow-comet-?/, '') || '入口';

function reportHeadline(texts, dups, total) {
  const waste = roundWasteTotal(dups);
  let roundTotal = 0;
  let missing = 0;
  for (const f of ROUND_BOOKS) {
    if (!texts.has(f)) missing++;
    roundTotal += (texts.get(f) || '').length;
  }
  console.log('=== 1. 一轮 15 册的逐字重复（长行口径 · 空白归一后 ≥' + LONG_LINE_MIN + ' 字符）===');
  console.log('  一轮 15 册的逐字重复额外注入: ' + waste + ' 字符（占一轮 ' + (waste / roundTotal * 100).toFixed(1) + '%）· 一轮总量 ' + roundTotal);
  console.log('  重复行条目: ' + dups.length + '（全树 md ' + texts.size + ' 个文件参与比对）');
  if (missing) console.log('  ⚠ 册清单缺文件 ' + missing + ' 个（口径不完整，请核对树形态）');
  console.log('');
  return { waste, roundTotal, missing };
}

function reportBySection(copies, waste) {
  const groups = groupBy(copies, (r) => r.section);
  const sum = groups.reduce((a, [, g]) => a + g.chars, 0);
  console.log('=== 2. 按节聚合的重复清单（冗余副本所在节 · 从大到小）===');
  console.log('  节数 ' + groups.length + ' · 合计 ' + sum + ' 字符（与第 1 节总额对账: ' + (sum === waste ? '一致' : '不一致') + '）');
  for (const [section, g] of groups) {
    const books = [...g.files].map(bookLabel).join(',');
    console.log('  ' + String(g.chars).padStart(6) + ' 字 / ' + String(g.lines).padStart(3) + ' 行  ' + section + '  ← ' + books);
  }
  console.log('');
  return sum === waste;
}

function reportByBook(copies) {
  const groups = groupBy(copies, (r) => r.file);
  console.log('=== 3. 按册聚合的重复承接量（该册里是重复副本的行 · 从大到小）===');
  for (const [file, g] of groups) {
    console.log('  ' + String(g.chars).padStart(6) + ' 字 / ' + String(g.lines).padStart(3) + ' 行  ' + file);
  }
  console.log('');
}

// 一个类型正则在一轮册清单上的命中面（行数 / 字符 / 命中册）
function scanType(texts, re) {
  const hit = { books: new Set(), chars: 0, lines: 0 };
  for (const f of ROUND_BOOKS) {
    const t = texts.get(f);
    if (!t) continue;
    for (const l of stripCr(t).split('\n')) {
      if (!re.test(l)) continue;
      hit.books.add(f);
      hit.chars += l.length;
      hit.lines++;
    }
  }
  return hit;
}

function reportByType(texts) {
  const total = ROUND_BOOKS.reduce((a, f) => a + (texts.get(f) || '').length, 0);
  const rows = [];
  for (const [name, re] of TYPES) {
    const hit = scanType(texts, re);
    if (hit.books.size >= 2) {
      rows.push({ name, books: hit.books.size, chars: hit.chars, lines: hit.lines, pct: hit.chars / total * 100 });
    }
  }
  rows.sort((a, b) => b.chars - a.chars);
  console.log('=== 4. 跨册重复类型清单（同一类型出现在 ≥2 册正文 · 从大到小）===');
  console.log('  口径: 命中的行**含首次出现**，故不是"可省字符"，只用于比对类型回潮');
  for (const r of rows) {
    console.log('  ' + String(r.chars).padStart(6) + ' 字 / ' + String(r.lines).padStart(3) + ' 行 / ' + r.books + ' 册 / ' + r.pct.toFixed(1) + '%  ' + r.name);
  }
  console.log('  ≥2 册的类型数: ' + rows.length + ' / ' + TYPES.length);
  console.log('');
}

function main() {
  const root = parseRoot(process.argv.slice(2));
  const skillsDir = path.join(root, '.flow-comet', 'skills');
  console.log('口径基线: .flow-comet/skills（根 = ' + root + '）');
  if (!fs.existsSync(skillsDir)) {
    console.error('FAIL: 找不到 ' + skillsDir + '（请在项目根运行，或用 --root 指定）');
    process.exit(1);
  }
  const texts = loadTexts(skillsDir);
  const dups = crossFileDuplicates(indexLongLines(texts));
  const { waste } = reportHeadline(texts, dups, texts.size);
  const copies = redundantCopies(dups);
  const reconciled = reportBySection(copies, waste);
  reportByBook(copies);
  reportByType(texts);
  if (!reconciled) {
    console.error('FAIL: 按节聚合合计与总额不一致——口径实现有误，数字不可对账');
    process.exit(1);
  }
}

main();
