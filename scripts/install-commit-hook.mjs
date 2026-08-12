#!/usr/bin/env node
/**
 * install-commit-hook.mjs — 安装本项目 git hook(commit-msg + pre-push)
 *
 * 原理:设置 core.hooksPath → 本仓库 .githooks/(hook 文件在仓库内,更新随 pull 生效,
 *       无需重新安装;克隆后执行一次即可)。
 * 幂等:已指向本仓库 .githooks 则提示已安装;重复执行无副作用。
 *
 * 用法:node scripts/install-commit-hook.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const HOOKS_DIR = path.join(REPO_ROOT, '.githooks');

const REQUIRED = ['commit-msg', 'pre-push', 'internal-codes.mjs'];
for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(HOOKS_DIR, f))) {
    console.error(`[install-commit-hook] 缺少 hook 文件: .githooks/${f}`);
    process.exit(1);
  }
}

const current = execFileSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' }).trim();
// 绝对路径(正斜杠)写入——Windows 反斜杠与 shell 转义问题
const target = path.join(REPO_ROOT, '.githooks').replace(/\\/g, '/');

if (current) {
  const currentResolved = path.resolve(REPO_ROOT, current.replace(/\\/g, '/'));
  if (currentResolved === path.resolve(REPO_ROOT, '.githooks')) {
    console.log('[install-commit-hook] core.hooksPath 已指向本仓库 .githooks(幂等,无需改动)');
    process.exit(0);
  }
  console.log(`[install-commit-hook] 当前 core.hooksPath = ${current}(非本仓库 hook),将覆盖为 .githooks`);
}
execFileSync('git', ['config', 'core.hooksPath', target]);
console.log(`[install-commit-hook] 已设置 core.hooksPath → ${target}`);
console.log('[install-commit-hook] commit-msg + pre-push 生效:提交/推送信息含内部词(过程代号)将被阻止');
