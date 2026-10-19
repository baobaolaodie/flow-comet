// state 命令族 · 管理面（单一归属）：config / execution-mode / skill-load / verify-fail。
// argv = 进程参数原样（位置参数取值形态与入口分派前一致）。
import path from 'path';
import { isValidTimestamp } from '../time-utils.mjs';
import { verifyFailuresFor, setVerifyFailuresFor, writeJsonAtomic } from '../state-schema.mjs';
import { findActiveChange, readState, writeState, specsDir } from './state-io.mjs';
import {
  describeTemplateList,
  findTemplatesArg,
  nodeTemplateDeclaration,
  templateDeclarationProblems,
  templateDeclareCommand,
} from '../protocol-utils.mjs';
import { findPromptArg, protocolUnderFlowKitPrompts } from './state-skillmarkers.mjs';

// config set <key> <value>——branchMode 只读（init 自动判定），enablePrReview 手动
// 开关，last_evolve_at 为 evolve 元数据时刻（形态校验 fail-closed，写通道唯一）
export async function runConfig(argv) {
  const sub = argv[3];
  const key = argv[4];
  const value = argv[5];
  if (sub !== 'set') throw new Error('config 仅支持 set 子命令。用法: workflow-state.mjs config set <key> <value>');
  if (!key || value === undefined) throw new Error('config set 需要 key 和 value。用法: workflow-state.mjs config set <key> <value>');
  if (key === 'branchMode') {
    console.error('BLOCKED: branchMode 由 init 自动判定，不可手动设置');
    process.exit(1);
  }
  if (key === 'enablePrReview') {
    if (value !== 'true' && value !== 'false') {
      console.error('BLOCKED: config set 值非法（enablePrReview 必须为 true 或 false）: ' + value);
      process.exit(1);
    }
    const state = await readState();
    state.enablePrReview = value === 'true';
    await writeState(state);
    console.log('CONFIG: enablePrReview = ' + state.enablePrReview);
    return;
  }
  // evolve 元数据时间戳（脚本不直写 state，项目级字段一律经本通道）。形态非法 → BLOCK
  // 且**零改写**（校验先于读 state 与写盘；writeState 侧的字段校验表是第二道闸，同一判据）。
  if (key === 'last_evolve_at') {
    if (!isValidTimestamp(value)) {
      console.error('BLOCKED: config set 值非法（last_evolve_at 必须为本地时间 + 显式偏移形态 '
        + 'YYYY-MM-DDTHH:mm:ss±HH:mm，兼容历史 Z 形态）: ' + value);
      process.exit(1);
    }
    const state = await readState();
    state.last_evolve_at = value;
    await writeState(state);
    console.log('CONFIG: last_evolve_at = ' + state.last_evolve_at);
    return;
  }
  console.error('BLOCKED: 未知配置键: ' + key + '（支持: enablePrReview, last_evolve_at；branchMode 由 init 自动判定）');
  process.exit(1);
}

// execution-mode <subagent|direct>——direct 是逃生口：必须用户显式调用并留授权痕迹
export async function runExecutionMode(argv) {
  const mode = argv[3];
  if (mode !== 'subagent' && mode !== 'direct') {
    console.error('BLOCKED: execution-mode 参数必须为 subagent 或 direct，收到: ' + String(mode));
    process.exit(1);
  }
  const state = await readState();
  state.executionMode = mode;
  // direct 是逃生口：必须用户显式调用，并记录 directOverride；切回 subagent 时清除
  // （directOverride 恒等于"当前是否处于用户确认的 direct"——再次切 direct 必须重新确认，无历史歧义）
  state.directOverride = mode === 'direct';
  if (mode === 'direct') {
    // 授权审计留痕：direct 是用户决策点不可自决——协调者显式调用本命令即授权事件，写入授权
    // 审计字段（guard 出口校验须存在授权记录；执行者绕过脚本手改 state 字段无授权记录 → BLOCK）。
    console.error('DIRECT-AUTH: direct=逃生口须用户显式授权——本命令即授权留痕（directOverrideAt 写入）');
    state.directOverrideAt = new Date().toISOString();
    state.directOverrideSource = 'execution-mode';
  } else {
    // 切回 subagent 清除授权留痕（directOverride 一并清除——既有语义保持）
    delete state.directOverrideAt;
    delete state.directOverrideSource;
  }
  await writeState(state);
  console.log('EXECUTION-MODE: ' + state.executionMode + (state.directOverride ? ' (directOverride)' : ''));
  return;
}

// skill-load <node> <skill> [--prompt <path>] [--templates <a.md,b.md>]——写声明标记
// .specs/<change-id>/.skill-loads/<node>-<skill>.json
// （{ node, skill, protocol, templates, at }）；record 校验 completedChecks 的 required-skill 条目
// 与节点模板声明以此为准。
// 诚实边界：标记是"声明"而非物理证明——运行时没有 Skill 调用观察点，脚本无法确认执行者
// 真实加载过该 skill；标记仅记录"执行者主动声明已加载"，由流程纪律兜底。
export async function runSkillLoad(protocol, argv) {
  const nodeId = argv[3];
  const skillName = argv[4];
  if (!nodeId || !skillName) {
    throw new Error('skill-load requires <node> <skill>. 用法: workflow-state.mjs skill-load <node> <skill> [--prompt <path>] [--templates <a.md,b.md>]');
  }
  // 参数校验：node 为当前协议节点集合之一（动态读取协议 nodes[].id——内置 +
  // 自定义，compose 自定义协议节点可声明）；协议外节点名依然非法（fail-closed）。
  const protocolNodeIds = (protocol.nodes ?? []).map((n) => n.id);
  if (!protocolNodeIds.includes(nodeId)) {
    throw new Error('skill-load node 非法: ' + nodeId + '（协议节点: ' + protocolNodeIds.join('/') + '）');
  }
  if (!/^[A-Za-z0-9-]+$/.test(skillName)) {
    throw new Error('skill-load skill 名非法（仅允许字母数字连字符）: ' + skillName);
  }
  // --prompt 归属校验：路径必须位于 flow-kit/prompts/ 下（相对或绝对，前缀校验；
  // flow-kit 为 vendored 上游，协议提示只读引用）。协议加载本身由 resolveProtocol 全局
  // 处理（含受保护读取）——--protocol 语义不变（工作流协议 JSON）；此处仅校验用户显式传入的
  // --prompt 原始值（skill-load 专属参数，不再与全局协议解析共用 --protocol）。
  const promptArg = findPromptArg(argv.slice(3));
  if (promptArg !== null && !protocolUnderFlowKitPrompts(promptArg)) {
    throw new Error('skill-load --prompt 路径必须位于 flow-kit/prompts/ 下（flow-kit 为 vendored 上游，协议提示只读引用）: ' + promptArg);
  }
  // 产出物模板声明（C4 / C11）：置入既有标记 JSON 的 templates 数组（节点级一份）。
  // 内置节点：声明集合必须与 C3 映射一致（required ⊆ declared ⊆ required ∪ optional）——新 change
  // 缺失 / 多写 / 漏写 / 错名一律 BLOCK（fail-closed），旧 change 只在「显式传了不一致的清单」时
  // WARN（渐进兼容：旧项目不可能一夜补齐声明，缺失由 record 侧统一给提示，不在声明处重复报）。
  // 自定义协议节点：不比对集合（ADR-002 特化层，C12：协议声明什么就记什么）。
  const templateArg = findTemplatesArg(argv.slice(3));
  const templateDeclaration = nodeTemplateDeclaration((protocol.nodes ?? []).find((item) => item.id === nodeId));
  if (templateDeclaration.source === 'builtin') {
    const isNewChange = (await readState()).newChange === true;
    const requiredNames = describeTemplateList(templateDeclaration.required);
    const declareCommand = templateDeclareCommand(templateDeclaration, { nodeId, skillName });
    const reportUnsoundDeclaration = (reason) => {
      if (isNewChange) {
        console.error('BLOCKED: ' + reason + '——重跑 ' + declareCommand + ' 重新声明后重试');
        process.exit(1);
      }
      console.error('WARN: ' + reason + '——重跑 ' + declareCommand + ' 重新声明（旧 change 渐进不阻断）');
    };
    const problems = templateDeclarationProblems(templateDeclaration, templateArg.values);
    if (!templateArg.provided && templateDeclaration.required.length > 0 && isNewChange) {
      reportUnsoundDeclaration('节点 ' + nodeId + ' 的模板声明缺失（C3 映射: ' + requiredNames + '）');
    }
    if (templateArg.provided && (problems.missing.length > 0 || problems.extra.length > 0)) {
      const detail = [];
      if (problems.missing.length > 0) detail.push('漏写: ' + problems.missing.join('、'));
      if (problems.extra.length > 0) detail.push('多写/错名: ' + problems.extra.join('、'));
      reportUnsoundDeclaration('节点 ' + nodeId + ' 的模板声明与节点映射不一致（' + detail.join('；')
        + '；映射要求: ' + requiredNames + '）');
    }
  }
  // 声明标记写入：.skill-loads/ 目录不存在时创建（writeJsonAtomic 自带 mkdir recursive）；
  // 同 node-skill 重复调用覆盖（记录最新声明）
  const changeName = await findActiveChange();
  if (!changeName) {
    // 归档后场景:change 目录已移入 .specs/archive/(无活跃 change)——skill-load 不可用,
    // 但 record 的声明自动化仍可写归档路径标记——消息如实引导
    throw new Error('skill-load requires an active change（先运行 init <change-id>;若该 change 已归档,声明标记由 record 自动补写——M5 会写入归档路径的 .skill-loads/）');
  }
  // 标记 protocol 字段 = --prompt 参数的 basename（如 0-change.md）——与 guard exit
  // 校验的节点协议映射表 basename 精确比对同值（真实链路 skill-load → exit 一致）；未传 --prompt →
  // null（无协议声明，exit 校验 fail-closed）。若写 resolveProtocol 解析后的完整绝对路径，与
  // 节点协议映射表的 basename 比对必然失败（真实链路必 BLOCKED——机制实际不可用）。
  const marker = { node: nodeId, skill: skillName, protocol: promptArg === null ? null : path.basename(promptArg), templates: templateArg.values, at: new Date().toISOString() };
  // specsDir 已含 .specs/，相对路径为 <change-id>/.skill-loads/<node>-<skill>.json
  const markerRel = path.posix.join(changeName, '.skill-loads', nodeId + '-' + skillName + '.json');
  await writeJsonAtomic(path.join(specsDir(), markerRel), marker);
  console.log('SKILL-LOAD: ' + nodeId + ' ' + skillName + ' → .skill-loads/' + nodeId + '-' + skillName + '.json');
  return;
}

// verify-fail：连续失败计数（按 change 隔离），第 4 次 BLOCK 要求用户决策
export async function runVerifyFail() {
  const state = await readState();
  // 机器计数——连续 3 次失败后（第 4 次）BLOCKED，要求用户决策（继续修 / 停止）
  // 计数按当前 change 存储(verifyFailuresByChange)——切换 change 后计数独立,互不串扰;
  // 旧顶层字段首次读取时迁移并入当前 change(旧 state 兼容)
  const count = verifyFailuresFor(state);
  if (count >= 3) {
    console.error('verify 失败超限，需用户决策（verifyFailures=' + count + '）。继续修 / 停止？');
    process.exit(1);
  }
  setVerifyFailuresFor(state, count + 1);
  await writeState(state);
  console.log('VERIFY-FAIL: ' + (count + 1) + '/3');
  return;
}
