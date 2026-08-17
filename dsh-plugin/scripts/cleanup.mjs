#!/usr/bin/env node
// dsh-flow-comet 显式卸载清理通道。
//
// 用户决策 A：dsh plugin remove 只移除 bundle 层，不 boot、不加载插件、不运行 disposer。
// 因此必须先运行本脚本清理项目侧注入物，再执行 `dsh plugin remove dsh-flow-comet`。
//
// 清理内容：
//   1. 逐个 strip 注入项目 AGENTS.md 的 flow-comet 托管区（保留托管区外用户内容）。
//   2. 移除 <项目根>/reference/.flow-comet-workflow-protocol.json 协议副本。
//   3. 清空 $DSH_HOME/flow-comet-injected.json 注入记录。
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

async function main() {
  const dshHome = resolveDshHome();
  const state = await readInjectedState(dshHome);
  const hadProjects = state.projects.length > 0;

  if (!hadProjects) {
    console.log('[dsh-flow-comet] cleanup: 无注入项目记录，无需清理。');
    return;
  }

  for (const project of state.projects) {
    const root = path.resolve(project.cwd);

    // 1. AGENTS.md 托管区剥离（幂等容错：文件缺失/无托管区则跳过）。
    const agentsPath = path.join(root, 'AGENTS.md');
    let agentsText = null;
    try {
      agentsText = await fs.readFile(agentsPath, 'utf8');
    } catch {
      agentsText = null;
    }
    if (agentsText !== null && agentsText.includes(MANAGED_AGENTS_START)) {
      const stripped = stripManagedRegion(agentsText);
      const output = stripped.trim() ? stripped.trim() + '\n' : '';
      await fs.writeFile(agentsPath, output, 'utf8');
      console.log('[dsh-flow-comet] cleanup: 已移除 AGENTS.md 托管区 ' + agentsPath);
    } else {
      console.log(
        '[dsh-flow-comet] cleanup: 跳过 AGENTS.md（不存在或无托管区） ' + agentsPath,
      );
    }

    // 2. 协议副本移除（幂等容错：不存在则跳过）。
    const protocolPath = path.join(
      root,
      'reference',
      '.flow-comet-workflow-protocol.json',
    );
    try {
      await fs.unlink(protocolPath);
      console.log('[dsh-flow-comet] cleanup: 已移除协议副本 ' + protocolPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        console.log('[dsh-flow-comet] cleanup: 跳过协议副本（不存在） ' + protocolPath);
      } else {
        console.warn(
          '[dsh-flow-comet] cleanup: WARN 移除协议副本失败 ' + error.message,
        );
      }
    }
  }

  // 3. 清空注入记录。
  await writeInjectedState(dshHome, { version: 1, projects: [] });
  console.log('[dsh-flow-comet] cleanup: 注入记录已清空。');

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
