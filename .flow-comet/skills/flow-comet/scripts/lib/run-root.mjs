// 运行根解析（单一来源）：这次调用把哪个目录当项目根，只在这里回答一次。
//
// 为什么单独立模块：同一个问题此前被两处各自回答——守卫族读 FLOW_COMET_RUN_ROOT（守卫的运行根
// 模块），状态命令族直接用进程 cwd。两份推导在「只想用变量在临时目录里试一下」时静默分叉：
// 变量指向临时目录，状态命令却仍在 cwd 仓库里建分支、并把正在跑的 change 的 state 覆盖成新
// change 的初始状态（数据覆盖，靠备份才恢复）。收成一处后，同一个调用里两族只能给同一个答案。
//
// 取值语义（与守卫族既有语义逐字一致，默认行为不变）：
//   FLOW_COMET_RUN_ROOT 在场 → path.resolve(它)（相对值按调用进程的 cwd 解析）
//   否则                     → process.cwd()
//
// 边界：默认根仍是「调起进程的 cwd」。需要与 cwd 解耦的调用（测试夹具、脚本化实验）必须显式
// 设置该变量。hook 运行根另有兜底链（FLOW_COMET_RUN_ROOT → CLAUDE_PROJECT_DIR → 祖先锚定 →
// cwd）——多出来的候选来自宿主注入与 hook 的 cwd 漂移，属于 hook 判定面，不在本模块表达。
import path from 'path';

export function resolveRunRoot() {
  return process.env.FLOW_COMET_RUN_ROOT
    ? path.resolve(process.env.FLOW_COMET_RUN_ROOT)
    : process.cwd();
}
