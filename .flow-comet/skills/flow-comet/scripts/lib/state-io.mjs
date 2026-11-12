// 状态读写与 .specs 路径上下文（单一归属）：状态文件解析 / 原子写落盘 / 活动 change 解析 /
// change 目录边界，以及各命令族共用的路径锚（runRoot · specsRoot · statePath）。
// 路径锚由入口在分派前初始化一次；运行根由唯一解析模块（run-root.mjs）给定——FLOW_COMET_RUN_ROOT
// 优先、否则进程 cwd。模块内不自行取 cwd：入口与模块各持一份「运行根」就是同一事实的第二处表达。
// 目录名与状态文件名常量来自 state-schema.mjs。
import { existsSync, promises as fs, readdirSync } from 'fs';
import path from 'path';
import { validateStateFields, writeJsonAtomic, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME } from '../state-schema.mjs';
import { inspectWorkflowPathSegments } from '../protocol-utils.mjs';
import { isSingleSegmentChangeName } from '../route-node.mjs';
// 归档目录名的日期前缀判据（<YYYY-MM-DD>-<change-id>）由 time-utils 单源表达：本模块只取「日期
// 前缀」这一事实再精确比对整名，不在路径规则里内联第二份日期正则。
import { archiveDateFromName } from '../time-utils.mjs';

let runtimeContext = null;

export function initStateContext(runRoot) {
  runtimeContext = {
    runRoot,
    specsRoot: path.join(runRoot, '.specs'),
    statePath: path.join(runRoot, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME),
  };
}

export function runRootDir() {
  return runtimeContext.runRoot;
}

export function specsDir() {
  return runtimeContext.specsRoot;
}

export function stateFile() {
  return runtimeContext.statePath;
}

// 读 JSON：容忍 UTF-8 BOM（外部写入如会话 Write 可能带 BOM）
export async function readJson(file) {
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}

export async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

// 「在办」身份的唯一判据：state.activeChange 非空 ∧ status ≠ 'completed' ⇒ 在办（返回 change 名），
// 否则 null。目录在不在**不参与**（位置由 resolveChangeDir 回答）。抽成具名函数是为了让「同一身份
// 口径」有唯一表达：findActiveChange（读文件 + state 缺失时的恢复扫描）与 init 的覆盖闸门（手里
// 已有 prevState，不重读）消费的是同一条规则，而不是各写一遍表达式。
// 消费方注意：init 的闸门只认状态——state 文件缺席时「没有可被覆盖的旧状态」，恢复扫描出的目录
// 不构成阻断理由，也不该被当成留档对象。
export function inFlightChangeName(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  if (state.status === 'completed') return null;
  return typeof state.activeChange === 'string' && state.activeChange !== '' ? state.activeChange : null;
}

export async function findActiveChange() {
  // 1. 身份只看状态（单一判定，判据 = inFlightChangeName）：state 存在 ∧ activeChange 非空 ∧
  //    status ≠ 'completed' ⇒ 在办。目录在不在**不参与**身份判定——位置由 resolveChangeDir 回答：
  //    归档搬移只是把目录换个位置，change 仍在办（移动后 status / next / record 照常报进行中）。
  //    把身份绑在「活动目录存在」上会让移动后瞬时丢掉身份，命令层随即把在办 change 报成
  //    no-change / NEXT: done（假答案）。
  if (await fileExists(stateFile())) {
    const state = await readJson(stateFile());
    const inFlight = inFlightChangeName(state);
    if (inFlight) return inFlight;
    // completed 检查优先于恢复扫描——归档完成态（无论 activeChange 是否残留）一律不识别为 active
    //（防归档残留目录 / 残留字段误判）
    if (state.status === 'completed') return null;
  }
  // 2. .specs/ 扫描**只是 state 丢失时的恢复通道，不是第二身份来源**：它只在「无 state 文件」
  //    与「state 无 activeChange」两种情形下运行，触发条件与上一步的分支互斥。读这段时不要把它当成
  //    另一个身份来源——那会让同一事实出现两套判定（state 说 A、目录扫描说 B，命令各取一套）。
  //    位置（活动 / 归档）由 resolveChangeDir 回答，不在本函数内。
  //    Scan .specs/ for directories with TASK.md (active flow-kit changes)
  // 注: 曾尝试按 archive/ 对应归档跳过残留目录——但会误伤同名新 change（既有实证），已撤回。
  // 「state 缺失 + 归档残留」为已知限制；归档后正常态由上文 completed 分支覆盖。
  try {
    const entries = await fs.readdir(specsDir(), { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'archive' || entry.name === 'health' || entry.name === 'evolve' || entry.name === 'adr') continue;
      const taskFile = path.join(specsDir(), entry.name, 'TASK.md');
      if (await fileExists(taskFile)) candidates.push(entry.name);
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      // Return the most recently modified
      const withTime = await Promise.all(candidates.map(async c => ({
        name: c,
        mtime: (await fs.stat(path.join(specsDir(), c, 'TASK.md'))).mtimeMs
      })));
      withTime.sort((a, b) => b.mtime - a.mtime);
      return withTime[0].name;
    }
  } catch {}
  return null;
}

export async function readState() {
  if (await fileExists(stateFile())) {
    const st = await readJson(stateFile());
    // 兼容旧 state：无 executionMode / directOverride 时补默认（subagent 默认，direct 是显式逃生口）
    if (st.executionMode === undefined) st.executionMode = 'subagent';
    if (st.directOverride === undefined) st.directOverride = false;
    // branchMode 默认 true（git 仓库时 init 会判定为 true；非 git 仓库 init 纠正为 false；
    // status/next 显示以实时 git 检测为准——非 git 仓库显示 BRANCH: none）
    if (st.branchMode === undefined) st.branchMode = true;
    if (st.enablePrReview === undefined) st.enablePrReview = false;
    // 分支前缀（init --branch-prefix 记录；旧 state 缺省 'change/' 向后兼容）
    if (st.branchPrefix === undefined) st.branchPrefix = 'change/';
    return st;
  }
  return { activeChange: null, currentNode: null, completedNodes: [], evidence: {}, verifyFailures: 0, executionMode: 'subagent', directOverride: false, branchMode: true, enablePrReview: false };
}

// 写入前校验已知字段类型（fail-closed：非法 → BLOCKED 拒绝写入，不修复不猜测）：未知字段允许
// （前向兼容），缺字段允许（readState 默认补），只校验存在字段的类型。校验表唯一来源 =
// state-schema.mjs（本函数不复制判据）。写盘统一走状态层的原子写：先写同目录临时文件再 rename
// 覆盖，目标要么旧内容要么新内容，不会出现被截断的半写状态；写失败（磁盘满 / 权限 / 目标被占用）
// 清理临时文件后抛出，调用方按 fail-closed 处理。mkdir recursive 由该实现承担（.skill-loads/ 等
// 标记目录不存在时创建）；状态下发是单写者形态（机器字段只由脚本通道写）。
export async function writeState(state) {
  const bad = validateStateFields(state);
  if (bad.length) {
    console.error('BLOCKED: state 字段类型非法: ' + bad[0]);
    process.exit(1);
  }
  await writeJsonAtomic(stateFile(), state);
}

// .specs/ 下必须存在名字「逐字相等」的目录条目（change 名唯一性判据）。大小写不敏感文件系统
// （Windows / 默认 macOS）会把「CH」解析到 .specs/ch、「Archive」解析到归档区，但 activeChange
// 存的是变体字符串——轮次事件按 activeChange 精确匹配（配额被换键重置）、保留名检查按小写归一，
// 故 change 名必须等于真实目录名，大小写/空白变体一律拒绝（fail-closed）。
export async function hasExactSpecsEntry(changeName) {
  let entries = [];
  try {
    entries = await fs.readdir(specsDir());
  } catch {
    return false;
  }
  return entries.includes(changeName);
}

// 受控重入路径边界（单一 helper：change 名形态 + realpath 直接子目录 + symlink/junction 逃逸）。
// change 名必须是单段目录名（形态单一权威在 route-node.mjs，与综合判定同源）；目录必须真实存在、
// 非 symlink/junction、realpath 归一后仍在 .specs/ 内、且名字与真实目录条目逐字相等。物理包含性
// 判定复用 protocol-utils 的路径段扫描（单一权威，不写第二份路径判据）；任何越界 / 链接形态 /
// 名字变体一律 BLOCK（fail-closed）。
export async function inspectReentryChangeDir(changeName) {
  if (typeof changeName !== 'string' || changeName.trim() === '') {
    return { ok: false, reason: 'no-active-change' };
  }
  if (!isSingleSegmentChangeName(changeName)) {
    return { ok: false, reason: 'change-name-invalid' };
  }
  const changeDir = path.join(specsDir(), changeName);
  let inspection;
  try {
    inspection = await inspectWorkflowPathSegments(specsDir(), changeDir, 'reenter change dir', 'directory');
  } catch (error) {
    return { ok: false, reason: 'change-dir-escape', detail: error && error.message ? error.message : String(error) };
  }
  if (!inspection.exists) return { ok: false, reason: 'change-dir-missing' };
  if (!(await hasExactSpecsEntry(changeName))) return { ok: false, reason: 'change-name-invalid' };
  return { ok: true, changeDir };
}

// 归档目录名是否本 change 的归档目录：`<YYYY-MM-DD>-<change-id>` 精确形态，不做后缀匹配。
// 别的 change 的归档目录也可能以 `-<本 change>` 结尾（如 other-<本 change>），后缀匹配会把**别的
// change 的目录**认作本 change 的：声明标记门据此拿别人的声明替本 change 作证、归档提名据此数别人的
// SUMMARY 份数、守卫据此把本 change 判成「已归档」而跳过真实跑验证命令。日期形态取 time-utils 的单源
// 判定，本处只把整名与日期前缀拼回去做精确比对。
//
// 三个消费面（声明标记目录解析、守卫的「是否已归档」、归档提名的 SUMMARY 份数）都走这一条判据：
// 归档目录名是「哪个 change 的」这一事实只有一种说法，各写一份必然在「后缀算不算数」上分叉。
export function isArchivedChangeDirName(entry, changeName) {
  if (typeof entry !== 'string' || typeof changeName !== 'string' || changeName === '') return false;
  const archiveDate = archiveDateFromName(entry);
  return archiveDate !== null && entry === archiveDate + '-' + changeName;
}

// ---------- change 目录定位（唯一实现） ----------
// 给定 change 名，回答「这个 change 的目录现在在哪」：活动目录 .specs/<id>/ 优先；不在就是归档目录
// .specs/archive/<YYYY-MM-DD>-<id>/（整名精确比对——判据单源 isArchivedChangeDirName，不写第二份
// 日期规则）。多候选按日期判：排除日期早于 state.createdAt 日期部分的候选、取日期最新的一份；
// 仍并列 / 无候选 → **不猜**，把候选交还调用方按 fail-closed 处理（status='ambiguous' | 'missing'）。
//
// 身份与位置是两件事：身份只看 state（findActiveChange），本函数只回答位置。目录缺失不影响「这个
// change 在办」的判定，只影响命令能不能落地——所以运行命令在解析不到时必须 fail-closed 并点名两处
// 路径，而不是把在办 change 报成「没有在办 change」。
//
// 落点在本模块（.specs 路径上下文）：这是一条 change 目录的路径规则，命令族 / 守卫族 / 委托脚本都
// 消费它，各写一份必然在「活动目录优先对不对」「多归档目录取哪个」上分叉（L-067）。运行根是显式
// 参数：各族注入自己的根（状态族 runRootDir()、守卫族 runRoot），规则不绑定任何一族的运行上下文。
//
// 返回形态（消费方按 status 分派，不解读 dir 的字符串形态）：
//   { status: 'active',    dir, relative, display, archiveDate: null, candidates: [] }
//   { status: 'archived',  dir, relative, display, archiveDate, candidates }
//   { status: 'missing',   dir: null, relative: null, display: null, archiveDate: null, candidates }
//   { status: 'ambiguous', dir: null, relative: null, display: null, archiveDate, candidates }
// relative = 相对 .specs/ 的 POSIX 路径（'<id>' / 'archive/<日期>-<id>'）——节点推导的产物根就按它
// 拼（见 route-node.resolveNextNode 的 changeDir 入参）；display = 用户可见的 .specs/... 形态。
export async function resolveChangeDir({ root, changeName, createdAt = null } = {}) {
  const specsRoot = path.join(root, '.specs');
  const activeDir = path.join(specsRoot, changeName);
  if (await fileExists(activeDir)) {
    return {
      status: 'active',
      dir: activeDir,
      relative: changeName,
      display: '.specs/' + changeName,
      archiveDate: null,
      candidates: [],
    };
  }
  const archiveRoot = path.join(specsRoot, 'archive');
  const entries = await fs.readdir(archiveRoot).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!isArchivedChangeDirName(entry, changeName)) continue;
    candidates.push({ name: entry, date: archiveDateFromName(entry) });
  }
  const lowerBound = archiveDateLowerBound(createdAt);
  const eligible = lowerBound === null
    ? candidates.slice()
    : candidates.filter((candidate) => candidate.date >= lowerBound);
  if (eligible.length === 0) {
    return { status: 'missing', dir: null, relative: null, display: null, archiveDate: null, candidates };
  }
  // 日期字典序 = 时间序（同一 YYYY-MM-DD 形态）；同日期多份即并列，不按 readdir 顺序挑一份。
  // 判据契约是「排不出唯一就停」：在 `<日期>-<id>` 精确名规则下同一日期不可能有两份（每个日期只
  // 拼出一个名字），所以并列支正常不可达——保留它是因为「不猜」是解析器对调用方的承诺，不该是某条
  // 命名规则的副产品（命名规则一放宽，是本支先接住，而不是 readdir 顺序先替人做决定）。
  const newest = eligible.reduce((best, candidate) => (candidate.date > best.date ? candidate : best), eligible[0]);
  const tied = eligible.filter((candidate) => candidate.date === newest.date);
  if (tied.length > 1) {
    return { status: 'ambiguous', dir: null, relative: null, display: null, archiveDate: newest.date, candidates };
  }
  return {
    status: 'archived',
    dir: path.join(archiveRoot, newest.name),
    relative: 'archive/' + newest.name,
    display: '.specs/archive/' + newest.name,
    archiveDate: newest.date,
    candidates,
  };
}

// createdAt 的日期下界：取 state 时间戳的前 10 个字符，交给 time-utils 的归档日期判据校验（不写
// 第二份日期形态正则）。形态不可判 → null = 不设下界（判不了的日期不许当作「全都太早」把唯一
// 候选也排掉）。
function archiveDateLowerBound(createdAt) {
  if (typeof createdAt !== 'string') return null;
  return archiveDateFromName(createdAt.trim().slice(0, 10));
}

// 位置解析的命令面形态：可解析 → { ok: true, resolution }；解析不到 → { ok: false, resolution,
// message }。退出码与打印归命令层（本模块不 process.exit），但**报文文本**落在这里——status /
// next / record / skill-load 必须说同一句话（成因只有「两处都没有」与「多候选判不出」两类，各写
// 一份措辞必然分叉）。
export async function resolveChangeLocation({ root, changeName, createdAt = null } = {}) {
  const resolution = await resolveChangeDir({ root, changeName, createdAt });
  if (resolution.status === 'active' || resolution.status === 'archived') {
    return { ok: true, resolution };
  }
  return { ok: false, resolution, message: changeLocationFailureMessage(changeName, resolution) };
}

// 位置解析失败的可见报文（fail-closed 的唯一措辞）：
//   · missing：身份在办但两处目录都没有（running-orphan）——命令不得回落到「没有在办 change」；
//   · ambiguous：同名归档多候选且日期判不出唯一一份——不许猜，列出候选请人工处置。
export function changeLocationFailureMessage(changeName, resolution) {
  const activeDisplay = '.specs/' + changeName;
  if (resolution.status === 'ambiguous') {
    return 'BLOCKED: 归档目录多候选，无法唯一判定 ' + changeName + ' 的目录（' + resolution.archiveDate
      + ' 存在 ' + resolution.candidates.filter((candidate) => candidate.date === resolution.archiveDate).length
      + ' 份：' + resolution.candidates.map((candidate) => candidate.name).join('、')
      + '）——保留一份后重跑；引擎不猜';
  }
  const excluded = resolution.candidates.length > 0
    ? '（归档区同名候选 ' + resolution.candidates.map((candidate) => candidate.name).join('、')
      + ' 的日期均早于本次 change 的创建日期）'
    : '';
  return 'BLOCKED: change 目录缺失（' + activeDisplay + ' 与 .specs/archive/<日期>-' + changeName
    + ' 均不存在）' + excluded
    + '——身份由状态判定（该 change 仍在办），位置解析不到；恢复: 把目录移回 ' + activeDisplay
    + '，或按 <YYYY-MM-DD>-' + changeName + ' 命名放进 .specs/archive/ 后重跑';
}

// ---------- 恢复指引里的「目录在哪」（唯一分叉 · 状态族与门禁族共用） ----------

// 「目录已不在活动位置、而在归档里」的可见形态（恢复指引据此换一种说法）：活动目录在原位 → null；
// 归档区里通过 isArchivedChangeDirName 的条目（同名多份取日期最新的一份）→ 该目录的 .specs/ 形态。
// 只回答「在不在归档、叫什么」，不参与定位写入（定位唯一实现是 resolveChangeDir，它还要套
// createdAt 下界与并列判定）。恢复指引只关心「活动位置空没空」，同步取值即可——出口链上有同步门禁
//（entry 记录门）取用同一份事实，不为一条提示改它的调用约定。
//
// 恢复动作的分叉**只有这一处实现**：活动态给 advance / select，归档态只给「把目录移回活动位置」。
// 四类消费方共用它——出口的转移前置 BLOCK、出口的 entry 记录门、证据门的状态漂移句、状态族的
// next 节点顺序门禁。此前实现落在门禁族（guard-routing），next 侧拿不到就自己拼了一句，于是同一
// 分叉只改了三处、漏了第四处（归档态下 next 推销走不通的 advance / select）。落点因此迁到本模块
// （.specs 路径上下文）：状态族取用这里是允许的 state ← guard 单向边，反向 import 门禁族会把整个
// 守卫图拖进 workflow-state.mjs。运行根是显式参数（状态族 runRootDir()、门禁族 runRoot）——规则
// 不绑定任何一族的运行上下文，与 resolveChangeDir 同一形态。
export function archivedChangeLocationAt(root, changeName) {
  if (!changeName) return null;
  if (existsSync(path.join(root, '.specs', changeName))) return null;
  let entries = [];
  try {
    entries = readdirSync(path.join(root, '.specs', 'archive'));
  } catch {
    return null;
  }
  // 归档日期是 YYYY-MM-DD（字典序 = 时间序），点名最新的一份（多份的真实处置是 resolveChangeDir 的
  // 「排不出就停」，这里只给一句可执行的指引，不复制那套判定）。
  const names = entries.filter((entry) => isArchivedChangeDirName(entry, changeName)).sort();
  if (names.length === 0) return null;
  return '.specs/archive/' + names[names.length - 1];
}

// 恢复动作那一句（与 archivedChangeLocationAt 同一分叉）：活动目录在场时原样返回 activeText（调用方
// 给出的可行动作）；目录已搬进归档时 advance / select 都走不通——select 要求活动目录在场，advance 的
// 产物推导读的也是活动路径，给出去就是让人去做一件做不到的事。此时只给可执行的那一步（把目录移回
// 活动位置），并保留「禁止手改状态机器字段」。
export function recoveryActionTextAt(root, changeName, activeText) {
  const location = archivedChangeLocationAt(root, changeName);
  if (location === null) return activeText;
  return '本 change 的目录已移到归档位置（' + location + '）——恢复动作是把它移回活动位置 '
    + '.specs/' + changeName + '/ 后重跑；禁止手改 state 机器字段';
}

// 声明标记目录解析（活动路径 .specs/<change-id>/.skill-loads/ 优先；归档路径兜底）：规范顺序是
// 「声明 → 记录 → 搬目录 → exit」——搬目录在 exit 前、记录之后；移动后补 record / 补声明仅作
// 兼容 / 恢复路径，标记因此仍须能在 .specs/archive/<日期>-<change-id>/.skill-loads/ 被读到。
// 只查活动路径会把「标记存在」误判成「机制未激活」。归档目录的**定位**（是哪一份、多候选
// 怎么办）走 resolveChangeDir 的唯一实现；本函数只把 .skill-loads/ 追加在解析到的目录之后。协议
// 声明的 archive/*-<change-id> 是产物 glob，目录名约定才是 <日期>-<change-id>（判据见
// isArchivedChangeDirName）。两者皆无 → null，调用方按「一项都没声明」处理。
//
// includeArchive 是这条规则唯一的形态开关，缺省 true（兜底归档）。入口侧（workflow-guard 的
// checkPromptDeclarations）传 false：入口核对的是**这一轮**写下的声明，归档里的声明属于归档前的
// 执行者——拿它替当前节点作证会把「这一轮没声明」判成「声明过」，错路径的声明因此漏过。这个差异
// 是有意的，所以给它一个名字，而不是让调用方另拼一份路径。
//
// 落点在本模块（.specs 路径上下文）：它是一条 change 目录的定位规则，不是某一族的判定——状态命令族与
// 守卫族消费的是同一条规则，各写一份必然在「活动目录是否回溯归档」「多归档目录取哪个」上分叉。
// 运行根是显式参数：两族各注入自己的根（状态族 runRootDir()、守卫族 runRoot），规则因此不绑定任何
// 一族的运行上下文（守卫进程没有 initStateContext 建立的上下文）。依赖方向也由此确定：守卫侧取用本
// 模块是允许的 guard → state-* 单向边；反向（状态族 import 守卫族）会让状态 CLI 为一条路径规则加载
// 整个守卫图。
export async function findSkillLoadsDir(root, changeName, { includeArchive = true } = {}) {
  const activeDir = path.join(root, '.specs', changeName, '.skill-loads');
  if (await fileExists(activeDir)) {
    return { dir: activeDir, display: '.specs/' + changeName + '/.skill-loads/' };
  }
  if (!includeArchive) return null;
  // 归档路径 = 位置解析的结果 + .skill-loads/ —— 目录定位只有 resolveChangeDir 一份实现：标记查找、
  // 命令写入与节点推导必须认同一个目录（否则「标记在 A、产物在 B」）。位置解析到活动目录时本函数
  // 已在上一步返回；解析不出（缺失 / 多候选）→ null（调用方按「一项都没声明」fail-closed，不猜）。
  const resolution = await resolveChangeDir({ root, changeName });
  if (resolution.status !== 'archived') return null;
  const candidate = path.join(resolution.dir, '.skill-loads');
  if (!(await fileExists(candidate))) return null;
  return { dir: candidate, display: resolution.display + '/.skill-loads/' };
}
