#!/usr/bin/env node
// context-init.mjs — 自动初始化检测（init 前置步骤）
// 探测项目上下文状态 → 判决 A~F → 提示/静默；--init-context 全量生成 .specs/CONTEXT.md
// 由 workflow-state.mjs init 分支调用；独立模块便于 guard-self-test 集成测试。
// 文案为公开描述性中文（无未公开概念）。
//
// 本模块同时是「项目上下文」判定的单一来源：独立重扫命令 context-scan.mjs 复用同一组导出
// （探测 / 判决 / 结构校验 / 生成指引 / 结构提取），不复制第二份实现——同一判据两份实现必然分叉。

import { promises as fs } from 'fs';
import path from 'path';
import { EVOLVE_METADATA_SECTION, EVOLVE_METADATA_FIELDS } from './state-schema.mjs';

// 既有 AI 上下文文档探测清单（与 flow-kit 入场判定同源：AGENTS/CLAUDE/Cursor/Windsurf/Copilot/Cline）
const AI_DOC_CANDIDATES = [
  { name: 'AGENTS.md', dirs: ['.'] },
  { name: 'CLAUDE.md', dirs: ['.', '.claude'] },
  { name: '.clinerules', dirs: ['.'] },
  { name: '.github/copilot-instructions.md', dirs: ['.'] },
];
const AI_DOC_GLOBS = ['.cursor/rules', '.windsurf/rules'];

// 项目级文档（非 AI 专用但含项目信息——整合时一并读取）
const PROJECT_DOC_CANDIDATES = [
  { name: 'README.md', dirs: ['.'] },
  { name: 'ARCHITECTURE.md', dirs: ['.', 'docs'] },
  { name: 'CONTRIBUTING.md', dirs: ['.'] },
];

// 代码上下文信号（判定 greenfield）
const CODE_SIGNAL_FILES = [
  'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml',
  'build.gradle', 'composer.json', 'Gemfile', 'requirements.txt', 'tsconfig.json',
];
const CODE_SIGNAL_DIRS = ['src', 'lib', 'app'];

const CONTEXT_90_DAYS = 90 * 24 * 60 * 60 * 1000;

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function listMd(root, dirRel) {
  const dir = path.join(root, dirRel);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => path.join(dirRel, e.name));
  } catch { return []; }
}

// 探测项目上下文：返回 { hasContext, lastScanDays, aiDocs, projectDocs, hasCodeContext }
export async function probeProject(runRoot, state) {
  const specsContext = path.join(runRoot, '.specs', 'CONTEXT.md');
  const rootContext = path.join(runRoot, 'CONTEXT.md');
  const hasContext = await exists(specsContext) || await exists(rootContext);

  let lastScanDays = null;
  if (state && state.last_intel_scan) {
    const t = Date.parse(state.last_intel_scan);
    if (!Number.isNaN(t)) lastScanDays = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
  }

  const aiDocs = [];
  for (const c of AI_DOC_CANDIDATES) {
    for (const d of c.dirs) {
      const p = path.join(runRoot, d, c.name);
      if (await exists(p)) aiDocs.push(path.join(d, c.name).replace(/^\.\//, ''));
    }
  }
  for (const g of AI_DOC_GLOBS) {
    const found = await listMd(runRoot, g);
    aiDocs.push(...found);
  }

  const projectDocs = [];
  for (const c of PROJECT_DOC_CANDIDATES) {
    for (const d of c.dirs) {
      const p = path.join(runRoot, d, c.name);
      if (await exists(p)) projectDocs.push(path.join(d, c.name).replace(/^\.\//, ''));
    }
  }

  let hasCodeContext = false;
  for (const f of CODE_SIGNAL_FILES) {
    if (await exists(path.join(runRoot, f))) { hasCodeContext = true; break; }
  }
  if (!hasCodeContext) {
    for (const d of CODE_SIGNAL_DIRS) {
      if (await exists(path.join(runRoot, d))) { hasCodeContext = true; break; }
    }
  }

  return { hasContext, lastScanDays, aiDocs, projectDocs, hasCodeContext };
}

// 判决：A 记忆静默 / B 新鲜静默 / C 过期 HINT / D 有 AI 文档 NEEDED / E 有代码 NEEDED / F greenfield NEEDED-skeleton
export function classify(probe, state) {
  if (state && state.ai_context_doc) return 'skip';                       // A
  if (probe.hasContext) {
    if (probe.lastScanDays !== null && probe.lastScanDays <= 90) return 'skip'; // B
    return 'hint';                                                          // C
  }
  if (probe.aiDocs.length > 0) return 'needed-d';                           // D
  if (probe.hasCodeContext) return 'needed';                                // E
  return 'needed-skeleton';                                                 // F
}

// 输出提示（公开描述性文案；INIT-NEEDED 含预算说明与参数指引）
// C 优化（2026-08-10）：CONTEXT 已满足模板但无扫描记录（agent 生成后未重跑）→
// 提示精准动作（记录扫描时间）而非误导性的"刷新"文案。
export async function printDetection(runRoot, probe, verdict, out = console) {
  if (verdict === 'skip') return;
  if (verdict === 'hint') {
    // DF-1: 无扫描记录（旧项目迁移，lastScanDays=null）时不拼 null 进文案
    const freshness = probe.lastScanDays === null ? '上次扫描时间未知' : `上次扫描已 ${probe.lastScanDays} 天`;
    if (probe.lastScanDays === null) {
      // C: CONTEXT 已满足模板（agent 生成后未重跑）→ 精准指引；不满足 → 刷新/重写指引
      const { missingSections, formatIssues } = await validateContext(runRoot);
      if (missingSections.length === 0 && formatIssues.length === 0) {
        out.log('INIT-HINT: 项目上下文（CONTEXT.md）已就绪（7 段 + 模板格式校验通过）但尚未记录扫描时间。运行 init <change-id> --init-context 记录扫描时间即可（此后 90 天内不再提示）。');
        return;
      }
    }
    out.log(`INIT-HINT: 项目上下文（CONTEXT.md）已存在但${freshness}。可重跑全量刷新：init <change-id> --init-context（可选，不强制）。`);
    return;
  }
  let detail = '';
  if (verdict === 'needed-d') {
    detail = `检测到既有 AI 上下文文档：\n  - ${probe.aiDocs.join('\n  - ')}`;
  }
  const skeletonNote = verdict === 'needed-skeleton' ? '（新项目骨架，占位随流程沉淀）' : '';
  out.log(`INIT-NEEDED: 项目上下文（CONTEXT.md）尚未初始化${skeletonNote}。${detail ? '\n' + detail : ''}\n初始化将：读取既有文档并整合（带出处标注）+ 全量代码探测，生成结构化的项目上下文。\n成本：约 15-30k tokens（仅首次）。同意请重跑：init <change-id> --init-context；拒绝：--init-skip。`);
}

// CONTEXT 模板 7 段标题（校验基准——agent 生成后脚本校验结构完整性）
// 2026-08-10 改进：段清单从 flow-kit/templates/CONTEXT.md 解析派生（括号前前缀），
// 模板缺失/解析不到时 fallback 内置（对齐 C2 段名校验模板派生模式，消灭手抄漂移）。
const CONTEXT_SECTIONS_FALLBACK = [
  '## 项目概要',
  '## 技术栈',
  '## 域语言',
  '## 已锁决策',
  '## 默认偏好',
  '## 既有抽象索引',
  '## intel-scan 元数据',
];

// 模板存在性探测：返回 { exists, path }——flow-kit 是否安装在目标项目
export async function probeTemplate(runRoot) {
  const p = path.join(runRoot, 'flow-kit', 'templates', 'CONTEXT.md');
  try { await fs.access(p); return { exists: true, path: p }; } catch { return { exists: false, path: p }; }
}

// 从模板派生 7 段标题清单（`## 名称（后缀）` → `## 名称` 前缀）；模板缺失/解析失败返回 null
async function deriveSections(runRoot) {
  const { exists, path: p } = await probeTemplate(runRoot);
  if (!exists) return null;
  try {
    const text = await fs.readFile(p, 'utf8');
    const sections = [...text.matchAll(/^## ([^\n(（]+)/gm)]
      .map((m) => m[1].trim())
      .filter((s) => s.length > 0 && s.length <= 30);
    return sections.length >= 7 ? sections : null;
  } catch { return null; }
}

// 校验段清单（模板派生优先，fallback 内置）
async function contextSections(runRoot) {
  const derived = await deriveSections(runRoot);
  return derived ?? CONTEXT_SECTIONS_FALLBACK;
}

// `## evolve 元数据` 第三字段的**旧别名**：并行协作期两条产出线各自定名时留下的双写容差，全库
// 无任何生产者，故已从通过判据移除（取值单形 = state-schema 的 EVOLVE_METADATA_FIELDS）。本常量
// 只用于**提示**：既有文档带该别名时，报错文案点名它并给出应写字段，让格式问题可见且可改写。
const EVOLVE_DEPRECATED_SUGGESTION_FIELD = '下次同步建议';
// 模板关键格式检查（flow-kit/templates/CONTEXT.md 基准——段存在时校验其内格式，确定性检查）
const CONTEXT_FORMAT_CHECKS = [
  {
    name: '已锁决策条目日期前缀',
    applies: (t) => t.includes('## 已锁决策'),
    // 段内列表条目须带日期 `- [20xx-xx-xx]`；占位条目（[xxx] 形态/待沉淀类/模板尖括号）放行——
    // 新项目骨架（无历史决策）不应被格式校验拒绝（DF-5）。
    passes: (t) => {
      const seg = (t.split('## 已锁决策')[1] ?? '').split('\n##')[0];
      const items = seg.split('\n').filter((l) => /^\s*-\s+/.test(l));
      if (items.length === 0) return true; // 空段放行
      const bare = items.filter((l) => {
        if (/-\s+\[20\d\d-\d\d-\d\d\]/.test(l)) return false; // 真实日期条目
        if (/-\s+\[[^\]]*\]/.test(l)) return false;            // [xxx] 形态（含模板占位 [YYYY-MM-DD]）
        if (/-\s+（?(待沉淀|待补充|待写入)|<[^>]+>/.test(l)) return false; // 中文占位 / 模板尖括号
        return true; // 裸条目（无日期无占位形态）
      });
      return bare.length === 0;
    },
    hint: '模板格式 `- [YYYY-MM-DD] 决策 — 来自 @...`',
  },
  {
    name: 'intel-scan 元数据三字段',
    applies: (t) => t.includes('## intel-scan 元数据'),
    passes: (t) => t.includes('**last_intel_scan**') && t.includes('**scanner**') && t.includes('**下次重扫建议**'),
    hint: '模板字段 last_intel_scan / scanner / 下次重扫建议',
  },
  {
    // evolve 段是**可选段**：没跑过架构沉淀的项目不补段（缺席不报），跑过的项目段内三字段必须齐——
    // 「跑过一次但字段写残」正是最需要拦的半成品（段在场却少字段，元数据双落点会静默失真）。
    // 段名与三字段名都取自 state-schema.mjs 的单一常量集（写方 evolve.mjs 同源），本处不再写字面量。
    name: EVOLVE_METADATA_SECTION + '三字段',
    // 三字段判定**限定在段内**（sectionBody 切片）：全文 includes 会被别处的同名字段蒙混过关——
    // 例如 intel-scan 段有 `**scanner**` 而 evolve 段少这一个字段，全文判定照样放行。
    applies: (t) => sectionBody(t, '## ' + EVOLVE_METADATA_SECTION) !== null,
    // 通过判据是**单形**的：取值只认常量集（写方真实产出的三个字段名）。旧的协作期容差别名
    // （`下次同步建议`）没有任何生产者，已从判据中移除——容纳它就是「校验集合 ⊃ 生产集合」，
    // 写残的段会被静默放行。带旧别名的既有文档由下方 hint 给出可见的改写指引，不是静默失败。
    passes: (t) => {
      const segment = sectionBody(t, '## ' + EVOLVE_METADATA_SECTION) ?? '';
      return EVOLVE_METADATA_FIELDS.every((field) => segment.includes('**' + field + '**'));
    },
    hint: '字段 ' + EVOLVE_METADATA_FIELDS.join(' / ') + '；与 intel-scan 段同构'
      + '（旧别名「' + EVOLVE_DEPRECATED_SUGGESTION_FIELD + '」不再接受，请改写为「'
      + EVOLVE_METADATA_FIELDS[2] + '」）',
  },
  {
    name: '域语言表格表头',
    applies: (t) => t.includes('## 域语言'),
    passes: (t) => /\|\s*术语\s*\|\s*定义\s*\|/.test(t),
    hint: '模板表格 `| 术语 | 定义 |`',
  },
];

// 段名规范化：兼容「带 `## ` 前缀」（内置 fallback）与「不带前缀」（模板派生）两种来源，
// 并剥离模板标题的括注后缀（`已锁决策（ADR 摘要）` → `已锁决策`，与 deriveSections 同口径）。
// 第三项剥离 **ATX 闭合标记**（`## 名称 ##` 的尾部 `##`）：它是合法 Markdown 语法，
// 不剥离时段名归一成 `名称 ##`，与模板段名不等 → 七段被整片判成缺失
// （INIT-VALIDATE-FAILED），依赖 CONTEXT 结构校验的正常路径被误阻断。
// 闭合标记按 CommonMark 收口：必须**前置空白**（故 `C#` 这类以井号结尾的段名不被误剥），
// 其后可跟空白。
function normalizeSectionName(name) {
  return String(name ?? '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/[（(].*$/, '')
    .replace(/[ \t]+#+[ \t]*$/, '')
    .trim();
}

// 围栏代码块剥离：标题/格式判定的输入必须是「文档结构」，而代码示例里的 `## 段名` 只是示例文本。
// 不剥离会让缺段的 CONTEXT 假通过——只要围栏示例里出现该段名，标题解析就把它当成段存在
// （校验放行并写入扫描时间）。围栏识别按 CommonMark 收口：
//   · 开栏 = 至多 3 空格缩进 + 连续 3 个及以上 ` 或 ~（后续为语言标注等信息串）
//   · 反引号围栏的信息串不得含反引号（否则是行内代码而非围栏）
//   · 闭栏须与开栏同字符、长度不短于开栏、其后仅余空白；不同字符的围栏互不闭合
//   · 围栏内的行（含 `## 标题`）一律不计入结构判定
function stripFencedCodeBlocksMapped(text) {
  const rawLines = String(text ?? '').split('\n');
  const kept = [];
  const rawLineIndex = []; // 结构行 → 原文行号（写回元数据字段时据此精确定位，不另写一份围栏规则）
  let fenceChar = null;
  let fenceLength = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceChar === null) {
      if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
        fenceChar = fence[1][0];
        fenceLength = fence[1].length;
        continue;
      }
      kept.push(line);
      rawLineIndex.push(i);
      continue;
    }
    if (
      fence &&
      fence[1][0] === fenceChar &&
      fence[1].length >= fenceLength &&
      fence[2].trim() === ''
    ) {
      fenceChar = null;
      fenceLength = 0;
    }
  }
  return { text: kept.join('\n'), rawLineIndex };
}

function stripFencedCodeBlocks(text) {
  return stripFencedCodeBlocksMapped(text).text;
}

// 文档标题集合（ATX 标题行：行首 #~###### + 空白 + 标题文本；正文文本不参与）。
// 输入为「文档结构」文本（围栏代码块已由 stripFencedCodeBlocks 剥离——见 validateContext）。
function headingSet(text) {
  const set = new Set();
  for (const m of String(text ?? '').matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)) {
    set.add(normalizeSectionName(m[1]));
  }
  return set;
}

// 二级段标题在场判定 + 段体切片（与 headingSet 同一标题语法，但要求**恰好二级**）。
// 格式检查的「段在场」与「段内字段」都用它们：正文里提到段名（例如术语表的定义列写
// `## evolve 元数据`）不得算段在场——可选段的「缺席不报」语义完全依赖这一点；字段判定限定段内，
// 否则别处的同名标签会替缺失字段蒙混过关。必填段的同名检查沿用历史 includes 写法（缺段另有
// missingSections 兜底，报道面不变），故两条检查的在场判据措辞不同是刻意的，不是漏改。
function sectionBody(body, headingName) {
  const wanted = normalizeSectionName(headingName);
  const kept = [];
  let inSection = false;
  for (const line of String(body ?? '').split('\n')) {
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (inSection && level <= 2) break; // 到下一个同级或更高级标题即段结束
      if (!inSection && level === 2 && normalizeSectionName(heading[2]) === wanted) {
        inSection = true;
        continue;
      }
    }
    if (inSection) kept.push(line);
  }
  return inSection ? kept.join('\n') : null;
}

// 校验 .specs/CONTEXT.md 7 段结构 + 模板关键格式；文件缺失 = 全缺。返回
// { missingSections, formatIssues, template }（missingSections 与 formatIssues 皆空 = 通过）。
// 段存在判定 = **精确标题匹配**（标题名归一后相等）：全文 includes 会把段名变体
// （`## 项目概要补充`）与正文提及误判为段存在，使不满足模板的 CONTEXT 记录为完成。
// 生成由 agent 执行（intel-scan 全量阅读语义）——脚本只做确定性结构/格式校验，不做智能整合。
export async function validateContext(runRoot) {
  const target = path.join(runRoot, '.specs', 'CONTEXT.md');
  const sections = await contextSections(runRoot);
  let text;
  try {
    text = await fs.readFile(target, 'utf8');
  } catch {
    return { missingSections: [...sections], formatIssues: [], template: await probeTemplate(runRoot) };
  }
  // 结构判定一律只看「文档结构」文本：围栏代码块（代码示例）内的行不参与段存在与格式判定——
  // 两条判据共用同一输入，避免同一份文本上出现两条相反口径
  const body = stripFencedCodeBlocks(text);
  const headings = headingSet(body);
  const missingSections = sections.filter((s) => !headings.has(normalizeSectionName(s)));
  const formatIssues = CONTEXT_FORMAT_CHECKS
    .filter((c) => c.applies(body) && !c.passes(body))
    .map((c) => c.name + '（' + c.hint + '）');
  return { missingSections, formatIssues, template: await probeTemplate(runRoot) };
}

// 抽象索引段名（模板段名归一后的形态：`## 既有抽象索引（…）` → `既有抽象索引`）
const ABSTRACTION_SECTION = '既有抽象索引';
// 元数据段名特征：段名以「元数据」结尾（`intel-scan 元数据` / `evolve 元数据` 同构）
const METADATA_SECTION_SUFFIX = '元数据';
// 元数据字段条目形态：`- **字段**: 值`（值可带括号说明，替换时只换首个取值词元）
const METADATA_FIELD_LINE = /^\s*-\s*\*\*([^*]+)\*\*\s*[:：]\s*(.*)$/;
// 表格分隔行（`|---|---|`）不是内容条目
const TABLE_SEPARATOR_LINE = /^\|[\s:|-]+\|$/;

// 抽象索引段内的一行是否算「条目」：忽略空行 / 引用块（说明性导语）/ 表格分隔行；
// 其余行原样收录（压缩行内空白）——条目的**取值**即快照比对对象，不做语义归一。
function abstractionItem(line) {
  const text = String(line ?? '').trim();
  if (text === '' || text.startsWith('>')) return null;
  if (TABLE_SEPARATOR_LINE.test(text)) return null;
  return text.replace(/\s+/g, ' ');
}

// CONTEXT 结构提取（独立重扫命令复用 · 与 validateContext 共用同一份结构知识）：
// 围栏剥离 + 段名归一 + 标题判定都在本模块唯一表达——结构判定若在第二个模块重写，
// 两处对「哪一行算结构」的口径必然分叉（同一判据两份实现）。本函数只做**提取**，不做判决。
// 返回：
//   · sections         —— 归一后的段名清单（文档序，含非基准段；用于「段新增 / 段消失」比对）
//   · abstractionIndex —— { '<子段名>': ['<条目行>', …] }（`## 既有抽象索引` 段内；未分组条目归 '(未分组)'）
//   · metadata         —— { '<段名>': { '<字段>': { value, lineIndex } } }（段名以「元数据」结尾的段；
//                        lineIndex = 该字段行在**原文**中的行号，写回时据此精确替换，不重写整段）
export function extractContextStructure(text) {
  const { text: body, rawLineIndex } = stripFencedCodeBlocksMapped(text);
  const lines = body.split('\n');
  const sections = [];
  const abstractionIndex = {};
  const metadata = {};
  let section = null;
  let group = '(未分组)';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (heading) {
      const name = normalizeSectionName(heading[2]);
      if (heading[1].length === 2) {
        section = name;
        group = '(未分组)';
        sections.push(name);
        continue;
      }
      if (heading[1].length === 3 && section === ABSTRACTION_SECTION) {
        group = name;
        continue;
      }
    }
    if (section === ABSTRACTION_SECTION) {
      const item = abstractionItem(line);
      if (item !== null) {
        if (!abstractionIndex[group]) abstractionIndex[group] = [];
        abstractionIndex[group].push(item);
      }
      continue;
    }
    if (section !== null && section.endsWith(METADATA_SECTION_SUFFIX)) {
      if (!metadata[section]) metadata[section] = {};
      const field = METADATA_FIELD_LINE.exec(line);
      if (field) metadata[section][field[1].trim()] = { value: field[2].trim(), lineIndex: rawLineIndex[i] };
    }
  }
  return { sections, abstractionIndex, metadata };
}

// 生成指引（--init-context 时 CONTEXT 缺失或不满足模板时输出）——生成由 agent 全量阅读执行：
// 读取既有文档（含既有 CONTEXT 的累积术语/决策）并整合（出处标注 `来自 <doc>:<line>`），
// 探测代码技术栈/抽象索引，**对照 flow-kit/templates/CONTEXT.md 模板**产出 7 段；既有文档零写入。
// rewrite=true：CONTEXT 已存在但不满足模板（缺段/格式不符）——重写，保留既有累积内容。
export async function printGenerationGuide(runRoot, probe, { rewrite = false, problems = [] } = {}, out = console) {
  const template = await probeTemplate(runRoot);
  const tplNote = template.exists
    ? '模板：flow-kit/templates/CONTEXT.md（已检测到——严格对照模板段名与条目格式）'
    : '模板：flow-kit/templates/CONTEXT.md（未检测到——按 7 段基准：项目概要 / 技术栈 / 域语言 / 已锁决策 / 默认偏好 / 既有抽象索引 / intel-scan 元数据）';
  const lines = [];
  if (rewrite) {
    const why = problems.length > 0 ? problems.join('；') : '缺段';
    lines.push(`INIT-VALIDATE-FAILED: CONTEXT.md 已存在但不满足模板（${why}）。请重写——保留既有 CONTEXT 的累积术语/决策（跨 change 长期累积语义），出处标注 \`来自 <doc>:<line>\`，原文档零写入。${tplNote}`);
  } else {
    lines.push('INIT-GENERATE: 项目上下文未初始化——请生成 .specs/CONTEXT.md。' + tplNote);
  }
  const docs = [...probe.aiDocs, ...probe.projectDocs];
  if (docs.length > 0) {
    lines.push('源文档（全量阅读并整合，出处标注 `来自 <doc>:<line>`；原文档零写入）：');
    for (const d of docs) lines.push('  - ' + d);
  }
  if (probe.hasCodeContext) {
    lines.push('代码信号：已检测到代码上下文（依赖文件或源码目录）——探测技术栈并登记既有抽象索引。');
  }
  lines.push('生成后重跑：init <change-id> --init-context（脚本校验 7 段并记录扫描时间）。');
  out.log(lines.join('\n'));
}

// --init-skip：记 none（由调用方写回 state）
export function skipInit(state) {
  state.ai_context_doc = 'none';
  return state;
}
