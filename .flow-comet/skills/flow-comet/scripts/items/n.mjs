// items/n.mjs — 条目分区：N 组条目（加载链声明集合比对 / 安装器降级口径的 L2 真实命令）
//
// 数据层约定：同 items/a.mjs 头注（只承载 ENTRIES；夹具从 lib/system-fixtures.mjs 取；组文件之间零 import）。
//
// 组界：本组承接「模板权威」批次的加载链与降级面——它们此前只有 L1 场景或只有获取点断言：
//   · 加载链的**声明集合比对**（多写 / 漏写 / 错名 / 允许集内的可选项）走真实 skill-load / record 命令；
//   · 安装器在「同名目录已存在 / 上游克隆已就位」两种真实目录形态下的**降级结论**（含不出现通知的反向）。

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { assertExit, assertNotOut, assertOut, runState, writeState } from '../lib/test-helpers.mjs';
import { CHANGE_ID, SCRIPTS_DIR, applyDistributionSurface, readStateFile } from '../lib/system-fixtures.mjs';

const DESIGN_SKILL_ARGS = ['skill-load', 'design', 'flow-comet-design', '--prompt', 'flow-kit/prompts/2-design.md'];

const RAW_ENTRIES = [
  // ---------- N. 加载链：模板声明集合比对 ----------

  // 声明集合判据 = required ⊆ declared ⊆ required ∪ optional（design 的 required=DESIGN、optional=UI-DESIGN）。
  // 四个负例分别打「多写（允许集外）」「漏写（空清单）」「错名（拼错）」「缺声明（整项没写）」，
  // 旧 change 同形只 WARN——新 change 的 fail-closed 与旧 change 的渐进放行必须在同一条命令上分开。
  {
    name: 'N1 加载链声明集合：多写/漏写/错名/缺声明对 BLOCKED，允许集内可选项放行，旧 change 同形 WARN',
    run: (dir) => {
      assertExit(runState(['init', CHANGE_ID, '--init-skip'], dir), 0);

      // ① 允许集内正例：DESIGN（required）+ UI-DESIGN（optional）→ 通过并落标记
      const optionalDeclared = runState([...DESIGN_SKILL_ARGS, '--templates', 'DESIGN.md,UI-DESIGN.md'], dir);
      assertExit(optionalDeclared, 0);
      assertOut(optionalDeclared, 'SKILL-LOAD: design flow-comet-design');
      const markerPath = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'design-flow-comet-design.json');
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (!Array.isArray(marker.templates) || marker.templates.join(',') !== 'DESIGN,UI-DESIGN') {
        throw new Error('声明标记应如实记录声明的模板清单（去掉 .md 后缀），实际: ' + JSON.stringify(marker.templates));
      }

      // ② 多写：允许集外的模板（TASK）→ BLOCKED，并回显「怎么重新声明」的可执行命令
      const extra = runState([...DESIGN_SKILL_ARGS, '--templates', 'DESIGN.md,TASK.md'], dir);
      assertExit(extra, 1);
      assertOut(extra, 'BLOCKED');
      assertOut(extra, '多写/错名: TASK');
      assertOut(extra, '映射要求: DESIGN');
      assertOut(extra, 'workflow-state.mjs skill-load design flow-comet-design --templates DESIGN.md');

      // ③ 漏写：显式空清单（--templates=）→ BLOCKED 且点名漏掉的必填项
      const missing = runState([...DESIGN_SKILL_ARGS, '--templates='], dir);
      assertExit(missing, 1);
      assertOut(missing, 'BLOCKED');
      assertOut(missing, '漏写: DESIGN');

      // ④ 错名：拼错（DESIGNS）→ 同时报漏写与错名（错名不是「多写」的另一种说法，两条都要出声）
      const typo = runState([...DESIGN_SKILL_ARGS, '--templates', 'DESIGNS.md'], dir);
      assertExit(typo, 1);
      assertOut(typo, '漏写: DESIGN');
      assertOut(typo, '多写/错名: DESIGNS');

      // ⑤ 缺声明：整项不写 --templates → 新 change 同样 BLOCKED（「没写」不等于「零模板」）
      const undeclared = runState(DESIGN_SKILL_ARGS, dir);
      assertExit(undeclared, 1);
      assertOut(undeclared, '模板声明缺失');

      // ⑥ 旧 change 同形：同一条「多写」声明只 WARN 且照常落标记（渐进兼容——旧项目不可能一夜补齐）
      const legacyState = readStateFile(dir);
      delete legacyState.newChange;
      writeState(dir, legacyState);
      const legacy = runState([...DESIGN_SKILL_ARGS, '--templates', 'DESIGN.md,TASK.md'], dir);
      assertExit(legacy, 0);
      assertOut(legacy, 'WARN');
      assertNotOut(legacy, 'BLOCKED');
      const legacyMarker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (legacyMarker.at === undefined || legacyMarker.templates.join(',') !== 'DESIGN,TASK') {
        throw new Error('旧 change 的 WARN 路径应照常写标记（记录真实声明），实际: ' + JSON.stringify(legacyMarker));
      }
    },
  },

  // ---------- N. 安装器：flow-kit 降级结论 ----------

  // 降级口径 = 「未校验（模板缺失）」：获取点给命令、进程结尾给结论（影响 / 原因 / 修复）。
  // 两条真实目录形态都必须跑：同名非克隆目录（跳过，不改动）与上游克隆已就位（不挂通知）——
  // 只断言前者会让「无条件打印通知」的实现照样通过。
  {
    name: 'N2 安装器降级口径：同名目录在已跳过时结尾给影响/原因/修复，上游克隆就位时不出现通知',
    surface: '安装器源码（scripts/prepare-env.mjs）与 flow-kit 获取链路仅权威源侧在场',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      const installer = path.join(repoRoot, 'scripts', 'prepare-env.mjs');
      if (!fs.existsSync(installer)) throw new Error('缺少 prepare-env.mjs');
      const runInstall = (target) => {
        const res = spawnSync(process.execPath, [installer, '--target', target, '--platform', 'claude-code'], {
          cwd: repoRoot, encoding: 'utf8', timeout: 180000,
        });
        return { status: res.status, output: String(res.stdout ?? '') + String(res.stderr ?? '') };
      };

      // ① 降级态：目标目录预置同名 flow-kit 目录（非上游克隆）→ 跳过 + 手动指引 + 结尾三行结论
      const degradedTarget = path.join(dir, 'n2-degraded');
      fs.mkdirSync(path.join(degradedTarget, 'flow-kit'), { recursive: true });
      const degraded = runInstall(degradedTarget);
      assertExit(degraded, 0);   // 降级不改变退出码：安装器其余职责照常完成
      assertOut(degraded, '目录存在但非上游克隆，已跳过');
      assertOut(degraded, '未校验（模板缺失）');
      assertOut(degraded, '影响: 各节点出口输出');
      assertOut(degraded, '原因: flow-kit/templates 未就位');
      assertOut(degraded, '修复: 网络可用时重跑本安装器');
      assertOut(degraded, '手动获取指引: git clone');
      // 非破坏：预置目录原样保留（安装器绝不改动已有目录）
      if (!fs.existsSync(path.join(degradedTarget, 'flow-kit'))) {
        throw new Error('安装器不应删除已存在的 flow-kit 目录');
      }

      // ② 反向：上游克隆就位（origin 指向上游）→ 走「只读比对」分支，不挂降级通知
      const upstreamTarget = path.join(dir, 'n2-upstream');
      const cloneDir = path.join(upstreamTarget, 'flow-kit');
      fs.mkdirSync(cloneDir, { recursive: true });
      const git = (args) => spawnSync('git', ['-C', cloneDir, ...args], { encoding: 'utf8', timeout: 60000 });
      if (spawnSync('git', ['init', '-q', cloneDir], { encoding: 'utf8' }).status !== 0) {
        throw new Error('夹具构造失败：git init 未成功');
      }
      if (git(['remote', 'add', 'origin', 'https://github.com/rihebty/flow-kit.git']).status !== 0) {
        throw new Error('夹具构造失败：git remote add 未成功');
      }
      if (git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'snapshot']).status !== 0) {
        throw new Error('夹具构造失败：git commit 未成功');
      }
      const clean = runInstall(upstreamTarget);
      assertExit(clean, 0);
      assertOut(clean, '已有 flow-kit（HEAD=');
      assertNotOut(clean, '未校验（模板缺失）');
      assertNotOut(clean, '非上游克隆');
    },
  },
];

export const ENTRIES = RAW_ENTRIES.map(applyDistributionSurface);
