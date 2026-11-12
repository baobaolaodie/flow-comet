// wave-projection.mjs — 波次段解析与「波次 = 依赖层级的投影」判定（纯判定：无 console、无
// process.exit、无写盘）。
//
// 语义：`## 波次划分` 段给每个任务声明它排在第几波；波次不是自由排版，而是依赖层级的投影——
// level(task) = 1 + max(level(dep))（无依赖 = 第 1 波，见 task-graph.mjs 的 taskWaveLevels）。
// 声明波次 ≠ 层级即不一致：同波依赖（依赖方与被依赖方写在同一波）、排在依赖之前、以及明明只需
// 更早波次却排到更后面的保守排法，都会在明细里被逐条点名为「当前波 → 应到波」。
// 分级不在这里判：本模块产出「判不了」的分类与载荷、明细与报文行；BLOCK / WARN 由调用方给出
// blocking（单轨下内容不可判一律 blocking）。**分级 → 输出只有一处**（waveReviewOutcome）：plan
// 出口门禁与 replan 重校段共用同一份。调用方不得自写「不可判 → 选级别 → 打印 → exit」的同构分支
// ——同一分级有两份实现时，改一处只会在另一处静默落后（ADR-013 的前提正是「两处同判」：replan 不豁免）。
//
// 判定面覆盖两侧：① 已声明任务的波次必须等于依赖层级；② 任务集里存在、Wave 行一次都没提到的
// 任务同样不一致（明细取值 = 「未声明」）——只沿「已声明」一侧求差集，未写进 Wave 行的任务会整个
// 逃过判定（实测：段内只写 `Wave 1: T01` 而任务另有 T02/T03 时，出口 exit 0 且零输出）。修复族
// 任务不在声明的义务面内（回修有独立生命周期），族判定一律经 task-graph 的唯一谓词
// `fixTaskClassifier`——判据侧不自写前缀匹配。
//
// 解析面刻意宽（真实工件的写法差异一律容忍；误报比漏报更伤）：Wave 行带 `(parallel)` /
// `(serial)` 标注、括号依赖注解 `(depends on …)` / `(T07 on T05; …)`、行尾 `#` 注释、
// 半角 / 全角冒号与逗号分号顿号、列表记号均可。只取「Wave N … 任务 id 列表」，注解里的 id 不算
// 本波成员；不是 TASK.md 任务 id 的一律不计入判定。
//
// 「判不了」按成因二分，形态与 ac-coverage.mjs **完全一致**（本仓结构判据只此一种形态）：
//   { unverified: { reason, notice } | null, unjudgeable: { reason, explanation, recovery } | null, ... }
//   · 载体缺席（无 `## 波次划分` 段 / 段名无从派生）→ unverified 非空：调用方打印 notice
//     （「未校验」）并放行——判据没有可判对象，不改退出码；
//   · 工件内容不可判（段在场，但一行 Wave 行都解析不出可对应任务：正文只写 N/A、点的是不存在的
//     任务 id、行首强调记号让 Wave 行不成立）→ unjudgeable 非空：一律 BLOCKED（单轨判级——「该写的
//     没写」不再静默；恢复出路在载荷里）。
// 收敛到这一形态（而不是 { judgeable, reason }）的理由：① 载荷跟着分类走——notice /
// explanation + recovery 直接可用于打印，调用方不必再按 reason 反查第二张表（同一组取值只许有一张
// 表：按 key 反查的第二张表与判定表必然分叉）；② 「能否判定」由字段出现与否表达，reason 只留人读
// 成因，不再逼调用方从字符串取值反推分级；③ 新增的结构判据照抄这一组字段即可，不必再选一次。
// 形态不随落点变化：谁带着载荷，谁就是形态（换一个出口消费它，判定结论与字段不变）。
import {
  analyzeDependencyGraph,
  collectCrossTaskConflicts,
  fixTaskClassifier,
  taskWaveLevels,
} from './task-graph.mjs';
import { taskOpeningAttrs } from '../task-parsing.mjs';
// 段界单源（围栏 / 同级标题 / 分隔线 / 文末的判定只在这里一份）
import { sectionBody } from './section-body.mjs';
// 「这个任务有没有写面」的单一实现（元素提取 + 条目边界都在 lib/lessons-hits.mjs）：本模块不自己
// 拿正则去块里找 <write_files>。同一件事写第二份表达式时，元素名大小写少一个 /i 就够——7 字段门
// 判字段在场、本模块判未知，任务因此从 [P] 判据的参与者里静默消失。
import { taskHasWriteFace } from './lessons-hits.mjs';
// 段名登记值与段标题谓词都取单源：骨架模块是「模板缺席时的段名基准」唯一登记处，也是「这一行是不是
// 登记的某段」的唯一判定（headingPredicate：级别 + 段名归一后相等），消费方只 import。
import { WAVE_SECTION_NAME, headingPredicate } from './guard-artifact-skeleton.mjs';

// 段界与 plan 出口既有的「波次散文一致性（[P] vs parallel）」检测**同一实现**，而段界本身由
// lib/section-body.mjs 单点决定：围栏代码块里的 `## ` / `---` 是正文示例，不结束段体（段内贴一段
// Markdown 示例不会把其后声明的 Wave 行整段吞掉）。
// 段标题判定与 TASK 段形门、AC 覆盖**同一个谓词**（级别 + 归一后的标题正文相等）：标题**正文本身**
// 以井号开头（`## ## 波次划分`）时，行正则会判缺席、段形门却认作在场——同一份工件的同一段在两处得到
// 相反答案时，一次排版就够关掉其中一处判据（未校验 ≠ 通过）。比较规则不在本模块另写一份。
const isWaveSectionHeading = headingPredicate(WAVE_SECTION_NAME, 2);

// 波次段正文（段标题之后、下一个二级标题 / 分隔线 / 文末之前的文本）；无该段 → null。
export function waveSectionBody(taskContent) {
  return sectionBody(taskContent, isWaveSectionHeading, { level: 2, endOnSeparator: true });
}

// Wave 行：`Wave N (parallel): T01[P], T02   (depends on T01)   # 说明`。只认「Wave + 数字」开口
// （允许缩进与列表记号）；行内其余注解由 parseWaveLine 剥离。
const WAVE_LINE_RE = /^\s*(?:[-*+]\s+)?Wave\s+(\d+)\b/iu;
// 行尾注释：`#` 之后的不是本波成员（括号内 `(见 #12)` 一类由后续括号剥离兜住）。
const WAVE_TRAILING_COMMENT_RE = /#[^\n]*/gu;
// 括号注解（半角 / 全角）：`(parallel)` / `(serial)` / `(depends on T01, T02)` / `（T07 on T05; …）`。
// 注解里的任务 id 是「为什么排在这里」的说明，不是本波成员——先剥注解再取 id，否则依赖注解会把
// 被依赖方错算进本波（模板自身就写 `Wave 2 (parallel): T03[P], T04[P]   (depends on T01)`）。
const WAVE_ANNOTATION_RE = /[(（][^()（）]*[)）]/gu;
const WAVE_COLON_RE = /[:：]/u;
// 任务 id 分隔符：半角逗号 / 分号 / 空白 + 中文顿号 / 全角逗号 / 全角分号。漏收全角逗号会让中文
// 写法的 `Wave 1：T01，T02` 只切出 `T01，T02` 这个假 id ⇒ 无可对应任务 ⇒ 整段降级成「未校验」
// 放行（半角写法同一计划却 BLOCK）——同一计划的两种标点写法必须得到同一判定。
const WAVE_TOKEN_SEPARATOR_RE = /[,\s;、，；]+/u;
// id token 上的标记（`[P]` 并行标记、Markdown 强调符）不是 id 的一部分：先整段剥掉方括号标
// 记（`T01[P]` → `T01`，只削括号会留下 `P` 拼成假 id），再剥残余的孤立记号。
const WAVE_TOKEN_BRACKETS_RE = /\[[^\]]*\]/gu;
const WAVE_TOKEN_MARKERS_RE = /[[\]`*]/gu;

// 单行 → { wave, tokens }（tokens 只做过标记剥离与切分，是否真是任务 id 由判定侧用任务集过滤）；
// 不是 Wave 行 → null。
function parseWaveLine(line) {
  const head = String(line).match(WAVE_LINE_RE);
  if (head === null) return null;
  let rest = String(line).slice(head[0].length)
    .replace(WAVE_TRAILING_COMMENT_RE, '')
    .replace(WAVE_ANNOTATION_RE, ' ')
    .replace(WAVE_ANNOTATION_RE, ' '); // 括号嵌套（少见）再剥一层，不引入递归
  const colon = rest.search(WAVE_COLON_RE);
  if (colon >= 0) rest = rest.slice(colon + 1);
  const tokens = rest
    .split(WAVE_TOKEN_SEPARATOR_RE)
    .map((token) => token.replace(WAVE_TOKEN_BRACKETS_RE, '').replace(WAVE_TOKEN_MARKERS_RE, '').trim())
    .filter(Boolean);
  return { wave: Number(head[1]), tokens };
}

// 波次段 → Map<任务 id, 声明波次>；无该段 → null（不可判）。同一 id 重复声明：首见为准
// （声明面本应唯一，重复时取确定性的那一个，不按书写顺序反复覆盖）。
function parseDeclaredWaves(taskContent) {
  const body = waveSectionBody(taskContent);
  if (body === null) return null;
  const declared = new Map();
  for (const line of body.split(/\r?\n/u)) {
    const parsed = parseWaveLine(line);
    if (parsed === null) continue;
    for (const id of parsed.tokens) {
      if (id === '' || declared.has(id)) continue;
      declared.set(id, parsed.wave);
    }
  }
  return declared;
}

// 「未声明」取值：Wave 行一次都没提到的真实任务（修复族例外）。明细形态与既有一致明细同形，
// 只有 declared 取值不同——渲染 / 分级 / 恢复指引因此仍走同一处构造，不会分叉。
const WAVE_UNDECLARED = '未声明';

// 「载体缺席」的 notice（由判定结果携带，调用方只打印）：删段不是通过——判据跳过时执行者必须看见
// 「未校验」，而 plan 册要求该段在场（模板 H2 必填）。段在场却解析不出可对应任务**不属本支**（那是
// 「该写的没写」，见 WAVE_CONTENT_UNJUDGEABLE）。
const WAVE_UNCHECKED_NOTICE = '未校验（无波次段）——TASK.md 缺 ## 波次划分 段（或段名无从派生），波次 = 依赖层级 的投影判据跳过（未验证 ≠ 通过）';

// 「工件内容不可判」的成因载荷（与 ac-coverage 的 UNJUDGEABLE_CAUSES 同形：解释 + 恢复出路各占一半
// ——只有解释没有出路，人只能猜下一步）。reason 是机器可读短句，explanation / recovery 是人读文本，
// 判定结果自带这三样，调用方不再按 reason 反查第二张表。
const WAVE_CONTENT_UNJUDGEABLE = Object.freeze({
  reason: 'no-resolvable-wave-line',
  explanation: '## 波次划分 段在场，但段内没有一行 Wave 行能解析出可对应的任务 id'
    + '（正文只写 N/A / Wave 行点的是不存在的任务 id / 行首强调记号让 Wave 行不成立）',
  recovery: '按模板把每一波写成可解析的 Wave 行（如 `Wave 1: T01, T02`，中文标点可用），'
    + '任务 id 必须逐字对应 TASK.md 里的任务；段正文写 N/A 不构成波次声明',
});

// 判定：返回 { unverified, unjudgeable, mismatches, waves }——「判不了」形态见文件头。
//   · mismatches 逐条 { id, deps, declared, expected }；
//   · waves = Map<真实任务 id, 声明波次>（可判时非空；[P] 判据复用这份解析结果分组）。
// 可判条件 = 段在场且至少一条声明能落到 TASK.md 的真实任务上；到不落就说明正文不是可解析的波次
// 声明（N/A、点了不存在的 id、行首强调记号），此时不再猜「全部一致」。
// 已声明一侧要求能求出层级（环上任务无层级，其合法性由依赖图判据负责）；未声明一侧同样要求层级
// （没有「应到波」就无法给出可照抄的明细）。明细按任务 id 升序（与书写顺序无关——报告稳定可对照）。
export function waveProjectionReview({ taskContent, blocks = [] } = {}) {
  const declared = parseDeclaredWaves(taskContent);
  if (declared === null) {
    return { unverified: { reason: 'section-missing', notice: WAVE_UNCHECKED_NOTICE }, unjudgeable: null, mismatches: [], waves: null };
  }
  const graph = analyzeDependencyGraph(blocks);
  const levels = taskWaveLevels(blocks);
  const declaredTaskIds = [...declared.keys()].filter((id) => graph.ids.has(id));
  if (declaredTaskIds.length === 0) {
    return { unverified: null, unjudgeable: WAVE_CONTENT_UNJUDGEABLE, mismatches: [], waves: null };
  }
  // 修复族 = 「不要求排进波次」的那一族：族判定经 task-graph 的唯一谓词（前缀形态与「位于修复段内」
  // 两条边界只在那里表达），本模块只取用结果，不自写前缀匹配。
  const isFixTask = fixTaskClassifier(taskContent);
  const fixIds = new Set(blocks
    .filter((block) => isFixTask(block))
    .map((block) => (taskOpeningAttrs(block) ?? {}).id)
    .filter((id) => typeof id === 'string' && id !== ''));
  const mismatches = [];
  for (const id of declaredTaskIds) {
    if (!levels.has(id)) continue; // 环上任务无层级：合法性由依赖图判据负责
    const declaredWave = declared.get(id);
    const level = levels.get(id);
    if (declaredWave === level) continue;
    mismatches.push({ id, deps: graph.depsById.get(id) ?? [], declared: declaredWave, expected: level });
  }
  // 未声明一侧：任务集减去 Wave 声明集（修复族排除在外）——写漏的任务同样是不一致，逐条点名。
  for (const id of graph.ids) {
    if (declared.has(id) || fixIds.has(id) || !levels.has(id)) continue;
    mismatches.push({ id, deps: graph.depsById.get(id) ?? [], declared: WAVE_UNDECLARED, expected: levels.get(id) });
  }
  mismatches.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  // 波次分组（真实任务 id → 声明波次）随判定结果一并返回：[P] 判据（parallelGapReview）用它分组，
  // 不重解析同一段波次散文——同一段两次解析必然分叉。
  const waves = new Map(declaredTaskIds.map((id) => [id, declared.get(id)]));
  return { unverified: null, unjudgeable: null, mismatches, waves };
}

// 「工件内容不可判」的报文构造（plan 出口与 replan 重校共用同一份，只换分级前缀）：首行点名哪一环
// 读不出来并给出分级，第二行给能照做的恢复出路——与 ac-coverage 的 acCoverageUnjudgeableLines 同形
// （同一件事两处措辞必然先漂移）。判不了即由调用方拒绝通过（不再有渐进档）；载荷来自判定结果，
// 本函数只做渲染。
function waveContentUnjudgeableLines(unjudgeable, level) {
  const blocking = level === 'BLOCKED';
  return [
    (blocking ? 'BLOCKED: ' : 'WARN: ')
      + 'TASK.md 波次划分段内容不可判——' + unjudgeable.explanation
      + (blocking ? '' : '（旧 change 渐进不阻断）')
      + '：波次 = 依赖层级 的投影判据无法执行（未验证 ≠ 通过）',
    '恢复: ' + unjudgeable.recovery,
  ];
}

// 报文构造（只由 waveReviewOutcome 调用，调用方不直接取用）：BLOCKED / WARN 同一文本，只换分级前缀。
// 明细逐条点名「任务 / 依赖 / 当前波 / 应到波」（未声明的任务当前波记为「未声明」）；恢复指引按明细
// 分流——已声明但波次不对：移到应到波，或把「为什么排在后面」的依赖写成显式 depends_on（作者有意
// 延后的合法排法靠后者表达）；未声明：把它写进应到波的 Wave 行（没有「当前波」可挪，不套用前者）。
function waveProjectionReportLines(mismatches, level = 'BLOCKED') {
  const blocking = level === 'BLOCKED';
  const lines = [(blocking ? 'BLOCKED: ' : 'WARN: ')
    + 'TASK.md 波次划分与依赖层级不一致——波次 = 依赖层级的投影（无依赖 = 第 1 波，其余 = 1 + 依赖中最晚波次；同波任务必须彼此无依赖；'
    + '任务集里存在但 Wave 行一次都没提到的任务记为「未声明」）'
    + (blocking ? '' : '（旧 change 渐进不阻断）')
    + ':'];
  for (const item of mismatches) {
    lines.push('  - ' + item.id + '（依赖: ' + (item.deps.length > 0 ? item.deps.join(', ') : '无')
      + '）当前波 ' + item.declared + ' → 应到波 ' + item.expected);
  }
  lines.push('恢复: 按明细逐项修正——'
    + mismatches.map((item) => (item.declared === WAVE_UNDECLARED
      ? '把 ' + item.id + ' 写进第 ' + item.expected + ' 波的 Wave 行'
      : '把 ' + item.id + ' 移到第 ' + item.expected
        + ' 波，或给它补 depends_on: <依赖> 把顺序声明出来（要保留当前波次，就把「它为何排在后面」的依赖写成显式 depends_on）')).join('；')
    + '；改完重试');
  return lines;
}

// 分级 → 输出的**唯一出口**（plan 出口与 replan 重校各自只派生 blocking）：返回 { lines, block }。
//   · 载体缺席 → 打印 notice、不阻断（block=false；「未校验 ≠ 通过」由文本表达，不改退出码）；
//   · 内容不可判 → BLOCKED / WARN 两行（成因 + 恢复出路），block = blocking；
//   · 判过且不一致 → 明细 + 恢复指引，block = blocking；
//   · 判过且一致 → 零行、不阻断（不制造噪音）。
// 调用方一律「逐行 console.error → 按 block 拒绝」，不再自己选级别、也不再自己构造报文。
export function waveReviewOutcome(review, { blocking = false } = {}) {
  const blocked = blocking === true;
  const level = blocked ? 'BLOCKED' : 'WARN';
  if (review.unverified !== null) return { lines: [review.unverified.notice], block: false };
  if (review.unjudgeable !== null) {
    return { lines: waveContentUnjudgeableLines(review.unjudgeable, level), block: blocked };
  }
  if (review.mismatches.length === 0) return { lines: [], block: false };
  return { lines: waveProjectionReportLines(review.mismatches, level), block: blocked };
}

// ---------- 同波可并行却漏标 [P]（plan 出口的第二条波次面判据） ----------
// 判据：同一波次内、彼此无依赖路径、且 write_files 不重叠的两个任务——**其中任一**没标
// parallel="true" 即「可并行却未标 [P]」。只标一个不成立：单边标记既不表达「可并行」，机器路由
// 又按串行跑（该并行度白丢）。作者的两条出路：两个都标 [P]（真并行），或补一条 depends_on 把它们
// 排到不同波次（顺序显式）。修复族不参与（回修有独立生命周期）。
//
// 三条输入面的复用（本判据不另写第二份）：
//   · 波次分组 / 层级：分组取 waveProjectionReview 的 waves（同一次解析，见该函数），层级取
//     task-graph 的 taskWaveLevels。**同层 ⇒ 彼此无依赖路径**（依赖边严格抬高层级：
//     level(依赖方) ≥ level(被依赖方) + 1），故「同波 ∧ 同层」即「同一波次内且彼此无依赖路径」——
//     波次投影一致时两者本就等价，投影不一致时取交集使判据保守。
//   · 写面重叠：**唯一入口是 task-graph 的 collectCrossTaskConflicts**。任务书写的是
//     collectPathOverlaps（重叠判定的底层唯一实现），落地走它的上层入口——后者才带着「已归一路径」
//     的解析、glob 语义与参与者规则（未完成、非修复族），且这些都收在 task-graph 一处；为直接调底层
//     函数而导出 parsePaths / normalizeTaskPath，等于把私有契约放大成公共面。**等价关系**：该入口返回
//     「同波无关 ∧ 写面重叠」（参与者已按未完成 / 非修复族过滤），本判据要的是它的**补集**——同层任务
//     之间无依赖路径（层级不变量），故「不在其返回集合」⟺「写面不重叠」，不重叠才有资格叫「可并行」。
//     本判据不自己比较路径：第二份重叠判定（含路径归一与 glob）必然与第一份分叉。
//     补集判定同样不自己算键：task-graph 返回的 isOverlappingPair 就是「键集合上的成员判定」，任务对键
//     的形态（无序、NUL 分隔）只在那里表达一次。此处自建第二份键（换个分隔符或换个定序）时两端键不再
//     相等，补集会静默失效——写面重叠的一对被当成「本可并行」，而本判据照常报出来。
//   · 修复族：族判定经 task-graph 的唯一谓词 fixTaskClassifier，判据侧不自写前缀匹配。
// 已 done 的任务不参与（规划面上的 [P] 只约束未开始的任务）。
// 写面未知的任务同样不参与：没有 <write_files>（或清单为空 / 只有注释）意味着「不能断言写面不重叠」，
// 而不是「写面不重叠」——把它当成后者，补集会把一对写面未知的任务报成「可并行却未标 [P]」，恢复句
// 还会让作者补 depends_on（真正缺的是字段）。参与者判据因此与 task-graph 的第三族同口径（该族只把
// 有写面的任务放进重叠比较），而「这份写面算不算有内容」取 lib/lessons-hits.mjs 的唯一判定
// （taskHasWriteFace）——本模块不再自持第二份元素提取（元素名大小写与注释剥离都在那里表达一次）。

// 判定：返回 { gaps }，逐条 { a, b, wave, unmarked }（unmarked = 该对里没标 parallel 的任务 id）。
// 无波次段 / 内容不可判（waves 为 null）→ 空（波次侧已有判别不了，本判据没有分组可用）。
export function parallelGapReview({ taskContent = '', blocks = [], waves = null } = {}) {
  if (!(waves instanceof Map) || waves.size === 0) return { gaps: [] };
  const levels = taskWaveLevels(blocks);
  const isFixTask = fixTaskClassifier(taskContent);
  const candidates = [];
  for (const block of blocks) {
    const attrs = taskOpeningAttrs(block);
    if (!attrs || typeof attrs.id !== 'string' || attrs.id === '') continue;
    if (attrs.status === 'done' || isFixTask(block)) continue;
    if (!taskHasWriteFace(block)) continue;
    const wave = waves.get(attrs.id);
    const level = levels.get(attrs.id);
    if (wave === undefined || level === undefined) continue;
    candidates.push({ id: attrs.id, wave, level, parallel: attrs.parallel === true });
  }
  if (candidates.length < 2) return { gaps: [] };
  const { depsById } = analyzeDependencyGraph(blocks);
  const { isOverlappingPair } = collectCrossTaskConflicts({
    taskContent, allBlocks: blocks, depsById,
  });
  const gaps = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i];
      const right = candidates[j];
      if (left.wave !== right.wave || left.level !== right.level) continue;
      if (left.parallel && right.parallel) continue;
      if (isOverlappingPair(left.id, right.id)) continue;
      gaps.push({
        a: left.id,
        b: right.id,
        wave: left.wave,
        unmarked: [left, right].filter((task) => !task.parallel).map((task) => task.id),
      });
    }
  }
  return { gaps };
}

// 报文（plan 出口 BLOCKED）：逐对点名哪两个任务同波、谁没标，
// 恢复句给两条出路（都标 [P]，或补 depends_on 换波次）——只有一条出路时执行者会以为「标 [P] 是唯一
// 正确答案」，而真实计划里「这两个任务其实有先后」是同样常见的形态。
function parallelGapLines(gaps, level = 'BLOCKED') {
  if (gaps.length === 0) return [];
  const blocking = level === 'BLOCKED';
  const sample = gaps[0];
  const lines = [(blocking ? 'BLOCKED: ' : 'WARN: ')
    + 'TASK.md 同波任务可并行却未标 [P]——同一波次内彼此无依赖路径、且 write_files 不重叠的任务本可并行；'
    + '任务开标签的 parallel="true" 才是机器路由依据（Wave 行的 [P] 只是散文标记）'
    + (blocking ? '' : '（旧 change 渐进不阻断）')
    + ':'];
  for (const gap of gaps) {
    lines.push('  - ' + gap.a + ' × ' + gap.b + '（同在第 ' + gap.wave + ' 波；未标 parallel="true": '
      + gap.unmarked.join('、') + '）');
  }
  lines.push('恢复: 两条出路任选——① 给这一对都标 parallel="true"（Wave 行同步标 [P]），让它们真的同波并行；'
    + '② 补一条 depends_on（如给 ' + sample.b + ' 加 <depends_on>' + sample.a + '</depends_on>）'
    + '把它们排到不同波次，顺序因而显式；改完重试');
  return lines;
}

// 分级 → 输出的唯一出口（与 waveReviewOutcome 同形：两个调用方各自只派生 blocking）。ADR-013 的
// 「replan 不豁免」同样适用于本判据：只在 plan 出口判，执行期重签就能把「本可并行却没标」的计划
// 换一份发出去——那正是两处同判要防的形态。
export function parallelGapOutcome(review, { blocking = false } = {}) {
  const blocked = blocking === true;
  if (review.gaps.length === 0) return { lines: [], block: false };
  return { lines: parallelGapLines(review.gaps, blocked ? 'BLOCKED' : 'WARN'), block: blocked };
}
