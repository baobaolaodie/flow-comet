// items/i.mjs — I 组条目（异常路径）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 跨组共用夹具在 lib/system-fixtures.mjs（组文件只承载 ENTRIES 数据与组内私有夹具，组文件之间零 import）。

import fs from 'fs';
import path from 'path';
import { assertExit, assertOut, baseState, runGuard, runHandoff, runState, writeFile, writeState } from '../lib/test-helpers.mjs';
import { CHANGE_ID } from '../lib/system-fixtures.mjs';

export const ENTRIES = [
  // ---------- I. 异常路径 ----------

  {
    name: 'I1 异常路径：损坏状态文件 fail-closed',
    run: (dir) => {
      writeFile(dir, '.flow-comet/flow-comet-state.json', '{broken json');
      const res = runState(['status'], dir);
      assertExit(res, 1);
    },
  },

  {
    name: 'I2 异常路径：缺工件出口拦截',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      // 工件根目录存在但工件缺失 → 缺产物拦截（工件根缺失走更前置的路径基座报错）
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'missing Output Schema artifacts');
    },
  },

  {
    name: 'I3 异常路径：非法参数拒绝',
    run: (dir) => {
      // guard 缺节点 / 未知节点
      const noNode = runGuard(['exit'], dir);
      assertExit(noNode, 1);
      assertOut(noNode, 'exit requires a Node id.');
      const unknownNode = runGuard(['exit', 'bogus'], dir);
      assertExit(unknownNode, 1);
      assertOut(unknownNode, 'Unknown workflow Node: bogus');
      // state 未知命令
      const unknownCmd = runState(['bogus-cmd'], dir);
      assertExit(unknownCmd, 1);
      assertOut(unknownCmd, 'Unknown command');
      // state 无活跃项目
      const noActive = runState(['next'], dir);
      assertExit(noActive, 0);
      assertOut(noActive, 'No active change');
      // handoff 未知动作
      const badAction = runHandoff(['bogus'], dir);
      assertExit(badAction, 1);
      assertOut(badAction, 'Unknown action');
    },
  },

  {
    name: 'I4 异常路径：状态字段类型非法拦截',
    run: (dir) => {
      const st = baseState('open');
      st.currentNode = 123; // 类型非法（number）
      writeState(dir, st);
      // advance 先按文件推导重写 currentNode（漂移校正），写入时校验非法字段（completedNodes
      // 残留了数值条目）→ fail-closed 拦截——非法字段名随路径而异，断言通用消息
      const res = runState(['advance'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED: state 字段类型非法');
    },
  },

];
