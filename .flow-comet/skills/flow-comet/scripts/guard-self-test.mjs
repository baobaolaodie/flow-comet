#!/usr/bin/env node
// flow-comet 引擎自测套件（L1 回归基线的载体）
//
// 本文件 = runner + 底部自检（收口判据）。场景数据在 scenarios/{a..n}.mjs（按机制面分组），
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
  createdDirs,
  makeTmp,
  sleepSync,
} from './lib/test-fixtures.mjs';
import {
  scenarioProtocolPath,
} from './lib/test-assertions.mjs';
import {
  publicFaceSelfCheck,
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
import { ENTRIES as SCENARIOS_N } from './scenarios/n.mjs';

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
  ...SCENARIOS_N,
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

// 文档一致性自检（场景数纪律 + 公开产物零代号纪律工具化）：形态分派（权威源检出 / 包形态 / 安装
// 副本）与四条判据（计数一致性 / 维护文档机检 / 公开产物零代号 / 词表镜像）的唯一实现在
// lib/text-anchor-checks.mjs 的 publicFaceSelfCheck——本处只负责调用与打印。该判定接受任意根，
// 故它另有常驻场景锚（公开面形态分派探针），不必等到在包形态里整跑一次才知道分派对不对。
const selfCheck = await publicFaceSelfCheck();
if (selfCheck.skip !== null) {
  // 该形态不含这一面：仍然显式可见——SKIP = 未校验，不是通过。
  console.log(selfCheck.skip.notice);
} else {
  for (const notice of selfCheck.notices) console.log(notice);
  for (const problem of selfCheck.problems) {
    failures.push(problem);
    console.error('FAIL: ' + problem.name + '\n' + problem.error);
  }
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
