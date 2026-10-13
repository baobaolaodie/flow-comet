// intel-scan 双落点一致性（单一归属）：init 侧的形态对齐与漂移可见。
// `last_intel_scan` 是**双落点**字段：引擎 state（机器真相、schema 校验）与 `.specs/CONTEXT.md` 的
// `## intel-scan 元数据` 段（项目可见）。段行的改写——含改写前备份与结构校验——只有 context-scan
// 一条通道一份实现；init 侧因此**不写段**（在第二处复制段行改写判据必然与前者分叉），只承担两条：
//   ① 形态对齐：state 侧取值一律经 time-utils 的 nowTimestamp()（本地时间 + 显式偏移），与
//      context-scan 写入的形态同源；历史 `Z` 形态继续可解析（不迁移）。
//   ② 漂移可见：写完后与段侧取值比对（口径 = **取值词元**，与段行写通道替换的那个词元同口径）——
//      不一致（含**同一时刻的两种形态**、段内取值不可解析）即输出可见提示并点名收敛命令；一致则
//      静默（不误报）；带行尾说明的段行不构成差异（说明由写通道原样保留，不是取值的一部分）。
import { promises as fs } from 'fs';
import { extractContextStructure } from '../context-init.mjs';
import { parseTimestamp } from '../time-utils.mjs';

export const INTEL_SECTION_NAME = 'intel-scan 元数据';
export const INTEL_FIELD_NAME = 'last_intel_scan';

// 段侧取值词元的归一：`extractContextStructure` 返回的是字段行冒号后的**整行剩余文本**
// （取值词元 + 可选的 markdown 引号 + 可选的行尾说明），而段行的写通道 `context-scan` 按
// `INTEL_FIELD_LINE = (…)(\S+)([\s\S]*)` 只替换**首个取值词元**、行尾说明原样保留（首次接入的
// CONTEXT 生成物即「词元 + 说明」形态）。读侧因此必须取同一口径的词元再比对：按整行剩余文本比对时，
// 带说明的段行与 state 永不相等 ⇒ 同刻同形态也恒亮「不一致」、类别退化成「段内取值不是合法时间戳」，
// 提示点名的 `context-scan` 收敛承诺不可达（提示噪声化 = 没人看的行）。
// 空白切分与写侧正则的 `\S+` 同一字符类语义；行结构（段名 / 字段行形态）仍唯一来自
// extractContextStructure——本函数只做「词元 + 引号」归一，不解析段行（单一来源）。
export function normalizeIntelFieldValue(value) {
  return String(value).trim().split(/\s+/)[0].replace(/^`+/, '').replace(/`+$/, '').trim();
}

// 漂移判定（纯函数）：两侧取值不一致时返回差异类别，一致（或任一侧缺席）返回 null（不误报）。
export function intelScanDriftKind(stateValue, sectionValue) {
  if (typeof stateValue !== 'string' || typeof sectionValue !== 'string') return null;
  if (stateValue === sectionValue) return null;
  const atSection = parseTimestamp(sectionValue);
  if (Number.isNaN(atSection)) return '段内取值不是合法时间戳';
  const atState = parseTimestamp(stateValue);
  if (!Number.isNaN(atState) && atState === atSection) return '同刻不同形态';
  return '刻与形态均不一致';
}

// 双落点比对（读盘 + 输出）：段侧文档缺席 / 段或缺字段不在场 = 无可比对面 → 静默（不无中生有）；
// 检出漂移 → 可见提示（stdout，与 INIT-* 提示同族且不阻断 init），点名两侧取值与收敛命令。
export async function reportIntelScanDrift(contextFile, stateValue) {
  let contextText;
  try {
    contextText = await fs.readFile(contextFile, 'utf8');
  } catch {
    return; // 段侧文档不可读 = 无可比对面
  }
  const fields = extractContextStructure(contextText).metadata[INTEL_SECTION_NAME];
  if (!fields || !fields[INTEL_FIELD_NAME]) return; // 段或缺字段不在场 = 无可比对面
  const landed = normalizeIntelFieldValue(fields[INTEL_FIELD_NAME].value);
  const kind = intelScanDriftKind(stateValue, landed);
  if (kind === null) return;
  console.log('INIT-NOTICE: ' + INTEL_FIELD_NAME + ' 双落点不一致（' + kind + '）——引擎 state = '
    + stateValue + '；`.specs/CONTEXT.md` 的 `## ' + INTEL_SECTION_NAME + '` 段 = ' + landed
    + '。本命令只写 state（该段行的写通道是 context-scan）；运行 context-scan 即把两处收敛为'
    + '同刻同形态（冲突时以 state 为准）。');
}
