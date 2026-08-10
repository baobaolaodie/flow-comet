#!/usr/bin/env node
// C1 · workflow-guard.mjs 自测套件（49 场景：17 基础 + 批次 E 6 个分支/追加位置检测场景 + 批次 D T06 8 个自定义协议场景 +  2 个全部完成 → done 场景 + T-FIX-04 2 个 completedChecks 校验 + T-FIX-05 2 个 next 节点顺序校验 + T-FIX-06 2 个 redEvidence 时间顺序校验 + T-FIX-09 4 个 C3 签名行尾规范化 + T-FIX-10 2 个 C3 签名标记类属性剥离 + T-FIX 回退豁免 + T-FIX-11 2 个 next 正常推进豁免 + T-FIX-12 2 个机制交互组合场景：record 覆盖 handoff + 越俎代庖 / 路由 + 节点推进）
//
// 每个场景 = 独立临时目录（fs.mkdtemp）+ 伪造 .comet/flow-comet-state.json
// （currentNode + evidence + executionMode:'subagent'，满足前置校验）+
// .specs/<change>/ 工件 → spawnSync 跑 workflow-guard.mjs <entry|exit> <node>
// （COMET_RUN_ROOT=<临时目录>）→ 断言退出码与输出关键词。场景跑完 rmSync 清理。
//
// 运行: node scripts/guard-self-test.mjs
// 全过 → exit 0，输出 ALL 49 SCENARIOS PASSED；失败 → exit 1，列出场景名+实际输出+exit code
//
// 仅 node 内置模块（child_process/fs/os/path）；无网络；不依赖 flow-kit 模板目录
// 存在（fallback 场景用内置段名；S1/S4 复制模板文件进临时目录验证 C2 模板派生）。
//
// 自定义协议路径适配：T03 起 workflow-guard 用 readProtocolFile（protected-path：
// 协议路径必须在 runRoot 内）。场景 runRoot=临时目录、内置协议默认路径在 packageRoot
// （脚本所在仓库，tmpdir 外）→ 全部场景曾报 "workflow protocol file must stay inside the
// project root"。修复（测试场景适配，非弱化断言）：真实项目协议位于 <项目根>/reference/
// workflow-protocol.json（runRoot 内）——每个场景把内置协议复制到 <dir>/reference/ 并由
// runGuard 的 FLOW_COMET_PROTOCOL 指向场景内副本；自定义协议场景用 --protocol CLI（优先级
// 最高）或 env 覆盖。S24~S31 同时覆盖 AC-2/3/4/5/6（自定义协议加载路由、通用层防线、特化
// 校验绑定、hook 白名单缺省）。

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
// 内置协议源文件（packageRoot/reference/）：场景复制到 <tmpdir>/reference/ 内（protected-path 要求 runRoot 内）
const BUILTIN_PROTOCOL_SOURCE = path.join(__dirname, '..', 'reference', 'workflow-protocol.json');
const CHANGE_ID = 'ch';

// 场景数一致性自检清单（20 文件，全变体：ALL n SCENARIOS PASSED / n scenarios / n 场景 / n/n）——
// S105 场景与底部自检共用同一清单（自检常量同步：SCENARIOS.length 变更 → 20 文件须同步）
const SCENARIO_COUNT_FILES = [
  'README.md', 'README-zh.md', 'CONTRIBUTING.md', 'CONTRIBUTING-zh.md',
  'docs/INSTALLATION.md', 'docs/INSTALLATION-zh.md', 'docs/MECHANISM.md', 'docs/MECHANISM-zh.md',
  'docs/VERSIONS.md', 'docs/VERSIONS-zh.md', 'CLAUDE.md', '.github/PULL_REQUEST_TEMPLATE.md',
  'CHANGELOG.md', 'CHANGELOG-zh.md',
  'docs/internal/ARCHITECTURE.md', 'docs/internal/DOC-CHECKLIST.md', 'docs/internal/MECHANISM.md',
  'docs/internal/next-change-prompt.md', 'docs/internal/ROADMAP.md', 'docs/internal/WORKING-METHOD.md',
];

let passed = 0;
const failures = [];
const createdDirs = [];

// ---------- 工具函数 ----------

function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-comet-guard-test-'));
  createdDirs.push(dir);
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

// 跑 guard：COMET_RUN_ROOT=临时目录；FLOW_COMET_PROTOCOL 指向场景内协议副本（T06：T03 起
// 协议文件须在 runRoot 内，protected-path 检查）；spawnSync 同时捕获 stdout+stderr
// （WARN/BLOCKED 走 stderr，execFileSync 在成功退出时丢弃 stderr，会导致 WARN 断言误报）并带 exit code。
// envOverrides 可覆盖 FLOW_COMET_PROTOCOL（自定义协议场景；--protocol CLI 优先级高于 env）
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

// 跑 workflow-state.mjs：runRoot = process.cwd()（T02 不用 COMET_RUN_ROOT），spawn 时 cwd=临时目录即可
function runState(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [STATE, ...args], {
    cwd: root,
    env: { ...process.env, COMET_RUN_ROOT: root, ...envOverrides },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 workflow-handoff.mjs：runRoot = process.cwd()（ 场景用 cwd=临时目录 + 伪造 state，
// 直接调用 result 命令验证时间顺序校验与 recordedAt 附带，不经过 guard exit）
function runHandoff(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [HANDOFF, ...args], {
    cwd: root,
    env: { ...process.env, COMET_RUN_ROOT: root, ...envOverrides },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 comet-hook-guard.mjs：PreToolUse 事件从 stdin 传 JSON（{ tool_name, tool_input: { file_path } }）；
// hook 不支持 --protocol CLI，协议路径只能走 FLOW_COMET_PROTOCOL env
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

// ---------- 自定义协议场景材料 ----------

// 自定义协议（compose-demo）：3 节点 brainstorm/tdd/codereview（避开内置 8 节点 id，验证
// 协议数据化路由与通用层防线对自定义节点生效）；无 writeWhitelist（hook 回退内置缺省表）；
// state 与内置协议同构（statePath 指向 .comet/flow-comet-state.json）
function customProtocol() {
  return {
    schemaVersion: 1,
    kind: 'workflow-kernel',
    name: 'compose-demo',
    goal: 'T06 自定义协议场景：协议数据化路由 + 通用层防线 + 特化校验绑定。',
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

// 写入 <dir>/custom-protocol.json，返回绝对路径（供 --protocol CLI / FLOW_COMET_PROTOCOL env 使用）
function writeCustomProtocol(dir) {
  writeFile(dir, 'custom-protocol.json', JSON.stringify(customProtocol(), null, 2) + '\n');
  return path.join(dir, 'custom-protocol.json');
}

// compose-demo 场景 state（currentNode 默认 brainstorm；hook 场景需补 status:'running'）
function composeState(overrides = {}) {
  return {
    activeChange: 'compose-demo',
    currentNode: 'brainstorm',
    completedNodes: [],
    evidence: {},
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
    ...overrides,
  };
}

// 完整 SUMMARY：六段齐全（## verify 输出 / ## 6 维自查 / ## 越界检查 / ## 做了什么 / ## 改动文件 / ## 自检方法）
// 6 维自查默认含实质内容且声明 brooks-review；method='' 表示去掉 ## 自检方法 段（旧格式场景）
function summaryContent(options = {}) {
  const sixDim = options.sixDim !== undefined
    ? options.sixDim
    : '## 6 维自查\n\n- 功能: 通过（brooks-review 已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过';
  const method = options.method !== undefined ? options.method : '## 自检方法\n\nbrooks-review';
  return [
    '# T01-SUMMARY',
    '',
    '## verify 输出',
    '',
    '```',
    'node --check src/t1.mjs',
    '```',
    '',
    sixDim,
    '',
    '## 越界检查',
    '',
    '仅修改 src/t1.mjs，无越界。',
    '',
    '## 做了什么',
    '',
    '实现 T01。',
    '',
    '## 改动文件',
    '',
    '- src/t1.mjs',
    '',
    method,
    '',
  ].join('\n');
}

// 伪造 handoffResult（越俎代庖检测要求 done 任务有 handoff；Return Contract 完整形状）
// handoff-guarded 落实——result 必须回传 completedChecks 含
// required-skill:subagent-execute.flow-comet-dev（guard W1-D 严格校验；S15/S34 等场景同步补齐，
// 缺该字段的旧格式材料已随 S35 明确覆盖 BLOCKED 路径）
function handoffFor(taskIds) {
  const handoffResult = {};
  for (const id of taskIds) {
    handoffResult[id] = {
      result: {
        commitHash: 'abcd1234',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/' + id.toLowerCase() + '.mjs' },
        redEvidence: { command: 'node --check src/' + id.toLowerCase() + '.mjs' },
      },
    };
  }
  return handoffResult;
}

const TASK_DONE =
  '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n';
const TASK_SERIAL_PENDING =
  '<task id="T01"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n';
const TASK_P1 =
  '<task id="P01" status="done" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n';
const TASK_P2 =
  '<task id="P02" status="done" parallel="true"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n';
// 第二波 parallel pending 任务（depends_on P01 已满足——第一波 P01 done 后才可委托；
// status 属性在前，与 TASK_P1/TASK_P2 常量属性顺序一致）
const TASK_P2_PENDING =
  '<task id="P02" status="pending" parallel="true"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>P01</depends_on></task>\n';
// 串行 pending 任务（depends P01,P02——第二波 P02 完成前不可执行）
const TASK_T03_PENDING =
  '<task id="T03"><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
// review/verify 阶段追加的 pending T-FIX 任务（T-FIX 标准回退路径触发源）
const TASK_TFIX =
  '<task id="T-FIX-01" status="pending"><action>修复 verify 发现的缺陷</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n';

// ---------- 17 个场景 ----------

const SCENARIOS = [
  // 1: open exit 通过（模板段名 CHANGE "## Why（为什么做）" + REQUIREMENT "## 用户故事（User Story）" + 验收段）——带模板验证 C2 派生
  {
    name: '01 open exit 通过（模板段名）',
    run: (dir) => {
      writeFile(dir, 'flow-kit/templates/CHANGE.md', '# CHANGE 模板\n\n## Why（为什么做）\n## 范围（Scope）\n');
      writeFile(dir, 'flow-kit/templates/REQUIREMENT.md', '# REQUIREMENT 模板\n\n## 用户故事（User Story）\n## 验收准则（AC）\n## 非目标（Non-Goals）\n');
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 2: open exit BLOCKED——CHANGE.md 缺 Why 段
  {
    name: '02 open exit BLOCKED：CHANGE 缺 Why 段',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## 变更目标\n\n## 方案\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'CHANGE.md 缺必填段');
    },
  },

  // 3: open exit BLOCKED——REQUIREMENT.md 缺验收段（且无 Given 豁免）
  {
    name: '03 open exit BLOCKED：REQUIREMENT 缺验收段',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 需求分析\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '缺少验收标准');
    },
  },

  // 4: design exit 通过（## 0. + ## 1. 决策清单）——带模板，段名 "## 1. 技术决策清单" 只有模板派生能匹配（fallback 不匹配）
  {
    name: '04 design exit 通过（模板派生 技术决策清单）',
    run: (dir) => {
      writeFile(dir, 'flow-kit/templates/DESIGN.md', '# DESIGN 模板\n\n## 0. 技术栈选型\n## 1. 技术决策清单\n## 2. 数据流\n');
      const st = baseState('design');
      st.evidence.design = { summary: 'design done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈选型\n\n## 1. 技术决策清单\n');
      const res = runGuard(['exit', 'design'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 5: design exit BLOCKED——缺 ## 决策清单 段
  {
    name: '05 design exit BLOCKED：缺决策清单',
    run: (dir) => {
      const st = baseState('design');
      st.evidence.design = { summary: 'design done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      const res = runGuard(['exit', 'design'], dir);
      assertExit(res, 1);
      assertOut(res, '决策清单');
    },
  },

  // 6: plan exit 通过（task 块 + verify 字段）
  {
    name: '06 plan exit 通过（task 块 + verify）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 7: plan exit BLOCKED——无 <task> 块
  {
    name: '07 plan exit BLOCKED：无 task 块',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n（无任务块）\n');
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '无 <task> 块');
    },
  },

  // 8: execute exit 通过（enter 记录 taskHash + SUMMARY 六段 + 6 维实质 + 自检方法 + handoff 齐 + TASK 全 done）
  {
    name: '08 execute exit 通过（enter 后未改 TASK，签名匹配）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      // enter 时脚本自动记录 taskHash（写回 state）
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // exit 前补 SUMMARY + handoff（不碰 TASK.md）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 9: execute exit BLOCKED——6 维自查仅 "### 🟢 R1" 标题无正文
  {
    name: '09 execute exit BLOCKED：6 维仅 🟢 标题无实质',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        sixDim: '## 6 维自查\n\n### 🟢 R1\n### 🟢 R2',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '无实质内容');
    },
  },

  // 10: execute exit BLOCKED——缺 ## 自检方法 且全文无 brooks-review/builtin 声明
  {
    name: '10 execute exit BLOCKED：缺自检方法且全文无声明',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        sixDim: '## 6 维自查\n\n- 功能: 通过\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
        method: '',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '自检方法');
    },
  },

  // 11: execute exit 兼容——旧格式无 ## 自检方法 但 6 维含 brooks-review → WARN 不 BLOCK
  {
    name: '11 execute exit 兼容：旧格式含 brooks-review → WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({ method: '' }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 12: execute exit BLOCKED——TASK 签名哈希不匹配（enter 后改 action）
  {
    name: '12 execute exit BLOCKED：TASK 签名不匹配（enter 后改 action）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      // enter 记录 taskHash
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // enter 后改 action → 任务集签名变化
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE.replace('实现 T01', '实现 T01（改）'));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '签名不匹配');
    },
  },

  // 13: 越俎代庖——parallel done 无 handoffResult → BLOCKED
  {
    name: '13 execute exit BLOCKED：parallel done 无 handoffResult（越俎代庖）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) }; // P02 无 handoff
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P2);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '越俎代庖');
    },
  },

  // 14: 串行 pending 未完成 → BLOCKED
  {
    name: '14 execute exit BLOCKED：串行 pending 未完成',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['P02']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_SERIAL_PENDING + TASK_P2);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '串行 pending');
    },
  },

  // 15: subagent-execute exit 通过（parallel 全 done + handoff 齐 + Return Contract 完整）
  {
    name: '15 subagent-execute exit 通过（parallel done + handoff 齐）',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = {
        summary: 'delegated and collected',
        handoffResult: handoffFor(['P01', 'P02']),
      };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2);
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 16: entry execute——未 commit 工件存在（git 仓库）→ WORKTREE WARN 不 BLOCK
  {
    name: '16 entry execute：未 commit 工件 → WORKTREE WARN',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      const st = baseState('execute');
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      const res = runGuard(['entry', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'WORKTREE WARN');
    },
  },

  // 17: entry execute——PROGRESS.md 存在 → WARNING（清窗恢复产物）
  {
    name: '17 entry execute：PROGRESS.md 存在 → WARNING',
    run: (dir) => {
      const st = baseState('execute');
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/PROGRESS.md', '# PROGRESS\n\n已排除方案: 无\n');
      const res = runGuard(['entry', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'PROGRESS.md 存在');
    },
  },

  // ---------- 分组场景（S18~S23：分支校验 + 追加位置检测） ----------

  // 18: entry archive 分支校验 BLOCKED（branchMode=true + activeChange + 当前分支非 change/<id>）
  // 注意：需初始 commit——unborn HEAD 下 git rev-parse --abbrev-ref HEAD 失败（按规格"失败跳过"不触发校验）
  {
    name: '18 entry archive BLOCKED：分支不是 change/<id>（branchMode）',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const st = baseState('archive');
      st.branchMode = true;
      writeState(dir, st);
      const res = runGuard(['entry', 'archive'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '归档必须在 change/' + CHANGE_ID + ' 分支上进行');
    },
  },

  // 19: entry archive 通过（当前分支 change/<id>）
  {
    name: '19 entry archive 通过：当前分支 change/<id>',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['checkout', '-b', 'change/' + CHANGE_ID], { cwd: dir, stdio: 'ignore' });
      const st = baseState('archive');
      st.branchMode = true;
      writeState(dir, st);
      const res = runGuard(['entry', 'archive'], dir);
      assertExit(res, 0);
      assertOut(res, 'ENTRY OK: archive');
    },
  },

  // 20: exit open——CONTEXT.md 孤立追加段 → WARN 不 BLOCK
  {
    name: '20 exit open WARN：CONTEXT.md 孤立追加段',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n\n## 术语（test-change 追加）\n\n某术语\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: CONTEXT.md 检测到孤立追加段');
    },
  },

  // 21: exit verify——LESSONS.md 条目编号乱序 → WARN 不 BLOCK
  {
    name: '21 exit verify WARN：LESSONS.md 编号乱序',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n## 条目区\n\n### L-002: b\n### L-001: a\n');
      const res = runGuard(['exit', 'verify'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: LESSONS.md 条目编号乱序');
    },
  },

  // 22: exit archive——CHANGELOG.md 表格日期非倒序 → WARN 不 BLOCK
  {
    name: '22 exit archive WARN：CHANGELOG.md 表格日期非倒序',
    run: (dir) => {
      const st = baseState('archive');
      st.evidence.archive = { summary: 'archived' };
      writeState(dir, st);
      writeFile(dir, '.specs/archive/foo-' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/CHANGELOG.md', '# CHANGELOG\n\n| 日期 | 说明 |\n|------|------|\n| 2026-08-03 | a |\n| 2026-08-04 | b |\n');
      const res = runGuard(['exit', 'archive'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: CHANGELOG.md 表格日期非倒序');
    },
  },

  // 23: 旧 state 兼容（无 branchMode 字段 + 无分支）entry archive → exit 0（不触发分支校验）
  {
    name: '23 旧 state 兼容：无 branchMode 无分支 entry archive',
    run: (dir) => {
      const st = baseState('archive'); // 无 branchMode 字段（旧 state 形状）
      writeState(dir, st);
      const res = runGuard(['entry', 'archive'], dir);
      assertExit(res, 0);
      assertOut(res, 'ENTRY OK: archive');
    },
  },

  // ---------- 分组场景（S24~S31：自定义协议加载路由 + 通用层防线 + 特化校验绑定 + hook 白名单缺省） ----------

  // 24: 自定义协议加载路由（AC-2/3）——--protocol CLI 指向 <dir>/custom-protocol.json；
  // workflow-state status 按协议 outputSchemas 推导 currentNode：全部产物缺失 → 第 1 节点
  {
    name: '24 自定义协议加载路由：无产物 → 第 1 节点（brainstorm）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState());
      fs.mkdirSync(path.join(dir, '.specs', 'compose-demo'), { recursive: true });
      const res = runState(['status', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, '"currentNode": "brainstorm"');
    },
  },

  // 25: 自定义协议加载路由（AC-2/3）——仅第 1 节点产物 notes.md 存在 → 推第 2 节点
  {
    name: '25 自定义协议加载路由：仅 notes.md → 第 2 节点（tdd）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState());
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runState(['status', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, '"currentNode": "tdd"');
    },
  },

  // 26: 自定义协议加载路由（AC-2/3）——全部产物存在 → 最后节点
  {
    name: '26 自定义协议加载路由：产物齐全 → 最后节点（codereview）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState());
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      writeFile(dir, '.specs/compose-demo/T01-SUMMARY.md', '# T01-SUMMARY\n');
      writeFile(dir, '.specs/compose-demo/verdict.md', '# verdict\n');
      const res = runState(['status', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, '"currentNode": "codereview"');
    },
  },

  // 27: 通用层防线对自定义协议生效（AC-4）——自定义节点 exit 缺 evidence → BLOCKED（missing evidence）
  {
    name: '27 通用层防线（AC-4）：exit brainstorm 无 evidence → BLOCKED',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ currentNode: 'brainstorm', evidence: {} }));
      fs.mkdirSync(path.join(dir, '.specs', 'compose-demo'), { recursive: true });
      const res = runGuard(['exit', 'brainstorm', '--protocol', custom], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'missing evidence for Node brainstorm');
    },
  },

  // 28: 特化校验绑定反例（AC-5）——自定义节点 id（brainstorm）exit 不误触发内置 open 特化校验：
  // 场景内置 open 特化校验的诱饵（CHANGE.md 缺 Why + REQUIREMENT 缺验收段），若误触发必 BLOCKED
  {
    name: '28 特化校验绑定反例（AC-5b）：brainstorm exit 不误触发内置特化校验',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n'); // brainstorm 产物（artifact 门控）
      writeFile(dir, '.specs/compose-demo/CHANGE.md', '# CHANGE\n\n## 变更目标\n\n## 方案\n');
      writeFile(dir, '.specs/compose-demo/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 需求分析\n');
      const res = runGuard(['exit', 'brainstorm', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, '缺必填段');
      assertNotOut(res, '缺少验收标准');
    },
  },

  // 29: 协议 env 加载（AC-2/3）——FLOW_COMET_PROTOCOL 指向场景内自定义协议（无 --protocol CLI）
  // guard 从 env 加载自定义协议：若 env 被忽略（回退 packageRoot 内置 8 节点协议）→ Unknown Node 报错
  {
    name: '29 自定义协议 env 加载：FLOW_COMET_PROTOCOL 生效',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runGuard(['exit', 'brainstorm'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, 'Unknown workflow Node');
    },
  },

  // 30: hook 白名单缺省（AC-6）——自定义协议无 writeWhitelist → hook 回退内置缺省表。
  // a) 无活跃 state → 放行（不阻断）；b) 自定义节点 + 写 .specs/ → 放行；c) 内置 open + .specs/ → 放行；
  // d) 内置 open + 写源码 → BLOCKED（缺省表 open 仅允许 .specs/）
  {
    name: '30 hook 白名单缺省（AC-6）：协议无 writeWhitelist → 内置缺省表',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      // a) 无 state 文件 → 无活跃 workflow 放行
      const resA = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'index.ts') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(resA, 0);
      assertOut(resA, 'no active workflow');
      // b) 自定义协议 + 活跃 state（brainstorm）写 .specs/ 内文件 → 放行
      writeState(dir, composeState({ status: 'running' }));
      const resB = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(resB, 0);
      assertOut(resB, 'NODE: brainstorm');
      // c) 内置协议副本（同样无 writeWhitelist）+ open 写 .specs/ 内文件 → 缺省表放行
      const stC = baseState('open');
      stC.status = 'running';
      writeState(dir, stC);
      const resC = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'CHANGE.md') } });
      assertExit(resC, 0);
      assertOut(resC, 'NODE: open');
      // d) 内置协议副本 + open 写源码 → 缺省表拦截（BLOCKED exit 2）
      const resD = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'index.ts') } });
      assertExit(resD, 2);
      assertOut(resD, 'BLOCKED: phase "open" 不允许写入');
    },
  },

  // 31: --protocol CLI 优先于 env（AC-2）——env 指向内置副本（若 CLI 被忽略 → 内置协议无
  // brainstorm 节点 → Unknown Node 报错），CLI 指向自定义协议 → 走自定义协议通过
  {
    name: '31 --protocol CLI 优先于 FLOW_COMET_PROTOCOL env',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runGuard(['exit', 'brainstorm', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, 'Unknown workflow Node');
    },
  },

  // ----------  场景（S32~S33：自定义协议全部完成 → NEXT: done；部分完成仍走产物推导） ----------

  // 32: 自定义协议无 archive 节点，3 节点全部 exit 完成（completedNodes 含 brainstorm/tdd/codereview）
  // → next 输出 NEXT: done（修复前缺陷：determineNode 只按产物推导，全部完成仍输出 NODE: codereview）
  {
    name: '32 自定义协议全节点完成：next → NEXT: done',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'codereview',
        completedNodes: ['brainstorm', 'tdd', 'codereview'],
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      writeFile(dir, '.specs/compose-demo/T01-SUMMARY.md', '# T01-SUMMARY\n');
      writeFile(dir, '.specs/compose-demo/verdict.md', '# verdict\n');
      const res = runState(['next', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'NEXT: done');
      assertNotOut(res, 'NODE: codereview');
    },
  },

  // 33: 反例（防过度修复）——completedNodes 为空（部分完成）但产物全齐 → next 仍输出最后节点
  // codereview：产物推导继续生效，不因"全部完成 → done"判定误伤最后节点路由
  //  适配：currentNode=brainstorm 已记录 evidence（节点已工作）→ 不触发节点顺序 BLOCK；
  // completedNodes 仍为空，"部分完成但产物全齐 → 仍 NODE: codereview"断言保持不变
  {
    name: '33 反例：completedNodes 空但产物全齐 → 仍 NODE: codereview',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      writeFile(dir, '.specs/compose-demo/T01-SUMMARY.md', '# T01-SUMMARY\n');
      writeFile(dir, '.specs/compose-demo/verdict.md', '# verdict\n');
      const res = runState(['next', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'NODE: codereview');
      assertNotOut(res, 'NEXT: done');
    },
  },

  // ----------  场景（S34~S35：handoff completedChecks 严格校验，handoff-guarded 落实） ----------

  // 34: subagent-execute exit 通过——handoff result 的 completedChecks 含 required-skill 条目 → exit 0
  {
    name: '34 subagent-execute exit 通过：handoff 含 completedChecks',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = {
        summary: 'delegated and collected',
        handoffResult: handoffFor(['P01']),
      };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 35: subagent-execute exit BLOCKED——handoff result 缺 completedChecks（严格模式，无旧 change 豁免）
  // → exit 1：旧格式/缺 completedChecks 的 handoff 在 subagent-execute 重入时被硬性拦截
  {
    name: '35 subagent-execute exit BLOCKED：handoff 缺 completedChecks',
    run: (dir) => {
      const st = baseState('subagent-execute');
      const hr = handoffFor(['P01']);
      delete hr['P01'].result.completedChecks;
      st.evidence['subagent-execute'] = { summary: 'delegated and collected', handoffResult: hr };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'completedChecks');
    },
  },

  // ----------  场景（S36~S37：next 节点顺序校验，严格模式） ----------

  // 36: next BLOCKED——currentNode=open 未 exit（completedNodes 空 + evidence 无 open 记录）
  // → 上一节点未 exit 就推进 → 严格拦截，输出恢复指令（先 exit open --apply）
  {
    name: '36 next BLOCKED：currentNode=open 未 exit（completedNodes 空）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 open');
      assertOut(res, 'workflow-guard.mjs exit open --apply');
    },
  },

  // 37: next 正常——open 已 exit（completedNodes 含 open）+ 当前节点 evidence 已记录 → 正常推进
  // （P0-2 漂移校正保留：已完成节点正常推进不受严格校验影响）
  {
    name: '37 next 正常：open 已 exit 后正常推进',
    run: (dir) => {
      const st = baseState('design');
      st.completedNodes = ['open'];
      st.evidence.design = { summary: 'design in progress' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'NODE: design');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // ----------  场景（S38~S39：redEvidence 时间顺序校验） ----------

  // 38: handoff result 时间顺序通过——先记录 redEvidence（TDD RED），再补 greenEvidence（GREEN）
  // → 两次均通过；且 evidence 中 redEvidence/greenEvidence 附带 recordedAt 时间戳
  // （重录保留 red 首次记录时间，green 为补录时间——时序可审计）
  {
    name: '38 handoff red 先于 green 通过（redEvidence/greenEvidence 附带 recordedAt）',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const redOnly = '{"redEvidence":{"command":"node --check src/p1.mjs"}}';
      const res1 = runHandoff(['result', 'P01', redOnly], dir);
      assertExit(res1, 0);
      assertOut(res1, 'HANDOFF RESULT: P01');
      const both = '{"redEvidence":{"command":"node --check src/p1.mjs"},"greenEvidence":{"command":"node --check src/p1.mjs"}}';
      const res2 = runHandoff(['result', 'P01', both], dir);
      assertExit(res2, 0);
      assertOut(res2, 'HANDOFF RESULT: P01');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      const rec = st.evidence['subagent-execute'].handoffResult['P01'].result;
      if (!rec.redEvidence.recordedAt || typeof rec.redEvidence.recordedAt !== 'string') {
        throw new Error('redEvidence 未附带 recordedAt: ' + JSON.stringify(rec.redEvidence));
      }
      if (!rec.greenEvidence.recordedAt || typeof rec.greenEvidence.recordedAt !== 'string') {
        throw new Error('greenEvidence 未附带 recordedAt: ' + JSON.stringify(rec.greenEvidence));
      }
    },
  },

  // 39: handoff result BLOCKED——已记录 greenEvidence（无 redEvidence）后同批补录 redEvidence
  // → redEvidence 事后补录（TDD 要求 RED 先于 GREEN），exit 1
  {
    name: '39 handoff BLOCKED：greenEvidence 后同批补录 redEvidence',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const greenOnly = '{"greenEvidence":{"command":"node --check src/p1.mjs"}}';
      const res1 = runHandoff(['result', 'P01', greenOnly], dir);
      assertExit(res1, 0);
      const backfill = '{"greenEvidence":{"command":"node --check src/p1.mjs"},"redEvidence":{"command":"node --check src/p1.mjs"}}';
      const res2 = runHandoff(['result', 'P01', backfill], dir);
      assertExit(res2, 1);
      assertOut(res2, 'redEvidence 事后补录');
    },
  },

  // ----------  场景（S40~S43：C3 签名行尾规范化 + T-FIX 回退豁免） ----------

  // 40: execute exit 通过——TASK.md 从 LF 行尾改写为 CRLF（bash heredoc → python os.linesep
  // 跨工具编辑），任务集逻辑未变 → 签名一致（行尾规范化），不误报"任务集被修改"
  {
    name: '40 execute exit 通过：TASK LF→CRLF 行尾变化签名一致',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      // LF 版本任务集（enter 时记录签名）
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 同一任务集改写为 CRLF 行尾（仅行尾差异，逻辑内容不变）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF.replace(/\n/g, '\r\n'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 41: execute exit BLOCKED——TASK.md 任务内容实际变化（改 action 文本）→ 签名不同 → 严格拦截
  {
    name: '41 execute exit BLOCKED：任务内容变化签名不同',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 逻辑内容变化（T01 action 文本被改），行尾保持 LF 不变
      const changed = taskLF.replace('实现 T01', '实现 T01 并补充单元测试');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', changed);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'TASK.md 任务集被修改');
    },
  },

  // 42: next 回退豁免通过——verify 未 exit（completedNodes 无 verify + evidence 无 verify 记录）
  // 但 TASK.md 存在 pending T-FIX 任务且 determineNode 推导为 execute → 允许 T-FIX 标准回退路径
  // （verify 发现缺陷 → 回 execute），不 BLOCK，输出 NODE: execute
  {
    name: '42 next 回退豁免：verify 未 exit + pending T-FIX → 允许回 execute',
    run: (dir) => {
      const st = baseState('verify');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      // 前置产物（preExec 门控：open/design/plan 的 CHANGE/REQUIREMENT/DESIGN/TASK）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      // 既有 done 任务 + verify 阶段追加的 pending T-FIX 任务
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P1 + TASK_TFIX);
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 43: next 维持严格 BLOCK——verify 未 exit（evidence 无 verify 记录）且 TASK.md 无 pending
  // 任务（非 T-FIX 回退）→ 豁免不成立 → 维持  严格拦截，输出恢复指令
  {
    name: '43 next 维持 BLOCK：无 pending 任务（非 T-FIX 回退）',
    run: (dir) => {
      const st = baseState('verify');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      // 全部 done（无 pending）——正常推进场景不豁免
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P1);
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 verify');
      assertOut(res, 'workflow-guard.mjs exit verify --apply');
    },
  },

  // ----------  场景（S44~S45：C3 签名标记类属性剥离——completed_at 误报修复） ----------

  // 44: execute exit 通过——enter 后子代理在 task 开标签追加 completed_at 标记属性
  // （标记 task done 的时序属性，纯状态标记不影响任务集逻辑）→ 签名不受标记属性影响，不误报 BLOCK
  {
    name: '44 execute exit 通过：追加 completed_at 标记属性签名一致',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 子代理标记 task done：T01 开标签追加 completed_at 属性（其余逻辑内容不变）
      const marked = taskLF.replace('id="T01"', 'id="T01" completed_at="2026-08-07"');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', marked);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 45: execute exit BLOCKED——追加 completed_at 标记属性 + 任务内容（action）实际变化
  // → 标记属性剥离不越界：内容仍签名敏感 → 严格拦截"任务集被修改"
  {
    name: '45 execute exit BLOCKED：completed_at 标记属性 + action 变化签名不同',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 内容实际变化（T01 action 文本被改）+ 同时追加 completed_at 标记属性
      const changed = taskLF
        .replace('id="T01"', 'id="T01" completed_at="2026-08-07"')
        .replace('实现 T01', '实现 T01（改）');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', changed);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'TASK.md 任务集被修改');
    },
  },

  // ----------  场景（S46~S47：next 正常推进豁免——exit 推进后的正常 next 不再被误拦） ----------

  // 46: next 正常推进豁免通过——open exit --apply 已把 currentNode 推进到 design（completedNodes=['open']、
  // design 尚未开始故 evidence 无 design 记录），随后按 SKILL 协议调 next（正常路径）→ 不 BLOCK，
  // 输出 NODE: design（ 误拦回归：修复前此状态被 BLOCK 为"疑似未 exit 节点 design"；
  // open 的 evidence 证明该 exit 真实发生过，满足 normalAdvanceExempt）
  {
    name: '46 next 正常：open exit 推进后 currentNode=design 无 evidence（T-FIX-11 豁免）',
    run: (dir) => {
      const st = baseState('design');
      st.completedNodes = ['open'];
      st.evidence.open = { summary: 'open done' };
      writeState(dir, st);
      // open exit 已通过的产物（design 尚未开始，无 DESIGN.md）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'NODE: design');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 47: next 维持严格 BLOCK——真乱序跳节点：currentNode=review 但 completedNodes 仅 ['open']
  // （open 已 exit 且有 evidence）→ review 不是 open 的路由直接后继（open 的后继是 design）
  // →  豁免不成立（T-FIX-09 回退豁免也不成立：TASK.md 无 pending）→ T-FIX-05 核心价值
  // 保持（跳节点仍严格拦截），输出恢复指令
  {
    name: '47 next BLOCKED：跳节点乱序（completedNodes 仅 open，currentNode=review）',
    run: (dir) => {
      const st = baseState('review');
      st.completedNodes = ['open'];
      st.evidence.open = { summary: 'open done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 review');
      assertOut(res, 'workflow-guard.mjs exit review --apply');
    },
  },

  // ----------  场景（S48~S49：机制交互组合——两个机制同时作用，防单机制测试盲区） ----------

  // 48: 组合盲区 A（对照组 A 撞出）——record 覆盖语义 × 越俎代庖检测：先经 workflow-handoff
  // result 正确记录 T01 的 Return Contract（含 completedChecks），随后 record subagent-execute
  // '{"handoffResult":{}}'（浅合并整体替换 handoffResult 键）把已记录的 handoff 覆盖丢失 →
  // exit execute 的 P0-A 越俎代庖检测（统一委托下 done 任务必须有 handoff）BLOCK——
  // 组合语义：record 的"整体覆盖"不是无害操作，会连带破坏委托证明链（T01 合法 done 变越俎代庖）
  {
    name: '48 execute exit BLOCKED：record 覆盖 handoff（越俎代庖）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      // ① workflow-handoff result 正确记录 T01 的 Return Contract（含 completedChecks）
      const res = runHandoff(['result', 'T01', JSON.stringify({
        commitHash: 'abcd1234',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t1.mjs' },
        redEvidence: { command: 'node --check src/t1.mjs' },
      })], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF RESULT: T01');
      // ② record subagent-execute '{"handoffResult":{}}' 整体覆盖 evidence['subagent-execute']
      //（浅合并替换 handoffResult 键）→ 已记录的 T01 handoff 丢失（对照组 A 踩坑路径）
      assertExit(runState(['record', 'subagent-execute', '{"handoffResult":{}}'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') }), 0);
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      const hr = st2.evidence['subagent-execute'] && st2.evidence['subagent-execute'].handoffResult;
      if (!hr || hr['T01']) {
        throw new Error('record 未整体覆盖 handoffResult（T01 应被覆盖丢失）: ' + JSON.stringify(st2.evidence['subagent-execute']));
      }
      // ③ exit execute：T01 done 但 handoff 已被覆盖丢失 → 越俎代庖 BLOCK
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 1);
      assertOut(res2, '越俎代庖');
    },
  },

  // 49: 组合盲区 B（最新版验证撞出）——路由 × 节点推进：subagent-execute 已 completed（第一波
  // parallel 全 done + exit，completedNodes 含该节点）后，第二波 parallel 任务（P02，depends 已
  // 满足）出现时：next 不得再路由回 subagent-execute（防死循环——已完成节点不能作为路由目标
  // 再入），应路由到 execute 继续串行委托；而 entry subagent-execute 仍放行（completedNodes 含
  // 该节点允许重入——第二波委托入口；exit 路径由 P0 保护不再自动路由回）
  {
    name: '49 next → execute + entry subagent-execute 重入（二次并行不回流）',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2_PENDING + TASK_T03_PENDING);
      const st = baseState('subagent-execute');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      st.evidence['subagent-execute'] = { summary: 'wave1 delegated and collected' };
      writeState(dir, st);
      // ① next：subagent-execute 已 completed → 第二波 parallel 不路由回该节点（防死循环）
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      assertNotOut(res, 'NODE: subagent-execute');
      // ② entry subagent-execute：completedNodes 含该节点仍可重入（第二波委托入口）
      const res2 = runGuard(['entry', 'subagent-execute'], dir);
      assertExit(res2, 0);
      assertOut(res2, 'ENTRY OK');
    },
  },

  // ---------- 审查补充场景（S50~S52，2026-08-08：validateProtocolSchema nodes 校验 / 豁免 summary 严格化 / hook 声明模式 fail-closed） ----------

  // 50: validateProtocolSchema 拒绝空 node（自定义协议 nodes 含空对象 → 加载报错 fail-closed）
  {
    name: '50 自定义协议空 node：schema 校验拒绝（审查补充）',
    run: (dir) => {
      const badProtocol = customProtocol();
      badProtocol.nodes.push({});
      writeFile(dir, 'bad-protocol.json', JSON.stringify(badProtocol, null, 2) + '\n');
      const res = runState(['status', '--protocol', path.join(dir, 'bad-protocol.json')], dir);
      assertExit(res, 1);
      assertOut(res, 'workflow protocol node must have a non-empty string id');
    },
  },

  // 51: normalAdvanceExempt 空对象 evidence 不豁免（completedNodes 最后节点 evidence 是 {} → next BLOCK）
  {
    name: '51 next BLOCKED：豁免节点 evidence 为空对象（审查补充）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'tdd',
        completedNodes: ['brainstorm'],
        evidence: { brainstorm: {} },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runState(['next', '--protocol', custom], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
    },
  },

  // 52: 协议声明 writeWhitelist 未列出节点 → hook BLOCK（fail-closed）
  {
    name: '52 hook BLOCKED：writeWhitelist 未声明节点（审查补充）',
    run: (dir) => {
      const custom = customProtocol();
      custom.writeWhitelist = { brainstorm: ['.specs/'] };
      writeFile(dir, 'partial-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running', currentNode: 'tdd' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'partial-protocol.json') });
      assertExit(res, 2);
      assertOut(res, '未在协议 writeWhitelist 中声明');
    },
  },

  // ----------  场景（S53~S54：分支前缀可配置，适配仓库规范） ----------

  // 53: init --branch-prefix feat/ → 分支创建为 feat/<id>（适配仓库规范如 feat/）
  {
    name: '53 init --branch-prefix feat/ 创建 feat/<id> 分支',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const res = runState(['init', 'prefix-test', '--branch-prefix', 'feat/'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'BRANCH: feat/prefix-test');
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      if (branch !== 'feat/prefix-test') {
        throw new Error('期望分支 feat/prefix-test，实际 ' + branch);
      }
    },
  },

  // 54: 一致性校验用 state.branchPrefix（status 显示 ok）
  {
    name: '54 status 一致性：branchPrefix=feat/ 分支 feat/<id> → ok',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['checkout', '-b', 'feat/pref-state'], { cwd: dir, stdio: 'ignore' });
      const st = baseState('open');
      st.activeChange = 'pref-state';
      st.branchPrefix = 'feat/';
      writeState(dir, st);
      writeFile(dir, '.specs/pref-state/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/pref-state/REQUIREMENT.md', '# REQUIREMENT\n## 用户故事\nx\n## 验收准则（AC）\nx\n');
      const res = runState(['status'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, '一致性: ok');
    },
  },

  // ----------  场景（S55~S57：init 写 status + hook 判定对齐） ----------

  // 55: init 生成的 state 必须含 status:'running'（当前缺——hook 判定不一致的根源）
  {
    name: '55 init state 含 status: running',
    run: (dir) => {
      const res = runState(['init', 'tf15-st'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (st.status !== 'running') {
        throw new Error('init state 缺 status: running，实际: ' + JSON.stringify(st.status));
      }
    },
  },

  // 56: init 后（open 阶段）越权写源码 → hook BLOCK（当前因 status undefined 放行——三层防线缺口）
  {
    name: '56 hook BLOCKED：init 后越权写源码',
    run: (dir) => {
      const initRes = runState(['init', 'tf15-hk'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(initRes, 0);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 2);
    },
  },

  // 57: status:'completed'（归档后状态）→ hook 放行（当前 exit 1 拦截全部写入）
  {
    name: '57 hook 放行：status completed 归档后状态',
    run: (dir) => {
      writeState(dir, composeState({ status: 'completed', activeChange: null, currentNode: null }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'anything.md') } });
      assertExit(res, 0);
    },
  },

  // ----------  场景（S58：init 创建 .specs/<id>/ 目录，findActiveChange 立即可识别） ----------

  // 58: init 后 next 识别 active change（当前因 .specs/<id>/ 目录未建报 No active change）
  {
    name: '58 init 后 next 识别 active change',
    run: (dir) => {
      const initRes = runState(['init', 'tf16-dir'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(initRes, 0);
      const res = runState(['next'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 open');
      assertNotOut(res, 'No active change');
    },
  },

  // ----------  场景（S59：归档完成态不兜底识别残留目录） ----------

  // 59: state 为归档完成态（completed + activeChange null）→ .specs/ 顶层残留目录（含 TASK.md）不被兜底识别
  {
    name: '59 归档后残留目录不误判为 active',
    run: (dir) => {
      writeState(dir, composeState({ status: 'completed', activeChange: null, currentNode: null }));
      writeFile(dir, '.specs/stale/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/stale/TASK.md', '# TASK\n');
      const res = runState(['status'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'no-change');
      assertNotOut(res, 'stale');
    },
  },

  // ----------  场景（S60：init currentNode 按协议首节点） ----------

  // 60: 自定义协议 init → currentNode = 协议首节点 brainstorm（当前硬编码 open——）
  {
    name: '60 init currentNode 按协议首节点',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const initRes = runState(['init', 'tf18-cp'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(initRes, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (st.currentNode !== 'brainstorm') {
        throw new Error('init currentNode 应为协议首节点 brainstorm，实际: ' + JSON.stringify(st.currentNode));
      }
    },
  },

  // ---------- 补齐场景（S61： 兼容分支固化） ----------

  // 61: 旧 state（无 status 字段但有 activeChange）→ hook 按 running 处理（fail-closed 向后兼容，行为固化）
  {
    name: '61 hook fail-closed：旧 state 无 status 有 activeChange 按 running（T-FIX-15 固化）',
    run: (dir) => {
      const st = baseState('open');
      delete st.status;
      st.activeChange = 'legacy-change';
      writeState(dir, st);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 2);
    },
  },

  // 63: init 后（open 阶段）合法写 .specs/ 工件 → hook 放行（ 正确 RED：
  // 修复前 init 无 status → hook「not running」throw exit 1 拦截合法写入——open 阶段无法产出工件）
  {
    name: '63 hook 放行：init 后写 .specs/ 工件',
    run: (dir) => {
      const initRes = runState(['init', 'tf15-ok'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(initRes, 0);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'tf15-ok', 'CHANGE.md') } });
      assertExit(res, 0);
      assertOut(res, 'NODE: open');
    },
  },

  // 64: 新 change 与旧归档同名（state 缺失时走扫描兜底）→ 应识别为 active（ 扩展边界：
  // archivedIds 剥日期前缀匹配不得误伤同名新 change）
  {
    name: '64 同名新 change 不被归档检查误跳过（T-FIX-17 边界）',
    run: (dir) => {
      writeFile(dir, '.specs/sci-notation/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/sci-notation/TASK.md', '# TASK\n');
      writeFile(dir, '.specs/archive/2026-08-08-sci-notation/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runState(['status'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, '"change": "sci-notation"');
    },
  },

  // ---------- Round 2 场景（~D-20，独立验证者发现） ----------

  // 65: record 命令的 --protocol 参数不得污染 payload（：payload 解析前剥离）
  {
    name: '65 record --protocol 不污染 payload',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const initRes = runState(['init', 'tf14-rec'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(initRes, 0);
      const res = runState(['record', 'open', '{"summary":"x","completedChecks":["a"]}', '--protocol', custom], dir);
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      const ev = st.evidence.open || {};
      if (ev.summary !== 'x') {
        throw new Error('summary 被污染，应为 "x"，实际: ' + JSON.stringify(ev.summary));
      }
      if (ev.completedChecks === undefined) {
        throw new Error('completedChecks 丢失（payload 未解析为对象）: ' + JSON.stringify(ev));
      }
    },
  },

  // 66: 自定义协议未声明 writeWhitelist 时，非内置节点写源码 → BLOCK（ 方案 B：
  // 协调者默认 .specs/——当前 fail-open 放行）
  {
    name: '66 自定义节点未声明白名单写源码 BLOCK',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 2);
    },
  },

  // 67: 自定义协议未声明白名单时，写 .specs/ 工件 → 放行（ 协调者默认的正面）
  {
    name: '67 自定义节点未声明白名单写工件放行',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'NODE: brainstorm');
    },
  },

  // 68: 旧格式 state（无 status 字段 + 无 activeChange + 无 currentNode——批次 C 归档后升级场景）
  // → hook 放行（：无 activeChange 与无 state 文件同语义——当前被「not running」拦截）
  {
    name: '68 旧 state 无 status 无 activeChange hook 放行',
    run: (dir) => {
      const st = baseState('open');
      delete st.status;
      st.activeChange = null;
      st.currentNode = null;
      writeState(dir, st);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 0);
    },
  },

  // 69: writeWhitelist 路径支持 <change-id> 占位符（：协议复用自动适配——
  // 与 artifacts paths 同机制——当前字面匹配失败 BLOCK）
  {
    name: '69 writeWhitelist change-id 占位符',
    run: (dir) => {
      const custom = customProtocol();
      custom.writeWhitelist = { brainstorm: ['.specs/<change-id>/'] };
      writeFile(dir, 'ph-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running' }));
      // 写 .specs/compose-demo/（占位符替换为 activeChange=compose-demo）→ 放行
      const r1 = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'ph-protocol.json') });
      assertExit(r1, 0);
      // 写 .specs/other/（不在白名单）→ BLOCK
      const r2 = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'other', 'x.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'ph-protocol.json') });
      assertExit(r2, 2);
    },
  },

  // 70: 自定义协议 init 输出 NODE: 协议首节点（：printNext 硬编码 open——输出与 state 不一致）
  {
    name: '70 init 输出 NODE 协议首节点',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const res = runState(['init', 'tf17-out'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'NODE: brainstorm');
      assertNotOut(res, 'NODE: open');
    },
  },

  // 71: state completed + activeChange 非空（残留值）→ status 应 no-change（：
  // completed 检查优先于 activeChange 分支——当前 activeChange 分支先命中误判）
  {
    name: '71 completed state 残留 activeChange 不误判',
    run: (dir) => {
      const st = composeState({ status: 'completed', currentNode: null });
      st.activeChange = 'stale-id';
      writeState(dir, st);
      writeFile(dir, '.specs/stale-id/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/stale-id/TASK.md', '# TASK\n');
      const res = runState(['status'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'no-change');
    },
  },

  // 72: 自定义协议未声明 state.statePath（最小 schema）→ hook 不崩溃，写 .specs/ 放行
  // （：statePath 缺省回退 .comet/flow-comet-state.json——与 workflow-state 硬编码一致；
  //  当前空值解析崩溃 exit 1 全量拦截）
  {
    name: '72 无 statePath 协议 hook 不崩溃',
    run: (dir) => {
      const custom = customProtocol();
      delete custom.state;
      writeFile(dir, 'nostate-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'nostate-protocol.json') });
      assertExit(res, 0);
    },
  },

  // 73: state 文件带 UTF-8 BOM（外部写入如会话 Write）→ status 正常输出（：
  // 读端 JSON.parse 应容忍 BOM——当前崩）
  {
    name: '73 state 带 BOM 正常读取',
    run: (dir) => {
      const st = composeState({ status: 'running' });
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), raw, 'utf8');
      writeFile(dir, '.specs/compose-demo/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runState(['status'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, '"status": "running"');
    },
  },

  // 74: hook 读带 BOM 的 state → 判定正常（——hook readStateJson 的 BOM 容忍）
  {
    name: '74 hook 读带 BOM state 正常',
    run: (dir) => {
      const st = baseState('open');
      st.status = 'running';
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), raw, 'utf8');
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'CHANGE.md') } });
      assertExit(res, 0);
      assertOut(res, 'NODE: open');
    },
  },

  // ----------  场景（S76~S77：builtin 降级须含缓存尝试证据） ----------

  // 76: builtin-quickcheck 声明 + 不可用原因但无缓存尝试证据 → BROOKS-LINT WARN
  // （：防「未尝试 Read 插件缓存协议文件」的偷懒降级——修复前不校验 = RED）
  {
    name: '76 builtin 无缓存尝试证据 → WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbuiltin-quickcheck — brooks-lint 不可用（Skill 仅返回占位，插件执行体未加载），按协议降级内置 R1~R6 快查',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 78: cache-brooks 声明（两级降级路径第 2 级——读缓存手动执行成功）→ 放行
  // （ 补：guard method 正则须识别 cache-brooks——修复前正则不匹配 → 全文无 brooks-review/builtin → BLOCKED = RED）
  {
    name: '78 cache-brooks 声明 → 放行',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\ncache-brooks — 已 Read 插件缓存协议文件手动执行完整审查（4-element + file:line + 书引用），结果见「6 维自查」',
        sixDim: '## 6 维自查\n\n- 功能: 通过（cache-brooks 审查已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 77: builtin-quickcheck 声明 + 不可用原因 + 含缓存尝试证据（已 Read 插件缓存协议文件）→ 无 WARN 放行
  // （ 正面：两级降级路径的第 2 级被正确执行后的合法态）
  {
    name: '77 builtin 含缓存尝试证据 → 无 WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbuiltin-quickcheck — 已尝试 Skill 加载（仅占位）并已 Read 插件缓存协议文件（~/.claude/plugins/cache/brooks-lint-marketplace/...）手动执行，仍不可行，brooks-lint 不可用，按协议降级内置 R1~R6 快查',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 75: guard 读带 BOM 的 state → 正常（——guard readStateJson 的 BOM 容忍）
  {
    name: '75 guard 读带 BOM state 正常',
    run: (dir) => {
      const st = baseState('open');
      st.status = 'running';
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), raw, 'utf8');
      writeFile(dir, '.specs/compose-demo/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runGuard(['entry', 'open'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
    },
  },

  // ----------  场景（S79~S83：worktree 委托链路，P1~P7 实录） ----------

  // 79: P0 路由诊断——TASK 无 status 属性（旧模板形态）→ exit plan --apply 的 P0 路由输出 ROUTE WARN
  // （ P3：结构校验保持严格 + 检测失败纠偏可见——修复前无诊断 = RED）
  // nextNode 只看 completedNodes——P0 路由触发场景 = exit plan（completed 后 nextNode=execute → 路由检查）
  {
    name: '79 P0 路由无匹配输出诊断',
    run: (dir) => {
      const st = baseState('plan');
      st.completedNodes = ['open', 'design'];
      st.evidence.plan = { summary: 'executed' };
      writeState(dir, st);
      // 上游工件（open=CHANGE+REQUIREMENT、design=DESIGN-lite、plan=TASK——TASK 无 status 属性 = 旧模板形态）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n## 用户故事\nx\n## 验收准则（AC）\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN-lite.md', '# DESIGN-lite\n## 决策清单\n- d1: x\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" parallel="true">\n  <action>do</action>\n  <verify>echo ok</verify>\n</task>\n');
      const res = runGuard(['exit', 'plan', '--apply'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'ROUTE WARN');
    },
  },

  // 80: C4 catch 可见化——非 git 仓库 → entry execute 输出 C4-CHECK SKIP
  // （ P4：检测失败也要可见——修复前 catch 静默 = RED）
  {
    name: '80 C4 catch 非 git 仓库输出 SKIP',
    run: (dir) => {
      const st = baseState('execute');
      writeState(dir, st);
      const res = runGuard(['entry', 'execute'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'C4-CHECK SKIP');
    },
  },

  // 81: handoff result commitHash 存在性校验——不存在 → HANDOFF ERROR（固化：校验已存在（W2-D）， P6 确认）
  {
    name: '81 handoff result 无效 commitHash → ERROR（batch-H 固化）',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
      const payload = JSON.stringify({
        status: 'DONE',
        commitHash: 'deadbeef00000000000000000000000000000000',
        redEvidence: { command: 'echo red', output: 'red' },
        greenEvidence: { command: 'echo green', output: 'green' },
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        riskSignals: ['none'],
      });
      const res = runHandoff(['result', 'T01', payload], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF ERROR: commitHash 无效或 git show 失败');
    },
  },

  // 82: entry/exit WARN COUNT 汇总行——构造 BROOKS-LINT WARN → exit 输出 WARN COUNT
  // （ F：可观测性——修复前无汇总行 = RED）
  {
    name: '82 exit 输出 WARN COUNT 汇总',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbuiltin-quickcheck — brooks-lint 不可用（Skill 仅返回占位，插件执行体未加载），按协议降级内置 R1~R6 快查',
      }));
      const res = runGuard(['exit', 'execute'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'BROOKS-LINT WARN');
      assertOut(res, 'WARN COUNT:');
    },
  },

  // 83: 空退出行为固化——全 parallel 任务 exit execute → task-summaries BLOCKED（现状保护，H1 文档一致化的行为锚点）
  {
    name: '83 全 parallel exit execute BLOCKED 产物（batch-H 固化）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" parallel="true" status="pending">\n  <action>do</action>\n</task>\n<task id="T02" parallel="true" status="pending">\n  <action>do2</action>\n</task>\n');
      const res = runGuard(['exit', 'execute'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, 'missing Output Schema artifacts');
    },
  },

  // 84~92: 自动初始化检测（auto-init-detection）——脚本确定性探测/判决/提示 + agent 生成协作
  // 生成职责（2026-08-10 机制修正）：--init-context 时 CONTEXT 缺失 → INIT-GENERATE 指引（不生成、
  // 不写 last_intel_scan），由 agent 全量阅读生成；生成后重跑 → 脚本校验 7 段 → 通过写 last_intel_scan。
  // 84: CONTEXT 缺失 + 有代码上下文 → init 输出 INIT-NEEDED 且不自动生成（基础探测）
  {
    name: '84 CONTEXT 缺失 + 有代码 → init 输出 INIT-NEEDED 不生成',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-NEEDED');
      if (fs.existsSync(path.join(dir, '.specs', 'CONTEXT.md'))) throw new Error('CONTEXT 不应被自动生成');
    },
  },

  // 85: --init-skip → state.ai_context_doc='none'，下次 init 不再提示（拒绝路径）
  {
    name: '85 --init-skip 记 none 且下次 init 静默',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      runState(['init', CHANGE_ID, '--init-skip'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      const st1 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (st1.ai_context_doc !== 'none') throw new Error('ai_context_doc 应为 none');
      const res2 = runState(['init', CHANGE_ID + '-2'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      if (res2.output.includes('INIT-NEEDED') || res2.output.includes('INIT-HINT')) throw new Error('下次 init 不应再提示');
    },
  },

  // 86: CONTEXT 新鲜（last_intel_scan ≤90 天）→ init 零初始化输出（新鲜路径）
  {
    name: '86 CONTEXT 新鲜 → init 零初始化输出',
    run: (dir) => {
      writeState(dir, { ...baseState('open'), last_intel_scan: new Date(Date.now() - 10 * 864e5).toISOString() });
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      if (res.output.includes('INIT-NEEDED') || res.output.includes('INIT-HINT')) throw new Error('不应有初始化提示');
    },
  },

  // 87: 有 CONTEXT 无扫描记录（旧项目迁移）→ INIT-HINT 文案不得含 null
  {
    name: '87 有 CONTEXT 无扫描记录 → INIT-HINT 文案无 null',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-HINT');
      if (res.output.includes('null')) throw new Error('INIT-HINT 不应含 "null"（无扫描记录时用友好文案）');
    },
  },

  // 88: CONTEXT 缺失 + --init-context → INIT-GENERATE 指引且不生成、不写 last_intel_scan（生成协作第一步）
  {
    name: '88 --init-context 无 CONTEXT → INIT-GENERATE 指引不生成',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      if (fs.existsSync(path.join(dir, '.specs', 'CONTEXT.md'))) throw new Error('CONTEXT 不应由脚本生成（生成职责在 agent）');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('校验通过前不应写 last_intel_scan');
    },
  },

  // 89: CONTEXT 缺失 + 既有 AI 文档 + --init-context → INIT-GENERATE 指引含源文档列表
  {
    name: '89 --init-context 指引含源文档列表',
    run: (dir) => {
      writeFile(dir, 'CLAUDE.md', '# CLAUDE\n项目约定：使用 kebab-case 命名。\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      assertOut(res, 'CLAUDE.md');
    },
  },

  // 90: CONTEXT 缺失 + 代码信号 + --init-context → INIT-GENERATE 指引含代码信号
  {
    name: '90 --init-context 指引含代码信号',
    run: (dir) => {
      writeFile(dir, 'requirements.txt', 'pytest\n');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      assertOut(res, '代码信号');
    },
  },

  // 91: CONTEXT 已存在且 7 段 + 模板格式完整 + --init-context → INIT-DONE + last_intel_scan 写入（生成协作第二步）
  {
    name: '91 CONTEXT 7 段+格式完整 --init-context → INIT-DONE + state 写入',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- [2026-08-01] 决策一\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-DONE');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.last_intel_scan) throw new Error('校验通过后应写 last_intel_scan');
    },
  },

  // 92: CONTEXT 存在但缺段 + --init-context → INIT-VALIDATE-FAILED 重写指引 + 不写 last_intel_scan
  {
    name: '92 CONTEXT 缺段 --init-context → 重写指引不写 state',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      assertOut(res, '重写');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('校验失败不应写 last_intel_scan');
    },
  },

  // 93: CONTEXT 7 段齐全但模板格式不满足（已锁决策无日期前缀）→ 格式校验失败重写指引 + 不写 state
  {
    name: '93 CONTEXT 格式不满足模板 → 重写指引不写 state',
    run: (dir) => {
      // 7 段齐全但已锁决策条目缺 [YYYY-MM-DD] 日期前缀（模板格式）
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- 决策缺日期前缀\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      assertOut(res, '日期');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('格式校验失败不应写 last_intel_scan');
    },
  },

  // 94: 新项目骨架 CONTEXT（已锁决策仅占位）→ 占位放行 INIT-DONE（DF-5：占位不是裸条目）
  {
    name: '94 新项目占位 CONTEXT → 校验通过 INIT-DONE',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\n新项目骨架\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| （待沉淀） | 随 change 逐步补充 |\n## 已锁决策\n- （待沉淀——后续 change 按时间倒序追加）\n## 默认偏好\n- 待补充\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-DONE');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.last_intel_scan) throw new Error('占位 CONTEXT 校验通过应写 last_intel_scan');
    },
  },

  // 95: CONTEXT 已满足模板但无扫描记录 + init 无参数 → 提示"记录扫描时间"（C 文案优化——
  // agent 生成后未重跑的悬空态，误导性"扫描时间未知/刷新"文案不出现）
  {
    name: '95 CONTEXT 就绪无扫描记录 → 提示记录扫描时间',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- [2026-08-01] 决策一\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, '记录扫描时间');
      if (res.output.includes('刷新')) throw new Error('CONTEXT 已就绪不应提示"刷新"（应提示记录扫描时间）');
    },
  },

  // 96: init 同 id 重跑（.specs/<id>/ 已存在）→ WARN 防护输出且不阻断（F）
  {
    name: '96 init 同 id 重跑 → WARN 防护不阻断',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'WARN: change ' + CHANGE_ID + ' 已存在');
      assertOut(res, '重置节点状态');
    },
  },

  // 97~98: dogfood 实证的校验误报修复（2026-08-10）
  // 97: 自检方法段内后续行声明方法（子代理把方法名写在列表后续行）→ 放行无 WARN
  // （修复前 guard 正则只匹配段后第一行 → 全文有 cache-brooks 声明 → 误报 BROOKS-LINT WARN = RED）
  {
    name: '97 自检方法段后续行声明 → 放行',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\n- flow-comet-dev Skill 加载成功\n- 自检：第 1 级 brooks-review 返回占位 → 第 2 级 Read 插件缓存协议文件手动执行（selfReview: cache-brooks）',
        sixDim: '## 6 维自查\n\n- 功能: 通过（cache-brooks 审查已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 98: handoff changedFiles 含 *-SUMMARY.md（强制产物）→ 不报越界 WARN
  // （修复前 W2-D 子集校验把强制产物当越界 = RED；真实 commitHash 供 git show 校验）
  {
    name: '98 handoff 含 SUMMARY 文件 → 无越界 WARN',
    run: (dir) => {
      const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      g(['init', '-q']);
      g(['config', 'user.email', 't@t']);
      g(['config', 'user.name', 't']);
      writeFile(dir, 'test_stats.py', 'def f():\n    pass\n');
      writeFile(dir, 'T01-SUMMARY.md', '# T01-SUMMARY\n## 做了什么\nx\n');
      // 只提交指定文件（场景运行器预置的 reference/ 协议文件不入提交集）
      g(['add', 'test_stats.py', 'T01-SUMMARY.md']);
      g(['commit', '-qm', 'init']);
      const hash = g(['rev-parse', 'HEAD']).stdout.trim();
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = {
        handoffRequests: { T01: { writeFiles: ['test_stats.py'] } },
        handoffResult: {},
      };
      writeState(dir, st);
      const res = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', commitHash: hash,
        changedFiles: ['test_stats.py', 'T01-SUMMARY.md'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check test_stats.py', output: 'ok' },
      })], dir);
      assertExit(res, 0);
      if (res.output.includes('超出 writeFiles 范围')) throw new Error('SUMMARY 为强制产物不应报越界 WARN');
    },
  },

  // ----------  场景（S98~S105：completedChecks 真实性声明机制——skill-load/record/exit 校验 + 交叉自洽 + 旧兼容 + 场景数同步，T03） ----------

  // 98: skill-load 写入声明标记（AC-1）——完整命令形态（--prompt flow-kit/prompts/<阶段>.md，
  // 归属校验通过）→ 标记 .specs/<change-id>/.skill-loads/<node>-<skill>.json 生成，
  // 内容含 node/skill/protocol/at（ISO 时间戳）+ 输出确认提示
  {
    name: '98 skill-load 写入声明标记（AC-1）',
    run: (dir) => {
      // 场景内 flow-kit/prompts/ 提示文件（skill-load --prompt 指向——T-FIX-02 后归属校验仅查
      // 前缀不读内容；协议加载走 env reference 路径，文件无需为 JSON）
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'SKILL-LOAD: open flow-comet-change → .skill-loads/open-flow-comet-change.json');
      const markerPath = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json');
      if (!fs.existsSync(markerPath)) throw new Error('标记文件未生成: ' + markerPath);
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.node !== 'open' || marker.skill !== 'flow-comet-change') {
        throw new Error('标记 node/skill 字段不符: ' + JSON.stringify(marker));
      }
      // T-FIX-01: 标记 protocol = --prompt 参数的 basename（与 guard exit 的 D7 表比对同值，
      // 真实链路 skill-load → exit 一致；P1 缺陷时代写 resolveProtocol 解析后的完整绝对路径，
      // 与 D7 表 basename 精确比对必然失败——机制实际不可用，已修复）
      if (marker.protocol !== '0-change.md') {
        throw new Error('标记 protocol 应为 --prompt 参数的 basename 0-change.md: ' + JSON.stringify(marker));
      }
      if (typeof marker.at !== 'string' || Number.isNaN(Date.parse(marker.at))) {
        throw new Error('标记缺 ISO 时间戳 at: ' + JSON.stringify(marker));
      }
    },
  },

  // 99: skill-load 非法参数拒绝（AC-2）——缺 node/skill / node 非法 / skill 名非法字符 /
  // --prompt 不在 flow-kit/prompts/ 下 → 报错 exit 非 0，不写任何标记（.skill-loads/ 无文件）
  {
    name: '99 skill-load 非法参数拒绝不写标记（AC-2）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // a) 缺参数（无 node/skill）
      const rA = runState(['skill-load'], dir, env);
      assertExit(rA, 1);
      assertOut(rA, 'skill-load requires <node> <skill>');
      // b) node 非法（非内置节点）
      const rB = runState(['skill-load', 'bogus', 'flow-comet-change'], dir, env);
      assertExit(rB, 1);
      assertOut(rB, 'skill-load node 非法');
      // c) skill 名含非法字符
      const rC = runState(['skill-load', 'open', 'bad/name'], dir, env);
      assertExit(rC, 1);
      assertOut(rC, 'skill-load skill 名非法');
      // d) --prompt 不在 flow-kit/prompts/ 下（指向场景内 reference 副本——文件存在可加载，
      //    归属校验拒绝；若归属校验被跳过则此处会成功写标记，断言即失效）
      const rD = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'reference/workflow-protocol.json'], dir, env);
      assertExit(rD, 1);
      assertOut(rD, 'skill-load --prompt 路径必须位于 flow-kit/prompts/ 下');
      // 全部拒绝后 .skill-loads/ 不产生任何标记文件
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      if (fs.existsSync(loadsDir) && fs.readdirSync(loadsDir).length > 0) {
        throw new Error('非法参数不应写入标记: ' + fs.readdirSync(loadsDir).join(', '));
      }
    },
  },

  // 100: record 校验 BLOCK（AC-3 反例）——completedChecks 含 required-skill:open.flow-comet-change
  // 条目但无对应声明标记 → BLOCKED + 指引先加载 skill 并运行 skill-load；evidence 不写入
  {
    name: '100 record BLOCKED：completedChecks 缺声明标记（AC-3）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '缺少对应声明标记');
      assertOut(res, 'workflow-state.mjs skill-load open flow-comet-change');
      // BLOCK 先于记录——校验失败后 evidence 不得写入
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (st.evidence && st.evidence.open) throw new Error('BLOCKED 后不应写入 evidence: ' + JSON.stringify(st.evidence.open));
    },
  },

  // 101: record 校验通过（AC-3 正例）——先 skill-load 写入标记，record 带同条 completedChecks → 正常记录
  {
    name: '101 record 通过：先 skill-load 声明标记（AC-3 正例）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const sl = runState(['skill-load', 'open', 'flow-comet-change'], dir, env);
      assertExit(sl, 0);
      assertOut(sl, 'SKILL-LOAD: open flow-comet-change');
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir, env);
      assertExit(res, 0);
      assertOut(res, 'EVIDENCE: open');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.evidence.open || st.evidence.open.summary !== 'done') {
        throw new Error('record 未写入 evidence: ' + JSON.stringify(st.evidence));
      }
    },
  },

  // 102: exit 协议声明标记校验（AC-4）+ 真实链路集成（T-FIX-01）——.skill-loads/ 已激活
  // （目录存在）但无本节点协议标记（<node>-*.json 且 protocol ∈ 该节点协议集，D7 映射表
  // basename）→ BLOCKED；真实 skill-load --prompt 写入的标记（protocol = basename）→ exit 通过
  // （修复后真实链路一致——P1 缺陷时代 skill-load 写解析后完整路径，exit 必 BLOCKED）；未传
  // --prompt（标记 protocol = null）→ BLOCKED；损坏标记（protocol 非协议集）→ BLOCKED
  {
    name: '102 exit 协议标记校验：真实链路通过 / 无标记·null·损坏 BLOCKED（AC-4）',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      // 场景内 flow-kit/prompts/ 提示文件（真实 skill-load --prompt 指向——归属校验仅查前缀不读内容）
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      fs.mkdirSync(loadsDir, { recursive: true });
      // ① 机制已激活（.skill-loads/ 存在）但无 open-* 标记（仅他节点标记）→ BLOCKED
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/design-flow-comet-design.json',
        JSON.stringify({ node: 'design', skill: 'flow-comet-design', protocol: '2-design.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resBlock = runGuard(['exit', 'open'], dir);
      assertExit(resBlock, 1);
      assertOut(resBlock, 'BLOCKED');
      assertOut(resBlock, 'exit 缺协议声明标记');
      // ② 真实链路（T-FIX-01）：skill-load --prompt 写入标记（protocol = basename）→ exit 通过
      const markerPath = path.join(loadsDir, 'open-flow-comet-change.json');
      const sl = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir, env);
      assertExit(sl, 0);
      assertOut(sl, 'SKILL-LOAD: open flow-comet-change');
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.protocol !== '0-change.md') {
        throw new Error('skill-load 标记 protocol 应为 --prompt 参数的 basename 0-change.md: ' + JSON.stringify(marker));
      }
      const resPass = runGuard(['exit', 'open'], dir);
      assertExit(resPass, 0);
      assertOut(resPass, 'ALL CHECKS PASSED');
      assertNotOut(resPass, 'BLOCKED');
      // ③ skill-load 未传 --prompt → 标记 protocol = null → exit BLOCKED（fail-closed：
      // 无协议声明不可通过——指引补 skill-load --prompt）
      const slNull = runState(['skill-load', 'open', 'flow-comet-change'], dir, env);
      assertExit(slNull, 0);
      const markerNull = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (markerNull.protocol !== null) {
        throw new Error('skill-load 未传 --prompt 标记 protocol 应为 null: ' + JSON.stringify(markerNull));
      }
      const resNull = runGuard(['exit', 'open'], dir);
      assertExit(resNull, 1);
      assertOut(resNull, 'BLOCKED');
      assertOut(resNull, 'exit 缺协议声明标记');
      // ④ 损坏标记（protocol 非协议集 basename）→ BLOCKED（fail-closed）
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '9-other.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resCorrupt = runGuard(['exit', 'open'], dir);
      assertExit(resCorrupt, 1);
      assertOut(resCorrupt, 'BLOCKED');
      assertOut(resCorrupt, 'exit 缺协议声明标记');
    },
  },

  // 103: 交叉自洽（AC-5）——标记存在但 at 晚于 record 时间（手工构造未来时间戳）→ BLOCKED
  // （标记必须先于记录声明——时间序可审计）
  {
    name: '103 record BLOCKED：标记 at 晚于记录时间（AC-5 交叉自洽）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2999-12-31T00:00:00.000Z' }, null, 2) + '\n');
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '标记必须先于记录声明');
    },
  },

  // 104: 旧 evidence/旧 change 兼容（AC-6）——旧格式记录（completedChecks 无 required-skill 条目 /
  // 无 completedChecks）无标记照常通过；exit 在 .skill-loads/ 未激活（目录不存在）时
  // SKILL-LOAD WARN 照常通过（D6：声明机制未激活不追溯）
  {
    name: '104 旧 evidence/旧 change 兼容：无标记照常通过（AC-6）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // ① 旧格式 record：completedChecks 无 required-skill 条目 → 无标记也通过
      const resA = runState(['record', 'open', JSON.stringify({ summary: 'legacy', completedChecks: ['unit-tests'] })], dir, env);
      assertExit(resA, 0);
      assertOut(resA, 'EVIDENCE: open');
      // ② 无 completedChecks 的纯 summary 记录 → 通过
      const resB = runState(['record', 'open', JSON.stringify({ summary: 'plain' })], dir, env);
      assertExit(resB, 0);
      // ③ exit open：.skill-loads/ 不存在（声明机制未激活）→ SKILL-LOAD WARN + 通过
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      const resC = runGuard(['exit', 'open'], dir);
      assertExit(resC, 0);
      assertOut(resC, 'SKILL-LOAD WARN');
      assertOut(resC, 'ALL CHECKS PASSED');
    },
  },

  // 105: 场景数一致性自检同步（AC-8）——SCENARIOS.length 变更时 SCENARIO_COUNT_FILES 20 文件须同步
  // （ALL n SCENARIOS PASSED / n scenarios / n 场景 / n/n 变体）。本场景直接读取权威源仓库的
  // 20 文件断言含当前场景数变体——文档漏同步即 RED（与底部自检同判据；安装副本无文档跳过）
  {
    name: '105 场景数自检同步：20 文件含当前场景数变体（AC-8）',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无 flow-comet 文档
      const n = SCENARIOS.length;
      const missing = [];
      for (const rel of SCENARIO_COUNT_FILES) {
        let text;
        try {
          text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
        } catch (e) {
          if (e.code === 'ENOENT') continue; // 文件不存在跳过（与底部自检一致）
          throw e;
        }
        const ok = text.includes('ALL ' + n + ' SCENARIOS PASSED')
          || text.includes(n + ' scenarios')
          || text.includes(n + ' 场景')
          || text.includes(n + '/' + n);
        if (!ok) missing.push(rel);
      }
      if (missing.length > 0) {
        throw new Error('场景数未同步（应为 ' + n + '）: ' + missing.join(', '));
      }
    },
  },
];

// ---------- 运行 ----------

for (const sc of SCENARIOS) {
  const dir = makeTmp();
  try {
    // T06: 协议路径适配——真实项目协议位于 <项目根>/reference/workflow-protocol.json（runRoot 内）。
    // T03 起 workflow-guard 用 readProtocolFile（protected-path：协议路径必须在 runRoot 内），
    // 场景 runRoot=tmpdir、内置协议默认路径在 packageRoot（tmpdir 外）→ 复制到 <dir>/reference/ 内，
    // 由 runGuard 的 FLOW_COMET_PROTOCOL env 指向场景内副本。场景内 writeFile('reference/...') 或
    // --protocol CLI 覆盖保持后写优先语义（CLI --protocol 优先级高于 env）。
    const builtinCopy = path.join(dir, 'reference', 'workflow-protocol.json');
    fs.mkdirSync(path.dirname(builtinCopy), { recursive: true });
    fs.copyFileSync(BUILTIN_PROTOCOL_SOURCE, builtinCopy);
    sc.run(dir);
    passed += 1;
    console.log('PASS: ' + sc.name);
  } catch (e) {
    failures.push({ name: sc.name, error: e.message });
    console.error('FAIL: ' + sc.name + '\n' + e.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('RESULT: ' + passed + '/' + SCENARIOS.length + ' scenarios passed');

// 文档一致性自检（场景数纪律 + 公开产物零代号纪律工具化，2026-08-10）：
// ① 场景数：全清单文档（公开 10 + 内部 6 + CLAUDE）须与 SCENARIOS.length 一致（全变体检查）；
// ② 内部概念：公开文档不得含过程代号（S 编号/T-FIX/batch/D-NN/P0/dogfood/round/内部——历史 CHANGELOG 回归实证）。
// 仅权威源仓库（含 .comet/bundle-drafts 锚点）执行；安装副本（目标项目）无 flow-comet 文档，跳过。
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const isAuthoritativeSource = fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'));
if (isAuthoritativeSource) {
  // ① 场景数全清单（公开双语 + 内部文档 + CLAUDE + PR 模板；全变体：ALL n SCENARIOS / n scenarios / n 场景 / n/n）
  // SCENARIO_COUNT_FILES 为模块级常量（S105 场景与底部自检共用同一清单，见文件头定义）
  for (const rel of SCENARIO_COUNT_FILES) {
    const docPath = path.join(repoRoot, rel);
    try {
      const text = fs.readFileSync(docPath, 'utf8');
      const n = SCENARIOS.length;
      const ok = text.includes('ALL ' + n + ' SCENARIOS PASSED')
        || text.includes(n + ' scenarios')
        || text.includes(n + ' 场景')
        || text.includes(n + '/' + n);
      if (!ok) throw new Error(rel + ' 场景数未同步（应为 ' + n + '）');
    } catch (e) {
      if (e.code !== 'ENOENT') {
        failures.push({ name: '场景数一致性(' + rel + ')', error: e.message });
        console.error('FAIL: 场景数一致性(' + rel + ')\n' + e.message);
      }
    }
  }

  // ② 公开文档零代号（公开产物纪律——CHANGELOG 历史 S 编号回归的教训，2026-08-10）
  const PUBLIC_DOCS = [
    'README.md', 'README-zh.md', 'CONTRIBUTING.md', 'CONTRIBUTING-zh.md',
    'CHANGELOG.md', 'CHANGELOG-zh.md',
    'docs/INSTALLATION.md', 'docs/INSTALLATION-zh.md', 'docs/MECHANISM.md', 'docs/MECHANISM-zh.md',
    'docs/USAGE.md', 'docs/USAGE-zh.md', 'docs/PROTOCOL.md', 'docs/PROTOCOL-zh.md',
    'docs/TROUBLESHOOTING.md', 'docs/TROUBLESHOOTING-zh.md', 'docs/VERSIONS.md', 'docs/VERSIONS-zh.md',
    'docs/ECOSYSTEM.md', 'docs/ECOSYSTEM-zh.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/1-bug_report.md', '.github/ISSUE_TEMPLATE/2-feature_request.md',
    '.github/ISSUE_TEMPLATE/3-question.md', '.github/ISSUE_TEMPLATE/4-task.md',
  ];
  const INTERNAL_CODE_RE = /\bS\d{2}\b|T-FIX|batch-|D-\d+|P0|dogfood|round\s*\d|内部/;
  for (const rel of PUBLIC_DOCS) {
    const docPath = path.join(repoRoot, rel);
    try {
      const text = fs.readFileSync(docPath, 'utf8');
      const m = text.match(INTERNAL_CODE_RE);
      if (m) throw new Error(rel + ' 含过程代号: "' + m[0] + '"');
    } catch (e) {
      if (e.code !== 'ENOENT') {
        failures.push({ name: '公开产物零代号(' + rel + ')', error: e.message });
        console.error('FAIL: 公开产物零代号(' + rel + ')\n' + e.message);
      }
    }
  }
}

// 清理验证：自测套件自身创建的临时目录不留残留
const residue = createdDirs.filter((d) => fs.existsSync(d));
if (residue.length > 0) {
  failures.push({ name: '临时目录清理', error: '残留目录: ' + residue.join(', ') });
  console.error('FAIL: 临时目录清理\n残留目录: ' + residue.join(', '));
}

if (failures.length > 0) {
  console.error('FAILED SCENARIOS: ' + failures.length);
  for (const f of failures) {
    console.error('- ' + f.name + '\n' + f.error);
  }
  process.exit(1);
}

console.log('ALL ' + SCENARIOS.length + ' SCENARIOS PASSED');
