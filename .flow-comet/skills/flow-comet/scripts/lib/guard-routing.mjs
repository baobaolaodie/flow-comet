// 共享判定枢纽（守卫模块）：路由谓词、证据/产物存在性判据、节点技能命名、模板段名派生、
// Fix 段标题派生。这些判据被入口与其余守卫模块共用，故落此处一处实现——入口零内联副本。
//
// 依赖方向单向：本模块 → 既有共享模块（state-schema / protocol-utils / task-parsing /
// route-node）+ guard-state-io；反向 import 不存在。

import { promises as fs } from 'fs';
import path from 'path';
import { handoffRequestWithdrawn } from '../state-schema.mjs';
import { inspectWorkflowProtectedPath } from '../protocol-utils.mjs';
import { taskOpeningAttrs } from '../task-parsing.mjs';
import { resolveNextNode, normalizeHeading, FIX_SECTION_TITLE_FALLBACK } from '../route-node.mjs';
import { runRoot, fileExists, workflowRelativeSegments } from './guard-state-io.mjs';
import { buildSkeleton } from './guard-artifact-skeleton.mjs';

// 新旧 change 区分——init 写入的 newChange: true = 新 change（严格，不依赖 entry——防系统性
// 跳 entry 绕过）；缺失/非 true（旧 change）= 渐进 WARN 兼容。
export function isNewChange(state) {
  return state.newChange === true;
}

// flow-kit SUMMARY 模板必填段（正则匹配，大小写不敏感 + 变体兼容）
export const SUMMARY_REQUIRED_SECTIONS = [
  { regex: /##\s*verify\s*输出/i, label: '## verify 输出' },
  { regex: /##\s*6\s*维自查/i, label: '## 6 维自查' },
  { regex: /##\s*(越界检查|边界检查)/i, label: '## 越界检查' },
];

// 校验 change 目录下每份 *-SUMMARY.md 含 SUMMARY 模板的三个必填段。用正则（大小写不敏感 +
// 变体兼容）——避免现有 SUMMARY 格式漂移导致误 BLOCKED。
export async function verifySummaries(changeDir) {
  const files = (await fs.readdir(changeDir).catch(() => [])).filter(f => f.endsWith('-SUMMARY.md'));
  const violations = [];
  for (const f of files) {
    const content = await fs.readFile(path.join(changeDir, f), 'utf8');
    for (const section of SUMMARY_REQUIRED_SECTIONS) {
      if (!section.regex.test(content)) violations.push(`${f} 缺 ${section.label}`);
    }
  }
  return violations;
}

export function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
}

export function generatedNodeSkillName(protocol, id) {
  return (slug(protocol.name) || 'workflow') + '-' + (slug(id) || 'node');
}

export function route(protocol) {
  return protocol.nodes.filter((node) => !node.disabled);
}

export function findNode(protocol, id) {
  return route(protocol).find((node) => node.id === id || generatedNodeSkillName(protocol, node.id) === id) ?? null;
}

export function completedSet(state) {
  return new Set(Array.isArray(state.completedNodes) ? state.completedNodes : []);
}

// 路由判定统一委托共享模块 route-node.mjs 的 resolveNextNode（单一实现——守卫与 workflow-state
// 两侧同语义，含多趟 parallel 回流与串行 pending → execute）。展示层（NEXT/NODE/SKILL 行）保留
// 在 printNext（展示文案逐字）。无活跃 change → null（完成态）。
export async function nextNode(protocol, state) {
  if (!state.activeChange) return null;
  const id = await resolveNextNode({
    runRoot,
    changeName: state.activeChange,
    protocol,
    completedNodes: Array.isArray(state.completedNodes) ? state.completedNodes : [],
  });
  return id ? findNode(protocol, id) : null;
}

export function printNext(protocol, node) {
  if (!node) {
    console.log('NEXT: done');
    return;
  }
  console.log('NEXT: auto');
  console.log('NODE: ' + node.id);
  console.log('SKILL: ' + generatedNodeSkillName(protocol, node.id));
}

// <depends_on> 提取（逗号/空白分隔）。与 workflow-state.mjs 各自保留既有正则实现、不提取到共享
// 解析层（task-parsing / state-schema 冻结为只消费）——两处语义由场景族锚定一致。
export function taskDependsOn(block) {
  const m = String(block ?? '').match(/<depends_on>([\s\S]*?)<\/depends_on>/);
  if (!m || !m[1].trim()) return [];
  return m[1].trim().split(/[,\s]+/).filter(Boolean);
}

// 委托进入谓词（每趟求值）：∃ p ∈ tasks：p.parallel ∧ p.status=pending ∧ deps(p) ⊆ doneIds。
// 返回满足谓词的任务块数组——subagent-execute 出口的「尚有可委托」判定用，与 workflow-state.mjs
// determineNode 的路由谓词同语义（镜像同步点）。
export function eligibleParallelBlocks(blocks, doneIds) {
  return blocks.filter((block) => {
    const a = taskOpeningAttrs(block);
    if (!a || !a.parallel || a.status !== 'pending') return false;
    const deps = taskDependsOn(block);
    return deps.every((d) => doneIds.has(d));
  });
}

export function evidenceFor(state, id) {
  const value = state.evidence && typeof state.evidence === 'object' ? state.evidence[id] : null;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function missingRequiredSkillChecks(node, evidence) {
  const values = Array.isArray(evidence?.completedChecks) ? evidence.completedChecks : [];
  return (node.requiredSkillCalls ?? [])
    .map((binding) => 'required-skill:' + node.id + '.' + binding.skill)
    .filter((check) => !values.includes(check));
}

export function missingAugmentationChecks(node, evidence) {
  const values = Array.isArray(evidence?.completedChecks) ? evidence.completedChecks : [];
  return (node.augmentations ?? [])
    .filter((binding) => binding.enforcement && binding.enforcement !== 'advisory')
    .map((binding) => 'augmentation:' + node.id + '.' + binding.skill)
    .filter((check) => !values.includes(check));
}

export function hasEvidenceField(evidence, id) {
  if (Object.prototype.hasOwnProperty.call(evidence, id)) return true;
  const schemaEvidence = evidence.schemaEvidence;
  return !!(
    schemaEvidence &&
    typeof schemaEvidence === 'object' &&
    !Array.isArray(schemaEvidence) &&
    Object.prototype.hasOwnProperty.call(schemaEvidence, id)
  );
}

// 共用证据库 handoffResult 识别——subagent-execute 的委托结果由 workflow-handoff result 写入嵌套
// handoffResult（{ <taskId>: { result, completedAt } }），非顶层 handoff-result 字段；嵌套对象存在
// 且非空（至少一个任务记录）视为该 evidence 已产生（门禁只认存在性，内容严格校验由 Return
// Contract 校验负责）。
export function hasNonEmptyHandoffResult(evidence) {
  const handoff = evidence?.handoffResult;
  return !!(
    handoff &&
    typeof handoff === 'object' &&
    !Array.isArray(handoff) &&
    Object.keys(handoff).length > 0
  );
}

// 在飞委托判定（验证隔离「同一时刻只有一个写者」）——handoffRequests 中存在条目而 handoffResult
// 无对应记录 = 写者未收工的既有可判形态。判据单处求值（出口校验唯一消费方）。三态收敛：无
// evidence['subagent-execute'] / 无 handoffRequests 条目 ⇒ 返回空数组（调用方零输出，不制造噪音）；
// 全部有对应 result ⇒ 同样空数组（放行）。锚定既有字段，零新增 state 顶层字段。已撤回的 request
// 不构成在飞委托（补撤回通道）：零提交复验失败 / 写边界被拒之后 request 可能留在「有 request 无
// result」态而命令面无从撤回——`workflow-handoff.mjs withdraw` 在原地落留痕（withdrawnAt +
// withdrawnBy，历史不删），守卫据此放行出口。判据复用 state-schema.mjs 的单一实现（撤回留痕两
// 字段齐备才算撤回），本模块不另写一份。
export function inFlightHandoffRequests(evidence) {
  const requests = evidence && typeof evidence === 'object' ? evidence.handoffRequests : null;
  if (!requests || typeof requests !== 'object' || Array.isArray(requests)) return [];
  const results = evidence.handoffResult && typeof evidence.handoffResult === 'object' && !Array.isArray(evidence.handoffResult)
    ? evidence.handoffResult
    : {};
  return Object.keys(requests).filter((taskId) => {
    if (handoffRequestWithdrawn(requests[taskId])) return false;
    return results[taskId] === undefined || results[taskId] === null;
  });
}

export function schemaMap(protocol) {
  return new Map((protocol.outputSchemas ?? []).map((schema) => [schema.id, schema]));
}

export function missingRequiredSchemaEvidence(protocol, node, evidence) {
  const schemas = schemaMap(protocol);
  const missing = [];
  // schema evidence 缺失但 record 传了 summary → 以 summary 视为产出证据（避免手动构造各字段）
  const hasSummary = typeof evidence?.summary === 'string' && evidence.summary.trim() !== '';
  for (const schemaId of node.outputSchemas ?? []) {
    const schema = schemas.get(schemaId);
    for (const field of schema?.evidence ?? []) {
      if (field.required && !hasEvidenceField(evidence, field.id) && !hasSummary) {
        missing.push(schemaId + '.' + field.id);
      }
    }
  }
  return missing;
}

export function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
}

export function patternToRegExp(pattern) {
  return new RegExp('^' + String(pattern).split('*').map(escapeRegExp).join('.*') + '$', 'u');
}

export async function pathPatternExists(root, relativePattern) {
  const parts = workflowRelativeSegments(relativePattern, 'artifact path', true);
  async function walk(current, index) {
    const inspection = await inspectWorkflowProtectedPath(
      runRoot,
      current,
      'workflow artifact path',
      index >= parts.length ? 'any' : 'directory',
    );
    if (!inspection.exists) return false;
    if (index >= parts.length) {
      return true;
    }
    const part = parts[index];
    if (!part.includes('*')) {
      return walk(path.join(current, part), index + 1);
    }
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return false;
    }
    const matcher = patternToRegExp(part);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error(
          'workflow artifact path crosses a symbolic link or junction at ' +
            path.join(current, entry.name),
        );
      }
      if (matcher.test(entry.name) && (await walk(path.join(current, entry.name), index + 1))) {
        return true;
      }
    }
    return false;
  }
  return walk(root, 0);
}

// 产物根解析：'project'/缺省 → runRoot；'specs-root' → runRoot/.specs。classic/native 等 pathBase
// 依赖项目配置文件，已随 Comet 感知层剥离——不再读取任何项目配置，遇到即显式报错（fail-fast，
// 与 route-node.mjs 的状态机推导侧同语义），不静默兜底。
export async function workflowArtifactRoot(pathBase) {
  if (pathBase === undefined || pathBase === 'project') {
    await inspectWorkflowProtectedPath(runRoot, runRoot, 'workflow path base', 'directory');
    return runRoot;
  }
  if (pathBase === 'specs-root') {
    return path.join(runRoot, '.specs');
  }
  throw new Error('产物根 pathBase "' + pathBase + '" 不再支持——请改用 specs-root/project + 完整路径（如 project + openspec/changes/xxx.md）');
}

export async function missingRequiredArtifacts(protocol, node, change) {
  const schemas = schemaMap(protocol);
  const missing = [];
  for (const schemaId of node.outputSchemas ?? []) {
    const schema = schemas.get(schemaId);
    for (const artifact of schema?.artifacts ?? []) {
      if (!artifact.required) continue;
      const exists = (
        await Promise.all(
          (artifact.paths ?? []).map(async (artifactPath) => {
            // 替换 <change-id> 占位符为实际 change（如 name-format-unify）
            const resolvedPath = change ? artifactPath.replaceAll('<change-id>', change) : artifactPath;
            return pathPatternExists(await workflowArtifactRoot(artifact.pathBase), resolvedPath);
          }),
        )
      ).some(Boolean);
      if (!exists) missing.push(schemaId + '.' + artifact.id);
    }
  }
  return missing;
}

// 历史归档 change 不强制真实跑验证命令（判断 .specs/archive/ 目录）
export async function isArchivedChange(changeName) {
  if (!changeName) return false;
  const archiveRoot = path.join(runRoot, '.specs', 'archive');
  if (await fileExists(path.join(archiveRoot, changeName))) return true;
  const entries = await fs.readdir(archiveRoot).catch(() => []);
  return entries.some(e => e === changeName || e.endsWith('-' + changeName));
}

// 声明标记目录解析——活动路径 .specs/<change-id>/.skill-loads/ 优先；归档路径兜底（archive 节点
// 「先移目录后 record/exit」顺序下 change 目录已在 .specs/archive/<前缀>-<change-id>/，标记只随
// 目录移动——只查活动路径会把「标记存在」误判成「机制未激活」）。归档扫描匹配后缀 -<change-id>
// （前缀可含日期等，与协议 flowkit.archive.v1 的 archive/*-<change-id> 同构）。两者皆无 → null
// （声明机制从未激活，调用方按旧 change 兼容跳过）。
export async function findSkillLoadsDir(root, changeName) {
  const activeDir = path.join(root, '.specs', changeName, '.skill-loads');
  if (await fileExists(activeDir)) {
    return { dir: activeDir, display: '.specs/' + changeName + '/.skill-loads/' };
  }
  const archiveRoot = path.join(root, '.specs', 'archive');
  const entries = await fs.readdir(archiveRoot).catch(() => []);
  for (const entry of entries) {
    if (!entry.endsWith('-' + changeName)) continue;
    const candidate = path.join(archiveRoot, entry, '.skill-loads');
    if (await fileExists(candidate)) {
      return { dir: candidate, display: '.specs/archive/' + entry + '/.skill-loads/' };
    }
  }
  return null;
}

// 段名校验基准从模板自动派生——骨架计算统一委托 lib/guard-artifact-skeleton.mjs（单一实现：读
// <runRoot>/flow-kit/templates/<DOC>.md + reference/artifact-templates.json，按 runRoot 缓存；段名
// 归一复用 route-node 的 normalizeHeading）。本模块只把骨架投影成既有消费方要的 { name, regex } 形态
// ——不自持模板读取，也不另写一份段名派生。模板缺失 → 空数组，调用方按既有语义回落到内置段名。
export const TEMPLATE_FALLBACK_SECTION_PATTERNS = {
  changeWhy: /^##\s*Why\b/im,
  changeVisualTone: /^##\s*视觉调性/im,
  requirementUserStory: /^##\s*用户故事/im,
  requirementAcceptance: /##\s*(验收准则|验收标准|AC|Acceptance Criteria)/i,
  designDecisionList: /^##\s*\d*\.?\s*决策清单/m,
};

// 模板段名 → 宽松匹配正则：实现随段名归一移到骨架模块（单一出处），此处转出保持既有导出面。
export { headingPattern as templateSectionPattern } from './guard-artifact-skeleton.mjs';

// 读取模板全部段名生成模式列表：键形（change / requirement / design / summary）与 tpl[key] 的
// { name, regex } 数组形态、pick 的按关键词选段语义一律保持既有——只把数据源换成骨架模块（缓存与
// 模板读取归它一处负责，本模块不再自持 runRoot 键控的第二份缓存）。
export async function templateSectionPatterns() {
  const result = { change: [], requirement: [], design: [], summary: [] };
  for (const key of Object.keys(result)) {
    const skeleton = await buildSkeleton(key);
    result[key] = skeleton.sections.map((section) => ({ name: section.name, regex: section.pattern }));
  }
  result.pick = (key, keywords, fallback) => {
    for (const section of result[key] ?? []) {
      if (keywords.some((keyword) => section.name.includes(keyword))) return section.regex;
    }
    return fallback;
  };
  return result;
}

// Fix 段标题从 <runRoot>/flow-kit/templates/TASK.md 派生（单一模板源 + 模块级缓存 + runRoot 键控）：
// 扫描模板全部 H2，用 route-node 共享 heading 归一（单一权威，含闭合 ATX）识别 Fix 段标题；无匹配
// （模板缺失 / 读取失败 / 无 Fix 段）返回 undefined，由回程分类器的内置 fallback 常量兜底。标题只
// 喂给回程分类器决定审计行（不参与路由/state 写入）。识别标记词从单一权威 fallback 派生（归一后
// 首词，如 Fix 任务 → Fix），因此模板基名改为其它语言后缀（如 Fix Tasks）仍可识别；闭合 ATX 与尾部
// 括号变体由共享归一消化。
const FIX_SECTION_HEADING_MARKER = normalizeHeading(FIX_SECTION_TITLE_FALLBACK).split(/\s+/u)[0];

// 模板文本全部 H2 中的 Fix 段标题（无匹配 → undefined）：共享归一后与识别标记词比较，
// 因此语言后缀可变（Fix 任务 / Fix Tasks）；闭合 ATX 与尾部括号由共享归一消化。
export function fixSectionTitleFromTemplateText(text) {
  for (const match of String(text).matchAll(/^##\s+(.+)$/gmu)) {
    const raw = match[1].trim();
    const normalized = normalizeHeading(raw);
    if (normalized === FIX_SECTION_HEADING_MARKER
      || normalized.startsWith(FIX_SECTION_HEADING_MARKER + ' ')) return raw;
  }
  return undefined;
}

let fixSectionTitleCacheRoot = null;
let fixSectionTitleCached = false;
let fixSectionTitleCache;
export async function derivedFixSectionTitle() {
  if (fixSectionTitleCacheRoot === runRoot && fixSectionTitleCached) return fixSectionTitleCache;
  let title;
  const templateFile = path.join(runRoot, 'flow-kit', 'templates', 'TASK.md');
  if (await fileExists(templateFile)) {
    try {
      title = fixSectionTitleFromTemplateText(await fs.readFile(templateFile, 'utf8'));
    } catch {}
  }
  fixSectionTitleCache = title;
  fixSectionTitleCacheRoot = runRoot;
  fixSectionTitleCached = true;
  return title;
}
