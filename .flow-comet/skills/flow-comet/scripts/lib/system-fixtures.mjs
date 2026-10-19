// system-fixtures.mjs — 系统测试集的夹具与判据助手（单一来源）
//
// 定位：`system-test.mjs` 的十三个条目组文件（`items/*.mjs`）共用的夹具。条目组文件是**数据层**——
// 只承载 `export const ENTRIES = [...]`（计数派生按此聚合，见 `count-derivation.mjs`），夹具一律从本
// 模块取；组文件之间零 import，兄弟组之间没有边。
//
// 为什么单独成册：`test-fixtures.mjs` 是 `guard-self-test.mjs` 的场景夹具——与 `test-helpers.mjs`
// 的分工同形，同名同责的工具汇在 `test-helpers`（单一来源），**各套件特有**的夹具各自成册。
// 本模块与 `test-fixtures.mjs` 并列，两者互不 import。
//
// 内容分族（自上而下）：① 状态 / git / 工件与 Return Contract 夹具；② 修复回路真实命令链路夹具；
// ③ explain 契约对账夹具；④ 多趟链路材料；⑤ 分发面（npm 包形态）判据与包体断言；⑥ 安装器升级
// 路径清理与镜像根 fail-closed；⑦ 桥接 loader 版本戳重装；⑧ hook 注入命令形态判定。
//
// 路径推导：本模块位于 `<技能包>/scripts/lib/`，`SCRIPTS_DIR` 由 import.meta.url 相对推导——技能树内
// 兄弟脚本路径一律由它拼接，取用方不再各自推导同一条路径。

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { assertExit, assertOut, copyTreePortable, runGuard, runState, writeFile, writeState } from './test-helpers.mjs';
import { NODE_ARTIFACT_TEMPLATES } from '../protocol-utils.mjs';

// 路径推导基准：技能包 scripts/ 目录（与套件入口同基准）
export const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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


// open 阶段工件（CHANGE 含 Why；REQUIREMENT 含 用户故事 + 验收准则——通过出口校验的完整形态）。
// 「视觉调性」是 CHANGE 模板的条件段且新 change 要求在场：夹具按其结构形态标注「不适用」
//（独立行 + 理由），使前端判据稳定地判为非前端——不写这段会让 ui-design 门对新 change 报「段缺席」。
export function writeIntakeArtifacts(root, changeId = CHANGE_ID) {
  writeFile(root, '.specs/' + changeId + '/CHANGE.md', '# CHANGE\n\n- **Change ID**: ' + changeId
    + '\n\n## Why（为什么做）\n\n变更目标。\n\n## 视觉调性\n\n不适用（夹具：后端任务，无用户可见界面）。\n');
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
    '## LESSONS 扫描',
    '',
    '无 active 条目命中（夹具：本任务 write_files 与 .specs/LESSONS.md 关键词行无交集）。',
    '',
  ].join('\n');
}

// 同夹具的「段内大写 Z 早于方法名」变体（真实机检标记形态）：6 维自查段体首行是含大写 Z 的机检
// 标记说明，方法声明行在其后。段尾判定若把大写 Z 当串尾（惰性段体在段内首个 Z 处提前收尾），
// 方法声明被截掉 ⇒ execute 家族出口误判「6 维自查未声明自检方法」而 BLOCK。
// 夹具前提不成立（段标题形态变化）即抛错——不让变体静默退化成与基线逐字节相同的形态。

// ---------- 修复回路真实命令链路夹具（A21~A23 共用） ----------

// 串行任务块（字段齐备：可过 task-parsing 解析与 guard 结构校验）
export function serialTaskBlock(id, status) {
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
export function fixBatchParallelTaskText(fixStatus) {
  return '# TASK\n\n## 任务清单\n\n' + serialTaskBlock('T01', 'done') +
    '\n\n## Fix 任务（来自 REVIEW / INTEGRATION）\n\n'
    + '<task id="P-FIX-01" parallel="true" status="' + fixStatus + '">'
    + '<action>实现 P-FIX-01</action><write_files>src/p-fix-01.mjs</write_files>'
    + '<verify>node --check src/p-fix-01.mjs</verify></task>\n';
}

// 两波修复任务集（多波次真实 Fix 链路夹具）：既有任务 T01 done + Fix 段内两个修复任务，
// 两个修复任务的状态由入参分别指定——第一波收口后追加第二波，任务集签名随之发散。
export function fixBatchTwoFixTaskText(fixStatus1, fixStatus2) {
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
export function fixBatchHistoryWithStaleExecuteExit() {
  return [{ event: 'exit-applied', node: 'execute', at: '2026-09-20T00:00:00.000Z', taskSetSignature: STALE_TASK_SET_SIGNATURE }];
}

// Fix 批次夹具写入：state + TASK + 既有任务 SUMMARY + REVIEW.md（verify 源另备 TEST/UAT）。
// kind='review'（审查驻留，execute 已首次完成）/ 'verify'（验证驻留，review 已完成）；
// newChange=false 时 state 不带新 change 标记（旧 change 渐进形态）。
export function writeFixBatchFixture(dir, { kind, fixStatus, newChange = true, parallelFix = false }) {
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
  assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md', '--templates', 'SUMMARY.md'], dir, env), 0);
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
    skills: [], skillsNone: false, templates: [], commands: [],
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
    } else if (/^TEMPLATE(?:（条件模板）)?: /.test(line)) {
      parsed.templates.push(line);
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

// ⑤ 模板指针行：内置节点取引擎 C3 映射、自定义协议节点取 node.templates，零模板节点不打印。
// 期望值在这里**独立构造**（不调 explain 侧的格式化函数）：措辞、路径根或 .md 后缀的漂移
// 才能被这条锥抓到。
function explainTemplateProblems(node, parsed) {
  const builtin = NODE_ARTIFACT_TEMPLATES[node.id];
  const required = builtin ? builtin.required : (node.templates ?? []);
  const optional = builtin ? (builtin.optional ?? []) : [];
  const expected = [];
  for (const name of required) expected.push('TEMPLATE: flow-kit/templates/' + name + '.md');
  for (const name of optional) expected.push('TEMPLATE（条件模板）: flow-kit/templates/' + name + '.md（仅前端 change）');
  if (JSON.stringify(parsed.templates) === JSON.stringify(expected)) return [];
  return ['节点 ' + node.id + ' 的 TEMPLATE 行与节点模板声明不一致: 输出 '
    + JSON.stringify(parsed.templates) + ' / 期望 ' + JSON.stringify(expected)];
}

// ⑥ 三条命令：节点 id 与 --apply 形态 + 脚本根形态（三条同根、指向技能包 scripts 目录）+ 脚本
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

// 逐字段对账（单一实现：真实判据与反向构造探针共用）：五类字段 + 三条命令。
export function explainContractProblems(protocol, explainOutputs) {
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
    problems.push(...explainTemplateProblems(node, parsed));
    problems.push(...explainCommandProblems(node, parsed));
  }
  return problems;
}

// explain 的三种 fail-closed 形态（非法节点 / 缺参 / 拿选项当节点名）：都非零退出并列出全部合法节点。
export function assertExplainFailClosed(dir, protocolDecl) {
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
export function explainReverseConstructionProblems(dir, protocolDecl, explainOutputs) {
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
  // ⑤ 模板指针行的另一面（不需重跑）：真实输出去掉首条 TEMPLATE 行 ⇒ 逐节点必报 TEMPLATE 不一致。
  // 没有这一侧，把模板行从实现里拿掉也能全绿（对账恒真空过）。
  const strippedTemplates = new Map();
  for (const [nodeId, output] of explainOutputs) {
    const lines = String(output).split(/\r?\n/);
    const index = lines.findIndex((line) => line.startsWith('TEMPLATE: '));
    if (index < 0) continue;
    strippedTemplates.set(nodeId, [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n'));
  }
  if (strippedTemplates.size === 0) {
    problems.push('反向构造前提不成立：没有任何节点的 explain 输出含 TEMPLATE: 行（模板指针判据无从判别）');
  } else {
    const templateProblems = explainContractProblems(protocolDecl, new Map([...explainOutputs, ...strippedTemplates]));
    for (const nodeId of strippedTemplates.keys()) {
      if (!templateProblems.some((problem) => problem.includes('节点 ' + nodeId + ' 的')
        && problem.includes('TEMPLATE 行'))) {
        problems.push('反向构造判别力缺失（去掉节点 ' + nodeId + ' 的 TEMPLATE 行未被判不一致）');
      }
    }
  }
  return problems;
}

// 混排多波 TASK：双并行开路 → 串行衔接(依赖双并行)→ 收尾并行(依赖串行衔接)。
// 各任务 status 由入参映射（任务 id → 'pending'|'done'）控制；status 变更不影响任务集签名
// （签名仅保留 id/parallel 与块内容，剥离 status 类属性）。串行衔接置于两并行波之间——
// 引擎契约下 execute 出口要求全部串行已消化，跨趟多次交替由「并行波→串行波→并行波」承载。
export function multiWaveTaskContent(statusMap) {
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
  assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md', '--templates', 'CHANGE.md,REQUIREMENT.md'], dir), 0);
  writeIntakeArtifacts(dir);
  assertExit(runState(['record', 'open', '{"summary":"intake complete"}'], dir), 0);
  assertExit(runGuard(['entry', 'open'], dir), 0);
  assertExit(runGuard(['exit', 'open', '--apply'], dir), 0);
  assertExit(runState(['skill-load', 'design', 'flow-comet-design', '--prompt', 'flow-kit/prompts/2-design.md', '--templates', 'DESIGN.md'], dir), 0);
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


export const CONTRACT = path.join(SCRIPTS_DIR, 'contract-check.mjs');

// 递归收集目录下相对文件清单（排序稳定，供 K8/K10 技能整树清单/内容比对）
export function collectTreeFiles(root) {
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

// ---------- 分发面包体断言助手（npm 包形态：环境判据 / 结果标记 / 可发布性清单 / 包体边界 / bin 双入口） ----------

// 环境判据（结构化事实，不做路径字符串猜测）：本套件在权威源与安装副本内都会运行，
// 而包体质检只有权威源侧可判——判据落空时输出显式「不适用」行并计通过，禁止静默跳过。
//   权威源侧 = 脚本上溯 4 层（包根）**同时**满足：存在 `name === 'flow-comet'` 的 package.json
//     **且** `.flow-comet/skills/flow-comet` 权威树在位；
//   安装副本侧 = <target>/.claude|.agents|.dsh/skills/flow-comet/scripts 上溯 4 层 = 目标项目根
//     → 判「不适用」（判定写反会让每个已安装项目假红）。
// 两个条件是**并列必要**的：只看 manifest 名字会把「恰好同名的消费项目」（依赖里带同名包、
// 或项目自身就叫 flow-comet 但无权威树）判成权威源——于是包体质检在该项目里跑 npm pack 而不是
// 输出「不适用」（判据过宽的另一失败模式）。权威树在场时 manifest 缺失/不可解析/name 不符
// → 必须失败（判定过宽会让权威源侧的包体断言静默漏检）。
// root 可覆盖（默认真实包根）——仅为可测性接缝：使上述四种形态能在夹具目录上被逐条驱动
// （否则判据的判别力只能靠人工实验验证，回归时可能被改宽而套件仍全绿）。生产调用不传该参数。
export function resolvePackageContext(root = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..')) {
  const authoritative = fs.existsSync(path.join(root, '.flow-comet', 'skills', 'flow-comet'));
  const notApplicable = (reason) => ({ kind: 'copy', reason: reason || '根目录无本包权威源（name=flow-comet 的 package.json + .flow-comet/skills/flow-comet 权威树）' });
  const manifest = path.join(root, 'package.json');
  if (!fs.existsSync(manifest)) {
    if (authoritative) throw new Error('权威源包根缺少 package.json: ' + manifest);
    return notApplicable();
  }
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  } catch (e) {
    if (authoritative) throw new Error('权威源 package.json 不可解析: ' + e.message);
    return notApplicable();
  }
  if (!pkg || pkg.name !== 'flow-comet') {
    if (authoritative) throw new Error('权威源 package.json 的 name 应为 flow-comet，实际 ' + JSON.stringify(pkg && pkg.name));
    return notApplicable();
  }
  if (!authoritative) {
    return notApplicable('根目录有 name=flow-comet 的 package.json 但权威树（.flow-comet/skills/flow-comet）不在位——同名不构成权威源，按安装副本判定');
  }
  return { kind: 'source', root, pkg };
}

// 环境判据的判别力锚（正反两向逐形态驱动）：判据写宽（manifest 名字相符即认权威源）会让同名
// 消费项目被当成权威源；写反/写严则两侧互串（副本侧假红 / 权威源侧静默漏检）。夹具形态：
//   ① 权威树不在 + 同名 manifest → copy（同名 ≠ 权威源）
//   ② 权威树不在 + 无 manifest   → copy
//   ③ 权威树在场 + 同名 manifest → source
//   ④ 权威树在场 + 无 manifest / manifest 不可解析 / name 不符 → 抛错（既有行为保持，不得放宽）
// 夹具建在调用方给定的临时目录内（随该项临时目录一并清理，不留残留）。
export function assertPackageContextJudgment(scratch) {
  const fixture = (name, options) => {
    const root = path.join(scratch, name);
    const tree = path.join(root, '.flow-comet', 'skills', 'flow-comet');
    if (options.tree) fs.mkdirSync(tree, { recursive: true });
    else fs.mkdirSync(root, { recursive: true });
    if (options.manifest !== undefined) fs.writeFileSync(path.join(root, 'package.json'), options.manifest, 'utf8');
    return root;
  };
  const expectKind = (root, expected, label) => {
    const ctx = resolvePackageContext(root);
    if (ctx.kind !== expected) {
      throw new Error('环境判据失配（' + label + '）：期望 ' + expected + '，实际 ' + ctx.kind);
    }
  };
  const expectThrow = (root, label) => {
    let threw = null;
    try { resolvePackageContext(root); } catch (e) { threw = e; }
    if (!threw) {
      throw new Error('环境判据失配（' + label + '）：权威树在场而 manifest 畸形时应显式失败，实际未抛错');
    }
  };
  expectKind(fixture('same-name-consumer', { tree: false, manifest: '{"name":"flow-comet"}' }), 'copy', '权威树不在 + 同名 manifest');
  expectKind(fixture('plain-consumer', { tree: false, manifest: undefined }), 'copy', '权威树不在 + 无 manifest');
  expectKind(fixture('authoritative', { tree: true, manifest: '{"name":"flow-comet"}' }), 'source', '权威树在场 + 同名 manifest');
  expectThrow(fixture('authoritative-no-manifest', { tree: true, manifest: undefined }), '权威树在场 + 无 manifest');
  expectThrow(fixture('authoritative-broken', { tree: true, manifest: '{ not json' }), '权威树在场 + manifest 不可解析');
  expectThrow(fixture('authoritative-other-name', { tree: true, manifest: '{"name":"other"}' }), '权威树在场 + name 不符');
  console.log('  环境判据: 副本侧同名/无名两形态判「不适用」，权威源侧判「权威源」，畸形 manifest 三形态显式失败 ✓');
}

// 分发面结果标记（机器可读）：本套件在权威源与安装副本两侧都会运行，而断言只在权威源侧真跑——
// 两侧的区别（「已执行」/「不适用」/「未执行」）必须留在运行器可捕获的结果里，不能只打 console 行
// 靠人工核验。前两行即两侧的正反锚点：权威源侧回传 executed、安装副本侧回传 not-applicable，
// 写反则该侧判失败。另两态是「真跑了但没验成」的两类原因，只在权威源侧出现：
//   platform     平台条件不满足（条目内某条子断言在本环境无法构造前置）；
//   toolMissing  本地工具缺失（仓库本地检查器不随克隆分发，整项无从执行）。
export const DISTRIBUTION_MARKERS = {
  source: 'distribution:executed@source',
  copy: 'distribution:not-applicable@copy',
  platform: 'distribution:not-applicable@platform',
  toolMissing: 'distribution:not-executed@tool-missing',
};

// 三态读数（运行器收尾行用）：条目级标记 → 状态，**不适用 / 未执行不得并入「通过」**。
// platform 不在表内——它是条目内**子断言**的态（条目自身的面已真跑），不是条目的态；
// 它与条目级三态分区互不混淆（子断言由运行器逐条打印，见 createOutcomeRecorder）。
const DISTRIBUTION_ITEM_STATES = {
  [DISTRIBUTION_MARKERS.source]: 'passed',
  [DISTRIBUTION_MARKERS.copy]: 'not-applicable',
  [DISTRIBUTION_MARKERS.toolMissing]: 'not-executed',
};
export function distributionState(marker) {
  return DISTRIBUTION_ITEM_STATES[marker] || null;
}

// K14 安装副本侧「不适用」说明：K14 分支与契约夹具共用同一字面量来源（防两处文案漂移）。
export const K14_COPY_DETAIL = '桥接 loader 版本戳重装断言仅权威源侧可判';

// 运行器侧标记契约校验（分发面项）：标记必须显式在场且与结构化环境判据推出的期望值一致。
//   缺标记 = 该项走了静默跳过（「未验证 ≠ 通过」，与显式「不适用」是两回事）→ 失败；
//   标记与环境不符 = 环境判据写反（副本侧假红 / 权威源侧静默漏检）→ 失败。
// 两个原因态（platform / toolMissing）只在权威源侧真跑时产生——副本侧在早期分支已回传
// not-applicable@copy，故它们出现在副本环境即判定写错（把原因态当成了副本态）。
// ctx 是可注入接缝（默认按真实环境判据解析）：使两侧错配与非法 marker 的失败路径能由夹具
// 合成 ctx 真实驱动（否则这些分支没有调用者，判定被改宽也没有断言能拦住）。
export function assertDistributionOutcome(itemName, marker, ctx = resolvePackageContext()) {
  const legal = Object.values(DISTRIBUTION_MARKERS);
  if (!legal.includes(marker)) {
    throw new Error('分发面结果标记缺席或非法（应回传 ' + legal.join(' 或 ') + '，实际 ' + JSON.stringify(marker)
      + '）——禁止静默跳过');
  }
  const expected = DISTRIBUTION_MARKERS[ctx.kind];
  const reasonState = marker === DISTRIBUTION_MARKERS.platform || marker === DISTRIBUTION_MARKERS.toolMissing;
  // 原因态（platform / toolMissing）只允许在权威源侧出现——副本侧在早期分支就回传了
  // not-applicable@copy，此处出现原因态即判定写错（原因态被当成了副本态的替代）。
  if (marker !== expected && !(reasonState && ctx.kind === 'source')) {
    throw new Error('分发面结果标记与环境判据不符：本环境应 ' + expected + '，实际 ' + marker
      + '（判定写反会让该侧静默漏检或假红）');
  }
  console.log('OUTCOME: ' + itemName + ' → ' + marker);
}

// 平台条件子断言的结果登记（「不适用（平台原因）」面）：子断言不是条目本身——它的不适用不改写条目
// 自己的读数，而是**自己出声**（相邻的显式行 + 运行器收尾的机器可读 OUTCOME 行），使「未验证」
// 在日志与证据里可逐条核对，不再无痕计入通过。记录器由运行器按项创建、作为 run(dir, outcomes) 的
// 第二参数注入（无跨文件可变全局状态，也不会串项）。
export function createOutcomeRecorder() {
  const recorded = [];
  return {
    notApplicablePlatform(assertion, reason) {
      if (typeof assertion !== 'string' || assertion.trim() === ''
          || typeof reason !== 'string' || reason.trim() === '') {
        throw new Error('平台不适用回传契约要求非空 assertion 与 reason，实际 '
          + JSON.stringify({ assertion, reason }));
      }
      recorded.push({ assertion, reason, marker: DISTRIBUTION_MARKERS.platform });
      console.log('  不适用（平台原因：' + reason + '）——' + assertion + '（该子断言本环境无法验证；未验证 ≠ 通过）');
    },
    drain() { return recorded.splice(0, recorded.length); },
  };
}

// 分发面条目的统一接入（安装器/平台链路断言）：权威源侧真跑，安装副本侧回传显式
// 「不适用（安装副本侧）」标记——两侧都出声，杜绝「裸 return 静默跳过仍计通过」。
// 条目在自己的定义处用 `surface: '<说明>'` 声明「我属分发面、不适用的是哪个面」，导出前经本函数
// 接入：接入后条目上的是既有契约字段 `distributionSurface: true`（运行器按该字段断言标记）。
// copy 判定与「已执行」回传只写一份（单源不复制），声明就在条目旁边（不另立名单——名单会与
// 条目漂移且缺失时无人发现）。
export function applyDistributionSurface(entry) {
  if (!entry || entry.surface === undefined) return entry;
  const { surface, ...rest } = entry;
  if (typeof surface !== 'string' || surface.trim() === '') {
    throw new Error('分发面声明 surface 必须是非空说明（条目 ' + entry.name + '），实际 ' + JSON.stringify(surface));
  }
  if (typeof rest.run !== 'function' || typeof rest.name !== 'string') {
    throw new Error('分发面条目接入契约要求 name 与 run，实际 ' + JSON.stringify(Object.keys(rest)));
  }
  return {
    name: rest.name,
    distributionSurface: true,
    // async：条目自身可能是 async（K11/K12）——不 await 会把 Promise 当结果回传（marker 丢失）
    run: async (dir, outcomes) => {
      const ctx = resolvePackageContext();
      if (ctx.kind === 'copy') {
        const outcome = copyDistributionOutcome(ctx, surface);
        console.log(outcome.message);
        return outcome.marker;
      }
      const result = await rest.run(dir, outcomes);
      // 权威源侧：条目跑完即回传「已执行」——除非条目自己回传了更具体的态（原因态）
      return result === undefined ? DISTRIBUTION_MARKERS.source : result;
    },
  };
}

// copy 形态「不适用」回传：文案与机器可读结果标记同源产出（文案是「非静默跳过」的证据）。
// 返回 { message, marker } 供 early-return 分支直接消费，也使夹具无需捕获 stdout 即可逐字驱动断言。
// 非 copy ctx 必须 fail-closed——不允许把 source 形态的 marker 与「不适用」文案拼在一起。
export function copyDistributionOutcome(ctx, detail) {
  if (!ctx || ctx.kind !== 'copy' || typeof ctx.reason !== 'string' || ctx.reason.trim() === '') {
    throw new Error('copy 回传契约要求 kind=copy 且含非空 reason，实际 ' + JSON.stringify(ctx));
  }
  return {
    message: '  不适用（安装副本侧：' + ctx.reason + '）——' + detail + '，本项计通过',
    marker: DISTRIBUTION_MARKERS[ctx.kind],
  };
}

// 分发面回传契约夹具（环境无关；K14 在副本 early-return 之前调用，故两侧都会真跑）：
//   ① 失败路径负例必须 throw——copy ctx + source marker / source ctx + copy marker /
//      undefined 或非法 marker / 副本环境回传两个「原因态」（缺可注入 ctx 接缝时这些路径没有调用者）；
//   ② 接缝正例：两侧 marker 与 ctx 匹配时必须通过（含两个原因态）；
//   ③ copy 形态真实判据 + helper 文案/marker 同源产出；
//   ④ 子断言记录器契约：登记 → 摘要行 → 取空；空 assertion/reason 必须 fail-closed。
export function assertDistributionOutcomeContract(scratch) {
  const expectThrow = (fn, label) => {
    let threw = null;
    try { fn(); } catch (e) { threw = e; }
    if (!threw) throw new Error('分发面回传契约失配（' + label + '）：失败路径应抛错而未抛错');
  };
  // ① 失败路径负例先驱动：接缝缺失时先在此以「应抛错而未抛错」暴露，不被后续环境相关失败掩盖
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:copy ctx + source marker', DISTRIBUTION_MARKERS.source, { kind: 'copy', reason: '夹具' }), 'copy ctx + source marker');
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:source ctx + copy marker', DISTRIBUTION_MARKERS.copy, { kind: 'source' }), 'source ctx + copy marker');
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:undefined marker', undefined, { kind: 'copy', reason: '夹具' }), 'undefined marker');
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:非法 marker', 'distribution:unknown', { kind: 'copy', reason: '夹具' }), '非法 marker');
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:copy ctx + platform marker', DISTRIBUTION_MARKERS.platform, { kind: 'copy', reason: '夹具' }), 'copy ctx + platform marker');
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:copy ctx + tool-missing marker', DISTRIBUTION_MARKERS.toolMissing, { kind: 'copy', reason: '夹具' }), 'copy ctx + tool-missing marker');
  // ② 接缝正例
  assertDistributionOutcome('分发面契约夹具:copy 正例', DISTRIBUTION_MARKERS.copy, { kind: 'copy', reason: '夹具' });
  assertDistributionOutcome('分发面契约夹具:source 正例', DISTRIBUTION_MARKERS.source, { kind: 'source' });
  assertDistributionOutcome('分发面契约夹具:platform 正例', DISTRIBUTION_MARKERS.platform, { kind: 'source' });
  assertDistributionOutcome('分发面契约夹具:tool-missing 正例', DISTRIBUTION_MARKERS.toolMissing, { kind: 'source' });
  // ③ copy 形态真实判据 + helper 文案/marker 同源
  const copyCtx = resolvePackageContext(path.join(scratch, 'k14-copy-probe'));
  if (copyCtx.kind !== 'copy' || typeof copyCtx.reason !== 'string' || copyCtx.reason.trim() === '') {
    throw new Error('分发面回传契约夹具 copy 判据失配: ' + JSON.stringify(copyCtx));
  }
  const copyOutcome = copyDistributionOutcome(copyCtx, K14_COPY_DETAIL);
  if (copyOutcome.marker !== DISTRIBUTION_MARKERS.copy) {
    throw new Error('分发面回传契约 copy marker 失配: ' + JSON.stringify(copyOutcome.marker));
  }
  if (!copyOutcome.message.includes('不适用（安装副本侧：' + copyCtx.reason + '）')
      || !copyOutcome.message.includes(K14_COPY_DETAIL)
      || !copyOutcome.message.includes('本项计通过')) {
    throw new Error('分发面回传契约 copy 文案失配: ' + JSON.stringify(copyOutcome.message));
  }
  // ④ helper 非 copy ctx 必须 fail-closed（不得把 source marker 伪装成「不适用」）
  expectThrow(() => copyDistributionOutcome({ kind: 'source' }, 'x'), 'copy helper 非 copy ctx');
  // ⑤ 子断言记录器契约：登记即出声（显式行）+ 摘要可逐条取回 + 取空后不再重复；畸形入参 fail-closed。
  const recorder = createOutcomeRecorder();
  if (recorder.drain().length !== 0) throw new Error('子断言记录器初始应为空');
  expectThrow(() => recorder.notApplicablePlatform('', 'x'), '记录器空 assertion');
  expectThrow(() => recorder.notApplicablePlatform('x', '  '), '记录器空 reason');
  recorder.notApplicablePlatform('分发面契约夹具:平台子断言', '夹具平台原因');
  const drained = recorder.drain();
  if (drained.length !== 1 || drained[0].marker !== DISTRIBUTION_MARKERS.platform
      || drained[0].assertion !== '分发面契约夹具:平台子断言' || drained[0].reason !== '夹具平台原因') {
    throw new Error('子断言记录器回传失配: ' + JSON.stringify(drained));
  }
  if (recorder.drain().length !== 0) throw new Error('子断言记录器取空后不得重复产出（跨项串味）');
  // ⑥ 三态读数映射：三个条目级标记各有归属，「未执行 / 不适用」不得落回 passed
  const stateOf = [
    [DISTRIBUTION_MARKERS.source, 'passed'],
    [DISTRIBUTION_MARKERS.copy, 'not-applicable'],
    [DISTRIBUTION_MARKERS.toolMissing, 'not-executed'],
    [DISTRIBUTION_MARKERS.platform, null],
    [undefined, null],
  ];
  for (const [marker, expected] of stateOf) {
    if (distributionState(marker) !== expected) {
      throw new Error('三态读数映射失配: ' + JSON.stringify(marker) + ' 应 ' + JSON.stringify(expected)
        + '，实际 ' + JSON.stringify(distributionState(marker)));
    }
  }
  console.log('  分发面回传契约: copy 文案/marker + 两侧与两原因态正例 + 四类失败路径负例 + 子断言记录器/三态映射 ✓');
}

// 跑 `npm pack --dry-run --json`（只读，不产出 tarball）并解析出产物相对路径清单。
// 命令以字符串形态经 shell 执行（与 workflow-guard verify 命令执行同形态）：Windows 上 npm 是
// npm.cmd（CreateProcess 不解析 .cmd 后缀，且 Node 对 .cmd/.bat 直接 spawn 属 EINVAL）——
// 字符串 + shell 是全平台唯一稳妥形态。解析失败即报错（不做文本兜底：静默回退会掩盖 npm 形态漂移）。
function runNpmPackDryRun(root) {
  const res = spawnSync('npm pack --dry-run --json', {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const status = res.status ?? 1;
  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  if (status !== 0) {
    throw new Error('npm pack --dry-run 退出码 ' + status + '（npm 缺失或环境异常）\nstdout:\n' + stdout + '\nstderr:\n' + stderr);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    throw new Error('npm pack --dry-run --json 输出不可解析: ' + e.message + '\nstdout(前 500 字):\n' + stdout.slice(0, 500) + '\nstderr:\n' + stderr);
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const files = entry && Array.isArray(entry.files) ? entry.files.map((f) => String(f.path).replaceAll('\\', '/')) : null;
  if (!files || files.length === 0) throw new Error('npm pack --dry-run 产物清单为空（--json 未列出任何文件）');
  return files;
}

// ① 清单可发布性：`private` 在场即 npm 拒绝发布——被误加回会让包不可发布，而包体边界断言
// （按效果覆盖 files/version）与 CI 版本对账都察觉不到，故独立成锚。允许缺席或显式非真值。
// 同时守住公开身份与运行时前提（license / engines.node）：这些元数据随版本固化在发布物上，
// 发布后才察觉漏声明只能等下一个版本补救，故与 private 同点做在场锚定。
export function assertPublishableManifest(pkg) {
  if (pkg.private) {
    throw new Error('package.json 的 private 应缺席（或显式非真值），实际 ' + JSON.stringify(pkg.private)
      + '——置真值会让 npm 拒绝发布');
  }
  if (pkg.license !== 'MIT') {
    throw new Error('package.json 的 license 应为 MIT（与仓库 LICENSE 文件一致），实际 '
      + JSON.stringify(pkg.license) + '——包被 npm 打进发布物时该字段随版本固化');
  }
  const nodeFloor = pkg.engines ? pkg.engines.node : undefined;
  if (nodeFloor !== '>=18') {
    throw new Error('package.json 的 engines.node 应为 >=18（文档与 CI 声明的运行时前提），实际 '
      + JSON.stringify(nodeFloor) + '（engines 整段缺失时为 undefined）');
  }
  console.log('  清单可发布性: private 缺席 / license=' + pkg.license + ' / engines.node=' + nodeFloor + ' ✓');
}

// 随包 scripts/ 面的唯一白名单（包体边界与本项反向构造的载体共用同一常量）：bin 双入口两个 +
// `scripts/lib/` 下安装器的六个职责模块（入口静态 import 全部六个，缺一即启动失败）。
// `package.json` 的 `files` 以**目录级**纳入 `scripts/lib`（新增模块不登记即被判越界，fail-closed），
// 故「实际进包集合」由本白名单判等：多一件 = 未纳管进包，少一件 = 发布后 ERR_MODULE_NOT_FOUND。
// CI 的 installer job 是同一判据的**独立实现**（两侧没有任何机制能发现彼此失同步，改动任一侧必须同步）。
export const PACKED_SCRIPTS = [
  'scripts/prepare-env.mjs',
  'scripts/dsh-bridge.mjs',
  'scripts/lib/installer-platforms.mjs',
  'scripts/lib/installer-migrate.mjs',
  'scripts/lib/installer-hooks.mjs',
  'scripts/lib/installer-loader.mjs',
  'scripts/lib/installer-cleanup.mjs',
  'scripts/lib/installer-flowkit.mjs',
];

// ② 包体边界：必含面在场 / 私有面零命中 / scripts 面精确等于白名单 / 顶层白名单 fail-closed /
// 权威源技能树逐文件在场（漏收 = 安装期炸或平台静默退化——协议 JSON 也在内）。
export function assertPackageBoundary(root) {
  const files = runNpmPackDryRun(root);
  const packedUnder = (prefix) => files.some((p) => p.startsWith(prefix + '/'));
  const required = [
    ['.flow-comet/skills', () => packedUnder('.flow-comet/skills')],
    ['.flow-comet/rules/flow-comet-orchestration.md', () => files.includes('.flow-comet/rules/flow-comet-orchestration.md')],
    ...PACKED_SCRIPTS.map((p) => [p, () => files.includes(p)]),
  ];
  for (const [label, ok] of required) {
    if (!ok()) throw new Error('包体缺少必需路径: ' + label);
  }
  // 私有面零命中（提交钩子与本地词表 / 仓库工作笔记 / 流程工件 / 仓库级 AI 上下文与 CI 资产 / 演示图）
  const forbidden = ['.githooks/', 'docs/internal/', '.specs/', 'CLAUDE.md', 'AGENTS.md', '.github/', 'images/'];
  for (const prefix of forbidden) {
    const hit = files.filter((p) => p === prefix.replace(/\/$/, '') || p.startsWith(prefix));
    if (hit.length > 0) throw new Error('包体含私有面路径 ' + prefix + ': ' + hit.slice(0, 5).join(', '));
  }
  // 随包 scripts/ 面精确等于白名单（本地工具脚本——提交钩子安装器/本地检查器一类——不得进包）
  const extraScripts = files.filter((p) => p.startsWith('scripts/') && !PACKED_SCRIPTS.includes(p));
  if (extraScripts.length > 0) {
    throw new Error('包体含未纳管的 scripts/ 条目（本地工具脚本不得进包）: ' + extraScripts.join(', '));
  }
  // 顶层条目仅允许已声明的两棵子树 + npm 恒定携带项（白名单 fail-closed：新增顶层目录默认不得进包）
  const allowedTopLevel = ['.flow-comet', 'scripts', 'package.json', 'README.md', 'LICENSE'];
  const unexpectedTop = [...new Set(files.map((p) => p.split('/')[0]))].filter((t) => !allowedTopLevel.includes(t));
  if (unexpectedTop.length > 0) {
    throw new Error('包体顶层出现白名单外条目（新增顶层目录默认不得进包）: ' + unexpectedTop.join(', '));
  }
  // 仅忽略 npm 恒定排除的操作系统垃圾文件（跨平台检出物，非包体声明面）
  const osJunk = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];
  const skillsOnDisk = collectTreeFiles(path.join(root, '.flow-comet', 'skills'))
    .filter((p) => !osJunk.includes(path.basename(p)))
    .map((p) => '.flow-comet/skills/' + p.replaceAll('\\', '/'));
  const missingSkills = skillsOnDisk.filter((p) => !files.includes(p));
  if (missingSkills.length > 0) throw new Error('包体漏收技能树文件: ' + missingSkills.slice(0, 5).join(', '));
  console.log('  包体边界: ' + files.length + ' 文件，技能树 ' + skillsOnDisk.length + ' 文件逐文件在场，'
    + 'scripts 面 ' + PACKED_SCRIPTS.length + ' 项精确在场（零越界），私有面零命中 ✓');
}

// ③b workflow contract 检查（`comet-check.mjs`）：包内**必含面清单**的自动锚。它此前全仓无任何
// CI/套件调用——清单漂移没有红灯（本批移出两个参考文件时只能靠手工同步清单）。判据两层：
//   ① 真实执行权威源的该脚本 → exit 0 且输出 `workflow-contract-ok`（清单与真实树一致）；
//   ② 反向构造（同一判据驱动）：把技能树复制到临时载体、删掉清单里的一个必含文件 → 该脚本必须
//      exit ≠ 0 且报 `Missing required workflow contract files`（清单是真在查，不是恒真输出）。
export function assertWorkflowContractCheck(scratch) {
  const checker = path.join(SCRIPTS_DIR, 'comet-check.mjs');
  if (!fs.existsSync(checker)) throw new Error('缺少 comet-check.mjs: ' + checker);
  const runChecker = (script) => {
    const res = spawnSync(process.execPath, [script], { cwd: path.dirname(script), encoding: 'utf8', timeout: 60000 });
    return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
  };
  const real = runChecker(checker);
  if (real.status !== 0 || !real.output.includes('workflow-contract-ok')) {
    throw new Error('comet-check.mjs 未通过（包内必含面清单与真实树漂移）\n退出码 ' + real.status
      + '\n输出:\n' + real.output);
  }
  // 反向构造：临时载体上一份技能树副本，删掉清单中的一个必含文件 ⇒ 必失败。
  const carrier = path.join(scratch, 'contract-carrier');
  fs.mkdirSync(carrier, { recursive: true });
  copyTreePortable(path.join(SCRIPTS_DIR, '..', '..'), path.join(carrier, 'skills'));
  const copiedChecker = path.join(carrier, 'skills', 'flow-comet', 'scripts', 'comet-check.mjs');
  const removedRel = path.join('skills', 'flow-comet', 'reference', 'decision-points.md');
  const removedAbs = path.join(carrier, removedRel);
  if (!fs.existsSync(removedAbs)) {
    throw new Error('反向构造前提不成立：清单必含文件不在副本内 ' + removedRel);
  }
  fs.rmSync(removedAbs);
  const broken = runChecker(copiedChecker);
  if (broken.status === 0 || !broken.output.includes('Missing required workflow contract files')) {
    throw new Error('comet-check.mjs 反向构造判别力缺失（删掉清单必含文件后仍通过）\n退出码 '
      + broken.status + '\n输出:\n' + broken.output);
  }
  console.log('  workflow contract 检查: 权威源 exit 0（workflow-contract-ok）+ 缺件副本必失败 ✓');
}

// ③ bin 双入口契约：两个命令名同指同一安装器（同一实现 = 行为一致的结构事实）。返回安装器绝对路径。
export function assertBinContract(pkg, root) {
  const binTarget = 'scripts/prepare-env.mjs';
  const bin = pkg.bin && typeof pkg.bin === 'object' ? pkg.bin : null;
  if (!bin) throw new Error('package.json 缺 bin 声明（双入口契约）');
  for (const name of ['fcomet', 'flow-comet']) {
    if (bin[name] !== binTarget) {
      throw new Error('bin["' + name + '"] 应指向 ' + binTarget + '，实际 ' + JSON.stringify(bin[name]));
    }
  }
  const installer = path.join(root, ...binTarget.split('/'));
  if (!fs.existsSync(installer)) throw new Error('bin 目标文件不存在: ' + binTarget);
  console.log('  bin 双入口: fcomet / flow-comet → ' + binTarget + '（同一实现）✓');
  return installer;
}

// ④ init 词元形态与红线（负例常驻：变形/重复词元绝不被静默吞成默认安装）。cwd 用场景临时目录。
export function assertInitTokenContract(installer, cwd) {
  const runInstaller = (args) => {
    const res = spawnSync(process.execPath, [installer, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
    return { status: res.status ?? 1, stdout: String(res.stdout || ''), stderr: String(res.stderr || '') };
  };
  const withInit = runInstaller(['init', '--help']);
  if (withInit.status !== 0) {
    throw new Error('`init` 词元形态应退 0（`fcomet init --help`），实际 ' + withInit.status + '\n' + withInit.stderr);
  }
  if (!withInit.stdout.includes('fcomet init')) throw new Error('用法输出未含 `fcomet init` 形态:\n' + withInit.stdout);
  const bare = runInstaller(['--help']);
  if (bare.status !== 0) throw new Error('裸形态（无 init 词元）`--help` 行为应不变（退 0），实际 ' + bare.status + '\n' + bare.stderr);
  for (const bad of ['inti', 'int', 'install', 'init init']) {
    const res = runInstaller(bad.split(' '));
    if (res.status !== 1) throw new Error('变形/重复词元 `' + bad + '` 必须退 1，实际 ' + res.status + '\n' + res.stdout);
    if (!res.stderr.includes('未知参数')) {
      throw new Error('变形/重复词元 `' + bad + '` 的 stderr 应含「未知参数」，实际:\n' + res.stderr);
    }
  }
  // ⑤ 版本查询：`--version` / `-v` 退 0 且输出本工具的版本标识（同一个解析来源，不另设常量）。
  // 断言做成**状态无关**，因为「版本面已 bump、tag 尚未打」是发布准备的常态：此时随包标记
  // 领先于 git describe（标记 = 待发版本，describe = 旧 tag + 提交数）。两条合法来源：
  //   ① 随包分发的权威源标记（包形态 / 发布后命中）；② 当前 tag 的开发态后缀 `<tag>-N-g<hash>`。
  // 等值断言会在发布准备期误红——那不是缺陷，是顺序（先改版本面、后打 tag）。
  const versionShape = /^\d+\.\d+\.\d+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
  const installedVersion = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'INSTALLED_VERSION'), 'utf8').trim();
  let headTag = '';
  try {
    const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
    headTag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: repoRoot, encoding: 'utf8', timeout: 30000 }).trim().replace(/^v/, '');
  } catch { /* 无 git 或无 tag：只按随包标记比对 */ }
  for (const flag of ['--version', '-v']) {
    const res = runInstaller([flag]);
    if (res.status !== 0) {
      throw new Error('`' + flag + '` 应退 0（版本查询不是错误），实际 ' + res.status + '\n' + res.stderr);
    }
    const printed = res.stdout.trim();
    if (!versionShape.test(printed)) {
      throw new Error('`' + flag + '` 的输出不是版本标识形态: ' + JSON.stringify(printed));
    }
    // 等值、或**以「版本 + `-`」为界**的开发态后缀——不能裸用前缀匹配：`1.5.10` 会被
    // `startsWith('1.5.1')` 收下，把「族外的更长版本号」误判为一致（实测：注入 1.5.10 时
    // 裸前缀谓词全绿通过）。边界字符取 `-`，正合 git describe 的后缀形态 `<tag>-N-g<hash>`。
    const matchesMarker = printed === installedVersion || printed.startsWith(installedVersion + '-');
    const matchesHeadTag = headTag !== '' && (printed === headTag || printed.startsWith(headTag + '-'));
    if (!matchesMarker && !matchesHeadTag) {
      throw new Error('`' + flag + '` 的输出与「随包标记 / 当前 tag」都不一致（标记=' + installedVersion + ' tag=' + headTag + '）: ' + JSON.stringify(printed));
    }
  }
  console.log('  版本查询: `--version` / `-v` 退 0 且输出为版本标识形态（标记=' + installedVersion + ' / 当前 tag=' + headTag + '）✓');
  // ⑥ 零参数裸调用不得安装到当前目录（本轮修正）：无参数 = 没说要做什么，
  //    应当在当前目录留下零产物并给出用法与非零退出码。修复前它会做一次完整安装
  //    （.claude/ + flow-kit/ + 改写 .gitignore）→ 误敲即在当前目录铺开一套环境。
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-action-'));
  try {
    seedForeignFlowKit(emptyDir); // 预置同名非上游目录：走「已跳过」路径，零网络接触
    const bareRun = spawnSync(process.execPath, [installer], { cwd: emptyDir, encoding: 'utf8', timeout: 60000 });
    const status = bareRun.status ?? 1;
    const stderr = String(bareRun.stderr || '');
    if (status === 0) {
      throw new Error('零参数裸调用不得退 0（它做了/声称做了一次安装）；实际退 0\n' + String(bareRun.stdout || '').slice(-300));
    }
    if (!stderr.includes('用法')) {
      throw new Error('零参数裸调用的 stderr 应给出用法，实际:\n' + stderr);
    }
    // 用法必须**整段**在 stderr：只断言「stderr 含用法」会漏掉「部分行仍写 stdout」的实现
    // （首行在 stderr 即满足该断言，其余行可能被劈到 stdout——实测出现过）。故此处两侧同判：
    // stderr 末尾行在场，且 stdout 为空。
    if (!/--version 打印版本标识/.test(stderr)) {
      throw new Error('用法末行不在 stderr（用法输出被劈到 stdout）：stderr 实际:\n' + stderr);
    }
    if (String(bareRun.stdout || '').trim() !== '') {
      throw new Error('零参数裸调用的 stdout 应为空（用法整段走 stderr），实际:\n' + String(bareRun.stdout));
    }
    if (fs.existsSync(path.join(emptyDir, '.claude'))) {
      throw new Error('零参数裸调用不得在当前目录留下安装产物（.claude/ 被创建）');
    }
    console.log('  零参数裸调用: 非零退出 + 用法整段在 stderr + stdout 空 + 当前目录零产物 ✓');
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
  console.log('  init 词元: `init --help` 退 0 且含 fcomet init / 裸形态行为不变 / 变形·重复词元 4 例退 1 且报未知参数 ✓');
}

// ---------- 安装器升级路径清理断言助手（生成物镜像面：权威源已删除 / 改名的条目不得残留） ----------

// 升级路径清理断言（分发面：安装器的生成物镜像面）——判据 = 真实安装器命令序列 + 文件系统事实，
// 而不是「安装器退出码为 0」（后者会被「安装照常成功」恒真满足，清理实现整体缺席也不会变红）：
//   ① 删该删的：镜像目录内「权威源已不存在」的条目，重装后必须消失（含清空后的目录本身）；
//   ② 不该删的必不删（反向探针，逐条）：权威源仍存在的文件 / 用户自有技能（无 flow-comet
//      命名空间）/ 命名空间内但权威源整个技能目录不在场（安装器没有生成清单，无法判定该目录
//      「确由上次生成写入」）/ copyTree 目标但路径不含命名空间（.claude/rules）/ 项目根用户文件；
//   ③ 输出可核对：被清理条目逐条打印；④ 幂等：第二次重装零清理项、零报错。
// 夹具名刻意取合成形态，不占用真实工件名（将来权威源重新引入同名文件时夹具前提不失配）——
// 同时以「权威源确实不含该名」为前提断言，防止夹具退化成恒真空过。
export function assertInstallerUpgradePathCleanup(scratch) {
  const pkgCtx = resolvePackageContext();
  if (pkgCtx.kind === 'copy') {
    console.log('  不适用（安装副本侧：' + pkgCtx.reason + '）——安装器升级路径清理断言仅权威源侧可判，本项计通过');
    return;
  }
  const installer = path.join(pkgCtx.root, 'scripts', 'prepare-env.mjs');
  const target = path.join(scratch, 'upgrade-path');
  fs.mkdirSync(target, { recursive: true });
  seedForeignFlowKit(target); // 预置同名非上游目录：flow-kit 走「已跳过」路径，零网络接触
  const skillsRoot = path.join(target, '.claude', 'skills');
  const runInstall = () => runInstallerOnce(installer, target);
  const mustNotExist = (rel, label) => {
    const p = path.join(skillsRoot, rel);
    if (fs.existsSync(p)) throw new Error('升级重装后权威源已不存在的生成物仍残留（' + label + '）: ' + p);
  };
  const mustExist = (rel, label) => {
    const p = path.join(skillsRoot, rel);
    if (!fs.existsSync(p)) throw new Error('升级重装误删了不该删的条目（' + label + '）: ' + p);
  };
  // ① 首次安装（等价「上一代生成物」：内容与权威源一致）
  assertExit(runInstall(), 0);
  // ② 夹具：模拟上一代生成、而权威源已删除 / 改名的三类形态（文件 / 嵌套文件 / 目录树 + 空目录）
  const staleFile = 'flow-comet/legacy-guidance.md';
  const staleNested = 'flow-comet/reference/legacy-notes.md';
  const staleDir = 'flow-comet/reference/legacy-subagents';
  const staleEmptyDir = 'flow-comet/reference/legacy-empty';
  writeFile(target, path.posix.join('.claude/skills', staleFile), 'stale\n');
  writeFile(target, path.posix.join('.claude/skills', staleNested), 'stale\n');
  writeFile(target, path.posix.join('.claude/skills', staleDir, 'author.md'), 'stale\n');
  fs.mkdirSync(path.join(skillsRoot, staleEmptyDir), { recursive: true });
  for (const rel of [staleFile, staleNested, staleDir, staleEmptyDir]) {
    if (fs.existsSync(path.join(pkgCtx.root, '.flow-comet', 'skills', rel))) {
      throw new Error('夹具前提失效：权威源已含 ' + rel + '——请改用其它合成名');
    }
  }
  // ③ 反向探针夹具（不该删的必不删）
  writeFile(target, '.claude/skills/my-own-skill/SKILL.md', 'user skill\n');
  writeFile(target, '.claude/skills/flow-comet-fork/SKILL.md', 'unattributable dir\n');
  writeFile(target, '.claude/rules/user-rule.md', 'user rule\n');
  writeFile(target, 'USER_KEEP.md', 'user file\n');
  // ④ 升级重装（真实安装器第二次运行同一平台）
  const upgrade = runInstall();
  assertExit(upgrade, 0);
  // ⑤ 删该删的（三类形态逐条）
  mustNotExist(staleFile, '改名残留文件');
  mustNotExist(staleNested, '移出残留文件');
  mustNotExist(staleDir, '残留目录（内容清空后应一并移除）');
  mustNotExist(staleEmptyDir, '残留空目录');
  // ⑥ 不该删的必不删（逐条反向探针）
  mustExist('flow-comet/reference/entry-detail.md', '权威源仍存在的文件');
  mustExist('flow-comet/SKILL.md', '权威源技能主体');
  mustExist('my-own-skill/SKILL.md', '用户自有技能（无 flow-comet 命名空间）');
  mustExist('flow-comet-fork/SKILL.md', '命名空间内但权威源整个技能目录不在场——归属不可判定，fail-closed 保留');
  if (!fs.existsSync(path.join(target, '.claude', 'rules', 'user-rule.md'))) {
    throw new Error('白名单外生成面（.claude/rules）的用户文件被误删');
  }
  if (!fs.existsSync(path.join(target, 'USER_KEEP.md'))) throw new Error('项目根用户文件被误删');
  // ⑦ 输出可核对：被清理条目逐条打印（人可复核「删了什么」）
  for (const rel of [staleFile, staleNested, staleDir, staleEmptyDir]) {
    const name = path.posix.basename(rel);
    if (!upgrade.output.includes(name)) {
      throw new Error('清理输出未逐条打印被清理条目（缺 ' + name + '）:\n' + upgrade.output);
    }
  }
  // ⑦b 播报标记钉死：⑧ 的「重跑无清理项」是**负向**断言——标记一旦改名它便恒真；正向锚在此
  // （标记须在首次升级输出里在场），标记契约的漂移因此必然红，而不是静默失效。
  if (!upgrade.output.includes('镜像清理: 已删除')) {
    throw new Error('升级重装输出缺清理播报标记「镜像清理: 已删除」:\n' + upgrade.output);
  }
  // ⑧ 幂等：第二次重装零清理项、零报错（重复跑不删多、不重复打印）
  const again = runInstall();
  assertExit(again, 0);
  if (again.output.includes('镜像清理')) {
    throw new Error('幂等失配：第二次重装仍报告清理动作:\n' + again.output);
  }
  console.log('  升级路径清理: 残留 4 项消失（文件 / 嵌套文件 / 目录树 / 空目录）+ 6 条反向探针保留 + 输出可核对 + 幂等 ✓');
}

// 安装器单次真实运行（两处安装器分发面断言共用同一命令形态——同一知识只有一份实现）
function runInstallerOnce(script, target) {
  const res = spawnSync(process.execPath, [script, '--target', target, '--platform', 'claude-code'], {
    cwd: target, encoding: 'utf8', timeout: 120000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 把 linkPath 置为指向 targetDir 的链接（夹具构造与清理共用）：递归删除会跟随链接目标，
// 故先按链接自身解链，再删可能残留的普通目录。
function replaceWithLink(linkPath, targetDir) {
  try {
    if (fs.lstatSync(linkPath).isSymbolicLink()) fs.unlinkSync(linkPath);
  } catch { /* 不在场——无需解链 */ }
  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(targetDir, linkPath, 'junction');
}

// 镜像清理的**根级** fail-closed 断言（同上一条属同一分发面项）——判据 = 真实安装器命令序列 + 文件系统事实：
//   根以下的条目层检查拦不住「镜像根自身是链接」：readdir 会跟随进链接目标，清理动作落在**项目之外**，
//   而播报打印的仍是项目内的表象路径（真实落点不可见）。两条判据各需一个变体驱动，缺任一变体则
//   对应那条判据整体缺席也不会有红灯：
//     变体 A「镜像根自身是指向项目外目录的链接」 ⇒ 根级链接判据（不跟随）；
//     变体 B「父级目录是链接、镜像根自身是普通目录」 ⇒ 真实路径包含性判据（词法路径仍在项目内，
//       只有解析真实路径才能证否；此变体下 A 判据必然不命中，故它是包含性判据的独占探针）。
//   断言（两变体同）：链接目标内的项目外文件**必不消失** + 输出含逐条保留原因 + 重复运行零删除项。
//   反向构造见 assertMirrorRootReverseConstruction（同一判据驱动，证明断言不恒真空过）。
export function assertMirrorRootLinkFailClosed(scratch, pkgCtx) {
  if (pkgCtx.kind === 'copy') {
    console.log('  不适用（安装副本侧：' + pkgCtx.reason + '）——镜像清理根级判据的探针仅权威源侧可判，本组计通过');
    return;
  }
  const installer = path.join(pkgCtx.root, 'scripts', 'prepare-env.mjs');
  // 变体 A：镜像根自身 = 指向项目外目录的链接
  const targetA = path.join(scratch, 'mirror-root-link-self');
  const outsideA = path.join(scratch, 'mirror-root-link-self-outside');
  seedForeignFlowKit(targetA);
  writeFile(outsideA, 'EXTERNAL-NOTE.md', 'out-of-tree user content\n');
  writeFile(outsideA, path.posix.join('nested', 'DEEP-NOTE.md'), 'out-of-tree user content\n');
  replaceWithLink(path.join(targetA, '.claude', 'skills', 'flow-comet'), outsideA);
  // 变体 B：父级目录 = 链接（镜像根自身是目标内的普通目录）
  const targetB = path.join(scratch, 'mirror-root-link-ancestor');
  const outsideB = path.join(scratch, 'mirror-root-link-ancestor-outside');
  seedForeignFlowKit(targetB);
  writeFile(outsideB, path.posix.join('flow-comet', 'EXTERNAL-NOTE.md'), 'out-of-tree user content\n');
  replaceWithLink(path.join(targetB, '.claude', 'skills'), outsideB);
  const mirrorB = path.join(targetB, '.claude', 'skills', 'flow-comet');
  if (!fs.existsSync(mirrorB) || fs.lstatSync(mirrorB).isSymbolicLink()) {
    throw new Error('变体 B 前提失效：镜像根自身不是普通目录（应只有父级是链接）: ' + mirrorB);
  }
  const variants = [
    { label: '镜像根自身为链接', target: targetA, outsideFile: path.join(outsideA, 'EXTERNAL-NOTE.md'), reasonPattern: /镜像根是符号链接\/junction/ },
    { label: '镜像根真实路径越界', target: targetB, outsideFile: path.join(outsideB, 'flow-comet', 'EXTERNAL-NOTE.md'), reasonPattern: /越出目标项目根/ },
  ];
  for (const v of variants) assertLinkTargetPreserved(installer, v);
  assertMirrorRootReverseConstruction(scratch, pkgCtx, installer, variants);
  console.log('  镜像清理根级判据: 根自身为链接 / 真实路径越界 两变体下项目外文件保全 + 保留原因可见 + 幂等；'
    + '反向构造（判据改恒真）两变体必被越界删除 ✓');
}

// 「链接目标内的项目外文件必不消失」断言（两变体同形）：项目外文件仍在 + 输出含逐条保留原因 +
// 原因指明命中的判据 + 重复运行零删除项且文件仍在（保留是**可见的决定**，不是静默跳过）。
function assertLinkTargetPreserved(installer, { label, target, outsideFile, reasonPattern }) {
  const first = runInstallerOnce(installer, target);
  assertExit(first, 0);
  if (!fs.existsSync(outsideFile)) {
    throw new Error(label + '：镜像清理越界删除了项目之外的文件（真实落点 ' + outsideFile + '）\n输出:\n' + first.output);
  }
  if (!first.output.includes('镜像清理保留')) {
    throw new Error(label + '：输出未逐条打印保留原因——fail-closed 保留必须是可见的决定\n输出:\n' + first.output);
  }
  if (!reasonPattern.test(first.output)) {
    throw new Error(label + '：保留原因未指明命中判据（缺 ' + reasonPattern + '）\n输出:\n' + first.output);
  }
  const second = runInstallerOnce(installer, target);
  assertExit(second, 0);
  if (second.output.includes('镜像清理: 已删除')) {
    throw new Error(label + '：重复运行仍报告删除动作（幂等失配）\n输出:\n' + second.output);
  }
  if (!fs.existsSync(outsideFile)) {
    throw new Error(label + '：重复运行后项目之外的文件消失（' + outsideFile + '）');
  }
}

// 反向构造（同一判据驱动）：把两处根级判据分别中和为恒真后重跑同一变体 ⇒ 项目外文件**必被删除**；
// 判据落点漂移（判据句被改写）时「前提不成立」先行报错，避免变异无处落点而假绿。
// 变异目标按**模块身份**定位（两处判据都在 lib/installer-cleanup.mjs——描述符/清理职责的归属模块，
// 见设计模块图），不再平铺扫描全部模块；判据句仍按**内容**确认在场（句子漂移 ⇒ 前提不成立，红）。
// 载体按**真实包内 scripts 面**落位（PACKED_SCRIPTS，与包体边界判据同集合）：照着整个 scripts/ 目录
// 搬运会把仓库本地工具也带进载体，使载体比真实包更宽——被拆出的模块即使掉出包体白名单，
// 载体里仍在场（安装照跑），反向构造因此对该类缺口零判别力。
function assertMirrorRootReverseConstruction(scratch, pkgCtx, installer, variants) {
  const carrier = path.join(scratch, 'mirror-root-carrier');
  for (const rel of PACKED_SCRIPTS) {
    const dest = path.join(carrier, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(pkgCtx.root, ...rel.split('/')), dest);
  }
  const cleanupModule = path.join(carrier, 'scripts', 'lib', 'installer-cleanup.mjs');
  if (!fs.existsSync(cleanupModule)) {
    throw new Error('反向构造前提不成立：随包 scripts 面缺安装器清理模块 ' + cleanupModule);
  }
  const neutralize = (sentence) => {
    const text = fs.readFileSync(cleanupModule, 'utf8');
    if (!text.includes(sentence)) return false;
    fs.writeFileSync(cleanupModule, text.replace(sentence, sentence.replace('if (', 'if (false && ')), 'utf8');
    return true;
  };
  if (!neutralize('if (!isRealPathInside(dstRoot, projectRoot)) {')) {
    throw new Error('反向构造前提不成立：真实路径包含性判据的落点未找到（判据句已漂移，变异无处落点）');
  }
  if (!neutralize('if (rootStat.isSymbolicLink()) {')) {
    throw new Error('反向构造前提不成立：根级链接判据的落点未找到（判据句已漂移，变异无处落点）');
  }
  copyTreePortable(path.join(pkgCtx.root, '.flow-comet', 'skills'), path.join(carrier, '.flow-comet', 'skills'));
  const mutated = path.join(carrier, 'scripts', 'prepare-env.mjs');
  for (const v of variants) {
    const res = runInstallerOnce(mutated, v.target);
    assertExit(res, 0);
    if (fs.existsSync(v.outsideFile)) {
      throw new Error(v.label + ' 反向构造判别力缺失：判据被中和后项目之外的文件仍在（断言可能是恒真空过）\n输出:\n' + res.output);
    }
  }
}

// ---------- 桥接 loader 版本戳重装断言助手（临时 DSH_HOME 重装链路） ----------

// 从权威源 loader 提取版本戳（与安装器/检查器同一锚点标记行；动态取值，版本演进零维护）
export function readBridgeSourceVersion(loader) {
  const text = fs.readFileSync(loader, 'utf8');
  const m = /^\/\/ BRIDGE_VERSION: (\S+)$/m.exec(text);
  if (!m) throw new Error('权威源 loader 缺版本戳标记行（契约锚点）: ' + loader);
  return m[1];
}

// 构造指定版本戳的 loader 副本内容（仅替换标记行，其余逐字保持——MISS 检测：替换未命中即报错）
export function stampBridgeLoader(sourceLoader, version) {
  const text = fs.readFileSync(sourceLoader, 'utf8');
  const replaced = text.replace(/^\/\/ BRIDGE_VERSION: \S+$/m, '// BRIDGE_VERSION: ' + version);
  if (!replaced.includes('// BRIDGE_VERSION: ' + version)) {
    throw new Error('版本戳替换未命中（MISS）: 目标版本 ' + version);
  }
  return replaced;
}

// 安装副本载体的 bridge-check 版本比较断言：dev 态载体（INSTALLED_VERSION = <发布>-<N>-g<hash>）
// 与同基础版本 loader 判健康，基础版本失配仍 FAIL。以副本自身脚本运行——bridge-check 读取脚本
// 同包 INSTALLED_VERSION，与真实安装载体同构（权威源检出路径固定为发布标记，无法构造 dev 态）。
export function assertInstalledCopyBridgeVersionSemantics(target, dshHome, srcVersion) {
  const installedSkillRoot = path.join(target, '.dsh', 'skills', 'flow-comet');
  const installedVersionPath = path.join(installedSkillRoot, 'INSTALLED_VERSION');
  const runBridgeCheck = () => {
    const res = spawnSync(process.execPath, [path.join(installedSkillRoot, 'scripts', 'workflow-state.mjs'), 'bridge-check'], {
      cwd: target, encoding: 'utf8', timeout: 60000, env: { ...process.env, DSH_HOME: dshHome },
    });
    return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
  };
  const devVersion = srcVersion + '-11-g93d96c0';
  fs.writeFileSync(installedVersionPath, devVersion + '\n', 'utf8');
  const devHealthy = runBridgeCheck();
  assertExit(devHealthy, 0);
  assertOut(devHealthy, '[OK] 版本一致性: loader BRIDGE_VERSION=' + srcVersion + ' ~= 项目 INSTALLED_VERSION=' + devVersion);
  assertOut(devHealthy, '（dev 态后缀归一后基础版本 ' + srcVersion + ' 一致）');
  assertOut(devHealthy, 'bridge-check: 健康（全部检查通过）——exit 0');
  const [major] = srcVersion.split('.').map((p) => parseInt(p, 10));
  const otherBase = (major + 9) + '.0.0';
  const otherVersion = otherBase + '-3-gabcdef0';
  fs.writeFileSync(installedVersionPath, otherVersion + '\n', 'utf8');
  const baseMismatch = runBridgeCheck();
  assertExit(baseMismatch, 1);
  assertOut(baseMismatch, '[FAIL] 版本偏斜: loader BRIDGE_VERSION=' + srcVersion + ' != 项目 INSTALLED_VERSION=' + otherVersion + '（归一基础版本: loader=' + srcVersion + ' / installed=' + otherBase + '）——两值如上');
  assertOut(baseMismatch, 'bridge-check: 失配 1 项——exit 1');
}

// 预置目标项目 flow-kit/ 为同名非上游目录（安装器走「非上游克隆，已跳过」路径——
// 网络零接触；与安装器冒烟同手法）
export function seedForeignFlowKit(root) {
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
export function isManagedHookCommand(cmd) {
  return typeof cmd === 'string' && cmd.includes('comet-hook-guard.mjs');
}

export function hasProjectRootRef(cmd) {
  if (typeof cmd !== 'string') return false;
  if (/CLAUDE_PROJECT_DIR/i.test(cmd)) return true;
  return /[A-Za-z]:[\\/]/.test(cmd) || /["'\s=]\/[^\s"']/.test(cmd);
}

export function assertManagedHookEntry(cmd, label) {
  if (!isManagedHookCommand(cmd)) {
    throw new Error(label + ' 缺托管脚本 basename(comet-hook-guard.mjs): ' + String(cmd));
  }
  if (!hasProjectRootRef(cmd)) {
    throw new Error(label + ' 缺项目根引用特征(CLAUDE_PROJECT_DIR 或绝对路径二选一在位;相对路径旧形态不具备 cwd 漂移免疫): ' + String(cmd));
  }
}

// 从 settings.local.json / hooks.json 结构提取全部托管 hook 命令(hooks.PreToolUse[].hooks[].command)
export function collectManagedHookCommands(configObj) {
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

// ③ K 组条目表。带 `surface` 声明的条目在导出前统一接入分发面契约（见 applyDistributionSurface）。
