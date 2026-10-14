#!/usr/bin/env node
/**
 * prepare-env.mjs — flow-comet 环境安装脚本（T-FIX-08 创建 / T-FIX-13 非破坏化 / 1.4.0 多平台化）
 *
 * 用途：从权威源 `.flow-comet/`（含 skills/ 与 rules/）安装/更新目标仓库的环境，
 *   使目标环境获得完整约束——rules 行为层 + hook 物理层 + skills 协议层。
 *   这是 flow-comet 的**安装器**：适用于新项目安装 flow-comet、e2e 验证载体准备、
 *   源仓库自我改进 worktree 环境准备。
 *
 * 模块边界（本文件 = 入口薄壳：只做 CLI 解析、命令编排与输出收口；判据与实现落在 scripts/lib/）：
 *   installer-platforms  平台描述符表 / 仓库根与权威源常量 / 整树复制与平台路径替换
 *   installer-migrate    运行时文件位置迁移 + 路径存在性探测原语（三处调用方共用）
 *   installer-hooks      配置注入（settings.local.json / .codex / AGENTS.md 托管区）+ .gitignore 纳管
 *   installer-loader     桥接 loader 版本比对 / cordis.patch.yml 托管块 / 托管块移除边界
 *   installer-cleanup    生成物镜像目录的定向清理（fail-closed 删除判据）
 *   installer-flowkit    flow-kit 上游快照获取链路（非破坏）
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
 * hook 命令项目根锚定:CC 命令引用 CC 注入的 CLAUDE_PROJECT_DIR 运行期展开(全平台 bash
 *   ${VAR} 词形——CC 以 /bin/bash -c 执行 hook 命令,含 Windows;单一来源常量派生,
 *   见 PROJECT_ROOT_ENV_VAR);Codex 官方 hooks 无等价
 *   项目根变量(查证 openai/codex 上游执行层,结论与出处见 injectCodexHook 注释)→ 安装期
 *   字面注入 target 绝对路径(迁移目录需重跑安装器)。两平台命令均不加外层引号,以保住
 *   isManagedHookCommand 的 basename 幂等识别(容忍外层引号——含空格路径支持,见常量区说明)。
 *
 * 非破坏设计（T-FIX-13，2026-08-08 用户裁决）：
 *   - 默认（无 --purge）：**不删除整个 .claude/（或 .agents/ / .dsh/）**——只精确覆盖生成物
 *     （rules/ + skills/ 等），保留其他一切内容（commands/、自定义 hook、自定义 skill）。
 *   - **镜像面定向清理（2026-10-09 增补：升级路径缺陷修复）**：默认模式额外删除**生成物镜像
 *     目录内**「权威源已不存在」的条目（改名 / 移出的文件，以及随之清空的目录）——只覆盖不删除
 *     会让它们在副本里永久残留（实测后果：安装副本跑自身回归套件报 308/309，失败信息逐条指向
 *     残留文件，而权威源同一命令 309/309）。删除面逐条限定在本次 copyTree 的目标根
 *     （`<skillRoot>/flow-comet*`），唯一判据 = 「权威源同一相对路径上不存在同类型条目」；
 *     白名单之外（用户自有 skill、自定义文件、无命名空间的生成面）一律不触碰；fail-closed
 *     情形（符号链接 / 类型冲突 / 清理后仍非空 / 归属不可判定）逐条打印保留原因，绝不静默。
 *   - settings.local.json / .codex/hooks.json 采用**注入**方式：读现有配置 → 保留已有
 *     字段 → 过滤已管理的 comet hook → 合并新 hook → 写回。不覆盖用户已有配置。
 *   - 显式 `--purge` 参数才允许删除生成物（打印删除清单 + 警告 + 需 --yes 二次确认）。
 *   - 覆盖前打印将覆盖的生成物清单。
 *
 * 幂等：默认模式重复运行——rules/skills 覆盖一致；镜像面定向清理零残留（第二次运行零删除项、
 *   零报错）；settings/hooks 注入幂等
 *   （已管理的 comet-hook-guard 命令被过滤后重新合并，不产生重复条目）；
 *   AGENTS.md 托管区幂等替换（移除旧托管区后重新生成）；
 *   运行时位置迁移幂等（旧件已搬走 → 跳过）；.gitignore 纳管幂等（已有条目 → 保持原样）。
 *
 * 运行时位置迁移（旧命名空间 → 新命名空间）：目标项目 `.comet/` 下的 flow-comet 运行时
 *   文件按白名单枚举（RUNTIME_FILE_MIGRATIONS）搬移到 `.flow-comet/`——搬移语义 =
 *   迁移前强制备份 → 写新位置 → 回读校验（逐字节）→ 删旧件；备份在迁移成功后保留
 *   （无 git 载体项目的唯一回退依据）。边界情形（新旧并存 / 符号链接 / JSON 损坏）
 *   一律报错中止并保留全部原件，绝不静默覆盖或丢弃。`.comet/` 是三方共占目录——
 *   白名单之外的内容（Comet 资产、用户自有文件）一律原位不动。
 *   执行顺序：迁移 → 部署 → .gitignore 纳管；任一步失败即中止（保持可重跑的一致态）。
 *   .gitignore 纳管取保守策略：既有条目一律保留，仅缺失时追加 `.flow-comet/` 条目。
 *
 * 用法：node scripts/prepare-env.mjs [--target <dir>] [--platform <claude-code|codex|dsh|claude-code,dsh|all>] [--purge --yes]
 *   --target 缺省 = 当前工作目录（cwd）。仓库根与权威源路径由 scripts/lib/installer-platforms.mjs
 *   解析（仓库根 / 权威源 / 平台表三者的单一来源——本文件不自行推导）。
 *   --platform 显式指定平台：单平台 / 逗号分隔多平台（claude-code,codex,dsh）/
 *   all（全部平台,安装顺序 = PLATFORMS 表顺序）；未知平台报错（旧 both 语义已移除——
 *   多平台用逗号列表或 all）；缺省走选择链：
 *     TTY 交互多选（@clack/prompts 方向键多选——依赖安装后为主路径,try-import 失败
 *     （未装/离线）或 stdin 非真实 TTY（无 setRawMode,如管道喂入模拟）自动回退 readline
 *     数字/逗号多选;基于目标项目痕迹 .claude/ .codex/ .dsh/ 预勾选,回车默认 = 探测推荐;
 *     FLOW_COMET_FORCE_READLINE=1 仅测试面强制走回退）
 *     > 探测目标项目（仅 .codex/ → codex；仅 .dsh/ → dsh；含 .claude/ → claude-code；
 *     多痕迹默认 claude-code 并输出提示）> 默认 claude-code。
 *   --purge 破坏性：删除目标平台生成物后重新生成（打印清单 + 警告 + --yes 确认）。
 *
 * 输出：打印生成摘要（平台 / 目录数 / 文件数 / skills 数 / 注入状态），exit 0；失败 exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

import { cleanStaleMirrorEntries } from './lib/installer-cleanup.mjs';
import { ensureFlowKit } from './lib/installer-flowkit.mjs';
import { manageGitignore } from './lib/installer-hooks.mjs';
import { migrateRuntimeFiles } from './lib/installer-migrate.mjs';
import {
  BUNDLE_DRAFTS,
  PLATFORMS,
  REPO_ROOT,
  applyPathReplacements,
  copyTree,
} from './lib/installer-platforms.mjs';

// ---------- 平台选择 ----------

function parseArgs(argv) {
  const args = argv.slice(2);
  let target = null;
  let purge = false;
  let yes = false;
  let platform = null;
  // 零参数 = 没说要做什么：**不安装**，打印用法并非零退出。
  // 修复前它等价于 `fcomet init`（在 cwd 做一次完整安装：建 .claude/、拉 flow-kit/、改写 .gitignore）
  // ——误敲或试探性执行会在当前目录铺开一套环境。`init` 词元仍可选：`fcomet --target X`
  // 与 `fcomet init --target X` 等价（有参数即表达了意图）。
  if (args.length === 0) {
    console.error('[flow-comet] 未指定任何参数——裸执行不安装。');
    printUsage((line) => console.error(line));
    process.exit(1);
  }
  // 命令形态容忍（npm bin 形态 `fcomet init`）：包管理器垫片把 `init` 当位置词元传给脚本。
  // 只吃掉**一个**精确等于 `init` 且位于位置参数首位的词元（其前只允许选项词元）；
  // 其它非 `--` 开头词元仍按既有语义报「未知参数」——变形词元（如 `int`/`inti`）
  // 绝不被静默吞成默认安装。
  let initTokenConsumed = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === 'init' && !initTokenConsumed) {
      initTokenConsumed = true;
    } else if (a === '--target') {
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
    } else if (a === '--version' || a === '-v') {
      // 版本查询：输出本工具的版本标识（与随包分发、写入目标项目的是同一来源——
      // 见 resolveInstalledVersion；单一来源，不另设版本常量）。
      console.log(resolveInstalledVersion() || 'unknown');
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${a}`);
    }
  }
  return { target: target ? path.resolve(target) : process.cwd(), purge, yes, platform };
}

// 用法输出：默认写 stdout（--help）；出错时由调用方传入 stderr 写入函数（用法错误走 stderr）。
function printUsage(write = console.log) {
  write('用法: fcomet init [--target <dir>] [--platform <claude-code|codex|dsh|claude-code,dsh|all>] [--purge --yes]');
  write('  （`fcomet` 与 `flow-comet` 是同一安装器的两个命令名；`init` 词元可省略——`fcomet --target X`');
  write('    等价于 `fcomet init --target X`；不带任何参数时不安装，只打印本用法）');
  write('  仓库内直调: node scripts/prepare-env.mjs [--target <dir>] [--platform <...>] [--purge --yes]');
  write('  从权威源 .flow-comet/ 安装/更新 <dir> 环境（含运行时位置迁移与 .gitignore 纳管）');
  write('  --target 缺省 = 当前工作目录（cwd）');
  write('  --platform 指定平台（claude-code / codex / dsh；逗号分隔多选或 all 全部平台）');
  write('            缺省 = TTY 交互多选（@clack/prompts,未安装回退 readline）> 探测目标项目 > 默认 claude-code');
  write('  --purge   破坏性：先删除目标平台生成物再重新生成（默认不删除；需 --yes 确认）');
  write('  --version 打印版本标识（等价 -v）；--help 打印本用法');
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
// .claude/ / .codex/ / .dsh/）；try-import 失败（依赖未安装/离线）或 stdin 无法 raw mode
// （isTTY 缺失/伪真且 setRawMode 不存在——如管道喂入的自动化形态）自动回退 readline
// 数字/逗号多选（回车默认 = 探测推荐）。仅测试面环境开关 FLOW_COMET_FORCE_READLINE=1
// 强制走 readline 回退分支（即便 @clack/prompts 可加载）——供自动化套件断言回退可测，
// 不得用于生产规避。
async function promptPlatformSelection(probe, traces, multiTrace) {
  if (process.env.FLOW_COMET_FORCE_READLINE === '1') {
    return promptPlatformSelectionReadline(probe, traces, multiTrace);
  }
  const options = Object.entries(PLATFORMS).map(([id, p]) => ({ value: id, label: `${p.label} (${id})` }));
  const initialValues = options.filter((o) => traces[o.value]).map((o) => o.value);
  let clack = null;
  try {
    clack = await import('@clack/prompts');
  } catch { /* 依赖未安装/离线——自动回退 readline 多选 */ }
  if (clack && typeof clack.multiselect === 'function') {
    // @clack 依赖 stdin raw mode：isTTY 为真但 stdin 实为管道（无 setRawMode）时调用
    // multiselect 会崩溃（o.setRawMode is not a function）——与强制回退同路径直接走 readline。
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      return promptPlatformSelectionReadline(probe, traces, multiTrace);
    }
    const selected = await clack.multiselect({
      message: '[flow-comet] 选择要安装的平台（方向键移动、空格勾选、回车确认）',
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

// readline 多选回退（无第三方依赖路径——@clack/prompts 未安装/离线/强制开关下）：
// 数字/平台名逗号分隔多选；回车 = 探测推荐（无探测 → claude-code）。
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
      `[flow-comet] 选择要安装的平台（可多选）${probeNote}:\n` +
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
    console.log(`[flow-comet] 检测到目标项目同时有 .claude/、.codex/ 或 .dsh/ 中的多个痕迹——默认安装 ${PLATFORMS[fallbackId].label}。`);
    console.log('          如需其它平台或组合:交互终端运行,或显式 --platform dsh / claude-code,dsh / all。');
  }
  return [PLATFORMS[probe ?? 'claude-code']];
}

// ---------- 版本标识（全部平台共用） ----------

/**
 * 目录**本身**是否为 git 仓库根。判据 = `git rev-parse --show-toplevel` 指回自身。
 * git 从 cwd 起**向上**找仓库，故嵌套在别人仓库里的目录同样能拿到结果——必须比对。
 * 同时静音 stderr：git 在非仓库目录会打印 `fatal: not a git repository`，不该漏给用户。
 */
function isRepositoryRoot(dir) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!top) return false;
    const normalize = (value) => {
      let resolved = value;
      try { resolved = fs.realpathSync(value); } catch { /* 取不到真实路径时用词法路径 */ }
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    return normalize(top) === normalize(dir);
  } catch {
    return false; // 无 git / 非仓库：一律不采信
  }
}

/**
 * 版本标识:优先从源仓库 git describe 生成(多人协作精确检测——发布版 = 精确 tag,
 * 开发态 = "<tag>-<领先提交数>-g<hash>",提 issue 时维护者可据此判断包含哪些积累);
 * 无 git(纯手动复制兜底)时用权威源随技能包分发的 INSTALLED_VERSION(最近发布版本)。
 *
 * **采信 git 的前提 = 本目录就是仓库根**（仓库检出形态）。包被装在别人的仓库里时
 * （本地安装进项目 → `<项目>/node_modules/flow-comet`），git 会向上找到**宿主仓库**，
 * 把宿主 tag 当成流工具版本——该值是错的，且它正是写进目标项目版本标识的那个值
 * （issue 报版本 / bridge-check 比对 / 套件跨值守卫会跟着全错）。故非仓库根一律回退包内文件。
 */
function resolveInstalledVersion() {
  let installedVersion = '';
  if (isRepositoryRoot(REPO_ROOT)) {
    try {
      const desc = execFileSync('git', ['describe', '--tags'], {
        cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (desc) installedVersion = desc.replace(/^v/, ''); // 剥 v 前缀,与 CHANGELOG 版本号一致
    } catch { /* 无 tag:回退权威源文件 */ }
  }
  if (!installedVersion) {
    const bundled = path.join(BUNDLE_DRAFTS, 'skills', 'flow-comet', 'INSTALLED_VERSION');
    if (fs.existsSync(bundled)) installedVersion = fs.readFileSync(bundled, 'utf8').trim();
  }
  return installedVersion;
}
// ---------- 主流程 ----------

async function main() {
  const { target, purge, yes, platform: platformArg } = parseArgs(process.argv);

  // --purge 的 --yes 二次确认（防误传导致整删）**先于一切写操作**：被拒绝的命令不得产生
  // 任何副作用——确认校验若排在迁移之后，命令最终被拒绝但迁移已经执行、目标已被修改。
  if (purge && !yes) {
    throw new Error('--purge 是破坏性操作，需显式 --yes 确认：node scripts/prepare-env.mjs --target <dir> --purge --yes');
  }

  const platforms = await resolvePlatform(target, platformArg);
  const skillsSrc = path.join(BUNDLE_DRAFTS, 'skills');
  if (!fs.existsSync(skillsSrc)) {
    throw new Error(`权威源 skills 目录不存在: ${skillsSrc}`);
  }
  const platformsLabel = platforms.map((p) => p.label).join(' + ');

  // 执行顺序第一段：运行时文件位置迁移（先于任何部署写入——失败即中止，保持可重跑的一致态）
  migrateRuntimeFiles(target);

  // --purge（已在上方确认 --yes）：逐平台删除生成物后重新生成
  if (purge) {
    console.error(`[flow-comet] 警告: --purge 将删除 ${platformsLabel} 平台的以下生成物（不可恢复）：`);
    for (const platform of platforms) {
      for (const entry of platform.purge(target)) {
        console.error(`  - ${entry}`);
      }
    }
    console.error('[flow-comet] 已删除，开始重新生成。');
  }

  // flow-kit 获取链路（ADR-008 / D1~D6——平台无关,平台循环之前调用一次;
  // 内部四条路径均不抛错、不阻断后续平台安装职责）
  if (!purge) ensureFlowKit(target);

  for (const platform of platforms) {
    const skillRoot = platform.skillRoot(target);
    const stats = { dirs: 0, files: 0, skills: [] };

    // 覆盖前打印将覆盖的生成物清单（默认非破坏：只覆盖生成物）
    console.log(`[flow-comet] 平台: ${platform.label} — 将覆盖以下生成物（其他内容保留）：`);
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
    // 3.1 定向清理**先于复制**：镜像目录内「权威源已不存在」的条目（升级路径残留——见
    // cleanStaleMirrorEntries 的白名单与 fail-closed 说明；只覆盖不删除会让改名/移出的文件在
    // 副本里永久残留）。清理抛 EACCES / EPERM / EBUSY 时安装中止（错误 fatal，不吞）——此时
    // 尚未复制任何技能树，副本里不会留下「已复制但平台路径未替换、版本标识未写」的半成品树；
    // 清理判据只比对权威源与镜像现状，与复制是否已发生无关，故前置不改变删除面。
    cleanStaleMirrorEntries(skillsSrc, skillRoot, skillNames, target);
    for (const name of skillNames) {
      copyTree(path.join(skillsSrc, name), path.join(skillRoot, name), stats);
      stats.skills.push(name);
    }
    const replacedFiles = applyPathReplacements(skillRoot, platform.pathReplacements);
    if (replacedFiles > 0) {
      console.log(`[flow-comet] 平台路径替换: ${replacedFiles} 个 .md 文件（${platform.label} 命令路径）`);
    }

    // 4. 版本标识（写入平台技能根,随技能包分发）
    const installedVersion = resolveInstalledVersion();
    fs.writeFileSync(path.join(skillRoot, 'flow-comet', 'INSTALLED_VERSION'), installedVersion + '\n', 'utf8');
    stats.files++;

    // 摘要（逐平台）
    console.log(`[flow-comet] 已准备环境: ${target}（${platform.label}）`);
    console.log(
      `[flow-comet] 目录 ${stats.dirs} 个、文件 ${stats.files} 个、skills ${stats.skills.length} 个`
    );
    console.log(`[flow-comet] skills: ${stats.skills.join(', ')}`);
  }

  // 执行顺序第三段：.gitignore 保守纳管（部署成功后执行——失败即中止，可重跑自愈）
  manageGitignore(target);
}

try {
  await main();
} catch (err) {
  console.error(`[flow-comet] 错误: ${err.message}`);
  process.exit(1);
}
