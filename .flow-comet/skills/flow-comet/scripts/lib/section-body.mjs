// section-body.mjs — 段体切片的单一实现（按行扫描：段标题之后取正文，直到「围栏外的同级标题 /
// 围栏外的分隔线 / 文末」）。围栏（连续三个及以上的反引号或波浪号）内的一切标题与分隔线都是正文
// 示例，不结束段体。
//
// 为什么单独成模块：同一件事（「这一段到哪里结束」）此前在仓里有五份各写一份的实现——波次段（一条
// 惰性正则）、修复段（按行找下一个 `## `）、REVIEW 发现区（标题驱动的状态机）、LESSONS 扫描段与
// TEST 1.1 矩阵段（带围栏同步的按行扫描）。其中三份没有围栏同步：工件里的围栏代码块一旦贴了
// Markdown 示例（块内 `## ` / `---`），段体就在示例处静默截断。REVIEW 发现区最危险——围栏内的
// 一行 `## ` 会把发现区重置成「非发现区」，其后的发现条目整段消失，「每条发现都必须有处置标记」
// 那道门禁因此对它们形同虚设（记录后无声消失）。
//
// 分工：段界只在这里决定。各消费方保留自己的额外语义（发现区的严重度分区、波次段的 Wave 行解析、
// 修复段的标题归一匹配、矩阵段的 AC 编号解析），并且只表达差异——结束标题的级别（level）、是否以
// 分隔线结束（endOnSeparator）、标题命中方式（正则或谓词）。只取**首个**命中：五个消费方都只要
// 一段；需要按文档序逐段处理的一方（REVIEW 发现区）用 scanHeadings 自己走，不在这里再要一份
// 「全部命中」的返回值。

// 围栏行：行首（允许缩进）三个及以上的反引号或波浪号。口径刻意极简（同一行翻转状态、不配对长度）：
// 与既有消费方的行为一致，且工件里的围栏都是三记号成对书写。
const FENCE_LINE_RE = /^\s*(?:`{3,}|~{3,})/u;
// ATX 标题行：等级 + 标题文本（闭合 `##` 留给消费方归一时处理）。
const HEADING_LINE_RE = /^(#{1,6})\s+(.+?)\s*$/u;
// 分隔线（主题分隔）：整行只有三个连字符。
const SEPARATOR_LINE_RE = /^---\s*$/u;

// 行归一（BOM / 行尾）：段定位与下标计算共用同一口径——行尾差异是检出的噪音。
function normalizeLines(content) {
  return String(content ?? '').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split('\n');
}

// 结构扫描（唯一一处按行判定「哪个标题行真的开一段」）：围栏内的标题与分隔线不进结果。
function scanDocument(content) {
  const lines = normalizeLines(content);
  const headings = [];
  const separators = [];
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (FENCE_LINE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (SEPARATOR_LINE_RE.test(line)) {
      separators.push(index);
      continue;
    }
    const matched = line.match(HEADING_LINE_RE);
    if (matched !== null) {
      headings.push({ index, level: matched[1].length, text: matched[2].trim(), line });
    }
  }
  return { lines, headings, separators };
}

// 围栏行判定（唯一一处）：需要自己过滤「围栏内 / 围栏外」行的消费方（如只取书写样例里的字段键）
// 用它，不另写一份围栏语法。
export function isFenceLine(line) {
  return FENCE_LINE_RE.test(String(line ?? ''));
}

// 围栏外的标题行（下标 / 级别 / 标题文本 / 原始行）与归一后的行：给需要自己按文档序遍历的消费方
// （REVIEW 发现区要维持文档序与其自身的严重度分区语义，不能由段体切片代劳）。
export function scanHeadings(content) {
  const { lines, headings } = scanDocument(content);
  return { lines, headings };
}

// 段体：首个命中处（标题行）之后，直到「围栏外的同级或更高级标题 / 围栏外的分隔线 / 文末」的正文。
// 无命中 → null（「段缺席」与「段在场但正文为空」是两种可区分的结果，调用方按 null 判缺席）。
//   options.level          结束段的标题最高级别（2 → `##` 与 `#`；3 → `###` 及以上）；默认 2
//   options.endOnSeparator 围栏外的分隔线是否结束段体；默认 true
// headingPattern 是正则（对整行 test，须自带行锚定——正文里「引用段名」不得劫持匹配）或谓词
// (heading, line) => boolean（修复段按归一标题比较，正则表达不了）。
export function sectionBody(content, headingPattern, options = {}) {
  const level = options.level ?? 2;
  const endOnSeparator = options.endOnSeparator ?? true;
  const { lines, headings, separators } = scanDocument(content);
  const start = headings.findIndex((heading) => (typeof headingPattern === 'function'
    ? headingPattern(heading, heading.line) === true
    : headingPattern.test(heading.line)));
  if (start < 0) return null;
  const heading = headings[start];
  let end = lines.length;
  const nextHeading = headings.slice(start + 1).find((candidate) => candidate.level <= level);
  if (nextHeading !== undefined) end = nextHeading.index;
  if (endOnSeparator) {
    const separator = separators.find((index) => index > heading.index && index < end);
    if (separator !== undefined) end = separator;
  }
  return lines.slice(heading.index + 1, end).join('\n');
}
