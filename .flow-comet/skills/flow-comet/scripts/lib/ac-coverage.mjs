// ac-coverage.mjs — AC 覆盖判定（纯判定：无 console、无 process.exit、无写盘）。
//
// 语义：REQUIREMENT.md 的「验收准则」段声明本 change 的验收准则（AC-N）；TEST.md 的「1.1 测试矩阵
// （AC → 用例）」段是这些准则的用例映射（测试阶段派生用例的唯一来源）。覆盖判定 = 每条 AC 编号都在
// 1.1 段文本里出现过（存在级：只保证「写了」，不保证「测得对」——后者属内容语义，由 review 的人看）。
//
// 段名不在这里写死（模板权威单链，L-067）：三个段的定位全部走 guard-routing 的选段入口
// （templateSectionPatterns().pick 与同一份选段规则的另一入口 pickTemplateSection）——本模块不再自己遍历
// 骨架段名表找关键词：
//   · 验收段：'requirement' 的 H2 段名里选段，与 **open 出口的验收段判据同一调用**（同一关键词、
//     同一回退基准），因此「入口说缺段 / verify 说未校验」这类两处两判不再可能发生；
//   · 第 1 轮段：'TEST' 的 H2 段名里按关键词选段——它是 1.1 矩阵的**承载段**（见下方二分）；
//   · 1.1 矩阵段：'TEST' 的结构子段（登记名「1.1 测试矩阵（AC → 用例）」）给出的 headingPattern——
//     编号前缀 / 尾部括号可选、大小写不敏感，因此「### 测试矩阵」这类省编号写法同样命中，
//     而换成无关标题不会命中（不是标题巧合）。
//
// 「判不了」按成因二分——本节是**本仓结构判据的唯一形态**（波次判据 wave-projection.mjs 与它同形，
// 第三个结构判据照抄这组字段即可，不必再选一次）：
//   { unverified: { reason, notice } | null, unjudgeable: { reason, explanation, recovery } | null, ... }
//   留下的理由：载荷跟着分类走（notice 可直接打印；explanation + recovery 是「解释 + 出路」两半），
//   调用方按字段出现与否分级、不必按 reason 反查第二张表；与之相对的 { judgeable, reason } 形态把
//   「能否判定」和「成因」压进一个字符串，调用方只能从取值反推分级。
//   · **载体缺席**——REQUIREMENT.md / TEST.md 不在、模板整份缺席（段名无从派生）、承载段不在
//     （REQUIREMENT 无验收准则段 / TEST.md 无第 1 轮段）⇒ 判据没有可判对象，调用方打印「未校验」
//     并放行，不改退出码；
//   · **工件内容不可判**——承载段在场而清单读不出（验收段里没有任何 AC-N 编号；第 1 轮段里没有
//     1.1 矩阵段，即「整段 N/A」）⇒ 不是「判过且通过」，调用方按既有分级：新 change BLOCKED /
//     旧 change WARN（WARN 行进入既有 WARN COUNT）。
//
// 词法：AC-<数字>，大小写不敏感；AC-1a 归并到 AC-1（后缀不参与编号），AC-01 与 AC-1 归一为同一编号；
// 同一行多个编号全部收集；编号按 REQUIREMENT 里的出现顺序（首见）去重——报告顺序因此与台账顺序
// 一致，便于逐条对照。
//
// 分级（新 change BLOCK / 旧 change WARN、review 出口只汇总）不在这里判：本模块只产出判定结果与
// 报文文本，console / exit 只在门禁层（与「纯判定 + 门禁编排」的既有分层一致）。
import { promises as fs } from 'fs';
import path from 'path';
import {
  TEMPLATE_FALLBACK_SECTION_PATTERNS,
  TEMPLATE_SECTION_SKIP,
  pickTemplateSection,
  templateSectionPatterns,
  templateSectionPattern,
} from './guard-routing.mjs';

// 验收段的关键词：与 open 出口的验收段判据**同一个列表**（'验收'）。此处刻意不把 AC / Acceptance
// 加进来——它们已由回退基准（TEMPLATE_FALLBACK_SECTION_PATTERNS.requirementAcceptance）覆盖，
// 而多加一个关键词会让入口与 verify 出口对同一份模板选出不同的段。
const ACCEPTANCE_SECTION_KEYWORDS = ['验收'];
// 第 1 轮段与 1.1 矩阵段的关键词（前者是后者的承载段，两者都从模板派生）。
const TEST_ROUND_SECTION_KEYWORDS = ['第 1 轮'];
const TEST_MATRIX_SECTION_KEYWORDS = ['测试矩阵'];
// 关键词全不命中时的回退基准（模板在场却把段名换成了别的说法——上游改标题措辞是常见形态）。
// 1.1 矩阵的回退取段名派生（headingPattern：编号前缀 / 尾部括号可选），不另写标题正则；第 1 轮段的
// 落地标题带分隔符与子标题（「第 1 轮 · 功能测试」/「第 1 轮：功能测试」写法不一），故按段名前缀
// 锚定行首——与 TEMPLATE_FALLBACK_SECTION_PATTERNS 里的同类回退同一形态（部分匹配而非整名匹配）。
const TEST_ROUND_FALLBACK_PATTERN = /^##\s*第\s*1\s*轮/mu;
const TEST_MATRIX_FALLBACK_PATTERN = templateSectionPattern('测试矩阵', 3);
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

// 三个段的正则全部经 guard-routing 的选段入口派生（返回值可能是 TEMPLATE_SECTION_SKIP：模板整份
// 缺席 ⇒ 该段名无从派生 ⇒ 调用方按「载体缺席」打印未校验，而不是拿一个猜的段名去判）。
// 验收段走 templateSectionPatterns().pick——与 open 出口的验收段判据同一调用形态；TEST 的两个段走
// pickTemplateSection（pick 的键只覆盖四个 H2 模板，TEST 与结构子段不在其内，选段规则仍是同一份
// pickByKeywords）。
async function acceptanceSectionPattern() {
  const patterns = await templateSectionPatterns();
  return patterns.pick(
    'requirement', ACCEPTANCE_SECTION_KEYWORDS, TEMPLATE_FALLBACK_SECTION_PATTERNS.requirementAcceptance);
}

function testRoundSectionPattern() {
  return pickTemplateSection('TEST', {
    keywords: TEST_ROUND_SECTION_KEYWORDS,
    fallback: TEST_ROUND_FALLBACK_PATTERN,
    level: 2,
  });
}

function testMatrixSectionPattern() {
  return pickTemplateSection('TEST', {
    keywords: TEST_MATRIX_SECTION_KEYWORDS,
    fallback: TEST_MATRIX_FALLBACK_PATTERN,
    level: 3,
  });
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

// 「载体缺席」这一支的每种成因各有一份解释，notice 由它派生（reason 是机器可读的短句）——两种调用方
// （verify 出口 / review 出口）打印同一份文本，同一事实两处措辞必然先漂移。
const UNVERIFIED_EXPLANATIONS = {
  'REQUIREMENT 缺席': '该 change 没有 REQUIREMENT.md，验收准则无从读取',
  'REQUIREMENT 无验收准则段': 'REQUIREMENT.md 在场，但段名（模板派生 + 回退基准）都定位不到验收准则段',
  '模板缺席（段名无从派生）': '模板不可派生，验收段 / 1.1 矩阵段的段名无从定位',
  'TEST.md 缺席': '该 change 尚无 TEST.md，1.1 测试矩阵无从读取',
  'TEST.md 无第 1 轮段': 'TEST.md 在场，但段名定位不到 1.1 测试矩阵的承载段（第 1 轮 · 功能测试）',
};

// 「工件内容不可判」的两种成因：承载段在场、清单读不出。每条成因自带**解释 + 恢复出路**（同一件事的
// 两半写在一处：只有解释没有出路，人只能猜下一步；只有出路没有解释，人不知道该改哪一环）。恢复指引
// 必须能照做——第一支的出路是给编号，第二支的出路是在第 1 轮里补矩阵段（「把 N/A 改成通过」不是
// 出路：没有矩阵就仍无从对账）。
const UNJUDGEABLE_CAUSES = {
  'REQUIREMENT 无 AC 编号': {
    explanation: 'REQUIREMENT.md 有验收准则段却没有 AC-N 编号——没有编号就没有可对账的清单',
    recovery: '给验收准则的每条准则编号（形如 AC-1、AC-2 …，编号写在标题或列表项里均可），编号后重试 exit verify',
  },
  'TEST.md 第 1 轮无 1.1 测试矩阵段': {
    explanation: 'TEST.md 的第 1 轮段在场，但段内没有 1.1 测试矩阵段（整段写 N/A 就是这一形态）'
      + '——AC 与用例的映射读不出来',
    recovery: '在 TEST.md 的第 1 轮内补 1.1 测试矩阵段（每条 AC 一行：| AC-N | 类型 | 用例文件 / UAT | 状态 |），'
      + '补完重试 exit verify；整段写 N/A 不构成测试矩阵',
  },
};

// 判不了时返回的判定结果形态：两个成因字段互斥，调用方按「载体缺席 → 未校验放行」/「内容不可判 →
// 按 change 新旧分级」两支处置。
function unverifiable(reason) {
  const explanation = UNVERIFIED_EXPLANATIONS[reason] ?? reason;
  return {
    acIds: [],
    missing: [],
    unverified: {
      reason,
      notice: '未校验（' + reason + '）——' + explanation + '；AC 覆盖判据跳过（未验证 ≠ 通过）',
    },
    unjudgeable: null,
  };
}

// 不可判的成因与文本在同一处产出（判定结果自带解释与恢复出路）：调用方只打印，不再按 reason 去查
// 第二张表——两张按同一个 key 索引的表只要有人漏改一张，报文就会一半新一半旧。
function unjudgeable(reason) {
  const cause = UNJUDGEABLE_CAUSES[reason] ?? {
    explanation: reason,
    recovery: '按模板补齐该段后重试 exit verify',
  };
  return {
    acIds: [],
    missing: [],
    unverified: null,
    unjudgeable: { reason, explanation: cause.explanation, recovery: cause.recovery },
  };
}

// 判定：返回 { acIds, missing, unverified, unjudgeable }。
//   · acIds    = REQUIREMENT 验收段内的编号（有序去重）；
//   · missing  = 这些编号里未出现在 1.1 矩阵段文本中的（同样按 REQUIREMENT 顺序）；
//   · unverified / unjudgeable = 非 null 表示没判成：前者是载体缺席（放行），后者是工件内容不可判
//     （按 change 新旧分级）；两者都为 null 才表示判据真的判过。
// 顺序固定：先判「有没有编号」（没有编号就没有可对账的清单），再判「矩阵能不能读」——两级「判不了」
// 因此不会互相遮蔽，报文说的是真正卡住的那一环。
export async function acCoverageReview(changeDir) {
  const requirementText = await readText(path.join(changeDir, 'REQUIREMENT.md'));
  if (requirementText === null) return unverifiable('REQUIREMENT 缺席');
  const acceptancePattern = await acceptanceSectionPattern();
  if (acceptancePattern === TEMPLATE_SECTION_SKIP) return unverifiable('模板缺席（段名无从派生）');
  const acceptanceBody = sectionBody(requirementText, acceptancePattern, 2);
  if (acceptanceBody === null) return unverifiable('REQUIREMENT 无验收准则段');
  const acIds = parseAcIds(acceptanceBody);
  if (acIds.length === 0) return unjudgeable('REQUIREMENT 无 AC 编号');
  const testText = await readText(path.join(changeDir, 'TEST.md'));
  if (testText === null) return unverifiable('TEST.md 缺席');
  const roundPattern = await testRoundSectionPattern();
  if (roundPattern === TEMPLATE_SECTION_SKIP) return unverifiable('模板缺席（段名无从派生）');
  if (sectionBody(testText, roundPattern, 2) === null) return unverifiable('TEST.md 无第 1 轮段');
  const matrixPattern = await testMatrixSectionPattern();
  if (matrixPattern === TEMPLATE_SECTION_SKIP) return unverifiable('模板缺席（段名无从派生）');
  const matrixBody = sectionBody(testText, matrixPattern, 3);
  if (matrixBody === null) return unjudgeable('TEST.md 第 1 轮无 1.1 测试矩阵段');
  const covered = new Set(parseAcIds(matrixBody));
  return { acIds, missing: acIds.filter((id) => !covered.has(id)), unverified: null, unjudgeable: null };
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

// 「工件内容不可判」的报文（verify 出口 BLOCKED / 旧 change WARN 同一文本，只换分级前缀与末尾的
// 分级说明——与波次判据同形）：首行点名是哪一环读不出来，第二行给能照做的恢复出路。WARN 前缀让该行
// 进入既有 WARN COUNT（「该写的没写」不再静默为「未校验」）。
export function acCoverageUnjudgeableLines({ coverage, level = 'BLOCKED' }) {
  const blocking = level === 'BLOCKED';
  const { explanation, recovery } = coverage.unjudgeable;
  return [
    (blocking ? 'BLOCKED: ' : 'WARN: ')
      + 'AC 覆盖判据无法执行——' + explanation
      + (blocking ? '' : '（旧 change 渐进不阻断）')
      + '：判据没有可对账的清单（未验证 ≠ 通过）',
    '恢复: ' + recovery,
  ];
}

// review 出口的汇总：一条（不逐条刷屏）、不阻断、不改退出码——review 出口今天不要求 TEST.md，
// 这里只把「测试矩阵漏了谁」提前摆到审查者眼前；权威判定在 verify 出口。
export function acCoverageSummaryLine({ coverage }) {
  return 'REVIEW WARN: TEST.md 的 1.1 测试矩阵缺 AC 覆盖: ' + coverage.missing.join('、')
    + '——REQUIREMENT.md 的验收准则共 ' + coverage.acIds.length
    + ' 条（verify 出口会据此 BLOCK；本出口只汇总提示，不影响退出码）';
}
