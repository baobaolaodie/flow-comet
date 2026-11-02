// ac-coverage.mjs — AC 覆盖判定（纯判定：无 console、无 process.exit、无写盘）。
//
// 语义：REQUIREMENT.md 的「验收准则」段声明本 change 的验收准则（AC-N）；TEST.md 的「1.1 测试矩阵
// （AC → 用例）」段是这些准则的用例映射（测试阶段派生用例的唯一来源）。覆盖判定 = 每条 AC 编号都在
// 1.1 段文本里出现过（存在级：只保证「写了」，不保证「测得对」——后者属内容语义，由 review 的人看）。
//
// 段名不在这里写死（模板权威单链，L-067）：两个段的正则都从骨架模块派生——
//   · 验收段：骨架的 H2 段名表里按关键词选段（与 open 出口的命名段选取同一惯用法），不自写
//     「## 验收准则」一类正则；
//   · 1.1 矩阵段：骨架的结构子段（登记名「1.1 测试矩阵（AC → 用例）」）给出的 headingPattern——
//     编号前缀 / 尾部括号可选、大小写不敏感，因此「### 测试矩阵」这类省编号写法同样命中，
//     而换成无关标题不会命中（不是标题巧合）。
// 骨架不可派生（模板整份缺席）⇒ 段无从定位 ⇒ 返回不可判：调用方打印「未校验」，既不判红，也不把
// 「判不了」冒充成「全覆盖」。
//
// 词法：AC-<数字>，大小写不敏感；AC-1a 归并到 AC-1（后缀不参与编号），AC-01 与 AC-1 归一为同一编号；
// 同一行多个编号全部收集；编号按 REQUIREMENT 里的出现顺序（首见）去重——报告顺序因此与台账顺序
// 一致，便于逐条对照。
//
// 分级（新 change BLOCK / 旧 change WARN、review 出口只汇总）不在这里判：本模块只产出判定结果与
// 报文文本，console / exit 只在门禁层（与「纯判定 + 门禁编排」的既有分层一致）。
import { promises as fs } from 'fs';
import path from 'path';
import { buildSkeleton } from './guard-artifact-skeleton.mjs';

// 验收段的关键词（与骨架模块登记的回退段名同一词汇：验收准则 / 验收标准 / AC / Acceptance Criteria）。
// 只用于在骨架给出的**模板段名**里选段——选的仍是模板段名与它的派生正则，不是自造段名。
const ACCEPTANCE_SECTION_KEYWORDS = ['验收', 'AC', 'Acceptance'];
// 1.1 矩阵段在骨架结构子段里的识别词（登记名归一后仍是「测试矩阵」）。
const TEST_MATRIX_SECTION_KEYWORD = '测试矩阵';
// AC 编号词法：只认 AC-<数字>；后缀（如 AC-1a 的 a）不参与编号，前导零同样归一到数字值。
const AC_TOKEN_RE = /AC-(\d+)/giu;

// 文本归一（BOM / 行尾）：段定位与编号解析共用同一口径——行尾差异是检出的噪音。
function normalizeText(text) {
  return String(text ?? '').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
}

// 读文件：读不到（缺席 / 无权限）一律 null——「无从判断」由调用方按「未校验」处理，不在这里吞成空串
// （空串会被读成「段在场但没有编号」）。
async function readText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

// 段正文切片：首个命中标题行之后、下一个同级或更高级标题（或文末）之前的文本；段缺席 → null。
// 只认行首 ATX 标题（与骨架模块的标题提取同一锚定口径）——正文里「引用段名」不劫持匹配。
// level = 2 时下一行 `##` / `#` 收尾；level = 3 时 `###` / `##` / `#` 收尾。
// 围栏代码块内的标题行不算段边界：段里贴一段示例（围栏内的 `## …`）时，段被提前截断会**少读后面的
// AC 编号**——那正是本判据的输入，静默少读只会把「没覆盖」读成「覆盖了」（假绿），故按行同步围栏状态
// （与 LESSONS 扫描段体同一纪律；本处按正则 + 任意层级切段，契约与那处不同，不合并实现）。
function sectionBody(text, pattern, level) {
  const lines = normalizeText(text).split('\n');
  const start = lines.findIndex((line) => pattern.test(line));
  if (start === -1) return null;
  const stop = new RegExp('^#{1,' + level + '}\\s', 'u');
  const body = [];
  let inFence = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*(?:```|~~~)/u.test(lines[index])) inFence = !inFence;
    if (!inFence && stop.test(lines[index])) break;
    body.push(lines[index]);
  }
  return body.join('\n');
}

// 验收段的正则：模板段名表里按关键词选段；模板不可派生 → null（不可判）。
async function acceptanceSectionPattern() {
  const skeleton = await buildSkeleton('REQUIREMENT');
  if (!skeleton.derived) return null;
  const section = skeleton.sections
    .find((entry) => ACCEPTANCE_SECTION_KEYWORDS.some((keyword) => entry.name.includes(keyword)));
  return section === undefined ? null : section.pattern;
}

// 1.1 矩阵段的正则：骨架结构子段的登记名 → headingPattern（宽窄写法同一实现）；不可判 → null。
async function testMatrixSectionPattern() {
  const skeleton = await buildSkeleton('TEST');
  if (!skeleton.derived) return null;
  const subsection = (skeleton.structureSubsections ?? [])
    .find((entry) => entry.norm.includes(TEST_MATRIX_SECTION_KEYWORD));
  return subsection === undefined ? null : subsection.pattern;
}

// 段文本 → AC 编号（规范形态 AC-<n>，按首见顺序去重）。
export function parseAcIds(body) {
  const ids = [];
  const seen = new Set();
  for (const matched of normalizeText(body).matchAll(AC_TOKEN_RE)) {
    const id = 'AC-' + String(Number(matched[1]));
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

// 「判不了」的唯一形态：reason 是机器可读的短句，notice 是给人读的一行。两种调用方（verify 出口 /
// review 出口）打印同一份 notice——同一事实两处措辞必然先漂移。
const UNVERIFIED_EXPLANATIONS = {
  'REQUIREMENT 缺席': '该 change 没有 REQUIREMENT.md，验收准则无从读取',
  'REQUIREMENT 无 AC 编号': '验收准则段内没有任何 AC-N 编号（没有编号就没有可对账的清单）',
  '模板缺席（段名无从派生）': '模板不可派生，验收段 / 1.1 矩阵段的段名无从定位',
  'TEST.md 缺席': '该 change 尚无 TEST.md，1.1 测试矩阵无从读取',
  'TEST.md 无 1.1 测试矩阵段': 'TEST.md 在场但缺 1.1 测试矩阵段（登记名「1.1 测试矩阵（AC → 用例）」）',
};

function unverifiable(reason) {
  const explanation = UNVERIFIED_EXPLANATIONS[reason] ?? reason;
  return {
    acIds: [],
    missing: [],
    unverified: {
      reason,
      notice: '未校验（' + reason + '）——' + explanation + '；AC 覆盖判据跳过（未验证 ≠ 通过）',
    },
  };
}

// 判定：返回 { acIds, missing, unverified }。
//   · acIds    = REQUIREMENT 验收段内的编号（有序去重）；
//   · missing  = 这些编号里未出现在 1.1 矩阵段文本中的（同样按 REQUIREMENT 顺序）；
//   · unverified = null 表示判据真的判过；非 null 表示判不了（附人读 notice，调用方按「未校验」打印）。
// 顺序固定：先判「有没有编号」（没有编号就没有可对账的清单），再判「矩阵能不能读」——两个「未校验」
// 因此不会互相遮蔽，报文说的是真正卡住的那一环。
export async function acCoverageReview(changeDir) {
  const requirementText = await readText(path.join(changeDir, 'REQUIREMENT.md'));
  if (requirementText === null) return unverifiable('REQUIREMENT 缺席');
  const acceptancePattern = await acceptanceSectionPattern();
  if (acceptancePattern === null) return unverifiable('模板缺席（段名无从派生）');
  const acceptanceBody = sectionBody(requirementText, acceptancePattern, 2);
  const acIds = acceptanceBody === null ? [] : parseAcIds(acceptanceBody);
  if (acIds.length === 0) return unverifiable('REQUIREMENT 无 AC 编号');
  const testText = await readText(path.join(changeDir, 'TEST.md'));
  if (testText === null) return unverifiable('TEST.md 缺席');
  const matrixPattern = await testMatrixSectionPattern();
  if (matrixPattern === null) return unverifiable('模板缺席（段名无从派生）');
  const matrixBody = sectionBody(testText, matrixPattern, 3);
  if (matrixBody === null) return unverifiable('TEST.md 无 1.1 测试矩阵段');
  const covered = new Set(parseAcIds(matrixBody));
  return { acIds, missing: acIds.filter((id) => !covered.has(id)), unverified: null };
}

// verify 出口的报文（BLOCKED / WARN 同一文本，只换分级前缀与末尾的分级说明）：首行点名缺失编号，
// 第二行给可执行的恢复出路（在 1.1 矩阵补行）——两条出路只有一条（覆盖是矩阵行的事，没有第二种写法）。
export function acCoverageReportLines({ coverage, level = 'BLOCKED' }) {
  const blocking = level === 'BLOCKED';
  return [
    (blocking ? 'BLOCKED: ' : 'WARN: ')
      + 'TEST.md 的 1.1 测试矩阵缺 AC 覆盖: ' + coverage.missing.join('、')
      + '——REQUIREMENT.md 的验收准则共 ' + coverage.acIds.length
      + ' 条，上述编号在 1.1 矩阵里没有对应行（AC 是测试阶段派生用例的唯一来源，每条都要有行）'
      + (blocking ? '' : '（旧 change 渐进不阻断）'),
    '恢复: 在 TEST.md 的 1.1 测试矩阵为这些 AC 补行（每条一行：| ' + (coverage.missing[0] ?? 'AC-N')
      + ' | 类型 | 用例文件 / UAT | 状态 |），补完重试 exit verify',
  ];
}

// review 出口的汇总：一条（不逐条刷屏）、不阻断、不改退出码——review 出口今天不要求 TEST.md，
// 这里只把「测试矩阵漏了谁」提前摆到审查者眼前；权威判定在 verify 出口。
export function acCoverageSummaryLine({ coverage }) {
  return 'REVIEW WARN: TEST.md 的 1.1 测试矩阵缺 AC 覆盖: ' + coverage.missing.join('、')
    + '——REQUIREMENT.md 的验收准则共 ' + coverage.acIds.length
    + ' 条（verify 出口会据此 BLOCK；本出口只汇总提示，不影响退出码）';
}
