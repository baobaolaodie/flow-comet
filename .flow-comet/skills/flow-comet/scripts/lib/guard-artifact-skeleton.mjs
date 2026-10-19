// guard-artifact-skeleton.mjs — 工件骨架计算（单一实现）
//
// 输入：`<runRoot>/flow-kit/templates/<DOC>.md`（上游模板，内容权威）+ `<packageRoot>/reference/
// artifact-templates.json`（本仓登记表：条件段 / 可选段 / 结构子段 / 增量段 / 首部 / 标题形态 / 指纹）。
// 输出：规范化骨架（H2 序列 + 条件标记 + 结构型 H3 + 增量段位置 + 派生来源与指纹）。
//
// 单一实现纪律（L-067）：骨架只在本模块计算。任何门禁（guard-routing / guard-template-fidelity /
// evolve / health）一律调用本模块，不得自持「读模板 + 抽 H2」的派生副本。段名归一复用 route-node 的
// normalizeHeading（去编号 / 去尾部括号 / 大小写归一），本模块不另写第二份段名归一。
//
// 模板缺席：derived=false 且 sections 为空（取消内置骨架兜底，D7）——调用方据此跳过校验并显式声明
// 「未校验（模板缺失）」。本模块对「登记表缺失 / 模板缺失 / 键未知」一律不抛错。
//
// 缓存：按 runRoot 键控（同一进程内每个项目根只算一次）。返回的骨架对象是共享缓存值，消费方只读。

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { normalizeHeading } from '../route-node.mjs';
import { escapeRegExp } from './task-graph.mjs';
import { packageRoot, runRoot } from './guard-state-io.mjs';

const REGISTRY_PATH = path.join(packageRoot, 'reference', 'artifact-templates.json');
const HEADING_LINE = { 2: /^##\s+(.+?)\s*$/u, 3: /^###\s+(.+?)\s*$/u };

// 模板文本归一（BOM / 行尾）：指纹与标题解析共用同一口径——行尾差异是检出的噪音，不应改变指纹。
function normalizeTemplateText(text) {
  return String(text ?? '').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
}

// 标题行提取（行锚定）：只认行首 ATX 标题。非锚定子串命中会被正文里「引用段名」劫持（L-128）。
function headingLines(text, level) {
  const matcher = HEADING_LINE[level];
  const out = [];
  for (const line of normalizeTemplateText(text).split('\n')) {
    const matched = line.match(matcher);
    if (matched) out.push(matched[1].trim());
  }
  return out;
}

// 段名宽容匹配（单一实现）：主体取 normalizeHeading 的结果，译为行锚定正则。编号前缀与尾部括号在
// 正则里同样是可选的——「省编号 / 换括号措辞 / 大小写不同」命中同一段，核心词不同则不命中（AC-9）。
// escapeRegExp 的既有契约是 glob 片段（调用方先 split('*')），故不转义 `*`；段名是字面文本，缺口在
// 这一行显式闭合，而不是另写一份转义实现。
export function headingPattern(rawName, level = 2) {
  const normalized = normalizeHeading(rawName);
  const body = normalized === '' ? String(rawName ?? '').trim() : normalized;
  const literal = escapeRegExp(body).replace(/\*/gu, '\\*');
  const marker = level === 3 ? '###' : '##';
  return new RegExp(
    '^' + marker + '\\s*(?:\\d+(?:\\.\\d+)?\\.?\\s*)?' + literal + '\\s*(?:[（(][^\\n）)]*[）)])?\\s*$',
    'im',
  );
}

// 登记表读取（进程内一次）
let registryCache = null;

async function loadRegistry() {
  if (registryCache === null) {
    try {
      registryCache = {
        available: true,
        data: JSON.parse(normalizeTemplateText(await fs.readFile(REGISTRY_PATH, 'utf8'))),
      };
    } catch (error) {
      registryCache = {
        available: false,
        reason: error?.code === 'ENOENT' ? 'registry-missing' : 'registry-unreadable',
      };
    }
  }
  return registryCache;
}

function compileTitlePattern(source) {
  if (typeof source !== 'string' || source.trim() === '') return null;
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

// 骨架对象形态的唯一定义处：缺失 / 未派生路径直接返回它（derived=false + 空集合），正常路径在它上面
// 填充。单一形态定义让消费方只记一套字段——任何原因下键集合都相同，判「能不能校验」只看 derived。
function baseSkeleton(key, reason) {
  return {
    key,
    derived: false,
    reason,
    file: null,
    titleForm: null,
    titleRegExp: null,
    headerFields: [],
    frontmatterKeys: [],
    sections: [],
    structureSubsections: [],
    increments: [],
    templateCommit: null,
    templateSha256: null,
    actualSha256: null,
  };
}

// 归一后同名的段在宽容口径下不可区分（典型：Button (Primary) / Button (Secondary) 都归一成 button）
// ——标记 unique=false，消费方须改用精确名匹配，避免「只写了 Secondary 也算 Primary 在场」的静默放过。
function markUniqueness(entries, scopeOf) {
  const counts = new Map();
  for (const entry of entries) {
    const scope = scopeOf(entry) + '\u0000' + entry.norm;
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  for (const entry of entries) {
    const scope = scopeOf(entry) + '\u0000' + entry.norm;
    entry.unique = counts.get(scope) === 1;
  }
  return entries;
}

// H2 骨架 = 模板标题行（顺序即模板顺序）+ 登记表标记。模板有而登记表没有的段仍然在骨架内
// （模板是权威），只是没有条件/可选标记且 registered=false——这正是登记表滞后的可见信号。
function buildSections(templateHeadings, registeredSections) {
  const registered = new Map();
  for (const entry of Array.isArray(registeredSections) ? registeredSections : []) {
    if (typeof entry?.name !== 'string') continue;
    registered.set(normalizeHeading(entry.name), entry);
  }
  const sections = templateHeadings.map((name, index) => {
    const norm = normalizeHeading(name);
    const flags = registered.get(norm);
    return {
      name,
      norm,
      index,
      conditional: flags?.conditional === true,
      optional: flags?.optional === true,
      registered: flags !== undefined,
      pattern: headingPattern(name, 2),
    };
  });
  return markUniqueness(sections, () => '');
}

// 结构型 H3 由登记表显式列举（D3：不用正则识别示例条目——示例条目是书写样例，不是骨架）
function buildStructureSubsections(registeredSubsections) {
  const subsections = [];
  for (const entry of Array.isArray(registeredSubsections) ? registeredSubsections : []) {
    if (typeof entry?.name !== 'string') continue;
    const parent = typeof entry.parent === 'string' ? entry.parent : null;
    subsections.push({
      name: entry.name,
      norm: normalizeHeading(entry.name),
      parent,
      parentNorm: parent === null ? null : normalizeHeading(parent),
      pattern: headingPattern(entry.name, 3),
    });
  }
  return markUniqueness(subsections, (entry) => entry.parentNorm ?? '');
}

// 增量段（上游模板没有、本仓追加的段/标记）：位置由登记表表达，供消费方按位置校验（AC-12）
function buildIncrements(registeredIncrements) {
  const increments = [];
  for (const entry of Array.isArray(registeredIncrements) ? registeredIncrements : []) {
    if (typeof entry?.section !== 'string') continue;
    const position = entry.position && typeof entry.position === 'object' ? entry.position : {};
    const kind = entry.kind === 'marker' ? 'marker' : 'section';
    increments.push({
      section: entry.section,
      norm: normalizeHeading(entry.section),
      kind,
      required: entry.required === true,
      position: {
        mode: typeof position.mode === 'string' ? position.mode : 'anywhere',
        afterSection: position.afterSection ?? null,
        afterNorm: typeof position.afterSection === 'string' ? normalizeHeading(position.afterSection) : null,
        section: position.section ?? null,
        sectionNorm: typeof position.section === 'string' ? normalizeHeading(position.section) : null,
        constraint: position.constraint ?? null,
      },
      pattern: kind === 'marker' ? null : headingPattern(entry.section, 2),
    });
  }
  return increments;
}

async function computeSkeleton(requestedKey, root) {
  const registry = await loadRegistry();
  if (!registry.available) return baseSkeleton(requestedKey, registry.reason);

  const templates = registry.data?.templates ?? {};
  const registeredKey = Object.keys(templates)
    .find((key) => key.toLowerCase() === requestedKey.toLowerCase()) ?? null;
  if (registeredKey === null) {
    const skeleton = baseSkeleton(requestedKey, 'unknown-key');
    skeleton.availableKeys = Object.keys(templates);
    return skeleton;
  }

  const entry = templates[registeredKey];
  const skeleton = baseSkeleton(registeredKey, null);
  skeleton.file = typeof entry.file === 'string' ? entry.file : null;
  skeleton.titleForm = typeof entry.titleForm === 'string' ? entry.titleForm : null;
  skeleton.titleRegExp = compileTitlePattern(entry.titlePattern);
  skeleton.headerFields = Array.isArray(entry.headerFields) ? [...entry.headerFields] : [];
  skeleton.frontmatterKeys = Array.isArray(entry.frontmatterKeys) ? [...entry.frontmatterKeys] : [];
  skeleton.templateCommit = registry.data?.templateCommit ?? null;
  skeleton.templateSha256 = typeof entry.sha256 === 'string' ? entry.sha256 : null;

  if (skeleton.file === null) {
    skeleton.reason = 'template-undeclared';
    return skeleton;
  }
  let text = null;
  try {
    text = await fs.readFile(path.resolve(root, ...skeleton.file.split('/')), 'utf8');
  } catch {
    text = null;
  }
  if (text === null) {
    skeleton.reason = 'template-missing';
    return skeleton;
  }

  skeleton.sections = buildSections(headingLines(text, 2), entry.sections);
  skeleton.structureSubsections = buildStructureSubsections(entry.structureSubsections);
  skeleton.increments = buildIncrements(entry.increments);
  skeleton.actualSha256 = createHash('sha256')
    .update(Buffer.from(normalizeTemplateText(text), 'utf8'))
    .digest('hex');
  skeleton.derived = skeleton.sections.length > 0;
  if (!skeleton.derived) skeleton.reason = 'template-empty';
  return skeleton;
}

function resolveRoot(opts) {
  const explicit = opts?.runRoot;
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit);
  return path.resolve(runRoot);
}

const skeletonCache = new Map(); // 项目根 → (小写键 → 骨架)

// 规范化骨架。key 大小写不敏感（既有消费方用 'change'/'summary' 等小写键，登记表用模板基名大写）。
// opts.runRoot 可指向另一个项目根（测试与临时夹具用）；缺省用运行上下文 runRoot。
export async function buildSkeleton(key, opts = {}) {
  const requested = String(key ?? '').trim();
  const root = resolveRoot(opts);
  let perRoot = skeletonCache.get(root);
  if (!perRoot) {
    perRoot = new Map();
    skeletonCache.set(root, perRoot);
  }
  const cacheKey = requested.toLowerCase();
  const cached = perRoot.get(cacheKey);
  if (cached) return cached;
  const skeleton = await computeSkeleton(requested, root);
  perRoot.set(cacheKey, skeleton);
  return skeleton;
}

// 模板指纹（D12）：登记表锁定的 commit + sha256 与实际模板读数。drift 三态——true/false = 可比对
// 且结论明确，null = 无从判断（模板或登记表读数缺失）；「模板是否可读」看 actualSha256 是否为 null，
// 不另设第二个字段表达同一事实。发版期检查据此报红，运行期只做轻提示。
export async function templateFingerprint(key, opts = {}) {
  const skeleton = await buildSkeleton(key, opts);
  const drift = skeleton.templateSha256 !== null && skeleton.actualSha256 !== null
    ? skeleton.templateSha256 !== skeleton.actualSha256
    : null;
  return {
    key: skeleton.key,
    file: skeleton.file,
    templateCommit: skeleton.templateCommit,
    recordedSha256: skeleton.templateSha256,
    actualSha256: skeleton.actualSha256,
    drift,
    derived: skeleton.derived,
    reason: skeleton.reason,
  };
}

// 登记表全部模板的骨架（键 = 模板基名）。登记表不可读 → 空对象（调用方按「未校验」处理）。
export async function allSkeletons(opts = {}) {
  const registry = await loadRegistry();
  if (!registry.available) return {};
  const out = {};
  for (const key of Object.keys(registry.data?.templates ?? {})) {
    out[key] = await buildSkeleton(key, opts);
  }
  return out;
}
