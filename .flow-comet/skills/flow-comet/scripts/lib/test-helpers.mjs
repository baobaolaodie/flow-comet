// test-helpers.mjs — 两个测试套件共享的工具与夹具（单一来源）
//
// 定位：guard-self-test.mjs（引擎场景回归）与 system-test.mjs（系统级命令序列）此前各自
// 内置了同名同责的一批工具。同一能力两份实现必然分叉——注释互指「同源」不是同步机制，
// 故收敛为本模块，两个套件 import 之、本地副本删除。
// 本模块只放纯工具与夹具，**不含判据**：什么算通过 / 什么算残留，留在各套件自己的判据模块里。
//
// 分叉处的合并口径（两套件实现不同时取行为并集）：
//   · assertOut / assertNotOut：先经 outputText 归一，兼容原始 spawn 结果的数组形态
//     （`res.output` 恒为 `[null, stdout, stderr]`，逐元素比较永不中关键字）与 run* 助手
//     产出的字符串形态；
//   · runState：默认注入协议副本环境变量，且 envOverrides 最后展开——调用方传
//     `{ FLOW_COMET_PROTOCOL: '' }` 即可回到「无环境变量」形态；
//   · makeTmp：目录前缀、协议副本预置、创建登记三处参数化（见该函数注释）。
//
// 路径推导：本模块自身位于 `<技能包>/scripts/lib/`，兄弟脚本与内置协议副本一律以
// import.meta.url 为基准相对推导——主仓与各安装副本（.claude / .agents / .dsh）的相对结构
// 一致，故既不依赖调用方 cwd，也不需要每个调用面各自拼一遍路径（那会成为第二份推导）。

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '..');
const GUARD = path.join(SCRIPTS_DIR, 'workflow-guard.mjs');
const STATE = path.join(SCRIPTS_DIR, 'workflow-state.mjs');
const HOOK = path.join(SCRIPTS_DIR, 'comet-hook-guard.mjs');
const HANDOFF = path.join(SCRIPTS_DIR, 'workflow-handoff.mjs');
// 内置协议源文件（技能包 reference/）：协议读取走受保护路径，要求协议文件位于 runRoot 内，
// 故夹具根需要一份场景内副本（run* 助手默认指向它）。
const BUILTIN_PROTOCOL_SOURCE = path.join(SCRIPTS_DIR, '..', 'reference', 'workflow-protocol.json');
// 夹具 change id（baseState 的 activeChange；两套件的夹具约定同值）
const CHANGE_ID = 'ch';

// 夹具根内的协议副本路径——本模块内的**唯一表达式**，makeTmp 预置与 run* 注入共用，
// 避免同一相对路径在模块内出现第二处写法。
function scenarioProtocolPath(dir) {
  return path.join(dir, 'reference', 'workflow-protocol.json');
}

// ---------- 临时目录夹具 ----------

// 独立临时目录（夹具根）。选项：
//   · prefix：目录名前缀。两套件各传自己的前缀，残留目录便于辨认来源。
//   · protocol：true 时把内置协议副本预置到 <dir>/reference/。系统级套件的每个夹具根都要
//     能当项目根用（run* 默认指向该副本），引擎场景套件只在场景根预置，故默认不预置。
//   · register：调用方的登记数组——创建出的目录 push 进去，供套件收尾的「临时目录残留」
//     判据统一报告（该判据在套件侧；本函数不返回清理状态，也不据它分支）。
export function makeTmp(options = {}) {
  const { prefix = 'flow-comet-test-', protocol = false, register } = options;
  // 登记契约 fail-closed：传了非数组会静默漏登记，套件收尾的「临时目录残留」判据随之空转
  // （目录照漏、读数仍绿）——这种失败必须当场可见，不能留到事后比对目录。
  if (register !== undefined && !Array.isArray(register)) {
    throw new TypeError('makeTmp 的 register 选项须为登记数组，实际为 ' + typeof register);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  if (register !== undefined) register.push(dir);
  if (protocol) {
    const builtinCopy = scenarioProtocolPath(dir);
    fs.mkdirSync(path.dirname(builtinCopy), { recursive: true });
    fs.copyFileSync(BUILTIN_PROTOCOL_SOURCE, builtinCopy);
  }
  return dir;
}

// 夹具清理（Windows 韧性）：子进程退出后其 cwd / 文件句柄可能仍被短暂占用，`rmSync` 会抛
// EPERM/EBUSY；`maxRetries`/`retryDelay` 正是为该窗口设计（对 EBUSY / EMFILE / ENFILE /
// ENOTEMPTY / EPERM 线性退避重试）。**清不掉不得让整轮崩溃**——裸放在 finally 里会让后续
// 用例与收尾判据全都不执行；故此处容忍失败，残留交由套件收尾判据可见报告（不静默、也不自杀）。
const CLEANUP_RETRIES = 10;
const CLEANUP_RETRY_DELAY_MS = 150;
export function cleanupTmpDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: CLEANUP_RETRIES, retryDelay: CLEANUP_RETRY_DELAY_MS });
  } catch {
    // 交由套件收尾的「临时目录清理」判据报告
  }
}

// ---------- 工件写入 ----------

export function writeFile(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

export function writeState(root, state) {
  writeFile(root, path.posix.join('.flow-comet', 'flow-comet-state.json'), JSON.stringify(state, null, 2) + '\n');
}

// ---------- 受控命令（runRoot = 夹具根） ----------
// 约定：spawn 时 cwd = 夹具根（workflow-state / workflow-handoff 的 runRoot 取进程 cwd），
// 并注入 FLOW_COMET_RUN_ROOT 环境变量；同时捕获 stdout + stderr（WARN/BLOCKED 走 stderr，
// 成功退出时只取 stdout 会让 WARN 断言误报）与 exit code，统一返回
// `{ status, output }`（output 为 stdout+stderr 拼接的字符串）。
// 统一超时（毫秒）：真实命令在冷启动 / 慢文件系统上耗时波动，60s 是两套件既有取值。
const COMMAND_TIMEOUT_MS = 60000;

// 跑 workflow-guard.mjs。envOverrides 可覆盖 FLOW_COMET_PROTOCOL（自定义协议场景；
// --protocol CLI 优先级高于 env）。
export function runGuard(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: root,
    env: {
      ...process.env,
      FLOW_COMET_RUN_ROOT: root,
      FLOW_COMET_PROTOCOL: scenarioProtocolPath(root),
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 workflow-state.mjs。协议副本是默认注入面（依赖协议解析的门禁不得静默跳过）；
// envOverrides 最后展开，故可覆盖回无环境变量的形态。
export function runState(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [STATE, ...args], {
    cwd: root,
    env: {
      ...process.env,
      FLOW_COMET_RUN_ROOT: root,
      FLOW_COMET_PROTOCOL: scenarioProtocolPath(root),
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 workflow-handoff.mjs：夹具用 cwd=夹具根 + 伪造 state 直接驱动命令，不经 guard exit。
export function runHandoff(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [HANDOFF, ...args], {
    cwd: root,
    env: { ...process.env, FLOW_COMET_RUN_ROOT: root, ...envOverrides },
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 comet-hook-guard.mjs：PreToolUse 事件从 stdin 传 JSON（{ tool_name, tool_input: { file_path } }）；
// hook 不支持 --protocol CLI，协议路径只能走 FLOW_COMET_PROTOCOL env。
export function runHook(args, root, input, envOverrides = {}) {
  const res = spawnSync(process.execPath, [HOOK, ...args], {
    cwd: root,
    input: input === undefined ? '' : JSON.stringify(input),
    env: {
      ...process.env,
      FLOW_COMET_RUN_ROOT: root,
      FLOW_COMET_PROTOCOL: scenarioProtocolPath(root),
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// ---------- 断言助手 ----------

export function assertExit(res, expected) {
  if (res.status !== expected) {
    throw new Error('期望 exit ' + expected + '，实际 exit ' + res.status + '\n实际输出:\n' + res.output);
  }
}

// 输出字符串归一化：spawnSync 原始结果的 .output 恒为数组 [null, stdout, stderr]
// （.includes 逐元素比较永不中关键字）；run* 助手已归一化为字符串。两种形态都归一后再
// 断言，保证本模块的断言对「数组（stdout+stderr 拼接）」与「字符串」两种形态都成立。
function outputText(res) {
  return Array.isArray(res?.output)
    ? String(res.stdout || '') + String(res.stderr || '')
    : String(res?.output || '');
}

export function assertOut(res, keyword) {
  const text = outputText(res);
  if (!text.includes(keyword)) {
    throw new Error('输出缺少关键词 ' + JSON.stringify(keyword) + '（exit ' + res.status + '）\n实际输出:\n' + text);
  }
}

export function assertNotOut(res, keyword) {
  const text = outputText(res);
  if (text.includes(keyword)) {
    throw new Error('输出不应包含关键词 ' + JSON.stringify(keyword) + '（exit ' + res.status + '）\n实际输出:\n' + text);
  }
}

export function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + '：期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
}

// ---------- 伪造材料 ----------

// 最小合法 state（夹具起点）：字段与状态校验器的类型要求同形；node 为当前节点。
export function baseState(node) {
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
