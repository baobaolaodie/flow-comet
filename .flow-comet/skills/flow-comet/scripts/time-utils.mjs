// time-utils.mjs: 时间形态 / 解析 / 到期阈值的单一权威（单源纪律 · L-067）
//
// 为什么单独成域：时间戳曾散落各脚本以 `new Date().toISOString()` 生成、以字符串拼接消费——
// 同一事实的多个表达在时区面必然分叉（L-096：`date` 读数在 UTC 与 +0800 间抖动，目测判时得出过
// 相反结论）。本模块是「生成 / 解析 / 阈值比较 / 归档窗口判定」的唯一实现：
//   · 生成：本地时间 + 显式偏移 `YYYY-MM-DDTHH:mm:ss±HH:mm`（人读为本地时间、机器可无损解析）
//   · 解析：`Date.parse` + 分量回环校验（兼容历史 `Z` 形态；`2026-02-30` 一类不可自洽形态拒绝）
//   · 阈值：天差比较 + evolve 到期窗口（> 60 天，或该时刻之后新增 ≥ 5 个带 §9 的归档 change）
// 消费方（workflow-state 的 config set / status；evolve 的扫描范围与元数据写入）一律 import 本模块——
// 在其它脚本内联第二份格式化 / 解析表达式即违反单源纪律（守卫按表达式形态扫描，注释互指同源不作数）。
//
// 边界：本模块只管「时间与到期判据」，不做 I/O（不读 state、不扫目录）；调用方负责取字段与遍历文件。

// 时间戳形态：秒级为最小精度，毫秒可选；时区必须是显式 `Z` 或 `±HH:mm`（`+0800` / 裸本地时间 /
// 纯日期一律非法——纯日期无法表达「时刻」，进 state 会让天差判定退化为猜测）。
const TIMESTAMP_SHAPE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
// 归档目录名日期前缀（flow-kit 7-integration 约定：archive/<YYYY-MM-DD>-<change-id>）
const ARCHIVE_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:-|$)/;
// 一天的毫秒数（天差换算与阈值比较的唯一常量，不在调用点重写这个字面量）
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  return new Date(NaN);
}

// 本地时间 + 显式偏移（人读为本地时间、机器可无损解析）。传入 Date 或 epoch 毫秒；非法时间一律抛出
// （fail-closed：不生成可疑时间戳）。
export function formatLocalTimestamp(value = new Date()) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) throw new Error('formatLocalTimestamp: 非法时间值');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
    + 'T' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds())
    + sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60);
}

// 本地日期 `YYYY-MM-DD`（工件名 `<日期>-<KIND>.md` 与日期粒度比较用）。
export function formatLocalDate(value = new Date()) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) throw new Error('formatLocalDate: 非法时间值');
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

// 当前时刻的标准形态（新写入路径统一走本函数，不自行拼接）。
export function nowTimestamp() {
  return formatLocalTimestamp(new Date());
}

// 解析为标准形态或历史 `Z` 形态 → epoch 毫秒；非法（含形态不符、日历不可自洽）→ NaN，不抛。
// 分量回环校验是判别力所在：V8 对 `2026-02-30T00:00:00Z` 会静默滚到 3 月 2 日——只查 Date.parse
// 是否 NaN 会把它当合法值写进 state，到期判定随之失真。
export function parseTimestamp(value) {
  if (typeof value !== 'string') return NaN;
  const text = value.trim();
  const parts = TIMESTAMP_SHAPE.exec(text);
  if (!parts) return NaN;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return NaN;
  const [, year, month, day, hour, minute, second, fraction, zone, sign, offsetHour, offsetMinute] = parts;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) return NaN;
    offsetMinutes = (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === '-' ? -1 : 1);
  }
  const millis = fraction ? Number((fraction + '00').slice(0, 3)) : 0; // `.5` / `.50` / `.500` → 500ms
  // 回环：把 epoch 还原成「书写时区」的墙钟分量，逐项与字面量比对（不一致 = 日历滚动过，如 2026-02-30）
  const wallClock = new Date(ms + offsetMinutes * 60000);
  const written = [Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), millis];
  const restored = [wallClock.getUTCFullYear(), wallClock.getUTCMonth(), wallClock.getUTCDate(),
    wallClock.getUTCHours(), wallClock.getUTCMinutes(), wallClock.getUTCSeconds(), wallClock.getUTCMilliseconds()];
  return written.every((value, index) => value === restored[index]) ? ms : NaN;
}

// 形态与日历均合法 → true。state 字段校验与 config set 写通道共用本判定（fail-closed 单一来源）。
export function isValidTimestamp(value) {
  return !Number.isNaN(parseTimestamp(value));
}

// 距该时刻已过多少天（小数）。reference 缺省 = 现在（epoch 毫秒或可解析时间戳）。
// 非法输入 → NaN（调用方按「不可判」处理，不得据此判到期）。
export function daysSince(timestamp, reference = Date.now()) {
  const at = parseTimestamp(timestamp);
  if (Number.isNaN(at)) return NaN;
  const ref = reference instanceof Date ? reference.getTime() : reference;
  const referenceMs = typeof ref === 'number' && Number.isFinite(ref) ? ref : parseTimestamp(ref);
  if (Number.isNaN(referenceMs)) return NaN;
  return (referenceMs - at) / MS_PER_DAY;
}

// 归档目录名 → 归档日期 `YYYY-MM-DD`；非约定命名或日期不可自洽 → null。
// 取目录名而非 mtime：目录名随提交固化（跨 clone / checkout 稳定），mtime 会被检出重写——
// 用 mtime 判「归档于何时」在全新检出上会把整仓历史当成新增（L-096 的「mtime 判时」用于
// 判活场景，归档窗口判据需要的是**随工件固化的时刻标签**）。
export function archiveDateFromName(dirName) {
  if (typeof dirName !== 'string') return null;
  const parts = ARCHIVE_DATE_PREFIX.exec(dirName.trim());
  if (!parts) return null;
  return isValidTimestamp(parts[1] + 'T00:00:00Z') ? parts[1] : null;
}

// 「该归档 change 在该时刻之后归档」判定：日期粒度、严格在其后（与 flow-kit A-evolve
// 「只扫该日期之后归档的 change」同源）。任一输入不可判 → false（不放行 → 不误报新）。
export function isArchivedAfterTimestamp(dirName, timestamp) {
  const archiveDate = archiveDateFromName(dirName);
  const at = parseTimestamp(timestamp);
  if (archiveDate === null || Number.isNaN(at)) return false;
  return archiveDate > formatLocalDate(new Date(at));
}

// 到期阈值（与 flow-kit A-evolve / 7-integration 的「约 60 天后，或新增 ≥ 5 个有 §9 内容的
// change 之后」同值）。两个常量是 status 到期提示与 evolve 技能文本的共同来源。
export const EVOLVE_STALE_DAYS = 60;
export const EVOLVE_DUE_NEW_ARCHIVE_CHANGES = 5;

// ---------- 到期窗口的输入面：§9 沉淀段在场判定 ----------
// 为什么在「时间」模块里：AC-18 的到期判据 = 时间阈值 + 窗口内「带 §9 的归档 change」计数——两者
// 同为**到期窗口判据**的组成部分。若 §9 在场判定在 status 提示与 evolve 扫描各写一份，两个消费面
// 会各自漂移（L-067：注释互指同源不是同步机制），故由本模块唯一表达，消费方 import。
// 上游锚 = flow-kit 7-integration 的 `grep -c '^### 9\.' DESIGN.md`；本仓归档 DESIGN.md 用
// `## 9.` 形态，故层级放宽到 2~4 并容忍 `§9` 写法。只作「有无」判定，不解析条目内容。
const SECTION9_HEADING = /^#{2,4}\s*§?\s*9\s*[.、·]/m;

export function hasSection9(text) {
  return typeof text === 'string' && SECTION9_HEADING.test(text);
}
