// 场景组 n — 模板权威（L1）：REQUIREMENT 的 25 条验收准则逐条落夹具。
// 元素形态 `{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
//
// 夹具设计纪律（本组每一条都遵守）：
//   · **模板夹具自足**：每个夹具根自己写 `flow-kit/templates/<DOC>.md`（维护者检出取 vendored
//     真迹作内容权威，CI 全新检出无 vendored 副本时按登记表合成等价段形）——判据的来源是夹具根
//     内的模板，因此断言不依赖检出形态，也不会因「模板缺席」被静默跳过。
//   · **每条带反向构造**：负例（抽掉 / 改掉目标 → 必红）与正例（恢复到合规形态 → 必绿）成对构造；
//     文本类判据用「同一判据函数 + 变异探针」，抽掉目标文字后判据必须发声。
//   · **只判结构级**：断言落在「拦没拦 / 报出了什么类别」上，不断言散文措辞（措辞由 T08/T09 定稿）。
//
// 待实现面：本组场景先于实现落盘（RED），由产出物门禁扩展 / 加载链 / 扫描与提名 / 侧命令 /
// 文本同步各任务转绿。

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import {
  assertExit,
  assertNotOut,
  assertOut,
  assertTrue,
  baseState,
  runGuard,
  runState,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  REPO_ROOT,
  SCRIPTS_DIR,
  TASK_DONE,
  customProtocol,
  dropNamedImport,
  engineCodeText,
  engineDefinitionHits,
  engineDefinitionModule,
  engineDefinitionPattern,
  engineImportsSymbolFrom,
  engineScriptTexts,
  handoffFor,
} from '../lib/test-fixtures.mjs';
import { scenarioProtocolPath } from '../lib/test-assertions.mjs';
import { taskBlocks } from '../task-parsing.mjs';
import {
  AUTHORITATIVE_SOURCE_ANCHOR_REL,
  GITHOOKS_CODES_REL,
  PUBLIC_FACE_CODE_DOCS,
  SCENARIO_COUNT_FILES,
  SYSTEM_TEST_COUNT_FILES,
  maintainerFacePresent,
  publicFaceDocsAbsent,
  publicFaceSelfCheck,
  singleSourceImportProblems,
} from '../lib/text-anchor-checks.mjs';

// ---------- 登记表与模板夹具（夹具输入面，不是判据） ----------

const REGISTRY_FILE = path.join(SCRIPTS_DIR, '..', 'reference', 'artifact-templates.json');
const CHANGE_DIR = '.specs/' + CHANGE_ID;
const SKILLS_ROOT = path.join(SCRIPTS_DIR, '..', '..');
// 公开文档面的形态判据来自 lib 的 publicFaceDocsAbsent（与底部自检、场景 105 同一实现）：本组不再
// 自持第二套（曾按 docs/authority-map.json 是否在场分流，与 lib 的 docs/ 判据各说各话）。
// 只按 docs/ 在不在也不够——分支 / 稀疏检出 / 误删把 docs/ 拿掉时，整块判据会变成可见 SKIP。

let registryMemo;
function artifactRegistry() {
  if (registryMemo === undefined) {
    try {
      registryMemo = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    } catch (e) {
      throw new Error('登记表不可读: ' + REGISTRY_FILE + '（' + e.message + '）——模板权威场景的前提条件');
    }
  }
  return registryMemo;
}

function docEntry(key) {
  const templates = artifactRegistry().templates ?? {};
  const hit = Object.keys(templates).find((name) => name.toLowerCase() === String(key).toLowerCase());
  if (!hit) throw new Error('登记表缺模板键: ' + key);
  return templates[hit];
}

function docRel(key) {
  return docEntry(key).file;
}

function docBase(key) {
  return path.posix.basename(docRel(key));
}

function docTitle(key) {
  return String(docEntry(key).titleForm ?? '# ' + key).replace(/<[^>]*>/g, '夹具');
}

// 模板夹具正文：每段给一行占位正文，供「与模板该段逐字相同」判据构造（CI 合成形态与真实模板
// 同构的只有段形；真实模板在场时正文直接取真迹，判据更强）。正文整体包进尖括号——「模板留了待填位」
// 因此在不带 vendored 模板的全新检出（CI）里同样成立，AC-6 的逐字判据不会退化成空转。
function templatePlaceholder(sectionName) {
  return '<模板占位正文（' + sectionName + '）：照抄本行即视为未填写。>';
}

// 登记表合成形态的段正文覆盖：LESSONS 的「条目格式」段是条目字段键判据（C20）的唯一派生源，
// ARCHITECTURE 的「ADR 列表」段是 §3 条目字段键判据的唯一派生源——CI 全新检出没有 vendored 模板时
// 也要给出等价书写样例，否则该判据在 CI 里会退化成「无法派生」而空转（报告只能声明未校验）。
const TEMPLATE_BODY_FIXTURES = {
  ARCHITECTURE: [[
    'ADR 列表',
    [
      '### ADR-NNN · <标题>',
      '',
      '- **状态**：proposed | accepted | deprecated | superseded by ADR-NNN',
      '- **取舍**：…',
      '- **决定**：…',
      '- **理由**：…',
      '- **代价**：…',
      '- **来源 change**：<change-id 或 (initial)>',
      '- **推翻成本**：低 / 中 / 高',
    ].join('\n'),
  ]],
  LESSONS: [[
    '条目格式',
    [
      '```markdown',
      '### L-NNN · [tag1, tag2] 标题（一行内说清，便于目录扫读）',
      '',
      '- **首发**: <change-id> · <task-id> · <YYYY-MM-DD>',
      '- **上次复核**: <YYYY-MM-DD>',
      '- **适用栈**: <例 React 18+ / Node 20 / SQLite 当前 schema>',
      '- **状态**: active / superseded-by:L-MMM / deprecated:<原因>',
      '- **关键词**: <空格分隔，方便 grep；用任务里会出现的词>',
      '```',
    ].join('\n'),
  ]],
};

function templateFixtureText(key) {
  const realFile = path.join(REPO_ROOT, ...docRel(key).split('/'));
  if (fs.existsSync(realFile)) return fs.readFileSync(realFile, 'utf8');
  const entry = docEntry(key);
  const lines = [docTitle(key), ''];
  for (const section of entry.sections ?? []) {
    const override = (TEMPLATE_BODY_FIXTURES[key] ?? []).find(([needle]) => section.name.includes(needle));
    lines.push('## ' + section.name, '', override ? override[1] : templatePlaceholder(section.name), '');
  }
  return lines.join('\n');
}

function writeTemplateFixture(dir, key) {
  writeFile(dir, docRel(key), templateFixtureText(key));
}

// 模板夹具（示例表格形态）：把某段正文替换成一张带示例数据行的表。用于构造「照抄模板里的示例
// 表格」的逐字判据——真实模板在两种检出下形态不同（vendored 真迹 / 按登记表合成），这里显式给出
// 等价段形 + 示例数据，使夹具同构；判据只看模板该段正文是否属成品形态（示例表格行），不看措辞。
function writeTableTemplateFixture(dir, key, sectionNeedle, tableText) {
  const lines = templateFixtureText(key).replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let skipping = false;
  let replaced = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      skipping = line.includes(sectionNeedle);
      replaced = replaced || skipping;
      if (skipping) out.push(line, '', tableText, '');
      else out.push(line);
      continue;
    }
    if (skipping) continue;
    out.push(line);
  }
  if (!replaced) throw new Error('夹具构造失败：模板段不在场 ' + key + ' / ' + sectionNeedle);
  writeFile(dir, docRel(key), out.join('\n'));
}

// 模板夹具（删段形态）：把某段整段（标题 + 正文）从模板里删掉——构造「上游回退 / 模板比登记表少
// 一段」的滞后面，用于 C14「登记表多出的段被忽略并 WARN」与 C9「整份缺席 vs 只缺某段」两组判据。
// 行锚定只删 `## ` 起始的段块（正文里引用段名不会劫持，L-128）。
function writeTemplateFixtureOmittingSection(dir, key, sectionNeedle) {
  const lines = templateFixtureText(key).replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let skipping = false;
  let removed = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      skipping = line.includes(sectionNeedle);
      removed = removed || skipping;
      if (skipping) continue;
      out.push(line);
      continue;
    }
    if (skipping) continue;
    out.push(line);
  }
  if (!removed) throw new Error('夹具构造失败：模板段不在场 ' + key + ' / ' + sectionNeedle);
  writeFile(dir, docRel(key), out.join('\n'));
}

// 模板某段正文（行锚定：段标题之后、下一个 H2 之前；首尾空行剥掉）。
function templateSectionBody(key, needle) {
  const lines = templateFixtureText(key).replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inside = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (inside) break;
      inside = line.includes(needle);
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

// ---------- 工件渲染（夹具；段形与顺序全部由登记表驱动） ----------

const HEADER_VALUES = {
  'Change ID': CHANGE_ID,
  '创建日期': '2026-10-20',
  '路径建议': '完整',
  '状态': 'active',
  '关联': '@.specs/' + CHANGE_ID + '/REQUIREMENT.md',
  '作者': 'AI + 人工 review',
  'Task ID': 'T01',
  '完成时间': '2026-10-20 10:00',
  'AI 角色': 'Dev',
  '审查时间': '2026-10-20 10:00',
  '审查者': 'AI',
  '总体结论': '通过',
  '项目类型': 'backend',
  '维护者': 'AI',
  '首次创建': '2026-10-20',
  '最近修订': '2026-10-20',
  '当前 ADR 编号最大值': 'ADR-021',
  '暂停时间': '2026-10-20 10:00',
  '触发清窗的信号': '上下文将满',
};

// 条件段正文：显式标注「不适用」（同时也是「视觉调性缺席 → 前端」判据的负向标记形态）。
const CONDITIONAL_BODY = '不适用（本 change 不涉及该条件段，按模板占位）。';

const SIX_DIM_BODY = [
  '- 功能: 通过（brooks-review 已跑）',
  '- 性能: 无影响',
  '- 安全: 无影响',
  '- 兼容: 通过',
  '- 可观测: 通过',
  '- 可维护: 通过',
].join('\n');

const VERIFY_COMMAND_BODY = ['```', 'node --check baseline.js', '```'].join('\n');

const TASK_BLOCK_BODY = '<task id="T01" status="done"><action>实现夹具被测项</action>'
  + '<write_files>src/fixture.mjs</write_files><verify>node --check baseline.js</verify></task>';

// 波次段正文：夹具任务 T01 无依赖 ⇒ 第 1 波。段在场却一条 Wave 行都没有时，plan 出口按「波次划分段
// 内容不可判」拦（未验证 ≠ 通过）——本场景测的是「缺必填 H2」的段形判据，波次段必须写出可判声明，
// 否则它先被波次判据拦下，被测报文根本不会出现。
const TASK_WAVE_BODY = ['```', 'Wave 1: T01', '```'].join('\n');

// 段级正文覆盖：[模板键, 段名片段, 正文]——只在夹具需要实质内容的位置使用。
const BODY_OVERRIDES = [
  ['SUMMARY', '6 维自查', SIX_DIM_BODY],
  ['SUMMARY', 'verify 输出', VERIFY_COMMAND_BODY],
  ['REQUIREMENT', '验收准则', '- Given 夹具前置\n- When 夹具动作\n- Then 夹具结果（AC 夹具）'],
  ['REQUIREMENT', '用户故事', '- US-1 作为执行者，我想让夹具可通过结构校验。'],
  ['TASK', '波次划分', TASK_WAVE_BODY],
  ['TASK', '任务清单', TASK_BLOCK_BODY],
  ['REVIEW', '2.2', '- **F1 · 夹具发现**：某处存在一个可记录的衰退风险 [已修]\n'
    + '  - **Symptom**: 夹具现象\n  - **Source**: 夹具来源\n'
    + '  - **Consequence**: 夹具后果\n  - **Remedy**: 夹具处置'],
  ['TEST', '1.5', SIX_DIM_BODY],
];

const INCREMENT_BODIES = {
  '自检方法': 'brooks-review（夹具声明）。',
  'LESSONS 扫描': '扫描结果：无 active 条目命中（夹具）。',
  '验证命令': VERIFY_COMMAND_BODY,
};

function defaultBody() {
  return '本段按模板要求填写：实质内容（夹具，非模板原文）。';
}

function bodyFor(key, section, opts) {
  for (const [needle, text] of opts.body ?? []) {
    if (section.name.includes(needle)) return text;
  }
  for (const [docKey, needle, text] of BODY_OVERRIDES) {
    if (docKey === key && section.name.includes(needle)) return text;
  }
  return section.conditional === true ? CONDITIONAL_BODY : defaultBody();
}

// 结构子段的正文：opts.body 的段名片段覆盖优先（构造「2.2 下的发现条目」这类子段正文形态），
// 其次段级默认正文（BODY_OVERRIDES，如 REVIEW 2.2 的列表项发现），最后才是通用占位正文。
function subsectionBody(key, name, opts) {
  const override = (opts.body ?? []).find(([needle]) => name.includes(needle));
  if (override) return override[1];
  const registered = BODY_OVERRIDES.find(([docKey, needle]) => docKey === key && name.includes(needle));
  return registered ? registered[2] : '本子段按模板要求填写：实质内容（夹具）。';
}

function matchesAny(name, needles) {
  return (needles ?? []).some((needle) => name.includes(needle));
}

// 渲染工件。opts：
//   title / headerEmpty / omit / rename（[片段, 替换标题]）/ swap（[段A, 段B] 互换位置）/
//   body（[片段, 正文]）/ subsectionOmit / incrementAfter（[增量段, 锚段]）/ insertAfter（[锚段, 文本]）/
//   extra（追加到文末的文本块数组）
function renderDoc(key, opts = {}) {
  const entry = docEntry(key);
  const sections = (entry.sections ?? [])
    .filter((section) => !matchesAny(section.name, opts.omit))
    .map((section) => ({ ...section, heading: section.name }));
  for (const section of sections) {
    const renamed = (opts.rename ?? []).find(([needle]) => section.name.includes(needle));
    if (renamed) section.heading = renamed[1];
  }
  for (const [a, b] of opts.swap ?? []) {
    const ia = sections.findIndex((section) => section.name.includes(a));
    const ib = sections.findIndex((section) => section.name.includes(b));
    if (ia === -1 || ib === -1) throw new Error('夹具构造失败：swap 段不在登记表 ' + a + ' / ' + b);
    const moved = sections.splice(ia, 1)[0];
    sections.splice(ib, 0, moved);
  }

  const header = [opts.title !== undefined ? opts.title : docTitle(key), ''];
  for (const field of entry.headerFields ?? []) {
    header.push('- **' + field + '**: ' + (matchesAny(field, opts.headerEmpty) ? '' : (HEADER_VALUES[field] ?? '夹具值')), '');
  }
  if ((entry.headerFields ?? []).length > 0) header.push('---', '');

  const blocks = [];
  for (const section of sections) {
    const body = bodyFor(key, section, opts);
    const text = ['## ' + section.heading, '', body, ''].join('\n');
    blocks.push({ name: section.name, text });
    for (const [anchor, inserted] of opts.insertAfter ?? []) {
      if (section.name.includes(anchor)) blocks.push({ name: anchor + '#inserted', text: inserted + '\n' });
    }
    // 条件段的正文仍是「不适用」占位 → 父段不适用，其结构子段不必在场；正文被覆盖成实质内容
    // = 父段适用 → 结构子段必须在场（子段缺席即 BLOCK，无 WARN 让步）。不区分这一点会让夹具
    // 自相矛盾：写了实质正文却不带子段，合规判据必然把它判成缺段。
    if (section.conditional === true && body === CONDITIONAL_BODY) continue;
    for (const child of (entry.structureSubsections ?? []).filter((item) => item.parent === section.name)) {
      if (matchesAny(child.name, opts.subsectionOmit)) continue;
      blocks.push({
        name: child.name,
        text: ['### ' + child.name, '', subsectionBody(key, child.name, opts), ''].join('\n'),
      });
    }
  }

  // 增量段（kind=section）：默认把「自检方法」放在「紧随越界检查」这一合法位置（登记表的
  // after-or-end 的 after 分支），其余增量段落文末；incrementAllAtEnd 构造「全部落在文末」的变体，
  // incrementAfter 指定其它位置（用于非法位置的反向构造）。
  const anchors = opts.incrementAllAtEnd === true
    ? []
    : (opts.incrementAfter ?? [['自检方法', '越界检查']]);
  const pending = [];
  for (const increment of entry.increments ?? []) {
    if (increment.kind === 'marker') continue;
    if (matchesAny(increment.section, opts.omit)) continue;
    // 增量段正文同样接受 opts.body 覆盖（命中回应这类「可自定义正文」的判据需要构造正例）；
    // INCREMENT_BODIES 保留为兜底——自检方法段的默认正文是 brooks 判据的输入，不能被 defaultBody() 顶掉。
    const override = (opts.body ?? []).find(([needle]) => increment.section.includes(needle));
    const text = ['## ' + increment.section, '',
      override ? override[1] : (INCREMENT_BODIES[increment.section] ?? defaultBody()), ''].join('\n');
    const anchor = anchors.find(([needle]) => increment.section.includes(needle));
    if (anchor) {
      const idx = blocks.findIndex((block) => block.name.includes(anchor[1]));
      if (idx === -1) throw new Error('夹具构造失败：增量段锚点不在登记表 ' + anchor[1]);
      blocks.splice(idx + 1, 0, { name: increment.section, text });
    } else {
      pending.push({ name: increment.section, text });
    }
  }
  blocks.push(...pending);
  for (const extra of opts.extra ?? []) blocks.push({ name: 'extra', text: extra + '\n' });

  return header.concat(blocks.map((block) => block.text)).join('\n');
}

// ---------- 状态与夹具根 ----------

function newChangeState(node) {
  const st = baseState(node);
  st.newChange = true;
  st.enteredNodes = [node];
  return st;
}

function exitNode(dir, node) {
  return runGuard(['exit', node, '--apply'], dir);
}

function writeBaseline(dir) {
  writeFile(dir, 'baseline.js', 'export const baseline = 1;\n');
}

// UI-DESIGN 工件：frontmatter 顶层键（登记表 frontmatterKeys）+ 模板段形。omitKeys 抽掉某个键，
// 用于「存在但缺 frontmatter 键」的判据；正文按登记表段形渲染。
function uiDesignDoc(opts = {}, omitKeys = []) {
  const keys = docEntry('UI-DESIGN').frontmatterKeys ?? [];
  const values = {
    name: '夹具项目',
    description: '夹具美学定位：温暖纸面编辑式。',
    colors: '  brand: "oklch(0.62 0.12 250)"\n  bg: "oklch(0.98 0.005 90)"',
    typography: '  display:\n    fontFamily: "Fixture Serif, serif"',
    spacing: '  base: "4px"\n  md: "12px"',
    rounded: '  md: "8px"',
    motion: '  fast: "120ms"',
    shadow: '  sm: "0 1px 2px oklch(0 0 0 / 8%)"',
  };
  const lines = ['---'];
  for (const key of keys) {
    if (omitKeys.includes(key)) continue;
    lines.push(key + ':', values[key] ?? '  fixture: true');
  }
  lines.push('---', '', renderDoc('UI-DESIGN', opts));
  return lines.join('\n');
}

// 前端 change 的声明标记：节点自身协议标记（design → 2-design.md）与 ui-design 技能标记
// （guarded 绑定要求真实声明）。两者缺一都会先被证据门 / 标记门拦下，掩盖被测的段形判据。
function writeFrontendDesignMarkers(dir) {
  writeFile(dir, CHANGE_DIR + '/.skill-loads/design-flow-comet-design.json',
    JSON.stringify({
      node: 'design', skill: 'flow-comet-design', protocol: '2-design.md',
      templates: ['DESIGN'], at: '2026-08-01T00:00:00.000Z',
    }, null, 2) + '\n');
  writeFile(dir, CHANGE_DIR + '/.skill-loads/design-flow-comet-ui-design.json',
    JSON.stringify({
      node: 'design', skill: 'flow-comet-ui-design', protocol: '2a-ui-design.md',
      templates: ['UI-DESIGN'], at: '2026-08-01T00:00:00.000Z',
    }, null, 2) + '\n');
}

// 每个 setup 先清空 change 目录与归档目录：同一夹具根里连续构造多组用例时，上一组残留的工件
// （UI-DESIGN.md / .skill-loads/ 声明标记）会让「缺件」「缺声明」一类判据形同虚设。
function resetFixture(dir) {
  for (const rel of [CHANGE_DIR, '.specs/archive']) {
    fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
  }
}

function setupOpen(dir, changeOpts = {}, requirementOpts = {}) {
  resetFixture(dir);
  writeTemplateFixture(dir, 'CHANGE');
  writeTemplateFixture(dir, 'REQUIREMENT');
  writeFile(dir, CHANGE_DIR + '/CHANGE.md', renderDoc('CHANGE', changeOpts));
  writeFile(dir, CHANGE_DIR + '/REQUIREMENT.md', renderDoc('REQUIREMENT', requirementOpts));
  const st = newChangeState('open');
  st.evidence.open = { summary: 'intake complete' };
  writeState(dir, st);
}

function setupDesign(dir, { changeOpts = {}, designOpts = {}, uiDesign = undefined, declareUiDesign = false } = {}) {
  resetFixture(dir);
  writeTemplateFixture(dir, 'CHANGE');
  writeTemplateFixture(dir, 'DESIGN');
  writeFile(dir, CHANGE_DIR + '/CHANGE.md', renderDoc('CHANGE', changeOpts));
  writeFile(dir, CHANGE_DIR + '/DESIGN.md', renderDoc('DESIGN', designOpts));
  if (uiDesign !== undefined) {
    writeTemplateFixture(dir, 'UI-DESIGN');
    writeFile(dir, CHANGE_DIR + '/UI-DESIGN.md', uiDesign);
  }
  const st = newChangeState('design');
  // guarded 绑定的 required-skill 证据：前端 change 必须在证据里声明已加载 ui-design 技能
  st.evidence.design = declareUiDesign
    ? { summary: 'design done', completedChecks: ['required-skill:design.flow-comet-ui-design'] }
    : { summary: 'design done' };
  writeState(dir, st);
}

function setupPlan(dir, taskOpts = {}) {
  resetFixture(dir);
  writeTemplateFixture(dir, 'TASK');
  writeFile(dir, CHANGE_DIR + '/TASK.md', renderDoc('TASK', taskOpts));
  const st = newChangeState('plan');
  st.evidence.plan = { summary: 'plan done' };
  writeState(dir, st);
}

function setupExecute(dir, summaryOpts = {}) {
  resetFixture(dir);
  writeTemplateFixture(dir, 'SUMMARY');
  writeBaseline(dir);
  writeFile(dir, CHANGE_DIR + '/T01-SUMMARY.md', renderDoc('SUMMARY', summaryOpts));
  writeFile(dir, CHANGE_DIR + '/TASK.md', '# TASK\n\n## 任务清单\n\n' + TASK_DONE);
  const st = newChangeState('execute');
  st.evidence.execute = { summary: 'executed' };
  st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
  writeState(dir, st);
}

function setupReview(dir, reviewOpts = {}) {
  resetFixture(dir);
  writeTemplateFixture(dir, 'REVIEW');
  writeFile(dir, CHANGE_DIR + '/REVIEW.md', renderDoc('REVIEW', reviewOpts));
  const st = newChangeState('review');
  st.evidence.review = { summary: 'review done' };
  writeState(dir, st);
}

function setupVerify(dir, testOpts = {}) {
  resetFixture(dir);
  writeTemplateFixture(dir, 'TEST');
  writeBaseline(dir);
  writeFile(dir, CHANGE_DIR + '/TEST.md', renderDoc('TEST', testOpts));
  writeFile(dir, CHANGE_DIR + '/UAT.md', '# UAT\n\n## 验收结果\n\n- 通过（夹具）。\n');
  const st = newChangeState('verify');
  st.evidence.verify = { summary: 'verified' };
  writeState(dir, st);
}

const LESSONS_FIXTURE = [
  '# LESSONS — 跨任务失败知识库（夹具）',
  '',
  '## 条目区（夹具）',
  '',
  '### L-501',
  '',
  '- **关键词**: guard, template',
  '',
  '夹具条目正文：判据必须按结构级校验，不做语义判断。',
  '',
  '### L-502',
  '',
  '- **关键词**: archive, nomination',
  '',
  '夹具条目正文：归档提名须留痕。',
  '',
].join('\n');

function setupArchive(dir, { evidence = {}, lessons = LESSONS_FIXTURE, summaryCount = 2 } = {}) {
  resetFixture(dir);
  writeFile(dir, '.specs/LESSONS.md', lessons);
  for (let i = 1; i <= summaryCount; i += 1) {
    writeFile(dir, CHANGE_DIR + '/T0' + i + '-SUMMARY.md',
      '# SUMMARY: T0' + i + ' - 夹具\n\n## 做了什么\n\n夹具任务。\n');
  }
  writeFile(dir, '.specs/archive/2026-10-20-' + CHANGE_ID + '/KNOWN-ISSUES.md', '# KNOWN-ISSUES\n\n无遗留。\n');
  const st = newChangeState('archive');
  st.evidence.archive = { summary: 'archived', ...evidence };
  writeState(dir, st);
}

function runSideCommand(dir, scriptRel, args) {
  const res = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, scriptRel), ...args], {
    cwd: dir,
    env: { ...process.env, FLOW_COMET_RUN_ROOT: dir, FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

function skillBookText(name) {
  return fs.readFileSync(path.join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
}

function repoFileText(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, ...rel.split('/')), 'utf8');
}

function repoFileExists(rel) {
  return fs.existsSync(path.join(REPO_ROOT, ...rel.split('/')));
}

// 公开面缺席判据（同一实现驱动真实断言与变异探针）：形态判据认定本检出带公开面时（docs/、
// CONTRIBUTING.md 或 .github/ 任一在场，见 lib 的 publicFaceDocsAbsent），该面任何一份文档缺席都是
// 判据失效——「两份机制册都被删」若只落一条 SKIP，公开面机制文档整份消失而套件仍绿。缺席的读法
// 不能由「少了哪份文件」自行决定：只有整份载体俱缺才是合法的「不在本检出」，由调用方输出可见 SKIP
// 并声明未校验。
function publicFaceAbsenceProblems(docs) {
  const missing = [...docs].filter(([, text]) => typeof text !== 'string').map(([rel]) => rel);
  if (missing.length === 0) return [];
  return ['公开面文档不在检出面: ' + missing.join('、')
    + '（形态判据认定本检出带公开面，未走跳过通道；文档缺席即判据失效，不是「本次未校验」）'];
}

// 文本判据（同一函数驱动真实断言与变异探针）：rules = [{ rel, label, include[], exclude[] }]。
function textRuleProblems(docs, rules) {
  const problems = [];
  for (const rule of rules) {
    const text = docs.get(rule.rel);
    if (typeof text !== 'string') {
      problems.push(rule.rel + ' 不在判据面内（' + rule.label + '）');
      continue;
    }
    for (const needle of rule.include ?? []) {
      if (!text.includes(needle)) problems.push(rule.rel + ' 缺「' + needle + '」（' + rule.label + '）');
    }
    for (const needle of rule.exclude ?? []) {
      if (text.includes(needle)) problems.push(rule.rel + ' 仍含旧表述「' + needle + '」（' + rule.label + '）');
    }
  }
  return problems;
}

// 变异探针：同一判据函数驱动——正向探针（把目标文字抽掉 / 改回旧表述 ⇒ 必须报），反向探针
// （把缺失的目标文字补上 ⇒ 必须不再报，证明判据不恒真）。判别力不能只靠「判据能报违规」证。
function assertProbesDiscriminate(problems, docs, rules, probes) {
  for (const [label, rel, mutate, expected, expectReported = true] of probes) {
    const before = docs.get(rel);
    const probed = new Map(docs).set(rel, mutate(before));
    if (probed.get(rel) === before) {
      problems.push('反向构造前提失效（' + label + '）：变异未改变 ' + rel);
      continue;
    }
    const reported = textRuleProblems(probed, rules).some((problem) => problem.includes(expected));
    if (reported !== expectReported) {
      problems.push('反向构造判别力缺失（' + label + '：' + (expectReported ? '未被判违规' : '被误判违规') + '）');
    }
  }
}

// 公开面自检的**形态分派**（判定本体在 lib：publicFaceSelfCheck）——各载体形态各造一个临时根、驱动
// 同一判定，分派对错因此成为常驻断言，不必等到在包形态里整跑一次套件才知道：
//   ① 包形态（技能树锚在场、docs/ + CONTRIBUTING.md + .github/ 三者俱缺）→ SKIP 通知 + 零问题：
//      这种载体本来就不带公开面，「受检条目不在场」是它的正常形态；报成幽灵条目会把读者送去修一个
//      不存在的缺陷；
//   ② 权威源形态完整（受检面文件照真迹复制，计数自然同步）→ 零问题（判据不是恒红的摆设）；
//   ③ 同一根上移走一份受检文档（docs/VERSIONS.md）→ 必须报问题并点名该文件——跳过通道只对
//      「整份公开面不存在」开放，判据没有顺手放宽；
//   ④ 安装副本形态（无技能树锚）→ 词表镜像判据的「不适用」说明 + 零问题；
//   ⑤ 半包形态（docs/ 整份不在，但 CONTRIBUTING.md 或 .github/ 在场）→ 必须照跑全判据并判红：
//      这两份同样不进 npm tarball，任一在场即证明本检出是仓库（只是被裁坏了）；只按 docs/ 分流会让
//      分支 / 稀疏检出 / 误删把整块判据变成 SKIP 并 exit 0。
// 形态本身同样由既有判据派生（技能树锚 + publicFaceDocsAbsent），夹具不另写一套形态判据。

// 受检面文件清单（照真迹复制的范围）= 公开产物零代号清单 ∪ 计数受检清单 ∪ 词表私有面：
// 三面齐了同一次判定才可能零问题——少一面就会以问题形态暴露，夹具不会悄悄缩小判据面。
function countFaceFiles() {
  return [...new Set([
    ...PUBLIC_FACE_CODE_DOCS, ...SCENARIO_COUNT_FILES, ...SYSTEM_TEST_COUNT_FILES, GITHOOKS_CODES_REL,
  ])];
}

function copyRepoFileInto(root, rel) {
  const parts = rel.split('/');
  const dest = path.join(root, ...parts);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, ...parts), dest);
}

async function assertPublicFaceSelfCheckShapes(dir) {
  const shapeRoot = (name, { authoritative = true } = {}) => {
    const root = path.join(dir, 'shape-' + name);
    fs.mkdirSync(root, { recursive: true });
    // 技能树锚点：与真实检出同一相对位置（路径字面量由 lib 单点拥有，不在此重写）
    if (authoritative) writeFile(root, AUTHORITATIVE_SOURCE_ANCHOR_REL, '---\nname: flow-comet\n---\n');
    return root;
  };
  const describe = (result) => result.problems.map((problem) => problem.name + ': ' + problem.error).join('; ')
    || '（零问题）';
  // ① 包形态（docs/ + CONTRIBUTING.md + .github/ 三者俱缺）：分派若改成「照跑全套」，这里会报一串
  // 「受检条目文件缺失（幽灵条目）」——正是要拦的形态
  const packaged = await publicFaceSelfCheck({ root: shapeRoot('package') });
  if (packaged.problems.length > 0) {
    throw new Error('包形态（技能树锚在、docs/ 与 CONTRIBUTING.md / .github/ 俱缺）不得报问题——'
      + '受检条目不在场是这种载体的正常形态，报出来就是幽灵条目: ' + describe(packaged));
  }
  if (packaged.skip === null || packaged.skip.reason !== 'package-without-public-face') {
    throw new Error('包形态应命中显式跳过分支（skip.reason=package-without-public-face）: '
      + JSON.stringify(packaged.skip));
  }
  if (!packaged.skip.notice.includes('未校验')) {
    throw new Error('包形态的跳过提示必须写明「未校验」（跳过 ≠ 通过）: ' + packaged.skip.notice);
  }
  // ② 权威源形态完整：受检面文件照真迹复制，计数自然同步（不硬编码数字）
  const full = shapeRoot('authoritative');
  for (const rel of countFaceFiles()) copyRepoFileInto(full, rel);
  const complete = await publicFaceSelfCheck({ root: full });
  if (complete.problems.length > 0) {
    throw new Error('权威源形态完整（受检面文件照真迹复制）不应报问题: ' + describe(complete));
  }
  // ③ 同一根上移走一份受检文档：跳过通道只对「整份公开面不存在」开放，缺一份必须判红并点名
  const removedDoc = 'docs/VERSIONS.md';
  fs.rmSync(path.join(full, ...removedDoc.split('/')));
  const truncated = await publicFaceSelfCheck({ root: full });
  if (!truncated.problems.some((problem) => problem.error.includes(removedDoc))) {
    throw new Error('权威源形态里移走一份受检文档必须报问题并点名该文件（判据不得因形态分派而放宽）: '
      + describe(truncated));
  }
  // ④ 安装副本形态：无技能树锚 = 主仓私有面结构性缺席 → 「不适用」说明，不误红
  const installed = await publicFaceSelfCheck({ root: shapeRoot('installed', { authoritative: false }) });
  if (installed.problems.length > 0 || installed.skip === null
    || installed.skip.reason !== 'installed-copy-without-skill-tree') {
    throw new Error('安装副本形态（无技能树锚）应命中「不适用」分支且零问题: '
      + JSON.stringify(installed.skip) + ' / ' + describe(installed));
  }
  if (!installed.skip.notice.includes('不适用')) {
    throw new Error('安装副本形态的跳过提示必须写明「不适用」（不适用 ≠ 已校验）: ' + installed.skip.notice);
  }
  // ⑤ 半包形态（docs/ 整份不在，但 CONTRIBUTING.md 或 .github/ 在场）：必须是判红，不得复用包形态的
  // 跳过通道——否则分支 / 稀疏检出 / 误删把 docs/ 拿掉时，计数一致性、公开产物零代号与词表镜像会整块
  // 变成可见 SKIP 并 exit 0。两份载体分开造根：任一单独在场都足以证明本检出是仓库而不是「本来不带
  // 公开面」的 npm 包 / 安装副本（两者都不进 npm tarball；README 会被 npm 强制包含，不作判据）。
  for (const carrier of ['CONTRIBUTING.md', '.github/workflows/ci.yml']) {
    const partial = shapeRoot('docs-less-' + carrier.split('/')[0].replace(/\./g, ''));
    writeFile(partial, carrier, '');
    const partialResult = await publicFaceSelfCheck({ root: partial });
    if (partialResult.skip !== null) {
      throw new Error('docs/ 不在但 ' + carrier + ' 在场不得命中跳过分支（skip.reason='
        + partialResult.skip.reason + '）——该形态下公开面判据会整块变成 SKIP 并 exit 0');
    }
    if (!partialResult.problems.some((problem) => problem.name === '计数一致性')) {
      throw new Error('docs/ 不在但 ' + carrier + ' 在场时必须照跑计数一致性并判红，实际: '
        + describe(partialResult));
    }
  }
}

// 机制表行判据（同一函数驱动真实断言与变异探针）。机制行按**结构**定位，不按「首个含某组词的行」：
// 文档正文随时可能为另一条修正补进既含「段名」又有 plan 的段落，词形判据会被它抢位（已实证的失效形态）。
// 结构 = markdown 表格的数据行（表头 + 分隔行 + 连续 | 行）；机制行取其中末列（适用面列）点名出口名
// 最多的那一行——那正是「这套形状校验适用于哪些出口」的口径声明。
const EXIT_NODES = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify', 'archive'];

function markdownTableRows(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])) continue;
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push({ index: j, raw: lines[j] });
    i = j - 1;
  }
  return rows;
}

function markdownCells(raw) {
  // 本仓公开文档的表格单元格不含转义竖线，故按 | 直接切分。
  return raw.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function findMechanismRow(text) {
  let best = null;
  for (const row of markdownTableRows(text)) {
    const appliesTo = markdownCells(row.raw).pop() ?? '';
    const exits = EXIT_NODES.filter((node) => appliesTo.includes('`' + node + '`'));
    if (best === null || exits.length > best.exits.length) best = { ...row, appliesTo, exits };
  }
  return best !== null && best.exits.length > 0 ? best : null;
}

// 机制行必须覆盖全部 8 个出口（旧表只列 5 个）：抽掉任一出口即判违规，判据不放宽。
function mechanismRowProblems(docs) {
  const problems = [];
  for (const rel of ['docs/MECHANISM-zh.md', 'docs/MECHANISM.md']) {
    const text = docs.get(rel);
    if (typeof text !== 'string') continue; // 缺席面由调用方的缺席判据逐份点名（本函数只判在场的机制行）
    const row = findMechanismRow(text);
    if (row === null) {
      problems.push(rel + ' 缺「节点文档是否符合模板」机制行（无法核对出口面）');
      continue;
    }
    for (const node of EXIT_NODES) {
      if (!row.exits.includes(node)) problems.push(rel + ' 机制行未覆盖出口 ' + node + '（口径落后于门禁范围）');
    }
  }
  return problems;
}

// 失效形态复现用：旧判据「首个同时含『段名』且匹配 open|design|plan 的行」。只被正锚探针用来确认
// 「插入的段落确实会被旧判据抢位」——证明正锚构造有效，不参与真实断言。
function legacyMechanismLine(text) {
  return text.split(/\r?\n/).find((line) => line.includes('段名') && /open|design|plan/.test(line)) ?? '';
}

// ---------- 段体切片形态探针（段体单源锁的判据面） ----------

// 一份「按标题切段体」的实现 = 三种写法之一（A/B/C）写在两种位置之一（D = 对象属性箭头）；判定粒度是
// **具名代码单元**（`functionBodies` 切出的顶层函数体、`objectLiteralArrowBodies` 切出的对象属性箭头体），
// 形态命中按「文件 + 名称」登记，与取用面的「文件 + 符号」同一粒度：
//   A 行扫描：同一单元里三件事齐备——① 段头判定（行首 ATX 标题正则，或以其为模式串的 RegExp
//     构造）② 在判定处收尾（break）③ 把原始行拼成段体（+= line / push(line…) / slice(…).join(…)）；
//   B 正则切片：同一单元里出现「从段头截到下一个段头」的正则 idiom——惰性 `[\s\S]` 片段配
//     `(?=…\n## …)` 前瞻，或 `.split(/\n## …/)` 按标题行切；
//   C 字符串字面量切分：段界写成字符串而不是正则——`.split('\n## …')` / `.indexOf('## …')`
//     （B 的判据要求正则字面量，同一件事换个写法就整份躲在锁外）；
//   D 位置：以上任一写法写进**对象字面量的内联箭头**（`passes: (t) => { … }`）——顶层函数切分只看
//     `function NAME` / `const NAME = () => {`，属性值的箭头体它看不见。
// 缺任一件都不算：围栏状态过滤器没有段头判定，条目块收集器不在标题处收尾，键解析器把行拆成字段。
// 段头判定的正则形态覆盖三种写法：`/^#…`、`/^(#{1,6})…`（标题等级写成捕获组）与 `.startsWith('#')`。
// 旧判定只认「`/^#` 紧邻」一种形态，`^(#{1,6})` 这种带捕获组的写法整份躲在锁外——context-init 的
// 私有段体切片正是此形态，受检面扩面时一并修掉。
const SECTION_HEADING_TEST_RE = /\/\^\(?#{1,6}|['"]\^\(?#{1,6}|\.startsWith\(\s*['"]#/u;
const SECTION_BREAK_RE = /\bbreak\b/u;
const SECTION_BODY_ACCUMULATION_RE = /\+=\s*line\b|\.push\(\s*line\b|\.push\(\s*lines\[|\.slice\([^)]*\)\.join\(/u;

// 顶层函数体（function 声明 / const NAME = (…) => {…}）按花括号配对切。注释与字符串里的花括号会让配对
// 偏一档，只影响检出精度、不影响判据方向：误报会显式红，漏报由行为断言兜住。
// 花括号配对切体（唯一一处）：从起始行切到配对闭合的那一行（含首末行）。顶层函数体与对象属性箭头体
// 共用它——两处各写一份配对循环时，其中一处改了口径（例如只认 `}` 起头的行）另一处不会跟上。
function bracedBodyFrom(lines, startIndex) {
  let depth = 0;
  let started = false;
  const body = [];
  for (let line = startIndex; line < lines.length; line += 1) {
    for (const ch of lines[line]) {
      if (ch === '{') { depth += 1; started = true; } else if (ch === '}') depth -= 1;
    }
    body.push(lines[line]);
    if (started && depth <= 0) break;
  }
  return body.join('\n');
}

function functionBodies(code) {
  const lines = String(code).split('\n');
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const matched = lines[index].match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/u)
      ?? lines[index].match(/^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>\s*\{/u);
    if (matched === null) continue;
    out.push({ name: matched[1], text: bracedBodyFrom(lines, index) });
  }
  return out;
}

// A 形态（行扫描）：在段头判定处 break，再把原始行拼成段体。
function isLineScanSlicer(text) {
  return SECTION_HEADING_TEST_RE.test(text)
    && SECTION_BREAK_RE.test(text)
    && SECTION_BODY_ACCUMULATION_RE.test(text);
}

// B 形态（正则切片）：段界写在一对正则里——截取式（`[\s\S]` 片段 + 前瞻 `(?=` + 前瞻里出现 `\n##`）
// 或切分式（`.split(/\n## …/)`）。两条都要求「标题行」在场：没有标题就没有段界，也就不是段体切片——
// 只按行宽 / 标点切分的实现不在此列。
const SECTION_SLICE_EXCERPT_RE = /\[\s*\\s\\S\s*\]/u;
const SECTION_SLICE_FORWARD_LOOK_RE = /\(\?=/u;
const SECTION_SLICE_HEADING_BOUNDARY_RE = /\\n#{1,6}/u;
const SECTION_SLICE_SPLIT_RE = /\.split\(\s*\/[^/\n]*\\n#{1,6}/u;

function isRegexSlicer(text) {
  return text.split('\n').some((line) => SECTION_SLICE_EXCERPT_RE.test(line)
      && SECTION_SLICE_FORWARD_LOOK_RE.test(line)
      && SECTION_SLICE_HEADING_BOUNDARY_RE.test(line))
    || SECTION_SLICE_SPLIT_RE.test(text);
}

// C 形态（字符串字面量切分）：段界写成字符串字面量——`.split('\n## …')` / `.indexOf('## …')`。
// 与 B 同义（按标题行切段）而写法不同：B 的两条判据都要求正则字面量，同一件事换个写法就整份在锁外
// （context-init 的「已锁决策」格式检查正是这一形态，静态锁因此判它绿）。
const SECTION_SLICE_STRING_BOUNDARY_RES = [
  /\.split\(\s*['"]\\n#{1,6}/u,
  /\.indexOf\(\s*['"]#{1,6}[\s'"]/u,
];

function isStringLiteralSlicer(text) {
  return SECTION_SLICE_STRING_BOUNDARY_RES.some((boundary) => boundary.test(text));
}

// 对象字面量内联箭头（`passes: (t) => { … }`）：属性值的箭头体。顶层函数切分（functionBodies）只看
// `function NAME` / `const NAME = () => {`，写进对象属性就躲开了形态面。符号名取属性键——登记粒度与
// 「文件 + 符号」一致，属性名在同一文件内重名时按「文件 + 属性名」合并（与第二份定义同名的处置相同）。
function objectLiteralArrowBodies(code) {
  const lines = String(code).split('\n');
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const matched = lines[index].match(/^\s*([A-Za-z0-9_$]+)\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>\s*\{/u);
    if (matched === null) continue;
    out.push({ name: matched[1], text: bracedBodyFrom(lines, index) });
  }
  return out;
}

// 形态面 = 两种位置 × 三种写法的全部命中：写法判定各是一份谓词，位置只决定在哪一堆具名单元上套用。
// 位置面的盲区（D：对象字面量内联箭头）因此不与写法面各写一套——旧的锁只看顶层函数，把同一件事写进
// 对象属性就整份躲开了。
const SECTION_SLICE_FORM_PREDICATES = [isLineScanSlicer, isRegexSlicer, isStringLiteralSlicer];

function sectionSliceHits(code) {
  const hitsIn = (units) => units
    .filter((unit) => SECTION_SLICE_FORM_PREDICATES.some((matches) => matches(unit.text)))
    .map((unit) => unit.name);
  return [...new Set([...hitsIn(functionBodies(code)), ...hitsIn(objectLiteralArrowBodies(code))])];
}

// 单源的导出符号集：只有它们受「导出实现恰一处 / 不得自带第二份定义 / 必须具名取用」约束。
const SECTION_SOURCE_SYMBOLS = ['sectionBody', 'scanHeadings'];

// 段体单源锁的**登记表**：把面内仍存在的同类实现逐条登记（文件 + 符号 + 理由三件齐备）。登记是
// 让缺口可见，不是放行：
//   · 只覆盖 ③ 形态命中这一条判据；② 的单源符号第二份定义 / 未取用**不接受豁免**——否则登记一个
//     sectionBody 副本就能让真实副本静默通过（旧锁把 `continue` 放在符号判定之前，正是如此）；
//   · 条目必须**当场命中**（该文件该函数此刻仍在形态面上）：修好或改名后未删 ⇒ 陈旧，判红。
// 受检面 = 引擎实现面（与 `engineScriptTexts` 同一派生口径：顶层入口 ∪ 静态可达模块 ∪ 非套件自持的
// `lib/**`）。套件自持面（`scenarios/**`、`items/**`、只被套件入口可达的 lib 模块）是夹具与其自身
// 判据，不在引擎面上——把它们算进来会让锁去登记自己用的行扫描辅助（形态探针本身），判据反而失真。
const SECTION_SLICE_REGISTRY = [
  {
    file: 'health.mjs',
    symbol: 'collectDebt',
    // 这一条是**能力差异**，不是同一件事的第二份实现：技术债段体的段界要与**段标题自身的层级**比较
    // （`## 技术债` + `### 明细` 里的子标题属于段内，不是段边界——按固定级别截断会把子标题之后的
    // 表格整段丢掉），而这个层级还要随读数回传给「复现命令」（命令里的段级必须取自同一处，否则
    // `## 技术债` 的项目照抄命令就复现不出本报告的读数）。单源的 sectionBody 两项能力都给不了：
    // 它只接受一个固定的结束级别，且只返回段体正文、不返回命中的标题。
    // **合并条件**：section-body.mjs 增加「段体 + 命中标题（含层级）」的返回形态后，health.mjs 改用它，
    // 本条登记即可删除——届时锁会以「登记已陈旧」提醒（陈旧登记判红，不是静默留着）。
    reason: '能力差异：段界要与段标题自身的层级比较，且该层级需回传给「复现命令」——'
      + 'sectionBody 只接受固定结束级别、只返回段体正文，两项都给不了；'
      + '合并条件 = section-body 增加「段体 + 命中标题层级」的返回形态后改用单源并删除本条。',
  },
];

// 段体单源判据（纯函数 + 合成输入可驱动）：given = Map(相对路径 → 文本)，registry = 登记表。
//   ① 单源模块由**导出面**派生（不写文件名）：导出实现恰一处，且 {sectionBody, scanHeadings} 都定义
//      在那里；
//   ② **取用面** = 面内提到单源符号的模块：必须具名取用，不得自带第二份定义、不得改从别处取用；
//   ③ **形态面** = 面内**全部**模块的全部具名代码单元（顶层函数 ∪ 对象字面量内联箭头）——受检面不再
//      只是取用面：把一份私有实现搬进一个不引用该符号的模块就躲不开了；形如切段体者只许是单源本身，
//      其余必须登记。写法面 = A 行扫描 / B 正则切片 / C 字符串字面量切分（B 的判据要求正则字面量，
//      C 是同一件事的另一种写法）；位置面 = 顶层函数 / 对象字面量内联箭头（后者是 functionBodies 的盲区）。
// 返回问题描述数组（空 = 收口）。
function sectionSingleSourceProblems({ texts: given, registry = SECTION_SLICE_REGISTRY }) {
  const problems = [];
  const exported = [...given.entries()]
    .filter(([, text]) => /export\s+(?:async\s+)?function\s+sectionBody\b|export\s+const\s+sectionBody\s*=/u
      .test(engineCodeText(text)))
    .map(([rel]) => rel);
  if (exported.length !== 1) {
    problems.push('sectionBody 的导出实现应恰一处，实际 ' + JSON.stringify(exported));
    return problems;
  }
  const sourceRel = exported[0];
  const sourceText = given.get(sourceRel) ?? '';
  for (const symbol of SECTION_SOURCE_SYMBOLS) {
    if (!engineDefinitionPattern(symbol).test(sourceText)) {
      problems.push(sourceRel + ' 未定义段体单源的 ' + symbol);
    }
  }
  const mentionRe = /\b(?:sectionBody|scanHeadings)\b/u;
  const consumers = [...given.keys()].filter((rel) => rel !== sourceRel
    && mentionRe.test(engineCodeText(given.get(rel) ?? '')));
  if (consumers.length < 5) {
    problems.push('段体消费面不足五处（由真实引用派生）: ' + JSON.stringify(consumers));
  }
  for (const rel of consumers) {
    const code = engineCodeText(given.get(rel));
    for (const symbol of SECTION_SOURCE_SYMBOLS) {
      if (!new RegExp('\\b' + symbol + '\\b', 'u').test(code)) continue;
      if (engineDefinitionPattern(symbol).test(code)) {
        problems.push(rel + ' 自带第二份 ' + symbol + ' 定义（应取用单一来源；登记不覆盖单源符号的副本）');
        continue;
      }
      if (!engineImportsSymbolFrom({ text: given.get(rel), consumerRel: rel, symbol, sourceRel, texts: given })) {
        problems.push(rel + ' 未从 ' + sourceRel + ' 取用 ' + symbol);
      }
    }
  }
  const hits = [];
  for (const [rel, text] of given) {
    if (rel === sourceRel) continue;
    const code = engineCodeText(text);
    for (const symbol of sectionSliceHits(code)) {
      if (hits.some((hit) => hit.rel === rel && hit.symbol === symbol)) continue;
      hits.push({ rel, symbol });
    }
  }
  for (const hit of hits) {
    const entry = registry.find((item) => item.file === hit.rel && item.symbol === hit.symbol);
    if (entry === undefined) {
      problems.push(hit.rel + ' 自带段体切片实现 ' + hit.symbol
        + '（段界应只由 ' + sourceRel + ' 决定；确属另一件事则在锁里登记文件 + 符号 + 理由）');
      continue;
    }
    if (SECTION_SOURCE_SYMBOLS.includes(hit.symbol)) {
      problems.push(hit.rel + ' 的 ' + hit.symbol + ' 是单源符号的副本——登记不能放行真实副本');
      continue;
    }
    if (String(entry.reason ?? '').trim() === '') {
      problems.push(hit.rel + ' 的 ' + hit.symbol + ' 登记缺理由（登记是让缺口可见，不是静默放行）');
    }
  }
  for (const entry of registry) {
    if (!hits.some((hit) => hit.rel === entry.file && hit.symbol === entry.symbol)) {
      problems.push('登记已陈旧：' + entry.file + ' 的 ' + entry.symbol
        + ' 不再是段体切片形态（收口或改名后请删除该登记）');
    }
  }
  return problems;
}

// 本任务收口的三处私有实现（原样搬回）：静态判据只读文本、不执行变异体——探针证明「改回私有实现 ⇒
// 锁必红」。每条 edits 的锚文本若漂移，调用方报「锚已漂移」（不静默跳过：否则探针会退化成恒绿）。
// 旧实现一律用 String.raw 模板保存：里面的 `\uFEFF` / `\r?\n` 是字面量，不该被再次转义。
const REVERTED_PRIVATE_SLICERS = [
  {
    label: 'guard-uidesign 的「视觉调性」段体改回围栏盲的行扫描',
    rel: 'lib/guard-uidesign.mjs',
    symbols: ['visualToneSectionState'],
    edits: [[
      String.raw`  const body = sectionBody(text, headingPattern, { level: 2, endOnSeparator: false });`,
      String.raw`  let body = null;
  for (const line of String(text).replace(/\uFEFF/g, '').split(/\r?\n/)) {
    if (/^##\s+/.test(line)) {
      if (body !== null) break; // 到达下一个 H2 → 本段结束
      if (headingPattern.test(line)) body = '';
      continue;
    }
    if (body !== null) body += line + '\n';
  }`,
    ]],
  },
  {
    label: 'guard-evidence-gates 的「6 维自查」/「自检方法」段体改回两条正则切片',
    rel: 'lib/guard-evidence-gates.mjs',
    symbols: ['summarySixDimBody', 'summarySelfCheckMethodBody'],
    edits: [
      [
        String.raw`function summarySixDimBody(content) {
  return sectionBody(content, SIX_DIM_HEADING_PATTERN, { level: 2, endOnSeparator: true });
}`,
        String.raw`function summarySixDimBody(content) {
  const sixDim = content.match(/##\s*6\s*维自查[\s\S]*?(?=\n##\s|\n---|(?![\s\S]))/i);
  return sixDim === null ? null : sixDim[0];
}`,
      ],
      [
        String.raw`function summarySelfCheckMethodBody(content) {
  return sectionBody(content, SELF_CHECK_METHOD_HEADING_PATTERN, { level: 2, endOnSeparator: true });
}`,
        String.raw`function summarySelfCheckMethodBody(content) {
  const methodMatch = content.match(/##\s*自检方法(?:[（(][^）)\n]*[）)])?\s*\n([\s\S]*)/i);
  return methodMatch ? methodMatch[1].split(/\n##\s|\n---/)[0] : null;
}`,
      ],
    ],
  },
  {
    label: 'context-init 改回同名私有 sectionBody（(body, headingName) 变体）',
    rel: 'context-init.mjs',
    symbols: ['sectionBody'],
    edits: [[
      String.raw`function contextSectionBody(structureText, headingName) {
  const wanted = normalizeSectionName(headingName);
  return sectionBody(
    structureText,
    (heading) => heading.level === 2 && normalizeSectionName(heading.text) === wanted,
    { level: 2, endOnSeparator: false },
  );
}`,
      String.raw`function sectionBody(body, headingName) {
  const wanted = normalizeSectionName(headingName);
  const kept = [];
  let inSection = false;
  for (const line of String(body ?? '').split('\n')) {
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (inSection && level <= 2) break; // 到下一个同级或更高级标题即段结束
      if (!inSection && level === 2 && normalizeSectionName(heading[2]) === wanted) {
        inSection = true;
        continue;
      }
    }
    if (inSection) kept.push(line);
  }
  return inSection ? kept.join('\n') : null;
}`,
      ],
      // 调用点也一并改回旧名：变异体因此是一份自洽的「改动之前的文件」，而不是半截替换。
      ['contextSectionBody(t, EVOLVE_METADATA_SECTION)', 'sectionBody(t, EVOLVE_METADATA_SECTION)'],
    ],
  },
];

// ---------- 任务对键形态探针（配对键单源锁的判据面） ----------

// 「任务对键」= 无序任务对的键：两个 id 先比较定序，再用一个**字符串字面量**当分隔符拼起来
// （`a < b ? a + '\u0000' + b : b + '\u0000' + a`）。判据按**形态**判定，不看名字也不看分隔符取值：
// 历史上的第二份实现叫 `gapPairKey`（与第一份不同名），换 `|` 一类分隔符的漂移也同样是第二份实现——
// 按标识符名计数的锚对这两种形态都判绿（这正是本判据要补的盲区）。
const PAIR_KEY_ORDER_RE = /\b([A-Za-z0-9_$]+)\s*<\s*([A-Za-z0-9_$]+)\s*\?/u;

function pairKeyForm(text) {
  const order = PAIR_KEY_ORDER_RE.exec(String(text ?? ''));
  if (order === null) return false;
  const [, left, right] = order;
  if (left === right) return false;
  // 分隔符只认「字符串字面量夹在两个标识符之间」：`left + '<任意字面量>' + right`（两种定序各判一次）。
  // 标识符里的 `$` 是正则元字符：直接拼进模式会被当作串尾锚，含它的键因此被静默漏检（探针的假绿形态）。
  const escaped = (identifier) => identifier.replace(/\$/gu, '\\$');
  const joined = (first, second) => new RegExp(
    '\\b' + escaped(first) + '\\s*\\+\\s*[\'"`][^\'"`]*[\'"`]\\s*\\+\\s*\\b' + escaped(second) + '\\b', 'u');
  return joined(left, right).test(text) || joined(right, left).test(text);
}

// 配对键单源判据（纯函数 + 合成输入可驱动）：返回问题数组（空 = 收口）。
//   ① 形态面：「任务对键」形态在引擎面内只许出现一处（键只有一份实现）；
//   ② 落点：那一处必须就在产出第三族的模块里（键与它的生产者同源；落点由定义面反查，不写文件名）；
//   ③ 消费方：补集判据所在的模块不得持有任何键形态——它消费 task-graph 返回的判定（谓词），
//      不自己比 id（第二份键的形态一旦漂移，两端键就不再相等，补集判据会静默失效）。
function pairKeySingleSourceProblems({ texts }) {
  const problems = [];
  const hits = [];
  for (const [rel, text] of texts) {
    for (const unit of [...functionBodies(text), ...objectLiteralArrowBodies(text)]) {
      if (pairKeyForm(unit.text)) hits.push({ rel, symbol: unit.name });
    }
  }
  if (hits.length !== 1) {
    problems.push('任务对键应恰一处实现，实际: ' + JSON.stringify(hits));
    return problems;
  }
  const producer = engineDefinitionModule('collectCrossTaskConflicts');
  if (producer === null) {
    problems.push('第三族产出的定义面不唯一（反查失败）: '
      + JSON.stringify(engineDefinitionHits('collectCrossTaskConflicts')));
    return problems;
  }
  if (hits[0].rel !== producer.file) {
    problems.push('任务对键落在 ' + hits[0].rel + '（应与第三族产出同源: ' + producer.file + '）');
  }
  const consumer = engineDefinitionModule('parallelGapReview');
  if (consumer !== null && hits.some((hit) => hit.rel === consumer.file)) {
    problems.push(consumer.file + ' 自建任务对键（补集判据应消费 ' + producer.file + ' 返回的判定）');
  }
  return problems;
}

export const ENTRIES = [

  // ============================================================================================
  // 产出物结构（七类工件）
  // ============================================================================================

  // TA-01 · 七类产出物缺段被拦（AC-1）——每类取一个夹具：缺模板中的一个必填 H2 → BLOCKED，报文含
  // 模板路径与「缺段」类别计数；首次**不列具体段名**（段名清单留到再犯时给，见 TA-15）。
  // 反向构造：同夹具补回该段 → 通过（旧逻辑对这批段本就不查，故负例在旧实现上必然放过）。
  {
    name: 'TA-01 七类产出物缺必填 H2：各节点出口 BLOCKED（含模板路径与缺段计数），补回后通过',
    run: async (dir) => {
      const cases = [
        { doc: 'CHANGE', node: 'open', omit: '影响面', setup: setupOpen },
        { doc: 'REQUIREMENT', node: 'open', omit: '非功能性需求', setup: (root, opts) => setupOpen(root, {}, opts) },
        { doc: 'DESIGN', node: 'design', omit: '风险', setup: (root, opts) => setupDesign(root, { designOpts: opts }) },
        { doc: 'TASK', node: 'plan', omit: '阻塞日志', setup: setupPlan },
        { doc: 'SUMMARY', node: 'execute', omit: '是否触发新工作', setup: setupExecute },
        { doc: 'REVIEW', node: 'review', omit: '总结', setup: setupReview },
        { doc: 'TEST', node: 'verify', omit: '新增测试登记', setup: setupVerify },
      ];
      for (const item of cases) {
        const label = item.doc + ' 缺「' + item.omit + '」';
        // ① 负例：缺段 → BLOCKED，且报文带模板路径与缺段类别
        item.setup(dir, { omit: [item.omit] });
        const blocked = exitNode(dir, item.node);
        assertTrue(blocked.status === 1, label + ' 应被拦（exit 1），实际 exit ' + blocked.status + '\n' + blocked.output);
        assertOut(blocked, 'BLOCKED');
        assertOut(blocked, 'flow-kit/templates/' + docBase(item.doc));
        assertTrue(/缺段[^\n]{0,12}\d/.test(blocked.output), label + ' 报文应含「缺段」类别与计数，实际: ' + blocked.output);
        // 首次不列段名：抽掉的段名不得出现在报文里（否则「先读模板」的引导被绕过）
        assertNotOut(blocked, item.omit);
        // ② 反向构造：补回该段 → 通过
        item.setup(dir);
        const passed = exitNode(dir, item.node);
        assertTrue(passed.status === 0, '补回「' + item.omit + '」后应通过，实际 exit ' + passed.status + '\n' + passed.output);
        assertOut(passed, 'ALL CHECKS PASSED');
      }
    },
  },

  // TA-02 · H3 结构子段纳入、示例条目排除（AC-2）——① TEST 缺 1.5 结构子段 → BLOCKED；
  // ② SUMMARY 缺「已知接受 + 理由」→ BLOCKED；③ 示例条目（🔴 / ADR- / AC- / L- 形态）未出现
  // **不算缺段**（正例即「无任何示例条目的工件必须放行」）。
  {
    name: 'TA-02 H3 结构子段缺则拦（TEST 1.5 / SUMMARY 已知接受 + 理由），示例条目不参与骨架 + review 出口的 AC 覆盖汇总 WARN（段名走骨架）',
    run: async (dir) => {
      // ① TEST 缺结构子段
      setupVerify(dir, { subsectionOmit: ['测试质量自检'] });
      const resTest = exitNode(dir, 'verify');
      assertExit(resTest, 1);
      assertOut(resTest, '测试质量自检');
      // ② SUMMARY 缺结构子段
      setupExecute(dir, { subsectionOmit: ['已知接受'] });
      const resSummary = exitNode(dir, 'execute');
      assertExit(resSummary, 1);
      assertOut(resSummary, '已知接受');
      // ③ 反向构造：示例条目缺席不算缺段（正例；旧口径把示例当骨架即误拦）
      const exampleFree = renderDoc('TEST');
      assertTrue(!/🔴|ADR-\d|L-\d{3}/.test(exampleFree), '夹具前提不成立：正例正文不该含示例条目形态');
      setupVerify(dir);
      const resBaseline = exitNode(dir, 'verify');
      assertExit(resBaseline, 0);
      assertOut(resBaseline, 'ALL CHECKS PASSED');
      // ④ 反向构造（判别力）：被抽掉的 TEST 子段确实来自登记表骨架，而不是标题巧合
      const registered = (docEntry('TEST').structureSubsections ?? []).map((s) => s.name).join('\n');
      assertTrue(registered.includes('测试质量自检'), '登记表未登记 TEST 的 1.5 结构子段——判据无处生根');

      // ⑤~⑧ AC 覆盖与 1.1 矩阵段（review 出口只汇总、不阻断）：
      //   · 验收段与 1.1 矩阵段的段名都从骨架派生（模板权威单链，判据不自写标题正则）——省编号 /
      //     省括号的宽容写法同样命中（⑥），矩阵段换成无关标题即「不可判」而不是「全覆盖」（⑦）；
      //   · review 出口对缺覆盖只给**一条**汇总 WARN（列缺失编号），退出码不变（AC-8）；
      //   · 无 TEST.md 时不打该 WARN（review 出口今天不要求 TEST.md，判据无从求值就不制造噪音）。
      const acBody = (ids) => (ids.length > 0
        ? ids.map((id) => '### ' + id + ' · 夹具准则\n\n- **Given** 夹具前置\n- **When** 夹具动作\n- **Then** 夹具结果').join('\n\n')
        : '- 本段只写散文、不含任何编号。');
      const acMatrix = (ids) => ['| AC | 类型 | 用例文件 / UAT | 状态 |', '|---|---|---|---|',
        ...ids.map((id) => '| ' + id + ' | unit | guard-self-test.mjs | ✅ |')].join('\n');
      const matrixHeading = '### 1.1 测试矩阵（AC → 用例）';
      // 夹具：review 节点 + REQUIREMENT（验收段列 acIds）+ TEST（1.1 矩阵只列 coveredIds）；
      // heading 可换掉 1.1 段标题，用于段名宽容与「段缺席」两侧构造。
      const setupAcReview = (acIds, coveredIds, heading = matrixHeading, matrixBodyOverride = null) => {
        setupReview(dir);
        writeTemplateFixture(dir, 'REQUIREMENT');
        writeTemplateFixture(dir, 'TEST');
        writeFile(dir, CHANGE_DIR + '/REQUIREMENT.md',
          renderDoc('REQUIREMENT', { body: [['验收准则', acBody(acIds)]] }));
        const testDoc = renderDoc('TEST', { body: [['1.1', matrixBodyOverride ?? acMatrix(coveredIds)]] });
        writeFile(dir, CHANGE_DIR + '/TEST.md',
          heading === matrixHeading ? testDoc : testDoc.replace(matrixHeading, heading));
      };
      const acSummaryLine = (res) => (res.output.match(/缺 AC 覆盖[^\n]*/u) ?? [''])[0];
      // ⑤ 汇总 WARN：一条（不逐条刷屏）、列缺失编号、不阻断
      setupAcReview(['AC-1', 'AC-2', 'AC-3'], ['AC-1']);
      const reviewMissing = runGuard(['exit', 'review'], dir);
      assertExit(reviewMissing, 0);
      assertOut(reviewMissing, 'REVIEW WARN: TEST.md 的 1.1 测试矩阵缺 AC 覆盖');
      assertTrue((reviewMissing.output.match(/缺 AC 覆盖/gu) ?? []).length === 1,
        'review 出口只给一条汇总 WARN（不逐条刷屏），实际出现 '
          + (reviewMissing.output.match(/缺 AC 覆盖/gu) ?? []).length + ' 次');
      assertTrue(acSummaryLine(reviewMissing).includes('AC-2') && acSummaryLine(reviewMissing).includes('AC-3'),
        '汇总 WARN 应列出全部缺失编号，实际: ' + acSummaryLine(reviewMissing));
      assertNotOut(reviewMissing, 'BLOCKED');
      // ⑥ 段名宽容：省编号、省括号的写法同样命中（定位走骨架 headingPattern，不是写死标题）
      setupAcReview(['AC-1', 'AC-2'], ['AC-1'], '### 测试矩阵');
      const reviewLoose = runGuard(['exit', 'review'], dir);
      assertExit(reviewLoose, 0);
      assertOut(reviewLoose, 'REVIEW WARN: TEST.md 的 1.1 测试矩阵缺 AC 覆盖');
      // ⑦ 反向构造（判别力）：矩阵段缺席 ⇒ 不可判（打不出缺覆盖），不是「全覆盖」；全量覆盖同理不打 WARN
      setupAcReview(['AC-1', 'AC-2'], ['AC-1'], '### 覆盖说明');
      const reviewNoMatrix = runGuard(['exit', 'review'], dir);
      assertExit(reviewNoMatrix, 0);
      assertNotOut(reviewNoMatrix, '缺 AC 覆盖');
      setupAcReview(['AC-1', 'AC-2'], ['AC-1', 'AC-2']);
      const reviewCovered = runGuard(['exit', 'review'], dir);
      assertExit(reviewCovered, 0);
      assertNotOut(reviewCovered, '缺 AC 覆盖');
      // ⑧ TEST.md 缺席（review 出口不要求它）→ 判据无从求值，不打 WARN、不改变退出码
      setupReview(dir);
      const reviewNoTest = runGuard(['exit', 'review'], dir);
      assertExit(reviewNoTest, 0);
      assertNotOut(reviewNoTest, '缺 AC 覆盖');
      assertOut(reviewNoTest, 'ALL CHECKS PASSED');
      // ⑨ 段体切片的围栏语义（1.1 矩阵段的段界由 lib/section-body.mjs 单点决定）：矩阵段里贴了围栏代码块
      //    （块内含 `## `）时，围栏之后的矩阵行仍参与覆盖判定——段体若在示例处截断，一条 AC 都读不到，
      //    「全覆盖」会被读成「全缺失」。
      const fencedMatrix = ['```md', '## 代码块里的示例段标题', '```', '', acMatrix(['AC-1', 'AC-2'])].join('\n');
      setupAcReview(['AC-1', 'AC-2'], [], matrixHeading, fencedMatrix);
      const reviewFencedMatrix = runGuard(['exit', 'review'], dir);
      assertExit(reviewFencedMatrix, 0);
      assertNotOut(reviewFencedMatrix, '缺 AC 覆盖');
      // ⑩ 分隔线语义保持：1.1 矩阵段不以 `---` 结束（既有语义）——分隔线之后的矩阵行照常参与判定
      setupAcReview(['AC-1', 'AC-2'], [], matrixHeading, '---\n\n' + acMatrix(['AC-1', 'AC-2']));
      const reviewRuleMatrix = runGuard(['exit', 'review'], dir);
      assertExit(reviewRuleMatrix, 0);
      assertNotOut(reviewRuleMatrix, '缺 AC 覆盖');
    },
  },

  // TA-03 · 段序按模板全序（AC-3）——SUMMARY 把「数据库迁移」排到「越界检查」之后 → BLOCKED 且报文
  // 指明段序偏离。反向构造：同夹具保持模板序 → 通过。
  {
    name: 'TA-03 段序偏离模板全序：SUMMARY 数据库迁移排到越界检查之后 → BLOCKED（报文含段序）',
    run: async (dir) => {
      setupExecute(dir, { swap: [['数据库迁移', '越界检查']] });
      const res = exitNode(dir, 'execute');
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '段序');
      assertOut(res, '数据库迁移');
      setupExecute(dir);
      const ok = exitNode(dir, 'execute');
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
    },
  },

  // TA-04 · 标题形态与首部字段（AC-4）——① 标题不是模板形态（`# 变更文档`）→ 拦；② 首部
  // `- **Change ID**:` 有键但值为空 → 视为未填 → 拦。反向构造：两者都合规 → 通过。
  {
    name: 'TA-04 标题形态与首部空值：`# 变更文档` / `- **Change ID**:` 空值均拦，合规形态通过',
    run: async (dir) => {
      // ① 标题形态
      setupOpen(dir, { title: '# 变更文档' });
      const resTitle = exitNode(dir, 'open');
      assertExit(resTitle, 1);
      assertOut(resTitle, 'CHANGE');
      // ② 首部有键无值（旧口径只查键在场 → 必然放过）
      setupOpen(dir, { headerEmpty: ['Change ID'] });
      const resHeader = exitNode(dir, 'open');
      assertExit(resHeader, 1);
      assertOut(resHeader, 'Change ID');
      // ③ 反向构造：标题与首部合规 → 通过
      setupOpen(dir);
      const ok = exitNode(dir, 'open');
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
    },
  },

  // TA-05 · 无条件段空正文被拦 + 六词白名单（AC-5）——CHANGE 的「影响面」空白 → BLOCKED；
  // 同段写 无 / N/A / 不适用 / — / 未涉及 / 无变更 任一 → 通过（逐词对照组）。
  {
    name: 'TA-05 无条件段空正文：影响面空白拦，六个白名单词逐一放行',
    run: async (dir) => {
      // ① 空白正文（含仅空白行）
      setupOpen(dir, { body: [['影响面', '   \n\n\t']] });
      const blank = exitNode(dir, 'open');
      assertExit(blank, 1);
      assertOut(blank, 'BLOCKED');
      assertOut(blank, '影响面');
      // ② 六词白名单（单变量：只改该段正文）
      for (const word of ['无', 'N/A', '不适用', '—', '未涉及', '无变更']) {
        setupOpen(dir, { body: [['影响面', word]] });
        const res = exitNode(dir, 'open');
        assertTrue(res.status === 0, '白名单词「' + word + '」应放行，实际 exit ' + res.status + '\n' + res.output);
        assertOut(res, 'ALL CHECKS PASSED');
      }
      // ③ 反向构造（判别力）：白名单是**整段取值**而非子串——含白名单词的真实句子仍算已填，不误拦
      setupOpen(dir, { body: [['影响面', '无变更风险；影响 CHANGE 与 REQUIREMENT 两份工件。']] });
      const ok = exitNode(dir, 'open');
      assertTrue(ok.status === 0, '含白名单词的真实句子应放行（判据不得退化为子串命中），实际 exit '
        + ok.status + '\n' + ok.output);
    },
  },

  // TA-06 · 照抄模板正文被拦（AC-6）——① 含待填位的模板正文（尖括号占位 / 复选框）逐字相同 →
  // 判未填 → BLOCKED；② 模板正文为成品形态（示例表格行）同样逐字比对——SUMMARY「改动文件」照抄
  // 模板里的示例文件清单（别的项目的文件）→ BLOCKED；两处各配「改写一个字符 → 通过」的单变量对照。
  {
    name: 'TA-06 与模板该段逐字相同判未填：照抄占位符拦，改写后通过',
    run: async (dir) => {
      const verbatim = templateSectionBody('CHANGE', '影响面');
      assertTrue(verbatim.trim() !== '', '夹具前提不成立：模板「影响面」段正文为空，无法构造逐字相同夹具');
      // ① 逐字相同 → 拦
      setupOpen(dir, { body: [['影响面', verbatim]] });
      const copied = exitNode(dir, 'open');
      assertExit(copied, 1);
      assertOut(copied, 'BLOCKED');
      // ② 反向构造：改写一个字符 → 通过
      const rewritten = verbatim + '（已按本 change 实际情况改写）';
      assertTrue(rewritten !== verbatim, '夹具前提不成立：改写未改变正文');
      setupOpen(dir, { body: [['影响面', rewritten]] });
      const ok = exitNode(dir, 'open');
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
      // ③ 模板正文为成品形态：示例表格行（无尖括号占位 / 复选框）照抄同样判未填。
      // 夹具自建该段正文（示例文件清单是「已填好的别的项目」形态），模板夹具与工件写同一内容。
      const exampleTable = [
        '| 文件 | 性质 | 说明 |',
        '|---|---|---|',
        '| `src/example/Fixture.ts` | 新增 | 模板示例行：实现夹具能力 |',
        '| `src/example/fixture.test.ts` | 新增 | 模板示例行：单元测试 |',
      ].join('\n');
      setupExecute(dir);
      writeTableTemplateFixture(dir, 'SUMMARY', '改动文件', exampleTable);
      writeFile(dir, CHANGE_DIR + '/T01-SUMMARY.md', renderDoc('SUMMARY', { body: [['改动文件', exampleTable]] }));
      const copiedTable = exitNode(dir, 'execute');
      assertExit(copiedTable, 1);
      assertOut(copiedTable, '改动文件');
      assertOut(copiedTable, '逐字');
      // ④ 反向构造（判别力）：只改表格里一个值（换成本任务自己的文件）→ 通过
      const rewrittenTable = exampleTable.replace('src/example/Fixture.ts', 'src/real/Real.ts');
      assertTrue(rewrittenTable !== exampleTable, '夹具前提不成立：改写未改变示例表');
      writeFile(dir, CHANGE_DIR + '/T01-SUMMARY.md', renderDoc('SUMMARY', { body: [['改动文件', rewrittenTable]] }));
      const okTable = exitNode(dir, 'execute');
      assertExit(okTable, 0);
      assertOut(okTable, 'ALL CHECKS PASSED');
    },
  },

  // TA-07 · 条件段标题必须在场（AC-7）——① CHANGE 缺「视觉调性」标题 → BLOCKED（标题缺席）；
  // ② 标题在场、正文写「不适用」→ 通过。反向构造即 ②。
  {
    name: 'TA-07 条件段标题必须在场：CHANGE 缺视觉调性拦，正文写不适用放行',
    run: async (dir) => {
      // ① 标题缺席
      setupOpen(dir, { omit: ['视觉调性'] });
      const missing = exitNode(dir, 'open');
      assertExit(missing, 1);
      assertOut(missing, '视觉调性');
      // ② 标题在场 + 正文不适用 → 通过
      setupOpen(dir, { body: [['视觉调性', '不适用']] });
      const ok = exitNode(dir, 'open');
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
      // ③ 反向构造（判别力）：把「视觉调性」改名成核心词不同的形态 ⇒ 等价于标题缺席，仍须拦
      setupOpen(dir, { rename: [['视觉调性', '视觉风格']] });
      const renamed = exitNode(dir, 'open');
      assertExit(renamed, 1);
    },
  },

  // TA-08 · 条件子段与父段豁免（AC-8）+ 可选段语义（C-1）——① 前端 change 的 UI-DESIGN 缺
  // `### Button (Primary)` → BLOCKED（注意 Primary / Secondary 归一后同键：只写 Secondary 不得算
  // Primary 在场）；② 非前端 change 的 TEST 第 4 轮整段 N/A 且缺 4.1~4.4 子段 → 通过（父段 N/A →
  // 子段不要求）；⑤⑥ UI-DESIGN §0（optional）整段删除合法，但保留标题就得填；⑦ 四种包裹
  // 符号（**N/A** / > N/A / - N/A / （N/A））都算整段不适用、⑦b `**N/A**（理由）`（闭合标记后紧跟
  // 说明）同样算整段不适用、⑧ 「**见 N/A**」不算（不吞真句子；它是 ⑦b 的过度接受反锚）且报文
  // 给出与判据一致的规范写法；⑨⑩ 缺子段时点名「实际挂在 X 段下」/「实际在文末」；⑪ 补充提示只对
  // 父段正文的 N/A 意图痕迹发声（④ 是它的负锚：普通正文不弹），且父段名取模板里的真实段名。
  {
    name: 'TA-08 条件子段与父段豁免：UI-DESIGN 缺 Button (Primary) 拦；TEST 第 4 轮 N/A 放行',
    run: async (dir) => {
      const frontendChange = { body: [['视觉调性', '- **选定**：6 有机 / Organic\n- **理由**：前端夹具']] };
      // ① 前端 change：缺 Button (Primary)（同段保留 Button (Secondary) 作单变量对照）
      setupDesign(dir, {
        changeOpts: frontendChange,
        uiDesign: uiDesignDoc({ subsectionOmit: ['Button (Primary)'] }),
        declareUiDesign: true,
      });
      writeFrontendDesignMarkers(dir);
      const resUi = exitNode(dir, 'design');
      assertExit(resUi, 1);
      assertOut(resUi, 'Button (Primary)');
      // ② 反向构造：补回 Primary（Secondary 同时在场）→ 通过
      setupDesign(dir, { changeOpts: frontendChange, uiDesign: uiDesignDoc(), declareUiDesign: true });
      writeFrontendDesignMarkers(dir);
      const okUi = exitNode(dir, 'design');
      assertExit(okUi, 0);
      // ③ 非前端 change：第 4 轮父段 N/A、缺 4.1~4.4 子段 → 通过（默认夹具即此形态）
      setupVerify(dir);
      const okTest = exitNode(dir, 'verify');
      assertExit(okTest, 0);
      assertOut(okTest, 'ALL CHECKS PASSED');
      // ④ 反向构造（判别力）：把第 4 轮改成有实质内容 → 其结构子段重新变为必填 → 缺子段必拦；
      // 同时是「若要整段不适用」补充提示的负锚——正文是普通说明、没有 N/A 意图痕迹，漏写子段时
      // 报文不得带这条提示（提示只对当事人想写 N/A 却写不规范的情形发声）。
      setupVerify(dir, { body: [['兼容性测试', '实测了三种视口组合的兼容性结论。']], subsectionOmit: ['跨浏览器'] });
      const resRound4 = exitNode(dir, 'verify');
      assertExit(resRound4, 1);
      assertOut(resRound4, '跨浏览器');
      assertNotOut(resRound4, '若要整段不适用');
      assertNotOut(resRound4, '父段「」');
      // ⑤ 可选段（optional）语义：UI-DESIGN §0 是模板自述「greenfield 删掉此段」的可选段——
      // 整段缺席合法，不得报「条件段标题缺席」（与 conditional 分流；conditional 仍要求标题在场，见 TA-07）。
      setupDesign(dir, {
        changeOpts: frontendChange,
        uiDesign: uiDesignDoc({ omit: ['0. 视觉语汇对齐'] }),
        declareUiDesign: true,
      });
      writeFrontendDesignMarkers(dir);
      const okOptional = exitNode(dir, 'design');
      assertExit(okOptional, 0);
      assertOut(okOptional, 'ALL CHECKS PASSED');
      // ⑥ 反向构造（判别力）：保留 §0 标题但正文空、且不带 0.1~0.3 子段 → 必拦
      // （可选段「保留即须填」——缺席与留空壳是两件事）
      setupDesign(dir, {
        changeOpts: frontendChange,
        uiDesign: uiDesignDoc({ body: [['视觉语汇对齐', '   ']], subsectionOmit: ['0.1', '0.2', '0.3'] }),
        declareUiDesign: true,
      });
      writeFrontendDesignMarkers(dir);
      const resEmptyOptional = exitNode(dir, 'design');
      assertExit(resEmptyOptional, 1);
      assertOut(resEmptyOptional, '0.1');
      // ⑦ 整段不适用的包裹符号（AC-8）：粗体 / 引用 / 列表 / 括号四种写法都是同一个词的包装——
      // 第 4 轮正文写成这些形态、其结构子段 4.1~4.4 全缺席 → 不报缺子段（父段豁免生效）。
      for (const wrapped of ['**N/A**', '> N/A', '- N/A', '（N/A）']) {
        setupVerify(dir, { body: [['兼容性测试', wrapped]], subsectionOmit: ['4.1', '4.2', '4.3', '4.4'] });
        const resWrapped = exitNode(dir, 'verify');
        assertTrue(resWrapped.status === 0, '第 4 轮正文「' + wrapped + '」应视为整段不适用、豁免结构子段，实际 exit '
          + resWrapped.status + '\n' + resWrapped.output);
        assertOut(resWrapped, 'ALL CHECKS PASSED');
      }
      // ⑦b 闭合标记后紧跟说明（正例锚）：`**N/A**（本轮无变更）` 是「整段不适用 + 为什么」的合法
      // 书写形态。旧实现只剥尾部的**裸**闭合标记，标记之后一有文字裸文本就变成 `N/A**（…）`、
      // 白名单词后不再紧邻边界 ⇒ 判已填、子段照旧要求（报文还写着「不要加粗或引用」，与判据相反）。
      setupVerify(dir, { body: [['兼容性测试', '**N/A**（本轮无变更）']], subsectionOmit: ['4.1', '4.2', '4.3', '4.4'] });
      const resClosedNote = exitNode(dir, 'verify');
      assertTrue(resClosedNote.status === 0,
        '第 4 轮正文「**N/A**（本轮无变更）」应视为整段不适用、豁免结构子段，实际 exit '
          + resClosedNote.status + '\n' + resClosedNote.output);
      assertOut(resClosedNote, 'ALL CHECKS PASSED');
      // ⑧ 反例（AC-9）：包装里是「见 N/A」这类真句子（剥掉包装后开头不是白名单词）→ 仍报缺子段。
      // 它是 ⑦b 的**过度接受**反锚：容忍「闭合标记后紧跟说明」不得顺手把「包装里包着真句子」也
      // 放行——区别在开头是不是白名单词，不在有没有包裹符号。
      // 父段有正文却不落白名单，报文同时给出**与判据一致**的规范写法（AC-10）：包裹符号本身就被
      // 接受（旧报文写「不要加粗或引用」，与判据相反）；要跟说明就写在闭合标记之后（⑦b 的形态）。
      setupVerify(dir, { body: [['兼容性测试', '**见 N/A**']], subsectionOmit: ['4.1', '4.2', '4.3', '4.4'] });
      const resSentence = exitNode(dir, 'verify');
      assertExit(resSentence, 1);
      assertOut(resSentence, '缺结构子段');
      assertOut(resSentence, '4.1');
      assertOut(resSentence, '若要整段不适用，请让整段以 N/A 开头');
      assertOut(resSentence, '包裹符号本身就被接受');
      assertOut(resSentence, '`**N/A**（理由）`');
      assertNotOut(resSentence, '不要加粗或引用');
      assertNotOut(resSentence, '父段「」');
      // ⑨ 诊断一（挂错父段）：4.3 实际写在「第 5 轮 · 可观测性验证」下 → 报文点名实际归属
      // （只加定位说明，不改归属算法）。
      setupVerify(dir, {
        body: [['兼容性测试', '实测了三种视口组合的兼容性结论。']],
        subsectionOmit: ['4.3'],
        insertAfter: [['可观测性验证', '### 4.3 数据迁移（涉及 schema 变更必填）\n\n夹具：误挂在第 5 轮下的子段。\n']],
      });
      const resMisplaced = exitNode(dir, 'verify');
      assertExit(resMisplaced, 1);
      assertOut(resMisplaced, '缺结构子段');
      assertOut(resMisplaced, '实际挂在');
      assertOut(resMisplaced, '第 5 轮 · 可观测性验证 段下');
      // ⑩ 诊断一（文末）：4.4 被贴到模板骨架之外（文末「附录」段之下）→ 报文写「实际在文末」。
      setupVerify(dir, {
        body: [['兼容性测试', '实测了三种视口组合的兼容性结论。']],
        subsectionOmit: ['4.4'],
        extra: ['## 附录\n\n### 4.4 跨版本\n\n夹具：误贴在文末的子段。'],
      });
      const resTail = exitNode(dir, 'verify');
      assertExit(resTail, 1);
      assertOut(resTail, '缺结构子段');
      assertOut(resTail, '实际在文末');
      // ⑪ 正锚（④ 的对称面）：父段正文留下 N/A 意图痕迹（「（说明：N/A）」这类带前置说明词、
      // 不在整段白名单里的写法）→ 子段仍要求，报文给出规范写法；父段名取模板里的真实段名，
      // 空父段名「父段「」」对定位毫无价值，两处都不许出现。
      setupVerify(dir, { body: [['兼容性测试', '（说明：N/A）']], subsectionOmit: ['4.1', '4.2', '4.3', '4.4'] });
      const resIntent = exitNode(dir, 'verify');
      assertExit(resIntent, 1);
      assertOut(resIntent, '若要整段不适用，请让整段以 N/A 开头');
      assertOut(resIntent, '包裹符号本身就被接受');
      assertOut(resIntent, '父段「第 4 轮 · 兼容性测试」');
      assertNotOut(resIntent, '父段「」');
    },
  },

  // TA-09 · 段名宽容四变体（AC-9）——省括号 / 括号不同 / 大小写不同 → 均通过；核心词不同
  // （`0.5 架构对齐`）→ BLOCKED。
  // 正例的两个条件父段（`0.5 既有架构对齐` / `9. 架构沉淀建议`）都给实质正文 = 父段适用 → 其结构
  // 子段（0.5.1~0.5.3 与 9.1~9.5）必须同时在场的合规形态；只改父段标题的写法，不得动子段。
  {
    name: 'TA-09 段名宽容：省括号/换括号/大小写三变体通过，核心词不同的段名拦',
    run: async (dir) => {
      const variants = [
        ['省括号', '0.5 既有架构对齐'],
        ['括号不同', '0.5 既有架构对齐（brownfield 场景夹具说明）'],
        ['形态差异', '0.5 既有架构对齐（B2 老项目护栏）'],
        ['大小写', '0.5 既有架构对齐（BROWNFIELD 必填）'],
      ];
      // 两个条件父段的实质正文（父段适用 → 登记表列出的结构子段逐条要求）
      const applicableBodies = [
        ['既有架构对齐', '本 change 触碰的既有模块与沿用对照见下表（夹具）。'],
        ['架构沉淀建议', '本 change 有可复用的沉淀候选，逐项见各子段（夹具）。'],
      ];
      for (const [label, heading] of variants) {
        setupDesign(dir, {
          designOpts: {
            rename: [['既有架构对齐', heading]],
            body: applicableBodies,
          },
        });
        const res = exitNode(dir, 'design');
        assertTrue(res.status === 0, '段名宽容变体「' + label + '」（' + heading + '）应通过，实际 exit '
          + res.status + '\n' + res.output);
        assertOut(res, 'ALL CHECKS PASSED');
      }
      // 反向构造（判别力）：父段适用却抽掉结构子段 → 必拦（证明子段要求真的在跑，正例不是空转）
      setupDesign(dir, {
        designOpts: { body: applicableBodies, subsectionOmit: ['0.5.2'] },
      });
      const resSubsection = exitNode(dir, 'design');
      assertExit(resSubsection, 1);
      assertOut(resSubsection, '0.5.2');
      // 反向构造：核心词不同（既有架构对齐 → 架构对齐）→ 拦
      setupDesign(dir, {
        designOpts: {
          rename: [['既有架构对齐', '0.5 架构对齐']],
          body: applicableBodies,
        },
      });
      const resCore = exitNode(dir, 'design');
      assertExit(resCore, 1);
      assertOut(resCore, 'BLOCKED');
    },
  },

  // TA-10 · 模板外多余段允许（AC-10）——TEST 含模板之外的 `## Findings`（工具输出原样贴入）→ 通过，
  // 且该段不参与段序判定（把它插在模板段中间也不得触发段序偏离）。
  {
    name: 'TA-10 模板外多余段：TEST 插入 ## Findings 放行且不参与段序判定',
    run: async (dir) => {
      const findings = '## Findings\n\n工具输出原样贴入：0 findings（夹具）。';
      setupVerify(dir, { insertAfter: [['功能测试', findings]] });
      const res = exitNode(dir, 'verify');
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, '段序');
      // 反向构造（判别力）：多余段若真的参与排序，把它换成模板段的错位顺序必须被判段序偏离
      // （下面这组是错位形态 → 必拦；两侧共用同一判据，证明上一条不是判据空转）
      setupVerify(dir, { swap: [['回归保护', '本次测试范围声明']] });
      const resOrder = exitNode(dir, 'verify');
      assertExit(resOrder, 1);
    },
  },

  // TA-11 · 旧 change 只告警（AC-11）——旧 change（无 newChange 标记）同构缺段 → 不阻断并输出 WARN；
  // 反向构造：同一夹具置 newChange → BLOCKED。
  // ⑤ 追加「视觉调性」段体的围栏语义：段里贴了含 `## ` 的围栏示例时，示例之后的「不适用」声明
  // 仍要被读到（段界只由围栏外的标题决定）。
  {
    name: 'TA-11 旧 change 同构缺段只 WARN 不阻断；同一夹具新 change 必 BLOCKED；视觉调性段内的围栏示例不截断',
    run: async (dir) => {
      const missing = { omit: ['影响面'] };
      // ① 新 change：拦（对照基准——同一份缺损工件）
      setupOpen(dir, missing);
      const newRes = exitNode(dir, 'open');
      assertExit(newRes, 1);
      // ② 旧 change：WARN 不阻断（唯一差异 = state 缺 newChange 标记）
      setupOpen(dir, missing);
      const legacy = baseState('open');
      legacy.evidence.open = { summary: 'intake complete' };
      writeState(dir, legacy);
      const legacyRes = exitNode(dir, 'open');
      assertExit(legacyRes, 0);
      assertOut(legacyRes, 'WARN');
      assertNotOut(legacyRes, 'BLOCKED');
      // ③ design 侧段缺席：同一判据——CHANGE.md「视觉调性」段缺席，新 change 由 uidesign 门兜底拦，
      // 不再默认判非前端（段缺席与段内声明「不适用」是两件事，只有后者是决策）。
      setupDesign(dir, { changeOpts: { omit: ['视觉调性'] } });
      const designNew = exitNode(dir, 'design');
      assertExit(designNew, 1);
      assertOut(designNew, '「视觉调性」段缺席');
      assertOut(designNew, '新 change 须显式标注「不适用」');
      // ④ 反向构造（同一份缺损工件，唯一差异 = state 缺 newChange 标记）：旧 change 兼容跳过、不阻断。
      setupDesign(dir, { changeOpts: { omit: ['视觉调性'] } });
      const designLegacy = baseState('design');
      designLegacy.evidence.design = { summary: 'design done' };
      writeState(dir, designLegacy);
      const designLegacyRes = exitNode(dir, 'design');
      assertExit(designLegacyRes, 0);
      assertOut(designLegacyRes, '旧 change 兼容');
      // ⑤ 段体围栏语义：「视觉调性」段里贴一段含 `## ` 的围栏示例，「不适用」声明写在围栏**之后**
      //    ⇒ 段体不被示例里的标题截断，判据仍读到声明（围栏是正文示例，不是段界）。旧的按行扫描
      //    在这里截断段体 → 标记消失 → 判成前端 → 要求一份本不该存在的 UI-DESIGN.md（BLOCKED）。
      setupDesign(dir, {
        changeOpts: {
          body: [['视觉调性',
            '- **选定**：6 有机 / Organic\n\n```md\n## 示例段（围栏内，不是段界）\n```\n\n- 适用性：不适用（CLI 工具，无用户可见界面）']],
        },
      });
      writeFrontendDesignMarkers(dir);
      const fencedTone = exitNode(dir, 'design');
      assertExit(fencedTone, 0);
      assertOut(fencedTone, 'UI-DESIGN: skipped（非前端）');
    },
  },

  // TA-12 · 增量段合法位置（AC-12）——①②④⑤ 合法位置通过；③ 自检方法夹在中间 → BLOCKED。
  // 合法位置：紧随越界检查 / 文末 / 验证命令标题后紧跟代码块 / LESSONS 扫描位于自检方法之后。
  // ⑥ 追加 SUMMARY 两条段体切片的围栏语义：6 维自查 / 自检方法段内的围栏示例不截断段体。
  {
    name: 'TA-12 增量段位置：紧随越界检查/文末/验证命令+代码块/LESSONS 扫描在后均通过，夹中间拦；6 维自查/自检方法段内围栏示例不截断',
    run: async (dir) => {
      // ① 紧随越界检查（默认渲染即此形态）
      setupExecute(dir);
      const afterBounds = exitNode(dir, 'execute');
      assertExit(afterBounds, 0);
      assertOut(afterBounds, 'ALL CHECKS PASSED');
      // ② 位于文末（两个增量段都落在骨架段之后，自检方法在最末之前 —— 登记表的 end 分支）
      setupExecute(dir, { incrementAllAtEnd: true });
      const atEnd = exitNode(dir, 'execute');
      assertExit(atEnd, 0);
      assertOut(atEnd, 'ALL CHECKS PASSED');
      // ④ 验证命令标题后紧跟代码块（TEST 默认渲染即此形态）
      setupVerify(dir);
      const verifyCmd = exitNode(dir, 'verify');
      assertExit(verifyCmd, 0);
      assertOut(verifyCmd, 'ALL CHECKS PASSED');
      // ⑤ LESSONS 扫描位于自检方法之后（默认渲染即此形态）
      const summaryText = renderDoc('SUMMARY');
      assertTrue(summaryText.indexOf('## LESSONS 扫描') > summaryText.indexOf('## 自检方法'),
        '夹具前提不成立：LESSONS 扫描应位于自检方法之后');
      // ③ 反向构造：自检方法夹在 6 维自查与数据库迁移之间 → BLOCKED
      setupExecute(dir, { incrementAfter: [['自检方法', '6 维自查']] });
      const inMiddle = exitNode(dir, 'execute');
      assertExit(inMiddle, 1);
      assertOut(inMiddle, 'BLOCKED');
      assertOut(inMiddle, '自检方法');
      // ⑥ 段体围栏语义（SUMMARY 的两条切片）：6 维自查 / 自检方法段里各贴一段含 `## ` 的围栏示例，
      //    方法声明写在围栏**之后** ⇒ 段体不被示例里的标题截断，六维实质内容与声明都仍被读到。
      //    旧的两条正则在示例处截断段体 → 「6 维自查段无实质内容」/「缺 ## 自检方法 段」（BLOCKED）。
      const fencedBlock = '```md\n## 示例段（围栏内，不是段界）\n```\n\n';
      setupExecute(dir, {
        body: [
          ['6 维自查', fencedBlock + SIX_DIM_BODY],
          ['自检方法', fencedBlock + 'brooks-review（夹具声明）'],
        ],
      });
      const fencedExecute = exitNode(dir, 'execute');
      assertExit(fencedExecute, 0);
      assertOut(fencedExecute, 'ALL CHECKS PASSED');
      assertNotOut(fencedExecute, '6 维自查段无实质内容');
    },
  },

  // ============================================================================================
  // 加载链与协议面
  // ============================================================================================

  // TA-13 · 加载链（AC-13）——入口的两条指针（步骤权威 / 段形权威）与声明面：
  //   ① `entry <内置节点>` 先打 `READ PROMPT:` 再打 `READ TEMPLATE:`，顺序按输出行索引判
  //      （不是只查两行在不在——行序是语义的一部分）；
  //   ② 声明别的节点的协议文件（open 声明 execute 的 4-dev.md）→ 入口 BLOCK，报文点名「与节点协议文件不符」；
  //   ②c 一个标记声明**多份**协议（0-change.md + 4-dev.md）→ 入口逐份核对，第二份越界同样 BLOCK 并
  //      点名 4-dev.md（只读 protocol 单值的实现只看第一份，这条会绿）；两份都在面内 ⇒ 放行；
  //   ③ design 的 2a-ui-design.md 是条件提示词（属该节点协议面）→ 不拦；入口按前端判据追出条件行
  //      （非前端不打印，反向构造即同一夹具只改「视觉调性」）；换成无关文件 → 拦；
  //   ④ record 缺 `--templates` 声明 → BLOCK，补上 → 放行；⑤ explain 现问输出 `TEMPLATE:` 行。
  // 反向构造：②③ 各用真实 skill-load 只改 --prompt（其余参数不变）构造正例——排除「标记存在与否」
  // 这另一变量；① 另带「同一判据 + 变异探针」，对调两条指针后判据必须翻假，否则顺序断言退化成包含断言。
  // 声明面走真实命令而非手写标记：标记形态由生产写入路径产生，正是场景最容易与真实链路分叉的地方。
  {
    name: 'TA-13 加载链：entry 先 READ PROMPT 后 READ TEMPLATE，--prompt 错路径入口拦（条件提示词放行），record 缺 --templates 拦，explain 有 TEMPLATE 行',
    run: async (dir) => {
      // 声明走真实命令 skill-load（而不是手写标记 JSON）：标记形态（protocol 取 basename、templates
      // 清单）由生产写入路径产生，入口判据读到的就是真实链路的形态。
      const skillLoad = (node, skill, prompt, templates) => runState(
        ['skill-load', node, skill, '--prompt', 'flow-kit/prompts/' + prompt, '--templates', templates],
        dir,
      );
      // 反例标记只能手写：skill-load 对新 change 拒绝「缺模板」的声明（那正是 ④ 要构造的缺陷态）。
      const writeMarker = (node, skill, protocol) => writeFile(
        dir,
        CHANGE_DIR + '/.skill-loads/' + node + '-' + skill + '.json',
        JSON.stringify({ node, skill, protocol, at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n',
      );
      const removeMarker = (node, skill) => fs.rmSync(
        path.join(dir, CHANGE_DIR, '.skill-loads', node + '-' + skill + '.json'),
        { force: true },
      );
      // 行序判据（单一函数供正向断言与变异探针共用）：两条指针都在场，且全部提示词行在全部模板行之前。
      const lineIndexes = (lines, prefix) => lines
        .map((line, index) => (line.startsWith(prefix) ? index : -1))
        .filter((index) => index !== -1);
      const promptLinesBeforeTemplates = (text) => {
        const lines = text.split('\n');
        const promptAt = lineIndexes(lines, 'READ PROMPT:');
        const templateAt = lineIndexes(lines, 'READ TEMPLATE:');
        return promptAt.length > 0 && templateAt.length > 0
          && Math.max(...promptAt) < Math.min(...templateAt);
      };

      // ① 顺序：open 是两提示词 + 两模板的节点，取「最后一条提示词 < 第一条模板」的收敛形态
      setupOpen(dir);
      const load = skillLoad('open', 'flow-comet-change', '0-change.md', 'CHANGE.md,REQUIREMENT.md');
      assertExit(load, 0);
      assertOut(load, 'SKILL-LOAD: open flow-comet-change');
      const entry = runGuard(['entry', 'open'], dir);
      assertExit(entry, 0);
      assertOut(entry, 'READ PROMPT: flow-kit/prompts/0-change.md');
      assertOut(entry, 'READ PROMPT: flow-kit/prompts/1-requirement.md');
      assertOut(entry, 'READ TEMPLATE: flow-kit/templates/CHANGE.md');
      assertTrue(promptLinesBeforeTemplates(entry.output),
        '入口两条指针顺序错：READ PROMPT 行应全部先于 READ TEMPLATE 行\n实际输出:\n' + entry.output);
      // 反向构造（同一判据 + 变异探针）：对调两串标签后同一判据必须翻假
      const swapped = entry.output.replace(/READ (PROMPT|TEMPLATE):/g,
        (match, label) => 'READ ' + (label === 'PROMPT' ? 'TEMPLATE' : 'PROMPT') + ':');
      assertTrue(swapped !== entry.output, '变异探针前提失效：入口输出里没有可对调的两条指针');
      assertTrue(!promptLinesBeforeTemplates(swapped), '顺序判据不具判别力：对调两条指针后仍判通过');

      // ①b 指针不校验文件在否：模板整体缺席时两行照常打印——指针标识的是「该读哪份模板」，文件
      // 缺席由产出物门禁的「未校验（模板缺失）」报告（公开文档的口径以此为准）。
      fs.rmSync(path.join(dir, 'flow-kit'), { recursive: true, force: true });
      assertTrue(!fs.existsSync(path.join(dir, 'flow-kit', 'templates', 'CHANGE.md')),
        '夹具前提失效：模板文件应确实不在磁盘上（否则本条退化成「指针必指向已有文件」的旧表述）');
      const noTemplateEntry = runGuard(['entry', 'open'], dir);
      assertExit(noTemplateEntry, 0);
      assertOut(noTemplateEntry, 'READ TEMPLATE: flow-kit/templates/CHANGE.md');
      assertOut(noTemplateEntry, 'READ PROMPT: flow-kit/prompts/0-change.md');

      // ② 错路径：open 声明 execute 的协议文件 4-dev.md → 入口 BLOCK（报文点名不符）
      // 声明命令本身只校验 flow-kit/prompts/ 前缀，归属判定由入口负责——故这里真实命令成功、入口拦。
      assertExit(skillLoad('open', 'flow-comet-change', '4-dev.md', 'CHANGE.md,REQUIREMENT.md'), 0);
      const wrongPrompt = runGuard(['entry', 'open'], dir);
      assertExit(wrongPrompt, 1);
      assertOut(wrongPrompt, 'BLOCKED');
      assertOut(wrongPrompt, '与节点协议文件不符');
      assertOut(wrongPrompt, '4-dev.md');
      // 反向构造：真实命令只把 --prompt 改回本节点协议文件 → 放行（拦点是被声明的路径，不是标记存在性）
      assertExit(skillLoad('open', 'flow-comet-change', '0-change.md', 'CHANGE.md,REQUIREMENT.md'), 0);
      const correctedPrompt = runGuard(['entry', 'open'], dir);
      assertExit(correctedPrompt, 0);
      assertNotOut(correctedPrompt, '与节点协议文件不符');
      // ②b 入口只认活动路径（in-place 扩展）：同样的错路径声明只存在于归档目录（真实的归档形态
      // <日期>-<本 change>）时，入口不追溯归档——那一轮没在活动目录里声明，就没有可核对的声明；
      // 归档里的声明属于归档前的执行者，拿它判当前节点会把「没声明」判成「声明过」。判据可证伪：
      // 一旦入口改去读归档，这条错路径声明会当场 BLOCK。
      const loadsDir = path.join(dir, CHANGE_DIR, '.skill-loads');
      const loadsAside = path.join(dir, '.specs', 'loads-aside');
      fs.renameSync(loadsDir, loadsAside);
      writeFile(dir, '.specs/archive/2026-10-01-' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({
          node: 'open', skill: 'flow-comet-change', protocol: '4-dev.md',
          templates: ['CHANGE', 'REQUIREMENT'], at: '2026-08-01T00:00:00.000Z',
        }, null, 2) + '\n');
      const archivedDeclaration = runGuard(['entry', 'open'], dir);
      assertExit(archivedDeclaration, 0);
      assertNotOut(archivedDeclaration, '与节点协议文件不符');
      // 复位：归档诱饵撤掉、活动声明标记归位——③ 起按「已声明」继续
      fs.rmSync(path.join(dir, '.specs', 'archive'), { recursive: true, force: true });
      fs.renameSync(loadsAside, loadsDir);

      // ②c 多 --prompt：一个标记可声明多份协议，入口必须**逐份**核对。只读 protocol 单值的实现只看
      // 第一份 ⇒ 第二份落在节点协议面外也照样放行（记下的是「声明过」，不是「声明对」）。第一份是
      // open 的协议文件、第二份是 execute 的 4-dev.md → BLOCKED 且点名 4-dev.md。
      const multiPrompt = (prompts) => runState([
        'skill-load', 'open', 'flow-comet-change',
        ...prompts.flatMap((prompt) => ['--prompt', 'flow-kit/prompts/' + prompt]),
        '--templates', 'CHANGE.md,REQUIREMENT.md',
      ], dir);
      assertExit(multiPrompt(['0-change.md', '4-dev.md']), 0);
      const multiPromptEntry = runGuard(['entry', 'open'], dir);
      assertExit(multiPromptEntry, 1);
      assertOut(multiPromptEntry, 'BLOCKED');
      assertOut(multiPromptEntry, '与节点协议文件不符');
      assertOut(multiPromptEntry, '4-dev.md');
      // 反向构造（单变量 = 被声明的路径）：两条 --prompt 都落在 open 的协议面内 ⇒ 放行。拦点因此是
      // 「哪一份被声明」，不是「声明了几份」。
      assertExit(multiPrompt(['0-change.md', '1-requirement.md']), 0);
      const multiPromptOk = runGuard(['entry', 'open'], dir);
      assertExit(multiPromptOk, 0);
      assertNotOut(multiPromptOk, '与节点协议文件不符');

      // ③ 条件提示词不误拦 + 按前端判定打印：design 声明 2a-ui-design.md（条件提示词，属该节点协议面）
      // → 放行；前端 change 的入口追出条件行（与条件模板行对称），非前端 change 不打印。
      const frontendChange = { body: [['视觉调性', '- **选定**：6 有机 / Organic\n- **理由**：前端夹具']] };
      const conditionalPromptLine = 'READ PROMPT（条件提示词）: flow-kit/prompts/2a-ui-design.md（仅前端 change）';
      // 条件行判据：逐行精确匹配（不用「包含文件名」的宽写法——标签或尾注漂移同样该红）。
      const hasConditionalPromptLine = (text) => text.split(/\r?\n/).includes(conditionalPromptLine);
      setupDesign(dir, { changeOpts: frontendChange });
      assertExit(skillLoad('design', 'flow-comet-design', '2-design.md', 'DESIGN.md'), 0);
      assertExit(skillLoad('design', 'flow-comet-ui-design', '2a-ui-design.md', 'DESIGN.md,UI-DESIGN.md'), 0);
      const conditionalOk = runGuard(['entry', 'design'], dir);
      assertExit(conditionalOk, 0);
      assertNotOut(conditionalOk, '与节点协议文件不符');
      assertOut(conditionalOk, 'READ PROMPT: flow-kit/prompts/2-design.md');
      assertTrue(hasConditionalPromptLine(conditionalOk.output),
        '前端 change 的 entry 未打印条件提示词行 ' + JSON.stringify(conditionalPromptLine)
        + '\n实际输出:\n' + conditionalOk.output);
      // 反向构造（同一判据 + 单变量）：只把「视觉调性」改成「不适用」→ 前端判据为假，条件行必须消失
      // （实现若无视判据无条件打印，此处必红）；必填提示词行不受影响。
      setupDesign(dir, { changeOpts: { body: [['视觉调性', '不适用']] } });
      assertExit(skillLoad('design', 'flow-comet-design', '2-design.md', 'DESIGN.md'), 0);
      assertExit(skillLoad('design', 'flow-comet-ui-design', '2a-ui-design.md', 'DESIGN.md,UI-DESIGN.md'), 0);
      const conditionalSkipped = runGuard(['entry', 'design'], dir);
      assertExit(conditionalSkipped, 0);
      assertOut(conditionalSkipped, 'READ PROMPT: flow-kit/prompts/2-design.md');
      assertTrue(!hasConditionalPromptLine(conditionalSkipped.output),
        '非前端 change 的 entry 不应打印条件提示词行\n实际输出:\n' + conditionalSkipped.output);
      // 反向构造：真实命令只把 --prompt 换成无关文件 → 同一夹具立刻拦
      assertExit(skillLoad('design', 'flow-comet-ui-design', '3-task.md', 'DESIGN.md,UI-DESIGN.md'), 0);
      const conditionalWrong = runGuard(['entry', 'design'], dir);
      assertExit(conditionalWrong, 1);
      assertOut(conditionalWrong, 'BLOCKED');
      assertOut(conditionalWrong, '与节点协议文件不符');
      assertOut(conditionalWrong, '3-task.md');
      // 移除条件提示词声明，④⑤ 回到单声明形态（与原有 record / explain 断言同形）
      removeMarker('design', 'flow-comet-ui-design');

      // ④ 标记缺模板声明 → record BLOCKED 且提示 --templates；反向构造：声明了模板 → 放行
      writeMarker('design', 'flow-comet-design', '2-design.md');
      const recordBlocked = runState(['record', 'design', '{"summary":"design done"}'], dir);
      assertExit(recordBlocked, 1);
      assertOut(recordBlocked, '--templates');
      // 重新声明指引同时给出 --prompt：模板与提示词是同一次声明的两面，而 skill-load 重跑会覆写
      // 同一标记——只补 --templates 会把 protocol 写成 null，下一次 exit 反被判「缺协议声明标记」。
      // 记录侧没有 skill 名（只有它仍是 <skill> 占位）；提示词路径必须是真实路径，不是占位符。
      assertOut(recordBlocked, '--prompt flow-kit/prompts/2-design.md');
      assertNotOut(recordBlocked, '--prompt <');
      assertExit(skillLoad('design', 'flow-comet-design', '2-design.md', 'DESIGN.md'), 0);
      const recordOk = runState(['record', 'design', '{"summary":"design done"}'], dir);
      assertExit(recordOk, 0);
      assertNotOut(recordOk, 'BLOCKED');

      // ⑤ explain 现问输出模板行
      const explain = runState(['explain', 'design'], dir);
      assertExit(explain, 0);
      assertOut(explain, 'TEMPLATE:');
      assertOut(explain, 'flow-kit/templates/DESIGN.md');
    },
  },

  // TA-14 · 自定义协议按声明决定（AC-14）——① 自定义节点未声明模板 → 不校验（结构缺损也放行）；
  // ② 同节点声明了模板 → 校验（同样的缺损 → BLOCKED）；③ 内置节点未声明 → BLOCKED。
  {
    name: 'TA-14 自定义协议三态：未声明不校验 / 声明则校验 / 内置节点未声明拦',
    run: async (dir) => {
      const protocolWith = (templates) => {
        const proto = customProtocol();
        proto.nodes[0].outputSchemas = ['compose.change.v1'];
        proto.outputSchemas = [{
          id: 'compose.change.v1',
          description: 'CHANGE.md（自定义节点产物）',
          artifacts: [{
            id: 'change-doc', kind: 'file', required: true,
            paths: ['<change-id>/CHANGE.md'], pathBase: 'specs-root',
          }],
          evidence: [{ id: 'change-summary', required: true }],
        }];
        if (templates !== undefined) proto.nodes[0].templates = templates;
        return proto;
      };
      const writeProtocol = (proto) => writeFile(dir, 'reference/workflow-protocol.json', JSON.stringify(proto, null, 2) + '\n');
      const writeCustomFixture = () => {
        writeTemplateFixture(dir, 'CHANGE');
        writeFile(dir, changeDirOf(), renderDoc('CHANGE', { omit: ['影响面'] }));
        const st = baseState('brainstorm');
        st.activeChange = CHANGE_ID;
        st.newChange = true;
        st.enteredNodes = ['brainstorm'];
        st.evidence.brainstorm = { summary: 'notes done' };
        writeState(dir, st);
      };
      function changeDirOf() { return CHANGE_DIR + '/CHANGE.md'; }
      // ① 未声明 → 不校验
      writeProtocol(protocolWith(undefined));
      writeCustomFixture();
      const undeclared = runGuard(['exit', 'brainstorm'], dir);
      assertExit(undeclared, 0);
      assertNotOut(undeclared, 'BLOCKED');
      // ② 声明了模板 → 校验（同样的结构缺损 → 拦）
      writeProtocol(protocolWith(['CHANGE']));
      writeCustomFixture();
      const declared = runGuard(['exit', 'brainstorm'], dir);
      assertExit(declared, 1);
      assertOut(declared, 'BLOCKED');
      // ③ 反向构造：内置节点缺模板声明 → 拦（把内置协议副本的节点声明删掉）
      writeProtocol((() => {
        const builtin = JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'reference', 'workflow-protocol.json'), 'utf8'));
        for (const node of builtin.nodes) delete node.templates;
        return builtin;
      })());
      setupOpen(dir, { omit: ['影响面'] });
      const builtinUndeclared = runGuard(['exit', 'open'], dir);
      assertExit(builtinUndeclared, 1);
      assertOut(builtinUndeclared, 'BLOCKED');
      // ④ 重新声明指引的提示词面（单一来源的直接判据）：内置节点拼该节点首个协议文件的真实路径
      // （与入口 READ PROMPT 同源）；自定义节点没有内置映射 → 不拼（不编造路径，也不打占位符）。
      const { nodeTemplateDeclaration, templateDeclareCommand } = await import('../protocol-utils.mjs');
      const builtinCommand = templateDeclareCommand(
        nodeTemplateDeclaration({ id: 'execute' }), { nodeId: 'execute', skillName: 'flow-comet-dev' });
      assertTrue(builtinCommand === 'workflow-state.mjs skill-load execute flow-comet-dev'
        + ' --templates SUMMARY.md --prompt flow-kit/prompts/4-dev.md',
        '内置节点的重新声明命令应带真实提示词路径，实际: ' + builtinCommand);
      const customCommand = templateDeclareCommand(
        nodeTemplateDeclaration({ id: 'brainstorm', templates: ['CHANGE'] }), { nodeId: 'brainstorm', skillName: 'fixture-skill' });
      assertTrue(customCommand === 'workflow-state.mjs skill-load brainstorm fixture-skill --templates CHANGE.md',
        '自定义节点无内置提示词映射时不应拼 --prompt，实际: ' + customCommand);

      // ⑤ --preflight 与自定义协议的组合（in-place 扩展）：结构预检的**声明工件**判据必须来自命令行
      // 指定的那份协议。造法 = 内置协议副本 + 给 open 节点追加一件只在这份协议里声明的 file 类产物，
      // 同一夹具跑两次、唯一变量是 --protocol：不指这份协议时没人会去查那件产物，指了就按它拦。
      // 环境变量（= 上面的对照侧）先复位成**未经改写的**内置副本——本场景 ③ 曾把该副本的模板声明
      // 改过，带着它做对照就不是单变量了。故「忽略 CLI 参数」与「内置判据写死」两种退化都会让第一次
      // 调用变成通过（或缺件不被点名）。
      const builtinProtocolCopy = JSON.parse(
        fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'reference', 'workflow-protocol.json'), 'utf8'));
      writeFile(dir, 'reference/workflow-protocol.json', JSON.stringify(builtinProtocolCopy, null, 2) + '\n');
      const protocolWithExtraArtifact = {
        ...builtinProtocolCopy,
        nodes: builtinProtocolCopy.nodes.map((node) => (node.id === 'open'
          ? { ...node, outputSchemas: [...node.outputSchemas, 'fixture.extra-artifact.v1'] }
          : node)),
        outputSchemas: [...builtinProtocolCopy.outputSchemas, {
          id: 'fixture.extra-artifact.v1',
          description: '协议追加的 open 产物（只在本自定义协议里声明）',
          artifacts: [{
            id: 'custom-evidence', kind: 'file', required: true,
            paths: ['<change-id>/custom-evidence.md'], pathBase: 'specs-root',
          }],
          evidence: [],
        }],
      };
      const customProtocolFile = path.join(dir, 'reference', 'custom-preflight-protocol.json');
      writeFile(dir, 'reference/custom-preflight-protocol.json', JSON.stringify(protocolWithExtraArtifact, null, 2) + '\n');
      setupOpen(dir);
      const customPreflight = runGuard(['exit', 'open', '--preflight', '--protocol', customProtocolFile], dir);
      assertExit(customPreflight, 1);
      assertOut(customPreflight, '声明工件缺失');
      assertOut(customPreflight, '.specs/' + CHANGE_ID + '/custom-evidence.md');
      assertTrue(!fs.existsSync(path.join(dir, CHANGE_DIR, '.template-hints.json')),
        '--preflight 不得写提示账本（自定义协议下同样是只读）');
      // 反向对照（单变量 = 少一个 --protocol）：同一夹具、同一节点、同一命令形态 → 内置副本里没有
      // 这件产物，故不报缺件（同时排除「预检本来就一律报缺件」这一读法）。
      const builtinPreflight = runGuard(['exit', 'open', '--preflight'], dir);
      assertExit(builtinPreflight, 0);
      assertNotOut(builtinPreflight, 'custom-evidence.md');
      // 正例：按自定义协议声明的路径补上该产物 → 同一命令转为通过（判据跟着协议走，不是恒拦）
      writeFile(dir, CHANGE_DIR + '/custom-evidence.md', '# 追加产物\n\n自定义协议声明的结构输入。\n');
      const satisfiedPreflight = runGuard(['exit', 'open', '--preflight', '--protocol', customProtocolFile], dir);
      assertExit(satisfiedPreflight, 0);
      assertOut(satisfiedPreflight, 'ALL CHECKS PASSED');

      // ⑥ 参数面收紧（in-place 扩展）：同一命令形态、同一夹具，只改参数的拼写——单横线疑似旗标
      // （`-apply` 单横线笔误 / `-h`）与节点之后的多余位置参数，修复前都被静默忽略（`-apply` 既不
      // 落盘也不报错，看起来像一次成功的预演；多余的裸词同样无人认领）。现在两者一律是用法错误、
      // 非零退出，且不得进入任何门禁链——参数面因此与「已知旗标 + 一个节点名」逐字对得上。
      const singleDashFlag = runGuard(['exit', 'open', '--preflight', '-apply'], dir);
      assertExit(singleDashFlag, 1);
      assertOut(singleDashFlag, '用法错误');
      assertOut(singleDashFlag, '-apply');
      assertNotOut(singleDashFlag, 'ALL CHECKS PASSED');
      const shortFlag = runGuard(['exit', 'open', '-h'], dir);
      assertExit(shortFlag, 1);
      assertOut(shortFlag, '用法错误');
      assertOut(shortFlag, '-h');
      // 多余位置参数：--protocol 的取值不算位置参数（两者在同一命令里并存，判据不得把取值当多余项）。
      const extraOperand = runGuard(
        ['exit', 'open', '--preflight', '--protocol', customProtocolFile, 'extra-operand'], dir);
      assertExit(extraOperand, 1);
      assertOut(extraOperand, '用法错误');
      assertOut(extraOperand, 'extra-operand');
      assertNotOut(extraOperand, 'ALL CHECKS PASSED');
      // 正对照：同一夹具的合法形态（--protocol 取值 + 无多余操作数）仍然通过——上面三条不是
      // 「预检一律失败」的同义反复。
      const legalAgain = runGuard(['exit', 'open', '--preflight', '--protocol', customProtocolFile], dir);
      assertExit(legalAgain, 0);
      assertOut(legalAgain, 'ALL CHECKS PASSED');
    },
  },

  // TA-15 · 报错两阶段与记忆（AC-15）——同一工件首次因缺段被拦：只给模板路径 + 类别计数，不列段名；
  // 再犯：列出段名；工件通过后标记清除。反向构造：修复后复检 + 标记文件不再记录该工件。
  // 记忆按**文件**计：execute 出口的多份 *-SUMMARY.md 共用同一个模板键，各份必须独立记忆——同一次
  // 出口各自首败不互相升级，修好一份即释放该份的键（不许被另一份的失败永久保键）。
  {
    name: 'TA-15 两阶段报错：首次不列段名、再犯列段名、通过后清标记（多份 SUMMARY 各记各的）',
    run: async (dir) => {
      // 单份工件的失败行（同一份工件在报告里占一行；用于按文件断言，避免整串输出互相串味）
      const failureLine = (res, file) => res.output.split(/\r?\n/)
        .find((line) => line.includes(file + ' 模板结构校验失败')) ?? '';
      setupExecute(dir, { omit: ['是否触发新工作'] });
      const first = exitNode(dir, 'execute');
      assertExit(first, 1);
      assertOut(first, 'BLOCKED');
      assertNotOut(first, '是否触发新工作');
      const hintFile = path.join(dir, CHANGE_DIR, '.template-hints.json');
      assertTrue(fs.existsSync(hintFile), '首次结构失败应写入 .specs/<change>/.template-hints.json（跨两次 exit 记忆）');
      const second = exitNode(dir, 'execute');
      assertExit(second, 1);
      assertOut(second, '是否触发新工作');
      // 反向构造：工件通过 → 标记清除
      setupExecute(dir);
      const passed = exitNode(dir, 'execute');
      assertExit(passed, 0);
      assertOut(passed, 'ALL CHECKS PASSED');
      const cleared = !fs.existsSync(hintFile)
        || !JSON.stringify(JSON.parse(fs.readFileSync(hintFile, 'utf8'))).toUpperCase().includes('SUMMARY');
      assertTrue(cleared, '工件通过后应清除该工件的两阶段标记，实际: '
        + (fs.existsSync(hintFile) ? fs.readFileSync(hintFile, 'utf8') : '(文件已删)'));
      // ⑤ 两份 SUMMARY 同一次出口各自首败 → 都不升级（后一份不许继承前一份刚写下的键）
      const omitSection = (res, file) => {
        const line = failureLine(res, file);
        assertTrue(line !== '', '两份 SUMMARY 都应出现在同一次出口的失败报告里（缺 ' + file + '）');
        return line.includes('是否触发新工作');
      };
      setupExecute(dir, { omit: ['是否触发新工作'] });
      writeFile(dir, CHANGE_DIR + '/T02-SUMMARY.md', renderDoc('SUMMARY', { omit: ['是否触发新工作'] }));
      const pairFirst = exitNode(dir, 'execute');
      assertExit(pairFirst, 1);
      assertTrue(!omitSection(pairFirst, 'T01-SUMMARY.md'), 'T01 首败不应列段名: ' + failureLine(pairFirst, 'T01-SUMMARY.md'));
      assertTrue(!omitSection(pairFirst, 'T02-SUMMARY.md'),
        'T02 首败不应列段名（另一份刚写下的键不许把它升级成再犯）: ' + failureLine(pairFirst, 'T02-SUMMARY.md'));
      const pairKeys = Object.keys(JSON.parse(fs.readFileSync(hintFile, 'utf8')));
      for (const file of ['T01-SUMMARY.md', 'T02-SUMMARY.md']) {
        assertTrue(pairKeys.some((key) => key.includes(file)),
          '记忆账本应按文件分开记录（缺 ' + file + '）: ' + pairKeys.join(', '));
      }
      // ⑥ 反向构造：两份都再犯 → 两份都列段名（按文件记忆不削弱「再犯」判据）
      const pairSecond = exitNode(dir, 'execute');
      assertExit(pairSecond, 1);
      for (const file of ['T01-SUMMARY.md', 'T02-SUMMARY.md']) {
        assertTrue(omitSection(pairSecond, file), file + ' 再犯应列出段名: ' + failureLine(pairSecond, file));
      }
      // ⑦ 修好一份、另一份仍红 → 修好的那份释放记忆键；再坏一次仍算首败（同一次出口里的另一份
      // 仍在失败，不许把它拖回再犯）。
      writeFile(dir, CHANGE_DIR + '/T01-SUMMARY.md', renderDoc('SUMMARY'));
      const oneFixed = exitNode(dir, 'execute');
      assertExit(oneFixed, 1);   // T02 仍缺段：出口照常拦
      assertTrue(omitSection(oneFixed, 'T02-SUMMARY.md'),
        '仍失败的 T02 应保持再犯形态: ' + failureLine(oneFixed, 'T02-SUMMARY.md'));
      const afterFixKeys = Object.keys(JSON.parse(fs.readFileSync(hintFile, 'utf8')));
      assertTrue(!afterFixKeys.some((key) => key.includes('T01-SUMMARY.md')),
        '修好的 T01 应释放其记忆键（不许靠 T02 的失败永久保键）: ' + afterFixKeys.join(', '));
      writeFile(dir, CHANGE_DIR + '/T01-SUMMARY.md', renderDoc('SUMMARY', { omit: ['是否触发新工作'] }));
      const brokeAgain = exitNode(dir, 'execute');
      assertExit(brokeAgain, 1);
      assertTrue(!omitSection(brokeAgain, 'T01-SUMMARY.md'),
        '释放后再次坏掉应按首败处理（不列段名）: ' + failureLine(brokeAgain, 'T01-SUMMARY.md'));

      // ⑧ --preflight 与完整 exit 的两阶段差异（in-place 扩展）：预检只读、不维护提示账本，故同一
      // 节点连跑两次预检都停在报文的**首段**（只报类别计数）；写账本的是完整 exit，它才在第二次
      // 点名段名。两侧都得锁住——预检若改成写账本，第二次预检会提前把段名用掉（「先读模板」的
      // 引导被绕开）；完整 exit 若不写账本，第二次仍只报计数（两阶段报错退化成单阶段）。
      setupExecute(dir, { omit: ['是否触发新工作'] });
      assertTrue(!fs.existsSync(hintFile), '夹具起点不应有提示账本');
      const preFirst = runGuard(['exit', 'execute', '--preflight'], dir);
      assertExit(preFirst, 1);
      assertOut(preFirst, '缺段 1 项');
      assertNotOut(preFirst, '是否触发新工作');
      assertTrue(!fs.existsSync(hintFile), '--preflight 不得写提示账本（首段形态的前提）');
      const preSecond = runGuard(['exit', 'execute', '--preflight'], dir);
      assertExit(preSecond, 1);
      assertOut(preSecond, '缺段 1 项');
      assertNotOut(preSecond, '是否触发新工作');
      assertTrue(!fs.existsSync(hintFile), '第二次 --preflight 仍不得写提示账本（不升级成列段名）');
      // 同一节点、同一工件、同一缺损：完整 exit 首次只报计数并开账本，第二次点名段名。
      const fullFirst = exitNode(dir, 'execute');
      assertExit(fullFirst, 1);
      assertOut(fullFirst, '缺段 1 项');
      assertNotOut(fullFirst, '是否触发新工作');
      assertTrue(fs.existsSync(hintFile), '完整 exit 首次失败应写提示账本（再犯才有「再犯」可言）');
      const fullSecond = exitNode(dir, 'execute');
      assertExit(fullSecond, 1);
      assertOut(fullSecond, '缺段 1 项: 是否触发新工作');
    },
  },

  // TA-16 · REVIEW 发现必须在模板位置（AC-16）——① 发现写在 `## 发现` 而 `### 2.2` 下无条目
  // → BLOCKED 并提示迁移到 2.2；② 按模板写在 2.2 → 通过；③ 模板范例形态（`### 🔴 …` + 粗体
  // 字段）同样是「发现」——缺处置标记 → BLOCKED（修复前该形态整段静默空过 = RED），同内容改回
  // 列表项 → 同样 BLOCKED（书写形态不改变判别力），带处置标记的 H3 条目 → 通过；④ H3 Major
  // [转待办] 无用户裁决 → BLOCKED，同段裁决 + [升级] 承接 → 通过（严重度按标题前缀派生）。
  {
    name: 'TA-16 REVIEW 发现位置：写在 ## 发现 而 2.2 空则拦，写在 2.2 通过',
    run: async (dir) => {
      // ① 发现写在模板外的段
      setupReview(dir, {
        body: [['2.2', '（夹具：本段无条目。）']],
        extra: ['## 发现\n\n- **F1 · 夹具发现**：写在模板外的发现条目 [已修]'],
      });
      const misplaced = exitNode(dir, 'review');
      assertExit(misplaced, 1);
      assertOut(misplaced, 'BLOCKED');
      assertOut(misplaced, '2.2');
      // ② 反向构造：按模板写在 2.2 → 通过
      setupReview(dir);
      const ok = exitNode(dir, 'review');
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
      // ③ H3 + 粗体字段形态（模板 2.2 的书写范例）缺处置标记 → BLOCKED
      const h3Finding = [
        '### 🔴 C-2 · 夹具 H3 形态的发现：按模板范例书写',
        '**Symptom**：某处存在一个可记录的衰退风险',
        '**Source**：夹具来源',
        '**Consequence**：若不修会怎样',
        '**Remedy**：怎么改',
        '**生成 fix 任务**：T-FIX-99',
      ].join('\n');
      setupReview(dir, { body: [['2.2', h3Finding]] });
      const h3Missing = exitNode(dir, 'review');
      assertExit(h3Missing, 1);
      assertOut(h3Missing, 'BLOCKED');
      assertOut(h3Missing, '发现区 1 项');   // H3 条目被计入发现（未识别时计数为 0）
      // ④ 同内容换回列表项形态 → 同样被拦（同一判据对两种写法同等判别）
      setupReview(dir, {
        body: [['2.2', '- **C-2 · 夹具 H3 形态的发现：按模板范例书写**：某处存在一个可记录的衰退风险']],
      });
      const listMissing = exitNode(dir, 'review');
      assertExit(listMissing, 1);
      assertOut(listMissing, 'BLOCKED');
      assertOut(listMissing, '发现区 1 项');
      // ⑤ 反向构造：H3 条目在标题行带处置标记 → 通过
      setupReview(dir, { body: [['2.2', h3Finding.replace('按模板范例书写', '按模板范例书写 [已修]')]] });
      const h3Done = exitNode(dir, 'review');
      assertExit(h3Done, 0);
      assertOut(h3Done, 'ALL CHECKS PASSED');
      // ⑥ H3 Major [转待办] 无用户裁决记录 → BLOCKED
      setupReview(dir, {
        body: [['2.2', ['### 🟡 M-2 · 夹具 H3 形态的延期 [转待办]',
          '**Symptom**：某处问题', '**Remedy**：下一 change 首修'].join('\n')]],
      });
      const h3Deferred = exitNode(dir, 'review');
      assertExit(h3Deferred, 1);
      assertOut(h3Deferred, 'BLOCKED');
      assertOut(h3Deferred, 'M-2');       // 严重度按 H3 标题前缀派生 → 计入 Major 延期门禁
      assertOut(h3Deferred, '用户裁决');
      // ⑦ 反向构造：同段用户裁决 + [升级] 承接 → 通过
      setupReview(dir, {
        body: [['2.2', ['### 🟡 M-2 · 夹具 H3 形态的延期 [升级] [转待办]（用户裁决：接受延期，下一 change 首修）',
          '**Symptom**：某处问题'].join('\n')]],
      });
      const h3Adjudicated = exitNode(dir, 'review');
      assertExit(h3Adjudicated, 0);
      assertOut(h3Adjudicated, 'ALL CHECKS PASSED');
      // ⑧ 段体切片的围栏语义（发现区的段界由 lib/section-body.mjs 单点决定）：条目正文里贴了 Markdown
      //    代码块时，围栏内的 `## ` 不是发现区的段界。修复前它是——发现区被重置成「非发现区」，围栏
      //    之后的发现条目整段消失，「每条发现必须有处置标记」那道门禁因此对它们形同虚设。
      const fencedFindings = [
        '### 🔴 C-3 · 夹具发现：条目正文里贴了一段 Markdown 示例',
        '**Symptom**：示例代码块里出现段标题',
        '',
        '```md',
        '## 代码块里的示例段标题',
        '```',
        '',
        '- **C-4 · 围栏之后的发现：缺处置标记**：修复前这条整段消失',
      ].join('\n');
      setupReview(dir, { body: [['2.2', fencedFindings]] });
      const fencedMissing = exitNode(dir, 'review');
      assertExit(fencedMissing, 1);
      assertOut(fencedMissing, '发现区 2 项');   // 两条都在发现区内（修复前只数到围栏之前那条）
      // ⑨ 围栏外的同级标题照常结束发现区：`## 结论` 之后的列表项不是 2.2 的发现
      setupReview(dir, { body: [['2.2', h3Finding + '\n\n## 结论\n\n- **C-9 · 段外条目：缺处置标记**']] });
      const outsideFindings = exitNode(dir, 'review');
      assertExit(outsideFindings, 1);
      assertOut(outsideFindings, '发现区 1 项');   // 段外那条不计入（计入则为 2 项）
      // ⑩ 分隔线语义保持：`---` 不结束发现区（2.2 段内的分隔线是正文，既有语义）
      setupReview(dir, { body: [['2.2', h3Finding + '\n\n---\n\n- **C-8 · 分隔线之后的发现：缺处置标记**']] });
      const afterRule = exitNode(dir, 'review');
      assertExit(afterRule, 1);
      assertOut(afterRule, '发现区 2 项');   // 分隔线之后的条目仍计入（计入才说明分隔线不结束发现区）
    },
  },

  // ============================================================================================
  // LESSONS：旧形态迁移 / 开工扫描 / 归档提名
  // ============================================================================================

  // TA-17 · LESSONS 旧形态在 open / verify / archive 三处出口被拦（AC-17）——报文逐行给出
  // 「文件:行号 → 应改成 ### L-NNN」；迁移后三处通过。
  {
    name: 'TA-17 LESSONS 旧形态（## L-NNN）在 open/verify/archive 三处出口拦并给逐行改法',
    run: async (dir) => {
      const legacyLessons = [
        '# LESSONS — 跨任务失败知识库（夹具）',
        '',
        '## 条目区（夹具）',
        '',
        '## L-501',
        '',
        '- **关键词**: guard, template',
        '',
        '夹具旧形态条目。',
        '',
      ].join('\n');
      // ① open 出口
      setupOpen(dir);
      writeFile(dir, '.specs/LESSONS.md', legacyLessons);
      const resOpen = exitNode(dir, 'open');
      assertExit(resOpen, 1);
      assertOut(resOpen, 'LESSONS.md');
      assertOut(resOpen, '### L-501');
      assertTrue(/LESSONS\.md:\d+/.test(resOpen.output), '报文应逐行给出「文件:行号」，实际: ' + resOpen.output);
      // ② verify 出口
      setupVerify(dir);
      writeFile(dir, '.specs/LESSONS.md', legacyLessons);
      const resVerify = exitNode(dir, 'verify');
      assertExit(resVerify, 1);
      assertOut(resVerify, '### L-501');
      // ③ archive 出口
      setupArchive(dir, { lessons: legacyLessons });
      const resArchive = exitNode(dir, 'archive');
      assertExit(resArchive, 1);
      assertOut(resArchive, '### L-501');
      // ④ 反向构造：迁移（改级 + 留在条目区）后三处通过——archive 一侧须同时给出齐全的归档提名
      // 证据（TA-19 起「缺 lessonsNomination 即拦」是独立判据，本条只验证旧形态迁移已消失）。
      setupOpen(dir);
      writeFile(dir, '.specs/LESSONS.md', LESSONS_FIXTURE);
      assertExit(exitNode(dir, 'open'), 0);
      setupVerify(dir);
      writeFile(dir, '.specs/LESSONS.md', LESSONS_FIXTURE);
      assertExit(exitNode(dir, 'verify'), 0);
      setupArchive(dir, {
        evidence: { lessonsNomination: { scanned: 2, nominated: ['L-501'], reasonIfNone: '' } },
      });
      const archiveOk = exitNode(dir, 'archive');
      assertExit(archiveOk, 0);
      // ⑤ C20 字段键：新 change 的模板形态新条目缺 5 键任一 → BLOCKED（字段键从 LESSONS 模板的
      // 「条目格式」书写样例派生，不在门禁里写第二份字面清单；模板夹具在场是判据可派生前提）。
      setupVerify(dir);
      writeTemplateFixture(dir, 'LESSONS');
      writeFile(dir, '.specs/LESSONS.md', [
        '# LESSONS — 跨任务失败知识库（夹具）',
        '',
        '## 条目区（夹具）',
        '',
        '### L-503 · [proc] 夹具新条目只有标题与关键词行',
        '',
        '- **关键词**: fixture field gate',
        '',
        '夹具条目正文：只有关键词行，缺其余字段键。',
        '',
      ].join('\n'));
      const missingFields = exitNode(dir, 'verify');
      assertExit(missingFields, 1);
      assertOut(missingFields, 'BLOCKED');
      assertOut(missingFields, 'L-503');
      assertOut(missingFields, '首发');
      // ⑤c runRoot 与 cwd 漂移：字段键从 runRoot 下的模板派生——guard 可能在与项目根不同的 cwd
      // 被调起（运行上下文由 FLOW_COMET_RUN_ROOT 给定）。按 cwd 解析会在模板在场时也判「模板缺失」，
      // C20 随之静默退化为未校验；反向断言同一份夹具不得出现该降级行。
      const cwdOffset = path.join(dir, 'cwd-offset');
      fs.mkdirSync(cwdOffset, { recursive: true });
      const drift = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'workflow-guard.mjs'), 'exit', 'verify', '--apply'], {
        cwd: cwdOffset,
        env: { ...process.env, FLOW_COMET_RUN_ROOT: dir, FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) },
        encoding: 'utf8',
        timeout: 60000,
      });
      const driftRes = { status: drift.status ?? 1, output: String(drift.stdout ?? '') + String(drift.stderr ?? '') };
      assertExit(driftRes, 1);
      assertOut(driftRes, 'BLOCKED');
      assertOut(driftRes, 'L-503');
      assertNotOut(driftRes, 'LESSONS 条目字段 未校验（模板缺失）');
      // ⑤b 新条目只有标题与正文（无任何字段键）同样 BLOCKED——正面回应「新条目可绕过关键词扫描」的
      // 失效模式（修复前整类条目静默通过 = RED）。
      writeFile(dir, '.specs/LESSONS.md', [
        '# LESSONS — 跨任务失败知识库（夹具）',
        '',
        '## 条目区（夹具）',
        '',
        '### L-506 · [proc] 夹具只有标题与正文的新条目',
        '',
        '夹具条目正文：一个字段键都没有。',
        '',
      ].join('\n'));
      const noFieldKeys = exitNode(dir, 'verify');
      assertExit(noFieldKeys, 1);
      assertOut(noFieldKeys, 'BLOCKED');
      assertOut(noFieldKeys, 'L-506');
      // ⑥ 迁移形态旧条目（`### L-NNN:` 冒号标题，迁移保留原标题形态）缺字段 → 只 WARN，不阻断
      setupVerify(dir);
      writeTemplateFixture(dir, 'LESSONS');
      writeFile(dir, '.specs/LESSONS.md', [
        '# LESSONS — 跨任务失败知识库（夹具）',
        '',
        '## 条目区（夹具）',
        '',
        '### L-504: 夹具迁移形态条目',
        '',
        '夹具迁移条目正文：迁移保留原标题形态，无字段行。',
        '',
      ].join('\n'));
      const migratedOld = exitNode(dir, 'verify');
      assertExit(migratedOld, 0);
      assertOut(migratedOld, 'L-504');
      assertOut(migratedOld, 'WARN');
      // ⑦ 反向构造：新条目补全 5 键 → 通过
      writeFile(dir, '.specs/LESSONS.md', [
        '# LESSONS — 跨任务失败知识库（夹具）',
        '',
        '## 条目区（夹具）',
        '',
        '### L-505 · [proc] 夹具完整条目',
        '',
        '- **首发**: ' + CHANGE_ID + ' · T01 · 2026-10-20',
        '- **上次复核**: 2026-10-20',
        '- **适用栈**: Node 18+ / 夹具',
        '- **状态**: active',
        '- **关键词**: fixture complete entry',
        '',
        '夹具条目正文。',
        '',
      ].join('\n'));
      const fieldsOk = exitNode(dir, 'verify');
      assertExit(fieldsOk, 0);
      assertOut(fieldsOk, 'ALL CHECKS PASSED');
    },
  },

  // TA-18 · 开工前 LESSONS 扫描可核对（AC-18）——① SUMMARY 缺 `## LESSONS 扫描` → BLOCKED；
  // ② 引擎按任务 write_files 命中某条关键词、而 SUMMARY 未逐条回应该编号 → BLOCKED；补齐后通过。
  {
    name: 'TA-18 LESSONS 扫描：缺声明段拦；命中条目未回应拦；补齐并逐条回应后通过',
    run: async (dir) => {
      // ① 缺 ## LESSONS 扫描 段（登记为 SUMMARY 的必填增量段）
      setupExecute(dir, { omit: ['LESSONS 扫描'] });
      writeFile(dir, '.specs/LESSONS.md', LESSONS_FIXTURE);
      const missingSection = exitNode(dir, 'execute');
      assertExit(missingSection, 1);
      assertOut(missingSection, 'LESSONS 扫描');
      // ② 声明段在场但命中条目未回应
      setupExecute(dir);
      writeFile(dir, '.specs/LESSONS.md', LESSONS_FIXTURE);
      writeFile(dir, CHANGE_DIR + '/TASK.md', '# TASK\n\n## 任务清单\n\n'
        + '<task id="T01" status="done"><action>改模板保真门禁</action>'
        + '<write_files>scripts/lib/guard-template-fidelity.mjs</write_files>'
        + '<verify>node --check baseline.js</verify></task>\n');
      const unanswered = exitNode(dir, 'execute');
      assertExit(unanswered, 1);
      assertOut(unanswered, 'L-501');
      // ③ 反向构造：逐条回应命中编号 → 通过
      setupExecute(dir, { body: [['LESSONS 扫描', '- L-501：已读并声明差异（夹具回应）。']] });
      writeFile(dir, '.specs/LESSONS.md', LESSONS_FIXTURE);
      writeFile(dir, CHANGE_DIR + '/TASK.md', '# TASK\n\n## 任务清单\n\n'
        + '<task id="T01" status="done"><action>改模板保真门禁</action>'
        + '<write_files>scripts/lib/guard-template-fidelity.mjs</write_files>'
        + '<verify>node --check baseline.js</verify></task>\n');
      const answered = exitNode(dir, 'execute');
      assertExit(answered, 0);
      assertOut(answered, 'ALL CHECKS PASSED');

      // 段体切片的围栏语义（LESSONS 扫描段的段界由 lib/section-body.mjs 单点决定）：回应写在围栏代码块
      // 之后仍算数（围栏内的 `## ` 不结束段体）；围栏外的分隔线照常结束段体。
      const lessonsScanTask = () => writeFile(dir, CHANGE_DIR + '/TASK.md', '# TASK\n\n## 任务清单\n\n'
        + '<task id="T01" status="done"><action>改模板保真门禁</action>'
        + '<write_files>scripts/lib/guard-template-fidelity.mjs</write_files>'
        + '<verify>node --check baseline.js</verify></task>\n');
      // ④ 围栏（反引号）内含二级标题 → 段体不被截断，围栏之后的回应仍被读到
      setupExecute(dir, { body: [['LESSONS 扫描',
        '```md\n## 代码块里的示例段标题\n```\n\n- L-501：已读并声明差异（围栏之后的回应）。']] });
      writeFile(dir, '.specs/LESSONS.md', LESSONS_FIXTURE);
      lessonsScanTask();
      const fencedScan = exitNode(dir, 'execute');
      assertExit(fencedScan, 0);
      assertOut(fencedScan, 'ALL CHECKS PASSED');
      // ⑤ 围栏（波浪号）同理：两种围栏记号同口径
      setupExecute(dir, { body: [['LESSONS 扫描',
        '~~~md\n## 代码块里的示例段标题\n~~~\n\n- L-501：已读并声明差异（波浪号围栏之后的回应）。']] });
      writeFile(dir, '.specs/LESSONS.md', LESSONS_FIXTURE);
      lessonsScanTask();
      const tildeScan = exitNode(dir, 'execute');
      assertExit(tildeScan, 0);
      assertOut(tildeScan, 'ALL CHECKS PASSED');
      // ⑥ 反向构造：围栏外的分隔线结束段体 —— 回应落在分隔线之后 ⇒ 等于没回应 ⇒ BLOCKED
      setupExecute(dir, { body: [['LESSONS 扫描',
        '夹具说明（本段到这里结束）。\n\n---\n\n- L-501：已读并声明差异（分隔线之后的回应）。']] });
      writeFile(dir, '.specs/LESSONS.md', LESSONS_FIXTURE);
      lessonsScanTask();
      const ruleClosedScan = exitNode(dir, 'execute');
      assertExit(ruleClosedScan, 1);
      assertOut(ruleClosedScan, 'L-501');
    },
  },

  // TA-19 · 归档提名留痕并核对（AC-19）——缺 lessonsNomination / 提名编号不存在 / 扫描份数不符
  // 三者均 BLOCKED；补齐并核对一致后通过（三负一正）。
  {
    name: 'TA-19 归档提名：缺字段/编号不存在/份数不符三负例拦，补齐后通过',
    run: async (dir) => {
      // ① 缺 lessonsNomination 字段
      setupArchive(dir);
      const missingField = exitNode(dir, 'archive');
      assertExit(missingField, 1);
      assertOut(missingField, 'BLOCKED');
      assertOut(missingField, 'lessonsNomination');
      // ② 提名编号在 LESSONS 中不存在
      setupArchive(dir, {
        evidence: { lessonsNomination: { scanned: 2, nominated: ['L-999'], reasonIfNone: '' } },
      });
      const unknownId = exitNode(dir, 'archive');
      assertExit(unknownId, 1);
      assertOut(unknownId, 'L-999');
      // ③ 扫描份数 ≠ 该 change 内 *-SUMMARY.md 数量（夹具 2 份，声明 3）
      setupArchive(dir, {
        evidence: { lessonsNomination: { scanned: 3, nominated: ['L-501'], reasonIfNone: '' } },
      });
      const countMismatch = exitNode(dir, 'archive');
      assertExit(countMismatch, 1);
      // ④ 反向构造：三项一致 → 通过
      setupArchive(dir, {
        evidence: { lessonsNomination: { scanned: 2, nominated: ['L-501'], reasonIfNone: '' } },
      });
      const ok = exitNode(dir, 'archive');
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
      // ④b 份数只数本 change 的归档目录（in-place 扩展）：归档移动已发生（活动目录不在原位）时，
      // 同后缀诱饵——名字以 -<本 change> 结尾的别的 change 归档目录——既有份数不得被数进来，也不得
      // 在本 change 归档目录缺席时充当「有目录可数」。归档目录按 <日期>-<本 change> 精确形态定位。
      setupArchive(dir, {
        evidence: { lessonsNomination: { scanned: 2, nominated: ['L-501'], reasonIfNone: '' } },
      });
      const archiveRoot = path.join(dir, '.specs', 'archive');
      // 归档移动：活动目录整体搬成 .specs/archive/2026-10-21-<本 change>/（2 份 SUMMARY 随目录走），
      // 归档产物 KNOWN-ISSUES.md 也归位到这一份目录，诱饵目录只放 3 份别人的 SUMMARY。
      fs.renameSync(path.join(dir, CHANGE_DIR), path.join(archiveRoot, '2026-10-21-' + CHANGE_ID));
      fs.renameSync(path.join(archiveRoot, '2026-10-20-' + CHANGE_ID, 'KNOWN-ISSUES.md'),
        path.join(archiveRoot, '2026-10-21-' + CHANGE_ID, 'KNOWN-ISSUES.md'));
      fs.rmSync(path.join(archiveRoot, '2026-10-20-' + CHANGE_ID), { recursive: true, force: true });
      for (let i = 1; i <= 3; i += 1) {
        writeFile(dir, '.specs/archive/2026-10-20-other-' + CHANGE_ID + '/T0' + i + '-SUMMARY.md',
          '# SUMMARY\n\n## 做了什么\n\n诱饵归档的份数。\n');
      }
      const ownArchiveCount = runGuard(['exit', 'archive'], dir);
      assertExit(ownArchiveCount, 0);
      assertOut(ownArchiveCount, 'ALL CHECKS PASSED');
      // 反向构造（同一判据 + 单变量）：本 change 的归档目录缺席、同后缀诱饵仍在场——份数不可核对
      // （null），不得退回数诱饵的 3 份。修复前 .find 命中诱饵，3 份与声明一致就整体放行：份数对账
      // 拿别人的归档作证。这里声明正好写 3，放行即证明数的是诱饵。
      fs.renameSync(path.join(archiveRoot, '2026-10-21-' + CHANGE_ID, 'KNOWN-ISSUES.md'),
        path.join(archiveRoot, '2026-10-20-other-' + CHANGE_ID, 'KNOWN-ISSUES.md'));
      fs.rmSync(path.join(archiveRoot, '2026-10-21-' + CHANGE_ID), { recursive: true, force: true });
      const decoyOnlyState = newChangeState('archive');
      decoyOnlyState.evidence.archive = {
        summary: 'archived',
        lessonsNomination: { scanned: 3, nominated: [], reasonIfNone: '无新增条目' },
      };
      writeState(dir, decoyOnlyState);
      const decoyOnly = runGuard(['exit', 'archive'], dir);
      assertExit(decoyOnly, 1);
      assertOut(decoyOnly, '工件目录缺失');
      assertNotOut(decoyOnly, 'ALL CHECKS PASSED');
      // ⑤ 扫描份数的**类型**在写入前就拦（in-place 扩展）：scanned 是出口按**数值**比对的字段
      // （份数相等才算留痕成立），故字符串 "2" 必须被 record 拒。修复前它能落库成功、要等到 archive
      // 出口才因 "2" !== 2 炸——正是 record 形状校验要消灭的「错误延后暴露」（出错的是 record，
      // 报错的却是 exit）。判据仍只判类型：取值是否等于 SUMMARY 份数归出口（③），不在这里重复业务规则。
      writeFile(dir, '.specs/LESSONS.md', LESSONS_FIXTURE);
      const recordState = baseState('archive');
      recordState.evidence.archive = { summary: 'archived' };
      writeState(dir, recordState);
      const stringScanned = runState(['record', 'archive',
        '{"summary":"archived","lessonsNomination":{"scanned":"2","nominated":[],"reasonIfNone":"无新增条目"}}'], dir);
      assertExit(stringScanned, 1);
      assertOut(stringScanned, 'lessonsNomination.scanned');
      assertOut(stringScanned, '必须是数字（当前是 string）');
      const afterReject = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      assertTrue(afterReject.evidence.archive.lessonsNomination === undefined,
        '类型非法的载荷不得落库: ' + JSON.stringify(afterReject.evidence.archive));
      // 反向构造（单变量：只把 "2" 改成 2）：同一载荷 record 通过并原样写入——判据只判类型，
      // 不新增业务规则，合法载荷不因这条形状校验变得不可写。
      const numericScanned = runState(['record', 'archive',
        '{"summary":"archived","lessonsNomination":{"scanned":2,"nominated":[],"reasonIfNone":"无新增条目"}}'], dir);
      assertExit(numericScanned, 0);
      const afterAccept = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      assertTrue(afterAccept.evidence.archive.lessonsNomination?.scanned === 2,
        '类型合法的载荷应原样写入 scanned: ' + JSON.stringify(afterAccept.evidence.archive));
    },
  },

  // ============================================================================================
  // 项目级工件 / 降级面 / 治理
  // ============================================================================================

  // TA-20 · 项目级工件的触发点（AC-20）——① CONTEXT 存在但缺模板段 → open 出口拦；
  // ② UI-DESIGN 存在但缺 frontmatter 键 → 前端 change 的 design 出口拦；
  // ③ `.specs/ARCHITECTURE.md` 缺段 → 侧命令报告列出结构问题但**不阻断**（只读）；
  // ④ CONTEXT 的「evolve 元数据」段体：段内围栏示例不截断段体，围栏里的样例字段也不算数据。
  {
    name: 'TA-20 项目级工件：CONTEXT 缺段拦、UI-DESIGN 缺 frontmatter 键拦、ARCHITECTURE 只读报告；CONTEXT 元数据段内围栏示例不截断、样例字段不算数据',
    run: async (dir) => {
      // ① CONTEXT 缺段（文件存在才查）——段清单基准来自 CONTEXT 模板，故夹具根必须带模板：
      // 模板缺席时判据按 C9 整体跳过并显式「未校验（模板缺失）」，该形态由 TA-21 覆盖。
      setupOpen(dir);
      writeTemplateFixture(dir, 'CONTEXT');
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT — 项目共享上下文\n\n## 项目概要\n\n夹具。\n');
      const resContext = exitNode(dir, 'open');
      assertExit(resContext, 1);
      assertOut(resContext, 'CONTEXT');
      // ② UI-DESIGN 缺 frontmatter 键（motion）
      setupDesign(dir, {
        changeOpts: { body: [['视觉调性', '- **选定**：6 有机 / Organic\n- **理由**：前端夹具']] },
        uiDesign: uiDesignDoc({}, ['motion']),
        declareUiDesign: true,
      });
      writeFrontendDesignMarkers(dir);
      const resUiKey = exitNode(dir, 'design');
      assertExit(resUiKey, 1);
      assertOut(resUiKey, 'motion');
      // ③ ARCHITECTURE 缺段 → 侧命令只读报告（不阻断）。模板夹具必须在场：骨架不可派生时报告走
      // 「未校验（模板缺失）」分支，此时只断言「结构问题」在降级面上空转——真实比对分支才是被测面。
      // 夹具自带 §3 的占位 ADR 条目（TEMPLATE_BODY_FIXTURES）——没有 vendored 模板的检出按登记表
      // 合成的模板因此与真迹同构，§3 字段键派生同样真跑（不会退化成「结构问题依据」里的未校验）。
      writeTemplateFixture(dir, 'ARCHITECTURE');
      writeFile(dir, '.specs/ARCHITECTURE.md', '# ARCHITECTURE — 项目级系统架构（活文档）\n\n## 1. 系统概览\n\n夹具。\n');
      const side = runSideCommand(dir, 'evolve.mjs', ['scan', '--root', dir, '--stdout']);
      assertExit(side, 0);
      assertOut(side, '结构问题');
      assertOut(side, 'ARCHITECTURE');
      assertOut(side, '缺 H2 段 7/8');   // 8 个 H2 段只写了 1 个
      assertOut(side, '2. 模块清单');     // 逐条列出缺哪个段名，不是只报数量
      assertNotOut(side, '未校验');       // 走的是真实比对分支，不是模板缺席降级
      assertNotOut(side, 'BLOCKED');      // 只读报告：结构问题不进退出码、不阻断
      // 反向构造（判别力）：按模板补齐 8 个 H2 段 → 同一判据报 0 项（证明「缺段」不是常量输出）
      writeFile(dir, '.specs/ARCHITECTURE.md', renderDoc('ARCHITECTURE'));
      const sideOk = runSideCommand(dir, 'evolve.mjs', ['scan', '--root', dir, '--stdout']);
      assertExit(sideOk, 0);
      assertOut(sideOk, '结构问题（.specs/ARCHITECTURE.md）：0 项');
      // ④ CONTEXT 的「evolve 元数据」段体：段界由 lib/section-body.mjs 单点决定（本任务把
      //    context-init 的同名私有实现收进单源）。两条腿——
      //    ① 段里贴了含 `## ` 的围栏示例、三字段写在示例**之后** ⇒ 段体不被示例里的标题截断，
      //      校验通过（INIT-DONE）；
      //    ② 三字段只写在围栏**内** ⇒ 仍判缺字段（围栏里的书写样例不是数据——段体切片之前结构文本
      //      已剥离围栏，这条钉住了「别为了省事直接拿原文切片」这个错法）。
      const ctxRoot = path.join(dir, 'ctx-init');
      fs.mkdirSync(path.join(ctxRoot, 'reference'), { recursive: true });
      fs.copyFileSync(scenarioProtocolPath(dir), scenarioProtocolPath(ctxRoot));
      const contextDoc = (fieldsInFence) => [
        '# CONTEXT',
        '## 项目概要', 'x',
        '## 技术栈', 'x',
        '## 域语言', '| 术语 | 定义 |', '|---|---|', '| 例 | 定义 |',
        '## 已锁决策', '- [2026-08-01] 决策一',
        '## 默认偏好', 'x',
        '## 既有抽象索引', 'x',
        '## evolve 元数据', '',
        '```md',
        '## 示例段（围栏内，不是段界）',
        ...(fieldsInFence
          ? ['- **last_evolve_at**: 2026-09-01T10:00:00+08:00', '- **scanner**: fixture', '- **下次建议**: 无']
          : []),
        '```',
        ...(fieldsInFence
          ? []
          : ['', '- **last_evolve_at**: 2026-09-01T10:00:00+08:00', '- **scanner**: fixture', '- **下次建议**: 无']),
        '## intel-scan 元数据',
        '- **last_intel_scan**: x', '- **scanner**: x', '- **下次重扫建议**: x',
        '',
      ].join('\n');
      writeFile(ctxRoot, '.specs/CONTEXT.md', contextDoc(false));
      const ctxFenced = runState(['init', CHANGE_ID + '-ctx', '--init-context'], ctxRoot);
      assertExit(ctxFenced, 0);
      assertOut(ctxFenced, 'INIT-DONE');
      assertNotOut(ctxFenced, 'INIT-VALIDATE-FAILED');
      writeFile(ctxRoot, '.specs/CONTEXT.md', contextDoc(true));
      const ctxFencedOnly = runState(['init', CHANGE_ID + '-ctx2', '--init-context'], ctxRoot);
      assertExit(ctxFencedOnly, 0);
      assertOut(ctxFencedOnly, 'INIT-VALIDATE-FAILED');
      assertOut(ctxFencedOnly, 'evolve 元数据');
    },
  },

  // TA-21 · 模板缺席时降级并显式声明（AC-21）——夹具根没有 flow-kit/templates/ → 不阻断，输出显式
  // 「未校验（模板缺失）」。反向构造：模板在场时同一工件必被拦（证明不是判据空转）。
  // ③④ 追加「段名清单单一来源」：模板缺席时仍要生效的四份段名清单（SUMMARY 段序兜底 / open·design 段名回退 /
  // LESSONS 扫描段名 / SUMMARY 必填三段）只许骨架模块登记一份——静态单源锁 + 行为侧反向构造。
  // ⑤ 追加「段体切片单源锁」的静态面：受检面 = 引擎实现面（不再只是取用面），形态面含行扫描与正则
  // 切片两种；仍存在的同类实现逐条登记（文件 + 符号 + 理由），并配回退探针证明锁看得见它们。
  //    写法面追加字符串字面量切分、位置面追加对象字面量内联箭头（各有合成切片探针）：字面量切分写在
  //    属性箭头里正是静态锁此前的盲区——引擎里因此留着第二份段体切片而判据全绿。
  // ⑦ 追加「配对键单源」：第三族的任务对键只在 task-graph 表达一次，[P] 判据的补集消费它返回的判定；
  //    反向构造三层（换名字 / 换分隔符的第二份键 + 形态漂移的行为变异体）证明补集断言真的敏感。
  {
    name: 'TA-21 模板缺席降级：不阻断且显式输出「未校验（模板缺失）」；模板在场时同夹具被拦；段名清单 / 段体切片 / 任务对键单源锁（受检面 = 引擎实现面）',
    run: async (dir) => {
      // ① 模板缺席：只写工件，不写 flow-kit/templates/
      writeFile(dir, CHANGE_DIR + '/CHANGE.md', renderDoc('CHANGE', { omit: ['影响面'] }));
      writeFile(dir, CHANGE_DIR + '/REQUIREMENT.md', renderDoc('REQUIREMENT'));
      const st = newChangeState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      const degraded = exitNode(dir, 'open');
      assertExit(degraded, 0);
      assertOut(degraded, '未校验');
      assertOut(degraded, '模板缺失');
      assertNotOut(degraded, 'BLOCKED');
      // ② 反向构造：模板在场 → 同一工件被拦（缺段判据确实在跑）
      setupOpen(dir, { omit: ['影响面'] });
      const blocked = exitNode(dir, 'open');
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');

      // ③ 段名清单单一来源静态锁：四份清单的定义面必须落在**骨架模块**（由骨架实现符号
      // `buildSkeleton` 反查，不写文件名），消费面由文本里的真实引用派生（模块搬迁 / 新增消费方
      // 不必改锚）。消费方只取用：自带第二份定义、或改从别处取用，都由同一判据判定违规。
      const skeletonModule = engineDefinitionModule('buildSkeleton');
      assertTrue(skeletonModule !== null,
        '骨架实现的定义面应恰一处（反查失败）: ' + JSON.stringify(engineDefinitionHits('buildSkeleton')));
      const texts = engineScriptTexts();
      const segmentSymbols = [
        'LEGACY_SUMMARY_ORDER',
        'TEMPLATE_FALLBACK_SECTION_PATTERNS',
        'LESSONS_SCAN_SECTION',
        'SUMMARY_REQUIRED_SECTIONS',
      ];
      const issues = [];
      for (const symbol of segmentSymbols) {
        const lookup = engineDefinitionModule(symbol);
        if (lookup === null) {
          issues.push(symbol + ' 的定义面不唯一（应恰一处）: ' + JSON.stringify(engineDefinitionHits(symbol)));
          continue;
        }
        if (lookup.file !== skeletonModule.file) {
          issues.push(symbol + ' 的清单落在 ' + lookup.file + '（唯一来源应是骨架模块 ' + skeletonModule.file + '）');
        }
        for (const problem of singleSourceImportProblems({ symbol, sourceRel: lookup.file, texts })) {
          issues.push(problem);
        }
      }
      assertTrue(issues.length === 0, '段名清单单源违规: ' + issues.join(' | '));

      // ③b 反向构造（同一判据驱动 · 逐项改坏输入 ⇒ 必报，还原 ⇒ 复绿）：四份清单逐份证明判别力，
      // 不是「只有某一份碰巧被测到」。
      {
        const sourceRel = skeletonModule.file;
        const sourceText = texts.get(sourceRel);
        for (const symbol of segmentSymbols) {
          const consumer = [...texts.keys()].find((rel) => rel !== sourceRel
            && new RegExp('import\\s*\\{[^}]*\\b' + symbol + '\\b').test(texts.get(rel)));
          if (consumer === undefined) {
            issues.push('反向构造前提不成立：找不到 ' + symbol + ' 的具名取用消费方');
            continue;
          }
          const consumerText = texts.get(consumer);
          // 探针对象带 changed（变异落在哪个文件），前提检查按它判定——不拿展示用 label 当控制流。
          const probes = [
            ['消费方自带第二份定义',
              new Map(texts).set(consumer, consumerText + '\nconst ' + symbol + ' = [];\n'), '自带第二份', consumer],
            ['源侧定义被抽掉（单源面被破坏）',
              new Map(texts).set(sourceRel,
                sourceText.replace('export const ' + symbol + ' =', 'const renamedSegmentOrderProbe =')),
              '单一来源被破坏', sourceRel],
            ['消费方不再取用（import 被抽掉）',
              new Map(texts).set(consumer, dropNamedImport(consumerText, symbol)), '未从', consumer],
          ];
          for (const [label, mutated, expected, changed] of probes) {
            if (mutated.get(changed) === texts.get(changed)) {
              issues.push(symbol + ' 反向构造前提失效（' + label + '）：变异未改变 ' + changed);
              continue;
            }
            const reported = singleSourceImportProblems({ symbol, sourceRel, texts: mutated });
            if (!reported.some((problem) => problem.includes(expected))) {
              issues.push(symbol + ' 反向构造判别力缺失（' + label + ' 未被判违规）');
            }
          }
          if (singleSourceImportProblems({ symbol, sourceRel, texts }).length !== 0) {
            issues.push(symbol + ' 反向构造还原后未复绿（判据受输入顺序影响）');
          }
        }
        assertTrue(issues.length === 0, '段名清单单源锁反向构造失败: ' + issues.join(' | '));
      }

      // ④ 行为侧反向构造：模板缺席时 SUMMARY 的段序判据确实吃清单——负例（段序偏离）被拦、
      // 正例（按模板段序）通过；清单若与真实段序脱节，两格至少一格红（清单不是摆设）。
      const executeState = () => {
        const next = newChangeState('execute');
        next.evidence.execute = { summary: 'executed' };
        next.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
        return next;
      };
      resetFixture(dir);
      writeBaseline(dir);
      writeFile(dir, CHANGE_DIR + '/TASK.md', '# TASK\n\n## 任务清单\n\n' + TASK_DONE);
      // 负例：把「做了什么」挪到「越界检查」之后 → 偏离兜底段序 → BLOCKED（模板缺席也判）
      writeFile(dir, CHANGE_DIR + '/T01-SUMMARY.md', renderDoc('SUMMARY', { swap: [['做了什么', '越界检查']] }));
      writeState(dir, executeState());
      const outOfOrder = exitNode(dir, 'execute');
      assertExit(outOfOrder, 1);
      assertOut(outOfOrder, '未校验');
      assertOut(outOfOrder, '段序');
      // 正例：段序按清单 → 通过
      writeFile(dir, CHANGE_DIR + '/T01-SUMMARY.md', renderDoc('SUMMARY'));
      writeState(dir, executeState());
      const ordered = exitNode(dir, 'execute');
      assertExit(ordered, 0);
      assertOut(ordered, 'ALL CHECKS PASSED');

      // ⑤ 模板整份缺席：命名段检查**全部跳过**（含 pick 类）。夹具：没有
      // flow-kit/templates/，且 CHANGE.md 连 `## Why` 都没有——旧实现拿
      // `TEMPLATE_FALLBACK_SECTION_PATTERNS.changeWhy` 判「缺必填段」而 BLOCKED，与「模板缺失全部
      // 跳过」相反。跳过后必须放行，且输出仍显式声明未校验（跳过可见、不是静默通过，L-079）。
      fs.rmSync(path.join(dir, 'flow-kit'), { recursive: true, force: true });
      resetFixture(dir);
      writeFile(dir, CHANGE_DIR + '/CHANGE.md', renderDoc('CHANGE', { omit: ['Why'] }));
      writeFile(dir, CHANGE_DIR + '/REQUIREMENT.md', renderDoc('REQUIREMENT'));
      const openState = () => {
        const next = newChangeState('open');
        next.evidence.open = { summary: 'intake complete' };
        return next;
      };
      writeState(dir, openState());
      const noFallback = exitNode(dir, 'open');
      assertExit(noFallback, 0);
      assertNotOut(noFallback, '缺必填段');
      assertOut(noFallback, '未校验');
      assertOut(noFallback, '模板缺失');

      // ⑥ C9 后半句（反向构造）：模板**在场**但该段名缺席（上游改版）⇒ 命名段 fallback 仍生效。
      // 同一缺 Why 的工件在「模板不含 Why」的夹具上必须被拦——否则「整份缺席不回落」会被写成
      // 「干脆不查」。
      resetFixture(dir);
      writeTemplateFixtureOmittingSection(dir, 'CHANGE', 'Why');
      writeFile(dir, CHANGE_DIR + '/CHANGE.md', renderDoc('CHANGE', { omit: ['Why'] }));
      writeFile(dir, CHANGE_DIR + '/REQUIREMENT.md', renderDoc('REQUIREMENT'));
      writeState(dir, openState());
      const fallbackStill = exitNode(dir, 'open');
      assertExit(fallbackStill, 1);
      assertOut(fallbackStill, '缺必填段');

      // ⑦ 判据形态（同一 pick 的两态）：整份模板缺席 ⇒ 返回显式「跳过」判据（`skip` 标记 +
      // `.test` 恒真），不是 fallback 正则、也不是 null——消费方里有闭包外直接 `.test` 的调用点
      // （「视觉调性」段读取），返回 null 会把「跳过」退化成 TypeError 崩溃（未校验变失败）。
      const routing = await import('../lib/guard-routing.mjs');
      const underivedPatterns = await routing.templateSectionPatterns({ runRoot: path.join(dir, 'bare-root') });
      const skippedPick = underivedPatterns.pick('change', ['Why'], routing.TEMPLATE_FALLBACK_SECTION_PATTERNS.changeWhy);
      assertTrue(skippedPick !== routing.TEMPLATE_FALLBACK_SECTION_PATTERNS.changeWhy
        && skippedPick?.skip === true
        && skippedPick.test('不含 Why 的夹具正文（旧实现据此判缺段）') === true,
      '整份模板缺席时 pick 应返回显式跳过判据（不回落 fallback），实际: ' + String(skippedPick));
      const derivedPatterns = await routing.templateSectionPatterns({ runRoot: dir });
      const fallbackPick = derivedPatterns.pick('change', ['Why'], routing.TEMPLATE_FALLBACK_SECTION_PATTERNS.changeWhy);
      assertTrue(fallbackPick instanceof RegExp && fallbackPick.test('## Why（为什么做）'),
        '模板在场但缺该段名时 pick 仍回落 fallback 正则（C9 后半句），实际: ' + String(fallbackPick));

      // ⑤ 段体切片单源锁：受检面 = **引擎实现面**（`engineScriptTexts`：顶层入口 ∪ 静态可达模块 ∪
      //    非套件自持的 `lib/**`）——不再是「提到 sectionBody 的取用面」：把一份私有实现搬进面内一个
      //    不引用该符号的模块（健康巡检、任一 guard 模块）就躲不开了。三条判据：① 单源模块由导出面派生
      //    （不写文件名），{sectionBody, scanHeadings}
      //    都定义在那里；② 取用面：提到单源符号的模块必须具名取用、不得自带第二份定义；③ 形态面：
      //    面内任一函数的任一形态（行扫描 / 正则切片）若在切段体，只许是单源本身，否则必须登记
      //    （SECTION_SLICE_REGISTRY：文件 + 符号 + 理由；陈旧登记判红）。
      //    反向构造：合成切片放进「不引用单源符号」的模块（证明受检面比取用面宽）/ 改 import 来源 /
      //    第二份定义 / 本任务收口的三处各自改回私有实现 / 登记放行真实副本 / 陈旧登记 / 缺理由登记
      //    ——逐条证明判别力，还原 ⇒ 复绿。
      {
        const texts = engineScriptTexts();
        const baseProblems = sectionSingleSourceProblems({ texts });
        assertTrue(baseProblems.length === 0, '段体单源违规: ' + baseProblems.join(' | '));
        const probeIssues = [];
        // 探针打在**登记之外**的消费方上，否则变异会被登记豁免吃掉、退化成恒绿。
        const consumers = [...texts.keys()].filter((rel) => /\b(?:sectionBody|scanHeadings)\b/u
          .test(engineCodeText(texts.get(rel) ?? '')));
        const probeRel = consumers.find((rel) => !SECTION_SLICE_REGISTRY.some((entry) => entry.file === rel));
        const probeText = texts.get(probeRel);
        const probeSlicer = [
          'function probeSectionBody(content) {',
          '  const body = [];',
          '  for (const line of String(content).split(/\\n/)) {',
          '    if (/^##\\s/u.test(line)) break;',
          '    body.push(line);',
          '  }',
          '  return body.join("\\n");',
          '}',
        ].join('\n');
        // 受检面必须比取用面宽（否则「形态面」只是换名字的取用面）：把同一份合成切片放进一个从不引用
        // 单源符号的模块，判据仍须点名它。这条同时钉住了 SECTION_SLICE_REGISTRY 的登记面——那几条
        // 命中都不 import sectionBody，一旦受检面退回取用面，它们会立刻变成陈旧登记（也是红的）。
        const shadowRel = SECTION_SLICE_REGISTRY[0].file;
        assertTrue(!/\b(?:sectionBody|scanHeadings)\b/u.test(engineCodeText(texts.get(shadowRel) ?? '')),
          '受检面扩面的前提失效：' + shadowRel + ' 引用了单源符号（形态面与取用面不再可区分）');
        const shadowProblems = sectionSingleSourceProblems({
          texts: new Map(texts).set(shadowRel, (texts.get(shadowRel) ?? '') + '\n' + probeSlicer),
        });
        if (!shadowProblems.some((problem) => problem.includes(shadowRel) && problem.includes('probeSectionBody'))) {
          probeIssues.push('受检面退回了取用面：' + shadowRel + ' 里的合成切片未被判红（'
            + JSON.stringify(shadowProblems) + '）');
        }
        // 取用面两格：改 import 来源（单符号 import 摘名字靠不住，换来源才是同一件事的可靠构造）/
        // 自带第二份定义。
        const referenced = SECTION_SOURCE_SYMBOLS.find((symbol) => new RegExp('\\b' + symbol + '\\b', 'u')
          .test(engineCodeText(probeText))) ?? 'sectionBody';
        const retargeted = probeText.replace(/(from\s*'[^']*)section-body\.mjs'/u, "$1section-body-absent.mjs'");
        const takenProbes = [
          ['消费方不再从单源取用（import 来源被换掉）', retargeted, '未从'],
          ['消费方自带第二份定义', probeText + '\nfunction ' + referenced + '() { return null; }\n', '自带第二份'],
        ];
        for (const [label, mutatedText, expected] of takenProbes) {
          if (mutatedText === probeText) {
            probeIssues.push(label + '：变异未改变 ' + probeRel);
            continue;
          }
          const reported = sectionSingleSourceProblems({ texts: new Map(texts).set(probeRel, mutatedText) });
          if (!reported.some((problem) => problem.includes(probeRel) && problem.includes(expected))) {
            probeIssues.push(label + '：未被判违规（' + JSON.stringify(reported) + '）');
          }
        }
        // 写法面两格（C 字符串字面量切分 / D 对象字面量内联箭头）各一份**合成实现**放进取用面之外的
        // 模块 ⇒ 判据必须点名它们：旧锁对这两种写法都判绿（B 的判据只认正则字面量，functionBodies 只看
        // 顶层声明），「锁看不见」于是无从发现——这一格是这两种写法的常驻判别力锚。
        const syntheticSlicers = [
          ['C 字符串字面量切分', 'probeStringSlicer', [
            'function probeStringSlicer(content) {',
            '  return (String(content).split("## S")[1] ?? "").split("\\n##")[0];',
            '}',
          ].join('\n')],
          ['D 对象字面量内联箭头', 'probeInlineSlicer', [
            'const probeChecks = [',
            '  {',
            '    probeInlineSlicer: (text) => {',
            '      const seg = (text.split("## 已锁决策")[1] ?? "").split("\\n##")[0];',
            '      return seg.length >= 0;',
            '    },',
            '  },',
            '];',
          ].join('\n')],
        ];
        for (const [label, symbol, synthetic] of syntheticSlicers) {
          const reported = sectionSingleSourceProblems({
            texts: new Map(texts).set(shadowRel, (texts.get(shadowRel) ?? '') + '\n' + synthetic),
          });
          if (!reported.some((problem) => problem.includes(shadowRel) && problem.includes(symbol))) {
            probeIssues.push('形态面未覆盖「' + label + '」：' + shadowRel + ' 里的合成切片 ' + symbol
              + ' 未被判红（' + JSON.stringify(reported) + '）');
          }
        }
        // 形态面：本任务收口的三处各自改回私有实现 ⇒ 锁必红（变异体 = 删掉的旧实现原文）。
        const revertedTexts = new Map();
        for (const reverted of REVERTED_PRIVATE_SLICERS) {
          // 变异体按 LF 归一后再套用（工作树是 CRLF，锚文本写的是 LF）：不归一时整段锚永远找不到，
          // 探针会以「锚已漂移」红——那红说的是行尾，不是判据。
          const original = (texts.get(reverted.rel) ?? '').replace(/\r\n/gu, '\n');
          let mutated = original;
          for (const [from, to] of reverted.edits) {
            if (!mutated.includes(from)) {
              probeIssues.push(reverted.label + '：锚已漂移（' + reverted.rel + ' 里找不到待替换片段）');
              continue;
            }
            mutated = mutated.split(from).join(to);
          }
          if (mutated === original) {
            probeIssues.push(reverted.label + '：变异未改变 ' + reverted.rel);
            continue;
          }
          revertedTexts.set(reverted.rel, mutated);
          const reported = sectionSingleSourceProblems({ texts: new Map(texts).set(reverted.rel, mutated) });
          for (const symbol of reverted.symbols) {
            if (!reported.some((problem) => problem.includes(reverted.rel) && problem.includes(symbol))) {
              probeIssues.push(reverted.label + '：锁没看见 ' + reverted.rel + ' 的 ' + symbol
                + '（' + JSON.stringify(reported) + '）');
            }
          }
        }
        // 登记机制本身的三格：陈旧登记判红 / 缺理由判红 / **登记不能放行真实副本**（给 context-init
        // 的私有 sectionBody 配一条登记，判据仍须报「自带第二份定义」——登记只覆盖形态命中）。
        const staleRegistry = [...SECTION_SLICE_REGISTRY, {
          file: 'lib/guard-uidesign.mjs', symbol: 'visualToneSectionState', reason: '（探针）已收口处仍登记',
        }];
        const staleProblems = sectionSingleSourceProblems({ texts, registry: staleRegistry });
        if (!staleProblems.some((problem) => problem.includes('登记已陈旧') && problem.includes('visualToneSectionState'))) {
          probeIssues.push('陈旧登记未被判红（已收口的视觉调性段体仍登记）: ' + JSON.stringify(staleProblems));
        }
        const noReasonProblems = sectionSingleSourceProblems({
          texts,
          registry: [{ ...SECTION_SLICE_REGISTRY[0], reason: '  ' }],
        });
        if (!noReasonProblems.some((problem) => problem.includes('登记缺理由'))) {
          probeIssues.push('缺理由登记未被判红: ' + JSON.stringify(noReasonProblems));
        }
        const lenientProblems = sectionSingleSourceProblems({
          texts: new Map(texts).set('context-init.mjs', revertedTexts.get('context-init.mjs') ?? ''),
          registry: [...SECTION_SLICE_REGISTRY, {
            file: 'context-init.mjs', symbol: 'sectionBody', reason: '（探针）给真实副本配一条登记',
          }],
        });
        if (!lenientProblems.some((problem) => problem.includes('context-init.mjs')
          && problem.includes('第二份 sectionBody'))) {
          probeIssues.push('登记放行了真实副本（context-init 的私有 sectionBody 配登记后仍须判红）: '
            + JSON.stringify(lenientProblems));
        }
        if (sectionSingleSourceProblems({ texts }).length !== 0) probeIssues.push('还原后未复绿（判据受输入顺序影响）');
        assertTrue(probeIssues.length === 0, '段体单源锁反向构造失败: ' + probeIssues.join(' | '));
      }

      // ⑥ 段体契约（单源的语义面，八格逐条对照）：围栏内的标题与分隔线不结束段体；围栏外的同级标题
      //    与分隔线按 options 结束；结束标题的级别按 options；段缺席返回 null（与「段在场正文为空」
      //    可区分——调用方据此判「未校验」而不是「没写」）。
      {
        const sectionModule = await import('../lib/section-body.mjs');
        const contract = [
          ['围栏内的二级标题不结束段体',
            '## S\n\n```md\n## 块内标题\n```\n\n正文\n\n## T\n', /^##\s*S/u, {},
            '\n```md\n## 块内标题\n```\n\n正文\n'],
          ['波浪号围栏同口径',
            '## S\n\n~~~md\n## 块内标题\n~~~\n\n正文\n', /^##\s*S/u, {}, '\n~~~md\n## 块内标题\n~~~\n\n正文\n'],
          ['围栏外的同级标题结束段体',
            '## S\n\n正文\n\n## T\n\n别段\n', /^##\s*S/u, {}, '\n正文\n'],
          ['分隔线结束段体（默认）',
            '## S\n\n正文\n\n---\n\n尾\n', /^##\s*S/u, {}, '\n正文\n'],
          ['分隔线不结束段体（endOnSeparator: false）',
            '## S\n\n正文\n\n---\n\n尾\n', /^##\s*S/u, { endOnSeparator: false },
            '\n正文\n\n---\n\n尾\n'],
          ['三级标题不结束二级段体（level: 2）',
            '## S\n\n正文\n\n### 子\n\n子正文\n', /^##\s*S/u, {},
            '\n正文\n\n### 子\n\n子正文\n'],
          ['同级标题结束三级段体（level: 3）',
            '### S\n\n正文\n\n### T\n\n别段\n', /^###\s*S/u, { level: 3 }, '\n正文\n'],
          ['段缺席返回 null',
            '## 其他\n\n正文\n', /^##\s*S/u, {}, null],
        ];
        for (const [label, docText, pattern, options, expected] of contract) {
          const actual = sectionModule.sectionBody(docText, pattern, options);
          assertTrue(actual === expected,
            '段体契约（' + label + '）: 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
        }
      }

      // ⑦ 配对键单源（P8）：第三族（同文件跨任务）的「任务对键」只在 task-graph 表达一次；[P] 判据的
      //    补集（写面重叠 ⇒ 不该被要求标 [P]）消费 task-graph 返回的判定，不自己再建一份键——第二份键
      //    的形态一旦漂移（换分隔符 / 换定序），两端键不再相等，补集静默失效（重叠的一对被当成「本可
      //    并行」）。反向构造三层：静态两格（换名字的第二份键 / 换分隔符的漂移形态都必红）+ 行为一格
      //    （把补集判据改回自建键且形态漂移 ⇒ 重叠对被误报，补集断言必红）。
      {
        const texts = engineScriptTexts();
        const baseProblems = pairKeySingleSourceProblems({ texts });
        assertTrue(baseProblems.length === 0, '任务对键单源违规: ' + baseProblems.join(' | '));
        const waveRel = (engineDefinitionModule('parallelGapReview') ?? {}).file;
        assertTrue(typeof waveRel === 'string', '补集判据的定义面不唯一（反查失败）: '
          + JSON.stringify(engineDefinitionHits('parallelGapReview')));
        const waveText = texts.get(waveRel) ?? '';
        const secondKeyMutants = [
          ['换名字的第二份键（历史上删掉的 gapPairKey 原形）',
            '\nfunction gapPairKey(left, right) {\n'
            + '  return left < right ? left + "\\u0000" + right : right + "\\u0000" + left;\n}\n'],
          ['换分隔符的漂移形态（判据不看分隔符取值）',
            '\nfunction probePairKey(a, b) {\n  return a < b ? a + "|" + b : b + "|" + a;\n}\n'],
        ];
        for (const [label, injected] of secondKeyMutants) {
          const reported = pairKeySingleSourceProblems({ texts: new Map(texts).set(waveRel, waveText + injected) });
          assertTrue(reported.some((problem) => problem.includes(waveRel)),
            '配对键单源锁看不见「' + label + '」: ' + JSON.stringify(reported));
        }
        // 行为面：同一对任务（同波同层、写同一个文件、都没标 parallel）在两支下对照——真实模块里补集
        // 判据把这对排除（写面重叠的一对不是「可并行」）；变异体（补集判据改回自建键 + 分隔符漂移）
        // 里两端键对不上 ⇒ 同一对被误报成「可并行却未标 [P]」⇒ 补集断言变红。
        const overlapTask = (id) => '<task id="' + id + '" status="pending"><action>实现 ' + id
          + '</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify>'
          + '<depends_on></depends_on></task>\n';
        const overlapTaskContent = '# TASK\n\n## 波次划分\n\nWave 1: T01, T02\n\n## 任务清单\n\n'
          + overlapTask('T01') + overlapTask('T02');
        const overlapBlocks = taskBlocks(overlapTaskContent);
        const waveModule = await import('../lib/wave-projection.mjs');
        const overlapWaves = waveModule.waveProjectionReview({
          taskContent: overlapTaskContent, blocks: overlapBlocks,
        });
        assertTrue(overlapWaves.waves instanceof Map && overlapWaves.waves.size === 2,
          '夹具前提失效：波次分组应可判（' + JSON.stringify([...((overlapWaves.waves) ?? [])]) + '）');
        const realGaps = waveModule.parallelGapReview({
          taskContent: overlapTaskContent, blocks: overlapBlocks, waves: overlapWaves.waves,
        });
        assertTrue(realGaps.gaps.length === 0,
          '补集判据失效：写面重叠（同一文件）的一对被要求标 [P]（' + JSON.stringify(realGaps.gaps) + '）');
        // 变异体只在内存里编译（data: URL，相对 import 重写为绝对 file: URL）：不落盘、不留残留。
        const inlineModuleUrl = (source, rel) => {
          const rewritten = source.replace(/(from\s*')(\.[^']*)(')/gu, (whole, head, specifier, tail) =>
            head + pathToFileURL(path.resolve(SCRIPTS_DIR, path.dirname(rel), specifier)).href + tail);
          return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(rewritten);
        };
        // 变异 = 把「取单源判定」换回「两端各算一次键」，并只让**消费方**那一端漂移（生产方仍用
        // task-graph 的 NUL 形态）：这正是第二份键实现存在的真实风险——改一端、漏一端，键就不再相等。
        // 两处锚各自只改一处代码位置（不搬动实参行），变异体因此语法完整、只把键的两份形态造出来。
        const decisionAnchor = '  const { isOverlappingPair } = collectCrossTaskConflicts({';
        const gapsAnchor = '  const gaps = [];';
        assertTrue(waveText.includes(decisionAnchor) && waveText.includes(gapsAnchor),
          '反向构造前提失效：' + waveRel + ' 未按单源形态取用第三族判定（锚已漂移）');
        const driftedText = waveText
          .replace(decisionAnchor, '  const probeResult = collectCrossTaskConflicts({')
          .replace(gapsAnchor, [
            "  const producerPairKey = (a, b) => (a < b ? a + '\\u0000' + b : b + '\\u0000' + a);",
            "  const consumerPairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);",
            '  const overlappingPairs = new Set(probeResult.conflicts.map((conflict)'
              + ' => producerPairKey(conflict.a, conflict.b)));',
            '  const isOverlappingPair = (a, b) => overlappingPairs.has(consumerPairKey(a, b));',
            '  const gaps = [];',
          ].join('\n'));
        assertTrue(driftedText !== waveText, '反向构造前提失效：变异未改变 ' + waveRel);
        const driftedModule = await import(inlineModuleUrl(driftedText, waveRel));
        const driftedGaps = driftedModule.parallelGapReview({
          taskContent: overlapTaskContent, blocks: overlapBlocks, waves: overlapWaves.waves,
        });
        assertTrue(driftedGaps.gaps.length > 0,
          '反向构造失效：补集判据改回「自建键 + 分隔符漂移」后，写面重叠的一对没有被误报——'
          + '说明该断言对任务对键的形态不敏感（' + JSON.stringify(driftedGaps.gaps) + '）');
      }
    },
  },

  // TA-22 · 版本漂移在发版期被发现（AC-22）——登记表记录的模板指纹与锁定快照不一致 → 漂移可判；
  // 一致时零漂移。反向构造：改写一个字节后 drift 必为 true（同一判据函数）。
  // 指纹判据的输入必须是模板真迹：没有 vendored 模板的检出（CI 全新检出）里夹具按登记表合成段形，
  // 合成文本的 sha 与登记表锁定的 sha 天然不可比——此时「一致 → 无漂移」无从执行，不得当作通过
  // （未验证 ≠ 通过），也不得据此断言漂移（登记表并没有错）。真迹在场才全强度执行，否则可见 SKIP。
  {
    name: 'TA-22 指纹漂移：模板与锁定快照一致判无漂移，改一字节判漂移（模板非真迹时显式 SKIP）',
    run: async (dir) => {
      const skeleton = await import('../lib/guard-artifact-skeleton.mjs');
      // 骨架按项目根缓存——漂移对比必须落在另一个项目根上，否则读到的是缓存值（判据空转）
      const cleanRoot = path.join(dir, 'clean');
      const driftRoot = path.join(dir, 'drift');
      const realTemplateRel = docRel('SUMMARY');
      const realTemplatePresent = fs.existsSync(path.join(REPO_ROOT, ...realTemplateRel.split('/')));
      // ① 一致 → drift === false
      writeFile(cleanRoot, realTemplateRel, templateFixtureText('SUMMARY'));
      const clean = await skeleton.templateFingerprint('SUMMARY', { runRoot: cleanRoot });
      assertTrue(clean.derived === true, '模板在场时骨架应可派生（derived=true），实际: ' + JSON.stringify(clean));
      if (realTemplatePresent) {
        assertTrue(clean.drift === false, '模板与登记表指纹一致时应判无漂移，实际: ' + JSON.stringify(clean));
        // ② 反向构造：改一个字节 → drift === true
        writeFile(driftRoot, realTemplateRel, templateFixtureText('SUMMARY') + '\n漂移探针。\n');
        const drifted = await skeleton.templateFingerprint('SUMMARY', { runRoot: driftRoot });
        assertTrue(drifted.drift === true, '模板被改写后应判漂移，实际: ' + JSON.stringify(drifted));
      } else {
        console.log('SKIP: TA-22 的指纹漂移判据（模板非真迹：本检出无 vendored ' + realTemplateRel
          + '，夹具按登记表合成段形，实测 sha ' + clean.actualSha256 + ' 与登记表锁定 '
          + clean.recordedSha256 + ' 不可比）——本次检出未执行「一致 → 无漂移 / 改一字节 → 漂移」，'
          + '请在权威源检出重跑本套件（未验证 ≠ 通过）');
      }
      // ②b 指纹归一化：BOM / 行尾是检出噪音——同一内容的 LF 形态与 BOM+CRLF 形态必须同指纹
      // （归一化由骨架模块单实现）。反向构造：内容真变一行 → 指纹必不同，证明「同值」不是恒等判据。
      const lfText = templateFixtureText('SUMMARY').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
      const bomCrlfText = '\uFEFF' + lfText.replace(/\n/gu, '\r\n');
      assertTrue(bomCrlfText.startsWith('\uFEFF') && bomCrlfText.includes('\r\n'),
        '夹具前提不成立：BOM+CRLF 形态未构造出来');
      const crlfRoot = path.join(dir, 'crlf');
      writeFile(crlfRoot, docRel('SUMMARY'), bomCrlfText);
      const byCrlf = await skeleton.templateFingerprint('SUMMARY', { runRoot: crlfRoot });
      assertTrue(byCrlf.derived === true, 'BOM+CRLF 模板应仍可派生，实际: ' + JSON.stringify(byCrlf));
      assertTrue(byCrlf.actualSha256 === clean.actualSha256,
        'BOM+CRLF 与 LF 形态应同指纹（行尾/BOM 不改变指纹），实际: '
        + byCrlf.actualSha256 + ' vs ' + clean.actualSha256);
      // 反向构造（判别力）：同一构造再加一行 → 指纹必不同（否则「同值」可能只是判据恒等）
      const mutatedRoot = path.join(dir, 'crlf-mutated');
      writeFile(mutatedRoot, docRel('SUMMARY'), bomCrlfText + '\n归一化探针。\n');
      const byMutated = await skeleton.templateFingerprint('SUMMARY', { runRoot: mutatedRoot });
      assertTrue(byMutated.actualSha256 !== clean.actualSha256,
        '内容多一行后指纹必须不同（归一化不得吞掉内容），实际仍为 ' + byMutated.actualSha256);

      // ③ 关外键：登记表没有的模板键 → 显式未知（不静默当作「无漂移」）
      const unknown = await skeleton.templateFingerprint('NO-SUCH-TEMPLATE', { runRoot: cleanRoot });
      assertTrue(unknown.derived === false && unknown.reason === 'unknown-key',
        '未知模板键应显式标注 unknown-key，实际: ' + JSON.stringify(unknown));
      // ④ 发版期检查接线：CI 已包含登记表指纹比对步骤。CI workflow 属主仓分发面（安装副本无
      // `.github/`）：结构性缺席时输出可见 SKIP（未验证 ≠ 通过），不让缺席把整条场景判红。
      const ciRel = '.github/workflows/ci.yml';
      if (!repoFileExists(ciRel)) {
        console.log('SKIP: TA-22 的发版期检查接线面（' + ciRel + ' 不在本检出）——本次检出未校验 CI 是否比对'
          + '登记表指纹，请在权威源检出重跑本套件（未验证 ≠ 通过）');
      } else {
        assertTrue(repoFileText(ciRel).includes('artifact-templates.json'),
          '发版期检查应比对登记表指纹（CI 需引用 reference/artifact-templates.json）');
      }

      // ⑤ 登记表与模板分叉（正例）：登记表登记的段在模板里不存在（模板回退 / 上游删段）⇒ 按模板为准忽略
      // 并**可见 WARN**，不阻断。旧实现把这批登记项静默丢弃（`registered` 标志算出后无消费方），
      // 登记表滞后因此不可见。单位面看骨架把这类段单独报出；端到端看门禁真实发声且不阻断。
      const staleRoot = path.join(dir, 'stale');
      writeTemplateFixtureOmittingSection(staleRoot, 'CHANGE', '视觉调性');
      const stale = await skeleton.buildSkeleton('CHANGE', { runRoot: staleRoot });
      const toneEntry = (docEntry('CHANGE').sections ?? []).find((section) => section.name.includes('视觉调性'));
      assertTrue(toneEntry !== undefined, '登记表 CHANGE 缺「视觉调性」段（夹具前提不成立）');
      assertTrue(stale.derived === true, '模板仍在场（只少一段）时应可派生，实际: ' + JSON.stringify(stale));
      assertTrue((stale.registryOnlySections ?? []).includes(toneEntry.name),
        '登记表多出的段应被单独报出（不是静默丢弃），实际: ' + JSON.stringify(stale.registryOnlySections));
      resetFixture(dir);
      writeTemplateFixtureOmittingSection(dir, 'CHANGE', '视觉调性');
      writeFile(dir, CHANGE_DIR + '/CHANGE.md', renderDoc('CHANGE'));
      writeFile(dir, CHANGE_DIR + '/REQUIREMENT.md', renderDoc('REQUIREMENT'));
      const openState = () => {
        const next = newChangeState('open');
        next.evidence.open = { summary: 'intake complete' };
        return next;
      };
      writeState(dir, openState());
      const warned = exitNode(dir, 'open');
      assertExit(warned, 0);
      assertOut(warned, 'TEMPLATE-REGISTRY WARN');
      assertOut(warned, '视觉调性');
      assertNotOut(warned, 'BLOCKED');

      // ⑥ 登记表与模板分叉（反例）：登记表与模板一致 ⇒ 同一门禁不得发声（WARN 是滞后信号，不是常驻噪音，
      // 否则真信号会被自己淹没）。
      setupOpen(dir);
      const fresh = await skeleton.buildSkeleton('CHANGE', { runRoot: dir });
      assertTrue(fresh.registryOnlySections.length === 0,
        '登记表与模板一致时不得报「多出的段」，实际: ' + JSON.stringify(fresh.registryOnlySections));
      const quiet = exitNode(dir, 'open');
      assertExit(quiet, 0);
      assertNotOut(quiet, 'TEMPLATE-REGISTRY WARN');
    },
  },

  // TA-23 · 覆盖声明与同步面（AC-23）——7 册「必填段清单」两栏表与引擎一致；14 册锚句在场；
  // Guardrails 表中被新门禁覆盖的行不再声称「guard 不校验」；verify 册 UAT 的「验收结果」改为仅存在性；
  // 入口册覆盖声明四要素齐备。全部为仓库级文本断言，逐条带变异探针。
  {
    name: 'TA-23 覆盖声明与同步面：7 册两栏表、14 册锚句、Guardrails 同步、UAT 仅存在性',
    run: () => {
      const twoColumnBooks = [
        'flow-comet-open', 'flow-comet-design', 'flow-comet-plan', 'flow-comet-execute',
        'flow-comet-review', 'flow-comet-verify', 'flow-comet-subagent-execute',
      ];
      const books = new Map();
      for (const name of twoColumnBooks) books.set(name + '/SKILL.md', skillBookText(name));
      books.set('flow-comet/SKILL.md', skillBookText('flow-comet'));
      books.set('flow-comet-review/SKILL.md', skillBookText('flow-comet-review'));
      books.set('flow-comet-verify/SKILL.md', skillBookText('flow-comet-verify'));
      books.set('flow-comet-archive/SKILL.md', skillBookText('flow-comet-archive'));

      const rules = [];
      for (const name of twoColumnBooks) {
        rules.push({
          rel: name + '/SKILL.md',
          label: '两栏表（左无条件段 / 右条件段与增量段）',
          include: ['无条件段', '增量段', 'flow-kit/templates/'],
        });
      }
      rules.push({
        rel: 'flow-comet/SKILL.md',
        label: '覆盖声明四要素',
        include: ['只读', '不采用', '沿用', '以本节为准'],
      });
      // phase-gated 反转句：四要素在场不等于方向反转还在——「本仓是 phase-gated」对抗上游 artifact-first 的那句是
      // 覆盖声明的实质（既引用上游又表态取向），抽掉它四要素仍全在，故单独锚。
      rules.push({
        rel: 'flow-comet/SKILL.md',
        label: 'phase-gated 反转句',
        include: ['artifact-first', '本仓是 **phase-gated**：8 节点 entry/exit 门'],
      });
      // 方向反转之外还须说明阶段门与工件门的关系：只有「有门」说不出门守的是什么，抽掉该句入口册
      // 读起来就像拿阶段门替代工件（「阶段门 = 工件检查的替代品」正是本仓要挡的过度解读）。
      rules.push({
        rel: 'flow-comet/SKILL.md',
        label: '阶段门与工件门的关系句',
        include: ['阶段门是工件门的加强，不是替代'],
      });
      rules.push({
        rel: 'flow-comet-review/SKILL.md',
        label: 'Guardrails 行与新门禁同步',
        include: ['test-pyramid-checked'],
        exclude: ['test-pyramid-checked` | TEST.md 5-round completeness verified | 执行纪律（review 把关），guard 不校验'],
      });
      rules.push({
        rel: 'flow-comet-verify/SKILL.md',
        label: 'Guardrails 行与新门禁同步 + UAT 仅存在性',
        include: ['lessons-nominated', '仅存在性'],
      });
      rules.push({
        rel: 'flow-comet-archive/SKILL.md',
        label: 'Guardrails 行与新门禁同步',
        include: ['changelog-updated'],
        exclude: ['changelog-updated` | CHANGELOG.md has new entry | 执行纪律（review 把关），guard 不校验'],
      });

      const problems = textRuleProblems(books, rules);
      // 变异探针：正向（抽掉目标文字 ⇒ 必报）与反向（补上缺失文字 ⇒ 不再报，证判据不恒真）。
      // 预期片段一律取报文里的成句形态（缺「X」/ 仍含旧表述），避免与规则标签串混淆。
      assertProbesDiscriminate(problems, books, rules, [
        ['抽掉两栏表左栏', 'flow-comet-open/SKILL.md', (text) => text.replace(/无条件段/g, '必填段'), '缺「无条件段」'],
        ['抽掉两栏表右栏', 'flow-comet-design/SKILL.md', (text) => text.replace(/增量段/g, '追加段'), '缺「增量段」'],
        ['补上两栏表', 'flow-comet-plan/SKILL.md',
          (text) => text + '\n| 左栏：无条件段 | 右栏：条件段 / 增量段（flow-kit/templates/ 派生） |\n', '缺「无条件段」', false],
        ['抽掉覆盖声明要素', 'flow-comet/SKILL.md', (text) => text.replace(/以本节为准/g, ''), '缺「以本节为准」'],
        ['补上覆盖声明要素', 'flow-comet/SKILL.md', (text) => text + '\n与本册冲突时以本节为准。\n沿用项见上表。\n', '缺「以本节为准」', false],
        ['抽掉 phase-gated 反转句', 'flow-comet/SKILL.md',
          (text) => text.replace('本仓是 **phase-gated**：8 节点 entry/exit 门', '本仓方向与上游一致'),
          '缺「本仓是 **phase-gated**：8 节点 entry/exit 门」'],
        ['抽掉阶段门关系句', 'flow-comet/SKILL.md',
          (text) => text.replace('阶段门是工件门的加强，不是替代', ''),
          '缺「阶段门是工件门的加强，不是替代」'],
        ['Guardrails 行改回旧表述', 'flow-comet-review/SKILL.md',
          (text) => text.replace('test-pyramid-checked',
            'test-pyramid-checked` | TEST.md 5-round completeness verified | 执行纪律（review 把关），guard 不校验'), 'guard 不校验'],
        ['补上 UAT 仅存在性', 'flow-comet-verify/SKILL.md',
          (text) => text + '\nUAT.md 的 `## 验收结果` 段仅存在性校验。\n', '缺「仅存在性」', false],
      ]);
      if (problems.length > 0) throw new Error('覆盖声明与同步面不符: ' + problems.join('; '));
    },
  },

  // TA-24 · 公开面不再说假话（AC-24）——5 对双语公开文本的覆盖表述与实际门禁范围一致：不再有
  // 「完全继承 / 段名在运行时派生」这类 overclaim；机制册的「哪些节点查段名」表覆盖全部出口；
  // 故障排查给出两阶段报错指引；工件保真条点明本仓增量段。
  //
  // 缺席的**两种读法**（判据面形态先判，再判内容）：本检出带公开面（docs/、CONTRIBUTING.md 或
  // .github/ 任一在场）时，该面任何一份文档缺席都是判据失效——「两份机制册都被删」= 公开面机制
  // 文档不在检出面，判红，不能只落一条 SKIP；只有整份载体俱缺（安装副本只带技能树、npm 包按 files
  // 白名单不含 docs/ 与 CONTRIBUTING / .github）才是合法的「本检出没有这一面」，此时输出可见 SKIP
  // 并明确写「本次未校验」，仍不算通过。
  {
    name: 'TA-24 公开面口径：5 对双语去除 overclaim，机制表覆盖全出口，缺席即红（整面缺席才 SKIP）',
    run: async (dir) => {
      const pairs = [
        ['README.md', 'README-zh.md'],
        ['CONTRIBUTING.md', 'CONTRIBUTING-zh.md'],
        ['docs/USAGE.md', 'docs/USAGE-zh.md'],
        ['docs/MECHANISM.md', 'docs/MECHANISM-zh.md'],
        ['docs/TROUBLESHOOTING.md', 'docs/TROUBLESHOOTING-zh.md'],
      ];
      // 形态判据先于内容判据：公开面载体整份缺席 = 本检出不含公开文档（安装副本 / npm 包形态），
      // 整面输出一条可见 SKIP——不是「已校验」，也不把合法形态判红。判据本体走 lib 的
      // publicFaceDocsAbsent（与底部自检、场景 105 同一实现）：本场景不再自持第二套（曾按
      // docs/authority-map.json 在不在分流）；单看 docs/ 也不够——它被裁掉而 CONTRIBUTING.md /
      // .github/ 还在时，这五对文档的判据会整块变成 SKIP。
      if (publicFaceDocsAbsent(REPO_ROOT)) {
        console.log('SKIP: TA-24 的公开面口径判据（此形态不含公开文档：docs/、CONTRIBUTING.md 与 .github/'
          + ' 都不在本检出）——本次检出未校验 5 对双语公开文档的 overclaim / 机制表 / 排查指引口径，'
          + '请在权威源检出重跑本套件（未验证 ≠ 通过）');
        return;
      }
      // 形态分派自身的常驻判别力锚：临时根上驱动同一判定，分派对错不再只能靠「在包形态里整跑一次
      // 套件」才知道。夹具的「完整形态」从本检出的公开面真迹复制，故只在声明了公开面的检出上跑。
      await assertPublicFaceSelfCheckShapes(dir);
      // 判据面完整在册（缺席用 null 占位而不是从集合里删掉）：缺席由下面的缺席判据逐份点名，
      // 「少了哪份文件」因此是**判据事实**，不是可以静默缩小的受检面。
      const docs = new Map();
      for (const [en, zh] of pairs) {
        for (const rel of [en, zh]) docs.set(rel, repoFileExists(rel) ? repoFileText(rel) : null);
      }
      const problems = publicFaceAbsenceProblems(docs);
      // 缺席判据的变异探针（同一实现、纯内存）：抽掉两份机制册 ⇒ 必须报「不在检出面」。修复前
      // 「两份机制册都被删」只落一条 SKIP（缺席被读成未校验），公开面机制文档整份消失而套件仍绿。
      // 缺失在判据面里表现为「键在场、文本为 null」（与真实路径同一形态：文件不在 ≠ 键被删）。
      const shrunk = new Map(docs);
      for (const rel of ['docs/MECHANISM.md', 'docs/MECHANISM-zh.md']) shrunk.set(rel, null);
      const absenceProbe = publicFaceAbsenceProblems(shrunk);
      if (absenceProbe.length === 0 || !absenceProbe[0].includes('docs/MECHANISM.md')) {
        problems.push('反向构造判别力缺失（抽掉两份机制册未被判「不在检出面」）');
      }
      const rules = [
        { rel: 'README-zh.md', label: '去 overclaim（继承表述）', exclude: ['完全继承'] },
        { rel: 'README.md', label: '去 overclaim（继承表述）', exclude: ['inherits its artifacts and rules'] },
        { rel: 'CONTRIBUTING-zh.md', label: '段名来源改为上游模板 + 本仓增量', exclude: ['段名在运行时从 vendored 模板派生'] },
        { rel: 'docs/USAGE-zh.md', label: '工件保真条点明增量段', include: ['增量段'] },
        { rel: 'docs/TROUBLESHOOTING-zh.md', label: '两阶段报错指引', include: ['两阶段'] },
        { rel: 'docs/MECHANISM-zh.md', label: '机制表覆盖全出口', include: ['段名是否符合模板'] },
      ];
      // 内容判据跑全表（不再按「本检出有没有这份文件」缩小）：缺席的文档在规则面里报「不在判据面内」，
      // 缺席本身已由上方缺席判据逐份点名——受检面不因文件消失而静默变窄。
      problems.push(...textRuleProblems(docs, rules));
      // 机制行的出口清单覆盖：行按结构定位（机制表里适用面最宽的那行），8 个出口一个都不能少。
      problems.push(...mechanismRowProblems(docs));
      // 机制行判据自己的变异探针（同一函数驱动）——词形定位的失效形态与「判据恒真」各配一条：
      //  正锚：把「含『段名』且提到 plan」的段落插到机制表之前，结构定位不得被抢位；
      //  反向：从机制行抽掉一个出口 ⇒ 必须报「未覆盖出口」。
      const zhMechanism = docs.get('docs/MECHANISM-zh.md');
      if (typeof zhMechanism === 'string') {
        const hijack = '结构预检只跑结构那一半：缺 H2 段只按类别报计数，具体段名留到节点收尾的完整 `exit`；'
          + '`plan` 节点的任务块另查七字段。';
        const hijacked = hijack + '\n' + zhMechanism;
        // 正锚比对「定位到哪一行」，不比对报文——否则真实断言先红时探针会被遮蔽，看不出判别力。
        const beforeRow = findMechanismRow(zhMechanism);
        const afterRow = findMechanismRow(hijacked);
        if (legacyMechanismLine(hijacked) === legacyMechanismLine(zhMechanism)) {
          problems.push('正锚构造前提失效（段名段落未被词形判据抢位）');
        } else if (beforeRow === null || afterRow === null || afterRow.index !== beforeRow.index + 1) {
          problems.push('机制行定位被抢位：插入的「段名 + plan」段落改写了定位结果');
        }
        if (beforeRow === null) {
          problems.push('反向构造前提失效（未定位到机制行）');
        } else {
          const lines = zhMechanism.split(/\r?\n/);
          lines[beforeRow.index] = lines[beforeRow.index].replace('`execute`', '');
          const gutted = lines.join('\n');
          if (gutted === zhMechanism) {
            problems.push('反向构造前提失效（机制行未发生变化）');
          } else if (!mechanismRowProblems(new Map(docs).set('docs/MECHANISM-zh.md', gutted))
            .some((problem) => problem.includes('未覆盖出口 execute'))) {
            problems.push('反向构造判别力缺失（抽掉出口 execute 未被判违规）');
          }
        }
      }
      // 变异探针：正向（overclaim 写回 / 口径改回旧形态）与反向（补上缺失口径 ⇒ 不再报）。
      // 文本探针只在该文档真实在场时执行：缺席的文档无法被「改写」，其缺席已由缺席判据判红。
      const activeProbes = [
        ['overclaim 写回', 'README-zh.md', (text) => text + '\n工件与规则完全继承。\n', '仍含旧表述「完全继承」'],
        ['段名来源改回运行时派生', 'CONTRIBUTING-zh.md',
          (text) => text + '\n段名在运行时从 vendored 模板派生。\n', '仍含旧表述「段名在运行时从 vendored 模板派生」'],
        ['补上两阶段指引', 'docs/TROUBLESHOOTING-zh.md',
          (text) => text + '\n## 缺段报错（两阶段）\n\n首次只给模板路径与类别计数，再犯才列段名。\n', '缺「两阶段」', false],
        ['补上增量段口径', 'docs/USAGE-zh.md',
          (text) => text + '\n工件保真 = 上游模板段 + 本仓增量段。\n', '缺「增量段」', false],
      ].filter(([, rel]) => typeof docs.get(rel) === 'string');
      assertProbesDiscriminate(problems, docs, rules, activeProbes);
      if (problems.length > 0) throw new Error('公开面口径不符: ' + problems.join('; '));
    },
  },

  // TA-25 · 治理落盘（AC-25）——4 条 ADR 在场；已锁决策 / 定义更新；机制册新增条目；发布清单增
  // 模板指纹检查项；主仓指导文件的 guard 校验描述同步；债务账本登记本批债务。
  // 维护者面（docs/internal、.specs）整组缺席时输出可见 SKIP（未验证 ≠ 通过）。
  {
    name: 'TA-25 治理落盘：4 条 ADR + 已锁决策/机制册/发布清单/指导文件同步 + 债务登记',
    run: () => {
      const problems = [];
      // 治理落盘面 = 维护者主树面（docs/internal/ + CLAUDE.md + .specs 流程工件面）。安装副本
      // 结构性缺席该面时输出一条可见 SKIP（未验证 ≠ 通过）：载体自带的 CONTEXT / ADR 与本仓治理
      // 面同名不同物，不能拿它们当本批落盘证据，也不该因它们的存在把场景判红。
      if (!maintainerFacePresent()) {
        console.log('SKIP: TA-25 的治理落盘判据（docs/internal/ 维护者面与 .specs 流程工件面结构性缺席）——'
          + '本次检出未校验 4 条 ADR、已锁决策/机制册/发布清单/指导文件同步与债务登记，请在维护者主树重跑本套件（未验证 ≠ 通过）');
        return;
      }
      // ① 4 条 ADR 在场（编号 + 主题骨架）
      const adrDir = path.join(REPO_ROOT, '.specs', 'adr');
      const adrNumbers = ['018', '019', '020', '021'];
      if (!fs.existsSync(adrDir)) {
        console.log('SKIP: 治理落盘判据——.specs/adr/ 不在本检出（流程工件面缺席，未验证 ≠ 通过）');
      } else {
        const files = fs.readdirSync(adrDir);
        for (const number of adrNumbers) {
          if (!files.some((name) => name.startsWith('ADR-' + number + '-'))) {
            problems.push('缺 ADR-' + number + '（本批治理决策应落盘 4 条）');
          }
        }
      }
      // ② 维护者文档面（docs/internal 缺席 → 整组可见 SKIP）
      const maintainerDocs = [
        'docs/internal/ARCHITECTURE.md',
        'docs/internal/MECHANISM.md',
        'docs/internal/DOC-CHECKLIST.md',
        'docs/internal/ROADMAP.md',
      ];
      const present = maintainerDocs.filter(repoFileExists);
      if (present.length !== maintainerDocs.length) {
        console.log('SKIP: 治理落盘判据——docs/internal/ 维护者面缺席（' + maintainerDocs.filter((rel) => !repoFileExists(rel)).join('、')
          + '）；本次检出未校验该面，请回维护者主树重跑');
      } else {
        const docs = new Map(maintainerDocs.map((rel) => [rel, repoFileText(rel)]));
        const rules = [
          {
            rel: 'docs/internal/ARCHITECTURE.md',
            label: '已锁决策补模板权威与结构级校验边界',
            include: ['已锁决策', '模板', '结构级'],
          },
          { rel: 'docs/internal/MECHANISM.md', label: '机制册新增模板权威条目', include: ['模板权威'] },
          { rel: 'docs/internal/DOC-CHECKLIST.md', label: '发布期登记表指纹检查项', include: ['指纹'] },
        ];
        problems.push(...textRuleProblems(docs, rules));
        // ③ 债务账本登记——账本段内至少三行分别指向模板 / 指纹 / 骨架三类债务主题
        const roadmap = docs.get('docs/internal/ROADMAP.md') ?? '';
        const ledger = roadmap.split(/^## /m).find((chunk) => chunk.startsWith('债务账本')) ?? '';
        const debtLines = ledger.split(/\r?\n/).filter((line) => /模板|指纹|骨架/.test(line) && /^\|/.test(line)).length;
        if (debtLines < 3) {
          problems.push('债务账本应登记本批 3 条债务（模板/指纹/骨架 相关行），实际 ' + debtLines + ' 行');
        }
        assertProbesDiscriminate(problems, docs, rules, [
          ['补上模板指纹检查项', 'docs/internal/DOC-CHECKLIST.md',
            (text) => text + '\n- 发布期比对条件段登记表的模板指纹。\n', '缺「指纹」', false],
          ['补上机制册条目', 'docs/internal/MECHANISM.md',
            (text) => text + '\n## 模板权威（版本漂移检查）\n', '缺「模板权威」', false],
        ]);
      }
      // ④ CONTEXT 的已锁决策段（流程工件面）
      if (!repoFileExists('.specs/CONTEXT.md')) {
        console.log('SKIP: 治理落盘判据——.specs/CONTEXT.md 不在本检出（流程工件面缺席，未验证 ≠ 通过）');
      } else {
        const context = repoFileText('.specs/CONTEXT.md');
        if (!context.includes('## 已锁决策')) problems.push('.specs/CONTEXT.md 缺「## 已锁决策」段');
        if (!context.includes('模板')) problems.push('.specs/CONTEXT.md 已锁决策/定义未更新模板权威口径');
      }
      // ⑤ 主仓指导文件的 guard 校验描述同步（维护者面：缺席即跳过并可见）
      if (!repoFileExists('CLAUDE.md')) {
        console.log('SKIP: 治理落盘判据——CLAUDE.md 不在本检出（主仓私有面缺席，未验证 ≠ 通过）');
      } else {
        const guide = repoFileText('CLAUDE.md');
        if (!guide.includes('模板')) problems.push('CLAUDE.md 的 guard 校验描述未同步模板权威口径');
      }
      if (problems.length > 0) throw new Error('治理落盘不符: ' + problems.join('; '));
    },
  },
];
