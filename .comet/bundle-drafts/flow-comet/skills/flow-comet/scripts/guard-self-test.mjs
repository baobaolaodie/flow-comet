#!/usr/bin/env node
// C1 · flow-comet 引擎自测套件（184 场景：节点门禁 entry/exit 校验正反例与 WARN 渐进、自定义协议加载路由与防线、TASK 签名与 next 推进、handoff Return Contract 与时间序、init 状态机与 hook 写白名单、CONTEXT 自动初始化检测、completedChecks 真实性声明机制（skill-load/record/exit 校验 + 交叉自洽 + 旧兼容）、init 参数误用防护、执行遗漏防护、严格模式、验证失败计数按变更隔离、多趟路由依赖图校验（环/缺失依赖 BLOCK 与混排合法锚）、契约解析失败检测、场景数一致性自检、prepare-env 平台选择链、零提交边界与入口首部强制、多趟出口硬化（可运行串行放行与拦截双向锚、单行分号 write_files 容错、收尾态路由静默、死结提示与技能文本锁））
//
// 每个场景 = 独立临时目录（fs.mkdtemp）+ 伪造 .comet/flow-comet-state.json
// （currentNode + evidence + executionMode:'subagent'，满足前置校验）+
// .specs/<change>/ 工件 → spawnSync 跑 workflow-guard.mjs <entry|exit> <node>
// （COMET_RUN_ROOT=<临时目录>）→ 断言退出码与输出关键词。场景跑完 rmSync 清理。
//
// 运行: node scripts/guard-self-test.mjs
// 全过 → exit 0，输出 ALL 184 SCENARIOS PASSED；失败 → exit 1，列出场景名+实际输出+exit code
//
// 仅 node 内置模块（child_process/fs/os/path）；无网络；不依赖 flow-kit 模板目录
// 存在（fallback 场景用内置段名；部分场景复制模板文件进临时目录验证 C2 模板派生）。
//
// 自定义协议路径适配：T03 起 workflow-guard 用 readProtocolFile（protected-path：
// 协议路径必须在 runRoot 内）。场景 runRoot=临时目录、内置协议默认路径在 packageRoot
// （脚本所在仓库，tmpdir 外）→ 全部场景曾报 "workflow protocol file must stay inside the
// project root"。修复（测试场景适配，非弱化断言）：真实项目协议位于 <项目根>/reference/
// workflow-protocol.json（runRoot 内）——每个场景把内置协议复制到 <dir>/reference/ 并由
// runGuard 的 FLOW_COMET_PROTOCOL 指向场景内副本；自定义协议场景用 --protocol CLI（优先级
// 最高）或 env 覆盖。自定义协议场景组同时覆盖 AC-2/3/4/5/6（加载路由、通用层防线、特化
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
// prepare-env 安装器（平台选择链场景——真实脚本,场景用临时目录 + spawn 断言）：
// 权威源仓库脚本位于仓库根 scripts/prepare-env.mjs（6 级 .. = 仓库根）；安装副本无此脚本,场景跳过
const PREPARE_ENV = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'scripts', 'prepare-env.mjs');
// 内置协议源文件（packageRoot/reference/）：场景复制到 <tmpdir>/reference/ 内（protected-path 要求 runRoot 内）
const BUILTIN_PROTOCOL_SOURCE = path.join(__dirname, '..', 'reference', 'workflow-protocol.json');
const CHANGE_ID = 'ch';

// 场景数一致性自检清单（21 文件，全变体：ALL n SCENARIOS PASSED / n scenarios / n 场景 / n/n）——
// 场景数自检与底部自检共用同一清单（自检常量同步：SCENARIOS.length 变更 → 21 文件须同步）。
// CLAUDE.md 为主仓私有指导文件（gitignore 不随 clone 分发）——不在自检清单内（2026-08-16 决策：
// 清单只针对随仓库分发的文件；CLAUDE.md 场景数由人工维护）
const SCENARIO_COUNT_FILES = [
  'README.md', 'README-zh.md', 'CONTRIBUTING.md', 'CONTRIBUTING-zh.md',
  'docs/INSTALLATION.md', 'docs/INSTALLATION-zh.md', 'docs/MECHANISM.md', 'docs/MECHANISM-zh.md',
  'docs/VERSIONS.md', 'docs/VERSIONS-zh.md', '.github/PULL_REQUEST_TEMPLATE.md',
  'CHANGELOG.md', 'CHANGELOG-zh.md',
  'docs/internal/ARCHITECTURE.md', 'docs/internal/DOC-CHECKLIST.md', 'docs/internal/MECHANISM.md',
  'docs/internal/next-change-prompt.md', 'docs/internal/ROADMAP.md', 'docs/internal/WORKING-METHOD.md',
  // T9: CI workflow 文件纳入场景数自检（此前盲区——ci.yml 注释/greeting 欢迎消息的
  // 场景数字样游离,发布时靠人工核对;纳入后自检强制同步,防漏）
  '.github/workflows/ci.yml', '.github/workflows/greeting.yml',
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

// 跑 scripts/prepare-env.mjs（真实安装器——平台选择链场景）。cwd=临时目录；
// envOverrides 可覆盖 DSH_HOME（dsh 平台 installHooks 写 $DSH_HOME——场景必须设
// DSH_HOME=临时目录环境变量,禁止污染真实 ~/.dsh；spawn 非 TTY:走探测/默认路径,不触发交互）
function runPrepareEnv(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [PREPARE_ENV, ...args], {
    cwd: root,
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout: 120000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

function assertExit(res, expected) {
  if (res.status !== expected) {
    throw new Error('期望 exit ' + expected + '，实际 exit ' + res.status + '\n实际输出:\n' + res.output);
  }
}

// 输出字符串归一化：spawnSync 原始结果的 .output 恒为数组 [null, stdout, stderr]
// （.includes 逐元素比较永不中关键字）；run* 助手已归一化为字符串。两种形态都归一后再
// 断言，保证共享助手对「数组（stdout+stderr 拼接）」与「既有字符串」形态都成立（回归兼容）。
function outputText(res) {
  return Array.isArray(res?.output)
    ? String(res.stdout || '') + String(res.stderr || '')
    : String(res?.output || '');
}

function assertOut(res, keyword) {
  const text = outputText(res);
  if (!text.includes(keyword)) {
    throw new Error('输出缺少关键词 ' + JSON.stringify(keyword) + '（exit ' + res.status + '）\n实际输出:\n' + text);
  }
}

function assertNotOut(res, keyword) {
  const text = outputText(res);
  if (text.includes(keyword)) {
    throw new Error('输出不应包含关键词 ' + JSON.stringify(keyword) + '（exit ' + res.status + '）\n实际输出:\n' + text);
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

// 含 requiredSkillCalls 的自定义协议变体——compose 自定义节点可声明必调 skill
// （compose SKILL 节点组装 requiredSkillCalls 可空）；skill-load/record 端到端验证用：
// 仅 brainstorm 带 main scope 绑定（协调者加载 → 需 skill-load 声明标记），其余与 customProtocol() 同
function customProtocolWithSkillCall() {
  const p = customProtocol();
  p.nodes[0].requiredSkillCalls = [{ skill: 'flow-comet-brainstorm', scope: 'main' }];
  return p;
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
// required-skill:subagent-execute.flow-comet-dev（guard W1-D 严格校验；相关场景同步补齐，
// 缺该字段的旧格式材料已明确覆盖 BLOCKED 路径）
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
const TASK_DONE_TWO =
  '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="T02" status="done"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify></task>\n';
const TASK_SERIAL_PENDING =
  '<task id="T01"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n';
const TASK_P1 =
  '<task id="P01" status="done" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n';
const TASK_P2 =
  '<task id="P02" status="done" parallel="true"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n';
// 第二波 parallel pending 任务（depends_on P01 已满足——第一波 P01 done 后才可委托；
// status 属性在前，与上方 parallel 任务常量的属性顺序一致）
const TASK_P2_PENDING =
  '<task id="P02" status="pending" parallel="true"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>P01</depends_on></task>\n';
// 串行 pending 任务（depends P01,P02——第二波 P02 完成前不可执行）
const TASK_T03_PENDING =
  '<task id="T03"><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
// review/verify 阶段追加的 pending 修复任务（标准回退路径触发源）
const TASK_TFIX =
  '<task id="T-FIX-01" status="pending"><action>修复 verify 发现的缺陷</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n';

// ---------- 波次分组合法性场景任务集（T01 新增） ----------
// parallel="true" = 并行任务，parallel="false"/缺省 = 串行任务；序列判定以 <task> 块出现顺序为准。
// 回归（bot 审查 · 解析一致性）：混排集里 P01 写成属性序 status 在前（status="pending" parallel="true"），
// 且串行任务 T01 的 <action> 文本内含 literal parallel="true" 字样（不改变语义）——开标签解析
// 属性序无关且不被块内文本干扰（旧整块查找会误判 T01 为并行 → 混排漏报）。
// 串→并→串（S→P→S）：串行 T01 → 并行 P01/P02 → 串行 T02（混排，禁止）
const TASK_MIXED_SPS =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01（串行任务，动作描述含 literal parallel="true" 字样，不影响并行标记）</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="P01" status="pending" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
// 并→串→并（P→S→P）：并行 P01/P02 → 串行 T01 → 并行 P03/P04（混排，禁止）。
// 回归同上：P01 属性序 status 在前；串行任务 T01 的 <action> 文本含 literal parallel="true"。
const TASK_MIXED_PSP =
  '<task id="P01" status="pending" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n' +
  '<task id="T01" parallel="false" status="pending"><action>实现 T01（串行任务，动作描述含 literal parallel="true" 字样，不影响并行标记）</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify><depends_on>P01,P02</depends_on></task>\n' +
  '<task id="P03" parallel="true" status="pending"><action>实现 P03</action><write_files>src/p3.mjs</write_files><verify>node --check src/p3.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="P04" parallel="true" status="pending"><action>实现 P04</action><write_files>src/p4.mjs</write_files><verify>node --check src/p4.mjs</verify><depends_on>T01</depends_on></task>\n';
// 并存前+串在后（P→S）：并行 P01/P02 → 串行 T01（合法成组）
const TASK_VALID_PS =
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n' +
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
// 串在前+并在后（S→P）：串行 T01 → 并行 P01/P02（合法成组）
const TASK_VALID_SP =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>T01</depends_on></task>\n';
// 全串行（全 S）
const TASK_VALID_ALL_SERIAL =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>T01</depends_on></task>\n';
// 全并行（全 P，单连续块）
const TASK_VALID_ALL_PARALLEL =
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n' +
  '<task id="P03" parallel="true" status="pending"><action>实现 P03</action><write_files>src/p3.mjs</write_files><verify>node --check src/p3.mjs</verify></task>\n' +
  '<task id="P04" parallel="true" status="pending"><action>实现 P04</action><write_files>src/p4.mjs</write_files><verify>node --check src/p4.mjs</verify></task>\n';

// ---------- 多趟路由场景任务集（多趟语义批次：依赖环拦截与缺失依赖拦截场景原位重写 + 尾部新增场景族） ----------
// 依赖环：P01↔P02 互为 depends_on（依赖图有环 → plan 出口 BLOCKED 含「依赖环」+ depends_on 恢复指引）
const TASK_DEP_CYCLE =
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>P02</depends_on></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>P01</depends_on></task>\n';
// 依赖缺失：P01 依赖不存在的 T99（依赖链不可满足 → plan 出口 BLOCKED 含恢复指引）
const TASK_MISSING_DEP =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="P01" status="pending" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T99</depends_on></task>\n';

// 波次分组场景公共路径：注入 TASK.md → entry plan（记录 enteredNodes，新 change 强制先 entry；
// 旧 change 亦先 entry 避免 ENTER WARN 干扰断言）→ exit plan。返回 exit plan 结果。
function runPlanExit(dir, taskContent) {
  writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 任务清单\n\n' + taskContent);
  assertExit(runGuard(['entry', 'plan'], dir), 0);
  return runGuard(['exit', 'plan'], dir);
}

// 多波混合任务集：串 T01 → 并 P01/P02(dep T01) → 串 T02(dep P01,P02) → 并 P03/P04(dep T02)。
// ≥2 个并行块被串行任务分隔（混排合法锚 / 多趟推进完成场景共用）；doneIds 控制各任务 status，
// 模拟执行推进（next 分趟路由断言用）。
const MULTI_WAVE_TASKS = [
  ['T01', false, []],
  ['P01', true, ['T01']],
  ['P02', true, ['T01']],
  ['T02', false, ['P01', 'P02']],
  ['P03', true, ['T02']],
  ['P04', true, ['T02']],
];

function renderMultiWaveTasks(doneIds = []) {
  const done = new Set(doneIds);
  return MULTI_WAVE_TASKS.map(([id, parallel, deps]) =>
    '<task id="' + id + '"' + (parallel ? ' parallel="true"' : ' parallel="false"') +
    ' status="' + (done.has(id) ? 'done' : 'pending') + '">' +
    '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
    '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
    (deps.length > 0 ? '<depends_on>' + deps.join(',') + '</depends_on>' : '') +
    '</task>\n').join('');
}

// 多波 next 断言公共材料：前序产物文件（open/design/plan 的产物门控按文件推导）
function writeIntakeArtifacts(dir) {
  writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\nx');
  writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\nx\n\n## 验收准则（AC）\n\n- Given x When y Then z');
  writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n\nNode\n\n## 决策清单\n\n| # | D | R |\n|---|---|---|\n| D1 | x | y |');
}

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
      // 变体:自检方法段名带括号后缀(执行者按模板标题原样书写,如 "## 自检方法（声明 brooks-review 或 builtin-quickcheck）")
      // → 段名识别放宽后通过,无"旧格式"兼容 WARN
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法（声明 brooks-review 或 builtin-quickcheck）\n\nbrooks-review',
      }));
      const resVariant = runGuard(['exit', 'execute'], dir);
      assertExit(resVariant, 0);
      assertOut(resVariant, 'ALL CHECKS PASSED');
      assertNotOut(resVariant, 'BROOKS-LINT WARN');
      // 变体负例:段名匹配(含括号后缀,但括号说明不含方法词)且段内无自检方法声明
      // → 缺自检方法 BLOCKED(六维自查也须不含方法词——全文兼容检测会命中)
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法（声明自检方法）\n\n（未声明任何方法）',
        sixDim: '## 6 维自查\n\n- 功能: 通过\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const resVariantNeg = runGuard(['exit', 'execute'], dir);
      assertExit(resVariantNeg, 1);
      assertOut(resVariantNeg, '自检方法');
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

  // ---------- 分组场景（分支校验 + 追加位置检测） ----------

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

  // 21: exit verify——LESSONS.md 条目编号乱序 → WARN 不 BLOCK；verify 命令 timeout 可配置：
  // ① 缺省 timeout（无 env）下耗时命令通过（缺省保持大值）；② env
  // FLOW_COMET_VERIFY_TIMEOUT_MS 覆盖生效——设小值后同耗时命令超时 BLOCK
  {
    name: '21 exit verify WARN：LESSONS.md 编号乱序 + verify timeout env 覆盖',
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
      // 子断言:无区外条目时不得打印"条目在条目区外"WARN(误报修复——修复前
      // console.error 在 if(outside) 之外无条件执行,每次 exit 都刷一条空 WARN)
      assertNotOut(res, '条目在条目区外');
      // 子断言:## 验证命令 段标题带括号后缀(与 ## 自检方法 段括号后缀兼容风格一致)不误 BLOCK
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令（必填 · exit verify 真实执行）\n\n```bash\nnode -e "1"\n```\n');
      const resBracket = runGuard(['exit', 'verify'], dir);
      assertExit(resBracket, 0);
      assertOut(resBracket, 'ALL CHECKS PASSED');
      // ① 缺省 timeout（未设 env）保持大值：1.5s 耗时命令通过（若缺省被误改小 → 超时 RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "setTimeout(()=>{}, 1500)"\n```\n');
      const resDefault = runGuard(['exit', 'verify'], dir);
      assertExit(resDefault, 0);
      assertOut(resDefault, 'ALL CHECKS PASSED');
      // ② env 覆盖生效：FLOW_COMET_VERIFY_TIMEOUT_MS=500 时 1.5s 命令超时 → BLOCKED
      // （不设 env 时同命令走缺省 300s 会通过——env 覆盖被忽略即 RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "setTimeout(()=>{}, 1500)"\n```\n');
      const resEnv = runGuard(['exit', 'verify'], dir, { FLOW_COMET_VERIFY_TIMEOUT_MS: '500' });
      // 超时 kill 的 cmd 孙进程（node）孤儿化后短暂存活，其 cwd 锁定场景目录
      // （Windows：父 cmd 被杀、孙进程继续跑完自身定时器）——在断言前同步等待其
      // 自然退出，避免场景收尾 rmSync 因目录被占用而失败（EPERM/EBUSY）
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 2000)']);
      assertExit(resEnv, 1);
      assertOut(resEnv, 'BLOCKED: verify 命令失败');
      assertOut(resEnv, 'timeout 500ms');
      // 子断言:失败计数按 change 写入(guard 侧递增语义)
      const stFail = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (!stFail.verifyFailuresByChange || stFail.verifyFailuresByChange[CHANGE_ID] !== 1) {
        throw new Error('exit verify 失败计数未按 change 写入: ' + JSON.stringify(stFail.verifyFailuresByChange));
      }
      // 子断言:再次失败递增(2/3);恢复快速命令后 exit --apply 成功清零当前 change
      const resEnv2 = runGuard(['exit', 'verify'], dir, { FLOW_COMET_VERIFY_TIMEOUT_MS: '500' });
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 2000)']);
      assertExit(resEnv2, 1);
      const stFail2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (!stFail2.verifyFailuresByChange || stFail2.verifyFailuresByChange[CHANGE_ID] !== 2) {
        throw new Error('exit verify 失败计数未递增: ' + JSON.stringify(stFail2.verifyFailuresByChange));
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      const resPass = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(resPass, 0);
      const stPass = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (!stPass.verifyFailuresByChange || stPass.verifyFailuresByChange[CHANGE_ID] !== 0) {
        throw new Error('exit verify 成功未清零当前 change 计数: ' + JSON.stringify(stPass.verifyFailuresByChange));
      }
    },
  },

  // 22: exit archive——CHANGELOG.md 表格日期非倒序 → WARN 不 BLOCK;
  // 子断言:归档缺 KNOWN-ISSUES.md(遗留清单,协议 required 产物)→ BLOCKED
  {
    name: '22 exit archive WARN：CHANGELOG.md 表格日期非倒序',
    run: (dir) => {
      const st = baseState('archive');
      st.evidence.archive = { summary: 'archived' };
      writeState(dir, st);
      writeFile(dir, '.specs/archive/foo-' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/archive/foo-' + CHANGE_ID + '/KNOWN-ISSUES.md', '# KNOWN-ISSUES\n\n无遗留问题\n');
      writeFile(dir, '.specs/CHANGELOG.md', '# CHANGELOG\n\n| 日期 | 说明 |\n|------|------|\n| 2026-08-03 | a |\n| 2026-08-04 | b |\n');
      const res = runGuard(['exit', 'archive'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: CHANGELOG.md 表格日期非倒序');
      // 子断言:CHANGELOG 未登记本 change → WARN 渐进(归档收尾登记兜底——
      // 修复前无检测,执行者遗漏登记可静默进归档,此处应 RED)
      assertOut(res, '未登记本 change');
      // 子断言:登记后无未登记 WARN
      writeFile(dir, '.specs/CHANGELOG.md', '# CHANGELOG\n\n| 日期 | 说明 |\n|------|------|\n| 2026-08-15 | ' + CHANGE_ID + ' | 归档登记 |\n');
      const resRegistered = runGuard(['exit', 'archive'], dir);
      assertExit(resRegistered, 0);
      assertNotOut(resRegistered, '未登记本 change');
      // 子断言:归档缺 KNOWN-ISSUES.md(遗留清单为强制产物)→ BLOCKED
      fs.rmSync(path.join(dir, '.specs/archive/foo-' + CHANGE_ID, 'KNOWN-ISSUES.md'));
      const resMissing = runGuard(['exit', 'archive'], dir);
      assertExit(resMissing, 1);
      assertOut(resMissing, 'missing Output Schema artifacts');
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

  // ---------- 分组场景（自定义协议加载路由 + 通用层防线 + 特化校验绑定 + hook 白名单缺省） ----------

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

  // ----------  场景（自定义协议全部完成 → NEXT: done；部分完成仍走产物推导） ----------

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

  // ----------  场景（handoff completedChecks 严格校验，handoff-guarded 落实） ----------

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

  // ----------  场景（next 节点顺序校验，严格模式） ----------

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
  // （状态漂移校正保留：已完成节点正常推进不受严格校验影响）
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

  // ----------  场景（redEvidence 时间顺序校验） ----------

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

  // ----------  场景（C3 签名行尾规范化 + 回退豁免） ----------

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
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent()); // M2: 新 change 强制 done 任务须有 SUMMARY
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
  // 但 TASK.md 存在 pending 修复任务且 determineNode 推导为 execute → 允许标准回退路径
  // （verify 发现缺陷 → 回 execute），不 BLOCK，输出 NODE: execute
  {
    name: '42 next 回退豁免：verify 未 exit + pending 修复任务 → 允许回 execute',
    run: (dir) => {
      const st = baseState('verify');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      // 前置产物（preExec 门控：open/design/plan 的 CHANGE/REQUIREMENT/DESIGN/TASK）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      // 既有 done 任务 + verify 阶段追加的 pending 修复任务
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P1 + TASK_TFIX);
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 43: next 维持严格 BLOCK——verify 未 exit（evidence 无 verify 记录）且 TASK.md 无 pending
  // 任务（非修复回退）→ 豁免不成立 → 维持  严格拦截，输出恢复指令
  {
    name: '43 next 维持 BLOCK：无 pending 任务（非修复任务回退）',
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

  // ----------  场景（C3 签名标记类属性剥离——completed_at 误报修复） ----------

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
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent()); // M2: 新 change 强制 done 任务须有 SUMMARY
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

  // ----------  场景（next 正常推进豁免——exit 推进后的正常 next 不再被误拦） ----------

  // 46: next 正常推进豁免通过——open exit --apply 已把 currentNode 推进到 design（completedNodes=['open']、
  // design 尚未开始故 evidence 无 design 记录），随后按 SKILL 协议调 next（正常路径）→ 不 BLOCK，
  // 输出 NODE: design（ 误拦回归：修复前此状态被 BLOCK 为"疑似未 exit 节点 design"；
  // open 的 evidence 证明该 exit 真实发生过，满足 normalAdvanceExempt）
  {
    name: '46 next 正常：open exit 推进后 currentNode=design 无 evidence（修复任务回退豁免）',
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
  // →  豁免不成立（回退豁免也不成立：TASK.md 无 pending）→ 严格拦截核心价值
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

  // ----------  场景（机制交互组合——两个机制同时作用，防单机制测试盲区） ----------

  // 48: 组合盲区 A（对照组 A 撞出）——record 覆盖语义 × 越俎代庖检测：先经 workflow-handoff
  // result 正确记录 T01 的 Return Contract（含 completedChecks），随后 record subagent-execute
  // '{"handoffResult":{}}'（浅合并整体替换 handoffResult 键）把已记录的 handoff 覆盖丢失 →
  // exit execute 的越俎代庖检测（统一委托下 done 任务必须有 handoff）BLOCK——
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

  // 49（多趟语义翻转）：路由 × 节点推进——subagent-execute 已 completed（第一波 parallel 全 done +
  // exit，completedNodes 含该节点）后，第二波 parallel 任务（P02，depends 已满足）出现时：
  // next 重新路由回 subagent-execute（多趟循环路由——委托进入谓词每趟重新求值，单趟限制已移除）；
  // entry subagent-execute 仍放行（completedNodes 含该节点允许重入——每趟完整 entry 检查不绕过）
  {
    name: '49 next 二次路由回 subagent-execute + entry 重入（多趟语义）',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2_PENDING + TASK_T03_PENDING);
      const st = baseState('subagent-execute');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      st.evidence['subagent-execute'] = { summary: 'wave1 delegated and collected' };
      writeState(dir, st);
      // ① next：第二波 eligible 并行存在 → 多趟路由回该节点（旧单趟「不回流」行为已移除）
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // ② entry subagent-execute：completedNodes 含该节点仍可重入（每趟完整 entry 检查）
      const res2 = runGuard(['entry', 'subagent-execute'], dir);
      assertExit(res2, 0);
      assertOut(res2, 'ENTRY OK');
    },
  },

  // ---------- 审查补充场景（2026-08-08：validateProtocolSchema nodes 校验 / 豁免 summary 严格化 / hook 声明模式 fail-closed） ----------

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

  // ----------  场景（分支前缀可配置，适配仓库规范） ----------

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

  // ----------  场景（init 写 status + hook 判定对齐） ----------

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

  // ----------  场景（init 创建 .specs/<id>/ 目录，findActiveChange 立即可识别） ----------

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

  // ----------  场景（归档完成态不兜底识别残留目录） ----------

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

  // ----------  场景（init currentNode 按协议首节点） ----------

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

  // ---------- 补齐场景（兼容分支固化） ----------

  // 61: 旧 state（无 status 字段但有 activeChange）→ hook 按 running 处理（fail-closed 向后兼容，行为固化）
  {
    name: '61 hook fail-closed：旧 state 无 status 有 activeChange 按 running（既有修复固化）',
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

  // 62: init 后（open 阶段）合法写 .specs/ 工件 → hook 放行（ 正确 RED：
  // 修复前 init 无 status → hook「not running」throw exit 1 拦截合法写入——open 阶段无法产出工件）
  {
    name: '62 hook 放行：init 后写 .specs/ 工件',
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

  // 63: 新 change 与旧归档同名（state 缺失时走扫描兜底）→ 应识别为 active（ 扩展边界：
  // archivedIds 剥日期前缀匹配不得误伤同名新 change）
  {
    name: '63 同名新 change 不被归档检查误跳过',
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

  // ---------- 独立验证补充场景（验证者发现） ----------

  // 64: record 命令的 --protocol 参数不得污染 payload（：payload 解析前剥离）
  {
    name: '64 record --protocol 不污染 payload',
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

  // 65: 自定义协议未声明 writeWhitelist 时，非内置节点写源码 → BLOCK（ 方案 B：
  // 协调者默认 .specs/——当前 fail-open 放行）
  {
    name: '65 自定义节点未声明白名单写源码 BLOCK',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 2);
    },
  },

  // 66: 自定义协议未声明白名单时，写 .specs/ 工件 → 放行（ 协调者默认的正面）
  {
    name: '66 自定义节点未声明白名单写工件放行',
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

  // 67: 旧格式 state（无 status 字段 + 无 activeChange + 无 currentNode——批次 C 归档后升级场景）
  // → hook 放行（：无 activeChange 与无 state 文件同语义——当前被「not running」拦截）
  {
    name: '67 旧 state 无 status 无 activeChange hook 放行',
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

  // 68: writeWhitelist 路径支持 <change-id> 占位符（：协议复用自动适配——
  // 与 artifacts paths 同机制——当前字面匹配失败 BLOCK）
  {
    name: '68 writeWhitelist change-id 占位符',
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

  // 69: 自定义协议 init 输出 NODE: 协议首节点（：printNext 硬编码 open——输出与 state 不一致）
  {
    name: '69 init 输出 NODE 协议首节点',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const res = runState(['init', 'tf17-out'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'NODE: brainstorm');
      assertNotOut(res, 'NODE: open');
    },
  },

  // 70: state completed + activeChange 非空（残留值）→ status 应 no-change（：
  // completed 检查优先于 activeChange 分支——当前 activeChange 分支先命中误判）
  {
    name: '70 completed state 残留 activeChange 不误判',
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

  // 71: 自定义协议未声明 state.statePath（最小 schema）→ hook 不崩溃，写 .specs/ 放行
  // （：statePath 缺省回退 .comet/flow-comet-state.json——与 workflow-state 硬编码一致；
  //  当前空值解析崩溃 exit 1 全量拦截）
  {
    name: '71 无 statePath 协议 hook 不崩溃',
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

  // 72: state 文件带 UTF-8 BOM（外部写入如会话 Write）→ status 正常输出（：
  // 读端 JSON.parse 应容忍 BOM——当前崩）
  {
    name: '72 state 带 BOM 正常读取',
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

  // 73: hook 读带 BOM 的 state → 判定正常（——hook readStateJson 的 BOM 容忍）
  {
    name: '73 hook 读带 BOM state 正常',
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

  // ----------  场景（builtin 降级须含缓存尝试证据） ----------

  // 74: builtin-quickcheck 声明 + 不可用原因但无缓存尝试证据 → BROOKS-LINT WARN
  // （：防「未尝试 Read 插件缓存协议文件」的偷懒降级——修复前不校验 = RED）
  {
    name: '74 builtin 无缓存尝试证据 → WARN',
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

  // 75: cache-brooks 声明（两级降级路径第 2 级——读缓存手动执行成功）→ 放行
  // （ 补：guard method 正则须识别 cache-brooks——修复前正则不匹配 → 全文无 brooks-review/builtin → BLOCKED = RED）
  {
    name: '75 cache-brooks 声明 → 放行',
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

  // 76: builtin-quickcheck 声明 + 不可用原因 + 含缓存尝试证据（已 Read 插件缓存协议文件）→ 无 WARN 放行
  // （ 正面：两级降级路径的第 2 级被正确执行后的合法态）
  {
    name: '76 builtin 含缓存尝试证据 → 无 WARN',
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

  // 77: guard 读带 BOM 的 state → 正常（——guard readStateJson 的 BOM 容忍）
  {
    name: '77 guard 读带 BOM state 正常',
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

  // ----------  场景（worktree 委托链路，验证问题实录） ----------

  // 78: 路由诊断——「未找到可委托并行块」诊断的在场/静默边界。期望随 multipass-exit-hardening
  // ROUTE WARN 前置条件语义更新（ROUTE WARN 增加存在任一 status=pending 的前置条件）：① 夹具存在可解析 pending
  // 任务（串行 pending + 并行全 done）且无可委托并行块 → ROUTE WARN 保持在场（检测失败纠偏可见
  // ——信息量保留）；② 旧模板无 status 属性形态（无可解析 pending）→ 按新前置条件静默
  // （原「旧模板也告警」行为被设计性取代）。
  // nextNode 只看 completedNodes——路由触发场景 = exit plan（completed 后 nextNode=execute → 路由检查）
  {
    name: '78 路由诊断：有 pending 无可委托并行 WARN 在场 / 无可解析 pending 静默',
    run: (dir) => {
      const st = baseState('plan');
      st.completedNodes = ['open', 'design'];
      st.evidence.plan = { summary: 'executed' };
      writeState(dir, st);
      // 上游工件（open=CHANGE+REQUIREMENT、design=DESIGN-lite、plan=TASK）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n## 用户故事\nx\n## 验收准则（AC）\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN-lite.md', '# DESIGN-lite\n## 决策清单\n- d1: x\n');
      // ① 可解析 pending 在场：并行任务已 done、串行任务 pending → 无可委托并行块 → WARN
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P01" parallel="true" status="done">\n  <action>do</action>\n  <verify>echo ok</verify>\n</task>\n' +
        '<task id="T01" parallel="false" status="pending">\n  <action>do serial</action>\n  <verify>echo ok</verify>\n</task>\n');
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const res = runGuard(['exit', 'plan', '--apply'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'ROUTE WARN');
      // ② 旧模板无 status 属性（无可解析 pending）→ 前置条件跳过诊断 → 静默
      //（① 的 --apply 已把 currentNode 推进到 execute——先复位 state 再独立跑第二半）
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T02" parallel="true">\n  <action>do legacy</action>\n  <verify>echo ok</verify>\n</task>\n');
      const resLegacy = runGuard(['exit', 'plan', '--apply'], dir, env);
      assertExit(resLegacy, 0);
      assertNotOut(resLegacy, 'ROUTE WARN');
    },
  },

  // 79: C4 catch 可见化——非 git 仓库 → entry execute 输出 C4-CHECK SKIP
  // （检测失败也要可见——修复前 catch 静默 = RED）
  {
    name: '79 C4 catch 非 git 仓库输出 SKIP',
    run: (dir) => {
      const st = baseState('execute');
      writeState(dir, st);
      const res = runGuard(['entry', 'execute'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'C4-CHECK SKIP');
    },
  },

  // 80: handoff result commitHash 存在性校验——不存在 → HANDOFF ERROR（固化：校验已存在（W2-D），经确认）
  {
    name: '80 handoff result 无效 commitHash → ERROR（batch-H 固化）',
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

  // 81: entry/exit WARN COUNT 汇总行——构造 BROOKS-LINT WARN → exit 输出 WARN COUNT
  // （ F：可观测性——修复前无汇总行 = RED）
  {
    name: '81 exit 输出 WARN COUNT 汇总',
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

  // 82: 空退出行为固化——全 parallel 任务 exit execute → task-summaries BLOCKED（现状保护，H1 文档一致化的行为锚点）
  {
    name: '82 全 parallel exit execute BLOCKED 产物（batch-H 固化）',
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

  // 83~91: 自动初始化检测（auto-init-detection）——脚本确定性探测/判决/提示 + agent 生成协作
  // 生成职责（2026-08-10 机制修正）：--init-context 时 CONTEXT 缺失 → INIT-GENERATE 指引（不生成、
  // 不写 last_intel_scan），由 agent 全量阅读生成；生成后重跑 → 脚本校验 7 段 → 通过写 last_intel_scan。
  // 83: CONTEXT 缺失 + 有代码上下文 → init 输出 INIT-NEEDED 且不自动生成（基础探测）
  {
    name: '83 CONTEXT 缺失 + 有代码 → init 输出 INIT-NEEDED 不生成',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-NEEDED');
      if (fs.existsSync(path.join(dir, '.specs', 'CONTEXT.md'))) throw new Error('CONTEXT 不应被自动生成');
    },
  },

  // 84: --init-skip → state.ai_context_doc='none'，下次 init 不再提示（拒绝路径）
  {
    name: '84 --init-skip 记 none 且下次 init 静默',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      runState(['init', CHANGE_ID, '--init-skip'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      const st1 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (st1.ai_context_doc !== 'none') throw new Error('ai_context_doc 应为 none');
      const res2 = runState(['init', CHANGE_ID + '-2'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      if (res2.output.includes('INIT-NEEDED') || res2.output.includes('INIT-HINT')) throw new Error('下次 init 不应再提示');
    },
  },

  // 85: CONTEXT 新鲜（last_intel_scan ≤90 天）→ init 零初始化输出（新鲜路径）
  {
    name: '85 CONTEXT 新鲜 → init 零初始化输出',
    run: (dir) => {
      writeState(dir, { ...baseState('open'), last_intel_scan: new Date(Date.now() - 10 * 864e5).toISOString() });
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      if (res.output.includes('INIT-NEEDED') || res.output.includes('INIT-HINT')) throw new Error('不应有初始化提示');
    },
  },

  // 86: 有 CONTEXT 无扫描记录（旧项目迁移）→ INIT-HINT 文案不得含 null
  {
    name: '86 有 CONTEXT 无扫描记录 → INIT-HINT 文案无 null',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-HINT');
      if (res.output.includes('null')) throw new Error('INIT-HINT 不应含 "null"（无扫描记录时用友好文案）');
    },
  },

  // 87: CONTEXT 缺失 + --init-context → INIT-GENERATE 指引且不生成、不写 last_intel_scan（生成协作第一步）
  {
    name: '87 --init-context 无 CONTEXT → INIT-GENERATE 指引不生成',
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

  // 88: CONTEXT 缺失 + 既有 AI 文档 + --init-context → INIT-GENERATE 指引含源文档列表
  {
    name: '88 --init-context 指引含源文档列表',
    run: (dir) => {
      writeFile(dir, 'CLAUDE.md', '# CLAUDE\n项目约定：使用 kebab-case 命名。\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      assertOut(res, 'CLAUDE.md');
    },
  },

  // 89: CONTEXT 缺失 + 代码信号 + --init-context → INIT-GENERATE 指引含代码信号
  {
    name: '89 --init-context 指引含代码信号',
    run: (dir) => {
      writeFile(dir, 'requirements.txt', 'pytest\n');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      assertOut(res, '代码信号');
    },
  },

  // 90: CONTEXT 已存在且 7 段 + 模板格式完整 + --init-context → INIT-DONE + last_intel_scan 写入（生成协作第二步）
  {
    name: '90 CONTEXT 7 段+格式完整 --init-context → INIT-DONE + state 写入',
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

  // 91: CONTEXT 存在但缺段 + --init-context → INIT-VALIDATE-FAILED 重写指引 + 不写 last_intel_scan
  {
    name: '91 CONTEXT 缺段 --init-context → 重写指引不写 state',
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

  // 92: CONTEXT 7 段齐全但模板格式不满足（已锁决策无日期前缀）→ 格式校验失败重写指引 + 不写 state
  {
    name: '92 CONTEXT 格式不满足模板 → 重写指引不写 state',
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

  // 93: 新项目骨架 CONTEXT（已锁决策仅占位）→ 占位放行 INIT-DONE（DF-5：占位不是裸条目）
  {
    name: '93 新项目占位 CONTEXT → 校验通过 INIT-DONE',
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

  // 94: CONTEXT 已满足模板但无扫描记录 + init 无参数 → 提示"记录扫描时间"（C 文案优化——
  // agent 生成后未重跑的悬空态，误导性"扫描时间未知/刷新"文案不出现）
  {
    name: '94 CONTEXT 就绪无扫描记录 → 提示记录扫描时间',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- [2026-08-01] 决策一\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, '记录扫描时间');
      if (res.output.includes('刷新')) throw new Error('CONTEXT 已就绪不应提示"刷新"（应提示记录扫描时间）');
    },
  },

  // 95: init 同 id 重跑（.specs/<id>/ 已存在）→ WARN 防护输出且不阻断（F）
  {
    name: '95 init 同 id 重跑 → WARN 防护不阻断',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'WARN: change ' + CHANGE_ID + ' 已存在');
      assertOut(res, '重置节点状态');
    },
  },

  // 96~97: 真实项目端到端验证实证的校验误报修复（2026-08-10）
  // 96: 自检方法段内后续行声明方法（子代理把方法名写在列表后续行）→ 放行无 WARN
  // （修复前 guard 正则只匹配段后第一行 → 全文有 cache-brooks 声明 → 误报 BROOKS-LINT WARN = RED）
  {
    name: '96 自检方法段后续行声明 → 放行',
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

  // 97: handoff changedFiles 含任务专属 SUMMARY(.specs/<change-id>/<task-id>-SUMMARY.md,
  // 精确豁免路径)→ 不报越界 WARN;其他 *-SUMMARY.md(非本任务路径)仍判越界
  // (修复前 W2-D 以 endsWith('-SUMMARY.md') 全量豁免 + 前缀匹配 = RED;真实 commitHash 供 git show 校验)
  {
    name: '97 handoff 含 SUMMARY 文件 → 无越界 WARN',
    run: (dir) => {
      const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      g(['init', '-q']);
      g(['config', 'user.email', 't@t']);
      g(['config', 'user.name', 't']);
      writeFile(dir, 'test_stats.py', 'def f():\n    pass\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', '# T01-SUMMARY\n## 做了什么\nx\n');
      // 只提交指定文件（场景运行器预置的 reference/ 协议文件不入提交集）
      g(['add', 'test_stats.py', '.specs/' + CHANGE_ID + '/T01-SUMMARY.md']);
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
        changedFiles: ['test_stats.py', '.specs/' + CHANGE_ID + '/T01-SUMMARY.md'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check test_stats.py', output: 'ok' },
      })], dir);
      assertExit(res, 0);
      if (res.output.includes('超出 writeFiles 范围')) throw new Error('任务专属 SUMMARY 不应报越界 WARN');
    },
  },

  // ----------  场景（completedChecks 真实性声明机制——skill-load/record/exit 校验 + 交叉自洽 + 旧兼容 + 场景数同步） ----------

  // 98: skill-load 写入声明标记（AC-1）——完整命令形态（--prompt flow-kit/prompts/<阶段>.md，
  // 归属校验通过）→ 标记 .specs/<change-id>/.skill-loads/<node>-<skill>.json 生成，
  // 内容含 node/skill/protocol/at（ISO 时间戳）+ 输出确认提示
  {
    name: '98 skill-load 写入声明标记（AC-1）',
    run: (dir) => {
      // 场景内 flow-kit/prompts/ 提示文件（skill-load --prompt 指向——改名 --prompt 后归属校验仅查
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
      // 标记 protocol = --prompt 参数的 basename（与 guard exit 的 节点协议映射表比对同值，
      // 真实链路 skill-load → exit 一致；缺陷修复前写 resolveProtocol 解析后的完整绝对路径，
      // 与 节点协议映射表 basename 精确比对必然失败——机制实际不可用，已修复）
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
      // e) 自定义协议下未知节点同样拒绝（node 校验从内置清单改为当前协议节点集合
      // 动态读取——协议外节点名依然非法，fail-closed 行为不变）
      const custom = writeCustomProtocol(dir);
      const rE = runState(['skill-load', 'bogus', 'flow-comet-change'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(rE, 1);
      assertOut(rE, 'skill-load node 非法');
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
      // 自定义协议节点（compose 兼容）——node 校验按当前协议节点集合动态读取
      // （内置 + 自定义），自定义节点（brainstorm）可 skill-load 声明 + record 声明校验端到端通过
      // （修复前 BUILTIN_NODES 硬编码只含内置 8 节点 → skill-load 拒绝 brainstorm = RED）
      writeFile(dir, 'custom-protocol.json', JSON.stringify(customProtocolWithSkillCall(), null, 2) + '\n');
      const customEnv = { FLOW_COMET_PROTOCOL: path.join(dir, 'custom-protocol.json') };
      const slCustom = runState(['skill-load', 'brainstorm', 'flow-comet-brainstorm'], dir, customEnv);
      assertExit(slCustom, 0);
      assertOut(slCustom, 'SKILL-LOAD: brainstorm flow-comet-brainstorm');
      const resCustom = runState(['record', 'brainstorm', JSON.stringify({ summary: 'brainstorm done', completedChecks: ['required-skill:brainstorm.flow-comet-brainstorm'] })], dir, customEnv);
      assertExit(resCustom, 0);
      assertOut(resCustom, 'EVIDENCE: brainstorm');
    },
  },

  // 102: exit 协议声明标记校验（AC-4）+ 真实链路集成——.skill-loads/ 已激活
  // （目录存在）但无本节点协议标记（<node>-*.json 且 protocol ∈ 该节点协议集，节点协议映射表
  // basename）→ BLOCKED；真实 skill-load --prompt 写入的标记（protocol = basename）→ exit 通过
  // （修复后真实链路一致——缺陷修复前 skill-load 写解析后完整路径，exit 必 BLOCKED）；未传
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
      // ② 真实链路：skill-load --prompt 写入标记（protocol = basename）→ exit 通过
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
  // SKILL-LOAD WARN 照常通过（声明机制未激活不追溯）
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
      // ③ exit open：M5 后 record 已自动补声明标记 → 无 SKILL-LOAD WARN,正常通过
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      const resC = runGuard(['exit', 'open'], dir);
      assertExit(resC, 0);
      assertOut(resC, 'ALL CHECKS PASSED');
      assertNotOut(resC, 'SKILL-LOAD WARN');
      // M5: record 已自动补 requiredSkillCalls 声明标记
      if (!fs.existsSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json'))) {
        throw new Error('record 自动声明标记缺失: open-flow-comet-change.json');
      }
    },
  },

  // 105: 场景数一致性自检同步（AC-8）——SCENARIOS.length 变更时 SCENARIO_COUNT_FILES 21 文件须同步
  // （ALL n SCENARIOS PASSED / n scenarios / n 场景 / n/n 变体）。本场景直接读取权威源仓库的
  // 21 文件断言含当前场景数变体——文档漏同步即 RED（与底部自检同判据；安装副本无文档跳过）
  {
    name: '105 场景数自检同步：21 文件含当前场景数变体（AC-8）',
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

  // 106: exit review——REVIEW.md 发现区条目处置状态结构级校验（L3-1：问题处理原则）——
  // 发现项（含 Minor）无处置状态标记（[已修]/[升级]/[转待办]）→ REVIEW WARN 渐进不 BLOCK
  // （防旧 REVIEW 卡死——旧 REVIEW 未按新格式写标记只警告不阻断）；全部带标记 → 无 WARN
  // （发现不得"记录后无声消失"——每条须有处置去向）
  {
    name: '106 exit review WARN：发现区条目缺处置状态标记（L3-1）',
    run: (dir) => {
      const st = baseState('review');
      st.evidence.review = { summary: 'review done' };
      writeState(dir, st);
      // ① 发现区 Minor 条目无处置标记 → REVIEW WARN + 通过（渐进不阻断）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n无\n\n### Major\n\n无\n\n### Minor\n\n- **m-1 · 示例发现**：描述（未处置）\n\n## 结论\n\n通过\n');
      const res = runGuard(['exit', 'review'], dir);
      assertExit(res, 0);
      assertOut(res, 'REVIEW WARN');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② 同一条目带 [转待办] 处置标记 → 无 REVIEW WARN
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n无\n\n### Major\n\n无\n\n### Minor\n\n- **m-1 · 示例发现**：描述 [转待办]\n\n## 结论\n\n通过\n');
      const res2 = runGuard(['exit', 'review'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, 'REVIEW WARN');
      assertOut(res2, 'ALL CHECKS PASSED');
    },
  },

  // 107: determineNode 产物推导 pathBase 感知——compose 自定义协议 outputSchemas 含
  // pathBase='project' 工件（项目根 README.md）时,status/next 按项目根产物正确推进。
  // 修复前 buildNodeCompletionFlags 丢弃 pathBase、nodeFlagsComplete 一律按 .specs/ 解析
  // → 项目根工件永不命中 → 节点判定不完成 → next 钉回（卡死）。
  {
    name: '107 产物推导 pathBase 感知：project 根工件正确推进',
    run: (dir) => {
      // 自定义协议:brief(project 根 README.md)→ doccheck(specs-root report.md)
      const custom = path.join(dir, 'pb-protocol.json');
      writeFile(dir, 'pb-protocol.json', JSON.stringify({
        schemaVersion: 1,
        kind: 'workflow-kernel',
        name: 'pathbase-test',
        goal: 'pathBase 场景：pathBase=project 工件正确推进。',
        nodes: [
          { id: 'brief', label: 'Brief', kind: 'control', responsibility: '产出项目根 README.md。', outputSchemas: ['pathbase.brief.v1'], requiredSkillCalls: [], augmentations: [], disabled: false },
          { id: 'doccheck', label: 'Doc Check', kind: 'control', responsibility: '产出 specs-root report.md。', outputSchemas: ['pathbase.doccheck.v1'], requiredSkillCalls: [], augmentations: [], disabled: false },
        ],
        outputSchemas: [
          { id: 'pathbase.brief.v1', artifacts: [{ id: 'readme', paths: ['README.md'], pathBase: 'project' }] },
          { id: 'pathbase.doccheck.v1', artifacts: [{ id: 'report', paths: ['report.md'] }] },
        ],
      }, null, 2));
      // init(自定义协议经 --protocol CLI)+ 项目根产物 README.md
      assertExit(runState(['init', CHANGE_ID, '--protocol', custom, '--init-skip'], dir), 0);
      writeFile(dir, 'README.md', '# project readme\n');
      // brief 完成(README.md 在项目根存在)→ determineNode 推导下一节点 doccheck
      // （验证点:产物推导尊重 pathBase——修复前 README.md 按 .specs/ 解析永不命中 → currentNode 仍 brief）
      // （注:next 的顺序门禁会 BLOCK 未 exit 节点——那是节点顺序语义,非本场景目标）
      const st = runState(['status', '--protocol', custom], dir);
      assertExit(st, 0);
      assertOut(st, '"currentNode": "doccheck"');
    },
  },

  // 108: 产物推导 fail-fast（B 方案）——协议声明 classic/native pathBase 时状态机推导
  // 暂不支持（guard 侧全量感知、state 侧兜底不一致的已知边界）,显式报错提示改用
  // specs-root/project + 完整路径——不静默兜底（防卡死/误判）。
  {
    name: '108 产物推导 fail-fast：classic/native pathBase 显式报错（B 方案）',
    run: (dir) => {
      // 自定义协议:proposal 节点声明 classic-openspec-root 工件
      const custom = path.join(dir, 'classic-protocol.json');
      writeFile(dir, 'classic-protocol.json', JSON.stringify({
        schemaVersion: 1,
        kind: 'workflow-kernel',
        name: 'classic-test',
        goal: 'fail-fast 场景：classic pathBase 显式报错。',
        nodes: [
          { id: 'proposal', label: 'Proposal', kind: 'control', responsibility: '产出 openspec 产物。', outputSchemas: ['classic.proposal.v1'], requiredSkillCalls: [], augmentations: [], disabled: false },
        ],
        outputSchemas: [
          { id: 'classic.proposal.v1', artifacts: [{ id: 'proposal', paths: ['changes/xxx.md'], pathBase: 'classic-openspec-root' }] },
        ],
      }, null, 2));
      assertExit(runState(['init', CHANGE_ID, '--protocol', custom, '--init-skip'], dir), 0);
      // status:classic/native pathBase → fail-fast 显式报错（不静默兜底）
      const st = runState(['status', '--protocol', custom], dir);
      assertExit(st, 1);
      assertOut(st, '状态机推导暂不支持');
      assertOut(st, 'specs-root');
    },
  },

  // 109: execute 出口校验——TASK done 任务 ↔ <id>-SUMMARY.md 存在——
  // 缺任一 done 任务的 SUMMARY → WARN 渐进不 BLOCK（防旧 change 卡死）；齐全 → 无 WARN
  {
    name: '109 execute exit：done 任务缺 SUMMARY → WARN 渐进',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'execute done' };
      st.executionMode = 'direct'; // direct:串行任务主代理直写,不要求 handoff(聚焦产物完整性校验)
      writeState(dir, st);
      // TASK:两个 done 任务(T01/T02)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
        '<task id="T02" status="done"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify></task>\n');
      // ① 只有 T02-SUMMARY.md(T01 缺)→ WARN 点名 T01-SUMMARY.md + 通过（渐进）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T02-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN');
      assertOut(res, 'T01-SUMMARY.md');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② 补 T01-SUMMARY.md → 无缺产物 WARN（既有 SKILL-LOAD 兼容 WARN 与本文无关）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '缺少 T01-SUMMARY.md');
      assertOut(res2, 'ALL CHECKS PASSED');
    },
  },

  // 110: execute 出口越权委托检测——TASK 有 parallel done 任务 + completedNodes
  // 无 subagent-execute + 非 direct 模式 → WARN 渐进（[P] 任务应由 subagent-execute 节点委托,
  // execute 阶段完成 [P] 是越权委托痕迹——上轮真实流程实证的越权委托）;completedNodes 含
  // subagent-execute 或 direct 模式 → 无越权 WARN
  {
    name: '110 execute exit：parallel done 无 subagent-execute → WARN 越权委托',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'execute done' };
      st.completedNodes = ['open', 'design', 'plan', 'execute']; // subagent-execute 未 exit
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) }; // 已委托(共用证据库)
      writeState(dir, st);
      // TASK:parallel done P01 + 产物 SUMMARY(满足 task-summaries 出口门禁 + KI-8)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      // ① completedNodes 无 subagent-execute + 非 direct → WARN（越权委托）
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, '越权委托');
      assertOut(res, 'subagent-execute');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② completedNodes 含 subagent-execute → 无越权 WARN
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      writeState(dir, st);
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '越权委托');
      assertOut(res2, 'ALL CHECKS PASSED');
    },
  },

  // 111: verify 出口越权委托兜底检测——同 KI-10 判定（TASK parallel done +
  // completedNodes 无 subagent-execute + 非 direct）,verify 时仍未 exit → WARN 兜底
  // （execute 出口未拦截的兜底提示）
  {
    name: '111 verify exit：parallel done 无 subagent-execute → WARN 越权委托兜底',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'review']; // 无 subagent-execute
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      // ① completedNodes 无 subagent-execute → WARN 兜底
      const res = runGuard(['exit', 'verify'], dir);
      assertExit(res, 0);
      assertOut(res, '越权委托');
      assertOut(res, 'subagent-execute');
      // ② completedNodes 含 subagent-execute → 无越权 WARN
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      const res2 = runGuard(['exit', 'verify'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '越权委托');
    },
  },

  // 112: 节点顺序 BLOCK 消息含恢复指引——next 的「疑似未 exit」BLOCK 与
  // exit 的「currentNode 不匹配」BLOCK 均提示恢复通道（advance 强制推进/select 切换/
  // exit --apply）——防 resume 自锁（上轮真实项目端到端验证观察：机器推导节点无脚本恢复通道）
  {
    name: '112 节点顺序 BLOCK 消息含恢复指引',
    run: (dir) => {
      // ① next:currentNode=execute 但未 exit(无 evidence 记录)→ BLOCK 消息含 advance/select 指引
      const st1 = baseState('execute'); // evidence 空——无豁免,触发"疑似未 exit"BLOCK
      writeState(dir, st1);
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true }); // findActiveChange 要求目录存在
      const nx = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(nx, 1);
      assertOut(nx, 'BLOCKED');
      assertOut(nx, 'advance');
      assertOut(nx, 'select');
      // ② exit:currentNode=design 但 exit open → BLOCK 消息含 advance 指引
      const st2 = baseState('design');
      st2.evidence.design = { summary: 'design done' };
      writeState(dir, st2);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## AC\n');
      const ex = runGuard(['exit', 'open'], dir);
      assertExit(ex, 1);
      assertOut(ex, 'BLOCKED');
      assertOut(ex, 'advance');
      // ③ exit 无 evidence → BLOCK 消息含 record 补证据指引（KI-3 补全）
      const st3 = baseState('design');
      writeState(dir, st3);
      const ex3 = runGuard(['exit', 'open'], dir);
      assertExit(ex3, 1);
      assertOut(ex3, 'missing evidence');
      assertOut(ex3, 'record');
    },
  },

  // 113: plan 出口波次散文一致性检测——TASK 的 ## 波次划分 Wave 行任务带 [P]
  // 标记（并行语义）但 XML 任务无 parallel="true" → WARN（散文与机器路由依据不一致,
  // 以任务标记为准）;XML 补齐 parallel → 无 WARN。容错:无并行语义的 Wave 行不参与比对。
  {
    name: '113 plan exit：波次散文与并行标记不一致 → WARN',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      // TASK:波次散文 Wave 1 (parallel): T01[P], T02[P];XML 仅 T01 parallel（T02 不一致）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 波次划分\n\nWave 1 (parallel): T01[P], T02[P]\n\n## 任务清单\n\n'
        + '<task id="T01" parallel="true" status="pending"><action>a</action><write_files>f1</write_files><verify>v</verify></task>\n'
        + '<task id="T02" status="pending"><action>b</action><write_files>f2</write_files><verify>v</verify></task>\n');
      // ① 散文 T02[P] 但 XML 无 parallel → WARN
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 0);
      assertOut(res, '波次散文');
      assertOut(res, 'T02');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② XML 补 T02 parallel → 无波次 WARN
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 波次划分\n\nWave 1 (parallel): T01[P], T02[P]\n\n## 任务清单\n\n'
        + '<task id="T01" parallel="true" status="pending"><action>a</action><write_files>f1</write_files><verify>v</verify></task>\n'
        + '<task id="T02" parallel="true" status="pending"><action>b</action><write_files>f2</write_files><verify>v</verify></task>\n');
      const res2 = runGuard(['exit', 'plan'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '波次散文');
      assertOut(res2, 'ALL CHECKS PASSED');
    },
  },

  // 114: init 未知参数(以 -- 开头,如 --help)→ 报错而非当作 change 名执行
  // (此前 --help 会被当作 change id 使用:自动开 change、建分支、写状态——误用有破坏性)
  {
    name: '114 init 未知参数(以 -- 开头)报错而非当作 change 名',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const branchBefore = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
      const res = runState(['init', '--help'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, 'not a change name');
      assertOut(res, 'Usage: workflow-state.mjs init');
      assertNotOut(res, 'BRANCH:');
      const branchAfter = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
      if (branchAfter !== branchBefore) throw new Error('init --help 不应切换或创建分支');
      if (fs.existsSync(path.join(dir, '.comet', 'flow-comet-state.json'))) {
        throw new Error('init --help 不应写状态文件(此前被当作 change 名执行的副作用)');
      }
      if (fs.existsSync(path.join(dir, '.specs', '--help'))) {
        throw new Error('init --help 不应创建 .specs/--help 工件目录');
      }
      // ② 带前导空白的 flag-like 参数(如 " --help")经 trim 后同样应被拒绝
      const res2 = runState(['init', ' --help'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res2, 1);
      assertOut(res2, 'not a change name');
      if (fs.existsSync(path.join(dir, '.specs', ' --help'))) {
        throw new Error('init " --help" 不应创建工件目录(trim 后应被拒绝)');
      }
    },
  },

  // 115: M1 entry 证据化——新 change(enter 机制激活)未 entry 直接 exit → ENTER WARN(渐进不阻断)
  {
    name: '115 execute exit ENTER WARN：enter 机制激活但本节点未 entry（M1）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.enteredNodes = ['open', 'design', 'plan']; // 前序节点 enter 过(机制激活);execute 未 entry
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ENTER WARN');
    },
  },

  // 116: M1 正例——entry 后 exit 无 enter 证据警告
  {
    name: '116 execute exit 通过：entry 后无 enter 证据警告（M1 正例）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.enteredNodes = ['open', 'design', 'plan'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      assertExit(runGuard(['entry', 'execute'], dir), 0); // entry 记录 enter 标记
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'ENTER WARN');
    },
  },

  // 117: M2——新 change(enter 机制激活)done 任务缺 SUMMARY → BLOCKED(旧 change WARN 渐进保留)
  // 构造:两个 done 任务(T01/T02),仅 T01-SUMMARY 存在(满足产物通配符,隔离 KI-8 语义)
  {
    name: '117 execute exit BLOCKED：新 change done 任务缺 SUMMARY（M2）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'T02']) };
      st.enteredNodes = ['open', 'design', 'plan', 'execute'];
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE_TWO);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir); // T02 缺 SUMMARY
      assertExit(res, 1);
      assertOut(res, 'SUMMARY');
    },
  },

  // 118: M3——新 change(enter 机制激活)handoff 缺 redEvidence → BLOCKED(旧 change WARN 保留)
  // 构造:handoffRequest + handoffResult 齐(满足 Output Schema evidence),仅缺 redEvidence(隔离 M3 语义)
  {
    name: '118 subagent-execute exit BLOCKED：新 change handoff 缺 redEvidence（M3）',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence.execute = { summary: 'executed' };
      st.enteredNodes = ['open', 'design', 'plan', 'subagent-execute'];
      st.newChange = true;
      const handoff = handoffFor(['T01']);
      delete handoff.T01.result.redEvidence;
      st.evidence['subagent-execute'] = { summary: 'delegated', handoffRequest: { T01: { taskId: 'T01' } }, handoffResult: handoff };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'redEvidence');
    },
  },

  // 119: M4——handoff 提交对象不可校验 → HANDOFF ERROR 且含协调者确认提示
  {
    name: '119 handoff result 提交对象不可校验 → 协调者确认提示（M4）',
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
      assertOut(res, 'HANDOFF ERROR');
      assertOut(res, '确认'); // 协调者确认提示
    },
  },

  // 120: M5——record 自动补写 skill-load 声明标记(open 节点 requiredSkillCalls)
  {
    name: '120 record 自动补写 skill-load 声明标记（M5）',
    run: (dir) => {
      const st = baseState('open');
      st.enteredNodes = ['open'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\nx\n\n## 验收准则（AC）\n- Given x When y Then z');
      const res = runState(['record', 'open', '{"summary":"done"}'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      const loads = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      const changeMarker = path.join(loads, 'open-flow-comet-change.json');
      const requirementMarker = path.join(loads, 'open-flow-comet-requirement.json');
      if (!fs.existsSync(changeMarker)) {
        throw new Error('record 自动声明标记缺失: open-flow-comet-change.json');
      }
      // 子断言:自动补标记的 protocol 字段按 skill 归属协议文件(修复前所有 skill 都写节点
      // 首文件 0-change.md——requirement 标记的协议归属语义错误,此处应 RED)
      const changeMeta = JSON.parse(fs.readFileSync(changeMarker, 'utf8'));
      if (changeMeta.protocol !== '0-change.md') {
        throw new Error('change 自动标记 protocol 应为 0-change.md: ' + JSON.stringify(changeMeta.protocol));
      }
      if (!fs.existsSync(requirementMarker)) {
        throw new Error('record 自动声明标记缺失: open-flow-comet-requirement.json');
      }
      const requirementMeta = JSON.parse(fs.readFileSync(requirementMarker, 'utf8'));
      if (requirementMeta.protocol !== '1-requirement.md') {
        throw new Error('requirement 自动标记 protocol 应为 1-requirement.md(修复前误写 0-change.md): ' + JSON.stringify(requirementMeta.protocol));
      }
    },
  },

  // 121: M6——execute 显式空退出豁免(全 parallel 无串行任务,evidence 声明后通过)
  {
    name: '121 execute exit 通过：显式空退出豁免（M6）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'empty exit', emptyExitApproved: true };
      st.enteredNodes = ['open', 'design', 'plan', 'execute'];
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" parallel="true" status="pending" depends_on="">\n  <name>p</name>\n  <write_files>a</write_files>\n  <action>p</action>\n  <verify>t</verify>\n  <done>d</done>\n</task>');
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      // 子断言:豁免不适用于存在未完成串行任务——防规划错误被豁免掩盖
      // (修复前 emptyExitApproved 会跳过串行 pending 阻断,此处应 RED)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T02" status="pending"><action>串行任务</action><write_files>f</write_files><verify>v</verify></task>\n');
      const resSerial = runGuard(['exit', 'execute'], dir);
      assertExit(resSerial, 1);
      assertOut(resSerial, '串行 pending');
    },
  },

  // 122: M7——旧 change(enter 机制未激活)done 缺 SUMMARY 仍 WARN 渐进,不升级(兼容正例)
  // 构造:两个 done 任务(T01/T02),仅 T01-SUMMARY 存在(满足产物通配符,隔离 KI-8 语义)
  {
    name: '122 execute exit 兼容：旧 change done 缺 SUMMARY 仍 WARN 渐进（M7）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'T02']) };
      writeState(dir, st); // 无 enteredNodes(旧 change)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE_TWO);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir); // T02 缺 SUMMARY → 旧 change 仍 WARN 渐进
      assertExit(res, 0);
      assertOut(res, 'WARN');
    },
  },

  // 123: M8——init 在无提交(空)仓库时输出提示且跳过分支创建(行为一致:
  // 修复前 WARN"无法创建分支"后仍 checkout -b 实际创建——声称与行为矛盾)
  {
    name: '123 init 空仓库提示：无提交仓库的分支创建边界（M8）',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      const res = runState(['init', 'empty-repo'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'EMPTY-REPO');
      // 子断言 ①:警告后不得实际创建分支(unborn HEAD 下 rev-parse 失败 → currentBranch=null
      // → checkout -b 被跳过——分支列表应保持为空)
      const branches = execFileSync('git', ['branch', '--list'], { cwd: dir, encoding: 'utf8' });
      if (branches.includes('change/empty-repo')) {
        throw new Error('空仓库警告后仍创建了 change/empty-repo 分支: ' + branches);
      }
      // 子断言 ②:BRANCH 输出不得声称分支已创建(修复前输出 'BRANCH: change/empty-repo'
      // 但分支实际未创建——声称与行为矛盾,此处应 RED)
      assertNotOut(res, 'BRANCH: change/empty-repo');
    },
  },

  // 124: M3 旧兼容——旧 change(enter 机制未激活)handoff 缺 redEvidence 仍 WARN 渐进(不升级)
  {
    name: '124 subagent-execute exit 兼容：旧 change handoff 缺 redEvidence 仍 WARN（M3 旧兼容）',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence.execute = { summary: 'executed' };
      const handoff = handoffFor(['T01']);
      delete handoff.T01.result.redEvidence;
      st.evidence['subagent-execute'] = { summary: 'delegated', handoffRequest: { T01: { taskId: 'T01' } }, handoffResult: handoff };
      writeState(dir, st); // 无 enteredNodes(旧 change)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF WARN');
    },
  },

  // 125: R1——新 change(newChange:true)review 处置标记缺失 → BLOCKED(旧 change WARN 保留)
  {
    name: '125 review exit BLOCKED：新 change 处置标记缺失（R1）',
    run: (dir) => {
      const st = baseState('review');
      st.evidence.review = { summary: 'reviewed' };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'review'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题A**: 某处存在一个需要记录的问题描述,但未给出任何处置结论\n\n## 结论\n\n通过\n');
      const res = runGuard(['exit', 'review'], dir);
      assertExit(res, 1);
      assertOut(res, '处置状态标记');
      // 子断言:四要素字段行(Symptom/Source/Consequence/Remedy)不误判为发现条目——
      // 执行者按 brooks 输出格式书写(带处置标记的条目)应正常通过
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题 **[已修]**\n  - **Symptom**: 具体现象\n  - **Source**: 某书某节\n  - **Consequence**: 若不修会怎样\n  - **Remedy**: 怎么改\n\n## 结论\n\n通过\n');
      const resOk = runGuard(['exit', 'review'], dir);
      assertExit(resOk, 0);
      assertOut(resOk, 'ALL CHECKS PASSED');
      // 子断言:字段豁免必须精确匹配完整标签(允许尾冒号)——"Source maps expose paths"
      // 这类以 Source 开头的真实发现标题不得被误豁免(修复前前缀匹配会跳过其处置校验)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **Source maps expose paths**: 某处泄露文件路径,未给出任何处置结论\n\n## 结论\n\n通过\n');
      const resSource = runGuard(['exit', 'review'], dir);
      assertExit(resSource, 1);
      assertOut(resSource, '处置状态标记');
      // 负例对照:完整标签行(Symptom:/Source:)仍豁免(字段行不是发现条目)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题C**: 某处问题 **[已修]**\n  - **Symptom**: 现象\n  - **Source**: 某书\n\n## 结论\n\n通过\n');
      const resOk2 = runGuard(['exit', 'review'], dir);
      assertExit(resOk2, 0);
      assertOut(resOk2, 'ALL CHECKS PASSED');
    },
  },

  // 126: R1——新 change builtin 缓存证据缺失 → BLOCKED
  {
    name: '126 execute exit BLOCKED：新 change builtin 缓存证据缺失（R1）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbrooks-lint 不可用,builtin-quickcheck',
        sixDim: '## 6 维自查\n\n- 功能: 通过\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '缓存');
      // 子断言:拦截消息须含关键词引导(声明级校验的执行者体验——级 4 实证:语义完整但
      // 缺关键词被拦,消息应指明所需关键词,防执行者无从下手)
      assertOut(res, '须含关键词');
    },
  },

  // 127: R1——新 change 波次散文不一致 → BLOCKED
  {
    name: '127 plan exit BLOCKED：新 change 波次散文不一致（R1）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'planned' };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 波次划分\n\nWave 1 (parallel): T01[P]\n\n## 任务清单\n\n<task id="T01"><action>a</action><write_files>f</write_files><verify>v</verify><done>d</done></task>\n');
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 1);
      assertOut(res, '波次');
    },
  },

  // 128: R1——新 change 越权委托(KI-10)→ BLOCKED
  {
    name: '128 execute exit BLOCKED：新 change 越权委托（R1）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent()); // 满足 M2
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) }; // 满足越俎代庖,触发 KI-10 越权委托
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '越权');
    },
  },

  // 129: R2——新 change 未 entry 直接 exit → BLOCKED(旧 change ENTER WARN 保留)
  {
    name: '129 execute exit BLOCKED：新 change 未 entry 直接 exit（R2）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'entry');
    },
  },

  // 130: R6——init 写 newChange: true
  {
    name: '130 init 写入 newChange 标记（R6）',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (st.newChange !== true) throw new Error('init 未写入 newChange: true');
    },
  },

  // 131: R1 旧兼容——旧 change(无 newChange)处置标记缺失仍 WARN
  {
    name: '131 review exit 兼容：旧 change 处置标记缺失仍 WARN（R1 旧兼容）',
    run: (dir) => {
      const st = baseState('review');
      st.evidence.review = { summary: 'reviewed' };
      writeState(dir, st); // 无 newChange(旧 change)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题A**: 某处存在一个需要记录的问题描述,但未给出任何处置结论\n\n## 结论\n\n通过\n');
      const res = runGuard(['exit', 'review'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN');
    },
  },

  // 132: R3——exit 校验对 auto 声明标记输出 WARN 提示
  {
    name: '132 exit 对 auto 声明标记输出提示（R3）',
    run: (dir) => {
      // 技能加载前置门对齐：record 无声明标记在新 change 下 BLOCK——本场景测 exit 的
      // auto 标记提示，改用旧 change(无 newChange)构造，保留 record 通过 + exit auto 提示
      // 的测试意图（新 change 无声明记录由前置门场景覆盖）。
      const st = baseState('open');
      writeState(dir, st);
      assertExit(runGuard(['entry', 'open'], dir), 0);
      assertExit(runState(['record', 'open', '{"summary":"intake"}'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') }), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\nx\n\n## 验收准则（AC）\n- Given x When y Then z');
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z', auto: true }, null, 2) + '\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 0);
      assertOut(res, 'auto');
    },
  },

  // 133: R4——空退出豁免 exit 输出审计提示
  {
    name: '133 execute exit 空退出豁免输出审计提示（R4）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'empty', emptyExitApproved: true };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="P01" parallel="true" status="pending"><action>p</action><write_files>a</write_files><verify>t</verify><done>d</done></task>\n');
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'EMPTY-EXIT');
    },
  },

  // 134: G16——M2 BLOCKED 消息含恢复指引
  {
    name: '134 execute exit BLOCKED 消息含恢复指引（G16）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'T02']) };
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE_TWO);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir); // T02 缺 SUMMARY
      assertExit(res, 1);
      assertOut(res, '恢复:');
    },
  },

  // 135: R1 旧格式兼容分支——自检方法段含 brooks-review 声明但缺 `## 自检方法` 段标题(旧格式形态):
  // 新 change 全文声明方法但缺段标题 → BLOCKED(强制自检方法段,transition 规则 L2454-2455);
  // 旧 change 同构造 → BROOKS-LINT WARN 渐进(兼容保留,L2457)
  {
    name: '135 execute exit BLOCKED：新 change 自检方法段缺标题（R1 旧格式兼容分支）',
    run: (dir) => {
      // ① 新 change(newChange:true):T01-SUMMARY 含 brooks-review 声明(6 维自查+方法行)但缺
      // `## 自检方法` 段标题(旧格式) → BLOCKED(自检方法段强制;恢复:补 ## 自检方法 段标题)
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0); // R2: 新 change 须先 entry
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({ method: 'brooks-review' }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '自检方法');
      // ② 旧 change(无 newChange)同构造 → BROOKS-LINT WARN 渐进(兼容保留,不阻断)
      const stOld = baseState('execute');
      stOld.evidence.execute = { summary: 'executed' };
      stOld.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, stOld);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({ method: 'brooks-review' }));
      const resOld = runGuard(['exit', 'execute'], dir);
      assertExit(resOld, 0);
      assertOut(resOld, 'BROOKS-LINT WARN');
    },
  },

  // 136: verifyFailures 按 change 隔离——切换 change 后计数独立(串扰修复:全局计数会让
  // change B 继承 change A 的失败次数,误触发"超限需用户决策");旧顶层字段
  // (verifyFailures)迁移并入当前 change 计数(旧 state 兼容)
  {
    name: '136 verifyFailures 按 change 隔离:切换计数独立 + 旧字段迁移',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // ① 旧字段迁移:旧 state(顶层 verifyFailures=2)→ verify-fail 并入当前 change(2+1=3)不超限
      const st = baseState('verify');
      st.verifyFailures = 2;
      writeState(dir, st);
      // 场景内 ch/ch2 目录(select 要求 change 目录存在)
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const r1 = runState(['verify-fail'], dir, env);
      assertExit(r1, 0);
      assertOut(r1, 'VERIFY-FAIL: 3/3');
      const stAfter = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (!stAfter.verifyFailuresByChange || stAfter.verifyFailuresByChange['ch'] !== 3) {
        throw new Error('旧字段未迁移并入 change 计数: ' + JSON.stringify(stAfter.verifyFailuresByChange));
      }
      if (stAfter.verifyFailures !== undefined) {
        throw new Error('旧顶层字段应已清除: ' + JSON.stringify(stAfter.verifyFailures));
      }
      // ② 同 change 第 4 次 → BLOCK(3 >= 3)
      const r2 = runState(['verify-fail'], dir, env);
      assertExit(r2, 1);
      assertOut(r2, '超限');
      // ③ 切换 change:select ch2 → 计数独立(若实现仍用全局计数 3,此处会误 BLOCK = RED)
      writeFile(dir, '.specs/ch2/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const r3 = runState(['select', 'ch2'], dir, env);
      assertExit(r3, 0);
      const r4 = runState(['verify-fail'], dir, env);
      assertExit(r4, 0);
      assertOut(r4, 'VERIFY-FAIL: 1/3');
      // ④ ch2 独立计数:连续 3 次后第 4 次 BLOCK
      assertExit(runState(['verify-fail'], dir, env), 0);
      assertExit(runState(['verify-fail'], dir, env), 0);
      const r7 = runState(['verify-fail'], dir, env);
      assertExit(r7, 1);
      assertOut(r7, '超限');
      // ⑤ 切回 ch:原计数保留(3 → 仍超限,不串扰不回零)
      const r8 = runState(['select', 'ch'], dir, env);
      assertExit(r8, 0);
      const r9 = runState(['verify-fail'], dir, env);
      assertExit(r9, 1);
      assertOut(r9, '超限');
    },
  },

  // 137: next 漂移校正不得推走"已记录证据但未 exit"的进行中节点——exit 被拦截(如
  // 内容级 BLOCKED)后执行者跑 next,校正把 currentNode 推到下一节点,被拦截节点无法
  // 重跑(exit 前置 currentNode 校验拦截),advance/select 均不恢复 → 死结(实测教训)。
  // 修复:evidence 存在且节点未 exit → 视为进行中,next 不校正(currentNode 保持原节点)
  {
    name: '137 next 不推走进行中节点:exit 被拦截后重跑路径保留',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const st = baseState('review');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      st.evidence.review = { summary: 'reviewed' }; // record 过但 exit 被拦截
      st.newChange = true;
      writeState(dir, st);
      // 前序产物(execute 产物门控需 *-SUMMARY.md)
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\nx\n\n## 验收准则（AC）\n- Given x When y Then z');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\npython\n\n## 决策清单\n- d1: x\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" status="done"><action>x</action><write_files>f</write_files><verify>v</verify></task>\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', '# T01-SUMMARY\n## verify 输出\nx\n## 6 维自查\nx\n## 越界检查\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题A**: 某处问题 **[已修]**\n\n## 结论\n\n通过\n');
      // ① next:进行中节点(evidence 存在且未 exit)不被漂移校正推走(修复前校正到 verify = RED)
      const r1 = runState(['next'], dir, env);
      assertExit(r1, 0);
      assertOut(r1, 'NODE: review');
      assertNotOut(r1, 'NODE: verify');
      // ② exit review 重跑路径保留:缺处置标记 → BLOCKED(新 change),补标记后通过
      assertExit(runGuard(['entry', 'review'], dir, env), 0); // 新 change 强制先 entry
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题无处置标记\n\n## 结论\n\n通过\n');
      const rBlock = runGuard(['exit', 'review'], dir, env);
      assertExit(rBlock, 1);
      assertOut(rBlock, '处置状态标记');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题 **[已修]**\n\n## 结论\n\n通过\n');
      const rPass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(rPass, 0);
      assertOut(rPass, 'ALL CHECKS PASSED');
    },
  },

  // ----------  场景（prepare-env 平台选择链——T01 实现：显式单平台/逗号多选/all/both 移除/痕迹探测/幂等） ----------

  // 138: 显式单平台 --platform dsh → dsh 描述符生效（skill 根 .dsh/skills/ + 路径替换 + AGENTS.md 托管区 +
  // $DSH_HOME 全局挂载——DSH_HOME=临时目录,禁止污染真实 ~/.dsh）
  {
    name: '138 prepare-env --platform dsh 显式单平台安装生效',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return; // 安装副本无 prepare-env 脚本（与场景 105 同判据）
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const dshHome = path.join(dir, 'dshhome');
      const res = runPrepareEnv(['--target', proj, '--platform', 'dsh'], dir, { DSH_HOME: dshHome });
      assertExit(res, 0);
      assertOut(res, '平台: DeepSeek Harness');
      // dsh 描述符生效:skill 安装到目标 .dsh/skills/（而非 .claude/）
      if (!fs.existsSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('dsh skill 未安装到 .dsh/skills/');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('dsh 单平台不应生成 .claude/');
      // 路径替换生效:安装副本 SKILL.md 含 .dsh/skills/flow-comet/scripts/ 命令路径（权威源 .claude 形态 → dsh 平台化）
      const skillText = fs.readFileSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'), 'utf8');
      if (!skillText.includes('.dsh/skills/flow-comet/scripts/')) throw new Error('SKILL.md 未做 dsh 路径替换');
      // rules 注入:AGENTS.md 托管区
      const agents = fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8');
      if (!agents.includes('<!-- Managed by flow-comet prepare-env -->')) throw new Error('AGENTS.md 托管区未注入');
      // $DSH_HOME 全局挂载（场景隔离:DSH_HOME=临时目录,禁止污染真实 ~/.dsh）
      if (!fs.existsSync(path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs'))) throw new Error('桥接 loader 未复制到 $DSH_HOME/plugins/');
      const patch = fs.readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8');
      if (!patch.includes('dsh-flow-comet-bridge')) throw new Error('cordis.patch.yml 托管块未注入');
    },
  },

  // 139: 显式逗号多平台 --platform claude-code,dsh → 双平台顺序安装（顺序 = 参数顺序）
  {
    name: '139 prepare-env --platform claude-code,dsh 双平台按参数顺序安装',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code,dsh'], dir, { DSH_HOME: path.join(dir, 'dshhome') });
      assertExit(res, 0);
      // 双平台都装:.claude/skills + .dsh/skills 均生成
      if (!fs.existsSync(path.join(proj, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('claude-code 平台未安装');
      if (!fs.existsSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('dsh 平台未安装');
      // 顺序 = 参数顺序:输出中 Claude Code 先于 DeepSeek Harness
      const ccIdx = res.output.indexOf('平台: Claude Code');
      const dshIdx = res.output.indexOf('平台: DeepSeek Harness');
      if (ccIdx < 0 || dshIdx < 0 || ccIdx > dshIdx) throw new Error('安装顺序非参数顺序（Claude Code 应先于 DeepSeek Harness）');
    },
  },

  // 140: --platform all → 全部平台（顺序 = PLATFORMS 表顺序:claude-code → codex → dsh）
  {
    name: '140 prepare-env --platform all 全部平台按表顺序安装',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const res = runPrepareEnv(['--target', proj, '--platform', 'all'], dir, { DSH_HOME: path.join(dir, 'dshhome') });
      assertExit(res, 0);
      // 全部平台:.claude / .agents / .dsh 三套 skill 根均生成
      for (const root of ['.claude', '.agents', '.dsh']) {
        if (!fs.existsSync(path.join(proj, root, 'skills', 'flow-comet', 'SKILL.md'))) throw new Error(root + ' 平台未安装');
      }
      // 顺序 = PLATFORMS 表顺序（输出位置递增:Claude Code → Codex → DeepSeek Harness）
      const ccIdx = res.output.indexOf('平台: Claude Code');
      const codexIdx = res.output.indexOf('平台: Codex');
      const dshIdx = res.output.indexOf('平台: DeepSeek Harness');
      if (ccIdx < 0 || codexIdx < 0 || dshIdx < 0 || !(ccIdx < codexIdx && codexIdx < dshIdx)) {
        throw new Error('all 顺序非 PLATFORMS 表顺序（Claude Code → Codex → DeepSeek Harness）');
      }
    },
  },

  // 141: 未知平台 --platform gemini → 报错（含逗号列表中的未知项——不得部分安装）
  {
    name: '141 prepare-env 未知平台报错（含逗号列表未知项）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const r1 = runPrepareEnv(['--target', proj, '--platform', 'gemini'], dir);
      assertExit(r1, 1);
      assertOut(r1, '未知平台: gemini');
      const r2 = runPrepareEnv(['--target', proj, '--platform', 'claude-code,gemini'], dir);
      assertExit(r2, 1);
      assertOut(r2, '未知平台: gemini');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('未知平台报错前不应产生任何安装');
    },
  },

  // 142: 移除 both:--platform both → 报错提示（逗号分隔或 all）——逗号列表中的 both 同样被拒
  {
    name: '142 prepare-env --platform both 报错提示逗号或 all',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const r1 = runPrepareEnv(['--target', proj, '--platform', 'both'], dir);
      assertExit(r1, 1);
      assertOut(r1, 'both 已移除');
      assertOut(r1, '逗号分隔');
      const r2 = runPrepareEnv(['--target', proj, '--platform', 'claude-code,both'], dir);
      assertExit(r2, 1);
      assertOut(r2, 'both 已移除');
    },
  },

  // 143: 痕迹探测——仅 .dsh/ → probe=dsh;.claude/ + .dsh/ 双痕迹 → 不武断（提示 + 默认主平台 claude-code）
  // （spawn 非 TTY:走探测/默认路径,不触发交互）
  {
    name: '143 prepare-env 痕迹探测:仅 .dsh/ → dsh;双痕迹默认主平台',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const dshHome = path.join(dir, 'dshhome');
      // ① 仅 .dsh/ 痕迹 → probe=dsh → 无 --platform 缺省安装 dsh
      const proj1 = path.join(dir, 'proj1');
      fs.mkdirSync(path.join(proj1, '.dsh'), { recursive: true });
      const r1 = runPrepareEnv(['--target', proj1], dir, { DSH_HOME: dshHome });
      assertExit(r1, 0);
      if (!fs.existsSync(path.join(proj1, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('仅 .dsh/ 痕迹应探测安装 dsh 平台');
      if (fs.existsSync(path.join(proj1, '.claude'))) throw new Error('仅 .dsh/ 痕迹不应安装 claude-code');
      // ② .claude/ + .dsh/ 双痕迹 → 不武断二选一:输出提示 + 默认主平台 claude-code
      const proj2 = path.join(dir, 'proj2');
      fs.mkdirSync(path.join(proj2, '.claude'), { recursive: true });
      fs.mkdirSync(path.join(proj2, '.dsh'), { recursive: true });
      const r2 = runPrepareEnv(['--target', proj2], dir, { DSH_HOME: dshHome });
      assertExit(r2, 0);
      assertOut(r2, '检测到目标项目同时有');
      assertOut(r2, '默认安装 Claude Code');
      if (!fs.existsSync(path.join(proj2, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('双痕迹默认应安装 claude-code');
      if (fs.existsSync(path.join(proj2, '.dsh', 'skills'))) throw new Error('双痕迹默认不应安装 dsh（不武断）');
    },
  },

  // 144: 幂等——同平台重复安装路径替换结果一致（既有语义延续:复制源固定 + 托管区/托管块读-合并-写幂等）
  {
    name: '144 prepare-env 幂等:同平台重复安装结果一致',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true }); // target 项目根须存在（prepare-env 不建父目录——AGENTS.md 写入 ENOENT）
      const dshHome = path.join(dir, 'dshhome');
      const args = ['--target', proj, '--platform', 'dsh'];
      const r1 = runPrepareEnv(args, dir, { DSH_HOME: dshHome });
      assertExit(r1, 0);
      // 首次安装后立即快照——与二次安装后逐字节比较（此前二次后连读恒真，漂移检测失效）
      const skillPath = path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md');
      const sk1 = fs.readFileSync(skillPath, 'utf8');
      const r2 = runPrepareEnv(args, dir, { DSH_HOME: dshHome });
      assertExit(r2, 0);
      // 路径替换结果一致:重复安装后 .dsh/skills 内 SKILL.md 与首次逐字节一致
      const sk2 = fs.readFileSync(skillPath, 'utf8');
      if (sk1 !== sk2) throw new Error('重复安装 SKILL.md 不一致');
      // AGENTS.md 托管区幂等（不重复叠加）
      const agents = fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8');
      const agentsBlocks = agents.split('<!-- Managed by flow-comet prepare-env -->').length - 1;
      if (agentsBlocks !== 1) throw new Error('AGENTS.md 托管区重复注入: ' + agentsBlocks);
      // $DSH_HOME/cordis.patch.yml 托管块幂等（不重复叠加）
      const patch = fs.readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8');
      const patchBlocks = patch.split('# --- flow-comet managed ---').length - 1;
      if (patchBlocks !== 1) throw new Error('cordis.patch.yml 托管块重复注入: ' + patchBlocks);
    },
  },

  // ---------- 场景（多趟路由 plan 出口依赖图校验——多趟语义原位重写：环 BLOCK / 缺失依赖 BLOCK / 混排合法锚 / 旧 change 渐进） ----------

  // 145（多趟语义重写）：新 change + 依赖环（P01↔P02 互为 depends_on）→ exit plan 应 BLOCKED，
  // 输出含「依赖环」（拓扑排序判环）与「depends_on」恢复指引。旧引擎无波次校验静默放行 = 预期 RED。
  {
    name: '145 plan exit BLOCKED：新 change 依赖环（P01↔P02 互为依赖）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_DEP_CYCLE);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '依赖环');
      assertOut(res, 'depends_on');
    },
  },

  // 146（多趟语义重写）：新 change + P01 依赖不存在的 T99 → exit plan 应 BLOCKED，
  // 输出含恢复指引（depends_on 调整）。旧引擎静默放行 = 预期 RED。
  {
    name: '146 plan exit BLOCKED：新 change 并行任务依赖不存在的任务（含恢复指引）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_MISSING_DEP);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'depends_on');
      assertOut(res, 'T99');
    },
  },

  // 147（混排合法锚）：新 change + 串→并→串 → 放行（串行任务位置不再受限，依赖图无环即合法）
  {
    name: '147 plan exit 通过：混排合法锚——串→并→串',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_MIXED_SPS);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 148（混排合法锚）：新 change + 并→串→并 → 放行
  {
    name: '148 plan exit 通过：混排合法锚——并→串→并',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_MIXED_PSP);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 149（混排合法锚）：新 change + 多波混合（≥2 个并行块被串行分隔）→ 放行
  {
    name: '149 plan exit 通过：混排合法锚——多波混合（两并行块被串行分隔）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, renderMultiWaveTasks());
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 150（兼容锚保留）：新 change + 全并行（单连续块仍是合法特例）→ 放行
  {
    name: '150 plan exit 通过：全并行单连续块（合法特例）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_VALID_ALL_PARALLEL);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 151（渐进语义适配）：旧 change（无 newChange）+ 依赖环 → 不 BLOCK（渐进 WARN——断言锁「不阻断」，
  // 检测须真实发生：输出 WARN 且含「依赖环」明细）。混排本身已合法化，渐进路径改由依赖图违规承载。
  {
    name: '151 plan exit 兼容：旧 change 依赖环不 BLOCK（渐进 WARN）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      // 无 newChange（旧 change）
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_DEP_CYCLE);
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      assertOut(res, 'WARN');
      assertOut(res, '依赖环');
    },
  },

  // ----------  场景（契约解析失败检测——record / workflow-handoff result——T01 新增：疑似对象解析失败 fail-closed） ----------

  // 152: record 收到形似对象字面量（{ 开头 / 含 : 或 [）但 JSON.parse 失败的 payload → 应报错含
  // --json-file 提示且不写 evidence。当前实现把不可解析 raw 静默作 summary 字符串落库 = 预期 RED（静默落脏）
  {
    name: '152 record 疑似对象解析失败 → 报错含 --json-file 且不写 evidence',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      // 形似对象字面量但未闭合（PowerShell 剥离内嵌引号后常见的损坏 JSON 形态）
      const bad = '{summary: "intake", completedChecks: ["unit-tests"]';
      const res = runState(['record', 'open', bad], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, '--json-file');
      // fail-closed：state 文件须保持原样（evidence.open 未被脏字符串污染）
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (!st2.evidence.open || st2.evidence.open.summary !== 'intake complete') {
        throw new Error('record 解析失败后仍写入了 evidence（应 fail-closed 不落库）: ' + JSON.stringify(st2.evidence.open));
      }
    },
  },

  // 153: workflow-handoff result 收到形似对象但 JSON.parse 失败的 payload → 应报错含 --json-file
  // 且不写 handoffResult。当前实现把不可解析 raw 静默作字符串存入 handoffResult = 预期 RED（静默落脏）
  {
    name: '153 handoff result 疑似对象解析失败 → 报错含 --json-file 且不写 handoffResult',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = { handoffRequest: { T01: { taskId: 'T01' } } };
      writeState(dir, st);
      // 形似对象字面量但未闭合（损坏的 Return Contract JSON）
      const bad = '{"commitHash": "abcd1234", "completedChecks": ["required-skill:';
      const res = runHandoff(['result', 'T01', bad], dir);
      assertExit(res, 1);
      assertOut(res, '--json-file');
      // fail-closed：handoffResult 不得写入
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      const hr = st2.evidence && st2.evidence['subagent-execute'] && st2.evidence['subagent-execute'].handoffResult;
      if (hr && hr.T01) {
        throw new Error('handoff result 解析失败后仍写入了 handoffResult（应 fail-closed 不落库）: ' + JSON.stringify(hr.T01));
      }
    },
  },

  // ---------- 场景（mechanism-skill-robustness 试先行 RED：共享判定单一来源 / --json-file 消息分级 /
  // 启发式安全侧边界锚定 / 零提交正式语义 / SUMMARY·TASK7·三文档模板保真 / 技能加载前置门 /
  // next·entry 输出点名 / 技能加载措辞 / next 进行中节点保护扩展） ----------

  // 154: 疑似对象判定单一来源（设计语义 / AC-1）——workflow-state.mjs 与 workflow-handoff.mjs
  // 不得各自定义 looksLikeObjectLiteral，必须从 state-schema.mjs import（单一来源 fail-closed）。
  // 当前两脚本各有一份逐字重复定义、state-schema 无导出 → 预期 RED。
  {
    name: '154 疑似对象判定单一来源：state/handoff 从 state-schema import（禁止各自定义）',
    run: (dir) => {
      const schemaPath = path.join(__dirname, 'state-schema.mjs');
      const script = `
        const fs = require('fs');
        const state = fs.readFileSync(process.argv[1], 'utf8');
        const handoff = fs.readFileSync(process.argv[2], 'utf8');
        const schema = fs.readFileSync(process.argv[3], 'utf8');
        const issues = [];
        if (/function\\s+looksLikeObjectLiteral\\s*\\(/.test(state)) issues.push('workflow-state.mjs 仍自带 looksLikeObjectLiteral 定义');
        if (/function\\s+looksLikeObjectLiteral\\s*\\(/.test(handoff)) issues.push('workflow-handoff.mjs 仍自带 looksLikeObjectLiteral 定义');
        if (!/looksLikeObjectLiteral/.test(schema)) issues.push('state-schema.mjs 未导出共享判定');
        if (!/import\\s*\\{[^}]*looksLikeObjectLiteral[^}]*\\}\\s*from\\s*['"]\\.\\/state-schema\\.mjs['"]/.test(state)) issues.push('workflow-state.mjs 未从 state-schema.mjs import');
        if (!/import\\s*\\{[^}]*looksLikeObjectLiteral[^}]*\\}\\s*from\\s*['"]\\.\\/state-schema\\.mjs['"]/.test(handoff)) issues.push('workflow-handoff.mjs 未从 state-schema.mjs import');
        if (issues.length > 0) { console.error(issues.join('; ')); process.exit(1); }
        console.log('SINGLE SOURCE OK');
      `;
      const res = spawnSync(process.execPath, ['-e', script, STATE, HANDOFF, schemaPath], { encoding: 'utf8', timeout: 60000 });
      assertExit(res, 0);
      assertOut(res, 'SINGLE SOURCE OK');
    },
  },

  // 155: record 契约解析失败消息分级（设计语义 / AC-3）——--json-file 传入损坏 JSON（以 { 开头）
  // → 报"文件内容不是合法 JSON" + 长度元数据，且不再建议使用 --json-file；内联传参损坏仍建议
  // --json-file。当前两分支同一英文文案（都建议 use --json-file）→ ① 断言 RED。
  {
    name: '155 record 契约解析失败消息分级：--json-file 损坏提示非合法；内联仍提示 --json-file',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // ① --json-file 指向损坏 JSON（以 { 开头）→ "不是合法 JSON" + 长度元数据，不再建议 --json-file
      writeFile(dir, 'payload.json', '{summary: "broken", completedChecks: ["x"]');
      const resFile = runState(['record', 'open', '--json-file', 'payload.json'], dir, env);
      assertExit(resFile, 1);
      assertNotOut(resFile, '--json-file');
      assertOut(resFile, '不是合法 JSON');
      assertOut(resFile, 'length=');
      // ② 内联传参损坏（以 { 开头）→ 仍建议 --json-file（既有语义保留）
      const bad = '{summary: "broken"';
      const resInline = runState(['record', 'open', bad], dir, env);
      assertExit(resInline, 1);
      assertOut(resInline, '--json-file');
    },
  },

  // 156: 疑似对象启发式安全侧边界锚定（设计语义 / AC-4）——内联纯文本恰好以 [ 开头 → 启发式判为
  // 疑似对象、JSON.parse 失败 → fail-closed（exit 1 + 提示、不落库）。当前即如此 → 本场景 GREEN
  // （只锚定现状，不改行为）。
  {
    name: '156 启发式安全侧边界：内联纯文本以 [ 开头 → fail-closed（锚定现状）',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const res = runState(['record', 'open', '[plain-text-not-json'], dir, env);
      assertExit(res, 1);
      if (!/--json-file|not valid JSON|不是合法 JSON/.test(res.output)) {
        throw new Error('fail-closed 应有提示（--json-file / not valid JSON / 不是合法 JSON），实际输出: ' + res.output);
      }
      // fail-closed：evidence 不被污染
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (!st2.evidence.open || st2.evidence.open.summary !== 'intake complete') {
        throw new Error('纯文本以 [ 开头应 fail-closed 不落库，state 被污染: ' + JSON.stringify(st2.evidence.open));
      }
    },
  },

  // 157: 零提交任务正例（设计语义 / AC-5）——request write_files 为空 + 契约显式 noCommit + result
  // 无任何提交 → 跳过提交文件子集校验并输出可审计"零提交"提示（不误 BLOCK）。当前无 noCommit 概念：
  // 新 change 空 write_files 结果反而被"允许列表为空"拦 BLOCK → 预期 RED。
  {
    name: '157 零提交正例：write_files 空 + 契约 noCommit → 跳过提交校验 + 可审计提示',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.newChange = true;
      st.evidence['subagent-execute'] = { handoffRequests: { T01: { description: 'zero-commit task', writeFiles: [] } } };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" status="done"><action>only docs already tracked</action><write_files></write_files><verify>node --check src/t1.mjs</verify></task>\n');
      const res = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check src/t1.mjs', output: 'no output（RED 锚点）' },
        greenEvidence: { command: 'node --check src/t1.mjs', output: 'ok' },
      })], dir);
      assertExit(res, 0);
      assertOut(res, '零提交');
    },
  },

  // 158: 零提交滥用负例（设计语义 / AC-6）——write_files 非空任务的结果契约声称 noCommit →
  // 不得借零提交声明绕过真实提交检查：仍走完整提交文件子集校验（越界 → 新 change BLOCK），且输出
  // 可审计的"零提交声明与 write_files 非空矛盾"提示。当前无 noCommit 概念（完整校验本身已生效，
  // RED 来自缺失的机制审计提示）→ 预期 RED。
  {
    name: '158 零提交滥用负例：write_files 非空 + 声称 noCommit → 仍完整校验 + 矛盾审计提示',
    run: (dir) => {
      const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      g(['init', '-q']);
      g(['config', 'user.email', 't@t']);
      g(['config', 'user.name', 't']);
      writeFile(dir, 'allowed.js', 'export const allowed = 1;\n');
      writeFile(dir, 'rogue.js', 'export const rogue = 1;\n');
      g(['add', 'allowed.js', 'rogue.js']);
      g(['commit', '-qm', 'init']);
      const hash = g(['rev-parse', 'HEAD']).stdout.trim();
      const st = baseState('subagent-execute');
      st.newChange = true;
      st.evidence['subagent-execute'] = { handoffRequests: { T01: { description: 'normal task', writeFiles: ['allowed.js'] } } };
      writeState(dir, st);
      const res = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', noCommit: true, commitHash: hash,
        changedFiles: ['allowed.js', 'rogue.js'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check allowed.js', output: 'no output（RED 锚点）' },
        greenEvidence: { command: 'node --check allowed.js', output: 'ok' },
      })], dir);
      assertExit(res, 1);
      assertOut(res, '超出 writeFiles 范围');
      assertOut(res, '零提交');
    },
  },

  // 159: SUMMARY 模板保真（设计语义 / AC-7）——execute 出口每份 *-SUMMARY.md 须含 `# SUMMARY:` 标题 +
  // 首部 4 字段（Change ID/Task ID/完成时间/AI 角色）+ 段序（含 flow-comet 增量 ## 自检方法 段）。
  // 缺任一：新 change BLOCK（exit 1 + 缺失点与恢复指引）；合法变体（编号前缀/括号后缀/大小写）通过；
  // 旧 change → WARN 渐进。当前 guard 只查 verify输出/6维自查/越界检查 3 段存在 → 缺标题等场景 RED。
  {
    name: '159 execute exit SUMMARY 模板保真：缺标题/首部/段序新 BLOCK，合法变体通过，旧 WARN',
    run: (dir) => {
      const marker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/execute-flow-comet-dev.json',
          JSON.stringify({ node: 'execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      const header = [
        '- **Change ID**: ' + CHANGE_ID,
        '- **Task ID**: T01',
        '- **完成时间**: 2026-08-20 10:00',
        '- **AI 角色**: Dev',
      ].join('\n');
      const sections = [
        '## 做了什么\n\n实现 T01（TDD：先写失败场景再实现）。',
        '## 改动文件\n\n| 文件 | 性质 | 说明 |\n|---|---|---|\n| src/t1.mjs | 修改 | 实现 T01 |',
        '## verify 输出\n\n```\nnode --check src/t1.mjs\n```',
        '## 6 维自查\n\n- 功能: 通过（brooks-review 已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
        '## 越界检查\n\n仅修改 src/t1.mjs，无越界。',
        '## 自检方法\n\nbrooks-review',
      ];
      const compose = (title, order) =>
        [title, '', header, '', '---', '', order.join('\n\n')].join('\n');
      const setupExecute = (newChange) => {
        const st = baseState('execute');
        st.evidence.execute = { summary: 'executed' };
        st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
        if (newChange) { st.newChange = true; st.enteredNodes = ['execute']; }
        writeState(dir, st);
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
        marker();
      };
      // ① 新 change：缺 `# SUMMARY:` 标题（段齐全）→ BLOCK
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# T01-SUMMARY', sections));
      const res1 = runGuard(['exit', 'execute'], dir);
      assertExit(res1, 1);
      assertOut(res1, 'BLOCKED');
      assertOut(res1, '# SUMMARY:');
      // ② 新 change：标题在但首部缺字段（仅 2 字段）→ BLOCK
      const headerMissing = [
        '- **Change ID**: ' + CHANGE_ID,
        '- **Task ID**: T01',
      ].join('\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md',
        ['# SUMMARY: T01 - 实现 T01', '', headerMissing, '', '---', '', sections.join('\n\n')].join('\n'));
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 1);
      assertOut(res2, 'BLOCKED');
      // ③ 新 change：段序乱（自检方法提前、做了什么滞后）→ BLOCK
      const scrambled = [sections[2], sections[4], sections[3], sections[5], sections[0], sections[1]];
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', scrambled));
      const res3 = runGuard(['exit', 'execute'], dir);
      assertExit(res3, 1);
      assertOut(res3, 'BLOCKED');
      // ④ 合法变体：大小写（# Summary: …）→ 通过
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# Summary: T01 - 实现 T01', sections));
      const res4 = runGuard(['exit', 'execute'], dir);
      assertExit(res4, 0);
      assertOut(res4, 'ALL CHECKS PASSED');
      // ⑤ 合法变体：括号后缀 → 通过
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01（含说明括号）', sections));
      const res5 = runGuard(['exit', 'execute'], dir);
      assertExit(res5, 0);
      assertOut(res5, 'ALL CHECKS PASSED');
      // ⑥ 旧 change：缺标题 → WARN 渐进不阻断
      setupExecute(false);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# T01-SUMMARY', sections));
      const res6 = runGuard(['exit', 'execute'], dir);
      assertExit(res6, 0);
      assertOut(res6, 'WARN');
    },
  },

  // 160: plan exit TASK 7 字段完整性（设计语义 / AC-8）——每个 <task> 须含 name/read_files/
  // write_files/action/verify/done/depends_on。缺任一：新 BLOCK；旧 WARN。当前 guard 只查
  // <verify> 存在 → 缺 write_files 场景新 change 应 BLOCK 却放行 → 预期 RED。
  {
    name: '160 plan exit TASK 7 字段：缺 write_files 新 BLOCK / 旧 WARN',
    run: (dir) => {
      const missingWrite =
        '<task id="T01" status="pending"><name>任务一</name><read_files>src/*</read_files><action>实现 T01</action><verify>node --check src/t1.mjs</verify><done>AC-1</done><depends_on></depends_on></task>\n';
      const addPlanMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/plan-flow-comet-task.json',
          JSON.stringify({ node: 'plan', skill: 'flow-comet-task', protocol: '3-task.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      // ① 新 change：缺 write_files → BLOCK（含字段名）
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      addPlanMarker();
      const res = runPlanExit(dir, missingWrite);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'write_files');
      // ② 旧 change：同构造 → WARN 渐进不阻断
      const stOld = baseState('plan');
      stOld.evidence.plan = { summary: 'plan done' };
      writeState(dir, stOld);
      addPlanMarker();
      const resOld = runPlanExit(dir, missingWrite);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');
    },
  },

  // 161: open/design 出口 CHANGE/REQUIREMENT/DESIGN 模板保真（设计语义 / AC-9）——标题
  // （# CHANGE: / # REQUIREMENT: / # DESIGN:）+ 首部 + 段序（模板派生宽松匹配，编号前缀/括号
  // 后缀/大小写兼容，防误拦）。缺任一：新 BLOCK；旧 WARN。当前 guard 只查 Why/用户故事/AC/
  // 决策清单等单段存在 → 缺标题场景新 change 应 BLOCK 却放行 → 预期 RED。
  {
    name: '161 open/design 出口三文档模板保真：缺标题新 BLOCK / 旧 WARN',
    run: (dir) => {
      const addOpenMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
          JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      const addDesignMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/design-flow-comet-design.json',
          JSON.stringify({ node: 'design', skill: 'flow-comet-design', protocol: '2-design.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      // ① open 出口 新 change：REQUIREMENT 缺 `# REQUIREMENT:` 标题（段齐全）→ BLOCK
      const stOpen = baseState('open');
      stOpen.evidence.open = { summary: 'intake complete' };
      stOpen.newChange = true;
      stOpen.enteredNodes = ['open'];
      writeState(dir, stOpen);
      addOpenMarker();
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# 变更文档\n\n## Why（为什么做）\n\n原因。\n\n## 范围（Scope）\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# 需求文档\n\n## 用户故事\n\n- US-1 作为维护者……\n\n## 验收准则（AC）\n\n- Given X When Y Then Z\n');
      const resOpen = runGuard(['exit', 'open'], dir);
      assertExit(resOpen, 1);
      assertOut(resOpen, 'BLOCKED');
      assertOut(resOpen, 'REQUIREMENT');
      // ② design 出口 新 change：DESIGN 缺 `# DESIGN:` 标题（段齐全）→ BLOCK
      const stDesign = baseState('design');
      stDesign.evidence.design = { summary: 'design done' };
      stDesign.newChange = true;
      stDesign.enteredNodes = ['design'];
      writeState(dir, stDesign);
      addDesignMarker();
      writeFile(dir, 'flow-kit/templates/DESIGN.md', '# DESIGN 模板\n\n## 0. 技术栈选型\n## 1. 技术决策清单\n## 2. 数据流\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# 设计文档\n\n## 0. 技术栈选型\n\n- 选定：Node.js\n\n## 决策清单\n\n| # | 决策 | 选择 | 理由 |\n|---|---|---|---|\n| D1 | X | Y | Z |\n');
      const resDesign = runGuard(['exit', 'design'], dir);
      assertExit(resDesign, 1);
      assertOut(resDesign, 'BLOCKED');
      assertOut(resDesign, 'DESIGN');
      // ③ 旧 change open 同构造（REQUIREMENT 缺标题）→ WARN 渐进不阻断
      const stOld = baseState('open');
      stOld.evidence.open = { summary: 'intake complete' };
      writeState(dir, stOld);
      addOpenMarker();
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# 变更文档\n\n## Why（为什么做）\n\n原因。\n\n## 范围（Scope）\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# 需求文档\n\n## 用户故事\n\n- US-1 作为维护者……\n\n## 验收准则（AC）\n\n- Given X When Y Then Z\n');
      const resOld = runGuard(['exit', 'open'], dir);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');
    },
  },

  // 162: 技能加载前置门（设计语义 / AC-10）——新 change：handoff request 无本节点声明标记
  // 应 BLOCK；record 无声明（payload 不含 completedChecks）应 BLOCK；旧 change → WARN 渐进。
  // 当前 request 不查声明、record 靠 M5 自动补 → 不拦 → 预期 RED。
  {
    name: '162 技能加载前置门：request/record 无声明新 BLOCK / 旧 WARN',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // ① handoff request 前置门：新 change、subagent-execute 节点无声明标记 → BLOCK
      const stReq = baseState('subagent-execute');
      stReq.newChange = true;
      writeState(dir, stReq);
      const resReq = runHandoff(['request', 'T01', 'delegate parallel task'], dir);
      assertExit(resReq, 1);
      assertOut(resReq, '先加载技能');
      // ② record 前置门：新 change、plan 节点无声明标记、payload 不含 completedChecks → BLOCK
      const stRec = baseState('plan');
      stRec.newChange = true;
      writeState(dir, stRec);
      const resRec = runState(['record', 'plan', '{"summary":"plan done"}'], dir, env);
      assertExit(resRec, 1);
      assertOut(resRec, '先加载技能');
      // ③ 旧 change：record 无声明 → WARN 渐进不阻断
      const stOld = baseState('plan');
      writeState(dir, stOld);
      const resOld = runState(['record', 'plan', '{"summary":"plan done"}'], dir, env);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');
    },
  },

  // 163: next / guard entry 输出点名加载（设计语义 / AC-17）——`workflow-state next` 与
  // `workflow-guard entry` 输出应含 `LOAD SKILL: <skill>（用 Skill 工具，禁止跳过）`。
  // 当前 printNext / entry 无该行 → 预期 RED。
  {
    name: '163 next / entry 输出点名 LOAD SKILL：用 Skill 工具，禁止跳过',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // ① next：open 节点 → 输出点名 flow-comet-open
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      const resNext = runState(['next'], dir, env);
      assertExit(resNext, 0);
      assertOut(resNext, 'LOAD SKILL: flow-comet-open');
      assertOut(resNext, '禁止跳过');
      // ② guard entry：plan 节点 → 输出点名 flow-comet-plan
      const st2 = baseState('plan');
      writeState(dir, st2);
      const resEntry = runGuard(['entry', 'plan'], dir, env);
      assertExit(resEntry, 0);
      assertOut(resEntry, 'LOAD SKILL: flow-comet-plan');
      assertOut(resEntry, '禁止跳过');
    },
  },

  // 164: 技能加载措辞（设计语义 / AC-16）——主 SKILL（SKILL.md / GUIDANCE.md）与节点 SKILL
  // 须含「Skill 工具」与「不得跳过/禁止跳过」。当前主 SKILL 已含、部分节点 SKILL 已含，但
  // open/design/plan/verify/archive 等节点 SKILL 缺 → 预期 RED。
  {
    name: '164 技能加载措辞：主 SKILL 与节点 SKILL 含 Skill 工具 + 不得/禁止跳过',
    run: (dir) => {
      const files = [
        path.join(__dirname, '..', 'SKILL.md'),
        path.join(__dirname, '..', 'GUIDANCE.md'),
        ...['flow-comet-open', 'flow-comet-design', 'flow-comet-plan', 'flow-comet-execute',
          'flow-comet-subagent-execute', 'flow-comet-review', 'flow-comet-verify', 'flow-comet-archive']
          .map((s) => path.join(__dirname, '..', '..', s, 'SKILL.md')),
      ];
      const relativeBase = path.join(__dirname, '..', '..', '..');
      const missing = [];
      for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        const hasTool = text.includes('Skill 工具');
        const hasSkip = text.includes('不得跳过') || text.includes('禁止跳过');
        if (!hasTool || !hasSkip) {
          const why = !hasTool && !hasSkip ? '缺「Skill 工具」与「不得/禁止跳过」' : (hasTool ? '缺「不得/禁止跳过」' : '缺「Skill 工具」');
          missing.push(path.relative(relativeBase, f) + ' ' + why);
        }
      }
      if (missing.length > 0) {
        throw new Error('技能加载措辞缺失: ' + missing.join('; '));
      }
    },
  },

  // 165: next 进行中节点保护扩展（承接既有保护场景）——已 entry 但未 record 的节点（enteredNodes 含 plan、
  // TASK.md 存在、无 evidence.plan）跑 next → 不得把 currentNode 推走（保持 plan，输出 NODE: plan）。
  // 当前保护只看 evidence（record 过）→ 会把 currentNode 推到 execute → 预期 RED。
  {
    name: '165 next 保护扩展：entered 未 record 节点不推走（保持 plan）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\n\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\nx\n\n## 验收准则（AC）\n\n- Given x When y Then z');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈选型\n\n- 选定：Node\n\n## 1. 技术决策清单\n\n| # | D | R |\n|---|---|---|\n| D1 | x | y |');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_SERIAL_PENDING);
      const st = {
        activeChange: CHANGE_ID,
        currentNode: 'plan',
        completedNodes: ['open', 'design'],
        enteredNodes: ['open', 'design', 'plan'],
        evidence: {
          open: { summary: 'intake complete' },
          design: { summary: 'design done' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      };
      writeState(dir, st);
      const res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'NODE: plan');
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      if (st2.currentNode !== 'plan') {
        throw new Error('entered 未 record 的节点不应被推进，currentNode 应为 plan，实际: ' + st2.currentNode);
      }
    },
  },

  // 166: 节点 SKILL 加载声明与协议一致（防回归锁）——每个节点 SKILL.md 必须含
  // requiredSkillCalls（非 advisory）对应的完整 skill-load 声明命令行与协议文件映射。
  {
    name: '166 节点 SKILL 声明命令与 workflow-protocol.json 一致',
    run: () => {
      const protocol = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'reference', 'workflow-protocol.json'), 'utf8'));
      const promptBySkill = {
        'flow-comet-change': '0-change.md',
        'flow-comet-requirement': '1-requirement.md',
        'flow-comet-design': '2-design.md',
        'flow-comet-task': '3-task.md',
        'flow-comet-dev': '4-dev.md',
        'flow-comet-review': '6-review.md',
        'flow-comet-test': '5-test.md',
        'flow-comet-integration': '7-integration.md',
      };
      const advisory = new Set(['flow-comet-ui-design']);
      const problems = [];
      for (const node of protocol.nodes) {
        const impl = node.implementation && node.implementation.skill;
        if (!impl) continue;
        const text = fs.readFileSync(path.join(__dirname, '..', '..', impl, 'SKILL.md'), 'utf8');
        for (const call of node.requiredSkillCalls || []) {
          if (advisory.has(call.skill)) continue;
          const promptFile = promptBySkill[call.skill];
          if (!promptFile) { problems.push(impl + ' 缺 ' + call.skill + ' 的 prompt 映射'); continue; }
          const line = 'skill-load ' + node.id + ' ' + call.skill + ' --prompt flow-kit/prompts/' + promptFile;
          if (!text.includes(line)) problems.push(impl + ' 缺声明命令: ' + line);
        }
      }
      if (problems.length > 0) throw new Error('节点 SKILL 声明命令与协议不一致: ' + problems.join('; '));
    },
  },

  // 167: 两层加载模型措辞——阶段层禁止在节点 SKILL 内指示用 Skill 工具加载任何节点实现技能
  //（本节点技能已由入口路由经 Skill 工具加载）；入口层禁止 Implementation/Required 混淆句式；
  // 全部 10 文件禁止无限定「record 会自动补写缺失的声明标记」表述（与新 change 技能加载前置门矛盾）。
  {
    name: '167 两层加载模型措辞：禁自加载句式/禁混淆句式/自动补分新旧',
    run: () => {
      const nodeDirs = ['flow-comet-open', 'flow-comet-design', 'flow-comet-plan', 'flow-comet-execute',
        'flow-comet-subagent-execute', 'flow-comet-review', 'flow-comet-verify', 'flow-comet-archive'];
      const implPattern = /用\s*Skill\s*工具加载[^。\n]{0,60}flow-comet-(open|design|plan|execute|subagent-execute|review|verify|archive)/;
      const autoFill = 'record 会自动补写缺失的声明标记';
      const stageAnchor = '本节点技能已由入口路由经 Skill 工具加载';
      const entryAnchor = 'Skill 工具加载该节点的 Implementation 技能';
      const problems = [];
      for (const id of nodeDirs) {
        const text = fs.readFileSync(path.join(__dirname, '..', '..', id, 'SKILL.md'), 'utf8');
        if (implPattern.test(text)) problems.push(id + ' 含「用 Skill 工具加载节点实现技能」句式');
        if (text.includes(autoFill)) problems.push(id + ' 含无限定自动补表述');
        if (!text.includes(stageAnchor)) problems.push(id + ' 缺阶段层锚点句');
      }
      for (const name of ['SKILL.md', 'GUIDANCE.md']) {
        const text = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
        if (text.includes('见上方 Required Calls 表')) problems.push(name + ' 含 Implementation/Required 混淆句式');
        if (text.includes(autoFill)) problems.push(name + ' 含无限定自动补表述');
        if (!text.includes(entryAnchor)) problems.push(name + ' 缺入口层锚点句');
        if (!text.includes('前置门')) problems.push(name + ' 缺前置门表述');
      }
      if (problems.length > 0) throw new Error('两层加载模型措辞不符: ' + problems.join('; '));
    },
  },

  // 168: verify 出口 EPERM 降级——受限沙箱会话中管道式执行子进程被拒（EPERM）时，
  // 以继承 stdio 重试同一命令：①输出含 VERIFY-DEGRADED 行（降级捕获标记）；②验证命令的
  // 副作用标记文件被真实写入（证明 inherit 重试真实执行——真实受限会话中管道阶段命令根本
  // 不启动，标记文件只能由重试写入）；③最终按退出码判定通过（guard exit=0）。
  // 测试钩子 FLOW_COMET_VERIFY_FORCE_EPERM=1 使首次管道执行模拟 EPERM 拒绝（仅测试用途——
  // 生产触发条件是真实 spawn 层 EPERM），降级路径因此可确定性自动化断言。
  {
    name: '168 verify 出口 EPERM 降级：VERIFY-DEGRADED 行 + inherit 真实重试 + exit 0',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      writeState(dir, st);
      // 验证命令写副作用标记文件（相对 cwd=runRoot）——文件存在即证明命令被真实执行
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "require(\'fs\').writeFileSync(\'verify-marker.txt\',\'ok\')"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      const marker = path.join(dir, 'verify-marker.txt');
      if (fs.existsSync(marker)) fs.rmSync(marker);
      const res = runGuard(['exit', 'verify'], dir, { FLOW_COMET_VERIFY_FORCE_EPERM: '1' });
      assertOut(res, 'VERIFY-DEGRADED');
      if (!fs.existsSync(marker)) {
        throw new Error('EPERM 降级后标记文件未被写入——inherit 重试未真实执行\n实际输出:\n' + res.output);
      }
      if (fs.readFileSync(marker, 'utf8') !== 'ok') throw new Error('标记文件内容异常');
      assertExit(res, 0);
    },
  },

  // 169: 非 EPERM 失败不降级——验证命令真实失败（非零退出、无 EPERM、无钩子）时行为与
  // 现状一致：VERIFY-FAIL 计数语义输出、不含 VERIFY-DEGRADED 行、guard exit≠0。
  // （锚定场景：防止降级逻辑扩大化吞掉真实测试失败——降级边界）
  {
    name: '169 非 EPERM 失败不降级：VERIFY-FAIL 照常且无 VERIFY-DEGRADED 行',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "process.exit(3)"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      const res = runGuard(['exit', 'verify'], dir);
      assertExit(res, 1);
      assertOut(res, 'VERIFY-FAIL');
      assertNotOut(res, 'VERIFY-DEGRADED');
    },
  },

  // 170: 零提交旁路收紧——noCommit 结果若携带 tracked 提交：新 change BLOCKED / 旧 change
  // HANDOFF WARN；空提交（--allow-empty）正例通过。锚定 AC-1（防「空 write_files 声明」
  // 成为携带任意提交的逃逸口——bot 评审 Major）。
  {
    name: '170 零提交旁路：携带 tracked 提交新 BLOCK / 旧 WARN / 空提交通过',
    run: (dir) => {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
      writeFile(dir, 'src/x.js', 'x');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'src/x.js');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'tracked');
      const hashTracked = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const mkState = (isNew) => {
        const st = baseState('subagent-execute');
        if (isNew) st.newChange = true;
        st.evidence['subagent-execute'] = st.evidence['subagent-execute'] || {};
        st.evidence['subagent-execute'].handoffRequests = {
          T9: { description: 'zero-commit', noCommit: true },
          T10: { description: 'zero-commit legacy', noCommit: true },
          T11: { description: 'zero-commit empty', noCommit: true },
        };
        writeState(dir, st);
      };
      const payload = (id, hash) => JSON.stringify({ status: 'DONE', taskId: id, commitHash: hash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'n', output: 'n' }, redEvidence: { command: 'r', output: 'r' } });
      // ① 新 change + 含 tracked 文件的提交 → BLOCKED
      mkState(true);
      const res1 = runHandoff(['result', 'T9', payload('T9', hashTracked)], dir);
      assertExit(res1, 1);
      assertOut(res1, '声明零提交但提交携带');
      // ② 旧 change 同构造 → WARN 不阻断
      mkState(false);
      const res2 = runHandoff(['result', 'T10', payload('T10', hashTracked)], dir);
      assertExit(res2, 0);
      assertOut(res2, 'HANDOFF WARN');
      // ③ 新 change + 空提交 → 通过
      mkState(true);
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'empty');
      const hashEmpty = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const res3 = runHandoff(['result', 'T11', payload('T11', hashEmpty)], dir);
      assertExit(res3, 0);
      assertOut(res3, '提交为空，校验通过');
    },
  },

  // 171: 入口文档首部 Change ID 新 change 强制——标题/段序合规但缺 `- **Change ID**:`
  // 首部字段：新 change open 出口 BLOCKED（文案「首部缺 Change ID」）；旧 change WARN 渐进。
  // （对齐 AC「标题·首部·段序」统一强制口径——bot 评审指出此前仅 softWarning 与承诺不符。）
  {
    name: '171 入口首部 Change ID 新 BLOCK / 旧 WARN',
    run: (dir) => {
      const addOpenMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
          JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      const writeChange = (withId) => {
        const head = withId ? '- **Change ID**: ' + CHANGE_ID + '\n' : '';
        writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE: 标题\n\n' + head + '\n## Why（为什么做）\n\n原因。\n');
        writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT: 标题\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 用户故事\n\n- US-1\n\n## 验收准则（AC）\n\n- Given a When b Then c\n');
      };
      // ① 新 change 缺首部字段 → BLOCK
      const stNew = baseState('open');
      stNew.evidence.open = { summary: 'intake complete' };
      stNew.newChange = true;
      stNew.enteredNodes = ['open'];
      writeState(dir, stNew);
      addOpenMarker();
      writeChange(false);
      const resBad = runGuard(['exit', 'open'], dir);
      assertExit(resBad, 1);
      assertOut(resBad, 'BLOCKED');
      assertOut(resBad, '首部缺 Change ID');
      // ② 新 change 含首部字段 → 通过
      writeChange(true);
      const resGood = runGuard(['exit', 'open'], dir);
      assertExit(resGood, 0);
      assertOut(resGood, 'ALL CHECKS PASSED');
      // ③ 旧 change 缺首部字段 → WARN 渐进不阻断
      const stOld = baseState('open');
      stOld.evidence.open = { summary: 'intake complete' };
      writeState(dir, stOld);
      addOpenMarker();
      writeChange(false);
      const resOld = runGuard(['exit', 'open'], dir);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');
    },
  },

  // ---------- 场景（多趟路由核心——多趟推进完成 / 零进展防呆 / 委托节点二次进入完成判定 / 向后兼容等价） ----------

  // 172: 多波混合推进完成（AC-1/AC-2）——多波混合 TASK 经 next 分趟自动路由直至清空：
  // 无 eligible 并行时回串行消化（execute）；依赖满足即再入 subagent-execute（第二趟——
  // completedNodes 已含该节点仍路由回 = 多趟循环路由）；全部 done 后经产物门控进 review。
  // 旧引擎单趟限制下第三步会停留在 execute = 预期 RED。
  {
    name: '172 多波混合推进完成：分趟自动路由直至清空进 review',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      const goNext = (currentNode, doneIds, completedExtra = []) => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + renderMultiWaveTasks(doneIds));
        writeState(dir, {
          activeChange: CHANGE_ID,
          currentNode,
          completedNodes: ['open', 'design', 'plan', ...completedExtra],
          evidence: {
            open: { summary: 'o' },
            design: { summary: 'd' },
            plan: { summary: 'p' },
            ...(completedExtra.includes('subagent-execute') ? { 'subagent-execute': { summary: 'wave delegated' } } : {}),
            ...(completedExtra.includes('execute') ? { execute: { summary: 'serial digested' } } : {}),
          },
          verifyFailures: 0,
          executionMode: 'subagent',
          directOverride: false,
        });
        return runState(['next'], dir, env);
      };
      // 趟 0：无可委托并行（P 波依赖 T01 未完成）、串行 T01 pending → execute
      let res = goNext('execute', []);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // 趟 1：T01 done → P01/P02 eligible → 第一趟委托
      res = goNext('execute', ['T01']);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // 趟间：P01/P02 done（第一趟委托收集完成）→ 回 execute 消化 T02（第二波未满足不抢跑）
      res = goNext('subagent-execute', ['T01', 'P01', 'P02'], ['subagent-execute']);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // 趟 2（多趟关键断言）：T02 done → P03/P04 eligible → 第二趟再入 subagent-execute
      //（真实链路中此处由 execute exit --apply 的平行路由镜像直接落点；next 级断言同一谓词）
      res = goNext('subagent-execute', ['T01', 'P01', 'P02', 'T02'], ['subagent-execute', 'execute']);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // 清空：全部 done + SUMMARY 在场 → 委托与串行均无残留 → review（产物门控照旧）。
      // 状态取真实链路形态：completedNodes 按路由序排列（末元素 = subagent-execute，
      // 其 exit --apply 已把 currentNode 推到 review——正常推进豁免放行 next）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      res = goNext('review', ['T01', 'P01', 'P02', 'T02', 'P03', 'P04'], ['execute', 'subagent-execute']);
      assertExit(res, 0);
      assertOut(res, 'NODE: review');
    },
  },

  // 173: 单趟零进展防呆（三重防呆决策之二·状态机侧）——TASK 仅剩依赖无法满足的孤儿并行任务（depends_on 引用
  // 不存在的 T99）：既无可委托并行又无串行 pending 且 TASK 未全 done → next 应 BLOCKED 防静默死锁。
  // 旧引擎无防呆静默路由 execute = 预期 RED。
  {
    name: '173 单趟零进展 BLOCK：孤儿并行依赖无法满足（检查 depends_on）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T99</depends_on></task>\n');
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes: ['open', 'design', 'plan'],
        evidence: { open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      const res = runState(['next'], dir, env);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '孤儿并行');
      assertOut(res, 'depends_on');
    },
  },

  // 174: 委托节点二次进入完成判定（AC-2 合取语义）——completedNodes 含 subagent-execute：
  // ① 仍有 eligible 并行 pending → next 返回 NODE: subagent-execute（未最终完成，继续委托）；
  // ② 并行全 done、仅串行 pending → NODE: execute（本趟委托完成，趟间回串行）；
  // ③ 全部 done + SUMMARY 在场 → NODE: review（可委托集合为空 ∧ 无串行 pending → 最终完成）。
  // 旧引擎①停留 execute = 预期 RED。
  {
    name: '174 委托节点二次进入完成判定：eligible 再入 → 趟间串行 → 清空进 review',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      const pDone = (id, deps) =>
        '<task id="' + id + '" status="done" parallel="true"><action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files><verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
        (deps ? '<depends_on>' + deps + '</depends_on>' : '') + '</task>\n';
      const t03 = (status) =>
        '<task id="T03"' + (status ? ' status="' + status + '"' : '') + '><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
      // ① 第一波 P01 done + 第二波 P02（dep P01）pending eligible + 串行 T03 pending → 二次进入委托
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2_PENDING + t03(''));
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'subagent-execute',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        evidence: {
          open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' },
          execute: { summary: 'serial digested' }, 'subagent-execute': { summary: 'wave1 delegated' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      let res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // ② P02 也 done → 可委托集合为空、串行 T03 pending → 趟间回 execute
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + pDone('P02', 'P01') + t03(''));
      res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // ③ 全部 done + SUMMARY 在场 → 合取完成（无 eligible ∧ 无 serial pending）→ review
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + pDone('P02', 'P01') + t03('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/T03-SUMMARY.md', summaryContent());
      res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'NODE: review');
    },
  },

  // 175: 向后兼容等价断言（AC-3）——旧合法形态在新引擎下路由结果与旧期望一致（零行为漂移）：
  // 全串行 → execute；并→串首趟 → subagent-execute；并→串委托完成后（无新 eligible）→ execute；
  // 串→并首趟 → execute（先串行）。旧合法序列退化为单趟，行为不变。
  {
    name: '175 向后兼容等价：旧合法形态路由结果与旧期望一致',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      const goNext = (taskContent, currentNode, completedExtra = [], withExecuteEvidence = false) => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + taskContent);
        writeState(dir, {
          activeChange: CHANGE_ID,
          currentNode,
          completedNodes: ['open', 'design', 'plan', ...completedExtra],
          evidence: {
            open: { summary: 'o' },
            design: { summary: 'd' },
            plan: { summary: 'p' },
            // withExecuteEvidence：模拟首趟串行消化已 record 过 execute（证据跨重入累积——
            // 真实链路 evidence 不清零；无标记 = 尚未进入过 execute 的干净态）
            ...(withExecuteEvidence ? { execute: { summary: 'serial pass recorded' } } : {}),
            ...(completedExtra.includes('subagent-execute') ? { 'subagent-execute': { summary: 'delegated' } } : {}),
          },
          verifyFailures: 0,
          executionMode: 'subagent',
          directOverride: false,
        });
        return runState(['next'], dir, env);
      };
      // ① 全串行（含依赖链）→ execute
      let res = goNext(TASK_VALID_ALL_SERIAL, 'execute');
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // ② 并→串（并存前+串在后）首趟 → subagent-execute（与旧引擎第一趟一致）
      res = goNext(TASK_VALID_PS, 'execute');
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // ③ 并→串委托完成后（并行全 done、无新 eligible）→ execute 消化串行（与旧引擎一致；
      // execute 已 record 过——证据累积，严格顺序校验放行）
      res = goNext(
        '<task id="P01" status="done" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
        '<task id="P02" status="done" parallel="true"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n' +
        '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify><depends_on>P01,P02</depends_on></task>\n',
        'execute', ['subagent-execute'], true);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // ④ 串→并（串在前+并在后）首趟 → execute 先串行（与旧引擎一致）
      res = goNext(TASK_VALID_SP, 'execute');
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
    },
  },

  // 176: 伪并行检测（多趟混排合法化后的语义盲区兜底）——并行任务 write_files 仅声明测试产物
  // 而无任何生产代码文件时，plan 出口输出 WARN（列任务 id 并给出 depends_on/垂直切片建议）
  // 且不阻断——渐进提示语义本身即断言点；write_files 混有生产文件的并行任务不触发。
  {
    name: '176 伪并行 WARN：仅写测试产物的并行任务提示依赖嫌疑且不阻断',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'plan',
        completedNodes: ['open', 'design'],
        evidence: { open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      // 正例：纯测试面并行任务 → WARN 列 id 并建议 depends_on；plan 出口仍通过
      let res = runPlanExit(dir,
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>tests/test_p1.mjs</write_files><verify>node --check tests/test_p1.mjs</verify></task>\n');
      assertExit(res, 0);
      assertOut(res, 'WARN: 伪并行检测');
      assertOut(res, 'P01');
      assertOut(res, 'depends_on');
      // 反例：write_files 混有生产文件 → 不触发
      res = runPlanExit(dir,
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs\ntests/test_p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n');
      assertExit(res, 0);
      assertNotOut(res, '伪并行检测');
    },
  },

  // 177: hook 项目根判定兜底链（级3 实测暴露的 H5 残留缺口收口）——会话 cwd 漂移后：
  // ① 有 CLAUDE_PROJECT_DIR（CC hook env 注入）→ 越界写 BLOCKED / .specs 写放行；
  // ② 无任何 env → 自 cwd 向上锚定最近含 .comet/flow-comet-state.json 的祖先，同样正确判定。
  // 修复前两种漂移形态下协议读取失败 → exit 1 报错式放行（越界写有痕放过）。
  {
    name: '177 hook 根判定兜底：cwd 漂移经变量/祖先锚定后正确拦截（H5 收口）',
    run: (dir) => {
      // running 态（review 节点白名单 .specs/）
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        status: 'running',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        evidence: {}, verifyFailures: 0, executionMode: 'subagent', directOverride: false,
      });
      fs.mkdirSync(path.join(dir, 'deep'), { recursive: true });
      const spawnDrift = (input, extraEnv) => {
        const res = spawnSync(process.execPath, [HOOK, 'before_tool'], {
          cwd: path.join(dir, 'deep'),
          input: JSON.stringify(input),
          env: {
            ...process.env,
            FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json'),
            ...extraEnv,
          },
          encoding: 'utf8', timeout: 60000,
        });
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      const evil = path.join(dir, 'evil', 'x.txt').split(path.sep).join('/');
      const inspec = path.join(dir, '.specs', 'ok.txt').split(path.sep).join('/');
      // ① CLAUDE_PROJECT_DIR 锚定
      let r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: evil } }, { CLAUDE_PROJECT_DIR: dir });
      assertExit(r, 2);
      assertOut(r, 'BLOCKED');
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: inspec } }, { CLAUDE_PROJECT_DIR: dir });
      assertExit(r, 0);
      assertOut(r, 'workflow-hook-guard-ok');
      // ② 无 env → 祖先锚定（dir 含 .comet/state.json）
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: evil } }, {});
      assertExit(r, 2);
      assertOut(r, 'BLOCKED');
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: inspec } }, {});
      assertExit(r, 0);
      assertOut(r, 'workflow-hook-guard-ok');
    },
  },

  // ---------- 场景族（多趟出口与解析硬化 · AC-1~AC-7）：期望先行 TDD——部分场景对未修复引擎
  // RED 属预期中间态（GREEN 随引擎修复落地后于收口前全量确认）；BLOCKED 文案断言与设计决策
  // 的提示句逐字对齐；既有场景不受本族影响（编号连续接续）。

  // 178: S 开局混排拓扑 execute 首趟出口放行——T01[S] 已委托交付标 done、T02/T03[P] dep T01
  // pending（待下一趟委托）、T04[S] dep T02,T03 pending（依赖未满足）。串行 pending 判定收窄为
  // 「可运行串行」后，依赖未满足的中段串行 = 等后续波次的合法中间态 → 放行，多趟路由零干预续驱；
  // 未修复引擎按「全部 pending 串行」无条件拦截 → 对未修复引擎 RED。
  {
    name: '178 execute 出口放行：S 开局混排拓扑中段串行依赖未满足不再拦',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" parallel="false" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
        '<task id="T02" parallel="true" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T03" parallel="true" status="pending"><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T04" parallel="false" status="pending"><action>实现 T04</action><write_files>src/t4.mjs</write_files><verify>node --check src/t4.mjs</verify><depends_on>T02,T03</depends_on></task>\n');
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 179: 可运行串行仍拦（保守边界不松动的负例锚）——同拓扑但 T04 depends_on 为空：
  // 依赖已满足、既未委托也未标 done 的串行 pending = 规划错误信号 → BLOCKED 且消息指明该任务 id。
  // 拦截语义与 id 明细既有引擎已具备 → 即刻绿锚，钉住判定收窄不弱化此向。
  {
    name: '179 execute 出口仍拦：可运行串行 pending BLOCKED 且消息含任务 id',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" parallel="false" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
        '<task id="T02" parallel="true" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T03" parallel="true" status="pending"><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T04" parallel="false" status="pending"><action>实现 T04</action><write_files>src/t4.mjs</write_files><verify>node --check src/t4.mjs</verify></task>\n');
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '串行 pending');
      assertOut(res, 'T04');
    },
  },

  // 180: 委托边界单行分号 write_files 自动解析正例——request 不带 --write-files 走 TASK.md
  // 自动解析，`a; b` 单行分号形态须切分为两条路径（与换行形态等价）；随后 result 回传恰好触碰
  // 这两个文件的提交，提交文件子集校验通过、不出现「超出 writeFiles 范围」误拦。
  {
    name: '180 handoff 分号单行 write_files 自动解析等价换行且 result 子集校验通过',
    run: (dir) => {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      writeFile(dir, 'src/todo_x.py', '# impl\n');
      writeFile(dir, 'tests/test_todo_x.py', '# test\n');
      // 只加任务切片文件——运行器预置的 reference/ 协议副本不属于本任务提交面
      git('add', 'src/todo_x.py');
      git('add', 'tests/test_todo_x.py');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'vertical slice');
      const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01"><action>实现 T01</action><write_files>src/todo_x.py; tests/test_todo_x.py</write_files><verify>node --check src/todo_x.py</verify></task>\n');
      const st = baseState('subagent-execute');
      st.newChange = true;
      writeState(dir, st);
      // 技能加载前置门材料：新 change 下 request 须有本节点声明标记
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/subagent-execute-flow-comet-dev.json',
        JSON.stringify({ node: 'subagent-execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resReq = runHandoff(['request', 'T01', 'delegate todo slice'], dir);
      assertExit(resReq, 0);
      assertOut(resReq, 'HANDOFF REQUEST: T01');
      // 自动解析结果与换行形态等价：单行分号切分为两条独立路径入库
      const stAfter = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      const parsedFiles = stAfter.evidence['subagent-execute'].handoffRequests.T01.writeFiles;
      if (!Array.isArray(parsedFiles) || parsedFiles.length !== 2
        || !parsedFiles.includes('src/todo_x.py') || !parsedFiles.includes('tests/test_todo_x.py')) {
        throw new Error('request 自动解析未把单行分号 write_files 切分为两条路径: ' + JSON.stringify(parsedFiles));
      }
      const payload = JSON.stringify({
        status: 'DONE', taskId: 'T01', commitHash: hash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/todo_x.py', output: 'ok' },
        redEvidence: { command: 'node --check tests/test_todo_x.py', output: 'ok' },
      });
      const resResult = runHandoff(['result', 'T01', payload], dir);
      assertExit(resResult, 0);
      assertOut(resResult, 'HANDOFF RESULT: T01');
      assertNotOut(resResult, '超出 writeFiles 范围');
    },
  },

  // 181: 伪并行启发式分号容错（一景双断言）——① 并行任务 write_files 为单行分号垂直切片
  // （生产文件; 测试文件）：未修复引擎按整行匹配测试路径模式 → 误报 WARN（RED 取证点）；
  // 修复补分号二次切分后识别出生产文件 → 不误报。② 纯测试文件并行任务（换行形态）仍输出
  // WARN 且不阻断（真报保持）。WARN 明细行以「无生产代码文件: <任务id>」前缀区分两任务归属。
  {
    name: '181 伪并行检测分号容错：单行垂直切片不误报且纯测试并行任务仍告警',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'plan',
        completedNodes: ['open', 'design'],
        evidence: { open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      const res = runPlanExit(dir,
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>todo_x.py; tests/test_todo_x.py</write_files><verify>node --check todo_x.py</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>tests/test_p2.mjs\ntests/test_p2_helper.mjs</write_files><verify>node --check tests/test_p2.mjs</verify></task>\n');
      assertExit(res, 0); // WARN 渐进不阻断
      assertOut(res, 'WARN: 伪并行检测'); // ② 纯测试并行任务真报保持
      assertOut(res, '无生产代码文件: P02');
      assertNotOut(res, '无生产代码文件: P01'); // ① 分号垂直切片不误报
    },
  },

  // 182: 收尾态 ROUTE WARN 静默——TASK 全部任务 done 后，「未找到可委托并行块」诊断失去
  // 信息量（噪音只在收尾态出现）；增加存在 pending 任务前置条件后静默。未修复引擎无条件
  // 输出 → 对未修复引擎 RED。
  {
    name: '182 execute 出口静默：全部任务 done 后无 ROUTE WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/P02-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01', 'P02']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'ROUTE WARN');
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 183: 死结类 BLOCKED 补 advance 边界提示——可运行串行拦截分支的 BLOCKED 消息含逐字句
  // 「无可执行的常规恢复动作时，可用 workflow-state.mjs advance 渡过结构性死结」（仅死结分支
  // 提示，常规缺产物/缺证据情形不适用）。文案由引擎侧任务落地——未修复消息无该句 → RED。
  {
    name: '183 死结 BLOCKED 消息含 advance 边界提示逐字句',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 +
        '<task id="T02"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>P01</depends_on></task>\n');
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '无可执行的常规恢复动作时，可用 workflow-state.mjs advance 渡过结构性死结');
    },
  },

  // 184: 技能文本混排合法化语义文本锁——plan 与 subagent-execute 两 SKILL 权威源不得再含
  // 「连续块」「居首」旧波次形态约束表述，且依赖图语义描述（depends_on）在场、「用 Skill 工具」
  // 两层加载句式保持（措辞锁族既有锚不破坏）。文本存在级断言（结构级由其余场景族覆盖）。
  {
    name: '184 技能文本锁：旧连续块/居首表述清零且依赖图语义描述在场',
    run: () => {
      const problems = [];
      for (const skillDir of ['flow-comet-plan', 'flow-comet-subagent-execute']) {
        const text = fs.readFileSync(path.join(__dirname, '..', '..', skillDir, 'SKILL.md'), 'utf8');
        if (text.includes('连续块')) problems.push(skillDir + ' 含「连续块」旧形态约束表述');
        if (text.includes('居首')) problems.push(skillDir + ' 含「居首」旧位置约束表述');
        if (!text.includes('depends_on')) problems.push(skillDir + ' 缺依赖图语义描述（depends_on）');
        if (!text.includes('用 Skill 工具')) problems.push(skillDir + ' 缺「用 Skill 工具」两层加载句式');
      }
      if (problems.length > 0) throw new Error('技能文本混排合法化语义不符: ' + problems.join('; '));
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
// ① 场景数：全清单文档（公开 10 + 非公开 6 + CLAUDE）须与 SCENARIOS.length 一致（全变体检查）；
// ② 公开产物零代号：公开文档不得含过程代号（场景编号/修复编号/批次/缺陷编号/问题级/验证代号/验证轮次/未公开概念——历史 CHANGELOG 回归实证）。
// 仅权威源仓库（含 .comet/bundle-drafts 锚点）执行；安装副本（目标项目）无 flow-comet 文档，跳过。
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const isAuthoritativeSource = fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'));
if (isAuthoritativeSource) {
  // ① 场景数全清单（公开双语 + 非公开文档 + CLAUDE + PR 模板；全变体：ALL n SCENARIOS / n scenarios / n 场景 / n/n）
  // SCENARIO_COUNT_FILES 为模块级常量（场景数自检与底部自检共用同一清单，见文件头定义）
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
    'SECURITY.md', 'SECURITY-zh.md', 'CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT-zh.md',
    'CHANGELOG.md', 'CHANGELOG-zh.md',
    'docs/INSTALLATION.md', 'docs/INSTALLATION-zh.md', 'docs/MECHANISM.md', 'docs/MECHANISM-zh.md',
    'docs/USAGE.md', 'docs/USAGE-zh.md', 'docs/PROTOCOL.md', 'docs/PROTOCOL-zh.md',
    'docs/TROUBLESHOOTING.md', 'docs/TROUBLESHOOTING-zh.md', 'docs/VERSIONS.md', 'docs/VERSIONS-zh.md',
    'docs/ECOSYSTEM.md', 'docs/ECOSYSTEM-zh.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/1-bug_report.yml', '.github/ISSUE_TEMPLATE/2-feature_request.yml',
    '.github/ISSUE_TEMPLATE/3-question.md', '.github/ISSUE_TEMPLATE/4-task.md',
  ];
  // 与 .githooks/internal-codes.mjs 的 BANNED 保持同步（单一来源约定；本文件随 bundle
  // 分发，不能 import 主仓私有 .githooks——改动词表时两份同改，行为必须一致）
  const INTERNAL_CODE_RE = /\bS\d{1,3}\b|T-FIX|batch-(?![a-z])|D-\d+|P[0-7]\b|round\s*\d|dogfood|内部/;
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
