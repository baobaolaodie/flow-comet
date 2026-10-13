/**
 * installer-migrate.mjs — 运行时文件位置迁移 + 路径存在性探测原语（prepare-env 的逻辑层模块）
 *
 * 为什么这两件事同处一个模块：迁移的白名单枚举与三处调用方（迁移自身 / .gitignore 纳管 /
 * 生成物镜像的定向清理）共用同一条「该路径确实不存在」判定——ENOENT 与 ENOTDIR 算不存在，
 * 访问类故障（EACCES / EPERM / EIO）必须原样抛出。这条语义若在调用方各写一份必然分叉：
 * 一旦把访问故障当成「文件不存在」，迁移会静默跳过（用户以为已迁移）、.gitignore 会被按
 * 空内容截断覆盖——都是静默的数据丢失。故它只有一份实现（本模块导出，调用方一律 import）。
 *
 * 依赖方向：本模块是叶子（只依赖 node 内置模块）；installer-cleanup 与 installer-hooks 依赖它。
 */
import fs from 'node:fs';
import path from 'node:path';

// ---------- 运行时文件位置迁移（旧命名空间 .comet/ → 新命名空间 .flow-comet/） ----------
//
// 【过渡性模块——有明确退役条件，不是永久耦合】
// 本模块存在的唯一理由：让已安装项目把状态文件从旧命名空间搬到新命名空间，避免破坏性变更
// 导致用户进行中的流程状态丢失。它**只在安装/升级时执行一次**，从不进入任何日常运行路径
// （写入守卫、工作流脚本、协议解析均已完全不含对旧命名空间的感知）。
//
// 因此这里的 `.comet` 字面量是**迁移源**，不是 flow-comet 的命名归属——它标记的是"要从哪里
// 搬走"，而非"我们是谁"。这是任何破坏性变更都需要的过渡桥（同"改名迁移脚本必须知道旧表名"）。
//
// **退役条件**（满足任一即可整体删除本模块及其常量）：
//   ① 下一个破坏性版本发布时——迁移公告期结束（建议至少覆盖一个完整的 minor 周期，让下游
//      项目有时间升级）；
//   ② 或：连续多次安装运行中迁移报告**全部为「已跳过」**（说明已知项目均已迁移完毕）。
// 判据取证：每次安装都会打印迁移明细（已迁移 / 已跳过）；长期全为「已跳过」即为退役信号。
//
// 位置迁移白名单（单一来源）：目标项目的 `.comet/` 是三方共占目录——flow-comet 运行时文件
// + Comet 资产（`runs/`、`config.yaml` 等）+ 用户自有文件（`*.bak-*` 等）。只有下表列出的
// 文件属 flow-comet 运行时域，其余一律原位不动（不搬迁、不删除、不改写）——整目录搬迁或
// 前缀正则匹配都会越界处置非 flow-comet 资产。新增运行时文件时必须同步本表。
const LEGACY_RUNTIME_DIR = '.comet';
export const RUNTIME_DIR = '.flow-comet';
const RUNTIME_FILE_MIGRATIONS = [
  { name: 'flow-comet-state.json', validateJson: true },
];
/**
 * readdir（withFileTypes）：仅「该路径确实不存在」返回 null——判定与 lstatIfExists 同口径
 * （见 isMissingPathError：只有 ENOENT / ENOTDIR 算不存在，访问类故障原样抛出）。
 * 供镜像清理复用：把「目录不可枚举」与「目录为空」两个分支分开，避免清理判定深嵌 try/catch。
 */
export function readdirIfExists(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissingPathError(err)) return null;
    throw err;
  }
}
/**
 * 「该路径确实不存在」一类错误的单一判定（迁移探测与 gitignore 纳管共用同一判据——
 * 同一语义只有一处实现，改一处即全改，不会分叉）：
 *   - ENOENT：路径缺失；
 *   - ENOTDIR：路径中某一段不是目录——该路径不可能存在为文件（跨平台等价于「不存在」：
 *     同一形态在 Windows 报 ENOENT、在 POSIX 报 ENOTDIR）。
 * 其余错误（EACCES / EPERM / EIO 等访问类故障）**不算**「不存在」——把访问故障当成
 * 「文件不存在」会让调用方按空内容继续（迁移静默跳过 / gitignore 被截断覆盖），
 * 都是静默的数据丢失风险，必须原样抛出并中止。
 */
export function isMissingPathError(err) {
  return Boolean(err) && typeof err === 'object' && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
}

/**
 * lstat 探测：返回 stat 或 null（**不跟随符号链接**——isSymbolicLink() 判定依赖 lstat）。
 * 只有「该路径确实不存在」一类错误返回 null（判定见 isMissingPathError）；其余错误原样抛出——
 * 迁移静默跳过会让安装照常继续并报告「已跳过：旧位置不存在」，用户的旧状态却永远留在旧位置
 * （用户以为已迁移）。
 */
export function lstatIfExists(target) {
  try {
    return fs.lstatSync(target);
  } catch (err) {
    if (isMissingPathError(err)) {
      return null;
    }
    throw err;
  }
}
/** 迁移备份文件名时间戳（ISO 串里的 `:` 与 `.` 在 Windows 文件名中非法——统一替换为 `-`）。 */
function migrationTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** 逐字节读回并比较；读取失败一律视为不一致（调用方按校验失败处置）。 */
function fileEqualsBytes(filePath, bytes) {
  try {
    return fs.readFileSync(filePath).equals(bytes);
  } catch {
    return false;
  }
}

/**
 * 迁移前置校验：旧件不存在 → 返回 null（无需迁移）；命中边界情形 → 抛错中止（不返回字节）。
 * 三种边界一律不静默覆盖或丢弃：
 *   - 旧件是符号链接 → 不跟随（防穿越到项目外），报错并给人工处置指引
 *   - 新旧位置并存 → 不覆盖任何一方，报错并列出两处路径供人工判断
 *   - 内容损坏（validateJson 条目）→ 保留原件未改动，报错并给修复指引
 */
function readMigratableRuntimeFile(oldPath, newPath, entry) {
  const oldStat = lstatIfExists(oldPath);
  if (!oldStat) return null;
  if (oldStat.isSymbolicLink()) {
    let linkTarget = '(读取失败)';
    try {
      linkTarget = fs.readlinkSync(oldPath);
    } catch {
      /* 链接目标读取失败不改变处置（同样中止） */
    }
    throw new Error(
      `${oldPath} 是符号链接（指向 ${linkTarget}）——不跟随链接搬移（避免穿越到项目外）。` +
        `请人工确认后处理：把真实文件复制到 ${newPath}（保留本链接），或删除该链接后重跑安装器。`
    );
  }
  if (lstatIfExists(newPath)) {
    throw new Error(
      `新旧位置同时存在该运行时文件，不覆盖任何一方：\n  - 旧位置: ${oldPath}\n  - 新位置: ${newPath}\n` +
        `请人工比对两处内容，保留正确的一份（删除或改名另一份）后重跑安装器。`
    );
  }
  let bytes;
  try {
    bytes = fs.readFileSync(oldPath);
  } catch (err) {
    throw new Error(`${oldPath} 读取失败（${err.message}）——未做任何改动，中止迁移。请检查文件权限后重跑安装器。`);
  }
  if (entry.validateJson) {
    let parsed = null;
    try {
      // 校验容忍 UTF-8 BOM（与运行时判定一致：workflow-state.mjs 的 readJson 明确容忍 BOM，
      // 外部写入如会话 Write 可能带 BOM）——否则运行时读得动的状态文件会被迁移判为损坏而
      // 中止安装（同一份数据两处判定不一致）。strip 只作用于校验：备份与落盘始终写原始字节
      // bytes，绝不改写用户数据（BOM strip 用字面形态——与 workflow-state.mjs 的 readJson 同形，
      // 行为由场景 234 端到端锚定：若该字符被剥离会立即变红）。
      parsed = JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''));
    } catch (err) {
      throw new Error(
        `${oldPath} 内容不是合法 JSON（${err.message}）——保留原件未改动，中止迁移。` +
          `请修复该文件（或从备份恢复）后重跑安装器。`
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${oldPath} 顶层不是 JSON 对象——保留原件未改动，中止迁移。请修复该文件后重跑安装器。`);
    }
  }
  return bytes;
}

/**
 * 搬移落盘（写成功才删旧件）：建目标目录 → 复制备份 → 逐字节校验备份 → 写新位置 →
 * 回读校验新位置 → 删旧件。任一环节失败都抛错，且**旧件与备份至少保留一份**（不丢数据）。
 */
function writeRuntimeFileWithBackup(oldPath, newPath, backupPath, bytes) {
  const targetDir = path.dirname(newPath);
  const keepNote = `旧文件完整保留于 ${oldPath}`;
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `无法建立迁移目标目录 ${targetDir}（${err.message}）——${keepNote}，未做任何改动。` +
        `请确认该路径未被普通文件占用且可写后重跑安装器。`
    );
  }
  try {
    fs.copyFileSync(oldPath, backupPath);
  } catch (err) {
    throw new Error(
      `生成迁移前备份失败（${backupPath}：${err.message}）——${keepNote}，未做任何改动。` +
        `请解除目标目录的写入限制后重跑安装器。`
    );
  }
  if (!fileEqualsBytes(backupPath, bytes)) {
    throw new Error(`备份逐字节校验失败（${backupPath} 与源文件不一致）——${keepNote}，中止迁移。请重跑安装器。`);
  }
  try {
    fs.writeFileSync(newPath, bytes);
  } catch (err) {
    throw new Error(
      `写入新位置失败（${newPath}：${err.message}）——${keepNote}，备份保留于 ${backupPath}。` +
        `请解除该路径的写入限制后重跑安装器。`
    );
  }
  if (!fileEqualsBytes(newPath, bytes)) {
    throw new Error(
      `新位置回读校验失败（${newPath} 与源文件不一致）——${keepNote}，备份保留于 ${backupPath}，中止迁移。请人工检查后重跑安装器。`
    );
  }
  fs.rmSync(oldPath, { force: true });
}

/**
 * 编排单个白名单文件的位置迁移（前置校验 → 备份 → 写 → 回读校验 → 删旧件）；
 * 无需迁移时把跳过说明记入 report（调用方统一打印）。
 */
function migrateRuntimeFile(target, entry, report) {
  const oldRel = path.join(LEGACY_RUNTIME_DIR, entry.name);
  const newRel = path.join(RUNTIME_DIR, entry.name);
  const oldPath = path.join(target, oldRel);
  const newPath = path.join(target, newRel);
  const bytes = readMigratableRuntimeFile(oldPath, newPath, entry);
  if (!bytes) {
    report.skipped.push(`${oldRel} 不存在——无需迁移`);
    return;
  }
  const backupRel = path.join(RUNTIME_DIR, `${entry.name}.bak-${migrationTimestamp()}`);
  writeRuntimeFileWithBackup(oldPath, newPath, path.join(target, backupRel), bytes);
  report.migrated.push(`${oldRel} → ${newRel}（迁移前备份: ${backupRel}）`);
}

/**
 * 运行时文件位置迁移总入口：按 RUNTIME_FILE_MIGRATIONS 白名单逐个执行（白名单之外的内容
 * 一律原位不动——目标项目 `.comet/` 三方共占），打印迁移/跳过报告；任一文件失败即抛错中止
 * （旧件与备份保留，可重跑自愈）。
 */
export function migrateRuntimeFiles(target) {
  const report = { migrated: [], skipped: [] };
  for (const entry of RUNTIME_FILE_MIGRATIONS) {
    migrateRuntimeFile(target, entry, report);
  }
  console.log(`[flow-comet] 运行时文件迁移（${LEGACY_RUNTIME_DIR}/ → ${RUNTIME_DIR}/;白名单 ${RUNTIME_FILE_MIGRATIONS.length} 项）：`);
  for (const line of report.migrated) {
    console.log(`  - 已迁移: ${line}`);
  }
  for (const line of report.skipped) {
    console.log(`  - 已跳过: ${line}`);
  }
  if (report.migrated.length > 0) {
    console.log('  （迁移前备份保留在新位置，确认无误后可自行清理）');
  } else {
    console.log('  （全部跳过 = 本项目的状态已在当前命名空间，安装器不再需要触碰旧目录）');
  }
}
