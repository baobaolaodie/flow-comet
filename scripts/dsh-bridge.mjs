// dsh-flow-comet-bridge —— 薄桥接 loader。
//
// 职责（迁移既有 dsh 插件拦截经验）：
//   1. 监听 tools/pre-execute（dsh 官方 waterfall 事件）。
//   2. 会话项目判定：仅当会话 cwd 的最近 .git 项目根下存在
//      .dsh/skills/flow-comet 目录时才处理；否则直接 next()——
//      「窄监听」硬性契约：非 flow-comet 项目零拦截零开销。
//   3. 参数映射：把 dsh 工具名归一化到 guard CLI 契约名（Write/Edit/Bash），
//      形状不符/缺关键字段 → WARN + fail-closed deny（不静默放行）。
//   4. 包含性校验：Write/Edit 的 file_path 必须解析后位于项目根内——
//      realpathSync.native 展开 Windows 8.3 短路径，越界直接
//      deny；通过后传规范化长路径给 guard：
//      避免短路径导致 guard 侧 target=null 跳过白名单判定 = fail-open）。
//   5. 子进程调用项目本地 guard：node <项目根>/.dsh/skills/flow-comet/scripts/
//      comet-hook-guard.mjs + stdin JSON {tool_name, tool_input}；
//      spawn cwd 必须 = 会话项目根（相对 file_path 按 cwd 解析——
//      cwd≠项目根会 fail-open；不得以设 env 替代 cwd）。协议文件天然在
//      项目内（skill 包 reference/ 随树复制）——无需 FLOW_COMET_PROTOCOL 机制。
//   6. 决策映射：exit 0 → next() 放行；exit 2 → deny（BLOCK 消息 + 恢复指引
//      透传）；其它/异常 → fail-closed deny + WARN。
//
// 明确不做的（旧 dsh 插件功能废弃）：
//   - 不注册 fs/write-intent 槽位（single-slot 守卫瀑布无 deny 面，
//     不 shadow 官方 dsh-fs-observation-policy）；
//   - 不做 fs/observed 审计（v1 极薄）；
//   - 不做技能注册/AGENTS.md 注入（安装器职责）。
//
// 纯 ESM、零第三方依赖，仅使用 Node.js 内置模块。dsh 官方插件形态：
// ESM 模块导出 { name, apply }，ctx 由 dsh 注入。

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

// 插件元信息：dsh 官方插件形态（name / apply；ctx 由 dsh 注入）。
export const name = 'dsh-flow-comet-bridge';

// guard 在项目内的相对路径常量（随 skill 包分发）。
const HOOK_GUARD_REL = '.dsh/skills/flow-comet/scripts/comet-hook-guard.mjs';

// 模块级幂等标记：同一进程内 apply() 被重复调用（热重载/多会话/插件重入）时
// 跳过已注册的监听，避免重复监听（幂等防重入）。
let applied = false;

// ---------------------------------------------------------------------------
// 工具名归一化：dsh 实际工具名 -> guard CLI 契约名（Write/Edit/Bash）
// ---------------------------------------------------------------------------
export function normalizeToolName(toolName) {
  if (typeof toolName !== 'string') return null;
  const lower = toolName.toLowerCase();
  if (lower === 'write' || lower === 'writefile' || lower === 'file-write') return 'Write';
  if (lower === 'edit' || lower === 'editfile' || lower === 'file-edit') return 'Edit';
  // Bash 写命令拦截必须覆盖 Windows 默认 PowerShell 工具形态——dsh 注册名为
  // 'pwsh'(dsh-tool-pwsh 源码实证),缺失会 canonicalName=null → next() 放行,
  // 模型用 Set-Content 等 PowerShell 写命令即可绕过整链拦截(fail-open 缺口)。
  if (
    lower === 'bash' ||
    lower === 'shell' ||
    lower === 'powershell' ||
    lower === 'pwsh' ||
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
// 短名，native 变体才会把 LONGYI~1 规范化为 LongYinHaHa（Windows 实证）。
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
// 流程态门（DESIGN D1/D2——空闲态项目外写放行、运行态维持现状、解析失败/未知状态
// fail-closed）。
//
// 语义锚定 guard comet-hook-guard.mjs L1882-1895 判定规则（DESIGN D3 复用，不另造一套）：
//   ① 无 activeChange（无论 status；与「无 state 文件」同语义，覆盖旧 state 归档后）→ 放行
//   ② running（status==='running' || undefined，且有 activeChange，fail-closed 向后兼容）→ 白名单校验
//   ③ completed（归档后）→ 放行；其它 status → fail-closed
//
// 读状态对齐 guard readStateJson（comet-hook-guard.mjs L1682-1694）：
// BOM 容错（外部写入可能带 UTF-8 BOM -> .toString('utf8').replace(/^\uFEFF/,'')）+ JSON.parse。
// 返回 { ok:true, state }；无文件 -> { ok:false, reason:'no-state' }；
// JSON 解析失败 / 其它读失败 -> { ok:false, reason:'parse-error' }（fail-closed 标记，
// 不静默当作无 state 放行）。
// ---------------------------------------------------------------------------
/**
 * Read the project flow state with UTF-8 BOM tolerance (mirrors guard readStateJson).
 * Returns { ok:false, reason:'no-state' } when the file is absent, or
 * { ok:false, reason:'parse-error' } on read/parse failure or non-object JSON
 * (fail-closed — never treated as idle), else { ok:true, state }.
 */
export function readFlowState(projectRoot) {
  const stateFile = path.join(projectRoot, '.comet', 'flow-comet-state.json');
  let raw;
  try {
    raw = readFileSync(stateFile);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      // 无 state 文件（无活跃 workflow / 新克隆仓库）——与 guard「(no active workflow)」同语义
      return { ok: false, reason: 'no-state' };
    }
    // 其它读失败（EISDIR 目录等）同样 fail-closed，不当作空闲放行
    return { ok: false, reason: 'parse-error' };
  }
  try {
    // 容忍 UTF-8 BOM（对齐 guard readStateJson L1682-1694 的 BOM strip）
    const parsed = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
    // 非对象（null/标量/数组）= 损坏 state：fail-closed，不得当空闲放行
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'parse-error' };
    }
    return { ok: true, state: parsed };
  } catch {
    return { ok: false, reason: 'parse-error' };
  }
}

// 判定：复用 guard L1882-1895 规则 -> 'idle' | 'running' | 'error'（fail-closed）。
/**
 * Classify flow state into 'idle' | 'running' | 'error' (fail-closed),
 * mirroring comet-hook-guard.mjs L1882-1895.
 */
export function judgeFlowState(readResult) {
  if (!readResult.ok) {
    // 无 state 文件 = 无活跃 workflow -> idle；JSON 解析失败 -> error（fail-closed 不视为空闲）
    return readResult.reason === 'no-state' ? 'idle' : 'error';
  }
  const state = readResult.state;
  // ① 无 activeChange（无论 status；与「无 state 文件」同语义）-> idle
  if (!state.activeChange) return 'idle';
  // ② running（status==='running' || undefined，且有 activeChange）-> running
  const running = state.status === 'running' || state.status === undefined;
  if (running) return 'running';
  // ③ completed（归档后）-> idle；其它未知 status -> error（fail-closed）
  if (state.status === 'completed') return 'idle';
  return 'error';
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

// 代理身份分派（dsh 子代理=执行者）：dsh 子代理 spawn/fork provider 的
// childSessionMeta 把 delegationDepth=parentDepth+1 写入子代理 session header
// （dsh-subagent 源码锚定，rc.6）——协调者=0/缺失，子代理>0。从 exec.agent.session
// 读取（与 sessionCwd 同级字段），供监听侧区分执行者与协调者——子代理写源码是
// 执行者职责（对应 CC worktree 子代理物理自由写），协调者走 guard 白名单拦截。
// 非法值（NaN/负数/字符串/null/缺字段）一律按协调者处理（fail-closed 语义）。
export function agentDepth(exec) {
  const depth = exec?.agent?.session?.header?.delegationDepth;
  return typeof depth === 'number' && Number.isFinite(depth) && depth > 0 ? depth : 0;
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
function runGuard(projectRoot, canonicalName, toolInput, signal) {
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
        signal,
      },
    );
    let stdout = '';
    let stderr = '';
    // 超时与中止 fail-closed：guard 阻塞 / 调用方取消 → error 决策（不静默、不永久挂起；EPIPE 兜底防宿主崩溃）
    const GUARD_TIMEOUT_MS = 15000;
    let settled = false;
    const finish = (decision) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(decision);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ kind: 'error', message: '判定脚本超时（' + GUARD_TIMEOUT_MS + 'ms）' });
    }, GUARD_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    // 子进程先退出时 stdin 异步抛 EPIPE——兜底监听，避免未处理流错误
    child.stdin.on('error', () => { /* 写入失败可忽略——close 兜底决策 */ });
    child.on('error', (error) => {
      finish({ kind: 'error', message: error.message });
    });
    child.on('close', (code) => {
      finish(mapGuardExit(code, stderr, stdout));
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
      // 项目根同样归一化为长形态：短形态(8.3)项目根 + 长形态 file_path 会让 guard 的
      // 词法 path.relative 解析出 target=null → 白名单跳过 = 协调者写源码 fail-open。
      const projectRoot = realpathExistingPath(findProjectRoot(cwd));
      if (!existsSync(path.join(projectRoot, '.dsh', 'skills', 'flow-comet'))) {
        return next();
      }

      // 4. 参数映射：形状不符/缺关键字段 -> WARN + fail-closed deny（不静默放行）。
      //    D5：形状 fail-closed 任意态生效（含空闲态）——与流程态无关，保持现状。
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

      // 4.5 流程态门（DESIGN D1/D2，2026-08-20）——修复 v1「包含性校验无条件生效」的
      //     设计偏差：空闲态的项目外写入本应对齐 CC/Codex 的 active-change 门语义放行，
      //     却因无条件包含性校验被误 deny。现仅运行中的活跃 workflow 才参与包含性/guard
      //     拦截；解析失败/未知状态 fail-closed 不视为空闲放行。
      //     语义锚定 guard comet-hook-guard.mjs L1882-1895（①无 activeChange 放行 /
      //     ② activeChange+running/undefined 走白名单校验 / ③ completed 放行、其它 fail-closed）
      //     ——判定逻辑在 readFlowState/judgeFlowState 中以等价小工具复用（D3），注释锚定防漂移。
      const flowState = judgeFlowState(readFlowState(projectRoot));
      if (flowState === 'idle') {
        // 空闲态（无 state / 无 activeChange / completed）：直接放行，跳过包含性 deny 与
        // guard 白名单（D4——与 CC/Codex 一致，空闲态零拦截开销）。
        return next();
      }
      if (flowState === 'error') {
        // 解析失败 / 状态异常：fail-closed deny，不得当空闲放行（D2/R2 缓解——防异常被静默放行）。
        const reason =
          'dsh-flow-comet-bridge: .comet/flow-comet-state.json 解析失败或状态异常——fail-closed 拒绝';
        console.warn(reason);
        return { kind: 'deny', reason };
      }
      // running（activeChange + status running/undefined）：继续走既有第 5 步包含性校验、
      // 5.5 身份分派、第 6 步 guard 白名单——全部现状不变。

      // 5. 包含性校验（Write/Edit）：越界直接 deny，不进 guard。
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
        // target=null 从而跳过白名单判定（fail-open）。
        const normalizedTarget = realpathExistingPath(path.resolve(projectRoot, mapped.target));
        mapped.target = normalizedTarget;
        mapped.input.file_path = normalizedTarget;
      }

      // 5.5 代理身份分派：delegationDepth > 0 = 子代理（执行者）——其写源码是
      //     执行者职责（对应 CC worktree 子代理物理隔离），跳过 guard 白名单判定直接
      //     放行；协调者（0/缺失）走原 guard 白名单（协调者禁令物理拦截保留）。
      //     形状 fail-closed 与项目根包含性校验在上方已对子代理同样执行——子代理也不得
      //     越界写项目根外/参数形状不符（fail-closed 纪律不因身份放宽）。
      if (agentDepth(exec) > 0) {
        return next();
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

      const decision = await runGuard(projectRoot, canonicalName, mapped.input, exec?.signal);
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
