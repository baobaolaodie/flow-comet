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

// ---------- Fix 批次共享判定（单一权威 · 纯函数） ----------
// workflow-guard 与 workflow-state 的 Fix 两态一律复用本段实现，禁止任一侧内联第二份
// （L-058 路由单一权威 / L-067 同判据两份实现必然分叉）。纯判定：只读 TASK.md 与协议/产物
// 推导，无副作用、无 console 输出、无 process.exit，不新增 state 字段。
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
function taskSetSignature(taskContent) {
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

// 「未闭合 execute 生命周期」信号派生：取 history 中最后一次 exit-applied execute 家族事件
// 记录的 { signature, node }；无家族出口事件 / 该事件无签名字段（旧 state）→ null（调用方按
// 旧 change 渐进放行）。只认最新一次家族出口——更早的签名被后续闭合覆盖。
// change 归属：state.history 跨 change 保留（select 只切 activeChange），因此带 change 的事件
// 只在 change 名一致时参与判定；无 change 字段的旧 state 事件保持兼容（legacy 可参与）。
function latestExecuteExitEvent(history, changeName) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const event = history[i];
    if (!event || event.event !== 'exit-applied' || !EXECUTE_FAMILY_NODE_IDS.has(event.node)) continue;
    if (typeof event.change === 'string' && event.change !== changeName) continue;
    if (typeof event.taskSetSignature !== 'string' || event.taskSetSignature === '') return null;
    return { signature: event.taskSetSignature, node: event.node };
  }
  return null;
}

// ---------- Fix 回因分类（共享纯函数 · 单一权威 · 展示层派生） ----------
// guard exit 回程分支在写本次 exit-applied 事件之前调用本分类器：只用既有字段派生证据（history
// 的 execute 家族出口签名 + TASK 内容结构标记），零新增 state 字段 / 事件类型。判据（DESIGN D1）：
//   divergence = 历史任一 execute 家族 exit-applied 事件记录的 taskSetSignature ≠ 当前任务集签名；
//   marker     = 模板派生的 Fix 段内含 <task> 块，或全文任一任务 id 匹配 /^[TP]-FIX-/i；
//   divergence ∨ marker → 'fix'；有签名且不发散 → 'normal'；无签名且无标记 → 'unknown'
//   （旧 state 证据不足：中性输出、不 BLOCK，由调用方渲染）。
// Fix 段标题由调用方传入（guard 从 flow-kit/templates/TASK.md 派生，D4 单一模板源）；缺失 / 空串
// 回退内置常量。history 过滤与 latestExecuteExitEvent 同语义（change 归属：有 change 字段且不匹配
// 则跳过，无 change 的 legacy 事件参与）；签名事件全量参与、不做「只看最新」短路——多波次场景最新
// 签名已被闭合写成当前签名，只看最新会漏判 fix。
const FIX_SECTION_TITLE_FALLBACK = 'Fix 任务';

// 段标题归一：去 ATX 标记 / 闭合标记 / 尾部括号内容 / 编号前缀后比较（与 guard C2 段名归一同型），
// 让 Fix 任务、Fix 任务（来自 REVIEW / INTEGRATION）、## Fix 任务 ## 等合法写法命中同一段。
function normalizeFixSectionTitle(raw) {
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
  const wanted = normalizeFixSectionTitle(fixSectionTitle);
  if (wanted === '') return null;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (!m) continue;
    const heading = normalizeFixSectionTitle(m[1]);
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
function classifyFixReturnCause({ history, changeName, taskContent, fixSectionTitle } = {}) {
  const currentSignature = taskSetSignature(taskContent);
  let signatureKnown = false;
  let divergence = false;
  if (Array.isArray(history)) {
    for (const event of history) {
      if (!event || event.event !== 'exit-applied' || !EXECUTE_FAMILY_NODE_IDS.has(event.node)) continue;
      if (typeof event.change === 'string' && event.change !== changeName) continue;
      if (typeof event.taskSetSignature !== 'string' || event.taskSetSignature === '') continue;
      signatureKnown = true;
      if (event.taskSetSignature !== currentSignature) divergence = true;
    }
  }
  if (divergence || fixTaskMarker(taskContent, fixSectionTitle)) return 'fix';
  return signatureKnown ? 'normal' : 'unknown';
}

// Fix 回退态判定（单一权威——guard 入口/出口与 state 的 next 分支一律复用本函数）：currentNode
// ∈ {review, verify} ∧ TASK.md 可解析出任务块 ∧ 以下任一：
//   ① 存在 status="pending" 任务 ∧ resolveNextNode(completedNodes) ∈ execute 家族
//      （串行 pending → execute；可委托 parallel pending → subagent-execute）→ 返回该目标节点；
//   ② 全任务 done ∧ execute 家族至少一个节点已在 completedNodes ∧ history 最新家族出口事件记录的
//      任务集签名与当前 TASK.md 签名不一致 → 返回该事件记录的家族节点（done-but-unclosed：追加/
//      修改修复任务后从未重跑家族出口；lazy entry 只刷新 taskHash、不写 exit 事件，签名保持不一致）。
// 旧 state 无签名记录 → ② 不成立（旧 change 渐进放行）。TASK.md 缺失 / 不可读 / 零任务块 /
// 当前节点非 review|verify → null（fail-closed）。路由复用唯一权威 resolveNextNode，不复制判定。
async function resolveFixRollbackState({ runRoot, changeName, protocol, completedNodes = [], currentNode, history = [] }) {
  if (currentNode !== 'review' && currentNode !== 'verify') return null;
  const taskContent = await readProtocolTaskContent(protocol, changeName, path.join(runRoot, '.specs'));
  if (taskContent === null) return null;
  const attrsList = taskBlocks(taskContent).map(taskOpeningAttrs).filter(Boolean);
  if (attrsList.length === 0) return null;
  if (attrsList.some((attrs) => attrs.status === 'pending')) {
    try {
      const next = await resolveNextNode({ runRoot, changeName, protocol, completedNodes });
      return EXECUTE_FAMILY_NODE_IDS.has(next) ? next : null;
    } catch {
      return null;
    }
  }
  if (!attrsList.every((attrs) => attrs.status === 'done')) return null;
  if (![...EXECUTE_FAMILY_NODE_IDS].some((id) => completedNodes.includes(id))) return null;
  const recorded = latestExecuteExitEvent(history, changeName);
  if (recorded === null) return null;
  return taskSetSignature(taskContent) !== recorded.signature ? recorded.node : null;
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

export {
  route,
  protocolTaskFilePath,
  hasSubagentNode,
  firstIncompletePostExecNode,
  EXECUTE_FAMILY_NODE_IDS,
  taskSetSignature,
  classifyFixReturnCause,
  resolveFixRollbackState,
  resolveFixReturnNode,
};
