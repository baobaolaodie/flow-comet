// items/f.mjs — F 组条目（自动初始化）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 跨组共用夹具在 lib/system-fixtures.mjs（组文件只承载 ENTRIES 数据与组内私有夹具，组文件之间零 import）。

import fs from 'fs';
import path from 'path';
import { assertExit, assertNotOut, assertOut, baseState, runState, writeFile, writeState } from '../lib/test-helpers.mjs';
import { CHANGE_ID, readStateFile } from '../lib/system-fixtures.mjs';

// CONTEXT 7 段完整模板（通过校验的形态）
const CONTEXT_FULL =
  '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n' +
  '## 已锁决策\n- [2026-08-01] 决策一\n## 默认偏好\nx\n## 既有抽象索引\nx\n' +
  '## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n';

export const ENTRIES = [
  // ---------- F. 自动初始化 ----------

  {
    name: 'F1 初始化检测：上下文缺失提示且不自动生成',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID], dir);
      assertExit(res, 0);
      assertOut(res, 'INIT-NEEDED');
      if (fs.existsSync(path.join(dir, '.specs', 'CONTEXT.md'))) {
        throw new Error('CONTEXT 不应由脚本自动生成（生成职责在 agent）');
      }
    },
  },

  {
    name: 'F2 初始化检测：跳过记忆',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      const first = runState(['init', CHANGE_ID, '--init-skip'], dir);
      assertExit(first, 0);
      assertOut(first, 'INIT-SKIPPED');
      const st1 = readStateFile(dir);
      if (st1.ai_context_doc !== 'none') throw new Error('跳过后 ai_context_doc 应为 none');
      // 下次 init（新 id）尊重既有决策 → 静默
      const second = runState(['init', CHANGE_ID + '-2'], dir);
      assertExit(second, 0);
      assertNotOut(second, 'INIT-NEEDED');
      assertNotOut(second, 'INIT-HINT');
    },
  },

  {
    name: 'F3 初始化检测：新鲜上下文静默',
    run: (dir) => {
      writeState(dir, { ...baseState('open'), last_intel_scan: new Date(Date.now() - 10 * 864e5).toISOString() });
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runState(['init', CHANGE_ID], dir);
      assertExit(res, 0);
      assertNotOut(res, 'INIT-NEEDED');
      assertNotOut(res, 'INIT-HINT');
      assertOut(res, 'Initialized: ' + CHANGE_ID);
    },
  },

  {
    name: 'F4 初始化检测：生成协作全链路',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      // ① 缺失 + 授权 → 生成指引，不生成不写扫描时间
      const gen = runState(['init', CHANGE_ID, '--init-context'], dir);
      assertExit(gen, 0);
      assertOut(gen, 'INIT-GENERATE');
      if (fs.existsSync(path.join(dir, '.specs', 'CONTEXT.md'))) throw new Error('CONTEXT 不应由脚本生成');
      let st = readStateFile(dir);
      if (st.last_intel_scan) throw new Error('校验通过前不应写扫描时间');
      // ② agent 生成 7 段模板后重跑 → 校验通过 + 记录扫描时间
      writeFile(dir, '.specs/CONTEXT.md', CONTEXT_FULL);
      const done = runState(['init', CHANGE_ID, '--init-context'], dir);
      assertExit(done, 0);
      assertOut(done, 'INIT-DONE');
      st = readStateFile(dir);
      if (!st.last_intel_scan) throw new Error('校验通过后应写扫描时间');
      // ③ 已存在但缺段 → 重写指引，不记录新扫描时间（保持既有）
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const failed = runState(['init', CHANGE_ID, '--init-context'], dir);
      assertExit(failed, 0);
      assertOut(failed, 'INIT-VALIDATE-FAILED');
      assertOut(failed, '重写');
    },
  },

];
