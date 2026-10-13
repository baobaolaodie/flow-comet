// items/l.mjs — L 组条目（执行遗漏防护）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 组内夹具与条目同址；跨组共用夹具从 a.mjs / k.mjs 取（组文件之间单向，无环）。

import { execFileSync, spawnSync } from 'child_process';
import { assertExit, assertNotOut, assertOut, baseState, runGuard, runState, writeFile, writeState } from '../lib/test-helpers.mjs';
import { CHANGE_ID, gitInit, readStateFile, writeIntakeArtifacts } from './a.mjs';

export const ENTRIES = [
  // ---------- L. 执行遗漏防护（真实链路） ----------

  {
    name: 'L1 进入证据:entry 记录 enteredNodes,正常流程 exit 无误报',
    run: (dir) => {
      gitInit(dir);
      assertExit(runState(['init', CHANGE_ID, '--init-skip'], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      assertExit(runState(['skill-load', 'design', 'flow-comet-design', '--prompt', 'flow-kit/prompts/2-design.md'], dir), 0);
      writeIntakeArtifacts(dir);
      // ① entry open 记录进入标记
      assertExit(runGuard(['entry', 'open'], dir), 0);
      const st = readStateFile(dir);
      if (!Array.isArray(st.enteredNodes) || !st.enteredNodes.includes('open')) {
        throw new Error('entry 未记录 enteredNodes: ' + JSON.stringify(st.enteredNodes));
      }
      // ② 未 entry 直接 exit(构造:跳过 design 的 entry,state 已激活)→ ENTER WARN 渐进
      assertExit(runState(['record', 'open', '{"summary":"intake complete"}'], dir), 0);
      assertExit(runGuard(['exit', 'open', '--apply'], dir), 0);
      // 推进到 design 后不 entry 直接 exit?→ currentNode 检查会拦;验证 enter 证据在真实链路不误报
      assertExit(runGuard(['entry', 'design'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 0. 技术栈\n\npython\n\n## 决策清单\n\n- [ ] D1\n');
      assertExit(runState(['record', 'design', '{"summary":"design done"}'], dir), 0);
      const rDesign = runGuard(['exit', 'design', '--apply'], dir);
      assertExit(rDesign, 0);
      assertNotOut(rDesign, 'ENTER WARN');
    },
  },

  {
    name: 'L2 空退出豁免:显式 emptyExitApproved 后全 parallel execute 通过',
    run: (dir) => {
      gitInit(dir);
      // fixture state(currentNode=execute + enter 机制激活)+ 真实命令序列:
      // 全 parallel 任务在 plan exit 后正常路由 subagent-execute(M6 豁免用于已进入 execute 且无串行可做的场景)
      const taskAllParallel = '# TASK\n\n<task id="P01" parallel="true" status="pending"><action>p</action><write_files>a</write_files><verify>t</verify><done>d</done></task>\n';
      // ① 显式豁免 → 空退出通过
      const st = baseState('execute');
      st.enteredNodes = ['open', 'design', 'plan'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskAllParallel);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      assertExit(runState(['record', 'execute', '{"summary":"no serial tasks","emptyExitApproved":true}'], dir), 0);
      const r = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(r, 0);
      assertOut(r, 'ALL CHECKS PASSED');
      // ② 无豁免 → 仍 BLOCKED(默认防规划错误)
      const st2 = baseState('execute');
      st2.enteredNodes = ['open', 'design', 'plan'];
      writeState(dir, st2);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskAllParallel);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      assertExit(runState(['record', 'execute', '{"summary":"no serial tasks"}'], dir), 0);
      const r2 = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(r2, 1);
      assertOut(r2, 'BLOCKED');
    },
  },

  {
    name: 'L3 空仓库:init 在无提交仓库输出 EMPTY-REPO 提示',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); // 无提交
      const r = runState(['init', CHANGE_ID, '--init-skip'], dir);
      assertExit(r, 0);
      assertOut(r, 'EMPTY-REPO');
    },
  },

];
