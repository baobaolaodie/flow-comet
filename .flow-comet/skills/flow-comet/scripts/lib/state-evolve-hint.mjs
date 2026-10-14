// evolve 到期提示（单一归属）：达阈值才输出，未达阈值零噪音。
import { promises as fs } from 'fs';
import path from 'path';
import { isValidTimestamp, daysSince, isArchivedAfterTimestamp, hasSection9, EVOLVE_STALE_DAYS, EVOLVE_DUE_NEW_ARCHIVE_CHANGES } from '../time-utils.mjs';
import { specsDir } from './state-io.mjs';

// 该时刻之后归档、且 DESIGN.md 带 §9 的 change 数。归档时刻取目录名日期前缀（flow-kit 约定
// archive/<YYYY-MM-DD>-<change-id>，该标签随提交固化、跨 clone 稳定）；「归档于何时」与「§9 是否
// 在场」两个判定都走 time-utils 单一来源——不在本模块内联第二份表达式（单一来源）。
// 读取失败 / 非目录 / 无 DESIGN.md / 无 §9 一律不计入（不误报）。
async function countSection9ArchivesSince(timestamp) {
  const archiveRoot = path.join(specsDir(), 'archive');
  let entries = [];
  try {
    entries = await fs.readdir(archiveRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !isArchivedAfterTimestamp(entry.name, timestamp)) continue;
    let design = '';
    try {
      design = await fs.readFile(path.join(archiveRoot, entry.name, 'DESIGN.md'), 'utf8');
    } catch {
      continue;
    }
    if (hasSection9(design)) count += 1;
  }
  return count;
}

// 到期提示：`last_evolve_at` 距今 > 60 天，或其后新增 ≥ 5 个带 §9 的归档 change → 输出一行；
// 否则**不打印任何行**（反例锚：未达阈值零噪音）。旧 state 无该字段 = 从未跑过 evolve →
// 静默（不强制未接入 evolve 的项目补字段：无基线可判时不制造噪音）。提示行内不含花括号——
// status 的 JSON 块按「首个 { 到末个 }」截取（既有消费方 parseStatusJson 同形）。
export async function printEvolveDueHint(state) {
  const lastEvolveAt = state && typeof state.last_evolve_at === 'string' ? state.last_evolve_at : '';
  if (!isValidTimestamp(lastEvolveAt)) return;
  const elapsedDays = daysSince(lastEvolveAt);
  if (Number.isNaN(elapsedDays)) return;
  const staleByAge = elapsedDays > EVOLVE_STALE_DAYS;
  const newArchives = await countSection9ArchivesSince(lastEvolveAt);
  const staleByCount = newArchives >= EVOLVE_DUE_NEW_ARCHIVE_CHANGES;
  if (!staleByAge && !staleByCount) return;
  const reasons = [];
  if (staleByAge) {
    reasons.push('距今 ' + Math.floor(elapsedDays) + ' 天，超阈值 ' + EVOLVE_STALE_DAYS + ' 天');
  }
  if (staleByCount) {
    reasons.push('其后新增 ' + newArchives + ' 个带 §9 的归档 change，达阈值 ' + EVOLVE_DUE_NEW_ARCHIVE_CHANGES + ' 个');
  }
  console.log('EVOLVE-DUE: 上次架构沉淀 ' + lastEvolveAt + '（' + reasons.join('；')
    + '）——建议显式调用 evolve（/flow-comet-evolve）同步 CONTEXT.md');
}
