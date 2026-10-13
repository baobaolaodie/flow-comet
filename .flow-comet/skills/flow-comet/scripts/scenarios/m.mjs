// 场景组 m — 侧命令边界与单一来源锚 · 文本锚与漂移判据
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  assertEqual,
  assertExit,
  assertNotOut,
  assertOut,
  assertTrue,
  baseState,
  cleanupTmpDir,
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
  contextInitModule,
  engineDefinitionHits,
  hasNamedImport,
  makeTmp,
  requireModuleExport,
  runSideScript,
  skillsRootForScriptsDir,
  sleepSync,
  stateSchemaModule,
  timeUtilsModule,
} from '../lib/test-fixtures.mjs';
import {
  assertStateBytesUnchanged,
  readStateBytes,
  runStateWithProtocol,
} from '../lib/test-assertions.mjs';
import {
  BACKUP_IMPL_FACE,
  BARE_ISO_ENGINE_WHITELIST,
  BARE_ISO_SIDE_COMMANDS,
  DATE_PREFIX_CONVERGENCE_FACE,
  INTEL_FIELD_SUFFIX,
  INTEL_FIELD_VALUE,
  OVERRIDE_FALLBACK_RE,
  TIME_DISCIPLINE_RULES,
  bareIsoTimestampHits,
  bareIsoWhitelistProblems,
  contextFixtureText,
  crlfLineViolations,
  datePrefixRegexpHits,
  deterministicReproProblems,
  evolveReportBulletProblems,
  healthReportFixture,
  healthReportWithSnapshot,
  inlineBackupHits,
  intelFieldToken,
  intelMetadataNameProblems,
  maintainerFacePresent,
  overrideDeclarationBlock,
  overrideDeclarationProblems,
  snapshotEntryCount,
  snapshotSectionOf,
  timeDisciplineTextProblems,
  upstreamArtifactPaths,
} from '../lib/text-anchor-checks.mjs';

export const ENTRIES = [

  // 295: health 基线日期判据单源——报告名的「日期前缀 + 日历自洽」判定收敛到 time-utils
  //（真实消费 `archiveDateFromName`），本模块不再自写前缀正则：日历不自洽的
  // `2026-02-30-HEALTH.md` 不再被采作基线（旧实现单独在场时直接采作基线、并输出看似有据的
  // ↑/↓ 趋势；与合法旧报告并存时又因「取排序最后一份」必然取到它）。判据面配**合成目录
  // 反向构造**：第二份前缀正则丢进合成引擎目录必须被检出（证明形态判据不恒真空过）。
  {
    name: '295 health 基线日期判据单源：日历不自洽前缀不入选·合法旧报告入选 + 零自写前缀正则',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      // ① 负例：前缀形态合法、日历不自洽（2026-02-30 不存在）——不得被采作基线。快照哨兵
      //    `lessons.entries=123456` 一旦出现在输出里，即证明这份报告被当成了基线。
      writeFile(dir, '.specs/health/2026-02-30-HEALTH.md', healthReportFixture('2026-02-30', 123456));
      const invalidOnly = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(invalidOnly, 0);
      assertOut(invalidOnly, '基线：无（`.specs/health` 下无日期不同的历史报告）');
      assertNotOut(invalidOnly, '2026-02-30-HEALTH.md');
      assertNotOut(invalidOnly, '123456');

      // ② 正例 + 越界：合法旧报告与日历不自洽者并存 → 取合法那份（日历不自洽的名字排序在后，
      //    旧实现「取最后一份」必然取到它 → 哨兵串成 123456 而非 999999）
      writeFile(dir, '.specs/health/2026-01-05-HEALTH.md', healthReportFixture('2026-01-05', 999999));
      const picked = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(picked, 0);
      assertOut(picked, '基线：`.specs/health/2026-01-05-HEALTH.md`');
      assertOut(picked, '`lessons.entries`：999999 → ');
      assertNotOut(picked, '2026-02-30-HEALTH.md');
      assertNotOut(picked, '123456');

      // ③ 结构锚：health 真实消费 time-utils 的日期判定；收敛面内只许 time-utils 表达该形态
      const healthText = fs.readFileSync(SIDE_HEALTH, 'utf8');
      assertTrue(hasNamedImport(healthText, './time-utils.mjs', 'archiveDateFromName'),
        'health.mjs 未从 time-utils.mjs 具名 import archiveDateFromName（日期判据第二份表达）');
      assertTrue(healthText.includes('archiveDateFromName('),
        'health.mjs 未真实消费 archiveDateFromName（单一权威应被调用）');
      const faceHits = datePrefixRegexpHits(SCRIPTS_DIR, DATE_PREFIX_CONVERGENCE_FACE);
      assertEqual(faceHits.length, 1, '日期前缀形态实现面（收敛面内应恰 1 处）实际 ' + JSON.stringify(faceHits));
      assertEqual(faceHits[0].file, 'time-utils.mjs', '日期前缀形态落点文件');

      // ③b 边界锚（可见，不静默排除）：guard 的两处日期匹配是文档**内容**里的日期条目匹配
      //（行锚 + `matchAll(.../gm)`），不是文件名前缀判定，且不在本任务写边界内——形态一旦
      // 改变即变红，强制重评收敛面。
      const guardText = fs.readFileSync(path.join(SCRIPTS_DIR, 'workflow-guard.mjs'), 'utf8');
      assertEqual((guardText.match(/matchAll\(\/\^[^\n]*\\d\{4\}-\\d\{2\}-\\d\{2\}[^\n]*\/gm\)/g) ?? []).length, 2,
        'workflow-guard 的日期匹配不再是「行锚 + 内容条目」两处形态——须重评日期前缀判据的收敛面');

      // ④ 反向构造：合成引擎目录（单份前缀正则 → 检出 1；再放第二份 → 检出 2）
      const synthetic = makeTmp();
      try {
        writeFile(synthetic, 'single.mjs', "const REPORT_DATE_PREFIX = /^(\\d{4}-\\d{2}-\\d{2})/;\n");
        assertEqual(datePrefixRegexpHits(synthetic).length, 1, '合成目录单实现检出数');
        writeFile(synthetic, 'second.mjs',
          "function reportDateOf(name) {\n  return /^(\\d{4}-\\d{2}-\\d{2})/.exec(name);\n}\n");
        assertEqual(datePrefixRegexpHits(synthetic).length, 2, '合成目录第二份实现检出数（判据须变红）');
      } finally {
        cleanupTmpDir(synthetic);
      }
    },
  },

  // 296: context-scan 改写 CONTEXT.md 前落备份——命名族（目标文档同目录 + `.bak-<本地日期>`）与
  // 失败处置由 state-schema.mjs 的共享助手单源提供（消费关系与零内联见场景 301）：备份内容 =
  // 改写前版本；同日重复改写只保留一份当日备份（同名覆盖，不堆积）；复制不成功时目标与 state
  // 逐字节不变（备份**先于**写入，不是事后补）。
  {
    name: '296 context-scan 改写前落备份：同形命名·内容为改写前版本·复制失败 fail-closed 零写入',
    run: (dir) => {
      const contextFile = path.join(dir, '.specs', 'CONTEXT.md');
      const original = contextFixtureText();
      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      writeFile(dir, '.specs/CONTEXT.md', original);
      writeState(dir, baseState('open'));

      // ① 改写落备份：同目录、命名族 `.bak-<日期>`、内容 = 改写前版本；双落点写入照常
      const first = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(first, 0);
      const backups = fs.readdirSync(path.join(dir, '.specs'))
        .filter((name) => /^CONTEXT\.md\.bak-\d{4}-\d{2}-\d{2}$/.test(name));
      assertEqual(backups.length, 1, '改写前的备份份数（应恰 1 份同目录 `.bak-<日期>`）实际 ' + JSON.stringify(backups));
      assertEqual(backups[0], 'CONTEXT.md.bak-' + today, '备份命名（应为改写当日的本地日期）');
      assertEqual(fs.readFileSync(path.join(dir, '.specs', backups[0]), 'utf8'), original, '备份内容应为改写前版本');
      assertTrue(fs.readFileSync(contextFile, 'utf8') !== original, 'CONTEXT.md 未被改写（夹具前提不成立）');

      // ② 同日再改写：同名覆盖——只保留一份当日备份，内容为该轮改写前版本（不堆积、链路不丢）
      const intermediate = contextFixtureText().replace('2026-09-01T10:00:00+08:00', '2026-09-02T10:00:00+08:00');
      writeFile(dir, '.specs/CONTEXT.md', intermediate);
      const second = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(second, 0);
      assertEqual(fs.readdirSync(path.join(dir, '.specs'))
        .filter((name) => name.startsWith('CONTEXT.md.bak-')).length, 1, '同日重复改写的当日备份份数');
      assertEqual(fs.readFileSync(path.join(dir, '.specs', backups[0]), 'utf8'), intermediate,
        '第二轮的备份内容应为该轮改写前版本');

      // ③ 复制不成功 → fail-closed：目标文档与 state 逐字节不变（备份先于写入，写入面不留半态）
      writeFile(dir, '.specs/CONTEXT.md', original);
      const stateBytes = readStateBytes(dir);
      fs.rmSync(path.join(dir, '.specs', backups[0]), { force: true });
      fs.mkdirSync(path.join(dir, '.specs', backups[0]));
      const blocked = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertEqual(fs.readFileSync(contextFile, 'utf8'), original, '备份失败的一轮改写了 CONTEXT.md');
      assertStateBytesUnchanged(dir, stateBytes, '备份失败的一轮');

      // ④ 命名族与失败处置的**同源**判据已随备份助手抽取移到场景 301（唯一定义 + 两消费方零内联
      //    + 合成反向构造）：此处不重复表达同一判据，只保留上面的真实行为锚。
    },
  },

  // 297: health 的审计行与报告落盘路径**恒输出**——报告是唯一写入面，调用方至少要能从标准输出
  // 确认「跑没跑、落在哪、基线是谁」：不带 `--stdout` 时此前 stdout 为空（审计行 0 命中），
  // 报告路径无处可见；`--stdout` 时报告正文在前、审计行追加在后（正文仍是落盘字节，审计行不进
  // 报告）。审计行内容当日确定（日期 / 在场判定 / 基线），不引入新的易变行。另锚：审计行用的
  // CLI 路径标签是三条侧命令的**共享助手**（evolve.mjs 唯一定义），不给同一显示决定留下第二份。
  {
    name: '297 health 审计行恒输出：HEALTH: 行与报告落盘路径（不带 --stdout 亦然）+ 正文不回流 + --help 不产报告',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));
      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const reportFile = path.join(dir, '.specs', 'health', today + '-HEALTH.md');
      const reportLine = 'HEALTH: 报告 `.specs/health/' + today + '-HEALTH.md`';

      // ① 不带 `--stdout`：审计行与报告路径仍必须输出，且**不**把报告正文回流
      const quiet = runSideScript(SIDE_HEALTH, ['--root', dir], dir);
      assertExit(quiet, 0);
      assertOut(quiet, reportLine);
      assertOut(quiet, 'HEALTH-DONE');
      assertNotOut(quiet, '## 确定性层（机器可判）');
      // 审计行点名的路径必须是真实落盘的工件（文案与产物同源）
      assertTrue(fs.existsSync(reportFile), '审计行点名的报告未落盘: ' + reportFile);

      // ② 带 `--stdout`：报告正文在前（与落盘逐字节一致）、审计行在后
      const loud = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(loud, 0);
      assertOut(loud, reportLine);
      assertOut(loud, 'HEALTH-DONE');
      const reportText = fs.readFileSync(reportFile, 'utf8');
      assertTrue(loud.output.startsWith(reportText), '--stdout 的报告正文应与落盘逐字节一致（审计行追加在后）');
      assertTrue(loud.output.indexOf('HEALTH-DONE') > loud.output.indexOf(reportText),
        '审计行应在报告正文之后（顺序反了会让消费方把摘要当正文）');

      // ③ 审计行回显本次采用的基线：合法旧报告在场时点名它（同日重跑不与自己对比）
      writeFile(dir, '.specs/health/2026-01-05-HEALTH.md', healthReportFixture('2026-01-05', 999999));
      const withBaseline = runSideScript(SIDE_HEALTH, ['--root', dir], dir);
      assertExit(withBaseline, 0);
      assertOut(withBaseline, 'HEALTH: 日期 ' + today);
      assertOut(withBaseline, '基线 `.specs/health/2026-01-05-HEALTH.md`');

      // ④ `--help` 短路：打用法、不产报告、不输出审计行（用法面语义不变）
      const help = runSideScript(SIDE_HEALTH, ['--help'], dir);
      assertExit(help, 0);
      assertOut(help, 'health.mjs');
      assertNotOut(help, 'HEALTH: 报告');

      // ⑤ 结构锚：CLI 路径标签**单一来源**（三条命令的摘要行同形）——定义只在共享助手模块
      //    evolve.mjs（侧命令共享助手的既有落点），另两条具名 import 后真实调用；第二份同名
      //    助手（或改回各处内联）即红。
      const labelDefinition = engineDefinitionHits('relativeLabel');
      assertEqual(labelDefinition.length, 1, 'relativeLabel 定义面（全引擎应恰 1 处）实际 ' + JSON.stringify(labelDefinition));
      assertEqual(labelDefinition[0].file, 'evolve.mjs', 'relativeLabel 定义文件');
      for (const file of ['health.mjs', 'context-scan.mjs']) {
        const text = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
        assertTrue(hasNamedImport(text, './evolve.mjs', 'relativeLabel'),
          file + ' 未从共享助手模块 import 路径标签（第二份同名助手或未接线）');
        assertTrue(text.includes('relativeLabel('), file + ' 未真实调用共享路径标签');
      }
    },
  },

  // 298: 禁裸拼接静态锚（DESIGN R4 的落地）——时间形态 / 格式化的唯一权威是 time-utils.mjs：
  // 三条侧命令零容忍（人可见报告 / CLI 摘要行 / 备份名）；其余引擎脚本走**显式白名单 + 逐条理由**
  // （既有 13 处都是已持久化的机器字段，迁移留专门窗口；新增写入路径一律走 time-utils，不得把
  // 白名单当增量口——撤回留痕 withdrawnAt 即按此落 nowTimestamp）。判别力两条：① 白名单判定是纯函数，
  // 合成输入可驱动「条数漂移（增 / 减）」与「未登记文件」三态必报；② 合成引擎目录注入第二处
  // 裸拼接 → 检出必增（证明真实面判据不恒真空过）。
  {
    name: '298 禁裸拼接静态锚：三侧命令零容忍 + 引擎 13 处显式白名单（逐条理由）+ 合成反向构造',
    run: () => {
      // ① 三条侧命令零容忍（人可见面的时间形态只许走 time-utils）
      const sideHits = bareIsoTimestampHits(SCRIPTS_DIR, BARE_ISO_SIDE_COMMANDS);
      assertEqual(sideHits.length, 0,
        '侧命令出现裸时间拼接（人可见面须走 time-utils 的 nowTimestamp / formatLocalTimestamp）: ' + JSON.stringify(sideHits));

      // ② 其余引擎脚本 = 精确白名单：条数逐文件相等 + 每条例外带非空理由
      const engineHits = bareIsoTimestampHits(SCRIPTS_DIR).filter((hit) => !BARE_ISO_SIDE_COMMANDS.includes(hit.file));
      assertEqual(engineHits.reduce((sum, hit) => sum + hit.count, 0), 13, '引擎既有裸拼接落点总数（白名单代数）');
      const problems = bareIsoWhitelistProblems(engineHits, BARE_ISO_ENGINE_WHITELIST);
      assertEqual(problems.length, 0, '白名单漂移: ' + problems.join(' | '));
      for (const entry of BARE_ISO_ENGINE_WHITELIST) {
        assertTrue(typeof entry.reason === 'string' && entry.reason.length >= 20,
          entry.file + ' 的白名单条目缺理由（豁免必须是显式且有据的，不是静默名单）');
      }

      // ③ 白名单判定的判别力（纯函数 · 合成输入）：等价集合不报；三类漂移各自必报
      //    （合成等价集合的条数取真实白名单首条的当前值——它必须与常量同值，否则第 1 条断言即红）
      const equivalent = [{ file: 'a.mjs', count: 7 }, { file: 'b.mjs', count: 4 }, { file: 'c.mjs', count: 1 }, { file: 'd.mjs', count: 1 }];
      const whitelist = BARE_ISO_ENGINE_WHITELIST.map((entry, index) => ({ ...entry, file: equivalent[index].file }));
      assertEqual(bareIsoWhitelistProblems(equivalent, whitelist).length, 0, '等价集合不应报白名单漂移');
      const newcomer = bareIsoWhitelistProblems([...equivalent, { file: 'newcomer.mjs', count: 1 }], whitelist);
      assertTrue(newcomer.some((problem) => problem.includes('newcomer.mjs') && problem.includes('未登记白名单')),
        '未登记文件的裸拼接未被判定: ' + JSON.stringify(newcomer));
      const grown = bareIsoWhitelistProblems(
        equivalent.map((hit, index) => (index === 0 ? { ...hit, count: hit.count + 1 } : hit)), whitelist);
      assertTrue(grown.some((problem) => problem.includes('白名单 7 处 / 实际 8 处')),
        '白名单条数增长未被判定: ' + JSON.stringify(grown));
      const shrunk = bareIsoWhitelistProblems(equivalent.slice(1), whitelist);
      assertTrue(shrunk.some((problem) => problem.includes('白名单 7 处 / 实际 0 处')),
        '已迁移落点未同步收窄白名单未被判定: ' + JSON.stringify(shrunk));

      // ④ 合成引擎目录反向构造：单处 → 检出 1；再注入一处 → 检出 2（判据不恒真空过）。
      //    样例经拼接构造，避免套件自身源码携带该字面量而污染真实面计数（本套件同样在扫描面内）。
      const bareIsoSample = 'new Date().' + 'toISOString()';
      const synthetic = makeTmp();
      try {
        writeFile(synthetic, 'one.mjs', 'export const a = () => ' + bareIsoSample + ';\n');
        assertEqual(bareIsoTimestampHits(synthetic).length, 1, '合成目录单处检出数');
        writeFile(synthetic, 'two.mjs', 'export const b = () => ' + bareIsoSample + ';\n');
        assertEqual(bareIsoTimestampHits(synthetic).length, 2, '合成目录第二处检出数（判据须变红）');
        // 注释里的引用不算实现（判据只看代码）
        writeFile(synthetic, 'three.mjs', '// 反例引用: ' + bareIsoSample + '\nexport const c = 1;\n');
        assertEqual(bareIsoTimestampHits(synthetic).length, 2, '行注释中的引用不应计入实现面');
      } finally {
        cleanupTmpDir(synthetic);
      }
    },
  },

  // 299: 可选工具超时预算（60s 内）+ 超时不静默——常量与调用点同源，且「工具在场但运行未完成」
  // 必须把降级原因（含本次超时预算）写进报告、快照读数按 `present` 而非 `ok` 落盘，退出码仍 0
  // （可选工具不可用不是失败）。判别力：常量越预算即红；夹具工具（在场但跑不起来）触发同一
  // 失败分支，报告里必须看到降级原因——不静默、不冒充成功读数。
  {
    name: '299 工具超时收口：常量 ≤ 60s 且与调用点同源 + 在场但运行失败必记降级原因（含预算）',
    run: (dir) => {
      const healthText = fs.readFileSync(SIDE_HEALTH, 'utf8');
      const match = /const TOOL_TIMEOUT_MS = (\d+);/.exec(healthText);
      assertTrue(match !== null, 'health.mjs 缺工具超时常量 TOOL_TIMEOUT_MS');
      const budget = Number(match[1]);
      assertTrue(budget > 0 && budget <= 60000, '工具超时常量超出 60s 预算: ' + budget + ' ms');
      assertTrue(/timeout: TOOL_TIMEOUT_MS/.test(healthText), '工具调用未消费超时常量（常量会变成装饰）');
      assertTrue(healthText.includes('超时预算'), '降级原因未回显本次超时预算（超时须可自证，不静默）');

      // 真实链路：夹具工具「在场」（探面命中 <根>/node_modules/.bin/）但跑不起来 → 同一失败分支
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n\n### L-002 次条\n');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
      const toolPath = path.join(dir, 'node_modules', '.bin', 'jscpd');
      fs.writeFileSync(toolPath, '#!/usr/bin/env node\nprocess.exit(3);\n', 'utf8');
      fs.chmodSync(toolPath, 0o755);
      const res = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(res, 0);
      assertOut(res, '未采集——工具在场但运行未完成（超时预算 ' + budget + ' ms；');
      assertOut(res, 'redundancy.jscpd=present');
      assertNotOut(res, 'redundancy.jscpd=ok');
      assertOut(res, '- **jscpd**：在场——字面重复块读数见「冗余扫描」段');
    },
  },

  // 300: 读数快照的键形态**单一来源**——往返判据：把生产者自己产出的快照段整段当作历史基线
  // 喂回去，每个产出的键都必须被读回（零「基线无此读数」、条数与产出条数相等）；反例：给写方
  // 真实产出的键写异常值 → 必出趋势行；近形状键（大小写不符）不得被读走。此前写方发 6 个含
  // 大写字母的键、读方的键形态正则只认全小写：6/18 个键恒判「（基线无此读数）」，逐键趋势
  // 静默失效且不报错（假绿形态）。
  {
    name: '300 快照键形态单一来源：产出快照往返零「基线无此读数」+ 真实键异常值必出趋势行 + 近形状键不误读',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n\n### L-002 次条\n');
      writeState(dir, baseState('open'));

      // ① 生产面自证：先跑一次拿到真实报告，取其快照段原文（不解析、不重排）
      const firstRun = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(firstRun, 0);
      const firstReport = fs.readFileSync(path.join(dir, '.specs', 'health',
        requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date()) + '-HEALTH.md'), 'utf8');
      const section = snapshotSectionOf(firstReport);
      assertTrue(section !== null, '报告缺「## 读数快照」段（往返夹具前提不成立）');
      const producedEntries = snapshotEntryCount(section);
      assertTrue(producedEntries >= 10, '快照条数异常（往返判据的样本太小）: ' + producedEntries);

      // ② 往返：产出快照整段当作 2026-01-05 的历史基线 → 每个键都必须被读回
      writeFile(dir, '.specs/health/2026-01-05-HEALTH.md', healthReportWithSnapshot('2026-01-05', section));
      const roundTrip = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(roundTrip, 0);
      assertOut(roundTrip, '基线：`.specs/health/2026-01-05-HEALTH.md`');
      assertNotOut(roundTrip, '（基线无此读数）');
      const unchanged = (roundTrip.output.match(/（无变化）/g) ?? []).length;
      assertEqual(unchanged, producedEntries, '往返后逐键「无变化」条数应等于产出条数（有键没被读回）');

      // ③ 真实产出的键（含此前恒被判「基线无此读数」的驼峰键）写异常值 → 必出趋势行
      const anomalous = section
        .replace(/(^|\n)context\.lineCount=[^\n]*/, '$1context.lineCount=999999')
        .replace(/(^|\n)git\.head=[^\n]*/, '$1git.head=ffffffff');
      writeFile(dir, '.specs/health/2026-01-06-HEALTH.md', healthReportWithSnapshot('2026-01-06', anomalous));
      const trend = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(trend, 0);
      assertOut(trend, '基线：`.specs/health/2026-01-06-HEALTH.md`');
      assertOut(trend, '`context.lineCount`：999999 → ');
      assertOut(trend, '`git.head`：ffffffff → ');
      assertNotOut(trend, '999999（基线无此读数）');
      assertNotOut(trend, 'ffffffff（基线无此读数）');

      // ④ 近形状键（大小写不符）不是本版本的读数面：不得被读走（报「基线无此读数」而非伪造趋势）
      const nearMiss = section.replace(/(^|\n)context\.lineCount=[^\n]*/, '$1context.linecount=888888');
      writeFile(dir, '.specs/health/2026-01-07-HEALTH.md', healthReportWithSnapshot('2026-01-07', nearMiss));
      const miss = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(miss, 0);
      assertOut(miss, '基线：`.specs/health/2026-01-07-HEALTH.md`');
      assertNotOut(miss, '888888');
      assertOut(miss, '`context.lineCount`：');
      assertOut(miss, '（基线无此读数）');
    },
  },

  // 301: 备份改写前版本**单一来源**——命名族（目标文档同目录 + `.bak-<本地日期>`）与失败处置
  // 收敛为 state-schema.mjs 的单一导出（与原子写同址），evolve 与 context-scan 只消费导出：
  // 命名族或失败处置再演进时不会只改到一侧。判别力：① 定义面唯一 + 两消费方零内联（第二份
  // 实现 → 收敛面内检出 2 处）；② evolve 真实链路（备份 = 改写前版本、命名族命中当日日期、
  // 复制失败整轮 fail-closed：目标文档 / state / 报告三处零改动，与 context-scan 同处置）；
  // ③ 合成目录反向构造证明①的判据不恒真空过。
  {
    name: '301 备份助手单一来源：state-schema 唯一导出·两消费方零内联 + evolve 真实链路 fail-closed',
    run: async (dir) => {
      // ① 收敛面内恰一处实现（命名族字面量 + 复制调用同现者）——修复前 evolve 与 context-scan
      //    各一份（同形但两份），此断言即「第二份实现必红」的落点
      const impl = inlineBackupHits(SCRIPTS_DIR, BACKUP_IMPL_FACE);
      assertEqual(impl.length, 1, '备份实现面（收敛面内应恰 1 处）实际 ' + JSON.stringify(impl));
      assertEqual(impl[0].file, 'state-schema.mjs', '备份实现落点文件');

      // ② 定义面唯一 + 两消费方具名 import 与真实调用
      const definition = engineDefinitionHits('backupBeforeWrite');
      assertEqual(definition.length, 1, 'backupBeforeWrite 定义面（全引擎应恰 1 处）实际 ' + JSON.stringify(definition));
      assertEqual(definition[0].file, 'state-schema.mjs', 'backupBeforeWrite 定义文件');
      const backupHelper = requireModuleExport(stateSchemaModule, 'backupBeforeWrite', 'state-schema.mjs');
      for (const file of ['evolve.mjs', 'context-scan.mjs']) {
        const text = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
        assertTrue(hasNamedImport(text, './state-schema.mjs', 'backupBeforeWrite'),
          file + ' 未从 state-schema.mjs 具名 import 备份助手（第二份实现或未接线）');
        assertTrue(text.includes('backupBeforeWrite('), file + ' 未真实调用共享备份助手');
      }

      // ③ 单一导出的行为（命名族由共享实现派生：`.bak-<本地日期>`，内容 = 改写前版本）
      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const stamp = requireModuleExport(timeUtilsModule, 'nowTimestamp', 'time-utils.mjs')();
      const probe = makeTmp();
      try {
        const target = path.join(probe, 'doc.md');
        writeFile(probe, 'doc.md', '改写前内容\n');
        await backupHelper(target, stamp);
        const produced = target + '.bak-' + today;
        assertTrue(fs.existsSync(produced), '备份未按「同目录 + 当日本地日期」落点: ' + produced);
        assertEqual(fs.readFileSync(produced, 'utf8'), '改写前内容\n', '备份内容应为改写前版本');
      } finally {
        cleanupTmpDir(probe);
      }

      // ④ evolve 真实链路：apply 落备份（内容 = 改写前版本）
      writeFile(dir, '.specs/archive/2026-10-02-backup/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 备份单一来源夹具条目\n');
      const original = contextFixtureText();
      const contextFile = path.join(dir, '.specs', 'CONTEXT.md');
      const backupFile = contextFile + '.bak-' + today;
      writeFile(dir, '.specs/CONTEXT.md', original);
      writeState(dir, baseState('open'));
      const apply = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-backup#1', '--root', dir], dir);
      assertExit(apply, 0);
      assertTrue(fs.existsSync(backupFile), 'evolve apply 未落改写前备份: ' + backupFile);
      assertEqual(fs.readFileSync(backupFile, 'utf8'), original, '备份内容应为改写前版本');
      assertTrue(fs.readFileSync(contextFile, 'utf8') !== original, 'CONTEXT.md 未被改写（夹具前提不成立）');

      // ⑤ 复制不成功 → fail-closed：目标文档 / state / 报告三处零改动（与 context-scan 同处置）
      writeFile(dir, '.specs/CONTEXT.md', original);
      const stateBytes = readStateBytes(dir);
      const reportFile = path.join(dir, '.specs', 'evolve', today + '-EVOLVE.md');
      const reportBefore = fs.readFileSync(reportFile);
      fs.rmSync(backupFile, { force: true });
      fs.mkdirSync(backupFile);
      const blocked = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-backup#1', '--root', dir], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertEqual(fs.readFileSync(contextFile, 'utf8'), original, '备份失败的 apply 轮改写了 CONTEXT.md');
      assertStateBytesUnchanged(dir, stateBytes, '备份失败的 apply 轮');
      assertTrue(fs.readFileSync(reportFile).equals(reportBefore), '备份失败的 apply 轮改写了报告');

      // ⑥ 合成目录反向构造：单实现 → 1；再放第二份 → 2
      const synthetic = makeTmp();
      try {
        writeFile(synthetic, 'single.mjs',
          "export async function duplicateBackup(file, ts) {\n"
          + "  const backup = file + '.bak-' + ts;\n"
          + '  await fs.copyFile(file, backup);\n'
          + '}\n');
        assertEqual(inlineBackupHits(synthetic).length, 1, '合成目录单实现检出数');
        writeFile(synthetic, 'second.mjs',
          "async function anotherBackup(file, ts) {\n"
          + "  const backup = file + '.bak-' + ts;\n"
          + '  await fs.copyFile(file, backup);\n'
          + '}\n');
        assertEqual(inlineBackupHits(synthetic).length, 2, '合成目录第二份实现检出数（判据须变红）');
      } finally {
        cleanupTmpDir(synthetic);
      }
    },
  },

  // 302: AC-11 的四条时间硬规则文本锚（存在级，但**指真实实体**）：① 分发面技能文本（入口 SKILL
  // 的侧命令「共同边界」）陈述规则 ①②③；② 验证阶梯（docs/internal/WORKING-METHOD.md 一·五 的
  // 「环境 / 过程纪律·时间」条）承载规则 ①~③ 并落实 ④（纪律已写入阶梯本身）；③ 文本点名的实体
  // 在树内真实存在——`time-utils.mjs` 在场且真实定义被点名的判据符号（防锚指向幽灵：散文提到的
  // 东西必须在树里找得到）。维护者面结构性缺席（CI 全新检出 / worktree）时验证阶梯半边输出可见
  // SKIP 行（未验证 ≠ 通过），分发面半边恒检。
  {
    name: '302 时间纪律四条硬规则文本锚：入口技能陈述 ①②③ + 验证阶梯承载四条 + 点名实体真实在场',
    run: () => {
      const skillsRoot = skillsRootForScriptsDir(SCRIPTS_DIR);
      const entrySkill = path.join(skillsRoot, 'flow-comet', 'SKILL.md');
      const skillText = fs.readFileSync(entrySkill, 'utf8');
      const skillProblems = timeDisciplineTextProblems('入口 SKILL', skillText);
      assertEqual(skillProblems.length, 0, '时间纪律文本锚: ' + skillProblems.join(' | '));

      // 反向构造（真实文本逐条移除 · 合成输入驱动同一判据）：任一条规则的关键词被移走 → 该条必报。
      for (const [rule, tokens] of TIME_DISCIPLINE_RULES) {
        const stripped = tokens.reduce((text, token) => text.replace(token, '（反向构造：移除）'), skillText);
        assertTrue(stripped !== skillText, '反向构造前提不成立（入口 SKILL 缺该条关键词）: ' + rule);
        assertTrue(timeDisciplineTextProblems('入口 SKILL', stripped).some((problem) => problem.includes(rule)),
          '逐条移除未被判违规（判别力缺失）: ' + rule);
      }

      if (maintainerFacePresent()) {
        const ladder = fs.readFileSync(path.join(REPO_ROOT, 'docs/internal/WORKING-METHOD.md'), 'utf8');
        const ladderProblems = timeDisciplineTextProblems('验证阶梯', ladder);
        assertEqual(ladderProblems.length, 0, '验证阶梯文本锚: ' + ladderProblems.join(' | '));
        assertTrue(ladder.includes('环境 / 过程纪律'), '验证阶梯缺「环境 / 过程纪律」条（规则④的落点）');
        assertTrue(ladder.includes('L-096'), '验证阶梯的时间纪律条未点名 L-096 实证（规则③的依据）');
      } else {
        console.log('SKIP: 302 的验证阶梯面（docs/internal/WORKING-METHOD.md 一·五「环境 / 过程纪律」条）'
          + '——维护者面结构性缺席；本次检出未校验规则 ①~④ 已写入验证阶梯，请在维护者主树重跑本套件');
      }

      // 点名实体真实在场：time-utils.mjs（规则①②的单一权威）在场，且真实定义被点名的判据符号。
      const timeUtilsFile = path.join(SCRIPTS_DIR, 'time-utils.mjs');
      assertTrue(fs.existsSync(timeUtilsFile), '入口 SKILL 的时间纪律点名 time-utils.mjs，但树内无此文件（锚指向幽灵实体）');
      for (const symbol of ['formatLocalTimestamp', 'parseTimestamp']) {
        assertTrue(engineDefinitionHits(symbol).some((hit) => hit.file === 'time-utils.mjs'),
          'time-utils.mjs 未定义被点名的判据符号 ' + symbol + '（散文与实现脱节）');
      }
    },
  },

  // 303: 收尾打磨之首——`evolve` 在 **CRLF 文档**上追加「## evolve 元数据」段前不得留裸 LF 行。
  // 复现形态（评审实测 `-->\r\n\n\r\n---`）：`split('\n')` 对「以换行收尾的文档」留有一个零长度
  // 哨兵元素，旧实现直接在哨兵之后 push，于是拼出一条**无 `\r` 的空行**（同一文件两种行尾）。
  // 断言面：整篇每条行都以 CRLF 终结（逐行行号可读）+ 追加块前后形态逐字 + LF 文档对照
  // （证明修复不是「CRLF 专属补丁」——两种行尾约定下追加块都退化为**单空行**）。
  {
    name: '303 侧命令 CRLF 追加块：evolve 追加元数据段零裸 LF 行 · 两种行尾约定形态一致',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-10-02-crlf/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- CRLF 夹具条目\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      // ① CRLF 文档：夹具本身必须整篇 CRLF（否则「裸 LF」判据的前提不成立）
      const crlfFixture = contextFixtureText({ tail: '<!-- crlf-tail -->' }).replace(/\n/g, '\r\n');
      assertEqual(crlfLineViolations(crlfFixture).length, 0, '夹具前提不成立：CRLF 夹具本身含非 CRLF 行');
      writeFile(dir, '.specs/CONTEXT.md', crlfFixture);

      const applied = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-crlf#1', '--root', dir], dir);
      assertExit(applied, 0);
      assertOut(applied, 'EVOLVE-OK');
      const crlfText = fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      const violations = crlfLineViolations(crlfText);
      assertEqual(violations.join(','), '',
        'CRLF 文档追加后出现非 CRLF 行（行号）: ' + violations.join(','));
      assertTrue(crlfText.includes('<!-- crlf-tail -->\r\n\r\n---\r\n\r\n## evolve 元数据\r\n\r\n'),
        '追加块前后形态不符（期望单空行 + 全 CRLF）: '
          + JSON.stringify(crlfText.slice(crlfText.indexOf('<!-- crlf-tail -->'))));
      // 判别力（合成变异驱动同一判据）：把评审实测的修复前形态灌回真实文本 → 必报
      const regressed = crlfText.replace('\r\n\r\n---\r\n', '\r\n\n\r\n---\r\n');
      assertTrue(regressed !== crlfText, '反向构造前提不成立（追加块形态已变）');
      assertTrue(crlfLineViolations(regressed).length > 0, '裸 LF 行未被判违规（判别力缺失）');

      // ② LF 文档对照：行尾约定不变（单空行 + 全 LF），且不得被写入 CR
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText({ tail: '<!-- lf-tail -->' }));
      writeState(dir, baseState('open'));
      const appliedLf = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-crlf#1', '--root', dir], dir);
      assertExit(appliedLf, 0);
      const lfText = fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      assertTrue(lfText.includes('<!-- lf-tail -->\n\n---\n\n## evolve 元数据\n\n'),
        'LF 文档追加块形态回归: ' + JSON.stringify(lfText.slice(lfText.indexOf('<!-- lf-tail -->'))));
      assertTrue(!lfText.includes('\r'), 'LF 文档被写入 CR（行尾约定不得被改写）');
    },
  },

  // 304: 收尾打磨之二——EVOLVE 报告的「## 应用 patch」条目此前是 `  - ` 前缀与条目自带的 `- `
  // 叠加（`  - - <条目>`）：Markdown 渲染成「空壳父项 + 子项」两条，报告读者数不清应用了几条。
  // 断言面：报告零 `- -` 双符号行 + 条目行逐字（单符号）+ 父项在场（子项挂在正确的父项下）。
  {
    name: '304 EVOLVE 报告条目单一列表符号：零 `- -` 双符号行 · 条目行逐字',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-10-02-report/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 报告条目夹具\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));
      const applied = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-report#1', '--root', dir], dir);
      assertExit(applied, 0);
      assertOut(applied, 'EVOLVE-OK');

      const date = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const reportFile = path.join(dir, '.specs', 'evolve', date + '-EVOLVE.md');
      assertTrue(fs.existsSync(reportFile), 'EVOLVE 报告未落盘: ' + reportFile);
      const reportText = fs.readFileSync(reportFile, 'utf8');
      const bulletProblems = evolveReportBulletProblems(reportText);
      assertEqual(bulletProblems.length, 0, 'EVOLVE 报告列表符号: ' + bulletProblems.join(' | '));
      assertTrue(reportText.includes('- [2026-10-02-report#1] → `.specs/CONTEXT.md`「既有抽象索引」'),
        '报告缺应用项的父条目行: ' + JSON.stringify(reportText.slice(reportText.indexOf('## 应用 patch'))));
      assertTrue(reportText.includes('  - 报告条目夹具 · 来源 @.specs/archive/2026-10-02-report/DESIGN.md'),
        '报告条目行不是单一列表符号: ' + JSON.stringify(reportText.slice(reportText.indexOf('## 应用 patch'))));
      // 判别力（合成变异驱动同一判据）：把双符号灌回真实报告 → 必报
      const regressed = reportText.replace('  - 报告条目夹具', '  - - 报告条目夹具');
      assertTrue(regressed !== reportText, '反向构造前提不成立（报告缺条目行）');
      assertTrue(evolveReportBulletProblems(regressed).length > 0, '双列表符号未被判违规（判别力缺失）');
    },
  },

  // 305: 收尾打磨之三——`health` 的「技术债表项数」复现命令此前硬编码 H3（`/^### 技术债/`），
  // 而同一项的判据把段标题层级放宽到二~四级：`## 技术债` 的项目照抄命令复现不出报告读数
  // （读数说 0，其实段在场有表项）——命令与判据各说一套。
  // 同一条判据的残留边界（同批收口）：段边界此前按「任意 H1~H4 标题」截断，段内**子标题**之后的
  // 表格整段丢失（`## 技术债` + `### 明细` 与 `### 技术债` + `#### 明细` 都读成 0 表项）——层级
  // 必须与段标题自身比较。断言面 = 标题层级 × 有无子标题的**六格矩阵**（H4 + 更深子标题是控制格：
  // 更深子标题本就不该截断），复现命令的段终点同步改为「同级或更高级标题，或分隔线」而与判据同源。
  {
    name: '305 health 技术债段级与段边界按判据动态取：H2/H3/H4 × 子标题六格矩阵 · 段缺席退回区间',
    run: (dir) => {
      const withDebt = (heading, sub) => contextFixtureText()
        + '\n' + heading + '（夹具技术债）\n\n' + (sub === '' ? '' : sub + '\n\n')
        + '| 项 | 说明 |\n|---|---|\n| 债 A | 说明 A |\n| 债 B | 说明 B |\n';
      // 复现命令的段级与段终点都取自判据本身（段级 = 文档里真实命中的标题层级；终点 = 同级或更
      // 高级标题，或分隔线）——命令与读数才是同一件事的两种说法。
      const reproLine = (bound) => "- 复现命令：`awk 'f&&(/^#{1," + bound
        + "}[[:space:]]/||/^-{3,}[[:space:]]*$/){exit} /^#{2,4}[[:space:]]*技术债/{f=1} f' .specs/CONTEXT.md"
        + " | grep -c '^|'`（含表头与分隔行，减去 2 即表项数）";

      for (const [label, heading, sub, bound] of [
        ['H2', '## 技术债', '', '2'],
        ['H2-sub', '## 技术债', '### 明细', '2'],
        ['H3', '### 技术债', '', '3'],
        ['H3-sub', '### 技术债', '#### 明细', '3'],
        ['H4', '#### 技术债', '', '4'],
        ['H4-sub', '#### 技术债', '##### 明细', '4'],
      ]) {
        const root = path.join(dir, label.toLowerCase());
        writeFile(root, '.specs/CONTEXT.md', withDebt(heading, sub));
        writeFile(root, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n');
        const res = runSideScript(SIDE_HEALTH, ['--root', root, '--stdout'], dir);
        assertExit(res, 0);
        assertOut(res, '- 表项数：2');
        assertOut(res, reproLine(bound));
        if (bound !== '3') assertNotOut(res, reproLine('3'));
      }
      // 命令形态已换（段终点须能表达「同级或更高级」）——旧的 `/^---/` 单终点形态不得再出现
      const h2 = runSideScript(SIDE_HEALTH, ['--root', path.join(dir, 'h2'), '--stdout'], dir);
      assertNotOut(h2, "- 复现命令：`sed -n ");

      // 段缺席：没有可取的层级 → 退回判据的层级区间（二~四级）形态；读数仍为 0（复现命令成立）
      const absentRoot = path.join(dir, 'absent');
      writeFile(absentRoot, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(absentRoot, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n');
      const absent = runSideScript(SIDE_HEALTH, ['--root', absentRoot, '--stdout'], dir);
      assertExit(absent, 0);
      assertOut(absent, '- 表项数：0');
      assertOut(absent, reproLine('4'));
    },
  },

  // 306: 验收条款子句的机检锚——「确定性层**每项**都带可复现命令」。此前该子句只由「state 字节
  // 零改写」间接代表（评审记为锚偏弱）：报告里说「逐项带计数与判据」，但「每项都有复现命令」
  // 无人核。断言面：确定性层逐项都有 `- 复现命令：` 行（非仓库态与真实 git 仓库态两态）+ 逐项
  // 抽掉该项的复现命令 → 每抽一次必报（判据不是只看第一项）。
  {
    name: '306 health 确定性层每项带复现命令：逐项机检 + 逐项抽掉必报 + git 两态覆盖',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n');
      const plain = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(plain, 0);
      assertOut(plain, '### 5 · 版本历史统计（git）');
      const plainProblems = deterministicReproProblems(plain.output);
      assertEqual(plainProblems.length, 0, '确定性层缺复现命令: ' + plainProblems.join(' | '));

      // 逐项判别力（合成变异驱动同一判据）：确定性子集逐项各抽掉一次复现命令 → 每次都必报
      const rows = plain.output.split('\n');
      const starts = rows.map((line, i) => (line.startsWith('### ') ? i : -1)).filter((i) => i >= 0);
      assertTrue(starts.length >= 5, '确定性层分项数不足（判据无从覆盖）: ' + starts.length);
      for (const start of starts) {
        const nextStart = rows.findIndex((line, i) => i > start && line.startsWith('### '));
        const stop = nextStart < 0 ? rows.length : nextStart;
        const at = rows.findIndex((line, i) => i > start && i < stop && line.startsWith('- 复现命令：'));
        assertTrue(at >= 0, '确定性项缺复现命令: ' + rows[start]);
        const mutated = [...rows.slice(0, at), ...rows.slice(at + 1)].join('\n');
        assertTrue(deterministicReproProblems(mutated).length > 0,
          '抽掉该项复现命令未被判违规（判别力缺失）: ' + rows[start]);
      }

      // git 在场态：另起一个真实仓库根（`git init`）→ 第 5 项走「是」分支，同样带复现命令
      const repoRoot = path.join(dir, 'repo-root');
      writeFile(repoRoot, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(repoRoot, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n');
      execFileSync('git', ['init', '-q'], { cwd: repoRoot, stdio: 'ignore' });
      const inRepo = runSideScript(SIDE_HEALTH, ['--root', repoRoot, '--stdout'], dir);
      assertExit(inRepo, 0);
      assertOut(inRepo, '- git 仓库：是');
      const repoProblems = deterministicReproProblems(inRepo.output);
      assertEqual(repoProblems.length, 0, 'git 在场态确定性层缺复现命令: ' + repoProblems.join(' | '));
    },
  },

  // 307: 覆盖声明四要素机检锚（评审登记的移交项）——三处「上游 vendored 只读」覆盖声明此前是
  // **纯文本、无机检**。四要素：① 上游文件标记为只读基准（且点名的上游文件真实在场）；
  // ② 「不采用」栏 ≥1 条；③ 「沿用上游」栏 ≥1 条（入口为**指针式** → 该栏豁免，细则在各自技能册）；
  // ④ 「以…为准」兜底语。负向控制：把任一要素从**真实文本**里抽掉 → 必红。
  {
    name: '307 上游覆盖声明四要素：三处声明齐备 + 点名上游实体在场 + 逐要素抽掉必红',
    run: () => {
      const skillsRoot = skillsRootForScriptsDir(SCRIPTS_DIR);
      const declarations = [
        { label: 'flow-comet-health/SKILL.md', file: path.join(skillsRoot, 'flow-comet-health', 'SKILL.md'), pointer: false },
        { label: 'flow-comet-evolve/SKILL.md', file: path.join(skillsRoot, 'flow-comet-evolve', 'SKILL.md'), pointer: false },
        { label: 'flow-comet/SKILL.md', file: path.join(skillsRoot, 'flow-comet', 'SKILL.md'), pointer: true },
      ];
      for (const declaration of declarations) {
        const text = fs.readFileSync(declaration.file, 'utf8');
        const problems = overrideDeclarationProblems(declaration.label, text, { pointer: declaration.pointer });
        assertEqual(problems.length, 0, '覆盖声明四要素: ' + problems.join(' | '));

        // 逐要素抽掉（真实文本驱动同一判据）：该要素必报——判据不恒真空过。
        // 兜底语取**声明块内**的匹配（文件里别处的 `冲突…以文件为准` 一类行文不是该要素，
        // 抽错目标会让判别力断言变成假绿）。
        const probes = [
          { element: '只读基准', strip: (value) => value.replaceAll('只读基准', '（反向构造：抽掉）') },
          { element: '不采用栏', strip: (value) => value.replaceAll('不采用', '（反向构造：抽掉）') },
          {
            element: '兜底语',
            strip: (value) => {
              const blockFallback = OVERRIDE_FALLBACK_RE.exec(overrideDeclarationBlock(value));
              return value.replace(blockFallback[0], '（反向构造：抽掉）');
            },
          },
        ];
        if (!declaration.pointer) {
          probes.push({ element: '沿用上游栏', strip: (value) => value.replaceAll('沿用上游', '（反向构造：抽掉）') });
        }
        for (const probe of probes) {
          const stripped = probe.strip(text);
          assertTrue(stripped !== text, '反向构造前提不成立（文本缺该要素）: ' + declaration.label + ' / ' + probe.element);
          assertTrue(overrideDeclarationProblems(declaration.label, stripped, { pointer: declaration.pointer })
            .some((problem) => problem.includes(probe.element.replace(/栏$/, '')) || problem.includes('兜底语')),
            '抽掉要素未被判违规（判别力缺失）: ' + declaration.label + ' / ' + probe.element);
        }
      }

      // 点名的上游实体真实在场：vendored 上游面结构性缺席时输出可见 SKIP（未验证 ≠ 通过）。
      // 取「声明块内」点名的路径——文件别处的说明性写法（`flow-kit/prompts/<阶段>.md` 占位）
      // 不是本声明的落点。
      const promptsRoot = path.join(REPO_ROOT, 'flow-kit', 'prompts');
      if (fs.existsSync(promptsRoot)) {
        for (const declaration of declarations) {
          const block = overrideDeclarationBlock(fs.readFileSync(declaration.file, 'utf8'));
          const paths = upstreamArtifactPaths(block);
          assertTrue(paths.length > 0, declaration.label + ' 未点名任何上游工件（声明的锚缺落点）');
          for (const rel of paths) {
            assertTrue(fs.existsSync(path.join(REPO_ROOT, rel)),
              declaration.label + ' 点名的上游文件不存在（锚指向幽灵实体）: ' + rel);
          }
        }
      } else {
        console.log('SKIP: 307 的上游实体面（flow-kit/prompts 为 vendored 上游面，可能结构性缺席）'
          + '——本次检出未校验「覆盖声明点名的上游文件真实在场」，请在 vendored 上游在场处重跑本套件');
      }
    },
  },

  // 308: `last_intel_scan` 双落点一致（原症状顺序 · 真实链路）——先 `context-scan` 建双落点，真实时间
  // 流逝后再跑 `init --init-context`：state 侧取值必须以**统一形态**（本地时间 + 显式偏移，经
  // time-utils）写入；段侧不由 init 改写（段行的唯一写通道是 context-scan，其改写与备份实现只有
  // 一份）；两者取值不一致时**必须有可见提示**并点名收敛命令——修复前是「写 `Z` 形态 + 段未更新 +
  // 零提示」的静默漂移。反向控制：两处取值一致时零提示（不误报），且未刷新路径不改写既有取值。
  // 段行夹具 = **真实生成件形态**（取值词元 + 行尾说明，见 INTEL_FIELD_SUFFIX）：读侧若按整行剩余
  // 文本比对，则同刻同形态（②）与收敛后（⑥）都会恒亮、漂移类别退化成「段内取值不是合法时间戳」
  // （④）——三条都是本场景的判据；⑦ 单变量对照（只剥掉说明）证明判别条件是词元口径而非说明本身。
  {
    name: '308 双落点一致：带行尾说明的段行同刻静默 + 漂移类别正确 + 重扫收敛后零提示 + 单变量对照',
    run: (dir) => {
      const parse = requireModuleExport(timeUtilsModule, 'parseTimestamp', 'time-utils.mjs');
      const extract = requireModuleExport(contextInitModule, 'extractContextStructure', 'context-init.mjs');
      const readContext = () => fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      const readLandedState = () => JSON.parse(
        fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8')).last_intel_scan;
      // 段侧取值的读取口径与生产侧同源：结构提取定位字段 → 取**取值词元**（写侧只换词元，说明原样保留）
      const readLandedSection = () => {
        const field = extract(readContext()).metadata['intel-scan 元数据'];
        return field === undefined ? undefined : intelFieldToken(field.last_intel_scan.value);
      };

      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      // ① 首扫：双落点建立且同刻同形态；段行的行尾说明原样保留（写侧只替换取值词元）
      const scan = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(scan, 0);
      assertOut(scan, 'CONTEXT-SCAN-DONE');
      const scanned = readLandedState();
      assertEqual(readLandedSection(), scanned, '首扫后双落点应同刻同形态');
      assertTrue(readContext().includes(INTEL_FIELD_SUFFIX), '重扫改写了段行的行尾说明（写侧只应替换取值词元）');

      // ② 带行尾说明的同刻同形态 ⇒ **静默**（未刷新路径的 init 不改写既有取值）——整行口径的读侧在此恒亮
      const quietLanded = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(quietLanded, 0);
      assertEqual(readLandedState(), scanned, '未刷新路径应原样保留既有扫描时刻');
      assertNotOut(quietLanded, 'INIT-NOTICE');

      // ③ 真实时间流逝——时间戳是秒级精度，同一秒内的两次写入取值可能相同（漂移不可判）
      sleepSync(1100);

      // ④ 原症状顺序：`init --init-context`（CONTEXT 校验通过路径 → 记录扫描时刻）
      const reinit = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(reinit, 0);
      assertOut(reinit, 'INIT-DONE');
      const stateAfter = readLandedState();
      assertTrue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(stateAfter),
        'init 写入的扫描时刻形态非「本地时间 + 显式偏移」: ' + stateAfter);
      assertTrue(parse(stateAfter) > parse(scanned),
        'init 写入的扫描时刻应晚于首扫（不得回退）: ' + stateAfter + ' vs ' + scanned);
      assertEqual(readLandedSection(), scanned, 'init 不应改写 CONTEXT 段（该段行的写通道是 context-scan）');
      // 漂移不得静默：提示在场 + 两侧取值回显 + 点名收敛命令 + **类别正确**（两侧同为「本地时间 +
      // 显式偏移」形态、仅时刻不同 ⇒ 「刻与形态均不一致」；行尾说明不得把类别打成取值非法）
      assertOut(reinit, 'INIT-NOTICE');
      assertOut(reinit, stateAfter);
      assertOut(reinit, scanned);
      assertOut(reinit, '刻与形态均不一致');
      assertNotOut(reinit, '段内取值不是合法时间戳');
      assertOut(reinit, 'context-scan');

      // ⑤ 收敛：重扫一次 → 双落点同刻同形态（行尾说明原样保留）
      const converge = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(converge, 0);
      assertOut(converge, 'CONTEXT-SCAN-DONE');
      const converged = readLandedState();
      assertEqual(readLandedSection(), converged, '重扫后双落点应收敛为同刻同形态');
      assertTrue(readContext().includes(INTEL_FIELD_SUFFIX), '收敛轮改写了段行的行尾说明');

      // ⑥ 收敛后：取值一致时的 init（未授权刷新 → 原样保留既有扫描时刻）零提示——提示承诺的收敛可达
      const quiet = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(quiet, 0);
      assertEqual(readLandedState(), converged, '未刷新路径应原样保留既有扫描时刻');
      assertNotOut(quiet, 'INIT-NOTICE');

      // ⑦ 单变量对照：**只**剥掉段行的行尾说明（取值词元不变、state 不变）→ 仍然静默——判别条件是
      //    「取值词元」口径而非「有没有说明」；裸取值行（无说明）是写侧支持的既有形态，须继续正确
      const bareLine = readContext().replace(INTEL_FIELD_SUFFIX, '');
      assertTrue(bareLine !== readContext(), '单变量对照前提不成立：段行不含夹具行尾说明');
      writeFile(dir, '.specs/CONTEXT.md', bareLine);
      const quietBare = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(quietBare, 0);
      assertNotOut(quietBare, 'INIT-NOTICE');

      // ⑧ 向后兼容：取值词元带 markdown 引号（`` `…` ``；模板/旧夹具形态）时按词元归一后比对 → 静默
      writeFile(dir, '.specs/CONTEXT.md',
        contextFixtureText().replace(INTEL_FIELD_VALUE + INTEL_FIELD_SUFFIX,
          '`' + converged + '`' + INTEL_FIELD_SUFFIX));
      const quietQuoted = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(quietQuoted, 0);
      assertNotOut(quietQuoted, 'INIT-NOTICE');
    },
  },

  // 309: 漂移判据的形态边界与反向控制（判别力 + 零误报）——① **同一时刻的两种形态**（state 为历史
  // `Z` 值、段侧为本地偏移）也判漂移：提示在场且点名形态差异（修复前该形态零提示、state 被原样保留）；
  // ② 段缺席 = 无可比对面 → 零提示（不无中生有）；③ 段内取值不可解析（占位）→ 仍判漂移（不静默）；
  // 提示一律不阻断 init（exit 0）；④ 判据输入端的两条命名声明（段名 / 字段名）跨文件逐字一致——
  // 段行夹具一律**带行尾说明**（真实生成件形态）：整行口径的读侧会让 ① 退化成「取值非法」、③ 的
  // 类别也由说明决定——故 ① 显式断言「同刻不同形态」且不得落到取值非法类别。
  // 两处各写一份字面量是本机制的既有形态（单一来源收口须改到写边界外的脚本，见 SUMMARY 的已知接受），
  // 故此处把「不得静默漂移」机检化：任一侧改名即红，而漂移的后果正是 ② 的静默路径。
  {
    name: '309 漂移判据边界：同刻不同形态必报 + 段缺席零误报 + 段内占位取值不静默 + 命名声明跨文件一致',
    run: (dir) => {
      const readContext = () => fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      const readLandedState = () => JSON.parse(
        fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8')).last_intel_scan;

      // ① state = `Z` 形态（历史写入的真实形态）；段 = 同一时刻的「本地时间 + 显式偏移」，**带行尾说明**
      //    （真实生成件形态）——两侧同刻 ⇒ 类别必须是「同刻不同形态」，不得退化成取值非法
      const zForm = '2026-09-24T18:14:23Z';
      const localForm = '2026-09-25T02:14:23+08:00';
      writeState(dir, { ...baseState('open'), last_intel_scan: zForm });
      writeFile(dir, '.specs/CONTEXT.md',
        contextFixtureText().replace(INTEL_FIELD_VALUE, localForm));
      const sameMoment = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(sameMoment, 0);
      assertOut(sameMoment, 'INIT-NOTICE');
      assertOut(sameMoment, '同刻不同形态');
      assertNotOut(sameMoment, '段内取值不是合法时间戳');
      assertOut(sameMoment, zForm);
      assertOut(sameMoment, localForm);
      assertEqual(readLandedState(), zForm, '未刷新路径不得改写既有扫描时刻');

      // ② 段缺席（CONTEXT 不含 intel-scan 段）→ 无可比对面 → 零提示
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText({ intelSection: false }));
      const noSection = runStateWithProtocol(dir, ['init', CHANGE_ID + '-no-section']);
      assertExit(noSection, 0);
      assertNotOut(noSection, 'INIT-NOTICE');

      // ③ 段内取值词元不可解析（占位形态）→ 仍判漂移且点明该类别（静默放过会让「段侧从未被正确
      //    写入」长期不可见）；占位词元之后的说明不参与判定（类别由词元决定）
      writeFile(dir, '.specs/CONTEXT.md',
        contextFixtureText().replace(INTEL_FIELD_VALUE, '（待扫描）'));
      const placeholder = runStateWithProtocol(dir, ['init', CHANGE_ID + '-placeholder']);
      assertExit(placeholder, 0);
      assertOut(placeholder, 'INIT-NOTICE');
      assertOut(placeholder, '段内取值不是合法时间戳');
      assertOut(placeholder, '（待扫描）');

      // ④ 取值词元口径的夹具前提（合成输入 · 纯函数口径）：段行带行尾说明时，结构提取返回的是
      //    「词元 + 说明」整串——按整行比对会落「取值非法」（缺陷形态），按词元比对才落正确类别
      //    （类别本身已在 ① 的真实命令面断言）。此处把夹具形态与词元提取钉住：夹具若退回裸词元，
      //    本锚立即红（防「缺陷形态重新变得不可见」的假绿）。
      const fieldsWithSuffix = requireModuleExport(contextInitModule, 'extractContextStructure', 'context-init.mjs')(
        contextFixtureText()).metadata['intel-scan 元数据'].last_intel_scan.value;
      assertTrue(fieldsWithSuffix.includes(INTEL_FIELD_SUFFIX),
        '夹具段行未带行尾说明（真实生成件形态前提不成立）: ' + JSON.stringify(fieldsWithSuffix));
      assertTrue(intelFieldToken(fieldsWithSuffix) === INTEL_FIELD_VALUE,
        '取值词元口径提取错误: ' + JSON.stringify(intelFieldToken(fieldsWithSuffix)));

      // ⑤ 命名声明跨文件一致（结构锚 + 反向构造）：init 侧按段名 / 字段名定位段内取值，两处声明
      //    漂移会让判据静默退化成 ② 的「无可比对面」——故两处字面量必须逐字相等，合成改写即红。
      const consumerText = fs.readFileSync(path.join(SCRIPTS_DIR, 'workflow-state.mjs'), 'utf8');
      const producerText = fs.readFileSync(SIDE_CONTEXT_SCAN, 'utf8');
      const namingProblems = intelMetadataNameProblems(consumerText, producerText);
      assertEqual(namingProblems.length, 0, 'intel-scan 命名声明漂移: ' + namingProblems.join(' | '));
      const tamperedSection = producerText.replace("'intel-scan 元数据'", "'intel-scan 元数据（漂移）'");
      assertTrue(tamperedSection !== producerText, '反向构造前提不成立：重扫命令侧缺段名字面量声明');
      assertTrue(intelMetadataNameProblems(consumerText, tamperedSection)
        .some((problem) => problem.includes('段名字面量两处声明不一致')),
      '段名漂移未被判定（判别力缺失）');
      const tamperedField = producerText.replace("'last_intel_scan'", "'last_intel_scan_v2'");
      assertTrue(tamperedField !== producerText, '反向构造前提不成立：重扫命令侧缺字段名字面量声明');
      assertTrue(intelMetadataNameProblems(consumerText, tamperedField)
        .some((problem) => problem.includes('字段名字面量两处声明不一致')),
      '字段名漂移未被判定（判别力缺失）');
    },
  },
];
