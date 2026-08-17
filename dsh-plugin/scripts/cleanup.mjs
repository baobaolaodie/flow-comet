#!/usr/bin/env node
// dsh-flow-comet 显式卸载清理通道。
//
// 用户决策 A：dsh plugin remove 只移除 bundle 层，不 boot、不加载插件、不运行 disposer。
// 因此必须先运行本脚本清理项目侧注入物，再执行 `dsh plugin remove dsh-flow-comet`。
//
// 清理内容：
//   1. 逐个 strip 注入项目 AGENTS.md 的 flow-comet 托管区（保留托管区外用户内容）；
//      剥离后若内容为空则删除 AGENTS.md（幂等容错 ENOENT），恢复注入前状态。
//   2. 移除 <项目根>/reference/.flow-comet-workflow-protocol.json 协议副本，
//      并清理空的 <项目根>/reference/ 目录（非空则跳过）。
//   3. 清空 $DSH_HOME/flow-comet-injected.json 注入记录；仅当全部项目清理成功时才清空，
//      失败项目保留在记录中以便修复后重试。
//
// 审计日志 $DSH_HOME/flow-comet-audit.jsonl 为 append-only 保留物，不自动删除；
// 最后一份注入记录清空时给出提示。

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  MANAGED_AGENTS_START,
  readInjectedState,
  resolveDshHome,
  stripManagedRegion,
  writeInjectedState,
} from '../index.js';

async function cleanupAgents(root) {
  const agentsPath = path.join(root, 'AGENTS.md');
  let agentsText = null;
  try {
    agentsText = await fs.readFile(agentsPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      agentsText = null;
    } else {
      console.warn(
        '[dsh-flow-comet] cleanup: WARN 读取 AGENTS.md 失败 ' + error.message,
      );
      return { ok: false };
    }
  }

  if (agentsText === null || !agentsText.includes(MANAGED_AGENTS_START)) {
    console.log(
      '[dsh-flow-comet] cleanup: 跳过 AGENTS.md（不存在或无托管区） ' + agentsPath,
    );
    return { ok: true };
  }

  const stripped = stripManagedRegion(agentsText);
  const output = stripped.trim() ? stripped.trim() + '\n' : '';

  if (output === '') {
    try {
      await fs.unlink(agentsPath);
      console.log('[dsh-flow-comet] cleanup: 已删除空 AGENTS.md ' + agentsPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        console.log(
          '[dsh-flow-comet] cleanup: 跳过删除 AGENTS.md（不存在） ' + agentsPath,
        );
      } else {
        console.warn(
          '[dsh-flow-comet] cleanup: WARN 删除空 AGENTS.md 失败 ' + error.message,
        );
        return { ok: false };
      }
    }
    return { ok: true };
  }

  try {
    await fs.writeFile(agentsPath, output, 'utf8');
    console.log('[dsh-flow-comet] cleanup: 已移除 AGENTS.md 托管区 ' + agentsPath);
    return { ok: true };
  } catch (error) {
    console.warn(
      '[dsh-flow-comet] cleanup: WARN 写入 AGENTS.md 失败 ' + error.message,
    );
    return { ok: false };
  }
}

async function removeProtocolCopy(root) {
  const protocolPath = path.join(
    root,
    'reference',
    '.flow-comet-workflow-protocol.json',
  );
  try {
    await fs.unlink(protocolPath);
    console.log('[dsh-flow-comet] cleanup: 已移除协议副本 ' + protocolPath);
    return { ok: true };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.log('[dsh-flow-comet] cleanup: 跳过协议副本（不存在） ' + protocolPath);
      return { ok: true };
    }
    console.warn(
      '[dsh-flow-comet] cleanup: WARN 移除协议副本失败 ' + error.message,
    );
    return { ok: false };
  }
}

async function removeEmptyReferenceDir(root) {
  const referenceDir = path.join(root, 'reference');
  try {
    await fs.rmdir(referenceDir);
    console.log('[dsh-flow-comet] cleanup: 已移除空 reference 目录 ' + referenceDir);
    return { ok: true };
  } catch (error) {
    const code = error && error.code;
    if (code === 'ENOENT') {
      console.log(
        '[dsh-flow-comet] cleanup: 跳过 reference 目录（不存在） ' + referenceDir,
      );
      return { ok: true };
    }
    if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'ENOTDIR') {
      console.log(
        '[dsh-flow-comet] cleanup: 跳过 reference 目录（非空或不可移除） ' + referenceDir,
      );
      return { ok: true };
    }
    console.warn(
      '[dsh-flow-comet] cleanup: WARN 清理 reference 目录失败 ' + error.message,
    );
    return { ok: false };
  }
}

async function main() {
  const dshHome = resolveDshHome();
  const state = await readInjectedState(dshHome);
  const hadProjects = state.projects.length > 0;

  if (!hadProjects) {
    console.log('[dsh-flow-comet] cleanup: 无注入项目记录，无需清理。');
    return;
  }

  const failedProjects = [];

  for (const project of state.projects) {
    const root = path.resolve(project.cwd);
    const agents = await cleanupAgents(root);
    const protocol = await removeProtocolCopy(root);
    const referenceDir = await removeEmptyReferenceDir(root);

    if (!agents.ok || !protocol.ok || !referenceDir.ok) {
      failedProjects.push(project);
    }
  }

  // 注入记录：仅全部成功才清空；有失败项目时保留它们以便重试。
  if (failedProjects.length === 0) {
    await writeInjectedState(dshHome, { version: 1, projects: [] });
    console.log('[dsh-flow-comet] cleanup: 注入记录已清空。');
  } else {
    await writeInjectedState(dshHome, { version: 1, projects: failedProjects });
    console.warn(
      '[dsh-flow-comet] cleanup: 存在清理失败项目，注入记录保留 ' +
        failedProjects.length +
        ' 项（可修复后重试）。',
    );
  }

  if (hadProjects) {
    console.log(
      '审计日志保留于 ' +
        path.join(dshHome, 'flow-comet-audit.jsonl') +
        '，如需删除请手动处理。',
    );
  }
}

main().catch((error) => {
  console.error('[dsh-flow-comet] cleanup 失败: ' + error.message);
  process.exit(1);
});
