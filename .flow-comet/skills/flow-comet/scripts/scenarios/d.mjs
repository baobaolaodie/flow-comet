// 场景组 d — 安装器平台选择 · 多趟依赖图 · 契约解析失败检测
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界：场景序列按组文件规模上限连续分区——本文件先承载 D 组场景、后承载 E 组头部两项（154 · 155）；
// 分区只搬文件，场景名/内容与其在入口 `SCENARIOS` 里的拼接顺序均不变。

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  assertExit,
  assertNotOut,
  assertOut,
  assertTrue,
  baseState,
  runGuard,
  runHandoff,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  dropNamedImport,
  engineCodeText,
  engineConsumersOf,
  engineDefinitionHits,
  engineDefinitionModule,
  engineScriptTexts,
  makeTmp,
  PREPARE_ENV,
  renderMultiWaveTasks,
  runPlanExit,
  runPrepareEnv,
  SCRIPTS_DIR,
  TASK_DEP_CYCLE,
  TASK_MISSING_DEP,
  TASK_MIXED_PSP,
  TASK_MIXED_SPS,
  TASK_VALID_ALL_PARALLEL,
  writeNodeDeclarationMarkers,
} from '../lib/test-fixtures.mjs';
import {
  REPLAN_STALE_SIGNATURE,
  assertStateBytesUnchanged,
  readStateBytes,
  replanBackupFiles,
  replanExecuteState,
  runStateWithProtocol,
} from '../lib/test-assertions.mjs';
import { singleSourceImportProblems } from '../lib/text-anchor-checks.mjs';

// ---------- 波次投影族夹具（plan 出口：波次 = 依赖层级的投影） ----------
// 匿名化同形夹具（中性任务 id / 中性路径），与真实计划同形不同内容：真实计划只作一次性验收载体，
// 不进套件夹具、也不随包分发。任务块的 parallel="true" 与散文的 [P] 标记保持一致——否则先被既有的
// 「波次散文一致性」判据拦下，测不到波次投影本身。
// options.parallel=false 时**不写开标签属性**（「未标 parallel」的真实形态——写 parallel="false"
// 也是同一个判定结果，但夹具要表达的是「没声明」）；options.write 覆盖写面路径（构造「写面重叠」对）。
const waveTask = (id, deps = '', { parallel = true, write } = {}) => {
  const writePath = write ?? 'src/' + id.toLowerCase() + '.mjs';
  return '<task id="' + id + '"' + (parallel ? ' parallel="true"' : '') + ' status="pending"><action>实现 ' + id
    + '</action><write_files>' + writePath + '</write_files><verify>node --check ' + writePath
    + '</verify><depends_on>' + deps + '</depends_on></task>\n';
};

// 波次段 + 任务清单的最小 TASK.md。Wave 行的注解形态刻意取真实工件的写法（(parallel) 标注、
// 括号依赖注解、行尾 # 注释、[P] 标记）——解析面必须容忍它们，且不把注解里的 id 算成本波成员。
const waveMarkdown = (waveLines, tasks) => '# TASK\n\n## 波次划分\n\n```\n' + waveLines
  + '\n```\n\n## 任务清单\n\n' + tasks;

// 写 TASK.md → entry plan（走完整入口记录）→ exit plan；返回 exit 结果。
const runPlanWithTask = (dir, markdown) => {
  writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', markdown);
  assertExit(runGuard(['entry', 'plan'], dir), 0);
  // 新 change 的声明标记（真实流程里由协调者 / record 写；夹具直接写 state 时补同一份事实）
  writeNodeDeclarationMarkers(dir, 'plan');
  return runGuard(['exit', 'plan'], dir);
};

// 同一判据的三种形态（单变量构造：只有波次声明 / 依赖变化）：
//   ① 诚实——同波任务彼此无依赖，每波 = 依赖层级（无依赖第 1 波，其余 = 1 + 依赖中最晚波次）；
//   ② 同波依赖——T02 依赖 T01 却与它同写第 2 波（被依赖的 T01 层级为 1，无法与依赖方同波）；
//   ③ 排得保守——T02 无依赖（层级为 1）却排到第 3 波（排得比依赖允许的更靠后，浪费并行效率）。
const honestWavePlan = () => waveMarkdown(
  'Wave 1 (parallel): T01[P], T02[P]\nWave 2 (parallel): T03[P]   (depends on T01, T02)\nWave 3: T04   (depends on T03)   # 收尾',
  waveTask('T01') + waveTask('T02') + waveTask('T03', 'T01,T02') + waveTask('T04', 'T03'));
const sameWavePlan = () => waveMarkdown(
  'Wave 2 (parallel): T01[P], T02   (T02 on T01)',
  waveTask('T01') + waveTask('T02', 'T01'));
const conservativeWavePlan = () => waveMarkdown(
  'Wave 1: T01\nWave 3: T02   # 无依赖却排到第三波',
  waveTask('T01') + waveTask('T02'));
// 修正后：T01 回到第 1 波、T02 排到第 2 波并显式依赖 T01（恢复指引的两条出路都落到这份夹具上）。
const fixedWavePlan = () => waveMarkdown(
  'Wave 1 (parallel): T01[P]\nWave 2: T02   (depends on T01)',
  waveTask('T01') + waveTask('T02', 'T01'));

// 未声明任务：Wave 行只写 T01，而任务集里还有 T02（依赖 T01）与 T03（依赖 T02）——这是「真任务集
// 减去 Wave 声明集」的差集，此前完全不进判定（判据只沿「已声明」一侧求差），于是 exit 0 且零输出。
const undeclaredWavePlan = () => waveMarkdown(
  'Wave 1 (parallel): T01[P]',
  waveTask('T01') + waveTask('T02', 'T01') + waveTask('T03', 'T02'));

// 修复族任务不在波次声明的义务面内：带修复族前缀 id 的任务、以及位于「Fix 任务」段内的任务
// （R01），两者都不写进 Wave 行，判据仍须放行——族判定一律经 task-graph 的唯一谓词，判据侧
// 不自写前缀匹配。
const fixFamilyWavePlan = () => waveMarkdown(
  'Wave 1 (parallel): T01[P]\nWave 2: T02   (depends on T01)',
  waveTask('T01') + waveTask('T02', 'T01')
  + '<task id="T-FIX-01" status="pending"><action>回修前缀形态</action>'
  + '<write_files>src/fix1.mjs</write_files><verify>node --check src/fix1.mjs</verify>'
  + '<depends_on></depends_on></task>\n'
  + '\n## Fix 任务（来自 REVIEW / INTEGRATION）\n\n'
  + '<task id="R01" status="pending"><action>回修段内形态</action>'
  + '<write_files>src/fix2.mjs</write_files><verify>node --check src/fix2.mjs</verify>'
  + '<depends_on></depends_on></task>\n');

// 全角与半角是同一份错误计划的两种写法（唯一变量 = 标点）：同一明细、同一分级。漏收全角逗号时，
// 中文写法解析不出任务 id ⇒ 降级成「未校验」放行（实测 Wave 1：T01，T02 → exit 0 + ALL CHECKS PASSED）。
const fullWidthSameWavePlan = () => waveMarkdown(
  'Wave 2（parallel）：T01[P]，T02　（T02 on T01）',
  waveTask('T01') + waveTask('T02', 'T01'));

// 波次段正文（段在场、正文不可判）：段标题在场而判据拿不到任何可对应任务的 Wave 行——三种真实
// 糊弄形态是同一成因的三个入口（纯 N/A 声明 / 点到不存在的任务 id / 行首带 Markdown 强调记号）。
const waveBodyPlan = (body, tasks) => '# TASK\n\n## 波次划分\n\n' + body + '\n\n## 任务清单\n\n' + tasks;
const naWavePlan = () => waveBodyPlan('N/A（本计划不使用波次划分）', waveTask('T01') + waveTask('T02', 'T01'));
const phantomWavePlan = () => waveBodyPlan('```\nWave 1: T99\n```', waveTask('T01'));
const boldWavePlan = () => waveBodyPlan('```\n**Wave 1**: T01\n```', waveTask('T01'));

// 同波可并行却漏标 [P]（波次判据之后的第二条波次面判据）：Wave 1 里的 T01 与 T02 彼此无依赖、
// write_files 不重叠（本可并行），而只有 T01 标了 parallel="true"。单变量 = T02 的 parallel 标记
// （markAll）——判据该报的正是「本可并行却谁都没说」这一形态。「写面不重叠」的判定入口是
// task-graph 的 collectCrossTaskConflicts（其返回集合的补集，见 wave-projection 的判据注释）。
const parallelGapPlan = ({ markAll = false } = {}) => waveMarkdown(
  'Wave 1 (parallel): T01[P], T02',
  waveTask('T01') + waveTask('T02', '', { parallel: markAll }));
// 第二条出路：补一条 depends_on 把两者排到不同波次（T02 进第 2 波，标记仍是串行）。
const parallelGapDependPlan = () => waveMarkdown(
  'Wave 1 (parallel): T01[P]\nWave 2: T02   (depends on T01)',
  waveTask('T01') + waveTask('T02', 'T01', { parallel: false }));
// 修复族不参与：同波四只修复任务（两只族前缀 + 两只修复段内）都没标 parallel、写面互不重叠——
// 族判定经 task-graph 的唯一谓词，判据不得在这里另立一套边界。
const fixPairWavePlan = () => waveMarkdown(
  'Wave 1: T-FIX-01, T-FIX-02, R01, R02',
  waveTask('T-FIX-01', '', { parallel: false }) + waveTask('T-FIX-02', '', { parallel: false })
  + '\n## Fix 任务（来自 REVIEW / INTEGRATION）\n\n'
  + waveTask('R01', '', { parallel: false }) + waveTask('R02', '', { parallel: false }));
// 写面重叠的一对不是「可并行」：同波同层、都没标 parallel，但写同一个文件——写冲突族另有判据，
// 本判据不得在同一对上加一条「可并行」的错话（重叠判定退化为「一律不重叠」时这里会多一条报文）。
const overlapPairWavePlan = () => waveMarkdown(
  'Wave 1: T01, T02',
  waveTask('T01', '', { parallel: false, write: 'src/shared.mjs' })
  + waveTask('T02', '', { parallel: false, write: 'src/shared.mjs' }));

// 报告明细行（同一报文构造的逐条投影）：只取报文里的「  - 」行，用于比较两种标点写法的判定是否一致。
const waveDetailLines = (res) => res.output.split(/\r?\n/u).filter((line) => line.startsWith('  - ')).sort();

// 波次报文段（plan 出口与 replan 重校的逐字对账用）：明细标题行 → 恢复行。两处共用同一构造函数，
// 任一处自建报文（或分级规则只改一处）即在此判红。
const waveReportLines = (res) => {
  const lines = res.output.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.includes('波次划分与依赖层级不一致'));
  const end = lines.findIndex((line) => line.startsWith('恢复: 按明细逐项修正'));
  return start < 0 || end < start ? [] : lines.slice(start, end + 1);
};
const waveGapReportLines = (res) => {
  const lines = res.output.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.includes('同波任务可并行却未标 [P]'));
  const end = lines.findIndex((line) => line.startsWith('恢复: 两条出路任选'));
  return start < 0 || end < start ? [] : lines.slice(start, end + 1);
};
const waveUnjudgeableLines = (res) => {
  const lines = res.output.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.includes('波次划分段内容不可判'));
  if (start < 0) return [];
  const next = lines[start + 1] ?? '';
  return next.startsWith('恢复: ') ? [lines[start], next] : [lines[start]];
};

export const ENTRIES = [

  // ----------  场景（prepare-env 平台选择链——T01 实现：显式单平台/逗号多选/all/both 移除/痕迹探测/幂等） ----------

  // 138: 显式单平台 --platform dsh → dsh 描述符生效（skill 根 .dsh/skills/ + 路径替换 + AGENTS.md 托管区 +
  // $DSH_HOME 全局挂载——DSH_HOME=临时目录,禁止污染真实 ~/.dsh）
  {
    name: '138 prepare-env --platform dsh 显式单平台安装生效',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return; // 安装副本无 prepare-env 脚本（与场景 105 同判据）
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const dshHome = path.join(dir, 'dshhome');
      const res = runPrepareEnv(['--target', proj, '--platform', 'dsh'], dir, { DSH_HOME: dshHome });
      assertExit(res, 0);
      assertOut(res, '平台: DeepSeek Harness');
      // dsh 描述符生效:skill 安装到目标 .dsh/skills/（而非 .claude/）
      if (!fs.existsSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('dsh skill 未安装到 .dsh/skills/');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('dsh 单平台不应生成 .claude/');
      // 路径替换生效:安装副本 SKILL.md 含 .dsh/skills/flow-comet/scripts/ 命令路径（权威源 .claude 形态 → dsh 平台化）
      const skillText = fs.readFileSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'), 'utf8');
      if (!skillText.includes('.dsh/skills/flow-comet/scripts/')) throw new Error('SKILL.md 未做 dsh 路径替换');
      // rules 注入:AGENTS.md 托管区
      const agents = fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8');
      if (!agents.includes('<!-- Managed by flow-comet prepare-env -->')) throw new Error('AGENTS.md 托管区未注入');
      // $DSH_HOME 全局挂载（场景隔离:DSH_HOME=临时目录,禁止污染真实 ~/.dsh）
      if (!fs.existsSync(path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs'))) throw new Error('桥接 loader 未复制到 $DSH_HOME/plugins/');
      const patch = fs.readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8');
      if (!patch.includes('dsh-flow-comet-bridge')) throw new Error('cordis.patch.yml 托管块未注入');
    },
  },

  // 139: 显式逗号多平台 --platform claude-code,dsh → 双平台顺序安装（顺序 = 参数顺序）
  {
    name: '139 prepare-env --platform claude-code,dsh 双平台按参数顺序安装',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code,dsh'], dir, { DSH_HOME: path.join(dir, 'dshhome') });
      assertExit(res, 0);
      // 双平台都装:.claude/skills + .dsh/skills 均生成
      if (!fs.existsSync(path.join(proj, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('claude-code 平台未安装');
      if (!fs.existsSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('dsh 平台未安装');
      // 顺序 = 参数顺序:输出中 Claude Code 先于 DeepSeek Harness
      const ccIdx = res.output.indexOf('平台: Claude Code');
      const dshIdx = res.output.indexOf('平台: DeepSeek Harness');
      if (ccIdx < 0 || dshIdx < 0 || ccIdx > dshIdx) throw new Error('安装顺序非参数顺序（Claude Code 应先于 DeepSeek Harness）');
    },
  },

  // 140: --platform all → 全部平台（顺序 = PLATFORMS 表顺序:claude-code → codex → dsh）
  {
    name: '140 prepare-env --platform all 全部平台按表顺序安装',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const res = runPrepareEnv(['--target', proj, '--platform', 'all'], dir, { DSH_HOME: path.join(dir, 'dshhome') });
      assertExit(res, 0);
      // 全部平台:.claude / .agents / .dsh 三套 skill 根均生成
      for (const root of ['.claude', '.agents', '.dsh']) {
        if (!fs.existsSync(path.join(proj, root, 'skills', 'flow-comet', 'SKILL.md'))) throw new Error(root + ' 平台未安装');
      }
      // 顺序 = PLATFORMS 表顺序（输出位置递增:Claude Code → Codex → DeepSeek Harness）
      const ccIdx = res.output.indexOf('平台: Claude Code');
      const codexIdx = res.output.indexOf('平台: Codex');
      const dshIdx = res.output.indexOf('平台: DeepSeek Harness');
      if (ccIdx < 0 || codexIdx < 0 || dshIdx < 0 || !(ccIdx < codexIdx && codexIdx < dshIdx)) {
        throw new Error('all 顺序非 PLATFORMS 表顺序（Claude Code → Codex → DeepSeek Harness）');
      }
    },
  },

  // 141: 未知平台 --platform gemini → 报错（含逗号列表中的未知项——不得部分安装）
  {
    name: '141 prepare-env 未知平台报错（含逗号列表未知项）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const r1 = runPrepareEnv(['--target', proj, '--platform', 'gemini'], dir);
      assertExit(r1, 1);
      assertOut(r1, '未知平台: gemini');
      const r2 = runPrepareEnv(['--target', proj, '--platform', 'claude-code,gemini'], dir);
      assertExit(r2, 1);
      assertOut(r2, '未知平台: gemini');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('未知平台报错前不应产生任何安装');
    },
  },

  // 142: 移除 both:--platform both → 报错提示（逗号分隔或 all）——逗号列表中的 both 同样被拒
  {
    name: '142 prepare-env --platform both 报错提示逗号或 all',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const r1 = runPrepareEnv(['--target', proj, '--platform', 'both'], dir);
      assertExit(r1, 1);
      assertOut(r1, 'both 已移除');
      assertOut(r1, '逗号分隔');
      const r2 = runPrepareEnv(['--target', proj, '--platform', 'claude-code,both'], dir);
      assertExit(r2, 1);
      assertOut(r2, 'both 已移除');
    },
  },

  // 143: 痕迹探测——仅 .dsh/ → probe=dsh;.claude/ + .dsh/ 双痕迹 → 不武断（提示 + 默认主平台 claude-code）
  // （spawn 非 TTY:走探测/默认路径,不触发交互）
  {
    name: '143 prepare-env 痕迹探测:仅 .dsh/ → dsh;双痕迹默认主平台',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const dshHome = path.join(dir, 'dshhome');
      // ① 仅 .dsh/ 痕迹 → probe=dsh → 无 --platform 缺省安装 dsh
      const proj1 = path.join(dir, 'proj1');
      fs.mkdirSync(path.join(proj1, '.dsh'), { recursive: true });
      const r1 = runPrepareEnv(['--target', proj1], dir, { DSH_HOME: dshHome });
      assertExit(r1, 0);
      if (!fs.existsSync(path.join(proj1, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('仅 .dsh/ 痕迹应探测安装 dsh 平台');
      if (fs.existsSync(path.join(proj1, '.claude'))) throw new Error('仅 .dsh/ 痕迹不应安装 claude-code');
      // ② .claude/ + .dsh/ 双痕迹 → 不武断二选一:输出提示 + 默认主平台 claude-code
      const proj2 = path.join(dir, 'proj2');
      fs.mkdirSync(path.join(proj2, '.claude'), { recursive: true });
      fs.mkdirSync(path.join(proj2, '.dsh'), { recursive: true });
      const r2 = runPrepareEnv(['--target', proj2], dir, { DSH_HOME: dshHome });
      assertExit(r2, 0);
      assertOut(r2, '检测到目标项目同时有');
      assertOut(r2, '默认安装 Claude Code');
      if (!fs.existsSync(path.join(proj2, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('双痕迹默认应安装 claude-code');
      if (fs.existsSync(path.join(proj2, '.dsh', 'skills'))) throw new Error('双痕迹默认不应安装 dsh（不武断）');
    },
  },

  // 144: 幂等——同平台重复安装路径替换结果一致（既有语义延续:复制源固定 + 托管区/托管块读-合并-写幂等）
  {
    name: '144 prepare-env 幂等:同平台重复安装结果一致',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true }); // target 项目根须存在（prepare-env 不建父目录——AGENTS.md 写入 ENOENT）
      const dshHome = path.join(dir, 'dshhome');
      const args = ['--target', proj, '--platform', 'dsh'];
      const r1 = runPrepareEnv(args, dir, { DSH_HOME: dshHome });
      assertExit(r1, 0);
      // 首次安装后立即快照——与二次安装后逐字节比较（此前二次后连读恒真，漂移检测失效）
      const skillPath = path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md');
      const sk1 = fs.readFileSync(skillPath, 'utf8');
      const r2 = runPrepareEnv(args, dir, { DSH_HOME: dshHome });
      assertExit(r2, 0);
      // 路径替换结果一致:重复安装后 .dsh/skills 内 SKILL.md 与首次逐字节一致
      const sk2 = fs.readFileSync(skillPath, 'utf8');
      if (sk1 !== sk2) throw new Error('重复安装 SKILL.md 不一致');
      // AGENTS.md 托管区幂等（不重复叠加）
      const agents = fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8');
      const agentsBlocks = agents.split('<!-- Managed by flow-comet prepare-env -->').length - 1;
      if (agentsBlocks !== 1) throw new Error('AGENTS.md 托管区重复注入: ' + agentsBlocks);
      // $DSH_HOME/cordis.patch.yml 托管块幂等（不重复叠加）
      const patch = fs.readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8');
      const patchBlocks = patch.split('# --- flow-comet managed ---').length - 1;
      if (patchBlocks !== 1) throw new Error('cordis.patch.yml 托管块重复注入: ' + patchBlocks);
    },
  },

  // ---------- 场景（多趟路由 plan 出口依赖图校验——多趟语义原位重写：环 BLOCK / 缺失依赖 BLOCK / 混排合法锚 / 旧 change 渐进） ----------

  // 145（多趟语义重写）：新 change + 依赖环（P01↔P02 互为 depends_on）→ exit plan 应 BLOCKED，
  // 输出含「依赖环」（拓扑排序判环）与「depends_on」恢复指引。旧引擎无波次校验静默放行 = 预期 RED。
  {
    name: '145 plan exit BLOCKED：新 change 依赖环（P01↔P02 互为依赖）+ 波次投影三形态（同波依赖 / 排得保守 / 修正后通过）+ 同波漏标 [P] + replan 同源拒绝重签（含执行期删段被 TASK 段形门拦、旧 change 只 WARN）',
    run: async (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_DEP_CYCLE);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '依赖环');
      assertOut(res, 'depends_on');
      // ===== 波次投影（波次 = 依赖层级的投影）三形态：既有 plan 出口族原位扩展，不新增顶层场景 =====
      // ② 同波依赖（Wave 2: T01[P], T02 且 T02 依赖 T01）⇒ 新 change BLOCK，明细逐条点名
      //    （被依赖的 T01 层级为 1，无法与依赖它的 T02 同波）。
      const sameWaveBlocked = runPlanWithTask(dir, sameWavePlan());
      assertExit(sameWaveBlocked, 1);
      assertOut(sameWaveBlocked, '波次划分与依赖层级不一致');
      assertOut(sameWaveBlocked, 'T01');
      assertOut(sameWaveBlocked, '当前波 2');
      assertOut(sameWaveBlocked, '应到波 1');
      // 恢复指引的两条出路都必须可照抄（移到应到波 / 补 depends_on）
      assertOut(sameWaveBlocked, '移到第 1 波');
      assertOut(sameWaveBlocked, 'depends_on');
      assertNotOut(sameWaveBlocked, '未校验（无波次段）');
      // ③ 排得保守（T02 无依赖、只需第 1 波却排到第 3 波）⇒ 同样 BLOCK 且点名 T02——
      //    只判「依赖不得倒挂」会放过这种浪费（作者要的是「不浪费效率」，两者都要判）。
      const conservativeBlocked = runPlanWithTask(dir, conservativeWavePlan());
      assertExit(conservativeBlocked, 1);
      assertOut(conservativeBlocked, '波次划分与依赖层级不一致');
      assertOut(conservativeBlocked, 'T02');
      assertOut(conservativeBlocked, '当前波 3');
      assertOut(conservativeBlocked, '应到波 1');
      // ④ 修正后通过（T01 回第 1 波、T02 排第 2 波并显式依赖 T01）：判据在场（不是跳过）且沉默。
      const waveFixed = runPlanWithTask(dir, fixedWavePlan());
      assertExit(waveFixed, 0);
      assertOut(waveFixed, 'ALL CHECKS PASSED');
      assertNotOut(waveFixed, '波次划分与依赖层级不一致');
      assertNotOut(waveFixed, '未校验（无波次段）');
      // ⑤ 未声明任务（Wave 行只写 T01，任务另有 T02←T01、T03←T02）：新 change 必须 BLOCK，并在
      //    明细里点名「哪些任务没有被波次覆盖」——取值形态沿用同一报文：当前波 = 未声明。
      const undeclaredBlocked = runPlanWithTask(dir, undeclaredWavePlan());
      assertExit(undeclaredBlocked, 1);
      assertOut(undeclaredBlocked, '波次划分与依赖层级不一致');
      assertOut(undeclaredBlocked, 'T02（依赖: T01）当前波 未声明 → 应到波 2');
      assertOut(undeclaredBlocked, 'T03（依赖: T02）当前波 未声明 → 应到波 3');
      assertOut(undeclaredBlocked, '写进第 2 波的 Wave 行');
      // 已声明的 T01 不得被算成未声明（判据不是把所有任务一网打尽）
      assertNotOut(undeclaredBlocked, 'T01（依赖: 无）当前波 未声明');
      // ⑥ 修复族任务不被要求覆盖：族前缀形态的任务与修复段内的 R01 都不写进 Wave 行，判据照常
      //    放行——族排除经 task-graph 的唯一谓词，判据侧没有第二套前缀匹配。
      const fixFamilyPassed = runPlanWithTask(dir, fixFamilyWavePlan());
      assertExit(fixFamilyPassed, 0);
      assertOut(fixFamilyPassed, 'ALL CHECKS PASSED');
      assertNotOut(fixFamilyPassed, '未声明');
      assertNotOut(fixFamilyPassed, '波次划分与依赖层级不一致');
      // ⑦ 全角 / 半角是同一份错误计划（唯一变量 = 标点）：都 BLOCK 且明细逐条一致。半角侧复用 ② 的
      //    结果，全角侧此前降级成「未校验」放行（分隔符漏收全角逗号）——这一格专锚该退化。
      const fullWidthBlocked = runPlanWithTask(dir, fullWidthSameWavePlan());
      assertExit(fullWidthBlocked, 1);
      assertOut(fullWidthBlocked, '波次划分与依赖层级不一致');
      assertNotOut(fullWidthBlocked, '未校验（无波次段）');
      const halfDetails = waveDetailLines(sameWaveBlocked);
      const fullDetails = waveDetailLines(fullWidthBlocked);
      assertTrue(halfDetails.length > 0, '半角写法的波次明细为空（判据未生效）: ' + sameWaveBlocked.output);
      assertTrue(halfDetails.join('\n') === fullDetails.join('\n'),
        '全角与半角的波次明细不一致（同一计划应同一判定）: 半角=' + JSON.stringify(halfDetails)
        + ' 全角=' + JSON.stringify(fullDetails));
      // ⑧ 段在场而内容不可判（N/A 声明 / 指向不存在的任务 id / 行首强调记号）：新 change BLOCKED——
      //    「判不了」不再等价于放行（未验证 ≠ 通过），且报文与「载体缺席」那一支明确不同。
      const unjudgeablePlanResults = [];
      for (const [label, plan] of [
        ['N/A 声明', naWavePlan()],
        ['指向不存在的任务 id', phantomWavePlan()],
        ['行首强调记号', boldWavePlan()],
      ]) {
        const unjudgeable = runPlanWithTask(dir, plan);
        unjudgeablePlanResults.push(unjudgeable);
        try {
          assertExit(unjudgeable, 1);
          assertOut(unjudgeable, '波次划分段内容不可判');
          // 恢复指引必须指出「N/A 不构成声明」这条真实可照抄的出路（不是只出现「恢复」二字的空句）
          assertOut(unjudgeable, '段正文写 N/A 不构成波次声明');
          assertNotOut(unjudgeable, '未校验（无波次段）');
          assertNotOut(unjudgeable, '波次划分与依赖层级不一致');
        } catch (error) {
          throw new Error(label + '：' + error.message);
        }
      }
      // ⑨ 同波可并行却漏标 [P]（波次判据之后的第二条波次面判据）：同一波次内彼此无依赖路径、
      //    write_files 不重叠的两个任务本可并行——只标一个 parallel="true" 不成立（单边标记既不
      //    表达「可并行」，机器路由也只按串行跑、白丢一波并行度）。新 change BLOCKED 且逐对点名
      //    「哪个任务没标」，并给两条可照抄的出路。
      const gapBlocked = runPlanWithTask(dir, parallelGapPlan());
      assertExit(gapBlocked, 1);
      assertOut(gapBlocked, '同波任务可并行却未标 [P]');
      assertOut(gapBlocked, 'T01 × T02');
      assertOut(gapBlocked, '未标 parallel="true": T02');
      // 两条出路都必须在报文里：① 两个都标 [P]；② 补一条 depends_on 把它们排到不同波次
      assertOut(gapBlocked, '都标 parallel="true"');
      assertOut(gapBlocked, 'depends_on');
      assertOut(gapBlocked, '不同波次');
      // 出路①（唯一变量 = T02 的 parallel 标记）→ 判据沉默（不是「同波即报」）
      const gapAllMarked = runPlanWithTask(dir, parallelGapPlan({ markAll: true }));
      assertExit(gapAllMarked, 0);
      assertNotOut(gapAllMarked, '可并行却未标 [P]');
      // 出路②（补 depends_on 把 T02 排到第 2 波、标记仍是串行）→ 同样通过：两条出路都真能解掉判定
      const gapDependFixed = runPlanWithTask(dir, parallelGapDependPlan());
      assertExit(gapDependFixed, 0);
      assertNotOut(gapDependFixed, '可并行却未标 [P]');
      // 修复族不参与：同波四只修复任务（族前缀两只 + 修复段内两只）都没标 parallel、写面互不重叠，
      // 判据不得报——族边界仍只在 task-graph 的唯一谓词里表达。
      const gapFixFamily = runPlanWithTask(dir, fixPairWavePlan());
      assertExit(gapFixFamily, 0);
      assertNotOut(gapFixFamily, '可并行却未标 [P]');
      // ===== replan 同源（AC-3 · ADR-013 不豁免）：重校段调用同一判定、同一报文 =====
      // 相位夹具 = execute 已 entry、前序完成、taskHash 过期（避开幂等空操作）。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', sameWavePlan());
      writeState(dir, replanExecuteState({ taskHash: REPLAN_STALE_SIGNATURE }));
      const replanBytes = readStateBytes(dir);
      const replanBlocked = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
      assertExit(replanBlocked, 1);
      // 与 plan 出口同一判据同一措辞（同一个报文构造函数）
      assertOut(replanBlocked, '波次划分与依赖层级不一致');
      assertOut(replanBlocked, 'T01');
      assertOut(replanBlocked, '当前波 2');
      assertOut(replanBlocked, '应到波 1');
      // ⑩ 分级 → 输出单源：两处只派生 blocking，报文段逐字相同（各写一份同构分支时，改分级只改
      //    一处就会在另一处静默落后——反向构造：把分级规则只改一处，本节两处对账必红）。
      const planWaveReport = waveReportLines(sameWaveBlocked);
      const replanWaveReport = waveReportLines(replanBlocked);
      assertTrue(planWaveReport.length > 0,
        'plan 出口的波次报文段未取到（恢复行缺失？）: ' + sameWaveBlocked.output);
      assertTrue(planWaveReport.join('\n') === replanWaveReport.join('\n'),
        'plan 出口与 replan 重校的波次报文不逐字相同:\nplan=' + JSON.stringify(planWaveReport)
        + '\nreplan=' + JSON.stringify(replanWaveReport));
      // 拒绝重签：状态零改写，且重签前备份尚未产生（重校全部先于写盘）
      assertStateBytesUnchanged(dir, replanBytes, 'replan 波次投影 BLOCK');
      if (replanBackupFiles(dir).length !== 0) {
        throw new Error('replan 波次投影 BLOCK 路径不得产生重签前备份，实际 ' + replanBackupFiles(dir).length + ' 份');
      }
      // ⑪ 同波漏标 [P] 同样不豁免（ADR-013）：执行期重签不得把「本可并行却没标」的计划换一份发
      //    出去；两处分级与措辞同源（同一构造），故报文段逐字相同。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', parallelGapPlan());
      const replanGap = runStateWithProtocol(dir, ['replan', '同波漏标的计划重校', '--authorized-by', 'user-approval']);
      assertExit(replanGap, 1);
      assertOut(replanGap, '同波任务可并行却未标 [P]');
      assertOut(replanGap, 'T01 × T02');
      const planGapReport = waveGapReportLines(gapBlocked);
      const replanGapReport = waveGapReportLines(replanGap);
      assertTrue(planGapReport.length > 0, 'plan 出口的同波漏标报文未取到: ' + gapBlocked.output);
      assertTrue(planGapReport.join('\n') === replanGapReport.join('\n'),
        '同波漏标两支的措辞不逐字相同:\nplan=' + JSON.stringify(planGapReport)
        + '\nreplan=' + JSON.stringify(replanGapReport));
      assertStateBytesUnchanged(dir, replanBytes, 'replan 同波漏标 BLOCK');
      // 未声明任务同样不豁免（ADR-013：改散文绕不过判据）：重校段必须点名未被波次覆盖的任务。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', undeclaredWavePlan());
      const replanUndeclared = runStateWithProtocol(dir, ['replan', '未声明任务的计划重校', '--authorized-by', 'user-approval']);
      assertExit(replanUndeclared, 1);
      assertOut(replanUndeclared, '波次划分与依赖层级不一致');
      assertOut(replanUndeclared, 'T02（依赖: T01）当前波 未声明 → 应到波 2');
      assertStateBytesUnchanged(dir, replanBytes, 'replan 未声明任务 BLOCK');
      // ⑪ 内容不可判那一支同样两处逐字相同（同一构造函数的第二条分级路径，只换分级前缀）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', naWavePlan());
      const replanUnjudgeable = runStateWithProtocol(dir, ['replan', '内容不可判的计划重校', '--authorized-by', 'user-approval']);
      assertExit(replanUnjudgeable, 1);
      assertOut(replanUnjudgeable, '波次划分段内容不可判');
      const planUnjudgeableReport = waveUnjudgeableLines(unjudgeablePlanResults[0]);
      const replanUnjudgeableReport = waveUnjudgeableLines(replanUnjudgeable);
      assertTrue(planUnjudgeableReport.length > 0, 'plan 出口的内容不可判报文未取到: ' + unjudgeablePlanResults[0].output);
      assertTrue(planUnjudgeableReport.join('\n') === replanUnjudgeableReport.join('\n'),
        '内容不可判两支的措辞不逐字相同:\nplan=' + JSON.stringify(planUnjudgeableReport)
        + '\nreplan=' + JSON.stringify(replanUnjudgeableReport));
      assertStateBytesUnchanged(dir, replanBytes, 'replan 内容不可判 BLOCK');
      // 改到一致后重签成功（判据不阻断合规计划）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixedWavePlan());
      const replanFixed = runStateWithProtocol(dir, ['replan', '按波次投影修正后重校', '--authorized-by', 'user-approval']);
      assertExit(replanFixed, 0);
      assertOut(replanFixed, 'REPLAN: execute');
      // ⑪b 前置同源（P2b）：执行期**删掉承载段**（## 波次划分）再改任务集 —— 重校段不得走「未校验」
      //    放行口。TASK.md 的段形由模板权威裁定，plan 出口已经用同一份骨架门拦过缺段，重校段不豁免：
      //    新 change BLOCKED，state 字节零改写、零新增备份（判据全部先于备份与写盘）。
      //    模板在场才判段形：模板缺席是「未校验（模板缺失）」的另一支边界（与 plan 出口同一口径），
      //    故本块显式写出 TASK 模板，让「删段」成为唯一的变量。
      writeFile(dir, 'flow-kit/templates/TASK.md',
        '# TASK: <change 标题>\n\n## 波次划分\n\n## 任务清单\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 任务清单\n\n' + waveTask('T01'));
      const noWaveSectionBytes = readStateBytes(dir);
      const backupsBeforeNoWave = replanBackupFiles(dir).length;
      const replanNoWaveSection = runStateWithProtocol(dir, ['replan', '删段 + 改任务集的重校', '--authorized-by', 'user-approval']);
      assertExit(replanNoWaveSection, 1);
      assertOut(replanNoWaveSection, 'BLOCKED: TASK.md 模板结构校验失败');
      assertOut(replanNoWaveSection, '波次划分');
      assertOut(replanNoWaveSection, '（模板: flow-kit/templates/TASK.md）');
      assertOut(replanNoWaveSection, '重试 replan');
      assertNotOut(replanNoWaveSection, 'REPLAN:');
      assertStateBytesUnchanged(dir, noWaveSectionBytes, 'replan 承载段缺席 BLOCK');
      assertTrue(replanBackupFiles(dir).length === backupsBeforeNoWave,
        '承载段缺席 BLOCK 不得新增重签前备份: ' + JSON.stringify(replanBackupFiles(dir)));
      // 同一份删段任务集（无任何新旧标记字段）→ 同判 BLOCKED（单轨：replan 不做校验豁免）
      const oldNoWaveState = replanExecuteState({ taskHash: REPLAN_STALE_SIGNATURE });
      writeState(dir, oldNoWaveState);
      const backupsBeforeOldWarn = replanBackupFiles(dir).length;
      const replanNoWaveOld = runStateWithProtocol(dir, ['replan', '删段 + 改任务集的重校（旧 change）', '--authorized-by', 'user-approval']);
      assertExit(replanNoWaveOld, 1);
      assertOut(replanNoWaveOld, 'BLOCKED: TASK.md 模板结构校验失败');
      assertOut(replanNoWaveOld, '波次划分');
      assertTrue(replanBackupFiles(dir).length === backupsBeforeOldWarn,
        'BLOCK 不得产生重签前备份: ' + JSON.stringify(replanBackupFiles(dir)));
      // 两处措辞同源（plan 出口 / 重校段）：同一份 TASK.md（模板在场、承载段缺席）必须给出**逐字相同**
      // 的失败行——骨架取模板权威、片段取 guard-template-fidelity 的同一格式器、两阶段口径不变
      // （escalate=false：首次只给类别计数）。现场适配只落在恢复行：replan 在那里点名缺的段（重校段
      // 没有提示账本可「再犯升级」）、并把重试目标换成本命令。
      // 反向构造：任一处自建段名清单或自拼措辞，这两行就不再相等。
      const taskStructureLine = (res) => (res.output.match(/TASK\.md 模板结构校验失败[^\n]*/u) ?? [''])[0];
      assertTrue(taskStructureLine(replanNoWaveSection).includes('缺段 1 项'),
        'replan 的 TASK 段形失败行应报类别计数（与 plan 出口同一两阶段口径）:\n' + replanNoWaveSection.output);
      const planNoWaveState = baseState('plan');
      planNoWaveState.evidence.plan = { summary: 'plan done' };
      writeState(dir, planNoWaveState);
      const planNoWaveSection = runPlanWithTask(dir, '# TASK\n\n## 任务清单\n\n' + waveTask('T01'));
      assertExit(planNoWaveSection, 1);
      assertTrue(taskStructureLine(planNoWaveSection) === taskStructureLine(replanNoWaveSection),
        'plan 出口与 replan 的 TASK 段形失败行不逐字相同:\nplan='
        + JSON.stringify(taskStructureLine(planNoWaveSection)) + '\nreplan='
        + JSON.stringify(taskStructureLine(replanNoWaveSection)));
      assertOut(planNoWaveSection, '（模板: flow-kit/templates/TASK.md）');
      // 反向构造（唯一变量 = 承载段是否在场）：补回 ## 波次划分 后同一通道照常重签
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', honestWavePlan());
      writeState(dir, replanExecuteState({ taskHash: REPLAN_STALE_SIGNATURE }));
      const replanWithWaveSection = runStateWithProtocol(dir, ['replan', '补回承载段后的重校', '--authorized-by', 'user-approval']);
      assertExit(replanWithWaveSection, 0);
      assertOut(replanWithWaveSection, 'REPLAN: execute');
      fs.rmSync(path.join(dir, 'flow-kit', 'templates', 'TASK.md'), { force: true });

      // ===== ⑫ 「判不了」形态统一 + 分级→输出单源（两条判据共用一处契约）=====
      // ① 源码契约锁：两条结构判据的「判不了」载荷键同形（载体缺席 { reason, notice } / 内容不可判
      //    { reason, explanation, recovery }），旧的「judgeable + reason 混装」形态在判据与两个调用方
      //    身上零残留——形态只在源码里表达，靠注释互指同源不算同步机制。
      const judgeTexts = engineScriptTexts();
      const judgeCode = (rel) => engineCodeText(judgeTexts.get(rel) ?? '');
      for (const rel of ['lib/wave-projection.mjs', 'lib/ac-coverage.mjs']) {
        const code = judgeCode(rel);
        const missingKeys = ['unverified:', 'unjudgeable:', 'notice', 'explanation', 'recovery']
          .filter((token) => !code.includes(token));
        assertTrue(missingKeys.length === 0,
          rel + ' 缺「判不了」载荷键（形态应与另一条判据同形）: ' + missingKeys.join('、'));
      }
      for (const rel of ['lib/wave-projection.mjs', 'lib/ac-coverage.mjs', 'lib/guard-gates.mjs', 'lib/state-commands-recovery.mjs']) {
        assertTrue(!/\bjudgeable\b/u.test(judgeCode(rel)),
          rel + ' 仍在使用旧形态字段 judgeable（「判不了」只许一种形态）');
      }
      // ② 分级 → 输出单源：两个波次调用方只派生 blocking 并经 waveReviewOutcome 分派，不再各自
      //    构造波次报文（两处各写一份同构分支，改分级只改一处就会在另一处静默落后）。
      for (const rel of ['lib/guard-gates.mjs', 'lib/state-commands-recovery.mjs']) {
        const code = judgeCode(rel);
        for (const entry of ['waveReviewOutcome', 'parallelGapOutcome']) {
          assertTrue(code.includes(entry), rel + ' 未经由 ' + entry + ' 分派（分级→输出应单源）');
        }
        for (const retired of ['waveProjectionReportLines', 'waveContentUnjudgeableLine', 'WAVE_UNCHECKED_NOTICE']) {
          assertTrue(!code.includes(retired),
            rel + ' 仍直接消费报文构造函数 ' + retired + '（应统一经 waveReviewOutcome）');
        }
      }
      // ③ 运行期形态对账：两条判据各自产出一条「内容不可判」结果，字段与载荷键必须完全同形
      //    （波次侧 = 段在场而读不出声明；AC 侧 = `REQUIREMENT.md` 缺席——「删掉承载文件」按内容
      //    不可判处置，删除因此不是跳过口，两侧这一支吃的是同一份工件；载荷键由 ① 的源码契约锁住）。
      const waveModule = await import(pathToFileURL(path.join(SCRIPTS_DIR, 'lib', 'wave-projection.mjs')).href);
      const acModule = await import(pathToFileURL(path.join(SCRIPTS_DIR, 'lib', 'ac-coverage.mjs')).href);
      const judgeShape = (outcome) => JSON.stringify({
        fields: ['unverified', 'unjudgeable'].filter((field) => field in outcome),
        unverified: outcome.unverified === null ? null : Object.keys(outcome.unverified).sort(),
        unjudgeable: outcome.unjudgeable === null ? null : Object.keys(outcome.unjudgeable).sort(),
      });
      const waveCarrier = waveModule.waveProjectionReview({ taskContent: '# TASK\n\n## 任务清单\n\n' + waveTask('T01') });
      const waveContent = waveModule.waveProjectionReview({ taskContent: naWavePlan() });
      const acContent = await acModule.acCoverageReview(path.join(dir, '.specs', CHANGE_ID));
      assertTrue(judgeShape(waveContent) === judgeShape(acContent),
        '波次判据与 AC 覆盖的「内容不可判」形态不一致: 波次=' + judgeShape(waveContent) + ' AC=' + judgeShape(acContent));
      assertTrue(waveContent.unverified === null && waveContent.unjudgeable !== null,
        '内容不可判应只填 unjudgeable（另一支必须为空）: ' + judgeShape(waveContent));
      assertTrue(JSON.stringify(Object.keys(waveContent.unjudgeable).sort())
        === JSON.stringify(['explanation', 'reason', 'recovery']),
        '内容不可判的载荷键应与 AC 覆盖同形（reason / explanation / recovery）: '
        + JSON.stringify(Object.keys(waveContent.unjudgeable)));
      // ④ 「未校验」那一支的载荷键按 AC 侧判——断言的是键集合本身，不是形状说明。这一支的成因只有
      //    「模板缺席」，而模板根在进程启动时就绑定到运行上下文（`FLOW_COMET_RUN_ROOT` / cwd）：
      //    本套件进程的根里模板是在场的，所以进程内造不出「模板缺席」。夹具给一份**没有
      //    `flow-kit/templates`** 的项目根，子进程以它为运行上下文叫同一个判定，把载荷原样交回来
      //    （子进程而不是 chdir：运行上下文是模块加载时算出来的常量，改不动也改不干净）。
      //    载体文件仍在场——AC 侧的「未校验」要求先过「载体在不在」这一关，缺文件是内容不可判。
      const noTemplateRoot = makeTmp();
      writeFile(noTemplateRoot, '.specs/' + CHANGE_ID + '/REQUIREMENT.md',
        '# REQUIREMENT\n\n## 验收准则（AC）\n\n- AC-1 模板缺席时仍在场上的载体\n');
      const acCarrierRun = spawnSync(process.execPath, [
        '--input-type=module', '--eval',
        'const m = await import(' + JSON.stringify(
          pathToFileURL(path.join(SCRIPTS_DIR, 'lib', 'ac-coverage.mjs')).href) + ');'
          + 'process.stdout.write(JSON.stringify(await m.acCoverageReview(process.argv[1])));',
        '--', path.join(noTemplateRoot, '.specs', CHANGE_ID),
      ], { cwd: noTemplateRoot, env: { ...process.env, FLOW_COMET_RUN_ROOT: noTemplateRoot }, encoding: 'utf8' });
      assertTrue(acCarrierRun.status === 0,
        '「无模板的项目根」夹具子进程异常: '
        + String(acCarrierRun.stdout ?? '') + String(acCarrierRun.stderr ?? ''));
      const acCarrier = JSON.parse(String(acCarrierRun.stdout));
      const acCarrierKeys = acCarrier.unverified === null
        ? 'null'
        : JSON.stringify(Object.keys(acCarrier.unverified).sort());
      assertTrue(acCarrierKeys === JSON.stringify(['notice', 'reason']),
        'AC 覆盖「模板缺席」的载荷键应为 { notice, reason }: ' + acCarrierKeys);
      // 两侧同形：波次侧由「段缺席」进「未校验」，AC 侧由「模板缺席」进同一支——载荷键任一侧漂移，
      // verify 出口读 notice 的两个入口就只剩一个能读（只钉一侧等于只守一半）。
      assertTrue(judgeShape(waveCarrier) === judgeShape(acCarrier),
        '波次判据与 AC 覆盖的「未校验」形态不一致: 波次=' + judgeShape(waveCarrier) + ' AC=' + judgeShape(acCarrier));

      // ===== ⑬ 段体切片的围栏语义（五处消费共用 lib/section-body.mjs 的同一实现）=====
      // 段体里的围栏代码块是正文示例：围栏内的 `## ` 不结束段体。修复前波次段的段界是一条「遇 `## `
      // 即收」的惰性正则——段内贴一段 Markdown 示例后，示例之后声明的 Wave 行整段消失，判据把
      // 「声明了」读成「没声明」（段在场而内容不可判 ⇒ 新 change BLOCKED，且永远补不上）。
      const waveSectionWith = (body) => '# TASK\n\n## 波次划分\n\n' + body
        + '\n\n## 任务清单\n\n' + waveTask('T01');
      // 本块独立于前面的 replan 段：重校成功重签后 currentNode 已在 execute，先归位到 plan 再跑出口
      // （否则 exit plan 直接报节点漂移，测不到段体判据）。
      const planWithSection = (markdown) => {
        const planState = baseState('plan');
        planState.evidence.plan = { summary: 'plan done' };
        writeState(dir, planState);
        return runPlanWithTask(dir, markdown);
      };
      // ① 围栏内的二级标题不结束段体：Wave 行在围栏之后，判据仍读到它
      const fencedWave = planWithSection(waveSectionWith('```md\n## 代码块里的示例段标题\n```\n\nWave 1: T01'));
      assertExit(fencedWave, 0);
      assertOut(fencedWave, 'ALL CHECKS PASSED');
      assertNotOut(fencedWave, '波次划分段内容不可判');
      assertNotOut(fencedWave, '未校验（无波次段）');   // 判据真在场：不是靠「跳过」变绿
      // ② 围栏外的同级标题照常结束段体：Wave 行落在段外 ⇒ 段在场而无可判声明
      const closedByHeading = planWithSection(
        waveSectionWith('```md\n示例\n```\n\n## 代码块外的段标题\n\nWave 1: T01'));
      assertExit(closedByHeading, 1);
      assertOut(closedByHeading, '波次划分段内容不可判');
      // ③ 分隔线语义保持：围栏外的 `---` 同样结束段体
      const closedByRule = planWithSection(waveSectionWith('---\n\nWave 1: T01'));
      assertExit(closedByRule, 1);
      assertOut(closedByRule, '波次划分段内容不可判');
      // ④ 修复段的段界同源：修复段里的围栏代码块（块内含 `## `）不结束修复段，段内任务仍判为修复族
      //    （族判定经 task-graph 的唯一谓词——段定位不再由各消费方各写一份行扫描）。
      const fixModule = await import(pathToFileURL(path.join(SCRIPTS_DIR, 'lib', 'task-graph.mjs')).href);
      const fixBlock = '<task id="R02" status="pending"><action>回修段内形态</action>'
        + '<write_files>src/r02.mjs</write_files><verify>node --check src/r02.mjs</verify>'
        + '<depends_on></depends_on></task>';
      const fixSectionWith = (body) => '# TASK\n\n## 任务清单\n\n' + waveTask('T01')
        + '\n## Fix 任务（来自 REVIEW / INTEGRATION）\n\n' + body;
      const inFixFenced = fixModule.fixTaskClassifier(
        fixSectionWith('```md\n## 代码块里的示例段标题\n```\n\n' + fixBlock), 'Fix 任务');
      assertTrue(inFixFenced(fixBlock) === true,
        '修复段里的围栏代码块截断了段体：围栏之后的修复任务不再被判为修复族（段界只应由围栏外的标题决定）');
      // ⑤ 围栏外的同级标题照常结束修复段：任务落到段外 ⇒ 不属修复族
      const inFixAfterHeading = fixModule.fixTaskClassifier(
        '# TASK\n\n## Fix 任务\n\n```md\n示例\n```\n\n## 任务清单\n\n' + fixBlock, 'Fix 任务');
      assertTrue(inFixAfterHeading(fixBlock) === false,
        '围栏外的同级标题应结束修复段：其后段落里的任务不属修复族');
      // ⑥ 分隔线语义保持：修复段不以 `---` 结束（既有语义）
      const inFixAfterRule = fixModule.fixTaskClassifier(
        '# TASK\n\n## Fix 任务\n\n---\n\n' + fixBlock, 'Fix 任务');
      assertTrue(inFixAfterRule(fixBlock) === true, '`---` 不应结束修复段（既有语义）');

      // ===== ⑭ 段标题的写法不是判定变量（波次段与 TASK 段形门同一口径）=====
      // 波次段的段名曾是行首精确正则，而 TASK 段形门走标题归一：同一份计划换个标题写法，判据就退化成
      // 「未校验（无波次段）」放行——一次排版即可绕过「未验证 ≠ 通过」。合法写法因此必须给出同一判定与
      // 同一明细；围栏代码块里的示例标题是正文，不得被读成段。
      // `## ## 波次划分` 这一格钉住「两处归一必须真的同源」的接缝：它的标题**正文本身**以井号开头——
      // 段形门先剥前导井号再归一（认作在场），波次门若拿原始行做正则就会判缺席并跳过，于是同一份工件的
      // 同一段在两处得到相反答案，新 change 仍 exit 0。判定必须过同一 normalizeHeading 再比。
      writeFile(dir, 'flow-kit/templates/TASK.md',
        '# TASK: <change 标题>\n\n## 波次划分\n\n## 任务清单\n');
      const headingFormPlan = (heading) => '# TASK\n\n' + heading
        + '\n\nWave 2 (parallel): T01[P], T02   (T02 on T01)\n\n## 任务清单\n\n'
        + waveTask('T01') + waveTask('T02', 'T01');
      const waveHeadingForms = [
        '## 波次划分',
        '## 波次划分（依赖层级）',
        '## 3. 波次划分',
        '## 波次划分 ##',
        '## ## 波次划分',
      ];
      const headingFormResults = waveHeadingForms.map((heading) => planWithSection(headingFormPlan(heading)));
      const headingFormReports = headingFormResults.map((res) => waveReportLines(res));
      for (const [index, heading] of waveHeadingForms.entries()) {
        assertExit(headingFormResults[index], 1);
        assertNotOut(headingFormResults[index], '未校验（无波次段）');
        assertTrue(headingFormReports[index].length > 0,
          '段标题写法「' + heading + '」下波次判据没有给出明细（判据被排版关掉，配套的段形门也认这组写法）: '
            + headingFormResults[index].output);
      }
      for (const [index, report] of headingFormReports.entries()) {
        assertTrue(report.join('\n') === headingFormReports[0].join('\n'),
          '段标题写法改变了波次判定（' + waveHeadingForms[index] + '）——写法是排版，不是判定变量:\n'
            + JSON.stringify(report) + '\n基准=' + JSON.stringify(headingFormReports[0]));
      }
      fs.rmSync(path.join(dir, 'flow-kit', 'templates', 'TASK.md'), { force: true });
      // 围栏代码块里的示例标题是正文：唯一一处「波次划分」落在围栏里时，判据没有可判对象（打印未校验、
      // 不据此阻断），但不得被读成「段在场而内容不可判」——那是另一支判定，会把只有示例的工件判错。
      const fencedHeadingOnly = planWithSection('# TASK\n\n```md\n## 波次划分\n\nWave 2: T01, T02\n```\n\n'
        + '## 任务清单\n\n' + waveTask('T01') + waveTask('T02', 'T01'));
      assertExit(fencedHeadingOnly, 0);
      assertOut(fencedHeadingOnly, '未校验（无波次段）');
      assertNotOut(fencedHeadingOnly, '波次划分段内容不可判');

      // ===== ⑮ 闭合 ATX 标题（`## 标题 ##`）不改变「段是否在场」（AC 覆盖与 1.1 矩阵同口径）=====
      // 闭合 ATX 是合法 Markdown；段名判据若只认开放写法，合法工件会被读成「段缺席」——AC 覆盖因此报
      // 「判据无法执行」并拦下新 change。围栏代码块里的示例标题仍是正文，不得被读成段。
      const atxRoot = makeTmp();
      writeFile(atxRoot, 'flow-kit/templates/REQUIREMENT.md',
        '# REQUIREMENT 模板\n\n## 用户故事\n## 验收准则（AC）\n');
      writeFile(atxRoot, 'flow-kit/templates/TEST.md', '# TEST 模板\n\n## 第 1 轮 · 功能测试\n');
      const runCoverageIn = (root) => {
        const changeDir = path.join(root, '.specs', CHANGE_ID);
        const proc = spawnSync(process.execPath, [
          '--input-type=module', '--eval',
          'const m = await import(' + JSON.stringify(
            pathToFileURL(path.join(SCRIPTS_DIR, 'lib', 'ac-coverage.mjs')).href) + ');'
            + 'process.stdout.write(JSON.stringify(await m.acCoverageReview(process.argv[1])));',
          '--', changeDir,
        ], { cwd: root, env: { ...process.env, FLOW_COMET_RUN_ROOT: root }, encoding: 'utf8' });
        assertTrue(proc.status === 0, 'AC 覆盖夹具子进程异常: '
          + String(proc.stdout ?? '') + String(proc.stderr ?? ''));
        return JSON.parse(String(proc.stdout));
      };
      writeFile(atxRoot, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', [
        '# REQUIREMENT: 闭合 ATX 夹具',
        '',
        '## 验收准则（AC） ##',
        '',
        '### AC-1 · 夹具准则',
        '',
        '- **Given** 夹具前置',
        '',
        '### AC-2 · 夹具准则',
        '',
        '- **Given** 夹具前置',
        '',
      ].join('\n'));
      writeFile(atxRoot, '.specs/' + CHANGE_ID + '/TEST.md', [
        '# TEST: 闭合 ATX 夹具',
        '',
        '## 第 1 轮 · 功能测试 ##',
        '',
        '### 1.1 测试矩阵（AC → 用例） ##',
        '',
        '| AC | 类型 | 用例文件 / UAT | 状态 |',
        '|---|---|---|---|',
        '| AC-1 | unit | guard-self-test.mjs | ✅ |',
        '| AC-2 | unit | guard-self-test.mjs | ✅ |',
        '',
      ].join('\n'));
      const closedAtxCoverage = runCoverageIn(atxRoot);
      assertTrue(closedAtxCoverage.unverified === null && closedAtxCoverage.unjudgeable === null,
        '闭合 ATX 标题被读成「段缺席」（判据无法执行）: ' + JSON.stringify(closedAtxCoverage));
      assertTrue(closedAtxCoverage.missing.length === 0,
        '闭合 ATX 写法的 1.1 矩阵未被读成覆盖（缺: ' + JSON.stringify(closedAtxCoverage.missing) + '）');
      // 围栏里的示例标题仍是正文：只有示例、没有真段时判「承载段不在」，而不是「段在场」。
      writeFile(atxRoot, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', [
        '# REQUIREMENT: 围栏示例夹具',
        '',
        '```md',
        '## 验收准则（AC）',
        '',
        '### AC-1 · 示例',
        '```',
        '',
      ].join('\n'));
      const fencedSectionCoverage = runCoverageIn(atxRoot);
      assertTrue(fencedSectionCoverage.unjudgeable !== null
        && fencedSectionCoverage.unjudgeable.reason === 'REQUIREMENT 无验收准则段',
        '围栏代码块里的示例标题被读成了段（示例是正文，不是段）: ' + JSON.stringify(fencedSectionCoverage));
      // ⑯ 标题**正文本身**以井号开头（`## ## 验收准则（AC）`）：段形门先剥前导井号再归一（认在场），
      //    段定位若拿原始行做正则，第二个井号被读成段名的一部分 → 判「无验收准则段」——同一份工件的
      //    同一段在两处得到相反答案（假红，恢复句还指向「补段」）。两侧过同一套归一后，这一形态必须与
      //    普通写法给出同一判定：编号正常取到、矩阵照常对上。1.1 矩阵是三级标题，同一形态照此推到三级。
      writeFile(atxRoot, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', [
        '# REQUIREMENT: 井号开头夹具',
        '',
        '## ## 验收准则（AC）',
        '',
        '### AC-1 · 夹具准则',
        '',
        '- **Given** 夹具前置',
        '',
        '### AC-2 · 夹具准则',
        '',
        '- **Given** 夹具前置',
        '',
      ].join('\n'));
      writeFile(atxRoot, '.specs/' + CHANGE_ID + '/TEST.md', [
        '# TEST: 井号开头夹具',
        '',
        '## ## 第 1 轮 · 功能测试',
        '',
        '### ## 1.1 测试矩阵（AC → 用例）',
        '',
        '| AC | 类型 | 用例文件 / UAT | 状态 |',
        '|---|---|---|---|',
        '| AC-1 | unit | guard-self-test.mjs | ✅ |',
        '| AC-2 | unit | guard-self-test.mjs | ✅ |',
        '',
      ].join('\n'));
      const hashedHeadingCoverage = runCoverageIn(atxRoot);
      assertTrue(hashedHeadingCoverage.unverified === null && hashedHeadingCoverage.unjudgeable === null,
        '标题正文以井号开头被读成「段缺席」（段形门认在场，判据走同一套归一后不应分叉）: '
          + JSON.stringify(hashedHeadingCoverage));
      assertTrue(hashedHeadingCoverage.missing.length === 0,
        '井号开头写法的 1.1 矩阵未被读成覆盖（缺: ' + JSON.stringify(hashedHeadingCoverage.missing) + '）');
      // ⑰ 段名仍以模板为准：TEST 模板声明的承载段是「第 1 轮 · 功能测试」，工件标题换成模板没写过的
      //    「第 1 轮：功能测试」时不得被回退名清单悄悄接住——回退只在**模板段名不含关键词**时生效，
      //    否则「模板说缺段、判据说在场」会把判定放宽（假绿）。段形门对这一份工件同样报缺段。
      writeFile(atxRoot, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', [
        '# REQUIREMENT: 段名漂移夹具',
        '',
        '## 验收准则（AC）',
        '',
        '### AC-1 · 夹具准则',
        '',
        '- **Given** 夹具前置',
        '',
      ].join('\n'));
      writeFile(atxRoot, '.specs/' + CHANGE_ID + '/TEST.md', [
        '# TEST: 段名漂移夹具',
        '',
        '## 第 1 轮：功能测试',
        '',
        '### 1.1 测试矩阵（AC → 用例）',
        '',
        '| AC | 类型 | 用例文件 / UAT | 状态 |',
        '|---|---|---|---|',
        '| AC-1 | unit | guard-self-test.mjs | ✅ |',
        '',
      ].join('\n'));
      const driftedRound = runCoverageIn(atxRoot);
      assertTrue(driftedRound.unjudgeable !== null
        && driftedRound.unjudgeable.reason === 'TEST.md 无第 1 轮段',
        '模板没声明的段标题被回退名清单接住（段名不再由模板派生，判定被放宽）: ' + JSON.stringify(driftedRound));
    },
  },

  // 146（多趟语义重写）：新 change + P01 依赖不存在的 T99 → exit plan 应 BLOCKED，
  // 输出含恢复指引（depends_on 调整）。旧引擎静默放行 = 预期 RED。
  {
    name: '146 plan exit BLOCKED：新 change 并行任务依赖不存在的任务（含恢复指引）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_MISSING_DEP);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'depends_on');
      assertOut(res, 'T99');
    },
  },

  // 147（混排合法锚）：新 change + 串→并→串 → 放行（串行任务位置不再受限，依赖图无环即合法）
  {
    name: '147 plan exit 通过：混排合法锚——串→并→串',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_MIXED_SPS);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 148（混排合法锚）：新 change + 并→串→并 → 放行
  {
    name: '148 plan exit 通过：混排合法锚——并→串→并',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_MIXED_PSP);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 149（混排合法锚）：新 change + 多波混合（≥2 个并行块被串行分隔）→ 放行
  {
    name: '149 plan exit 通过：混排合法锚——多波混合（两并行块被串行分隔）+ 波次投影诚实计划通过 / 无波次段显式未校验',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      const res = runPlanExit(dir, renderMultiWaveTasks());
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      // ⑥ 无波次段：判据不可判 ⇒ 显式「未校验」且其余判据照常（不是静默通过）——本夹具的
      //    TASK.md 就没有波次段，故这一行必须出现，且出口仍然通过。
      assertOut(res, '未校验（无波次段）');
      // ① 诚实计划（同波任务彼此无依赖、每波 = 依赖层级）⇒ 判据在场但不产生任何输出
      //    （「未校验」缺席证明它真的判过，而不是又跳过了）。
      const honestPlan = runPlanWithTask(dir, honestWavePlan());
      assertExit(honestPlan, 0);
      assertOut(honestPlan, 'ALL CHECKS PASSED');
      assertNotOut(honestPlan, '未校验（无波次段）');
      assertNotOut(honestPlan, '波次划分与依赖层级不一致');
    },
  },

  // 150（兼容锚保留）：新 change + 全并行（单连续块仍是合法特例）→ 放行
  {
    name: '150 plan exit 通过：全并行单连续块（合法特例）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_VALID_ALL_PARALLEL);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 151（单轨对照）：与 145 同一批夹具在**无任何新旧标记字段**的状态下同判——依赖图/波次投影/
  // 同波漏标一律 BLOCKED（不再有「旧 change 渐进 WARN」这一侧）；载体缺席仍只「未校验」。
  {
    name: '151 plan exit 单轨对照：依赖环/波次投影/同波漏标一律 BLOCKED（无字段状态同判）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_DEP_CYCLE);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '依赖环');
      // ⑤ 同一输入（② 的同波依赖夹具）：判据同源、明细同一措辞，判级同判 BLOCKED
      const oldWaveWarn = runPlanWithTask(dir, sameWavePlan());
      assertExit(oldWaveWarn, 1);
      assertOut(oldWaveWarn, 'BLOCKED');
      assertOut(oldWaveWarn, '波次划分与依赖层级不一致');
      assertOut(oldWaveWarn, 'T01');
      assertOut(oldWaveWarn, '应到波 1');
      // ⑥ 未声明任务：同一明细、同一措辞（当前波 = 未声明），判级同判 BLOCKED
      const oldUndeclared = runPlanWithTask(dir, undeclaredWavePlan());
      assertExit(oldUndeclared, 1);
      assertOut(oldUndeclared, 'BLOCKED');
      assertOut(oldUndeclared, '未声明');
      assertOut(oldUndeclared, 'T02（依赖: T01）当前波 未声明 → 应到波 2');
      assertOut(oldUndeclared, '应到波 3');
      // ⑦ 段在场而内容不可判（N/A 正文）：内容不可判 = BLOCKED（与载体缺席的「未校验」二分不变）
      const oldUnjudgeable = runPlanWithTask(dir, naWavePlan());
      assertExit(oldUnjudgeable, 1);
      assertOut(oldUnjudgeable, 'BLOCKED');
      assertOut(oldUnjudgeable, '波次划分段内容不可判');
      // 载体缺席只「未校验」并放行（同一任务集、唯一变量 = 波次段是否在场）
      const noSectionSameTasks = runPlanWithTask(dir, '# TASK\n\n## 任务清单\n\n'
        + waveTask('T01') + waveTask('T02', 'T01'));
      assertExit(noSectionSameTasks, 0);
      assertOut(noSectionSameTasks, '未校验（无波次段）');
      // ⑧ 同波可并行却漏标 [P]：同判 BLOCKED；补上标记后放行
      const oldGap = runPlanWithTask(dir, parallelGapPlan());
      assertExit(oldGap, 1);
      assertOut(oldGap, 'BLOCKED');
      assertOut(oldGap, '同波任务可并行却未标 [P]');
      assertOut(oldGap, 'T01 × T02');
      const oldGapFixed = runPlanWithTask(dir, parallelGapPlan({ markAll: true }));
      assertExit(oldGapFixed, 0);
      assertNotOut(oldGapFixed, '可并行却未标 [P]');
      // ⑨ 补集等价：本判据的「写面不重叠」= task-graph 的 collectCrossTaskConflicts（写面重叠的唯一
      //    入口，其实现就是 collectPathOverlaps + 已归一路径 + glob）返回集合的**补集**。夹具构造反面：
      //    同波同层、都没标 parallel，但写同一个文件 → 写冲突族照常报，本判据必须沉默（否则同一对上
      //    两条报文自相矛盾）。反向构造：抽掉该入口（M4）→ 这里同时冒出「可并行却未标 [P]」→ 判红。
      const oldOverlap = runPlanWithTask(dir, overlapPairWavePlan());
      // 单轨：同文件跨任务且无依赖路径 → BLOCKED（写冲突族照常报）
      assertExit(oldOverlap, 1);
      assertOut(oldOverlap, 'BLOCKED');
      assertOut(oldOverlap, '同文件跨任务且无依赖路径');
      assertTrue(!oldOverlap.output.includes('可并行却未标 [P]'),
        '补集等价被破坏：写面重叠（collectCrossTaskConflicts 判为冲突）的一对不得被要求标 [P]（'
        + oldOverlap.output + '）');
    },
  },

  // ----------  场景（契约解析失败检测——record / workflow-handoff result——T01 新增：疑似对象解析失败 fail-closed） ----------

  // 152: record 收到形似对象字面量（{ 开头 / 含 : 或 [）但 JSON.parse 失败的 payload → 应报错含
  // --json-file 提示且不写 evidence。当前实现把不可解析 raw 静默作 summary 字符串落库 = 预期 RED（静默落脏）
  {
    name: '152 record 疑似对象解析失败 → 报错含 --json-file 且不写 evidence',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      // 形似对象字面量但未闭合（PowerShell 剥离内嵌引号后常见的损坏 JSON 形态）
      const bad = '{summary: "intake", completedChecks: ["unit-tests"]';
      const res = runStateWithProtocol(dir, ['record', 'open', bad]);
      assertExit(res, 1);
      assertOut(res, '--json-file');
      // fail-closed：state 文件须保持原样（evidence.open 未被脏字符串污染）
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st2.evidence.open || st2.evidence.open.summary !== 'intake complete') {
        throw new Error('record 解析失败后仍写入了 evidence（应 fail-closed 不落库）: ' + JSON.stringify(st2.evidence.open));
      }
    },
  },

  // 153: workflow-handoff result 收到形似对象但 JSON.parse 失败的 payload → 应报错含 --json-file
  // 且不写 handoffResult。当前实现把不可解析 raw 静默作字符串存入 handoffResult = 预期 RED（静默落脏）
  {
    name: '153 handoff result 疑似对象解析失败 → 报错含 --json-file 且不写 handoffResult',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = { handoffRequest: { T01: { taskId: 'T01' } } };
      writeState(dir, st);
      // 形似对象字面量但未闭合（损坏的 Return Contract JSON）
      const bad = '{"commitHash": "abcd1234", "completedChecks": ["required-skill:';
      const res = runHandoff(['result', 'T01', bad], dir);
      assertExit(res, 1);
      assertOut(res, '--json-file');
      // fail-closed：handoffResult 不得写入
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const hr = st2.evidence && st2.evidence['subagent-execute'] && st2.evidence['subagent-execute'].handoffResult;
      if (hr && hr.T01) {
        throw new Error('handoff result 解析失败后仍写入了 handoffResult（应 fail-closed 不落库）: ' + JSON.stringify(hr.T01));
      }
    },
  },
  // 154: 单一来源静态锁（设计语义 / AC-1 + F-3 / AC-5）——① `looksLikeObjectLiteral` 只许有一处
  // 实现（单源模块由导出符号反查），state/handoff 侧（含拆分后的 `lib/`）一律具名取用、不得自带
  // 第二份定义（单一来源 fail-closed）；② F-3：消费 `EXECUTE_FAMILY_NODE_IDS` 的脚本（消费面 =
  // 入口 ∪ `lib/**`，由真实引用派生）均须从单源取用，且源码中不得再出现 execute 家族成员内联 pair
  //（<ident> === 'execute' || <ident> === 'subagent-execute'，正反顺序）→ 0 命中。
  // 允许清单：单节点分支 / hasSubagentNode 协议判定 / 证据键与文案不参与 pair 断言。
  // ② 该轮修复在既有场景内扩展（不新增顶层编号）。

  {
    name: '154 单一来源静态锁：looksLikeObjectLiteral 单源 + EXECUTE_FAMILY_NODE_IDS 消费面（入口 ∪ lib）零内联 pair',
    run: (dir) => {
      const issues = [];
      // ① 单一来源静态锁：单源模块**反查**（不写文件名），消费面由引擎面文本真实引用派生
      const lookup = engineDefinitionModule('looksLikeObjectLiteral');
      if (lookup === null) {
        throw new Error('looksLikeObjectLiteral 的单一来源定义面不唯一（应恰一处）: '
          + JSON.stringify(engineDefinitionHits('looksLikeObjectLiteral')));
      }
      const texts = engineScriptTexts();
      for (const problem of singleSourceImportProblems({
        symbol: 'looksLikeObjectLiteral', sourceRel: lookup.file, texts,
      })) issues.push(problem);

      // ①b 反向构造（同一判据驱动 · 探针目标数据驱动）：逐项改坏输入 ⇒ 必报，还原 ⇒ 复绿。
      const sourceText = texts.get(lookup.file);
      if (typeof sourceText !== 'string') throw new Error('反查所得单源模块不在场: ' + lookup.file);
      const firstConsumer = [...texts.keys()].find((rel) => rel !== lookup.file
        && new RegExp('import\\s*\\{[^}]*\\blooksLikeObjectLiteral\\b').test(texts.get(rel)));
      if (firstConsumer === undefined) throw new Error('反向构造前提不成立：找不到具名取用的消费方');
      const consumerText = texts.get(firstConsumer);
      const probes = [
        ['消费方自带第二份定义',
          new Map(texts).set(firstConsumer,
            consumerText + '\nfunction looksLikeObjectLiteral(raw) { return false; }\n'), '自带第二份'],
        ['源侧定义被抽掉（单源面被破坏）',
          new Map(texts).set(lookup.file,
            sourceText.replace('function looksLikeObjectLiteral', 'function renamedObjectLiteralProbe')), '单一来源被破坏'],
        ['消费方不再取用（import 被抽掉）',
          new Map(texts).set(firstConsumer, dropNamedImport(consumerText, 'looksLikeObjectLiteral')), '未从'],
      ];
      for (const [label, mutated, expected] of probes) {
        const reported = singleSourceImportProblems({
          symbol: 'looksLikeObjectLiteral', sourceRel: lookup.file, texts: mutated,
        });
        if (!reported.some((problem) => problem.includes(expected))) {
          issues.push('反向构造判别力缺失（' + label + ' 未被判违规）');
        }
      }
      if (singleSourceImportProblems({
        symbol: 'looksLikeObjectLiteral', sourceRel: lookup.file, texts,
      }).length !== 0) issues.push('反向构造还原后未复绿（判据受输入顺序影响）');

      // ===== F-3（AC-5）：execute 家族成员单一来源静态锁 =====
      // ① import 断言：说明符由消费方位置推导（`lib/` 内是 `'../route-node.mjs'`），消费面 =
      // 入口 ∪ `lib/**`（由真实引用派生——迁移后的消费方自动进入对账，不写文件名清单）。
      // ② 内联 pair 检测器：`=== 'execute'` 与 `=== 'subagent-execute'` 经 `||` 直连（正反顺序）。
      // 只命中双侧 === || === 组合；单节点分支（&& / 单 compare）、协议判定、证据键不命中
      //（下方合成正/负例自锚，防检测器退化为永不生效或误伤允许形态）。
      const pairRe = /(?:[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*===\s*'execute'\s*\)?\s*\|\|\s*\(?\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*===\s*'subagent-execute')|(?:[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*===\s*'subagent-execute'\s*\)?\s*\|\|\s*\(?\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*===\s*'execute')/g;
      const detectorPositive = [
        "(node.id === 'execute' || node.id === 'subagent-execute')",
        "(detectedNode === 'subagent-execute' || detectedNode === 'execute')",
        "(nodeId === 'execute' || requestNode === 'subagent-execute')",
      ];
      const detectorNegative = [
        "if (node.id === 'execute' && state.activeChange) {",
        "if (node.id === 'subagent-execute' && state.activeChange) {",
        "(protocol.nodes ?? []).some(n => n.id === 'subagent-execute')",
        "state.evidence['subagent-execute'] = state.evidence['subagent-execute'] || {};",
        "hasSubagentNode(protocol)",
      ];
      for (const candidate of detectorPositive) {
        pairRe.lastIndex = 0;
        if (!pairRe.test(candidate)) issues.push('内联 pair 检测器自身失效：未命中已知历史形态 ' + JSON.stringify(candidate));
      }
      for (const candidate of detectorNegative) {
        pairRe.lastIndex = 0;
        if (pairRe.test(candidate)) issues.push('内联 pair 检测器误报允许形态：' + JSON.stringify(candidate));
      }
      const familySource = engineDefinitionModule('EXECUTE_FAMILY_NODE_IDS');
      if (familySource === null) {
        throw new Error('EXECUTE_FAMILY_NODE_IDS 的单一来源定义面不唯一（应恰一处）: '
          + JSON.stringify(engineDefinitionHits('EXECUTE_FAMILY_NODE_IDS')));
      }
      // 单一来源面（定义唯一 + 消费面一律取用）：同一判据驱动，消费面由真实引用派生
      for (const problem of singleSourceImportProblems({
        symbol: 'EXECUTE_FAMILY_NODE_IDS', sourceRel: familySource.file, texts,
      })) issues.push(problem);
      const familyConsumers = engineConsumersOf('EXECUTE_FAMILY_NODE_IDS').filter((rel) => rel !== familySource.file);
      if (familyConsumers.length === 0) issues.push('execute 家族消费面为空（受检面收缩？）');
      for (const rel of familyConsumers) {
        const text = fs.readFileSync(path.join(SCRIPTS_DIR, rel), 'utf8');
        const sourceLines = text.split('\n');
        pairRe.lastIndex = 0;
        let m;
        while ((m = pairRe.exec(text)) !== null) {
          const lineNo = text.slice(0, m.index).split('\n').length;
          issues.push(rel + ':' + lineNo + ' 出现 execute 家族成员内联 pair（应改用 EXECUTE_FAMILY_NODE_IDS.has(...)）: ' + sourceLines[lineNo - 1].trim());
        }
      }
      if (issues.length > 0) throw new Error(issues.join(String.fromCharCode(10)));
    },
  },

  // 155: record 契约解析失败消息分级（设计语义 / AC-3）——--json-file 传入损坏 JSON（以 { 开头）
  // → 报"文件内容不是合法 JSON" + 长度元数据，且不再建议使用 --json-file；内联传参损坏仍建议
  // --json-file。当前两分支同一英文文案（都建议 use --json-file）→ ① 断言 RED。
  {
    name: '155 record 契约解析失败消息分级：--json-file 损坏提示非合法；内联仍提示 --json-file',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      // ① --json-file 指向损坏 JSON（以 { 开头）→ "不是合法 JSON" + 长度元数据，不再建议 --json-file
      writeFile(dir, 'payload.json', '{summary: "broken", completedChecks: ["x"]');
      const resFile = runStateWithProtocol(dir, ['record', 'open', '--json-file', 'payload.json']);
      assertExit(resFile, 1);
      assertNotOut(resFile, '--json-file');
      assertOut(resFile, '不是合法 JSON');
      assertOut(resFile, 'length=');
      // ② 内联传参损坏（以 { 开头）→ 仍建议 --json-file（既有语义保留）
      const bad = '{summary: "broken"';
      const resInline = runStateWithProtocol(dir, ['record', 'open', bad]);
      assertExit(resInline, 1);
      assertOut(resInline, '--json-file');
    },
  },

];
