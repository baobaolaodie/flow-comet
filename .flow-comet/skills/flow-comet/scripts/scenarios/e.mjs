// 场景组 e — 单一来源静态锁 · 零提交滥用负例 · 模板保真扩展 · verify 降级
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界：场景序列按组文件规模上限连续分区——本文件头部两项（154 · 155）落在 scenarios/d.mjs 尾部；
// 分区只搬文件，场景名/内容与拼接顺序不变（见 scenarios/d.mjs 头注）。

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
  runGuard,
  runHandoff,
  runState,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  REPO_ROOT,
  SCRIPTS_DIR,
  TASK_DONE,
  TASK_SERIAL_PENDING,
  engineConsumersOf,
  engineDefinitionHits,
  engineDefinitionModule,
  engineScriptTexts,
  dropNamedImport,
  handoffFor,
  makeTmp,
  runPlanExit,
  writeIntakeArtifacts,
} from '../lib/test-fixtures.mjs';
import {
  assertRevocationAudit,
  readScenarioState,
  runGuardWithProtocol,
  runStateWithProtocol,
  scenarioProtocolPath,
} from '../lib/test-assertions.mjs';
import {
  singleSourceImportProblems,
  skillLoadingWordingProblems,
  twoLayerEntryProblems,
} from '../lib/text-anchor-checks.mjs';

export const ENTRIES = [

  // ---------- 场景（mechanism-skill-robustness 试先行 RED：共享判定单一来源 / --json-file 消息分级 /
  // 启发式安全侧边界锚定 / 零提交正式语义 / SUMMARY·TASK7·三文档模板保真 / 技能加载前置门 /
  // next·entry 输出点名 / 技能加载措辞 / next 进行中节点保护扩展） ----------

  // 156: 疑似对象启发式安全侧边界锚定（设计语义 / AC-4）——内联纯文本恰好以 [ 开头 → 启发式判为
  // 疑似对象、JSON.parse 失败 → fail-closed（exit 1 + 提示、不落库）。当前即如此 → 本场景 GREEN
  {
    name: '156 启发式安全侧边界：内联纯文本以 [ 开头 → fail-closed（锚定现状）',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      const res = runStateWithProtocol(dir, ['record', 'open', '[plain-text-not-json']);
      assertExit(res, 1);
      if (!/--json-file|not valid JSON|不是合法 JSON/.test(res.output)) {
        throw new Error('fail-closed 应有提示（--json-file / not valid JSON / 不是合法 JSON），实际输出: ' + res.output);
      }
      // fail-closed：evidence 不被污染
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st2.evidence.open || st2.evidence.open.summary !== 'intake complete') {
        throw new Error('纯文本以 [ 开头应 fail-closed 不落库，state 被污染: ' + JSON.stringify(st2.evidence.open));
      }
    },
  },

  // 157: 零提交任务正例（设计语义 / AC-5 / AC-7）——① request write_files 为空 + 契约显式 noCommit +
  // result 无任何提交 → 跳过提交文件子集校验并输出可审计"零提交"提示（不误 BLOCK）；
  // ② 真实 request（F-6）：临时 git 仓 + .gitignore 忽略 .specs/，TASK write_files 全为字面
  // .specs/... 路径 → 引擎记 handoffRequests.<id>.noCommit=true（可证明全部 gitignored）；
  // result 回传无 commitHash 的零提交契约 → 记录成功、输出"零提交"、无 HANDOFF ERROR。
  // 修复前 request 只认「<write_files> 元素存在且为空」→ ② 无 noCommit → 预期 RED。
  {
    name: '157 零提交正例：空 write_files 跳过校验；全字面 gitignored 真实 request 记 noCommit',
    run: (dir) => {
      // ① 空 write_files 既有正例（request 落库夹具；零回归锚）
      const st = baseState('subagent-execute');
      st.newChange = true;
      st.evidence['subagent-execute'] = { handoffRequests: { T01: { description: 'zero-commit task', writeFiles: [] } } };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" status="done"><action>only docs already tracked</action><write_files></write_files><verify>node --check src/t1.mjs</verify></task>\n');
      const res = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check src/t1.mjs', output: 'no output（RED 锚点）' },
        greenEvidence: { command: 'node --check src/t1.mjs', output: 'ok' },
      })], dir);
      assertExit(res, 0);
      assertOut(res, '零提交');
      // ② 全字面 gitignored 正例：临时 git 仓 + .gitignore 忽略 .specs/；真实 request 自动解析 TASK.md
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      writeFile(dir, '.gitignore', '.specs/\n');
      writeFile(dir, 'baseline.js', 'export const baseline = 1;\n');
      git('add', '.gitignore', 'baseline.js');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init baseline');
      // write_files 全为字面 .specs/...（被 .gitignore 忽略；不要求预先存在——check-ignore 按规则判）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="T02" status="done"><action>写变更内部面工件</action>'
        + '<write_files>\n.specs/' + CHANGE_ID + '/notes/T02.md\n.specs/' + CHANGE_ID + '/T02-SUMMARY.md\n</write_files>'
        + '<verify>node --check baseline.js</verify></task>\n');
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/subagent-execute-flow-comet-dev.json',
        JSON.stringify({ node: 'subagent-execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const st2 = baseState('subagent-execute');
      st2.newChange = true;
      writeState(dir, st2);
      const resReq = runHandoff(['request', 'T02', 'delegate docs-only slice'], dir);
      assertExit(resReq, 0);
      assertOut(resReq, 'HANDOFF REQUEST: T02');
      // 先断资格落库（RED 取证点：修复前 request 只认空 write_files → 此断言先红），后断审计文案
      const stAfter = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const req = stAfter.evidence['subagent-execute'].handoffRequests.T02;
      if (!req || req.noCommit !== true) {
        throw new Error('全字面 gitignored write_files 应记 noCommit:true，实际 ' + JSON.stringify(req));
      }
      assertOut(resReq, '零提交资格');
      const resZero = runHandoff(['result', 'T02', JSON.stringify({
        status: 'DONE', taskId: 'T02', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check baseline.js', output: 'no output（RED 锚点）' },
        greenEvidence: { command: 'node --check baseline.js', output: 'ok' },
      })], dir);
      assertExit(resZero, 0);
      assertOut(resZero, '零提交');
      assertNotOut(resZero, 'HANDOFF ERROR');
      // ③ m-13 result 重验失败（.gitignore 变化）新 change：HANDOFF ERROR + request.noCommit 置 false
      // + 不落/不覆盖 result（资格建立后把 .specs/ 从忽略规则移除 → 重验失败）
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const priorCompletedAt = JSON.parse(fs.readFileSync(statePath, 'utf8'))
        .evidence['subagent-execute'].handoffResult.T02.completedAt;
      writeFile(dir, '.gitignore', 'baseline-only\n');
      const resRevalBlock = runHandoff(['result', 'T02', JSON.stringify({
        status: 'DONE', taskId: 'T02', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check baseline.js', output: 'ok' },
        greenEvidence: { command: 'node --check baseline.js', output: 'ok' },
      })], dir);
      assertExit(resRevalBlock, 1);
      assertOut(resRevalBlock, 'HANDOFF ERROR');
      assertOut(resRevalBlock, 'noCommit=false');
      assertOut(resRevalBlock, '不落 result');
      const stRevalBlock = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const reqBlocked = stRevalBlock.evidence['subagent-execute'].handoffRequests.T02;
      if (!reqBlocked || reqBlocked.noCommit !== false) {
        throw new Error('result 重验失败应把 request.noCommit 置 false，实际 ' + JSON.stringify(reqBlocked));
      }
      if (stRevalBlock.evidence['subagent-execute'].handoffResult.T02.completedAt !== priorCompletedAt) {
        throw new Error('新 change result 重验失败不得覆盖既有 handoffResult（completedAt 变化）');
      }
      // F6 审计：忽略规则变化（过期资格）撤销必须留 at/reason，且失败类别与既有归类一致
      assertRevocationAudit(reqBlocked, 'stale-eligibility', '157③ 新 change .gitignore 变化');
      assertOut(resRevalBlock, 'revokedAt=');
      assertOut(resRevalBlock, 'revokeReason=stale-eligibility');
      // ④ 旧 change 同构造：HANDOFF WARN + 照常落 result + noCommit 同样置 false（渐进兼容）
      writeFile(dir, '.gitignore', '.specs/\n'); // 恢复忽略规则 → 重新 request 取得资格
      const stReReq = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      delete stReReq.newChange; // 旧 change = 缺省/null（validator 不接受 false）
      writeState(dir, stReReq);
      assertExit(runHandoff(['request', 'T02', 'delegate docs-only slice again'], dir), 0);
      const stReReqAfter = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (stReReqAfter.evidence['subagent-execute'].handoffRequests.T02.noCommit !== true) {
        throw new Error('恢复忽略规则后重新 request 应重新取得 noCommit 资格，实际 '
          + JSON.stringify(stReReqAfter.evidence['subagent-execute'].handoffRequests.T02));
      }
      const legacyCompletedAt = stReReqAfter.evidence['subagent-execute'].handoffResult.T02.completedAt;
      writeFile(dir, '.gitignore', 'baseline-only\n');
      const resRevalWarn = runHandoff(['result', 'T02', JSON.stringify({
        status: 'DONE', taskId: 'T02', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check baseline.js', output: 'ok' },
        greenEvidence: { command: 'node --check baseline.js', output: 'ok' },
      })], dir);
      assertExit(resRevalWarn, 0);
      assertOut(resRevalWarn, 'HANDOFF WARN');
      assertOut(resRevalWarn, 'noCommit=false');
      const stRevalWarn = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (stRevalWarn.evidence['subagent-execute'].handoffRequests.T02.noCommit !== false) {
        throw new Error('旧 change 重验失败同样应撤销 request.noCommit，实际 '
          + JSON.stringify(stRevalWarn.evidence['subagent-execute'].handoffRequests.T02));
      }
      // F6 审计：旧 change 渐进撤销同样必须留 at/reason（与失败类别对应）
      assertRevocationAudit(stRevalWarn.evidence['subagent-execute'].handoffRequests.T02,
        'stale-eligibility', '157④ 旧 change .gitignore 变化');
      assertOut(resRevalWarn, 'revokeReason=stale-eligibility');
      const legacyResult = stRevalWarn.evidence['subagent-execute'].handoffResult.T02;
      if (!legacyResult || legacyResult.completedAt === legacyCompletedAt || legacyResult.result.noCommit !== true) {
        throw new Error('旧 change 重验失败应照常落 result（渐进），实际 ' + JSON.stringify(legacyResult));
      }
    },
  },

  // 158: 零提交滥用负例（设计语义 / AC-6 / AC-8）——① write_files 非空任务的结果契约声称 noCommit
  // → 不得借零提交声明绕过真实提交检查：仍走完整提交文件子集校验（越界 → 新 change BLOCK），且输出
  // 可审计的"零提交声明与 write_files 非空矛盾"提示；
  // ② F-6 请求侧 fail-closed：glob 魔法 / 路径越界（../）/ 非 git 仓 / 非 git top-level 的 runRoot
  // → request 不记 noCommit（不阻断原流程、仍记 writeFiles）；
  // ③ 请求无资格 + 契约声称 noCommit → 仍完整校验（WARN + 越界 BLOCK，零提交声明无效）。
  {
    name: '158 零提交滥用负例：非空声称 noCommit 仍完整校验；glob/越界/非 git/非 top-level 请求不记 noCommit',
    run: (dir) => {
      const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      g(['init', '-q']);
      g(['config', 'user.email', 't@t']);
      g(['config', 'user.name', 't']);
      writeFile(dir, 'allowed.js', 'export const allowed = 1;\n');
      writeFile(dir, 'rogue.js', 'export const rogue = 1;\n');
      g(['add', 'allowed.js', 'rogue.js']);
      g(['commit', '-qm', 'init']);
      const hash = g(['rev-parse', 'HEAD']).stdout.trim();
      const st = baseState('subagent-execute');
      st.newChange = true;
      st.evidence['subagent-execute'] = { handoffRequests: { T01: { description: 'normal task', writeFiles: ['allowed.js'] } } };
      writeState(dir, st);
      const res = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', noCommit: true, commitHash: hash,
        changedFiles: ['allowed.js', 'rogue.js'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check allowed.js', output: 'no output（RED 锚点）' },
        greenEvidence: { command: 'node --check allowed.js', output: 'ok' },
      })], dir);
      assertExit(res, 1);
      assertOut(res, '超出 writeFiles 范围');
      assertOut(res, '零提交');
      // ② F-6 请求侧 fail-closed：不具资格形态 → request 不记 noCommit、不阻断原流程。
      // 夹具加强：.gitignore 同时忽略 src/gen/ 与 .specs/——globs/子目录锚的路径在缺判定时会
      // 被 git check-ignore 命中，故必须由字面/包含判定本身拒绝，锚才具备判别力（可反向构造红）。
      writeFile(dir, '.gitignore', 'src/gen/\n.specs/\n');
      // 请求夹具（旧 change 语义：技能加载门 WARN 渐进，不干扰本锚）
      writeState(dir, baseState('subagent-execute'));
      const readReq = (id) => {
        const s = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
        return (s.evidence['subagent-execute'].handoffRequests || {})[id];
      };
      const requestWithWriteFiles = (id, writeFilesElement) => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
          + '<task id="' + id + '" status="done"><action>边界任务</action>'
          + '<write_files>' + writeFilesElement + '</write_files>'
          + '<verify>node --check allowed.js</verify></task>\n');
        const r = runHandoff(['request', id, 'boundary slice'], dir);
        assertExit(r, 0);
        return r;
      };
      // ②a glob 魔法 `*` → 无可证明资格（不展开 glob、不享受零提交）
      const resGlob = requestWithWriteFiles('T02', 'src/gen/*.mjs');
      assertNotOut(resGlob, 'HANDOFF ERROR');
      const reqGlob = readReq('T02');
      if (!reqGlob || reqGlob.noCommit === true) {
        throw new Error('glob write_files 不应具备零提交资格，实际 ' + JSON.stringify(reqGlob));
      }
      if (!Array.isArray(reqGlob.writeFiles) || reqGlob.writeFiles[0] !== 'src/gen/*.mjs') {
        throw new Error('不具资格也不得丢失 writeFiles 记录: ' + JSON.stringify(reqGlob.writeFiles));
      }
      // ②b 路径越界（../ 逃逸 runRoot）→ 无资格
      requestWithWriteFiles('T03', '../../outside.md');
      const reqEscape = readReq('T03');
      if (!reqEscape || reqEscape.noCommit === true) {
        throw new Error('../ 逃逸 write_files 不应具备零提交资格，实际 ' + JSON.stringify(reqEscape));
      }
      // ②c 非 git 仓（独立临时目录，无 .git）→ 无资格；场景自建临时目录须自清理
      //（运行器只回收场景主目录；残留校验会抓走漏——故 try/finally 内自删）
      const nonGit = makeTmp();
      try {
        writeFile(nonGit, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
          + '<task id="T04" status="done"><action>边界任务</action>'
          + '<write_files>.specs/' + CHANGE_ID + '/x.md</write_files>'
          + '<verify>node --check allowed.js</verify></task>\n');
        writeState(nonGit, baseState('subagent-execute'));
        const resNonGit = runHandoff(['request', 'T04', 'non-git slice'], nonGit);
        assertExit(resNonGit, 0);
        const stNonGit = JSON.parse(fs.readFileSync(path.join(nonGit, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
        const reqNonGit = stNonGit.evidence['subagent-execute'].handoffRequests.T04;
        if (!reqNonGit || reqNonGit.noCommit === true) {
          throw new Error('非 git 仓不应具备零提交资格，实际 ' + JSON.stringify(reqNonGit));
        }
      } finally {
        fs.rmSync(nonGit, { recursive: true, force: true });
      }
      // ②d runRoot 非 git top-level（仓内子目录）→ 无资格
      writeFile(dir, 'sub/.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="T05" status="done"><action>边界任务</action>'
        + '<write_files>.specs/' + CHANGE_ID + '/x.md</write_files>'
        + '<verify>node --check allowed.js</verify></task>\n');
      const sub = path.join(dir, 'sub');
      writeState(sub, baseState('subagent-execute'));
      const resSub = runHandoff(['request', 'T05', 'subdir slice'], sub);
      assertExit(resSub, 0);
      const stSub = JSON.parse(fs.readFileSync(path.join(sub, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const reqSub = stSub.evidence['subagent-execute'].handoffRequests.T05;
      if (!reqSub || reqSub.noCommit === true) {
        throw new Error('runRoot 非 git top-level 不应具备零提交资格，实际 ' + JSON.stringify(reqSub));
      }
      // ②e/②f m-13 symlink/junction 逃逸（Windows junction 先例）：request 时刻逐段 lstat
      // 拒绝 symlink/junction 祖先；result 时刻对资格重验——资格建立后把真实目录替换为
      // junction 指向 runRoot 外 → 新 change HANDOFF ERROR、noCommit 撤销、不落 result。
      const outsideDir = makeTmp();
      const linkPathA = path.join(dir, 'linked-out');
      const linkPathB = path.join(dir, 'linked-out2');
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      try {
        writeFile(outsideDir, 'escape.md', 'outside\n');
        // ②e request 资格拒绝：write_files 祖先段为 junction（目标在 runRoot 外），即使
        // .gitignore 命中该路径也不得授予零提交（旧实现只看 check-ignore → noCommit:true = RED）
        fs.symlinkSync(outsideDir, linkPathA, linkType);
        writeFile(dir, '.gitignore', 'linked-out/\n');
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
          + '<task id="T06" status="done"><action>symlink 边界任务</action>'
          + '<write_files>linked-out/escape.md</write_files>'
          + '<verify>node --check allowed.js</verify></task>\n');
        writeState(dir, baseState('subagent-execute'));
        const resLink = runHandoff(['request', 'T06', 'symlink slice'], dir);
        assertExit(resLink, 0);
        const stLink = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
        const reqLink = stLink.evidence['subagent-execute'].handoffRequests.T06;
        if (!reqLink || reqLink.noCommit === true) {
          throw new Error('symlink/junction 祖先不得具备零提交资格（fail-closed），实际 ' + JSON.stringify(reqLink));
        }
        // ②f result 重验拒绝：先以真实目录建立资格，再把目录替换为 junction → 重验失败
        writeFile(dir, 'linked-out2/escape.md', 'inside\n');
        writeFile(dir, '.gitignore', 'linked-out2/\n');
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
          + '<task id="T07" status="done"><action>junction 重验边界任务</action>'
          + '<write_files>linked-out2/escape.md</write_files>'
          + '<verify>node --check allowed.js</verify></task>\n');
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/subagent-execute-flow-comet-dev.json',
          JSON.stringify({ node: 'subagent-execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
        const stReqLink = baseState('subagent-execute');
        stReqLink.newChange = true;
        writeState(dir, stReqLink);
        const resReqLink = runHandoff(['request', 'T07', 'junction revalidate slice'], dir);
        assertExit(resReqLink, 0);
        const stReqLinkAfter = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
        if (stReqLinkAfter.evidence['subagent-execute'].handoffRequests.T07.noCommit !== true) {
          throw new Error('真实目录 + 命中忽略规则时 request 应取得 noCommit 资格，实际 '
            + JSON.stringify(stReqLinkAfter.evidence['subagent-execute'].handoffRequests.T07));
        }
        fs.rmSync(linkPathB, { recursive: true, force: true });
        fs.symlinkSync(outsideDir, linkPathB, linkType);
        const resRevalLink = runHandoff(['result', 'T07', JSON.stringify({
          status: 'DONE', taskId: 'T07', noCommit: true,
          completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
          redEvidence: { command: 'node --check allowed.js', output: 'ok' },
          greenEvidence: { command: 'node --check allowed.js', output: 'ok' },
        })], dir);
        assertExit(resRevalLink, 1);
        assertOut(resRevalLink, 'HANDOFF ERROR');
        assertOut(resRevalLink, 'noCommit=false');
        const stRevalLink = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
        if (stRevalLink.evidence['subagent-execute'].handoffRequests.T07.noCommit !== false) {
          throw new Error('junction 逃逸重验失败应撤销 request.noCommit，实际 '
            + JSON.stringify(stRevalLink.evidence['subagent-execute'].handoffRequests.T07));
        }
        // F6 审计：symlink/junction 逃逸撤销留 at/reason，类别与既有失败归类一致
        assertRevocationAudit(stRevalLink.evidence['subagent-execute'].handoffRequests.T07,
          'symlink-junction-escape', '158②f junction/symlink 重验');
        assertOut(resRevalLink, 'revokeReason=symlink-junction-escape');
        if (stRevalLink.evidence['subagent-execute'].handoffResult?.T07) {
          throw new Error('junction 逃逸重验失败不得落 handoffResult');
        }
      } finally {
        for (const linkPath of [linkPathA, linkPathB]) {
          try { fs.unlinkSync(linkPath); } catch { try { fs.rmdirSync(linkPath); } catch { /* 已移除 */ } }
        }
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
      // ③ 请求无资格（glob）+ 契约声称 noCommit → 仍完整提交文件子集校验（越界新 change BLOCK）
      const stIneligible = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      stIneligible.newChange = true;
      writeState(dir, stIneligible);
      writeFile(dir, 'src/deep/rogue.js', 'export const deepRogue = 1;\n');
      g(['add', 'src/deep/rogue.js']);
      g(['commit', '-qm', 'deep rogue']);
      const deepHash = g(['rev-parse', 'HEAD']).stdout.trim();
      const resIneligible = runHandoff(['result', 'T02', JSON.stringify({
        status: 'DONE', taskId: 'T02', noCommit: true, commitHash: deepHash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check allowed.js', output: 'ok' },
        greenEvidence: { command: 'node --check allowed.js', output: 'ok' },
      })], dir);
      assertExit(resIneligible, 1);
      assertOut(resIneligible, '契约声明零提交但 write_files 非空');
      assertOut(resIneligible, '超出 writeFiles 范围');
    },
  },

  // 159: SUMMARY 模板保真（设计语义 / AC-7）——execute 出口每份 *-SUMMARY.md 须含 `# SUMMARY:` 标题 +
  // 首部 4 字段（Change ID/Task ID/完成时间/AI 角色）+ 段序（含 flow-comet 增量 ## 自检方法 段）。
  // 缺任一：新 change BLOCK（exit 1 + 缺失点与恢复指引）；合法变体（编号前缀/括号后缀/大小写）通过；
  // 旧 change → WARN 渐进。当前 guard 只查 verify输出/6维自查/越界检查 3 段存在 → 缺标题等场景 RED。
  // ⑫⑬ 追加 6 维自查段提取的段尾判定回归锚（段内大写 Z 早于方法名 ⇒ 不得误拦；方法声明真缺席 ⇒
  // 仍须 BLOCK）——与模板保真共用同一新 change 严格出口链路。
  {
    name: '159 execute exit SUMMARY 模板保真：缺标题/首部/段序新 BLOCK，合法变体通过，旧 WARN；6 维段内大写 Z 不误拦 + 未声明仍 BLOCK',
    run: (dir) => {
      const marker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/execute-flow-comet-dev.json',
          JSON.stringify({ node: 'execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      const header = [
        '- **Change ID**: ' + CHANGE_ID,
        '- **Task ID**: T01',
        '- **完成时间**: 2026-08-20 10:00',
        '- **AI 角色**: Dev',
      ].join('\n');
      const sectionText = {
        what: '## 做了什么\n\n实现 T01（TDD：先写失败场景再实现）。',
        files: '## 改动文件\n\n| 文件 | 性质 | 说明 |\n|---|---|---|\n| src/t1.mjs | 修改 | 实现 T01 |',
        verify: '## verify 输出\n\n```\nnode --check src/t1.mjs\n```',
        sixDim: '## 6 维自查\n\n- 功能: 通过（brooks-review 已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
        db: '## 数据库迁移\n\nN/A：本任务无 schema 变更。',
        bounds: '## 越界检查\n\n仅修改 src/t1.mjs，无越界。',
        breaking: '## 破坏性变更\n\nN/A：本任务不涉及破坏性变更。',
        deviation: '## 决策与偏离\n\n无偏离。',
        newWork: '## 是否触发新工作\n\n无。',
        done: '## 完成判定\n\n- TASK.md 中对应任务已勾选：是',
        method: '## 自检方法\n\nbrooks-review',
      };
      // 模板序 = flow-kit/templates/SUMMARY.md 全部 H2（含 5 个条件段）；## 自检方法 不属骨架，
      // 单独按位置校核（文末或紧随 ## 越界检查两种合法位置）。
      const skeletonOrder = [sectionText.what, sectionText.files, sectionText.verify, sectionText.sixDim,
        sectionText.db, sectionText.bounds, sectionText.breaking, sectionText.deviation, sectionText.newWork, sectionText.done];
      const fullSections = [...skeletonOrder, sectionText.method]; // 自检方法在文末（合法位置一）
      const afterBoundsSections = [...skeletonOrder.slice(0, 6), sectionText.method, ...skeletonOrder.slice(6)]; // 紧随越界（合法位置二）
      const illegalSelfSections = [...skeletonOrder.slice(0, 4), sectionText.method, ...skeletonOrder.slice(4)]; // 自检方法夹在中间（非法）
      const missingTailSections = [...skeletonOrder.slice(0, 9), sectionText.method]; // 缺尾段 完成判定
      const outOfOrderSections = [
        ...skeletonOrder.slice(0, 5), sectionText.bounds, sectionText.db, ...skeletonOrder.slice(6), sectionText.method,
      ]; // 数据库迁移排到越界检查之后（段序偏离）
      const compose = (title, order) =>
        [title, '', header, '', '---', '', order.join('\n\n')].join('\n');
      const setupExecute = (newChange) => {
        const st = baseState('execute');
        st.evidence.execute = { summary: 'executed' };
        st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
        if (newChange) { st.newChange = true; st.enteredNodes = ['execute']; }
        writeState(dir, st);
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
        marker();
      };
      // ① 新 change：缺 `# SUMMARY:` 标题（段齐全）→ BLOCK
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# T01-SUMMARY', fullSections));
      const res1 = runGuard(['exit', 'execute'], dir);
      assertExit(res1, 1);
      assertOut(res1, 'BLOCKED');
      assertOut(res1, '# SUMMARY:');
      // ② 新 change：标题在但首部缺字段（仅 2 字段）→ BLOCK
      const headerMissing = [
        '- **Change ID**: ' + CHANGE_ID,
        '- **Task ID**: T01',
      ].join('\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md',
        ['# SUMMARY: T01 - 实现 T01', '', headerMissing, '', '---', '', fullSections.join('\n\n')].join('\n'));
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 1);
      assertOut(res2, 'BLOCKED');
      // ③ 新 change：段序乱（自检方法提前、做了什么滞后）→ BLOCK
      const scrambled = [
        sectionText.verify, sectionText.bounds, sectionText.sixDim, sectionText.method,
        sectionText.what, sectionText.files, sectionText.db, sectionText.breaking,
        sectionText.deviation, sectionText.newWork, sectionText.done,
      ];
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', scrambled));
      const res3 = runGuard(['exit', 'execute'], dir);
      assertExit(res3, 1);
      assertOut(res3, 'BLOCKED');
      // ④ 合法变体：大小写（# Summary: …）→ 通过
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# Summary: T01 - 实现 T01', fullSections));
      const res4 = runGuard(['exit', 'execute'], dir);
      assertExit(res4, 0);
      assertOut(res4, 'ALL CHECKS PASSED');
      // ⑤ 合法变体：括号后缀 → 通过
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01（含说明括号）', fullSections));
      const res5 = runGuard(['exit', 'execute'], dir);
      assertExit(res5, 0);
      assertOut(res5, 'ALL CHECKS PASSED');
      // ⑥ 旧 change：缺标题 → WARN 渐进不阻断
      setupExecute(false);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# T01-SUMMARY', fullSections));
      const res6 = runGuard(['exit', 'execute'], dir);
      assertExit(res6, 0);
      assertOut(res6, 'WARN');
      // ⑦ 起：写入 SUMMARY 模板副本——M1 全骨架硬阻断只在 runRoot 内存在
      // flow-kit/templates/SUMMARY.md 时生效（模板缺失仅内置骨架提示，不新增 BLOCK）。
      // 维护者工作副本含 vendored flow-kit → 复制真实模板；CI 全新检出 flow-kit 被
      // .gitignore 排除（不可分发）→ 用与真实模板 H2 逐字对齐的内置镜像（skeleton 派生结果
      // 等价），保证硬阻断锚在两级载体都可执行、不静默跳过。
      const realSummaryTemplate = path.join(REPO_ROOT, 'flow-kit', 'templates', 'SUMMARY.md');
      const summaryTemplateFixture = fs.existsSync(realSummaryTemplate)
        ? fs.readFileSync(realSummaryTemplate, 'utf8')
        : [
            '# SUMMARY: <T01 - 任务名>',
            '',
            '## 做了什么（一段话）',
            '',
            '## 改动文件',
            '',
            '## verify 输出（必填）',
            '',
            '## 6 维自查（生产代码改动必填 · 来自 4-dev 步骤 4）',
            '',
            '## 数据库迁移（涉及 schema 变更必填 · 来自 4-dev 步骤 1.7 / R4.5）',
            '',
            '## 越界检查（必填 · 来自 4-dev 步骤 5 / R6.5 / B3 老项目护栏）',
            '',
            '## 破坏性变更（涉及破坏性改动必填 · 来自 4-dev 步骤 1.8 / R4.6 / B4 老项目护栏）',
            '',
            '## 决策与偏离（如有）',
            '',
            '## 是否触发新工作',
            '',
            '## 完成判定',
            '',
          ].join('\n');
      writeFile(dir, 'flow-kit/templates/SUMMARY.md', summaryTemplateFixture);
      // ⑦ 新 change 缺尾段（完成判定）→ BLOCK + 缺段 + 「补 N/A 段」恢复指引
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', missingTailSections));
      const res7 = runGuard(['exit', 'execute'], dir);
      assertExit(res7, 1);
      assertOut(res7, 'BLOCKED');
      assertOut(res7, '完成判定');
      assertOut(res7, 'N/A');
      // ⑧ 段序偏离（数据库迁移排到越界检查之后）→ BLOCK + 段序 + 缺段点可定位
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', outOfOrderSections));
      const res8 = runGuard(['exit', 'execute'], dir);
      assertExit(res8, 1);
      assertOut(res8, 'BLOCKED');
      assertOut(res8, '段序');
      assertOut(res8, '数据库迁移');
      // ⑨ 合法位置一：## 自检方法 位于文末 → 通过（真实模板在场）
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', fullSections));
      const res9 = runGuard(['exit', 'execute'], dir);
      assertExit(res9, 0);
      assertOut(res9, 'ALL CHECKS PASSED');
      assertNotOut(res9, 'BLOCKED');
      // ⑩ 合法位置二：## 自检方法 紧随 ## 越界检查 之后 → 通过（真实模板在场）
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', afterBoundsSections));
      const res10 = runGuard(['exit', 'execute'], dir);
      assertExit(res10, 0);
      assertOut(res10, 'ALL CHECKS PASSED');
      assertNotOut(res10, 'BLOCKED');
      // ⑪ 自检方法位置非法（夹在 6 维自查与数据库迁移之间）→ BLOCK
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', illegalSelfSections));
      const res11 = runGuard(['exit', 'execute'], dir);
      assertExit(res11, 1);
      assertOut(res11, 'BLOCKED');
      assertOut(res11, '自检方法');
      // ⑫ 6 维自查段提取的段尾判定（常驻回归锚 · 假阳性误拦位点）：段内**早于**方法名出现大写 Z
      //    （机检标记字面量形态）——串尾若被写成字面字符 Z，惰性段体在段内首个 Z 处提前收尾，
      //    段内的方法声明被截掉 ⇒ 出口误判「6 维自查未声明自检方法」而 BLOCK。
      //    单变量对照：与 ⑨/⑩ 的无 Z 合规基线相比只多一行 Z 说明（同一份 dims 原文逐字不变），
      //    两者都必须 PASS——即该行不得改变判定（既不放宽也不误拦）。
      const zNote = '> 本任务 diff 属零逻辑改动（机检标记 ZERO-LOGIC-CHANGE-OK），按协议执行 PR Review。';
      const withSixDim = (six) => fullSections.map((s) => (s === sectionText.sixDim ? six : s));
      const sixDimZFirst = sectionText.sixDim.replace('## 6 维自查\n\n', '## 6 维自查\n\n' + zNote + '\n\n');
      assertTrue(sixDimZFirst !== sectionText.sixDim, '单变量前提不成立：6 维自查段标题形态变化，Z 说明行未插入');
      assertEqual(sixDimZFirst.replace('## 6 维自查\n\n' + zNote + '\n\n', '## 6 维自查\n\n'),
        sectionText.sixDim, '单变量前提不成立：Z 说明行不是与无 Z 基线的唯一差异');
      assertTrue(sixDimZFirst.indexOf(zNote) < sixDimZFirst.indexOf('brooks-review'),
        '夹具形态前提不成立：Z 说明行须早于方法声明，否则段尾截断不影响该声明（锚零判别力）');
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', fullSections));
      const res12Base = runGuard(['exit', 'execute'], dir);
      assertExit(res12Base, 0);
      assertOut(res12Base, 'ALL CHECKS PASSED');
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', withSixDim(sixDimZFirst)));
      const res12 = runGuard(['exit', 'execute'], dir);
      assertExit(res12, 0);
      assertOut(res12, 'ALL CHECKS PASSED');
      assertNotOut(res12, 'BLOCKED');
      // ⑬ 判据未放宽对照 + 抽掉必报自证：同 ⑫ 夹具仅抽掉 6 维段内的方法声明行（其余逐字不变）
      //    ⇒ 6 维自查段确实未声明自检方法 ⇒ 仍须 BLOCK，且拦因须落在该判据上（而非段空 / 段缺席）。
      const sixDimNoDecl = sixDimZFirst.replace('- 功能: 通过（brooks-review 已跑）', '- 功能: 通过（内置快查）');
      assertTrue(sixDimNoDecl !== sixDimZFirst, '对照夹具前提不成立：6 维段内方法声明行未命中');
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', withSixDim(sixDimNoDecl)));
      const res13 = runGuard(['exit', 'execute'], dir);
      assertExit(res13, 1);
      assertOut(res13, '6 维自查未声明使用 /brooks-review');
    },
  },

  // 160: plan exit TASK 7 字段完整性（设计语义 / AC-8）——每个 <task> 须含 name/read_files/
  // write_files/action/verify/done/depends_on。缺任一：新 BLOCK；旧 WARN。当前 guard 只查
  // <verify> 存在 → 缺 write_files 场景新 change 应 BLOCK 却放行 → 预期 RED。
  {
    name: '160 plan exit TASK 7 字段：缺 write_files 新 BLOCK / 旧 WARN',
    run: (dir) => {
      const missingWrite =
        '<task id="T01" status="pending"><name>任务一</name><read_files>src/*</read_files><action>实现 T01</action><verify>node --check src/t1.mjs</verify><done>AC-1</done><depends_on></depends_on></task>\n';
      const addPlanMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/plan-flow-comet-task.json',
          JSON.stringify({ node: 'plan', skill: 'flow-comet-task', protocol: '3-task.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      // ① 新 change：缺 write_files → BLOCK（含字段名）
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      addPlanMarker();
      const res = runPlanExit(dir, missingWrite);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'write_files');
      // ② 旧 change：同构造 → WARN 渐进不阻断
      const stOld = baseState('plan');
      stOld.evidence.plan = { summary: 'plan done' };
      writeState(dir, stOld);
      addPlanMarker();
      const resOld = runPlanExit(dir, missingWrite);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');
    },
  },

  // 161: open/design 出口 CHANGE/REQUIREMENT/DESIGN 模板保真（设计语义 / AC-9）——标题
  // （# CHANGE: / # REQUIREMENT: / # DESIGN:）+ 首部 + 段序（模板派生宽松匹配，编号前缀/括号
  // 后缀/大小写兼容，防误拦）。缺任一：新 BLOCK；旧 WARN。当前 guard 只查 Why/用户故事/AC/
  // 决策清单等单段存在 → 缺标题场景新 change 应 BLOCK 却放行 → 预期 RED。
  {
    name: '161 open/design 出口三文档模板保真：缺标题新 BLOCK / 旧 WARN',
    run: (dir) => {
      const addOpenMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
          JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      const addDesignMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/design-flow-comet-design.json',
          JSON.stringify({ node: 'design', skill: 'flow-comet-design', protocol: '2-design.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      // ① open 出口 新 change：REQUIREMENT 缺 `# REQUIREMENT:` 标题（段齐全）→ BLOCK
      const stOpen = baseState('open');
      stOpen.evidence.open = { summary: 'intake complete' };
      stOpen.newChange = true;
      stOpen.enteredNodes = ['open'];
      writeState(dir, stOpen);
      addOpenMarker();
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# 变更文档\n\n## Why（为什么做）\n\n原因。\n\n## 范围（Scope）\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# 需求文档\n\n## 用户故事\n\n- US-1 作为维护者……\n\n## 验收准则（AC）\n\n- Given X When Y Then Z\n');
      const resOpen = runGuard(['exit', 'open'], dir);
      assertExit(resOpen, 1);
      assertOut(resOpen, 'BLOCKED');
      assertOut(resOpen, 'REQUIREMENT');
      // ② design 出口 新 change：DESIGN 缺 `# DESIGN:` 标题（段齐全）→ BLOCK
      const stDesign = baseState('design');
      stDesign.evidence.design = { summary: 'design done' };
      stDesign.newChange = true;
      stDesign.enteredNodes = ['design'];
      writeState(dir, stDesign);
      addDesignMarker();
      writeFile(dir, 'flow-kit/templates/DESIGN.md', '# DESIGN 模板\n\n## 0. 技术栈选型\n## 1. 技术决策清单\n## 2. 数据流\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# 设计文档\n\n## 0. 技术栈选型\n\n- 选定：Node.js\n\n## 决策清单\n\n| # | 决策 | 选择 | 理由 |\n|---|---|---|---|\n| D1 | X | Y | Z |\n');
      const resDesign = runGuard(['exit', 'design'], dir);
      assertExit(resDesign, 1);
      assertOut(resDesign, 'BLOCKED');
      assertOut(resDesign, 'DESIGN');
      // ③ 旧 change open 同构造（REQUIREMENT 缺标题）→ WARN 渐进不阻断
      const stOld = baseState('open');
      stOld.evidence.open = { summary: 'intake complete' };
      writeState(dir, stOld);
      addOpenMarker();
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# 变更文档\n\n## Why（为什么做）\n\n原因。\n\n## 范围（Scope）\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# 需求文档\n\n## 用户故事\n\n- US-1 作为维护者……\n\n## 验收准则（AC）\n\n- Given X When Y Then Z\n');
      const resOld = runGuard(['exit', 'open'], dir);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');
    },
  },

  // 162: 技能加载前置门（设计语义 / AC-10）——新 change：handoff request 无本节点声明标记
  // 应 BLOCK；record 无声明（payload 不含 completedChecks）应 BLOCK；旧 change → WARN 渐进。
  // 当前 request 不查声明、record 靠 M5 自动补 → 不拦 → 预期 RED。
  {
    name: '162 技能加载前置门：request/record 无声明新 BLOCK / 旧 WARN',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) };
      // ① handoff request 前置门：新 change、subagent-execute 节点无声明标记 → BLOCK
      const stReq = baseState('subagent-execute');
      stReq.newChange = true;
      writeState(dir, stReq);
      const resReq = runHandoff(['request', 'T01', 'delegate parallel task'], dir);
      assertExit(resReq, 1);
      assertOut(resReq, '先加载技能');
      // ② record 前置门：新 change、plan 节点无声明标记、payload 不含 completedChecks → BLOCK
      const stRec = baseState('plan');
      stRec.newChange = true;
      writeState(dir, stRec);
      const resRec = runStateWithProtocol(dir, ['record', 'plan', '{"summary":"plan done"}']);
      assertExit(resRec, 1);
      assertOut(resRec, '先加载技能');
      // ③ 旧 change：record 无声明 → WARN 渐进不阻断
      const stOld = baseState('plan');
      writeState(dir, stOld);
      const resOld = runStateWithProtocol(dir, ['record', 'plan', '{"summary":"plan done"}']);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');

      // ===== M-02 request 时刻归属门禁（AC-2 不误伤面）=====
      // 正确节点成功 / 串行错配 BLOCK / 未 entry WARN / done 与显式 write-files 旁路 /
      // 协议无对应 enabled 节点跳过 / 协议不可读可见 WARN 后放行（不静默）。归属门禁位于
      // 技能声明门之后——新 change 夹具必须放入本节点声明标记，否则先被技能门 BLOCK，
      // 测不到归属门禁本身。
      const writeMarker = (node) => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/' + node + '-flow-comet-dev.json',
          JSON.stringify({ node, skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      const taskXml = (id, attrs, writeFiles) =>
        '# TASK\n\n<task id="' + id + '" ' + attrs + '><action>实现 ' + id + '</action>'
        + '<write_files>' + writeFiles + '</write_files><verify>node --check src/x.mjs</verify></task>\n';
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      // ④ 正确节点（subagent-execute）+ pending 并行 → 成功落库（不误伤）
      writeMarker('subagent-execute');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P01', 'parallel="true" status="pending"', 'src/p01.mjs'));
      const stOk = baseState('subagent-execute');
      stOk.newChange = true;
      stOk.enteredNodes = ['subagent-execute'];
      writeState(dir, stOk);
      const resOk = runHandoff(['request', 'P01', 'delegate'], dir, env);
      assertExit(resOk, 0);
      assertOut(resOk, 'HANDOFF REQUEST: P01');
      const recOk = readScenarioState(dir).evidence?.['subagent-execute']?.handoffRequests?.P01;
      if (!recOk) throw new Error('正确节点并行 pending 请求应成功落库，实际 ' + JSON.stringify(recOk));
      // ⑤ 串行 pending 在 subagent-execute 请求（目标 execute 不匹配）→ BLOCK + 字节零改写
      writeMarker('execute');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('S01', 'parallel="false" status="pending"', 'src/s01.mjs'));
      const stSerial = baseState('subagent-execute');
      stSerial.newChange = true;
      stSerial.enteredNodes = ['subagent-execute'];
      writeState(dir, stSerial);
      const beforeSerial = fs.readFileSync(statePath, 'utf8');
      const resSerial = runHandoff(['request', 'S01', 'serial slice'], dir, env);
      assertExit(resSerial, 1);
      assertOut(resSerial, 'BLOCKED: 任务 S01（串行 pending）应归属节点 execute');
      assertOut(resSerial, 'entry execute');
      if (fs.readFileSync(statePath, 'utf8') !== beforeSerial) {
        throw new Error('串行错配 BLOCK 必须 state 字节零改写');
      }
      // ⑥ 正确节点但尚未 entry → 仅 WARN + 照常落库
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('S02', 'parallel="false" status="pending"', 'src/s02.mjs'));
      const stNotEntered = baseState('execute');
      stNotEntered.newChange = true; // enteredNodes 缺 execute
      writeState(dir, stNotEntered);
      const resNotEntered = runHandoff(['request', 'S02', 'serial slice'], dir, env);
      assertExit(resNotEntered, 0);
      assertOut(resNotEntered, 'WARN: 任务 S02 的归属节点 execute 与原始 currentNode 一致');
      assertOut(resNotEntered, '尚未 entry');
      assertOut(resNotEntered, 'HANDOFF REQUEST: S02');
      // ⑦ done 任务补录（非 pending）→ 归属门禁跳过，不误伤
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('D01', 'parallel="true" status="done"', 'src/d01.mjs'));
      const stDone = baseState('execute');
      stDone.newChange = true;
      stDone.enteredNodes = ['execute'];
      writeState(dir, stDone);
      const resDone = runHandoff(['request', 'D01', 'backfill'], dir, env);
      assertExit(resDone, 0);
      assertNotOut(resDone, 'BLOCKED');
      assertOut(resDone, 'HANDOFF REQUEST: D01');
      // ⑧ 显式 --write-files 且 TASK 无匹配任务 → 可见 WARN + 跳过归属门禁（不误伤）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<!-- 无匹配任务块 -->\n');
      const stExplicit = baseState('execute');
      stExplicit.newChange = true;
      stExplicit.enteredNodes = ['execute'];
      writeState(dir, stExplicit);
      const resExplicit = runHandoff(['request', 'X01', 'explicit slice', '--write-files', 'src/x01.mjs'], dir, env);
      assertExit(resExplicit, 0);
      assertOut(resExplicit, '显式 --write-files 且 TASK.md 无匹配任务 X01');
      assertOut(resExplicit, 'HANDOFF REQUEST: X01');
      assertNotOut(resExplicit, 'BLOCKED');
      // ⑨ 协议无对应 enabled 节点 → 跳过归属门禁（删除 subagent-execute 节点）：驻留 execute
      // 但任务为并行 pending——若实现不做协议感知会误判目标 subagent-execute ≠ execute 而 BLOCK
      writeMarker('execute');
      const proto = JSON.parse(fs.readFileSync(scenarioProtocolPath(dir), 'utf8'));
      const noSubProto = { ...proto, nodes: proto.nodes.filter((n) => n.id !== 'subagent-execute') };
      writeFile(dir, 'reference/protocol-nosub.json', JSON.stringify(noSubProto, null, 2) + '\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P02', 'parallel="true" status="pending"', 'src/p02.mjs'));
      const stNoSub = baseState('execute');
      stNoSub.newChange = true;
      stNoSub.enteredNodes = ['execute'];
      writeState(dir, stNoSub);
      const resNoSub = runHandoff(['request', 'P02', 'no-sub protocol'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'protocol-nosub.json') });
      assertExit(resNoSub, 0);
      assertNotOut(resNoSub, 'BLOCKED');
      assertNotOut(resNoSub, '本次未执行归属校验'); // 协议可读且无对应 enabled 节点 → 跳过校验，不产生归属 WARN
      assertOut(resNoSub, 'HANDOFF REQUEST: P02');
      // ⑩ 节点被 disabled → 同样跳过归属门禁
      const disabledProto = { ...proto, nodes: proto.nodes.map((n) => (n.id === 'subagent-execute' ? { ...n, disabled: true } : n)) };
      writeFile(dir, 'reference/protocol-disabled.json', JSON.stringify(disabledProto, null, 2) + '\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P03', 'parallel="true" status="pending"', 'src/p03.mjs'));
      const stDisabled = baseState('execute');
      stDisabled.newChange = true;
      stDisabled.enteredNodes = ['execute'];
      writeState(dir, stDisabled);
      const resDisabled = runHandoff(['request', 'P03', 'disabled protocol'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'protocol-disabled.json') });
      assertExit(resDisabled, 0);
      assertNotOut(resDisabled, 'BLOCKED');
      assertNotOut(resDisabled, '本次未执行归属校验'); // disabled 节点语义与缺节点一致 → 跳过校验且无归属 WARN
      assertOut(resDisabled, 'HANDOFF REQUEST: P03');
      // ⑪ pending 并行任务依赖未满足 → BLOCK 指引与 next 实际输出一致（next 按串行消化输出
      // execute）；依赖满足后按 next 输出进入委托节点，request 恢复成功——无 entry 死路。
      writeIntakeArtifacts(dir);
      const unmetDepsTask =
        '<task id="S03" parallel="false" status="pending"><action>实现 S03</action><write_files>src/s03.mjs</write_files><verify>node --check src/s03.mjs</verify></task>\n' +
        '<task id="P04" parallel="true" status="pending"><action>实现 P04</action><write_files>src/p04.mjs</write_files><verify>node --check src/p04.mjs</verify><depends_on>S03</depends_on></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + unmetDepsTask);
      const stUnmet = baseState('execute');
      stUnmet.newChange = true;
      stUnmet.enteredNodes = ['execute'];
      stUnmet.completedNodes = ['open', 'design', 'plan'];
      stUnmet.evidence = { plan: { summary: 'plan done' } };
      writeState(dir, stUnmet);
      const unmetBytesBefore = fs.readFileSync(statePath, 'utf8');
      const resUnmet = runHandoff(['request', 'P04', 'parallel slice with unmet deps'], dir, env);
      assertExit(resUnmet, 1);
      assertOut(resUnmet, 'BLOCKED: 任务 P04（并行 pending）当前不可委托：依赖未满足');
      assertOut(resUnmet, '未完成: S03');
      assertOut(resUnmet, 'workflow-state next');
      assertOut(resUnmet, '若输出 execute 表示依赖未满足');
      assertOut(resUnmet, '待任务变为可委托');
      assertNotOut(resUnmet, 'entry subagent-execute');
      if (fs.readFileSync(statePath, 'utf8') !== unmetBytesBefore) {
        throw new Error('依赖未满足 BLOCK 必须 state 字节零改写');
      }
      if (readScenarioState(dir).evidence?.['subagent-execute']?.handoffRequests?.P04) {
        throw new Error('依赖未满足 BLOCK 不得落 handoffRequests');
      }
      const resUnmetNext = runStateWithProtocol(dir, ['next']);
      assertExit(resUnmetNext, 0);
      if (!/^NODE: execute$/m.test(resUnmetNext.output)) {
        throw new Error('依赖未满足时 next 应输出 execute：\n' + resUnmetNext.output);
      }
      // 依赖满足：串行任务消化完成后 next 输出 subagent-execute；按输出 entry 后 request 成功
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="S03" parallel="false" status="done"><action>实现 S03</action><write_files>src/s03.mjs</write_files><verify>node --check src/s03.mjs</verify></task>\n'
        + '<task id="P04" parallel="true" status="pending"><action>实现 P04</action><write_files>src/p04.mjs</write_files><verify>node --check src/p04.mjs</verify><depends_on>S03</depends_on></task>\n');
      const afterSerial = readScenarioState(dir);
      afterSerial.completedNodes = [...new Set([...(afterSerial.completedNodes || []), 'execute'])];
      afterSerial.evidence = { ...(afterSerial.evidence || {}), execute: { summary: 'serial digest done' } };
      writeState(dir, afterSerial);
      const resDelegableNext = runStateWithProtocol(dir, ['next']);
      assertExit(resDelegableNext, 0);
      if (!/^NODE: subagent-execute$/m.test(resDelegableNext.output)) {
        throw new Error('依赖满足后 next 应输出 subagent-execute：\n' + resDelegableNext.output);
      }
      if (readScenarioState(dir).currentNode !== 'subagent-execute') {
        throw new Error('依赖满足后 next 应把工作归属推到 subagent-execute');
      }
      writeMarker('subagent-execute');
      assertExit(runGuardWithProtocol(dir, ['entry', 'subagent-execute']), 0);
      const resRecovered = runHandoff(['request', 'P04', 'now delegable'], dir, env);
      assertExit(resRecovered, 0);
      assertOut(resRecovered, 'HANDOFF REQUEST: P04');
      // ⑫ 协议不可读（默认解析指向 runRoot 外的内置协议，受保护读取拒绝）→ 可见 WARN（原因 +
      // 「本次未执行归属校验」）+ 放行语义不变。修复前此形态静默 skip（无 WARN、照常落库）＝假绿。
      writeMarker('execute');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P05', 'parallel="true" status="pending"', 'src/p05.mjs'));
      const stNoProtocol = baseState('execute');
      stNoProtocol.newChange = true;
      stNoProtocol.enteredNodes = ['execute'];
      writeState(dir, stNoProtocol);
      const resNoProtocol = runHandoff(['request', 'P05', 'no protocol'], dir, { FLOW_COMET_PROTOCOL: '' });
      assertExit(resNoProtocol, 0);
      assertOut(resNoProtocol, 'WARN:');
      assertOut(resNoProtocol, '本次未执行归属校验');
      assertOut(resNoProtocol, '协议路径不在当前项目根内');
      assertOut(resNoProtocol, 'HANDOFF REQUEST: P05');
      assertNotOut(resNoProtocol, 'BLOCKED');
      if (!readScenarioState(dir).evidence?.['subagent-execute']?.handoffRequests?.P05) {
        throw new Error('协议不可读应可见 WARN 后照常落库（放行语义不变），实际未落请求记录');
      }
      // ⑬ 协议文件缺失（显式指向 runRoot 内不存在的路径）→ 同类可见 WARN（原因=文件不存在）+ 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P06', 'parallel="true" status="pending"', 'src/p06.mjs'));
      const stProtocolMissing = baseState('execute');
      stProtocolMissing.newChange = true;
      stProtocolMissing.enteredNodes = ['execute'];
      writeState(dir, stProtocolMissing);
      const resProtocolMissing = runHandoff(['request', 'P06', 'missing protocol'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'protocol-missing.json') });
      assertExit(resProtocolMissing, 0);
      assertOut(resProtocolMissing, 'WARN:');
      assertOut(resProtocolMissing, '本次未执行归属校验');
      assertOut(resProtocolMissing, '协议文件不存在');
      assertOut(resProtocolMissing, 'HANDOFF REQUEST: P06');
      assertNotOut(resProtocolMissing, 'BLOCKED');
      // 旧 change 同形态 → 同样仅可见 WARN + 照常落库（协议不可读不区分新旧 change 新增硬 BLOCK）
      const stProtocolMissingOld = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      delete stProtocolMissingOld.newChange;
      writeState(dir, stProtocolMissingOld);
      const resProtocolMissingOld = runHandoff(['request', 'P06', 'missing protocol legacy'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'protocol-missing.json') });
      assertExit(resProtocolMissingOld, 0);
      assertOut(resProtocolMissingOld, '本次未执行归属校验');
      assertOut(resProtocolMissingOld, 'HANDOFF REQUEST: P06');
      assertNotOut(resProtocolMissingOld, 'BLOCKED');
      // ⑭ 协议解析失败（非法 JSON 文件）→ 同类可见 WARN（原因=不是合法 JSON）+ 放行
      writeFile(dir, 'reference/protocol-broken.json', '{ not-json\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P07', 'parallel="true" status="pending"', 'src/p07.mjs'));
      const stProtocolBroken = baseState('execute');
      stProtocolBroken.newChange = true;
      stProtocolBroken.enteredNodes = ['execute'];
      writeState(dir, stProtocolBroken);
      const resProtocolBroken = runHandoff(['request', 'P07', 'broken protocol'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'protocol-broken.json') });
      assertExit(resProtocolBroken, 0);
      assertOut(resProtocolBroken, 'WARN:');
      assertOut(resProtocolBroken, '本次未执行归属校验');
      assertOut(resProtocolBroken, '不是合法 JSON');
      assertOut(resProtocolBroken, 'HANDOFF REQUEST: P07');
      assertNotOut(resProtocolBroken, 'BLOCKED');
      // ⑮ state 协议绑定：init --protocol 指向自定义协议（无 execute / subagent-execute
      // 节点）→ state.protocolPath 持久化；后续 request 按该协议判定，串行 pending 无对应
      // enabled 委托节点 → 跳过归属校验。若协议来源未持久化，env 指向内置协议会把串行
      // pending 误判为归属 execute → BLOCK（修复前 RED）。
      const boundChange = 'bound-proto';
      const boundProtocol = {
        ...proto,
        nodes: proto.nodes.filter((n) => n.id !== 'execute' && n.id !== 'subagent-execute'),
      };
      writeFile(dir, 'reference/protocol-bound.json', JSON.stringify(boundProtocol, null, 2) + '\n');
      assertExit(runState(['init', boundChange, '--init-skip', '--protocol', 'reference/protocol-bound.json'], dir), 0);
      writeFile(dir, '.specs/' + boundChange + '/TASK.md', taskXml('B01', 'parallel="false" status="pending"', 'src/b01.mjs'));
      const resBound = runHandoff(['request', 'B01', 'bound protocol serial'], dir,
        { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
      assertExit(resBound, 0);
      assertOut(resBound, 'HANDOFF REQUEST: B01');
      assertNotOut(resBound, 'BLOCKED');
      assertNotOut(resBound, '本次未执行归属校验'); // 协议可读且无对应 enabled 节点 → 跳过校验，不产生不可读 WARN
      const boundState = readScenarioState(dir);
      if (boundState.protocolPath !== 'reference/protocol-bound.json') {
        throw new Error('init 应把解析后的协议路径持久化为项目根相对形态，实际: ' + JSON.stringify(boundState.protocolPath));
      }
      if (!boundState.evidence?.['subagent-execute']?.handoffRequests?.B01) {
        throw new Error('state 绑定协议下的 request 应照常落库');
      }
      // ⑯ state.protocolPath 存在但不可读 → 不回退 env/默认（回退会按内置协议把串行 pending
      // 误判为归属 execute → BLOCK）；可见 WARN 说明来源 +「本次未执行归属校验」后放行。
      const boundMissingState = readScenarioState(dir);
      boundMissingState.protocolPath = 'reference/protocol-bound-missing.json';
      writeState(dir, boundMissingState);
      writeFile(dir, '.specs/' + boundChange + '/TASK.md', taskXml('B02', 'parallel="false" status="pending"', 'src/b02.mjs'));
      const resBoundMissing = runHandoff(['request', 'B02', 'bound protocol unreadable'], dir,
        { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
      assertExit(resBoundMissing, 0);
      assertOut(resBoundMissing, 'WARN:');
      assertOut(resBoundMissing, '本次未执行归属校验');
      assertOut(resBoundMissing, 'state.protocolPath');
      assertOut(resBoundMissing, '协议文件不存在');
      assertOut(resBoundMissing, 'HANDOFF REQUEST: B02');
      assertNotOut(resBoundMissing, 'BLOCKED');
      if (!readScenarioState(dir).evidence?.['subagent-execute']?.handoffRequests?.B02) {
        throw new Error('state.protocolPath 不可读应可见 WARN 后照常落库');
      }
      // ⑰ 旧 state（无 protocolPath 字段）→ env/默认回退不回归：env 指向内置协议时，串行
      // pending 在 open 节点发起仍按内置协议归属 execute → BLOCK（缺字段 = 渐进兼容路径）。
      const legacyBoundState = readScenarioState(dir);
      delete legacyBoundState.protocolPath;
      legacyBoundState.currentNode = 'open';
      writeState(dir, legacyBoundState);
      writeFile(dir, '.specs/' + boundChange + '/TASK.md', taskXml('B03', 'parallel="false" status="pending"', 'src/b03.mjs'));
      const resLegacyBound = runHandoff(['request', 'B03', 'legacy state no binding'], dir,
        { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
      assertExit(resLegacyBound, 1);
      assertOut(resLegacyBound, 'BLOCKED: 任务 B03（串行 pending）应归属节点 execute');
    },
  },

  // 163: next / guard entry 输出点名加载（设计语义 / AC-17）——`workflow-state next` 与
  // `workflow-guard entry` 输出应含 `LOAD SKILL: <skill>（用 Skill 工具，禁止跳过）`。
  // 当前 printNext / entry 无该行 → 预期 RED。
  {
    name: '163 next / entry 输出点名 LOAD SKILL：用 Skill 工具，禁止跳过',
    run: (dir) => {
      // ① next：open 节点 → 输出点名 flow-comet-open
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      const resNext = runStateWithProtocol(dir, ['next']);
      assertExit(resNext, 0);
      assertOut(resNext, 'LOAD SKILL: flow-comet-open');
      assertOut(resNext, '禁止跳过');
      // ② guard entry：plan 节点 → 输出点名 flow-comet-plan
      const st2 = baseState('plan');
      writeState(dir, st2);
      const resEntry = runGuardWithProtocol(dir, ['entry', 'plan']);
      assertExit(resEntry, 0);
      assertOut(resEntry, 'LOAD SKILL: flow-comet-plan');
      assertOut(resEntry, '禁止跳过');
    },
  },

  // 164: 技能加载措辞（设计语义 / AC-16）——主 SKILL（SKILL.md + 入口展开册）与节点 SKILL
  // 须含「Skill 工具」与「不得跳过/禁止跳过」。入口展开册随 `GUIDANCE.md` 改名同步为
  // `reference/entry-detail.md`（判据强度不变：仍是同两条存在级锚点句，只是文件名换了）。
  // 判据抽成纯函数（单一实现）：真实判据与反向构造探针共用，逐份抽掉任一条锚点必红。
  {
    name: '164 技能加载措辞：主 SKILL 与节点 SKILL 含 Skill 工具 + 不得/禁止跳过',
    run: (dir) => {
      const files = [
        [path.join('flow-comet', 'SKILL.md'), path.join(SCRIPTS_DIR, '..', 'SKILL.md')],
        [path.join('flow-comet', 'reference', 'entry-detail.md'),
          path.join(SCRIPTS_DIR, '..', 'reference', 'entry-detail.md')],
        ...['flow-comet-open', 'flow-comet-design', 'flow-comet-plan', 'flow-comet-execute',
          'flow-comet-subagent-execute', 'flow-comet-review', 'flow-comet-verify', 'flow-comet-archive']
          .map((s) => [path.join(s, 'SKILL.md'), path.join(SCRIPTS_DIR, '..', '..', s, 'SKILL.md')]),
      ];
      const missing = [];
      for (const [rel, f] of files) {
        const text = fs.readFileSync(f, 'utf8');
        missing.push(...skillLoadingWordingProblems(rel, text));
        // 反向构造（同一判据驱动）：逐条锚点句抽掉 ⇒ 必报该条缺失——存在级锚点不得恒真空过。
        for (const [label, stripped] of [
          ['Skill 工具', text.split('Skill 工具').join('（反向构造：抽掉）')],
          ['不得跳过/禁止跳过', text.split('禁止跳过').join('（反向构造：抽掉）').split('不得跳过').join('（反向构造：抽掉）')],
        ]) {
          if (stripped === text) continue; // 该条本就不在场，缺失已由真实判据报告
          if (!skillLoadingWordingProblems(rel, stripped).some((p) => p.includes(label))) {
            missing.push(rel + ' 反向构造判别力缺失（抽掉「' + label + '」未被判缺失）');
          }
        }
      }
      if (missing.length > 0) {
        throw new Error('技能加载措辞缺失: ' + missing.join('; '));
      }
    },
  },

  // 165: next 进行中节点保护扩展（承接既有保护场景）——已 entry 但未 record 的节点（enteredNodes 含 plan、
  // TASK.md 存在、无 evidence.plan）跑 next → 不得把 currentNode 推走（保持 plan，输出 NODE: plan）。
  // 当前保护只看 evidence（record 过）→ 会把 currentNode 推到 execute → 预期 RED。
  {
    name: '165 next 保护扩展：entered 未 record 节点不推走（保持 plan）',
    run: (dir) => {
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\n\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\nx\n\n## 验收准则（AC）\n\n- Given x When y Then z');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈选型\n\n- 选定：Node\n\n## 1. 技术决策清单\n\n| # | D | R |\n|---|---|---|\n| D1 | x | y |');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_SERIAL_PENDING);
      const st = {
        activeChange: CHANGE_ID,
        currentNode: 'plan',
        completedNodes: ['open', 'design'],
        enteredNodes: ['open', 'design', 'plan'],
        evidence: {
          open: { summary: 'intake complete' },
          design: { summary: 'design done' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      };
      writeState(dir, st);
      const res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: plan');
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st2.currentNode !== 'plan') {
        throw new Error('entered 未 record 的节点不应被推进，currentNode 应为 plan，实际: ' + st2.currentNode);
      }
    },
  },

  // 166: 节点 SKILL 加载声明与协议一致（防回归锁）——每个节点 SKILL.md 必须含
  // requiredSkillCalls（非 advisory）对应的完整 skill-load 声明命令行与协议文件映射。
  {
    name: '166 节点 SKILL 声明命令与 workflow-protocol.json 一致',
    run: () => {
      const protocol = JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'reference', 'workflow-protocol.json'), 'utf8'));
      const promptBySkill = {
        'flow-comet-change': '0-change.md',
        'flow-comet-requirement': '1-requirement.md',
        'flow-comet-design': '2-design.md',
        'flow-comet-task': '3-task.md',
        'flow-comet-dev': '4-dev.md',
        'flow-comet-review': '6-review.md',
        'flow-comet-test': '5-test.md',
        'flow-comet-integration': '7-integration.md',
      };
      const advisory = new Set(['flow-comet-ui-design']);
      const problems = [];
      for (const node of protocol.nodes) {
        const impl = node.implementation && node.implementation.skill;
        if (!impl) continue;
        const text = fs.readFileSync(path.join(SCRIPTS_DIR, '..', '..', impl, 'SKILL.md'), 'utf8');
        for (const call of node.requiredSkillCalls || []) {
          if (advisory.has(call.skill)) continue;
          const promptFile = promptBySkill[call.skill];
          if (!promptFile) { problems.push(impl + ' 缺 ' + call.skill + ' 的 prompt 映射'); continue; }
          const line = 'skill-load ' + node.id + ' ' + call.skill + ' --prompt flow-kit/prompts/' + promptFile;
          if (!text.includes(line)) problems.push(impl + ' 缺声明命令: ' + line);
        }
      }
      if (problems.length > 0) throw new Error('节点 SKILL 声明命令与协议不一致: ' + problems.join('; '));
    },
  },

  // 167: 两层加载模型措辞——阶段层禁止在节点 SKILL 内指示用 Skill 工具加载任何节点实现技能
  //（本节点技能已由入口路由经 Skill 工具加载）；入口层禁止 Implementation/Required 混淆句式；
  // 全部 10 文件禁止无限定「record 会自动补写缺失的声明标记」表述（与新 change 技能加载前置门矛盾）。
  // 入口层的第二份随 `GUIDANCE.md` 改名同步为 `reference/entry-detail.md`（判据强度不变）。
  {
    name: '167 两层加载模型措辞：禁自加载句式/禁混淆句式/自动补分新旧',
    run: () => {
      const nodeDirs = ['flow-comet-open', 'flow-comet-design', 'flow-comet-plan', 'flow-comet-execute',
        'flow-comet-subagent-execute', 'flow-comet-review', 'flow-comet-verify', 'flow-comet-archive'];
      const implPattern = /用\s*Skill\s*工具加载[^。\n]{0,60}flow-comet-(open|design|plan|execute|subagent-execute|review|verify|archive)/;
      const autoFill = 'record 会自动补写缺失的声明标记';
      const stageAnchor = '本节点技能已由入口路由经 Skill 工具加载';
      const entryAnchor = 'Skill 工具加载该节点的 Implementation 技能';
      const problems = [];
      for (const id of nodeDirs) {
        const text = fs.readFileSync(path.join(SCRIPTS_DIR, '..', '..', id, 'SKILL.md'), 'utf8');
        if (implPattern.test(text)) problems.push(id + ' 含「用 Skill 工具加载节点实现技能」句式');
        if (text.includes(autoFill)) problems.push(id + ' 含无限定自动补表述');
        if (!text.includes(stageAnchor)) problems.push(id + ' 缺阶段层锚点句');
      }
      const entryLevelFiles = [
        ['flow-comet/SKILL.md', path.join(SCRIPTS_DIR, '..', 'SKILL.md')],
        ['flow-comet/reference/entry-detail.md', path.join(SCRIPTS_DIR, '..', 'reference', 'entry-detail.md')],
      ];
      for (const [rel, file] of entryLevelFiles) {
        const text = fs.readFileSync(file, 'utf8');
        problems.push(...twoLayerEntryProblems(rel, text));
        // 反向构造（同一判据驱动）：逐条锚点句抽掉 ⇒ 必报；还原混淆句式 / 无限定自动补表述 ⇒ 必报。
        for (const [label, stripped] of [
          ['入口层锚点句', text.split(entryAnchor).join('（反向构造：抽掉）')],
          ['前置门', text.split('前置门').join('（反向构造：抽掉）')],
        ]) {
          if (stripped === text) continue; // 该条本就不在场，缺失已由真实判据报告
          if (!twoLayerEntryProblems(rel, stripped).some((p) => p.includes(label))) {
            problems.push(rel + ' 反向构造判别力缺失（抽掉「' + label + '」未被判缺失）');
          }
        }
        const regressed = text + '\n见上方 Required Calls 表。' + autoFill + '。\n';
        const regressedProblems = twoLayerEntryProblems(rel, regressed);
        for (const label of ['Implementation/Required 混淆句式', '无限定自动补表述']) {
          if (!regressedProblems.some((p) => p.includes(label))) {
            problems.push(rel + ' 反向构造判别力缺失（还原「' + label + '」未被判违规）');
          }
        }
      }
      if (problems.length > 0) throw new Error('两层加载模型措辞不符: ' + problems.join('; '));
    },
  },

  // 168: verify 出口 EPERM 降级——受限沙箱会话中管道式执行子进程被拒（EPERM）时，
  // 以继承 stdio 重试同一命令：①输出含 VERIFY-DEGRADED 行（降级捕获标记）；②验证命令的
  // 副作用标记文件被真实写入（证明 inherit 重试真实执行——真实受限会话中管道阶段命令根本
  // 不启动，标记文件只能由重试写入）；③最终按退出码判定通过（guard exit=0）。
  // 测试钩子 FLOW_COMET_VERIFY_FORCE_EPERM=1 使首次管道执行模拟 EPERM 拒绝（仅测试用途——
  // 生产触发条件是真实 spawn 层 EPERM），降级路径因此可确定性自动化断言。
  {
    name: '168 verify 出口 EPERM 降级：VERIFY-DEGRADED 行 + inherit 真实重试 + exit 0',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      writeState(dir, st);
      // 验证命令写副作用标记文件（相对 cwd=runRoot）——文件存在即证明命令被真实执行
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "require(\'fs\').writeFileSync(\'verify-marker.txt\',\'ok\')"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      const marker = path.join(dir, 'verify-marker.txt');
      if (fs.existsSync(marker)) fs.rmSync(marker);
      const res = runGuard(['exit', 'verify'], dir, { FLOW_COMET_VERIFY_FORCE_EPERM: '1' });
      assertOut(res, 'VERIFY-DEGRADED');
      if (!fs.existsSync(marker)) {
        throw new Error('EPERM 降级后标记文件未被写入——inherit 重试未真实执行\n实际输出:\n' + res.output);
      }
      if (fs.readFileSync(marker, 'utf8') !== 'ok') throw new Error('标记文件内容异常');
      assertExit(res, 0);
    },
  },

  // 169: 非 EPERM 失败不降级——验证命令真实失败（非零退出、无 EPERM、无钩子）时行为与
  // 现状一致：VERIFY-FAIL 计数语义输出、不含 VERIFY-DEGRADED 行、guard exit≠0。
  // （锚定场景：防止降级逻辑扩大化吞掉真实测试失败——降级边界）
  {
    name: '169 非 EPERM 失败不降级：VERIFY-FAIL 照常且无 VERIFY-DEGRADED 行',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "process.exit(3)"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      const res = runGuard(['exit', 'verify'], dir);
      assertExit(res, 1);
      assertOut(res, 'VERIFY-FAIL');
      assertNotOut(res, 'VERIFY-DEGRADED');
    },
  },

  // 170: 零提交旁路收紧——noCommit 结果若携带 tracked 提交：新 change BLOCKED / 旧 change
  // HANDOFF WARN；空提交（--allow-empty）正例通过。锚定 AC-1（防「空 write_files 声明」
  // 成为携带任意提交的逃逸口）。
  // ④ F-6 请求侧补 tracked 负例：write_files 路径虽被 .gitignore 命中、但该路径已 tracked
  //（index-aware check-ignore 退出 1）→ 不记 noCommit（tracked 提交仍走完整子集校验）。
  {
    name: '170 零提交旁路：携带 tracked 提交新 BLOCK / 旧 WARN / 空提交通过',
    run: (dir) => {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
      writeFile(dir, 'src/x.js', 'x');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'src/x.js');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'tracked');
      const hashTracked = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const mkState = (isNew) => {
        const st = baseState('subagent-execute');
        if (isNew) st.newChange = true;
        st.evidence['subagent-execute'] = st.evidence['subagent-execute'] || {};
        st.evidence['subagent-execute'].handoffRequests = {
          T9: { description: 'zero-commit', noCommit: true },
          T10: { description: 'zero-commit legacy', noCommit: true },
          T11: { description: 'zero-commit empty', noCommit: true },
        };
        writeState(dir, st);
      };
      const payload = (id, hash) => JSON.stringify({ status: 'DONE', taskId: id, commitHash: hash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'n', output: 'n' }, redEvidence: { command: 'r', output: 'r' } });
      // ① 新 change + 含 tracked 文件的提交 → BLOCKED
      mkState(true);
      const res1 = runHandoff(['result', 'T9', payload('T9', hashTracked)], dir);
      assertExit(res1, 1);
      assertOut(res1, '声明零提交但提交携带');
      // ② 旧 change 同构造 → WARN 不阻断
      mkState(false);
      const res2 = runHandoff(['result', 'T10', payload('T10', hashTracked)], dir);
      assertExit(res2, 0);
      assertOut(res2, 'HANDOFF WARN');
      // ③ 新 change + 空提交 → 通过
      mkState(true);
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'empty');
      const hashEmpty = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const res3 = runHandoff(['result', 'T11', payload('T11', hashEmpty)], dir);
      assertExit(res3, 0);
      assertOut(res3, '提交为空，校验通过');
      // ④ F-6 请求侧 tracked 负例：路径被 .gitignore 命中但已被 index 跟踪 → check-ignore 退出 1
      writeFile(dir, '.gitignore', '.specs/\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/tracked.md', 'tracked\n');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-f', '.specs/' + CHANGE_ID + '/tracked.md');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'track ignored file');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="T12" status="done"><action>边界任务</action>'
        + '<write_files>.specs/' + CHANGE_ID + '/tracked.md</write_files>'
        + '<verify>node --check src/x.js</verify></task>\n');
      writeState(dir, baseState('subagent-execute'));
      const resReqTracked = runHandoff(['request', 'T12', 'tracked path slice'], dir);
      assertExit(resReqTracked, 0);
      const stTracked = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const reqTracked = stTracked.evidence['subagent-execute'].handoffRequests.T12;
      if (!reqTracked || reqTracked.noCommit === true) {
        throw new Error('tracked 文件路径不应具备零提交资格，实际 ' + JSON.stringify(reqTracked));
      }
      // ④b m-13 result 重验：request 时路径不存在（记资格），随后路径被强制跟踪 →
      // result 重验失败撤销 noCommit，失败类别 = became-tracked，且留 at/reason 审计。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="T15" status="done"><action>tracked-after-request 边界任务</action>'
        + '<write_files>.specs/' + CHANGE_ID + '/T15.md</write_files>'
        + '<verify>node --check src/x.js</verify></task>\n');
      writeState(dir, baseState('subagent-execute'));
      const resReqT15 = runHandoff(['request', 'T15', 'tracked-after-request slice'], dir);
      assertExit(resReqT15, 0);
      const stReqT15 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (stReqT15.evidence['subagent-execute'].handoffRequests.T15.noCommit !== true) {
        throw new Error('request 时未跟踪且被忽略的路径应取得 noCommit 资格，实际 '
          + JSON.stringify(stReqT15.evidence['subagent-execute'].handoffRequests.T15));
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/T15.md', 'tracked after request\n');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-f', '.specs/' + CHANGE_ID + '/T15.md');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'track after request');
      stReqT15.newChange = true;
      writeState(dir, stReqT15);
      const resRevokeTracked = runHandoff(['result', 'T15', payload('T15', '')], dir);
      assertExit(resRevokeTracked, 1);
      assertOut(resRevokeTracked, 'HANDOFF ERROR');
      assertOut(resRevokeTracked, 'revokeReason=became-tracked');
      const stRevokeTracked = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      assertRevocationAudit(stRevokeTracked.evidence['subagent-execute'].handoffRequests.T15,
        'became-tracked', '170④b 路径变 tracked 重验');
      if (stRevokeTracked.evidence['subagent-execute'].handoffResult?.T15) {
        throw new Error('tracked 重验失败不得落 result');
      }
      // ⑤ merge commit 负例（evil merge）：merge 提交独有的越界文件不得绕过完整提交子集校验
      // → 新 change BLOCK 且列出越界文件（merge 与普通提交走同一 fail-closed 路径）
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      git('checkout', '-q', '-b', 'feature-merge');
      writeFile(dir, 'src/feature-merge.js', 'feature\n');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'src/feature-merge.js');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'feature branch');
      git('checkout', '-q', branch);
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '--no-ff', '--no-commit', 'feature-merge');
      writeFile(dir, 'src/evil-merge.js', 'evil\n');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'src/evil-merge.js');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'evil merge');
      const mergeHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const stMerge = baseState('subagent-execute');
      stMerge.newChange = true;
      stMerge.evidence['subagent-execute'] = { handoffRequests: { T13: { description: 'merge boundary', writeFiles: ['src/x.js'] } } };
      writeState(dir, stMerge);
      const resMerge = runHandoff(['result', 'T13', payload('T13', mergeHash)], dir);
      assertExit(resMerge, 1);
      assertOut(resMerge, '超出 writeFiles 范围');
      assertOut(resMerge, 'src/evil-merge.js');
      // ⑥ invalid hash 负例：非法 commitHash 不得被静默当作合法提交——必须输出可见 HANDOFF ERROR
      //（记录不被拒绝是既有渐进语义；此处锚定「可见报错 + 不作为合法提交校验」的契约边界）
      const stInvalidHash = baseState('subagent-execute');
      stInvalidHash.newChange = true;
      stInvalidHash.evidence['subagent-execute'] = { handoffRequests: { T14: { description: 'invalid hash', writeFiles: ['src/x.js'] } } };
      writeState(dir, stInvalidHash);
      const resInvalidHash = runHandoff(['result', 'T14', payload('T14', 'not-a-commit-hash')], dir);
      assertExit(resInvalidHash, 0);
      assertOut(resInvalidHash, 'HANDOFF ERROR');
      assertOut(resInvalidHash, 'commitHash 格式非法');
      assertNotOut(resInvalidHash, '提交为空，校验通过');
    },
  },

  // 171: 入口文档首部 Change ID 新 change 强制——标题/段序合规但缺 `- **Change ID**:`
  // 首部字段：新 change open 出口 BLOCKED（文案「首部缺 Change ID」）；旧 change WARN 渐进。
  // （对齐 AC「标题·首部·段序」统一强制口径——此前仅 softWarning 与承诺不符。）
  {
    name: '171 入口首部 Change ID 新 BLOCK / 旧 WARN',
    run: (dir) => {
      const addOpenMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
          JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      const writeChange = (withId) => {
        const head = withId ? '- **Change ID**: ' + CHANGE_ID + '\n' : '';
        writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE: 标题\n\n' + head + '\n## Why（为什么做）\n\n原因。\n');
        writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT: 标题\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 用户故事\n\n- US-1\n\n## 验收准则（AC）\n\n- Given a When b Then c\n');
      };
      // ① 新 change 缺首部字段 → BLOCK
      const stNew = baseState('open');
      stNew.evidence.open = { summary: 'intake complete' };
      stNew.newChange = true;
      stNew.enteredNodes = ['open'];
      writeState(dir, stNew);
      addOpenMarker();
      writeChange(false);
      const resBad = runGuard(['exit', 'open'], dir);
      assertExit(resBad, 1);
      assertOut(resBad, 'BLOCKED');
      assertOut(resBad, '首部缺 Change ID');
      // ② 新 change 含首部字段 → 通过
      writeChange(true);
      const resGood = runGuard(['exit', 'open'], dir);
      assertExit(resGood, 0);
      assertOut(resGood, 'ALL CHECKS PASSED');
      // ③ 旧 change 缺首部字段 → WARN 渐进不阻断
      const stOld = baseState('open');
      stOld.evidence.open = { summary: 'intake complete' };
      writeState(dir, stOld);
      addOpenMarker();
      writeChange(false);
      const resOld = runGuard(['exit', 'open'], dir);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');
    },
  },
];
