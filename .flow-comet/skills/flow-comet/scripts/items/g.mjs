// items/g.mjs — G 组条目（分支模式）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 组内夹具与条目同址；跨组共用夹具从 a.mjs / k.mjs 取（组文件之间单向，无环）。

import { execFileSync, spawnSync } from 'child_process';
import { assertExit, assertOut, baseState, runGuard, runState, writeFile, writeState } from '../lib/test-helpers.mjs';
import { CHANGE_ID, gitBranch, gitInit } from './a.mjs';

export const ENTRIES = [
  // ---------- G. 分支模式 ----------

  {
    name: 'G1 分支模式：init 建分支与一致性',
    run: (dir) => {
      gitInit(dir);
      assertExit(runState(['init', 'g1-br'], dir), 0);
      if (gitBranch(dir) !== 'change/g1-br') throw new Error('期望分支 change/g1-br，实际 ' + gitBranch(dir));
      const status = runState(['status'], dir);
      assertExit(status, 0);
      assertOut(status, 'BRANCH: change/g1-br | 一致性: ok');
    },
  },

  {
    name: 'G2 分支模式：归档入口分支校验',
    run: (dir) => {
      gitInit(dir);
      const st = baseState('archive');
      st.branchMode = true;
      writeState(dir, st);
      // 非 change/<id> 分支 → 拦截
      const blocked = runGuard(['entry', 'archive'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, '归档必须在 change/' + CHANGE_ID + ' 分支上进行');
      // 切到正确分支 → 通过
      execFileSync('git', ['checkout', '-b', 'change/' + CHANGE_ID], { cwd: dir, stdio: 'ignore' });
      const ok = runGuard(['entry', 'archive'], dir);
      assertExit(ok, 0);
      assertOut(ok, 'ENTRY OK: archive');
    },
  },

  {
    name: 'G3 分支模式：一致性失配警告',
    run: (dir) => {
      gitInit(dir);
      execFileSync('git', ['checkout', '-b', 'topic-x'], { cwd: dir, stdio: 'ignore' });
      writeState(dir, { ...baseState('open'), branchPrefix: 'change/' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const status = runState(['status'], dir);
      assertExit(status, 0);
      assertOut(status, '一致性: mismatch');
      assertOut(status, 'WARN: 分支与 activeChange 不一致');
    },
  },

];
