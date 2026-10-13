// 场景组 l — 时间形态与单源结构锚 · 侧命令（evolve / health / context-scan）与 ui-design 门
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import path from 'path';
import {
  assertEqual,
  assertExit,
  assertNotOut,
  assertOut,
  assertTrue,
  baseState,
  cleanupTmpDir,
  runGuard,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  REPO_ROOT,
  SCRIPTS_DIR,
  SIDE_CONTEXT_SCAN,
  SIDE_EVOLVE,
  SIDE_HEALTH,
  SKILL_PROTOCOL_FILE,
  contextInitModule,
  engineDefinitionHits,
  fingerprintChanges,
  handoffFor,
  hasNamedImport,
  makeTmp,
  requireModuleExport,
  runSideScript,
  skillTreeDocFiles,
  skillsRootForScriptsDir,
  stateSchemaModule,
  timeSingleSourceConsumerProblems,
  timeUtilsModule,
  treeFingerprint,
} from '../lib/test-fixtures.mjs';
import {
  REPLAN_STALE_SIGNATURE,
  REPLAN_TASK_INITIAL,
  assertStateBytesUnchanged,
  parseStatusJson,
  readScenarioState,
  readStateBytes,
  replanBackupFiles,
  replanEventsOf,
  replanExecuteState,
  runGuardWithProtocol,
  runStateWithProtocol,
} from '../lib/test-assertions.mjs';
import {
  ATOMIC_TEMP_SUFFIX_RE,
  ATOMIC_WRITE_CONVERGENCE_FACE,
  EVOLVE_METADATA_FIELD_LINES,
  FRONTEND_CRITERION_AUTHORITY_REL,
  FRONTEND_CRITERION_POINTER_RELS,
  FRONTEND_CRITERION_STRUCTURE_GROUPS,
  REPO_CONTEXT_FILE,
  VISUAL_TONE_APPLICABLE,
  VISUAL_TONE_FIELD_MARKER,
  VISUAL_TONE_LINE_HEAD_MARKER,
  VISUAL_TONE_NATURAL_SENTENCE,
  VISUAL_TONE_NOT_APPLICABLE,
  VISUAL_TONE_SUBDIMENSION_FIELD,
  atomicWriteIdiomHits,
  contextFixtureText,
  frontendCriterionAuthorityBlock,
  frontendCriterionProseProblems,
  frontendCriterionRedirectProblems,
  intelFieldToken,
  writeDesignExitFixture,
  writeUiDesignBindingVariant,
} from '../lib/text-anchor-checks.mjs';

export const ENTRIES = [

  // 274: M6 收窄——空退出豁免仅适用于「无任何串行任务」的全并行 change；含串行任务
  // （parallel="false"/缺省，无论 pending/done）时豁免不生效，产物校验照常执行。
  // 夹具用旧 change 语义（无 newChange）：done 缺 SUMMARY 在 M2 只 WARN → 放行与否
  // 唯一取决于 M6 是否跳过 task-summaries 产物校验（隔离判据；新 change 由 M2 硬门先行，
  // 无法观察 M6 行为）。修复前 emptyExitApproved 无条件跳过 → exit 0（本场景 RED）。
  {
    name: '274 execute exit BLOCKED：含串行任务的 change 空退出豁免不生效（M6 收窄）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: '陈旧空退出标记', emptyExitApproved: true };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="T01" parallel="false" status="done"><action>串行任务已完成但缺 SUMMARY</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n');
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'task-summaries');
      assertOut(res, 'EMPTY-EXIT 未生效');
      assertNotOut(res, '豁免已生效');
      // 反向子锚：全并行 change 时豁免仍生效，且输出被跳过项清单（补既有全 parallel 通过锚）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="P01" parallel="true" status="pending"><action>并行任务</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n');
      const resParallel = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resParallel, 0);
      assertOut(resParallel, '豁免已生效');
      assertOut(resParallel, 'EMPTY-EXIT-SKIPPED');
    },
  },
  // 275: replan 任务内容缺失 fail-closed（引擎既有分支的回归锚）——TASK.md 不存在 / 为空（0 字节）
  // 时，真实 CLI 的 replan 必须 BLOCKED、消息给出 fail-closed 指引，且 state 字节零改写、零备份、
  // 零审计事件（判定必须先于任何写盘；不得以「空任务集签名」判幂等空操作放行）。纯空白是边界：
  // 非空串不落 task-content-missing，但同样 fail-closed 拒绝重签（无 <task> 块）。对照：同一夹具
  // 下 TASK.md 恢复为可解析任务集 → replan 放行（证明 BLOCK 来自内容缺失而非夹具畸形）。
  {
    name: '275 replan 任务内容缺失/为空 → BLOCKED fail-closed 零改写（含放行对照）',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n任务内容缺失回归锚。\n');
      writeState(dir, replanExecuteState({ taskHash: REPLAN_STALE_SIGNATURE }));
      const beforeBytes = readStateBytes(dir);
      const blockedCases = [
        ['TASK.md 缺失', null],
        ['TASK.md 为空（0 字节）', ''],
      ];
      for (const [label, content] of blockedCases) {
        if (content === null) {
          fs.rmSync(path.join(dir, '.specs', CHANGE_ID, 'TASK.md'), { force: true });
        } else {
          writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', content);
        }
        const res = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
        assertExit(res, 1);
        assertOut(res, 'BLOCKED');
        assertOut(res, '任务内容缺失');
        assertOut(res, 'fail-closed');
        assertOut(res, 'TASK.md');
        assertStateBytesUnchanged(dir, beforeBytes, label);
      }
      // 边界：纯空白非空串 → 不落 task-content-missing，但同样拒绝重签（无 <task> 块），零改写
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '   \n');
      const blank = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
      assertExit(blank, 1);
      assertOut(blank, 'BLOCKED');
      assertOut(blank, '无 <task> 块');
      assertOut(blank, '零改写');
      assertStateBytesUnchanged(dir, beforeBytes, 'TASK.md 纯空白');
      // 三条 BLOCK 路径都不得产生备份 / 审计事件（写盘前拦截）
      if (replanBackupFiles(dir).length !== 0) {
        throw new Error('内容缺失路径不得产生备份: ' + JSON.stringify(replanBackupFiles(dir)));
      }
      if (replanEventsOf(readScenarioState(dir)).length !== 0) {
        throw new Error('内容缺失路径不得写审计事件: ' + JSON.stringify(replanEventsOf(readScenarioState(dir))));
      }
      // 放行对照：同夹具下 TASK.md 可解析 → replan 真实重签成功（判别力：BLOCK 不是夹具畸形导致）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_INITIAL);
      const ok = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
      assertExit(ok, 0);
      assertOut(ok, 'REPLAN');
      if (replanEventsOf(readScenarioState(dir)).length !== 1) {
        throw new Error('放行对照应恰写 1 条 replan-applied 事件');
      }
    },
  },

  // 276: 时间形态三态——本地 `+HH:mm` 与历史 `Z`（含毫秒）合法且解析等值；纯日期 / 缺时区 /
  // 偏移缺冒号 / 日历不自洽（2026-02-30，Date.parse 会静默滚动）一律非法。判据走 time-utils
  // 的导出（与消费脚本同一实现，不在套件里复制第二份）。
  {
    name: '276 时间形态三态：本地 +HH:mm / 历史 Z（含毫秒）合法等值，形态不符与日历不自洽非法',
    run: () => {
      const parse = requireModuleExport(timeUtilsModule, 'parseTimestamp', 'time-utils.mjs');
      const format = requireModuleExport(timeUtilsModule, 'formatLocalTimestamp', 'time-utils.mjs');
      const isValid = requireModuleExport(timeUtilsModule, 'isValidTimestamp', 'time-utils.mjs');

      const localWithOffset = '2026-10-02T18:30:00+08:00';
      const zulu = '2026-10-02T10:30:00Z';
      const zuluMillis = '2026-10-02T10:30:00.500Z';
      assertEqual(parse(localWithOffset), Date.parse(localWithOffset), '本地 +HH:mm 形态解析');
      assertEqual(parse(zulu), Date.parse(zulu), '历史 Z 形态解析');
      assertEqual(parse(zuluMillis), Date.parse(zuluMillis), '历史 Z + 毫秒解析');
      assertEqual(parse(localWithOffset), parse(zulu), '同一时刻的两种形态解析等值');
      assertEqual(parse(zuluMillis) - parse(zulu), 500, '毫秒分量参与解析');

      const illegal = [
        ['2026-10-02', '纯日期（无法表达时刻）'],
        ['2026-10-02T10:30:00', '缺时区'],
        ['2026-10-02T10:30:00+0800', '偏移缺冒号'],
        ['2026-10-02T10:30:00+24:00', '偏移越界'],
        ['2026-10-02T10:30:00-08:60', '偏移分钟越界'],
        ['2026-02-30T00:00:00Z', '日历不自洽'],
        ['2026-13-01T00:00:00Z', '月份越界'],
        ['不是时间', '垃圾值'],
        ['', '空串'],
        [null, '非字符串'],
      ];
      for (const [value, label] of illegal) {
        assertTrue(Number.isNaN(parse(value)),
          '非法形态未被拒绝: ' + label + ' = ' + JSON.stringify(value));
        assertTrue(!isValid(value), 'isValidTimestamp 未拒绝非法形态: ' + label);
      }

      // 生成侧：本地时间 + 显式偏移；生成 → 解析回环等值（秒级精度）
      const instant = Date.parse('2026-10-02T10:30:15Z');
      const formatted = format(new Date(instant));
      assertTrue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(formatted),
        '生成形态非「本地时间 + 显式偏移」: ' + formatted);
      assertEqual(parse(formatted), instant, '生成 → 解析回环');
    },
  },

  // 277: 单源结构锚——时间与窗口判据（formatLocalTimestamp / nowTimestamp / parseTimestamp /
  // hasSection9 / isArchivedAfterTimestamp）在全引擎**各只有一处定义**，且四个消费脚本一律从
  // time-utils 取值（含 init 写扫描时刻的 nowTimestamp：形态单一来源是双落点一致的形态前提）。
  // 判别力边界（修正旧注释的夸大——「第二份内联实现必然让本场景变红」只在**同名**时成立）：
  //   ① 定义面按**同名定义**计数：同名第二份实现（函数声明 / const 箭头）即变红；
  //   ② 消费面按**具名 import 自 time-utils.mjs + 真实调用**判定（不是纯文本存在性）：消费脚本
  //      内联同名实现顶替导出会变红——旧判据 `text.includes(name + '(')` 会被内联同名实现满足，
  //      属假绿形态（本锚升级的正是这半边）；
  //   ③ **不在本锚覆盖内**：与单源导出**不同名**、且消费方仍保留一次真实调用的等价内联实现——
  //      那类形态由各判据族的形态锚分族承担（如 295 日期前缀 / 298 裸拼接），本锚不冒充覆盖它。
  // 判别力由两条合成反向构造常驻证明（同名第二份定义 / 未具名 import 的内联实现）。
  {
    name: '277 单源结构锚：时间与窗口判据全引擎各一处定义，四个消费脚本零内联',
    run: () => {
      const singleSource = ['formatLocalTimestamp', 'nowTimestamp', 'parseTimestamp', 'hasSection9', 'isArchivedAfterTimestamp'];
      for (const name of singleSource) {
        const hits = engineDefinitionHits(name);
        assertEqual(hits.length, 1, name + ' 的定义面数量（全引擎应恰 1 处）实际 ' + JSON.stringify(hits));
        assertEqual(hits[0].file, 'time-utils.mjs', name + ' 的定义文件');
        assertEqual(hits[0].count, 1, name + ' 在 ' + hits[0].file + ' 内的定义处数');
      }
      const consumers = {
        'workflow-state.mjs': ['isValidTimestamp', 'daysSince', 'hasSection9', 'isArchivedAfterTimestamp', 'nowTimestamp', 'parseTimestamp'],
        'evolve.mjs': ['parseTimestamp', 'hasSection9', 'isArchivedAfterTimestamp', 'nowTimestamp'],
        'context-scan.mjs': ['nowTimestamp', 'formatLocalDate', 'archiveDateFromName'],
        'health.mjs': ['formatLocalTimestamp', 'formatLocalDate'],
      };
      for (const [file, symbols] of Object.entries(consumers)) {
        const text = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
        const problems = timeSingleSourceConsumerProblems(text, symbols, file);
        assertEqual(problems.length, 0, '消费面单源违规: ' + problems.join(' | '));
      }

      // 反向构造 ①（合成目录 · 纯函数）：同名第二份定义 → 定义面检出 2（判据不恒真空过）。
      // 样例经拼接构造，避免套件自身源码携带定义形态字面量而污染真实面计数（本套件同样在扫描面内）。
      const definitionSample = (name) => 'function ' + name + '(date) { return String(date); }\n';
      const synthetic = makeTmp();
      try {
        writeFile(synthetic, 'single.mjs', definitionSample('formatLocalTimestamp'));
        assertEqual(engineDefinitionHits('formatLocalTimestamp', synthetic).length, 1, '合成目录单份定义检出数');
        writeFile(synthetic, 'second.mjs', definitionSample('formatLocalTimestamp'));
        assertEqual(engineDefinitionHits('formatLocalTimestamp', synthetic).length, 2,
          '合成目录同名第二份定义检出数（判据须变红）');
      } finally {
        cleanupTmpDir(synthetic);
      }

      // 反向构造 ②（合成文本 · 纯函数）：内联同名实现顶替导出——旧子串判据会放过、本锚必须拒绝；
      // 另两态证明判据不恒真（具名 import 但零调用 → 必报；具名 import + 真实调用 → 零问题）。
      // 同一拼接纪律：调用形态的 `name + '('` 可以字面出现（它不是定义形态），定义形态不可。
      const inlined = 'function ' + 'parseTimestamp(text) {\n  return Date.parse(text);\n}\n'
        + "parseTimestamp('2026-10-02T10:00:00+08:00');\n";
      assertTrue(inlined.includes('parseTimestamp('), '反向构造前提不成立：旧子串判据本应命中内联实现');
      const inlinedProblems = timeSingleSourceConsumerProblems(inlined, ['parseTimestamp'], 'synthetic.mjs');
      assertTrue(inlinedProblems.some((problem) => problem.includes('未从 time-utils.mjs 具名 import')),
        '内联同名实现未被判违规（旧判据的假绿形态）: ' + JSON.stringify(inlinedProblems));
      const importedOnly = "import { parseTimestamp } from './time-utils.mjs';\nconst unused = 1;\n";
      assertTrue(timeSingleSourceConsumerProblems(importedOnly, ['parseTimestamp'], 'synthetic.mjs')
        .some((problem) => problem.includes('未真实消费')), '具名 import 但零调用未被判违规');
      const genuine = "import { parseTimestamp } from './time-utils.mjs';\n"
        + 'export const instant = (value) => parseTimestamp(value);\n';
      assertEqual(timeSingleSourceConsumerProblems(genuine, ['parseTimestamp'], 'synthetic.mjs').length, 0,
        '具名 import + 真实调用不应被判违规');
    },
  },

  // 278: evolve 增量窗口与历史 `Z` 兼容——窗口内入选 / 窗口外排除 / 无基线全量；扫描严格限定在
  // 设计文档的沉淀段（其它段的标记串不得出现在输出）；`scan` 零写入用树指纹对照。
  {
    name: '278 evolve 窗口：窗口内入选·窗口外排除·无基线全量 + 历史 Z 兼容 + 只读沉淀段 + 零写入',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-08-20-old/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n- 窗口外条目\n');
      writeFile(dir, '.specs/archive/2026-09-10-new/DESIGN.md',
        '# DESIGN\n\n## 5. 其它段\n\nOTHER-SECTION-MARKER\n\n## 9. 架构沉淀\n\n- 窗口内条目\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      const state = baseState('open');
      state.last_evolve_at = '2026-09-01T00:00:00Z'; // 历史 Z 形态基线
      writeState(dir, state);

      const before = treeFingerprint(dir);
      const res = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(res, 0);
      assertOut(res, 'EVOLVE: 扫描');
      assertOut(res, '窗口 起始 = 2026-09-01T00:00:00Z');
      assertOut(res, '归档 2 个 · 窗口内 1 个 · 含沉淀段 1 个');
      assertOut(res, '2026-09-10-new#1');
      assertNotOut(res, '2026-08-20-old#');
      assertNotOut(res, 'OTHER-SECTION-MARKER'); // 只读沉淀段：其它段的标记串不进候选
      const written = fingerprintChanges(before, treeFingerprint(dir));
      assertEqual(written.length, 0, 'scan 必须零写入，实际树变化: ' + JSON.stringify(written));

      // 等值的 `+00:00` 形态给出同一窗口（兼容历史 Z 与本地偏移两种写法，不是两套语义）
      const offsetState = { ...state, last_evolve_at: '2026-09-01T00:00:00+00:00' };
      writeState(dir, offsetState);
      const offsetRes = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(offsetRes, 0);
      assertOut(offsetRes, '窗口 起始 = 2026-09-01T00:00:00+00:00');
      assertOut(offsetRes, '窗口内 1 个');
      assertNotOut(offsetRes, '上次沉淀时间不可解析');

      // 不可解析的基线 → 显式按全量扫描（不静默当成「无新增」）
      writeState(dir, { ...state, last_evolve_at: '不是时间' });
      const broken = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(broken, 0);
      assertOut(broken, '上次沉淀时间不可解析（按全量扫描）');
      assertOut(broken, '窗口内 2 个');

      // 无基线（字段缺席）→ 全量扫描
      writeState(dir, baseState('open'));
      const noBaseline = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(noBaseline, 0);
      assertOut(noBaseline, '无基线（首次运行，全量扫描）');
      assertOut(noBaseline, '窗口内 2 个');
      assertOut(noBaseline, '2026-08-20-old#1');
    },
  },

  // 279: 到期提示两因与静默——「距今 > 60 天」或「该时刻之后新增 ≥ 5 个带 §9 的归档 change」
  // 达阈值即输出 `EVOLVE-DUE`（提示行不含花括号，status 的 JSON 块仍可被既有消费方解析）；
  // 未达阈值 / 字段缺席（从未跑过 evolve）一律零输出；非法值经 `config set` 写入 → BLOCKED 零改写。
  {
    name: '279 到期提示：按天数·按新增数达阈值提示，未达阈值与字段缺席静默，JSON 块可解析',
    run: (dir) => {
      const formatStamp = requireModuleExport(timeUtilsModule, 'formatLocalTimestamp', 'time-utils.mjs');
      const formatDate = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs');
      const dayMs = 24 * 60 * 60 * 1000;
      const stampDaysAgo = (days) => formatStamp(new Date(Date.now() - days * dayMs));
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\n\n夹具。\n');

      // ① 按天数：距今 100 天 → 提示行 + JSON 块仍可解析
      writeState(dir, { ...baseState('open'), last_evolve_at: stampDaysAgo(100) });
      const aged = runStateWithProtocol(dir, ['status']);
      assertExit(aged, 0);
      assertOut(aged, 'EVOLVE-DUE: 上次架构沉淀');
      assertOut(aged, '超阈值 60 天');
      assertEqual(parseStatusJson(aged).status, 'running', '提示行在场时 status 的 JSON 块解析');

      // ② 未达阈值（新鲜）→ 静默；③ 字段缺席（从未跑过 evolve）→ 同样静默
      writeState(dir, { ...baseState('open'), last_evolve_at: stampDaysAgo(1) });
      assertNotOut(runStateWithProtocol(dir, ['status']), 'EVOLVE-DUE');
      writeState(dir, baseState('open'));
      assertNotOut(runStateWithProtocol(dir, ['status']), 'EVOLVE-DUE');

      // ④ 按新增数：基线之后 5 个带 §9 的归档 change → 提示；取走一个（4 个）→ 静默
      const baselineMs = Date.now() - 30 * dayMs;
      const baselineStamp = formatStamp(new Date(baselineMs));
      const archiveDirName = (offsetDays) => formatDate(new Date(baselineMs + offsetDays * dayMs)) + '-new-' + offsetDays;
      for (let offset = 1; offset <= 5; offset += 1) {
        writeFile(dir, '.specs/archive/' + archiveDirName(offset) + '/DESIGN.md',
          '# DESIGN\n\n## 9. 架构沉淀\n\n- 条目 ' + offset + '\n');
      }
      writeState(dir, { ...baseState('open'), last_evolve_at: baselineStamp });
      const byCount = runStateWithProtocol(dir, ['status']);
      assertExit(byCount, 0);
      assertOut(byCount, 'EVOLVE-DUE: 上次架构沉淀');
      assertOut(byCount, '其后新增 5 个带 §9 的归档 change，达阈值 5 个');
      parseStatusJson(byCount);
      fs.rmSync(path.join(dir, '.specs', 'archive', archiveDirName(5)), { recursive: true, force: true });
      assertNotOut(runStateWithProtocol(dir, ['status']), 'EVOLVE-DUE');

      // ⑤ 非法值经唯一写通道写入 → BLOCKED 且 state 字节零改写
      const beforeBytes = readStateBytes(dir);
      const illegal = runStateWithProtocol(dir, ['config', 'set', 'last_evolve_at', '2026-02-30T00:00:00Z']);
      assertExit(illegal, 1);
      assertOut(illegal, 'BLOCKED');
      assertOut(illegal, 'last_evolve_at');
      assertStateBytesUnchanged(dir, beforeBytes, 'last_evolve_at 非法值');
    },
  },

  // 280: health 复现性——同一冻结树两次运行，差异必须落在报告的「易变行声明」集合内（声明的
  // 差异集合之外逐字节一致）；`--stdout` 与落盘逐字节相同；state 零改写（报告是唯一写入面）。
  {
    name: '280 health 两次运行：易变行声明之外逐字节一致 + --stdout 与落盘相同 + state 零改写',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n\n### L-002 次条\n');
      writeState(dir, baseState('open'));
      const stateBytes = readStateBytes(dir);

      const first = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(first, 0);
      assertOut(first, '## 确定性层（机器可判）');
      assertOut(first, '### 1 · 项目上下文一致性');
      assertOut(first, '### 2 · 经验条目编号连续性');
      assertOut(first, '- 缺失编号（0）：无');
      assertOut(first, '## 增补层（代码体检工具的 4 维结果 · 可选）');
      assertOut(first, '## 降级声明');
      assertOut(first, '## 易变行声明（两次运行的允许差异集合）');

      const second = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(second, 0);
      const volatilePrefixes = ['- **生成时间**：', '- 最近 30 天提交数：'];
      const firstLines = first.output.split('\n');
      const secondLines = second.output.split('\n');
      const differing = [];
      for (let i = 0; i < Math.max(firstLines.length, secondLines.length); i += 1) {
        if (firstLines[i] === secondLines[i]) continue;
        const line = firstLines[i] ?? secondLines[i] ?? '';
        if (volatilePrefixes.some((prefix) => line.startsWith(prefix))) continue;
        differing.push('第 ' + (i + 1) + ' 行 ' + JSON.stringify(firstLines[i]) + ' → ' + JSON.stringify(secondLines[i]));
      }
      assertEqual(differing.length, 0, '两次运行的差异落在易变行声明之外: ' + differing.join(' | '));

      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const reportFile = path.join(dir, '.specs', 'health', today + '-HEALTH.md');
      assertTrue(fs.existsSync(reportFile), '报告未按 <日期>-HEALTH.md 形态落盘: ' + reportFile);
      // `--stdout` = 落盘报告正文原样在前 + `HEALTH:` 审计行追加在后：审计行是 CLI 摘要而非报告
      // 内容，不进报告字节（报告仍是唯一写入面）；正文部分与落盘逐字节一致。
      const reportText = fs.readFileSync(reportFile, 'utf8');
      assertTrue(second.output.startsWith(reportText),
        '--stdout 的报告正文应与落盘逐字节一致（审计行追加在后）: ' + JSON.stringify(second.output.slice(0, 120)));
      assertOut(second, 'HEALTH: 报告 `.specs/health/' + today + '-HEALTH.md`');
      assertOut(second, 'HEALTH-DONE');
      assertOut(second, '- **写入边界**：只写本报告文件；不改代码、不写运行状态文件（本命令不新增任何状态字段）');
      assertStateBytesUnchanged(dir, stateBytes, 'health 运行后');
      // 同日重跑不与自己对比（否则报告自我污染、复现性判据失效）
      assertOut(second, '基线：无（`.specs/health` 下无日期不同的历史报告）');
    },
  },

  // 281: health 缺可选工具的两态之一——隔离 HOME/USERPROFILE（用户级插件缓存与用户技能目录
  // 都落主目录）→ 增补层逐项不在场、降级声明可见，确定性层照常完整、退出码 0（可选工具缺席
  // 不构成失败；本机实际装有 brooks，故须隔离而不是假设）。
  {
    name: '281 health 隔离 HOME：增补层逐项不在场 + 降级声明可见 + 确定性层完整 + exit 0',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n');
      const isolatedHome = path.join(dir, 'isolated-home');
      fs.mkdirSync(isolatedHome, { recursive: true });

      const isolated = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir,
        { HOME: isolatedHome, USERPROFILE: isolatedHome });
      assertExit(isolated, 0);
      assertOut(isolated, '- **在场判定**：不在场——下列探测面逐项未命中（未安装 / 未加载）');
      assertOut(isolated, 'Claude Code 插件缓存（用户级）');
      assertOut(isolated, '- **降级**：4 维结果缺省；报告只由确定性层构成（判据不因缺可选工具而失败）');
      assertOut(isolated, '- **brooks-lint**：不可用——探测面逐项未命中');
      assertOut(isolated, '## 确定性层（机器可判）');
      assertOut(isolated, '### 5 · 版本历史统计（git）');
      assertOut(isolated, '缺席不影响本命令成功（退出码 0）');

      // 对照：未隔离运行同样以完整报告 + 退出码 0 收尾（在场与否随环境，报告形态不变）
      const openEnv = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(openEnv, 0);
      assertOut(openEnv, '- **探测面（固定清单 · 逐项判定）**：');
      assertOut(openEnv, '## 确定性层（机器可判）');
    },
  },

  // 282: context-scan 首次无基线与二次差异——首次显式声明「本次为基线，无差异可比」；第二次
  // 逐项比对出新增；同一秒连续重扫不得误 BLOCK；双落点（state 的 last_intel_scan 与 CONTEXT
  // 的 `## intel-scan 元数据` 字段）取值一致；工件含机器快照标记。
  {
    name: '282 context-scan 首次无基线 → 二次差异：新增可比 + 同秒重扫 exit 0 + 双落点一致',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      const first = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(first, 0);
      assertOut(first, 'CONTEXT-SCAN: 基线 无（本次为基线，无差异可比）');
      assertOut(first, 'CONTEXT-SCAN: 差异 无（本次为基线，无差异可比）');
      assertOut(first, 'CONTEXT-SCAN-DONE');

      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const reportFile = path.join(dir, '.specs', 'context-scan', today + '-SCAN.md');
      assertTrue(fs.existsSync(reportFile), '扫描工件未落盘: ' + reportFile);
      const reportText = fs.readFileSync(reportFile, 'utf8');
      assertTrue(reportText.includes('<!-- context-scan-snapshot -->'), '工件缺机器快照标记');
      assertTrue(/```json\r?\n/.test(reportText.slice(reportText.indexOf('<!-- context-scan-snapshot -->'))),
        '机器快照标记之后缺 json 块');

      // 同一秒连续重扫（取值未变）不得被误判成字段行形态不符
      const immediate = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(immediate, 0);
      assertOut(immediate, 'CONTEXT-SCAN-DONE');

      // 双落点：state 的 last_intel_scan 与 CONTEXT 段内字段**取值词元**一致（夹具段行带行尾说明）
      const structure = requireModuleExport(contextInitModule, 'extractContextStructure', 'context-init.mjs')(
        fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8'));
      const landed = intelFieldToken(structure.metadata['intel-scan 元数据'].last_intel_scan.value);
      const stateFile = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      assertEqual(stateFile.last_intel_scan, landed, '双落点取值（state 与 CONTEXT 段）');
      assertTrue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(landed),
        '落盘扫描时刻形态非「本地时间 + 显式偏移」: ' + landed);

      // 二次差异：新增一份 AI 上下文文档 → 差异段「新增」列出该条目（条目在工件内，摘要行只给计数）
      writeFile(dir, 'AGENTS.md', '# AGENTS\n\n夹具。\n');
      const second = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(second, 0);
      assertOut(second, 'CONTEXT-SCAN: 基线');
      assertOut(second, '差异 新增 1 ');
      assertOut(second, 'CONTEXT-SCAN-DONE');
      const diffReport = fs.readFileSync(reportFile, 'utf8');
      assertTrue(diffReport.includes('### 新增（1）'), '工件缺「新增（1）」段');
      assertTrue(diffReport.includes('- AI 上下文文档 · AGENTS.md'),
        '工件的新增段未列出新增的 AI 上下文文档');
    },
  },

  // 283: context-scan 四类边界——① 既有基线不含机器快照 → 显式「无法比对」（不静默省略差异段）；
  // ② 结构校验不通过的一轮零写入且基线不前进（工件与 state 逐字节不变）；③ 未初始化项目 →
  // INIT-GENERATE 指引 + 零写入 + exit 1；④ state 在场但字段非法 → CONTEXT 段零改写
  // （校验先于两次写入，双落点不被拆成两半）。
  {
    name: '283 context-scan 边界：旧基线无快照显式无法比对 / BLOCK 轮不推进基线 / 未初始化零写入 / state 字段非法零改写',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      // ① 旧基线不含机器快照（人读工件的历史形态）
      const legacyBaseline = path.join(dir, '.specs', 'context-scan', '2020-01-01-SCAN.md');
      fs.mkdirSync(path.dirname(legacyBaseline), { recursive: true });
      fs.writeFileSync(legacyBaseline, '# 项目上下文重扫报告 · 2020-01-01\n\n（历史工件，无机器快照块）\n', 'utf8');
      const legacyRes = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(legacyRes, 0);
      assertOut(legacyRes, 'CONTEXT-SCAN: 差异 无（既有基线不含机器快照，无法比对）');
      assertOut(legacyRes, 'CONTEXT-SCAN-DONE');

      // ② 结构校验不通过的一轮：零写入，基线不前进
      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const baselineFile = path.join(dir, '.specs', 'context-scan', today + '-SCAN.md');
      assertTrue(fs.existsSync(baselineFile), '本轮基线工件应在场: ' + baselineFile);
      const baselineBytes = fs.readFileSync(baselineFile);
      const stateBytes = readStateBytes(dir);
      fs.writeFileSync(path.join(dir, '.specs', 'CONTEXT.md'),
        contextFixtureText().replace('## 默认偏好\n', ''), 'utf8');
      const blocked = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED: CONTEXT.md 未通过结构校验');
      assertTrue(fs.readFileSync(baselineFile).equals(baselineBytes), 'BLOCK 的一轮改写了基线工件');
      assertStateBytesUnchanged(dir, stateBytes, 'context-scan BLOCK 轮');

      // ③ 未初始化项目：INIT-GENERATE 指引 + 零写入 + exit 1
      const fresh = path.join(dir, 'fresh-project');
      fs.mkdirSync(fresh, { recursive: true });
      const freshBefore = treeFingerprint(fresh);
      const freshRes = runSideScript(SIDE_CONTEXT_SCAN, ['--root', fresh], fresh);
      assertExit(freshRes, 1);
      assertOut(freshRes, 'INIT-GENERATE');
      assertOut(freshRes, 'BLOCKED');
      const freshChanges = fingerprintChanges(freshBefore, treeFingerprint(fresh));
      assertEqual(freshChanges.length, 0, '未初始化项目必须零写入，实际树变化: ' + JSON.stringify(freshChanges));

      // ④ state 在场但字段非法（写闸门会拒）：CONTEXT 段必须零改写。校验此前排在 CONTEXT 改写之后
      //   ⇒ 段侧先落新扫描时刻、state 侧被拒，双落点被拆成两半（且段侧指向引擎根本不认的时刻）。
      //   与同一命令的损坏态判定（preflight ②：状态不可信 → 零元数据写入）是同一姿态。
      const badStateRoot = path.join(dir, 'bad-state-field');
      writeFile(badStateRoot, '.specs/CONTEXT.md', contextFixtureText());
      writeState(badStateRoot, { ...baseState('open'), executionMode: 'not-a-mode' });
      const badContextBefore = fs.readFileSync(path.join(badStateRoot, '.specs', 'CONTEXT.md'));
      const badStateBytes = readStateBytes(badStateRoot);
      const badStateRes = runSideScript(SIDE_CONTEXT_SCAN, ['--root', badStateRoot], badStateRoot);
      assertExit(badStateRes, 1);
      assertOut(badStateRes, 'BLOCKED');
      assertTrue(fs.readFileSync(path.join(badStateRoot, '.specs', 'CONTEXT.md')).equals(badContextBefore),
        'state 字段非法的一轮改写了 CONTEXT 段（双落点被拆成两半）');
      assertStateBytesUnchanged(badStateRoot, badStateBytes, 'context-scan state 字段非法轮');
    },
  },

  // 284: 本仓 CONTEXT 的七段校验 + 可选的 `## evolve 元数据` 段语义——缺席不报（没跑过架构
  // 沉淀的项目不补段）；在场则三字段必须齐（跑过一次却写残的半成品正是要拦的形态）；判据
  // **限定在段内**（别处的同名字段不得让残缺的 evolve 段蒙混过关）。
  // ① 是本仓真实文件的**维护者形态**断言（.specs/ 被 gitignore）：文件结构性缺席（CI 全新检出 /
  // worktree）时输出可见 SKIP 行（未验证 ≠ 通过），**在场时判据逐字不变**；②~⑤ 恒检（夹具驱动）。
  {
    name: '284 CONTEXT 七段校验 + evolve 元数据可选段：缺席不报·在场缺一即报·判据限段内',
    run: async () => {
      const validate = requireModuleExport(contextInitModule, 'validateContext', 'context-init.mjs');

      // ① 本仓 CONTEXT.md 通过七段校验（真实文件，非夹具）——文件缺席即非维护者形态，可见跳过
      if (fs.existsSync(REPO_CONTEXT_FILE)) {
        const repo = await validate(REPO_ROOT);
        assertEqual(repo.missingSections.length, 0, '本仓 CONTEXT.md 缺段: ' + JSON.stringify(repo.missingSections));
        assertEqual(repo.formatIssues.length, 0, '本仓 CONTEXT.md 格式问题: ' + JSON.stringify(repo.formatIssues));
      } else {
        console.log('SKIP: 284 的本仓 CONTEXT 面（.specs/CONTEXT.md 为流程工件面，可能结构性缺席）'
          + '——本仓 CONTEXT 缺席 = 非维护者形态；本次检出未校验本仓 CONTEXT.md 的七段与 evolve 元数据段语义，'
          + '请在维护者主树重跑本套件');
      }

      // ② 夹具：七段齐备、evolve 段缺席 → 通过（可选段的缺席不报）
      const project = makeTmp();
      try {
        writeFile(project, '.specs/CONTEXT.md', contextFixtureText());
        const absent = await validate(project);
        assertEqual(absent.missingSections.length, 0, '七段骨架缺段: ' + JSON.stringify(absent.missingSections));
        assertEqual(absent.formatIssues.length, 0, 'evolve 段缺席不应报格式问题: ' + JSON.stringify(absent.formatIssues));

        // ③ evolve 段在场且三字段齐 → 通过
        writeFile(project, '.specs/CONTEXT.md',
          contextFixtureText({ evolveSection: EVOLVE_METADATA_FIELD_LINES }));
        const complete = await validate(project);
        assertEqual(complete.formatIssues.length, 0, 'evolve 段齐备仍报格式问题: ' + JSON.stringify(complete.formatIssues));

        // ④ 段内缺一个字段 → 报「evolve 元数据三字段」
        writeFile(project, '.specs/CONTEXT.md',
          contextFixtureText({ evolveSection: EVOLVE_METADATA_FIELD_LINES.slice(0, 2) }));
        const incomplete = await validate(project);
        assertTrue(incomplete.formatIssues.some((issue) => issue.includes('evolve 元数据三字段')),
          'evolve 段缺字段未报出: ' + JSON.stringify(incomplete.formatIssues));

        // ⑤ 判据限段内：缺的那个字段出现在**其它段**里，不得让残缺的 evolve 段蒙混过关
        writeFile(project, '.specs/CONTEXT.md', contextFixtureText({
          evolveSection: EVOLVE_METADATA_FIELD_LINES.slice(0, 2),
          tail: '## 其它段\n\n- **下次建议**: 别处的同名字段',
        }));
        const outside = await validate(project);
        assertTrue(outside.formatIssues.some((issue) => issue.includes('evolve 元数据三字段')),
          '判据未限定段内（别处的同名字段放行了残缺段）: ' + JSON.stringify(outside.formatIssues));
      } finally {
        cleanupTmpDir(project);
      }
    },
  },

  // 285: design 出口 ui-design 门四类——正例（前端齐备 + 真实声明 → 放行）/ 负例（缺工件
  // BLOCKED、缺声明 BLOCKED 且不再自动补写）/ 越界（非前端 → 可见跳过，不要求工件与声明）/
  // 恢复（旧 change 前端缺件 → WARN 渐进不卡死）。前端判据是结构级：CHANGE.md「视觉调性」段。
  {
    name: '285 ui-design 门四类：前端齐备放行 / 前端缺件 BLOCK / 非前端可见跳过 / 旧 change WARN',
    run: (dir) => {
      // 正例：前端（「视觉调性」段在场且未标注不适用）+ 工件齐备 + 真实声明
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: true,
      });
      const positive = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(positive, 0);
      assertOut(positive, 'ALL CHECKS PASSED');
      assertNotOut(positive, 'UI-DESIGN: skipped');

      // 负例 A：前端缺 UI-DESIGN.md → BLOCKED + 两条恢复路径
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: true,
      });
      const missingArtifact = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(missingArtifact, 1);
      assertOut(missingArtifact, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertOut(missingArtifact, '恢复: 补 .specs/' + CHANGE_ID + '/UI-DESIGN.md');

      // 负例 B：工件齐备但缺 `required-skill:design.flow-comet-ui-design` → BLOCKED（出口不再自动补写）
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: false,
      });
      const missingDeclaration = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(missingDeclaration, 1);
      assertOut(missingDeclaration, 'BLOCKED: missing required Skill evidence: required-skill:design.flow-comet-ui-design');
      assertOut(missingDeclaration, '不再由出口自动补写');

      // 越界：非前端（「视觉调性」段标注不适用）→ 可见跳过，不要求工件、也不要求该声明
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_NOT_APPLICABLE, uiDesign: false, declareUiDesign: false,
      });
      const nonFrontend = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(nonFrontend, 0);
      assertOut(nonFrontend, 'UI-DESIGN: skipped（非前端）');
      assertOut(nonFrontend, 'ALL CHECKS PASSED');

      // 恢复：旧 change 前端缺件 → WARN 渐进（不阻断，也不静默放行）
      writeDesignExitFixture(dir, {
        newChange: false, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: true,
      });
      const legacy = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(legacy, 0);
      assertOut(legacy, 'UI-DESIGN WARN: 缺 .specs/' + CHANGE_ID + '/UI-DESIGN.md');
      assertOut(legacy, '旧 change 渐进不阻断');
    },
  },

  // 286: ui-design 强制等级的文本一致性锚——协议 `design.requiredSkillCalls[flow-comet-ui-design]`
  // 为 `guarded`，**五份**技能文本（ui-design 技能 / 入口 SKILL / design 节点 SKILL / 入口展开册
  // `reference/entry-detail.md` / change 阶段 SKILL）不得残留 `advisory` 表述且须同时点名该绑定与
  // `guarded`。等级只在协议里表达一次，文本是它的散文副本：副本漂移即红（旧表述「advisory，不要求
  // 声明」正是被本锚拦下的形态）。
  // **判据散文口径（ADR-016 重定向）**：原判据要求**五份文本各自**陈述五个结构 token，且反向构造
  // 断言**每份**文本都含「词形边界」——T05 把口径收归 `flow-comet-ui-design` 册一处权威后，那一侧
  // 会以两种方式失败（五份各自的 token 缺失 + 反向构造前提不成立）。新判据三件套：**一处权威**
  //（ui-design 册陈述五个结构 token 且零旧口径）+ **入口册指针在场**（各引用册以条件句指向该册）
  // + **该口径正文唯一**（块级跨距：任何其它分发文本不得含权威口径段的 ≥120 字符逐字副本）。
  {
    name: '286 ui-design 强制等级一致性锚：协议 guarded + 五处技能文本零 advisory 残留 + 结构判据散文口径',
    run: () => {
      const protocol = JSON.parse(fs.readFileSync(SKILL_PROTOCOL_FILE, 'utf8'));
      const designNode = (protocol.nodes ?? []).find((node) => node.id === 'design');
      assertTrue(designNode !== undefined, '协议缺 design 节点');
      const binding = (designNode.requiredSkillCalls ?? []).find((call) => call.skill === 'flow-comet-ui-design');
      assertTrue(binding !== undefined, '协议 design 节点缺 flow-comet-ui-design 绑定');
      assertEqual(binding.enforcement, 'guarded', '协议 flow-comet-ui-design 绑定的强制等级');

      const skillsRoot = skillsRootForScriptsDir(SCRIPTS_DIR);
      const texts = {
        'flow-comet-ui-design/SKILL.md': path.join(skillsRoot, 'flow-comet-ui-design', 'SKILL.md'),
        'flow-comet/SKILL.md': path.join(skillsRoot, 'flow-comet', 'SKILL.md'),
        'flow-comet-design/SKILL.md': path.join(skillsRoot, 'flow-comet-design', 'SKILL.md'),
        'flow-comet/reference/entry-detail.md': path.join(skillsRoot, 'flow-comet', 'reference', 'entry-detail.md'),
        'flow-comet-change/SKILL.md': path.join(skillsRoot, 'flow-comet-change', 'SKILL.md'),
      };
      const textByRel = new Map();
      for (const [label, file] of Object.entries(texts)) {
        const text = fs.readFileSync(file, 'utf8');
        textByRel.set(label, text);
        assertTrue(!/advisory/i.test(text), label + ' 残留 advisory 等级表述（协议为 guarded）');
        assertTrue(text.includes('guarded'), label + ' 未点名 guarded 等级');
        assertTrue(text.includes('flow-comet-ui-design'), label + ' 未点名 flow-comet-ui-design 绑定');
      }
      // —— 结构判据散文口径的三件套（重定向后判据；纯函数 + 合成文本面驱动）——
      const criterionSources = {
        authorityRel: FRONTEND_CRITERION_AUTHORITY_REL,
        authorityText: textByRel.get(FRONTEND_CRITERION_AUTHORITY_REL),
        pointerDocs: new Map(FRONTEND_CRITERION_POINTER_RELS.map(([rel]) => [rel, textByRel.get(rel)])),
        docs: new Map(skillTreeDocFiles().map(([rel, file]) => [rel, fs.readFileSync(file, 'utf8')])),
      };
      const criterionProblems = frontendCriterionRedirectProblems(criterionSources);
      assertEqual(criterionProblems.length, 0, '判据散文口径未对齐: ' + criterionProblems.join(' | '));
      // 反向构造（合成输入驱动同一判据，证明它不恒真空过）：
      // ① 结构词缺一 → 必报；② 旧口径句注入权威处 → 必报「残留旧口径」；
      // ③ 权威口径段复制进第二册 → 必报「第二份正文」（原「五份各自陈述」的方向已反转）；
      // ④ 抽掉入口册指针 → 必报「指针不在场」。
      const structuralSample = '前端判据是结构级的：独立行 / 行首 / 适用性标签的字段值位三种形态，'
        + '标记后须成词形边界，命中片段回显。\n';
      assertEqual(frontendCriterionProseProblems('sample', structuralSample).length, 0,
        '结构口径样本不应被判违规（判据不恒真）');
      const staleSamples = [
        '前端判据是结构级的：`CHANGE.md` 的「视觉调性」段在场且段内未标注「不适用」。',
        '段在场，段内**不含**字面「不适用」',
        '非前端项目：在段内标注「不适用」两个字面。',
      ];
      for (const stale of staleSamples) {
        const probed = frontendCriterionRedirectProblems({
          ...criterionSources,
          authorityText: criterionSources.authorityText + '\n' + stale + '\n',
        });
        assertTrue(probed.some((problem) => problem.includes('残留旧口径')),
          '旧口径样本未被判违规: ' + JSON.stringify(stale) + ' → ' + JSON.stringify(probed));
      }
      for (const group of FRONTEND_CRITERION_STRUCTURE_GROUPS) {
        // OR 组的反向构造必须抽掉**整组** token（只抽一个会被组内另一形态满足而恒真）。
        const strippedText = group.reduce((acc, token) => acc.split(token).join('（反向构造：抽掉）'),
          criterionSources.authorityText);
        const stripped = frontendCriterionRedirectProblems({
          ...criterionSources,
          authorityText: strippedText,
        });
        assertTrue(stripped.some((problem) => problem.includes('未陈述结构形态')),
          '权威处抽掉结构形态组「' + group.join(' / ') + '」未被判违规: ' + JSON.stringify(stripped));
      }
      const criterionBlock = frontendCriterionAuthorityBlock(criterionSources.authorityText);
      assertTrue(criterionBlock !== null, '权威口径段切片为空（缺「结构形态」三种任一 → 仍判前端 的整段）');
      const copied = frontendCriterionRedirectProblems({
        ...criterionSources,
        docs: new Map(criterionSources.docs).set('flow-comet-design/SKILL.md',
          criterionSources.docs.get('flow-comet-design/SKILL.md') + '\n' + criterionBlock + '\n'),
      });
      assertTrue(copied.some((problem) => problem.includes('第二份正文')),
        '权威口径段复制进第二册未被判违规: ' + JSON.stringify(copied));
      const pointerStripped = frontendCriterionRedirectProblems({
        ...criterionSources,
        pointerDocs: new Map([...criterionSources.pointerDocs].map(([rel, text]) => [rel,
          text.split('唯一权威').join('（反向构造：抽掉指针）')])),
      });
      assertTrue(pointerStripped.some((problem) => problem.includes('指针不在场')),
        '抽掉各册指针未被判违规: ' + JSON.stringify(pointerStripped));
      // 行为口径的散文锚：非前端可见跳过 + 旧 change 渐进（与 285 的行为断言同源）
      const uiDesignSkill = fs.readFileSync(texts['flow-comet-ui-design/SKILL.md'], 'utf8');
      assertTrue(uiDesignSkill.includes('UI-DESIGN: skipped（非前端）'), 'ui-design 技能缺非前端跳过口径');
      assertTrue(uiDesignSkill.includes('旧 change') && uiDesignSkill.includes('WARN'),
        'ui-design 技能缺旧 change 渐进口径');
    },
  },

  // 287: 真实 `init` 跨 change 的 evolve 基线保留——`last_evolve_at` 与 `last_intel_scan` 同形
  // （两者都是**项目级**字段：换 change 不该丢）。场景 278/279 的窗口与到期锚全用 `writeState` 直注
  // （覆盖缺口：那条旁路绕开了 init 的保留清单，本缺陷因此完整逃过 286+90）；
  // 本场景**全程只走真实 `init` 子命令**，证明的是「跨 change 持久性」这条正常路径：
  //   设基线 → init 新 change → 基线仍在 + `status` 的 EVOLVE-DUE 仍生效 + `evolve scan` 窗口仍按基线过滤。
  // 断言面刻意覆盖 C1 的全部三条后果（字段丢失 / 到期提示消失 / 窗口静默退化为全量）。
  {
    name: '287 真实 init 跨 change：last_evolve_at 保留（基线在场·到期提示仍生效·扫描窗口仍过滤）',
    run: (dir) => {
      const formatStamp = requireModuleExport(timeUtilsModule, 'formatLocalTimestamp', 'time-utils.mjs');
      const formatDate = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs');
      const dayMs = 24 * 60 * 60 * 1000;
      const dateDaysAgo = (days) => formatDate(new Date(Date.now() - days * dayMs));
      // 窗口两侧各一条带 §9 的归档 change（窗口过滤按目录名日期前缀判定，基线落在两者之间）
      writeFile(dir, '.specs/archive/' + dateDaysAgo(101) + '-before-baseline/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n- 窗口外条目\n');
      writeFile(dir, '.specs/archive/' + dateDaysAgo(99) + '-after-baseline/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n- 窗口内条目\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());

      // ① 真实 init 建首个 change → 经**唯一写通道**落基线（100 天前：到期判据按天数必然触发）
      assertExit(runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-skip']), 0);
      const baseline = formatStamp(new Date(Date.now() - 100 * dayMs));
      const setRes = runStateWithProtocol(dir, ['config', 'set', 'last_evolve_at', baseline]);
      assertExit(setRes, 0);
      assertOut(setRes, 'CONFIG: last_evolve_at = ' + baseline);

      // ② 真实 init 换 change——跨 change 的全部动作就是这一步（不碰 writeState）
      const secondInit = runStateWithProtocol(dir, ['init', CHANGE_ID + '-2', '--init-skip']);
      assertExit(secondInit, 0);
      const state = JSON.parse(readStateBytes(dir));
      assertEqual(state.activeChange, CHANGE_ID + '-2', 'init 后 activeChange');
      assertEqual(state.last_evolve_at, baseline, 'init 跨 change 保留 last_evolve_at');

      // ③ 到期提示仍生效（AC-18 的跨 change 形态）+ 提示行在场时 status 的 JSON 块仍可解析
      const status = runStateWithProtocol(dir, ['status']);
      assertExit(status, 0);
      assertOut(status, 'EVOLVE-DUE: 上次架构沉淀 ' + baseline);
      assertOut(status, '超阈值 60 天');
      assertEqual(parseStatusJson(status).status, 'running', '提示行在场时 status 的 JSON 块解析');

      // ④ 增量窗口仍按基线过滤（AC-4 的跨 change 形态）：窗口内入选、窗口外排除，
      //    且**不**退回「无基线（首次运行，全量扫描）」——后者正是窗口静默退化为全量的形态
      const scan = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(scan, 0);
      assertOut(scan, '窗口 起始 = ' + baseline);
      assertOut(scan, '归档 2 个 · 窗口内 1 个 · 含沉淀段 1 个');
      assertOut(scan, 'after-baseline#1');
      assertNotOut(scan, 'before-baseline#');
      assertNotOut(scan, '无基线（首次运行，全量扫描）');
    },
  },

  // 288: ui-design 工件门按协议绑定键控（负例面：协议删掉绑定）——闸门开关由协议里的 binding
  // 表达（在场 ∧ 等级 = guarded），门禁侧只复用同一登记表 / requiredSkillCalls 查询，不存在第二份
  // 键表。四类：负例（删绑定 → 门随绑定退场，且留可见「门未启用」行，不静默消失）/ 正例（绑定在
  // 场且 guarded → 前端缺件仍 BLOCKED，键控未误伤既有语义）/ 越界（绑定缺席时 design 的另一
  // guarded 绑定仍由出口自动补写——其它绑定路径逐字不变）/ 恢复（协议写回 guarded 绑定 → 门重新
  // 拦住，键控是活判据不是一次性快照）。
  {
    name: '288 ui-design 门按协议绑定键控：删绑定门退场（可见行）/ 在场仍拦 / 其它绑定零改动 / 写回即恢复',
    run: (dir) => {
      // 负例：协议删掉该绑定 → 前端判据成立且缺件也不再拦（门随绑定退场）
      writeUiDesignBindingVariant(dir, 'absent');
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: true,
      });
      const absent = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(absent, 0);
      assertOut(absent, 'ALL CHECKS PASSED');
      assertOut(absent, 'UI-DESIGN: 门未启用（协议 design 节点未登记 flow-comet-ui-design 绑定）');
      assertNotOut(absent, 'BLOCKED');
      assertNotOut(absent, 'UI-DESIGN: skipped');

      // 越界：绑定缺席时 design 的另一 guarded 绑定（flow-comet-design）仍由出口自动补写——
      // 零真实声明也放行，证明自动补语义只在登记表命中的绑定上改道
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: false, declareDesign: false,
      });
      const otherBindings = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(otherBindings, 0);
      assertOut(otherBindings, 'ALL CHECKS PASSED');

      // 正例：协议写回 guarded 绑定 → 同一夹具、同一 change 立刻恢复拦截（与既有语义逐字一致）
      writeUiDesignBindingVariant(dir, 'guarded');
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: true,
      });
      const guardedInPlace = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(guardedInPlace, 1);
      assertOut(guardedInPlace, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertNotOut(guardedInPlace, 'UI-DESIGN: 门未启用');

      // 恢复：补齐工件 + 真实声明 → 出口放行（恢复路径未被键控改动波及）
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: true,
      });
      const recovered = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(recovered, 0);
      assertOut(recovered, 'ALL CHECKS PASSED');
    },
  },

  // 289: ui-design 工件门按协议绑定键控（负例面：等级降回 advisory）——`enforcement` 是该门的单一
  // 表达处：等级非 guarded ⇒ 门不适用，且该绑定的出口自动补写回到未登记路径的原语义（声明照旧
  // 由出口代记）。四类：负例（advisory → 不再拦）/ 正例（写回 guarded → 仍拦）/ 越界（同一节点
  // 的另一绑定不受影响）/ 恢复（等级回到 guarded 即恢复拦截）。
  {
    name: '289 ui-design 门按协议等级键控：调回 advisory 不再拦且自动补写原语义 / 写回 guarded 即恢复',
    run: (dir) => {
      // 负例：等级调回 advisory → 缺工件 + 零真实声明也放行（自动补写保持原语义）
      writeUiDesignBindingVariant(dir, 'advisory');
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: false,
      });
      const advisory = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(advisory, 0);
      assertOut(advisory, 'ALL CHECKS PASSED');
      assertOut(advisory, 'UI-DESIGN: 门未启用（协议 design 绑定等级 = advisory，非 guarded）');
      assertNotOut(advisory, 'BLOCKED');
      assertNotOut(advisory, 'UI-DESIGN: skipped');

      // 越界：同一节点的另一 guarded 绑定零真实声明仍放行（自动补语义未被本次键控改道）
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: false, declareDesign: false,
      });
      const otherBindings = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(otherBindings, 0);
      assertOut(otherBindings, 'ALL CHECKS PASSED');

      // 正例：等级写回 guarded → 缺件与缺声明双拦截同时回来
      writeUiDesignBindingVariant(dir, 'guarded');
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: true,
      });
      const guardedInPlace = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(guardedInPlace, 1);
      assertOut(guardedInPlace, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertNotOut(guardedInPlace, 'UI-DESIGN: 门未启用');

      // 恢复：补齐工件 + 真实声明 → 放行
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: true,
      });
      const recovered = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(recovered, 0);
      assertOut(recovered, 'ALL CHECKS PASSED');
    },
  },

  // 290: 前端判据的负向标记是结构约束（不是裸子串）——三种结构形态（独立行 / 行首 / 字段值位）
  // 任一命中即判非前端并**回显命中片段**；自然句子与子维度字段里的标记词一律不关掉整道门。
  // 四类：负例（行首的「不适用于暗色主题」与结构形态的 `- 暗色主题：不适用` → 仍判前端，前端
  // 缺件照样 BLOCKED）/ 正例（独立行带括注、行首带理由、字段值位三种形态可见跳过并回显片段）/
  // 越界（段外独立行不参与判据，判据限段内）/ 恢复（改段即放行）。
  {
    name: '290 负向标记结构约束：独立行·行首·字段值位跳过并回显片段 / 自然句子·子维度字段·段外标记不关闸',
    run: (dir) => {
      // 负例：自然句子（标记词在行首且后接「于」，句内再出现一次）→ 判据仍是前端 ⇒ 缺件 BLOCKED
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_NATURAL_SENTENCE, uiDesign: false, declareUiDesign: true,
      });
      const naturalSentence = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(naturalSentence, 1);
      assertOut(naturalSentence, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertNotOut(naturalSentence, 'UI-DESIGN: skipped');
      assertNotOut(naturalSentence, '命中片段');

      // 负例（结构形态的越界面）：子维度字段 `- 暗色主题：不适用` 是结构形态但主体不是本 change
      // 的适用性 ⇒ 仍判前端（标签表把可误伤的字段形态挡在外面）
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_SUBDIMENSION_FIELD, uiDesign: false, declareUiDesign: true,
      });
      const subDimensionField = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(subDimensionField, 1);
      assertOut(subDimensionField, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertNotOut(subDimensionField, 'UI-DESIGN: skipped');

      // 越界：标记出现在「视觉调性」段之外的独立行 → 不参与判据（判据限段内）
      writeDesignExitFixture(dir, {
        newChange: true,
        visualTone: VISUAL_TONE_APPLICABLE,
        changeTail: '\n## 范围排除（Out of Scope）\n\n不适用。\n',
        uiDesign: false,
        declareUiDesign: true,
      });
      const outsideSection = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(outsideSection, 1);
      assertOut(outsideSection, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertNotOut(outsideSection, 'UI-DESIGN: skipped');

      // 正例 A：独立行（带括注理由）→ 可见跳过 + 回显命中片段
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_NOT_APPLICABLE, uiDesign: false, declareUiDesign: false,
      });
      const standalone = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(standalone, 0);
      assertOut(standalone, 'UI-DESIGN: skipped（非前端）');
      assertOut(standalone, '命中片段: 不适用（非前端项目）。');
      assertNotOut(standalone, 'BLOCKED');

      // 正例 B：字段值位（`- 适用性：不适用（…）`）→ 同样判非前端（结构形态之二，非行首）
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_FIELD_MARKER, uiDesign: false, declareUiDesign: false,
      });
      const fieldValue = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(fieldValue, 0);
      assertOut(fieldValue, 'UI-DESIGN: skipped（非前端）');
      assertOut(fieldValue, '命中片段: - 适用性：不适用（CLI 工具，无用户可见界面）');
      assertNotOut(fieldValue, 'BLOCKED');

      // 正例 C：行首形态（标记 + 破折号理由，非独立行）→ 同样判非前端
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_LINE_HEAD_MARKER, uiDesign: false, declareUiDesign: false,
      });
      const lineHead = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(lineHead, 0);
      assertOut(lineHead, 'UI-DESIGN: skipped（非前端）');
      assertOut(lineHead, '命中片段: 不适用 —— CLI 工具，无用户可见界面。');
      assertNotOut(lineHead, 'BLOCKED');

      // 恢复：把调性段改成结构形态（标注路径）→ 同一 change 放行，命中片段一并回显
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_NOT_APPLICABLE, uiDesign: false, declareUiDesign: false,
      });
      const recovered = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(recovered, 0);
      assertOut(recovered, 'UI-DESIGN: skipped（非前端）');
      assertOut(recovered, '命中片段: 不适用（非前端项目）。');
    },
  },

  // 291: 原子写单一来源——「同目录固定 `.tmp` + rename + 失败清理」惯用法在收敛面（状态 / 侧命令 /
  // handoff 的写盘脚本 + 单源模块）内恰一处实现（落点 = 既有单源模块 state-schema.mjs），三个侧命令
  // 与 handoff 的 state 直写一律消费同一导出、零内联。判别力两条：① 具名导出被真实消费（import +
  // 调用，不是纯文本存在性）；② **合成目录反向构造**——把第二份实现丢进合成引擎目录，检出数必须
  // 从 1 变 2（证明检出不恒真空过）。guard 的受保护写入按边界锚显式排除，不静默跳过。
  {
    name: '291 原子写单一来源：收敛面内一处实现 + 四消费方零内联 + 合成反向构造判别力',
    run: async () => {
      // ① 惯用法唯一实现（收敛面 = 本任务写边界内的写盘脚本 + 单源模块）
      const idiom = atomicWriteIdiomHits(SCRIPTS_DIR, ATOMIC_WRITE_CONVERGENCE_FACE);
      assertEqual(idiom.length, 1, '原子写惯用法实现面（收敛面内应恰 1 处）实际 ' + JSON.stringify(idiom));
      assertEqual(idiom[0].file, 'state-schema.mjs', '原子写惯用法落点文件');
      assertEqual(idiom[0].count, 1, 'state-schema.mjs 内惯用法处数');

      // ①b 边界锚（可见，不静默排除）：guard 的受保护写入是独立安全硬化通道——唯一临时名 + 快照
      // 复核；形态一旦退回「固定 `<目标>.tmp`」惯用法即变红，强制重新评估它是否落回收敛面。
      const guardText = fs.readFileSync(path.join(SCRIPTS_DIR, 'workflow-guard.mjs'), 'utf8');
      assertTrue(guardText.includes('String(process.pid)') && /Math\.random\(\)\.toString\(16\)/.test(guardText),
        'workflow-guard 的受保护写入不再是「唯一临时名」硬化通道——须重新评估原子写收敛面');
      assertTrue(hasNamedImport(guardText, './state-schema.mjs', 'RUNTIME_STATE_PATH'),
        'workflow-guard 未从 state-schema.mjs import 运行时路径常量（单源关系被破坏，收敛面须重评）');

      // ② 具名导出唯一定义 + 行为可用（落盘、无临时残留、失败路径 fail-closed）
      const writeAtomic = requireModuleExport(stateSchemaModule, 'writeFileAtomic', 'state-schema.mjs');
      const definition = engineDefinitionHits('writeFileAtomic');
      assertEqual(definition.length, 1, 'writeFileAtomic 定义面（全引擎应恰 1 处）实际 ' + JSON.stringify(definition));
      assertEqual(definition[0].file, 'state-schema.mjs', 'writeFileAtomic 定义文件');
      const probe = makeTmp();
      try {
        const target = path.join(probe, 'nested', 'out.json');
        await writeAtomic(target, '{"ok":true}\n');
        assertEqual(fs.readFileSync(target, 'utf8'), '{"ok":true}\n', '原子写落盘内容');
        assertTrue(!fs.existsSync(target + '.tmp'), '原子写成功路径不得残留临时文件');
        const blocked = path.join(probe, 'blocked.txt');
        fs.mkdirSync(blocked + '.tmp');
        let thrown = null;
        try { await writeAtomic(blocked, '半写'); } catch (e) { thrown = e; }
        assertTrue(thrown !== null, '临时路径被占用时原子写必须抛错（fail-closed）');
        assertTrue(!fs.existsSync(blocked), '失败路径不得留下半写目标文件');
      } finally {
        cleanupTmpDir(probe);
      }

      // ③ 四个消费方：具名 import 自 state-schema.mjs + 真实调用 + 零内联第二份实现
      const consumers = {
        'workflow-state.mjs': 'writeJsonAtomic',
        'workflow-handoff.mjs': 'writeJsonAtomic',
        'evolve.mjs': 'writeFileAtomic',
        'context-scan.mjs': 'writeJsonAtomic',
      };
      for (const [file, symbol] of Object.entries(consumers)) {
        const text = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
        assertTrue(hasNamedImport(text, './state-schema.mjs', symbol),
          file + ' 未从 state-schema.mjs import ' + symbol + '（单源纪律：写盘不得在本脚本内联第二份）');
        assertTrue(text.includes(symbol + '('), file + ' 未真实消费 ' + symbol + '（单一权威应被调用）');
        const inline = (text.match(ATOMIC_TEMP_SUFFIX_RE) ?? []).length;
        assertEqual(inline, 0, file + ' 仍内联原子写惯用法（第二份实现）处数');
      }

      // ④ 反向构造：合成引擎目录（单文件 1 处 → 检出 1；再放第二份实现 → 检出 2）——
      // 证明③的判据确实会因第二份实现变红，而非恒真空过。
      const synthetic = makeTmp();
      try {
        writeFile(synthetic, 'single.mjs',
          "export async function duplicateWriter(file, text) {\n"
          + "  const temporary = file + '.tmp';\n"
          + '  await fs.writeFile(temporary, text);\n'
          + '  await fs.rename(temporary, file);\n'
          + '}\n');
        assertEqual(atomicWriteIdiomHits(synthetic).length, 1, '合成目录单实现检出数');
        writeFile(synthetic, 'second.mjs',
          "async function anotherWriter(file, text) {\n"
          + "  const temporary = file + '.tmp';\n"
          + '  await fs.writeFile(temporary, text);\n'
          + '  await fs.rename(temporary, file);\n'
          + '}\n');
        assertEqual(atomicWriteIdiomHits(synthetic).length, 2, '合成目录第二份实现检出数（判据须变红）');
      } finally {
        cleanupTmpDir(synthetic);
      }
    },
  },

  // 292: evolve 元数据字段面单一来源——`## evolve 元数据` 的段名与三字段名在 state-schema.mjs
  // 唯一导出，写方（evolve）与校验方（context-init）同源消费、零内联字面量；容差收窄到单形：
  // 无生产者的旧别名「下次同步建议」不再被静默接受，而是**可见**的格式提示（点名旧别名 + 应改
  // 写的字段名）。写→校一致性用真实链路：evolve apply 生成的段必须零格式问题通过校验。
  {
    name: '292 evolve 元数据单一来源：常量集唯一导出·写校同源·旧别名收窄为可见提示',
    run: async (dir) => {
      // ① 常量集唯一导出 + 取值单形（去掉无生产者的旧别名是**取值**层面的收窄）
      for (const name of ['EVOLVE_METADATA_SECTION', 'EVOLVE_METADATA_FIELDS']) {
        const hits = engineDefinitionHits(name);
        assertEqual(hits.length, 1, name + ' 定义面（全引擎应恰 1 处）实际 ' + JSON.stringify(hits));
        assertEqual(hits[0].file, 'state-schema.mjs', name + ' 定义文件');
      }
      const section = requireModuleExport(stateSchemaModule, 'EVOLVE_METADATA_SECTION', 'state-schema.mjs');
      const fields = requireModuleExport(stateSchemaModule, 'EVOLVE_METADATA_FIELDS', 'state-schema.mjs');
      assertEqual(section, 'evolve 元数据', '段名常量取值');
      assertEqual(fields.join(','), ['last_evolve_at', 'scanner', '下次建议'].join(','), '三字段常量取值');

      // ② 写方与校验方同源消费 + 零内联字面量（第二份表达即变红）
      for (const file of ['evolve.mjs', 'context-init.mjs']) {
        const text = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
        assertTrue(hasNamedImport(text, './state-schema.mjs', 'EVOLVE_METADATA_SECTION'),
          file + ' 未从 state-schema.mjs import 段名常量');
        assertTrue(text.includes('EVOLVE_METADATA_FIELDS'), file + ' 未消费字段常量集');
        assertTrue(!/'evolve 元数据'/.test(text), file + ' 仍内联段名字面量（第二份表达）');
        assertTrue(!/'下次建议'/.test(text), file + ' 仍内联第三字段字面量（第二份表达）');
      }

      // ③ 写→校一致性（真实链路）：evolve apply 产出的段必须被校验方无问题接收
      writeFile(dir, '.specs/archive/2026-10-02-fixture/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 夹具抽象条目（元数据单一来源）\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));
      const apply = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-fixture#1', '--root', dir], dir);
      assertExit(apply, 0);
      assertOut(apply, 'EVOLVE-OK');
      const written = fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      for (const field of fields) {
        assertTrue(written.includes('**' + field + '**'), '写方产出的段缺字段 ' + field);
      }
      const validate = requireModuleExport(contextInitModule, 'validateContext', 'context-init.mjs');
      const consistent = await validate(dir);
      assertEqual(consistent.missingSections.length, 0,
        '夹具七段骨架缺段: ' + JSON.stringify(consistent.missingSections));
      assertEqual(consistent.formatIssues.length, 0,
        '写方产物未通过校验方（同源失配）: ' + JSON.stringify(consistent.formatIssues));

      // ④ 容差收窄判别力：旧别名顶替第三字段 → 必报，且提示点名旧别名与应写字段（可见，不静默）
      const aliased = contextFixtureText({ evolveSection: [
        '- **' + fields[0] + '**: `2026-10-02T10:00:00+08:00`',
        '- **' + fields[1] + '**: `flow-comet-evolve`',
        '- **下次同步建议**: 约 60 天后',
      ] });
      writeFile(dir, '.specs/CONTEXT.md', aliased);
      const aliasedIssues = (await validate(dir)).formatIssues;
      assertTrue(aliasedIssues.some((issue) => issue.includes('evolve 元数据三字段')),
        '旧别名未被收窄（仍静默通过）: ' + JSON.stringify(aliasedIssues));
      assertTrue(aliasedIssues.some((issue) => issue.includes('下次同步建议') && issue.includes('不再接受')),
        '旧别名未给出可见格式提示: ' + JSON.stringify(aliasedIssues));
    },
  },

  // 293: 侧命令 CLI 契约——三条横向命令的 `--root` 两种形态 / `--stdout` / `--help` /
  // 未知参数走**同一份**共享助手：等号形三命令一致（修复前 evolve 报「未知参数: --root=.」exit 1）、
  // `--help`/`-h` 三命令一致（修复前只有 health 有）、空格形与未知参数的退出码语义保持不变；
  // 位置参数语义由各命令自持（evolve 的 scan/apply 子命令与候选 id）。结构锚：带引号的 `--root`
  // 解析形态与「未知参数」构造在三条命令里**只允许出现在共享助手一处**，第二份自写脚手架即红。
  {
    name: '293 侧命令 CLI 契约：--root 两形态·--stdout·--help 三命令同形 + 未知参数语义不变 + 解析面单源',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-10-02-cli/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- CLI 契约夹具条目\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      // ① 等号形 `--root=<目录>`：三命令等价（修复前 evolve 是唯一不支持的一条）
      const evolveEq = runSideScript(SIDE_EVOLVE, ['scan', '--root=' + dir], dir);
      assertExit(evolveEq, 0);
      assertOut(evolveEq, 'EVOLVE: 窗口');
      assertOut(evolveEq, '2026-10-02-cli#1');
      const healthEq = runSideScript(SIDE_HEALTH, ['--root=' + dir, '--stdout'], dir);
      assertExit(healthEq, 0);
      assertOut(healthEq, '## 确定性层（机器可判）');
      const scanEq = runSideScript(SIDE_CONTEXT_SCAN, ['--root=' + dir], dir);
      assertExit(scanEq, 0);
      assertOut(scanEq, 'CONTEXT-SCAN-DONE');

      // ② 空格形 `--root <目录>`：向后兼容（三命令语义不变）
      const evolveSpace = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(evolveSpace, 0);
      assertOut(evolveSpace, 'EVOLVE: 窗口');
      const healthSpace = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(healthSpace, 0);
      assertOut(healthSpace, '## 确定性层（机器可判）');
      const scanSpace = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(scanSpace, 0);
      assertOut(scanSpace, 'CONTEXT-SCAN-DONE');

      // ③ `--help` / `-h`：三命令一律打印**自己的**用法后 exit 0（用法里各自列出自身命令形态）
      const helpCases = [
        { args: ['--help'], keywords: ['evolve.mjs scan', 'evolve.mjs apply', '--stdout'] },
        { args: ['-h'], keywords: ['health.mjs', '--root', '--stdout'] },
        { args: ['--help'], keywords: ['context-scan.mjs', '--root', '--stdout'] },
      ];
      const helpScripts = [SIDE_EVOLVE, SIDE_HEALTH, SIDE_CONTEXT_SCAN];
      for (let i = 0; i < helpScripts.length; i += 1) {
        const res = runSideScript(helpScripts[i], helpCases[i].args, dir);
        assertExit(res, 0);
        for (const keyword of helpCases[i].keywords) assertOut(res, keyword);
      }
      // 子命令之后的 `--help` 同样短路（不因缺候选 id 报用法错误）
      const applyHelp = runSideScript(SIDE_EVOLVE, ['apply', '--help'], dir);
      assertExit(applyHelp, 0);
      assertOut(applyHelp, 'evolve.mjs apply');
      // `--stdout` 三命令均被接受（evolve 的 scan 本就全量输出到标准输出）
      assertExit(runSideScript(SIDE_EVOLVE, ['scan', '--stdout', '--root', dir], dir), 0);
      // evolve 的 `--stdout` 语义 = 本次追加进报告的内容原样输出（与落盘块逐字节相同）；
      // 命令自有取值开关的等号形同样走共享助手（`--scanner=<文本>`）
      const applyOut = runSideScript(SIDE_EVOLVE,
        ['apply', '2026-10-02-cli#1', '--root', dir, '--stdout', '--scanner=契约夹具扫描器'], dir);
      assertExit(applyOut, 0);
      assertOut(applyOut, 'EVOLVE-OK');
      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const evolveReport = fs.readFileSync(path.join(dir, '.specs', 'evolve', today + '-EVOLVE.md'), 'utf8');
      assertTrue(applyOut.output.includes(evolveReport),
        '--stdout 输出应与落盘报告块逐字节一致（stdout 与文件各自渲染即漂移）');
      assertTrue(fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8').includes('契约夹具扫描器'),
        '命令自有取值开关（--scanner=<文本>）未生效');

      // ④ 未知参数：三命令一律 exit 1 且点名该词元（既有退出码语义不变）
      for (const script of helpScripts) {
        const unknown = runSideScript(script, ['--bogus'], dir);
        assertExit(unknown, 1);
        assertOut(unknown, '未知参数: --bogus');
      }
      // 位置参数语义按命令自持：evolve 的 scan 拒位置参数、apply 缺候选 id 仍报用法错误
      const scanExtra = runSideScript(SIDE_EVOLVE, ['scan', 'extra'], dir);
      assertExit(scanExtra, 1);
      assertOut(scanExtra, 'scan 不接受位置参数: extra');
      const applyEmpty = runSideScript(SIDE_EVOLVE, ['apply', '--root', dir], dir);
      assertExit(applyEmpty, 1);
      assertOut(applyEmpty, 'apply 需要至少一个候选 id');
      // 取值开关悬空 → 用法错误（三命令同一文案、同一退出码）
      for (const script of helpScripts) {
        const dangling = runSideScript(script, ['--root'], dir);
        assertExit(dangling, 1);
        assertOut(dangling, '--root 需要一个目录参数');
      }

      // ⑤ 结构锚：解析形态只此一处（共享助手）；两个消费方具名 import + 真实调用
      const parseFace = new Map(helpScripts.map((script) => [path.basename(script), fs.readFileSync(script, 'utf8')]));
      const rootTokenFiles = [...parseFace].filter(([, text]) => text.includes("'--root'")).map(([file]) => file);
      assertEqual(rootTokenFiles.join(','), 'evolve.mjs',
        '带引号的 `--root` 解析形态应只出现在共享助手一处（实际: ' + (rootTokenFiles.join(',') || '无') + '）');
      const unknownTokenFiles = [...parseFace].filter(([, text]) => text.includes('未知参数: ')).map(([file]) => file);
      assertEqual(unknownTokenFiles.join(','), 'evolve.mjs',
        '「未知参数」构造应只出现在共享助手一处（实际: ' + (unknownTokenFiles.join(',') || '无') + '）');
      for (const file of ['health.mjs', 'context-scan.mjs']) {
        const text = parseFace.get(file);
        assertTrue(hasNamedImport(text, './evolve.mjs', 'parseSideCommandArgs'),
          file + ' 未从共享助手模块具名 import parseSideCommandArgs（第二份脚手架或未接线）');
        assertTrue(text.includes('parseSideCommandArgs('), file + ' 未真实调用共享助手');
      }
    },
  },

  // 294: 损坏 state 的 fail-closed 与「首次运行」口径收窄 + 协议路径单源——
  // ① state 文件在场但不可解析（含顶层非对象）→ `evolve scan` BLOCKED 且零写入，不再谎称
  //    「无基线（首次运行，全量扫描）」把增量窗口静默退化为全量；② 「首次运行」只限
  //    「state 可读且字段缺席」，state 不在场另有措辞（不冒充首次运行）；③ 协议路径走
  //    state-schema 的唯一选择器：state.protocolPath 绑定**独占**（项目内约定副本坏掉也必须成功、
  //    绑定本身坏掉也不回退候选布局），本模块零候选布局表。
  {
    name: '294 损坏 state fail-closed：scan/apply BLOCKED 零写入·首次运行口径收窄 + 协议路径走单源选择器',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-10-02-state/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 状态口径夹具条目\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      const stateFile = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      writeState(dir, baseState('open'));

      // ① state 不在场：显式点名「state 不在场」，不冒充「首次运行」（全量扫描仍可用）
      fs.rmSync(stateFile);
      const noState = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(noState, 0);
      assertOut(noState, 'state 不在场');
      assertNotOut(noState, '无基线（首次运行，全量扫描）');

      // ② state 可读且字段缺席 = 唯一的「首次运行」口径（全量扫描）
      writeState(dir, baseState('open'));
      const firstRun = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(firstRun, 0);
      assertOut(firstRun, '无基线（首次运行，全量扫描）');
      assertOut(firstRun, '窗口内 1 个');

      // ③ 损坏 state（JSON 截断）：fail-closed —— BLOCKED + 零写入，不再退化成全量扫描
      const stateText = fs.readFileSync(stateFile, 'utf8');
      const truncated = stateText.slice(0, Math.max(1, Math.floor(stateText.length / 2)));
      fs.writeFileSync(stateFile, truncated, 'utf8');
      const damagedBytes = readStateBytes(dir);
      const before = treeFingerprint(dir);
      const blocked = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, '无法解析');
      assertNotOut(blocked, '首次运行');
      assertNotOut(blocked, '候选清单');
      assertEqual(readStateBytes(dir), damagedBytes, '损坏 state 的 scan 轮改写了 state');
      assertEqual(fingerprintChanges(before, treeFingerprint(dir)).join(' | '), '',
        '损坏 state 的 scan 轮有写入');

      // ④ 顶层非对象（数组）同样判「不可信」——不得冒充「字段缺席」
      fs.writeFileSync(stateFile, '[]\n', 'utf8');
      const arrayState = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(arrayState, 1);
      assertOut(arrayState, 'BLOCKED');
      assertOut(arrayState, '无法解析');

      // ⑤ 损坏态下 apply 同样 fail-closed：目标文档 / 报告 / state 三处零改动
      fs.writeFileSync(stateFile, truncated, 'utf8');
      const contextBefore = fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      const applyBlocked = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-state#1', '--root', dir], dir);
      assertExit(applyBlocked, 1);
      assertOut(applyBlocked, 'BLOCKED');
      assertEqual(fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8'), contextBefore,
        '损坏 state 的 apply 轮改写了目标文档');
      assertTrue(!fs.existsSync(path.join(dir, '.specs', 'evolve')), '损坏 state 的 apply 轮落了报告');

      // ⑥ 协议路径单源：state.protocolPath 绑定独占——项目内约定副本坏掉，绑定好 → 必须成功
      //   （修复前的候选布局表先命中 <根>/reference/workflow-protocol.json → 子进程按坏协议 BLOCK）
      writeFile(dir, '.specs/archive/2026-10-02-proto/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 协议绑定夹具条目\n');
      fs.writeFileSync(path.join(dir, 'reference', 'workflow-protocol.json'),
        '{"schemaVersion": 99, "nodes": []}\n', 'utf8');
      fs.copyFileSync(SKILL_PROTOCOL_FILE, path.join(dir, 'bound-protocol.json'));
      writeState(dir, { ...baseState('open'), protocolPath: 'bound-protocol.json' });
      const bound = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-proto#1', '--root', dir], dir,
        { FLOW_COMET_PROTOCOL: '' });
      assertExit(bound, 0);
      assertOut(bound, 'EVOLVE-OK');
      assertTrue(fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8').includes('协议绑定夹具条目'),
        '状态绑定协议下的 apply 未落盘条目');

      // ⑦ 绑定本身坏掉 → fail-closed 可见（不回退项目内约定副本），指引指向绑定修正
      fs.copyFileSync(SKILL_PROTOCOL_FILE, path.join(dir, 'reference', 'workflow-protocol.json'));
      fs.writeFileSync(path.join(dir, 'broken-protocol.json'), '{"schemaVersion": 99, "nodes": []}\n', 'utf8');
      writeState(dir, { ...baseState('open'), protocolPath: 'broken-protocol.json' });
      const brokenBytes = readStateBytes(dir);
      const broken = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-proto#1', '--root', dir], dir,
        { FLOW_COMET_PROTOCOL: '' });
      assertExit(broken, 1);
      assertOut(broken, 'state 写入通道失败');
      assertOut(broken, 'state.protocolPath');
      assertEqual(readStateBytes(dir), brokenBytes, '绑定损坏的 apply 轮改写了 state');

      // ⑧ 写入前先验 state 通道（协议闸门）：通道排在文档之后，不预验就有半成品——候选**未应用过**
      //   （目标文档必然会被改写），绑定指向 schema 非法的根内副本 ⇒ 必须零文档改动、零报告、零 state。
      const halfRoot = path.join(dir, 'half-write');
      writeFile(halfRoot, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(halfRoot, '.specs/archive/2026-10-02-half/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 半成品夹具条目\n');
      fs.writeFileSync(path.join(halfRoot, 'broken-protocol.json'), '{"schemaVersion": 99, "nodes": []}\n', 'utf8');
      writeState(halfRoot, { ...baseState('open'), protocolPath: 'broken-protocol.json' });
      const halfContextBefore = fs.readFileSync(path.join(halfRoot, '.specs', 'CONTEXT.md'));
      const halfStateBefore = readStateBytes(halfRoot);
      const half = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-half#1', '--root', halfRoot], halfRoot,
        { FLOW_COMET_PROTOCOL: '' });
      assertExit(half, 1);
      assertOut(half, 'state 写入通道失败');
      assertOut(half, 'state.protocolPath');
      assertTrue(fs.readFileSync(path.join(halfRoot, '.specs', 'CONTEXT.md')).equals(halfContextBefore),
        'state 通道不可用的 apply 轮改写了目标文档（写入前未验通道 ⇒ 半成品）');
      assertStateBytesUnchanged(halfRoot, halfStateBefore, 'state 通道不可用的 apply 轮');
      assertTrue(!fs.existsSync(path.join(halfRoot, '.specs', 'evolve')),
        'state 通道不可用的 apply 轮落了报告');

      // ⑨ 第二条确定性闸门（state 字段非法）同样必须在文档写入之前拦下——通道预验不能只验协议。
      //   协议经 state.protocolPath 绑到根内合法副本（这一格只考字段闸门，不考协议闸门）。
      const fieldRoot = path.join(dir, 'half-write-field');
      writeFile(fieldRoot, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(fieldRoot, '.specs/archive/2026-10-02-field/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 字段闸门夹具条目\n');
      fs.mkdirSync(path.join(fieldRoot, 'reference'), { recursive: true });
      fs.copyFileSync(SKILL_PROTOCOL_FILE, path.join(fieldRoot, 'reference', 'workflow-protocol.json'));
      writeState(fieldRoot, {
        ...baseState('open'), executionMode: 'not-a-mode', protocolPath: 'reference/workflow-protocol.json',
      });
      const fieldContextBefore = fs.readFileSync(path.join(fieldRoot, '.specs', 'CONTEXT.md'));
      const fieldStateBefore = readStateBytes(fieldRoot);
      const fieldGate = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-field#1', '--root', fieldRoot], fieldRoot,
        { FLOW_COMET_PROTOCOL: '' });
      assertExit(fieldGate, 1);
      assertOut(fieldGate, 'state 写入通道失败');
      assertOut(fieldGate, 'executionMode');
      assertTrue(fs.readFileSync(path.join(fieldRoot, '.specs', 'CONTEXT.md')).equals(fieldContextBefore),
        'state 字段非法的一轮改写了目标文档（写入前未验字段闸门 ⇒ 半成品）');
      assertStateBytesUnchanged(fieldRoot, fieldStateBefore, 'state 字段非法的 apply 轮');

      // ⑩ 结构锚：本模块不再自持候选布局表；协议路径只经 state-schema 的唯一导出选择；
      //    state 三态读入口两条侧命令共用一个实现（第二份内联即红）
      const evolveText = fs.readFileSync(SIDE_EVOLVE, 'utf8');
      assertTrue(hasNamedImport(evolveText, './state-schema.mjs', 'resolveProtocolPathWithState'),
        'evolve.mjs 未从 state-schema.mjs 具名 import 协议路径选择器');
      assertTrue(evolveText.includes('resolveProtocolPathWithState('), 'evolve.mjs 未真实调用协议路径选择器');
      assertTrue(!evolveText.includes("'reference', 'workflow-protocol.json'"),
        'evolve.mjs 仍自持项目内约定副本候选（第二套「协议在哪」表达）');
      assertTrue(!evolveText.includes("'.flow-comet', 'skills'"),
        'evolve.mjs 仍自持权威源布局候选（第二套「协议在哪」表达）');
      const scanText = fs.readFileSync(SIDE_CONTEXT_SCAN, 'utf8');
      assertTrue(hasNamedImport(scanText, './evolve.mjs', 'readStateInfo'),
        'context-scan.mjs 未共用 state 三态读入口（第二份读盘实现）');
      assertTrue(scanText.includes('readStateInfo('), 'context-scan.mjs 未真实调用共用的 state 读入口');
      assertTrue(!/function\s+readStateFile\b/.test(scanText),
        'context-scan.mjs 仍保留本地 state 读实现（三态判定第二份表达）');
    },
  },
];
