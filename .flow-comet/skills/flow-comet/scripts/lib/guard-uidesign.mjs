// ui-design 适用性门控（前端判据 · 结构级，不做语义）。
//
// 协议 design 节点的 ui-design 绑定为 guarded，但它「仅前端」适用 ⇒ 出口自动补 required-skill
// 声明对该绑定失效（须真实 skill-load 声明），判据不成立（非前端）时按 advisory 处理并在出口输出
// 可见跳过行（不留假绿：跳过是显式记录，非静默省略）。
//
// 键控（enforcement 是这道门的单一表达处）：门只在「协议登记了该绑定 ∧ enforcement === 'guarded'」
// 时存在——协议副本删掉绑定或把等级调回 advisory ⇒ 门不适用（留可见「门未启用」行，不静默消失），
// 相应路径逐字回到未登记绑定的原语义。门禁侧不持有第二份键表：登记表 APPLICABILITY_GATED_BINDINGS
// 按 `<nodeId>.<skill>` 键控，工件门与出口自动补写共用 applicabilityGatedBinding 查询。
//
// 判据必须结构性可判：CHANGE.md 的「视觉调性」段在场且段内不含**结构形态**的「不适用」标记 ⇒
// 前端；段内以结构形态标注 ⇒ 非前端。段**缺席**只在旧 change 上沿用「判非前端」的兼容口径——
// 新 change 由 open 出口按模板条件段拦（标题必须在场），此处缺席即拦，不再默认判非前端
// （否则「漏写段」会被静默翻译成一个更弱的门）。
//
// UI-DESIGN.md 在场时，其模板结构（frontmatter 8 键 / H2 骨架 / 结构型 H3）由产出物模板结构门禁
// 统一校验（与七类产出物同一实现，不在这里另写一份段名校验）。

import { promises as fs } from 'fs';
import path from 'path';
import { runRoot, fileExists } from './guard-state-io.mjs';
import { isNewChange, templateSectionPatterns, TEMPLATE_FALLBACK_SECTION_PATTERNS } from './guard-routing.mjs';
import { assessArtifact, evaluateArtifact, reportArtifactStructure } from './guard-template-fidelity.mjs';

export const UI_DESIGN_SKILL = 'flow-comet-ui-design';
const APPLICABILITY_GATED_BINDINGS = new Set(['design.' + UI_DESIGN_SKILL]);
const VISUAL_TONE_NOT_APPLICABLE = '不适用';

// 负向标记的结构约束（三种形态，共用同一词形边界）——裸子串会让「不适用于暗色主题」这类自然句子
// 关掉整道门（fail-open），故标记必须落在结构锚位且成词形边界：
//   形态 A 独立行：整行（去块引用 / 列表符 / 加粗）就是标记，可带括注理由与尾标点；
//   形态 B 行首：行以标记开头（如「不适用 —— CLI 工具，无用户可见界面。」）；
//   形态 C 字段值位：`<适用性标签>: 不适用`——标签限本约定的短标签表（适用性 / 前端 / 视觉调性 …），
//     不通配任意字段名：`- 暗色主题：不适用` 这类「某子维度不适用」的字段不得关掉整道门。
// 词形边界 = 标记后为行尾 / 空白 / 标点 / 括注引号——「不适用于…」的「于」不是边界。
const TONE_MARKER_TAIL = String.raw`(?=$|[\s，。；、,;.:：!！?？…—()（）【】「」『』“”"'])`;
const TONE_MARKER_LEAD = String.raw`^[>\s]*(?:[-*+]\s+)?(?:\*\*)?`;
const TONE_MARKER_FIELD_LABELS = '适用性|适用范围|是否前端|视觉调性|前端|界面|适用';
const TONE_MARKER_ALONE_LINE = new RegExp(TONE_MARKER_LEAD + VISUAL_TONE_NOT_APPLICABLE
  + String.raw`(?:\*\*)?(?:\s*[（(][^）)]*[）)])?[。.；;，,]?\s*$`);
const TONE_MARKER_LINE_HEAD = new RegExp(TONE_MARKER_LEAD + VISUAL_TONE_NOT_APPLICABLE
  + String.raw`(?:\*\*)?` + TONE_MARKER_TAIL);
const TONE_MARKER_FIELD_VALUE = new RegExp(String.raw`(?:^|[\s|])(?:\*\*)?(?:`
  + TONE_MARKER_FIELD_LABELS + String.raw`)(?:\*\*)?\s*[:：]\s*(?:\*\*)?`
  + VISUAL_TONE_NOT_APPLICABLE + String.raw`(?:\*\*)?` + TONE_MARKER_TAIL);

// 「视觉调性」段读取四态（区分「CHANGE.md 不存在」「模板整份缺失」「段缺席」「段在场」——四者判据
// 不同：文件不存在时本门没有输入，交给其余门禁处理；模板整份缺失时段名无从派生（no-basis，按
// 「未校验」显式跳过）；段缺席才按 newChange 分级，C10）。
async function visualToneSectionState(changeName) {
  if (!changeName) return { state: 'file-missing', body: null };
  let text;
  try {
    text = await fs.readFile(path.join(runRoot, '.specs', changeName, 'CHANGE.md'), 'utf8');
  } catch {
    return { state: 'file-missing', body: null };
  }
  const headingPattern = (await templateSectionPatterns())
    .pick('change', ['视觉调性'], TEMPLATE_FALLBACK_SECTION_PATTERNS.changeVisualTone);
  // 整份模板缺席时 pick 返回可判别的跳过判据（TEMPLATE_SECTION_SKIP：skip 标记 + `.test` 恒真）。
  // 不能拿它扫描：`.test` 恒真会让 CHANGE.md 的**首个小节**被当成「视觉调性」段（错的输入 = 错的
  // 判据）。此时段名无从派生，显式报 no-basis 由调用方按「未校验（模板缺失）」处理；模板在场时
  // pick 返回正则或 fallback，行为不变。
  if (headingPattern !== null && typeof headingPattern === 'object' && headingPattern.skip === true) {
    return { state: 'no-basis', body: null };
  }
  let body = null;
  for (const line of String(text).replace(/\uFEFF/g, '').split(/\r?\n/)) {
    if (/^##\s+/.test(line)) {
      if (body !== null) break; // 到达下一个 H2 → 本段结束
      if (headingPattern.test(line)) body = '';
      continue;
    }
    if (body !== null) body += line + '\n';
  }
  return body === null ? { state: 'section-missing', body: null } : { state: 'present', body };
}

// 段内负向标记命中（逐行判定——判据限段内）：命中 → 返回命中行片段（去空白 + 超长截断），未命中
// → null。片段回显进出口的跳过行，跳过因此自证（不是「段内某处出现过什么字面」）。
function visualToneNotApplicableHit(body) {
  for (const rawLine of String(body).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (TONE_MARKER_ALONE_LINE.test(line)
      || TONE_MARKER_LINE_HEAD.test(line)
      || TONE_MARKER_FIELD_VALUE.test(line)) {
      return line.length > 60 ? line.slice(0, 60) + '…' : line;
    }
  }
  return null;
}

// 登记表查询（唯一键表，键形 `<nodeId>.<skill>`）：该节点 + 技能是否受适用性门控
function isRegisteredApplicabilityBinding(node, skill) {
  return APPLICABILITY_GATED_BINDINGS.has(node.id + '.' + skill);
}

// 适用性门控绑定的单一查询：在场 ∧ enforcement === 'guarded' ∧ 登记在表 → 协议绑定；否则 null。
// 工件门、出口自动补写与缺声明恢复指引共用本查询——enforcement 是该门的单一表达处。
export function applicabilityGatedBinding(node, skill) {
  if (!isRegisteredApplicabilityBinding(node, skill)) return null;
  return (node.requiredSkillCalls ?? []).find((call) => call.skill === skill && call.enforcement === 'guarded') ?? null;
}

// 前端判据：{ applicable, reason, toneState }——applicable=true 表示本 change 判为前端项目。
// toneState 让调用方区分「段缺席」「模板整份缺失（no-basis，判据无依据）」与「段内标注不适用」：
// 段缺席在新 change 上必须拦（不能静默降级成非前端），最后一种是执行者显式声明，直接放行；
// no-basis 按「未校验」显式跳过，由调用方决定如何发声。
export async function frontendCriterion(changeName) {
  const tone = await visualToneSectionState(changeName);
  if (tone.state === 'file-missing') {
    return { applicable: false, reason: 'CHANGE.md 不存在（本门无输入）', toneState: tone.state };
  }
  if (tone.state === 'no-basis') {
    // 模板整份缺失 ⇒ 段名无从派生，本判据没有输入依据。不猜（不用首个小节冒充「视觉调性」段），
    // 也不判前端：交给调用方按「未校验（模板缺失）」显式跳过（未验证 ≠ 通过，C9）。
    return {
      applicable: false,
      reason: '「视觉调性」段判据无可依据（模板整份缺失，段名无从派生）',
      toneState: tone.state,
    };
  }
  if (tone.state === 'section-missing') {
    return { applicable: false, reason: '「视觉调性」段缺席', toneState: tone.state };
  }
  const hit = visualToneNotApplicableHit(tone.body);
  if (hit !== null) {
    return {
      applicable: false,
      reason: '「视觉调性」段标注「不适用」（判非前端；命中片段: ' + hit + '）',
      toneState: tone.state,
    };
  }
  return { applicable: true, reason: '「视觉调性」段在场且未标注「不适用」（判前端；无结构形态标记）', toneState: tone.state };
}

// design 出口 ui-design 工件门（按协议绑定键控：登记 ∧ 等级 = guarded ∧ 判据成立）——判据成立 ⇒
// 要求 UI-DESIGN.md 在场：新 change 缺件 BLOCKED + 恢复指引，旧 change WARN 渐进不阻断（不静默
// 放行）；判据不成立（非前端）⇒ 可见跳过行（含命中片段）后照常放行；协议删掉该绑定或等级非
// guarded ⇒ 门未启用（同样可见输出），行为回到未登记绑定的原语义——闸门开关由协议表达。
export async function checkUiDesignArtifact(node, state) {
  if (!state.activeChange || !isRegisteredApplicabilityBinding(node, UI_DESIGN_SKILL)) return;
  if (!applicabilityGatedBinding(node, UI_DESIGN_SKILL)) {
    const protocolState = (node.requiredSkillCalls ?? []).some((call) => call.skill === UI_DESIGN_SKILL)
      ? '协议 ' + node.id + ' 绑定等级 = advisory，非 guarded'
      : '协议 ' + node.id + ' 节点未登记 ' + UI_DESIGN_SKILL + ' 绑定';
    console.error('UI-DESIGN: 门未启用（' + protocolState + '）');
    return;
  }
  const frontend = await frontendCriterion(state.activeChange);
  if (frontend.toneState === 'no-basis') {
    // 模板整份缺失：适用性门控的输入判据不存在，按「未校验」显式跳过（不静默通过，也不误报非前端）。
    console.error('UI-DESIGN 未校验（模板缺失）——flow-kit/templates/CHANGE.md 不在项目根，'
      + '「视觉调性」段名无从派生，适用性门控跳过');
    return;
  }
  if (frontend.toneState === 'section-missing') {
    // 段缺席不再默认判非前端：新 change 由 open 出口的条件段门禁拦，此处兜底同口径拦下，
    // 要求执行者显式写「不适用」（缺席与声明不适用是两件事，只有后者是决策）。
    const toneRecovery = '在 .specs/' + state.activeChange + '/CHANGE.md 的「视觉调性」段填写选定调性，'
      + '或以结构形态标注「不适用」（非前端项目），然后重试 exit design';
    if (isNewChange(state)) {
      console.error('BLOCKED: CHANGE.md 的「视觉调性」段缺席——新 change 须显式标注「不适用」或填写调性（段缺席不再默认判非前端）');
      console.error('恢复: ' + toneRecovery);
      process.exit(1);
    }
    console.error('UI-DESIGN: skipped（旧 change 兼容）——「视觉调性」段缺席，沿用旧口径判非前端');
    return;
  }
  if (!frontend.applicable) {
    console.error('UI-DESIGN: skipped（非前端）——' + frontend.reason + '，不要求 UI-DESIGN.md');
    return;
  }
  const artifact = path.join(runRoot, '.specs', state.activeChange, 'UI-DESIGN.md');
  if (await fileExists(artifact)) {
    // 工件在场 → 按模板结构校验（frontmatter 8 键 / H2 骨架 / 结构型 H3）；模板缺席只输出未校验行。
    let text;
    try {
      text = await fs.readFile(artifact, 'utf8');
    } catch {
      return;
    }
    // 标题形态与 frontmatter 键都属于「模板结构」面：模板缺席时整体判「未校验（模板缺失）」，
    // 不拿登记表形态去替模板做缺席判定（C9/AC-21 的统一口径）。
    const { skeleton, derived, issues } = await evaluateArtifact('UI-DESIGN', text, { underivedPolicy: 'skip' });
    await reportArtifactStructure({
      changeDir: path.join(runRoot, '.specs', state.activeChange),
      state,
      assessments: [assessArtifact({ fileLabel: 'UI-DESIGN.md', skeleton, derived, issues })],
    });
    return;
  }
  const recovery = '补 .specs/' + state.activeChange + '/UI-DESIGN.md（加载 ' + UI_DESIGN_SKILL + ' 并按其协议产出 design token / 反 AI-slop 自检），'
    + '或在 .specs/' + state.activeChange + '/CHANGE.md 的「视觉调性」段以结构形态标注「不适用」（非前端项目）后重试 exit design';
  if (isNewChange(state)) {
    console.error('BLOCKED: design 出口缺 UI-DESIGN.md——' + frontend.reason + '，前端项目须产出 UI-DESIGN.md');
    console.error('恢复: ' + recovery);
    process.exit(1);
  }
  console.error('UI-DESIGN WARN: 缺 .specs/' + state.activeChange + '/UI-DESIGN.md——' + frontend.reason + '（旧 change 渐进不阻断；新 change 将强制）');
  console.error('恢复: ' + recovery);
}
