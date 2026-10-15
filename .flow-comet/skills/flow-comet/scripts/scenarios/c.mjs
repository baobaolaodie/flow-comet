// 场景组 c — 声明机制 · 产物推导 · 模板保真 · 技能加载前置门 · 零提交边界
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  assertExit,
  assertNotOut,
  assertOut,
  assertTrue,
  baseState,
  runGuard,
  runHandoff,
  runState,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  SCRIPTS_DIR,
  TASK_DONE,
  TASK_DONE_TWO,
  TASK_P1,
  customProtocolWithSkillCall,
  handoffFor,
  isAuthoritativeSourceRepo,
  summaryContent,
  writeCustomProtocol,
  writeIntakeArtifacts,
} from '../lib/test-fixtures.mjs';
import {
  assertOutMatches,
  readScenarioState,
  runGuardWithProtocol,
  runStateWithProtocol,
  scenarioProtocolPath,
} from '../lib/test-assertions.mjs';
import {
  countSyncProblems,
} from '../lib/text-anchor-checks.mjs';

export const ENTRIES = [

  // ----------  场景（completedChecks 真实性声明机制——skill-load/record/exit 校验 + 交叉自洽 + 旧兼容 + 场景数同步） ----------

  // 98: skill-load 写入声明标记（AC-1）——完整命令形态（--prompt flow-kit/prompts/<阶段>.md，
  // 归属校验通过）→ 标记 .specs/<change-id>/.skill-loads/<node>-<skill>.json 生成，
  // 内容含 node/skill/protocol/at（ISO 时间戳）+ 输出确认提示
  {
    name: '98 skill-load 写入声明标记（AC-1）',
    run: (dir) => {
      // 场景内 flow-kit/prompts/ 提示文件（skill-load --prompt 指向——改名 --prompt 后归属校验仅查
      // 前缀不读内容；协议加载走 env reference 路径，文件无需为 JSON）
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md']);
      assertExit(res, 0);
      assertOut(res, 'SKILL-LOAD: open flow-comet-change → .skill-loads/open-flow-comet-change.json');
      const markerPath = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json');
      if (!fs.existsSync(markerPath)) throw new Error('标记文件未生成: ' + markerPath);
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.node !== 'open' || marker.skill !== 'flow-comet-change') {
        throw new Error('标记 node/skill 字段不符: ' + JSON.stringify(marker));
      }
      // 标记 protocol = --prompt 参数的 basename（与 guard exit 的 节点协议映射表比对同值，
      // 真实链路 skill-load → exit 一致；缺陷修复前写 resolveProtocol 解析后的完整绝对路径，
      // 与 节点协议映射表 basename 精确比对必然失败——机制实际不可用，已修复）
      if (marker.protocol !== '0-change.md') {
        throw new Error('标记 protocol 应为 --prompt 参数的 basename 0-change.md: ' + JSON.stringify(marker));
      }
      if (typeof marker.at !== 'string' || Number.isNaN(Date.parse(marker.at))) {
        throw new Error('标记缺 ISO 时间戳 at: ' + JSON.stringify(marker));
      }
    },
  },

  // 99: skill-load 非法参数拒绝（AC-2）——缺 node/skill / node 非法 / skill 名非法字符 /
  // --prompt 不在 flow-kit/prompts/ 下 → 报错 exit 非 0，不写任何标记（.skill-loads/ 无文件）
  {
    name: '99 skill-load 非法参数拒绝不写标记（AC-2）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      // a) 缺参数（无 node/skill）
      const rA = runStateWithProtocol(dir, ['skill-load']);
      assertExit(rA, 1);
      assertOut(rA, 'skill-load requires <node> <skill>');
      // b) node 非法（非内置节点）
      const rB = runStateWithProtocol(dir, ['skill-load', 'bogus', 'flow-comet-change']);
      assertExit(rB, 1);
      assertOut(rB, 'skill-load node 非法');
      // c) skill 名含非法字符
      const rC = runStateWithProtocol(dir, ['skill-load', 'open', 'bad/name']);
      assertExit(rC, 1);
      assertOut(rC, 'skill-load skill 名非法');
      // d) --prompt 不在 flow-kit/prompts/ 下（指向场景内 reference 副本——文件存在可加载，
      //    归属校验拒绝；若归属校验被跳过则此处会成功写标记，断言即失效）
      const rD = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change', '--prompt', 'reference/workflow-protocol.json']);
      assertExit(rD, 1);
      assertOut(rD, 'skill-load --prompt 路径必须位于 flow-kit/prompts/ 下');
      // e) 自定义协议下未知节点同样拒绝（node 校验从内置清单改为当前协议节点集合
      // 动态读取——协议外节点名依然非法，fail-closed 行为不变）
      const custom = writeCustomProtocol(dir);
      const rE = runState(['skill-load', 'bogus', 'flow-comet-change'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(rE, 1);
      assertOut(rE, 'skill-load node 非法');
      // 全部拒绝后 .skill-loads/ 不产生任何标记文件
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      if (fs.existsSync(loadsDir) && fs.readdirSync(loadsDir).length > 0) {
        throw new Error('非法参数不应写入标记: ' + fs.readdirSync(loadsDir).join(', '));
      }
    },
  },

  // 100: record 校验 BLOCK（AC-3 反例）——completedChecks 含 required-skill:open.flow-comet-change
  // 条目但无对应声明标记 → BLOCKED + 指引先加载 skill 并运行 skill-load；evidence 不写入
  {
    name: '100 record BLOCKED：completedChecks 缺声明标记（AC-3）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runStateWithProtocol(dir, ['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })]);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '缺少对应声明标记');
      assertOut(res, 'workflow-state.mjs skill-load open flow-comet-change');
      // BLOCK 先于记录——校验失败后 evidence 不得写入
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.evidence && st.evidence.open) throw new Error('BLOCKED 后不应写入 evidence: ' + JSON.stringify(st.evidence.open));
    },
  },

  // 101: record 校验通过（AC-3 正例）——先 skill-load 写入标记，record 带同条 completedChecks → 正常记录
  {
    name: '101 record 通过：先 skill-load 声明标记（AC-3 正例）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const sl = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change']);
      assertExit(sl, 0);
      assertOut(sl, 'SKILL-LOAD: open flow-comet-change');
      const res = runStateWithProtocol(dir, ['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })]);
      assertExit(res, 0);
      assertOut(res, 'EVIDENCE: open');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.evidence.open || st.evidence.open.summary !== 'done') {
        throw new Error('record 未写入 evidence: ' + JSON.stringify(st.evidence));
      }
      // 自定义协议节点（compose 兼容）——node 校验按当前协议节点集合动态读取
      // （内置 + 自定义），自定义节点（brainstorm）可 skill-load 声明 + record 声明校验端到端通过
      // （修复前 BUILTIN_NODES 硬编码只含内置 8 节点 → skill-load 拒绝 brainstorm = RED）
      writeFile(dir, 'custom-protocol.json', JSON.stringify(customProtocolWithSkillCall(), null, 2) + '\n');
      const customEnv = { FLOW_COMET_PROTOCOL: path.join(dir, 'custom-protocol.json') };
      const slCustom = runState(['skill-load', 'brainstorm', 'flow-comet-brainstorm'], dir, customEnv);
      assertExit(slCustom, 0);
      assertOut(slCustom, 'SKILL-LOAD: brainstorm flow-comet-brainstorm');
      const resCustom = runState(['record', 'brainstorm', JSON.stringify({ summary: 'brainstorm done', completedChecks: ['required-skill:brainstorm.flow-comet-brainstorm'] })], dir, customEnv);
      assertExit(resCustom, 0);
      assertOut(resCustom, 'EVIDENCE: brainstorm');
    },
  },

  // 102: exit 协议声明标记校验（AC-4）+ 真实链路集成——.skill-loads/ 已激活
  // （目录存在）但无本节点协议标记（<node>-*.json 且 protocol ∈ 该节点协议集，节点协议映射表
  // basename）→ BLOCKED；真实 skill-load --prompt 写入的标记（protocol = basename）→ exit 通过
  // （修复后真实链路一致——缺陷修复前 skill-load 写解析后完整路径，exit 必 BLOCKED）；未传
  // --prompt（标记 protocol = null）→ BLOCKED；损坏标记（protocol 非协议集）→ BLOCKED
  {
    name: '102 exit 协议标记校验：真实链路通过 / 无标记·null·损坏 BLOCKED（AC-4）',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      // 场景内 flow-kit/prompts/ 提示文件（真实 skill-load --prompt 指向——归属校验仅查前缀不读内容）
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      fs.mkdirSync(loadsDir, { recursive: true });
      // ① 机制已激活（.skill-loads/ 存在）但无 open-* 标记（仅他节点标记）→ BLOCKED
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/design-flow-comet-design.json',
        JSON.stringify({ node: 'design', skill: 'flow-comet-design', protocol: '2-design.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resBlock = runGuard(['exit', 'open'], dir);
      assertExit(resBlock, 1);
      assertOut(resBlock, 'BLOCKED');
      assertOut(resBlock, 'exit 缺协议声明标记');
      // ② 真实链路：skill-load --prompt 写入标记（protocol = basename）→ exit 通过
      const markerPath = path.join(loadsDir, 'open-flow-comet-change.json');
      const sl = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md']);
      assertExit(sl, 0);
      assertOut(sl, 'SKILL-LOAD: open flow-comet-change');
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.protocol !== '0-change.md') {
        throw new Error('skill-load 标记 protocol 应为 --prompt 参数的 basename 0-change.md: ' + JSON.stringify(marker));
      }
      const resPass = runGuard(['exit', 'open'], dir);
      assertExit(resPass, 0);
      assertOut(resPass, 'ALL CHECKS PASSED');
      assertNotOut(resPass, 'BLOCKED');
      // ③ skill-load 未传 --prompt → 标记 protocol = null → exit BLOCKED（fail-closed：
      // 无协议声明不可通过——指引补 skill-load --prompt）
      const slNull = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change']);
      assertExit(slNull, 0);
      const markerNull = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (markerNull.protocol !== null) {
        throw new Error('skill-load 未传 --prompt 标记 protocol 应为 null: ' + JSON.stringify(markerNull));
      }
      const resNull = runGuard(['exit', 'open'], dir);
      assertExit(resNull, 1);
      assertOut(resNull, 'BLOCKED');
      assertOut(resNull, 'exit 缺协议声明标记');
      // ④ 损坏标记（protocol 非协议集 basename）→ BLOCKED（fail-closed）
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '9-other.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resCorrupt = runGuard(['exit', 'open'], dir);
      assertExit(resCorrupt, 1);
      assertOut(resCorrupt, 'BLOCKED');
      assertOut(resCorrupt, 'exit 缺协议声明标记');
    },
  },

  // 103: 交叉自洽（AC-5）——标记存在但 at 晚于 record 时间（手工构造未来时间戳）→ BLOCKED
  // （标记必须先于记录声明——时间序可审计）
  {
    name: '103 record BLOCKED：标记 at 晚于记录时间（AC-5 交叉自洽）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2999-12-31T00:00:00.000Z' }, null, 2) + '\n');
      const res = runStateWithProtocol(dir, ['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })]);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '标记必须先于记录声明');
    },
  },

  // 104: 旧 evidence/旧 change 兼容（AC-6）——旧格式记录（completedChecks 无 required-skill 条目 /
  // 无 completedChecks）无标记照常通过；exit 在 .skill-loads/ 未激活（目录不存在）时
  // SKILL-LOAD WARN 照常通过（声明机制未激活不追溯）
  {
    name: '104 旧 evidence/旧 change 兼容：无标记照常通过（AC-6）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      // ① 旧格式 record：completedChecks 无 required-skill 条目 → 无标记也通过
      const resA = runStateWithProtocol(dir, ['record', 'open', JSON.stringify({ summary: 'legacy', completedChecks: ['unit-tests'] })]);
      assertExit(resA, 0);
      assertOut(resA, 'EVIDENCE: open');
      // ② 无 completedChecks 的纯 summary 记录 → 通过
      const resB = runStateWithProtocol(dir, ['record', 'open', JSON.stringify({ summary: 'plain' })]);
      assertExit(resB, 0);
      // ③ exit open：M5 后 record 已自动补声明标记 → 无 SKILL-LOAD WARN,正常通过
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      const resC = runGuard(['exit', 'open'], dir);
      assertExit(resC, 0);
      assertOut(resC, 'ALL CHECKS PASSED');
      assertNotOut(resC, 'SKILL-LOAD WARN');
      // M5: record 已自动补 requiredSkillCalls 声明标记
      if (!fs.existsSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json'))) {
        throw new Error('record 自动声明标记缺失: open-flow-comet-change.json');
      }
    },
  },

  // 105: 计数一致性自检同步（AC-8 / AC-14）——组文件里的场景数或系统测试集项数变更时，
  // 受检文件须同步（场景数：ALL n SCENARIOS PASSED / n scenarios / n 场景 / n/n 变体；
  // 项数：n/n / n items / n 项 变体）。本场景读取权威源仓库的受检文件断言含当前计数变体——
  // 文档漏同步或条目缺失（幽灵条目）即 RED；与底部自检共用同一实现（countSyncProblems），
  // 两处判据不会漂移。安装副本无文档面，跳过。
  {
    name: '105 计数一致性自检同步：受检文件含当前场景数与系统测试集项数变体（AC-8 / AC-14）',
    run: async () => {
      if (!isAuthoritativeSourceRepo()) return; // 安装副本无 flow-comet 文档
      const problems = await countSyncProblems();
      if (problems.length > 0) {
        throw new Error(problems.join('; '));
      }
    },
  },

  // 106: exit review——REVIEW.md 发现区条目处置状态结构级校验（L3-1：问题处理原则）——
  // 发现项（含 Minor）无处置状态标记（[已修]/[升级]/[转待办]）→ REVIEW WARN 渐进不 BLOCK
  // （防旧 REVIEW 卡死——旧 REVIEW 未按新格式写标记只警告不阻断）；全部带标记 → 无 WARN
  // （发现不得"记录后无声消失"——每条须有处置去向）
  {
    name: '106 exit review WARN：发现区条目缺处置状态标记（L3-1）',
    run: (dir) => {
      const st = baseState('review');
      st.evidence.review = { summary: 'review done' };
      writeState(dir, st);
      // ① 发现区 Minor 条目无处置标记 → REVIEW WARN + 通过（渐进不阻断）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n无\n\n### Major\n\n无\n\n### Minor\n\n- **m-1 · 示例发现**：描述（未处置）\n\n## 结论\n\n通过\n');
      const res = runGuard(['exit', 'review'], dir);
      assertExit(res, 0);
      assertOut(res, 'REVIEW WARN');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② 同一条目带 [转待办] 处置标记 → 无 REVIEW WARN
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n无\n\n### Major\n\n无\n\n### Minor\n\n- **m-1 · 示例发现**：描述 [转待办]\n\n## 结论\n\n通过\n');
      const res2 = runGuard(['exit', 'review'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, 'REVIEW WARN');
      assertOut(res2, 'ALL CHECKS PASSED');
      // ③ 有序条目（1. **...**）与无序同口径——缺处置标记 → 旧 change 仍渐进 REVIEW WARN
      // （修复前 .filter((item) => !item.ordered) 使有序条目静默通过 = RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n1. **m-2 · 有序未处置**：某处问题，未给出任何处置结论，描述足够长以避免内容不足\n\n## 结论\n\n通过\n');
      const resOrdered = runGuard(['exit', 'review'], dir);
      assertExit(resOrdered, 0);
      assertOut(resOrdered, 'REVIEW WARN');
      assertNotOut(resOrdered, 'BLOCKED');
      // ④ 有序 Minor 带 [转待办] → 无该渐进告警（有序条目接入校验不误报已处置项）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n1. **m-3 · 有序小项**：某处小问题，已登记下一 change 跟踪处置 [转待办]\n\n## 结论\n\n通过\n');
      const resOrderedOk = runGuard(['exit', 'review'], dir);
      assertExit(resOrderedOk, 0);
      assertNotOut(resOrderedOk, 'REVIEW WARN');
      assertOut(resOrderedOk, 'ALL CHECKS PASSED');
    },
  },

  // 107: determineNode 产物推导 pathBase 感知——compose 自定义协议 outputSchemas 含
  // pathBase='project' 工件（项目根 README.md）时,status/next 按项目根产物正确推进。
  // 修复前 buildNodeCompletionFlags 丢弃 pathBase、nodeFlagsComplete 一律按 .specs/ 解析
  // → 项目根工件永不命中 → 节点判定不完成 → next 钉回（卡死）。
  {
    name: '107 产物推导 pathBase 感知：project 根工件正确推进',
    run: (dir) => {
      // 自定义协议:brief(project 根 README.md)→ doccheck(specs-root report.md)
      const custom = path.join(dir, 'pb-protocol.json');
      writeFile(dir, 'pb-protocol.json', JSON.stringify({
        schemaVersion: 1,
        kind: 'workflow-kernel',
        name: 'pathbase-test',
        goal: 'pathBase 场景：pathBase=project 工件正确推进。',
        nodes: [
          { id: 'brief', label: 'Brief', kind: 'control', responsibility: '产出项目根 README.md。', outputSchemas: ['pathbase.brief.v1'], requiredSkillCalls: [], augmentations: [], disabled: false },
          { id: 'doccheck', label: 'Doc Check', kind: 'control', responsibility: '产出 specs-root report.md。', outputSchemas: ['pathbase.doccheck.v1'], requiredSkillCalls: [], augmentations: [], disabled: false },
        ],
        outputSchemas: [
          { id: 'pathbase.brief.v1', artifacts: [{ id: 'readme', paths: ['README.md'], pathBase: 'project' }] },
          { id: 'pathbase.doccheck.v1', artifacts: [{ id: 'report', paths: ['report.md'] }] },
        ],
      }, null, 2));
      // init(自定义协议经 --protocol CLI)+ 项目根产物 README.md
      assertExit(runState(['init', CHANGE_ID, '--protocol', custom, '--init-skip'], dir), 0);
      writeFile(dir, 'README.md', '# project readme\n');
      // brief 完成(README.md 在项目根存在)→ determineNode 推导下一节点 doccheck
      // （验证点:产物推导尊重 pathBase——修复前 README.md 按 .specs/ 解析永不命中 → currentNode 仍 brief）
      // （注:next 的顺序门禁会 BLOCK 未 exit 节点——那是节点顺序语义,非本场景目标）
      const st = runState(['status', '--protocol', custom], dir);
      assertExit(st, 0);
      assertOut(st, '"currentNode": "doccheck"');
    },
  },

  // 108: 产物推导 fail-fast（B 方案）——协议声明 classic/native pathBase 时状态机推导
  // 暂不支持（guard 侧全量感知、state 侧兜底不一致的已知边界）,显式报错提示改用
  // specs-root/project + 完整路径——不静默兜底（防卡死/误判）。
  {
    name: '108 产物推导 fail-fast：classic/native pathBase 显式报错（B 方案）',
    run: (dir) => {
      // 自定义协议:proposal 节点声明 classic-openspec-root 工件
      const custom = path.join(dir, 'classic-protocol.json');
      writeFile(dir, 'classic-protocol.json', JSON.stringify({
        schemaVersion: 1,
        kind: 'workflow-kernel',
        name: 'classic-test',
        goal: 'fail-fast 场景：classic pathBase 显式报错。',
        nodes: [
          { id: 'proposal', label: 'Proposal', kind: 'control', responsibility: '产出 openspec 产物。', outputSchemas: ['classic.proposal.v1'], requiredSkillCalls: [], augmentations: [], disabled: false },
        ],
        outputSchemas: [
          { id: 'classic.proposal.v1', artifacts: [{ id: 'proposal', paths: ['changes/xxx.md'], pathBase: 'classic-openspec-root' }] },
        ],
      }, null, 2));
      assertExit(runState(['init', CHANGE_ID, '--protocol', custom, '--init-skip'], dir), 0);
      // status:classic/native pathBase → fail-fast 显式报错（不静默兜底）。
      // 措辞订正：guard 侧同样拒绝这三类 pathBase，故消息不再说「由 guard 校验支持」
      // （旧措辞会让人以为只有状态机推导缺支持）——断言随之锁新措辞。
      const st = runState(['status', '--protocol', custom], dir);
      assertExit(st, 1);
      assertOut(st, '已不受 guard 与状态机支持');
      assertOut(st, 'specs-root');
    },
  },

  // 109: execute 出口校验——TASK done 任务 ↔ <id>-SUMMARY.md 存在——
  // 缺任一 done 任务的 SUMMARY → WARN 渐进不 BLOCK（防旧 change 卡死）；齐全 → 无 WARN
  {
    name: '109 execute exit：done 任务缺 SUMMARY → WARN 渐进',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'execute done' };
      st.executionMode = 'direct'; // direct:串行任务主代理直写,不要求 handoff(聚焦产物完整性校验)
      writeState(dir, st);
      // TASK:两个 done 任务(T01/T02)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
        '<task id="T02" status="done"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify></task>\n');
      // ① 只有 T02-SUMMARY.md(T01 缺)→ WARN 点名 T01-SUMMARY.md + 通过（渐进）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T02-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN');
      assertOut(res, 'T01-SUMMARY.md');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② 补 T01-SUMMARY.md → 无缺产物 WARN（既有 SKILL-LOAD 兼容 WARN 与本文无关）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '缺少 T01-SUMMARY.md');
      assertOut(res2, 'ALL CHECKS PASSED');
    },
  },

  // 110: execute 出口越权委托检测——TASK 有 parallel done 任务 + completedNodes
  // 无 subagent-execute + 非 direct 模式 → WARN 渐进（[P] 任务应由 subagent-execute 节点委托,
  // execute 阶段完成 [P] 是越权委托痕迹——上轮真实流程实证的越权委托）;completedNodes 含
  // subagent-execute 或 direct 模式 → 无越权 WARN
  {
    name: '110 execute exit：parallel done 无 subagent-execute → WARN 越权委托',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'execute done' };
      st.completedNodes = ['open', 'design', 'plan', 'execute']; // subagent-execute 未 exit
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) }; // 已委托(共用证据库)
      writeState(dir, st);
      // TASK:parallel done P01 + 产物 SUMMARY(满足 task-summaries 出口门禁 + KI-8)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      // ① completedNodes 无 subagent-execute + 非 direct → WARN（越权委托）
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, '越权委托');
      assertOut(res, 'subagent-execute');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② completedNodes 含 subagent-execute → 无越权 WARN
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      writeState(dir, st);
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '越权委托');
      assertOut(res2, 'ALL CHECKS PASSED');
    },
  },

  // 111: verify 出口越权委托兜底检测——同 KI-10 判定（TASK parallel done +
  // completedNodes 无 subagent-execute + 非 direct）,verify 时仍未 exit → WARN 兜底
  // （execute 出口未拦截的兜底提示）
  {
    name: '111 verify exit：parallel done 无 subagent-execute → WARN 越权委托兜底',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'review']; // 无 subagent-execute
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      // ① completedNodes 无 subagent-execute → WARN 兜底
      const res = runGuard(['exit', 'verify'], dir);
      assertExit(res, 0);
      assertOut(res, '越权委托');
      assertOut(res, 'subagent-execute');
      // ② completedNodes 含 subagent-execute → 无越权 WARN
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      const res2 = runGuard(['exit', 'verify'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '越权委托');
    },
  },

  // 112: 节点顺序 BLOCK 消息含恢复指引——next 的「疑似未 exit」BLOCK 与
  // exit 的「currentNode 不匹配」BLOCK 均提示恢复通道（advance 强制推进/select 切换/
  // exit --apply）——防 resume 自锁（上轮真实项目端到端验证观察：机器推导节点无脚本恢复通道）
  {
    name: '112 节点顺序 BLOCK 消息含恢复指引',
    run: (dir) => {
      // ① next:currentNode=execute 但未 exit(无 evidence 记录)→ BLOCK 消息含 advance/select 指引
      const st1 = baseState('execute'); // evidence 空——无豁免,触发"疑似未 exit"BLOCK
      writeState(dir, st1);
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true }); // findActiveChange 要求目录存在
      const nx = runStateWithProtocol(dir, ['next']);
      assertExit(nx, 1);
      assertOut(nx, 'BLOCKED');
      assertOut(nx, 'advance');
      assertOut(nx, 'select');
      // ② exit:currentNode=design 但 exit open → BLOCK 消息含 advance 指引
      const st2 = baseState('design');
      st2.evidence.design = { summary: 'design done' };
      writeState(dir, st2);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## AC\n');
      const ex = runGuard(['exit', 'open'], dir);
      assertExit(ex, 1);
      assertOut(ex, 'BLOCKED');
      assertOut(ex, 'advance');
      // ③ exit 无 evidence → BLOCK 消息含 record 补证据指引（KI-3 补全）
      const st3 = baseState('design');
      writeState(dir, st3);
      const ex3 = runGuard(['exit', 'open'], dir);
      assertExit(ex3, 1);
      assertOut(ex3, 'missing evidence');
      assertOut(ex3, 'record');
    },
  },

  // 113: plan 出口波次散文一致性检测——TASK 的 ## 波次划分 Wave 行任务带 [P]
  // 标记（并行语义）但 XML 任务无 parallel="true" → WARN（散文与机器路由依据不一致,
  // 以任务标记为准）;XML 补齐 parallel → 无 WARN。容错:无并行语义的 Wave 行不参与比对。
  // ③④ 追加同判据的段尾分支回归锚（波次段即文末，新 change 形态 ⇒ 必 BLOCK）：段尾判定若
  // 不成立，该检查会被整段静默跳过——下一条 [P] 行漏扫的同族形态见上一场景。
  {
    name: '113 plan exit：波次散文与并行标记不一致 → WARN（旧 change）/ BLOCK（新 change，含段即文末形态）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      // TASK:波次散文 Wave 1 (parallel): T01[P], T02[P];XML 仅 T01 parallel（T02 不一致）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 波次划分\n\nWave 1 (parallel): T01[P], T02[P]\n\n## 任务清单\n\n'
        + '<task id="T01" parallel="true" status="pending"><action>a</action><write_files>f1</write_files><verify>v</verify></task>\n'
        + '<task id="T02" status="pending"><action>b</action><write_files>f2</write_files><verify>v</verify></task>\n');
      // ① 散文 T02[P] 但 XML 无 parallel → WARN
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 0);
      assertOut(res, '波次散文');
      assertOut(res, 'T02');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② XML 补 T02 parallel → 无波次 WARN
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 波次划分\n\nWave 1 (parallel): T01[P], T02[P]\n\n## 任务清单\n\n'
        + '<task id="T01" parallel="true" status="pending"><action>a</action><write_files>f1</write_files><verify>v</verify></task>\n'
        + '<task id="T02" parallel="true" status="pending"><action>b</action><write_files>f2</write_files><verify>v</verify></task>\n');
      const res2 = runGuard(['exit', 'plan'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '波次散文');
      assertOut(res2, 'ALL CHECKS PASSED');
      // ③ 段即文末形态（新 change）：段提取的段尾判定第三个分支——波次段**即文末**（其后再无段
      //    标题、亦无分隔线）。先跑「抽掉必报」对照：同 ④ 夹具仅去掉散文行的 [P] 标记 ⇒ 无并行
      //    语义行 ⇒ 放行（该对照因此在任一态都可观测到）。
      const stEof = baseState('plan');
      stEof.evidence.plan = { summary: 'plan done' };
      stEof.newChange = true;
      writeState(dir, stEof);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const taskT01Eof = '<task id="T01"><action>a</action><write_files>f</write_files><verify>v</verify><done>d</done></task>\n';
      const eofHead = '# TASK\n\n## 波次划分\n\nWave 1 (parallel): ';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', eofHead + 'T01\n\n' + taskT01Eof);
      const resEofControl = runGuard(['exit', 'plan'], dir);
      assertExit(resEofControl, 0);
      assertNotOut(resEofControl, 'BLOCKED');
      // ④ 同 ③ 夹具补回 [P] 标记（唯一变量）→ 段尾判定须成立、该检查不得被整段静默跳过 ⇒ BLOCK。
      //    夹具形态自证（判别力前提）：波次段之后不得再出现段标题 / 分隔线——否则该夹具退化为
      //    「段后有下一段标题」形态，段尾第三分支失去覆盖而断言在两种写法下都成立（假绿）。
      const eofFixture = eofHead + 'T01[P]\n\n' + taskT01Eof;
      assertTrue(!/\n##\s|\n---/.test(eofFixture.slice(eofFixture.indexOf('## 波次划分'))),
        '夹具形态前提不成立：波次段须为文末（其后不得再出现段标题或分隔线），否则段尾分支无覆盖');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', eofFixture);
      const resEof = runGuard(['exit', 'plan'], dir);
      assertExit(resEof, 1);
      assertOutMatches(resEof, /波次散文标记任务为并行（\[P\]）但任务无 parallel="true"/, '波次段即文末时检查被整段跳过');
    },
  },

  // 114: init 未知参数(以 -- 开头,如 --help)→ 报错而非当作 change 名执行
  // (此前 --help 会被当作 change id 使用:自动开 change、建分支、写状态——误用有破坏性)
  {
    name: '114 init 未知参数(以 -- 开头)报错而非当作 change 名',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const branchBefore = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
      const res = runStateWithProtocol(dir, ['init', '--help']);
      assertExit(res, 1);
      assertOut(res, 'not a change name');
      assertOut(res, 'Usage: workflow-state.mjs init');
      assertNotOut(res, 'BRANCH:');
      const branchAfter = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
      if (branchAfter !== branchBefore) throw new Error('init --help 不应切换或创建分支');
      if (fs.existsSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'))) {
        throw new Error('init --help 不应写状态文件(此前被当作 change 名执行的副作用)');
      }
      if (fs.existsSync(path.join(dir, '.specs', '--help'))) {
        throw new Error('init --help 不应创建 .specs/--help 工件目录');
      }
      // ② 带前导空白的 flag-like 参数(如 " --help")经 trim 后同样应被拒绝
      const res2 = runStateWithProtocol(dir, ['init', ' --help']);
      assertExit(res2, 1);
      assertOut(res2, 'not a change name');
      if (fs.existsSync(path.join(dir, '.specs', ' --help'))) {
        throw new Error('init " --help" 不应创建工件目录(trim 后应被拒绝)');
      }
    },
  },

  // 115: M1 entry 证据化——新 change(enter 机制激活)未 entry 直接 exit → ENTER WARN(渐进不阻断)
  {
    name: '115 execute exit ENTER WARN：enter 机制激活但本节点未 entry（M1）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.enteredNodes = ['open', 'design', 'plan']; // 前序节点 enter 过(机制激活);execute 未 entry
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ENTER WARN');
    },
  },

  // 116: M1 正例——entry 后 exit 无 enter 证据警告
  {
    name: '116 execute exit 通过：entry 后无 enter 证据警告（M1 正例）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.enteredNodes = ['open', 'design', 'plan'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      assertExit(runGuard(['entry', 'execute'], dir), 0); // entry 记录 enter 标记
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'ENTER WARN');
    },
  },

  // 117: M2——新 change(enter 机制激活)done 任务缺 SUMMARY → BLOCKED(旧 change WARN 渐进保留)
  // 构造:两个 done 任务(T01/T02),仅 T01-SUMMARY 存在(满足产物通配符,隔离 KI-8 语义)
  {
    name: '117 execute exit BLOCKED：新 change done 任务缺 SUMMARY（M2）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'T02']) };
      st.enteredNodes = ['open', 'design', 'plan', 'execute'];
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE_TWO);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir); // T02 缺 SUMMARY
      assertExit(res, 1);
      assertOut(res, 'SUMMARY');
    },
  },

  // 118: M3——新 change(enter 机制激活)handoff 缺 redEvidence → BLOCKED(旧 change WARN 保留)
  // 构造:handoffRequest + handoffResult 齐(满足 Output Schema evidence),仅缺 redEvidence(隔离 M3 语义)
  {
    name: '118 subagent-execute exit BLOCKED：新 change handoff 缺 redEvidence（M3）',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence.execute = { summary: 'executed' };
      st.enteredNodes = ['open', 'design', 'plan', 'subagent-execute'];
      st.newChange = true;
      const handoff = handoffFor(['T01']);
      delete handoff.T01.result.redEvidence;
      st.evidence['subagent-execute'] = { summary: 'delegated', handoffRequest: { T01: { taskId: 'T01' } }, handoffResult: handoff };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'redEvidence');
    },
  },

  // 119: M4——handoff 提交对象不可校验 → HANDOFF ERROR 且含协调者确认提示
  {
    name: '119 handoff result 提交对象不可校验 → 协调者确认提示（M4）',
    run: (dir) => {
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
      assertOut(res, 'HANDOFF ERROR');
      assertOut(res, '确认'); // 协调者确认提示
    },
  },

  // 120: M5——record 自动补写 skill-load 声明标记(open 节点 requiredSkillCalls)
  {
    name: '120 record 自动补写 skill-load 声明标记（M5）',
    run: (dir) => {
      const st = baseState('open');
      st.enteredNodes = ['open'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\nx\n\n## 验收准则（AC）\n- Given x When y Then z');
      const res = runStateWithProtocol(dir, ['record', 'open', '{"summary":"done"}']);
      assertExit(res, 0);
      const loads = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      const changeMarker = path.join(loads, 'open-flow-comet-change.json');
      const requirementMarker = path.join(loads, 'open-flow-comet-requirement.json');
      if (!fs.existsSync(changeMarker)) {
        throw new Error('record 自动声明标记缺失: open-flow-comet-change.json');
      }
      // 子断言:自动补标记的 protocol 字段按 skill 归属协议文件(修复前所有 skill 都写节点
      // 首文件 0-change.md——requirement 标记的协议归属语义错误,此处应 RED)
      const changeMeta = JSON.parse(fs.readFileSync(changeMarker, 'utf8'));
      if (changeMeta.protocol !== '0-change.md') {
        throw new Error('change 自动标记 protocol 应为 0-change.md: ' + JSON.stringify(changeMeta.protocol));
      }
      if (!fs.existsSync(requirementMarker)) {
        throw new Error('record 自动声明标记缺失: open-flow-comet-requirement.json');
      }
      const requirementMeta = JSON.parse(fs.readFileSync(requirementMarker, 'utf8'));
      if (requirementMeta.protocol !== '1-requirement.md') {
        throw new Error('requirement 自动标记 protocol 应为 1-requirement.md(修复前误写 0-change.md): ' + JSON.stringify(requirementMeta.protocol));
      }
    },
  },

  // 121: M6——execute 显式空退出豁免(全 parallel 无串行任务,evidence 声明后通过)
  {
    name: '121 execute exit 通过：显式空退出豁免（M6）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'empty exit', emptyExitApproved: true };
      st.enteredNodes = ['open', 'design', 'plan', 'execute'];
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" parallel="true" status="pending" depends_on="">\n  <name>p</name>\n  <write_files>a</write_files>\n  <action>p</action>\n  <verify>t</verify>\n  <done>d</done>\n</task>');
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      // 子断言:豁免不适用于存在未完成串行任务——防规划错误被豁免掩盖
      // (修复前 emptyExitApproved 会跳过串行 pending 阻断,此处应 RED)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T02" status="pending"><action>串行任务</action><write_files>f</write_files><verify>v</verify></task>\n');
      const resSerial = runGuard(['exit', 'execute'], dir);
      assertExit(resSerial, 1);
      assertOut(resSerial, '串行 pending');
    },
  },

  // 122: M7——旧 change(enter 机制未激活)done 缺 SUMMARY 仍 WARN 渐进,不升级(兼容正例)
  // 构造:两个 done 任务(T01/T02),仅 T01-SUMMARY 存在(满足产物通配符,隔离 KI-8 语义)
  {
    name: '122 execute exit 兼容：旧 change done 缺 SUMMARY 仍 WARN 渐进（M7）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'T02']) };
      writeState(dir, st); // 无 enteredNodes(旧 change)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE_TWO);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir); // T02 缺 SUMMARY → 旧 change 仍 WARN 渐进
      assertExit(res, 0);
      assertOut(res, 'WARN');
    },
  },

  // 123: M8——init 在无提交(空)仓库时输出提示且跳过分支创建(行为一致:
  // 修复前 WARN"无法创建分支"后仍 checkout -b 实际创建——声称与行为矛盾)
  {
    name: '123 init 空仓库提示：无提交仓库的分支创建边界（M8）',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      const res = runStateWithProtocol(dir, ['init', 'empty-repo']);
      assertExit(res, 0);
      assertOut(res, 'EMPTY-REPO');
      // 子断言 ①:警告后不得实际创建分支(unborn HEAD 下 rev-parse 失败 → currentBranch=null
      // → checkout -b 被跳过——分支列表应保持为空)
      const branches = execFileSync('git', ['branch', '--list'], { cwd: dir, encoding: 'utf8' });
      if (branches.includes('change/empty-repo')) {
        throw new Error('空仓库警告后仍创建了 change/empty-repo 分支: ' + branches);
      }
      // 子断言 ②:BRANCH 输出不得声称分支已创建(修复前输出 'BRANCH: change/empty-repo'
      // 但分支实际未创建——声称与行为矛盾,此处应 RED)
      assertNotOut(res, 'BRANCH: change/empty-repo');
    },
  },

  // 124: M3 旧兼容——旧 change(enter 机制未激活)handoff 缺 redEvidence 仍 WARN 渐进(不升级)
  {
    name: '124 subagent-execute exit 兼容：旧 change handoff 缺 redEvidence 仍 WARN（M3 旧兼容）',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence.execute = { summary: 'executed' };
      const handoff = handoffFor(['T01']);
      delete handoff.T01.result.redEvidence;
      st.evidence['subagent-execute'] = { summary: 'delegated', handoffRequest: { T01: { taskId: 'T01' } }, handoffResult: handoff };
      writeState(dir, st); // 无 enteredNodes(旧 change)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF WARN');
    },
  },

  // 125: R1——新 change(newChange:true)review 处置标记缺失 → BLOCKED(旧 change WARN 保留)；
  // 并内扩 Major 延期待裁决门禁三态+一反例：无用户裁决 BLOCK / 同段或文末裁决（由 [升级]
  // 承接）放行 / Minor [转待办] 不受影响 / 有裁决但缺 [升级] 承接仍 BLOCK。
  {
    name: '125 review exit BLOCKED：新 change 处置标记缺失 + Major 延期待裁决（R1）',
    run: (dir) => {
      const st = baseState('review');
      st.evidence.review = { summary: 'reviewed' };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'review'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题A**: 某处存在一个需要记录的问题描述,但未给出任何处置结论\n\n## 结论\n\n通过\n');
      const res = runGuard(['exit', 'review'], dir);
      assertExit(res, 1);
      assertOut(res, '处置状态标记');
      // 子断言:四要素字段行(Symptom/Source/Consequence/Remedy)不误判为发现条目——
      // 执行者按 brooks 输出格式书写(带处置标记的条目)应正常通过
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题 **[已修]**\n  - **Symptom**: 具体现象\n  - **Source**: 某书某节\n  - **Consequence**: 若不修会怎样\n  - **Remedy**: 怎么改\n\n## 结论\n\n通过\n');
      const resOk = runGuard(['exit', 'review'], dir);
      assertExit(resOk, 0);
      assertOut(resOk, 'ALL CHECKS PASSED');
      // 子断言:字段豁免必须精确匹配完整标签(允许尾冒号)——"Source maps expose paths"
      // 这类以 Source 开头的真实发现标题不得被误豁免(修复前前缀匹配会跳过其处置校验)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **Source maps expose paths**: 某处泄露文件路径,未给出任何处置结论\n\n## 结论\n\n通过\n');
      const resSource = runGuard(['exit', 'review'], dir);
      assertExit(resSource, 1);
      assertOut(resSource, '处置状态标记');
      // 负例对照:完整标签行(Symptom:/Source:)仍豁免(字段行不是发现条目)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题C**: 某处问题 **[已修]**\n  - **Symptom**: 现象\n  - **Source**: 某书\n\n## 结论\n\n通过\n');
      const resOk2 = runGuard(['exit', 'review'], dir);
      assertExit(resOk2, 0);
      assertOut(resOk2, 'ALL CHECKS PASSED');
      // 子断言:Major [转待办] 属用户决策点——无用户裁决记录 → BLOCKED(修复前放行 = RED)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F1 · 未裁决的延期**：某处问题 [转待办]\n\n## 结论\n\n通过\n');
      const resMajor = runGuard(['exit', 'review'], dir);
      assertExit(resMajor, 1);
      assertOut(resMajor, 'BLOCKED');
      assertOut(resMajor, 'Major');
      assertOut(resMajor, '用户裁决');
      // 子断言:同段用户裁决 + [升级] 承接 → 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F2 · 已裁决的延期**：某处问题 [升级] [转待办]（用户裁决：接受延期，下一 change 首修）\n\n## 结论\n\n通过\n');
      const resAdjudicated = runGuard(['exit', 'review'], dir);
      assertExit(resAdjudicated, 0);
      assertOut(resAdjudicated, 'ALL CHECKS PASSED');
      assertNotOut(resAdjudicated, '用户裁决');
      // 子断言:Minor [转待办] 不受影响 → 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-1 · 小项**：某处小问题 [转待办]\n\n## 结论\n\n通过\n');
      const resMinor = runGuard(['exit', 'review'], dir);
      assertExit(resMinor, 0);
      assertOut(resMinor, 'ALL CHECKS PASSED');
      // 子断言:文末用户裁决 + 指向该条目 + [升级] 承接 → 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F3 · 文末裁决的延期**：某处问题 [升级] [转待办]\n\n## 用户裁决\n\n- 用户裁决：接受延期 —— 发现 F3（文末裁决的延期）：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resTail = runGuard(['exit', 'review'], dir);
      assertExit(resTail, 0);
      assertOut(resTail, 'ALL CHECKS PASSED');
      // 子断言:尾部裁决段落引用条目整行（引用块）时不得被误判为条目自身段落 → 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F5 · 引用条目行的尾部裁决**：某处问题 [升级] [转待办]\n\n## 用户裁决\n\n> - **F5 · 引用条目行的尾部裁决**：某处问题 [升级] [转待办]\n> 用户裁决：接受延期 —— 发现 F5：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resQuotedTail = runGuard(['exit', 'review'], dir);
      assertExit(resQuotedTail, 0);
      assertOut(resQuotedTail, 'ALL CHECKS PASSED');
      // 子断言:有用户裁决但缺 [升级] 承接 → 仍 BLOCKED（不因裁决在文末就跳过承接校验）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F4 · 无升级承接**：某处问题 [转待办]\n\n## 用户裁决\n\n- 用户裁决：接受延期 —— 发现 F4（无升级承接）：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resNoEscalation = runGuard(['exit', 'review'], dir);
      assertExit(resNoEscalation, 1);
      assertOut(resNoEscalation, 'BLOCKED');
      assertOut(resNoEscalation, 'Major');
      assertOut(resNoEscalation, '用户裁决');
      // 子断言:Minor 条目正文引用 [Major] 标签字样（自身 [转待办]）→ 放行——严重度/处置
      // 以条目自身标题/行首为准，不做整块标签扫描（修复前误判 Major 并触发延期门禁 = RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n- **m-2 · 引用 Major 的小项**：本条与 [Major] F1 项不同，是独立问题 [转待办]\n\n## 结论\n\n通过\n');
      const resCited = runGuard(['exit', 'review'], dir);
      assertExit(resCited, 0);
      assertOut(resCited, 'ALL CHECKS PASSED');
      assertNotOut(resCited, 'BLOCKED');
      // 子断言:Major 条目自身处置为 [已修]，续行正文引用他条 [转待办] → 放行——
      // 延期门禁只看该条目自身标题/行首的处置标记，不做整块扫描
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **[Major] F9 · 已修项引用他条**：某处问题 [已修]\n  （续行仅引用他条的处置去向 [转待办]，非本条处置）\n\n## 结论\n\n通过\n');
      const resQuotedDisposition = runGuard(['exit', 'review'], dir);
      assertExit(resQuotedDisposition, 0);
      assertOut(resQuotedDisposition, 'ALL CHECKS PASSED');
      assertNotOut(resQuotedDisposition, 'BLOCKED');
      // 子断言:有序 Major 标签条目缺任何处置标记 → BLOCKED（修复前有序条目被跳过 = RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n1. **[Major] F6 · 有序无处置**：某处问题，未给出任何处置结论，描述足够长以避免内容不足\n\n## 结论\n\n通过\n');
      const resOrderedMissing = runGuard(['exit', 'review'], dir);
      assertExit(resOrderedMissing, 1);
      assertOut(resOrderedMissing, '处置状态标记');
      // 子断言:有序 Major [转待办] 无用户裁决 → BLOCKED（Major 延期门禁对有序条目同口径）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n1. **F7 · 有序未裁决的延期**：某处问题 [转待办]\n\n## 结论\n\n通过\n');
      const resOrderedDeferred = runGuard(['exit', 'review'], dir);
      assertExit(resOrderedDeferred, 1);
      assertOut(resOrderedDeferred, 'Major');
      assertOut(resOrderedDeferred, '用户裁决');
      // 子断言:有序 Major [升级] [转待办] + 同段用户裁决（[升级] 承接）→ 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n1. **F8 · 有序已裁决的延期**：某处问题 [升级] [转待办]（用户裁决：接受延期，下一 change 首修）\n\n## 结论\n\n通过\n');
      const resOrderedAdjudicated = runGuard(['exit', 'review'], dir);
      assertExit(resOrderedAdjudicated, 0);
      assertOut(resOrderedAdjudicated, 'ALL CHECKS PASSED');
      assertNotOut(resOrderedAdjudicated, '用户裁决');
      // 子断言:中间位置的独立裁决段落（不与条目同段、也不在文末）——指向该条目且含
      // [升级] 承接 → 放行。实现按独立段落匹配，位置不限；文档须写明这一合法形态。
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Major\n\n'
        + '- **F10 · 中段裁决的延期**：某处问题 [升级] [转待办]\n\n'
        + '- 用户裁决：接受延期 —— 发现 F10（中段裁决的延期）：下一 change 首修。\n\n'
        + '### Minor\n\n- **m-4 · 小项**：另一个独立问题 [已修]\n\n## 结论\n\n通过\n');
      const resMidParagraph = runGuard(['exit', 'review'], dir);
      assertExit(resMidParagraph, 0);
      assertOut(resMidParagraph, 'ALL CHECKS PASSED');
      // 子断言:文档口径与实现对齐——review SKILL 须写明「单独段落（指向条目 + [升级] 承接）」
      // 也是合法裁决位置，避免文档只写「同段或文末」而收窄实现语义（文档未同步 = RED）。
      const reviewSkillText = fs.readFileSync(
        path.join(SCRIPTS_DIR, '..', '..', 'flow-comet-review', 'SKILL.md'), 'utf8');
      if (!reviewSkillText.includes('单独段落') || !reviewSkillText.includes('指向') || !reviewSkillText.includes('[升级]')) {
        throw new Error('flow-comet-review/SKILL.md 未写明「单独段落（指向条目 + [升级] 承接）」合法');
      }
    },
  },

  // 126: R1——新 change builtin 缓存证据缺失 → BLOCKED
  {
    name: '126 execute exit BLOCKED：新 change builtin 缓存证据缺失（R1）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbrooks-lint 不可用,builtin-quickcheck',
        sixDim: '## 6 维自查\n\n- 功能: 通过\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '缓存');
      // 子断言:拦截消息须含关键词引导(声明级校验的执行者体验——真机回归实证:语义完整但
      // 缺关键词被拦,消息应指明所需关键词,防执行者无从下手)
      assertOut(res, '须含关键词');
    },
  },

  // 127: R1——新 change 波次散文不一致 → BLOCKED。波次段提取的「段尾」判定在此留一格判别夹具 +
  // 一格单变量对照：① 段后紧跟下一段标题、段内无大写 Z（阳性对照，检查本身在场，两态同判）；
  // ② 段内**早于** [P] 行出现大写 Z（机检标记字面量形态）但散文行无 [P] 标记（「抽掉必报」对照：
  // 去掉 [P] 这一个变量 ⇒ 无并行语义行 ⇒ 放行，两态同判）；③ 同 ② 的夹具补回 [P] 标记 ⇒ 段体
  // 若在段内首个大写 Z 处提前收尾，该 [P] 行整行漏扫 ⇒ 本应 BLOCK 却静默放过（③ 即该形态的
  // 常驻回归锚）。段即文末的第二形态见下一场景（同判据、另一段尾分支，独立成景以便单轮同时可见）。
  // 两格夹具各自带「形态前提」断言（Z 早于 [P] 行）——形态漂移会让锚静默退化成假绿。
  {
    name: '127 plan exit BLOCKED：新 change 波次散文不一致（R1；段内大写 Z 早于 [P] 行形态）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'planned' };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const planTask = (text) => writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', text);
      const taskT01 = '<task id="T01"><action>a</action><write_files>f</write_files><verify>v</verify><done>d</done></task>\n';
      // 判别句式锚（非裸子串）：拦因句 + 判据分支，抽掉该句即红
      const waveBlocked = /波次散文标记任务为并行（\[P\]）但任务无 parallel="true"/;
      // 大写 Z 说明行：段内早于 [P] 行，且自身不含并行语义词（避免截断态/完整态的行筛选差异）
      const waveZNote = '- 机检标记形态说明（ZERO-LOGIC-CHANGE-OK）';
      // ① 段后有下一段标题、段内无 Z → BLOCK（阳性对照：两态同判）
      planTask('# TASK\n\n## 波次划分\n\nWave 1 (parallel): T01[P]\n\n## 任务清单\n\n' + taskT01);
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 1);
      assertOutMatches(res, waveBlocked, '波次散文不一致');
      // 段内大写 Z 说明行 + 散文行共用夹具（散文行的 [P] 标记为唯一变量）：② 不带 [P]（抽掉必报
      // 对照）、③ 带 [P]（判别夹具）。形态自证：大写 Z 必须**早于** [P] 行——若 Z 排在 [P] 行之后，
      // 段体截断点落在该行之后、该行仍会被扫描，本族断言在两种写法下都成立（假绿 ⇒ 零判别力）。
      const zWaveFixture = (marker) => '# TASK\n\n## 波次划分\n\n' + waveZNote + '\n\nWave 1 (parallel): T01' + marker + '\n\n## 任务清单\n\n' + taskT01;
      assertTrue(zWaveFixture('[P]').indexOf(waveZNote) < zWaveFixture('[P]').indexOf('T01[P]'),
        '夹具形态前提不成立：大写 Z 说明行须早于 [P] 行，否则段尾截断不影响该行扫描（锚零判别力）');
      // ② 抽掉必报自证（单变量对照）：段内大写 Z 说明行在场、散文行无 [P] 标记 → 放行
      planTask(zWaveFixture(''));
      const resNoMarker = runGuard(['exit', 'plan'], dir);
      assertExit(resNoMarker, 0);
      assertNotOut(resNoMarker, 'BLOCKED');
      assertOut(resNoMarker, 'ALL CHECKS PASSED');
      // ③ 同一夹具补回散文行的 [P] 标记（唯一变量）→ 段内大写 Z 之后的 [P] 行不得漏扫 ⇒ BLOCK
      planTask(zWaveFixture('[P]'));
      const resZ = runGuard(['exit', 'plan'], dir);
      assertExit(resZ, 1);
      assertOutMatches(resZ, waveBlocked, '段内大写 Z 之后的 [P] 行漏扫');
    },
  },

  // 128: R1——新 change 越权委托(KI-10)→ BLOCKED
  {
    name: '128 execute exit BLOCKED：新 change 越权委托（R1）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent()); // 满足 M2
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) }; // 满足越俎代庖,触发 KI-10 越权委托
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '越权');

      // ===== M-02 request 时刻归属门禁（AC-1/AC-2/AC-3 的 L1 面）=====
      // 夹具前提：新 change 驻留 execute + 本节点技能声明标记在场（否则先被技能声明门 BLOCK，
      // 测不到归属门禁本身）；协议副本由运行器放入 <dir>/reference/ 并显式指向（env 优先级）。
      const reqEnv = { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) };
      const reqStatePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/execute-flow-comet-dev.json',
        JSON.stringify({ node: 'execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const pendingParallelTask =
        '<task id="P-M02" parallel="true" status="pending"><action>实现 P-M02</action><write_files>src/p-m02.mjs</write_files><verify>node --check src/p-m02.mjs</verify></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + pendingParallelTask);
      // ① 新 change 错误节点 pending 并行 request → BLOCK + state 字节零改写 + 不落请求记录 + 恢复指引
      const reqState = baseState('execute');
      reqState.newChange = true;
      reqState.enteredNodes = ['execute'];
      writeState(dir, reqState);
      const beforeReqBytes = fs.readFileSync(reqStatePath, 'utf8');
      const resWrongNode = runHandoff(['request', 'P-M02', 'parallel fix slice'], dir, reqEnv);
      assertExit(resWrongNode, 1);
      assertOut(resWrongNode, 'BLOCKED: 任务 P-M02（并行 pending）应归属节点 subagent-execute');
      assertOut(resWrongNode, 'workflow-state next');
      assertOut(resWrongNode, 'entry subagent-execute');
      assertOut(resWrongNode, '本次请求未写入 state');
      if (fs.readFileSync(reqStatePath, 'utf8') !== beforeReqBytes) {
        throw new Error('M-02 BLOCK 必须 state 字节零改写');
      }
      const stAfterBlock = readScenarioState(dir);
      const reqsAfterBlock = stAfterBlock.evidence?.['subagent-execute']?.handoffRequests ?? {};
      if (reqsAfterBlock['P-M02']) {
        throw new Error('M-02 BLOCK 不得落 handoffRequests: ' + JSON.stringify(reqsAfterBlock));
      }
      // ② 旧 change 同构造 → 可见 WARN + 照常落库（AC-3 渐进兼容）
      writeState(dir, { ...baseState('execute'), enteredNodes: ['execute'] });
      const resOldChange = runHandoff(['request', 'P-M02', 'parallel fix slice'], dir, reqEnv);
      assertExit(resOldChange, 0);
      assertOut(resOldChange, 'WARN: 任务 P-M02（并行 pending）应归属节点 subagent-execute');
      assertOut(resOldChange, '旧 change 渐进不阻断');
      assertOut(resOldChange, 'HANDOFF REQUEST: P-M02');
      const stOldChange = readScenarioState(dir);
      if (!stOldChange.evidence?.['subagent-execute']?.handoffRequests?.['P-M02']) {
        throw new Error('旧 change 错误节点请求应照常落库（AC-3），实际 ' + JSON.stringify(stOldChange.evidence));
      }
      // ③ pending 并行任务依赖未满足 → 当前不可委托。恢复指引必须以 next 实际输出为准：
      // next 对依赖未满足的并行任务按串行消化输出 execute——指引不得再固定指向
      // entry subagent-execute（否则按指引进入会被 currentNode 门禁拦成死路）。
      writeIntakeArtifacts(dir);
      const unmetDepsTask =
        '<task id="S-M01" parallel="false" status="pending"><action>实现 S-M01</action><write_files>src/s-m01.mjs</write_files><verify>node --check src/s-m01.mjs</verify></task>\n' +
        '<task id="P-M03" parallel="true" status="pending"><action>实现 P-M03</action><write_files>src/p-m03.mjs</write_files><verify>node --check src/p-m03.mjs</verify><depends_on>S-M01</depends_on></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + unmetDepsTask);
      const unmetState = baseState('execute');
      unmetState.newChange = true;
      unmetState.enteredNodes = ['execute'];
      unmetState.completedNodes = ['open', 'design', 'plan'];
      unmetState.evidence = { plan: { summary: 'plan done' } };
      writeState(dir, unmetState);
      const unmetBytesBefore = fs.readFileSync(reqStatePath, 'utf8');
      const resUnmet = runHandoff(['request', 'P-M03', 'parallel slice with unmet deps'], dir, reqEnv);
      assertExit(resUnmet, 1);
      assertOut(resUnmet, 'BLOCKED: 任务 P-M03（并行 pending）当前不可委托：依赖未满足');
      assertOut(resUnmet, '未完成: S-M01');
      assertOut(resUnmet, '原始 currentNode=execute');
      assertOut(resUnmet, 'workflow-state next');
      assertOut(resUnmet, '按输出的 NODE 进入');
      assertOut(resUnmet, '若输出 execute 表示依赖未满足');
      assertOut(resUnmet, '待任务变为可委托');
      // 不得固定指引 next 不会输出的节点（进入即死路的反锚）
      assertNotOut(resUnmet, 'entry subagent-execute');
      assertNotOut(resUnmet, 'HANDOFF REQUEST');
      if (fs.readFileSync(reqStatePath, 'utf8') !== unmetBytesBefore) {
        throw new Error('依赖未满足 BLOCK 必须 state 字节零改写');
      }
      const stUnmet = readScenarioState(dir);
      if (stUnmet.evidence?.['subagent-execute']?.handoffRequests?.['P-M03']) {
        throw new Error('依赖未满足 BLOCK 不得落 handoffRequests: ' + JSON.stringify(stUnmet.evidence));
      }
      // 同构真实链路：next 对当前 TASK 实际输出 execute（依赖未满足/串行消化），与指引条件分支一致
      const resUnmetNext = runStateWithProtocol(dir, ['next']);
      assertExit(resUnmetNext, 0);
      if (!/^NODE: execute$/m.test(resUnmetNext.output)) {
        throw new Error('依赖未满足时 next 应输出 execute（指引一致性锚）：\n' + resUnmetNext.output);
      }
      if (readScenarioState(dir).currentNode !== 'execute') {
        throw new Error('依赖未满足时 next 应把工作归属留在 execute: ' + JSON.stringify(readScenarioState(dir).currentNode));
      }
      // 旧 change 同形态 → 可见 WARN + 照常落库（渐进兼容，不因依赖未满足而卡死）
      const oldUnmetState = { ...unmetState };
      delete oldUnmetState.newChange;
      writeState(dir, oldUnmetState);
      const resUnmetOld = runHandoff(['request', 'P-M03', 'old change unmet deps'], dir, reqEnv);
      assertExit(resUnmetOld, 0);
      assertOut(resUnmetOld, 'WARN: 任务 P-M03（并行 pending）当前不可委托：依赖未满足');
      assertOut(resUnmetOld, '旧 change 渐进不阻断');
      assertOut(resUnmetOld, 'HANDOFF REQUEST: P-M03');
    },
  },

  // 129: R2——新 change 未 entry 直接 exit → BLOCKED(旧 change ENTER WARN 保留)
  {
    name: '129 execute exit BLOCKED：新 change 未 entry 直接 exit（R2）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'entry');
    },
  },

  // 130: R6——init 写 newChange: true
  {
    name: '130 init 写入 newChange 标记（R6）',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.newChange !== true) throw new Error('init 未写入 newChange: true');
    },
  },

  // 131: R1 旧兼容——旧 change(无 newChange)处置标记缺失仍 WARN；并内扩 Major 延期待裁决
  // 门禁旧 change 渐进面：无用户裁决 → WARN 不 BLOCK（不卡死旧 REVIEW）；有裁决+[升级] → 放行。
  {
    name: '131 review exit 兼容：旧 change 处置标记缺失仍 WARN + Major 延期渐进（R1 旧兼容）',
    run: (dir) => {
      const st = baseState('review');
      st.evidence.review = { summary: 'reviewed' };
      writeState(dir, st); // 无 newChange(旧 change)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题A**: 某处存在一个需要记录的问题描述,但未给出任何处置结论\n\n## 结论\n\n通过\n');
      const res = runGuard(['exit', 'review'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN');
      // 子断言:Major [转待办] 无用户裁决 → 旧 change 渐进 WARN 且不 BLOCK（不卡死旧 REVIEW）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F1 · 未裁决的延期**：某处问题 [转待办]\n\n## 结论\n\n通过\n');
      const resMajor = runGuard(['exit', 'review'], dir);
      assertExit(resMajor, 0);
      assertOut(resMajor, 'REVIEW WARN');
      assertOut(resMajor, 'Major');
      assertOut(resMajor, '用户裁决');
      assertNotOut(resMajor, 'BLOCKED');
      // 子断言:有同段用户裁决 + [升级] 承接 → 无该渐进告警
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F2 · 已裁决的延期**：某处问题 [升级] [转待办]（用户裁决：接受延期）\n\n## 结论\n\n通过\n');
      const resOk = runGuard(['exit', 'review'], dir);
      assertExit(resOk, 0);
      assertNotOut(resOk, '用户裁决');
      assertOut(resOk, 'ALL CHECKS PASSED');
      // 子断言:有序 Major [转待办] 无用户裁决 → 旧 change 渐进 WARN 不 BLOCK（有序同口径）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n1. **F3 · 有序未裁决的延期**：某处问题 [转待办]\n\n## 结论\n\n通过\n');
      const resOrderedMajor = runGuard(['exit', 'review'], dir);
      assertExit(resOrderedMajor, 0);
      assertOut(resOrderedMajor, 'REVIEW WARN');
      assertOut(resOrderedMajor, '用户裁决');
      assertNotOut(resOrderedMajor, 'BLOCKED');
    },
  },

  // 132: R3——exit 校验对 auto 声明标记输出 WARN 提示
  {
    name: '132 exit 对 auto 声明标记输出提示（R3）',
    run: (dir) => {
      // 技能加载前置门对齐：record 无声明标记在新 change 下 BLOCK——本场景测 exit 的
      // auto 标记提示，改用旧 change(无 newChange)构造，保留 record 通过 + exit auto 提示
      // 的测试意图（新 change 无声明记录由前置门场景覆盖）。
      const st = baseState('open');
      writeState(dir, st);
      assertExit(runGuard(['entry', 'open'], dir), 0);
      assertExit(runStateWithProtocol(dir, ['record', 'open', '{"summary":"intake"}']), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\nx\n\n## 验收准则（AC）\n- Given x When y Then z');
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z', auto: true }, null, 2) + '\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 0);
      assertOut(res, 'auto');
    },
  },

  // 133: R4——空退出豁免 exit 输出审计提示
  {
    name: '133 execute exit 空退出豁免输出审计提示（R4）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'empty', emptyExitApproved: true };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="P01" parallel="true" status="pending"><action>p</action><write_files>a</write_files><verify>t</verify><done>d</done></task>\n');
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'EMPTY-EXIT');
    },
  },

  // 134: G16——M2 BLOCKED 消息含恢复指引
  {
    name: '134 execute exit BLOCKED 消息含恢复指引（G16）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'T02']) };
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE_TWO);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir); // T02 缺 SUMMARY
      assertExit(res, 1);
      assertOut(res, '恢复:');
    },
  },

  // 135: R1 旧格式兼容分支——自检方法段含 brooks-review 声明但缺 `## 自检方法` 段标题(旧格式形态):
  // 新 change 全文声明方法但缺段标题 → BLOCKED(强制自检方法段,transition 规则 L2454-2455);
  // 旧 change 同构造 → BROOKS-LINT WARN 渐进(兼容保留,L2457)
  {
    name: '135 execute exit BLOCKED：新 change 自检方法段缺标题（R1 旧格式兼容分支）',
    run: (dir) => {
      // ① 新 change(newChange:true):T01-SUMMARY 含 brooks-review 声明(6 维自查+方法行)但缺
      // `## 自检方法` 段标题(旧格式) → BLOCKED(自检方法段强制;恢复:补 ## 自检方法 段标题)
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0); // R2: 新 change 须先 entry
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({ method: 'brooks-review' }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '自检方法');
      // ② 旧 change(无 newChange)同构造 → BROOKS-LINT WARN 渐进(兼容保留,不阻断)
      const stOld = baseState('execute');
      stOld.evidence.execute = { summary: 'executed' };
      stOld.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, stOld);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({ method: 'brooks-review' }));
      const resOld = runGuard(['exit', 'execute'], dir);
      assertExit(resOld, 0);
      assertOut(resOld, 'BROOKS-LINT WARN');
    },
  },

  // 136: verifyFailures 按 change 隔离——切换 change 后计数独立(串扰修复:全局计数会让
  // change B 继承 change A 的失败次数,误触发"超限需用户决策");旧顶层字段
  // (verifyFailures)迁移并入当前 change 计数(旧 state 兼容)
  {
    name: '136 verifyFailures 按 change 隔离:切换计数独立 + 旧字段迁移',
    run: (dir) => {
      // ① 旧字段迁移:旧 state(顶层 verifyFailures=2)→ verify-fail 并入当前 change(2+1=3)不超限
      const st = baseState('verify');
      st.verifyFailures = 2;
      writeState(dir, st);
      // 场景内 ch/ch2 目录(select 要求 change 目录存在)
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const r1 = runStateWithProtocol(dir, ['verify-fail']);
      assertExit(r1, 0);
      assertOut(r1, 'VERIFY-FAIL: 3/3');
      const stAfter = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!stAfter.verifyFailuresByChange || stAfter.verifyFailuresByChange['ch'] !== 3) {
        throw new Error('旧字段未迁移并入 change 计数: ' + JSON.stringify(stAfter.verifyFailuresByChange));
      }
      if (stAfter.verifyFailures !== undefined) {
        throw new Error('旧顶层字段应已清除: ' + JSON.stringify(stAfter.verifyFailures));
      }
      // ② 同 change 第 4 次 → BLOCK(3 >= 3)
      const r2 = runStateWithProtocol(dir, ['verify-fail']);
      assertExit(r2, 1);
      assertOut(r2, '超限');
      // ③ 切换 change:select ch2 → 计数独立(若实现仍用全局计数 3,此处会误 BLOCK = RED)
      writeFile(dir, '.specs/ch2/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const r3 = runStateWithProtocol(dir, ['select', 'ch2']);
      assertExit(r3, 0);
      const r4 = runStateWithProtocol(dir, ['verify-fail']);
      assertExit(r4, 0);
      assertOut(r4, 'VERIFY-FAIL: 1/3');
      // ④ ch2 独立计数:连续 3 次后第 4 次 BLOCK
      assertExit(runStateWithProtocol(dir, ['verify-fail']), 0);
      assertExit(runStateWithProtocol(dir, ['verify-fail']), 0);
      const r7 = runStateWithProtocol(dir, ['verify-fail']);
      assertExit(r7, 1);
      assertOut(r7, '超限');
      // ⑤ 切回 ch:原计数保留(3 → 仍超限,不串扰不回零)
      const r8 = runStateWithProtocol(dir, ['select', 'ch']);
      assertExit(r8, 0);
      const r9 = runStateWithProtocol(dir, ['verify-fail']);
      assertExit(r9, 1);
      assertOut(r9, '超限');
      // ⑥ 计数隔离扩展（AC-5）：verify 失败计数与 Fix 归位轮次各自独立——verify-fail 只动
      // verifyFailuresByChange，绝不触碰 fixRoundsByChange（旧实现只读 verify 计数已通过；
      // 若未来把二者混用 / 共用容器，本条按 change 逐项断言变红）。
      const stIsolated = readScenarioState(dir);
      stIsolated.fixRoundsByChange = { ch: 2, ch2: 1 };
      writeState(dir, stIsolated);
      writeFile(dir, '.specs/ch3/CHANGE.md', '# CHANGE\n## Why\nx\n');
      assertExit(runStateWithProtocol(dir, ['select', 'ch3']), 0);
      const stCh3Before = readScenarioState(dir);
      stCh3Before.fixRoundsByChange = { ch: 2, ch2: 1, ch3: 5 };
      writeState(dir, stCh3Before);
      const r10 = runStateWithProtocol(dir, ['verify-fail']);
      assertExit(r10, 0);
      assertOut(r10, 'VERIFY-FAIL: 1/3');
      const stCh3After = readScenarioState(dir);
      if (stCh3After.verifyFailuresByChange?.ch3 !== 1) {
        throw new Error('verify-fail 应按 change 递增 verify 计数，实际 '
          + JSON.stringify(stCh3After.verifyFailuresByChange));
      }
      if (JSON.stringify(stCh3After.fixRoundsByChange) !== JSON.stringify({ ch: 2, ch2: 1, ch3: 5 })) {
        throw new Error('verify 失败计数与 Fix 轮次计数不得串扰（fixRoundsByChange 被改写）: '
          + JSON.stringify(stCh3After.fixRoundsByChange));
      }
    },
  },

  // 137: next 漂移校正不得推走"已记录证据但未 exit"的进行中节点——exit 被拦截(如
  // 内容级 BLOCKED)后执行者跑 next,校正把 currentNode 推到下一节点,被拦截节点无法
  // 重跑(exit 前置 currentNode 校验拦截),advance/select 均不恢复 → 死结(实测教训)。
  // 修复:evidence 存在且节点未 exit → 视为进行中,next 不校正(currentNode 保持原节点)
  {
    name: '137 next 不推走进行中节点:exit 被拦截后重跑路径保留',
    run: (dir) => {
      const st = baseState('review');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      st.evidence.review = { summary: 'reviewed' }; // record 过但 exit 被拦截
      st.newChange = true;
      writeState(dir, st);
      // 前序产物(execute 产物门控需 *-SUMMARY.md)
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\nx\n\n## 验收准则（AC）\n- Given x When y Then z');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\npython\n\n## 决策清单\n- d1: x\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" status="done"><action>x</action><write_files>f</write_files><verify>v</verify></task>\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', '# T01-SUMMARY\n## verify 输出\nx\n## 6 维自查\nx\n## 越界检查\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题A**: 某处问题 **[已修]**\n\n## 结论\n\n通过\n');
      // ① next:进行中节点(evidence 存在且未 exit)不被漂移校正推走(修复前校正到 verify = RED)
      const r1 = runStateWithProtocol(dir, ['next']);
      assertExit(r1, 0);
      assertOut(r1, 'NODE: review');
      assertNotOut(r1, 'NODE: verify');
      // ② exit review 重跑路径保留:缺处置标记 → BLOCKED(新 change),补标记后通过
      assertExit(runGuardWithProtocol(dir, ['entry', 'review']), 0); // 新 change 强制先 entry
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题无处置标记\n\n## 结论\n\n通过\n');
      const rBlock = runGuardWithProtocol(dir, ['exit', 'review']);
      assertExit(rBlock, 1);
      assertOut(rBlock, '处置状态标记');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题 **[已修]**\n\n## 结论\n\n通过\n');
      const rPass = runGuardWithProtocol(dir, ['exit', 'review', '--apply']);
      assertExit(rPass, 0);
      assertOut(rPass, 'ALL CHECKS PASSED');
    },
  },
];
