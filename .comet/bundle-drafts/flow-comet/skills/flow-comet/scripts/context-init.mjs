#!/usr/bin/env node
// context-init.mjs — 自动初始化检测（init 前置步骤）
// 探测项目上下文状态 → 判决 A~F → 提示/静默；--init-context 全量生成 .specs/CONTEXT.md
// 由 workflow-state.mjs init 分支调用；独立模块便于 guard-self-test 集成测试。
// 文案为公开描述性中文（无内部概念）。

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
export function printDetection(probe, verdict, out = console) {
  if (verdict === 'skip') return;
  if (verdict === 'hint') {
    out.log(`INIT-HINT: 项目上下文（CONTEXT.md）已存在但上次扫描已 ${probe.lastScanDays} 天。可重跑全量刷新：init <change-id> --init-context（可选，不强制）。`);
    return;
  }
  let detail = '';
  if (verdict === 'needed-d') {
    detail = `检测到既有 AI 上下文文档：\n  - ${probe.aiDocs.join('\n  - ')}`;
  }
  const skeletonNote = verdict === 'needed-skeleton' ? '（新项目骨架，占位随流程沉淀）' : '';
  out.log(`INIT-NEEDED: 项目上下文（CONTEXT.md）尚未初始化${skeletonNote}。${detail ? '\n' + detail : ''}\n初始化将：读取既有文档并整合（带出处标注）+ 全量代码探测，生成结构化的项目上下文。\n成本：约 15-30k tokens（仅首次）。同意请重跑：init <change-id> --init-context；拒绝：--init-skip。`);
}

// 读取文档关键行（全量阅读后提取含约定/规范/命名/决策等关键词的行，标注出处）
async function readDocLines(root, rel) {
  const full = path.join(root, rel);
  try {
    const text = await fs.readFile(full, 'utf8');
    return text.split('\n').map((l, i) => ({ line: i + 1, text: l }));
  } catch { return []; }
}

const KEYWORD_RE = /约定|规范|命名|决策|禁用|禁止|风格|策略|结构|目录|依赖|框架|部署/;

// 全量初始化：读既有文档 → 整合（出处标注）→ 代码探测 → 生成 CONTEXT.md（模板 7 段）
// 返回 { state 更新字段（last_intel_scan）由调用方写回 }；生成失败抛错（fail-closed）
export async function runFullInit(runRoot, probe) {
  const sections = [];
  const sources = [];

  // 1. 源文档段（顶部）
  const allDocs = [...probe.aiDocs, ...probe.projectDocs];
  if (allDocs.length > 0) {
    sources.push('## 源文档');
    sources.push('');
    sources.push('> 以下既有文档的关键决策已整合进本文件对应段（出处标注 `来自 <doc>:<line>`）；原文档保持不动。');
    for (const d of allDocs) sources.push(`- \`${d}\``);
    sources.push('');
  }

  // 2. 既有文档整合（全量阅读 → 关键行 → 对应段）
  const terms = [];
  const decisions = [];
  const prefs = [];
  const naming = [];
  const forbidden = [];
  for (const doc of allDocs) {
    const lines = await readDocLines(runRoot, doc);
    for (const l of lines) {
      if (!KEYWORD_RE.test(l.text)) continue;
      const t = l.text.trim();
      if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('---')) continue;
      const cite = `（来自 \`${doc}:${l.line}\`）`;
      if (/命名|风格|规范/.test(t)) naming.push(`- ${t} ${cite}`);
      else if (/禁用|禁止/.test(t)) forbidden.push(`- ${t} ${cite}`);
      else if (/决策/.test(t)) decisions.push(`- ${t} ${cite}`);
      else if (/策略|偏好|约定/.test(t)) prefs.push(`- ${t} ${cite}`);
      else terms.push(`| ${t.slice(0, 40)} | ${cite} |`);
    }
  }

  // 3. 代码探测（依赖 → 技术栈；目录 → 抽象索引）
  const stackLines = await detectStack(runRoot, probe);

  // 4. 生成模板 7 段
  const lines = [];
  lines.push('# CONTEXT — 项目共享上下文');
  lines.push('');
  lines.push('> 本文件跨 change 长期累积（自动初始化生成，2026 起）。格式基准：flow-kit 模板。');
  lines.push('');
  lines.push('---');
  lines.push('');
  if (sources.length > 0) { lines.push(...sources); lines.push(''); }
  lines.push('## 项目概要');
  lines.push('');
  lines.push('（自动初始化生成——请补 3~5 句话：项目是什么、给谁、为什么存在）');
  lines.push('');
  lines.push('## 技术栈（团队级默认 / 已锁定）');
  lines.push('');
  lines.push(...stackLines);
  lines.push('');
  lines.push('## 域语言（术语表）');
  lines.push('');
  lines.push('| 术语 | 定义 |');
  lines.push('|---|---|');
  if (terms.length > 0) lines.push(...terms);
  else lines.push('| （待沉淀） | 随 change 逐步补充 |');
  lines.push('');
  lines.push('## 已锁决策');
  lines.push('');
  lines.push('按时间倒序追加：');
  lines.push('');
  if (decisions.length > 0) lines.push(...decisions);
  else lines.push('- （自动初始化——既有文档关键决策已整合至此，后续 change 按时间倒序追加）');
  lines.push('');
  lines.push('## 默认偏好（AI 在缺省时按此决策）');
  lines.push('');
  if (prefs.length > 0) lines.push(...prefs);
  else lines.push('- （自动初始化——既有文档约定已整合至此；随 change 补充）');
  lines.push('');
  if (naming.length > 0) {
    lines.push('## 既有抽象索引（来自 I-intel-scan · 防 AI 重复实现 · B5 老项目护栏）');
    lines.push('');
    lines.push('### 命名约定');
    lines.push('');
    lines.push(...naming);
    lines.push('');
  }
  if (forbidden.length > 0) {
    if (!naming.length) {
      lines.push('## 既有抽象索引（来自 I-intel-scan · 防 AI 重复实现 · B5 老项目护栏）');
      lines.push('');
    }
    lines.push('### 禁动清单（AI 不许"顺手"碰）');
    lines.push('');
    lines.push(...forbidden);
    lines.push('');
  }
  if (!naming.length && !forbidden.length) {
    lines.push('## 既有抽象索引（来自 I-intel-scan · 防 AI 重复实现 · B5 老项目护栏）');
    lines.push('');
    lines.push('> 代码抽象探测结果（自动初始化）：');
    lines.push('');
    lines.push('### 数据库访问');
    lines.push('');
    lines.push('- **模式**：未发现（无数据库抽象）');
    lines.push('');
    lines.push('### 工具函数（utils / helpers）');
    lines.push('');
    lines.push('| 工具类型 | 路径 | 入口符号 |');
    lines.push('|---|---|---|');
    lines.push('| 日期 | 未发现 | — |');
    lines.push('');
    lines.push('### 禁动清单（AI 不许"顺手"碰）');
    lines.push('');
    lines.push('> 初始为空——随 change 的 DESIGN 0.5.1 逐步补充。');
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## intel-scan 元数据');
  lines.push('');
  lines.push(`- **last_intel_scan**: ${new Date().toISOString().slice(0, 10)}`);
  lines.push('- **scanner**: flow-comet 自动初始化');
  lines.push('- **下次重扫建议**: 90 天后（或架构重构/框架升级时）');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('> 此文件长度建议 ≤ 300 行；超出时把陈旧条目归档到 `.specs/archive/CONTEXT-history.md`。');

  const target = path.join(runRoot, '.specs', 'CONTEXT.md');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, lines.join('\n'), 'utf8');
  return target;
}

// 依赖探测 → 技术栈字段（简单映射，覆盖常见信号）
async function detectStack(runRoot, probe) {
  const out = [];
  if (await exists(path.join(runRoot, 'package.json'))) {
    out.push('- **语言/运行时**: Node.js（检测到 package.json）');
    out.push('- **包管理**: npm / yarn / pnpm（按 lockfile 而定）');
  } else if (await exists(path.join(runRoot, 'pyproject.toml'))) {
    out.push('- **语言/运行时**: Python（检测到 pyproject.toml）');
  } else if (await exists(path.join(runRoot, 'go.mod'))) {
    out.push('- **语言/运行时**: Go（检测到 go.mod）');
  } else if (await exists(path.join(runRoot, 'Cargo.toml'))) {
    out.push('- **语言/运行时**: Rust（检测到 Cargo.toml）');
  } else {
    out.push('- **语言/运行时**: （待补充——未识别依赖文件）');
  }
  out.push('- **前端框架**: （待补充）');
  out.push('- **后端框架**: （待补充）');
  out.push('- **数据库**: （待补充）');
  out.push('- **测试**: （待补充）');
  out.push('- **构建/部署**: （待补充）');
  out.push('- **栈卡片编号**: （不适用/待补充）');
  return out;
}

// --init-skip：记 none（由调用方写回 state）
export function skipInit(state) {
  state.ai_context_doc = 'none';
  return state;
}
