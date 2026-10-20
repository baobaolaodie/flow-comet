// 节点门禁（守卫模块）：entry 链 + 出口前置 / 文件纪律 / 节点结构 门禁。
//
// 判据只在本模块一处实现（入口零内联副本）；每条门禁沿用既有分级——新 change（init 标记）强制
// BLOCKED + 恢复指引，旧 change 渐进 WARN 不阻断。门禁命中即显式报出原因并按 fail-closed 拒绝
// （未验证 ≠ 通过）。

import { promises as fs } from 'fs';
import path from 'path';
import { validateStateFields } from '../state-schema.mjs';
import { NODE_PROTOCOL_FILES } from '../protocol-utils.mjs';
import {
  EXECUTE_FAMILY_NODE_IDS,
  TASK_SET_SIGNATURE_ALGO,
  analyzeDependencyGraph,
  applyFixRollbackRound,
  findParallelWriteConflicts,
  parseTaskSetSignature,
  resolveFixRollbackDecision,
  resolveFixRollbackState,
  sameTaskSetSignature,
  taskSetSignature,
  taskSetSignatureVersionSkew,
} from '../route-node.mjs';
import { taskOpeningAttrs, taskBlocks as extractTaskBlocks } from '../task-parsing.mjs';
import { runRoot, fileExists, writeJson } from './guard-state-io.mjs';
import { buildSkeleton, headingPattern } from './guard-artifact-skeleton.mjs';
import { frontendCriterion } from './guard-uidesign.mjs';
import {
  TEMPLATE_FALLBACK_SECTION_PATTERNS,
  evidenceFor,
  findSkillLoadsDir,
  hasEvidenceField,
  hasNonEmptyHandoffResult,
  isNewChange,
  missingRequiredArtifacts,
  missingRequiredSchemaEvidence,
  nextNode,
  templateSectionPatterns,
} from './guard-routing.mjs';

// 节点 → 合法 exit 的前置条件（对齐 flow-kit 阶段门 + flowkit.*.v1 evidence）
const NODE_TRANSITION_GATES = {
  open:             { evidence: ['intake-summary'] },
  design:           { evidence: ['design-summary'] },
  plan:             { evidence: ['plan-summary'] },
  execute:          { evidence: ['implementation-summary'] },
  'subagent-execute':{ evidence: ['handoff-result'] },
  review:           { evidence: ['review-summary'] },
  verify:           { evidence: ['verification-result'] },
  archive:          { evidence: ['archive-summary'] },
};

// 声明标记 protocol → basename 提取（exit 校验与节点协议映射表 basename 精确比对）。兼容新旧两种
// 格式：新格式（skill-load 写入）= 纯 basename（如 0-change.md），原样返回；旧格式 = 完整绝对路径
// （Windows 反斜杠 / POSIX 斜杠），提取最后一段后可比对。非字符串（null——skill-load 未传
// --protocol 的新格式缺省）→ null（协议集内无 null，fail-closed 由 includes 比对兜底）。
function markerProtocolBasename(value) {
  if (typeof value !== 'string' || value === '') return null;
  return String(value).replaceAll('\\', '/').split('/').pop() || null;
}

// REVIEW.md 发现区解析——发现的合法位置是模板位置 `### 2.2 …详细发现`（REVIEW 模板的结构子段）；
// 旧形态 `## 发现` 段（历史 REVIEW 的写法）继续按同一套条目口径解析，供旧 change 渐进处置与迁移
// 提示。发现项有两种合法书写形态：① 列表项（"- **" 无序 / "1. **" 有序，两种列表形态同口径解析）；
// ② 模板范例形态（flow-kit/templates/REVIEW.md 2.2 的书写样例 `### 🔴 R<x> · <名字>：<结论>` +
// 粗体字段行）——模板位置下以严重度 token 起头的 H3 同样是发现，标题行即条目自身的第一行（处置
// 标记按该行判定）。不以严重度 token 起头的 H3（如 `### Major`）仍是严重度分区。旧 `## 发现` 段
// 保持列表项口径（历史写法，避免把分区标题误判成发现）。"无"条目（"- 无" / "无（...）"）表示该
// 级别无发现，豁免。条目块包含其后的非空续行，直到空行 / 下一条目 / 下一个标题。严重度只取该条目
// 自身的标题/行首——所属 "### Major" 分区，或标题（加粗部分 / H3 严重度 token）内带级别信息；
// 条目正文引用他条的 [Major] 字样不改变本条严重度。返回 { title, scope, lines, isMajor, ordinal }。
const REVIEW_FINDING_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s*\*\*(.+?)\*\*/;
const REVIEW_SEVERITY_TOKEN_RE = /^(?:🔴|🟡|🟢|\[\s*(?:critical|major|minor)\s*\])\s*/iu;
const REVIEW_DISPOSITION_RE = /\[已修\]|\[升级\]|\[转待办\]/;
const REVIEW_MAJOR_LABEL_RE = /\[\s*Major\s*\]/i;
const REVIEW_ADJUDICATION_RE = /用户裁决\s*[:：]\s*接受延期/;
// 旧形态段的「空段」形态：占位词与「无」条目不构成内容（迁移提示只在旧段真有内容时给）。
const REVIEW_FINDINGS_PLACEHOLDER_RE =
  /^(?:[-*+]\s*)?(?:\*\*)?(?:无|不适用|未涉及|无变更|N\/A|—|（无）|\(无\))(?:\*\*)?[。.；;，,]?$/iu;

// 发现区作用域基准从 REVIEW 骨架派生（模板 `### 2.2 6 维诊断 · 详细发现（4 要素…）` → 结构子段
// 「详细发现」）——段名归一是骨架模块的单一实现，此处不另写段名正则。模板缺席 → primary=null，
// 模板位置判据整体跳过（模板派生判据不臆造；旧形态解析与处置校验照常）。同一父段的其它
// 结构子段（2.0 / 2.1 / 2.3）在模板位置作用域内结束该子段；段内其它 H3（如 brooks 输出的
// `### 🔴 R1 …` 分区）是严重度分区，不结束作用域。
async function reviewFindingScope() {
  const skeleton = await buildSkeleton('REVIEW');
  const subsections = skeleton.derived ? skeleton.structureSubsections : [];
  const primary = subsections.find((entry) => entry.norm.includes('详细发现')) ?? null;
  return {
    primary: primary === null ? null : primary.pattern,
    siblings: primary === null
      ? []
      : subsections
        .filter((entry) => entry !== primary && entry.parentNorm === primary.parentNorm)
        .map((entry) => entry.pattern),
  };
}

// H3 条目形态的严重度从标题前缀的严重度 token 派生（模板范例的 🔴/🟡/🟢；另接受文字标签形态的
// [Critical]/[Major]/[Minor]）——Major 延期裁决门禁对 H3 条目与列表项同口径。
function reviewSubheadingIsMajor(heading) {
  const token = (String(heading).match(REVIEW_SEVERITY_TOKEN_RE) ?? [])[0] ?? '';
  if (/🔴|🟡/u.test(token) || /critical|major/iu.test(token)) return true;
  return REVIEW_MAJOR_LABEL_RE.test(heading);
}

function reviewFindingsItems(text, scope = { primary: null, siblings: [] }) {
  const items = [];
  let mode = 'none'; // 'none' | 'legacy'（旧 ## 发现）| 'primary'（模板位置 2.2）
  let severity = '';
  let current = null;
  const pushCurrent = () => { if (current) { items.push(current); current = null; } };
  for (const line of String(text).split(/\r?\n/)) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      pushCurrent();
      severity = '';
      mode = /^发现/.test(h2[1].trim()) ? 'legacy' : 'none';
      continue;
    }
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      pushCurrent();
      if (mode === 'primary') {
        // 兄弟结构子段结束模板位置作用域；其余三级标题只是严重度分区
        if ((scope.siblings ?? []).some((pattern) => pattern.test(line))) {
          mode = 'none';
          severity = '';
          continue;
        }
        // 模板范例形态：严重度 token 起头的 H3 = 发现条目（标题行即条目自身第一行，处置标记
        // 与列表项同口径按该行判定），续行是粗体字段 / 正文，直到空行或下一个标题。
        const heading = h3[1].trim();
        if (REVIEW_SEVERITY_TOKEN_RE.test(heading)) {
          current = {
            title: heading.replace(REVIEW_SEVERITY_TOKEN_RE, '').trim() || heading,
            scope: 'primary',
            lines: [line],
            isMajor: reviewSubheadingIsMajor(heading),
          };
          continue;
        }
        severity = heading;
        continue;
      }
      if (mode === 'none' && scope.primary !== null && scope.primary.test(line)) {
        mode = 'primary';
        severity = '';
        continue;
      }
      severity = h3[1].trim();
      continue;
    }
    if (mode === 'none') continue;
    const m = line.match(REVIEW_FINDING_ITEM_RE);
    if (m) {
      pushCurrent();
      const title = m[1].trim();
      current = {
        title,
        scope: mode,
        lines: [line],
        isMajor: /^major\b/i.test(severity) || REVIEW_MAJOR_LABEL_RE.test(title),
      };
      continue;
    }
    if (current) {
      if (line.trim() === '') pushCurrent();
      else current.lines.push(line);
    }
  }
  pushCurrent();
  items.forEach((item, i) => { item.ordinal = i + 1; });
  return items;
}

// 旧形态 `## 发现` 段是否有实质内容（占位词 / 子标题 / 空行不计）：写在旧段而模板位置无条目时
// 触发迁移提示——只在旧段真有内容时给，避免空段或只写「无」的旧 REVIEW 被误报。
function reviewLegacyFindingsHasContent(text) {
  let inLegacy = false;
  for (const line of String(text).split(/\r?\n/)) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      inLegacy = /^发现/.test(h2[1].trim());
      continue;
    }
    if (!inLegacy) continue;
    if (/^#{3,6}\s+/.test(line)) continue;
    const trimmed = line.trim();
    if (trimmed === '' || REVIEW_FINDINGS_PLACEHOLDER_RE.test(trimmed)) continue;
    return true;
  }
  return false;
}

// 发现区条目处置标记存在性：返回缺处置状态标记（[已修]/[升级]/[转待办]）的条目标题列表——结构级
// 校验（不做语义判断：标记存在即视为已处置）。发现项（含 Minor；无序与有序条目同口径，均不得
// "记录后无声消失"）的处置标记以该条目自身标题/行首为准——正文引用他条标记不参与判定。
function reviewFindingsMissingDisposition(text, scope = { primary: null, siblings: [] }) {
  return reviewFindingsItems(text, scope)
    .filter((item) => !/^无/.test(item.title)) // "无" 条目豁免
    // 四要素字段行豁免：REVIEW 发现条目的 Symptom/Source/Consequence/Remedy 是 brooks 审查输出
    // 格式的字段行（带 ** 加粗），不是发现条目本身——不豁免会误判为"发现项缺处置标记"（执行者按
    // 4 要素格式书写时被误 BLOCKED）。精确匹配完整标签（允许尾冒号）——"Source maps expose paths"
    // 这类以 Source 开头的真实发现标题不得被前缀匹配误豁免（其处置校验必须照常进行）
    .filter((item) => !/^(?:Symptom|Source|Consequence|Remedy)\s*:?\s*$/i.test(item.title))
    .filter((item) => !REVIEW_DISPOSITION_RE.test(item.lines[0]))
    .map((item) => item.title);
}

// 裁决记录是否指向某条发现：条目标题全文 / 标题内标识 token（如 F1、m-2）/ 条目序号（发现 N、
// 第 N 项、#N）/ 标题核心前缀任一命中即视为指认。结构级判定，不做语义判断。
function reviewAdjudicationPointsTo(record, item) {
  if (record.includes(item.title)) return true;
  const idTokens = item.title.match(/[A-Za-z]{1,8}[-–]?\d{1,4}/g) || [];
  if (idTokens.some((token) => record.includes(token))) return true;
  if (new RegExp('(?:发现|条目|第|#)\\s*' + item.ordinal + '(?!\\d)').test(record)) return true;
  const core = item.title.replace(/[\[\]【】]/g, '').replace(/^[A-Za-z]+\s*/, '').trim().slice(0, 12);
  return core.length >= 6 && record.includes(core);
}

// Major 延期裁决门禁：发现区任何 Major 条目处置为 [转待办] 时，必须同时存在用户裁决记录——同段
// （条目自身段落）或文末其余段落含「用户裁决：接受延期」且指向该条目，并由 [升级] 承接（条目自身
// 块或裁决记录含 [升级]）。任一缺失 → 返回条目标题（调用方按新 change BLOCK / 旧 change WARN 渐进
// 处置）。Minor 不参与；Major [升级]/[已修] 直接放行。条目自身的处置标记（[转待办]）只认该条目标题
// /行首（无序与有序同口径），正文续行引用他条标记不触发本门禁；[升级] 承接可出现在条目自身块或
// 用户裁决记录中（承接非本条处置）。
function reviewDeferredMajorProblems(text, scope = { primary: null, siblings: [] }) {
  const textValue = String(text);
  const items = reviewFindingsItems(textValue, scope);
  const paragraphs = textValue.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const problems = [];
  for (const item of items) {
    const ownLine = item.lines[0];
    if (!item.isMajor || !/\[转待办\]/.test(ownLine)) continue;
    const block = item.lines.join('\n');
    const escalatedInBlock = /\[升级\]/.test(block);
    const blockTrimmed = block.trim();
    if (REVIEW_ADJUDICATION_RE.test(block) && escalatedInBlock) continue; // 同段裁决 + [升级] 承接
    const matched = paragraphs.some((paragraph) => {
      if (!REVIEW_ADJUDICATION_RE.test(paragraph)) return false;
      if (paragraph === blockTrimmed) return false; // 跳过条目自身段落
      return (escalatedInBlock || /\[升级\]/.test(paragraph)) && reviewAdjudicationPointsTo(paragraph, item);
    });
    if (!matched) problems.push(item.title);
  }
  return problems;
}

// 节点 entry 链：受控归位 → 归档分支校验 → 委托前并行写冲突 → 委托前工件 commit 提示 →
// 清窗恢复产物提示 → 任务集签名记录 → 协调者禁令 → 进入标记落盘 → 点名节点实现技能。
export async function runEntryGates({ protocol, node, state, file }) {
  const current = state.currentNode ?? (await nextNode(protocol, state))?.id ?? null;
  // Fix 批次受控归位（共享谓词，唯一受控例外）：review/verify 驻留 + TASK 有 pending 修复任务
  // （串行/并行）或有未闭合家族出口签名时，entry 家族节点（execute / subagent-execute）归位工作
  // 归属并写盘；仅当入口节点与共享谓词目标一致才归位。前置 currentNode 校验对该受控例外放行
  // （该例外允许直接 entry）；其余节点/状态行为不变。
  const fixBatchDecision = EXECUTE_FAMILY_NODE_IDS.has(node.id) && state.activeChange
    ? await resolveFixRollbackDecision({
      runRoot,
      changeName: state.activeChange,
      protocol,
      completedNodes: state.completedNodes,
      currentNode: state.currentNode,
      history: state.history,
    })
    : null;
  const fixBatchRollback = !!fixBatchDecision && fixBatchDecision.target === node.id;
  if (current !== node.id && !state.completedNodes.includes(node.id) && !fixBatchRollback) {
    console.error('BLOCKED: current Node is ' + String(current) + ', cannot enter ' + node.id + '.');
    process.exit(1);
  }
  if (fixBatchRollback) {
    const sourceNode = state.currentNode;
    // 轮次计数与阈值/授权判定全部走共享 helper：分支②不计数；第 4 轮新 change 先 BLOCK
    // （此处尚未写盘，满足不写 currentNode），旧 change WARN 后照常归位。
    const rollbackRound = applyFixRollbackRound({ state, sourceNode, decision: fixBatchDecision });
    if (rollbackRound.blocked) {
      console.error(rollbackRound.blockedMessage);
      process.exit(1);
    }
    if (rollbackRound.warn) console.error(rollbackRound.warnMessage);
    state.currentNode = node.id;
    console.log('FIX-BATCH: 受控归位 ' + node.id + '（源节点 ' + sourceNode + '）' + rollbackRound.auditSuffix);
    const bad = validateStateFields(state);
    if (bad.length) { console.error('BLOCKED: state 字段类型非法: ' + bad[0]); process.exit(1); }
    await writeJson(file, state);
  }
  // entry archive 分支校验（新模式 branchMode=true）——归档必须在 change/<activeChange> 分支上进行；
  // 旧模式（无 branchMode 字段 / 非 git 仓库 / git 不可用）跳过，向后兼容。
  if (node.id === 'archive' && state.branchMode === true && state.activeChange) {
    const { execFileSync } = await import('child_process');
    try {
      const branch = String(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' })).trim();
      // 归档分支前缀用 state.branchPrefix（缺省 'change/'，适配仓库自身规范）
      const archivePrefix = state.branchPrefix ?? 'change/';
      if (branch !== archivePrefix + state.activeChange) {
        console.error('BLOCKED: 归档必须在 ' + archivePrefix + state.activeChange + ' 分支上进行（当前: ' + branch + '）');
        process.exit(1);
      }
    } catch {
      // git 不可用 → 跳过分支校验（旧模式兼容）
    }
  }
  // 并行冲突检测——subagent-execute 委托前校验 wave 内 parallel 任务 write_files 无交集
  // （第二道写写锚：只取强判组，行为与消息保持既有语义不变）
  if (node.id === 'subagent-execute' && state.activeChange) {
    const { writeConflicts } = await findParallelWriteConflicts(path.join(runRoot, '.specs', state.activeChange));
    if (writeConflicts.length > 0) {
      console.error('BLOCKED: parallel tasks write_files 冲突: ' + writeConflicts.map((c) => `${c.a}×${c.b}(${c.files.join(',')})`).join('; '));
      process.exit(1);
    }
  }
  // 委托前工件 commit 检查——worktree isolation 子代理看不到未提交工件（WARN 不 BLOCKED）
  if (EXECUTE_FAMILY_NODE_IDS.has(node.id) && state.activeChange) {
    const { execFileSync } = await import('child_process');
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: runRoot, stdio: 'pipe' });
      const statusOut = execFileSync(
        'git',
        ['status', '--porcelain', '--', path.posix.join('.specs', state.activeChange) + '/'],
        { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' },
      );
      if (String(statusOut).trim() !== '') {
        console.error('WORKTREE WARN: .specs/' + state.activeChange + '/ 有未提交工件，worktree isolation 子代理将看不到它们——建议先 commit 或 prompt 内联上下文');
      }
    } catch (err) {
      // 检测失败可见化——非 git 仓库/路径不可查时提示 SKIP 原因（防静默失效）
      console.error('C4-CHECK SKIP: ' + (err && err.message ? String(err.message).split('\n')[0] : String(err)));
    }
  }
  // PROGRESS.md 存在警告（清窗恢复产物，反重复检查）
  if (node.id === 'execute' && state.activeChange) {
    if (await fileExists(path.join(runRoot, '.specs', state.activeChange, 'PROGRESS.md'))) {
      console.error('WARNING: PROGRESS.md 存在（清窗恢复产物），先读"已排除方案"段（R1.6 反重复）');
    }
  }
  // enter execute / subagent-execute 记录 TASK.md 任务集签名（exit 时比对，防 execute 期间增删任务
  // /改 action/改边界）
  if (EXECUTE_FAMILY_NODE_IDS.has(node.id) && state.activeChange) {
    const taskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
    if (await fileExists(taskFile)) {
      try {
        state.taskHash = taskSetSignature(await fs.readFile(taskFile, 'utf8'));
        const bad = validateStateFields(state);
        if (bad.length) { console.error('BLOCKED: state 字段类型非法: ' + bad[0]); process.exit(1); }
        await writeJson(file, state);
      } catch {}
    }
  }
  // 协调者禁令：execute / subagent-execute 阶段主会话只能委托，禁止直接写源码。例外：direct 模式
  // execute 是主代理直写（逃生口），不输出协调者禁令。
  const entryExecutionMode = state.executionMode ?? 'subagent';
  if (EXECUTE_FAMILY_NODE_IDS.has(node.id)) {
    if (!(entryExecutionMode === 'direct' && node.id === 'execute')) {
      console.log('COORDINATOR: 你是协调者，不是执行者。禁止在主会话直接修改源码；只能通过 Agent 工具 worktree isolation 委托子代理；子代理回传后仅更新 TASK.md / SUMMARY / handoff evidence。');
    }
  }
  // enter 证据——entry 记录节点进入标记（enteredNodes），exit 检测未 entry（防跳过 entry 无痕）
  state.enteredNodes = Array.isArray(state.enteredNodes) ? state.enteredNodes : [];
  if (!state.enteredNodes.includes(node.id)) {
    state.enteredNodes.push(node.id);
    const bad = validateStateFields(state);
    if (bad.length) { console.error('BLOCKED: state 字段类型非法: ' + bad[0]); process.exit(1); }
    await writeJson(file, state);
    // 进入已记录提示（执行者可知 entry 有副作用——进入证据写入）
    console.log('ENTER RECORDED: ' + node.id + ' 进入已记录(enteredNodes)');
  }
  // 输出点名（机器点名节点技能）：进入节点时机器点名该节点实现技能必须经 Skill 工具加载——
  // skill 名取节点实现 skill（内置协议 = flow-comet-plan 等，与 SKILL: 行一致）
  const entryImplSkill = node.implementation && typeof node.implementation === 'object' && node.implementation.skill
    ? node.implementation.skill
    : null;
  if (entryImplSkill) {
    console.log('LOAD SKILL: ' + entryImplSkill + '（用 Skill 工具，禁止跳过）');
  }
  console.log('ENTRY OK: ' + node.id);
}

// 出口前置：本节点 evidence 必须在场（缺失时给出补证据指引）。返回该 evidence。
export function requireNodeEvidence({ node, state }) {
  const evidence = evidenceFor(state, node.id);
  if (!evidence) {
    console.error('BLOCKED: missing evidence for Node ' + node.id + '.');
    console.error('恢复: 该节点已完成但缺证据记录 → 用 workflow-state.mjs record ' + node.id + ' \'{"summary":"<完成摘要>"}\' 补证据后重试；状态漂移 → advance/select；禁止手改 state 机器字段');
    process.exit(1);
  }
  return evidence;
}

// 转移前置约束——currentNode 必须等于被 exit 的节点（防跳阶段）。currentNode 已漂移到文件推导
// 位置（resolveNextNode(completedNodes) === currentNode，如 execute 证据/产物齐后路由已指向 review）
// 且本节点 evidence 齐 + 产物齐（执行者确认本节点实际已完成）→ 容错放行 exit（漂移/提前校正态可
// 补欠账；BLOCK 消息/提示标注「漂移态可用容错 exit」——不再只有不可行的 advance/select 指引）。
// 漂移但 evidence/产物不齐 → 仍严格 BLOCK（容错不放开未完成）。
export async function runExitDriftGate({ protocol, node, state, evidence }) {
  if (state.currentNode === node.id) return;
  let tolerable = false;
  if (evidence) {
    const derivedNext = await nextNode(protocol, state);
    const missingDriftArtifacts = await missingRequiredArtifacts(protocol, node, state.activeChange);
    const missingDriftSchemaEvidence = missingRequiredSchemaEvidence(protocol, node, evidence);
    tolerable = !!(
      derivedNext && derivedNext.id === state.currentNode
      && missingDriftArtifacts.length === 0
      && missingDriftSchemaEvidence.length === 0
    );
  }
  if (tolerable) {
    console.log('NOTE: 容错放行——currentNode 已为文件推导下一节点且本节点证据/产物齐（执行者确认本节点实际已完成），exit ' + node.id + ' --apply 补齐欠账（漂移容忍路径）');
  }
  if (!tolerable) {
    console.error('BLOCKED: currentNode is ' + String(state.currentNode) + ', cannot exit ' + node.id + '.');
    console.error('恢复: 若节点状态漂移/卡死 → 用 workflow-state.mjs advance（强制推进，确认节点实际已完成后再用）或 select（切换 change）；禁止手改 state 机器字段');
    console.error('提示: 若 currentNode 已漂移到文件推导位置且本节点证据/产物齐（执行者确认本节点实际已完成）→ 可用容错 exit ' + node.id + ' --apply 补齐欠账（漂移容忍路径，不再只有不可行的 advance/select 指引）；漂移但证据/产物不齐则不适用');
    process.exit(1);
  }
}

// Fix 批次越界拦截——源节点（review/verify）驻留，且 TASK 仍有 pending 修复任务，或修复任务已
// done 但本批 execute 家族生命周期未闭合（本 change 最新家族出口签名 ≠ 当前任务集签名）时，直接
// exit 源节点收场会静默跳过 execute 家族生命周期与四类出口（缺陷形态）。排在 entry 证据门之前：
// 该越界路径给 Fix 恢复指引，避免通用 entry 提示覆盖更具体的归位路径。复用共享回退谓词判定：
// 新 change 强制 BLOCKED 含恢复指引；旧 change 渐进 WARN 不阻断。
export async function runFixBatchExitGate({ protocol, node, state }) {
  if ((node.id !== 'review' && node.id !== 'verify') || !state.activeChange) return;
  const fixBatchUnclosed = await resolveFixRollbackState({
    runRoot,
    changeName: state.activeChange,
    protocol,
    completedNodes: state.completedNodes,
    currentNode: node.id,
    history: state.history,
  });
  if (fixBatchUnclosed && isNewChange(state)) {
    console.error('BLOCKED: 存在未归位/未跑出口的 Fix 批次——' + node.id + ' 驻留且 TASK.md 存在 pending 修复任务，或修复任务已 done 但本批 execute / subagent-execute 生命周期未闭合（最近一次 execute 家族 exit 后任务集仍有变更），不能直接 exit ' + node.id + ' 收场（会静默跳过 execute 家族生命周期与四类出口）');
    console.error('恢复: 运行 workflow-state.mjs next 或 workflow-guard.mjs entry execute / entry subagent-execute 受控归位 execute 家族节点 → 在 execute 家族生命周期内完成修复任务 → record/exit 该节点 --apply 跑完四类出口并回源节点 ' + node.id + ' → 再 exit ' + node.id + ' --apply');
    process.exit(1);
  }
  if (fixBatchUnclosed) {
    console.error('FIX-BATCH WARN: 存在未归位/未跑出口的 Fix 批次——' + node.id + ' 驻留且 TASK.md 存在 pending 修复任务，或修复任务已 done 但本批 execute / subagent-execute 生命周期未闭合，直接 exit ' + node.id + ' 会跳过 execute 家族出口门禁（旧 change 渐进不阻断；建议 next/entry execute 家族节点归位跑完出口后回源节点 exit）');
  }
}

// enter 证据检测——未 entry 直接 exit：新 change（init 标记）强制 BLOCKED，旧 change 渐进 WARN。
// 跳过 entry 会漏掉进入检查（协调者禁令 / 委托前工件 commit 提示 / PROGRESS 提示 / 签名记录）。
export function runEntryRecordGate({ node, state }) {
  if (isNewChange(state)) {
    if (!Array.isArray(state.enteredNodes) || !state.enteredNodes.includes(node.id)) {
      console.error('BLOCKED: 节点 ' + node.id + ' 未执行 entry 直接 exit——新 change 强制先 entry(进入检查/协调者禁令/签名记录)');
      console.error('恢复: 先运行 workflow-guard.mjs entry ' + node.id + ' 再重试 exit;状态漂移 → advance/select');
      process.exit(1);
    }
  } else if (Array.isArray(state.enteredNodes) && !state.enteredNodes.includes(node.id)) {
    console.error('ENTER WARN: 节点 ' + node.id + ' 未执行 entry 直接 exit——entry 的进入检查(协调者禁令/C4 委托前检查/签名记录)被跳过,请先 entry 该节点再 exit(旧 change 渐进不阻断)');
  }
}

// exit archive 分支合并检查（WARN 不 BLOCK）——分支未合并到 main 允许"归档先行、合并后补"
export async function runArchiveBranchMergeGate({ node, state }) {
  if (node.id !== 'archive' || state.branchMode !== true || !state.activeChange) return;
  const { execFileSync } = await import('child_process');
  try {
    const branch = String(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' })).trim();
    const mergedOut = String(execFileSync('git', ['branch', '--merged', 'main'], { cwd: runRoot, stdio: 'pipe', encoding: 'utf8' }));
    const mergedBranches = mergedOut.split('\n').map(l => l.trim().replace(/^\*\s*/, ''));
    if (!mergedBranches.includes(branch)) {
      console.error('WARN: 分支 change/' + state.activeChange + ' 未合并到 main——归档后请完成 merge + 删除分支');
    }
  } catch {
    // git 不可用 / main 不存在 → 跳过合并检查
  }
}

// 特化校验按节点 id 绑定（ADR-002 分层）：内置节点 id 触发 flow-kit 契约校验；自定义协议节点不
// 误触发（通用层防线对其生效）。
// 追加位置结构检测（全部 WARN 不 BLOCK）——防 CONTEXT/LESSONS/STATE/CHANGELOG 文件尾追加破坏
// 插入位置纪律；open 出口另做 CONTEXT 模板段校验（项目级工件不受 C3 节点映射约束，也不要求
// skill-load 声明模板——C17）。
// 条件子段（C21）：`自定义 hooks（前端）` 只在前端 change 要求；其余子段无条件要求（未发现的写
// 「未发现」）。前端判定沿用 CHANGE.md「视觉调性」段的既有判据（单一实现）。
const CONTEXT_FRONTEND_ONLY_SUBSECTION = '自定义 hooks';

// CONTEXT 模板段问题清单：段集合取自骨架（模板 = 内容权威），段标题按段名归一匹配（忽略编号 /
// 括号后缀 / 大小写，AC-9）；父段缺席时不再列其子段（父段已单独报出，避免同一事实重复计数）。
// 模板缺席（derived=false）→ 返回 null：模板派生判据整体跳过，由调用方输出显式「未校验（模板缺失）」
// ——不退回任何内置段名副本。
async function contextTemplateProblems(state, content) {
  const skeleton = await buildSkeleton('CONTEXT');
  if (!skeleton.derived) return null;
  const problems = [];
  for (const section of skeleton.sections) {
    if (!section.pattern.test(content)) problems.push('缺段「## ' + section.name + '」');
  }
  const frontend = await frontendCriterion(state.activeChange);
  for (const sub of skeleton.structureSubsections) {
    if (!frontend.applicable && sub.name.includes(CONTEXT_FRONTEND_ONLY_SUBSECTION)) continue;
    const parent = skeleton.sections.find((section) => section.name === sub.parent);
    if (parent && !parent.pattern.test(content)) continue;
    if (!sub.pattern.test(content)) problems.push('缺子段「### ' + sub.name + '」');
  }
  return problems;
}

export async function runContextAppendGate({ node, state }) {
  if (node.id !== 'open' || !state.activeChange) return;
  const contextFile = path.join(runRoot, '.specs', 'CONTEXT.md');
  if (!(await fileExists(contextFile))) return; // 项目级工件可缺席：文件存在才查
  let content = null;
  try { content = await fs.readFile(contextFile, 'utf8'); } catch { content = null; }
  if (content === null) return;
  const m = content.match(/^## (术语|已锁决策|决策|术语表)[（(][^\n]*(?:追加|update)[^\n]*$/im);
  if (m) {
    if (isNewChange(state)) {
      console.error('BLOCKED: CONTEXT.md 检测到孤立追加段（新 change 强制插入既有结构段）;恢复: 把内容移入术语表/已锁决策段');
      process.exit(1);
    }
    console.error('WARN: CONTEXT.md 检测到孤立追加段（术语/决策应插入既有结构段）：' + m[0].replace(/^##\s*/, '').trim());
  }
  const problems = await contextTemplateProblems(state, content);
  if (problems === null) {
    // 模板缺席：段形校验跳过但显式声明（未验证 ≠ 通过），修复指引给出取模板的途径
    console.error('CONTEXT 未校验（模板缺失）——flow-kit/templates/CONTEXT.md 不在项目根，段形校验跳过'
      + '（修复: 按安装指引获取 flow-kit 模板后重试）');
    return;
  }
  if (problems.length === 0) return;
  if (isNewChange(state)) {
    console.error('BLOCKED: CONTEXT.md 有 ' + problems.length + ' 处与模板段形不符（新 change 强制项目上下文按模板段形书写）:');
    for (const problem of problems) console.error('  - ' + problem);
    console.error('恢复: 按 flow-kit/templates/CONTEXT.md 补齐段标题（未发现的写「未发现」；前端子段按条件段裁剪）后重试 exit open');
    process.exit(1);
  }
  console.error('WARN: CONTEXT.md 有 ' + problems.length + ' 处与模板段形不符（旧 change 渐进不阻断）: '
    + problems.join('、'));
}

// LESSONS.md 结构检测（每条判据的作用面逐个交代）：
// ① 旧形态 `## L-NNN`（条目写成二级标题）——open / verify / archive 三处出口都拦（AC-17），新
//    change BLOCKED 并逐行给「文件:行号 → 改法」，旧 change WARN 渐进；
// ② 条目区外条目（条目区锚点用段名归一，容忍模板标题的括号后缀，如 `## 条目区（夹具）`）与
//    ③ 同段内编号递增——两条保持既有作用面（verify / archive），不随 ① 扩到 open；
// ④ `### L-NNN` 条目的字段键（C20）——键集合从 LESSONS 模板「条目格式」段的书写样例派生；新 change
//    的新条目缺任一键 BLOCKED，旧条目（迁移形态 / 首发指向别的 change）与旧 change 只 WARN；
// ⑤ archive 出口核对 evidence.lessonsNomination：扫描份数 = 该 change 内 SUMMARY 份数、提名编号在
//    LESSONS 中真实存在、无提名时理由非空——归档提名留痕且可核对。
const LESSONS_LEGACY_ENTRY_RE = /^##\s+(L-\d+)\b/u;
const LESSONS_ENTRY_ZONE_NAMES = ['条目区', '活跃条目', '已解决条目'];
// `### L-NNN` 条目块（后接非数字/非字母，避免吞掉更长编号）。模板条目形态 = `### L-NNN · [tag] 标题`
// （「条目格式」段给出的书写样例）；迁移形态（`### L-NNN:` 冒号标题）与裸标题（`### L-NNN`）等
// 历史写法一律按旧条目处置（不足字段只 WARN）——新条目的判定因此只看「模板标题形态 + 字段键」。
const LESSONS_ENTRY_HEADING_RE = /^###\s*(L-\d+)(?![\dA-Za-z])/u;
const LESSONS_TEMPLATE_HEADING_RE = /^###\s*L-\d+\s*·/u;
// 字段键行：`- **<键>**: <值>`（条目正文里的粗体小标题不带列表符，不会命中）。
const LESSONS_FIELD_LINE_RE = /^[-*]\s*\*\*(.+?)\*\*\s*[:：]\s*(.*)$/u;

// 旧形态条目行（行号 1 基）：迁移指引逐行可执行，执行者不必自己数行号。
function lessonsLegacyEntries(content) {
  const hits = [];
  String(content).split(/\r?\n/).forEach((line, index) => {
    const matched = line.match(LESSONS_LEGACY_ENTRY_RE);
    if (matched) hits.push({ line: index + 1, id: matched[1] });
  });
  return hits;
}

// 该 change 的 SUMMARY 份数（C6：先看活动目录，目录已移入归档时看 `.specs/archive/*-<change>/`；
// 两处都不存在 → null = 归档产物缺失——不可核对的份数不当作 0）。
async function changeSummaryCount(changeName) {
  const activeDir = path.join(runRoot, '.specs', changeName);
  let dir = null;
  if (await fileExists(activeDir)) {
    dir = activeDir;
  } else {
    const archiveRoot = path.join(runRoot, '.specs', 'archive');
    const entries = await fs.readdir(archiveRoot).catch(() => []);
    const archived = entries.find((entry) => entry.endsWith('-' + changeName));
    if (archived) dir = path.join(archiveRoot, archived);
  }
  if (dir === null) return null;
  const files = await fs.readdir(dir).catch(() => []);
  return files.filter((name) => name.endsWith('-SUMMARY.md')).length;
}

// LESSONS 里已登记的条目编号（旧形态与迁移后的新形态都算「编号存在」——形态由 ① 单独校验，
// 存在性只判编号是否真实登记）。
async function lessonsEntryNumbers() {
  const lessonsFile = path.join(runRoot, '.specs', 'LESSONS.md');
  let content;
  try { content = await fs.readFile(lessonsFile, 'utf8'); } catch { return new Set(); }
  const numbers = new Set();
  for (const matched of String(content).matchAll(/^#{2,3}\s*L-(\d+)/gm)) numbers.add(parseInt(matched[1], 10));
  return numbers;
}

// 归档提名核对（结构级）：evidence.lessonsNomination = { scanned, nominated[], reasonIfNone }。
async function lessonsNominationProblems(state) {
  const nomination = evidenceFor(state, 'archive')?.lessonsNomination;
  if (!nomination || typeof nomination !== 'object' || Array.isArray(nomination)) {
    return ['缺 evidence.lessonsNomination（应记录 { scanned, nominated[], reasonIfNone }）'];
  }
  const problems = [];
  const actual = await changeSummaryCount(state.activeChange);
  if (actual === null) {
    problems.push('该 change 的工件目录缺失（.specs/<change>/ 与 .specs/archive/*-<change>/ 都不存在），无从核对扫描份数');
  } else if (nomination.scanned !== actual) {
    problems.push('扫描份数 ' + JSON.stringify(nomination.scanned ?? null)
      + ' ≠ 该 change 内 *-SUMMARY.md 份数 ' + actual);
  }
  if (!Array.isArray(nomination.nominated)) {
    problems.push('lessonsNomination.nominated 须为数组（无提名写 []）');
  } else if (nomination.nominated.length === 0) {
    if (!(typeof nomination.reasonIfNone === 'string' && nomination.reasonIfNone.trim() !== '')) {
      problems.push('无提名时 lessonsNomination.reasonIfNone 不能为空（写明本轮为何没有条目入库）');
    }
  } else {
    const known = await lessonsEntryNumbers();
    for (const id of nomination.nominated) {
      const matched = typeof id === 'string' ? id.match(/^L-(\d+)$/iu) : null;
      if (matched === null) {
        problems.push('提名编号格式非法: ' + JSON.stringify(id) + '（应为 L-NNN）');
      } else if (!known.has(parseInt(matched[1], 10))) {
        problems.push('提名编号在 LESSONS.md 中不存在: ' + id);
      }
    }
  }
  return problems;
}

// ① 旧形态条目（`## L-NNN`）：open / verify / archive 三处出口都拦（AC-17）——报文逐行给「文件:
// 行号 → 改法」，迁移口径 = 改级 + 移入条目区 + 按编号排序。新 change BLOCKED / 旧 change WARN。
function checkLessonsEntryForm({ content, node, state }) {
  const legacyEntries = lessonsLegacyEntries(content);
  if (legacyEntries.length === 0) return;
  if (isNewChange(state)) {
    console.error('BLOCKED: LESSONS.md 有 ' + legacyEntries.length + ' 条旧形态条目（## L-NNN）——新 change 强制条目写成三级标题并置于条目区:');
    for (const entry of legacyEntries) {
      console.error('  - .specs/LESSONS.md:' + entry.line + ' → 改成 "### ' + entry.id + '"（并移入 ## 条目区，按编号升序）');
    }
    console.error('恢复: 逐行按上述改法迁移（改级 + 移入条目区 + 按编号排序）后重试 exit ' + node.id);
    process.exit(1);
  }
  console.error('WARN: LESSONS.md 有 ' + legacyEntries.length + ' 条旧形态条目（应为 ### L-NNN 并置于条目区；旧 change 渐进不阻断）: '
    + legacyEntries.map((entry) => '.specs/LESSONS.md:' + entry.line + ' → ### ' + entry.id).join('、'));
}

// ② 条目区外条目 + ③ 同段内编号递增：既有结构判据保持原作用面（verify / archive）——open 出口只
// 新增 ① 的旧形态迁移判据，不顺手把这两条扩张到 open（判据作用面按 AC 逐个交代）。
function checkLessonsZoneAndOrder({ content, state }) {
  // 条目区锚点（段名归一：条目区 / 活跃条目 / 已解决条目，容忍括号后缀）——取最早条目段
  const zoneIndex = (() => {
    const hits = LESSONS_ENTRY_ZONE_NAMES
      .map((name) => content.search(headingPattern(name, 2)))
      .filter((index) => index !== -1);
    return hits.length ? Math.min(...hits) : -1;
  })();
  const headings = [...content.matchAll(/^###\s*L-(\d+)/gm)];
  if (zoneIndex !== -1) {
    const outside = headings.some(h => h.index < zoneIndex);
    if (outside) {
      if (isNewChange(state)) {
        console.error('BLOCKED: LESSONS.md 有条目在条目区外（新 change 强制条目插入条目区）;恢复: 移入条目区');
        process.exit(1);
      }
      // 诊断信息附带 zoneIndex/条目位置——偶发 WARN 排查时可直接定位（文件时序/编码差异兜底）
      console.error('WARN: LESSONS.md 有条目在条目区外(zoneIndex=' + zoneIndex + ', 条目数=' + headings.length + ', 区外条目: ' + headings.filter(h => h.index < zoneIndex).map(h => 'L-' + h[1]).join(',') + ')');
    }
  }
  const nums = headings.map(h => parseInt(h[1], 10));
  // 分段检测：按 ## 标题分段，仅同段内比较编号递增（多段 LESSONS 如「活跃条目/已解决条目」编号体系可独立）
  const sectionStarts = [...content.matchAll(/^##\s+.*$/gm)].map(m => m.index);
  for (let i = 1; i < nums.length; i++) {
    const sameSection = !sectionStarts.some(s => s > headings[i - 1].index && s < headings[i].index);
    if (sameSection && nums[i] <= nums[i - 1]) {
      if (isNewChange(state)) {
        console.error('BLOCKED: LESSONS.md 条目编号乱序（新 change 强制按编号插入条目区）;恢复: 按 L-NNN 顺序插入');
        process.exit(1);
      }
      console.error('WARN: LESSONS.md 条目编号乱序（L-' + String(nums[i]).padStart(3, '0') + ' 应按序插入条目区）');
      break;
    }
  }
}

// ④ 条目字段键（C20）：键集合从 LESSONS 模板「条目格式」段的书写样例派生（不写字面第二份清单）。
// 模板缺席 / 无「条目格式」段 / 样例无字段行 → null——调用方显式声明「未校验（模板缺失）」，不臆造。
async function lessonsEntryFieldKeys() {
  const skeleton = await buildSkeleton('LESSONS');
  if (!skeleton.derived) return null;
  const formatSection = skeleton.sections.find((section) => section.norm.includes('条目格式'));
  if (!formatSection) return null;
  let text;
  try { text = await fs.readFile(skeleton.file, 'utf8'); } catch { return null; }
  const keys = [];
  let inSection = false;
  let inFence = false;
  for (const line of String(text).replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split('\n')) {
    if (!inSection) {
      if (formatSection.pattern.test(line)) inSection = true;
      continue;
    }
    if (/^##\s+/u.test(line)) break;
    if (/^\s*```/u.test(line)) { inFence = !inFence; continue; }
    if (!inFence) continue;
    const matched = line.match(LESSONS_FIELD_LINE_RE);
    if (matched) keys.push(matched[1].trim());
  }
  return keys.length > 0 ? keys : null;
}

// `### L-NNN` 条目块：标题行 + 其后各行，直到下一个 H2/H3 标题；围栏内的书写样例不算条目
// （模板的条目格式样例就是 fenced 形态）——与 LESSONS 关键词扫描的围栏口径一致。
function lessonsEntryBlocks(content) {
  const blocks = [];
  let current = null;
  let inFence = false;
  String(content).replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split('\n').forEach((line, index) => {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      if (current) current.lines.push(line);
      return;
    }
    if (inFence) {
      if (current) current.lines.push(line);
      return;
    }
    if (/^#{2,3}\s/u.test(line)) {
      const matched = line.match(LESSONS_ENTRY_HEADING_RE);
      current = matched === null ? null : { id: matched[1], line: index + 1, heading: line, lines: [line] };
      if (current) blocks.push(current);
      return;
    }
    if (current) current.lines.push(line);
  });
  return blocks;
}

// 旧条目判定（结构级，不做语义判断）：非模板标题形态（迁移冒号形态 / 裸标题等历史写法，含 T11
// 迁移保留原标题形态的条目）或「首发」键指向别的 change。其余缺字段条目按「新条目」处置——
// 新条目只有标题与正文（无任何字段键）时同样落在 BLOCK 分支（M-5 的失效模式）。
function lessonsEntryIsOld(block, originKey, state) {
  if (!LESSONS_TEMPLATE_HEADING_RE.test(block.heading)) return true;
  if (originKey === null) return false;
  for (const line of block.lines.slice(1)) {
    const matched = line.match(LESSONS_FIELD_LINE_RE);
    if (matched && matched[1].trim() === originKey) {
      const origin = matched[2].trim();
      return origin !== '' && !origin.includes(state.activeChange);
    }
  }
  return false;
}

// ④ 字段键存在性（C20）：新 change 的新条目缺任一键 → BLOCKED；旧条目 / 旧 change → WARN 渐进。
function checkLessonsEntryFields({ content, node, state, keys }) {
  const originKey = keys.find((key) => key.includes('首发')) ?? null;
  const blocked = [];
  const warned = [];
  for (const block of lessonsEntryBlocks(content)) {
    const present = new Map();
    for (const line of block.lines.slice(1)) {
      const matched = line.match(LESSONS_FIELD_LINE_RE);
      if (matched && !present.has(matched[1].trim())) present.set(matched[1].trim(), matched[2].trim());
    }
    const missing = keys.filter((key) => !present.has(key));
    if (missing.length === 0) continue;
    (lessonsEntryIsOld(block, originKey, state) ? warned : blocked)
      .push({ id: block.id, line: block.line, missing });
  }
  const describe = (entry) => '.specs/LESSONS.md:' + entry.line + ' ' + entry.id
    + '（缺 ' + entry.missing.join('/') + '）';
  if (warned.length > 0) {
    console.error('LESSONS WARN: LESSONS.md 有 ' + warned.length + ' 条旧条目缺字段键（迁移/既有条目渐进不阻断）: '
      + warned.map(describe).join('、'));
  }
  if (blocked.length === 0) return;
  const guide = '恢复: 按 flow-kit/templates/LESSONS.md「条目格式」段补全字段键（' + keys.join(' / ')
    + '；正文块不强制）后重试 exit ' + node.id;
  if (!isNewChange(state)) {
    console.error('LESSONS WARN: LESSONS.md 有 ' + blocked.length + ' 条条目缺字段键（旧 change 渐进不阻断）: '
      + blocked.map(describe).join('、') + '；' + guide);
    return;
  }
  console.error('BLOCKED: LESSONS.md 有 ' + blocked.length + ' 条新条目缺字段键（新 change 强制新条目按模板条目格式书写）:');
  for (const entry of blocked) console.error('  - ' + describe(entry));
  console.error(guide);
  process.exit(1);
}

// ⑤ archive 出口的归档提名核对（对账 SUMMARY 份数 / 提名编号存在性 / 无提名理由）——归档提名
// 留痕且可核对。新 change BLOCKED / 旧 change WARN（C10）。
async function checkLessonsNomination({ state }) {
  const problems = await lessonsNominationProblems(state);
  if (problems.length === 0) return;
  if (isNewChange(state)) {
    console.error('BLOCKED: archive 出口的 evidence.lessonsNomination 不成立（' + problems.length + ' 项）:');
    for (const problem of problems) console.error('  - ' + problem);
    console.error('恢复: workflow-state.mjs record archive \'{"summary":"<归档摘要>","lessonsNomination":'
      + '{"scanned":<该 change 内 SUMMARY 份数>,"nominated":["L-NNN"],"reasonIfNone":"<无提名时的理由>"}}\' 补齐后重试 exit archive');
    process.exit(1);
  }
  console.error('NOMINATION WARN: evidence.lessonsNomination 不成立（旧 change 渐进不阻断）: ' + problems.join('；'));
}

export async function runLessonsZoneGate({ node, state }) {
  if (!['open', 'verify', 'archive'].includes(node.id) || !state.activeChange) return;
  const lessonsFile = path.join(runRoot, '.specs', 'LESSONS.md');
  let content = null;
  try { content = await fs.readFile(lessonsFile, 'utf8'); } catch { content = null; }
  if (content !== null) {
    checkLessonsEntryForm({ content, node, state });
    if (node.id !== 'open') {
      checkLessonsZoneAndOrder({ content, state });
      const fieldKeys = await lessonsEntryFieldKeys();
      if (fieldKeys === null) {
        console.error('LESSONS 条目字段 未校验（模板缺失）——flow-kit/templates/LESSONS.md 或其「条目格式」样例缺席，'
          + '字段键无法派生（修复: 按安装指引获取 flow-kit 模板后重试）');
      } else {
        checkLessonsEntryFields({ content, node, state, keys: fieldKeys });
      }
    }
  }
  if (node.id === 'archive') await checkLessonsNomination({ state });
}

// STATE.md / CHANGELOG.md 倒序检测（archive 出口）：决策日志与表格条目应顶部插入（新→旧）
export async function runArchiveLogOrderGate({ node, state }) {
  if (node.id !== 'archive') return;
  const stateMd = path.join(runRoot, 'STATE.md');
  try {
    const content = await fs.readFile(stateMd, 'utf8');
    const dates = [...content.matchAll(/^- `?\[(\d{4}-\d{2}-\d{2})\]/gm)].map(m => m[1]);
    for (let i = 1; i < dates.length; i++) {
      if (dates[i] > dates[i - 1]) {
        if (isNewChange(state)) {
          console.error('BLOCKED: STATE.md 决策日志非倒序（新 change 强制顶部插入）;恢复: 顶部插入新决策');
          process.exit(1);
        }
        console.error('WARN: STATE.md 决策日志非倒序（新决策应插入顶部）');
        break;
      }
    }
  } catch {}
  const changelogFile = path.join(runRoot, '.specs', 'CHANGELOG.md');
  try {
    const content = await fs.readFile(changelogFile, 'utf8');
    const dates = [...content.matchAll(/^\| (\d{4}-\d{2}-\d{2}) \|/gm)].map(m => m[1]);
    for (let i = 1; i < dates.length; i++) {
      if (dates[i] > dates[i - 1]) {
        if (isNewChange(state)) {
          console.error('BLOCKED: CHANGELOG.md 表格日期非倒序（新 change 强制顶部插入）;恢复: 表格顶部插入新条目');
          process.exit(1);
        }
        console.error('WARN: CHANGELOG.md 表格日期非倒序（新条目应插入表格顶部）');
        break;
      }
    }
    // 归档收尾登记兜底（WARN 渐进，新旧一致）——CHANGELOG 未含本 change 标识（change-id）→ 提示
    // 补登记，防静默遗漏（提交信息声称已登记但实际未改时机制无兜底；检测为存在级——含 change-id
    // 字样即视为已登记）
    if (state.activeChange && !content.includes(state.activeChange)) {
      console.error('WARN: CHANGELOG.md 未登记本 change(' + state.activeChange + ')——归档收尾应在 CHANGELOG 顶部插入本 change 条目(跟随项目既有格式)');
    }
  } catch {}
}

// 每个节点合法 exit 必须满足前置 evidence（对应 flowkit.*.v1 的 evidence）。语义与
// missingRequiredSchemaEvidence 一致：summary 视同满足（record 命令默认只写 summary）。
export function runTransitionEvidenceGate({ node, evidence }) {
  const gate = NODE_TRANSITION_GATES[node.id];
  if (!gate) return;
  for (const ev of gate.evidence) {
    // subagent-execute 的 handoff-result gate 兼容共用证据库——委托结果记录在嵌套 handoffResult
    // （键名契约 handoff-result vs handoffResult 错位），非空即满足（存在性校验；每个委托内容的
    // Return Contract 严格校验由 Return Contract 校验负责）
    const satisfied = hasEvidenceField(evidence, ev) ||
      (typeof evidence.summary === 'string' && evidence.summary.trim() !== '') ||
      (node.id === 'subagent-execute' && ev === 'handoff-result' && hasNonEmptyHandoffResult(evidence));
    if (!satisfied) {
      console.error('BLOCKED: node ' + node.id + ' exit requires evidence: ' + ev);
      process.exit(1);
    }
  }
}

// exit execute / subagent-execute 校验 TASK.md 任务集签名未变（status 标记 done 合法已剥离；
// 增删任务/改 action/改边界 BLOCKED）
export async function runTaskSetSignatureExitGate({ node, state }) {
  if (!EXECUTE_FAMILY_NODE_IDS.has(node.id) || !state.activeChange) return;
  if (!(typeof state.taskHash === 'string' && state.taskHash.length > 0)) return;
  const taskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
  if (!(await fileExists(taskFile))) return;
  try {
    const currentHash = taskSetSignature(await fs.readFile(taskFile, 'utf8'));
    if (taskSetSignatureVersionSkew(state.taskHash, currentHash)) {
      // 跨算法版本不做一致性比对（值不可比），不误拦任务集；要强制一致需重新 entry 重建签名
      const storedAlgo = parseTaskSetSignature(state.taskHash)?.algo ?? 'unknown';
      console.error('SIGNATURE-ALGO WARN: state.taskHash 算法版本 ' + storedAlgo + ' 与当前任务集签名版本 ' + TASK_SET_SIGNATURE_ALGO + ' 不同——跨版本不做一致性比对，本轮不阻断；如需强制一致请重新 entry execute 家族节点重建签名');
    } else if (!sameTaskSetSignature(state.taskHash, currentHash)) {
      console.error('BLOCKED: TASK.md 任务集被修改（签名不匹配），execute 期间不允许增删任务/改 action/改边界');
      process.exit(1);
    }
  } catch {}
}

// open exit 校验 REQUIREMENT 含 AC 段（段名基准从 REQUIREMENT 模板派生，模板缺失 fallback 内置段名）
export async function runRequirementAcGate({ node, state }) {
  if (node.id !== 'open' || !state.activeChange) return;
  const reqFile = path.join(runRoot, '.specs', state.activeChange, 'REQUIREMENT.md');
  try {
    const content = await fs.readFile(reqFile, 'utf8');
    const acceptance = (await templateSectionPatterns()).pick('requirement', ['验收'], TEMPLATE_FALLBACK_SECTION_PATTERNS.requirementAcceptance);
    if (!acceptance.test(content) && !/Given/i.test(content)) {
      console.error('BLOCKED: REQUIREMENT.md 缺少验收标准/AC 段');
      process.exit(1);
    }
  } catch {}
}

// design exit 校验 DESIGN 含技术栈段
export async function runDesignStackGate({ node, state }) {
  if (node.id !== 'design' || !state.activeChange) return;
  const designFile = path.join(runRoot, '.specs', state.activeChange, 'DESIGN.md');
  const designLite = path.join(runRoot, '.specs', state.activeChange, 'DESIGN-lite.md');
  const target = (await fileExists(designFile)) ? designFile : (await fileExists(designLite)) ? designLite : null;
  if (!target) return;
  try {
    const content = await fs.readFile(target, 'utf8');
    if (!/##\s*0[\s.]/.test(content) && !/##\s*技术栈/.test(content)) {
      console.error('BLOCKED: DESIGN.md 缺少 §0 技术栈段');
      process.exit(1);
    }
  } catch {}
}

// open exit 补必填段校验（结构+存在级，不做语义）——CHANGE.md 含 Why 段；REQUIREMENT.md 含
// 用户故事 段。段名基准从 flow-kit 模板派生（CHANGE 模板 "## Why（为什么做）"、REQUIREMENT 模板
// "## 用户故事"），模板缺失 fallback。
export async function runOpenRequiredSectionsGate({ node, state }) {
  if (node.id !== 'open' || !state.activeChange) return;
  const changeDir = path.join(runRoot, '.specs', state.activeChange);
  const tpl = await templateSectionPatterns();
  const required = [
    ['CHANGE.md', tpl.pick('change', ['Why', '为什么'], TEMPLATE_FALLBACK_SECTION_PATTERNS.changeWhy)],
    ['REQUIREMENT.md', tpl.pick('requirement', ['用户故事'], TEMPLATE_FALLBACK_SECTION_PATTERNS.requirementUserStory)],
  ];
  for (const [file, regex] of required) {
    const p = path.join(changeDir, file);
    if (await fileExists(p)) {
      try {
        const text = await fs.readFile(p, 'utf8');
        if (!regex.test(text)) {
          console.error('BLOCKED: ' + file + ' 缺必填段 ' + regex);
          process.exit(1);
        }
      } catch {}
    }
  }
}

// design exit 补必填段校验——DESIGN.md 含 ## 决策清单（段名基准从 DESIGN 模板派生，"## 1. 决策清单"
// 编号前缀可选）
export async function runDesignDecisionListGate({ node, state }) {
  if (node.id !== 'design' || !state.activeChange) return;
  const designFile = path.join(runRoot, '.specs', state.activeChange, 'DESIGN.md');
  const designLite = path.join(runRoot, '.specs', state.activeChange, 'DESIGN-lite.md');
  const target = (await fileExists(designFile)) ? designFile : (await fileExists(designLite)) ? designLite : null;
  if (!target) return;
  try {
    const text = await fs.readFile(target, 'utf8');
    const decisionList = (await templateSectionPatterns()).pick('design', ['决策清单'], TEMPLATE_FALLBACK_SECTION_PATTERNS.designDecisionList);
    if (!decisionList.test(text)) {
      console.error('BLOCKED: DESIGN.md 缺必填段 ## 决策清单');
      process.exit(1);
    }
  } catch {}
}

// plan exit 校验 TASK 含 task 块和 verify 字段 + 依赖图/波次散文/伪并行/写写与读写冲突检测
export async function runPlanExitGate({ node, state }) {
  if (node.id !== 'plan' || !state.activeChange) return;
  const taskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
  // 读文件是唯一需要容错的动作（TASK.md 缺失 → 无内容可判，判据段不适用，保持既有语义）；判据段
  // 独立成层——判据自身抛错不得被空 catch 吞掉：空 catch 会让整段文件依赖门禁（含既有写写强判
  // BLOCK）静默失效，与「未验证 ≠ 通过」相悖。命中即显式报出原因并按 fail-closed 拒绝。
  let content = null;
  try { content = await fs.readFile(taskFile, 'utf8'); } catch { content = null; }
  if (content === null) return;
  try {
    // <task> 块提取与属性解析统一走 task-parsing.mjs（开标签语义，属性序无关）
    const taskList = extractTaskBlocks(content);
    if (taskList.length === 0) {
      console.error('BLOCKED: TASK.md 无 <task> 块');
      process.exit(1);
    }
    const missingVerify = taskList.filter(b => !/<verify>/.test(b));
    if (missingVerify.length > 0) {
      console.error('BLOCKED: TASK.md 中 ' + missingVerify.length + ' 个 task 缺 <verify> 字段');
      process.exit(1);
    }
    // 波次散文一致性检测（WARN 渐进）——## 波次划分 的 Wave 行任务带 [P] 标记（并行语义）但 XML
    // 任务无 parallel="true" → WARN（散文与机器路由依据不一致，以任务标记为准）。容错：无并行语义
    // 的 Wave 行不参与比对；解析不到波次段跳过（不误报）。段尾判定 = 下一个段标题（\n## ）或分隔线
    // （\n---）或**输入末尾**。JS 正则没有 \Z：\Z 是「未知转义 ⇒ 字面字符 Z」，惰性匹配一遇段内
    // 大写 Z 就提前收尾，段被静默截断（含 ZERO- 一类机检标记的 TASK 会整段漏检）。串尾一律用
    // (?![\s\S]) 真断言——它只是「此处之后已无任何字符」，不受行首/行尾标志影响，与「多行模式下的
    // $」语义无歧义。
    const waveSection = content.match(/##\s*波次划分\s*\n([\s\S]*?)(?=\n##\s|\n---|(?![\s\S]))/);
    if (waveSection) {
      const proseParallelIds = [];
      for (const line of waveSection[1].split('\n')) {
        if (!/(Wave|\d+\s*波|parallel|并行)/i.test(line)) continue; // 无并行语义行跳过
        for (const m of line.matchAll(/([A-Z][A-Z0-9-]*)\[P\]/g)) proseParallelIds.push(m[1]);
      }
      if (proseParallelIds.length > 0) {
        const xmlParallelIds = taskList
          .filter(b => { const a = taskOpeningAttrs(b); return a && a.parallel; })
          .map(b => (taskOpeningAttrs(b) || {}).id)
          .filter(Boolean);
        const missing = proseParallelIds.filter(id => !xmlParallelIds.includes(id));
        if (missing.length > 0) {
          if (isNewChange(state)) {
            console.error('BLOCKED: 波次散文标记任务为并行（[P]）但任务无 parallel="true"（新 change 强制散文与任务标记一致）;恢复: 对齐散文或任务标记');
            process.exit(1);
          }
          console.error('WARN: 波次散文标记为并行（[P]）但任务无 parallel="true"——散文与任务标记不一致（以任务标记为准）: ' + missing.join(', '));
        }
      }
    }
    // 波次分组校验重定义（依赖图校验决策 · 混排合法化）：原「并行块必须单个连续且居首/尾」形态约束
    // 废除——串行任务位置不再受限，串→并→串 / 并→串→并 / 多波混合均合法（多趟循环路由按依赖拓扑
    // 分趟）。改为依赖图校验：① 全部任务建依赖图（deps 边）做 Kahn 拓扑排序判环——有环即规划结构性
    // 死锁；② 全部引用的任务 id 必须存在（无环图下「每个 parallel 任务的全部传递依赖存在且非环」
    // ⟺ 直接引用都存在）。违规分级：新 change BLOCKED（含「依赖环」/缺失依赖明细 + depends_on 调整
    // 恢复指引）；旧 change 渐进 WARN 不阻断。波次散文一致性检测保留不动（与形态约束正交的既有独立
    // 检测，维持不变）。
    const depGraph = analyzeDependencyGraph(taskList);
    if (depGraph.cyclic || depGraph.missing.length > 0) {
      const detail = depGraph.cyclic
        ? '依赖环（拓扑排序无解，涉及任务: ' + depGraph.cycleIds.join(', ') + '）'
        : '依赖不存在的任务: ' + depGraph.missing.map((m) => m.id + '→' + m.dep).join(', ');
      const guide = ';恢复: 调整任务 depends_on——移除成环引用或改为真实存在的任务 id 后重试';
      if (isNewChange(state)) {
        console.error('BLOCKED: TASK.md ' + detail + '——依赖图不可满足（任务的依赖链必须存在且无环）' + guide);
        process.exit(1);
      }
      console.error('WARN: TASK.md ' + detail + '——依赖图不可满足（旧 change 渐进不阻断）' + guide);
    }
    // 伪并行检测（真实载体验证暴露的设计盲区兜底）：如果一个标记为并行的任务只写测试文件而无任何
    // 生产代码文件，它很可能隐式依赖某个实现类并行任务的产出（如测试 import 尚未存在的函数）。这种
    // "伪并行"在多趟路由下会导致委托后测试失败。启发式：并行任务的 write_files 全部匹配 tests/ 或
    // test_ 前缀 → 视为疑似伪并行。WARN 渐进不阻断——由执行者判断是否真独立（纯测试基础设施改动可
    // 合法全测试面）。
    const testOnlyParallelIds = [];
    for (const block of taskList) {
      const attrs = taskOpeningAttrs(block);
      if (!attrs || !attrs.parallel || attrs.status !== 'pending') continue;
      const wfMatch = block.match(/<write_files>([\s\S]*?)<\/write_files>/);
      if (!wfMatch) continue;
      // 分号容错：与 workflow-handoff.mjs 自动解析同源实现（分号容错双点内联，与 workflow-handoff.mjs
      // 同源互锚）——换行切分后逐段按 ';' 二次切分、trim、滤空与 HTML 注释行（路径含分号的极端形态
      // 不支持，须换行书写）
      const blockContent = wfMatch[1].replace(/<!--[\s\S]*?-->/g, '');
      const filePaths = blockContent.trim().split(/\s*\n\s*/).map(l => l.trim()).filter(Boolean)
        .flatMap(l => l.split(';')).map(l => l.trim()).filter(Boolean);
      if (filePaths.length === 0) continue;
      const prodFiles = filePaths.filter(f => !/(?:^|[\/\\])(?:__tests__\/|test_|tests?\/)|\.(?:test|spec)\.(?:mjs|js|jsx|ts|tsx|cjs)$/.test(f));
      if (prodFiles.length === 0) {
        testOnlyParallelIds.push(attrs.id || 'unknown');
      }
    }
    if (testOnlyParallelIds.length > 0) {
      console.error('WARN: 伪并行检测——以下并行任务仅写测试文件而无生产代码文件: '
        + testOnlyParallelIds.join(', ')
        + '。测试通常依赖实现产出的符号，可能存在隐式依赖；建议添加 depends_on 声明或合并为垂直切片');
    }
    // 并行文件依赖检测前移（触发面）：write∩write 写写强判（新 change BLOCKED / 旧 change WARN
    // 渐进，与依赖环分级同先例）+ read∩write 读写弱判（仅无显式 depends_on 关联的并行对；WARN
    // 提示级，新/旧均不 BLOCK——渐进提示）+ 同文件跨任务且无依赖路径（未完成任务写入面重叠而两
    // 任务间无依赖路径——新 change BLOCKED / 旧 change WARN 渐进；串行拆分同样命中，修复任务族不
    // 参与）。与委托前既有拦截并存（委托前为第二道写写锚，行为与消息保持既有语义不变）。
    const { writeConflicts, readWarnings, crossTaskConflicts } = await findParallelWriteConflicts(path.join(runRoot, '.specs', state.activeChange));
    if (writeConflicts.length > 0) {
      const detail = writeConflicts.map((c) => `${c.a}×${c.b}(${c.files.join(',')})`).join('; ');
      const guide = ';恢复: 补显式 depends_on 或拆为串行任务后重试';
      if (isNewChange(state)) {
        console.error('BLOCKED: TASK.md 并行任务 write_files 重叠（写写冲突，同波次并行会竞态覆盖）: ' + detail + guide);
        process.exit(1);
      }
      console.error('WARN: TASK.md 并行任务 write_files 重叠（写写冲突，建议补显式 depends_on 或拆为串行任务）: ' + detail + guide);
    }
    if (crossTaskConflicts.length > 0) {
      const detail = crossTaskConflicts.map((c) => `${c.a}×${c.b}(${c.files.join(',')})`).join('; ');
      const guide = ';恢复: 补显式 depends_on 或合并为一个任务后重试';
      if (isNewChange(state)) {
        console.error('BLOCKED: TASK.md 同文件跨任务且无依赖路径: ' + detail + guide);
        process.exit(1);
      }
      console.error('WARN: TASK.md 同文件跨任务且无依赖路径（建议补显式 depends_on 或合并为一个任务）: ' + detail + guide);
    }
    if (readWarnings.length > 0) {
      console.error('WARN: TASK.md 并行任务 read∩write 隐式依赖嫌疑（一方读取对方写路径，建议补显式 depends_on 声明）: '
        + readWarnings.map((c) => `${c.a}×${c.b}(${c.files.join(',')})`).join('; '));
    }
  } catch (judgeError) {
    console.error('BLOCKED: TASK.md 文件依赖判据未执行: '
      + (judgeError && judgeError.message ? judgeError.message : String(judgeError))
      + '——门禁无法完成校验，按 fail-closed 拒绝通过（未验证 ≠ 通过）');
    process.exit(1);
  }
}

// review exit 校验 REVIEW 含实质内容 + 发现区条目处置状态结构级校验
export async function runReviewExitGate({ node, state }) {
  if (node.id !== 'review' || !state.activeChange) return;
  const reviewFile = path.join(runRoot, '.specs', state.activeChange, 'REVIEW.md');
  try {
    const stat = await fs.stat(reviewFile);
    if (stat.size < 100) {
      console.error('BLOCKED: REVIEW.md 内容不足（' + stat.size + ' 字节，需 ≥ 100）');
      process.exit(1);
    }
    // 发现项（含 Minor）须有处置状态标记——[已修]（对应 fix 任务）/ [升级]（用户决策：接受+理由）/
    // [转待办]（归档时进 KNOWN-ISSUES）。结构级校验，WARN 渐进不 BLOCK：旧 REVIEW 未按新格式写标记
    // 只警告不阻断（防旧 REVIEW 卡死），执行者补标记后可消除。
    const reviewText = await fs.readFile(reviewFile, 'utf8');
    // 发现位置（模板 2.2）：发现写在旧 `## 发现` 而模板位置 `### 2.2 …详细发现` 下无条目——旧段不被
    // 任何出口消费，等于「记录后静默丢弃」。新 change BLOCKED + 逐条迁移指引；旧 change WARN 渐进。
    // 模板缺席（primary=null）时不判位置：模板派生判据不臆造（C9），旧形态解析与处置校验照常。
    const scope = await reviewFindingScope();
    const findings = reviewFindingsItems(reviewText, scope);
    const misplacedFindings = scope.primary !== null
      && !findings.some((item) => item.scope === 'primary')
      && reviewLegacyFindingsHasContent(reviewText);
    if (misplacedFindings) {
      const templateFile = (await buildSkeleton('REVIEW')).file ?? 'flow-kit/templates/REVIEW.md';
      if (isNewChange(state)) {
        console.error('BLOCKED: REVIEW.md 的发现写在模板外的段「## 发现」，而模板位置（第二轮下的 2.2 详细发现）无条目——新 change 强制写在模板位置');
        console.error('恢复: 把「## 发现」下的条目逐条移入「### 2.2 …详细发现」段内（模板: ' + templateFile
          + '），删除旧段后重试 exit review');
        process.exit(1);
      }
      console.error('REVIEW WARN: REVIEW.md 的发现写在模板外的段「## 发现」，模板位置 2.2 详细发现 无条目'
        + '——迁移到 2.2 后本警告消除（旧 change 渐进不阻断；模板: ' + templateFile + '）');
    }
    const missingDisposition = reviewFindingsMissingDisposition(reviewText, scope);
    if (missingDisposition.length > 0) {
      if (isNewChange(state)) {
        console.error('BLOCKED: REVIEW.md 发现区 ' + missingDisposition.length + ' 项条目缺处置状态标记（[已修]/[升级]/[转待办]）——新 change 强制每项发现须有处置');
        console.error('恢复: 为发现区条目补处置标记后重试;未处置的发现(含 Minor)不应无声消失');
        process.exit(1);
      }
      console.error('REVIEW WARN: REVIEW.md 发现区 ' + missingDisposition.length +
        ' 项条目缺处置状态标记（[已修]/[升级]/[转待办]）: ' + missingDisposition.join('、') +
        '——未处置的发现（含 Minor）不应无声消失，补标记后本警告消除（渐进不阻断）');
    }
    // Major 延期裁决门禁：Major 的处置是用户决策点——reviewer 不得自行 [转待办]。结构校验：Major
    // 条目标 [转待办] 时须同时存在用户裁决记录（同段或文末含「用户裁决：接受延期」且指向该条目，
    // 并由 [升级] 承接）；缺失 → 新 change BLOCKED / 旧 change WARN 渐进。Minor 不受影响；
    // Major [升级]/[已修] 直接放行。
    const deferredMajor = reviewDeferredMajorProblems(reviewText, scope);
    if (deferredMajor.length > 0) {
      const guide = '；恢复: 先把 Major 改为 [升级] 交用户裁决；用户接受延期后在同段或文末记录「用户裁决：接受延期」并指向该条目（由 [升级] 承接）';
      if (isNewChange(state)) {
        console.error('BLOCKED: REVIEW.md 发现区 ' + deferredMajor.length + ' 项 Major 条目为 [转待办] 但缺少用户裁决记录（Major 不得由 reviewer 自行转待办）: ' + deferredMajor.join('、') + guide);
        process.exit(1);
      }
      console.error('REVIEW WARN: REVIEW.md 发现区 ' + deferredMajor.length +
        ' 项 Major 条目为 [转待办] 但缺少用户裁决记录: ' + deferredMajor.join('、') +
        '——Major 不得由 reviewer 自行转待办' + guide + '（渐进不阻断）');
    }
  } catch {}
}

// 节点 exit 协议声明标记校验——扫描 .specs/<change-id>/.skill-loads/ 下该节点标记（<node>-*.json，
// 执行者加载节点 skill 后经 skill-load 写入，含 protocol 字段——指向 flow-kit/prompts/ 协议文件，
// 只读引用），校验至少一个标记的 protocol ∈ 该节点协议集（节点协议映射表）。缺失 → BLOCKED（提示
// 缺协议声明标记 + 指引 skill-load --prompt）；有 → 通过。诚实边界：标记是执行者的自我声明——校验
// 只确认「声明存在且 protocol 归属节点」，无法证明执行者真的阅读了协议（声明非物理证明，仅保证
// 协议阅读声明可追溯）。旧 change 兼容：旧 change/旧 evidence 不追溯——.skill-loads/ 目录不存在
// （该 change 从未运行过 skill-load，声明机制未激活）→ 跳过校验；节点已 exit 不重验（校验只在当前
// exit 时执行）；节点重新 exit（重入后再退）时按新规则要求，无豁免。
export async function runSkillLoadMarkerGate({ node, state }) {
  if (!state.activeChange || !NODE_PROTOCOL_FILES[node.id]) return;
  // 标记目录活动/归档双路径解析（archive 节点「先移目录后 exit」顺序下标记只在归档路径——单查
  // 活动路径会误报「机制未激活」静默放行）；两处皆无才走旧 change 兼容
  const loadsDir = await findSkillLoadsDir(runRoot, state.activeChange);
  if (!loadsDir) {
    // 旧 change 兼容过渡规则：活动与归档路径均无声明标记目录（机制未激活）不追溯；首个 skill-load
    // 写入后新规则生效（该 change 后续节点 exit 均需声明标记）
    console.error('SKILL-LOAD WARN: 旧 change 兼容——.specs/' + state.activeChange +
      '/.skill-loads/（活动与归档路径）不存在，协议声明校验跳过（机制未激活；首个 skill-load 后新规则生效）');
    return;
  }
  const prefix = node.id + '-';
  const protocolSet = NODE_PROTOCOL_FILES[node.id];
  const markers = (await fs.readdir(loadsDir.dir).catch(() => []))
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  const malformed = [];
  let declared = false;
  for (const f of markers) {
    try {
      const marker = JSON.parse(await fs.readFile(path.join(loadsDir.dir, f), 'utf8'));
      // 比对 basename——新格式（skill-load 写入 basename）与旧格式（完整绝对路径）经
      // markerProtocolBasename 提取后统一比对；损坏值（null/非字符串/超集外 basename）提取为 null
      // 或不匹配 → 不进 declared，fail-closed
      if (marker && typeof marker === 'object' && protocolSet.includes(markerProtocolBasename(marker.protocol))) {
        declared = true;
        // auto 标记提示——record 自动补的标记（auto:true）不证明手动加载，提示建议手动声明
        if (marker.auto === true) {
          console.error('SKILL-LOAD HINT: ' + f + ' 为 record 自动补写标记(auto)——建议手动 skill-load 声明(如实记录加载动作与协议文件)');
        }
        break;
      }
    } catch {
      malformed.push(f);
    }
  }
  if (!declared) {
    console.error('BLOCKED: 节点 ' + node.id + ' exit 缺协议声明标记——' + loadsDir.display +
      ' 下需有 ' + prefix + '*.json 且 protocol ∈ [' + protocolSet.join(', ') +
      ']；执行 skill-load --prompt <flow-kit/prompts/ 协议文件> 声明已阅读协议（声明非物理证明，仅可追溯）' +
      (malformed.length > 0 ? '；不可解析标记: ' + malformed.join(', ') : ''));
    process.exit(1);
  }
}

// 受保护状态落盘（沿用 state-io 的受保护写入通道）
