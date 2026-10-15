// 状态读写与 .specs 路径上下文（单一归属）：状态文件解析 / 原子写落盘 / 活动 change 解析 /
// change 目录边界，以及各命令族共用的路径锚（runRoot · specsRoot · statePath）。
// 路径锚由入口在分派前初始化一次（runRoot = 进程 cwd）——模块内不自行取 cwd：入口与模块
// 各持一份「运行根」就是同一事实的第二处表达。目录名与状态文件名常量来自 state-schema.mjs。
import { promises as fs } from 'fs';
import path from 'path';
import { validateStateFields, writeJsonAtomic, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME } from '../state-schema.mjs';
import { inspectWorkflowPathSegments } from '../protocol-utils.mjs';
import { isSingleSegmentChangeName } from '../route-node.mjs';

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

export async function findActiveChange() {
  // 1. Read from state file if exists
  if (await fileExists(stateFile())) {
    const state = await readJson(stateFile());
    // completed 检查优先于 activeChange 分支——归档完成态（无论 activeChange 是否残留）
    // 一律不识别为 active（防归档残留目录 / 残留字段误判）
    if (state.status === 'completed') return null;
    if (state.activeChange) {
      const changeDir = path.join(specsDir(), state.activeChange);
      if (await fileExists(changeDir)) return state.activeChange;
    }
  }
  // 2. Scan .specs/ for directories with TASK.md (active flow-kit changes)
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
