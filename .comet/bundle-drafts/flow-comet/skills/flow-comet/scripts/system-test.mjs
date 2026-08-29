#!/usr/bin/env node
// system-test.mjs — flow-comet 系统测试集（与 guard-self-test 同构的载体，测试内容为系统级全链路）
//
// 定位：guard-self-test 是引擎脚本的单元/场景级回归（216，fixture 构造为主）；
// 本套件是**系统级**测试——每个测试项走真实命令序列（init → record → guard exit → handoff →
// hook …），覆盖 flow-comet 全部机制面（A~L 十二类）：
//   A. 状态机与路由（init/status/next/select/advance/record/execution-mode/config/
//      多趟真实链路：串并交替 NODE 行多次交替 + plan 出口依赖环负例与恢复指引）
//   B. 声明机制（skill-load 标记/record 校验/时间序/损坏 fail-closed/委托范围豁免/exit 协议标记/旧兼容）
//   C. 委托链路（handoff request/result/status、RED 先于 GREEN、Return Contract、证据键名契约）
//   D. hook 写白名单（open 阶段/execute 动态收窄/direct 放宽/归档阶段）
//   E. 自定义协议（--protocol/env 加载、自定义节点声明机制与出口、内置特化校验不误触发）
//   F. 自动初始化（缺失提示/跳过记忆/新鲜静默/生成协作全链路）
//   G. 分支模式（init 建分支/归档入口分支校验/一致性失配警告）
//   H. verify 与归档（验证命令真实执行 + 超时配置/完整归档流程/归档路径声明标记查找）
//   I. 异常路径（损坏状态/缺工件出口/非法参数/状态字段类型非法）
//   J. 文档一致性（双语健康检查/公开产物零代号检查——调用仓库本地工具）
//   K. 安装器与平台（版本标识/多平台安装与平台化路径/codex hook JSON 契约/平台选择链/
//      purge 语义/描述符驱动/dsh 平台断言/loader 版本戳重装断言/hook 注入形态无关断言与旧条目幂等升级）
//   L. 执行遗漏防护（entry 进入证据/空退出豁免/空仓库提示）
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
import { fileURLToPath, pathToFileURL } from 'url';

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
  writeFile(root, '.specs/' + changeId + '/CHANGE.md', '# CHANGE\n\n- **Change ID**: ' + changeId + '\n\n## Why（为什么做）\n\n变更目标。\n');
  writeFile(root, '.specs/' + changeId + '/REQUIREMENT.md', '# REQUIREMENT\n\n- **Change ID**: ' + changeId + '\n\n## 用户故事（User Story）\n\n用户需求。\n\n## 验收准则（AC）\n\n- 通过标准\n');
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
// 递归收集目录下相对文件清单（排序稳定，供 K8/K10 技能整树清单/内容比对）
function collectTreeFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute));
    }
  })(root);
  return files.sort();
}

// ---------- 桥接 loader 版本戳重装断言助手（临时 DSH_HOME 重装链路） ----------

// 从权威源 loader 提取版本戳（与安装器/检查器同一锚点标记行；动态取值，版本演进零维护）
function readBridgeSourceVersion(loader) {
  const text = fs.readFileSync(loader, 'utf8');
  const m = /^\/\/ BRIDGE_VERSION: (\S+)$/m.exec(text);
  if (!m) throw new Error('权威源 loader 缺版本戳标记行（契约锚点）: ' + loader);
  return m[1];
}

// 构造指定版本戳的 loader 副本内容（仅替换标记行，其余逐字保持——MISS 检测：替换未命中即报错）
function stampBridgeLoader(sourceLoader, version) {
  const text = fs.readFileSync(sourceLoader, 'utf8');
  const replaced = text.replace(/^\/\/ BRIDGE_VERSION: \S+$/m, '// BRIDGE_VERSION: ' + version);
  if (!replaced.includes('// BRIDGE_VERSION: ' + version)) {
    throw new Error('版本戳替换未命中（MISS）: 目标版本 ' + version);
  }
  return replaced;
}

// 预置目标项目 flow-kit/ 为同名非上游目录（安装器走「非上游克隆，已跳过」路径——
// 网络零接触；与安装器冒烟同手法）
function seedForeignFlowKit(root) {
  const flowKitDir = path.join(root, 'flow-kit');
  fs.mkdirSync(flowKitDir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: flowKitDir, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/not-flow-kit.git'], { cwd: flowKitDir, stdio: 'ignore' });
}

// ---------- hook 注入命令形态判定（托管条目断言放宽决策：断言意图 = 托管条目在场且指向本项目脚本） ----------
// 托管识别 = 脚本 basename(comet-hook-guard.mjs) 在位——与 prepare-env isManagedHookCommand
// 同源语义，新旧托管形态均命中（幂等升级识别面）。
// 项目根引用特征 = CLAUDE_PROJECT_DIR 变量引用（%VAR%/$env:/$_ENV/${VAR} 词形）或绝对路径特征
// （盘符 / 引号·空白·等号后的 POSIX 绝对段）二选一在位——cwd 漂移免疫的形态面；相对路径旧形态
// 两者皆无 → 不达标（升级替换判据）。断言不锁定具体引号/变量写法（形态无关化，以特征断言补偿
// 精度——注入命令实测微调不再破坏套件）。
function isManagedHookCommand(cmd) {
  return typeof cmd === 'string' && cmd.includes('comet-hook-guard.mjs');
}

function hasProjectRootRef(cmd) {
  if (typeof cmd !== 'string') return false;
  if (/CLAUDE_PROJECT_DIR/i.test(cmd)) return true;
  return /[A-Za-z]:[\\/]/.test(cmd) || /["'\s=]\/[^\s"']/.test(cmd);
}

function assertManagedHookEntry(cmd, label) {
  if (!isManagedHookCommand(cmd)) {
    throw new Error(label + ' 缺托管脚本 basename(comet-hook-guard.mjs): ' + String(cmd));
  }
  if (!hasProjectRootRef(cmd)) {
    throw new Error(label + ' 缺项目根引用特征(CLAUDE_PROJECT_DIR 或绝对路径二选一在位;相对路径旧形态不具备 cwd 漂移免疫): ' + String(cmd));
  }
}

// 从 settings.local.json / hooks.json 结构提取全部托管 hook 命令(hooks.PreToolUse[].hooks[].command)
function collectManagedHookCommands(configObj) {
  const cmds = [];
  const groups = configObj && configObj.hooks && Array.isArray(configObj.hooks.PreToolUse) ? configObj.hooks.PreToolUse : [];
  for (const g of groups) {
    for (const h of (Array.isArray(g && g.hooks) ? g.hooks : [])) {
      if (isManagedHookCommand(h && h.command)) cmds.push(h.command);
    }
  }
  return cmds;
}

// 多趟链路 SUMMARY 夹具（SUMMARY 模板保真全量满足：标题首行 # SUMMARY: + 首部 4 字段 +
// 段序 做了什么→改动文件→verify 输出→6 维自查→越界检查→自检方法；6 维声明 brooks-review）
function execSummaryFixture(taskId) {
  return [
    '# SUMMARY: ' + taskId + ' - 多趟链路任务',
    '',
    '- **Change ID**: ' + CHANGE_ID,
    '- **Task ID**: ' + taskId,
    '- **完成时间**: 2026-08-25 10:00',
    '- **AI 角色**: Dev',
    '',
    '## 做了什么',
    '',
    '完成 ' + taskId + ' 的实现并回传证据。',
    '',
    '## 改动文件',
    '',
    '| 文件 | 性质 | 说明 |',
    '|---|---|---|',
    '| src/' + taskId.toLowerCase() + '.mjs | 修改 | 实现任务 |',
    '',
    '## verify 输出',
    '',
    '```text',
    '$ node --check src/' + taskId.toLowerCase() + '.mjs',
    'ok',
    '```',
    '',
    '## 6 维自查',
    '',
    '- 功能: 通过（brooks-review 已跑）',
    '- 性能: 无影响',
    '- 安全: 无影响',
    '- 兼容: 通过',
    '- 可观测: 通过',
    '- 可维护: 通过',
    '',
    '## 越界检查',
    '',
    '仅修改 write_files 范围内文件，无越界。',
    '',
    '## 自检方法',
    '',
    'brooks-review',
    '',
  ].join('\n');
}

// 混排多波 TASK：双并行开路 → 串行衔接(依赖双并行)→ 收尾并行(依赖串行衔接)。
// 各任务 status 由入参映射（任务 id → 'pending'|'done'）控制；status 变更不影响任务集签名
// （签名仅保留 id/parallel 与块内容，剥离 status 类属性）。串行衔接置于两并行波之间——
// 引擎契约下 execute 出口要求全部串行已消化，跨趟多次交替由「并行波→串行波→并行波」承载。
function multiWaveTaskContent(statusMap) {
  const blk = (id, parallel, deps) =>
    '<task id="' + id + '"' + (parallel ? ' parallel="true"' : '') + (statusMap[id] === 'done' ? ' status="done"' : ' status="pending"') + '>' +
    '<action>实现 ' + id + '</action>' +
    '<write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
    '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
    (deps ? '<depends_on>' + deps + '</depends_on>' : '') +
    '</task>\n';
  return '# TASK\n\n' +
    blk('P01', true, '') +
    blk('P02', true, '') +
    blk('S01', false, 'P01,P02') +
    blk('P03', true, 'S01');
}

// 真实链路前奏（多趟/依赖环用例共用）：init → open 出口 → design 出口。
// 新 change 两层加载模型下逐节点 skill-load → record → entry → exit --apply 全程驱动。
function driveThroughDesign(dir) {
  assertExit(runState(['init', CHANGE_ID], dir), 0);
  assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
  writeIntakeArtifacts(dir);
  assertExit(runState(['record', 'open', '{"summary":"intake complete"}'], dir), 0);
  assertExit(runGuard(['entry', 'open'], dir), 0);
  assertExit(runGuard(['exit', 'open', '--apply'], dir), 0);
  assertExit(runState(['skill-load', 'design', 'flow-comet-design', '--prompt', 'flow-kit/prompts/2-design.md'], dir), 0);
  writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md',
    '# DESIGN\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 0. 技术栈选定\n\nNode.js(ESM)\n\n## 决策清单\n\n- [ ] 循环路由\n');
  assertExit(runState(['record', 'design', '{"summary":"design done"}'], dir), 0);
  assertExit(runGuard(['entry', 'design'], dir), 0);
  assertExit(runGuard(['exit', 'design', '--apply'], dir), 0);
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
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
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
      assertExit(runState(['skill-load', 'open', 'flow-comet-change'], dir), 0);
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
      // --json-file 符号链接越界(realpath 校验):链接到项目根外的符号链接 → 拒绝。
      // 平台限制:Windows 创建符号链接需开发者模式/管理员——创建失败时显式跳过并说明,
      // 不静默(POSIX/CI 真实覆盖该负例)
      const outsideTarget = path.join(dir, '..', 'outside-symlink-target.json');
      fs.writeFileSync(outsideTarget, '{"summary":"outside"}', 'utf8');
      const symlinkPath = path.join(dir, 'payload-link.json');
      // 仅 symlink 创建包在 try 内——断言移出 catch,防断言失败被误报为平台跳过
      // (修复前 try 包住 runState/断言,真实回归会被吞为"平台不支持跳过")
      let symlinkCreated = false;
      try {
        fs.symlinkSync(outsideTarget, symlinkPath);
        symlinkCreated = true;
      } catch (e) {
        console.log('  (symlink 负例跳过——当前平台不支持创建符号链接: ' + e.code + ')');
      }
      if (symlinkCreated) {
        const rfSym = runState(['record', 'open', '--json-file', 'payload-link.json'], dir);
        assertExit(rfSym, 1);
        assertOut(rfSym, '符号链接');
      }
      // 缺 node 参数 → 拒绝
      const noNode = runState(['record'], dir);
      assertExit(noNode, 1);
      assertOut(noNode, 'record requires a Node id.');
      // --json-file 缺值(最后一个参数)→ 用法错误而非类型错误(修复前 path.resolve
      // 对 undefined 抛 TypeError——报类型错误而非用法错误,此处应 RED)
      const missingVal = runState(['record', 'open', '--json-file'], dir);
      assertExit(missingVal, 1);
      assertOut(missingVal, '--json-file requires a path argument');
      if (missingVal.output.includes('ERR_INVALID_ARG_TYPE')) {
        throw new Error('--json-file 缺值不应报类型错误');
      }
      // --json-file 空串(--json-file= 形式)→ 同样用法错误(修复前解析为项目根报 EISDIR)
      const emptyVal = runState(['record', 'open', '--json-file='], dir);
      assertExit(emptyVal, 1);
      assertOut(emptyVal, '--json-file requires a path argument');
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

  {
    name: 'A13 多趟路由真实链路:并→串→并交替与多波依赖,NODE 行在 execute/subagent-execute 间多次交替直至全部 done',
    run: (dir) => {
      driveThroughDesign(dir);
      // 混排 TASK:双并行开路 → 串行衔接(依赖双并行)→ 收尾并行(依赖串行衔接)——依赖驱动的
      // 分趟序列:并行趟 → 串行趟 → 并行趟 → review 门控(多趟正向行为)。
      // 驱动遵循真实协调者流程:execute 趟内先消化其全部串行 pending(标 done 并委托留证)再 exit;
      // 委托趟内委派全部可并行后才能退(每趟合取完成判定)。
      // 对未实现循环路由的引擎本用例 RED 属预期(单趟限制下委托节点完成后不再路由回)。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        multiWaveTaskContent({ P01: 'pending', P02: 'pending', S01: 'pending', P03: 'pending' }));
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md'], dir), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan done"}'], dir), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const rPlan = runGuard(['exit', 'plan', '--apply'], dir);
      assertExit(rPlan, 0);
      assertOut(rPlan, 'ALL CHECKS PASSED');
      // 首趟路由:首波双并行无前置依赖 → 直接进入委托节点
      assertOut(rPlan, 'NODE: subagent-execute');
      // 两层加载模型:执行域两节点的手动声明标记(record 前置门;一次声明后续趟次复用)
      assertExit(runState(['skill-load', 'execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir), 0);
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir), 0);

      // 单趟完成动作:TASK.md 标 done(status 变更不影响任务集签名)+ SUMMARY 夹具 + 真实 handoff 委托回传
      const completeTasks = (ids) => {
        for (const id of ids) {
          writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', execSummaryFixture(id));
          assertExit(runHandoff(['request', id, id + ' 委托', '--write-files', 'src/' + id.toLowerCase() + '.mjs'], dir), 0);
          assertExit(runHandoff(['result', id, fullContract('abcd1234abcd1234abcd1234abcd1234abcd1234', id)], dir), 0);
        }
      };
      const markDone = (statusMap) => writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', multiWaveTaskContent(statusMap));
      // 单趟驱动:record → entry → exit --apply,断言 NODE 行路由到期望节点(可观测性不变式)
      const drivePass = (node, expectNext, label) => {
        assertExit(runState(['record', node, '{"summary":"' + label + '"}'], dir), 0);
        assertExit(runGuard(['entry', node], dir), 0);
        const res = runGuard(['exit', node, '--apply'], dir);
        assertExit(res, 0);
        assertOut(res, 'ALL CHECKS PASSED');
        const m = res.output.match(/^NODE: ([a-z-]+)\s*$/m);
        if (!m) throw new Error('exit ' + node + '(' + label + ')输出缺 NODE 行:\n' + res.output);
        if (m[1] !== expectNext) {
          throw new Error(label + ' 后路由期望 NODE: ' + expectNext + ',实际 NODE: ' + m[1] +
            '(多趟循环路由未生效——委托节点应可重入直至无剩余可并行)\n实际输出:\n' + res.output);
        }
      };

      // 趟 1 · subagent-execute:首波双并行委托完成 → 趟间回串行(串行衔接依赖此时已满足)
      markDone({ P01: 'done', P02: 'done', S01: 'pending', P03: 'pending' });
      completeTasks(['P01', 'P02']);
      drivePass('subagent-execute', 'execute', 'parallel-wave-1');

      // 趟 2 · execute:先消化本趟全部串行 pending(串行衔接,标 done 并委托留证)——
      // 确认无串行残留后才 exit → 收尾并行依赖满足 → 再次进入委托节点
      // (旧引擎单趟限制下此处不再路由回——本断言即多趟语义回归锚)
      markDone({ P01: 'done', P02: 'done', S01: 'done', P03: 'pending' });
      completeTasks(['S01']);
      drivePass('execute', 'subagent-execute', 'serial-wave-1');

      // 趟 3 · subagent-execute:收尾并行委托完成 → 全部 done → 出口照常门控进 review(循环终止语义不变)
      markDone({ P01: 'done', P02: 'done', S01: 'done', P03: 'done' });
      completeTasks(['P03']);
      drivePass('subagent-execute', 'review', 'parallel-wave-2');

      const st = readStateFile(dir);
      if (st.currentNode !== 'review') {
        throw new Error('全部任务 done 后应停在 review 门控前: ' + JSON.stringify(st.currentNode));
      }
      console.log('  多趟路由:subagent-execute→execute→subagent-execute→review 三趟两交替 ✓');
    },
  },

  {
    name: 'A14 plan 出口依赖环负例:BLOCK 含 depends_on 恢复指引,按指引调环后恢复通过',
    run: (dir) => {
      driveThroughDesign(dir);
      // 负例:X1↔X2 互相依赖成环(结构死锁——任何一趟都无法开工)→ plan 出口前置拦截。
      // 校验语义:依赖图无环 + 趟次可满足;BLOCK 消息附 depends_on 调整恢复指引(恢复类断言面)。
      const cyclic =
        '<task id="C1" status="pending"><action>实现 C1</action><write_files>src/c1.mjs</write_files><verify>node --check src/c1.mjs</verify></task>\n' +
        '<task id="X1" parallel="true" status="pending"><action>实现 X1</action><write_files>src/x1.mjs</write_files><verify>node --check src/x1.mjs</verify><depends_on>X2</depends_on></task>\n' +
        '<task id="X2" parallel="true" status="pending"><action>实现 X2</action><write_files>src/x2.mjs</write_files><verify>node --check src/x2.mjs</verify><depends_on>X1</depends_on></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + cyclic);
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md'], dir), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan drafted"}'], dir), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const blocked = runGuard(['exit', 'plan', '--apply'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      // 恢复指引关键词:指明调整 depends_on(而非笼统报错)
      assertOut(blocked, 'depends_on');
      if (!/(环|循环|cycle|拓扑|topolog)/i.test(blocked.output)) {
        throw new Error('plan 出口 BLOCK 应含依赖环/拓扑校验语义关键词(环/循环/cycle/拓扑):\n' + blocked.output);
      }
      // 恢复类:按指引调整 depends_on(X1/X2 改依赖 C1)消环 → 同一出口重跑通过
      const recovered =
        '<task id="C1" status="pending"><action>实现 C1</action><write_files>src/c1.mjs</write_files><verify>node --check src/c1.mjs</verify></task>\n' +
        '<task id="X1" parallel="true" status="pending"><action>实现 X1</action><write_files>src/x1.mjs</write_files><verify>node --check src/x1.mjs</verify><depends_on>C1</depends_on></task>\n' +
        '<task id="X2" parallel="true" status="pending"><action>实现 X2</action><write_files>src/x2.mjs</write_files><verify>node --check src/x2.mjs</verify><depends_on>C1</depends_on></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + recovered);
      const ok = runGuard(['exit', 'plan', '--apply'], dir);
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
      // 恢复后路由:并行依赖未满足(C1 仍 pending)→ execute 开工
      assertOut(ok, 'NODE: execute');
    },
  },

  {
    // 路由时序收敛（真实命令链路）：多趟拓扑（并行开路 → 串行衔接 → 并行收尾 → 串行收尾）逐节点
    // guard exit --apply 后运行 workflow-state next——断言两侧 NODE 逐节点一致（修复前 guard 出口
    // 镜像缺「串行 pending → execute」回流，并行收尾后直接落到 review，与权威 next 偏差）。
    name: 'A15 多趟路由时序收敛：逐节点 exit --apply 后 next NODE 与 guard 出口 NODE 一致',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap) => {
        const blk = (id, parallel, deps) =>
          '<task id="' + id + '"' + (parallel ? ' parallel="true"' : '') +
          ' status="' + (statusMap[id] === 'done' ? 'done' : 'pending') + '">' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
          (deps ? '<depends_on>' + deps + '</depends_on>' : '') + '</task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
          blk('P01', true, '') + blk('P02', true, '') +
          blk('S01', false, 'P01,P02') +
          blk('P03', true, 'S01') + blk('P04', true, 'S01') +
          blk('S02', false, 'P03,P04'));
      };
      const runNext = () => runState(['next'], dir, env);
      const nodeOf = (out) => (out.match(/^NODE: ([a-z-]+)$/m) || [])[1] ?? null;
      const completeTasks = (ids) => {
        for (const id of ids) {
          writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', execSummaryFixture(id));
          assertExit(runHandoff(['request', id, id + ' 委托', '--write-files', 'src/' + id.toLowerCase() + '.mjs'], dir), 0);
          assertExit(runHandoff(['result', id, fullContract('abcd1234abcd1234abcd1234abcd1234abcd1234', id)], dir), 0);
        }
      };
      // drive 收敛面参数化：委托跳转/趟间回串行态（guard 出口 NODE 与 next 可确认面不一致——
      // next 对「currentNode 无 evidence 且非固定路由后继」的委托跳转态按正常推进豁免不放行，
      // 仅断言 guard 侧 NODE；直接后继/回流态（next 可确认）才做双侧收敛断言。
      const drive = (nodeId, skill, prompt, prepare, { expectedNode, converge = true } = {}) => {
        assertExit(runState(['skill-load', nodeId, skill, '--prompt', prompt], dir, env), 0);
        prepare();
        assertExit(runGuard(['entry', nodeId], dir), 0);
        const res = runGuard(['exit', nodeId, '--apply'], dir);
        assertExit(res, 0);
        const n1 = nodeOf(res.output);
        if (expectedNode && n1 !== expectedNode) {
          throw new Error('节点 ' + nodeId + ' 出口后 guard NODE(' + n1 + ') != 期望(' + expectedNode +
            ')\nguard:\n' + res.output);
        }
        if (!converge) return;
        const nxt = runNext();
        assertExit(nxt, 0);
        const n2 = nodeOf(nxt.output);
        if (n1 !== n2) {
          throw new Error('节点 ' + nodeId + ' 出口后 guard NODE(' + n1 + ') != next NODE(' + n2 +
            ')\nguard:\n' + res.output + '\nnext:\n' + nxt.output);
        }
      };
      const writeSummary = (ids) => { for (const id of ids) writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', execSummaryFixture(id)); };
      driveThroughDesign(dir);
      // 预置多趟 TASK 并推进到 review 门控前（逐节点收敛断言）
      writeTask({ P01: 'pending', P02: 'pending', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
      drive('plan', 'flow-comet-plan', 'flow-kit/prompts/3-task.md', () => assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0),
        { expectedNode: 'subagent-execute', converge: false });
      drive('subagent-execute', 'flow-comet-subagent-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
        writeSummary(['P01', 'P02']);
        completeTasks(['P01', 'P02']);
        // 委托收集后按真实链路 record 节点总结（浅合并保留 handoffResult）——guard exit
        // 的 schema evidence 前置需要非空 summary（缺则 BLOCK，与场景级委托出口同形态）。
        assertExit(runState(['record', 'subagent-execute', '{"summary":"wave 1 delegated and collected"}'], dir, env), 0);
      }, { expectedNode: 'execute', converge: false });
      drive('execute', 'flow-comet-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'pending', P04: 'pending', S02: 'pending' });
        writeSummary(['S01']);
        completeTasks(['S01']);
        // execute 节点自身证据（guard exit 校验节点 evidence 须有记录）——真实链路中
        // 串行任务完成后协调者 record execute 节点总结。
        assertExit(runState(['record', 'execute', '{"summary":"serial wave complete"}'], dir, env), 0);
      }, { expectedNode: 'subagent-execute', converge: true });
      drive('subagent-execute', 'flow-comet-subagent-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'pending' });
        writeSummary(['P03', 'P04']);
        completeTasks(['P03', 'P04']);
        assertExit(runState(['record', 'subagent-execute', '{"summary":"wave 2 delegated and collected"}'], dir, env), 0);
      }, { expectedNode: 'execute', converge: true });
      drive('execute', 'flow-comet-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'done' });
        writeSummary(['S02']);
        completeTasks(['S02']);
        assertExit(runState(['record', 'execute', '{"summary":"final serial wave complete"}'], dir, env), 0);
      }, { expectedNode: 'review', converge: true });
      drive('review', 'flow-comet-review', 'flow-kit/prompts/6-review.md', () => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
          '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nreview passed，无遗留问题。\n');
        assertExit(runState(['record', 'review', '{"summary":"review complete"}'], dir, env), 0);
      }, { expectedNode: 'verify', converge: true });
      drive('verify', 'flow-comet-verify', 'flow-kit/prompts/7-integration.md', () => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```\necho ok\n```\n');
        writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
        assertExit(runState(['record', 'verify', '{"summary":"verify complete"}'], dir, env), 0);
      }, { expectedNode: 'archive', converge: true });
      // 归档出口：两侧均 NEXT: done
      assertExit(runState(['skill-load', 'archive', 'flow-comet-archive', '--prompt', 'flow-kit/prompts/7-integration.md'], dir, env), 0);
      writeFile(dir, '.specs/archive/2026-08-28-' + CHANGE_ID + '/KNOWN-ISSUES.md', '# 遗留问题\n\n无。\n');
      assertExit(runState(['record', 'archive', '{"summary":"archive complete"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'archive'], dir), 0);
      const res = runGuard(['exit', 'archive', '--apply'], dir);
      assertExit(res, 0);
      assertOut(res, 'NEXT: done');
      const nxt = runNext();
      assertExit(nxt, 0);
      assertOut(nxt, 'NEXT: done');
    },
  },

  {
    // 并行文件依赖检出（真实命令链路）：write∩write 重叠强判前移 plan 出口——同波次并行任务
    // 写同一路径（链式重命名的 .txt 事故面）→ 新 change BLOCKED（含重叠路径与 depends_on
    // 恢复指引）；按指引补显式 depends_on 后同出口恢复通过。read∩write 弱判：无显式关联并行对
    // 一方读取对方写路径 → WARN 提示不 BLOCK（渐进）。修复前 plan 出口无此检测 = 预期 RED。
    name: 'A16 plan 出口文件依赖检出：写写重叠 BLOCK 与恢复 + 读写弱判 WARN（真实命令）',
    run: (dir) => {
      driveThroughDesign(dir);
      const planEnv = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // 非 --apply 出口（弱判/强判阶段不推进状态，避免 apply 后 currentNode 偏离 plan）
      const exitPlanNoApply = () => runGuard(['exit', 'plan'], dir, planEnv);
      const exitPlanApply = () => runGuard(['exit', 'plan', '--apply'], dir, planEnv);
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md'], dir), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan drafted"}'], dir), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const planTask = (taskBody) => writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + taskBody);
      const C1 = '<task id="C1" status="pending"><action>实现 C1</action><write_files>src/c1.mjs</write_files><verify>node --check src/c1.mjs</verify></task>\n';
      // 弱判（渐进）：无显式关联并行对 read∩write → WARN 提示不 BLOCK
      planTask(
        C1 +
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><read_files>shared-context.md</read_files><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>shared-context.md</write_files><verify>node --check shared-context.md</verify></task>\n');
      const weakRes = exitPlanNoApply();
      assertExit(weakRes, 0);
      assertOut(weakRes, 'read∩write');
      assertOut(weakRes, 'shared-context.md');
      assertNotOut(weakRes, 'BLOCKED');
      // 强判（负例）：P01/P02 同波次并行写同一 .txt 路径（无 depends_on）→ BLOCKED 含恢复指引
      planTask(
        C1 +
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n');
      const blocked = exitPlanNoApply();
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, 'bak_a.txt');
      assertOut(blocked, 'depends_on');
      // 恢复：按指引补显式 depends_on（P02 依赖 P01 → 跨趟，非同波次并行对）→ 同出口通过并推进
      planTask(
        C1 +
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>bak_b.txt</write_files><verify>node --check bak_b.txt</verify><depends_on>P01</depends_on></task>\n');
      const ok = exitPlanApply();
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
      assertNotOut(ok, 'BLOCKED');
    },
  },

  {
    // 多趟平行转换后 next 可达且与 guard 出口一致（真实命令链路）：在 A15 的收敛链路之上，
    // 把此前排除在收敛断言面外的两个平行转换点（plan→subagent-execute、subagent-execute→execute
    // 趟间回流）也纳入 next 收敛断言——修复前 next 在这些转换点被误拦为“疑似未 exit”，预期失败。
    name: 'A17 多趟平行转换后 next 可达：各转换点 next 与 guard 出口 NODE 一致（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap) => {
        const blk = (id, parallel, deps) =>
          '<task id="' + id + '"' + (parallel ? ' parallel="true"' : '') +
          ' status="' + (statusMap[id] === 'done' ? 'done' : 'pending') + '">' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
          (deps ? '<depends_on>' + deps + '</depends_on>' : '') + '</task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
          blk('P01', true, '') + blk('P02', true, '') +
          blk('S01', false, 'P01,P02') +
          blk('P03', true, 'S01') + blk('P04', true, 'S01') +
          blk('S02', false, 'P03,P04'));
      };
      const runNext = () => runState(['next'], dir, env);
      const nodeOf = (out) => (out.match(/^NODE: ([a-z-]+)$/m) || [])[1] ?? null;
      const completeTasks = (ids) => {
        for (const id of ids) {
          writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', execSummaryFixture(id));
          assertExit(runHandoff(['request', id, id + ' 委托', '--write-files', 'src/' + id.toLowerCase() + '.mjs'], dir), 0);
          assertExit(runHandoff(['result', id, fullContract('abcd1234abcd1234abcd1234abcd1234abcd1234', id)], dir), 0);
        }
      };
      // drive 收敛面全量：每个转换点（含平行跳转与趟间回流）都断言 next 可达且与 guard 出口 NODE 一致
      const drive = (nodeId, skill, prompt, prepare, { expectedNode } = {}) => {
        assertExit(runState(['skill-load', nodeId, skill, '--prompt', prompt], dir, env), 0);
        prepare();
        assertExit(runGuard(['entry', nodeId], dir), 0);
        const res = runGuard(['exit', nodeId, '--apply'], dir);
        assertExit(res, 0);
        const n1 = nodeOf(res.output);
        if (expectedNode && n1 !== expectedNode) {
          throw new Error('节点 ' + nodeId + ' 出口后 guard NODE(' + n1 + ') != 期望(' + expectedNode +
            ')\nguard:\n' + res.output);
        }
        const nxt = runNext();
        assertExit(nxt, 0);
        const n2 = nodeOf(nxt.output);
        if (n1 !== n2) {
          throw new Error('节点 ' + nodeId + ' 出口后 guard NODE(' + n1 + ') != next NODE(' + n2 +
            ')\nguard:\n' + res.output + '\nnext:\n' + nxt.output);
        }
      };
      const writeSummary = (ids) => { for (const id of ids) writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', execSummaryFixture(id)); };
      driveThroughDesign(dir);
      writeTask({ P01: 'pending', P02: 'pending', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
      // ① plan 出口 → subagent-execute（平行跳转——修复前 next 误拦）
      drive('plan', 'flow-comet-plan', 'flow-kit/prompts/3-task.md', () => assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0),
        { expectedNode: 'subagent-execute' });
      // ② 首波并行委托完成 → 趟间回串行 execute（平行回流——修复前 next 误拦）
      drive('subagent-execute', 'flow-comet-subagent-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
        writeSummary(['P01', 'P02']);
        completeTasks(['P01', 'P02']);
        assertExit(runState(['record', 'subagent-execute', '{"summary":"wave 1 delegated and collected"}'], dir, env), 0);
      }, { expectedNode: 'execute' });
      // ③ 串行衔接完成 → 第二波并行可委托
      drive('execute', 'flow-comet-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'pending', P04: 'pending', S02: 'pending' });
        writeSummary(['S01']);
        completeTasks(['S01']);
        assertExit(runState(['record', 'execute', '{"summary":"serial wave complete"}'], dir, env), 0);
      }, { expectedNode: 'subagent-execute' });
      // ④ 第二波并行委托完成 → 收尾串行回流 execute
      drive('subagent-execute', 'flow-comet-subagent-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'pending' });
        writeSummary(['P03', 'P04']);
        completeTasks(['P03', 'P04']);
        assertExit(runState(['record', 'subagent-execute', '{"summary":"wave 2 delegated and collected"}'], dir, env), 0);
      }, { expectedNode: 'execute' });
      // ⑤ 收尾串行完成 → review（后随 review→verify→archive 同 A15 形态）
      drive('execute', 'flow-comet-execute', 'flow-kit/prompts/4-dev.md', () => {
        writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'done' });
        writeSummary(['S02']);
        completeTasks(['S02']);
        assertExit(runState(['record', 'execute', '{"summary":"final serial wave complete"}'], dir, env), 0);
      }, { expectedNode: 'review' });
      drive('review', 'flow-comet-review', 'flow-kit/prompts/6-review.md', () => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
          '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nreview passed，无遗留问题。\n');
        assertExit(runState(['record', 'review', '{"summary":"review complete"}'], dir, env), 0);
      }, { expectedNode: 'verify' });
      drive('verify', 'flow-comet-verify', 'flow-kit/prompts/7-integration.md', () => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```\necho ok\n```\n');
        writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
        assertExit(runState(['record', 'verify', '{"summary":"verify complete"}'], dir, env), 0);
      }, { expectedNode: 'archive' });
      // 归档出口：两侧均 NEXT: done
      assertExit(runState(['skill-load', 'archive', 'flow-comet-archive', '--prompt', 'flow-kit/prompts/7-integration.md'], dir, env), 0);
      writeFile(dir, '.specs/archive/2026-08-28-' + CHANGE_ID + '/KNOWN-ISSUES.md', '# 遗留问题\n\n无。\n');
      assertExit(runState(['record', 'archive', '{"summary":"archive complete"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'archive'], dir), 0);
      const resArch = runGuard(['exit', 'archive', '--apply'], dir);
      assertExit(resArch, 0);
      assertOut(resArch, 'NEXT: done');
      const nxt = runNext();
      assertExit(nxt, 0);
      assertOut(nxt, 'NEXT: done');
    },
  },

  {
    // M2（2026-08-29）漂移容忍 exit 系统锚（真实命令链路）：execute 产物/证据齐（单任务完成 +
    // SUMMARY + record execute + entry execute）→ 构造欠账漂移态（currentNode 漂移到文件推导
    // 下一节点 review，execute 未进 completedNodes）→ 容错 exit execute --apply 补齐欠账。
    // 修复前 currentNode 校验直接 BLOCK → 预期失败（RED 锚）；场景级同语义锚见自测套件。
    name: 'A18 漂移容忍 exit：execute 欠账经容错路径补齐（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap) => {
        const blk = (id, status) =>
          '<task id="' + id + '" status="' + status + '">' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify></task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + blk('S01', statusMap.S01 ?? 'pending'));
      };
      // 驱动至 plan 出口（真实命令：init→open→design 见 driveThroughDesign，随后 plan 三连）
      driveThroughDesign(dir);
      writeTask({ S01: 'pending' });
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md'], dir, env), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      assertExit(runGuard(['exit', 'plan', '--apply'], dir), 0);
      // execute 完整完成（产物 + record + entry，真实命令）——仅差 completedNodes（欠账）
      writeTask({ S01: 'done' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/S01-SUMMARY.md', execSummaryFixture('S01'));
      assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      assertExit(runState(['record', 'execute', '{"summary":"executed","parallelTakeoverApproved":true}'], dir, env), 0);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // R-1 欠账漂移态：currentNode 漂移到文件推导下一节点 review（execute 未 completed）
      const st = readStateFile(dir);
      st.currentNode = 'review';
      writeState(dir, st);
      // 容错 exit execute --apply → 补齐欠账（completedNodes 补 execute）
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      const stAfter = readStateFile(dir);
      if (!stAfter.completedNodes.includes('execute')) {
        throw new Error('容错 exit execute --apply 后 completedNodes 应含 execute（欠账补齐）;实际: ' + stAfter.completedNodes.join(','));
      }
    },
  },

  {
    // M4（2026-08-29）路由诊断静默扩展系统锚（真实命令链路）：波 1 并行完成后剩余串行 pending
    // （P→S 收尾转换）→ subagent-execute 出口无 ROUTE WARN 噪音；畸形 parallel（parallel=true
    // 缺 status）+ 串行 pending → ROUTE WARN 仍报（结构校验严格保持）。场景级同语义见自测套件对应锚。
    name: 'A19 路由诊断静默扩展：P→S 收尾无噪音 / 畸形块仍报（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap, extra) => {
        const blk = (id, parallel, status, deps) =>
          '<task id="' + id + '"' + (parallel ? ' parallel="true"' : ' parallel="false"') +
          ' status="' + status + '">' +
          '<name>任务-' + id + '</name><read_files>src/*</read_files>' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
          '<done>AC-' + id + '</done><depends_on>' + (deps || '') + '</depends_on></task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
          (extra ? extra
            : blk('P01', true, statusMap.P01 ?? 'pending', '') + blk('S01', false, statusMap.S01 ?? 'pending', 'P01')));
      };
      driveThroughDesign(dir);
      writeTask({ P01: 'pending', S01: 'pending' });
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md'], dir, env), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      assertExit(runGuard(['exit', 'plan', '--apply'], dir), 0);
      // 波 1：并行任务完成（SUMMARY+handoff）→ P→S 收尾（串行尾任务 pending）；
      // 发起委托前先 skill-load 声明（handoff request 前置门——先声明再发起委托，与既有委托链同序）
      writeTask({ P01: 'done', S01: 'pending' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', execSummaryFixture('P01'));
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-subagent-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      assertExit(runHandoff(['request', 'P01', 'P01 委托', '--write-files', 'src/p01.mjs'], dir), 0);
      assertExit(runHandoff(['result', 'P01', fullContract('abcd1234abcd1234abcd1234abcd1234abcd1234', 'P01')], dir), 0);
      assertExit(runState(['record', 'subagent-execute', '{"summary":"wave 1 delegated and collected"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'subagent-execute'], dir), 0);
      const resWave = runGuard(['exit', 'subagent-execute', '--apply'], dir);
      assertExit(resWave, 0);
      assertNotOut(resWave, 'ROUTE WARN'); // 剩余 pending 全串行（P→S 收尾）→ M4 静默
      // 畸形块仍报：parallel 缺 status（但 7 字段齐）+ 串行 pending → ROUTE WARN 保持
      // （构造 plan 出口态，既有出口同款夹具形态；新 change 下畸形块亦须过结构门再达诊断）
      const st = readStateFile(dir);
      st.currentNode = 'plan';
      st.completedNodes = ['open', 'design'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P03" parallel="true"><name>任务-P03（畸形并行，缺 status）</name><read_files>src/*</read_files>' +
        '<action>实现 P03</action><write_files>src/p03.mjs</write_files><verify>node --check src/p03.mjs</verify>' +
        '<done>AC-P03</done><depends_on></depends_on></task>\n' +
        '<task id="S02" parallel="false" status="pending"><name>任务-S02（串行）</name><read_files>src/*</read_files>' +
        '<action>实现 S02</action><write_files>src/s02.mjs</write_files><verify>node --check src/s02.mjs</verify>' +
        '<done>AC-S02</done><depends_on></depends_on></task>\n');
      assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const resMal = runGuard(['exit', 'plan', '--apply'], dir);
      assertExit(resMal, 0);
      assertOut(resMal, 'ROUTE WARN'); // 畸形块仍报（结构校验严格保持）
    },
  },

  {
    // directOverride 授权约束系统锚（真实命令链路）：执行者自切 direct 无授权（绕过脚本手改
    // state——修复后 hook 会拦截此类工具写；此处直接构造越权形态验证 guard 出口拦截）→
    // execute 出口 BLOCKED + 恢复指引；协调者授权路径（execution-mode direct 真实命令写入
    // 授权留痕）→ 出口通过。场景级同语义见自测套件对应锚。
    name: 'A20 directOverride 授权约束：自切 direct 无授权 BLOCK / 协调者授权通过（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap) => {
        const blk = (id, status) =>
          '<task id="' + id + '" status="' + status + '">' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify></task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + blk('S01', statusMap.S01 ?? 'pending'));
      };
      // 驱动至 execute（真实命令：init→open→design→plan 出口）
      driveThroughDesign(dir);
      writeTask({ S01: 'pending' });
      assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md'], dir, env), 0);
      assertExit(runState(['record', 'plan', '{"summary":"plan complete"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      assertExit(runGuard(['exit', 'plan', '--apply'], dir), 0);
      // execute 完整完成（产物 + record + entry，真实命令）
      writeTask({ S01: 'done' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/S01-SUMMARY.md', execSummaryFixture('S01'));
      assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      assertExit(runState(['record', 'execute', '{"summary":"executed"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 执行者自切 direct（directOverride=true 但无授权审计记录——B 方案前的自切/遗留形态）
      const st = readStateFile(dir);
      st.executionMode = 'direct';
      st.directOverride = true;
      writeState(dir, st);
      const rBlock = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(rBlock, 1);
      assertOut(rBlock, 'BLOCKED');
      assertOut(rBlock, 'directOverride');
      // 协调者授权路径：execution-mode direct（脚本写入授权留痕）→ exit 通过
      const auth = runState(['execution-mode', 'direct'], dir, env);
      assertExit(auth, 0);
      assertOut(auth, 'DIRECT-AUTH');
      const stAuth = readStateFile(dir);
      if (typeof stAuth.directOverrideAt !== 'string' || stAuth.directOverrideAt.trim() === '') {
        throw new Error('协调者授权后 state 应含 directOverrideAt 审计字段: ' + JSON.stringify(stAuth.directOverrideAt));
      }
      const rPass = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(rPass, 0);
      assertOut(rPass, 'ALL CHECKS PASSED');
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
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev'], dir), 0);
      const payload = JSON.stringify({ summary: 'delegated', completedChecks: ['required-skill:subagent-execute.flow-comet-dev'] });
      // 无委托记录 → 拦截（handoff scope 条目以共用证据库的委托记录为证据）
      const blocked = runState(['record', 'subagent-execute', payload], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, '无委托记录');
      // 委托并回传契约后 → 通过(request 声明边界——新 change 强制 write_files 来源)
      assertExit(runHandoff(['request', 'T01', 'T01 委托', '--write-files', 'src/t1.mjs'], dir), 0);
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
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
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
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
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
      assertExit(runState(['skill-load', 'execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir), 0);
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
      assertExit(runHandoff(['request', 'T03', 'T03 委托', '--write-files', 'src/t1.mjs'], dir), 0);
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
      // ⑦ 零提交正式语义：write_files 为空 + 显式零提交 → 跳过提交子集校验 + 可审计提示；
      //    write_files 非空 + 声称 noCommit → 仍完整提交子集校验（不可借零提交绕过越界检查）
      const stEmpty = readStateFile(dir);
      stEmpty.newChange = true;
      writeState(dir, stEmpty);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T05" status="pending"><action>无边界任务</action><write_files></write_files><verify>echo ok</verify></task>\n');
      assertExit(runHandoff(['request', 'T05'], dir), 0);
      const resZero = runHandoff(['result', 'T05', JSON.stringify({
        status: 'DONE', taskId: 'T05', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'echo ok' },
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resZero, 0);
      assertOut(resZero, 'HANDOFF RESULT: T05');
      assertOut(resZero, '零提交');
      // ⑦b 零提交滥用负例：write_files 非空 + 契约声称 noCommit → 仍完整校验（越界 BLOCK + 矛盾提示）
      const stNonEmpty = readStateFile(dir);
      stNonEmpty.newChange = true;
      writeState(dir, stNonEmpty);
      writeFile(dir, 'src/rogue-zero.mjs', 'export const rogue = 1;\n');
      execFileSync('git', ['add', 'src/rogue-zero.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: rogue zero'], { cwd: dir });
      const rogueHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      assertExit(runHandoff(['request', 'T05b', 'T05b 委托', '--write-files', 'src/t2.mjs'], dir), 0);
      const resAbuse = runHandoff(['result', 'T05b', JSON.stringify({
        status: 'DONE', taskId: 'T05b', noCommit: true, commitHash: rogueHash,
        changedFiles: ['src/rogue-zero.mjs'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'echo ok' },
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resAbuse, 1);
      assertOut(resAbuse, '超出 writeFiles 范围');
      assertOut(resAbuse, '零提交');
      // ⑧ 段感知精确匹配:allowed=[src/foo] 不匹配提交 src/foobar.mjs(前缀匹配会放行,
      // 精确匹配判越界——修复前前缀匹配误放行,此处应 RED)
      writeFile(dir, 'src/foobar.mjs', 'export const x = 1;\n');
      execFileSync('git', ['add', 'src/foobar.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: foobar'], { cwd: dir });
      const foobarHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      assertExit(runHandoff(['request', 'T06', '--write-files', 'src/foo'], dir), 0);
      const resExact = runHandoff(['result', 'T06', JSON.stringify({
        status: 'DONE', taskId: 'T06', commitHash: foobarHash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resExact, 1);
      assertOut(resExact, '超出 writeFiles 范围');
      // ⑨ --json-file 缺值(最后一个参数)→ 用法错误(与 record 对齐;修复前报类型 TypeError)
      const missingVal = runHandoff(['result', 'T07', '--json-file'], dir);
      assertExit(missingVal, 1);
      assertOut(missingVal, '--json-file requires a path argument');
      // ⑨b --json-file 空串(--json-file= 形式)→ 同样用法错误(修复前解析为 runRoot 报 EISDIR)
      const emptyVal = runHandoff(['result', 'T07', '--json-file='], dir);
      assertExit(emptyVal, 1);
      assertOut(emptyVal, '--json-file requires a path argument');
      // ⑪ 部分通配负例:allowed=[src/*.mjs] 不得匹配 src/b.ts(段内正则锚定,
      // 扩展名不匹配 → 新 change BLOCKED;若实现放宽为任意匹配即 RED)
      writeFile(dir, 'src/b.ts', 'export const b = 1;\n');
      execFileSync('git', ['add', 'src/b.ts'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: b.ts'], { cwd: dir });
      const bHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      assertExit(runHandoff(['request', 'T08', '--write-files', 'src/*.mjs'], dir), 0);
      const resGlobNeg = runHandoff(['result', 'T08', JSON.stringify({
        status: 'DONE', taskId: 'T08', commitHash: bHash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resGlobNeg, 1);
      assertOut(resGlobNeg, '超出 writeFiles 范围');
      // ⑩ 部分段通配:allowed=[src/*.mjs] 应匹配提交 src/a.mjs → 无越界(修复前
      // 段内 glob 被字面比较,新 change 误 BLOCKED——此处应 RED)
      writeFile(dir, 'src/a.mjs', 'export const a = 1;\n');
      execFileSync('git', ['add', 'src/a.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: a.mjs'], { cwd: dir });
      const aHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      assertExit(runHandoff(['request', 'T07', '--write-files', 'src/*.mjs'], dir), 0);
      const resGlob = runHandoff(['result', 'T07', JSON.stringify({
        status: 'DONE', taskId: 'T07', commitHash: aHash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resGlob, 0);
      assertNotOut(resGlob, '超出 writeFiles 范围');
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
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir), 0);
      assertExit(runState(['record', 'subagent-execute', '{"handoffResult":{}}'], dir), 0);
      const stEmpty = readStateFile(dir);
      stEmpty.currentNode = 'subagent-execute';
      writeState(dir, stEmpty);
      assertExit(runGuard(['entry', 'subagent-execute'], dir), 0);
      const blocked = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'requires evidence: handoff-result');
      // ② 真实委托链路：request 声明边界(新 change 强制 write_files 来源)→ handoff result
      // 回传完整契约（键名契约：嵌套 handoffResult 识别 + Return Contract 校验）→ 出口通过
      const st2 = readStateFile(dir);
      st2.evidence['subagent-execute'] = { summary: 'delegated and collected' };
      writeState(dir, st2);
      const reqP01 = runHandoff(['request', 'P01', '委托实现 P01', '--write-files', 'src/p1.mjs'], dir);
      assertExit(reqP01, 0);
      const result = runHandoff(['result', 'P01', fullContract(hash, 'P01')], dir);
      assertExit(result, 0);
      assertOut(result, 'HANDOFF RESULT: P01');
      const pass = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(pass, 0);
      assertOut(pass, 'ALL CHECKS PASSED');
      // ② M5 自动补不得为 handoff scope 技能写协调者标记(flow-comet-dev 由子代理加载,
      // 协调者不声明——修复前 record 无条件写标记,语义误导;此处应 RED)
      const markerDev = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'subagent-execute-flow-comet-dev.json');
      if (fs.existsSync(markerDev)) {
        const markerDevObj = JSON.parse(fs.readFileSync(markerDev, 'utf8'));
        if (markerDevObj.auto === true) throw new Error('M5 不应为 handoff scope 技能自动补标记');
      }
      // ③ 契约缺完成检查清单 → 出口拦截（严格校验无豁免）——重写证据时保留委托请求
      // (新 change 强制 write_files 边界来源;直接 result 无 request 会被边界检查拦截)
      const st3 = readStateFile(dir);
      const keepRequests = st3.evidence['subagent-execute'].handoffRequests;
      st3.evidence['subagent-execute'] = { summary: 'delegated', ...(keepRequests ? { handoffRequests: keepRequests } : {}) };
      writeState(dir, st3);
      const weak = JSON.parse(fullContract(hash, 'P01'));
      delete weak.completedChecks;
      assertExit(runHandoff(['result', 'P01', JSON.stringify(weak)], dir), 0);
      const reenter = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(reenter, 1);
      assertOut(reenter, 'Return Contract 校验失败');
      // 移除手动声明标记，回到「仅有 open 声明、无 subagent-execute 声明」的激活机制形态
      fs.rmSync(markerDev, { force: true });
      // ⑫ 声明机制激活下的 subagent-execute 声明要求(自动补标记跳过 handoff scope 后的
      // 固化行为):有 open 标记(声明机制已激活)但无 subagent-execute 声明 → exit BLOCKED;
      // 手动 skill-load 声明(协调者按 4-dev.md 构造 handoff prompt 的真实动作)后 → 通过
      writeFile(dir, 'flow-kit/prompts/4-dev.md', '# 阶段 4 · DEV\n\n## 角色\n\n你是 Developer。\n');
      const stDecl = readStateFile(dir);
      stDecl.evidence['subagent-execute'] = { summary: 'delegated', handoffResult: { P01: { result: JSON.parse(fullContract(hash, 'P01')) } } };
      writeState(dir, stDecl);
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const rDeclBlock = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(rDeclBlock, 1);
      assertOut(rDeclBlock, 'exit 缺协议声明标记');
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir), 0);
      const rDeclPass = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(rDeclPass, 0);
      assertOut(rDeclPass, 'ALL CHECKS PASSED');
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
      assertExit(runState(['skill-load', 'verify', 'flow-comet-integration', '--prompt', 'flow-kit/prompts/7-integration.md'], dir), 0);
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
      assertExit(runState(['skill-load', 'archive', 'flow-comet-integration', '--prompt', 'flow-kit/prompts/7-integration.md'], dir), 0);
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
      assertExit(runState(['skill-load', 'archive', 'flow-comet-integration', '--prompt', 'flow-kit/prompts/7-integration.md'], dir), 0);
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
      assertExit(runState(['skill-load', 'archive', 'flow-comet-integration'], dir), 0);
      const stB = readStateFile(dir);
      stB.currentNode = 'archive';
      writeState(dir, stB);
      fs.renameSync(path.join(dir, '.specs', 'arch-m5b'), path.join(dir, '.specs', 'archive', '2026-08-14-arch-m5b'));
      const recB = runState(['record', 'archive', '{"summary":"archived"}'], dir);
      assertExit(recB, 0);
      if (fs.existsSync(path.join(dir, '.specs', 'arch-m5b'))) {
        throw new Error('M5 在双路径皆无时重建了活动目录(残留): .specs/arch-m5b/');
      }
      // 变体:归档后 skill-load 报错须引导 record 自动补路径(级 4 实证:归档后手动声明
      // 不可行,消息须指明 M5 自动补仍可写归档路径标记)
      const slArchive = runState(['skill-load', 'archive', 'flow-comet-integration'], dir);
      assertExit(slArchive, 1);
      assertOut(slArchive, 'record 自动补写');
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
      // 权威源须与 CHANGELOG 首个版本段一致(发布批次更新;CI release-consistency 同规则);
      // 版本段可带 prerelease 后缀(如 -rc.1 / -beta-1)
      const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
      const m = changelog.match(/^## \[(\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?)\]/m);
      const expected = m ? m[1] : 'unreleased';
      if (srcVersion !== expected) throw new Error('权威源版本标识不符: ' + srcVersion + ' ≠ CHANGELOG 版本 ' + expected);
      const versionFile = path.join(target, '.claude', 'skills', 'flow-comet', 'INSTALLED_VERSION');
      if (!fs.existsSync(versionFile)) throw new Error('缺少 INSTALLED_VERSION(版本标识文件)');
      const installed = fs.readFileSync(versionFile, 'utf8').trim();
      if (!installed) throw new Error('版本标识为空');
      // 格式:发布版本号(1.3.1) / prerelease(1.5.0-rc.1 或 1.5.0-beta-1) / git describe 开发态(1.3.1-N-g<hash>) / unreleased(无 tag 兜底)
      const ok = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(-\d+-g[0-9a-f]+)?$/.test(installed) || installed === 'unreleased';
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
      // 托管条目断言形态无关化(断言放宽决策——意图为托管条目在场且指向本项目脚本):脚本 basename 在位 + 项目根引用特征二选一——
      // 兼容新旧两种托管形态,注入命令实测微调(%VAR% 引号/变量词形)不再破坏断言
      const managedCmds = collectManagedHookCommands(hooksParsed);
      if (managedCmds.length === 0) throw new Error('hooks.json 未注入托管 hook 命令');
      for (const c of managedCmds) assertManagedHookEntry(c, 'codex hooks.json 托管命令');
      if (!JSON.stringify(hooksParsed).includes('--platform codex')) throw new Error('hooks.json hook 命令缺平台标记');
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
      const run = (target, envOverrides = {}) => spawnSync(process.execPath, [installer, '--target', target], { cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...envOverrides } });
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
      // ⑦ 无 --platform + 目标同时有 .claude/ 与 .codex/ 痕迹 → 不武断二选一:
      //    默认 claude-code(主平台)+ 输出多痕迹提示(修复前探测 .codex/ 优先会武断只装 codex)
      const t7 = path.join(dir, 'k4-dual-trace');
      fs.mkdirSync(path.join(t7, '.claude'), { recursive: true });
      fs.mkdirSync(path.join(t7, '.codex'), { recursive: true });
      const r7 = run(t7);
      if (r7.status !== 0) throw new Error('双痕迹项目安装失败: ' + (r7.stderr || JSON.stringify(r7.output)));
      if (!fs.existsSync(path.join(t7, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) {
        throw new Error('双痕迹项目应默认安装 claude-code(主平台),而非武断只装 codex');
      }
      if (fs.existsSync(path.join(t7, '.agents'))) throw new Error('双痕迹项目默认 claude-code 时不应生成 .agents/');
      const out7 = String(r7.stdout || '') + String(r7.stderr || '');
      if (!out7.includes('同时有 .claude/、.codex/ 或 .dsh/ 中的多个痕迹')) throw new Error('多痕迹无 TTY 应输出多痕迹提示: ' + out7);
      // ⑧ TTY 多选(交互模拟——平台选择链缺省路径):覆盖 stdin.isTTY + 管道喂入 '1,3'
      //    (Claude Code + dsh——三平台选项,旧 both 已移除)→ 双平台产物同时生成;
      //    dsh 副本命令路径平台化(.dsh 形态,不含 .claude 路径);DSH_HOME 指向临时目录
      //    (断言全程不写真实 ~/.dsh)
      const t8 = path.join(dir, 'k4-multiselect');
      fs.mkdirSync(t8, { recursive: true });
      const dshHome8 = path.join(dir, 'k4-dsh-home');
      const installerUrl = pathToFileURL(installer).href;
      const selectScript =
        `Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });` +
        `process.argv = ['node', 'prepare-env', '--target', ${JSON.stringify(t8)}];` +
        `await import(${JSON.stringify(installerUrl)});`;
      const r8 = spawnSync(process.execPath, ['--input-type=module', '-e', selectScript], { cwd: repoRoot, encoding: 'utf8', input: '1,3\n', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome8 } });
      if (r8.status !== 0) throw new Error('TTY 多选安装失败: ' + (r8.stderr || JSON.stringify(r8.output)));
      if (!fs.existsSync(path.join(t8, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('TTY 多选后 .claude/skills 应生成');
      if (!fs.existsSync(path.join(t8, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('TTY 多选后 .dsh/skills 应生成');
      if (fs.existsSync(path.join(t8, '.agents'))) throw new Error('TTY 多选(1,3)不应生成 .agents/(未选 codex)');
      const dshSkillText8 = fs.readFileSync(path.join(t8, '.dsh', 'skills', 'flow-comet', 'SKILL.md'), 'utf8');
      if (dshSkillText8.includes('.claude/skills/flow-comet/scripts/')) {
        throw new Error('TTY 多选后 dsh 副本命令路径应为 .dsh 形态');
      }
      if (!fs.existsSync(path.join(dshHome8, 'plugins', 'dsh-flow-comet-bridge.mjs'))) {
        throw new Error('TTY 多选后桥接 loader 应复制到临时 DSH_HOME(不写真实 ~/.dsh)');
      }
      // ⑨ 仅 .dsh/ 痕迹 → 无 TTY 探测为 dsh(三痕迹探测语义)
      const t9 = path.join(dir, 'k4-probe-dsh');
      fs.mkdirSync(path.join(t9, '.dsh'), { recursive: true });
      const r9 = run(t9, { DSH_HOME: path.join(dir, 'k4-probe-dsh-home') });
      if (r9.status !== 0) throw new Error('探测 dsh 安装失败: ' + (r9.stderr || JSON.stringify(r9.output)));
      if (!fs.existsSync(path.join(t9, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('已有 .dsh/ 的项目应探测为 dsh 平台');
      // ⑩ 显式逗号多平台:--platform claude-code,dsh → 两平台产物同时生成(CI/无 TTY 路径)
      const t10 = path.join(dir, 'k4-comma');
      fs.mkdirSync(t10, { recursive: true });
      const r10 = spawnSync(process.execPath, [installer, '--target', t10, '--platform', 'claude-code,dsh'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: path.join(dir, 'k4-comma-home') } });
      if (r10.status !== 0) throw new Error('--platform claude-code,dsh 失败: ' + (r10.stderr || JSON.stringify(r10.output)));
      if (!fs.existsSync(path.join(t10, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('逗号多平台应生成 .claude/skills');
      if (!fs.existsSync(path.join(t10, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('逗号多平台应生成 .dsh/skills');
      if (fs.existsSync(path.join(t10, '.agents'))) throw new Error('逗号多平台(claude-code,dsh)不应生成 .agents/');
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
      // purge 冒烟验证清理函数真实可用,缺函数/清理失败即红);
      // DSH_HOME 指向临时目录——dsh 平台 installHooks 写 $DSH_HOME(plugins/loader +
      // cordis.patch.yml 托管块),断言全程不污染真实 ~/.dsh
      const dshHome = path.join(dir, 'k6-dsh-home');
      for (const id of ids) {
        const target = path.join(dir, 'k6-' + id);
        fs.mkdirSync(target, { recursive: true });
        const env = { ...process.env, DSH_HOME: dshHome };
        const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', id], { cwd: repoRoot, encoding: 'utf8', timeout: 120000, env });
        if (res.status !== 0) throw new Error('平台 ' + id + ' 安装失败: ' + (res.stderr || JSON.stringify(res.output)));
        const purgeRes = spawnSync(process.execPath, [installer, '--target', target, '--platform', id, '--purge', '--yes'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000, env });
        if (purgeRes.status !== 0) throw new Error('平台 ' + id + ' purge 失败: ' + (purgeRes.stderr || JSON.stringify(purgeRes.output)));
      }
      console.log('  描述符驱动: ' + ids.length + ' 个平台逐一安装 + purge 冒烟通过✓');
    },
  },
// ---------- K 扩展:dsh 平台断言（1.4.2 deepseek-harness-platform——安装器多平台） ----------
// 旧 dsh-plugin npm 包已废弃(对象 dsh-plugin/ 目录另行废弃清理)——以下断言覆盖
// prepare-env --platform dsh 的项目级安装/AGENTS.md 托管区/桥接 loader/purge 清理恢复;
// 断言全程 DSH_HOME=临时目录环境变量,禁止污染真实 ~/.dsh(AC-1/AC-4)

  // K7: dsh 描述符安装产物——--platform dsh 项目级安装(.dsh/skills rank 100 自动发现) +
  // pathReplacements 平台化(.dsh/skills/flow-comet/scripts/ 形态) + INSTALLED_VERSION +
  // 安装树清单与权威源一致;全程 DSH_HOME=临时目录(AC-1)
  {
    name: 'K7 安装器:dsh 平台安装(技能/pathReplacements/版本标识/树一致)',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const dshHome = path.join(dir, 'k7-dsh-home');
      const target = path.join(dir, 'k7-target');
      fs.mkdirSync(target, { recursive: true });
      const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      if (res.status !== 0) throw new Error('prepare-env --platform dsh 失败: ' + (res.stderr || JSON.stringify(res.output)));
      // ① 技能安装到 <项目>/.dsh/skills/flow-comet/(dsh rank 100 项目级发现位置)
      const skillMd = path.join(target, '.dsh', 'skills', 'flow-comet', 'SKILL.md');
      if (!fs.existsSync(skillMd)) throw new Error('dsh 平台技能未安装到 .dsh/skills/flow-comet/');
      // ② guard 判定核心随技能分发(comet-hook-guard 平台无关 CLI,一行不动)
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'flow-comet', 'scripts', 'comet-hook-guard.mjs'))) {
        throw new Error('comet-hook-guard.mjs 未随技能分发到 .dsh/skills/flow-comet/scripts/');
      }
      // ③ 版本标识写入(随技能包分发)
      const verFile = path.join(target, '.dsh', 'skills', 'flow-comet', 'INSTALLED_VERSION');
      if (!fs.existsSync(verFile)) throw new Error('缺少 INSTALLED_VERSION(版本标识文件)');
      if (!fs.readFileSync(verFile, 'utf8').trim()) throw new Error('版本标识为空');
      // ④ pathReplacements 生效:SKILL 命令路径为 .dsh 形态,无 .claude 残留
      const text = fs.readFileSync(skillMd, 'utf8');
      if (!text.includes('.dsh/skills/flow-comet/scripts/')) throw new Error('SKILL 命令路径未替换为 .dsh/skills/flow-comet/scripts/');
      if (text.includes('.claude/skills/flow-comet/scripts/')) throw new Error('SKILL 仍含 .claude/skills/flow-comet/scripts/ 命令路径');
      // ⑤ 安装树文件清单与权威源一致(pathReplacements 只改内容不改清单)
      const authoritative = path.join(repoRoot, '.comet', 'bundle-drafts', 'flow-comet', 'skills', 'flow-comet');
      const installedTree = collectTreeFiles(path.join(target, '.dsh', 'skills', 'flow-comet'));
      const srcTree = collectTreeFiles(authoritative);
      if (installedTree.length === 0) throw new Error('安装技能树为空');
      if (JSON.stringify(installedTree) !== JSON.stringify(srcTree)) {
        throw new Error('安装树清单与权威源不一致\n权威源: ' + srcTree.join(', ') + '\n安装: ' + installedTree.join(', '));
      }
      console.log('  .dsh/skills/flow-comet 安装树 = ' + installedTree.length + ' files 与权威源一致 ✓');
    },
  },

  // K8: AGENTS.md 托管区注入——托管区存在 + 托管区外用户内容保留 + 幂等重装不重复
  // (codex/dsh 共用注入函数与托管区标记——AC-4)
  {
    name: 'K8 安装器:dsh AGENTS.md 托管区(用户内容保留 + 幂等重装)',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const dshHome = path.join(dir, 'k8-dsh-home');
      const target = path.join(dir, 'k8-target');
      fs.mkdirSync(target, { recursive: true });
      // 预置用户内容(托管区外,安装不得覆盖)
      fs.writeFileSync(path.join(target, 'AGENTS.md'), '# 用户自定义指令\n\n保留这段内容。\n', 'utf8');
      const run = () => spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      // ① 首次安装:托管区注入(内联 orchestration 全文)+ 用户内容保留
      const first = run();
      if (first.status !== 0) throw new Error('dsh 安装失败: ' + (first.stderr || JSON.stringify(first.output)));
      let agents = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
      if (!agents.includes('<!-- Managed by flow-comet prepare-env -->')) throw new Error('AGENTS.md 无托管区标记');
      if (!agents.includes('flow-comet Orchestration')) throw new Error('AGENTS.md 未内联 orchestration 内容');
      if (!agents.includes('用户自定义指令') || !agents.includes('保留这段内容。')) throw new Error('托管区外用户内容被覆盖');
      // ② 幂等重装:托管区不重复注入(start+end 标记合计 2 处 = 1 个托管区)
      const second = run();
      if (second.status !== 0) throw new Error('dsh 重装失败: ' + (second.stderr || JSON.stringify(second.output)));
      agents = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
      if (!agents.includes('保留这段内容。')) throw new Error('重装后用户内容丢失');
      const markerCount = (agents.match(/Managed by flow-comet prepare-env/g) || []).length;
      if (markerCount !== 2) throw new Error('幂等重装后托管区应只有 1 组标记(实际 ' + markerCount + ' 个)——重复注入');
      console.log('  AGENTS.md 托管区注入 + 幂等重装不重复 ✓');
    },
  },

  // K9: 桥接 loader 就位——权威源文件存在 + node --check 语法 + 安装时复制到
  // $DSH_HOME/plugins/ + cordis.patch.yml 托管块注入(insert 形态 + file:// 引用 loader 路径,
  // 读-合并-写保留既有块;insert 形态是 home patch 追加新插件的唯一正确形态——patch 形态
  // id-targeted 对不存在的 id 报 entry not found 跳过,loader 不加载,拦截整链静默失效;
  // $DSH_HOME 解析 = 显式 DSH_HOME > ~/.dsh——测试隔离到临时目录)
  {
    name: 'K9 桥接 loader:源文件/语法/复制与托管块注入(读-合并-写)',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      // ① 权威源 loader 存在 + 语法检查
      const loader = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const check = spawnSync(process.execPath, ['--check', loader], { encoding: 'utf8', timeout: 60000 });
      if (check.status !== 0) throw new Error('dsh-bridge.mjs 语法检查失败: ' + (check.stderr || ''));
      // ② 安装后:loader 复制到 $DSH_HOME/plugins/dsh-flow-comet-bridge.mjs + 托管块注入
      const dshHome = path.join(dir, 'k9-dsh-home');
      const target = path.join(dir, 'k9-target');
      fs.mkdirSync(target, { recursive: true });
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      if (res.status !== 0) throw new Error('dsh 安装失败: ' + (res.stderr || JSON.stringify(res.output)));
      if (!fs.existsSync(path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs'))) {
        throw new Error('loader 未复制到 $DSH_HOME/plugins/');
      }
      const patchPath = path.join(dshHome, 'cordis.patch.yml');
      if (!fs.existsSync(patchPath)) throw new Error('缺少 $DSH_HOME/cordis.patch.yml');
      const patch = fs.readFileSync(patchPath, 'utf8');
      if (!patch.includes('# --- flow-comet managed ---') || !patch.includes('# --- end flow-comet managed ---')) {
        throw new Error('cordis.patch.yml 无托管块标记');
      }
      // insert 形态断言（L-015 教训：套件全绿 ≠ 真实 dsh 生效——patch 形态 id-targeted 语义对
      // 不存在的 id 输出 entry not found 并跳过，loader 从不加载；insert 形态才追加新插件行）
      if (!patch.includes('- insert:')) throw new Error('cordis.patch.yml 托管块应为 insert 形态(- insert: 顶层条目)');
      if (!patch.includes('dsh-flow-comet-bridge')) throw new Error('cordis.patch.yml 缺 loader 条目');
      const loaderUrl = pathToFileURL(path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs')).href;
      if (!patch.includes(loaderUrl)) throw new Error('cordis.patch.yml 托管块应 file:// 引用 loader 路径: ' + loaderUrl);
      // ③ 读-合并-写非破坏:预置 dsh-skin 既有块 → 重装后保留(托管块幂等唯一)
      fs.writeFileSync(patchPath, '# --- dsh-skin managed ---\n- id: dsh-skin\n  name: file:///skin\n# --- end dsh-skin managed ---\n' + patch, 'utf8');
      const re = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      if (re.status !== 0) throw new Error('dsh 重装失败: ' + (re.stderr || JSON.stringify(re.output)));
      const after = fs.readFileSync(patchPath, 'utf8');
      if (!after.includes('dsh-skin managed')) throw new Error('重装后 dsh-skin 既有块丢失(读-合并-写非破坏)');
      if ((after.match(/flow-comet managed/g) || []).length !== 2) {
        throw new Error('重装后 flow-comet 托管块应幂等唯一: ' + after);
      }
      console.log('  loader 复制 + cordis.patch.yml 托管块(读-合并-写保留既有块)✓');
    },
  },

  // K10: dsh purge 清理恢复——缺 --yes 拒绝(不破坏)/ --purge --yes 删除后重新生成
  // (既有 main 语义:purge 后重新生成到最终态)/ 用户内容保留 / 空 .dsh 目录清理
  // (唯一 flow-comet 技能移除后 .dsh/skills 与 .dsh 变空 → 一并清理)
  {
    name: 'K10 安装器:dsh purge 清理恢复(缺 --yes 拒绝/删除后重建/用户内容保留/空目录清理)',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const dshHome = path.join(dir, 'k10-dsh-home');
      const run = (target, extra) => spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh', ...extra], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      // ① 首次安装 + 用户内容(项目根,非生成物)
      const target = path.join(dir, 'k10-target');
      fs.mkdirSync(target, { recursive: true });
      const first = run(target, []);
      if (first.status !== 0) throw new Error('dsh 首次安装失败: ' + (first.stderr || JSON.stringify(first.output)));
      fs.writeFileSync(path.join(target, 'USER_KEEP.md'), '# 用户内容(保留)\n', 'utf8');
      // ② 缺 --yes → 拒绝且不破坏(错误提示含 --yes;生成物与用户内容仍在)
      const dry = run(target, ['--purge']);
      if (dry.status === 0) throw new Error('--purge 缺 --yes 应失败');
      const dryOut = String(dry.stderr || '') + String(dry.stdout || '');
      if (!dryOut.includes('--yes')) throw new Error('--purge 缺 --yes 错误信息应提示 --yes: ' + dryOut);
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('--purge 拒绝后生成物不应被删除');
      if (!fs.existsSync(path.join(target, 'USER_KEEP.md'))) throw new Error('--purge 拒绝后用户内容不应被删除');
      // ③ --purge --yes → 删除后重新生成(最终态 = 重新生成的安装态);移除清单含空 .dsh 目录
      //    清理条目(.dsh/skills 移除后 .dsh 变空——行尾锚定防与 skillRoot 打印行混淆)
      const ok = run(target, ['--purge', '--yes']);
      if (ok.status !== 0) throw new Error('--purge --yes 失败: ' + (ok.stderr || JSON.stringify(ok.output)));
      const okOut = String(ok.stderr || '') + String(ok.stdout || '');
      const dshDirLine = '- ' + path.join(target, '.dsh');
      if (!okOut.includes(dshDirLine + '\r\n') && !okOut.includes(dshDirLine + '\n')) {
        throw new Error('purge 移除清单应含空 .dsh 目录清理条目: ' + okOut);
      }
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('--purge --yes 后技能应重新生成(删除后重新生成语义)');
      if (!fs.existsSync(path.join(target, 'USER_KEEP.md'))) throw new Error('--purge --yes 后用户内容应保留');
      const agents = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
      if (!agents.includes('<!-- Managed by flow-comet prepare-env -->')) throw new Error('--purge --yes 后 AGENTS.md 托管区应重建');
      if (!fs.existsSync(path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs'))) throw new Error('--purge --yes 后桥接 loader 应重建');
      // ④ 共享位置边界:.dsh/skills 用户技能(purge 只清 flow-comet*,其余保留)
      fs.mkdirSync(path.join(target, '.dsh', 'skills', 'user-own-skill'), { recursive: true });
      fs.writeFileSync(path.join(target, '.dsh', 'skills', 'user-own-skill', 'SKILL.md'), '# user skill\n', 'utf8');
      const ok2 = run(target, ['--purge', '--yes']);
      if (ok2.status !== 0) throw new Error('--purge --yes(第二次) 失败: ' + (ok2.stderr || JSON.stringify(ok2.output)));
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'user-own-skill', 'SKILL.md'))) throw new Error('--purge --yes 后用户技能应保留(.dsh/skills 共享位置)');
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('--purge --yes(第二次) 后 flow-comet 技能应重新生成');
      console.log('  dsh purge 缺 --yes 拒绝 + 删除后重建 + 用户内容保留 + 空目录清理 ✓');
    },
  },

  // K11: 桥接 loader 行为断言（dsh-bridge.mjs export 直测——参数映射别名矩阵/
  // 形状不符 fail-closed/项目根包含性含 8.3 短路径/退出码映射/guard 路径存在漂移防护；
  // apply 集成：tools/pre-execute 监听器分派——子代理放行/协调者走 guard/越界·形状 deny 不受身份）
  {
    name: 'K11 桥接 loader:纯函数与 apply 分派断言(映射/包含性/退出映射/身份分派)',
    run: async (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      // 动态 import(套件运行器逐项 await)——dsh-bridge.mjs 仅在权威源仓库根 scripts/,
      // 安装副本缺失时整体跳过(与 K 组其余项同语义);静态 import 会让安装副本套件整体崩
      const loader = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const bridge = await import(pathToFileURL(loader).href);
      // ① 工具名归一化别名矩阵:write/edit/bash 全部别名 → Write/Edit/Bash
      for (const alias of ['write', 'Write', 'WRITE', 'writefile', 'file-write']) {
        if (bridge.normalizeToolName(alias) !== 'Write') throw new Error('normalizeToolName 别名未归一化: ' + alias);
      }
      for (const alias of ['edit', 'Edit', 'editfile', 'file-edit']) {
        if (bridge.normalizeToolName(alias) !== 'Edit') throw new Error('normalizeToolName 别名未归一化: ' + alias);
      }
      for (const alias of ['bash', 'Bash', 'shell', 'powershell', 'pwsh', 'Pwsh', 'PWSH', 'run_command', 'run-command']) {
        if (bridge.normalizeToolName(alias) !== 'Bash') throw new Error('normalizeToolName 别名未归一化: ' + alias);
      }
      // 非 Write/Edit/Bash 或非字符串 → null(监听侧按放行语义跳过)
      for (const v of ['read', 'grep', '', null, undefined, 123, {}]) {
        if (bridge.normalizeToolName(v) !== null) throw new Error('非写工具应归一化为 null: ' + JSON.stringify(v));
      }
      // ② 参数映射别名提取:Write/Edit 的 file_path/filePath/path;Bash 的 command/cmd/script
      const m1 = bridge.mapToolInput('Write', { file_path: 'a.md' });
      if (!m1.ok || m1.target !== 'a.md' || m1.input.file_path !== 'a.md') throw new Error('Write file_path 映射失败: ' + JSON.stringify(m1));
      const m2 = bridge.mapToolInput('Edit', { filePath: 'b.md' });
      if (!m2.ok || m2.target !== 'b.md') throw new Error('Edit filePath 别名映射失败: ' + JSON.stringify(m2));
      const m3 = bridge.mapToolInput('Write', { path: 'c.md' });
      if (!m3.ok || m3.target !== 'c.md') throw new Error('Write path 别名映射失败: ' + JSON.stringify(m3));
      const mPrec = bridge.mapToolInput('Write', { file_path: 'a.md', filePath: 'b.md', path: 'c.md' });
      if (!mPrec.ok || mPrec.target !== 'a.md') throw new Error('file_path 应优先于 filePath/path: ' + JSON.stringify(mPrec));
      for (const alias of ['command', 'cmd', 'script']) {
        const mb = bridge.mapToolInput('Bash', { [alias]: 'npm test' });
        if (!mb.ok || mb.target !== 'npm test' || mb.input.command !== 'npm test') {
          throw new Error('Bash ' + alias + ' 映射失败: ' + JSON.stringify(mb));
        }
      }
      // ②b 形状不符/缺关键字段 → ok:false 可识别(fail-closed 前置,不静默放行)
      const bad1 = bridge.mapToolInput('Write', {});
      if (bad1.ok || !bad1.reason.includes('缺少 file_path')) throw new Error('Write 缺 file_path 应 fail-closed 且原因可识别: ' + JSON.stringify(bad1));
      const bad2 = bridge.mapToolInput('Bash', {});
      if (bad2.ok || !bad2.reason.includes('缺少 command')) throw new Error('Bash 缺 command 应 fail-closed 且原因可识别: ' + JSON.stringify(bad2));
      if (bridge.mapToolInput('Write', { file_path: '   ' }).ok) throw new Error('空白 file_path 应 fail-closed');
      if (bridge.mapToolInput('Bash', null).ok) throw new Error('null 参数应 fail-closed');
      if (bridge.mapToolInput('Bash', ['x']).ok) throw new Error('数组参数应 fail-closed');
      if (bridge.mapToolInput('Read', { file_path: 'a.md' }).ok) throw new Error('未支持工具名应 fail-closed');
      // ③ isPathInsideProjectRoot:项目内长路径 true / 项目外 false(含 .. 越界)
      const projRoot = path.join(dir, 'k11-proj');
      fs.mkdirSync(projRoot, { recursive: true });
      if (!bridge.isPathInsideProjectRoot(projRoot, path.join(projRoot, 'src', 'a.md'))) throw new Error('项目内长路径应判定为 true');
      if (!bridge.isPathInsideProjectRoot(projRoot, 'src/a.md')) throw new Error('项目内相对路径应判定为 true');
      const outside = path.join(dir, 'k11-out');
      fs.mkdirSync(outside, { recursive: true });
      if (bridge.isPathInsideProjectRoot(projRoot, path.join(outside, 'x.md'))) throw new Error('项目外绝对路径应判定为 false');
      if (bridge.isPathInsideProjectRoot(projRoot, path.join(projRoot, '..', 'k11-out', 'x.md'))) throw new Error('.. 越界路径应判定为 false');
      // ③b 8.3 短路径别名(Windows 8dot3name):os.tmpdir() 本机为 C:\Users\LONGYI~1
      //    短形态,realpathSync.native 归一化为长形态——词法不同但实路径相同;
      //    短形态不可解析的平台(禁用 8dot3name/POSIX)显式跳过
      const realRoot = bridge.realpathExistingPath(projRoot);
      if (realRoot !== projRoot) {
        const longFormTarget = path.join(realRoot, 'src', 'a.md');
        if (!bridge.isPathInsideProjectRoot(projRoot, longFormTarget)) {
          throw new Error('8.3 短路径别名(长形态目标)应归一化后判定为 true');
        }
        const normalized = bridge.realpathExistingPath(path.join(projRoot, 'src'));
        if (normalized !== path.join(realRoot, 'src')) {
          throw new Error('realpathExistingPath 应返回规范化长路径: ' + normalized + ' ≠ ' + path.join(realRoot, 'src'));
        }
        console.log('  8.3 短路径别名经 realpath 归一化为长形态判定 ✓');
      } else {
        console.log('  (8.3 短路径别名不可解析——平台跳过)');
      }
      // ④ mapGuardExit:exit 0 → allow / exit 2 → deny(恢复指引 + detail 透传)/ 其它 → fail-closed
      if (bridge.mapGuardExit(0, '', '').kind !== 'allow') throw new Error('exit 0 应 allow');
      const d2 = bridge.mapGuardExit(2, 'BLOCKED detail', '');
      if (d2.kind !== 'deny') throw new Error('exit 2 应 deny');
      if (!d2.reason.includes('白名单拦截') || !d2.reason.includes('BLOCKED detail')) {
        throw new Error('exit 2 deny 应透传恢复指引与 detail: ' + JSON.stringify(d2));
      }
      for (const code of [1, 3, null, '0']) {
        const err = bridge.mapGuardExit(code, 'boom', '');
        if (err.kind !== 'error') throw new Error('其它退出码应 fail-closed error: code=' + String(code));
        if (!err.message.includes('code=' + String(code))) throw new Error('error 消息应含退出码: ' + JSON.stringify(err));
      }
      // ⑤ guard 路径存在断言(M4 漂移防护):HOOK_GUARD_REL('.dsh/skills/flow-comet/scripts/
      //    comet-hook-guard.mjs')与安装器独立维护同一知识——任一侧漂移(常量改/安装布局改)
      //    → 此断言失败,拦截层即失效(guard 缺失 → 桥接 WARN + 放行 fail-open)
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const dshHome = path.join(dir, 'k11-dsh-home');
      const target = path.join(dir, 'k11-target');
      fs.mkdirSync(target, { recursive: true });
      const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      if (res.status !== 0) throw new Error('dsh 安装失败: ' + (res.stderr || JSON.stringify(res.output)));
      const guardRel = '.dsh/skills/flow-comet/scripts/comet-hook-guard.mjs';
      if (!fs.existsSync(path.join(target, guardRel))) {
        throw new Error('HOOK_GUARD_REL 相对项目根解析的 guard 不存在(安装布局漂移): ' + path.join(target, guardRel));
      }
      console.log('  HOOK_GUARD_REL guard 安装后存在(与安装产物绑定)✓');
      // ⑥ delegationDepth 代理身份分派（B1——dsh 子代理=执行者）：dsh 子代理 spawn
      //    provider 的 childSessionMeta 把 delegationDepth=parentDepth+1 写入子代理 session
      //    header —— 协调者=0/缺失，子代理>0。桥接层据此分派：子代理写源码=执行者职责
      //    （对应 CC worktree 物理隔离），协调者走 guard 白名单拦截。旧桥接对所有工具
      //    一视同仁送 guard → subagent 模式子代理写源码被 .specs/ 白名单误拦 = B1 根因。
      //    本断言锚定 agentDepth 纯函数（守 exec 结构读取语义——header.delegationDepth）。
      if (typeof bridge.agentDepth !== 'function') {
        throw new Error('bridge.agentDepth 未导出（B1 修复应新增代理身份读取纯函数）');
      }
      // ① 子代理（depth=1）→ 识别为执行者（返回 1）
      if (bridge.agentDepth({ agent: { session: { header: { delegationDepth: 1 } } } }) !== 1) {
        throw new Error('子代理 delegationDepth=1 应识别为执行者: ' + String(bridge.agentDepth({ agent: { session: { header: { delegationDepth: 1 } } } })));
      }
      // ② 深层子代理（depth=2）→ 识别为执行者
      if (bridge.agentDepth({ agent: { session: { header: { delegationDepth: 2 } } } }) !== 2) {
        throw new Error('子代理 delegationDepth=2 应识别为执行者');
      }
      // ③ 协调者（depth=0）→ 协调者（非执行者）
      if (bridge.agentDepth({ agent: { session: { header: { delegationDepth: 0 } } } }) !== 0) {
        throw new Error('协调者 delegationDepth=0 应返回 0');
      }
      // ④ 缺省（undefined/缺字段）→ 协调者（旧语义兼容——协调者 depth 缺失按 0）
      if (bridge.agentDepth({ agent: { session: { header: {} } } }) !== 0) {
        throw new Error('缺 delegationDepth 应按协调者处理(0)');
      }
      if (bridge.agentDepth({}) !== 0) {
        throw new Error('空 exec 应按协调者处理(0)');
      }
      if (bridge.agentDepth(undefined) !== 0) {
        throw new Error('undefined exec 应按协调者处理(0)');
      }
      // ⑤ 非数字/负数/非法值 → 0（fail-closed 协调者语义，防 NaN/字符串穿透）
      for (const bad of [null, '1', -1, NaN, Infinity, {}, 'abc']) {
        if (bridge.agentDepth({ agent: { session: { header: { delegationDepth: bad } } } }) !== 0) {
          throw new Error('非法 delegationDepth 应按协调者处理(0): ' + JSON.stringify(bad));
        }
      }
      console.log('  delegationDepth 代理身份分派(子代理=执行者/协调者原链)✓');
      // ⑦ apply 集成喂测（5.5 分派分支自动化回归——此前仅级 3 真实会话人工覆盖）：
      //   mock ctx 捕获 tools/pre-execute 监听器，构造 exec 断言插件级行为、
      //   子代理(agentDepth>0)写源码放行 / 协调者走 guard 白名单 / 越界·形状 deny 不受身份、
      //   非 flow-comet 项目窄监听放行。复用 ⑤ 安装产物(target 为真实 dsh flow-comet 项目)：
      //   写活跃 execute 态 state → 协调者写源码被真实 guard 子进程拦（BLOCK 链真实执行）。
      const applyEvents = {};
      bridge.apply({ on: (event, fn) => { applyEvents[event] = fn; } });
      const preExec = applyEvents['tools/pre-execute'];
      if (typeof preExec !== 'function') throw new Error('bridge.apply 应注册 tools/pre-execute 监听器');
      gitInit(target);
      fs.mkdirSync(path.join(target, 'src'), { recursive: true });
      writeState(target, {
        activeChange: 'apply-lock',
        currentNode: 'execute',
        completedNodes: [],
        evidence: {},
        verifyFailures: 0,
        status: 'running',
        executionMode: 'subagent',
        directOverride: false,
      });
      // 项目根常规用长形态（与桥接对 file_path 的规范化一致，对应真实会话规范 cwd）；
      // 短形态 cwd 的场景由桥接的项目根规范化修复，⑦f 断言锁死（fail-open 已封闭）。
      const longTarget = bridge.realpathExistingPath(target); // realpathSync.native——展开 8.3 短名
      // ⑦a 子代理（depth=1）写项目内源码 → next() 被调（跳过 guard 白名单放行）
      {
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: path.join(longTarget, 'src', 'a.mjs') }, agent: { cwd: longTarget, session: { header: { delegationDepth: 1 } } } },
          () => { usedNext = true; },
        );
        if (!usedNext) throw new Error('子代理写源码应放行(next 被调)——5.5 分派分支缺失');
        if (res) throw new Error('子代理写源码不应返回 deny: ' + JSON.stringify(res));
      }
      // ⑦b 协调者（delegationDepth 缺失=0）同目标写 → 走真实 guard 白名单 → BLOCK deny
      {
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: path.join(longTarget, 'src', 'a.mjs') }, agent: { cwd: longTarget, session: { header: {} } } },
          () => { usedNext = true; },
        );
        if (usedNext) throw new Error('协调者写源码不应 next——协调者禁令物理拦截保留');
        if (!res || res.kind !== 'deny') throw new Error('协调者写源码应走 guard 白名单拦截(deny): ' + JSON.stringify(res));
        if (!res.reason.includes('白名单拦截')) throw new Error('协调者 deny 应含白名单拦截语义: ' + JSON.stringify(res));
      }
      // ⑦c 非 flow-comet 项目(无 .dsh/skills/flow-comet) → 窄监听放行(不分身份)
      {
        const plain = path.join(dir, 'k11-plain');
        fs.mkdirSync(plain, { recursive: true });
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: path.join(plain, 'x.md') }, agent: { cwd: plain, session: { header: { delegationDepth: 1 } } } },
          () => { usedNext = true; },
        );
        if (!usedNext) throw new Error('非 flow-comet 项目应窄监听放行(next)');
      }
      // ⑦d 越界写不受身份影响：子代理(depth=1)写项目根外 → 包含性 fail-closed deny
      {
        const outside = path.join(dir, 'k11-out2');
        fs.mkdirSync(outside, { recursive: true });
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: path.join(outside, 'evil.md') }, agent: { cwd: longTarget, session: { header: { delegationDepth: 1 } } } },
          () => { usedNext = true; },
        );
        if (usedNext) throw new Error('子代理越界写不应 next——包含性不因身份放宽');
        if (!res || res.kind !== 'deny' || !res.reason.includes('不在项目根')) {
          throw new Error('子代理越界写应 fail-closed deny(含越界语义): ' + JSON.stringify(res));
        }
      }
      // ⑦e 形状不符不受身份影响：子代理(depth=1)参数形状不符 → fail-closed deny
      {
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: {}, agent: { cwd: longTarget, session: { header: { delegationDepth: 1 } } } },
          () => { usedNext = true; },
        );
        if (usedNext) throw new Error('子代理形状不符不应 next——形状校验不因身份放宽');
        if (!res || res.kind !== 'deny' || !res.reason.includes('参数形状不符')) {
          throw new Error('子代理形状不符应 fail-closed deny(含形状语义): ' + JSON.stringify(res));
        }
      }
      // ⑦f 短形态项目根不得 fail-open：会话 cwd 为 8.3 短路径时，桥接须把项目根
      //    归一化为长形态再送 guard——否则 guard 词法 path.relative 得 target=null
      //    跳过白名单（协调者写源码被放行）。本断言在短形态 TMP 机器上即回归锁死。
      {
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: path.join(target, 'src', 'b.mjs') }, agent: { cwd: target, session: { header: {} } } },
          () => { usedNext = true; },
        );
        if (usedNext) throw new Error('短形态 cwd 协调者写源码不应 next——8.3 短路径不得绕过白名单(fail-open 已封闭)');
        if (!res || res.kind !== 'deny' || !res.reason.includes('白名单拦截')) {
          throw new Error('短形态 cwd 协调者写源码应走 guard 白名单拦截(deny): ' + JSON.stringify(res));
        }
      }
      console.log('  bridge.apply 分派集成(子代理放行/协调者拦/越界·形状 deny 不受身份)✓');
    },
  },

  // K12: 桥接 loader 流程态门断言（B 方案 TDD RED 载体——空闲/异常态行为面，与 K11 运行态分开）：
  //   AC-1 无 state 文件 / AC-2 activeChange 缺失 / AC-3 status completed → 项目外 Write 应
  //   next() 放行（空闲放行语义由流程态门实现）；AC-7 非法 JSON / AC-8 未知 status →
  //   fail-closed deny（reason 含拒绝语义；解析失败/未知状态不得当空闲放行）。
  //   复用 K11 安装产物形态：target 为真实 dsh flow-comet 项目（.dsh/skills/flow-comet 就位，
  //   窄监听不跳过——保证当前实现走到包含性 deny 而非被窄监听放行）；mock exec 取协调者身份
  //   （delegationDepth 缺失=0，与 K11 ⑦b 同语义）。import 用 ?query 缓存破除——K11 已在本进程
  //   apply 过，模块级幂等标记会让二次 apply 跳过（applied=true），必须全新模块实例才能捕获监听器。
  {
    name: 'K12 桥接 loader:流程态门断言(无state/无activeChange/completed放行·非法JSON/未知status deny)',
    run: async (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      const loader = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const bridge = await import(pathToFileURL(loader).href + '?k12=' + Date.now()); // 全新模块实例(applied=false)
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const dshHome = path.join(dir, 'k12-dsh-home');
      const target = path.join(dir, 'k12-target');
      fs.mkdirSync(target, { recursive: true });
      const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      if (res.status !== 0) throw new Error('dsh 安装失败: ' + (res.stderr || JSON.stringify(res.output)));
      // 窄监听不跳过前置：目标项目必须真的装有 .dsh/skills/flow-comet——否则当前实现会因窄监听
      // 直接 next()，空闲态断言假绿，RED 失真
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) {
        throw new Error('dsh flow-comet 项目安装缺失(.dsh/skills/flow-comet/SKILL.md 不存在)');
      }
      gitInit(target);
      const longTarget = bridge.realpathExistingPath(target); // 8.3 短形态归一为长形态(与 K11 一致)
      const outside = path.join(dir, 'k12-out');
      fs.mkdirSync(outside, { recursive: true });
      // 项目外 Write（协调者身份——delegationDepth 缺失=0）
      const mkOutsideWrite = () => ({
        name: 'Write',
        arguments: { file_path: path.join(outside, 'idle-leak.md') },
        agent: { cwd: longTarget, session: { header: {} } },
      });
      const ctxEvents = {};
      bridge.apply({ on: (event, fn) => { ctxEvents[event] = fn; } });
      const preExec = ctxEvents['tools/pre-execute'];
      if (typeof preExec !== 'function') throw new Error('bridge.apply 应注册 tools/pre-execute 监听器');
      const statePath = path.join(target, '.comet', 'flow-comet-state.json');
      // AC-1 无 state：无 .comet/flow-comet-state.json + 项目外 Write → next() 放行（空闲放行已生效）
      {
        if (fs.existsSync(statePath)) throw new Error('AC-1 前置:目标项目不应有 state 文件');
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (!usedNext) throw new Error('AC-1 无 state 应放行(next 被调): ' + JSON.stringify(r));
        if (r) throw new Error('AC-1 无 state 不应返回 deny: ' + JSON.stringify(r));
      }
      // AC-2 无 activeChange：writeState { activeChange:null, status:'running' } + 项目外 Write → next()（空闲放行已生效）
      {
        writeState(target, { activeChange: null, status: 'running' });
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (!usedNext) throw new Error('AC-2 activeChange 为空应放行(next 被调): ' + JSON.stringify(r));
        if (r) throw new Error('AC-2 无 activeChange 不应返回 deny: ' + JSON.stringify(r));
      }
      // AC-3 completed：writeState { activeChange:'x', status:'completed' } + 项目外 Write → next()（空闲放行已生效）
      {
        writeState(target, { activeChange: 'x', status: 'completed' });
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (!usedNext) throw new Error('AC-3 status completed 应放行(next 被调): ' + JSON.stringify(r));
        if (r) throw new Error('AC-3 completed 不应返回 deny: ' + JSON.stringify(r));
      }
      // AC-7 解析失败：state 写成非法 JSON + 项目外 Write → deny（reason 含 fail-closed 拒绝语义；
      //   当前无条件 deny 已通过、T02 流程态门落地后必须保持 deny，不得当空闲放行）
      {
        writeFile(target, '.comet/flow-comet-state.json', '{ not-valid-json ');
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (usedNext) throw new Error('AC-7 非法 JSON 不应 next——解析失败必须 fail-closed deny');
        if (!r || r.kind !== 'deny') throw new Error('AC-7 非法 JSON 应 deny: ' + JSON.stringify(r));
        if (!r.reason.includes('拒绝')) throw new Error('AC-7 deny 应含 fail-closed(拒绝)语义: ' + JSON.stringify(r.reason));
      }
      // AC-8 未知 status：writeState { activeChange:'x', status:'weird' } + 项目外 Write → deny
      //   （当前通过、T02 流程态门落地后必须保持 deny，不得当空闲放行）
      {
        writeState(target, { activeChange: 'x', status: 'weird' });
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (usedNext) throw new Error('AC-8 未知 status 不应 next——未知 status 必须 fail-closed deny');
        if (!r || r.kind !== 'deny') throw new Error('AC-8 未知 status 应 deny: ' + JSON.stringify(r));
        if (!r.reason.includes('拒绝')) throw new Error('AC-8 deny 应含 fail-closed(拒绝)语义: ' + JSON.stringify(r.reason));
      }
      // AC-7b 非对象 JSON（null/标量/数组/字符串）：合法 JSON 但非对象 = 损坏 state → deny（fail-closed）
      for (const bad of [null, 123, ['x'], 'str']) {
        writeFile(target, '.comet/flow-comet-state.json', JSON.stringify(bad));
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (usedNext) throw new Error('AC-7b 非对象 state(' + JSON.stringify(bad) + ') 不应 next——必须 fail-closed deny');
        if (!r || r.kind !== 'deny') throw new Error('AC-7b 非对象 state 应 deny: ' + JSON.stringify(r));
        if (!r.reason.includes('拒绝')) throw new Error('AC-7b deny 应含 fail-closed(拒绝)语义: ' + JSON.stringify(r.reason));
      }
      // AC-3b BOM 前缀 + completed：BOM 容错断言——应被解析并视为空闲放行
      {
        writeFile(target, '.comet/flow-comet-state.json', '\uFEFF' + JSON.stringify({ activeChange: 'x', status: 'completed' }));
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (!usedNext) throw new Error('AC-3b BOM+completed 应放行(next 被调)——BOM 容错: ' + JSON.stringify(r));
        if (r) throw new Error('AC-3b BOM+completed 不应返回 deny: ' + JSON.stringify(r));
      }
      console.log('  流程态门断言:AC-1/2/3 空闲放行·AC-3b BOM 容错·AC-7/8/7b 异常态 fail-closed deny✓');
    },
  },

  // hook 注入形态无关断言 + 旧条目幂等升级(AC-5/AC-7;安装产物根引用特征用例 + 升级替换用例)——
  // 安装产物托管条目满足「脚本 basename 在位 + 项目根引用特征(CLAUDE_PROJECT_DIR 或绝对路径)
  // 二选一」;新旧托管形态识别兼容(basename 同源 isManagedHookCommand 语义);把托管命令改回
  // 旧相对路径形态后重跑安装器 → 被识别替换(恰余 1 条,不重复不残留)且新条目形态达标。
  // 断言不锁定 %VAR% 引号/变量词形——注入命令实测微调不再破坏套件。
  {
    name: 'K13 安装器:hook 注入形态无关断言(basename+项目根引用)+旧条目幂等升级',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      // ① 形态分类器:新旧托管形态均被 basename 识别;项目根引用特征仅根引用形态命中
      for (const legacy of [
        'node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs',
        'node .agents/skills/flow-comet/scripts/comet-hook-guard.mjs before_tool --platform codex',
      ]) {
        if (!isManagedHookCommand(legacy)) throw new Error('旧托管形态应被 basename 识别(幂等升级识别面): ' + legacy);
        if (hasProjectRootRef(legacy)) throw new Error('旧相对路径形态不应命中项目根引用特征: ' + legacy);
      }
      for (const modern of [
        'node "%CLAUDE_PROJECT_DIR%/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs"',
        'node "$env:CLAUDE_PROJECT_DIR/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs"',
        'node "${CLAUDE_PROJECT_DIR}/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs"',
      ]) {
        assertManagedHookEntry(modern, '变量引用形态');
      }
      assertManagedHookEntry(path.join(dir, 'k13-abs', '.claude', 'skills', 'flow-comet', 'scripts', 'comet-hook-guard.mjs'), '绝对路径形态');
      // ② claude-code 安装产物:托管条目在场且指向本项目脚本(项目根引用特征在位)
      const ccTarget = path.join(dir, 'k13-cc');
      fs.mkdirSync(ccTarget, { recursive: true });
      const rcc = spawnSync(process.execPath, [installer, '--target', ccTarget, '--platform', 'claude-code'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (rcc.status !== 0) throw new Error('claude-code 安装失败: ' + (rcc.stderr || JSON.stringify(rcc.output)));
      const ccSettingsPath = path.join(ccTarget, '.claude', 'settings.local.json');
      const ccSettings = JSON.parse(fs.readFileSync(ccSettingsPath, 'utf8'));
      const ccManaged = collectManagedHookCommands(ccSettings);
      if (ccManaged.length === 0) throw new Error('.claude/settings.local.json 未注入托管 hook 条目');
      for (const c of ccManaged) assertManagedHookEntry(c, 'claude-code 托管命令');
      // ③ 幂等升级(claude-code):托管命令改回旧相对路径形态 → 重跑安装器 → 识别替换:
      // 恰余 1 条托管条目(无重复无残留)且形态达标(项目根引用特征在位)
      for (const g of ccSettings.hooks.PreToolUse) {
        for (const h of (Array.isArray(g.hooks) ? g.hooks : [])) {
          if (isManagedHookCommand(h.command)) h.command = 'node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs';
        }
      }
      fs.writeFileSync(ccSettingsPath, JSON.stringify(ccSettings, null, 2) + '\n', 'utf8');
      const rccUp = spawnSync(process.execPath, [installer, '--target', ccTarget, '--platform', 'claude-code'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (rccUp.status !== 0) throw new Error('claude-code 升级重装失败: ' + (rccUp.stderr || JSON.stringify(rccUp.output)));
      const ccAfter = collectManagedHookCommands(JSON.parse(fs.readFileSync(ccSettingsPath, 'utf8')));
      if (ccAfter.length !== 1) throw new Error('claude-code 升级后应恰余 1 条托管条目(旧条目被替换): ' + JSON.stringify(ccAfter));
      assertManagedHookEntry(ccAfter[0], 'claude-code 升级后托管命令');
      // ④ codex 平台同断言:安装产物形态达标 + 旧条目幂等升级
      const cxTarget = path.join(dir, 'k13-codex');
      fs.mkdirSync(cxTarget, { recursive: true });
      const rcx = spawnSync(process.execPath, [installer, '--target', cxTarget, '--platform', 'codex'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (rcx.status !== 0) throw new Error('codex 安装失败: ' + (rcx.stderr || JSON.stringify(rcx.output)));
      const cxHooksPath = path.join(cxTarget, '.codex', 'hooks.json');
      const cxHooks = JSON.parse(fs.readFileSync(cxHooksPath, 'utf8'));
      const cxManaged = collectManagedHookCommands(cxHooks);
      if (cxManaged.length === 0) throw new Error('.codex/hooks.json 未注入托管 hook 条目');
      for (const c of cxManaged) assertManagedHookEntry(c, 'codex 托管命令');
      for (const g of cxHooks.hooks.PreToolUse) {
        for (const h of (Array.isArray(g.hooks) ? g.hooks : [])) {
          if (isManagedHookCommand(h.command)) h.command = 'node .agents/skills/flow-comet/scripts/comet-hook-guard.mjs before_tool --platform codex';
        }
      }
      fs.writeFileSync(cxHooksPath, JSON.stringify(cxHooks, null, 2) + '\n', 'utf8');
      const rcxUp = spawnSync(process.execPath, [installer, '--target', cxTarget, '--platform', 'codex'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (rcxUp.status !== 0) throw new Error('codex 升级重装失败: ' + (rcxUp.stderr || JSON.stringify(rcxUp.output)));
      const cxAfter = collectManagedHookCommands(JSON.parse(fs.readFileSync(cxHooksPath, 'utf8')));
      if (cxAfter.length !== 1) throw new Error('codex 升级后应恰余 1 条托管条目(旧条目被替换): ' + JSON.stringify(cxAfter));
      assertManagedHookEntry(cxAfter[0], 'codex 升级后托管命令');
      console.log('  hook 注入形态无关断言(basename+项目根引用特征)+ 新旧幂等升级 ✓');
    },
  },

  // K14~K16: 桥接 loader 版本戳重装断言（安装器覆盖前版本比对明示的系统级锚定）——
  // 临时 DSH_HOME 预置不同版本戳 loader，真实安装器重装断言方向措辞（升级/降级/版本一致）、
  // 覆盖后磁盘为源新戳、同源重装收敛、purge 清除重建后路径回归。
  {
    name: 'K14 桥接 loader:版本戳重装断言(升级/降级方向与覆盖后新戳)',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const loader = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const srcVersion = readBridgeSourceVersion(loader);
      // 旧戳 = 低于源版本（升级方向）；新戳 = 数值序高于源版本（降级方向——字典序会误判为升级，
      // 断言「降级」即数值序比较语义的系统级护栏；与实现侧冒烟同口径）
      const OLD_STAMP = '1.5.0';
      const NEWER_STAMP = '1.10.0';
      const dshHome = path.join(dir, 'k14-dsh-home');
      const target = path.join(dir, 'k14-target');
      fs.mkdirSync(target, { recursive: true });
      seedForeignFlowKit(target);
      const pluginPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
      const runInstall = () => {
        const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
          cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
        });
        // 统一包装为 { status, output }（与 runState 等助手同形态——assertOut 期望字符串 output）
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      // ① 已装旧戳 loader → 重装输出「升级 A → B」逐字措辞 + 覆盖后磁盘为源新戳
      fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
      fs.writeFileSync(pluginPath, stampBridgeLoader(loader, OLD_STAMP), 'utf8');
      const upgrade = runInstall();
      assertExit(upgrade, 0);
      assertOut(upgrade, '桥接 loader 升级 ' + OLD_STAMP + ' → ' + srcVersion);
      if (!fs.readFileSync(pluginPath, 'utf8').includes('// BRIDGE_VERSION: ' + srcVersion)) {
        throw new Error('升级重装后已装 loader 应被覆盖为源新戳');
      }
      // ② 已装新戳 loader（数值序高于源）→ 重装输出「降级 A → B」+ 覆盖后仍为源戳
      fs.writeFileSync(pluginPath, stampBridgeLoader(loader, NEWER_STAMP), 'utf8');
      const downgrade = runInstall();
      assertExit(downgrade, 0);
      assertOut(downgrade, '桥接 loader 降级 ' + NEWER_STAMP + ' → ' + srcVersion);
      if (!fs.readFileSync(pluginPath, 'utf8').includes('// BRIDGE_VERSION: ' + srcVersion)) {
        throw new Error('降级重装后已装 loader 应为源戳');
      }
      console.log('  版本戳重装断言:升级/降级方向措辞与覆盖后新戳 ✓');
    },
  },

  {
    name: 'K15 桥接 loader:同源重装断言(首次安装后版本一致)',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const loader = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const srcVersion = readBridgeSourceVersion(loader);
      const dshHome = path.join(dir, 'k15-dsh-home');
      const target = path.join(dir, 'k15-target');
      fs.mkdirSync(target, { recursive: true });
      seedForeignFlowKit(target);
      const pluginPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
      const runInstall = () => {
        const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
          cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
        });
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      // ① 无已装 loader → 首次安装措辞（比对的空态前提）
      const first = runInstall();
      assertExit(first, 0);
      assertOut(first, '桥接 loader 首次安装');
      if (!fs.existsSync(pluginPath)) throw new Error('首次安装后 loader 应就位');
      // ② 同源重装（已装 = 源版本）→ 「版本一致（A）」逐字措辞 + 磁盘保持源戳
      const re = runInstall();
      assertExit(re, 0);
      assertOut(re, '桥接 loader 版本一致（' + srcVersion + '）');
      if (!fs.readFileSync(pluginPath, 'utf8').includes('// BRIDGE_VERSION: ' + srcVersion)) {
        throw new Error('同源重装后 loader 应保持源戳');
      }
      console.log('  同源重装断言:首次安装 → 版本一致收敛 ✓');
    },
  },

  {
    name: 'K16 桥接 loader:purge 后重建路径回归(loader 恢复与再装收敛)',
    run: (dir) => {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.comet', 'bundle-drafts'))) return; // 安装副本无权威源
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const loader = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const srcVersion = readBridgeSourceVersion(loader);
      const dshHome = path.join(dir, 'k16-dsh-home');
      const target = path.join(dir, 'k16-target');
      fs.mkdirSync(target, { recursive: true });
      seedForeignFlowKit(target);
      const pluginPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
      const patchPath = path.join(dshHome, 'cordis.patch.yml');
      const runInstall = (extra) => {
        const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh', ...(extra || [])], {
          cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
        });
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      // ① 首次安装：loader 与 cordis.patch.yml 托管块就位
      const first = runInstall();
      assertExit(first, 0);
      if (!fs.existsSync(pluginPath)) throw new Error('首次安装后 loader 应就位');
      if (!fs.existsSync(patchPath)) throw new Error('首次安装后 cordis.patch.yml 应就位');
      // ② purge --yes：dsh 平台生成物清除后删除并重建——loader/托管块恢复为源形态
      const purgeRes = runInstall(['--purge', '--yes']);
      assertExit(purgeRes, 0);
      if (!fs.existsSync(pluginPath)) throw new Error('purge 后 loader 应重建恢复');
      if (!fs.readFileSync(pluginPath, 'utf8').includes('// BRIDGE_VERSION: ' + srcVersion)) {
        throw new Error('purge 后 loader 应为源戳');
      }
      if (!fs.existsSync(patchPath)) throw new Error('purge 后 cordis.patch.yml 托管块应重建');
      // ③ 清除后再重装：成功且「版本一致」收敛（重建成果可复装、版本比对路径回归）
      const re = runInstall();
      assertExit(re, 0);
      assertOut(re, '桥接 loader 版本一致（' + srcVersion + '）');
      if (!fs.readFileSync(pluginPath, 'utf8').includes('// BRIDGE_VERSION: ' + srcVersion)) {
        throw new Error('purge 后再装后 loader 应为源戳');
      }
      console.log('  purge 后重建路径回归:loader/托管块恢复 + 再装版本一致收敛 ✓');
    },
  },

  // ---------- L. 执行遗漏防护（M1~M8 真实链路） ----------

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

// ---------- 运行 ----------

for (const item of TEST_ITEMS) {
  const dir = makeTmp();
  try {
    await item.run(dir);
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
