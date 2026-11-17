#!/usr/bin/env node
// 发布面取值核对：dsh 桥接 loader 的版本戳必须与安装版本标识一致。
//
// 为什么不用正则直接扫源码：
//  - 只扫文本时，写在块注释里的同名行也会被匹配（node --check 照样通过）——那会让发布门
//    在「导出其实是注释」时静默放行；
//  - 反过来，只认单引号形态会把合法的等价写法（双引号 / 无分号）判成缺失，误拦正确版本。
// 故：先剥掉块注释再取两处取值，形态容忍引号差异，注释掉的内容不再算数。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgePath = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
const installedPath = path.join(repoRoot, '.flow-comet', 'skills', 'flow-comet', 'INSTALLED_VERSION');

const stripped = readFileSync(bridgePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const stamp = /^\/\/ BRIDGE_VERSION: (\S+)$/m.exec(stripped)?.[1] ?? '';
const exported = /^export const version\s*=\s*['"]([^'"]+)['"];?$/m.exec(stripped)?.[1] ?? '';
const installed = readFileSync(installedPath, 'utf8').trim();

const problems = [];
if (!stamp) problems.push('桥接 loader 的 BRIDGE_VERSION 标记行缺失（或只存在于注释中）');
if (!exported) problems.push('桥接 loader 的 export const version 缺失（或只存在于注释中）');
if (stamp && exported && stamp !== exported) problems.push(`标记行(${stamp}) 与导出常量(${exported}) 不一致`);
if (stamp && installed && stamp !== installed) problems.push(`标记行(${stamp}) 与 INSTALLED_VERSION(${installed}) 不一致`);

console.log(`BRIDGE_VERSION=${stamp || '(missing)'} EXPORTED=${exported || '(missing)'} INSTALLED_VERSION=${installed}`);
if (problems.length) {
  console.error('发布面版本核对失败: ' + problems.join('；'));
  process.exit(1);
}
console.log('发布面版本核对通过: 桥接标记行 / 导出常量 / 安装版本标识 三处一致');