// protocol-utils.mjs: 工作流协议文件（workflow-protocol.json）的统一解析 / 受保护读取 / schema 校验模块
// 批次 D T01：供 workflow-state.mjs / workflow-guard.mjs / comet-hook-guard.mjs 三脚本共用，
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

// ---------- 受保护文件读取（复制自 comet-hook-guard.mjs，与各脚本各自内联的风格一致） ----------

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
  // 审查补充（2026-08-08）：nodes 元素结构校验——空对象/缺 id 的 node 会在
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
