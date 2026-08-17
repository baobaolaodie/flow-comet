// dsh-flow-comet-bridge —— 薄桥接 loader。
//
// 职责（DESIGN D4/D6——迁移旧 dsh-plugin 拦截经验）：
//   1. 监听 tools/pre-execute（dsh 官方 waterfall 事件）。
//   2. 会话项目判定：仅当会话 cwd 的最近 .git 项目根下存在
//      .dsh/skills/flow-comet 目录时才处理；否则直接 next()——
//      「窄监听」硬性契约：非 flow-comet 项目零拦截零开销。
//   3. 参数映射：把 dsh 工具名归一化到 guard CLI 契约名（Write/Edit/Bash），
//      形状不符/缺关键字段 → WARN + fail-closed deny（不静默放行）。
//   4. 包含性校验：Write/Edit 的 file_path 必须解析后位于项目根内——
//      realpathSync.native 展开 Windows 8.3 短路径（T-FIX-07），越界直接
//      deny（T-FIX-01）；通过后传规范化长路径给 guard（T-FIX-08：
//      避免短路径导致 guard 侧 target=null 跳过白名单判定 = fail-open）。
//   5. 子进程调用项目本地 guard：node <项目根>/.dsh/skills/flow-comet/scripts/
//      comet-hook-guard.mjs + stdin JSON {tool_name, tool_input}；
//      spawn cwd 必须 = 会话项目根（相对 file_path 按 cwd 解析——
//      cwd≠项目根会 fail-open；不得以设 env 替代 cwd）。协议文件天然在
//      项目内（skill 包 reference/ 随树复制）——无需 FLOW_COMET_PROTOCOL 机制。
//   6. 决策映射：exit 0 → next() 放行；exit 2 → deny（BLOCK 消息 + 恢复指引
//      透传）；其它/异常 → fail-closed deny + WARN。
//
// 明确不做的（D6——旧 dsh-plugin 功能废弃）：
//   - 不注册 fs/write-intent 槽位（single-slot 守卫瀑布无 deny 面，
//     不 shadow 官方 dsh-fs-observation-policy）；
//   - 不做 fs/observed 审计（v1 极薄）；
//   - 不做技能注册/AGENTS.md 注入（安装器职责）。
//
// 纯 ESM、零第三方依赖，仅使用 Node.js 内置模块。dsh 官方插件形态：
// ESM 模块导出 { name, apply }，ctx 由 dsh 注入。

import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

// 插件元信息：dsh 官方插件形态（name / apply；ctx 由 dsh 注入）。
export const name = 'dsh-flow-comet-bridge';

// guard 在项目内的相对路径常量（随 skill 包分发）。
const HOOK_GUARD_REL = '.dsh/skills/flow-comet/scripts/comet-hook-guard.mjs';

// 模块级幂等标记：同一进程内 apply() 被重复调用（热重载/多会话/插件重入）时
// 跳过已注册的监听，避免重复监听（T-FIX-03 经验）。
let applied = false;

// ---------------------------------------------------------------------------
// 工具名归一化：dsh 实际工具名 -> guard CLI 契约名（Write/Edit/Bash）
// ---------------------------------------------------------------------------
export function normalizeToolName(toolName) {
  if (typeof toolName !== 'string') return null;
  const lower = toolName.toLowerCase();
  if (lower === 'write' || lower === 'writefile' || lower === 'file-write') return 'Write';
  if (lower === 'edit' || lower === 'editfile' || lower === 'file-edit') return 'Edit';
  if (
    lower === 'bash' ||
    lower === 'shell' ||
    lower === 'powershell' ||
    lower === 'run_command' ||
    lower === 'run-command'
  ) {
    return 'Bash';
  }
  return null;
}

// 参数映射：归一化工具名 + 工具参数 -> guard 契约输入。
// 形状不符/缺关键字段 -> { ok: false, reason }（fail-closed，不静默放行）。
export function mapToolInput(canonicalName, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, reason: '工具参数缺失或非对象' };
  }
  if (canonicalName === 'Write' || canonicalName === 'Edit') {
    const filePath = args.file_path ?? args.filePath ?? args.path;
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      return { ok: false, reason: '缺少 file_path（Write/Edit 必须提供写入目标）' };
    }
    return { ok: true, target: filePath, input: { file_path: filePath } };
  }
  if (canonicalName === 'Bash') {
    const command = args.command ?? args.cmd ?? args.script;
    if (typeof command !== 'string' || command.trim() === '') {
      return { ok: false, reason: '缺少 command（Bash 必须提供命令内容）' };
    }
    return { ok: true, target: command, input: { command } };
  }
  return { ok: false, reason: '未支持的归一化工具名' };
}

// ---------------------------------------------------------------------------
// 项目根包含性：Write/Edit 的 file_path 必须解析后仍位于 projectRoot 内。
// 越界路径若交给 guard 子进程，writeTargetFromHookInput 会因 target=null
// 跳过白名单判定（fail-open），因此必须在插件侧直接 fail-closed deny。
// Windows 8.3 短路径（如 LONGYI~1）与长路径在词法上不同，直接 path.relative
// 会把项目内短路径误判为越界；因此先 realpath 展开已存在部分再执行包含性
// 判断。realpathSync.native：Windows 上 fs.realpathSync（libuv）不展开 8.3
// 短名，native 变体才会把 LONGYI~1 规范化为 LongYinHaHa（T-FIX-07 实证）。
// ---------------------------------------------------------------------------
export function realpathExistingPath(p) {
  try {
    return realpathSync.native(p);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      const parent = path.dirname(p);
      if (parent === p) return p;
      try {
        return path.join(realpathExistingPath(parent), path.basename(p));
      } catch {
        return p;
      }
    }
    return p;
  }
}

export function isPathInsideProjectRoot(projectRoot, filePath) {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, filePath);
  const realRoot = realpathExistingPath(root);
  const realTarget = realpathExistingPath(resolved);
  const relative = path.relative(realRoot, realTarget);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  );
}

// ---------------------------------------------------------------------------
// 会话 cwd 与项目判定
// ---------------------------------------------------------------------------
// 从 exec 上下文逐级回退取得会话 cwd。锚定字段 = exec.agent.session.header.cwd
// （dsh 源码核实，rc.6——逐会话）；缺失时逐级回退 exec 上下文其它路径字段。
// 无法确定会话 cwd -> null（监听侧按窄监听语义 fail-open 于非判定场景）。
export function sessionCwd(exec) {
  const candidates = [
    exec?.agent?.session?.header?.cwd,
    exec?.agent?.session?.cwd,
    exec?.agent?.cwd,
    exec?.session?.header?.cwd,
    exec?.session?.cwd,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
  }
  return null;
}

// 最近 .git 祖先 = 项目根（.git 可为目录或文件——worktree/submodule 形态）。
// 上溯到文件系统根仍未找到 -> cwd 本身。
export function findProjectRoot(cwd) {
  let current = path.resolve(cwd);
  for (;;) {
    if (existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

// 项目本地 guard 绝对路径。
export function resolveGuardPath(projectRoot) {
  return path.join(projectRoot, HOOK_GUARD_REL);
}

// ---------------------------------------------------------------------------
// 决策映射：guard 子进程 exit code -> 插件决策（可测纯函数）
// exit 0 放行 / exit 2 拦截（BLOCK 消息 + 恢复指引透传）/ 其它 fail-closed。
// ---------------------------------------------------------------------------
export function mapGuardExit(code, stderr, stdout) {
  if (code === 0) return { kind: 'allow' };
  if (code === 2) {
    const detail = (stderr || stdout || '').trim();
    return {
      kind: 'deny',
      reason:
        'dsh-flow-comet-bridge: 写入被 flow-comet 白名单拦截\n' +
        (detail ? detail + '\n' : '') +
        '恢复指引：请将写入目标调整到当前节点允许的路径前缀，或先完成当前节点流程后再写；如认为判定有误，请检查 .comet/flow-comet-state.json 与协议白名单。',
    };
  }
  return {
    kind: 'error',
    message: '判定脚本异常退出（code=' + String(code) + '）: ' + (stderr || stdout || '').trim(),
  };
}

// ---------------------------------------------------------------------------
// 判定核心子进程调用（stdin JSON {tool_name, tool_input} -> exit code）
// ---------------------------------------------------------------------------
function runGuard(projectRoot, canonicalName, toolInput) {
  return new Promise((resolve) => {
    const guardPath = resolveGuardPath(projectRoot);
    const child = spawn(
      process.execPath,
      [guardPath, 'before_tool'],
      {
        // cwd 必须 = 会话项目根（硬性）：相对 file_path 按 cwd 解析，
        // cwd≠项目根会 fail-open；不得以设 env 替代 cwd。
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ kind: 'error', message: error.message });
    });
    child.on('close', (code) => {
      resolve(mapGuardExit(code, stderr, stdout));
    });
    child.stdin.end(JSON.stringify({ tool_name: canonicalName, tool_input: toolInput }));
  });
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------
export function apply(ctx) {
  if (applied) {
    console.log('[dsh-flow-comet-bridge] apply skipped: already applied in this process');
    return;
  }
  applied = true;

  ctx.on('tools/pre-execute', async (exec, next) => {
    // 整链 try/catch（fail-closed 语义延伸）：从会话项目判定到 spawn 决策映射的任何
    // 内部异常（如 spawn 异常竞态下 child.stdin.end 抛 TypeError）→ WARN + fail-closed
    // deny——不静默、不挂起、不放行（监听器未捕获异常对 dsh 未定义，可能挂起或 fail-open）。
    try {
      // 1. 工具名归一化：非 Write/Edit/Bash 不处理（放行）。
      const canonicalName = normalizeToolName(exec?.name);
      if (!canonicalName) {
        return next();
      }

      // 2. 会话 cwd：无法确定 -> next()（窄监听 fail-open 于非判定场景）。
      const cwd = sessionCwd(exec);
      if (!cwd) {
        return next();
      }

      // 3. 项目判定：最近 .git 祖先 = 项目根；根下必须存在 .dsh/skills/flow-comet
      //    （安装器安装的项目级 skill）才处理；不存在 -> next()（窄监听硬性契约——
      //    非 flow-comet 项目零拦截零开销）。
      const projectRoot = findProjectRoot(cwd);
      if (!existsSync(path.join(projectRoot, '.dsh', 'skills', 'flow-comet'))) {
        return next();
      }

      // 4. 参数映射：形状不符/缺关键字段 -> WARN + fail-closed deny（不静默放行）。
      const mapped = mapToolInput(canonicalName, exec?.arguments);
      if (!mapped.ok) {
        const reason =
          'dsh-flow-comet-bridge: 工具 ' +
          String(exec?.name) +
          ' 参数形状不符（' +
          mapped.reason +
          '）——fail-closed 拒绝';
        console.warn(reason);
        return { kind: 'deny', reason };
      }

      // 5. 包含性校验（Write/Edit）：越界直接 deny，不进 guard（T-FIX-01）。
      if (canonicalName === 'Write' || canonicalName === 'Edit') {
        if (!isPathInsideProjectRoot(projectRoot, mapped.target)) {
          const reason =
            'dsh-flow-comet-bridge: 写入目标 "' +
            mapped.target +
            '" 不在项目根 "' +
            projectRoot +
            '" 内——越界写入已拒绝，未进入 guard 判定';
          console.warn(reason);
          return { kind: 'deny', reason };
        }
        // 通过后传规范化长路径（realpath 展开 8.3 短路径）——guard 的
        // writeTargetFromHookInput 只做词法 path.relative，短路径会解析出
        // target=null 从而跳过白名单判定（fail-open，T-FIX-08 经验）。
        const normalizedTarget = realpathExistingPath(path.resolve(projectRoot, mapped.target));
        mapped.target = normalizedTarget;
        mapped.input.file_path = normalizedTarget;
      }

      // 6. 项目本地 guard 调用。guard 文件缺失（安装未完成/被删除）-> WARN +
      //    next() 放行（不阻断非 flow-comet 语义）；spawn 异常（ENOENT 等）->
      //    fail-closed deny + WARN（与错误即阻断语义对齐）。
      const guardPath = resolveGuardPath(projectRoot);
      if (!existsSync(guardPath)) {
        console.warn(
          '[dsh-flow-comet-bridge] WARN: 项目本地 guard 缺失（安装未完成或已被删除）——放行: ' +
            guardPath,
        );
        return next();
      }

      const decision = await runGuard(projectRoot, canonicalName, mapped.input);
      if (decision.kind === 'allow') {
        return next();
      }
      if (decision.kind === 'deny') {
        return { kind: 'deny', reason: decision.reason };
      }

      // 其它错误态：fail-closed deny + WARN。
      const reason =
        'dsh-flow-comet-bridge: 判定核心调用失败（fail-closed 拒绝）: ' + decision.message;
      console.warn(reason);
      return { kind: 'deny', reason };
    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      console.warn('[dsh-flow-comet-bridge] WARN: 桥接器内部异常: ' + detail);
      return { kind: 'deny', reason: '桥接器内部异常' };
    }
  });
}
