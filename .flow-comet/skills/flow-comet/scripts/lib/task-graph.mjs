// task-graph.mjs — 任务与协议图的底层共享判定（单一权威实现）
// 承载：① 协议节点顺序 / 启用 / 任务文件路径（route · protocolNodeEnabled · protocolTaskFilePath ·
// EXECUTE_FAMILY_NODE_IDS）；② 任务依赖解析与依赖图（taskDependencyEligibility · analyzeDependencyGraph）；
// ③ 并行写冲突检测三族（findParallelWriteConflicts 及其构件）；④ 任务集签名与版本语义 ·
// history 事件归属 · change 名形态 · 修复任务族文本谓词。
// 纯判定：只读 TASK.md 文本、协议对象与 state.history，无 console 输出、无 process.exit、无 state 写入。
// 依赖方向：本模块不 import 其他 lib 模块（lib 层最底层）——入口与兄弟模块单向依赖本模块。
import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { taskBlocks, taskOpeningAttrs } from '../task-parsing.mjs';

// 节点顺序 = 协议 nodes 顺序（disabled 过滤）。全部节点排序判定共用本实现（单一来源）。
export function route(protocol) {
  return (protocol.nodes ?? []).filter((n) => !n.disabled);
}

// 协议节点是否 enabled：route 顺序中存在且未 disabled。协议 enabled 语义以本函数为唯一来源，
// 路由、请求归属门禁、受控重入与受控重校一律复用，不各自过滤。
export function protocolNodeEnabled(protocol, nodeId) {
  return route(protocol).some((node) => node.id === nodeId);
}

// execute 家族节点：协议 route 顺序中由任务状态特判的节点。多消费方（路由镜像 / 签名闭合 /
// Fix 回因与轮次）共用本常量，禁止任一消费方内联家族成员对。
export const EXECUTE_FAMILY_NODE_IDS = new Set(['execute', 'subagent-execute']);

// 协议任务文件路径：协议可选 taskFile 字段（相对 .specs/<change-id>/），无声明时缺省 TASK.md。
// 路由、Fix 回溯与受控重入共用同一解析（防两处漂移）。
export function protocolTaskFilePath(protocol, changeName, specsRoot) {
  const taskFile = typeof protocol.taskFile === 'string' && protocol.taskFile !== ''
    ? protocol.taskFile
    : 'TASK.md';
  return path.join(specsRoot, changeName, taskFile);
}

// 依赖资格：解析任务块的 <depends_on> 并与已完成任务 id 集合比较。依赖文本解析只此一处，
// 路由的可委托并行过滤、依赖图分析与并行写冲突检测一律调用本函数。返回 { eligible, deps, unmet }；
// 无 <depends_on> 元素或内容为空视为无依赖（eligible=true）。
export function taskDependencyEligibility(block, doneIds = new Set()) {
  const depsMatch = String(block ?? '').match(/<depends_on>([\s\S]*?)<\/depends_on>/);
  if (!depsMatch || !depsMatch[1].trim()) return { eligible: true, deps: [], unmet: [] };
  const deps = depsMatch[1].trim().split(/[,\s]+/).filter(Boolean);
  const unmet = deps.filter((dep) => !doneIds.has(dep));
  return { eligible: unmet.length === 0, deps, unmet };
}

// 正则元字符转义（glob 形态共用）：路径重叠判定与产物 glob 存在检查共用本实现。
export function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
}

// ---------- 任务集签名（算法版本 + 内容 digest · 单一实现） ----------
// 算法版本元数据：值格式 <算法版本>:<digest>（如 v1:<sha256 hex>）。签名算法实现变更时必须同步
// 提升版本常量——冻结锚据此判别；state 的 taskHash 与 exit-applied 事件的 taskSetSignature 都写
// 版本前缀，事件另带 signatureAlgo 字段；legacy 裸 hex 一律按 v1 解析；消费点只做同版本比较，
// 版本不同视为不可比（不判发散、不误归位、不误拦任务集）。
export const TASK_SET_SIGNATURE_ALGO = 'v1';
const TASK_SET_SIGNATURE_PREFIX = /^(v\d+):([0-9a-f]{64})$/u;
const TASK_SET_SIGNATURE_BARE_HEX = /^[0-9a-f]{64}$/u;
const LEGACY_TASK_SET_SIGNATURE_ALGO = 'v1';

// 内容 digest：提取全部 <task> 块，剥离开标签上的标记类属性（只保留影响路由语义的 id/parallel），
// 排序防顺序漂移，拼接后 sha256。行尾归一——跨工具编辑（heredoc 写 LF、其它工具写 CRLF）会让
// 「任务集逻辑未变但字节变」误报 BLOCK，故签名前统一 CRLF → LF（只归一化行尾，不改内容语义）。
// 标记类属性白名单——任务标记 done 会在开标签追加 completed_at / assigned_to 等纯状态属性，
// 只剥离 status 仍会误报；改为白名单保留 id/parallel（含未来新增标记属性，无需再改）；
// 任务内容（name / action / write_files / verify / depends_on）保持签名敏感。
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

// history 事件 change 归属（单一权威）：state.history 跨 change 保留（select 只切 activeChange），
// 带 change 字段的事件只在 change 名一致时参与；无 change 字段的旧 state 事件保持兼容（legacy 参与）。
// execute 家族出口签名读取 / Fix 回因分类 / 受控重入与重校轮次一律调用本函数，禁止再内联同一过滤判据
// ——注释互指同源不是同步机制。
export function historyEventBelongsToChange(event, changeName) {
  return typeof event?.change !== 'string' || event.change === changeName;
}

// change 名形态（单一权威 · 受控重入 / 受控重校判定与 select 入口共用）：change-id 必须是 .specs/
// 下的单段目录名——拒绝空串、路径分隔符与「.」「..」，并保留目录名 archive（归档区）不得作为
// change 名。本判据只做字符串形态判定（纯函数）；「realpath 归一后仍是 .specs 真实直接子目录」
// 的物理包含性由调用方的路径段扫描（protocol-utils 单一权威）负责。
export function isSingleSegmentChangeName(value) {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  if (name === '' || name === '.' || name === '..') return false;
  // 原始值必须与 trim 后逐字相等：Windows 与部分文件系统忽略首尾空白 / 尾点，放行「空白变体」
  // 会让 path.join 指到真实目录、而 activeChange 存的是变体字符串——轮次事件按 activeChange
  // 精确匹配（配额被换键重置），事件归属随即失真。
  if (value !== name) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  // 保留目录名按大小写归一判定：Windows 与默认 macOS 的路径解析不区分大小写，「ARCHIVE」
  // 「Archive」同样指向归档区，逐字比较会漏判。
  if (name.toLowerCase() === 'archive') return false;
  return true;
}

// ---------- 修复任务族文本谓词（单一权威 · 供并行写冲突第三族与回因分类共用） ----------
export const FIX_SECTION_TITLE_FALLBACK = 'Fix 任务';

// 共享 heading 归一（单一权威）：去 ATX 标记 / 闭合 ATX 标记 / 尾部括号内容 / 编号前缀后比较，
// 让「Fix 任务」「Fix 任务（来自 REVIEW / INTEGRATION）」「## Fix 任务 ##」等合法写法命中同一段；
// 修复段标题匹配与调用方的模板段名归一均委托本实现，禁止另起第二份。
export function normalizeHeading(raw) {
  return String(raw ?? '')
    .replace(/\r/g, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/[（(][^）)\n]*[）)]\s*$/u, '')
    .replace(/^\d+(?:\.\d+)?\.?\s*/u, '')
    .trim()
    .toLowerCase();
}

// 修复段正文切片：首个同级（##）标题命中 → 返回标题行之后、下一个同级标题（或 EOF）之前的正文；
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

// 修复任务族 id 前缀（唯一谓词的 id 边界，全模块只此一处定义）：含尾连字符——形似编号（前缀
// 之后缺连字符的形态）不属该族；宽松前缀会把非修复编号整族放过（边界只在这里表达一次）。
const FIX_TASK_ID_PREFIX = /^[TP]-FIX-/i;

// 修复任务族唯一谓词（单一权威）：返回 (block) => boolean 的判定函数——命中 id 前缀，或任务块
// 位于修复段内（段定位复用 fixSectionBody / normalizeHeading 的既有标题语义，标题缺省回退
// FIX_SECTION_TITLE_FALLBACK）。回因分类的结构标记与并行写冲突第三族的参与者排除一律调用本函数，
// 禁止任何消费方另起一套边界——id 前缀与「位于修复段内」两条边界只在此处表达一次。
export function fixTaskClassifier(taskContent, fixSectionTitle) {
  const content = String(taskContent ?? '');
  const title = (typeof fixSectionTitle === 'string' && fixSectionTitle.trim() !== '')
    ? fixSectionTitle
    : FIX_SECTION_TITLE_FALLBACK;
  const section = fixSectionBody(content, title);
  const sectionBlocks = new Set(section === null ? [] : taskBlocks(section));
  return (block) => {
    const attrs = taskOpeningAttrs(block);
    if (!attrs || typeof attrs.id !== 'string') return false;
    if (FIX_TASK_ID_PREFIX.test(attrs.id)) return true;
    // 行尾归一（与任务集签名的归一纪律同源）：fixSectionBody 产出 LF，而待判 block 来自原文
    // （跨平台编辑可能是 CRLF）。不归一会让「修复段内非前缀 id」任务匹配失败——第三族把它当
    // 普通参与者误拦，且结构标记同时失效。
    return sectionBlocks.has(String(block ?? '').replace(/\r\n/g, '\n'));
  };
}

// 修复任务结构标记：全文存在修复任务（id 命中修复族前缀——覆盖文件尾追加等非规范落点；或修复段
// 内出现 <task> 块——标题与任务需同段，段内无任务不误报）→ true；否则 false。判定一律经唯一谓词
// fixTaskClassifier，本函数只做「是否存在」的聚合，不再自持边界。
// 解析复用 taskBlocks / taskOpeningAttrs（与路由、门禁共享同一 <task> 解析语义）。
export function fixTaskMarker(taskContent, fixSectionTitle) {
  const isFixTask = fixTaskClassifier(taskContent, fixSectionTitle);
  return taskBlocks(String(taskContent ?? '')).some((block) => isFixTask(block));
}

// ---------- 任务依赖图分析（单一权威 · plan 出口波次校验 / subagent-execute 出口孤儿检测 / replan 重校共用） ----------
// 对全部 <task> 块建依赖图（deps 边），Kahn 拓扑排序判环 + 缺失依赖收集。
// 返回 { ids, depsById, missing: [{id, dep}], cyclic, cycleIds }（cycleIds = 拓扑排序无解的
// 任务集合，含被环传递拖累的下游任务）。单一语义：依赖图无环 + 依赖链可满足。
// 依赖文本解析复用本模块 taskDependencyEligibility（依赖解析单一权威——不再另起第二份正则）。
export function analyzeDependencyGraph(blocks) {
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

// ---------- 并行文件依赖检测（单源：plan 出口门禁与 replan 重校共用） ----------
// 解析 TASK.md 的任务 read/write_files 声明，分三族返回：
//   ① writeConflicts（写写强判）：本趟可运行的 parallel=pending 任务间 write∩write 非空——同波次
//      并行写同一路径必竞态覆盖；
//   ② readWarnings（读写弱判）：并行对一方读取对方写路径——仅对彼此无显式 depends_on 关联的并行对
//      探测，有显式关联=依赖已声明，跳过→合法拓扑零新增告警；
//   ③ crossTaskConflicts（同文件跨任务且无依赖路径）：两个未完成任务（status 非 done）写入面重叠
//      且两任务间不存在依赖路径（depends_on 传递闭包，双向任一可达即视为已显式排序 → 放行）——
//      串行拆分出的同文件任务同样命中（未显式排序的同文件多任务）；修复任务族不参与本族（族谓词
//      复用唯一权威 fixTaskClassifier）——其顺序由修复生命周期保证，回修同一文件是必然形态；
//      与①按任务对去重（同一对已计入写写强判则不再计入本族）。
// 编排与判定分离：族③计算抽为具名纯函数 collectCrossTaskConflicts（只做集合推导，无 fs / console /
// process.exit / 入参改写），findParallelWriteConflicts 只负责读文件、解析、族①②与去重键的组织。
// 路径解析 / 归一（parsePaths / normalizeTaskPath）为单份实现，族①②③共用；依赖文本解析复用
// taskDependencyEligibility（单一权威）。路径**重叠判定**（含 glob 语义）同样是单份实现：具名纯函数
// collectPathOverlaps，族①②③一律经它比较——任一族内联第二份比较逻辑即违规（同一判据两份实现必然分叉）。
// 开标签属性解析与路由共享 taskOpeningAttrs（属性序无关；不读块内文本）。

// 任务对键（无序——不依赖任务书写顺序；NUL 分隔，任务 id 不含 NUL）：同文件跨任务族与写写强判族
// 按任务对去重时使用（同一对已计入写写强判则不再计入第三族）。
function taskPairKey(a, b) {
  return a < b ? a + '\u0000' + b : b + '\u0000' + a;
}

// 依赖可达集（depends_on 传递闭包）：从 start 沿依赖边可达的全部任务 id（含经由其它任务中转的
// 路径）。判定语义 = 双向任一可达即视为两任务已显式排序 → 第三族放行（见上方族说明）。
function reachableTaskIds(depsById, start) {
  const seen = new Set();
  const stack = [...(depsById.get(start) ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of depsById.get(cur) ?? []) stack.push(next);
  }
  return seen;
}

// 路径归一化：分隔符统一 '/'、解 '.' 段（`./` / `a/./b`）、`..` 逃出项目根按越界处理（返回 null
// 不参与重叠比较）——`src/a.mjs` vs `src/./a.mjs` / `src\a.mjs` 变体不再绕过写写强判与读写弱判；
// 与委托入口共用同一函数（两侧同语义）。族①②③共用本实现。
function normalizeTaskPath(raw) {
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
}

// 路径解析与既有自动解析同源：剥 HTML 注释 → 换行切分 → 分号二次切分 → trim → 滤空 → 归一。
// 按声明实际内容解析，不做扩展名白名单过滤——txt/log/无扩展名路径同等检出（链式重命名的 .txt
// 事故面闭合）。族①②③共用本实现，不另起第二份。
function parsePaths(matchText) {
  return String(matchText ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim().split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean)
    .flatMap((l) => l.split(';')).map((l) => l.trim()).filter(Boolean)
    .map(normalizeTaskPath)
    .filter((p) => p !== null && p !== '');
}

// 元字符判定：glob 魔法 = `*` / `?` / `[` 三类——与委托侧的字面路径资格判定
// （literalRelativePosixPath 的 /[*?[]/）同口径；「什么算 glob」不另立第三套定义。
const GLOB_MAGIC_CHAR = /[*?[]/;

// 路径重叠判定（族①②③共用的唯一具名纯函数）：入参为两组**已归一**路径声明（normalizeTaskPath
// 产物，分隔符统一 `/`），返回重叠描述串数组（直接进冲突消息的 files 字段）或空数组（不重叠）；
// 无 fs / console / process.exit，不改任何入参。
// 三形态：
//   ① 两侧均无元字符 ⇒ 既有字面相等语义（逐字等价：相等报该路径本身——消费方消息零变化）；
//   ② 单侧含元字符 ⇒ 用该侧模式匹配另一侧字面路径：**段数必须相等**（`*` 不跨 `/`，`**` 亦非递归）、
//      段内 `*` 匹配段内任意字符（`[^/]*`）、其余字符字面锚定（正则元字符转义）；段内无 `*` 即不命中；
//   ③ 双侧均含 glob ⇒ **保守视为重叠**（宁可误拦不可漏检——漏检正是本判据要修的缺陷）；无共同字面
//      路径可报，故报两侧声明。
// ②的语义**对齐基准** = workflow-handoff.mjs 的 matchWriteFilePattern：该函数未导出、所在模块
// 又是 CLI 顶层脚本（import 即执行 main），物理不可复用；故本模块按同一形态实现并在此锚定基准
// 位置——基准若变，此处必须同步（漂移可见；不互指「同源」了事）。零第三方 glob 库（ADR-007）：
// 复用本模块既有 escapeRegExp（转义集与基准内联转义一致）。
export function collectPathOverlaps(leftPaths, rightPaths) {
  const overlaps = [];
  for (const left of leftPaths) {
    for (const right of rightPaths) {
      if (left === right) { overlaps.push(left); continue; }        // ① 逐字相等（含两侧同 glob）
      const leftGlob = GLOB_MAGIC_CHAR.test(left);
      const rightGlob = GLOB_MAGIC_CHAR.test(right);
      if (!leftGlob && !rightGlob) continue;                        // ① 两侧字面且不等 ⇒ 不重叠
      if (leftGlob && rightGlob) {                                  // ③ 双侧 glob：保守判重叠
        overlaps.push(left + ' ∩ ' + right);
        continue;
      }
      const patternSegments = (leftGlob ? left : right).split('/');  // ② 单侧 glob：模式 × 字面
      const literalSegments = (leftGlob ? right : left).split('/');
      if (patternSegments.length !== literalSegments.length) continue;
      const matched = patternSegments.every((seg, index) => {
        if (seg === literalSegments[index]) return true;
        if (!seg.includes('*')) return false;
        return new RegExp('^' + seg.split('*').map(escapeRegExp).join('[^/]*') + '$')
          .test(literalSegments[index]);
      });
      if (matched) overlaps.push(left + ' ∩ ' + right);
    }
  }
  return overlaps;
}

// 第三族（同文件跨任务且无依赖路径）计算——本模块具名纯函数：输入任务块 / 依赖图 / 既有族去重键，
// 输出冲突对数组（{ a, b, files }）；无 fs / console / process.exit，不改任何入参。
// taskContent 与 allBlocks 须同源（taskContent = 产出 allBlocks 的 TASK.md 文本）——修复任务族
// 谓词需要全文以定位修复段（段标题取该谓词的缺省回退常量，与 fixTaskClassifier 的缺省一致）。
export function collectCrossTaskConflicts({ taskContent = '', allBlocks = [], depsById = new Map(), excludedPairKeys = new Set() } = {}) {
  const isFixTask = fixTaskClassifier(taskContent);
  const reachCache = new Map();
  const reachableFrom = (id) => {
    if (!reachCache.has(id)) reachCache.set(id, reachableTaskIds(depsById, id));
    return reachCache.get(id);
  };
  const participants = [];
  for (const block of allBlocks) {
    const attrs = taskOpeningAttrs(block);
    if (!attrs || !attrs.id || attrs.status === 'done' || isFixTask(block)) continue;
    const wf = block.match(/<write_files>([\s\S]*?)<\/write_files>/);
    if (!wf) continue;
    const writes = new Set(parsePaths(wf[1]));
    if (writes.size === 0) continue;
    participants.push({ id: attrs.id, writes });
  }
  const conflicts = [];
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      if (excludedPairKeys.has(taskPairKey(participants[i].id, participants[j].id))) continue;
      const overlap = collectPathOverlaps(participants[i].writes, participants[j].writes);
      if (overlap.length === 0) continue;
      if (reachableFrom(participants[i].id).has(participants[j].id)
        || reachableFrom(participants[j].id).has(participants[i].id)) continue;
      conflicts.push({ a: participants[i].id, b: participants[j].id, files: overlap });
    }
  }
  return conflicts;
}

export async function findParallelWriteConflicts(changeDir) {
  const taskFile = path.join(changeDir, 'TASK.md');
  let text;
  try { text = await fs.readFile(taskFile, 'utf8'); } catch { return { writeConflicts: [], readWarnings: [], crossTaskConflicts: [] }; }
  const allBlocks = taskBlocks(text);
  // 依赖资格收窄：仅统计「本趟可运行」的并行任务——deps ⊆ doneIds；等待后续趟次的并行任务
  // （依赖未满足）与已交付任务不参与同趟冲突判定，使 A→B 同写路径的跨趟合法计划不再被首趟误拦
  // （与路由谓词同一口径）。依赖文本解析与资格判定一律走 taskDependencyEligibility——本函数不再
  // 自持第二份 <depends_on> 解析，候选集过滤与读写弱判的「显式关联」判定同源。
  const doneIds = new Set(allBlocks
    .map((b) => taskOpeningAttrs(b))
    .filter((a) => a && a.id && a.status === 'done')
    .map((a) => a.id));
  const blocks = allBlocks.filter((b) => {
    const a = taskOpeningAttrs(b);
    if (!a || !a.parallel || a.status !== 'pending') return false;
    return taskDependencyEligibility(b, doneIds).eligible;
  });
  const perTask = [];
  for (const b of blocks) {
    const a = taskOpeningAttrs(b);
    if (!a || !a.id) continue;
    const wf = b.match(/<write_files>([\s\S]*?)<\/write_files>/);
    const rf = b.match(/<read_files>([\s\S]*?)<\/read_files>/);
    if (!wf && !rf) continue;
    perTask.push({
      id: a.id,
      deps: new Set(taskDependencyEligibility(b).deps),
      writes: new Set(parsePaths(wf && wf[1])),
      reads: new Set(parsePaths(rf && rf[1])),
    });
  }
  const writeConflicts = [];
  const readWarnings = [];
  for (let i = 0; i < perTask.length; i++) {
    for (let j = i + 1; j < perTask.length; j++) {
      const overlap = collectPathOverlaps(perTask[i].writes, perTask[j].writes);
      if (overlap.length) writeConflicts.push({ a: perTask[i].id, b: perTask[j].id, files: overlap });
      // 读写弱判触发面：仅无显式 depends_on 关联的并行对（有显式关联=依赖已声明，跳过）
      const associated = perTask[i].deps.has(perTask[j].id) || perTask[j].deps.has(perTask[i].id);
      if (associated) continue;
      const readOverlap = collectPathOverlaps(perTask[i].reads, perTask[j].writes);
      if (readOverlap.length) readWarnings.push({ a: perTask[i].id, b: perTask[j].id, files: readOverlap });
      const readOverlap2 = collectPathOverlaps(perTask[j].reads, perTask[i].writes);
      if (readOverlap2.length) readWarnings.push({ a: perTask[j].id, b: perTask[i].id, files: readOverlap2 });
    }
  }
  // 第三族：同文件跨任务且无依赖路径（族语义见上方块注释）。编排只做三件事——族①任务对去重键、
  // 依赖图（analyzeDependencyGraph 单一权威，其依赖解析走 taskDependencyEligibility）、调用具名
  // 纯函数 collectCrossTaskConflicts；参与者规则（status 非 done 且非修复任务族）与依赖闭包判定
  // 全在该纯函数内，此处不内联第二份。
  const writePairKeys = new Set(writeConflicts.map((c) => taskPairKey(c.a, c.b)));
  const { depsById } = analyzeDependencyGraph(allBlocks);
  const crossTaskConflicts = collectCrossTaskConflicts({
    taskContent: text,
    allBlocks,
    depsById,
    excludedPairKeys: writePairKeys,
  });
  return { writeConflicts, readWarnings, crossTaskConflicts };
}
