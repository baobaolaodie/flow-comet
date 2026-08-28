// route-node.mjs — 共享「任务状态 → 节点」路由判定核心（D3 单一权威）
// 本模块承载从 workflow-state.mjs determineNode 抽取的节点判定核心（含「串行 pending → execute」回流）。
// 两侧复用唯一实现（guard 与 workflow-state 各调用 resolveNextNode），根治双实现漂移（D8）。
// 纯判定：resolveNextNode 无副作用、无 console 输出、无 process.exit——只读 .specs 产物与任务文件，
// 仅返回节点 id（或 null = 完成态）；展示层（guard NEXT+SKILL 行 / workflow-state NODE+SKILL 行）
// 由各自调用方渲染，不并入本模块（文案逐字保留）。
// 接口：resolveNextNode({ runRoot, changeName, protocol, completedNodes = [] })——runRoot 显式传入，
// specsRoot 内部派生为 path.join(runRoot, '.specs')（与两侧调用方各自 .specs 根语义一致）。
import { promises as fs } from 'fs';
import path from 'path';
import { taskBlocks, taskOpeningAttrs } from './task-parsing.mjs';

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
// 产物推导 pathBase 感知: 产物根按 artifact.pathBase 解析——'specs-root' → specsRoot；'project'/缺省 → runRoot
// （与 workflow-guard.mjs 的 workflowPathBaseRoot 对齐：内置协议 10 个 artifacts 全部显式
// 声明 specs-root；compose 自定义协议可声明 project 根工件如 README.md）。
// classic/native 等其余 pathBase 暂按 specs-root 兜底（与抽取前一致，不回归——guard 侧全量感知）。
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

// 协议是否含 subagent-execute 委托节点（自定义协议可不含——此时 parallel 任务由 execute 直接消化）
function hasSubagentNode(protocol) {
  return route(protocol).some((n) => n.id === 'subagent-execute');
}

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
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
        // 检查 pending parallel 任务中是否有依赖已满足的（开标签 parallel="true" 且 status="pending"）
        const parallelBlocks = taskList.filter((block) => {
          const a = taskOpeningAttrs(block);
          return a && a.parallel && a.status === 'pending';
        });
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

export { route, protocolTaskFilePath, hasSubagentNode };