// wave-projection.mjs — 波次段解析与「波次 = 依赖层级的投影」判定（纯判定：无 console、无
// process.exit、无写盘）。
//
// 语义：`## 波次划分` 段给每个任务声明它排在第几波；波次不是自由排版，而是依赖层级的投影——
// level(task) = 1 + max(level(dep))（无依赖 = 第 1 波，见 task-graph.mjs 的 taskWaveLevels）。
// 声明波次 ≠ 层级即不一致：同波依赖（依赖方与被依赖方写在同一波）、排在依赖之前、以及明明只需
// 更早波次却排到更后面的保守排法，都会在明细里被逐条点名为「当前波 → 应到波」。
// 分级与措辞不在这里判：本模块只产出明细与报文行，BLOCK / WARN 由调用方（plan 出口门禁 /
// replan 重校段）按 isNewChange 决定——两处共用同一报文构造，措辞因此不可能分叉（ADR-013：
// replan 不豁免，改散文也绕不过同一判据）。
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
// 「判不了」按成因二分（同一成因同一措辞，分级由调用方给）：
//   · 载体缺席（无 `## 波次划分` 段 / 段名无从派生）→ reason='section-missing'，调用方打印
//     「未校验」并放行（判据没有可判对象，不改退出码）；
//   · 工件内容不可判（段在场，但一行 Wave 行都解析不出可对应任务：正文只写 N/A、点的是不存在的
//     任务 id、行首强调记号让 Wave 行不成立）→ reason='content-unjudgeable'，新 change BLOCKED /
//     旧 change WARN（WARN 行进入既有 WARN COUNT——「该写的没写」不再静默）。
import { analyzeDependencyGraph, fixTaskClassifier, taskWaveLevels } from './task-graph.mjs';
import { taskOpeningAttrs } from '../task-parsing.mjs';

// 波次段名 = flow-kit/templates/TASK.md 的 H2 `## 波次划分`（登记于 reference/artifact-templates.json
// 的 TASK sections）——段名对齐模板权威，不在这里另起变体（L-001）。段界与 plan 出口既有的
// 「波次散文一致性（[P] vs parallel）」检测**同一实现**（waveSectionBody 是唯一表达处）：
// 段尾 = 下一个二级标题 / 分隔线 / 输入末尾。JS 正则没有 \Z：\Z 是「未知转义 ⇒ 字面字符 Z」，
// 惰性匹配一遇段内大写 Z 就提前收尾，段被静默截断（含 ZERO- 一类机检标记的 TASK 会整段漏检）。
// 串尾一律用 (?![\\s\\S]) 真断言——它只是「此处之后已无任何字符」，不受行首 / 行尾标志影响，
// 与「多行模式下的 $」语义无歧义。
const WAVE_SECTION_RE = /##\s*波次划分\s*\n([\s\S]*?)(?=\n##\s|\n---|(?![\s\S]))/u;

// 波次段正文（段标题之后、下一个二级标题 / 分隔线 / 文末之前的文本）；无该段 → null。
export function waveSectionBody(taskContent) {
  const match = String(taskContent ?? '').match(WAVE_SECTION_RE);
  return match === null ? null : match[1];
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

// 判定：返回 { judgeable, reason, mismatches }——mismatches 逐条 { id, deps, declared, expected }。
// judgeable=false 的 reason 区分两种「判不了」：'section-missing'（载体缺席）与
// 'content-unjudgeable'（段在场而内容不可判），分级由调用方按 change 新旧与成因分别处置。
// 可判条件 = 段在场且至少一条声明能落到 TASK.md 的真实任务上；到不落就说明正文不是可解析的波次
// 声明（N/A、点了不存在的 id、行首强调记号），此时不再猜「全部一致」。
// 已声明一侧要求能求出层级（环上任务无层级，其合法性由依赖图判据负责）；未声明一侧同样要求层级
// （没有「应到波」就无法给出可照抄的明细）。明细按任务 id 升序（与书写顺序无关——报告稳定可对照）。
export function waveProjectionReview({ taskContent, blocks = [] } = {}) {
  const declared = parseDeclaredWaves(taskContent);
  if (declared === null) return { judgeable: false, reason: 'section-missing', mismatches: [] };
  const graph = analyzeDependencyGraph(blocks);
  const levels = taskWaveLevels(blocks);
  const declaredTaskIds = [...declared.keys()].filter((id) => graph.ids.has(id));
  if (declaredTaskIds.length === 0) return { judgeable: false, reason: 'content-unjudgeable', mismatches: [] };
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
  return { judgeable: true, reason: null, mismatches };
}

// 「载体缺席」的显式声明：两处调用共用本常量（同一事实只有一份措辞）。删段不是通过——判据跳过时
// 执行者必须看见「未校验」，而 plan 册要求该段在场（模板 H2 必填）。段在场却解析不出可对应任务
// **不属本支**（那是「该写的没写」，见 waveContentUnjudgeableLine）。
export const WAVE_UNCHECKED_NOTICE = '未校验（无波次段）——TASK.md 缺 ## 波次划分 段（或段名无从派生），波次 = 依赖层级 的投影判据跳过（未验证 ≠ 通过）';

// 「工件内容不可判」的报文（plan 出口与 replan 重校共用同一构造，只换分级前缀）：与载体缺席不同，
// 这里段是在场的——成因是正文没有写出可解析的波次声明。旧 change 用 WARN 前缀，因此该行进入既有
// WARN COUNT（未校验不再静默）；新 change 用 BLOCKED 前缀并由调用方拒绝通过。
export function waveContentUnjudgeableLine(level = 'BLOCKED') {
  const blocking = level === 'BLOCKED';
  return (blocking ? 'BLOCKED: ' : 'WARN: ')
    + 'TASK.md 波次划分段内容不可判——## 波次划分 段在场，但段内没有一行 Wave 行能解析出可对应的任务 id'
    + '（正文只写 N/A / Wave 行点的是不存在的任务 id / 行首强调记号让 Wave 行不成立）'
    + (blocking ? '' : '（旧 change 渐进不阻断）')
    + '：波次 = 依赖层级 的投影判据无法执行（未验证 ≠ 通过）'
    + '；恢复: 按模板把每一波写成可解析的 Wave 行（如 `Wave 1: T01, T02`，中文标点可用），'
    + '任务 id 必须逐字对应 TASK.md 里的任务；段正文写 N/A 不构成波次声明';
}

// 报文构造（plan 出口与 replan 重校共用）：BLOCKED / WARN 同一文本，只换分级前缀。明细逐条点名
// 「任务 / 依赖 / 当前波 / 应到波」（未声明的任务当前波记为「未声明」）；恢复指引按明细分流——
// 已声明但波次不对：移到应到波，或把「为什么排在后面」的依赖写成显式 depends_on（作者有意延后的
// 合法排法靠后者表达）；未声明：把它写进应到波的 Wave 行（没有「当前波」可挪，所以不套用前者）。
export function waveProjectionReportLines(mismatches, level = 'BLOCKED') {
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
