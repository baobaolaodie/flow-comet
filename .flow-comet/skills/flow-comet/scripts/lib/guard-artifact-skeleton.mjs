// guard-artifact-skeleton.mjs — 工件骨架计算（单一实现）
//
// 输入：`<runRoot>/flow-kit/templates/<DOC>.md`（上游模板，内容权威）+ `<packageRoot>/reference/
// artifact-templates.json`（本仓登记表：条件段 / 可选段 / 结构子段 / 增量段 / 首部 / 标题形态 / 指纹）。
// 输出：规范化骨架（H2 序列 + 条件标记 + 结构型 H3 + 增量段位置 + 派生来源与指纹）。
//
// 单一实现纪律（L-067）：骨架只在本模块计算。任何门禁（guard-routing / guard-template-fidelity /
// evolve / health）一律调用本模块，不得自持「读模板 + 抽 H2」的派生副本。段名归一复用 route-node 的
// normalizeHeading（去编号 / 去尾部括号 / 大小写归一），本模块不另写第二份段名归一。
// 「模板缺席时的段名清单」同样只在本模块登记（文件末尾的段名清单段）——消费方只 import，不自持
// 第二份字面清单（段名清单单一来源）。
//
// 模板缺席：derived=false 且 sections 为空（不内置任何兜底骨架）——调用方据此跳过校验并显式声明
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

// vendored flow-kit 的版本读数：项目根下 flow-kit/ 的 git HEAD（安装器按锁定快照 --detach 检出，
// 开发检出通常在分支上）。只读 HEAD 与 ref 两个小文件，不起 git 子进程、不写任何东西；读不到 /
// 非常规形态一律返回 null——「无从判断」不等于「版本不符」，不得据此提示。
async function readVendoredCommit(root) {
  const flowKitDir = path.join(root, 'flow-kit');
  let gitDir = path.join(flowKitDir, '.git');
  try {
    if ((await fs.stat(gitDir)).isFile()) {
      // worktree / 子模块形态：.git 是指针文件（gitdir: <路径>）
      const matched = normalizeTemplateText(await fs.readFile(gitDir, 'utf8')).trim().match(/^gitdir:\s*(.+)$/u);
      if (matched === null) return null;
      gitDir = path.resolve(flowKitDir, matched[1].trim());
    }
  } catch {
    return null;
  }
  let head = null;
  try {
    head = normalizeTemplateText(await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
  } catch {
    return null;
  }
  if (/^[0-9a-f]{40}$/u.test(head)) return head;
  const symbolic = head.match(/^ref:\s*(\S+)$/u);
  if (symbolic === null) return null;
  const ref = symbolic[1];
  try {
    const sha = normalizeTemplateText(await fs.readFile(path.join(gitDir, ...ref.split('/')), 'utf8')).trim();
    if (/^[0-9a-f]{40}$/u.test(sha)) return sha;
  } catch {
    // 松引用缺席时退到 packed-refs（git gc 后的正常形态）
  }
  try {
    const packed = normalizeTemplateText(await fs.readFile(path.join(gitDir, 'packed-refs'), 'utf8'));
    for (const line of packed.split('\n')) {
      const matched = line.match(/^([0-9a-f]{40})\s+(\S+)$/u);
      if (matched !== null && matched[2] === ref) return matched[1];
    }
  } catch {
    // 两个落点都读不到——按「无从判断」处理
  }
  return null;
}

// 运行期轻提示：登记表锁定的快照 commit 与项目 vendored flow-kit 的 HEAD 不一致时，打一行
// 提示即返回——不阻断任何门禁、不改状态、不落盘。每个项目根在同一进程内只判定一次（骨架按根缓存，
// 重复判定只会得到同一结论）。
const vendoredCommitChecked = new Set();

async function maybeWarnVendoredCommit(root, lockedCommit) {
  if (typeof lockedCommit !== 'string' || lockedCommit === '') return;
  if (vendoredCommitChecked.has(root)) return;
  vendoredCommitChecked.add(root);
  const vendored = await readVendoredCommit(root);
  if (vendored === null || vendored === lockedCommit) return;
  console.error('TEMPLATE-FINGERPRINT WARN: 项目 flow-kit 检出 ' + vendored.slice(0, 12)
    + ' ≠ 登记表锁定快照 ' + lockedCommit.slice(0, 12)
    + ' —— 骨架按登记表快照校验（不阻断）；升级 flow-kit 时须同批更新 reference/artifact-templates.json 的 templateCommit 与每模板 sha256');
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
    registryOnlySections: [],
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

// H2 骨架 = 模板标题行（顺序即模板顺序）+ 登记表标记。段集合以**模板**为准（C14），两个方向分开：
// 模板有而登记表没登记的段按无条件段处理（模板是权威，不告警）；登记表登记了而模板里没有的段按模板
// 忽略，但作为独立集合（registryOnlySections）报出——它是登记表滞后 / 上游删段的唯一可见信号
// （登记表与模板分叉），静默丢弃会让「模板权威」变成单向失明。
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
      pattern: headingPattern(name, 2),
    };
  });
  const templateNorms = new Set(sections.map((section) => section.norm));
  const registryOnlySections = [...registered.entries()]
    .filter(([norm]) => !templateNorms.has(norm))
    .map(([, entry]) => entry.name);
  return { sections: markUniqueness(sections, () => ''), registryOnlySections };
}

// 结构型 H3 由登记表显式列举（不用正则识别示例条目——示例条目是书写样例，不是骨架）
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

  const built = buildSections(headingLines(text, 2), entry.sections);
  skeleton.sections = built.sections;
  skeleton.registryOnlySections = built.registryOnlySections;
  skeleton.structureSubsections = buildStructureSubsections(entry.structureSubsections);
  skeleton.increments = buildIncrements(entry.increments);
  skeleton.actualSha256 = createHash('sha256')
    .update(Buffer.from(normalizeTemplateText(text), 'utf8'))
    .digest('hex');
  skeleton.derived = skeleton.sections.length > 0;
  if (!skeleton.derived) skeleton.reason = 'template-empty';
  // 登记表比模板多登记的段：按模板忽略（不阻断），但必须可见——否则登记表滞后只能等发版期指纹
  // 检查才发现（且指纹只报「模板变了」，不说「哪段没用了」）。每个根 + 每个模板键只判一次（骨架
  // 按根缓存），故不会重复刷屏。
  if (skeleton.registryOnlySections.length > 0) {
    console.error('TEMPLATE-REGISTRY WARN: 登记表登记的段在模板里不存在 '
      + skeleton.registryOnlySections.length + ' 处（' + skeleton.registryOnlySections.join('、')
      + '；模板 ' + skeleton.file + '）——段集合以模板为准，已按忽略处理（不阻断）；'
      + '请同批更新 reference/artifact-templates.json');
  }
  await maybeWarnVendoredCommit(root, skeleton.templateCommit);
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

// 模板指纹：登记表锁定的 commit + sha256 与实际模板读数。drift 三态——true/false = 可比对
// 且结论明确，null = 无从判断（模板或登记表读数缺失）；「模板是否可读」看 actualSha256 是否为 null，
// 不另设第二个字段表达同一事实。发版期检查据此报红；运行期只做轻提示（computeSkeleton 的
// maybeWarnVendoredCommit——本函数自身不打印）。
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

// ---------- 段名清单（全系统唯一一份）----------
//
// 模板缺席（模板未安装 / 登记表不可读）时仍然要生效的判据基准：模板缺席恰恰没有骨架可派生，所以
// 这些名字不可能由骨架算出来——它们是「模板缺席也要拦」的既有判据输入。此前它们以字面清单分散在
// 骨架模块之外的三处门禁模块里，「段名从哪来」因此有两个答案；现在一律在此登记，消费方只 import，
// 不得自持字面清单（静态单源锁 + 变异探针见 scenarios/n.mjs 的 TA-21）。
//
// 段名归一仍由消费方复用 route-node 的 normalizeHeading——本模块不另写第二份归一。

// SUMMARY 模板缺席时的段序兜底：登记表不可读 / 模板未安装时，SUMMARY 门禁仍判乱序与缺段。
export const LEGACY_SUMMARY_ORDER = ['做了什么', '改动文件', 'verify 输出', '6 维自查', '越界检查', '自检方法'];

// 模板缺席时 open / design 出口的段名回退（键形态保持不变，消费方按既有键取用）。
export const TEMPLATE_FALLBACK_SECTION_PATTERNS = {
  changeWhy: /^##\s*Why\b/im,
  changeVisualTone: /^##\s*视觉调性/im,
  requirementUserStory: /^##\s*用户故事/im,
  requirementAcceptance: /##\s*(验收准则|验收标准|AC|Acceptance Criteria)/i,
  designDecisionList: /^##\s*\d*\.?\s*决策清单/m,
};

// LESSONS 扫描段名：登记表缺席时的回退名，同时是登记表 increment 的查找键。
export const LESSONS_SCAN_SECTION = 'LESSONS 扫描';

// SUMMARY 必填三段：每个 change 目录下每份 *-SUMMARY.md 都要在场（既有存在性判据，与模板派生
// 判据并行——它不依赖模板是否安装，故同样属于「段名基准」而不是骨架派生值）。
export const SUMMARY_REQUIRED_SECTIONS = [
  { regex: /##\s*verify\s*输出/i, label: '## verify 输出' },
  { regex: /##\s*6\s*维自查/i, label: '## 6 维自查' },
  { regex: /##\s*(越界检查|边界检查)/i, label: '## 越界检查' },
];
