// 节点完成判定族（单一归属）：determineNode 的数据化委派与「正常推进豁免」判定。
import { route, resolveNextNode } from '../route-node.mjs';
import { runRootDir } from './state-io.mjs';

// 节点完成判定 · determineNode 数据化：完成标志从协议 outputSchemas 推导。
// 判定核心在共享模块 route-node.mjs——本函数保持既有签名与返回语义，仅委托 resolveNextNode
// （output 与抽取前一致）。route / buildNodeCompletionFlags / pathPatternExists / nodeFlagsComplete /
// protocolTaskFilePath / hasSubagentNode 同为该模块的单一实现（guard 与状态机共用，杜绝双实现漂移）。
//
// changeDir（可选）= 该 change 目录相对 .specs/ 的 POSIX 路径（活动 '<id>' / 归档
// 'archive/<日期>-<id>'，由 state-io.resolveChangeDir 解析）。目录已搬进归档时产物与任务文件都在
// 归档目录里——不传它会让推导看不到任何产物、回退到协议首节点（移动后报 open 的成因）。缺省 null
// = 既有形态（按 .specs/<changeName> 解析），旧调用零变化。
export async function determineNode(changeName, protocol, completedNodes = [], changeDir = null) {
  return resolveNextNode({ runRoot: runRootDir(), changeName, protocol, completedNodes, changeDir });
}

// 正常推进豁免判定——exit --apply 会把 currentNode 推进到下一节点（如 open exit 后
// currentNode=design，该节点尚未开始故 evidence 无记录），随后按 SKILL 协议调 next（正常路径）
// 不应被误拦为"疑似未 exit"。判定三条件：① completedNodes 非空；② 最后一个已完成节点
// 存在 evidence（exit --apply 必须带证据通过——证据存在证明该 exit 真实发生，排除伪造/漂移状态，
// 如 review 无 evidence）；③ currentNode 是下一个合法路由目标——**路由后继优先**（exit --apply
// 把 currentNode 推进到共享路由判定 resolveNextNode 的结果，平行转换 plan→subagent-execute、
// 趟间回流 subagent-execute→execute 等即由此产生；next 正常推进豁免识别路由后继，与 guard
// NEXT 同源），静态直接后继兜底（串行推进原语义，旧态/序列流不回归）。与回退豁免独立判断
// （回退 = TASK.md 有 pending 回退修复任务；本豁免 = 正常推进后继）。真乱序（currentNode
// 既非路由后继也非静态后继）仍维持严格 BLOCK。
export async function normalAdvanceExempt(state, protocol, completedNodes, currentNode, changeName, changeDir = null) {
  if (completedNodes.length === 0) return false;
  const lastNodeId = completedNodes[completedNodes.length - 1];
  const routeIds = route(protocol).map((node) => node.id);
  const lastIdx = routeIds.indexOf(lastNodeId);
  if (lastIdx < 0) return false;
  const lastEvidence = state.evidence && typeof state.evidence === 'object'
    ? state.evidence[lastNodeId]
    : null;
  // evidence 必须是对象且含非空 summary（空对象 {} 可绕过豁免，真实流程 exit 强制 summary——
  // 此处严格化防止手动修改 state 绕过）
  const hasExitEvidence = !!(
    lastEvidence &&
    typeof lastEvidence === 'object' &&
    !Array.isArray(lastEvidence) &&
    typeof lastEvidence.summary === 'string' &&
    lastEvidence.summary.trim() !== ''
  );
  if (!hasExitEvidence) return false;
  // 路由后继判定（与 guard 出口同源）：currentNode === resolveNextNode(completedNodes) 即
  // 正常推进后的下一路由目标（含平行转换与趟间回流）；文件推导失败（异常态）不豁免。
  try {
    // 产物根与共享视图取同一个 changeDir：两处各按自己的根推导，「路由后继」就会与 next 的 NODE
    // 行给出两个答案（移动后尤其明显：一处读归档、一处读已不存在的活动目录）。
    const routingNext = await determineNode(changeName, protocol, completedNodes, changeDir);
    if (routingNext === currentNode) return true;
  } catch {
    return false;
  }
  // 静态直接后继兜底（串行推进原语义，向后兼容旧态不回归）
  return lastIdx + 1 < routeIds.length && routeIds[lastIdx + 1] === currentNode;
}
