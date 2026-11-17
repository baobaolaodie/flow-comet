// items/e.mjs — E 组条目（自定义协议）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 跨组共用夹具在 lib/system-fixtures.mjs（组文件只承载 ENTRIES 数据与组内私有夹具，组文件之间零 import）。

import fs from 'fs';
import path from 'path';
import { assertExit, assertNotOut, assertOut, runGuard, runState, writeFile } from '../lib/test-helpers.mjs';
import { readStateFile } from '../lib/system-fixtures.mjs';

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

// 协议变体（绑定面三态；`enforcement` 是出口覆盖判据的单一开关）：
//   · base    —— 无 requiredSkillCalls：节点没有声明义务；
//   · skill   —— main scope 绑定、未登记等级：声明照旧由出口代记（required-skill 条目自动补写）；
//   · guarded —— main scope 绑定 + enforcement='guarded'：该技能必须自己有一条声明标记。
function customProtocolVariant(variant) {
  const p = customProtocol();
  if (variant === 'skill') {
    p.nodes[0].requiredSkillCalls = [{ skill: 'flow-comet-brainstorm', scope: 'main' }];
  } else if (variant === 'guarded') {
    p.nodes[0].requiredSkillCalls = [{ skill: 'flow-comet-brainstorm', scope: 'main', enforcement: 'guarded' }];
  } else if (variant !== 'base') {
    throw new Error('未知协议变体: ' + variant);
  }
  return p;
}

// 写入自定义协议文件（变体见上），返回绝对路径
function writeCustomProtocol(dir, variant = 'base') {
  const file = path.join(dir, variant === 'base' ? 'custom-protocol.json' : 'custom-protocol-' + variant + '.json');
  fs.writeFileSync(file, JSON.stringify(customProtocolVariant(variant), null, 2) + '\n', 'utf8');
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
    name: 'E2 自定义协议：声明机制与出口全链路（含技能绑定与 guarded 覆盖）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir, 'skill');
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

      // guarded 变体的出口覆盖判据（自定义协议路径）：协议把绑定登记为 enforcement='guarded' 时，
      // 出口要求该技能**各自**有声明标记——同节点上已声明的另一个技能不构成覆盖（record 只校验载荷里
      // 出现的 required-skill 条目，覆盖判据要的是「每个 guarded 绑定各有一条标记」）。
      // 对照：同一夹具换成未登记等级的绑定（skill 变体）时零该技能声明照样放行——等级是唯一开关。
      const guardedProtocol = writeCustomProtocol(dir, 'guarded');
      const guardedEnv = { FLOW_COMET_PROTOCOL: guardedProtocol };
      assertExit(runState(['init', 'cp-guard', '--replace', 'cp-skill', '--reason', '切换协议夹具（覆盖闸门显式放行）', '--protocol', guardedProtocol], dir), 0);
      assertExit(runState(['skill-load', 'brainstorm', 'flow-comet-tdd'], dir, guardedEnv), 0);
      assertExit(runState(['record', 'brainstorm', '{"summary":"brainstorm done"}'], dir, guardedEnv), 0);
      writeFile(dir, '.specs/cp-guard/notes.md', '# notes\n');
      assertExit(runGuard(['entry', 'brainstorm'], dir, guardedEnv), 0);
      const uncovered = runGuard(['exit', 'brainstorm'], dir, guardedEnv);
      assertExit(uncovered, 1);
      assertOut(uncovered, '缺协议声明标记');
      assertOut(uncovered, '缺必需技能声明: flow-comet-brainstorm');
      // 补上该绑定自己的标记 → 同一出口放行
      assertExit(runState(['skill-load', 'brainstorm', 'flow-comet-brainstorm'], dir, guardedEnv), 0);
      const covered = runGuard(['exit', 'brainstorm', '--apply'], dir, guardedEnv);
      assertExit(covered, 0);
      assertOut(covered, 'ALL CHECKS PASSED');
      assertNotOut(covered, '缺协议声明标记');
      // 对照：未登记等级的同一绑定 → 只声明别的技能也放行（覆盖判据不在这条路径上生效）
      const plainProtocol = writeCustomProtocol(dir, 'skill');
      const plainEnv = { FLOW_COMET_PROTOCOL: plainProtocol };
      assertExit(runState(['init', 'cp-plain', '--replace', 'cp-guard', '--reason', '切换协议夹具（覆盖闸门显式放行）', '--protocol', plainProtocol], dir), 0);
      assertExit(runState(['skill-load', 'brainstorm', 'flow-comet-tdd'], dir, plainEnv), 0);
      assertExit(runState(['record', 'brainstorm', '{"summary":"brainstorm done"}'], dir, plainEnv), 0);
      writeFile(dir, '.specs/cp-plain/notes.md', '# notes\n');
      assertExit(runGuard(['entry', 'brainstorm'], dir, plainEnv), 0);
      const ungated = runGuard(['exit', 'brainstorm'], dir, plainEnv);
      assertExit(ungated, 0);
      assertOut(ungated, 'ALL CHECKS PASSED');
      assertNotOut(ungated, '缺协议声明标记');
    },
  },

];
