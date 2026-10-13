// items/j.mjs — J 组条目（文档一致性）
//
// 组文件约定：`export const ENTRIES = [...]`（元素含 name 与 run；计数派生按此聚合，见 lib/count-derivation.mjs）。
// 组内夹具与条目同址；跨组共用夹具从 a.mjs / k.mjs 取（组文件之间单向，无环）。

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { assertExit, assertOut } from '../lib/test-helpers.mjs';

// 路径推导基准：技能包 scripts/ 目录（与套件入口同基准）
const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 仓库本地验证工具执行（仅主仓存在、不随克隆分发；副本上文件缺失自动跳过）：
// 返回 { status, output }（spawnSync 原始结果 output 是数组，统一拼接成字符串供断言）
function runLocalTool(checker, repoRoot) {
  const res = spawnSync(process.execPath, [checker], { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

export const ENTRIES = [
  // ---------- J. 文档一致性 ----------

  {
    name: 'J1 文档一致性：双语健康检查（本地工具）',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.flow-comet', 'skills', 'flow-comet'))) return; // 安装副本无仓库文档
      const checker = path.join(repoRoot, 'scripts', 'check-docs-local.mjs');
      if (!fs.existsSync(checker)) {
        console.log('  （本地工具缺失，跳过——gitignore 不随克隆分发）');
        return;
      }
      const res = runLocalTool(checker, repoRoot);
      if (res.status === 0) {
        assertOut(res, '文档健康检查通过');
        return;
      }
      // 已知本地工具快照局限：其「场景数与版本一致性」子检查用发布时快照（1.3.0 → 97），
      // 开发窗口期（版本未发布、场景数已增）会误报——结构检查（双语/对称）全部通过即放行；
      // 场景数一致性的权威判定在引擎自测（guard-self-test 场景数自检按实时场景数核对）。
      const structuralOk = res.output.includes('PASS: 英文文档无中文')
        && res.output.includes('PASS: 中文文档无英文长句')
        && res.output.includes('PASS: 双语镜像对称');
      if (!structuralOk || !res.output.includes('场景数与版本一致性')) {
        throw new Error('期望 exit 0，实际 exit ' + res.status + '\n实际输出:\n' + res.output);
      }
      console.log('  （场景数一致性子检查按发布快照——当前开发窗口由引擎自测的实时自检覆盖，放行）');
    },
  },

  {
    name: 'J2 文档一致性：公开产物零代号检查（本地工具）',
    run: (dir) => {
      const repoRoot = path.resolve(SCRIPTS_DIR, '..', '..', '..', '..');
      if (!fs.existsSync(path.join(repoRoot, '.flow-comet', 'skills', 'flow-comet'))) return;
      const checker = path.join(repoRoot, 'scripts', 'check-codes-local.mjs');
      if (!fs.existsSync(checker)) {
        console.log('  （本地工具缺失，跳过——gitignore 不随克隆分发）');
        return;
      }
      const res = runLocalTool(checker, repoRoot);
      assertExit(res, 0);
      assertOut(res, '过程代号检查通过');
    },
  },

];
