// route-node.mjs — 共享「任务状态 → 节点」路由判定入口（单一权威实现）
// 本模块保留路由与完成判定核心（含「串行 pending → execute」回流），并把四个判定族的实现转出为
// lib/ 下的模块（任务与协议图 / Fix 族与轮次 / 受控重入 / 受控重校）；消费方的 import 面与符号名
// 逐字不变，判定实现各自只有一处。
// 纯判定：无副作用、无 console 输出、无 process.exit——只读 .specs 产物与任务文件，仅返回节点 id
// （或 null = 完成态）；展示层（guard NEXT+SKILL 行 / workflow-state NODE+SKILL 行）由各自调用方
// 渲染，不并入本模块（文案逐字保留）。
// 依赖方向：入口 → lib → 既有共享模块（task-parsing / state-schema），lib 之间无循环。
import { promises as fs } from 'fs';
import path from 'path';
import { taskBlocks, taskOpeningAttrs } from './task-parsing.mjs';
import {
  route,
  protocolNodeEnabled,
  protocolTaskFilePath,
  EXECUTE_FAMILY_NODE_IDS,
  taskDependencyEligibility,
  escapeRegExp,
  taskSetSignature,
  parseTaskSetSignature,
} from './lib/task-graph.mjs';
import { readProtocolTaskContent, latestExecuteExitEvent } from './lib/fix-loop-node.mjs';

// ---------- 节点完成判定 · 完成标志从协议 outputSchemas 推导 ----------

// 为每个节点构建"完成标志文件集"：遍历节点 outputSchemas 引用的 schema 的 artifacts
// （schema 在协议 outputSchemas 数组中按 id 查找），paths 中 <change-id> 替换为实际
// changeName，得到相对 specs-root 的文件路径数组。同一 artifact 的 paths 为互斥备选（命中任一即
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
        // fail-fast（与 guard 侧 workflowArtifactRoot 同语义）：产物根只支持 'project'/缺省 → runRoot
        // 与 'specs-root' → <root>/.specs；下列三类 classic/native pathBase 依赖项目配置文件，该配置源
        // 已随感知层剥离——不再有读取方，遇即显式报错（不静默兜底），提示改用 specs-root/project + 完整路径。
        if (artifact.pathBase === 'classic-openspec-root'
          || artifact.pathBase === 'classic-superpowers-root'
          || artifact.pathBase === 'native-root') {
          throw new Error('产物根 pathBase "' + artifact.pathBase
            + '" 已不受 guard 与状态机支持——请改用 specs-root/project + 完整路径（如 project + openspec/changes/xxx.md）');
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
// 产物推导 pathBase 感知: 产物根按 artifact.pathBase 解析——'specs-root' → specsRoot；'project'/缺省 → runRoot
// （与 workflow-guard.mjs 的 workflowPathBaseRoot 对齐：内置协议 10 个 artifacts 全部显式
// 声明 specs-root；compose 自定义协议可声明 project 根工件如 README.md）。
// classic/native 三类不属于二分——标志构建阶段即 fail-fast 拒绝（见上方 artifact 循环），
// 走不到这里，故此处无需为它们兜底。
async function nodeFlagsComplete(nodeFlags, nodeId, specsRoot, runRoot) {
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

// 协议是否含 subagent-execute 委托节点（自定义协议可不含——此时 parallel 任务由 execute 直接消化）
function hasSubagentNode(protocol) {
  return protocolNodeEnabled(protocol, 'subagent-execute');
}

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

// ---------- 委托归属共享判定（纯函数 · 单一权威） ----------
// 任务属性、依赖资格、协议 enabled → 归属目标 / 不可委托原因。本模块的下一节点判定与请求归属门禁
// 共用本段实现，禁止任一侧再内联「parallel → 目标节点」映射。
// 本段无 fs / console / process.exit / state 写入，只做确定性推导。

// 归属判定：输入 taskAttrs（task-parsing 开标签属性）、依赖资格、协议 enabled。
// 返回 { targetNode, delegable, reason }，reason 取值：
//   not-pending         任务非 pending，归属门禁不适用；
//   serial              pending 串行 → 归属 execute；
//   no-delegation-node  pending 并行但协议无 enabled 委托节点 → 门禁不适用；
//   dependencies-unmet  pending 并行但依赖未满足 → 当前不可委托（路由按串行消化走 execute）；
//   parallel-eligible   pending 并行且依赖满足 → 归属 subagent-execute。
export function resolveDelegationTarget({
  taskAttrs = null,
  dependencyEligible = false,
  subagentNodeEnabled = false,
  executeNodeEnabled = true,
} = {}) {
  if (!taskAttrs || taskAttrs.status !== 'pending') {
    return { targetNode: null, delegable: false, reason: 'not-pending' };
  }
  if (taskAttrs.parallel !== true) {
    return executeNodeEnabled
      ? { targetNode: 'execute', delegable: true, reason: 'serial' }
      : { targetNode: null, delegable: false, reason: 'no-delegation-node' };
  }
  if (!subagentNodeEnabled) {
    return { targetNode: null, delegable: false, reason: 'no-delegation-node' };
  }
  if (!dependencyEligible) {
    return { targetNode: null, delegable: false, reason: 'dependencies-unmet' };
  }
  return { targetNode: 'subagent-execute', delegable: true, reason: 'parallel-eligible' };
}

// 判定核心（行为逐字等价——重构保持锚）：
// 输入 { runRoot, changeName, protocol, completedNodes = [] } → 输出节点 id 或 null（完成态）。
// 判定顺序：① completedNodes 全齐 → null；② execute 家族之前的节点产物门控；③ 无 execute 家族 →
// 最后节点；④ 任务状态特判（pending 且依赖满足的 parallel → subagent-execute / 串行 pending →
// execute / 全 done 但缺 SUMMARY → execute / 后置节点产物门控 / 全部通过 → 最后节点）；⑤ 解析失败兜底 execute。
export async function resolveNextNode({ runRoot, changeName, protocol, completedNodes = [] }) {
  const specsRoot = path.join(runRoot, '.specs');
  // 全部节点已完成 → 完成态，不产出最后节点。自定义协议无 archive 节点时，completedNodes 全齐后
  // next 仍会输出 NODE: <最后节点>（产物推导只返回最后节点 id）——此处（产物推导之前）判定：
  // route(protocol) 的所有节点 id 均已包含在 completedNodes 中 → 返回 null。printNext(null) 输出
  // "NEXT: done"；status 的 currentNode = null 表示完成态。内置协议不受影响：archive exit 时
  // workflow-guard 清 activeChange，findActiveChange 返回 null 先于本判定触发；completedNodes 含
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
  const taskPath = protocolTaskFilePath(protocol, changeName, specsRoot);

  // 节点顺序 = 协议 nodes 顺序（disabled 过滤，见 task-graph 的 route）；execute/subagent-execute 由
  // 任务状态特判。按协议顺序拆分：execute/subagent-execute 之前的节点走产物门控（内置 = open →
  // design → plan），之后的节点在任务全部 done 后按序门控（内置 = review → verify → archive）。
  const orderedNodes = route(protocol);
  const hasExecuteFamily = orderedNodes.some((n) => EXECUTE_FAMILY_NODE_IDS.has(n.id));
  const preExecNodes = [];
  const postExecNodes = [];
  let sawExecuteFamily = false;
  for (const node of orderedNodes) {
    if (EXECUTE_FAMILY_NODE_IDS.has(node.id)) {
      sawExecuteFamily = true;
      continue;
    }
    if (sawExecuteFamily) postExecNodes.push(node);
    else preExecNodes.push(node);
  }

  // 前置产物门控：execute 之前的节点按序检查（内置协议 = open → design → plan）
  for (const node of preExecNodes) {
    if (!(await nodeFlagsComplete(nodeFlags, node.id, specsRoot, runRoot))) return node.id;
  }

  // 协议无 execute/subagent-execute 节点：无任务状态特判，全部节点已按产物门控完成 → 当前处于最后节点
  if (!hasExecuteFamily) {
    return orderedNodes.length > 0 ? orderedNodes[orderedNodes.length - 1].id : 'archive';
  }

  // execute/subagent-execute 特判：解析任务文件 <task> 块 pending/done/parallel/depends_on。
  // 属性解析统一走 task-parsing.mjs 的 taskOpeningAttrs——只读 <task ...> 开标签（属性序无关、
  // 不受 <action>/<verify> 内容文本干扰），与 workflow-guard 的校验共享同一语义。
  try {
    const taskContent = await fs.readFile(taskPath, 'utf8');
    const taskList = taskBlocks(taskContent);
    const attrsList = taskList.map(taskOpeningAttrs).filter(Boolean);
    const pending = attrsList.filter((a) => a.status === 'pending').length;
    const done = attrsList.filter((a) => a.status === 'done').length;
    if (pending > 0) {
      // 多趟循环路由：委托进入谓词每趟重新求值——∃ p ∈ tasks：p.parallel ∧ p.status=pending ∧
      // deps(p) ⊆ doneIds → 路由 subagent-execute（第 N 趟，节点可多次进入）。死循环防护由三重
      // 保险承担：plan 出口依赖图前置拦截（guard）/ next 单趟零进展防呆（workflow-state）/ 每趟
      // 重入完整 entry 检查（guard entry，不绕过）。与出口 --apply 的平行路由镜像同谓词。
      // 只检测依赖已满足的 parallel 任务，避免 Wave N+1 的 parallel 任务在 Wave N 串行任务未完成时
      // 就被路由到 subagent-execute。
      if (hasSubagentNode(protocol)) {
        // 收集所有 done 任务的 id（开标签属性序无关）
        const doneIds = new Set(attrsList.filter((a) => a.status === 'done' && a.id).map((a) => a.id));
        // 检查 pending parallel 任务中是否有依赖已满足的（开标签 parallel="true" 且 status="pending"）——
        // 依赖资格与归属目标一律走共享纯函数，不在本函数内联第二份判定。
        const hasDelegableParallel = taskList.some((block) => {
          const attrs = taskOpeningAttrs(block);
          if (!attrs || attrs.parallel !== true || attrs.status !== 'pending') return false;
          const dependencyEligible = taskDependencyEligibility(block, doneIds).eligible;
          return resolveDelegationTarget({
            taskAttrs: attrs,
            dependencyEligible,
            subagentNodeEnabled: true,
          }).delegable;
        });
        if (hasDelegableParallel) return 'subagent-execute';
      }
      return 'execute';
    }
    // 完成判定 fail-closed：pending===0 不足为凭——缺/未知 status 的任务既非 pending 也非 done，
    // 畸形块若被跳过，会在另一任务已产 SUMMARY 时把完成态误判为「任务全部 done」→ 提前路由 review。
    // attrsList.length===0（无任务块可解析）或 done !== attrsList.length（存在缺/未知 status 任务）
    // → 一律回 execute（不提前放行到后置节点）。
    if (attrsList.length === 0 || done !== attrsList.length) return 'execute';
    // 任务全部 done——execute 完成还需至少一份 SUMMARY（execute 产物门控，内置 = <change-id>/*-SUMMARY.md glob）
    if (!(await nodeFlagsComplete(nodeFlags, 'execute', specsRoot, runRoot))) return 'execute';
    // 后置产物门控：按协议顺序检查 execute 之后的节点（内置 = review → verify → archive）。
    // verify 的完成标志 = flowkit.verify.v1 全部 required artifacts（TEST.md + UAT.md）；自然流程中
    // TEST.md 由 review 产出、UAT.md 由 verify 产出，故"verify 看 UAT.md"的判定语义保持不变。
    for (const node of postExecNodes) {
      if (!(await nodeFlagsComplete(nodeFlags, node.id, specsRoot, runRoot))) return node.id;
    }
    // 全部产物门控通过 → 当前处于协议最后一个节点（内置协议 = archive，与现硬编码 checks.uat → 'archive' 一致）
    return orderedNodes.length > 0 ? orderedNodes[orderedNodes.length - 1].id : 'archive';
  } catch {}

  return 'execute';
}

// ---------- Fix 受控归位决策（单一权威——入口/出口与 state 的 next 分支一律复用本段） ----------
// 本决策需要路由核心 resolveNextNode（留在本模块），故与 Fix 族实现分处两层：判定输入来自
// fix-loop-node 的 TASK.md 读取与历史签名派生，路由复用唯一权威 resolveNextNode，不复制判定。
// currentNode ∈ {review, verify} ∧ TASK.md 可解析出任务块 ∧ 以下任一：
//   ① 存在 status="pending" 任务 ∧ resolveNextNode(completedNodes) ∈ execute 家族
//      （串行 pending → execute；可委托 parallel pending → subagent-execute）
//      → 返回 { target: 目标节点, kind: 'pending' }（受控归位的计数分支）；
//   ② 全任务 done ∧ execute 家族至少一个节点已在 completedNodes ∧ history 最新家族出口事件记录的
//      任务集签名与当前 TASK.md 签名不一致 → 返回 { target: 记录节点, kind: 'unclosed' }
//      （done-but-unclosed：追加/修改修复任务后从未重跑家族出口；lazy entry 只刷新 taskHash、
//      不写 exit 事件，签名保持不一致）。
// 旧 state 无签名记录 / 签名不可解析 / 算法版本不同 → ② 不成立（旧 change 渐进放行，跨版本不比对）。
// TASK.md 缺失 / 不可读 / 零任务块 / 当前节点非 review|verify → null（fail-closed）。
export async function resolveFixRollbackDecision({ runRoot, changeName, protocol, completedNodes = [], currentNode, history = [] }) {
  if (currentNode !== 'review' && currentNode !== 'verify') return null;
  const taskContent = await readProtocolTaskContent(protocol, changeName, path.join(runRoot, '.specs'));
  if (taskContent === null) return null;
  const attrsList = taskBlocks(taskContent).map(taskOpeningAttrs).filter(Boolean);
  if (attrsList.length === 0) return null;
  if (attrsList.some((attrs) => attrs.status === 'pending')) {
    try {
      const next = await resolveNextNode({ runRoot, changeName, protocol, completedNodes });
      return EXECUTE_FAMILY_NODE_IDS.has(next) ? { target: next, kind: 'pending' } : null;
    } catch {
      return null;
    }
  }
  if (!attrsList.every((attrs) => attrs.status === 'done')) return null;
  if (![...EXECUTE_FAMILY_NODE_IDS].some((id) => completedNodes.includes(id))) return null;
  const recorded = latestExecuteExitEvent(history, changeName);
  if (recorded === null) return null;
  const current = parseTaskSetSignature(taskSetSignature(taskContent));
  if (current === null || recorded.algo !== current.algo) return null;
  return recorded.digest !== current.digest ? { target: recorded.node, kind: 'unclosed' } : null;
}

// 兼容入口：只取目标节点（既有调用方语义逐字不变）；新增消费点应优先用决策形态。
export async function resolveFixRollbackState(args) {
  const decision = await resolveFixRollbackDecision(args);
  return decision === null ? null : decision.target;
}

// ---------- 判定族转出（实现各在新模块一处；消费方的 import 路径与符号名保持不变） ----------
// 本模块保留的判定：resolveDelegationTarget / resolveNextNode / resolveFixRollbackDecision /
// resolveFixRollbackState 已就地 export（见上方定义）；此处转出其余经 lib 取用或就地判定的符号。
export {
  route,
  protocolNodeEnabled,
  protocolTaskFilePath,
  EXECUTE_FAMILY_NODE_IDS,
  taskDependencyEligibility,
  taskSetSignature,
  parseTaskSetSignature,
  hasSubagentNode,
};

export {
  TASK_SET_SIGNATURE_ALGO,
  sameTaskSetSignature,
  taskSetSignatureVersionSkew,
  FIX_SECTION_TITLE_FALLBACK,
  analyzeDependencyGraph,
  findParallelWriteConflicts,
  collectPathOverlaps,
  normalizeHeading,
  isSingleSegmentChangeName,
} from './lib/task-graph.mjs';

export {
  firstIncompletePostExecNode,
  classifyFixReturnCause,
  applyFixRollbackRound,
  resolveFixReturnNode,
} from './lib/fix-loop-node.mjs';

export {
  REENTRY_TARGET_NODE_IDS,
  REENTRY_ROUND_LIMIT,
  reentrySourceDecision,
  resolveReentryTarget,
  parseReentryAuthorization,
  parseReentryContinuationAuthorization,
  reentryRoundCount,
  reentryRoundDecision,
  reentryPredecessorIntersection,
  reentryNoOpDecision,
  resolveReentryDecision,
} from './lib/reentry-node.mjs';

export {
  REPLAN_PHASE_NODE_IDS,
  REPLAN_ROUND_LIMIT,
  replanSourceDecision,
  parseReplanAuthorization,
  parseReplanContinuationAuthorization,
  replanRoundCount,
  replanRoundDecision,
  replanNoOpDecision,
  resolveReplanDecision,
} from './lib/replan-node.mjs';
