// E1 分支模式辅助族（单一归属）：git 仓库检测、分支名与分支存在性、状态行的分支一致性提示。
import { execFileSync } from 'child_process';
import { runRootDir } from './state-io.mjs';

// git 仓库检测：`git rev-parse --is-inside-work-tree` 成功且输出 true
export function isInsideWorkTree() {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: runRootDir(), stdio: 'pipe', encoding: 'utf8' });
    return String(out).trim() === 'true';
  } catch {
    return false;
  }
}

// 当前分支名；非 git 仓库 / detached HEAD 失败 → null
export function gitBranchName() {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: runRootDir(), stdio: 'pipe', encoding: 'utf8' });
    return String(out).trim() || null;
  } catch {
    return null;
  }
}

// 分支是否存在（本地分支）
export function branchExists(name) {
  try {
    const out = execFileSync('git', ['branch', '--format', '%(refname:short)'], { cwd: runRootDir(), stdio: 'pipe', encoding: 'utf8' });
    return String(out).split('\n').map(s => s.trim()).includes(name);
  } catch {
    return false;
  }
}

// E1: status/next 追加分支信息——BRANCH: <当前分支> | 一致性: ok|mismatch
// mismatch（activeChange 存在但当前分支不是 <前缀><activeChange>）→ WARN 不 BLOCK；非 git 仓库 → BRANCH: none
export function printBranchLine(activeChange, branchPrefix = 'change/') {
  const branch = gitBranchName();
  if (branch === null) {
    console.log('BRANCH: none');
    return;
  }
  const expected = branchPrefix + activeChange;
  const consistent = branch === expected;
  console.log('BRANCH: ' + branch + ' | 一致性: ' + (consistent ? 'ok' : 'mismatch'));
  if (!consistent) {
    console.error('WARN: 分支与 activeChange 不一致——先 git checkout ' + expected + ' 再继续');
  }
}
