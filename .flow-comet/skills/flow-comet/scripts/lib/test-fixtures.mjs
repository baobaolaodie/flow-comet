// test-fixtures.mjs — 引擎套件的夹具、运行器与共享路径常量（单一来源）
//
// 定位：`guard-self-test.mjs` 的场景夹具与受控命令运行器。**不含判据**——什么算通过、
// 什么算残留，落在断言模块与文本锚判据模块；与 `system-test.mjs` 同名同责的工具在
// `test-helpers.mjs`（单源），本模块只保留本套件特有的夹具。
//
// 路径推导：本模块位于 `<技能包>/scripts/lib/`，`SCRIPTS_DIR` 由 import.meta.url 相对推导，
// 技能树内所有兄弟脚本与内置协议副本一律由它拼接（每个调用面各拼一遍就是第二份推导）。
//
// 套件夹具根 = 共享 `makeTmp` 的固定参数形态（套件前缀 + 登记数组）：收尾的「临时目录残留」
// 判据以该登记数组为唯一数据源，故绑定只在此一处，调用点保持零参数。

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  assertExit,
  assertOut,
  copyTreePortable,
  runGuard,
  runState,
  writeFile,
  makeTmp as sharedMakeTmp,
} from './test-helpers.mjs';

// 本模块位于 `<技能包>/scripts/lib/` ⇒ 脚本目录是它的上一级；技能树内所有兄弟脚本路径
// （GUARD / STATE / HOOK / HANDOFF / 侧命令 / 内置协议副本）一律由它拼接，调用面不再各拼一遍。
export const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// route-node 共享 Fix 判定纯函数（直接调用锚）：动态导入 + 顶层 await——缺失命名导出由
// requireRouteNodeExport 在场景内显式报告（RED 可定位到具体场景），避免静态命名 import 在
// 模块加载期失败导致其余场景一并 abort（整套件 0 场景、失败原因失焦）。
export const routeNodeModule = await import(pathToFileURL(path.join(SCRIPTS_DIR, 'route-node.mjs')).href);
export const GUARD = path.join(SCRIPTS_DIR, 'workflow-guard.mjs');
export const STATE = path.join(SCRIPTS_DIR, 'workflow-state.mjs');
export const HOOK = path.join(SCRIPTS_DIR, 'comet-hook-guard.mjs');
export const HANDOFF = path.join(SCRIPTS_DIR, 'workflow-handoff.mjs');
// prepare-env 安装器（平台选择链场景——真实脚本,场景用临时目录 + spawn 断言）：
// 仓库根（权威源检出）：脚本位于 <root>/.flow-comet/skills/flow-comet/scripts —— 4 级 .. 到 <root>。
// 单一来源：安装器路径、仓库文档级场景与底部自检共用（历史教训：同一路径表达式分散在多处，
// 布局迁移时逐处改写必然遗漏——本次迁移即因此把 4 处深度链收敛为一处）。
export const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
// 权威源锚点：仅权威源检出含 <root>/.flow-comet/（安装副本把技能树放在 .claude|.agents|.dsh/skills/，
// 其 .flow-comet/ 只是运行时目录，无 skills/flow-comet/SKILL.md）——与安装器自身判定同判据
// （prepare-env.mjs 的 gitignore 纳管跳过分支）。
export const AUTHORITATIVE_SOURCE_ANCHOR = path.join(REPO_ROOT, '.flow-comet', 'skills', 'flow-comet', 'SKILL.md');
export function isAuthoritativeSourceRepo() {
  return fs.existsSync(AUTHORITATIVE_SOURCE_ANCHOR);
}
// 权威源仓库脚本位于仓库根 scripts/prepare-env.mjs；安装副本无此脚本,场景跳过
export const PREPARE_ENV = path.join(REPO_ROOT, 'scripts', 'prepare-env.mjs');
// 内置协议源文件（packageRoot/reference/）：场景复制到 <tmpdir>/reference/ 内（protected-path 要求 runRoot 内）
export const BUILTIN_PROTOCOL_SOURCE = path.join(SCRIPTS_DIR, '..', 'reference', 'workflow-protocol.json');
export const CHANGE_ID = 'ch';

// 组件技能树布局感知（单一来源）：本 suite 恒位于 <skillsRoot>/flow-comet/scripts/，
// 组件技能（flow-comet-execute / flow-comet-review / flow-comet-verify 等）是 <skillsRoot>
// 下的同级目录。权威源 checkout → <root>/.flow-comet/skills/；安装副本 → <目标>/.claude|
// .agents|.dsh/skills/ —— 同一相对推导覆盖全部形态。禁止再假定权威源布局
// （REPO_ROOT/.flow-comet/skills 在安装副本形态不存在 → 技能文本锁场景 ENOENT，端到端冒烟缺陷）。
export function skillsRootForScriptsDir(scriptsDir) {
  return path.resolve(scriptsDir, '..', '..');
}
// 解析组件技能 SKILL.md：缺失即显式失败并给指引（MECHANISM 三·6「未验证 ≠ 通过」——
// 不得静默跳过）；scriptsDir 为可测接缝（技能文本锁场景的合成布局回归锚）。
export function resolveComponentSkillFile(nodeSkill, scriptsDir = SCRIPTS_DIR) {
  const skillsRoot = skillsRootForScriptsDir(scriptsDir);
  const file = path.join(skillsRoot, nodeSkill, 'SKILL.md');
  if (!fs.existsSync(file)) {
    throw new Error(
      '技能树布局定位失败：' + nodeSkill + '/SKILL.md 不存在。suite 脚本须位于 <skillsRoot>/flow-comet/scripts/' +
      '，组件技能为其同级目录；已解析 skillsRoot=' + skillsRoot + '，期望路径=' + file +
      '。权威源 .flow-comet/skills 与安装副本 .claude|.agents|.dsh/skills 均按此相对布局解析。'
    );
  }
  return file;
}

// 技能树分发面文档遍历（返回 [相对 skillsRoot 的斜杠路径, 绝对路径]）：全部 `*.md`
//（各册 `SKILL.md` + `flow-comet/reference/**.md`）。用于「持某锚句的文本集合」「相对路径引用
// 可解析性」这类**跨册面**判据——单一册判据不用它，避免判据面被无谓放大。
export function skillTreeDocFiles(scriptsDir = SCRIPTS_DIR) {
  const root = skillsRootForScriptsDir(scriptsDir);
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      out.push([path.relative(root, abs).replaceAll('\\', '/'), abs]);
    }
  };
  walk(root);
  return out;
}
export const createdDirs = [];

// 同步小睡（末尾延迟重试用；主线程可用 Atomics.wait 阻塞等待）
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 桥接身份透传契约（套件侧单一构造点，与真实桥接同形）：dsh 桥接在注入身份深度的**同时**注入
// 通道标记 FLOW_COMET_AGENT_DEPTH_SOURCE='dsh-bridge'；守卫要求两者同时在场才接受 env 面身份。
// 套件里凡是要表达「经桥接通道的子代理身份」，一律经本函数构造 env——变量名/标记值只此一处，
// 免得各处手抄而与守卫或桥接漂移。反向形态（只注入深度、不注入标记）由身份族的继承形态断言覆盖。
export function bridgeIdentityEnv(depthValue) {
  return {
    FLOW_COMET_AGENT_DEPTH: depthValue,
    FLOW_COMET_AGENT_DEPTH_SOURCE: 'dsh-bridge',
  };
}

// 跑 scripts/prepare-env.mjs（真实安装器——平台选择链场景）。cwd=临时目录；
// envOverrides 可覆盖 DSH_HOME（dsh 平台 installHooks 写 $DSH_HOME——场景必须设
// DSH_HOME=临时目录环境变量,禁止污染真实 ~/.dsh；spawn 非 TTY:走探测/默认路径,不触发交互）
export function runPrepareEnv(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [PREPARE_ENV, ...args], {
    cwd: root,
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout: 120000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 workflow-state.mjs 的 bridge-check 只读子命令（T05 实现——六判定态健康/文件缺失/
// 未挂载/版本偏斜/重复注册/不适用）。runRoot = cwd = 项目根；协议副本须在 runRoot 内
// （protected-path）——指向运行器已复制到 <root>/reference/ 的内置协议副本
// （FLOW_COMET_PROTOCOL env 优先级高于默认，见 protocol-utils resolveProtocol）。
export function runBridgeCheck(root, dshHome) {
  return runState(['bridge-check'], root, {
    DSH_HOME: dshHome,
    FLOW_COMET_PROTOCOL: path.join(root, 'reference', 'workflow-protocol.json'),
  });
}

// 桥接夹具 loader 写入（单一来源——bridge-check 夹具与安装副本形态夹具共用；两处各自
// 拼装锚点行会随契约格式演进分叉）。返回 loader 绝对路径。
export function writeBridgeLoaderFixture(dshHome, loaderStamp) {
  const loaderPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
  writeFile(dshHome, 'plugins/dsh-flow-comet-bridge.mjs',
    '// dsh bridge loader fixture\n// BRIDGE_VERSION: ' + loaderStamp + '\n' +
    "export const name = 'dsh-flow-comet-bridge';\nexport const version = '" + loaderStamp + "';\n");
  return loaderPath;
}

// cordis.patch.yml 托管块（insert 形态 + file:// 引用）逐字构造（单一来源，同上）。
export function managedCordisBlockFor(loaderPath) {
  const fileUrl = pathToFileURL(loaderPath).href;
  return '# --- flow-comet managed ---\n- insert:\n    - id: dsh-flow-comet-bridge\n      name: \'' +
    fileUrl.replace(/'/g, "''") + '\'\n# --- end flow-comet managed ---\n';
}

// bridge-check 版本断言的期望值归一（测试侧镜像生产 bridge-check 契约：仅剥离 git-describe
// dev 态后缀 `-<N>-g<hash>`，大小写不敏感；预发布标识不匹配、不剥离）。套件自身
// INSTALLED_VERSION 在权威源检出差为发布标记、在安装副本内为 dev 态戳——期望必须从载体
// 原始戳归一出的基础版本派生，两种载体形态（权威源 / 安装副本）才都可移植。
export const FIXTURE_BRIDGE_DEV_SUFFIX_RE = /-\d+-g[0-9a-f]+$/i;
export function fixtureBridgeBaseVersion(version) {
  return String(version).replace(FIXTURE_BRIDGE_DEV_SUFFIX_RE, '');
}
export function fixtureIsBridgeDevVersion(version) {
  return FIXTURE_BRIDGE_DEV_SUFFIX_RE.test(String(version));
}

// 发布同步守卫（场景 200 子断言）纯函数：权威源 loader 的标记行 / 导出常量与载体
// INSTALLED_VERSION 三处一致性判定——比较语义 = bridge-check 既有语义（MECHANISM 二·二十七
// 「bridge-check 基础版本归一」：比较前剥离 git-describe dev 态后缀 `-<N>-g<hash>`、按基础版本
// 比较；预发布标识（如 -rc.N）不是 dev 态后缀、不剥离；基础版本不同（含发布版对发布版）仍报
// 漂移）。归一复用 fixtureBridgeBaseVersion（单点正则，不再复制第二份实现）——发布态权威源与
// dev 态安装副本（INSTALLED_VERSION = `<发布>-<N>-g<hash>`）归一后同基础判同步；真实跨文件/
// 跨值分叉仍必报。返回问题描述数组（空 = 三处基础版本一致）。
export function bridgeStampSyncProblems(markerStamp, exportStamp, installedVersion) {
  const base = fixtureBridgeBaseVersion;
  const problems = [];
  if (base(markerStamp) !== base(installedVersion)) {
    problems.push('标记行=' + markerStamp + '（基础 ' + base(markerStamp) + '）vs INSTALLED_VERSION=' + installedVersion + '（基础 ' + base(installedVersion) + '）');
  }
  if (base(exportStamp) !== base(installedVersion)) {
    problems.push('export=' + exportStamp + '（基础 ' + base(exportStamp) + '）vs INSTALLED_VERSION=' + installedVersion + '（基础 ' + base(installedVersion) + '）');
  }
  return problems;
}

// 发布同步守卫（场景 200）子锚表（判别力双向，全部由载体基础版本派生）：正例 = 三处基础版本一致
// （含 dev 态副本戳 vs 权威源发布戳的真实形态、两侧 dev 后缀同基础）；负例 = 标记行 / export
// 任一基础版本漂移、发布版对发布版失配、预发布标识不剥离——归一不得放行真实漂移。
export function bridgeStampSyncSubAnchorCases(baseVersion, devVersion) {
  const major = parseInt(baseVersion.split('.')[0], 10);
  const otherBase = (major + 9) + '.0.0';
  return [
    { label: 'dev 态副本戳 vs 权威源发布戳同基础', expectSync: true, problems: bridgeStampSyncProblems(baseVersion, baseVersion, devVersion) },
    { label: '两侧 dev 后缀同基础', expectSync: true, problems: bridgeStampSyncProblems(baseVersion + '-2-g1234567', baseVersion + '-1-gabcdef0', devVersion) },
    { label: '标记行基础版本不同', expectSync: false, problems: bridgeStampSyncProblems(otherBase, baseVersion, devVersion) },
    { label: 'export 基础版本不同', expectSync: false, problems: bridgeStampSyncProblems(baseVersion, otherBase, devVersion) },
    { label: '发布版对发布版失配', expectSync: false, problems: bridgeStampSyncProblems('9.9.9-fixture-skew', baseVersion, baseVersion) },
    { label: '预发布标识不剥离', expectSync: false, problems: bridgeStampSyncProblems(baseVersion + '-rc.3', baseVersion, devVersion) },
  ];
}

// 组装 dsh 桥接健康夹具（bridge-check 六态场景共用）：项目根挂 .dsh/skills/flow-comet
// 适用性门；$DSH_HOME/plugins/ 放 loader（含契约锚点 BRIDGE_VERSION 戳，值取自权威源
// INSTALLED_VERSION，与 bridge-check 比对源同值——健康态恒等、偏斜态可控）；cordis.patch.yml
// 托管块按安装器实际写入形态（insert 条目 + file:// 引用——形态断言）逐字构造。
// overrides: { loaderStamp, skipLoader, patchContent, outsideBlock }
export function writeBridgeFixture(dir, overrides = {}) {
  const dshHome = overrides.dshHome || path.join(dir, 'dshhome');
  const installedVersion = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'INSTALLED_VERSION'), 'utf8').trim();
  const loaderStamp = overrides.loaderStamp || installedVersion;
  writeFile(dir, '.dsh/skills/flow-comet/.fixture-anchor', 'fixture\n');
  const loaderPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
  if (!overrides.skipLoader) {
    writeBridgeLoaderFixture(dshHome, loaderStamp);
  }
  const managedBlock = managedCordisBlockFor(loaderPath);
  writeFile(dshHome, 'cordis.patch.yml',
    overrides.patchContent !== undefined
      ? overrides.patchContent
      : managedBlock + (overrides.outsideBlock || ''));
  return { dshHome, loaderPath, installedVersion, managedBlock };
}

// 安装副本形态夹具（版本比较场景）：把本 suite 自身技能树整体复制为
// <dir>/.dsh/skills/flow-comet —— 被检脚本与同包 INSTALLED_VERSION 因而都可控。
// bridge-check 读取脚本同包（`<脚本目录>/..`）的 INSTALLED_VERSION：权威源检出路径固定为
// 发布标记，无法表达「载体 INSTALLED_VERSION 为 dev 态（git describe 后缀）」的形态；
// 只有以副本自身脚本运行才能构造真实 dev 态载体（与 prepare-env 安装出的形态同构）。
// 返回 { dshHome, skillCopy }；loader 戳由调用方指定，与 INSTALLED_VERSION 可不同。
export function writeInstalledCopyBridgeFixture(dir, { installedVersion, loaderStamp }) {
  const skillCopy = path.join(dir, '.dsh', 'skills', 'flow-comet');
  copyTreePortable(path.join(SCRIPTS_DIR, '..'), skillCopy);
  writeFile(skillCopy, 'INSTALLED_VERSION', installedVersion + '\n');
  const dshHome = path.join(dir, 'dshhome');
  const loaderPath = writeBridgeLoaderFixture(dshHome, loaderStamp);
  writeFile(dshHome, 'cordis.patch.yml', managedCordisBlockFor(loaderPath));
  return { dshHome, skillCopy };
}

// 以安装副本自身脚本运行 bridge-check（runRoot = 载体项目根；协议副本在 skill 包内，
// 与真实安装形态一致——默认协议解析即为 <skillCopy>/reference/workflow-protocol.json）。
export function runBridgeCheckFromCopy(dir, dshHome, skillCopy) {
  const res = spawnSync(process.execPath, [path.join(skillCopy, 'scripts', 'workflow-state.mjs'), 'bridge-check'], {
    cwd: dir,
    env: {
      ...process.env,
      FLOW_COMET_RUN_ROOT: dir,
      FLOW_COMET_PROTOCOL: path.join(skillCopy, 'reference', 'workflow-protocol.json'),
      DSH_HOME: dshHome,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 套件夹具根：共享 `makeTmp` 的套件形态固定参数（本套件前缀 + 登记数组）；调用点保持零参数。
export function makeTmp() {
  return sharedMakeTmp({ prefix: 'flow-comet-guard-test-', register: createdDirs });
}

// 具名 import 断言（容忍多行 / 符号重排 / 其它符号共存）：source 为模块说明符（`./state-schema.mjs`）。
// 与场景 154 的内联写法同判据，本处提为复用工具（原子写与元数据常量两处消费面都要断言）。
export function hasNamedImport(text, source, name) {
  const pattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(String(text))) !== null) {
    if (match[2] !== source) continue;
    const names = match[1].split(',').map((piece) => piece.trim().split(/\s+as\s+/).pop());
    if (names.includes(name)) return true;
  }
  return false;
}

// ---------- 自定义协议场景材料 ----------

// 自定义协议（compose-demo）：3 节点 brainstorm/tdd/codereview（避开内置 8 节点 id，验证
// 协议数据化路由与通用层防线对自定义节点生效）；无 writeWhitelist（hook 回退内置缺省表）；
// state 与内置协议同构（statePath 指向 .flow-comet/flow-comet-state.json）
export function customProtocol() {
  return {
    schemaVersion: 1,
    kind: 'workflow-kernel',
    name: 'compose-demo',
    goal: 'T06 自定义协议场景：协议数据化路由 + 通用层防线 + 特化校验绑定。',
    nodes: [
      {
        id: 'brainstorm',
        label: 'Brainstorm',
        kind: 'control',
        responsibility: '产出 notes.md。',
        outputSchemas: ['compose.notes.v1'],
        requiredSkillCalls: [],
        augmentations: [],
        disabled: false,
      },
      {
        id: 'tdd',
        label: 'TDD',
        kind: 'control',
        responsibility: '产出 *-SUMMARY.md。',
        outputSchemas: ['compose.tdd.v1'],
        requiredSkillCalls: [],
        augmentations: [],
        disabled: false,
      },
      {
        id: 'codereview',
        label: 'Code Review',
        kind: 'control',
        responsibility: '产出 verdict.md。',
        outputSchemas: ['compose.verdict.v1'],
        requiredSkillCalls: [],
        augmentations: [],
        disabled: false,
      },
    ],
    outputSchemas: [
      {
        id: 'compose.notes.v1',
        description: 'notes.md',
        artifacts: [
          {
            id: 'notes',
            kind: 'file',
            required: true,
            paths: ['<change-id>/notes.md'],
            pathBase: 'specs-root',
          },
        ],
        evidence: [{ id: 'notes-summary', required: true }],
      },
      {
        id: 'compose.tdd.v1',
        description: '*-SUMMARY.md',
        artifacts: [
          {
            id: 'summaries',
            kind: 'file',
            required: true,
            paths: ['<change-id>/*-SUMMARY.md'],
            pathBase: 'specs-root',
          },
        ],
        evidence: [{ id: 'tdd-summary', required: true }],
      },
      {
        id: 'compose.verdict.v1',
        description: 'verdict.md',
        artifacts: [
          {
            id: 'verdict',
            kind: 'file',
            required: true,
            paths: ['<change-id>/verdict.md'],
            pathBase: 'specs-root',
          },
        ],
        evidence: [{ id: 'verdict-summary', required: true }],
      },
    ],
    state: {
      kind: 'workflow-run',
      statePath: '.flow-comet/flow-comet-state.json',
      currentNodeField: 'currentNode',
      completedNodesField: 'completedNodes',
      evidenceField: 'evidence',
    },
    edges: [],
  };
}

// 含 requiredSkillCalls 的自定义协议变体——compose 自定义节点可声明必调 skill
// （compose SKILL 节点组装 requiredSkillCalls 可空）；skill-load/record 端到端验证用：
// 仅 brainstorm 带 main scope 绑定（协调者加载 → 需 skill-load 声明标记），其余与 customProtocol() 同
export function customProtocolWithSkillCall() {
  const p = customProtocol();
  p.nodes[0].requiredSkillCalls = [{ skill: 'flow-comet-brainstorm', scope: 'main' }];
  return p;
}

// 写入 <dir>/custom-protocol.json，返回绝对路径（供 --protocol CLI / FLOW_COMET_PROTOCOL env 使用）
export function writeCustomProtocol(dir) {
  writeFile(dir, 'custom-protocol.json', JSON.stringify(customProtocol(), null, 2) + '\n');
  return path.join(dir, 'custom-protocol.json');
}

// compose-demo 场景 state（currentNode 默认 brainstorm；hook 场景需补 status:'running'）
export function composeState(overrides = {}) {
  return {
    activeChange: 'compose-demo',
    currentNode: 'brainstorm',
    completedNodes: [],
    evidence: {},
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
    ...overrides,
  };
}

// 完整 SUMMARY：六段齐全（## verify 输出 / ## 6 维自查 / ## 越界检查 / ## 做了什么 / ## 改动文件 / ## 自检方法）
// 6 维自查默认含实质内容且声明 brooks-review；method='' 表示去掉 ## 自检方法 段（旧格式场景）
export function summaryContent(options = {}) {
  const sixDim = options.sixDim !== undefined
    ? options.sixDim
    : '## 6 维自查\n\n- 功能: 通过（brooks-review 已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过';
  const method = options.method !== undefined ? options.method : '## 自检方法\n\nbrooks-review';
  return [
    '# T01-SUMMARY',
    '',
    '## verify 输出',
    '',
    '```',
    'node --check src/t1.mjs',
    '```',
    '',
    sixDim,
    '',
    '## 越界检查',
    '',
    '仅修改 src/t1.mjs，无越界。',
    '',
    '## 做了什么',
    '',
    '实现 T01。',
    '',
    '## 改动文件',
    '',
    '- src/t1.mjs',
    '',
    method,
    '',
  ].join('\n');
}

// 新 change 模板保真 SUMMARY（M1 严格形态：# SUMMARY: 标题 + 首部 4 字段 + 段序保真——
// directOverride 授权约束场景（213~216）用：新 change 出口强制模板保真，旧 summaryContent
// 无 # SUMMARY: 标题会被 M1 BLOCKED，不能用于正例/恢复场景）
export function strictSummary(taskId) {
  return [
    '# SUMMARY: ' + taskId + ' - 实现 ' + taskId,
    '',
    '- **Change ID**: ' + CHANGE_ID,
    '- **Task ID**: ' + taskId,
    '- **完成时间**: 2026-08-29 10:00',
    '- **AI 角色**: Dev',
    '',
    '---',
    '',
    '## 做了什么',
    '',
    '实现 ' + taskId + '（TDD：先写失败场景再实现）。',
    '',
    '## 改动文件',
    '',
    '| 文件 | 性质 | 说明 |',
    '|---|---|---|',
    '| src/' + taskId.toLowerCase() + '.mjs | 修改 | 实现任务 |',
    '',
    '## verify 输出',
    '',
    '```',
    'node --check src/' + taskId.toLowerCase() + '.mjs',
    '```',
    '',
    '## 6 维自查',
    '',
    '- 功能: 通过（brooks-review 已跑）',
    '- 性能: 无影响',
    '- 安全: 无影响',
    '- 兼容: 通过',
    '- 可观测: 通过',
    '- 可维护: 通过',
    '',
    '## 数据库迁移',
    '',
    'N/A：本任务无 schema 变更（条件段按模板占位）。',
    '',
    '## 越界检查',
    '',
    '仅修改 src/' + taskId.toLowerCase() + '.mjs，无越界。',
    '',
    '## 破坏性变更',
    '',
    'N/A：本任务不涉及破坏性变更。',
    '',
    '## 决策与偏离',
    '',
    '无偏离。',
    '',
    '## 是否触发新工作',
    '',
    '无。',
    '',
    '## 完成判定',
    '',
    '- TASK.md 中对应任务已勾选：是',
    '',
    '## 自检方法',
    '',
    'brooks-review',
    '',
  ].join('\n');
}

// 伪造 handoffResult（越俎代庖检测要求 done 任务有 handoff；Return Contract 完整形状）
// handoff-guarded 落实——result 必须回传 completedChecks 含
// required-skill:subagent-execute.flow-comet-dev（guard W1-D 严格校验；相关场景同步补齐，
// 缺该字段的旧格式材料已明确覆盖 BLOCKED 路径）
export function handoffFor(taskIds) {
  const handoffResult = {};
  for (const id of taskIds) {
    handoffResult[id] = {
      result: {
        commitHash: 'abcd1234',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/' + id.toLowerCase() + '.mjs' },
        redEvidence: { command: 'node --check src/' + id.toLowerCase() + '.mjs' },
      },
    };
  }
  return handoffResult;
}

export const TASK_DONE =
  '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n';
export const TASK_DONE_TWO =
  '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="T02" status="done"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify></task>\n';
export const TASK_SERIAL_PENDING =
  '<task id="T01"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n';
export const TASK_P1 =
  '<task id="P01" status="done" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n';
export const TASK_P2 =
  '<task id="P02" status="done" parallel="true"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n';
// 第二波 parallel pending 任务（depends_on P01 已满足——第一波 P01 done 后才可委托；
// status 属性在前，与上方 parallel 任务常量的属性顺序一致）
export const TASK_P2_PENDING =
  '<task id="P02" status="pending" parallel="true"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>P01</depends_on></task>\n';
// 串行 pending 任务（depends P01,P02——第二波 P02 完成前不可执行）
export const TASK_T03_PENDING =
  '<task id="T03"><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
// review/verify 阶段追加的 pending 修复任务（标准回退路径触发源）
export const TASK_TFIX =
  '<task id="T-FIX-01" status="pending"><action>修复 verify 发现的缺陷</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n';

// ---------- 波次分组合法性场景任务集（T01 新增） ----------
// parallel="true" = 并行任务，parallel="false"/缺省 = 串行任务；序列判定以 <task> 块出现顺序为准。
// 回归：混排集里 P01 写成属性序 status 在前（status="pending" parallel="true"），
// 且串行任务 T01 的 <action> 文本内含 literal parallel="true" 字样（不改变语义）——开标签解析
// 属性序无关且不被块内文本干扰（旧整块查找会误判 T01 为并行 → 混排漏报）。
// 串→并→串（S→P→S）：串行 T01 → 并行 P01/P02 → 串行 T02（混排，禁止）
export const TASK_MIXED_SPS =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01（串行任务，动作描述含 literal parallel="true" 字样，不影响并行标记）</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="P01" status="pending" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
// 并→串→并（P→S→P）：并行 P01/P02 → 串行 T01 → 并行 P03/P04（混排，禁止）。
// 回归同上：P01 属性序 status 在前；串行任务 T01 的 <action> 文本含 literal parallel="true"。
export const TASK_MIXED_PSP =
  '<task id="P01" status="pending" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n' +
  '<task id="T01" parallel="false" status="pending"><action>实现 T01（串行任务，动作描述含 literal parallel="true" 字样，不影响并行标记）</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify><depends_on>P01,P02</depends_on></task>\n' +
  '<task id="P03" parallel="true" status="pending"><action>实现 P03</action><write_files>src/p3.mjs</write_files><verify>node --check src/p3.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="P04" parallel="true" status="pending"><action>实现 P04</action><write_files>src/p4.mjs</write_files><verify>node --check src/p4.mjs</verify><depends_on>T01</depends_on></task>\n';
// 并存前+串在后（P→S）：并行 P01/P02 → 串行 T01（合法成组）。
// 引号形态回归（解析一致性）：P01/P02 用**单引号属性**（XML 合法形态）——单引号属性若不解析，
// 并行任务退化为非并行（route-node 误路由到 execute、并行写写检测漏判），本常量被场景 175 用于
// 断言 `NODE: subagent-execute`，漏解析即 RED。
export const TASK_VALID_PS =
  "<task id='P01' parallel='true' status='pending'><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n" +
  "<task id='P02' parallel='true' status='pending'><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n" +
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
// 串在前+并在后（S→P）：串行 T01 → 并行 P01/P02（合法成组）
export const TASK_VALID_SP =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>T01</depends_on></task>\n';
// 全串行（全 S）
export const TASK_VALID_ALL_SERIAL =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>T01</depends_on></task>\n';
// 全并行（全 P，单连续块）
export const TASK_VALID_ALL_PARALLEL =
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n' +
  '<task id="P03" parallel="true" status="pending"><action>实现 P03</action><write_files>src/p3.mjs</write_files><verify>node --check src/p3.mjs</verify></task>\n' +
  '<task id="P04" parallel="true" status="pending"><action>实现 P04</action><write_files>src/p4.mjs</write_files><verify>node --check src/p4.mjs</verify></task>\n';

// ---------- 多趟路由场景任务集（多趟语义批次：依赖环拦截与缺失依赖拦截场景原位重写 + 尾部新增场景族） ----------
// 依赖环：P01↔P02 互为 depends_on（依赖图有环 → plan 出口 BLOCKED 含「依赖环」+ depends_on 恢复指引）
export const TASK_DEP_CYCLE =
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>P02</depends_on></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>P01</depends_on></task>\n';
// 依赖缺失：P01 依赖不存在的 T99（依赖链不可满足 → plan 出口 BLOCKED 含恢复指引）
export const TASK_MISSING_DEP =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="P01" status="pending" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T99</depends_on></task>\n';
// 并行写冲突（replan 越界场景扩展）：前置串行任务已 done，两个并行任务依赖已满足且 write_files
// 重叠——plan 出口写写强判为 BLOCKED，replan 不做校验豁免、必须同样 BLOCK 且状态零改写（禁止备份先于拦截）。
export const TASK_PARALLEL_WRITE_CONFLICT =
  '<task id="S01" parallel="false" status="done"><action>完成 S01</action><write_files>src/s01.mjs</write_files><verify>node --check src/s01.mjs</verify></task>\n' +
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify><depends_on>S01</depends_on></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify><depends_on>S01</depends_on></task>\n';

// 并行读写弱判（replan 侧）：同一对并行任务无显式 depends_on，一方读取对方
// 写路径 → 与 plan 出口同一判据：read∩write 仅 WARN 不阻断，replan 照常重签并写重签前备份。
export const TASK_PARALLEL_READ_OVERLAP =
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><read_files>src/shared.mjs</read_files><write_files>src/other.mjs</write_files><verify>node --check src/other.mjs</verify></task>\n';

// 同文件跨任务（第三族）夹具族：串行拆分出的同文件任务、彼此无 depends_on（#125 要抓的形态）。
// ① 非修复任务对 → 必须命中；② 修复任务族对（同文件回修）→ 不参与（顺序由修复生命周期保证）；
// ③ 混合夹具：两类并存 → 只报非修复对（反向构造：第三族缺位时 ①③ 必然放过）。
export const CROSS_TASK_PLAIN_PAIR =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify></task>\n'
  + '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify></task>\n';
export const CROSS_TASK_FIX_PAIR =
  '<task id="T-FIX-01" parallel="false" status="pending"><action>修复 T-FIX-01</action><write_files>src/fix-shared.mjs</write_files><verify>node --check src/fix-shared.mjs</verify></task>\n'
  + '<task id="T-FIX-02" parallel="false" status="pending"><action>修复 T-FIX-02</action><write_files>src/fix-shared.mjs</write_files><verify>node --check src/fix-shared.mjs</verify></task>\n';
export const CROSS_TASK_MIXED_PAIR =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify></task>\n'
  + '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify></task>\n'
  + '<task id="T-FIX-01" parallel="false" status="pending"><action>修复 T-FIX-01</action><write_files>src/other-shared.mjs</write_files><verify>node --check src/other-shared.mjs</verify></task>\n'
  + '<task id="T-FIX-02" parallel="false" status="pending"><action>修复 T-FIX-02</action><write_files>src/other-shared.mjs</write_files><verify>node --check src/other-shared.mjs</verify></task>\n';
// ④ **段归属分支**夹具：修复段内的任务 id **不带**修复族前缀（F01/F02）——判定必须靠「位于修复
// 任务段内」这条边界，而不是 id 命名。既有 ② 用的是带前缀 id，走的是 id 分支，段归属分支此前
// 没有行为夹具（该分支的行尾归一口径缺陷因此漏过）。
// **块内必须跨行**：单行块在 LF 与 CRLF 下文本完全相同，行尾口径缺陷无从显现——真实 TASK.md
// 的任务块本就跨行，夹具按真实形态构造（否则夹具自身无判别力）。
export const CROSS_TASK_FIX_SECTION_PAIR =
  '## Fix 任务（来自 REVIEW）\n\n'
  + '<task id="F01" parallel="false" status="pending">\n'
  + '  <action>回修 F01</action>\n'
  + '  <write_files>src/section-shared.mjs</write_files>\n'
  + '  <verify>node --check src/section-shared.mjs</verify>\n'
  + '</task>\n'
  + '<task id="F02" parallel="false" status="pending">\n'
  + '  <action>回修 F02</action>\n'
  + '  <write_files>src/section-shared.mjs</write_files>\n'
  + '  <verify>node --check src/section-shared.mjs</verify>\n'
  + '</task>\n';

// 波次分组场景公共路径：注入 TASK.md → entry plan（记录 enteredNodes，新 change 强制先 entry；
// 旧 change 亦先 entry 避免 ENTER WARN 干扰断言）→ exit plan。返回 exit plan 结果。
export function runPlanExit(dir, taskContent) {
  writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 任务清单\n\n' + taskContent);
  assertExit(runGuard(['entry', 'plan'], dir), 0);
  return runGuard(['exit', 'plan'], dir);
}

// 多波混合任务集：串 T01 → 并 P01/P02(dep T01) → 串 T02(dep P01,P02) → 并 P03/P04(dep T02)。
// ≥2 个并行块被串行任务分隔（混排合法锚 / 多趟推进完成场景共用）；doneIds 控制各任务 status，
// 模拟执行推进（next 分趟路由断言用）。
export const MULTI_WAVE_TASKS = [
  ['T01', false, []],
  ['P01', true, ['T01']],
  ['P02', true, ['T01']],
  ['T02', false, ['P01', 'P02']],
  ['P03', true, ['T02']],
  ['P04', true, ['T02']],
];

export function renderMultiWaveTasks(doneIds = []) {
  const done = new Set(doneIds);
  return MULTI_WAVE_TASKS.map(([id, parallel, deps]) =>
    '<task id="' + id + '"' + (parallel ? ' parallel="true"' : ' parallel="false"') +
    ' status="' + (done.has(id) ? 'done' : 'pending') + '">' +
    '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
    '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
    (deps.length > 0 ? '<depends_on>' + deps.join(',') + '</depends_on>' : '') +
    '</task>\n').join('');
}

// 多波 next 断言公共材料：前序产物文件（open/design/plan 的产物门控按文件推导）
export function writeIntakeArtifacts(dir) {
  writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\nx');
  writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\nx\n\n## 验收准则（AC）\n\n- Given x When y Then z');
  writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n\nNode\n\n## 决策清单\n\n| # | D | R |\n|---|---|---|\n| D1 | x | y |');
}

// ---------- 位置迁移 / 备份 / 感知层剥离场景材料 ----------
// 全部经真实安装器（scripts/prepare-env.mjs）在临时项目上执行——断言落在真实文件系统状态与
// 进程输出上（端到端执行断言），不用形态断言替代。夹具路径一律 os.tmpdir()/path.join 生成
// （Windows 平台：bash 的 /tmp 会被 node 解析为当前盘根——夹具必须由 node 侧构造）。

export const LEGACY_RUNTIME_DIR = '.comet';
export const RUNTIME_DIR = '.flow-comet';
export const RUNTIME_STATE_NAME = 'flow-comet-state.json';
export const MIGRATION_CHANGE = 'mig-ch';

// 迁移前状态字节（健康 JSON——白名单唯一在册的运行时文件）
export function migratableStateBytes(activeChange = MIGRATION_CHANGE) {
  return Buffer.from(JSON.stringify({
    activeChange,
    currentNode: 'design',
    completedNodes: ['open'],
    evidence: { open: { summary: 'intake complete' } },
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
  }, null, 2) + '\n', 'utf8');
}

// 旧命名空间三方共占夹具（实测形态）：flow-comet 运行时文件 + Comet 资产（config.yaml / runs/）
// + 用户自有文件（*.bak-*）。返回各非白名单项的迁移前字节，供「原位未动」断言（位置 + 内容）。
export function writeSharedCometDir(proj, stateBytes) {
  const legacyDir = path.join(proj, LEGACY_RUNTIME_DIR);
  fs.mkdirSync(path.join(legacyDir, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(legacyDir, RUNTIME_STATE_NAME), stateBytes);
  fs.writeFileSync(path.join(legacyDir, 'config.yaml'), 'workflow:\n  projectPath: docs/openspec\n');
  fs.writeFileSync(path.join(legacyDir, 'runs', 'run-001.json'), '{"comet":true}\n');
  fs.writeFileSync(path.join(legacyDir, RUNTIME_STATE_NAME + '.bak-20260901-user'), 'user backup\n');
  const kept = ['config.yaml', 'runs/run-001.json', RUNTIME_STATE_NAME + '.bak-20260901-user'];
  return kept.map((rel) => ({ rel, bytes: fs.readFileSync(path.join(legacyDir, rel)) }));
}

// 迁移生成的备份清单（新命名空间内 flow-comet-state.json.bak-<时间戳>）
export function migrationBackups(proj) {
  const dir = path.join(proj, RUNTIME_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^flow-comet-state\.json\.bak-/.test(name)).sort();
}

// 目标项目的 .specs 工件（迁移后「流程可继续」断言需要活动 change 目录在场）
export function writeMigratedProjectArtifacts(proj, changeId = MIGRATION_CHANGE) {
  writeFile(proj, '.specs/' + changeId + '/CHANGE.md', '# CHANGE\n\n- **Change ID**: ' + changeId + '\n\n## Why（为什么做）\n\nx\n');
  writeFile(proj, '.specs/' + changeId + '/REQUIREMENT.md', '# REQUIREMENT\n\n- **Change ID**: ' + changeId + '\n\n## 用户故事（User Story）\n\nx\n\n## 验收准则（AC）\n\n- y\n');
}

// 跑安装副本内的脚本（cwd = 目标项目根——runRoot = process.cwd()）：迁移后链路在
// 真实安装形态（而非权威源脚本）上验证
export function runInstalled(proj, platformRoot, scriptName, args) {
  const script = path.join(proj, platformRoot, 'skills', 'flow-comet', 'scripts', scriptName);
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: proj,
    env: { ...process.env, FLOW_COMET_RUN_ROOT: proj },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 安装器输出/判定文本归一化（两个夹具的项目根不同——比较判定一致性前抹掉根路径差异）
export function normalizeRoot(text, ...roots) {
  let out = String(text);
  for (const root of roots) {
    out = out.split(root).join('<root>');
    out = out.split(root.replace(/\\/g, '/')).join('<root>');
  }
  return out;
}

// Comet classic 资产夹具（感知层对照用）：classic 配置 + 一个 phase=build 的活动 change
// + overlay 证据目录——旧感知层正是据此推导节点，故它们是"判定是否还读这些文件"的探针。
export function writeClassicCometAssets(proj) {
  writeFile(proj, '.comet/config.yaml', 'workflow:\n  projectPath: docs/openspec\n');
  writeFile(proj, 'docs/openspec/changes/classic-marker/.comet.yaml', 'phase: build\nbuild_pause: plan-ready\n');
  writeFile(proj, '.comet/workflow-evidence/classic-marker/overlay.json', '{}\n');
}

// gitignore 纳管公共链路（三形态共用）：写入既有内容 → 连续两次安装 → 返回两次结果与两次
// 安装后的 .gitignore 全文（字符串，逐字节比较用）
export function runGitignoreForm(dir, proj, initialContent) {
  fs.writeFileSync(path.join(proj, '.gitignore'), initialContent, 'utf8');
  const first = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
  const afterFirst = fs.readFileSync(path.join(proj, '.gitignore'), 'utf8');
  const second = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
  const afterSecond = fs.readFileSync(path.join(proj, '.gitignore'), 'utf8');
  return { first, second, afterFirst, afterSecond };
}

// 纳管公共断言：两次安装均成功；新命名空间条目恰一行；第二次安装逐字节无变化（幂等）
export function assertGitignoreManaged(result) {
  assertExit(result.first, 0);
  assertExit(result.second, 0);
  const entries = result.afterFirst.split(/\r?\n/)
    .filter((line) => line.trim().replace(/^\/+/, '').replace(/\/+$/, '') === RUNTIME_DIR);
  if (entries.length !== 1) throw new Error(RUNTIME_DIR + '/ 条目应恰一行，实际 ' + entries.length + ' 行');
  if (result.afterSecond !== result.afterFirst) {
    throw new Error('第二次安装改写了 gitignore（应幂等）:\n' +
      JSON.stringify({ afterFirst: result.afterFirst, afterSecond: result.afterSecond }, null, 2));
  }
  assertOut(result.second, '保持原样');
}

// ---------- 结构锚的共享判定（判别力升级：按表达式形态计数，而不只是数标识符名） ----------

// ---------- 引擎实现面（结构锚的单一受检面） ----------
// 结构锚测的是**引擎实现面**，不是「scripts/ 顶层的文件名集合」：判定族下沉到 `lib/` 后，按顶层
// 平铺扫描的锚对迁出的实现**静默失明**（不红、继续绿——比红更危险），故受检面按**模块图派生**：
// 入口（顶层 `.mjs`，除两个套件入口）∪ 从入口静态可达的模块。套件自持模块（夹具 / 断言 / 文本锚
// 判据 / 计数派生）与两个数据目录（`scenarios/`、`items/`）因此落在面外——它们的文本本身携带被禁
// 形态的**样例**（夹具输入、反向构造探针），是判据的输入而非引擎实现；它们的分发面纪律由词表
// 扫描的递归面（注释层零代号，含数据目录）另行看守。
// 面无文件名清单：模块再搬家 / 再切分不必改锚；面收缩同样有读数（迁移后的实现若掉出面，白名单
// 「实际 0 处」一类断言即红，不静默）。
export const SUITE_ENTRY_FILES = new Set(['guard-self-test.mjs', 'system-test.mjs']);

// 静态导入 / 再导出的相对说明符（`from '…'` / `import('…')` / 裸 `import '…'`）：模块图的边。
function staticImportSpecifiers(text) {
  const out = [];
  for (const match of String(text).matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) out.push(match[1]);
  return out;
}

// 说明符 → 技能树内相对路径（posix 形态）；越出脚本目录或非 `.mjs` 时返回 null。
export function resolveEngineSpecifier(fromRel, specifier) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), specifier));
  if (!target.endsWith('.mjs') || target.startsWith('..')) return null;
  return target;
}

// 从给定根集合出发的静态可达闭包（模块图的 BFS）：返回相对路径集合。
export function engineReachableFrom(roots, scriptsDir = SCRIPTS_DIR) {
  const queue = [...roots];
  const seen = new Set();
  while (queue.length > 0) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const abs = path.join(scriptsDir, rel);
    if (!fs.existsSync(abs)) continue;
    seen.add(rel);
    for (const specifier of staticImportSpecifiers(fs.readFileSync(abs, 'utf8'))) {
      const target = resolveEngineSpecifier(rel, specifier);
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

// 引擎实现面（相对路径，已排序）：入口（顶层 `.mjs`，除两个套件入口）∪ 从入口静态可达的模块
// ∪ `lib/` 下**非套件自持**的模块。第三项是刻意的保守面：掉进 `lib/` 却还没被入口 import 的文件
// （第二份实现最省事的藏身处、或迁移途中尚未接线的模块）同样必须可见——否则「放一处第二份实现」
// 会静默无感。套件自持面由**模块图**排除（只被套件入口可达者），不是文件名清单。
export function engineScriptFiles(scriptsDir = SCRIPTS_DIR) {
  const topLevel = fs.readdirSync(scriptsDir).filter((name) => name.endsWith('.mjs'));
  const entries = topLevel.filter((name) => !SUITE_ENTRY_FILES.has(name)).sort();
  const face = engineReachableFrom(entries, scriptsDir);
  const suiteRoots = topLevel.filter((name) => SUITE_ENTRY_FILES.has(name));
  const suiteOwned = engineReachableFrom(suiteRoots, scriptsDir);
  for (const rel of libModules(scriptsDir)) {
    if (!suiteOwned.has(rel)) face.add(rel);
  }
  return [...face].sort();
}

// 递归列举目录下的 `.mjs`（相对路径，posix 分隔）：`scriptTreeFiles` 与 `libModules` 的唯一 walker。
function walkModules(dir, prefix) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...walkModules(path.join(dir, entry.name), prefix + entry.name + '/'));
    else if (entry.name.endsWith('.mjs')) out.push(prefix + entry.name);
  }
  return out;
}

// `lib/` 下的全部模块（相对路径）：只在引擎面派生中用（面自身不写成文件名清单）。
function libModules(scriptsDir) {
  const libDir = path.join(scriptsDir, 'lib');
  if (!fs.existsSync(libDir)) return [];
  return walkModules(libDir, '').map((rel) => 'lib/' + rel);
}

// 技能树内**全部**脚本文件（入口 + `lib/**` + `scenarios/**` + `items/**`，递归派生）：分发面
// 文本纪律（注释层零代号 / 计数派生）的受检面——与引擎实现面不同，它**包含**套件自持模块与数据
// 目录（它们的注释同样随技能包分发）。
export function scriptTreeFiles(scriptsDir = SCRIPTS_DIR) {
  return walkModules(scriptsDir, '').sort();
}

// 引擎面的**真实形态 shadow 树**（递归受检面探针用）：把引擎面（入口 + `lib/**`）整棵复制到
// `<shadowRoot>`，调用方再往里放「第二份实现」——结构锚若不递归就看不到 `lib/` 内的新增。
// 三处探针（277 定义面 / 291 惯用法 / 298 裸拼接）共用本夹具：真实形态的构造只写一遍。
// 返回 shadow 脚本目录路径。
export function copyEngineTree(shadowRoot, scriptsDir = SCRIPTS_DIR) {
  const scripts = path.join(shadowRoot, 'scripts');
  fs.mkdirSync(path.join(scripts, 'lib'), { recursive: true });
  for (const rel of fs.readdirSync(scriptsDir)) {
    if (rel.endsWith('.mjs')) fs.copyFileSync(path.join(scriptsDir, rel), path.join(scripts, rel));
  }
  for (const rel of engineScriptFiles(scriptsDir)) {
    if (!rel.includes('/')) continue;
    const target = path.join(scripts, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(scriptsDir, rel), target);
  }
  return scripts;
}

// 引擎面模块文本：相对路径 → 文本（面内读取的单一入口）。
export function engineScriptTexts(scriptsDir = SCRIPTS_DIR) {
  const out = new Map();
  for (const rel of engineScriptFiles(scriptsDir)) {
    out.set(rel, fs.readFileSync(path.join(scriptsDir, rel), 'utf8'));
  }
  return out;
}

// 代码层文本（注释行剥离）：结构锚判「代码里有没有某形态」——注释里提到标识符是说明，不是实现
// （与检查工具的注释层口径同源：行首 `//` / `*` / `/*` 才算注释行）。
export function engineCodeText(text) {
  return String(text).split(/\r?\n/).filter((line) => !isScriptCommentLine(line)).join('\n');
}

// 消费面（入口 ∪ `lib/**`）：面内**引用**某符号的模块——由真实引用派生，不写文件名清单，
// 故模块搬迁 / 再切分不会让判据静默失焦，新增消费方自动进入对账。
export function engineConsumersOf(name, scriptsDir = SCRIPTS_DIR) {
  const pattern = new RegExp('\\b' + name + '\\b');
  return engineScriptFiles(scriptsDir).filter((rel) =>
    pattern.test(engineCodeText(fs.readFileSync(path.join(scriptsDir, rel), 'utf8'))));
}

// 从具名 import 列表里摘掉一个名字（反向构造用；名前 / 名后 / 唯一项三种位置都覆盖）：
// 摘掉后消费方仍引用该符号 ⇒ 「未从单源取用」必报。位置感知是必须的——只处理「名字后带逗号」
// 的写法在名字位于列表末位时会静默不改，探针遂退化为恒绿（无判别力）。
export function dropNamedImport(text, name) {
  return String(text)
    .replace(new RegExp('(import\\s*\\{[^}]*?)\\b' + name + '\\b\\s*,\\s*'), '$1')
    .replace(new RegExp('(import\\s*\\{[^}]*?)\\s*,\\s*\\b' + name + '\\b'), '$1');
}

// 定义形态（函数声明 / 常量赋值）的单一表达式：定义面计数与「单源静态锁」共用——两处各写一份
// 会在口径演进时分叉。
export function engineDefinitionPattern(name, flags = '') {
  return new RegExp('(?:export\\s+)?(?:async\\s+)?function\\s+' + name + '\\b'
    + '|(?:export\\s+)?const\\s+' + name + '\\s*=', flags);
}

// 定义处计数（结构锚的单源半边）：某名字在引擎面内的定义次数（函数声明 / 常量赋值）。
// scriptsDir 是可测性接缝：使「同名第二份定义 → 检出 2 处」能在合成目录上被场景驱动（场景 277 的
// 反向构造），否则该判据只能靠人工实验证明判别力。
export function engineDefinitionHits(name, scriptsDir = SCRIPTS_DIR) {
  const pattern = engineDefinitionPattern(name, 'g');
  const hits = [];
  for (const rel of engineScriptFiles(scriptsDir)) {
    const count = (fs.readFileSync(path.join(scriptsDir, rel), 'utf8').match(pattern) ?? []).length;
    if (count > 0) hits.push({ file: rel, count });
  }
  return hits;
}

// **反查定义模块**（判据形态：落点由导出符号派生，不写文件名常量）：定义处恰好一处时返回
// { file, text }；零处或非唯一（第二份实现）时返回 null——调用方据此显式报「前提失效」，
// 不静默取第一个。
export function engineDefinitionModule(name, scriptsDir = SCRIPTS_DIR) {
  const hits = engineDefinitionHits(name, scriptsDir);
  if (hits.length !== 1 || hits[0].count !== 1) return null;
  return { file: hits[0].file, text: fs.readFileSync(path.join(scriptsDir, hits[0].file), 'utf8') };
}

// 模块是否**再导出**某符号（`export { … }` / `export { … } from '…'`）：re-export 枢纽
// （route-node.mjs 一类）是合法取用面，消费方从枢纽或从定义模块取用都算单一来源。
export function reExportsSymbol(text, symbol) {
  for (const match of String(text).matchAll(/export\s*\{([^}]*)\}/g)) {
    const names = match[1].split(',').map((piece) => piece.trim().split(/\s+as\s+/).pop());
    if (names.includes(symbol)) return true;
  }
  return false;
}

// 消费方是否**从单源取用**某符号（取用面的**唯一**实现）：三种合法形态——① 具名 `import` 的
// 说明符解析后落在单源模块；② 落在再导出该符号的面内模块（re-export 枢纽合法）；③
// `export { … } from '<单源>'`（转出枢纽自己不消费符号，也是单源通道而非第二份实现）。
// 说明符由消费方位置推导，不写死 `'./x.mjs'`（模块位于 `lib/` 时是 `'../x.mjs'`），模块再搬家
// 不必改锚。`texts` 给定时用它解析枢纽（纯函数形态，合成输入可驱动）；否则读 `scriptsDir` 磁盘。
export function engineImportsSymbolFrom({ text, consumerRel, symbol, sourceRel, scriptsDir = SCRIPTS_DIR, texts = null }) {
  const targetText = (target) => {
    if (texts !== null) return texts.get(target) ?? null;
    const abs = path.join(scriptsDir, target);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  };
  const reachesSource = (specifier) => {
    const target = resolveEngineSpecifier(consumerRel, specifier);
    if (target === null) return false;
    if (target === sourceRel) return true;
    const hub = targetText(target);
    return hub !== null && reExportsSymbol(hub, symbol);
  };
  const names = (list) => list.split(',').flatMap((piece) => piece.trim().split(/\s+as\s+/)).map((piece) => piece.trim());
  for (const match of String(text).matchAll(/(?:import|export)\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (names(match[1]).includes(symbol) && reachesSource(match[2])) return true;
  }
  return false;
}

// 注释行判定：与检查工具的注释层口径一致（行首 // / /* / * 才算注释行，行尾注释不在此列）。
export function isScriptCommentLine(line) {
  return /^\s*(\/\/|\*|\/\*)/.test(line);
}

// 具名函数体文本：先配平参数表圆括号（解构入参内含 `new Map()` 一类调用），再配平函数体花括号。
// 目标函数体内不含字符串花括号，故不做字面量扫描。找不到定义返回 null——调用方据此显式报告
// "结构锚前提失效"，不静默按通过处理。
export function functionBodyText(text, name) {
  const start = text.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = text.indexOf('(', start);
  if (i < 0) return null;
  let parens = 0;
  for (; i < text.length; i += 1) {
    if (text[i] === '(') parens += 1;
    else if (text[i] === ')') {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  i = text.indexOf('{', i);
  if (i < 0) return null;
  let depth = 0;
  for (; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// 修复族 id 前缀边界的权威表达式文本（单一来源：判据与夹具锚共用同一份字面量）。
export const FIX_PREFIX_LITERAL_TEXT = '/^[TP]-FIX-/i';

// 修复族边界"出现处"扫描（纯读取，单一实现）：引擎脚本里的五类出现面——
//   前缀正则字面量 / 含 FIX 词干的其它正则字面量 / 修复族 id 字符串字面量 / 段内成员判定 /
//   边界常量的按文件使用次数。注释行不参与（与检查工具的注释层口径一致）：注释里提到标识符
//   是说明，不是第二份实现。判定与扫描分离（本函数只收集事实，下函数只下结论）。
export function fixFamilyBoundarySites(scriptsDir = SCRIPTS_DIR) {
  const sites = {
    prefixLiterals: [],
    otherFixRegexes: [],
    idLiterals: [],
    sectionMemberships: [],
    prefixUsesByFile: new Map(),
  };
  for (const file of engineScriptFiles(scriptsDir)) {
    const text = fs.readFileSync(path.join(scriptsDir, file), 'utf8');
    const lines = text.split(/\r?\n/);
    let prefixUses = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (isScriptCommentLine(line)) continue;
      let at = line.indexOf(FIX_PREFIX_LITERAL_TEXT);
      while (at >= 0) {
        sites.prefixLiterals.push(file + ':' + (i + 1));
        at = line.indexOf(FIX_PREFIX_LITERAL_TEXT, at + 1);
      }
      // 含 FIX 词干的其它正则字面量（单行内闭合、\ 转义感知）：第二份前缀表达式在此现形
      for (const m of line.matchAll(/\/(?:\\.|[^/\\\n])*FIX(?:\\.|[^/\\\n])*\/[a-z]*/g)) {
        if (m[0] !== FIX_PREFIX_LITERAL_TEXT) sites.otherFixRegexes.push(file + ':' + (i + 1) + ' ' + m[0]);
      }
      for (const token of ['T-FIX', 'P-FIX']) {
        if (line.includes(token)) sites.idLiterals.push(file + ':' + (i + 1) + ' ' + token);
      }
      if (line.includes('sectionBlocks.has(')) sites.sectionMemberships.push(file + ':' + (i + 1));
      prefixUses += line.split('FIX_TASK_ID_PREFIX').length - 1;
    }
    if (prefixUses > 0) sites.prefixUsesByFile.set(file, prefixUses);
  }
  return sites;
}

// 修复族边界判据的**落点反查**：边界常量的定义模块由导出符号派生（不写文件名）。定义面零处或
// 非唯一（第二份实现）时返回 { problems }——调用方原样上报，不静默取第一个。
function fixFamilyBoundaryIndex(scriptsDir) {
  const definition = engineDefinitionModule('FIX_TASK_ID_PREFIX', scriptsDir);
  if (definition === null) {
    return {
      problems: ['修复族 id 边界常量 FIX_TASK_ID_PREFIX 的定义面不唯一（全引擎应恰一处）: '
        + JSON.stringify(engineDefinitionHits('FIX_TASK_ID_PREFIX', scriptsDir))],
    };
  }
  return { identifierModule: definition.file, text: definition.text };
}

// 修复族约定「只表达一次」判定（AC-15 判别力锚）：返回问题描述数组（空数组 = 唯一表达）。
// 判别力设计——旧锚按**标识符名**统计（哪个文件里出现该常量名），对"同一约定被表达两次"
// 零判别力：第二份等价前缀表达式（交替式写法）不含该常量名 → 旧锚必放过（虚假单一来源信心）。
// 本判据按**表达式形态**计数（扫描见 fixFamilyBoundarySites），四条一起构成"约定被表达两次即红"：
//   ① id 前缀边界：唯一前缀正则字面量只允许出现一次，且必须落在**该常量的定义模块**内（落点由
//      导出符号反查——模块搬家不必改锚，"唯一实现位于哪个文件名"不再在锚里存第二份事实）；
//   ② 第二份表达式：引擎代码行不得出现其它含 FIX 词干的正则字面量，也不得出现修复族 id 的
//      字符串字面量（`.startsWith(...)` 一类内联前缀判定形态）；
//   ③ 段内边界：段内成员判定（`sectionBlocks.has(`）只允许出现一次——「位于修复段内」这条
//      边界只在唯一分类器里表达；
//   ④ 谓词共用：修复族标记与并行文件依赖第三族的参与者排除必须各自调用唯一分类器，且不得
//      自持边界常量 / 段切片（任一消费方自建第二份边界即红）。
// 判据自身的判别力由场景内的反向夹具锚（同源 → 无问题；逐条注入 → 逐条专项报告）常驻保证。
export function fixFamilyBoundaryProblems(scriptsDir = SCRIPTS_DIR) {
  const problems = [];
  const sites = fixFamilyBoundarySites(scriptsDir);
  const index = fixFamilyBoundaryIndex(scriptsDir);
  if (index.problems !== undefined) return index.problems;
  if (sites.prefixLiterals.length !== 1 || !sites.prefixLiterals[0].startsWith(index.identifierModule + ':')) {
    problems.push('修复族 id 前缀边界必须只表达一次且落在其定义模块（' + index.identifierModule + '），实际出现处: '
      + JSON.stringify(sites.prefixLiterals));
  }
  if (sites.otherFixRegexes.length !== 0) {
    problems.push('引擎内出现第二份修复族 id 前缀表达式（同一约定被表达两次）: '
      + sites.otherFixRegexes.join('; '));
  }
  if (sites.idLiterals.length !== 0) {
    problems.push('引擎代码行出现修复族 id 字面量（内联前缀判定形态，应经唯一分类器）: '
      + sites.idLiterals.join('; '));
  }
  if (sites.sectionMemberships.length !== 1) {
    problems.push('「位于修复段内」边界（段内成员判定）必须只表达一次，实际出现处: '
      + JSON.stringify(sites.sectionMemberships));
  }
  // 边界常量的使用面：定义 1 处 + 唯一分类器内 1 次 test = 2（其他消费方一律经分类器）
  const prefixUseTotal = [...sites.prefixUsesByFile.values()].reduce((a, b) => a + b, 0);
  if (prefixUseTotal !== 2 || sites.prefixUsesByFile.size !== 1
    || !sites.prefixUsesByFile.has(index.identifierModule)) {
    problems.push('修复族 id 边界常量的使用面必须恰为「定义 + 唯一分类器内一次判定」，实际: '
      + JSON.stringify([...sites.prefixUsesByFile.entries()]));
  }
  for (const fnName of ['fixTaskMarker', 'collectCrossTaskConflicts']) {
    const body = functionBodyText(index.text, fnName);
    if (body === null) {
      problems.push('结构锚前提失效：' + index.identifierModule + ' 未找到 ' + fnName + ' 的定义');
      continue;
    }
    if (!/fixTaskClassifier\s*\(/.test(body)) {
      problems.push(fnName + ' 必须经唯一分类器判定修复族（不得自持第二份边界）');
    }
    if (/FIX_TASK_ID_PREFIX|fixSectionBody/.test(body)) {
      problems.push(fnName + ' 自持修复族边界常量 / 段切片（应只调用唯一分类器）');
    }
  }
  return problems;
}

// ---------- 侧命令锚点材料（evolve / health / context-scan + 到期提示 + ui-design 强制等级） ----------
// 三条侧命令与 ui-design 门是横向机制：判据一律走**真实 CLI**（spawn）或**模块导出**（动态导入
// 同一实现），套件内不复制第二份判据。零写入判据用**树指纹**（相对路径清单 + 文件 sha256）表达——
// 「跑完没变」与「跑前跑后一致」是同一判据的两种说法，此处只实现一次。

export const timeUtilsModule = await import(pathToFileURL(path.join(SCRIPTS_DIR, 'time-utils.mjs')).href);
export const contextInitModule = await import(pathToFileURL(path.join(SCRIPTS_DIR, 'context-init.mjs')).href);
export const stateSchemaModule = await import(pathToFileURL(path.join(SCRIPTS_DIR, 'state-schema.mjs')).href);

export const SIDE_EVOLVE = path.join(SCRIPTS_DIR, 'evolve.mjs');
export const SIDE_HEALTH = path.join(SCRIPTS_DIR, 'health.mjs');
export const SIDE_CONTEXT_SCAN = path.join(SCRIPTS_DIR, 'context-scan.mjs');
export const SKILL_PROTOCOL_FILE = path.join(SCRIPTS_DIR, '..', 'reference', 'workflow-protocol.json');

export function requireModuleExport(moduleObject, name, where) {
  const value = moduleObject[name];
  if (value === undefined) {
    throw new Error(where + ' 缺导出 ' + name + '（套件锚点前提失效：单一实现被改名 / 移除）');
  }
  return value;
}

// 侧命令真实调用（cwd = 项目根；--root 由调用方显式传入——侧命令不进 8 节点流程）。
// FLOW_COMET_PROTOCOL 注入场景内协议副本，与 runGuard / runStateWithProtocol 同一表达：协议路径的
// 唯一权威是 state-schema 的选择器（state.protocolPath > 环境变量 > 内置默认），侧命令的子进程
// （workflow-state 通道）因此要看到与门禁同一份协议来源——平台侧注入环境变量正是真实项目形态。
// 需要构造「无环境变量」的场景用 `{ FLOW_COMET_PROTOCOL: '' }` 覆盖（空串按未设置处理）。
export function runSideScript(script, args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: {
      ...process.env,
      FLOW_COMET_PROTOCOL: path.join(root, 'reference', 'workflow-protocol.json'),
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: 120000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 树指纹：目录（含空目录）与文件内容的 sha256，按相对路径排序
export function treeFingerprint(root) {
  const rows = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) { rows.push(rel + '/'); walk(full); continue; }
      rows.push(rel + ' ' + createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  };
  walk(root);
  return rows.join('\n');
}

export function fingerprintChanges(before, after) {
  const beforeRows = before === '' ? [] : before.split('\n');
  const afterRows = after === '' ? [] : after.split('\n');
  const beforeSet = new Set(beforeRows);
  const afterSet = new Set(afterRows);
  return [
    ...beforeRows.filter((row) => !afterSet.has(row)).map((row) => '消失: ' + row),
    ...afterRows.filter((row) => !beforeSet.has(row)).map((row) => '新增: ' + row),
  ];
}

// 时间单源**消费面**判据（场景 277 使用；纯函数 + 合成输入可驱动）：每个符号必须同时满足
// 「具名 import 自单源模块」与「真实调用」才算真实消费。旧判据只看 `name + '('` 的子串——
// 消费脚本里内联一份同名实现即可满足（判据被本地影子实现骗过），故必须查 import 来源；
// 说明符由消费方位置推导（`lib/` 内是 `'../time-utils.mjs'`），不写死单层形态。
export function timeSingleSourceConsumerProblems(text, symbols, file = '', sourceRel = 'time-utils.mjs', scriptsDir = SCRIPTS_DIR) {
  const problems = [];
  const prefix = file === '' ? '' : file + ' ';
  for (const symbol of symbols) {
    if (!engineImportsSymbolFrom({ text, consumerRel: file, symbol, sourceRel, scriptsDir })) {
      problems.push(prefix + '未从 ' + sourceRel + ' 取用 ' + symbol
        + '（单源纪律：不得在消费脚本内联同名第二份实现）');
    }
    if (!text.includes(symbol + '(')) {
      problems.push(prefix + '未真实消费 ' + symbol + '（单一权威应被调用）');
    }
  }
  return problems;
}

// 两层加载模型的**入口层**判据（场景 167 使用；纯函数 + 合成输入可驱动）：入口册与入口展开册
// 各须含入口层锚点句（「Skill 工具加载该节点的 Implementation 技能」）与「前置门」表述，且不得含
// Implementation/Required 混淆句式与无限定自动补表述。返回问题描述数组。
