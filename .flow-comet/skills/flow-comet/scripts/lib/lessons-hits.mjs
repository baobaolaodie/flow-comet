// lessons-hits.mjs — LESSONS 命中集的单一实现（出口门禁与 handoff request 共用）
//
// 命中集 = 任务 <write_files> 的路径词元 × .specs/LESSONS.md 条目的关键词行（共享词元多者在前，
// 同分按条目出现顺序，取前 LESSONS_HIT_LIMIT 条）。出口据此要求 SUMMARY 的 ## LESSONS 扫描 段
// 逐条回应这些编号；开工前 handoff request 打印同一集合——执行者按看到的集合写回应，不必等到
// 出口才发现缺项。
//
// 两处必须同一实现：各算一套会让「写回应的人」与「验回应的人」按不同集合对齐。本模块只做纯文本
// 计算，读文件由调用方负责（出口读 change 目录，request 读项目级教训册）。

import { taskBlocks, taskOpeningAttrs } from '../task-parsing.mjs';
// 围栏行判定取段体单源的唯一实现（反引号与波浪号同口径）：本模块自己按行判围栏时只认反引号，
// 波浪号围栏里的书写样例就被当成真条目（出口与 request 打印面会多出「该回应」的假编号）。
import { isFenceLine } from './section-body.mjs';

// 命中上限：出口与打印面同取此值（单处定义，消费方不得各写一个数字）。
export const LESSONS_HIT_LIMIT = 5;

// 路径词元的停用词（目录布局噪音 + 扩展名残片）：只作用于「命中计算」的路径侧——条目关键词侧
// 原样保留，过滤口径不扩散成第二份规则。
const LESSONS_PATH_STOPWORDS = new Set([
  // 目录布局噪音
  'src', 'lib', 'libs', 'app', 'apps', 'core', 'pkg', 'packages', 'bin', 'dist', 'build', 'out',
  'tmp', 'temp', 'test', 'tests', 'spec', 'specs', 'unit', 'e2e', 'fixture', 'fixtures',
  'mock', 'mocks', 'docs', 'doc', 'scripts', 'script', 'assets', 'static', 'public',
  'config', 'configs', 'utils', 'util', 'helpers', 'helper', 'common', 'shared', 'internal',
  'modules', 'module', 'components', 'pages', 'views', 'styles', 'data', 'types', 'index',
  // 扩展名 / 备份后缀残片
  'mjs', 'cjs', 'jsx', 'tsx', 'json', 'yaml', 'yml', 'toml', 'lock', 'bak', 'log', 'txt', 'css',
]);

const LESSONS_ENTRY_HEADING = /^###\s*L-(\d+)\b/u;
const LESSONS_KEYWORD_LINE = /^[-*\s]*\*\*关键词\*\*\s*[:：]\s*(.+)$/u;
// 条目标题（### L-NNN 之后的部分）与编号之间的分隔符：只用于打印面，命中判定仍只看关键词行。
const LESSONS_TITLE_LEAD = /^[\s·:：\-—]+/u;

// <write_files> 元素提取：正则**唯一一份**，且大小写不敏感——元素名按 HTML 语义与大小写无关
// （`<WRITE_FILES>` 与 `<write_files>` 是同一种元素；plan 出口的 7 字段门正是按 /i 判在场的）。
// 写面判定若只认小写，同一份 TASK.md 会在两道门里得到两种结论：任务被判「字段在场」，却在
// 「算不算有写面」处判未知——判据缺席即放行。
const WRITE_FILES_ELEMENT_RE = /<write_files>([\s\S]*?)<\/write_files>/iu;

// 块内写面元素原文（块内没有该元素 → null）。
function writeFilesElement(block) {
  const matched = String(block ?? '').match(WRITE_FILES_ELEMENT_RE);
  return matched === null ? null : matched[1];
}

// write_files 元素原文（键 = 任务 id）：块提取与开标签解析复用 task-parsing 的既有实现——出口按任务
// 文件逐个任务取写面，打印面按同一提取取同一个任务的写面，两侧输入必须同源。
export function taskWriteFilesById(taskContent) {
  const out = new Map();
  for (const block of taskBlocks(taskContent)) {
    const attrs = taskOpeningAttrs(block);
    if (!attrs || !attrs.id) continue;
    const element = writeFilesElement(block);
    if (element !== null) out.set(attrs.id, element);
  }
  return out;
}

// write_files 元素原文 → 条目列表（剥 HTML 注释 → 按行切 → 分号容错二次切 → trim → 滤空）。
// 这是**条目边界**的唯一实现，三个消费方取用它：workflow-handoff 的提交子集校验（允许列表）、
// guard-gates 的伪并行启发式（哪些条目只落在测试面）、task-graph 的路径解析（族①②③的读写面）。
// 同一份写面被切成不同条目集时，「谁越界」「哪一对并行任务重叠」会给出互相矛盾的结论，而两处
// 各自自洽、不会变红——边界只在 SDK 侧可见，故收在此处。
// 路径归一是各消费方自己的事，刻意不进来：handoff 只做 POSIX 化（为了与 git 的 --name-only 输出
// 对齐），task-graph 另有 `.` / `..` 段的解析（逃出项目根按越界返回 null）。归一差异不改变条目
// 边界，两件事不要混在一层。
export function writeFilesEntries(elementText) {
  return String(elementText ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .split(/\s*\n\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => entry.split(';'))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// 任务块「有写面」判定（本条判定的唯一落点）：元素在场**且**按条目边界切出的条目非空——空元素与
// 只有注释的元素都是「写面不可判」，不是「写面为空」。元素提取与条目边界都取本模块的唯一实现，
// 故「7 字段门判字段在场」与「算不算有写面」不会在元素名大小写或注释剥离上分叉：分叉时任务被
// 静默排除在判定面之外，而判据缺席与判据通过在下游看起来一样（都只是「没有明细」）。
export function taskHasWriteFace(block) {
  const element = writeFilesElement(block);
  return element !== null && writeFilesEntries(element).length > 0;
}

// 路径段 → 词元：目录名与文件主干（去最后一层扩展名）按非字母数字切分，长度 ≥3、去停用词、去纯数字。
// 只在「命中计算」这一侧做长度与停用词过滤——条目关键词侧原样保留，过滤口径不扩散成第二份规则。
// 条目边界同样取 writeFilesEntries（本模块内不再有第二份按行/分号的切分：注释里的词不构成路径）。
export function lessonsPathTokens(writeFilesText) {
  const tokens = new Set();
  for (const raw of writeFilesEntries(writeFilesText)) {
    const segments = raw.trim().replace(/\\/gu, '/').split('/').filter((s) => s !== '' && s !== '.' && s !== '..');
    segments.forEach((segment, index) => {
      const body = index === segments.length - 1 ? segment.replace(/\.[^.]*$/u, '') : segment;
      for (const piece of body.split(/[^0-9A-Za-z\u4e00-\u9fff]+/u)) {
        const token = piece.toLowerCase();
        if ([...token].length < 3) continue;
        if (/^\d+$/u.test(token)) continue;
        if (LESSONS_PATH_STOPWORDS.has(token)) continue;
        tokens.add(token);
      }
    });
  }
  return tokens;
}

// LESSONS 条目：`### L-NNN` 标题开启一个条目，块内 `- **关键词**:` 行的词元即命中输入；下一个 H2
// 结束条目区（区外的 `###` 不参与）。围栏代码块内是书写样例（模板里的「条目格式」示例即此形态），
// 按行扫描会被误当成真条目——围栏内一律跳过。围栏语法取段体单源的 isFenceLine（反引号与波浪号
// 同口径）：本模块自写一份只认反引号的判定时，`~~~` 围栏里的示例条目会被当成真条目，出口与
// request 打印面因此凭空多出「该回应」的编号。无关键词行的条目不进结果集（旧条目跳过）。
// title 只供打印面识别「是哪条教训」；命中判定与出口验收都只看 id / 关键词词元。
export function lessonsEntries(lessonsText) {
  const entries = [];
  let current = null;
  let inFence = false;
  for (const line of String(lessonsText ?? '').replace(/\r\n?/gu, '\n').split('\n')) {
    if (isFenceLine(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^##\s/u.test(line)) { current = null; continue; }
    const heading = line.match(LESSONS_ENTRY_HEADING);
    if (heading) {
      current = {
        id: 'L-' + String(Number(heading[1])).padStart(3, '0'),
        title: line.slice(heading[0].length).replace(LESSONS_TITLE_LEAD, '').trim(),
        tokens: [],
        order: entries.length,
      };
      entries.push(current);
      continue;
    }
    if (current === null) continue;
    const keyword = line.match(LESSONS_KEYWORD_LINE);
    if (!keyword) continue;
    for (const piece of keyword[1].split(/[\s,，、;；/|]+/u)) {
      const token = piece.trim().toLowerCase();
      if (token !== '') current.tokens.push(token);
    }
  }
  return entries.filter((entry) => entry.tokens.length > 0);
}

// 命中计算：路径词元 × 条目关键词词元求交，共享词元多的条目优先（相关度），同分按条目出现顺序
// （结果确定、可复核），取前 LESSONS_HIT_LIMIT 条。
export function lessonsHits(pathTokens, entries) {
  if (pathTokens.size === 0) return [];
  const scored = [];
  for (const entry of entries) {
    const shared = [...new Set(entry.tokens.filter((token) => pathTokens.has(token)))];
    if (shared.length === 0) continue;
    scored.push({ id: entry.id, title: entry.title ?? '', shared, order: entry.order });
  }
  scored.sort((a, b) => b.shared.length - a.shared.length || a.order - b.order);
  return scored.slice(0, LESSONS_HIT_LIMIT);
}
