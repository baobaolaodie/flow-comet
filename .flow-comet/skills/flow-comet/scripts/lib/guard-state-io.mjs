// 运行上下文 + 受保护状态 I/O（守卫模块）。
//
// 运行上下文（runRoot / packageRoot / 协议路径绑定）是本模块的**单一来源**：各守卫模块不再各自
// 从环境变量推导同一事实——两份推导会在形态变化时静默分叉。
//
// 受保护读写通道（路径段判据 → 逐段目录校验 → 快照复核 → 唯一临时名原子落盘）在写入前与落盘前
// 都复核目标未被替换；任何一步不符即抛错（fail-closed），绝不退化为尽力而为的写。
//
// statePath / readStateJson / writeJson 是标准运行时状态文件的唯一读写入口。

import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RUNTIME_STATE_PATH, LEGACY_RUNTIME_STATE_PATH } from '../state-schema.mjs';
import {
  inspectWorkflowProtectedPath,
  readWorkflowProtectedFile,
  workflowFileObjectIdentity,
  workflowPathInside,
  workflowSameFileObject,
  workflowSameFileStat,
} from '../protocol-utils.mjs';

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
// 技能包根：scripts/lib → scripts → skills/flow-comet（协议默认路径与包内资源以此为基准）
export const packageRoot = path.resolve(scriptsRoot, '..', '..');
export const runRoot = process.env.FLOW_COMET_RUN_ROOT
  ? path.resolve(process.env.FLOW_COMET_RUN_ROOT)
  : process.cwd();

// 协议路径解析：显式 --protocol 全局参数（command=argv[2] 之后的剩余参数）> state.protocolPath
// （init 持久化绑定）> FLOW_COMET_PROTOCOL 环境变量 > 内置默认。选择在入口 main() 内执行
// （state.protocolPath 需先读标准运行时状态文件引导，协议决定 statePath 时存在先后次序），
// 本模块只持有解析结果供错误文案与后续模块读取。
export let protocolPath = null;

export function setProtocolPath(value) {
  protocolPath = value;
}

export const WORKFLOW_PROJECT_FILE_MAX_BYTES = 2 * 1024 * 1024;

export async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export function workflowRelativeSegments(value, label, allowWildcards = false) {
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

export function resolveWorkflowRelativePath(base, value, label, allowWildcards = false) {
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

// 组装 statePath 失效错误：声明的字段值 + 实际解析出的绝对路径 + 跨命名空间探测 + 调整指引。
// 交叉探测的两个命名空间取值来自 state-schema.mjs 的运行时路径常量（单一来源，本模块不硬编码）；
// 探测只读、只改善错误措辞，不参与路径解析，也不改变控制流（绝不回退到另一命名空间，fail-closed
// 语义不变）。探测基准 = statePath 所在目录的父目录（项目根布局下即项目根）；该基准落在项目外时
// 回落到项目根，保证探测点不越出项目。探测失败一律按"未探测到"处理，不掩盖主错误。
export async function statePathMissingError(declared, target) {
  const lines = [
    'workflow-run statePath does not exist: ' + declared + ' (resolved to ' + target + ')',
  ];
  const parent = path.resolve(path.dirname(target), '..');
  const probeBase = workflowPathInside(runRoot, parent) ? parent : runRoot;
  const declaredNormalized = declared.replaceAll('\\', '/');
  const elsewhere = [];
  for (const candidate of [LEGACY_RUNTIME_STATE_PATH, RUNTIME_STATE_PATH]) {
    if (candidate === declaredNormalized) continue;
    if (await fileExists(path.resolve(probeBase, ...candidate.split('/')))) elsewhere.push(candidate);
  }
  if (elsewhere.length > 0) {
    lines.push(
      'hint: a state file exists in the other runtime namespace (' + elsewhere.join(', ') +
        ') — the project may not be migrated yet; run the installer (prepare-env) to finish the migration, or correct the statePath field',
    );
  }
  lines.push(
    'fix: edit "state.statePath" in the workflow protocol JSON (' + protocolPath +
      ') — the value must be the state file path relative to the project root (current runtime namespace: ' +
      RUNTIME_STATE_PATH + ')',
  );
  const error = new Error(lines.join('\n'));
  error.code = 'ENOENT';
  return error;
}

export async function statePath(protocol) {
  const preferred = String(protocol.state?.statePath ?? '');
  const target = resolveWorkflowRelativePath(
    runRoot,
    preferred,
    'workflow-run statePath',
  ).target;
  const inspection = await inspectWorkflowProtectedPath(
    runRoot,
    target,
    'workflow-run statePath',
    'file',
  );
  if (!inspection.exists) {
    throw await statePathMissingError(preferred, target);
  }
  return target;
}

export async function readStateJson(file) {
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

export async function writeJson(file, value) {
  await writeWorkflowProtectedFile(
    runRoot,
    file,
    'workflow-run state',
    JSON.stringify(value, null, 2) + '\n',
    WORKFLOW_PROJECT_FILE_MAX_BYTES,
  );
}
