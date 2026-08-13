#!/usr/bin/env node
/**
 * prepare-env.mjs — flow-comet 环境安装脚本（T-FIX-08 创建 / T-FIX-13 非破坏化 / 1.4.0 多平台化）
 *
 * 用途：从权威源 `.comet/bundle-drafts/flow-comet/` 安装/更新目标仓库的环境，
 *   使目标环境获得完整约束——rules 行为层 + hook 物理层 + skills 协议层。
 *   这是 flow-comet 的**安装器**：适用于新项目安装 flow-comet、e2e 验证载体准备、
 *   源仓库自我改进 worktree 环境准备。
 *
 * 多平台（1.4.0）：平台描述符表 PLATFORMS 驱动——claude-code(默认,现状语义)
 *   + codex(新增)。平台差异：技能安装位置 / SKILL 命令路径替换 / rules 注入方式
 *   (CC=.claude/rules 自动加载;Codex=.codex/rules 为命令批准规则目录,指令走
 *   AGENTS.md 托管区) / hook 配置位置与输出契约(CC=settings.local.json 文本输出;
 *   Codex=.codex/hooks.json JSON schema 输出)。
 *
 * 非破坏设计（T-FIX-13，2026-08-08 用户裁决）：
 *   - 默认（无 --purge）：**不删除整个 .claude/（或 .agents/）**——只精确覆盖生成物
 *     （rules/ + skills/ 等），保留其他一切内容（commands/、自定义 hook、自定义 skill）。
 *   - settings.local.json / .codex/hooks.json 采用**注入**方式：读现有配置 → 保留已有
 *     字段 → 过滤已管理的 comet hook → 合并新 hook → 写回。不覆盖用户已有配置。
 *   - 显式 `--purge` 参数才允许删除生成物（打印删除清单 + 警告 + 需 --yes 二次确认）。
 *   - 覆盖前打印将覆盖的生成物清单。
 *
 * 幂等：默认模式重复运行——rules/skills 覆盖一致；settings/hooks 注入幂等
 *   （已管理的 comet-hook-guard 命令被过滤后重新合并，不产生重复条目）；
 *   AGENTS.md 托管区幂等替换（移除旧托管区后重新生成）。
 *
 * 用法：node scripts/prepare-env.mjs [--target <dir>] [--platform <claude-code|codex>] [--purge --yes]
 *   --target 缺省 = 当前工作目录（cwd）。脚本自身定位：__dirname 上一级 = 仓库根
 *   （scripts/ 与 .comet/ 同级），据此解析权威源。
 *   --platform 显式指定平台；缺省走选择链：TTY 交互选择 > 探测目标项目
 *   (.codex/ → codex；.claude/ → claude-code) > 默认 claude-code。
 *   --purge 破坏性：删除目标平台生成物后重新生成（打印清单 + 警告 + --yes 确认）。
 *
 * 输出：打印生成摘要（平台 / 目录数 / 文件数 / skills 数 / 注入状态），exit 0；失败 exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BUNDLE_DRAFTS = path.join(REPO_ROOT, '.comet', 'bundle-drafts', 'flow-comet');

// comet-hook-guard 的 command 特征（用于识别"已管理的 hook 命令"，注入时替换避免重复）
const MANAGED_HOOK_COMMAND_MARKER = 'comet-hook-guard.mjs';

// AGENTS.md 托管区标记（Codex 平台 rules 注入——幂等替换边界）
const MANAGED_AGENTS_START = '<!-- Managed by flow-comet prepare-env -->';
const MANAGED_AGENTS_END = '<!-- /Managed by flow-comet prepare-env -->';

// ---------- 平台描述符表（单一来源——新增平台 = 新增条目） ----------

const PLATFORMS = {
  'claude-code': {
    label: 'Claude Code',
    // 技能安装根（相对 target；与权威源 .claude 形态一致——零路径替换）
    skillRoot: (target) => path.join(target, '.claude', 'skills'),
    // 平台路径替换表（from 正则 → to）：claude-code 为空 = 权威源即目标形态
    pathReplacements: [],
    // hook 配置目录（用于 purge 清理与覆盖清单）
    hookConfigDir: (target) => path.join(target, '.claude'),
    // 生成物根（purge 清理范围；CC 整删 .claude/——既有语义）
    purgeRoot: (target) => path.join(target, '.claude'),
  },
  'codex': {
    label: 'Codex',
    // 技能安装根：Codex 自动发现位置（$CWD/.agents/skills/ 最高优先）
    skillRoot: (target) => path.join(target, '.agents', 'skills'),
    // SKILL/GUIDANCE 命令路径平台化替换（权威源保持 .claude 形态，安装时替换）
    pathReplacements: [
      { from: /\.claude\/skills\/flow-comet\/scripts\//g, to: '.agents/skills/flow-comet/scripts/' },
    ],
    hookConfigDir: (target) => path.join(target, '.codex'),
    // purge 清理范围：.agents/(Codex 技能区)+ .codex/hooks.json(托管)+ AGENTS.md 托管区(保留文件本身)
    purgeRoot: (target) => path.join(target, '.agents'),
  },
};

// ---------- 平台选择 ----------

function parseArgs(argv) {
  const args = argv.slice(2);
  let target = null;
  let purge = false;
  let yes = false;
  let platform = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--target') {
      if (i + 1 >= args.length) {
        throw new Error('--target 缺少目录参数');
      }
      target = args[++i];
    } else if (a.startsWith('--target=')) {
      target = a.slice('--target='.length);
    } else if (a === '--platform') {
      if (i + 1 >= args.length) {
        throw new Error('--platform 缺少平台参数');
      }
      platform = args[++i];
    } else if (a.startsWith('--platform=')) {
      platform = a.slice('--platform='.length);
    } else if (a === '--purge') {
      purge = true;
    } else if (a === '--yes') {
      yes = true;
    } else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${a}`);
    }
  }
  return { target: target ? path.resolve(target) : process.cwd(), purge, yes, platform };
}

function printUsage() {
  console.log('用法: node scripts/prepare-env.mjs [--target <dir>] [--platform <claude-code|codex>] [--purge --yes]');
  console.log('  从权威源 .comet/bundle-drafts/flow-comet/ 安装/更新 <dir> 环境');
  console.log('  --target 缺省 = 当前工作目录（cwd）');
  console.log('  --platform 指定平台（claude-code / codex）；缺省 = TTY 交互选择 > 探测目标项目 > 默认 claude-code');
  console.log('  --purge   破坏性：先删除目标平台生成物再重新生成（默认不删除；需 --yes 确认）');
}

// 探测目标项目既有平台痕迹（.codex/ 优先——新平台安装后再次安装保持选择）
function probePlatform(target) {
  if (fs.existsSync(path.join(target, '.codex'))) return 'codex';
  if (fs.existsSync(path.join(target, '.claude'))) return 'claude-code';
  return null;
}

// TTY 交互选择（缺省路径——用户裁决：交互式选择为主；无 TTY 自动走探测/默认）。
// 探测结果影响默认值：检测到 .codex/ 痕迹时回车默认 Codex（而非恒默认 Claude Code）。
async function promptPlatformSelection(probe) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const defaultChoice = probe === 'codex' ? 'codex' : 'claude-code';
    const defaultLabel = probe === 'codex' ? 'Codex' : 'Claude Code';
    const probeNote = probe
      ? `（检测到目标项目已有 ${probe === 'codex' ? '.codex/' : '.claude/'} 痕迹——默认 ${defaultLabel}）`
      : '';
    const answer = await rl.question(
      `[prepare-env] 选择安装平台 ${probeNote}:\n` +
      `  1) Claude Code${defaultChoice === 'claude-code' ? '（默认）' : ''}\n` +
      `  2) Codex${defaultChoice === 'codex' ? '（默认）' : ''}\n` +
      `  输入序号或回车（默认 ${defaultChoice === 'codex' ? '2' : '1'}）: `
    );
    const choice = String(answer ?? '').trim().toLowerCase();
    if (choice === '') return defaultChoice;
    if (choice === '2' || choice === 'codex') return 'codex';
    return 'claude-code';
  } finally {
    rl.close();
  }
}

// 平台解析链：--platform 显式 > TTY 交互 > 探测 > 默认 claude-code
async function resolvePlatform(target, platformArg) {
  if (platformArg) {
    if (!PLATFORMS[platformArg]) {
      throw new Error(`未知平台: ${platformArg}（可用: ${Object.keys(PLATFORMS).join(', ')}）`);
    }
    return PLATFORMS[platformArg];
  }
  if (process.stdin.isTTY) {
    const selected = await promptPlatformSelection(probePlatform(target));
    return PLATFORMS[selected];
  }
  const probe = probePlatform(target);
  return PLATFORMS[probe ?? 'claude-code'];
}

// ---------- 文件工具 ----------

/** 递归收集 srcDir 下所有目录与文件的绝对路径 */
function collect(srcDir) {
  const dirs = [];
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(abs);
        walk(abs);
      } else if (entry.isFile()) {
        files.push(abs);
      }
    }
  })(srcDir);
  return { dirs, files };
}

/** 整树复制 srcDir → dstRoot（保持相对结构），计数写入 stats */
function copyTree(srcDir, dstRoot, stats) {
  fs.mkdirSync(dstRoot, { recursive: true });
  stats.dirs++;
  const { dirs, files } = collect(srcDir);
  for (const d of dirs) {
    fs.mkdirSync(path.join(dstRoot, path.relative(srcDir, d)), { recursive: true });
    stats.dirs++;
  }
  for (const f of files) {
    fs.copyFileSync(f, path.join(dstRoot, path.relative(srcDir, f)));
    stats.files++;
  }
}

/**
 * 平台路径替换：对复制后的技能包内全部 .md 文件（SKILL/GUIDANCE/reference）做命令路径替换。
 * 权威源保持 .claude 形态；claude-code 平台替换表为空（零改动，可复现性 diff 不变）。
 * 幂等：同平台重复安装替换结果一致。
 */
function applyPathReplacements(root, replacements) {
  if (!replacements || replacements.length === 0) return 0;
  let replaced = 0;
  const { files } = collect(root);
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    let content = fs.readFileSync(f, 'utf8');
    const original = content;
    for (const { from, to } of replacements) {
      content = content.replace(from, to);
    }
    if (content !== original) {
      fs.writeFileSync(f, content, 'utf8');
      replaced++;
    }
  }
  return replaced;
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
  // 提取命令中的脚本路径（node <path> 或直接 <path>）
  const pathMatch = normalized.match(/(?:^|\s)([^\s]+\.mjs)(?:\s|$)/);
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
    return { ...group, hooks: group.hooks.filter((hook) => !isManagedHookCommand(hook && hook.command)) };
  });
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
function injectSettingsHook(claudeDir) {
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
    matcher: 'Write|Edit',
    hooks: [
      {
        type: 'command',
        command: 'node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs',
      },
    ],
  };
  if (existingHooks.PreToolUse !== undefined && !Array.isArray(existingHooks.PreToolUse)) {
    // PreToolUse 非数组（手写变体）：保留原值 + 警告，不注入（避免破坏用户结构）
    console.error(
      '[prepare-env] 警告: settings.local.json 的 hooks.PreToolUse 不是数组（可能是手写变体）——' +
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

// ---------- Codex 平台注入 ----------

/**
 * 注入 comet hook 到 .codex/hooks.json（Codex 平台）：
 * 读现有 hooks（缺失 → {}）→ 过滤已管理 comet hook（命令含 comet-hook-guard.mjs）→
 * 合并新组（matcher "*"——Codex PreToolUse 只拦截 Bash 工具,写路径经 PowerShell/Bash 命令,
 * 必须匹配所有 Bash 调用;命令带 --platform codex 平台标记）→ 写回。
 * 结构：顶层 "hooks" 包裹层（Codex 与 Claude Code 同构——{"hooks":{"PreToolUse":[...]}};
 * 实测缺包裹层 hook 不加载）。
 * fail-safe：文件存在但 JSON 非法 → 抛错退出（保护用户配置）。
 */
function injectCodexHook(codexDir) {
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
  const newGroup = {
    matcher: '*',
    hooks: [
      {
        type: 'command',
        command: 'node .agents/skills/flow-comet/scripts/comet-hook-guard.mjs before_tool --platform codex',
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
function injectCodexConfig(codexDir) {
  const configPath = path.join(codexDir, 'config.toml');
  let content = '';
  try {
    content = fs.readFileSync(configPath, 'utf8');
  } catch { /* 文件缺失 = 首次安装 */ }
  if (content.includes('[features]')) {
    // 已有 [features] 段:补 hooks 键(未设置时)
    if (!/^hooks\s*=/m.test(content)) {
      content = content.replace(/\[features\]\n/, '[features]\nhooks = true\n');
    }
    if (!/^codex_hooks\s*=/m.test(content)) {
      content = content.replace(/\[features\]\n/, '[features]\ncodex_hooks = true\n');
    }
  } else {
    const trimmed = content.trim();
    content = (trimmed ? trimmed + '\n\n' : '') + '[features]\nhooks = true\ncodex_hooks = true\n';
  }
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(configPath, content, 'utf8');
}

/**
 * 注入 rules 到 AGENTS.md 托管区（Codex 平台——指令唯一自动加载路径）。
 * 读现有 AGENTS.md（缺失 → 空）→ 移除旧托管区（幂等）→ 托管区内联 orchestration 全文
 * → 保留托管区外用户内容 → 写回。
 * 注：.codex/rules/ 是命令批准规则目录（prefix_rule 格式，与指令语义不同）——不混用。
 */
function injectCodexRules(target, stats) {
  const rulesSrc = path.join(BUNDLE_DRAFTS, 'rules');
  if (!fs.existsSync(rulesSrc)) return false;
  const rulesFile = path.join(rulesSrc, 'flow-comet-orchestration.md');
  if (!fs.existsSync(rulesFile)) return false;
  const rulesText = fs.readFileSync(rulesFile, 'utf8');
  const agentsPath = path.join(target, 'AGENTS.md');
  let existing = '';
  try {
    existing = fs.readFileSync(agentsPath, 'utf8');
  } catch { /* 文件缺失 = 首次安装 */ }
  const stripped = existing.replace(
    new RegExp(escapeRegExp(MANAGED_AGENTS_START) + '[\\s\\S]*?' + escapeRegExp(MANAGED_AGENTS_END) + '\\n?'),
    ''
  );
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
function removeManagedCodexHooks(codexDir) {
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

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

// ---------- 版本标识（两平台共用） ----------

/**
 * 版本标识:优先从源仓库 git describe 生成(多人协作精确检测——发布版 = 精确 tag,
 * 开发态 = "<tag>-<领先提交数>-g<hash>",提 issue 时维护者可据此判断包含哪些积累);
 * 无 git(纯手动复制兜底)时用权威源随技能包分发的 INSTALLED_VERSION(最近发布版本)。
 */
function resolveInstalledVersion() {
  let installedVersion = '';
  try {
    const desc = execFileSync('git', ['describe', '--tags'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000 }).trim();
    if (desc) installedVersion = desc.replace(/^v/, ''); // 剥 v 前缀,与 CHANGELOG 版本号一致
  } catch { /* 无 tag 或非 git 仓库:回退权威源文件 */ }
  if (!installedVersion) {
    const bundled = path.join(BUNDLE_DRAFTS, 'skills', 'flow-comet', 'INSTALLED_VERSION');
    if (fs.existsSync(bundled)) installedVersion = fs.readFileSync(bundled, 'utf8').trim();
  }
  return installedVersion;
}

// ---------- 主流程 ----------

async function main() {
  const { target, purge, yes, platform: platformArg } = parseArgs(process.argv);
  const platform = await resolvePlatform(target, platformArg);
  const skillsSrc = path.join(BUNDLE_DRAFTS, 'skills');
  if (!fs.existsSync(skillsSrc)) {
    throw new Error(`权威源 skills 目录不存在: ${skillsSrc}`);
  }

  const isClaudeCode = platform === PLATFORMS['claude-code'];
  const skillRoot = platform.skillRoot(target);
  const stats = { dirs: 0, files: 0, skills: [] };

  // --purge：必须配合 --yes 二次确认（防误传导致整删）；删除平台生成物后重新生成
  if (purge) {
    if (!yes) {
      throw new Error('--purge 是破坏性操作，需显式 --yes 确认：node scripts/prepare-env.mjs --target <dir> --platform <id> --purge --yes');
    }
    console.error(`[prepare-env] 警告: --purge 将删除 ${platform.label} 平台的以下生成物（不可恢复）：`);
    if (isClaudeCode) {
      const claudeDir = platform.purgeRoot(target);
      if (fs.existsSync(claudeDir)) {
        for (const entry of fs.readdirSync(claudeDir)) {
          console.error(`  - ${path.join(claudeDir, entry)}`);
        }
        fs.rmSync(claudeDir, { recursive: true, force: true });
      }
    } else {
      const agentsDir = platform.purgeRoot(target);
      if (fs.existsSync(agentsDir)) {
        for (const entry of fs.readdirSync(agentsDir)) {
          console.error(`  - ${path.join(agentsDir, entry)}`);
        }
        fs.rmSync(agentsDir, { recursive: true, force: true });
      }
      const hooksPath = path.join(target, '.codex', 'hooks.json');
      if (fs.existsSync(hooksPath)) {
        console.error(`  - ${hooksPath}（移除托管 hook 条目,保留用户条目）`);
        // 移除托管条目（重建流程随后重新注入新托管条目——purge = 移除旧生成物后重建）
        removeManagedCodexHooks(path.join(target, '.codex'));
      }
      const agentsPath = path.join(target, 'AGENTS.md');
      if (fs.existsSync(agentsPath)) {
        const content = fs.readFileSync(agentsPath, 'utf8');
        if (content.includes(MANAGED_AGENTS_START)) {
          console.error(`  - ${agentsPath}（托管区）`);
          const stripped = content.replace(
            new RegExp(escapeRegExp(MANAGED_AGENTS_START) + '[\\s\\S]*?' + escapeRegExp(MANAGED_AGENTS_END) + '\\n?'),
            ''
          );
          fs.writeFileSync(agentsPath, stripped.trim() + '\n', 'utf8');
        }
      }
    }
    console.error('[prepare-env] 已删除，开始重新生成。');
  }

  // 覆盖前打印将覆盖的生成物清单（默认非破坏：只覆盖生成物）
  console.log(`[prepare-env] 平台: ${platform.label} — 将覆盖以下生成物（其他内容保留）：`);
  console.log(`  - ${skillRoot}`);
  if (isClaudeCode) {
    console.log(`  - ${path.join(target, '.claude', 'rules')}`);
    console.log(`  - ${path.join(target, '.claude', 'settings.local.json')}（注入方式：保留既有字段，仅更新 hooks.PreToolUse）`);
  } else {
    console.log(`  - ${path.join(target, 'AGENTS.md')}（托管区注入：保留托管区外用户内容）`);
    console.log(`  - ${path.join(target, '.codex', 'hooks.json')}（注入方式：保留既有字段，仅更新托管 hook 条目）`);
    console.log(`  - ${path.join(target, '.codex', 'config.toml')}（注入方式：补 [features] hooks 启用键）`);
  }

  // 1. hook 注入（平台化）
  if (isClaudeCode) {
    const claudeDir = path.join(target, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    stats.dirs++;
    const settings = injectSettingsHook(claudeDir);
    const injected = !!(settings.hooks && settings.hooks.PreToolUse);
    stats.files++;
    console.log(`[prepare-env] settings.local.json ${injected ? '注入完成（保留既有字段）' : '已生成'}`);
  } else {
    const codexDir = path.join(target, '.codex');
    injectCodexHook(codexDir);
    injectCodexConfig(codexDir);
    stats.files += 2;
    console.log('[prepare-env] .codex/hooks.json + config.toml 注入完成（hooks 启用，保留既有字段）');
  }

  // 2. rules 注入（平台化：CC 复制到 .claude/rules/ 自动加载；Codex 走 AGENTS.md 托管区）
  if (isClaudeCode) {
    const rulesSrc = path.join(BUNDLE_DRAFTS, 'rules');
    if (fs.existsSync(rulesSrc)) {
      copyTree(rulesSrc, path.join(target, '.claude', 'rules'), stats);
    }
  } else {
    if (injectCodexRules(target, stats)) {
      console.log('[prepare-env] AGENTS.md 托管区注入完成（保留托管区外用户内容）');
    }
  }

  // 3. skills/（复制全部 flow-comet* 目录 + 平台路径替换）
  const skillNames = fs
    .readdirSync(skillsSrc, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^flow-comet/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (skillNames.length === 0) {
    throw new Error(`权威源中未找到任何 flow-comet* skill 目录: ${skillsSrc}`);
  }
  for (const name of skillNames) {
    copyTree(path.join(skillsSrc, name), path.join(skillRoot, name), stats);
    stats.skills.push(name);
  }
  const replacedFiles = applyPathReplacements(skillRoot, platform.pathReplacements);
  if (replacedFiles > 0) {
    console.log(`[prepare-env] 平台路径替换: ${replacedFiles} 个 .md 文件（${platform.label} 命令路径）`);
  }

  // 4. 版本标识（写入平台技能根,随技能包分发）
  const installedVersion = resolveInstalledVersion();
  fs.writeFileSync(path.join(skillRoot, 'flow-comet', 'INSTALLED_VERSION'), installedVersion + '\n', 'utf8');
  stats.files++;

  // 摘要
  console.log(`[prepare-env] 已准备环境: ${target}（${platform.label}）`);
  console.log(
    `[prepare-env] 目录 ${stats.dirs} 个、文件 ${stats.files} 个、skills ${stats.skills.length} 个`
  );
  console.log(`[prepare-env] skills: ${stats.skills.join(', ')}`);
}

try {
  await main();
} catch (err) {
  console.error(`[prepare-env] 错误: ${err.message}`);
  process.exit(1);
}
