#!/usr/bin/env node
// context-init.mjs — 自动初始化检测（init 前置步骤）
// 探测项目上下文状态 → 判决 A~F → 提示/静默；--init-context 全量生成 .specs/CONTEXT.md
// 由 workflow-state.mjs init 分支调用；独立模块便于 guard-self-test 集成测试。
// 文案为公开描述性中文（无未公开概念）。

import { promises as fs } from 'fs';
import path from 'path';

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
    name: '域语言表格表头',
    applies: (t) => t.includes('## 域语言'),
    passes: (t) => /\|\s*术语\s*\|\s*定义\s*\|/.test(t),
    hint: '模板表格 `| 术语 | 定义 |`',
  },
];

// 校验 .specs/CONTEXT.md 7 段结构 + 模板关键格式；文件缺失 = 全缺。返回
// { missingSections, formatIssues, template }（missingSections 与 formatIssues 皆空 = 通过）。
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
  const missingSections = sections.filter((s) => !text.includes(s));
  const formatIssues = CONTEXT_FORMAT_CHECKS
    .filter((c) => c.applies(text) && !c.passes(text))
    .map((c) => c.name + '（' + c.hint + '）');
  return { missingSections, formatIssues, template: await probeTemplate(runRoot) };
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
