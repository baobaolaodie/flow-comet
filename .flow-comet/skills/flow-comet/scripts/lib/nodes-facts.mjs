// nodes-facts.mjs — 节点参考页的事实抽取与比较（单一实现）
//
// 定位：docs/NODES.md 与 docs/NODES-zh.md 用散文写明每个节点加载哪些技能、读哪些提示词与模板、
// 产出哪些工件、留哪些证据——这些事实一旦与引擎漂移，页面会安静地写错。本模块只做两件事：把
// 「页面写了什么」按固定栏位抽出来，把「引擎应当是什么」从 explain 派生视图读出来，再比较。
// 抽取规则与比较口径都只在这里维护：调用方（公开面场景）不另写解析、不另定判据。
//
// 应有值（expected）的来源：
//   · 技能 / 模板 / 工件 / 证据：来自 `workflow-state.mjs explain <node>` 的输出（与门禁同源）。
//   · 实现技能：explain 不打这个字段；内置八节点的实现技能按既有命名约定 `flow-comet-<node>`
//     派生（协议 JSON 的 implementation.skill 逐节点如此）。约定被打破时比较会红，比静默漏掉
//     一项更接近事实。
//   · 提示词：explain 只打模板指针，不打提示词；清单取引擎同一张「节点 → 协议文件」映射
//     （protocol-utils 的 nodePromptFiles / NODE_CONDITIONAL_PROMPTS），不在这里另立一份表。
//
// 比较口径：
//   · 技能集合：只看「加载技能 / Skills loaded」栏里的 flow-comet-*，与该节点的技能集合全量比对，
//     多/少都报。只查「在不在」抓不到「换成另一个技能」，所以用集合；限定在同一栏，避免正文
//     别处提到非本节点技能时误报。
//   · 提示词 / 模板 / 证据 / 工件：只查在场（presence）。这些名字在其他栏也可能被合理提及，
//     集合相等会误伤；多写的无关模板由审查兜底。
//   · 零模板节点：该栏必须声明「零模板」或 no template——没有模板不等于没有判据。
//   · 工件文件名只对具体路径断言：去掉 `<change-id>` 占位后仍含 `*` / `<...>` 的产物，
//     页面上是按语义描述的（「每个任务一份摘要」「遗留清单」），字面名不是该栏的承诺；它们的
//     模板名与证据 id 仍被断言。
//   · 缺节点小节、缺栏、空栏都逐条报出来，不当作「没有可比较的东西」（缺席不等于通过）。
//   · 每条问题点名页 / 节点 / 字段 / 期望 / 实际；message 可直接打印，toString 让调用方也能
//     直接 join。
//
// 公共 API：
//   NODE_IDS
//   normalizeNewlines(text)
//   extractNodeSections(text, nodeIds = NODE_IDS) -> Map<nodeId, sectionBody>
//   extractColumn(sectionBody, 'skills' | 'prompts' | 'artifacts') -> string | null
//   extractFlowCometSkills(sectionBody) -> string[] | null
//   parseExplain(explainOutput) -> facts
//   comparePage({ page, text, factsByNode, nodeIds }) -> problems[]
//
// facts 形状（parseExplain 的返回值）：{ node, implementationSkill, skills, prompts, templates,
// artifacts, evidence }。
import {
  NODE_CONDITIONAL_PROMPTS,
  nodePromptFiles,
} from '../protocol-utils.mjs';
import { sectionBody } from './section-body.mjs';

// 页面覆盖的八个内置节点（顺序即页面主链顺序）。
export const NODE_IDS = [
  'open',
  'design',
  'plan',
  'execute',
  'subagent-execute',
  'review',
  'verify',
  'archive',
];

// 栏位标题：两页各用一套写法，比较前统一按小写比对（中文不受影响）。
const COLUMN_LABELS = {
  skills: ['Skills loaded', '加载技能'],
  prompts: ['Prompts and templates', '提示词与模板'],
  artifacts: ['Artifacts and evidence', '产出与证据'],
};

// 问题里的栏名字段（与上面的键一一对应）。
const COLUMN_FIELDS = {
  skills: '加载技能栏',
  prompts: '提示词与模板栏',
  artifacts: '产出与证据栏',
};

// ------------------------------ 文本归一与抽取 ------------------------------

// 行尾归一：CRLF / 孤立 CR → LF，并去掉文件头 BOM（与 lib/section-body.mjs 的取行口径一致）。
export function normalizeNewlines(text) {
  return String(text ?? '').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
}

// 栏位标题谓词：级别 + 标题文本（大小写不敏感）。
function headingMatches(level, titles) {
  const wanted = new Set(titles.map((title) => title.toLowerCase()));
  return (heading) => heading.level === level && wanted.has(heading.text.toLowerCase());
}

// 按 `### <node>` 切出节点小节：小节正文到下一个同级或更高级标题为止。围栏内的标题不结束
// 小节（段界逻辑取 lib/section-body.mjs 的唯一实现）。缺席的节点不出现在 Map 里——「缺席」与
// 「空小节」由调用方分别处置。
export function extractNodeSections(text, nodeIds = NODE_IDS) {
  const normalized = normalizeNewlines(text);
  const sections = new Map();
  for (const nodeId of nodeIds) {
    const body = sectionBody(
      normalized,
      (heading) => heading.level === 3 && heading.text === nodeId,
      { level: 3, endOnSeparator: false },
    );
    if (body !== null) sections.set(nodeId, body);
  }
  return sections;
}

// 从节点小节里取某一栏的正文（H4 标题到下一个同级或更高级标题）。栏目名两页不同，用
// COLUMN_LABELS 里的任一写法命中；返回 null 表示「栏缺席」，空串表示「栏在场但正文为空」。
export function extractColumn(sectionText, column) {
  const labels = COLUMN_LABELS[column];
  if (labels === undefined) {
    throw new Error('extractColumn 未知栏位: ' + column + '（可用: ' + Object.keys(COLUMN_LABELS).join('/') + '）');
  }
  if (typeof sectionText !== 'string') return null;
  return sectionBody(sectionText, headingMatches(4, labels), { level: 4, endOnSeparator: false });
}

// 「加载技能」栏里的 flow-comet-* 集合（去重、排序）。栏缺席 → null；栏在场但一个都没有 → []。
// 只认完整技能名，`flow-comet` 这个前缀本身不会被当成技能。
export function extractFlowCometSkills(sectionText) {
  const body = extractColumn(sectionText, 'skills');
  return body === null ? null : flowCometSkillsIn(body);
}

function flowCometSkillsIn(body) {
  const matches = String(body ?? '').match(/flow-comet-[a-z0-9]+(?:-[a-z0-9]+)*/gu) ?? [];
  return [...new Set(matches)].sort();
}

// ------------------------------ explain 输出解析 ------------------------------

// 模板指针行：`TEMPLATE: flow-kit/templates/CHANGE.md` /
// `TEMPLATE（条件模板）: flow-kit/templates/UI-DESIGN.md（仅前端 change）`。
const TEMPLATE_LINE_RE = /^TEMPLATE(（条件模板）)?:\s*(.+?)\s*$/u;

function parseTemplateLine(line) {
  const matched = line.match(TEMPLATE_LINE_RE);
  if (matched === null) return null;
  const pointer = matched[2].replace(/（[^）]*）\s*$/u, '').trim();
  const name = pointer.split('/').pop().replace(/\.md$/iu, '');
  return name === '' ? null : { name, conditional: matched[1] !== undefined };
}

// 产物行：`  ARTIFACT: design-doc [file] required → .specs/<change-id>/DESIGN.md | ...`。
// 同一 artifact 的 paths 是互斥备选；悬空 schema 的 `(none)——…` 行不是产物。
function parseArtifactLine(line) {
  const matched = line.match(/^\s+ARTIFACT:\s+(.+?)\s*$/u);
  if (matched === null || matched[1].startsWith('(none)')) return null;
  const [left, right = ''] = matched[1].split('→');
  const kind = left.match(/\[([^\]]+)\]/u);
  const paths = right.split('|')
    .map((pointer) => pointer.trim())
    .filter((pointer) => pointer !== '' && !pointer.startsWith('('));
  return {
    id: left.trim().split(/\s+/u)[0] ?? '(unnamed)',
    kind: kind === null ? null : kind[1],
    required: !/(?:^|\s)optional(?:\s|$)/u.test(left),
    paths,
  };
}

// 证据行：`  EVIDENCE: intake-summary (required)` 或
// `  EVIDENCE: handoff-request (required) | handoff-result (required)`。
function parseEvidenceLine(line) {
  const matched = line.match(/^\s+EVIDENCE:\s+(.+?)\s*$/u);
  if (matched === null || matched[1].startsWith('(none)')) return [];
  return matched[1].split('|')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => ({
      id: part.replace(/\s*\((?:required|optional)\)\s*$/u, '').trim(),
      optional: /\(optional\)/u.test(part),
    }))
    .filter((item) => item.id !== '');
}

// 该节点应读的提示词清单（基名，不带 .md）：引擎映射是唯一一份，条件提示词一并纳入——页面把
// 条件件也写在「提示词与模板」栏里。
function promptBasenames(nodeId) {
  const files = [...nodePromptFiles({ id: nodeId }), ...(NODE_CONDITIONAL_PROMPTS[nodeId] ?? [])];
  return [...new Set(files.map((file) => file.replace(/\.md$/iu, '')))];
}

// 解析 `workflow-state.mjs explain <node>` 的输出。缺 NODE 行直接抛错——没有节点身份的
// 输出无法对账，不能当成「空事实」继续比较。
export function parseExplain(output) {
  const lines = normalizeNewlines(output).split('\n');
  const facts = {
    node: null,
    implementationSkill: null,
    skills: [],
    prompts: [],
    templates: [],
    artifacts: [],
    evidence: [],
  };
  for (const line of lines) {
    if (line.startsWith('NODE: ')) {
      facts.node = line.slice('NODE: '.length).trim();
      continue;
    }
    if (line.startsWith('REQUIRED-SKILL: ')) {
      const skill = line.slice('REQUIRED-SKILL: '.length).split('|')[0].trim();
      if (skill !== '' && skill !== '(none)') facts.skills.push(skill);
      continue;
    }
    const template = parseTemplateLine(line);
    if (template !== null) {
      facts.templates.push(template);
      continue;
    }
    const artifact = parseArtifactLine(line);
    if (artifact !== null) {
      facts.artifacts.push(artifact);
      continue;
    }
    facts.evidence.push(...parseEvidenceLine(line));
  }
  if (facts.node === null || facts.node === '') {
    throw new Error('explain 输出缺 NODE 行，无法作为节点事实来源');
  }
  facts.implementationSkill = 'flow-comet-' + facts.node;
  facts.prompts = promptBasenames(facts.node);
  return facts;
}

// ------------------------------ 比较 ------------------------------

// 问题条目：结构化字段 + 可直接打印的 message（点名页 / 节点 / 字段 / 期望 / 实际）。
// toString 让 `problems.join('; ')` 也得到同一句报文。
function makeProblem(page, node, field, expected, actual) {
  const message = '页 ' + page + '｜节点 ' + node + '｜字段 ' + field
    + '｜期望 ' + expected + '｜实际 ' + actual;
  return {
    page,
    node,
    field,
    expected,
    actual,
    message,
    toString() {
      return message;
    },
  };
}

function toFactsLookup(factsByNode) {
  if (factsByNode instanceof Map) return factsByNode;
  if (factsByNode !== null && typeof factsByNode === 'object' && !Array.isArray(factsByNode)) {
    return new Map(Object.entries(factsByNode));
  }
  throw new Error('comparePage 需要 factsByNode：Map<nodeId, facts> 或同形普通对象');
}

// 名字在场判据：词界式匹配（前后不得紧邻字母 / 数字 / 下划线 / 连字符），避免 `DESIGN` 被
// `UI-DESIGN` 顶替掉、`2-design` 被更长的编号串命中。仍然只是 presence：正文多写一处不算错。
function mentionsName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp('(?<![A-Za-z0-9_-])' + escaped + '(?![A-Za-z0-9_-])', 'u').test(text);
}

function describeList(list) {
  return list.length > 0 ? list.join(', ') : '（空）';
}

function columnAbsent(body) {
  return body === null || body.trim() === '';
}

function columnProblem(page, node, column, body) {
  const label = COLUMN_LABELS[column].map((name) => '#### ' + name).join(' / ');
  return makeProblem(
    page,
    node,
    COLUMN_FIELDS[column],
    label + ' 小节在场且非空',
    body === null ? '小节缺席' : '小节正文为空',
  );
}

function skillProblems(page, node, body, facts) {
  const expected = new Set([facts.implementationSkill, ...facts.skills]);
  const actual = new Set(flowCometSkillsIn(body));
  const expectedList = [...expected].sort();
  const actualList = [...actual].sort();
  const problems = [];
  for (const skill of expectedList) {
    if (!actual.has(skill)) {
      problems.push(makeProblem(
        page,
        node,
        '技能集合',
        '包含 ' + skill,
        '未出现（页面集合: ' + describeList(actualList) + '）',
      ));
    }
  }
  for (const skill of actualList) {
    if (!expected.has(skill)) {
      problems.push(makeProblem(
        page,
        node,
        '技能集合',
        '不出现 ' + skill + '（explain 集合: ' + describeList(expectedList) + '）',
        '页面出现',
      ));
    }
  }
  return problems;
}

function promptAndTemplateProblems(page, node, body, facts) {
  const problems = [];
  for (const prompt of facts.prompts) {
    if (!mentionsName(body, prompt)) {
      problems.push(makeProblem(page, node, '提示词', '含 ' + prompt, '未出现'));
    }
  }
  const templates = facts.templates.map((template) => template.name);
  if (templates.length === 0) {
    // 零模板不是零判据：页面必须把「没有模板」说出来，不能靠留空让人猜。
    if (!/(?:零模板|no\s+templates?)/iu.test(body)) {
      problems.push(makeProblem(page, node, '零模板声明', '含「零模板」或 no template 声明', '未见声明'));
    }
    return problems;
  }
  for (const template of templates) {
    if (!mentionsName(body, template)) {
      problems.push(makeProblem(page, node, '模板', '含 ' + template, '未出现'));
    }
  }
  return problems;
}

// 工件字面名：只取具体路径（去掉 change-id 占位后没有通配与其他占位符）的 .md 文件名。
// 带通配的产物（`*-SUMMARY.md`、归档目录）在页面上按语义描述，不做字面断言；它们的模板名
// 与证据 id 仍在别处被断言。
function concreteArtifactNames(artifacts) {
  const names = new Set();
  for (const artifact of artifacts) {
    for (const pointer of artifact.paths) {
      const withoutPlaceholder = String(pointer).replaceAll('<change-id>', '');
      if (/[<>*]/u.test(withoutPlaceholder)) continue;
      const base = withoutPlaceholder.replaceAll('\\', '/').split('/').pop();
      if (!/\.md$/iu.test(base ?? '')) continue;
      names.add(base);
    }
  }
  return [...names];
}

function artifactKindProblems(page, node, body, facts) {
  const problems = [];
  for (const item of facts.evidence) {
    if (!mentionsName(body, item.id)) {
      problems.push(makeProblem(page, node, '证据 id', '含 ' + item.id, '未出现'));
    }
  }
  for (const name of concreteArtifactNames(facts.artifacts)) {
    if (!mentionsName(body, name)) {
      problems.push(makeProblem(page, node, '工件文件名', '含 ' + name, '未出现'));
    }
  }
  return problems;
}

function compareSection({ page, node, section, facts }) {
  const problems = [];

  const skillsBody = extractColumn(section, 'skills');
  if (columnAbsent(skillsBody)) {
    problems.push(columnProblem(page, node, 'skills', skillsBody));
  } else {
    problems.push(...skillProblems(page, node, skillsBody, facts));
  }

  const promptsBody = extractColumn(section, 'prompts');
  if (columnAbsent(promptsBody)) {
    problems.push(columnProblem(page, node, 'prompts', promptsBody));
  } else {
    problems.push(...promptAndTemplateProblems(page, node, promptsBody, facts));
  }

  const artifactsBody = extractColumn(section, 'artifacts');
  if (columnAbsent(artifactsBody)) {
    problems.push(columnProblem(page, node, 'artifacts', artifactsBody));
  } else {
    problems.push(...artifactKindProblems(page, node, artifactsBody, facts));
  }

  return problems;
}

// 比较一页与 explain 事实。factsByNode 缺任一节点的解析结果直接抛错：少读一个节点等于把判据面
// 悄悄缩小，不能算「通过」。返回问题数组（空数组 = 该页与派生视图一致）。
export function comparePage({ page, text, factsByNode, nodeIds = NODE_IDS } = {}) {
  if (typeof page !== 'string' || page.trim() === '') {
    throw new Error('comparePage 需要 page（页面路径，用于问题点名）');
  }
  const factsLookup = toFactsLookup(factsByNode);
  const sections = extractNodeSections(text, nodeIds);
  const problems = [];
  for (const nodeId of nodeIds) {
    const facts = factsLookup.get(nodeId);
    if (facts === undefined) {
      throw new Error('comparePage 缺 ' + nodeId + ' 的 explain 解析结果（未对账不等于通过）');
    }
    const section = sections.get(nodeId);
    if (section === undefined) {
      problems.push(makeProblem(page, nodeId, '节点小节', '### ' + nodeId + ' 小节在场', '小节缺席'));
      continue;
    }
    problems.push(...compareSection({ page, node: nodeId, section, facts }));
  }
  return problems;
}
