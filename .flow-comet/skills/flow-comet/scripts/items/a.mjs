// items/a.mjs — A 组条目（状态机与路由）与跨组共用的夹具
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 组内夹具与条目同址；本文件同时承载跨组共用的夹具，其它组文件按需 import 本文件（组文件之间单向，无环）。

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { assertEqual, assertExit, assertNotOut, assertOut, assertTrue, baseState, runGuard, runHandoff, runState, writeFile, writeState } from '../lib/test-helpers.mjs';

// 路径推导基准：技能包 scripts/ 目录（与套件入口同基准）
const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CHANGE_ID = 'ch';

// 读取 state 文件（测试断言用）
export function readStateFile(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
}

// 读取 state 原始字节（「字节零改写」断言用——不解析，直接逐字节比较）
export function readStateBytes(root) {
  return fs.readFileSync(path.join(root, '.flow-comet', 'flow-comet-state.json'));
}

// git 工具：临时目录内初始化仓库（含初始 commit——unborn HEAD 下 init 不会建分支）
export function gitInit(root) {
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: root, stdio: 'ignore' });
}

export function gitBranch(root) {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}


// open 阶段工件（CHANGE 含 Why；REQUIREMENT 含 用户故事 + 验收准则——通过出口校验的完整形态）
export function writeIntakeArtifacts(root, changeId = CHANGE_ID) {
  writeFile(root, '.specs/' + changeId + '/CHANGE.md', '# CHANGE\n\n- **Change ID**: ' + changeId + '\n\n## Why（为什么做）\n\n变更目标。\n');
  writeFile(root, '.specs/' + changeId + '/REQUIREMENT.md', '# REQUIREMENT\n\n- **Change ID**: ' + changeId + '\n\n## 用户故事（User Story）\n\n用户需求。\n\n## 验收准则（AC）\n\n- 通过标准\n');
}

// 自定义协议（compose-demo）：3 节点 brainstorm/tdd/codereview（避开内置 8 节点 id）——
// 协议数据化路由 + 通用层防线对自定义节点生效；无 writeWhitelist（hook 回退内置缺省表）

// handoff 完整 Return Contract（W1-D 严格校验通过形态：commitHash + greenEvidence + completedChecks）
export function fullContract(commitHash, taskId) {
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

// 多趟链路 SUMMARY 夹具（SUMMARY 模板保真全量满足：标题首行 # SUMMARY: + 首部 4 字段 +
// 段序 做了什么→改动文件→verify 输出→6 维自查→越界检查→自检方法；6 维声明 brooks-review）
export function execSummaryFixture(taskId) {
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

// 同夹具的「段内大写 Z 早于方法名」变体（真实机检标记形态）：6 维自查段体首行是含大写 Z 的机检
// 标记说明，方法声明行在其后。段尾判定若把大写 Z 当串尾（惰性段体在段内首个 Z 处提前收尾），
// 方法声明被截掉 ⇒ execute 家族出口误判「6 维自查未声明自检方法」而 BLOCK。
// 夹具前提不成立（段标题形态变化）即抛错——不让变体静默退化成与基线逐字节相同的形态。

// ---------- 修复回路真实命令链路夹具（A21~A23 共用） ----------

// 串行任务块（字段齐备：可过 task-parsing 解析与 guard 结构校验）
function serialTaskBlock(id, status) {
  return '<task id="' + id + '" parallel="false" status="' + status + '">' +
    '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
    '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify></task>';
}

// Fix 批次任务集：既有任务 T01 done +「Fix 任务」段追加修复任务（追加纪律与节点技能一致）
export function fixBatchTaskText(fixStatus) {
  return '# TASK\n\n## 任务清单\n\n' + serialTaskBlock('T01', 'done') +
    '\n\n## Fix 任务（来自 REVIEW / INTEGRATION）\n\n' + serialTaskBlock('T-FIX-01', fixStatus) + '\n';
}

// 并行 Fix 任务集（无依赖 → 可委托）：既有任务 T01 done + parallel 修复任务（状态由参数指定）。
function fixBatchParallelTaskText(fixStatus) {
  return '# TASK\n\n## 任务清单\n\n' + serialTaskBlock('T01', 'done') +
    '\n\n## Fix 任务（来自 REVIEW / INTEGRATION）\n\n'
    + '<task id="P-FIX-01" parallel="true" status="' + fixStatus + '">'
    + '<action>实现 P-FIX-01</action><write_files>src/p-fix-01.mjs</write_files>'
    + '<verify>node --check src/p-fix-01.mjs</verify></task>\n';
}

// 两波修复任务集（多波次真实 Fix 链路夹具）：既有任务 T01 done + Fix 段内两个修复任务，
// 两个修复任务的状态由入参分别指定——第一波收口后追加第二波，任务集签名随之发散。
function fixBatchTwoFixTaskText(fixStatus1, fixStatus2) {
  return '# TASK\n\n## 任务清单\n\n' + serialTaskBlock('T01', 'done') +
    '\n\n## Fix 任务（来自 REVIEW / INTEGRATION）\n\n' +
    serialTaskBlock('T-FIX-01', fixStatus1) + '\n' + serialTaskBlock('T-FIX-02', fixStatus2) + '\n';
}

// 审查文档：disposed=false 时发现条目缺处置标记（钉住 review 出口的真实校验与恢复）
export function fixBatchReviewDoc(disposed) {
  const finding = disposed
    ? '- **状态机路径未闭环** —— 已追加修复任务并回修。[已修]'
    : '- **状态机路径未闭环** —— 已追加修复任务，处置标记待补。';
  return '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n' + finding +
    '\n\n### Minor\n\n- 无\n\n## 结论\n\nFix 批次在 execute 生命周期内完成后回源节点重新跑出口。\n';
}

// done-but-unclosed 回放夹具：history 最新 exit-applied execute 记录的任务集
// 签名仍是追加修复任务之前的占位值（与当前「既有任务 + 追加修复任务」任务集签名必然不等）——
// 机器信号 =「修复任务已 done，但本批 execute 出口从未重新通过」。判据只比较是否相等，占位常量
// 与哈希实现解耦；旧 state 无该字段 → 渐进放行。
const STALE_TASK_SET_SIGNATURE = '0'.repeat(64);
function fixBatchHistoryWithStaleExecuteExit() {
  return [{ event: 'exit-applied', node: 'execute', at: '2026-09-20T00:00:00.000Z', taskSetSignature: STALE_TASK_SET_SIGNATURE }];
}

// Fix 批次夹具写入：state + TASK + 既有任务 SUMMARY + REVIEW.md（verify 源另备 TEST/UAT）。
// kind='review'（审查驻留，execute 已首次完成）/ 'verify'（验证驻留，review 已完成）；
// newChange=false 时 state 不带新 change 标记（旧 change 渐进形态）。
function writeFixBatchFixture(dir, { kind, fixStatus, newChange = true, parallelFix = false }) {
  const completed = kind === 'verify'
    ? ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review']
    : ['open', 'design', 'plan', 'execute', 'subagent-execute'];
  const state = {
    activeChange: CHANGE_ID,
    currentNode: kind,
    completedNodes: completed,
    enteredNodes: [...completed, kind],
    evidence: {
      execute: { summary: 'first pass executed' },
      review: kind === 'review' ? { summary: 'review in progress' } : { summary: 'review complete' },
    },
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
  };
  if (kind === 'verify') state.evidence.verify = { summary: 'verify in progress' };
  if (newChange) state.newChange = true;
  writeState(dir, state);
  // 前置节点产物齐备（open/design/plan）——共享路由在任务特判前先过前置产物门控
  writeIntakeArtifacts(dir);
  writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md',
    '# DESIGN\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 0. 技术栈选定\n\nNode.js(ESM)\n\n## 决策清单\n\n- [ ] 循环路由\n');
  writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
    parallelFix ? fixBatchParallelTaskText(fixStatus) : fixBatchTaskText(fixStatus));
  writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', execSummaryFixture('T01'));
  writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', fixBatchReviewDoc(true));
  if (kind === 'verify') {
    // 真实验证命令：落盘副作用文件——出口是否执行验证命令以文件系统事实判定（不只看退出码）
    writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md',
      '# TEST\n\n## 验证命令\n\n```\nnode -e "require(\'fs\').writeFileSync(\'verify-gate-ran.txt\', \'GATE-RAN\')"\n```\n');
    writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
  }
}

// 完成修复任务的后半段：标记 done + 逐任务 SUMMARY + 重载 execute 声明 + record execute。
// record 的新 change 前置门要求本节点加载声明；takeover 豁免回传显式落库，供出口校验读取。
export function completeFixTaskAndRecord(dir, env) {
  writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTaskText('done'));
  writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', execSummaryFixture('T-FIX-01'));
  assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
  const rec = runState(['record', 'execute', '{"summary":"fix batch executed","parallelTakeoverApproved":true}'], dir, env);
  assertExit(rec, 0);
  assertOut(rec, 'EVIDENCE: execute');
  const st = readStateFile(dir);
  if (st.evidence?.execute?.summary !== 'fix batch executed') {
    throw new Error('record execute 未刷新证据: ' + JSON.stringify(st.evidence?.execute));
  }
}

// 节点行断言（行锚定）：防「关键词作为子串出现在其它行」的弱断言
export function assertNodeLine(res, nodeId) {
  if (!new RegExp('^NODE: ' + nodeId + '$', 'm').test(res.output)) {
    throw new Error('输出缺少行 NODE: ' + nodeId + '（exit ' + res.status + '）\n实际输出:\n' + res.output);
  }
}

export function assertNotNodeLine(res, nodeId) {
  if (new RegExp('^NODE: ' + nodeId + '$', 'm').test(res.output)) {
    throw new Error('输出不应包含行 NODE: ' + nodeId + '（exit ' + res.status + '）\n实际输出:\n' + res.output);
  }
}

// ---------- explain <node> 契约对账（节点现问） ----------

// 期望值一律**现场从协议 JSON 派生**（本段不手抄第二份字段表）：解析实现输出后逐字段与
// `nodes[] / outputSchemas[]` 的声明比对。行前缀与分隔符是契约形态的一部分——不可解析即报问题
// （不静默跳过）。反向构造探针复用同一判据（声明侧抽掉一条 guardrail / 一个 artifact / 改描述）。

// ARTIFACT 行：`<id> [<kind>] required|optional → <路径 | 路径>`（kind 可缺省；无路径 → 未声明路径）。
function parseExplainArtifactLine(value) {
  const arrow = value.split(' → ');
  if (arrow.length !== 2) throw new Error('ARTIFACT 行缺「… → 路径」形态: ' + value);
  const requiredMatch = arrow[0].match(/ (required|optional)$/);
  if (!requiredMatch) throw new Error('ARTIFACT 行缺 required/optional 标注: ' + value);
  const head = arrow[0].slice(0, arrow[0].length - requiredMatch[0].length);
  const kindMatch = head.match(/^(.*) \[([^\]]+)\]$/);
  return {
    id: kindMatch ? kindMatch[1] : head,
    kind: kindMatch ? kindMatch[2] : null,
    required: requiredMatch[1] === 'required',
    paths: arrow[1] === '(未声明路径)' ? [] : arrow[1].split(' | '),
  };
}

// GUARDRAIL 行：`<id> | <label> | <validation>`。
function parseExplainGuardrailLine(value) {
  const parts = value.split(' | ');
  if (parts.length !== 3) throw new Error('GUARDRAIL 行缺三段（id | label | validation）: ' + value);
  return { id: parts[0], label: parts[1], validation: parts[2] };
}

// REQUIRED-SKILL 行：`<skill> | scope=<…> | enforcement=<…> | reason=<…>`。
function parseExplainSkillLine(value) {
  const parts = value.split(' | ');
  if (parts.length !== 4) throw new Error('REQUIRED-SKILL 行缺四段（skill | scope= | enforcement= | reason=）: ' + value);
  const [skill, scope, enforcement, reason] = parts;
  if (!scope.startsWith('scope=') || !enforcement.startsWith('enforcement=') || !reason.startsWith('reason=')) {
    throw new Error('REQUIRED-SKILL 行的键名形态不符: ' + value);
  }
  return { skill, scope: scope.slice(6), enforcement: enforcement.slice(12), reason: reason.slice(7) };
}

function parseExplainOutput(output) {
  const parsed = {
    attributes: {}, schemas: [], artifacts: [], evidence: [], guardrails: [], guardrailsNone: false,
    skills: [], skillsNone: false, commands: [],
  };
  let schemaIndex = -1;
  for (const rawLine of String(output).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    const value = line.slice(line.indexOf(': ') + 2);
    if (line.startsWith('NODE: ')) parsed.attributes.node = value;
    else if (line.startsWith('LABEL: ')) parsed.attributes.label = value;
    else if (line.startsWith('KIND: ')) parsed.attributes.kind = value;
    else if (line.startsWith('DISABLED: ')) parsed.attributes.disabled = value;
    else if (line.startsWith('OUTPUT-SCHEMA: ')) {
      parsed.schemas.push(value);
      schemaIndex += 1;
      parsed.artifacts.push([]);
      parsed.evidence.push([]);
    } else if (line.startsWith('ARTIFACT: ')) {
      if (schemaIndex < 0) throw new Error('ARTIFACT 行先于 OUTPUT-SCHEMA 行: ' + line);
      parsed.artifacts[schemaIndex].push(parseExplainArtifactLine(value));
    } else if (line.startsWith('EVIDENCE: ')) {
      if (schemaIndex < 0) throw new Error('EVIDENCE 行先于 OUTPUT-SCHEMA 行: ' + line);
      parsed.evidence[schemaIndex].push(value);
    } else if (line.startsWith('GUARDRAIL: ')) {
      if (value === '(none)') parsed.guardrailsNone = true;
      else parsed.guardrails.push(parseExplainGuardrailLine(value));
    } else if (line.startsWith('REQUIRED-SKILL: ')) {
      if (value === '(none)') parsed.skillsNone = true;
      else parsed.skills.push(parseExplainSkillLine(value));
    } else if (line.startsWith('COMMAND ')) parsed.commands.push(line);
    else throw new Error('explain 输出含未识别的行形态: ' + line);
  }
  return parsed;
}

// 期望值比对（解析结果 vs 协议声明；两侧同源，锚里不手抄字段表）。
function expectExplainField(problems, nodeId, actual, declared, field) {
  if (actual !== declared) {
    problems.push('节点 ' + nodeId + ' 的 ' + field + ' 与协议声明不一致: 输出 '
      + JSON.stringify(actual) + ' / 声明 ' + JSON.stringify(declared));
  }
}

// ① outputSchema 名与描述 + ② 每个 artifact 的 id·kind·required·路径（pathBase: specs-root ⇒ .specs/
// 前缀）与每个 evidence 的 id (required)。
function explainSchemaProblems(node, parsed, schemaById) {
  const problems = [];
  const declaredSchemas = node.outputSchemas ?? [];
  const expectedSchemaLines = declaredSchemas.length === 0
    ? ['(none)']
    : declaredSchemas.map((schemaId) => {
      const schema = schemaById.get(schemaId);
      return schemaId + (schema && schema.description ? ' — ' + schema.description : '');
    });
  expectExplainField(problems, node.id, parsed.schemas.join(' ␟ '), expectedSchemaLines.join(' ␟ '), 'OUTPUT-SCHEMA 行');
  declaredSchemas.forEach((schemaId, index) => {
    const schema = schemaById.get(schemaId);
    const declaredArtifacts = (schema?.artifacts ?? []).map((artifact) => ({
      id: artifact.id ?? '(unnamed)',
      kind: artifact.kind ?? null,
      required: artifact.required !== false,
      paths: (artifact.paths ?? []).map((declaredPath) =>
        (artifact.pathBase === 'specs-root' ? '.specs/' : '') + String(declaredPath)),
    }));
    const actualArtifacts = parsed.artifacts[index] ?? [];
    const artifactsMatch = actualArtifacts.length === declaredArtifacts.length
      && actualArtifacts.every((actual, position) => actual.id === declaredArtifacts[position].id
        && actual.kind === declaredArtifacts[position].kind
        && actual.required === declaredArtifacts[position].required
        && actual.paths.join(' | ') === declaredArtifacts[position].paths.join(' | '));
    if (!artifactsMatch) {
      problems.push('节点 ' + node.id + '/' + schemaId + ' 的 artifact 对账不一致: 输出 '
        + JSON.stringify(actualArtifacts) + ' / 声明 ' + JSON.stringify(declaredArtifacts));
    }
    const declaredEvidence = (schema?.evidence ?? []).length === 0
      ? '(none)'
      : (schema.evidence ?? []).map((evidence) =>
        evidence.id + (evidence.required === false ? ' (optional)' : ' (required)')).join(' | ');
    expectExplainField(problems, node.id, (parsed.evidence[index] ?? []).join(' | '),
      declaredEvidence, schemaId + ' 的 EVIDENCE 行');
  });
  return problems;
}

// ③ 每条 guardrail 的 id·label·validation 与 ④ 每条 requiredSkillCall 的 skill·scope·enforcement·reason
// （空集合 → '(none)' 行的在场性同判）。
function explainGuardrailAndSkillProblems(node, parsed) {
  const problems = [];
  const declaredGuardrails = (node.guardrails ?? []).map((guardrail) => ({
    id: guardrail.id ?? '(unnamed)', label: guardrail.label ?? '-', validation: guardrail.validation ?? '-',
  }));
  if ((declaredGuardrails.length === 0) !== parsed.guardrailsNone) {
    problems.push('节点 ' + node.id + ' 的 guardrail 空集合形态与声明不一致（(none) 行在场性不符）');
  }
  expectExplainField(problems, node.id, JSON.stringify(parsed.guardrails), JSON.stringify(declaredGuardrails), 'guardrail');
  const declaredSkills = (node.requiredSkillCalls ?? []).map((call) => ({
    skill: call.skill ?? '(unnamed)', scope: call.scope ?? '-',
    enforcement: call.enforcement ?? '-', reason: call.reason ?? '-',
  }));
  if ((declaredSkills.length === 0) !== parsed.skillsNone) {
    problems.push('节点 ' + node.id + ' 的 requiredSkillCall 空集合形态与声明不一致（(none) 行在场性不符）');
  }
  expectExplainField(problems, node.id, JSON.stringify(parsed.skills), JSON.stringify(declaredSkills), 'requiredSkillCall');
  return problems;
}

// ⑤ 三条命令：节点 id 与 --apply 形态 + 脚本根形态（三条同根、指向技能包 scripts 目录）+ 脚本
// 路径整体带双引号（含空格的安装根下不被 shell 分词——引号是契约形态的一部分，缺引号即红）。
function explainCommandProblems(node, parsed) {
  const commandPatterns = [
    [/^COMMAND entry: node "(.+?)\/workflow-guard\.mjs" entry (.+)$/, 'entry'],
    [/^COMMAND exit: node "(.+?)\/workflow-guard\.mjs" exit (.+) --apply$/, 'exit'],
    [/^COMMAND record: node "(.+?)\/workflow-state\.mjs" record (.+) '\{"summary":"<完成摘要>"\}'$/, 'record'],
  ];
  if (parsed.commands.length !== commandPatterns.length) {
    return ['节点 ' + node.id + ' 的 COMMAND 行数 ' + parsed.commands.length + ' ≠ 3'];
  }
  const problems = [];
  const scriptsRoots = new Set();
  parsed.commands.forEach((line, index) => {
    const [pattern, kind] = commandPatterns[index];
    const match = line.match(pattern);
    if (!match) {
      problems.push('节点 ' + node.id + ' 的 ' + kind + ' 命令形态不符: ' + line);
      return;
    }
    scriptsRoots.add(match[1]);
    if (match[2] !== node.id) problems.push('节点 ' + node.id + ' 的 ' + kind + ' 命令节点 id 不符: ' + match[2]);
  });
  if (scriptsRoots.size !== 1) {
    problems.push('节点 ' + node.id + ' 的三条命令脚本根不一致: ' + [...scriptsRoots].join(' / '));
  }
  const scriptsRoot = [...scriptsRoots][0] ?? '';
  if (!/skills\/flow-comet\/scripts$/.test(scriptsRoot)) {
    problems.push('节点 ' + node.id + ' 的命令脚本根不指向技能包 scripts 目录: ' + scriptsRoot);
  } else if (SCRIPTS_DIR.replace(/\\/g, '/').includes('/.flow-comet/skills/')
    && scriptsRoot !== '.claude/skills/flow-comet/scripts') {
    // 权威源检出：命令路径 = 设计形态（安装副本按运行根形态化，已由上面同一判据约束）
    problems.push('权威源检出的命令脚本根应为设计形态 .claude/skills/flow-comet/scripts: ' + scriptsRoot);
  }
  return problems;
}

// 逐字段对账（单一实现：真实判据与反向构造探针共用）：四类字段 + 三条命令。
function explainContractProblems(protocol, explainOutputs) {
  const problems = [];
  const schemaById = new Map((protocol.outputSchemas ?? []).map((schema) => [schema.id, schema]));
  for (const node of protocol.nodes ?? []) {
    const output = explainOutputs.get(node.id);
    if (typeof output !== 'string') {
      problems.push('节点 ' + node.id + ' 缺 explain 输出（未对账）');
      continue;
    }
    let parsed;
    try {
      parsed = parseExplainOutput(output);
    } catch (error) {
      problems.push('节点 ' + node.id + ' 的 explain 输出形态不可解析: ' + error.message);
      continue;
    }
    expectExplainField(problems, node.id, parsed.attributes.node, node.id, 'NODE');
    expectExplainField(problems, node.id, parsed.attributes.label ?? null, node.label ?? null, 'LABEL');
    expectExplainField(problems, node.id, parsed.attributes.kind ?? null, node.kind ?? null, 'KIND');
    expectExplainField(problems, node.id, parsed.attributes.disabled ?? null,
      node.disabled === true ? 'true（该节点在当前协议中被停用）' : null, 'DISABLED');
    problems.push(...explainSchemaProblems(node, parsed, schemaById));
    problems.push(...explainGuardrailAndSkillProblems(node, parsed));
    problems.push(...explainCommandProblems(node, parsed));
  }
  return problems;
}

// explain 的三种 fail-closed 形态（非法节点 / 缺参 / 拿选项当节点名）：都非零退出并列出全部合法节点。
function assertExplainFailClosed(dir, protocolDecl) {
  const legalNodes = protocolDecl.nodes.map((protocolNode) => protocolNode.id).join('/');
  const forms = [
    ['非法节点', ['explain', 'not-a-node'], 'explain node 非法: not-a-node'],
    ['缺参', ['explain'], 'explain requires a <node> id'],
    ['选项当节点名', ['explain', '--help'], 'explain requires a <node> id'],
  ];
  for (const [form, args, expected] of forms) {
    const res = runState(args, dir);
    assertExit(res, 1);
    assertOut(res, expected);
    assertOut(res, legalNodes);
    if (form === '非法节点') assertOut(res, '（协议节点: ' + legalNodes + '）');
  }
}

// 夹具协议（声明副本）下的 explain 输出——真实协议 env 通道；夹具文件跑完即清。
function explainOutputsForDeclaration(dir, decl) {
  const probeProtocolFile = path.join(dir, 'reference', 'workflow-protocol-probe.json');
  fs.writeFileSync(probeProtocolFile, JSON.stringify(decl, null, 2), 'utf8');
  const outputs = new Map();
  for (const protocolNode of decl.nodes) {
    const res = runState(['explain', protocolNode.id], dir, { FLOW_COMET_PROTOCOL: probeProtocolFile });
    assertExit(res, 0);
    outputs.set(protocolNode.id, res.output);
  }
  fs.rmSync(probeProtocolFile, { force: true });
  return outputs;
}

// 反向构造：把协议声明副本的一条 guardrail / 一个 artifact 抽掉、改一条 schema 描述 ⇒ 对账
// 必报对应字段；再把真实输出里的脚本路径引号去掉 ⇒ 必报命令形态不符（证明断言不恒真空过——
// 没有这一侧，把引号从实现里拿掉也能全绿）。返回问题描述数组（空 = 判别力齐备）。
function explainReverseConstructionProblems(dir, protocolDecl, explainOutputs) {
  const probeNode = protocolDecl.nodes.find((protocolNode) => (protocolNode.guardrails ?? []).length > 0);
  const probeSchema = (protocolDecl.outputSchemas ?? []).find((schema) => (schema.artifacts ?? []).length > 0);
  const owner = probeSchema === undefined ? undefined
    : protocolDecl.nodes.find((protocolNode) => (protocolNode.outputSchemas ?? []).includes(probeSchema.id));
  if (probeNode === undefined || probeSchema === undefined || owner === undefined) {
    return ['反向构造前提不成立：协议声明里找不到带 guardrail 的节点 / 带 artifact 的 schema / schema 归属节点'];
  }
  const variants = [
    ['抽掉一条 guardrail', (decl) => {
      decl.nodes.find((protocolNode) => protocolNode.id === probeNode.id).guardrails = [];
    }, probeNode.id, 'guardrail'],
    ['抽掉一个 artifact', (decl) => {
      decl.outputSchemas.find((schema) => schema.id === probeSchema.id).artifacts = [];
    }, owner.id, 'artifact'],
    ['改掉一条 schema 描述', (decl) => {
      const target = decl.outputSchemas.find((schema) => schema.id === probeSchema.id);
      target.description = (probeSchema.description ?? '') + '（反向构造探针）';
    }, owner.id, 'OUTPUT-SCHEMA'],
  ];
  const problems = [];
  for (const [form, mutate, affectedNodeId, expectedField] of variants) {
    const mutatedDecl = JSON.parse(JSON.stringify(protocolDecl));
    mutate(mutatedDecl);
    const probeOutputs = explainOutputsForDeclaration(dir, mutatedDecl);
    if (probeOutputs.get(affectedNodeId) === explainOutputs.get(affectedNodeId)) {
      problems.push('反向构造前提不成立（' + form + '：夹具协议未改变 explain 输出——协议 env 通道未生效）');
      continue;
    }
    const probeProblems = explainContractProblems(protocolDecl, probeOutputs);
    if (!probeProblems.some((problem) => problem.includes(expectedField))) {
      problems.push('反向构造判别力缺失（' + form + ' 未被判分叉）: ' + (probeProblems.join('; ') || '（零问题）'));
    }
  }
  // ④ 引号形态（③ 的另一面，不需重跑）：真实输出去掉脚本路径引号 ⇒ 逐节点必报命令形态不符。
  const dequoted = new Map();
  for (const [nodeId, output] of explainOutputs) {
    const text = String(output);
    const stripped = text.replace(/(node )"([^"\n]*\.mjs)"/g, '$1$2');
    if (stripped === text) {
      problems.push('反向构造前提不成立（节点 ' + nodeId + ' 的输出里没有带引号的脚本路径——引号判据无从判别）');
      continue;
    }
    dequoted.set(nodeId, stripped);
  }
  if (dequoted.size > 0) {
    const dequotedProblems = explainContractProblems(protocolDecl, new Map([...explainOutputs, ...dequoted]));
    for (const nodeId of dequoted.keys()) {
      if (!dequotedProblems.some((problem) => problem.includes('节点 ' + nodeId + ' 的')
        && problem.includes('命令形态不符'))) {
        problems.push('反向构造判别力缺失（去掉节点 ' + nodeId + ' 的脚本路径引号未被判命令形态不符）');
      }
    }
  }
  return problems;
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
export function driveThroughDesign(dir) {
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

// ---------- 受控重入真实命令链路夹具（H5~H8 共用） ----------

// archive 已 entry 形态的完成集（built-in 协议：open → verify 全部完成；archive 已进入未出口）

// status 输出的 JSON 块解析（命令行尾巴行不进 JSON）
export function parseStatusOutput(root) {
  const res = runState(['status'], root);
  assertExit(res, 0);
  const start = res.output.indexOf('{');
  const end = res.output.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('status 输出缺少 JSON 块:\n' + res.output);
  return JSON.parse(res.output.slice(start, end + 1));
}

// ---------- 侧命令（evolve / health / context-scan）与 ui-design 门：真实命令链路材料 ----------
// 与 guard-self-test 同构：判据走真实 CLI；零写入判据用树指纹（相对路径清单 + 文件 sha256）。

export const ENTRIES = [
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
    name: 'A4 status/explain：节点推导、节点现问契约（逐字段对账 + fail-closed + 只读）与无活跃兜底',
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
      // —— explain <node>：节点现问契约（真实子进程，零 mock；契约声明源 = 协议 JSON）——
      // 8 节点逐个逐字段对账（label / kind / outputSchema 名与描述 / artifact / evidence / guardrail /
      // requiredSkillCall / 三条命令）+ 三种 fail-closed 形态 + 只读性 + 反向构造（声明副本抽掉一条
      // guardrail / 一个 artifact、改一条 schema 描述 ⇒ 对账必报；判据与探针见模块级单一实现）。
      const protocolDecl = JSON.parse(fs.readFileSync(path.join(dir, 'reference', 'workflow-protocol.json'), 'utf8'));
      const stateFilePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const stateHashBefore = createHash('sha256').update(fs.readFileSync(stateFilePath)).digest('hex');
      const statusBefore = runState(['status'], dir);
      const explainOutputs = new Map();
      for (const protocolNode of protocolDecl.nodes) {
        const res = runState(['explain', protocolNode.id], dir);
        assertExit(res, 0);
        assertOut(res, 'NODE: ' + protocolNode.id);
        explainOutputs.set(protocolNode.id, res.output);
      }
      const contractProblems = explainContractProblems(protocolDecl, explainOutputs);
      assertTrue(contractProblems.length === 0,
        'explain 输出与协议 JSON 声明不一致: ' + contractProblems.join('; '));
      // 只读性：调用前后状态文件 sha256 全等 + status 读数逐字不变（explain 不写 state、不改路由）
      assertEqual(createHash('sha256').update(fs.readFileSync(stateFilePath)).digest('hex'), stateHashBefore,
        'explain 改写了状态文件（只读通道被破坏）');
      assertEqual(runState(['status'], dir).output, statusBefore.output, 'explain 改动了路由读数（只读通道被破坏）');
      assertExplainFailClosed(dir, protocolDecl);
      const probeProblems = explainReverseConstructionProblems(dir, protocolDecl, explainOutputs);
      assertTrue(probeProblems.length === 0, '反向构造判别力缺失: ' + probeProblems.join('; '));
      // 无 state 无工件 → no-change 兜底
      fs.rmSync(path.join(dir, '.flow-comet'), { recursive: true });
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
    run: (dir, outcomes) => {
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
      // 平台限制:Windows 创建符号链接需开发者模式/管理员——创建失败时登记显式「不适用（平台原因）」
      // 并由运行器逐条出声（不复用条件分支的静默跳过:未验证 ≠ 通过）。
      // 仅 symlink 创建包在 try 内——断言移出 catch,防断言失败被误报为平台跳过
      // (修复前 try 包住 runState/断言,真实回归会被吞为"平台不支持跳过")
      let symlinkCreated = false;
      try {
        fs.symlinkSync(outsideTarget, symlinkPath);
        symlinkCreated = true;
      } catch (e) {
        outcomes.notApplicablePlatform('A9 --json-file 符号链接越界负例',
          '本平台不支持创建符号链接（' + e.code + '）');
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
      let lastPassResult = null;
      const drivePass = (node, expectNext, label) => {
        assertExit(runState(['record', node, '{"summary":"' + label + '"}'], dir), 0);
        assertExit(runGuard(['entry', node], dir), 0);
        const res = runGuard(['exit', node, '--apply'], dir);
        assertExit(res, 0);
        assertOut(res, 'ALL CHECKS PASSED');
        lastPassResult = res;
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

      // 归属门禁事故回放（真实命令链路）：波 1 收口后工作归属在 execute（尚有串行衔接待办），
      // 此刻对未消化的并行 pending 任务发起委托 → 新 change BLOCK（state 字节零改写、不落请求）。
      // P03 依赖未满足：恢复指引以 workflow-state next 实际输出为准（next 按串行消化输出
      // execute），不得固定指向 entry subagent-execute；随后原链路照跑（串行衔接完成后并行收尾正常委托）。
      const ownershipEnv = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const ownershipStatePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const ownershipBytesBefore = fs.readFileSync(ownershipStatePath, 'utf8');
      const wrongNodeRequest = runHandoff(['request', 'P03', 'P03 委托', '--write-files', 'src/p03.mjs'], dir, ownershipEnv);
      assertExit(wrongNodeRequest, 1);
      assertOut(wrongNodeRequest, 'BLOCKED');
      assertOut(wrongNodeRequest, '当前不可委托');
      assertOut(wrongNodeRequest, '依赖未满足');
      assertOut(wrongNodeRequest, '未完成: S01');
      assertOut(wrongNodeRequest, '原始 currentNode=execute');
      assertOut(wrongNodeRequest, 'workflow-state next');
      assertOut(wrongNodeRequest, '若输出 execute 表示依赖未满足');
      assertOut(wrongNodeRequest, '待任务变为可委托');
      // 反锚：不得固定指引 next 不会输出的节点（按该指引进入会被 currentNode 门禁拦成死路）
      assertNotOut(wrongNodeRequest, 'entry subagent-execute');
      assertNotOut(wrongNodeRequest, 'HANDOFF REQUEST');
      if (fs.readFileSync(ownershipStatePath, 'utf8') !== ownershipBytesBefore) {
        throw new Error('归属门禁 BLOCK 不得改写 state 字节（含 handoffRequests）');
      }
      const ownershipState = readStateFile(dir);
      if (ownershipState.evidence?.['subagent-execute']?.handoffRequests?.P03) {
        throw new Error('归属门禁 BLOCK 不得落 handoffRequests: '
          + JSON.stringify(ownershipState.evidence?.['subagent-execute']?.handoffRequests));
      }
      // 指引与 next 实际输出一致：依赖未满足 → next 输出 execute（串行消化），无 entry 死路
      const routeAfterBlock = runState(['next'], dir, ownershipEnv);
      assertExit(routeAfterBlock, 0);
      assertNodeLine(routeAfterBlock, 'execute');

      // 趟 2 · execute:先消化本趟全部串行 pending(串行衔接,标 done 并委托留证)——
      // 确认无串行残留后才 exit → 收尾并行依赖满足 → 再次进入委托节点
      // (旧引擎单趟限制下此处不再路由回——本断言即多趟语义回归锚)
      markDone({ P01: 'done', P02: 'done', S01: 'done', P03: 'pending' });
      completeTasks(['S01']);
      drivePass('execute', 'subagent-execute', 'serial-wave-1');

      // 趟 3 · subagent-execute:收尾并行委托完成 → 全部 done → 出口照常门控进 review(循环终止语义不变)
      markDone({ P01: 'done', P02: 'done', S01: 'done', P03: 'done' });
      completeTasks(['P03']);
      // 收口前基线（只读）：出口 NODE 与完成节点集合之外零改写，收尾前后仅审计行文本变化
      const pass3Before = readStateFile(dir);
      drivePass('subagent-execute', 'review', 'parallel-wave-2');
      const pass3 = lastPassResult;
      // 正常多趟收尾：无 Fix 结构标记且历史签名全等 → 中性 RETURN，不得出现 FIX-BATCH 锚
      assertOut(pass3, 'RETURN: 回源节点 review（subagent-execute 出口已完成；正常多趟收尾，非 Fix 回修）');
      assertNotOut(pass3, 'FIX-BATCH');
      assertNodeLine(pass3, 'review');
      const pass3After = readStateFile(dir);
      if (JSON.stringify(pass3After.completedNodes) !== JSON.stringify(pass3Before.completedNodes)) {
        throw new Error('正常多趟收尾不得改写完成节点集合（审计行分类零副作用）: 收口前 '
          + JSON.stringify(pass3Before.completedNodes) + ' 收口后 ' + JSON.stringify(pass3After.completedNodes));
      }
      if (pass3After.currentNode !== 'review' || pass3After.completedNodes.includes('review')) {
        throw new Error('正常多趟收尾应停在未完成的 review: ' + JSON.stringify(pass3After));
      }
      const pass3PostNext = runState(['next'], dir);
      assertExit(pass3PostNext, 0);
      assertNodeLine(pass3PostNext, 'review');

      const st = readStateFile(dir);
      if (st.currentNode !== 'review') {
        throw new Error('全部任务 done 后应停在 review 门控前: ' + JSON.stringify(st.currentNode));
      }
      console.log('  多趟路由:subagent-execute→execute→subagent-execute→review 三趟两交替 + 归属门禁 BLOCK 后原链路续跑 ✓');
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
    // 一方读取对方写路径 → WARN 提示不 BLOCK（渐进）。同一文件跨任务族：两个未完成任务写入面
    // 重叠且彼此无依赖路径（串行拆分同样拦截）→ 新 change BLOCKED（消息含任务对与重叠文件）；
    // 补显式 depends_on 后放行；旧 change 形态仅 WARN 不阻断；修复任务族（id 带修复前缀）
    // 不参与该族——其顺序由修复生命周期保证，回修同一文件是必然形态。修复前 plan 出口无这些
    // 检测 = 预期 RED。
    name: 'A16 plan 出口文件依赖检出：写写重叠 BLOCK 与恢复 + glob 单侧/双侧/不重叠 + 读写弱判 WARN + 同文件跨任务无依赖路径（真实命令）',
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
      // glob 形态重叠（单侧元字符 × 字面路径）：修复前逐字相等判定漏检 ⇒ 静默放行（本段即 RED）；
      // 反向构造：改为互不重叠 / 段数不等 / 段内不匹配 ⇒ 放行（判据不恒真空过）；双侧 glob ⇒ 保守判重叠。
      const globPair = (firstWrite, secondWrite, secondDeps = '') =>
        C1 +
        '<task id="G01" parallel="true" status="pending"><action>实现 G01</action><write_files>' + firstWrite + '</write_files><verify>node --check src/x.mjs</verify></task>\n' +
        '<task id="G02" parallel="true" status="pending"><action>实现 G02</action><write_files>' + secondWrite + '</write_files><verify>node --check src/x.mjs</verify>' + secondDeps + '</task>\n';
      planTask(globPair('src/glob/*.mjs', 'src/glob/foo.mjs'));
      const globBlocked = exitPlanNoApply();
      assertExit(globBlocked, 1);
      assertOut(globBlocked, 'BLOCKED');
      assertOut(globBlocked, 'G01×G02');
      assertOut(globBlocked, 'src/glob/*.mjs');
      assertOut(globBlocked, 'src/glob/foo.mjs');
      assertOut(globBlocked, 'depends_on');
      planTask(globPair('src/glob/*.mjs', 'src/glob/deep/foo.mjs'));
      const depthMismatch = exitPlanNoApply();
      assertExit(depthMismatch, 0);
      assertNotOut(depthMismatch, 'BLOCKED');
      planTask(globPair('src/glob/*.mjs', 'src/glob/foo.js'));
      const suffixMismatch = exitPlanNoApply();
      assertExit(suffixMismatch, 0);
      assertNotOut(suffixMismatch, 'BLOCKED');
      planTask(globPair('src/glob/*.mjs', 'src/glob/*.js'));
      const doubleGlob = exitPlanNoApply();
      assertExit(doubleGlob, 1);
      assertOut(doubleGlob, 'BLOCKED');
      assertOut(doubleGlob, 'G01×G02');
      // 恢复（真实链路）：按指引补显式 depends_on（重叠路径不改）⇒ 同一出口放行
      planTask(globPair('src/glob/*.mjs', 'src/glob/foo.mjs', '<depends_on>G01</depends_on>'));
      const globRecovered = exitPlanNoApply();
      assertExit(globRecovered, 0);
      assertOut(globRecovered, 'ALL CHECKS PASSED');
      assertNotOut(globRecovered, 'BLOCKED');
      // 同一文件跨任务族（负例）：两个非修复任务写入同一文件、彼此无依赖路径（串行拆分同样构成
      // 「未显式排序的同文件多任务」）→ 新 change BLOCKED，消息含任务对与重叠文件 + 恢复指引。
      // 同夹具并列一对修复任务（id 带修复前缀）写同一文件且无依赖路径——该族不参与判定，
      // 消息中不得出现它们（其顺序由修复生命周期保证）。
      const fixPair =
        '<task id="T-FIX-01" status="pending"><action>修复 F1</action><write_files>src/fix.mjs</write_files><verify>node --check src/fix.mjs</verify></task>\n' +
        '<task id="T-FIX-02" status="pending"><action>修复 F2</action><write_files>src/fix.mjs</write_files><verify>node --check src/fix.mjs</verify></task>\n';
      const sameFileTask = (id, depsElement) =>
        '<task id="' + id + '" status="pending"><action>实现 ' + id + '</action><write_files>src/x.mjs</write_files>' +
        '<verify>node --check src/x.mjs</verify>' + depsElement + '</task>\n';
      const sameFilePairNoDeps = sameFileTask('X1', '') + sameFileTask('X2', '');
      const sameFilePairWithDeps = sameFileTask('X1', '') + sameFileTask('X2', '<depends_on>X1</depends_on>');
      planTask(C1 + sameFilePairNoDeps + fixPair);
      const sameFileBlocked = exitPlanNoApply();
      assertExit(sameFileBlocked, 1);
      assertOut(sameFileBlocked, 'BLOCKED');
      assertOut(sameFileBlocked, '同文件跨任务且无依赖路径');
      assertOut(sameFileBlocked, 'X1×X2');
      assertOut(sameFileBlocked, 'src/x.mjs');
      assertOut(sameFileBlocked, 'depends_on');
      assertNotOut(sameFileBlocked, 'T-FIX-01');
      assertNotOut(sameFileBlocked, 'src/fix.mjs');
      // 修复任务族谓词边界（唯一谓词 = id 前缀 + 「位于 Fix 段内」两条边界，只在引擎内表达一次）：
      // ① 形似而非修复编号的 id 不属修复族——「前缀后缺连字符」的形似编号在旧判据的宽松前缀下
      //    整对被放过；正确判据下它与同文件无依赖路径对一律 BLOCKED。
      const lookalikeFixPair =
        '<task id="T-FIXUP-01" status="pending"><action>实现 T-FIXUP-01</action><write_files>src/lookalike.mjs</write_files><verify>node --check src/lookalike.mjs</verify></task>\n' +
        '<task id="T-FIXUP-02" status="pending"><action>实现 T-FIXUP-02</action><write_files>src/lookalike.mjs</write_files><verify>node --check src/lookalike.mjs</verify></task>\n';
      planTask(C1 + lookalikeFixPair);
      const lookalikeBlocked = exitPlanNoApply();
      assertExit(lookalikeBlocked, 1);
      assertOut(lookalikeBlocked, 'BLOCKED');
      assertOut(lookalikeBlocked, '同文件跨任务且无依赖路径');
      assertOut(lookalikeBlocked, 'T-FIXUP-01×T-FIXUP-02');
      assertOut(lookalikeBlocked, 'src/lookalike.mjs');
      // ② Fix 段内、id 不带修复前缀的修复任务同属修复族——旧判据只认 id 前缀，会把段内这对当普通
      //    参与者误 BLOCK；正确判据下段内任务整体不参与该族 → 出口放行且无该族消息。
      const fixSectionPair =
        '<task id="F01" status="pending"><action>修复 F01</action><write_files>src/fix-section.mjs</write_files><verify>node --check src/fix-section.mjs</verify></task>\n' +
        '<task id="F02" status="pending"><action>修复 F02</action><write_files>src/fix-section.mjs</write_files><verify>node --check src/fix-section.mjs</verify></task>\n';
      planTask(C1 + '\n## Fix 任务\n\n' + fixSectionPair);
      const fixSectionRes = exitPlanNoApply();
      assertExit(fixSectionRes, 0);
      assertNotOut(fixSectionRes, '同文件跨任务且无依赖路径');
      assertNotOut(fixSectionRes, 'BLOCKED');
      // 旧 change 形态（无新 change 标记）：同形态仅 WARN 渐进不阻断，恢复指引仍在
      planTask(C1 + sameFilePairNoDeps + fixPair);
      const sameFileState = readStateFile(dir);
      delete sameFileState.newChange;
      writeState(dir, sameFileState);
      const sameFileWarn = exitPlanNoApply();
      assertExit(sameFileWarn, 0);
      assertOut(sameFileWarn, 'WARN');
      assertOut(sameFileWarn, '同文件跨任务且无依赖路径');
      assertOut(sameFileWarn, 'X1×X2');
      assertNotOut(sameFileWarn, 'BLOCKED');
      writeState(dir, { ...sameFileState, newChange: true });
      // 恢复：按指引补显式 depends_on，且 **P02 保持写原重叠路径 bak_a.txt**
      // （不改路径避开重叠）——证明「补 depends_on 解决原重叠」而非「改路径避开重叠」；补依赖后
      // P02 跨趟（dep 未满足，不在本趟可运行集合）→ 同波次并行对只剩 P01 → 重叠消失 → 同出口通过。
      // 同一文件跨任务族同批恢复：X2 补 depends_on X1（重叠路径不改）；并列的修复任务对保持无依赖
      // ——该族不参与判定，故不影响本出口通过。
      planTask(
        C1 +
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify><depends_on>P01</depends_on></task>\n' +
        sameFilePairWithDeps + fixPair);
      const ok = exitPlanApply();
      assertExit(ok, 0);
      assertOut(ok, 'ALL CHECKS PASSED');
      assertNotOut(ok, 'BLOCKED');
      assertNotOut(ok, '同文件跨任务且无依赖路径');
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
    // 漂移容忍 exit 系统锚（真实命令链路）：execute 产物/证据齐（单任务完成 +
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
    // 路由诊断静默扩展系统锚（真实命令链路）：波 1 并行完成后剩余串行 pending
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
      assertNotOut(resWave, 'ROUTE WARN'); // 剩余 pending 全串行（P→S 收尾）→ 静默
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

  {
    // review 源 Fix 闭环（真实命令链路）：execute 已首次完成、review 驻留 +「Fix 任务」段追加
    // pending 修复任务 → 直接 exit review --apply 被拦（旧绕过路径会静默跳过 execute 生命周期）；
    // next 受控归位 execute 并写盘 → 完成修复任务后 record/exit execute --apply 回源 review →
    // review 出口门禁真实执行（发现条目缺处置标记仍 BLOCKED，补齐后通过）并推进 verify。
    // 修复前 next 停在 review（无 NODE: execute / 无归位审计行）→ 本项应失败（RED 锚）。
    name: 'A21 review 源 Fix 闭环：next 归位 execute → 出口回源 review → 审查出口真实执行（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending' });

      // ① 旧绕过路径：Fix 任务仍 pending 时直接 exit review --apply → 新 change BLOCKED + 恢复指引
      const bypass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(bypass, 1);
      assertOut(bypass, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(bypass, 'Fix 批次');
      assertOut(bypass, 'entry execute');
      assertOut(bypass, 'workflow-state.mjs next');
      assertNotOut(bypass, 'ALL CHECKS PASSED');
      let st = readStateFile(dir);
      if (st.currentNode !== 'review' || st.completedNodes.includes('review')) {
        throw new Error('越界 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }

      // 首轮计数与 verify 失败计数互相独立：先记一次 verify 失败，归位不得改动其计数。
      assertExit(runState(['verify-fail'], dir, env), 0);
      // ② next 受控归位 execute：显式审计行 + 真实写盘（不得停在源节点）
      const nxt = runState(['next'], dir, env);
      assertExit(nxt, 0);
      assertOut(nxt, 'FIX-BATCH: 归位 execute（源节点 review）（第 1/3 轮）');
      assertNodeLine(nxt, 'execute');
      assertNotNodeLine(nxt, 'review');
      st = readStateFile(dir);
      if (st.currentNode !== 'execute') {
        throw new Error('归位后 currentNode 应为 execute，实际 ' + JSON.stringify(st.currentNode));
      }
      if (st.completedNodes.includes('review')) {
        throw new Error('归位不得把源节点标完成: ' + JSON.stringify(st.completedNodes));
      }
      if (!st.evidence?.review) {
        throw new Error('归位不得清掉源节点证据: ' + JSON.stringify(st.evidence));
      }
      if (st.fixRoundsByChange?.ch !== 1) {
        throw new Error('首轮受控归位应计数 1: ' + JSON.stringify(st.fixRoundsByChange));
      }
      if (st.verifyFailuresByChange?.ch !== 1) {
        throw new Error('Fix 轮次计数不得改写 verify 失败计数: ' + JSON.stringify(st.verifyFailuresByChange));
      }

      // ③ 完成修复任务（标 done + 逐任务 SUMMARY + 重载声明 + record execute）
      completeFixTaskAndRecord(dir, env);

      // 收口前基线（只读）：出口前后完成节点集合不变，目的地仍为未完成的 review
      const a21Before = readStateFile(dir);
      // ④ exit execute --apply 跑四类出口后回源 review（REVIEW.md 在场也不得按产物跳 verify）
      const ex = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(ex, 0);
      assertOut(ex, 'ALL CHECKS PASSED');
      assertOut(ex, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNodeLine(ex, 'review');
      assertNotNodeLine(ex, 'verify');
      assertNotOut(ex, 'RETURN: 回源节点');
      assertNotOut(ex, '未分类');
      st = readStateFile(dir);
      if (st.currentNode !== 'review' || st.completedNodes.includes('review')) {
        throw new Error('回源后应停在未完成的 review: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }
      if (JSON.stringify(st.completedNodes) !== JSON.stringify(a21Before.completedNodes)) {
        throw new Error('Fix 回源收尾不得改写完成节点集合（仅审计行分类变化）: 收口前 '
          + JSON.stringify(a21Before.completedNodes) + ' 收口后 ' + JSON.stringify(st.completedNodes));
      }
      const a21PostNext = runState(['next'], dir, env);
      assertExit(a21PostNext, 0);
      assertNodeLine(a21PostNext, 'review');

      // ⑤ 回源 review 出口门禁真实执行：缺处置标记 → BLOCKED；补齐后同出口通过并推进 verify
      assertExit(runState(['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'review'], dir, env), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', fixBatchReviewDoc(false));
      const gate = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(gate, 1);
      assertOut(gate, 'BLOCKED');
      assertOut(gate, '处置');
      assertNotOut(gate, 'ALL CHECKS PASSED');
      st = readStateFile(dir);
      if (st.currentNode !== 'review' || st.completedNodes.includes('review')) {
        throw new Error('审查出口 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', fixBatchReviewDoc(true));
      const pass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(pass, 0);
      assertOut(pass, 'ALL CHECKS PASSED');
      assertNodeLine(pass, 'verify');
      st = readStateFile(dir);
      if (st.currentNode !== 'verify' || !st.completedNodes.includes('review')) {
        throw new Error('审查出口通过后应推进 verify: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }
      if (st.fixRoundsByChange?.ch !== 1) {
        throw new Error('审查出口通过不得清零 Fix 轮次计数: ' + JSON.stringify(st.fixRoundsByChange));
      }
      if (st.verifyFailuresByChange?.ch !== 1) {
        throw new Error('审查出口不得改写 verify 失败计数: ' + JSON.stringify(st.verifyFailuresByChange));
      }
    },
  },
  {
    // verify 源 Fix 回程（真实命令链路）：review 已完成、verify 驻留 + pending 修复任务；
    // TEST/UAT 已在场（正常产物推导会跳过未出口的 verify 去 archive）→ 修复前 next 停在 verify /
    // 产物推导会跳过 verify；修复后 next 归位 execute，exit execute --apply 回源 verify 并真实跑
    // verify 出口（验证命令落盘副作用文件 + 推进 archive）。
    name: 'A22 verify 源 Fix 回程：回 verify 而非跳过 archive + verify 出口真实执行（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const gateMarker = path.join(dir, 'verify-gate-ran.txt');
      writeFixBatchFixture(dir, { kind: 'verify', fixStatus: 'pending' });

      // ① 旧绕过路径：pending 修复任务时直接 exit verify --apply → BLOCKED，且验证命令未被执行
      const bypass = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(bypass, 1);
      assertOut(bypass, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(bypass, 'entry execute');
      assertNotOut(bypass, 'ALL CHECKS PASSED');
      if (fs.existsSync(gateMarker)) throw new Error('越界 BLOCK 不得执行 verify 验证命令');
      let st = readStateFile(dir);
      if (st.currentNode !== 'verify' || st.completedNodes.includes('verify')) {
        throw new Error('越界 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }

      // ② next 受控归位 execute（源节点 verify）
      const nxt = runState(['next'], dir, env);
      assertExit(nxt, 0);
      assertOut(nxt, 'FIX-BATCH: 归位 execute（源节点 verify）');
      assertNodeLine(nxt, 'execute');
      assertNotNodeLine(nxt, 'verify');
      st = readStateFile(dir);
      if (st.currentNode !== 'execute') {
        throw new Error('归位后 currentNode 应为 execute，实际 ' + JSON.stringify(st.currentNode));
      }

      // ③ 完成修复任务并 record execute
      completeFixTaskAndRecord(dir, env);

      // 收口前基线（只读）：出口前后完成节点集合不变，目的地仍为未完成的 verify
      const a22Before = readStateFile(dir);
      // ④ exit execute --apply：不按产物跳过 verify → 回源 verify（不是 archive）
      const ex = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(ex, 0);
      assertOut(ex, 'ALL CHECKS PASSED');
      assertOut(ex, 'FIX-BATCH: 回源节点 verify（execute 出口已完成）');
      assertNodeLine(ex, 'verify');
      assertNotNodeLine(ex, 'archive');
      assertNotOut(ex, 'RETURN: 回源节点');
      assertNotOut(ex, '未分类');
      st = readStateFile(dir);
      if (st.currentNode !== 'verify' || st.completedNodes.includes('verify')) {
        throw new Error('回源后应停在未完成的 verify: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }
      if (JSON.stringify(st.completedNodes) !== JSON.stringify(a22Before.completedNodes)) {
        throw new Error('Fix 回源收尾不得改写完成节点集合（仅审计行分类变化）: 收口前 '
          + JSON.stringify(a22Before.completedNodes) + ' 收口后 ' + JSON.stringify(st.completedNodes));
      }
      const a22PostNext = runState(['next'], dir, env);
      assertExit(a22PostNext, 0);
      assertNodeLine(a22PostNext, 'verify');

      // ⑤ 回源 verify 出口真实执行：验证命令落盘 + 推进 archive
      assertExit(runState(['skill-load', 'verify', 'flow-comet-verify', '--prompt', 'flow-kit/prompts/7-integration.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'verify'], dir, env), 0);
      const vf = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(vf, 0);
      assertOut(vf, 'ALL CHECKS PASSED');
      assertNodeLine(vf, 'archive');
      if (!fs.existsSync(gateMarker) || fs.readFileSync(gateMarker, 'utf8') !== 'GATE-RAN') {
        throw new Error('verify 出口未真实执行 TEST.md 验证命令（副作用文件缺失/内容不符）');
      }
      st = readStateFile(dir);
      if (st.currentNode !== 'archive' || !st.completedNodes.includes('verify')) {
        throw new Error('验证出口通过后应推进 archive: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }
    },
  },
  {
    // 越界拦截 + done-but-unclosed 回放 + 旧 change 兼容（真实命令链路）：
    // ① 新 change review/pending → BLOCKED + state 不变；
    // ② 事故回放——Fix 任务全 done 但 history 最新 exit execute 签名仍是追加前值
    //    （从未重跑 execute 出口）→ 同出口 BLOCKED + state 字节零改写（修复前被错误断言为通过）；
    // ③ 正对照——按指引 entry execute + exit execute --apply 真闭合后，review 出口通过；
    // ④⑤ verify 源 pending / done-but-unclosed 同样 BLOCKED 且验证命令不执行，⑥ 闭合后通过；
    // ⑦⑧⑨ 旧 change（无 new change 标记）同形态渐进 WARN 放行、next 归位可达、验证出口真实执行。
    name: 'A23 Fix 越界拦截与旧 change 渐进：源节点直接 exit BLOCK（新）/WARN（旧）不卡死（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const gateMarker = path.join(dir, 'verify-gate-ran.txt');
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');

      // ① 新 change review 源 + pending：直接 exit review --apply → BLOCKED + 恢复指引 + state 不变
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending' });
      const rBlock = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(rBlock, 1);
      assertOut(rBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(rBlock, '未跑出口');
      assertOut(rBlock, '恢复');
      assertOut(rBlock, 'entry execute');
      assertOut(rBlock, 'workflow-state.mjs next');
      assertNotOut(rBlock, 'ALL CHECKS PASSED');
      let st = readStateFile(dir);
      if (st.currentNode !== 'review' || st.completedNodes.includes('review')) {
        throw new Error('review 源越界 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }

      // ② 事故回放形态：Fix 任务已全 done，但 history 最新 exit execute 记录的是追加前签名
      //（done 后从未再跑 execute 出口）→ 修复前静默放行，修复后必须 BLOCKED + state 字节零改写
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'done' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', execSummaryFixture('T-FIX-01'));
      const doneUnclosed = readStateFile(dir);
      doneUnclosed.history = fixBatchHistoryWithStaleExecuteExit();
      writeState(dir, doneUnclosed);
      const doneBytes = fs.readFileSync(statePath, 'utf8');
      const rDoneBlock = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(rDoneBlock, 1);
      assertOut(rDoneBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(rDoneBlock, 'entry execute');
      assertOut(rDoneBlock, 'workflow-state.mjs next');
      assertNotOut(rDoneBlock, 'ALL CHECKS PASSED');
      if (fs.readFileSync(statePath, 'utf8') !== doneBytes) {
        throw new Error('done-but-unclosed 越界 BLOCK 不得改写 state 字节');
      }

      // ③ 正对照：同夹具按指引真闭合（entry execute → 完成声明/record → exit execute --apply 写当前
      //    签名并回源 review）→ 再 exit review --apply 通过（拦截只针对未闭合态，不误伤正常路径）
      assertExit(runGuard(['entry', 'execute'], dir, env), 0);
      completeFixTaskAndRecord(dir, env);
      const rClosedExit = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(rClosedExit, 0);
      assertOut(rClosedExit, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(rClosedExit, 'RETURN: 回源节点');
      assertNodeLine(rClosedExit, 'review');
      assertExit(runState(['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'review'], dir, env), 0);
      const rReviewPass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(rReviewPass, 0);
      assertOut(rReviewPass, 'ALL CHECKS PASSED');
      assertNotOut(rReviewPass, 'BLOCKED');
      assertNodeLine(rReviewPass, 'verify');

      // ③b 并行 Fix 任务（可委托 parallel pending）+ review 源（真实命令链路）：
      // 直接 exit review BLOCKED；next 归位 subagent-execute；完成委托后第二趟
      // exit subagent-execute --apply 回源 review；源节点出口真实执行并推进 verify。
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending', parallelFix: true });
      const pBypass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(pBypass, 1);
      assertOut(pBypass, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNotOut(pBypass, 'ALL CHECKS PASSED');
      let pSt = readStateFile(dir);
      if (pSt.currentNode !== 'review' || pSt.completedNodes.includes('review')) {
        throw new Error('并行越界 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: pSt.currentNode, completedNodes: pSt.completedNodes }));
      }
      const pNext = runState(['next'], dir, env);
      assertExit(pNext, 0);
      assertOut(pNext, 'FIX-BATCH: 归位 subagent-execute（源节点 review）');
      assertNodeLine(pNext, 'subagent-execute');
      assertNotNodeLine(pNext, 'execute');
      pSt = readStateFile(dir);
      if (pSt.currentNode !== 'subagent-execute') {
        throw new Error('并行回退归位后 currentNode 应为 subagent-execute，实际 ' + JSON.stringify(pSt.currentNode));
      }
      // 完成并行修复任务：标记 done + 摘要 + 真实 handoff request/result + skill-load/record。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchParallelTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P-FIX-01-SUMMARY.md', execSummaryFixture('P-FIX-01'));
      // 委托前先加载节点技能声明（新 change 两层加载模型：request 命令要求标记在位）。
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      for (const taskId of ['T01', 'P-FIX-01']) {
        assertExit(runHandoff(['request', taskId, taskId + ' 委托', '--write-files', 'src/' + taskId.toLowerCase() + '.mjs'], dir), 0);
        assertExit(runHandoff(['result', taskId, fullContract('abcd1234abcd1234abcd1234abcd1234abcd1234', taskId)], dir), 0);
      }
      assertExit(runState(['record', 'subagent-execute', '{"summary":"parallel fix delegated and collected"}'], dir, env), 0);
      const pExit = runGuard(['exit', 'subagent-execute', '--apply'], dir, env);
      assertExit(pExit, 0);
      assertOut(pExit, 'ALL CHECKS PASSED');
      assertOut(pExit, 'FIX-BATCH: 回源节点 review（subagent-execute 出口已完成）');
      assertNotOut(pExit, 'RETURN: 回源节点');
      assertNodeLine(pExit, 'review');
      pSt = readStateFile(dir);
      if (pSt.currentNode !== 'review') {
        throw new Error('并行修复第二趟出口应回源 review，实际 ' + JSON.stringify(pSt.currentNode));
      }
      assertExit(runState(['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'review'], dir, env), 0);
      const pReviewPass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(pReviewPass, 0);
      assertOut(pReviewPass, 'ALL CHECKS PASSED');
      assertNodeLine(pReviewPass, 'verify');
      // ④ 新 change verify 源 + pending：直接 exit verify --apply → BLOCKED，验证命令未执行
      fs.rmSync(gateMarker, { force: true });
      writeFixBatchFixture(dir, { kind: 'verify', fixStatus: 'pending' });
      const vBlock = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(vBlock, 1);
      assertOut(vBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(vBlock, 'entry execute');
      assertNotOut(vBlock, 'ALL CHECKS PASSED');
      if (fs.existsSync(gateMarker)) throw new Error('越界 BLOCK 不得执行 verify 验证命令');
      st = readStateFile(dir);
      if (st.currentNode !== 'verify' || st.completedNodes.includes('verify')) {
        throw new Error('verify 源越界 BLOCK 不得改写 state: ' + JSON.stringify({ currentNode: st.currentNode, completedNodes: st.completedNodes }));
      }

      // ⑤ verify 源 done-but-unclosed 回放（独立复核实跑形态）：review 已完成 + TEST/UAT 在场
      //（原路径会跳过 verify 去 archive）+ 全 done + 最新 execute exit 签名过时 → BLOCKED，验证命令
      // 不执行、state 字节零改写；⑥ 按指引闭合后 exit verify 真实执行验证命令并推进 archive
      writeFixBatchFixture(dir, { kind: 'verify', fixStatus: 'done' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', execSummaryFixture('T-FIX-01'));
      const verifyDoneUnclosed = readStateFile(dir);
      verifyDoneUnclosed.history = fixBatchHistoryWithStaleExecuteExit();
      writeState(dir, verifyDoneUnclosed);
      const verifyDoneBytes = fs.readFileSync(statePath, 'utf8');
      const vDoneBlock = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(vDoneBlock, 1);
      assertOut(vDoneBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(vDoneBlock, 'entry execute');
      assertNotOut(vDoneBlock, 'ALL CHECKS PASSED');
      if (fs.existsSync(gateMarker)) throw new Error('done-but-unclosed 越界 BLOCK 不得执行 verify 验证命令');
      if (fs.readFileSync(statePath, 'utf8') !== verifyDoneBytes) {
        throw new Error('verify done-but-unclosed 越界 BLOCK 不得改写 state 字节');
      }
      assertExit(runGuard(['entry', 'execute'], dir, env), 0);
      completeFixTaskAndRecord(dir, env);
      const vClosedExit = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(vClosedExit, 0);
      assertOut(vClosedExit, 'FIX-BATCH: 回源节点 verify（execute 出口已完成）');
      assertNotOut(vClosedExit, 'RETURN: 回源节点');
      assertNodeLine(vClosedExit, 'verify');
      assertExit(runState(['skill-load', 'verify', 'flow-comet-verify', '--prompt', 'flow-kit/prompts/7-integration.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'verify'], dir, env), 0);
      const vPass = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(vPass, 0);
      assertOut(vPass, 'ALL CHECKS PASSED');
      assertNodeLine(vPass, 'archive');
      if (!fs.existsSync(gateMarker) || fs.readFileSync(gateMarker, 'utf8') !== 'GATE-RAN') {
        throw new Error('闭合后 verify 出口未真实执行 TEST.md 验证命令（副作用文件缺失/内容不符）');
      }

      // ⑦ 旧 change review 源 + pending：直接 exit review --apply → FIX-BATCH WARN 渐进放行（不 BLOCK、不死结）
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending', newChange: false });
      const oldExit = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(oldExit, 0);
      assertOut(oldExit, 'FIX-BATCH WARN');
      assertNotOut(oldExit, 'BLOCKED');
      assertOut(oldExit, 'ALL CHECKS PASSED');
      assertNodeLine(oldExit, 'execute'); // pending 修复任务使路由继续回 execute（流程未卡死）
      st = readStateFile(dir);
      if (st.currentNode !== 'execute') {
        throw new Error('旧 change 渐进放行后 currentNode 应为 execute，实际 ' + JSON.stringify(st.currentNode));
      }

      // ⑧ 旧 change next 入口：pending 修复 + 源节点驻留 → 不新增 BLOCK，归位 execute 可继续
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending', newChange: false });
      const oldNext = runState(['next'], dir, env);
      assertExit(oldNext, 0);
      assertNotOut(oldNext, 'BLOCKED');
      assertOut(oldNext, 'FIX-BATCH: 归位 execute（源节点 review）');
      assertNodeLine(oldNext, 'execute');
      st = readStateFile(dir);
      if (st.currentNode !== 'execute') {
        throw new Error('旧 change next 归位后 currentNode 应为 execute，实际 ' + JSON.stringify(st.currentNode));
      }

      // ⑨ 旧 change verify 源 + pending：直接 exit verify --apply → WARN 渐进且验证出口真实执行、不卡死
      fs.rmSync(gateMarker, { force: true });
      writeFixBatchFixture(dir, { kind: 'verify', fixStatus: 'pending', newChange: false });
      const oldVerify = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(oldVerify, 0);
      assertOut(oldVerify, 'FIX-BATCH WARN');
      assertNotOut(oldVerify, 'BLOCKED');
      assertOut(oldVerify, 'ALL CHECKS PASSED');
      assertNodeLine(oldVerify, 'execute'); // pending 修复任务使路由继续回 execute
      if (!fs.existsSync(gateMarker) || fs.readFileSync(gateMarker, 'utf8') !== 'GATE-RAN') {
        throw new Error('旧 change verify 出口未真实执行 TEST.md 验证命令（渐进不等于跳过门禁）');
      }

      // ⑩ 多波次真实 Fix：第一波收口后追加第二波；第三趟收口时历史最新签名已等于当前签名、
      //    更早签名仍发散——全量签名扫描不得被最新签名覆盖，仍须保留 FIX-BATCH 锚。
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending' });
      assertExit(runState(['next'], dir, env), 0); // 受控归位 execute
      completeFixTaskAndRecord(dir, env); // 第一波：单修复任务 done + 声明/record
      const wave1 = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(wave1, 0);
      assertOut(wave1, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(wave1, 'RETURN: 回源节点');
      // 第二波：追加第二个修复任务（任务集签名发散）→ 归位 → 两任务完成后收口
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTwoFixTaskText('pending', 'pending'));
      const wave2Next = runState(['next'], dir, env);
      assertExit(wave2Next, 0);
      assertOut(wave2Next, 'FIX-BATCH: 归位 execute（源节点 review）');
      assertNodeLine(wave2Next, 'execute');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTwoFixTaskText('done', 'done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', execSummaryFixture('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-02-SUMMARY.md', execSummaryFixture('T-FIX-02'));
      assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      assertExit(runState(['record', 'execute', '{"summary":"fix wave two executed","parallelTakeoverApproved":true}'], dir, env), 0);
      const wave2 = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(wave2, 0);
      assertOut(wave2, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(wave2, 'RETURN: 回源节点');
      // 第三趟（把工作归属置回 execute 后直达真实出口，不改任务集）：历史最新签名已==当前签名、
      // 更早签名仍发散——全量签名扫描不得被最新签名覆盖，仍须保留 FIX-BATCH 锚。
      const stWave3 = readStateFile(dir);
      stWave3.currentNode = 'execute';
      writeState(dir, stWave3);
      const wave3 = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(wave3, 0);
      assertOut(wave3, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(wave3, 'RETURN: 回源节点');
      const waveState = readStateFile(dir);
      const waveExits = (waveState.history || []).filter((event) =>
        event && event.event === 'exit-applied' && (event.node === 'execute' || event.node === 'subagent-execute'));
      if (waveExits.length < 3) {
        throw new Error('多波次收口应留下至少三条 execute 家族出口事件: ' + JSON.stringify(waveExits));
      }
      const latestSignature = waveExits[waveExits.length - 1].taskSetSignature;
      if (latestSignature !== waveExits[waveExits.length - 2].taskSetSignature) {
        throw new Error('第三趟收口后最新签名应已等于当前任务集签名（夹具前提）');
      }
      if (latestSignature === waveExits[0].taskSetSignature) {
        throw new Error('多波次任务集签名应已发散（夹具前提）: ' + latestSignature);
      }

      // ⑪ 源未 entry 的真实 Fix：分类只认历史签名/Fix 结构标记，不依赖 enteredNodes → 仍 FIX-BATCH
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending' });
      const noEntryState = readStateFile(dir);
      noEntryState.enteredNodes = (noEntryState.enteredNodes || []).filter((nodeId) => nodeId !== 'review');
      writeState(dir, noEntryState);
      const noEntryNext = runState(['next'], dir, env);
      assertExit(noEntryNext, 0);
      assertOut(noEntryNext, 'FIX-BATCH: 归位 execute（源节点 review）');
      completeFixTaskAndRecord(dir, env);
      const noEntryExit = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(noEntryExit, 0);
      assertOut(noEntryExit, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(noEntryExit, 'RETURN: 回源节点');
      assertNodeLine(noEntryExit, 'review');

      // ⑫ 旧态证据不足：无签名历史、无 Fix 标记 → 中性未分类 RETURN，不 BLOCK、不冒充 Fix、不卡死
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n## 任务清单\n\n' + serialTaskBlock('T01', 'done') + '\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', execSummaryFixture('T01'));
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: { execute: { summary: 'first pass executed' }, review: { summary: 'review reopened' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      assertExit(runState(['record', 'execute', '{"summary":"legacy state closure","parallelTakeoverApproved":true}'], dir, env), 0);
      const legacyExit = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(legacyExit, 0);
      assertOut(legacyExit, 'RETURN: 回源节点 review（execute 出口已完成；旧 state 缺闭合/修复证据，未分类）');
      assertNotOut(legacyExit, 'FIX-BATCH');
      assertNotOut(legacyExit, 'BLOCKED');
      assertNodeLine(legacyExit, 'review');
      const legacyState = readStateFile(dir);
      if (legacyState.currentNode !== 'review') {
        throw new Error('旧态未分类回程应停在 review: ' + JSON.stringify(legacyState.currentNode));
      }

      // ⑬ 受控归位轮次真实链路（review 源）：第 1~3 轮输出「第 n/3 轮」并递增计数；第 4 轮新
      //    change BLOCK（state 字节零改写、currentNode 保持 review）；用户显式授权（嵌套证据）
      //    后放行；verify 失败计数与轮次计数各自独立；旧 change 第 4 轮渐进 WARN 放行。
      const fixRoundsText = (statuses) => '# TASK\n\n## 任务清单\n\n' + serialTaskBlock('T01', 'done')
        + '\n\n## Fix 任务（来自 REVIEW / INTEGRATION）\n\n'
        + statuses.map((s, i) => serialTaskBlock('T-FIX-0' + (i + 1), s)).join('\n') + '\n';
      const doneStatuses = (n) => Array.from({ length: n }, () => 'done');
      const assertRoundCounters = (round, label) => {
        const s = readStateFile(dir);
        if (s.fixRoundsByChange?.ch !== round) {
          throw new Error(label + ' 受控归位轮次应为 ' + round + ': ' + JSON.stringify(s.fixRoundsByChange));
        }
        if (s.verifyFailuresByChange?.ch !== 2) {
          throw new Error(label + ' 不得改写 verify 失败计数（应保持 2）: ' + JSON.stringify(s.verifyFailuresByChange));
        }
      };
      const completeFixRound = (n) => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixRoundsText(doneStatuses(n)));
        for (let i = 1; i <= n; i++) {
          writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-0' + i + '-SUMMARY.md', execSummaryFixture('T-FIX-0' + i));
        }
        assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
        // entry 记录 taskHash：签名值必须带算法版本前缀（新链路 vN 前缀形态）
        assertExit(runGuard(['entry', 'execute'], dir, env), 0);
        const stHash = readStateFile(dir);
        if (!/^v1:[0-9a-f]{64}$/.test(String(stHash.taskHash))) {
          throw new Error('execute entry 应写入带算法版本前缀的任务集签名: ' + JSON.stringify(stHash.taskHash));
        }
        assertExit(runState(['record', 'execute', '{"summary":"fix round ' + n + ' executed","parallelTakeoverApproved":true}'], dir, env), 0);
        const closed = runGuard(['exit', 'execute', '--apply'], dir, env);
        assertExit(closed, 0);
        assertOut(closed, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
        const stEvent = readStateFile(dir);
        const lastExit = [...(stEvent.history || [])].reverse()
          .find((e) => e.event === 'exit-applied' && e.node === 'execute');
        if (!lastExit || lastExit.signatureAlgo !== 'v1' || !/^v1:[0-9a-f]{64}$/.test(String(lastExit.taskSetSignature))) {
          throw new Error('execute 出口事件应携带算法版本元数据（signatureAlgo + vN 前缀签名）: ' + JSON.stringify(lastExit));
        }
        if (stEvent.currentNode !== 'review') {
          throw new Error('第 ' + n + ' 轮收口应回到未完成的 review: ' + JSON.stringify(stEvent.currentNode));
        }
      };

      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending' });
      // verify 失败计数先落到 2——后续 4 轮归位都不得触碰该值
      assertExit(runState(['verify-fail'], dir, env), 0);
      const vfTwo = runState(['verify-fail'], dir, env);
      assertExit(vfTwo, 0);
      assertOut(vfTwo, 'VERIFY-FAIL: 2/3');
      for (let round = 1; round <= 3; round++) {
        const rollback = runState(['next'], dir, env);
        assertExit(rollback, 0);
        assertOut(rollback, 'FIX-BATCH: 归位 execute（源节点 review）');
        assertOut(rollback, '（第 ' + round + '/3 轮）');
        assertRoundCounters(round, '第 ' + round + ' 轮');
        completeFixRound(round);
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixRoundsText([...doneStatuses(round), 'pending']));
      }
      // 第 4 轮：新 change BLOCK；state 字节零改写、currentNode 保持 review、轮次仍为 3
      const round4Bytes = fs.readFileSync(statePath, 'utf8');
      const round4Block = runState(['next'], dir, env);
      assertExit(round4Block, 1);
      assertOut(round4Block, 'BLOCKED');
      assertOut(round4Block, '第 4 轮需用户决策');
      assertOut(round4Block, '继续修');
      assertOut(round4Block, '停止');
      assertOut(round4Block, 'fixRoundOverride');
      if (fs.readFileSync(statePath, 'utf8') !== round4Bytes) {
        throw new Error('第 4 轮 BLOCK 不得改写 state 字节（currentNode/计数均不得变化）');
      }
      let round4State = readStateFile(dir);
      if (round4State.currentNode !== 'review') {
        throw new Error('第 4 轮 BLOCK 不得改写 currentNode: ' + JSON.stringify(round4State.currentNode));
      }
      assertRoundCounters(3, '第 4 轮 BLOCK 后');
      // F5 真实链路：不完整授权（仅 round，缺 at/source）按未授权 fail-closed——仍 BLOCK 且
      // state 字节零改写；随后补全完整三元组才放行（BLOCK → 非法形态仍 BLOCK → 完整授权 → 放行）。
      round4State.evidence.review = {
        ...(round4State.evidence.review || {}),
        fixRoundOverride: { round: 4 },
      };
      writeState(dir, round4State);
      const incompleteBytes = fs.readFileSync(statePath, 'utf8');
      const round4Incomplete = runState(['next'], dir, env);
      assertExit(round4Incomplete, 1);
      assertOut(round4Incomplete, 'BLOCKED');
      assertNotOut(round4Incomplete, '（第 4/3 轮）');
      if (fs.readFileSync(statePath, 'utf8') !== incompleteBytes) {
        throw new Error('F5 缺 at/source 的不完整授权必须 fail-closed：state 字节零改写');
      }
      assertRoundCounters(3, 'F5 不完整授权 BLOCK 后');
      if (readStateFile(dir).currentNode !== 'review') {
        throw new Error('F5 不完整授权不得改写 currentNode（应保持 review）');
      }
      // 用户显式授权：嵌套 evidence 补全 round/at/source 三元组 → 同一入口放行第 4 轮
      round4State = readStateFile(dir);
      round4State.evidence.review = {
        ...(round4State.evidence.review || {}),
        fixRoundOverride: { round: 4, at: new Date().toISOString(), source: 'user' },
      };
      writeState(dir, round4State);
      const round4Authorized = runState(['next'], dir, env);
      assertExit(round4Authorized, 0);
      assertOut(round4Authorized, 'FIX-BATCH: 归位 execute（源节点 review）（第 4/3 轮）');
      round4State = readStateFile(dir);
      if (round4State.currentNode !== 'execute' || round4State.fixRoundsByChange?.ch !== 4) {
        throw new Error('授权后应放行第 4 轮并计数到 4: '
          + JSON.stringify({ currentNode: round4State.currentNode, rounds: round4State.fixRoundsByChange }));
      }
      completeFixRound(4);
      // 轮次计数不影响 verify 预算：同一 change 继续失败到 3/3 仍可用，第 4 次才超限
      const vfThree = runState(['verify-fail'], dir, env);
      assertExit(vfThree, 0);
      assertOut(vfThree, 'VERIFY-FAIL: 3/3');
      const vfFour = runState(['verify-fail'], dir, env);
      assertExit(vfFour, 1);
      assertOut(vfFour, '超限');
      if (readStateFile(dir).fixRoundsByChange?.ch !== 4) {
        throw new Error('verify 失败累计不得改写 Fix 轮次计数: ' + JSON.stringify(readStateFile(dir).fixRoundsByChange));
      }
      // 旧 change 第 4 轮渐进：WARN 后照常归位（不 BLOCK、不卡死）
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'pending', newChange: false });
      const oldRoundState = readStateFile(dir);
      oldRoundState.fixRoundsByChange = { ch: 3 };
      writeState(dir, oldRoundState);
      const oldRound4 = runState(['next'], dir, env);
      assertExit(oldRound4, 0);
      assertOut(oldRound4, 'FIX-BATCH WARN');
      assertOut(oldRound4, '（第 4/3 轮）');
      assertNotOut(oldRound4, 'BLOCKED');
      const oldRoundAfter = readStateFile(dir);
      if (oldRoundAfter.currentNode !== 'execute' || oldRoundAfter.fixRoundsByChange?.ch !== 4) {
        throw new Error('旧 change 第 4 轮应渐进归位并计数: '
          + JSON.stringify({ currentNode: oldRoundAfter.currentNode, rounds: oldRoundAfter.fixRoundsByChange }));
      }

      // ⑭ 签名算法版本可判别（真实命令链路）：跨版本（v2 事件 vs 当前 v1）不做同版本比对——
      //    不得把正常回程误判为未闭合 Fix；同版本 legacy 裸 hex 按既有语义参与（②⑤ 已锚）。
      writeFixBatchFixture(dir, { kind: 'review', fixStatus: 'done' });
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', execSummaryFixture('T-FIX-01'));
      const versionSkewState = readStateFile(dir);
      versionSkewState.history = [{
        event: 'exit-applied', node: 'execute', change: CHANGE_ID, at: '2026-09-20T00:00:00.000Z',
        taskSetSignature: 'v2:' + '0'.repeat(64), signatureAlgo: 'v2',
      }];
      writeState(dir, versionSkewState);
      // 清掉本项先前 verify 子场景遗留的 TEST/UAT，使回程路由确定为 verify（夹具前提）
      fs.rmSync(path.join(dir, '.specs', CHANGE_ID, 'TEST.md'), { force: true });
      fs.rmSync(path.join(dir, '.specs', CHANGE_ID, 'UAT.md'), { force: true });
      assertExit(runState(['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'review'], dir, env), 0);
      const skewExit = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(skewExit, 0);
      assertOut(skewExit, 'ALL CHECKS PASSED');
      assertNotOut(skewExit, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNodeLine(skewExit, 'verify');

    },
  },
];
