#!/usr/bin/env node
  import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { validateStateFields } from './state-schema.mjs';
import { resolveProtocol, readProtocolFile, validateProtocolSchema } from './protocol-utils.mjs';

const command = process.argv[2] ?? 'verify';
const nodeId = process.argv[3] ?? null;
const apply = process.argv.includes('--apply');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const runRoot = process.env.COMET_RUN_ROOT ? path.resolve(process.env.COMET_RUN_ROOT) : process.cwd();
// 协议路径解析（resolveProtocol）：--protocol 全局参数从命令后的剩余参数提取（command=argv[2]），
// 其次 FLOW_COMET_PROTOCOL 环境变量，最后内置默认 <packageRoot>/reference/workflow-protocol.json
const protocolPath = resolveProtocol(packageRoot, runRoot, process.argv.slice(3));


const WORKFLOW_PROJECT_CONFIG_MAX_BYTES = 64 * 1024;
const WORKFLOW_PROJECT_FILE_MAX_BYTES = 2 * 1024 * 1024;

// W1-A: 节点 → 合法 exit 的前置条件（对齐 flow-kit 阶段门 + flowkit.*.v1 evidence）
const NODE_TRANSITION_GATES = {
  open:             { evidence: ['intake-summary'] },
  design:           { evidence: ['design-summary'] },
  plan:             { evidence: ['plan-summary'] },
  execute:          { evidence: ['implementation-summary'] },
  'subagent-execute':{ evidence: ['handoff-result'] },
  review:           { evidence: ['review-summary'] },
  verify:           { evidence: ['verification-result'] },
  archive:          { evidence: ['archive-summary'] },
};

// D7: 内置节点 → flow-kit/prompts/ 协议文件映射（completedChecks 真实性声明机制：exit 校验
// 声明标记的 protocol 归属）。注释约定：以 flow-kit/prompts/ 实文件为准（0-change.md ~
// 7-integration.md，随 flow-kit 仓库同步）；新增/重命名协议文件需同步本表。
const NODE_PROTOCOL_FILES = {
  open: ['0-change.md', '1-requirement.md'],
  design: ['2-design.md'],
  plan: ['3-task.md'],
  execute: ['4-dev.md'],
  'subagent-execute': ['4-dev.md'],
  review: ['6-review.md', '5-test.md'],
  verify: ['7-integration.md'],
  archive: ['7-integration.md'],
};

// T-FIX-01: 声明标记 protocol → basename 提取（exit 校验与 D7 表 basename 精确比对）。
// 兼容新旧两种格式：新格式（skill-load 写入）= 纯 basename（如 0-change.md），原样返回；
// 旧格式（P1 缺陷时代写入）= resolveProtocol 解析后的完整绝对路径（Windows 反斜杠 /
// POSIX 斜杠），提取最后一段后可比对。非字符串（null——skill-load 未传 --protocol 的
// 新格式缺省）→ null（协议集内无 null，fail-closed 由 includes 比对兜底）。
function markerProtocolBasename(value) {
  if (typeof value !== 'string' || value === '') return null;
  return String(value).replaceAll('\\', '/').split('/').pop() || null;
}

// L3-1（T-FIX-15）: REVIEW.md 发现区条目处置状态提取——"## 发现" 段下 Critical/Major/Minor
// 子区的发现项 = 以 "- **" 开头的列表项（加粗标题）；"无" 条目（"- 无" / "无（...）"）表示
// 该级别无发现，豁免。返回缺处置状态标记（[已修]/[升级]/[转待办]）的条目标题列表——
// 结构级校验（不做语义判断：标记存在即视为已处置）。发现项（含 Minor）不得"记录后无声消失"。
function reviewFindingsMissingDisposition(text) {
  const missing = [];
  for (const section of text.split(/\n##\s+/)) {
    if (!/^发现/.test(section)) continue;
    for (const line of section.split('\n')) {
      const m = line.match(/^\s*-\s*\*\*(.+?)\*\*/);
      if (!m) continue;
      if (/^无/.test(m[1].trim())) continue; // "无" 条目豁免
      if (!/\[已修\]|\[升级\]|\[转待办\]/.test(line)) missing.push(m[1]);
    }
  }
  return missing;
}

// W1-B: flow-kit SUMMARY 模板必填段（正则匹配，大小写不敏感 + 变体兼容）
const SUMMARY_REQUIRED_SECTIONS = [
  { regex: /##\s*verify\s*输出/i, label: '## verify 输出' },
  { regex: /##\s*6\s*维自查/i, label: '## 6 维自查' },
  { regex: /##\s*(越界检查|边界检查)/i, label: '## 越界检查' },
];

function workflowProjectRelativeSegments(value, label) {
  if (typeof value !== 'string') throw new Error(label + ' must be a string');
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    path.posix.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    trimmed.startsWith('~') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\')
  ) {
    throw new Error(label + ' must be a project-relative path');
  }
  if (trimmed === '.') return [];
  const segments = trimmed.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(label + ' must stay inside the project root');
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    throw new Error(label + ' must not contain empty or dot path segments');
  }
  return segments;
}

function normalizeWorkflowArtifactRoot(value) {
  const segments = workflowProjectRelativeSegments(value, 'native.artifact_root');
  return segments.length === 0 ? '.' : segments.join('/');
}

function normalizeClassicArtifactLayout(value, fallback = 'docs') {
  const resolved = value ?? fallback;
  if (resolved !== 'legacy' && resolved !== 'docs') {
    throw new Error('classic.artifact_layout must be legacy or docs');
  }
  return resolved;
}

function workflowPathInside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith('..' + path.sep))
  );
}

async function inspectWorkflowProtectedPath(
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

function workflowFileObjectIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    birthtime: typeof stat.birthtimeNs === 'bigint' ? stat.birthtimeNs : stat.birthtimeMs,
  };
}

function workflowHasIdentity(value) {
  return value !== 0 && value !== 0n && value !== '0';
}

function workflowSameFileObject(left, right) {
  const comparableDevice = workflowHasIdentity(left.dev) && workflowHasIdentity(right.dev);
  const comparableInode = workflowHasIdentity(left.ino) && workflowHasIdentity(right.ino);
  if (comparableDevice && left.dev !== right.dev) return false;
  if (comparableInode && left.ino !== right.ino) return false;
  if (comparableDevice && comparableInode) return true;
  return left.birthtime === right.birthtime;
}

function workflowSameFileStat(left, right) {
  return (
    workflowSameFileObject(
      workflowFileObjectIdentity(left),
      workflowFileObjectIdentity(right),
    ) &&
    left.size === right.size &&
    left.ctimeNs === right.ctimeNs
  );
}

async function readWorkflowProtectedFile(
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

function workflowRelativeSegments(value, label, allowWildcards = false) {
  if (typeof value !== 'string') throw new Error(label + ' must be a string');
  const trimmed = value.trim().replaceAll('\\', '/');
  if (
    trimmed.length === 0 ||
    path.posix.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    trimmed.startsWith('~') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\')
  ) {
    throw new Error(label + ' must be relative to its declared path base');
  }
  const segments = trimmed.split('/');
  if (segments.some((segment) => segment === '..')) {
    const boundary = label === 'workflow-run statePath' ? 'the project root' : 'its declared path base';
    throw new Error(label + ' must stay inside ' + boundary);
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    throw new Error(label + ' must not contain empty or dot path segments');
  }
  if (!allowWildcards && (trimmed.includes('*') || trimmed.includes('?'))) {
    throw new Error(label + ' cannot contain wildcards');
  }
  return segments;
}

function workflowYamlError(message, line) {
  const suffix = Number.isInteger(line) ? ' at line ' + String(line) : '';
  throw new Error('Invalid .comet/config.yaml: ' + message + suffix);
}

function workflowYamlStripComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (quote === "'" && character === "'" && value[index + 1] === "'") {
        index++;
        continue;
      }
      if (character === quote) {
        quote = null;
      } else if (quote === '"' && character === '\\') {
        index++;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/u.test(value[index - 1]))) {
      return value.slice(0, index);
    }
  }
  return value;
}

function workflowYamlMappingColon(value) {
  let quote = null;
  let flowDepth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (quote === "'" && character === "'" && value[index + 1] === "'") {
        index++;
        continue;
      }
      if (character === quote) {
        quote = null;
      } else if (quote === '"' && character === '\\') {
        index++;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[' || character === '{') {
      flowDepth++;
      continue;
    }
    if (character === ']' || character === '}') {
      flowDepth--;
      if (flowDepth < 0) workflowYamlError('unexpected flow collection terminator');
      continue;
    }
    if (
      character === ':' &&
      flowDepth === 0 &&
      (index + 1 === value.length || /\s/u.test(value[index + 1]))
    ) {
      return index;
    }
  }
  return -1;
}

function workflowYamlDoubleQuoted(value, line) {
  let output = '';
  const escapes = {
    '0': '\0',
    a: '\u0007',
    b: '\b',
    t: '\t',
    n: '\n',
    v: '\u000b',
    f: '\f',
    r: '\r',
    e: '\u001b',
    ' ': ' ',
    '"': '"',
    '/': '/',
    '\\': '\\',
    N: '\u0085',
    _: '\u00a0',
    L: '\u2028',
    P: '\u2029',
  };
  for (let index = 1; index < value.length; index++) {
    const character = value[index];
    if (character === '"') {
      if (value.slice(index + 1).trim() !== '') {
        workflowYamlError('unexpected content after quoted scalar', line);
      }
      return output;
    }
    if (character !== '\\') {
      output += character;
      continue;
    }
    index++;
    const escape = value[index];
    if (escape === undefined) workflowYamlError('unterminated quoted scalar', line);
    if (Object.prototype.hasOwnProperty.call(escapes, escape)) {
      output += escapes[escape];
      continue;
    }
    const widths = { x: 2, u: 4, U: 8 };
    const width = widths[escape];
    if (width) {
      const digits = value.slice(index + 1, index + 1 + width);
      if (!new RegExp('^[a-fA-F0-9]{' + String(width) + '}$', 'u').test(digits)) {
        workflowYamlError('invalid Unicode escape', line);
      }
      const point = Number.parseInt(digits, 16);
      try {
        output += String.fromCodePoint(point);
      } catch {
        workflowYamlError('invalid Unicode code point', line);
      }
      index += width;
      continue;
    }
    workflowYamlError('unsupported quoted-scalar escape', line);
  }
  workflowYamlError('unterminated quoted scalar', line);
}

function workflowYamlSingleQuoted(value, line) {
  let output = '';
  for (let index = 1; index < value.length; index++) {
    const character = value[index];
    if (character !== "'") {
      output += character;
      continue;
    }
    if (value[index + 1] === "'") {
      output += "'";
      index++;
      continue;
    }
    if (value.slice(index + 1).trim() !== '') {
      workflowYamlError('unexpected content after quoted scalar', line);
    }
    return output;
  }
  workflowYamlError('unterminated quoted scalar', line);
}

function workflowYamlPlainScalar(value) {
  if (/^(?:null|Null|NULL|~)$/u.test(value)) return null;
  if (/^(?:true|True|TRUE)$/u.test(value)) return true;
  if (/^(?:false|False|FALSE)$/u.test(value)) return false;
  if (/^[-+]?(?:0|[1-9][0-9_]*)$/u.test(value)) {
    const parsed = Number(value.replaceAll('_', ''));
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  if (
    /^[-+]?(?:(?:0|[1-9][0-9_]*)\.[0-9_]+|(?:0|[1-9][0-9_]*)(?:[eE][-+]?[0-9]+))$/u.test(
      value,
    )
  ) {
    const parsed = Number(value.replaceAll('_', ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  if (/^[&*!]/u.test(value)) {
    workflowYamlError('anchors, aliases, and tags are not supported in project config');
  }
  return value;
}

function workflowYamlFlowParser(source, line) {
  let cursor = 0;
  const skip = () => {
    while (/\s/u.test(source[cursor] ?? '')) cursor++;
  };
  const quoted = () => {
    const start = cursor;
    const quote = source[cursor++];
    while (cursor < source.length) {
      if (quote === "'" && source[cursor] === "'" && source[cursor + 1] === "'") {
        cursor += 2;
        continue;
      }
      if (source[cursor] === quote) {
        cursor++;
        const token = source.slice(start, cursor);
        return quote === '"'
          ? workflowYamlDoubleQuoted(token, line)
          : workflowYamlSingleQuoted(token, line);
      }
      if (quote === '"' && source[cursor] === '\\') cursor++;
      cursor++;
    }
    workflowYamlError('unterminated quoted scalar', line);
  };
  const value = (stops) => {
    skip();
    const character = source[cursor];
    if (character === '[') return sequence();
    if (character === '{') return mapping();
    if (character === '"' || character === "'") return quoted();
    const start = cursor;
    while (cursor < source.length && !stops.includes(source[cursor])) cursor++;
    const token = source.slice(start, cursor).trim();
    if (!token) workflowYamlError('missing flow collection value', line);
    return workflowYamlPlainScalar(token);
  };
  const sequence = () => {
    cursor++;
    const output = [];
    skip();
    if (source[cursor] === ']') {
      cursor++;
      return output;
    }
    for (;;) {
      output.push(value([',', ']']));
      skip();
      if (source[cursor] === ']') {
        cursor++;
        return output;
      }
      if (source[cursor] !== ',') workflowYamlError('expected , or ] in flow sequence', line);
      cursor++;
    }
  };
  const mapping = () => {
    cursor++;
    const output = {};
    skip();
    if (source[cursor] === '}') {
      cursor++;
      return output;
    }
    for (;;) {
      skip();
      let key;
      if (source[cursor] === '"' || source[cursor] === "'") {
        key = String(quoted());
      } else {
        const start = cursor;
        while (cursor < source.length && source[cursor] !== ':') cursor++;
        key = source.slice(start, cursor).trim();
      }
      if (!key || source[cursor] !== ':') {
        workflowYamlError('expected mapping key and : in flow mapping', line);
      }
      if (Object.prototype.hasOwnProperty.call(output, key)) {
        workflowYamlError('duplicate key ' + key, line);
      }
      cursor++;
      output[key] = value([',', '}']);
      skip();
      if (source[cursor] === '}') {
        cursor++;
        return output;
      }
      if (source[cursor] !== ',') workflowYamlError('expected , or } in flow mapping', line);
      cursor++;
    }
  };
  const parsed = value([]);
  skip();
  if (cursor !== source.length) workflowYamlError('unexpected flow collection content', line);
  return parsed;
}

function workflowYamlFlowDepth(value, line) {
  const stack = [];
  let quote = null;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (quote === "'" && character === "'" && value[index + 1] === "'") {
        index++;
        continue;
      }
      if (character === quote) {
        quote = null;
      } else if (quote === '"' && character === '\\') {
        index++;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[' || character === '{') {
      stack.push(character);
      continue;
    }
    if (character === ']' || character === '}') {
      const expected = character === ']' ? '[' : '{';
      if (stack.pop() !== expected) workflowYamlError('mismatched flow collection', line);
    }
  }
  return stack.length;
}

function workflowYamlScalar(value, line) {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return workflowYamlFlowParser(trimmed, line);
  }
  if (trimmed.startsWith('"')) return workflowYamlDoubleQuoted(trimmed, line);
  if (trimmed.startsWith("'")) return workflowYamlSingleQuoted(trimmed, line);
  if (/[\[\]{}]/u.test(trimmed)) {
    workflowYamlError('malformed flow collection', line);
  }
  return workflowYamlPlainScalar(trimmed);
}

function parseWorkflowProjectYaml(source) {
  const lines = String(source).replace(/^\uFEFF/u, '').split(/\r?\n/u);
  let cursor = 0;
  const info = (index) => {
    const raw = lines[index] ?? '';
    if (raw.includes('\t')) workflowYamlError('tabs are not supported', index + 1);
    let indent = 0;
    while (raw[indent] === ' ') indent++;
    return {
      raw,
      indent,
      content: workflowYamlStripComment(raw.slice(indent)).trimEnd(),
      line: index + 1,
    };
  };
  const skipEmpty = () => {
    while (cursor < lines.length && info(cursor).content.trim() === '') cursor++;
  };
  const nextContent = () => {
    let index = cursor;
    while (index < lines.length && info(index).content.trim() === '') index++;
    return index < lines.length ? info(index) : null;
  };
  const flowValue = (initial, line) => {
    let combined = initial;
    let depth = workflowYamlFlowDepth(combined, line);
    while (depth > 0) {
      if (cursor >= lines.length) workflowYamlError('unterminated flow collection', line);
      const current = info(cursor);
      cursor++;
      combined += ' ' + current.content.trim();
      depth = workflowYamlFlowDepth(combined, line);
    }
    return workflowYamlScalar(combined, line);
  };
  const blockScalar = (style, parentIndent) => {
    const output = [];
    let contentIndent = null;
    while (cursor < lines.length) {
      const raw = lines[cursor];
      if (raw.trim() === '') {
        output.push('');
        cursor++;
        continue;
      }
      const current = info(cursor);
      if (current.indent <= parentIndent) break;
      contentIndent ??= current.indent;
      if (current.indent < contentIndent) break;
      output.push(raw.slice(contentIndent));
      cursor++;
    }
    const text = style === '>' ? output.join('\n').replace(/([^\n])\n([^\n])/gu, '$1 $2') : output.join('\n');
    return text + '\n';
  };
  const parseKey = (value, line) => {
    const trimmed = value.trim();
    if (!trimmed) workflowYamlError('mapping key is empty', line);
    if (trimmed.startsWith('"')) return workflowYamlDoubleQuoted(trimmed, line);
    if (trimmed.startsWith("'")) return workflowYamlSingleQuoted(trimmed, line);
    if (/^[?[\]{}&,*!|>@\x60]/u.test(trimmed)) {
      workflowYamlError('unsupported complex mapping key', line);
    }
    return trimmed;
  };
  const parseFollowingValue = (rawValue, keyIndent, line) => {
    const trimmed = rawValue.trim();
    if (/^[|>][+-]?[0-9]?$/u.test(trimmed)) {
      return blockScalar(trimmed[0], keyIndent);
    }
    if (trimmed !== '') {
      return trimmed.startsWith('[') || trimmed.startsWith('{')
        ? flowValue(trimmed, line)
        : workflowYamlScalar(trimmed, line);
    }
    const next = nextContent();
    if (!next || next.indent <= keyIndent || next.content === '...') return null;
    return parseBlock(next.indent);
  };
  const mapEntry = (output, content, keyIndent, line) => {
    const colon = workflowYamlMappingColon(content);
    if (colon < 0) workflowYamlError('expected mapping key followed by :', line);
    const key = String(parseKey(content.slice(0, colon), line));
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      workflowYamlError('duplicate key ' + key, line);
    }
    output[key] = parseFollowingValue(content.slice(colon + 1), keyIndent, line);
  };
  const parseMapping = (indent) => {
    const output = {};
    for (;;) {
      skipEmpty();
      if (cursor >= lines.length) return output;
      const current = info(cursor);
      if (current.content === '...') return output;
      if (current.indent < indent) return output;
      if (current.indent > indent) workflowYamlError('unexpected indentation', current.line);
      if (current.content === '-' || current.content.startsWith('- ')) return output;
      cursor++;
      mapEntry(output, current.content, indent, current.line);
    }
  };
  const parseSequence = (indent) => {
    const output = [];
    for (;;) {
      skipEmpty();
      if (cursor >= lines.length) return output;
      const current = info(cursor);
      if (current.content === '...') return output;
      if (current.indent < indent) return output;
      if (current.indent > indent) workflowYamlError('unexpected indentation', current.line);
      if (current.content !== '-' && !current.content.startsWith('- ')) return output;
      const item = current.content === '-' ? '' : current.content.slice(2);
      cursor++;
      if (item === '') {
        const next = nextContent();
        output.push(!next || next.indent <= indent ? null : parseBlock(next.indent));
        continue;
      }
      const colon = workflowYamlMappingColon(item);
      if (colon >= 0) {
        const mapping = {};
        mapEntry(mapping, item, indent + 2, current.line);
        const next = nextContent();
        if (next && next.indent > indent) {
          const remainder = parseMapping(next.indent);
          for (const [key, value] of Object.entries(remainder)) {
            if (Object.prototype.hasOwnProperty.call(mapping, key)) {
              workflowYamlError('duplicate key ' + key, next.line);
            }
            mapping[key] = value;
          }
        }
        output.push(mapping);
      } else {
        output.push(
          item.startsWith('[') || item.startsWith('{')
            ? flowValue(item, current.line)
            : workflowYamlScalar(item, current.line),
        );
      }
    }
  };
  const parseBlock = (indent) => {
    skipEmpty();
    const current = info(cursor);
    if (current.indent !== indent) workflowYamlError('unexpected indentation', current.line);
    return current.content === '-' || current.content.startsWith('- ')
      ? parseSequence(indent)
      : parseMapping(indent);
  };

  skipEmpty();
  if (cursor < lines.length && info(cursor).content === '---') {
    cursor++;
    skipEmpty();
  }
  if (cursor >= lines.length || info(cursor).content === '...') return {};
  if (info(cursor).indent !== 0) workflowYamlError('root must start at indentation 0', info(cursor).line);
  const value = parseBlock(0);
  skipEmpty();
  if (cursor < lines.length && info(cursor).content === '...') {
    cursor++;
    skipEmpty();
  }
  if (cursor < lines.length) workflowYamlError('multiple YAML documents are not supported', info(cursor).line);
  return value;
}

function workflowConfigRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be a mapping');
  }
  return value;
}

function workflowConfigLanguage(value, fallback, label) {
  const resolved = value ?? fallback;
  if (resolved !== 'en' && resolved !== 'zh-CN') {
    throw new Error(label + ' must be en or zh-CN');
  }
  return resolved;
}

function workflowSnapshotPattern(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    value.split('/').includes('..')
  ) {
    throw new Error(label + ' contains an unsafe pattern');
  }
  if (value.length > 1024) throw new Error(label + ' exceeds 1024 characters');
  let wildcardTokens = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '?') {
      wildcardTokens++;
    } else if (value[index] === '*') {
      wildcardTokens++;
      if (value[index + 1] === '*') index++;
    }
  }
  if (wildcardTokens > 64) {
    throw new Error(label + ' contains more than 64 wildcard tokens');
  }
}

function validateWorkflowSnapshot(value) {
  if (value === undefined) return;
  const snapshot = workflowConfigRecord(value, 'native.snapshot');
  for (const key of ['include', 'exclude']) {
    if (snapshot[key] === undefined) continue;
    if (!Array.isArray(snapshot[key])) {
      throw new Error('native.snapshot.' + key + ' contains an unsafe pattern');
    }
    for (const pattern of snapshot[key]) {
      workflowSnapshotPattern(pattern, 'native.snapshot.' + key);
    }
  }
  for (const key of ['max_files', 'max_total_bytes', 'max_duration_ms']) {
    if (
      snapshot[key] !== undefined &&
      (!Number.isSafeInteger(snapshot[key]) || snapshot[key] < 1)
    ) {
      throw new Error('native.snapshot.' + key + ' must be a positive integer');
    }
  }
}

function validateWorkflowPendingRootMove(value) {
  if (value === undefined) return;
  const pending = workflowConfigRecord(value, 'native.pending_root_move');
  if (typeof pending.id !== 'string' || !/^[a-f0-9-]{8,}$/u.test(pending.id)) {
    throw new Error('native.pending_root_move.id is invalid');
  }
  if (
    typeof pending.from_artifact_root !== 'string' ||
    typeof pending.to_artifact_root !== 'string'
  ) {
    throw new Error('native.pending_root_move roots must be strings');
  }
  normalizeWorkflowArtifactRoot(pending.from_artifact_root);
  normalizeWorkflowArtifactRoot(pending.to_artifact_root);
  if (!['copying', 'ready', 'switched'].includes(pending.stage)) {
    throw new Error('native.pending_root_move.stage is invalid');
  }
  if (pending.cleanup !== undefined) {
    const cleanup = workflowConfigRecord(
      pending.cleanup,
      'native.pending_root_move.cleanup',
    );
    if (
      ![
        'forward-source',
        'restart-staging',
        'rollback-destination',
        'rollback-staging',
      ].includes(cleanup.kind)
    ) {
      throw new Error('native.pending_root_move.cleanup.kind is invalid');
    }
    if (!['prepared', 'quarantined', 'deleting'].includes(cleanup.state)) {
      throw new Error('native.pending_root_move.cleanup.state is invalid');
    }
    if (
      typeof cleanup.manifest_hash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(cleanup.manifest_hash)
    ) {
      throw new Error('native.pending_root_move.cleanup.manifest_hash is invalid');
    }
  }
}

function managedWorkflowConfigFields(source) {
  const root = workflowConfigRecord(parseWorkflowProjectYaml(source), '.comet/config.yaml');
  const hasProjectMarker =
    root.schema !== undefined ||
    root.default_workflow !== undefined ||
    root.workflows !== undefined ||
    root.native !== undefined;
  if (hasProjectMarker && root.schema !== 'comet.project.v1') {
    throw new Error('Unsupported Comet project schema');
  }
  if (
    root.schema === 'comet.project.v1' &&
    root.default_workflow !== 'native' &&
    root.default_workflow !== 'classic'
  ) {
    throw new Error('default_workflow must be native or classic');
  }
  const workflows =
    root.workflows ?? (root.default_workflow === undefined ? undefined : [root.default_workflow]);
  if (
    workflows !== undefined &&
    (!Array.isArray(workflows) ||
      workflows.length === 0 ||
      workflows.some((workflow) => workflow !== 'native' && workflow !== 'classic'))
  ) {
    throw new Error('workflows must contain native and/or classic');
  }
  if (
    workflows !== undefined &&
    root.default_workflow !== undefined &&
    !workflows.includes(root.default_workflow)
  ) {
    throw new Error('workflows must include default_workflow');
  }
  if (root.ambient_resume !== undefined && typeof root.ambient_resume !== 'boolean') {
    throw new Error('ambient_resume must be true or false');
  }

  let nativeArtifactRoot = null;
  if (root.native !== undefined) {
    const native = workflowConfigRecord(root.native, 'native');
    if (typeof native.artifact_root !== 'string') {
      throw new Error('native.artifact_root must be a string');
    }
    nativeArtifactRoot = normalizeWorkflowArtifactRoot(native.artifact_root);
    workflowConfigLanguage(native.language, 'en', 'native.language');
    const clarificationMode = native.clarification_mode ?? 'sequential';
    if (clarificationMode !== 'sequential' && clarificationMode !== 'batch') {
      throw new Error('native.clarification_mode must be sequential or batch');
    }
    const archiveConfirmation = native.archive_confirmation ?? 'automatic';
    if (archiveConfirmation !== 'automatic' && archiveConfirmation !== 'required') {
      throw new Error('native.archive_confirmation must be automatic or required');
    }
    const maxVerifyFailures = native.max_verify_failures ?? 5;
    if (!Number.isSafeInteger(maxVerifyFailures) || maxVerifyFailures < 1) {
      throw new Error('native.max_verify_failures must be a positive integer');
    }
    validateWorkflowSnapshot(native.snapshot);
    validateWorkflowPendingRootMove(native.pending_root_move);
  }

  let classicArtifactLayout = null;
  if (root.classic !== undefined) {
    const classic = workflowConfigRecord(root.classic, 'classic');
    classicArtifactLayout = normalizeClassicArtifactLayout(
      classic.artifact_layout,
      'legacy',
    );
    workflowConfigLanguage(classic.language, 'zh-CN', 'classic.language');
    const compression = classic.context_compression ?? 'off';
    if (compression !== 'off' && compression !== 'beta') {
      throw new Error('classic.context_compression must be off or beta');
    }
    const reviewMode = classic.review_mode ?? 'standard';
    if (!['off', 'standard', 'thorough'].includes(reviewMode)) {
      throw new Error('classic.review_mode must be off, standard, or thorough');
    }
    const autoTransition = classic.auto_transition ?? true;
    if (typeof autoTransition !== 'boolean') {
      throw new Error('classic.auto_transition must be true or false');
    }
  }
  const nativeEnabled = Array.isArray(workflows) && workflows.includes('native');
  const classicEnabled = Array.isArray(workflows) && workflows.includes('classic');
  if (nativeEnabled && root.native === undefined) {
    throw new Error('native must be a mapping');
  }
  if (classicEnabled && classicArtifactLayout === null) {
    classicArtifactLayout = 'legacy';
  }
  return { nativeArtifactRoot, classicArtifactLayout, nativeEnabled, classicEnabled };
}

async function readWorkflowProjectPathConfig(projectRoot) {
  const file = path.join(projectRoot, '.comet', 'config.yaml');
  let inspection;
  try {
    inspection = await inspectWorkflowProtectedPath(
      projectRoot,
      file,
      '.comet/config.yaml',
      'file',
    );
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {
        nativeArtifactRoot: null,
        classicArtifactLayout: null,
        nativeEnabled: false,
        classicEnabled: false,
      };
    }
    throw error;
  }
  if (!inspection.exists) {
    return {
      nativeArtifactRoot: null,
      classicArtifactLayout: null,
      nativeEnabled: false,
      classicEnabled: false,
    };
  }
  const source = await readWorkflowProtectedFile(
    projectRoot,
    file,
    '.comet/config.yaml',
    WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
  );
  return managedWorkflowConfigFields(source.toString('utf8'));
}

function resolveWorkflowRelativePath(base, value, label, allowWildcards = false) {
  const segments = workflowRelativeSegments(value, label, allowWildcards);
  const target = path.resolve(base, ...segments);
  const relative = path.relative(path.resolve(base), target);
  if (
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith('..' + path.sep)
  ) {
    const boundary = label === 'workflow-run statePath' ? 'the project root' : 'its declared path base';
    throw new Error(label + ' must stay inside ' + boundary);
  }
  return { target, segments };
}


function isCometOverlay(protocol) {
  return protocol.kind === 'comet-five-phase-overlay';
}

function parseSimpleYaml(raw) {
  const state = {};
  for (const line of String(raw).split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([^:#][^:]*):\s*(.*)$/u.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    const commentIndex = value.indexOf(' #');
    if (commentIndex >= 0) value = value.slice(0, commentIndex).trim();
    if (value === 'true') state[key] = true;
    else if (value === 'false') state[key] = false;
    else if (value === 'null') state[key] = null;
    else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      state[key] = value.slice(1, -1);
    } else {
      state[key] = value;
    }
  }
  return state;
}

async function workflowPathBaseRoot(pathBase) {
  if (pathBase === undefined || pathBase === 'project') {
    await inspectWorkflowProtectedPath(runRoot, runRoot, 'workflow path base', 'directory');
    return runRoot;
  }
  const config = await readWorkflowProjectPathConfig(runRoot);
  let resolved;
  let configuredClassicRoot = null;
  let alternateClassicRoot = null;
  if (pathBase === 'classic-openspec-root' || pathBase === 'classic-superpowers-root') {
    if (!config.classicEnabled || config.classicArtifactLayout === null) {
      throw new Error('Classic workflow is not enabled by .comet/config.yaml');
    }
    configuredClassicRoot = config.classicArtifactLayout === 'docs'
      ? path.join(runRoot, 'docs', 'openspec')
      : path.join(runRoot, 'openspec');
    alternateClassicRoot = config.classicArtifactLayout === 'docs'
      ? path.join(runRoot, 'openspec')
      : path.join(runRoot, 'docs', 'openspec');
  }
  if (pathBase === 'classic-openspec-root') {
    resolved = configuredClassicRoot;
  } else if (pathBase === 'classic-superpowers-root') {
    resolved = path.join(runRoot, 'docs', 'superpowers');
  } else if (pathBase === 'native-root') {
    if (!config.nativeEnabled || config.nativeArtifactRoot === null) {
      throw new Error('Native workflow is not enabled by .comet/config.yaml');
    }
    resolved = resolveWorkflowRelativePath(
      runRoot,
      config.nativeArtifactRoot,
      'native.artifact_root',
    ).target;
  } else if (pathBase === 'specs-root') {
    // flow-kit 工件根：.specs/<change-id>/ (schedule-management-fixes 等)
    resolved = path.join(runRoot, '.specs');
  } else {
    resolved = runRoot;
  }
  if (configuredClassicRoot !== null && alternateClassicRoot !== null) {
    const [configuredInspection, alternateInspection] = await Promise.all([
      inspectWorkflowProtectedPath(
        runRoot,
        configuredClassicRoot,
        'configured Classic OpenSpec root',
        'directory',
      ),
      inspectWorkflowProtectedPath(
        runRoot,
        alternateClassicRoot,
        'alternate Classic OpenSpec root',
        'directory',
      ),
    ]);
    if (!configuredInspection.exists) {
      throw new Error('Configured Classic OpenSpec root does not exist: ' + configuredClassicRoot);
    }
    if (alternateInspection.exists) {
      throw new Error('Classic layout conflict: both configured and alternate OpenSpec roots exist');
    }
  }
  const rootInspection = await inspectWorkflowProtectedPath(
    runRoot,
    resolved,
    'workflow path base',
    'directory',
  );
  if (!rootInspection.exists) {
    const label =
      pathBase === 'classic-openspec-root'
        ? 'Configured Classic OpenSpec root'
        : pathBase === 'classic-superpowers-root'
          ? 'Configured Classic Superpowers root'
          : pathBase === 'native-root'
            ? 'Configured Native artifact root'
            : 'Workflow path base';
    throw new Error(label + ' does not exist: ' + resolved);
  }
  return resolved;
}

async function activeCometChanges() {
  const changesRoot = path.join(await workflowPathBaseRoot('classic-openspec-root'), 'changes');
  const inspection = await inspectWorkflowProtectedPath(
    runRoot,
    changesRoot,
    'Classic changes root',
    'directory',
  );
  if (!inspection.exists) return [];
  let entries;
  try {
    entries = await fs.readdir(changesRoot, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return [];
    throw error;
  }
  const changes = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(
        'Classic changes root crosses a symbolic link or junction at ' + entry.name,
      );
    }
    if (!entry.isDirectory()) continue;
    const changeRoot = path.join(changesRoot, entry.name);
    await inspectWorkflowProtectedPath(
      runRoot,
      changeRoot,
      'Classic change directory',
      'directory',
    );
    const statePath = path.join(changeRoot, '.comet.yaml');
    const stateInspection = await inspectWorkflowProtectedPath(
      runRoot,
      statePath,
      'Classic change state',
      'file',
    );
    if (!stateInspection.exists) continue;
    let state;
    try {
      state = parseSimpleYaml(
        (
          await readWorkflowProtectedFile(
            runRoot,
            statePath,
            'Classic change state',
            WORKFLOW_PROJECT_FILE_MAX_BYTES,
          )
        ).toString('utf8'),
      );
      await inspectWorkflowProtectedPath(
        runRoot,
        statePath,
        'Classic change state',
        'file',
      );
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') continue;
      throw error;
    }
    const archived = state.archived === true || String(state.archived ?? '').toLowerCase() === 'true';
    if (!archived) changes.push({ name: entry.name, statePath, state });
  }
  return changes.sort((left, right) => left.name.localeCompare(right.name));
}

async function resolveCometOverlayChange() {
  const changes = await activeCometChanges();
  if (changes.length === 0) {
    throw new Error(
      'No active Comet change; use /comet-open or the permanent /comet-classic entry to create one.',
    );
  }
  if (changes.length > 1) {
    throw new Error(
      'Multiple active Comet changes: ' +
        changes.map((change) => change.name).join(', ') +
        '. Ask the user which change to resume.',
    );
  }
  return changes[0];
}

function hasOverlayEvidence(evidence, nodeId) {
  const value = evidence && typeof evidence === 'object' ? evidence[nodeId] : null;
  return !!(value && typeof value === 'object' && !Array.isArray(value));
}

function hasGeneratedPlan(state) {
  if (!Object.prototype.hasOwnProperty.call(state, 'plan')) return false;
  const value = state.plan;
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && normalized !== 'null';
  }
  return true;
}

function overlayBuildExecutionNode(state) {
  if (
    state.build_mode === 'subagent-driven-development' &&
    state.subagent_dispatch === 'confirmed'
  ) {
    return 'subagent-execute';
  }
  return 'execute';
}

function overlayNodeFromState(state, evidence = {}) {
  const phase = String(state.phase ?? '').trim();
  if (phase === 'open') return 'open';
  if (phase === 'design') return 'design';
  if (phase === 'build') {
    if (state.build_pause === 'plan-ready' || !hasGeneratedPlan(state)) {
      return 'plan';
    }
    const executionNode = overlayBuildExecutionNode(state);
    if (!hasOverlayEvidence(evidence, executionNode)) return executionNode;
    if (String(state.review_mode ?? 'off') !== 'off') return 'review';
    return executionNode;
  }
  if (phase === 'verify') return 'verify';
  if (phase === 'archive') return 'archive';
  return null;
}

function evidencePathFor(protocol, change) {
  const changeName = typeof change === 'string' ? change : change.name;
  return resolveWorkflowRelativePath(
    runRoot,
    ['.comet', 'workflow-evidence', changeName, protocol.name + '.json'].join('/'),
    'workflow evidence path',
  ).target;
}

async function readOverlayEvidence(protocol, change) {
  const file = evidencePathFor(protocol, change);
  try {
    const inspection = await inspectWorkflowProtectedPath(
      runRoot,
      file,
      'workflow evidence file',
      'file',
    );
    if (!inspection.exists) return {};
    const parsed = JSON.parse(
      (
        await readWorkflowProtectedFile(
          runRoot,
          file,
          'workflow evidence file',
          WORKFLOW_PROJECT_FILE_MAX_BYTES,
        )
      ).toString('utf8').replace(/^﻿/, ''),  // 容忍 UTF-8 BOM
    );
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function workflowProtectedDirectorySnapshot(projectRoot, directory, label) {
  const inspection = await inspectWorkflowProtectedPath(
    projectRoot,
    directory,
    label,
    'directory',
  );
  if (!inspection.exists) {
    throw new Error(label + ' does not exist');
  }
  const stat = await fs.lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(label + ' must be a real directory');
  }
  return {
    stat,
    realPath: await fs.realpath(directory),
  };
}

async function assertWorkflowProtectedDirectorySnapshot(
  projectRoot,
  directory,
  label,
  expected,
) {
  const actual = await workflowProtectedDirectorySnapshot(
    projectRoot,
    directory,
    label,
  );
  if (
    actual.realPath !== expected.realPath ||
    !workflowSameFileObject(
      workflowFileObjectIdentity(actual.stat),
      workflowFileObjectIdentity(expected.stat),
    )
  ) {
    throw new Error(label + ' changed before commit');
  }
}

async function ensureWorkflowProtectedDirectory(projectRoot, directory, label) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(directory);
  if (!workflowPathInside(root, target)) {
    throw new Error(label + ' must stay inside the project root');
  }
  const relative = path.relative(root, target);
  const segments = relative === '' ? [] : relative.split(path.sep);
  let cursor = root;
  await inspectWorkflowProtectedPath(root, cursor, label, 'directory');
  for (const segment of segments) {
    const parent = cursor;
    cursor = path.join(cursor, segment);
    const inspection = await inspectWorkflowProtectedPath(
      root,
      cursor,
      label,
      'directory',
    );
    if (!inspection.exists) {
      const parentSnapshot = await workflowProtectedDirectorySnapshot(
        root,
        parent,
        label + ' parent',
      );
      try {
        await fs.mkdir(cursor);
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
          throw error;
        }
      }
      await assertWorkflowProtectedDirectorySnapshot(
        root,
        parent,
        label + ' parent',
        parentSnapshot,
      );
    }
    const created = await inspectWorkflowProtectedPath(
      root,
      cursor,
      label,
      'directory',
    );
    if (!created.exists) {
      throw new Error(label + ' could not be created safely');
    }
  }
}

async function workflowProtectedTargetSnapshot(projectRoot, file, label) {
  const inspection = await inspectWorkflowProtectedPath(
    projectRoot,
    file,
    label,
    'file',
  );
  if (!inspection.exists) return { exists: false };
  const stat = await fs.lstat(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(label + ' must be a real file');
  }
  return {
    exists: true,
    stat,
    realPath: await fs.realpath(file),
  };
}

async function assertWorkflowProtectedTargetSnapshot(
  projectRoot,
  file,
  label,
  expected,
) {
  const actual = await workflowProtectedTargetSnapshot(projectRoot, file, label);
  if (actual.exists !== expected.exists) {
    throw new Error(label + ' changed before commit');
  }
  if (
    actual.exists &&
    expected.exists &&
    (actual.realPath !== expected.realPath ||
      !workflowSameFileStat(actual.stat, expected.stat))
  ) {
    throw new Error(label + ' changed before commit');
  }
}

async function writeWorkflowProtectedFile(
  projectRoot,
  file,
  label,
  value,
  maxBytes,
) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(label + ' byte limit must be a positive integer');
  }
  if (bytes.length > maxBytes) {
    throw new Error(label + ' exceeds ' + String(maxBytes) + ' bytes');
  }
  const root = path.resolve(projectRoot);
  const target = path.resolve(file);
  const directory = path.dirname(target);
  await ensureWorkflowProtectedDirectory(root, directory, label + ' directory');
  const directorySnapshot = await workflowProtectedDirectorySnapshot(
    root,
    directory,
    label + ' directory',
  );
  const targetSnapshot = await workflowProtectedTargetSnapshot(root, target, label);
  await assertWorkflowProtectedDirectorySnapshot(
    root,
    directory,
    label + ' directory',
    directorySnapshot,
  );
  await assertWorkflowProtectedTargetSnapshot(root, target, label, targetSnapshot);

  const temporary = path.join(
    directory,
    '.' +
      path.basename(target) +
      '.' +
      String(process.pid) +
      '.' +
      String(Date.now()) +
      '.' +
      Math.random().toString(16).slice(2) +
      '.tmp',
  );
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    (process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW);
  let handle;
  let committed = false;
  try {
    await assertWorkflowProtectedDirectorySnapshot(
      root,
      directory,
      label + ' directory',
      directorySnapshot,
    );
    handle = await fs.open(temporary, flags, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    const temporaryStat = await handle.stat({ bigint: true });
    if (!temporaryStat.isFile()) {
      throw new Error(label + ' temporary path must be a real file');
    }
    await handle.close();
    handle = undefined;
    await inspectWorkflowProtectedPath(
      root,
      temporary,
      label + ' temporary file',
      'file',
    );
    await assertWorkflowProtectedDirectorySnapshot(
      root,
      directory,
      label + ' directory',
      directorySnapshot,
    );
    await assertWorkflowProtectedTargetSnapshot(root, target, label, targetSnapshot);
    await fs.rename(temporary, target);
    committed = true;
    await inspectWorkflowProtectedPath(root, target, label, 'file');
    await assertWorkflowProtectedDirectorySnapshot(
      root,
      directory,
      label + ' directory',
      directorySnapshot,
    );
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
    if (!committed) {
      try {
        await assertWorkflowProtectedDirectorySnapshot(
          root,
          directory,
          label + ' directory',
          directorySnapshot,
        );
        await fs.rm(temporary, { force: true });
      } catch {
        // Do not follow a replaced parent during cleanup.
      }
    }
  }
}

async function writeOverlayEvidence(protocol, change, value) {
  const file = evidencePathFor(protocol, change);
  await writeWorkflowProtectedFile(
    runRoot,
    file,
    'workflow evidence file',
    JSON.stringify(value, null, 2) + '\n',
    WORKFLOW_PROJECT_FILE_MAX_BYTES,
  );
}


function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
}

function generatedNodeSkillName(protocol, id) {
  return (slug(protocol.name) || 'workflow') + '-' + (slug(id) || 'node');
}

async function statePath(protocol) {
  const preferred = String(protocol.state?.statePath ?? '');
  const target = resolveWorkflowRelativePath(
    runRoot,
    preferred,
    'workflow-run statePath',
  ).target;
  await inspectWorkflowProtectedPath(
    runRoot,
    target,
    'workflow-run statePath',
    'file',
  );
  return target;
}

async function readStateJson(file) {
  // 容忍 UTF-8 BOM（外部写入可能带 BOM）
  return JSON.parse(
    (
      await readWorkflowProtectedFile(
        runRoot,
        file,
        'workflow-run state',
        WORKFLOW_PROJECT_FILE_MAX_BYTES,
      )
    ).toString('utf8').replace(/^﻿/, ''),
  );
}

async function writeJson(file, value) {
  await writeWorkflowProtectedFile(
    runRoot,
    file,
    'workflow-run state',
    JSON.stringify(value, null, 2) + '\n',
    WORKFLOW_PROJECT_FILE_MAX_BYTES,
  );
}

function route(protocol) {
  return protocol.nodes.filter((node) => !node.disabled);
}

function findNode(protocol, id) {
  return route(protocol).find((node) => node.id === id || generatedNodeSkillName(protocol, node.id) === id) ?? null;
}

function completedSet(state) {
  return new Set(Array.isArray(state.completedNodes) ? state.completedNodes : []);
}

function nextNode(protocol, state) {
  const completed = completedSet(state);
  return route(protocol).find((node) => !completed.has(node.id)) ?? null;
}

function printNext(protocol, node) {
  if (!node) {
    console.log('NEXT: done');
    return;
  }
  console.log('NEXT: auto');
  console.log('NODE: ' + node.id);
  console.log('SKILL: ' + generatedNodeSkillName(protocol, node.id));
}

function evidenceFor(state, id) {
  const value = state.evidence && typeof state.evidence === 'object' ? state.evidence[id] : null;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function missingRequiredSkillChecks(node, evidence) {
  const values = Array.isArray(evidence?.completedChecks) ? evidence.completedChecks : [];
  return (node.requiredSkillCalls ?? [])
    .map((binding) => 'required-skill:' + node.id + '.' + binding.skill)
    .filter((check) => !values.includes(check));
}

function missingAugmentationChecks(node, evidence) {
  const values = Array.isArray(evidence?.completedChecks) ? evidence.completedChecks : [];
  return (node.augmentations ?? [])
    .filter((binding) => binding.enforcement && binding.enforcement !== 'advisory')
    .map((binding) => 'augmentation:' + node.id + '.' + binding.skill)
    .filter((check) => !values.includes(check));
}

function hasEvidenceField(evidence, id) {
  if (Object.prototype.hasOwnProperty.call(evidence, id)) return true;
  const schemaEvidence = evidence.schemaEvidence;
  return !!(
    schemaEvidence &&
    typeof schemaEvidence === 'object' &&
    !Array.isArray(schemaEvidence) &&
    Object.prototype.hasOwnProperty.call(schemaEvidence, id)
  );
}

// T-FIX-05: 共用证据库 handoffResult 识别——subagent-execute 的委托结果由 workflow-handoff
// result 写入嵌套 handoffResult（{ <taskId>: { result, completedAt } }），非顶层
// handoff-result 字段；嵌套对象存在且非空（至少一个任务记录）视为该 evidence 已产生
// （gate 只认存在性，内容严格校验由 W1-D Return Contract 校验负责）。
function hasNonEmptyHandoffResult(evidence) {
  const handoff = evidence?.handoffResult;
  return !!(
    handoff &&
    typeof handoff === 'object' &&
    !Array.isArray(handoff) &&
    Object.keys(handoff).length > 0
  );
}

function schemaMap(protocol) {
  return new Map((protocol.outputSchemas ?? []).map((schema) => [schema.id, schema]));
}

function missingRequiredSchemaEvidence(protocol, node, evidence) {
  const schemas = schemaMap(protocol);
  const missing = [];
  // schema evidence 缺失但 record 传了 summary → 以 summary 视为产出证据（避免手动构造各字段）
  const hasSummary = typeof evidence?.summary === 'string' && evidence.summary.trim() !== '';
  for (const schemaId of node.outputSchemas ?? []) {
    const schema = schemas.get(schemaId);
    for (const field of schema?.evidence ?? []) {
      if (field.required && !hasEvidenceField(evidence, field.id) && !hasSummary) {
        missing.push(schemaId + '.' + field.id);
      }
    }
  }
  return missing;
}

// P2: 并行冲突检测——解析 TASK.md 中 parallel=pending 任务的 write_files，找交集（防同 wave 并行写冲突）
async function findParallelWriteConflicts(changeDir) {
  const taskFile = path.join(changeDir, 'TASK.md');
  let text;
  try { text = await fs.readFile(taskFile, 'utf8'); } catch { return []; }
  const blocks = [...text.matchAll(/<task[^>]*parallel="true"[^>]*status="pending"[\s\S]*?<\/task>/g)];
  const perTask = [];
  for (const b of blocks) {
    const idMatch = b[0].match(/<task[^>]*id="([^"]+)"/);
    const wf = b[0].match(/<write_files>([\s\S]*?)<\/write_files>/);
    if (!idMatch || !wf) continue;
    const files = [...wf[1].matchAll(/([A-Za-z0-9_./@*-]+\.(?:ts|tsx|py|js|mjs|json|css|md))/g)].map((m) => m[1]);
    perTask.push({ id: idMatch[1], files: new Set(files) });
  }
  const conflicts = [];
  for (let i = 0; i < perTask.length; i++) {
    for (let j = i + 1; j < perTask.length; j++) {
      const overlap = [...perTask[i].files].filter((f) => perTask[j].files.has(f));
      if (overlap.length) conflicts.push({ a: perTask[i].id, b: perTask[j].id, files: overlap });
    }
  }
  return conflicts;
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
}

function patternToRegExp(pattern) {
  return new RegExp('^' + String(pattern).split('*').map(escapeRegExp).join('.*') + '$', 'u');
}

async function pathPatternExists(root, relativePattern) {
  const parts = workflowRelativeSegments(relativePattern, 'artifact path', true);
  async function walk(current, index) {
    const inspection = await inspectWorkflowProtectedPath(
      runRoot,
      current,
      'workflow artifact path',
      index >= parts.length ? 'any' : 'directory',
    );
    if (!inspection.exists) return false;
    if (index >= parts.length) {
      return true;
    }
    const part = parts[index];
    if (!part.includes('*')) {
      return walk(path.join(current, part), index + 1);
    }
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return false;
    }
    const matcher = patternToRegExp(part);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error(
          'workflow artifact path crosses a symbolic link or junction at ' +
            path.join(current, entry.name),
        );
      }
      if (matcher.test(entry.name) && (await walk(path.join(current, entry.name), index + 1))) {
        return true;
      }
    }
    return false;
  }
  return walk(root, 0);
}

async function missingRequiredArtifacts(protocol, node, change) {
  const schemas = schemaMap(protocol);
  const missing = [];
  for (const schemaId of node.outputSchemas ?? []) {
    const schema = schemas.get(schemaId);
    for (const artifact of schema?.artifacts ?? []) {
      if (!artifact.required) continue;
      const exists = (
        await Promise.all(
          (artifact.paths ?? []).map(async (artifactPath) => {
            // 替换 <change-id> 占位符为实际 change（如 name-format-unify）
            const resolvedPath = change ? artifactPath.replaceAll('<change-id>', change) : artifactPath;
            return pathPatternExists(await workflowPathBaseRoot(artifact.pathBase), resolvedPath);
          }),
        )
      ).some(Boolean);
      if (!exists) missing.push(schemaId + '.' + artifact.id);
    }
  }
  return missing;
}

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

// W1-B: 校验 change 目录下每份 *-SUMMARY.md 含 SUMMARY 模板的三个必填段
// 用正则（大小写不敏感 + 变体兼容）——避免现有 SUMMARY 格式漂移导致误 BLOCKED
async function verifySummaries(changeDir) {
  const files = (await fs.readdir(changeDir).catch(() => [])).filter(f => f.endsWith('-SUMMARY.md'));
  const violations = [];
  for (const f of files) {
    const content = await fs.readFile(path.join(changeDir, f), 'utf8');
    for (const section of SUMMARY_REQUIRED_SECTIONS) {
      if (!section.regex.test(content)) violations.push(`${f} 缺 ${section.label}`);
    }
  }
  return violations;
}

// W1-C 过渡规则: 历史归档 change 不强制真实跑验证命令（判断 .specs/archive/ 目录）
async function isArchivedChange(changeName) {
  if (!changeName) return false;
  const archiveRoot = path.join(runRoot, '.specs', 'archive');
  if (await fileExists(path.join(archiveRoot, changeName))) return true;
  const entries = await fs.readdir(archiveRoot).catch(() => []);
  return entries.some(e => e === changeName || e.endsWith('-' + changeName));
}

// T-FIX-04: 声明标记目录解析——活动路径 .specs/<change-id>/.skill-loads/ 优先；归档路径兜底
// （archive 节点「先移目录后 record/exit」顺序下 change 目录已在 .specs/archive/<前缀>-<change-id>/，
// 标记只随目录移动——只查活动路径会把「标记存在」误判成「机制未激活」）。归档扫描匹配后缀
// -<change-id>（前缀可含日期等，与协议 flowkit.archive.v1 的 archive/*-<change-id> 同构）。
// 两者皆无 → null（D6 语义：声明机制从未激活，调用方按旧 change 兼容跳过）。
async function findSkillLoadsDir(root, changeName) {
  const activeDir = path.join(root, '.specs', changeName, '.skill-loads');
  if (await fileExists(activeDir)) {
    return { dir: activeDir, display: '.specs/' + changeName + '/.skill-loads/' };
  }
  const archiveRoot = path.join(root, '.specs', 'archive');
  const entries = await fs.readdir(archiveRoot).catch(() => []);
  for (const entry of entries) {
    if (!entry.endsWith('-' + changeName)) continue;
    const candidate = path.join(archiveRoot, entry, '.skill-loads');
    if (await fileExists(candidate)) {
      return { dir: candidate, display: '.specs/archive/' + entry + '/.skill-loads/' };
    }
  }
  return null;
}

// C2: 段名校验从模板自动派生——读 <runRoot>/flow-kit/templates/{CHANGE,REQUIREMENT,DESIGN}.md
// 提取全部 ^## 段名，正则化生成宽松匹配模式；模板目录/文件缺失时 fallback 内置段名
let templateSectionPatternsCacheRoot = null;
let templateSectionPatternsCache = null;

const TEMPLATE_FALLBACK_SECTION_PATTERNS = {
  changeWhy: /^##\s*Why\b/im,
  requirementUserStory: /^##\s*用户故事/im,
  requirementAcceptance: /##\s*(验收准则|验收标准|AC|Acceptance Criteria)/i,
  designDecisionList: /^##\s*\d*\.?\s*决策清单/m,
};

// 模板段名 → 宽松匹配正则：编号前缀（1. / 0.5）可选 + 段名主体字面匹配 + 尾部括号内容（如 （AC））可选
function templateSectionPattern(rawName) {
  const name = String(rawName).trim();
  const body = name
    .replace(/[（(][^）)\n]*[）)]\s*$/u, '')   // 去尾部括号内容：Why（为什么做）→ Why
    .replace(/^\d+(?:\.\d+)?\.?\s*/u, '')       // 去编号前缀：1. 决策清单 → 决策清单
    .trim();
  const escaped = escapeRegExp(body || name);
  return new RegExp(
    '^##\\s*(?:\\d+(?:\\.\\d+)?\\.?\\s*)?' + escaped + '\\s*(?:[（(][^\\n）)]*[）)])?\\s*$',
    'im',
  );
}

// 读取模板全部段名生成模式列表（模块级缓存，避免每次 exit 重复读文件）；pick 按关键词选段，找不到 → fallback
async function templateSectionPatterns() {
  if (templateSectionPatternsCacheRoot === runRoot && templateSectionPatternsCache) {
    return templateSectionPatternsCache;
  }
  const templateDir = path.join(runRoot, 'flow-kit', 'templates');
  const result = { change: [], requirement: [], design: [] };
  for (const [key, fileName] of Object.entries({
    change: 'CHANGE.md',
    requirement: 'REQUIREMENT.md',
    design: 'DESIGN.md',
  })) {
    const templateFile = path.join(templateDir, fileName);
    if (await fileExists(templateFile)) {
      try {
        const text = await fs.readFile(templateFile, 'utf8');
        for (const match of text.matchAll(/^##\s+(.+)$/gmu)) {
          const sectionName = match[1].trim();
          result[key].push({ name: sectionName, regex: templateSectionPattern(sectionName) });
        }
      } catch {}
    }
  }
  result.pick = (key, keywords, fallback) => {
    for (const section of result[key] ?? []) {
      if (keywords.some((keyword) => section.name.includes(keyword))) return section.regex;
    }
    return fallback;
  };
  templateSectionPatternsCache = result;
  templateSectionPatternsCacheRoot = runRoot;
  return result;
}

// C3: TASK.md 任务集签名——提取全部 <task> 块，剥离开标签上的标记类属性（仅保留 id/parallel），排序防顺序漂移，拼接后 sha256
// 行尾规范化——Windows 下 bash heredoc 写 LF、python 写 CRLF（os.linesep），跨工具编辑
// 导致"任务集逻辑未变但字节变"的误报 BLOCK；签名前统一 CRLF → LF（仅归一化行尾，不改变内容语义）
// 标记类属性白名单——子代理标记 task done 会在开标签追加 completed_at/started_at/finished_at/
// assigned_to/updated_at 等属性（纯状态标记），仅剥离 status 仍误报 BLOCK；改为开标签只保留
// 影响路由语义的 id/parallel，其余属性一律剥离（含未来新增标记属性，无需再改）；
// 任务内容（name/action/write_files/verify/depends_on）保持签名敏感
function taskSetSignature(taskContent) {
  const normalized = String(taskContent).replace(/\r\n/g, '\n');
  const blocks = (normalized.match(/<task[\s\S]*?<\/task>/g) || [])
    .map((block) =>
      block.replace(/<task[^>]*>/, (open) =>
        open.replace(/\s+[a-zA-Z_][\w-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'))?/g, (attr) =>
          /^\s*(?:id|parallel)(?=[\s=>])/.test(attr) ? attr : ''
        )
      )
    )
    .sort();
  return createHash('sha256').update(blocks.join('\n'), 'utf8').digest('hex');
}

// WARN 计数——entry/exit 成功路径末尾输出汇总行（可观测性；追加不改变既有输出）
let __warnCount = 0;
const __origError = console.error;

async function main() {
  // 包装 console.error 统计 WARN 输出（转发原实现，行为不变）
  console.error = (...args) => {
    if (/WARN/.test(args.join(' '))) __warnCount += 1;
    __origError(...args);
  };
  // 受保护读取 + fail-closed schema 校验（读失败/校验失败沿用 throw → main().catch 统一处理）
  const protocol = await readProtocolFile(runRoot, protocolPath);
  validateProtocolSchema(protocol);
  if (command === 'verify') {
    console.log('workflow-guard-ok');
    return;
  }
  if (command !== 'entry' && command !== 'exit') throw new Error('Unknown command: ' + command);
  if (!nodeId) throw new Error(command + ' requires a Node id.');
  const node = findNode(protocol, nodeId);
  if (!node) throw new Error('Unknown workflow Node: ' + nodeId);
  if (isCometOverlay(protocol)) {
    const change = await resolveCometOverlayChange();
    const overlayEvidence = await readOverlayEvidence(protocol, change);
    const current = overlayNodeFromState(change.state, overlayEvidence);
    if (command === 'entry') {
      if (current !== node.id) {
        console.error('BLOCKED: current Node is ' + String(current) + ', cannot enter ' + node.id + '.');
        process.exit(1);
      }
      console.log('ENTRY OK: ' + node.id);
      return;
    }
    const evidenceState = { evidence: overlayEvidence };
    const evidence = evidenceFor(evidenceState, node.id);
    if (!evidence) {
      console.error('BLOCKED: missing evidence for Node ' + node.id + '.');
      process.exit(1);
    }
    const missingSchemaEvidence = missingRequiredSchemaEvidence(protocol, node, evidence);
    if (missingSchemaEvidence.length > 0) {
      console.error('BLOCKED: missing Output Schema evidence: ' + missingSchemaEvidence.join(', '));
      process.exit(1);
    }
    const missingArtifacts = await missingRequiredArtifacts(protocol, node, change);
    if (missingArtifacts.length > 0) {
      console.error('BLOCKED: missing Output Schema artifacts: ' + missingArtifacts.join(', '));
      process.exit(1);
    }
    const missingRequired = missingRequiredSkillChecks(node, evidence);
    if (missingRequired.length > 0) {
      console.error('BLOCKED: missing required Skill evidence: ' + missingRequired.join(', '));
      process.exit(1);
    }
    const missingAugmentations = missingAugmentationChecks(node, evidence);
    if (missingAugmentations.length > 0) {
      console.error('BLOCKED: missing augmentation evidence: ' + missingAugmentations.join(', '));
      process.exit(1);
    }
    console.log('ALL CHECKS PASSED');
    if (apply) {
      console.log('COMET STATE: unchanged; phase progression remains owned by the original Comet runtime.');
      return;
    }
    console.log('APPLY: rerun with --apply to update workflow state');
    return;
  }
  const file = await statePath(protocol);
  const state = await readStateJson(file);
  state.completedNodes = Array.isArray(state.completedNodes) ? state.completedNodes : [];
  state.evidence = state.evidence && typeof state.evidence === 'object' ? state.evidence : {};
  if (command === 'entry') {
    const current = state.currentNode ?? nextNode(protocol, state)?.id ?? null;
    if (current !== node.id && !state.completedNodes.includes(node.id)) {
      console.error('BLOCKED: current Node is ' + String(current) + ', cannot enter ' + node.id + '.');
      process.exit(1);
    }
    // E2: entry archive 分支校验（新模式 branchMode=true）——归档必须在 change/<activeChange> 分支上进行
    // 旧模式（无 branchMode 字段 / 非 git 仓库 / git 不可用）跳过，向后兼容
    if (node.id === 'archive' && state.branchMode === true && state.activeChange) {
      const { execFileSync } = await import('child_process');
      try {
        const branch = String(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' })).trim();
        // 归档分支前缀用 state.branchPrefix（缺省 'change/'，适配仓库自身规范）
        const archivePrefix = state.branchPrefix ?? 'change/';
        if (branch !== archivePrefix + state.activeChange) {
          console.error('BLOCKED: 归档必须在 ' + archivePrefix + state.activeChange + ' 分支上进行（当前: ' + branch + '）');
          process.exit(1);
        }
      } catch {
        // git 不可用 → 跳过分支校验（旧模式兼容）
      }
    }
    // P2: 并行冲突检测——subagent-execute 委托前校验 wave 内 parallel 任务 write_files 无交集
    if (node.id === 'subagent-execute' && state.activeChange) {
      const conflicts = await findParallelWriteConflicts(path.join(runRoot, '.specs', state.activeChange));
      if (conflicts.length > 0) {
        console.error('BLOCKED: parallel tasks write_files 冲突: ' + conflicts.map((c) => `${c.a}×${c.b}(${c.files.join(',')})`).join('; '));
        process.exit(1);
      }
    }
    // C4: 委托前工件 commit 检查——worktree isolation 子代理看不到未提交工件（WARN 不 BLOCKED）
    if ((node.id === 'execute' || node.id === 'subagent-execute') && state.activeChange) {
      const { execFileSync } = await import('child_process');
      try {
        execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: runRoot, stdio: 'pipe' });
        const statusOut = execFileSync(
          'git',
          ['status', '--porcelain', '--', path.posix.join('.specs', state.activeChange) + '/'],
          { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' },
        );
        if (String(statusOut).trim() !== '') {
          console.error('WORKTREE WARN: .specs/' + state.activeChange + '/ 有未提交工件，worktree isolation 子代理将看不到它们——建议先 commit 或 prompt 内联上下文');
        }
      } catch (err) {
        //  (P4): 检测失败可见化——非 git 仓库/路径不可查时提示 SKIP 原因（防静默失效）
        console.error('C4-CHECK SKIP: ' + (err && err.message ? String(err.message).split('\n')[0] : String(err)));
      }
    }
    // C7: PROGRESS.md 存在警告（清窗恢复产物，R1.6 反重复）
    if (node.id === 'execute' && state.activeChange) {
      if (await fileExists(path.join(runRoot, '.specs', state.activeChange, 'PROGRESS.md'))) {
        console.error('WARNING: PROGRESS.md 存在（清窗恢复产物），先读"已排除方案"段（R1.6 反重复）');
      }
    }
    // C3: enter execute / subagent-execute 记录 TASK.md 任务集签名（exit 时比对，防 execute 期间增删任务/改 action/改边界）
    if ((node.id === 'execute' || node.id === 'subagent-execute') && state.activeChange) {
      const taskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
      if (await fileExists(taskFile)) {
        try {
          state.taskHash = taskSetSignature(await fs.readFile(taskFile, 'utf8'));
          const bad = validateStateFields(state);
          if (bad.length) { console.error('BLOCKED: state 字段类型非法: ' + bad[0]); process.exit(1); }
          await writeJson(file, state);
        } catch {}
      }
    }
    // 协调者禁令：execute / subagent-execute 阶段主会话只能委托，禁止直接写源码
    // 例外：direct 模式 execute 是主代理直写（逃生口），不输出协调者禁令
    const entryExecutionMode = state.executionMode ?? 'subagent';
    if (node.id === 'execute' || node.id === 'subagent-execute') {
      if (!(entryExecutionMode === 'direct' && node.id === 'execute')) {
        console.log('COORDINATOR: 你是协调者，不是执行者。禁止在主会话直接修改源码；只能通过 Agent 工具 worktree isolation 委托子代理；子代理回传后仅更新 TASK.md / SUMMARY / handoff evidence。');
      }
    }
    console.log('ENTRY OK: ' + node.id);
    return;
  }
  const evidence = evidenceFor(state, node.id);
  if (!evidence) {
    console.error('BLOCKED: missing evidence for Node ' + node.id + '.');
    process.exit(1);
  }
  // W1-A: 转移前置约束——currentNode 必须等于被 exit 的节点（防跳阶段）
  if (state.currentNode !== node.id) {
    console.error('BLOCKED: currentNode is ' + String(state.currentNode) + ', cannot exit ' + node.id + '.');
    process.exit(1);
  }
  // E2: exit archive 分支合并检查（WARN 不 BLOCK）——分支未合并到 main 允许"归档先行、合并后补"
  if (node.id === 'archive' && state.branchMode === true && state.activeChange) {
    const { execFileSync } = await import('child_process');
    try {
      const branch = String(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' })).trim();
      const mergedOut = String(execFileSync('git', ['branch', '--merged', 'main'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' }));
      const mergedBranches = mergedOut.split('\n').map(l => l.trim().replace(/^\*\s*/, ''));
      if (!mergedBranches.includes(branch)) {
        console.error('WARN: 分支 change/' + state.activeChange + ' 未合并到 main——归档后请完成 merge + 删除分支');
      }
    } catch {
      // git 不可用 / main 不存在 → 跳过合并检查
    }
  }
  // 特化校验按节点 id 绑定（ADR-002）：内置节点 id 触发 flow-kit 契约校验；自定义协议节点不误触发（通用层防线对其生效）
  // E7: 追加位置结构检测（全部 WARN 不 BLOCK）——防 CONTEXT/LESSONS/STATE/CHANGELOG 文件尾追加破坏插入位置纪律
  if (node.id === 'open' && state.activeChange) {
    const contextFile = path.join(runRoot, '.specs', 'CONTEXT.md');
    try {
      const content = await fs.readFile(contextFile, 'utf8');
      const m = content.match(/^## (术语|已锁决策|决策|术语表)[（(][^\n]*(?:追加|update)[^\n]*$/im);
      if (m) {
        console.error('WARN: CONTEXT.md 检测到孤立追加段（术语/决策应插入既有结构段）：' + m[0].replace(/^##\s*/, '').trim());
      }
    } catch {}
  }
  if ((node.id === 'verify' || node.id === 'archive') && state.activeChange) {
    const lessonsFile = path.join(runRoot, '.specs', 'LESSONS.md');
    try {
      const content = await fs.readFile(lessonsFile, 'utf8');
      // 条目区锚点兼容：## 条目区（模板）/ ## 活跃条目 + ## 已解决条目（赛事系统实际结构）——取最早条目段
      const zoneIndex = (() => {
        const hits = ['条目区', '活跃条目', '已解决条目']
          .map(s => content.search(new RegExp('^##\\s*' + s + '\\s*$', 'm')))
          .filter(i => i !== -1);
        return hits.length ? Math.min(...hits) : -1;
      })();
      const headings = [...content.matchAll(/^###\s*L-(\d+)/gm)];
      if (zoneIndex !== -1) {
        const outside = headings.some(h => h.index < zoneIndex);
        if (outside) console.error('WARN: LESSONS.md 有条目在条目区外');
      }
      const nums = headings.map(h => parseInt(h[1], 10));
      // 分段检测：按 ## 标题分段，仅同段内比较编号递增（多段 LESSONS 如「活跃条目/已解决条目」编号体系可独立）
      const sectionStarts = [...content.matchAll(/^##\s+.*$/gm)].map(m => m.index);
      for (let i = 1; i < nums.length; i++) {
        const sameSection = !sectionStarts.some(s => s > headings[i - 1].index && s < headings[i].index);
        if (sameSection && nums[i] <= nums[i - 1]) {
          console.error('WARN: LESSONS.md 条目编号乱序（L-' + String(nums[i]).padStart(3, '0') + ' 应按序插入条目区）');
          break;
        }
      }
    } catch {}
  }
  if (node.id === 'archive') {
    const stateMd = path.join(runRoot, 'STATE.md');
    try {
      const content = await fs.readFile(stateMd, 'utf8');
      const dates = [...content.matchAll(/^- `?\[(\d{4}-\d{2}-\d{2})\]/gm)].map(m => m[1]);
      for (let i = 1; i < dates.length; i++) {
        if (dates[i] > dates[i - 1]) {
          console.error('WARN: STATE.md 决策日志非倒序（新决策应插入顶部）');
          break;
        }
      }
    } catch {}
    const changelogFile = path.join(runRoot, '.specs', 'CHANGELOG.md');
    try {
      const content = await fs.readFile(changelogFile, 'utf8');
      const dates = [...content.matchAll(/^\| (\d{4}-\d{2}-\d{2}) \|/gm)].map(m => m[1]);
      for (let i = 1; i < dates.length; i++) {
        if (dates[i] > dates[i - 1]) {
          console.error('WARN: CHANGELOG.md 表格日期非倒序（新条目应插入表格顶部）');
          break;
        }
      }
    } catch {}
  }
  // W1-A: 每个节点合法 exit 必须满足前置 evidence（对应 flowkit.*.v1 的 evidence）
  // 语义与 missingRequiredSchemaEvidence 一致：summary 视同满足（record 命令默认只写 summary）
  const gate = NODE_TRANSITION_GATES[node.id];
  if (gate) {
    for (const ev of gate.evidence) {
      // T-FIX-05: subagent-execute 的 handoff-result gate 兼容共用证据库——委托结果记录在
      // 嵌套 handoffResult（键名契约 handoff-result vs handoffResult 错位），非空即满足
      // （存在性校验；每个委托内容的 Return Contract 严格校验由 W1-D 负责）
      const satisfied = hasEvidenceField(evidence, ev) ||
        (typeof evidence.summary === 'string' && evidence.summary.trim() !== '') ||
        (node.id === 'subagent-execute' && ev === 'handoff-result' && hasNonEmptyHandoffResult(evidence));
      if (!satisfied) {
        console.error('BLOCKED: node ' + node.id + ' exit requires evidence: ' + ev);
        process.exit(1);
      }
    }
  }
  // C3: exit execute / subagent-execute 校验 TASK.md 任务集签名未变（status 标记 done 合法已剥离；增删任务/改 action/改边界 BLOCKED）
  if ((node.id === 'execute' || node.id === 'subagent-execute') && state.activeChange) {
    if (typeof state.taskHash === 'string' && state.taskHash.length > 0) {
      const taskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
      if (await fileExists(taskFile)) {
        try {
          const currentHash = taskSetSignature(await fs.readFile(taskFile, 'utf8'));
          if (currentHash !== state.taskHash) {
            console.error('BLOCKED: TASK.md 任务集被修改（签名不匹配），execute 期间不允许增删任务/改 action/改边界');
            process.exit(1);
          }
        } catch {}
      }
    }
  }
  // P1-A: open exit 校验 REQUIREMENT 含 AC 段（段名基准从 REQUIREMENT 模板派生，模板缺失 fallback 内置段名）
  if (node.id === 'open' && state.activeChange) {
    const reqFile = path.join(runRoot, '.specs', state.activeChange, 'REQUIREMENT.md');
    try {
      const content = await fs.readFile(reqFile, 'utf8');
      const acceptance = (await templateSectionPatterns()).pick('requirement', ['验收'], TEMPLATE_FALLBACK_SECTION_PATTERNS.requirementAcceptance);
      if (!acceptance.test(content) && !/Given/i.test(content)) {
        console.error('BLOCKED: REQUIREMENT.md 缺少验收标准/AC 段');
        process.exit(1);
      }
    } catch {}
  }
  // P1-A: design exit 校验 DESIGN 含技术栈段
  if (node.id === 'design' && state.activeChange) {
    const designFile = path.join(runRoot, '.specs', state.activeChange, 'DESIGN.md');
    const designLite = path.join(runRoot, '.specs', state.activeChange, 'DESIGN-lite.md');
    const target = (await fileExists(designFile)) ? designFile : (await fileExists(designLite)) ? designLite : null;
    if (target) {
      try {
        const content = await fs.readFile(target, 'utf8');
        if (!/##\s*0[\s.]/.test(content) && !/##\s*技术栈/.test(content)) {
          console.error('BLOCKED: DESIGN.md 缺少 §0 技术栈段');
          process.exit(1);
        }
      } catch {}
    }
  }
  // C2: open exit 补必填段校验（结构+存在级，不做语义）——CHANGE.md 含 Why 段；REQUIREMENT.md 含 用户故事 段
  if (node.id === 'open' && state.activeChange) {
    const changeDir = path.join(runRoot, '.specs', state.activeChange);
    // 段名基准从 flow-kit 模板派生（CHANGE 模板 "## Why（为什么做）"、REQUIREMENT 模板 "## 用户故事"），模板缺失 fallback
    const tpl = await templateSectionPatterns();
    const required = [
      ['CHANGE.md', tpl.pick('change', ['Why', '为什么'], TEMPLATE_FALLBACK_SECTION_PATTERNS.changeWhy)],
      ['REQUIREMENT.md', tpl.pick('requirement', ['用户故事'], TEMPLATE_FALLBACK_SECTION_PATTERNS.requirementUserStory)],
    ];
    for (const [file, regex] of required) {
      const p = path.join(changeDir, file);
      if (await fileExists(p)) {
        try {
          const text = await fs.readFile(p, 'utf8');
          if (!regex.test(text)) {
            console.error('BLOCKED: ' + file + ' 缺必填段 ' + regex);
            process.exit(1);
          }
        } catch {}
      }
    }
  }
  // C2: design exit 补必填段校验——DESIGN.md 含 ## 决策清单（段名基准从 DESIGN 模板派生，"## 1. 决策清单" 编号前缀可选）
  if (node.id === 'design' && state.activeChange) {
    const designFile = path.join(runRoot, '.specs', state.activeChange, 'DESIGN.md');
    const designLite = path.join(runRoot, '.specs', state.activeChange, 'DESIGN-lite.md');
    const target = (await fileExists(designFile)) ? designFile : (await fileExists(designLite)) ? designLite : null;
    if (target) {
      try {
        const text = await fs.readFile(target, 'utf8');
        const decisionList = (await templateSectionPatterns()).pick('design', ['决策清单'], TEMPLATE_FALLBACK_SECTION_PATTERNS.designDecisionList);
        if (!decisionList.test(text)) {
          console.error('BLOCKED: DESIGN.md 缺必填段 ## 决策清单');
          process.exit(1);
        }
      } catch {}
    }
  }
  // P1-A: plan exit 校验 TASK 含 task 块和 verify 字段
  if (node.id === 'plan' && state.activeChange) {
    const taskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
    try {
      const content = await fs.readFile(taskFile, 'utf8');
      const taskBlocks = content.match(/<task[\s\S]*?<\/task>/g) || [];
      if (taskBlocks.length === 0) {
        console.error('BLOCKED: TASK.md 无 <task> 块');
        process.exit(1);
      }
      const missingVerify = taskBlocks.filter(b => !/<verify>/.test(b));
      if (missingVerify.length > 0) {
        console.error('BLOCKED: TASK.md 中 ' + missingVerify.length + ' 个 task 缺 <verify> 字段');
        process.exit(1);
      }
    } catch {}
  }
  // P1-A: review exit 校验 REVIEW 含实质内容 + L3-1（T-FIX-15）发现区条目处置状态结构级校验
  if (node.id === 'review' && state.activeChange) {
    const reviewFile = path.join(runRoot, '.specs', state.activeChange, 'REVIEW.md');
    try {
      const stat = await fs.stat(reviewFile);
      if (stat.size < 100) {
        console.error('BLOCKED: REVIEW.md 内容不足（' + stat.size + ' 字节，需 ≥ 100）');
        process.exit(1);
      }
      // L3-1: 发现项（含 Minor）须有处置状态标记——[已修]（对应 fix 任务）/ [升级]（用户决策：
      // 接受+理由）/ [转待办]（归档时进 KNOWN-ISSUES）。结构级校验，WARN 渐进不 BLOCK：
      // 旧 REVIEW 未按新格式写标记只警告不阻断（防旧 REVIEW 卡死），执行者补标记后可消除。
      const missingDisposition = reviewFindingsMissingDisposition(await fs.readFile(reviewFile, 'utf8'));
      if (missingDisposition.length > 0) {
        console.error('REVIEW WARN: REVIEW.md 发现区 ' + missingDisposition.length +
          ' 项条目缺处置状态标记（[已修]/[升级]/[转待办]）: ' + missingDisposition.join('、') +
          '——未处置的发现（含 Minor）不应无声消失，补标记后本警告消除（渐进不阻断）');
      }
    } catch {}
  }
  // W1-B: execute / subagent-execute 出口校验每份 SUMMARY 含三个必填段 + 6 维自查非空 + 自检方法
  if (node.id === 'execute' || node.id === 'subagent-execute') {
    const changeDir = path.join(runRoot, '.specs', state.activeChange ?? '');
    const violations = await verifySummaries(changeDir);
    // brooks-lint 自检方法审计：检查 6 维自查段是否声明了自检方法
    const summaryFiles = (await fs.readdir(changeDir).catch(() => [])).filter(f => f.endsWith('-SUMMARY.md'));
    for (const f of summaryFiles) {
      try {
        const content = await fs.readFile(path.join(changeDir, f), 'utf8');
        // 段终止 lookahead 用 \n##\s（而非 \n##）：###/#### 级子标题（如 "### 🟢 R1"）是段内内容，不是段结束
        const sixDim = content.match(/##\s*6\s*维自查[\s\S]*?(?=\n##\s|\n---|\Z)/i);
        // C1: 6 维自查段非空——去掉所有标题行后剩余实质内容 ≥ 10 字符
        // 按行过滤标题（/^\s*#/）比正则替换稳健：任何标题格式（emoji 🟢/中英文/数字）都不计入内容
        const dimBody = sixDim ? sixDim[0].split('\n').filter(l => !/^\s*#/.test(l)).join('').trim() : '';
        if (sixDim && dimBody.length < 10) {
          violations.push(f + ' 的 6 维自查段无实质内容');
        }
        // 生产代码任务必填 ## 自检方法，声明 brooks-review 或 builtin-quickcheck
        // 格式兼容：方法名行允许中文前缀/括号说明（如 "方法：brooks-review"），按关键词搜索而非 [a-z-]+ 硬匹配
        // 分隔符用 .?（任意字符）而非 \.?（字面点）：canonical 名 "brooks-review"/"builtin-quickcheck" 是连字符，与既有 /brooks.?review/ 约定一致
        // S97（dogfood 实证）：方法名可能在段内后续行（子代理列表写法）——段内全文搜索而非仅第一行
        // 段内容截取到下一个段标题（\n## ）或分隔线（\n---）或文件尾（split 处理,避免 JS 无 \Z 的问题）
        const methodMatch = content.match(/##\s*自检方法\s*\n([\s\S]*)/i);
        const methodSection = methodMatch ? methodMatch[1].split(/\n##\s|\n---/)[0] : null;
        const method = methodSection ? /brooks.?review|cache.?brooks|builtin.?quickcheck/i.exec(methodSection) : null;
        if (!method) {
          // 过渡规则：旧格式 SUMMARY 无 ## 自检方法 段——
          // 若全文已声明 brooks-review/cache-brooks/builtin（旧模板行为），WARN 兼容不 BLOCKED；无任何自检声明才 BLOCKED
          if (/brooks.?review|cache.?brooks|builtin.?quickcheck/i.test(content)) {
            console.error('BROOKS-LINT WARN: ' + f + ' 缺 ## 自检方法 段（旧格式），6 维自查已声明自检方法——兼容通过，建议补全');
          } else {
            violations.push(f + ' 缺 ## 自检方法 字段（必须声明 brooks-review 或 builtin-quickcheck）');
          }
        } else if (/builtin/i.test(method[0])) {
          // builtin 降级两级校验——① 必须声明不可用原因（既有）；② 必须含缓存尝试证据
          // （已尝试 Read 插件缓存协议文件手动执行仍不可行——两级降级路径第 2 级；防「未尝试读缓存」的偷懒降级）
          // 关键词声明级校验（设计边界：不做语义判断）；缺失 → WARN 渐进（不 BLOCK，向后兼容旧 SUMMARY）
          if (!/brooks-lint 不可用|插件不可用|unavailable|N\/A/i.test(content)) {
            console.error('BROOKS-LINT WARN: ' + f + ' 使用 builtin-quickcheck 但未声明 brooks-lint 不可用原因');
          } else if (!/插件缓存|缓存协议|协议文件|plugins\/cache/i.test(content)) {
            console.error('BROOKS-LINT WARN: ' + f + ' 使用 builtin-quickcheck 但未声明缓存尝试证据（应先 Read 插件缓存协议文件手动执行完整 brooks 流程）');
          }
        }
        if (sixDim && !/brooks.?review|cache.?brooks/i.test(sixDim[0])) {
          console.error('BROOKS-LINT WARN: ' + f + ' 的 6 维自查未声明使用 /brooks-review（可能使用了内置快查）');
        }
      } catch {}
    }
    if (violations.length > 0) {
      console.error('BLOCKED: SUMMARY 关键段校验失败: ' + violations.join('; '));
      process.exit(1);
    }
  }
  // execute 出口校验——统一委托后所有 done 任务需 handoff（越俎代庖检测覆盖串行/并行）
  if (node.id === 'execute' && state.activeChange) {
    const taskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
    try {
      const taskContent = await fs.readFile(taskFile, 'utf8');
      // 解析 TASK.md 全部 task 的 {id, status, parallel}
      const taskBlocks = taskContent.match(/<task[^>]*>[\s\S]*?<\/task>/g) || [];
      const tasks = taskBlocks.map(block => ({
        id: (block.match(/id="([^"]+)"/) || [])[1] || null,
        status: (block.match(/status="([^"]+)"/) || [])[1] || null,
        parallel: /parallel="true"/.test(block),
      })).filter(t => t.id);

      // 串行 pending → BLOCKED（execute 任务没做完）
      const serialPending = tasks.filter(t => !t.parallel && t.status !== 'done');
      if (serialPending.length > 0) {
        console.error('BLOCKED: execute 出口仍有串行 pending 任务: ' + serialPending.map(t => t.id).join(', '));
        process.exit(1);
      }

      // KI-8: done 任务 ↔ <id>-SUMMARY.md 存在（WARN 渐进不 BLOCK——防旧 change 卡死；
      // 结构级校验与 TASK 签名同源：任务完成声明须有对应产物）
      const ki8ChangeDir = path.join(runRoot, '.specs', state.activeChange ?? '');
      for (const tid of tasks.filter(t => t.status === 'done').map(t => t.id)) {
        if (!(await fileExists(path.join(ki8ChangeDir, tid + '-SUMMARY.md')))) {
          console.error('WARN: done 任务 ' + tid + ' 缺少 ' + tid + '-SUMMARY.md——execute 产物不完整（任务完成须有对应 SUMMARY）');
        }
      }

      // 豁免机制：evidence（当前节点 execute）含 parallelTakeoverApproved: true 时跳过越俎代庖检测（只保留串行 pending 检测）
      const executeEvidence = state.evidence['execute'];
      const takeoverApproved = !!(executeEvidence && executeEvidence.parallelTakeoverApproved);

      if (!takeoverApproved) {
        // 越俎代庖检测按 executionMode 分支：
        // - direct（逃生口）：串行任务主代理直写，不需 handoff；parallel 仍必须委托（防 execute 吞 parallel 回归）
        // - subagent（默认）：所有 done 任务需 handoff（统一委托下只能由子代理完成）
        const executionMode = state.executionMode ?? 'subagent';
        const he = state.evidence['subagent-execute'];
        const results = he && he.handoffResult ? he.handoffResult : {};
        let unauthorized;
        if (executionMode === 'direct') {
          unauthorized = tasks.filter(t => t.parallel && t.status === 'done' && !results[t.id]);
        } else {
          unauthorized = tasks.filter(t => t.status === 'done' && !results[t.id]);
        }
        if (unauthorized.length > 0) {
          console.error('BLOCKED: 任务被主代理直接标记 done（越俎代庖）' + (executionMode === 'direct' ? '，direct 模式下 parallel 任务仍必须委托子代理' : '，统一委托下只能由子代理完成并记录 handoff') + ': ' + unauthorized.map(t => t.id).join(', '));
          console.error('解决: 回退这些任务的 done 标记，重新委托子代理；或用 workflow-state.mjs record execute \'{"parallelTakeoverApproved":true}\' 显式豁免');
          process.exit(1);
        }
        // parallel 仍 pending → 合法（下一步 determineNode 路由到 subagent-execute）
      }

      // KI-10: 越权委托检测（execute 出口第一道）——TASK 有 parallel done 任务 +
      // completedNodes 无 subagent-execute + 非 direct 模式 + 协议含 subagent-execute 节点
      // → WARN 渐进（[P] 任务应由 subagent-execute 节点委托——execute 阶段完成 [P] 是
      // 越权委托痕迹；handoff 记录存在但节点未 exit——上轮 dogfood 实证 L-039）
      const ki10ParallelDone = tasks.filter(t => t.parallel && t.status === 'done').map(t => t.id);
      const ki10ProtocolHasSubagent = (protocol.nodes ?? []).some(n => n.id === 'subagent-execute');
      if (ki10ParallelDone.length > 0
          && !(state.completedNodes ?? []).includes('subagent-execute')
          && (state.executionMode ?? 'subagent') !== 'direct'
          && !takeoverApproved
          && ki10ProtocolHasSubagent) {
        console.error('WARN: TASK 有 parallel done 任务（' + ki10ParallelDone.join(', ')
          + '）但 subagent-execute 节点未 exit——疑似 execute 阶段越权委托，[P] 任务应由 subagent-execute 节点委托');
      }
    } catch {}
  }
  // W1-C: verify 出口必须真实跑命令（严格版）——历史归档 change 豁免（过渡规则）
  if (node.id === 'verify' && !(await isArchivedChange(state.activeChange))) {
    // KI-9: 越权委托兜底检测（verify 出口）——同 KI-10 判定（TASK parallel done +
    // completedNodes 无 subagent-execute + 非 direct + 协议含 subagent-execute 节点）,
    // verify 时仍未 exit → WARN 兜底（execute 出口未拦截的提示）
    try {
      const ki9TaskText = await fs.readFile(path.join(runRoot, '.specs', state.activeChange ?? '', 'TASK.md'), 'utf8');
      const ki9TaskBlocks = [...ki9TaskText.matchAll(/<task\b[^>]*>[\s\S]*?<\/task>/g)].map(m => m[0]);
      const ki9Tasks = ki9TaskBlocks.map(block => ({
        id: (block.match(/id="([^"]+)"/) || [])[1] || null,
        status: (block.match(/status="([^"]+)"/) || [])[1] || null,
        parallel: /parallel="true"/.test(block),
      })).filter(t => t.id);
      const ki9ParallelDone = ki9Tasks.filter(t => t.parallel && t.status === 'done').map(t => t.id);
      const ki9ProtocolHasSubagent = (protocol.nodes ?? []).some(n => n.id === 'subagent-execute');
      const ki9TakeoverApproved = !!(state.evidence?.execute && state.evidence.execute.parallelTakeoverApproved);
      if (ki9ParallelDone.length > 0
          && !(state.completedNodes ?? []).includes('subagent-execute')
          && (state.executionMode ?? 'subagent') !== 'direct'
          && !ki9TakeoverApproved
          && ki9ProtocolHasSubagent) {
        console.error('WARN: TASK 有 parallel done 任务（' + ki9ParallelDone.join(', ')
          + '）但 subagent-execute 节点未 exit——疑似越权委托（execute 出口未拦截,verify 兜底提示）');
      }
    } catch {}
    const { execSync } = await import('child_process');
    let verifyCommand = null;
    // 1) TEST.md 的 ## 验证命令 段（首行代码块首行）
    const testDoc = path.join(runRoot, '.specs', state.activeChange ?? '', 'TEST.md');
    if (await fileExists(testDoc)) {
      const text = await fs.readFile(testDoc, 'utf8');
      const m = text.match(/##\s*验证命令\s*\n\s*```[^\n]*\n([\s\S]*?)```/);
      if (m) verifyCommand = m[1].trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).join(' && ');
    }
    // 2) state 的 verifyCommand
    if (!verifyCommand && state.verifyCommand) verifyCommand = state.verifyCommand;
    // 3) 项目探测回退
    if (!verifyCommand) {
      if (await fileExists(path.join(runRoot, 'pingpong-tournament', 'pyproject.toml'))) verifyCommand = 'cd pingpong-tournament && python -m pytest tests/ -q';
      else if (await fileExists(path.join(runRoot, 'frontend', 'package.json'))) verifyCommand = 'cd frontend && npm test';
    }
    if (!verifyCommand) {
      console.error('BLOCKED: TEST.md 需声明 ## 验证命令 段（严格版要求）');
      process.exit(1);
    }
    // T-FIX-19: verify 命令 timeout 可配置——FLOW_COMET_VERIFY_TIMEOUT_MS 环境变量优先，
    // 缺省 300000ms（300s；赛事系统后端测试耗时可超 300s，用 env 调大）；非数字/0 → 回退缺省
    const verifyTimeoutMs = Number.parseInt(process.env.FLOW_COMET_VERIFY_TIMEOUT_MS ?? '300000', 10) || 300000;
    try {
      execSync(verifyCommand, { cwd: runRoot, stdio: 'pipe', timeout: verifyTimeoutMs });
    } catch (e) {
      // verify-fail 自动递增（无需 LLM 主动调用）
      state.verifyFailures = (state.verifyFailures || 0) + 1;
      const file = await statePath(protocol);
      const bad = validateStateFields(state);
      if (bad.length) { console.error('BLOCKED: state 字段类型非法: ' + bad[0]); process.exit(1); }
      await writeJson(file, state);
      if (state.verifyFailures >= 4) {
        console.error('BLOCKED: verify 已失败 ' + state.verifyFailures + ' 次，需用户决策（继续修/停止）。');
      } else {
        // stdout 为空（如超时被 kill 时 stdout 是空 Buffer——truthy）→ 显示错误消息；
        // 消息中带实际应用的 timeout（超时可诊断，且与 Node 版本无关）
        const detail = (e.stdout && e.stdout.length) ? e.stdout : e.message;
        console.error('BLOCKED: verify 命令失败（timeout ' + verifyTimeoutMs + 'ms）: ' + verifyCommand + '\n' + String(detail).slice(0, 500));
        console.error('VERIFY-FAIL: ' + state.verifyFailures + '/3');
      }
      process.exit(1);
    }
  }
  // W1-D: Return Contract 校验——每个 delegated task 的 result 必须含 commitHash + greenEvidence
  // handoff-guarded 落实——每个 result 的 completedChecks 必须包含
  // required-skill:subagent-execute.<skill>（skill 名从协议 requiredSkillCalls 读）。
  // 严格模式：旧格式非 JSON result（无 completedChecks 载体）同样 BLOCKED，无旧 change 豁免——
  // 补录/重录必须回传完整契约（含 completedChecks），不允许历史格式绕过委托证明
  if (node.id === 'subagent-execute') {
    const he = state.evidence['subagent-execute'];
    const results = he && he.handoffResult ? he.handoffResult : {};
    const requiredChecks = (node.requiredSkillCalls ?? [])
      .map((binding) => 'required-skill:' + node.id + '.' + binding.skill);
    const violations = [];
    for (const [taskId, rec] of Object.entries(results)) {
      const r = typeof rec.result === 'object' && rec.result !== null ? rec.result : null;
      if (!r) { violations.push(taskId + ' 非 Return Contract（旧格式，缺 completedChecks）'); continue; }
      if (!r.commitHash) violations.push(taskId + ' 缺 commitHash');
      if (!r.greenEvidence || !r.greenEvidence.command) violations.push(taskId + ' 缺 greenEvidence');
      // P2-B: redEvidence 缺失警告（过渡期不阻断）
      if (r && !r.redEvidence) {
        console.error('HANDOFF WARN: ' + taskId + ' 缺 redEvidence（可能未执行 TDD RED 阶段）');
      }
      // completedChecks 严格校验（无旧 change 豁免）
      if (requiredChecks.length > 0) {
        const checks = Array.isArray(r.completedChecks) ? r.completedChecks : [];
        const missing = requiredChecks.filter((check) => !checks.includes(check));
        if (missing.length > 0) {
          violations.push(taskId + ' 缺 completedChecks: ' + missing.join(', '));
        }
      }
    }
    if (violations.length > 0) {
      console.error('BLOCKED: Return Contract 校验失败: ' + violations.join('; '));
      process.exit(1);
    }
  }
  // D4: exit 协议声明标记校验——节点 exit 时扫描 .specs/<change-id>/.skill-loads/ 下该节点标记
  // （<node>-*.json，执行者加载节点 skill 后经 skill-load 写入，含 protocol 字段——指向
  // flow-kit/prompts/ 协议文件，只读引用），校验至少一个标记的 protocol ∈ 该节点协议集（D7 映射表）。
  // 缺失 → BLOCKED（提示缺协议声明标记 + 指引 skill-load --prompt）；有 → 通过。
  // 诚实边界：标记是执行者的自我声明——校验只确认「声明存在且 protocol 归属节点」，
  // 无法证明执行者真的阅读了协议（声明非物理证明，仅保证协议阅读声明可追溯）。
  // D6 兼容：旧 change/旧 evidence 不追溯——.skill-loads/ 目录不存在（该 change 从未运行过
  // skill-load，声明机制未激活）→ 跳过校验；节点已 exit 不重验（校验只在当前 exit 时执行）；
  // 节点重新 exit（重入后再退）时按新规则要求，无豁免。
  if (state.activeChange && NODE_PROTOCOL_FILES[node.id]) {
    // T-FIX-04: 标记目录活动/归档双路径解析（archive 节点「先移目录后 exit」顺序下标记只在
    // 归档路径——单查活动路径会误报「机制未激活」静默放行）；两处皆无才走 D6 旧 change 兼容
    const loadsDir = await findSkillLoadsDir(runRoot, state.activeChange);
    if (loadsDir) {
      const prefix = node.id + '-';
      const protocolSet = NODE_PROTOCOL_FILES[node.id];
      const markers = (await fs.readdir(loadsDir.dir).catch(() => []))
        .filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
      const malformed = [];
      let declared = false;
      for (const f of markers) {
        try {
          const marker = JSON.parse(await fs.readFile(path.join(loadsDir.dir, f), 'utf8'));
          // T-FIX-01: 比对 basename——新格式（skill-load 写入 basename）与旧格式（完整绝对路径）
          // 经 markerProtocolBasename 提取后统一比对；损坏值（null/非字符串/超集外 basename）
          // 提取为 null 或不匹配 → 不进 declared，fail-closed
          if (marker && typeof marker === 'object' && protocolSet.includes(markerProtocolBasename(marker.protocol))) {
            declared = true;
            break;
          }
        } catch {
          malformed.push(f);
        }
      }
      if (!declared) {
        console.error('BLOCKED: 节点 ' + node.id + ' exit 缺协议声明标记——' + loadsDir.display +
          ' 下需有 ' + prefix + '*.json 且 protocol ∈ [' + protocolSet.join(', ') +
          ']；执行 skill-load --prompt <flow-kit/prompts/ 协议文件> 声明已阅读协议（声明非物理证明，仅可追溯）' +
          (malformed.length > 0 ? '；不可解析标记: ' + malformed.join(', ') : ''));
        process.exit(1);
      }
    } else {
      // D6 过渡规则：旧 change 兼容——活动与归档路径均无声明标记目录（机制未激活）不追溯；
      // 首个 skill-load 写入后新规则生效（该 change 后续节点 exit 均需声明标记）
      console.error('SKILL-LOAD WARN: 旧 change 兼容——.specs/' + state.activeChange +
        '/.skill-loads/（活动与归档路径）不存在，协议声明校验跳过（机制未激活；首个 skill-load 后新规则生效）');
    }
  }
  // 自动补 required-skill completedChecks——节点被完成即视为其实现 skill 已加载
  if ((node.requiredSkillCalls ?? []).length > 0) {
    const checks = Array.isArray(evidence.completedChecks) ? evidence.completedChecks : [];
    for (const binding of node.requiredSkillCalls ?? []) {
      const check = 'required-skill:' + node.id + '.' + binding.skill;
      if (!checks.includes(check)) checks.push(check);
    }
    evidence.completedChecks = checks;
  }
  const missingSchemaEvidence = missingRequiredSchemaEvidence(protocol, node, evidence);
  if (missingSchemaEvidence.length > 0) {
    console.error('BLOCKED: missing Output Schema evidence: ' + missingSchemaEvidence.join(', '));
    process.exit(1);
  }
  const missingArtifacts = await missingRequiredArtifacts(protocol, node, state.activeChange);
  if (missingArtifacts.length > 0) {
    console.error('BLOCKED: missing Output Schema artifacts: ' + missingArtifacts.join(', '));
    process.exit(1);
  }
  const missingRequired = missingRequiredSkillChecks(node, evidence);
  if (missingRequired.length > 0) {
    console.error('BLOCKED: missing required Skill evidence: ' + missingRequired.join(', '));
    process.exit(1);
  }
  const missingAugmentations = missingAugmentationChecks(node, evidence);
  if (missingAugmentations.length > 0) {
    console.error('BLOCKED: missing augmentation evidence: ' + missingAugmentations.join(', '));
    process.exit(1);
  }
  if (apply) {
    const completed = completedSet(state);
    completed.add(node.id);
    // W2-A: verify exit --apply 成功 → verifyFailures 清零
    if (node.id === 'verify') state.verifyFailures = 0;
    state.completedNodes = route(protocol).filter((item) => completed.has(item.id)).map((item) => item.id);
    // archive 节点完成后 change 已归档 → 清空活跃 change（flow-comet 回到无活跃状态）
    const isArchive = node.id === 'archive';
    if (isArchive) state.activeChange = null;
    let next = isArchive ? null : nextNode(protocol, state);
    // parallel-aware 路由——如果下一候选是 execute，检查 TASK.md 是否有依赖已满足的 pending parallel 任务
    // 有则路由到 subagent-execute（与 workflow-state.mjs 的 determineNode 逻辑一致）
    if (next && next.id === 'execute' && state.activeChange) {
      const taskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
      try {
        const taskContent = await fs.readFile(taskFile, 'utf8');
        // 收集所有 done 任务的 id
        const doneIds = new Set((taskContent.match(/<task[^>]*id="([^"]+)"[^>]*status="done"/g) || [])
          .map(m => { const id = m.match(/id="([^"]+)"/); return id ? id[1] : null; })
          .filter(Boolean));
        // 检查 pending parallel 任务中是否有依赖已满足的
        const parallelBlocks = taskContent.match(/<task[^>]*parallel="true"[^>]*status="pending"[\s\S]*?<\/task>/g) || [];
        //  (P3): 路由无匹配时输出诊断——结构校验保持严格（不放松正则），检测失败纠偏可见
        // 旧模板（task 标签无 status 属性）产出的 TASK.md 无法匹配——明确提示而非静默卡在 execute
        if (parallelBlocks.length === 0 && /<task[^>]*parallel="true"/.test(taskContent)) {
          console.error('ROUTE WARN: 未找到 parallel="true" status="pending" 的任务块——检查 task 标签属性（属性顺序：parallel 在 status 前；缺 status 不视为 pending）');
        }
        const eligibleParallel = parallelBlocks.filter(block => {
          const depsMatch = block.match(/<depends_on>([\s\S]*?)<\/depends_on>/);
          if (!depsMatch || !depsMatch[1].trim()) return true;
          const deps = depsMatch[1].trim().split(/[,\s]+/).filter(Boolean);
          return deps.every(d => doneIds.has(d));
        });
        if (eligibleParallel.length > 0) {
          const subagentNode = findNode(protocol, 'subagent-execute');
          if (subagentNode && !completed.has('subagent-execute')) {
            next = subagentNode;
          }
        }
      } catch {}
    }
    state.currentNode = isArchive ? null : (next?.id ?? null);
    state.status = next ? 'running' : 'completed';
    state.history = Array.isArray(state.history) ? state.history : [];
    state.history.push({ event: 'exit-applied', node: node.id, at: new Date().toISOString() });
    const bad = validateStateFields(state);
    if (bad.length) { console.error('BLOCKED: state 字段类型非法: ' + bad[0]); process.exit(1); }
    await writeJson(file, state);
    console.log('ALL CHECKS PASSED');
    printNext(protocol, next);
    return;
  }
  console.log('ALL CHECKS PASSED');
  console.log('APPLY: rerun with --apply to update workflow state');
}

main().then(() => {
  // 成功路径末尾输出 WARN COUNT 汇总（用未包装的 console.error——避免自增）
  if (__warnCount > 0) __origError('WARN COUNT: ' + __warnCount);
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
