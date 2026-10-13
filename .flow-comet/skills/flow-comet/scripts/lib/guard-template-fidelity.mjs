// 模板保真门禁（守卫模块）：SUMMARY 模板保真（execute / subagent-execute 出口）、TASK 7 字段
// 完整性（plan 出口）、CHANGE/REQUIREMENT/DESIGN 模板保真（open / design 出口）。
//
// 判据骨架统一从 <runRoot>/flow-kit/templates/ 派生（模板缺失 → 内置骨架兜底，且不据此新增阻断）；
// 段名归一委托 route-node 共享 heading 归一（单一权威）——不在本模块另写一份段名解析。

import { promises as fs } from 'fs';
import path from 'path';
import { EXECUTE_FAMILY_NODE_IDS, normalizeHeading } from '../route-node.mjs';
import { taskOpeningAttrs, taskBlocks as extractTaskBlocks } from '../task-parsing.mjs';
import { runRoot, fileExists } from './guard-state-io.mjs';
import { isNewChange, templateSectionPatterns } from './guard-routing.mjs';

// 段名归一化：委托 route-node 共享 heading 归一（单一权威）——去标题标记 / 尾部括号（如
// Why（为什么做）→ Why）/ 编号前缀（1. 决策清单 → 决策清单）/ 闭合 ATX，去首尾空白 + 小写。
function normalizeTemplateHeading(raw) {
  return normalizeHeading(raw);
}

// 提取文档全部 ^## 段（归一化后），供段序/缺段校验
function documentSectionHeadings(content) {
  const out = [];
  for (const m of String(content).matchAll(/^##\s+(.+)$/gmu)) {
    out.push({ raw: m[1].trim(), norm: normalizeTemplateHeading(m[1]) });
  }
  return out;
}

// 模板段序骨架：段名从 flow-kit/templates 派生（与段名校验同源，模板缺失 fallback 内置骨架）
const TEMPLATE_FIDELITY_FALLBACK_SKELETON = {
  change: ['why', 'what', '视觉调性', '影响面', '范围排除', '验收线', '风险与未知'],
  requirement: ['用户故事', '验收准则', '范围切分', '非功能性需求', '依赖与假设'],
  design: ['技术栈选定', '既有架构对齐', '决策清单', '数据流', '关键状态机', 'adr 索引', '风险', '不在范围', '架构沉淀建议'],
  // SUMMARY 模板缺失时的内置全骨架：十段（含条件段——条件段允许正文 N/A，但 H2 标题须在场）
  summary: ['做了什么', '改动文件', 'verify 输出', '6 维自查', '数据库迁移', '越界检查', '破坏性变更', '决策与偏离', '是否触发新工作', '完成判定'],
};

async function templateSkeleton(key) {
  const tpl = await templateSectionPatterns(); // 复用模板缓存（runRoot 内模板）
  const src = tpl[key] ?? [];
  if (src.length > 0) return src.map((s) => normalizeTemplateHeading(s.name));
  return (TEMPLATE_FIDELITY_FALLBACK_SKELETON[key] ?? []).map((s) => normalizeTemplateHeading(s));
}

// SUMMARY 全骨架来源：模板全部 H2 派生（derived=true）；模板缺失/无 H2 → 内置十段兜底
// （derived=false——调用方据此保持渐进兼容，不新增硬阻断）
async function summaryTemplateSkeleton() {
  const tpl = await templateSectionPatterns();
  const derived = (tpl.summary ?? []).length > 0;
  return { derived, sections: await templateSkeleton('summary') };
}

// 段序校核（宽容）：模板骨架段里「实际出现」的段须按模板先后出现；返回乱序描述（无则 null）
function templateOrderViolation(skeletons, headings) {
  let last = -1;
  for (const h of headings) {
    const idx = skeletons.indexOf(h.norm);
    if (idx === -1) continue;
    if (idx < last) return h.raw;
    last = idx;
  }
  return null;
}

// M1 判据：SUMMARY 模板保真——标题 # SUMMARY: + 首部 4 字段 + 段序（含 flow-comet 增量 ## 自检方法）。
// 返回各维度缺口；调用方按新 BLOCK / 旧 WARN 渐进处置。
const SUMMARY_TEMPLATE_HEADER_FIELDS = [
  { label: 'Change ID', re: /\*\*\s*Change\s+ID\s*\*\*/i },
  { label: 'Task ID', re: /\*\*\s*Task\s+ID\s*\*\*/i },
  { label: '完成时间', re: /\*\*\s*完成时间\s*\*\*/ },
  { label: 'AI 角色', re: /\*\*\s*AI\s*角色\s*\*\*/ },
];
// 段序（含 flow-comet 增量段；越界检查在模板中位于 6 维自查 与 自检方法 之间）
const SUMMARY_ORDERED_SECTIONS = ['做了什么', '改动文件', 'verify 输出', '6 维自查', '越界检查', '自检方法']
  .map(normalizeTemplateHeading);

function summaryTemplateFidelity(content) {
  const text = String(content).replace(/\uFEFF/g, '');
  const firstRealLine = (text.split('\n').find((l) => l.trim().length > 0) || '').trim();
  const titleMissing = !/^#\s*summary\s*:/i.test(firstRealLine);
  const headerRegion = text.split(/\n##\s/)[0];
  const headerMissing = SUMMARY_TEMPLATE_HEADER_FIELDS
    .filter((f) => !f.re.test(headerRegion))
    .map((f) => f.label);
  const headings = documentSectionHeadings(text);
  const seen = new Set();
  let last = -1;
  let orderIssue = null;
  for (const h of headings) {
    const idx = SUMMARY_ORDERED_SECTIONS.indexOf(normalizeTemplateHeading(h.raw));
    if (idx === -1) continue;
    if (idx < last) { orderIssue = h.raw; break; }
    last = idx;
    seen.add(idx);
  }
  const missingSections = [];
  for (let i = 0; i < SUMMARY_ORDERED_SECTIONS.length; i++) {
    if (!seen.has(i)) missingSections.push(SUMMARY_ORDERED_SECTIONS[i]);
  }
  return { titleMissing, headerMissing, orderIssue, missingSections };
}

// 全骨架保真：骨架来自 SUMMARY 模板全部 H2；每段须存在（条件段内容可写 N/A，但须有 H2 标题），
// 实际出现的骨架段须按模板先后排列。## 自检方法 不进入骨架，单独校验：须位于 ## 越界检查 之后，
// 且只允许两种位置——紧随 ## 越界检查 之后（下一段即自检方法）或位于全文末尾（最后一个 H2）。
function summarySkeletonFidelity(content, skeleton) {
  const text = String(content).replace(/\uFEFF/g, '');
  const headings = documentSectionHeadings(text);
  const seen = new Set();
  for (const h of headings) {
    const idx = skeleton.sections.indexOf(h.norm);
    if (idx !== -1) seen.add(idx);
  }
  // 段序复用既有骨架校核（单一实现），段存在性单列——两者共用同一骨架
  const orderIssue = templateOrderViolation(skeleton.sections, headings);
  const missingSections = [];
  for (let i = 0; i < skeleton.sections.length; i++) {
    if (!seen.has(i)) missingSections.push(skeleton.sections[i]);
  }
  const selfHeading = normalizeTemplateHeading('自检方法');
  const boundsHeading = normalizeTemplateHeading('越界检查');
  const selfIdx = headings.findIndex((h) => h.norm === selfHeading);
  const boundsIdx = headings.findIndex((h) => h.norm === boundsHeading);
  let selfCheckIssue = null;
  if (selfIdx === -1) {
    selfCheckIssue = '缺 ## 自检方法 段（须位于 ## 越界检查 之后：文末或紧随越界检查两种合法位置）';
  } else if (
    boundsIdx === -1 ||
    selfIdx < boundsIdx ||
    (selfIdx !== headings.length - 1 && selfIdx !== boundsIdx + 1)
  ) {
    selfCheckIssue = '## 自检方法 位置非法（须位于 ## 越界检查 之后：只允许文末或紧随越界检查两种位置）';
  }
  return { missingSections, orderIssue, selfCheckIssue };
}

// SUMMARY 模板保真出口门禁（execute / subagent-execute）：每份 *-SUMMARY.md 校 ① 标题首行
// # SUMMARY: ② 首部 4 字段（Change ID/Task ID/完成时间/AI 角色）③ 段序（做了什么→改动文件→
// verify 输出→6 维自查→…→自检方法）；宽容匹配（大小写/编号前缀/括号后缀）。④ 全骨架存在 +
// 模板序（骨架从 flow-kit/templates/SUMMARY.md 全部 H2 派生，条件段允许正文 N/A）；## 自检方法
// 不在骨架内，单独要求且只允许「文末」「紧随越界检查」两种位置。新 change 任一缺失 → BLOCK
// （含缺失点 + 恢复指引）；旧 change/归档批 → WARN 渐进；模板缺失（无权威骨架来源）→ 新规则只
// 告警不阻断，保持旧格式渐进。
export async function runSummaryTemplateFidelityGate({ node, state }) {
  if (!EXECUTE_FAMILY_NODE_IDS.has(node.id)) return;
  const summaryChangeDir = path.join(runRoot, '.specs', state.activeChange ?? '');
  const summaryFiles = (await fs.readdir(summaryChangeDir).catch(() => [])).filter((f) => f.endsWith('-SUMMARY.md'));
  const skeleton = await summaryTemplateSkeleton();
  const hardIssues = [];
  let skeletonGuidanceNeeded = false;
  for (const f of summaryFiles) {
    try {
      const content = await fs.readFile(path.join(summaryChangeDir, f), 'utf8');
      const fidelity = summaryTemplateFidelity(content);
      const problems = [];
      if (fidelity.titleMissing) {
        problems.push('首行缺 `# SUMMARY: <Task>-<名>` 标题（大小写不敏感，标题可带括号说明后缀）');
      }
      if (fidelity.headerMissing.length > 0) {
        problems.push('首部缺字段: ' + fidelity.headerMissing.join('、'));
      }
      if (fidelity.orderIssue) {
        problems.push('段序乱（「' + fidelity.orderIssue.replace(/^##\s*/, '') +
          '」偏离模板段序——应为 做了什么→改动文件→verify 输出→6 维自查→越界检查→自检方法）');
      }
      if (fidelity.missingSections.length > 0) {
        problems.push('缺段: ' + fidelity.missingSections.join('、'));
      }
      if (problems.length > 0) {
        if (isNewChange(state)) {
          hardIssues.push(f + ' 模板保真校验失败: ' + problems.join('; '));
        } else {
          console.error('SUMMARY TEMPLATE WARN: ' + f + ' ' + problems.join('; ') +
            '（旧 change/归档批渐进，不阻断；新 change 将强制）');
        }
      }
      // ④ 全骨架保真：模板在场时新 change 缺段/乱序/自检位置非法 → BLOCK；
      // 模板缺失时骨架来自内置兜底，不据此新增阻断（旧格式兼容）。
      const skeletonFidelity = summarySkeletonFidelity(content, skeleton);
      const skeletonProblems = [];
      if (skeletonFidelity.missingSections.length > 0) {
        skeletonProblems.push('缺段: ' + skeletonFidelity.missingSections.join('、'));
      }
      if (skeletonFidelity.orderIssue) {
        skeletonProblems.push('段序乱（「' + skeletonFidelity.orderIssue.replace(/^##\s*/, '') +
          '」偏离 flow-kit/templates/SUMMARY.md 的段序）');
      }
      if (skeletonFidelity.selfCheckIssue) {
        skeletonProblems.push(skeletonFidelity.selfCheckIssue);
      }
      if (skeletonProblems.length > 0) {
        if (isNewChange(state) && skeleton.derived) {
          skeletonGuidanceNeeded = true;
          hardIssues.push(f + ' SUMMARY 全骨架校验失败: ' + skeletonProblems.join('; '));
        } else {
          console.error('SUMMARY TEMPLATE WARN: ' + f + ' ' + skeletonProblems.join('; ') +
            (skeleton.derived
              ? '（旧 change/归档批渐进，不阻断；新 change 将强制）'
              : '（模板缺失，按内置骨架提示；不新增阻断）'));
        }
      }
    } catch {}
  }
  if (hardIssues.length > 0) {
    console.error('BLOCKED: SUMMARY 模板保真校验失败: ' + hardIssues.join('; '));
    console.error('恢复: 对照 flow-kit/templates/SUMMARY.md 修正标题/首部/段序（含 flow-comet 增量 ## 自检方法 段）后重试 exit；新 change 强制模板保真');
    if (skeletonGuidanceNeeded) {
      console.error('恢复: 对照 flow-kit/templates/SUMMARY.md 补齐缺失段的 H2 标题（条件段内容可写 N/A）并按模板顺序排列；## 自检方法 只允许文末或紧随 ## 越界检查 之后两种位置');
    }
    process.exit(1);
  }
}

// TASK 7 字段完整性门禁（plan 出口）：每个 <task> 块须含
// name/read_files/write_files/action/verify/done/depends_on；缺任一 → 新 BLOCK / 旧 WARN。
// 开标签解析/整块提取沿用 task-parsing.mjs（属性序无关）。宽容：任务块采用旧式一字段形态
// （无 <name> 标记）的 TASK 视为旧格式 → 仅渐进 WARN（不误拦既有波次/路由回归载体）；采用新
// 模板形态（含 <name>）则按 7 字段强校验。
export const TASK7_REQUIRED = ['name', 'read_files', 'write_files', 'action', 'verify', 'done', 'depends_on'];

export async function runTaskSevenFieldGate({ node, state }) {
  if (node.id !== 'plan' || !state.activeChange) return;
  const task7File = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
  try {
    const task7Blocks = extractTaskBlocks(await fs.readFile(task7File, 'utf8'));
    const planNewFormat = task7Blocks.some((b) => /<name\b/i.test(b));
    const broken = [];
    for (const b of task7Blocks) {
      const missing = TASK7_REQUIRED.filter((field) => !new RegExp('</?' + field + '\\b', 'i').test(b));
      if (missing.length > 0) {
        const idAttr = (taskOpeningAttrs(b) || {})?.id || '?';
        broken.push((idAttr && idAttr !== '?' ? idAttr + ' ' : '') + '缺 ' + missing.join('/'));
      }
    }
    if (broken.length > 0) {
      if (planNewFormat) {
        if (isNewChange(state)) {
          // 文案的集合字符串**从判据常量派生**（不得在此再写一遍字面集合——第二处同口径表达会在
          // 判据演进时静默落后于实现；构造方式不改变渲染结果）。
          console.error('BLOCKED: TASK.md 任务缺 7 字段（' + TASK7_REQUIRED.join('/') + '）: ' + broken.join('; '));
          console.error('恢复: 对照 flow-kit/templates/TASK.md 补齐每个 <task> 的缺字段后重试 exit；新 change 强制任务块结构完整');
          process.exit(1);
        }
        console.error('TASK-7FIELD WARN: TASK.md ' + broken.join('; ') + '（旧 change 渐进，不阻断；新 change 将强制补齐 7 字段）');
      } else {
        console.error('TASK-7FIELD WARN: TASK.md 任务为旧式一字段模板形态（' + broken.join('; ') +
          '）——建议按 flow-kit/templates/TASK.md 补全 7 字段（渐进不阻断）');
      }
    }
  } catch {}
}

// 入口文档模板保真门禁（open / design 出口）：标题与模板一致（# CHANGE: / # REQUIREMENT: /
// # DESIGN:，大小写不敏感、冒号可省）+ 段序按模板派生骨架宽容匹配（编号前缀/括号后缀兼容）；
// 首部必要字段（Change ID）缺失 → 渐进 WARN。新 change 标题/段序失配 → BLOCK + 恢复指引；
// 旧 change/归档批 → WARN 渐进。
export async function runIntakeDocFidelityGate({ node, state }) {
  if ((node.id !== 'open' && node.id !== 'design') || !state.activeChange) return;
  const intakeDir = path.join(runRoot, '.specs', state.activeChange);
  const skeletonsCache = {};
  const hardProblems = [];
  const softWarnings = [];
  const checkIntakeDoc = async (file, key, label, titleRe) => {
    const p = path.join(intakeDir, file);
    if (!(await fileExists(p))) return; // 文件缺失由产物校验兜底
    const text = await fs.readFile(p, 'utf8');
    const firstLine = (text.replace(/\uFEFF/g, '').split('\n').find((l) => l.trim().length > 0) || '').trim();
    if (!titleRe.test(firstLine)) {
      hardProblems.push(file + ' 标题应以 # ' + label + ' 开头（如 `# ' + label + ': <标题>`，大小写不敏感、冒号可省）');
    }
    if (!skeletonsCache[key]) skeletonsCache[key] = await templateSkeleton(key);
    const viol = templateOrderViolation(skeletonsCache[key], documentSectionHeadings(text));
    if (viol) {
      hardProblems.push(file + ' 段序乱（「' + String(viol).replace(/^##\s*/, '') + '」偏离 ' + label + ' 模板段序）');
    }
    const changeIdMissing = !/\*\*\s*Change\s+ID\s*\*\*/i.test(text.split(/\n##\s/)[0]);
    const intakeMsg = file + ' 首部缺 Change ID 字段（' + label + ' 模板首部含 `- **Change ID**: <id>`）';
    if (changeIdMissing) {
      if (isNewChange(state)) hardProblems.push(intakeMsg);
      else softWarnings.push(intakeMsg + '（渐进提示；新 change 将强制）');
    }
  };
  if (node.id === 'open') {
    await checkIntakeDoc('CHANGE.md', 'change', 'CHANGE', /^#\s*change\b/i);
    await checkIntakeDoc('REQUIREMENT.md', 'requirement', 'REQUIREMENT', /^#\s*requirement\b/i);
  } else {
    // design：与既有校验一致的 target 选择（DESIGN.md 优先，DESIGN-lite 兜底）
    const designFile = path.join(intakeDir, 'DESIGN.md');
    const designLite = path.join(intakeDir, 'DESIGN-lite.md');
    const chosen = (await fileExists(designFile)) ? 'DESIGN.md' : ((await fileExists(designLite)) ? 'DESIGN-lite.md' : null);
    if (chosen) await checkIntakeDoc(chosen, 'design', 'DESIGN', /^#\s*design\b/i);
  }
  for (const w of softWarnings) console.error('INTAKE-DOC WARN: ' + w + '（渐进提示，不阻断；新 change 同）');
  if (hardProblems.length > 0) {
    if (isNewChange(state)) {
      console.error('BLOCKED: 入口文档模板保真校验失败: ' + hardProblems.join('; '));
      console.error('恢复: 对照 flow-kit/templates/{CHANGE,REQUIREMENT,DESIGN}.md 修正标题与段序后重试 exit；新 change 强制模板保真');
      process.exit(1);
    }
    for (const h of hardProblems) console.error('INTAKE-DOC WARN: ' + h + '（旧 change/归档批渐进，不阻断；新 change 将强制）');
  }
}
