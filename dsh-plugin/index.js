// dsh-flow-comet 插件核心。
//
// 职责：
//   1. tools/pre-execute 拦截：把 dsh 工具名归一化到 guard CLI 契约名（Write/Edit/Bash），
//      子进程调用包内 comet-hook-guard.mjs 判定，exit 2 -> PreToolDecision.deny。
//   2. fs/observed 审计：只记录 write/edit 写入观察事件到 $DSH_HOME/flow-comet-audit.jsonl。
//   3. 技能 provider 注册：通过 ctx.skills.registerProvider 暴露包内 skills/flow-comet。
//   4. 项目激活：按会话 cwd 检测 .comet/ 或 .specs/ 痕迹，幂等注入 AGENTS.md 托管区
//      与 <项目根>/reference/.flow-comet-workflow-protocol.json。
//
// 纯 ESM、零第三方依赖，仅使用 Node.js 内置模块。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname);
const SKILL_DIR = path.join(PACKAGE_ROOT, 'skills', 'flow-comet');
const HOOK_GUARD = path.join(SKILL_DIR, 'scripts', 'comet-hook-guard.mjs');
const RULES_FILE = path.join(PACKAGE_ROOT, 'rules', 'flow-comet-orchestration.md');
const PROTOCOL_SOURCE = path.join(SKILL_DIR, 'reference', 'workflow-protocol.json');
const SKILL_FILE = path.join(SKILL_DIR, 'SKILL.md');

export const MANAGED_AGENTS_START = '<!-- Managed by flow-comet prepare-env -->';
export const MANAGED_AGENTS_END = '<!-- /Managed by flow-comet prepare-env -->';
const INJECTED_STATE_FILE = 'flow-comet-injected.json';
const AUDIT_FILE = 'flow-comet-audit.jsonl';

// 插件元信息：Cordis 插件形态（name / inject / apply）。
export const name = 'dsh-flow-comet';
export const inject = ['skills'];

// 已激活项目根（仅含已成功注入的 flow-comet 痕迹项目）。
const activatedProjects = new Set();

// ---------------------------------------------------------------------------
// $DSH_HOME 解析（index.js 与 cleanup.mjs 共用同一规则）
// ---------------------------------------------------------------------------
export function resolveDshHome() {
  const env = process.env.DSH_HOME;
  if (typeof env === 'string' && env.trim() !== '') {
    return path.resolve(env.trim());
  }
  return path.join(os.homedir(), '.dsh');
}

// ---------------------------------------------------------------------------
// 注入记录（$DSH_HOME/flow-comet-injected.json）
// ---------------------------------------------------------------------------
export async function readInjectedState(dshHome) {
  try {
    const raw = await fs.readFile(path.join(dshHome, INJECTED_STATE_FILE), 'utf8');
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (
      data &&
      data.version === 1 &&
      Array.isArray(data.projects) &&
      data.projects.every((p) => p && typeof p.cwd === 'string')
    ) {
      return data;
    }
  } catch {
    // 缺失或损坏都按空记录处理，cleanup 仍可幂等执行。
  }
  return { version: 1, projects: [] };
}

export async function writeInjectedState(dshHome, state) {
  await fs.mkdir(dshHome, { recursive: true });
  const normalized = {
    version: 1,
    projects: Array.isArray(state.projects) ? state.projects : [],
  };
  await fs.writeFile(
    path.join(dshHome, INJECTED_STATE_FILE),
    JSON.stringify(normalized, null, 2) + '\n',
    'utf8',
  );
}

async function upsertProjectRecord(dshHome, cwd) {
  const state = await readInjectedState(dshHome);
  const key = path.resolve(cwd);
  const index = state.projects.findIndex((p) => path.resolve(p.cwd) === key);
  const record = { cwd: key, injectedAt: new Date().toISOString() };
  if (index >= 0) {
    state.projects[index] = record;
  } else {
    state.projects.push(record);
  }
  await writeInjectedState(dshHome, state);
}

// ---------------------------------------------------------------------------
// 审计日志（$DSH_HOME/flow-comet-audit.jsonl，append-only）
// ---------------------------------------------------------------------------
function appendAudit(dshHome, entry) {
  try {
    mkdirSync(dshHome, { recursive: true });
    const line =
      JSON.stringify({
        time: new Date().toISOString(),
        tool: entry.tool,
        target: entry.target ?? null,
        decision: entry.decision,
      }) + '\n';
    appendFileSync(path.join(dshHome, AUDIT_FILE), line, 'utf8');
  } catch (error) {
    // 审计失败只警告，绝不阻断工具调用。
    console.warn(
      '[dsh-flow-comet] WARN: 审计日志追加失败（不阻断）: ' + error.message,
    );
  }
}

// ---------------------------------------------------------------------------
// 工具名归一化：dsh 实际工具名 -> guard CLI 契约名（Write/Edit/Bash）
// ---------------------------------------------------------------------------
function normalizeToolName(toolName) {
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

function mapToolInput(canonicalName, args) {
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
// ---------------------------------------------------------------------------
export function isPathInsideProjectRoot(projectRoot, filePath) {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, filePath);
  const relative = path.relative(root, resolved);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  );
}

// ---------------------------------------------------------------------------
// 会话 cwd 与激活范围
// ---------------------------------------------------------------------------
function sessionCwd(exec) {
  return (
    exec?.agent?.session?.header?.cwd ||
    exec?.agent?.cwd ||
    null
  );
}

function hasFlowCometTraces(projectRoot) {
  return (
    existsSync(path.join(projectRoot, '.comet')) ||
    existsSync(path.join(projectRoot, '.specs'))
  );
}

function pluginMode(ctx) {
  return ctx?.config?.mode === 'global' ? 'global' : 'project';
}

function shouldProvideSkill(projectRoot, mode) {
  return mode === 'global' || hasFlowCometTraces(projectRoot);
}

// ---------------------------------------------------------------------------
// 路径改写：把 SKILL.md / orchestration 中的 skills/flow-comet 相对指针
// 改写为包内实际绝对路径（dsh 项目内不存在 .claude/skills 或 .agents/skills）。
// ---------------------------------------------------------------------------
function rewriteSkillPaths(text, skillDir) {
  const absoluteSkillDir = skillDir.replaceAll('\\', '/');
  return text.replace(
    /(?:\.claude\/|\.agents\/)?skills\/flow-comet\//g,
    absoluteSkillDir + '/',
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function managedRegionRegex() {
  return new RegExp(
    escapeRegExp(MANAGED_AGENTS_START) + '[\\s\\S]*?' + escapeRegExp(MANAGED_AGENTS_END) + '\\n?',
  );
}

export function stripManagedRegion(text) {
  return text.replace(managedRegionRegex(), '');
}

// ---------------------------------------------------------------------------
// 项目激活：AGENTS.md 托管区注入 + 协议副本复制 + dshHome 记录 upsert
// ---------------------------------------------------------------------------
async function injectProject(projectRoot) {
  const rulesText = await fs.readFile(RULES_FILE, 'utf8').catch((error) => {
    throw new Error(
      'dsh-flow-comet: 缺少 rules/flow-comet-orchestration.md（包不完整），请重新安装或运行 scripts/build-dsh-plugin.mjs 生成副本。' +
        ' 原始错误: ' +
        error.message,
    );
  });
  await fs.readFile(PROTOCOL_SOURCE, 'utf8').catch((error) => {
    throw new Error(
      'dsh-flow-comet: 缺少 skills/flow-comet/reference/workflow-protocol.json（包不完整），请重新安装或运行 scripts/build-dsh-plugin.mjs 生成副本。' +
        ' 原始错误: ' +
        error.message,
    );
  });

  // 1. AGENTS.md 托管区（非破坏合并：保留托管区外用户内容）。
  const agentsPath = path.join(projectRoot, 'AGENTS.md');
  let existing = '';
  try {
    existing = await fs.readFile(agentsPath, 'utf8');
  } catch {
    // 文件缺失 = 首次注入。
  }
  const rewrittenRules = rewriteSkillPaths(rulesText, SKILL_DIR).trim();
  const stripped = stripManagedRegion(existing);
  const managedBlock =
    MANAGED_AGENTS_START + '\n' + rewrittenRules + '\n' + MANAGED_AGENTS_END + '\n';
  const merged = (stripped.trim() ? stripped.trim() + '\n\n' : '') + managedBlock;
  await fs.writeFile(agentsPath, merged, 'utf8');

  // 2. 协议副本（方案 b）：<项目根>/reference/.flow-comet-workflow-protocol.json。
  const protocolDestDir = path.join(projectRoot, 'reference');
  await fs.mkdir(protocolDestDir, { recursive: true });
  await fs.copyFile(
    PROTOCOL_SOURCE,
    path.join(protocolDestDir, '.flow-comet-workflow-protocol.json'),
  );

  // 3. dshHome 注入记录（多 profile 汇聚：按 cwd 幂等 upsert）。
  await upsertProjectRecord(resolveDshHome(), projectRoot);
  activatedProjects.add(path.resolve(projectRoot));
}

async function ensureProjectActivated(projectRoot) {
  const key = path.resolve(projectRoot);
  if (activatedProjects.has(key)) return;
  await injectProject(projectRoot);
}

// ---------------------------------------------------------------------------
// 判定核心子进程调用
// ---------------------------------------------------------------------------
function runGuard(projectRoot, canonicalName, toolInput) {
  return new Promise((resolve) => {
    const protocolCopy = path.join(
      projectRoot,
      'reference',
      '.flow-comet-workflow-protocol.json',
    );
    const child = spawn(
      process.execPath,
      [HOOK_GUARD, 'before_tool'],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          COMET_RUN_ROOT: projectRoot,
          FLOW_COMET_PROTOCOL: protocolCopy,
        },
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
      if (code === 0) {
        resolve({ kind: 'allow' });
        return;
      }
      if (code === 2) {
        const detail = (stderr || stdout || '').trim();
        resolve({
          kind: 'deny',
          reason:
            'dsh-flow-comet: 写入被 flow-comet 白名单拦截\n' +
            (detail ? detail + '\n' : '') +
            '恢复指引：请将写入目标调整到当前节点允许的路径前缀，或先完成当前节点流程后再写；如认为判定有误，请检查 .comet/flow-comet-state.json 与协议白名单。',
        });
        return;
      }
      resolve({
        kind: 'error',
        message:
          '判定脚本异常退出（code=' + String(code) + '）: ' + (stderr || stdout || '').trim(),
      });
    });
    child.stdin.end(
      JSON.stringify({ tool_name: canonicalName, tool_input: toolInput }),
    );
  });
}

// ---------------------------------------------------------------------------
// 技能 provider
// ---------------------------------------------------------------------------
function createCandidate() {
  return {
    name: 'flow-comet',
    description:
      'Use when the user wants the flow-comet managed workflow for flow-kit 9 阶段工作流的 workflow-kernel 实现。',
    rank: 1000,
    locator: { provider: 'flow-comet', path: SKILL_DIR },
    path: SKILL_FILE,
    source: 'bundled',
    provider: 'flow-comet',
    invocation: { modelInvocable: true, userInvocable: true },
    resourceBase: { kind: 'directory', path: SKILL_DIR },
  };
}

async function loadSkillDefinition(candidate) {
  const skillFile = candidate?.path || SKILL_FILE;
  let raw;
  try {
    raw = await fs.readFile(skillFile, 'utf8');
  } catch {
    return undefined;
  }
  return {
    ...candidate,
    content: rewriteSkillPaths(raw, SKILL_DIR),
    path: skillFile,
  };
}

function registerSkillProvider(ctx, mode) {
  ctx.skills.registerProvider((control) => ({
    name: 'flow-comet',
    async list(options) {
      if (control.signal?.aborted) return [];
      const cwd = options?.cwd;
      if (!cwd || typeof cwd !== 'string') return [];
      const projectRoot = path.resolve(cwd);
      if (!shouldProvideSkill(projectRoot, mode)) return [];
      if (hasFlowCometTraces(projectRoot)) {
        try {
          await ensureProjectActivated(projectRoot);
        } catch (error) {
          console.error('[dsh-flow-comet] 项目激活失败（技能仍可见，但注入/拦截可能不完整）: ' + error.message);
        }
      }
      return [createCandidate()];
    },
    async get(candidate, options) {
      if (control.signal?.aborted) return undefined;
      if (!candidate || candidate.name !== 'flow-comet') return undefined;
      return loadSkillDefinition(candidate);
    },
  }));
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------
function assertPackageResources() {
  const required = [HOOK_GUARD, RULES_FILE, PROTOCOL_SOURCE, SKILL_FILE];
  const missing = required.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(
      'dsh-flow-comet: 插件包不完整，缺少: ' +
        missing.join(', ') +
        '。请重新安装 dsh-flow-comet 或运行 scripts/build-dsh-plugin.mjs 生成副本。',
    );
  }
}

export function apply(ctx) {
  assertPackageResources();
  const mode = pluginMode(ctx);
  console.log('[dsh-flow-comet] apply mode=' + mode);

  registerSkillProvider(ctx, mode);

  // tools/pre-execute：waterfall 监听。
  ctx.on('tools/pre-execute', async (exec, next) => {
    const canonicalName = normalizeToolName(exec?.name);
    if (!canonicalName) {
      return next();
    }

    const cwd = sessionCwd(exec);
    if (!cwd || typeof cwd !== 'string' || cwd.trim() === '') {
      const reason =
        'dsh-flow-comet: 无法确定会话项目根（exec.agent.session.header.cwd 缺失）——为防判定绕过已拒绝工具调用';
      console.warn(reason);
      appendAudit(resolveDshHome(), {
        tool: canonicalName,
        target: null,
        decision: 'deny',
      });
      return { kind: 'deny', reason };
    }

    const projectRoot = path.resolve(cwd);
    if (!hasFlowCometTraces(projectRoot)) {
      // 非 flow-comet 痕迹项目：不拦截、不注入。
      return next();
    }

    try {
      await ensureProjectActivated(projectRoot);
    } catch (error) {
      const reason =
        'dsh-flow-comet: 项目激活失败，无法安全调用判定核心（fail-closed 拒绝）: ' +
        error.message;
      console.warn(reason);
      appendAudit(resolveDshHome(), {
        tool: canonicalName,
        target: null,
        decision: 'deny',
      });
      return { kind: 'deny', reason };
    }

    const mapped = mapToolInput(canonicalName, exec?.arguments);
    if (!mapped.ok) {
      const reason =
        'dsh-flow-comet: 工具 ' +
        String(exec?.name) +
        ' 参数形状不符（' +
        mapped.reason +
        '）——fail-closed 拒绝';
      console.warn(reason);
      appendAudit(resolveDshHome(), {
        tool: canonicalName,
        target: null,
        decision: 'deny',
      });
      return { kind: 'deny', reason };
    }

    if (canonicalName === 'Write' || canonicalName === 'Edit') {
      if (!isPathInsideProjectRoot(projectRoot, mapped.target)) {
        const reason =
          'dsh-flow-comet: 写入目标 "' +
          mapped.target +
          '" 不在项目根 "' +
          projectRoot +
          '" 内——越界写入已拒绝，未进入 guard 判定';
        console.warn(reason);
        appendAudit(resolveDshHome(), {
          tool: canonicalName,
          target: mapped.target,
          decision: 'deny',
        });
        return { kind: 'deny', reason };
      }
    }

    const decision = await runGuard(projectRoot, canonicalName, mapped.input);
    if (decision.kind === 'allow') {
      return next();
    }
    if (decision.kind === 'deny') {
      appendAudit(resolveDshHome(), {
        tool: canonicalName,
        target: mapped.target,
        decision: 'deny',
      });
      return { kind: 'deny', reason: decision.reason };
    }

    // 其他错误态：fail-closed deny + WARN。
    const reason =
      'dsh-flow-comet: 判定核心调用失败（fail-closed 拒绝）: ' + decision.message;
    console.warn(reason);
    appendAudit(resolveDshHome(), {
      tool: canonicalName,
      target: mapped.target,
      decision: 'deny',
    });
    return { kind: 'deny', reason };
  });

  // fs/observed：只审计 write/edit 写入观察事件（read 不记、Bash 不入审计）。
  ctx.on('fs/observed', (observation) => {
    const actorName =
      observation?.actor?.name ||
      observation?.tool?.name ||
      observation?.toolName ||
      null;
    const canonicalName = normalizeToolName(actorName);
    if (canonicalName !== 'Write' && canonicalName !== 'Edit') return;

    const target =
      observation?.target ||
      observation?.path ||
      observation?.filePath ||
      null;
    if (!target) return;

    // 仅记录已激活 flow-comet 项目内的写入观察。
    const absTarget = path.resolve(String(target));
    const active = [...activatedProjects].some(
      (root) => absTarget === root || absTarget.startsWith(root + path.sep),
    );
    if (!active) return;

    appendAudit(resolveDshHome(), {
      tool: canonicalName,
      target: String(target),
      decision: 'allow',
    });
  });
}
