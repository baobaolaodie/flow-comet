#!/usr/bin/env node
// 节点门禁入口：CLI + 分派 + 编排 + 收口。
//
// 本文件只做三件事——解析命令行参数、按命令分派、按固定顺序调用门禁模块并收口输出与退出码；
// 判据实现一律落 lib/guard-*.mjs（入口零内联副本）。协议路径解析在此完成（state.protocolPath
// 需先读标准运行时状态文件引导，协议决定 statePath 时存在先后次序）。

import { promises as fs } from 'fs';
import path from 'path';
import {
  RUNTIME_STATE_PATH,
  hasProtocolCliArg,
  resolveProtocolPathWithState,
  setVerifyFailuresFor,
  validateStateFields,
} from './state-schema.mjs';
import {
  NODE_CONDITIONAL_PROMPTS,
  nodeTemplateDeclaration,
  promptDeclarationConflict,
  promptPointerLines,
  promptPointerPath,
  readProtocolFile,
  templatePointerLines,
  validateProtocolSchema,
} from './protocol-utils.mjs';
import {
  EXECUTE_FAMILY_NODE_IDS,
  TASK_SET_SIGNATURE_ALGO,
  classifyFixReturnCause,
  resolveFixReturnNode,
  taskSetSignature,
} from './route-node.mjs';
import { taskBlocks as extractTaskBlocks, taskOpeningAttrs } from './task-parsing.mjs';
import {
  fileExists,
  packageRoot,
  readStateJson,
  runRoot,
  setProtocolPath,
  statePath,
  writeJson,
} from './lib/guard-state-io.mjs';
import {
  completedSet,
  derivedFixSectionTitle,
  findNode,
  nextNode,
  printNext,
  route,
} from './lib/guard-routing.mjs';
import { checkUiDesignArtifact, frontendCriterion } from './lib/guard-uidesign.mjs';
import {
  runIntakeDocFidelityGate,
  runSummaryTemplateFidelityGate,
  runTaskSevenFieldGate,
} from './lib/guard-template-fidelity.mjs';
import {
  requireNodeEvidence,
  runArchiveBranchMergeGate,
  runArchiveLogOrderGate,
  runContextAppendGate,
  runDesignDecisionListGate,
  runDesignStackGate,
  runEntryGates,
  runEntryRecordGate,
  runExitDriftGate,
  runFixBatchExitGate,
  runLessonsZoneGate,
  runOpenRequiredSectionsGate,
  runPlanExitGate,
  runRequirementAcGate,
  runReviewExitGate,
  runSkillLoadMarkerGate,
  runTaskSetSignatureExitGate,
  runTransitionEvidenceGate,
} from './lib/guard-gates.mjs';
import {
  runArtifactGate,
  runDirectOverrideGate,
  runEvidenceCompletionGate,
  runExecuteExitGate,
  runInFlightHandoffGate,
  runMultiPassCompletionGate,
  runRequiredEvidenceGate,
  runReturnContractGate,
  runSubagentSummaryGate,
  runSummarySectionsGate,
  runVerifyExitGate,
} from './lib/guard-evidence-gates.mjs';

const command = process.argv[2] ?? 'verify';
const nodeId = process.argv[3] ?? null;
const apply = process.argv.includes('--apply');

// WARN 计数——entry/exit 成功路径末尾输出汇总行（可观测性；追加不改变既有输出）
let __warnCount = 0;
const __origError = console.error;

// 协议绑定引导读取：协议决定 statePath，故协议未解析前只能读标准运行时状态文件，仅取
// state.protocolPath 用于协议选择；文件缺失/旧 state 缺字段/读取失败 → null（未绑定），由统一
// 解析回退 CLI/环境变量/默认协议。不改变后续 statePath 解析与读写语义。
async function readPersistedProtocolBinding() {
  const standardStateFile = path.join(runRoot, ...RUNTIME_STATE_PATH.split('/'));
  try {
    if (!(await fileExists(standardStateFile))) return null;
    const state = await readStateJson(standardStateFile);
    return state && typeof state === 'object' ? state : null;
  } catch {
    return null;
  }
}

// 协议路径选择（单一权威）：显式 --protocol CLI 参数优先；无 CLI 时按 state.protocolPath >
// FLOW_COMET_PROTOCOL 环境变量 > 默认解析。state.protocolPath 存在但不可读时 fail-closed
// （受保护读取/schema 校验抛错由 main().catch 统一处理）——不静默回退到另一份协议造成门禁按错误
// 协议判定。
async function resolveGuardProtocolPath() {
  const cliArgs = process.argv.slice(3);
  if (hasProtocolCliArg(cliArgs)) {
    return resolveProtocolPathWithState({ packageRoot, runRoot, cliArgs });
  }
  const state = await readPersistedProtocolBinding();
  return resolveProtocolPathWithState({ packageRoot, runRoot, state });
}

// skill-load 声明里的 --prompt 与节点协议文件的一致性（入口侧）：扫描本节点已写下的声明标记，
// 任何一条显式声明的协议文件落在该节点协议面之外 → BLOCK。判据单实现在 protocol-utils 的
// promptDeclarationConflict，本函数只负责读标记目录；出口侧的「至少一个标记 ∈ 节点协议集」门落在
// guard-gates——两处同源不同层（入口判「每条声明都对」，出口判「本节点确有可用声明」）。
async function checkPromptDeclarations({ node, state }) {
  if (!state.activeChange) return;
  const loadsDir = path.join(runRoot, '.specs', state.activeChange, '.skill-loads');
  let names;
  try {
    names = await fs.readdir(loadsDir);
  } catch {
    return; // 声明机制未激活（本节点还没写过声明）：入口不追溯，缺失由出口声明门报
  }
  const prefix = node.id + '-';
  const conflicts = [];
  for (const name of names.filter((entry) => entry.startsWith(prefix) && entry.endsWith('.json'))) {
    let marker;
    try {
      marker = JSON.parse(await fs.readFile(path.join(loadsDir, name), 'utf8'));
    } catch {
      continue; // 损坏标记由出口声明门报，不在这里抢报（同一缺陷不写两处措辞）
    }
    if (marker?.auto === true) continue; // 引擎代记的标记不是执行者的声明
    const conflict = promptDeclarationConflict({ node, declaredProtocol: marker?.protocol });
    if (conflict) conflicts.push({ name, ...conflict });
  }
  if (conflicts.length === 0) return;
  console.error('BLOCKED: 节点 ' + node.id + ' 的 skill-load 声明 --prompt 与节点协议文件不符——'
    + conflicts.map((conflict) => conflict.name + ' 声明 ' + conflict.declared
      + '（应为 ' + conflict.expected.map(promptPointerPath).join(' / ') + '）').join('；')
    + '；重跑 skill-load ' + node.id + ' <skill> --prompt <上述协议文件> 重新声明后重试');
  process.exit(1);
}

async function main() {
  // 包装 console.error 统计 WARN 输出（转发原实现，行为不变）
  console.error = (...args) => {
    if (/WARN/.test(args.join(' '))) __warnCount += 1;
    __origError(...args);
  };
  // 协议路径选择 + 受保护读取 + fail-closed schema 校验（读失败/校验失败沿用 throw →
  // main().catch 统一处理；来源为 state.protocolPath 时补充来源与不回退说明）
  const selectedProtocol = await resolveGuardProtocolPath();
  const protocolPath = selectedProtocol.protocolPath;
  setProtocolPath(protocolPath);
  let protocol;
  try {
    protocol = await readProtocolFile(runRoot, protocolPath);
    validateProtocolSchema(protocol);
  } catch (error) {
    if (selectedProtocol.source === 'state') {
      throw new Error('state.protocolPath 指向的协议不可读（' + protocolPath + '）：'
        + (error && typeof error.message === 'string' ? error.message : String(error))
        + '——不回退环境变量/默认协议（回退会按错误协议判定门禁）；修正 state.protocolPath 或移除绑定后重试');
    }
    throw error;
  }
  if (command === 'verify') {
    console.log('workflow-guard-ok');
    return;
  }
  if (command !== 'entry' && command !== 'exit') throw new Error('Unknown command: ' + command);
  if (!nodeId) throw new Error(command + ' requires a Node id.');
  const node = findNode(protocol, nodeId);
  if (!node) throw new Error('Unknown workflow Node: ' + nodeId);
  const file = await statePath(protocol);
  const state = await readStateJson(file);
  state.completedNodes = Array.isArray(state.completedNodes) ? state.completedNodes : [];
  state.evidence = state.evidence && typeof state.evidence === 'object' ? state.evidence : {};
  if (command === 'entry') {
    // 加载链的两条指针：先步骤权威（协议提示词），再段形权威（产出物模板）——顺序即语义：先知道
    // 这一步怎么做，再知道产出长什么样。两者都先于门禁链输出：即使后面的入口校验拦下，执行者也先
    // 看到该读什么。提示词路径由 protocol-utils 的 NODE_PROTOCOL_FILES 单一提供（与出口协议声明
    // 校验同源），零提示词的自定义协议节点不打印。
    //
    // 条件指针（条件提示词 / 条件模板）共用一条前端判据：CHANGE.md「视觉调性」判为前端才追出。判据
    // 归属 guard-uidesign 的 frontendCriterion（单一实现），此处只消费、不写第二份；两类条件指针取
    // 同一个 frontend 值——同一 change 上不可能得出两种结论。任一侧登记了条件文件（模板 optional 或
    // 节点条件提示词）就求值：缺一侧不等于非前端。
    const declaration = nodeTemplateDeclaration(node);
    const hasConditionalPointer = declaration.optional.length > 0
      || (NODE_CONDITIONAL_PROMPTS[node.id] ?? []).length > 0;
    const frontend = hasConditionalPointer
      ? (await frontendCriterion(state.activeChange)).applicable === true
      : false;
    for (const line of promptPointerLines(node, { conditional: frontend })) {
      console.log(line);
    }
    // 产出物模板指针（加载链的第一环）：引擎推导、不依赖纪律——内置节点取 C3 映射（协议副本没写
    // node.templates 也照样打印），自定义协议节点取协议里的 node.templates 声明，零模板节点不打印。
    // 先于门禁链输出：即使后面的入口校验拦下，执行者也能先看到该读哪份模板。
    if (declaration.required.length > 0 || declaration.optional.length > 0) {
      for (const line of templatePointerLines(declaration, { label: 'READ TEMPLATE', conditional: frontend })) {
        console.log(line);
      }
    }
    // 已写下的声明必须与节点协议文件一致（错路径 fail-closed）——把「读哪份提示词」从散文要求变成
    // 入口可核对的判据；未声明 / 自动标记不在此判，缺失仍由出口声明门负责。
    await checkPromptDeclarations({ node, state });
    await runEntryGates({ protocol, node, state, file });
    return;
  }
  // —— 出口校验链（顺序即语义：每条门禁命中即按既有分级 BLOCKED / WARN）——
  const evidence = requireNodeEvidence({ node, state });
  await runExitDriftGate({ protocol, node, state, evidence });
  await runFixBatchExitGate({ protocol, node, state });
  runEntryRecordGate({ node, state });
  await runArchiveBranchMergeGate({ node, state });
  await runContextAppendGate({ node, state });
  await runLessonsZoneGate({ node, state });
  await runArchiveLogOrderGate({ node, state });
  runTransitionEvidenceGate({ node, evidence });
  await runTaskSetSignatureExitGate({ node, state });
  await runRequirementAcGate({ node, state });
  await runDesignStackGate({ node, state });
  await runOpenRequiredSectionsGate({ node, state });
  await runDesignDecisionListGate({ node, state });
  await checkUiDesignArtifact(node, state);
  await runPlanExitGate({ protocol, node, state });
  await runReviewExitGate({ node, state });
  runDirectOverrideGate({ node, state });
  runInFlightHandoffGate({ node, state });
  await runSummarySectionsGate({ node, state });
  // execute 出口空退出豁免（豁免仅适用于「无任何串行任务」的全并行 change；含串行任务
  // （parallel!=="true"，缺省串行——与 task-parsing.mjs 同语义）时豁免不生效，后续产物校验照常
  // 执行——陈旧标记不得静默放行）。判据单一来源：evidence 谓词只在此处求值一次，execute 出口
  // 门禁与产物门禁共用。
  const executeEmptyExitApproved = node.id === 'execute' && !!(state.evidence?.execute?.emptyExitApproved);
  const { exempt: executeEmptyExitExempt } = await runExecuteExitGate({
    protocol,
    node,
    state,
    emptyExitApproved: executeEmptyExitApproved,
  });
  await runVerifyExitGate({ protocol, node, state });
  runReturnContractGate({ node, state });
  await runSubagentSummaryGate({ node, state });
  await runMultiPassCompletionGate({ node, state });
  await runSkillLoadMarkerGate({ node, state });
  await runSummaryTemplateFidelityGate({ node, state });
  await runTaskSevenFieldGate({ node, state });
  await runIntakeDocFidelityGate({ node, state });
  await runEvidenceCompletionGate({ protocol, node, state, evidence });
  await runArtifactGate({
    protocol,
    node,
    state,
    emptyExitApproved: executeEmptyExitApproved,
    emptyExitExempt: executeEmptyExitExempt,
  });
  runRequiredEvidenceGate({ node, evidence });
  if (apply) {
    const completed = completedSet(state);
    // Fix 二次完成信号：exit 的 execute 家族节点在本次 exit 之前已在 completedNodes（首轮 exit
    // 后再次进入该节点生命周期完成回修）——须在 add 之前捕获，作为回源分支的唯一触发条件。
    const familyAlreadyCompleted = completed.has(node.id);
    completed.add(node.id);
    // verify exit --apply 成功 → 当前 change 的 verifyFailures 清零
    if (node.id === 'verify') setVerifyFailuresFor(state, 0);
    state.completedNodes = route(protocol).filter((item) => completed.has(item.id)).map((item) => item.id);
    // archive 节点完成后 change 已归档 → 清空活跃 change（flow-comet 回到无活跃状态）
    const isArchive = node.id === 'archive';
    if (isArchive) state.activeChange = null;
    let next = isArchive ? null : await nextNode(protocol, state);
    // Fix 批次受控回程——exit execute 家族 --apply：Fix 二次完成（本节点已在 completedNodes）且
    // TASK 全 done 时，回源节点（execute 后第一个未完成节点且 ∈ review/verify）跑其出口；其余情况
    // 维持 resolveNextNode 原判定（正常首轮 exit 与多趟中间 exit 零回归）。
    if (EXECUTE_FAMILY_NODE_IDS.has(node.id) && familyAlreadyCompleted && state.activeChange) {
      const fixReturnSource = await resolveFixReturnNode({
        runRoot,
        changeName: state.activeChange,
        protocol,
        completedNodes: state.completedNodes,
      });
      if (fixReturnSource) {
        next = findNode(protocol, fixReturnSource);
        // 回程行分类——只在写本次 exit-applied 事件之前（下方 state.history.push）用既有字段派生
        // 因果：历史 execute 家族出口签名发散 ∨ TASK 的 Fix 结构标记 → fix；有签名且全等 → normal；
        // 无签名且无标记 / TASK 不可读 → unknown。分类只决定审计行文案；next / currentNode /
        // completedNodes / history 写入仍按既有 resolveFixReturnNode 无条件覆盖（路由与 state 形状
        // 零变化）。协议 TASK 路径与签名记录一致。
        let fixTaskContent = null;
        try {
          fixTaskContent = await fs.readFile(path.join(runRoot, '.specs', state.activeChange, 'TASK.md'), 'utf8');
        } catch {}
        const fixReturnCause = fixTaskContent === null
          ? 'unknown'
          : classifyFixReturnCause({
              history: state.history,
              changeName: state.activeChange,
              taskContent: fixTaskContent,
              fixSectionTitle: await derivedFixSectionTitle(),
            });
        if (fixReturnCause === 'fix') {
          console.log('FIX-BATCH: 回源节点 ' + fixReturnSource + '（' + node.id + ' 出口已完成）');
        } else if (fixReturnCause === 'normal') {
          console.log('RETURN: 回源节点 ' + fixReturnSource + '（' + node.id + ' 出口已完成；正常多趟收尾，非 Fix 回修）');
        } else {
          console.log('RETURN: 回源节点 ' + fixReturnSource + '（' + node.id + ' 出口已完成；旧 state 缺闭合/修复证据，未分类）');
        }
      }
    }
    // 多趟路由诊断保留（展示层，不并入共享判定）：出口推进后下一候选非委托节点时，若任务集存在
    // parallel 标记任务与任一 pending 任务但无 pending parallel 可委托块，输出路由诊断提示。静默
    // 边界：(a) 全部任务 done 时无 pending 不输出（收尾静默锚）；(b) 剩余 pending 全为串行且各
    // parallel 块均带 status（结构正常、P→S 收尾转换）→ 静默（「全 done 静默」扩展为「全串行
    // 剩余」也静默）；(c) 存在「parallel 缺 status」的畸形/旧模板块且仍有 pending → 仍报（结构
    // 校验严格，缺 status 不视为 pending，不因扩展误静音——反过静音锚）。路由决策本身由
    // resolveNextNode 单一实现（不维护第二份并行镜像）。
    if (next && next.id !== 'subagent-execute' && state.activeChange) {
      const taskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
      try {
        const taskContent = await fs.readFile(taskFile, 'utf8');
        const taskList = extractTaskBlocks(taskContent);
        const hasParallelTag = taskList.some((block) => {
          const a = taskOpeningAttrs(block);
          return a && a.parallel;
        });
        const hasPending = taskList.some((block) => {
          const a = taskOpeningAttrs(block);
          return a && a.status === 'pending';
        });
        const hasParallelPending = taskList.some((block) => {
          const a = taskOpeningAttrs(block);
          return a && a.parallel && a.status === 'pending';
        });
        // 畸形/旧模板信号：parallel 标记但缺 status 属性（无法分类为 done/pending——缺 status 不
        // 视为 pending；这正是诊断要提示的检查点）。taskOpeningAttrs 缺属性时 status 返回 null，
        // 故判 `status == null`（null 或 undefined 双容）。
        const hasParallelMissingStatus = taskList.some((block) => {
          const a = taskOpeningAttrs(block);
          return a && a.parallel && (a.status === null || a.status === undefined);
        });
        if (hasPending && hasParallelTag && !hasParallelPending && hasParallelMissingStatus) {
          console.error('ROUTE WARN: 未找到 parallel="true" status="pending" 的任务块——存在 parallel="true" 但缺 status 属性的任务块（缺 status 不视为 pending、无法参与委托判定），检查 task 开标签的 parallel/status 属性（属性序无关）');
        }
      } catch {}
    }
    state.currentNode = isArchive ? null : (next?.id ?? null);
    state.status = next ? 'running' : 'completed';
    state.history = Array.isArray(state.history) ? state.history : [];
    // 「未闭合 execute 生命周期」信号：exit execute / subagent-execute --apply 把当次 TASK.md 任务集
    // 签名与 change 归属写入 history 事件——源节点直接 exit 时以「本 change 最新家族出口签名 ≠ 当前
    // 签名」识别 done-but-unclosed 修复批次（lazy entry 只刷新 taskHash、不写本事件，因此仍保持未
    // 闭合）。change 字段只在家族节点事件上写（其它节点事件形状不变），state.history 跨 change 保留
    // 时用于隔离判定；TASK.md 缺失/不可读时省略签名字段（旧 state 形态 → 渐进放行）。
    const exitEvent = { event: 'exit-applied', node: node.id, at: new Date().toISOString() };
    if (EXECUTE_FAMILY_NODE_IDS.has(node.id) && state.activeChange) {
      exitEvent.change = state.activeChange;
      const exitTaskFile = path.join(runRoot, '.specs', state.activeChange, 'TASK.md');
      try {
        if (await fileExists(exitTaskFile)) {
          exitEvent.taskSetSignature = taskSetSignature(await fs.readFile(exitTaskFile, 'utf8'));
          exitEvent.signatureAlgo = TASK_SET_SIGNATURE_ALGO;
        }
      } catch {}
    }
    state.history.push(exitEvent);
    const bad = validateStateFields(state);
    if (bad.length) { console.error('BLOCKED: state 字段类型非法: ' + bad[0]); process.exit(1); }
    await writeJson(file, state);
    console.log('ALL CHECKS PASSED');
    printNext(protocol, next);
    return;
  }
  console.log('ALL CHECKS PASSED');
  console.log('APPLY: rerun with --apply to update workflow state');
}

main().then(() => {
  // 成功路径末尾输出 WARN COUNT 汇总（用未包装的 console.error——避免自增）
  if (__warnCount > 0) __origError('WARN COUNT: ' + __warnCount);
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
