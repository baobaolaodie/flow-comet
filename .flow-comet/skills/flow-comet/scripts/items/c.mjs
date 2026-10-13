// items/c.mjs — C 组条目（委托链路）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 跨组共用夹具在 lib/system-fixtures.mjs（组文件只承载 ENTRIES 数据与组内私有夹具，组文件之间零 import）。

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, spawnSync } from 'child_process';
import { assertExit, assertNotOut, assertOut, baseState, makeTmp, runGuard, runHandoff, runState, writeFile, writeState } from '../lib/test-helpers.mjs';
import { CHANGE_ID, assertNodeLine, fullContract, gitInit, readStateFile, writeIntakeArtifacts } from '../lib/system-fixtures.mjs';

export const ENTRIES = [
  // ---------- C. 委托链路 ----------

  {
    name: 'C1 handoff：请求/结果/状态全链路（含提交校验）',
    run: (dir) => {
      gitInit(dir);
      writeFile(dir, '.gitignore', '.specs/\n');
      writeState(dir, baseState('execute'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="T01" status="done" parallel="true">\n  <action>实现 T01</action>\n  <write_files>src/t1.mjs</write_files>\n  <verify>node --check src/t1.mjs</verify>\n</task>\n');
      assertExit(runState(['skill-load', 'execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir), 0);
      writeFile(dir, 'src/t1.mjs', 'export const x = 1;\n');
      execFileSync('git', ['add', 'src/t1.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'feat: t1'], { cwd: dir });
      const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      // ① 请求（无 --write-files → 从 TASK.md 自动解析）
      const req = runHandoff(['request', 'T01', '委托实现 T01'], dir);
      assertExit(req, 0);
      assertOut(req, 'HANDOFF REQUEST: T01');
      // ② 结果：真实提交哈希 + write_files 范围内文件 → 记录且无越界警告
      const result = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', commitHash: hash,
        changedFiles: ['src/t1.mjs'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t1.mjs', output: 'ok' },
        redEvidence: { command: 'node --check src/t1.mjs' },
      })], dir);
      assertExit(result, 0);
      assertOut(result, 'HANDOFF RESULT: T01');
      assertNotOut(result, 'HANDOFF WARN');
      // 新 change 提交越界(writeFiles 范围外文件)→ BLOCKED(记录时校验)
      const stForP4 = readStateFile(dir);
      stForP4.newChange = true;
      writeState(dir, stForP4);
      writeFile(dir, 'src/evil.mjs', 'export const evil = 1;\n');
      execFileSync('git', ['add', 'src/evil.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: out-of-bound file'], { cwd: dir });
      const evilHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const reqT02 = runHandoff(['request', 'T02', 'T02 委托', '--write-files', 'src/t2.mjs'], dir);
      assertExit(reqT02, 0);
      const overBound = runHandoff(['result', 'T02', JSON.stringify({
        status: 'DONE', taskId: 'T02', commitHash: evilHash,
        changedFiles: ['src/evil.mjs'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/evil.mjs', output: 'ok' },
        redEvidence: { command: 'node --check src/evil.mjs' },
      })], dir);
      assertExit(overBound, 1);
      assertOut(overBound, 'BLOCKED');
      assertOut(overBound, 'writeFiles');
      // ③ 状态：请求与结果齐可见
      const status = runHandoff(['status'], dir);
      assertExit(status, 0);
      assertOut(status, '"handoffRequests"');
      assertOut(status, '"handoffResult"');
      assertOut(status, 'T01');
      // ④ 无效提交哈希 → 错误提示但记录不阻断（结果仍入库）
      const badHash = runHandoff(['result', 'T02', JSON.stringify({
        commitHash: 'deadbeef00000000000000000000000000000000',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t2.mjs' },
      })], dir);
      assertExit(badHash, 0);
      assertOut(badHash, 'HANDOFF ERROR: commitHash 无效或 git show 失败');
      // ⑤ --json-file 读取 JSON payload(与 record 对齐——规避 Windows PowerShell
      // 引号剥离导致 JSON 损坏;须正确解析为对象而非存成字符串)
      assertExit(runHandoff(['request', 'T03', 'T03 委托', '--write-files', 'src/t1.mjs'], dir), 0);
      const payloadFile = path.join(dir, 'contract.json');
      fs.writeFileSync(payloadFile, JSON.stringify({
        status: 'DONE', taskId: 'T03', commitHash: hash,
        changedFiles: ['src/t1.mjs'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t1.mjs', output: 'ok' },
      }), 'utf8');
      const viaFile = runHandoff(['result', 'T03', '--json-file', payloadFile], dir);
      assertExit(viaFile, 0);
      assertOut(viaFile, 'HANDOFF RESULT: T03');
      const st5 = readStateFile(dir);
      const rec5 = st5.evidence['subagent-execute'].handoffResult['T03'];
      if (!rec5 || typeof rec5.result !== 'object' || rec5.result.commitHash !== hash) {
        throw new Error('--json-file 未正确解析契约(应存为对象): ' + JSON.stringify(rec5));
      }
      // ⑥ --json-file 越界路径 → 拒绝(与 record 同规则)
      const outsideContract = path.join(dir, '..', 'outside-contract.json');
      fs.writeFileSync(outsideContract, '{"summary":"outside"}', 'utf8');
      const viaBad = runHandoff(['result', 'T04', '--json-file', outsideContract], dir);
      assertExit(viaBad, 1);
      assertOut(viaBad, '必须在项目根内');
      // ⑦ 零提交正式语义：write_files 为空 + 显式零提交 → 跳过提交子集校验 + 可审计提示；
      //    write_files 非空 + 声称 noCommit → 仍完整提交子集校验（不可借零提交绕过越界检查）
      const stEmpty = readStateFile(dir);
      stEmpty.newChange = true;
      writeState(dir, stEmpty);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T05" status="pending"><action>无边界任务</action><write_files></write_files><verify>echo ok</verify></task>\n');
      assertExit(runHandoff(['request', 'T05'], dir), 0);
      const resZero = runHandoff(['result', 'T05', JSON.stringify({
        status: 'DONE', taskId: 'T05', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'echo ok' },
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resZero, 0);
      assertOut(resZero, 'HANDOFF RESULT: T05');
      assertOut(resZero, '零提交');
      // ⑦b 零提交滥用负例：write_files 非空 + 契约声称 noCommit → 仍完整校验（越界 BLOCK + 矛盾提示）
      const stNonEmpty = readStateFile(dir);
      stNonEmpty.newChange = true;
      writeState(dir, stNonEmpty);
      writeFile(dir, 'src/rogue-zero.mjs', 'export const rogue = 1;\n');
      execFileSync('git', ['add', 'src/rogue-zero.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: rogue zero'], { cwd: dir });
      const rogueHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      assertExit(runHandoff(['request', 'T05b', 'T05b 委托', '--write-files', 'src/t2.mjs'], dir), 0);
      const stAbuseReq = readStateFile(dir);
      if (stAbuseReq.evidence['subagent-execute'].handoffRequests['T05b'].noCommit === true) {
        throw new Error('tracked write_files 的 request 不应记录 noCommit（无资格声称不得被资格判定放行）');
      }
      const abuseBytes = fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8');
      const resAbuse = runHandoff(['result', 'T05b', JSON.stringify({
        status: 'DONE', taskId: 'T05b', noCommit: true, commitHash: rogueHash,
        changedFiles: ['src/rogue-zero.mjs'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'echo ok' },
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resAbuse, 1);
      assertOut(resAbuse, '超出 writeFiles 范围');
      assertOut(resAbuse, '零提交');
      if (fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8') !== abuseBytes) {
        throw new Error('零提交越权 BLOCK 不得改写 state 字节');
      }
      // ⑧ 段感知精确匹配:allowed=[src/foo] 不匹配提交 src/foobar.mjs(前缀匹配会放行,
      // 精确匹配判越界——修复前前缀匹配误放行,此处应 RED)
      writeFile(dir, 'src/foobar.mjs', 'export const x = 1;\n');
      execFileSync('git', ['add', 'src/foobar.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: foobar'], { cwd: dir });
      const foobarHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      assertExit(runHandoff(['request', 'T06', '--write-files', 'src/foo'], dir), 0);
      const resExact = runHandoff(['result', 'T06', JSON.stringify({
        status: 'DONE', taskId: 'T06', commitHash: foobarHash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resExact, 1);
      assertOut(resExact, '超出 writeFiles 范围');
      // ⑨ --json-file 缺值(最后一个参数)→ 用法错误(与 record 对齐;修复前报类型 TypeError)
      const missingVal = runHandoff(['result', 'T07', '--json-file'], dir);
      assertExit(missingVal, 1);
      assertOut(missingVal, '--json-file requires a path argument');
      // ⑨b --json-file 空串(--json-file= 形式)→ 同样用法错误(修复前解析为 runRoot 报 EISDIR)
      const emptyVal = runHandoff(['result', 'T07', '--json-file='], dir);
      assertExit(emptyVal, 1);
      assertOut(emptyVal, '--json-file requires a path argument');
      // ⑪ 部分通配负例:allowed=[src/*.mjs] 不得匹配 src/b.ts(段内正则锚定,
      // 扩展名不匹配 → 新 change BLOCKED;若实现放宽为任意匹配即 RED)
      writeFile(dir, 'src/b.ts', 'export const b = 1;\n');
      execFileSync('git', ['add', 'src/b.ts'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: b.ts'], { cwd: dir });
      const bHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      assertExit(runHandoff(['request', 'T08', '--write-files', 'src/*.mjs'], dir), 0);
      const resGlobNeg = runHandoff(['result', 'T08', JSON.stringify({
        status: 'DONE', taskId: 'T08', commitHash: bHash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resGlobNeg, 1);
      assertOut(resGlobNeg, '超出 writeFiles 范围');
      // ⑩ 部分段通配:allowed=[src/*.mjs] 应匹配提交 src/a.mjs → 无越界(修复前
      // 段内 glob 被字面比较,新 change 误 BLOCKED——此处应 RED)
      writeFile(dir, 'src/a.mjs', 'export const a = 1;\n');
      execFileSync('git', ['add', 'src/a.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: a.mjs'], { cwd: dir });
      const aHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      assertExit(runHandoff(['request', 'T07', '--write-files', 'src/*.mjs'], dir), 0);
      const resGlob = runHandoff(['result', 'T07', JSON.stringify({
        status: 'DONE', taskId: 'T07', commitHash: aHash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resGlob, 0);
      assertNotOut(resGlob, '超出 writeFiles 范围');

      // ⑫ 零提交正例（真实 request/result 链路）：临时 git 仓内 .specs/ 被 gitignore，
      //    TASK 的 write_files 全为字面 .specs/... 路径 → request 记 noCommit:true + 审计行；
      //    result 回传无 commitHash 的零提交契约 → 无 HANDOFF ERROR、exit 0、记录写入成功。
      const f6StatePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="T12" status="pending"><action>账本同步</action>'
        + '<write_files>.specs/' + CHANGE_ID + '/T12-SUMMARY.md</write_files>'
        + '<verify>echo ok</verify></task>\n');
      const stIgnored = readStateFile(dir);
      stIgnored.newChange = true;
      writeState(dir, stIgnored);
      const reqIgnored = runHandoff(['request', 'T12'], dir, { FLOW_COMET_PROTOCOL: '' });
      assertExit(reqIgnored, 0);
      assertOut(reqIgnored, 'HANDOFF REQUEST: T12');
      // 协议不可读边界（真实链路）：runHandoff 不默认注入协议（独立于 runGuard/runState），
      // 此处显式清空协议环境变量以固定「临时 runRoot 无可用协议」形态——归属门禁必须输出
      // 可见 WARN（原因 + 本次未执行归属校验）后放行，不得静默 skip，且零提交资格等既有
      // 请求行为不变。
      assertOut(reqIgnored, 'WARN:');
      assertOut(reqIgnored, '协议不可读');
      assertOut(reqIgnored, '本次未执行归属校验');
      assertOut(reqIgnored, 'HANDOFF 零提交资格: T12');
      const stIgnoredReq = readStateFile(dir);
      if (stIgnoredReq.evidence['subagent-execute'].handoffRequests['T12'].noCommit !== true) {
        throw new Error('字面 gitignored write_files 的 request 应记录 noCommit:true: '
          + JSON.stringify(stIgnoredReq.evidence['subagent-execute'].handoffRequests['T12']));
      }
      const ignoredBytes = fs.readFileSync(f6StatePath, 'utf8');
      const resIgnored = runHandoff(['result', 'T12', JSON.stringify({
        status: 'DONE', taskId: 'T12', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'echo ok' },
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resIgnored, 0);
      assertOut(resIgnored, 'HANDOFF RESULT: T12');
      assertOut(resIgnored, 'HANDOFF 零提交: T12');
      assertNotOut(resIgnored, 'HANDOFF ERROR');
      assertNotOut(resIgnored, 'BLOCKED');
      const stIgnoredResult = readStateFile(dir);
      const ignoredRecord = stIgnoredResult.evidence['subagent-execute'].handoffResult['T12'];
      if (!ignoredRecord || ignoredRecord.result?.noCommit !== true || ignoredRecord.result.commitHash !== undefined) {
        throw new Error('零提交 result 应写入无 commitHash 的契约: ' + JSON.stringify(ignoredRecord));
      }
      if (fs.readFileSync(f6StatePath, 'utf8') === ignoredBytes) {
        throw new Error('零提交 result 应真实写入 state');
      }

      // ⑫b 并行 × 零提交（真实 request/result 链路）：同一零提交资格在 parallel="true" 任务上
      //     照常成立——并行维度不改四属性映射：① 写权限走身份通道、② 提交隔离走既有 noCommit
      //     资格（零提交 ⇒ 无提交，提交隔离由「无提交」满足）。任务归属 subagent-execute
      //     （并行 pending），request 记 noCommit:true、result 回传无 commitHash 的零提交契约
      //     ⇒ exit 0、不因并行维度被契约校验拦。前提在场锚：TASK.md 该任务确带 parallel="true"，
      //     且归属校验真实执行（协议可读、节点已 entry——不静默退化成串行/跳过形态）。
      const parallelTaskPath = path.join(dir, '.specs', CHANGE_ID, 'TASK.md');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="P16" parallel="true" status="pending"><action>并行账本同步</action>'
        + '<write_files>.specs/' + CHANGE_ID + '/P16-SUMMARY.md</write_files>'
        + '<verify>echo ok</verify></task>\n');
      if (!fs.readFileSync(parallelTaskPath, 'utf8').includes('<task id="P16" parallel="true" status="pending">')) {
        throw new Error('并行 × 零提交锚的前提失效：TASK.md 未标 parallel="true"');
      }
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir), 0);
      const stParallel = readStateFile(dir);
      stParallel.currentNode = 'subagent-execute';
      stParallel.enteredNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      stParallel.newChange = true;
      writeState(dir, stParallel);
      const parallelEnv = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const reqParallel = runHandoff(['request', 'P16', '并行零提交任务委托'], dir, parallelEnv);
      assertExit(reqParallel, 0);
      assertOut(reqParallel, 'HANDOFF REQUEST: P16');
      assertOut(reqParallel, 'HANDOFF 零提交资格: P16');
      assertNotOut(reqParallel, '本次未执行归属校验');
      assertNotOut(reqParallel, '尚未 entry');
      const parallelReqRecord = readStateFile(dir).evidence['subagent-execute'].handoffRequests.P16;
      if (!parallelReqRecord || parallelReqRecord.noCommit !== true) {
        throw new Error('并行任务的字面 gitignored write_files 应同样记录 noCommit:true: ' + JSON.stringify(parallelReqRecord));
      }
      const resParallel = runHandoff(['result', 'P16', JSON.stringify({
        status: 'DONE', taskId: 'P16', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'echo ok' },
        greenEvidence: { command: 'echo ok', output: 'ok' },
      })], dir);
      assertExit(resParallel, 0);
      assertOut(resParallel, 'HANDOFF RESULT: P16');
      assertOut(resParallel, 'HANDOFF 零提交: P16');
      assertNotOut(resParallel, 'HANDOFF ERROR');
      assertNotOut(resParallel, 'BLOCKED');
      const parallelResultRecord = readStateFile(dir).evidence['subagent-execute'].handoffResult.P16;
      if (!parallelResultRecord || parallelResultRecord.result?.noCommit !== true
        || parallelResultRecord.result.commitHash !== undefined) {
        throw new Error('并行零提交 result 应写入无 commitHash 的契约: ' + JSON.stringify(parallelResultRecord));
      }
      console.log('  AC-9 并行×零提交: parallel="true" 任务 request 记 noCommit:true → result 无 commitHash 契约通过（exit 0）✓');

      // ⑬ 零提交负例：无资格形态（glob / .. 越界 / 非 git 仓 / tracked 文件）→ request 不记 noCommit
      const assertNoCommitNotRecorded = (root, taskId, label) => {
        const requestState = readStateFile(root);
        const requestRecord = requestState.evidence?.['subagent-execute']?.handoffRequests?.[taskId];
        if (!requestRecord || requestRecord.noCommit === true) {
          throw new Error(label + ' 的 request 不应记录 noCommit: ' + JSON.stringify(requestRecord));
        }
      };
      const reqGlob = runHandoff(['request', 'T13', '--write-files', '.specs/' + CHANGE_ID + '/*.md'], dir);
      assertExit(reqGlob, 0);
      assertNotOut(reqGlob, 'HANDOFF 零提交资格');
      assertNoCommitNotRecorded(dir, 'T13', 'glob write_files');
      const reqDotDot = runHandoff(['request', 'T14', '--write-files', '../evil.mjs'], dir);
      assertExit(reqDotDot, 0);
      assertNotOut(reqDotDot, 'HANDOFF 零提交资格');
      assertNoCommitNotRecorded(dir, 'T14', '.. 越界 write_files');
      writeFile(dir, 'src/tracked-zero.mjs', 'export const tracked = 1;\n');
      execFileSync('git', ['add', 'src/tracked-zero.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: tracked zero'], { cwd: dir });
      const reqTracked = runHandoff(['request', 'T15', '--write-files', 'src/tracked-zero.mjs'], dir);
      assertExit(reqTracked, 0);
      assertNotOut(reqTracked, 'HANDOFF 零提交资格');
      assertNoCommitNotRecorded(dir, 'T15', 'tracked write_files');
      // 协议副本随目录预置（与运行器夹具同形）；本目录由本项自行清理，不登记到套件收尾的残留判据
      const nonGitRoot = makeTmp({ protocol: true });
      try {
        writeState(nonGitRoot, {
          activeChange: CHANGE_ID,
          currentNode: 'review',
          completedNodes: [],
          evidence: {},
          verifyFailures: 0,
          executionMode: 'subagent',
          directOverride: false,
          newChange: true,
        });
        const reqNonGit = runHandoff(['request', 'T16', '--write-files', '.specs/' + CHANGE_ID + '/x.md'], nonGitRoot,
          { GIT_CEILING_DIRECTORIES: os.tmpdir() });
        assertExit(reqNonGit, 0);
        assertNotOut(reqNonGit, 'HANDOFF 零提交资格');
        assertNoCommitNotRecorded(nonGitRoot, 'T16', '非 git 仓 write_files');
      } finally {
        fs.rmSync(nonGitRoot, { recursive: true, force: true });
      }

      // ⑭ 归属门禁事故回放与恢复（真实命令链路）：stale currentNode=execute（并行任务未消化、
      //    execute 已在完成集合内）→ request BLOCK（state 字节零改写、不落 handoffRequests，
      //    指引 next/entry）→ next 校正 state.currentNode → entry 正确节点 → request/result 成功。
      const ownershipEnv = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        evidence: { execute: { summary: 'previous pass executed' }, 'subagent-execute': { summary: 'previous wave collected' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      });
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md',
        '# DESIGN\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 0. 技术栈选定\n\nNode.js(ESM)\n\n## 决策清单\n\n- [ ] 循环路由\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="P02" parallel="true" status="pending">\n  <action>实现 P02</action>\n  <write_files>src/p02.mjs</write_files>\n  <verify>node --check src/p02.mjs</verify>\n</task>\n');
      writeFile(dir, 'src/p02.mjs', 'export const p02 = 2;\n');
      execFileSync('git', ['add', 'src/p02.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'feat: p02'], { cwd: dir });
      const p02Hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      assertExit(runState(['skill-load', 'execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir), 0);
      const ownershipStatePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const ownershipBytes = fs.readFileSync(ownershipStatePath, 'utf8');
      const wrongNode = runHandoff(['request', 'P02', 'P02 委托', '--write-files', 'src/p02.mjs'], dir, ownershipEnv);
      assertExit(wrongNode, 1);
      assertOut(wrongNode, 'BLOCKED');
      assertOut(wrongNode, '应归属节点 subagent-execute');
      assertOut(wrongNode, '原始 currentNode=execute');
      assertOut(wrongNode, 'workflow-state next');
      assertOut(wrongNode, 'entry subagent-execute');
      assertNotOut(wrongNode, 'HANDOFF REQUEST');
      if (fs.readFileSync(ownershipStatePath, 'utf8') !== ownershipBytes) {
        throw new Error('归属门禁 BLOCK 不得改写 state 字节（含 handoffRequests）');
      }
      if (readStateFile(dir).evidence?.['subagent-execute']?.handoffRequests?.P02) {
        throw new Error('归属门禁 BLOCK 不得落 handoffRequests');
      }
      const correction = runState(['next'], dir);
      assertExit(correction, 0);
      assertNodeLine(correction, 'subagent-execute');
      if (readStateFile(dir).currentNode !== 'subagent-execute') {
        throw new Error('next 未按路由校正 state.currentNode: ' + JSON.stringify(readStateFile(dir).currentNode));
      }
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir), 0);
      assertExit(runGuard(['entry', 'subagent-execute'], dir), 0);
      const correctedRequest = runHandoff(['request', 'P02', 'P02 委托', '--write-files', 'src/p02.mjs'], dir, ownershipEnv);
      assertExit(correctedRequest, 0);
      assertOut(correctedRequest, 'HANDOFF REQUEST: P02');
      const correctedResult = runHandoff(['result', 'P02', JSON.stringify({
        status: 'DONE', taskId: 'P02', commitHash: p02Hash,
        changedFiles: ['src/p02.mjs'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check src/p02.mjs' },
        greenEvidence: { command: 'node --check src/p02.mjs', output: 'ok' },
      })], dir);
      assertExit(correctedResult, 0);
      assertOut(correctedResult, 'HANDOFF RESULT: P02');
      assertNotOut(correctedResult, 'HANDOFF ERROR');

      // ⑭b 依赖未满足的并行 pending 委派（真实命令链路）：request BLOCK 且指引与 next 实际
      //     输出一致（next 输出 execute）→ 按输出进入 execute 消化串行依赖 → 依赖满足后
      //     next 输出 subagent-execute → entry 后 request 成功（无 entry 死路）。
      const unmetTaskContent = (s04Status) =>
        '# TASK\n\n<task id="S04" parallel="false" status="' + s04Status + '"><action>实现 S04</action>'
        + '<write_files>src/s04.mjs</write_files><verify>node --check src/s04.mjs</verify></task>\n'
        + '<task id="P05" parallel="true" status="pending"><action>实现 P05</action>'
        + '<write_files>src/p05.mjs</write_files><verify>node --check src/p05.mjs</verify>'
        + '<depends_on>S04</depends_on></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', unmetTaskContent('pending'));
      const unmetBytesBefore = fs.readFileSync(ownershipStatePath, 'utf8');
      const unmetRequest = runHandoff(['request', 'P05', 'P05 委托（依赖未满足）', '--write-files', 'src/p05.mjs'], dir, ownershipEnv);
      assertExit(unmetRequest, 1);
      assertOut(unmetRequest, 'BLOCKED');
      assertOut(unmetRequest, '当前不可委托');
      assertOut(unmetRequest, '依赖未满足');
      assertOut(unmetRequest, '未完成: S04');
      assertOut(unmetRequest, 'workflow-state next');
      assertOut(unmetRequest, '若输出 execute 表示依赖未满足');
      assertOut(unmetRequest, '待任务变为可委托');
      assertNotOut(unmetRequest, 'entry subagent-execute');
      assertNotOut(unmetRequest, 'HANDOFF REQUEST');
      if (fs.readFileSync(ownershipStatePath, 'utf8') !== unmetBytesBefore) {
        throw new Error('依赖未满足 BLOCK 不得改写 state 字节（含 handoffRequests）');
      }
      if (readStateFile(dir).evidence?.['subagent-execute']?.handoffRequests?.P05) {
        throw new Error('依赖未满足 BLOCK 不得落 handoffRequests');
      }
      // 按 next 实际输出进入 execute 消化串行依赖（指引条件分支与真实路由一致）
      const unmetNext = runState(['next'], dir);
      assertExit(unmetNext, 0);
      assertNodeLine(unmetNext, 'execute');
      if (readStateFile(dir).currentNode !== 'execute') {
        throw new Error('依赖未满足时 next 应把工作归属校正到 execute: ' + JSON.stringify(readStateFile(dir).currentNode));
      }
      // 串行依赖消化完成（execute 生命周期闭合：completedNodes/evidence 推进）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', unmetTaskContent('done'));
      const afterSerialState = readStateFile(dir);
      afterSerialState.completedNodes = [...new Set([...(afterSerialState.completedNodes || []), 'execute'])];
      afterSerialState.evidence = { ...(afterSerialState.evidence || {}), execute: { summary: 'serial dependency digested' } };
      writeState(dir, afterSerialState);
      const delegableNext = runState(['next'], dir);
      assertExit(delegableNext, 0);
      assertNodeLine(delegableNext, 'subagent-execute');
      if (readStateFile(dir).currentNode !== 'subagent-execute') {
        throw new Error('依赖满足后 next 应把工作归属推到 subagent-execute');
      }
      assertExit(runGuard(['entry', 'subagent-execute'], dir), 0);
      const recoveredRequest = runHandoff(['request', 'P05', 'P05 委托（依赖已满足）', '--write-files', 'src/p05.mjs'], dir, ownershipEnv);
      assertExit(recoveredRequest, 0);
      assertOut(recoveredRequest, 'HANDOFF REQUEST: P05');

      // ⑮ result 重验零提交资格（真实命令链路）：合法零提交 result 无 HANDOFF ERROR；
      //    request 后修改 .gitignore（路径不再被忽略）→ 新 change BLOCK（request 证据 noCommit
      //    置 false、不落 result）；修正 .gitignore 后重新 request/result 恢复通过。
      writeFile(dir, '.gitignore', '.specs/\n');
      const writeM13Task = (taskId, files) => writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="' + taskId + '" status="done">\n  <action>交付 ' + taskId + '</action>\n'
        + '  <write_files>' + files + '</write_files>\n  <verify>echo ok</verify>\n</task>\n');
      const zeroCommitContract = (taskId) => JSON.stringify({
        status: 'DONE', taskId: taskId, noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'echo ok' },
        greenEvidence: { command: 'echo ok', output: 'ok' },
      });
      // F6 撤销审计断言（真实链路）：noCommit=false + 非空、可被 Date 解析的 revokedAt +
      // 与失败类别对应的 revokeReason；三种真实失败形态分别断言类别（过期资格 / tracked / 逃逸）。
      const assertRevokeAudit = (record, expectedReason, label) => {
        if (!record || record.noCommit !== false) {
          throw new Error(label + ' 应撤销 noCommit=false: ' + JSON.stringify(record));
        }
        if (typeof record.revokedAt !== 'string' || record.revokedAt.trim() === '' || Number.isNaN(Date.parse(record.revokedAt))) {
          throw new Error(label + ' 应记录非空且可被 Date 解析的 revokedAt: ' + JSON.stringify(record));
        }
        if (record.revokeReason !== expectedReason) {
          throw new Error(label + ' 应记录 revokeReason=' + expectedReason + ': ' + JSON.stringify(record.revokeReason));
        }
      };
      writeM13Task('Z01', '.specs/' + CHANGE_ID + '/Z01-SUMMARY.md');
      const z01Request = runHandoff(['request', 'Z01'], dir, ownershipEnv);
      assertExit(z01Request, 0);
      assertOut(z01Request, 'HANDOFF 零提交资格: Z01');
      if (readStateFile(dir).evidence['subagent-execute'].handoffRequests.Z01.noCommit !== true) {
        throw new Error('request 应记录字面 gitignored 路径的零提交资格');
      }
      const z01Result = runHandoff(['result', 'Z01', zeroCommitContract('Z01')], dir);
      assertExit(z01Result, 0);
      assertOut(z01Result, 'HANDOFF RESULT: Z01');
      assertOut(z01Result, 'HANDOFF 零提交: Z01');
      assertNotOut(z01Result, 'HANDOFF ERROR');
      assertNotOut(z01Result, 'BLOCKED');

      writeM13Task('Z02', '.specs/' + CHANGE_ID + '/Z02.md');
      const z02Request = runHandoff(['request', 'Z02'], dir, ownershipEnv);
      assertExit(z02Request, 0);
      assertOut(z02Request, 'HANDOFF 零提交资格: Z02');
      writeFile(dir, '.gitignore', 'node_modules/\n');
      const z02Blocked = runHandoff(['result', 'Z02', zeroCommitContract('Z02')], dir);
      assertExit(z02Blocked, 1);
      assertOut(z02Blocked, 'HANDOFF ERROR');
      assertOut(z02Blocked, '零提交资格 result 重验失败');
      assertNotOut(z02Blocked, 'HANDOFF RESULT');
      let m13State = readStateFile(dir);
      if (m13State.evidence['subagent-execute'].handoffRequests.Z02.noCommit !== false) {
        throw new Error('重验失败应把 request evidence 的 noCommit 置 false: '
          + JSON.stringify(m13State.evidence['subagent-execute'].handoffRequests.Z02));
      }
      assertRevokeAudit(m13State.evidence['subagent-execute'].handoffRequests.Z02,
        'stale-eligibility', 'Z02 忽略规则变化重验');
      assertOut(z02Blocked, 'revokeReason=stale-eligibility');
      if (m13State.evidence['subagent-execute'].handoffResult?.Z02) {
        throw new Error('新 change 重验失败不得落 result');
      }
      writeFile(dir, '.gitignore', '.specs/\n');
      const z02Recover = runHandoff(['request', 'Z02'], dir, ownershipEnv);
      assertExit(z02Recover, 0);
      assertOut(z02Recover, 'HANDOFF 零提交资格: Z02');
      const z02RecoverResult = runHandoff(['result', 'Z02', zeroCommitContract('Z02')], dir);
      assertExit(z02RecoverResult, 0);
      assertNotOut(z02RecoverResult, 'HANDOFF ERROR');

      // ⑯ request 后路径变为 tracked → result 重验失败 → 新 change BLOCK（资格撤销留痕）
      writeM13Task('Z03', '.specs/' + CHANGE_ID + '/Z03.md');
      writeFile(dir, '.specs/' + CHANGE_ID + '/Z03.md', 'tracked-after-request\n');
      const z03Request = runHandoff(['request', 'Z03'], dir, ownershipEnv);
      assertExit(z03Request, 0);
      assertOut(z03Request, 'HANDOFF 零提交资格: Z03');
      execFileSync('git', ['add', '-f', '.specs/' + CHANGE_ID + '/Z03.md'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: z03 tracked'], { cwd: dir });
      const z03Blocked = runHandoff(['result', 'Z03', zeroCommitContract('Z03')], dir);
      assertExit(z03Blocked, 1);
      assertOut(z03Blocked, 'HANDOFF ERROR');
      assertOut(z03Blocked, '重验失败');
      if (readStateFile(dir).evidence['subagent-execute'].handoffRequests.Z03.noCommit !== false) {
        throw new Error('tracked 形态应撤销零提交资格');
      }
      const z03Revoked = readStateFile(dir).evidence['subagent-execute'].handoffRequests.Z03;
      assertRevokeAudit(z03Revoked, 'became-tracked', 'Z03 路径变 tracked 重验');
      assertOut(z03Blocked, 'revokeReason=became-tracked');

      // ⑰ symlink/junction 逃逸：request 时路径尚未存在 → 记资格；result 前落 junction 指向 runRoot
      //    外 → 重验拒绝（fail-closed）；request 时即存在 junction → 资格直接不成立（越权负例）。
      const escapeTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-comet-system-escape-'));
      const removeEscapeLink = (link) => {
        try { fs.unlinkSync(link); } catch { try { fs.rmdirSync(link); } catch { /* 已清理 */ } }
      };
      const z04Link = path.join(dir, '.specs', CHANGE_ID, 'z04-link');
      const z05Link = path.join(dir, '.specs', CHANGE_ID, 'z05-link');
      try {
        writeM13Task('Z04', '.specs/' + CHANGE_ID + '/z04-link');
        const z04Request = runHandoff(['request', 'Z04'], dir, ownershipEnv);
        assertExit(z04Request, 0);
        assertOut(z04Request, 'HANDOFF 零提交资格: Z04');
        fs.symlinkSync(escapeTarget, z04Link, process.platform === 'win32' ? 'junction' : 'dir');
        const z04Blocked = runHandoff(['result', 'Z04', zeroCommitContract('Z04')], dir);
        assertExit(z04Blocked, 1);
        assertOut(z04Blocked, 'HANDOFF ERROR');
        assertOut(z04Blocked, '重验失败');
        if (readStateFile(dir).evidence['subagent-execute'].handoffRequests.Z04.noCommit !== false) {
          throw new Error('symlink/junction 逃逸应撤销零提交资格');
        }
        assertRevokeAudit(readStateFile(dir).evidence['subagent-execute'].handoffRequests.Z04,
          'symlink-junction-escape', 'Z04 symlink/junction 逃逸重验');
        assertOut(z04Blocked, 'revokeReason=symlink-junction-escape');
        writeM13Task('Z05', '.specs/' + CHANGE_ID + '/z05-link');
        fs.symlinkSync(escapeTarget, z05Link, process.platform === 'win32' ? 'junction' : 'dir');
        const z05Request = runHandoff(['request', 'Z05'], dir, ownershipEnv);
        assertExit(z05Request, 0);
        assertOut(z05Request, 'HANDOFF REQUEST: Z05');
        assertNotOut(z05Request, 'HANDOFF 零提交资格');
        if (readStateFile(dir).evidence['subagent-execute'].handoffRequests.Z05.noCommit === true) {
          throw new Error('request 时已存在的 symlink/junction 不得被判定零提交资格');
        }
        removeEscapeLink(z05Link);
      } finally {
        removeEscapeLink(z04Link);
        removeEscapeLink(z05Link);
        fs.rmSync(escapeTarget, { recursive: true, force: true });
      }

      // ⑱ state 协议绑定（真实命令链路）：init --protocol 自定义协议（无 execute /
      //    subagent-execute 节点）→ state.protocolPath 持久化 → handoff request 按该协议
      //    判定（无对应 enabled 委托节点 → 跳过归属校验、不 BLOCK）。env 指向内置协议，
      //    协议来源未持久化时会误判串行 pending 归属 execute → BLOCK（修复前 RED）。
      const boundChange = 'bound-proto-real';
      const boundProtocol = JSON.parse(fs.readFileSync(path.join(dir, 'reference', 'workflow-protocol.json'), 'utf8'));
      boundProtocol.nodes = boundProtocol.nodes.filter((n) => n.id !== 'execute' && n.id !== 'subagent-execute');
      writeFile(dir, 'reference/protocol-bound.json', JSON.stringify(boundProtocol, null, 2) + '\n');
      assertExit(runState(['init', boundChange, '--init-skip', '--protocol', 'reference/protocol-bound.json'], dir), 0);
      writeFile(dir, '.specs/' + boundChange + '/TASK.md',
        '# TASK\n\n<task id="R01" parallel="false" status="pending"><action>实现 R01</action>'
        + '<write_files>src/r01.mjs</write_files><verify>node --check src/r01.mjs</verify></task>\n');
      const boundRequest = runHandoff(['request', 'R01', 'bound protocol serial'], dir, ownershipEnv);
      assertExit(boundRequest, 0);
      assertOut(boundRequest, 'HANDOFF REQUEST: R01');
      assertNotOut(boundRequest, 'BLOCKED');
      assertNotOut(boundRequest, '本次未执行归属校验');
      const boundState = readStateFile(dir);
      if (boundState.protocolPath !== 'reference/protocol-bound.json') {
        throw new Error('init --protocol 应把解析后的协议路径持久化为项目根相对形态，实际: '
          + JSON.stringify(boundState.protocolPath));
      }
      if (!boundState.evidence?.['subagent-execute']?.handoffRequests?.R01) {
        throw new Error('state 绑定协议下的 request 应照常落库');
      }
    },
  },

  {
    name: 'C2 handoff：红绿证据时间序（先红后绿通过 / 补录拦截）',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      // ① 先记录 RED（TDD 红）
      const red = '{"redEvidence":{"command":"node --check src/p1.mjs"}}';
      const r1 = runHandoff(['result', 'P01', red], dir);
      assertExit(r1, 0);
      assertOut(r1, 'HANDOFF RESULT: P01');
      // ② 同批补 GREEN → 通过，且附带 recordedAt 时间戳（时序可审计）
      const both = '{"redEvidence":{"command":"node --check src/p1.mjs"},"greenEvidence":{"command":"node --check src/p1.mjs"}}';
      const r2 = runHandoff(['result', 'P01', both], dir);
      assertExit(r2, 0);
      const st = readStateFile(dir);
      const rec = st.evidence['subagent-execute'].handoffResult['P01'].result;
      if (!rec.redEvidence.recordedAt || typeof rec.redEvidence.recordedAt !== 'string') {
        throw new Error('redEvidence 未附带 recordedAt: ' + JSON.stringify(rec.redEvidence));
      }
      if (!rec.greenEvidence.recordedAt || typeof rec.greenEvidence.recordedAt !== 'string') {
        throw new Error('greenEvidence 未附带 recordedAt: ' + JSON.stringify(rec.greenEvidence));
      }
      // ③ 新任务：先 GREEN 后补 RED → 事后补录拦截
      const greenOnly = '{"greenEvidence":{"command":"node --check src/p2.mjs"}}';
      assertExit(runHandoff(['result', 'P02', greenOnly], dir), 0);
      const backfill = '{"greenEvidence":{"command":"node --check src/p2.mjs"},"redEvidence":{"command":"node --check src/p2.mjs"}}';
      const r3 = runHandoff(['result', 'P02', backfill], dir);
      assertExit(r3, 1);
      assertOut(r3, 'redEvidence 事后补录');
    },
  },

  {
    name: 'C3 委托后 exit：证据键名契约与契约校验（通过 / 空交接拦截 / 在飞委托拦·收工放行 / 留痕可读）',
    run: (dir) => {
      gitInit(dir);
      writeFile(dir, 'src/p1.mjs', 'export const x = 1;\n');
      execFileSync('git', ['add', 'src/p1.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'feat: p1'], { cwd: dir });
      const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      // ① 空交接拦截：record 仅写空 handoffResult → 出口缺证据（无委托不可 exit）
      assertExit(runState(['init', CHANGE_ID], dir), 0);
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir), 0);
      assertExit(runState(['record', 'subagent-execute', '{"handoffResult":{}}'], dir), 0);
      const stEmpty = readStateFile(dir);
      stEmpty.currentNode = 'subagent-execute';
      writeState(dir, stEmpty);
      assertExit(runGuard(['entry', 'subagent-execute'], dir), 0);
      const blocked = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'requires evidence: handoff-result');
      // ② 真实委托链路：request 声明边界(新 change 强制 write_files 来源)→ handoff result
      // 回传完整契约（键名契约：嵌套 handoffResult 识别 + Return Contract 校验）→ 出口通过
      const st2 = readStateFile(dir);
      st2.evidence['subagent-execute'] = { summary: 'delegated and collected' };
      writeState(dir, st2);
      const reqP01 = runHandoff(['request', 'P01', '委托实现 P01', '--write-files', 'src/p1.mjs'], dir);
      assertExit(reqP01, 0);
      const result = runHandoff(['result', 'P01', fullContract(hash, 'P01')], dir);
      assertExit(result, 0);
      assertOut(result, 'HANDOFF RESULT: P01');
      const pass = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(pass, 0);
      assertOut(pass, 'ALL CHECKS PASSED');
      // ② M5 自动补不得为 handoff scope 技能写协调者标记(flow-comet-dev 由子代理加载,
      // 协调者不声明——修复前 record 无条件写标记,语义误导;此处应 RED)
      const markerDev = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'subagent-execute-flow-comet-dev.json');
      if (fs.existsSync(markerDev)) {
        const markerDevObj = JSON.parse(fs.readFileSync(markerDev, 'utf8'));
        if (markerDevObj.auto === true) throw new Error('M5 不应为 handoff scope 技能自动补标记');
      }
      // ③ 契约缺完成检查清单 → 出口拦截（严格校验无豁免）——重写证据时保留委托请求
      // (新 change 强制 write_files 边界来源;直接 result 无 request 会被边界检查拦截)
      const st3 = readStateFile(dir);
      const keepRequests = st3.evidence['subagent-execute'].handoffRequests;
      st3.evidence['subagent-execute'] = { summary: 'delegated', ...(keepRequests ? { handoffRequests: keepRequests } : {}) };
      writeState(dir, st3);
      const weak = JSON.parse(fullContract(hash, 'P01'));
      delete weak.completedChecks;
      assertExit(runHandoff(['result', 'P01', JSON.stringify(weak)], dir), 0);
      const reenter = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(reenter, 1);
      assertOut(reenter, 'Return Contract 校验失败');
      // 移除手动声明标记，回到「仅有 open 声明、无 subagent-execute 声明」的激活机制形态
      fs.rmSync(markerDev, { force: true });
      // ⑫ 声明机制激活下的 subagent-execute 声明要求(自动补标记跳过 handoff scope 后的
      // 固化行为):有 open 标记(声明机制已激活)但无 subagent-execute 声明 → exit BLOCKED;
      // 手动 skill-load 声明(协调者按 4-dev.md 构造 handoff prompt 的真实动作)后 → 通过
      writeFile(dir, 'flow-kit/prompts/4-dev.md', '# 阶段 4 · DEV\n\n## 角色\n\n你是 Developer。\n');
      const stDecl = readStateFile(dir);
      stDecl.evidence['subagent-execute'] = { summary: 'delegated', handoffResult: { P01: { result: JSON.parse(fullContract(hash, 'P01')) } } };
      writeState(dir, stDecl);
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const rDeclBlock = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(rDeclBlock, 1);
      assertOut(rDeclBlock, 'exit 缺协议声明标记');
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir), 0);
      const rDeclPass = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(rDeclPass, 0);
      assertOut(rDeclPass, 'ALL CHECKS PASSED');
      // ⑬ 验证隔离真实链路（在飞委托 = 写者未收工）：登记第二个委托请求而不落结果 ⇒ 出口
      //     BLOCKED 并点名未收工任务 + 恢复指引；收工（落结果）后同一出口放行——「同一时刻只有
      //     一个写者」的机器可判形态走真实命令序列（request → exit 拦 → result → exit 放行）。
      writeFile(dir, 'src/p2.mjs', 'export const y = 2;\n');
      execFileSync('git', ['add', 'src/p2.mjs'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'feat: p2'], { cwd: dir });
      const hash2 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      assertExit(runHandoff(['request', 'P02', '委托实现 P02', '--write-files', 'src/p2.mjs'], dir), 0);
      const inFlightBlocked = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(inFlightBlocked, 1);
      assertOut(inFlightBlocked, '在飞委托');
      assertOut(inFlightBlocked, '待写入者收工后重跑');
      assertOut(inFlightBlocked, 'P02');
      assertExit(runHandoff(['result', 'P02', fullContract(hash2, 'P02')], dir), 0);
      const collected = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(collected, 0);
      assertOut(collected, 'ALL CHECKS PASSED');
      assertNotOut(collected, '在飞委托');
      // ⑮ 撤回通道真实链路（被遗弃的交接的受支持出口）：登记第三个委托而不落结果 ⇒ 出口拦并给出
      //    该命令的恢复指引；用 workflow-handoff.mjs withdraw 撤回（原地留痕 withdrawnAt /
      //    withdrawnBy，历史不删）⇒ 同一出口放行。反向构造：守卫不忽略已撤回的 request ⇒ 放行断言
      //    必红；撤回是终态 ⇒ 同一条目再次 result 被拒（撤回不被事后「复活」）。
      assertExit(runHandoff(['request', 'P03', '委托实现 P03', '--write-files', 'src/p3.mjs'], dir), 0);
      const abandonedBlocked = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(abandonedBlocked, 1);
      assertOut(abandonedBlocked, '在飞委托');
      assertOut(abandonedBlocked, 'workflow-handoff.mjs withdraw');
      const noSource = runHandoff(['withdraw', 'P03'], dir);
      assertExit(noSource, 1);
      assertOut(noSource, '--by');
      const withdrawRes = runHandoff(['withdraw', 'P03', '--by', 'coordinator', '--reason', '零提交复验失败后作废'], dir);
      assertExit(withdrawRes, 0);
      assertOut(withdrawRes, 'HANDOFF WITHDRAW: P03');
      const stWithdraw = readStateFile(dir);
      const p03 = stWithdraw.evidence?.['subagent-execute']?.handoffRequests?.P03;
      if (!p03 || typeof p03.withdrawnAt !== 'string' || p03.withdrawnAt.trim() === '' || p03.withdrawnBy !== 'coordinator') {
        throw new Error('撤回留痕未落原记录（withdrawnAt + withdrawnBy）: ' + JSON.stringify(p03));
      }
      if (!Array.isArray(p03.writeFiles) || p03.writeFiles[0] !== 'src/p3.mjs') {
        throw new Error('撤回不得删除原 request 字段（writeFiles 应原样保留）: ' + JSON.stringify(p03));
      }
      // 时间纪律（真实链路）：新写入路径走 time-utils 单一权威 ⇒ withdrawnAt 为标准形态
      // （本地时间 + 显式偏移），非裸 Z 拼接。
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(p03.withdrawnAt)) {
        throw new Error('withdrawnAt 应为标准形态（本地时间 + 显式偏移，走 time-utils 的 nowTimestamp）: '
          + JSON.stringify(p03.withdrawnAt));
      }
      const releasedExit = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(releasedExit, 0);
      assertOut(releasedExit, 'ALL CHECKS PASSED');
      assertNotOut(releasedExit, '在飞委托');
      const revived = runHandoff(['result', 'P03', fullContract(hash2, 'P03')], dir);
      assertExit(revived, 1);
      assertOut(revived, '已撤回（终态）');
      // ⑯ 派遣留痕可读且零新增 state 顶层字段：留痕落在既有嵌套字段（与 handoffRequests /
      //     handoffResult 同族），state 顶层不得出现任何留痕族键。
      const stTrace = readStateFile(dir);
      if (!stTrace.evidence?.['subagent-execute']?.handoffRequests?.P02) {
        throw new Error('委派留痕未落嵌套证据字段（handoffRequests.P02 缺失）: ' + JSON.stringify(stTrace.evidence));
      }
      if (stTrace.handoffRequests !== undefined || stTrace.handoffResult !== undefined) {
        throw new Error('留痕出现在 state 顶层字段（应为嵌套同族形态）');
      }
      for (const key of Object.keys(stTrace)) {
        if (/handoff|delegation|dispatch|trace/i.test(key)) {
          throw new Error('state 顶层出现留痕族字段: ' + key + '（零新增顶层字段约束被破坏）');
        }
      }
    },
  },

];
