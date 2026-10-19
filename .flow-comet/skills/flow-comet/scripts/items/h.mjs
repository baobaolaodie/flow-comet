// items/h.mjs — H 组条目（verify 与归档）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 跨组共用夹具在 lib/system-fixtures.mjs（组文件只承载 ENTRIES 数据与组内私有夹具，组文件之间零 import）。

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { assertExit, assertNotOut, assertOut, runGuard, runHandoff, runState, writeFile, writeState } from '../lib/test-helpers.mjs';
import { CHANGE_ID, assertNodeLine, assertNotNodeLine, completeFixTaskAndRecord, driveThroughDesign, execSummaryFixture, fixBatchReviewDoc, fixBatchTaskText, fullContract, parseStatusOutput, readStateBytes, readStateFile, writeIntakeArtifacts } from '../lib/system-fixtures.mjs';

// 同夹具的「段内大写 Z 早于方法名」变体（真实机检标记形态）：6 维自查段体首行是含大写 Z 的机检
// 标记说明，方法声明行在其后。段尾判定若把大写 Z 当串尾（惰性段体在段内首个 Z 处提前收尾），
// 方法声明被截掉 ⇒ execute 家族出口误判「6 维自查未声明自检方法」而 BLOCK。
// 夹具前提不成立（段标题形态变化）即抛错——不让变体静默退化成与基线逐字节相同的形态。
function execSummaryWithMachineMarker(taskId) {
  const base = execSummaryFixture(taskId);
  const sixDimHead = '## 6 维自查\n\n';
  if (!base.includes(sixDimHead)) {
    throw new Error('夹具前提失效：SUMMARY 夹具缺 6 维自查段标题形态 ' + JSON.stringify(sixDimHead));
  }
  return base.replace(sixDimHead,
    sixDimHead + '> 本任务 diff 属零逻辑改动（机检标记 ZERO-LOGIC-CHANGE-OK），按协议执行 PR Review。\n\n');
}

// ---------- 受控重入真实命令链路夹具（H5~H8 共用） ----------

// archive 已 entry 形态的完成集（built-in 协议：open → verify 全部完成；archive 已进入未出口）
const ARCHIVE_ENTRY_COMPLETED_NODES = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify'];
// 前驱交集结果：目标 verify 的前驱 = 上述完成集去掉 verify 自身（按协议顺序）
const REENTRY_VERIFY_PREDECESSORS = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];

// 重入前夹具：临时 runRoot 内 init → archive 已 entry 形态（前序节点全部完成、activeChange 在场、
// status=running、.specs/<id>/ 未移动、TASK.md 在场）。协议由 runState/runGuard 显式注入
// FLOW_COMET_PROTOCOL（门禁不得静默跳过）。
function seedArchiveEntryState(root, changeId = CHANGE_ID) {
  assertExit(runState(['init', changeId, '--init-skip'], root), 0);
  assertExit(runState(['skill-load', 'archive', 'flow-comet-integration', '--prompt', 'flow-kit/prompts/7-integration.md'], root), 0);
  writeFile(root, '.specs/' + changeId + '/TASK.md',
    '# TASK\n\n<task id="T01" parallel="false" status="done"><action>初版实现</action>' +
    '<write_files>src/t01.mjs</write_files><verify>node --check src/t01.mjs</verify><done>落地</done></task>\n');
  const st = readStateFile(root);
  st.currentNode = 'archive';
  st.completedNodes = ARCHIVE_ENTRY_COMPLETED_NODES.slice();
  st.status = 'running';
  st.enteredNodes = ARCHIVE_ENTRY_COMPLETED_NODES.concat('archive');
  writeState(root, st);
  assertExit(runState(['record', 'archive', '{"summary":"archived"}'], root), 0);
  assertExit(runGuard(['entry', 'archive'], root), 0);
}

// 备份目录/文件读取（.specs/<id>/.reentry-backups/）
function reentryBackupDir(root, changeId = CHANGE_ID) {
  return path.join(root, '.specs', changeId, '.reentry-backups');
}

function reentryBackupFiles(root, changeId = CHANGE_ID) {
  return fs.existsSync(reentryBackupDir(root, changeId)) ? fs.readdirSync(reentryBackupDir(root, changeId)) : [];
}

// reentry-applied 事件过滤（state.history 追加记录）
function reentryEventsOf(state) {
  return (state.history || []).filter((e) => e && e.event === 'reentry-applied');
}

// 事件 backup 字段 → 实际文件路径（相对 runRoot 的路径或仅文件名两种写法都接受）
function resolveReentryBackupPath(root, changeId, event) {
  if (!event || typeof event.backup !== 'string' || event.backup.trim() === '') return null;
  const raw = event.backup;
  const candidates = path.isAbsolute(raw)
    ? [raw]
    : [path.resolve(root, raw), path.join(reentryBackupDir(root, changeId), path.basename(raw))];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// ---------- 受控计划重校重签（replan）与强制推进留痕真实命令链路夹具（H9~H11 共用） ----------

// 任务集构造：基础串行任务（status 可切）+ 可追加的并行就绪任务（计划外修订用）
// + 可选的同文件跨任务对（第三族：两条串行任务写同一路径——并行形态会先被写写强判族命中，
//   串行拆分才是「同文件跨任务且无依赖路径」的判据面；crossTaskPair='deps' 时补显式 depends_on）。
function replanTaskText(options = {}) {
  const lines = ['# TASK', '',
    '<task id="S01" parallel="false" status="' + (options.s01Status || 'pending') + '">'
    + '<action>实现 S01</action><write_files>src/s01.mjs</write_files>'
    + '<verify>node --check src/s01.mjs</verify></task>'];
  for (const id of options.parallelPending || []) {
    lines.push('<task id="' + id + '" parallel="true" status="pending">'
      + '<action>实现计划外新增的 ' + id + '</action>'
      + '<write_files>src/' + id.toLowerCase() + '.mjs</write_files>'
      + '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify></task>');
  }
  if (options.crossTaskPair) {
    const deps = options.crossTaskPair === 'deps' ? '<depends_on>X1</depends_on>' : '';
    lines.push('<task id="X1" parallel="false" status="pending">'
      + '<action>实现 X1</action><write_files>src/shared-cross.mjs</write_files>'
      + '<verify>node --check src/shared-cross.mjs</verify></task>');
    lines.push('<task id="X2" parallel="false" status="pending">'
      + '<action>实现 X2</action><write_files>src/shared-cross.mjs</write_files>'
      + '<verify>node --check src/shared-cross.mjs</verify>' + deps + '</task>');
  }
  return lines.join('\n') + '\n';
}

// execute 已 entry 的真实链路前奏：#init → open/design 出口 → plan 出口 → 任务集 → record +
// entry execute（entry 真实记录任务集签名）。返回后调用方可修订任务集触发签名不匹配现场。
function seedExecuteEntryState(dir, taskText) {
  driveThroughDesign(dir);
  writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskText);
  assertExit(runState(['skill-load', 'plan', 'flow-comet-plan', '--prompt', 'flow-kit/prompts/3-task.md', '--templates', 'TASK.md'], dir), 0);
  assertExit(runState(['record', 'plan', '{"summary":"plan done"}'], dir), 0);
  assertExit(runGuard(['entry', 'plan'], dir), 0);
  const planExit = runGuard(['exit', 'plan', '--apply'], dir);
  assertExit(planExit, 0);
  assertNodeLine(planExit, 'execute');
  assertExit(runState(['skill-load', 'execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md', '--templates', 'SUMMARY.md'], dir), 0);
  assertExit(runState(['record', 'execute', '{"summary":"implementation recorded"}'], dir), 0);
  assertExit(runGuard(['entry', 'execute'], dir), 0);
}

// 串行 pending 任务的真实委托留证（execute 归属：request + result 契约回传）
function completeSerialTaskWithHandoff(dir, taskId, writeFilesRel) {
  assertExit(runHandoff(['request', taskId, taskId + ' 委托', '--write-files', writeFilesRel], dir), 0);
  assertExit(runHandoff(['result', taskId, fullContract('abcd1234abcd1234abcd1234abcd1234abcd1234', taskId)], dir), 0);
}

// replan 备份清单（.specs/<id>/replan-backups/）
function replanBackupFiles(dir, changeId = CHANGE_ID) {
  const backupDir = path.join(dir, '.specs', changeId, 'replan-backups');
  return fs.existsSync(backupDir) ? fs.readdirSync(backupDir).sort() : [];
}

// replan-applied 事件过滤（轮次按 change 从 history 派生）
function replanEventsOf(state) {
  return (state.history || []).filter((e) => e && e.event === 'replan-applied');
}

// status 输出的 JSON 块解析（命令行尾巴行不进 JSON）

export const ENTRIES = [
  // ---------- H. verify 与归档 ----------

  {
    name: 'H1 verify：验证命令真实执行与超时配置',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'verify', 'flow-comet-integration', '--prompt', 'flow-kit/prompts/7-integration.md'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      assertExit(runState(['record', 'verify', '{"summary":"verified"}'], dir), 0);
      const st = readStateFile(dir);
      st.currentNode = 'verify';
      writeState(dir, st);
      // ① 快速命令 → 出口通过
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      assertExit(runGuard(['entry', 'verify'], dir), 0);
      const pass = runGuard(['exit', 'verify'], dir);
      assertExit(pass, 0);
      assertOut(pass, 'ALL CHECKS PASSED');
      // ② 缺省超时（未设 env）保持大值：耗时命令通过
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "setTimeout(()=>{}, 1500)"\n```\n');
      const defaultTimeout = runGuard(['exit', 'verify'], dir);
      assertExit(defaultTimeout, 0);
      assertOut(defaultTimeout, 'ALL CHECKS PASSED');
      // ③ 环境覆盖生效：小超时 → 超时拦截（不设 env 时同命令走缺省会通过——覆盖被忽略即红）
      const timedOut = runGuard(['exit', 'verify'], dir, { FLOW_COMET_VERIFY_TIMEOUT_MS: '500' });
      // 超时 kill 的 cmd 孙进程（node）孤儿化后短暂存活，其 cwd 锁定场景目录
      // （Windows：父 cmd 被杀、孙进程继续跑完自身定时器）——断言前同步等待其自然退出
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 2000)']);
      assertExit(timedOut, 1);
      assertOut(timedOut, 'BLOCKED: verify 命令失败');
      assertOut(timedOut, 'timeout 500ms');
      // 子断言:失败计数按 change 写入(guard 侧)
      const stTimed = readStateFile(dir);
      if (!stTimed.verifyFailuresByChange || stTimed.verifyFailuresByChange[CHANGE_ID] < 1) {
        throw new Error('exit verify 失败计数未按 change 写入: ' + JSON.stringify(stTimed.verifyFailuresByChange));
      }
      // ④ 无验证命令 → 拦截（严格版要求）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n无验证命令段。\n');
      const noCmd = runGuard(['exit', 'verify'], dir);
      assertExit(noCmd, 1);
      assertOut(noCmd, 'BLOCKED: TEST.md 需声明 ## 验证命令 段');
    },
  },

  {
    name: 'H2 归档：完整流程（遗留清单 + 移动 + 完成态）',
    run: (dir) => {
      assertExit(runState(['init', 'arch-demo'], dir), 0);
      assertExit(runState(['skill-load', 'archive', 'flow-comet-integration', '--prompt', 'flow-kit/prompts/7-integration.md'], dir), 0);
      // 节点推进到归档（模拟前序节点出口已完成的状态——被测机制是归档出口本身）
      const st0 = readStateFile(dir);
      st0.currentNode = 'archive';
      writeState(dir, st0);
      assertExit(runState(['record', 'archive', '{"summary":"archived"}'], dir), 0);
      // ① 未移动（无归档目录）→ 出口拦截（缺归档产物）
      assertExit(runGuard(['entry', 'archive'], dir), 0);
      const blocked = runGuard(['exit', 'archive'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'missing Output Schema artifacts');
      // ② 遗留问题清单（显式无遗留）随工件写入
      writeFile(dir, '.specs/arch-demo/KNOWN-ISSUES.md', '# KNOWN-ISSUES\n\n无遗留问题\n');
      // ③ 移动目录到归档路径（真实归档流程：先移动后出口）
      fs.mkdirSync(path.join(dir, '.specs', 'archive'), { recursive: true });
      fs.renameSync(path.join(dir, '.specs', 'arch-demo'), path.join(dir, '.specs', 'archive', '2026-08-11-arch-demo'));
      if (fs.existsSync(path.join(dir, '.specs', 'arch-demo'))) throw new Error('移动后源目录应不存在');
      if (!fs.existsSync(path.join(dir, '.specs', 'archive', '2026-08-11-arch-demo', 'KNOWN-ISSUES.md'))) {
        throw new Error('遗留问题清单应随工件归档');
      }
      // ④ 出口 --apply → 通过 + 归档完成态（清空活跃项目）
      const pass = runGuard(['exit', 'archive', '--apply'], dir);
      assertExit(pass, 0);
      assertOut(pass, 'ALL CHECKS PASSED');
      const st = readStateFile(dir);
      if (st.activeChange !== null) throw new Error('归档后 activeChange 应为 null: ' + JSON.stringify(st.activeChange));
      if (st.currentNode !== null) throw new Error('归档后 currentNode 应为 null');
      if (st.status !== 'completed') throw new Error('归档后 status 应为 completed');
      const status = runState(['status'], dir);
      assertExit(status, 0);
      assertOut(status, '"status": "no-change"');
    },
  },

  {
    name: 'H3 归档：归档路径声明标记查找',
    run: (dir) => {
      assertExit(runState(['init', 'arch-mk'], dir), 0);
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      writeFile(dir, 'flow-kit/prompts/7-integration.md', '# 阶段 7 · INTEGRATION\n\n## 角色\n\n你是 Integrationer。\n');
      // 遗留清单(协议 required 产物——随目录移动进归档)
      writeFile(dir, '.specs/arch-mk/KNOWN-ISSUES.md', '# KNOWN-ISSUES\n\n无遗留问题\n');
      // 归档前声明标记（open + archive 节点）
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md', '--templates', 'CHANGE.md,REQUIREMENT.md'], dir), 0);
      assertExit(runState(['skill-load', 'archive', 'flow-comet-integration', '--prompt', 'flow-kit/prompts/7-integration.md'], dir), 0);
      // 节点推进到归档（模拟前序节点出口已完成的状态）
      const st0 = readStateFile(dir);
      st0.currentNode = 'archive';
      writeState(dir, st0);
      assertExit(runState(['record', 'archive', '{"summary":"archived"}'], dir), 0);
      // 移动（标记随目录进入归档路径）
      fs.mkdirSync(path.join(dir, '.specs', 'archive'), { recursive: true });
      fs.renameSync(path.join(dir, '.specs', 'arch-mk'), path.join(dir, '.specs', 'archive', '2026-08-11-arch-mk'));
      const markerInArchive = path.join(dir, '.specs', 'archive', '2026-08-11-arch-mk', '.skill-loads', 'archive-flow-comet-integration.json');
      if (!fs.existsSync(markerInArchive)) throw new Error('声明标记应随目录移入归档路径');
      // 出口：标记经归档路径解析命中（活动路径已不存在）→ 通过且无兼容警告
      assertExit(runGuard(['entry', 'archive'], dir), 0);
      const pass = runGuard(['exit', 'archive', '--apply'], dir);
      assertExit(pass, 0);
      assertOut(pass, 'ALL CHECKS PASSED');
      assertNotOut(pass, 'SKILL-LOAD WARN');
      assertNotOut(pass, 'exit 缺协议声明标记');
    },
  },

  {
    name: 'H4 归档:M5 自动补标记写归档路径,不重建活动目录',
    run: (dir) => {
      // 归档顺序(先移目录后 record)下,record archive 的 M5 自动补声明标记应写归档路径
      // (.skill-loads/ 随目录移动),不得重建已归档的活动目录(归档移动语义)
      assertExit(runState(['init', 'arch-m5'], dir), 0);
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      writeFile(dir, 'flow-kit/prompts/7-integration.md', '# 阶段 7 · INTEGRATION\n\n## 角色\n\n你是 Integrationer。\n');
      // 手动 skill-load(活动路径标记,随目录移动进归档)
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md', '--templates', 'CHANGE.md,REQUIREMENT.md'], dir), 0);
      assertExit(runState(['skill-load', 'archive', 'flow-comet-integration', '--prompt', 'flow-kit/prompts/7-integration.md'], dir), 0);
      // 推进到 archive
      const st0 = readStateFile(dir);
      st0.currentNode = 'archive';
      writeState(dir, st0);
      // 移动目录到归档(真实归档流程:先移动后 record/exit)
      fs.mkdirSync(path.join(dir, '.specs', 'archive'), { recursive: true });
      fs.renameSync(path.join(dir, '.specs', 'arch-m5'), path.join(dir, '.specs', 'archive', '2026-08-14-arch-m5'));
      // record archive(移动后)——M5 自动补 archive 声明标记
      const rec = runState(['record', 'archive', '{"summary":"archived"}'], dir);
      assertExit(rec, 0);
      // 断言 1:活动目录不得重建(归档移动语义——M5 不得重建已归档的活动目录)
      if (fs.existsSync(path.join(dir, '.specs', 'arch-m5'))) {
        throw new Error('M5 在归档后重建了活动目录(残留): .specs/arch-m5/');
      }
      // 断言 2:归档路径有 M5 自动补的 archive 标记(标记随目录移动后的归属路径)
      const markerInArchive = path.join(dir, '.specs', 'archive', '2026-08-14-arch-m5', '.skill-loads', 'archive-flow-comet-integration.json');
      if (!fs.existsSync(markerInArchive)) {
        throw new Error('归档路径缺 M5 自动补标记: ' + markerInArchive);
      }
      // 变体:change 从未 skill-load(活动与归档路径皆无 .skill-loads)→ record 不得重建
      // 活动目录(修复前 targetLoadsDir 回退活动路径,writeJson 的 mkdir 会重建已归档目录)
      assertExit(runState(['init', 'arch-m5b'], dir), 0);
      assertExit(runState(['skill-load', 'archive', 'flow-comet-integration'], dir), 0);
      const stB = readStateFile(dir);
      stB.currentNode = 'archive';
      writeState(dir, stB);
      fs.renameSync(path.join(dir, '.specs', 'arch-m5b'), path.join(dir, '.specs', 'archive', '2026-08-14-arch-m5b'));
      const recB = runState(['record', 'archive', '{"summary":"archived"}'], dir);
      assertExit(recB, 0);
      if (fs.existsSync(path.join(dir, '.specs', 'arch-m5b'))) {
        throw new Error('M5 在双路径皆无时重建了活动目录(残留): .specs/arch-m5b/');
      }
      // 变体:归档后 skill-load 报错须引导 record 自动补路径(真实会话实证:归档后手动声明
      // 不可行,消息须指明 M5 自动补仍可写归档路径标记)
      const slArchive = runState(['skill-load', 'archive', 'flow-comet-integration'], dir);
      assertExit(slArchive, 1);
      assertOut(slArchive, 'record 自动补写');
    },
  },

  // ---------- H5~H8: archive 源受控重入真实命令链路 ----------

  {
    name: 'H5 受控重入:未授权调用 fail-closed 且 state 字节零改写',
    run: (dir) => {
      seedArchiveEntryState(dir);
      const before = readStateBytes(dir);
      // ② 未授权（缺 --authorized-by）→ 非零退出 + 授权形态指引 + 零改写
      const noAuth = runState(['reenter', 'verify', '--reason', '归档后发现缺陷'], dir);
      assertExit(noAuth, 1);
      assertOut(noAuth, 'reenter');
      assertOut(noAuth, 'authorized-by');
      if (!readStateBytes(dir).equals(before)) throw new Error('未授权调用改写了 state 字节');
      if (reentryBackupFiles(dir).length !== 0) {
        throw new Error('未授权调用产生了备份: ' + JSON.stringify(reentryBackupFiles(dir)));
      }
      // ② 授权源为纯空白 → 同样 fail-closed 且零改写
      const blankAuth = runState(['reenter', 'verify', '--authorized-by', '   ', '--reason', 'x'], dir);
      assertExit(blankAuth, 1);
      if (!readStateBytes(dir).equals(before)) throw new Error('空白授权源调用改写了 state 字节');
      const st = readStateFile(dir);
      if (st.currentNode !== 'archive') throw new Error('未授权调用改写了 currentNode: ' + JSON.stringify(st.currentNode));
      if (reentryEventsOf(st).length !== 0) throw new Error('未授权调用写入了 reentry-applied 事件');
    },
  },

  {
    name: 'H6 受控重入:完整授权链路(转移+嵌套证据+审计事件+备份指纹+审计行)',
    run: (dir) => {
      seedArchiveEntryState(dir);
      const beforeState = readStateFile(dir);
      const res = runState(['reenter', 'verify', '--authorized-by', '用户裁决', '--reason', '归档后发现验证缺口'], dir);
      assertExit(res, 0);
      const st = readStateFile(dir);
      // ③ 转移语义：currentNode = 目标、completedNodes = 前驱交集、status = running
      if (st.currentNode !== 'verify') throw new Error('重入后 currentNode 应为 verify: ' + JSON.stringify(st.currentNode));
      if (JSON.stringify(st.completedNodes) !== JSON.stringify(REENTRY_VERIFY_PREDECESSORS)) {
        throw new Error('重入后 completedNodes 应为 verify 前驱交集 ' + JSON.stringify(REENTRY_VERIFY_PREDECESSORS)
          + '，实际 ' + JSON.stringify(st.completedNodes));
      }
      if (st.status !== 'running') throw new Error('重入后 status 应为 running: ' + JSON.stringify(st.status));
      // ③ 授权嵌套记录（evidence.<目标节点>.reentryAuthorization）
      const auth = st.evidence && st.evidence.verify ? st.evidence.verify.reentryAuthorization : null;
      if (!auth || typeof auth !== 'object') {
        throw new Error('缺 evidence.verify.reentryAuthorization: ' + JSON.stringify(st.evidence));
      }
      if (auth.round !== 1 || auth.target !== 'verify' || auth.source !== '用户裁决') {
        throw new Error('授权记录形态不符: ' + JSON.stringify(auth));
      }
      if (typeof auth.at !== 'string' || auth.at.trim() === '') throw new Error('授权记录缺 at: ' + JSON.stringify(auth));
      // ③ 审计事件——change 必填（轮次按 change 隔离）
      const events = reentryEventsOf(st);
      if (events.length !== 1) throw new Error('应恰一条 reentry-applied 事件: ' + JSON.stringify(events));
      const ev = events[0];
      if (ev.from !== 'archive' || ev.to !== 'verify' || ev.round !== 1 || ev.change !== CHANGE_ID) {
        throw new Error('reentry-applied 事件字段不符: ' + JSON.stringify(ev));
      }
      if (!ev.authorization || ev.authorization.source !== '用户裁决' || ev.authorization.round !== 1) {
        throw new Error('事件 authorization 不符: ' + JSON.stringify(ev.authorization));
      }
      if (typeof ev.at !== 'string' || ev.at.trim() === '') throw new Error('事件缺 at: ' + JSON.stringify(ev));
      // ③ 备份在场 + 指纹与文件 sha256 一致 + 全量快照语义（AC-9）
      const backupPath = resolveReentryBackupPath(dir, CHANGE_ID, ev);
      if (!backupPath) throw new Error('事件 backup 指向的备份文件不在场: ' + JSON.stringify(ev.backup));
      if (!/-pre-verify\.json$/.test(backupPath)) {
        throw new Error('备份命名应为 <UTC ISO>-pre-<target>.json: ' + backupPath);
      }
      const backupBytes = fs.readFileSync(backupPath);
      const backupState = JSON.parse(backupBytes.toString('utf8'));
      if (backupState.currentNode !== beforeState.currentNode || backupState.status !== beforeState.status
        || JSON.stringify(backupState.completedNodes) !== JSON.stringify(beforeState.completedNodes)) {
        throw new Error('备份应为重入前 state 全量快照: ' + JSON.stringify(backupState));
      }
      if (reentryEventsOf(backupState).length !== 0) throw new Error('备份不应含本次重入事件');
      const fingerprint = createHash('sha256').update(backupBytes).digest('hex');
      const recorded = String(ev.fingerprint || '').toLowerCase().replace(/^sha256:/, '');
      if (recorded !== fingerprint) {
        throw new Error('事件指纹与备份文件 sha256 不一致: ' + JSON.stringify(ev.fingerprint) + ' vs ' + fingerprint);
      }
      // ④ 审计行：REENTRY 前缀 + 来源 archive + 目标 + 轮次 n/3 + 备份路径
      assertOut(res, 'REENTRY');
      assertOut(res, 'archive');
      assertOut(res, 'verify');
      assertOut(res, '1/3');
      assertOut(res, path.basename(backupPath));
      const backups = reentryBackupFiles(dir);
      if (backups.length !== 1) throw new Error('成功重入应恰一份备份: ' + JSON.stringify(backups));
    },
  },

  {
    name: 'H7 受控重入:幂等重放零改写与按备份手工回滚可执行',
    run: (dir) => {
      seedArchiveEntryState(dir);
      const first = runState(['reenter', 'verify', '--authorized-by', '用户裁决', '--reason', '首次重入'], dir);
      assertExit(first, 0);
      const afterFirst = readStateBytes(dir);
      const ev = reentryEventsOf(readStateFile(dir))[0];
      const backupPath = resolveReentryBackupPath(dir, CHANGE_ID, ev);
      if (!backupPath) throw new Error('首次重入后缺备份文件: ' + JSON.stringify(ev));
      // ⑤ 幂等重放：同目标再调用 → 空操作（state 字节零改写、不新增备份/事件）
      const replay = runState(['reenter', 'verify', '--authorized-by', '用户裁决', '--reason', '重复调用'], dir);
      assertExit(replay, 0);
      if (!readStateBytes(dir).equals(afterFirst)) throw new Error('幂等重放改写了 state 字节');
      if (reentryEventsOf(readStateFile(dir)).length !== 1) throw new Error('幂等重放重复写入 reentry-applied 事件');
      if (reentryBackupFiles(dir).length !== 1) {
        throw new Error('幂等重放新增了备份: ' + JSON.stringify(reentryBackupFiles(dir)));
      }
      // ⑦ 手工回滚（AC-9）：按备份文件覆盖 → status 可读且语义回到重入前
      const backupBytes = fs.readFileSync(backupPath);
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), backupBytes);
      const status = runState(['status'], dir);
      assertExit(status, 0);
      assertOut(status, '"stateCurrentNode": "archive"');
      assertOut(status, '"change": "' + CHANGE_ID + '"');
      const restored = readStateFile(dir);
      if (restored.currentNode !== 'archive') throw new Error('回滚后 currentNode 未回到 archive: ' + JSON.stringify(restored.currentNode));
      if (JSON.stringify(restored.completedNodes) !== JSON.stringify(ARCHIVE_ENTRY_COMPLETED_NODES)) {
        throw new Error('回滚后 completedNodes 未回到重入前形态: ' + JSON.stringify(restored.completedNodes));
      }
      if (reentryEventsOf(restored).length !== 0) throw new Error('回滚后不应残留本次 reentry-applied 事件');
    },
  },

  {
    name: 'H8 受控重入:上限 BLOCK、显式授权续轮与重入后闭环组合链路（真实命令）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const gateMarker = path.join(dir, 'verify-gate-ran.txt');
      seedArchiveEntryState(dir);
      // 真实链路跑满 3 轮：每轮成功后把归属重置回 archive 已 entry 形态（模拟流程再次归档进入），
      // history 事件保留——轮次按 change 从事件派生
      for (let round = 1; round <= 3; round += 1) {
        const res = runState(['reenter', 'verify', '--authorized-by', '用户裁决', '--reason', '第 ' + round + ' 轮'], dir);
        assertExit(res, 0);
        if (reentryEventsOf(readStateFile(dir)).length !== round) {
          throw new Error('第 ' + round + ' 轮后 reentry-applied 事件数应为 ' + round);
        }
        const st = readStateFile(dir);
        st.currentNode = 'archive';
        st.completedNodes = ARCHIVE_ENTRY_COMPLETED_NODES.slice();
        st.status = 'running';
        writeState(dir, st);
      }
      if (reentryBackupFiles(dir).length !== 3) {
        throw new Error('三轮应产生三份备份: ' + JSON.stringify(reentryBackupFiles(dir)));
      }
      const beforeFourth = readStateBytes(dir);
      // ⑥ 第 4 次 → BLOCK + 人工裁决指引（继续 / 停止）+ state 字节零改写
      const fourth = runState(['reenter', 'execute', '--authorized-by', '用户裁决', '--reason', '第 4 轮'], dir);
      assertExit(fourth, 1);
      assertOut(fourth, 'BLOCK');
      assertOut(fourth, '继续');
      assertOut(fourth, '停止');
      if (!readStateBytes(dir).equals(beforeFourth)) throw new Error('超上限调用改写了 state 字节');
      if (reentryEventsOf(readStateFile(dir)).length !== 3) throw new Error('超上限调用写入了 reentry-applied 事件');
      if (reentryBackupFiles(dir).length !== 3) {
        throw new Error('超上限调用新增了备份: ' + JSON.stringify(reentryBackupFiles(dir)));
      }
      // ⑦ 上限判定先于空操作短路：同目标形态 + 3 条本 change 事件 → 仍 BLOCK 零改写
      {
        const capped = readStateFile(dir);
        capped.currentNode = 'verify';
        capped.completedNodes = REENTRY_VERIFY_PREDECESSORS.slice();
        writeState(dir, capped);
        const cappedBytes = readStateBytes(dir);
        const sameTarget = runState(['reenter', 'verify', '--authorized-by', '用户裁决', '--reason', '超限同目标重放'], dir);
        assertExit(sameTarget, 1);
        assertOut(sameTarget, 'BLOCK');
        assertOut(sameTarget, '继续');
        assertNotOut(sameTarget, '空操作');
        if (!readStateBytes(dir).equals(cappedBytes)) throw new Error('超限同目标形态改写了 state 字节');
        if (reentryEventsOf(readStateFile(dir)).length !== 3) throw new Error('超限同目标形态写入了 reentry-applied 事件');
        const reset = readStateFile(dir);
        reset.currentNode = 'archive';
        reset.completedNodes = ARCHIVE_ENTRY_COMPLETED_NODES.slice();
        reset.status = 'running';
        writeState(dir, reset);
      }
      // ⑧ 续轮授权不足（授权轮次 < 已用 + 1）→ BLOCK 零改写：上限裁决点不可被残缺授权绕过
      {
        const insufficientBytes = readStateBytes(dir);
        const insufficient = runState(['reenter', 'verify', '--authorized-by', '用户授权', '--reason', '轮次不足', '--continue-round', '3'], dir);
        assertExit(insufficient, 1);
        assertOut(insufficient, 'BLOCK');
        if (!readStateBytes(dir).equals(insufficientBytes)) throw new Error('续轮授权轮次不足改写了 state 字节');
      }
      // ⑨ 上限后的显式授权续轮（AC-7 后半句）→ 放行并计第 4 轮：审计事件 / 嵌套授权留痕带续轮
      // 标记与原因，备份链新增一份
      const continued = runState(['reenter', 'verify', '--authorized-by', '用户授权续轮', '--reason', '第 4 轮显式授权续轮', '--continue-round', '4'], dir);
      assertExit(continued, 0);
      assertOut(continued, 'REENTRY');
      assertOut(continued, '续轮');
      assertOut(continued, '4');
      const continuedState = readStateFile(dir);
      if (continuedState.currentNode !== 'verify') {
        throw new Error('续轮放行后 currentNode 应为 verify: ' + JSON.stringify(continuedState.currentNode));
      }
      const continuedEvents = reentryEventsOf(continuedState);
      const continuedEvent = continuedEvents[continuedEvents.length - 1];
      if (!continuedEvent || continuedEvent.round !== 4 || continuedEvent.change !== CHANGE_ID
        || continuedEvent.continuationAuthorized !== true
        || continuedEvent.reason !== '第 4 轮显式授权续轮') {
        throw new Error('续轮审计事件字段不符（round=4 / change / 续轮标记 / reason）: ' + JSON.stringify(continuedEvent));
      }
      if (continuedState.evidence?.verify?.reentryAuthorization?.continuationAuthorized !== true) {
        throw new Error('续轮授权留痕缺失: ' + JSON.stringify(continuedState.evidence?.verify));
      }
      if (reentryBackupFiles(dir).length !== 4) {
        throw new Error('续轮放行应新增一份备份（共 4 份）: ' + JSON.stringify(reentryBackupFiles(dir)));
      }
      // ⑩ 组合真实链路（AC-8）：续轮后的 verify 驻留态 → 追加 pending 修复任务 → 受控归位
      // execute → 执行家族四类出口真实执行 → 回源 verify 出口真实执行（验证命令副作用）→ archive
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md',
        '# DESIGN\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 0. 技术栈选定\n\nNode.js(ESM)\n\n## 决策清单\n\n- [ ] 循环路由\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTaskText('pending'));
      // 段内大写 Z 形态的 SUMMARY（方法声明在其后）：该出口的 exit 0 即「段尾判定正确」的真实链路锚
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', execSummaryWithMachineMarker('T01'));
      // 源节点前序产物齐备：REVIEW.md 在场（已处置）——否则回源 verify 出口后的产物推导会把
      // 下一跳判回 review（产物即真相），组合链路的终点断言无法到达 archive。
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', fixBatchReviewDoc(true));
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md',
        '# TEST\n\n## 验证命令\n\n```\nnode -e "require(\'fs\').writeFileSync(\'verify-gate-ran.txt\', \'GATE-RAN\')"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
      // 受控归位：next 检出 pending 修复任务 → FIX-BATCH 归位 execute（真实写盘）
      const reposition = runState(['next'], dir, env);
      assertExit(reposition, 0);
      assertOut(reposition, 'FIX-BATCH: 归位 execute（源节点 verify）');
      assertNodeLine(reposition, 'execute');
      let chainState = readStateFile(dir);
      if (chainState.currentNode !== 'execute') {
        throw new Error('受控归位后 currentNode 应为 execute: ' + JSON.stringify(chainState.currentNode));
      }
      if (chainState.completedNodes.includes('verify')) {
        throw new Error('受控归位不得把源节点标完成: ' + JSON.stringify(chainState.completedNodes));
      }
      // 完成修复任务（标 done + 逐任务 SUMMARY + 重载声明 + record execute）
      completeFixTaskAndRecord(dir, env);
      // execute 家族四类出口真实跑通：全任务 done / 逐任务 SUMMARY / 六段自查与自检方法 / 任务集签名
      const execExit = runGuard(['exit', 'execute', '--apply'], dir, env);
      assertExit(execExit, 0);
      assertOut(execExit, 'ALL CHECKS PASSED');
      // 段尾判定锚（新 / 旧 change 两态都不许出现该拦因）：T01 的 6 维自查段内大写 Z 在方法声明
      // **之前**——段体若把大写 Z 当串尾而提前收尾，该出口会报「6 维自查未声明使用」（新 change
      // BLOCK / 旧 change 同句 WARN），本条对两态都构成判别。
      assertNotOut(execExit, '6 维自查未声明使用');
      assertOut(execExit, 'FIX-BATCH: 回源节点 verify（execute 出口已完成）');
      assertNodeLine(execExit, 'verify');
      assertNotNodeLine(execExit, 'archive');
      chainState = readStateFile(dir);
      if (chainState.currentNode !== 'verify' || chainState.completedNodes.includes('verify')) {
        throw new Error('回源后应停在未完成的 verify: ' + JSON.stringify({ node: chainState.currentNode, completed: chainState.completedNodes }));
      }
      if (!fs.existsSync(path.join(dir, '.specs', CHANGE_ID, 'T01-SUMMARY.md'))
        || !fs.existsSync(path.join(dir, '.specs', CHANGE_ID, 'T-FIX-01-SUMMARY.md'))) {
        throw new Error('逐任务 SUMMARY 必须在场（execute 家族出口之一）');
      }
      for (const summaryName of ['T01-SUMMARY.md', 'T-FIX-01-SUMMARY.md']) {
        const summaryText = fs.readFileSync(path.join(dir, '.specs', CHANGE_ID, summaryName), 'utf8');
        if (!/##\s*6 维自查/.test(summaryText) || !/##\s*自检方法/.test(summaryText)) {
          throw new Error(summaryName + ' 缺六维自查 / 自检方法段（execute 家族出口之一）');
        }
      }
      // 夹具形态自证（判别力前提 · 抽掉必报的反面）：T01 的 6 维自查段内「大写 Z 说明行」必须
      // **早于**方法声明、且两者都在该段内——否则上面那次出口放行与该段尾判定无关，锚会静默
      // 退化成假绿（形态不符即抛错，不静默跳过）。
      const t01SummaryText = fs.readFileSync(path.join(dir, '.specs', CHANGE_ID, 'T01-SUMMARY.md'), 'utf8');
      const sixDimAt = t01SummaryText.indexOf('## 6 维自查');
      const nextSectionAt = sixDimAt >= 0 ? t01SummaryText.indexOf('\n## ', sixDimAt) : -1;
      const zMarkerAt = sixDimAt >= 0 ? t01SummaryText.indexOf('ZERO-LOGIC-CHANGE-OK', sixDimAt) : -1;
      const declaredAt = sixDimAt >= 0 ? t01SummaryText.indexOf('brooks-review', sixDimAt) : -1;
      if (!(sixDimAt >= 0 && zMarkerAt > sixDimAt && declaredAt > zMarkerAt
        && (nextSectionAt === -1 || declaredAt < nextSectionAt))) {
        throw new Error('T01-SUMMARY 的 6 维自查段须为「大写 Z 说明行在前、方法声明行在后」形态（段尾判定锚的判别力前提）: '
          + JSON.stringify({ sixDimAt, zMarkerAt, declaredAt, nextSectionAt }));
      }
      const execEvent = (chainState.history || [])
        .filter((e) => e.event === 'exit-applied' && e.node === 'execute')
        .pop();
      if (!execEvent || !/^v1:[0-9a-f]{64}$/.test(String(execEvent.taskSetSignature || ''))) {
        throw new Error('execute 家族出口必须记录任务集签名（出口之一）: ' + JSON.stringify(execEvent));
      }
      if (!chainState.evidence?.execute?.summary) {
        throw new Error('execute 出口证据缺失: ' + JSON.stringify(chainState.evidence?.execute));
      }
      // 源节点（verify）出口真实重跑：验证命令落盘副作用 + 推进 archive
      assertExit(runState(['skill-load', 'verify', 'flow-comet-verify', '--prompt', 'flow-kit/prompts/7-integration.md'], dir, env), 0);
      assertExit(runState(['record', 'verify', '{"summary":"回源复验完成"}'], dir, env), 0);
      assertExit(runGuard(['entry', 'verify'], dir, env), 0);
      const verifyExit = runGuard(['exit', 'verify', '--apply'], dir, env);
      assertExit(verifyExit, 0);
      assertOut(verifyExit, 'ALL CHECKS PASSED');
      assertNodeLine(verifyExit, 'archive');
      if (!fs.existsSync(gateMarker) || fs.readFileSync(gateMarker, 'utf8') !== 'GATE-RAN') {
        throw new Error('回源 verify 出口未真实执行 TEST.md 验证命令（副作用文件缺失/内容不符）');
      }
      const finalState = readStateFile(dir);
      if (finalState.currentNode !== 'archive' || !finalState.completedNodes.includes('verify')) {
        throw new Error('组合链路终点应为 archive 且 verify 已完成: ' + JSON.stringify({ node: finalState.currentNode, completed: finalState.completedNodes }));
      }
      if (reentryEventsOf(finalState).length !== 4) {
        throw new Error('组合链路不得丢失重入审计事件（应为 4 条）: ' + reentryEventsOf(finalState).length);
      }
      if (reentryBackupFiles(dir).length !== 4) {
        throw new Error('组合链路不得新增 / 丢失备份（应为 4 份）: ' + JSON.stringify(reentryBackupFiles(dir)));
      }
    },
  },

  // ---------- H9~H11: 受控计划重校重签（replan）与强制推进留痕真实命令链路 ----------

  {
    name: 'H9 replan 解死锁：execute 相位修订任务集（含并行就绪任务）→ 重签 → 出口放行 → next 正常路由',
    run: (dir) => {
      seedExecuteEntryState(dir, replanTaskText());
      // 真实委托留证（串行 pending → execute 归属）→ SUMMARY 齐备，出口四类校验可通过
      completeSerialTaskWithHandoff(dir, 'S01', 'src/s01.mjs');
      writeFile(dir, '.specs/' + CHANGE_ID + '/S01-SUMMARY.md', execSummaryFixture('S01'));
      // 任务集修订（死锁现场）：原任务完成 + 计划外新增的并行就绪任务
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', replanTaskText({ s01Status: 'done', parallelPending: ['P02'] }));
      const beforeBytes = readStateBytes(dir);
      // ① 前进被签名门禁挡住：exit execute → BLOCKED（任务集被修改）+ 零改写
      const blocked = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, '签名不匹配');
      if (!readStateBytes(dir).equals(beforeBytes)) throw new Error('签名门禁 BLOCK 改写了 state 字节');
      // ② 受控重校重签（唯一合规出口）：授权 + 原因 + 重签 + 双写留痕 + 备份
      const replan = runState(['replan', '计划有缺陷：新增并行任务 P02', '--authorized-by', '用户裁决'], dir);
      assertExit(replan, 0);
      assertOut(replan, 'REPLAN');
      const st = readStateFile(dir);
      const events = replanEventsOf(st);
      if (events.length !== 1 || events[0].change !== CHANGE_ID || events[0].node !== 'execute') {
        throw new Error('replan-applied 审计事件不符: ' + JSON.stringify(events));
      }
      if (!st.evidence || !st.evidence.execute || !st.evidence.execute.replanAuthorization) {
        throw new Error('缺 evidence.execute.replanAuthorization 授权留痕: ' + JSON.stringify(st.evidence));
      }
      if (replanBackupFiles(dir).length !== 1) {
        throw new Error('重签应恰产生一份备份: ' + JSON.stringify(replanBackupFiles(dir)));
      }
      // ③ 同一出口再跑 → 放行（不再报签名不匹配），路由到委托节点（并行就绪任务）
      const exitRes = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(exitRes, 0);
      assertOut(exitRes, 'ALL CHECKS PASSED');
      assertNodeLine(exitRes, 'subagent-execute');
      // ④ next 正常路由（死锁解除后可继续推进）
      const next = runState(['next'], dir);
      assertExit(next, 0);
      assertNodeLine(next, 'subagent-execute');
    },
  },

  {
    name: 'H10 replan 授权 fail-closed 与轮次上限：未授权零改写 · 同文件跨任务族分级拦截与恢复 · 第 4 次 BLOCK · 显式续轮放行（真实命令）',
    run: (dir) => {
      seedExecuteEntryState(dir, replanTaskText());
      // 修订任务集 → 进入「签名不匹配」的适用现场
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', replanTaskText({ parallelPending: ['P01'] }));
      const beforeBytes = readStateBytes(dir);
      // ① 缺授权 / 空授权 / 纯空白授权 / 缺原因 → BLOCKED 且 state 字节零改写、零备份、零事件
      const blockedCalls = [
        ['缺 --authorized-by', ['replan', '计划有缺陷：新增并行任务 P01']],
        ['--authorized-by 空串', ['replan', '计划有缺陷：新增并行任务 P01', '--authorized-by', '']],
        ['--authorized-by 纯空白', ['replan', '计划有缺陷：新增并行任务 P01', '--authorized-by', '   ']],
        ['缺位置 reason', ['replan', '--authorized-by', '用户裁决']],
      ];
      for (const [label, args] of blockedCalls) {
        const res = runState(args, dir);
        assertExit(res, 1);
        assertOut(res, 'BLOCKED');
        if (!readStateBytes(dir).equals(beforeBytes)) throw new Error(label + '：改写了 state 字节');
      }
      if (replanBackupFiles(dir).length !== 0) {
        throw new Error('未授权调用产生了备份: ' + JSON.stringify(replanBackupFiles(dir)));
      }
      if (replanEventsOf(readStateFile(dir)).length !== 0) {
        throw new Error('未授权调用写入了 replan-applied 事件');
      }
      // ② 真实链路跑满 3 轮（每轮重新修订任务集 → 重签；轮次按 change 从事件派生）。第 1 轮以
      // 「同文件跨任务且无依赖路径」的修订开场，逐档验证 replan 与 plan 出口同族的分级消费：
      // 旧 change 形态仅 WARN 且照常重签（渐进不卡死）→ 新 change 形态 BLOCK 且状态零改写
      // （BLOCK 早于备份与任何写盘：零新增备份、零新增事件、state 字节不变）→ 按恢复指引补显式
      // depends_on 后复签通过（同一通道，不做校验豁免）。
      const parallelIds = ['P01', 'P02', 'P03', 'P04'];
      const oldChangeState = readStateFile(dir);
      delete oldChangeState.newChange;
      writeState(dir, oldChangeState);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        replanTaskText({ parallelPending: ['P01'], crossTaskPair: 'no-deps' }));
      const crossWarn = runState(['replan', '计划缺陷重校 1（旧 change 形态）', '--authorized-by', '用户裁决'], dir);
      assertExit(crossWarn, 0);
      assertOut(crossWarn, 'REPLAN');
      assertOut(crossWarn, 'WARN: TASK.md 同文件跨任务且无依赖路径');
      assertOut(crossWarn, 'X1×X2(src/shared-cross.mjs)');
      assertNotOut(crossWarn, 'BLOCKED');
      if (replanEventsOf(readStateFile(dir)).length !== 1) {
        throw new Error('旧 change 形态应照常重签并写入第 1 条 replan-applied 事件');
      }
      const afterWarnState = readStateFile(dir);
      afterWarnState.newChange = true;
      writeState(dir, afterWarnState);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        replanTaskText({ parallelPending: ['P01', 'P02'], crossTaskPair: 'no-deps' }));
      const crossBytes = readStateBytes(dir);
      const crossBlocked = runState(['replan', '计划缺陷重校（新 change 形态）', '--authorized-by', '用户裁决'], dir);
      assertExit(crossBlocked, 1);
      assertOut(crossBlocked, 'BLOCKED');
      assertOut(crossBlocked, '同文件跨任务且无依赖路径');
      assertOut(crossBlocked, 'X1×X2(src/shared-cross.mjs)');
      assertOut(crossBlocked, '补显式 depends_on 或合并为一个任务');
      assertNotOut(crossBlocked, 'REPLAN:');
      if (!readStateBytes(dir).equals(crossBytes)) throw new Error('replan 第三族 BLOCK 改写了 state 字节');
      if (replanBackupFiles(dir).length !== 1) {
        throw new Error('replan 第三族 BLOCK 不得新增备份（应仍为第 1 轮那一份）: ' + JSON.stringify(replanBackupFiles(dir)));
      }
      if (replanEventsOf(readStateFile(dir)).length !== 1) {
        throw new Error('replan 第三族 BLOCK 不得写入 replan-applied 事件');
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        replanTaskText({ parallelPending: ['P01', 'P02'], crossTaskPair: 'deps' }));
      const crossRecovered = runState(['replan', '计划缺陷重校 2（已补 depends_on）', '--authorized-by', '用户裁决'], dir);
      assertExit(crossRecovered, 0);
      assertOut(crossRecovered, 'REPLAN');
      if (replanEventsOf(readStateFile(dir)).length !== 2) {
        throw new Error('补显式 depends_on 后复签应写入第 2 条 replan-applied 事件');
      }
      // 第 3 轮：常规修订（轮次按 change 从事件累计）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', replanTaskText({ parallelPending: parallelIds.slice(0, 3) }));
      const thirdRound = runState(['replan', '计划缺陷重校 3', '--authorized-by', '用户裁决'], dir);
      assertExit(thirdRound, 0);
      assertOut(thirdRound, 'REPLAN');
      if (replanEventsOf(readStateFile(dir)).length !== 3) {
        throw new Error('第 3 轮后 replan-applied 事件数应为 3');
      }
      if (replanBackupFiles(dir).length !== 3) {
        throw new Error('三轮应产生三份备份: ' + JSON.stringify(replanBackupFiles(dir)));
      }
      // ③ 第 4 次 → BLOCK + 人工裁决指引（继续 / 停止）+ state 字节零改写
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', replanTaskText({ parallelPending: parallelIds }));
      const beforeFourth = readStateBytes(dir);
      const fourth = runState(['replan', '计划缺陷重校（上限后未授权）', '--authorized-by', '用户裁决'], dir);
      assertExit(fourth, 1);
      assertOut(fourth, 'BLOCK');
      assertOut(fourth, '继续');
      assertOut(fourth, '停止');
      if (!readStateBytes(dir).equals(beforeFourth)) throw new Error('超上限调用改写了 state 字节');
      if (replanEventsOf(readStateFile(dir)).length !== 3) throw new Error('超上限调用写入了 replan-applied 事件');
      if (replanBackupFiles(dir).length !== 3) {
        throw new Error('超上限调用新增了备份: ' + JSON.stringify(replanBackupFiles(dir)));
      }
      // ④ 续轮授权不足（n < 已用 + 1）→ BLOCK 零改写：上限裁决点不可被残缺授权绕过
      const insufficientBytes = readStateBytes(dir);
      const insufficient = runState(['replan', '计划缺陷重校（续轮不足）', '--authorized-by', '用户授权', '--continue-round', '3'], dir);
      assertExit(insufficient, 1);
      assertOut(insufficient, 'BLOCK');
      if (!readStateBytes(dir).equals(insufficientBytes)) throw new Error('续轮授权不足改写了 state 字节');
      // ⑤ 显式授权续轮（n = 已用 + 1）→ 放行并计第 4 轮：审计行标注续轮，事件 / 留痕带续轮标记
      const continued = runState(['replan', '计划缺陷重校（上限后显式续轮）', '--authorized-by', '用户授权续轮', '--continue-round', '4'], dir);
      assertExit(continued, 0);
      assertOut(continued, 'REPLAN');
      assertOut(continued, '续轮');
      const continuedState = readStateFile(dir);
      const continuedEvents = replanEventsOf(continuedState);
      const continuedEvent = continuedEvents[continuedEvents.length - 1];
      if (!continuedEvent || continuedEvent.round !== 4 || continuedEvent.change !== CHANGE_ID
        || continuedEvent.continuationAuthorized !== true) {
        throw new Error('续轮审计事件字段不符（round=4 / change / 续轮标记）: ' + JSON.stringify(continuedEvent));
      }
      if (!continuedState.evidence || !continuedState.evidence.execute
        || continuedState.evidence.execute.replanAuthorization.continuationAuthorized !== true) {
        throw new Error('续轮授权留痕缺失: ' + JSON.stringify(continuedState.evidence && continuedState.evidence.execute));
      }
      if (replanBackupFiles(dir).length !== 4) {
        throw new Error('续轮放行应新增一份备份（共 4 份）: ' + JSON.stringify(replanBackupFiles(dir)));
      }
    },
  },

  {
    name: 'H11 advance 留痕：advance-forced 事件 + status.forcedNodes 派生可见（真实命令）',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID, '--init-skip'], dir), 0);
      writeIntakeArtifacts(dir);
      const res = runState(['advance'], dir);
      assertExit(res, 0);
      assertOut(res, 'Advanced to: design');
      assertOut(res, 'ADVANCE-AUDIT');
      const st = readStateFile(dir);
      const events = (st.history || []).filter((e) => e && e.event === 'advance-forced');
      if (events.length !== 1) {
        throw new Error('advance 应恰写一条 advance-forced 事件: ' + JSON.stringify(events));
      }
      const event = events[0];
      if (event.node !== 'open' || event.change !== CHANGE_ID || event.reason !== 'advance') {
        throw new Error('advance-forced 事件字段不符: ' + JSON.stringify(event));
      }
      if (JSON.stringify(event.skipped) !== JSON.stringify(['exit:open'])) {
        throw new Error("advance-forced 事件应记录 skipped: ['exit:open']: " + JSON.stringify(event.skipped));
      }
      if (typeof event.at !== 'string' || event.at.trim() === '') throw new Error('advance-forced 缺 at: ' + JSON.stringify(event.at));
      const status = parseStatusOutput(dir);
      if (!Array.isArray(status.forcedNodes) || !status.forcedNodes.includes('open')) {
        throw new Error('status.forcedNodes 应含强制推进且无出口证据的 open: ' + JSON.stringify(status.forcedNodes));
      }
    },
  },

];
