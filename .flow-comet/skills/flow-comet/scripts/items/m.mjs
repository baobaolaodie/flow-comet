// items/m.mjs — M 组条目（侧命令与 ui-design 门）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 组内夹具与条目同址；跨组共用夹具从 a.mjs / k.mjs 取（组文件之间单向，无环）。

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { assertEqual, assertExit, assertNotOut, assertOut, assertTrue, baseState, runGuard, runState, writeFile, writeState } from '../lib/test-helpers.mjs';
import { CHANGE_ID, parseStatusOutput, readStateBytes, readStateFile, writeIntakeArtifacts } from './a.mjs';

// 路径推导基准：技能包 scripts/ 目录（与套件入口同基准）
const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 内置协议源文件（技能包 reference/）：绑定声明类用例需要把协议副本落到夹具根外再引用
const BUILTIN_PROTOCOL_SOURCE = path.join(SCRIPTS_DIR, '..', 'reference', 'workflow-protocol.json');

// ---------- 侧命令（evolve / health / context-scan）与 ui-design 门：真实命令链路材料 ----------
// 与 guard-self-test 同构：判据走真实 CLI；零写入判据用树指纹（相对路径清单 + 文件 sha256）。
const SIDE_EVOLVE = path.join(SCRIPTS_DIR, 'evolve.mjs');
const SIDE_HEALTH = path.join(SCRIPTS_DIR, 'health.mjs');
const SIDE_CONTEXT_SCAN = path.join(SCRIPTS_DIR, 'context-scan.mjs');
// 时间形态的单一来源：侧命令产物的日期分量按同一实现推导（测试侧不复制第二份格式化）
const timeUtilsModule = await import(pathToFileURL(path.join(SCRIPTS_DIR, 'time-utils.mjs')).href);
const localDate = (value = new Date()) => timeUtilsModule.formatLocalDate(value);

// 侧命令真实调用：协议环境与 runState / runGuard / runHook 同形（FLOW_COMET_PROTOCOL 指向场景内副本）
// ——协议路径的唯一权威是 state-schema 的选择器（state.protocolPath > 环境变量 > 内置默认），侧命令
// 的 state 通道子进程必须看到与门禁同一份来源。构造「无环境变量」的场景用 `{ FLOW_COMET_PROTOCOL: '' }`。
function runSideScript(script, args, root, envOverrides = {}) {
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

function treeFingerprint(root) {
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

function readText(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}


// 跨过下一个秒边界（`last_intel_scan` 为秒级精度：同一秒内的两次写入取值可能相同，双落点漂移不可判）。
// 轮询到「严格晚于目标秒」才返回——等待上限约 1.05s，比固定 sleep 短且不受调用时刻影响。
function waitForNextSecond() {
  const target = Math.floor(Date.now() / 1000) + 1;
  while (Math.floor(Date.now() / 1000) <= target) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}

// 七段 CONTEXT 骨架（域语言段带模板表格表头；intel-scan 元数据段三字段齐——结构校验的通过形态）。
// 与 guard-self-test.mjs 的同名夹具**同形镜像**（两份载体刻意独立、不互相 import：夹具若从被测模块
// 派生，锚点会退化成同义反复）——改段名 / 字段名时必须两份同改（与词表镜像同纪律）。
// `last_intel_scan` 行取**真实生成件形态**：取值词元 + 行尾说明（`--init-context` 的生成物即此形；
// 写侧 `context-scan` 只替换首个取值词元、说明原样保留）——裸取值词元夹具下「读侧取整行剩余文本」
// 的口径缺陷在本项不可见（见 M7 的单变量对照）。
const INTEL_FIELD_SUFFIX = ' （首次接入生成时留占位；由 `init --init-context` 或 `context-scan` 记录扫描时间）';
function contextFixtureText() {
  return [
    '# 项目上下文', '',
    '## 项目概要', '', '- 夹具概要', '',
    '## 技术栈', '', '- Node.js（ESM）', '',
    '## 域语言', '', '| 术语 | 定义 |', '|---|---|', '| 夹具 | 测试用 |', '',
    '## 已锁决策', '', '- [2026-09-01] 夹具决策 — 来自 @.specs/CONTEXT.md', '',
    '## 默认偏好', '', '- 夹具偏好', '',
    '## 既有抽象索引', '', '- 夹具既有抽象', '',
    '## intel-scan 元数据', '',
    '- **last_intel_scan**: 2026-09-01T10:00:00+08:00' + INTEL_FIELD_SUFFIX,
    '- **scanner**: flow-comet',
    '- **下次重扫建议**: 3 个月后', '',
  ].join('\n');
}

// ---------- 系统测试项（A~M 十三类） ----------

// AC-2：EVOLVE 报告的三个子句（`## 扫描范围` / `已扫 change 清单` / `未应用` 记账 + 未应用项段）
// 判据——纯函数，合成输入可驱动判别力（缺任一子句 → 必报，见 M1 的反向构造）。
function evolveReportClauseProblems(reportText) {
  const problems = [];
  if (!reportText.includes('## 扫描范围')) problems.push('缺「## 扫描范围」段');
  if (!reportText.includes('- 已扫 change 清单：')) problems.push('缺「已扫 change 清单」行');
  if (!/未应用 \d+ 条/.test(reportText)) problems.push('缺「未应用 N 条」记账');
  if (!reportText.includes('## 未应用项')) problems.push('缺「## 未应用项」段');
  return problems;
}

// AC-3：`## evolve 元数据` 三字段端到端判据（段在场 + 三字段齐备 + 取值与 state / 本次执行工具一致）。
function evolveSectionFieldProblems(contextText, ts, scanner) {
  const section = /## evolve 元数据[\s\S]*?(?=\n## |\s*$)/.exec(contextText);
  if (section === null) return ['缺 `## evolve 元数据` 段'];
  const body = section[0];
  const problems = [];
  for (const [key, value] of [['last_evolve_at', ts], ['scanner', scanner]]) {
    const found = new RegExp('- \\*\\*' + key + '\\*\\*: `([^`]*)`').exec(body);
    if (found === null) problems.push('段内缺字段 ' + key);
    else if (found[1] !== value) problems.push('段内 ' + key + ' 取值不符: ' + JSON.stringify(found[1]));
  }
  if (!/- \*\*下次建议\*\*: `[^`]+`/.test(body)) problems.push('段内缺非空的 `下次建议` 字段');
  return problems;
}


export const ENTRIES = [
  // ---------- M. 侧命令（evolve / health / context-scan）与 ui-design 门：真实命令链路 ----------

  {
    name: 'M1 evolve 真实链路：scan 零写入 → apply 落盘·报告·双落点 → 幂等 → 反例零改动',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-09-10-fixture/DESIGN.md',
        '# DESIGN\n\n## 5. 其它段\n\nOTHER-SECTION-MARKER\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 夹具抽象条目（真实链路）\n');
      // 第二个归档 change 提供第二条候选（同段同类）：AC-2 的「只批准一项 → 其余候选零改动 +
      // 报告按「未应用 N 条」记账」需要一条**未被批准**的真实候选，否则该子句恒为 0 条。
      writeFile(dir, '.specs/archive/2026-09-10b-fixture/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 未被批准的夹具条目（其余候选零改动）\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      const before = treeFingerprint(dir);
      const scan = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(scan, 0);
      assertOut(scan, 'EVOLVE: 窗口');
      assertOut(scan, '2026-09-10-fixture#1');
      assertNotOut(scan, 'OTHER-SECTION-MARKER');
      if (treeFingerprint(dir) !== before) throw new Error('scan 必须零写入（树指纹应逐项一致）');

      const apply = runSideScript(SIDE_EVOLVE,
        ['apply', '2026-09-10-fixture#1', '--root', dir, '--scanner', 'flow-comet-evolve'], dir);
      assertExit(apply, 0);
      assertOut(apply, 'EVOLVE-OK');
      assertOut(apply, 'EVOLVE: 双落点一致 state = ');
      const contextText = readText(dir, '.specs/CONTEXT.md');
      if (!contextText.includes('夹具抽象条目（真实链路）')) throw new Error('目标段未出现已批准的条目');
      if (!contextText.includes('来源 @.specs/archive/2026-09-10-fixture/DESIGN.md')) {
        throw new Error('条目缺来源标注');
      }
      if (contextText.includes('未被批准的夹具条目')) {
        throw new Error('未批准的候选被写入了目标文档（AC-2「仅该项被写入」被破坏）');
      }
      const evolveReport = path.join(dir, '.specs', 'evolve', localDate() + '-EVOLVE.md');
      if (!fs.existsSync(evolveReport)) throw new Error('EVOLVE 报告未落盘: ' + evolveReport);

      // AC-2 报告子句（此前只断言「报告存在」）：扫描范围 + 已扫 change 清单 + 未应用记账。
      const reportText = fs.readFileSync(evolveReport, 'utf8');
      const clauseProblems = evolveReportClauseProblems(reportText);
      assertEqual(clauseProblems.length, 0, 'EVOLVE 报告缺 AC-2 声明的子句: ' + clauseProblems.join(' | '));
      assertTrue(reportText.includes('2026-09-10b-fixture'),
        '报告的「已扫 change 清单」未列出第二个归档 change');
      assertTrue(reportText.includes('未应用 1 条'), '报告未按「本次应用 1 / 未应用 1」记账');
      assertTrue(reportText.includes('2026-09-10b-fixture#1'), '「未应用项」段未列出未批准的候选 id');
      // 判别力（合成输入驱动同一判据）：逐个子句从真实报告里移除 → 必报（判据不恒真空过）
      for (const clause of ['## 扫描范围', '- 已扫 change 清单：', '## 未应用项']) {
        const mutated = reportText.replace(clause, '（反向构造：子句被移除）');
        assertTrue(mutated !== reportText, '反向构造前提不成立（真实报告缺子句）: ' + clause);
        assertTrue(evolveReportClauseProblems(mutated).length > 0,
          '报告缺子句未被判违规（判别力缺失）: ' + clause);
      }

      const state = readStateFile(dir);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(String(state.last_evolve_at))) {
        throw new Error('双落点 state 侧形态非法: ' + JSON.stringify(state.last_evolve_at));
      }
      if (!contextText.includes(state.last_evolve_at)) throw new Error('双落点取值不一致（段侧与 state）');
      // AC-3 三字段端到端（此前只断言时间戳一个）：段在场 + `last_evolve_at` / `scanner` /
      // `下次建议` 齐备且取值与 state、本次执行工具一致。
      const fieldProblems = evolveSectionFieldProblems(contextText, state.last_evolve_at, 'flow-comet-evolve');
      assertEqual(fieldProblems.length, 0, 'AC-3 三字段端到端: ' + fieldProblems.join(' | '));
      // 判别力（合成输入驱动同一判据）：三字段各自移除 / 取值写错 → 必报
      const withoutField = contextText.replace(/- \*\*下次建议\*\*: `[^`]*`\n/, '');
      assertTrue(withoutField !== contextText, '反向构造前提不成立（段内无「下次建议」字段）');
      assertTrue(evolveSectionFieldProblems(withoutField, state.last_evolve_at, 'flow-comet-evolve').length > 0,
        '段内缺「下次建议」字段未被判违规');
      assertTrue(evolveSectionFieldProblems(contextText, state.last_evolve_at, 'other-scanner').length > 0,
        '段内 scanner 取值与本次执行工具不符未被判违规');
      assertTrue(evolveSectionFieldProblems(contextText.replace('## evolve 元数据', '## 其它段'),
        state.last_evolve_at, 'flow-comet-evolve').length > 0, '段缺席未被判违规');

      const again = runSideScript(SIDE_EVOLVE, ['apply', '2026-09-10-fixture#1', '--root', dir], dir);
      assertExit(again, 0);
      assertOut(again, 'EVOLVE-OK');
      const occurrences = readText(dir, '.specs/CONTEXT.md').split('夹具抽象条目（真实链路）').length - 1;
      assertEqual(occurrences, 1, '重复应用同一候选的条目出现次数（幂等）');

      // 幂等判据不得依赖**当天日期**：标记注释里写的是当次运行的本地日期，隔天重跑时它必然失配；
      // 而条目文本一旦被人工改写，`body.includes(entry)` 也同时失配 ⇒ 同一候选被二次插入。
      // 两臂同变异、单变量——对照臂只改条目文本（标记保持当天），处理臂再把标记日期改到过去
      // （= 隔天重跑的等效输入）：后者若仍幂等，就说明判别依据与日期无关，而对照臂同时证明
      // 「条目被改写」本身不会让判据失效（不是靠变异把两臂都弄红）。
      // 变异必须**打断条目文本本身**（在来源标注之前插入）：只往行尾追加的话，`entry` 仍是该行的
      // 连续子串，`body.includes(entry)` 照旧命中——变异就没碰到要考的那条判据（锚会恒绿）。
      const editEntry = (text) => {
        const lines = text.split('\n');
        const at = lines.findIndex((line) => line.includes('夹具抽象条目（真实链路）'));
        assertTrue(at >= 0, '反向构造前提不成立（目标段无该条目行）');
        lines[at] = lines[at].replace(' · 来源 @.specs/', ' · 人工改写 · 来源 @.specs/');
        assertTrue(lines[at].includes(' · 人工改写 · 来源 @.specs/'),
          '反向构造前提不成立（条目行未含来源标注，变异无处落点）');
        return lines.join('\n');
      };
      const backdate = (text, date) => {
        const from = '<!-- flow-comet-evolve ' + localDate() + ':';
        assertTrue(text.includes(from), '反向构造前提不成立（目标段无当日标记注释）');
        return text.replace(from, '<!-- flow-comet-evolve ' + date + ':');
      };
      const countEntry = () => readText(dir, '.specs/CONTEXT.md').split('夹具抽象条目（真实链路）').length - 1;
      const edited = editEntry(readText(dir, '.specs/CONTEXT.md'));
      assertTrue(!edited.includes('- 夹具抽象条目（真实链路） · 来源 @.specs/'),
        '反向构造前提不成立（条目文本仍是连续子串，entry 判据未被扰动）');
      writeFile(dir, '.specs/CONTEXT.md', edited);
      const sameDay = runSideScript(SIDE_EVOLVE, ['apply', '2026-09-10-fixture#1', '--root', dir], dir);
      assertExit(sameDay, 0);
      assertOut(sameDay, 'EVOLVE-OK');
      assertNotOut(sameDay, 'EVOLVE-APPLY: [2026-09-10-fixture#1]');
      assertEqual(countEntry(), 1, '条目文本被改写后同日重跑：同一候选被二次插入');

      writeFile(dir, '.specs/CONTEXT.md',
        backdate(editEntry(readText(dir, '.specs/CONTEXT.md')), '2000-01-01'));
      const crossDay = runSideScript(SIDE_EVOLVE, ['apply', '2026-09-10-fixture#1', '--root', dir], dir);
      assertExit(crossDay, 0);
      assertOut(crossDay, 'EVOLVE-OK');
      assertNotOut(crossDay, 'EVOLVE-APPLY: [2026-09-10-fixture#1]');
      assertEqual(countEntry(), 1, '跨日重跑同一候选：标记的日期分量失配 → 条目被二次插入');

      const stateBefore = readStateBytes(dir);
      const contextBefore = readText(dir, '.specs/CONTEXT.md');
      const unknown = runSideScript(SIDE_EVOLVE, ['apply', 'no-such-id#1', '--root', dir], dir);
      assertExit(unknown, 1);
      assertOut(unknown, '候选 id 未找到');
      if (!readStateBytes(dir).equals(stateBefore)) throw new Error('未知 id 反例改写了 state');
      assertEqual(readText(dir, '.specs/CONTEXT.md'), contextBefore, '未知 id 反例改写了目标文档');

      writeFile(dir, '.specs/archive/2026-09-11-contract/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 跨模块契约\n\n- 夹具契约条目\n');
      const absent = runSideScript(SIDE_EVOLVE, ['apply', '2026-09-11-contract#1', '--root', dir], dir);
      assertExit(absent, 1);
      assertOut(absent, '目标文档不在场');
      if (!readStateBytes(dir).equals(stateBefore)) throw new Error('目标文档缺席反例改写了 state');
      assertEqual(readText(dir, '.specs/CONTEXT.md'), contextBefore, '目标文档缺席反例改写了目标文档');
    },
  },

  {
    name: 'M2 health 真实链路：确定性层 + 增补层两态自洽 + --stdout 与落盘一致 + 不写 state',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n\n### L-002 次条\n');
      writeState(dir, baseState('open'));
      const stateBytes = readStateBytes(dir);

      const res = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(res, 0);
      assertOut(res, '## 确定性层（机器可判）');
      assertOut(res, '- 缺失编号（0）：无');
      assertOut(res, '## 增补层（代码体检工具的 4 维结果 · 可选）');
      assertOut(res, '## 降级声明');
      assertOut(res, '## 易变行声明（两次运行的允许差异集合）');
      // 两态自洽：在场判定与降级声明必须同向（环境决定哪一态，形态不得自相矛盾）
      const present = res.output.includes('- **在场判定**：在场');
      assertEqual(res.output.includes('- **brooks-lint**：在场'), present, '增补层在场判定与降级声明的同向性');
      assertOut(res, present ? '- **来源标注（必填）**' : '- **brooks-lint**：不可用——探测面逐项未命中');

      const reportFile = path.join(dir, '.specs', 'health', localDate() + '-HEALTH.md');
      assertTrue(fs.existsSync(reportFile), '报告未按 <日期>-HEALTH.md 形态落盘: ' + reportFile);
      // `--stdout` = 落盘报告正文原样在前 + `HEALTH:` 审计行追加在后（审计行是 CLI 摘要，
      // 不进报告字节——报告仍是唯一写入面；正文部分与落盘逐字节一致）
      const reportText = fs.readFileSync(reportFile, 'utf8');
      assertTrue(res.output.startsWith(reportText), '--stdout 的报告正文应与落盘逐字节一致（审计行追加在后）');
      assertOut(res, 'HEALTH: 报告 `.specs/health/' + localDate() + '-HEALTH.md`');
      assertOut(res, 'HEALTH-DONE');
      if (!readStateBytes(dir).equals(stateBytes)) throw new Error('health 改写了运行状态文件');

      // 审计行与报告路径**恒输出**：不带 `--stdout` 时 stdout 只给摘要（报告正文不回流），
      // 调用方据此确认「跑没跑、落在哪」——此前该形态 stdout 为空、报告路径无处可见。
      const quiet = runSideScript(SIDE_HEALTH, ['--root', dir], dir);
      assertExit(quiet, 0);
      assertOut(quiet, 'HEALTH: 报告 `.specs/health/' + localDate() + '-HEALTH.md`');
      assertOut(quiet, 'HEALTH-DONE');
      assertTrue(!quiet.output.includes('## 确定性层（机器可判）'), '不带 --stdout 时报告正文不应回流到标准输出');
      if (!readStateBytes(dir).equals(stateBytes)) throw new Error('不带 --stdout 的一轮改写了运行状态文件');

      // 对照态：隔离 HOME/USERPROFILE（用户级落点全部缺席）→ 增补层逐项不在场仍 exit 0
      const isolatedHome = path.join(dir, 'isolated-home');
      fs.mkdirSync(isolatedHome, { recursive: true });
      const isolated = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir,
        { HOME: isolatedHome, USERPROFILE: isolatedHome });
      assertExit(isolated, 0);
      assertOut(isolated, '- **在场判定**：不在场——下列探测面逐项未命中（未安装 / 未加载）');
      assertOut(isolated, '- **brooks-lint**：不可用——探测面逐项未命中');
      assertOut(isolated, '## 确定性层（机器可判）');
      if (!readStateBytes(dir).equals(stateBytes)) throw new Error('health 对照态改写了运行状态文件');
    },
  },

  {
    name: 'M3 context-scan 真实链路：init 后首扫建基线 → 工件变化 → 重扫出差分 + 双落点 + 不扰动路由',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID, '--init-skip'], dir), 0);
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());

      const first = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(first, 0);
      assertOut(first, 'CONTEXT-SCAN: 基线 无（本次为基线，无差异可比）');
      assertOut(first, 'CONTEXT-SCAN-DONE');
      const stateAfterFirst = readStateFile(dir);
      assertEqual(stateAfterFirst.currentNode, 'open', '重扫不得改动路由字段 currentNode');
      assertEqual(stateAfterFirst.activeChange, CHANGE_ID, '重扫不得改动 activeChange');

      const contextText = readText(dir, '.specs/CONTEXT.md');
      writeFile(dir, '.specs/CONTEXT.md',
        contextText.replace('## 既有抽象索引\n', '## 既有抽象索引\n\n- 新增抽象条目（真实链路）\n'));
      const second = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(second, 0);
      assertOut(second, '差异 新增 1 ');
      assertOut(second, 'CONTEXT-SCAN-DONE');

      const report = readText(dir, '.specs/context-scan/' + localDate() + '-SCAN.md');
      assertTrue(report.includes('### 新增（1）'), '工件缺「新增（1）」段');
      assertTrue(report.includes('新增抽象条目（真实链路）'), '工件的新增段未列出新增的抽象索引条目');
      const stateAfterSecond = readStateFile(dir);
      assertTrue(report.includes(stateAfterSecond.last_intel_scan), '工件与 state 的扫描时刻不一致');
      assertTrue(readText(dir, '.specs/CONTEXT.md').includes(stateAfterSecond.last_intel_scan),
        'CONTEXT 段侧与 state 的扫描时刻不一致（双落点）');

      const status = runState(['status'], dir);
      assertExit(status, 0);
      assertEqual(parseStatusOutput(dir).currentNode, 'open', '重扫后 status 的节点推导');
    },
  },

  {
    name: 'M4 ui-design 门真实链路：entry design → 缺件 BLOCK → 补件·声明 → exit --apply 放行',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      writeIntakeArtifacts(dir);
      fs.appendFileSync(path.join(dir, '.specs', CHANGE_ID, 'CHANGE.md'),
        '\n## 视觉调性（Visual Tone）\n\n现代、克制的工具型界面。\n');
      assertExit(runState(['record', 'open', '{"summary":"intake complete"}'], dir), 0);
      assertExit(runGuard(['entry', 'open'], dir), 0);
      assertExit(runGuard(['exit', 'open', '--apply'], dir), 0);

      assertExit(runState(['skill-load', 'design', 'flow-comet-design', '--prompt', 'flow-kit/prompts/2-design.md'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md',
        '# DESIGN\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 0. 技术栈选定\n\nNode.js(ESM)\n\n## 决策清单\n\n- [ ] 循环路由\n');
      assertExit(runState(['record', 'design', '{"summary":"design done"}'], dir), 0);
      assertExit(runGuard(['entry', 'design'], dir), 0);

      // 负例：前端判据成立（「视觉调性」段在场且未标不适用）而工件缺席 → BLOCKED + 恢复路径
      const blocked = runGuard(['exit', 'design'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertOut(blocked, '恢复: 补 .specs/' + CHANGE_ID + '/UI-DESIGN.md');

      // 恢复：补工件 + 真实 skill-load 声明（出口不再自动补写该绑定）→ 出口放行并落状态
      writeFile(dir, '.specs/' + CHANGE_ID + '/UI-DESIGN.md',
        '# UI-DESIGN\n\n## 1. 设计 token\n\n- 主色 `oklch(0.6 0.1 250)`\n');
      const undeclared = runGuard(['exit', 'design'], dir);
      assertExit(undeclared, 1);
      assertOut(undeclared, 'required-skill:design.flow-comet-ui-design');
      assertOut(undeclared, '不再由出口自动补写');
      assertExit(runState(['skill-load', 'design', 'flow-comet-ui-design', '--prompt', 'flow-kit/prompts/2a-ui-design.md'], dir), 0);
      assertExit(runState(['record', 'design',
        '{"summary":"design done with ui-design","completedChecks":["required-skill:design.flow-comet-design","required-skill:design.flow-comet-ui-design"]}'], dir), 0);
      const passed = runGuard(['exit', 'design', '--apply'], dir);
      assertExit(passed, 0);
      assertOut(passed, 'ALL CHECKS PASSED');
      assertNotOut(passed, 'UI-DESIGN: skipped');

      // AC-10 的「跳过」半（此前只在 L1）：第二个 change 走完整真实命令链路到 design 出口——
      // ① fail-open 反向控制：段内自然句子「不适用于暗色主题…」不是结构形态 → 仍判前端、缺件 BLOCKED；
      // ② 结构形态（`适用性` 标签的字段值位）→ 可见跳过 + 命中片段回显，且不要求工件与该声明。
      const nfChange = CHANGE_ID + '-nf';
      const nfChangeFile = path.join(dir, '.specs', nfChange, 'CHANGE.md');
      assertExit(runState(['init', nfChange, '--init-skip'], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      writeIntakeArtifacts(dir, nfChange);
      fs.appendFileSync(nfChangeFile,
        '\n## 视觉调性（Visual Tone）\n\n不适用于暗色主题，本 change 仅覆盖浅色分支。\n');
      assertExit(runState(['record', 'open', '{"summary":"intake complete"}'], dir), 0);
      assertExit(runGuard(['entry', 'open'], dir), 0);
      assertExit(runGuard(['exit', 'open', '--apply'], dir), 0);
      assertExit(runState(['skill-load', 'design', 'flow-comet-design', '--prompt', 'flow-kit/prompts/2-design.md'], dir), 0);
      writeFile(dir, '.specs/' + nfChange + '/DESIGN.md',
        '# DESIGN\n\n- **Change ID**: ' + nfChange + '\n\n## 0. 技术栈选定\n\nNode.js(ESM)\n\n## 决策清单\n\n- [ ] 循环路由\n');
      assertExit(runState(['record', 'design', '{"summary":"design done"}'], dir), 0);
      assertExit(runGuard(['entry', 'design'], dir), 0);

      const failOpen = runGuard(['exit', 'design'], dir);
      assertExit(failOpen, 1);
      assertOut(failOpen, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertNotOut(failOpen, 'UI-DESIGN: skipped');

      // 恢复：改段为结构形态（`- 适用性：不适用（…）`）→ 同一 change 出口放行并回显命中片段
      writeFile(dir, '.specs/' + nfChange + '/CHANGE.md',
        '# CHANGE\n\n- **Change ID**: ' + nfChange + '\n\n## Why（为什么做）\n\n变更目标。\n\n'
        + '## 视觉调性（Visual Tone）\n\n- 适用性：不适用（CLI 工具，无用户可见界面）\n');
      const skipped = runGuard(['exit', 'design', '--apply'], dir);
      assertExit(skipped, 0);
      assertOut(skipped, 'UI-DESIGN: skipped（非前端）');
      assertOut(skipped, '命中片段: - 适用性：不适用（CLI 工具，无用户可见界面）');
      assertNotOut(skipped, 'required-skill:design.flow-comet-ui-design');
      assertNotOut(skipped, 'BLOCKED');
    },
  },

  {
    name: 'M5 evolve 基线跨 change 保留：真实 init 换 change → 基线在场 + 到期提示 + 窗口过滤',
    run: (dir) => {
      const formatStamp = timeUtilsModule.formatLocalTimestamp;
      const dayMs = 24 * 60 * 60 * 1000;
      const dateDaysAgo = (days) => localDate(new Date(Date.now() - days * dayMs));
      // 窗口两侧各一条带 §9 的归档 change；基线落在两者之间（窗口过滤按目录名日期前缀）
      writeFile(dir, '.specs/archive/' + dateDaysAgo(101) + '-before-baseline/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n- 窗口外条目\n');
      writeFile(dir, '.specs/archive/' + dateDaysAgo(99) + '-after-baseline/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n- 窗口内条目\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());

      // 跨 change 的持久性只走真实命令：init 首个 change → 唯一写通道落基线 → init 换 change
      assertExit(runState(['init', CHANGE_ID, '--init-skip'], dir), 0);
      const baseline = formatStamp(new Date(Date.now() - 100 * dayMs));
      const setRes = runState(['config', 'set', 'last_evolve_at', baseline], dir);
      assertExit(setRes, 0);
      assertOut(setRes, 'CONFIG: last_evolve_at = ' + baseline);
      assertExit(runState(['init', CHANGE_ID + '-2', '--init-skip'], dir), 0);
      const state = readStateFile(dir);
      assertEqual(state.activeChange, CHANGE_ID + '-2', 'init 后 activeChange');
      assertEqual(state.last_evolve_at, baseline, 'init 跨 change 保留 last_evolve_at');

      const status = runState(['status'], dir);
      assertExit(status, 0);
      assertOut(status, 'EVOLVE-DUE: 上次架构沉淀 ' + baseline);
      assertOut(status, '超阈值 60 天');
      assertEqual(parseStatusOutput(dir).status, 'running', '提示行在场时 status 的 JSON 块解析');

      const scan = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(scan, 0);
      assertOut(scan, '窗口 起始 = ' + baseline);
      assertOut(scan, '归档 2 个 · 窗口内 1 个 · 含沉淀段 1 个');
      assertOut(scan, 'after-baseline#1');
      assertNotOut(scan, 'before-baseline#');
      assertNotOut(scan, '无基线（首次运行，全量扫描）');

      // AC-18 的第二个触发因（该时刻之后新增 ≥ 5 个带 §9 的归档 change）——同一条真实 `status` 链路：
      // 基线换成新鲜值（未达天数阈值）→ 其后补 5 个带 §9 的归档 change → 提示改按新增数给出；
      // 取走一个（4 个）→ 回到静默（零噪音）。基线换值仍走 `config set` 唯一写通道。
      const freshBaseline = formatStamp(new Date(Date.now() - 30 * dayMs));
      const setFresh = runState(['config', 'set', 'last_evolve_at', freshBaseline], dir);
      assertExit(setFresh, 0);
      assertOut(setFresh, 'CONFIG: last_evolve_at = ' + freshBaseline);
      const freshStatus = runState(['status'], dir);
      assertExit(freshStatus, 0);
      assertNotOut(freshStatus, 'EVOLVE-DUE'); // 天数阈值未达 + 新基线之后新增 0（既有两条归档早于它）
      const countArchive = (offset) => dateDaysAgo(30 - offset) + '-count-' + offset;
      for (let offset = 1; offset <= 5; offset += 1) {
        writeFile(dir, '.specs/archive/' + countArchive(offset) + '/DESIGN.md',
          '# DESIGN\n\n## 9. 架构沉淀\n\n- 计数触发条目 ' + offset + '\n');
      }
      const byCount = runState(['status'], dir);
      assertExit(byCount, 0);
      assertOut(byCount, 'EVOLVE-DUE: 上次架构沉淀 ' + freshBaseline);
      assertOut(byCount, '其后新增 5 个带 §9 的归档 change，达阈值 5 个');
      assertEqual(parseStatusOutput(dir).status, 'running', '按新增数提示时 status 的 JSON 块解析');
      fs.rmSync(path.join(dir, '.specs', 'archive', countArchive(5)), { recursive: true, force: true });
      assertNotOut(runState(['status'], dir), 'EVOLVE-DUE');
    },
  },

  {
    name: 'M6 侧命令 CLI 契约真实链路：--root 两形态·--help·未知参数一致 + 损坏 state fail-closed + 协议绑定独占',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-10-02-fixture/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 契约夹具条目（真实链路）\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      // ① 三命令等号形与空格形等价（修复前 evolve 的等号形报「未知参数」exit 1）
      const evolveEq = runSideScript(SIDE_EVOLVE, ['scan', '--root=' + dir], dir);
      assertExit(evolveEq, 0);
      assertOut(evolveEq, '2026-10-02-fixture#1');
      const evolveSpace = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(evolveSpace, 0);
      assertOut(evolveSpace, 'EVOLVE: 窗口');
      assertExit(runSideScript(SIDE_HEALTH, ['--root=' + dir], dir), 0);
      assertExit(runSideScript(SIDE_CONTEXT_SCAN, ['--root=' + dir], dir), 0);

      // ② `--help` 三命令一致（各列自身命令形态）；未知参数三命令一致（exit 1）
      assertOut(runSideScript(SIDE_EVOLVE, ['--help'], dir), 'evolve.mjs apply');
      assertOut(runSideScript(SIDE_HEALTH, ['-h'], dir), 'health.mjs');
      assertOut(runSideScript(SIDE_CONTEXT_SCAN, ['--help'], dir), 'context-scan.mjs');
      for (const script of [SIDE_EVOLVE, SIDE_HEALTH, SIDE_CONTEXT_SCAN]) {
        const unknown = runSideScript(script, ['--bogus'], dir);
        assertExit(unknown, 1);
        assertOut(unknown, '未知参数: --bogus');
      }

      // ③ 损坏 state 的真实链路：scan 必须 BLOCKED 且零写入，不再输出「无基线（首次运行，全量扫描）」
      const stateFile = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const stateText = fs.readFileSync(stateFile, 'utf8');
      fs.writeFileSync(stateFile, stateText.slice(0, Math.floor(stateText.length / 2)), 'utf8');
      const before = treeFingerprint(dir);
      const blocked = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertNotOut(blocked, '无基线（首次运行，全量扫描）');
      if (treeFingerprint(dir) !== before) throw new Error('损坏 state 的 scan 轮有写入（树指纹应逐项一致）');

      // ④ 协议绑定独占的真实链路：项目内约定副本坏掉 + state.protocolPath 好 → apply 必须成功
      fs.copyFileSync(BUILTIN_PROTOCOL_SOURCE, path.join(dir, 'bound-protocol.json'));
      fs.writeFileSync(path.join(dir, 'reference', 'workflow-protocol.json'),
        '{"schemaVersion": 99, "nodes": []}\n', 'utf8');
      writeState(dir, { ...baseState('open'), protocolPath: 'bound-protocol.json' });
      const applied = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-fixture#1', '--root', dir], dir,
        { FLOW_COMET_PROTOCOL: '' });
      assertExit(applied, 0);
      assertOut(applied, 'EVOLVE-OK');
      assertOut(applied, '双落点一致 state = ');
      assertTrue(fs.existsSync(path.join(dir, '.specs', 'evolve', localDate() + '-EVOLVE.md')),
        '协议绑定链路下 EVOLVE 报告未落盘');
    },
  },

  // M7 扫描时刻双落点真实链路（夹具段行 = 真实生成件形态：取值词元 + 行尾说明）——① 首扫后同刻同
  // 形态即**静默**（整行口径的读侧在此恒亮）② 真漂移必须提示且**类别正确**（不得误报「段内取值
  // 不是合法时间戳」）③ 提示点名的 `context-scan` 跑过后，未刷新路径的 `init` **静默**（收敛可达）
  // ④ 单变量对照：只剥掉行尾说明仍静默（判别条件是词元口径，不是有没有说明）。
  {
    name: 'M7 扫描时刻双落点真实链路：带说明行同刻静默 + 漂移类别正确 + 重扫收敛 + 单变量对照',
    run: (dir) => {
      const parse = timeUtilsModule.parseTimestamp;
      assertExit(runState(['init', CHANGE_ID, '--init-skip'], dir), 0);
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());

      // ① 首扫：双落点建立（段侧与 state 同刻同形态）；段行的行尾说明原样保留（写侧只换取值词元）
      const scan = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(scan, 0);
      assertOut(scan, 'CONTEXT-SCAN-DONE');
      const scanned = readStateFile(dir).last_intel_scan;
      assertTrue(readText(dir, '.specs/CONTEXT.md').includes(scanned), '首扫后段侧应与 state 同刻同形态');
      assertTrue(readText(dir, '.specs/CONTEXT.md').includes(INTEL_FIELD_SUFFIX),
        '重扫改写了段行的行尾说明（写侧只应替换取值词元）');

      // ①' 带说明行的同刻同形态 ⇒ 静默（未刷新路径的 init 不改写既有取值）
      const quietLanded = runState(['init', CHANGE_ID], dir);
      assertExit(quietLanded, 0);
      assertEqual(readStateFile(dir).last_intel_scan, scanned, '未刷新路径应原样保留既有扫描时刻');
      assertNotOut(quietLanded, 'INIT-NOTICE');

      // ② 真实时间流逝（跨过下一个秒边界）——秒级精度下同一秒内的两次写入取值可能相同，漂移不可判
      waitForNextSecond();

      // ③ 原症状顺序：`init --init-context` 记录扫描时刻——形态统一（本地时间 + 显式偏移）+ 漂移可见
      //    且类别正确（两侧同为本地+偏移形态、仅时刻不同 ⇒ 「刻与形态均不一致」）
      const reinit = runState(['init', CHANGE_ID, '--init-context'], dir);
      assertExit(reinit, 0);
      assertOut(reinit, 'INIT-DONE');
      const stateAfter = readStateFile(dir).last_intel_scan;
      assertTrue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(stateAfter),
        'init 写入的扫描时刻形态非「本地时间 + 显式偏移」: ' + stateAfter);
      assertTrue(parse(stateAfter) > parse(scanned),
        'init 写入的扫描时刻应晚于首扫（不得回退）: ' + stateAfter + ' vs ' + scanned);
      assertTrue(readText(dir, '.specs/CONTEXT.md').includes(scanned),
        'init 不应改写 CONTEXT 段（该段行的写通道是 context-scan）');
      assertOut(reinit, 'INIT-NOTICE');
      assertOut(reinit, stateAfter);
      assertOut(reinit, scanned);
      assertOut(reinit, '刻与形态均不一致');
      assertNotOut(reinit, '段内取值不是合法时间戳');
      assertOut(reinit, 'context-scan');

      // ④ 重扫收敛 → 双落点一致（行尾说明仍在）；此后未刷新路径的 init 零提示（不误报）
      const converge = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(converge, 0);
      assertOut(converge, 'CONTEXT-SCAN-DONE');
      const converged = readStateFile(dir).last_intel_scan;
      assertTrue(readText(dir, '.specs/CONTEXT.md').includes(converged), '重扫后双落点应收敛');
      const quiet = runState(['init', CHANGE_ID], dir);
      assertExit(quiet, 0);
      assertEqual(readStateFile(dir).last_intel_scan, converged, '未刷新路径应原样保留既有扫描时刻');
      assertNotOut(quiet, 'INIT-NOTICE');

      // ⑤ 单变量对照：**只**剥掉段行的行尾说明（取值词元不变、state 不变）→ 仍然静默
      const bare = readText(dir, '.specs/CONTEXT.md').replace(INTEL_FIELD_SUFFIX, '');
      assertTrue(bare !== readText(dir, '.specs/CONTEXT.md'), '单变量对照前提不成立：段行不含夹具行尾说明');
      writeFile(dir, '.specs/CONTEXT.md', bare);
      const quietBare = runState(['init', CHANGE_ID], dir);
      assertExit(quietBare, 0);
      assertNotOut(quietBare, 'INIT-NOTICE');
    },
  },
];
