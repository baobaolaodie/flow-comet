#!/usr/bin/env node
// system-test.mjs — flow-comet 系统测试集（与 guard-self-test 同构的载体，测试内容为系统级全链路）
//
// 定位：guard-self-test 是引擎脚本的单元/场景级回归（136 场景，fixture 构造为主）；
// 本套件是**系统级**测试——每个测试项走真实命令序列（init → record → guard exit → handoff →
// hook …），覆盖 flow-comet 全部机制面（A~L 十二类）：
//   A. 状态机与路由（init/status/next/select/advance/record/execution-mode/config）
//   B. 声明机制（skill-load 标记/record 校验/时间序/损坏 fail-closed/委托范围豁免/exit 协议标记/旧兼容）
//   C. 委托链路（handoff request/result/status、RED 先于 GREEN、Return Contract、证据键名契约）
//   D. hook 写白名单（open 阶段/execute 动态收窄/direct 放宽/归档阶段）
//   E. 自定义协议（--protocol/env 加载、自定义节点声明机制与出口、内置特化校验不误触发）
//   F. 自动初始化（缺失提示/跳过记忆/新鲜静默/生成协作全链路）
//   G. 分支模式（init 建分支/归档入口分支校验/一致性失配警告）
//   H. verify 与归档（验证命令真实执行 + 超时配置/完整归档流程/归档路径声明标记查找）
//   I. 异常路径（损坏状态/缺工件出口/非法参数/状态字段类型非法）
//   J. 文档一致性（双语健康检查/公开产物零代号检查——调用仓库本地工具）
//
// 载体（与 guard-self-test 同构）：每项 = 独立临时目录（fs.mkdtemp）+ 内置协议副本复制到
// <tmp>/reference/（受保护路径要求协议文件位于 runRoot 内）+ spawnSync 真实命令序列 +
// 断言退出码与输出关键词。测试项跑完 rmSync 清理。
//
// 输出纪律：逐项 PASS/FAIL + 汇总（SYSTEM TEST: N/M passed）；全过 exit 0，有 FAIL exit 1。
// 测试项命名与输出为公开面——零过程代号（场景编号/修复编号/批次/缺陷编号/未公开概念）。
//
// 运行: node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/system-test.mjs
// 仅 node 内置模块（child_process/fs/os/path）；无网络。

import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(__dirname, 'workflow-guard.mjs');
const STATE = path.join(__dirname, 'workflow-state.mjs');
const HOOK = path.join(__dirname, 'comet-hook-guard.mjs');
const HANDOFF = path.join(__dirname, 'workflow-handoff.mjs');
// 内置协议源文件（脚本所在技能包 reference/）：复制到 <tmp>/reference/ 内（受保护路径要求 runRoot 内）
const BUILTIN_PROTOCOL_SOURCE = path.join(__dirname, '..', 'reference', 'workflow-protocol.json');
const CHANGE_ID = 'ch';

let passed = 0;
const failures = [];
const createdDirs = [];

// ---------- 工具函数（与 guard-self-test 同构） ----------

function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-comet-system-test-'));
  createdDirs.push(dir);
  // 内置协议副本——真实项目协议位于 <项目根>/reference/workflow-protocol.json（runRoot 内）；
  // readProtocolFile 受保护路径要求协议文件在 runRoot 内，故复制进场景目录
  const builtinCopy = path.join(dir, 'reference', 'workflow-protocol.json');
  fs.mkdirSync(path.dirname(builtinCopy), { recursive: true });
  fs.copyFileSync(BUILTIN_PROTOCOL_SOURCE, builtinCopy);
  return dir;
}

function writeFile(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function writeState(root, state) {
  writeFile(root, path.posix.join('.comet', 'flow-comet-state.json'), JSON.stringify(state, null, 2) + '\n');
}

// 跑 workflow-state.mjs：runRoot = process.cwd()（spawn cwd=临时目录）；
// FLOW_COMET_PROTOCOL 默认指向场景内协议副本（envOverrides 可覆盖——自定义协议场景）
function runState(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [STATE, ...args], {
    cwd: root,
    env: {
      ...process.env,
      COMET_RUN_ROOT: root,
      FLOW_COMET_PROTOCOL: path.join(root, 'reference', 'workflow-protocol.json'),
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 workflow-guard.mjs：COMET_RUN_ROOT=临时目录；同时捕获 stdout+stderr（WARN/BLOCKED 走 stderr）
function runGuard(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: root,
    env: {
      ...process.env,
      COMET_RUN_ROOT: root,
      FLOW_COMET_PROTOCOL: path.join(root, 'reference', 'workflow-protocol.json'),
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 workflow-handoff.mjs：runRoot = process.cwd()
function runHandoff(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [HANDOFF, ...args], {
    cwd: root,
    env: { ...process.env, COMET_RUN_ROOT: root, ...envOverrides },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 comet-hook-guard.mjs：PreToolUse 事件从 stdin 传 JSON（{ tool_name, tool_input: { file_path } }）
function runHook(args, root, input, envOverrides = {}) {
  const res = spawnSync(process.execPath, [HOOK, ...args], {
    cwd: root,
    input: input === undefined ? '' : JSON.stringify(input),
    env: {
      ...process.env,
      COMET_RUN_ROOT: root,
      FLOW_COMET_PROTOCOL: path.join(root, 'reference', 'workflow-protocol.json'),
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

function assertExit(res, expected) {
  if (res.status !== expected) {
    throw new Error('期望 exit ' + expected + '，实际 exit ' + res.status + '\n实际输出:\n' + res.output);
  }
}

function assertOut(res, keyword) {
  if (!res.output.includes(keyword)) {
    throw new Error('输出缺少关键词 ' + JSON.stringify(keyword) + '（exit ' + res.status + '）\n实际输出:\n' + res.output);
  }
}

function assertNotOut(res, keyword) {
  if (res.output.includes(keyword)) {
    throw new Error('输出不应包含关键词 ' + JSON.stringify(keyword) + '（exit ' + res.status + '）\n实际输出:\n' + res.output);
  }
}

// 读取 state 文件（测试断言用）
function readStateFile(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.comet', 'flow-comet-state.json'), 'utf8'));
}

// git 工具：临时目录内初始化仓库（含初始 commit——unborn HEAD 下 init 不会建分支）
function gitInit(root) {
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: root, stdio: 'ignore' });
}

function gitBranch(root) {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

// ---------- 伪造材料 ----------

function baseState(node) {
  return {
    activeChange: CHANGE_ID,
    currentNode: node,
    completedNodes: [],
    evidence: {},
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
  };
}

// open 阶段工件（CHANGE 含 Why；REQUIREMENT 含 用户故事 + 验收准则——通过出口校验的完整形态）
function writeIntakeArtifacts(root, changeId = CHANGE_ID) {
  writeFile(root, '.specs/' + changeId + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\n\n变更目标。\n');
  writeFile(root, '.specs/' + changeId + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事（User Story）\n\n用户需求。\n\n## 验收准则（AC）\n\n- 通过标准\n');
}

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
      statePath: '.comet/flow-comet-state.json',
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

// CONTEXT 7 段完整模板（通过校验的形态）
const CONTEXT_FULL =
  '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n' +
  '## 已锁决策\n- [2026-08-01] 决策一\n## 默认偏好\nx\n## 既有抽象索引\nx\n' +
  '## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n';

// handoff 完整 Return Contract（W1-D 严格校验通过形态：commitHash + greenEvidence + completedChecks）
function fullContract(commitHash, taskId) {
  return JSON.stringify({
    status: 'DONE',
    taskId,
    commitHash,
    completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
    greenEvidence: { command: 'node --check src/' + taskId.toLowerCase() + '.mjs', output: 'ok' },
    redEvidence: { command: 'node --check src/' + taskId.toLowerCase() + '.mjs' },
  });
}

// 仓库本地验证工具执行（仅主仓存在、不随克隆分发；副本上文件缺失自动跳过）：
// 返回 { status, output }（spawnSync 原始结果 output 是数组，统一拼接成字符串供断言）
function runLocalTool(checker, repoRoot) {
  const res = spawnSync(process.execPath, [checker], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// ---------- 系统测试项（A~L 十二类） ----------

const TEST_ITEMS = [
  // ---------- A. 状态机与路由 ----------

  {
    name: 'A1 init：状态写入与工件目录创建',
    run: (dir) => {
      const res = runState(['init', CHANGE_ID], dir);
      assertExit(res, 0);
      assertOut(res, 'Initialized: ' + CHANGE_ID);
      assertOut(res, 'NODE: open');
      assertOut(res, 'BRANCH: none');
      const st = readStateFile(dir);
      if (st.activeChange !== CHANGE_ID) throw new Error('activeChange 应为 ' + CHANGE_ID);
      if (st.currentNode !== 'open') throw new Error('currentNode 应为 open: ' + JSON.stringify(st.currentNode));
      if (st.status !== 'running') throw new Error('status 应为 running');
      if (st.branchMode !== false) throw new Error('非 git 仓库 branchMode 应为 false');
      if (!fs.existsSync(path.join(dir, '.specs', CHANGE_ID))) throw new Error('.specs/<id>/ 目录未创建');
    },
  },

  {
    name: 'A2 init 分支模式：--branch-prefix 创建指定前缀分支',
    run: (dir) => {
      gitInit(dir);
      const res = runState(['init', 'br-test', '--branch-prefix', 'feat/'], dir);
      assertExit(res, 0);
      assertOut(res, 'BRANCH: feat/br-test');
      if (gitBranch(dir) !== 'feat/br-test') throw new Error('期望分支 feat/br-test，实际 ' + gitBranch(dir));
      const st = readStateFile(dir);
      if (st.branchPrefix !== 'feat/') throw new Error('branchPrefix 应为 feat/: ' + JSON.stringify(st.branchPrefix));
      // 分支一致性：status 显示 ok
      const status = runState(['status'], dir);
      assertExit(status, 0);
      assertOut(status, 'BRANCH: feat/br-test | 一致性: ok');
      // 非法前缀拒绝
      const bad = runState(['init', 'br-bad', '--branch-prefix', ''], dir);
      assertExit(bad, 1);
      assertOut(bad, '--branch-prefix requires a non-empty prefix');
    },
  },

  {
    name: 'A3 init 同 id 重跑：防护提示不阻断',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const res = runState(['init', CHANGE_ID], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: change ' + CHANGE_ID + ' 已存在');
      assertOut(res, '重置节点状态');
    },
  },

  {
    name: 'A4 status：节点推导与无活跃兜底',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      // 无产物 → 首节点
      const s1 = runState(['status'], dir);
      assertExit(s1, 0);
      assertOut(s1, '"currentNode": "open"');
      // 上游工件齐 → 推导下一节点
      writeIntakeArtifacts(dir);
      const s2 = runState(['status'], dir);
      assertExit(s2, 0);
      assertOut(s2, '"currentNode": "design"');
      // 无 state 无工件 → no-change 兜底
      fs.rmSync(path.join(dir, '.comet'), { recursive: true });
      const s3 = runState(['status'], dir);
      assertExit(s3, 0);
      assertOut(s3, '"status": "no-change"');
    },
  },

  {
    name: 'A5 next：推进与状态漂移校正',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      writeIntakeArtifacts(dir);
      assertExit(runState(['record', 'open', '{"summary":"intake complete"}'], dir), 0);
      // 真实出口：exit open --apply（未激活声明机制 → 兼容警告 + 通过）
      assertExit(runGuard(['entry', 'open'], dir), 0);
      const exitRes = runGuard(['exit', 'open', '--apply'], dir);
      assertExit(exitRes, 0);
      assertOut(exitRes, 'ALL CHECKS PASSED');
      let st = readStateFile(dir);
      if (!st.completedNodes.includes('open')) throw new Error('completedNodes 应含 open: ' + JSON.stringify(st.completedNodes));
      // 正常推进：next → design
      const n1 = runState(['next'], dir);
      assertExit(n1, 0);
      assertOut(n1, 'NODE: design');
      assertNotOut(n1, 'BLOCKED');
      // 漂移校正：手工把 currentNode 改回 open（已完成节点）→ next 以文件推导为准校正
      st = readStateFile(dir);
      st.currentNode = 'open';
      writeState(dir, st);
      const n2 = runState(['next'], dir);
      assertExit(n2, 0);
      assertOut(n2, 'NODE: design');
      const stAfter = readStateFile(dir);
      if (stAfter.currentNode !== 'design') throw new Error('漂移应被校正为 design: ' + JSON.stringify(stAfter.currentNode));
    },
  },

  {
    name: 'A6 next：未出口节点严格拦截',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runState(['next'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED: 疑似未 exit 节点 open');
      assertOut(res, 'workflow-guard.mjs exit open --apply');
    },
  },

  {
    name: 'A7 select：切换项目与缺失拒绝',
    run: (dir) => {
      assertExit(runState(['init', 'sel-a'], dir), 0);
      // 第二个活跃 change 目录（模拟多 change 并存）
      writeFile(dir, '.specs/sel-b/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runState(['select', 'sel-b'], dir);
      assertExit(res, 0);
      assertOut(res, 'Selected: sel-b');
      const st = readStateFile(dir);
      if (st.activeChange !== 'sel-b') throw new Error('activeChange 应为 sel-b: ' + JSON.stringify(st.activeChange));
      // 不存在的 change → 拒绝
      const missing = runState(['select', 'no-such'], dir);
      assertExit(missing, 1);
      assertOut(missing, 'Change not found');
    },
  },

  {
    name: 'A8 advance：节点推进',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      writeIntakeArtifacts(dir);
      const res = runState(['advance'], dir);
      assertExit(res, 0);
      assertOut(res, 'Advanced to: design');
      const st = readStateFile(dir);
      if (!st.completedNodes.includes('open')) throw new Error('completedNodes 应含 open: ' + JSON.stringify(st.completedNodes));
      if (st.currentNode !== 'design') throw new Error('currentNode 应为 design');
      // 无活跃 change → 提示不推进
      const st2 = readStateFile(dir);
      st2.activeChange = null;
      writeState(dir, st2);
      const none = runState(['advance'], dir);
      assertExit(none, 0);
      assertOut(none, 'No active change. Use select first.');
    },
  },

  {
    name: 'A9 record：基础证据记录',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      // JSON payload → evidence 写入 + next 提示
      const res = runState(['record', 'open', '{"summary":"recorded"}'], dir);
      assertExit(res, 0);
      assertOut(res, 'EVIDENCE: open');
      assertOut(res, 'NODE: open');
      const st = readStateFile(dir);
      if (!st.evidence.open || st.evidence.open.summary !== 'recorded') {
        throw new Error('record 未写入 evidence: ' + JSON.stringify(st.evidence));
      }
      if (typeof st.evidence.open.recordedAt !== 'string') throw new Error('evidence 应附带 recordedAt');
      // 非 JSON payload → 按 summary 字符串记录
      assertExit(runState(['record', 'open', 'plain text'], dir), 0);
      const st2 = readStateFile(dir);
      if (st2.evidence.open.summary !== 'plain text') throw new Error('非 JSON payload 应按 summary 记录');
      // --json-file:从文件读 JSON payload(规避 Windows PowerShell 引号剥离)
      fs.writeFileSync(path.join(dir, 'payload.json'), '{"summary":"from-file"}', 'utf8');
      const rf = runState(['record', 'open', '--json-file', 'payload.json'], dir);
      assertExit(rf, 0);
      const st3 = readStateFile(dir);
      if (st3.evidence.open.summary !== 'from-file') throw new Error('--json-file payload 未生效');
      // --json-file 越界路径(解析后出项目根)→ 拒绝(防读取任意文件进 evidence)
      const outsideFile = path.join(dir, '..', 'outside.json');
      fs.writeFileSync(outsideFile, '{"summary":"outside"}', 'utf8');
      const rfBad = runState(['record', 'open', '--json-file', outsideFile], dir);
      assertExit(rfBad, 1);
      assertOut(rfBad, '必须在项目根内');
      // 缺 node 参数 → 拒绝
      const noNode = runState(['record'], dir);
      assertExit(noNode, 1);
      assertOut(noNode, 'record requires a Node id.');
    },
  },

  {
    name: 'A10 execution-mode：direct 切换与记录',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const d = runState(['execution-mode', 'direct'], dir);
      assertExit(d, 0);
      assertOut(d, 'EXECUTION-MODE: direct (directOverride)');
      let st = readStateFile(dir);
      if (st.executionMode !== 'direct' || st.directOverride !== true) {
        throw new Error('direct 模式应记录 directOverride=true: ' + JSON.stringify({ executionMode: st.executionMode, directOverride: st.directOverride }));
      }
      const s = runState(['execution-mode', 'subagent'], dir);
      assertExit(s, 0);
      assertOut(s, 'EXECUTION-MODE: subagent');
      st = readStateFile(dir);
      if (st.executionMode !== 'subagent' || st.directOverride !== false) {
        throw new Error('切回 subagent 应清除 directOverride: ' + JSON.stringify(st.directOverride));
      }
      // 非法参数拒绝
      const bad = runState(['execution-mode', 'bogus'], dir);
      assertExit(bad, 1);
      assertOut(bad, 'BLOCKED: execution-mode 参数必须为 subagent 或 direct');
    },
  },

  {
    name: 'A11 config：配置设置与非法值拒绝',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const ok = runState(['config', 'set', 'enablePrReview', 'true'], dir);
      assertExit(ok, 0);
      assertOut(ok, 'CONFIG: enablePrReview = true');
      const st = readStateFile(dir);
      if (st.enablePrReview !== true) throw new Error('enablePrReview 应为 true');
      // branchMode 只读拒绝
      const branch = runState(['config', 'set', 'branchMode', 'true'], dir);
      assertExit(branch, 1);
      assertOut(branch, 'BLOCKED: branchMode 由 init 自动判定');
      // 值非法拒绝
      const bad = runState(['config', 'set', 'enablePrReview', 'maybe'], dir);
      assertExit(bad, 1);
      assertOut(bad, 'BLOCKED: config set 值非法');
      // 未知键拒绝
      const unknown = runState(['config', 'set', 'foo', 'bar'], dir);
      assertExit(unknown, 1);
      assertOut(unknown, 'BLOCKED: 未知配置键');
    },
  },

  {
    name: 'A12 verifyFailures:切换 change 后计数独立(按 change 存储)',
    run: (dir) => {
      // ① init ch-a + verify-fail 两次(2/3,未超限)
      assertExit(runState(['init', 'ch-a', '--init-skip'], dir), 0);
      assertExit(runState(['verify-fail'], dir), 0);
      const r2 = runState(['verify-fail'], dir);
      assertExit(r2, 0);
      assertOut(r2, 'VERIFY-FAIL: 2/3');
      // ② 切换到 ch-b(目录需存在)→ verify-fail 从 1 起——按 change 存储后计数独立
      // (若实现仍用全局计数 2,此处输出 3/3——断言 1/3 即 RED)
      writeFile(dir, '.specs/ch-b/CHANGE.md', '# CHANGE\n## Why\nx\n');
      assertExit(runState(['select', 'ch-b'], dir), 0);
      const r3 = runState(['verify-fail'], dir);
      assertExit(r3, 0);
      assertOut(r3, 'VERIFY-FAIL: 1/3');
      // ③ ch-b 独立计数:连续 3 次后第 4 次 BLOCK
      assertExit(runState(['verify-fail'], dir), 0);
      assertExit(runState(['verify-fail'], dir), 0);
      const r7 = runState(['verify-fail'], dir);
      assertExit(r7, 1);
      assertOut(r7, '超限');
      // ④ 切回 ch-a:原计数保留(2 → 可再失败 1 次,第 4 次 BLOCK;不串扰不回零)
      assertExit(runState(['select', 'ch-a'], dir), 0);
      const r8 = runState(['verify-fail'], dir);
      assertExit(r8, 0);
      assertOut(r8, 'VERIFY-FAIL: 3/3');
      const r9 = runState(['verify-fail'], dir);
      assertExit(r9, 1);
      assertOut(r9, '超限');
    },
  },

  // ---------- B. 声明机制（skill-load / record / exit 校验） ----------

  {
    name: 'B1 skill-load：声明标记写入（协议归属）',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      const res = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir);
      assertExit(res, 0);
      assertOut(res, 'SKILL-LOAD: open flow-comet-change');
      const markerPath = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json');
      if (!fs.existsSync(markerPath)) throw new Error('标记文件未生成: ' + markerPath);
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.node !== 'open' || marker.skill !== 'flow-comet-change') {
        throw new Error('标记 node/skill 字段不符: ' + JSON.stringify(marker));
      }
      if (marker.protocol !== '0-change.md') {
        throw new Error('标记 protocol 应为 --prompt 参数的 basename: ' + JSON.stringify(marker.protocol));
      }
      if (typeof marker.at !== 'string' || Number.isNaN(Date.parse(marker.at))) {
        throw new Error('标记缺 ISO 时间戳: ' + JSON.stringify(marker));
      }
    },
  },

  {
    name: 'B2 skill-load：非法参数拒绝且不落标记',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const noArgs = runState(['skill-load'], dir);
      assertExit(noArgs, 1);
      assertOut(noArgs, 'skill-load requires <node> <skill>');
      const badNode = runState(['skill-load', 'bogus', 'flow-comet-change'], dir);
      assertExit(badNode, 1);
      assertOut(badNode, 'skill-load node 非法');
      const badSkill = runState(['skill-load', 'open', 'bad/name'], dir);
      assertExit(badSkill, 1);
      assertOut(badSkill, 'skill-load skill 名非法');
      // --prompt 越界（不在 flow-kit/prompts/ 下）
      const badPrompt = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'reference/workflow-protocol.json'], dir);
      assertExit(badPrompt, 1);
      assertOut(badPrompt, 'skill-load --prompt 路径必须位于 flow-kit/prompts/ 下');
      // 全部拒绝后 .skill-loads/ 不产生任何标记
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      if (fs.existsSync(loadsDir) && fs.readdirSync(loadsDir).length > 0) {
        throw new Error('非法参数不应写入标记: ' + fs.readdirSync(loadsDir).join(', '));
      }
    },
  },

  {
    name: 'B3 record：缺声明标记拦截',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '缺少对应声明标记');
      assertOut(res, 'workflow-state.mjs skill-load open flow-comet-change');
      // 拦截先于写入——evidence 不得落库
      const st = readStateFile(dir);
      if (st.evidence && st.evidence.open) throw new Error('拦截后不应写入 evidence: ' + JSON.stringify(st.evidence.open));
    },
  },

  {
    name: 'B4 record：声明后记录通过',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change'], dir), 0);
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 0);
      assertOut(res, 'EVIDENCE: open');
      const st = readStateFile(dir);
      if (!st.evidence.open || st.evidence.open.summary !== 'done') {
        throw new Error('record 未写入 evidence: ' + JSON.stringify(st.evidence));
      }
    },
  },

  {
    name: 'B5 record：声明时间序自洽拦截',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      // 标记 at 晚于记录时间（手工构造未来时间戳）→ 标记必须先于记录声明
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2999-12-31T00:00:00.000Z' }, null, 2) + '\n');
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '标记必须先于记录声明');
    },
  },

  {
    name: 'B6 record：损坏声明标记 fail-closed',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json', '{oops\n');
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '声明标记损坏');
    },
  },

  {
    name: 'B7 record：委托范围条目豁免（有委托通过 / 无委托拦截）',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const payload = JSON.stringify({ summary: 'delegated', completedChecks: ['required-skill:subagent-execute.flow-comet-dev'] });
      // 无委托记录 → 拦截（handoff scope 条目以共用证据库的委托记录为证据）
      const blocked = runState(['record', 'subagent-execute', payload], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, '无委托记录');
      // 委托并回传契约后 → 通过
      assertExit(runHandoff(['result', 'T01', JSON.stringify({
        commitHash: 'deadbeef',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t1.mjs' },
        redEvidence: { command: 'node --check src/t1.mjs' },
      })], dir), 0);
      const pass = runState(['record', 'subagent-execute', payload], dir);
      assertExit(pass, 0);
      assertOut(pass, 'EVIDENCE: subagent-execute');
    },
  },

  {
    name: 'B8 exit：协议声明标记校验（record 自动补通过 / 手动声明 / 空协议·损坏拦截）',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      writeIntakeArtifacts(dir);
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      // ① M5: record 自动补声明标记 → 出口通过（无需手动 skill-load）
      assertExit(runState(['record', 'open', '{"summary":"intake complete"}'], dir), 0);
      const autoMarker = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json');
      if (!fs.existsSync(autoMarker)) throw new Error('record 自动声明标记缺失: open-flow-comet-change.json');
      assertExit(runGuard(['entry', 'open'], dir), 0);
      const rAuto = runGuard(['exit', 'open'], dir);
      assertExit(rAuto, 0);
      assertOut(rAuto, 'ALL CHECKS PASSED');
      assertNotOut(rAuto, 'BLOCKED');
      // ② 手动 skill-load --prompt（protocol = basename）覆盖自动标记 → 出口通过
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      const rPass = runGuard(['exit', 'open'], dir);
      assertExit(rPass, 0);
      assertOut(rPass, 'ALL CHECKS PASSED');
      assertNotOut(rPass, 'BLOCKED');
      // ③ 未传 --prompt → 标记 protocol = null → 拦截（fail-closed；open 两个 requiredSkillCalls 均覆盖为 null）
      assertExit(runState(['skill-load', 'open', 'flow-comet-change'], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-requirement'], dir), 0);
      const rNull = runGuard(['exit', 'open'], dir);
      assertExit(rNull, 1);
      assertOut(rNull, 'exit 缺协议声明标记');
      // ④ 损坏标记（protocol 非本节点协议集）→ 拦截（fail-closed）
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '9-other.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const rCorrupt = runGuard(['exit', 'open'], dir);
      assertExit(rCorrupt, 1);
      assertOut(rCorrupt, 'exit 缺协议声明标记');
    },
  },

  {
    name: 'B9 旧项目兼容：record 自动补声明后照常通过',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      // 旧格式记录：completedChecks 无 required-skill 条目 → 不校验标记,通过
      const rA = runState(['record', 'open', JSON.stringify({ summary: 'legacy', completedChecks: ['unit-tests'] })], dir);
      assertExit(rA, 0);
      assertOut(rA, 'EVIDENCE: open');
      // 无 completedChecks 的纯 summary 记录 → 通过（M5: record 自动补声明标记）
      assertExit(runState(['record', 'open', JSON.stringify({ summary: 'plain' })], dir), 0);
      // 出口：record 已自动补标记 → 无兼容警告,正常通过
      writeIntakeArtifacts(dir);
      assertExit(runGuard(['entry', 'open'], dir), 0);
      const rC = runGuard(['exit', 'open'], dir);
      assertExit(rC, 0);
      assertOut(rC, 'ALL CHECKS PASSED');
      assertNotOut(rC, 'SKILL-LOAD WARN');
    },
  },

  // ---------- C. 委托链路 ----------

  {
    name: 'C1 handoff：请求/结果/状态全链路（含提交校验）',
    run: (dir) => {
      gitInit(dir);
      writeState(dir, baseState('execute'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="T01" status="done" parallel="true">\n  <action>实现 T01</action>\n  <write_files>src/t1.mjs</write_files>\n  <verify>node --check src/t1.mjs</verify>\n</task>\n');
      writeFile(dir, 'src/t1.mjs', 'export const x = 1;\n');
      execFileSync('git', ['add', 'src/t1.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'feat: t1'], { cwd: dir });
      const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      // ① 请求（无 --write-files → 从 TASK.md 自动解析）
      const req = runHandoff(['request', 'T01', '委托实现 T01'], dir);
      assertExit(req, 0);
      assertOut(req, 'HANDOFF REQUEST: T01');
      // ② 结果：真实提交哈希 + write_files 范围内文件 → 记录且无越界警告
      const result = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', commitHash: hash,
        changedFiles: ['src/t1.mjs'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t1.mjs', output: 'ok' },
        redEvidence: { command: 'node --check src/t1.mjs' },
      })], dir);
      assertExit(result, 0);
      assertOut(result, 'HANDOFF RESULT: T01');
      assertNotOut(result, 'HANDOFF WARN');
      // 新 change 提交越界(writeFiles 范围外文件)→ BLOCKED(记录时校验)
      const stForP4 = readStateFile(dir);
      stForP4.newChange = true;
      writeState(dir, stForP4);
      writeFile(dir, 'src/evil.mjs', 'export const evil = 1;\n');
      execFileSync('git', ['add', 'src/evil.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: out-of-bound file'], { cwd: dir });
      const evilHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const reqT02 = runHandoff(['request', 'T02', 'T02 委托', '--write-files', 'src/t2.mjs'], dir);
      assertExit(reqT02, 0);
      const overBound = runHandoff(['result', 'T02', JSON.stringify({
        status: 'DONE', taskId: 'T02', commitHash: evilHash,
        changedFiles: ['src/evil.mjs'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/evil.mjs', output: 'ok' },
        redEvidence: { command: 'node --check src/evil.mjs' },
      })], dir);
      assertExit(overBound, 1);
      assertOut(overBound, 'BLOCKED');
      assertOut(overBound, 'writeFiles');
      // ③ 状态：请求与结果齐可见
      const status = runHandoff(['status'], dir);
      assertExit(status, 0);
      assertOut(status, '"handoffRequests"');
      assertOut(status, '"handoffResults"');
      assertOut(status, 'T01');
      // ④ 无效提交哈希 → 错误提示但记录不阻断（结果仍入库）
      const badHash = runHandoff(['result', 'T02', JSON.stringify({
        commitHash: 'deadbeef00000000000000000000000000000000',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t2.mjs' },
      })], dir);
      assertExit(badHash, 0);
      assertOut(badHash, 'HANDOFF ERROR: commitHash 无效或 git show 失败');
      // ⑤ --json-file 读取 JSON payload(与 record 对齐——规避 Windows PowerShell
      // 引号剥离导致 JSON 损坏;须正确解析为对象而非存成字符串)
      const payloadFile = path.join(dir, 'contract.json');
      fs.writeFileSync(payloadFile, JSON.stringify({
        status: 'DONE', taskId: 'T03', commitHash: hash,
        changedFiles: ['src/t1.mjs'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t1.mjs', output: 'ok' },
      }), 'utf8');
      const viaFile = runHandoff(['result', 'T03', '--json-file', payloadFile], dir);
      assertExit(viaFile, 0);
      assertOut(viaFile, 'HANDOFF RESULT: T03');
      const st5 = readStateFile(dir);
      const rec5 = st5.evidence['subagent-execute'].handoffResult['T03'];
      if (!rec5 || typeof rec5.result !== 'object' || rec5.result.commitHash !== hash) {
        throw new Error('--json-file 未正确解析契约(应存为对象): ' + JSON.stringify(rec5));
      }
      // ⑥ --json-file 越界路径 → 拒绝(与 record 同规则)
      const outsideContract = path.join(dir, '..', 'outside-contract.json');
      fs.writeFileSync(outsideContract, '{"summary":"outside"}', 'utf8');
      const viaBad = runHandoff(['result', 'T04', '--json-file', outsideContract], dir);
      assertExit(viaBad, 1);
      assertOut(viaBad, '必须在项目根内');
    },
  },

  {
    name: 'C2 handoff：红绿证据时间序（先红后绿通过 / 补录拦截）',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      // ① 先记录 RED（TDD 红）
      const red = '{"redEvidence":{"command":"node --check src/p1.mjs"}}';
      const r1 = runHandoff(['result', 'P01', red], dir);
      assertExit(r1, 0);
      assertOut(r1, 'HANDOFF RESULT: P01');
      // ② 同批补 GREEN → 通过，且附带 recordedAt 时间戳（时序可审计）
      const both = '{"redEvidence":{"command":"node --check src/p1.mjs"},"greenEvidence":{"command":"node --check src/p1.mjs"}}';
      const r2 = runHandoff(['result', 'P01', both], dir);
      assertExit(r2, 0);
      const st = readStateFile(dir);
      const rec = st.evidence['subagent-execute'].handoffResult['P01'].result;
      if (!rec.redEvidence.recordedAt || typeof rec.redEvidence.recordedAt !== 'string') {
        throw new Error('redEvidence 未附带 recordedAt: ' + JSON.stringify(rec.redEvidence));
      }
      if (!rec.greenEvidence.recordedAt || typeof rec.greenEvidence.recordedAt !== 'string') {
        throw new Error('greenEvidence 未附带 recordedAt: ' + JSON.stringify(rec.greenEvidence));
      }
      // ③ 新任务：先 GREEN 后补 RED → 事后补录拦截
      const greenOnly = '{"greenEvidence":{"command":"node --check src/p2.mjs"}}';
      assertExit(runHandoff(['result', 'P02', greenOnly], dir), 0);
      const backfill = '{"greenEvidence":{"command":"node --check src/p2.mjs"},"redEvidence":{"command":"node --check src/p2.mjs"}}';
      const r3 = runHandoff(['result', 'P02', backfill], dir);
      assertExit(r3, 1);
      assertOut(r3, 'redEvidence 事后补录');
    },
  },

  {
    name: 'C3 委托后 exit：证据键名契约与契约校验（通过 / 空交接拦截）',
    run: (dir) => {
      gitInit(dir);
      writeFile(dir, 'src/p1.mjs', 'export const x = 1;\n');
      execFileSync('git', ['add', 'src/p1.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'feat: p1'], { cwd: dir });
      const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      // ① 空交接拦截：record 仅写空 handoffResult → 出口缺证据（无委托不可 exit）
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['record', 'subagent-execute', '{"handoffResult":{}}'], dir), 0);
      const stEmpty = readStateFile(dir);
      stEmpty.currentNode = 'subagent-execute';
      writeState(dir, stEmpty);
      assertExit(runGuard(['entry', 'subagent-execute'], dir), 0);
      const blocked = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'requires evidence: handoff-result');
      // ② 真实委托链路：handoff result 回传完整契约（键名契约：嵌套 handoffResult 识别 +
      // Return Contract 校验）→ 出口通过
      const st2 = readStateFile(dir);
      st2.evidence['subagent-execute'] = { summary: 'delegated and collected' };
      writeState(dir, st2);
      const result = runHandoff(['result', 'P01', fullContract(hash, 'P01')], dir);
      assertExit(result, 0);
      assertOut(result, 'HANDOFF RESULT: P01');
      const pass = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(pass, 0);
      assertOut(pass, 'ALL CHECKS PASSED');
      // ③ 契约缺完成检查清单 → 出口拦截（严格校验无豁免）
      const st3 = readStateFile(dir);
      st3.evidence['subagent-execute'] = { summary: 'delegated' };
      writeState(dir, st3);
      const weak = JSON.parse(fullContract(hash, 'P01'));
      delete weak.completedChecks;
      assertExit(runHandoff(['result', 'P01', JSON.stringify(weak)], dir), 0);
      const reenter = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(reenter, 1);
      assertOut(reenter, 'Return Contract 校验失败');
    },
  },

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

  // ---------- H. verify 与归档 ----------

  {
    name: 'H1 verify：验证命令真实执行与超时配置',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      assertExit(runState(['record', 'verify', '{"summary":"verified"}'], dir), 0);
      const st = readStateFile(dir);
      st.currentNode = 'verify';
      writeState(dir, st);
      // ① 快速命令 → 出口通过
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      assertExit(runGuard(['entry', 'verify'], dir), 0);
      const pass = runGuard(['exit', 'verify'], dir);
      assertExit(pass, 0);
      assertOut(pass, 'ALL CHECKS PASSED');
      // ② 缺省超时（未设 env）保持大值：耗时命令通过
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "setTimeout(()=>{}, 1500)"\n```\n');
      const defaultTimeout = runGuard(['exit', 'verify'], dir);
      assertExit(defaultTimeout, 0);
      assertOut(defaultTimeout, 'ALL CHECKS PASSED');
      // ③ 环境覆盖生效：小超时 → 超时拦截（不设 env 时同命令走缺省会通过——覆盖被忽略即红）
      const timedOut = runGuard(['exit', 'verify'], dir, { FLOW_COMET_VERIFY_TIMEOUT_MS: '500' });
      // 超时 kill 的 cmd 孙进程（node）孤儿化后短暂存活，其 cwd 锁定场景目录
      // （Windows：父 cmd 被杀、孙进程继续跑完自身定时器）——断言前同步等待其自然退出
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 2000)']);
      assertExit(timedOut, 1);
      assertOut(timedOut, 'BLOCKED: verify 命令失败');
      assertOut(timedOut, 'timeout 500ms');
      // 子断言:失败计数按 change 写入(guard 侧)
      const stTimed = readStateFile(dir);
      if (!stTimed.verifyFailuresByChange || stTimed.verifyFailuresByChange[CHANGE_ID] < 1) {
        throw new Error('exit verify 失败计数未按 change 写入: ' + JSON.stringify(stTimed.verifyFailuresByChange));
      }
      // ④ 无验证命令 → 拦截（严格版要求）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n无验证命令段。\n');
      const noCmd = runGuard(['exit', 'verify'], dir);
      assertExit(noCmd, 1);
      assertOut(noCmd, 'BLOCKED: TEST.md 需声明 ## 验证命令 段');
    },
  },

  {
    name: 'H2 归档：完整流程（遗留清单 + 移动 + 完成态）',
    run: (dir) => {
      assertExit(runState(['init', 'arch-demo'], dir), 0);
      // 节点推进到归档（模拟前序节点出口已完成的状态——被测机制是归档出口本身）
      const st0 = readStateFile(dir);
      st0.currentNode = 'archive';
      writeState(dir, st0);
      assertExit(runState(['record', 'archive', '{"summary":"archived"}'], dir), 0);
      // ① 未移动（无归档目录）→ 出口拦截（缺归档产物）
      assertExit(runGuard(['entry', 'archive'], dir), 0);
      const blocked = runGuard(['exit', 'archive'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'missing Output Schema artifacts');
      // ② 遗留问题清单（显式无遗留）随工件写入
      writeFile(dir, '.specs/arch-demo/KNOWN-ISSUES.md', '# KNOWN-ISSUES\n\n无遗留问题\n');
      // ③ 移动目录到归档路径（真实归档流程：先移动后出口）
      fs.mkdirSync(path.join(dir, '.specs', 'archive'), { recursive: true });
      fs.renameSync(path.join(dir, '.specs', 'arch-demo'), path.join(dir, '.specs', 'archive', '2026-08-11-arch-demo'));
      if (fs.existsSync(path.join(dir, '.specs', 'arch-demo'))) throw new Error('移动后源目录应不存在');
      if (!fs.existsSync(path.join(dir, '.specs', 'archive', '2026-08-11-arch-demo', 'KNOWN-ISSUES.md'))) {
        throw new Error('遗留问题清单应随工件归档');
      }
      // ④ 出口 --apply → 通过 + 归档完成态（清空活跃项目）
      const pass = runGuard(['exit', 'archive', '--apply'], dir);
      assertExit(pass, 0);
      assertOut(pass, 'ALL CHECKS PASSED');
      const st = readStateFile(dir);
      if (st.activeChange !== null) throw new Error('归档后 activeChange 应为 null: ' + JSON.stringify(st.activeChange));
      if (st.currentNode !== null) throw new Error('归档后 currentNode 应为 null');
      if (st.status !== 'completed') throw new Error('归档后 status 应为 completed');
      const status = runState(['status'], dir);
      assertExit(status, 0);
      assertOut(status, '"status": "no-change"');
    },
  },

  {
    name: 'H3 归档：归档路径声明标记查找',
    run: (dir) => {
      assertExit(runState(['init', 'arch-mk'], dir), 0);
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      writeFile(dir, 'flow-kit/prompts/7-integration.md', '# 阶段 7 · INTEGRATION\n\n## 角色\n\n你是 Integrationer。\n');
      // 遗留清单(协议 required 产物——随目录移动进归档)
      writeFile(dir, '.specs/arch-mk/KNOWN-ISSUES.md', '# KNOWN-ISSUES\n\n无遗留问题\n');
      // 归档前声明标记（open + archive 节点）
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      assertExit(runState(['skill-load', 'archive', 'flow-comet-integration', '--prompt', 'flow-kit/prompts/7-integration.md'], dir), 0);
      // 节点推进到归档（模拟前序节点出口已完成的状态）
      const st0 = readStateFile(dir);
      st0.currentNode = 'archive';
      writeState(dir, st0);
      assertExit(runState(['record', 'archive', '{"summary":"archived"}'], dir), 0);
      // 移动（标记随目录进入归档路径）
      fs.mkdirSync(path.join(dir, '.specs', 'archive'), { recursive: true });
      fs.renameSync(path.join(dir, '.specs', 'arch-mk'), path.join(dir, '.specs', 'archive', '2026-08-11-arch-mk'));
      const markerInArchive = path.join(dir, '.specs', 'archive', '2026-08-11-arch-mk', '.skill-loads', 'archive-flow-comet-integration.json');
      if (!fs.existsSync(markerInArchive)) throw new Error('声明标记应随目录移入归档路径');
      // 出口：标记经归档路径解析命中（活动路径已不存在）→ 通过且无兼容警告
      assertExit(runGuard(['entry', 'archive'], dir), 0);
      const pass = runGuard(['exit', 'archive', '--apply'], dir);
      assertExit(pass, 0);
      assertOut(pass, 'ALL CHECKS PASSED');
      assertNotOut(pass, 'SKILL-LOAD WARN');
      assertNotOut(pass, 'exit 缺协议声明标记');
    },
  },

  {
    name: 'H4 归档:M5 自动补标记写归档路径,不重建活动目录',
    run: (dir) => {
      // 归档顺序(先移目录后 record)下,record archive 的 M5 自动补声明标记应写归档路径
      // (.skill-loads/ 随目录移动),不得重建已归档的活动目录(归档移动语义)
      assertExit(runState(['init', 'arch-m5'], dir), 0);
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      writeFile(dir, 'flow-kit/prompts/7-integration.md', '# 阶段 7 · INTEGRATION\n\n## 角色\n\n你是 Integrationer。\n');
      // 手动 skill-load(活动路径标记,随目录移动进归档)
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      // 推进到 archive
      const st0 = readStateFile(dir);
      st0.currentNode = 'archive';
      writeState(dir, st0);
      // 移动目录到归档(真实归档流程:先移动后 record/exit)
      fs.mkdirSync(path.join(dir, '.specs', 'archive'), { recursive: true });
      fs.renameSync(path.join(dir, '.specs', 'arch-m5'), path.join(dir, '.specs', 'archive', '2026-08-14-arch-m5'));
      // record archive(移动后)——M5 自动补 archive 声明标记
      const rec = runState(['record', 'archive', '{"summary":"archived"}'], dir);
      assertExit(rec, 0);
      // 断言 1:活动目录不得重建(归档移动语义——M5 不得重建已归档的活动目录)
      if (fs.existsSync(path.join(dir, '.specs', 'arch-m5'))) {
        throw new Error('M5 在归档后重建了活动目录(残留): .specs/arch-m5/');
      }
      // 断言 2:归档路径有 M5 自动补的 archive 标记(标记随目录移动后的归属路径)
      const markerInArchive = path.join(dir, '.specs', 'archive', '2026-08-14-arch-m5', '.skill-loads', 'archive-flow-comet-integration.json');
      if (!fs.existsSync(markerInArchive)) {
        throw new Error('归档路径缺 M5 自动补标记: ' + markerInArchive);
      }
      // 变体:change 从未 skill-load(活动与归档路径皆无 .skill-loads)→ record 不得重建
      // 活动目录(修复前 targetLoadsDir 回退活动路径,writeJson 的 mkdir 会重建已归档目录)
      assertExit(runState(['init', 'arch-m5b'], dir), 0);
      const stB = readStateFile(dir);
      stB.currentNode = 'archive';
      writeState(dir, stB);
      fs.renameSync(path.join(dir, '.specs', 'arch-m5b'), path.join(dir, '.specs', 'archive', '2026-08-14-arch-m5b'));
      const recB = runState(['record', 'archive', '{"summary":"archived"}'], dir);
      assertExit(recB, 0);
      if (fs.existsSync(path.join(dir, '.specs', 'arch-m5b'))) {
        throw new Error('M5 在双路径皆无时重建了活动目录(残留): .specs/arch-m5b/');
      }
    },
  },

  // ---------- I. 异常路径 ----------

  {
    name: 'I1 异常路径：损坏状态文件 fail-closed',
    run: (dir) => {
      writeFile(dir, '.comet/flow-comet-state.json', '{broken json');
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

  // ---------- J. 文档一致性 ----------

  {
    name: 'J1 文档一致性：双语健康检查（本地工具）',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无仓库文档
      const checker = path.join(repoRoot, 'scripts', 'check-docs-local.mjs');
      if (!fs.existsSync(checker)) {
        console.log('  （本地工具缺失，跳过——gitignore 不随克隆分发）');
        return;
      }
      const res = runLocalTool(checker, repoRoot);
      if (res.status === 0) {
        assertOut(res, '文档健康检查通过');
        return;
      }
      // 已知本地工具快照局限：其「场景数与版本一致性」子检查用发布时快照（1.3.0 → 97），
      // 开发窗口期（版本未发布、场景数已增）会误报——结构检查（双语/对称）全部通过即放行；
      // 场景数一致性的权威判定在引擎自测（guard-self-test 场景数自检按实时场景数核对）。
      const structuralOk = res.output.includes('PASS: 英文文档无中文')
        && res.output.includes('PASS: 中文文档无英文长句')
        && res.output.includes('PASS: 双语镜像对称');
      if (!structuralOk || !res.output.includes('场景数与版本一致性')) {
        throw new Error('期望 exit 0，实际 exit ' + res.status + '\n实际输出:\n' + res.output);
      }
      console.log('  （场景数一致性子检查按发布快照——当前开发窗口由引擎自测的实时自检覆盖，放行）');
    },
  },

  {
    name: 'J2 文档一致性：公开产物零代号检查（本地工具）',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return;
      const checker = path.join(repoRoot, 'scripts', 'check-codes-local.mjs');
      if (!fs.existsSync(checker)) {
        console.log('  （本地工具缺失，跳过——gitignore 不随克隆分发）');
        return;
      }
      const res = runLocalTool(checker, repoRoot);
      assertExit(res, 0);
      assertOut(res, '过程代号检查通过');
    },
  },

  // ---------- K. 安装器 ----------

  {
    name: 'K1 安装器：版本标识由安装器生成且精确反映源仓库状态',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      if (!fs.existsSync(installer)) throw new Error('缺少 prepare-env.mjs');
      const target = path.join(dir, 'j3-target');
      fs.mkdirSync(target, { recursive: true });
      const res = spawnSync(process.execPath, [installer, '--target', target], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (res.status !== 0) throw new Error('prepare-env 失败: ' + (res.stderr || JSON.stringify(res.output)));
      // 分发主干:权威源随技能包分发的静态文件(手动复制也有效,不依赖安装脚本)
      const srcVersionFile = path.join(repoRoot, '.comet', 'bundle-drafts', 'flow-comet', 'skills', 'flow-comet', 'INSTALLED_VERSION');
      if (!fs.existsSync(srcVersionFile)) throw new Error('缺少权威源 INSTALLED_VERSION(随技能包分发)');
      const srcVersion = fs.readFileSync(srcVersionFile, 'utf8').trim();
      if (!srcVersion) throw new Error('权威源版本标识为空');
      // 权威源须与 CHANGELOG 首个版本段一致(发布批次更新;CI release-consistency 同规则)
      const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
      const m = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
      const expected = m ? m[1] : 'unreleased';
      if (srcVersion !== expected) throw new Error('权威源版本标识不符: ' + srcVersion + ' ≠ CHANGELOG 版本 ' + expected);
      const versionFile = path.join(target, '.claude', 'skills', 'flow-comet', 'INSTALLED_VERSION');
      if (!fs.existsSync(versionFile)) throw new Error('缺少 INSTALLED_VERSION(版本标识文件)');
      const installed = fs.readFileSync(versionFile, 'utf8').trim();
      if (!installed) throw new Error('版本标识为空');
      // 格式:发布版本号(1.3.1) / git describe 开发态(1.3.1-N-g<hash>) / unreleased(无 tag 兜底)
      const ok = /^\d+\.\d+\.\d+(-\d+-g[0-9a-f]+)?$/.test(installed) || installed === 'unreleased';
      if (!ok) throw new Error('版本标识格式异常: ' + installed);
      console.log('  版本标识 = ' + installed + '(git describe 或权威源兜底——多人协作精确检测)✓');
    },
  },

  // ---------- K 扩展:多平台安装器框架(1.4.0) ----------

  // K2: codex 平台安装冒烟——技能落 .agents/skills/ + SKILL 路径平台化替换 + .codex/hooks.json 注入
  // (含 --platform codex 托管命令)+ AGENTS.md 托管区内联 + 纯 codex 不生成 .claude/ + 版本标识
  {
    name: 'K2 安装器:codex 平台安装(技能/路径替换/hooks.json/AGENTS 托管区)',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const target = path.join(dir, 'k2-target');
      fs.mkdirSync(target, { recursive: true });
      const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'codex'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (res.status !== 0) throw new Error('prepare-env --platform codex 失败: ' + (res.stderr || JSON.stringify(res.output)));
      // ① 技能落 .agents/skills/(Codex 自动发现位置)
      const skillMd = path.join(target, '.agents', 'skills', 'flow-comet', 'SKILL.md');
      if (!fs.existsSync(skillMd)) throw new Error('codex 平台技能未安装到 .agents/skills/');
      // ② SKILL 路径平台化替换生效(命令路径 .claude/skills → .agents/skills)
      const text = fs.readFileSync(skillMd, 'utf8');
      if (!text.includes('.agents/skills/flow-comet/scripts/')) throw new Error('SKILL 命令路径未替换为 .agents/skills/');
      if (text.includes('.claude/skills/flow-comet/scripts/')) throw new Error('SKILL 仍含 .claude/skills/flow-comet/scripts/ 命令路径');
      // ③ .codex/hooks.json 注入托管 hook(顶层 hooks 包裹层 + matcher * + 平台标记)
      const hooksFile = path.join(target, '.codex', 'hooks.json');
      if (!fs.existsSync(hooksFile)) throw new Error('缺少 .codex/hooks.json');
      const hooksParsed = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
      const preToolUse = hooksParsed.hooks && hooksParsed.hooks.PreToolUse;
      if (!Array.isArray(preToolUse) || preToolUse.length === 0) throw new Error('hooks.json 缺 hooks.PreToolUse 包裹层');
      const hooksText = JSON.stringify(hooksParsed);
      if (!hooksText.includes('comet-hook-guard.mjs')) throw new Error('hooks.json 未注入托管 hook 命令');
      if (!hooksText.includes('--platform codex')) throw new Error('hooks.json hook 命令缺平台标记');
      if (preToolUse[0].matcher !== '*') throw new Error('hooks.json matcher 应为 * (Codex PreToolUse 只拦截 Bash 工具): ' + JSON.stringify(preToolUse[0]));
      // ③b .codex/config.toml hooks 启用(features——Codex hooks 默认关闭)
      const configFile = path.join(target, '.codex', 'config.toml');
      if (!fs.existsSync(configFile)) throw new Error('缺少 .codex/config.toml');
      const configText = fs.readFileSync(configFile, 'utf8');
      if (!/\[features\]/.test(configText) || !/hooks\s*=\s*true/.test(configText)) throw new Error('config.toml 未启用 hooks(features)');
      // ④ AGENTS.md 托管区(内联 orchestration 全文——Codex 指令唯一自动加载路径)
      const agentsFile = path.join(target, 'AGENTS.md');
      if (!fs.existsSync(agentsFile)) throw new Error('缺少 AGENTS.md');
      const agents = fs.readFileSync(agentsFile, 'utf8');
      if (!agents.includes('Managed by flow-comet')) throw new Error('AGENTS.md 无托管标记');
      if (!agents.includes('flow-comet Orchestration')) throw new Error('AGENTS.md 未内联 orchestration 内容');
      // ⑤ 纯 codex 平台不生成 .claude/
      if (fs.existsSync(path.join(target, '.claude'))) throw new Error('codex 平台不应生成 .claude/');
      // ⑥ 版本标识随技能包分发(平台化路径)
      const verFile = path.join(target, '.agents', 'skills', 'flow-comet', 'INSTALLED_VERSION');
      if (!fs.existsSync(verFile)) throw new Error('缺少 INSTALLED_VERSION(版本标识文件)');
      const installed = fs.readFileSync(verFile, 'utf8').trim();
      if (!installed) throw new Error('版本标识为空');
      // ⑦ .codex/hooks.json 非法 JSON → fail-safe(不覆盖用户配置,报错退出)
      const badTarget = path.join(dir, 'k2-bad-hooks');
      fs.mkdirSync(path.join(badTarget, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(badTarget, '.codex', 'hooks.json'), '{ not json', 'utf8');
      const badRes = spawnSync(process.execPath, [installer, '--target', badTarget, '--platform', 'codex'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (badRes.status === 0) throw new Error('非法 hooks.json 应导致安装失败(fail-safe)');
      const badOut = String(badRes.stderr || '') + String(badRes.stdout || '');
      if (!badOut.includes('已存在但内容非法')) throw new Error('非法 hooks.json 应输出 fail-safe 提示: ' + badOut);
    },
  },

  // K3: hook 平台分支输出契约——codex 分支 stdout 为合法 JSON(拦截含 decision:"block";放行可解析非 block);
  // claude-code 分支(无平台标记)输出与现状一致(文本 workflow-hook-guard-ok)
  {
    name: 'K3 hook:codex 平台分支 JSON 契约(拦截/放行)+ CC 分支不变',
    run: (dir) => {
      // ① codex 分支:写越权路径(源码)→ stdout 合法 JSON + decision block
      const st = baseState('open');
      st.status = 'running';
      writeState(dir, st);
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const block = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(block, 0);
      const blockParsed = JSON.parse(block.output.trim()); // stdout 非 JSON → throw(RED)
      if (blockParsed.decision !== 'block') throw new Error('codex 拦截输出应含 decision:"block": ' + JSON.stringify(blockParsed));
      // ② codex 分支:写 .specs/ 工件 → 放行(输出可解析、非 block)
      const ok = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', CHANGE_ID, 'CHANGE.md') } });
      assertExit(ok, 0);
      const okParsed = JSON.parse(ok.output.trim()); // 放行输出须为合法 JSON(空串解析失败 → RED)
      if (okParsed.decision === 'block') throw new Error('codex 放行输出不应含 decision block');
      // ③ codex 分支:无活跃 workflow → 放行(JSON 可解析)
      fs.rmSync(path.join(dir, '.comet'), { recursive: true, force: true });
      const noActive = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'x.py') } });
      assertExit(noActive, 0);
      JSON.parse(noActive.output.trim());
      // ④ claude-code 分支(无平台标记):输出与现状一致(文本 workflow-hook-guard-ok)
      writeState(dir, { ...baseState('open'), status: 'running' });
      const cc = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', CHANGE_ID, 'CHANGE.md') } });
      assertExit(cc, 0);
      assertOut(cc, 'workflow-hook-guard-ok');
      assertNotOut(cc, 'decision');
      // ⑤ codex 分支:Bash 写入检测(PowerShell 命令字符串——Codex 写路径经 Bash 工具,无 file_path)
      const bashBlock = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: 'Set-Content -LiteralPath "src/evil.py" -Value "x=1"' } });
      assertExit(bashBlock, 0);
      const bashBlockParsed = JSON.parse(bashBlock.output.trim());
      if (bashBlockParsed.decision !== 'block') throw new Error('codex Bash 越权写入应输出 decision block: ' + JSON.stringify(bashBlockParsed));
      // ⑥ codex 分支:Bash 合法写 .specs → 放行
      const bashOk = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: 'Set-Content -LiteralPath ".specs/ch/CHANGE.md" -Value "# CHANGE"' } });
      assertExit(bashOk, 0);
      const bashOkParsed = JSON.parse(bashOk.output.trim());
      if (bashOkParsed.decision === 'block') throw new Error('codex Bash 合法写入不应 block');
      // ⑦ codex 分支:Bash 无写入模式(纯命令)→ 放行
      const bashNone = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: 'python -m pytest test_calculator.py -q' } });
      assertExit(bashNone, 0);
      JSON.parse(bashNone.output.trim());
      // ⑧ codex 分支:读类 cmdlet(Get-Content -Path)→ 无写入语义,放行
      const bashRead = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: 'Get-Content -Path "src/readme.md"' } });
      assertExit(bashRead, 0);
      const bashReadParsed = JSON.parse(bashRead.output.trim());
      if (bashReadParsed.decision === 'block') throw new Error('codex 读类 cmdlet(Get-Content)不应 block');
      // ⑨ codex 分支:.NET File.Copy 目标 = 第二参数(越权目标 → block;合法目标 → 放行)
      const copyBlock = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: '[System.IO.File]::Copy("src/a.txt", "src/b.txt")' } });
      assertExit(copyBlock, 0);
      const copyParsed = JSON.parse(copyBlock.output.trim());
      if (copyParsed.decision !== 'block') throw new Error('codex File.Copy 越权目标(第二参数)应 block');
      const copyOk = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: '[System.IO.File]::Copy("src/a.txt", ".specs/ch/b.txt")' } });
      assertExit(copyOk, 0);
      const copyOkParsed = JSON.parse(copyOk.output.trim());
      if (copyOkParsed.decision === 'block') throw new Error('codex File.Copy 合法目标不应 block');
    },
  },

  // K4: 平台选择链——--platform 显式(两平台互不串扰)/ 无 TTY 探测(项目已有 .codex/ 或 .claude/)/ 两者皆无默认
  {
    name: 'K4 安装器:平台选择链(显式/无 TTY 探测/默认)',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return;
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const run = (target) => spawnSync(process.execPath, [installer, '--target', target], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      // ① --platform claude-code 显式 → .claude/skills 生成,.agents 不生成
      const t1 = path.join(dir, 'k4-cc');
      fs.mkdirSync(t1, { recursive: true });
      const r1 = spawnSync(process.execPath, [installer, '--target', t1, '--platform', 'claude-code'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (r1.status !== 0) throw new Error('--platform claude-code 失败: ' + (r1.stderr || JSON.stringify(r1.output)));
      if (!fs.existsSync(path.join(t1, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('claude-code 平台未生成 .claude/skills/');
      if (fs.existsSync(path.join(t1, '.agents'))) throw new Error('claude-code 平台不应生成 .agents/');
      // ② --platform codex 显式 → .agents/skills 生成,.claude 不生成
      const t2 = path.join(dir, 'k4-codex');
      fs.mkdirSync(t2, { recursive: true });
      const r2 = spawnSync(process.execPath, [installer, '--target', t2, '--platform', 'codex'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (r2.status !== 0) throw new Error('--platform codex 失败: ' + (r2.stderr || JSON.stringify(r2.output)));
      if (!fs.existsSync(path.join(t2, '.agents', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('codex 平台未生成 .agents/skills/');
      if (fs.existsSync(path.join(t2, '.claude'))) throw new Error('codex 平台不应生成 .claude/');
      // ③ 无 --platform(spawnSync 无 TTY)+ 目标已有 .codex/ → 探测为 codex
      const t3 = path.join(dir, 'k4-probe-codex');
      fs.mkdirSync(path.join(t3, '.codex'), { recursive: true });
      const r3 = run(t3);
      if (r3.status !== 0) throw new Error('探测 codex 安装失败: ' + (r3.stderr || JSON.stringify(r3.output)));
      if (!fs.existsSync(path.join(t3, '.agents', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('已有 .codex/ 的项目应探测为 codex 平台');
      // ④ 无 --platform + 目标已有 .claude/ → 探测为 claude-code
      const t4 = path.join(dir, 'k4-probe-cc');
      fs.mkdirSync(path.join(t4, '.claude'), { recursive: true });
      const r4 = run(t4);
      if (r4.status !== 0) throw new Error('探测 claude-code 安装失败: ' + (r4.stderr || JSON.stringify(r4.output)));
      if (!fs.existsSync(path.join(t4, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('已有 .claude/ 的项目应探测为 claude-code 平台');
      if (fs.existsSync(path.join(t4, '.agents'))) throw new Error('探测为 claude-code 时不应生成 .agents/');
      // ⑤ 无 --platform + 两者皆无 → 默认 claude-code
      const t5 = path.join(dir, 'k4-default');
      fs.mkdirSync(t5, { recursive: true });
      const r5 = run(t5);
      if (r5.status !== 0) throw new Error('默认平台安装失败: ' + (r5.stderr || JSON.stringify(r5.output)));
      if (!fs.existsSync(path.join(t5, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('两者皆无应默认 claude-code');
      // ⑥ --platform 未知平台 → 报错拒绝(不静默回退)
      const t6 = path.join(dir, 'k4-unknown');
      fs.mkdirSync(t6, { recursive: true });
      const r6 = spawnSync(process.execPath, [installer, '--target', t6, '--platform', 'bogus'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (r6.status === 0) throw new Error('未知平台应报错拒绝');
      const out6 = String(r6.stderr || '') + String(r6.stdout || '');
      if (!out6.includes('未知平台')) throw new Error('未知平台错误信息应含"未知平台": ' + out6);
    },
  },

  // K5: purge 语义——缺 --yes 拒绝(不破坏)/ --purge --yes 清理重建 / 用户内容(生成物外)保留
  {
    name: 'K5 安装器:purge 语义(缺 --yes 拒绝/重建/用户内容保留)',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return;
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const run = (target, extra) => spawnSync(process.execPath, [installer, '--target', target, ...extra], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      // ① codex 平台:首次安装 + 用户内容(项目根,非生成物)
      const target = path.join(dir, 'k5-codex');
      fs.mkdirSync(target, { recursive: true });
      const first = run(target, ['--platform', 'codex']);
      if (first.status !== 0) throw new Error('codex 首次安装失败: ' + (first.stderr || JSON.stringify(first.output)));
      fs.writeFileSync(path.join(target, 'USER_KEEP.md'), '# 用户内容(保留)\n', 'utf8');
      // ② 缺 --yes → 拒绝且不破坏(错误提示含 --yes;生成物与用户内容仍在)
      const dry = run(target, ['--platform', 'codex', '--purge']);
      if (dry.status === 0) throw new Error('--purge 缺 --yes 应失败');
      const dryOut = String(dry.stderr || '') + String(dry.stdout || '');
      if (!dryOut.includes('--yes')) throw new Error('--purge 缺 --yes 错误信息应提示 --yes: ' + dryOut);
      if (!fs.existsSync(path.join(target, '.agents', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('--purge 拒绝后生成物不应被删除');
      if (!fs.existsSync(path.join(target, 'USER_KEEP.md'))) throw new Error('--purge 拒绝后用户内容不应被删除');
      // ②b 写入用户自有资产(.agents/skills/ 用户技能 + hooks.json 用户条目)——purge 后须保留
      fs.mkdirSync(path.join(target, '.agents', 'skills', 'user-own-skill'), { recursive: true });
      fs.writeFileSync(path.join(target, '.agents', 'skills', 'user-own-skill', 'SKILL.md'), '# user skill\n', 'utf8');
      const userHooksPath = path.join(target, '.codex', 'hooks.json');
      const userHooks = JSON.parse(fs.readFileSync(userHooksPath, 'utf8'));
      userHooks.hooks.PreToolUse.push({ matcher: 'UserOwn', hooks: [{ type: 'command', command: 'node user-own-hook.mjs' }] });
      fs.writeFileSync(userHooksPath, JSON.stringify(userHooks, null, 2) + '\n', 'utf8');
      // ③ --purge --yes → 清理重建(仅 flow-comet 技能,用户资产保留)
      const ok = run(target, ['--platform', 'codex', '--purge', '--yes']);
      if (ok.status !== 0) throw new Error('--purge --yes 失败: ' + (ok.stderr || JSON.stringify(ok.output)));
      if (!fs.existsSync(path.join(target, '.agents', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('--purge --yes 后 flow-comet 技能应重新生成');
      if (!fs.existsSync(path.join(target, '.agents', 'skills', 'user-own-skill', 'SKILL.md'))) throw new Error('--purge --yes 后用户技能应保留(.agents/ 为共享目录)');
      if (!fs.existsSync(path.join(target, 'USER_KEEP.md'))) throw new Error('--purge --yes 后用户内容应保留');
      const hooksText = fs.readFileSync(path.join(target, '.codex', 'hooks.json'), 'utf8');
      if ((hooksText.match(/comet-hook-guard\.mjs/g) || []).length !== 1) throw new Error('--purge --yes 后 hooks.json 应含 1 条重建托管条目: ' + hooksText);
      if (!hooksText.includes('user-own-hook.mjs')) throw new Error('--purge --yes 后用户 hook 条目应保留: ' + hooksText);
      const agents = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
      if (!agents.includes('Managed by flow-comet')) throw new Error('--purge --yes 后 AGENTS.md 托管区应重建');
      // ④ claude-code 平台同样:缺 --yes 拒绝 + --purge --yes 重建 + 用户内容保留
      const tcc = path.join(dir, 'k5-cc');
      fs.mkdirSync(tcc, { recursive: true });
      const ccFirst = run(tcc, []);
      if (ccFirst.status !== 0) throw new Error('claude-code 首次安装失败: ' + (ccFirst.stderr || JSON.stringify(ccFirst.output)));
      fs.writeFileSync(path.join(tcc, 'USER_KEEP.md'), '# 用户内容(保留)\n', 'utf8');
      // ⑤ matcher 演进幂等:把托管组 matcher 改为旧形态(Write|Edit——模拟历史版本注入),
      //    重装(非 purge)后旧托管组应被清理——settings 仅剩当前 matcher 组、无空 hooks 组
      const settingsPath = path.join(tcc, '.claude', 'settings.local.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      for (const g of settings.hooks.PreToolUse) {
        if (g.matcher === 'Write|Edit|Bash') g.matcher = 'Write|Edit';
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      const reinstall = run(tcc, []);
      if (reinstall.status !== 0) throw new Error('matcher 演进重装失败: ' + (reinstall.stderr || JSON.stringify(reinstall.output)));
      const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const groups = after.hooks.PreToolUse;
      if (groups.some((g) => Array.isArray(g.hooks) && g.hooks.length === 0)) {
        throw new Error('重装后存在空 hooks 组(matcher 演进残留): ' + JSON.stringify(groups));
      }
      if (!groups.some((g) => g.matcher === 'Write|Edit|Bash' && Array.isArray(g.hooks) && g.hooks.length > 0)) {
        throw new Error('重装后缺当前 matcher 组(Write|Edit|Bash)');
      }
      // ⑥ 历史残留空组清理:手动把当前组 hooks 清空(模拟历史版本残留的空组),
      //    再次重装后空组应被删除,settings 仅剩有效组
      const settings2 = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      for (const g of settings2.hooks.PreToolUse) g.hooks = [];
      fs.writeFileSync(settingsPath, JSON.stringify(settings2, null, 2) + '\n', 'utf8');
      const reinstall2 = run(tcc, []);
      if (reinstall2.status !== 0) throw new Error('空组清理重装失败: ' + (reinstall2.stderr || JSON.stringify(reinstall2.output)));
      const after2 = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const groups2 = after2.hooks.PreToolUse;
      if (groups2.some((g) => Array.isArray(g.hooks) && g.hooks.length === 0)) {
        throw new Error('重装后仍存在空 hooks 组(历史残留未清理): ' + JSON.stringify(groups2));
      }
      if (!groups2.some((g) => g.matcher === 'Write|Edit|Bash' && Array.isArray(g.hooks) && g.hooks.length > 0)) {
        throw new Error('空组清理后缺当前 matcher 组(Write|Edit|Bash)');
      }
      const ccDry = run(tcc, ['--purge']);
      if (ccDry.status === 0) throw new Error('claude-code --purge 缺 --yes 应失败');
      if (!fs.existsSync(path.join(tcc, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('claude-code --purge 拒绝后生成物不应被删除');
      if (!fs.existsSync(path.join(tcc, 'USER_KEEP.md'))) throw new Error('claude-code --purge 拒绝后用户内容不应被删除');
      const ccOk = run(tcc, ['--purge', '--yes']);
      if (ccOk.status !== 0) throw new Error('claude-code --purge --yes 失败: ' + (ccOk.stderr || JSON.stringify(ccOk.output)));
      if (!fs.existsSync(path.join(tcc, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('claude-code --purge --yes 后技能应重新生成');
      if (!fs.existsSync(path.join(tcc, 'USER_KEEP.md'))) throw new Error('claude-code --purge --yes 后用户内容应保留');
    },
  },

  // K6: 平台描述符驱动防回归——PLATFORMS 每平台条目含安装/清理函数(installHooks/installRules/
  // purge/overwriteDescription);main 统一调度(源码无平台分支标识——新增平台 = 描述符条目,
  // main 零改动);对源码提取的全部平台逐一真实安装冒烟(未来新增平台自动纳入测试)
  {
    name: 'K6 安装器:平台描述符驱动(全平台安装冒烟 + main 统一调度)',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return;
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const src = fs.readFileSync(installer, 'utf8');
      // ① main 统一调度:平台分支标识已消除(新增平台 = 描述符条目,main 零改动)
      if (src.includes('isClaudeCode')) {
        throw new Error('prepare-env main 仍含平台分支标识 isClaudeCode(应迁入描述符)');
      }
      // ② 描述符完整性:平台 id 从描述符块提取(防块外误匹配);聚合块须含 4 个平台函数
      // (installHooks/installRules/purge/overwriteDescription——未来新增平台缺任一函数时,
      // 下方逐平台 purge 冒烟会因 platform.purge 未定义而真实失败)
      const platformBlock = src.match(/const PLATFORMS = \{[\s\S]*?\n\};/);
      if (!platformBlock) throw new Error('未找到 PLATFORMS 描述符表');
      const ids = [...platformBlock[0].matchAll(/^\s{2}'([a-z-]+)':\s*\{/gm)].map((m) => m[1]);
      if (!ids.includes('claude-code') || !ids.includes('codex')) {
        throw new Error('PLATFORMS 应含 claude-code/codex: ' + ids.join(', '));
      }
      for (const fn of ['installHooks', 'installRules', 'purge', 'overwriteDescription']) {
        if (!platformBlock[0].includes(fn)) throw new Error('描述符缺平台函数: ' + fn);
      }
      // ③ 全平台逐一安装 + purge 冒烟(从描述符块提取 id——未来新增平台自动纳入;
      // purge 冒烟验证清理函数真实可用,缺函数/清理失败即红)
      for (const id of ids) {
        const target = path.join(dir, 'k6-' + id);
        fs.mkdirSync(target, { recursive: true });
        const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', id], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
        if (res.status !== 0) throw new Error('平台 ' + id + ' 安装失败: ' + (res.stderr || JSON.stringify(res.output)));
        const purgeRes = spawnSync(process.execPath, [installer, '--target', target, '--platform', id, '--purge', '--yes'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
        if (purgeRes.status !== 0) throw new Error('平台 ' + id + ' purge 失败: ' + (purgeRes.stderr || JSON.stringify(purgeRes.output)));
      }
      console.log('  描述符驱动: ' + ids.length + ' 个平台逐一安装 + purge 冒烟通过✓');
    },
  },

  // ---------- L. 执行遗漏防护（M1~M8 真实链路） ----------

  {
    name: 'L1 进入证据:entry 记录 enteredNodes,正常流程 exit 无误报',
    run: (dir) => {
      gitInit(dir);
      assertExit(runState(['init', CHANGE_ID, '--init-skip'], dir), 0);
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
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n\npython\n\n## 决策清单\n\n- [ ] D1\n');
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

// ---------- 运行 ----------

for (const item of TEST_ITEMS) {
  const dir = makeTmp();
  try {
    item.run(dir);
    passed += 1;
    console.log('PASS: ' + item.name);
  } catch (e) {
    failures.push({ name: item.name, error: e.message });
    console.error('FAIL: ' + item.name + '\n' + e.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('SYSTEM TEST: ' + passed + '/' + TEST_ITEMS.length + ' passed');

// 清理验证：套件自身创建的临时目录不留残留
const residue = createdDirs.filter((d) => fs.existsSync(d));
if (residue.length > 0) {
  failures.push({ name: '临时目录清理', error: '残留目录: ' + residue.join(', ') });
  console.error('FAIL: 临时目录清理\n残留目录: ' + residue.join(', '));
}

if (failures.length > 0) {
  console.error('FAILED ITEMS: ' + failures.length);
  for (const f of failures) {
    console.error('- ' + f.name + '\n' + f.error);
  }
  process.exit(1);
}

console.log('ALL SYSTEM TESTS PASSED');
