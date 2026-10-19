// protocol-utils.mjs: 工作流协议文件（workflow-protocol.json）的统一解析 / 受保护读取 / schema 校验模块
// 供 workflow-state.mjs / workflow-guard.mjs / comet-hook-guard.mjs 三脚本共用，
// 替代各脚本内联的 protocolPath 硬编码，统一协议解析优先级、受保护读取与 fail-closed 校验。
// 纯 ESM（.mjs），仅依赖 node 内置模块（fs/path），零 npm 依赖。
//
// 协议路径解析优先级（resolveProtocol）：
//   1. --protocol <path> CLI 参数（从 cliArgs 中提取；找不到该参数则忽略）
//   2. 环境变量 FLOW_COMET_PROTOCOL（非空时优先于默认）
//   3. 默认 <packageRoot>/reference/workflow-protocol.json
// 相对路径一律相对 runRoot 解析，返回绝对路径。
//
// readProtocolFile 复用 comet-hook-guard.mjs readWorkflowProtectedFile 的防护风格
// （symlink 穿越检测 + TOCTOU 快照比对 + 2MB 字节上限），返回解析后的对象，文件不存在抛错。
// validateProtocolSchema 为 fail-closed 校验：schemaVersion 必须为 1、nodes 必须是非空数组；
// 未知可选字段（writeWhitelist / taskFile）前向兼容——存在才校验类型，缺省不报错。
// 内置协议 reference/workflow-protocol.json 必须能通过该校验。

import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';

export const WORKFLOW_PROTOCOL_MAX_BYTES = 2 * 1024 * 1024;

// ---------- 受保护文件读取（单一来源：写入守卫 import 本模块，全包共用同一份实现） ----------
// 这三个判据曾以逐字节相同的副本存在于 comet-hook-guard.mjs，两侧注释互指「同源」——
// 注释不是同步机制，副本必然分叉。现由本模块导出、守卫 import：
// 改一处即全改，消除「修了这份、漏了那份」的缺陷面。

export function workflowPathInside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith('..' + path.sep))
  );
}

// 路径段扫描（单一权威）：target 词法必须在 projectRoot 内；root 必须是真实目录；自 root 起
// 对 target 的每个已存在段逐段 lstat——任一段为 symlink/junction、非末段非目录、末段类型不符
// expected、或某段 realpath 逃出物理 root → 抛错（fail-closed）；最近已存在祖先之后不存在
// → 返回 { exists: false }（不是错误：写资格判定允许目标尚未创建）。调用方负责 runRoot 的
// realpath 归一（写入侧传 realpath 后的 root）。受保护读取与写路径资格共用本段扫描，禁止副本。
export async function inspectWorkflowPathSegments(
  projectRoot,
  target,
  label,
  expected = 'any',
) {
  const lexicalRoot = path.resolve(projectRoot);
  const lexicalTarget = path.resolve(target);
  if (!workflowPathInside(lexicalRoot, lexicalTarget)) {
    throw new Error(label + ' must stay inside the project root');
  }
  const rootStat = await fs.lstat(lexicalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(label + ' project root must be a real directory');
  }
  const realRoot = await fs.realpath(lexicalRoot);
  const relative = path.relative(lexicalRoot, lexicalTarget);
  const segments = relative === '' ? [] : relative.split(path.sep);
  let cursor = lexicalRoot;
  for (let index = 0; index < segments.length; index++) {
    cursor = path.join(cursor, segments[index]);
    let stat;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        return { target: lexicalTarget, exists: false };
      }
      throw error;
    }
    const display = path.relative(lexicalRoot, cursor).replaceAll('\\', '/');
    if (stat.isSymbolicLink()) {
      throw new Error(label + ' crosses a symbolic link or junction at ' + display);
    }
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(label + ' ancestor ' + display + ' must be a real directory');
    }
    if (
      final &&
      ((expected === 'file' && !stat.isFile()) ||
        (expected === 'directory' && !stat.isDirectory()) ||
        (expected === 'any' && !stat.isFile() && !stat.isDirectory()))
    ) {
      throw new Error(label + ' must be a real ' + expected);
    }
    const physical = await fs.realpath(cursor);
    if (!workflowPathInside(realRoot, physical)) {
      throw new Error(label + ' resolves outside the project root');
    }
  }
  return { target: lexicalTarget, exists: true };
}

// 兼容既有消费方（readWorkflowProtectedFile / comet-hook-guard）：受保护读取使用同一段
// 扫描权威；这里是委托而非第二份实现（单一权威）。
export async function inspectWorkflowProtectedPath(
  projectRoot,
  target,
  label,
  expected = 'any',
) {
  return inspectWorkflowPathSegments(projectRoot, target, label, expected);
}

// 文件身份比较判据（workflowFileObjectIdentity / workflowSameFileObject / workflowSameFileStat）
// 与受保护读取 readWorkflowProtectedFile 的单一权威在本模块：workflow-guard 与 comet-hook-guard
// 均 import 复用，不再各自保留逐字节副本（同一判据两份实现会静默分叉——注释互指同源不是同步机制）。
// workflowHasIdentity 仅被本模块 workflowSameFileObject 消费，保持私有（无外部消费方不导出）。
export function workflowFileObjectIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    birthtime: typeof stat.birthtimeNs === 'bigint' ? stat.birthtimeNs : stat.birthtimeMs,
  };
}

function workflowHasIdentity(value) {
  return value !== 0 && value !== 0n && value !== '0';
}

export function workflowSameFileObject(left, right) {
  const comparableDevice = workflowHasIdentity(left.dev) && workflowHasIdentity(right.dev);
  const comparableInode = workflowHasIdentity(left.ino) && workflowHasIdentity(right.ino);
  if (comparableDevice && left.dev !== right.dev) return false;
  if (comparableInode && left.ino !== right.ino) return false;
  if (comparableDevice && comparableInode) return true;
  return left.birthtime === right.birthtime;
}

export function workflowSameFileStat(left, right) {
  return (
    workflowSameFileObject(
      workflowFileObjectIdentity(left),
      workflowFileObjectIdentity(right),
    ) &&
    left.size === right.size &&
    left.ctimeNs === right.ctimeNs
  );
}

export async function readWorkflowProtectedFile(
  projectRoot,
  file,
  label,
  maxBytes,
  hooks = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(label + ' byte limit must be a positive integer');
  }
  const inspection = await inspectWorkflowProtectedPath(
    projectRoot,
    file,
    label,
    'file',
  );
  if (!inspection.exists) {
    const error = new Error(label + ' does not exist');
    error.code = 'ENOENT';
    throw error;
  }
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(label + ' must be a real file');
  }
  if (before.size > BigInt(maxBytes)) {
    throw new Error(label + ' exceeds ' + String(maxBytes) + ' bytes');
  }
  const beforeRealPath = await fs.realpath(file);
  await hooks.afterLstat?.();
  const flags =
    process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  let handle;
  try {
    handle = await fs.open(file, flags);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ELOOP') {
      throw new Error(label + ' must be a real file');
    }
    throw error;
  }
  try {
    const [opened, afterOpen, afterOpenRealPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(file, { bigint: true }),
      fs.realpath(file),
    ]);
    if (
      !opened.isFile() ||
      !afterOpen.isFile() ||
      afterOpen.isSymbolicLink() ||
      afterOpenRealPath !== beforeRealPath ||
      !workflowSameFileStat(before, opened) ||
      !workflowSameFileStat(before, afterOpen)
    ) {
      throw new Error(label + ' changed while opening');
    }
    await inspectWorkflowProtectedPath(projectRoot, file, label, 'file');
    await hooks.afterOpen?.();
    const chunks = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    for (;;) {
      const remaining = maxBytes + 1 - total;
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, remaining),
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw new Error(label + ' exceeds ' + String(maxBytes) + ' bytes');
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    await hooks.beforeFinalCheck?.();
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(file, { bigint: true }),
      fs.realpath(file),
    ]);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterRealPath !== beforeRealPath ||
      !workflowSameFileStat(before, afterHandle) ||
      !workflowSameFileStat(before, afterPath)
    ) {
      throw new Error(label + ' changed while reading');
    }
    await inspectWorkflowProtectedPath(projectRoot, file, label, 'file');
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

// ---------- 协议路径解析 ----------

// 解析协议路径：--protocol CLI 参数 > 环境变量 FLOW_COMET_PROTOCOL > 内置默认。
// cliArgs 支持 "--protocol <path>" 与 "--protocol=<path>" 两种写法；找不到参数则忽略。
export function resolveProtocol(packageRoot, runRoot, cliArgs = []) {
  for (let index = 0; index < cliArgs.length; index++) {
    const arg = cliArgs[index];
    if (arg === '--protocol') {
      const value = cliArgs[index + 1];
      if (typeof value !== 'string' || value === '') {
        throw new Error('--protocol requires a path argument');
      }
      return path.resolve(runRoot, value);
    }
    if (typeof arg === 'string' && arg.startsWith('--protocol=')) {
      const value = arg.slice('--protocol='.length);
      if (value === '') {
        throw new Error('--protocol requires a path argument');
      }
      return path.resolve(runRoot, value);
    }
  }
  const envValue = process.env.FLOW_COMET_PROTOCOL;
  if (typeof envValue === 'string' && envValue.trim() !== '') {
    return path.resolve(runRoot, envValue);
  }
  return path.resolve(packageRoot, 'reference', 'workflow-protocol.json');
}

// ---------- 协议文件读取 ----------

// 受保护读取协议文件（symlink 穿越检测 + TOCTOU 快照比对 + 2MB 字节上限），
// 返回 JSON.parse 后的对象；文件不存在或防护校验失败时抛错（fail-closed）。
export async function readProtocolFile(projectRoot, protocolPath) {
  const buffer = await readWorkflowProtectedFile(
    projectRoot,
    protocolPath,
    'workflow protocol file',
    WORKFLOW_PROTOCOL_MAX_BYTES,
  );
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error('workflow protocol file is not valid JSON: ' + error.message);
  }
}

// ---------- schema 校验 ----------

// writeWhitelist 形状校验（validate / parse 共用）：对象，值必须都是字符串数组。
function checkWriteWhitelistShape(writeWhitelist) {
  if (typeof writeWhitelist !== 'object' || writeWhitelist === null || Array.isArray(writeWhitelist)) {
    throw new Error('workflow protocol writeWhitelist must be an object');
  }
  for (const [nodeId, prefixes] of Object.entries(writeWhitelist)) {
    if (!Array.isArray(prefixes) || !prefixes.every((p) => typeof p === 'string')) {
      throw new Error(
        'workflow protocol writeWhitelist[' + nodeId + '] must be an array of strings',
      );
    }
  }
  return writeWhitelist;
}

// fail-closed schema 校验：schemaVersion 必须为 1；nodes 必须是非空数组。
// 未知可选字段（writeWhitelist / taskFile）前向兼容：存在才校验类型，缺省不报错。
export function validateProtocolSchema(protocol) {
  if (!protocol || typeof protocol !== 'object' || Array.isArray(protocol)) {
    throw new Error('workflow protocol must be an object');
  }
  if (protocol.schemaVersion !== 1) {
    throw new Error(
      'workflow protocol schemaVersion must be 1 (got ' +
        JSON.stringify(protocol.schemaVersion) +
        ')',
    );
  }
  if (!Array.isArray(protocol.nodes) || protocol.nodes.length === 0) {
    throw new Error('workflow protocol nodes must be a non-empty array');
  }
  // nodes 元素结构校验——空对象/缺 id 的 node 会在
  // determineNode 等消费方崩溃，校验层应 fail-closed 提前拦截
  for (const node of protocol.nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error('workflow protocol node must be an object');
    }
    if (typeof node.id !== 'string' || node.id.trim() === '') {
      throw new Error('workflow protocol node must have a non-empty string id');
    }
    if (node.outputSchemas !== undefined && (!Array.isArray(node.outputSchemas) || node.outputSchemas.some((s) => typeof s !== 'string'))) {
      throw new Error('workflow protocol node.outputSchemas must be an array of strings');
    }
    if (node.requiredSkillCalls !== undefined && !Array.isArray(node.requiredSkillCalls)) {
      throw new Error('workflow protocol node.requiredSkillCalls must be an array');
    }
    // 可选字段 templates（节点 → 产出物模板 basename 清单）：缺省 = 该节点不声明模板。
    // 只校验形态（非空字符串数组），集合语义由加载链按 C3/C12 判定——schema 不持有节点映射。
    if (node.templates !== undefined
      && (!Array.isArray(node.templates)
        || node.templates.some((name) => typeof name !== 'string' || name.trim() === ''))) {
      throw new Error('workflow protocol node.templates must be an array of non-empty strings');
    }
  }
  if (Object.prototype.hasOwnProperty.call(protocol, 'writeWhitelist')) {
    checkWriteWhitelistShape(protocol.writeWhitelist);
  }
  if (Object.prototype.hasOwnProperty.call(protocol, 'taskFile')) {
    if (typeof protocol.taskFile !== 'string') {
      throw new Error('workflow protocol taskFile must be a string');
    }
  }
  return true;
}

// ---------- writeWhitelist 解析 ----------

// 解析协议可选 writeWhitelist（节点 id → 路径前缀数组）。
// 协议无该字段时返回 null，表示调用方使用内置缺省白名单表。
export function parseProtocolWriteWhitelist(protocol) {
  if (
    !protocol ||
    typeof protocol !== 'object' ||
    !Object.prototype.hasOwnProperty.call(protocol, 'writeWhitelist')
  ) {
    return null;
  }
  return checkWriteWhitelistShape(protocol.writeWhitelist);
}

// 节点 → flow-kit/prompts/ 协议文件映射(单一来源——workflow-guard 的 exit 协议声明校验与
// workflow-state 的 M5 record 自动补声明共用;改动词表仅此一处)
// 注释约定:以 flow-kit/prompts/ 实文件为准(0-change.md ~ 7-integration.md,随 flow-kit 仓库同步)
export const NODE_PROTOCOL_FILES = {
  open: ['0-change.md', '1-requirement.md'],
  design: ['2-design.md'],
  plan: ['3-task.md'],
  execute: ['4-dev.md'],
  'subagent-execute': ['4-dev.md'],
  review: ['6-review.md', '5-test.md'],
  verify: ['7-integration.md'],
  archive: ['7-integration.md'],
};

// skill → flow-kit/prompts/ 协议文件映射(单一来源——M5 record 自动补声明按 skill 归属
// 协议文件;手动 skill-load 仍以 --prompt 的 basename 为准,不受此表影响)
// 与 NODE_PROTOCOL_FILES 的关系:节点级(exit 校验用)与 skill 级(M5 自动补用)两表并存;
// skill 级取该 skill 承载的协议文件(多节点共用的 skill 如 flow-comet-dev/integration 恒映射同一文件)
export const SKILL_PROTOCOL_FILES = {
  'flow-comet-change': ['0-change.md'],
  'flow-comet-requirement': ['1-requirement.md'],
  'flow-comet-design': ['2-design.md'],
  'flow-comet-ui-design': ['2a-ui-design.md'],
  'flow-comet-task': ['3-task.md'],
  'flow-comet-dev': ['4-dev.md'],
  'flow-comet-test': ['5-test.md'],
  'flow-comet-review': ['6-review.md'],
  'flow-comet-integration': ['7-integration.md'],
};

// ---------- 产出物模板：节点级声明（加载链的单一语义来源） ----------
//
// 内置节点的产出物模板映射 = C3 的唯一权威表达处。required = 节点级必需模板；optional 表达「条件模板」
// （design 的 UI-DESIGN 仅前端 change 适用）。前端判定不在本模块：入口打印的条件行由 guard-uidesign
// 的 frontendCriterion 决定，避免在协议层写第二份前端判据。
//
// 与 reference/artifact-templates.json 的关系：登记表是「模板内容骨架」的权威（file / 段形 / 指纹），
// 本表只表达「哪个节点该声明哪些模板」（加载链面）；两者用同一模板基名键相交。
export const NODE_ARTIFACT_TEMPLATES = {
  open: { required: ['CHANGE', 'REQUIREMENT'] },
  design: { required: ['DESIGN'], optional: ['UI-DESIGN'] },
  plan: { required: ['TASK'] },
  execute: { required: ['SUMMARY'] },
  'subagent-execute': { required: ['SUMMARY'] },
  review: { required: ['REVIEW', 'TEST'] },
  verify: { required: [] },
  archive: { required: [] },
};

// 模板文件根（指针行的相对根）——模板文件本身的绝对位置由登记表的 file 字段承载，这里只拼声明名。
export const TEMPLATE_ROOT = 'flow-kit/templates';

// 模板名归一：去空白与尾随 .md（声明允许 `DESIGN` / `DESIGN.md` 两种写法）；大小写保留书写者原样，
// 比较一律走 templateKeyOf 的小写键（登记表键大写，手写声明常常小写）。
export function normalizeTemplateName(value) {
  return String(value ?? '').trim().replace(/\.md$/i, '');
}

export function templateKeyOf(value) {
  return normalizeTemplateName(value).toLowerCase();
}

// 逗号分隔的模板清单（`--templates CHANGE.md,REQUIREMENT.md`；单模板可省略逗号）→ 去重保序数组。
export function parseTemplateList(value) {
  const names = [];
  const seen = new Set();
  for (const raw of String(value ?? '').split(',')) {
    const name = normalizeTemplateName(raw);
    if (name === '') continue;
    const key = templateKeyOf(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

// --templates 原始参数收集：支持 `--templates a,b` 与 `--templates=a,b`，可重复出现（累加去重）。
// 后随参数是另一个选项（以 -- 开头）时不把它当成模板名（fail-closed 地当作「空清单」）。
// 返回 { provided, values }：provided 区分「未传该参数」与「传了空清单」——前者对内置节点是缺失声明。
export function findTemplatesArg(cliArgs) {
  let provided = false;
  const names = [];
  const collect = (raw) => {
    provided = true;
    for (const name of parseTemplateList(raw)) {
      if (!names.some((existing) => templateKeyOf(existing) === templateKeyOf(name))) names.push(name);
    }
  };
  for (let index = 0; index < (cliArgs ?? []).length; index++) {
    const arg = cliArgs[index];
    if (arg === '--templates') {
      const next = cliArgs[index + 1];
      const hasValue = typeof next === 'string' && !next.startsWith('--');
      collect(hasValue ? next : '');
      if (hasValue) index += 1;
      continue;
    }
    if (typeof arg === 'string' && arg.startsWith('--templates=')) {
      collect(arg.slice('--templates='.length));
    }
  }
  return { provided, values: names };
}

// 节点 → 模板声明。内置节点取引擎映射（协议副本删掉 node.templates 也不失效——内置节点不依赖协议
// 自称）；自定义协议节点取协议里的 node.templates（ADR-002 特化层：未声明 = 零模板）。
export function nodeTemplateDeclaration(node) {
  if (!node || typeof node !== 'object') return { source: 'none', required: [], optional: [] };
  const builtin = NODE_ARTIFACT_TEMPLATES[node.id];
  if (builtin) {
    return { source: 'builtin', required: [...builtin.required], optional: [...(builtin.optional ?? [])] };
  }
  const declared = Array.isArray(node.templates)
    ? node.templates.filter((name) => typeof name === 'string' && name.trim() !== '').map(normalizeTemplateName)
    : [];
  return declared.length > 0
    ? { source: 'protocol', required: declared, optional: [] }
    : { source: 'none', required: [], optional: [] };
}

// 声明集合比对（C11）：required ⊆ declared ⊆ required ∪ optional。返回 { missing, extra }——两者
// 皆空即通过。extra 覆盖「多写」与「错名」（都不在允许集合里）。
export function templateDeclarationProblems(declaration, declared) {
  const required = new Map(declaration.required.map((name) => [templateKeyOf(name), name]));
  const allowed = new Set([
    ...required.keys(),
    ...(declaration.optional ?? []).map((name) => templateKeyOf(name)),
  ]);
  const seen = new Map((declared ?? []).map((name) => [templateKeyOf(name), name]));
  const missing = [...required].filter(([key]) => !seen.has(key)).map(([, name]) => name);
  const extra = [...seen].filter(([key]) => !allowed.has(key)).map(([, name]) => name);
  return { missing, extra };
}

// 声明清单 → 易读形态（报文用；空清单写「零模板」——比空字符串诚实）。
export function describeTemplateList(names) {
  return Array.isArray(names) && names.length > 0 ? names.join('、') : '零模板';
}

// 模板基名 → 指针路径（`DESIGN` → `flow-kit/templates/DESIGN.md`）。
export function templatePointerPath(name) {
  return TEMPLATE_ROOT + '/' + normalizeTemplateName(name) + '.md';
}

// 重新声明的命令指引（skill-load 校验失败与 record 声明核对两处共用）：两处本说的是同一件事
// 「怎么重新声明」——各拼一份必然分叉（命令形态改一次要改两地方）。零模板节点不拼 --templates
// （省略即空集，与 C11 的「可省略」一致）；无 skill 名的场景用 <skill> 占位。
export function templateDeclareCommand(declaration, { nodeId, skillName } = {}) {
  const skill = typeof skillName === 'string' && skillName !== '' ? skillName : '<skill>';
  const flag = declaration.required.length > 0
    ? ' --templates ' + declaration.required.map((name) => name + '.md').join(',')
    : '';
  return 'workflow-state.mjs skill-load ' + nodeId + ' ' + skill + flag;
}

// 指针行（入口与 explain 共用：同一判据一份实现，两处输出措辞一致）。
// label：内置入口用 `READ TEMPLATE`，现问通道用 `TEMPLATE`；conditional=true 时追出条件模板行。
export function templatePointerLines(declaration, options = {}) {
  const label = typeof options.label === 'string' && options.label !== '' ? options.label : 'TEMPLATE';
  const lines = declaration.required.map((name) => label + ': ' + templatePointerPath(name));
  if (options.conditional === true) {
    for (const name of declaration.optional ?? []) {
      lines.push(label + '（条件模板）: ' + templatePointerPath(name) + '（仅前端 change）');
    }
  }
  return lines;
}
