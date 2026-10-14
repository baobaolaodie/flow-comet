// bridge-check（单一归属）：只读 dsh 桥接健康检查 · 六判定态。
// 严格只读零写入零网络；失配（FAIL）exit 非 0；无法识别形态 → 近似性声明告警（WARN）
// 不定论不误杀（行扫描对无法识别形态的手写极端 YAML 只告警不定论，不误判为失配；
// 仅明确失配才强制非零退出）。
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { fileExists } from './state-io.mjs';

// 版本戳锚点正则：独立整行、行首无缩进、冒号后恰一个空格、行尾无其它字符。格式禁动
// （安装器读-合并-写幂等替换与 loader 侧同值）。
const BRIDGE_VERSION_RE = /^\/\/ BRIDGE_VERSION: ([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/m;

// dev 态后缀归一（bridge-check 版本比较）：git describe 开发态形态为
// `<发布版本>-<领先提交数>-g<hash>`（例：`1.5.1-11-g93d96c0`，hash 十六进制、大小写不敏感）。
// 两侧仅在比较前剥这一种后缀、按基础版本比较——开发态载体与同基础版本的发布 loader 判健康；
// 语义化预发布标识（如 `1.5.0-rc.3`）不是 dev 态后缀、不得剥离（否则会把预发布放行成基础版本）。
// 归一仅用于比较，不改变读取到的原始值（失配报告需同时打印原始值与归一值）。
const BRIDGE_DEV_SUFFIX_RE = /-\d+-g[0-9a-f]+$/i;
function normalizeBridgeBaseVersion(version) {
  return String(version).replace(BRIDGE_DEV_SUFFIX_RE, '');
}

// $DSH_HOME 解析——与 prepare-env.mjs resolveDshHome 同语义（显式 DSH_HOME > ~/.dsh）。
// 安装器函数位于仓库根 scripts/，技能包脚本不能跨模块 import，语义复刻保持单点契约
// （套件断言保证双侧不漂移）。
function resolveDshHomeForBridgeCheck() {
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME);
  return path.join(os.homedir(), '.dsh');
}

// cordis.patch.yml 托管块标记——与 prepare-env.mjs MANAGED_CORDIS_START/END 同值复刻
// （技能包自包含；标记为安装器读-合并-写幂等替换边界，格式禁动）。
const MANAGED_CORDIS_START = '# --- flow-comet managed ---';
const MANAGED_CORDIS_END = '# --- end flow-comet managed ---';

// 判定态：健康 / 不适用 / 文件缺失 / 未挂载 / 版本偏斜 / 重复注册。
// runRoot = 会话项目根（.dsh 副本与 .specs 的锚）；packageRoot = 技能包根（INSTALLED_VERSION 的锚）。
export async function runBridgeCheck({ runRoot, packageRoot }) {
  const report = { pass: [], warn: [], fail: [] };
  // ⑥ 非 dsh 项目 →「不适用」exit 0：会话项目根无 .dsh/skills/flow-comet
  // （未安装 dsh 平台副本）即不适用，其余检查全部跳过。
  if (!(await fileExists(path.join(runRoot, '.dsh', 'skills', 'flow-comet')))) {
    console.log('[NA] bridge-check: 不适用（本项目未安装 dsh 平台副本）——项目根无 .dsh/skills/flow-comet');
    console.log('bridge-check: 不适用（exit 0）');
    return;
  }

  const dshHome = resolveDshHomeForBridgeCheck();
  const loaderPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
  const patchPath = path.join(dshHome, 'cordis.patch.yml');
  const installedVersionPath = path.join(packageRoot, 'INSTALLED_VERSION');

  // ① loader 文件存在性（$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs）
  const loaderExists = await fileExists(loaderPath);
  if (loaderExists) {
    report.pass.push('loader 文件存在: ' + loaderPath);
  } else {
    report.fail.push('loader 文件缺失: ' + loaderPath);
  }

  // ② cordis.patch.yml 托管块存在性与 insert 形态（含 - insert: 与 name: 'file://…'；
  //    id-targeted patch 形态无 insert → 确认为错误形态失配）
  //    ＋ ③ 块内 file:// 目标可达
  let patchContent = null;
  try {
    patchContent = await fs.readFile(patchPath, 'utf8');
  } catch {
    patchContent = null;
  }
  if (patchContent === null) {
    report.fail.push(
      '未挂载: ' + patchPath + ' 不存在——' +
      (loaderExists ? 'loader 存在但未挂载（不会监听任何项目）' : '托管块无从指向 loader')
    );
  } else {
    const startIdx = patchContent.indexOf(MANAGED_CORDIS_START);
    const endIdx = patchContent.indexOf(MANAGED_CORDIS_END);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      report.fail.push(
        '未挂载: ' + patchPath + ' 中不存在托管块（' + MANAGED_CORDIS_START + ' … ' + MANAGED_CORDIS_END +
        '）——' + (loaderExists ? 'loader 存在但未挂载（不会监听任何项目）' : '')
      );
    } else {
      // 块内容 = 起始标记行尾之后、结束标记之前
      let blockStart = patchContent.indexOf('\n', startIdx);
      blockStart = blockStart === -1 ? endIdx : blockStart + 1;
      const block = patchContent.slice(blockStart, endIdx);
      const hasInsert = /^\s*- insert:\s*$/m.test(block);
      const fileUrlMatch = /name:\s*'file:\/\/([^']+)'/.exec(block);
      const hasIdLine = /^\s*- id:\s*dsh-flow-comet-bridge\s*$/m.test(block);

      if (hasInsert && fileUrlMatch) {
        report.pass.push('cordis.patch.yml 托管块: 存在且 insert 形态（含 - insert: 与 name: \'file://…\'）');
        // ③ file:// 目标可达性（捕获组含 file:// 后的整段——'file://' + 捕获即完整 URL；
        // fileURLToPath 按平台归一 Windows 盘符与 POSIX 根路径）
        let targetPath = null;
        try {
          targetPath = fileURLToPath('file://' + fileUrlMatch[1]);
        } catch (error) {
          targetPath = null;
        }
        if (targetPath === null) {
          report.warn.push('近似性声明: 托管块 file:// 引用无法解析为本地路径（' + fileUrlMatch[0] + '）——无法核验目标可达性，不定论');
        } else if (await fileExists(targetPath)) {
          if (targetPath === loaderPath) {
            report.pass.push('块内 file:// 目标可达且与期望 loader 路径一致: ' + targetPath);
          } else {
            report.fail.push('托管块 file:// 目标与期望 loader 路径不符: ' + targetPath + ' ≠ ' + loaderPath);
          }
        } else {
          report.fail.push('托管块指向的 loader 文件缺失: ' + targetPath + '（file:// 目标不可达）');
        }
      } else if (hasInsert && !fileUrlMatch) {
        // insert 形态在但无 name: 'file://…' 行——部分可识别、目标不可核验：
        // 近似性声明告警，不定论不误杀（不 forced 非零）
        report.warn.push('近似性声明: 托管块为 insert 形态但未识别到 name: \'file://…\' 行——无法核验 file:// 目标是否可达，不定论');
      } else if (hasIdLine && !hasInsert) {
        // id-targeted patch 形态（- id: ... 无 - insert:）——
        // dsh applyEntryPatches 对不存在的 id 报 entry not found 并跳过，loader 不会加载
        report.fail.push('托管块为 id-targeted patch 形态（含 - id: dsh-flow-comet-bridge 但无 - insert:）——确认为错误形态失配（dsh 不会加载该 loader）');
      } else {
        report.warn.push('近似性声明: 托管块内容无法识别为已知形态（未见 - insert: / - id: dsh-flow-comet-bridge / name: \'file://…\'）——不判失配，不定论');
      }
    }
  }

  // ④ 托管块外同 id 重复注册（块内安装器写入的固有条目不计）
  let outside = '';
  if (patchContent !== null) {
    if (patchContent.includes(MANAGED_CORDIS_START) && patchContent.includes(MANAGED_CORDIS_END)) {
      const sIdx = patchContent.indexOf(MANAGED_CORDIS_START);
      const eIdx = patchContent.indexOf(MANAGED_CORDIS_END);
      outside = patchContent.slice(0, sIdx) + patchContent.slice(eIdx + MANAGED_CORDIS_END.length);
    } else {
      outside = patchContent; // 无托管块：全文件视为块外
    }
  }
  const dupMatches = outside.match(/^\s*-\s+id:\s*['"]?dsh-flow-comet-bridge['"]?\s*$/gm) ?? [];
  if (dupMatches.length > 0) {
    report.fail.push('重复注册: cordis.patch.yml 托管块外另有 ' + dupMatches.length + ' 处同 id 注册行（dsh-flow-comet-bridge）——可能重复加载');
  } else {
    report.pass.push('重复注册检查: 托管块外无同 id（dsh-flow-comet-bridge）注册行');
  }

  // ⑤ loader BRIDGE_VERSION 戳 vs 项目 INSTALLED_VERSION 基础版本比较（两原始值都打印；
  //    比较前剥离 dev 态后缀——见 normalizeBridgeBaseVersion）
  let loaderStamp = null;
  let installedVersion = null;
  if (loaderExists) {
    try {
      const loaderText = await fs.readFile(loaderPath, 'utf8');
      const stampMatch = BRIDGE_VERSION_RE.exec(loaderText);
      if (stampMatch) {
        loaderStamp = stampMatch[1];
      } else {
        report.warn.push('近似性声明: loader 未提取到 BRIDGE_VERSION 戳（锚点正则 /^\\/\\/ BRIDGE_VERSION: ([0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?)$/m 无命中——非语义化版本标记或缺失）——无法比对版本，不定论');
      }
    } catch {
      report.warn.push('近似性声明: loader 文件读取失败——无法比对版本，不定论');
    }
  }
  try {
    installedVersion = (await fs.readFile(installedVersionPath, 'utf8')).trim();
  } catch {
    report.warn.push('近似性声明: 无法读取项目 INSTALLED_VERSION（' + installedVersionPath + '）——无法比对版本，不定论');
  }
  if (loaderStamp !== null && installedVersion !== null) {
    // 比较前两侧按基础版本归一（剥离 git describe dev 态后缀；预发布标识不剥）。
    // 原始值逐字相同 → 既有发布态严格一致报告保持不变；
    // 原始值不同但归一基础版本一致 → dev 态同基础，判健康（同时打印两原始值与基础版本）；
    // 归一后仍不同 → 版本偏斜：保留原「loader 原始戳 != 项目原始戳」配对（兼容既有报告读取），
    // 再补打印两侧归一基础版本，便于操作者识别 dev 态后缀。
    const loaderBase = normalizeBridgeBaseVersion(loaderStamp);
    const installedBase = normalizeBridgeBaseVersion(installedVersion);
    if (loaderBase === installedBase) {
      if (loaderStamp === installedVersion) {
        report.pass.push('版本一致性: loader BRIDGE_VERSION=' + loaderStamp + ' == 项目 INSTALLED_VERSION=' + installedVersion);
      } else {
        report.pass.push('版本一致性: loader BRIDGE_VERSION=' + loaderStamp + ' ~= 项目 INSTALLED_VERSION=' + installedVersion + '（dev 态后缀归一后基础版本 ' + loaderBase + ' 一致）');
      }
    } else {
      report.fail.push('版本偏斜: loader BRIDGE_VERSION=' + loaderStamp + ' != 项目 INSTALLED_VERSION=' + installedVersion + '（归一基础版本: loader=' + loaderBase + ' / installed=' + installedBase + '）——两值如上');
    }
  }

  // 逐项人读报告（全过 exit 0 / 任一失配 exit 非 0）
  console.log('bridge-check: 只读检查（DSH_HOME=' + dshHome + ' · 项目根=' + runRoot + '）');
  for (const line of report.pass) console.log('[OK] ' + line);
  for (const line of report.warn) console.log('[WARN] ' + line);
  for (const line of report.fail) console.log('[FAIL] ' + line);
  if (report.fail.length > 0) {
    console.log('bridge-check: 失配 ' + report.fail.length + ' 项——exit 1');
    process.exitCode = 1;
  } else if (report.warn.length > 0) {
    console.log('bridge-check: 未发现明确失配，含 ' + report.warn.length + ' 项近似性声明告警（不定论，不误杀）——exit 0');
  } else {
    console.log('bridge-check: 健康（全部检查通过）——exit 0');
  }
}
