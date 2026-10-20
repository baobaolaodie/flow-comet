// 证据与产物门禁（守卫模块）：直显授权约束、在飞委托、SUMMARY 必填段与自检方法、LESSONS 扫描段
// 与命中核对、execute 出口、
// verify 出口（真实执行验证命令并记录失败计数）、Return Contract、subagent-execute 摘要与多趟完成
// 判定、required-skill / schema / 产物 存在性门禁——即「完成声明必须有证据与产物」这一族判据。
//
// 分级沿用既有语义：新 change（init 标记）强制 BLOCKED + 恢复指引，旧 change 渐进 WARN 不阻断。

import { promises as fs } from 'fs';
import path from 'path';
import { validateStateFields, verifyFailuresFor, setVerifyFailuresFor } from '../state-schema.mjs';
import { EXECUTE_FAMILY_NODE_IDS, analyzeDependencyGraph, normalizeHeading } from '../route-node.mjs';
import { taskOpeningAttrs, taskBlocks as extractTaskBlocks } from '../task-parsing.mjs';
import { runRoot, fileExists, statePath, writeJson } from './guard-state-io.mjs';
import {
  eligibleParallelBlocks,
  inFlightHandoffRequests,
  isArchivedChange,
  isNewChange,
  missingAugmentationChecks,
  missingRequiredArtifacts,
  missingRequiredSchemaEvidence,
  missingRequiredSkillChecks,
  taskDependsOn,
  verifySummaries,
} from './guard-routing.mjs';
import { applicabilityGatedBinding, frontendCriterion } from './guard-uidesign.mjs';
import { buildSkeleton, headingPattern } from './guard-artifact-skeleton.mjs';

// directOverride 授权约束（direct 是用户决策点，不可自决——机制约束）——execute / subagent-execute
// 出口校验：executionMode=direct 且 directOverride=true（显式直显授权态）须存在授权审计记录
// （directOverrideAt/来源，由 workflow-state execution-mode 命令在协调者显式授权时写入）——否则
// BLOCKED + 恢复指引（协调者显式授权 / 回 subagent）。旧 state 缺省（directOverride=false / 缺字段）
// 放行（前向兼容——未处于显式 direct 不受影响）。
export function runDirectOverrideGate({ node, state }) {
  if (!EXECUTE_FAMILY_NODE_IDS.has(node.id) || !state.activeChange) return;
  const directMode = state.executionMode ?? 'subagent';
  if (directMode === 'direct' && state.directOverride === true) {
    const hasAuditRecord = typeof state.directOverrideAt === 'string'
      && state.directOverrideAt.trim() !== '';
    if (!hasAuditRecord) {
      console.error('BLOCKED: executionMode=direct 且 directOverride=true 但无授权审计记录（direct 是用户决策点，不可自决——须存在授权留痕 directOverrideAt/来源，由协调者显式 execution-mode direct 写入）');
      console.error('恢复: 由协调者执行 workflow-state.mjs execution-mode direct 显式授权（写入授权审计记录）后重试 exit；或 execution-mode subagent 切回（清除 directOverride）后重试 exit；禁止手改 state 机器字段');
      process.exit(1);
    }
  }
}

// 验证隔离「同一时刻只有一个写者」出口校验——读 state.evidence['subagent-execute'].handoffRequests：
// 存在条目且**至少一个无对应 handoffResult** ⇒ 在飞委托（写者未收工，跑全量判据会被未提交中间态
// 污染）：新 change BLOCKED（含恢复指引「待写入者收工后重跑 / 已作废则撤回」）/ 旧 change WARN 渐进；
// 全部有对应 result ⇒ 放行；已撤回（withdrawnAt + withdrawnBy 齐备）的 request 不构成在飞委托 ⇒
// 放行；无该证据对象 ⇒ 零输出。落点 = 出口校验流（与其余 violations / WARN 同风格，不新增独立命令
// 面）；判据经 inFlightHandoffRequests 单处求值（与 Return Contract 的 result 侧契约校验正交，不
// 重复判定）。
export function runInFlightHandoffGate({ node, state }) {
  if (!EXECUTE_FAMILY_NODE_IDS.has(node.id)) return;
  const inFlight = inFlightHandoffRequests(state.evidence?.['subagent-execute']);
  if (inFlight.length > 0) {
    const inFlightDetail = '存在在飞委托（handoffRequests 有 request 无对应 handoffResult）: '
      + inFlight.join(', ') + '——验证隔离要求同一时刻只有一个写者（写者未收工）';
    if (isNewChange(state)) {
      console.error('BLOCKED: ' + inFlightDetail);
      console.error('恢复: 待写入者收工后重跑——子代理回传后用 workflow-handoff.mjs result <task-id> <Return Contract> 记录结果再重试 exit；若该委托已作废（零提交复验失败 / 写边界被拒后遗弃），用 workflow-handoff.mjs withdraw <task-id> --by <来源> [--reason <原因>] 撤回后再重试 exit（撤回留痕 withdrawnAt/withdrawnBy，已撤回 = 终态，历史不删）');
      process.exit(1);
    }
    console.error('WARN: ' + inFlightDetail + '（旧 change 渐进不阻断；待写入者收工后重跑全量判据；已作废的委托可用 workflow-handoff.mjs withdraw <task-id> --by <来源> 撤回）');
  }
}

// ---------- LESSONS 扫描（R1.8 · AC-18：开工前扫描可核对）----------
//
// 两条判据：① 每份 *-SUMMARY.md 含 `## LESSONS 扫描` 增量段；② 按任务 write_files 的路径段与该
// 段内应回应的条目编号（关键词求交、取前 5）必须逐条出现在该段里。段名 / 必填 / 位置三件事都来自
// 登记表（reference/artifact-templates.json 的 SUMMARY.increments）——位置语义由模板保真门禁按同一
// 条目执行，本门禁只判「在场 + 命中回应」，不写第二份位置判据（L-067）。
//
// 停用词表与命中上限单处定义：改口径只改这三个常量。关键词行（`- **关键词**:`）是唯一参与命中计算
// 的字段——无关键词行的旧条目不参与（给旧条目一个不被误命中的通道）。
const LESSONS_SCAN_SECTION = 'LESSONS 扫描';
const LESSONS_HIT_LIMIT = 5;
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

// 段名 / 必填来自登记表；登记表或模板缺席时退回段名常量并保持必填——扫描段由 AC-18 要求，不因模板
// 派生失败而免检（「模板缺失」只让模板派生判据跳过，不让扫描声明消失）。
async function lessonsScanRule() {
  const skeleton = await buildSkeleton('summary');
  const wanted = normalizeHeading(LESSONS_SCAN_SECTION);
  const entry = (skeleton.increments ?? []).find((item) => item.norm === wanted);
  if (entry && entry.kind === 'section') {
    return {
      name: entry.section,
      required: entry.required,
      pattern: entry.pattern ?? headingPattern(entry.section, 2),
      registered: true,
    };
  }
  return { name: LESSONS_SCAN_SECTION, required: true, pattern: headingPattern(LESSONS_SCAN_SECTION, 2), registered: false };
}

// write_files 原文（键 = 任务 id）。块提取与开标签解析复用 task-parsing 的既有实现，只读元素文本。
async function taskWriteFiles(changeDir) {
  const out = new Map();
  let text = '';
  try {
    text = await fs.readFile(path.join(changeDir, 'TASK.md'), 'utf8');
  } catch {
    return out;
  }
  for (const block of extractTaskBlocks(text)) {
    const attrs = taskOpeningAttrs(block);
    if (!attrs || !attrs.id) continue;
    const writeFiles = block.match(/<write_files>([\s\S]*?)<\/write_files>/i);
    if (writeFiles) out.set(attrs.id, writeFiles[1]);
  }
  return out;
}

// 路径段 → 词元：目录名与文件主干（去最后一层扩展名）按非字母数字切分，长度 ≥3、去停用词、去纯数字。
// 只在「命中计算」这一侧做长度与停用词过滤——条目关键词侧原样保留，过滤口径不扩散成第二份规则。
function lessonsPathTokens(writeFilesText) {
  const tokens = new Set();
  for (const raw of String(writeFilesText ?? '').split(/[\n;]+/u)) {
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
// 按行扫描会被误当成真条目——围栏内一律跳过。无关键词行的条目不进结果集（旧条目跳过）。
function lessonsEntries(lessonsText) {
  const entries = [];
  let current = null;
  let inFence = false;
  for (const line of String(lessonsText ?? '').replace(/\r\n?/gu, '\n').split('\n')) {
    if (/^\s*```/u.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^##\s/u.test(line)) { current = null; continue; }
    const heading = line.match(LESSONS_ENTRY_HEADING);
    if (heading) {
      current = { id: 'L-' + String(Number(heading[1])).padStart(3, '0'), tokens: [], order: entries.length };
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
function lessonsHits(pathTokens, entries) {
  if (pathTokens.size === 0) return [];
  const scored = [];
  for (const entry of entries) {
    const shared = [...new Set(entry.tokens.filter((token) => pathTokens.has(token)))];
    if (shared.length === 0) continue;
    scored.push({ id: entry.id, shared, order: entry.order });
  }
  scored.sort((a, b) => b.shared.length - a.shared.length || a.order - b.order);
  return scored.slice(0, LESSONS_HIT_LIMIT);
}

// 段正文：命中段标题行之后、到下一个 H2 / 分隔线 / 文件尾（行锚定——正文里「引用段名」不劫持匹配）。
// 围栏代码块内的 `## ` 与 `---` 是正文示例，不当作段边界。段缺席返回 null（与「段在场但正文为空」
// 区分：前者是缺声明，后者由正文判据另行处理）。
function lessonsScanBody(content, pattern) {
  const lines = String(content ?? '').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split('\n');
  const start = lines.findIndex((line) => pattern.test(line));
  if (start === -1) return null;
  const body = [];
  let inFence = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*```/u.test(lines[i])) inFence = !inFence;
    if (!inFence && (/^##\s/u.test(lines[i]) || /^---\s*$/u.test(lines[i]))) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

// 编号在段内出现的判定：两侧非数字边界（L-501 不算命中 L-5012），大小写不敏感（执行者常写小写
// `l-501`）。转义集不含 `-`——字符类外的连字符本就是字面量，而在 `u` 标志下 `\-` 是非法转义
// （会抛 Invalid regular expression）。
function mentionsLessonsId(body, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp('(^|[^0-9])' + escaped + '(?![0-9])', 'iu').test(body);
}

// 每份 SUMMARY 的两条判据 → 问题描述数组（分级由调用方按 isNewChange 决定：新 change BLOCKED /
// 旧 change WARN——C10 无例外）。TASK.md 或 .specs/LESSONS.md 缺席时对应输入为空：段在场判据照常，
// 命中计算自然为空集（无条目可命中）。
async function lessonsScanProblems(changeDir, summaryFiles) {
  if (summaryFiles.length === 0) return [];
  const rule = await lessonsScanRule();
  const lessonsText = await fs.readFile(path.join(runRoot, '.specs', 'LESSONS.md'), 'utf8').catch(() => '');
  const entries = lessonsEntries(lessonsText);
  const writeFilesById = await taskWriteFiles(changeDir);
  const problems = [];
  for (const file of summaryFiles) {
    let content = '';
    try {
      content = await fs.readFile(path.join(changeDir, file), 'utf8');
    } catch (error) {
      // 读失败不得静默跳过（L-079：依赖解析失败必须可见）——判据无法求值本身就是问题，按同一分级上报。
      problems.push(file + ' 无法读取（' + String(error?.message ?? error) + '）——LESSONS 扫描判据无法求值');
      continue;
    }
    const body = lessonsScanBody(content, rule.pattern);
    if (body === null) {
      if (rule.required) {
        problems.push(file + ' 缺 ## ' + rule.name + ' 段（SUMMARY 增量段须声明扫描结果与命中回应'
          + (rule.registered ? '；位置按登记表登记：自检方法之后' : '') + '）');
      }
      continue;
    }
    const taskId = file.replace(/-SUMMARY\.md$/iu, '');
    const hits = lessonsHits(lessonsPathTokens(writeFilesById.get(taskId) ?? ''), entries);
    const unanswered = hits.filter((hit) => !mentionsLessonsId(body, hit.id));
    if (unanswered.length > 0) {
      problems.push(file + ' 的 ## ' + rule.name + ' 段未回应命中条目 '
        + unanswered.map((hit) => hit.id + '（关键词: ' + hit.shared.join('、') + '）').join('、')
        + '——R1.8 要求逐条声明「仍适用 / 差异是 X」');
    }
  }
  return problems;
}

// execute / subagent-execute 出口校验每份 SUMMARY 含三个必填段 + 6 维自查非空 + 自检方法声明
// （brooks-review / cache-brooks / builtin-quickcheck 三级降级路径）+ LESSONS 扫描段与命中核对
export async function runSummarySectionsGate({ node, state }) {
  if (!EXECUTE_FAMILY_NODE_IDS.has(node.id)) return;
  const changeDir = path.join(runRoot, '.specs', state.activeChange ?? '');
  const violations = await verifySummaries(changeDir);
  // brooks-lint 自检方法审计：检查 6 维自查段是否声明了自检方法
  const summaryFiles = (await fs.readdir(changeDir).catch(() => [])).filter(f => f.endsWith('-SUMMARY.md'));
  for (const f of summaryFiles) {
    try {
      const content = await fs.readFile(path.join(changeDir, f), 'utf8');
      // 段终止 lookahead 用 \n##\s（而非 \n##）：###/#### 级子标题（如 "### 🟢 R1"）是段内内容，
      // 不是段结束。段尾同样 = 段标题 / 分隔线 / 输入末尾；末尾一律写 (?![\s\S])，不得写 \Z
      // （JS 无 \Z——它是「字面字符 Z」，且本正则带 i 标志，连小写 z 都会命中，段被静默截断）
      const sixDim = content.match(/##\s*6\s*维自查[\s\S]*?(?=\n##\s|\n---|(?![\s\S]))/i);
      // 6 维自查段非空——去掉所有标题行后剩余实质内容 ≥ 10 字符。按行过滤标题（/^\s*#/）比正则
      // 替换稳健：任何标题格式（emoji 🟢/中英文/数字）都不计入内容
      const dimBody = sixDim ? sixDim[0].split('\n').filter(l => !/^\s*#/.test(l)).join('').trim() : '';
      if (sixDim && dimBody.length < 10) {
        violations.push(f + ' 的 6 维自查段无实质内容');
      }
      // 生产代码任务必填 ## 自检方法，声明 brooks-review 或 builtin-quickcheck。格式兼容：方法名行
      // 允许中文前缀/括号说明（如 "方法：brooks-review"），按关键词搜索而非 [a-z-]+ 硬匹配。段名
      // 允许带括号后缀（如 "## 自检方法（声明 brooks-review 或 builtin-quickcheck）"——括号为说明非
      // 段名部分，执行者常按模板标题原样书写导致旧正则不匹配落入"旧格式 WARN"；括号后缀与段名等价）。
      // 分隔符用 .?（任意字符）而非 \.?（字面点）：canonical 名 "brooks-review"/"builtin-quickcheck"
      // 是连字符，与既有 /brooks.?review/ 约定一致。真实项目端到端验证实证：方法名可能在段内后续行
      // （子代理列表写法）——段内全文搜索而非仅第一行。段内容截取到下一个段标题（\n## ）或分隔线
      // （\n---）或文件尾（split 处理，避免 JS 无 \Z 的问题）
      const methodMatch = content.match(/##\s*自检方法(?:[（(][^）)\n]*[）)])?\s*\n([\s\S]*)/i);
      const methodSection = methodMatch ? methodMatch[1].split(/\n##\s|\n---/)[0] : null;
      const method = methodSection ? /brooks.?review|cache.?brooks|builtin.?quickcheck/i.exec(methodSection) : null;
      if (!method) {
        // 过渡规则：旧格式 SUMMARY 无 ## 自检方法 段——若全文已声明 brooks-review/cache-brooks/
        // builtin（旧模板行为），WARN 兼容不 BLOCKED；无任何自检声明才 BLOCKED
        if (/brooks.?review|cache.?brooks|builtin.?quickcheck/i.test(content)) {
          if (isNewChange(state)) {
            violations.push(f + ' 缺 ## 自检方法 段（新 change 强制声明自检方法）');
          } else {
            console.error('BROOKS-LINT WARN: ' + f + ' 缺 ## 自检方法 段（旧格式），6 维自查已声明自检方法——兼容通过，建议补全');
          }
        } else {
          violations.push(f + ' 缺 ## 自检方法 字段（必须声明 brooks-review 或 builtin-quickcheck）');
        }
      } else if (/builtin/i.test(method[0])) {
        // builtin 降级两级校验——① 必须声明不可用原因；② 必须含缓存尝试证据（已尝试 Read 插件缓存
        // 协议文件手动执行仍不可行——两级降级路径第 2 级；防「未尝试读缓存」的偷懒降级）。关键词
        // 声明级校验（设计边界：不做语义判断）；缺失 → 新 change BLOCKED / 旧 SUMMARY WARN 渐进
        if (!/brooks-lint 不可用|插件不可用|unavailable|N\/A/i.test(content)) {
          if (isNewChange(state)) {
            console.error('BLOCKED: SUMMARY 使用 builtin-quickcheck 未声明 brooks-lint 不可用原因（新 change 强制）;恢复: 在 ## 自检方法 段补原因（声明级校验——须含关键词: brooks-lint 不可用 / 插件不可用 / unavailable / N/A,如「brooks-lint 不可用(Skill 仅返回占位,插件执行体未加载)」）');
            process.exit(1);
          }
          console.error('BROOKS-LINT WARN: ' + f + ' 使用 builtin-quickcheck 但未声明 brooks-lint 不可用原因');
        } else if (!/插件缓存|缓存协议|协议文件|plugins\/cache/i.test(content)) {
          if (isNewChange(state)) {
            console.error('BLOCKED: SUMMARY 使用 builtin-quickcheck 未声明缓存尝试证据（新 change 强制先 Read 插件缓存协议文件）;恢复: 在 ## 自检方法 段声明缓存尝试（须含关键词: 插件缓存 / 缓存协议 / 协议文件 / plugins/cache,如「已 Read 插件缓存协议文件(~/.claude/plugins/cache/...)手动执行仍不可行」）');
            process.exit(1);
          }
          console.error('BROOKS-LINT WARN: ' + f + ' 使用 builtin-quickcheck 但未声明缓存尝试证据（应先 Read 插件缓存协议文件手动执行完整 brooks 流程）');
        }
      }
      if (sixDim && !/brooks.?review|cache.?brooks/i.test(sixDim[0])) {
        if (isNewChange(state)) {
          console.error('BLOCKED: SUMMARY 的 6 维自查未声明使用 /brooks-review（新 change 强制声明自检方法）;恢复: 在 6 维自查段声明 /brooks-review 或理由');
          process.exit(1);
        }
        console.error('BROOKS-LINT WARN: ' + f + ' 的 6 维自查未声明使用 /brooks-review（可能使用了内置快查）');
      }
    } catch {}
  }
  // LESSONS 扫描（AC-18）：每份 SUMMARY 的扫描段在场 + 命中条目逐条回应。分级沿用既有语义——
  // 新 change BLOCKED / 旧 change WARN（C10 无例外）。
  const lessonsProblems = await lessonsScanProblems(changeDir, summaryFiles);
  if (lessonsProblems.length > 0) {
    if (isNewChange(state)) {
      violations.push(...lessonsProblems);
    } else {
      for (const problem of lessonsProblems) {
        console.error('LESSONS SCAN WARN: ' + problem + '（旧 change 渐进，不阻断；新 change 将强制）');
      }
    }
  }
  if (violations.length > 0) {
    console.error('BLOCKED: SUMMARY 关键段校验失败: ' + violations.join('; '));
    if (lessonsProblems.length > 0 && isNewChange(state)) {
      console.error('恢复: 按 flow-kit/templates/SUMMARY.md 在 ## 自检方法 之后补 ## LESSONS 扫描 段，并逐条写出命中条目编号与差异声明（无命中写「无 active 条目命中」）；命中来源 = TASK.md 该任务 write_files 的路径段 × .specs/LESSONS.md 条目的关键词行');
    }
    process.exit(1);
  }
}

// execute 出口门禁：空退出豁免活性（收窄）+ 串行 pending 拦截 + done 任务 SUMMARY 完整性 +
// 越俎代庖检测 + 越权委托检测。返回 { exempt }——豁免活性（仅全并行 change 且显式豁免时成立），
// 由产物门禁消费（含串行任务时豁免不生效，产物/摘要校验照常执行）。
export async function runExecuteExitGate({ protocol, node, state, emptyExitApproved }) {
  if (node.id !== 'execute' || !state.activeChange) return { exempt: false };
  let exempt = false;
  const taskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
  try {
    const taskContent = await fs.readFile(taskFile, 'utf8');
    // 解析 TASK.md 全部 task 的 {id, status, parallel}——开标签属性解析共享 task-parsing.mjs
    // （属性序无关、不读块内文本；与 workflow-state 路由同语义）
    const taskList = extractTaskBlocks(taskContent);
    const tasks = taskList.map(block => {
      const a = taskOpeningAttrs(block) || {};
      return { id: a.id, status: a.status, parallel: a.parallel };
    }).filter(t => t.id);

    // 串行 pending → BLOCKED（execute 任务没做完）——emptyExitApproved 不豁免串行 pending：豁免语义
    // 是"全 parallel 无串行可做时空退出"；存在未完成串行任务时豁免不应生效（防规划错误被豁免掩盖；
    // 豁免仅作用于后续产物校验跳过，审计提示保留）
    if (emptyExitApproved) {
      // 豁免前置条件（收窄）：TASK 存在任一串行任务块（parallel!=="true"，含缺省）时豁免不生效，
      // 无论该串行任务 pending 还是 done——陈旧标记不得跳过产物/摘要校验。
      if (tasks.some(t => !t.parallel)) {
        console.error('EMPTY-EXIT 未生效：本 change 含串行任务，豁免仅适用于全并行 change');
      } else {
        exempt = true;
        console.error('EMPTY-EXIT: execute 空退出豁免已生效(evidence.execute.emptyExitApproved)——审计记录:该 change 在无串行任务时显式豁免空退出');
      }
    }
    // serialPending 收窄为「可运行串行」（出口拦截集合收窄）：仅 deps ⊆ doneIds 的未完成串行计入
    // 拦截——deps 未满足的串行 pending 是等后续波次的合法中间态，放行由多趟路由按依赖拓扑分趟驱动。
    // doneIds 就地派生；deps 提取复用 taskDependsOn（<depends_on> 内容按 [,\s]+ 切分，与路由谓词
    // 同一解析口径），不新增状态。
    const doneIds = new Set(tasks.filter(t => t.status === 'done').map(t => t.id));
    const blockById = new Map();
    for (const block of taskList) {
      const a = taskOpeningAttrs(block);
      if (a && a.id) blockById.set(a.id, block);
    }
    const serialRunnable = tasks.filter(t =>
      !t.parallel && t.status === 'pending'
      && taskDependsOn(blockById.get(t.id) || '').every(d => doneIds.has(d)));
    if (serialRunnable.length > 0) {
      console.error('BLOCKED: execute 出口仍有串行 pending 任务: ' + serialRunnable.map(t => t.id).join(', ')
        + '——空退出豁免不适用于存在未完成可运行串行任务的情况(先完成该串行任务,或修正任务标记)'
        + ';无可执行的常规恢复动作时，可用 workflow-state.mjs advance 渡过结构性死结（逃生口：使用后本节点须重新 entry 并重做交付记录）；常规缺产物/缺证据情形不适用');
      process.exit(1);
    }

    // done 任务 ↔ SUMMARY 完整性：done 任务 ↔ <id>-SUMMARY.md 存在（WARN 渐进不 BLOCK——防旧
    // change 卡死；结构级校验与 TASK 签名同源：任务完成声明须有对应产物）。新 change（enter 机制
    // 激活）升级为 BLOCKED——执行遗漏（声称完成但无产物）不静默进归档；旧 change 保持渐进。
    const ki8ChangeDir = path.join(runRoot, '.specs', state.activeChange ?? '');
    for (const tid of tasks.filter(t => t.status === 'done').map(t => t.id)) {
      if (!(await fileExists(path.join(ki8ChangeDir, tid + '-SUMMARY.md')))) {
        if (isNewChange(state)) {
          console.error('BLOCKED: done 任务 ' + tid + ' 缺少 ' + tid + '-SUMMARY.md——execute 产物不完整（新 change 强制任务完成须有对应 SUMMARY;旧 change 渐进 WARN）');
          console.error('恢复: 补写 ' + tid + '-SUMMARY.md 后重试 exit;任务完成后补产物即可');
          process.exit(1);
        }
        console.error('WARN: done 任务 ' + tid + ' 缺少 ' + tid + '-SUMMARY.md——execute 产物不完整（任务完成须有对应 SUMMARY）');
      }
    }

    // 豁免机制：evidence（当前节点 execute）含 parallelTakeoverApproved: true 时跳过越俎代庖检测
    // （只保留串行 pending 检测）
    const executeEvidence = state.evidence['execute'];
    const takeoverApproved = !!(executeEvidence && executeEvidence.parallelTakeoverApproved);

    if (!takeoverApproved) {
      // 越俎代庖检测按 executionMode 分支：
      // - direct（逃生口）：串行任务主代理直写，不需 handoff；parallel 仍必须委托（防 execute 吞 parallel 回归）
      // - subagent（默认）：所有 done 任务需 handoff（统一委托下只能由子代理完成）
      const executionMode = state.executionMode ?? 'subagent';
      const he = state.evidence['subagent-execute'];
      const results = he && he.handoffResult ? he.handoffResult : {};
      let unauthorized;
      if (executionMode === 'direct') {
        unauthorized = tasks.filter(t => t.parallel && t.status === 'done' && !results[t.id]);
      } else {
        unauthorized = tasks.filter(t => t.status === 'done' && !results[t.id]);
      }
      if (unauthorized.length > 0) {
        console.error('BLOCKED: 任务被主代理直接标记 done（越俎代庖）' + (executionMode === 'direct' ? '，direct 模式下 parallel 任务仍必须委托子代理' : '，统一委托下只能由子代理完成并记录 handoff') + ': ' + unauthorized.map(t => t.id).join(', '));
        console.error('解决: 回退这些任务的 done 标记，重新委托子代理；或用 workflow-state.mjs record execute \'{"parallelTakeoverApproved":true}\' 显式豁免');
        process.exit(1);
      }
      // parallel 仍 pending → 合法（下一步 determineNode 路由到 subagent-execute）
    }

    // 越权委托检测（execute 出口第一道）——TASK 有 parallel done 任务 + completedNodes 无
    // subagent-execute + 非 direct 模式 + 协议含 subagent-execute 节点 → WARN 渐进（[P] 任务应由
    // subagent-execute 节点委托——execute 阶段完成 [P] 是越权委托痕迹；handoff 记录存在但节点未
    // exit——真实项目端到端验证实证）
    const ki10ParallelDone = tasks.filter(t => t.parallel && t.status === 'done').map(t => t.id);
    const ki10ProtocolHasSubagent = (protocol.nodes ?? []).some(n => n.id === 'subagent-execute');
    if (ki10ParallelDone.length > 0
        && !(state.completedNodes ?? []).includes('subagent-execute')
        && (state.executionMode ?? 'subagent') !== 'direct'
        && !takeoverApproved
        && ki10ProtocolHasSubagent) {
      if (isNewChange(state)) {
        console.error('BLOCKED: TASK 有 parallel done 任务（' + ki10ParallelDone.join(', ')
          + '）但 subagent-execute 节点未 exit——新 change 强制 [P] 任务由 subagent-execute 节点委托');
        console.error('恢复: 经 subagent-execute 节点完成委托后再 exit;或说明越权委托原因');
        process.exit(1);
      }
      console.error('WARN: TASK 有 parallel done 任务（' + ki10ParallelDone.join(', ')
        + '）但 subagent-execute 节点未 exit——疑似 execute 阶段越权委托，[P] 任务应由 subagent-execute 节点委托');
    }
  } catch {}
  return { exempt };
}

// verify 出口必须真实跑命令（严格版）——历史归档 change 豁免（过渡规则）。命令来源三级：TEST.md 的
// ## 验证命令 段 → state 的 verifyCommand → 项目探测回退。失败按 change 隔离计数（≥4 次要求用户
// 决策）。二段式执行（受限沙箱兼容）：首选管道式捕获，仅当 spawn 层被拒（EPERM）时以继承 stdio
// 重试同一命令（真实执行保持、退出码判定不变）。
export async function runVerifyExitGate({ protocol, node, state }) {
  if (node.id !== 'verify') return;
  if (await isArchivedChange(state.activeChange)) return;
  // 越权委托兜底检测（verify 出口）——同 execute 出口的判定（TASK parallel done + completedNodes
  // 无 subagent-execute + 非 direct + 协议含 subagent-execute 节点），verify 时仍未 exit → WARN
  // 兜底（execute 出口未拦截的提示）
  try {
    const ki9TaskText = await fs.readFile(path.join(runRoot, '.specs', state.activeChange ?? '', 'TASK.md'), 'utf8');
    const ki9TaskBlocks = extractTaskBlocks(ki9TaskText);
    const ki9Tasks = ki9TaskBlocks.map(block => {
      const a = taskOpeningAttrs(block) || {};
      return { id: a.id, status: a.status, parallel: a.parallel };
    }).filter(t => t.id);
    const ki9ParallelDone = ki9Tasks.filter(t => t.parallel && t.status === 'done').map(t => t.id);
    const ki9ProtocolHasSubagent = (protocol.nodes ?? []).some(n => n.id === 'subagent-execute');
    const ki9TakeoverApproved = !!(state.evidence?.execute && state.evidence.execute.parallelTakeoverApproved);
    if (ki9ParallelDone.length > 0
        && !(state.completedNodes ?? []).includes('subagent-execute')
        && (state.executionMode ?? 'subagent') !== 'direct'
        && !ki9TakeoverApproved
        && ki9ProtocolHasSubagent) {
      if (isNewChange(state)) {
        console.error('BLOCKED: TASK 有 parallel done 任务（' + ki9ParallelDone.join(', ')
          + '）但 subagent-execute 节点未 exit——新 change 强制(verify 兜底拦截)');
        console.error('恢复: 经 subagent-execute 节点完成委托后再 exit;或说明越权委托原因');
        process.exit(1);
      }
      console.error('WARN: TASK 有 parallel done 任务（' + ki9ParallelDone.join(', ')
        + '）但 subagent-execute 节点未 exit——疑似越权委托（execute 出口未拦截,verify 兜底提示）');
    }
  } catch {}
  const { spawnSync } = await import('child_process');
  let verifyCommand = null;
  // 1) TEST.md 的 ## 验证命令 段（首行代码块首行）
  const testDoc = path.join(runRoot, '.specs', state.activeChange ?? '', 'TEST.md');
  if (await fileExists(testDoc)) {
    const text = await fs.readFile(testDoc, 'utf8');
    // 段名允许括号后缀（与 ## 自检方法 段的括号后缀兼容风格一致——执行者按模板标题原样书写或补充
    // 说明时不被误 BLOCKED）
    const m = text.match(/##\s*验证命令(?:[（(][^）)\n]*[）)])?\s*\n\s*```[^\n]*\n([\s\S]*?)```/);
    if (m) verifyCommand = m[1].trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).join(' && ');
  }
  // 2) state 的 verifyCommand
  if (!verifyCommand && state.verifyCommand) verifyCommand = state.verifyCommand;
  // 3) 项目探测回退
  if (!verifyCommand) {
    if (await fileExists(path.join(runRoot, 'pingpong-tournament', 'pyproject.toml'))) verifyCommand = 'cd pingpong-tournament && python -m pytest tests/ -q';
    else if (await fileExists(path.join(runRoot, 'frontend', 'package.json'))) verifyCommand = 'cd frontend && npm test';
  }
  if (!verifyCommand) {
    console.error('BLOCKED: TEST.md 需声明 ## 验证命令 段（严格版要求）');
    process.exit(1);
  }
  // verify 命令 timeout 可配置——FLOW_COMET_VERIFY_TIMEOUT_MS 环境变量优先，缺省 300000ms（300s；
  // 后端测试耗时可超 300s，用 env 调大）；非数字/0 → 回退缺省
  const verifyTimeoutMs = Number.parseInt(process.env.FLOW_COMET_VERIFY_TIMEOUT_MS ?? '300000', 10) || 300000;
  try {
    // 测试钩子（仅测试用途）：FLOW_COMET_VERIFY_FORCE_EPERM=1 使首次管道执行模拟 EPERM 拒绝——
    // 真实受限会话中命令在管道阶段不会启动，故跳过管道阶段直接产生 EPERM 结果，让降级路径可确定性
    // 自动化断言（生产触发条件是真实 spawn 层 EPERM，不经此钩子）
    const forceEperm = process.env.FLOW_COMET_VERIFY_FORCE_EPERM === '1';
    const first = forceEperm
      ? { status: null, error: Object.assign(new Error('spawn verify EPERM（FLOW_COMET_VERIFY_FORCE_EPERM=1 模拟受限沙箱拒绝）'), { code: 'EPERM' }), stdout: '', stderr: '' }
      : spawnSync(verifyCommand, { cwd: runRoot, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: verifyTimeoutMs });
    const firstFailed = first.error != null || first.status !== 0;
    const epermDenied = first.error != null && (first.error.code === 'EPERM' || String(first.error.message ?? '').includes('EPERM'));
    if (firstFailed && epermDenied) {
      console.error('VERIFY-DEGRADED: ' + verifyCommand + '（沙箱管道受限，以 inherit 重试）');
      const r2 = spawnSync(verifyCommand, { cwd: runRoot, shell: true, stdio: 'inherit', timeout: verifyTimeoutMs });
      if (!(r2.error == null && r2.status === 0)) {
        throw new Error(r2.error != null ? String(r2.error.message) : ('exit code ' + r2.status));
      }
    } else if (firstFailed) {
      // 非 EPERM 失败维持现状路径——抛出与既有 execSync 形态兼容的错误对象（stdout 优先展示）
      const e = new Error('Command failed: ' + verifyCommand + '\n' + String(first.stderr ?? ''));
      e.stdout = first.stdout;
      throw e;
    }
  } catch (e) {
    // verify-fail 自动递增（无需 LLM 主动调用）——计数按当前 change 存储（verifyFailuresByChange，
    // 切换 change 不串扰；旧顶层字段迁移并入）
    const count = verifyFailuresFor(state) + 1;
    setVerifyFailuresFor(state, count);
    const file = await statePath(protocol);
    const bad = validateStateFields(state);
    if (bad.length) { console.error('BLOCKED: state 字段类型非法: ' + bad[0]); process.exit(1); }
    await writeJson(file, state);
    if (count >= 4) {
      console.error('BLOCKED: verify 已失败 ' + count + ' 次，需用户决策（继续修/停止）。');
    } else {
      // stdout 为空（如超时被 kill 时 stdout 是空 Buffer——truthy）→ 显示错误消息；消息中带实际
      // 应用的 timeout（超时可诊断，且与 Node 版本无关）
      const detail = (e.stdout && e.stdout.length) ? e.stdout : e.message;
      console.error('BLOCKED: verify 命令失败（timeout ' + verifyTimeoutMs + 'ms）: ' + verifyCommand + '\n' + String(detail).slice(0, 500));
      console.error('VERIFY-FAIL: ' + count + '/3');
    }
    process.exit(1);
  }
}

// Return Contract 校验——每个 delegated task 的 result 必须含 commitHash + greenEvidence；handoff
// guarded 落实——每个 result 的 completedChecks 必须包含 required-skill:subagent-execute.<skill>
// （skill 名从协议 requiredSkillCalls 读）。严格模式：旧格式非 JSON result（无 completedChecks
// 载体）同样 BLOCKED，无旧 change 豁免——补录/重录必须回传完整契约（含 completedChecks），不允许
// 历史格式绕过委托证明。
export function runReturnContractGate({ node, state }) {
  if (node.id !== 'subagent-execute') return;
  const he = state.evidence['subagent-execute'];
  const results = he && he.handoffResult ? he.handoffResult : {};
  const requiredChecks = (node.requiredSkillCalls ?? [])
    .map((binding) => 'required-skill:' + node.id + '.' + binding.skill);
  const violations = [];
  for (const [taskId, rec] of Object.entries(results)) {
    const r = typeof rec.result === 'object' && rec.result !== null ? rec.result : null;
    if (!r) { violations.push(taskId + ' 非 Return Contract（旧格式，缺 completedChecks）'); continue; }
    // 零提交语义对齐：request 记录 noCommit（write_files 为空，或全部字面路径可证明被 gitignore）的
    // 任务无提交可回传，豁免 commitHash 缺失断言（其余契约校验不变）——与 workflow-handoff 零提交
    // 跳过同构
    const taskReq = he.handoffRequests ? he.handoffRequests[taskId] : null;
    const noCommitTask = !!(taskReq && taskReq.noCommit === true);
    if (!r.commitHash && !noCommitTask) violations.push(taskId + ' 缺 commitHash');
    if (!r.greenEvidence || !r.greenEvidence.command) violations.push(taskId + ' 缺 greenEvidence');
    // redEvidence 缺失警告（过渡期不阻断）——新 change（enter 机制激活）升级为 BLOCKED（TDD RED 证据强制）
    if (r && !r.redEvidence) {
      if (isNewChange(state)) {
        violations.push(taskId + ' 缺 redEvidence（新 change 强制 TDD RED 证据;旧 change 渐进 WARN）');
      } else {
        console.error('HANDOFF WARN: ' + taskId + ' 缺 redEvidence（可能未执行 TDD RED 阶段）');
      }
    }
    // completedChecks 严格校验（无旧 change 豁免）
    if (requiredChecks.length > 0) {
      const checks = Array.isArray(r.completedChecks) ? r.completedChecks : [];
      const missing = requiredChecks.filter((check) => !checks.includes(check));
      if (missing.length > 0) {
        violations.push(taskId + ' 缺 completedChecks: ' + missing.join(', '));
      }
    }
  }
  if (violations.length > 0) {
    console.error('BLOCKED: Return Contract 校验失败: ' + violations.join('; '));
    console.error('恢复: 子代理回传完整契约(含缺失字段)后用 workflow-handoff.mjs result 重录——新 change 强制 TDD RED/GREEN 证据与 completedChecks;注意:若已记录 greenEvidence 而缺 redEvidence,时序防护会拦截事后补录(防掩盖缺 RED)——确认子代理真实执行过 TDD RED 且证据在对应 SUMMARY 中时,用 workflow-state.mjs record subagent-execute 合并写入真实 redEvidence(证据可溯源),或重新委托任务获取完整契约');
    process.exit(1);
  }
}

// subagent-execute 出口——done 任务缺 SUMMARY（新 change BLOCKED；旧 change 渐进 WARN）。已知边界：
// SUMMARY 段内容校验只查已存在的 SUMMARY；执行遗漏（声称完成无产物）不应静默进归档。
export async function runSubagentSummaryGate({ node, state }) {
  if (node.id !== 'subagent-execute' || !state.activeChange) return;
  const saTaskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
  try {
    const saContent = await fs.readFile(saTaskFile, 'utf8');
    const saTasks = (saContent.match(/<task[^>]*>[\s\S]*?<\/task>/g) || [])
      .map(block => ({ id: (block.match(/id="([^"]+)"/) || [])[1] || null, status: (block.match(/status="([^"]+)"/) || [])[1] || null }))
      .filter(t => t.id);
    const saDir = path.join(runRoot, '.specs', state.activeChange ?? '');
    for (const t of saTasks.filter(t => t.status === 'done')) {
      if (!(await fileExists(path.join(saDir, t.id + '-SUMMARY.md')))) {
        if (isNewChange(state)) {
          console.error('BLOCKED: done 任务 ' + t.id + ' 缺少 ' + t.id + '-SUMMARY.md——subagent-execute 产物不完整（新 change 强制任务完成须有对应 SUMMARY;旧 change 渐进 WARN）');
          console.error('恢复: 补写 ' + t.id + '-SUMMARY.md 后重试 exit;任务完成后补产物即可');
          process.exit(1);
        }
        console.error('WARN: done 任务 ' + t.id + ' 缺少 ' + t.id + '-SUMMARY.md——subagent-execute 产物不完整（任务完成须有对应 SUMMARY）');
      }
    }
  } catch {}
}

// 多趟完成判定（完成判定谓词决策·合取语义）——subagent-execute 每趟出口校验：
// ① 可委托集合必须为空：仍存在 p（parallel ∧ pending ∧ deps⊆done）→ 本趟未委派完即退 → BLOCK
//    「尚有可委托并行任务（继续委托）」（每趟须委托全部依赖已满足的并行任务）；
// ② 孤儿并行单独区分文案：parallel ∧ pending 且依赖链无法满足（直接依赖缺失，或陷入依赖环/被环
//    传递拖累）→ BLOCK「孤儿并行任务依赖无法满足（检查 depends_on）」——数据异常 fail-closed，
//    防静默跳过（三重防呆决策之二）。
// serial pending 不阻断：合法趟间态（回 execute 消化串行）——最终完成的另一支「无 serial pending」
// 由 execute 出口的串行 pending 校验把关，两支在流程推进中自然合取。
export async function runMultiPassCompletionGate({ node, state }) {
  if (node.id !== 'subagent-execute' || !state.activeChange) return;
  try {
    const mpContent = await fs.readFile(path.join(runRoot, '.specs', state.activeChange, 'TASK.md'), 'utf8');
    const mpBlocks = extractTaskBlocks(mpContent);
    const mpDoneIds = new Set(mpBlocks
      .map(taskOpeningAttrs)
      .filter((a) => a && a.status === 'done' && a.id)
      .map((a) => a.id));
    const delegable = eligibleParallelBlocks(mpBlocks, mpDoneIds);
    if (delegable.length > 0) {
      console.error('BLOCKED: 尚有可委托并行任务（继续委托）: ' + delegable
        .map((b) => (taskOpeningAttrs(b) || {}).id).join(', ') +
        '——多趟语义下每趟须委派全部依赖已满足的并行任务后才能退出');
      console.error('恢复: 继续委托上述任务（子代理回传 Return Contract 后再 exit）；若确需提前收尾，先调整其 depends_on 使其脱离可委派状态');
      process.exit(1);
    }
    const mpGraph = analyzeDependencyGraph(mpBlocks);
    const parallelPending = mpBlocks.filter((b) => {
      const a = taskOpeningAttrs(b);
      return a && a.parallel && a.status === 'pending';
    });
    let orphans = [];
    if (mpGraph.cyclic || mpGraph.missing.length > 0) {
      // doomed 闭包：直接依赖缺失的任务 ∪ 环上/被环拖累的任务，再传递扩散到一切（传递）依赖它们的
      // 任务——这些任务永远进不了可委派状态，一并视为孤儿。
      const doomed = new Set(mpGraph.cycleIds);
      for (const m of mpGraph.missing) doomed.add(m.id);
      let changed = true;
      while (changed) {
        changed = false;
        for (const [id, deps] of mpGraph.depsById) {
          if (doomed.has(id)) continue;
          if (deps.some((d) => doomed.has(d))) { doomed.add(id); changed = true; }
        }
      }
      orphans = parallelPending.filter((b) => {
        const a = taskOpeningAttrs(b);
        return a && a.id && doomed.has(a.id);
      });
    }
    if (orphans.length > 0) {
      console.error('BLOCKED: 孤儿并行任务依赖无法满足（检查 depends_on）: ' + orphans
        .map((b) => (taskOpeningAttrs(b) || {}).id).join(', ') +
        '——依赖引用了不存在的任务或陷入依赖环，永远无法进入可委派状态');
      console.error('恢复: 调整这些任务的 depends_on——指向真实存在且无环的任务 id 后重试；依赖环应在 plan 出口被前置拦截，执行期出现请核对 TASK.md 是否被手改');
      process.exit(1);
    }
  } catch {}
}

// 自动补 required-skill completedChecks——节点被完成即视为其实现 skill 已加载。分派（ui-design 门）：
// 仅「guarded 且适用性判据成立（判前端）」的登记绑定在**新 change** 上停止自动补——该绑定须真实
// skill-load 声明，由后续 missingRequiredSkillChecks 拦截；判据不成立（非前端）、旧 change（渐进
// 兼容——自动补写保持原语义，工件门照常 WARN）或未登记的绑定 → 逐字保持原自动补语义（其它节点/
// 绑定不受影响）。随后校验 Output Schema evidence 存在性。
export async function runEvidenceCompletionGate({ protocol, node, state, evidence }) {
  if ((node.requiredSkillCalls ?? []).length > 0) {
    const checks = Array.isArray(evidence.completedChecks) ? evidence.completedChecks : [];
    for (const binding of node.requiredSkillCalls ?? []) {
      const check = 'required-skill:' + node.id + '.' + binding.skill;
      const applicabilityGated = applicabilityGatedBinding(node, binding.skill) !== null;
      if (applicabilityGated && isNewChange(state) && (await frontendCriterion(state.activeChange)).applicable) continue;
      if (!checks.includes(check)) checks.push(check);
    }
    evidence.completedChecks = checks;
  }
  const missingSchemaEvidence = missingRequiredSchemaEvidence(protocol, node, evidence);
  if (missingSchemaEvidence.length > 0) {
    console.error('BLOCKED: missing Output Schema evidence: ' + missingSchemaEvidence.join(', '));
    process.exit(1);
  }
}

// 产物门禁 + 空退出豁免跳过面：仅当豁免活性成立（显式豁免且 TASK 无任何串行任务）时跳过产物校验
// （全 parallel 无 SUMMARY 属预期）；含串行任务的 change 豁免不生效，照常校验，不得静默放行。生效
// 时追加被跳过项清单（EMPTY-EXIT-SKIPPED）。
export async function runArtifactGate({ protocol, node, state, emptyExitApproved, emptyExitExempt }) {
  const checkedArtifacts = await missingRequiredArtifacts(protocol, node, state.activeChange);
  let missingArtifacts = checkedArtifacts;
  if (emptyExitApproved && emptyExitExempt) {
    console.error('EMPTY-EXIT-SKIPPED: ' + (checkedArtifacts.length > 0 ? checkedArtifacts.join(', ') : '（无缺失产物项）'));
    missingArtifacts = [];
  }
  if (missingArtifacts.length > 0) {
    console.error('BLOCKED: missing Output Schema artifacts: ' + missingArtifacts.join(', '));
    process.exit(1);
  }
}

// required-skill / augmentation 声明门禁：适用性门控绑定缺的是「真实 skill-load 声明」（出口不再
// 自动补写）——给出补齐路径（判据与该门同源：applicabilityGatedBinding 查询，不另写键表）
export function runRequiredEvidenceGate({ node, evidence }) {
  const missingRequired = missingRequiredSkillChecks(node, evidence);
  if (missingRequired.length > 0) {
    console.error('BLOCKED: missing required Skill evidence: ' + missingRequired.join(', '));
    for (const binding of node.requiredSkillCalls ?? []) {
      const check = 'required-skill:' + node.id + '.' + binding.skill;
      if (missingRequired.includes(check) && applicabilityGatedBinding(node, binding.skill) !== null) {
        console.error('恢复: ' + check + ' 不再由出口自动补写（guarded + 适用性判据成立）——先加载 ' + binding.skill
          + ' 并运行 workflow-state.mjs skill-load ' + node.id + ' ' + binding.skill
          + ' --prompt <flow-kit/prompts/ 协议文件> 声明已加载后重试 exit');
      }
    }
    process.exit(1);
  }
  const missingAugmentations = missingAugmentationChecks(node, evidence);
  if (missingAugmentations.length > 0) {
    console.error('BLOCKED: missing augmentation evidence: ' + missingAugmentations.join(', '));
    process.exit(1);
  }
}
