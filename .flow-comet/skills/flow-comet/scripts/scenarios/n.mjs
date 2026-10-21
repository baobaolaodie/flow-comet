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
  engineDefinitionHits,
  engineDefinitionModule,
  engineScriptTexts,
  handoffFor,
} from '../lib/test-fixtures.mjs';
import { scenarioProtocolPath } from '../lib/test-assertions.mjs';
import { maintainerFacePresent, singleSourceImportProblems } from '../lib/text-anchor-checks.mjs';

// ---------- 登记表与模板夹具（夹具输入面，不是判据） ----------

const REGISTRY_FILE = path.join(SCRIPTS_DIR, '..', 'reference', 'artifact-templates.json');
const CHANGE_DIR = '.specs/' + CHANGE_ID;
const SKILLS_ROOT = path.join(SCRIPTS_DIR, '..', '..');

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

// 登记表合成形态的段正文覆盖：LESSONS 的「条目格式」段是条目字段键判据（C20）的唯一派生源——
// CI 全新检出没有 vendored 模板时也要给出等价书写样例，否则该判据在 CI 里会退化成「无法派生」而空转。
const TEMPLATE_BODY_FIXTURES = {
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

// 段级正文覆盖：[模板键, 段名片段, 正文]——只在夹具需要实质内容的位置使用。
const BODY_OVERRIDES = [
  ['SUMMARY', '6 维自查', SIX_DIM_BODY],
  ['SUMMARY', 'verify 输出', VERIFY_COMMAND_BODY],
  ['REQUIREMENT', '验收准则', '- Given 夹具前置\n- When 夹具动作\n- Then 夹具结果（AC 夹具）'],
  ['REQUIREMENT', '用户故事', '- US-1 作为执行者，我想让夹具可通过结构校验。'],
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
    name: 'TA-02 H3 结构子段缺则拦（TEST 1.5 / SUMMARY 已知接受 + 理由），示例条目不参与骨架',
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
  // 子段不要求）；⑤⑥ UI-DESIGN §0（optional）整段删除合法，但保留标题就得填。
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
      // ④ 反向构造（判别力）：把第 4 轮改成有实质内容 → 其结构子段重新变为必填 → 缺子段必拦
      setupVerify(dir, { body: [['兼容性测试', '实测了三种视口组合的兼容性结论。']], subsectionOmit: ['跨浏览器'] });
      const resRound4 = exitNode(dir, 'verify');
      assertExit(resRound4, 1);
      assertOut(resRound4, '跨浏览器');
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
  {
    name: 'TA-11 旧 change 同构缺段只 WARN 不阻断；同一夹具新 change 必 BLOCKED',
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
    },
  },

  // TA-12 · 增量段合法位置（AC-12）——①②④⑤ 合法位置通过；③ 自检方法夹在中间 → BLOCKED。
  // 合法位置：紧随越界检查 / 文末 / 验证命令标题后紧跟代码块 / LESSONS 扫描位于自检方法之后。
  {
    name: 'TA-12 增量段位置：紧随越界检查/文末/验证命令+代码块/LESSONS 扫描在后均通过，夹中间拦',
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
    },
  },

  // ============================================================================================
  // 加载链与协议面
  // ============================================================================================

  // TA-13 · 加载链三件套（AC-13）——entry 打印 `READ TEMPLATE: <模板路径>`；skill-load 未带模板
  // 声明的标记 → record 对新 change BLOCKED 并提示 `--templates`；explain 输出 `TEMPLATE:` 行。
  // 反向构造：标记声明了模板 → record 不拦。
  {
    name: 'TA-13 加载链：entry 打印 READ TEMPLATE，record 缺 --templates 声明拦，explain 有 TEMPLATE 行',
    run: async (dir) => {
      writeTemplateFixture(dir, 'DESIGN');
      const st = newChangeState('design');
      writeState(dir, st);
      // ① entry 打印模板指针（引擎推导，不依赖纪律）
      const entry = runGuard(['entry', 'design'], dir);
      assertExit(entry, 0);
      assertOut(entry, 'READ TEMPLATE: flow-kit/templates/DESIGN.md');
      // ② 标记缺模板声明 → record BLOCKED 且提示 --templates
      writeFile(dir, CHANGE_DIR + '/.skill-loads/design-flow-comet-design.json',
        JSON.stringify({ node: 'design', skill: 'flow-comet-design', protocol: '2-design.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const recordBlocked = runState(['record', 'design', '{"summary":"design done"}'], dir);
      assertExit(recordBlocked, 1);
      assertOut(recordBlocked, '--templates');
      // ③ 反向构造：标记声明了模板 → record 放行
      writeFile(dir, CHANGE_DIR + '/.skill-loads/design-flow-comet-design.json',
        JSON.stringify({
          node: 'design', skill: 'flow-comet-design', protocol: '2-design.md',
          templates: ['DESIGN'], at: '2026-08-01T00:00:00.000Z',
        }, null, 2) + '\n');
      const recordOk = runState(['record', 'design', '{"summary":"design done"}'], dir);
      assertExit(recordOk, 0);
      assertNotOut(recordOk, 'BLOCKED');
      // ④ explain 现问输出模板行
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
    },
  },

  // TA-15 · 报错两阶段与记忆（AC-15）——同一工件首次因缺段被拦：只给模板路径 + 类别计数，不列段名；
  // 再犯：列出段名；工件通过后标记清除。反向构造：修复后复检 + 标记文件不再记录该工件。
  {
    name: 'TA-15 两阶段报错：首次不列段名、再犯列段名、通过后清标记',
    run: async (dir) => {
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
    },
  },

  // ============================================================================================
  // 项目级工件 / 降级面 / 治理
  // ============================================================================================

  // TA-20 · 项目级工件的触发点（AC-20）——① CONTEXT 存在但缺模板段 → open 出口拦；
  // ② UI-DESIGN 存在但缺 frontmatter 键 → 前端 change 的 design 出口拦；
  // ③ `.specs/ARCHITECTURE.md` 缺段 → 侧命令报告列出结构问题但**不阻断**（只读）。
  {
    name: 'TA-20 项目级工件：CONTEXT 缺段拦、UI-DESIGN 缺 frontmatter 键拦、ARCHITECTURE 只读报告',
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
    },
  },

  // TA-21 · 模板缺席时降级并显式声明（AC-21）——夹具根没有 flow-kit/templates/ → 不阻断，输出显式
  // 「未校验（模板缺失）」。反向构造：模板在场时同一工件必被拦（证明不是判据空转）。
  // ③④ 追加 D16：模板缺席时仍要生效的四份段名清单（SUMMARY 段序兜底 / open·design 段名回退 /
  // LESSONS 扫描段名 / SUMMARY 必填三段）只许骨架模块登记一份——静态单源锁 + 行为侧反向构造。
  {
    name: 'TA-21 模板缺席降级：不阻断且显式输出「未校验（模板缺失）」；模板在场时同夹具被拦；段名清单单源锁',
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

      // ③ 段名清单单一来源静态锁（D16）：四份清单的定义面必须落在**骨架模块**（由骨架实现符号
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

      // ⑤ C9 前半句（D42）：整份模板缺席 ⇒ 命名段检查**全部跳过**（含 pick 类）。夹具：没有
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
    },
  },

  // TA-22 · 版本漂移在发版期被发现（AC-22）——登记表记录的模板指纹与锁定快照不一致 → 漂移可判；
  // 一致时零漂移。反向构造：改写一个字节后 drift 必为 true（同一判据函数）。
  {
    name: 'TA-22 指纹漂移：模板与锁定快照一致判无漂移，改一字节判漂移',
    run: async (dir) => {
      const skeleton = await import('../lib/guard-artifact-skeleton.mjs');
      // 骨架按项目根缓存——漂移对比必须落在另一个项目根上，否则读到的是缓存值（判据空转）
      const cleanRoot = path.join(dir, 'clean');
      const driftRoot = path.join(dir, 'drift');
      // ① 一致 → drift === false
      writeFile(cleanRoot, docRel('SUMMARY'), templateFixtureText('SUMMARY'));
      const clean = await skeleton.templateFingerprint('SUMMARY', { runRoot: cleanRoot });
      assertTrue(clean.derived === true, '模板在场时骨架应可派生（derived=true），实际: ' + JSON.stringify(clean));
      assertTrue(clean.drift === false, '模板与登记表指纹一致时应判无漂移，实际: ' + JSON.stringify(clean));
      // ② 反向构造：改一个字节 → drift === true
      writeFile(driftRoot, docRel('SUMMARY'), templateFixtureText('SUMMARY') + '\n漂移探针。\n');
      const drifted = await skeleton.templateFingerprint('SUMMARY', { runRoot: driftRoot });
      assertTrue(drifted.drift === true, '模板被改写后应判漂移，实际: ' + JSON.stringify(drifted));
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

      // ⑤ C14 / D17（正例）：登记表登记的段在模板里不存在（模板回退 / 上游删段）⇒ 按模板为准忽略
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

      // ⑥ C14 / D17（反例）：登记表与模板一致 ⇒ 同一门禁不得发声（WARN 是滞后信号，不是常驻噪音，
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
  {
    name: 'TA-24 公开面口径：5 对双语去除 overclaim，机制表覆盖全出口，排查给两阶段指引',
    run: () => {
      const docs = new Map();
      const missingFaces = [];
      const pairs = [
        ['README.md', 'README-zh.md'],
        ['CONTRIBUTING.md', 'CONTRIBUTING-zh.md'],
        ['docs/USAGE.md', 'docs/USAGE-zh.md'],
        ['docs/MECHANISM.md', 'docs/MECHANISM-zh.md'],
        ['docs/TROUBLESHOOTING.md', 'docs/TROUBLESHOOTING-zh.md'],
      ];
      for (const [en, zh] of pairs) {
        const missing = [en, zh].filter((rel) => !repoFileExists(rel));
        if (missing.length > 0) {
          missingFaces.push(...missing);
          continue;
        }
        docs.set(en, repoFileText(en));
        docs.set(zh, repoFileText(zh));
      }
      // 公开面在安装副本形态结构性缺席（目标项目只有技能包，无本仓公开文档）：整面输出一条可见
      // SKIP（未验证 ≠ 通过）——缺席既不算「判据违规」，也不静默当成已校验。
      if (missingFaces.length > 0) {
        console.log('SKIP: TA-24 的公开面口径判据（' + [...new Set(missingFaces)].join('、') + ' 不在本检出）——'
          + '本次检出未校验 5 对双语公开文档的 overclaim / 机制表 / 排查指引口径，请在权威源检出重跑本套件（未验证 ≠ 通过）');
      }
      const rules = [
        { rel: 'README-zh.md', label: '去 overclaim（继承表述）', exclude: ['完全继承'] },
        { rel: 'README.md', label: '去 overclaim（继承表述）', exclude: ['inherits its artifacts and rules'] },
        { rel: 'CONTRIBUTING-zh.md', label: '段名来源改为上游模板 + 本仓增量', exclude: ['段名在运行时从 vendored 模板派生'] },
        { rel: 'docs/USAGE-zh.md', label: '工件保真条点明增量段', include: ['增量段'] },
        { rel: 'docs/TROUBLESHOOTING-zh.md', label: '两阶段报错指引', include: ['两阶段'] },
        { rel: 'docs/MECHANISM-zh.md', label: '机制表覆盖全出口', include: ['段名是否符合模板'] },
      ];
      // 判据只落在本检出真实存在的文档上：缺席面已由上方 SKIP 行显式声明未验证。
      const activeRules = rules.filter((rule) => docs.has(rule.rel));
      const problems = textRuleProblems(docs, activeRules);
      // 机制表一行的出口清单覆盖：execute / verify 必须在列（旧表只列 5 个出口）
      for (const [rel, needNodes] of [
        ['docs/MECHANISM-zh.md', ['execute', 'verify']],
        ['docs/MECHANISM.md', ['execute', 'verify']],
      ]) {
        const text = docs.get(rel);
        if (typeof text !== 'string') continue;
        const row = text.split(/\r?\n/).find((line) => line.includes('段名') && /open|design|plan/.test(line)) ?? '';
        if (row === '') {
          problems.push(rel + ' 缺「节点文档是否符合模板」机制行（无法核对出口面）');
          continue;
        }
        for (const node of needNodes) {
          if (!row.includes(node)) problems.push(rel + ' 机制行未覆盖出口 ' + node + '（口径落后于门禁范围）');
        }
      }
      // 变异探针：正向（overclaim 写回 / 口径改回旧形态）与反向（补上缺失口径 ⇒ 不再报）。
      // 含缺席面的探针不执行——上方 SKIP 行已显式声明该面未验证。
      const activeProbes = [
        ['overclaim 写回', 'README-zh.md', (text) => text + '\n工件与规则完全继承。\n', '仍含旧表述「完全继承」'],
        ['段名来源改回运行时派生', 'CONTRIBUTING-zh.md',
          (text) => text + '\n段名在运行时从 vendored 模板派生。\n', '仍含旧表述「段名在运行时从 vendored 模板派生」'],
        ['补上两阶段指引', 'docs/TROUBLESHOOTING-zh.md',
          (text) => text + '\n## 缺段报错（两阶段）\n\n首次只给模板路径与类别计数，再犯才列段名。\n', '缺「两阶段」', false],
        ['补上增量段口径', 'docs/USAGE-zh.md',
          (text) => text + '\n工件保真 = 上游模板段 + 本仓增量段。\n', '缺「增量段」', false],
      ].filter(([, rel]) => docs.has(rel));
      assertProbesDiscriminate(problems, docs, activeRules, activeProbes);
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
