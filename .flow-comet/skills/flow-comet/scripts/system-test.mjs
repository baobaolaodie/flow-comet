#!/usr/bin/env node
// system-test.mjs — flow-comet 系统测试集（真实命令序列覆盖 A~M 十三类机制面）
//
// 定位：guard-self-test 是引擎脚本的场景级回归（夹具构造为主；场景数以该套件运行输出的
// ALL <n> SCENARIOS PASSED 为准）；本套件是**系统级**测试——每个测试项走真实命令序列
// （init → record → guard exit → handoff → hook …），覆盖 flow-comet 全部机制面：
//   A 状态机与路由 · B 声明机制 · C 委托链路 · D hook 写白名单 · E 自定义协议 ·
//   F 自动初始化 · G 分支模式 · H verify 与归档 · I 异常路径 · J 文档一致性 ·
//   K 安装器与平台 · L 执行遗漏防护 · M 侧命令与 ui-design 门。
//   条目与夹具按组落在 items/a..m.mjs（本文件只做运行与收口）。
//
// 载体：每项 = 独立临时目录（内置协议副本预置到 <tmp>/reference/——受保护路径要求协议文件位于
// runRoot 内）+ spawnSync 真实命令序列 + 断言退出码与输出关键词；测试项跑完清理临时目录。
//
// 输出纪律：逐项 PASS/FAIL + 汇总（SYSTEM TEST: N/M passed）；全过 exit 0，有 FAIL exit 1。
// 结果标记：分发面项（distributionSurface）必须回传机器可读标记，运行器按结构化环境判据断言——
// 权威源侧 `distribution:executed@source` / 安装副本侧 `distribution:not-applicable@copy`；
// 缺标记（静默跳过）或与环境不符（判定写反）都判失败（「未验证 ≠ 通过」）。
// 三态读数：收尾行按**条目**打印 `passed / not-applicable / not-executed` 三态计数——不适用
// （安装副本侧）与未执行（本地工具缺失）不并入「通过」，未执行的项不再无痕计通过。
// 条目内的平台条件子断言由运行器逐条出声（`OUTCOME: <项> · <子断言> → not-applicable@platform`）：
// 它不是条目自身的态（其余断言已真跑），故不进条目级三态分区。
// 测试项命名与输出为公开面——零过程代号（场景编号/修复编号/批次/缺陷编号/未公开概念）。
//
// 运行: node .flow-comet/skills/flow-comet/scripts/system-test.mjs
// 仅 node 内置模块（child_process/fs/os/path）；无网络。

import fs from 'fs';
import { makeTmp } from './lib/test-helpers.mjs';
import { ENTRIES as GROUP_A } from './items/a.mjs';
import { ENTRIES as GROUP_B } from './items/b.mjs';
import { ENTRIES as GROUP_C } from './items/c.mjs';
import { ENTRIES as GROUP_D } from './items/d.mjs';
import { ENTRIES as GROUP_E } from './items/e.mjs';
import { ENTRIES as GROUP_F } from './items/f.mjs';
import { ENTRIES as GROUP_G } from './items/g.mjs';
import { ENTRIES as GROUP_H } from './items/h.mjs';
import { ENTRIES as GROUP_I } from './items/i.mjs';
import { ENTRIES as GROUP_J } from './items/j.mjs';
import { ENTRIES as GROUP_K } from './items/k.mjs';
import { ENTRIES as GROUP_L } from './items/l.mjs';
import { ENTRIES as GROUP_M } from './items/m.mjs';
// 分发面项的结果标记判据 + 子断言登记 + 三态映射（组内判据单源，运行器复用同一实现）
import { assertDistributionOutcome, createOutcomeRecorder, distributionState } from './items/k.mjs';

// 条目顺序 = 组顺序（A → M）：逐项输出顺序是既有读数的一部分
const TEST_ITEMS = [
  ...GROUP_A, ...GROUP_B, ...GROUP_C, ...GROUP_D, ...GROUP_E, ...GROUP_F, ...GROUP_G,
  ...GROUP_H, ...GROUP_I, ...GROUP_J, ...GROUP_K, ...GROUP_L, ...GROUP_M,
];

let passed = 0;
let notApplicable = 0;
let notExecuted = 0;
const failures = [];
const createdDirs = [];

// ---------- 运行 ----------

for (const item of TEST_ITEMS) {
  const dir = makeTmp({ prefix: 'flow-comet-system-test-', protocol: true, register: createdDirs });
  const outcomes = createOutcomeRecorder();
  try {
    const marker = await item.run(dir, outcomes);
    // 条目内平台条件子断言的不适用：逐条出声（条目自身的面已真跑，故不改写条目的态）
    for (const sub of outcomes.drain()) {
      console.log('OUTCOME: ' + item.name + ' · ' + sub.assertion + ' → ' + sub.marker);
    }
    // 分发面项的机器可读结果标记：缺标记（静默跳过）或与环境不符（判定写反）都判该项失败
    if (item.distributionSurface) assertDistributionOutcome(item.name, marker);
    // 三态读数：不适用 / 未执行不计入「通过」（未验证 ≠ 通过）
    const state = item.distributionSurface ? distributionState(marker) : 'passed';
    if (state === null) {
      throw new Error('分发面结果标记没有三态归属（条目级不得回传子断言态）: ' + JSON.stringify(marker));
    }
    if (state === 'passed') passed += 1;
    else if (state === 'not-applicable') notApplicable += 1;
    else notExecuted += 1;
    console.log('PASS: ' + item.name);
  } catch (e) {
    failures.push({ name: item.name, error: e.message });
    console.error('FAIL: ' + item.name + '\n' + e.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 收尾读数两段：`N/M passed` 是套件判词（N = 未失败项数，与既有输出纪律同形），括号内是该判词
// 的三态分解（严格通过 / 不适用 / 未执行，三者相加 = N）——「不适用」「未执行」因此可见，
// 不再无痕计入「通过」。
console.log('SYSTEM TEST: ' + (passed + notApplicable + notExecuted) + '/' + TEST_ITEMS.length + ' passed'
  + ' (passed ' + passed + ' / not-applicable ' + notApplicable + ' / not-executed ' + notExecuted + ')');

// 清理验证：套件自身创建的临时目录不留残留
const residue = createdDirs.filter((d) => fs.existsSync(d));
if (residue.length > 0) {
  failures.push({ name: '临时目录清理', error: '残留目录: ' + residue.join(', ') });
  console.error('FAIL: 临时目录清理\n残留目录: ' + residue.join(', '));
}

if (failures.length > 0) {
  console.error('FAILED ITEMS: ' + failures.length);
  for (const f of failures) {
    console.error('- ' + f.name + '\n' + f.error);
  }
  process.exit(1);
}

console.log('ALL SYSTEM TESTS PASSED');
