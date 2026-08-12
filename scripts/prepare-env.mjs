#!/usr/bin/env node
/**
 * prepare-env.mjs — flow-comet 环境安装脚本（T-FIX-08 创建 / T-FIX-13 非破坏化）
 *
 * 用途：从权威源 `.comet/bundle-drafts/flow-comet/` 安装/更新目标仓库的 `.claude/` 环境，
 *   使目标环境获得完整约束——rules 行为层 + hook 物理层 + skills 协议层。
 *   这是 flow-comet 的**安装器**：适用于新项目安装 flow-comet、e2e 验证载体准备、
 *   源仓库自我改进 worktree 环境准备。
 *
 * 非破坏设计（T-FIX-13，2026-08-08 用户裁决）：
 *   - 默认（无 --purge）：**不删除整个 .claude/**——只精确覆盖生成物
 *     （rules/ + skills/），保留 .claude/ 下其他一切内容（commands/、自定义 hook、
 *     自定义 skill、其他文件）。
 *   - settings.local.json 采用**注入**方式（参考 comet installClaudeCodeHooks）：
 *     读现有 settings → 保留已有字段（permissions 等）→ 过滤已管理的 comet hook →
 *     按 matcher 合并新 hook → 只更新 hooks.PreToolUse → 写回。不覆盖用户已有配置。
 *   - 显式 `--purge` 参数才允许删除整个 .claude/（打印删除清单 + 警告）。
 *   - 覆盖前打印将覆盖的生成物清单。
 *
 * 幂等：默认模式重复运行——rules/skills 覆盖一致；settings 注入幂等
 * （已管理的 comet-hook-guard 命令被过滤后重新合并，不产生重复条目）。
 *
 * 用法：node scripts/prepare-env.mjs [--target <dir>] [--purge]
 *   --target 缺省 = 当前工作目录（cwd）。脚本自身定位：__dirname 上一级 = 仓库根
 *   （scripts/ 与 .comet/ 同级），据此解析权威源。
 *   --purge 破坏性：删除目标 .claude/ 全部内容后重新生成（打印清单 + 警告）。
 *
 * 输出：打印生成摘要（目录数 / 文件数 / skills 数 / settings 注入状态），exit 0；失败 exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BUNDLE_DRAFTS = path.join(REPO_ROOT, '.comet', 'bundle-drafts', 'flow-comet');

// comet-hook-guard 的 command 特征（用于识别"已管理的 hook 命令"，注入时替换避免重复）
const MANAGED_HOOK_COMMAND_MARKER = 'comet-hook-guard.mjs';

function printUsage() {
  console.log('用法: node scripts/prepare-env.mjs [--target <dir>] [--purge]');
  console.log('  从权威源 .comet/bundle-drafts/flow-comet/ 安装/更新 <dir>/.claude/ 环境');
  console.log('  --target 缺省 = 当前工作目录（cwd）');
  console.log('  --purge   破坏性：先删除 <dir>/.claude/ 全部内容再重新生成（默认不删除）');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let target = null;
  let purge = false;
  let yes = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--target') {
      if (i + 1 >= args.length) {
        throw new Error('--target 缺少目录参数');
      }
      target = args[++i];
    } else if (a.startsWith('--target=')) {
      target = a.slice('--target='.length);
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
  return { target: target ? path.resolve(target) : process.cwd(), purge, yes };
}

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

// ---------- settings.local.json 注入（参考 comet installClaudeCodeHooks） ----------

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
 * 注入 comet hook 到 settings.local.json：
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

function main() {
  const { target, purge, yes } = parseArgs(process.argv);
  const skillsSrc = path.join(BUNDLE_DRAFTS, 'skills');
  if (!fs.existsSync(skillsSrc)) {
    throw new Error(`权威源 skills 目录不存在: ${skillsSrc}`);
  }

  const claudeDir = path.join(target, '.claude');
  const stats = { dirs: 0, files: 0, skills: [] };

  // --purge：必须配合 --yes 二次确认（防误传导致整删）
  if (purge) {
    if (!yes) {
      throw new Error('--purge 是破坏性操作，需显式 --yes 确认：node scripts/prepare-env.mjs --target <dir> --purge --yes');
    }
    if (fs.existsSync(claudeDir)) {
      console.error('[prepare-env] 警告: --purge 将删除以下目录的全部内容（含用户自定义文件，不可恢复）：');
      for (const entry of fs.readdirSync(claudeDir)) {
        console.error(`  - ${path.join(claudeDir, entry)}`);
      }
      fs.rmSync(claudeDir, { recursive: true, force: true });
      console.error('[prepare-env] 已删除，开始重新生成。');
    }
  }

  // 覆盖前打印将覆盖的生成物清单（默认非破坏：只覆盖 rules/ + skills/）
  console.log('[prepare-env] 将覆盖以下生成物（.claude/ 其他内容保留）：');
  console.log(`  - ${path.join(claudeDir, 'rules')}`);
  console.log(`  - ${path.join(claudeDir, 'skills')}`);
  console.log(`  - ${path.join(claudeDir, 'settings.local.json')}（注入方式：保留既有字段，仅更新 hooks.PreToolUse）`);

  // 1. settings.local.json（注入，参考 comet：读-合并-写，保留已有字段）
  fs.mkdirSync(claudeDir, { recursive: true });
  stats.dirs++;
  const settings = injectSettingsHook(claudeDir);
  const injected = !!(settings.hooks && settings.hooks.PreToolUse);
  stats.files++;
  console.log(`[prepare-env] settings.local.json ${injected ? '注入完成（保留既有字段）' : '已生成'}`);

  // 2. rules/（整目录复制：rules 行为层）
  const rulesSrc = path.join(BUNDLE_DRAFTS, 'rules');
  if (fs.existsSync(rulesSrc)) {
    copyTree(rulesSrc, path.join(claudeDir, 'rules'), stats);
  }

  // 3. skills/（复制全部 flow-comet* 目录：skills 协议层）
  const skillNames = fs
    .readdirSync(skillsSrc, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^flow-comet/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (skillNames.length === 0) {
    throw new Error(`权威源中未找到任何 flow-comet* skill 目录: ${skillsSrc}`);
  }
  for (const name of skillNames) {
    copyTree(path.join(skillsSrc, name), path.join(claudeDir, 'skills', name), stats);
    stats.skills.push(name);
  }

  // 3.5. 版本标识:优先从源仓库 git describe 生成(多人协作精确检测——发布版 = 精确 tag,
  //      开发态 = "<tag>-<领先提交数>-g<hash>",提 issue 时维护者可据此判断包含哪些积累);
  //      无 git(纯手动复制兜底)时用权威源随技能包分发的 INSTALLED_VERSION(最近发布版本)。
  let installedVersion = '';
  try {
    const desc = execFileSync('git', ['describe', '--tags'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000 }).trim();
    if (desc) installedVersion = desc.replace(/^v/, ''); // 剥 v 前缀,与 CHANGELOG 版本号一致
  } catch { /* 无 tag 或非 git 仓库:回退权威源文件 */ }
  if (!installedVersion) {
    const bundled = path.join(skillsSrc, 'flow-comet', 'INSTALLED_VERSION');
    if (fs.existsSync(bundled)) installedVersion = fs.readFileSync(bundled, 'utf8').trim();
  }
  fs.writeFileSync(path.join(claudeDir, 'skills', 'flow-comet', 'INSTALLED_VERSION'), installedVersion + '\n', 'utf8');
  stats.files++;

  // 摘要
  console.log(`[prepare-env] 已准备环境: ${claudeDir}`);
  console.log(
    `[prepare-env] 目录 ${stats.dirs} 个、文件 ${stats.files} 个、skills ${stats.skills.length} 个`
  );
  console.log(`[prepare-env] skills: ${stats.skills.join(', ')}`);
}

try {
  main();
} catch (err) {
  console.error(`[prepare-env] 错误: ${err.message}`);
  process.exit(1);
}
