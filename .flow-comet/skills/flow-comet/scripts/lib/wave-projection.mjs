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
// 解析面刻意宽（真实工件的写法差异一律容忍；误报比漏报更伤）：Wave 行带 `(parallel)` /
// `(serial)` 标注、括号依赖注解 `(depends on …)` / `(T07 on T05; …)`、行尾 `#` 注释、
// 全角冒号、列表记号均可。只取「Wave N … 任务 id 列表」，注解里的 id 不算本波成员；不是
// TASK.md 任务 id 的一律不计入判定；整段没有任何可判条目（无段 / 无 Wave 行 / 无可对应任务）
// → 返回不可判，调用方打印「未校验」并跳过（未验证 ≠ 通过，也不冒充通过）。
import { analyzeDependencyGraph, taskWaveLevels } from './task-graph.mjs';

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
const WAVE_TOKEN_SEPARATOR_RE = /[,\s;、]+/u;
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

// 判定：返回 { judgeable, mismatches }——mismatches 逐条 { id, deps, declared, expected }。
// 可判条目 = 既有声明波次、又是 TASK.md 里的任务、且能求出层级（环上任务无层级，其合法性由依赖图
// 判据负责）；一条可判条目都没有 → judgeable=false（是「判不了」，不是「全部一致」）。
// 明细按任务 id 升序（与书写顺序无关——报告稳定可对照）。
export function waveProjectionReview({ taskContent, blocks = [] } = {}) {
  const declared = parseDeclaredWaves(taskContent);
  if (declared === null) return { judgeable: false, mismatches: [] };
  const graph = analyzeDependencyGraph(blocks);
  const levels = taskWaveLevels(blocks);
  const comparable = [...declared.keys()].filter((id) => graph.ids.has(id) && levels.has(id));
  if (comparable.length === 0) return { judgeable: false, mismatches: [] };
  const mismatches = [];
  for (const id of comparable) {
    const declaredWave = declared.get(id);
    const level = levels.get(id);
    if (declaredWave === level) continue;
    mismatches.push({ id, deps: graph.depsById.get(id) ?? [], declared: declaredWave, expected: level });
  }
  mismatches.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return { judgeable: true, mismatches };
}

// 「不可判」的显式声明：两处调用共用本常量（同一事实只有一份措辞）。删段不是通过——判据跳过时
// 执行者必须看见「未校验」，而 plan 册要求该段在场（模板 H2 必填）。
export const WAVE_UNCHECKED_NOTICE = '未校验（无波次段）——TASK.md 缺 ## 波次划分 段，或段内没有可与任务 id 对应的 Wave 行；波次 = 依赖层级 的投影判据跳过（未验证 ≠ 通过）';

// 报文构造（plan 出口与 replan 重校共用）：BLOCKED / WARN 同一文本，只换分级前缀。明细逐条点名
// 「任务 / 依赖 / 当前波 / 应到波」；恢复指引给两条出路——移到应到波，或把「为什么排在后面」的
// 依赖写成显式 depends_on（作者有意延后的合法排法靠后者表达）。
export function waveProjectionReportLines(mismatches, level = 'BLOCKED') {
  const blocking = level === 'BLOCKED';
  const lines = [(blocking ? 'BLOCKED: ' : 'WARN: ')
    + 'TASK.md 波次划分与依赖层级不一致——波次 = 依赖层级的投影（无依赖 = 第 1 波，其余 = 1 + 依赖中最晚波次；同波任务必须彼此无依赖）'
    + (blocking ? '' : '（旧 change 渐进不阻断）')
    + ':'];
  for (const item of mismatches) {
    lines.push('  - ' + item.id + '（依赖: ' + (item.deps.length > 0 ? item.deps.join(', ') : '无')
      + '）当前波 ' + item.declared + ' → 应到波 ' + item.expected);
  }
  lines.push('恢复: 按明细逐项修正——'
    + mismatches.map((item) => '把 ' + item.id + ' 移到第 ' + item.expected
      + ' 波，或给它补 depends_on: <依赖> 把顺序声明出来（要保留当前波次，就把「它为何排在后面」的依赖写成显式 depends_on）').join('；')
    + '；改完重试');
  return lines;
}
