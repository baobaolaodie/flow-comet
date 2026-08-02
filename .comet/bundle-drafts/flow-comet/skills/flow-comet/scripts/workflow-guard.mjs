#!/usr/bin/env node
  import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const command = process.argv[2] ?? 'verify';
const nodeId = process.argv[3] ?? null;
const apply = process.argv.includes('--apply');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const runRoot = process.env.COMET_RUN_ROOT ? path.resolve(process.env.COMET_RUN_ROOT) : process.cwd();
const protocolPath = path.join(packageRoot, 'reference', 'workflow-protocol.json');


const WORKFLOW_PROJECT_CONFIG_MAX_BYTES = 64 * 1024;
const WORKFLOW_PROJECT_FILE_MAX_BYTES = 2 * 1024 * 1024;

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
      ).toString('utf8'),
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

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function readStateJson(file) {
  return JSON.parse(
    (
      await readWorkflowProtectedFile(
        runRoot,
        file,
        'workflow-run state',
        WORKFLOW_PROJECT_FILE_MAX_BYTES,
      )
    ).toString('utf8'),
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

function schemaMap(protocol) {
  return new Map((protocol.outputSchemas ?? []).map((schema) => [schema.id, schema]));
}

function missingRequiredSchemaEvidence(protocol, node, evidence) {
  const schemas = schemaMap(protocol);
  const missing = [];
  for (const schemaId of node.outputSchemas ?? []) {
    const schema = schemas.get(schemaId);
    for (const field of schema?.evidence ?? []) {
      if (field.required && !hasEvidenceField(evidence, field.id)) {
        missing.push(schemaId + '.' + field.id);
      }
    }
  }
  return missing;
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

async function missingRequiredArtifacts(protocol, node) {
  const schemas = schemaMap(protocol);
  const missing = [];
  for (const schemaId of node.outputSchemas ?? []) {
    const schema = schemas.get(schemaId);
    for (const artifact of schema?.artifacts ?? []) {
      if (!artifact.required) continue;
      const exists = (
        await Promise.all(
          (artifact.paths ?? []).map(async (artifactPath) =>
            pathPatternExists(await workflowPathBaseRoot(artifact.pathBase), artifactPath),
          ),
        )
      ).some(Boolean);
      if (!exists) missing.push(schemaId + '.' + artifact.id);
    }
  }
  return missing;
}

async function main() {
  const protocol = await readJson(protocolPath);
  if (protocol.schemaVersion !== 1 || !Array.isArray(protocol.nodes)) {
    throw new Error('workflow-protocol.json must use the current schema with nodes');
  }
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
    const missingArtifacts = await missingRequiredArtifacts(protocol, node);
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
    console.log('ENTRY OK: ' + node.id);
    return;
  }
  const evidence = evidenceFor(state, node.id);
  if (!evidence) {
    console.error('BLOCKED: missing evidence for Node ' + node.id + '.');
    process.exit(1);
  }
  const missingSchemaEvidence = missingRequiredSchemaEvidence(protocol, node, evidence);
  if (missingSchemaEvidence.length > 0) {
    console.error('BLOCKED: missing Output Schema evidence: ' + missingSchemaEvidence.join(', '));
    process.exit(1);
  }
  const missingArtifacts = await missingRequiredArtifacts(protocol, node);
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
    state.completedNodes = route(protocol).filter((item) => completed.has(item.id)).map((item) => item.id);
    const next = nextNode(protocol, state);
    state.currentNode = next?.id ?? null;
    state.status = next ? 'running' : 'completed';
    state.history = Array.isArray(state.history) ? state.history : [];
    state.history.push({ event: 'exit-applied', node: node.id, at: new Date().toISOString() });
    await writeJson(file, state);
    console.log('ALL CHECKS PASSED');
    printNext(protocol, next);
    return;
  }
  console.log('ALL CHECKS PASSED');
  console.log('APPLY: rerun with --apply to update workflow state');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
