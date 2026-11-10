// 场景组 b — 委托链路 · 签名与机制交互 · hook 写白名单 · 初始化与状态兼容
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import {
  assertEqual,
  assertExit,
  assertNotOut,
  assertOut,
  assertTrue,
  baseState,
  installSkillTreeCopy,
  runGuard,
  runHandoff,
  runHook,
  runPrintedCommand,
  runState,
  splitPrintedCommand,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  SCRIPTS_DIR,
  TASK_DONE,
  TASK_P1,
  TASK_P2_PENDING,
  TASK_T03_PENDING,
  TASK_TFIX,
  composeState,
  customProtocol,
  customProtocolWithSkillCall,
  dropNamedImport,
  engineCodeText,
  engineScriptTexts,
  handoffFor,
  scriptTreeFiles,
  strictSummary,
  summaryContent,
  writeCustomProtocol,
  writeNodeDeclarationMarkers,
} from '../lib/test-fixtures.mjs';
// 单一来源静态锁（write_files 条目切分只有一处实现）：与套件其它单源锚共用同一判据实现。
import { singleSourceImportProblems } from '../lib/text-anchor-checks.mjs';
import {
  assertStateBytesUnchanged,
  readStateBytes,
  requireRouteNodeExport,
  runGuardWithProtocol,
  runStateWithProtocol,
  scenarioProtocolPath,
} from '../lib/test-assertions.mjs';
// 恢复指引的路径形态参照物：打印出来的命令必须与 scriptCommand 的产物逐字一致（同一推导，不另写一份）。
import { scriptCommand } from '../lib/state-explain.mjs';

// ---------- 打印出来的命令：解析 → 真实执行（本组锚点；命令形态必须可复制、可执行） ----------
//
// 背景：运行期消息曾把脚本命令写成未加引号的单一平台字面量，测试只断言字面串、随后改用 harness
// 的绝对路径执行，于是「打印出来的那条命令」从未被真正执行过（形似全绿）。链路的三个夹具——按安装
// 布局复制技能树、把打印命令切成 argv、真实执行打印文本——由两组场景共用，单一来源在
// lib/test-helpers.mjs；本段只留本组自有的一件：跑副本脚本，以及命令形态（引号 / 分词 / 路径
// 可解析）的断言。

// 跑指定脚本（副本形态）：cwd = 夹具根（与 run* 助手同一运行根口径）。
function runScriptCopy(scriptPath, args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 打印命令的形态解析（下面两条断言的共用前半段）：① 脚本路径整条加双引号；② 分词后脚本参数恰
// 好是那一条路径（引号被剥离、空格不裂开）；③ 路径按**当前运行形态**解析后真实存在。不写死任
// 何平台根：只问「能不能解析到脚本」，不问它以哪个平台目录开头。hint 是形态说明，只拼进不可解
// 析报文——两种形态都可接受时，让失败消息说清放宽的是哪两种。
function parsePrintedCommandScript(command, root, label, hint = '') {
  const match = command.match(/^node "([^"]+)"(?: .*)?$/);
  if (!match) {
    throw new Error(label + ' 的脚本路径未整条加双引号（安装根含空格时会被 shell 分词）: ' + command);
  }
  const printedScript = match[1];
  const argv = splitPrintedCommand(command);
  if (argv[1] !== printedScript) {
    throw new Error(label + ' 的脚本路径被分词拆开: ' + JSON.stringify(argv));
  }
  const resolved = path.resolve(root, printedScript);
  if (!fs.existsSync(resolved)) {
    throw new Error(label + ' 的脚本路径按当前运行形态不可解析' + hint + ': ' + printedScript + ' → ' + resolved);
  }
  return { printedScript, resolved };
}

// 期望脚本同一性断言（夹具内的运行形态已知时使用）：④ 解析结果与期望副本是同一文件。
function assertPrintedCommandResolves(command, root, expectedScript, label) {
  const { printedScript, resolved } = parsePrintedCommandScript(command, root, label);
  if (fs.realpathSync(resolved) !== fs.realpathSync(expectedScript)) {
    throw new Error(label + ' 解析到了别的脚本: ' + resolved + '（期望 ' + expectedScript + '）');
  }
  return printedScript;
}

// 恢复段里「哪些行是可执行命令」的判据（两处恢复段共用）：命令行 = 行首即 node + 引号脚本路径，
// 其余行是步骤标注与说明。判据分两半——① 可执行行集合与期望逐字相等（多一行说明被拼进命令、或少
// 一行命令，照抄都会断）；② 说明行不得出现命令形态（说明接回命令行尾时，整行丢给 shell 会把说明当
// 成参数，命令看起来在场、照抄即失败）。返回命令行（调用方随后逐条真实执行——「能解析」不等于「能跑」）。
function shellCommandLines(block) {
  return String(block ?? '').split(/\r?\n/u)
    .filter((line) => /^\s*node\s+"/u.test(line))
    .map((line) => line.trim());
}

function assertRecoveryCommandLines(block, expected, label) {
  const commands = shellCommandLines(block);
  assertTrue(commands.length === expected.length && commands.every((line, index) => line === expected[index]),
    label + '：恢复段的可执行行应恰好是期望的命令（顺序一致）:\n命令=' + JSON.stringify(commands)
      + '\n期望=' + JSON.stringify(expected) + '\n原文:\n' + block);
  for (const line of String(block ?? '').split(/\r?\n/u)) {
    if (line.trim() === '' || /^\s*node\s+"/u.test(line)) continue;
    assertTrue(!/node\s+"[^"]+"/u.test(line),
      label + '：说明行里出现了命令文本（命令须单独成行，否则整行不可执行）: ' + line);
  }
  return commands;
}

// 安装根形态断言（运行形态由脚本自定位决定、夹具无从预知时使用）：④ 解析出的命令脚本必须是真实
// 存在的 <scriptName>，且落在 flow-comet 技能树内。两种正确形态都放行——安装副本按**运行中脚本
// 所在的安装根**推出的路径（.claude / .agents / .dsh 乃至用户级安装），以及权威源写出的设计形态
// .claude/skills/…（在夹具里解析到技能树副本）。命令是否真的能在当前安装里照抄执行，由调用方随后
// 执行**打印出来的那条文本**证明——本断言不拿 harness 的脚本路径替代它。
function assertPrintedCommandTargetsInstalledScript(command, root, scriptName, label) {
  const { printedScript, resolved } = parsePrintedCommandScript(command, root, label,
    '（允许安装根形态或 fixture 设计形态）');
  if (path.basename(resolved) !== scriptName) {
    throw new Error(label + ' 解析到的不是 ' + scriptName + '（允许安装根形态或 fixture 设计形态）: ' + resolved);
  }
  if (!resolved.split(/[\\/]+/).includes('flow-comet')) {
    throw new Error(label + ' 解析到的脚本不在 flow-comet 技能树内（允许安装根形态或 fixture 设计形态）: ' + resolved);
  }
  return printedScript;
}

export const ENTRIES = [

  // ----------  场景（handoff completedChecks 严格校验，handoff-guarded 落实） ----------

  // 34: subagent-execute exit 通过——handoff result 的 completedChecks 含 required-skill 条目 → exit 0
  {
    name: '34 subagent-execute exit 通过：handoff 含 completedChecks + 缺证据恢复命令可照抄执行',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', strictSummary('P01'));
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = {
        summary: 'delegated and collected',
        handoffResult: handoffFor(['P01']),
      };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');

      // ---------- 缺证据阻塞给出可复制恢复命令（in-place 扩展；不新增场景条目） ----------
      // ① 移除 evidence.summary（record 只写 summary 的合法路径）→ exit 命中 missing Output
      // Schema evidence；BLOCKED 行之后必须给出可照抄的恢复命令，照抄执行后同一 exit 通过。
      const stateFile = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const stNoEvidence = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      delete stNoEvidence.evidence['subagent-execute'].summary;
      writeState(dir, stNoEvidence);
      // 前提：本节点还没有技能加载声明标记（record 的前置门）——报文必须把这道前置条件一并给全。
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      if (fs.existsSync(loadsDir)) {
        throw new Error('夹具前提不成立：缺声明分支要求 .skill-loads/ 不存在（实际: ' + loadsDir + '）');
      }
      const resNoEvidence = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(resNoEvidence, 1);
      assertOut(resNoEvidence, 'BLOCKED: missing Output Schema evidence');
      assertOut(resNoEvidence, '{"summary":"<本节点完成摘要>"}');
      assertOut(resNoEvidence, '后重试 exit');
      // ② 恢复命令**从输出解析**（不再与字面串比对——字面量断言正是此前漏检的成因）。缺技能加载声明
      // 时照抄 record 会被它自己的前置门拦下（「节点缺少技能加载声明标记」），半步恢复 = 还得去另一条
      // 报文里找 skill-load 命令；故两条命令必须落在**同一段「恢复:」**里（本段 = 输出里最后一条恢复段，
      // 该段之后引擎直接退出）。
      const recoveryStart = resNoEvidence.output.lastIndexOf('恢复:');
      const recoveryBlock = recoveryStart < 0 ? '' : resNoEvidence.output.slice(recoveryStart);
      if (recoveryBlock === '') {
        throw new Error('BLOCKED 输出缺恢复段:\n' + resNoEvidence.output);
      }
      const recordCommand = (recoveryBlock.match(/^\s*(node "[^"]+" record [^\n]*)$/m) || [])[1];
      const skillLoadCommand = (recoveryBlock.match(/^\s*(node "[^"]+" skill-load [^\n]+)$/m) || [])[1];
      if (!recordCommand) {
        throw new Error('BLOCKED 输出的恢复段缺可解析的 record 命令:\n' + resNoEvidence.output);
      }
      if (!skillLoadCommand) {
        throw new Error('缺技能加载声明时恢复段必须同时给出 skill-load 命令'
          + '（否则照抄 record 会被它的前置门拦下，第二步的命令又落在另一条报文里）:\n' + resNoEvidence.output);
      }
      // 恢复段的可执行行 = 这两条命令，顺序即执行顺序；其余行都是说明——说明不得带命令形态（同一行里
      // 「命令 + 说明」整行丢给 shell 会把说明当成参数，正是可照抄性失效的形态）。
      assertRecoveryCommandLines(recoveryBlock, [skillLoadCommand, recordCommand], '缺声明的缺证据恢复段');
      // 协议上下文跟「本次实际用到的协议」走，不跟来源走：本段的协议来自调用方环境（runGuard 注入
      // FLOW_COMET_PROTOCOL = 夹具内的协议副本），它不是内置默认那一份——副本路径与内置默认不同，
      // 照抄时不带 --protocol 就会按同一套优先级重新解析。故命令必须自带协议路径（与「协议来自
      // state」那条同一判据，见本场景末尾；来源是 env 时此前只印命令，照抄即落到默认协议）。
      for (const [label, recoveredCommand] of [['record', recordCommand], ['skill-load', skillLoadCommand]]) {
        if (!recoveredCommand.includes(' --protocol "reference/workflow-protocol.json"')) {
          throw new Error('协议来自环境变量且不是内置默认时，恢复段的 ' + label + ' 命令必须自带 '
            + '--protocol "reference/workflow-protocol.json"（否则照抄时协议上下文丢失）: ' + recoveredCommand);
        }
      }
      // ③ 两条命令的脚本路径逐字等于 scriptCommand 的产物（路径与引号只有一处实现——换一种拼法在此判红）。
      const printedPathPrefix = scriptCommand({ scriptsDir: SCRIPTS_DIR, runRoot: dir, script: 'workflow-state.mjs' });
      for (const [label, recoveredCommand] of [['record', recordCommand], ['skill-load', skillLoadCommand]]) {
        if (!recoveredCommand.startsWith(printedPathPrefix + ' ')) {
          throw new Error('恢复段的 ' + label + ' 命令脚本路径应逐字等于 scriptCommand 产物 '
            + printedPathPrefix + '，实际: ' + recoveredCommand);
        }
      }
      // 安装布局：权威源 = 设计形态（安装器把它装到平台根下）；把本套件技能树按该布局复制进夹具，
      // 权威源形态打印的相对路径才可解析。两种正确形态都放行——① 安装副本：命令路径按**运行中脚本
      // 所在的安装根**推导（<安装根>/.claude/skills/… 的绝对路径——副本里照抄可执行的就是这条）；
      // ② 权威源：设计形态 .claude/skills/…（在夹具里解析到上面这份副本）。断言只问「解析到的是不
      // 是真实存在的 workflow-state.mjs」——存在性 + 脚本名 + 随后真执行打印文本（不拿 harness 的
      // 路径替代），不把路径钉成 fixture 路径（L-072：布局感知缺失会让安装副本套件变红）。
      installSkillTreeCopy(dir, path.join('.claude', 'skills'));
      assertPrintedCommandTargetsInstalledScript(recordCommand, dir, 'workflow-state.mjs', '恢复命令');
      assertPrintedCommandTargetsInstalledScript(skillLoadCommand, dir, 'workflow-state.mjs', '前置声明命令');
      // ④ 照抄打印出来的两条命令并真实执行（不是 harness 的绝对脚本路径）：按报文给出的执行顺序
      // 先声明、再 record。走通这两步才说明「一条报文 = 一条恢复路径」。
      // 环境变量清空：协议上下文只能来自命令本身——命令没带 --protocol 时这一步会落到内置默认协议
      // （项目根之外）而不是夹具里的那份，照抄即失败。
      const resDeclared = runPrintedCommand(skillLoadCommand, dir, {
        FLOW_COMET_RUN_ROOT: dir,
        FLOW_COMET_PROTOCOL: '',
      });
      assertExit(resDeclared, 0);
      assertOut(resDeclared, 'SKILL-LOAD: subagent-execute');
      const declaredMarkers = fs.readdirSync(loadsDir)
        .filter((name) => name.startsWith('subagent-execute-') && name.endsWith('.json'));
      if (declaredMarkers.length === 0) {
        throw new Error('照抄前置声明命令后应有 .skill-loads/subagent-execute-*.json'
          + '（record 前置门按该前缀判定）: ' + JSON.stringify(fs.readdirSync(loadsDir)));
      }
      const resRecoveredByCommand = runPrintedCommand(recordCommand, dir, {
        FLOW_COMET_RUN_ROOT: dir,
        FLOW_COMET_PROTOCOL: '',
      });
      assertExit(resRecoveredByCommand, 0);
      const stRecovered = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (stRecovered.evidence['subagent-execute'].summary !== '<本节点完成摘要>') {
        throw new Error('照抄恢复命令后 evidence.summary 未按打印载荷写入，实际: '
          + JSON.stringify(stRecovered.evidence['subagent-execute']));
      }
      const resEvidenceRecovered = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(resEvidenceRecovered, 0);
      assertOut(resEvidenceRecovered, 'ALL CHECKS PASSED');
      // ⑤ 声明已在场 → 恢复段收敛回一条 record（不多给一步）：同样的缺证据阻塞，恢复段里不得再出现
      // skill-load 步骤。断言只看恢复段，别的门的提示不在本断言范围。
      const stAgain = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      delete stAgain.evidence['subagent-execute'].summary;
      writeState(dir, stAgain);
      const resDeclaredMissing = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(resDeclaredMissing, 1);
      assertOut(resDeclaredMissing, 'BLOCKED: missing Output Schema evidence');
      const declaredRecoveryStart = resDeclaredMissing.output.lastIndexOf('恢复:');
      const declaredRecovery = declaredRecoveryStart < 0 ? '' : resDeclaredMissing.output.slice(declaredRecoveryStart);
      const singleRecordCommand = (declaredRecovery.match(/^\s*(node "[^"]+" record [^\n]*)$/m) || [])[1];
      if (!singleRecordCommand) {
        throw new Error('已有声明时恢复段缺 record 命令:\n' + resDeclaredMissing.output);
      }
      // 恢复段的两行结构：说明行（「照抄下面的命令…」）+ 命令行 + 说明行（怎么执行）。命令行单独成行，
      // 整行丢给 shell 才是那条可执行的命令——这是「照抄即通」的形态判据（执行面由下面那行证明）。
      assertRecoveryCommandLines(declaredRecovery, [singleRecordCommand], '已有声明的缺证据恢复段');
      if (!declaredRecovery.startsWith('恢复: ')) {
        throw new Error('已有声明时恢复段应以「恢复:」开口:\n' + declaredRecovery);
      }
      if (/第一步|第二步/s.test(declaredRecovery)) {
        throw new Error('已有声明时恢复段不得再给分步标注（不给多余步骤）:\n' + declaredRecovery);
      }
      if (/skill-load\s/.test(declaredRecovery)) {
        throw new Error('已有声明时恢复段不得再给 skill-load 步骤:\n' + declaredRecovery);
      }
      // 复位：照抄该 record 把证据补回去，后续段从「证据齐 + 有声明」的形态继续
      assertExit(runPrintedCommand(singleRecordCommand, dir, {
        FLOW_COMET_RUN_ROOT: dir,
        FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir),
      }), 0);

      // ---------- 开工前可见的 LESSONS 命中集（原位扩展；不新增场景条目） ----------
      // 出口按「任务 write_files 的路径段（过停用词）× .specs/LESSONS.md 条目的关键词行」重算命中集
      // （前 5 条），并要求 SUMMARY 的 ## LESSONS 扫描 段逐条回应这些编号；执行者开工时看不到这个
      // 集合，只能按自己对任务主题的理解扫，两套口径只在出口对齐 —— 本段做对账：request 打印的
      // 命中集必须与出口重算的逐条一致（同一份命中算法驱动两处，各算一套必在此红）。
      const lessonsLedger = [
        '# LESSONS — 跨任务失败知识库（夹具）',
        '',
        '## 条目区（夹具）',
        '',
        '### L-501 · [proc] 门禁按结构级校验',
        '',
        '- **关键词**: guard, template',
        '',
        '夹具条目正文：判据按结构级校验，不做语义判断。',
        '',
        '### L-502 · [test] 归档提名须留痕',
        '',
        '- **关键词**: template, archive',
        '',
        '夹具条目正文：归档提名须留痕。',
        '',
        '### L-503 · [doc] 与任务写路径无交集的条目',
        '',
        '- **关键词**: nomination, release',
        '',
        '夹具条目正文：本条与任务写路径无交集，不得出现在命中集里（反向构造）。',
        '',
      ].join('\n');
      writeFile(dir, '.specs/LESSONS.md', lessonsLedger);
      // 任务的写面换成与教训册关键词有交集的路径：夹具路径 src/p1.mjs 的词元是 p1，长度不足被过滤
      // —— 命中集恒空，锚不出差异。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="P01" status="done" parallel="true"><action>改模板保真门禁</action>'
        + '<write_files>scripts/lib/guard-template-fidelity.mjs</write_files>'
        + '<verify>node --check src/p1.mjs</verify></task>\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', strictSummary('T01'));
      // ① 出口重算：扫描段没回应命中条目 → 逐条列出编号（旧 change 渐进不阻断）
      const exitLessons = runGuard(['exit', 'subagent-execute'], dir);
      assertOut(exitLessons, '未回应命中条目 L-501');
      const exitHitIds = ((exitLessons.output.match(/未回应命中条目 ([^\n]*)/) || [])[1] || '').match(/L-\d+/g) || [];
      assertEqual(exitHitIds.length, 2, '出口重算的命中条目数');
      // ② request 开工前打印同一集合，顺序也一致（共享词多者在前）
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/subagent-execute-flow-comet-dev.json',
        JSON.stringify({ node: 'subagent-execute', skill: 'flow-comet-dev', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const reqLessons = runHandoff(['request', 'P01', 'lesson hits preview'], dir);
      assertExit(reqLessons, 0);
      assertOut(reqLessons, 'LESSONS-HITS: 2 条');
      assertOut(reqLessons, '这些条目须在 SUMMARY 的 `## LESSONS 扫描` 段逐条回应');
      const requestHitIds = reqLessons.output.split('\n')
        .filter((line) => /^ {2}- L-\d+ · /.test(line))
        .map((line) => (line.match(/L-\d+/) || [])[0]);
      assertEqual(JSON.stringify(requestHitIds), JSON.stringify(exitHitIds),
        'request 的命中集必须与出口重算逐条一致（同一函数驱动）');
      assertNotOut(reqLessons, 'L-503');
      // ③ 教训册不可读 → 一行降级提示：request 不失败、不编造条目
      fs.rmSync(path.join(dir, '.specs', 'LESSONS.md'));
      const reqNoLedger = runHandoff(['request', 'P01', 'ledger missing'], dir);
      assertExit(reqNoLedger, 0);
      assertOut(reqNoLedger, 'LESSONS-HITS: 无法计算');
      assertNotOut(reqNoLedger, 'L-501');
      // ④ 边界：任务本身不声明写面 → 明确「无可回应条目」，不静默跳过（教训册先复位，命中的判据
      // 才只剩「任务没有写面」这一条）
      writeFile(dir, '.specs/LESSONS.md', lessonsLedger);
      // 原位扩展（写面提取单一来源 / 不跨任务）：把**未声明写面**的任务放在声明了写面的任务之前——
      // 按块取的提取不越过 </task>，缺失就是缺失；旧实现用「<task id=…> 到全文下一个 <write_files>」
      // 的单条非贪婪正则，会取到下一个任务的写面：同一次 request 一边打印「未声明 write_files」，
      // 一边把下一个任务的路径记成本任务的提交边界（提交子集校验随后按别人的白名单放行）。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="P03" status="done" parallel="true"><action>无写文件任务</action>'
        + '<verify>node --check src/p3.mjs</verify></task>\n'
        + '<task id="P04" status="pending" parallel="true"><action>相邻任务</action>'
        + '<write_files>src/p04.mjs</write_files><verify>node --check src/p04.mjs</verify></task>\n');
      const reqNoWriteFiles = runHandoff(['request', 'P03', 'no write files'], dir);
      assertExit(reqNoWriteFiles, 0);
      assertOut(reqNoWriteFiles, '无可回应条目（任务 P03 未声明 write_files）');
      // 同一次 request 的另一半：写面不可解析 → 渐进提示（旧 change 不阻断），且不记录写面
      assertOut(reqNoWriteFiles, '委托任务不可解析');
      const stNoWrite = JSON.parse(readStateBytes(dir));
      const reqNoWrite = stNoWrite.evidence?.['subagent-execute']?.handoffRequests?.P03;
      if (!reqNoWrite) {
        throw new Error('写面不可解析的 request 仍应照常记录（旧 change 渐进），实际 evidence: '
          + JSON.stringify(stNoWrite.evidence));
      }
      if (Array.isArray(reqNoWrite.writeFiles) && reqNoWrite.writeFiles.length > 0) {
        throw new Error('未声明写面的任务不得记录写面，实际: ' + JSON.stringify(reqNoWrite.writeFiles));
      }
      if (JSON.stringify(stNoWrite).includes('src/p04.mjs')) {
        throw new Error('未声明写面的任务把相邻任务的路径记进了 state（跨任务取值）: ' + JSON.stringify(reqNoWrite));
      }
      // 同一份 TASK 在**新 change** 下：写面缺失必须在入口 BLOCK——旧实现借来相邻任务的写面，request
      // 因而放行，越界要等到提交子集校验才炸。BLOCK 路径 state 字节零改写。
      const newChangeState = baseState('subagent-execute');
      writeState(dir, newChangeState);
      const bytesBeforeBlock = readStateBytes(dir);
      const reqNoWriteNew = runHandoff(['request', 'P03', 'no write files new change'], dir);
      assertExit(reqNoWriteNew, 1);
      assertOut(reqNoWriteNew, 'BLOCKED: 委托任务不可解析');
      assertStateBytesUnchanged(dir, bytesBeforeBlock, '写面缺失的新 change request');
      // ⑤ 边界：TASK.md 里没有该任务（写面由显式参数给出）→ 同样给出明确说明
      const reqNoTask = runHandoff(['request', 'P99', 'no such task', '--write-files', 'src/p99.mjs'], dir);
      assertExit(reqNoTask, 0);
      assertOut(reqNoTask, '无可回应条目（TASK.md 无匹配任务 P99）');

      // ---------- write_files 条目切分单一来源（原位扩展；不新增场景条目） ----------
      // 条目边界（剥 HTML 注释 → 行切 → 分号容错切 → trim → 滤空）此前有**三份**：本文件的本地
      // writeFilesEntries、plan 出口伪并行启发式的内联链、task-graph 的 parsePaths。三处各自自洽时，
      // 同一份写面会在不同门禁里变成不同条目集（注释里的词被当成路径、分号行只取首项），而两处不会
      // 同时红——所以「谁越界」「哪一对并行任务重叠」可以互相矛盾却全绿。
      // ① 行为：request 记录的允许列表 = 共享切分的产物（注释不进入条目、分号行二次切分、空行滤掉）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="P05" status="pending"><action>写面切分夹具</action>'
        + '<write_files>\n'
        + '  <!-- 夹具注释：注释里的 src/ghost.mjs 不得成为条目 -->\n'
        + '  src/a.mjs; src/b.mjs\n'
        + '\n'
        + '  src/c.mjs\n'
        + '</write_files><verify>node --check src/a.mjs</verify></task>\n');
      const reqSplit = runHandoff(['request', 'P05', 'write files split'], dir);
      assertExit(reqSplit, 0);
      const splitRecorded = JSON.parse(readStateBytes(dir))
        .evidence?.['subagent-execute']?.handoffRequests?.P05?.writeFiles;
      assertEqual(JSON.stringify(splitRecorded), JSON.stringify(['src/a.mjs', 'src/b.mjs', 'src/c.mjs']),
        'request 记录的写面条目（剥注释 / 分号二次切分 / 滤空后的规范形态）');
      // ② 结构锚：条目切分只有一处定义，且三个消费方都从它取用（新增第四处或退回内联副本即红）
      const splitTexts = engineScriptTexts();
      const splitProblems = singleSourceImportProblems({
        symbol: 'writeFilesEntries',
        sourceRel: 'lib/lessons-hits.mjs',
        texts: splitTexts,
      });
      assertTrue(splitProblems.length === 0,
        'write_files 条目切分应只有一处实现且消费方都从它取用:\n' + splitProblems.join('\n'));
      // ③ 反向构造（判别力）：把某个消费方的具名取用摘掉 → 结构锚必须报出来（否则 ② 只是「看起来有」）
      const splitMutated = new Map(splitTexts);
      splitMutated.set('workflow-handoff.mjs',
        dropNamedImport(splitMutated.get('workflow-handoff.mjs'), 'writeFilesEntries'));
      const splitMutatedProblems = singleSourceImportProblems({
        symbol: 'writeFilesEntries',
        sourceRel: 'lib/lessons-hits.mjs',
        texts: splitMutated,
      });
      assertTrue(splitMutatedProblems.some((problem) => problem.includes('workflow-handoff.mjs')),
        '摘掉消费方的具名取用后结构锚未报出（判据没有判别力）: ' + JSON.stringify(splitMutatedProblems));

      // ---------- 打印命令链的夹具单一来源（原位扩展；不新增场景条目） ----------
      // 「按安装布局复制技能树 → 把打印命令切成 argv → 真实执行打印文本」这三个夹具此前在委托链路组
      // 与声明恢复组各有一份（逐字复制、含注释）：同一条命令在两组的判据里各自演化，任一侧漂移都不会
      // 让另一侧变红。判据 = 三个夹具的定义只有一处（lib/test-helpers.mjs），凡在代码里引用它们的模块
      // 都从那里具名取用——落点与消费方都由真实形态派生，新增第三份复制即红。既有断言只看行为（各组
      // 自己的照抄闭环），两组行为都自洽时漂移是静默的，故这一层结构锚不能省。
      const chainFixtures = ['installSkillTreeCopy', 'splitPrintedCommand', 'runPrintedCommand'];
      const chainSourceRel = 'lib/test-helpers.mjs';
      const treeTexts = new Map(scriptTreeFiles()
        .map((rel) => [rel, fs.readFileSync(path.join(SCRIPTS_DIR, rel), 'utf8')]));
      for (const symbol of chainFixtures) {
        const chainProblems = singleSourceImportProblems({ symbol, sourceRel: chainSourceRel, texts: treeTexts });
        assertTrue(chainProblems.length === 0, '打印命令链的夹具 ' + symbol + ' 应只有一处实现、且引用方都从 '
          + chainSourceRel + ' 取用:\n' + chainProblems.join('\n'));
        // 反向构造（判别力）：摘掉某个真实消费方的具名取用 → 结构锚必须点名它（否则上一条只是「看起来有」）
        const symbolRe = new RegExp('\\b' + symbol + '\\b');
        const consumerRel = [...treeTexts.keys()].find((rel) =>
          rel !== chainSourceRel && symbolRe.test(engineCodeText(treeTexts.get(rel))));
        if (!consumerRel) {
          throw new Error('反向构造的前提不成立：' + symbol + ' 在 ' + chainSourceRel + ' 之外没有代码层消费者');
        }
        const mutated = new Map(treeTexts).set(consumerRel, dropNamedImport(treeTexts.get(consumerRel), symbol));
        const reported = singleSourceImportProblems({ symbol, sourceRel: chainSourceRel, texts: mutated });
        assertTrue(reported.some((problem) => problem.includes(consumerRel)),
          '摘掉 ' + consumerRel + ' 的具名取用后结构锚未点名它（判据没有判别力）: ' + JSON.stringify(reported));
      }

      // ---------- 协议上下文随恢复命令传播（原位扩展；不新增场景条目） ----------
      // guard 解析协议的顺序包含 state.protocolPath（init 持久化绑定），而 workflow-state /
      // workflow-handoff 只走 --protocol CLI → FLOW_COMET_PROTOCOL → 内置默认，不读 state 绑定。
      // 于是照抄 guard 打印的恢复命令时协议上下文丢失：自定义协议的节点名在 env/默认协议里不存在，
      // 第一步就撞「skill-load node 非法」——报文给了命令，命令却跑不进同一个协议。
      // 判据：协议来自 state → 命令自带 --protocol 且照抄可执行；来自 env / 内置默认 → 不加
      // （协议上下文已由调用方的命令或环境携带，重复印一遍只是噪音）。
      const boundProtocolRel = 'custom-protocol.json';
      writeFile(dir, boundProtocolRel, JSON.stringify(customProtocolWithSkillCall(), null, 2) + '\n');
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      // evidence 在场才走得出前置的「无证据」门（那条报文不打印可照抄命令）：本段要考的是
      // Output Schema evidence 缺失时的两步恢复，故放一个空证据对象，缺的正是 schema 要求的字段。
      writeState(dir, composeState({ currentNode: 'brainstorm', protocolPath: boundProtocolRel, evidence: { brainstorm: {} } }));
      const boundLoadsDir = path.join(dir, '.specs', 'compose-demo', '.skill-loads');
      if (fs.existsSync(boundLoadsDir)) {
        throw new Error('夹具前提不成立：缺声明分支要求 .skill-loads/ 不存在（实际: ' + boundLoadsDir + '）');
      }
      const boundBlocked = runGuard(['exit', 'brainstorm'], dir, { FLOW_COMET_PROTOCOL: '' });
      assertExit(boundBlocked, 1);
      assertOut(boundBlocked, 'BLOCKED: missing Output Schema evidence: compose.notes.v1.notes-summary');
      const boundRecoveryStart = boundBlocked.output.lastIndexOf('恢复:');
      const boundRecovery = boundRecoveryStart < 0 ? '' : boundBlocked.output.slice(boundRecoveryStart);
      const boundRecordCommand = (boundRecovery.match(/^\s*(node "[^"]+" record [^\n]*)$/m) || [])[1];
      const boundSkillLoadCommand = (boundRecovery.match(/^\s*(node "[^"]+" skill-load [^\n]+)$/m) || [])[1];
      if (!boundRecordCommand || !boundSkillLoadCommand) {
        throw new Error('state 绑定自定义协议的恢复段必须同时给出 skill-load 与 record 命令:\n' + boundBlocked.output);
      }
      // ① 正例：两条命令都带 --protocol（state 绑定的路径）。不带时照抄执行会落到 env/默认协议，
      // brainstorm 在默认 8 节点协议里不存在——恢复路径断在第一句话。
      for (const [label, boundCommand] of [['record', boundRecordCommand], ['skill-load', boundSkillLoadCommand]]) {
        if (!boundCommand.includes(' --protocol "' + boundProtocolRel + '"')) {
          throw new Error('协议来自 state.protocolPath 时，恢复段的 ' + label + ' 命令必须自带 --protocol "'
            + boundProtocolRel + '"（否则照抄时协议上下文丢失）: ' + boundCommand);
        }
      }
      // ② 照抄执行（无环境变量——协议上下文只能来自命令本身）：两步都要真实走通。
      const boundDeclared = runPrintedCommand(boundSkillLoadCommand, dir, {
        FLOW_COMET_RUN_ROOT: dir,
        FLOW_COMET_PROTOCOL: '',
      });
      assertExit(boundDeclared, 0);
      assertOut(boundDeclared, 'SKILL-LOAD: brainstorm');
      const boundRecorded = runPrintedCommand(boundRecordCommand, dir, {
        FLOW_COMET_RUN_ROOT: dir,
        FLOW_COMET_PROTOCOL: '',
      });
      assertExit(boundRecorded, 0);
      const boundStateAfter = JSON.parse(readStateBytes(dir));
      assertEqual(boundStateAfter.evidence?.brainstorm?.summary, '<本节点完成摘要>',
        '照抄的 record 命令写入的 evidence（协议上下文须随命令到达）');
      // ③ 一条报文走完即闭合：同一 exit 不再报缺证据
      const boundPassed = runGuard(['exit', 'brainstorm'], dir, { FLOW_COMET_PROTOCOL: '' });
      assertExit(boundPassed, 0);
      assertOut(boundPassed, 'ALL CHECKS PASSED');

      // ④ 第三种来源：--protocol CLI（state 无绑定、环境变量为空）——判据不看来源，命令同样自带该
      // 协议路径。这正是缺陷形态的原点：用 --protocol 调 guard 时，恢复命令曾不带协议上下文，照抄
      // 一步就落到 env/默认协议（自定义协议里才有的节点名在那份协议里不存在）。
      writeState(dir, composeState({ currentNode: 'brainstorm', evidence: { brainstorm: {} } }));
      const cliBlocked = runGuard(['exit', 'brainstorm', '--protocol', boundProtocolRel], dir, { FLOW_COMET_PROTOCOL: '' });
      assertExit(cliBlocked, 1);
      assertOut(cliBlocked, 'BLOCKED: missing Output Schema evidence: compose.notes.v1.notes-summary');
      const cliRecoveryStart = cliBlocked.output.lastIndexOf('恢复:');
      const cliRecovery = cliRecoveryStart < 0 ? '' : cliBlocked.output.slice(cliRecoveryStart);
      const cliRecordCommand = (cliRecovery.match(/^\s*(node "[^"]+" record [^\n]*)$/m) || [])[1];
      if (!cliRecordCommand) {
        throw new Error('协议来自 --protocol CLI 时，恢复段必须给出可照抄的 record 命令:\n' + cliBlocked.output);
      }
      if (!cliRecordCommand.includes(' --protocol "' + boundProtocolRel + '"')) {
        throw new Error('协议来自 --protocol CLI 时，恢复段的 record 命令必须自带 --protocol "'
          + boundProtocolRel + '"（照抄时协议上下文只能来自命令本身）: ' + cliRecordCommand);
      }
      const cliRecorded = runPrintedCommand(cliRecordCommand, dir, {
        FLOW_COMET_RUN_ROOT: dir,
        FLOW_COMET_PROTOCOL: '',
      });
      assertExit(cliRecorded, 0);
      assertEqual(JSON.parse(readStateBytes(dir)).evidence?.brainstorm?.summary, '<本节点完成摘要>',
        '照抄 CLI 来源下打印的 record 命令写入的 evidence');

      // ⑤ 负例：协议来自内置默认（无 CLI、无 state 绑定、无环境变量）→ 命令不加 --protocol。
      // 用安装副本自身的脚本跑：权威源检出的内置协议落在夹具根之外（协议读取要求协议在项目根内），
      // 副本形态才等价于真实安装——默认解析落到的正是包内协议。
      const defaultState = baseState('subagent-execute');
      defaultState.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) };
      writeState(dir, defaultState);
      fs.rmSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true, force: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const defaultBlocked = runScriptCopy(
        path.join(dir, '.claude', 'skills', 'flow-comet', 'scripts', 'workflow-guard.mjs'),
        ['exit', 'subagent-execute'],
        dir,
        { FLOW_COMET_RUN_ROOT: dir, FLOW_COMET_PROTOCOL: '' },
      );
      assertExit(defaultBlocked, 1);
      assertOut(defaultBlocked, 'BLOCKED: missing Output Schema evidence');
      const defaultRecoveryStart = defaultBlocked.output.lastIndexOf('恢复:');
      const defaultRecovery = defaultRecoveryStart < 0 ? '' : defaultBlocked.output.slice(defaultRecoveryStart);
      const defaultRecordCommand = (defaultRecovery.match(/^\s*(node "[^"]+" record [^\n]*)$/m) || [])[1];
      const defaultSkillLoadCommand = (defaultRecovery.match(/^\s*(node "[^"]+" skill-load [^\n]+)$/m) || [])[1];
      if (!defaultRecordCommand || !defaultSkillLoadCommand) {
        throw new Error('内置默认协议下 BLOCKED 输出的恢复段缺可解析命令:\n' + defaultBlocked.output);
      }
      for (const [label, defaultCommand] of [['record', defaultRecordCommand], ['skill-load', defaultSkillLoadCommand]]) {
        if (defaultCommand.includes('--protocol')) {
          throw new Error('协议来自内置默认时，恢复段的 ' + label + ' 命令不应加 --protocol: ' + defaultCommand);
        }
      }

      // ---------- 完全没有证据对象：恢复段同样要是可照抄命令（原位扩展；不新增场景条目） ----------
      // 另一个门禁点：节点连 evidence 对象都没有时，前置的「缺证据」门先命中（早于 Output Schema
      // 证据门）。两处说的是同一件事（节点已完成、证据不在），恢复段必须同形——命令形态一致，缺
      // 声明时**同样按执行顺序给两步**。各写一份时，一处两步、另一处只剩 record：照抄第一条就撞
      // record 自己的声明门，第二步的命令还落在另一条报文里（要两次往返还走不通一条路）。
      writeState(dir, baseState('subagent-execute'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const noEvidenceBlocked = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(noEvidenceBlocked, 1);
      assertOut(noEvidenceBlocked, 'BLOCKED: missing evidence for Node subagent-execute.');
      // ① 命令不是孤立的一句：先点名缺的是这个节点的证据对象
      assertOut(noEvidenceBlocked, '该节点已完成但缺证据记录');
      const noEvidenceRecoveryStart = noEvidenceBlocked.output.lastIndexOf('恢复:');
      const noEvidenceRecovery = noEvidenceRecoveryStart < 0
        ? ''
        : noEvidenceBlocked.output.slice(noEvidenceRecoveryStart);
      const noEvidenceRecordCommand = (noEvidenceRecovery.match(/^\s*(node "[^"]+" record [^\n]*)$/m) || [])[1];
      if (!noEvidenceRecordCommand) {
        throw new Error('完全没有证据对象时，恢复段必须给出可照抄的 record 命令:\n' + noEvidenceBlocked.output);
      }
      // ② 证据整体缺席 + 缺声明 ⇒ 恢复段必须是**两步**（本格核心）：先声明技能加载、再补证据。
      // 只给 record 时，照抄第一步就撞 record 自己的前置门（「节点缺少技能加载声明标记」），第二步
      // 的命令还落在另一条报文里——要两次往返才走通。
      const noEvidenceSkillLoadCommand =
        (noEvidenceRecovery.match(/^\s*(node "[^"]+" skill-load [^\n]+)$/m) || [])[1];
      if (!noEvidenceSkillLoadCommand) {
        throw new Error('证据整体缺席且缺技能加载声明时，恢复段必须同时给出 skill-load 命令'
          + '（否则照抄 record 会被它的前置门拦下，第二步的命令又落在另一条报文里）:\n'
          + noEvidenceBlocked.output);
      }
      const noEvidenceSkillAt = noEvidenceRecovery.indexOf(noEvidenceSkillLoadCommand);
      const noEvidenceRecordAt = noEvidenceRecovery.indexOf(noEvidenceRecordCommand);
      if (!(noEvidenceSkillAt >= 0 && noEvidenceRecordAt > noEvidenceSkillAt)) {
        throw new Error('证据缺席的恢复段应按执行顺序排列：skill-load（声明技能加载）在前、'
          + 'record（补证据）在后——顺序反了执行者照抄会先撞前置门:\n' + noEvidenceRecovery);
      }
      // ③ 与缺 Output Schema 字段那条同一构造：两条命令的脚本路径逐字等于 scriptCommand 的产物、
      // 协议上下文随命令走（照抄时不带 --protocol 就落到另一份协议）
      const noEvidencePathPrefix = scriptCommand({ scriptsDir: SCRIPTS_DIR, runRoot: dir, script: 'workflow-state.mjs' });
      for (const [label, noEvidenceCommand] of [['record', noEvidenceRecordCommand], ['skill-load', noEvidenceSkillLoadCommand]]) {
        if (!noEvidenceCommand.startsWith(noEvidencePathPrefix + ' ')) {
          throw new Error('恢复段的 ' + label + ' 命令脚本路径应逐字等于 scriptCommand 产物 '
            + noEvidencePathPrefix + '，实际: ' + noEvidenceCommand);
        }
        if (!noEvidenceCommand.includes(' --protocol "reference/workflow-protocol.json"')) {
          throw new Error('协议不是内置默认时，恢复段的 ' + label + ' 命令必须自带 --protocol: ' + noEvidenceCommand);
        }
      }
      // ④ 照抄打印出来的两条命令并真实执行（环境变量清空——协议上下文只能来自命令本身）：按报文给的
      // 顺序走完两步，同一 exit 通过，这条报文才是一条完整的恢复路径。
      const noEvidenceDeclared = runPrintedCommand(noEvidenceSkillLoadCommand, dir, {
        FLOW_COMET_RUN_ROOT: dir,
        FLOW_COMET_PROTOCOL: '',
      });
      assertExit(noEvidenceDeclared, 0);
      assertOut(noEvidenceDeclared, 'SKILL-LOAD: subagent-execute');
      const noEvidenceRecovered = runPrintedCommand(noEvidenceRecordCommand, dir, {
        FLOW_COMET_RUN_ROOT: dir,
        FLOW_COMET_PROTOCOL: '',
      });
      assertExit(noEvidenceRecovered, 0);
      assertEqual(JSON.parse(readStateBytes(dir)).evidence?.['subagent-execute']?.summary, '<本节点完成摘要>',
        '照抄前置门的 record 命令写入的 evidence（协议上下文须随命令到达）');
      const noEvidencePassed = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(noEvidencePassed, 0);
      assertOut(noEvidencePassed, 'ALL CHECKS PASSED');
      // ⑤ 声明已在场（上一步刚声明）⇒ 同一门禁点收敛回一条 record：不多给一步（否则把「已经做过
      // 的事」再让人做一遍）。断言只看恢复段。
      writeState(dir, baseState('subagent-execute'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const declaredNoEvidence = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(declaredNoEvidence, 1);
      const declaredNoEvidenceStart = declaredNoEvidence.output.lastIndexOf('恢复:');
      const declaredNoEvidenceBlock = declaredNoEvidenceStart < 0
        ? ''
        : declaredNoEvidence.output.slice(declaredNoEvidenceStart);
      if (!declaredNoEvidenceBlock.includes(noEvidenceRecordCommand)) {
        throw new Error('已有声明时，缺证据的恢复段应仍给出同一条 record 命令:\n' + declaredNoEvidence.output);
      }
      if (/skill-load\s/.test(declaredNoEvidenceBlock) || /第一步|第二步/.test(declaredNoEvidenceBlock)) {
        throw new Error('已有技能声明时恢复段不得再给 skill-load 步骤:\n' + declaredNoEvidenceBlock);
      }
      // ⑥ 反例：内置默认协议下同一门禁点的命令不加 --protocol（照抄时默认解析落到的就是同一份）
      writeState(dir, baseState('subagent-execute'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const defaultNoEvidenceBlocked = runScriptCopy(
        path.join(dir, '.claude', 'skills', 'flow-comet', 'scripts', 'workflow-guard.mjs'),
        ['exit', 'subagent-execute'],
        dir,
        { FLOW_COMET_RUN_ROOT: dir, FLOW_COMET_PROTOCOL: '' },
      );
      assertExit(defaultNoEvidenceBlocked, 1);
      assertOut(defaultNoEvidenceBlocked, 'BLOCKED: missing evidence for Node subagent-execute.');
      const defaultNoEvidenceStart = defaultNoEvidenceBlocked.output.lastIndexOf('恢复:');
      const defaultNoEvidenceRecovery = defaultNoEvidenceStart < 0
        ? ''
        : defaultNoEvidenceBlocked.output.slice(defaultNoEvidenceStart);
      const defaultNoEvidenceCommand =
        (defaultNoEvidenceRecovery.match(/^\s*(node "[^"]+" record [^\n]*)$/m) || [])[1];
      if (!defaultNoEvidenceCommand) {
        throw new Error('完全没有证据对象时恢复段缺可解析的 record 命令:\n' + defaultNoEvidenceBlocked.output);
      }
      if (defaultNoEvidenceCommand.includes('--protocol')) {
        throw new Error('协议来自内置默认时，没有证据对象那条恢复命令不应加 --protocol: ' + defaultNoEvidenceCommand);
      }
    },
  },

  // 35: subagent-execute exit BLOCKED——handoff result 缺 completedChecks（严格模式，无旧 change 豁免）
  // → exit 1：旧格式/缺 completedChecks 的 handoff 在 subagent-execute 重入时被硬性拦截
  {
    name: '35 subagent-execute exit BLOCKED：handoff 缺 completedChecks',
    run: (dir) => {
      const st = baseState('subagent-execute');
      const hr = handoffFor(['P01']);
      delete hr['P01'].result.completedChecks;
      st.evidence['subagent-execute'] = { summary: 'delegated and collected', handoffResult: hr };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'completedChecks');
    },
  },

  // ----------  场景（next 节点顺序校验，严格模式） ----------

  // 36: next BLOCKED——currentNode=open 未 exit（completedNodes 空 + evidence 无 open 记录）
  // → 上一节点未 exit 就推进 → 严格拦截，输出恢复指令（先 exit open --apply）
  {
    name: '36 next BLOCKED：currentNode=open 未 exit（completedNodes 空）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 open');
      assertOut(res, 'workflow-guard.mjs exit open --apply');
    },
  },

  // 37: next 正常——open 已 exit（completedNodes 含 open）+ 当前节点 evidence 已记录 → 正常推进
  // （状态漂移校正保留：已完成节点正常推进不受严格校验影响）
  {
    name: '37 next 正常：open 已 exit 后正常推进',
    run: (dir) => {
      const st = baseState('design');
      st.completedNodes = ['open'];
      st.evidence.design = { summary: 'design in progress' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: design');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // ----------  场景（redEvidence 时间顺序校验） ----------

  // 38: handoff result 时间顺序通过——先记录 redEvidence（TDD RED），再补 greenEvidence（GREEN）
  // → 两次均通过；且 evidence 中 redEvidence/greenEvidence 附带 recordedAt 时间戳
  // （重录保留 red 首次记录时间，green 为补录时间——时序可审计）
  {
    name: '38 handoff red 先于 green 通过（recordedAt）+ result PREFLIGHT 命令平台化并被真实执行',
    run: (dir) => {
      assertExit(runHandoff(['request', 'P01', 'delegate', '--write-files', 'src/p1.mjs'], dir, { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) }), 0);
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const redOnly = '{"redEvidence":{"command":"node --check src/p1.mjs"}}';
      const res1 = runHandoff(['result', 'P01', redOnly], dir, {
        FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir),
      });
      assertExit(res1, 0);
      assertOut(res1, 'HANDOFF RESULT: P01');
      // ③ 缺证据的 WARN 点名 Return Contract 的 shape（只差 command 时不必猜字段怎么填）
      assertOut(res1, 'HANDOFF WARN: P01 缺 greenEvidence');
      assertOut(res1, '{command, output}');
      assertOut(res1, 'command 与 output 两个字段');
      const both = '{"redEvidence":{"command":"node --check src/p1.mjs"},"greenEvidence":{"command":"node --check src/p1.mjs"}}';
      const res2 = runHandoff(['result', 'P01', both], dir, {
        FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir),
      });
      assertExit(res2, 0);
      assertOut(res2, 'HANDOFF RESULT: P01');
      // result 成功路径在 HANDOFF RESULT 之后追加 PREFLIGHT（SUMMARY 结构预检提示）——节点取路由
      // 视图（与 next 的 NODE / status.routeNode 同源），不是 state.currentNode 原值；该行不得改写
      // 既有 HANDOFF RESULT 前缀，也不得出现在失败路径。--preflight 只跑结构性门禁，与「完整 exit
      // （不带 --apply）才是全链预演」两句必须同行，否则同一个 PREFLIGHT 指了两条命令。
      assertOut(res2, 'PREFLIGHT: SUMMARY 结构尚未校验');
      assertOut(res2, '做结构预检（只跑结构性门禁，不写 state、不推进状态）');
      assertOut(res2, '完整 exit（不带 --apply）是节点收尾的全链预演');
      // 路由视图的独立参照：status 是只读视图，其 routeNode 就是 next 会打印的节点。
      const routeView = runState(['status'], dir);
      assertExit(routeView, 0);
      const routeNode = (routeView.output.match(/"routeNode":\s*"([^"]+)"/) ?? [])[1];
      if (!routeNode) {
        throw new Error('status 缺 routeNode（无法独立核对 PREFLIGHT 节点）:\n' + routeView.output);
      }
      // PREFLIGHT 命令同样从输出解析（不再与字面串比对）：加引号的脚本路径 + exit <路由视图节点> --preflight。
      const preflightCommand = (res2.output.match(/PREFLIGHT: SUMMARY 结构尚未校验——可运行 (node .+?) 做结构预检/) || [])[1];
      if (!preflightCommand) {
        throw new Error('PREFLIGHT 行缺可解析的 exit 命令:\n' + res2.output);
      }
      const printedNode = preflightCommand.match(/^node "[^"]+" exit (\S+) --preflight$/);
      if (!printedNode) {
        throw new Error('PREFLIGHT 命令形态应为「整条加引号的脚本路径 + exit <节点> --preflight」，实际: ' + preflightCommand);
      }
      if (printedNode[1] !== routeNode) {
        throw new Error('PREFLIGHT 节点应取路由视图（与 status.routeNode 同源）：'
          + JSON.stringify(printedNode[1]) + ' vs ' + JSON.stringify(routeNode));
      }
      const rawCurrentNode = JSON.parse(readStateBytes(dir)).currentNode;
      if (printedNode[1] === rawCurrentNode) {
        throw new Error('PREFLIGHT 节点不得取 state.currentNode 原值（该夹具的路由视图与 state 原值不同）: ' + rawCurrentNode);
      }
      const resultLineAt = res2.output.indexOf('HANDOFF RESULT: P01');
      const preflightLineAt = res2.output.indexOf('PREFLIGHT:');
      if (!(resultLineAt >= 0 && preflightLineAt > resultLineAt)) {
        throw new Error('PREFLIGHT 行必须追加在 HANDOFF RESULT 之后（既有前缀不得改写）：\n' + res2.output);
      }
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const rec = st.evidence['subagent-execute'].handoffResult['P01'].result;
      if (!rec.redEvidence.recordedAt || typeof rec.redEvidence.recordedAt !== 'string') {
        throw new Error('redEvidence 未附带 recordedAt: ' + JSON.stringify(rec.redEvidence));
      }
      if (!rec.greenEvidence.recordedAt || typeof rec.greenEvidence.recordedAt !== 'string') {
        throw new Error('greenEvidence 未附带 recordedAt: ' + JSON.stringify(rec.greenEvidence));
      }

      // 协议不可读的降级形态（result 成功路径）：不拿 state.currentNode 原值凑一条可能指错节点的
      // 命令，只留「先确认协议可读」的指引与全链预演说明——提示面不得反过来让已落盘的成功路径失败，
      // 也不得在无法解析路由视图时编造节点。
      const noProtocol = runHandoff(['result', 'P01', both], dir);
      assertExit(noProtocol, 0);
      assertOut(noProtocol, 'PREFLIGHT: SUMMARY 结构尚未校验');
      assertOut(noProtocol, '暂时无法解析路由节点');
      assertOut(noProtocol, '完整 exit（不带 --apply）是节点收尾的全链预演');
      assertNotOut(noProtocol, '可运行 node');

      // ---------- PREFLIGHT 命令的真实执行（安装副本 + 含空格的路径；in-place 扩展） ----------
      // ④ 平台化推导必须是**运行形态**的结果，而不是写死的平台字面量：把技能树复制到运行根下
      // 含空格的相对目录，用副本自身跑 workflow-handoff —— 打印出的路径须带那个空格、整条加引号、
      // 分词后仍是单一脚本参数，并在夹具里真实跑起来（缺引号时这条命令当场作废）。
      const spaceSkillCopy = installSkillTreeCopy(dir, 'user install');
      const resCopy = runScriptCopy(path.join(spaceSkillCopy, 'scripts', 'workflow-handoff.mjs'),
        ['result', 'P01', both], dir, {
          FLOW_COMET_RUN_ROOT: dir,
          FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir),
        });
      assertExit(resCopy, 0);
      assertOut(resCopy, 'HANDOFF RESULT: P01');
      const copyPreflightCommand = (resCopy.output.match(/PREFLIGHT: SUMMARY 结构尚未校验——可运行 (node .+?) 做结构预检/) || [])[1];
      if (!copyPreflightCommand) {
        throw new Error('副本形态的 PREFLIGHT 行缺可解析的 exit 命令:\n' + resCopy.output);
      }
      const stateFile = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const printedGuardScript = assertPrintedCommandResolves(copyPreflightCommand, dir,
        path.join(spaceSkillCopy, 'scripts', 'workflow-guard.mjs'), 'PREFLIGHT 命令（安装副本形态）');
      if (!printedGuardScript.includes(' ')) {
        throw new Error('该形态的脚本路径应含空格（引号契约的判别场景），实际: ' + printedGuardScript);
      }
      const stateBytesBeforePreflight = fs.readFileSync(stateFile, 'utf8');
      const resPreflight = runPrintedCommand(copyPreflightCommand, dir, {
        FLOW_COMET_RUN_ROOT: dir,
        FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir),
      });
      // 预检 = 只跑结构性门禁、不推进状态：须有真实门禁判决（该夹具本身不完整，通过/阻塞都算真跑），
      // 且 state 字节零改写。
      if (!/(ALL CHECKS PASSED|BLOCKED:)/.test(resPreflight.output)) {
        throw new Error('PREFLIGHT 命令未真正跑到出口门禁（无门禁判决）: exit ' + resPreflight.status
          + '\n' + resPreflight.output);
      }
      if (fs.readFileSync(stateFile, 'utf8') !== stateBytesBeforePreflight) {
        throw new Error('PREFLIGHT（--preflight）不得改写 state');
      }

      // ---------- 无活跃 change 的预检不得报「通过」（in-place 扩展；不新增场景条目） ----------
      // 预检的子判据都按 change 定位（声明工件 / 骨架 / 段 / TASK 字段），没有 activeChange 时它们各自
      // 早退——于是零判据跑完还打印 ALL CHECKS PASSED：这是「没看」被报成「看过且通过」，与只读命令
      // 应有的结论（同 state 的完整 exit 是 BLOCKED）相互矛盾。判据：无可判结构面 → 非零退出且不得
      // 出现通过结论；上面那段（有 activeChange 的真实预检）即「正常 change 不受影响」的对照。
      const noChangeState = baseState('open');
      delete noChangeState.activeChange;
      writeState(dir, noChangeState);
      const noChangePreflight = runGuard(['exit', 'open', '--preflight'], dir);
      assertExit(noChangePreflight, 1);
      assertOut(noChangePreflight, 'PREFLIGHT: 未校验（无活跃 change，没有可判的结构面）');
      assertNotOut(noChangePreflight, 'ALL CHECKS PASSED');
    },
  },

  // 39: handoff result BLOCKED——已记录 greenEvidence（无 redEvidence）后同批补录 redEvidence
  // → redEvidence 事后补录（TDD 要求 RED 先于 GREEN），exit 1
  {
    name: '39 handoff BLOCKED：greenEvidence 后同批补录 redEvidence',
    run: (dir) => {
      assertExit(runHandoff(['request', 'P01', 'delegate', '--write-files', 'src/p1.mjs'], dir, { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) }), 0);
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const greenOnly = '{"greenEvidence":{"command":"node --check src/p1.mjs"}}';
      const res1 = runHandoff(['result', 'P01', greenOnly], dir);
      assertExit(res1, 0);
      const backfill = '{"greenEvidence":{"command":"node --check src/p1.mjs"},"redEvidence":{"command":"node --check src/p1.mjs"}}';
      const res2 = runHandoff(['result', 'P01', backfill], dir);
      assertExit(res2, 1);
      assertOut(res2, 'redEvidence 事后补录');
      // 拦截路径不打印 PREFLIGHT（提示只在「结果已记录、可以预检了」的成功路径出现）
      assertNotOut(res2, 'PREFLIGHT');
    },
  },

  // ----------  场景（C3 签名行尾规范化 + 回退豁免） ----------

  // 40: execute exit 通过——TASK.md 从 LF 行尾改写为 CRLF（bash heredoc → python os.linesep
  // 跨工具编辑），任务集逻辑未变 → 签名一致（行尾规范化），不误报"任务集被修改"
  {
    name: '40 execute exit 通过：TASK LF→CRLF 行尾变化签名一致',
    run: (dir) => {
      // 单轨夹具前置：direct 模式（本格测签名判定，不涉及委托归属）+ 声明齐备
      writeNodeDeclarationMarkers(dir, 'execute');
      const st = baseState('execute');
      st.executionMode = 'direct';
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      // LF 版本任务集（enter 时记录签名）
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 同一任务集改写为 CRLF 行尾（仅行尾差异，逻辑内容不变）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF.replace(/\n/g, '\r\n'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', strictSummary('T01')); // M2: 新 change 强制 done 任务须有 SUMMARY
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 41: execute exit BLOCKED——TASK.md 任务内容实际变化（改 action 文本）→ 签名不同 → 严格拦截
  {
    name: '41 execute exit BLOCKED：任务内容变化签名不同 + replan 重签事实说明',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 逻辑内容变化（T01 action 文本被改），行尾保持 LF 不变
      const changed = taskLF.replace('实现 T01', '实现 T01 并补充单元测试');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', changed);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'TASK.md 任务集被修改');

      // ---------- replan 成功行说明「重签了什么、没有做什么」（in-place 扩展） ----------
      // ② 签名不一致 BLOCK 后的合规出路是 replan：成功行保持既有 REPLAN: 前缀不变，其后追加
      // 一行事实说明——已重签 state.taskHash（值前缀标出版本），且 TASK.md 内容未改写、plan
      // 节点证据未重记（防执行者误以为 replan 会重写计划工件或重跑 plan 出口）。
      const resReplan = runStateWithProtocol(dir, ['replan', '任务集按实测修订', '--authorized-by', 'user-approval']);
      assertExit(resReplan, 0);
      assertOut(resReplan, 'REPLAN: execute');
      assertOut(resReplan, '已重签 state.taskHash（值前缀 ');
      assertOut(resReplan, 'TASK.md 内容未改写');
      assertOut(resReplan, 'plan 节点证据未重记');
      // 版本前缀从**实际签名**派生，不写死 v1:——算法升版时这里不会假红。
      // 判据三点：① 行在场且带前缀；② 打印前缀 == 当前 TASK.md 签名的版本前缀；③ 落盘值等于签名。
      const taskHashLine = resReplan.output.split(/\r?\n/).find((line) => line.startsWith('TASKHASH: '));
      if (!taskHashLine) {
        throw new Error('replan 成功行后缺 TASKHASH 事实说明:\n' + resReplan.output);
      }
      const printedSignaturePrefix = (taskHashLine.match(/值前缀 (v\d+:)/) ?? [])[1];
      const replanTaskText = fs.readFileSync(path.join(dir, '.specs', CHANGE_ID, 'TASK.md'), 'utf8');
      const actualSignature = String(requireRouteNodeExport('taskSetSignature')(replanTaskText));
      const actualSignaturePrefix = actualSignature.split(':')[0] + ':';
      if (printedSignaturePrefix !== actualSignaturePrefix) {
        throw new Error('TASKHASH 行打印的版本前缀应与实际签名一致（算法升版不得假红）：'
          + JSON.stringify(printedSignaturePrefix) + ' vs ' + JSON.stringify(actualSignaturePrefix)
          + '（实际签名 ' + actualSignature + '）');
      }
      const replanPersisted = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (replanPersisted.taskHash !== actualSignature) {
        throw new Error('replan 重签的 state.taskHash 应等于当前 TASK.md 的实际签名：'
          + JSON.stringify(replanPersisted.taskHash) + ' vs ' + JSON.stringify(actualSignature));
      }
      const replanLineAt = resReplan.output.indexOf('REPLAN: execute');
      const replanDetailAt = resReplan.output.indexOf('已重签 state.taskHash');
      if (!(replanLineAt >= 0 && replanDetailAt > replanLineAt)) {
        throw new Error('replan 事实说明必须在 REPLAN 成功行之后（前缀语义不变）：\n' + resReplan.output);
      }
    },
  },

  // 42: next 回退豁免通过——verify 未 exit（completedNodes 无 verify + evidence 无 verify 记录）
  // 但 TASK.md 存在 pending 修复任务且 determineNode 推导为 execute → 允许标准回退路径
  // （verify 发现缺陷 → 回 execute），不 BLOCK，输出 NODE: execute
  {
    name: '42 next 回退豁免：verify 未 exit + pending 修复任务 → 允许回 execute',
    run: (dir) => {
      const st = baseState('verify');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      // 前置产物（preExec 门控：open/design/plan 的 CHANGE/REQUIREMENT/DESIGN/TASK）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      // 既有 done 任务 + verify 阶段追加的 pending 修复任务
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P1 + TASK_TFIX);
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 43: next 维持严格 BLOCK——verify 未 exit（evidence 无 verify 记录）且 TASK.md 无 pending
  // 任务（非修复回退）→ 豁免不成立 → 维持  严格拦截，输出恢复指令
  {
    name: '43 next 维持 BLOCK：无 pending 任务（非修复任务回退）',
    run: (dir) => {
      const st = baseState('verify');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      // 全部 done（无 pending）——正常推进场景不豁免
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P1);
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 verify');
      assertOut(res, 'workflow-guard.mjs exit verify --apply');
    },
  },

  // ----------  场景（C3 签名标记类属性剥离——completed_at 误报修复） ----------

  // 44: execute exit 通过——enter 后子代理在 task 开标签追加 completed_at 标记属性
  // （标记 task done 的时序属性，纯状态标记不影响任务集逻辑）→ 签名不受标记属性影响，不误报 BLOCK
  {
    name: '44 execute exit 通过：追加 completed_at 标记属性签名一致',
    run: (dir) => {
      // 单轨夹具前置：direct 模式 + 声明齐备（同上）
      writeNodeDeclarationMarkers(dir, 'execute');
      const st = baseState('execute');
      st.executionMode = 'direct';
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 子代理标记 task done：T01 开标签追加 completed_at 属性（其余逻辑内容不变）
      const marked = taskLF.replace('id="T01"', 'id="T01" completed_at="2026-08-07"');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', marked);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', strictSummary('T01')); // M2: 新 change 强制 done 任务须有 SUMMARY
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 45: execute exit BLOCKED——追加 completed_at 标记属性 + 任务内容（action）实际变化
  // → 标记属性剥离不越界：内容仍签名敏感 → 严格拦截"任务集被修改"
  {
    name: '45 execute exit BLOCKED：completed_at 标记属性 + action 变化签名不同',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 内容实际变化（T01 action 文本被改）+ 同时追加 completed_at 标记属性
      const changed = taskLF
        .replace('id="T01"', 'id="T01" completed_at="2026-08-07"')
        .replace('实现 T01', '实现 T01（改）');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', changed);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'TASK.md 任务集被修改');
    },
  },

  // ----------  场景（next 正常推进豁免——exit 推进后的正常 next 不再被误拦） ----------

  // 46: next 正常推进豁免通过——open exit --apply 已把 currentNode 推进到 design（completedNodes=['open']、
  // design 尚未开始故 evidence 无 design 记录），随后按 SKILL 协议调 next（正常路径）→ 不 BLOCK，
  // 输出 NODE: design（ 误拦回归：修复前此状态被 BLOCK 为"疑似未 exit 节点 design"；
  // open 的 evidence 证明该 exit 真实发生过，满足 normalAdvanceExempt）
  {
    name: '46 next 正常：open exit 推进后 currentNode=design 无 evidence（修复任务回退豁免）',
    run: (dir) => {
      const st = baseState('design');
      st.completedNodes = ['open'];
      st.evidence.open = { summary: 'open done' };
      writeState(dir, st);
      // open exit 已通过的产物（design 尚未开始，无 DESIGN.md）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: design');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 47: next 维持严格 BLOCK——真乱序跳节点：currentNode=review 但 completedNodes 仅 ['open']
  // （open 已 exit 且有 evidence）→ review 不是 open 的路由直接后继（open 的后继是 design）
  // →  豁免不成立（回退豁免也不成立：TASK.md 无 pending）→ 严格拦截核心价值
  // 保持（跳节点仍严格拦截），输出恢复指令
  {
    name: '47 next BLOCKED：跳节点乱序（completedNodes 仅 open，currentNode=review）',
    run: (dir) => {
      const st = baseState('review');
      st.completedNodes = ['open'];
      st.evidence.open = { summary: 'open done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 review');
      assertOut(res, 'workflow-guard.mjs exit review --apply');
    },
  },

  // ----------  场景（机制交互组合——两个机制同时作用，防单机制测试盲区） ----------

  // 48: 组合盲区 A（对照组 A 撞出）——record 覆盖语义 × 越俎代庖检测：先经 workflow-handoff
  // result 正确记录 T01 的 Return Contract（含 completedChecks），随后 record subagent-execute
  // '{"handoffResult":{}}'（浅合并整体替换 handoffResult 键）把已记录的 handoff 覆盖丢失 →
  // exit execute 的越俎代庖检测（统一委托下 done 任务必须有 handoff）BLOCK——
  // 组合语义：record 的"整体覆盖"不是无害操作，会连带破坏委托证明链（T01 合法 done 变越俎代庖）
  {
    name: '48 execute exit BLOCKED：record 覆盖 handoff（越俎代庖）',
    run: (dir) => {
      assertExit(runHandoff(['request', 'T01', 'delegate', '--write-files', 'src/t1.mjs'], dir, { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) }), 0);
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      // ① workflow-handoff result 正确记录 T01 的 Return Contract（含 completedChecks）
      const res = runHandoff(['result', 'T01', JSON.stringify({
        commitHash: 'abcd1234',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t1.mjs' },
        redEvidence: { command: 'node --check src/t1.mjs' },
      })], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF RESULT: T01');
      // ② record subagent-execute '{"handoffResult":{}}' 整体覆盖 evidence['subagent-execute']
      //（浅合并替换 handoffResult 键）→ 已记录的 T01 handoff 丢失（对照组 A 踩坑路径）
      assertExit(runStateWithProtocol(dir, ['record', 'subagent-execute', '{"handoffResult":{}}']), 0);
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const hr = st2.evidence['subagent-execute'] && st2.evidence['subagent-execute'].handoffResult;
      if (!hr || hr['T01']) {
        throw new Error('record 未整体覆盖 handoffResult（T01 应被覆盖丢失）: ' + JSON.stringify(st2.evidence['subagent-execute']));
      }
      // ③ exit execute：T01 done 但 handoff 已被覆盖丢失 → 越俎代庖 BLOCK
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 1);
      assertOut(res2, '越俎代庖');
    },
  },

  // 49（多趟语义翻转）：路由 × 节点推进——subagent-execute 已 completed（第一波 parallel 全 done +
  // exit，completedNodes 含该节点）后，第二波 parallel 任务（P02，depends 已满足）出现时：
  // next 重新路由回 subagent-execute（多趟循环路由——委托进入谓词每趟重新求值，单趟限制已移除）；
  // entry subagent-execute 仍放行（completedNodes 含该节点允许重入——每趟完整 entry 检查不绕过）
  {
    name: '49 next 二次路由回 subagent-execute + entry 重入（多趟语义）+ 归属受阻后 record+exit 恢复',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2_PENDING + TASK_T03_PENDING);
      const st = baseState('subagent-execute');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      st.evidence['subagent-execute'] = { summary: 'wave1 delegated and collected' };
      writeState(dir, st);
      // ① next：第二波 eligible 并行存在 → 多趟路由回该节点（旧单趟「不回流」行为已移除）
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // ② entry subagent-execute：completedNodes 含该节点仍可重入（每趟完整 entry 检查）
      const res2 = runGuard(['entry', 'subagent-execute'], dir);
      assertExit(res2, 0);
      assertOut(res2, 'ENTRY OK');

      // ---------- request 归属受阻的新恢复路径（in-place 扩展） ----------
      // ④ 串行 pending 任务在 subagent-execute 发起 request → 归属门禁 BLOCK。报文不再承诺
      // 「先 next 再 entry 目标节点」（当前节点已 entry 未 exit 时会被节点顺序门拦），改为
      // 「先对当前节点 record + exit（退出后路由自动前进到目标节点）」；并断言按此指引真能走通。
      const stateFile = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      fs.mkdirSync(loadsDir, { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/subagent-execute-flow-comet-dev.json',
        JSON.stringify({
          node: 'subagent-execute',
          skill: 'flow-comet-dev',
          protocol: '4-dev.md',
          templates: ['SUMMARY'],
          at: '2026-08-01T00:00:00.000Z',
        }, null, 2) + '\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="S01" parallel="false" status="pending">\n'
        + '  <name>串行任务 S01</name>\n'
        + '  <read_files>.specs/' + CHANGE_ID + '/TASK.md</read_files>\n'
        + '  <write_files>src/s01.mjs</write_files>\n'
        + '  <action>实现 S01</action>\n'
        + '  <verify>node --check src/s01.mjs</verify>\n'
        + '  <done>完成 S01</done>\n'
        + '  <depends_on></depends_on>\n'
        + '</task>\n');
      const reqState = baseState('subagent-execute');
      reqState.completedNodes = ['open', 'design', 'plan'];
      reqState.evidence = {
        open: { summary: 'open done' },
        design: { summary: 'design done' },
        plan: { summary: 'plan done' },
      };
      writeState(dir, reqState);
      // 真实 entry（记录 enteredNodes + 任务集签名；request 前置门要求本节点声明标记，已写）
      assertExit(runGuardWithProtocol(dir, ['entry', 'subagent-execute']), 0);
      // 开工前的 LESSONS 命中集是只读信息：教训册在场时 request 打印本任务的命中集（本夹具任务的写面
      // 词元 s01 命中条目 L-601）；下面同时锚定它不改写 state、不改写教训册。
      const lessonsFile = path.join(dir, '.specs', 'LESSONS.md');
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n## 条目区（夹具）\n\n### L-601 · [proc] 委托边界须留痕\n\n- **关键词**: s01 委托边界\n');
      const lessonsBytesBefore = fs.readFileSync(lessonsFile, 'utf8');
      // ---------- 声明标记必须属于本 change（原位扩展；不新增场景条目） ----------
      // 归档兜底只认本 change 自己的声明目录：活动 .skill-loads 在场时不再回溯归档（record 前置门
      // 与委托前置门同一份判据）。委托前置门曾经自持一份扫描，会扫遍所有后缀匹配 -<change-id> 的
      // 归档目录——别的 change 归档里的同名标记也能替本节点作证，等于在门禁上留了一个放行口。
      const decoyEntry = '2026-01-01-other-' + CHANGE_ID;
      writeFile(dir, '.specs/archive/' + decoyEntry + '/.skill-loads/subagent-execute-flow-comet-dev.json',
        JSON.stringify({ node: 'subagent-execute', skill: 'flow-comet-dev', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      // 本 change 只声明了别的节点：把本节点标记临时改名，活动目录仍在场
      const activeMarker = path.join(loadsDir, 'subagent-execute-flow-comet-dev.json');
      const otherNodeMarker = path.join(loadsDir, 'plan-flow-comet-plan.json');
      fs.renameSync(activeMarker, otherNodeMarker);
      const bytesBeforeDecoy = fs.readFileSync(stateFile, 'utf8');
      const resDecoy = runHandoff(['request', 'S01', 'serial slice'], dir,
        { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
      assertExit(resDecoy, 1);
      assertOut(resDecoy, 'BLOCKED: 节点 subagent-execute 缺少技能加载声明标记');
      assertNotOut(resDecoy, 'HANDOFF REQUEST');
      if (fs.readFileSync(stateFile, 'utf8') !== bytesBeforeDecoy) {
        throw new Error('缺声明 BLOCK 必须 state 字节零改写（别的 change 归档标记不得替本节点作证）');
      }
      // 活动 .skill-loads/ 不存在（新 change 尚未声明的真实初始态）时，归档兜底同样不得把「同后缀
      // 但不同 change」的归档目录认作本 change：上面那条诱饵只在活动目录在场时被「活动优先」挡住，
      // 活动目录一撤，后缀匹配仍会命中 2026-01-01-other-<change-id>——别的 change 的声明替本节点作证，
      // 委托前置门于是放行（实测该形态打印出 HANDOFF REQUEST）。归档目录必须是 <YYYY-MM-DD>-<本
      // change> 的精确形态才作数。
      const loadsAside = path.join(dir, '.specs', 'loads-aside');
      fs.renameSync(loadsDir, loadsAside);
      const bytesBeforeSuffixDecoy = fs.readFileSync(stateFile, 'utf8');
      const resSuffixDecoy = runHandoff(['request', 'S01', 'serial slice'], dir,
        { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
      assertExit(resSuffixDecoy, 1);
      assertOut(resSuffixDecoy, 'BLOCKED: 节点 subagent-execute 缺少技能加载声明标记');
      assertNotOut(resSuffixDecoy, 'HANDOFF REQUEST');
      if (fs.readFileSync(stateFile, 'utf8') !== bytesBeforeSuffixDecoy) {
        throw new Error('同后缀异 change 的归档目录不得替本节点作证：BLOCK 必须 state 字节零改写');
      }
      fs.renameSync(loadsAside, loadsDir);
      // 复位：本节点标记归位、归档诱饵撤掉——后续段按「已声明」继续
      fs.renameSync(otherNodeMarker, activeMarker);
      fs.rmSync(path.join(dir, '.specs', 'archive'), { recursive: true, force: true });
      const bytesBeforeRequest = fs.readFileSync(stateFile, 'utf8');
      const resOwnership = runHandoff(['request', 'S01', 'serial slice'], dir,
        { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
      assertExit(resOwnership, 1);
      assertOut(resOwnership, 'BLOCKED: 任务 S01（串行 pending）应归属节点 execute');
      // 新指引：先 record + exit 当前节点；不再承诺「先 next 再 entry 目标节点」
      assertOut(resOwnership, '先对当前节点 subagent-execute record + exit');
      assertOut(resOwnership, '不要在未 exit 前 entry 目标节点');
      assertOut(resOwnership, 'workflow-state next');
      // 同口径：entry 只在当前节点 exit 之后才允许——断言顺序句里的条件分句与前后次序，
      // 不再裸断 'entry execute'（禁止句也会命中它，断言不出「让你 entry」与「禁止现在 entry」）。
      const ownershipGuide = resOwnership.output.split('\n').find((line) => line.includes('恢复指引:'));
      if (!ownershipGuide) {
        throw new Error('归属受阻输出缺恢复指引行:\n' + resOwnership.output);
      }
      assertOut(resOwnership, '等当前节点 exit 后，再用 workflow-state entry execute');
      if (!(ownershipGuide.indexOf('record + exit') >= 0
        && ownershipGuide.indexOf('record + exit') < ownershipGuide.indexOf('entry execute'))) {
        throw new Error('恢复指引顺序错误：entry 目标节点必须排在 record + exit 之后：' + ownershipGuide);
      }
      assertNotOut(resOwnership, '查看当前路由，按 NODE 输出进入');
      assertNotOut(resOwnership, 'HANDOFF REQUEST');
      // 命中集在归属门禁之前打印（BLOCK 路径不落 state）：打印面只读——state 字节零改写、教训册字节零改写
      assertOut(resOwnership, 'LESSONS-HITS: 1 条');
      assertOut(resOwnership, 'L-601');
      if (fs.readFileSync(lessonsFile, 'utf8') !== lessonsBytesBefore) {
        throw new Error('开工前的命中集打印不得改写教训册');
      }
      if (fs.readFileSync(stateFile, 'utf8') !== bytesBeforeRequest) {
        throw new Error('归属受阻 BLOCK 必须 state 字节零改写（含开工前打印的命中集）');
      }
      // 照报文操作：record 当前节点 + exit --apply（退出后路由自动前进到目标节点）
      assertExit(runStateWithProtocol(dir, ['record', 'subagent-execute', '{"summary":"串行任务需回 execute 节点执行"}']), 0);
      const exitOwnership = runGuardWithProtocol(dir, ['exit', 'subagent-execute', '--apply']);
      assertExit(exitOwnership, 0);
      const stateAfterRecovery = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (stateAfterRecovery.currentNode !== 'execute') {
        throw new Error('按新指引 record+exit 后 currentNode 应前进到 execute，实际: '
          + JSON.stringify(stateAfterRecovery.currentNode));
      }
      const nextAfterRecovery = runStateWithProtocol(dir, ['next']);
      assertExit(nextAfterRecovery, 0);
      assertOut(nextAfterRecovery, 'NODE: execute');
    },
  },

  // ---------- 校验补充场景（协议 schema nodes 校验 / 豁免 summary 严格化 / hook 声明模式 fail-closed） ----------

  // 50: validateProtocolSchema 拒绝空 node（自定义协议 nodes 含空对象 → 加载报错 fail-closed）
  {
    name: '50 自定义协议空 node：schema 校验拒绝（审查补充）',
    run: (dir) => {
      const badProtocol = customProtocol();
      badProtocol.nodes.push({});
      writeFile(dir, 'bad-protocol.json', JSON.stringify(badProtocol, null, 2) + '\n');
      const res = runState(['status', '--protocol', path.join(dir, 'bad-protocol.json')], dir);
      assertExit(res, 1);
      assertOut(res, 'workflow protocol node must have a non-empty string id');
    },
  },

  // 51: normalAdvanceExempt 空对象 evidence 不豁免（completedNodes 最后节点 evidence 是 {} → next BLOCK）
  {
    name: '51 next BLOCKED：豁免节点 evidence 为空对象（审查补充）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'tdd',
        completedNodes: ['brainstorm'],
        evidence: { brainstorm: {} },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runState(['next', '--protocol', custom], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
    },
  },

  // 52: 协议声明 writeWhitelist 未列出节点 → hook BLOCK（fail-closed）
  {
    name: '52 hook BLOCKED：writeWhitelist 未声明节点（审查补充）',
    run: (dir) => {
      const custom = customProtocol();
      custom.writeWhitelist = { brainstorm: ['.specs/'] };
      writeFile(dir, 'partial-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running', currentNode: 'tdd' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'partial-protocol.json') });
      assertExit(res, 2);
      assertOut(res, '未在协议 writeWhitelist 中声明');
    },
  },

  // ----------  场景（分支前缀可配置，适配仓库规范） ----------

  // 53: init --branch-prefix feat/ → 分支创建为 feat/<id>（适配仓库规范如 feat/）
  {
    name: '53 init --branch-prefix feat/ 创建 feat/<id> 分支',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const res = runStateWithProtocol(dir, ['init', 'prefix-test', '--branch-prefix', 'feat/']);
      assertExit(res, 0);
      assertOut(res, 'BRANCH: feat/prefix-test');
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      if (branch !== 'feat/prefix-test') {
        throw new Error('期望分支 feat/prefix-test，实际 ' + branch);
      }
    },
  },

  // 54: 一致性校验用 state.branchPrefix（status 显示 ok）
  {
    name: '54 status 一致性：branchPrefix=feat/ 分支 feat/<id> → ok',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['checkout', '-b', 'feat/pref-state'], { cwd: dir, stdio: 'ignore' });
      const st = baseState('open');
      st.activeChange = 'pref-state';
      st.branchPrefix = 'feat/';
      writeState(dir, st);
      writeFile(dir, '.specs/pref-state/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/pref-state/REQUIREMENT.md', '# REQUIREMENT\n## 用户故事\nx\n## 验收准则（AC）\nx\n');
      const res = runStateWithProtocol(dir, ['status']);
      assertExit(res, 0);
      assertOut(res, '一致性: ok');
    },
  },

  // ----------  场景（init 写 status + hook 判定对齐） ----------

  // 55: init 生成的 state 必须含 status:'running'（当前缺——hook 判定不一致的根源）
  {
    name: '55 init state 含 status: running',
    run: (dir) => {
      const res = runStateWithProtocol(dir, ['init', 'tf15-st']);
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.status !== 'running') {
        throw new Error('init state 缺 status: running，实际: ' + JSON.stringify(st.status));
      }
    },
  },

  // 56: init 后（open 阶段）越权写源码 → hook BLOCK（当前因 status undefined 放行——三层防线缺口）
  {
    name: '56 hook BLOCKED：init 后越权写源码',
    run: (dir) => {
      const initRes = runStateWithProtocol(dir, ['init', 'tf15-hk']);
      assertExit(initRes, 0);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 2);
    },
  },

  // 57: status:'completed'（归档后状态）→ hook 放行（当前 exit 1 拦截全部写入）
  {
    name: '57 hook 放行：status completed 归档后状态',
    run: (dir) => {
      writeState(dir, composeState({ status: 'completed', activeChange: null, currentNode: null }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'anything.md') } });
      assertExit(res, 0);
    },
  },

  // ----------  场景（init 创建 .specs/<id>/ 目录，findActiveChange 立即可识别） ----------

  // 58: init 后 next 识别 active change（当前因 .specs/<id>/ 目录未建报 No active change）
  {
    name: '58 init 后 next 识别 active change',
    run: (dir) => {
      const initRes = runStateWithProtocol(dir, ['init', 'tf16-dir']);
      assertExit(initRes, 0);
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 open');
      assertNotOut(res, 'No active change');
    },
  },

  // ----------  场景（归档完成态不兜底识别残留目录） ----------

  // 59: state 为归档完成态（completed + activeChange null）→ .specs/ 顶层残留目录（含 TASK.md）不被兜底识别
  {
    name: '59 归档后残留目录不误判为 active',
    run: (dir) => {
      writeState(dir, composeState({ status: 'completed', activeChange: null, currentNode: null }));
      writeFile(dir, '.specs/stale/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/stale/TASK.md', '# TASK\n');
      const res = runStateWithProtocol(dir, ['status']);
      assertExit(res, 0);
      assertOut(res, 'no-change');
      assertNotOut(res, 'stale');
    },
  },

  // ----------  场景（init currentNode 按协议首节点） ----------

  // 60: 自定义协议 init → currentNode = 协议首节点 brainstorm（当前硬编码 open——）
  {
    name: '60 init currentNode 按协议首节点',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const initRes = runState(['init', 'tf18-cp'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(initRes, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.currentNode !== 'brainstorm') {
        throw new Error('init currentNode 应为协议首节点 brainstorm，实际: ' + JSON.stringify(st.currentNode));
      }
    },
  },

  // ---------- 补齐场景（兼容分支固化） ----------

  // 61: 旧 state（无 status 字段但有 activeChange）→ hook 按 running 处理（fail-closed 向后兼容，行为固化）
  {
    name: '61 hook fail-closed：旧 state 无 status 有 activeChange 按 running（既有修复固化）',
    run: (dir) => {
      const st = baseState('open');
      delete st.status;
      st.activeChange = 'legacy-change';
      writeState(dir, st);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 2);
    },
  },

  // 62: init 后（open 阶段）合法写 .specs/ 工件 → hook 放行（ 正确 RED：
  // 修复前 init 无 status → hook「not running」throw exit 1 拦截合法写入——open 阶段无法产出工件）
  {
    name: '62 hook 放行：init 后写 .specs/ 工件',
    run: (dir) => {
      const initRes = runStateWithProtocol(dir, ['init', 'tf15-ok']);
      assertExit(initRes, 0);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'tf15-ok', 'CHANGE.md') } });
      assertExit(res, 0);
      assertOut(res, 'NODE: open');
    },
  },

  // 63: 新 change 与旧归档同名（state 缺失时走扫描兜底）→ 应识别为 active（ 扩展边界：
  // archivedIds 剥日期前缀匹配不得误伤同名新 change）
  {
    name: '63 同名新 change 不被归档检查误跳过',
    run: (dir) => {
      writeFile(dir, '.specs/sci-notation/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/sci-notation/TASK.md', '# TASK\n');
      writeFile(dir, '.specs/archive/2026-08-08-sci-notation/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runStateWithProtocol(dir, ['status']);
      assertExit(res, 0);
      assertOut(res, '"change": "sci-notation"');
    },
  },

  // ---------- 边界补充场景 ----------

  // 64: record 命令的 --protocol 参数不得污染 payload（：payload 解析前剥离）
  {
    name: '64 record --protocol 不污染 payload',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const initRes = runStateWithProtocol(dir, ['init', 'tf14-rec']);
      assertExit(initRes, 0);
      const res = runState(['record', 'open', '{"summary":"x","completedChecks":["a"]}', '--protocol', custom], dir);
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const ev = st.evidence.open || {};
      if (ev.summary !== 'x') {
        throw new Error('summary 被污染，应为 "x"，实际: ' + JSON.stringify(ev.summary));
      }
      if (ev.completedChecks === undefined) {
        throw new Error('completedChecks 丢失（payload 未解析为对象）: ' + JSON.stringify(ev));
      }

      // ---------- 载荷形状校验（in-place 扩展；不新增场景条目） ----------
      // 缺陷形态：summary 写成对象/数组/数字或空串时，record 照样把它写进 evidence。下游 exit 只看到
      // 「没有非空字符串 summary」，于是报 requires evidence: <schema>——出错的是 record、报错的却是
      // exit，执行者要自己反推「载荷该是什么形状」。以下断言把报错锁在坏载荷落库之前：点名字段路径
      // 与当前类型、给出可照抄的正确形态，且 state 字节零改写。
      const beforeBytes = readStateBytes(dir);
      const malformed = [
        { payload: '{"summary":{"nested":"object"}}', expect: 'summary: 必须是字符串（当前是 object）' },
        { payload: '{"summary":["lane"]}', expect: 'summary: 必须是字符串（当前是 array）' },
        { payload: '{"summary":42}', expect: 'summary: 必须是字符串（当前是 number）' },
        { payload: '{"summary":""}', expect: 'summary: 必须是非空字符串（当前是空串）' },
        { payload: '{"summary":"x","completedChecks":[{"id":"a"}]}', expect: 'completedChecks[0]: 必须是字符串（当前是 object）' },
        {
          payload: '{"summary":"x","lessonsNomination":{"nominated":[{"id":"a"}],"reasonIfNone":""}}',
          expect: 'lessonsNomination.nominated[0]: 必须是字符串（当前是 object）',
        },
      ];
      let lastMalformed = null;
      for (const item of malformed) {
        const res = runState(['record', 'open', item.payload, '--protocol', custom], dir);
        assertExit(res, 1);
        assertOut(res, item.expect);
        assertStateBytesUnchanged(
          dir,
          beforeBytes,
          '形状非法的载荷必须在写入前被拒（' + item.payload + '）',
        );
        lastMalformed = res;
      }
      // 报文还得给「该写成什么」：只有一句「不合法」等于让执行者再猜一次。
      assertOut(lastMalformed, '\'{"summary":"<本节点完成摘要>"}\'');
      assertOut(lastMalformed, '--json-file');
      assertOut(lastMalformed, 'cmd.exe');
      // 正锚：类型合法的载荷逐字通过（校验只判类型，不新增业务规则）
      const okPayload = JSON.stringify({
        summary: '形状合法',
        completedChecks: ['unit-tests'],
        lessonsNomination: { scanned: 0, nominated: [], reasonIfNone: '无新增条目' },
      });
      const okRes = runState(['record', 'open', okPayload, '--protocol', custom], dir);
      assertExit(okRes, 0);
      const okEvidence = JSON.parse(readStateBytes(dir)).evidence.open;
      if (okEvidence.summary !== '形状合法'
        || okEvidence.lessonsNomination.reasonIfNone !== '无新增条目'
        || !Array.isArray(okEvidence.completedChecks)) {
        throw new Error('类型合法的载荷未被原样写入: ' + JSON.stringify(okEvidence));
      }
    },
  },

  // 65: 自定义协议未声明 writeWhitelist 时，非内置节点写源码 → BLOCK（ 方案 B：
  // 协调者默认 .specs/——当前 fail-open 放行）
  {
    name: '65 自定义节点未声明白名单写源码 BLOCK',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 2);
    },
  },

  // 66: 自定义协议未声明白名单时，写 .specs/ 工件 → 放行（ 协调者默认的正面）
  {
    name: '66 自定义节点未声明白名单写工件放行',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'NODE: brainstorm');
    },
  },

  // 67: 旧格式 state（无 status 字段 + 无 activeChange + 无 currentNode——归档批次的升级场景）
  // → hook 放行（：无 activeChange 与无 state 文件同语义——当前被「not running」拦截）
  {
    name: '67 旧 state 无 status 无 activeChange hook 放行',
    run: (dir) => {
      const st = baseState('open');
      delete st.status;
      st.activeChange = null;
      st.currentNode = null;
      writeState(dir, st);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 0);
    },
  },

  // 68: writeWhitelist 路径支持 <change-id> 占位符（：协议复用自动适配——
  // 与 artifacts paths 同机制——当前字面匹配失败 BLOCK）
  {
    name: '68 writeWhitelist change-id 占位符',
    run: (dir) => {
      const custom = customProtocol();
      custom.writeWhitelist = { brainstorm: ['.specs/<change-id>/'] };
      writeFile(dir, 'ph-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running' }));
      // 写 .specs/compose-demo/（占位符替换为 activeChange=compose-demo）→ 放行
      const r1 = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'ph-protocol.json') });
      assertExit(r1, 0);
      // 写 .specs/other/（不在白名单）→ BLOCK
      const r2 = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'other', 'x.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'ph-protocol.json') });
      assertExit(r2, 2);
    },
  },

  // 69: 自定义协议 init 输出 NODE: 协议首节点（：printNext 硬编码 open——输出与 state 不一致）
  {
    name: '69 init 输出 NODE 协议首节点',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const res = runState(['init', 'tf17-out'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'NODE: brainstorm');
      assertNotOut(res, 'NODE: open');
    },
  },

  // 70: state completed + activeChange 非空（残留值）→ status 应 no-change（：
  // completed 检查优先于 activeChange 分支——当前 activeChange 分支先命中误判）
  {
    name: '70 completed state 残留 activeChange 不误判',
    run: (dir) => {
      const st = composeState({ status: 'completed', currentNode: null });
      st.activeChange = 'stale-id';
      writeState(dir, st);
      writeFile(dir, '.specs/stale-id/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/stale-id/TASK.md', '# TASK\n');
      const res = runStateWithProtocol(dir, ['status']);
      assertExit(res, 0);
      assertOut(res, 'no-change');
    },
  },

  // 71: 自定义协议未声明 state.statePath（最小 schema）→ hook 不崩溃，写 .specs/ 放行
  // （：statePath 缺省回退 .flow-comet/flow-comet-state.json——与 workflow-state 硬编码一致；
  //  当前空值解析崩溃 exit 1 全量拦截）
  {
    name: '71 无 statePath 协议 hook 不崩溃',
    run: (dir) => {
      const custom = customProtocol();
      delete custom.state;
      writeFile(dir, 'nostate-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'nostate-protocol.json') });
      assertExit(res, 0);
    },
  },

  // 72: state 文件带 UTF-8 BOM（外部写入如会话 Write）→ status 正常输出（：
  // 读端 JSON.parse 应容忍 BOM——当前崩）
  {
    name: '72 state 带 BOM 正常读取',
    run: (dir) => {
      const st = composeState({ status: 'running' });
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.flow-comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), raw, 'utf8');
      writeFile(dir, '.specs/compose-demo/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runStateWithProtocol(dir, ['status']);
      assertExit(res, 0);
      assertOut(res, '"status": "running"');
    },
  },

  // 73: hook 读带 BOM 的 state → 判定正常（——hook readStateJson 的 BOM 容忍）
  {
    name: '73 hook 读带 BOM state 正常',
    run: (dir) => {
      const st = baseState('open');
      st.status = 'running';
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.flow-comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), raw, 'utf8');
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'CHANGE.md') } });
      assertExit(res, 0);
      assertOut(res, 'NODE: open');
    },
  },

  // ----------  场景（builtin 降级须含缓存尝试证据） ----------

  // 74: builtin-quickcheck 声明 + 不可用原因但无缓存尝试证据 → BLOCKED
  // （防「未尝试 Read 插件缓存协议文件」的偷懒降级——判据为 BLOCK，无渐进侧）
  {
    name: '74 builtin 无缓存尝试证据 → BLOCKED',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbuiltin-quickcheck — brooks-lint 不可用（Skill 仅返回占位，插件执行体未加载），按协议降级内置 R1~R6 快查',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '缓存尝试证据');
    },
  },

  // 75: cache-brooks 声明（两级降级路径第 2 级——读缓存手动执行成功）→ 放行
  // （ 补：guard method 正则须识别 cache-brooks——修复前正则不匹配 → 全文无 brooks-review/builtin → BLOCKED = RED）
  {
    name: '75 cache-brooks 声明 → 放行',
    run: (dir) => {
      writeNodeDeclarationMarkers(dir, 'execute');
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\ncache-brooks — 已 Read 插件缓存协议文件手动执行完整审查（4-element + file:line + 书引用），结果见「6 维自查」',
        sixDim: '## 6 维自查\n\n- 功能: 通过（cache-brooks 审查已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 76: builtin-quickcheck 声明 + 不可用原因 + 含缓存尝试证据（已 Read 插件缓存协议文件）→ 无 WARN 放行
  // （ 正面：两级降级路径的第 2 级被正确执行后的合法态）
  {
    name: '76 builtin 含缓存尝试证据 → 无 WARN',
    run: (dir) => {
      writeNodeDeclarationMarkers(dir, 'execute');
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbuiltin-quickcheck — 已尝试 Skill 加载（仅占位）并已 Read 插件缓存协议文件（~/.claude/plugins/cache/brooks-lint-marketplace/...）手动执行，仍不可行，brooks-lint 不可用，按协议降级内置 R1~R6 快查',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 77: guard 读带 BOM 的 state → 正常（——guard readStateJson 的 BOM 容忍）
  {
    name: '77 guard 读带 BOM state 正常',
    run: (dir) => {
      const st = baseState('open');
      st.status = 'running';
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.flow-comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), raw, 'utf8');
      writeFile(dir, '.specs/compose-demo/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runGuardWithProtocol(dir, ['entry', 'open']);
      assertExit(res, 0);
    },
  },

  // ----------  场景（worktree 委托链路，验证问题实录） ----------

  // 78: 路由诊断——「未找到可委托并行块」诊断的在场/静默边界。期望随 multipass-exit-hardening
  // ROUTE WARN 前置条件语义更新（ROUTE WARN 增加存在任一 status=pending 的前置条件）：① 夹具存在可解析 pending
  // 任务（串行 pending + 并行全 done）且无可委托并行块 → ROUTE WARN 保持在场（检测失败纠偏可见
  // ——信息量保留）；② 旧模板无 status 属性形态（无可解析 pending）→ 按新前置条件静默
  // （原「旧模板也告警」行为被设计性取代）。
  // nextNode 只看 completedNodes——路由触发场景 = exit plan（completed 后 nextNode=execute → 路由检查）
  {
    name: '78 路由诊断：有 pending 无可委托并行 WARN 在场 / 无可解析 pending 静默',
    run: (dir) => {
      writeNodeDeclarationMarkers(dir, 'plan');
      const st = baseState('plan');
      st.completedNodes = ['open', 'design'];
      st.evidence.plan = { summary: 'executed' };
      writeState(dir, st);
      // 上游工件（open=CHANGE+REQUIREMENT、design=DESIGN-lite、plan=TASK）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n## 用户故事\nx\n## 验收准则（AC）\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN-lite.md', '# DESIGN-lite\n## 决策清单\n- d1: x\n');
      // ① 可解析 pending 在场且剩余全串行（并行已 done、串行 pending、无缺 status 畸形块）
      // → M4 静默（P→S 收尾转换无噪音——① 语义随扩展翻转）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P01" parallel="true" status="done">\n  <action>do</action>\n  <verify>echo ok</verify>\n</task>\n' +
        '<task id="T01" parallel="false" status="pending">\n  <action>do serial</action>\n  <verify>echo ok</verify>\n</task>\n');
      const res = runGuardWithProtocol(dir, ['exit', 'plan', '--apply']);
      assertExit(res, 0);
      assertNotOut(res, 'ROUTE WARN');
      // ② 旧模板无 status 属性（无可解析 pending）→ 前置条件跳过诊断 → 静默
      //（① 的 --apply 已把 currentNode 推进到 execute——先复位 state 再独立跑第二半）
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T02" parallel="true">\n  <action>do legacy</action>\n  <verify>echo ok</verify>\n</task>\n');
      const resLegacy = runGuardWithProtocol(dir, ['exit', 'plan', '--apply']);
      assertExit(resLegacy, 0);
      assertNotOut(resLegacy, 'ROUTE WARN');
    },
  },

  // 79: C4 catch 可见化——非 git 仓库 → entry execute 输出 C4-CHECK SKIP
  // （检测失败也要可见——修复前 catch 静默 = RED）
  {
    name: '79 C4 catch 非 git 仓库输出 SKIP',
    run: (dir) => {
      const st = baseState('execute');
      writeState(dir, st);
      const res = runGuardWithProtocol(dir, ['entry', 'execute']);
      assertExit(res, 0);
      assertOut(res, 'C4-CHECK SKIP');
    },
  },

  // 80: handoff result 的 Return Contract 校验——① 无效 commitHash → HANDOFF ERROR（固化：校验已存在（W2-D），经确认）；
  // ② 形状校验：与 record 共用 state-schema.evidencePayloadProblems，畸形契约在写盘**之前**被拒（exit 1 +
  //    点名字段路径与当前类型 + 可照抄形态），state 字节零改写——问题不再延后到出口门禁才暴露；
  //    非对象载荷（字符串 / 数组 / null / 数字）在入口即拒（与 record 入口同一判据，形状表对非对象按设计放行）；
  // ③ 零提交语义（request 记 noCommit）与合法契约不受形状校验影响。
  {
    name: '80 handoff result 契约校验：无效 commitHash → ERROR；非对象与畸形形状写入前拒绝',
    run: (dir) => {
      assertExit(runHandoff(['request', 'T01', 'delegate', '--write-files', 'src/t1.mjs'], dir, { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) }), 0);
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
      const payload = JSON.stringify({
        status: 'DONE',
        commitHash: 'deadbeef00000000000000000000000000000000',
        redEvidence: { command: 'echo red', output: 'red' },
        greenEvidence: { command: 'echo green', output: 'green' },
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        riskSignals: ['none'],
      });
      const res = runHandoff(['result', 'T01', payload], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF ERROR: commitHash 无效或 git show 失败');
      // 形状校验的「字节零改写」基线：① 已落 T01 的 result（HANDOFF ERROR 不阻断记录），
      // 此后每次形状拒绝都不得改动这几行。
      const before = readStateBytes(dir);
      // ② 形状非法 → 写入前拒绝（每条都点名「字段路径 + 当前类型」，且 state 字节零改写）：
      //    completedChecks 的对象元素（既有踩坑形态）、redEvidence 传字符串（应为对象容器）、
      //    commitHash 传数字（零提交只豁免「字段缺席」，不豁免「类型错误」）、status 非字符串与
      //    字符串但不在契约既有取值集合（DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT）。
      const malformed = [
        { payload: '{"status":"DONE","completedChecks":[{"id":"required-skill:subagent-execute.flow-comet-dev"}]}', expect: 'completedChecks[0]: 必须是字符串（当前是 object）' },
        { payload: '{"status":"DONE","redEvidence":"node --check src/t2.mjs"}', expect: 'redEvidence: 必须是对象（当前是 string）' },
        { payload: '{"status":"DONE","commitHash":1234567}', expect: 'commitHash: 必须是字符串（当前是 number）' },
        { payload: '{"status":42}', expect: 'status: 必须是字符串（当前是 number）' },
        { payload: '{"status":"OK"}', expect: 'status: 不属于允许取值（当前是 OK）' },
      ];
      let lastMalformed = null;
      for (const item of malformed) {
        const res = runHandoff(['result', 'T02', item.payload], dir);
        assertExit(res, 1);
        assertOut(res, item.expect);
        assertStateBytesUnchanged(dir, before, 'handoff result 形状校验拒绝（' + item.payload + '）');
        lastMalformed = res;
      }
      // 报文还得给「该写成什么」：只有一句「不合法」等于让执行者再猜一次。
      assertOut(lastMalformed, '"completedChecks":["required-skill:subagent-execute.flow-comet-dev"]');
      assertOut(lastMalformed, 'DONE_WITH_CONCERNS');
      assertOut(lastMalformed, '--json-file');
      // ②b 非对象契约（字符串 / 数组 / null / 数字）在入口即拒——与 record 入口同一判据。形状表只判
      // 「对象各字段的类型」，载荷不是对象时它按设计返回空表；旧实现在这里放行，于是字符串或数组被
      // 原样存进 handoffResult，问题延后到出口门禁（那里只会说「缺 greenEvidence」「缺 completedChecks」
      // ——出错的是 result、报错的却是 exit）。JSON 解析失败且不形似对象字面量的纯文本走同一条拒路：
      // 旧语义「解析失败则存原始字符串」正是同一形态的延后。判据在任何写盘之前 → 逐条断言报文与字节零改写。
      const nonObjectContracts = [
        { payload: '"just a string result"', type: 'string' },
        { payload: 'just a plain text result', type: 'string' },
        { payload: '[{"status":"DONE"}]', type: 'array' },
        { payload: 'null', type: 'null' },
        { payload: '42', type: 'number' },
      ];
      let lastNonObject = null;
      for (const item of nonObjectContracts) {
        const res = runHandoff(['result', 'T05', item.payload], dir);
        assertExit(res, 1);
        assertOut(res, 'result 契约必须是对象（当前是 ' + item.type + '）');
        assertStateBytesUnchanged(dir, before, 'handoff result 非对象契约（' + item.payload + '）');
        lastNonObject = res;
      }
      // 非对象的拒绝同样要给「该写成什么」：可照抄的对象形态，以及引号被 shell 吞掉时的旁路
      assertOut(lastNonObject, '"completedChecks":["required-skill:subagent-execute.flow-comet-dev"]');
      assertOut(lastNonObject, '--json-file');
      // ③ 零提交语义保持可用：request 记 noCommit:true → 契约无 commitHash 照常记录（形状校验不误伤）
      const zeroState = JSON.parse(before);
      // T04 的请求同样要在场：result 缺 request 现已先于提交子集校验被拦，而本段断言的是
      // 「合法完整契约 + 提交子集校验」这条既有路径——故其 request 带真实 write_files（非零提交）。
      zeroState.evidence['subagent-execute'].handoffRequests = {
        T03: { description: 'zero commit', noCommit: true },
        T04: { description: 'valid contract', writeFiles: ['src/x.mjs'] },
      };
      writeState(dir, zeroState);
      const zero = runHandoff(['result', 'T03', '{"status":"DONE","completedChecks":["required-skill:subagent-execute.flow-comet-dev"]}'], dir);
      assertExit(zero, 0);
      assertOut(zero, 'HANDOFF RESULT: T03');
      // ④ 合法完整契约照常通过（commitHash 取夹具仓库的真实提交）
      const headHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const good = runHandoff(['result', 'T04', JSON.stringify({
        status: 'DONE_WITH_CONCERNS',
        commitHash: headHash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'echo red', output: 'red' },
        greenEvidence: { command: 'echo green', output: 'green' },
      })], dir);
      assertExit(good, 0);
      assertOut(good, 'HANDOFF RESULT: T04');
      // ⑤ 委托记账：result 必须有对应的 request（新 change BLOCK / 旧 change WARN）——判定在**任何
      //    写盘之前**，且先于零提交语义与提交子集校验，两个旁路因此由同一处拦下：
      //    · 零提交形态（契约无 commitHash）：无 request 时 isZeroCommit 恒为 false，旧实现静默落库；
      //    · 只提交自身 <task>-SUMMARY.md：无 request 时 writeFiles 允许列表为空，只剩 summaryExact
      //      一条豁免，旧实现的子集校验因此零越界放行。
      const ledgerPayload = (taskId, hash) => JSON.stringify({
        status: 'DONE',
        taskId,
        ...(hash ? { commitHash: hash } : {}),
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'echo red', output: 'red' },
        greenEvidence: { command: 'echo green', output: 'green' },
      });
      // 只含自身 SUMMARY 的提交：旧实现正是靠 summaryExact 豁免放行的那条路径
      writeFile(dir, '.specs/' + CHANGE_ID + '/T06-SUMMARY.md', '# SUMMARY: T06\n');
      execFileSync('git', ['add', '.specs/' + CHANGE_ID + '/T06-SUMMARY.md'], { cwd: dir });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'summary only'], { cwd: dir });
      const summaryHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const ledgerState = JSON.parse(readStateBytes(dir));
      const ledgerRequests = ledgerState.evidence['subagent-execute'].handoffRequests || {};
      if (Object.prototype.hasOwnProperty.call(ledgerRequests, 'T06')) {
        throw new Error('夹具前提不成立：T06 不应已有 request（本段构造的是缺 request 的 result）');
      }
      writeState(dir, ledgerState);
      const ledgerBytes = readStateBytes(dir);
      const missingRequest = [
        { label: '零提交形态（契约无 commitHash）', payload: ledgerPayload('T06') },
        { label: '只提交自身 SUMMARY', payload: ledgerPayload('T06', summaryHash) },
      ];
      let missingRequestOutput = '';
      for (const item of missingRequest) {
        const res = runHandoff(['result', 'T06', item.payload], dir);
        assertExit(res, 1);
        // 报文点名任务 + 恢复段；且拦下它的不是零提交分支、也不是提交子集校验（判据必须靠前）。
        assertOut(res, 'BLOCKED: 任务 T06 的 result 没有对应的委托 request');
        assertOut(res, '再重录 result');
        // 恢复句给的是命令形态：任务号已填、脚本路径由 scriptCommand 装配；占位符 <description> 不得
        // 出现在命令里（bash 下 `<` 是输入重定向——占位符让「照抄」变成一条必然失败的命令行）。
        assertOut(res, ' request T06');
        assertNotOut(res, '<description>');
        assertNotOut(res, 'HANDOFF RESULT');
        assertNotOut(res, 'HANDOFF 零提交');
        assertNotOut(res, '提交文件超出 writeFiles 范围');
        assertStateBytesUnchanged(dir, ledgerBytes, '缺 request 的 result 被拦（' + item.label + '）');
        missingRequestOutput = res.output;
      }
      const missingRequestStart = missingRequestOutput.lastIndexOf('恢复:');
      const missingRequestRecovery = missingRequestStart < 0 ? '' : missingRequestOutput.slice(missingRequestStart);
      const requestRecoveryLine = (missingRequestRecovery.match(/^\s*(node "[^"]+" request T06)$/m) || [])[1];
      assertTrue(typeof requestRecoveryLine === 'string',
        '缺 request 的恢复段必须给出可照抄的 request 命令（行首 = node + 引号脚本路径）:\n' + missingRequestOutput);
      assertRecoveryCommandLines(missingRequestRecovery, [requestRecoveryLine], '缺 request 的 result 恢复段');
      // 旧 change 同样的输入只 WARN（渐进，不阻断既有流程）
      const legacyLedger = JSON.parse(ledgerBytes);
      writeState(dir, legacyLedger);
      const legacy = runHandoff(['result', 'T06', ledgerPayload('T06', summaryHash)], dir);
      assertExit(legacy, 0);
      assertOut(legacy, 'HANDOFF WARN: T06');
      assertOut(legacy, '没有对应的委托 request');
      assertOut(legacy, 'HANDOFF RESULT: T06');
      // 有 request 的 result 照常通过（零提交语义不变：noCommit 请求 + 无 commitHash 契约）
      const withRequest = JSON.parse(readStateBytes(dir));
      withRequest.evidence['subagent-execute'].handoffRequests = {
        ...withRequest.evidence['subagent-execute'].handoffRequests,
        T08: { description: 'delegated', noCommit: true },
      };
      writeState(dir, withRequest);
      const recorded = runHandoff(['result', 'T08', ledgerPayload('T08')], dir);
      assertExit(recorded, 0);
      assertOut(recorded, 'HANDOFF RESULT: T08');
      assertNotOut(recorded, '没有对应的委托 request');
      // ⑤b 照抄恢复段的那条命令**真执行**：「能解析」不是判据，能跑通并把 request 落到 state 才是。
      //     随后同一条 result 不再撞「没有对应的委托 request」（这一格判的不是它之后还有多少门）。
      //     T06 按并行任务落夹具：归属门把并行任务判给 subagent-execute（串行任务归属 execute），
      //     节点与 currentNode 不一致会先被归属门拦下，测不到恢复命令本身。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="T06" parallel="true" status="pending"><action>委托边界</action>'
        + '<write_files>src/t06.mjs</write_files><verify>node --check src/t06.mjs</verify>'
        + '<depends_on></depends_on></task>\n');
      const execState = baseState('subagent-execute');
      execState.evidence['subagent-execute'] = { summary: 'delegated' };
      writeState(dir, execState);
      writeNodeDeclarationMarkers(dir, 'subagent-execute');
      installSkillTreeCopy(dir, path.join('.claude', 'skills'));
      assertPrintedCommandTargetsInstalledScript(requestRecoveryLine, dir, 'workflow-handoff.mjs', '缺 request 的恢复命令');
      const rerunRequest = runPrintedCommand(requestRecoveryLine, dir, {
        FLOW_COMET_RUN_ROOT: dir,
        FLOW_COMET_PROTOCOL: '',
      });
      assertExit(rerunRequest, 0);
      assertOut(rerunRequest, 'HANDOFF REQUEST: T06');
      const afterRequest = JSON.parse(readStateBytes(dir));
      assertTrue(afterRequest.evidence?.['subagent-execute']?.handoffRequests?.T06 !== undefined,
        '照抄恢复命令后 handoffRequests 应落下 T06 记录: '
          + JSON.stringify(afterRequest.evidence?.['subagent-execute']?.handoffRequests));
      const afterRequestResult = runHandoff(['result', 'T06', ledgerPayload('T06')], dir);
      assertNotOut(afterRequestResult, '没有对应的委托 request');
      // ⑥ 越界报文的事实陈述（只补事实、不改判定）：request 记的是**发起委托那一刻的写面快照**，
      //    TASK.md 的写面可以被 replan 改写。两者不一致时，越界报文追加一行**可观测事实**（快照 ≠
      //    当前该任务写面）+ **条件式成因**（若计划经 replan 变更过写面 → 重新 request 后再记
      //    result），并保留「回退越界文件」为首选指引。判据只能证明两侧不一致，不能证明成因——对
      //    真越界，让人先重跑 request 会把越界文件写进允许列表，所以「记录早于 replan」不得写成断言。
      //    两者一致（普通真越界）不打印诊断行，判定仍是原来的新 change BLOCK / 旧 change WARN。
      //    夹具判别力：TASK.md 里 T09 的写面是 replan 后扩过的（含 rogue.js），T10 的写面与 request
      //    逐字一致；若诊断按「全文第一个写面」而非「该任务的写面」比对，T10 会误报。
      const repo = (args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
      writeFile(dir, 'allowed.js', 'export const allowed = 1;\n');
      writeFile(dir, 'rogue.js', 'export const rogue = 1;\n');
      repo(['add', 'allowed.js', 'rogue.js']);
      repo(['commit', '-qm', 'replan 之后才进写面']);
      const replannedHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      writeFile(dir, 'stray.js', 'export const stray = 1;\n');
      repo(['add', 'stray.js']);
      repo(['commit', '-qm', 'stray']);
      const strayHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const taskWithWriteFiles = (id, files) => '<task id="' + id + '" status="pending"><action>写面边界</action>'
        + '<write_files>\n' + files.join('\n') + '\n</write_files>'
        + '<verify>node --check allowed.js</verify></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + taskWithWriteFiles('T09', ['allowed.js', 'rogue.js'])
        + taskWithWriteFiles('T10', ['allowed.js']));
      const replanState = baseState('subagent-execute');
      replanState.evidence['subagent-execute'] = {
        handoffRequests: {
          T09: { description: 'replan 扩写面前的快照', writeFiles: ['allowed.js'] },
          T10: { description: '写面未变更', writeFiles: ['allowed.js'] },
        },
        handoffResult: {},
      };
      writeState(dir, replanState);
      const boundaryPayload = (id, hash) => JSON.stringify({
        status: 'DONE',
        taskId: id,
        commitHash: hash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check allowed.js', output: 'no output（RED 锚点）' },
        greenEvidence: { command: 'node --check allowed.js', output: 'ok' },
      });
      const staleSnapshotFact = '诊断: 该任务的委托快照与当前 TASK.md 该任务的写面不一致';
      const staleSnapshotCause = '成因未判定；若计划经 replan 变更过写面，出路是重新发起委托（命令如下）后再记录 result';
      // ① 旧快照（request 只允许 allowed.js，TASK.md 已扩到 rogue.js）→ 仍 BLOCK，且要点明可观测事实
      const staleSnapshot = runHandoff(['result', 'T09', boundaryPayload('T09', replannedHash)], dir);
      assertExit(staleSnapshot, 1);
      assertOut(staleSnapshot, 'BLOCKED: 提交文件超出 writeFiles 范围: rogue.js');
      assertOut(staleSnapshot, staleSnapshotFact);
      // 成因是条件式而非断言：「若计划经 replan 变更过写面」才是成因，且再给一条无 replan 时的出路
      assertOut(staleSnapshot, staleSnapshotCause);
      assertOut(staleSnapshot, '若无 replan，越界文件仍不在该任务写面内');
      // 出路是**可照抄的命令**（不是脚本名）：任务号已填、行首即命令——说明行与命令行分开。
      const staleRecoveryLine = (staleSnapshot.output.match(/^\s*(node "[^"]+" request T09)$/m) || [])[1];
      assertTrue(typeof staleRecoveryLine === 'string',
        '越界诊断给出的「重新发起委托」不是可照抄命令:\n' + staleSnapshot.output);
      // 首选指引仍是「回退越界文件」（恢复行在前，诊断行只在其后补事实）
      assertOut(staleSnapshot, '恢复: 回退越界文件或扩展 write_files');
      assertOut(staleSnapshot, '按上面的「回退越界文件」处理');
      // 反向构造：把可能写成事实的旧措辞不得回归（判据只能证明不一致，证明不了「记录早于 replan」）
      assertNotOut(staleSnapshot, '早于最近一次 replan');
      // ② 写面一致的真越界 → 仍是原报文，不得混入事实陈述（否则该行不再有判别力）
      const genuineOverrun = runHandoff(['result', 'T10', boundaryPayload('T10', strayHash)], dir);
      assertExit(genuineOverrun, 1);
      assertOut(genuineOverrun, 'BLOCKED: 提交文件超出 writeFiles 范围: stray.js');
      assertOut(genuineOverrun, '恢复: 回退越界文件或扩展 write_files');
      assertNotOut(genuineOverrun, staleSnapshotFact);
      // ③ 判定语义不变：同一份旧快照在旧 change 上只 WARN（诊断行随报文出现，结果照常落库）
      const legacySnapshot = JSON.parse(readStateBytes(dir));
      writeState(dir, legacySnapshot);
      const legacyWarn = runHandoff(['result', 'T09', boundaryPayload('T09', replannedHash)], dir);
      assertExit(legacyWarn, 0);
      assertOut(legacyWarn, 'HANDOFF WARN: 提交文件超出 writeFiles 范围: rogue.js');
      assertOut(legacyWarn, staleSnapshotCause);
      assertOut(legacyWarn, 'HANDOFF RESULT: T09');
    },
  },

  // 81: entry/exit WARN COUNT 汇总行——构造 SIGNATURE-ALGO WARN（跨算法版本签名，提示级）→ exit 输出
  // WARN COUNT（可观测性：提示级判据不静默）
  {
    name: '81 exit 输出 WARN COUNT 汇总',
    run: (dir) => {
      writeNodeDeclarationMarkers(dir, 'execute');
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      // 跨算法版本的签名：值不可比 → SIGNATURE-ALGO WARN（仍为提示级），用来驱动 WARN COUNT 汇总行
      st.taskHash = 'v0:' + '0'.repeat(64);
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      const res = runGuardWithProtocol(dir, ['exit', 'execute']);
      assertExit(res, 0);
      assertOut(res, 'SIGNATURE-ALGO WARN');
      assertOut(res, 'WARN COUNT:');
    },
  },

  // 82: 空退出行为固化——全 parallel 任务 exit execute → task-summaries BLOCKED（现状保护，H1 文档一致化的行为锚点）
  {
    name: '82 全 parallel exit execute BLOCKED 产物（batch-H 固化）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" parallel="true" status="pending">\n  <action>do</action>\n</task>\n<task id="T02" parallel="true" status="pending">\n  <action>do2</action>\n</task>\n');
      const res = runGuardWithProtocol(dir, ['exit', 'execute']);
      assertExit(res, 1);
      assertOut(res, 'missing Output Schema artifacts');
    },
  },

  // 83~91: 自动初始化检测（auto-init-detection）——脚本确定性探测/判决/提示 + agent 生成协作
  // 生成职责：--init-context 时 CONTEXT 缺失 → INIT-GENERATE 指引（不生成、
  // 不写 last_intel_scan），由 agent 全量阅读生成；生成后重跑 → 脚本校验 7 段 → 通过写 last_intel_scan。
  // 83: CONTEXT 缺失 + 有代码上下文 → init 输出 INIT-NEEDED 且不自动生成（基础探测）
  {
    name: '83 CONTEXT 缺失 + 有代码 → init 输出 INIT-NEEDED 不生成',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      assertOut(res, 'INIT-NEEDED');
      if (fs.existsSync(path.join(dir, '.specs', 'CONTEXT.md'))) throw new Error('CONTEXT 不应被自动生成');
    },
  },

  // 84: --init-skip → state.ai_context_doc='none'，下次 init 不再提示（拒绝路径）
  {
    name: '84 --init-skip 记 none 且下次 init 静默',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-skip']);
      const st1 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st1.ai_context_doc !== 'none') throw new Error('ai_context_doc 应为 none');
      const res2 = runStateWithProtocol(dir, ['init', CHANGE_ID + '-2']);
      if (res2.output.includes('INIT-NEEDED') || res2.output.includes('INIT-HINT')) throw new Error('下次 init 不应再提示');
    },
  },

  // 85: CONTEXT 新鲜（last_intel_scan ≤90 天）→ init 零初始化输出（新鲜路径）
  {
    name: '85 CONTEXT 新鲜 → init 零初始化输出',
    run: (dir) => {
      writeState(dir, { ...baseState('open'), last_intel_scan: new Date(Date.now() - 10 * 864e5).toISOString() });
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      if (res.output.includes('INIT-NEEDED') || res.output.includes('INIT-HINT')) throw new Error('不应有初始化提示');
    },
  },

  // 86: 有 CONTEXT 无扫描记录（旧项目迁移）→ INIT-HINT 文案不得含 null
  {
    name: '86 有 CONTEXT 无扫描记录 → INIT-HINT 文案无 null',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      assertOut(res, 'INIT-HINT');
      if (res.output.includes('null')) throw new Error('INIT-HINT 不应含 "null"（无扫描记录时用友好文案）');
    },
  },

  // 87: CONTEXT 缺失 + --init-context → INIT-GENERATE 指引且不生成、不写 last_intel_scan（生成协作第一步）
  {
    name: '87 --init-context 无 CONTEXT → INIT-GENERATE 指引不生成',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      if (fs.existsSync(path.join(dir, '.specs', 'CONTEXT.md'))) throw new Error('CONTEXT 不应由脚本生成（生成职责在 agent）');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('校验通过前不应写 last_intel_scan');
    },
  },

  // 88: CONTEXT 缺失 + 既有 AI 文档 + --init-context → INIT-GENERATE 指引含源文档列表
  {
    name: '88 --init-context 指引含源文档列表',
    run: (dir) => {
      writeFile(dir, 'CLAUDE.md', '# CLAUDE\n项目约定：使用 kebab-case 命名。\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      assertOut(res, 'CLAUDE.md');
    },
  },

  // 89: CONTEXT 缺失 + 代码信号 + --init-context → INIT-GENERATE 指引含代码信号
  {
    name: '89 --init-context 指引含代码信号',
    run: (dir) => {
      writeFile(dir, 'requirements.txt', 'pytest\n');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      assertOut(res, '代码信号');
    },
  },

  // 90: CONTEXT 已存在且 7 段 + 模板格式完整 + --init-context → INIT-DONE + last_intel_scan 写入（生成协作第二步）
  {
    name: '90 CONTEXT 7 段+格式完整 --init-context → INIT-DONE + state 写入',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- [2026-08-01] 决策一\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-DONE');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.last_intel_scan) throw new Error('校验通过后应写 last_intel_scan');
    },
  },

  // 91: CONTEXT 存在但缺段 + --init-context → INIT-VALIDATE-FAILED 重写指引 + 不写 last_intel_scan。
  // ② 段名判定须为**精确标题**匹配（非全文 includes）：段名变体（`## 技术栈补充`）与正文文本提及
  // 都不得算作段存在——旧 includes 判据下二者会假通过（校验放行 + 写 last_intel_scan）。
  // ③ 标题解析须先排除围栏代码块：代码示例里的 `## 段名` 不是段（否则缺段仍能假通过并写扫描时间）。
  {
    name: '91 CONTEXT 缺段 --init-context → 重写指引不写 state（含围栏代码块段名不假通过）',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      let res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      assertOut(res, '重写');
      let st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('校验失败不应写 last_intel_scan');
      // ② 段名变体（含正文提及）不满足必填段
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈补充\nx\n## 域语言说明\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策说明\n- [2026-08-01] 决策一\n## 默认偏好补充\nx\n## 既有抽象索引附录\nx\n## intel-scan 元数据附录\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n正文提及 域语言 与 默认偏好 与 既有抽象索引（文本非标题）。\n');
      res = runStateWithProtocol(dir, ['init', CHANGE_ID + '-2', '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('段名变体不应通过校验（不应写 last_intel_scan）');
      // ③ 围栏代码块内的 `## 段名` 不计入标题集合：缺 `## 默认偏好`，但三种围栏形态——
      //    带语言标注的反引号围栏、缩进 2 空格的波浪线围栏、波浪线围栏——内都出现该段名。
      //    标题正则若不跟踪围栏边界，就会把这些示例行当成段存在 → 假通过并写扫描时间（RED）。
      writeFile(dir, '.specs/CONTEXT.md', [
        '# CONTEXT',
        '## 项目概要', 'x',
        '## 技术栈', 'x',
        '## 域语言', '| 术语 | 定义 |', '|---|---|', '| 例 | 定义 |',
        '## 已锁决策', '- [2026-08-01] 决策一',
        '## 既有抽象索引', 'x',
        '## intel-scan 元数据', '- **last_intel_scan**: x', '- **scanner**: x', '- **下次重扫建议**: x',
        '示例（以下均为代码示例，不是段）：',
        '```markdown', '## 默认偏好', '- 反引号围栏内的示例', '```',
        '  ~~~', '## 默认偏好', '  ~~~',
        '~~~text', '## 默认偏好', '~~~',
        '',
      ].join('\n'));
      res = runStateWithProtocol(dir, ['init', CHANGE_ID + '-3', '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('围栏内的段名不应通过校验（不应写 last_intel_scan）');
    },
  },

  // 92: CONTEXT 7 段齐全但模板格式不满足（已锁决策无日期前缀）→ 格式校验失败重写指引 + 不写 state
  {
    name: '92 CONTEXT 格式不满足模板 → 重写指引不写 state',
    run: (dir) => {
      // 7 段齐全但已锁决策条目缺 [YYYY-MM-DD] 日期前缀（模板格式）
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- 决策缺日期前缀\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      assertOut(res, '日期');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('格式校验失败不应写 last_intel_scan');
    },
  },

  // 93: 新项目骨架 CONTEXT（已锁决策仅占位）→ 占位放行 INIT-DONE（DF-5：占位不是裸条目）
  {
    name: '93 新项目占位 CONTEXT → 校验通过 INIT-DONE',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\n新项目骨架\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| （待沉淀） | 随 change 逐步补充 |\n## 已锁决策\n- （待沉淀——后续 change 按时间倒序追加）\n## 默认偏好\n- 待补充\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-DONE');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.last_intel_scan) throw new Error('占位 CONTEXT 校验通过应写 last_intel_scan');
    },
  },

  // 94: CONTEXT 已满足模板但无扫描记录 + init 无参数 → 提示"记录扫描时间"（C 文案优化——
  // agent 生成后未重跑的悬空态，误导性"扫描时间未知/刷新"文案不出现）
  {
    name: '94 CONTEXT 就绪无扫描记录 → 提示记录扫描时间',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- [2026-08-01] 决策一\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      assertOut(res, '记录扫描时间');
      if (res.output.includes('刷新')) throw new Error('CONTEXT 已就绪不应提示"刷新"（应提示记录扫描时间）');
    },
  },

  // 95: init 同 id 重跑（.specs/<id>/ 已存在）→ WARN 防护输出且不阻断（F）
  {
    name: '95 init 同 id 重跑 → WARN 防护不阻断',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      runStateWithProtocol(dir, ['init', CHANGE_ID]);
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      assertOut(res, 'WARN: change ' + CHANGE_ID + ' 已存在');
      assertOut(res, '重置节点状态');
    },
  },

  // 96~97: 端到端验证实证的校验误报修复
  // 96: 自检方法段内后续行声明方法（子代理把方法名写在列表后续行）→ 放行无 WARN
  // （修复前 guard 正则只匹配段后第一行 → 全文有 cache-brooks 声明 → 误报 BROOKS-LINT WARN = RED）
  {
    name: '96 自检方法段后续行声明 → 放行',
    run: (dir) => {
      writeNodeDeclarationMarkers(dir, 'execute');
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\n- flow-comet-dev Skill 加载成功\n- 自检：第 1 级 brooks-review 返回占位 → 第 2 级 Read 插件缓存协议文件手动执行（selfReview: cache-brooks）',
        sixDim: '## 6 维自查\n\n- 功能: 通过（cache-brooks 审查已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 97: handoff changedFiles 含任务专属 SUMMARY(.specs/<change-id>/<task-id>-SUMMARY.md,
  // 精确豁免路径)→ 不报越界 WARN;其他 *-SUMMARY.md(非本任务路径)仍判越界
  // (修复前 W2-D 以 endsWith('-SUMMARY.md') 全量豁免 + 前缀匹配 = RED;真实 commitHash 供 git show 校验)
  {
    name: '97 handoff 含 SUMMARY 文件 → 无越界 WARN',
    run: (dir) => {
      const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      g(['init', '-q']);
      g(['config', 'user.email', 't@t']);
      g(['config', 'user.name', 't']);
      writeFile(dir, 'test_stats.py', 'def f():\n    pass\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', '# T01-SUMMARY\n## 做了什么\nx\n');
      // 只提交指定文件（场景运行器预置的 reference/ 协议文件不入提交集）
      g(['add', 'test_stats.py', '.specs/' + CHANGE_ID + '/T01-SUMMARY.md']);
      g(['commit', '-qm', 'init']);
      const hash = g(['rev-parse', 'HEAD']).stdout.trim();
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = {
        handoffRequests: { T01: { writeFiles: ['test_stats.py'] } },
        handoffResult: {},
      };
      writeState(dir, st);
      const res = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', commitHash: hash,
        changedFiles: ['test_stats.py', '.specs/' + CHANGE_ID + '/T01-SUMMARY.md'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check test_stats.py', output: 'ok' },
      })], dir);
      assertExit(res, 0);
      if (res.output.includes('超出 writeFiles 范围')) throw new Error('任务专属 SUMMARY 不应报越界 WARN');
    },
  },
];
