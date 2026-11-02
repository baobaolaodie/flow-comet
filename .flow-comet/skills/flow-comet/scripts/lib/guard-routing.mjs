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
import { SUMMARY_REQUIRED_SECTIONS, buildSkeleton } from './guard-artifact-skeleton.mjs';

// 新旧 change 区分——init 写入的 newChange: true = 新 change（严格，不依赖 entry——防系统性
// 跳 entry 绕过）；缺失/非 true（旧 change）= 渐进 WARN 兼容。
export function isNewChange(state) {
  return state.newChange === true;
}

// flow-kit SUMMARY 模板必填段（正则匹配，大小写不敏感 + 变体兼容）——清单唯一来源是骨架模块，
// 此处只取用（本模块不再自持第二份段名清单）。

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

// 声明工件的存在性判据——**唯一的枚举处**：本节点 outputSchemas 引用的 schema → artifacts 中
// required 的那些，逐条解析路径并判定在场。出口的产物门禁（missingRequiredArtifacts）与结构预检
// （guard-gates 的缺件报告）都只消费本函数；任何一处再自行遍历 outputSchemas 就是第二份实现，
// 判据演进时必然分叉（重构前就已分叉：预检只判 file 类、未声明 paths 直接跳过，出口侧两项都不是）。
//
// 返回结构数组（每条 = 一份声明的必需产物）：
//   { schemaId, artifact, resolvedPaths, present, kind, unspecifiedPaths }
//   resolvedPaths    —— 已替换 <change-id> 的声明路径；同一 artifact 的 paths 是互斥备选（任一路径
//                       在场即在场，与节点完成判定同语义）；
//   present          —— 在场判定结果（pathPatternExists 任一命中）；
//   kind             —— 声明的产物类别（未声明为 undefined）；
//   unspecifiedPaths —— 声明不完整（required 但未声明 paths）：没有路径可查，present 恒为 false。
//
// 两侧的差异不抹平、也不在这里偷偷归一，而是留给**调用点显式**决定（调用点各写一行并注明理由）：
//   ① kind：预检只判 kind 为 file（未声明按文件处置）的产物——其它 kind 的「在场」语义不是文件
//      存在性；出口不判 kind（目录类产物同样按路径存在性校验）。
//   ② 未声明 paths：报成**声明不完整**而不是「缺件」的普通一例——没有路径就没有可判的存在性，也没有
//      可创建的落点，报文必须指向协议本身要修，而不是让人去做一件做不到的事。两侧都阻断、且渲染
//      **同一句**（unspecifiedPathsNotice）；区别只在编排：出口把它列进缺件清单，预检给它单列一段
//      （不给「按上述路径创建」的指令）。
//   ③ 归档产出（.specs/archive/ 下）：只在预检侧延后报告，出口照常校验——那是归档做完后的判据。
// 本函数只做 ①②③ 都不涉及的那部分：枚举 + <change-id> 替换 + 在场判定。

// 「声明不完整」的同一句报文：两侧消费方都渲染这一句，措辞只此一处（不各写一份）。
export function unspecifiedPathsNotice(schemaId, artifactId) {
  return '协议声明不完整：' + schemaId + '.' + artifactId
    + ' 标记为 required 但未声明 paths —— 修协议（给它加一条路径），或在模板里改 required=false';
}

export async function declaredRequiredArtifacts(protocol, node, change) {
  const schemas = schemaMap(protocol);
  const declared = [];
  for (const schemaId of node.outputSchemas ?? []) {
    const schema = schemas.get(schemaId);
    for (const artifact of schema?.artifacts ?? []) {
      if (!artifact.required) continue;
      const declaredPaths = artifact.paths ?? [];
      const unspecifiedPaths = declaredPaths.length === 0;
      // <change-id> 替换：无活跃 change 时保留占位符原文（出口侧既有语义；预检侧在无 change 时更早
      // 已退出，两侧因此共用这一条替换口径，不再各自写一份 replaceAll）。
      const resolvedPaths = declaredPaths.map((declaredPath) => (change
        ? String(declaredPath).replaceAll('<change-id>', change)
        : String(declaredPath)));
      // 未声明路径时不解析产物根：没有路径就没有可查的存在性，「pathBase 非法」也不该由一件无路径的
      // 产物引爆。present 保持 false——声明不完整不是「在场」，两侧据此阻断（差异②）。
      let present = false;
      if (!unspecifiedPaths) {
        const artifactRoot = await workflowArtifactRoot(artifact.pathBase);
        present = (await Promise.all(
          resolvedPaths.map((declaredPath) => pathPatternExists(artifactRoot, declaredPath)),
        )).some(Boolean);
      }
      declared.push({ schemaId, artifact, resolvedPaths, present, kind: artifact.kind, unspecifiedPaths });
    }
  }
  return declared;
}

// 出口侧的必需产物缺件清单（产物门禁与漂移容错的容错判据共用）：取 declaredRequiredArtifacts 里
// 不在场者。本侧**不做**预检的 kind 过滤（①，见上式注释）——出口是完成判据：声明了却不在场就是
// 缺件，无论 kind 是不是 file。声明不完整者（②）同样进这份清单、同样阻断，但报的是可执行的那一句
// （指向协议），而不是一个空路径——与预检侧同一句、同一处措辞。
export async function missingRequiredArtifacts(protocol, node, change) {
  return (await declaredRequiredArtifacts(protocol, node, change))
    .filter((declared) => !declared.present)
    .map((declared) => (declared.unspecifiedPaths
      ? unspecifiedPathsNotice(declared.schemaId, declared.artifact.id)
      : declared.schemaId + '.' + declared.artifact.id));
}

// 历史归档 change 不强制真实跑验证命令（判断 .specs/archive/ 目录）
export async function isArchivedChange(changeName) {
  if (!changeName) return false;
  const archiveRoot = path.join(runRoot, '.specs', 'archive');
  if (await fileExists(path.join(archiveRoot, changeName))) return true;
  const entries = await fs.readdir(archiveRoot).catch(() => []);
  return entries.some(e => e === changeName || e.endsWith('-' + changeName));
}

// 段名校验基准从模板自动派生——骨架计算统一委托 lib/guard-artifact-skeleton.mjs（单一实现：读
// <runRoot>/flow-kit/templates/<DOC>.md + reference/artifact-templates.json，按 runRoot 缓存；段名
// 归一复用 route-node 的 normalizeHeading）。本模块只把骨架投影成既有消费方要的 { name, regex } 形态
// ——不自持模板读取，也不另写一份段名派生。模板整份缺失 → 该键的空数组（pick 据此跳过，见下）。
//
// 「模板缺席时的段名回退清单」唯一来源同样在骨架模块（段名清单单一来源）：此处只转出既有导出面，不另存字面
// 清单——消费方（含 lib/guard-uidesign.mjs）的取用路径因此不变。
export { TEMPLATE_FALLBACK_SECTION_PATTERNS } from './guard-artifact-skeleton.mjs';

// 模板段名 → 宽松匹配正则：实现随段名归一移到骨架模块（单一出处），此处转出保持既有导出面。
export { headingPattern as templateSectionPattern } from './guard-artifact-skeleton.mjs';

// 读取模板全部段名生成模式列表：键形（change / requirement / design / summary）与 tpl[key] 的
// { name, regex } 数组形态、pick 的按关键词选段语义一律保持既有——只把数据源换成骨架模块（缓存与
// 模板读取归它一处负责，本模块不再自持 runRoot 键控的第二份缓存）。opts.runRoot 与骨架同一出入口
// （缺省用运行上下文根；场景可指向夹具根）。
export async function templateSectionPatterns(opts = {}) {
  const result = { change: [], requirement: [], design: [], summary: [] };
  for (const key of Object.keys(result)) {
    const skeleton = await buildSkeleton(key, opts);
    result[key] = skeleton.sections.map((section) => ({ name: section.name, regex: section.pattern }));
  }
  // 命名段选取：模板整份缺席（sections 为空）⇒ **跳过**，不回落段名兜底正则（C9：模板整份缺失时
  // 模板派生判据全部跳过，fallback 只在「模板在场但某个具体段名缺失」时生效）。既有消费方里有闭包
  // 外直接 `.test` 的调用点（「视觉调性」段读取），返回 null 会把「跳过」退化成 TypeError 崩溃——
  // 未校验变成失败，同样不是 C9 的「跳过」，故返回可判别的跳过判据（见 TEMPLATE_SECTION_SKIP）。
  result.pick = (key, keywords, fallback) => {
    const sections = result[key] ?? [];
    if (sections.length === 0) return TEMPLATE_SECTION_SKIP;
    for (const section of sections) {
      if (keywords.some((keyword) => section.name.includes(keyword))) return section.regex;
    }
    return fallback;
  };
  return result;
}

// 「跳过」判据的唯一形态：`.test` 恒真（消费方形态即 `pattern.test(text)` ⇒ 该段检查不生效），
// `skip` 标记让调用方与场景能区分「跳过」与「判据通过」。整份模板缺席时的跳过可见性由产出物结构
// 门禁的「未校验（模板缺失）」行承担，pick 不再重复打印（同一事实两处措辞会先漂移）。
export const TEMPLATE_SECTION_SKIP = Object.freeze({
  skip: true,
  test: () => true,
});

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
