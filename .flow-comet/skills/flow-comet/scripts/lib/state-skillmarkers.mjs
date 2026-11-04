// skill-load 声明标记族（单一归属）：--prompt 参数提取与归属校验、协议 scope 绑定查询、
// 标记目录解析（路径规则取自 state-io）、节点声明存在性，以及 completedChecks 的真实性校验。
// 诚实边界：标记是「声明」而非物理证明——运行时没有 Skill 调用观察点，脚本无法确认执行者
// 真实加载过该 skill；标记仅证明「执行者主动声明已加载」，由流程纪律兜底。handoff 条目的证据
// 同样不是物理证明——它是子代理回传的 Return Contract 委托声明（子代理自称已加载并执行），
// 由 handoff result 的 commitHash/greenEvidence 审计性兜底。
import { promises as fs } from 'fs';
import path from 'path';
import {
  describeTemplateList,
  nodeTemplateDeclaration,
  normalizeTemplateName,
  templateDeclarationProblems,
  templateKeyOf,
} from '../protocol-utils.mjs';
// 声明命令的唯一装配（脚本路径 + 全部 --prompt + 模板全清单 + 协议上下文）落在中立的命令文本模块：
// 守卫族取同一份（它有自己的运行上下文），本族按状态命令族的运行上下文取用——两族各拼一份时
// 只有一种文本能执行。
import { declarationCommand } from './state-explain.mjs';
// 声明标记目录的路径规则（活动路径优先、归档路径兜底）由本族的路径上下文模块持有：同一条规则被
// 状态命令族与守卫族消费，本模块只把状态命令族的运行上下文作为根注入（守卫侧按自己的运行根取用
// 同一份实现）——两族各写一份扫描，会在「活动目录在不在场」「多归档目录取哪个」上给出不同答案。
import {
  fileExists,
  findSkillLoadsDir as findSkillLoadsDirAtRoot,
  readJson,
  runRootDir,
  specsDir,
} from './state-io.mjs';

// --prompt 原始参数收集（skill-load 专用参数）：--protocol 由 resolveProtocol 全局解析
// （CLI > env > 默认）为工作流协议 JSON——skill-load 曾用 --protocol 传 prompt 路径，主仓真实链路
// 必现撞车（markdown 被当协议 JSON 解析 → 启动报错「workflow protocol file is not valid JSON」）。
// 改名 --prompt 后与全局协议解析彻底解耦；此处取用户显式传入的**全部**原始值，供 skill-load
// 的 flow-kit/prompts/ 归属校验与标记记录。
//
// 支持 `--prompt a --prompt b` 与 `--prompt=a`，可重复出现（累加保序、去重）。一个节点该读的
// 协议常常不止一份（open 两份、review 两份），而「读了几份协议」正是出口覆盖判据要核对的事实——
// 只取第一个会让第二个声明被静默丢弃，声明面永远凑不齐（覆盖判据据此报「未声明」，而执行者
// 明明写下了那条命令）。后随参数是另一个选项（以 -- 开头）时不当成路径；空值忽略。
export function findPromptArgs(cliArgs) {
  const values = [];
  const collect = (raw) => {
    if (typeof raw !== 'string' || raw === '') return;
    if (!values.includes(raw)) values.push(raw);
  };
  for (let index = 0; index < (cliArgs ?? []).length; index++) {
    const arg = cliArgs[index];
    if (arg === '--prompt') {
      const next = cliArgs[index + 1];
      const hasValue = typeof next === 'string' && !next.startsWith('--');
      collect(hasValue ? next : '');
      if (hasValue) index += 1;
      continue;
    }
    if (typeof arg === 'string' && arg.startsWith('--prompt=')) {
      collect(arg.slice('--prompt='.length));
    }
  }
  return values;
}

// 声明标记里「已声明的协议文件」提取（唯一实现：出口覆盖判据与任何读标记的消费方共用）：
//   · protocols 数组（skill-load 多条 --prompt 的写入形态）∪ protocol 单值（收紧前的写入形态，
//     以及 record 自动补写的标记）；
//   · 每个值都按 basename 归一——旧标记可能是完整绝对路径（历史缺陷期写入的形态），新标记是
//     basename；两种形态必须比对同一口径（节点协议映射表只存 basename）。
// 返回去重保序的 basename 数组；null / 空串 / 非字符串一律忽略（fail-closed：覆盖判据只认
// 真正声明了的值，损坏值不会冒充任何一份协议文件）。
export function markerProtocolBasenames(marker) {
  const raw = [];
  if (Array.isArray(marker?.protocols)) raw.push(...marker.protocols);
  raw.push(marker?.protocol);
  const basenames = [];
  for (const value of raw) {
    if (typeof value !== 'string' || value === '') continue;
    const base = String(value).replaceAll('\\', '/').split('/').pop();
    if (!base) continue;
    if (!basenames.includes(base)) basenames.push(base);
  }
  return basenames;
}

// flow-kit/prompts/ 归属校验（相对或绝对路径，前缀校验）——flow-kit 为 vendored 上游，
// 协议提示只读引用；skill-load 声明的 --prompt 必须位于其 prompts 目录下。
// 相对路径：字符串前缀必须为 flow-kit/prompts/；绝对路径：路径段中必须含 flow-kit/prompts。
export function protocolUnderFlowKitPrompts(value) {
  const normalized = String(value).replaceAll('\\', '/');
  if (!path.isAbsolute(value)) {
    return normalized.startsWith('flow-kit/prompts/');
  }
  const segments = normalized.split('/').filter((s) => s !== '');
  for (let index = 0; index <= segments.length - 2; index++) {
    if (segments[index] === 'flow-kit' && segments[index + 1] === 'prompts') return true;
  }
  return false;
}

// requiredSkillCalls scope 分类——按协议 requiredSkillCalls 查 <node>.<skill> 绑定：
// main scope = 协调者加载（如 flow-comet-subagent-execute），要求协调者 skill-load 标记；
// handoff scope = 子代理加载（如 subagent-execute 节点的 flow-comet-dev），协调者不加载它。
// 协议外条目（无绑定 / 非 main / 非 handoff scope）→ null（fail-closed：仍按 main 处理要标记）。
export function findRequiredSkillBinding(protocol, nodeId, skillName) {
  const node = (protocol.nodes ?? []).find((n) => n.id === nodeId);
  if (!node) return null;
  return (node.requiredSkillCalls ?? []).find((binding) => binding.skill === skillName) ?? null;
}

// 标记目录解析（活动路径 .specs/<change-id>/.skill-loads/ 优先，归档路径兜底——archive 节点
// 「先移目录后 record/exit」顺序下 change 目录已在 .specs/archive/<日期>-<change-id>/，标记只随
// 目录移动）：路径规则与守卫族同一份实现，实现在本族的路径上下文模块（state-io），本处只注入状态
// 命令族的运行根。规则落状态族而不是守卫族是依赖方向决定的：状态命令族不得 import 守卫族（否则
// 一条路径规则就让状态 CLI 加载整个守卫图），守卫侧按允许的 guard → state-* 方向取用同一份实现。
// 两族各持一份扫描时，同一个标记会因「活动目录在场是否回溯归档」「多归档目录取哪个」各自得出答案。
// 两者皆无 → null。
export function findSkillLoadsDir(changeName) {
  return findSkillLoadsDirAtRoot(runRootDir(), changeName);
}

// 节点技能加载声明标记存在性（技能加载前置门·方案 A）：校验 .skill-loads/ 下
// 是否有该节点的声明标记 <node>-*.json（任一 skill 标记即算已声明——与 guard exit 侧的
// 「exit 协议声明标记校验」同构：按 <node>- 前缀扫描；活动路径优先，归档路径兜底）。
// 记录/委托前置门在「先加载技能（Skill 工具）并 skill-load 声明」之前拦截"先干活后补声明"。
export async function hasNodeSkillDeclaration(nodeId, changeName) {
  if (!nodeId || !changeName) return false;
  const activeDir = path.join(specsDir(), changeName, '.skill-loads');
  const prefix = nodeId + '-';
  const scan = async (dir) => {
    try {
      const entries = await fs.readdir(dir);
      return entries.some((f) => f.startsWith(prefix) && f.endsWith('.json'));
    } catch {
      return false;
    }
  };
  if (await scan(activeDir)) return true;
  const archived = await findSkillLoadsDir(changeName);
  if (archived !== null && archived.dir !== activeDir) return scan(archived.dir);
  return false;
}

// 模板声明核对（C11）：节点的产出物模板声明落在 .skill-loads/<node>-*.json 的 templates 数组里，
// 集合必须与 C3 映射一致（required ⊆ declared ⊆ required ∪ optional）。同一节点可有多个 skill 标记
// （open 有 change / requirement），取并集——节点级一份声明被任一标记满足即可（skill-load 每次
// 都写全清单）。新 change 缺失 / 多写 / 漏写 / 错名 → BLOCK；旧 change → WARN（渐进兼容，C10）。
// 不比对的三种情形：非内置节点（C12：自定义协议按自己的声明走）、无活动 change、声明机制未激活
//（无 .skill-loads/ 或本节点无标记）——后者由「缺少技能加载声明标记」门负责，不重复报
//（与 exit 侧协议声明校验的「未激活不追溯」同一口径）。
// 零模板的内置节点（verify / archive）省略 --templates 即视为空集，通过。
export async function verifyTemplateDeclaration({ protocol, nodeId, changeName, newChange, commandContext: context }) {
  const declarationNode = (protocol?.nodes ?? []).find((node) => node.id === nodeId);
  const declaration = nodeTemplateDeclaration(declarationNode);
  if (declaration.source !== 'builtin' || !changeName) return { ok: true };
  const loadsDir = await findSkillLoadsDir(changeName);
  if (loadsDir === null) return { ok: true };
  const prefix = nodeId + '-';
  const markers = (await fs.readdir(loadsDir.dir).catch(() => []))
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'));
  if (markers.length === 0) return { ok: true };
  const declared = [];
  // 执行者写过声明的技能（按技能去重保序——一个 node-skill 只有一个标记文件）：重新声明命令按
  // **同一批技能**派发——拿节点级目标集重发会顺手覆写别人没提的那几条，只给一个占位符又等于没给命令。
  const declaredSkills = [];
  let explicitMarkers = 0;
  for (const markerName of markers) {
    let marker;
    try {
      marker = await readJson(path.join(loadsDir.dir, markerName));
    } catch {
      continue; // 损坏标记由既有声明校验报（本判据不抢报）
    }
    // record 自动补写的标记（auto）是引擎写的，不是执行者的声明——它不承担模板声明义务
    // （exit 侧已有「建议手动 skill-load」提示），不拿它算缺失
    if (marker?.auto === true) continue;
    explicitMarkers += 1;
    // 技能名取**标记文件名**（<node>-<skill>.json 是这份标记的身份，扫描与覆盖判据也按它认）：
    // marker.skill 可能被手改成别的值，文件名才是这条命令要覆写的那一份。
    const markerSkill = markerName.slice(prefix.length, markerName.length - '.json'.length);
    if (markerSkill !== '' && !declaredSkills.includes(markerSkill)) declaredSkills.push(markerSkill);
    if (!Array.isArray(marker?.templates)) continue; // 旧标记无该字段 = 未声明
    for (const name of marker.templates) {
      if (typeof name !== 'string' || name.trim() === '') continue;
      if (!declared.some((existing) => templateKeyOf(existing) === templateKeyOf(name))) {
        declared.push(normalizeTemplateName(name));
      }
    }
  }
  // 只有自动标记（无执行者声明）→ 不在这里要求模板集（旧 change 的声明机制本就未激活）
  if (explicitMarkers === 0) return { ok: true };
  const problems = templateDeclarationProblems(declaration, declared);
  if (problems.missing.length === 0 && problems.extra.length === 0) return { ok: true };
  const detail = [];
  if (problems.missing.length > 0) detail.push('漏写: ' + problems.missing.join('、'));
  if (problems.extra.length > 0) detail.push('多写/错名: ' + problems.extra.join('、'));
  // 重新声明命令与恢复段同一装配（脚本路径 + 该节点全部协议文件 + 模板全清单 + 协议上下文）：
  // 只补 --templates 的旧形态会把 protocol 写成 null，下一次 exit 反被判「缺协议声明标记」；
  // 裸脚本名的旧形态照抄是 command not found（恢复步骤自己走不通）。
  const declareCommands = declaredSkills
    .map((skill) => declarationCommand({ node: declarationNode, skill, context }));
  const reason = '节点 ' + nodeId + ' 的模板声明与节点映射不一致（' + detail.join('；')
    + '；映射要求: ' + describeTemplateList(declaration.required) + '）——重跑下面的命令重新声明'
    + '（同一 node-skill 重跑会覆写该标记）:\n'
    + declareCommands.map((command) => '  ' + command).join('\n');
  if (newChange === true) return { ok: false, reason };
  return { ok: true, warn: reason };
}

// completedChecks 真实性校验。解析 completedChecks 的 required-skill:<node>.<skill>
// 条目 → 对应声明标记 .specs/<change-id>/.skill-loads/<node>-<skill>.json 必须存在（缺失 →
// BLOCKED + 指引先加载 skill 并运行 skill-load）；标记 at 必须 ≤ 本次记录时间（交叉自洽：
// 标记先于记录声明；ISO-8601 UTC 字符串字典序 = 时间序）。仅校验本次 record 写入的
// completedChecks（旧 change 兼容：旧 evidence 不追溯——由调用方只传本次 parsed.completedChecks）。
// 条目按协议 requiredSkillCalls scope 分类——handoff scope 条目（子代理加载的 skill，
// 如 subagent-execute 节点的 flow-comet-dev）豁免标记，以共用证据库 evidence['subagent-execute']
// 的 handoffResult（有委托记录即满足）为证据；main scope / 协议外条目仍要求标记（fail-closed）。
// 返回 { ok: true } 或 { ok: false, reason }（fail-closed：无 active change / 标记损坏同样 BLOCK）。
export async function verifySkillLoadMarkers(completedChecks, changeName, recordTime, protocol, state, context) {
  if (!Array.isArray(completedChecks)) return { ok: true };
  const required = [];
  for (const check of completedChecks) {
    if (typeof check !== 'string' || !check.startsWith('required-skill:')) continue;
    const spec = check.slice('required-skill:'.length);
    const dot = spec.lastIndexOf('.');
    if (dot <= 0 || dot === spec.length - 1) {
      return { ok: false, reason: 'completedChecks 条目格式非法（应为 required-skill:<node>.<skill>）: ' + check };
    }
    required.push({ raw: check, node: spec.slice(0, dot), skill: spec.slice(dot + 1) });
  }
  if (required.length === 0) return { ok: true };
  if (!changeName) {
    return { ok: false, reason: 'completedChecks 含 required-skill 条目但无 active change——无法定位声明标记（先运行 init <change-id>）' };
  }
  for (const item of required) {
    // handoff scope 条目豁免标记——子代理加载的 skill（协调者不加载它，无法诚实
    // 声明加载），以共用证据库 handoffResult 的委托记录为证据；无委托记录 → BLOCK（不静默
    // 放行，指引先委托并回传 handoff result）
    const binding = findRequiredSkillBinding(protocol, item.node, item.skill);
    if (binding && binding.scope === 'handoff') {
      const handoff = state?.evidence?.['subagent-execute']?.handoffResult;
      const hasDelegation = !!(
        handoff &&
        typeof handoff === 'object' &&
        !Array.isArray(handoff) &&
        Object.keys(handoff).length > 0
      );
      if (!hasDelegation) {
        return {
          ok: false,
          reason: 'completedChecks 条目 ' + item.raw + ' 为 handoff scope（' + item.node +
            ' 节点的 ' + item.skill + ' 由子代理加载，协调者无需 skill-load 标记）但共用证据库' +
            ' evidence[subagent-execute].handoffResult 无委托记录——先委托子代理并回传 Return Contract（workflow-handoff.mjs result <task-id> <contract>）',
        };
      }
      continue;
    }
    // 标记路径解析——活动路径优先，归档路径兜底（archive 节点「先移目录后 record」
    // 顺序下标记只在 .specs/archive/<日期>-<change-id>/.skill-loads/）；两处都找不到 → BLOCK + 指引
    // （不静默放行）。展示路径补 .specs/ 前缀便于用户定位。
    const markerName = item.node + '-' + item.skill + '.json';
    const activeDisplay = '.specs/' + path.posix.join(changeName, '.skill-loads', markerName);
    const activePath = path.join(specsDir(), changeName, '.skill-loads', markerName);
    let markerPath = await fileExists(activePath) ? activePath : null;
    let markerDisplay = activeDisplay;
    if (!markerPath) {
      const loadsDir = await findSkillLoadsDir(changeName);
      if (loadsDir !== null) {
        const altPath = path.join(loadsDir.dir, markerName);
        if (await fileExists(altPath)) {
          markerPath = altPath;
          markerDisplay = loadsDir.display + markerName;
        }
      }
    }
    if (!markerPath) {
      // 声明命令由协议派生（该条目所指节点的全部协议文件 + 模板全清单），脚本路径与协议上下文由
      // 唯一装配补齐：只给 "skill-load <node> <skill>" 或裸脚本名的旧形态，照抄后会被模板声明门 /
      // 出口覆盖门逐个拦下，或在 shell 里 command not found——报文给出的东西必须一次补齐。
      // 协议外节点（旧证据里出现过、当前协议已删）取不到节点声明：仍按条目里的节点名给命令，
      // 不拼引擎映射（没有映射就没有 --prompt / --templates 可拼——不编造）。
      const declaredNode = (protocol?.nodes ?? []).find((node) => node.id === item.node) ?? { id: item.node };
      return {
        ok: false,
        reason: 'completedChecks 条目 ' + item.raw + ' 缺少对应声明标记 ' + activeDisplay +
          '（归档路径也未找到）——先加载该 skill 并照抄下面的命令声明已加载:\n  '
          + declarationCommand({ node: declaredNode, skill: item.skill, context }),
      };
    }
    let marker;
    try {
      marker = await readJson(markerPath);
    } catch {
      return { ok: false, reason: '声明标记损坏（非法 JSON，需重新运行 skill-load）: ' + markerDisplay };
    }
    // 交叉自洽——标记 at 必须 ≤ 本次记录时间（标记先于记录声明）
    if (typeof marker.at !== 'string' || marker.at > recordTime) {
      return {
        ok: false,
        reason: '声明标记时间序非法（标记 at=' + JSON.stringify(marker.at) + ' 不早于本次记录时间 ' + recordTime +
          '）——标记必须先于记录声明（重新运行 skill-load）',
      };
    }
  }
  return { ok: true };
}
