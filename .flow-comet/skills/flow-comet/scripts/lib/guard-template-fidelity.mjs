// 产出物模板结构门禁（守卫模块）：标题形态 / 首部字段（键 + 非空值）/ 全骨架（模板 H2 + 登记表
// 结构型 H3，模板外多余段不参与）/ 段序 / 空正文（六词白名单）/ 与模板该段逐字相同（判未填）/
// 条件段标题必须在场 / 增量段位置。段名与结构一律由 lib/guard-artifact-skeleton.mjs 的骨架派生
// （模板是内容权威，登记表只补条件段/结构子段/增量段/首部/标题形态）——本模块不自持段名清单，
// 段名归一复用 route-node 的 normalizeHeading。
//
// 模板整份缺失（derived=false，含登记表缺失 registry-missing，C13）→ 模板派生判据全部跳过并输出
// 「未校验（模板缺失）」；标题形态与首部字段来自登记表而非模板正文，照常校验（既有语义）。
// 分级沿用 isNewChange：新 change → BLOCKED，旧 change → WARN（C10 无例外）。
//
// 两阶段报错（D6/AC-15）：首次只给「模板路径 + 类别与数量」，不列「缺段」的段名；同一工件再次
// 失败时读 .specs/<change>/.template-hints.json 并列段名；该工件通过后清除其键（C5）。其它类别
// （标题/首部/条件段/段序/空正文/占位符/结构子段/增量段）本身即定位信息，首次就点到具体项——
// 只有「缺段」会成片出现，才需要先引导读模板。

import { promises as fs } from 'fs';
import path from 'path';
import { EXECUTE_FAMILY_NODE_IDS, normalizeHeading } from '../route-node.mjs';
import { taskOpeningAttrs, taskBlocks as extractTaskBlocks } from '../task-parsing.mjs';
import { nodeTemplateDeclaration, readProtocolFile, templateKeyOf } from '../protocol-utils.mjs';
import { runRoot, fileExists, protocolPath } from './guard-state-io.mjs';
import { isNewChange } from './guard-routing.mjs';
import { buildSkeleton } from './guard-artifact-skeleton.mjs';
import { TASK7_REQUIRED } from './task-graph.mjs';

const HINT_FILE_NAME = '.template-hints.json';
const H2_LINE = /^##\s+(.+?)\s*$/u;
const H3_LINE = /^###\s+(.+?)\s*$/u;
const FRONTMATTER_KEY_LINE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/u;

// 空正文白名单（D5/AC-5）：判据是**整段取值**而非子串——词后必须是行尾 / 空白 / 标点 / 括注，
// 「无变更风险；影响两份工件」这类真实句子仍是已填（判据不得退化为子串命中）。
const NOT_APPLICABLE_BODY =
  /^(?:无变更|不适用|未涉及|N\/A|无|—)(?=$|[\s，。；、,;.:：!！?？…—()（）【】「」『』“”"'])/iu;

function literalRegExp(text) {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

// 段名精确认键：归一（去编号 / 大小写 / 尾部括号）沿用 route-node 的单一实现，这里**只追加**尾部
// 括号内容作为区分位——归一口径会把 Button (Primary)/(Secondary) 合成同键（C2），unique=false 的
// 结构子段必须按精确名匹配，否则「只写了 Secondary」也算 Primary 在场。不复制一份编号/大小写规则。
function qualifiedHeading(raw) {
  const paren = String(raw ?? '').match(/[（(]([^）)\n]*)[）)]\s*$/u);
  return normalizeHeading(raw) + '\u0000' + (paren ? paren[1].trim().toLowerCase() : '');
}

// 工件文本 → 行锚定轮廓（L-128：只认行首标题，正文里引用段名不劫持）。frontmatter 仅做顶层键
// 行级解析（D10：不引入 YAML 库）：一个键的值区 = 行内余下文本 + 到下一个顶层键之前的非空行
// （嵌套映射是缩进行，而「值另起一行且不缩进」也同样是已填——两种书写形态都不判空）。
function parseOutline(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split('\n');
  const outline = { frontmatter: { present: false, keys: [] }, titleLine: '', headerLines: [], sections: [] };
  let cursor = 0;
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end > 0) {
      outline.frontmatter.present = true;
      const body = lines.slice(1, end);
      for (let index = 0; index < body.length; index += 1) {
        const matched = body[index].match(FRONTMATTER_KEY_LINE);
        if (!matched) continue;
        let value = matched[2].trim();
        if (value === '') {
          for (let next = index + 1; next < body.length && !FRONTMATTER_KEY_LINE.test(body[next]); next += 1) {
            if (body[next].trim() !== '') { value = 'filled'; break; }
          }
        }
        outline.frontmatter.keys.push({ key: matched[1].toLowerCase(), value });
      }
      cursor = end + 1;
    }
  }
  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;
  outline.titleLine = lines[cursor] ?? '';
  cursor += 1;
  while (cursor < lines.length && !H2_LINE.test(lines[cursor])) {
    outline.headerLines.push(lines[cursor]);
    cursor += 1;
  }
  let current = null;
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    const heading = line.match(H2_LINE);
    if (heading) {
      current = {
        raw: heading[1].trim(),
        norm: normalizeHeading(heading[1]),
        qualified: qualifiedHeading(heading[1]),
        bodyLines: [],
        subsections: [],
      };
      outline.sections.push(current);
      continue;
    }
    if (current === null) continue;
    const sub = line.match(H3_LINE);
    if (sub) {
      current.subsections.push({
        raw: sub[1].trim(),
        norm: normalizeHeading(sub[1]),
        qualified: qualifiedHeading(sub[1]),
      });
    }
    current.bodyLines.push(line);
  }
  return outline;
}

// 段正文归一（首尾空行剥离、行尾空白剥离）：逐字比对与空正文判定共用同一口径。
function bodyText(lines) {
  const trimmed = (lines ?? []).map((line) => String(line).replace(/\s+$/u, ''));
  let start = 0;
  let end = trimmed.length;
  while (start < end && trimmed[start].trim() === '') start += 1;
  while (end > start && trimmed[end - 1].trim() === '') end -= 1;
  return trimmed.slice(start, end).join('\n');
}

// 模板轮廓缓存（键 = 模板绝对路径）：逐字比对要模板该段正文，路径来自骨架（不在此推导模板位置）。
const templateOutlineCache = new Map();

async function templateOutlineFor(skeleton) {
  const file = path.resolve(runRoot, ...String(skeleton.file).split('/'));
  if (templateOutlineCache.has(file)) return templateOutlineCache.get(file);
  let outline = null;
  try {
    outline = parseOutline(await fs.readFile(file, 'utf8'));
  } catch {
    outline = null;
  }
  templateOutlineCache.set(file, outline);
  return outline;
}

function emptyIssues() {
  return {
    title: null,
    headerMissing: [],
    headerEmpty: [],
    frontmatter: [],
    missing: [],
    conditional: [],
    order: null,
    empty: [],
    verbatim: [],
    structure: [],
    increments: [],
  };
}

// 模板正文是否「留了待填位」：尖括号占位符（排除 HTML 注释）或复选框。表头 / 图例 / 空表格 /
// 占位注释这类正文本身就是成品的段（TASK 的状态字段说明、空阻塞日志、Fix 任务占位区）照抄不算
// 未填——对它们做逐字比对只会把合法工件判成空壳（自指试跑在真实 TASK.md 上实证）。
function templateBodyHasFillInSlot(body) {
  return /<(?!\/?!--)[^<>\n]+>/u.test(body) || /^\s*[-*]\s*\[\s*\]/mu.test(body);
}

function collectSectionIssues({ text, skeleton, template, issues }) {
  const outline = parseOutline(text);
  const indexByNorm = new Map();
  for (let index = 0; index < skeleton.sections.length; index += 1) {
    const section = skeleton.sections[index];
    if (!indexByNorm.has(section.norm)) indexByNorm.set(section.norm, index);
  }
  const matched = new Map();
  for (const section of outline.sections) {
    if (indexByNorm.has(section.norm) && !matched.has(section.norm)) matched.set(section.norm, section);
  }
  for (const section of skeleton.sections) {
    if (matched.has(section.norm)) continue;
    if (section.conditional === true || section.optional === true) issues.conditional.push(section.name);
    else issues.missing.push(section.name);
  }
  // 段序：只对模板骨架段排序，模板外多余段直接跳过（AC-10）
  let lastIndex = -1;
  for (const section of outline.sections) {
    const index = indexByNorm.get(section.norm);
    if (index === undefined) continue;
    if (index < lastIndex) {
      issues.order = { heading: section.raw };
      break;
    }
    lastIndex = index;
  }
  const parentNorms = new Set();
  for (const sub of skeleton.structureSubsections) {
    if (sub.parentNorm !== null) parentNorms.add(sub.parentNorm);
  }
  // 结构子段归属到「其上最近的骨架 H2」：模板外多余段（如工具输出贴入的 `## Findings`）夹在父段与
  // 子段之间时不切断归属（AC-10：多余段不参与骨架判定）。
  const subsectionsByParent = new Map();
  let enclosingNorm = null;
  for (const section of outline.sections) {
    if (indexByNorm.has(section.norm)) enclosingNorm = section.norm;
    if (enclosingNorm === null) continue;
    if (!subsectionsByParent.has(enclosingNorm)) subsectionsByParent.set(enclosingNorm, []);
    subsectionsByParent.get(enclosingNorm).push(...section.subsections);
  }
  for (const section of skeleton.sections) {
    const docSection = matched.get(section.norm);
    if (!docSection) continue;
    const body = bodyText(docSection.bodyLines);
    // 结构型父段的正文由子段承载，空正文只在叶子段判（父段只写子标题是合法形态）
    if (!parentNorms.has(section.norm) && body === '') issues.empty.push(section.name);
    if (template === null) continue;
    const templateSection = template.sections.find((item) => item.norm === section.norm);
    const templateBody = templateSection ? bodyText(templateSection.bodyLines) : '';
    if (templateBody !== '' && body === templateBody && templateBodyHasFillInSlot(templateBody)) {
      issues.verbatim.push(section.name);
    }
  }
  // 结构子段：父段在场才要求；父段整段 N/A → 子段不要求（AC-8 ②）
  for (const sub of skeleton.structureSubsections) {
    const parent = sub.parentNorm === null ? null : matched.get(sub.parentNorm);
    if (!parent) continue;
    if (NOT_APPLICABLE_BODY.test(bodyText(parent.bodyLines))) continue;
    const candidates = subsectionsByParent.get(sub.parentNorm) ?? parent.subsections;
    const found = candidates.some((docSub) => (sub.unique === false
      ? docSub.qualified === qualifiedHeading(sub.name)
      : docSub.norm === sub.norm));
    if (!found) issues.structure.push(sub.name);
  }
  // 增量段：只校验在场者的位置（必填与否由登记表 required + 各自门禁决定，本模块不做存在性兜底）
  for (const increment of skeleton.increments) {
    if (increment.kind !== 'section') continue;
    const docIndex = outline.sections.findIndex((section) => section.norm === increment.norm);
    if (docIndex === -1) continue;
    const laterSkeletonSection = outline.sections
      .slice(docIndex + 1)
      .some((section) => indexByNorm.has(section.norm));
    const position = increment.position ?? {};
    if (position.mode === 'after-or-end') {
      const previous = outline.sections[docIndex - 1];
      const followsAnchor = previous !== undefined
        && position.afterNorm !== null && position.afterNorm !== undefined
        && previous.norm === position.afterNorm;
      // 「文末」分支允许其后再有其它登记的增量段（如 LESSONS 扫描 紧随自检方法，AC-12 ②⑤）
      if (!followsAnchor && laterSkeletonSection) issues.increments.push(increment.section);
    } else if (position.mode === 'end') {
      if (laterSkeletonSection) issues.increments.push(increment.section);
    } else if (position.mode === 'anywhere' && position.constraint === 'code-block-follows') {
      const firstContentLine = outline.sections[docIndex].bodyLines.find((line) => line.trim() !== '');
      if (firstContentLine === undefined || !/^\s*(?:```|~~~)/u.test(firstContentLine)) {
        issues.increments.push(increment.section);
      }
    }
  }
}

// underivedPolicy：模板缺席时保留哪些检查。'registry'（缺省）= 保留登记表级的标题/首部检查（入口文档
// 的既有语义）；'skip' = 整体判「未校验（模板缺失）」（UI-DESIGN 等完全由模板形态定义的工件）。
function collectArtifactIssues({ text, skeleton, derived, template, requiredHeaderFields = [], underivedPolicy = 'registry' }) {
  const issues = emptyIssues();
  if (!derived && underivedPolicy === 'skip') return issues;
  const outline = parseOutline(text);
  if (skeleton.titleRegExp !== null) {
    const title = outline.titleLine.trim();
    if (title === '' || !skeleton.titleRegExp.test(title)) {
      issues.title = { expected: skeleton.titleForm ?? '' };
    }
  }
  const headerText = outline.headerLines.join('\n');
  // 首部行的正则只用行内空白（[ \t]）：`\s*` 会吃掉换行并把下一行当成字段值，空值判断随即失效。
  for (const field of requiredHeaderFields) {
    const pattern = new RegExp('^[ \\t]*[-*][ \\t]+\\*\\*[ \\t]*' + literalRegExp(field) + '[ \\t]*\\*\\*[ \\t]*[:：]', 'mu');
    if (!pattern.test(headerText)) issues.headerMissing.push(field);
  }
  for (const field of skeleton.headerFields ?? []) {
    // 只校验「已在场的键」的值非空（「有键无值」视为未填，AC-4）；键集本身不新增硬性要求
    const pattern = new RegExp('^[ \\t]*[-*][ \\t]+\\*\\*[ \\t]*' + literalRegExp(field) + '[ \\t]*\\*\\*[ \\t]*[:：][ \\t]*(.*)$', 'mu');
    const matched = headerText.match(pattern);
    if (matched && matched[1].trim() === '') issues.headerEmpty.push(field);
  }
  if (!derived) return issues;
  for (const key of skeleton.frontmatterKeys ?? []) {
    const entry = outline.frontmatter.keys.find((item) => item.key === String(key).toLowerCase());
    if (!entry || entry.value === '') issues.frontmatter.push(key);
  }
  collectSectionIssues({ text, skeleton, template, issues });
  return issues;
}

function hasAnyIssue(issues) {
  return issues.title !== null
    || issues.order !== null
    || issues.headerMissing.length > 0
    || issues.headerEmpty.length > 0
    || issues.frontmatter.length > 0
    || issues.missing.length > 0
    || issues.conditional.length > 0
    || issues.empty.length > 0
    || issues.verbatim.length > 0
    || issues.structure.length > 0
    || issues.increments.length > 0;
}

// 两阶段记忆的类别集合沿用 C5 的七类词表：结构子段归 missing（缺的是骨架的一部分），
// 增量段位置归 order（位置偏离）。
function hintCategories(issues) {
  const categories = new Set();
  if (issues.title !== null) categories.add('title');
  if (issues.headerMissing.length > 0 || issues.headerEmpty.length > 0 || issues.frontmatter.length > 0) {
    categories.add('header');
  }
  if (issues.missing.length > 0 || issues.structure.length > 0) categories.add('missing');
  if (issues.conditional.length > 0) categories.add('conditional');
  if (issues.order !== null || issues.increments.length > 0) categories.add('order');
  if (issues.empty.length > 0) categories.add('empty');
  if (issues.verbatim.length > 0) categories.add('placeholder');
  return [...categories];
}

function formatIssueParts(issues, { escalate }) {
  const parts = [];
  if (issues.title !== null) parts.push('标题形态不符（模板首行: `' + issues.title.expected + '`）');
  if (issues.headerMissing.length > 0) parts.push('首部缺字段: ' + issues.headerMissing.join('、'));
  if (issues.headerEmpty.length > 0) parts.push('首部字段有键无值: ' + issues.headerEmpty.join('、'));
  if (issues.frontmatter.length > 0) parts.push('frontmatter 缺键或值为空: ' + issues.frontmatter.join('、'));
  if (issues.missing.length > 0) {
    parts.push('缺段 ' + issues.missing.length + ' 项' + (escalate ? ': ' + issues.missing.join('、') : ''));
  }
  if (issues.conditional.length > 0) {
    parts.push('条件段标题缺席 ' + issues.conditional.length + ' 项: ' + issues.conditional.join('、'));
  }
  if (issues.order !== null) {
    parts.push('段序偏离模板（「' + issues.order.heading + '」排在模板中更早的段之后）');
  }
  if (issues.empty.length > 0) parts.push('正文为空 ' + issues.empty.length + ' 项: ' + issues.empty.join('、'));
  if (issues.verbatim.length > 0) {
    parts.push('与模板该段正文逐字相同（判未填）' + issues.verbatim.length + ' 项: ' + issues.verbatim.join('、'));
  }
  if (issues.structure.length > 0) {
    parts.push('缺结构子段 ' + issues.structure.length + ' 项: ' + issues.structure.join('、'));
  }
  if (issues.increments.length > 0) parts.push('增量段位置非法: ' + issues.increments.join('、'));
  return parts;
}

async function readHints(hintsFile) {
  try {
    const data = JSON.parse(await fs.readFile(hintsFile, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

async function writeHints(hintsFile, hints) {
  if (Object.keys(hints).length === 0) {
    await fs.rm(hintsFile, { force: true }).catch(() => {});
    return;
  }
  await fs.mkdir(path.dirname(hintsFile), { recursive: true }).catch(() => {});
  await fs.writeFile(hintsFile, JSON.stringify(hints, null, 2) + '\n', 'utf8').catch(() => {});
}

function notCheckedReason(skeleton) {
  const file = skeleton.file ?? '（登记表未登记该工件）';
  if (skeleton.reason === 'registry-missing' || skeleton.reason === 'registry-unreadable') {
    return '结构登记表缺失（' + skeleton.reason + '），骨架无从派生——模板在场也不静默判通过';
  }
  if (skeleton.reason === 'unknown-key') return '登记表未登记该工件键，结构无从派生';
  if (skeleton.reason === 'template-undeclared') return '登记表未声明该工件的模板路径';
  return file + ' 不存在或不可读（模板缺失）——安装 flow-kit 模板后本工件才会做结构校验';
}

// 骨架评估入口（供产出物门禁与 ui-design 门共用）：返回骨架、派生状态与问题清单。
export async function evaluateArtifact(key, text, options = {}) {
  const skeleton = await buildSkeleton(key);
  const derived = skeleton.derived === true;
  const template = derived ? await templateOutlineFor(skeleton) : null;
  const issues = collectArtifactIssues({
    text,
    skeleton,
    derived,
    template,
    requiredHeaderFields: options.requiredHeaderFields ?? [],
    underivedPolicy: options.underivedPolicy ?? 'registry',
  });
  return { skeleton, derived, issues };
}

// 单工件判定（纯函数，不输出）：硬问题（阻断级）与软问题（只告警的结构子段）分开，供报错编排合并。
export function assessArtifact({ fileLabel, skeleton, derived, issues, structureSeverity = 'block' }) {
  const hardIssues = structureSeverity === 'block' ? issues : { ...issues, structure: [] };
  return {
    fileLabel,
    key: skeleton.key,
    skeleton,
    derived,
    hardIssues,
    hard: hasAnyIssue(hardIssues),
    categories: hintCategories(hardIssues),
    softStructure: structureSeverity === 'block' ? [] : issues.structure,
  };
}

// 提示账本（两阶段记忆的纯逻辑，不写盘）：把失败记进 hints 并给出各工件的报告行；escalate = 该工件
// 上一次也失败过（此时列出段名）。
function planFailureLines(hints, failing) {
  const lines = [];
  for (const item of failing) {
    const escalate = Object.prototype.hasOwnProperty.call(hints, item.key);
    hints[item.key] = { failedAt: new Date().toISOString(), categories: item.categories };
    lines.push(item.fileLabel + ' 模板结构校验失败: '
      + formatIssueParts(item.hardIssues, { escalate }).join('; ')
      + '（模板: ' + (item.skeleton.file ?? '（登记表未登记模板路径）') + '）');
  }
  return lines;
}

// 通过的工件释放其记忆键（返回是否有改动，避免无谓写盘）。
function releasePassedHints(hints, assessments) {
  let changed = false;
  for (const item of assessments) {
    if (!Object.prototype.hasOwnProperty.call(hints, item.key)) continue;
    delete hints[item.key];
    changed = true;
  }
  return changed;
}

// 报错编排（单一实现）：模板缺席 → 未校验行；有硬问题 → 两阶段 BLOCKED/WARN；全过 → 清记忆键。
// 同一出口的全部工件合并成一次报告——逐件 exit 会让执行者修一个再撞下一个，而这次出口的所有
// 结构问题一次就能看全。structureSeverity='warn' 的工件（DESIGN）其结构子段缺席只发可见告警。
export async function reportArtifactStructure({ changeDir, state, assessments }) {
  for (const item of assessments) {
    if (!item.derived) {
      console.error('未校验（模板缺失）: ' + item.fileLabel + ' —— ' + notCheckedReason(item.skeleton));
    }
  }
  const failing = assessments.filter((item) => item.hard);
  const hintsFile = path.join(changeDir, HINT_FILE_NAME);
  const hints = await readHints(hintsFile);
  if (failing.length > 0) {
    const lines = planFailureLines(hints, failing);
    await writeHints(hintsFile, hints);
    if (isNewChange(state)) {
      for (const line of lines) console.error('BLOCKED: ' + line);
      const templatePaths = [...new Set(failing.map((item) => item.skeleton.file ?? '（未登记模板路径）'))];
      console.error('恢复: 对照 ' + templatePaths.join(' / ') + ' 修正标题 / 首部字段 / 段序，并按模板补齐缺失的 H2 与结构型 H3 标题'
        + '（条件段与无内容段正文可写 N/A）后重试 exit；同一工件再次失败时会列出具体段名'
        + '（已记录在 .specs/' + (state.activeChange ?? '<change>') + '/' + HINT_FILE_NAME + '）');
      process.exit(1);
    }
    for (const line of lines) {
      console.error('TEMPLATE-STRUCTURE WARN: ' + line + '（旧 change 渐进，不阻断；新 change 将强制）');
    }
  } else if (releasePassedHints(hints, assessments)) {
    await writeHints(hintsFile, hints);
  }
  for (const item of assessments) {
    if (item.softStructure.length === 0) continue;
    console.error('TEMPLATE-STRUCTURE WARN: ' + item.fileLabel + ' 缺结构子段 '
      + item.softStructure.length + ' 项: ' + item.softStructure.join('、')
      + '（' + item.key + ' 的结构子段挂在条件段之下，详略由项目实际决定；只告警不阻断）');
  }
}

// SUMMARY 模板缺席时的既有段序兜底（无模板可派生骨架时仍拦乱序/缺段——这是模板权威门禁落地前
// 就有的判据，保留它避免「模板缺席 = 连乱序也不看」的倒退）。
const LEGACY_SUMMARY_ORDER = ['做了什么', '改动文件', 'verify 输出', '6 维自查', '越界检查', '自检方法']
  .map((name) => normalizeHeading(name));

function addLegacySummaryIssues(text, issues) {
  const outline = parseOutline(text);
  const seen = new Set();
  let lastIndex = -1;
  for (const section of outline.sections) {
    const index = LEGACY_SUMMARY_ORDER.indexOf(section.norm);
    if (index === -1) continue;
    if (index < lastIndex && issues.order === null) issues.order = { heading: section.raw };
    lastIndex = Math.max(lastIndex, index);
    seen.add(index);
  }
  for (let index = 0; index < LEGACY_SUMMARY_ORDER.length; index += 1) {
    if (!seen.has(index)) issues.missing.push(LEGACY_SUMMARY_ORDER[index]);
  }
}

// SUMMARY 结构门禁（execute / subagent-execute）：标题形态 / 首部四字段 / 全骨架（H2 + 结构型 H3，
// 条件段允许正文 N/A）/ 段序 / 空正文 / 逐字占位 / 增量段位置（自检方法 紧随越界检查或文末；
// LESSONS 扫描 紧随自检方法或在自检方法之后），新 change BLOCKED、旧 change WARN；模板缺席时
// 只保留既有兜底段序判据并显式输出「未校验（模板缺失）」。
export async function runSummaryTemplateFidelityGate({ node, state }) {
  if (!EXECUTE_FAMILY_NODE_IDS.has(node.id)) return;
  const changeDir = path.join(runRoot, '.specs', state.activeChange ?? '');
  const files = (await fs.readdir(changeDir).catch(() => [])).filter((file) => file.endsWith('-SUMMARY.md'));
  if (files.length === 0) return;
  const skeleton = await buildSkeleton('SUMMARY');
  const derived = skeleton.derived === true;
  const template = derived ? await templateOutlineFor(skeleton) : null;
  const entries = [];
  for (const file of files) {
    let text;
    try {
      text = await fs.readFile(path.join(changeDir, file), 'utf8');
    } catch {
      continue;
    }
    // 首部字段键集来自登记表（模板缺席时同样可得）——SUMMARY 首部四字段是既有硬要求，不退化为软提醒
    const issues = collectArtifactIssues({
      text,
      skeleton,
      derived,
      template,
      requiredHeaderFields: skeleton.headerFields,
    });
    if (!derived) addLegacySummaryIssues(text, issues);
    entries.push({ fileLabel: file, issues });
  }
  if (entries.length === 0) return;
  await reportArtifactStructure({
    changeDir,
    state,
    assessments: entries.map((entry) => assessArtifact({ ...entry, skeleton, derived })),
  });
}

// 节点 → 待校验工件：单一来源 = 协议。**该节点是否受模板门禁**由 protocol-utils 的
// nodeTemplateDeclaration 决定（内置节点取引擎映射、自定义节点取协议 node.templates，未声明 =
// 零模板 ⇒ 不校验，ADR-002 特化层）；**产出哪份工件**取该节点 outputSchemas 的 artifacts[].paths
// （`<change-id>/…` 基），模板基名从工件名派生（`TASK.md` → TASK、`*-SUMMARY.md` → SUMMARY；`.md`
// 的剥离沿用 protocol-utils 的 templateKeyOf 单一实现）——本模块不另写节点→工件映射。
// SUMMARY 由 execute 家族的专用门负责（它还要消费无模板时的兜底段序），此处跳过以免同一工件被
// 两条门重复判定。
function templateKeyFromArtifactName(namePattern) {
  const base = String(namePattern ?? '').split('*').pop().replace(/^[^A-Za-z0-9]+/u, '');
  return base === '' ? null : templateKeyOf(base);
}

async function nodeArtifactTargets(node) {
  let protocol = null;
  try {
    protocol = await readProtocolFile(runRoot, protocolPath);
  } catch {
    return [];
  }
  const schemas = new Map((protocol.outputSchemas ?? []).map((schema) => [schema.id, schema]));
  const targets = [];
  for (const schemaId of node.outputSchemas ?? []) {
    const schema = schemas.get(schemaId);
    for (const artifact of schema?.artifacts ?? []) {
      for (const pattern of artifact.paths ?? []) {
        const segments = String(pattern ?? '').replaceAll('\\', '/').split('/');
        if (segments.length !== 2 || segments[0] !== '<change-id>') continue;
        const key = templateKeyFromArtifactName(segments[1]);
        if (key === null) continue;
        targets.push({ key, namePattern: segments[1] });
      }
    }
  }
  return targets;
}

async function expandArtifactTargets(changeDir, targets) {
  const expanded = [];
  for (const target of targets) {
    if (!target.namePattern.includes('*')) {
      expanded.push({ key: target.key, file: target.namePattern });
      continue;
    }
    const matcher = new RegExp('^' + target.namePattern.split('*').map(literalRegExp).join('.*') + '$', 'u');
    for (const entry of await fs.readdir(changeDir).catch(() => [])) {
      if (matcher.test(entry)) expanded.push({ key: target.key, file: entry });
    }
  }
  return expanded;
}

// 工件 → 首部硬要求：入口文档（CHANGE/REQUIREMENT/DESIGN）沿用既有「Change ID 必在场」检查，
// SUMMARY 的四字段由专用门要求；其余工件的键集不新增硬性要求（只校验已在场键的值非空）。
const INTAKE_HEADER_KEYS = new Set(['CHANGE', 'REQUIREMENT', 'DESIGN']);

// 产出物的结构门（各节点出口）：受门禁的节点逐个校验本节点产出的登记工件（模板权威）。导出名沿用
// 既有调用面（workflow-guard 的固定出口链）。DESIGN 的结构子段全部挂在条件段（0.5 brownfield /
// 9 软约束）之下，详略由项目实际决定 → 缺席只发可见告警（structureSeverity='warn'）。
export async function runIntakeDocFidelityGate({ node, state }) {
  if (!state.activeChange) return;
  const declaration = nodeTemplateDeclaration(node);
  if (declaration.source === 'none') return;
  const changeDir = path.join(runRoot, '.specs', state.activeChange);
  const declaredKeys = new Set([...declaration.required, ...declaration.optional].map((name) => templateKeyOf(name)));
  const targets = await nodeArtifactTargets(node);
  const assessments = [];
  for (const target of await expandArtifactTargets(changeDir, targets)) {
    const key = target.key;
    if (templateKeyOf(key) === 'summary') continue;
    if (declaration.source === 'protocol' && !declaredKeys.has(templateKeyOf(key))) continue;
    const skeleton = await buildSkeleton(key);
    if (skeleton.reason === 'unknown-key') continue; // 未登记的工件（UAT / DESIGN-lite 等）不做结构校验
    const filePath = path.join(changeDir, target.file);
    if (!(await fileExists(filePath))) continue;
    let text;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const evaluated = await evaluateArtifact(key, text, {
      requiredHeaderFields: INTAKE_HEADER_KEYS.has(String(key).toUpperCase()) ? ['Change ID'] : [],
    });
    assessments.push(assessArtifact({
      fileLabel: target.file,
      skeleton: evaluated.skeleton,
      derived: evaluated.derived,
      issues: evaluated.issues,
      structureSeverity: String(key).toUpperCase() === 'DESIGN' ? 'warn' : 'block',
    }));
  }
  if (assessments.length > 0) await reportArtifactStructure({ changeDir, state, assessments });
  if (node.id === 'design' && assessments.length === 0) await legacyDesignLiteTitle(changeDir, state);
}

// DESIGN-lite 不是登记工件（模板权威不收它的段形）→ 只保留既有标题形态校验。
async function legacyDesignLiteTitle(changeDir, state) {
  const file = path.join(changeDir, 'DESIGN-lite.md');
  if (!(await fileExists(file))) return;
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return;
  }
  const firstLine = (text.replace(/^\uFEFF/u, '').split('\n').find((line) => line.trim() !== '') ?? '').trim();
  if (/^#\s*design\b/iu.test(firstLine)) return;
  const message = 'DESIGN-lite.md 标题应以 # DESIGN 开头（如 `# DESIGN: <标题>`，大小写不敏感、冒号可省）';
  if (isNewChange(state)) {
    console.error('BLOCKED: ' + message);
    console.error('恢复: 修正 DESIGN-lite.md 首行标题后重试 exit design');
    process.exit(1);
  }
  console.error('INTAKE-DOC WARN: ' + message + '（旧 change 渐进，不阻断；新 change 将强制）');
}

// TASK 7 字段完整性门禁（plan 出口）：每个 <task> 块须含
// name/read_files/write_files/action/verify/done/depends_on；缺任一 → 新 BLOCK / 旧 WARN。
// 开标签解析/整块提取沿用 task-parsing.mjs（属性序无关）。宽容：任务块采用旧式一字段形态
// （无 <name> 标记）的 TASK 视为旧格式 → 仅渐进 WARN（不误拦既有波次/路由回归载体）；采用新
// 模板形态（含 <name>）则按 7 字段强校验。字段集从 `task-graph.mjs` 的单一权威常量取用（执行期
// `replan` 判据同源）——本模块不得再写一份字面集合，否则两侧会在规则演进时分叉。
export async function runTaskSevenFieldGate({ node, state }) {
  if (node.id !== 'plan' || !state.activeChange) return;
  const task7File = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
  try {
    const task7Blocks = extractTaskBlocks(await fs.readFile(task7File, 'utf8'));
    const planNewFormat = task7Blocks.some((b) => /<name\b/i.test(b));
    const broken = [];
    for (const b of task7Blocks) {
      const missing = TASK7_REQUIRED.filter((field) => !new RegExp('</?' + field + '\\b', 'i').test(b));
      if (missing.length > 0) {
        const idAttr = (taskOpeningAttrs(b) || {})?.id || '?';
        broken.push((idAttr && idAttr !== '?' ? idAttr + ' ' : '') + '缺 ' + missing.join('/'));
      }
    }
    if (broken.length > 0) {
      if (planNewFormat) {
        if (isNewChange(state)) {
          // 文案的集合字符串**从判据常量派生**（不得在此再写一遍字面集合——第二处同口径表达会在
          // 判据演进时静默落后于实现；构造方式不改变渲染结果）。
          console.error('BLOCKED: TASK.md 任务缺 7 字段（' + TASK7_REQUIRED.join('/') + '）: ' + broken.join('; '));
          console.error('恢复: 对照 flow-kit/templates/TASK.md 补齐每个 <task> 的缺字段后重试 exit；新 change 强制任务块结构完整');
          process.exit(1);
        }
        console.error('TASK-7FIELD WARN: TASK.md ' + broken.join('; ') + '（旧 change 渐进，不阻断；新 change 将强制补齐 7 字段）');
      } else {
        console.error('TASK-7FIELD WARN: TASK.md 任务为旧式一字段模板形态（' + broken.join('; ') +
          '）——建议按 flow-kit/templates/TASK.md 补全 7 字段（渐进不阻断）');
      }
    }
  } catch {}
}
