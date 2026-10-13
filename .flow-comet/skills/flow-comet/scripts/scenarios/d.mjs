// 场景组 d — 安装器平台选择 · 多趟依赖图 · 契约解析失败检测
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import path from 'path';
import {
  assertExit,
  assertNotOut,
  assertOut,
  baseState,
  runHandoff,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  PREPARE_ENV,
  TASK_DEP_CYCLE,
  TASK_MISSING_DEP,
  TASK_MIXED_PSP,
  TASK_MIXED_SPS,
  TASK_VALID_ALL_PARALLEL,
  renderMultiWaveTasks,
  runPlanExit,
  runPrepareEnv,
} from '../lib/test-fixtures.mjs';
import {
  runStateWithProtocol,
} from '../lib/test-assertions.mjs';

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
    name: '145 plan exit BLOCKED：新 change 依赖环（P01↔P02 互为依赖）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_DEP_CYCLE);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '依赖环');
      assertOut(res, 'depends_on');
    },
  },

  // 146（多趟语义重写）：新 change + P01 依赖不存在的 T99 → exit plan 应 BLOCKED，
  // 输出含恢复指引（depends_on 调整）。旧引擎静默放行 = 预期 RED。
  {
    name: '146 plan exit BLOCKED：新 change 并行任务依赖不存在的任务（含恢复指引）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
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
      st.newChange = true;
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
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_MIXED_PSP);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 149（混排合法锚）：新 change + 多波混合（≥2 个并行块被串行分隔）→ 放行
  {
    name: '149 plan exit 通过：混排合法锚——多波混合（两并行块被串行分隔）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, renderMultiWaveTasks());
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 150（兼容锚保留）：新 change + 全并行（单连续块仍是合法特例）→ 放行
  {
    name: '150 plan exit 通过：全并行单连续块（合法特例）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_VALID_ALL_PARALLEL);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 151（渐进语义适配）：旧 change（无 newChange）+ 依赖环 → 不 BLOCK（渐进 WARN——断言锁「不阻断」，
  // 检测须真实发生：输出 WARN 且含「依赖环」明细）。混排本身已合法化，渐进路径改由依赖图违规承载。
  {
    name: '151 plan exit 兼容：旧 change 依赖环不 BLOCK（渐进 WARN）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      // 无 newChange（旧 change）
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_DEP_CYCLE);
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      assertOut(res, 'WARN');
      assertOut(res, '依赖环');
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
];
