// items/l.mjs — 条目分区：K 组尾部（状态迁移 / 分发面 / 契约核对三项）+ L 组条目（执行遗漏防护）
//
// 数据层约定：同 items/a.mjs 头注（只承载 ENTRIES；夹具从 lib/system-fixtures.mjs 取；组文件之间零 import）。
// 组界：本文件先承载 K 组尾部三项、再承载 L 组条目——见 items/k.mjs 头注。
// 带 `surface` 声明的条目在导出前统一接入分发面契约（见 applyDistributionSurface）。

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { assertExit, assertNotOut, assertOut, baseState, runGuard, runState, writeFile, writeState } from '../lib/test-helpers.mjs';
import { SCRIPTS_DIR, CONTRACT, resolvePackageContext, assertPackageContextJudgment, seedForeignFlowKit, assertPublishableManifest, assertPackageBoundary, assertWorkflowContractCheck, assertBinContract, assertInitTokenContract, assertInstallerUpgradePathCleanup, assertMirrorRootLinkFailClosed, CHANGE_ID, readStateFile, gitInit, writeIntakeArtifacts, DISTRIBUTION_MARKERS, applyDistributionSurface } from '../lib/system-fixtures.mjs';

const RAW_ENTRIES = [

  // K17: 旧布局项目（状态文件在旧命名空间 + 同目录 Comet 资产/用户文件）经安装器自动迁移后，
  // 真实安装副本上的流程可继续——状态逐字节搬移且可读、合规节点链路 entry → record → exit
  // 正常推进、Comet 资产与用户文件原位未动。端到端执行断言（真实命令序列，非形态断言）。
  {
    name: 'K17 状态迁移:旧布局项目安装后状态可读且流程可继续',
    surface: '旧布局状态迁移与节点推进断言仅权威源侧可判',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      const target = path.join(dir, 'k17-target');
      const legacyDir = path.join(target, '.comet');
      fs.mkdirSync(legacyDir, { recursive: true });
      // 迁移前状态（进行中的 change：design 节点待完成）
      const stateBytes = Buffer.from(JSON.stringify({
        activeChange: 'mig-ch',
        currentNode: 'design',
        completedNodes: ['open'],
        evidence: { open: { summary: 'intake complete' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      }, null, 2) + '\n', 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'flow-comet-state.json'), stateBytes);
      // 同目录的非 flow-comet 内容（旧目录三方共占实测形态）：迁移不得处置它们
      fs.writeFileSync(path.join(legacyDir, 'config.yaml'), 'workflow:\n  projectPath: docs/openspec\n');
      const userBytes = Buffer.from('user backup\n', 'utf8');
      fs.writeFileSync(path.join(legacyDir, 'flow-comet-state.json.bak-20260901-user'), userBytes);
      // 活动 change 工件（迁移后流程可继续的前提）
      writeFile(target, '.specs/mig-ch/CHANGE.md', '# CHANGE\n\n- **Change ID**: mig-ch\n\n## Why（为什么做）\n\nx\n');
      writeFile(target, '.specs/mig-ch/REQUIREMENT.md', '# REQUIREMENT\n\n- **Change ID**: mig-ch\n\n## 用户故事（User Story）\n\nx\n\n## 验收准则（AC）\n\n- y\n');
      writeFile(target, '.specs/mig-ch/DESIGN.md', '# DESIGN\n\n- **Change ID**: mig-ch\n\n## 0. 技术栈\n\nNode\n\n## 决策清单\n\n| # | D | R |\n|---|---|---|\n| D1 | x | y |\n');
      seedForeignFlowKit(target); // 安装器不再走网络克隆（与 K14~K16 同手法）
      const install = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'claude-code'], {
        cwd: repoRoot, encoding: 'utf8', timeout: 120000,
      });
      const installRes = { status: install.status ?? 1, output: String(install.stdout || '') + String(install.stderr || '') };
      assertExit(installRes, 0);
      assertOut(installRes, '已迁移');
      // ① 状态逐字节搬到新命名空间；旧位置移除；迁移前备份在场且逐字节一致
      const migrated = path.join(target, '.flow-comet', 'flow-comet-state.json');
      if (!fs.existsSync(migrated)) throw new Error('迁移后新位置状态文件缺失: ' + migrated);
      if (!fs.readFileSync(migrated).equals(stateBytes)) throw new Error('迁移后状态与迁移前不逐字节一致');
      if (fs.existsSync(path.join(legacyDir, 'flow-comet-state.json'))) throw new Error('迁移后旧位置状态文件应已移除');
      const backups = fs.readdirSync(path.join(target, '.flow-comet')).filter((n) => /^flow-comet-state\.json\.bak-/.test(n));
      if (backups.length !== 1) throw new Error('迁移前备份应恰一份: ' + JSON.stringify(backups));
      if (!fs.readFileSync(path.join(target, '.flow-comet', backups[0])).equals(stateBytes)) {
        throw new Error('迁移前备份与迁移前状态不逐字节一致');
      }
      // ② 非 flow-comet 内容原位未动
      if (!fs.readFileSync(path.join(legacyDir, 'config.yaml')).equals(Buffer.from('workflow:\n  projectPath: docs/openspec\n', 'utf8'))) {
        throw new Error('同目录 Comet 资产被改写');
      }
      if (!fs.readFileSync(path.join(legacyDir, 'flow-comet-state.json.bak-20260901-user')).equals(userBytes)) {
        throw new Error('同目录用户文件被改写');
      }
      // ③ 迁移后状态可读（真实安装副本，cwd = 项目根）
      const installed = (script, args) => {
        const res = spawnSync(process.execPath, [path.join(target, '.claude', 'skills', 'flow-comet', 'scripts', script), ...args], {
          cwd: target, encoding: 'utf8', timeout: 60000, env: { ...process.env, FLOW_COMET_RUN_ROOT: target },
        });
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      const before = installed('workflow-state.mjs', ['status']);
      assertExit(before, 0);
      assertOut(before, '"change": "mig-ch"');
      assertOut(before, '"stateCurrentNode": "design"'); // 迁移搬移的状态字段原值可读
      // ④ 流程可继续：entry → record → exit 推进到下一节点
      assertExit(installed('workflow-guard.mjs', ['entry', 'design']), 0);
      assertExit(installed('workflow-state.mjs', ['record', 'design', '{"summary":"design done"}']), 0);
      const exitDesign = installed('workflow-guard.mjs', ['exit', 'design', '--apply']);
      assertExit(exitDesign, 0);
      assertOut(exitDesign, 'ALL CHECKS PASSED');
      const after = installed('workflow-state.mjs', ['status']);
      assertExit(after, 0);
      assertOut(after, '"currentNode": "plan"');
      const finalState = JSON.parse(fs.readFileSync(migrated, 'utf8'));
      if (!Array.isArray(finalState.completedNodes) || !finalState.completedNodes.includes('design')) {
        throw new Error('exit design 后 completedNodes 应含 design: ' + JSON.stringify(finalState.completedNodes));
      }
      console.log('  迁移后链路:状态逐字节搬移 + 备份在场 + status 可读 + 节点推进 design → plan ✓');
    },
  },

  // K18: 分发面（npm 包形态）——可发布性清单 + 包体边界 + bin 双入口 + init 词元形态与红线
  // + 安装器升级路径清理（镜像目录内「权威源已不存在」的条目在重装后必须消失：含反向探针
  // 与幂等断言；`.claude/rules` 一类无命名空间的生成面 fail-closed 不纳入删除面）
  // + 安装器镜像清理的**根级** fail-closed（镜像根自身为链接 / 真实路径越出项目根两变体：
  // 项目外文件必不消失 + 保留原因可见 + 幂等 + 反向构造证明判别力）。
  // 权威源侧真跑断言（npm pack --dry-run 的真实产物清单在场才算通过）；安装副本侧输出显式
  // 「不适用」行并回传同语义的结果标记计通过（禁止静默跳过——「未验证 ≠ 通过」）。
  // 各断言见上方同名助手；结果标记由运行器按环境判据断言（distributionSurface 契约）。
  {
    name: 'K18 分发面:环境判据与包体边界·bin 双入口(权威源真跑/副本显式不适用)与 init 词元红线',
    distributionSurface: true,
    run: (dir) => {
      // 环境判据的判别力锚先跑(与所在环境无关的夹具驱动):判据判错会让下面整段走错分支——
      // 副本侧假红,或权威源侧静默漏检,故判据本身必须先被证明有条判别力。
      assertPackageContextJudgment(dir);
      const pkgCtx = resolvePackageContext();
      const marker = DISTRIBUTION_MARKERS[pkgCtx.kind];
      // 安装器分发面断言（升级路径清理）：权威源侧真跑真实命令序列，安装副本侧输出显式
      // 「不适用」行（两侧都出声——副本侧不是静默跳过）；故置于环境分支之前调用。
      assertInstallerUpgradePathCleanup(dir);
      // 安装器分发面断言（镜像清理的根级 fail-closed）：同一注入点的第二组判据——根自身为链接 /
      // 真实路径越界两变体 + 反向构造；副本侧同样输出显式「不适用」行。
      assertMirrorRootLinkFailClosed(dir, pkgCtx);
      if (pkgCtx.kind === 'copy') {
        console.log('  不适用（安装副本侧：' + pkgCtx.reason + '）——包体边界/bin 断言仅权威源侧可判，本项计通过');
        return marker;
      }
      assertPublishableManifest(pkgCtx.pkg);
      assertPackageBoundary(pkgCtx.root);
      assertWorkflowContractCheck(dir);
      assertInitTokenContract(assertBinContract(pkgCtx.pkg, pkgCtx.root), dir);
      return marker;
    },
  },

  // K19: 契约核对脚本 CLI 契约——五组真实命令断言（临时夹具 app/x.py 含 status 赋值、src/y.ts 含 status 比较）：
  // ① 显式 --backend/--frontend → exit 0 且输出含两个实际解析路径与两侧真实命中；
  // ② 缺省回退（cwd=夹具、无目录参数）→ exit 0 且两侧命中；
  // ③ 悬空 --backend（缺值）→ exit 1 + 用法错误；
  // ④ --project <夹具>（从夹具外运行）→ exit 0 且两侧命中（证明显式根优先于 cwd）；
  // ⑤ 单横线操作数（--backend -bad-dir / --project -x / --frontend -y）→ exit 1 + 用法与非法操作数提示
  //    （此前被当作目录接受、零命中仍 exit 0——fail-closed 缺口回归锚）。
  // 夹具随所在项临时目录由运行器统一清理，不留残留。
  {
    name: 'K19 契约核对:显式目录解析与缺省回退·悬空参数用法错误·单横线操作数拒绝·--project 形态(真实命令序列)',
    run: (dir) => {
      if (!fs.existsSync(CONTRACT)) throw new Error('缺少 contract-check.mjs: ' + CONTRACT);
      writeFile(dir, 'app/x.py', 'status = 3\n');
      writeFile(dir, 'src/y.ts', 'status === 3\n');
      const runContract = (args, cwd = dir) => {
        const res = spawnSync(process.execPath, [CONTRACT, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      // 输出头 `# <label>: <路径>` 取实际解析路径（断言脚本打印的是真实落点，而非回显参数）
      const resolvedPath = (res, label) => {
        const line = res.output.split(/\r?\n/).find((l) => l.startsWith('# ' + label + ': '));
        if (!line) throw new Error('输出缺少 ' + label + ' 解析路径头:\n' + res.output);
        return line.slice(('# ' + label + ': ').length).trim();
      };
      // ① 显式目录参数：exit 0 + 两个实际解析路径 + 两侧真实命中
      const explicit = runContract(['status', '--backend', 'app', '--frontend', 'src']);
      assertExit(explicit, 0);
      assertOut(explicit, 'status = 3');
      assertOut(explicit, 'status === 3');
      const backendPath = resolvedPath(explicit, 'backend');
      const frontendPath = resolvedPath(explicit, 'frontend');
      if (path.basename(backendPath) !== 'app' || path.basename(frontendPath) !== 'src') {
        throw new Error('解析路径落点错误: backend=' + backendPath + ' / frontend=' + frontendPath);
      }
      if (!fs.readFileSync(path.join(backendPath, 'x.py'), 'utf8').includes('status = 3')) {
        throw new Error('backend 实际解析路径未指向夹具: ' + backendPath);
      }
      if (!fs.readFileSync(path.join(frontendPath, 'y.ts'), 'utf8').includes('status === 3')) {
        throw new Error('frontend 实际解析路径未指向夹具: ' + frontendPath);
      }
      // ② 缺省回退：无目录参数时默认 <root>/app 与 <root>/src（root = cwd）
      const fallback = runContract(['status']);
      assertExit(fallback, 0);
      assertOut(fallback, 'status = 3');
      assertOut(fallback, 'status === 3');
      // ③ 悬空 --backend：缺值即用法错误 + 非零退出
      const dangling = runContract(['status', '--backend']);
      assertExit(dangling, 1);
      assertOut(dangling, '用法: node contract-check.mjs');
      assertOut(dangling, '--backend 后缺少后端目录值');
      // ④ --project 形态：从夹具外运行，显式项目根优先于 cwd（若被忽略则两侧都不命中）
      const elsewhere = path.join(dir, 'elsewhere');
      fs.mkdirSync(elsewhere, { recursive: true });
      const viaProject = runContract(['status', '--project', dir], elsewhere);
      assertExit(viaProject, 0);
      assertOut(viaProject, 'status = 3');
      assertOut(viaProject, 'status === 3');
      // ⑤ 单横线操作数：取值以 '-' 开头（含单横线形态）→ 用法错误 + 非零退出，不被当作目录
      //    （判据含选项名与非法操作数提示——只查 exit 1 无判别力，须证明拒绝理由在场）
      const assertDashOperandRejected = (opt, bad) => {
        const r = runContract(['status', opt, bad]);
        assertExit(r, 1);
        assertOut(r, '用法: node contract-check.mjs');
        assertOut(r, opt + ' 的目录操作数不得以 - 开头');
      };
      assertDashOperandRejected('--backend', '-bad-dir');
      assertDashOperandRejected('--project', '-x');
      assertDashOperandRejected('--frontend', '-y');
      console.log('  契约核对 CLI: 显式解析 + 缺省回退 + 悬空参数用法错误 + 单横线操作数拒绝 + --project 优先于 cwd ✓');
    },
  },

  // ---------- L. 执行遗漏防护（真实链路） ----------

  {
    name: 'L1 进入证据:entry 记录 enteredNodes,正常流程 exit 无误报',
    run: (dir) => {
      gitInit(dir);
      assertExit(runState(['init', CHANGE_ID, '--init-skip'], dir), 0);
      assertExit(runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md', '--templates', 'CHANGE.md,REQUIREMENT.md'], dir), 0);
      assertExit(runState(['skill-load', 'design', 'flow-comet-design', '--prompt', 'flow-kit/prompts/2-design.md', '--templates', 'DESIGN.md'], dir), 0);
      writeIntakeArtifacts(dir);
      // ① entry open 记录进入标记
      assertExit(runGuard(['entry', 'open'], dir), 0);
      const st = readStateFile(dir);
      if (!Array.isArray(st.enteredNodes) || !st.enteredNodes.includes('open')) {
        throw new Error('entry 未记录 enteredNodes: ' + JSON.stringify(st.enteredNodes));
      }
      // ② 未 entry 直接 exit(构造:跳过 design 的 entry,state 已激活)→ ENTER WARN 渐进
      assertExit(runState(['record', 'open', '{"summary":"intake complete"}'], dir), 0);
      assertExit(runGuard(['exit', 'open', '--apply'], dir), 0);
      // 推进到 design 后不 entry 直接 exit?→ currentNode 检查会拦;验证 enter 证据在真实链路不误报
      assertExit(runGuard(['entry', 'design'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 0. 技术栈\n\npython\n\n## 决策清单\n\n- [ ] D1\n');
      assertExit(runState(['record', 'design', '{"summary":"design done"}'], dir), 0);
      const rDesign = runGuard(['exit', 'design', '--apply'], dir);
      assertExit(rDesign, 0);
      assertNotOut(rDesign, 'ENTER WARN');
    },
  },

  {
    name: 'L2 空退出豁免:显式 emptyExitApproved 后全 parallel execute 通过',
    run: (dir) => {
      gitInit(dir);
      // fixture state(currentNode=execute + enter 机制激活)+ 真实命令序列:
      // 全 parallel 任务在 plan exit 后正常路由 subagent-execute(M6 豁免用于已进入 execute 且无串行可做的场景)
      const taskAllParallel = '# TASK\n\n<task id="P01" parallel="true" status="pending"><action>p</action><write_files>a</write_files><verify>t</verify><done>d</done></task>\n';
      // ① 显式豁免 → 空退出通过
      const st = baseState('execute');
      st.enteredNodes = ['open', 'design', 'plan'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskAllParallel);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      assertExit(runState(['record', 'execute', '{"summary":"no serial tasks","emptyExitApproved":true}'], dir), 0);
      const r = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(r, 0);
      assertOut(r, 'ALL CHECKS PASSED');
      // ② 无豁免 → 仍 BLOCKED(默认防规划错误)
      const st2 = baseState('execute');
      st2.enteredNodes = ['open', 'design', 'plan'];
      writeState(dir, st2);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskAllParallel);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      assertExit(runState(['record', 'execute', '{"summary":"no serial tasks"}'], dir), 0);
      const r2 = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(r2, 1);
      assertOut(r2, 'BLOCKED');
    },
  },

  {
    name: 'L3 空仓库:init 在无提交仓库输出 EMPTY-REPO 提示',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); // 无提交
      const r = runState(['init', CHANGE_ID, '--init-skip'], dir);
      assertExit(r, 0);
      assertOut(r, 'EMPTY-REPO');
    },
  },
];

export const ENTRIES = RAW_ENTRIES.map(applyDistributionSurface);
