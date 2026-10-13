#!/usr/bin/env node
// flow-comet 引擎自测套件（L1 回归基线的载体）
//
// 本文件 = runner + 底部自检（收口判据）。场景数据在 scenarios/{a..m}.mjs（按机制面分组），
// 夹具 / 断言 / 文本锚判据在 lib/ 下，与 system-test 共享的工具与计数派生各有单一来源模块。
//
// 每个场景 = 独立临时目录（fs.mkdtemp）+ 伪造 .flow-comet/flow-comet-state.json（currentNode +
// evidence + executionMode:'subagent'，满足前置校验）+ .specs/<change>/ 工件 → spawnSync 跑引擎
// 脚本（FLOW_COMET_RUN_ROOT=<临时目录>）→ 断言退出码与输出关键词；跑完清理临时目录。
//
// 运行: node scripts/guard-self-test.mjs
// 全过 → exit 0，输出 `ALL <n> SCENARIOS PASSED`（n = SCENARIOS.length）；失败 → exit 1，逐条
// 列出场景名、实际输出与 exit code。仅用 node 内置模块，不依赖 flow-kit 模板目录存在。

import fs from 'fs';
import path from 'path';
import {
  cleanupTmpDir,
} from './lib/test-helpers.mjs';
import {
  BUILTIN_PROTOCOL_SOURCE,
  REPO_ROOT,
  createdDirs,
  isAuthoritativeSourceRepo,
  makeTmp,
  sleepSync,
} from './lib/test-fixtures.mjs';
import {
  scenarioProtocolPath,
} from './lib/test-assertions.mjs';
import {
  PUBLIC_CODE_RE,
  SCENARIO_COUNT_FILES,
  SCENARIO_COUNT_FILES_MAINTAINER,
  SYSTEM_TEST_COUNT_FILES,
  SYSTEM_TEST_COUNT_FILES_MAINTAINER,
  countSyncProblems,
  internalDocsProblems,
  maintainerFacePresent,
  maintainerFaceSkips,
  vocabularyMirrorProblems,
} from './lib/text-anchor-checks.mjs';

import { ENTRIES as SCENARIOS_A } from './scenarios/a.mjs';
import { ENTRIES as SCENARIOS_B } from './scenarios/b.mjs';
import { ENTRIES as SCENARIOS_C } from './scenarios/c.mjs';
import { ENTRIES as SCENARIOS_D } from './scenarios/d.mjs';
import { ENTRIES as SCENARIOS_E } from './scenarios/e.mjs';
import { ENTRIES as SCENARIOS_F } from './scenarios/f.mjs';
import { ENTRIES as SCENARIOS_G } from './scenarios/g.mjs';
import { ENTRIES as SCENARIOS_H } from './scenarios/h.mjs';
import { ENTRIES as SCENARIOS_I } from './scenarios/i.mjs';
import { ENTRIES as SCENARIOS_J } from './scenarios/j.mjs';
import { ENTRIES as SCENARIOS_K } from './scenarios/k.mjs';
import { ENTRIES as SCENARIOS_L } from './scenarios/l.mjs';
import { ENTRIES as SCENARIOS_M } from './scenarios/m.mjs';

let passed = 0;
const failures = [];

const SCENARIOS = [
  ...SCENARIOS_A,
  ...SCENARIOS_B,
  ...SCENARIOS_C,
  ...SCENARIOS_D,
  ...SCENARIOS_E,
  ...SCENARIOS_F,
  ...SCENARIOS_G,
  ...SCENARIOS_H,
  ...SCENARIOS_I,
  ...SCENARIOS_J,
  ...SCENARIOS_K,
  ...SCENARIOS_L,
  ...SCENARIOS_M,
];

// ---------- 运行 ----------

for (const sc of SCENARIOS) {
  const dir = makeTmp();
  try {
    // T06: 协议路径适配——真实项目协议位于 <项目根>/reference/workflow-protocol.json（runRoot 内）。
    // T03 起 workflow-guard 用 readProtocolFile（protected-path：协议路径必须在 runRoot 内），
    // 场景 runRoot=tmpdir、内置协议默认路径在 packageRoot（tmpdir 外）→ 复制到 <dir>/reference/ 内，
    // 由 runGuard 的 FLOW_COMET_PROTOCOL env 指向场景内副本。场景内 writeFile('reference/...') 或
    // --protocol CLI 覆盖保持后写优先语义（CLI --protocol 优先级高于 env）。
    const builtinCopy = scenarioProtocolPath(dir);
    fs.mkdirSync(path.dirname(builtinCopy), { recursive: true });
    fs.copyFileSync(BUILTIN_PROTOCOL_SOURCE, builtinCopy);
    await sc.run(dir);
    passed += 1;
    console.log('PASS: ' + sc.name);
  } catch (e) {
    failures.push({ name: sc.name, error: e.message });
    console.error('FAIL: ' + sc.name + '\n' + e.message);
  } finally {
    // 清理失败不抛（见 cleanupTmpDir 注释）：残留由末尾判据报告，避免整轮崩
    cleanupTmpDir(dir);
  }
}

console.log('RESULT: ' + passed + '/' + SCENARIOS.length + ' scenarios passed');

// 文档一致性自检（场景数纪律 + 公开产物零代号纪律工具化）：
// ① 场景数：受检清单文档须与 SCENARIOS.length 一致（全变体检查），且清单条目必须真实存在
//    （AC-14：缺失显式报告，不静默跳过）；
// ② 公开产物零代号：公开文档不得含过程代号（场景编号/修复编号/批次/缺陷编号/问题级/验证代号/验证轮次/未公开概念——历史 CHANGELOG 回归实证）。
// 仅权威源检出执行；安装副本（目标项目）无 flow-comet 文档面，跳过。
if (isAuthoritativeSourceRepo()) {
  // ①a 受检面可见化（F2 防漂移）：实际受检文件数由模块级常量**推导**、不硬编码——分发组 =
  // SCENARIO_COUNT_FILES ∪ SYSTEM_TEST_COUNT_FILES（后者为前者子集），维护者组 =
  // SCENARIO_COUNT_FILES_MAINTAINER ∪ SYSTEM_TEST_COUNT_FILES_MAINTAINER（后者为前者子集）；
  // 维护者面缺席（CI 全新检出 / worktree）时按组跳过语义只计分发面。本行是对外可复核的
  // 「覆盖面事实」——清单增删/口径漂移在此直接可见，不再依赖人工核对注释（F2 根因）。
  const distFaceCount = new Set([...SCENARIO_COUNT_FILES, ...SYSTEM_TEST_COUNT_FILES]).size;
  const maintainerFaceCount = maintainerFacePresent()
    ? new Set([...SCENARIO_COUNT_FILES_MAINTAINER, ...SYSTEM_TEST_COUNT_FILES_MAINTAINER]).size
    : 0;
  console.log('受检面: ' + (distFaceCount + maintainerFaceCount) + ' 文件（分发 ' + distFaceCount
    + ' + 维护者 ' + maintainerFaceCount + '）');
  // ① 计数一致性受检清单（分发组恒检 + 维护者组整组在场时检；判据与场景 105 共用同一实现）
  // SCENARIO_COUNT_FILES(_MAINTAINER) / SYSTEM_TEST_COUNT_FILES(_MAINTAINER) 为模块级常量
  // （见文件头定义）——场景数与系统测试集项数两套计数合并检查
  for (const problem of await countSyncProblems()) {
    failures.push({ name: '计数一致性', error: problem });
    console.error('FAIL: 计数一致性\n' + problem);
  }

  // ①b 维护文档机检（docs/internal 死引用 + ROADMAP 最低结构；整组缺席即跳过）
  for (const problem of internalDocsProblems()) {
    failures.push({ name: '维护文档机检', error: problem });
    console.error('FAIL: 维护文档机检\n' + problem);
  }

  // ①c 维护者面缺席可见化：结构性缺席（worktree / CI 全新检出）不判失败（退出码不变、不误红），
  // 但必须可见——逐面输出 SKIP 行（面名 + 原因 + 本检出未执行什么校验 + 回维护者主树重跑的指引）。
  for (const skip of maintainerFaceSkips()) {
    console.log('SKIP: ' + skip.face + ' — ' + skip.reason
      + '；本次检出未执行该面校验，请在维护者主树重跑本套件（主树 L1），勿把跳过当成已校验。');
  }

  // ② 公开文档零代号（公开产物纪律——变更日志历史编号回归的教训）
  const PUBLIC_DOCS = [
    'README.md', 'README-zh.md', 'CONTRIBUTING.md', 'CONTRIBUTING-zh.md',
    'SECURITY.md', 'SECURITY-zh.md', 'CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT-zh.md',
    'CHANGELOG.md', 'CHANGELOG-zh.md',
    'docs/INSTALLATION.md', 'docs/INSTALLATION-zh.md', 'docs/MECHANISM.md', 'docs/MECHANISM-zh.md',
    'docs/USAGE.md', 'docs/USAGE-zh.md',
    'docs/TROUBLESHOOTING.md', 'docs/TROUBLESHOOTING-zh.md', 'docs/VERSIONS.md', 'docs/VERSIONS-zh.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/1-bug_report.yml', '.github/ISSUE_TEMPLATE/2-feature_request.yml',
    '.github/ISSUE_TEMPLATE/3-question.md', '.github/ISSUE_TEMPLATE/4-task.md',
  ];
  // 词表判据 = 模块级 PUBLIC_CODE_RE（与 .githooks/internal-codes.mjs 的 BANNED 同判据，
  // 见其定义处的同步约定；维护文档机检场景族另有该判据的判别力/边界锚）。
  for (const rel of PUBLIC_DOCS) {
    let text;
    try {
      text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    } catch (e) {
      // ENOENT 同样显式报告：本清单全部为随仓库分发的文件，任何权威源检出都应存在——
      // 静默跳过会让"永不生效的条目"藏身（同类 AC-14 缺陷）。
      failures.push({ name: '公开产物零代号(' + rel + ')', error: '文件缺失: ' + e.message });
      console.error('FAIL: 公开产物零代号(' + rel + ')\n文件缺失: ' + e.message);
      continue;
    }
    const m = text.match(PUBLIC_CODE_RE);
    if (m) {
      failures.push({ name: '公开产物零代号(' + rel + ')', error: rel + ' 含过程代号: "' + m[0] + '"' });
      console.error('FAIL: 公开产物零代号(' + rel + ')\n' + rel + ' 含过程代号: "' + m[0] + '"');
    }
  }

  // ③ 词表镜像漂移：主仓私有的词表单一来源与套件内的同义镜像必须**逐字符
  // 等价**——两侧此前只有注释互指"同步"、零一致性判据：主仓增补模式时分发侧扫描静默落后
  // （新词可在公开面长期存活而套件全绿），反向则分发面误红。判据只读文件、不改任何判定语义。
  for (const problem of vocabularyMirrorProblems()) {
    failures.push({ name: '词表镜像漂移', error: problem });
    console.error('FAIL: 词表镜像漂移\n' + problem);
  }
} else {
  // 安装副本形态：.githooks 是主仓私有面（随 clone 不分发）→ 该判据**不适用**。结构性缺席
  // 不判失败（退出码不变、不误红），但必须显式可见——未验证 ≠ 通过，不得静默跳过。
  console.log('SKIP/NOT-APPLICABLE: 词表镜像漂移判据（.githooks 为主仓私有面）'
    + '；本次检出无该私有面，未执行「词表单一来源 ↔ 套件同义镜像」的逐字符等价性比对'
    + '——请在主仓私有面在场处重跑本套件（主树 L1），勿把不适用当成已校验。');
}

// 清理验证：自测套件自身创建的临时目录不留残留
// 先做一次延迟重试：跨场景仍被占用的句柄（子进程退出、扫描器）可能晚于最后一个场景的清理才释放。
// 只等**一次**（不是每个残留目录各等一次），再逐个重试；随后由下方单一判定点统一报告。
const remainingDirs = createdDirs.filter((d) => fs.existsSync(d));
if (remainingDirs.length > 0) {
  sleepSync(300);
  for (const d of remainingDirs) cleanupTmpDir(d);
}
const residue = createdDirs.filter((d) => fs.existsSync(d));
if (residue.length > 0) {
  failures.push({ name: '临时目录清理', error: '残留目录: ' + residue.join(', ') });
  console.error('FAIL: 临时目录清理\n残留目录: ' + residue.join(', '));
}

if (failures.length > 0) {
  console.error('FAILED SCENARIOS: ' + failures.length);
  for (const f of failures) {
    console.error('- ' + f.name + '\n' + f.error);
  }
  process.exit(1);
}

console.log('ALL ' + SCENARIOS.length + ' SCENARIOS PASSED');
