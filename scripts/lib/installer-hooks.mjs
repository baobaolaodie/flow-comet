/**
 * installer-hooks.mjs — 各平台的配置注入与 .gitignore 纳管（prepare-env 的逻辑层模块）
 *
 * 「注入」在本模块的统一语义（也是本模块的边界）：读现有文件 → 保留用户既有内容 → 只替换
 * 本安装器管理的条目 → 写回。解析不了（非法 JSON / 非 YAML / 结构不符）一律中止并给人工处置
 * 指引，绝不静默覆盖——安装器写的是用户的配置文件，失败方向必须是「不动」而不是「清空」，
 * 否则一次手写变体就会让用户的权限与 hook 配置消失。
 *
 * 依赖方向：installer-migrate（路径探测原语与运行时目录名）与 installer-loader（托管块移除：
 * AGENTS.md 托管区与 cordis.patch.yml 托管块共用同一幂等替换边界）；installer-platforms 依赖
 * 本模块。反向依赖不存在。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RUNTIME_DIR, isMissingPathError } from './installer-migrate.mjs';
import { stripManagedBlock } from './installer-loader.mjs';

// comet-hook-guard 的 command 特征（用于识别"已管理的 hook 命令"，注入时替换避免重复）
const MANAGED_HOOK_COMMAND_MARKER = 'comet-hook-guard.mjs';

// ---------- hook 命令项目根锚定（单一事实来源） ----------
// Claude Code 运行 hook 时注入 CLAUDE_PROJECT_DIR 环境变量（值 = 项目根绝对路径，官方 hooks
// 文档契约）。变量名是唯一事实来源；命令形态**全平台统一**为 POSIX/bash 词形
// （`${VAR}` + 正斜杠——CC 在所有平台含 Windows 都以 /bin/bash -c 执行 hook 命令），
// 由 projectRootGuardScriptRef 派生，不按宿主 OS 分叉。
const PROJECT_ROOT_ENV_VAR = 'CLAUDE_PROJECT_DIR';

// hook 命令加整体外层引号（2026-09-10 演进——原「不加引号」取舍的前提是识别函数按空白分词
// 判等、外层引号会并入 token 使 basename 失配；识别函数已演进为容忍引号，故放开）：未加
// 引号时，含空格的项目根路径在变量展开后会被词法分词切断（静默失效，与反斜杠转义同类）。
function projectRootGuardScriptRef(rootDirName) {
  // CC 全平台以 /bin/bash -c 执行 hook 命令（含 Windows——Git Bash 语义），并注入
  // CLAUDE_PROJECT_DIR 环境变量；故统一 POSIX 形态：${VAR} 花括号词形（CC 自身亦做该词形
  // 插值——字符串替换，双保险）+ 正斜杠路径（反斜杠在 bash 词法里会被当转义吞掉，如 \. \f）。
  // 整体加引号：含空格的项目根路径不因词法分词断裂；识别层容忍引号（isManagedHookCommand
  // 去引号后取 basename 判等），幂等升级不受影响。
  const segments = [rootDirName, 'skills', 'flow-comet', 'scripts', MANAGED_HOOK_COMMAND_MARKER];
  return `"\${${PROJECT_ROOT_ENV_VAR}}/${segments.join('/')}"`;
}

// AGENTS.md 托管区标记（Codex/dsh 平台 rules 注入共用——幂等替换边界,任一平台卸载可清）
export const MANAGED_AGENTS_START = '<!-- Managed by flow-comet prepare-env -->';
export const MANAGED_AGENTS_END = '<!-- /Managed by flow-comet prepare-env -->';
// ---------- .gitignore 保守纳管（目标项目；读-合并-写幂等，参照 injectSettingsHook 模式） ----------

/** 判断一行是否为 `.flow-comet/` 忽略条目（容忍首尾空白与可选的首尾斜杠变体）。 */
function isRuntimeDirIgnoreLine(line) {
  return String(line).trim().replace(/^\/+/, '').replace(/\/+$/, '') === RUNTIME_DIR;
}

/**
 * gitignore 保守纳管（读-合并-写幂等）：既有条目一律保留原样——安装器无法可靠推断用户
 * 写下 `.comet/` 条目的原始意图（实测载体用整目录形态，该目录中仍有 Comet 资产），
 * 故只做「缺失时追加」，不改写用户其他内容（无关行/注释/既有行尾风格）。
 * 源仓库自身跳过：`.flow-comet/` 在源仓库是权威源（需被版本控制跟踪），
 * 整目录忽略会把权威源新增文件静默排除出版本控制。
 */
export function manageGitignore(target) {
  if (fs.existsSync(path.join(target, RUNTIME_DIR, 'skills', 'flow-comet', 'SKILL.md'))) {
    console.log(`[flow-comet] .gitignore 纳管跳过: 当前目录是 flow-comet 源仓库（${RUNTIME_DIR}/ 为权威源，需保持被版本控制跟踪）`);
    return;
  }
  const gitignorePath = path.join(target, '.gitignore');
  let existing = '';
  let fileExists = false;
  try {
    existing = fs.readFileSync(gitignorePath, 'utf8');
    fileExists = true;
  } catch (err) {
    // 只有「确实不存在」才是首次纳管；访问类故障（EACCES/EPERM/EIO…）必须原样抛出中止——
    // 按空内容继续会让下面的写回把用户既有 .gitignore **截断**为仅含受管条目
    // （判定语义见 isMissingPathError；调用点契约即「失败即中止，可重跑自愈」）。
    if (!isMissingPathError(err)) {
      throw err;
    }
  }
  if (existing.split(/\r?\n/).some(isRuntimeDirIgnoreLine)) {
    console.log(`[flow-comet] .gitignore 已含 ${RUNTIME_DIR}/ 条目——保持原样（幂等）`);
    return;
  }
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const appended = ['# flow-comet 运行时文件（不随仓库分发）', `${RUNTIME_DIR}/`].join(eol);
  const separator = !fileExists || existing === '' || existing.endsWith('\n') ? '' : eol;
  fs.writeFileSync(gitignorePath, existing + separator + appended + eol, 'utf8');
  console.log(`[flow-comet] .gitignore 追加 ${RUNTIME_DIR}/ 条目（既有内容原样保留）: ${gitignorePath}`);
}
// ---------- settings.local.json 注入（Claude Code 平台；参考 comet installClaudeCodeHooks） ----------

/** 判断 hook 命令是否为"已管理的 comet hook"（注入时替换，保证幂等）。
 * 精确匹配：归一化命令（去前缀、统一分隔符）后必须包含
 * 'comet-hook-guard.mjs' 作为脚本路径（而非任意位置子串），防误伤用户自定义 hook。
 */
function isManagedHookCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') {
    return false;
  }
  const normalized = command.replace(/\\/g, '/').trim();
  // 提取命令中的脚本路径（node <path> 或直接 <path>）——容忍外层引号（含空格路径防护形态）：
  // 引号由可选的 ["']? 吸收、不并入捕获组，basename 判等保持形态无关（旧相对形态 / 变量引用
  // 形态 / 绝对路径形态 / 带引号形态均识别）。
  const pathMatch = normalized.match(/(?:^|\s)["']?([^\s"']+\.mjs)["']?(?:\s|$)/);
  if (!pathMatch) {
    return false;
  }
  const scriptPath = pathMatch[1].split('/').pop();
  return scriptPath === MANAGED_HOOK_COMMAND_MARKER;
}

/**
 * 合并 hook 组：已有组中过滤掉已管理的 comet hook 命令；新组按 matcher 合并进
 * 同 matcher 的既有组（或新建组）。参考 comet mergeHookGroups。
 */
function mergeHookGroups(existingGroups, newGroups) {
  const mergedGroups = (Array.isArray(existingGroups) ? existingGroups : []).map((group) => {
    if (!group || typeof group !== 'object' || Array.isArray(group) || !Array.isArray(group.hooks)) {
      return group;
    }
    const hadManagedHook = group.hooks.some((hook) => isManagedHookCommand(hook && hook.command));
    const filtered = group.hooks.filter((hook) => !isManagedHookCommand(hook && hook.command));
    // 只删除「含托管 hook 且过滤后为空」的组:matcher 演进(如 Write|Edit → Write|Edit|Bash)
    // 会使旧托管组过滤为空,此时删除防配置污染(与 Codex purge 路径一致);
    // 用户空组/纯用户组保留(不动用户配置——2026-08-16 修复:此前统一删空组会误删用户空 matcher 组)
    if (hadManagedHook && filtered.length === 0) return null;
    return { ...group, hooks: filtered };
  }).filter(Boolean);
  for (const newGroup of newGroups) {
    const existingIndex = mergedGroups.findIndex(
      (group) =>
        group &&
        typeof group === 'object' &&
        !Array.isArray(group) &&
        group.matcher === newGroup.matcher &&
        Array.isArray(group.hooks)
    );
    if (existingIndex >= 0) {
      const existing = mergedGroups[existingIndex];
      mergedGroups[existingIndex] = { ...existing, hooks: [...existing.hooks, ...newGroup.hooks] };
    } else {
      mergedGroups.push(newGroup);
    }
  }
  return mergedGroups;
}

/**
 * 注入 comet hook 到 settings.local.json（Claude Code 平台）：
 * 读现有 settings（缺失 → {}）→ 保留全部既有字段（permissions 等）→
 * 只更新 hooks.PreToolUse（过滤已管理 comet hook + 合并新 hook）→ 写回。
 *
 * fail-safe（T-FIX-13 审查修复）：
 * - settings 文件存在但 JSON 非法 → 抛错退出（不静默覆盖，避免用户内容丢失）
 * - hooks.PreToolUse 非数组（手写变体/对象形式）→ 保留原值 + 警告（不注入，
 *   避免破坏用户结构；提示手动配置）
 */
export function injectSettingsHook(claudeDir) {
  const settingsPath = path.join(claudeDir, 'settings.local.json');
  let settings = {};
  let fileExists = false;
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    fileExists = true;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      settings = parsed;
    } else {
      throw new Error('settings 顶层必须是 JSON 对象');
    }
  } catch (err) {
    if (fileExists) {
      // 文件存在但非法：fail-safe——不覆盖用户内容，报错退出
      throw new Error(
        `settings.local.json 已存在但内容非法（${err.message}）——为保护用户配置，中止注入。` +
          `请修复该文件后重试，或手动添加 hook 配置（见 README 方案 B）。`
      );
    }
    // 文件缺失：视为空对象（首次安装）
    settings = {};
  }
  const existingHooks = settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks)
    ? settings.hooks
    : {};
  const newGroup = {
    // R5: matcher 含 Bash——协调者禁令物理化(Bash 写源码命令同样被 hook 检测拦截;
    // hook 对无写路径的 Bash 命令(如 git/查询)放行)
    matcher: 'Write|Edit|Bash',
    hooks: [
      {
        type: 'command',
        // 项目根锚定（全平台统一形态）：node ${CLAUDE_PROJECT_DIR}/.claude/skills/.../comet-hook-guard.mjs
        // —— CC 以 /bin/bash -c 执行 hook 命令（含 Windows），POSIX 词形 + 正斜杠为唯一可用形态。
        // 运行期由 CC 注入的变量展开；单一事实来源 = PROJECT_ROOT_ENV_VAR + projectRootGuardScriptRef。
        command: `node ${projectRootGuardScriptRef('.claude')}`,
      },
    ],
  };
  if (existingHooks.PreToolUse !== undefined && !Array.isArray(existingHooks.PreToolUse)) {
    // PreToolUse 非数组（手写变体）：保留原值 + 警告，不注入（避免破坏用户结构）
    console.error(
      '[flow-comet] 警告: settings.local.json 的 hooks.PreToolUse 不是数组（可能是手写变体）——' +
        '为保护用户配置，未注入 comet hook。请手动添加（见 README 方案 B）。'
    );
    return settings;
  }
  const merged = mergeHookGroups(existingHooks.PreToolUse, [newGroup]);
  settings.hooks = { ...existingHooks, PreToolUse: merged };
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return settings;
}
// ---------- Codex 平台注入 + AGENTS.md 托管区（codex/dsh 共用） ----------

/**
 * 注入 comet hook 到 .codex/hooks.json（Codex 平台）：
 * 读现有 hooks（缺失 → {}）→ 过滤已管理 comet hook（命令含 comet-hook-guard.mjs）→
 * 合并新组（matcher "*"——Codex PreToolUse 只拦截 Bash 工具,写路径经 PowerShell/Bash 命令,
 * 必须匹配所有 Bash 调用;命令带 --platform codex 平台标记）→ 写回。
 * 结构：顶层 "hooks" 包裹层（Codex 与 Claude Code 同构——{"hooks":{"PreToolUse":[...]}};
 * 实测缺包裹层 hook 不加载）。
 * fail-safe：文件存在但 JSON 非法 → 抛错退出（保护用户配置）。
 */
export function injectCodexHook(codexDir, target) {
  const hooksPath = path.join(codexDir, 'hooks.json');
  let hooks = {};
  let fileExists = false;
  try {
    const raw = fs.readFileSync(hooksPath, 'utf8');
    fileExists = true;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      hooks = parsed;
    } else {
      throw new Error('hooks.json 顶层必须是 JSON 对象');
    }
  } catch (err) {
    if (fileExists) {
      throw new Error(
        `.codex/hooks.json 已存在但内容非法（${err.message}）——为保护用户配置，中止注入。请修复该文件后重试。`
      );
    }
    hooks = {};
  }
  const existingHooks = hooks.hooks && typeof hooks.hooks === 'object' && !Array.isArray(hooks.hooks)
    ? hooks.hooks
    : {};
  const existingGroups = Array.isArray(existingHooks.PreToolUse) ? existingHooks.PreToolUse : [];
  // D6 查证结论（2026-08，openai/codex 官方仓库 main 分支）：
  // - hooks.json 的 command 经 shell 执行：Windows = %COMSPEC% 回退 cmd.exe /C；POSIX = $SHELL
  //   回退 /bin/sh -lc（codex-rs/hooks/src/engine/command_runner.rs 的 build_command /
  //   default_shell_command）；子进程环境 = 会话环境快照 + 条目级 env 映射，current_dir = 会话工作目录。
  // - 无等价项目根变量：全仓 Rust 检索 CODEX_PROJECT_DIR / CLAUDE_PROJECT_DIR / project_dir
  //   均 0 命中（GitHub code search，openai/codex）；$PWD/%CD% 展开的是"会话启动目录"而非
  //   项目根契约，子目录启动即漂移——不构成 CLAUDE_PROJECT_DIR 的等价锚点。
  // → 按 D6 预授权退化分支：安装期把 target 绝对路径字面注入（path.join）。
  // ⚠️ 迁移目录需重跑安装器：绝对路径随安装位置固化，项目移动/换 checkout 后必须重新运行
  //    本安装器刷新 hooks.json（旧条目按脚本 basename 仍被 isManagedHookCommand 识别并在
  //    重跑时被过滤替换为新位置——幂等自愈，不会产生重复条目）。
  // 注：上游 HookHandlerConfig::Command 另有 command_windows 平台分字段（declarations.rs）；
  //    本安装器逐机注入，写入路径与宿主 OS 天然一致，无需分字段双写。
  const guardAbsolutePath = path.join(target, '.agents', 'skills', 'flow-comet', 'scripts', MANAGED_HOOK_COMMAND_MARKER);
  const newGroup = {
    matcher: '*',
    hooks: [
      {
        type: 'command',
        command: `node ${guardAbsolutePath} before_tool --platform codex`,
      },
    ],
  };
  const merged = mergeHookGroups(existingGroups, [newGroup]);
  hooks.hooks = { ...existingHooks, PreToolUse: merged };
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + '\n', 'utf8');
  return hooks;
}
/**
 * 注入 Codex hook 启用配置到 .codex/config.toml（Codex 平台）：
 * hooks 默认关闭——需 [features] hooks = true（部分版本 codex_hooks = true;双写兼容）。
 * 幂等：已有 [features] 段时合并缺失键,不覆盖用户其他配置。
 */
export function injectCodexConfig(codexDir) {
  const configPath = path.join(codexDir, 'config.toml');
  let content = '';
  try {
    content = fs.readFileSync(configPath, 'utf8');
  } catch { /* 文件缺失 = 首次安装 */ }
  if (content.includes('[features]')) {
    // 已有 [features] 段:一次性补齐全部缺失键(分次 replace 会因插入点被前次消耗而失配;
    // CRLF 行尾与文件尾无换行均须匹配——(\[features\])(?:\r?\n|$) 覆盖)
    const missing = [];
    if (!/^hooks\s*=/m.test(content)) missing.push('hooks = true');
    if (!/^codex_hooks\s*=/m.test(content)) missing.push('codex_hooks = true');
    if (missing.length > 0) {
      content = content.replace(/(\[features\])(?:\r?\n|$)/, '$1\r\n' + missing.join('\r\n') + '\r\n');
    }
  } else {
    const trimmed = content.trim();
    content = (trimmed ? trimmed + '\n\n' : '') + '[features]\nhooks = true\ncodex_hooks = true\n';
  }
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(configPath, content, 'utf8');
}
/**
 * 注入 rules 到 AGENTS.md 托管区（Codex/dsh 平台共用——AGENTS.md 是两平台指令
 * 唯一自动加载路径；.codex/rules/ 是命令批准规则目录，不混用）。
 * 读现有 AGENTS.md（缺失 → 空）→ 移除旧托管区（幂等）→ 托管区内联 orchestration 全文
 * → 保留托管区外用户内容 → 写回。托管区标记不变（任一平台卸载可清，另一平台重装恢复）。
 * `rulesSrc` 由调用方给出（本模块不推导仓库路径——那会与 installer-platforms 形成循环依赖）。
 */
export function injectManagedRules(target, stats, rulesSrc) {
  if (!fs.existsSync(rulesSrc)) return false;
  const rulesFile = path.join(rulesSrc, 'flow-comet-orchestration.md');
  if (!fs.existsSync(rulesFile)) return false;
  const rulesText = fs.readFileSync(rulesFile, 'utf8');
  const agentsPath = path.join(target, 'AGENTS.md');
  let existing = '';
  try {
    existing = fs.readFileSync(agentsPath, 'utf8');
  } catch { /* 文件缺失 = 首次安装 */ }
  const stripped = stripManagedBlock(existing, MANAGED_AGENTS_START, MANAGED_AGENTS_END);
  const managedBlock =
    MANAGED_AGENTS_START + '\n' +
    rulesText.trim() + '\n' +
    MANAGED_AGENTS_END + '\n';
  const merged = (stripped.trim() ? stripped.trim() + '\n\n' : '') + managedBlock;
  fs.writeFileSync(agentsPath, merged, 'utf8');
  stats.files++;
  return true;
}
/**
 * 移除 .codex/hooks.json 中的托管 hook 条目（purge 语义：移除而非注入——保留用户条目；
 * 重建流程会重新注入新托管条目）。文件非法 JSON 时不动（保护用户配置）。
 */
export function removeManagedCodexHooks(codexDir) {
  const hooksPath = path.join(codexDir, 'hooks.json');
  if (!fs.existsSync(hooksPath)) return;
  let hooks;
  try {
    hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  } catch { return; } // 非法 JSON 不触碰（保护用户配置）
  const outer = hooks && typeof hooks === 'object' && !Array.isArray(hooks) ? hooks : {};
  const inner = outer.hooks && typeof outer.hooks === 'object' && !Array.isArray(outer.hooks) ? outer.hooks : {};
  if (!Array.isArray(inner.PreToolUse)) return;
  inner.PreToolUse = inner.PreToolUse
    .map((group) => (
      group && typeof group === 'object' && !Array.isArray(group) && Array.isArray(group.hooks)
        ? { ...group, hooks: group.hooks.filter((hook) => !isManagedHookCommand(hook && hook.command)) }
        : group
    ))
    .filter((group) => group && typeof group === 'object' && Array.isArray(group.hooks) && group.hooks.length > 0);
  outer.hooks = inner;
  fs.writeFileSync(hooksPath, JSON.stringify(outer, null, 2) + '\n', 'utf8');
}
// ---------- dsh 平台注入 ----------

/**
 * $DSH_HOME 解析（dsh 平台——与 dsh CLI 同款默认）：显式 DSH_HOME 环境变量 > ~/.dsh。
 */
export function resolveDshHome() {
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME);
  return path.join(os.homedir(), '.dsh');
}
