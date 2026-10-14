/**
 * installer-cleanup.mjs — 生成物镜像目录的定向清理（升级路径残留）
 *
 * 为什么清理独立成模块：判据只有一条——「权威源同一相对路径上不存在同类型条目」，而删除面
 * 必须与本次整树复制的目标根严格对应。每一条 fail-closed（镜像根是链接不跟随 / 真实路径越出
 * 项目根不删 / 符号链接不跟随 / 类型冲突不删 / 清理后仍非空不删）都是**不可放宽**的安全边界：
 * 放宽任何一条，删除动作就可能落到项目之外、或落到用户自有文件上。把它与入口的 CLI / 编排
 * 分开，是为了让「哪些路径允许删」只有一处、可单独审查与测试。
 *
 * 依赖方向：本模块依赖 installer-migrate 的探测原语（lstatIfExists / readdirIfExists——
 * 「该路径确实不存在」的单一判定）；反向依赖不存在。
 */
import fs from 'node:fs';
import path from 'node:path';

import { lstatIfExists, readdirIfExists } from './installer-migrate.mjs';

// ---------- 生成物镜像目录的定向清理（升级路径残留） ----------
//
// 缺陷形态（实测）：copyTree 只覆盖、不删除 ⇒ 权威源里已删除或改名的文件在已有副本里永久残留。
// 一次改名 + 一次移出即可在三平台副本各留 8 条残留，且残留会让安装副本跑自身回归套件报
// 308/309（失败项的失败信息逐条指向残留文件），而权威源同一命令 309/309——落差纯由残留造成。
//
// 镜像白名单（唯一允许删除的路径集合，逐条由本次生成动作定义）：本次真实 copyTree 的目标根
//   `<skillRoot>/<name>`，其中 <name> ∈ 权威源 `skills/` 下的 `flow-comet*` 目录清单。
// 命名空间（flow-comet* 前缀）与安装位置（平台技能根）共同构成归属判据；白名单之外的一切路径
// **永不触碰**。两条 fail-closed 边界（不删，但必须可见）：
//   · 整个技能目录不在权威源清单里（`<skillRoot>/flow-comet-fork` 一类）：安装器没有生成清单，
//     用户自建的同命名空间目录与「权威源已移除的技能」在结构上不可区分 ⇒ 归属不可判定，保留；
//     该形态由显式 `--purge` 处置。
//   · `.claude/rules`（同为 copyTree 目标）：路径不含命名空间，无法与用户自有规则文件区分 ⇒
//     不纳入删除面（同上，`--purge` 处置）。
//
// 删除判据只有一条：**权威源同一相对路径上不存在同类型条目**。fail-closed 情形逐条打印、绝不静默：
//   · **镜像根自身**是符号链接/junction（不跟随、不删除——条目层检查拦不住根级穿越：根为链接时
//     `readdirSync` 会跟随进链接目标，删除动作落在**项目之外**，而播报打印的是项目内的表象路径）；
//   · **镜像根的真实路径越出目标项目根**（realpath 包含性判据——根或其任一祖先段为链接时，
//     词法路径仍显示在项目内，只有解析后才能证否；无法证明「在项目内」一律不删）；
//   · 条目是符号链接（不跟随、不删除——防穿越到目标项目之外）；
//   · 权威源同路径在场但类型不同（文件 ↔ 目录）：归属不可判定，留给复制阶段的既有语义；
//   · 目录清理后仍非空（其中含非残留内容 = 用户文件）→ 只删残留子孙，目录本身保留。
// 幂等：重复运行零残留可删 ⇒ 零输出、零报错；删除动作逐条打印（输出可核对）。
/**
 * realpath 解析：返回真实路径，**解析不出即 null**（路径不存在 / 悬空链接 / 权限或 IO 故障一视同仁）。
 * 与 lstatIfExists「访问类故障原样抛出」的取舍不同——本函数只服务**删除前的包含性判据**，
 * 调用方约定为 fail-closed（null ⇒ 不删并打印原因）：解析不出就**证明不了**在项目内，
 * 此时中止安装比静默放行危险，而静默放行又比不删危险。
 * 优先 `realpathSync.native`：Windows 上 libuv 实现不展开 8.3 短名（实测 `LONGYI~1` 形态），
 * 而词法形态不同的两侧直接比较会把项目内路径误判为越界——本仓既有同判据（dsh-bridge 的
 * 包含性检查）已登记该平台事实，此处沿用同一取值口径（失败方向仍是 fail-closed：误判 = 不删）。
 */
function realpathOrNull(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return null;
  }
}

/**
 * 真实路径包含性：`target` 解析后的真实路径是否仍在 `root` 解析后的真实路径之内。
 * 两侧都先 realpath——根或祖先段是链接时词法路径会骗人（Windows 8.3 短名 / 平台临时目录链接同理）。
 * 任一解析失败 ⇒ false（fail-closed）；`path.relative` 的 `..` 前缀与绝对路径都判越界。
 */
function isRealPathInside(target, root) {
  const targetReal = realpathOrNull(target);
  const rootReal = realpathOrNull(root);
  if (targetReal === null || rootReal === null) return false;
  const rel = path.relative(rootReal, targetReal);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

function pruneMirrorEntries(srcRoot, dstRoot, report, projectRoot) {
  // 根级 fail-closed（**进入递归/枚举之前**）：镜像根自身是链接 ⇒ 不跟随；真实路径越出目标项目根
  // ⇒ 不删。条目层的 entry.isSymbolicLink() 只覆盖根以下的条目，拦不住根级的符号链接/junction。
  const rootStat = lstatIfExists(dstRoot);
  if (rootStat === null) return; // 镜像根不在场（首次安装）——无残留可清
  if (rootStat.isSymbolicLink()) {
    report.skipped.push(`${dstRoot}（镜像根是符号链接/junction——不跟随、不删除，防穿越到目标项目之外）`);
    return;
  }
  if (!isRealPathInside(dstRoot, projectRoot)) {
    report.skipped.push(`${dstRoot}（真实路径 ${realpathOrNull(dstRoot) || '无法解析'} 越出目标项目根 ${realpathOrNull(projectRoot) || '无法解析'}——归属不可判定，不删）`);
    return;
  }
  const entries = readdirIfExists(dstRoot);
  if (entries === null) return; // TOCTOU：lstat 后、枚举前被移走——无残留可清（判定同 lstatIfExists 口径）
  for (const entry of entries) {
    const srcPath = path.join(srcRoot, entry.name);
    const dstPath = path.join(dstRoot, entry.name);
    if (entry.isSymbolicLink()) {
      report.skipped.push(`${dstPath}（符号链接——不跟随、不删除）`);
      continue;
    }
    const srcStat = lstatIfExists(srcPath);
    const isDir = entry.isDirectory();
    if (srcStat && isDir === srcStat.isDirectory()) {
      // 权威源在场且同类型：目录递归下探，文件保留（内容由 copyTree 覆盖）
      if (isDir) pruneMirrorEntries(srcPath, dstPath, report, projectRoot);
      continue;
    }
    if (srcStat) {
      report.skipped.push(`${dstPath}（权威源同路径类型不同——归属不可判定，不删）`);
      continue;
    }
    if (isDir) {
      // 权威源无该目录 ⇒ 其中全部条目都属残留：先递归清空，再连同目录本身移除
      pruneMirrorEntries(srcPath, dstPath, report, projectRoot);
      const left = readdirIfExists(dstPath);
      if (left === null) continue; // 递归中已被移除（与其祖先同批）
      if (left.length > 0) {
        report.skipped.push(`${dstPath}（清理后仍非空——保留其中非残留内容）`);
        continue;
      }
      fs.rmdirSync(dstPath);
      report.removed.push(dstPath);
      continue;
    }
    if (entry.isFile()) {
      fs.rmSync(dstPath, { force: true });
      report.removed.push(dstPath);
      continue;
    }
    report.skipped.push(`${dstPath}（既非普通文件也非目录——不删）`);
  }
}

/**
 * 平台镜像清理总入口：对本次安装的每个技能镜像根（`<skillRoot>/<name>` ← `skills/<name>`）
 * 做定向清理，逐条打印结果。无残留时零输出（幂等可核对：重复运行不再打印清理项）；
 * fail-closed 保留项以警告逐条打印——保留是**可见的决定**，不是静默跳过。
 * `projectRoot` = 本次安装的目标项目根：**删除面的包含性上界**（镜像根 realpath 必须落在其内，
 * 见 pruneMirrorEntries 的根级判据）。
 */
export function cleanStaleMirrorEntries(skillsSrc, skillRoot, skillNames, projectRoot) {
  const report = { removed: [], skipped: [] };
  for (const name of skillNames) {
    pruneMirrorEntries(path.join(skillsSrc, name), path.join(skillRoot, name), report, projectRoot);
  }
  if (report.removed.length > 0) {
    console.log(`[flow-comet] 镜像清理: 已删除 ${report.removed.length} 项（权威源已不存在的生成物）`);
    for (const p of report.removed) {
      console.log(`  - 已删除: ${p}`);
    }
  }
  if (report.skipped.length > 0) {
    console.warn(`[flow-comet] 警告: 镜像清理保留 ${report.skipped.length} 项（fail-closed——无法判定归属即不删）:`);
    for (const p of report.skipped) {
      console.warn(`  - 保留: ${p}`);
    }
  }
}
