// state 命令族 · 流程面（单一归属）：init / status / next / select / record / advance。
// 本模块只编排各判定族的共享实现（state-io · state-determine · state-branch · state-evolve-hint ·
// state-intelscan · state-skillmarkers 与既有共享模块），不复制任何判据；argv = 进程参数原样
// （位置参数取值形态与入口分派前一致）。
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { route, resolveNextNode, hasSubagentNode, protocolTaskFilePath, resolveFixRollbackDecision, resolveFixRollbackState, applyFixRollbackRound, resolveFixReturnNode, isSingleSegmentChangeName, EXECUTE_FAMILY_NODE_IDS } from '../route-node.mjs';
import { taskOpeningAttrs, taskBlocks } from '../task-parsing.mjs';
import { NODE_PROTOCOL_FILES, SKILL_PROTOCOL_FILES, inspectWorkflowPathSegments } from '../protocol-utils.mjs';
import { evidencePayloadProblems, looksLikeObjectLiteral, toPersistedProtocolPath, writeJsonAtomic } from '../state-schema.mjs';
import { nowTimestamp } from '../time-utils.mjs';
import { probeProject, classify, printDetection, validateContext, printGenerationGuide } from '../context-init.mjs';
import { fileExists, findActiveChange, readState, writeState, specsDir, runRootDir, hasExactSpecsEntry } from './state-io.mjs';
import { hasNodeSkillDeclaration, verifySkillLoadMarkers, findSkillLoadsDir, verifyTemplateDeclaration } from './state-skillmarkers.mjs';
import { determineNode, normalAdvanceExempt } from './state-determine.mjs';
import { isInsideWorkTree, gitBranchName, branchExists, printBranchLine } from './state-branch.mjs';
import { printEvolveDueHint } from './state-evolve-hint.mjs';
import { reportIntelScanDrift } from './state-intelscan.mjs';
// 命令文本的唯一实现（平台化脚本根 + 整条路径加引号）：运行期 PREFLIGHT 与 handoff result /
// guard 恢复指引 / explain 的 COMMAND 行同源（L-067：同一推导两处表达必然分叉）。
import { scriptCommand } from './state-explain.mjs';
// 协调者提示的单一来源：entry（门禁族）与 next / record（本模块）共用同一常量，各输出面逐字
// 一致。常量落在中立模块（state-explain）而不是门禁族——本模块只为一句措辞去依赖整个上游门禁面
// 是一条反向边——为此状态命令族不再 import 门禁族。
import { COORDINATOR_NOTICE } from './state-explain.mjs';

// 本模块位于 <技能包>/scripts/lib：脚本目录由自身位置推导一次（与 guard-evidence-gates 同形态）。
// 「自己在哪」是本模块可提供的事实，平台化与引号形态本身留在 state-explain。
const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --json-file 路径校验:解析后必须位于项目根内(拒绝相对/绝对形式的越界路径,
// 如 ../..、其他盘符——防读取任意文件内容进 evidence)。runRoot 内的绝对路径合法
// (场景内文件常见写法,与 record/handoff 的既有用法一致)。符号链接解析后的实际路径
// 同样必须在项目根内(词法校验不防 symlink 穿越——realpath 后再次校验)。
// 非字符串/空值(如 --json-file 为最后一个参数)→ 用法错误,不落 path.resolve
// (undefined 会抛 TypeError、空串解析为 runRoot 报 EISDIR——应是用法错误而非类型错误)
async function resolveJsonFileWithinRunRoot(jsonFile) {
  if (typeof jsonFile !== 'string' || jsonFile.trim() === '') {
    throw new Error('--json-file requires a path argument');
  }
  const runRoot = runRootDir();
  const abs = path.resolve(runRoot, jsonFile);
  const rel = path.relative(runRoot, abs);
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) {
    throw new Error('--json-file 路径必须在项目根内: ' + jsonFile);
  }
  // 统一对 runRoot 也 realpath——Windows 上 runRoot 可能是 8.3 短路径(如 LONGYI~1),
  // realpath 会展开为长路径,两者直接 relative 会误判越界
  const realRoot = await fs.realpath(runRoot);
  const real = await fs.realpath(abs);
  const realRel = path.relative(realRoot, real);
  if (path.isAbsolute(realRel) || realRel === '..' || realRel.startsWith('..' + path.sep)) {
    throw new Error('--json-file 路径经符号链接解析后越出项目根: ' + jsonFile);
  }
  return abs;
}

function generatedNodeSkillName(protocol, nodeId) {
  return protocol.name + '-' + nodeId;
}

function printNext(protocol, nodeId, executionMode = 'subagent') {
  if (!nodeId) {
    console.log('NEXT: done');
    return;
  }
  console.log('NEXT: auto');
  console.log('NODE: ' + nodeId);
  console.log('SKILL: ' + generatedNodeSkillName(protocol, nodeId));
  // 输出点名（机器点名下一节点技能）：下一节点实现技能必须经 Skill 工具加载——
  // skill 名取节点实现 skill（与 SKILL: 行一致；内置协议 = flow-comet-open 等）
  const implNode = (protocol.nodes ?? []).find((n) => n.id === nodeId);
  const implSkill = implNode && typeof implNode.implementation === 'object' && implNode.implementation !== null
    ? implNode.implementation.skill
    : null;
  if (implSkill) {
    console.log('LOAD SKILL: ' + implSkill + '（用 Skill 工具，禁止跳过）');
  }
  if (EXECUTE_FAMILY_NODE_IDS.has(nodeId)) {
    if (executionMode === 'direct' && nodeId === 'execute') {
      console.log('EXECUTION-MODE: direct（主代理直接执行串行任务，必须加载 flow-comet-dev 完整协议；parallel 任务仍由 subagent-execute 委托）');
    } else {
      // 现行架构口径（ADR-014 / 并行委派四属性契约）：委托按**平台的身份通道**判定，不是按
      // 建树方式；独立 worktree 只是「① 写权限」的一种实现，共享工作区同样受支持（边界来自
      // 互不重叠的任务写集、提交时点纪律与最小保护集）。文案取 guard-gates 的单一常量——
      // entry 与 next 逐字相同；旧句「只能通过 Agent 工具 worktree isolation 委托子代理」不得
      // 在任何一处复活。
      console.log('COORDINATOR: ' + COORDINATOR_NOTICE);
      console.log('EXECUTION-MODE: ' + (executionMode === 'direct' ? 'direct' : 'subagent'));
    }
  }
}

// ---------- 节点视图（单一实现）：state 原值 / 产物推导 / 进行中保护 → 路由视图 ----------
// 「我现在该在哪个节点」只有这一份判定（同一事实两处实现必然分叉——LESSONS 的路由单一权威族）。
// 收敛前 next 内联一份、status 只报产物推导：同一 state 下两条命令报不同节点，执行者按任一输出
// 行动都可能撞上节点顺序门禁。收敛后三视图各归其位：
//   derivedNode = 产物推导（既有键 currentNode 的语义，逐字不变）；
//   stateNode   = state.currentNode 原值（既有键 stateCurrentNode 的语义，逐字不变）；
//   routeNode   = 经「进行中保护」/「Fix 受控归位」后的路由视图（next 的 NODE 行的唯一来源）。
// 纯判定：只读 state 与产物，不写 state、不打印（展示由各命令渲染）。
// 消费方：status / next（本模块）与 workflow-handoff 的 result 提示（import 本函数，不复制第二份
// 判定——Fix 归位态若在 handoff 侧另取 state.currentNode，会指到被 Fix 批次门禁拦下的源节点）。
export async function resolveNodeView({ changeName, protocol, state }) {
  const completedArr = Array.isArray(state.completedNodes) ? state.completedNodes : [];
  const derivedNode = await determineNode(changeName, protocol, completedArr);
  // 进行中节点保护：currentNode 未 exit（不在 completedNodes）且已 entry（enteredNodes 含该节点）
  // 或已 record（evidence 记录过）→ 视为进行中（可能 exit 被内容级拦截后重跑），不校正推走——
  // 否则被拦截节点的 exit 前置校验（currentNode 匹配）无法重跑，advance/select 均不恢复 → 死结
  // （实测教训）。旧 state 无 enteredNodes 时回退 evidence 判定（既有语义不回归）。
  const currentNodeEvidence = state.currentNode && state.evidence && typeof state.evidence === 'object'
    ? state.evidence[state.currentNode]
    : null;
  const currentNodeEntered = !!(
    state.enteredNodes && Array.isArray(state.enteredNodes) && state.enteredNodes.includes(state.currentNode)
  );
  const routeIds = route(protocol).map((n) => n.id);
  const currentNodeIdx = state.currentNode ? routeIds.indexOf(state.currentNode) : -1;
  // 推导为 currentNode 的**路由后继**（与 guard 出口同源：把 currentNode 视为已完成再加入
  // completedNodes 求 resolveNextNode）→ 该节点产物已齐待 exit、路由自然推进到 derivedNode
  // （平行转换 plan→subagent-execute、趟间回流 subagent-execute→execute 均属此形态）→ 保护。
  // 反过度修复锚（同族：产物全齐但无推进史形态）：completedNodes 为空（无任何 exit 推进史，
  // currentNode 仅是初始陈旧节点）时不做路由后继保护——产物推导继续生效推进到最终节点。
  // 推导跳跃/跨节点或回退 → 产物权威校正(漂移,防过度修复)。静态直接后继兜底（串行推进原语义）。
  const routingSuccessorOfCurrent = state.currentNode
    ? await determineNode(changeName, protocol, [...completedArr, state.currentNode])
    : null;
  // 「相等」还不是后继：等号只在两处推导同值时成立，派生的节点仍可能在 currentNode **之前**
  // （currentNode 之后的节点产物缺失 → 派生回退；或 Fix 归位把任务推回 execute）——此时按等号
  // 保护会把路由钉在 currentNode、吞掉产物权威校正（实测：verify 驻留 + REVIEW.md 缺失仍报
  // verify）。故补协议 route 顺序条件：derived 的下标必须严格大于 currentNode 的下标。
  // 两个例外都维持既有语义：① execute 家族之内——execute ⇄ subagent-execute 是同一个多趟
  // **循环**，route 里的一前一后不是先后关系（趟间回边本就是文档化转换）；波次收齐后只剩串行
  // pending 时若按序号判「之前」，next 会把 currentNode 推回 execute，波次出口再也无法重跑
  // （L-060 型死结）。② currentNode 不在协议 route 内（无先后可比）。
  const derivedIdx = routeIds.indexOf(derivedNode);
  const insideExecuteFamily = EXECUTE_FAMILY_NODE_IDS.has(derivedNode)
    && EXECUTE_FAMILY_NODE_IDS.has(state.currentNode);
  const derivedIsAfterCurrent = currentNodeIdx < 0
    || insideExecuteFamily
    || (derivedIdx >= 0 && derivedIdx > currentNodeIdx);
  const routingSuccessorProtects = !!(completedArr.length > 0
    && routingSuccessorOfCurrent !== null
    && routingSuccessorOfCurrent === derivedNode
    && derivedIsAfterCurrent);
  const derivedIsDirectSuccessor = currentNodeIdx >= 0
    && currentNodeIdx + 1 < routeIds.length
    && routeIds[currentNodeIdx + 1] === derivedNode;
  const derivedIsSuccessor = routingSuccessorProtects || derivedIsDirectSuccessor;
  const inProgress = !!(
    state.currentNode
    && !completedArr.includes(state.currentNode)
    && (currentNodeEntered
      || (currentNodeEvidence && typeof currentNodeEvidence === 'object' && !Array.isArray(currentNodeEvidence)))
    && derivedIsSuccessor
  );
  // Fix 受控归位（同一事实同一说法）：next 的 FIX-BATCH 分支在共享视图之前返回并打印归位目标，
  // status 只走共享视图 ⇒ 同一 state 下两条命令报不同节点，且 status 会叫人 exit 一个正在被
  // Fix 批次门禁拦下的源节点（C1）。此处只读消费同一决策（纯读：不写盘、不计轮次），命中即把
  // 归位目标作为路由视图——它是 next 的 NODE 行会打印的节点。
  const fixRollback = await resolveFixRollbackDecision({
    runRoot: runRootDir(),
    changeName,
    protocol,
    completedNodes: completedArr,
    currentNode: state.currentNode,
    history: state.history,
  });
  const fixRollbackTarget = fixRollback === null ? null : fixRollback.target;
  return {
    derivedNode,
    stateNode: state.currentNode ?? null,
    // Fix 归位优先于进行中保护：保护输出的是源节点，而归位态下源节点的动作（exit）会被拦下。
    routeNode: fixRollbackTarget ?? (inProgress ? state.currentNode : derivedNode),
    inProgress,
    fixRollbackTarget,
  };
}

// 人读诊断（status）：JSON 块之后的一行三视图对账——derived = 产物推导、state = state 原值、
// route = 路由视图（= next 的 NODE）；进行中时点名「先 exit」的恢复动作；Fix 归位态点名「先按
// next 的 FIX-BATCH 归位」——此时源节点的 exit 会被 Fix 批次门禁拦下，指引不得指向它。
// 前缀严格为 `ROUTE: `。
function formatRouteLine(view) {
  const tail = view.fixRollbackTarget
    ? '；Fix 批次：先按 next 的 FIX-BATCH 归位 ' + view.fixRollbackTarget + ' 并跑完其出口'
    : (view.inProgress
      ? '；进行中：' + view.stateNode + ' 已 entry 未 exit——先 exit ' + view.stateNode + ' 再推进'
      : '');
  return 'derived=' + (view.derivedNode ?? 'null') + '（产物推导）'
    + ' state=' + (view.stateNode ?? 'null') + '（state 原值）'
    + ' route=' + (view.routeNode ?? 'null') + '（路由视图）'
    + tail;
}

// 人读诊断（next）：为什么停在这个节点。三种停留原因在同一实现里各有一段文案：
//   · Fix 受控归位——归位目标待跑出口（源节点此时 exit 会被 Fix 批次门禁拦下，指引不得指向 exit）；
//   · 进行中——已 entry 未 exit（保护生效），动作是 exit 本节点；
//   · 其余——产物推导。
// 共享节点视图路径与 Fix 归位分支都经本函数：同源不只在 NODE 行，解释行也是同一段文案
// （回程分支仍不打印——它的 RETURN 行就是解释，且源节点的 exit 合法）。
function printWhyLine(view) {
  if (view.routeNode === null) return;
  let reason;
  if (view.fixRollbackTarget) {
    reason = 'Fix 批次归位 ' + view.fixRollbackTarget
      + (view.stateNode ? '（源节点 ' + view.stateNode + '）' : '')
      + '——先跑 ' + view.fixRollbackTarget + ' 四类出口，再回源节点 exit';
  } else if (view.inProgress) {
    reason = '停在 ' + view.routeNode + '——已 entry 未 exit（进行中保护），先 exit ' + view.routeNode + ' 再推进';
  } else {
    reason = '产物推导指向 ' + view.routeNode + '（无进行中节点）';
  }
  console.log('WHY: ' + reason);
}

// 结构预检提示的命令段（单一实现，两个运行期输出面共用：next 与 handoff result）：--preflight 只跑
// 结构性门禁（不写 state、不写提示账本、不推进状态），它**不是**节点收尾的预演——完整 exit（不带
// --apply）才是全链预演。两句必须同行，否则同一个 PREFLIGHT 会被读成两条命令。节点由
// 调用方按**路由视图**传入（与 NODE 行同源），不得取 state 原值：Fix 归位态下源节点的 exit 会被
// Fix 批次门禁拦下。
export function structuralPreflightHint(nodeId) {
  // 命令文本与 handoff result 的 PREFLIGHT 走同一实现（scriptCommand）：平台化脚本根 + 整条
  // 路径加引号——裸脚本名在 codex / dsh 单平台安装上照抄会落空（pathReplacements 只处理 .md）。
  return '可运行 ' + scriptCommand({
    scriptsDir, runRoot: runRootDir(), script: 'workflow-guard.mjs', args: ['exit', nodeId, '--preflight'],
  }) + ' 做结构预检（只跑结构性门禁，不写 state、不推进状态）；完整 exit（不带 --apply）是节点收尾的全链预演';
}

// 预检提示（next）：只在 execute / subagent-execute 路由上打印——让每任务的模板结构反馈前移到
// 任务收尾，而不是攒到节点出口。贴什么命令、两句如何分工见 structuralPreflightHint（单一实现）。
function printPreflightLine(nodeId) {
  if (!nodeId || !EXECUTE_FAMILY_NODE_IDS.has(nodeId)) return;
  console.log('PREFLIGHT: ' + structuralPreflightHint(nodeId));
}

// init <change-id> [--branch-prefix <prefix>] [--init-context|--init-skip]
// protocolPath = 入口 resolveProtocol 解析出的协议路径（协议来源绑定的持久化取值）
export async function runInit(protocol, argv, protocolPath) {
  const changeName = argv[3];
  if (!changeName) throw new Error('init requires a change name.');
  // trim 后校验:带前导/尾随空白的输入(如 " --help")不得绕过 flag 检测;
  // 纯空白与缺参同义
  const normalizedChangeName = changeName.trim();
  if (!normalizedChangeName) throw new Error('init requires a change name.');
  // 参数误用防护:以 -- 开头的参数(如 --help)是选项不是 change 名——报错并提示用法,
  // 防止被当作 change id 执行(自动开 change、建分支、写状态——有破坏性)
  if (normalizedChangeName.startsWith('--')) {
    throw new Error('init: ' + normalizedChangeName + ' looks like a flag, not a change name. Usage: workflow-state.mjs init <change-id> [--branch-prefix <prefix>] [--init-context|--init-skip]');
  }
  // --branch-prefix <prefix>（缺省 'change/'）；--init-context / --init-skip（自动初始化检测授权）
  let branchPrefix = 'change/';
  let initContext = false;
  let initSkip = false;
  const initArgs = argv.slice(4);
  for (let i = 0; i < initArgs.length; i++) {
    if (initArgs[i] === '--branch-prefix') {
      const value = initArgs[i + 1];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error('--branch-prefix requires a non-empty prefix (e.g. feat/)');
      }
      branchPrefix = value.trim().endsWith('/') ? value.trim() : value.trim() + '/';
    } else if (typeof initArgs[i] === 'string' && initArgs[i].startsWith('--branch-prefix=')) {
      const value = initArgs[i].slice('--branch-prefix='.length);
      if (value === '') {
        throw new Error('--branch-prefix requires a non-empty prefix (e.g. feat/)');
      }
      branchPrefix = value.endsWith('/') ? value : value + '/';
    } else if (initArgs[i] === '--init-context') {
      initContext = true;
    } else if (initArgs[i] === '--init-skip') {
      initSkip = true;
    }
  }
  // 自动初始化检测（前置步骤）：读旧 state（项目级字段跨 change 保留）→ 探测 → 判决 → 提示/执行
  // 生成职责：--init-context 时 CONTEXT 缺失 → 输出 INIT-GENERATE 指引，由 agent 全量阅读生成
  // （intel-scan 语义）；生成后重跑 → 脚本校验 7 段结构 → 通过写 last_intel_scan（确定性校验）。
  let prevState = null;
  try { prevState = await readState(); } catch { prevState = null; }
  const probe = await probeProject(runRootDir(), prevState);
  const verdict = classify(probe, prevState);
  let ctxValid = null; // null=未进入校验（非 init-context 或已新鲜）；true/false=校验结果
  if (initContext || initSkip) {
    // 显式授权路径：--init-context 生成协作（agent 生成 + 脚本校验）；--init-skip 记 none
    if (initContext) {
      // 显式 --init-context 总是校验结构（含 verdict=skip 新鲜/记忆场景）——防 CONTEXT 损坏漏检
      let ctxExists = false;
      try { await fs.access(path.join(specsDir(), 'CONTEXT.md')); ctxExists = true; } catch { /* 文件不存在 */ }
      if (ctxExists) {
        const { missingSections, formatIssues } = await validateContext(runRootDir());
        if (missingSections.length === 0 && formatIssues.length === 0) {
          ctxValid = true;
          if (verdict === 'skip') {
            console.log('INIT-DONE: 项目上下文已存在且新鲜，跳过生成。');
          } else {
            console.log('INIT-DONE: 项目上下文（CONTEXT.md）已就绪（7 段 + 模板格式校验通过）。');
          }
        } else {
          // 存在但不满足模板（缺段/格式不符/损坏）——引导 agent 重写（保留既有累积内容）
          const problems = [...formatIssues, ...missingSections.map((s) => '缺段 ' + s)];
          await printGenerationGuide(runRootDir(), probe, { rewrite: true, problems });
        }
      } else if (verdict !== 'skip') {
        await printGenerationGuide(runRootDir(), probe);
      }
      // verdict=skip（记忆 A 拒绝 / 新鲜 B）且 CONTEXT 缺失 → 尊重既有决策，不输出
    }
    if (initSkip && !initContext) {
      console.log('INIT-SKIPPED: 已记录跳过初始化。');
    }
  } else {
    await printDetection(runRootDir(), probe, verdict);
  }
  // init 同 id 重跑防护——.specs/<id>/ 已存在或 activeChange 相同 → WARN 不阻断
  //（向后兼容；正常流程 init 只在 open 前执行一次，防护针对误操作清空进度）
  let specsDirExists = false;
  try { await fs.access(path.join(specsDir(), changeName)); specsDirExists = true; } catch { /* 目录不存在 */ }
  if (prevState?.activeChange === changeName || specsDirExists) {
    console.error('WARN: change ' + changeName + ' 已存在——重跑 init 将重置节点状态（completedNodes/evidence 清空）。若需继续已有 change，请用 advance/select 而非重跑 init。');
  }
  // E1: branchMode 自动判定——git 仓库（cwd=runRoot）→ true；非 git 仓库 → false
  const branchMode = isInsideWorkTree();
  const state = {
    activeChange: changeName,
    // 协议来源绑定：init 解析出的协议路径持久化（项目根相对 POSIX；旧 state 缺字段 = 未绑定，
    // 归属/节点门禁按渐进语义回退环境变量/默认协议）
    protocolPath: toPersistedProtocolPath(runRootDir(), protocolPath),
    // currentNode 取协议首节点（内置协议 = open，行为不变；自定义协议 = 首节点，如 brainstorm）
    currentNode: route(protocol)[0]?.id ?? 'open',
    completedNodes: [],
    evidence: {},
    verifyFailures: 0,
    // verifyFailures 按 change 存储——init 新 change 从零计数(切换 change 不串扰)
    verifyFailuresByChange: {},
    // Fix 受控归位轮次按 change 存储——init 写空对象；旧 state 缺字段按 0 读取
    fixRoundsByChange: {},
    executionMode: 'subagent',
    directOverride: false,
    branchMode,
    enablePrReview: false,
    branchPrefix,
    status: 'running',
    // 新 change 标记——init 即新 change(严格模式开启,不依赖 entry;旧 change 无此字段渐进兼容)
    newChange: true,
    // 进入证据容器——entry 追加节点;未 entry 检测(新 change 强制)
    enteredNodes: [],
    createdAt: new Date().toISOString(),
    // 项目级上下文字段跨 change 保留（迁移旧 state；--init-context 刷新扫描时间；--init-skip 记拒绝）
    ...(prevState?.ai_context_doc !== undefined ? { ai_context_doc: prevState.ai_context_doc } : {}),
    ...(initSkip ? { ai_context_doc: 'none' } : {}),
    // last_intel_scan 仅在校验通过后写入（agent 生成 → 脚本校验 7 段 → 记录扫描时间）；形态一律经
    // time-utils 的 nowTimestamp()（本地时间 + 显式偏移）——与 context-scan 的落点形态同源，不在本
    // 模块内联第二份格式化。段侧**不在本命令的写面内**（该段行的改写与备份只有 context-scan 一份
    // 实现）：两处取值不一致由 reportIntelScanDrift 检出并给出可见提示，不静默漂移。
    ...(ctxValid === true
      ? { last_intel_scan: nowTimestamp() }
      : (prevState?.last_intel_scan !== undefined ? { last_intel_scan: prevState.last_intel_scan } : {})),
    // last_evolve_at 同为**项目级**字段（evolve 的跨 change 基线，写通道 = config set）——init 换
    // change 必须原样保留：丢了它，增量窗口静默退化为全量扫描、到期提示从此不再触发（保留判据与
    // 上一行同形：字段缺席 = 从未跑过 evolve，不得凭空制造该字段——state-schema 不接受 null）
    ...(prevState?.last_evolve_at !== undefined ? { last_evolve_at: prevState.last_evolve_at } : {})
  };
  await writeState(state);
  // 扫描时刻的双落点一致性（state ↔ `.specs/CONTEXT.md` 的 `## intel-scan 元数据` 段）：本命令写
  // state 后即比对段侧取值——不一致（含同一时刻的两种形态）输出可见提示并点名收敛命令；一致或
  // 无可比对面则静默（不误报）。段行的写通道只有 context-scan，故此处是检测、不是第二份改写实现。
  await reportIntelScanDrift(path.join(specsDir(), 'CONTEXT.md'), state.last_intel_scan);
  // init 创建 .specs/<id>/ 目录——文件即真相从 init 起成立，findActiveChange 立即可识别
  //（init 不创建该目录时，next/status 会报 No active change，与 SKILL 启动协议 init → next 矛盾）
  const specsChangeDir = path.join(specsDir(), changeName);
  await fs.mkdir(specsChangeDir, { recursive: true });
  // 分支创建——branchMode && 当前分支 ≠ <prefix><id> && 分支不存在 → git checkout -b
  // 前缀由 --branch-prefix 指定（缺省 'change/'，向后兼容；可适配仓库自身分支规范如 feat/）
  // 失败 → WARN 不 BLOCK，继续纯文件模式（向后兼容）
  const expectedBranch = branchPrefix + changeName;
  // 空仓库状态(带到 BRANCH 输出——声称与实际一致:空仓库无分支)
  let emptyRepo = false;
  if (branchMode) {
    const currentBranch = gitBranchName();
    // 空仓库检测——无提交(git rev-parse HEAD 失败)时分支创建不可行,输出提示
    // (不 BLOCK;纯文件模式继续)并跳过分支创建——警告与行为一致(跳过时 BRANCH 行
    // 若仍声称分支已创建,即与实际矛盾)
    try {
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runRootDir(), stdio: 'pipe' });
    } catch {
      emptyRepo = true;
    }
    if (emptyRepo) {
      console.error('INIT EMPTY-REPO WARN: 仓库无提交(git 空仓库),无法创建 ' + expectedBranch + ' 分支——先 git commit 初始提交再 init 启用分支模式,或继续纯文件模式');
    } else if (currentBranch !== null && currentBranch !== expectedBranch && !branchExists(expectedBranch)) {
      try {
        execFileSync('git', ['checkout', '-b', expectedBranch], { cwd: runRootDir(), stdio: 'pipe' });
      } catch {
        console.error('WARN: 创建分支 ' + expectedBranch + ' 失败——继续纯文件模式（分支功能降级；可稍后手动 git checkout -b ' + expectedBranch + '）');
      }
    }
  }
  console.log('Initialized: ' + changeName);
  console.log('BRANCH: ' + (branchMode && !emptyRepo ? expectedBranch : 'none（非 git 仓库或空仓库）'));
  // init 输出取协议首节点（与 state.currentNode 一致——内置协议 = open，行为不变）
  printNext(protocol, route(protocol)[0]?.id ?? 'open');
  return;
}

// status：只读输出当前 change 与节点（派生视图 + 分支行 + evolve 到期提示）
export async function runStatus(protocol) {
  const changeName = await findActiveChange();
  if (!changeName) {
    console.log(JSON.stringify({ status: 'no-change', message: 'No active change in .specs/' }, null, 2));
    // 到期提示属**项目级**元数据（与是否有 active change 无关）：无活跃 change 时同样按阈值输出
    await printEvolveDueHint(await readState());
    return;
  }
  const state = await readState();
  // 节点视图（与 next 共用同一判定）：currentNode 仍取产物推导（既有键语义逐字不变），
  // routeNode 才是经「进行中保护」后的路由视图（= next 的 NODE 行）。
  const nodeView = await resolveNodeView({ changeName, protocol, state });
  const detectedNode = nodeView.derivedNode;
  // 派生视图（ADR-013 决策 11；改为事件为准）：被强制推进的节点以
  // state.history 中本 change 的 advance-forced 事件为唯一判据——按 change 过滤（兼容旧事件
  // 无 change 字段），取 e.node 集合后与 completedNodes 求交。旧「completedNodes 含而 evidence
  // 不含」推断会漏报两类真实反例：① record 后被 advance；② replan/reenter 写授权留痕
  // （evidence.<node>.replanAuthorization）后被 advance。state.history === undefined 的旧 state
  // 无事件可依（advance 当时无痕）→ 回退本「缺 evidence」判据。
  const completedArr = Array.isArray(state.completedNodes) ? state.completedNodes : [];
  let forcedNodes;
  if (state.history === undefined) {
    const evidenceMap = state.evidence && typeof state.evidence === 'object' && !Array.isArray(state.evidence)
      ? state.evidence
      : {};
    forcedNodes = completedArr.filter((id) => {
      const record = evidenceMap[id];
      return !(record && typeof record === 'object' && !Array.isArray(record));
    });
  } else {
    const forcedSet = new Set(
      (Array.isArray(state.history) ? state.history : [])
        .filter((e) => e
          && e.event === 'advance-forced'
          && (typeof e.change !== 'string' || e.change === changeName))
        .map((e) => e.node)
    );
    forcedNodes = completedArr.filter((id) => forcedSet.has(id));
  }
  console.log(JSON.stringify({
    status: 'running',
    change: changeName,
    currentNode: detectedNode,
    stateCurrentNode: state.currentNode,
    // 增量字段：next 会打印的路由视图（进行中保护后的节点）；不写 state、既有键语义不变
    routeNode: nodeView.routeNode,
    completedNodes: state.completedNodes,
    forcedNodes,
    executionMode: state.executionMode ?? 'subagent',
    directOverride: state.directOverride ?? false,
    branchMode: isInsideWorkTree(),
    enablePrReview: state.enablePrReview ?? false,
    artifactRoot: '.specs/' + changeName,
    // 与 routeNode 同一判定（One predicate）：本键回答「协调者模式是否生效」，必须指向路由视图
    // 那个节点——若另取产物推导，进行中态会在同一响应里给出两个「当前节点」口径（routeNode=
    // execute 而 coordinatorMode=false）。既有键名/类型/位置不变，只换判定来源。
    coordinatorMode: EXECUTE_FAMILY_NODE_IDS.has(nodeView.routeNode),
    // 新旧 change 标记——newChange true = 新 change(严格模式);false/缺失 = 旧 change(渐进)
    newChange: state.newChange === true
  }, null, 2));
  console.log('ROUTE: ' + formatRouteLine(nodeView));
  printBranchLine(changeName, state.branchPrefix ?? 'change/');
  await printEvolveDueHint(state);
  return;
}

// next：下一节点与技能（含 Fix 回退 / 回程 / 漂移校正分支）
export async function runNext(protocol) {
  const changeName = await findActiveChange();
  if (!changeName) {
    console.log('NEXT: done');
    console.log('MESSAGE: No active change. Run: node workflow-state.mjs init <change-name>');
    return;
  }
  const state = await readState();
  const completedArr = Array.isArray(state.completedNodes) ? state.completedNodes : [];
  // Fix 回退显式分支——必须早于「疑似未 exit」门禁与进行中漂移保护：
  // review/verify 驻留 + TASK 有 pending 修复任务（串行/并行）或未闭合家族出口签名时，把工作
  // 归属受控归位共享谓词返回的 execute 家族目标（写盘）并显式输出 NODE: <目标>，不再依赖
  // inProgress 保护副作用（否则并行任务 next 输出仍停在源节点）。判定复用 route-node 共享纯函数。
  const fixRollbackDecision = await resolveFixRollbackDecision({
    runRoot: runRootDir(), changeName, protocol, completedNodes: completedArr, currentNode: state.currentNode,
    history: state.history,
  });
  if (fixRollbackDecision) {
    const sourceNode = state.currentNode;
    // 轮次计数与阈值/授权判定全部走共享 helper：分支②不计数；第 4 轮新 change 先 BLOCK
    // （此处尚未写盘，满足不写 currentNode），旧 change WARN 后照常归位。
    const rollbackRound = applyFixRollbackRound({ state, sourceNode, decision: fixRollbackDecision });
    if (rollbackRound.blocked) {
      console.error(rollbackRound.blockedMessage);
      process.exit(1);
    }
    if (rollbackRound.warn) console.error(rollbackRound.warnMessage);
    state.currentNode = fixRollbackDecision.target;
    await writeState(state);
    console.log('FIX-BATCH: 归位 ' + fixRollbackDecision.target + '（源节点 ' + sourceNode + '）' + rollbackRound.auditSuffix);
    printNext(protocol, fixRollbackDecision.target, state.executionMode ?? 'subagent');
    // 解释行与共享视图同一实现（printWhyLine）：status 的 routeNode 与这行点名的节点是同一事实。
    printWhyLine({
      routeNode: fixRollbackDecision.target,
      stateNode: sourceNode,
      inProgress: false,
      fixRollbackTarget: fixRollbackDecision.target,
    });
    printPreflightLine(fixRollbackDecision.target);
    printBranchLine(changeName, state.branchPrefix ?? 'change/');
    return;
  }
  // Fix 回程豁免——exit execute --apply 二次完成把 currentNode 回推源节点后，
  // 源节点产物（REVIEW.md / TEST.md+UAT.md）已在场会让 resolveNextNode 跳过尚未 exit 的
  // 源节点；仅当源节点未完成、任务全 done、firstIncompletePostExecNode === currentNode
  // 且 resolveNextNode 确实会跳过该节点时显式放行（只读不改写 state）。artifactNext ===
  // currentNode 的形态落回既有正常逻辑（normalAdvanceExempt 覆盖），不放宽豁免面。
  const fixReturnNode = state.activeChange
    ? await resolveFixReturnNode({ runRoot: runRootDir(), changeName, protocol, completedNodes: completedArr })
    : null;
  if (fixReturnNode !== null && fixReturnNode === state.currentNode) {
    const artifactNext = await resolveNextNode({ runRoot: runRootDir(), changeName, protocol, completedNodes: completedArr });
    const routeIds = route(protocol).map((node) => node.id);
    const artifactNextIdx = routeIds.indexOf(artifactNext);
    const currentIdx = routeIds.indexOf(state.currentNode);
    // 「跳过」必须是产物存在性把路由推到源节点之后；artifactNext 落在源节点之前（如 execute
    // 产物缺失时回退到 execute）不是合法回程态，落回既有门禁，防止越界放宽（既有门禁反例锚）。
    const skipsForward = artifactNext !== state.currentNode
      && currentIdx >= 0
      && artifactNextIdx > currentIdx;
    if (skipsForward) {
      console.log('RETURN: 回程源节点 ' + fixReturnNode + '（源节点产物在场且未出口；保留源节点跑出口）');
      printNext(protocol, state.currentNode, state.executionMode ?? 'subagent');
      printBranchLine(changeName, state.branchPrefix ?? 'change/');
      return;
    }
  }
  // 节点顺序校验（严格模式）——state.currentNode 非 null、不在 completedNodes、
  // 且 evidence 无该节点记录 → 上一节点从未 exit 就推进 → BLOCKED（exit 1）。
  // 状态漂移校正保留：已完成节点（currentNode ∈ completedNodes，或 evidence 已记录——
  // 节点已被 record/exit 处理过）正常推进不受影响；本校验只拦"证据完全缺失的疑似跳阶段"。
  // 豁免（两种独立判断，任一成立即放行）：回退豁免（TASK.md 有 pending 回退修复任务 → execute）；
  // 正常推进豁免（currentNode 是 completedNodes 最后节点 exit 推进的正常下一节点，
  // 见 normalAdvanceExempt）——真乱序（跳节点）仍严格 BLOCK
  if (state.currentNode && !completedArr.includes(state.currentNode)) {
    const nodeEvidence = state.evidence && typeof state.evidence === 'object'
      ? state.evidence[state.currentNode]
      : null;
    const hasEvidence = !!(nodeEvidence && typeof nodeEvidence === 'object' && !Array.isArray(nodeEvidence));
    if (!hasEvidence) {
      // 回退豁免（显式分支已先行；此处按共享谓词保留门禁层语义，不再内联第二份判定）——
      // review/verify 发现缺陷追加 pending 修复任务后回 execute 的修复任务标准回退路径放行
      // （否则被严格模式误拦为"未 exit 跳阶段"）；豁免条件不满足时维持严格 BLOCK
      const rollbackExempt = await resolveFixRollbackState({
        runRoot: runRootDir(), changeName, protocol, completedNodes: completedArr, currentNode: state.currentNode,
        history: state.history,
      });
      // 正常推进豁免——exit --apply 推进 currentNode 到下一节点后按 SKILL 协议调 next
      // （正常路径）不拦截；与回退豁免独立判断（详见 normalAdvanceExempt 注释）
      const advanceExempt = await normalAdvanceExempt(state, protocol, completedArr, state.currentNode, changeName);
      if (!rollbackExempt && !advanceExempt) {
        console.error('BLOCKED: 疑似未 exit 节点 ' + state.currentNode + '，先 workflow-guard.mjs exit ' + state.currentNode + ' --apply');
        console.error('恢复: 确认当前节点实际已完成 → 用 exit <节点> --apply 正常推进；节点状态漂移/卡死 → 用 workflow-state.mjs advance（强制推进）或 select（切换 change）；禁止手改 state 机器字段');
        process.exit(1);
      }
    }
  }
  // 节点视图（与 status 共用同一「进行中保护」判定，见 resolveNodeView）：derivedNode 供零进展
  // 防呆与漂移校正使用，routeNode 才是输出节点（next 的 NODE 行）。
  const nodeView = await resolveNodeView({ changeName, protocol, state });
  const detectedNode = nodeView.derivedNode;
  // 单趟零进展防呆（三重防呆决策之二·状态机侧）：路由落在 execute/subagent-execute，但既无可委托的并行任务
  // （依赖已满足集合为空）又无串行 pending，且 TASK 未全 done——剩余 pending 全部是依赖无法满足的
  // 孤儿并行任务（数据异常：depends_on 引用不存在的任务 id 或执行期出现依赖环）→ BLOCKED，
  // 防止静默路由到无法推进的节点造成死循环/死等。协议无 subagent-execute 节点时不适用
  // （parallel 任务由 execute 直接消化，无孤儿语义）。依赖环的常规拦截点在 plan 出口（guard 前置），
  // 此处兜底执行期数据异常（如手改 TASK 绕过签名校验的极端态）。
  if (EXECUTE_FAMILY_NODE_IDS.has(detectedNode)) {
    if (hasSubagentNode(protocol)) {
      try {
        const zpBlocks = taskBlocks(await fs.readFile(protocolTaskFilePath(protocol, changeName, specsDir()), 'utf8'));
        const zpAttrs = zpBlocks.map(taskOpeningAttrs).filter(Boolean);
        const zpPending = zpAttrs.filter((a) => a.status === 'pending');
        if (zpPending.length > 0) {
          const zpDoneIds = new Set(zpAttrs.filter((a) => a.status === 'done' && a.id).map((a) => a.id));
          const zpEligible = zpBlocks.filter((block) => {
            const a = taskOpeningAttrs(block);
            if (!a || !a.parallel || a.status !== 'pending') return false;
            const depsMatch = block.match(/<depends_on>([\s\S]*?)<\/depends_on>/);
            if (!depsMatch || !depsMatch[1].trim()) return true;
            return depsMatch[1].trim().split(/[,\s]+/).filter(Boolean).every((d) => zpDoneIds.has(d));
          });
          const zpSerial = zpPending.filter((a) => !a.parallel);
          if (zpEligible.length === 0 && zpSerial.length === 0) {
            console.error('BLOCKED: 路由零进展——既无可委托的并行任务（依赖已满足集合为空）也无串行 pending，但 TASK 尚有 ' + zpPending.length + ' 个未完成任务');
            console.error('疑似孤儿并行任务依赖无法满足（检查 depends_on）：' + zpPending.map((a) => a.id).join(', ') + '——修正 depends_on 为真实存在且无环的任务 id 后重试；执行期出现此异常请核对 TASK.md 是否被手改');
            process.exit(1);
          }
        }
      } catch {}
    }
  }
  // 状态漂移自动校正——以文件产物为准（determineNode）校正 state.currentNode。进行中节点不校正
  // （已 entry / 已 record 且未 exit、路由仍在其后继）：判定统一在 resolveNodeView 内，本命令不再
  // 内联第二份（与 status 共用；被拦截节点若被推走，其 exit 前置 currentNode 校验无法重跑 → 死结）。
  if (!nodeView.inProgress && state.currentNode !== detectedNode) {
    state.currentNode = detectedNode;
    await writeState(state);
  }
  // 输出跟随路由视图：进行中时输出 state.currentNode（而非产物推导——否则 state 保持 review 但
  // 输出 NODE: verify，执行者按输出 action 仍然死结）；非进行中即产物推导节点。
  const printNode = nodeView.routeNode;
  printNext(protocol, printNode, state.executionMode ?? 'subagent');
  printWhyLine(nodeView);
  printPreflightLine(printNode);
  printBranchLine(changeName, state.branchPrefix ?? 'change/');
  return;
}

// select <change-id>：切换 activeChange（目录边界 + 名字逐字相等）
export async function runSelect(protocol, argv) {
  const changeName = argv[3];
  if (!changeName) throw new Error('select requires a change name.');
  // change 名必须是 .specs/ 下的单段目录名（形态单一权威在 route-node.mjs）：拒绝路径分隔符、
  // . / .. 与保留目录 archive（归档区不是活跃 change）——多段路径会把归档目录等非 change
  // 目录选成 activeChange，进而污染后续命令的 change 归属与轮次派生。
  if (!isSingleSegmentChangeName(changeName)) {
    throw new Error('select change 名必须是 .specs/ 下的单段目录名（拒绝路径分隔符、. / .. 与保留目录 archive）: '
      + JSON.stringify(changeName));
  }
  const changeDir = path.join(specsDir(), changeName);
  // 目录必须真实存在且不是 symlink/junction、realpath 归一后仍在 .specs/ 内（复用路径段扫描
  // 单一权威）；越界 / 链接形态一律拒绝，不把非真实目录选为 activeChange。
  let inspection;
  try {
    inspection = await inspectWorkflowPathSegments(specsDir(), changeDir, 'select change dir', 'directory');
  } catch (error) {
    throw new Error('Change not found or path unsafe: ' + changeDir + '（' + (error && error.message ? error.message : error) + '）');
  }
  if (!inspection.exists) throw new Error('Change not found: ' + changeDir);
  // 名字必须与 .specs/ 下真实目录条目逐字相等：大小写/空白变体（如 .specs/ch 用 'CH' 选中）
  // 在大小写不敏感文件系统上同样可达，但会把 activeChange 存成变体字符串——轮次事件按
  // activeChange 精确匹配（配额被换键重置）。名字变体一律拒绝，不得改写 activeChange。
  if (!(await hasExactSpecsEntry(changeName))) {
    throw new Error('select change 名必须与 .specs/ 下真实目录名逐字相等（大小写/空白变体会使 activeChange 与实际目录不一致）: '
      + JSON.stringify(changeName));
  }
  const state = await readState();
  state.activeChange = changeName;
  if (!state.currentNode) state.currentNode = await determineNode(changeName, protocol, state.completedNodes);
  await writeState(state);
  console.log('Selected: ' + changeName);
  return;
}

// record <node> <payload>：写证据（技能加载声明标记校验 + 前置门 + 旧 change 自动补写）
export async function runRecord(protocol, argv) {
  const nodeId = argv[3];
  if (!nodeId) throw new Error('record requires a Node id.');
  const state = await readState();
  state.evidence = state.evidence || {};
  // 解析 JSON 参数并展开到 evidence 顶层（summary/completedChecks/output-schema evidence 等）；
  // 若不可解析则作为 summary 字符串
  // payload 解析前剥离 --protocol（及 --protocol=<p>）——resolveProtocol 已全局提取协议路径，
  // 此处仅防其拼入 payload 导致 JSON 解析失败（结构字段丢失）
  // --json-file <path>（或 --json-file=<path>）：从文件读 JSON payload——规避 Windows
  // PowerShell 传参剥离内嵌双引号导致 JSON 损坏（record 存成 {summary:...} 脏数据）
  let parsed = {};
  let jsonFile = null;
  const payloadArgs = [];
  const recordArgs = argv.slice(4);
  for (let i = 0; i < recordArgs.length; i++) {
    const arg = recordArgs[i];
    if (arg === '--protocol') { i += 1; continue; }
    if (typeof arg === 'string' && arg.startsWith('--protocol=')) continue;
    if (arg === '--json-file') {
      jsonFile = recordArgs[i + 1];
      i += 1;
      continue;
    }
    if (typeof arg === 'string' && arg.startsWith('--json-file=')) {
      jsonFile = arg.slice('--json-file='.length);
      continue;
    }
    payloadArgs.push(arg);
  }
  const raw = jsonFile !== null
    ? await fs.readFile(await resolveJsonFileWithinRunRoot(jsonFile), 'utf8')
    : payloadArgs.join(' ');
  // 契约解析失败判定（单一来源）：looksLikeObjectLiteral 由 state-schema.mjs 导出——
  // trim 后以 {/[ 开头 → 视作"形似对象字面量"；若 JSON.parse 失败 → fail-closed。
  try {
    parsed = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== 'object' || Array.isArray(parsed)) parsed = { summary: String(parsed) };
  } catch {
    // 契约解析失败 fail-closed:payload 形似对象但 JSON.parse 失败 → 报错并
    // process.exit(1),不写 evidence——防状态污染（旧语义把不可解析 raw 静默作
    // summary 字符串落库 = 静默落脏）
    // 消息按参数来源分级:--json-file 传入且文件内容损坏 →
    // "文件内容不是合法 JSON" + 长度元数据;内联传参损坏 → 保留 --json-file 建议。
    // 安全:错误消息只含固定前缀 + 长度元数据,绝不打印 raw 内容(含截断)。
    if (looksLikeObjectLiteral(raw)) {
      if (jsonFile !== null) {
        console.error('文件内容不是合法 JSON (length=' + String(raw ?? '').length + ')');
      } else {
        console.error('payload looks like an object literal but is not valid JSON (length=' + String(raw ?? '').length + '); use --json-file <path> to pass the payload');
      }
      process.exit(1);
    }
    parsed = { summary: raw || 'recorded' };
  }
  // 载荷形状校验（写入前 fail-closed；判定单一来源 = state-schema.evidencePayloadProblems）：
  // 类型错误的载荷不得落库——否则下游出口门禁只会报「缺 evidence: <schema>」，出错的是 record、
  // 报错的却是 exit，执行者得自己反推载荷该写什么形状。故在此拦下：点名字段路径与当前类型，
  // 给出可照抄的正确形态；只判类型/非空，取值是否合法（扫描份数、提名编号是否登记）仍归出口门禁。
  const shapeProblems = evidencePayloadProblems(parsed);
  if (shapeProblems.length > 0) {
    console.error('ERROR: record 载荷形状不合法（写入前拒绝，state 未改写）:');
    for (const problem of shapeProblems) {
      console.error('  ' + problem.field + ': ' + problem.message);
    }
    console.error('恢复: ' + scriptCommand({
      scriptsDir,
      runRoot: runRootDir(),
      script: 'workflow-state.mjs',
      args: ['record', nodeId, `'{"summary":"<本节点完成摘要>"}'`],
    }) + ' 用类型合法的载荷重试（summary 为非空字符串；completedChecks 为字符串数组；'
      + 'lessonsNomination 为 { scanned, nominated[], reasonIfNone }，nominated 元素是条目编号字符串）'
      + '；载荷里的引号被 shell 吞掉时改用 --json-file <path> 传入 JSON 文件'
      + '（cmd.exe 请把单引号换成双引号，并转义载荷里原有的双引号）');
    process.exit(1);
  }
  // completedChecks 真实性校验（skill-load 声明标记）——解析本次 record 写入的
  // completedChecks 的 required-skill:<node>.<skill> 条目 → 对应声明标记必须存在，
  // 缺失 → BLOCKED + 指引先加载 skill 并运行 skill-load；标记 at 必须 ≤ 本次记录时间
  // （交叉自洽：标记先于记录声明）。仅校验本次写入的 payload，旧 evidence 不追溯（旧 change 兼容）。
  const recordedAt = new Date().toISOString();
  // 标记归属 change 与 evidence 一致：优先 state.activeChange，缺失时回退 findActiveChange（与
  // 下方 NEXT 推导同语义）；两者皆无 → verifySkillLoadMarkers 内 fail-closed BLOCK。
  // 传入 protocol + state——按 requiredSkillCalls scope 分类条目（handoff scope 豁免标记，
  // 以共用证据库 handoffResult 为证据）
  const markerChange = state.activeChange || await findActiveChange();
  const markerCheck = await verifySkillLoadMarkers(parsed.completedChecks, markerChange, recordedAt, protocol, state);
  if (!markerCheck.ok) {
    console.error('BLOCKED: ' + markerCheck.reason);
    process.exit(1);
  }
  // 技能加载前置门（方案 A）：节点完成记录必须先有本节点
  // skill-load 声明标记——无论 payload 是否含 completedChecks 都校验（堵"先干活后补
  // 声明"旁路）：缺失 → 新 change BLOCK / 旧 change 渐进 WARN。指引先加载技能并运行
  // skill-load 再重试。handoff scope 技能（子代理加载）不要求协调者声明（与
  // verifySkillLoadMarkers 的 scope 豁免一致）——本门按 <node>-*.json 存在性判定，
  // 与 guard exit 侧协议声明标记校验同构。仅对存在于当前协议的节点生效（协议外节点名
  // 的记录不适用前置门），无 active change 时无法定位标记而不重复报错（遗留兼容）。
  const recordNodeDef = (protocol.nodes ?? []).find((n) => n.id === nodeId);
  if (recordNodeDef && markerChange) {
    const declaredForNode = await hasNodeSkillDeclaration(nodeId, markerChange);
    if (!declaredForNode) {
      const loadGuide = '先加载技能（用 Skill 工具，禁止跳过）并运行 workflow-state.mjs skill-load ' + nodeId + ' <skill> 再重试';
      if (state.newChange === true) {
        console.error('BLOCKED: 节点 ' + nodeId + ' 缺少技能加载声明标记（.skill-loads/' + nodeId + '-*.json）——' + loadGuide);
        process.exit(1);
      }
      console.error('WARN: 节点 ' + nodeId + ' 缺少技能加载声明标记（.skill-loads/' + nodeId + '-*.json）——' + loadGuide + '（旧 change 渐进不阻断，记录继续）');
    }
    // 模板声明核对（C11）——声明标记里必须有与该节点映射一致的 templates 集合：新 change
    // 缺失 / 多写 / 漏写 / 错名 BLOCK（fail-closed，不让人「声明了但说得不对」），旧 change WARN。
    // 自定义协议节点不比对（C12）；无活动 change / 声明机制未激活时不在这里报（见该函数的边界注释）。
    const templateCheck = await verifyTemplateDeclaration({
      protocol,
      nodeId,
      changeName: markerChange,
      newChange: state.newChange === true,
    });
    if (templateCheck.warn) console.error('WARN: ' + templateCheck.warn);
    if (!templateCheck.ok) {
      console.error('BLOCKED: ' + templateCheck.reason);
      process.exit(1);
    }
  }
  // 声明自动化——record 时按协议 requiredSkillCalls 自动补写缺失的声明标记
  // (执行者无需手动 skill-load;标记如实记录"节点完成即视为其实现/协议技能已加载",
  // 由 record 代记;与手动 skill-load 标记同体系,exit 协议声明校验共用)
  // 新 change 下 required 条目停用自动补写(手动声明唯一路径,否则抵消前置门);
  // 旧 change 保留兜底(渐进兼容)。
  if (recordNodeDef && markerChange && state.newChange !== true) {
    const recordProtoFiles = NODE_PROTOCOL_FILES[nodeId] ?? [];
    // 标记目录解析:活动路径优先;change 已归档(活动目录不存在但归档目录存在)
    // 时写归档路径——防重建已归档的活动目录(归档移动语义;与 findSkillLoadsDir 双路径一致)。
    // 跳过条件:活动与归档均无 .skill-loads **且活动 change 目录已不存在**(归档移动后)
    // ——此时 writeJsonAtomic 的 mkdir recursive 会把已归档的活动目录残留回来;
    // 活动 change 目录仍存在(正常流程)时创建 .skill-loads 子目录是自动补写的正常职责,不跳过
    const activeLoadsDir = path.join(specsDir(), markerChange, '.skill-loads');
    let targetLoadsDir = activeLoadsDir;
    if (!(await fileExists(activeLoadsDir))) {
      const archived = await findSkillLoadsDir(markerChange);
      if (archived !== null && archived.dir !== activeLoadsDir) {
        targetLoadsDir = archived.dir;
      } else if (archived === null && !(await fileExists(path.join(specsDir(), markerChange)))) {
        targetLoadsDir = null;
      }
    }
    if (targetLoadsDir !== null) {
      for (const binding of recordNodeDef.requiredSkillCalls ?? []) {
        // handoff scope 技能由子代理加载(协调者不声明)——不自动补协调者标记
        if (binding.scope === 'handoff') continue;
        const markerFile = path.join(targetLoadsDir, nodeId + '-' + binding.skill + '.json');
        let markerExists = false;
        try { await fs.access(markerFile); markerExists = true; } catch { /* 标记不存在 */ }
        if (!markerExists) {
          // 自动补的 protocol 字段按 skill 归属协议文件(如 open 的 requirement 标记应写
          // 1-requirement.md 而非节点首文件 0-change.md——所有 skill 都写首文件会让
          // 标记的协议归属语义错误;exit 校验只查归属集合故能通过,但标记不可信)
          const skillProtoFiles = SKILL_PROTOCOL_FILES[binding.skill] ?? [];
          await writeJsonAtomic(markerFile, {
            node: nodeId,
            skill: binding.skill,
            protocol: skillProtoFiles.length > 0 ? skillProtoFiles[0] : null,
            at: recordedAt,
            auto: true,
          });
        }
      }
    }
  }
  state.evidence[nodeId] = {
    ...(state.evidence[nodeId] || {}),
    ...parsed,
    recordedAt,
  };
  await writeState(state);
  console.log('EVIDENCE: ' + nodeId);
  // 节点视图与 next / status 同源（L-067 族）：record 也是「我现在该在哪个节点」的输出面。直接取
  // 产物推导会让三面在**进行中保护**生效时分叉（record 报 review，而 next / status.routeNode 报
  // execute）——故复用 resolveNodeView 的 routeNode：本命令不自持第二份判定，也不改变自己的写面
  // （record 只写证据，不写 currentNode，视图是纯读）。
  const changeName = state.activeChange || await findActiveChange();
  const nodeView = changeName ? await resolveNodeView({ changeName, protocol, state }) : null;
  printNext(protocol, nodeView?.routeNode ?? null, state.executionMode ?? 'subagent');
  return;
}

// advance：强制推进（append-only 审计事件 + 跳过出口门禁的可见性）
export async function runAdvance(protocol) {
  const state = await readState();
  if (!state.activeChange) {
    console.log('No active change. Use select first.');
    return;
  }
  // 被强制推进的节点 = 推进前的 currentNode：exit 门禁未跑（无出口证据），这正是留痕与
  // 可见性的依据（ADR-013 决策 10/11）。advance 的推进语义保持不变，但每次使用都必须写
  // 审计事件并在输出显式列出被跳过的出口门禁。
  const forcedNode = state.currentNode;
  const forcedNodeId = typeof forcedNode === 'string' && forcedNode !== '' ? forcedNode : null;
  if (!state.completedNodes.includes(state.currentNode)) {
    state.completedNodes.push(state.currentNode);
  }
  // Use determineNode to get the actual next node (reads TASK.md)
  const detected = await determineNode(state.activeChange, protocol, state.completedNodes);
  state.currentNode = detected;
  if (forcedNodeId !== null) {
    // append-only 审计事件：change 供跨 change 检索，skipped 标识被跳过的出口门禁
    // （exit:<node>），reason 固定 'advance'（本 CLI 无其它原因面）。
    const existingHistory = Array.isArray(state.history) ? state.history : [];
    state.history = existingHistory.concat([{
      event: 'advance-forced',
      change: state.activeChange,
      node: forcedNode,
      skipped: ['exit:' + forcedNode],
      reason: 'advance',
      at: new Date().toISOString(),
    }]);
  }
  await writeState(state);
  console.log('Advanced to: ' + state.currentNode);
  if (forcedNodeId !== null) {
    console.log('ADVANCE-AUDIT: 跳过 ' + forcedNodeId + ' 的 exit 门禁；该节点无出口证据');
  }
  return;
}
