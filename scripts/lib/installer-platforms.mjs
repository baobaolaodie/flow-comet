/**
 * installer-platforms.mjs — 平台描述符表 + 生成物部署原语（prepare-env 的逻辑层模块）
 *
 * 为什么这三段同处一个模块：平台描述符（各平台的安装位置、路径替换、hook/rules 注入、purge
 * 与覆盖清单）与「整树复制 / 平台路径替换」是同一件事的两半——描述符的 installRules 直接调用
 * 复制原语，入口主流程也用它铺技能树。放在一处既避免「描述符 → 入口 → 描述符」的循环 import，
 * 也让「复制语义只有一份实现」成为结构事实。
 *
 * 仓库根与权威源常量（REPO_ROOT / BUNDLE_DRAFTS）也定在这里：描述符表在模块加载期就需要它们
 * （dsh 的桥接 loader 源路径、各平台 rules 源目录），而依赖方向是单向的（入口 → lib），常量
 * 只能落在 lib 一侧——入口与其余模块一律 import 本模块，不各自推导（同一事实不写两份）。
 *
 * 依赖方向：本模块依赖 installer-hooks（配置注入）与 installer-loader（loader 版本比对 /
 * cordis patch）；反向依赖不存在。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MANAGED_AGENTS_END,
  MANAGED_AGENTS_START,
  injectCodexConfig,
  injectCodexHook,
  injectManagedRules,
  injectSettingsHook,
  removeManagedCodexHooks,
  resolveDshHome,
} from './installer-hooks.mjs';
import {
  injectDshCordisPatch,
  removeDshCordisPatch,
  reportLoaderVersionTransition,
  stripManagedBlock,
} from './installer-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
// 权威源根（含 skills/ 与 rules/——目录结构与安装副本 .claude/ 对称：<根>/skills/flow-comet/）
export const BUNDLE_DRAFTS = path.join(REPO_ROOT, '.flow-comet');
// rules 源目录：三个平台的 rules 注入（.claude/rules 整树复制 / AGENTS.md 托管区内联）共用同一取值
const RULES_SRC = path.join(BUNDLE_DRAFTS, 'rules');
// ---------- 平台描述符表（单一来源——新增平台 = 描述符条目 + 安装/清理函数，main 零改动） ----------
// D6：flow-kit 永不纳入清理域——下述各平台 purge 清单均不含 <target>/flow-kit/（含 --purge --yes）；
//     它不是本安装器的生成物域（ADR-008），由安装器首次创建的 flow-kit 残留属预期。

export const PLATFORMS = {
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
      console.log(`[flow-comet] settings.local.json ${injected ? '注入完成（保留既有字段）' : '已生成'}`);
    },
    // rules 注入：.claude/rules/ 整树复制（自动加载 markdown 指令）
    installRules(target, stats) {
      if (fs.existsSync(RULES_SRC)) {
        copyTree(RULES_SRC, path.join(target, '.claude', 'rules'), stats);
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
      console.log('[flow-comet] .codex/hooks.json + config.toml 注入完成（hooks 启用，保留既有字段）');
    },
    // rules 注入：AGENTS.md 托管区内联（Codex 指令唯一自动加载路径；.codex/rules/ 是命令批准规则目录，不混用；
    // 注入函数与托管区标记 codex/dsh 共用——任一平台卸载可清,另一平台重装恢复）
    installRules(target, stats) {
      if (injectManagedRules(target, stats, RULES_SRC)) {
        console.log('[flow-comet] AGENTS.md 托管区注入完成（保留托管区外用户内容）');
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
        // 覆盖前版本比对明示（版本戳标记契约）：输出首次安装/升级/降级/版本一致之一；
        // 任一侧提取失败只告警不中断——覆盖照常执行（幂等语义不变）
        reportLoaderVersionTransition(loaderSrc, loaderDst);
        fs.copyFileSync(loaderSrc, loaderDst);
        stats.files++;
        console.log('[flow-comet] 桥接 loader 已复制到 $DSH_HOME/plugins/dsh-flow-comet-bridge.mjs');
        injectDshCordisPatch(dshHome, loaderDst);
        stats.files++;
        console.log('[flow-comet] $DSH_HOME/cordis.patch.yml 托管块注入完成（读-合并-写,保留既有块）');
      } else {
        // 容错：scripts/dsh-bridge.mjs 由并行任务新建——源缺失时 WARN 跳过 loader 复制
        // **并跳过 cordis.patch.yml 托管块注入**（避免注入指向不存在文件的 file:// 引用,
        // 导致 dsh 每次启动尝试加载不存在的插件）;仍完成其余安装
        // （AGENTS.md 托管区 / skills 复制照常）
        console.warn(
          '[flow-comet] 警告: scripts/dsh-bridge.mjs 不存在——跳过 loader 复制与 cordis.patch.yml 托管块注入' +
            '（dsh 桥接拦截暂不生效,待源文件就位后重跑 prepare-env）'
        );
      }
    },
    // rules 注入：AGENTS.md 托管区（与 codex 共用注入函数与托管区标记——任一平台卸载可清）
    installRules(target, stats) {
      if (injectManagedRules(target, stats, RULES_SRC)) {
        console.log('[flow-comet] AGENTS.md 托管区注入完成（保留托管区外用户内容）');
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
          '[flow-comet] 全局桥接 loader 被移除，其它已安装 flow-comet 的项目将停止拦截' +
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
export function copyTree(srcDir, dstRoot, stats) {
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
export function applyPathReplacements(root, replacements) {
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
