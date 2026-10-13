// items/d.mjs — D 组条目（hook 写白名单）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 跨组共用夹具在 lib/system-fixtures.mjs（组文件只承载 ENTRIES 数据与组内私有夹具，组文件之间零 import）。

import path from 'path';
import { assertExit, assertOut, baseState, runHook, runState, writeState } from '../lib/test-helpers.mjs';
import { CHANGE_ID, readStateFile } from '../lib/system-fixtures.mjs';

export const ENTRIES = [
  // ---------- D. hook 写白名单 ----------

  {
    name: 'D1 hook：open 阶段工件放行与源码拦截',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      // 工件放行
      const ok = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', CHANGE_ID, 'CHANGE.md') } });
      assertExit(ok, 0);
      assertOut(ok, 'workflow-hook-guard-ok');
      assertOut(ok, 'NODE: open');
      // 源码拦截（exit 2）
      const blocked = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(blocked, 2);
      assertOut(blocked, 'BLOCKED: phase "open" 不允许写入');
    },
  },

  {
    name: 'D2 hook：execute 按执行模式收窄（direct 放宽）',
    run: (dir) => {
      // subagent 模式：execute 协调者只写 .specs/ → 写源码拦截
      const st = baseState('execute');
      st.status = 'running';
      writeState(dir, st);
      const blocked = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(blocked, 2);
      assertOut(blocked, 'BLOCKED: phase "execute" 不允许写入');
      // subagent 模式：写工件放行
      const ok = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', CHANGE_ID, 'T01-SUMMARY.md') } });
      assertExit(ok, 0);
      assertOut(ok, 'NODE: execute');
      // direct 模式（逃生口）：主代理直写源码放行
      const stDirect = readStateFile(dir);
      stDirect.executionMode = 'direct';
      stDirect.directOverride = true;
      writeState(dir, stDirect);
      const direct = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(direct, 0);
      assertOut(direct, 'workflow-hook-guard-ok');
    },
  },

  {
    name: 'D3 hook：归档阶段白名单与完成态放行',
    run: (dir) => {
      const st = baseState('archive');
      st.status = 'running';
      writeState(dir, st);
      // 归档路径放行
      const ok = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'archive', '2026-08-11-' + CHANGE_ID, 'CHANGE.md') } });
      assertExit(ok, 0);
      assertOut(ok, 'NODE: archive');
      // 归档流程写 change 目录工件(遗留清单 KNOWN-ISSUES.md 先写后移)放行——
      // 修复前白名单仅 .specs/archive/ 导致按文档流程被 BLOCK(此处应 RED)
      const okChange = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', CHANGE_ID, 'KNOWN-ISSUES.md') } });
      assertExit(okChange, 0);
      assertOut(okChange, 'NODE: archive');
      // 白名单收窄:归档阶段仅遗留清单可写——change 目录其他工件(如 TASK.md)应 BLOCK
      // (放宽到整个 change 目录会让归档阶段可改任意工件且无校验——防线变宽)
      const blockedArtifact = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', CHANGE_ID, 'TASK.md') } });
      assertExit(blockedArtifact, 2);
      assertOut(blockedArtifact, 'BLOCKED');
      // 归档阶段写源码拦截
      const blocked = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(blocked, 2);
      // 完成态（归档后，活跃项目已清空）→ 无活跃工作流放行
      const done = readStateFile(dir);
      done.status = 'completed';
      done.activeChange = null;
      done.currentNode = null;
      writeState(dir, done);
      const after = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'anything.md') } });
      assertExit(after, 0);
      assertOut(after, 'no active workflow');
    },
  },

];
