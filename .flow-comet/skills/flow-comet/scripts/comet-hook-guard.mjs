#!/usr/bin/env node
  import { constants as fsConstants, promises as fs, existsSync as fsExistsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseProtocolWriteWhitelist,
  readProtocolFile,
  resolveProtocol,
  validateProtocolSchema,
} from './protocol-utils.mjs';
// 运行时路径常量（单一来源：state-schema.mjs）——本脚本每次工具调用都会执行，故此处只 import
// 同包内的本地 ESM 模块（与已存在的 protocol-utils.mjs import 同型，实测无可感知开销）；
// 禁止在本文件重新硬编码命名空间/文件名。
import {
  RUNTIME_DIR,
  RUNTIME_STATE_FILE_NAME,
  RUNTIME_STATE_PATH,
} from './state-schema.mjs';

const event = process.argv[2] ?? 'before_tool';
// 平台识别（1.4.0 多平台）：--platform codex argv 参数（prepare-env 注入 hook 命令时带平台标记）。
// 缺省 claude-code = 既有行为（stdout 自由文本 + exit 2 block）。
// Codex 分支：stdout 严格 JSON schema（拦截输出 {"decision":"block"}，放行输出 {}），exit 0。
function platformFromArgs(argv) {
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--platform') {
      if (typeof argv[index + 1] === 'string' && argv[index + 1] !== '') return argv[index + 1];
    }
    if (typeof argv[index] === 'string' && argv[index].startsWith('--platform=')) {
      const value = argv[index].slice('--platform='.length);
      if (value !== '') return value;
    }
  }
  return null;
}
const platform = platformFromArgs(process.argv.slice(2)) ?? 'claude-code';
const isCodex = platform === 'codex';

// 放行输出：Codex 分支只输出 {}（Codex 对 hook stdout 严格 schema 校验,额外字段整体无效）;
// Claude Code 分支输出既有文本（workflow-hook-guard-ok + EVENT + 可选标注）。
function hookOk(extra) {
  if (isCodex) {
    console.log('{}');
    return;
  }
  console.log('workflow-hook-guard-ok');
  console.log('EVENT: ' + event + (extra ? ' ' + extra : ''));
}

// 拦截输出：Codex 分支输出 {"decision":"block",reason} + exit 0（实测确认的 Codex deny 通道——
// 2026-08-13 Codex 0.146：exit 2 / permissionDecision:"deny" 均不被 enforce,decision:"block"+exit 0 生效）;
// Claude Code 分支既有文本 + exit 2。
function hookBlock(mainLine, detailLine) {
  if (isCodex) {
    console.log(JSON.stringify({ decision: 'block', reason: mainLine + (detailLine ? ' ' + detailLine : '') }));
    process.exit(0);
  }
  console.error(mainLine);
  if (detailLine) console.error(detailLine);
  process.exit(2);
}

// Codex 平台写路径适配：PreToolUse 只拦截 shell(Bash)工具,Codex 在 Windows 经 PowerShell 写文件——
// tool_input 为 command 字符串(无 file_path)。按常见写入模式解析命令中的目标路径:
//  ① PowerShell cmdlet 的 -Path/-LiteralPath 参数
//  ② .NET File API 的第一个参数(路径)
//  ③ shell 重定向 > / >>
// 命中任一模式即提取路径(供白名单判定);未命中 = 无写入语义,放行。
// 边界:检测为命令级——换写法(如其他 File API)可绕过,属平台限制;覆盖主流模式后越权写入
// 对执行者的阻力与可见性已足够(每次绕过都留下试错痕迹)。
// 目的地型命令的位置形态扫描：下面这些开关各吃一个取值，其取值 token 不是位置参数
// （不排除就会把 `-Filter *.md` 的 `*.md` 取成写入目标——修完取错方向又添新的误拦）
const DEST_VALUE_FLAGS = new Set([
  'destination', 'dest', 'path', 'literalpath', 'filepath', 'filter', 'include', 'exclude',
]);

function codexWriteTargetsFromCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') return [];
  const targets = [];
  // 目标归一化(剥引号 / 过滤空值与空设备 / 去重)——下方各模式共用,防多处口径漂移
  const addTarget = (raw) => {
    let t = raw && raw.trim();
    if (t) t = t.replace(/^["']|["']$/g, ''); // 剥引号
    if (t && t !== 'NUL' && t !== '/dev/null' && !targets.includes(t)) targets.push(t); // 去重
  };
  const patterns = [
    // PowerShell **路径型**写类 cmdlet 的 -Path/-LiteralPath/-FilePath(引号内空格整体捕获并剥引号;
    // 只匹配写类 cmdlet——读类(Get-Content 等)的 -Path 不提取;同一命令内 [^;|&]*? 防跨命令)。
    // 路径型的 -Path 就是写入目标;**Copy-Item/Move-Item 不在此列**——它们的 -Path 是**源**路径
    // (见下方目的地型模式):把源取成目标正是本函数曾经的取向错误——写入目标从不被检查,
    // 源路径反而被误拦(只读命令也拦)。
    /(?:Set-Content|Add-Content|New-Item|Out-File|Remove-Item|Set-Item|Export-Csv)[^;|&]*?-(?:Path|LiteralPath|FilePath)\s+("[^"]*"|'[^']*'|[^\s;|&]+)/gi,
    // shell 重定向(含描述符变体:> / >> / 2> / 1>>)
    /(?:^|[;\s|&])(?:[0-9]*>>?)\s*("[^"]*"|'[^']*'|[^\s;|&]+)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(command)) !== null) addTarget(m[1]);
  }
  // **目的地型**命令(与上方 .NET File API 的 Copy/Move 分支同向:写目标是第二参数):
  //   Copy-Item / Move-Item / Remove-Item  与位置型形态 cp / mv
  // 目标取 -Destination;缺省时取**最后一个位置参数**(`Copy-Item <src> <dst>` / `cp <src> <dst>`)。
  // 命令位置锚定(行首/换行/命令分隔符之后才认命令名):命令名与短名同样出现在普通参数、路径片段
  // 与被检索文本里——不锚定会把 `grep -n cp <file>` 的 <file> 取成写入目标,即本次要修的误拦方向
  // 的同类风险。非命令位置的内嵌形态(如 powershell -Command "…")不提取,属命令级检测的既有边界。
  const destinationRe = /(?:^|\n|[;&|(){}])\s*(?:Copy-Item|Move-Item|Remove-Item|cp|mv)\s([^;|&]*)/gi;
  let destMatch;
  while ((destMatch = destinationRe.exec(command)) !== null) {
    const segment = destMatch[1];
    const named = /-(?:Destination|Dest)(?::|\s)+("[^"]*"|'[^']*'|[^\s;|&]+)/i.exec(segment);
    if (named) {
      addTarget(named[1]);
      continue;
    }
    // 位置形态:取最后一个位置参数——开关与开关取值不参与(Remove-Item 无 -Destination 语义,
    // 其 -Path 由上方路径型模式按既有语义提取,此处只兜底纯位置形态)。
    const tokens = segment.match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
    let positional = '';
    let skipValue = false;
    for (const token of tokens) {
      if (skipValue) {
        skipValue = false; // 上一个开关的取值不是位置参数
        continue;
      }
      if (token.startsWith('-')) {
        const flag = token.replace(/^[-/]+/, '').replace(/:.*$/, '').toLowerCase();
        skipValue = DEST_VALUE_FLAGS.has(flag);
        continue;
      }
      positional = token;
    }
    addTarget(positional);
  }
  // .NET File API:写 API 的目标参数按语义区分——WriteAll*/AppendAll*/Delete 目标 = 第一参数;
  // Copy(source, destination) / Move(source, destination) 目标 = 第二参数(第一参数是源路径,守卫应检查写入目标)
  const apiRe = /\[System\.IO\.File\]::(WriteAllText|WriteAllBytes|AppendAllText|WriteAllLines|Copy|Move|Delete)\s*\(\s*("[^"]*"|'[^']*'|[^,\s)]+)(?:\s*,\s*("[^"]*"|'[^']*'|[^,\s)]+))?/gi;
  let m;
  while ((m = apiRe.exec(command)) !== null) {
    const isCopyMove = m[1] === 'Copy' || m[1] === 'Move';
    let t = (isCopyMove ? m[3] : m[2]) || '';
    t = t.trim().replace(/^["']|["']$/g, '');
    if (t && t !== 'NUL' && t !== '/dev/null' && !targets.includes(t)) targets.push(t);
  }
  return targets;
}

// writeWhitelist 路径支持 <change-id> 占位符(与 artifacts paths 同机制——协议复用自动适配
// 当前 change;无 activeChange 时字面匹配保底)
function replaceChangeId(prefix, activeChange) {
  return (typeof prefix === 'string' && prefix.includes('<change-id>') && activeChange)
    ? prefix.replaceAll('<change-id>', activeChange)
    : prefix;
}

// 白名单判定(共享):目标相对路径前缀匹配(含 <change-id> 占位符替换)——file_path 路径与
// Codex Bash 命令写入路径两条判定共用,避免两处逻辑漂移
function targetAllowed(targetRel, whitelist, activeChange) {
  return whitelist.some(prefix => {
    const p = replaceChangeId(prefix, activeChange);
    return p === '' || targetRel.startsWith(p);
  });
}

// worktree 隔离区判定(共享):CC 的隔离委托把子代理工作区放在 <项目根>/.claude/worktrees/<agent-id>/
// 下。子代理在该区内写源码是设计意图(见上方 phase 白名单注释「源码由 worktree 子代理写」);
// 但 runRoot 锚定到主仓后(v1.5.0-rc.2 引入的锚定链),区内路径被相对化为
// .claude/worktrees/<id>/...,不在协调者白名单内 —— 子代理被误判为协调者而遭拦截
// (回归:rc.2 之前 runRoot 取 cwd=worktree,区内无 state 故按设计放行)。
// 该区与主仓状态隔离(区内无 state 文件),故按隔离区语义放行;内容边界仍由 TASK write_files
// 与提交子集校验约束。判据用归一化后的相对路径(防 ../../ 穿越绕过)。
// 单一实现:file_path 判定与 Bash 命令写入判定共用同一函数——两条判定路径必须同语义,
// 否则同一路径会因所选工具而异(Write/Edit 放行、Bash 重定向被拦)。
// 隔离区根（项目根相对，POSIX 形态）——词法判定与物理判定共用同一常量：隔离区位置是安全边界
// 的一部分，变更只应改这一处（两处各写一份字面量必然漂移）。
const AGENT_WORKTREE_ROOT_REL = '.claude/worktrees';
function isInsideAgentWorktree(targetRel) {
  if (typeof targetRel !== 'string' || targetRel === '') return false;
  const normalized = path.posix.normalize(targetRel.replaceAll('\\', '/'));
  return normalized.startsWith(AGENT_WORKTREE_ROOT_REL + '/');
}

// worktree 隔离区的**物理**包含性判定（与上方词法判定的配对条件，放行的前置）：
// 词法前缀匹配只证明"路径字符串以隔离区前缀开头"，证明不了"写入真的落在隔离区内"——
// `.claude/worktrees/<id>/link/src/x.mjs` 中的 `link` 若是指向区外的符号链接/junction，
// 词法判定照样命中（该放行又在各自的白名单判定**之前**返回，没有任何后续校验能兜住）。
// 判据（fail-closed：不能证明落在区内即不放行）：
//   ① 自项目根逐分量 lstat——任一分量为符号链接/junction（Windows 两者在 lstat 下同为
//      symbolic link）即拒：其真实落点不受词法位置约束；
//   ② 每个已存在分量的真实路径须仍在项目根内（防项目根自身被链接分量替换的异常形态）；
//   ③ 首个不存在的分量之后按「最近已存在祖先的真实路径 + 余下分量」推导落点——目标文件/
//      目录尚不存在是常态（新建文件时目标必然不存在），不能因此拒判；
//      落点须位于 <真实项目根>/.claude/worktrees/ 之下（隔离区语义的物理版本）；
//   ④ 解析类故障（EACCES/ELOOP/悬挂链接/其它异常）一律拒。
// 性能：仅当词法前缀命中时才执行——普通协调者会话零开销；命中时每次至多 O(路径深度) 次
// lstat/realpath，且判定的路径形态固定（隔离区路径深度有限）。
async function agentWorktreeWriteStaysIsolated(targetRel) {
  let realRoot;
  try {
    realRoot = await fs.realpath(runRoot);
  } catch {
    return false;
  }
  const segments = targetRel
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  let cursor = runRoot;
  let physicalCursor = realRoot;
  let existingSegments = 0;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        break; // 余下分量为待新建——落点由最近已存在祖先的真实路径推导（见 ③）
      }
      return false; // 其它故障 fail-closed
    }
    if (stat.isSymbolicLink()) return false;
    let real;
    try {
      real = await fs.realpath(cursor);
    } catch {
      return false;
    }
    if (!workflowPathInside(realRoot, real)) return false;
    physicalCursor = real;
    existingSegments += 1;
  }
  const destination = path.resolve(physicalCursor, ...segments.slice(existingSegments));
  return workflowPathInside(
    path.join(realRoot, ...AGENT_WORKTREE_ROOT_REL.split('/')),
    destination,
  );
}

// W4: state 文件禁手动工具写（directOverride 授权约束的写入路径物理控制）——
// 运行时状态文件（.flow-comet/flow-comet-state.json）是机器字段文件，只能由脚本通道（workflow-state 的
// execution-mode/record/init 等命令）管理；任何工具写（Write/Edit/Bash 命令级）→ BLOCK
// （fail-closed）。hook 拦工具不拦脚本——脚本通道天然不触发 PreToolUse，不受影响。
// 与 M1 归档白名单收窄同型：保护机器文件不被越权手改（含 direct 模式下白名单 [''] 曾
// 放行 state 写入的 fail-open 缺口——执行者自切 direct 越权写的物理入口）。
// 大小写变体闭合（CodeRabbit 采纳）：win32/darwin 文件系统大小写不敏感，`.Flow-Comet/Flow-Comet-
// State.json` 与机器状态文件指向同一实体——目标路径先 toLowerCase() 再与机器状态相对路径
// 比较，变体同等 BLOCK（修复前精确等值比较被变体绕过 → fail-open）。其他平台
// （大小写敏感文件系统）变体是不同文件，保持精确等值比较（不误拦合法路径）。
// 取值唯一来源 = state-schema.mjs 的 RUNTIME_STATE_PATH（项目根相对的 POSIX 路径）。
// 本文件不再硬编码该路径——命名空间/文件名变更只改 state-schema.mjs 一处。
const STATE_FILE_REL = RUNTIME_STATE_PATH;
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';
function blockedStateFileTarget(targetRel) {
  return CASE_INSENSITIVE_FS
    ? targetRel.toLowerCase() === STATE_FILE_REL
    : targetRel === STATE_FILE_REL;
}

function blockStateFileWrite(target) {
  hookBlock(
    `BLOCKED: state 文件 "${target}" 禁手动工具写（机器字段由脚本通道管理——execution-mode/record/init 等命令正常）`,
    '恢复: 用 workflow-state.mjs 的 execution-mode 等命令管理状态；禁止手改 state 机器字段'
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
// 项目根判定兜底链（级3 cwd 漂移实测暴露的 H5 残留缺口收口）：
// ① FLOW_COMET_RUN_ROOT（测试/受限环境显式锚定）→ ② CLAUDE_PROJECT_DIR（Claude Code 在 hook env
// 注入项目根——会话 cwd 漂移后仍可正确定位）→ ③ 自 cwd 逐级向上锚定最近祖先：含
// .flow-comet/flow-comet-state.json 或 .claude/skills/flow-comet 即视为项目根 → ④ 兜底 cwd。
// 意义：漂移会话不再因“协议/状态按错误 cwd 解析失败 → 报错式放行”而漏拦；判定根与项目根一致。
const runRoot = (() => {
  for (const candidate of [process.env.FLOW_COMET_RUN_ROOT, process.env.CLAUDE_PROJECT_DIR]) {
    if (!candidate) continue;
    // 候选须真实存在且含项目标记（state 或已装技能），陈旧/无效值不采纳 → 落入祖先/cwd 兜底
    const resolved = path.resolve(candidate);
    if (
      fsExistsSync(resolved) &&
      (fsExistsSync(path.join(resolved, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME)) ||
        fsExistsSync(path.join(resolved, '.claude', 'skills', 'flow-comet')))
    ) {
      return resolved;
    }
  }
  let current = path.resolve(process.cwd());
  for (;;) {
    if (
      fsExistsSync(path.join(current, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME)) ||
      fsExistsSync(path.join(current, '.claude', 'skills', 'flow-comet'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(process.cwd());
})();
// hook 由 settings.json 静态命令调用，不支持 CLI 参数（cliArgs 传 []）：
// 协议路径取 env FLOW_COMET_PROTOCOL 或默认 <packageRoot>/reference/workflow-protocol.json
const protocolPath = resolveProtocol(packageRoot, runRoot, []);


const WORKFLOW_PROJECT_FILE_MAX_BYTES = 2 * 1024 * 1024;

// Phase 写入白名单：currentNode → 允许写入的（相对 runRoot 的）路径前缀
// '.specs/' 前缀表示只允许 .specs 目录下的文件（subagent-execute 始终协调者，只写工件；源码由 worktree 子代理写）
// 其他路径前缀精确匹配
// 注：白名单已声明化（协议 writeWhitelist 优先，缺失/读取失败时回退下方缺省表）；
// execute 的名单由 state.executionMode 动态收窄（subagent=协调者 .specs/；direct=逃生口允许主代理直写源码），
// 收窄规则对缺省/声明表同样生效，见 resolvePhaseWriteWhitelist()

function workflowPathInside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith('..' + path.sep))
  );
}

async function inspectWorkflowProtectedPath(
  projectRoot,
  target,
  label,
  expected = 'any',
) {
  const lexicalRoot = path.resolve(projectRoot);
  const lexicalTarget = path.resolve(target);
  if (!workflowPathInside(lexicalRoot, lexicalTarget)) {
    throw new Error(label + ' must stay inside the project root');
  }
  const rootStat = await fs.lstat(lexicalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(label + ' project root must be a real directory');
  }
  const realRoot = await fs.realpath(lexicalRoot);
  const relative = path.relative(lexicalRoot, lexicalTarget);
  const segments = relative === '' ? [] : relative.split(path.sep);
  let cursor = lexicalRoot;
  for (let index = 0; index < segments.length; index++) {
    cursor = path.join(cursor, segments[index]);
    let stat;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        return { target: lexicalTarget, exists: false };
      }
      throw error;
    }
    const display = path.relative(lexicalRoot, cursor).replaceAll('\\', '/');
    if (stat.isSymbolicLink()) {
      throw new Error(label + ' crosses a symbolic link or junction at ' + display);
    }
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(label + ' ancestor ' + display + ' must be a real directory');
    }
    if (
      final &&
      ((expected === 'file' && !stat.isFile()) ||
        (expected === 'directory' && !stat.isDirectory()) ||
        (expected === 'any' && !stat.isFile() && !stat.isDirectory()))
    ) {
      throw new Error(label + ' must be a real ' + expected);
    }
    const physical = await fs.realpath(cursor);
    if (!workflowPathInside(realRoot, physical)) {
      throw new Error(label + ' resolves outside the project root');
    }
  }
  return { target: lexicalTarget, exists: true };
}

function workflowFileObjectIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    birthtime: typeof stat.birthtimeNs === 'bigint' ? stat.birthtimeNs : stat.birthtimeMs,
  };
}

function workflowHasIdentity(value) {
  return value !== 0 && value !== 0n && value !== '0';
}

function workflowSameFileObject(left, right) {
  const comparableDevice = workflowHasIdentity(left.dev) && workflowHasIdentity(right.dev);
  const comparableInode = workflowHasIdentity(left.ino) && workflowHasIdentity(right.ino);
  if (comparableDevice && left.dev !== right.dev) return false;
  if (comparableInode && left.ino !== right.ino) return false;
  if (comparableDevice && comparableInode) return true;
  return left.birthtime === right.birthtime;
}

function workflowSameFileStat(left, right) {
  return (
    workflowSameFileObject(
      workflowFileObjectIdentity(left),
      workflowFileObjectIdentity(right),
    ) &&
    left.size === right.size &&
    left.ctimeNs === right.ctimeNs
  );
}

async function readWorkflowProtectedFile(
  projectRoot,
  file,
  label,
  maxBytes,
  hooks = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(label + ' byte limit must be a positive integer');
  }
  const inspection = await inspectWorkflowProtectedPath(
    projectRoot,
    file,
    label,
    'file',
  );
  if (!inspection.exists) {
    const error = new Error(label + ' does not exist');
    error.code = 'ENOENT';
    throw error;
  }
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(label + ' must be a real file');
  }
  if (before.size > BigInt(maxBytes)) {
    throw new Error(label + ' exceeds ' + String(maxBytes) + ' bytes');
  }
  const beforeRealPath = await fs.realpath(file);
  await hooks.afterLstat?.();
  const flags =
    process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  let handle;
  try {
    handle = await fs.open(file, flags);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ELOOP') {
      throw new Error(label + ' must be a real file');
    }
    throw error;
  }
  try {
    const [opened, afterOpen, afterOpenRealPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(file, { bigint: true }),
      fs.realpath(file),
    ]);
    if (
      !opened.isFile() ||
      !afterOpen.isFile() ||
      afterOpen.isSymbolicLink() ||
      afterOpenRealPath !== beforeRealPath ||
      !workflowSameFileStat(before, opened) ||
      !workflowSameFileStat(before, afterOpen)
    ) {
      throw new Error(label + ' changed while opening');
    }
    await inspectWorkflowProtectedPath(projectRoot, file, label, 'file');
    await hooks.afterOpen?.();
    const chunks = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    for (;;) {
      const remaining = maxBytes + 1 - total;
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, remaining),
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw new Error(label + ' exceeds ' + String(maxBytes) + ' bytes');
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    await hooks.beforeFinalCheck?.();
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(file, { bigint: true }),
      fs.realpath(file),
    ]);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterRealPath !== beforeRealPath ||
      !workflowSameFileStat(before, afterHandle) ||
      !workflowSameFileStat(before, afterPath)
    ) {
      throw new Error(label + ' changed while reading');
    }
    await inspectWorkflowProtectedPath(projectRoot, file, label, 'file');
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function workflowRelativeSegments(value, label, allowWildcards = false) {
  if (typeof value !== 'string') throw new Error(label + ' must be a string');
  const trimmed = value.trim().replaceAll('\\', '/');
  if (
    trimmed.length === 0 ||
    path.posix.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    trimmed.startsWith('~') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\')
  ) {
    throw new Error(label + ' must be relative to its declared path base');
  }
  const segments = trimmed.split('/');
  if (segments.some((segment) => segment === '..')) {
    const boundary = label === 'workflow-run statePath' ? 'the project root' : 'its declared path base';
    throw new Error(label + ' must stay inside ' + boundary);
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    throw new Error(label + ' must not contain empty or dot path segments');
  }
  if (!allowWildcards && (trimmed.includes('*') || trimmed.includes('?'))) {
    throw new Error(label + ' cannot contain wildcards');
  }
  return segments;
}

function resolveWorkflowRelativePath(base, value, label, allowWildcards = false) {
  const segments = workflowRelativeSegments(value, label, allowWildcards);
  const target = path.resolve(base, ...segments);
  const relative = path.relative(path.resolve(base), target);
  if (
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith('..' + path.sep)
  ) {
    const boundary = label === 'workflow-run statePath' ? 'the project root' : 'its declared path base';
    throw new Error(label + ' must stay inside ' + boundary);
  }
  return { target, segments };
}


async function statePath(protocol) {
  // 协议未声明 state.statePath（最小 schema 协议）→ 回退默认运行时状态路径
  // （与 workflow-state.mjs 写 state 的路径同源——同为 state-schema.mjs 常量，防最小协议在
  //  hook 下全量崩溃，顺带消除"相位白名单读硬编码路径 vs 主流程读协议路径"的两段不一致）
  const preferred = String(protocol.state?.statePath ?? '') || RUNTIME_STATE_PATH;
  const target = resolveWorkflowRelativePath(
    runRoot,
    preferred,
    'workflow-run statePath',
  ).target;
  await inspectWorkflowProtectedPath(
    runRoot,
    target,
    'workflow-run statePath',
    'file',
  );
  return target;
}

async function readStateJson(file) {
  // 容忍 UTF-8 BOM（外部写入可能带 BOM）
  return JSON.parse(
    (
      await readWorkflowProtectedFile(
        runRoot,
        file,
        'workflow-run state',
        WORKFLOW_PROJECT_FILE_MAX_BYTES,
      )
    ).toString('utf8').replace(/^﻿/, ''),
  );
}

function route(protocol) {
  return (protocol.nodes ?? []).filter((node) => !node.disabled);
}

function completedSet(state) {
  return new Set(Array.isArray(state.completedNodes) ? state.completedNodes : []);
}

function nextNode(protocol, state) {
  const completed = completedSet(state);
  return route(protocol).find((node) => !completed.has(node.id)) ?? null;
}

// PreToolUse hook 输入从 stdin 传入（JSON：{ tool_name, tool_input: { file_path, ... } }）。
// 解析失败 / 无输入时返回 null，phase 写入控制因此跳过（不阻断）。
async function readHookInput() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8').trim();
    return text ? JSON.parse(text.replace(/^﻿/, '')) : null;
  } catch {
    return null;
  }
}

// 计算写入目标相对 runRoot 的路径（正斜杠分隔，供 PHASE_WRITE_WHITELIST 前缀匹配）。
// 无法解析或目标在项目根之外时返回 null。
function writeTargetFromHookInput(input) {
  if (!input || typeof input !== 'object') return null;
  const toolInput =
    input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : null;
  const filePath =
    toolInput && typeof toolInput.file_path === 'string' ? toolInput.file_path : null;
  if (!filePath) return null;
  const absolute = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(runRoot, filePath);
  const relative = path.relative(runRoot, absolute);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) {
    return null;
  }
  return relative === '' ? '.' : relative.replaceAll('\\', '/');
}

// 声明化写入白名单：协议 writeWhitelist（节点 id → 路径前缀数组）优先；
// 协议读取/解析失败或未声明 writeWhitelist 时静默回退缺省表（fail-closed，不 throw、不阻断 hook 主体流程——
// 与 state 读取失败放行不同：白名单缺失会出洞，缺省表是最小安全兜底）
// execute 收窄为通用规则：无论 execute 来自缺省还是协议，subagent 模式一律收窄为 ['.specs/']（协调者只写工件），
// direct 模式用声明/缺省值（缺省 direct 允许所有 = 主代理直写源码）
async function resolvePhaseWriteWhitelist(executionMode) {
  try {
    const protocol = await readProtocolFile(runRoot, protocolPath);
    validateProtocolSchema(protocol);
    const declared = parseProtocolWriteWhitelist(protocol);
    if (declared !== null) {
      // 协议声明模式：返回声明表 + declared=true（main 中对未列出节点 fail-closed 拒绝）
      return {
        whitelist: executionMode === 'subagent'
          ? { ...declared, execute: ['.specs/'] }
          : declared,
        declared: true,
      };
    }
  } catch {
    // 协议读取/解析失败 → 静默回退缺省表（不 throw）
  }
  const executeWhitelist = executionMode === 'direct' ? [''] : ['.specs/'];
  return {
    whitelist: {
      'open':             ['.specs/'],
      'design':           ['.specs/', '.specs/adr/'],
      'plan':             ['.specs/'],
      'execute':          executeWhitelist, // subagent: .specs/（协调者）；direct: 允许所有（主代理直写）
      'subagent-execute': ['.specs/'],      // 始终协调者（parallel 仍委托，防 execute 吞 parallel 回归）
      'review':           ['.specs/'],
      'verify':           ['.specs/'],
      // archive 白名单:归档阶段仅遗留清单(KNOWN-ISSUES.md)可写入 change 目录(先写后移),
      // 其余 change 工件不可改(收窄为精确文件——放宽到整个目录会让归档阶段可改任意
      // 工件且无校验,防线变宽);<change-id> 占位符由 targetAllowed 替换为当前 change;
      // 目录移动由 .specs/archive/ 覆盖(2026-08-15 修复:此前仅 .specs/archive/ 导致按文档
      // 流程被 BLOCK;2026-08-16 收窄为精确文件)
      'archive':          ['.specs/archive/', '.specs/<change-id>/KNOWN-ISSUES.md', '.specs/CHANGELOG.md', '.specs/LESSONS.md', 'STATE.md'],
    },
    declared: false,
  };
}

async function main() {
  const protocol = await readProtocolFile(runRoot, protocolPath);
  validateProtocolSchema(protocol);
  const nodes = route(protocol);
  if (nodes.length === 0) {
    throw new Error('workflow protocol has no enabled nodes');
  }
  // Phase 写入控制：按运行时状态文件的 currentNode 检查写入目标是否在白名单内
  // state 文件读取失败时不阻断（state 可能不存在），继续执行后续安全检查
  const stateFile = path.join(runRoot, RUNTIME_DIR, RUNTIME_STATE_FILE_NAME);
  let currentNode = null;
  let executionMode = 'subagent';
  let activeChange = null;
  try {
    const stateContent = await fs.readFile(stateFile, 'utf8');
    const state = JSON.parse(stateContent);
    currentNode = state.currentNode;
    executionMode = state.executionMode ?? 'subagent';
    activeChange = state.activeChange ?? null;
  } catch {}

  // 白名单声明化：协议 writeWhitelist 优先（节点 id → 路径前缀数组），缺失/读取失败时静默回退缺省表（fail-closed）
  // execute 收窄规则对缺省/声明表同样生效（subagent → ['.specs/'] 协调者；direct → 声明/缺省值）
  const { whitelist: PHASE_WRITE_WHITELIST, declared } = await resolvePhaseWriteWhitelist(executionMode);

  const hookInput = await readHookInput();
  const target = writeTargetFromHookInput(hookInput);

  // R5: Bash 工具写路径适配(CC 与 Codex 通用)——Bash 工具的 command 字符串(无 file_path),
  // 解析写入目标按当前节点白名单判定(与 file_path 判定同语义);未命中写入模式 = 无写入语义,放行。
  // CC 侧 settings.local.json 的 matcher 含 Bash(协调者禁令物理化——Bash 写源码同样被拦截)
  if (hookInput && typeof hookInput === 'object' && hookInput.tool_name === 'Bash') {
    const command = hookInput.tool_input && typeof hookInput.tool_input === 'object' ? hookInput.tool_input.command : null;
    const writeTargets = codexWriteTargetsFromCommand(command);
    if (writeTargets.length > 0 && currentNode) {
      const whitelist = PHASE_WRITE_WHITELIST[currentNode];
      // 声明模式未列出节点 → fail-closed(同 file_path 判定);缺省表无此节点 → 协调者默认 .specs/
      const effectiveWhitelist = whitelist || (declared ? null : ['.specs/']);
      for (const t of writeTargets) {
        const absolute = path.resolve(runRoot, t);
        const rel = path.relative(runRoot, absolute);
        const targetRel = (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) ? null : rel.replaceAll('\\', '/');
        if (targetRel !== null && blockedStateFileTarget(targetRel)) {
          blockStateFileWrite(t);
        }
        // worktree 隔离区放行(与 file_path 判定共用同一判定——同路径同结论);
        // 放行前置 = 物理包含性(词法命中但真实落点在区外 → 拒,不放行)
        if (targetRel !== null && isInsideAgentWorktree(targetRel)) {
          if (await agentWorktreeWriteStaysIsolated(targetRel)) continue;
          hookBlock(
            `BLOCKED: 命令写入 "${t}" 位于 worktree 隔离区但物理落点在区外（符号链接/junction 穿越）`,
            '恢复: 改用隔离区内的真实路径（隔离区放行仅限物理位于 <项目根>/.claude/worktrees/ 之下的写入）'
          );
        }
        const allowed = targetRel !== null && effectiveWhitelist !== null && targetAllowed(targetRel, effectiveWhitelist, activeChange);
        if (!allowed) {
          hookBlock(
            `BLOCKED: 命令写入 "${t}" 不在当前节点 "${currentNode}" 允许范围`,
            effectiveWhitelist === null
              ? `请在协议 writeWhitelist 中为节点 "${currentNode}" 声明允许的路径前缀`
              : `允许范围: ${effectiveWhitelist.join(', ')}`
          );
        }
      }
    }
  }

  // ── worktree 隔离区放行（CC Agent isolation:"worktree"）────────────────────
  // 判定实现见 isInsideAgentWorktree + agentWorktreeWriteStaysIsolated（与上方 Bash 命令写入
  // 判定共用——同一路径不因工具而异）；词法命中但物理落点在区外 → 拒（fail-closed）。
  if (isInsideAgentWorktree(target)) {
    if (!(await agentWorktreeWriteStaysIsolated(target))) {
      hookBlock(
        `BLOCKED: 写入 "${target}" 位于 worktree 隔离区但物理落点在区外（符号链接/junction 穿越）`,
        '恢复: 改用隔离区内的真实路径（隔离区放行仅限物理位于 <项目根>/.claude/worktrees/ 之下的写入）'
      );
    }
    hookOk();
    return;
  }

  if (currentNode && target) {
    if (blockedStateFileTarget(target)) {
      blockStateFileWrite(target);
    }
    const whitelist = PHASE_WRITE_WHITELIST[currentNode];
    if (whitelist) {
      const allowed = targetAllowed(target, whitelist, activeChange);
      if (!allowed) {
        hookBlock(`BLOCKED: phase "${currentNode}" 不允许写入 "${target}"`, `允许范围: ${whitelist.join(', ')}`);
      }
    } else if (declared) {
      // 审查补充（2026-08-08）：协议声明了 writeWhitelist 但未列出当前节点 → fail-closed 拒绝
      // （漏声明节点不放行——防协议作者漏列导致防线出洞）
      hookBlock(`BLOCKED: phase "${currentNode}" 未在协议 writeWhitelist 中声明，默认拒绝写入 "${target}"`, `请在协议 writeWhitelist 中为节点 "${currentNode}" 声明允许的路径前缀`);
    } else {
      // ：未声明 writeWhitelist 时，非内置节点（缺省表无此 id）→ 协调者默认 ['.specs/']
      // ——与内置 execute/subagent-execute 协调者语义统一（写源码必须显式声明，防 fail-open 防线出洞）
      const coordDefault = ['.specs/'];
      const allowed = coordDefault.some(prefix => prefix === '' || target.startsWith(prefix));
      if (!allowed) {
        hookBlock(`BLOCKED: phase "${currentNode}" 不允许写入 "${target}"`, `允许范围: ${coordDefault.join(', ')}（未声明 writeWhitelist 的协调者默认）`);
      }
    }
  }
  let state;
  try {
    state = await readStateJson(await statePath(protocol));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      // 无 state 文件（无活跃 workflow / 新克隆仓库）→ 放行，不阻断写入
      hookOk('(no active workflow)');
      return;
    }
    throw error;
  }
  //  判定语义——
  // ① 无 activeChange（无论 status；与"无 state 文件"同语义，覆盖旧 state 归档后）→ 放行
  // ② running（含旧 state 无 status 但有 activeChange，fail-closed 向后兼容）→ 白名单校验
  // ③ completed（归档后）→ 放行；其他 → 拦截
  if (!state.activeChange) {
    hookOk('(no active workflow)');
    return;
  }
  const running = state.status === 'running' || state.status === undefined;
  if (!running) {
    if (state.status === 'completed') {
      hookOk('(workflow completed)');
      return;
    }
    throw new Error('workflow is not running; current status is ' + String(state.status));
  }
  const current = state.currentNode ?? nextNode(protocol, state)?.id ?? null;
  if (!current || !nodes.some((node) => node.id === current)) {
    throw new Error('workflow state has no valid current Node');
  }
  hookOk();
  if (isCodex) return;
  console.log('NODE: ' + current);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
