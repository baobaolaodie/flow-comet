// items/k.mjs — K 组条目（安装器与平台）与分发面夹具
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 组内夹具与条目同址；本文件同时承载跨组共用的夹具，其它组文件按需 import 本文件（组文件之间单向，无环）。

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { assertExit, assertNotOut, assertOut, baseState, runHook, writeFile, writeState } from '../lib/test-helpers.mjs';
import { CHANGE_ID, gitInit } from './a.mjs';

// 路径推导基准：技能包 scripts/ 目录（与套件入口同基准）
const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CONTRACT = path.join(SCRIPTS_DIR, 'contract-check.mjs');

// 递归收集目录下相对文件清单（排序稳定，供 K8/K10 技能整树清单/内容比对）
function collectTreeFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute));
    }
  })(root);
  return files.sort();
}

// ---------- 分发面包体断言助手（npm 包形态：环境判据 / 结果标记 / 可发布性清单 / 包体边界 / bin 双入口） ----------

// 环境判据（结构化事实，不做路径字符串猜测）：本套件在权威源与安装副本内都会运行，
// 而包体质检只有权威源侧可判——判据落空时输出显式「不适用」行并计通过，禁止静默跳过。
//   权威源侧 = 脚本上溯 4 层（包根）**同时**满足：存在 `name === 'flow-comet'` 的 package.json
//     **且** `.flow-comet/skills/flow-comet` 权威树在位；
//   安装副本侧 = <target>/.claude|.agents|.dsh/skills/flow-comet/scripts 上溯 4 层 = 目标项目根
//     → 判「不适用」（判定写反会让每个已安装项目假红）。
// 两个条件是**并列必要**的：只看 manifest 名字会把「恰好同名的消费项目」（依赖里带同名包、
// 或项目自身就叫 flow-comet 但无权威树）判成权威源——于是包体质检在该项目里跑 npm pack 而不是
// 输出「不适用」（判据过宽的另一失败模式）。权威树在场时 manifest 缺失/不可解析/name 不符
// → 必须失败（判定过宽会让权威源侧的包体断言静默漏检）。
// root 可覆盖（默认真实包根）——仅为可测性接缝：使上述四种形态能在夹具目录上被逐条驱动
// （否则判据的判别力只能靠人工实验验证，回归时可能被改宽而套件仍全绿）。生产调用不传该参数。
function resolvePackageContext(root = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..')) {
  const authoritative = fs.existsSync(path.join(root, '.flow-comet', 'skills', 'flow-comet'));
  const notApplicable = (reason) => ({ kind: 'copy', reason: reason || '根目录无本包权威源（name=flow-comet 的 package.json + .flow-comet/skills/flow-comet 权威树）' });
  const manifest = path.join(root, 'package.json');
  if (!fs.existsSync(manifest)) {
    if (authoritative) throw new Error('权威源包根缺少 package.json: ' + manifest);
    return notApplicable();
  }
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  } catch (e) {
    if (authoritative) throw new Error('权威源 package.json 不可解析: ' + e.message);
    return notApplicable();
  }
  if (!pkg || pkg.name !== 'flow-comet') {
    if (authoritative) throw new Error('权威源 package.json 的 name 应为 flow-comet，实际 ' + JSON.stringify(pkg && pkg.name));
    return notApplicable();
  }
  if (!authoritative) {
    return notApplicable('根目录有 name=flow-comet 的 package.json 但权威树（.flow-comet/skills/flow-comet）不在位——同名不构成权威源，按安装副本判定');
  }
  return { kind: 'source', root, pkg };
}

// 环境判据的判别力锚（正反两向逐形态驱动）：判据写宽（manifest 名字相符即认权威源）会让同名
// 消费项目被当成权威源；写反/写严则两侧互串（副本侧假红 / 权威源侧静默漏检）。夹具形态：
//   ① 权威树不在 + 同名 manifest → copy（同名 ≠ 权威源）
//   ② 权威树不在 + 无 manifest   → copy
//   ③ 权威树在场 + 同名 manifest → source
//   ④ 权威树在场 + 无 manifest / manifest 不可解析 / name 不符 → 抛错（既有行为保持，不得放宽）
// 夹具建在调用方给定的临时目录内（随该项临时目录一并清理，不留残留）。
function assertPackageContextJudgment(scratch) {
  const fixture = (name, options) => {
    const root = path.join(scratch, name);
    const tree = path.join(root, '.flow-comet', 'skills', 'flow-comet');
    if (options.tree) fs.mkdirSync(tree, { recursive: true });
    else fs.mkdirSync(root, { recursive: true });
    if (options.manifest !== undefined) fs.writeFileSync(path.join(root, 'package.json'), options.manifest, 'utf8');
    return root;
  };
  const expectKind = (root, expected, label) => {
    const ctx = resolvePackageContext(root);
    if (ctx.kind !== expected) {
      throw new Error('环境判据失配（' + label + '）：期望 ' + expected + '，实际 ' + ctx.kind);
    }
  };
  const expectThrow = (root, label) => {
    let threw = null;
    try { resolvePackageContext(root); } catch (e) { threw = e; }
    if (!threw) {
      throw new Error('环境判据失配（' + label + '）：权威树在场而 manifest 畸形时应显式失败，实际未抛错');
    }
  };
  expectKind(fixture('same-name-consumer', { tree: false, manifest: '{"name":"flow-comet"}' }), 'copy', '权威树不在 + 同名 manifest');
  expectKind(fixture('plain-consumer', { tree: false, manifest: undefined }), 'copy', '权威树不在 + 无 manifest');
  expectKind(fixture('authoritative', { tree: true, manifest: '{"name":"flow-comet"}' }), 'source', '权威树在场 + 同名 manifest');
  expectThrow(fixture('authoritative-no-manifest', { tree: true, manifest: undefined }), '权威树在场 + 无 manifest');
  expectThrow(fixture('authoritative-broken', { tree: true, manifest: '{ not json' }), '权威树在场 + manifest 不可解析');
  expectThrow(fixture('authoritative-other-name', { tree: true, manifest: '{"name":"other"}' }), '权威树在场 + name 不符');
  console.log('  环境判据: 副本侧同名/无名两形态判「不适用」，权威源侧判「权威源」，畸形 manifest 三形态显式失败 ✓');
}

// 分发面结果标记（机器可读）：本套件在权威源与安装副本两侧都会运行，而断言只在权威源侧真跑——
// 两侧的区别（「已执行」/「不适用」/「未执行」）必须留在运行器可捕获的结果里，不能只打 console 行
// 靠人工核验。前两行即两侧的正反锚点：权威源侧回传 executed、安装副本侧回传 not-applicable，
// 写反则该侧判失败。另两态是「真跑了但没验成」的两类原因，只在权威源侧出现：
//   platform     平台条件不满足（条目内某条子断言在本环境无法构造前置）；
//   toolMissing  本地工具缺失（仓库本地检查器不随克隆分发，整项无从执行）。
export const DISTRIBUTION_MARKERS = {
  source: 'distribution:executed@source',
  copy: 'distribution:not-applicable@copy',
  platform: 'distribution:not-applicable@platform',
  toolMissing: 'distribution:not-executed@tool-missing',
};

// 三态读数（运行器收尾行用）：条目级标记 → 状态，**不适用 / 未执行不得并入「通过」**。
// platform 不在表内——它是条目内**子断言**的态（条目自身的面已真跑），不是条目的态；
// 它与条目级三态分区互不混淆（子断言由运行器逐条打印，见 createOutcomeRecorder）。
const DISTRIBUTION_ITEM_STATES = {
  [DISTRIBUTION_MARKERS.source]: 'passed',
  [DISTRIBUTION_MARKERS.copy]: 'not-applicable',
  [DISTRIBUTION_MARKERS.toolMissing]: 'not-executed',
};
export function distributionState(marker) {
  return DISTRIBUTION_ITEM_STATES[marker] || null;
}

// K14 安装副本侧「不适用」说明：K14 分支与契约夹具共用同一字面量来源（防两处文案漂移）。
const K14_COPY_DETAIL = '桥接 loader 版本戳重装断言仅权威源侧可判';

// 运行器侧标记契约校验（分发面项）：标记必须显式在场且与结构化环境判据推出的期望值一致。
//   缺标记 = 该项走了静默跳过（「未验证 ≠ 通过」，与显式「不适用」是两回事）→ 失败；
//   标记与环境不符 = 环境判据写反（副本侧假红 / 权威源侧静默漏检）→ 失败。
// 两个原因态（platform / toolMissing）只在权威源侧真跑时产生——副本侧在早期分支已回传
// not-applicable@copy，故它们出现在副本环境即判定写错（把原因态当成了副本态）。
// ctx 是可注入接缝（默认按真实环境判据解析）：使两侧错配与非法 marker 的失败路径能由夹具
// 合成 ctx 真实驱动（否则这些分支没有调用者，判定被改宽也没有断言能拦住）。
export function assertDistributionOutcome(itemName, marker, ctx = resolvePackageContext()) {
  const legal = Object.values(DISTRIBUTION_MARKERS);
  if (!legal.includes(marker)) {
    throw new Error('分发面结果标记缺席或非法（应回传 ' + legal.join(' 或 ') + '，实际 ' + JSON.stringify(marker)
      + '）——禁止静默跳过');
  }
  const expected = DISTRIBUTION_MARKERS[ctx.kind];
  const reasonState = marker === DISTRIBUTION_MARKERS.platform || marker === DISTRIBUTION_MARKERS.toolMissing;
  // 原因态（platform / toolMissing）只允许在权威源侧出现——副本侧在早期分支就回传了
  // not-applicable@copy，此处出现原因态即判定写错（原因态被当成了副本态的替代）。
  if (marker !== expected && !(reasonState && ctx.kind === 'source')) {
    throw new Error('分发面结果标记与环境判据不符：本环境应 ' + expected + '，实际 ' + marker
      + '（判定写反会让该侧静默漏检或假红）');
  }
  console.log('OUTCOME: ' + itemName + ' → ' + marker);
}

// 平台条件子断言的结果登记（「不适用（平台原因）」面）：子断言不是条目本身——它的不适用不改写条目
// 自己的读数，而是**自己出声**（相邻的显式行 + 运行器收尾的机器可读 OUTCOME 行），使「未验证」
// 在日志与证据里可逐条核对，不再无痕计入通过。记录器由运行器按项创建、作为 run(dir, outcomes) 的
// 第二参数注入（无跨文件可变全局状态，也不会串项）。
export function createOutcomeRecorder() {
  const recorded = [];
  return {
    notApplicablePlatform(assertion, reason) {
      if (typeof assertion !== 'string' || assertion.trim() === ''
          || typeof reason !== 'string' || reason.trim() === '') {
        throw new Error('平台不适用回传契约要求非空 assertion 与 reason，实际 '
          + JSON.stringify({ assertion, reason }));
      }
      recorded.push({ assertion, reason, marker: DISTRIBUTION_MARKERS.platform });
      console.log('  不适用（平台原因：' + reason + '）——' + assertion + '（该子断言本环境无法验证；未验证 ≠ 通过）');
    },
    drain() { return recorded.splice(0, recorded.length); },
  };
}

// 分发面条目的统一接入（安装器/平台链路断言）：权威源侧真跑，安装副本侧回传显式
// 「不适用（安装副本侧）」标记——两侧都出声，杜绝「裸 return 静默跳过仍计通过」。
// 条目在自己的定义处用 `surface: '<说明>'` 声明「我属分发面、不适用的是哪个面」，导出前经本函数
// 接入：接入后条目上的是既有契约字段 `distributionSurface: true`（运行器按该字段断言标记）。
// copy 判定与「已执行」回传只写一份（单源不复制），声明就在条目旁边（不另立名单——名单会与
// 条目漂移且缺失时无人发现）。
export function applyDistributionSurface(entry) {
  if (!entry || entry.surface === undefined) return entry;
  const { surface, ...rest } = entry;
  if (typeof surface !== 'string' || surface.trim() === '') {
    throw new Error('分发面声明 surface 必须是非空说明（条目 ' + entry.name + '），实际 ' + JSON.stringify(surface));
  }
  if (typeof rest.run !== 'function' || typeof rest.name !== 'string') {
    throw new Error('分发面条目接入契约要求 name 与 run，实际 ' + JSON.stringify(Object.keys(rest)));
  }
  return {
    name: rest.name,
    distributionSurface: true,
    // async：条目自身可能是 async（K11/K12）——不 await 会把 Promise 当结果回传（marker 丢失）
    run: async (dir, outcomes) => {
      const ctx = resolvePackageContext();
      if (ctx.kind === 'copy') {
        const outcome = copyDistributionOutcome(ctx, surface);
        console.log(outcome.message);
        return outcome.marker;
      }
      const result = await rest.run(dir, outcomes);
      // 权威源侧：条目跑完即回传「已执行」——除非条目自己回传了更具体的态（原因态）
      return result === undefined ? DISTRIBUTION_MARKERS.source : result;
    },
  };
}

// copy 形态「不适用」回传：文案与机器可读结果标记同源产出（文案是「非静默跳过」的证据）。
// 返回 { message, marker } 供 early-return 分支直接消费，也使夹具无需捕获 stdout 即可逐字驱动断言。
// 非 copy ctx 必须 fail-closed——不允许把 source 形态的 marker 与「不适用」文案拼在一起。
function copyDistributionOutcome(ctx, detail) {
  if (!ctx || ctx.kind !== 'copy' || typeof ctx.reason !== 'string' || ctx.reason.trim() === '') {
    throw new Error('copy 回传契约要求 kind=copy 且含非空 reason，实际 ' + JSON.stringify(ctx));
  }
  return {
    message: '  不适用（安装副本侧：' + ctx.reason + '）——' + detail + '，本项计通过',
    marker: DISTRIBUTION_MARKERS[ctx.kind],
  };
}

// 分发面回传契约夹具（环境无关；K14 在副本 early-return 之前调用，故两侧都会真跑）：
//   ① 失败路径负例必须 throw——copy ctx + source marker / source ctx + copy marker /
//      undefined 或非法 marker / 副本环境回传两个「原因态」（缺可注入 ctx 接缝时这些路径没有调用者）；
//   ② 接缝正例：两侧 marker 与 ctx 匹配时必须通过（含两个原因态）；
//   ③ copy 形态真实判据 + helper 文案/marker 同源产出；
//   ④ 子断言记录器契约：登记 → 摘要行 → 取空；空 assertion/reason 必须 fail-closed。
function assertDistributionOutcomeContract(scratch) {
  const expectThrow = (fn, label) => {
    let threw = null;
    try { fn(); } catch (e) { threw = e; }
    if (!threw) throw new Error('分发面回传契约失配（' + label + '）：失败路径应抛错而未抛错');
  };
  // ① 失败路径负例先驱动：接缝缺失时先在此以「应抛错而未抛错」暴露，不被后续环境相关失败掩盖
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:copy ctx + source marker', DISTRIBUTION_MARKERS.source, { kind: 'copy', reason: '夹具' }), 'copy ctx + source marker');
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:source ctx + copy marker', DISTRIBUTION_MARKERS.copy, { kind: 'source' }), 'source ctx + copy marker');
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:undefined marker', undefined, { kind: 'copy', reason: '夹具' }), 'undefined marker');
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:非法 marker', 'distribution:unknown', { kind: 'copy', reason: '夹具' }), '非法 marker');
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:copy ctx + platform marker', DISTRIBUTION_MARKERS.platform, { kind: 'copy', reason: '夹具' }), 'copy ctx + platform marker');
  expectThrow(() => assertDistributionOutcome('分发面契约夹具:copy ctx + tool-missing marker', DISTRIBUTION_MARKERS.toolMissing, { kind: 'copy', reason: '夹具' }), 'copy ctx + tool-missing marker');
  // ② 接缝正例
  assertDistributionOutcome('分发面契约夹具:copy 正例', DISTRIBUTION_MARKERS.copy, { kind: 'copy', reason: '夹具' });
  assertDistributionOutcome('分发面契约夹具:source 正例', DISTRIBUTION_MARKERS.source, { kind: 'source' });
  assertDistributionOutcome('分发面契约夹具:platform 正例', DISTRIBUTION_MARKERS.platform, { kind: 'source' });
  assertDistributionOutcome('分发面契约夹具:tool-missing 正例', DISTRIBUTION_MARKERS.toolMissing, { kind: 'source' });
  // ③ copy 形态真实判据 + helper 文案/marker 同源
  const copyCtx = resolvePackageContext(path.join(scratch, 'k14-copy-probe'));
  if (copyCtx.kind !== 'copy' || typeof copyCtx.reason !== 'string' || copyCtx.reason.trim() === '') {
    throw new Error('分发面回传契约夹具 copy 判据失配: ' + JSON.stringify(copyCtx));
  }
  const copyOutcome = copyDistributionOutcome(copyCtx, K14_COPY_DETAIL);
  if (copyOutcome.marker !== DISTRIBUTION_MARKERS.copy) {
    throw new Error('分发面回传契约 copy marker 失配: ' + JSON.stringify(copyOutcome.marker));
  }
  if (!copyOutcome.message.includes('不适用（安装副本侧：' + copyCtx.reason + '）')
      || !copyOutcome.message.includes(K14_COPY_DETAIL)
      || !copyOutcome.message.includes('本项计通过')) {
    throw new Error('分发面回传契约 copy 文案失配: ' + JSON.stringify(copyOutcome.message));
  }
  // ④ helper 非 copy ctx 必须 fail-closed（不得把 source marker 伪装成「不适用」）
  expectThrow(() => copyDistributionOutcome({ kind: 'source' }, 'x'), 'copy helper 非 copy ctx');
  // ⑤ 子断言记录器契约：登记即出声（显式行）+ 摘要可逐条取回 + 取空后不再重复；畸形入参 fail-closed。
  const recorder = createOutcomeRecorder();
  if (recorder.drain().length !== 0) throw new Error('子断言记录器初始应为空');
  expectThrow(() => recorder.notApplicablePlatform('', 'x'), '记录器空 assertion');
  expectThrow(() => recorder.notApplicablePlatform('x', '  '), '记录器空 reason');
  recorder.notApplicablePlatform('分发面契约夹具:平台子断言', '夹具平台原因');
  const drained = recorder.drain();
  if (drained.length !== 1 || drained[0].marker !== DISTRIBUTION_MARKERS.platform
      || drained[0].assertion !== '分发面契约夹具:平台子断言' || drained[0].reason !== '夹具平台原因') {
    throw new Error('子断言记录器回传失配: ' + JSON.stringify(drained));
  }
  if (recorder.drain().length !== 0) throw new Error('子断言记录器取空后不得重复产出（跨项串味）');
  // ⑥ 三态读数映射：三个条目级标记各有归属，「未执行 / 不适用」不得落回 passed
  const stateOf = [
    [DISTRIBUTION_MARKERS.source, 'passed'],
    [DISTRIBUTION_MARKERS.copy, 'not-applicable'],
    [DISTRIBUTION_MARKERS.toolMissing, 'not-executed'],
    [DISTRIBUTION_MARKERS.platform, null],
    [undefined, null],
  ];
  for (const [marker, expected] of stateOf) {
    if (distributionState(marker) !== expected) {
      throw new Error('三态读数映射失配: ' + JSON.stringify(marker) + ' 应 ' + JSON.stringify(expected)
        + '，实际 ' + JSON.stringify(distributionState(marker)));
    }
  }
  console.log('  分发面回传契约: copy 文案/marker + 两侧与两原因态正例 + 四类失败路径负例 + 子断言记录器/三态映射 ✓');
}

// 跑 `npm pack --dry-run --json`（只读，不产出 tarball）并解析出产物相对路径清单。
// 命令以字符串形态经 shell 执行（与 workflow-guard verify 命令执行同形态）：Windows 上 npm 是
// npm.cmd（CreateProcess 不解析 .cmd 后缀，且 Node 对 .cmd/.bat 直接 spawn 属 EINVAL）——
// 字符串 + shell 是全平台唯一稳妥形态。解析失败即报错（不做文本兜底：静默回退会掩盖 npm 形态漂移）。
function runNpmPackDryRun(root) {
  const res = spawnSync('npm pack --dry-run --json', {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const status = res.status ?? 1;
  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  if (status !== 0) {
    throw new Error('npm pack --dry-run 退出码 ' + status + '（npm 缺失或环境异常）\nstdout:\n' + stdout + '\nstderr:\n' + stderr);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    throw new Error('npm pack --dry-run --json 输出不可解析: ' + e.message + '\nstdout(前 500 字):\n' + stdout.slice(0, 500) + '\nstderr:\n' + stderr);
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const files = entry && Array.isArray(entry.files) ? entry.files.map((f) => String(f.path).replaceAll('\\', '/')) : null;
  if (!files || files.length === 0) throw new Error('npm pack --dry-run 产物清单为空（--json 未列出任何文件）');
  return files;
}

// ① 清单可发布性：`private` 在场即 npm 拒绝发布——被误加回会让包不可发布，而包体边界断言
// （按效果覆盖 files/version）与 CI 版本对账都察觉不到，故独立成锚。允许缺席或显式非真值。
// 同时守住公开身份与运行时前提（license / engines.node）：这些元数据随版本固化在发布物上，
// 发布后才察觉漏声明只能等下一个版本补救，故与 private 同点做在场锚定。
function assertPublishableManifest(pkg) {
  if (pkg.private) {
    throw new Error('package.json 的 private 应缺席（或显式非真值），实际 ' + JSON.stringify(pkg.private)
      + '——置真值会让 npm 拒绝发布');
  }
  if (pkg.license !== 'MIT') {
    throw new Error('package.json 的 license 应为 MIT（与仓库 LICENSE 文件一致），实际 '
      + JSON.stringify(pkg.license) + '——包被 npm 打进发布物时该字段随版本固化');
  }
  const nodeFloor = pkg.engines ? pkg.engines.node : undefined;
  if (nodeFloor !== '>=18') {
    throw new Error('package.json 的 engines.node 应为 >=18（文档与 CI 声明的运行时前提），实际 '
      + JSON.stringify(nodeFloor) + '（engines 整段缺失时为 undefined）');
  }
  console.log('  清单可发布性: private 缺席 / license=' + pkg.license + ' / engines.node=' + nodeFloor + ' ✓');
}

// 随包 scripts/ 面的唯一白名单（包体边界与本项反向构造的载体共用同一常量）：bin 双入口两个 +
// `scripts/lib/` 下安装器的六个职责模块（入口静态 import 全部六个，缺一即启动失败）。
// `package.json` 的 `files` 以**目录级**纳入 `scripts/lib`（新增模块不登记即被判越界，fail-closed），
// 故「实际进包集合」由本白名单判等：多一件 = 未纳管进包，少一件 = 发布后 ERR_MODULE_NOT_FOUND。
// CI 的 installer job 是同一判据的**独立实现**（两侧没有任何机制能发现彼此失同步，改动任一侧必须同步）。
export const PACKED_SCRIPTS = [
  'scripts/prepare-env.mjs',
  'scripts/dsh-bridge.mjs',
  'scripts/lib/installer-platforms.mjs',
  'scripts/lib/installer-migrate.mjs',
  'scripts/lib/installer-hooks.mjs',
  'scripts/lib/installer-loader.mjs',
  'scripts/lib/installer-cleanup.mjs',
  'scripts/lib/installer-flowkit.mjs',
];

// ② 包体边界：必含面在场 / 私有面零命中 / scripts 面精确等于白名单 / 顶层白名单 fail-closed /
// 权威源技能树逐文件在场（漏收 = 安装期炸或平台静默退化——协议 JSON 也在内）。
function assertPackageBoundary(root) {
  const files = runNpmPackDryRun(root);
  const packedUnder = (prefix) => files.some((p) => p.startsWith(prefix + '/'));
  const required = [
    ['.flow-comet/skills', () => packedUnder('.flow-comet/skills')],
    ['.flow-comet/rules/flow-comet-orchestration.md', () => files.includes('.flow-comet/rules/flow-comet-orchestration.md')],
    ...PACKED_SCRIPTS.map((p) => [p, () => files.includes(p)]),
  ];
  for (const [label, ok] of required) {
    if (!ok()) throw new Error('包体缺少必需路径: ' + label);
  }
  // 私有面零命中（提交钩子与本地词表 / 仓库工作笔记 / 流程工件 / 仓库级 AI 上下文与 CI 资产 / 演示图）
  const forbidden = ['.githooks/', 'docs/internal/', '.specs/', 'CLAUDE.md', 'AGENTS.md', '.github/', 'images/'];
  for (const prefix of forbidden) {
    const hit = files.filter((p) => p === prefix.replace(/\/$/, '') || p.startsWith(prefix));
    if (hit.length > 0) throw new Error('包体含私有面路径 ' + prefix + ': ' + hit.slice(0, 5).join(', '));
  }
  // 随包 scripts/ 面精确等于白名单（本地工具脚本——提交钩子安装器/本地检查器一类——不得进包）
  const extraScripts = files.filter((p) => p.startsWith('scripts/') && !PACKED_SCRIPTS.includes(p));
  if (extraScripts.length > 0) {
    throw new Error('包体含未纳管的 scripts/ 条目（本地工具脚本不得进包）: ' + extraScripts.join(', '));
  }
  // 顶层条目仅允许已声明的两棵子树 + npm 恒定携带项（白名单 fail-closed：新增顶层目录默认不得进包）
  const allowedTopLevel = ['.flow-comet', 'scripts', 'package.json', 'README.md', 'LICENSE'];
  const unexpectedTop = [...new Set(files.map((p) => p.split('/')[0]))].filter((t) => !allowedTopLevel.includes(t));
  if (unexpectedTop.length > 0) {
    throw new Error('包体顶层出现白名单外条目（新增顶层目录默认不得进包）: ' + unexpectedTop.join(', '));
  }
  // 仅忽略 npm 恒定排除的操作系统垃圾文件（跨平台检出物，非包体声明面）
  const osJunk = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];
  const skillsOnDisk = collectTreeFiles(path.join(root, '.flow-comet', 'skills'))
    .filter((p) => !osJunk.includes(path.basename(p)))
    .map((p) => '.flow-comet/skills/' + p.replaceAll('\\', '/'));
  const missingSkills = skillsOnDisk.filter((p) => !files.includes(p));
  if (missingSkills.length > 0) throw new Error('包体漏收技能树文件: ' + missingSkills.slice(0, 5).join(', '));
  console.log('  包体边界: ' + files.length + ' 文件，技能树 ' + skillsOnDisk.length + ' 文件逐文件在场，'
    + 'scripts 面 ' + PACKED_SCRIPTS.length + ' 项精确在场（零越界），私有面零命中 ✓');
}

// ③b workflow contract 检查（`comet-check.mjs`）：包内**必含面清单**的自动锚。它此前全仓无任何
// CI/套件调用——清单漂移没有红灯（本批移出两个参考文件时只能靠手工同步清单）。判据两层：
//   ① 真实执行权威源的该脚本 → exit 0 且输出 `workflow-contract-ok`（清单与真实树一致）；
//   ② 反向构造（同一判据驱动）：把技能树复制到临时载体、删掉清单里的一个必含文件 → 该脚本必须
//      exit ≠ 0 且报 `Missing required workflow contract files`（清单是真在查，不是恒真输出）。
function assertWorkflowContractCheck(scratch) {
  const checker = path.join(SCRIPTS_DIR, 'comet-check.mjs');
  if (!fs.existsSync(checker)) throw new Error('缺少 comet-check.mjs: ' + checker);
  const runChecker = (script) => {
    const res = spawnSync(process.execPath, [script], { cwd: path.dirname(script), encoding: 'utf8', timeout: 60000 });
    return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
  };
  const real = runChecker(checker);
  if (real.status !== 0 || !real.output.includes('workflow-contract-ok')) {
    throw new Error('comet-check.mjs 未通过（包内必含面清单与真实树漂移）\n退出码 ' + real.status
      + '\n输出:\n' + real.output);
  }
  // 反向构造：临时载体上一份技能树副本，删掉清单中的一个必含文件 ⇒ 必失败。
  const carrier = path.join(scratch, 'contract-carrier');
  fs.mkdirSync(carrier, { recursive: true });
  fs.cpSync(path.join(SCRIPTS_DIR, '..', '..'), path.join(carrier, 'skills'), { recursive: true });
  const copiedChecker = path.join(carrier, 'skills', 'flow-comet', 'scripts', 'comet-check.mjs');
  const removedRel = path.join('skills', 'flow-comet', 'reference', 'decision-points.md');
  const removedAbs = path.join(carrier, removedRel);
  if (!fs.existsSync(removedAbs)) {
    throw new Error('反向构造前提不成立：清单必含文件不在副本内 ' + removedRel);
  }
  fs.rmSync(removedAbs);
  const broken = runChecker(copiedChecker);
  if (broken.status === 0 || !broken.output.includes('Missing required workflow contract files')) {
    throw new Error('comet-check.mjs 反向构造判别力缺失（删掉清单必含文件后仍通过）\n退出码 '
      + broken.status + '\n输出:\n' + broken.output);
  }
  console.log('  workflow contract 检查: 权威源 exit 0（workflow-contract-ok）+ 缺件副本必失败 ✓');
}

// ③ bin 双入口契约：两个命令名同指同一安装器（同一实现 = 行为一致的结构事实）。返回安装器绝对路径。
function assertBinContract(pkg, root) {
  const binTarget = 'scripts/prepare-env.mjs';
  const bin = pkg.bin && typeof pkg.bin === 'object' ? pkg.bin : null;
  if (!bin) throw new Error('package.json 缺 bin 声明（双入口契约）');
  for (const name of ['fcomet', 'flow-comet']) {
    if (bin[name] !== binTarget) {
      throw new Error('bin["' + name + '"] 应指向 ' + binTarget + '，实际 ' + JSON.stringify(bin[name]));
    }
  }
  const installer = path.join(root, ...binTarget.split('/'));
  if (!fs.existsSync(installer)) throw new Error('bin 目标文件不存在: ' + binTarget);
  console.log('  bin 双入口: fcomet / flow-comet → ' + binTarget + '（同一实现）✓');
  return installer;
}

// ④ init 词元形态与红线（负例常驻：变形/重复词元绝不被静默吞成默认安装）。cwd 用场景临时目录。
function assertInitTokenContract(installer, cwd) {
  const runInstaller = (args) => {
    const res = spawnSync(process.execPath, [installer, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
    return { status: res.status ?? 1, stdout: String(res.stdout || ''), stderr: String(res.stderr || '') };
  };
  const withInit = runInstaller(['init', '--help']);
  if (withInit.status !== 0) {
    throw new Error('`init` 词元形态应退 0（`fcomet init --help`），实际 ' + withInit.status + '\n' + withInit.stderr);
  }
  if (!withInit.stdout.includes('fcomet init')) throw new Error('用法输出未含 `fcomet init` 形态:\n' + withInit.stdout);
  const bare = runInstaller(['--help']);
  if (bare.status !== 0) throw new Error('裸形态（无 init 词元）`--help` 行为应不变（退 0），实际 ' + bare.status + '\n' + bare.stderr);
  for (const bad of ['inti', 'int', 'install', 'init init']) {
    const res = runInstaller(bad.split(' '));
    if (res.status !== 1) throw new Error('变形/重复词元 `' + bad + '` 必须退 1，实际 ' + res.status + '\n' + res.stdout);
    if (!res.stderr.includes('未知参数')) {
      throw new Error('变形/重复词元 `' + bad + '` 的 stderr 应含「未知参数」，实际:\n' + res.stderr);
    }
  }
  // ⑤ 版本查询：`--version` / `-v` 退 0 且输出本工具的版本标识（同一个解析来源，不另设常量）。
  // 断言做成**状态无关**，因为「版本面已 bump、tag 尚未打」是发布准备的常态：此时随包标记
  // 领先于 git describe（标记 = 待发版本，describe = 旧 tag + 提交数）。两条合法来源：
  //   ① 随包分发的权威源标记（包形态 / 发布后命中）；② 当前 tag 的开发态后缀 `<tag>-N-g<hash>`。
  // 等值断言会在发布准备期误红——那不是缺陷，是顺序（先改版本面、后打 tag）。
  const versionShape = /^\d+\.\d+\.\d+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
  const installedVersion = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'INSTALLED_VERSION'), 'utf8').trim();
  let headTag = '';
  try {
    const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
    headTag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: repoRoot, encoding: 'utf8', timeout: 30000 }).trim().replace(/^v/, '');
  } catch { /* 无 git 或无 tag：只按随包标记比对 */ }
  for (const flag of ['--version', '-v']) {
    const res = runInstaller([flag]);
    if (res.status !== 0) {
      throw new Error('`' + flag + '` 应退 0（版本查询不是错误），实际 ' + res.status + '\n' + res.stderr);
    }
    const printed = res.stdout.trim();
    if (!versionShape.test(printed)) {
      throw new Error('`' + flag + '` 的输出不是版本标识形态: ' + JSON.stringify(printed));
    }
    // 等值、或**以「版本 + `-`」为界**的开发态后缀——不能裸用前缀匹配：`1.5.10` 会被
    // `startsWith('1.5.1')` 收下，把「族外的更长版本号」误判为一致（实测：注入 1.5.10 时
    // 裸前缀谓词全绿通过）。边界字符取 `-`，正合 git describe 的后缀形态 `<tag>-N-g<hash>`。
    const matchesMarker = printed === installedVersion || printed.startsWith(installedVersion + '-');
    const matchesHeadTag = headTag !== '' && (printed === headTag || printed.startsWith(headTag + '-'));
    if (!matchesMarker && !matchesHeadTag) {
      throw new Error('`' + flag + '` 的输出与「随包标记 / 当前 tag」都不一致（标记=' + installedVersion + ' tag=' + headTag + '）: ' + JSON.stringify(printed));
    }
  }
  console.log('  版本查询: `--version` / `-v` 退 0 且输出为版本标识形态（标记=' + installedVersion + ' / 当前 tag=' + headTag + '）✓');
  // ⑥ 零参数裸调用不得安装到当前目录（本轮修正）：无参数 = 没说要做什么，
  //    应当在当前目录留下零产物并给出用法与非零退出码。修复前它会做一次完整安装
  //    （.claude/ + flow-kit/ + 改写 .gitignore）→ 误敲即在当前目录铺开一套环境。
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-action-'));
  try {
    seedForeignFlowKit(emptyDir); // 预置同名非上游目录：走「已跳过」路径，零网络接触
    const bareRun = spawnSync(process.execPath, [installer], { cwd: emptyDir, encoding: 'utf8', timeout: 60000 });
    const status = bareRun.status ?? 1;
    const stderr = String(bareRun.stderr || '');
    if (status === 0) {
      throw new Error('零参数裸调用不得退 0（它做了/声称做了一次安装）；实际退 0\n' + String(bareRun.stdout || '').slice(-300));
    }
    if (!stderr.includes('用法')) {
      throw new Error('零参数裸调用的 stderr 应给出用法，实际:\n' + stderr);
    }
    // 用法必须**整段**在 stderr：只断言「stderr 含用法」会漏掉「部分行仍写 stdout」的实现
    // （首行在 stderr 即满足该断言，其余行可能被劈到 stdout——实测出现过）。故此处两侧同判：
    // stderr 末尾行在场，且 stdout 为空。
    if (!/--version 打印版本标识/.test(stderr)) {
      throw new Error('用法末行不在 stderr（用法输出被劈到 stdout）：stderr 实际:\n' + stderr);
    }
    if (String(bareRun.stdout || '').trim() !== '') {
      throw new Error('零参数裸调用的 stdout 应为空（用法整段走 stderr），实际:\n' + String(bareRun.stdout));
    }
    if (fs.existsSync(path.join(emptyDir, '.claude'))) {
      throw new Error('零参数裸调用不得在当前目录留下安装产物（.claude/ 被创建）');
    }
    console.log('  零参数裸调用: 非零退出 + 用法整段在 stderr + stdout 空 + 当前目录零产物 ✓');
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
  console.log('  init 词元: `init --help` 退 0 且含 fcomet init / 裸形态行为不变 / 变形·重复词元 4 例退 1 且报未知参数 ✓');
}

// ---------- 安装器升级路径清理断言助手（生成物镜像面：权威源已删除 / 改名的条目不得残留） ----------

// 升级路径清理断言（分发面：安装器的生成物镜像面）——判据 = 真实安装器命令序列 + 文件系统事实，
// 而不是「安装器退出码为 0」（后者会被「安装照常成功」恒真满足，清理实现整体缺席也不会变红）：
//   ① 删该删的：镜像目录内「权威源已不存在」的条目，重装后必须消失（含清空后的目录本身）；
//   ② 不该删的必不删（反向探针，逐条）：权威源仍存在的文件 / 用户自有技能（无 flow-comet
//      命名空间）/ 命名空间内但权威源整个技能目录不在场（安装器没有生成清单，无法判定该目录
//      「确由上次生成写入」）/ copyTree 目标但路径不含命名空间（.claude/rules）/ 项目根用户文件；
//   ③ 输出可核对：被清理条目逐条打印；④ 幂等：第二次重装零清理项、零报错。
// 夹具名刻意取合成形态，不占用真实工件名（将来权威源重新引入同名文件时夹具前提不失配）——
// 同时以「权威源确实不含该名」为前提断言，防止夹具退化成恒真空过。
function assertInstallerUpgradePathCleanup(scratch) {
  const pkgCtx = resolvePackageContext();
  if (pkgCtx.kind === 'copy') {
    console.log('  不适用（安装副本侧：' + pkgCtx.reason + '）——安装器升级路径清理断言仅权威源侧可判，本项计通过');
    return;
  }
  const installer = path.join(pkgCtx.root, 'scripts', 'prepare-env.mjs');
  const target = path.join(scratch, 'upgrade-path');
  fs.mkdirSync(target, { recursive: true });
  seedForeignFlowKit(target); // 预置同名非上游目录：flow-kit 走「已跳过」路径，零网络接触
  const skillsRoot = path.join(target, '.claude', 'skills');
  const runInstall = () => runInstallerOnce(installer, target);
  const mustNotExist = (rel, label) => {
    const p = path.join(skillsRoot, rel);
    if (fs.existsSync(p)) throw new Error('升级重装后权威源已不存在的生成物仍残留（' + label + '）: ' + p);
  };
  const mustExist = (rel, label) => {
    const p = path.join(skillsRoot, rel);
    if (!fs.existsSync(p)) throw new Error('升级重装误删了不该删的条目（' + label + '）: ' + p);
  };
  // ① 首次安装（等价「上一代生成物」：内容与权威源一致）
  assertExit(runInstall(), 0);
  // ② 夹具：模拟上一代生成、而权威源已删除 / 改名的三类形态（文件 / 嵌套文件 / 目录树 + 空目录）
  const staleFile = 'flow-comet/legacy-guidance.md';
  const staleNested = 'flow-comet/reference/legacy-notes.md';
  const staleDir = 'flow-comet/reference/legacy-subagents';
  const staleEmptyDir = 'flow-comet/reference/legacy-empty';
  writeFile(target, path.posix.join('.claude/skills', staleFile), 'stale\n');
  writeFile(target, path.posix.join('.claude/skills', staleNested), 'stale\n');
  writeFile(target, path.posix.join('.claude/skills', staleDir, 'author.md'), 'stale\n');
  fs.mkdirSync(path.join(skillsRoot, staleEmptyDir), { recursive: true });
  for (const rel of [staleFile, staleNested, staleDir, staleEmptyDir]) {
    if (fs.existsSync(path.join(pkgCtx.root, '.flow-comet', 'skills', rel))) {
      throw new Error('夹具前提失效：权威源已含 ' + rel + '——请改用其它合成名');
    }
  }
  // ③ 反向探针夹具（不该删的必不删）
  writeFile(target, '.claude/skills/my-own-skill/SKILL.md', 'user skill\n');
  writeFile(target, '.claude/skills/flow-comet-fork/SKILL.md', 'unattributable dir\n');
  writeFile(target, '.claude/rules/user-rule.md', 'user rule\n');
  writeFile(target, 'USER_KEEP.md', 'user file\n');
  // ④ 升级重装（真实安装器第二次运行同一平台）
  const upgrade = runInstall();
  assertExit(upgrade, 0);
  // ⑤ 删该删的（三类形态逐条）
  mustNotExist(staleFile, '改名残留文件');
  mustNotExist(staleNested, '移出残留文件');
  mustNotExist(staleDir, '残留目录（内容清空后应一并移除）');
  mustNotExist(staleEmptyDir, '残留空目录');
  // ⑥ 不该删的必不删（逐条反向探针）
  mustExist('flow-comet/reference/entry-detail.md', '权威源仍存在的文件');
  mustExist('flow-comet/SKILL.md', '权威源技能主体');
  mustExist('my-own-skill/SKILL.md', '用户自有技能（无 flow-comet 命名空间）');
  mustExist('flow-comet-fork/SKILL.md', '命名空间内但权威源整个技能目录不在场——归属不可判定，fail-closed 保留');
  if (!fs.existsSync(path.join(target, '.claude', 'rules', 'user-rule.md'))) {
    throw new Error('白名单外生成面（.claude/rules）的用户文件被误删');
  }
  if (!fs.existsSync(path.join(target, 'USER_KEEP.md'))) throw new Error('项目根用户文件被误删');
  // ⑦ 输出可核对：被清理条目逐条打印（人可复核「删了什么」）
  for (const rel of [staleFile, staleNested, staleDir, staleEmptyDir]) {
    const name = path.posix.basename(rel);
    if (!upgrade.output.includes(name)) {
      throw new Error('清理输出未逐条打印被清理条目（缺 ' + name + '）:\n' + upgrade.output);
    }
  }
  // ⑦b 播报标记钉死：⑧ 的「重跑无清理项」是**负向**断言——标记一旦改名它便恒真；正向锚在此
  // （标记须在首次升级输出里在场），标记契约的漂移因此必然红，而不是静默失效。
  if (!upgrade.output.includes('镜像清理: 已删除')) {
    throw new Error('升级重装输出缺清理播报标记「镜像清理: 已删除」:\n' + upgrade.output);
  }
  // ⑧ 幂等：第二次重装零清理项、零报错（重复跑不删多、不重复打印）
  const again = runInstall();
  assertExit(again, 0);
  if (again.output.includes('镜像清理')) {
    throw new Error('幂等失配：第二次重装仍报告清理动作:\n' + again.output);
  }
  console.log('  升级路径清理: 残留 4 项消失（文件 / 嵌套文件 / 目录树 / 空目录）+ 6 条反向探针保留 + 输出可核对 + 幂等 ✓');
}

// 安装器单次真实运行（两处安装器分发面断言共用同一命令形态——同一知识只有一份实现）
function runInstallerOnce(script, target) {
  const res = spawnSync(process.execPath, [script, '--target', target, '--platform', 'claude-code'], {
    cwd: target, encoding: 'utf8', timeout: 120000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 把 linkPath 置为指向 targetDir 的链接（夹具构造与清理共用）：递归删除会跟随链接目标，
// 故先按链接自身解链，再删可能残留的普通目录。
function replaceWithLink(linkPath, targetDir) {
  try {
    if (fs.lstatSync(linkPath).isSymbolicLink()) fs.unlinkSync(linkPath);
  } catch { /* 不在场——无需解链 */ }
  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(targetDir, linkPath, 'junction');
}

// 镜像清理的**根级** fail-closed 断言（同上一条属同一分发面项）——判据 = 真实安装器命令序列 + 文件系统事实：
//   根以下的条目层检查拦不住「镜像根自身是链接」：readdir 会跟随进链接目标，清理动作落在**项目之外**，
//   而播报打印的仍是项目内的表象路径（真实落点不可见）。两条判据各需一个变体驱动，缺任一变体则
//   对应那条判据整体缺席也不会有红灯：
//     变体 A「镜像根自身是指向项目外目录的链接」 ⇒ 根级链接判据（不跟随）；
//     变体 B「父级目录是链接、镜像根自身是普通目录」 ⇒ 真实路径包含性判据（词法路径仍在项目内，
//       只有解析真实路径才能证否；此变体下 A 判据必然不命中，故它是包含性判据的独占探针）。
//   断言（两变体同）：链接目标内的项目外文件**必不消失** + 输出含逐条保留原因 + 重复运行零删除项。
//   反向构造见 assertMirrorRootReverseConstruction（同一判据驱动，证明断言不恒真空过）。
function assertMirrorRootLinkFailClosed(scratch, pkgCtx) {
  if (pkgCtx.kind === 'copy') {
    console.log('  不适用（安装副本侧：' + pkgCtx.reason + '）——镜像清理根级判据的探针仅权威源侧可判，本组计通过');
    return;
  }
  const installer = path.join(pkgCtx.root, 'scripts', 'prepare-env.mjs');
  // 变体 A：镜像根自身 = 指向项目外目录的链接
  const targetA = path.join(scratch, 'mirror-root-link-self');
  const outsideA = path.join(scratch, 'mirror-root-link-self-outside');
  seedForeignFlowKit(targetA);
  writeFile(outsideA, 'EXTERNAL-NOTE.md', 'out-of-tree user content\n');
  writeFile(outsideA, path.posix.join('nested', 'DEEP-NOTE.md'), 'out-of-tree user content\n');
  replaceWithLink(path.join(targetA, '.claude', 'skills', 'flow-comet'), outsideA);
  // 变体 B：父级目录 = 链接（镜像根自身是目标内的普通目录）
  const targetB = path.join(scratch, 'mirror-root-link-ancestor');
  const outsideB = path.join(scratch, 'mirror-root-link-ancestor-outside');
  seedForeignFlowKit(targetB);
  writeFile(outsideB, path.posix.join('flow-comet', 'EXTERNAL-NOTE.md'), 'out-of-tree user content\n');
  replaceWithLink(path.join(targetB, '.claude', 'skills'), outsideB);
  const mirrorB = path.join(targetB, '.claude', 'skills', 'flow-comet');
  if (!fs.existsSync(mirrorB) || fs.lstatSync(mirrorB).isSymbolicLink()) {
    throw new Error('变体 B 前提失效：镜像根自身不是普通目录（应只有父级是链接）: ' + mirrorB);
  }
  const variants = [
    { label: '镜像根自身为链接', target: targetA, outsideFile: path.join(outsideA, 'EXTERNAL-NOTE.md'), reasonPattern: /镜像根是符号链接\/junction/ },
    { label: '镜像根真实路径越界', target: targetB, outsideFile: path.join(outsideB, 'flow-comet', 'EXTERNAL-NOTE.md'), reasonPattern: /越出目标项目根/ },
  ];
  for (const v of variants) assertLinkTargetPreserved(installer, v);
  assertMirrorRootReverseConstruction(scratch, pkgCtx, installer, variants);
  console.log('  镜像清理根级判据: 根自身为链接 / 真实路径越界 两变体下项目外文件保全 + 保留原因可见 + 幂等；'
    + '反向构造（判据改恒真）两变体必被越界删除 ✓');
}

// 「链接目标内的项目外文件必不消失」断言（两变体同形）：项目外文件仍在 + 输出含逐条保留原因 +
// 原因指明命中的判据 + 重复运行零删除项且文件仍在（保留是**可见的决定**，不是静默跳过）。
function assertLinkTargetPreserved(installer, { label, target, outsideFile, reasonPattern }) {
  const first = runInstallerOnce(installer, target);
  assertExit(first, 0);
  if (!fs.existsSync(outsideFile)) {
    throw new Error(label + '：镜像清理越界删除了项目之外的文件（真实落点 ' + outsideFile + '）\n输出:\n' + first.output);
  }
  if (!first.output.includes('镜像清理保留')) {
    throw new Error(label + '：输出未逐条打印保留原因——fail-closed 保留必须是可见的决定\n输出:\n' + first.output);
  }
  if (!reasonPattern.test(first.output)) {
    throw new Error(label + '：保留原因未指明命中判据（缺 ' + reasonPattern + '）\n输出:\n' + first.output);
  }
  const second = runInstallerOnce(installer, target);
  assertExit(second, 0);
  if (second.output.includes('镜像清理: 已删除')) {
    throw new Error(label + '：重复运行仍报告删除动作（幂等失配）\n输出:\n' + second.output);
  }
  if (!fs.existsSync(outsideFile)) {
    throw new Error(label + '：重复运行后项目之外的文件消失（' + outsideFile + '）');
  }
}

// 反向构造（同一判据驱动）：把两处根级判据分别中和为恒真后重跑同一变体 ⇒ 项目外文件**必被删除**；
// 判据落点漂移（判据句被改写）时「前提不成立」先行报错，避免变异无处落点而假绿。
// 变异目标按**模块身份**定位（两处判据都在 lib/installer-cleanup.mjs——描述符/清理职责的归属模块，
// 见设计模块图），不再平铺扫描全部模块；判据句仍按**内容**确认在场（句子漂移 ⇒ 前提不成立，红）。
// 载体按**真实包内 scripts 面**落位（PACKED_SCRIPTS，与包体边界判据同集合）：照着整个 scripts/ 目录
// 搬运会把仓库本地工具也带进载体，使载体比真实包更宽——被拆出的模块即使掉出包体白名单，
// 载体里仍在场（安装照跑），反向构造因此对该类缺口零判别力。
function assertMirrorRootReverseConstruction(scratch, pkgCtx, installer, variants) {
  const carrier = path.join(scratch, 'mirror-root-carrier');
  for (const rel of PACKED_SCRIPTS) {
    const dest = path.join(carrier, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(pkgCtx.root, ...rel.split('/')), dest);
  }
  const cleanupModule = path.join(carrier, 'scripts', 'lib', 'installer-cleanup.mjs');
  if (!fs.existsSync(cleanupModule)) {
    throw new Error('反向构造前提不成立：随包 scripts 面缺安装器清理模块 ' + cleanupModule);
  }
  const neutralize = (sentence) => {
    const text = fs.readFileSync(cleanupModule, 'utf8');
    if (!text.includes(sentence)) return false;
    fs.writeFileSync(cleanupModule, text.replace(sentence, sentence.replace('if (', 'if (false && ')), 'utf8');
    return true;
  };
  if (!neutralize('if (!isRealPathInside(dstRoot, projectRoot)) {')) {
    throw new Error('反向构造前提不成立：真实路径包含性判据的落点未找到（判据句已漂移，变异无处落点）');
  }
  if (!neutralize('if (rootStat.isSymbolicLink()) {')) {
    throw new Error('反向构造前提不成立：根级链接判据的落点未找到（判据句已漂移，变异无处落点）');
  }
  fs.cpSync(path.join(pkgCtx.root, '.flow-comet', 'skills'), path.join(carrier, '.flow-comet', 'skills'), { recursive: true });
  const mutated = path.join(carrier, 'scripts', 'prepare-env.mjs');
  for (const v of variants) {
    const res = runInstallerOnce(mutated, v.target);
    assertExit(res, 0);
    if (fs.existsSync(v.outsideFile)) {
      throw new Error(v.label + ' 反向构造判别力缺失：判据被中和后项目之外的文件仍在（断言可能是恒真空过）\n输出:\n' + res.output);
    }
  }
}

// ---------- 桥接 loader 版本戳重装断言助手（临时 DSH_HOME 重装链路） ----------

// 从权威源 loader 提取版本戳（与安装器/检查器同一锚点标记行；动态取值，版本演进零维护）
function readBridgeSourceVersion(loader) {
  const text = fs.readFileSync(loader, 'utf8');
  const m = /^\/\/ BRIDGE_VERSION: (\S+)$/m.exec(text);
  if (!m) throw new Error('权威源 loader 缺版本戳标记行（契约锚点）: ' + loader);
  return m[1];
}

// 构造指定版本戳的 loader 副本内容（仅替换标记行，其余逐字保持——MISS 检测：替换未命中即报错）
function stampBridgeLoader(sourceLoader, version) {
  const text = fs.readFileSync(sourceLoader, 'utf8');
  const replaced = text.replace(/^\/\/ BRIDGE_VERSION: \S+$/m, '// BRIDGE_VERSION: ' + version);
  if (!replaced.includes('// BRIDGE_VERSION: ' + version)) {
    throw new Error('版本戳替换未命中（MISS）: 目标版本 ' + version);
  }
  return replaced;
}

// 安装副本载体的 bridge-check 版本比较断言：dev 态载体（INSTALLED_VERSION = <发布>-<N>-g<hash>）
// 与同基础版本 loader 判健康，基础版本失配仍 FAIL。以副本自身脚本运行——bridge-check 读取脚本
// 同包 INSTALLED_VERSION，与真实安装载体同构（权威源检出路径固定为发布标记，无法构造 dev 态）。
function assertInstalledCopyBridgeVersionSemantics(target, dshHome, srcVersion) {
  const installedSkillRoot = path.join(target, '.dsh', 'skills', 'flow-comet');
  const installedVersionPath = path.join(installedSkillRoot, 'INSTALLED_VERSION');
  const runBridgeCheck = () => {
    const res = spawnSync(process.execPath, [path.join(installedSkillRoot, 'scripts', 'workflow-state.mjs'), 'bridge-check'], {
      cwd: target, encoding: 'utf8', timeout: 60000, env: { ...process.env, DSH_HOME: dshHome },
    });
    return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
  };
  const devVersion = srcVersion + '-11-g93d96c0';
  fs.writeFileSync(installedVersionPath, devVersion + '\n', 'utf8');
  const devHealthy = runBridgeCheck();
  assertExit(devHealthy, 0);
  assertOut(devHealthy, '[OK] 版本一致性: loader BRIDGE_VERSION=' + srcVersion + ' ~= 项目 INSTALLED_VERSION=' + devVersion);
  assertOut(devHealthy, '（dev 态后缀归一后基础版本 ' + srcVersion + ' 一致）');
  assertOut(devHealthy, 'bridge-check: 健康（全部检查通过）——exit 0');
  const [major] = srcVersion.split('.').map((p) => parseInt(p, 10));
  const otherBase = (major + 9) + '.0.0';
  const otherVersion = otherBase + '-3-gabcdef0';
  fs.writeFileSync(installedVersionPath, otherVersion + '\n', 'utf8');
  const baseMismatch = runBridgeCheck();
  assertExit(baseMismatch, 1);
  assertOut(baseMismatch, '[FAIL] 版本偏斜: loader BRIDGE_VERSION=' + srcVersion + ' != 项目 INSTALLED_VERSION=' + otherVersion + '（归一基础版本: loader=' + srcVersion + ' / installed=' + otherBase + '）——两值如上');
  assertOut(baseMismatch, 'bridge-check: 失配 1 项——exit 1');
}

// 预置目标项目 flow-kit/ 为同名非上游目录（安装器走「非上游克隆，已跳过」路径——
// 网络零接触；与安装器冒烟同手法）
function seedForeignFlowKit(root) {
  const flowKitDir = path.join(root, 'flow-kit');
  fs.mkdirSync(flowKitDir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: flowKitDir, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/not-flow-kit.git'], { cwd: flowKitDir, stdio: 'ignore' });
}

// ---------- hook 注入命令形态判定（托管条目断言放宽决策：断言意图 = 托管条目在场且指向本项目脚本） ----------
// 托管识别 = 脚本 basename(comet-hook-guard.mjs) 在位——与 prepare-env isManagedHookCommand
// 同源语义，新旧托管形态均命中（幂等升级识别面）。
// 项目根引用特征 = CLAUDE_PROJECT_DIR 变量引用（%VAR%/$env:/$_ENV/${VAR} 词形）或绝对路径特征
// （盘符 / 引号·空白·等号后的 POSIX 绝对段）二选一在位——cwd 漂移免疫的形态面；相对路径旧形态
// 两者皆无 → 不达标（升级替换判据）。断言不锁定具体引号/变量写法（形态无关化，以特征断言补偿
// 精度——注入命令实测微调不再破坏套件）。
function isManagedHookCommand(cmd) {
  return typeof cmd === 'string' && cmd.includes('comet-hook-guard.mjs');
}

function hasProjectRootRef(cmd) {
  if (typeof cmd !== 'string') return false;
  if (/CLAUDE_PROJECT_DIR/i.test(cmd)) return true;
  return /[A-Za-z]:[\\/]/.test(cmd) || /["'\s=]\/[^\s"']/.test(cmd);
}

function assertManagedHookEntry(cmd, label) {
  if (!isManagedHookCommand(cmd)) {
    throw new Error(label + ' 缺托管脚本 basename(comet-hook-guard.mjs): ' + String(cmd));
  }
  if (!hasProjectRootRef(cmd)) {
    throw new Error(label + ' 缺项目根引用特征(CLAUDE_PROJECT_DIR 或绝对路径二选一在位;相对路径旧形态不具备 cwd 漂移免疫): ' + String(cmd));
  }
}

// 从 settings.local.json / hooks.json 结构提取全部托管 hook 命令(hooks.PreToolUse[].hooks[].command)
function collectManagedHookCommands(configObj) {
  const cmds = [];
  const groups = configObj && configObj.hooks && Array.isArray(configObj.hooks.PreToolUse) ? configObj.hooks.PreToolUse : [];
  for (const g of groups) {
    for (const h of (Array.isArray(g && g.hooks) ? g.hooks : [])) {
      if (isManagedHookCommand(h && h.command)) cmds.push(h.command);
    }
  }
  return cmds;
}

// 多趟链路 SUMMARY 夹具（SUMMARY 模板保真全量满足：标题首行 # SUMMARY: + 首部 4 字段 +
// 段序 做了什么→改动文件→verify 输出→6 维自查→越界检查→自检方法；6 维声明 brooks-review）

// ③ K 组条目表。带 `surface` 声明的条目在导出前统一接入分发面契约（见 applyDistributionSurface）。
const RAW_ENTRIES = [
  // ---------- K. 安装器 ----------

  {
    name: 'K1 安装器：版本标识由安装器生成且精确反映源仓库状态',
    surface: '版本标识解析（包内直跑 + git describe 信任边界）仅权威源侧可判',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      if (!fs.existsSync(installer)) throw new Error('缺少 prepare-env.mjs');
      const target = path.join(dir, 'j3-target');
      fs.mkdirSync(target, { recursive: true });
      const res = spawnSync(process.execPath, [installer, '--target', target], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (res.status !== 0) throw new Error('prepare-env 失败: ' + (res.stderr || JSON.stringify(res.output)));
      // 分发主干:权威源随技能包分发的静态文件(手动复制也有效,不依赖安装脚本)
      const srcVersionFile = path.join(repoRoot, '.flow-comet', 'skills', 'flow-comet', 'INSTALLED_VERSION');
      if (!fs.existsSync(srcVersionFile)) throw new Error('缺少权威源 INSTALLED_VERSION(随技能包分发)');
      const srcVersion = fs.readFileSync(srcVersionFile, 'utf8').trim();
      if (!srcVersion) throw new Error('权威源版本标识为空');
      // 权威源须与 CHANGELOG 首个版本段一致(发布批次更新;CI release-consistency 同规则);
      // 版本段可带 prerelease 后缀(如 -rc.1 / -beta-1)
      const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
      const m = changelog.match(/^## \[(\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?)\]/m);
      const expected = m ? m[1] : 'unreleased';
      if (srcVersion !== expected) throw new Error('权威源版本标识不符: ' + srcVersion + ' ≠ CHANGELOG 版本 ' + expected);
      const versionFile = path.join(target, '.claude', 'skills', 'flow-comet', 'INSTALLED_VERSION');
      if (!fs.existsSync(versionFile)) throw new Error('缺少 INSTALLED_VERSION(版本标识文件)');
      const installed = fs.readFileSync(versionFile, 'utf8').trim();
      if (!installed) throw new Error('版本标识为空');
      // 格式:发布版本号(1.3.1) / prerelease(1.5.0-rc.1 或 1.5.0-beta-1) / git describe 开发态(1.3.1-N-g<hash>) / unreleased(无 tag 兜底)
      const ok = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(-\d+-g[0-9a-f]+)?$/.test(installed) || installed === 'unreleased';
      if (!ok) throw new Error('版本标识格式异常: ' + installed);
      // 信任边界：安装器目录**不是仓库根**时（包被装在别人的仓库里——本地安装进项目即是此形态），
      // 不得采信 git describe：它会向上找到宿主仓库，把**宿主 tag** 当成流工具版本。
      // 该解析值是单一来源——`--version` 输出它，`init` 写进目标项目的版本标识也是它，
      // 故此处断言它即覆盖两条路径。修复前实测：输出宿主 tag（9.9.9），且 init 把它写进项目。
      const host = path.join(dir, 'trust-host');
      const pkg = path.join(host, 'node_modules', 'flow-comet');
      fs.mkdirSync(path.join(pkg, '.flow-comet', 'skills', 'flow-comet'), { recursive: true });
      // 假包载体**按真实包形态落位**：scripts/ 面照 `package.json` 的 `files` 白名单搬运
      // （目录级条目递归），不照仓库 scripts/ 目录整搬。载体比真实包更宽时，「模块掉出白名单」
      // 这类缺口在载体里不会 ERR_MODULE_NOT_FOUND——包内直跑照样成功，断言静默失明。
      const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
      const packedScripts = (manifest.files || []).filter((e) => typeof e === 'string' && e.startsWith('scripts/'));
      if (packedScripts.length === 0) {
        throw new Error('package.json 的 files 白名单未声明任何 scripts/ 条目（包内直跑无从构造）');
      }
      for (const rel of packedScripts) {
        const from = path.join(repoRoot, ...rel.split('/'));
        const to = path.join(pkg, ...rel.split('/'));
        if (!fs.existsSync(from)) throw new Error('files 白名单声明的路径不在场: ' + rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (fs.statSync(from).isDirectory()) fs.cpSync(from, to, { recursive: true });
        else fs.copyFileSync(from, to);
      }
      fs.copyFileSync(srcVersionFile, path.join(pkg, '.flow-comet', 'skills', 'flow-comet', 'INSTALLED_VERSION'));
      execFileSync('git', ['init', '-q'], { cwd: host, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: host, stdio: 'ignore' });
      execFileSync('git', ['tag', 'v9.9.9'], { cwd: host, stdio: 'ignore' });
      const nested = spawnSync(process.execPath, [path.join(pkg, 'scripts', 'prepare-env.mjs'), '--version'], { cwd: host, encoding: 'utf8', timeout: 60000 });
      const printed = String(nested.stdout || '').trim();
      if (nested.status !== 0) throw new Error('包内直跑 --version 应退 0，实际 ' + nested.status + '\n' + nested.stderr);
      if (printed === '9.9.9' || printed.startsWith('9.9.9')) {
        throw new Error('版本解析越过了信任边界：安装器目录不是仓库根，却采信了宿主仓库的 tag（输出 ' + printed + '）');
      }
      if (printed !== srcVersion) {
        throw new Error('越界情形应回退随包分发的权威源标识 ' + srcVersion + '，实际 ' + printed);
      }
      if (/fatal:/.test(String(nested.stderr || ''))) {
        throw new Error('版本解析不应把 git 的 fatal 输出漏给用户：\n' + nested.stderr);
      }
      console.log('  版本标识 = ' + installed + '(git describe 或权威源兜底——多人协作精确检测)✓');
      console.log('  信任边界: 包装在他人仓库内 → 取随包标识 ' + srcVersion + '（不采信宿主 tag）✓');
    },
  },

  // ---------- K 扩展：多平台安装器框架 ----------

  // K2: codex 平台安装冒烟——技能落 .agents/skills/ + SKILL 路径平台化替换 + .codex/hooks.json 注入
  // (含 --platform codex 托管命令)+ AGENTS.md 托管区内联 + 纯 codex 不生成 .claude/ + 版本标识
  {
    name: 'K2 安装器:codex 平台安装(技能/路径替换/hooks.json/AGENTS 托管区)',
    surface: 'codex 平台安装产物断言仅权威源侧可判（副本内无安装器源码面）',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const target = path.join(dir, 'k2-target');
      fs.mkdirSync(target, { recursive: true });
      const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'codex'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (res.status !== 0) throw new Error('prepare-env --platform codex 失败: ' + (res.stderr || JSON.stringify(res.output)));
      // ① 技能落 .agents/skills/(Codex 自动发现位置)
      const skillMd = path.join(target, '.agents', 'skills', 'flow-comet', 'SKILL.md');
      if (!fs.existsSync(skillMd)) throw new Error('codex 平台技能未安装到 .agents/skills/');
      // ② SKILL 路径平台化替换生效(命令路径 .claude/skills → .agents/skills)
      const text = fs.readFileSync(skillMd, 'utf8');
      if (!text.includes('.agents/skills/flow-comet/scripts/')) throw new Error('SKILL 命令路径未替换为 .agents/skills/');
      if (text.includes('.claude/skills/flow-comet/scripts/')) throw new Error('SKILL 仍含 .claude/skills/flow-comet/scripts/ 命令路径');
      // ③ .codex/hooks.json 注入托管 hook(顶层 hooks 包裹层 + matcher * + 平台标记)
      const hooksFile = path.join(target, '.codex', 'hooks.json');
      if (!fs.existsSync(hooksFile)) throw new Error('缺少 .codex/hooks.json');
      const hooksParsed = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
      const preToolUse = hooksParsed.hooks && hooksParsed.hooks.PreToolUse;
      if (!Array.isArray(preToolUse) || preToolUse.length === 0) throw new Error('hooks.json 缺 hooks.PreToolUse 包裹层');
      // 托管条目断言形态无关化(断言放宽决策——意图为托管条目在场且指向本项目脚本):脚本 basename 在位 + 项目根引用特征二选一——
      // 兼容新旧两种托管形态,注入命令实测微调(%VAR% 引号/变量词形)不再破坏断言
      const managedCmds = collectManagedHookCommands(hooksParsed);
      if (managedCmds.length === 0) throw new Error('hooks.json 未注入托管 hook 命令');
      for (const c of managedCmds) assertManagedHookEntry(c, 'codex hooks.json 托管命令');
      if (!JSON.stringify(hooksParsed).includes('--platform codex')) throw new Error('hooks.json hook 命令缺平台标记');
      if (preToolUse[0].matcher !== '*') throw new Error('hooks.json matcher 应为 * (Codex PreToolUse 只拦截 Bash 工具): ' + JSON.stringify(preToolUse[0]));
      // ③b .codex/config.toml hooks 启用(features——Codex hooks 默认关闭)
      const configFile = path.join(target, '.codex', 'config.toml');
      if (!fs.existsSync(configFile)) throw new Error('缺少 .codex/config.toml');
      const configText = fs.readFileSync(configFile, 'utf8');
      if (!/\[features\]/.test(configText) || !/hooks\s*=\s*true/.test(configText)) throw new Error('config.toml 未启用 hooks(features)');
      // ④ AGENTS.md 托管区(内联 orchestration 全文——Codex 指令唯一自动加载路径)
      const agentsFile = path.join(target, 'AGENTS.md');
      if (!fs.existsSync(agentsFile)) throw new Error('缺少 AGENTS.md');
      const agents = fs.readFileSync(agentsFile, 'utf8');
      if (!agents.includes('Managed by flow-comet')) throw new Error('AGENTS.md 无托管标记');
      if (!agents.includes('flow-comet Orchestration')) throw new Error('AGENTS.md 未内联 orchestration 内容');
      // ④b 分发词面锁：orchestration 是**每个项目自动加载**的文本（CC 走 .claude/rules/、Codex/dsh 走
      //     AGENTS.md 托管区，三者同源），其用词必须与工具当下的自称一致——不得残留 Comet 时代词汇
      //     （本仓早已移除 bundles/ 双目录、权威源路径也从 bundle-drafts/ 迁走），也不得把**只有两行的
      //     兼容别名壳**列进脚本清单（它不是任何流程的入口，列出来只会让读者去找错文件）。
      for (const banned of ['Bundle', 'control plane']) {
        if (agents.includes(banned)) throw new Error('内联的 orchestration 含 Comet 时代词汇（' + banned + '）——分发文本须与工具当下的自称一致');
      }
      if (agents.includes('comet-plan.mjs')) throw new Error('内联的 orchestration 仍列兼容别名壳 comet-plan.mjs（它不是流程入口）');
      // ⑤ 纯 codex 平台不生成 .claude/
      if (fs.existsSync(path.join(target, '.claude'))) throw new Error('codex 平台不应生成 .claude/');
      // ⑥ 版本标识随技能包分发(平台化路径)
      const verFile = path.join(target, '.agents', 'skills', 'flow-comet', 'INSTALLED_VERSION');
      if (!fs.existsSync(verFile)) throw new Error('缺少 INSTALLED_VERSION(版本标识文件)');
      const installed = fs.readFileSync(verFile, 'utf8').trim();
      if (!installed) throw new Error('版本标识为空');
      // ⑦ .codex/hooks.json 非法 JSON → fail-safe(不覆盖用户配置,报错退出)
      const badTarget = path.join(dir, 'k2-bad-hooks');
      fs.mkdirSync(path.join(badTarget, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(badTarget, '.codex', 'hooks.json'), '{ not json', 'utf8');
      const badRes = spawnSync(process.execPath, [installer, '--target', badTarget, '--platform', 'codex'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (badRes.status === 0) throw new Error('非法 hooks.json 应导致安装失败(fail-safe)');
      const badOut = String(badRes.stderr || '') + String(badRes.stdout || '');
      if (!badOut.includes('已存在但内容非法')) throw new Error('非法 hooks.json 应输出 fail-safe 提示: ' + badOut);
    },
  },

  // K3: hook 平台分支输出契约——codex 分支 stdout 为合法 JSON(拦截含 decision:"block";放行可解析非 block);
  // claude-code 分支(无平台标记)输出与现状一致(文本 workflow-hook-guard-ok)
  {
    name: 'K3 hook:codex 平台分支 JSON 契约(拦截/放行)+ CC 分支不变',
    run: (dir) => {
      // ① codex 分支:写越权路径(源码)→ stdout 合法 JSON + decision block
      const st = baseState('open');
      st.status = 'running';
      writeState(dir, st);
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const block = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(block, 0);
      const blockParsed = JSON.parse(block.output.trim()); // stdout 非 JSON → throw(RED)
      if (blockParsed.decision !== 'block') throw new Error('codex 拦截输出应含 decision:"block": ' + JSON.stringify(blockParsed));
      // ② codex 分支:写 .specs/ 工件 → 放行(输出可解析、非 block)
      const ok = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', CHANGE_ID, 'CHANGE.md') } });
      assertExit(ok, 0);
      const okParsed = JSON.parse(ok.output.trim()); // 放行输出须为合法 JSON(空串解析失败 → RED)
      if (okParsed.decision === 'block') throw new Error('codex 放行输出不应含 decision block');
      // ③ codex 分支:无活跃 workflow → 放行(JSON 可解析)
      fs.rmSync(path.join(dir, '.flow-comet'), { recursive: true, force: true });
      const noActive = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'x.py') } });
      assertExit(noActive, 0);
      JSON.parse(noActive.output.trim());
      // ④ claude-code 分支(无平台标记):输出与现状一致(文本 workflow-hook-guard-ok)
      writeState(dir, { ...baseState('open'), status: 'running' });
      const cc = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', CHANGE_ID, 'CHANGE.md') } });
      assertExit(cc, 0);
      assertOut(cc, 'workflow-hook-guard-ok');
      assertNotOut(cc, 'decision');
      // ⑤ codex 分支:Bash 写入检测(PowerShell 命令字符串——Codex 写路径经 Bash 工具,无 file_path)
      const bashBlock = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: 'Set-Content -LiteralPath "src/evil.py" -Value "x=1"' } });
      assertExit(bashBlock, 0);
      const bashBlockParsed = JSON.parse(bashBlock.output.trim());
      if (bashBlockParsed.decision !== 'block') throw new Error('codex Bash 越权写入应输出 decision block: ' + JSON.stringify(bashBlockParsed));
      // ⑥ codex 分支:Bash 合法写 .specs → 放行
      const bashOk = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: 'Set-Content -LiteralPath ".specs/ch/CHANGE.md" -Value "# CHANGE"' } });
      assertExit(bashOk, 0);
      const bashOkParsed = JSON.parse(bashOk.output.trim());
      if (bashOkParsed.decision === 'block') throw new Error('codex Bash 合法写入不应 block');
      // ⑦ codex 分支:Bash 无写入模式(纯命令)→ 放行
      const bashNone = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: 'python -m pytest test_calculator.py -q' } });
      assertExit(bashNone, 0);
      JSON.parse(bashNone.output.trim());
      // ⑧ codex 分支:读类 cmdlet(Get-Content -Path)→ 无写入语义,放行
      const bashRead = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: 'Get-Content -Path "src/readme.md"' } });
      assertExit(bashRead, 0);
      const bashReadParsed = JSON.parse(bashRead.output.trim());
      if (bashReadParsed.decision === 'block') throw new Error('codex 读类 cmdlet(Get-Content)不应 block');
      // ⑨ codex 分支:.NET File.Copy 目标 = 第二参数(越权目标 → block;合法目标 → 放行)
      const copyBlock = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: '[System.IO.File]::Copy("src/a.txt", "src/b.txt")' } });
      assertExit(copyBlock, 0);
      const copyParsed = JSON.parse(copyBlock.output.trim());
      if (copyParsed.decision !== 'block') throw new Error('codex File.Copy 越权目标(第二参数)应 block');
      const copyOk = runHook(['before_tool', '--platform', 'codex'], dir,
        { tool_name: 'Bash', tool_input: { command: '[System.IO.File]::Copy("src/a.txt", ".specs/ch/b.txt")' } });
      assertExit(copyOk, 0);
      const copyOkParsed = JSON.parse(copyOk.output.trim());
      if (copyOkParsed.decision === 'block') throw new Error('codex File.Copy 合法目标不应 block');
    },
  },

  // K4: 平台选择链——--platform 显式(两平台互不串扰)/ 无 TTY 探测(项目已有 .codex/ 或 .claude/)/ 两者皆无默认
  {
    name: 'K4 安装器:平台选择链(显式/无 TTY 探测/默认)',
    surface: '平台选择链断言仅权威源侧可判（需真实安装器与探测环境）',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const run = (target, envOverrides = {}) => spawnSync(process.execPath, [installer, '--target', target], { cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...envOverrides } });
      // ① --platform claude-code 显式 → .claude/skills 生成,.agents 不生成
      const t1 = path.join(dir, 'k4-cc');
      fs.mkdirSync(t1, { recursive: true });
      const r1 = spawnSync(process.execPath, [installer, '--target', t1, '--platform', 'claude-code'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (r1.status !== 0) throw new Error('--platform claude-code 失败: ' + (r1.stderr || JSON.stringify(r1.output)));
      if (!fs.existsSync(path.join(t1, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('claude-code 平台未生成 .claude/skills/');
      if (fs.existsSync(path.join(t1, '.agents'))) throw new Error('claude-code 平台不应生成 .agents/');
      // ② --platform codex 显式 → .agents/skills 生成,.claude 不生成
      const t2 = path.join(dir, 'k4-codex');
      fs.mkdirSync(t2, { recursive: true });
      const r2 = spawnSync(process.execPath, [installer, '--target', t2, '--platform', 'codex'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (r2.status !== 0) throw new Error('--platform codex 失败: ' + (r2.stderr || JSON.stringify(r2.output)));
      if (!fs.existsSync(path.join(t2, '.agents', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('codex 平台未生成 .agents/skills/');
      if (fs.existsSync(path.join(t2, '.claude'))) throw new Error('codex 平台不应生成 .claude/');
      // ③ 无 --platform(spawnSync 无 TTY)+ 目标已有 .codex/ → 探测为 codex
      const t3 = path.join(dir, 'k4-probe-codex');
      fs.mkdirSync(path.join(t3, '.codex'), { recursive: true });
      const r3 = run(t3);
      if (r3.status !== 0) throw new Error('探测 codex 安装失败: ' + (r3.stderr || JSON.stringify(r3.output)));
      if (!fs.existsSync(path.join(t3, '.agents', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('已有 .codex/ 的项目应探测为 codex 平台');
      // ④ 无 --platform + 目标已有 .claude/ → 探测为 claude-code
      const t4 = path.join(dir, 'k4-probe-cc');
      fs.mkdirSync(path.join(t4, '.claude'), { recursive: true });
      const r4 = run(t4);
      if (r4.status !== 0) throw new Error('探测 claude-code 安装失败: ' + (r4.stderr || JSON.stringify(r4.output)));
      if (!fs.existsSync(path.join(t4, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('已有 .claude/ 的项目应探测为 claude-code 平台');
      if (fs.existsSync(path.join(t4, '.agents'))) throw new Error('探测为 claude-code 时不应生成 .agents/');
      // ⑤ 无 --platform + 两者皆无 → 默认 claude-code
      const t5 = path.join(dir, 'k4-default');
      fs.mkdirSync(t5, { recursive: true });
      const r5 = run(t5);
      if (r5.status !== 0) throw new Error('默认平台安装失败: ' + (r5.stderr || JSON.stringify(r5.output)));
      if (!fs.existsSync(path.join(t5, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('两者皆无应默认 claude-code');
      // ⑥ --platform 未知平台 → 报错拒绝(不静默回退)
      const t6 = path.join(dir, 'k4-unknown');
      fs.mkdirSync(t6, { recursive: true });
      const r6 = spawnSync(process.execPath, [installer, '--target', t6, '--platform', 'bogus'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (r6.status === 0) throw new Error('未知平台应报错拒绝');
      const out6 = String(r6.stderr || '') + String(r6.stdout || '');
      if (!out6.includes('未知平台')) throw new Error('未知平台错误信息应含"未知平台": ' + out6);
      // ⑦ 无 --platform + 目标同时有 .claude/ 与 .codex/ 痕迹 → 不武断二选一:
      //    默认 claude-code(主平台)+ 输出多痕迹提示(修复前探测 .codex/ 优先会武断只装 codex)
      const t7 = path.join(dir, 'k4-dual-trace');
      fs.mkdirSync(path.join(t7, '.claude'), { recursive: true });
      fs.mkdirSync(path.join(t7, '.codex'), { recursive: true });
      const r7 = run(t7);
      if (r7.status !== 0) throw new Error('双痕迹项目安装失败: ' + (r7.stderr || JSON.stringify(r7.output)));
      if (!fs.existsSync(path.join(t7, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) {
        throw new Error('双痕迹项目应默认安装 claude-code(主平台),而非武断只装 codex');
      }
      if (fs.existsSync(path.join(t7, '.agents'))) throw new Error('双痕迹项目默认 claude-code 时不应生成 .agents/');
      const out7 = String(r7.stdout || '') + String(r7.stderr || '');
      if (!out7.includes('同时有 .claude/、.codex/ 或 .dsh/ 中的多个痕迹')) throw new Error('多痕迹无 TTY 应输出多痕迹提示: ' + out7);
      // ⑧ TTY 多选(交互模拟——平台选择链缺省路径):覆盖 stdin.isTTY + 管道喂入 '1,3'
      //    (Claude Code + dsh——三平台选项,旧 both 已移除)→ 双平台产物同时生成;
      //    dsh 副本命令路径平台化(.dsh 形态,不含 .claude 路径);DSH_HOME 指向临时目录
      //    (断言全程不写真实 ~/.dsh)
      const t8 = path.join(dir, 'k4-multiselect');
      fs.mkdirSync(t8, { recursive: true });
      const dshHome8 = path.join(dir, 'k4-dsh-home');
      const installerUrl = pathToFileURL(installer).href;
      const selectScript =
        `Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });` +
        `process.argv = ['node', 'prepare-env', '--target', ${JSON.stringify(t8)}];` +
        `await import(${JSON.stringify(installerUrl)});`;
      const r8 = spawnSync(process.execPath, ['--input-type=module', '-e', selectScript], { cwd: repoRoot, encoding: 'utf8', input: '1,3\n', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome8 } });
      if (r8.status !== 0) throw new Error('TTY 多选安装失败: ' + (r8.stderr || JSON.stringify(r8.output)));
      if (!fs.existsSync(path.join(t8, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('TTY 多选后 .claude/skills 应生成');
      if (!fs.existsSync(path.join(t8, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('TTY 多选后 .dsh/skills 应生成');
      if (fs.existsSync(path.join(t8, '.agents'))) throw new Error('TTY 多选(1,3)不应生成 .agents/(未选 codex)');
      const dshSkillText8 = fs.readFileSync(path.join(t8, '.dsh', 'skills', 'flow-comet', 'SKILL.md'), 'utf8');
      if (dshSkillText8.includes('.claude/skills/flow-comet/scripts/')) {
        throw new Error('TTY 多选后 dsh 副本命令路径应为 .dsh 形态');
      }
      if (!fs.existsSync(path.join(dshHome8, 'plugins', 'dsh-flow-comet-bridge.mjs'))) {
        throw new Error('TTY 多选后桥接 loader 应复制到临时 DSH_HOME(不写真实 ~/.dsh)');
      }
      // ⑨ 仅 .dsh/ 痕迹 → 无 TTY 探测为 dsh(三痕迹探测语义)
      const t9 = path.join(dir, 'k4-probe-dsh');
      fs.mkdirSync(path.join(t9, '.dsh'), { recursive: true });
      const r9 = run(t9, { DSH_HOME: path.join(dir, 'k4-probe-dsh-home') });
      if (r9.status !== 0) throw new Error('探测 dsh 安装失败: ' + (r9.stderr || JSON.stringify(r9.output)));
      if (!fs.existsSync(path.join(t9, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('已有 .dsh/ 的项目应探测为 dsh 平台');
      // ⑩ 显式逗号多平台:--platform claude-code,dsh → 两平台产物同时生成(CI/无 TTY 路径)
      const t10 = path.join(dir, 'k4-comma');
      fs.mkdirSync(t10, { recursive: true });
      const r10 = spawnSync(process.execPath, [installer, '--target', t10, '--platform', 'claude-code,dsh'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: path.join(dir, 'k4-comma-home') } });
      if (r10.status !== 0) throw new Error('--platform claude-code,dsh 失败: ' + (r10.stderr || JSON.stringify(r10.output)));
      if (!fs.existsSync(path.join(t10, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('逗号多平台应生成 .claude/skills');
      if (!fs.existsSync(path.join(t10, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('逗号多平台应生成 .dsh/skills');
      if (fs.existsSync(path.join(t10, '.agents'))) throw new Error('逗号多平台(claude-code,dsh)不应生成 .agents/');
    },
  },

  // K5: purge 语义——缺 --yes 拒绝(不破坏)/ --purge --yes 清理重建 / 用户内容(生成物外)保留
  {
    name: 'K5 安装器:purge 语义(缺 --yes 拒绝/重建/用户内容保留)',
    surface: 'purge 语义断言仅权威源侧可判（需真实安装器命令序列）',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const run = (target, extra) => spawnSync(process.execPath, [installer, '--target', target, ...extra], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      // ① codex 平台:首次安装 + 用户内容(项目根,非生成物)
      const target = path.join(dir, 'k5-codex');
      fs.mkdirSync(target, { recursive: true });
      const first = run(target, ['--platform', 'codex']);
      if (first.status !== 0) throw new Error('codex 首次安装失败: ' + (first.stderr || JSON.stringify(first.output)));
      fs.writeFileSync(path.join(target, 'USER_KEEP.md'), '# 用户内容(保留)\n', 'utf8');
      // ② 缺 --yes → 拒绝且不破坏(错误提示含 --yes;生成物与用户内容仍在)
      const dry = run(target, ['--platform', 'codex', '--purge']);
      if (dry.status === 0) throw new Error('--purge 缺 --yes 应失败');
      const dryOut = String(dry.stderr || '') + String(dry.stdout || '');
      if (!dryOut.includes('--yes')) throw new Error('--purge 缺 --yes 错误信息应提示 --yes: ' + dryOut);
      if (!fs.existsSync(path.join(target, '.agents', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('--purge 拒绝后生成物不应被删除');
      if (!fs.existsSync(path.join(target, 'USER_KEEP.md'))) throw new Error('--purge 拒绝后用户内容不应被删除');
      // ②b 写入用户自有资产(.agents/skills/ 用户技能 + hooks.json 用户条目)——purge 后须保留
      fs.mkdirSync(path.join(target, '.agents', 'skills', 'user-own-skill'), { recursive: true });
      fs.writeFileSync(path.join(target, '.agents', 'skills', 'user-own-skill', 'SKILL.md'), '# user skill\n', 'utf8');
      const userHooksPath = path.join(target, '.codex', 'hooks.json');
      const userHooks = JSON.parse(fs.readFileSync(userHooksPath, 'utf8'));
      userHooks.hooks.PreToolUse.push({ matcher: 'UserOwn', hooks: [{ type: 'command', command: 'node user-own-hook.mjs' }] });
      fs.writeFileSync(userHooksPath, JSON.stringify(userHooks, null, 2) + '\n', 'utf8');
      // ③ --purge --yes → 清理重建(仅 flow-comet 技能,用户资产保留)
      const ok = run(target, ['--platform', 'codex', '--purge', '--yes']);
      if (ok.status !== 0) throw new Error('--purge --yes 失败: ' + (ok.stderr || JSON.stringify(ok.output)));
      if (!fs.existsSync(path.join(target, '.agents', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('--purge --yes 后 flow-comet 技能应重新生成');
      if (!fs.existsSync(path.join(target, '.agents', 'skills', 'user-own-skill', 'SKILL.md'))) throw new Error('--purge --yes 后用户技能应保留(.agents/ 为共享目录)');
      if (!fs.existsSync(path.join(target, 'USER_KEEP.md'))) throw new Error('--purge --yes 后用户内容应保留');
      const hooksText = fs.readFileSync(path.join(target, '.codex', 'hooks.json'), 'utf8');
      if ((hooksText.match(/comet-hook-guard\.mjs/g) || []).length !== 1) throw new Error('--purge --yes 后 hooks.json 应含 1 条重建托管条目: ' + hooksText);
      if (!hooksText.includes('user-own-hook.mjs')) throw new Error('--purge --yes 后用户 hook 条目应保留: ' + hooksText);
      const agents = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
      if (!agents.includes('Managed by flow-comet')) throw new Error('--purge --yes 后 AGENTS.md 托管区应重建');
      // ④ claude-code 平台同样:缺 --yes 拒绝 + --purge --yes 重建 + 用户内容保留
      const tcc = path.join(dir, 'k5-cc');
      fs.mkdirSync(tcc, { recursive: true });
      const ccFirst = run(tcc, []);
      if (ccFirst.status !== 0) throw new Error('claude-code 首次安装失败: ' + (ccFirst.stderr || JSON.stringify(ccFirst.output)));
      fs.writeFileSync(path.join(tcc, 'USER_KEEP.md'), '# 用户内容(保留)\n', 'utf8');
      // ⑤ matcher 演进幂等:把托管组 matcher 改为旧形态(Write|Edit——模拟历史版本注入),
      //    重装(非 purge)后旧托管组应被清理——settings 仅剩当前 matcher 组、无空 hooks 组
      const settingsPath = path.join(tcc, '.claude', 'settings.local.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      for (const g of settings.hooks.PreToolUse) {
        if (g.matcher === 'Write|Edit|Bash') g.matcher = 'Write|Edit';
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      const reinstall = run(tcc, []);
      if (reinstall.status !== 0) throw new Error('matcher 演进重装失败: ' + (reinstall.stderr || JSON.stringify(reinstall.output)));
      const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const groups = after.hooks.PreToolUse;
      if (groups.some((g) => Array.isArray(g.hooks) && g.hooks.length === 0)) {
        throw new Error('重装后存在空 hooks 组(matcher 演进残留): ' + JSON.stringify(groups));
      }
      if (!groups.some((g) => g.matcher === 'Write|Edit|Bash' && Array.isArray(g.hooks) && g.hooks.length > 0)) {
        throw new Error('重装后缺当前 matcher 组(Write|Edit|Bash)');
      }
      // ⑥ 历史残留空组清理:手动把当前组 hooks 清空(模拟历史版本残留的空组),
      //    再次重装后空组应被删除,settings 仅剩有效组
      const settings2 = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      for (const g of settings2.hooks.PreToolUse) g.hooks = [];
      fs.writeFileSync(settingsPath, JSON.stringify(settings2, null, 2) + '\n', 'utf8');
      const reinstall2 = run(tcc, []);
      if (reinstall2.status !== 0) throw new Error('空组清理重装失败: ' + (reinstall2.stderr || JSON.stringify(reinstall2.output)));
      const after2 = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const groups2 = after2.hooks.PreToolUse;
      if (groups2.some((g) => Array.isArray(g.hooks) && g.hooks.length === 0)) {
        throw new Error('重装后仍存在空 hooks 组(历史残留未清理): ' + JSON.stringify(groups2));
      }
      if (!groups2.some((g) => g.matcher === 'Write|Edit|Bash' && Array.isArray(g.hooks) && g.hooks.length > 0)) {
        throw new Error('空组清理后缺当前 matcher 组(Write|Edit|Bash)');
      }
      const ccDry = run(tcc, ['--purge']);
      if (ccDry.status === 0) throw new Error('claude-code --purge 缺 --yes 应失败');
      if (!fs.existsSync(path.join(tcc, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('claude-code --purge 拒绝后生成物不应被删除');
      if (!fs.existsSync(path.join(tcc, 'USER_KEEP.md'))) throw new Error('claude-code --purge 拒绝后用户内容不应被删除');
      const ccOk = run(tcc, ['--purge', '--yes']);
      if (ccOk.status !== 0) throw new Error('claude-code --purge --yes 失败: ' + (ccOk.stderr || JSON.stringify(ccOk.output)));
      if (!fs.existsSync(path.join(tcc, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('claude-code --purge --yes 后技能应重新生成');
      if (!fs.existsSync(path.join(tcc, 'USER_KEEP.md'))) throw new Error('claude-code --purge --yes 后用户内容应保留');
    },
  },

  // K6: 平台描述符驱动防回归——PLATFORMS 每平台条目含安装/清理函数(installHooks/installRules/
  // purge/overwriteDescription);main 统一调度(源码无平台分支标识——新增平台 = 描述符条目,
  // main 零改动);对源码提取的全部平台逐一真实安装冒烟(未来新增平台自动纳入测试)
  {
    name: 'K6 安装器:平台描述符驱动(全平台安装冒烟 + main 统一调度)',
    surface: '平台描述符与全平台安装冒烟仅权威源侧可判（需安装器模块树）',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      // ① main 统一调度:平台分支标识已消除(新增平台 = 描述符条目,main 零改动)。
      // 受检面 = 入口 + scripts/lib 模块树——平台分支若以同形标识长回模块里,只扫入口会静默失明。
      const libDir = path.join(path.dirname(installer), 'lib');
      const branchSurface = [
        ['入口', installer],
        ...fs.readdirSync(libDir).filter((f) => f.endsWith('.mjs')).sort()
          .map((f) => ['lib/' + f, path.join(libDir, f)]),
      ];
      for (const [label, file] of branchSurface) {
        if (fs.readFileSync(file, 'utf8').includes('isClaudeCode')) {
          throw new Error('安装器 ' + label + ' 仍含平台分支标识 isClaudeCode(应迁入描述符)');
        }
      }
      // ② 描述符完整性:平台 id 从描述符块提取(防块外误匹配);聚合块须含 4 个平台函数
      // (installHooks/installRules/purge/overwriteDescription——未来新增平台缺任一函数时,
      // 下方逐平台 purge 冒烟会因 platform.purge 未定义而真实失败)
      // 描述符随安装器分模块:按**模块身份**读 lib/installer-platforms.mjs(描述符职责的归属模块,
      // 见设计模块图),不再平铺扫描模块树——扫到谁由目录顺序决定,模块搬家即静默失明。
      const descriptorModule = path.join(libDir, 'installer-platforms.mjs');
      if (!fs.existsSync(descriptorModule)) {
        throw new Error('缺少平台描述符模块(安装器模块图的描述符归属文件): ' + descriptorModule);
      }
      const platformBlock = fs.readFileSync(descriptorModule, 'utf8').match(/const PLATFORMS = \{[\s\S]*?\n\};/);
      if (!platformBlock) throw new Error('平台描述符模块未找到 PLATFORMS 描述符表: ' + descriptorModule);
      const ids = [...platformBlock[0].matchAll(/^\s{2}'([a-z-]+)':\s*\{/gm)].map((m) => m[1]);
      if (!ids.includes('claude-code') || !ids.includes('codex')) {
        throw new Error('PLATFORMS 应含 claude-code/codex: ' + ids.join(', '));
      }
      for (const fn of ['installHooks', 'installRules', 'purge', 'overwriteDescription']) {
        if (!platformBlock[0].includes(fn)) throw new Error('描述符缺平台函数: ' + fn);
      }
      // ③ 全平台逐一安装 + purge 冒烟(从描述符块提取 id——未来新增平台自动纳入;
      // purge 冒烟验证清理函数真实可用,缺函数/清理失败即红);
      // DSH_HOME 指向临时目录——dsh 平台 installHooks 写 $DSH_HOME(plugins/loader +
      // cordis.patch.yml 托管块),断言全程不污染真实 ~/.dsh
      const dshHome = path.join(dir, 'k6-dsh-home');
      for (const id of ids) {
        const target = path.join(dir, 'k6-' + id);
        fs.mkdirSync(target, { recursive: true });
        const env = { ...process.env, DSH_HOME: dshHome };
        const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', id], { cwd: repoRoot, encoding: 'utf8', timeout: 120000, env });
        if (res.status !== 0) throw new Error('平台 ' + id + ' 安装失败: ' + (res.stderr || JSON.stringify(res.output)));
        const purgeRes = spawnSync(process.execPath, [installer, '--target', target, '--platform', id, '--purge', '--yes'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000, env });
        if (purgeRes.status !== 0) throw new Error('平台 ' + id + ' purge 失败: ' + (purgeRes.stderr || JSON.stringify(purgeRes.output)));
      }
      console.log('  描述符驱动: ' + ids.length + ' 个平台逐一安装 + purge 冒烟通过✓');
    },
  },
// ---------- K 扩展：dsh 平台断言（安装器多平台） ----------
// 以下断言覆盖 prepare-env --platform dsh 的项目级安装 / AGENTS.md 托管区 / 桥接 loader /
// purge 清理恢复；断言全程 DSH_HOME=临时目录环境变量，禁止污染真实 ~/.dsh。

  // K7: dsh 描述符安装产物——--platform dsh 项目级安装(.dsh/skills rank 100 自动发现) +
  // pathReplacements 平台化(.dsh/skills/flow-comet/scripts/ 形态) + INSTALLED_VERSION +
  // 安装树清单与权威源一致;全程 DSH_HOME=临时目录(AC-1)
  {
    name: 'K7 安装器:dsh 平台安装(技能/pathReplacements/版本标识/树一致)',
    surface: 'dsh 平台安装产物与树一致断言仅权威源侧可判',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const dshHome = path.join(dir, 'k7-dsh-home');
      const target = path.join(dir, 'k7-target');
      fs.mkdirSync(target, { recursive: true });
      const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      if (res.status !== 0) throw new Error('prepare-env --platform dsh 失败: ' + (res.stderr || JSON.stringify(res.output)));
      // ① 技能安装到 <项目>/.dsh/skills/flow-comet/(dsh rank 100 项目级发现位置)
      const skillMd = path.join(target, '.dsh', 'skills', 'flow-comet', 'SKILL.md');
      if (!fs.existsSync(skillMd)) throw new Error('dsh 平台技能未安装到 .dsh/skills/flow-comet/');
      // ② guard 判定核心随技能分发(comet-hook-guard 平台无关 CLI,一行不动)
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'flow-comet', 'scripts', 'comet-hook-guard.mjs'))) {
        throw new Error('comet-hook-guard.mjs 未随技能分发到 .dsh/skills/flow-comet/scripts/');
      }
      // ③ 版本标识写入(随技能包分发)
      const verFile = path.join(target, '.dsh', 'skills', 'flow-comet', 'INSTALLED_VERSION');
      if (!fs.existsSync(verFile)) throw new Error('缺少 INSTALLED_VERSION(版本标识文件)');
      if (!fs.readFileSync(verFile, 'utf8').trim()) throw new Error('版本标识为空');
      // ④ pathReplacements 生效:SKILL 命令路径为 .dsh 形态,无 .claude 残留
      const text = fs.readFileSync(skillMd, 'utf8');
      if (!text.includes('.dsh/skills/flow-comet/scripts/')) throw new Error('SKILL 命令路径未替换为 .dsh/skills/flow-comet/scripts/');
      if (text.includes('.claude/skills/flow-comet/scripts/')) throw new Error('SKILL 仍含 .claude/skills/flow-comet/scripts/ 命令路径');
      // ⑤ 安装树文件清单与权威源一致(pathReplacements 只改内容不改清单)
      const authoritative = path.join(repoRoot, '.flow-comet', 'skills', 'flow-comet');
      const installedTree = collectTreeFiles(path.join(target, '.dsh', 'skills', 'flow-comet'));
      const srcTree = collectTreeFiles(authoritative);
      if (installedTree.length === 0) throw new Error('安装技能树为空');
      if (JSON.stringify(installedTree) !== JSON.stringify(srcTree)) {
        throw new Error('安装树清单与权威源不一致\n权威源: ' + srcTree.join(', ') + '\n安装: ' + installedTree.join(', '));
      }
      console.log('  .dsh/skills/flow-comet 安装树 = ' + installedTree.length + ' files 与权威源一致 ✓');
    },
  },

  // K8: AGENTS.md 托管区注入——托管区存在 + 托管区外用户内容保留 + 幂等重装不重复
  // (codex/dsh 共用注入函数与托管区标记——AC-4)
  {
    name: 'K8 安装器:dsh AGENTS.md 托管区(用户内容保留 + 幂等重装)',
    surface: 'AGENTS.md 托管区注入与幂等断言仅权威源侧可判',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const dshHome = path.join(dir, 'k8-dsh-home');
      const target = path.join(dir, 'k8-target');
      fs.mkdirSync(target, { recursive: true });
      // 预置用户内容(托管区外,安装不得覆盖)
      fs.writeFileSync(path.join(target, 'AGENTS.md'), '# 用户自定义指令\n\n保留这段内容。\n', 'utf8');
      const run = () => spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      // ① 首次安装:托管区注入(内联 orchestration 全文)+ 用户内容保留
      const first = run();
      if (first.status !== 0) throw new Error('dsh 安装失败: ' + (first.stderr || JSON.stringify(first.output)));
      let agents = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
      if (!agents.includes('<!-- Managed by flow-comet prepare-env -->')) throw new Error('AGENTS.md 无托管区标记');
      if (!agents.includes('flow-comet Orchestration')) throw new Error('AGENTS.md 未内联 orchestration 内容');
      if (!agents.includes('用户自定义指令') || !agents.includes('保留这段内容。')) throw new Error('托管区外用户内容被覆盖');
      // ② 幂等重装:托管区不重复注入(start+end 标记合计 2 处 = 1 个托管区)
      const second = run();
      if (second.status !== 0) throw new Error('dsh 重装失败: ' + (second.stderr || JSON.stringify(second.output)));
      agents = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
      if (!agents.includes('保留这段内容。')) throw new Error('重装后用户内容丢失');
      const markerCount = (agents.match(/Managed by flow-comet prepare-env/g) || []).length;
      if (markerCount !== 2) throw new Error('幂等重装后托管区应只有 1 组标记(实际 ' + markerCount + ' 个)——重复注入');
      console.log('  AGENTS.md 托管区注入 + 幂等重装不重复 ✓');
    },
  },

  // K9: 桥接 loader 就位——权威源文件存在 + node --check 语法 + 安装时复制到
  // $DSH_HOME/plugins/ + cordis.patch.yml 托管块注入(insert 形态 + file:// 引用 loader 路径,
  // 读-合并-写保留既有块;insert 形态是 home patch 追加新插件的唯一正确形态——patch 形态
  // id-targeted 对不存在的 id 报 entry not found 跳过,loader 不加载,拦截整链静默失效;
  // $DSH_HOME 解析 = 显式 DSH_HOME > ~/.dsh——测试隔离到临时目录)
  {
    name: 'K9 桥接 loader:源文件/语法/复制与托管块注入(读-合并-写)',
    surface: '桥接 loader 就位与托管块注入断言仅权威源侧可判',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      // ① 权威源 loader 存在 + 语法检查
      const loader = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const check = spawnSync(process.execPath, ['--check', loader], { encoding: 'utf8', timeout: 60000 });
      if (check.status !== 0) throw new Error('dsh-bridge.mjs 语法检查失败: ' + (check.stderr || ''));
      // ② 安装后:loader 复制到 $DSH_HOME/plugins/dsh-flow-comet-bridge.mjs + 托管块注入
      const dshHome = path.join(dir, 'k9-dsh-home');
      const target = path.join(dir, 'k9-target');
      fs.mkdirSync(target, { recursive: true });
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      if (res.status !== 0) throw new Error('dsh 安装失败: ' + (res.stderr || JSON.stringify(res.output)));
      if (!fs.existsSync(path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs'))) {
        throw new Error('loader 未复制到 $DSH_HOME/plugins/');
      }
      const patchPath = path.join(dshHome, 'cordis.patch.yml');
      if (!fs.existsSync(patchPath)) throw new Error('缺少 $DSH_HOME/cordis.patch.yml');
      const patch = fs.readFileSync(patchPath, 'utf8');
      if (!patch.includes('# --- flow-comet managed ---') || !patch.includes('# --- end flow-comet managed ---')) {
        throw new Error('cordis.patch.yml 无托管块标记');
      }
      // insert 形态断言（套件全绿 ≠ 真实 dsh 生效——patch 形态 id-targeted 语义对
      // 不存在的 id 输出 entry not found 并跳过，loader 从不加载；insert 形态才追加新插件行）
      if (!patch.includes('- insert:')) throw new Error('cordis.patch.yml 托管块应为 insert 形态(- insert: 顶层条目)');
      if (!patch.includes('dsh-flow-comet-bridge')) throw new Error('cordis.patch.yml 缺 loader 条目');
      const loaderUrl = pathToFileURL(path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs')).href;
      if (!patch.includes(loaderUrl)) throw new Error('cordis.patch.yml 托管块应 file:// 引用 loader 路径: ' + loaderUrl);
      // ③ 读-合并-写非破坏:预置 dsh-skin 既有块 → 重装后保留(托管块幂等唯一)
      fs.writeFileSync(patchPath, '# --- dsh-skin managed ---\n- id: dsh-skin\n  name: file:///skin\n# --- end dsh-skin managed ---\n' + patch, 'utf8');
      const re = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      if (re.status !== 0) throw new Error('dsh 重装失败: ' + (re.stderr || JSON.stringify(re.output)));
      const after = fs.readFileSync(patchPath, 'utf8');
      if (!after.includes('dsh-skin managed')) throw new Error('重装后 dsh-skin 既有块丢失(读-合并-写非破坏)');
      if ((after.match(/flow-comet managed/g) || []).length !== 2) {
        throw new Error('重装后 flow-comet 托管块应幂等唯一: ' + after);
      }
      console.log('  loader 复制 + cordis.patch.yml 托管块(读-合并-写保留既有块)✓');
    },
  },

  // K10: dsh purge 清理恢复——缺 --yes 拒绝(不破坏)/ --purge --yes 删除后重新生成
  // (既有 main 语义:purge 后重新生成到最终态)/ 用户内容保留 / 空 .dsh 目录清理
  // (唯一 flow-comet 技能移除后 .dsh/skills 与 .dsh 变空 → 一并清理)
  {
    name: 'K10 安装器:dsh purge 清理恢复(缺 --yes 拒绝/删除后重建/用户内容保留/空目录清理)',
    surface: 'dsh purge 清理恢复断言仅权威源侧可判',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const dshHome = path.join(dir, 'k10-dsh-home');
      const run = (target, extra) => spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh', ...extra], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      // ① 首次安装 + 用户内容(项目根,非生成物)
      const target = path.join(dir, 'k10-target');
      fs.mkdirSync(target, { recursive: true });
      const first = run(target, []);
      if (first.status !== 0) throw new Error('dsh 首次安装失败: ' + (first.stderr || JSON.stringify(first.output)));
      fs.writeFileSync(path.join(target, 'USER_KEEP.md'), '# 用户内容(保留)\n', 'utf8');
      // ② 缺 --yes → 拒绝且不破坏(错误提示含 --yes;生成物与用户内容仍在)
      const dry = run(target, ['--purge']);
      if (dry.status === 0) throw new Error('--purge 缺 --yes 应失败');
      const dryOut = String(dry.stderr || '') + String(dry.stdout || '');
      if (!dryOut.includes('--yes')) throw new Error('--purge 缺 --yes 错误信息应提示 --yes: ' + dryOut);
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('--purge 拒绝后生成物不应被删除');
      if (!fs.existsSync(path.join(target, 'USER_KEEP.md'))) throw new Error('--purge 拒绝后用户内容不应被删除');
      // ③ --purge --yes → 删除后重新生成(最终态 = 重新生成的安装态);移除清单含空 .dsh 目录
      //    清理条目(.dsh/skills 移除后 .dsh 变空——行尾锚定防与 skillRoot 打印行混淆)
      const ok = run(target, ['--purge', '--yes']);
      if (ok.status !== 0) throw new Error('--purge --yes 失败: ' + (ok.stderr || JSON.stringify(ok.output)));
      const okOut = String(ok.stderr || '') + String(ok.stdout || '');
      const dshDirLine = '- ' + path.join(target, '.dsh');
      if (!okOut.includes(dshDirLine + '\r\n') && !okOut.includes(dshDirLine + '\n')) {
        throw new Error('purge 移除清单应含空 .dsh 目录清理条目: ' + okOut);
      }
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('--purge --yes 后技能应重新生成(删除后重新生成语义)');
      if (!fs.existsSync(path.join(target, 'USER_KEEP.md'))) throw new Error('--purge --yes 后用户内容应保留');
      const agents = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
      if (!agents.includes('<!-- Managed by flow-comet prepare-env -->')) throw new Error('--purge --yes 后 AGENTS.md 托管区应重建');
      if (!fs.existsSync(path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs'))) throw new Error('--purge --yes 后桥接 loader 应重建');
      // ④ 共享位置边界:.dsh/skills 用户技能(purge 只清 flow-comet*,其余保留)
      fs.mkdirSync(path.join(target, '.dsh', 'skills', 'user-own-skill'), { recursive: true });
      fs.writeFileSync(path.join(target, '.dsh', 'skills', 'user-own-skill', 'SKILL.md'), '# user skill\n', 'utf8');
      const ok2 = run(target, ['--purge', '--yes']);
      if (ok2.status !== 0) throw new Error('--purge --yes(第二次) 失败: ' + (ok2.stderr || JSON.stringify(ok2.output)));
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'user-own-skill', 'SKILL.md'))) throw new Error('--purge --yes 后用户技能应保留(.dsh/skills 共享位置)');
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('--purge --yes(第二次) 后 flow-comet 技能应重新生成');
      console.log('  dsh purge 缺 --yes 拒绝 + 删除后重建 + 用户内容保留 + 空目录清理 ✓');
    },
  },

  // K11: 桥接 loader 行为断言（dsh-bridge.mjs export 直测——参数映射别名矩阵/
  // 形状不符 fail-closed/项目根包含性含 8.3 短路径/退出码映射/guard 路径存在漂移防护；
  // apply 集成：tools/pre-execute 监听器分派——子代理放行/协调者走 guard/越界·形状 deny 不受身份）
  {
    name: 'K11 桥接 loader:纯函数与 apply 分派断言(映射/包含性/退出映射/身份分派/最小保护集)',
    surface: '桥接 loader 纯函数与 pre-execute 分派断言仅权威源侧可判',
    run: async (dir, outcomes) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      // 动态 import(套件运行器逐项 await)——dsh-bridge.mjs 仅在权威源仓库根 scripts/,
      // 安装副本缺失时整体跳过(与 K 组其余项同语义);静态 import 会让安装副本套件整体崩
      const loader = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const bridge = await import(pathToFileURL(loader).href);
      // ① 工具名归一化别名矩阵:write/edit/bash 全部别名 → Write/Edit/Bash
      for (const alias of ['write', 'Write', 'WRITE', 'writefile', 'file-write']) {
        if (bridge.normalizeToolName(alias) !== 'Write') throw new Error('normalizeToolName 别名未归一化: ' + alias);
      }
      for (const alias of ['edit', 'Edit', 'editfile', 'file-edit']) {
        if (bridge.normalizeToolName(alias) !== 'Edit') throw new Error('normalizeToolName 别名未归一化: ' + alias);
      }
      for (const alias of ['bash', 'Bash', 'shell', 'powershell', 'pwsh', 'Pwsh', 'PWSH', 'run_command', 'run-command']) {
        if (bridge.normalizeToolName(alias) !== 'Bash') throw new Error('normalizeToolName 别名未归一化: ' + alias);
      }
      // 非 Write/Edit/Bash 或非字符串 → null(监听侧按放行语义跳过)
      for (const v of ['read', 'grep', '', null, undefined, 123, {}]) {
        if (bridge.normalizeToolName(v) !== null) throw new Error('非写工具应归一化为 null: ' + JSON.stringify(v));
      }
      // ② 参数映射别名提取:Write/Edit 的 file_path/filePath/path;Bash 的 command/cmd/script
      const m1 = bridge.mapToolInput('Write', { file_path: 'a.md' });
      if (!m1.ok || m1.target !== 'a.md' || m1.input.file_path !== 'a.md') throw new Error('Write file_path 映射失败: ' + JSON.stringify(m1));
      const m2 = bridge.mapToolInput('Edit', { filePath: 'b.md' });
      if (!m2.ok || m2.target !== 'b.md') throw new Error('Edit filePath 别名映射失败: ' + JSON.stringify(m2));
      const m3 = bridge.mapToolInput('Write', { path: 'c.md' });
      if (!m3.ok || m3.target !== 'c.md') throw new Error('Write path 别名映射失败: ' + JSON.stringify(m3));
      const mPrec = bridge.mapToolInput('Write', { file_path: 'a.md', filePath: 'b.md', path: 'c.md' });
      if (!mPrec.ok || mPrec.target !== 'a.md') throw new Error('file_path 应优先于 filePath/path: ' + JSON.stringify(mPrec));
      for (const alias of ['command', 'cmd', 'script']) {
        const mb = bridge.mapToolInput('Bash', { [alias]: 'npm test' });
        if (!mb.ok || mb.target !== 'npm test' || mb.input.command !== 'npm test') {
          throw new Error('Bash ' + alias + ' 映射失败: ' + JSON.stringify(mb));
        }
      }
      // ②b 形状不符/缺关键字段 → ok:false 可识别(fail-closed 前置,不静默放行)
      const bad1 = bridge.mapToolInput('Write', {});
      if (bad1.ok || !bad1.reason.includes('缺少 file_path')) throw new Error('Write 缺 file_path 应 fail-closed 且原因可识别: ' + JSON.stringify(bad1));
      const bad2 = bridge.mapToolInput('Bash', {});
      if (bad2.ok || !bad2.reason.includes('缺少 command')) throw new Error('Bash 缺 command 应 fail-closed 且原因可识别: ' + JSON.stringify(bad2));
      if (bridge.mapToolInput('Write', { file_path: '   ' }).ok) throw new Error('空白 file_path 应 fail-closed');
      if (bridge.mapToolInput('Bash', null).ok) throw new Error('null 参数应 fail-closed');
      if (bridge.mapToolInput('Bash', ['x']).ok) throw new Error('数组参数应 fail-closed');
      if (bridge.mapToolInput('Read', { file_path: 'a.md' }).ok) throw new Error('未支持工具名应 fail-closed');
      // ③ isPathInsideProjectRoot:项目内长路径 true / 项目外 false(含 .. 越界)
      const projRoot = path.join(dir, 'k11-proj');
      fs.mkdirSync(projRoot, { recursive: true });
      if (!bridge.isPathInsideProjectRoot(projRoot, path.join(projRoot, 'src', 'a.md'))) throw new Error('项目内长路径应判定为 true');
      if (!bridge.isPathInsideProjectRoot(projRoot, 'src/a.md')) throw new Error('项目内相对路径应判定为 true');
      const outside = path.join(dir, 'k11-out');
      fs.mkdirSync(outside, { recursive: true });
      if (bridge.isPathInsideProjectRoot(projRoot, path.join(outside, 'x.md'))) throw new Error('项目外绝对路径应判定为 false');
      if (bridge.isPathInsideProjectRoot(projRoot, path.join(projRoot, '..', 'k11-out', 'x.md'))) throw new Error('.. 越界路径应判定为 false');
      // ③b 8.3 短路径别名(Windows 8dot3name):os.tmpdir() 本机为 C:\Users\LONGYI~1
      //    短形态,realpathSync.native 归一化为长形态——词法不同但实路径相同;
      //    短形态不可解析的平台(禁用 8dot3name/POSIX)显式跳过
      const realRoot = bridge.realpathExistingPath(projRoot);
      if (realRoot !== projRoot) {
        const longFormTarget = path.join(realRoot, 'src', 'a.md');
        if (!bridge.isPathInsideProjectRoot(projRoot, longFormTarget)) {
          throw new Error('8.3 短路径别名(长形态目标)应归一化后判定为 true');
        }
        const normalized = bridge.realpathExistingPath(path.join(projRoot, 'src'));
        if (normalized !== path.join(realRoot, 'src')) {
          throw new Error('realpathExistingPath 应返回规范化长路径: ' + normalized + ' ≠ ' + path.join(realRoot, 'src'));
        }
        console.log('  8.3 短路径别名经 realpath 归一化为长形态判定 ✓');
      } else {
        outcomes.notApplicablePlatform('K11 ③b 8.3 短路径别名归一化断言',
          '本载体的临时目录不产生 8.3 短形态（POSIX / 已禁用 8dot3name）');
      }
      // ④ mapGuardExit:exit 0 → allow / exit 2 → deny(恢复指引 + detail 透传)/ 其它 → fail-closed
      if (bridge.mapGuardExit(0, '', '').kind !== 'allow') throw new Error('exit 0 应 allow');
      const d2 = bridge.mapGuardExit(2, 'BLOCKED detail', '');
      if (d2.kind !== 'deny') throw new Error('exit 2 应 deny');
      if (!d2.reason.includes('白名单拦截') || !d2.reason.includes('BLOCKED detail')) {
        throw new Error('exit 2 deny 应透传恢复指引与 detail: ' + JSON.stringify(d2));
      }
      for (const code of [1, 3, null, '0']) {
        const err = bridge.mapGuardExit(code, 'boom', '');
        if (err.kind !== 'error') throw new Error('其它退出码应 fail-closed error: code=' + String(code));
        if (!err.message.includes('code=' + String(code))) throw new Error('error 消息应含退出码: ' + JSON.stringify(err));
      }
      // ⑤ guard 路径存在断言(M4 漂移防护):HOOK_GUARD_REL('.dsh/skills/flow-comet/scripts/
      //    comet-hook-guard.mjs')与安装器独立维护同一知识——任一侧漂移(常量改/安装布局改)
      //    → 此断言失败,拦截层即失效(guard 缺失 → 桥接 WARN + 放行 fail-open)
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const dshHome = path.join(dir, 'k11-dsh-home');
      const target = path.join(dir, 'k11-target');
      fs.mkdirSync(target, { recursive: true });
      const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      if (res.status !== 0) throw new Error('dsh 安装失败: ' + (res.stderr || JSON.stringify(res.output)));
      const guardRel = '.dsh/skills/flow-comet/scripts/comet-hook-guard.mjs';
      if (!fs.existsSync(path.join(target, guardRel))) {
        throw new Error('HOOK_GUARD_REL 相对项目根解析的 guard 不存在(安装布局漂移): ' + path.join(target, guardRel));
      }
      console.log('  HOOK_GUARD_REL guard 安装后存在(与安装产物绑定)✓');
      // ⑥ delegationDepth 代理身份分派（B1——dsh 子代理=执行者）：dsh 子代理 spawn
      //    provider 的 childSessionMeta 把 delegationDepth=parentDepth+1 写入子代理 session
      //    header —— 协调者=0/缺失，子代理>0。桥接层据此分派：子代理写源码=执行者职责
      //    （对应 CC worktree 物理隔离），协调者走 guard 白名单拦截。旧桥接对所有工具
      //    一视同仁送 guard → subagent 模式子代理写源码被 .specs/ 白名单误拦 = B1 根因。
      //    本断言锚定 agentDepth 纯函数（守 exec 结构读取语义——header.delegationDepth）。
      if (typeof bridge.agentDepth !== 'function') {
        throw new Error('bridge.agentDepth 未导出（B1 修复应新增代理身份读取纯函数）');
      }
      // ① 子代理（depth=1）→ 识别为执行者（返回 1）
      if (bridge.agentDepth({ agent: { session: { header: { delegationDepth: 1 } } } }) !== 1) {
        throw new Error('子代理 delegationDepth=1 应识别为执行者: ' + String(bridge.agentDepth({ agent: { session: { header: { delegationDepth: 1 } } } })));
      }
      // ② 深层子代理（depth=2）→ 识别为执行者
      if (bridge.agentDepth({ agent: { session: { header: { delegationDepth: 2 } } } }) !== 2) {
        throw new Error('子代理 delegationDepth=2 应识别为执行者');
      }
      // ③ 协调者（depth=0）→ 协调者（非执行者）
      if (bridge.agentDepth({ agent: { session: { header: { delegationDepth: 0 } } } }) !== 0) {
        throw new Error('协调者 delegationDepth=0 应返回 0');
      }
      // ④ 缺省（undefined/缺字段）→ 协调者（旧语义兼容——协调者 depth 缺失按 0）
      if (bridge.agentDepth({ agent: { session: { header: {} } } }) !== 0) {
        throw new Error('缺 delegationDepth 应按协调者处理(0)');
      }
      if (bridge.agentDepth({}) !== 0) {
        throw new Error('空 exec 应按协调者处理(0)');
      }
      if (bridge.agentDepth(undefined) !== 0) {
        throw new Error('undefined exec 应按协调者处理(0)');
      }
      // ⑤ 非数字/负数/非法值 → 0（fail-closed 协调者语义，防 NaN/字符串穿透）
      for (const bad of [null, '1', -1, NaN, Infinity, {}, 'abc']) {
        if (bridge.agentDepth({ agent: { session: { header: { delegationDepth: bad } } } }) !== 0) {
          throw new Error('非法 delegationDepth 应按协调者处理(0): ' + JSON.stringify(bad));
        }
      }
      console.log('  delegationDepth 代理身份分派(子代理=执行者/协调者原链)✓');
      // ⑦ apply 集成喂测（5.5 分派分支自动化回归——此前仅有真实会话人工覆盖）：
      //   mock ctx 捕获 tools/pre-execute 监听器，构造 exec 断言插件级行为、
      //   子代理(agentDepth>0)写源码放行 / 协调者走 guard 白名单 / 越界·形状 deny 不受身份、
      //   非 flow-comet 项目窄监听放行。复用 ⑤ 安装产物(target 为真实 dsh flow-comet 项目)：
      //   写活跃 execute 态 state → 协调者写源码被真实 guard 子进程拦（BLOCK 链真实执行）。
      const applyEvents = {};
      bridge.apply({ on: (event, fn) => { applyEvents[event] = fn; } });
      const preExec = applyEvents['tools/pre-execute'];
      if (typeof preExec !== 'function') throw new Error('bridge.apply 应注册 tools/pre-execute 监听器');
      gitInit(target);
      fs.mkdirSync(path.join(target, 'src'), { recursive: true });
      writeState(target, {
        activeChange: 'apply-lock',
        currentNode: 'execute',
        completedNodes: [],
        evidence: {},
        verifyFailures: 0,
        status: 'running',
        executionMode: 'subagent',
        directOverride: false,
      });
      // 项目根常规用长形态（与桥接对 file_path 的规范化一致，对应真实会话规范 cwd）；
      // 短形态 cwd 的场景由桥接的项目根规范化修复，⑦f 断言锁死（fail-open 已封闭）。
      const longTarget = bridge.realpathExistingPath(target); // realpathSync.native——展开 8.3 短名
      // ⑦a 子代理（depth=1）写项目内源码 → next() 被调（守卫按身份分派放行——桥接不短路，
      //     身份深度随 env 透传，判定与最小保护集统一由守卫拥有）
      {
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: path.join(longTarget, 'src', 'a.mjs') }, agent: { cwd: longTarget, session: { header: { delegationDepth: 1 } } } },
          () => { usedNext = true; },
        );
        if (!usedNext) throw new Error('子代理写源码应放行(next 被调)——身份分派分支缺失');
        if (res) throw new Error('子代理写源码不应返回 deny: ' + JSON.stringify(res));
      }
      // ⑦b 协调者（delegationDepth 缺失=0）同目标写 → 走真实 guard 白名单 → BLOCK deny
      {
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: path.join(longTarget, 'src', 'a.mjs') }, agent: { cwd: longTarget, session: { header: {} } } },
          () => { usedNext = true; },
        );
        if (usedNext) throw new Error('协调者写源码不应 next——协调者禁令物理拦截保留');
        if (!res || res.kind !== 'deny') throw new Error('协调者写源码应走 guard 白名单拦截(deny): ' + JSON.stringify(res));
        if (!res.reason.includes('白名单拦截')) throw new Error('协调者 deny 应含白名单拦截语义: ' + JSON.stringify(res));
      }
      // ⑦c 非 flow-comet 项目(无 .dsh/skills/flow-comet) → 窄监听放行(不分身份)
      {
        const plain = path.join(dir, 'k11-plain');
        fs.mkdirSync(plain, { recursive: true });
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: path.join(plain, 'x.md') }, agent: { cwd: plain, session: { header: { delegationDepth: 1 } } } },
          () => { usedNext = true; },
        );
        if (!usedNext) throw new Error('非 flow-comet 项目应窄监听放行(next)');
      }
      // ⑦d 越界写不受身份影响：子代理(depth=1)写项目根外 → 包含性 fail-closed deny
      {
        const outside = path.join(dir, 'k11-out2');
        fs.mkdirSync(outside, { recursive: true });
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: path.join(outside, 'evil.md') }, agent: { cwd: longTarget, session: { header: { delegationDepth: 1 } } } },
          () => { usedNext = true; },
        );
        if (usedNext) throw new Error('子代理越界写不应 next——包含性不因身份放宽');
        if (!res || res.kind !== 'deny' || !res.reason.includes('不在项目根')) {
          throw new Error('子代理越界写应 fail-closed deny(含越界语义): ' + JSON.stringify(res));
        }
      }
      // ⑦e 形状不符不受身份影响：子代理(depth=1)参数形状不符 → fail-closed deny
      {
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: {}, agent: { cwd: longTarget, session: { header: { delegationDepth: 1 } } } },
          () => { usedNext = true; },
        );
        if (usedNext) throw new Error('子代理形状不符不应 next——形状校验不因身份放宽');
        if (!res || res.kind !== 'deny' || !res.reason.includes('参数形状不符')) {
          throw new Error('子代理形状不符应 fail-closed deny(含形状语义): ' + JSON.stringify(res));
        }
      }
      // ⑦f 短形态项目根不得 fail-open：会话 cwd 为 8.3 短路径时，桥接须把项目根
      //    归一化为长形态再送 guard——否则 guard 词法 path.relative 得 target=null
      //    跳过白名单（协调者写源码被放行）。本断言在短形态 TMP 机器上即回归锁死。
      {
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: path.join(target, 'src', 'b.mjs') }, agent: { cwd: target, session: { header: {} } } },
          () => { usedNext = true; },
        );
        if (usedNext) throw new Error('短形态 cwd 协调者写源码不应 next——8.3 短路径不得绕过白名单(fail-open 已封闭)');
        if (!res || res.kind !== 'deny' || !res.reason.includes('白名单拦截')) {
          throw new Error('短形态 cwd 协调者写源码应走 guard 白名单拦截(deny): ' + JSON.stringify(res));
        }
      }
      // ⑦g 最小保护集在桥接侧真实生效（身份放行不放行机器面）：子代理（depth=1）写项目内
      //    机器状态文件 → 桥接透传身份深度、守卫保护集 BLOCK → deny；对照 = ⑦a 同身份写源码
      //    放行。反向构造：桥接恢复「身份短路直接 next」⇒ 本断言必红（保护集形同虚设）。
      {
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: path.join(longTarget, '.flow-comet', 'flow-comet-state.json') }, agent: { cwd: longTarget, session: { header: { delegationDepth: 1 } } } },
          () => { usedNext = true; },
        );
        if (usedNext) throw new Error('子代理写机器状态文件不应 next——身份放行不得放行最小保护集');
        if (!res || res.kind !== 'deny' || !res.reason.includes('state 文件')) {
          throw new Error('子代理写机器状态文件应 deny(含 state 文件语义): ' + JSON.stringify(res));
        }
      }
      // ⑦h 最小保护集的协议目标同判：子代理（depth=1）写本次运行实际生效的协议文件
      //    （守卫按自身 packageRoot 解析——安装副本内的 reference/workflow-protocol.json）
      //    → deny；该路径在项目根内，故本断言与 ⑦d 的越界 deny 相互独立（保护集非越界判定）。
      {
        const protocolInTarget = path.join(longTarget, '.dsh', 'skills', 'flow-comet', 'reference', 'workflow-protocol.json');
        let usedNext = false;
        const res = await preExec(
          { name: 'Write', arguments: { file_path: protocolInTarget }, agent: { cwd: longTarget, session: { header: { delegationDepth: 1 } } } },
          () => { usedNext = true; },
        );
        if (usedNext) throw new Error('子代理写协议保护路径不应 next——身份放行不得放行协议面');
        if (!res || res.kind !== 'deny' || !res.reason.includes('协议文件')) {
          throw new Error('子代理写协议保护路径应 deny(含协议文件语义): ' + JSON.stringify(res));
        }
      }
      // ⑦i 最小保护集对盘符根拼写（Windows 上 Git-Bash 类 shell 的 `/d/<剩余>` 形态）同样成立：
      //    Bash 命令级写入的目标经既有提取器抽出后按写入目标解析的字面归一处理 ⇒ 与盘符拼写
      //    同判 deny。归一前该拼写被错解到「当前盘根之下」⇒ 保护集两道判据同时空转（身份放行
      //    下静默 next = fail-open）。对照 = 同一身份的盘符根拼写源码仍放行（保护集不扩大）。
      //    该拼写是 Windows 上 Git-Bash 类 shell 的自然产物；非 win32 载体上它是普通 POSIX 绝对
      //    路径，语义不同 ⇒ 显式不适用（不静默跳过——未验证 ≠ 通过）。
      const hasDriveRoot = /^[A-Za-z]:[\\/]/.test(longTarget);
      if (process.platform === 'win32' && hasDriveRoot) {
        const driveRootSpelling = (p) => '/' + p[0].toLowerCase() + p.slice(2).replaceAll('\\', '/');
        const spellingCases = [
          ['机器状态文件', driveRootSpelling(path.join(longTarget, '.flow-comet', 'flow-comet-state.json')), 'state 文件'],
          ['项目内源码', driveRootSpelling(path.join(longTarget, 'src', 'a.mjs')), null],
        ];
        for (const [label, spelled, denyMarker] of spellingCases) {
          let usedNext = false;
          const res = await preExec(
            { name: 'Bash', arguments: { command: 'cp "' + spelled + '" "' + spelled + '"' }, agent: { cwd: longTarget, session: { header: { delegationDepth: 1 } } } },
            () => { usedNext = true; },
          );
          if (denyMarker === null) {
            if (!usedNext) throw new Error(label + '的盘符根拼写应放行(next)——保护集不得扩大: ' + JSON.stringify(res));
            continue;
          }
          if (usedNext) throw new Error(label + '的盘符根拼写不应 next——身份放行不得放行最小保护集');
          if (!res || res.kind !== 'deny' || !res.reason.includes(denyMarker)) {
            throw new Error(label + '的盘符根拼写应 deny(含 ' + denyMarker + ' 语义): ' + JSON.stringify(res));
          }
        }
        console.log('  盘符根拼写与盘符拼写同判(机器面 deny / 源码放行)✓');
      } else {
        outcomes.notApplicablePlatform('K11 ⑦i 最小保护集盘符根拼写断言',
          '非 win32 载体上 `/d/<剩余>` 是普通 POSIX 绝对路径，保护集语义不同');
      }
      // ⑦j 桥接通道标记的作用域收紧（同型真实链路格）：CC / Codex 生成的 hook **直接**调用守卫、
      //    不经桥接——同一目标、同一深度值，经桥接 ⇒ 放行（⑦a 已覆盖），绕过桥接直接调守卫
      //    ⇒ 深度变量虽在场也不作数：守卫按协调者语义走白名单 ⇒ deny；同一调用补上通道标记
      //    ⇒ 按键控的身份通道放行（证明判据键在标记上，不是「直接调用一律拦」）。
      //    反向构造：守卫去掉标记要求 ⇒ 继承形态必红（继承来的深度变量被当成子代理身份 ⇒ 源码写入放行）。
      {
        const guardAbs = path.join(longTarget, guardRel);
        const probeInput = JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: path.join(longTarget, 'src', 'c.mjs') },
        });
        const directEnvs = [
          ['继承形态（无通道标记）', { FLOW_COMET_AGENT_DEPTH: '1' }, 2],
          ['通道标记在场', { FLOW_COMET_AGENT_DEPTH: '1', FLOW_COMET_AGENT_DEPTH_SOURCE: 'dsh-bridge' }, 0],
          ['标记值不符（近形状）', { FLOW_COMET_AGENT_DEPTH: '1', FLOW_COMET_AGENT_DEPTH_SOURCE: 'dsh' }, 2],
        ];
        for (const [label, overrides, expected] of directEnvs) {
          const res = spawnSync(process.execPath, [guardAbs, 'before_tool'], {
            cwd: longTarget,
            input: probeInput,
            env: { ...process.env, ...overrides },
            encoding: 'utf8',
            timeout: 60000,
          });
          const out = String(res.stdout || '') + String(res.stderr || '');
          if ((res.status ?? 1) !== expected) {
            throw new Error('桥接通道标记直接调用格「' + label + '」预期 exit ' + expected
              + '，实际 exit ' + String(res.status) + ': ' + out.trim().slice(0, 160));
          }
          if (expected === 2 && !out.includes('BLOCKED')) {
            throw new Error('桥接通道标记直接调用格「' + label + '」拦截报文缺 BLOCKED: ' + out.trim().slice(0, 160));
          }
          if (expected === 0 && !out.includes('(subagent identity)')) {
            throw new Error('桥接通道标记直接调用格「' + label + '」应走身份通道放行: ' + out.trim().slice(0, 160));
          }
        }
        console.log('  桥接通道标记：继承形态按协调者拦 / 标记在场走身份放行 / 近形状标记不认 ✓');
      }
      console.log('  bridge.apply 分派集成(子代理放行/协调者拦/越界·形状 deny 不受身份/保护集拦)✓');
    },
  },

  // K12: 桥接 loader 流程态门断言（B 方案 TDD RED 载体——空闲/异常态行为面，与 K11 运行态分开）：
  //   AC-1 无 state 文件 / AC-2 activeChange 缺失 / AC-3 status completed → 项目外 Write 应
  //   next() 放行（空闲放行语义由流程态门实现）；AC-7 非法 JSON / AC-8 未知 status →
  //   fail-closed deny（reason 含拒绝语义；解析失败/未知状态不得当空闲放行）。
  //   复用 K11 安装产物形态：target 为真实 dsh flow-comet 项目（.dsh/skills/flow-comet 就位，
  //   窄监听不跳过——保证当前实现走到包含性 deny 而非被窄监听放行）；mock exec 取协调者身份
  //   （delegationDepth 缺失=0，与 K11 ⑦b 同语义）。import 用 ?query 缓存破除——K11 已在本进程
  //   apply 过，模块级幂等标记会让二次 apply 跳过（applied=true），必须全新模块实例才能捕获监听器。
  {
    name: 'K12 桥接 loader:流程态门断言(无state/无activeChange/completed放行·非法JSON/未知status deny)',
    surface: '桥接流程态门（active-change 门与 fail-closed 分支）断言仅权威源侧可判',
    run: async (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const loader = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const bridge = await import(pathToFileURL(loader).href + '?k12=' + Date.now()); // 全新模块实例(applied=false)
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const dshHome = path.join(dir, 'k12-dsh-home');
      const target = path.join(dir, 'k12-target');
      fs.mkdirSync(target, { recursive: true });
      const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
      });
      if (res.status !== 0) throw new Error('dsh 安装失败: ' + (res.stderr || JSON.stringify(res.output)));
      // 窄监听不跳过前置：目标项目必须真的装有 .dsh/skills/flow-comet——否则当前实现会因窄监听
      // 直接 next()，空闲态断言假绿，RED 失真
      if (!fs.existsSync(path.join(target, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) {
        throw new Error('dsh flow-comet 项目安装缺失(.dsh/skills/flow-comet/SKILL.md 不存在)');
      }
      gitInit(target);
      const longTarget = bridge.realpathExistingPath(target); // 8.3 短形态归一为长形态(与 K11 一致)
      const outside = path.join(dir, 'k12-out');
      fs.mkdirSync(outside, { recursive: true });
      // 项目外 Write（协调者身份——delegationDepth 缺失=0）
      const mkOutsideWrite = () => ({
        name: 'Write',
        arguments: { file_path: path.join(outside, 'idle-leak.md') },
        agent: { cwd: longTarget, session: { header: {} } },
      });
      const ctxEvents = {};
      bridge.apply({ on: (event, fn) => { ctxEvents[event] = fn; } });
      const preExec = ctxEvents['tools/pre-execute'];
      if (typeof preExec !== 'function') throw new Error('bridge.apply 应注册 tools/pre-execute 监听器');
      const statePath = path.join(target, '.flow-comet', 'flow-comet-state.json');
      // AC-1 无 state：无 .flow-comet/flow-comet-state.json + 项目外 Write → next() 放行（空闲放行已生效）
      {
        if (fs.existsSync(statePath)) throw new Error('AC-1 前置:目标项目不应有 state 文件');
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (!usedNext) throw new Error('AC-1 无 state 应放行(next 被调): ' + JSON.stringify(r));
        if (r) throw new Error('AC-1 无 state 不应返回 deny: ' + JSON.stringify(r));
      }
      // AC-2 无 activeChange：writeState { activeChange:null, status:'running' } + 项目外 Write → next()（空闲放行已生效）
      {
        writeState(target, { activeChange: null, status: 'running' });
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (!usedNext) throw new Error('AC-2 activeChange 为空应放行(next 被调): ' + JSON.stringify(r));
        if (r) throw new Error('AC-2 无 activeChange 不应返回 deny: ' + JSON.stringify(r));
      }
      // AC-3 completed：writeState { activeChange:'x', status:'completed' } + 项目外 Write → next()（空闲放行已生效）
      {
        writeState(target, { activeChange: 'x', status: 'completed' });
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (!usedNext) throw new Error('AC-3 status completed 应放行(next 被调): ' + JSON.stringify(r));
        if (r) throw new Error('AC-3 completed 不应返回 deny: ' + JSON.stringify(r));
      }
      // AC-7 解析失败：state 写成非法 JSON + 项目外 Write → deny（reason 含 fail-closed 拒绝语义；
      //   当前无条件 deny 已通过、T02 流程态门落地后必须保持 deny，不得当空闲放行）
      {
        writeFile(target, '.flow-comet/flow-comet-state.json', '{ not-valid-json ');
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (usedNext) throw new Error('AC-7 非法 JSON 不应 next——解析失败必须 fail-closed deny');
        if (!r || r.kind !== 'deny') throw new Error('AC-7 非法 JSON 应 deny: ' + JSON.stringify(r));
        if (!r.reason.includes('拒绝')) throw new Error('AC-7 deny 应含 fail-closed(拒绝)语义: ' + JSON.stringify(r.reason));
      }
      // AC-8 未知 status：writeState { activeChange:'x', status:'weird' } + 项目外 Write → deny
      //   （当前通过、T02 流程态门落地后必须保持 deny，不得当空闲放行）
      {
        writeState(target, { activeChange: 'x', status: 'weird' });
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (usedNext) throw new Error('AC-8 未知 status 不应 next——未知 status 必须 fail-closed deny');
        if (!r || r.kind !== 'deny') throw new Error('AC-8 未知 status 应 deny: ' + JSON.stringify(r));
        if (!r.reason.includes('拒绝')) throw new Error('AC-8 deny 应含 fail-closed(拒绝)语义: ' + JSON.stringify(r.reason));
      }
      // AC-7b 非对象 JSON（null/标量/数组/字符串）：合法 JSON 但非对象 = 损坏 state → deny（fail-closed）
      for (const bad of [null, 123, ['x'], 'str']) {
        writeFile(target, '.flow-comet/flow-comet-state.json',JSON.stringify(bad));
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (usedNext) throw new Error('AC-7b 非对象 state(' + JSON.stringify(bad) + ') 不应 next——必须 fail-closed deny');
        if (!r || r.kind !== 'deny') throw new Error('AC-7b 非对象 state 应 deny: ' + JSON.stringify(r));
        if (!r.reason.includes('拒绝')) throw new Error('AC-7b deny 应含 fail-closed(拒绝)语义: ' + JSON.stringify(r.reason));
      }
      // AC-3b BOM 前缀 + completed：BOM 容错断言——应被解析并视为空闲放行
      {
        writeFile(target, '.flow-comet/flow-comet-state.json', '\uFEFF' + JSON.stringify({ activeChange: 'x', status: 'completed' }));
        let usedNext = false;
        const r = await preExec(mkOutsideWrite(), () => { usedNext = true; });
        if (!usedNext) throw new Error('AC-3b BOM+completed 应放行(next 被调)——BOM 容错: ' + JSON.stringify(r));
        if (r) throw new Error('AC-3b BOM+completed 不应返回 deny: ' + JSON.stringify(r));
      }
      console.log('  流程态门断言:AC-1/2/3 空闲放行·AC-3b BOM 容错·AC-7/8/7b 异常态 fail-closed deny✓');
    },
  },

  // hook 注入形态无关断言 + 旧条目幂等升级(AC-5/AC-7;安装产物根引用特征用例 + 升级替换用例)——
  // 安装产物托管条目满足「脚本 basename 在位 + 项目根引用特征(CLAUDE_PROJECT_DIR 或绝对路径)
  // 二选一」;新旧托管形态识别兼容(basename 同源 isManagedHookCommand 语义);把托管命令改回
  // 旧相对路径形态后重跑安装器 → 被识别替换(恰余 1 条,不重复不残留)且新条目形态达标。
  // 断言不锁定 %VAR% 引号/变量词形——注入命令实测微调不再破坏套件。
  {
    name: 'K13 安装器:hook 注入形态无关断言(basename+项目根引用)+旧条目幂等升级',
    surface: 'hook 注入形态与幂等升级断言仅权威源侧可判',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      // ① 形态分类器:新旧托管形态均被 basename 识别;项目根引用特征仅根引用形态命中
      for (const legacy of [
        'node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs',
        'node .agents/skills/flow-comet/scripts/comet-hook-guard.mjs before_tool --platform codex',
      ]) {
        if (!isManagedHookCommand(legacy)) throw new Error('旧托管形态应被 basename 识别(幂等升级识别面): ' + legacy);
        if (hasProjectRootRef(legacy)) throw new Error('旧相对路径形态不应命中项目根引用特征: ' + legacy);
      }
      for (const modern of [
        'node "%CLAUDE_PROJECT_DIR%/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs"',
        'node "$env:CLAUDE_PROJECT_DIR/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs"',
        'node "${CLAUDE_PROJECT_DIR}/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs"',
      ]) {
        assertManagedHookEntry(modern, '变量引用形态');
      }
      assertManagedHookEntry(path.join(dir, 'k13-abs', '.claude', 'skills', 'flow-comet', 'scripts', 'comet-hook-guard.mjs'), '绝对路径形态');
      // ② claude-code 安装产物:托管条目在场且指向本项目脚本(项目根引用特征在位)
      const ccTarget = path.join(dir, 'k13-cc');
      fs.mkdirSync(ccTarget, { recursive: true });
      const rcc = spawnSync(process.execPath, [installer, '--target', ccTarget, '--platform', 'claude-code'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (rcc.status !== 0) throw new Error('claude-code 安装失败: ' + (rcc.stderr || JSON.stringify(rcc.output)));
      const ccSettingsPath = path.join(ccTarget, '.claude', 'settings.local.json');
      const ccSettings = JSON.parse(fs.readFileSync(ccSettingsPath, 'utf8'));
      const ccManaged = collectManagedHookCommands(ccSettings);
      if (ccManaged.length === 0) throw new Error('.claude/settings.local.json 未注入托管 hook 条目');
      for (const c of ccManaged) assertManagedHookEntry(c, 'claude-code 托管命令');
      // ③ 可执行性（补「形态可识别但不可执行」盲区）：识别层与执行层是两个维度——
      //    前者只要求 basename 可辨,后者要求命令在 CC 的真实执行语义下可达。CC 全平台以
      //    /bin/bash -c 执行 hook 命令(含 Windows),并注入 CLAUDE_PROJECT_DIR 环境变量;
      //    cmd 变量语法 %VAR% 在 bash 下既不展开、路径反斜杠还会被转义吞掉 → node 静默
      //    找不到脚本(fail-open,仅报 non-blocking hook error)。
      //    (a) 形态约束(全平台可判):托管命令不得含 %VAR% cmd 语法;
      //    (b) 端到端(需 bash):以 bash -c + 注入 CLAUDE_PROJECT_DIR 跑完整命令,验证可达;
      //    无 bash 环境 → 显式失败(未验证不等于通过——宿主本身以 bash 语义执行 hook,
      //    不具备 bash 的环境无法完成本验证)。
      for (const c of ccManaged) {
        if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(c)) {
          throw new Error('claude-code 托管命令含 cmd 变量语法(%VAR%)——bash 执行语义下不可用: ' + c);
        }
      }
      const hasBash = (() => {
        try {
          return spawnSync('bash', ['--version'], { encoding: 'utf8', timeout: 30000 }).status === 0;
        } catch {
          return false;
        }
      })();
      if (hasBash) {
        for (const c of ccManaged) {
          const execRes = spawnSync('bash', ['-c', c], {
            cwd: ccTarget,
            encoding: 'utf8',
            timeout: 60000,
            env: { ...process.env, CLAUDE_PROJECT_DIR: ccTarget },
            input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(ccTarget, 'k13-probe.txt') } }),
          });
          if (execRes.status !== 0 || /Cannot find module/.test(String(execRes.stderr || ''))) {
            throw new Error(
              'claude-code 托管命令在 CC 执行语义(bash -c + CLAUDE_PROJECT_DIR)下不可执行: ' +
                c + ' —— ' + String(execRes.stderr || '').split('\n').slice(0, 3).join(' | ')
            );
          }
        }
      } else {
        throw new Error(
          'K13 端到端执行探针需要 bash(宿主以 bash 语义执行 hook 命令),当前环境 PATH 中不可用——' +
            '无法验证生成命令可执行;请在具备 bash 的环境运行套件(Windows 请确认 Git Bash 在 PATH 中)'
        );
      }
      // ③b 含空格项目根路径:同一端到端验证——未加引号的命令在变量展开后的空格处被词法分词
      //     切断(静默失效,与反斜杠转义同类);含引号形态须可执行,且仍被幂等识别(识别层去引号)。
      const ccSpaceTarget = path.join(dir, 'k13 cc space');
      fs.mkdirSync(ccSpaceTarget, { recursive: true });
      const rccSpace = spawnSync(process.execPath, [installer, '--target', ccSpaceTarget, '--platform', 'claude-code'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (rccSpace.status !== 0) throw new Error('claude-code 含空格路径安装失败: ' + (rccSpace.stderr || ''));
      const ccSpaceManaged = collectManagedHookCommands(JSON.parse(fs.readFileSync(path.join(ccSpaceTarget, '.claude', 'settings.local.json'), 'utf8')));
      if (ccSpaceManaged.length === 0) throw new Error('含空格路径下未注入托管 hook 条目');
      for (const c of ccSpaceManaged) {
        assertManagedHookEntry(c, '含空格路径托管命令');
        const execRes = spawnSync('bash', ['-c', c], {
          cwd: ccSpaceTarget,
          encoding: 'utf8',
          timeout: 60000,
          env: { ...process.env, CLAUDE_PROJECT_DIR: ccSpaceTarget },
          input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(ccSpaceTarget, 'k13-space-probe.txt') } }),
        });
        if (execRes.status !== 0 || /Cannot find module/.test(String(execRes.stderr || ''))) {
          throw new Error(
            '含空格路径托管命令在 CC 执行语义下不可执行: ' + c +
              ' —— ' + String(execRes.stderr || '').split('\n').slice(0, 3).join(' | ')
          );
        }
      }
      // ④ 幂等升级(claude-code):托管命令改回旧相对路径形态 → 重跑安装器 → 识别替换:
      // 恰余 1 条托管条目(无重复无残留)且形态达标(项目根引用特征在位)
      for (const g of ccSettings.hooks.PreToolUse) {
        for (const h of (Array.isArray(g.hooks) ? g.hooks : [])) {
          if (isManagedHookCommand(h.command)) h.command = 'node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs';
        }
      }
      fs.writeFileSync(ccSettingsPath, JSON.stringify(ccSettings, null, 2) + '\n', 'utf8');
      const rccUp = spawnSync(process.execPath, [installer, '--target', ccTarget, '--platform', 'claude-code'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (rccUp.status !== 0) throw new Error('claude-code 升级重装失败: ' + (rccUp.stderr || JSON.stringify(rccUp.output)));
      const ccAfter = collectManagedHookCommands(JSON.parse(fs.readFileSync(ccSettingsPath, 'utf8')));
      if (ccAfter.length !== 1) throw new Error('claude-code 升级后应恰余 1 条托管条目(旧条目被替换): ' + JSON.stringify(ccAfter));
      assertManagedHookEntry(ccAfter[0], 'claude-code 升级后托管命令');
      // ⑤ codex 平台同断言:安装产物形态达标 + 旧条目幂等升级
      const cxTarget = path.join(dir, 'k13-codex');
      fs.mkdirSync(cxTarget, { recursive: true });
      const rcx = spawnSync(process.execPath, [installer, '--target', cxTarget, '--platform', 'codex'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (rcx.status !== 0) throw new Error('codex 安装失败: ' + (rcx.stderr || JSON.stringify(rcx.output)));
      const cxHooksPath = path.join(cxTarget, '.codex', 'hooks.json');
      const cxHooks = JSON.parse(fs.readFileSync(cxHooksPath, 'utf8'));
      const cxManaged = collectManagedHookCommands(cxHooks);
      if (cxManaged.length === 0) throw new Error('.codex/hooks.json 未注入托管 hook 条目');
      for (const c of cxManaged) assertManagedHookEntry(c, 'codex 托管命令');
      for (const g of cxHooks.hooks.PreToolUse) {
        for (const h of (Array.isArray(g.hooks) ? g.hooks : [])) {
          if (isManagedHookCommand(h.command)) h.command = 'node .agents/skills/flow-comet/scripts/comet-hook-guard.mjs before_tool --platform codex';
        }
      }
      fs.writeFileSync(cxHooksPath, JSON.stringify(cxHooks, null, 2) + '\n', 'utf8');
      const rcxUp = spawnSync(process.execPath, [installer, '--target', cxTarget, '--platform', 'codex'], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
      if (rcxUp.status !== 0) throw new Error('codex 升级重装失败: ' + (rcxUp.stderr || JSON.stringify(rcxUp.output)));
      const cxAfter = collectManagedHookCommands(JSON.parse(fs.readFileSync(cxHooksPath, 'utf8')));
      if (cxAfter.length !== 1) throw new Error('codex 升级后应恰余 1 条托管条目(旧条目被替换): ' + JSON.stringify(cxAfter));
      assertManagedHookEntry(cxAfter[0], 'codex 升级后托管命令');
      console.log('  hook 注入形态无关断言(basename+项目根引用特征)+ 新旧幂等升级 ✓');
    },
  },

  // K14~K16: 桥接 loader 版本戳重装断言（安装器覆盖前版本比对明示的系统级锚定）——
  // 临时 DSH_HOME 预置不同版本戳 loader，真实安装器重装断言方向措辞（升级/降级/版本一致）、
  // 覆盖后磁盘为源新戳、同源重装收敛、purge 清除重建后路径回归。
  {
    name: 'K14 桥接 loader:版本戳重装断言(升级/降级方向与覆盖后新戳)',
    distributionSurface: true,
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const pkgCtx = resolvePackageContext();
      // 分发面回传契约夹具先跑（环境无关）：在副本 early-return 之前由夹具驱动断言——
      // copy 文案/marker 与三类失败路径负例在权威源与安装副本两侧都真跑，不依赖「装到副本才验证」。
      assertDistributionOutcomeContract(dir);
      const marker = DISTRIBUTION_MARKERS[pkgCtx.kind];
      if (pkgCtx.kind === 'copy') {
        const outcome = copyDistributionOutcome(pkgCtx, K14_COPY_DETAIL);
        console.log(outcome.message);
        return outcome.marker;
      }
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const loader = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const srcVersion = readBridgeSourceVersion(loader);
      // 权威基准 = INSTALLED_VERSION：loader 标记行须与其同值——跨文件分叉时安装副本的
      // bridge-check 会报版本偏斜（本守卫让系统测试独立捕获分叉，不依赖另一套件）。夹具派生以该基准为准。
      const installedVersion = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'INSTALLED_VERSION'), 'utf8').trim();
      if (srcVersion !== installedVersion) {
        throw new Error(
          'loader 版本戳(' + srcVersion + ')与 INSTALLED_VERSION(' + installedVersion +
          ')不一致——发布同步遗漏（bridge-check 会在安装副本报版本偏斜）'
        );
      }
      // 旧戳/新戳从基准动态派生（固定值会随发布线演进失效——预发布语义下同主版本比较
      // 可能反转，如 1.5.0-rc.2 < 1.5.0）：
      //   旧戳 = 主版本低一位 → 恒定「升级」方向；
      //   新戳 = 同主版本、次版本 +5 → 数值序高于源而字典序低于源（保持「数值序比较」护栏：
      //         字典序会误判为升级，断言「降级」即语义正确；与实现侧冒烟同口径）
      const [srcMajor, srcMinor] = installedVersion.split('.').map((p) => parseInt(p, 10));
      const OLD_STAMP = (srcMajor - 1) + '.0.0';
      const NEWER_STAMP = srcMajor + '.' + (srcMinor + 5) + '.0';
      const dshHome = path.join(dir, 'k14-dsh-home');
      const target = path.join(dir, 'k14-target');
      fs.mkdirSync(target, { recursive: true });
      seedForeignFlowKit(target);
      const pluginPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
      const runInstall = () => {
        const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
          cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
        });
        // 统一包装为 { status, output }（与 runState 等助手同形态——assertOut 期望字符串 output）
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      // ① 已装旧戳 loader → 重装输出「升级 A → B」逐字措辞 + 覆盖后磁盘为源新戳
      fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
      fs.writeFileSync(pluginPath, stampBridgeLoader(loader, OLD_STAMP), 'utf8');
      const upgrade = runInstall();
      assertExit(upgrade, 0);
      assertOut(upgrade, '桥接 loader 升级 ' + OLD_STAMP + ' → ' + srcVersion);
      if (!fs.readFileSync(pluginPath, 'utf8').includes('// BRIDGE_VERSION: ' + srcVersion)) {
        throw new Error('升级重装后已装 loader 应被覆盖为源新戳');
      }
      // ② 已装新戳 loader（数值序高于源）→ 重装输出「降级 A → B」+ 覆盖后仍为源戳
      fs.writeFileSync(pluginPath, stampBridgeLoader(loader, NEWER_STAMP), 'utf8');
      const downgrade = runInstall();
      assertExit(downgrade, 0);
      assertOut(downgrade, '桥接 loader 降级 ' + NEWER_STAMP + ' → ' + srcVersion);
      if (!fs.readFileSync(pluginPath, 'utf8').includes('// BRIDGE_VERSION: ' + srcVersion)) {
        throw new Error('降级重装后已装 loader 应为源戳');
      }
      // ③④ 安装副本载体版本比较语义（dev 态同基础健康 / 基础失配仍 FAIL）——助手单点实现
      assertInstalledCopyBridgeVersionSemantics(target, dshHome, srcVersion);
      console.log('  版本戳重装断言:升级/降级方向措辞与覆盖后新戳 ✓');
      console.log('  dev 态载体版本比较:同基础健康 + 基础失配仍 FAIL ✓');
      console.log('  source 形态:既有断言全跑 → ' + marker + '（copy 文案/marker 与失败路径负例已由分发面回传契约夹具断言）✓');
      return marker;
    },
  },

  {
    name: 'K15 桥接 loader:同源重装断言(首次安装后版本一致)',
    surface: '同源重装后的 loader 版本一致断言仅权威源侧可判',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const loader = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const srcVersion = readBridgeSourceVersion(loader);
      const dshHome = path.join(dir, 'k15-dsh-home');
      const target = path.join(dir, 'k15-target');
      fs.mkdirSync(target, { recursive: true });
      seedForeignFlowKit(target);
      const pluginPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
      const runInstall = () => {
        const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh'], {
          cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
        });
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      // ① 无已装 loader → 首次安装措辞（比对的空态前提）
      const first = runInstall();
      assertExit(first, 0);
      assertOut(first, '桥接 loader 首次安装');
      if (!fs.existsSync(pluginPath)) throw new Error('首次安装后 loader 应就位');
      // ② 同源重装（已装 = 源版本）→ 「版本一致（A）」逐字措辞 + 磁盘保持源戳
      const re = runInstall();
      assertExit(re, 0);
      assertOut(re, '桥接 loader 版本一致（' + srcVersion + '）');
      if (!fs.readFileSync(pluginPath, 'utf8').includes('// BRIDGE_VERSION: ' + srcVersion)) {
        throw new Error('同源重装后 loader 应保持源戳');
      }
      console.log('  同源重装断言:首次安装 → 版本一致收敛 ✓');
    },
  },

  {
    name: 'K16 桥接 loader:purge 后重建路径回归(loader 恢复与再装收敛)',
    surface: 'purge 后 loader 重建路径回归断言仅权威源侧可判',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const loader = path.join(repoRoot, 'scripts', 'dsh-bridge.mjs');
      if (!fs.existsSync(loader)) throw new Error('缺少 scripts/dsh-bridge.mjs');
      const srcVersion = readBridgeSourceVersion(loader);
      const dshHome = path.join(dir, 'k16-dsh-home');
      const target = path.join(dir, 'k16-target');
      fs.mkdirSync(target, { recursive: true });
      seedForeignFlowKit(target);
      const pluginPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
      const patchPath = path.join(dshHome, 'cordis.patch.yml');
      const runInstall = (extra) => {
        const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'dsh', ...(extra || [])], {
          cwd: repoRoot, encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: dshHome },
        });
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      // ① 首次安装：loader 与 cordis.patch.yml 托管块就位
      const first = runInstall();
      assertExit(first, 0);
      if (!fs.existsSync(pluginPath)) throw new Error('首次安装后 loader 应就位');
      if (!fs.existsSync(patchPath)) throw new Error('首次安装后 cordis.patch.yml 应就位');
      // ② purge --yes：dsh 平台生成物清除后删除并重建——loader/托管块恢复为源形态
      const purgeRes = runInstall(['--purge', '--yes']);
      assertExit(purgeRes, 0);
      if (!fs.existsSync(pluginPath)) throw new Error('purge 后 loader 应重建恢复');
      if (!fs.readFileSync(pluginPath, 'utf8').includes('// BRIDGE_VERSION: ' + srcVersion)) {
        throw new Error('purge 后 loader 应为源戳');
      }
      if (!fs.existsSync(patchPath)) throw new Error('purge 后 cordis.patch.yml 托管块应重建');
      // ③ 清除后再重装：成功且「版本一致」收敛（重建成果可复装、版本比对路径回归）
      const re = runInstall();
      assertExit(re, 0);
      assertOut(re, '桥接 loader 版本一致（' + srcVersion + '）');
      if (!fs.readFileSync(pluginPath, 'utf8').includes('// BRIDGE_VERSION: ' + srcVersion)) {
        throw new Error('purge 后再装后 loader 应为源戳');
      }
      console.log('  purge 后重建路径回归:loader/托管块恢复 + 再装版本一致收敛 ✓');
    },
  },

  // K17: 旧布局项目（状态文件在旧命名空间 + 同目录 Comet 资产/用户文件）经安装器自动迁移后，
  // 真实安装副本上的流程可继续——状态逐字节搬移且可读、合规节点链路 entry → record → exit
  // 正常推进、Comet 资产与用户文件原位未动。端到端执行断言（真实命令序列，非形态断言）。
  {
    name: 'K17 状态迁移:旧布局项目安装后状态可读且流程可继续',
    surface: '旧布局状态迁移与节点推进断言仅权威源侧可判',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const target = path.join(dir, 'k17-target');
      const legacyDir = path.join(target, '.comet');
      fs.mkdirSync(legacyDir, { recursive: true });
      // 迁移前状态（进行中的 change：design 节点待完成）
      const stateBytes = Buffer.from(JSON.stringify({
        activeChange: 'mig-ch',
        currentNode: 'design',
        completedNodes: ['open'],
        evidence: { open: { summary: 'intake complete' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      }, null, 2) + '\n', 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'flow-comet-state.json'), stateBytes);
      // 同目录的非 flow-comet 内容（旧目录三方共占实测形态）：迁移不得处置它们
      fs.writeFileSync(path.join(legacyDir, 'config.yaml'), 'workflow:\n  projectPath: docs/openspec\n');
      const userBytes = Buffer.from('user backup\n', 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'flow-comet-state.json.bak-20260901-user'), userBytes);
      // 活动 change 工件（迁移后流程可继续的前提）
      writeFile(target, '.specs/mig-ch/CHANGE.md', '# CHANGE\n\n- **Change ID**: mig-ch\n\n## Why（为什么做）\n\nx\n');
      writeFile(target, '.specs/mig-ch/REQUIREMENT.md', '# REQUIREMENT\n\n- **Change ID**: mig-ch\n\n## 用户故事（User Story）\n\nx\n\n## 验收准则（AC）\n\n- y\n');
      writeFile(target, '.specs/mig-ch/DESIGN.md', '# DESIGN\n\n- **Change ID**: mig-ch\n\n## 0. 技术栈\n\nNode\n\n## 决策清单\n\n| # | D | R |\n|---|---|---|\n| D1 | x | y |\n');
      seedForeignFlowKit(target); // 安装器不再走网络克隆（与 K14~K16 同手法）
      const install = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'claude-code'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000,
      });
      const installRes = { status: install.status ?? 1, output: String(install.stdout || '') + String(install.stderr || '') };
      assertExit(installRes, 0);
      assertOut(installRes, '已迁移');
      // ① 状态逐字节搬到新命名空间；旧位置移除；迁移前备份在场且逐字节一致
      const migrated = path.join(target, '.flow-comet', 'flow-comet-state.json');
      if (!fs.existsSync(migrated)) throw new Error('迁移后新位置状态文件缺失: ' + migrated);
      if (!fs.readFileSync(migrated).equals(stateBytes)) throw new Error('迁移后状态与迁移前不逐字节一致');
      if (fs.existsSync(path.join(legacyDir, 'flow-comet-state.json'))) throw new Error('迁移后旧位置状态文件应已移除');
      const backups = fs.readdirSync(path.join(target, '.flow-comet')).filter((n) => /^flow-comet-state\.json\.bak-/.test(n));
      if (backups.length !== 1) throw new Error('迁移前备份应恰一份: ' + JSON.stringify(backups));
      if (!fs.readFileSync(path.join(target, '.flow-comet', backups[0])).equals(stateBytes)) {
        throw new Error('迁移前备份与迁移前状态不逐字节一致');
      }
      // ② 非 flow-comet 内容原位未动
      if (!fs.readFileSync(path.join(legacyDir, 'config.yaml')).equals(Buffer.from('workflow:\n  projectPath: docs/openspec\n', 'utf8'))) {
        throw new Error('同目录 Comet 资产被改写');
      }
      if (!fs.readFileSync(path.join(legacyDir, 'flow-comet-state.json.bak-20260901-user')).equals(userBytes)) {
        throw new Error('同目录用户文件被改写');
      }
      // ③ 迁移后状态可读（真实安装副本，cwd = 项目根）
      const installed = (script, args) => {
        const res = spawnSync(process.execPath, [path.join(target, '.claude', 'skills', 'flow-comet', 'scripts', script), ...args], {
          cwd: target, encoding: 'utf8', timeout: 60000, env: { ...process.env, FLOW_COMET_RUN_ROOT: target },
        });
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      const before = installed('workflow-state.mjs', ['status']);
      assertExit(before, 0);
      assertOut(before, '"change": "mig-ch"');
      assertOut(before, '"stateCurrentNode": "design"'); // 迁移搬移的状态字段原值可读
      // ④ 流程可继续：entry → record → exit 推进到下一节点
      assertExit(installed('workflow-guard.mjs', ['entry', 'design']), 0);
      assertExit(installed('workflow-state.mjs', ['record', 'design', '{"summary":"design done"}']), 0);
      const exitDesign = installed('workflow-guard.mjs', ['exit', 'design', '--apply']);
      assertExit(exitDesign, 0);
      assertOut(exitDesign, 'ALL CHECKS PASSED');
      const after = installed('workflow-state.mjs', ['status']);
      assertExit(after, 0);
      assertOut(after, '"currentNode": "plan"');
      const finalState = JSON.parse(fs.readFileSync(migrated, 'utf8'));
      if (!Array.isArray(finalState.completedNodes) || !finalState.completedNodes.includes('design')) {
        throw new Error('exit design 后 completedNodes 应含 design: ' + JSON.stringify(finalState.completedNodes));
      }
      console.log('  迁移后链路:状态逐字节搬移 + 备份在场 + status 可读 + 节点推进 design → plan ✓');
    },
  },

  // K18: 分发面（npm 包形态）——可发布性清单 + 包体边界 + bin 双入口 + init 词元形态与红线
  // + 安装器升级路径清理（镜像目录内「权威源已不存在」的条目在重装后必须消失：含反向探针
  // 与幂等断言；`.claude/rules` 一类无命名空间的生成面 fail-closed 不纳入删除面）
  // + 安装器镜像清理的**根级** fail-closed（镜像根自身为链接 / 真实路径越出项目根两变体：
  // 项目外文件必不消失 + 保留原因可见 + 幂等 + 反向构造证明判别力）。
  // 权威源侧真跑断言（npm pack --dry-run 的真实产物清单在场才算通过）；安装副本侧输出显式
  // 「不适用」行并回传同语义的结果标记计通过（禁止静默跳过——「未验证 ≠ 通过」）。
  // 各断言见上方同名助手；结果标记由运行器按环境判据断言（distributionSurface 契约）。
  {
    name: 'K18 分发面:环境判据与包体边界·bin 双入口(权威源真跑/副本显式不适用)与 init 词元红线',
    distributionSurface: true,
    run: (dir) => {
      // 环境判据的判别力锚先跑(与所在环境无关的夹具驱动):判据判错会让下面整段走错分支——
      // 副本侧假红,或权威源侧静默漏检,故判据本身必须先被证明有条判别力。
      assertPackageContextJudgment(dir);
      const pkgCtx = resolvePackageContext();
      const marker = DISTRIBUTION_MARKERS[pkgCtx.kind];
      // 安装器分发面断言（升级路径清理）：权威源侧真跑真实命令序列，安装副本侧输出显式
      // 「不适用」行（两侧都出声——副本侧不是静默跳过）；故置于环境分支之前调用。
      assertInstallerUpgradePathCleanup(dir);
      // 安装器分发面断言（镜像清理的根级 fail-closed）：同一注入点的第二组判据——根自身为链接 /
      // 真实路径越界两变体 + 反向构造；副本侧同样输出显式「不适用」行。
      assertMirrorRootLinkFailClosed(dir, pkgCtx);
      if (pkgCtx.kind === 'copy') {
        console.log('  不适用（安装副本侧：' + pkgCtx.reason + '）——包体边界/bin 断言仅权威源侧可判，本项计通过');
        return marker;
      }
      assertPublishableManifest(pkgCtx.pkg);
      assertPackageBoundary(pkgCtx.root);
      assertWorkflowContractCheck(dir);
      assertInitTokenContract(assertBinContract(pkgCtx.pkg, pkgCtx.root), dir);
      return marker;
    },
  },

  // K19: 契约核对脚本 CLI 契约——五组真实命令断言（临时夹具 app/x.py 含 status 赋值、src/y.ts 含 status 比较）：
  // ① 显式 --backend/--frontend → exit 0 且输出含两个实际解析路径与两侧真实命中；
  // ② 缺省回退（cwd=夹具、无目录参数）→ exit 0 且两侧命中；
  // ③ 悬空 --backend（缺值）→ exit 1 + 用法错误；
  // ④ --project <夹具>（从夹具外运行）→ exit 0 且两侧命中（证明显式根优先于 cwd）；
  // ⑤ 单横线操作数（--backend -bad-dir / --project -x / --frontend -y）→ exit 1 + 用法与非法操作数提示
  //    （此前被当作目录接受、零命中仍 exit 0——fail-closed 缺口回归锚）。
  // 夹具随所在项临时目录由运行器统一清理，不留残留。
  {
    name: 'K19 契约核对:显式目录解析与缺省回退·悬空参数用法错误·单横线操作数拒绝·--project 形态(真实命令序列)',
    run: (dir) => {
      if (!fs.existsSync(CONTRACT)) throw new Error('缺少 contract-check.mjs: ' + CONTRACT);
      writeFile(dir, 'app/x.py', 'status = 3\n');
      writeFile(dir, 'src/y.ts', 'status === 3\n');
      const runContract = (args, cwd = dir) => {
        const res = spawnSync(process.execPath, [CONTRACT, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      // 输出头 `# <label>: <路径>` 取实际解析路径（断言脚本打印的是真实落点，而非回显参数）
      const resolvedPath = (res, label) => {
        const line = res.output.split(/\r?\n/).find((l) => l.startsWith('# ' + label + ': '));
        if (!line) throw new Error('输出缺少 ' + label + ' 解析路径头:\n' + res.output);
        return line.slice(('# ' + label + ': ').length).trim();
      };
      // ① 显式目录参数：exit 0 + 两个实际解析路径 + 两侧真实命中
      const explicit = runContract(['status', '--backend', 'app', '--frontend', 'src']);
      assertExit(explicit, 0);
      assertOut(explicit, 'status = 3');
      assertOut(explicit, 'status === 3');
      const backendPath = resolvedPath(explicit, 'backend');
      const frontendPath = resolvedPath(explicit, 'frontend');
      if (path.basename(backendPath) !== 'app' || path.basename(frontendPath) !== 'src') {
        throw new Error('解析路径落点错误: backend=' + backendPath + ' / frontend=' + frontendPath);
      }
      if (!fs.readFileSync(path.join(backendPath, 'x.py'), 'utf8').includes('status = 3')) {
        throw new Error('backend 实际解析路径未指向夹具: ' + backendPath);
      }
      if (!fs.readFileSync(path.join(frontendPath, 'y.ts'), 'utf8').includes('status === 3')) {
        throw new Error('frontend 实际解析路径未指向夹具: ' + frontendPath);
      }
      // ② 缺省回退：无目录参数时默认 <root>/app 与 <root>/src（root = cwd）
      const fallback = runContract(['status']);
      assertExit(fallback, 0);
      assertOut(fallback, 'status = 3');
      assertOut(fallback, 'status === 3');
      // ③ 悬空 --backend：缺值即用法错误 + 非零退出
      const dangling = runContract(['status', '--backend']);
      assertExit(dangling, 1);
      assertOut(dangling, '用法: node contract-check.mjs');
      assertOut(dangling, '--backend 后缺少后端目录值');
      // ④ --project 形态：从夹具外运行，显式项目根优先于 cwd（若被忽略则两侧都不命中）
      const elsewhere = path.join(dir, 'elsewhere');
      fs.mkdirSync(elsewhere, { recursive: true });
      const viaProject = runContract(['status', '--project', dir], elsewhere);
      assertExit(viaProject, 0);
      assertOut(viaProject, 'status = 3');
      assertOut(viaProject, 'status === 3');
      // ⑤ 单横线操作数：取值以 '-' 开头（含单横线形态）→ 用法错误 + 非零退出，不被当作目录
      //    （判据含选项名与非法操作数提示——只查 exit 1 无判别力，须证明拒绝理由在场）
      const assertDashOperandRejected = (opt, bad) => {
        const r = runContract(['status', opt, bad]);
        assertExit(r, 1);
        assertOut(r, '用法: node contract-check.mjs');
        assertOut(r, opt + ' 的目录操作数不得以 - 开头');
      };
      assertDashOperandRejected('--backend', '-bad-dir');
      assertDashOperandRejected('--project', '-x');
      assertDashOperandRejected('--frontend', '-y');
      console.log('  契约核对 CLI: 显式解析 + 缺省回退 + 悬空参数用法错误 + 单横线操作数拒绝 + --project 优先于 cwd ✓');
    },
  },

];

export const ENTRIES = RAW_ENTRIES.map(applyDistributionSurface);
