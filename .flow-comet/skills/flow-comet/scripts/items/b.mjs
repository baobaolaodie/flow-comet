// items/b.mjs — B 组条目（声明机制：skill-load / record / exit 校验）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 组内夹具与条目同址；跨组共用夹具从 a.mjs / k.mjs 取（组文件之间单向，无环）。

import fs from 'fs';
import path from 'path';
import { assertExit, assertNotOut, assertOut, runGuard, runHandoff, runState, writeFile } from '../lib/test-helpers.mjs';
import { CHANGE_ID, readStateFile, writeIntakeArtifacts } from './a.mjs';

export const ENTRIES = [
  // ---------- B. 声明机制（skill-load / record / exit 校验） ----------

  {
    name: 'B1 skill-load：声明标记写入（协议归属）',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      const res = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir);
      assertExit(res, 0);
      assertOut(res, 'SKILL-LOAD: open flow-comet-change');
      const markerPath = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json');
      if (!fs.existsSync(markerPath)) throw new Error('标记文件未生成: ' + markerPath);
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.node !== 'open' || marker.skill !== 'flow-comet-change') {
        throw new Error('标记 node/skill 字段不符: ' + JSON.stringify(marker));
      }
      if (marker.protocol !== '0-change.md') {
        throw new Error('标记 protocol 应为 --prompt 参数的 basename: ' + JSON.stringify(marker.protocol));
      }
      if (typeof marker.at !== 'string' || Number.isNaN(Date.parse(marker.at))) {
        throw new Error('标记缺 ISO 时间戳: ' + JSON.stringify(marker));
      }
    },
  },

  {
    name: 'B2 skill-load：非法参数拒绝且不落标记',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const noArgs = runState(['skill-load'], dir);
      assertExit(noArgs, 1);
      assertOut(noArgs, 'skill-load requires <node> <skill>');
      const badNode = runState(['skill-load', 'bogus', 'flow-comet-change'], dir);
      assertExit(badNode, 1);
      assertOut(badNode, 'skill-load node 非法');
      const badSkill = runState(['skill-load', 'open', 'bad/name'], dir);
      assertExit(badSkill, 1);
      assertOut(badSkill, 'skill-load skill 名非法');
      // --prompt 越界（不在 flow-kit/prompts/ 下）
      const badPrompt = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'reference/workflow-protocol.json'], dir);
      assertExit(badPrompt, 1);
      assertOut(badPrompt, 'skill-load --prompt 路径必须位于 flow-kit/prompts/ 下');
      // 全部拒绝后 .skill-loads/ 不产生任何标记
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      if (fs.existsSync(loadsDir) && fs.readdirSync(loadsDir).length > 0) {
        throw new Error('非法参数不应写入标记: ' + fs.readdirSync(loadsDir).join(', '));
      }
    },
  },

  {
    name: 'B3 record：缺声明标记拦截',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '缺少对应声明标记');
      assertOut(res, 'workflow-state.mjs skill-load open flow-comet-change');
      // 拦截先于写入——evidence 不得落库
      const st = readStateFile(dir);
      if (st.evidence && st.evidence.open) throw new Error('拦截后不应写入 evidence: ' + JSON.stringify(st.evidence.open));
    },
  },

  {
    name: 'B4 record：声明后记录通过',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change'], dir), 0);
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 0);
      assertOut(res, 'EVIDENCE: open');
      const st = readStateFile(dir);
      if (!st.evidence.open || st.evidence.open.summary !== 'done') {
        throw new Error('record 未写入 evidence: ' + JSON.stringify(st.evidence));
      }
    },
  },

  {
    name: 'B5 record：声明时间序自洽拦截',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      // 标记 at 晚于记录时间（手工构造未来时间戳）→ 标记必须先于记录声明
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2999-12-31T00:00:00.000Z' }, null, 2) + '\n');
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '标记必须先于记录声明');
    },
  },

  {
    name: 'B6 record：损坏声明标记 fail-closed',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json', '{oops\n');
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '声明标记损坏');
    },
  },

  {
    name: 'B7 record：委托范围条目豁免（有委托通过 / 无委托拦截）',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev'], dir), 0);
      const payload = JSON.stringify({ summary: 'delegated', completedChecks: ['required-skill:subagent-execute.flow-comet-dev'] });
      // 无委托记录 → 拦截（handoff scope 条目以共用证据库的委托记录为证据）
      const blocked = runState(['record', 'subagent-execute', payload], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, '无委托记录');
      // 委托并回传契约后 → 通过(request 声明边界——新 change 强制 write_files 来源)
      assertExit(runHandoff(['request', 'T01', 'T01 委托', '--write-files', 'src/t1.mjs'], dir), 0);
      assertExit(runHandoff(['result', 'T01', JSON.stringify({
        commitHash: 'deadbeef',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t1.mjs' },
        redEvidence: { command: 'node --check src/t1.mjs' },
      })], dir), 0);
      const pass = runState(['record', 'subagent-execute', payload], dir);
      assertExit(pass, 0);
      assertOut(pass, 'EVIDENCE: subagent-execute');
    },
  },

  {
    name: 'B8 exit：协议声明标记校验（record 自动补通过 / 手动声明 / 空协议·损坏拦截）',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      writeIntakeArtifacts(dir);
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      // ① M5: record 自动补声明标记 → 出口通过（无需手动 skill-load）
      assertExit(runState(['record', 'open', '{"summary":"intake complete"}'], dir), 0);
      const autoMarker = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json');
      if (!fs.existsSync(autoMarker)) throw new Error('record 自动声明标记缺失: open-flow-comet-change.json');
      assertExit(runGuard(['entry', 'open'], dir), 0);
      const rAuto = runGuard(['exit', 'open'], dir);
      assertExit(rAuto, 0);
      assertOut(rAuto, 'ALL CHECKS PASSED');
      assertNotOut(rAuto, 'BLOCKED');
      // ② 手动 skill-load --prompt（protocol = basename）覆盖自动标记 → 出口通过
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      const rPass = runGuard(['exit', 'open'], dir);
      assertExit(rPass, 0);
      assertOut(rPass, 'ALL CHECKS PASSED');
      assertNotOut(rPass, 'BLOCKED');
      // ③ 未传 --prompt → 标记 protocol = null → 拦截（fail-closed；open 两个 requiredSkillCalls 均覆盖为 null）
      assertExit(runState(['skill-load', 'open', 'flow-comet-change'], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-requirement'], dir), 0);
      const rNull = runGuard(['exit', 'open'], dir);
      assertExit(rNull, 1);
      assertOut(rNull, 'exit 缺协议声明标记');
      // ④ 损坏标记（protocol 非本节点协议集）→ 拦截（fail-closed）
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '9-other.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const rCorrupt = runGuard(['exit', 'open'], dir);
      assertExit(rCorrupt, 1);
      assertOut(rCorrupt, 'exit 缺协议声明标记');
    },
  },

  {
    name: 'B9 旧项目兼容：record 自动补声明后照常通过',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir), 0);
      // 旧格式记录：completedChecks 无 required-skill 条目 → 不校验标记,通过
      const rA = runState(['record', 'open', JSON.stringify({ summary: 'legacy', completedChecks: ['unit-tests'] })], dir);
      assertExit(rA, 0);
      assertOut(rA, 'EVIDENCE: open');
      // 无 completedChecks 的纯 summary 记录 → 通过（record 自动补声明标记）
      assertExit(runState(['record', 'open', JSON.stringify({ summary: 'plain' })], dir), 0);
      // 出口：record 已自动补标记 → 无兼容警告,正常通过
      writeIntakeArtifacts(dir);
      assertExit(runGuard(['entry', 'open'], dir), 0);
      const rC = runGuard(['exit', 'open'], dir);
      assertExit(rC, 0);
      assertOut(rC, 'ALL CHECKS PASSED');
      assertNotOut(rC, 'SKILL-LOAD WARN');
    },
  },

];
