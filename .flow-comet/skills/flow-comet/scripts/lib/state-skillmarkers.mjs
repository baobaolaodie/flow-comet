// skill-load 声明标记族（单一归属）：--prompt 参数提取与归属校验、协议 scope 绑定查询、
// 标记目录解析、节点声明存在性，以及 completedChecks 的真实性校验。
// 诚实边界：标记是「声明」而非物理证明——运行时没有 Skill 调用观察点，脚本无法确认执行者
// 真实加载过该 skill；标记仅证明「执行者主动声明已加载」，由流程纪律兜底。handoff 条目的证据
// 同样不是物理证明——它是子代理回传的 Return Contract 委托声明（子代理自称已加载并执行），
// 由 handoff result 的 commitHash/greenEvidence 审计性兜底。
import { promises as fs } from 'fs';
import path from 'path';
import { fileExists, readJson, specsDir } from './state-io.mjs';

// --prompt 原始参数提取（skill-load 专用参数）：--protocol 由 resolveProtocol 全局解析
// （CLI > env > 默认）为工作流协议 JSON——skill-load 曾用 --protocol 传 prompt 路径，主仓真实链路
// 必现撞车（markdown 被当协议 JSON 解析 → 启动报错「workflow protocol file is not valid JSON」）。
// 改名 --prompt 后与全局协议解析彻底解耦；此处仅取用户显式传入的原始值，供 skill-load
// 的 flow-kit/prompts/ 归属校验与标记记录。
export function findPromptArg(cliArgs) {
  for (let index = 0; index < cliArgs.length; index++) {
    const arg = cliArgs[index];
    if (arg === '--prompt') {
      const value = cliArgs[index + 1];
      if (typeof value !== 'string' || value === '') return null;
      return value;
    }
    if (typeof arg === 'string' && arg.startsWith('--prompt=')) {
      const value = arg.slice('--prompt='.length);
      return value === '' ? null : value;
    }
  }
  return null;
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

// 标记目录解析——活动路径 .specs/<change-id>/.skill-loads/ 优先；归档路径兜底
// （archive 节点「先移目录后 record/exit」顺序下 change 目录已在 .specs/archive/<前缀>-<change-id>/，
// 标记只随目录移动——只查活动路径会误报缺失）。归档扫描匹配后缀 -<change-id>（前缀可含日期等，
// 与协议 flowkit.archive.v1 的 archive/*-<change-id> artifact 路径同构）。两者皆无 → null。
export async function findSkillLoadsDir(changeName) {
  const activeDir = path.join(specsDir(), changeName, '.skill-loads');
  if (await fileExists(activeDir)) {
    return { dir: activeDir, display: '.specs/' + changeName + '/.skill-loads/' };
  }
  const archiveRoot = path.join(specsDir(), 'archive');
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

// completedChecks 真实性校验。解析 completedChecks 的 required-skill:<node>.<skill>
// 条目 → 对应声明标记 .specs/<change-id>/.skill-loads/<node>-<skill>.json 必须存在（缺失 →
// BLOCKED + 指引先加载 skill 并运行 skill-load）；标记 at 必须 ≤ 本次记录时间（交叉自洽：
// 标记先于记录声明；ISO-8601 UTC 字符串字典序 = 时间序）。仅校验本次 record 写入的
// completedChecks（旧 change 兼容：旧 evidence 不追溯——由调用方只传本次 parsed.completedChecks）。
// 条目按协议 requiredSkillCalls scope 分类——handoff scope 条目（子代理加载的 skill，
// 如 subagent-execute 节点的 flow-comet-dev）豁免标记，以共用证据库 evidence['subagent-execute']
// 的 handoffResult（有委托记录即满足）为证据；main scope / 协议外条目仍要求标记（fail-closed）。
// 返回 { ok: true } 或 { ok: false, reason }（fail-closed：无 active change / 标记损坏同样 BLOCK）。
export async function verifySkillLoadMarkers(completedChecks, changeName, recordTime, protocol, state) {
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
    // 顺序下标记只在 .specs/archive/*-<change-id>/.skill-loads/）；两处都找不到 → BLOCK + 指引
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
      return {
        ok: false,
        reason: 'completedChecks 条目 ' + item.raw + ' 缺少对应声明标记 ' + activeDisplay +
          '（归档路径也未找到）——先加载该 skill 并运行 workflow-state.mjs skill-load ' + item.node + ' ' + item.skill,
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
