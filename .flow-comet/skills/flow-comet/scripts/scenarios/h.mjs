// 场景组 h — 运行时位置迁移 · 感知层剥离 · 自检清单 · hook 双判定 · 迁移错误分类 · BOM 容忍 · purge 时序
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { scenarioCount } from '../lib/count-derivation.mjs';
import {
  assertExit,
  assertNotOut,
  assertOut,
  baseState,
  runGuard,
  runHook,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  BUILTIN_PROTOCOL_SOURCE,
  CHANGE_ID,
  GUARD,
  HOOK,
  LEGACY_RUNTIME_DIR,
  MIGRATION_CHANGE,
  PREPARE_ENV,
  REPO_ROOT,
  RUNTIME_DIR,
  RUNTIME_STATE_NAME,
  SCRIPTS_DIR,
  assertGitignoreManaged,
  bridgeIdentityEnv,
  makeTmp,
  migratableStateBytes,
  migrationBackups,
  normalizeRoot,
  runGitignoreForm,
  runInstalled,
  runPrepareEnv,
  writeClassicCometAssets,
  writeIntakeArtifacts,
  writeMigratedProjectArtifacts,
  writeSharedCometDir,
} from '../lib/test-fixtures.mjs';
import {
  outputText,
  runStateWithProtocol,
  scenarioProtocolPath,
} from '../lib/test-assertions.mjs';
import {
  REFERENCE_FACE_DIR_REL,
  SCENARIO_COUNT_FILES,
  applyPatchAnchorProblems,
  exerciseSystemTestCountCheck,
  scenarioCountSyncProblems,
  staleCountProblems,
} from '../lib/text-anchor-checks.mjs';

export const ENTRIES = [

  // ---------- 位置迁移 / 备份 / 感知层剥离（真实安装器 + 真实文件系统，端到端执行断言） ----------

  // AC-1 迁移正例：旧命名空间三方共占（flow-comet 运行时文件 + Comet 资产 + 用户自有文件），
  // 安装器只搬白名单在册的运行时文件——新位置逐字节一致、旧位置移除，其余内容原位不动
  // （不搬迁 / 不删除 / 不改写），且不会被按前缀/模式误搬进新命名空间。
  {
    name: '220 状态迁移白名单：仅运行时文件搬移，Comet 资产与用户文件原位不动（AC-1）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return; // 安装副本无安装器脚本（与场景 105 同判据）
      const proj = path.join(dir, 'proj');
      const stateBytes = migratableStateBytes();
      const kept = writeSharedCometDir(proj, stateBytes);
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      assertExit(res, 0);
      assertOut(res, '已迁移');
      // ① 新位置落位且逐字节一致
      const newState = path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME);
      if (!fs.existsSync(newState)) throw new Error('迁移后新位置状态文件缺失: ' + newState);
      if (!fs.readFileSync(newState).equals(stateBytes)) throw new Error('新位置状态与迁移前不逐字节一致');
      // ② 旧位置运行时文件已移除（搬移语义，非复制）
      if (fs.existsSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME))) {
        throw new Error('迁移后旧位置运行时文件应已移除');
      }
      // ③ Comet 资产与用户自有文件原位未动（位置 + 内容都未变）
      for (const item of kept) {
        const target = path.join(proj, LEGACY_RUNTIME_DIR, item.rel);
        if (!fs.existsSync(target)) throw new Error('非白名单内容被搬迁/删除: ' + item.rel);
        if (!fs.readFileSync(target).equals(item.bytes)) throw new Error('非白名单内容被改写: ' + item.rel);
      }
      // ④ 用户自有备份文件未被搬入新命名空间（白名单按精确文件名，不做前缀/模式匹配）
      const leaked = path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME + '.bak-20260901-user');
      if (fs.existsSync(leaked)) throw new Error('用户自有文件被搬入新命名空间（白名单过宽）: ' + leaked);
    },
  },

  // AC-15 迁移前备份：备份在迁移动作之前生成于新命名空间，内容与迁移前逐字节一致、命名含
  // 时间戳、迁移成功后仍保留；且仅凭这份备份即可恢复出可用的旧状态（状态文件不进版本控制的
  // 项目没有 git 回滚载体——备份是唯一回退依据）。
  {
    name: '221 迁移前备份：逐字节一致且迁移后保留，可据以恢复旧状态（AC-15）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const stateBytes = migratableStateBytes();
      writeSharedCometDir(proj, stateBytes);
      writeMigratedProjectArtifacts(proj);
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      assertExit(res, 0);
      assertOut(res, '迁移前备份');
      // ① 备份恰一份，命名含时间戳（.bak-<ISO 时间戳>）
      const backups = migrationBackups(proj);
      if (backups.length !== 1) throw new Error('迁移应恰生成 1 份备份，实际: ' + JSON.stringify(backups));
      if (!/^flow-comet-state\.json\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(backups[0])) {
        throw new Error('备份命名非 .bak-<时间戳> 形态: ' + backups[0]);
      }
      // ② 备份与迁移前逐字节一致
      const backupPath = path.join(proj, RUNTIME_DIR, backups[0]);
      if (!fs.readFileSync(backupPath).equals(stateBytes)) throw new Error('备份与迁移前不逐字节一致');
      // ③ 迁移成功后备份仍保留（安装器不读取、不清理）——再跑一次安装后仍应恰一份
      assertExit(runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir), 0);
      if (migrationBackups(proj).length !== 1) throw new Error('重跑安装后备份应保留且不新增');
      // ④ 仅凭备份即可恢复出可用的旧状态：把备份覆盖回状态文件 → 安装副本读到同一 change/节点
      fs.copyFileSync(backupPath, path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME));
      const st = runInstalled(proj, '.claude', 'workflow-state.mjs', ['status']);
      assertExit(st, 0);
      assertOut(st, '"change": "' + MIGRATION_CHANGE + '"');
      assertOut(st, '"currentNode": "design"');
    },
  },

  // AC-13 边界①：新位置与旧位置同时存在 → 不覆盖任何一方、报错中止（列出两处路径与人工
  // 处置指引），且中止发生在部署与纳管之前（不产生安装产物、不改 gitignore、不生成备份）。
  {
    name: '222 迁移边界 新旧并存：不覆盖任一方，报错中止（AC-13）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const oldBytes = migratableStateBytes();
      const newBytes = Buffer.from('{\n  "activeChange": "already-migrated"\n}\n', 'utf8');
      writeSharedCometDir(proj, oldBytes);
      const newPath = path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME);
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      fs.writeFileSync(newPath, newBytes);
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      if (res.status === 0) throw new Error('新旧并存应报错中止（exit 非 0），实际 exit 0');
      // 报错须列出两处路径（供人工比对判断），并给出处置指引
      assertOut(res, path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME));
      assertOut(res, newPath);
      assertOut(res, '不覆盖任何一方');
      assertOut(res, '重跑安装器');
      // 双方内容都未被改动
      if (!fs.readFileSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME)).equals(oldBytes)) {
        throw new Error('旧件被改写');
      }
      if (!fs.readFileSync(newPath).equals(newBytes)) throw new Error('新件被覆盖');
      // 中止于部署/纳管之前
      if (migrationBackups(proj).length !== 0) throw new Error('中止时不应产生备份');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('中止时不应产生安装产物');
      if (fs.existsSync(path.join(proj, '.gitignore'))) throw new Error('中止时不应改写 gitignore');
    },
  },

  // AC-13 边界②：旧件是符号链接 → 不跟随链接搬移（避免穿越到项目外）、报错中止；
  // 链接本身与链接指向的真实内容都未被改动，新位置不生成文件。
  {
    name: '223 迁移边界 符号链接：不跟随链接搬移，报错中止（AC-13）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const outside = path.join(dir, 'outside-real-dir');
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, 'real.txt'), 'real\n');
      fs.mkdirSync(path.join(proj, LEGACY_RUNTIME_DIR), { recursive: true });
      const linkPath = path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME);
      // 受限形态如实声明：Windows 无文件符号链接权限（EPERM）时用目录 junction——判定走同一
      // isSymbolicLink() 分支；两种链接都建不出来时显式跳过（不静默冒充已覆盖）
      let linkForm = 'junction';
      try {
        fs.symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (e1) {
        linkForm = 'file-symlink';
        try {
          fs.symlinkSync(outside, linkPath, 'file');
        } catch (e2) {
          console.log('  （本机无创建链接的权限，跳过符号链接夹具——' + (e2.code || e2.message) + '）');
          return;
        }
      }
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      if (res.status === 0) throw new Error('符号链接旧件应报错中止（exit 非 0），实际 exit 0（形态=' + linkForm + '）');
      assertOut(res, '符号链接');
      assertOut(res, '不跟随');
      if (!fs.lstatSync(linkPath).isSymbolicLink()) throw new Error('链接本身被改动（不再是链接）');
      if (!fs.readFileSync(path.join(outside, 'real.txt')).equals(Buffer.from('real\n', 'utf8'))) {
        throw new Error('链接指向的真实内容被改动');
      }
      if (fs.existsSync(path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME))) throw new Error('新位置不应生成文件');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('中止时不应产生安装产物');
    },
  },

  // AC-13 边界③：旧件内容损坏（JSON 解析失败）→ 保留原件未改动、报错中止并给修复指引；
  // 中止发生在写入之前（新位置不生成文件、不产生备份）。
  {
    name: '224 迁移边界 JSON 损坏：保留原件报错中止（AC-13）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const broken = Buffer.from('{ "activeChange": \n', 'utf8');
      fs.mkdirSync(path.join(proj, LEGACY_RUNTIME_DIR), { recursive: true });
      fs.writeFileSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME), broken);
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      if (res.status === 0) throw new Error('损坏状态应报错中止（exit 非 0），实际 exit 0');
      assertOut(res, '不是合法 JSON');
      assertOut(res, '保留原件');
      if (!fs.readFileSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME)).equals(broken)) {
        throw new Error('损坏原件被改写');
      }
      if (fs.existsSync(path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME))) throw new Error('新位置不应生成文件');
      if (migrationBackups(proj).length !== 0) throw new Error('中止于写入之前，不应产生备份');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('中止时不应产生安装产物');
    },
  },

  // AC-7 迁移失败不丢数据：迁移目标不可建立（路径异常——目标目录位置被普通文件占用）时，
  // 旧文件完整保留、报错并给出恢复指引，不删除任何既有内容。
  {
    name: '225 迁移失败保护：目标不可建立时旧文件完整保留（AC-7）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const stateBytes = migratableStateBytes();
      writeSharedCometDir(proj, stateBytes);
      const occupied = path.join(proj, RUNTIME_DIR);
      fs.writeFileSync(occupied, 'occupied\n'); // 目标目录位置被普通文件占用（确定性的路径异常形态）
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      if (res.status === 0) throw new Error('迁移目标不可建立应报错中止（exit 非 0），实际 exit 0');
      assertOut(res, '旧文件完整保留');
      assertOut(res, '重跑安装器');
      if (!fs.readFileSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME)).equals(stateBytes)) {
        throw new Error('失败路径下旧文件被改写');
      }
      if (!fs.lstatSync(occupied).isFile()) throw new Error('占位文件被改动（既有内容不得被处置）');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('中止时不应产生安装产物');
    },
  },

  // AC-8 gitignore 形态①（逐条路径）：既有条目一律保留原样（不"更新"为新路径），仅缺失时
  // 追加新命名空间条目；连续两次安装不产生重复行；追加内容沿用既有行尾风格。
  {
    name: '226 gitignore 纳管 逐条路径形态：既有条目保留 + 追加幂等（AC-8）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(path.join(proj, LEGACY_RUNTIME_DIR, 'runs'), { recursive: true }); // Comet 资产在场
      fs.writeFileSync(path.join(proj, LEGACY_RUNTIME_DIR, 'runs', 'run-001.json'), '{"comet":true}\n');
      const legacyLine = LEGACY_RUNTIME_DIR + '/' + RUNTIME_STATE_NAME;
      const initial = legacyLine + '\r\nnode_modules/\r\n# user note\r\n*.bak-*\r\n';
      const result = runGitignoreForm(dir, proj, initial);
      assertGitignoreManaged(result);
      if (!result.afterFirst.startsWith(initial)) {
        throw new Error('既有内容未逐字保留:\n' + JSON.stringify(result.afterFirst));
      }
      if (!result.afterFirst.split(/\r?\n/).includes(legacyLine)) {
        throw new Error('既有逐条路径条目被改写/删除: ' + legacyLine);
      }
      const appended = result.afterFirst.slice(initial.length);
      if (!appended.includes('\r\n') || /(^|[^\r])\n/.test(appended)) {
        throw new Error('追加内容未沿用既有行尾风格（CRLF）: ' + JSON.stringify(appended));
      }
    },
  },

  // AC-8 gitignore 形态②（整目录 .comet/）：整目录条目原样保留——该目录中仍有 Comet 资产，
  // 改写会误伤用户对它们的忽略意图；同样只追加缺失的新命名空间条目且幂等。
  {
    name: '227 gitignore 纳管 整目录形态：既有条目保留 + 追加幂等（AC-8）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(path.join(proj, LEGACY_RUNTIME_DIR, 'runs'), { recursive: true });
      fs.writeFileSync(path.join(proj, LEGACY_RUNTIME_DIR, 'runs', 'run-001.json'), '{"comet":true}\n');
      const initial = LEGACY_RUNTIME_DIR + '/\nnode_modules/\n# user note\n';
      const result = runGitignoreForm(dir, proj, initial);
      assertGitignoreManaged(result);
      if (!result.afterFirst.startsWith(initial)) {
        throw new Error('既有内容未逐字保留:\n' + JSON.stringify(result.afterFirst));
      }
      if (!result.afterFirst.split(/\r?\n/).includes(LEGACY_RUNTIME_DIR + '/')) {
        throw new Error('整目录既有条目被改写/删除: ' + LEGACY_RUNTIME_DIR + '/');
      }
      const appended = result.afterFirst.slice(initial.length);
      if (appended.includes('\r\n')) throw new Error('追加内容引入了 CRLF（既有为 LF）: ' + JSON.stringify(appended));
    },
  },

  // AC-8 gitignore 形态③（完全无条目）：用户其他内容（无关行 / 注释 / 无末行换行）不被改写，
  // 仅追加缺失条目且连续两次安装逐字节不变。
  {
    name: '228 gitignore 纳管 无条目形态：用户内容原样保留 + 追加幂等（AC-8）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const initial = 'node_modules/\n# keep\n*.log'; // 末行无换行——追加不得粘接到用户行上
      const result = runGitignoreForm(dir, proj, initial);
      assertGitignoreManaged(result);
      if (!result.afterFirst.startsWith(initial)) {
        throw new Error('既有内容未逐字保留:\n' + JSON.stringify(result.afterFirst));
      }
      if (!/^\*\.log$/m.test(result.afterFirst)) throw new Error('用户末行被改写/粘接: ' + JSON.stringify(result.afterFirst));
    },
  },

  // AC-5 剥离①：同一运行中 workflow 下，Comet classic 资产（.comet/config.yaml + classic
  // change 目录 + overlay 证据）在场与缺席时，hook 与 guard 的判定（退出码 + 归一化输出）
  // 完全一致——判定与这些文件是否存在无关；判定本身非空洞（hook 拦越权写源码 / guard 放行合规出口）。
  {
    name: '229 感知层剥离：classic 资产有无不改变 hook 与 guard 判定（AC-5）',
    run: (dir) => {
      const builtin = scenarioProtocolPath(dir);
      const build = (name, withClassic) => {
        const proj = path.join(dir, name);
        fs.mkdirSync(path.join(proj, 'reference'), { recursive: true });
        fs.copyFileSync(builtin, path.join(proj, 'reference', 'workflow-protocol.json'));
        writeIntakeArtifacts(proj);
        const st = baseState('open');
        st.status = 'running';
        st.evidence.open = { summary: 'intake complete' };
        writeState(proj, st);
        if (withClassic) writeClassicCometAssets(proj);
        return proj;
      };
      const judge = (proj) => ({
        hook: runHook(['before_tool'], proj,
          { tool_name: 'Write', tool_input: { file_path: path.join(proj, 'src', 'evil.mjs') } }),
        guard: runGuard(['exit', 'open'], proj),
      });
      const withClassic = build('with-classic', true);
      const withoutClassic = build('without-classic', false);
      const a = judge(withClassic);
      const b = judge(withoutClassic);
      // 判定非空洞：运行中 workflow 越权写源码被拦；合规出口放行
      assertExit(a.hook, 2);
      assertOut(a.hook, 'BLOCKED');
      assertExit(a.guard, 0);
      assertOut(a.guard, 'ALL CHECKS PASSED');
      // 一致性：退出码 + 归一化输出逐字相同（路径差异抹除后）
      const norm = (res, proj) => normalizeRoot(outputText(res), proj, dir);
      if (a.hook.status !== b.hook.status || norm(a.hook, withClassic) !== norm(b.hook, withoutClassic)) {
        throw new Error('hook 判定随 classic 资产变化（感知层未剥离干净）:\n' +
          JSON.stringify({ withClassic: norm(a.hook, withClassic), withoutClassic: norm(b.hook, withoutClassic) }, null, 2));
      }
      if (a.guard.status !== b.guard.status || norm(a.guard, withClassic) !== norm(b.guard, withoutClassic)) {
        throw new Error('guard 判定随 classic 资产变化（感知层未剥离干净）:\n' +
          JSON.stringify({ withClassic: norm(a.guard, withClassic), withoutClassic: norm(b.guard, withoutClassic) }, null, 2));
      }
    },
  },

  // AC-5 剥离②：kind 为 comet-five-phase-overlay 的协议不再进入叠加分支——与同节点、
  // kind=workflow-kernel 的协议在完全相同的夹具（含 classic 活动 change）上判定一致；
  // 叠加分支的专属信号（无活动 Comet change / 多 Comet change）不再出现；
  // 另做源码符号检索，确认感知层符号在判定脚本中零残留。
  {
    name: '230 感知层剥离：overlay 协议不再进入叠加分支（AC-5）',
    run: (dir) => {
      const builtinProtocol = JSON.parse(fs.readFileSync(BUILTIN_PROTOCOL_SOURCE, 'utf8'));
      const build = (name, kind) => {
        const proj = path.join(dir, name);
        const protocol = JSON.parse(JSON.stringify(builtinProtocol));
        protocol.kind = kind;
        fs.mkdirSync(path.join(proj, 'reference'), { recursive: true });
        fs.copyFileSync(scenarioProtocolPath(dir), path.join(proj, 'reference', 'workflow-protocol.json'));
        writeFile(proj, 'overlay-protocol.json', JSON.stringify(protocol, null, 2) + '\n');
        writeIntakeArtifacts(proj);
        const st = baseState('open');
        st.status = 'running';
        st.evidence.open = { summary: 'intake complete' };
        writeState(proj, st);
        writeClassicCometAssets(proj); // 叠加分支的前置（classic 活动 change）在场
        return proj;
      };
      const overlayProj = build('overlay-kind', 'comet-five-phase-overlay');
      const kernelProj = build('kernel-kind', 'workflow-kernel');
      const runExit = (proj) => runGuard(['exit', 'open', '--protocol', path.join(proj, 'overlay-protocol.json')], proj);
      const a = runExit(overlayProj);
      const b = runExit(kernelProj);
      assertExit(a, 0);
      assertOut(a, 'ALL CHECKS PASSED');
      assertNotOut(a, 'active Comet change');
      if (a.status !== b.status
        || normalizeRoot(outputText(a), overlayProj, dir) !== normalizeRoot(outputText(b), kernelProj, dir)) {
        throw new Error('overlay 协议与同节点 kernel 协议判定不一致（叠加分支未剥离）:\n' +
          JSON.stringify({ overlay: normalizeRoot(outputText(a), overlayProj, dir), kernel: normalizeRoot(outputText(b), kernelProj, dir) }, null, 2));
      }
      // 源码符号检索：感知层符号在判定脚本中零残留
      const SYMBOLS = [
        'isCometOverlay', 'comet-five-phase-overlay', 'resolveCometOverlayChange',
        'activeCometChanges', 'overlayNodeFromState', 'hasOverlayEvidence',
        'readWorkflowProjectPathConfig', 'workflowPathBaseRoot',
      ];
      for (const [label, file] of [['workflow-guard.mjs', GUARD], ['comet-hook-guard.mjs', HOOK]]) {
        const src = fs.readFileSync(file, 'utf8');
        for (const symbol of SYMBOLS) {
          if (src.includes(symbol)) throw new Error(label + ' 仍含 Comet 感知层符号: ' + symbol);
        }
      }
    },
  },

  // AC-14 自检清单有效性：条目齐备且同步 → 零问题；条目缺失 → 显式报告（含文件名），
  // 不得静默跳过（"永不生效的条目"无处藏身）；条目在场但计数未同步 → 同样上报。
  // 用真实清单常量与真实文件系统驱动自检实现（受检根替换为场景临时目录）。
  // ③ 起为系统测试集项数受检面（与场景数面同构，判据同一）。
  {
    name: '231 自检清单：条目缺失被显式报告而非静默跳过（AC-14）',
    run: async (dir) => {
      const n = 7; // 夹具自定场景数（受检文件内容与之一致）
      // 当前场景数经计数派生通道取（与入口 runner 打印的 scenarioTotal 同源：同一批组文件）
      const scenarioTotal = await scenarioCount();
      const synced = 'ALL ' + n + ' SCENARIOS PASSED\n';
      for (const rel of SCENARIO_COUNT_FILES) writeFile(dir, rel, synced);
      const clean = scenarioCountSyncProblems(n, dir);
      if (clean.length !== 0) throw new Error('条目齐备且同步时不应报告问题: ' + JSON.stringify(clean));
      // ① 移走一个条目（幽灵条目形态）→ 显式报告缺失项（列出文件名）
      const missingRel = 'docs/VERSIONS-zh.md';
      if (!SCENARIO_COUNT_FILES.includes(missingRel)) throw new Error('夹具前提失效：' + missingRel + ' 不在受检清单内');
      fs.rmSync(path.join(dir, missingRel));
      const problems = scenarioCountSyncProblems(n, dir);
      if (!problems.some((p) => p.includes('缺失') && p.includes(missingRel))) {
        throw new Error('缺失条目未被显式报告: ' + JSON.stringify(problems));
      }
      // ② 条目在场但场景数未同步 → 同样上报（缺省放过即为静默失检）
      writeFile(dir, missingRel, '未同步的内容\n');
      const stale = scenarioCountSyncProblems(n, dir).join(' | ');
      if (!stale.includes('未同步') || !stale.includes(missingRel)) {
        throw new Error('未同步条目未被上报: ' + stale);
      }
      // ③ 系统测试集项数受检面：组文件派生 + 缺失 / 未同步 / 组判定 / 派生源缺失全分支
      await exerciseSystemTestCountCheck(dir);
      // ④ stale 检测（presence 之外的判别力）：在场 ≠ 同步——旧值不在场才是同步的另一半。
      // 受检面 = 维护者面（docs/internal/ 全册 + CLAUDE.md）+ 参考册（reference/*.md，路径从本
      // 脚本自身位置推导）；夹具用独立临时根驱动（夹具根下参考册缺席 → 该面为空，不误红）。
      const staleRoot = makeTmp();
      writeFile(staleRoot, 'docs/internal/DOC.md',
        '当前 ' + scenarioTotal + ' 场景 全部通过。\n');
      writeFile(staleRoot, 'CLAUDE.md', '回归基线：ALL ' + scenarioTotal + ' SCENARIOS PASSED\n');
      if (staleCountProblems([scenarioTotal, 86], staleRoot).length !== 0) {
        throw new Error('当前值不得被判成旧值: ' + JSON.stringify(staleCountProblems([scenarioTotal, 86], staleRoot)));
      }
      // 反例（旧 presence 判据必然放过：当前值在场即全绿，旁边的旧值不可见）
      writeFile(staleRoot, 'docs/internal/DOC.md', '当前 ' + scenarioTotal + ' 场景；另有 120 场景 的记录。\n');
      const staleOld = staleCountProblems([scenarioTotal, 86], staleRoot);
      if (!(staleOld.some((p) => p.includes('旧值未标记') && p.includes('docs/internal/DOC.md:1')
        && p.includes('120')))) {
        throw new Error('无标记旧值未被报告（应含文件:行 + 旧值）: ' + JSON.stringify(staleOld));
      }
      // 历史标记豁免：已标注的历史值不是"未标记旧值"（四枚标记各取一例——标记清单本身也受锚）
      for (const marked of ['（历史）120 场景。\n', '该值 120 场景 已过时。\n', '回顾：120 场景（history）。\n',
        '本轮踩坑：模板里写过 120 场景。\n']) {
        writeFile(staleRoot, 'docs/internal/DOC.md', marked);
        if (staleCountProblems([scenarioTotal, 86], staleRoot).length !== 0) {
          throw new Error('带历史标记的行不得报告: ' + JSON.stringify([marked, staleCountProblems([scenarioTotal, 86], staleRoot)]));
        }
      }
      // 量程门：30 以下 / 400 以上不参与（年份、编号一类数字挡在外面）
      writeFile(staleRoot, 'docs/internal/DOC.md', '夹具 7 场景 与 9999 场景。\n');
      if (staleCountProblems([scenarioTotal, 86], staleRoot).length !== 0) {
        throw new Error('量程外的数字不得参与: ' + JSON.stringify(staleCountProblems([scenarioTotal, 86], staleRoot)));
      }
      // 通用比值门控：同行未点名套件的 N/N 不参与（覆盖率一类通用比值不误伤）；点名套件才判
      writeFile(staleRoot, 'docs/internal/DOC.md', '覆盖率 120/120。\n');
      if (staleCountProblems([scenarioTotal, 86], staleRoot).length !== 0) {
        throw new Error('同行未点名套件的通用比值不得参与: ' + JSON.stringify(staleCountProblems([scenarioTotal, 86], staleRoot)));
      }
      writeFile(staleRoot, 'docs/internal/DOC.md', 'guard-self-test 覆盖率 120/120。\n');
      if (!staleCountProblems([scenarioTotal, 86], staleRoot).some((p) => p.includes('旧值未标记') && p.includes('120/120'))) {
        throw new Error('点名套件的旧比值未被报告: ' + JSON.stringify(staleCountProblems([scenarioTotal, 86], staleRoot)));
      }
      writeFile(staleRoot, 'docs/internal/DOC.md', 'guard-self-test 覆盖率 120/121。\n');
      if (staleCountProblems([scenarioTotal, 86], staleRoot).length !== 0) {
        throw new Error('非等值比值不是计数形态（不得参与）: ' + JSON.stringify(staleCountProblems([scenarioTotal, 86], staleRoot)));
      }
      // 声明的 CLAUDE.md 形态：维护者面逐册纳入（夹具根下 CLAUDE.md 在场即入面）
      writeFile(staleRoot, 'CLAUDE.md', '自检套件 120 场景。\n');
      if (!staleCountProblems([scenarioTotal, 86], staleRoot).some((p) => p.includes('CLAUDE.md:1') && p.includes('旧值未标记'))) {
        throw new Error('CLAUDE.md 未纳入 stale 受检面: ' + JSON.stringify(staleCountProblems([scenarioTotal, 86], staleRoot)));
      }
      // 读取失败可见化：与维护文档机检同型（同名目录 → 读取错误，不得静默跳过）
      fs.mkdirSync(path.join(staleRoot, 'docs', 'internal', 'DIR.md'), { recursive: true });
      if (!staleCountProblems([scenarioTotal, 86], staleRoot).some((p) => p.includes('无法读取: docs/internal/DIR.md'))) {
        throw new Error('stale 受检面里的不可读目标被静默跳过: ' + JSON.stringify(staleCountProblems([scenarioTotal, 86], staleRoot)));
      }
      fs.rmSync(staleRoot, { recursive: true, force: true }); // 夹具根清理（残留目录由底部统一校验）
      // ⑤ 面路径的推导纪律锚（同类断言回扫）：参考册受检面必须**从本脚本自身位置**推导——
      //    权威源（.flow-comet/skills）与各安装副本（.claude / .agents / .dsh/skills）同一推导
      //    覆盖；硬编码树根相对路径会在安装副本形态指向不存在的面（静默空面 = 未执行当通过）。
      if (path.resolve(REPO_ROOT, REFERENCE_FACE_DIR_REL) !== path.resolve(SCRIPTS_DIR, '..', 'reference')) {
        throw new Error('参考册受检面必须由脚本自身位置推导（不得硬编码树根相对路径），实际: ' + REFERENCE_FACE_DIR_REL);
      }
      if (path.basename(REFERENCE_FACE_DIR_REL) !== 'reference') {
        throw new Error('参考册受检面路径异常: ' + REFERENCE_FACE_DIR_REL);
      }
    },
  },

  // ---------- hook 双判定路径 / 迁移错误分类 / BOM / purge 时序 ----------

  // 232: worktree 隔离区放行的判定路径一致性——放行分支此前只挂在 file_path 判定处
  // （Bash 分支先执行并直接按协调者白名单判定），同一路径用 Write/Edit 放行、用 Bash
  // 重定向写却被拦（判定随工具而变）。修复后两条判定共用同一隔离区判据——同路径同结论。
  // 穿越形态（`..` 逃出隔离区）在两条路径上都必须仍被拦截：放行不是无条件的。
  // ④ 追加（物理包含性）：隔离区**内**指向区外的符号链接/junction 是同一前缀下的第二种逃逸——
  // 词法归一化对它无能为力（路径字符串确实以隔离区前缀开头），必须按真实落点判定。
  {
    name: '232 hook 判定一致性：worktree 放行双分支一致 + 穿越仍拦 + 身份三态 × 桥接标记在场判据 × 最小保护集 + runRoot 外对称',
    run: (dir) => {
      writeState(dir, { ...baseState('subagent-execute'), status: 'running' });
      const insideWorktree = path.join(dir, '.claude', 'worktrees', 'agent-abc123', 'src', 'x.mjs');
      const posix = (p) => p.split(path.sep).join('/');
      // ① file_path 判定：隔离区内写入放行（既有行为，防回归）
      const viaWrite = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: insideWorktree } });
      assertExit(viaWrite, 0);
      assertOut(viaWrite, 'workflow-hook-guard-ok');
      // ② Bash 判定：同一路径的命令级写入同样放行（修复前按协调者白名单拦截 → RED）
      const viaBash = runHook(['before_tool'], dir,
        { tool_name: 'Bash', tool_input: { command: 'echo x > "' + posix(insideWorktree) + '"' } });
      assertExit(viaBash, 0);
      assertOut(viaBash, 'workflow-hook-guard-ok');
      // ③ 穿越形态：`..` 归一化后逃出隔离区 → 两条判定都仍拦截
      const escape = posix(path.join(dir, '.claude', 'worktrees', 'agent-abc123'))
        + '/../../src/evil.mjs';
      const viaWriteEscape = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: escape } });
      assertExit(viaWriteEscape, 2);
      assertOut(viaWriteEscape, 'BLOCKED');
      const viaBashEscape = runHook(['before_tool'], dir,
        { tool_name: 'Bash', tool_input: { command: 'echo x > "' + escape + '"' } });
      assertExit(viaBashEscape, 2);
      assertOut(viaBashEscape, 'BLOCKED');
      // ④ 物理包含性：隔离区**内**指向区外的符号链接/junction——词法上仍以 `.claude/worktrees/`
      //    开头，真实落点却在隔离区外。放行先于各自的白名单判定返回，故放行这类路径等于
      //    没有任何后续校验兜底 → 两条判定都必须拦截（修复前按词法放行 = RED）。
      //    Windows 用 junction（建 junction 不需要符号链接特权，与真实环境权限无关）；
      //    POSIX 用目录符号链接；平台确实无法构造链接时按下方 ⑤ 的兜底断言如实降级。
      const outsideDir = path.join(dir, 'outside-zone');
      fs.mkdirSync(outsideDir, { recursive: true });
      const agentDir = path.join(dir, '.claude', 'worktrees', 'agent-abc123');
      fs.mkdirSync(agentDir, { recursive: true });
      let linkCreated = false;
      try {
        fs.symlinkSync(outsideDir, path.join(agentDir, 'link'),
          process.platform === 'win32' ? 'junction' : 'dir');
        linkCreated = true;
      } catch { linkCreated = false; }
      if (!linkCreated) {
        console.error('WARN: 当前平台无法构造符号链接/junction，隔离区链接逃逸断言降级为兜底断言');
      }
      if (linkCreated) {
        const escaping = posix(path.join(agentDir, 'link', 'evil.mjs'));
        const viaWriteLink = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: escaping } });
        assertExit(viaWriteLink, 2);
        assertOut(viaWriteLink, 'BLOCKED');
        const viaBashLink = runHook(['before_tool'], dir,
          { tool_name: 'Bash', tool_input: { command: 'echo x > "' + escaping + '"' } });
        assertExit(viaBashLink, 2);
        assertOut(viaBashLink, 'BLOCKED');
      }
      // ⑤ 放行不得过宽：链接**旁**的真实隔离区路径仍须放行（把整个隔离区一并拦掉同样是回归），
      //    非隔离区路径仍按原逻辑判定（协调者白名单拦截）。
      const viaWriteNormal = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(agentDir, 'src', 'y.mjs') } });
      assertExit(viaWriteNormal, 0);
      assertOut(viaWriteNormal, 'workflow-hook-guard-ok');
      const viaWriteOutside = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.mjs') } });
      assertExit(viaWriteOutside, 2);
      assertOut(viaWriteOutside, 'BLOCKED');

      // ---------- in-place 扩展：身份分派 × 最小保护集 × 顺序锚 × 两分支对称 ----------
      // ⑥ 身份三态（子代理语义的增量通道）：载荷 agent_id 在场（CC / Codex 原生子代理的载荷形态）
      //    或环境变量身份深度为正整数（dsh 桥接透传）⇒ 子代理语义放行；两者皆缺（主线程）⇒
      //    维持既有路径判定——新判据是增量通道，不是对旧语义的替换（不放宽也不误拦）。
      //    反向构造：把身份短路回退成纯路径判定 ⇒ ⑥a / ⑥c / ⑦a / ⑦c 必红（判别力见交付证据）。
      const whitelistOutside = path.join(dir, 'src', 'foo.mjs');
      const identityPayload = (extra) => ({
        tool_name: 'Write',
        tool_input: { file_path: whitelistOutside },
        ...extra,
      });
      // ⑥a 含 agent_id（子代理）⇒ 放行（路径在协调者白名单之外，身份未短路时必 BLOCK ⇒ RED）
      const viaAgentId = runHook(['before_tool'], dir, identityPayload({ agent_id: 'agent-abc123' }));
      assertExit(viaAgentId, 0);
      assertOut(viaAgentId, 'workflow-hook-guard-ok');
      assertOut(viaAgentId, '(subagent identity)');
      // ⑥b 不含 agent_id（主线程）⇒ 维持既有路径判定：白名单外源码仍 BLOCK
      const viaMainThread = runHook(['before_tool'], dir, identityPayload({}));
      assertExit(viaMainThread, 2);
      assertOut(viaMainThread, 'BLOCKED');
      // ⑥c dsh 桥接身份透传（环境变量正整数 + 桥接通道标记）⇒ 与载荷面归并为同一判据 ⇒ 放行
      const viaDepth = runHook(['before_tool'], dir, identityPayload({}), bridgeIdentityEnv('1'));
      assertExit(viaDepth, 0);
      assertOut(viaDepth, '(subagent identity)');
      // ⑥c2 env 面作用域收紧：**只有深度变量在场、桥接通道标记不在场** ⇒ 按协调者语义（白名单外
      //     源码仍 BLOCK）——CC / Codex 生成的 hook 直接调用本文件、并不自证是桥接，继承来的深度
      //     变量不得据此走子代理路径（否则守卫在 phase / worktree / runRoot 检查之前就返回）。
      //     反向构造：守卫去掉标记要求 ⇒ ⑥c2 必红（同载荷被误判为子代理而放行）。
      for (const inheritedDepth of ['1', '2', '9']) {
        const inherited = runHook(['before_tool'], dir, identityPayload({}), { FLOW_COMET_AGENT_DEPTH: inheritedDepth });
        assertExit(inherited, 2);
        assertOut(inherited, 'BLOCKED');
        assertNotOut(inherited, '(subagent identity)');
      }
      // ⑥c3 标记形态收窄（fail-closed）：值不符 / 大小写变体 / 空白变体 / 空串 / 非桥接来源一律不算
      for (const marker of ['', ' ', 'dsh', 'DSH-BRIDGE', 'Dsh-Bridge', 'dsh-bridge ', ' dsh-bridge', 'bridged']) {
        const res = runHook(['before_tool'], dir, identityPayload({}),
          { FLOW_COMET_AGENT_DEPTH: '1', FLOW_COMET_AGENT_DEPTH_SOURCE: marker });
        assertExit(res, 2);
        assertOut(res, 'BLOCKED');
      }
      // ⑥c4 标记在场但深度非法 ⇒ 仍非身份（两条判据都闭合：标记只证明通道，不代替取值形态收窄）
      for (const raw of ['0', '', 'abc', '-1']) {
        const res = runHook(['before_tool'], dir, identityPayload({}),
          { FLOW_COMET_AGENT_DEPTH: raw, FLOW_COMET_AGENT_DEPTH_SOURCE: 'dsh-bridge' });
        assertExit(res, 2);
        assertOut(res, 'BLOCKED');
      }
      // ⑥d 取值形态收窄（fail-closed 方向）：'0'（协调者）/ 空串 / 纯空白 / 非十进制 / 负数 /
      //    小数 / 科学计数 / 带符号 一律非身份 ⇒ 退回路径判定（不得读成放宽）
      for (const raw of ['0', '', '  ', 'abc', '-1', '1.5', '1e1', '+1', '2x']) {
        const res = runHook(['before_tool'], dir, identityPayload({}), bridgeIdentityEnv(raw));
        assertExit(res, 2);
        assertOut(res, 'BLOCKED');
      }
      // ⑥e 载荷面收窄：agent_id 非字符串 / 空串 / 纯空白 ⇒ 非身份；agent_type 单独在场不构成
      //    身份（实现判据只认 agent_id——文本与实现一致锚见技能文本锁场景）
      for (const bad of [undefined, null, 42, '', '   ']) {
        const res = runHook(['before_tool'], dir, identityPayload({ agent_id: bad }));
        assertExit(res, 2);
        assertOut(res, 'BLOCKED');
      }
      const viaAgentTypeOnly = runHook(['before_tool'], dir, identityPayload({ agent_type: 'codex-subagent' }));
      assertExit(viaAgentTypeOnly, 2);
      assertOut(viaAgentTypeOnly, 'BLOCKED');
      // ⑥f 两平台对照（同一判据、无平台分支）：codex 分支放行输出严格 JSON `{}`、拦截输出
      //    decision:block 且 exit 0；claude-code 分支放行输出既有文本、拦截 exit 2（见 ⑥a / ⑥b）
      const codexAllow = runHook(['before_tool', '--platform', 'codex'], dir, identityPayload({ agent_id: 'agent-abc123' }));
      assertExit(codexAllow, 0);
      if (codexAllow.output.trim() !== '{}') {
        throw new Error('codex 分支放行应输出严格 JSON {}，实际: ' + JSON.stringify(codexAllow.output));
      }
      const codexBlock = runHook(['before_tool', '--platform', 'codex'], dir, identityPayload({}));
      assertExit(codexBlock, 0);
      assertOut(codexBlock, '"decision":"block"');

      // ⑦ 顺序锚：身份判据**先于**路径判据求值——身份在场且目标在 runRoot 之外 ⇒ 放行。
      //    顺序若反转（先解析路径）该目标必 BLOCK ⇒ 本断言本身即顺序判据（判定顺序可断言）。
      const outsideRoot = path.join(dir, '..', 'outside-232', 'src', 'x.mjs');
      const orderViaWrite = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: outsideRoot }, agent_id: 'agent-abc123' });
      assertExit(orderViaWrite, 0);
      assertOut(orderViaWrite, '(subagent identity)');
      const orderViaBash = runHook(['before_tool'], dir,
        { tool_name: 'Bash', tool_input: { command: 'echo x > "' + posix(outsideRoot) + '"' }, agent_id: 'agent-abc123' });
      assertExit(orderViaBash, 0);
      // ⑦b 载荷 cwd 不参与路径解释（会话 cwd 与实际工作目录不一致的实测形态）：身份在场时
      //     cwd 指向别处 + 相对路径 ⇒ 仍按身份放行（不因 cwd 不一致而误拦）
      const viaCwdDrift = runHook(['before_tool'], dir, {
        tool_name: 'Write',
        tool_input: { file_path: 'src/rel.mjs' },
        cwd: path.join(dir, '..', 'elsewhere-232'),
        agent_id: 'agent-abc123',
      });
      assertExit(viaCwdDrift, 0);
      // ⑦c 同载荷无身份 ⇒ 相对路径按 runRoot 解析（cwd 不参与）⇒ 白名单外 BLOCK，且报文中不出现
      //     按 cwd 解析出的错路径（cwd 漂移不得改变判定依据）
      const cwdDriftMain = runHook(['before_tool'], dir, {
        tool_name: 'Write',
        tool_input: { file_path: 'src/rel.mjs' },
        cwd: path.join(dir, '..', 'elsewhere-232'),
      });
      assertExit(cwdDriftMain, 2);
      assertOut(cwdDriftMain, 'BLOCKED');
      assertNotOut(cwdDriftMain, 'elsewhere-232');

      // ⑧ runRoot 外写入的关断，两分支对称：同一目标经 Write / Edit（file_path 分支）与 Bash
      //    （命令级写入）同判 BLOCK——修复前 file_path 分支静默放行（fail-open）而 Bash 分支拦截。
      //    反向构造：恢复 file_path 分支的静默放行 ⇒ ⑧a / ⑧b 必红。
      const outsideWrite = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: outsideRoot } });
      assertExit(outsideWrite, 2);
      assertOut(outsideWrite, 'BLOCKED');
      assertOut(outsideWrite, '项目根之外');
      const outsideEdit = runHook(['before_tool'], dir,
        { tool_name: 'Edit', tool_input: { file_path: outsideRoot } });
      assertExit(outsideEdit, 2);
      assertOut(outsideEdit, 'BLOCKED');
      const outsideBash = runHook(['before_tool'], dir,
        { tool_name: 'Bash', tool_input: { command: 'echo x > "' + posix(outsideRoot) + '"' } });
      assertExit(outsideBash, 2);
      assertOut(outsideBash, 'BLOCKED');
      // ⑧b 身份在场时两分支同样对称放行（顺序锚在 Bash 分支上的对照——见 ⑦a 第二例）

      // ⑨ 最小保护集：身份放行**不放行**两个机器面目标——机器状态文件与本次运行实际生效的
      //    协议文件（三平台身份形态一致受拦）。反向构造：身份短路时跳过保护集判定 ⇒ ⑨ 必红。
      const stateFileTarget = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const protocolFileTarget = path.join(dir, 'reference', 'workflow-protocol.json');
      for (const [label, target] of [['机器状态文件', stateFileTarget], ['协议保护路径', protocolFileTarget]]) {
        const viaIdentityWrite = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: target }, agent_id: 'agent-abc123' });
        assertExit(viaIdentityWrite, 2);
        assertOut(viaIdentityWrite, 'BLOCKED');
        const viaIdentityEdit = runHook(['before_tool'], dir,
          { tool_name: 'Edit', tool_input: { file_path: target }, agent_id: 'agent-abc123' });
        assertExit(viaIdentityEdit, 2);
        assertOut(viaIdentityEdit, 'BLOCKED');
        const viaIdentityBash = runHook(['before_tool'], dir,
          { tool_name: 'Bash', tool_input: { command: 'echo x > "' + posix(target) + '"' }, agent_id: 'agent-abc123' });
        assertExit(viaIdentityBash, 2);
        assertOut(viaIdentityBash, 'BLOCKED');
        const viaDepthWrite = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: target } }, bridgeIdentityEnv('2'));
        assertExit(viaDepthWrite, 2);
        assertOut(viaDepthWrite, 'BLOCKED');
        // 报文须点名保护集类别（经桥接通道身份放行下的拦截理由）：协调者路径的报语文义不同
        // （state 文件另有同族点名的协调者分支，协议面则是「不在允许范围」）⇒ 本断言锁住「身份
        // 在场仍走保护集判定」而非靠白名单兜底（判别力见 ⑥c2 的继承形态对照）。
        assertOut(viaDepthWrite, label === '机器状态文件' ? 'state 文件' : '协议文件');
        const codexIdentityBlock = runHook(['before_tool', '--platform', 'codex'], dir,
          { tool_name: 'Write', tool_input: { file_path: target }, agent_id: 'agent-abc123' });
        assertExit(codexIdentityBlock, 0);
        assertOut(codexIdentityBlock, '"decision":"block"');
        if (!codexIdentityBlock.output.includes(label === '机器状态文件' ? 'state 文件' : '协议文件')) {
          throw new Error('保护集拦截报文应点名目标类别（' + label + '）: ' + JSON.stringify(codexIdentityBlock.output));
        }
      }
      // ⑨b 对照：同一身份写普通源码 / 工件路径 ⇒ 放行（保护集不扩大——只此两个目标）
      const identityAllowedSource = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: whitelistOutside }, agent_id: 'agent-abc123' });
      assertExit(identityAllowedSource, 0);
      const identityAllowedArtifact = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', CHANGE_ID, 'note.md') }, agent_id: 'agent-abc123' });
      assertExit(identityAllowedArtifact, 0);
      // ⑨c 别名形态闭合（物理同一性）：经 8.3 短路径 / 符号链接拼写的同一状态文件同样受拦
      //     （词法比较看不见别名——身份放行下保护集是唯一防线，故须闭合）。平台无法构造链接时
      //     如实降级为可见提示，不静默跳过。
      const stateAliasDir = path.join(dir, '.flow-comet-alias');
      let aliasLinkCreated = false;
      try {
        fs.symlinkSync(path.join(dir, '.flow-comet'), stateAliasDir,
          process.platform === 'win32' ? 'junction' : 'dir');
        aliasLinkCreated = true;
      } catch { aliasLinkCreated = false; }
      if (aliasLinkCreated) {
        const viaAlias = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: path.join(stateAliasDir, 'flow-comet-state.json') }, agent_id: 'agent-abc123' });
        assertExit(viaAlias, 2);
        assertOut(viaAlias, 'BLOCKED');
      } else {
        console.error('WARN: 当前平台无法构造目录链接，保护集别名形态断言降级（词法判定仍由 ⑨ 覆盖）');
      }
      // ⑨d 盘符根拼写（Windows 上 Git-Bash 类 shell 的 `/d/<剩余>` 形态）与盘符拼写**同判**：
      //     win32 的目标解析把 `/d/<剩余>` 读成「当前盘根下的 \d\<剩余>」而非 `D:\<剩余>` ⇒
      //     词法相对化判为根外（相对路径为空）⇒ 状态文件判据被跳过；物理判据对错解路径 stat
      //     失败 ⇒ 两道判据同时失守——身份放行下保护集形同虚设（fail-open）。归一入口唯一
      //     （既有写入目标解析），故两条判据同时闭合、各等价拼写同判。
      //     该拼写是 Windows 上 Git-Bash 类 shell 的自然产物；非 win32 平台它是普通 POSIX
      //     绝对路径，语义不同 ⇒ 显式不适用（不静默跳过——未验证 ≠ 通过）。
      const hasDriveRoot = /^[A-Za-z]:[\\/]/.test(dir);
      if (process.platform === 'win32' && hasDriveRoot) {
        const driveRootSpelling = (p) => '/' + p[0].toLowerCase() + p.slice(2).replaceAll('\\', '/');
        for (const [label, target, marker] of [
          ['机器状态文件', stateFileTarget, 'state 文件'],
          ['协议保护路径', protocolFileTarget, '协议文件'],
        ]) {
          const exits = [];
          const forms = [['盘符根拼写', driveRootSpelling(target)], ['盘符拼写', posix(target)]];
          for (const [formLabel, form] of forms) {
            const viaWrite = runHook(['before_tool'], dir,
              { tool_name: 'Write', tool_input: { file_path: form }, agent_id: 'agent-abc123' });
            assertExit(viaWrite, 2);
            assertOut(viaWrite, marker);
            const viaBash = runHook(['before_tool'], dir,
              { tool_name: 'Bash', tool_input: { command: 'cp "' + form + '" "' + form + '"' }, agent_id: 'agent-abc123' });
            assertExit(viaBash, 2);
            assertOut(viaBash, marker);
            exits.push(viaWrite.status, viaBash.status);
            if (formLabel === '盘符根拼写') {
              // 盘符字母大写变体同归一（同族拼写不得因大小写漏判）
              const upper = runHook(['before_tool'], dir,
                { tool_name: 'Write', tool_input: { file_path: '/' + form[1].toUpperCase() + form.slice(2) }, agent_id: 'agent-abc123' });
              assertExit(upper, 2);
              assertOut(upper, marker);
            }
          }
          if (exits.some((code) => code !== exits[0])) {
            throw new Error(label + ' 的两种拼写应同判，实际 exit: ' + JSON.stringify(exits));
          }
          if (label === '机器状态文件') {
            // 协调者路径（无身份）同样闭合：命令级写入的盘符根拼写命中状态文件判据 ⇒ 报文点名
            // 目标类别（修复前落到「不在允许范围」兜底分支——证明目标确被抽取，缺口在判定）
            const msysMain = driveRootSpelling(target);
            const asMain = runHook(['before_tool'], dir,
              { tool_name: 'Bash', tool_input: { command: 'cp "' + msysMain + '" "' + msysMain + '"' } });
            assertExit(asMain, 2);
            assertOut(asMain, marker);
          }
        }
        // ⑨e 对照：同一身份写普通源码的盘符根拼写 ⇒ 放行（归一不得把保护集扩大到其余路径）
        const msysSource = driveRootSpelling(whitelistOutside);
        const msysSourceWrite = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: msysSource }, agent_id: 'agent-abc123' });
        assertExit(msysSourceWrite, 0);
        assertOut(msysSourceWrite, '(subagent identity)');
        const msysSourceBash = runHook(['before_tool'], dir,
          { tool_name: 'Bash', tool_input: { command: 'cp "' + msysSource + '" "' + msysSource + '"' }, agent_id: 'agent-abc123' });
        assertExit(msysSourceBash, 0);
        // ⑨f 单字母限定（`/dev`、`/etc` 一类多字母首段不得被当作盘符根）：该目标按「当前盘根下的
        //     同名目录」解析 ⇒ 项目根之外 ⇒ 协调者拦截报文带根外语义。若归一放宽为「首字母后不要求
        //     分隔符」，目标被改写成盘符相对形态后落在项目根内 ⇒ 报文语义改变 ⇒ 本断言必红。
        const notDriveRoot = '/' + dir[0].toLowerCase() + 'ev/probe.md';
        const notDriveRootRes = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: notDriveRoot } });
        assertExit(notDriveRootRes, 2);
        assertOut(notDriveRootRes, '项目根之外');
      } else {
        // 非 win32：该拼写是**普通 POSIX 绝对路径**，归一只许在 win32 生效（否则同一目标会被改写成
        //     项目根内的相对形态，报文失去根外语义）。本断言锁的是「平台限定」这半边——正向断言在
        //     本平台不适用，故此处改为可判别的替代锚（断言失败即说明归一变无条件）。
        const posixSpelling = '/d/probe.md';
        const posixRes = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: posixSpelling } });
        assertExit(posixRes, 2);
        assertOut(posixRes, '项目根之外');
        console.error('注意: 本平台无盘符根形态，盘符根拼写的归一等价性断言**显式不适用**'
          + '（dsh/pwsh 与 Codex/cmd 不产生该拼写；win32 侧为唯一判别面）——已改为断言平台限定半边'
          + '（该拼写在本平台不得被归一到项目根内）；未验证 ≠ 通过');
      }

      // ⑩ apply_patch 承载形态的耐久锚（in-place 扩展）：补丁正文写在 tool_input.command、
      //    载荷无 file_path——目标须由补丁摘要行抽出后才进入既有判定入口（白名单与最小保护集
      //    共用同一返回值）。判据与内建反向构造见模块级 applyPatchAnchorProblems。
      const patchProblems = applyPatchAnchorProblems(dir);
      if (patchProblems.length > 0) {
        throw new Error('apply_patch 目标解析锚失败: ' + patchProblems.join('; '));
      }
    },
  },

  // 233: 迁移前置探测的错误分类——lstat 的**访问类**故障（EACCES/EPERM/EIO）不得被当作
  // 「文件不存在」：吞掉会让迁移报告「已跳过：旧位置不存在」而安装照常继续，用户的旧状态
  // 永远留在旧位置（静默的数据丢失风险）。修复后只有「确实不存在」类（ENOENT/ENOTDIR）
  // 返回 null，其余原样抛出、安装中止并暴露问题。
  // 构造方式：本机/CI 无法用真实文件系统稳定造出访问类故障（受权限与平台差异支配，
  // 见场景 223 的链接权限先例），故用 `--require` 预加载在**子进程内**把 lstatSync 对
  // 「旧位置状态文件」的探测替换为抛 EACCES（故障注入只命中该路径，其余调用走真实实现）——
  // 驱动的仍是真实安装器主流程与真实文件系统状态。
  {
    name: '233 迁移探测错误分类：lstat 访问类故障中止安装，ENOENT 仍按不存在跳过',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      // ① ENOENT（确实不存在）→ 仍按「无需迁移」跳过、安装继续（行为未变）
      const noLegacy = path.join(dir, 'proj-no-legacy');
      fs.mkdirSync(noLegacy, { recursive: true });
      const skipped = runPrepareEnv(['--target', noLegacy, '--platform', 'claude-code'], dir);
      assertExit(skipped, 0);
      assertOut(skipped, '已跳过');
      assertOut(skipped, '无需迁移');
      // ② 访问类故障 → 中止（修复前被吞成「不存在」→ 已跳过 + 安装继续 → RED）
      const proj = path.join(dir, 'proj-lstat-fault');
      const stateBytes = migratableStateBytes();
      writeSharedCometDir(proj, stateBytes);
      const preloadName = 'lstat-fault-preload.cjs';
      writeFile(dir, preloadName, [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        'const realLstatSync = fs.lstatSync;',
        'fs.lstatSync = function (target, ...rest) {',
        '  const segments = path.resolve(String(target)).split(path.sep);',
        "  const isLegacyStateFile = segments[segments.length - 1] === 'flow-comet-state.json'",
        "    && segments[segments.length - 2] === '.comet';",
        '  if (isLegacyStateFile) {',
        "    const error = new Error('EACCES: permission denied, lstat ' + JSON.stringify(String(target)));",
        "    error.code = 'EACCES';",
        '    throw error;',
        '  }',
        '  return realLstatSync.call(fs, target, ...rest);',
        '};',
        '',
      ].join('\n'));
      const spawned = spawnSync(
        process.execPath,
        ['--require', path.join(dir, preloadName), PREPARE_ENV, '--target', proj, '--platform', 'claude-code'],
        { cwd: dir, env: { ...process.env }, encoding: 'utf8', timeout: 120000 },
      );
      const res = { status: spawned.status ?? 1, output: String(spawned.stdout || '') + String(spawned.stderr || '') };
      if (res.status === 0) throw new Error('访问类故障应中止安装（exit 非 0），实际 exit 0');
      assertOut(res, 'EACCES');
      assertNotOut(res, '已跳过');
      assertNotOut(res, '已迁移');
      // 旧件未被处置、新位置不生成文件（中止于任何写操作之前）
      if (!fs.readFileSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME)).equals(stateBytes)) {
        throw new Error('中止路径下旧件被改写');
      }
      if (fs.existsSync(path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME))) throw new Error('中止时新位置不应生成文件');
      if (migrationBackups(proj).length !== 0) throw new Error('中止时不应产生备份');
    },
  },

  // 234: 迁移校验与运行时判定的 BOM 一致性——运行时（workflow-state.mjs readJson）明确容忍
  // UTF-8 BOM（外部写入如会话 Write 可能带 BOM）。迁移侧此前不 strip BOM：同一份数据运行时
  // 读得动、迁移判「不是合法 JSON」而中止安装。修复后校验侧同样容忍 BOM，且**只影响校验**——
  // 备份与新落盘必须保留原始字节（不得改写用户数据）。
  {
    name: '234 状态迁移接受带 BOM 的旧状态：迁移成功且备份与新位置保留原始字节',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const bomStateBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), migratableStateBytes()]);
      writeSharedCometDir(proj, bomStateBytes);
      writeMigratedProjectArtifacts(proj); // ③ 运行时读取断言需要活动 change 目录在场
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      assertExit(res, 0);
      assertOut(res, '已迁移');
      // ① 新位置落位且逐字节一致（BOM 保留——校验容忍不改写数据）
      const newState = path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME);
      if (!fs.readFileSync(newState).equals(bomStateBytes)) {
        throw new Error('新位置状态未保留原始字节（BOM 被剥离或内容被改写）');
      }
      // ② 备份同样逐字节一致
      const backups = migrationBackups(proj);
      if (backups.length !== 1) throw new Error('迁移应恰生成 1 份备份，实际: ' + JSON.stringify(backups));
      if (!fs.readFileSync(path.join(proj, RUNTIME_DIR, backups[0])).equals(bomStateBytes)) {
        throw new Error('备份未保留原始字节（BOM 被剥离或内容被改写）');
      }
      // ③ 迁移后运行时能读（BOM 容忍是运行时的既有设计决策——两处判定一致）
      const st = runInstalled(proj, '.claude', 'workflow-state.mjs', ['status']);
      assertExit(st, 0);
      assertOut(st, MIGRATION_CHANGE);
    },
  },

  // 235: 被拒绝的命令不得产生副作用——`--purge` 缺 `--yes` 的确认校验此前排在运行时文件
  // 迁移之后：命令最终被拒绝，但迁移已经执行、目标已被修改。修复后确认校验先于一切写操作。
  {
    name: '235 purge 缺 --yes：命令被拒且迁移未发生（零副作用）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const stateBytes = migratableStateBytes();
      writeSharedCometDir(proj, stateBytes);
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code', '--purge'], dir);
      if (res.status === 0) throw new Error('--purge 缺 --yes 应拒绝执行（exit 非 0），实际 exit 0');
      assertOut(res, '--yes');
      assertNotOut(res, '已迁移');
      // 零副作用：旧件原位未动、新位置不生成文件、不产生备份、无安装产物
      const oldPath = path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME);
      if (!fs.existsSync(oldPath)) throw new Error('被拒绝的命令仍执行了迁移（旧位置文件已消失）');
      if (!fs.readFileSync(oldPath).equals(stateBytes)) throw new Error('被拒绝的命令改写了旧件');
      if (fs.existsSync(path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME))) throw new Error('被拒绝的命令仍写入了新位置');
      if (migrationBackups(proj).length !== 0) throw new Error('被拒绝的命令仍产生了备份');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('被拒绝的命令仍产生了安装产物');
    },
  },

  // ---------- 命令写判定的写入目标取向（Copy/Move 与位置形态） ----------

  // 236: 命令写判定的写入目标取向——Copy-Item/Move-Item 的 `-Path`/`-LiteralPath` 是**源**路径，
  // 写入目标是 `-Destination`。修复前 cmdlet 模式只捕获 `-(Path|LiteralPath)`（源），且全无
  // `-Destination` 模式 → 目标从不被检查（越界写整条放行）；而同文件 .NET File API 分支按
  // 「Copy/Move 目标 = 第二参数」取第二个捕获组——同一函数两个分支取向相反。
  // 修复后按目的地取值（与 .NET 分支同向）：① 目标越界 → BLOCK（修复前放行 → RED）；
  // ② 源在白名单外而目标在白名单内 → 放行（源是读取方向，不属写入判定；修复前拿源当目标 → 误拦 → RED）；
  // ③ 源与目标都在白名单内 → 放行（放行不得因本次修复收窄）。
  {
    name: '236 hook 命令写：Copy-Item/Move-Item 取 -Destination 为写入目标（目标越界拦、源路径不再误拦）',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      const src = '.specs/' + CHANGE_ID + '/x.md';
      const inside = '.specs/' + CHANGE_ID + '/copy.md';
      // ① 逃逸：目标在协调者白名单（.specs/）之外
      const escapeCopy = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Copy-Item -Path ' + src + ' -Destination CLAUDE.md' },
      });
      assertExit(escapeCopy, 2);
      assertOut(escapeCopy, 'BLOCKED');
      assertOut(escapeCopy, 'CLAUDE.md');
      const escapeMove = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Move-Item -Path ' + src + ' -Destination docs/MECHANISM.md' },
      });
      assertExit(escapeMove, 2);
      assertOut(escapeMove, 'BLOCKED');
      assertOut(escapeMove, 'docs/MECHANISM.md');
      // ② 源在白名单外、目标在白名单内 → 放行（读取方向不判定为写入）
      const sourceOutside = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Copy-Item -LiteralPath CLAUDE.md -Destination ' + inside },
      });
      assertExit(sourceOutside, 0);
      assertOut(sourceOutside, 'workflow-hook-guard-ok');
      // ③ 源与目标都在白名单内 → 放行
      const bothInside = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Copy-Item -Path ' + src + ' -Destination ' + inside },
      });
      assertExit(bothInside, 0);
      assertOut(bothInside, 'workflow-hook-guard-ok');
    },
  },

  // 237: 位置形态 `cp <src> <dst>` / `mv <src> <dst>`——修复前命令写判定只认 PowerShell cmdlet、
  // shell 重定向与 .NET File API，位置形态无任何模式覆盖 → 越界写整条放行。
  // 修复后取最后一个位置参数为目标（开关及其取值不参与）：① 目标越界 → BLOCK（修复前放行 → RED）；
  // ② 目标在白名单内 → 放行；③ `cp` 只作为普通参数出现（不是命令词）时不产生写入目标
  // （命令位置锚定——否则 `grep -n cp <file>` 会把文件名当成写入目标 → 反过来造成误拦）。
  {
    name: '237 hook 命令写：cp/mv 位置形态取最后位置参数为目标（逃逸拦截，命令位置锚定不误判）',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      const src = '.specs/' + CHANGE_ID + '/x.md';
      const inside = '.specs/' + CHANGE_ID + '/copy.md';
      const cpEscape = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp ' + src + ' CLAUDE.md' },
      });
      assertExit(cpEscape, 2);
      assertOut(cpEscape, 'BLOCKED');
      assertOut(cpEscape, 'CLAUDE.md');
      const mvEscape = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'mv -f ' + src + ' README-zh.md' },
      });
      assertExit(mvEscape, 2);
      assertOut(mvEscape, 'BLOCKED');
      assertOut(mvEscape, 'README-zh.md');
      // 目标在白名单内 → 放行（含开关：开关与其取值不参与位置参数扫描）
      const cpInside = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp -f CLAUDE.md ' + inside },
      });
      assertExit(cpInside, 0);
      assertOut(cpInside, 'workflow-hook-guard-ok');
      // 命令位置锚定：`cp` 作为普通参数出现（grep 模式）不是写命令
      const notCommand = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'grep -n cp README.md' },
      });
      assertExit(notCommand, 0);
      assertOut(notCommand, 'workflow-hook-guard-ok');
    },
  },

  // 238: 纯位置形态（`Copy-Item <src> <dst>`）与 `-FilePath`（Out-File 的惯用主参数）修复前均无
  // 模式覆盖 → 放行；修复后两者都按写入目标判定。同场景锚定既有 `-Path` 语义未被本次修复放宽
  // （Set-Content / Remove-Item 的 `-Path` 就是写入目标：越界拦、白名单内放行）。
  {
    name: '238 hook 命令写：纯位置形态与 -FilePath 目标覆盖，既有 -Path 语义保持',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      const src = '.specs/' + CHANGE_ID + '/x.md';
      const positional = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Copy-Item ' + src + ' CLAUDE.md' },
      });
      assertExit(positional, 2);
      assertOut(positional, 'BLOCKED');
      assertOut(positional, 'CLAUDE.md');
      const filePath = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Out-File -FilePath docs/MECHANISM.md' },
      });
      assertExit(filePath, 2);
      assertOut(filePath, 'BLOCKED');
      assertOut(filePath, 'docs/MECHANISM.md');
      // 开关取值不参与位置参数扫描：`-Filter *.md` 的 `*.md` 不是写入目标（当成目标即新的误拦）
      const filterValue = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Remove-Item -Force -Filter *.md' },
      });
      assertExit(filterValue, 0);
      assertOut(filterValue, 'workflow-hook-guard-ok');
      // 既有 -Path 语义保持（回归锚）：越界拦
      const removePath = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Remove-Item -Path docs/MECHANISM.md' },
      });
      assertExit(removePath, 2);
      assertOut(removePath, 'BLOCKED');
      const setContentOut = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Set-Content -Path docs/MECHANISM.md -Value x' },
      });
      assertExit(setContentOut, 2);
      assertOut(setContentOut, 'BLOCKED');
      // 既有 -Path 语义保持（回归锚）：白名单内放行
      const setContentIn = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Set-Content -Path ' + src + ' -Value x' },
      });
      assertExit(setContentIn, 0);
      assertOut(setContentIn, 'workflow-hook-guard-ok');
    },
  },

  // 239: 目的地型命令的参数段必须止于换行——段捕获 `[^;|&]*` 不排除 `\r`/`\n`，`cp <src> <dst>`
  // 之后紧跟另一行命令时段会跨行吞并：「最后一个位置参数」取到下一行的参数（通常在白名单内）
  // → 整条命令放行，**真正被写的 <dst> 从不被检查**（逃逸方向）。修复后换行/回车都是段边界，
  // 每行命令按各自参数段判定。
  {
    name: '239 hook 命令写：目的地型命令的段不跨行（跨行吞并使真实目标漏检 → 拦）',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      const src = '.specs/' + CHANGE_ID + '/x.md';
      const inside = '.specs/' + CHANGE_ID + '/ok.md';
      // ① 目标越界、下一行参数在白名单内：修复前取到下一行参数 → 放行（逃逸）
      const crossLine = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp ' + src + ' CLAUDE.md\necho ' + inside },
      });
      assertExit(crossLine, 2);
      assertOut(crossLine, 'BLOCKED');
      assertOut(crossLine, 'CLAUDE.md');
      // ② CRLF 行尾（Windows 形态）同判：`\r` 也是段边界
      const crlf = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp ' + src + ' CLAUDE.md\r\necho ' + inside },
      });
      assertExit(crlf, 2);
      assertOut(crlf, 'BLOCKED');
      assertOut(crlf, 'CLAUDE.md');
      // ③ 行首是普通命令、写命令在第二行 → 第二行仍被独立判定（多行命令串的覆盖保持）
      const secondLine = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'echo ' + inside + '\nmv ' + src + ' README-zh.md' },
      });
      assertExit(secondLine, 2);
      assertOut(secondLine, 'BLOCKED');
      assertOut(secondLine, 'README-zh.md');
      // ④ 单行且目标在白名单内 → 放行（收紧段边界不得误伤合法形态）
      const singleLine = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp ' + src + ' ' + inside },
      });
      assertExit(singleLine, 0);
      assertOut(singleLine, 'workflow-hook-guard-ok');
    },
  },

  // 240: GNU cp/mv 的**前置目的地**选项 `-t <dir>` / `--target-directory[= ]<dir>`——目的地不是
  // 最后一个位置参数而是开关的取值。修复前只把开关跳过取值、仍取「最后一个位置参数」= 源
  // （源通常在白名单内）→ 整条命令放行，真正被写的目录不被检查（逃逸方向）。
  {
    name: '240 hook 命令写：cp/mv 前置目的地 -t / --target-directory 取为写入目标',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      const src = '.specs/' + CHANGE_ID + '/x.md';
      const inside = '.specs/' + CHANGE_ID + '/ok.md';
      // ① `-t <dir>`：目的地越界 → 拦（修复前取源 → 放行）
      const shortForm = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp -t docs ' + src },
      });
      assertExit(shortForm, 2);
      assertOut(shortForm, 'BLOCKED');
      assertOut(shortForm, 'docs');
      // ② `--target-directory=<dir>`（等号形态）
      const longFormEquals = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp --target-directory=docs ' + src },
      });
      assertExit(longFormEquals, 2);
      assertOut(longFormEquals, 'BLOCKED');
      assertOut(longFormEquals, 'docs');
      // ③ `--target-directory <dir>`（空格形态）
      const longFormSpace = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'mv --target-directory docs ' + src },
      });
      assertExit(longFormSpace, 2);
      assertOut(longFormSpace, 'BLOCKED');
      assertOut(longFormSpace, 'docs');
      // ④ 前置目的地在白名单内 → 放行（不得因本次修复误拦）
      const insideTarget = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'mv -t .specs/' + CHANGE_ID + ' ' + src },
      });
      assertExit(insideTarget, 0);
      assertOut(insideTarget, 'workflow-hook-guard-ok');
      // ⑤ 反向锚：无前置目的地的普通形态仍按最后位置参数判定（既有语义保持）
      const plain = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp -f ' + src + ' ' + inside },
      });
      assertExit(plain, 0);
      assertOut(plain, 'workflow-hook-guard-ok');
    },
  },

  // 241: 命令位置锚定必须引号感知——命令边界集 `[;&|(){}]` 不区分引号内外，`printf '(cp CLAUDE.md)'`
  // 引号内的括号被当成命令边界，括号里的文本被读成写命令 → **合法命令被拦**（误拦方向）。
  // 修复后边界只在引号外生效；引号外的真命令仍按原判据拦截（收紧不得放过真逃逸）。
  {
    name: '241 hook 命令写：引号内的命令分隔符不构成命令位置（合法命令不被读成写命令）',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      // ① 单引号内的括号：不是命令边界
      const singleQuoted = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: "printf '(cp CLAUDE.md)'" },
      });
      assertExit(singleQuoted, 0);
      assertOut(singleQuoted, 'workflow-hook-guard-ok');
      // ② 双引号内的分号：不是命令分隔符
      const doubleQuoted = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'echo "cp CLAUDE.md; mv x README.md"' },
      });
      assertExit(doubleQuoted, 0);
      assertOut(doubleQuoted, 'workflow-hook-guard-ok');
      // ③ 引号外的真写命令仍拦（同一命令串内引号内文本与真命令并存）
      const realCommand = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'printf "(cp x)" ; cp .specs/' + CHANGE_ID + '/x.md CLAUDE.md' },
      });
      assertExit(realCommand, 2);
      assertOut(realCommand, 'BLOCKED');
      assertOut(realCommand, 'CLAUDE.md');
      // ④ 既有意图保持：`cp` 只作为被检索文本出现时不构成命令位置（不误判为写命令）
      const notCommand = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'grep -n "cp" README.md' },
      });
      assertExit(notCommand, 0);
      assertOut(notCommand, 'workflow-hook-guard-ok');
    },
  },

  // 242: ATX 标题的**闭合标记**（`## 名称 ##`——合法 Markdown）须在段名归一中被剥离。
  // 不剥离时段名归一为 `名称 ##`，与模板段名不等 → 七段全判缺失 → INIT-VALIDATE-FAILED，
  // 依赖 CONTEXT 结构校验的流程被误阻断（记录扫描时间的正常路径走不通）。
  // 与场景 90（同夹具、无闭合标记）成对：唯一变量就是闭合标记本身。
  {
    name: '242 CONTEXT 段标题带 ATX 闭合标记 → 段存在判定通过（INIT-DONE）',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', [
        '# CONTEXT',
        '## 项目概要 ##', 'x',
        '## 技术栈 ##', 'x',
        '## 域语言 ##', '| 术语 | 定义 |', '|---|---|', '| 例 | 定义 |',
        '## 已锁决策 ##', '- [2026-08-01] 决策一',
        '## 默认偏好 ##', 'x',
        '## 既有抽象索引 ##', 'x',
        '## intel-scan 元数据 ##', '- **last_intel_scan**: x', '- **scanner**: x', '- **下次重扫建议**: x',
        '',
      ].join('\n'));
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-DONE');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.last_intel_scan) throw new Error('闭合标记形态应通过段存在判定并写 last_intel_scan');
      // ② 闭合标记须**前置空白**（CommonMark 语义）：`## 项目概要#` 不是闭合形态，段名即
      //    `项目概要#`——它不得被剥成 `项目概要`（否则缺段被假判为存在）。这条边界锁住剥离
      //    范围：将来把前置空白放宽成「任意位置」，此处即变红。
      writeFile(dir, '.specs/CONTEXT.md', [
        '# CONTEXT',
        '## 项目概要#', 'x',
        '## 技术栈 ##', 'x',
        '## 域语言 ##', '| 术语 | 定义 |', '|---|---|', '| 例 | 定义 |',
        '## 已锁决策 ##', '- [2026-08-01] 决策一',
        '## 默认偏好 ##', 'x',
        '## 既有抽象索引 ##', 'x',
        '## intel-scan 元数据 ##', '- **last_intel_scan**: x', '- **scanner**: x', '- **下次重扫建议**: x',
        '',
      ].join('\n'));
      const boundary = runStateWithProtocol(dir, ['init', CHANGE_ID + '-2', '--init-context']);
      assertExit(boundary, 0);
      assertOut(boundary, 'INIT-VALIDATE-FAILED');
      assertOut(boundary, '项目概要');
    },
  },
];
