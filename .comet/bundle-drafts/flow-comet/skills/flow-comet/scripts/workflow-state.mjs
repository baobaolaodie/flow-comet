#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveProtocol, readProtocolFile, validateProtocolSchema } from './protocol-utils.mjs';
import { validateStateFields } from './state-schema.mjs';
import { probeProject, classify, printDetection, validateContext, printGenerationGuide, skipInit } from './context-init.mjs';

const command = process.argv[2] ?? 'status';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const runRoot = process.cwd();
// 协议解析: 协议路径统一由 resolveProtocol 解析——优先级：--protocol CLI 参数 → FLOW_COMET_PROTOCOL
// 环境变量 → 内置默认 reference/workflow-protocol.json。--protocol 为全局参数（可放在 command
// 之后的任意位置）；cliArgs = 去掉 command 后的剩余参数数组。
const protocolPath = resolveProtocol(packageRoot, runRoot, process.argv.slice(3));
const statePath = path.join(runRoot, '.comet', 'flow-comet-state.json');
const specsRoot = path.join(runRoot, '.specs');

// 内置节点常量: 内置 8 节点常量（供其他用途参照——如 guard 的节点→协议映射对照；skill-load 的 node
// 参数校验已改为当前协议节点集合动态读取——compose 自定义协议节点可声明）
const BUILTIN_NODES = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify', 'archive'];

async function readJson(file) {
  // 容忍 UTF-8 BOM（外部写入如会话 Write 可能带 BOM）
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^﻿/, ''));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function findActiveChange() {
  // 1. Read from state file if exists
  if (await fileExists(statePath)) {
    const state = await readJson(statePath);
    // completed 检查优先于 activeChange 分支——归档完成态（无论 activeChange 是否残留）
    // 一律不识别为 active（防归档残留目录/残留字段误判， 主修复）
    if (state.status === 'completed') return null;
    if (state.activeChange) {
      const changeDir = path.join(specsRoot, state.activeChange);
      if (await fileExists(changeDir)) return state.activeChange;
    }
  }
  // 2. Scan .specs/ for directories with TASK.md (active flow-kit changes)
  // 注:  曾尝试按 archive/ 对应归档跳过残留目录——但会误伤同名新 change（既有实证），已撤回。
  // 「state 缺失 + 归档残留」为已知限制（对比报告已记录"捡残留桩"共性问题）；归档后正常态由
  // 上文 completed 分支覆盖（ 主修复）
  try {
    const entries = await fs.readdir(specsRoot, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'archive' || entry.name === 'health' || entry.name === 'evolve' || entry.name === 'adr') continue;
      const taskFile = path.join(specsRoot, entry.name, 'TASK.md');
      if (await fileExists(taskFile)) candidates.push(entry.name);
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      // Return the most recently modified
      const withTime = await Promise.all(candidates.map(async c => ({
        name: c,
        mtime: (await fs.stat(path.join(specsRoot, c, 'TASK.md'))).mtimeMs
      })));
      withTime.sort((a, b) => b.mtime - a.mtime);
      return withTime[0].name;
    }
  } catch {}
  return null;
}

// ---------- 协议解析/内置节点常量/声明标记写入 · skill-load 声明标记（completedChecks 真实性校验配套） ----------

// --prompt 原始参数提取（skill-load 专用参数）：--protocol 由 resolveProtocol 全局解析
// （CLI > env > 默认）为工作流协议 JSON——skill-load 曾用 --protocol 传 prompt 路径，主仓真实链路
// 必现撞车（markdown 被当协议 JSON 解析 → 启动报错「workflow protocol file is not valid JSON」，
// 已实证）。改名 --prompt 后与全局协议解析彻底解耦；此处仅取用户显式传入的原始值，供 skill-load
// 的 flow-kit/prompts/ 归属校验与标记记录。
function findPromptArg(cliArgs) {
  for (let index = 0; index < cliArgs.length; index++) {
    const arg = cliArgs[index];
    if (arg === '--prompt') {
      const value = cliArgs[index + 1];
      if (typeof value !== 'string' || value === '') return null;
      return value;
    }
    if (typeof arg === 'string' && arg.startsWith('--prompt=')) {
      const value = arg.slice('--prompt='.length);
      return value === '' ? null : value;
    }
  }
  return null;
}

// flow-kit/prompts/ 归属校验（相对或绝对路径，前缀校验）——flow-kit 为 vendored 上游，
// 协议提示只读引用；skill-load 声明的 --prompt 必须位于其 prompts 目录下。
// 相对路径：字符串前缀必须为 flow-kit/prompts/；绝对路径：路径段中必须含 flow-kit/prompts。
function protocolUnderFlowKitPrompts(value) {
  const normalized = String(value).replaceAll('\\', '/');
  if (!path.isAbsolute(value)) {
    return normalized.startsWith('flow-kit/prompts/');
  }
  const segments = normalized.split('/').filter((s) => s !== '');
  for (let index = 0; index <= segments.length - 2; index++) {
    if (segments[index] === 'flow-kit' && segments[index + 1] === 'prompts') return true;
  }
  return false;
}

// requiredSkillCalls scope 分类——按协议 requiredSkillCalls 查 <node>.<skill> 绑定：
// main scope = 协调者加载（如 flow-comet-subagent-execute），要求协调者 skill-load 标记；
// handoff scope = 子代理加载（如 subagent-execute 节点的 flow-comet-dev），协调者不加载它。
// 协议外条目（无绑定 / 非 main / 非 handoff scope）→ null（fail-closed：仍按 main 处理要标记）。
function findRequiredSkillBinding(protocol, nodeId, skillName) {
  const node = (protocol.nodes ?? []).find((n) => n.id === nodeId);
  if (!node) return null;
  return (node.requiredSkillCalls ?? []).find((binding) => binding.skill === skillName) ?? null;
}

// 标记目录解析——活动路径 .specs/<change-id>/.skill-loads/ 优先；归档路径兜底
// （archive 节点「先移目录后 record/exit」顺序下 change 目录已在 .specs/archive/<前缀>-<change-id>/，
// 标记只随目录移动——只查活动路径会误报缺失）。归档扫描匹配后缀 -<change-id>（前缀可含日期等，
// 与协议 flowkit.archive.v1 的 archive/*-<change-id> artifact 路径同构）。两者皆无 → null。
async function findSkillLoadsDir(changeName) {
  const activeDir = path.join(specsRoot, changeName, '.skill-loads');
  if (await fileExists(activeDir)) {
    return { dir: activeDir, display: '.specs/' + changeName + '/.skill-loads/' };
  }
  const archiveRoot = path.join(specsRoot, 'archive');
  const entries = await fs.readdir(archiveRoot).catch(() => []);
  for (const entry of entries) {
    if (!entry.endsWith('-' + changeName)) continue;
    const candidate = path.join(archiveRoot, entry, '.skill-loads');
    if (await fileExists(candidate)) {
      return { dir: candidate, display: '.specs/archive/' + entry + '/.skill-loads/' };
    }
  }
  return null;
}

// 内置节点常量/声明标记写入/旧 change 兼容: completedChecks 真实性校验。解析 completedChecks 的 required-skill:<node>.<skill>
// 条目 → 对应声明标记 .specs/<change-id>/.skill-loads/<node>-<skill>.json 必须存在（内置节点常量，缺失 →
// BLOCKED + 指引先加载 skill 并运行 skill-load）；标记 at 必须 ≤ 本次记录时间（声明标记写入 交叉自洽：
// 标记先于记录声明；ISO-8601 UTC 字符串字典序 = 时间序）。仅校验本次 record 写入的
// completedChecks（旧 change 兼容：旧 evidence 不追溯——由调用方只传本次 parsed.completedChecks）。
// 条目按协议 requiredSkillCalls scope 分类——handoff scope 条目（子代理加载的 skill，
// 如 subagent-execute 节点的 flow-comet-dev）豁免标记，以共用证据库 evidence['subagent-execute']
// 的 handoffResult（有委托记录即满足）为证据；main scope / 协议外条目仍要求标记（fail-closed）。
// 诚实边界：标记是"声明"而非物理证明——运行时没有 Skill 调用观察点，脚本无法确认执行者
// 真实加载过该 skill；标记仅证明"执行者主动声明已加载"，由流程纪律兜底。handoff 条目的证据
// 同样不是物理证明——它是子代理回传的 Return Contract 委托声明（子代理自称已加载并执行），
// 由 handoff result 的 commitHash/greenEvidence 审计性兜底。
// 返回 { ok: true } 或 { ok: false, reason }（fail-closed：无 active change / 标记损坏同样 BLOCK）。
async function verifySkillLoadMarkers(completedChecks, changeName, recordTime, protocol, state) {
  if (!Array.isArray(completedChecks)) return { ok: true };
  const required = [];
  for (const check of completedChecks) {
    if (typeof check !== 'string' || !check.startsWith('required-skill:')) continue;
    const spec = check.slice('required-skill:'.length);
    const dot = spec.lastIndexOf('.');
    if (dot <= 0 || dot === spec.length - 1) {
      return { ok: false, reason: 'completedChecks 条目格式非法（应为 required-skill:<node>.<skill>）: ' + check };
    }
    required.push({ raw: check, node: spec.slice(0, dot), skill: spec.slice(dot + 1) });
  }
  if (required.length === 0) return { ok: true };
  if (!changeName) {
    return { ok: false, reason: 'completedChecks 含 required-skill 条目但无 active change——无法定位声明标记（先运行 init <change-id>）' };
  }
  for (const item of required) {
    // handoff scope 条目豁免标记——子代理加载的 skill（协调者不加载它，无法诚实
    // 声明加载），以共用证据库 handoffResult 的委托记录为证据；无委托记录 → BLOCK（不静默
    // 放行，指引先委托并回传 handoff result）
    const binding = findRequiredSkillBinding(protocol, item.node, item.skill);
    if (binding && binding.scope === 'handoff') {
      const handoff = state?.evidence?.['subagent-execute']?.handoffResult;
      const hasDelegation = !!(
        handoff &&
        typeof handoff === 'object' &&
        !Array.isArray(handoff) &&
        Object.keys(handoff).length > 0
      );
      if (!hasDelegation) {
        return {
          ok: false,
          reason: 'completedChecks 条目 ' + item.raw + ' 为 handoff scope（' + item.node +
            ' 节点的 ' + item.skill + ' 由子代理加载，协调者无需 skill-load 标记）但共用证据库' +
            ' evidence[subagent-execute].handoffResult 无委托记录——先委托子代理并回传 Return Contract（workflow-handoff.mjs result <task-id> <contract>）',
        };
      }
      continue;
    }
    // 标记路径解析——活动路径优先，归档路径兜底（archive 节点「先移目录后 record」
    // 顺序下标记只在 .specs/archive/*-<change-id>/.skill-loads/）；两处都找不到 → BLOCK + 指引
    // （不静默放行）。展示路径补 .specs/ 前缀便于用户定位。
    const markerName = item.node + '-' + item.skill + '.json';
    const activeDisplay = '.specs/' + path.posix.join(changeName, '.skill-loads', markerName);
    const activePath = path.join(specsRoot, changeName, '.skill-loads', markerName);
    let markerPath = await fileExists(activePath) ? activePath : null;
    let markerDisplay = activeDisplay;
    if (!markerPath) {
      const loadsDir = await findSkillLoadsDir(changeName);
      if (loadsDir !== null) {
        const altPath = path.join(loadsDir.dir, markerName);
        if (await fileExists(altPath)) {
          markerPath = altPath;
          markerDisplay = loadsDir.display + markerName;
        }
      }
    }
    if (!markerPath) {
      return {
        ok: false,
        reason: 'completedChecks 条目 ' + item.raw + ' 缺少对应声明标记 ' + activeDisplay +
          '（归档路径也未找到）——先加载该 skill 并运行 workflow-state.mjs skill-load ' + item.node + ' ' + item.skill,
      };
    }
    let marker;
    try {
      marker = await readJson(markerPath);
    } catch {
      return { ok: false, reason: '声明标记损坏（非法 JSON，需重新运行 skill-load）: ' + markerDisplay };
    }
    // 声明标记写入: 交叉自洽——标记 at 必须 ≤ 本次记录时间（标记先于记录声明）
    if (typeof marker.at !== 'string' || marker.at > recordTime) {
      return {
        ok: false,
        reason: '声明标记时间序非法（标记 at=' + JSON.stringify(marker.at) + ' 不早于本次记录时间 ' + recordTime +
          '）——标记必须先于记录声明（重新运行 skill-load）',
      };
    }
  }
  return { ok: true };
}

// ---------- 节点完成判定 · determineNode 数据化：完成标志从协议 outputSchemas 推导 ----------

// 为每个节点构建"完成标志文件集"：遍历节点 outputSchemas 引用的 schema 的 artifacts
// （schema 在 protocol.outputSchemas 数组中按 id 查找），paths 中 <change-id> 替换为实际
// changeName，得到相对 .specs 根的路径数组。同一 artifact 的 paths 为互斥备选（命中任一即
// 该 artifact 存在，如 DESIGN.md / DESIGN-lite.md）；节点完成 = 标志文件集全部存在
// （required !== false 的 artifact 全部存在，与 workflow-guard missingRequiredArtifacts 同语义）。
// 返回 Map<nodeId, Array<{ id, paths }>>。
function buildNodeCompletionFlags(protocol, changeName) {
  const schemaById = new Map((protocol.outputSchemas ?? []).map((schema) => [schema.id, schema]));
  const flags = new Map();
  for (const node of protocol.nodes ?? []) {
    const artifacts = [];
    for (const schemaId of node.outputSchemas ?? []) {
      const schema = schemaById.get(schemaId);
      for (const artifact of schema?.artifacts ?? []) {
        if (artifact.required === false) continue; // 可选产物不是完成门控
        // B 方案（fail-fast）：classic/native pathBase 由 guard 侧 workflowPathBaseRoot 全量
        // 感知，但状态机推导暂不支持（按 specs-root 兜底会与 guard 不一致导致卡死/误判）——
        // 显式报错提示改用 specs-root/project + 完整路径（如 project + openspec/changes/xxx.md）。
        if (artifact.pathBase === 'classic-openspec-root'
          || artifact.pathBase === 'classic-superpowers-root'
          || artifact.pathBase === 'native-root') {
          throw new Error('产物根 pathBase "' + artifact.pathBase
            + '" 由 guard 校验支持但状态机推导暂不支持——请改用 specs-root/project + 完整路径（如 project + openspec/changes/xxx.md）');
        }
        artifacts.push({
          id: schemaId + '.' + (artifact.id ?? 'artifact'),
          paths: (artifact.paths ?? []).map((p) => String(p).replaceAll('<change-id>', changeName)),
          pathBase: artifact.pathBase,
        });
      }
    }
    flags.set(node.id, artifacts);
  }
  return flags;
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
}

// 与 workflow-guard.mjs pathPatternExists 同语义的轻量 glob 存在检查：
// 按路径段逐段 walk，含 `*` 的段按正则匹配（`*` → `.*`，如 *-SUMMARY.md），命中任一真实路径即存在。
async function pathPatternExists(root, relativePattern) {
  const parts = String(relativePattern).split(/[\\/]+/).filter(Boolean);
  async function walk(current, index) {
    if (index >= parts.length) return fileExists(current);
    const part = parts[index];
    if (!part.includes('*')) return walk(path.join(current, part), index + 1);
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return false;
    }
    const matcher = new RegExp('^' + part.split('*').map(escapeRegExp).join('.*') + '$', 'u');
    for (const entry of entries) {
      if (matcher.test(entry.name) && (await walk(path.join(current, entry.name), index + 1))) {
        return true;
      }
    }
    return false;
  }
  return walk(root, 0);
}

// 节点完成判定 = 标志文件集全部存在（artifact 存在 = 其 paths 任一命中 glob）
// 产物推导 pathBase 感知: 产物根按 artifact.pathBase 解析——'specs-root' → .specs/；'project'/缺省 → 项目根
// （与 workflow-guard.mjs 的 workflowPathBaseRoot 对齐：内置协议 10 个 artifacts 全部显式
// 声明 specs-root；compose 自定义协议可声明 project 根工件如 README.md）。
// classic/native 等其余 pathBase 暂按 specs-root 兜底（与修复前一致，不回归——guard 侧全量感知）。
async function nodeFlagsComplete(nodeFlags, nodeId) {
  for (const artifact of nodeFlags.get(nodeId) ?? []) {
    let present = false;
    const artifactRoot = artifact.pathBase === 'specs-root' ? specsRoot : runRoot;
    for (const pattern of artifact.paths) {
      if (await pathPatternExists(artifactRoot, pattern)) {
        present = true;
        break;
      }
    }
    if (!present) return false;
  }
  return true;
}

async function determineNode(changeName, protocol, completedNodes = []) {
  // （实测）: 全部节点已完成 → 完成态，不产出最后节点。
  // 自定义协议无 archive 节点时，completedNodes 全齐后 next 仍会输出 NODE: <最后节点>
  // （产物推导只返回最后节点 id）——此处（产物推导之前）判定：route(protocol) 的所有节点
  // id 均已包含在 completedNodes 中 → 返回 null。printNext(null) 输出 "NEXT: done"；
  // status 的 currentNode = null 表示完成态。内置协议不受影响：archive exit 时 workflow-guard
  // 清 activeChange，findActiveChange 返回 null 先于 determineNode 触发；completedNodes 含
  // 全部 8 节点时同样返回 null，与"归档后无活跃 change"语义一致。
  const protocolNodeIds = route(protocol).map((n) => n.id);
  if (protocolNodeIds.length > 0 && protocolNodeIds.every((id) => completedNodes.includes(id))) {
    return null;
  }
  const changeDir = path.join(specsRoot, changeName);
  // 节点完成判定: 节点完成标志从协议 outputSchemas 推导（内置协议缺省行为与现硬编码逐字节一致）
  const nodeFlags = buildNodeCompletionFlags(protocol, changeName);
  // 任务文件路径：协议可选 taskFile 字段（相对 changeDir），无声明时缺省 TASK.md。
  // 自定义协议无 taskFile 时 parallel 检测自然降级为串行（任务文件缺失 → 不路由 subagent-execute）。
  const taskFile = typeof protocol.taskFile === 'string' && protocol.taskFile !== ''
    ? protocol.taskFile
    : 'TASK.md';
  const taskPath = path.join(changeDir, taskFile);

  // 节点顺序 = 协议 nodes 顺序（disabled 过滤，见 route()）；execute/subagent-execute 由任务状态特判。
  // 按协议顺序拆分：execute/subagent-execute 之前的节点走产物门控（内置 = open → design → plan），
  // 之后的节点在任务全部 done 后按序门控（内置 = review → verify → archive）。
  const orderedNodes = route(protocol);
  const hasExecuteFamily = orderedNodes.some((n) => n.id === 'execute' || n.id === 'subagent-execute');
  const preExecNodes = [];
  const postExecNodes = [];
  let sawExecuteFamily = false;
  for (const node of orderedNodes) {
    if (node.id === 'execute' || node.id === 'subagent-execute') {
      sawExecuteFamily = true;
      continue;
    }
    if (sawExecuteFamily) postExecNodes.push(node);
    else preExecNodes.push(node);
  }

  // 前置产物门控：execute 之前的节点按序检查（内置协议 = open → design → plan）
  for (const node of preExecNodes) {
    if (!(await nodeFlagsComplete(nodeFlags, node.id))) return node.id;
  }

  // 协议无 execute/subagent-execute 节点：无任务状态特判，全部节点已按产物门控完成 → 当前处于最后节点
  if (!hasExecuteFamily) {
    return orderedNodes.length > 0 ? orderedNodes[orderedNodes.length - 1].id : 'archive';
  }

  // execute/subagent-execute 特判：解析任务文件 <task> 块 pending/done/parallel/depends_on（沿用现逻辑）
  try {
    const taskContent = await fs.readFile(taskPath, 'utf8');
    // Use <task ... status="..." to match only task tags, not documentation text
    const pending = (taskContent.match(/<task[^>]*status="pending"/g) || []).length;
    const done = (taskContent.match(/<task[^>]*status="done"/g) || []).length;
    if (pending > 0) {
      // 只检测依赖已满足的 parallel 任务，避免 Wave N+1 的 parallel 任务
      // 在 Wave N 串行任务未完成时就被路由到 subagent-execute
      const hasSubagentNode = route(protocol).some((n) => n.id === 'subagent-execute');
      if (hasSubagentNode) {
        // 收集所有 done 任务的 id
        const doneIds = new Set((taskContent.match(/<task[^>]*id="([^"]+)"[^>]*status="done"/g) || [])
          .map((m) => { const id = m.match(/id="([^"]+)"/); return id ? id[1] : null; })
          .filter(Boolean));
        // 检查 pending parallel 任务中是否有依赖已满足的
        const parallelBlocks = taskContent.match(/<task[^>]*parallel="true"[^>]*status="pending"[\s\S]*?<\/task>/g) || [];
        const eligibleParallel = parallelBlocks.filter((block) => {
          const depsMatch = block.match(/<depends_on>([\s\S]*?)<\/depends_on>/);
          if (!depsMatch || !depsMatch[1].trim()) return true; // 无依赖
          const deps = depsMatch[1].trim().split(/[,\s]+/).filter(Boolean);
          return deps.every((d) => doneIds.has(d));
        });
        if (eligibleParallel.length > 0) return 'subagent-execute';
      }
      return 'execute';
    }
    // 任务全部 done——execute 完成还需至少一份 SUMMARY（execute 产物门控，内置 = <change-id>/*-SUMMARY.md glob）
    if (!(await nodeFlagsComplete(nodeFlags, 'execute'))) return 'execute';
    // 后置产物门控：按协议顺序检查 execute 之后的节点（内置 = review → verify → archive）。
    // verify 的完成标志 = flowkit.verify.v1 全部 required artifacts（TEST.md + UAT.md）；自然流程中
    // TEST.md 由 review 产出、UAT.md 由 verify 产出，故"verify 看 UAT.md"的判定语义保持不变。
    for (const node of postExecNodes) {
      if (!(await nodeFlagsComplete(nodeFlags, node.id))) return node.id;
    }
    // 全部产物门控通过 → 当前处于协议最后一个节点（内置协议 = archive，与现硬编码 checks.uat → 'archive' 一致）
    return orderedNodes.length > 0 ? orderedNodes[orderedNodes.length - 1].id : 'archive';
  } catch {}

  return 'execute';
}

// 回退修复豁免判定——回退修复标准路径：review/verify 阶段发现缺陷 → TASK.md 追加
// pending 回退任务 → next 回 execute。三条件全满足才豁免（否则维持严格 BLOCK）：
// ① currentNode 为 review/verify（回退修复源节点）；② TASK.md 存在 status="pending" 任务块；
// ③ determineNode 推导为 execute（回退目标）。任一不满足 → 不豁免，保持严格拦截。
async function tFixRollbackExempt(changeName, protocol, currentNode, completedNodes) {
  if (currentNode !== 'review' && currentNode !== 'verify') return false;
  const taskPath = path.join(specsRoot, changeName, 'TASK.md');
  try {
    const taskContent = await fs.readFile(taskPath, 'utf8');
    if (!/<task[^>]*status="pending"/.test(taskContent)) return false;
    return (await determineNode(changeName, protocol, completedNodes)) === 'execute';
  } catch {
    return false;
  }
}

// 正常推进豁免判定——exit --apply 会把 currentNode 推进到下一节点（如 open exit 后
// currentNode=design，该节点尚未开始故 evidence 无记录），随后按 SKILL 协议调 next（正常路径）
// 不应被  误拦为"疑似未 exit"。判定三条件：① completedNodes 非空；② 最后一个已完成节点
// 在路由列表（route(protocol)，disabled 过滤）中的直接后继 = currentNode（exit 推进的正常下一节点）；
// ③ 最后一个已完成节点存在 evidence（exit --apply 必须带证据通过——证据存在证明该 exit 真实发生，
// 排除伪造/漂移状态（如 review 无 evidence）。与  回退豁免独立判断（回退 = TASK.md
// 有 pending 回退修复任务；本豁免 = 正常推进后继）。真乱序（currentNode 不是 completedNodes 的后继）仍
// 维持  严格 BLOCK。
function normalAdvanceExempt(state, protocol, completedNodes, currentNode) {
  if (completedNodes.length === 0) return false;
  const lastNodeId = completedNodes[completedNodes.length - 1];
  const routeIds = route(protocol).map((node) => node.id);
  const lastIdx = routeIds.indexOf(lastNodeId);
  if (lastIdx < 0 || lastIdx + 1 >= routeIds.length) return false;
  if (routeIds[lastIdx + 1] !== currentNode) return false;
  const lastEvidence = state.evidence && typeof state.evidence === 'object'
    ? state.evidence[lastNodeId]
    : null;
  // 审查补充（2026-08-08）：evidence 必须是对象且含非空 summary（空对象 {} 可绕过豁免，
  // 真实流程 exit 强制 summary——此处严格化防止手动修改 state 绕过）
  return !!(
    lastEvidence &&
    typeof lastEvidence === 'object' &&
    !Array.isArray(lastEvidence) &&
    typeof lastEvidence.summary === 'string' &&
    lastEvidence.summary.trim() !== ''
  );
}

async function readState() {
  if (await fileExists(statePath)) {
    const st = await readJson(statePath);
    // 兼容旧 state：无 executionMode / directOverride 时补默认（subagent 默认，direct 是显式逃生口）
    if (st.executionMode === undefined) st.executionMode = 'subagent';
    if (st.directOverride === undefined) st.directOverride = false;
    // E1: branchMode 默认 true（git 仓库时 init 会判定为 true；非 git 仓库 init 纠正为 false；
    // status/next 显示以实时 git 检测为准——非 git 仓库显示 BRANCH: none）
    if (st.branchMode === undefined) st.branchMode = true;
    if (st.enablePrReview === undefined) st.enablePrReview = false;
    // 分支前缀（init --branch-prefix 记录；旧 state 缺省 'change/' 向后兼容）
    if (st.branchPrefix === undefined) st.branchPrefix = 'change/';
    return st;
  }
  return { activeChange: null, currentNode: null, completedNodes: [], evidence: {}, verifyFailures: 0, executionMode: 'subagent', directOverride: false, branchMode: true, enablePrReview: false };
}

// ---------- E1 · 分支模式辅助（git 仓库检测 + 分支名） ----------

// git 仓库检测：`git rev-parse --is-inside-work-tree` 成功且输出 true
function isInsideWorkTree() {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' });
    return String(out).trim() === 'true';
  } catch {
    return false;
  }
}

// 当前分支名；非 git 仓库 / detached HEAD 失败 → null
function gitBranchName() {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' });
    return String(out).trim() || null;
  } catch {
    return null;
  }
}

// 分支是否存在（本地分支）
function branchExists(name) {
  try {
    const out = execFileSync('git', ['branch', '--format', '%(refname:short)'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' });
    return String(out).split('\n').map(s => s.trim()).includes(name);
  } catch {
    return false;
  }
}

// E1: status/next 追加分支信息——BRANCH: <当前分支> | 一致性: ok|mismatch
// mismatch（activeChange 存在但当前分支不是 change/<activeChange>）→ WARN 不 BLOCK；非 git 仓库 → BRANCH: none
function printBranchLine(activeChange, branchPrefix = 'change/') {
  const branch = gitBranchName();
  if (branch === null) {
    console.log('BRANCH: none');
    return;
  }
  const expected = branchPrefix + activeChange;
  const consistent = branch === expected;
  console.log('BRANCH: ' + branch + ' | 一致性: ' + (consistent ? 'ok' : 'mismatch'));
  if (!consistent) {
    console.error('WARN: 分支与 activeChange 不一致——先 git checkout ' + expected + ' 再继续');
  }
}

// C6: writeState 写入前校验已知字段类型（fail-closed：非法 → BLOCKED 拒绝写入，不修复不猜测）
// 未知字段允许（前向兼容）；缺字段允许（readState 默认补）；只校验存在字段的类型。
// 内置节点常量: 校验表已迁移到 state-schema.mjs（唯一来源），行为与批次 C C6 完全一致（对第一个非法字段输出后退出）
async function writeState(state) {
  const bad = validateStateFields(state);
  if (bad.length) {
    console.error('BLOCKED: state 字段类型非法: ' + bad[0]);
    process.exit(1);
  }
  await writeJson(statePath, state);
}

function route(protocol) {
  return (protocol.nodes ?? []).filter(n => !n.disabled);
}

function generatedNodeSkillName(protocol, nodeId) {
  return protocol.name + '-' + nodeId;
}

function printNext(protocol, nodeId, executionMode = 'subagent') {
  if (!nodeId) {
    console.log('NEXT: done');
    return;
  }
  console.log('NEXT: auto');
  console.log('NODE: ' + nodeId);
  console.log('SKILL: ' + generatedNodeSkillName(protocol, nodeId));
  if (nodeId === 'execute' || nodeId === 'subagent-execute') {
    if (executionMode === 'direct' && nodeId === 'execute') {
      console.log('EXECUTION-MODE: direct（主代理直接执行串行任务，必须加载 flow-comet-dev 完整协议；parallel 任务仍由 subagent-execute 委托）');
    } else {
      console.log('COORDINATOR: 你是协调者，不是执行者。禁止在主会话直接修改源码；只能通过 Agent 工具 worktree isolation 委托子代理；子代理回传后仅更新 TASK.md / SUMMARY / handoff evidence。');
      console.log('EXECUTION-MODE: ' + (executionMode === 'direct' ? 'direct' : 'subagent'));
    }
  }
}

async function main() {
  // 协议解析: 协议加载 = resolveProtocol 解析路径 + 受保护读取 + fail-closed schema 校验
  // （读失败/校验失败直接 throw，沿用现有错误处理风格）
  const protocol = await readProtocolFile(runRoot, protocolPath);
  validateProtocolSchema(protocol);

  if (command === 'init') {
    const changeName = process.argv[3];
    if (!changeName) throw new Error('init requires a change name.');
    // --branch-prefix <prefix>（缺省 'change/'）；--init-context / --init-skip（自动初始化检测授权）
    let branchPrefix = 'change/';
    let initContext = false;
    let initSkip = false;
    const initArgs = process.argv.slice(4);
    for (let i = 0; i < initArgs.length; i++) {
      if (initArgs[i] === '--branch-prefix') {
        const value = initArgs[i + 1];
        if (typeof value !== 'string' || value.trim() === '') {
          throw new Error('--branch-prefix requires a non-empty prefix (e.g. feat/)');
        }
        branchPrefix = value.trim().endsWith('/') ? value.trim() : value.trim() + '/';
      } else if (typeof initArgs[i] === 'string' && initArgs[i].startsWith('--branch-prefix=')) {
        const value = initArgs[i].slice('--branch-prefix='.length);
        if (value === '') {
          throw new Error('--branch-prefix requires a non-empty prefix (e.g. feat/)');
        }
        branchPrefix = value.endsWith('/') ? value : value + '/';
      } else if (initArgs[i] === '--init-context') {
        initContext = true;
      } else if (initArgs[i] === '--init-skip') {
        initSkip = true;
      }
    }
    // 自动初始化检测（前置步骤）：读旧 state（项目级字段跨 change 保留）→ 探测 → 判决 → 提示/执行
    // 生成职责：--init-context 时 CONTEXT 缺失 → 输出 INIT-GENERATE 指引，由 agent 全量阅读生成
    // （intel-scan 语义）；生成后重跑 → 脚本校验 7 段结构 → 通过写 last_intel_scan（确定性校验）。
    let prevState = null;
    try { prevState = await readState(); } catch { prevState = null; }
    const probe = await probeProject(runRoot, prevState);
    const verdict = classify(probe, prevState);
    let ctxValid = null; // null=未进入校验（非 init-context 或已新鲜）；true/false=校验结果
    if (initContext || initSkip) {
      // 显式授权路径：--init-context 生成协作（agent 生成 + 脚本校验）；--init-skip 记 none
      if (initContext) {
        // 显式 --init-context 总是校验结构（含 verdict=skip 新鲜/记忆场景）——防 CONTEXT 损坏漏检
        let ctxExists = false;
        try { await fs.access(path.join(runRoot, '.specs', 'CONTEXT.md')); ctxExists = true; } catch { /* 文件不存在 */ }
        if (ctxExists) {
          const { missingSections, formatIssues } = await validateContext(runRoot);
          if (missingSections.length === 0 && formatIssues.length === 0) {
            ctxValid = true;
            if (verdict === 'skip') {
              console.log('INIT-DONE: 项目上下文已存在且新鲜，跳过生成。');
            } else {
              console.log('INIT-DONE: 项目上下文（CONTEXT.md）已就绪（7 段 + 模板格式校验通过）。');
            }
          } else {
            // 存在但不满足模板（缺段/格式不符/损坏）——引导 agent 重写（保留既有累积内容）
            const problems = [...formatIssues, ...missingSections.map((s) => '缺段 ' + s)];
            await printGenerationGuide(runRoot, probe, { rewrite: true, problems });
          }
        } else if (verdict !== 'skip') {
          await printGenerationGuide(runRoot, probe);
        }
        // verdict=skip（记忆 A 拒绝 / 新鲜 B）且 CONTEXT 缺失 → 尊重既有决策，不输出
      }
      if (initSkip && !initContext) {
        console.log('INIT-SKIPPED: 已记录跳过初始化。');
      }
    } else {
      await printDetection(runRoot, probe, verdict);
    }
    // F（2026-08-10）：init 同 id 重跑防护——.specs/<id>/ 已存在或 activeChange 相同 → WARN 不阻断
    //（向后兼容；正常流程 init 只在 open 前执行一次，防护针对误操作清空进度）
    let specsDirExists = false;
    try { await fs.access(path.join(specsRoot, changeName)); specsDirExists = true; } catch { /* 目录不存在 */ }
    if (prevState?.activeChange === changeName || specsDirExists) {
      console.error('WARN: change ' + changeName + ' 已存在——重跑 init 将重置节点状态（completedNodes/evidence 清空）。若需继续已有 change，请用 advance/select 而非重跑 init。');
    }
    // E1: branchMode 自动判定——git 仓库（cwd=runRoot）→ true；非 git 仓库 → false
    const branchMode = isInsideWorkTree();
    const state = {
      activeChange: changeName,
      // currentNode 取协议首节点（内置协议 = open，行为不变；自定义协议 = 首节点，如 brainstorm）
      currentNode: route(protocol)[0]?.id ?? 'open',
      completedNodes: [],
      evidence: {},
      verifyFailures: 0,
      executionMode: 'subagent',
      directOverride: false,
      branchMode,
      enablePrReview: false,
      branchPrefix,
      status: 'running',
      createdAt: new Date().toISOString(),
      // 项目级上下文字段跨 change 保留（迁移旧 state；--init-context 刷新扫描时间；--init-skip 记拒绝）
      ...(prevState?.ai_context_doc !== undefined ? { ai_context_doc: prevState.ai_context_doc } : {}),
      ...(initSkip ? { ai_context_doc: 'none' } : {}),
      // last_intel_scan 仅在校验通过后写入（agent 生成 → 脚本校验 7 段 → 记录扫描时间）
      ...(ctxValid === true
        ? { last_intel_scan: new Date().toISOString() }
        : (prevState?.last_intel_scan !== undefined ? { last_intel_scan: prevState.last_intel_scan } : {}))
    };
    await writeState(state);
    // init 创建 .specs/<id>/ 目录——文件即真相从 init 起成立，findActiveChange 立即可识别
    //（此前 init 后 next/status 报 No active change，与 SKILL 启动协议 init → next 矛盾）
    const specsChangeDir = path.join(specsRoot, changeName);
    await fs.mkdir(specsChangeDir, { recursive: true });
    // E1 + : 分支创建——branchMode && 当前分支 ≠ <prefix><id> && 分支不存在 → git checkout -b
    // 前缀由 --branch-prefix 指定（缺省 'change/'，向后兼容；可适配仓库自身分支规范如 feat/）
    // 失败 → WARN 不 BLOCK，继续纯文件模式（向后兼容）
    const expectedBranch = branchPrefix + changeName;
    if (branchMode) {
      const currentBranch = gitBranchName();
      if (currentBranch !== null && currentBranch !== expectedBranch && !branchExists(expectedBranch)) {
        try {
          execFileSync('git', ['checkout', '-b', expectedBranch], { cwd: runRoot, stdio: 'pipe' });
        } catch {
          console.error('WARN: 创建分支 ' + expectedBranch + ' 失败——继续纯文件模式（分支功能降级；可稍后手动 git checkout -b ' + expectedBranch + '）');
        }
      }
    }
    console.log('Initialized: ' + changeName);
    console.log('BRANCH: ' + (branchMode ? expectedBranch : 'none（非 git 仓库）'));
    // init 输出取协议首节点（与  的 state.currentNode 一致——内置协议 = open，行为不变）
    printNext(protocol, route(protocol)[0]?.id ?? 'open');
    return;
  }

  if (command === 'status') {
    const changeName = await findActiveChange();
    if (!changeName) {
      console.log(JSON.stringify({ status: 'no-change', message: 'No active change in .specs/' }, null, 2));
      return;
    }
    const state = await readState();
    const detectedNode = await determineNode(changeName, protocol, state.completedNodes);
    console.log(JSON.stringify({
      status: 'running',
      change: changeName,
      currentNode: detectedNode,
      stateCurrentNode: state.currentNode,
      completedNodes: state.completedNodes,
      executionMode: state.executionMode ?? 'subagent',
      directOverride: state.directOverride ?? false,
      branchMode: isInsideWorkTree(),
      enablePrReview: state.enablePrReview ?? false,
      artifactRoot: '.specs/' + changeName,
      coordinatorMode: ['execute', 'subagent-execute'].includes(detectedNode)
    }, null, 2));
    printBranchLine(changeName, state.branchPrefix ?? 'change/');
    return;
  }

  if (command === 'next') {
    const changeName = await findActiveChange();
    if (!changeName) {
      console.log('NEXT: done');
      console.log('MESSAGE: No active change. Run: node workflow-state.mjs init <change-name>');
      return;
    }
    const state = await readState();
    // 节点顺序校验（严格模式）——state.currentNode 非 null、不在 completedNodes、
    // 且 evidence 无该节点记录 → 上一节点从未 exit 就推进 → BLOCKED（exit 1）。
    // 状态漂移校正保留：已完成节点（currentNode ∈ completedNodes，或 evidence 已记录——
    // 节点已被 record/exit 处理过）正常推进不受影响；本校验只拦"证据完全缺失的疑似跳阶段"。
    // 豁免（两种独立判断，任一成立即放行）： 回退豁免（TASK.md 有 pending 回退修复任务 回 execute）；
    //  正常推进豁免（currentNode 是 completedNodes 最后节点 exit 推进的正常下一节点，
    // 见 normalAdvanceExempt）——真乱序（跳节点）仍严格 BLOCK
    const completedArr = Array.isArray(state.completedNodes) ? state.completedNodes : [];
    if (state.currentNode && !completedArr.includes(state.currentNode)) {
      const nodeEvidence = state.evidence && typeof state.evidence === 'object'
        ? state.evidence[state.currentNode]
        : null;
      const hasEvidence = !!(nodeEvidence && typeof nodeEvidence === 'object' && !Array.isArray(nodeEvidence));
      if (!hasEvidence) {
        // 回退豁免——review/verify 发现缺陷追加 pending 修复任务后回 execute 的
        // 修复任务标准回退路径放行（否则被  严格模式误拦为"未 exit 跳阶段"）；
        // 豁免条件不满足时维持严格 BLOCK
        const rollbackExempt = await tFixRollbackExempt(changeName, protocol, state.currentNode, completedArr);
        // 正常推进豁免——exit --apply 推进 currentNode 到下一节点后按 SKILL 协议调 next
        // （正常路径）不拦截；与  回退豁免独立判断（详见 normalAdvanceExempt 注释）
        const advanceExempt = normalAdvanceExempt(state, protocol, completedArr, state.currentNode);
        if (!rollbackExempt && !advanceExempt) {
          console.error('BLOCKED: 疑似未 exit 节点 ' + state.currentNode + '，先 workflow-guard.mjs exit ' + state.currentNode + ' --apply');
          console.error('恢复: 确认当前节点实际已完成 → 用 exit <节点> --apply 正常推进；节点状态漂移/卡死 → 用 workflow-state.mjs advance（强制推进）或 select（切换 change）；禁止手改 state 机器字段');
          process.exit(1);
        }
      }
    }
    const detectedNode = await determineNode(changeName, protocol, state.completedNodes);
    // 状态漂移自动校正——以文件产物为准（determineNode），校正 state.currentNode
    if (state.currentNode !== detectedNode) {
      state.currentNode = detectedNode;
      await writeState(state);
    }
    printNext(protocol, detectedNode, state.executionMode ?? 'subagent');
    printBranchLine(changeName, state.branchPrefix ?? 'change/');
    return;
  }

  if (command === 'select') {
    const changeName = process.argv[3];
    if (!changeName) throw new Error('select requires a change name.');
    const changeDir = path.join(specsRoot, changeName);
    if (!(await fileExists(changeDir))) throw new Error('Change not found: ' + changeDir);
    const state = await readState();
    state.activeChange = changeName;
    if (!state.currentNode) state.currentNode = await determineNode(changeName, protocol, state.completedNodes);
    await writeState(state);
    console.log('Selected: ' + changeName);
    return;
  }

  if (command === 'skill-load') {
    // 协议解析: 执行者加载节点 skill 后运行 skill-load <node> <skill> [--prompt <path>]，
    // 写入声明标记 .specs/<change-id>/.skill-loads/<node>-<skill>.json（{ node, skill, protocol, at }），
    // record 校验 completedChecks 的 required-skill 条目以此为准（内置节点常量）。
    // 诚实边界：标记是"声明"而非物理证明——运行时没有 Skill 调用观察点，脚本无法确认执行者
    // 真实加载过该 skill；标记仅记录"执行者主动声明已加载"，由流程纪律兜底。
    const nodeId = process.argv[3];
    const skillName = process.argv[4];
    if (!nodeId || !skillName) {
      throw new Error('skill-load requires <node> <skill>. 用法: workflow-state.mjs skill-load <node> <skill> [--prompt <path>]');
    }
    // 参数校验：node 为当前协议节点集合之一（动态读取协议 nodes[].id——内置 +
    // 自定义，compose 自定义协议节点可声明）；协议外节点名依然非法（fail-closed）。
    // BUILTIN_NODES 仅作内置常量保留（其他用途参照），skill-load 校验不再依赖它。
    const protocolNodeIds = (protocol.nodes ?? []).map((n) => n.id);
    if (!protocolNodeIds.includes(nodeId)) {
      throw new Error('skill-load node 非法: ' + nodeId + '（协议节点: ' + protocolNodeIds.join('/') + '）');
    }
    if (!/^[A-Za-z0-9-]+$/.test(skillName)) {
      throw new Error('skill-load skill 名非法（仅允许字母数字连字符）: ' + skillName);
    }
    // --prompt 归属校验：路径必须位于 flow-kit/prompts/ 下（相对或绝对，前缀校验；
    // flow-kit 为 vendored 上游，协议提示只读引用）。协议加载本身由 resolveProtocol 全局
    // 处理（含受保护读取）——--protocol 语义不变（工作流协议 JSON）；此处仅校验用户显式传入的
    // --prompt 原始值（skill-load 专属参数，不再与全局协议解析共用 --protocol）。
    const promptArg = findPromptArg(process.argv.slice(3));
    if (promptArg !== null && !protocolUnderFlowKitPrompts(promptArg)) {
      throw new Error('skill-load --prompt 路径必须位于 flow-kit/prompts/ 下（flow-kit 为 vendored 上游，协议提示只读引用）: ' + promptArg);
    }
    // 声明标记写入：.skill-loads/ 目录不存在时创建（writeJson 自带 mkdir recursive）；
    // 同 node-skill 重复调用覆盖（记录最新声明）
    const changeName = await findActiveChange();
    if (!changeName) {
      throw new Error('skill-load requires an active change（先运行 init <change-id>）');
    }
    // 标记 protocol 字段 = --prompt 参数的 basename（如 0-change.md）——与 guard exit
    // 校验的 节点协议映射 表 basename 精确比对同值（真实链路 skill-load → exit 一致）；未传 --prompt →
    // null（无协议声明，exit 校验 fail-closed）。修复前旧实现写 resolveProtocol 解析后的完整
    // 绝对路径，与 节点协议映射 表 basename 比对必然失败（真实链路必 BLOCKED——机制实际不可用）。
    const marker = { node: nodeId, skill: skillName, protocol: promptArg === null ? null : path.basename(promptArg), at: new Date().toISOString() };
    // specsRoot 已含 .specs/，相对路径为 <change-id>/.skill-loads/<node>-<skill>.json
    const markerRel = path.posix.join(changeName, '.skill-loads', nodeId + '-' + skillName + '.json');
    await writeJson(path.join(specsRoot, markerRel), marker);
    console.log('SKILL-LOAD: ' + nodeId + ' ' + skillName + ' → .skill-loads/' + nodeId + '-' + skillName + '.json');
    return;
  }

  if (command === 'record') {
    const nodeId = process.argv[3];
    if (!nodeId) throw new Error('record requires a Node id.');
    const state = await readState();
    state.evidence = state.evidence || {};
    // 解析 JSON 参数并展开到 evidence 顶层（summary/completedChecks/output-schema evidence 等）；
    // 若不可解析则作为 summary 字符串
    // payload 解析前剥离 --protocol（及 --protocol=<p>）——resolveProtocol 已全局提取协议路径，
    // 此处仅防其拼入 payload 导致 JSON 解析失败（结构字段丢失）
    let parsed = {};
    const payloadArgs = [];
    const recordArgs = process.argv.slice(4);
    for (let i = 0; i < recordArgs.length; i++) {
      const arg = recordArgs[i];
      if (arg === '--protocol') { i += 1; continue; }
      if (typeof arg === 'string' && arg.startsWith('--protocol=')) continue;
      payloadArgs.push(arg);
    }
    const raw = payloadArgs.join(' ');
    try {
      parsed = raw ? JSON.parse(raw) : {};
      if (typeof parsed !== 'object' || Array.isArray(parsed)) parsed = { summary: String(parsed) };
    } catch {
      parsed = { summary: raw || 'recorded' };
    }
    // 内置节点常量/声明标记写入/旧 change 兼容: completedChecks 真实性校验（skill-load 声明标记）——解析本次 record 写入的
    // completedChecks 的 required-skill:<node>.<skill> 条目 → 对应声明标记必须存在（内置节点常量，
    // 缺失 → BLOCKED + 指引先加载 skill 并运行 skill-load）；标记 at 必须 ≤ 本次记录时间
    // （声明标记写入 交叉自洽：标记先于记录声明）。仅校验本次写入的 payload，旧 evidence 不追溯（旧 change 兼容）。
    const recordedAt = new Date().toISOString();
    // 标记归属 change 与 evidence 一致：优先 state.activeChange，缺失时回退 findActiveChange（与
    // 下方 NEXT 推导同语义）；两者皆无 → verifySkillLoadMarkers 内 fail-closed BLOCK。
    // 传入 protocol + state——按 requiredSkillCalls scope 分类条目（handoff scope 豁免标记，
    // 以共用证据库 handoffResult 为证据）
    const markerChange = state.activeChange || await findActiveChange();
    const markerCheck = await verifySkillLoadMarkers(parsed.completedChecks, markerChange, recordedAt, protocol, state);
    if (!markerCheck.ok) {
      console.error('BLOCKED: ' + markerCheck.reason);
      process.exit(1);
    }
    state.evidence[nodeId] = {
      ...(state.evidence[nodeId] || {}),
      ...parsed,
      recordedAt,
    };
    await writeState(state);
    console.log('EVIDENCE: ' + nodeId);
    const changeName = state.activeChange || await findActiveChange();
    const nextNode = changeName ? await determineNode(changeName, protocol, state.completedNodes) : null;
    printNext(protocol, nextNode ?? null, state.executionMode ?? 'subagent');
    return;
  }

  if (command === 'config') {
    // E1: 配置命令——config set <key> <value>；branchMode 只读（init 自动判定），enablePrReview 手动开关
    const sub = process.argv[3];
    const key = process.argv[4];
    const value = process.argv[5];
    if (sub !== 'set') throw new Error('config 仅支持 set 子命令。用法: workflow-state.mjs config set <key> <value>');
    if (!key || value === undefined) throw new Error('config set 需要 key 和 value。用法: workflow-state.mjs config set <key> <value>');
    if (key === 'branchMode') {
      console.error('BLOCKED: branchMode 由 init 自动判定，不可手动设置');
      process.exit(1);
    }
    if (key === 'enablePrReview') {
      if (value !== 'true' && value !== 'false') {
        console.error('BLOCKED: config set 值非法（enablePrReview 必须为 true 或 false）: ' + value);
        process.exit(1);
      }
      const state = await readState();
      state.enablePrReview = value === 'true';
      await writeState(state);
      console.log('CONFIG: enablePrReview = ' + state.enablePrReview);
      return;
    }
    console.error('BLOCKED: 未知配置键: ' + key + '（支持: enablePrReview；branchMode 由 init 自动判定）');
    process.exit(1);
  }

  if (command === 'execution-mode') {
    const mode = process.argv[3];
    if (mode !== 'subagent' && mode !== 'direct') {
      console.error('BLOCKED: execution-mode 参数必须为 subagent 或 direct，收到: ' + String(mode));
      process.exit(1);
    }
    const state = await readState();
    state.executionMode = mode;
    // direct 是逃生口：必须用户显式调用，并记录 directOverride；切回 subagent 时清除
    // （directOverride 恒等于"当前是否处于用户确认的 direct"——再次切 direct 必须重新确认，无历史歧义）
    state.directOverride = mode === 'direct';
    await writeState(state);
    console.log('EXECUTION-MODE: ' + state.executionMode + (state.directOverride ? ' (directOverride)' : ''));
    return;
  }

  if (command === 'verify-fail') {
    const state = await readState();
    state.verifyFailures = state.verifyFailures ?? 0;
    // W2-A: 机器计数——连续 3 次失败后（第 4 次）BLOCKED，要求用户决策（继续修 / 停止）
    if (state.verifyFailures >= 3) {
      console.error('verify 失败超限，需用户决策（verifyFailures=' + state.verifyFailures + '）。继续修 / 停止？');
      process.exit(1);
    }
    state.verifyFailures += 1;
    await writeState(state);
    console.log('VERIFY-FAIL: ' + state.verifyFailures + '/3');
    return;
  }

  if (command === 'advance') {
    const state = await readState();
    if (!state.activeChange) {
      console.log('No active change. Use select first.');
      return;
    }
    if (!state.completedNodes.includes(state.currentNode)) {
      state.completedNodes.push(state.currentNode);
    }
    // Use determineNode to get the actual next node (reads TASK.md)
    const detected = await determineNode(state.activeChange, protocol, state.completedNodes);
    state.currentNode = detected;
    await writeState(state);
    console.log('Advanced to: ' + state.currentNode);
    return;
  }

  throw new Error('Unknown command: ' + command + '. Use: init, status, next, select, record, verify-fail, advance, execution-mode, config, skill-load');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
