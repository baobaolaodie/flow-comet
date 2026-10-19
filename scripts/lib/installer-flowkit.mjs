/**
 * installer-flowkit.mjs — flow-kit 上游快照获取链路（prepare-env 的逻辑层模块）
 *
 * 非破坏是这条链路的全部要点：已存在的目录一律只读不动（只读 HEAD、只读 origin 判定归属），
 * 归属不可确认即跳过并给手动指引；clone / checkout 的失败**不抛错**——外网故障不得绑架安装器
 * 的其余职责（技能树、规则、hook 注入照常完成，进程照常 exit 0）。把这条链路独立成模块，是为
 * 了让「什么情况下会改动用户目录」只有一个落点可审——答案必须是「只有目标不存在时」。
 * 降级态的统一口径是「未校验（模板缺失）」：获取点给怎么补（命令），进程结尾单独明示后果与
 * 修复方法（两处分工见 FLOW_KIT_DEGRADED_NOTICE 上方的说明）。
 *
 * 依赖方向：本模块是叶子（只用 node 内置模块与 git 命令）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------- flow-kit 获取链路（ADR-008 / DESIGN D1~D6——平台无关,main 平台循环前调用一次） ----------

// 锁定点常量（D2）：上游 github.com/rihebty/flow-kit 实测无 tag,commit 是唯一精确锚;
// 升级锁定点 = 显式修改此常量并记 CHANGELOG,不做自动跟随（2026-08-23 ls-remote 实测 == 上游 HEAD）。
const FLOW_KIT_UPSTREAM_URL = 'https://github.com/rihebty/flow-kit.git';
const FLOW_KIT_LOCKED_COMMIT = '9b5dda7206ae841230f118348d660ad8d0ae2830';
// git 网络调用统一超时（D5——沿用 resolveInstalledVersion 的 execFileSync timeout 先例风格）
const FLOW_KIT_GIT_TIMEOUT_MS = 60000;
// 摘要展示用短 sha 长度（git 短哈希惯例——单一来源,clone 成功/已有/指引三处引用）
const FLOW_KIT_SHORT_SHA_LEN = 7;

/** 提取 git 调用失败信息首行（execFileSync 错误消息含多行 stderr——警告只留首行） */
function gitErrorFirstLine(err) {
  return String(err && err.message ? err.message : err).split('\n')[0].trim();
}

/**
 * 手动获取指引（clone/checkout 失败或目录非上游克隆时打印——含上游 URL 与目标路径;不抛错）：
 * 这里只负责「怎么补」，用户可见的结论（影响 / 原因 / 修复方法）留到进程结尾单独明示——
 * 获取段在平台摘要之前执行，结论留在这一段里会被后面的平台清单与摘要顶出视野。
 */
function printFlowKitManualGuide(target) {
  const flowKitDir = path.join(target, 'flow-kit');
  console.warn(`[flow-comet] 手动获取指引: git clone ${FLOW_KIT_UPSTREAM_URL} "${flowKitDir}"`);
  console.warn(`[flow-comet] 然后锁定快照: git -C "${flowKitDir}" checkout --detach ${FLOW_KIT_LOCKED_COMMIT.slice(0, FLOW_KIT_SHORT_SHA_LEN)}`);
  console.warn('[flow-comet] 后果: 模板校验将不可用——各节点出口输出「未校验（模板缺失）」而不比对模板段形；技能册的模板引用同时悬空。其余安装职责不受影响。');
}

/**
 * 安装结尾的降级结论（未校验（模板缺失））：影响 / 原因 / 修复方法三行，挂在进程结尾打印。
 * 与获取点的手动指引分工：那里给命令（现在就能照做），这里给结论（安装结束时的状态与后果）。
 * 只有真的拿不到模板时才挂（获取成功、HEAD 只读失败但目录在场都不挂——模板仍在磁盘上，
 * 结构校验照常可用）。调用契约：只由 prepare-env CLI 进程调用——结尾提示挂在 process 'exit'
 * 上，若将来被库内导入复用，提示会跟着宿主进程退出一起打印（不可断言、会污染输出）。
 */
const FLOW_KIT_DEGRADED_NOTICE = [
  '[flow-comet] 提醒: 本次安装未获取 flow-kit 模板——产出物不会做模板校验。',
  '[flow-comet]   影响: 各节点出口输出「未校验（模板缺失）」而不拦缺段 / 乱序 / 空段（结构校验不可用）。',
  '[flow-comet]   原因: flow-kit/templates 未就位（自动获取失败，或同名目录归属无法确认已跳过——安装器绝不改动已有目录）。',
  '[flow-comet]   修复: 网络可用时重跑本安装器；或按上方手动获取指引 clone 上游后 checkout --detach 到锁定快照。',
].join('\n') + '\n';

let flowKitDegradedNoticeScheduled = false;

/** 挂一次结尾结论（重复调用幂等；退出阶段只能用同步写——console 在 exit 阶段不保证刷出） */
function scheduleFlowKitDegradedNotice() {
  if (flowKitDegradedNoticeScheduled) return;
  flowKitDegradedNoticeScheduled = true;
  process.once('exit', () => {
    try {
      fs.writeSync(2, FLOW_KIT_DEGRADED_NOTICE);
    } catch {
      // 结尾提示是尽力而为：写不出去也不得改变退出码（exit 0 / 非破坏契约的底线）
    }
  });
}

/**
 * 归属判定（D3）：origin remote URL 匹配上游——本地 config 读取,无网络。
 * 兼容 https / ssh 形态与可选 .git 后缀;读取失败视为不匹配（保守落入"非上游克隆"分支,
 * 绝不改动用户目录）。返回 'match' | 'mismatch' | 'unreadable'。
 */
function flowKitOriginStatus(flowKitDir) {
  try {
    const url = execFileSync(
      'git',
      ['-C', flowKitDir, 'config', '--get', 'remote.origin.url'],
      { encoding: 'utf8', timeout: FLOW_KIT_GIT_TIMEOUT_MS }
    ).trim().replace(/\.git$/i, '').replace(/\/+$/, '');
    return /github\.com[:/]rihebty\/flow-kit$/i.test(url) ? 'match' : 'mismatch';
  } catch {
    return 'unreadable';
  }
}

/**
 * 确保 <target>/flow-kit/ 就位（ADR-008 / DESIGN D1~D6——L-008 非破坏哲学:已存在路径一律只读不动）：
 *   路径 1 目标不存在 → execFileSync('git',…) 数组参数形态 clone 上游后 detached checkout 到锁定 commit;
 *   路径 2 已存在且 .git 存在且 origin 匹配上游 → 只读 rev-parse HEAD 并输出与锁定点差异影响,绝不改动;
 *   路径 3 已存在但不满足归属判定 → 摘要"非上游克隆,已跳过"+ 手动指引,不改动;
 *   路径 4 clone/checkout 任一失败 → 警告 + 手动获取指引,**不抛错**（D5——外网故障不得绑架安装器
 *          其余职责,进程照常 exit 0）;3、4 两条降级路径都在安装结尾补一句「未校验（模板缺失）」
 *          的影响 / 原因 / 修复方法;各平台 purge 清单永不包含 flow-kit（D6,见 PLATFORMS 表头注释）。
 */
export function ensureFlowKit(target) {
  const flowKitDir = path.join(target, 'flow-kit');
  const shortLock = FLOW_KIT_LOCKED_COMMIT.slice(0, FLOW_KIT_SHORT_SHA_LEN);
  if (!fs.existsSync(flowKitDir)) {
    // 路径 1：目标缺失 → clone + detached checkout 到锁定 commit（D1/D2）
    try {
      execFileSync('git', ['clone', FLOW_KIT_UPSTREAM_URL, flowKitDir], {
        encoding: 'utf8',
        timeout: FLOW_KIT_GIT_TIMEOUT_MS,
      });
      execFileSync('git', ['-C', flowKitDir, 'checkout', '--detach', FLOW_KIT_LOCKED_COMMIT], {
        encoding: 'utf8',
        timeout: FLOW_KIT_GIT_TIMEOUT_MS,
      });
      console.log(`[flow-comet] 已获取 flow-kit（锁定 ${shortLock}）`);
    } catch (err) {
      // 路径 4：clone/checkout 任一失败 → WARN + 手动指引,不抛错
      console.warn(`[flow-comet] 警告: flow-kit 自动获取失败（${gitErrorFirstLine(err)}）`);
      printFlowKitManualGuide(target);
      scheduleFlowKitDegradedNotice();
    }
    return;
  }
  // 目录已存在 → 归属判定（D3:.git 存在 且 origin remote 匹配上游）
  const hasDotGit = fs.existsSync(path.join(flowKitDir, '.git'));
  const originStatus = hasDotGit ? flowKitOriginStatus(flowKitDir) : 'mismatch';
  if (originStatus !== 'match') {
    // 路径 3：同名非克隆目录（或 remote 无法确认归属）→ 跳过 + 指引,绝不改动
    if (originStatus === 'unreadable') {
      console.warn('[flow-comet] 警告: flow-kit 目录存在且含 .git,但 origin remote 读取失败——无法确认归属');
    }
    console.log('[flow-comet] 目录存在但非上游克隆，已跳过');
    printFlowKitManualGuide(target);
    scheduleFlowKitDegradedNotice();
    return;
  }
  // 路径 2：上游克隆 → 只读检测并输出差异影响（D4——绝不 fetch/checkout 改动用户克隆）
  try {
    const head = execFileSync('git', ['-C', flowKitDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      timeout: FLOW_KIT_GIT_TIMEOUT_MS,
    }).trim();
    const shortHead = head.slice(0, FLOW_KIT_SHORT_SHA_LEN);
    console.log(`[flow-comet] 已有 flow-kit（HEAD=${shortHead}，推荐锁定点=${shortLock}）`);
    if (head === FLOW_KIT_LOCKED_COMMIT) {
      console.log('[flow-comet] 当前 HEAD 与推荐锁定点一致。');
    } else {
      console.warn(
        `[flow-comet] 差异影响: 当前 HEAD 与推荐锁定点不一致——guard 段名基准与协议引用可能偏离安装器锁定内容` +
          `（安装器绝不改动已有克隆;如需对齐请手动执行 git -C "${flowKitDir}" fetch 后 checkout --detach ${shortLock}）`
      );
    }
  } catch (err) {
    // HEAD 只读失败同样不改动、不中断安装（保守降级为警告）
    console.warn(`[flow-comet] 警告: flow-kit HEAD 读取失败（${gitErrorFirstLine(err)}），已跳过比对`);
  }
}
