#!/usr/bin/env node
/**
 * prepare-env.mjs — flow-comet 环境安装脚本（T-FIX-08 创建 / T-FIX-13 非破坏化 / 1.4.0 多平台化）
 *
 * 用途：从权威源 `.comet/bundle-drafts/flow-comet/` 安装/更新目标仓库的环境，
 *   使目标环境获得完整约束——rules 行为层 + hook 物理层 + skills 协议层。
 *   这是 flow-comet 的**安装器**：适用于新项目安装 flow-comet、e2e 验证载体准备、
 *   源仓库自我改进 worktree 环境准备。
 *
 * 多平台（1.4.0 / dsh 扩展）：平台描述符表 PLATFORMS 驱动——claude-code(默认,现状语义)
 *   + codex + dsh(新增)。平台差异全部封装在描述符条目内：技能安装位置 skillRoot /
 *   SKILL 命令路径替换 pathReplacements / hook 注入 installHooks
 *   (CC=settings.local.json;Codex=.codex/hooks.json + config.toml 启用;
 *   dsh=$DSH_HOME/plugins/ 桥接 loader + cordis.patch.yml 托管块——全局挂载) / rules 注入
 *   installRules (CC=.claude/rules 自动加载;Codex/.dsh=AGENTS.md 托管区共用注入,
 *   .codex/rules 为命令批准规则目录,不混用) / 清理 purge / 覆盖清单 overwriteDescription——
 *   main 统一调度,新增平台 = 描述符条目 + 安装/清理函数,main 零改动。
 *
 * hook 命令项目根锚定:CC 命令引用 CC 注入的 CLAUDE_PROJECT_DIR 运行期展开(Windows cmd.exe
 *   %VAR% / POSIX $VAR,单一来源常量派生,见 PROJECT_ROOT_ENV_VAR);Codex 官方 hooks 无等价
 *   项目根变量(查证 openai/codex 上游执行层,结论与出处见 injectCodexHook 注释)→ 安装期
 *   字面注入 target 绝对路径(迁移目录需重跑安装器)。两平台命令均不加外层引号,以保住
 *   isManagedHookCommand 的 basename 幂等识别(含空格路径不支持,见常量区取舍说明)。
 *
 * 非破坏设计（T-FIX-13，2026-08-08 用户裁决）：
 *   - 默认（无 --purge）：**不删除整个 .claude/（或 .agents/ / .dsh/）**——只精确覆盖生成物
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
 * 用法：node scripts/prepare-env.mjs [--target <dir>] [--platform <claude-code|codex|dsh|claude-code,dsh|all>] [--purge --yes]
 *   --target 缺省 = 当前工作目录（cwd）。脚本自身定位：__dirname 上一级 = 仓库根
 *   （scripts/ 与 .comet/ 同级），据此解析权威源。
 *   --platform 显式指定平台：单平台 / 逗号分隔多平台（claude-code,codex,dsh）/
 *   all（全部平台,安装顺序 = PLATFORMS 表顺序）；未知平台报错（旧 both 语义已移除——
 *   多平台用逗号列表或 all）；缺省走选择链：
 *     TTY 交互多选（@clack/prompts 方向键多选——可选依赖,未安装自动回退 readline
 *     数字/逗号多选;基于目标项目痕迹 .claude/ .codex/ .dsh/ 预勾选,回车默认 = 探测推荐）
 *     > 探测目标项目（仅 .codex/ → codex；仅 .dsh/ → dsh；含 .claude/ → claude-code；
 *     多痕迹默认 claude-code 并输出提示）> 默认 claude-code。
 *   --purge 破坏性：删除目标平台生成物后重新生成（打印清单 + 警告 + --yes 确认）。
 *
 * 输出：打印生成摘要（平台 / 目录数 / 文件数 / skills 数 / 注入状态），exit 0；失败 exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BUNDLE_DRAFTS = path.join(REPO_ROOT, '.comet', 'bundle-drafts', 'flow-comet');

// comet-hook-guard 的 command 特征（用于识别"已管理的 hook 命令"，注入时替换避免重复）
const MANAGED_HOOK_COMMAND_MARKER = 'comet-hook-guard.mjs';

// ---------- hook 命令项目根锚定（单一事实来源） ----------
// Claude Code 运行 hook 时注入 CLAUDE_PROJECT_DIR 环境变量（值 = 项目根绝对路径，官方 hooks
// 文档契约）。变量名是唯一事实来源，展开语法按宿主 OS 的 hook shell 派生：
//   Windows：hook 经 cmd.exe 执行 → %VAR%（cmd.exe 原生展开）
//   POSIX  ：sh 系执行 → $VAR
// 本安装器装在本机（安装机 = 目标机），process.platform 即 hook 的执行平台。
const PROJECT_ROOT_ENV_VAR = 'CLAUDE_PROJECT_DIR';

// 两平台 hook 命令一律不加外层引号（已知取舍）：isManagedHookCommand 按空白分词提取 .mjs
// token 后取 basename 判等（本任务契约：该函数保持不动），外层引号会并入 token 使 basename
// 变成 comet-hook-guard.mjs" 而识别失效，破坏幂等升级（旧相对条目将无法被过滤替换）。
// 代价：项目根路径含空格时，未加引号的命令在空格处断裂——设计允许实施期按三平台实测
// 微调引号策略，此处以幂等识别优先；含空格路径暂不支持（需先演进识别函数再放开引号）。
function projectRootGuardScriptRef(rootDirName) {
  const isWindows = process.platform === 'win32';
  const sep = isWindows ? '\\' : '/';
  const varRef = isWindows ? `%${PROJECT_ROOT_ENV_VAR}%` : `$${PROJECT_ROOT_ENV_VAR}`;
  const segments = [rootDirName, 'skills', 'flow-comet', 'scripts', MANAGED_HOOK_COMMAND_MARKER];
  return `${varRef}${sep}${segments.join(sep)}`;
}

// AGENTS.md 托管区标记（Codex/dsh 平台 rules 注入共用——幂等替换边界,任一平台卸载可清）
const MANAGED_AGENTS_START = '<!-- Managed by flow-comet prepare-env -->';
const MANAGED_AGENTS_END = '<!-- /Managed by flow-comet prepare-env -->';

// $DSH_HOME/cordis.patch.yml 托管块标记（dsh 平台 home patch 注入——幂等替换边界；
// 参照本机既有惯例：# --- dsh-skin managed --- ... # --- end dsh-skin managed ---）
const MANAGED_CORDIS_START = '# --- flow-comet managed ---';
const MANAGED_CORDIS_END = '# --- end flow-comet managed ---';

// ---------- 平台描述符表（单一来源——新增平台 = 描述符条目 + 安装/清理函数，main 零改动） ----------

const PLATFORMS = {
  'claude-code': {
    label: 'Claude Code',
    // 技能安装根（相对 target；与权威源 .claude 形态一致——零路径替换）
    skillRoot: (target) => path.join(target, '.claude', 'skills'),
    // 平台路径替换表（from 正则 → to）：claude-code 为空 = 权威源即目标形态
    pathReplacements: [],
    // hook 注入：settings.local.json 读-合并-写（保留既有字段；matcher Write|Edit）
    installHooks(target, stats) {
      const claudeDir = path.join(target, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      stats.dirs++;
      const settings = injectSettingsHook(claudeDir);
      const injected = !!(settings.hooks && settings.hooks.PreToolUse);
      stats.files++;
      console.log(`[prepare-env] settings.local.json ${injected ? '注入完成（保留既有字段）' : '已生成'}`);
    },
    // rules 注入：.claude/rules/ 整树复制（自动加载 markdown 指令）
    installRules(target, stats) {
      const rulesSrc = path.join(BUNDLE_DRAFTS, 'rules');
      if (fs.existsSync(rulesSrc)) {
        copyTree(rulesSrc, path.join(target, '.claude', 'rules'), stats);
      }
    },
    // purge 清理：整删 .claude/（CC 的 .claude 即 flow-comet 生成物域）；返回删除清单供打印
    purge(target) {
      const claudeDir = path.join(target, '.claude');
      const removed = [];
      if (fs.existsSync(claudeDir)) {
        for (const entry of fs.readdirSync(claudeDir)) {
          removed.push(path.join(claudeDir, entry));
        }
        fs.rmSync(claudeDir, { recursive: true, force: true });
      }
      return removed;
    },
    // 覆盖清单描述（默认非破坏：只覆盖生成物）
    overwriteDescription(target) {
      return [
        path.join(target, '.claude', 'rules'),
        path.join(target, '.claude', 'settings.local.json') + '（注入方式：保留既有字段，仅更新 hooks.PreToolUse）',
      ];
    },
  },
  'codex': {
    label: 'Codex',
    // 技能安装根：Codex 自动发现位置（$CWD/.agents/skills/ 最高优先）
    skillRoot: (target) => path.join(target, '.agents', 'skills'),
    // SKILL/GUIDANCE 命令路径平台化替换（权威源保持 .claude 形态，安装时替换）
    pathReplacements: [
      { from: /\.claude\/skills\/flow-comet\/scripts\//g, to: '.agents/skills/flow-comet/scripts/' },
    ],
    // hook 注入：.codex/hooks.json（顶层 hooks 包裹层 + matcher *）+ config.toml features 启用
    installHooks(target, stats) {
      const codexDir = path.join(target, '.codex');
      injectCodexHook(codexDir, target);
      injectCodexConfig(codexDir);
      stats.files += 2;
      console.log('[prepare-env] .codex/hooks.json + config.toml 注入完成（hooks 启用，保留既有字段）');
    },
    // rules 注入：AGENTS.md 托管区内联（Codex 指令唯一自动加载路径；.codex/rules/ 是命令批准规则目录，不混用；
    // 注入函数与托管区标记 codex/dsh 共用——任一平台卸载可清,另一平台重装恢复）
    installRules(target, stats) {
      if (injectManagedRules(target, stats)) {
        console.log('[prepare-env] AGENTS.md 托管区注入完成（保留托管区外用户内容）');
      }
    },
    // purge 清理：只清 flow-comet 技能（.agents/ 为多工具共享位置——非 flow-comet 条目保留）
    // + .codex/hooks.json 托管条目（保留用户条目）+ AGENTS.md 托管区（保留文件本身）
    purge(target) {
      const removed = [];
      const agentsSkillsDir = path.join(target, '.agents', 'skills');
      if (fs.existsSync(agentsSkillsDir)) {
        for (const entry of fs.readdirSync(agentsSkillsDir)) {
          if (!/^flow-comet/.test(entry)) continue;
          const managed = path.join(agentsSkillsDir, entry);
          removed.push(managed);
          fs.rmSync(managed, { recursive: true, force: true });
        }
      }
      const hooksPath = path.join(target, '.codex', 'hooks.json');
      if (fs.existsSync(hooksPath)) {
        removed.push(hooksPath + '（移除托管 hook 条目,保留用户条目）');
        // 移除托管条目（重建流程随后重新注入新托管条目——purge = 移除旧生成物后重建）
        removeManagedCodexHooks(path.join(target, '.codex'));
      }
      const agentsPath = path.join(target, 'AGENTS.md');
      if (fs.existsSync(agentsPath)) {
        const content = fs.readFileSync(agentsPath, 'utf8');
        if (content.includes(MANAGED_AGENTS_START)) {
          removed.push(agentsPath + '（托管区）');
          const stripped = stripManagedBlock(content, MANAGED_AGENTS_START, MANAGED_AGENTS_END);
          fs.writeFileSync(agentsPath, stripped.trim() + '\n', 'utf8');
        }
      }
      return removed;
    },
    // 覆盖清单描述（默认非破坏：只覆盖生成物）
    overwriteDescription(target) {
      return [
        path.join(target, 'AGENTS.md') + '（托管区注入：保留托管区外用户内容）',
        path.join(target, '.codex', 'hooks.json') + '（注入方式：保留既有字段，仅更新托管 hook 条目）',
        path.join(target, '.codex', 'config.toml') + '（注入方式：补 [features] hooks 启用键）',
      ];
    },
  },
  'dsh': {
    label: 'DeepSeek Harness',
    // 技能安装根：dsh 项目级 skill 发现（rank 100 自动发现,免重启；未安装该目录的项目不可见该 skill）
    skillRoot: (target) => path.join(target, '.dsh', 'skills'),
    // SKILL/GUIDANCE 命令路径平台化替换（权威源保持 .claude 形态,安装时替换）
    pathReplacements: [
      { from: /\.claude\/skills\/flow-comet\/scripts\//g, to: '.dsh/skills/flow-comet/scripts/' },
    ],
    // hook 注入：全局挂载桥接 loader（$DSH_HOME/plugins/ 复制 + cordis.patch.yml 托管块——
    // 所有 profile 生效；$DSH_HOME 解析 = 显式 DSH_HOME > ~/.dsh）
    installHooks(target, stats) {
      const dshHome = resolveDshHome();
      const pluginsDir = path.join(dshHome, 'plugins');
      const loaderSrc = path.join(REPO_ROOT, 'scripts', 'dsh-bridge.mjs');
      const loaderDst = path.join(pluginsDir, 'dsh-flow-comet-bridge.mjs');
      if (fs.existsSync(loaderSrc)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
        fs.copyFileSync(loaderSrc, loaderDst);
        stats.files++;
        console.log('[prepare-env] 桥接 loader 已复制到 $DSH_HOME/plugins/dsh-flow-comet-bridge.mjs');
        injectDshCordisPatch(dshHome, loaderDst);
        stats.files++;
        console.log('[prepare-env] $DSH_HOME/cordis.patch.yml 托管块注入完成（读-合并-写,保留既有块）');
      } else {
        // 容错：scripts/dsh-bridge.mjs 由并行任务新建——源缺失时 WARN 跳过 loader 复制
        // **并跳过 cordis.patch.yml 托管块注入**（避免注入指向不存在文件的 file:// 引用,
        // 导致 dsh 每次启动尝试加载不存在的插件）;仍完成其余安装
        // （AGENTS.md 托管区 / skills 复制照常）
        console.warn(
          '[prepare-env] 警告: scripts/dsh-bridge.mjs 不存在——跳过 loader 复制与 cordis.patch.yml 托管块注入' +
            '（dsh 桥接拦截暂不生效,待源文件就位后重跑 prepare-env）'
        );
      }
    },
    // rules 注入：AGENTS.md 托管区（与 codex 共用注入函数与托管区标记——任一平台卸载可清）
    installRules(target, stats) {
      if (injectManagedRules(target, stats)) {
        console.log('[prepare-env] AGENTS.md 托管区注入完成（保留托管区外用户内容）');
      }
    },
    // purge 清理：项目级 .dsh/skills 下全部 flow-comet* 技能（.dsh/skills 为 dsh 技能位置——
    // 非 flow-comet 条目保留,与 codex purge 同语义）+ 空 .dsh 目录 + AGENTS.md 托管区
    // （保留文件与用户内容）+ $DSH_HOME/cordis.patch.yml 托管块 + plugins/ loader
    // （写 home 的敏感面——purge 需 --yes 显式确认）
    purge(target) {
      const removed = [];
      const dshSkillsDir = path.join(target, '.dsh', 'skills');
      if (fs.existsSync(dshSkillsDir)) {
        for (const entry of fs.readdirSync(dshSkillsDir)) {
          if (!/^flow-comet/.test(entry)) continue;
          const managed = path.join(dshSkillsDir, entry);
          removed.push(managed);
          fs.rmSync(managed, { recursive: true, force: true });
        }
      }
      // 空目录清理：仅删空目录（skills 下无剩余条目 / .dsh 下无其它内容时）——有内容则保留
      if (fs.existsSync(dshSkillsDir) && fs.readdirSync(dshSkillsDir).length === 0) {
        fs.rmdirSync(dshSkillsDir);
        removed.push(dshSkillsDir);
      }
      const dshDir = path.join(target, '.dsh');
      if (fs.existsSync(dshDir) && fs.readdirSync(dshDir).length === 0) {
        fs.rmdirSync(dshDir);
        removed.push(dshDir);
      }
      const agentsPath = path.join(target, 'AGENTS.md');
      if (fs.existsSync(agentsPath)) {
        const content = fs.readFileSync(agentsPath, 'utf8');
        if (content.includes(MANAGED_AGENTS_START)) {
          removed.push(agentsPath + '（托管区）');
          const stripped = stripManagedBlock(content, MANAGED_AGENTS_START, MANAGED_AGENTS_END);
          fs.writeFileSync(agentsPath, stripped.trim() + '\n', 'utf8');
        }
      }
      // home patch 托管块移除 + loader 删除（$DSH_HOME——写 home 的敏感面）
      const dshHome = resolveDshHome();
      for (const entry of removeDshCordisPatch(dshHome)) {
        removed.push(entry);
      }
      const loaderPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
      if (fs.existsSync(loaderPath)) {
        removed.push(loaderPath + '（$DSH_HOME/plugins/ loader）');
        fs.rmSync(loaderPath, { force: true });
        // 全局挂载语义警示：loader 位于 $DSH_HOME（所有 profile / 所有项目共享）——
        // 任一项目 purge 都会连带移除，其它已安装 flow-comet 的项目将静默失去拦截
        console.warn(
          '[prepare-env] 全局桥接 loader 被移除，其它已安装 flow-comet 的项目将停止拦截' +
            '（$DSH_HOME 全局挂载——如需恢复请重跑 prepare-env --platform dsh）'
        );
      }
      return removed;
    },
    // 覆盖清单描述（默认非破坏：只覆盖生成物；声明写 home 的敏感面）
    overwriteDescription(target) {
      return [
        path.join(target, 'AGENTS.md') + '（托管区注入：保留托管区外用户内容）',
        path.join(resolveDshHome(), 'cordis.patch.yml') + '（托管块注入：保留 dsh-skin 等既有块）',
        path.join(resolveDshHome(), 'plugins', 'dsh-flow-comet-bridge.mjs') + '（$DSH_HOME 全局挂载——安装器写 home 目录的敏感面）',
      ];
    },
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
  console.log('用法: node scripts/prepare-env.mjs [--target <dir>] [--platform <claude-code|codex|dsh|claude-code,dsh|all>] [--purge --yes]');
  console.log('  从权威源 .comet/bundle-drafts/flow-comet/ 安装/更新 <dir> 环境');
  console.log('  --target 缺省 = 当前工作目录（cwd）');
  console.log('  --platform 指定平台（claude-code / codex / dsh；逗号分隔多选或 all 全部平台）');
  console.log('            缺省 = TTY 交互多选（@clack/prompts,未安装回退 readline）> 探测目标项目 > 默认 claude-code');
  console.log('  --purge   破坏性：先删除目标平台生成物再重新生成（默认不删除；需 --yes 确认）');
}

// 探测目标项目既有平台痕迹（三痕迹,一次计算复用于探测 / TTY 预勾选 / 多痕迹判定）:
// 仅 .codex/ → codex；仅 .dsh/ → dsh；含 .claude/（单独或与其它痕迹并存）→ claude-code；皆无 → probe=null。
// 多痕迹（.claude/ .codex/ .dsh/ 中 ≥2 个并存）不武断二选一——默认主平台 claude-code,resolvePlatform 输出提示。
function detectTraces(target) {
  const hasCodex = fs.existsSync(path.join(target, '.codex'));
  const hasClaude = fs.existsSync(path.join(target, '.claude'));
  const hasDsh = fs.existsSync(path.join(target, '.dsh'));
  const probe = hasClaude ? 'claude-code' : hasCodex ? 'codex' : hasDsh ? 'dsh' : null;
  return {
    probe,
    // TTY 多选预勾选依据（三痕迹各自独立判定）
    traces: { 'claude-code': hasClaude, codex: hasCodex, dsh: hasDsh },
    multiTrace: [hasClaude, hasCodex, hasDsh].filter(Boolean).length > 1,
  };
}

// TTY 交互多选（缺省路径——用户裁决：交互式选择为主；无 TTY 自动走探测/默认）。
// 首选 @clack/prompts 方向键多选（Claude Code / Codex / dsh,基于 detectTraces 痕迹预勾选：
// .claude/ / .codex/ / .dsh/）；**可选依赖**——动态 import 失败（未安装）自动回退
// readline 数字/逗号多选（回车默认 = 探测推荐）。保持零依赖哲学：CI 无 npm install
// 环境可运行（本任务不引入 package.json 或依赖安装——@clack/prompts 仅为尝试加载）。
async function promptPlatformSelection(probe, traces, multiTrace) {
  const options = Object.entries(PLATFORMS).map(([id, p]) => ({ value: id, label: `${p.label} (${id})` }));
  const initialValues = options.filter((o) => traces[o.value]).map((o) => o.value);
  let clack = null;
  try {
    clack = await import('@clack/prompts');
  } catch { /* 可选依赖未安装——回退 readline 多选 */ }
  if (clack && typeof clack.multiselect === 'function') {
    const selected = await clack.multiselect({
      message: '[prepare-env] 选择要安装的平台（方向键移动、空格勾选、回车确认）',
      options,
      required: true,
      initialValues: initialValues.length > 0 ? initialValues : undefined,
    });
    if (clack.isCancel(selected)) {
      throw new Error('平台选择已取消');
    }
    return selected;
  }
  return promptPlatformSelectionReadline(probe, traces, multiTrace);
}

// readline 多选回退（零依赖路径——@clack/prompts 未安装时）：数字/平台名逗号分隔多选；
// 回车 = 探测推荐（无探测 → claude-code）。保持零依赖哲学：CI 无 npm install 环境可运行。
async function promptPlatformSelectionReadline(probe, traces, multiTrace) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ids = Object.keys(PLATFORMS);
    const defaultChoice = probe ?? 'claude-code';
    const traceNote = (id, traceLabel) => (traces[id] ? `（检测到 ${traceLabel} 痕迹）` : '');
    const probeNote = multiTrace
      ? '（检测到目标项目多平台痕迹并存——默认主平台 Claude Code,不武断推荐）'
      : probe
        ? `（检测到目标项目已有 ${probe === 'claude-code' ? '.claude/' : probe === 'codex' ? '.codex/' : '.dsh/'} 痕迹）`
        : '';
    const answer = await rl.question(
      `[prepare-env] 选择要安装的平台（可多选）${probeNote}:\n` +
      `  1) Claude Code (claude-code)${traceNote('claude-code', '.claude/')}\n` +
      `  2) Codex (codex)${traceNote('codex', '.codex/')}\n` +
      `  3) DeepSeek Harness (dsh)${traceNote('dsh', '.dsh/')}\n` +
      `  输入序号或平台名（逗号分隔多选）或回车（默认 ${defaultChoice}）: `
    );
    const choice = String(answer ?? '').trim().toLowerCase();
    if (choice === '') return [defaultChoice];
    const selected = [];
    for (const part of choice.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (/^\d+$/.test(part)) {
        const idx = parseInt(part, 10) - 1;
        if (idx < 0 || idx >= ids.length) {
          throw new Error(`无效序号: ${part}（可用: 1-${ids.length}）`);
        }
        if (!selected.includes(ids[idx])) selected.push(ids[idx]);
      } else {
        // hasOwnProperty 防原型链属性(如 toString/__proto__)通过查找——仅接受自有描述符键
        if (!Object.prototype.hasOwnProperty.call(PLATFORMS, part)) {
          throw new Error(`未知平台: ${part}（可用: ${ids.join(', ')}）`);
        }
        if (!selected.includes(part)) selected.push(part);
      }
    }
    return selected;
  } finally {
    rl.close();
  }
}

// 显式 --platform 参数解析：单平台 / 逗号分隔多平台 / all（全部平台,顺序 = PLATFORMS 表顺序）。
// 重复 id 去重（claude-code,claude-code 只装一次）；任一未知报错（含逗号列表中任一未知）；
// 旧 both 语义已移除——显式 both 报错提示改用逗号列表或 all。
function parsePlatformArg(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') {
    throw new Error('--platform 参数为空（可用: claude-code, codex, dsh 逗号多选或 all）');
  }
  if (raw === 'all') return Object.keys(PLATFORMS);
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error('--platform 参数为空（可用: claude-code, codex, dsh 逗号多选或 all）');
  }
  for (const id of ids) {
    // hasOwnProperty 防原型链属性(如 toString/__proto__)通过查找——仅接受自有描述符键
    if (!Object.prototype.hasOwnProperty.call(PLATFORMS, id)) {
      if (id === 'both') {
        throw new Error('--platform both 已移除——多平台请用逗号分隔（如 claude-code,codex,dsh）或 all');
      }
      throw new Error(`未知平台: ${id}（可用: ${Object.keys(PLATFORMS).join(', ')}；逗号分隔多选或 all）`);
    }
  }
  return [...new Set(ids)];
}

// 平台解析链：--platform 显式（逗号多选/all）> TTY 交互多选（@clack/prompts,回退 readline）> 探测 > 默认 claude-code。
// 返回平台描述符数组（安装顺序 = 数组顺序：显式 = 参数顺序；all = PLATFORMS 表顺序；交互 = 勾选顺序）。
async function resolvePlatform(target, platformArg) {
  if (platformArg) {
    const ids = parsePlatformArg(platformArg);
    return ids.map((id) => PLATFORMS[id]);
  }
  const { probe, traces, multiTrace } = detectTraces(target);
  if (process.stdin.isTTY) {
    const selected = await promptPlatformSelection(probe, traces, multiTrace);
    return selected.map((id) => PLATFORMS[id]);
  }
  if (multiTrace) {
    const fallbackId = probe ?? 'claude-code';
    console.log(`[prepare-env] 检测到目标项目同时有 .claude/、.codex/ 或 .dsh/ 中的多个痕迹——默认安装 ${PLATFORMS[fallbackId].label}。`);
    console.log('          如需其它平台或组合:交互终端运行,或显式 --platform dsh / claude-code,dsh / all。');
  }
  return [PLATFORMS[probe ?? 'claude-code']];
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
    // R5: matcher 含 Bash——协调者禁令物理化(Bash 写源码命令同样被 hook 检测拦截;
    // hook 对无写路径的 Bash 命令(如 git/查询)放行)
    matcher: 'Write|Edit|Bash',
    hooks: [
      {
        type: 'command',
        // 项目根锚定：node %CLAUDE_PROJECT_DIR%\.claude\skills\...\comet-hook-guard.mjs（Windows）
        // / node $CLAUDE_PROJECT_DIR/.claude/skills/.../comet-hook-guard.mjs（POSIX）。
        // 运行期由 CC 注入的变量展开；单一事实来源 = PROJECT_ROOT_ENV_VAR + projectRootGuardScriptRef。
        command: `node ${projectRootGuardScriptRef('.claude')}`,
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
function injectCodexHook(codexDir, target) {
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
function injectCodexConfig(codexDir) {
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
 */
function injectManagedRules(target, stats) {
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

// ---------- dsh 平台注入 ----------

/**
 * $DSH_HOME 解析（dsh 平台——与 dsh CLI 同款默认）：显式 DSH_HOME 环境变量 > ~/.dsh。
 */
function resolveDshHome() {
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME);
  return path.join(os.homedir(), '.dsh');
}

/**
 * 极简 YAML 形状校验（零依赖——用于 cordis.patch.yml 的 fail-safe 判定）：
 * 文件须为顶层 YAML 列表形态（行形态：注释 / 空行 / 顶层 `- 条目` / 条目下缩进内容 / 文档分隔符），
 * 无法识别（二进制、顶层 map 形态等）→ 返回 false——调用方据此 fail-safe 不覆盖（保护用户配置）。
 */
function isSimpleYamlText(text) {
  return text.split(/\r?\n/).every((line) => {
    const t = line.trimEnd();
    if (t.trim() === '') return true; // 空行
    if (/^\s*#/.test(t)) return true; // 注释
    if (/^\s*---\s*$/.test(t)) return true; // 文档分隔符
    if (/^\s*-\s+\S/.test(t)) return true; // 顶层列表条目
    if (/^\s+\S/.test(t)) return true; // 条目下缩进内容（键值/嵌套列表；YAML 允许 1 空格缩进）
    return false;
  });
}

/**
 * 注入桥接 loader 托管块到 $DSH_HOME/cordis.patch.yml（dsh 平台 home patch——
 * 读-合并-写，L-008 非破坏）：
 * 读现有 cordis.patch.yml（缺失 → 空）→ 移除旧托管块（幂等）→ 托管块内联 loader 的
 * file:// 引用（**insert 形态**：无 id 的顶层 `- insert:` 条目内嵌插件行
 * `- id: dsh-flow-comet-bridge` + `name: 'file:///<abs 路径>'`——dsh-app-boot 的
 * applyEntryPatches 语义是 id-targeted patch（id 必须已存在于配置树）；无 id 的
 * `insert:` 顶层条目才执行 data.push 追加新插件行，是 home patch 新增插件的唯一正确形态；
 * 旧的 `- id: ... + name:` patch 形态对不存在的 id 报 entry not found 并跳过——
 * loader 从不加载 → 拦截整链静默失效）
 * → 保留托管块外既有块（dsh-skin 等）→ 写回。
 * fail-safe：文件存在但内容无法识别为 YAML → 抛错退出不覆盖（参照 injectSettingsHook 模式）。
 */
function injectDshCordisPatch(dshHome, loaderPath) {
  const patchPath = path.join(dshHome, 'cordis.patch.yml');
  let existing = '';
  let fileExists = false;
  try {
    existing = fs.readFileSync(patchPath, 'utf8');
    fileExists = true;
  } catch { /* 文件缺失 = 首次安装 */ }
  if (fileExists && !isSimpleYamlText(existing)) {
    throw new Error(
      `cordis.patch.yml 已存在但内容无法解析为 YAML（${patchPath}）——为保护用户配置，中止注入。` +
        `请修复该文件（顶层 YAML 列表形态）后重试，或手动添加桥接 loader 引用。`
    );
  }
  const stripped = stripManagedBlock(existing, MANAGED_CORDIS_START, MANAGED_CORDIS_END);
  const fileUrl = pathToFileURL(loaderPath).href;
  const managedBlock =
    MANAGED_CORDIS_START + '\n' +
    '- insert:\n' +
    '    - id: dsh-flow-comet-bridge\n' +
    `      name: '${fileUrl.replace(/'/g, "''")}'\n` +
    MANAGED_CORDIS_END + '\n';
  const merged = (stripped.trim() ? stripped.trim() + '\n\n' : '') + managedBlock;
  fs.mkdirSync(dshHome, { recursive: true });
  fs.writeFileSync(patchPath, merged, 'utf8');
  return merged;
}

/**
 * 移除 $DSH_HOME/cordis.patch.yml 中的托管块（purge 语义：移除而非注入——保留 dsh-skin
 * 等既有块与用户内容）。文件缺失 → 跳过；内容无法识别为 YAML → 不动（fail-safe 保护
 * 用户配置）。移除后文件为空 → 删除文件本身。返回删除清单条目（供 purge 打印）。
 */
function removeDshCordisPatch(dshHome) {
  const patchPath = path.join(dshHome, 'cordis.patch.yml');
  const removed = [];
  if (!fs.existsSync(patchPath)) return removed;
  let content;
  try {
    content = fs.readFileSync(patchPath, 'utf8');
  } catch { return removed; }
  if (!content.includes(MANAGED_CORDIS_START)) return removed;
  if (!isSimpleYamlText(content)) {
    // 无法识别 → 不触碰（fail-safe 语义与注入一致——保护用户配置）
    return removed;
  }
  const stripped = stripManagedBlock(content, MANAGED_CORDIS_START, MANAGED_CORDIS_END);
  const trimmed = stripped.trim();
  if (trimmed) {
    fs.writeFileSync(patchPath, trimmed + '\n', 'utf8');
  } else {
    fs.rmSync(patchPath, { force: true });
  }
  removed.push(patchPath + '（托管块）');
  return removed;
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

// 移除托管块（幂等替换边界）：start 标记到 end 标记（含尾随换行）之间的全部内容。
// 注入与清理共用——AGENTS.md 托管区 / cordis.patch.yml 托管块（L-008 读-合并-写）。
function stripManagedBlock(content, startMarker, endMarker) {
  return content.replace(
    new RegExp(escapeRegExp(startMarker) + '[\\s\\S]*?' + escapeRegExp(endMarker) + '\\n?'),
    ''
  );
}

// ---------- 版本标识（全部平台共用） ----------

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
  const platforms = await resolvePlatform(target, platformArg);
  const skillsSrc = path.join(BUNDLE_DRAFTS, 'skills');
  if (!fs.existsSync(skillsSrc)) {
    throw new Error(`权威源 skills 目录不存在: ${skillsSrc}`);
  }
  const platformsLabel = platforms.map((p) => p.label).join(' + ');

  // --purge：必须配合 --yes 二次确认（防误传导致整删）；逐平台删除生成物后重新生成
  if (purge) {
    if (!yes) {
      throw new Error('--purge 是破坏性操作，需显式 --yes 确认：node scripts/prepare-env.mjs --target <dir> --purge --yes');
    }
    console.error(`[prepare-env] 警告: --purge 将删除 ${platformsLabel} 平台的以下生成物（不可恢复）：`);
    for (const platform of platforms) {
      for (const entry of platform.purge(target)) {
        console.error(`  - ${entry}`);
      }
    }
    console.error('[prepare-env] 已删除，开始重新生成。');
  }

  for (const platform of platforms) {
    const skillRoot = platform.skillRoot(target);
    const stats = { dirs: 0, files: 0, skills: [] };

    // 覆盖前打印将覆盖的生成物清单（默认非破坏：只覆盖生成物）
    console.log(`[prepare-env] 平台: ${platform.label} — 将覆盖以下生成物（其他内容保留）：`);
    console.log(`  - ${skillRoot}`);
    for (const line of platform.overwriteDescription(target)) {
      console.log(`  - ${line}`);
    }

    // 1. hook 注入（平台化：描述符驱动——CC=settings.local.json；Codex=hooks.json+config.toml）
    platform.installHooks(target, stats);

    // 2. rules 注入（平台化：描述符驱动——CC=.claude/rules/ 复制；Codex=AGENTS.md 托管区）
    platform.installRules(target, stats);

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

    // 摘要（逐平台）
    console.log(`[prepare-env] 已准备环境: ${target}（${platform.label}）`);
    console.log(
      `[prepare-env] 目录 ${stats.dirs} 个、文件 ${stats.files} 个、skills ${stats.skills.length} 个`
    );
    console.log(`[prepare-env] skills: ${stats.skills.join(', ')}`);
  }
}

try {
  await main();
} catch (err) {
  console.error(`[prepare-env] 错误: ${err.message}`);
  process.exit(1);
}
