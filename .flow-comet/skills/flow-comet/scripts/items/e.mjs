// items/e.mjs — E 组条目（自定义协议）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 组内夹具与条目同址；跨组共用夹具从 a.mjs / k.mjs 取（组文件之间单向，无环）。

import fs from 'fs';
import path from 'path';
import { assertExit, assertNotOut, assertOut, runGuard, runState, writeFile } from '../lib/test-helpers.mjs';
import { readStateFile } from './a.mjs';

// 自定义协议（compose-demo）：3 节点 brainstorm/tdd/codereview（避开内置 8 节点 id）——
// 协议数据化路由 + 通用层防线对自定义节点生效；无 writeWhitelist（hook 回退内置缺省表）
function customProtocol() {
  return {
    schemaVersion: 1,
    kind: 'workflow-kernel',
    name: 'compose-demo',
    goal: '系统测试自定义协议：数据化路由 + 声明机制 + 通用层防线。',
    nodes: [
      {
        id: 'brainstorm',
        label: 'Brainstorm',
        kind: 'control',
        responsibility: '产出 notes.md。',
        outputSchemas: ['compose.notes.v1'],
        requiredSkillCalls: [],
        augmentations: [],
        disabled: false,
      },
      {
        id: 'tdd',
        label: 'TDD',
        kind: 'control',
        responsibility: '产出 *-SUMMARY.md。',
        outputSchemas: ['compose.tdd.v1'],
        requiredSkillCalls: [],
        augmentations: [],
        disabled: false,
      },
      {
        id: 'codereview',
        label: 'Code Review',
        kind: 'control',
        responsibility: '产出 verdict.md。',
        outputSchemas: ['compose.verdict.v1'],
        requiredSkillCalls: [],
        augmentations: [],
        disabled: false,
      },
    ],
    outputSchemas: [
      {
        id: 'compose.notes.v1',
        description: 'notes.md',
        artifacts: [
          {
            id: 'notes',
            kind: 'file',
            required: true,
            paths: ['<change-id>/notes.md'],
            pathBase: 'specs-root',
          },
        ],
        evidence: [{ id: 'notes-summary', required: true }],
      },
      {
        id: 'compose.tdd.v1',
        description: '*-SUMMARY.md',
        artifacts: [
          {
            id: 'summaries',
            kind: 'file',
            required: true,
            paths: ['<change-id>/*-SUMMARY.md'],
            pathBase: 'specs-root',
          },
        ],
        evidence: [{ id: 'tdd-summary', required: true }],
      },
      {
        id: 'compose.verdict.v1',
        description: 'verdict.md',
        artifacts: [
          {
            id: 'verdict',
            kind: 'file',
            required: true,
            paths: ['<change-id>/verdict.md'],
            pathBase: 'specs-root',
          },
        ],
        evidence: [{ id: 'verdict-summary', required: true }],
      },
    ],
    state: {
      kind: 'workflow-run',
      statePath: '.flow-comet/flow-comet-state.json',
      currentNodeField: 'currentNode',
      completedNodesField: 'completedNodes',
      evidenceField: 'evidence',
    },
    edges: [],
  };
}

// 含 requiredSkillCalls 的变体：brainstorm 带 main scope 绑定（协调者加载 → 需 skill-load 声明标记）
function customProtocolWithSkillCall() {
  const p = customProtocol();
  p.nodes[0].requiredSkillCalls = [{ skill: 'flow-comet-brainstorm', scope: 'main' }];
  return p;
}

// 写入自定义协议文件，返回绝对路径
function writeCustomProtocol(dir, withSkillCall = false) {
  const proto = withSkillCall ? customProtocolWithSkillCall() : customProtocol();
  const file = path.join(dir, withSkillCall ? 'custom-protocol-skill.json' : 'custom-protocol.json');
  fs.writeFileSync(file, JSON.stringify(proto, null, 2) + '\n', 'utf8');
  return file;
}

export const ENTRIES = [
  // ---------- E. 自定义协议 ----------

  {
    name: 'E1 自定义协议：加载路由与节点推导',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      // init 按协议首节点
      const init = runState(['init', 'cp-demo', '--protocol', custom], dir);
      assertExit(init, 0);
      assertOut(init, 'NODE: brainstorm');
      const st = readStateFile(dir);
      if (st.currentNode !== 'brainstorm') throw new Error('init currentNode 应为协议首节点 brainstorm');
      // 无产物 → 首节点；仅 notes.md → 第二节点；产物齐全 → 最后节点
      const s1 = runState(['status', '--protocol', custom], dir);
      assertExit(s1, 0);
      assertOut(s1, '"currentNode": "brainstorm"');
      writeFile(dir, '.specs/cp-demo/notes.md', '# notes\n');
      const s2 = runState(['status', '--protocol', custom], dir);
      assertExit(s2, 0);
      assertOut(s2, '"currentNode": "tdd"');
      writeFile(dir, '.specs/cp-demo/T01-SUMMARY.md', '# T01-SUMMARY\n');
      writeFile(dir, '.specs/cp-demo/verdict.md', '# verdict\n');
      const s3 = runState(['status', '--protocol', custom], dir);
      assertExit(s3, 0);
      assertOut(s3, '"currentNode": "codereview"');
    },
  },

  {
    name: 'E2 自定义协议：声明机制与出口全链路（含技能绑定）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir, true);
      assertExit(runState(['init', 'cp-skill', '--protocol', custom], dir), 0);
      const env = { FLOW_COMET_PROTOCOL: custom };
      // 自定义节点 skill-load 声明（协议节点集合动态校验）
      const sl = runState(['skill-load', 'brainstorm', 'flow-comet-brainstorm'], dir, env);
      assertExit(sl, 0);
      assertOut(sl, 'SKILL-LOAD: brainstorm flow-comet-brainstorm');
      // 自定义节点 record（main scope 绑定 + 声明标记 → 通过）
      const rec = runState(['record', 'brainstorm', JSON.stringify({ summary: 'brainstorm done', completedChecks: ['required-skill:brainstorm.flow-comet-brainstorm'] })], dir, env);
      assertExit(rec, 0);
      assertOut(rec, 'EVIDENCE: brainstorm');
      // 出口：产物齐 + 诱饵内置工件缺段 → 通过且不误触发内置特化校验
      writeFile(dir, '.specs/cp-skill/notes.md', '# notes\n');
      writeFile(dir, '.specs/cp-skill/CHANGE.md', '# CHANGE\n\n## 变更目标\n\n## 方案\n');
      writeFile(dir, '.specs/cp-skill/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 需求分析\n');
      assertExit(runGuard(['entry', 'brainstorm'], dir, env), 0);
      const exitRes = runGuard(['exit', 'brainstorm', '--apply'], dir, env);
      assertExit(exitRes, 0);
      assertOut(exitRes, 'ALL CHECKS PASSED');
      assertNotOut(exitRes, '缺必填段');
      assertNotOut(exitRes, '缺少验收标准');
      const st = readStateFile(dir);
      if (!st.completedNodes.includes('brainstorm') || st.currentNode !== 'tdd') {
        throw new Error('apply 后应完成 brainstorm 并推进到 tdd: ' + JSON.stringify({ completedNodes: st.completedNodes, currentNode: st.currentNode }));
      }
      // 协议 env 加载（无 --protocol CLI）同样生效
      const envLoad = runGuard(['exit', 'bogus'], dir, env);
      assertExit(envLoad, 1);
      assertOut(envLoad, 'Unknown workflow Node');
    },
  },

];
