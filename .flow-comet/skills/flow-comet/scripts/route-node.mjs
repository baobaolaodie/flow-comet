// route-node.mjs — 共享「任务状态 → 节点」路由判定核心（单一权威实现）
// 本模块承载从 workflow-state.mjs determineNode 抽取的节点判定核心（含「串行 pending → execute」回流）。
// 两侧复用同一实现（guard 与 workflow-state 各调用 resolveNextNode），根治双实现漂移。
// 纯判定：resolveNextNode 无副作用、无 console 输出、无 process.exit——只读 .specs 产物与任务文件，
// 仅返回节点 id（或 null = 完成态）；展示层（guard NEXT+SKILL 行 / workflow-state NODE+SKILL 行）
// 由各自调用方渲染，不并入本模块（文案逐字保留）。
// 接口：resolveNextNode({ runRoot, changeName, protocol, completedNodes = [] })——runRoot 显式传入，
// specsRoot 由 runRoot 派生为 path.join(runRoot, '.specs')（与两侧调用方各自 .specs 根语义一致）。
import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { taskBlocks, taskOpeningAttrs } from './task-parsing.mjs';
import { fixRoundsFor, setFixRoundsFor } from './state-schema.mjs';

// 节点顺序 = 协议 nodes 顺序（disabled 过滤）。两侧路由排序共用同一实现（单一来源）。
function route(protocol) {
  return (protocol.nodes ?? []).filter((n) => !n.disabled);
}

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

// 协议任务文件路径：协议可选 taskFile 字段（相对 .specs/<change-id>/），无声明时缺省 TASK.md。
// resolveNextNode 与 workflow-state next 的零进展防呆共用（同一解析，防两处漂移）。
function protocolTaskFilePath(protocol, changeName, specsRoot) {
  const taskFile = typeof protocol.taskFile === 'string' && protocol.taskFile !== ''
    ? protocol.taskFile
    : 'TASK.md';
  return path.join(specsRoot, changeName, taskFile);
}

// 协议节点是否 enabled：route 顺序中存在且未 disabled。协议 enabled 语义以本函数为唯一来源，
// hasSubagentNode 与各消费方（含请求归属门禁）一律复用，不各自过滤。
export function protocolNodeEnabled(protocol, nodeId) {
  return route(protocol).some((node) => node.id === nodeId);
}

// 协议是否含 subagent-execute 委托节点（自定义协议可不含——此时 parallel 任务由 execute 直接消化）
function hasSubagentNode(protocol) {
  return protocolNodeEnabled(protocol, 'subagent-execute');
}

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

// ---------- 委托归属共享判定（纯函数 · 单一权威） ----------
// 任务属性、依赖资格、协议 enabled → 归属目标 / 不可委托原因。resolveNextNode 的下一节点
// 判定与请求归属门禁共用本段实现，禁止任一侧再内联「parallel → 目标节点」映射。
// 本段无 fs / console / process.exit / state 写入，只做确定性推导。

// 依赖资格：解析任务块的 <depends_on> 并与已完成任务 id 集合比较。依赖文本解析只此一处，
// resolveNextNode 的可委托并行过滤与消费方一律调用本函数。返回 { eligible, deps, unmet }；
// 无 <depends_on> 元素或内容为空视为无依赖（eligible=true）。
export function taskDependencyEligibility(block, doneIds = new Set()) {
  const depsMatch = String(block ?? '').match(/<depends_on>([\s\S]*?)<\/depends_on>/);
  if (!depsMatch || !depsMatch[1].trim()) return { eligible: true, deps: [], unmet: [] };
  const deps = depsMatch[1].trim().split(/[,\s]+/).filter(Boolean);
  const unmet = deps.filter((dep) => !doneIds.has(dep));
  return { eligible: unmet.length === 0, deps, unmet };
}

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

// 判定核心（抽取自 workflow-state.mjs determineNode，行为逐字等价——重构保持锚）：
// 输入 { runRoot, changeName, protocol, completedNodes = [] } → 输出节点 id 或 null（完成态）。
// 判定顺序：① completedNodes 全齐 → null；② execute 家族之前的节点产物门控；③ 无 execute 家族 →
// 最后节点；④ 任务状态特判（pending 且依赖满足的 parallel → subagent-execute / 串行 pending →
// execute / 全 done 但缺 SUMMARY → execute / 后置节点产物门控 / 全部通过 → 最后节点）；⑤ 解析失败兜底 execute。
export async function resolveNextNode({ runRoot, changeName, protocol, completedNodes = [] }) {
  const specsRoot = path.join(runRoot, '.specs');
  // （实证）: 全部节点已完成 → 完成态，不产出最后节点。
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
  const taskPath = protocolTaskFilePath(protocol, changeName, specsRoot);

  // 节点顺序 = 协议 nodes 顺序（disabled 过滤，见 route()）；execute/subagent-execute 由任务状态特判。
  // 按协议顺序拆分：execute/subagent-execute 之前的节点走产物门控（内置 = open → design → plan），
  // 之后的节点在任务全部 done 后按序门控（内置 = review → verify → archive）。
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
      // 多趟循环路由（循环路由形态决策 · 多趟路由架构决策记录）：委托进入谓词每趟重新求值——∃ p ∈ tasks：p.parallel ∧
      // p.status=pending ∧ deps(p) ⊆ doneIds → 路由 subagent-execute（第 N 趟，节点可多次进入）。
      // 旧「首趟委托完成后即固定单趟」的防死循环限制移除；死循环防护改由三重保险承担：
      // plan 出口依赖图前置拦截（guard）/ next 单趟零进展防呆（workflow-state）/ 每趟重入完整 entry 检查
      // （guard entry R2，不绕过）。与 workflow-guard 出口 --apply 平行路由镜像同谓词。
      // 只检测依赖已满足的 parallel 任务，避免 Wave N+1 的 parallel 任务
      // 在 Wave N 串行任务未完成时就被路由到 subagent-execute。
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
    // 完成判定 fail-closed（CodeRabbit 采纳）：pending===0 不足为凭——缺/未知 status 的任务既非
    // pending 也非 done，畸形块若被跳过，会在另一任务已产 SUMMARY 时把完成态误判为「任务全部
    // done」→ 提前路由 review。attrsList.length===0（无任务块可解析）或 done !== attrsList.length
    // （存在缺/未知 status 任务）→ 一律回 execute（不提前放行到后置节点）。
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

// ---------- 任务依赖图分析（自 workflow-guard.mjs 迁入 · 单一权威） ----------
// 依赖图分析：对全部 <task> 块建依赖图（deps 边），Kahn 拓扑排序判环 + 缺失依赖收集。
// 返回 { ids, depsById, missing: [{id, dep}], cyclic, cycleIds }（cycleIds = 拓扑排序无解的
// 任务集合，含被环传递拖累的下游任务）。plan 出口波次校验、subagent-execute 出口孤儿检测与
// replan 重校共用同一实现（单一语义：依赖图无环 + 依赖链可满足）。
// 等价移动：判据 / 分级 / 文案零变化；依赖文本解析复用本模块 taskDependencyEligibility
// （依赖解析单一权威——不再另起第二份正则；与 guard 侧 taskDependsOn 正则逐字同语义）。
function analyzeDependencyGraph(blocks) {
  const parsed = blocks
    .map((block) => ({ block, attrs: taskOpeningAttrs(block) }))
    .filter((x) => x.attrs && x.attrs.id);
  const ids = new Set(parsed.map((x) => x.attrs.id));
  const depsById = new Map();
  const missing = [];
  for (const x of parsed) {
    const deps = [...new Set(taskDependencyEligibility(x.block).deps)];
    depsById.set(x.attrs.id, deps);
    for (const d of deps) {
      if (!ids.has(d)) missing.push({ id: x.attrs.id, dep: d });
    }
  }
  const indegree = new Map([...ids].map((id) => [id, 0]));
  const dependents = new Map([...ids].map((id) => [id, []]));
  for (const [id, deps] of depsById) {
    for (const d of deps) {
      if (!ids.has(d)) continue;
      indegree.set(id, indegree.get(id) + 1);
      dependents.get(d).push(id);
    }
  }
  let queue = [...ids].filter((id) => indegree.get(id) === 0);
  const sorted = [];
  while (queue.length > 0) {
    const n = queue.shift();
    sorted.push(n);
    for (const m of dependents.get(n)) {
      indegree.set(m, indegree.get(m) - 1);
      if (indegree.get(m) === 0) queue.push(m);
    }
  }
  const cyclic = sorted.length < ids.size;
  const cycleIds = cyclic ? [...ids].filter((id) => !sorted.includes(id)) : [];
  return { ids, depsById, missing, cyclic, cycleIds };
}

// ---------- 并行文件依赖检测（单源：workflow-guard 门禁与 replan 重校共用） ----------
// 并行文件依赖检测——解析 TASK.md 中本趟可运行的 parallel=pending 任务的 read/write_files 声明，
// 分两级返回：write∩write（写写绝对冲突，强判）与 read∩write（共享读写嫌疑，弱判——仅对彼此
// 无显式 depends_on 关联的并行对探测，有显式关联=依赖已声明，跳过→合法拓扑零新增告警）。
// 路径解析按声明实际内容（换行切分 → 分号二次切分 → trim → 滤空与 HTML 注释），不做扩展名
// 白名单过滤——txt/log/无扩展名路径同等检出（链式重命名的 .txt 事故面闭合；与既有自动解析
// 同源实现）。开标签属性解析与 workflow-state 路由共享 taskOpeningAttrs（属性序无关；不读块内文本）。
// 2026-09-28 PR 审查采纳：由 workflow-guard.mjs 抽到本模块——plan 出口与 replan 重校消费同一实现，
// 两侧各自决定强判（BLOCK）/弱判（WARN），判定本身只此一处（L-067 单一判据）。
async function findParallelWriteConflicts(changeDir) {
  const taskFile = path.join(changeDir, 'TASK.md');
  let text;
  try { text = await fs.readFile(taskFile, 'utf8'); } catch { return { writeConflicts: [], readWarnings: [] }; }
  const allBlocks = taskBlocks(text);
  // 依赖资格收窄：仅统计「本趟可运行」的并行任务——deps ⊆ doneIds；
  // 等待后续趟次的并行任务（依赖未满足）与已交付任务不参与同趟冲突判定，
  // 使 A→B 同写路径的跨趟合法计划不再被首趟误拦（与路由谓词同一口径）。
  const doneIds = new Set(allBlocks
    .map((b) => taskOpeningAttrs(b))
    .filter((a) => a && a.id && a.status === 'done')
    .map((a) => a.id));
  const dependsOnOf = (b) => {
    const m = b.match(/<depends_on>([\s\S]*?)<\/depends_on>/);
    return m ? m[1].trim().split(/[,\s]+/).filter(Boolean) : [];
  };
  const blocks = allBlocks.filter((b) => {
    const a = taskOpeningAttrs(b);
    if (!a || !a.parallel || a.status !== 'pending') return false;
    return dependsOnOf(b).every((d) => doneIds.has(d));
  });
  // 路径解析与既有自动解析同源：剥 HTML 注释 → 换行切分 → 分号二次切分 → trim → 滤空
  // 路径归一化（CodeRabbit 采纳）：分隔符统一 '/'、解 '.' 段（`./` / `a/./b`）、`..` 逃出项目根
  // 按越界处理（返回 null 不参与重叠比较）——`src/a.mjs` vs `src/./a.mjs` / `src\a.mjs` 变体不再
  // 绕过写写强判与读写弱判；与委托入口共用同一函数（两侧同语义）。
  const normalizeTaskPath = (raw) => {
    const p = String(raw).trim();
    if (p === '') return null;
    const segments = p.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
    const out = [];
    for (const seg of segments) {
      if (seg === '..') {
        if (out.length === 0) return null; // 逃出项目根 → 越界（不参与比较）
        out.pop();
      } else {
        out.push(seg);
      }
    }
    return out.join('/');
  };
  const parsePaths = (matchText) => String(matchText ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim().split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean)
    .flatMap((l) => l.split(';')).map((l) => l.trim()).filter(Boolean)
    .map(normalizeTaskPath)
    .filter((p) => p !== null && p !== '');
  const perTask = [];
  for (const b of blocks) {
    const a = taskOpeningAttrs(b);
    if (!a || !a.id) continue;
    const wf = b.match(/<write_files>([\s\S]*?)<\/write_files>/);
    const rf = b.match(/<read_files>([\s\S]*?)<\/read_files>/);
    if (!wf && !rf) continue;
    perTask.push({
      id: a.id,
      deps: new Set(dependsOnOf(b)),
      writes: new Set(parsePaths(wf && wf[1])),
      reads: new Set(parsePaths(rf && rf[1])),
    });
  }
  const writeConflicts = [];
  const readWarnings = [];
  for (let i = 0; i < perTask.length; i++) {
    for (let j = i + 1; j < perTask.length; j++) {
      const overlap = [...perTask[i].writes].filter((f) => perTask[j].writes.has(f));
      if (overlap.length) writeConflicts.push({ a: perTask[i].id, b: perTask[j].id, files: overlap });
      // 读写弱判触发面：仅无显式 depends_on 关联的并行对（有显式关联=依赖已声明，跳过）
      const associated = perTask[i].deps.has(perTask[j].id) || perTask[j].deps.has(perTask[i].id);
      if (associated) continue;
      const readOverlap = [...perTask[i].reads].filter((f) => perTask[j].writes.has(f));
      if (readOverlap.length) readWarnings.push({ a: perTask[i].id, b: perTask[j].id, files: readOverlap });
      const readOverlap2 = [...perTask[j].reads].filter((f) => perTask[i].writes.has(f));
      if (readOverlap2.length) readWarnings.push({ a: perTask[j].id, b: perTask[i].id, files: readOverlap2 });
    }
  }
  return { writeConflicts, readWarnings };
}

// ---------- Fix 批次共享判定（单一权威 · 纯函数） ----------
// workflow-guard 与 workflow-state 的 Fix 两态一律复用本段实现，禁止任一侧内联第二份
// （L-058 路由单一权威 / L-067 同判据两份实现必然分叉）。判定本身只读 TASK.md 与协议/产物
// 推导，无副作用、无 console 输出、无 process.exit；唯一允许写 state 的是受控归位轮次计数
// helper——它只被两个归位入口在目标命中后调用，轮次字段的读写经 state-schema 单一来源。
// execute 家族节点：协议 route 顺序中由任务状态特判的节点（与 resolveNextNode 同一划分）。
const EXECUTE_FAMILY_NODE_IDS = new Set(['execute', 'subagent-execute']);

// execute 家族之后第一个未完成节点：按协议 route 顺序跳过全部 execute 家族节点，返回其后
// 首个不在 completedNodes 中的节点 id；协议无 execute 家族或后置节点全部完成 → null。
// 这里只做通用推导（内置协议 = review → verify → archive）；是否可作为 Fix 回程源由调用方
// （resolveFixReturnNode / exit apply）再用 review / verify 收窄（只覆盖内置源节点）。
function firstIncompletePostExecNode({ protocol, completedNodes = [] }) {
  let sawExecuteFamily = false;
  for (const node of route(protocol)) {
    if (EXECUTE_FAMILY_NODE_IDS.has(node.id)) {
      sawExecuteFamily = true;
      continue;
    }
    if (sawExecuteFamily && !completedNodes.includes(node.id)) return node.id;
  }
  return null;
}

// 协议任务文件内容读取（taskFile 语义唯一来源）：不存在 / 不可读 → null；调用方各自按
// fail-closed 语义处理（回退判定 → false，回程推导 → null），不把访问类故障当成空任务集。
async function readProtocolTaskContent(protocol, changeName, specsRoot) {
  try {
    return await fs.readFile(protocolTaskFilePath(protocol, changeName, specsRoot), 'utf8');
  } catch {
    return null;
  }
}

// TASK.md 任务集签名（唯一实现：guard 的入口记录 / 出口比对与 Fix 回退判定共用）——提取全部
// <task> 块，剥离开标签上的标记类属性（仅保留 id/parallel），排序防顺序漂移，拼接后 sha256。
// 行尾规范化——Windows 下 bash heredoc 写 LF、python 写 CRLF（os.linesep），跨工具编辑
// 导致"任务集逻辑未变但字节变"的误报 BLOCK；签名前统一 CRLF → LF（仅归一化行尾，不改变内容语义）。
// 标记类属性白名单——子代理标记 task done 会在开标签追加 completed_at/started_at/finished_at/
// assigned_to/updated_at 等属性（纯状态标记），仅剥离 status 仍误报 BLOCK；改为开标签只保留
// 影响路由语义的 id/parallel，其余属性一律剥离（含未来新增标记属性，无需再改）；
// 任务内容（name/action/write_files/verify/depends_on）保持签名敏感。
//
// 算法版本元数据：值格式 <算法版本>:<digest>（如 v1:<sha256 hex>）。签名算法实现变更时必须同步
// 提升版本常量——冻结锚据此判别；新 state 的 taskHash 与 exit-applied 事件的 taskSetSignature
// 都写版本前缀，事件另带 signatureAlgo 字段；legacy 裸 hex 一律按 v1 解析；消费点只做同版本比较，
// 版本不同视为不可比（不判发散、不误归位、不误拦任务集）。
export const TASK_SET_SIGNATURE_ALGO = 'v1';
const TASK_SET_SIGNATURE_PREFIX = /^(v\d+):([0-9a-f]{64})$/u;
const TASK_SET_SIGNATURE_BARE_HEX = /^[0-9a-f]{64}$/u;
const LEGACY_TASK_SET_SIGNATURE_ALGO = 'v1';

// 内容 digest（保持既有归一化与属性剥离语义逐字不变）
function digestTaskSetContent(taskContent) {
  const normalized = String(taskContent).replace(/\r\n/g, '\n');
  const blocks = (normalized.match(/<task[\s\S]*?<\/task>/g) || [])
    .map((block) =>
      block.replace(/<task[^>]*>/, (open) =>
        open.replace(/\s+[a-zA-Z_][\w-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'))?/g, (attr) =>
          /^\s*(?:id|parallel)(?=[\s=>])/.test(attr) ? attr : ''
        )
      )
    )
    .sort();
  return createHash('sha256').update(blocks.join('\n'), 'utf8').digest('hex');
}

// 计算签名：返回 <算法版本>:<digest>；algo 缺省为当前版本（供跨版本夹具显式传入旧版本）。
export function taskSetSignature(taskContent, algo = TASK_SET_SIGNATURE_ALGO) {
  const version = String(algo ?? '').trim() || TASK_SET_SIGNATURE_ALGO;
  return version + ':' + digestTaskSetContent(taskContent);
}

// 解析签名值：新格式 <vN>:<64 hex>；legacy 裸 64 hex 按 v1；空值 / 非字符串 / 其它形态 → null。
export function parseTaskSetSignature(value) {
  if (typeof value !== 'string' || value === '') return null;
  const prefixed = TASK_SET_SIGNATURE_PREFIX.exec(value);
  if (prefixed) return { algo: prefixed[1], digest: prefixed[2] };
  if (TASK_SET_SIGNATURE_BARE_HEX.test(value)) {
    return { algo: LEGACY_TASK_SET_SIGNATURE_ALGO, digest: value };
  }
  return null;
}

// 同版本且同 digest = 一致；任一不可解析 / 版本不同 = false（调用方必须按不可比语义处理）。
export function sameTaskSetSignature(left, right) {
  const a = parseTaskSetSignature(left);
  const b = parseTaskSetSignature(right);
  if (a === null || b === null) return false;
  return a.algo === b.algo && a.digest === b.digest;
}

// 两侧均可解析但算法版本不同 → true（需要「跳过比对」而非「判为发散」的消费点使用）。
export function taskSetSignatureVersionSkew(left, right) {
  const a = parseTaskSetSignature(left);
  const b = parseTaskSetSignature(right);
  return a !== null && b !== null && a.algo !== b.algo;
}

// history 事件 change 归属（单一权威 · L-067）：state.history 跨 change 保留（select 只切
// activeChange），带 change 字段的事件只在 change 名一致时参与；无 change 字段的旧 state 事件
// 保持兼容（legacy 参与）。execute 家族出口签名读取 / Fix 回因分类 / 受控重入轮次三处一律调用
// 本函数，禁止再内联同一过滤判据（注释互指同源不是同步机制）。
function historyEventBelongsToChange(event, changeName) {
  return typeof event?.change !== 'string' || event.change === changeName;
}

// 「未闭合 execute 生命周期」信号派生：取 history 中最后一次 exit-applied execute 家族事件
// 记录的 { signature, algo, node }；无家族出口事件 / 该事件无签名字段（旧 state）→ null（调用方按
// 旧 change 渐进放行）。只认最新一次家族出口——更早的签名被后续闭合覆盖。
// change 归属：state.history 跨 change 保留（select 只切 activeChange），因此带 change 的事件
// 只在 change 名一致时参与判定；无 change 字段的旧 state 事件保持兼容（legacy 可参与）。
// 算法版本：事件可带 signatureAlgo（新写形态），缺省按签名值解析出的版本（legacy 裸 hex = v1）；
// 声明版本与值版本不一致的畸形事件 → null（fail-closed，不参与闭合判定）。
function latestExecuteExitEvent(history, changeName) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const event = history[i];
    if (!event || event.event !== 'exit-applied' || !EXECUTE_FAMILY_NODE_IDS.has(event.node)) continue;
    if (!historyEventBelongsToChange(event, changeName)) continue;
    if (typeof event.taskSetSignature !== 'string' || event.taskSetSignature === '') return null;
    const parsed = parseTaskSetSignature(event.taskSetSignature);
    if (parsed === null) return null;
    if (typeof event.signatureAlgo === 'string' && event.signatureAlgo !== '' && event.signatureAlgo !== parsed.algo) return null;
    return { signature: event.taskSetSignature, algo: parsed.algo, digest: parsed.digest, node: event.node };
  }
  return null;
}

// ---------- Fix 回因分类（共享纯函数 · 单一权威 · 展示层派生） ----------
// guard exit 回程分支在写本次 exit-applied 事件之前调用本分类器：只用既有字段派生证据（history
// 的 execute 家族出口签名 + TASK 内容结构标记），零新增 state 字段 / 事件类型。判据（DESIGN 决策 1）：
//   divergence = 历史任一 execute 家族 exit-applied 事件记录的 taskSetSignature ≠ 当前任务集签名；
//   marker     = 模板派生的 Fix 段内含 <task> 块，或全文任一任务 id 匹配 /^[TP]-FIX-/i；
//   divergence ∨ marker → 'fix'；有签名且不发散 → 'normal'；无签名且无标记 → 'unknown'
//   （旧 state 证据不足：中性输出、不 BLOCK，由调用方渲染）。
// Fix 段标题由调用方传入（guard 从 flow-kit/templates/TASK.md 的 H2 派生）；缺失 / 空串
// 回退内置常量（FIX_SECTION_TITLE_FALLBACK）。history 过滤与 latestExecuteExitEvent 同语义
// （change 归属：有 change 字段且不匹配则跳过，无 change 的 legacy 事件参与）；签名事件全量参与、
// 不做「只看最新」短路——多波次场景最新签名已被闭合写成当前签名，只看最新会漏判 fix。
const FIX_SECTION_TITLE_FALLBACK = 'Fix 任务';

// 共享 heading 归一（单一权威）：去 ATX 标记 / 闭合 ATX 标记 / 尾部括号内容 / 编号前缀后比较，
// 让 Fix 任务、Fix 任务（来自 REVIEW / INTEGRATION）、## Fix 任务 ## 等合法写法命中同一段；
// Fix 段标题匹配与 guard 的模板段名归一均委托本实现，禁止另起第二份。
function normalizeHeading(raw) {
  return String(raw ?? '')
    .replace(/\r/g, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/[（(][^）)\n]*[）)]\s*$/u, '')
    .replace(/^\d+(?:\.\d+)?\.?\s*/u, '')
    .trim()
    .toLowerCase();
}

// Fix 段正文切片：首个同级（##）标题命中 → 返回标题行之后、下一个同级标题（或 EOF）之前的正文；
// 无命中标题 → null。只认二级标题（### 不闭合本段）；CRLF / LF 归一后按行定位。
function fixSectionBody(taskContent, fixSectionTitle) {
  const lines = String(taskContent ?? '').replace(/\r\n?/g, '\n').split('\n');
  const wanted = normalizeHeading(fixSectionTitle);
  if (wanted === '') return null;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (!m) continue;
    const heading = normalizeHeading(m[1]);
    if (heading === wanted || heading.startsWith(wanted)) { start = i; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n');
}

// Fix 任务结构标记：全文任一任务 id 匹配 /^[TP]-FIX-/i（覆盖文件尾追加等非规范落点）→ true；
// 否则 Fix 段内出现 <task> 块（标题与任务需同段，段内无任务不误报）→ true；两者皆无 → false。
// 解析复用 taskBlocks / taskOpeningAttrs（与路由、guard 校验共享同一 <task> 解析语义）。
function fixTaskMarker(taskContent, fixSectionTitle) {
  const content = String(taskContent ?? '');
  const title = (typeof fixSectionTitle === 'string' && fixSectionTitle.trim() !== '')
    ? fixSectionTitle
    : FIX_SECTION_TITLE_FALLBACK;
  const hasFixTaskId = taskBlocks(content).some((block) => {
    const attrs = taskOpeningAttrs(block);
    return Boolean(attrs && typeof attrs.id === 'string' && /^[TP]-FIX-/i.test(attrs.id));
  });
  if (hasFixTaskId) return true;
  const section = fixSectionBody(content, title);
  return section !== null && taskBlocks(section).length > 0;
}

// 回因分类唯一入口。签名：classifyFixReturnCause({ history, changeName, taskContent, fixSectionTitle })
// → 'fix' | 'normal' | 'unknown'。纯函数：无 fs/console/process.exit，不改既有路由判定语义。
// 算法版本：只让与当前任务集签名同版本的历史事件参与「signatureKnown / divergence」判定；跨版本
// 事件跳过（不可比），避免引擎升级后把正常多趟误判成 Fix。
function classifyFixReturnCause({ history, changeName, taskContent, fixSectionTitle } = {}) {
  const current = parseTaskSetSignature(taskSetSignature(taskContent));
  let signatureKnown = false;
  let divergence = false;
  if (Array.isArray(history)) {
    for (const event of history) {
      if (!event || event.event !== 'exit-applied' || !EXECUTE_FAMILY_NODE_IDS.has(event.node)) continue;
      if (!historyEventBelongsToChange(event, changeName)) continue;
      if (typeof event.taskSetSignature !== 'string' || event.taskSetSignature === '') continue;
      const recorded = parseTaskSetSignature(event.taskSetSignature);
      if (recorded === null) continue;
      if (typeof event.signatureAlgo === 'string' && event.signatureAlgo !== '' && event.signatureAlgo !== recorded.algo) continue;
      if (current === null || recorded.algo !== current.algo) continue;
      signatureKnown = true;
      if (recorded.digest !== current.digest) divergence = true;
    }
  }
  if (divergence || fixTaskMarker(taskContent, fixSectionTitle)) return 'fix';
  return signatureKnown ? 'normal' : 'unknown';
}

// Fix 回退态决策（单一权威——guard 入口/出口与 state 的 next 分支一律复用本段）：currentNode
// ∈ {review, verify} ∧ TASK.md 可解析出任务块 ∧ 以下任一：
//   ① 存在 status="pending" 任务 ∧ resolveNextNode(completedNodes) ∈ execute 家族
//      （串行 pending → execute；可委托 parallel pending → subagent-execute）
//      → 返回 { target: 目标节点, kind: 'pending' }（受控归位的计数分支）；
//   ② 全任务 done ∧ execute 家族至少一个节点已在 completedNodes ∧ history 最新家族出口事件记录的
//      任务集签名与当前 TASK.md 签名不一致 → 返回 { target: 记录节点, kind: 'unclosed' }
//      （done-but-unclosed：追加/修改修复任务后从未重跑家族出口；lazy entry 只刷新 taskHash、
//      不写 exit 事件，签名保持不一致）。
// 旧 state 无签名记录 / 签名不可解析 / 算法版本不同 → ② 不成立（旧 change 渐进放行，跨版本不比对）。
// TASK.md 缺失 / 不可读 / 零任务块 / 当前节点非 review|verify → null（fail-closed）。
// 路由复用唯一权威 resolveNextNode，不复制判定。
async function resolveFixRollbackDecision({ runRoot, changeName, protocol, completedNodes = [], currentNode, history = [] }) {
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
async function resolveFixRollbackState(args) {
  const decision = await resolveFixRollbackDecision(args);
  return decision === null ? null : decision.target;
}

// ---------- Fix 受控归位轮次（单一权威 · 唯一写点） ----------
// 仅两个受控归位入口在目标命中后调用本 helper，且只对决策 kind='pending'（分支①）计数；
// 分支② done-but-unclosed、回因分类、verify 命令失败都不经此，也不得在调用方另行累加。
// 阈值语义：从第 4 轮起，新 change 返回 blocked（调用方必须先于任何 state 写盘退出，不得写入
// currentNode）；旧 change 返回 warn 后照常归位。用户显式授权记录为
// state.evidence[源节点].fixRoundOverride = { round, at, source }，覆盖到该轮即放行（不新增第二个顶层字段）。
// 完整授权形态：round 为正整数、at/source 均为非空字符串；任一缺失/类型非法/空串（含纯空白）
// 一律视为未授权 fail-closed——第 4 轮继续 BLOCK，调用方不写 currentNode、state 字节零改写。
// 审计行后缀由本 helper 统一给出，两个入口禁止各自拼装。

function readFixRoundOverride(state, sourceNode) {
  if (typeof sourceNode !== 'string' || sourceNode === '') return null;
  const sourceEvidence = state && state.evidence && typeof state.evidence === 'object' && !Array.isArray(state.evidence)
    ? state.evidence[sourceNode]
    : null;
  const override = sourceEvidence && typeof sourceEvidence === 'object' && !Array.isArray(sourceEvidence)
    ? sourceEvidence.fixRoundOverride
    : null;
  if (!override || typeof override !== 'object' || Array.isArray(override)) return null;
  if (typeof override.round !== 'number' || !Number.isInteger(override.round) || override.round <= 0) return null;
  if (typeof override.at !== 'string' || override.at.trim() === '') return null;
  if (typeof override.source !== 'string' || override.source.trim() === '') return null;
  return { round: override.round };
}

const FIX_ROLLBACK_ROUND_LIMIT = 3;

const EMPTY_FIX_ROLLBACK_ROUND = Object.freeze({
  counted: false,
  blocked: false,
  warn: false,
  round: null,
  overrideUsed: false,
  auditSuffix: '',
  blockedMessage: null,
  warnMessage: null,
});

function fixRoundAuditSuffix(round) {
  return '（第 ' + round + '/' + FIX_ROLLBACK_ROUND_LIMIT + ' 轮）';
}

function fixRoundBlockedMessage(sourceNode, round) {
  return [
    'BLOCKED: Fix 批次受控归位已达 ' + FIX_ROLLBACK_ROUND_LIMIT + ' 轮上限，第 ' + round + ' 轮需用户决策（继续修/停止）——源节点 ' + sourceNode + '。',
    '恢复: 继续修 → 由用户显式授权后在 state.evidence.' + sourceNode + '.fixRoundOverride 记录 {"round":' + round + ',"at":"<时间>","source":"<授权来源>"} 再重试；停止 → 结束 Fix 批次并按流程处理（禁止手改 state 机器字段）。',
  ].join('\n');
}

function applyFixRollbackRound({ state, sourceNode, decision }) {
  if (!state || !decision) return EMPTY_FIX_ROLLBACK_ROUND;
  if (decision.kind !== 'pending') return EMPTY_FIX_ROLLBACK_ROUND;
  const round = fixRoundsFor(state) + 1;
  const auditSuffix = fixRoundAuditSuffix(round);
  if (round <= FIX_ROLLBACK_ROUND_LIMIT) {
    setFixRoundsFor(state, round);
    return { ...EMPTY_FIX_ROLLBACK_ROUND, counted: true, round, auditSuffix };
  }
  const override = readFixRoundOverride(state, sourceNode);
  if (override !== null && override.round >= round) {
    setFixRoundsFor(state, round);
    return { ...EMPTY_FIX_ROLLBACK_ROUND, counted: true, round, overrideUsed: true, auditSuffix };
  }
  if (state.newChange === true) {
    return { ...EMPTY_FIX_ROLLBACK_ROUND, blocked: true, round, auditSuffix, blockedMessage: fixRoundBlockedMessage(sourceNode, round) };
  }
  setFixRoundsFor(state, round);
  return {
    ...EMPTY_FIX_ROLLBACK_ROUND,
    counted: true,
    warn: true,
    round,
    auditSuffix,
    warnMessage: 'FIX-BATCH WARN: Fix 批次受控归位已达 ' + FIX_ROLLBACK_ROUND_LIMIT + ' 轮上限，第 ' + round + ' 轮在旧 change 上渐进放行（建议用户显式授权并在 evidence 记录 fixRoundOverride）。',
  };
}

// Fix 回程节点推导（共享基础）：TASK.md 存在、至少一个任务块且全部 status="done" 时，
// 取 firstIncompletePostExecNode；仅当其 ∈ {review, verify}（内置回程源）才返回，否则 null。
// 仍有 pending / 零任务块 / TASK.md 缺失 → null（fail-closed）。「execute 本次 exit 前已在
// completedNodes」的二次完成条件由 exit apply 推进点判定，本函数只做 TASK + 路由推导。
async function resolveFixReturnNode({ runRoot, changeName, protocol, completedNodes = [] }) {
  const taskContent = await readProtocolTaskContent(protocol, changeName, path.join(runRoot, '.specs'));
  if (taskContent === null) return null;
  const attrsList = taskBlocks(taskContent).map(taskOpeningAttrs).filter(Boolean);
  if (attrsList.length === 0) return null;
  if (!attrsList.every((attrs) => attrs.status === 'done')) return null;
  const node = firstIncompletePostExecNode({ protocol, completedNodes });
  return node === 'review' || node === 'verify' ? node : null;
}

// ---------- archive 源受控重入判定（单一权威 · 纯函数：目标白名单 / 前驱转移语义 / 授权形态 / 轮次上限 / 审计事件 / 空操作） ----------
// archive 已 entry 且归档移动尚未发生时，用户显式授权把工作归属退到 execute 家族 / review /
// verify 的受控回边。本段只做确定性推导（无 fs / console / process.exit / state 写入）：全部
// 判定集中在这里，reenter 子命令只做编排与落盘，禁止内联第二份（L-058 路由单一权威 /
// L-067 同判据两份实现必然分叉）。信号统一用 structured result：非法 / 未授权返回
// { ok: false, reason: '<machine-code>' }，不抛异常。

// 受控重入目标白名单：显式目标必须 ∈ 本集合 ∩ 协议 enabled 节点。
const REENTRY_TARGET_NODE_IDS = new Set(['execute', 'subagent-execute', 'review', 'verify']);

// 每 change 轮次上限：3 轮；调用方禁止内联阈值，必须引用本常量。
const REENTRY_ROUND_LIMIT = 3;

// change 名形态（单一权威 · 受控重入判定与 select 入口共用）：change-id 必须是 .specs/ 下的
// 单段目录名——拒绝空串、路径分隔符与「.」「..」，并保留目录名 archive（归档区）不得作为
// change 名。本判据只做字符串形态判定（纯函数）；「realpath 归一后仍是 .specs 真实直接子目录」
// 的物理包含性由调用方的路径段扫描（protocol-utils 单一权威）负责。
function isSingleSegmentChangeName(value) {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  if (name === '' || name === '.' || name === '..') return false;
  // 原始值必须与 trim 后逐字相等：Windows 与部分文件系统忽略首尾空白/尾点，放行「空白变体」
  // 会让 path.join 指到真实目录、而 activeChange 存的是变体字符串——轮次事件按 activeChange
  // 精确匹配（配额被换键重置），事件归属随即失真。
  if (value !== name) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  // 保留目录名按大小写归一判定：Windows 与默认 macOS 的路径解析不区分大小写，「ARCHIVE」
  // 「Archive」同样指向归档区，逐字比较会漏判。
  if (name.toLowerCase() === 'archive') return false;
  return true;
}

// 源判定（① · AC-5）：currentNode === 'archive' 且 activeChange 是合法的单段 change 名。
// 源不是 archive / 没有活跃 change / change 名形态非法 → 未授权来源，返回 machine-code，不抛异常。
function reentrySourceDecision({ currentNode, activeChange } = {}) {
  if (typeof activeChange !== 'string' || activeChange.trim() === '') {
    return { ok: false, reason: 'no-active-change' };
  }
  if (!isSingleSegmentChangeName(activeChange)) {
    return { ok: false, reason: 'change-name-invalid' };
  }
  if (currentNode !== 'archive') {
    return { ok: false, reason: 'source-not-archive' };
  }
  return { ok: true, reason: 'archive-source' };
}

// 目标判定（② · AC-5）：target ∈ 白名单 ∩ 协议 enabled 节点。enabled 判定复用
// protocolNodeEnabled（协议 enabled 语义唯一来源），本函数不写第二份解析；协议缺失 /
// 非对象按 fail-closed 返回未启用（L-079：解析失败不得静默放行）。
function resolveReentryTarget({ protocol, target } = {}) {
  if (typeof target !== 'string' || !REENTRY_TARGET_NODE_IDS.has(target)) {
    return { ok: false, reason: 'target-not-allowed' };
  }
  if (!protocol || typeof protocol !== 'object' || !protocolNodeEnabled(protocol, target)) {
    return { ok: false, reason: 'target-not-enabled' };
  }
  return { ok: true, reason: 'target-allowed', target };
}

// 授权形态 fail-closed 解析（③ · AC-2）：round 为正整数、at / source 均为非空（去空白）
// 字符串、authorization.target 与本次调用 target 一致；任一项非法 → 未授权，不抛异常。
// 形态与既有 Fix 轮次授权（workflow-guard readFixRoundOverride）同源，禁止第二份校验。
function parseReentryAuthorization({ authorization, target } = {}) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    return { ok: false, reason: 'authorization-missing' };
  }
  if (typeof authorization.round !== 'number' || !Number.isInteger(authorization.round) || authorization.round <= 0) {
    return { ok: false, reason: 'round-invalid' };
  }
  if (typeof authorization.at !== 'string' || authorization.at.trim() === '') {
    return { ok: false, reason: 'at-invalid' };
  }
  if (typeof authorization.source !== 'string' || authorization.source.trim() === '') {
    return { ok: false, reason: 'source-invalid' };
  }
  if (typeof target !== 'string' || target === '' || authorization.target !== target) {
    return { ok: false, reason: 'target-mismatch' };
  }
  return {
    ok: true,
    reason: 'authorized',
    authorization: {
      round: authorization.round,
      at: authorization.at.trim(),
      source: authorization.source.trim(),
      target,
    },
  };
}

// 上限后的续轮授权形态（AC-7 后半句）：达到上限后，用户可显式授权把轮次推进到下一轮。
// 授权三元组形态复用 parseReentryAuthorization（单一权威——不复制第二份字段校验）；本函数只
// 追加续轮特有约束：round 必须覆盖即将执行的轮次（已用轮次 + 1，与既有 Fix 轮次授权的
// 「覆盖即将执行轮次」语义同型），否则视为未授权 fail-closed。未达上限时调用方不得传续轮授权
// （续轮只在人工裁决点需要）。本函数只做形态判定，不读 history。
function parseReentryContinuationAuthorization({ authorization, target, used } = {}) {
  const parsed = parseReentryAuthorization({ authorization, target });
  if (!parsed.ok) return parsed;
  if (typeof used !== 'number' || !Number.isInteger(used) || used < 0
    || parsed.authorization.round < used + 1) {
    return { ok: false, reason: 'round-below-required' };
  }
  return { ok: true, reason: 'continuation-authorized', authorization: parsed.authorization };
}

// 轮次派生（④ · AC-7）：统计 state.history 中本 change 的 reentry-applied 事件数，
// change 归属过滤调用 historyEventBelongsToChange（单一权威——不在此内联第二份，L-067）。
// 跨 change 隔离依赖事件的 change 字段：写入方（reenter 子命令）必须带 change；无 change 的
// 旧事件按 legacy 形态参与（reentry-applied 为新事件类型，实际不会出现）。history 缺失 /
// 非数组 = 无事件（旧 state 形态，0 轮）。轮次只按事件条数派生，不读事件里的 round 字段。
function reentryRoundCount({ history, changeName } = {}) {
  if (!Array.isArray(history)) return 0;
  let count = 0;
  for (const event of history) {
    if (!event || event.event !== 'reentry-applied') continue;
    if (!historyEventBelongsToChange(event, changeName)) continue;
    count += 1;
  }
  return count;
}

// 上限判定（⑤ · AC-7）：已用轮次 < REENTRY_ROUND_LIMIT 或持有合法续轮授权 → 放行并给出本轮
// 序号（nextRound = 已用 + 1，供审计事件与 REENTRY 行使用）；否则 blocked（调用方必须先于
// 任何 state 写盘返回，保证字节零改写）。阈值只从 REENTRY_ROUND_LIMIT 取。
function reentryRoundDecision({ history, changeName, continuationAuthorized = false } = {}) {
  const used = reentryRoundCount({ history, changeName });
  if (used < REENTRY_ROUND_LIMIT) {
    return { ok: true, reason: 'round-available', used, nextRound: used + 1, limit: REENTRY_ROUND_LIMIT };
  }
  if (continuationAuthorized === true) {
    return { ok: true, reason: 'round-available-continuation', used, nextRound: used + 1, limit: REENTRY_ROUND_LIMIT };
  }
  return { ok: false, reason: 'round-limit-reached', used, limit: REENTRY_ROUND_LIMIT };
}

// 协议前驱推导（⑦ 的输入）：沿协议 success 边反向可达的全部祖先节点（传递闭包——对应
// 前驱语义「清掉目标及其后继」），按协议 route 顺序（disabled 过滤）排序；failure / pause 自环、
// target 自身与协议外节点不参与。顺序唯一来源是 route(protocol)，不另写节点排序。
function reentryPredecessors(protocol, target) {
  if (!protocol || typeof protocol !== 'object') return [];
  const order = route(protocol).map((node) => node.id);
  const ancestors = new Set();
  const queue = [target];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of protocol.edges ?? []) {
      if (!edge || edge.condition !== 'success' || edge.to !== current) continue;
      if (typeof edge.from !== 'string' || edge.from === '' || edge.from === target || ancestors.has(edge.from)) continue;
      ancestors.add(edge.from);
      queue.push(edge.from);
    }
  }
  return order.filter((id) => ancestors.has(id));
}

// 前驱交集（⑦ · AC-8）：completedNodes ∩ predecessors(target)，按协议节点顺序保留原顺序。
// completedNodes 中的协议外 / 重复项自然被过滤与去重；target 未知 / 未启用 → 空交集（fail-closed）。
function reentryPredecessorIntersection({ protocol, target, completedNodes = [] } = {}) {
  const completed = Array.isArray(completedNodes) ? completedNodes : [];
  return reentryPredecessors(protocol, target).filter((id) => completed.includes(id));
}

// 空操作判定（⑥ · 幂等锚）：currentNode === target 且 completedNodes 已等于前驱交集结果
// （同序逐项相等）→ noop（调用方不备份 / 不计数 / 不写事件）；否则返回待落地的交集，调用方按
// 前驱语义覆盖 completedNodes。判定本身不改写输入。
function reentryNoOpDecision({ currentNode, target, protocol, completedNodes = [] } = {}) {
  const completed = Array.isArray(completedNodes) ? completedNodes : [];
  const intersection = reentryPredecessorIntersection({ protocol, target, completedNodes: completed });
  const same = currentNode === target
    && completed.length === intersection.length
    && intersection.every((id, index) => completed[index] === id);
  return same
    ? { noop: true, reason: 'noop-target-satisfied', completedNodes: intersection }
    : { noop: false, reason: 'target-state-not-satisfied', completedNodes: intersection };
}

// 受控重入综合判定（单一权威聚合判定 · 供 reenter 子命令单点调用），返回三态 action：
//   'block'（ok:false，调用方零写盘返回）、
//   'noop' （目标形态已成立，调用方零写盘提示）、
//   'apply'（ok:true，携带 changeName / target / 待落地 completedNodes / 本轮 round / 归一授权）。
// 判定顺序：目标合法性（越界即使处于重复态也 BLOCK · AC-5）→ change 名形态 → 上限 →
// 幂等短路 → 源 → 授权。
// 幂等短路必须先于源判定：目标形态已成立时 currentNode === target ≠ 'archive'，先判源会让
// 空操作判定永远不可达；但幂等短路不得越过上限判定——达到上限的 change 即使处于同目标形态也
// 必须走人工裁决路径（不得以空操作退出 0），也不得越过 change 名形态判定（畸形 change 名
// 一律 BLOCK，不因形态巧合而短路）。短路分支零写盘。调用方不得内联重排或复制其中任何一条判据。
function resolveReentryDecision({ protocol, state, target, authorization, continuationRound } = {}) {
  const targetDecision = resolveReentryTarget({ protocol, target });
  if (!targetDecision.ok) return { ok: false, action: 'block', reason: targetDecision.reason };
  const activeChange = state?.activeChange;
  if (typeof activeChange !== 'string' || activeChange.trim() === '') {
    return { ok: false, action: 'block', reason: 'no-active-change' };
  }
  if (!isSingleSegmentChangeName(activeChange)) {
    return { ok: false, action: 'block', reason: 'change-name-invalid' };
  }
  const used = reentryRoundCount({ history: state?.history, changeName: activeChange });
  const atLimit = used >= REENTRY_ROUND_LIMIT;
  let continuationAuthorized = false;
  if (atLimit) {
    const continuation = parseReentryContinuationAuthorization({
      authorization: continuationRound === undefined || continuationRound === null
        ? null
        : {
          ...(authorization && typeof authorization === 'object' && !Array.isArray(authorization) ? authorization : {}),
          round: continuationRound,
        },
      target,
      used,
    });
    if (!continuation.ok) {
      return { ok: false, action: 'block', reason: 'round-limit-reached', used, limit: REENTRY_ROUND_LIMIT };
    }
    continuationAuthorized = true;
  } else if (continuationRound !== undefined && continuationRound !== null) {
    return { ok: false, action: 'block', reason: 'continuation-not-required', used, limit: REENTRY_ROUND_LIMIT };
  }
  const noop = reentryNoOpDecision({
    currentNode: state?.currentNode,
    target,
    protocol,
    completedNodes: state?.completedNodes,
  });
  if (noop.noop && !atLimit) {
    return { ok: true, action: 'noop', reason: noop.reason, target, completedNodes: noop.completedNodes };
  }
  const source = reentrySourceDecision({
    currentNode: state?.currentNode,
    activeChange,
  });
  if (!source.ok) return { ok: false, action: 'block', reason: source.reason };
  const parsed = parseReentryAuthorization({ authorization, target });
  if (!parsed.ok) return { ok: false, action: 'block', reason: parsed.reason };
  const round = reentryRoundDecision({ history: state?.history, changeName: activeChange, continuationAuthorized });
  if (!round.ok) {
    return { ok: false, action: 'block', reason: round.reason, used: round.used, limit: round.limit };
  }
  return {
    ok: true,
    action: 'apply',
    reason: 'reentry-authorized',
    changeName: activeChange,
    target,
    completedNodes: noop.completedNodes,
    round: round.nextRound,
    continuationAuthorized,
    authorization: parsed.authorization,
  };
}

// ---------- 受控计划重校重签判定（replan · 与 reentry 族同构 · 纯函数） ----------
// 计划在执行中被证明有缺陷时的受控通道（ADR-013）：仅 execute / subagent-execute 相位可用，
// 停原位重校重签（不跳节点、不改 completedNodes）。本段只做确定性推导（无 fs / console /
// process.exit / state 写入）：相位与 change 名 / 授权形态 / 轮次上限 / 幂等空操作的唯一权威
// 集中在这里，replan 子命令只做编排与落盘，禁止内联第二份（L-058 / L-067）。信号统一用
// structured result：非法 / 未授权返回 { ok:false, action:'block', reason:'<machine-code>' }，
// 不抛异常。

// 可调用相位白名单（ADR-013 决策 2）：execute 家族两个节点；调用方不得内联。
const REPLAN_PHASE_NODE_IDS = new Set(['execute', 'subagent-execute']);

// 每 change 轮次上限（ADR-013 决策 6）：与 reentry 的 REENTRY_ROUND_LIMIT 同值、语义独立；
// 调用方禁止内联阈值，必须引用本常量。
const REPLAN_ROUND_LIMIT = 3;

// 相位 / change 名判定（步骤 1）：currentNode ∈ execute 家族 ∩ 协议 enabled；activeChange 必须
// 是合法单段 change 名（复用 isSingleSegmentChangeName）。协议缺失 / 非对象 / 节点未启用一律
// fail-closed（L-079：解析失败不得静默放行）。
function replanSourceDecision({ protocol, currentNode, activeChange } = {}) {
  if (typeof activeChange !== 'string' || activeChange.trim() === '') {
    return { ok: false, reason: 'no-active-change' };
  }
  if (!isSingleSegmentChangeName(activeChange)) {
    return { ok: false, reason: 'change-name-invalid' };
  }
  if (!REPLAN_PHASE_NODE_IDS.has(currentNode)
    || !protocol || typeof protocol !== 'object'
    || !protocolNodeEnabled(protocol, currentNode)) {
    return { ok: false, reason: 'phase-not-allowed' };
  }
  return { ok: true, reason: 'replan-phase' };
}

// 授权形态 fail-closed 解析（步骤 2 · ADR-013 决策 5）：round 为正整数，at / source / reason
// 均为非空（去空白）字符串，authorization.node 与调用相位一致；任一项非法 → 未授权，不抛异常。
// 形态与 reentry 授权（parseReentryAuthorization）同族，禁止第二份字段校验。
function parseReplanAuthorization({ authorization, node } = {}) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    return { ok: false, reason: 'authorization-missing' };
  }
  if (typeof authorization.round !== 'number' || !Number.isInteger(authorization.round) || authorization.round <= 0) {
    return { ok: false, reason: 'round-invalid' };
  }
  if (typeof authorization.at !== 'string' || authorization.at.trim() === '') {
    return { ok: false, reason: 'at-invalid' };
  }
  if (typeof authorization.source !== 'string' || authorization.source.trim() === '') {
    return { ok: false, reason: 'source-invalid' };
  }
  if (typeof authorization.reason !== 'string' || authorization.reason.trim() === '') {
    return { ok: false, reason: 'reason-invalid' };
  }
  if (typeof node !== 'string' || node === '' || authorization.node !== node) {
    return { ok: false, reason: 'node-mismatch' };
  }
  return {
    ok: true,
    reason: 'authorized',
    authorization: {
      round: authorization.round,
      at: authorization.at.trim(),
      source: authorization.source.trim(),
      reason: authorization.reason.trim(),
      node,
    },
  };
}

// 上限后的续轮授权形态（步骤 3 · ADR-013 决策 6）：授权形态复用 parseReplanAuthorization
// （单一权威——不复制第二份字段校验）；本函数只追加续轮特有约束：round 必须覆盖即将执行的
// 轮次（已用轮次 + 1，与 reentry 续轮同语义），否则视为未授权 fail-closed。未达上限时调用方
// 不得传续轮授权。本函数只做形态判定，不读 history。
function parseReplanContinuationAuthorization({ authorization, node, used } = {}) {
  const parsed = parseReplanAuthorization({ authorization, node });
  if (!parsed.ok) return parsed;
  if (typeof used !== 'number' || !Number.isInteger(used) || used < 0
    || parsed.authorization.round < used + 1) {
    return { ok: false, reason: 'round-below-required' };
  }
  return { ok: true, reason: 'continuation-authorized', authorization: parsed.authorization };
}

// 轮次派生（步骤 3 · ADR-013 决策 6/8）：统计 state.history 中本 change 的 replan-applied
// 事件数；change 归属过滤复用 historyEventBelongsToChange（单一权威，L-067）。跨 change 隔离
// 依赖事件 change 字段；无 change 字段的旧事件按 legacy 形态参与（replan-applied 为新事件
// 类型，实际不会出现）。history 缺失 / 非数组 = 无事件（旧 state 形态，0 轮）。
function replanRoundCount({ history, changeName } = {}) {
  if (!Array.isArray(history)) return 0;
  let count = 0;
  for (const event of history) {
    if (!event || event.event !== 'replan-applied') continue;
    if (!historyEventBelongsToChange(event, changeName)) continue;
    count += 1;
  }
  return count;
}

// 上限判定（步骤 3）：已用轮次 < REPLAN_ROUND_LIMIT 或持有合法续轮授权 → 放行并给出本轮
// 序号（nextRound = 已用 + 1，供审计事件与 REPLAN 行使用）；否则 blocked（调用方必须先于任何
// state 写盘返回，保证字节零改写）。阈值只从 REPLAN_ROUND_LIMIT 取。
function replanRoundDecision({ history, changeName, continuationAuthorized = false } = {}) {
  const used = replanRoundCount({ history, changeName });
  if (used < REPLAN_ROUND_LIMIT) {
    return { ok: true, reason: 'round-available', used, nextRound: used + 1, limit: REPLAN_ROUND_LIMIT };
  }
  if (continuationAuthorized === true) {
    return { ok: true, reason: 'round-available-continuation', used, nextRound: used + 1, limit: REPLAN_ROUND_LIMIT };
  }
  return { ok: false, reason: 'round-limit-reached', used, limit: REPLAN_ROUND_LIMIT };
}

// 空操作判定（步骤 4 · ADR-013 决策 9）：目标形态已成立 = state.taskHash 已与当前 TASK.md
// 签名同签（复用 sameTaskSetSignature / taskSetSignature 既有版本语义——算法版本偏斜按不可比
// 处理，不误拦）→ noop（调用方零备份 / 零轮次 / 零事件 / 零改写）。判定本身不改写输入；
// 返回 taskSetSignature 供调用方重签 / 写审计事件（避免第二份签名计算导致漂移，L-067）。
// 依赖缺失 fail-closed（L-079）：taskContent 缺失 / 非字符串 / 空串 → 不允许判空操作
// （缺 TASK.md 时签名退化为空任务集，放行会掩盖"文件不可读"），由调用方按重校失败 BLOCK。
function replanNoOpDecision({ state, taskContent } = {}) {
  if (typeof taskContent !== 'string' || taskContent === '') {
    return { noop: false, reason: 'task-content-missing', taskSetSignature: null };
  }
  const signature = taskSetSignature(taskContent);
  const same = sameTaskSetSignature(state?.taskHash, signature);
  return same
    ? { noop: true, reason: 'noop-target-satisfied', taskSetSignature: signature }
    : { noop: false, reason: 'target-state-not-satisfied', taskSetSignature: signature };
}

// 受控重校综合判定（单一权威聚合判定 · 供 replan 子命令单点调用），返回三态 action：
//   'block'（ok:false，调用方零写盘返回）、
//   'noop' （目标形态已成立，调用方零写盘提示；仅当调用方传入 taskContent 时参与聚合）、
//   'apply'（ok:true，携带 changeName / node / 本轮 round / 归一授权；taskContent 在场时附带
//            当前任务集签名，供调用方直接重签 / 写事件）。
// 判定顺序（DESIGN 数据流）：相位与 change 名（步骤 1）→ 授权形态（步骤 2）→ 上限与续轮
// （步骤 3）→ 幂等短路（步骤 4）；任何 block 分支都先于 state 写盘，保证字节零改写。
// 注意：幂等短路不得越过上限判定——达到上限的 change 未持显式续轮授权时一律走人工裁决路径
// （与 reentry 族判定顺序同构）。
// taskContent 为可选入参：提供时在授权 / 轮次通过后聚合空操作判定（缺失 / 非字符串 / 空串
// → block，fail-closed，L-079）；未提供时返回 apply/block 两态，由调用方单独调用
// replanNoOpDecision（两处判定同源，调用方不得复制判据）。
function resolveReplanDecision({ protocol, state, authorization, continuationRound, taskContent } = {}) {
  const currentChange = state?.activeChange;
  const node = state?.currentNode;
  const source = replanSourceDecision({ protocol, currentNode: node, activeChange: currentChange });
  if (!source.ok) return { ok: false, action: 'block', reason: source.reason };
  const parsed = parseReplanAuthorization({ authorization, node });
  if (!parsed.ok) return { ok: false, action: 'block', reason: parsed.reason };
  const used = replanRoundCount({ history: state?.history, changeName: currentChange });
  const atLimit = used >= REPLAN_ROUND_LIMIT;
  let continuationAuthorized = false;
  if (atLimit) {
    const continuation = parseReplanContinuationAuthorization({
      authorization: continuationRound === undefined || continuationRound === null
        ? null
        : {
          ...(authorization && typeof authorization === 'object' && !Array.isArray(authorization) ? authorization : {}),
          round: continuationRound,
        },
      node,
      used,
    });
    if (!continuation.ok) {
      return { ok: false, action: 'block', reason: 'round-limit-reached', used, limit: REPLAN_ROUND_LIMIT };
    }
    continuationAuthorized = true;
  } else if (continuationRound !== undefined && continuationRound !== null) {
    return { ok: false, action: 'block', reason: 'continuation-not-required', used, limit: REPLAN_ROUND_LIMIT };
  }
  if (taskContent !== undefined) {
    if (typeof taskContent !== 'string' || taskContent === '') {
      return { ok: false, action: 'block', reason: 'task-content-missing' };
    }
    const noop = replanNoOpDecision({ state, taskContent });
    if (noop.noop) {
      return {
        ok: true,
        action: 'noop',
        reason: noop.reason,
        changeName: currentChange,
        node,
        taskSetSignature: noop.taskSetSignature,
      };
    }
  }
  const round = replanRoundDecision({
    history: state?.history,
    changeName: currentChange,
    continuationAuthorized,
  });
  if (!round.ok) {
    return { ok: false, action: 'block', reason: round.reason, used: round.used, limit: round.limit };
  }
  return {
    ok: true,
    action: 'apply',
    reason: 'replan-authorized',
    changeName: currentChange,
    node,
    round: round.nextRound,
    continuationAuthorized,
    authorization: parsed.authorization,
    ...(taskContent !== undefined ? { taskSetSignature: taskSetSignature(taskContent) } : {}),
  };
}

export {
  route,
  protocolTaskFilePath,
  hasSubagentNode,
  firstIncompletePostExecNode,
  EXECUTE_FAMILY_NODE_IDS,
  FIX_SECTION_TITLE_FALLBACK,
  analyzeDependencyGraph,
  findParallelWriteConflicts,
  normalizeHeading,
  classifyFixReturnCause,
  resolveFixRollbackDecision,
  resolveFixRollbackState,
  applyFixRollbackRound,
  resolveFixReturnNode,
  REENTRY_TARGET_NODE_IDS,
  REENTRY_ROUND_LIMIT,
  isSingleSegmentChangeName,
  reentrySourceDecision,
  resolveReentryTarget,
  parseReentryAuthorization,
  parseReentryContinuationAuthorization,
  reentryRoundCount,
  reentryRoundDecision,
  reentryPredecessorIntersection,
  reentryNoOpDecision,
  resolveReentryDecision,
  REPLAN_PHASE_NODE_IDS,
  REPLAN_ROUND_LIMIT,
  replanSourceDecision,
  parseReplanAuthorization,
  parseReplanContinuationAuthorization,
  replanRoundCount,
  replanRoundDecision,
  replanNoOpDecision,
  resolveReplanDecision,
};
