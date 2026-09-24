#!/usr/bin/env node
// C1 · flow-comet 引擎自测套件（场景数以 SCENARIOS.length 为准：节点门禁 entry/exit 校验正反例与 WARN 渐进、自定义协议加载路由与防线、TASK 签名与 next 推进、handoff Return Contract 与时间序、init 状态机与 hook 写白名单、CONTEXT 自动初始化检测、completedChecks 真实性声明机制（skill-load/record/exit 校验 + 交叉自洽 + 旧兼容）、init 参数误用防护、执行遗漏防护、严格模式、验证失败计数按变更隔离、多趟路由依赖图校验（环/缺失依赖 BLOCK 与混排合法锚）、契约解析失败检测、计数一致性自检（场景数 + 系统测试集项数）、prepare-env 平台选择链、零提交边界与入口首部强制、多趟出口硬化（可运行串行放行与拦截双向锚、单行分号 write_files 容错、收尾态路由静默、死结提示与技能文本锁）、installer 新链路（flow-kit 获取五态 / 桥接健康六态 / 他方保持 / 强制回退）、并行文件依赖检测（写写重叠强判前移 plan 出口 + read 读写弱判渐进 + 触发面排除 + 委托前保持锚 + 扩展名闭合）、directOverride 授权约束（协调者授权留痕正例 / 执行者自切无授权 BLOCK / 越界改 state hook 拦截 / 恢复双路径）、hook state 大小写变体拦截（win32/darwin 闭合 / 其他平台放行）、路由完成判定 fail-closed（缺/未知 status 畸形块不提前放行）、并行文件依赖路径归一化（`.` 段变体重叠检出）、运行时文件位置迁移（白名单搬移 / 迁移前备份与回退 / 新旧并存·符号链接·内容损坏三边界 / 失败保护 / gitignore 三形态保守纳管与幂等）、Comet 感知层剥离（classic 资产有无判定一致 / overlay 协议不再进入叠加分支 + 源码符号检索）、自检清单条目缺失显式报告）
//
// 每个场景 = 独立临时目录（fs.mkdtemp）+ 伪造 .flow-comet/flow-comet-state.json
// （currentNode + evidence + executionMode:'subagent'，满足前置校验）+
// .specs/<change>/ 工件 → spawnSync 跑 workflow-guard.mjs <entry|exit> <node>
// （FLOW_COMET_RUN_ROOT=<临时目录>）→ 断言退出码与输出关键词。场景跑完 rmSync 清理。
//
// 运行: node scripts/guard-self-test.mjs
// 全过 → exit 0，输出 ALL <n> SCENARIOS PASSED（n = SCENARIOS.length）；失败 → exit 1，列出场景名+实际输出+exit code
//
// 仅 node 内置模块（child_process/fs/os/path/vm）；不依赖 flow-kit 模板目录存在
// （fallback 场景用内置段名；部分场景复制模板文件进临时目录验证 C2 模板派生）。
// flow-kit 新装场景除外：优先复用仓库内 vendored 上游副本经 git 标准 insteadOf 机制本地克隆
// （离线可复现，HEAD 即锁定点）；副本缺席（如 CI 全新检出）时真实 clone 上游——
// 前提与 CI installer 链路一致（github 可达）。
//
// 自定义协议路径适配：T03 起 workflow-guard 用 readProtocolFile（protected-path：
// 协议路径必须在 runRoot 内）。场景 runRoot=临时目录、内置协议默认路径在 packageRoot
// （脚本所在仓库，tmpdir 外）→ 全部场景曾报 "workflow protocol file must stay inside the
// project root"。修复（测试场景适配，非弱化断言）：真实项目协议位于 <项目根>/reference/
// workflow-protocol.json（runRoot 内）——每个场景把内置协议复制到 <dir>/reference/ 并由
// runGuard 的 FLOW_COMET_PROTOCOL 指向场景内副本；自定义协议场景用 --protocol CLI（优先级
// 最高）或 env 覆盖。自定义协议场景组同时覆盖 AC-2/3/4/5/6（加载路由、通用层防线、特化
// 校验绑定、hook 白名单缺省）。

import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import vm from 'vm'; // 系统测试集项数的运行时派生：求值其 TEST_ITEMS 数组字面量（见 readSystemTestItemCount）

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// route-node 共享 Fix 判定纯函数（直接调用锚）：动态导入 + 顶层 await——缺失命名导出由
// requireRouteNodeExport 在场景内显式报告（RED 可定位到具体场景），避免静态命名 import 在
// 模块加载期失败导致其余场景一并 abort（整套件 0 场景、失败原因失焦）。
const routeNodeModule = await import(pathToFileURL(path.join(__dirname, 'route-node.mjs')).href);
const GUARD = path.join(__dirname, 'workflow-guard.mjs');
const STATE = path.join(__dirname, 'workflow-state.mjs');
const HOOK = path.join(__dirname, 'comet-hook-guard.mjs');
const HANDOFF = path.join(__dirname, 'workflow-handoff.mjs');
// prepare-env 安装器（平台选择链场景——真实脚本,场景用临时目录 + spawn 断言）：
// 仓库根（权威源检出）：脚本位于 <root>/.flow-comet/skills/flow-comet/scripts —— 4 级 .. 到 <root>。
// 单一来源：安装器路径、仓库文档级场景与底部自检共用（历史教训：同一路径表达式分散在多处，
// 布局迁移时逐处改写必然遗漏——本次迁移即因此把 4 处深度链收敛为一处）。
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
// 权威源锚点：仅权威源检出含 <root>/.flow-comet/（安装副本把技能树放在 .claude|.agents|.dsh/skills/，
// 其 .flow-comet/ 只是运行时目录，无 skills/flow-comet/SKILL.md）——与安装器自身判定同判据
// （prepare-env.mjs 的 gitignore 纳管跳过分支）。
const AUTHORITATIVE_SOURCE_ANCHOR = path.join(REPO_ROOT, '.flow-comet', 'skills', 'flow-comet', 'SKILL.md');
function isAuthoritativeSourceRepo() {
  return fs.existsSync(AUTHORITATIVE_SOURCE_ANCHOR);
}
// 权威源仓库脚本位于仓库根 scripts/prepare-env.mjs；安装副本无此脚本,场景跳过
const PREPARE_ENV = path.join(REPO_ROOT, 'scripts', 'prepare-env.mjs');
// 内置协议源文件（packageRoot/reference/）：场景复制到 <tmpdir>/reference/ 内（protected-path 要求 runRoot 内）
const BUILTIN_PROTOCOL_SOURCE = path.join(__dirname, '..', 'reference', 'workflow-protocol.json');
const CHANGE_ID = 'ch';

// 组件技能树布局感知（单一来源）：本 suite 恒位于 <skillsRoot>/flow-comet/scripts/，
// 组件技能（flow-comet-execute / flow-comet-review / flow-comet-verify 等）是 <skillsRoot>
// 下的同级目录。权威源 checkout → <root>/.flow-comet/skills/；安装副本 → <目标>/.claude|
// .agents|.dsh/skills/ —— 同一相对推导覆盖全部形态。禁止再假定权威源布局
// （REPO_ROOT/.flow-comet/skills 在安装副本形态不存在 → 技能文本锁场景 ENOENT，级 3 e2e 缺陷）。
function skillsRootForScriptsDir(scriptsDir) {
  return path.resolve(scriptsDir, '..', '..');
}
// 解析组件技能 SKILL.md：缺失即显式失败并给指引（MECHANISM 三·6「未验证 ≠ 通过」——
// 不得静默跳过）；scriptsDir 为可测接缝（技能文本锁场景的合成布局回归锚）。
function resolveComponentSkillFile(nodeSkill, scriptsDir = __dirname) {
  const skillsRoot = skillsRootForScriptsDir(scriptsDir);
  const file = path.join(skillsRoot, nodeSkill, 'SKILL.md');
  if (!fs.existsSync(file)) {
    throw new Error(
      '技能树布局定位失败：' + nodeSkill + '/SKILL.md 不存在。suite 脚本须位于 <skillsRoot>/flow-comet/scripts/' +
      '，组件技能为其同级目录；已解析 skillsRoot=' + skillsRoot + '，期望路径=' + file +
      '。权威源 .flow-comet/skills 与安装副本 .claude|.agents|.dsh/skills 均按此相对布局解析。'
    );
  }
  return file;
}

// 场景数一致性自检清单（20 文件 = 15 分发组 + 5 维护者组，全变体：ALL n SCENARIOS PASSED / n scenarios / n 场景 / n/n）——
// 场景数自检与底部自检共用同一清单/同一实现（自检常量同步：SCENARIOS.length 变更 → 20 受检文件须同步）。
// 分两组按"分发形态"划界（AC-14：条目缺失必须显式报告，不得静默跳过——幽灵条目无处藏身）：
//   ① 分发组：随仓库分发（受版本控制），**任何**权威源检出都必须存在——维护者工作副本、
//      CI 全新检出、worktree 检出皆然 → 条目缺失即报错（幽灵条目在此被强制暴露）。
//   ② 维护者组：被 .gitignore 排除（docs/internal/），只存在于维护者工作副本；CI 全新检出与
//      worktree 检出**整组必然缺席** → 判据取"整组是否在场"而非"单条目是否在场"：整组缺席 =
//      该检出无此文档面，跳过该组；整组在场时同样逐条强制存在与同步，缺失即报错。
//      （单条目静默跳过正是本 change 修正的缺陷——故跳过粒度只能是"整组"，不能是"单条"。）
// CLAUDE.md 为主仓私有指导文件（gitignore 不随 clone 分发）——不在自检清单内（2026-08-16 决策：
// 清单只针对随仓库分发的文件；CLAUDE.md 场景数由人工维护）
const SCENARIO_COUNT_FILES = [
  'README.md', 'README-zh.md', 'CONTRIBUTING.md', 'CONTRIBUTING-zh.md',
  'docs/INSTALLATION.md', 'docs/INSTALLATION-zh.md', 'docs/MECHANISM.md', 'docs/MECHANISM-zh.md',
  'docs/VERSIONS.md', 'docs/VERSIONS-zh.md', '.github/PULL_REQUEST_TEMPLATE.md',
  'CHANGELOG.md', 'CHANGELOG-zh.md',
  // CI workflow 文件纳入场景数自检（此前盲区——ci.yml 注释/greeting 欢迎消息的
  // 场景数字样游离,发布时靠人工核对;纳入后自检强制同步,防漏）
  '.github/workflows/ci.yml', '.github/workflows/greeting.yml',
];
// 维护者组（见上方分组说明）；整组在场判据取**组外**的目录 `docs/internal/`——不能取组内成员：
// 若用某个成员当探针，该成员缺失时会被判成"整组缺席"而跳过，正好把这个成员的缺失藏起来
//（即 AC-14 要消灭的"永不生效的条目"）。用目录作探针则目录在场即逐条严检，成员缺失照样报告。
// 会话接续文档（`next-session-prompt-<日期>.md`）**刻意不在本清单内**：它每次会话更名，
// 而本清单是**受版本控制**的——把它写进来，等于让一个被跟踪的检查器去要求一个
// 「被忽略且随会话改名」的文件名：在未执行同一次本地迁移的维护者检出里，它会被报成缺失
// 而让套件失败（CI 因整组跳过不会暴露这一点）。详见本清单下方的分组说明。
const SCENARIO_COUNT_FILES_MAINTAINER = [
  'docs/internal/ARCHITECTURE.md', 'docs/internal/DOC-CHECKLIST.md', 'docs/internal/MECHANISM.md',
  'docs/internal/ROADMAP.md',
  'docs/internal/WORKING-METHOD.md',
];
const MAINTAINER_DOC_DIR = 'docs/internal';

// 系统测试集项数受检清单——与场景数清单**并列不合并**：两者数字不同、受检文件面也不同
// （项数只出现在下面这些文档里；场景数散布更广，含 README / 模板 / CI）。清单本身是
// 单一来源：改动项数必须同步列出的全部文件，漏同步即套件报错（此前无任何机检锚定，
// 漂移只能靠人工发现）。分组语义与场景数清单一致（见上方分组说明）：分发组恒检，
// 维护者组整组在场时逐条严检。
const SYSTEM_TEST_COUNT_FILES = [
  'CONTRIBUTING.md', 'CONTRIBUTING-zh.md',
  'docs/MECHANISM.md', 'docs/MECHANISM-zh.md',
  'docs/VERSIONS.md', 'docs/VERSIONS-zh.md',
  'CHANGELOG.md', 'CHANGELOG-zh.md',
];
const SYSTEM_TEST_COUNT_FILES_MAINTAINER = [
  'docs/internal/ARCHITECTURE.md', 'docs/internal/DOC-CHECKLIST.md',
  'docs/internal/ROADMAP.md', 'docs/internal/WORKING-METHOD.md',
];
// 刻意不收进清单的项数副本（逐条留痕，避免"清单外漏网"变成无声的例外）：
//   - CLAUDE.md：主仓私有指导文件，计数人工维护（场景数清单同一决策）；
//   - docs/internal/MECHANISM.md：其项数写法与当前值不一致，由维护批次单独同步——收进清单
//     就等于要求与本批同时修正；
//   - .specs/CONTEXT.md：流程工件目录随 change 清理/归档——收进清单会让套件在维护者检出
//     依赖流程工件状态。
const SYSTEM_TEST_SCRIPT_REL = '.flow-comet/skills/flow-comet/scripts/system-test.mjs';

let passed = 0;
const failures = [];
const createdDirs = [];

// ---------- 工具函数 ----------

// 计数变体：受检文档可接受的写法（含运行时输出形态）。场景数沿用既有全变体；
// 系统测试集项数用它真实出现的三形态（运行输出 `SYSTEM TEST: n/n passed` 与文档手抄
// `n items` / `n 项`）。
function scenarioCountVariants(n) {
  return ['ALL ' + n + ' SCENARIOS PASSED', n + ' scenarios', n + ' 场景', n + '/' + n];
}
function systemTestCountVariants(itemCount) {
  return [itemCount + '/' + itemCount, itemCount + ' items', itemCount + ' 项'];
}

// 受检文件扫描（单一实现，两套计数共用）：返回 { missing, unsynced }（空数组 = 通过）。
// AC-14：条目缺失**显式报告**，不静默跳过。
// root 可覆盖扫描根（默认仓库根）——仅为可测性接缝：使「清单条目缺失 → 显式报告」
// 这一分支能在真实文件系统上被场景驱动（否则该分支只能靠人工实验验证，回归时可能被改回
// 静默跳过而套件仍全绿）。生产调用不传该参数。
function scanCountFiles(files, variants, root = REPO_ROOT) {
  const missing = [];
  const unsynced = [];
  for (const rel of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') { missing.push(rel); continue; } // AC-14：显式记录缺失（不再 continue 静默）
      throw e;
    }
    if (!variants.some((v) => text.includes(v))) unsynced.push(rel);
  }
  return { missing, unsynced };
}

// 场景数一致性检查（单一来源）：场景 105 与底部自检共用同一实现与同一判据。
// 返回问题描述数组（空数组 = 通过）。
// root 可覆盖扫描根（默认仓库根）——同上：仅为可测性接缝（生产调用不传，判据与改前一致）。
function scenarioCountSyncProblems(n, root = REPO_ROOT) {
  const problems = [];
  const dist = scanCountFiles(SCENARIO_COUNT_FILES, scenarioCountVariants(n), root);
  if (dist.missing.length > 0) problems.push('受检条目文件缺失（幽灵条目）: ' + dist.missing.join(', '));
  if (dist.unsynced.length > 0) problems.push('场景数未同步（应为 ' + n + '）: ' + dist.unsynced.join(', '));
  // 维护者组：整组在场才检查（CI 全新检出 / worktree 检出整组必然缺席——见清单分组说明）
  if (fs.existsSync(path.join(root, MAINTAINER_DOC_DIR))) {
    const mnt = scanCountFiles(SCENARIO_COUNT_FILES_MAINTAINER, scenarioCountVariants(n), root);
    if (mnt.missing.length > 0) problems.push('维护者文档条目文件缺失（幽灵条目）: ' + mnt.missing.join(', '));
    if (mnt.unsynced.length > 0) problems.push('维护者文档场景数未同步（应为 ' + n + '）: ' + mnt.unsynced.join(', '));
  }
  return problems;
}

// 系统测试集真实项数（运行时派生）：读其脚本的 TEST_ITEMS 数组字面量并求值取 length——
// 与运行器打印的 `SYSTEM TEST: <n>/<n> passed` 同源（同一表达式）。既不 import（import 会
// 执行整套系统测试）也不二次硬编码。求值只构造数组元素（条目内的运行体是函数值，不被调用）。
// 派生源缺失 → 返回 missing 交调用方显式报告；派生失败 → 抛出（fail-closed，绝不返回哨兵值
// 静默降级）。
function readSystemTestItemCount(root = REPO_ROOT) {
  let src;
  try {
    src = fs.readFileSync(path.join(root, SYSTEM_TEST_SCRIPT_REL), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { count: null, missing: SYSTEM_TEST_SCRIPT_REL };
    throw e;
  }
  const decl = src.indexOf('const TEST_ITEMS = [');
  if (decl < 0) throw new Error(SYSTEM_TEST_SCRIPT_REL + ' 中找不到 TEST_ITEMS 声明（计数派生源失效）');
  const open = src.indexOf('[', decl);
  const close = src.indexOf('\n];', open); // 数组按脚本自身格式以顶格 ]; 收尾
  if (close < 0) throw new Error(SYSTEM_TEST_SCRIPT_REL + ' 的 TEST_ITEMS 未以顶格 ]; 收尾（计数派生源失效）');
  const items = vm.runInNewContext('[' + src.slice(open + 1, close) + ']', {}, { filename: SYSTEM_TEST_SCRIPT_REL });
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(SYSTEM_TEST_SCRIPT_REL + ' 的 TEST_ITEMS 求值结果异常（应有非空数组）');
  }
  for (const item of items) {
    if (!item || typeof item.name !== 'string') throw new Error(SYSTEM_TEST_SCRIPT_REL + ' 的 TEST_ITEMS 条目缺 name 字段');
  }
  return { count: items.length, missing: null };
}

// 系统测试集项数一致性检查：受检面与场景数面同构（分发组恒检 + 维护者组整组在场时严检）。
function systemTestCountSyncProblems(root = REPO_ROOT) {
  const { count: itemCount, missing } = readSystemTestItemCount(root);
  if (missing) return ['系统测试集项数派生源缺失（无法核对项数）: ' + missing];
  const problems = [];
  const dist = scanCountFiles(SYSTEM_TEST_COUNT_FILES, systemTestCountVariants(itemCount), root);
  if (dist.missing.length > 0) problems.push('系统测试集项数条目文件缺失（幽灵条目）: ' + dist.missing.join(', '));
  if (dist.unsynced.length > 0) problems.push('系统测试集项数未同步（应为 ' + itemCount + '）: ' + dist.unsynced.join(', '));
  if (fs.existsSync(path.join(root, MAINTAINER_DOC_DIR))) {
    const mnt = scanCountFiles(SYSTEM_TEST_COUNT_FILES_MAINTAINER, systemTestCountVariants(itemCount), root);
    if (mnt.missing.length > 0) problems.push('维护者文档系统测试集项数条目文件缺失（幽灵条目）: ' + mnt.missing.join(', '));
    if (mnt.unsynced.length > 0) problems.push('维护者文档系统测试集项数未同步（应为 ' + itemCount + '）: ' + mnt.unsynced.join(', '));
  }
  return problems;
}

// 计数一致性检查（两套计数合并）：场景 105 与底部自检共用，两处判据不会漂移。
function countSyncProblems(root = REPO_ROOT) {
  return [...scenarioCountSyncProblems(SCENARIOS.length, root), ...systemTestCountSyncProblems(root)];
}

// 维护文档机检（docs-governance）：覆盖 CI 结构上不可见的面——docs/internal/ 与 .specs/adr/ 的
// ① 死引用（文档中的仓库相对路径引用必须存在）；② ROADMAP 最低结构（Now / Next / Later / Open decisions）。
// 与计数检查同构：docs/internal 整组缺席（CI 全新检出 / worktree 检出）→ 跳过（空数组，不误红）。
// 判别力边界（实测教训）：提取必须取「完整路径 token」而非后缀子串；scripts/… 一类简写按技能树基准解析；
// 占位符 / 通配 / 未来路径不参与判定（见 ALLOWLIST）。
const INTERNAL_DOC_REF_BASES = ['.flow-comet/skills/flow-comet', '.claude/skills/flow-comet', '', 'flow-kit'];
const INTERNAL_DOC_REF_ALLOWLIST = new Set(['.specs/archive/CONTEXT-history.md']);
const INTERNAL_DOC_REF_RE = /(?<![A-Za-z0-9_.\-\/])(\.?(?:[A-Za-z0-9_][A-Za-z0-9_.\-]*\/)+[A-Za-z0-9_.\-]+\.(?:md|mjs|cjs|js|ts|json|ya?ml|sh|patch|toml))(?![A-Za-z0-9])/gm;

function internalDocRefCandidates(text) {
  const out = [];
  const seen = new Set();
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of lines[i].matchAll(INTERNAL_DOC_REF_RE)) {
      const token = m[1];
      if (token.includes('*') || token.includes('<')) continue; // 通配 / 占位符
      const key = i + 1 + ' ' + token;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ref: token, line: i + 1 });
    }
  }
  return out;
}

function internalDocsProblems(root = REPO_ROOT) {
  const problems = [];
  const internalDir = path.join(root, MAINTAINER_DOC_DIR);
  const hasInternal = fs.existsSync(internalDir);
  const targets = [];
  if (hasInternal) {
    for (const name of fs.readdirSync(internalDir)) {
      if (name.endsWith('.md')) targets.push(path.posix.join(MAINTAINER_DOC_DIR, name));
    }
  }
  const adrDir = path.join(root, '.specs', 'adr');
  if (fs.existsSync(adrDir)) {
    for (const name of fs.readdirSync(adrDir)) {
      if (name.endsWith('.md')) targets.push(path.posix.join('.specs', 'adr', name));
    }
  }
  if (targets.length === 0) return problems; // 两处目标面皆缺席 → 整组跳过（CI / worktree 形态）
  for (const rel of targets) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    for (const { ref, line } of internalDocRefCandidates(text)) {
      if (INTERNAL_DOC_REF_ALLOWLIST.has(ref)) continue;
      if (INTERNAL_DOC_REF_BASES.some((base) => fs.existsSync(path.join(root, base, ref)))) continue;
      const firstSegment = ref.split('/')[0];
      if (!fs.existsSync(path.join(root, firstSegment))) continue; // 顶层整体缺席 → 跳过（组缺席语义）
      problems.push('死引用: ' + rel + ':' + line + ' → ' + ref);
    }
  }
  const roadmapRel = path.posix.join(MAINTAINER_DOC_DIR, 'ROADMAP.md');
  if (!fs.existsSync(path.join(root, roadmapRel))) {
    problems.push('ROADMAP 缺失: ' + roadmapRel);
  } else {
    const text = fs.readFileSync(path.join(root, roadmapRel), 'utf8');
    for (const section of ['Now', 'Next', 'Later', 'Open decisions']) {
      const sectionRe = new RegExp('^##\\s*' + section + '\\s*(?:[（(][^）)\\n]*[）)])?\\s*$', 'm');
      if (!sectionRe.test(text)) {
        problems.push('ROADMAP 结构缺段: ' + section + '（' + roadmapRel + '）');
      }
    }
  }
  return problems;
}


function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-comet-guard-test-'));
  createdDirs.push(dir);
  return dir;
}

function writeFile(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function writeState(root, state) {
  writeFile(root, path.posix.join('.flow-comet', 'flow-comet-state.json'), JSON.stringify(state, null, 2) + '\n');
}

// 跑 guard：FLOW_COMET_RUN_ROOT=临时目录；FLOW_COMET_PROTOCOL 指向场景内协议副本（T06：T03 起
// 协议文件须在 runRoot 内，protected-path 检查）；spawnSync 同时捕获 stdout+stderr
// （WARN/BLOCKED 走 stderr，execFileSync 在成功退出时丢弃 stderr，会导致 WARN 断言误报）并带 exit code。
// envOverrides 可覆盖 FLOW_COMET_PROTOCOL（自定义协议场景；--protocol CLI 优先级高于 env）
function runGuard(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: root,
    env: {
      ...process.env,
      FLOW_COMET_RUN_ROOT: root,
      FLOW_COMET_PROTOCOL: path.join(root, 'reference', 'workflow-protocol.json'),
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 workflow-state.mjs：runRoot = process.cwd()（不读 FLOW_COMET_RUN_ROOT），spawn 时 cwd=临时目录即可
function runState(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [STATE, ...args], {
    cwd: root,
    env: { ...process.env, FLOW_COMET_RUN_ROOT: root, ...envOverrides },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 workflow-handoff.mjs：runRoot = process.cwd()（ 场景用 cwd=临时目录 + 伪造 state，
// 直接调用 result 命令验证时间顺序校验与 recordedAt 附带，不经过 guard exit）
function runHandoff(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [HANDOFF, ...args], {
    cwd: root,
    env: { ...process.env, FLOW_COMET_RUN_ROOT: root, ...envOverrides },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 comet-hook-guard.mjs：PreToolUse 事件从 stdin 传 JSON（{ tool_name, tool_input: { file_path } }）；
// hook 不支持 --protocol CLI，协议路径只能走 FLOW_COMET_PROTOCOL env
function runHook(args, root, input, envOverrides = {}) {
  const res = spawnSync(process.execPath, [HOOK, ...args], {
    cwd: root,
    input: input === undefined ? '' : JSON.stringify(input),
    env: {
      ...process.env,
      FLOW_COMET_RUN_ROOT: root,
      FLOW_COMET_PROTOCOL: path.join(root, 'reference', 'workflow-protocol.json'),
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 scripts/prepare-env.mjs（真实安装器——平台选择链场景）。cwd=临时目录；
// envOverrides 可覆盖 DSH_HOME（dsh 平台 installHooks 写 $DSH_HOME——场景必须设
// DSH_HOME=临时目录环境变量,禁止污染真实 ~/.dsh；spawn 非 TTY:走探测/默认路径,不触发交互）
function runPrepareEnv(args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [PREPARE_ENV, ...args], {
    cwd: root,
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout: 120000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 跑 workflow-state.mjs 的 bridge-check 只读子命令（T05 实现——六判定态健康/文件缺失/
// 未挂载/版本偏斜/重复注册/不适用）。runRoot = cwd = 项目根；协议副本须在 runRoot 内
// （protected-path）——指向运行器已复制到 <root>/reference/ 的内置协议副本
// （FLOW_COMET_PROTOCOL env 优先级高于默认，见 protocol-utils resolveProtocol）。
function runBridgeCheck(root, dshHome) {
  return runState(['bridge-check'], root, {
    DSH_HOME: dshHome,
    FLOW_COMET_PROTOCOL: path.join(root, 'reference', 'workflow-protocol.json'),
  });
}

// 桥接夹具 loader 写入（单一来源——bridge-check 夹具与安装副本形态夹具共用；两处各自
// 拼装锚点行会随契约格式演进分叉）。返回 loader 绝对路径。
function writeBridgeLoaderFixture(dshHome, loaderStamp) {
  const loaderPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
  writeFile(dshHome, 'plugins/dsh-flow-comet-bridge.mjs',
    '// dsh bridge loader fixture\n// BRIDGE_VERSION: ' + loaderStamp + '\n' +
    "export const name = 'dsh-flow-comet-bridge';\nexport const version = '" + loaderStamp + "';\n");
  return loaderPath;
}

// cordis.patch.yml 托管块（insert 形态 + file:// 引用）逐字构造（单一来源，同上）。
function managedCordisBlockFor(loaderPath) {
  const fileUrl = pathToFileURL(loaderPath).href;
  return '# --- flow-comet managed ---\n- insert:\n    - id: dsh-flow-comet-bridge\n      name: \'' +
    fileUrl.replace(/'/g, "''") + '\'\n# --- end flow-comet managed ---\n';
}

// bridge-check 版本断言的期望值归一（测试侧镜像生产 bridge-check 契约：仅剥离 git-describe
// dev 态后缀 `-<N>-g<hash>`，大小写不敏感；预发布标识不匹配、不剥离）。套件自身
// INSTALLED_VERSION 在权威源检出差为发布标记、在安装副本内为 dev 态戳——期望必须从载体
// 原始戳归一出的基础版本派生，两种载体形态（权威源 / 安装副本）才都可移植。
const FIXTURE_BRIDGE_DEV_SUFFIX_RE = /-\d+-g[0-9a-f]+$/i;
function fixtureBridgeBaseVersion(version) {
  return String(version).replace(FIXTURE_BRIDGE_DEV_SUFFIX_RE, '');
}
function fixtureIsBridgeDevVersion(version) {
  return FIXTURE_BRIDGE_DEV_SUFFIX_RE.test(String(version));
}

// 组装 dsh 桥接健康夹具（bridge-check 六态场景共用）：项目根挂 .dsh/skills/flow-comet
// 适用性门；$DSH_HOME/plugins/ 放 loader（含契约锚点 BRIDGE_VERSION 戳，值取自权威源
// INSTALLED_VERSION，与 bridge-check 比对源同值——健康态恒等、偏斜态可控）；cordis.patch.yml
// 托管块按安装器实际写入形态（insert 条目 + file:// 引用——形态断言，L-048 精神）逐字构造。
// overrides: { loaderStamp, skipLoader, patchContent, outsideBlock }
function writeBridgeFixture(dir, overrides = {}) {
  const dshHome = overrides.dshHome || path.join(dir, 'dshhome');
  const installedVersion = fs.readFileSync(path.join(__dirname, '..', 'INSTALLED_VERSION'), 'utf8').trim();
  const loaderStamp = overrides.loaderStamp || installedVersion;
  writeFile(dir, '.dsh/skills/flow-comet/.fixture-anchor', 'fixture\n');
  const loaderPath = path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs');
  if (!overrides.skipLoader) {
    writeBridgeLoaderFixture(dshHome, loaderStamp);
  }
  const managedBlock = managedCordisBlockFor(loaderPath);
  writeFile(dshHome, 'cordis.patch.yml',
    overrides.patchContent !== undefined
      ? overrides.patchContent
      : managedBlock + (overrides.outsideBlock || ''));
  return { dshHome, loaderPath, installedVersion, managedBlock };
}

// 安装副本形态夹具（版本比较场景）：把本 suite 自身技能树整体复制为
// <dir>/.dsh/skills/flow-comet —— 被检脚本与同包 INSTALLED_VERSION 因而都可控。
// bridge-check 读取脚本同包（`<脚本目录>/..`）的 INSTALLED_VERSION：权威源检出路径固定为
// 发布标记，无法表达「载体 INSTALLED_VERSION 为 dev 态（git describe 后缀）」的形态；
// 只有以副本自身脚本运行才能构造真实 dev 态载体（与 prepare-env 安装出的形态同构）。
// 返回 { dshHome, skillCopy }；loader 戳由调用方指定，与 INSTALLED_VERSION 可不同。
function writeInstalledCopyBridgeFixture(dir, { installedVersion, loaderStamp }) {
  const skillCopy = path.join(dir, '.dsh', 'skills', 'flow-comet');
  fs.cpSync(path.join(__dirname, '..'), skillCopy, { recursive: true });
  writeFile(skillCopy, 'INSTALLED_VERSION', installedVersion + '\n');
  const dshHome = path.join(dir, 'dshhome');
  const loaderPath = writeBridgeLoaderFixture(dshHome, loaderStamp);
  writeFile(dshHome, 'cordis.patch.yml', managedCordisBlockFor(loaderPath));
  return { dshHome, skillCopy };
}

// 以安装副本自身脚本运行 bridge-check（runRoot = 载体项目根；协议副本在 skill 包内，
// 与真实安装形态一致——默认协议解析即为 <skillCopy>/reference/workflow-protocol.json）。
function runBridgeCheckFromCopy(dir, dshHome, skillCopy) {
  const res = spawnSync(process.execPath, [path.join(skillCopy, 'scripts', 'workflow-state.mjs'), 'bridge-check'], {
    cwd: dir,
    env: {
      ...process.env,
      FLOW_COMET_RUN_ROOT: dir,
      FLOW_COMET_PROTOCOL: path.join(skillCopy, 'reference', 'workflow-protocol.json'),
      DSH_HOME: dshHome,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

function assertExit(res, expected) {
  if (res.status !== expected) {
    throw new Error('期望 exit ' + expected + '，实际 exit ' + res.status + '\n实际输出:\n' + res.output);
  }
}

// 输出字符串归一化：spawnSync 原始结果的 .output 恒为数组 [null, stdout, stderr]
// （.includes 逐元素比较永不中关键字）；run* 助手已归一化为字符串。两种形态都归一后再
// 断言，保证共享助手对「数组（stdout+stderr 拼接）」与「既有字符串」形态都成立（回归兼容）。
function outputText(res) {
  return Array.isArray(res?.output)
    ? String(res.stdout || '') + String(res.stderr || '')
    : String(res?.output || '');
}

function assertOut(res, keyword) {
  const text = outputText(res);
  if (!text.includes(keyword)) {
    throw new Error('输出缺少关键词 ' + JSON.stringify(keyword) + '（exit ' + res.status + '）\n实际输出:\n' + text);
  }
}

function assertNotOut(res, keyword) {
  const text = outputText(res);
  if (text.includes(keyword)) {
    throw new Error('输出不应包含关键词 ' + JSON.stringify(keyword) + '（exit ' + res.status + '）\n实际输出:\n' + text);
  }
}

// 安装副本版本比较断言单点（场景 193 多子锚共用）：构造安装副本夹具 → 以副本脚本跑真实
// bridge-check CLI → 断言 exit 与全部关键词（失败附子锚标签便于定位）。helper 只声明期望，
// bridge-check 语义仍由 CLI 真实输出承载。
function assertInstalledCopyBridgeVersionCase(dir, { label, installedVersion, loaderStamp, expectedExit, expectedKeywords }) {
  const fixture = writeInstalledCopyBridgeFixture(dir, { installedVersion, loaderStamp });
  const res = runBridgeCheckFromCopy(dir, fixture.dshHome, fixture.skillCopy);
  try {
    assertExit(res, expectedExit);
    for (const keyword of expectedKeywords) assertOut(res, keyword);
  } catch (e) {
    throw new Error('[' + label + '] ' + e.message);
  }
}

// 子锚表构造：单字段对象工厂 + 表函数（run 回调保持线性短小；子锚增长不再推动回调膨胀）。
function bridgeCopyVersionCase(label, installedVersion, loaderStamp, expectedExit, ...expectedKeywords) {
  return { label, installedVersion, loaderStamp, expectedExit, expectedKeywords };
}

// 场景 193 的安装副本版本比较子锚表——期望值全部从载体基础版本 baseVersion 派生：
// ② release 态严格相等；③ dev 态安装副本形态同基础健康；④ 两侧 dev 后缀同基础健康；
// ⑤ 基础版本失配仍 FAIL；⑥ 预发布标识不剥离仍 FAIL；⑦ release 对 release 失配仍 FAIL。
function bridgeCopyVersionSubAnchorCases(baseVersion, devVersion) {
  const major = parseInt(baseVersion.split('.')[0], 10);
  const otherBase = (major + 9) + '.0.0';
  return [
    // ② release 态严格相等：两原始戳逐字相同 → 沿用 `==` 报告。
    bridgeCopyVersionCase('release 严格相等', baseVersion, baseVersion, 0,
      '[OK] 版本一致性: loader BRIDGE_VERSION=' + baseVersion + ' == 项目 INSTALLED_VERSION=' + baseVersion,
      'bridge-check: 健康（全部检查通过）——exit 0'),
    // ③ dev 态安装副本形态：载体戳为本副本自身形态（安装副本为 git describe 戳；权威源以发布
    // 标记 + 同构 dev 后缀构造）→ 归一后与同基础 loader 判健康。
    bridgeCopyVersionCase('dev 态安装副本同基础健康', devVersion, baseVersion, 0,
      '[OK] 版本一致性: loader BRIDGE_VERSION=' + baseVersion + ' ~= 项目 INSTALLED_VERSION=' + devVersion + '（dev 态后缀归一后基础版本 ' + baseVersion + ' 一致）',
      'bridge-check: 健康（全部检查通过）——exit 0'),
    // ④ 两侧 dev 后缀同基础：归一后健康（后缀位置无关性）。
    bridgeCopyVersionCase('两侧 dev 后缀同基础健康', baseVersion + '-3-gabcdef0', baseVersion + '-2-g1234567', 0,
      '[OK] 版本一致性: loader BRIDGE_VERSION=' + baseVersion + '-2-g1234567 ~= 项目 INSTALLED_VERSION=' + baseVersion + '-3-gabcdef0（dev 态后缀归一后基础版本 ' + baseVersion + ' 一致）',
      'bridge-check: 健康（全部检查通过）——exit 0'),
    // ⑤ 基础版本失配：两侧 dev 后缀归一后仍不同 → 原始戳配对 + 双方归一值 FAIL exit 1。
    bridgeCopyVersionCase('基础版本失配', otherBase + '-3-gabcdef0', baseVersion + '-2-g1234567', 1,
      '[FAIL] 版本偏斜: loader BRIDGE_VERSION=' + baseVersion + '-2-g1234567 != 项目 INSTALLED_VERSION=' + otherBase + '-3-gabcdef0（归一基础版本: loader=' + baseVersion + ' / installed=' + otherBase + '）——两值如上',
      'bridge-check: 失配 1 项——exit 1'),
    // ⑥ 预发布标识不剥离：-rc.N 不属 dev 态后缀 → 仍报偏斜 FAIL exit 1。
    bridgeCopyVersionCase('预发布标识不剥离', baseVersion, baseVersion + '-rc.3', 1,
      '[FAIL] 版本偏斜: loader BRIDGE_VERSION=' + baseVersion + '-rc.3 != 项目 INSTALLED_VERSION=' + baseVersion + '（归一基础版本: loader=' + baseVersion + '-rc.3 / installed=' + baseVersion + '）——两值如上',
      'bridge-check: 失配 1 项——exit 1'),
    // ⑦ release 对 release 失配：两侧均无 dev 后缀且不同 → 仍 FAIL exit 1。
    bridgeCopyVersionCase('release 对 release 失配', baseVersion, '9.9.9-fixture-skew', 1,
      '[FAIL] 版本偏斜: loader BRIDGE_VERSION=9.9.9-fixture-skew != 项目 INSTALLED_VERSION=' + baseVersion + '（归一基础版本: loader=9.9.9-fixture-skew / installed=' + baseVersion + '）——两值如上',
      'bridge-check: 失配 1 项——exit 1'),
  ];
}

// ---------- route-node 共享 Fix 判定纯函数锚（直接调用） ----------

// 协议副本由运行器在场景执行前复制到 <dir>/reference/（见底部运行段）。
function readScenarioProtocol(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'reference', 'workflow-protocol.json'), 'utf8'));
}

// 245~247 场景直接调用 route-node 纯函数：缺失导出在此显式报告（RED 定位到具体场景，
// 而不是整套件在模块加载期因命名绑定失败 abort）。
function requireRouteNodeExport(name) {
  const fn = routeNodeModule?.[name];
  if (typeof fn !== 'function') {
    throw new Error('route-node.mjs 未导出共享 Fix 判定纯函数 ' + name + '（待实现）');
  }
  return fn;
}

// Fix 夹具任务块（串行；字段齐全以通过 task-parsing 解析）
function fixTaskBlock(id, status) {
  return '<task id="' + id + '" parallel="false" status="' + status + '">'
    + '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>'
    + '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify></task>';
}

// Fix 批次（248~252）场景公共任务集：既有任务 T01 done + 修复任务（状态由参数指定）
function fixBatchTaskText(fixStatus) {
  return '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n' + fixTaskBlock('T-FIX-01', fixStatus) + '\n';
}

// 并行 Fix 任务集（无依赖 → 可委托）：既有任务 T01 done + parallel 修复任务（状态由参数指定）。
function fixBatchParallelTaskText(fixStatus) {
  return '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n'
    + '<task id="P-FIX-01" parallel="true" status="' + fixStatus + '">'
    + '<action>实现 P-FIX-01</action><write_files>src/p-fix-01.mjs</write_files>'
    + '<verify>node --check src/p-fix-01.mjs</verify></task>\n';
}

// 家族出口事件过时回放：最新 exit-applied 事件节点为 execute / subagent-execute，
// 签名仍是修复任务追加前的占位值（本批生命周期未闭合的信号；change 缺省 = 旧 state 兼容）。
function fixBatchHistoryWithStaleFamilyExit(node = 'execute') {
  return [{ event: 'exit-applied', node, at: '2026-09-20T00:00:00.000Z', taskSetSignature: STALE_FIX_BATCH_SIGNATURE }];
}

// done-but-unclosed 回放夹具（L-070 事故形态）：history 中最新 exit-applied execute 事件记录的
// 签名仍是追加修复任务之前的占位值（与「既有任务 + 追加修复任务」当前任务集签名必然不等）——
// 机器信号 =「修复任务已标 done，但本批 execute 出口从未重新通过」。追加前的真实哈希值不影响
// 判据（只比较是否相等），占位常量让夹具与哈希算法实现解耦；旧 state 无该字段 → 渐进放行。
const STALE_FIX_BATCH_SIGNATURE = '0'.repeat(64);
function fixBatchHistoryWithStaleExecuteExit() {
  return [{ event: 'exit-applied', node: 'execute', at: '2026-09-20T00:00:00.000Z', taskSetSignature: STALE_FIX_BATCH_SIGNATURE }];
}

// 读取场景 state 的机器字段（Fix 批次场景的写盘断言：归位/回程真实落盘，不是只看输出）
function readScenarioState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
}

// ---------- 伪造材料 ----------

function baseState(node) {
  return {
    activeChange: CHANGE_ID,
    currentNode: node,
    completedNodes: [],
    evidence: {},
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
  };
}

// ---------- 自定义协议场景材料 ----------

// 自定义协议（compose-demo）：3 节点 brainstorm/tdd/codereview（避开内置 8 节点 id，验证
// 协议数据化路由与通用层防线对自定义节点生效）；无 writeWhitelist（hook 回退内置缺省表）；
// state 与内置协议同构（statePath 指向 .flow-comet/flow-comet-state.json）
function customProtocol() {
  return {
    schemaVersion: 1,
    kind: 'workflow-kernel',
    name: 'compose-demo',
    goal: 'T06 自定义协议场景：协议数据化路由 + 通用层防线 + 特化校验绑定。',
    nodes: [
      {
        id: 'brainstorm',
        label: 'Brainstorm',
        kind: 'control',
        responsibility: '产出 notes.md。',
        outputSchemas: ['compose.notes.v1'],
        requiredSkillCalls: [],
        augmentations: [],
        disabled: false,
      },
      {
        id: 'tdd',
        label: 'TDD',
        kind: 'control',
        responsibility: '产出 *-SUMMARY.md。',
        outputSchemas: ['compose.tdd.v1'],
        requiredSkillCalls: [],
        augmentations: [],
        disabled: false,
      },
      {
        id: 'codereview',
        label: 'Code Review',
        kind: 'control',
        responsibility: '产出 verdict.md。',
        outputSchemas: ['compose.verdict.v1'],
        requiredSkillCalls: [],
        augmentations: [],
        disabled: false,
      },
    ],
    outputSchemas: [
      {
        id: 'compose.notes.v1',
        description: 'notes.md',
        artifacts: [
          {
            id: 'notes',
            kind: 'file',
            required: true,
            paths: ['<change-id>/notes.md'],
            pathBase: 'specs-root',
          },
        ],
        evidence: [{ id: 'notes-summary', required: true }],
      },
      {
        id: 'compose.tdd.v1',
        description: '*-SUMMARY.md',
        artifacts: [
          {
            id: 'summaries',
            kind: 'file',
            required: true,
            paths: ['<change-id>/*-SUMMARY.md'],
            pathBase: 'specs-root',
          },
        ],
        evidence: [{ id: 'tdd-summary', required: true }],
      },
      {
        id: 'compose.verdict.v1',
        description: 'verdict.md',
        artifacts: [
          {
            id: 'verdict',
            kind: 'file',
            required: true,
            paths: ['<change-id>/verdict.md'],
            pathBase: 'specs-root',
          },
        ],
        evidence: [{ id: 'verdict-summary', required: true }],
      },
    ],
    state: {
      kind: 'workflow-run',
      statePath: '.flow-comet/flow-comet-state.json',
      currentNodeField: 'currentNode',
      completedNodesField: 'completedNodes',
      evidenceField: 'evidence',
    },
    edges: [],
  };
}

// 含 requiredSkillCalls 的自定义协议变体——compose 自定义节点可声明必调 skill
// （compose SKILL 节点组装 requiredSkillCalls 可空）；skill-load/record 端到端验证用：
// 仅 brainstorm 带 main scope 绑定（协调者加载 → 需 skill-load 声明标记），其余与 customProtocol() 同
function customProtocolWithSkillCall() {
  const p = customProtocol();
  p.nodes[0].requiredSkillCalls = [{ skill: 'flow-comet-brainstorm', scope: 'main' }];
  return p;
}

// 写入 <dir>/custom-protocol.json，返回绝对路径（供 --protocol CLI / FLOW_COMET_PROTOCOL env 使用）
function writeCustomProtocol(dir) {
  writeFile(dir, 'custom-protocol.json', JSON.stringify(customProtocol(), null, 2) + '\n');
  return path.join(dir, 'custom-protocol.json');
}

// compose-demo 场景 state（currentNode 默认 brainstorm；hook 场景需补 status:'running'）
function composeState(overrides = {}) {
  return {
    activeChange: 'compose-demo',
    currentNode: 'brainstorm',
    completedNodes: [],
    evidence: {},
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
    ...overrides,
  };
}

// 完整 SUMMARY：六段齐全（## verify 输出 / ## 6 维自查 / ## 越界检查 / ## 做了什么 / ## 改动文件 / ## 自检方法）
// 6 维自查默认含实质内容且声明 brooks-review；method='' 表示去掉 ## 自检方法 段（旧格式场景）
function summaryContent(options = {}) {
  const sixDim = options.sixDim !== undefined
    ? options.sixDim
    : '## 6 维自查\n\n- 功能: 通过（brooks-review 已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过';
  const method = options.method !== undefined ? options.method : '## 自检方法\n\nbrooks-review';
  return [
    '# T01-SUMMARY',
    '',
    '## verify 输出',
    '',
    '```',
    'node --check src/t1.mjs',
    '```',
    '',
    sixDim,
    '',
    '## 越界检查',
    '',
    '仅修改 src/t1.mjs，无越界。',
    '',
    '## 做了什么',
    '',
    '实现 T01。',
    '',
    '## 改动文件',
    '',
    '- src/t1.mjs',
    '',
    method,
    '',
  ].join('\n');
}

// 新 change 模板保真 SUMMARY（M1 严格形态：# SUMMARY: 标题 + 首部 4 字段 + 段序保真——
// directOverride 授权约束场景（213~216）用：新 change 出口强制模板保真，旧 summaryContent
// 无 # SUMMARY: 标题会被 M1 BLOCKED，不能用于正例/恢复场景）
function strictSummary(taskId) {
  return [
    '# SUMMARY: ' + taskId + ' - 实现 ' + taskId,
    '',
    '- **Change ID**: ' + CHANGE_ID,
    '- **Task ID**: ' + taskId,
    '- **完成时间**: 2026-08-29 10:00',
    '- **AI 角色**: Dev',
    '',
    '---',
    '',
    '## 做了什么',
    '',
    '实现 ' + taskId + '（TDD：先写失败场景再实现）。',
    '',
    '## 改动文件',
    '',
    '| 文件 | 性质 | 说明 |',
    '|---|---|---|',
    '| src/' + taskId.toLowerCase() + '.mjs | 修改 | 实现任务 |',
    '',
    '## verify 输出',
    '',
    '```',
    'node --check src/' + taskId.toLowerCase() + '.mjs',
    '```',
    '',
    '## 6 维自查',
    '',
    '- 功能: 通过（brooks-review 已跑）',
    '- 性能: 无影响',
    '- 安全: 无影响',
    '- 兼容: 通过',
    '- 可观测: 通过',
    '- 可维护: 通过',
    '',
    '## 越界检查',
    '',
    '仅修改 src/' + taskId.toLowerCase() + '.mjs，无越界。',
    '',
    '## 自检方法',
    '',
    'brooks-review',
    '',
  ].join('\n');
}

// 伪造 handoffResult（越俎代庖检测要求 done 任务有 handoff；Return Contract 完整形状）
// handoff-guarded 落实——result 必须回传 completedChecks 含
// required-skill:subagent-execute.flow-comet-dev（guard W1-D 严格校验；相关场景同步补齐，
// 缺该字段的旧格式材料已明确覆盖 BLOCKED 路径）
function handoffFor(taskIds) {
  const handoffResult = {};
  for (const id of taskIds) {
    handoffResult[id] = {
      result: {
        commitHash: 'abcd1234',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/' + id.toLowerCase() + '.mjs' },
        redEvidence: { command: 'node --check src/' + id.toLowerCase() + '.mjs' },
      },
    };
  }
  return handoffResult;
}

const TASK_DONE =
  '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n';
const TASK_DONE_TWO =
  '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="T02" status="done"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify></task>\n';
const TASK_SERIAL_PENDING =
  '<task id="T01"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n';
const TASK_P1 =
  '<task id="P01" status="done" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n';
const TASK_P2 =
  '<task id="P02" status="done" parallel="true"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n';
// 第二波 parallel pending 任务（depends_on P01 已满足——第一波 P01 done 后才可委托；
// status 属性在前，与上方 parallel 任务常量的属性顺序一致）
const TASK_P2_PENDING =
  '<task id="P02" status="pending" parallel="true"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>P01</depends_on></task>\n';
// 串行 pending 任务（depends P01,P02——第二波 P02 完成前不可执行）
const TASK_T03_PENDING =
  '<task id="T03"><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
// review/verify 阶段追加的 pending 修复任务（标准回退路径触发源）
const TASK_TFIX =
  '<task id="T-FIX-01" status="pending"><action>修复 verify 发现的缺陷</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n';

// ---------- 波次分组合法性场景任务集（T01 新增） ----------
// parallel="true" = 并行任务，parallel="false"/缺省 = 串行任务；序列判定以 <task> 块出现顺序为准。
// 回归（bot 审查 · 解析一致性）：混排集里 P01 写成属性序 status 在前（status="pending" parallel="true"），
// 且串行任务 T01 的 <action> 文本内含 literal parallel="true" 字样（不改变语义）——开标签解析
// 属性序无关且不被块内文本干扰（旧整块查找会误判 T01 为并行 → 混排漏报）。
// 串→并→串（S→P→S）：串行 T01 → 并行 P01/P02 → 串行 T02（混排，禁止）
const TASK_MIXED_SPS =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01（串行任务，动作描述含 literal parallel="true" 字样，不影响并行标记）</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="P01" status="pending" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
// 并→串→并（P→S→P）：并行 P01/P02 → 串行 T01 → 并行 P03/P04（混排，禁止）。
// 回归同上：P01 属性序 status 在前；串行任务 T01 的 <action> 文本含 literal parallel="true"。
const TASK_MIXED_PSP =
  '<task id="P01" status="pending" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n' +
  '<task id="T01" parallel="false" status="pending"><action>实现 T01（串行任务，动作描述含 literal parallel="true" 字样，不影响并行标记）</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify><depends_on>P01,P02</depends_on></task>\n' +
  '<task id="P03" parallel="true" status="pending"><action>实现 P03</action><write_files>src/p3.mjs</write_files><verify>node --check src/p3.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="P04" parallel="true" status="pending"><action>实现 P04</action><write_files>src/p4.mjs</write_files><verify>node --check src/p4.mjs</verify><depends_on>T01</depends_on></task>\n';
// 并存前+串在后（P→S）：并行 P01/P02 → 串行 T01（合法成组）。
// 引号形态回归（解析一致性）：P01/P02 用**单引号属性**（XML 合法形态）——单引号属性若不解析，
// 并行任务退化为非并行（route-node 误路由到 execute、并行写写检测漏判），本常量被场景 175 用于
// 断言 `NODE: subagent-execute`，漏解析即 RED。
const TASK_VALID_PS =
  "<task id='P01' parallel='true' status='pending'><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n" +
  "<task id='P02' parallel='true' status='pending'><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n" +
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
// 串在前+并在后（S→P）：串行 T01 → 并行 P01/P02（合法成组）
const TASK_VALID_SP =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T01</depends_on></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>T01</depends_on></task>\n';
// 全串行（全 S）
const TASK_VALID_ALL_SERIAL =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>T01</depends_on></task>\n';
// 全并行（全 P，单连续块）
const TASK_VALID_ALL_PARALLEL =
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n' +
  '<task id="P03" parallel="true" status="pending"><action>实现 P03</action><write_files>src/p3.mjs</write_files><verify>node --check src/p3.mjs</verify></task>\n' +
  '<task id="P04" parallel="true" status="pending"><action>实现 P04</action><write_files>src/p4.mjs</write_files><verify>node --check src/p4.mjs</verify></task>\n';

// ---------- 多趟路由场景任务集（多趟语义批次：依赖环拦截与缺失依赖拦截场景原位重写 + 尾部新增场景族） ----------
// 依赖环：P01↔P02 互为 depends_on（依赖图有环 → plan 出口 BLOCKED 含「依赖环」+ depends_on 恢复指引）
const TASK_DEP_CYCLE =
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>P02</depends_on></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify><depends_on>P01</depends_on></task>\n';
// 依赖缺失：P01 依赖不存在的 T99（依赖链不可满足 → plan 出口 BLOCKED 含恢复指引）
const TASK_MISSING_DEP =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
  '<task id="P01" status="pending" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T99</depends_on></task>\n';

// 波次分组场景公共路径：注入 TASK.md → entry plan（记录 enteredNodes，新 change 强制先 entry；
// 旧 change 亦先 entry 避免 ENTER WARN 干扰断言）→ exit plan。返回 exit plan 结果。
function runPlanExit(dir, taskContent) {
  writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 任务清单\n\n' + taskContent);
  assertExit(runGuard(['entry', 'plan'], dir), 0);
  return runGuard(['exit', 'plan'], dir);
}

// 多波混合任务集：串 T01 → 并 P01/P02(dep T01) → 串 T02(dep P01,P02) → 并 P03/P04(dep T02)。
// ≥2 个并行块被串行任务分隔（混排合法锚 / 多趟推进完成场景共用）；doneIds 控制各任务 status，
// 模拟执行推进（next 分趟路由断言用）。
const MULTI_WAVE_TASKS = [
  ['T01', false, []],
  ['P01', true, ['T01']],
  ['P02', true, ['T01']],
  ['T02', false, ['P01', 'P02']],
  ['P03', true, ['T02']],
  ['P04', true, ['T02']],
];

function renderMultiWaveTasks(doneIds = []) {
  const done = new Set(doneIds);
  return MULTI_WAVE_TASKS.map(([id, parallel, deps]) =>
    '<task id="' + id + '"' + (parallel ? ' parallel="true"' : ' parallel="false"') +
    ' status="' + (done.has(id) ? 'done' : 'pending') + '">' +
    '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
    '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
    (deps.length > 0 ? '<depends_on>' + deps.join(',') + '</depends_on>' : '') +
    '</task>\n').join('');
}

// 多波 next 断言公共材料：前序产物文件（open/design/plan 的产物门控按文件推导）
function writeIntakeArtifacts(dir) {
  writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\nx');
  writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\nx\n\n## 验收准则（AC）\n\n- Given x When y Then z');
  writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n\nNode\n\n## 决策清单\n\n| # | D | R |\n|---|---|---|\n| D1 | x | y |');
}

// ---------- 位置迁移 / 备份 / 感知层剥离场景材料 ----------
// 全部经真实安装器（scripts/prepare-env.mjs）在临时项目上执行——断言落在真实文件系统状态与
// 进程输出上（端到端执行断言），不用形态断言替代。夹具路径一律 os.tmpdir()/path.join 生成
// （Windows 平台：bash 的 /tmp 会被 node 解析为当前盘根——夹具必须由 node 侧构造）。

const LEGACY_RUNTIME_DIR = '.comet';
const RUNTIME_DIR = '.flow-comet';
const RUNTIME_STATE_NAME = 'flow-comet-state.json';
const MIGRATION_CHANGE = 'mig-ch';

// 迁移前状态字节（健康 JSON——白名单唯一在册的运行时文件）
function migratableStateBytes(activeChange = MIGRATION_CHANGE) {
  return Buffer.from(JSON.stringify({
    activeChange,
    currentNode: 'design',
    completedNodes: ['open'],
    evidence: { open: { summary: 'intake complete' } },
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
  }, null, 2) + '\n', 'utf8');
}

// 旧命名空间三方共占夹具（实测形态）：flow-comet 运行时文件 + Comet 资产（config.yaml / runs/）
// + 用户自有文件（*.bak-*）。返回各非白名单项的迁移前字节，供「原位未动」断言（位置 + 内容）。
function writeSharedCometDir(proj, stateBytes) {
  const legacyDir = path.join(proj, LEGACY_RUNTIME_DIR);
  fs.mkdirSync(path.join(legacyDir, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(legacyDir, RUNTIME_STATE_NAME), stateBytes);
  fs.writeFileSync(path.join(legacyDir, 'config.yaml'), 'workflow:\n  projectPath: docs/openspec\n');
  fs.writeFileSync(path.join(legacyDir, 'runs', 'run-001.json'), '{"comet":true}\n');
  fs.writeFileSync(path.join(legacyDir, RUNTIME_STATE_NAME + '.bak-20260901-user'), 'user backup\n');
  const kept = ['config.yaml', 'runs/run-001.json', RUNTIME_STATE_NAME + '.bak-20260901-user'];
  return kept.map((rel) => ({ rel, bytes: fs.readFileSync(path.join(legacyDir, rel)) }));
}

// 迁移生成的备份清单（新命名空间内 flow-comet-state.json.bak-<时间戳>）
function migrationBackups(proj) {
  const dir = path.join(proj, RUNTIME_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^flow-comet-state\.json\.bak-/.test(name)).sort();
}

// 目标项目的 .specs 工件（迁移后「流程可继续」断言需要活动 change 目录在场）
function writeMigratedProjectArtifacts(proj, changeId = MIGRATION_CHANGE) {
  writeFile(proj, '.specs/' + changeId + '/CHANGE.md', '# CHANGE\n\n- **Change ID**: ' + changeId + '\n\n## Why（为什么做）\n\nx\n');
  writeFile(proj, '.specs/' + changeId + '/REQUIREMENT.md', '# REQUIREMENT\n\n- **Change ID**: ' + changeId + '\n\n## 用户故事（User Story）\n\nx\n\n## 验收准则（AC）\n\n- y\n');
}

// 跑安装副本内的脚本（cwd = 目标项目根——runRoot = process.cwd()）：迁移后链路在
// 真实安装形态（而非权威源脚本）上验证
function runInstalled(proj, platformRoot, scriptName, args) {
  const script = path.join(proj, platformRoot, 'skills', 'flow-comet', 'scripts', scriptName);
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: proj,
    env: { ...process.env, FLOW_COMET_RUN_ROOT: proj },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 安装器输出/判定文本归一化（两个夹具的项目根不同——比较判定一致性前抹掉根路径差异）
function normalizeRoot(text, ...roots) {
  let out = String(text);
  for (const root of roots) {
    out = out.split(root).join('<root>');
    out = out.split(root.replace(/\\/g, '/')).join('<root>');
  }
  return out;
}

// Comet classic 资产夹具（感知层对照用）：classic 配置 + 一个 phase=build 的活动 change
// + overlay 证据目录——旧感知层正是据此推导节点，故它们是"判定是否还读这些文件"的探针。
function writeClassicCometAssets(proj) {
  writeFile(proj, '.comet/config.yaml', 'workflow:\n  projectPath: docs/openspec\n');
  writeFile(proj, 'docs/openspec/changes/classic-marker/.comet.yaml', 'phase: build\nbuild_pause: plan-ready\n');
  writeFile(proj, '.comet/workflow-evidence/classic-marker/overlay.json', '{}\n');
}

// gitignore 纳管公共链路（三形态共用）：写入既有内容 → 连续两次安装 → 返回两次结果与两次
// 安装后的 .gitignore 全文（字符串，逐字节比较用）
function runGitignoreForm(dir, proj, initialContent) {
  fs.writeFileSync(path.join(proj, '.gitignore'), initialContent, 'utf8');
  const first = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
  const afterFirst = fs.readFileSync(path.join(proj, '.gitignore'), 'utf8');
  const second = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
  const afterSecond = fs.readFileSync(path.join(proj, '.gitignore'), 'utf8');
  return { first, second, afterFirst, afterSecond };
}

// 纳管公共断言：两次安装均成功；新命名空间条目恰一行；第二次安装逐字节无变化（幂等）
function assertGitignoreManaged(result) {
  assertExit(result.first, 0);
  assertExit(result.second, 0);
  const entries = result.afterFirst.split(/\r?\n/)
    .filter((line) => line.trim().replace(/^\/+/, '').replace(/\/+$/, '') === RUNTIME_DIR);
  if (entries.length !== 1) throw new Error(RUNTIME_DIR + '/ 条目应恰一行，实际 ' + entries.length + ' 行');
  if (result.afterSecond !== result.afterFirst) {
    throw new Error('第二次安装改写了 gitignore（应幂等）:\n' +
      JSON.stringify({ afterFirst: result.afterFirst, afterSecond: result.afterSecond }, null, 2));
  }
  assertOut(result.second, '保持原样');
}

// 系统测试集项数受检面的分支夹具（场景 231 用）：逐条驱动运行时派生、条目缺失、项数未同步、
// 维护者组整组在场判定、派生源缺失——判据统一是「显式报告、不静默跳过」（AC-14 同型）。
function exerciseSystemTestCountCheck(dir) {
  // ① 运行时派生：夹具脚本 3 项 → 派生值必须是 3（证明计数是读出来的，不是硬编码）
  writeFile(dir, SYSTEM_TEST_SCRIPT_REL, 'const TEST_ITEMS = [\n'
    + '  { name: \'x1\', run: () => {} },\n'
    + '  { name: \'x2\', run: () => {} },\n'
    + '  { name: \'x3\', run: () => {} },\n'
    + '];\n');
  const derived = readSystemTestItemCount(dir);
  if (derived.count !== 3) throw new Error('项数未从脚本派生（应为 3）: ' + JSON.stringify(derived));
  const itemCount = derived.count;
  for (const rel of SYSTEM_TEST_COUNT_FILES) writeFile(dir, rel, itemCount + ' items\n');
  if (systemTestCountSyncProblems(dir).length !== 0) {
    throw new Error('受检面齐备且同步时不应报告问题: ' + JSON.stringify(systemTestCountSyncProblems(dir)));
  }
  // ② 移走一个条目（幽灵条目形态）→ 显式报告缺失项（列出文件名）
  const missingRel = 'CHANGELOG-zh.md';
  if (!SYSTEM_TEST_COUNT_FILES.includes(missingRel)) throw new Error('夹具前提失效：' + missingRel + ' 不在受检清单内');
  fs.rmSync(path.join(dir, missingRel));
  const missingProblems = systemTestCountSyncProblems(dir);
  if (!missingProblems.some((p) => p.includes('缺失') && p.includes(missingRel))) {
    throw new Error('系统测试集项数缺失条目未被显式报告: ' + JSON.stringify(missingProblems));
  }
  // ③ 条目在场但项数未同步 → 同样上报（缺省放过即为静默失检）
  writeFile(dir, missingRel, '未同步的内容\n');
  const stale = systemTestCountSyncProblems(dir).join(' | ');
  if (!stale.includes('未同步') || !stale.includes(missingRel)) {
    throw new Error('系统测试集项数未同步条目未被上报: ' + stale);
  }
  // ④ 维护者组整组在场判定：组目录缺席 → 整组跳过（CI 全新检出形态，不可判成假红）
  writeFile(dir, missingRel, itemCount + ' items\n');
  if (systemTestCountSyncProblems(dir).length !== 0) {
    throw new Error('组目录缺席时应整组跳过: ' + JSON.stringify(systemTestCountSyncProblems(dir)));
  }
  // ⑤ 组目录在场 → 逐条严检：成员缺席照样显式报告（"整组跳过"不等于"组内在场者免检"）
  writeFile(dir, path.posix.join(MAINTAINER_DOC_DIR, 'stand-in.md'), 'stand-in\n');
  const mntMissing = systemTestCountSyncProblems(dir);
  if (!mntMissing.some((p) => p.includes('缺失') && p.includes(SYSTEM_TEST_COUNT_FILES_MAINTAINER[0]))) {
    throw new Error('维护者组成员缺席未被显式报告: ' + JSON.stringify(mntMissing));
  }
  // ⑥ 派生源缺失（脚本被移走）→ 显式报告，不静默跳过
  fs.rmSync(path.join(dir, SYSTEM_TEST_SCRIPT_REL));
  const noSource = systemTestCountSyncProblems(dir).join(' | ');
  if (!noSource.includes('缺失') || !noSource.includes(SYSTEM_TEST_SCRIPT_REL)) {
    throw new Error('项数派生源缺失未被显式报告: ' + noSource);
  }
}

// ---------- 17 个场景 ----------

const SCENARIOS = [
  // 1: open exit 通过（模板段名 CHANGE "## Why（为什么做）" + REQUIREMENT "## 用户故事（User Story）" + 验收段）——带模板验证 C2 派生
  {
    name: '01 open exit 通过（模板段名）',
    run: (dir) => {
      writeFile(dir, 'flow-kit/templates/CHANGE.md', '# CHANGE 模板\n\n## Why（为什么做）\n## 范围（Scope）\n');
      writeFile(dir, 'flow-kit/templates/REQUIREMENT.md', '# REQUIREMENT 模板\n\n## 用户故事（User Story）\n## 验收准则（AC）\n## 非目标（Non-Goals）\n');
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 2: open exit BLOCKED——CHANGE.md 缺 Why 段
  {
    name: '02 open exit BLOCKED：CHANGE 缺 Why 段',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## 变更目标\n\n## 方案\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'CHANGE.md 缺必填段');
    },
  },

  // 3: open exit BLOCKED——REQUIREMENT.md 缺验收段（且无 Given 豁免）
  {
    name: '03 open exit BLOCKED：REQUIREMENT 缺验收段',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 需求分析\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '缺少验收标准');
    },
  },

  // 4: design exit 通过（## 0. + ## 1. 决策清单）——带模板，段名 "## 1. 技术决策清单" 只有模板派生能匹配（fallback 不匹配）
  {
    name: '04 design exit 通过（模板派生 技术决策清单）',
    run: (dir) => {
      writeFile(dir, 'flow-kit/templates/DESIGN.md', '# DESIGN 模板\n\n## 0. 技术栈选型\n## 1. 技术决策清单\n## 2. 数据流\n');
      const st = baseState('design');
      st.evidence.design = { summary: 'design done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈选型\n\n## 1. 技术决策清单\n');
      const res = runGuard(['exit', 'design'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 5: design exit BLOCKED——缺 ## 决策清单 段
  {
    name: '05 design exit BLOCKED：缺决策清单',
    run: (dir) => {
      const st = baseState('design');
      st.evidence.design = { summary: 'design done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      const res = runGuard(['exit', 'design'], dir);
      assertExit(res, 1);
      assertOut(res, '决策清单');
    },
  },

  // 6: plan exit 通过（task 块 + verify 字段）
  {
    name: '06 plan exit 通过（task 块 + verify）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 7: plan exit BLOCKED——无 <task> 块
  {
    name: '07 plan exit BLOCKED：无 task 块',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n（无任务块）\n');
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '无 <task> 块');
    },
  },

  // 8: execute exit 通过（enter 记录 taskHash + SUMMARY 六段 + 6 维实质 + 自检方法 + handoff 齐 + TASK 全 done）
  {
    name: '08 execute exit 通过（enter 后未改 TASK，签名匹配）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      // enter 时脚本自动记录 taskHash（写回 state）
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // exit 前补 SUMMARY + handoff（不碰 TASK.md）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      // 变体:自检方法段名带括号后缀(执行者按模板标题原样书写,如 "## 自检方法（声明 brooks-review 或 builtin-quickcheck）")
      // → 段名识别放宽后通过,无"旧格式"兼容 WARN
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法（声明 brooks-review 或 builtin-quickcheck）\n\nbrooks-review',
      }));
      const resVariant = runGuard(['exit', 'execute'], dir);
      assertExit(resVariant, 0);
      assertOut(resVariant, 'ALL CHECKS PASSED');
      assertNotOut(resVariant, 'BROOKS-LINT WARN');
      // 变体负例:段名匹配(含括号后缀,但括号说明不含方法词)且段内无自检方法声明
      // → 缺自检方法 BLOCKED(六维自查也须不含方法词——全文兼容检测会命中)
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法（声明自检方法）\n\n（未声明任何方法）',
        sixDim: '## 6 维自查\n\n- 功能: 通过\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const resVariantNeg = runGuard(['exit', 'execute'], dir);
      assertExit(resVariantNeg, 1);
      assertOut(resVariantNeg, '自检方法');
    },
  },

  // 9: execute exit BLOCKED——6 维自查仅 "### 🟢 R1" 标题无正文
  {
    name: '09 execute exit BLOCKED：6 维仅 🟢 标题无实质',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        sixDim: '## 6 维自查\n\n### 🟢 R1\n### 🟢 R2',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '无实质内容');
    },
  },

  // 10: execute exit BLOCKED——缺 ## 自检方法 且全文无 brooks-review/builtin 声明
  {
    name: '10 execute exit BLOCKED：缺自检方法且全文无声明',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        sixDim: '## 6 维自查\n\n- 功能: 通过\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
        method: '',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '自检方法');
    },
  },

  // 11: execute exit 兼容——旧格式无 ## 自检方法 但 6 维含 brooks-review → WARN 不 BLOCK
  {
    name: '11 execute exit 兼容：旧格式含 brooks-review → WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({ method: '' }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 12: execute exit BLOCKED——TASK 签名哈希不匹配（enter 后改 action）
  {
    name: '12 execute exit BLOCKED：TASK 签名不匹配（enter 后改 action）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      // enter 记录 taskHash
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // enter 后改 action → 任务集签名变化
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE.replace('实现 T01', '实现 T01（改）'));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '签名不匹配');
    },
  },

  // 13: 越俎代庖——parallel done 无 handoffResult → BLOCKED
  {
    name: '13 execute exit BLOCKED：parallel done 无 handoffResult（越俎代庖）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) }; // P02 无 handoff
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P2);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '越俎代庖');
    },
  },

  // 14: 串行 pending 未完成 → BLOCKED
  {
    name: '14 execute exit BLOCKED：串行 pending 未完成',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['P02']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' + TASK_P2);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '串行 pending');
    },
  },

  // 15: subagent-execute exit 通过（parallel 全 done + handoff 齐 + Return Contract 完整）
  {
    name: '15 subagent-execute exit 通过（parallel done + handoff 齐）',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = {
        summary: 'delegated and collected',
        handoffResult: handoffFor(['P01', 'P02']),
      };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2);
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 16: entry execute——未 commit 工件存在（git 仓库）→ WORKTREE WARN 不 BLOCK
  {
    name: '16 entry execute：未 commit 工件 → WORKTREE WARN',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      const st = baseState('execute');
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      const res = runGuard(['entry', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'WORKTREE WARN');
    },
  },

  // 17: entry execute——PROGRESS.md 存在 → WARNING（清窗恢复产物）
  {
    name: '17 entry execute：PROGRESS.md 存在 → WARNING',
    run: (dir) => {
      const st = baseState('execute');
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/PROGRESS.md', '# PROGRESS\n\n已排除方案: 无\n');
      const res = runGuard(['entry', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'PROGRESS.md 存在');
    },
  },

  // ---------- 分组场景（分支校验 + 追加位置检测） ----------

  // 18: entry archive 分支校验 BLOCKED（branchMode=true + activeChange + 当前分支非 change/<id>）
  // 注意：需初始 commit——unborn HEAD 下 git rev-parse --abbrev-ref HEAD 失败（按规格"失败跳过"不触发校验）
  {
    name: '18 entry archive BLOCKED：分支不是 change/<id>（branchMode）',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const st = baseState('archive');
      st.branchMode = true;
      writeState(dir, st);
      const res = runGuard(['entry', 'archive'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '归档必须在 change/' + CHANGE_ID + ' 分支上进行');
    },
  },

  // 19: entry archive 通过（当前分支 change/<id>）
  {
    name: '19 entry archive 通过：当前分支 change/<id>',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['checkout', '-b', 'change/' + CHANGE_ID], { cwd: dir, stdio: 'ignore' });
      const st = baseState('archive');
      st.branchMode = true;
      writeState(dir, st);
      const res = runGuard(['entry', 'archive'], dir);
      assertExit(res, 0);
      assertOut(res, 'ENTRY OK: archive');
    },
  },

  // 20: exit open——CONTEXT.md 孤立追加段 → WARN 不 BLOCK
  {
    name: '20 exit open WARN：CONTEXT.md 孤立追加段',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n\n## 术语（test-change 追加）\n\n某术语\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: CONTEXT.md 检测到孤立追加段');
    },
  },

  // 21: exit verify——LESSONS.md 条目编号乱序 → WARN 不 BLOCK；verify 命令 timeout 可配置：
  // ① 缺省 timeout（无 env）下耗时命令通过（缺省保持大值）；② env
  // FLOW_COMET_VERIFY_TIMEOUT_MS 覆盖生效——设小值后同耗时命令超时 BLOCK
  {
    name: '21 exit verify WARN：LESSONS.md 编号乱序 + verify timeout env 覆盖',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n## 条目区\n\n### L-002: b\n### L-001: a\n');
      const res = runGuard(['exit', 'verify'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: LESSONS.md 条目编号乱序');
      // 子断言:无区外条目时不得打印"条目在条目区外"WARN(误报修复——修复前
      // console.error 在 if(outside) 之外无条件执行,每次 exit 都刷一条空 WARN)
      assertNotOut(res, '条目在条目区外');
      // 子断言:## 验证命令 段标题带括号后缀(与 ## 自检方法 段括号后缀兼容风格一致)不误 BLOCK
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令（必填 · exit verify 真实执行）\n\n```bash\nnode -e "1"\n```\n');
      const resBracket = runGuard(['exit', 'verify'], dir);
      assertExit(resBracket, 0);
      assertOut(resBracket, 'ALL CHECKS PASSED');
      // ① 缺省 timeout（未设 env）保持大值：1.5s 耗时命令通过（若缺省被误改小 → 超时 RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "setTimeout(()=>{}, 1500)"\n```\n');
      const resDefault = runGuard(['exit', 'verify'], dir);
      assertExit(resDefault, 0);
      assertOut(resDefault, 'ALL CHECKS PASSED');
      // ② env 覆盖生效：FLOW_COMET_VERIFY_TIMEOUT_MS=500 时 1.5s 命令超时 → BLOCKED
      // （不设 env 时同命令走缺省 300s 会通过——env 覆盖被忽略即 RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "setTimeout(()=>{}, 1500)"\n```\n');
      const resEnv = runGuard(['exit', 'verify'], dir, { FLOW_COMET_VERIFY_TIMEOUT_MS: '500' });
      // 超时 kill 的 cmd 孙进程（node）孤儿化后短暂存活，其 cwd 锁定场景目录
      // （Windows：父 cmd 被杀、孙进程继续跑完自身定时器）——在断言前同步等待其
      // 自然退出，避免场景收尾 rmSync 因目录被占用而失败（EPERM/EBUSY）
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 2000)']);
      assertExit(resEnv, 1);
      assertOut(resEnv, 'BLOCKED: verify 命令失败');
      assertOut(resEnv, 'timeout 500ms');
      // 子断言:失败计数按 change 写入(guard 侧递增语义)
      const stFail = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!stFail.verifyFailuresByChange || stFail.verifyFailuresByChange[CHANGE_ID] !== 1) {
        throw new Error('exit verify 失败计数未按 change 写入: ' + JSON.stringify(stFail.verifyFailuresByChange));
      }
      // 子断言:再次失败递增(2/3);恢复快速命令后 exit --apply 成功清零当前 change
      const resEnv2 = runGuard(['exit', 'verify'], dir, { FLOW_COMET_VERIFY_TIMEOUT_MS: '500' });
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 2000)']);
      assertExit(resEnv2, 1);
      const stFail2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!stFail2.verifyFailuresByChange || stFail2.verifyFailuresByChange[CHANGE_ID] !== 2) {
        throw new Error('exit verify 失败计数未递增: ' + JSON.stringify(stFail2.verifyFailuresByChange));
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      const resPass = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(resPass, 0);
      const stPass = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!stPass.verifyFailuresByChange || stPass.verifyFailuresByChange[CHANGE_ID] !== 0) {
        throw new Error('exit verify 成功未清零当前 change 计数: ' + JSON.stringify(stPass.verifyFailuresByChange));
      }
    },
  },

  // 22: exit archive——CHANGELOG.md 表格日期非倒序 → WARN 不 BLOCK;
  // 子断言:归档缺 KNOWN-ISSUES.md(遗留清单,协议 required 产物)→ BLOCKED
  {
    name: '22 exit archive WARN：CHANGELOG.md 表格日期非倒序',
    run: (dir) => {
      const st = baseState('archive');
      st.evidence.archive = { summary: 'archived' };
      writeState(dir, st);
      writeFile(dir, '.specs/archive/foo-' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/archive/foo-' + CHANGE_ID + '/KNOWN-ISSUES.md', '# KNOWN-ISSUES\n\n无遗留问题\n');
      writeFile(dir, '.specs/CHANGELOG.md', '# CHANGELOG\n\n| 日期 | 说明 |\n|------|------|\n| 2026-08-03 | a |\n| 2026-08-04 | b |\n');
      const res = runGuard(['exit', 'archive'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN: CHANGELOG.md 表格日期非倒序');
      // 子断言:CHANGELOG 未登记本 change → WARN 渐进(归档收尾登记兜底——
      // 修复前无检测,执行者遗漏登记可静默进归档,此处应 RED)
      assertOut(res, '未登记本 change');
      // 子断言:登记后无未登记 WARN
      writeFile(dir, '.specs/CHANGELOG.md', '# CHANGELOG\n\n| 日期 | 说明 |\n|------|------|\n| 2026-08-15 | ' + CHANGE_ID + ' | 归档登记 |\n');
      const resRegistered = runGuard(['exit', 'archive'], dir);
      assertExit(resRegistered, 0);
      assertNotOut(resRegistered, '未登记本 change');
      // 子断言:归档缺 KNOWN-ISSUES.md(遗留清单为强制产物)→ BLOCKED
      fs.rmSync(path.join(dir, '.specs/archive/foo-' + CHANGE_ID, 'KNOWN-ISSUES.md'));
      const resMissing = runGuard(['exit', 'archive'], dir);
      assertExit(resMissing, 1);
      assertOut(resMissing, 'missing Output Schema artifacts');
    },
  },

  // 23: 旧 state 兼容（无 branchMode 字段 + 无分支）entry archive → exit 0（不触发分支校验）
  {
    name: '23 旧 state 兼容：无 branchMode 无分支 entry archive',
    run: (dir) => {
      const st = baseState('archive'); // 无 branchMode 字段（旧 state 形状）
      writeState(dir, st);
      const res = runGuard(['entry', 'archive'], dir);
      assertExit(res, 0);
      assertOut(res, 'ENTRY OK: archive');
    },
  },

  // ---------- 分组场景（自定义协议加载路由 + 通用层防线 + 特化校验绑定 + hook 白名单缺省） ----------

  // 24: 自定义协议加载路由（AC-2/3）——--protocol CLI 指向 <dir>/custom-protocol.json；
  // workflow-state status 按协议 outputSchemas 推导 currentNode：全部产物缺失 → 第 1 节点
  {
    name: '24 自定义协议加载路由：无产物 → 第 1 节点（brainstorm）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState());
      fs.mkdirSync(path.join(dir, '.specs', 'compose-demo'), { recursive: true });
      const res = runState(['status', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, '"currentNode": "brainstorm"');
    },
  },

  // 25: 自定义协议加载路由（AC-2/3）——仅第 1 节点产物 notes.md 存在 → 推第 2 节点
  {
    name: '25 自定义协议加载路由：仅 notes.md → 第 2 节点（tdd）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState());
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runState(['status', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, '"currentNode": "tdd"');
    },
  },

  // 26: 自定义协议加载路由（AC-2/3）——全部产物存在 → 最后节点
  {
    name: '26 自定义协议加载路由：产物齐全 → 最后节点（codereview）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState());
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      writeFile(dir, '.specs/compose-demo/T01-SUMMARY.md', '# T01-SUMMARY\n');
      writeFile(dir, '.specs/compose-demo/verdict.md', '# verdict\n');
      const res = runState(['status', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, '"currentNode": "codereview"');
    },
  },

  // 27: 通用层防线对自定义协议生效（AC-4）——自定义节点 exit 缺 evidence → BLOCKED（missing evidence）
  {
    name: '27 通用层防线（AC-4）：exit brainstorm 无 evidence → BLOCKED',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ currentNode: 'brainstorm', evidence: {} }));
      fs.mkdirSync(path.join(dir, '.specs', 'compose-demo'), { recursive: true });
      const res = runGuard(['exit', 'brainstorm', '--protocol', custom], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'missing evidence for Node brainstorm');
    },
  },

  // 28: 特化校验绑定反例（AC-5）——自定义节点 id（brainstorm）exit 不误触发内置 open 特化校验：
  // 场景内置 open 特化校验的诱饵（CHANGE.md 缺 Why + REQUIREMENT 缺验收段），若误触发必 BLOCKED
  {
    name: '28 特化校验绑定反例（AC-5b）：brainstorm exit 不误触发内置特化校验',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n'); // brainstorm 产物（artifact 门控）
      writeFile(dir, '.specs/compose-demo/CHANGE.md', '# CHANGE\n\n## 变更目标\n\n## 方案\n');
      writeFile(dir, '.specs/compose-demo/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 需求分析\n');
      const res = runGuard(['exit', 'brainstorm', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, '缺必填段');
      assertNotOut(res, '缺少验收标准');
    },
  },

  // 29: 协议 env 加载（AC-2/3）——FLOW_COMET_PROTOCOL 指向场景内自定义协议（无 --protocol CLI）
  // guard 从 env 加载自定义协议：若 env 被忽略（回退 packageRoot 内置 8 节点协议）→ Unknown Node 报错
  {
    name: '29 自定义协议 env 加载：FLOW_COMET_PROTOCOL 生效',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runGuard(['exit', 'brainstorm'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, 'Unknown workflow Node');
    },
  },

  // 30: hook 白名单缺省（AC-6）——自定义协议无 writeWhitelist → hook 回退内置缺省表。
  // a) 无活跃 state → 放行（不阻断）；b) 自定义节点 + 写 .specs/ → 放行；c) 内置 open + .specs/ → 放行；
  // d) 内置 open + 写源码 → BLOCKED（缺省表 open 仅允许 .specs/）
  {
    name: '30 hook 白名单缺省（AC-6）：协议无 writeWhitelist → 内置缺省表',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      // a) 无 state 文件 → 无活跃 workflow 放行
      const resA = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'index.ts') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(resA, 0);
      assertOut(resA, 'no active workflow');
      // b) 自定义协议 + 活跃 state（brainstorm）写 .specs/ 内文件 → 放行
      writeState(dir, composeState({ status: 'running' }));
      const resB = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(resB, 0);
      assertOut(resB, 'NODE: brainstorm');
      // c) 内置协议副本（同样无 writeWhitelist）+ open 写 .specs/ 内文件 → 缺省表放行
      const stC = baseState('open');
      stC.status = 'running';
      writeState(dir, stC);
      const resC = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'CHANGE.md') } });
      assertExit(resC, 0);
      assertOut(resC, 'NODE: open');
      // d) 内置协议副本 + open 写源码 → 缺省表拦截（BLOCKED exit 2）
      const resD = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'index.ts') } });
      assertExit(resD, 2);
      assertOut(resD, 'BLOCKED: phase "open" 不允许写入');
    },
  },

  // 31: --protocol CLI 优先于 env（AC-2）——env 指向内置副本（若 CLI 被忽略 → 内置协议无
  // brainstorm 节点 → Unknown Node 报错），CLI 指向自定义协议 → 走自定义协议通过
  {
    name: '31 --protocol CLI 优先于 FLOW_COMET_PROTOCOL env',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runGuard(['exit', 'brainstorm', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, 'Unknown workflow Node');
    },
  },

  // ----------  场景（自定义协议全部完成 → NEXT: done；部分完成仍走产物推导） ----------

  // 32: 自定义协议无 archive 节点，3 节点全部 exit 完成（completedNodes 含 brainstorm/tdd/codereview）
  // → next 输出 NEXT: done（修复前缺陷：determineNode 只按产物推导，全部完成仍输出 NODE: codereview）
  {
    name: '32 自定义协议全节点完成：next → NEXT: done',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'codereview',
        completedNodes: ['brainstorm', 'tdd', 'codereview'],
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      writeFile(dir, '.specs/compose-demo/T01-SUMMARY.md', '# T01-SUMMARY\n');
      writeFile(dir, '.specs/compose-demo/verdict.md', '# verdict\n');
      const res = runState(['next', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'NEXT: done');
      assertNotOut(res, 'NODE: codereview');
    },
  },

  // 33: 反例（防过度修复）——completedNodes 为空（部分完成）但产物全齐 → next 仍输出最后节点
  // codereview：产物推导继续生效，不因"全部完成 → done"判定误伤最后节点路由
  //  适配：currentNode=brainstorm 已记录 evidence（节点已工作）→ 不触发节点顺序 BLOCK；
  // completedNodes 仍为空，"部分完成但产物全齐 → 仍 NODE: codereview"断言保持不变
  {
    name: '33 反例：completedNodes 空但产物全齐 → 仍 NODE: codereview',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      writeFile(dir, '.specs/compose-demo/T01-SUMMARY.md', '# T01-SUMMARY\n');
      writeFile(dir, '.specs/compose-demo/verdict.md', '# verdict\n');
      const res = runState(['next', '--protocol', custom], dir);
      assertExit(res, 0);
      assertOut(res, 'NODE: codereview');
      assertNotOut(res, 'NEXT: done');
    },
  },

  // ----------  场景（handoff completedChecks 严格校验，handoff-guarded 落实） ----------

  // 34: subagent-execute exit 通过——handoff result 的 completedChecks 含 required-skill 条目 → exit 0
  {
    name: '34 subagent-execute exit 通过：handoff 含 completedChecks',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = {
        summary: 'delegated and collected',
        handoffResult: handoffFor(['P01']),
      };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 35: subagent-execute exit BLOCKED——handoff result 缺 completedChecks（严格模式，无旧 change 豁免）
  // → exit 1：旧格式/缺 completedChecks 的 handoff 在 subagent-execute 重入时被硬性拦截
  {
    name: '35 subagent-execute exit BLOCKED：handoff 缺 completedChecks',
    run: (dir) => {
      const st = baseState('subagent-execute');
      const hr = handoffFor(['P01']);
      delete hr['P01'].result.completedChecks;
      st.evidence['subagent-execute'] = { summary: 'delegated and collected', handoffResult: hr };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'completedChecks');
    },
  },

  // ----------  场景（next 节点顺序校验，严格模式） ----------

  // 36: next BLOCKED——currentNode=open 未 exit（completedNodes 空 + evidence 无 open 记录）
  // → 上一节点未 exit 就推进 → 严格拦截，输出恢复指令（先 exit open --apply）
  {
    name: '36 next BLOCKED：currentNode=open 未 exit（completedNodes 空）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 open');
      assertOut(res, 'workflow-guard.mjs exit open --apply');
    },
  },

  // 37: next 正常——open 已 exit（completedNodes 含 open）+ 当前节点 evidence 已记录 → 正常推进
  // （状态漂移校正保留：已完成节点正常推进不受严格校验影响）
  {
    name: '37 next 正常：open 已 exit 后正常推进',
    run: (dir) => {
      const st = baseState('design');
      st.completedNodes = ['open'];
      st.evidence.design = { summary: 'design in progress' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'NODE: design');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // ----------  场景（redEvidence 时间顺序校验） ----------

  // 38: handoff result 时间顺序通过——先记录 redEvidence（TDD RED），再补 greenEvidence（GREEN）
  // → 两次均通过；且 evidence 中 redEvidence/greenEvidence 附带 recordedAt 时间戳
  // （重录保留 red 首次记录时间，green 为补录时间——时序可审计）
  {
    name: '38 handoff red 先于 green 通过（redEvidence/greenEvidence 附带 recordedAt）',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const redOnly = '{"redEvidence":{"command":"node --check src/p1.mjs"}}';
      const res1 = runHandoff(['result', 'P01', redOnly], dir);
      assertExit(res1, 0);
      assertOut(res1, 'HANDOFF RESULT: P01');
      const both = '{"redEvidence":{"command":"node --check src/p1.mjs"},"greenEvidence":{"command":"node --check src/p1.mjs"}}';
      const res2 = runHandoff(['result', 'P01', both], dir);
      assertExit(res2, 0);
      assertOut(res2, 'HANDOFF RESULT: P01');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const rec = st.evidence['subagent-execute'].handoffResult['P01'].result;
      if (!rec.redEvidence.recordedAt || typeof rec.redEvidence.recordedAt !== 'string') {
        throw new Error('redEvidence 未附带 recordedAt: ' + JSON.stringify(rec.redEvidence));
      }
      if (!rec.greenEvidence.recordedAt || typeof rec.greenEvidence.recordedAt !== 'string') {
        throw new Error('greenEvidence 未附带 recordedAt: ' + JSON.stringify(rec.greenEvidence));
      }
    },
  },

  // 39: handoff result BLOCKED——已记录 greenEvidence（无 redEvidence）后同批补录 redEvidence
  // → redEvidence 事后补录（TDD 要求 RED 先于 GREEN），exit 1
  {
    name: '39 handoff BLOCKED：greenEvidence 后同批补录 redEvidence',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const greenOnly = '{"greenEvidence":{"command":"node --check src/p1.mjs"}}';
      const res1 = runHandoff(['result', 'P01', greenOnly], dir);
      assertExit(res1, 0);
      const backfill = '{"greenEvidence":{"command":"node --check src/p1.mjs"},"redEvidence":{"command":"node --check src/p1.mjs"}}';
      const res2 = runHandoff(['result', 'P01', backfill], dir);
      assertExit(res2, 1);
      assertOut(res2, 'redEvidence 事后补录');
    },
  },

  // ----------  场景（C3 签名行尾规范化 + 回退豁免） ----------

  // 40: execute exit 通过——TASK.md 从 LF 行尾改写为 CRLF（bash heredoc → python os.linesep
  // 跨工具编辑），任务集逻辑未变 → 签名一致（行尾规范化），不误报"任务集被修改"
  {
    name: '40 execute exit 通过：TASK LF→CRLF 行尾变化签名一致',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      // LF 版本任务集（enter 时记录签名）
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 同一任务集改写为 CRLF 行尾（仅行尾差异，逻辑内容不变）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF.replace(/\n/g, '\r\n'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent()); // M2: 新 change 强制 done 任务须有 SUMMARY
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 41: execute exit BLOCKED——TASK.md 任务内容实际变化（改 action 文本）→ 签名不同 → 严格拦截
  {
    name: '41 execute exit BLOCKED：任务内容变化签名不同',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 逻辑内容变化（T01 action 文本被改），行尾保持 LF 不变
      const changed = taskLF.replace('实现 T01', '实现 T01 并补充单元测试');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', changed);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'TASK.md 任务集被修改');
    },
  },

  // 42: next 回退豁免通过——verify 未 exit（completedNodes 无 verify + evidence 无 verify 记录）
  // 但 TASK.md 存在 pending 修复任务且 determineNode 推导为 execute → 允许标准回退路径
  // （verify 发现缺陷 → 回 execute），不 BLOCK，输出 NODE: execute
  {
    name: '42 next 回退豁免：verify 未 exit + pending 修复任务 → 允许回 execute',
    run: (dir) => {
      const st = baseState('verify');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      // 前置产物（preExec 门控：open/design/plan 的 CHANGE/REQUIREMENT/DESIGN/TASK）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      // 既有 done 任务 + verify 阶段追加的 pending 修复任务
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P1 + TASK_TFIX);
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 43: next 维持严格 BLOCK——verify 未 exit（evidence 无 verify 记录）且 TASK.md 无 pending
  // 任务（非修复回退）→ 豁免不成立 → 维持  严格拦截，输出恢复指令
  {
    name: '43 next 维持 BLOCK：无 pending 任务（非修复任务回退）',
    run: (dir) => {
      const st = baseState('verify');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      // 全部 done（无 pending）——正常推进场景不豁免
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE + TASK_P1);
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 verify');
      assertOut(res, 'workflow-guard.mjs exit verify --apply');
    },
  },

  // ----------  场景（C3 签名标记类属性剥离——completed_at 误报修复） ----------

  // 44: execute exit 通过——enter 后子代理在 task 开标签追加 completed_at 标记属性
  // （标记 task done 的时序属性，纯状态标记不影响任务集逻辑）→ 签名不受标记属性影响，不误报 BLOCK
  {
    name: '44 execute exit 通过：追加 completed_at 标记属性签名一致',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 子代理标记 task done：T01 开标签追加 completed_at 属性（其余逻辑内容不变）
      const marked = taskLF.replace('id="T01"', 'id="T01" completed_at="2026-08-07"');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', marked);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent()); // M2: 新 change 强制 done 任务须有 SUMMARY
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 45: execute exit BLOCKED——追加 completed_at 标记属性 + 任务内容（action）实际变化
  // → 标记属性剥离不越界：内容仍签名敏感 → 严格拦截"任务集被修改"
  {
    name: '45 execute exit BLOCKED：completed_at 标记属性 + action 变化签名不同',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      const taskLF = '# TASK\n\n' + TASK_DONE + TASK_P1;
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskLF);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 内容实际变化（T01 action 文本被改）+ 同时追加 completed_at 标记属性
      const changed = taskLF
        .replace('id="T01"', 'id="T01" completed_at="2026-08-07"')
        .replace('实现 T01', '实现 T01（改）');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', changed);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'TASK.md 任务集被修改');
    },
  },

  // ----------  场景（next 正常推进豁免——exit 推进后的正常 next 不再被误拦） ----------

  // 46: next 正常推进豁免通过——open exit --apply 已把 currentNode 推进到 design（completedNodes=['open']、
  // design 尚未开始故 evidence 无 design 记录），随后按 SKILL 协议调 next（正常路径）→ 不 BLOCK，
  // 输出 NODE: design（ 误拦回归：修复前此状态被 BLOCK 为"疑似未 exit 节点 design"；
  // open 的 evidence 证明该 exit 真实发生过，满足 normalAdvanceExempt）
  {
    name: '46 next 正常：open exit 推进后 currentNode=design 无 evidence（修复任务回退豁免）',
    run: (dir) => {
      const st = baseState('design');
      st.completedNodes = ['open'];
      st.evidence.open = { summary: 'open done' };
      writeState(dir, st);
      // open exit 已通过的产物（design 尚未开始，无 DESIGN.md）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'NODE: design');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 47: next 维持严格 BLOCK——真乱序跳节点：currentNode=review 但 completedNodes 仅 ['open']
  // （open 已 exit 且有 evidence）→ review 不是 open 的路由直接后继（open 的后继是 design）
  // →  豁免不成立（回退豁免也不成立：TASK.md 无 pending）→ 严格拦截核心价值
  // 保持（跳节点仍严格拦截），输出恢复指令
  {
    name: '47 next BLOCKED：跳节点乱序（completedNodes 仅 open，currentNode=review）',
    run: (dir) => {
      const st = baseState('review');
      st.completedNodes = ['open'];
      st.evidence.open = { summary: 'open done' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 review');
      assertOut(res, 'workflow-guard.mjs exit review --apply');
    },
  },

  // ----------  场景（机制交互组合——两个机制同时作用，防单机制测试盲区） ----------

  // 48: 组合盲区 A（对照组 A 撞出）——record 覆盖语义 × 越俎代庖检测：先经 workflow-handoff
  // result 正确记录 T01 的 Return Contract（含 completedChecks），随后 record subagent-execute
  // '{"handoffResult":{}}'（浅合并整体替换 handoffResult 键）把已记录的 handoff 覆盖丢失 →
  // exit execute 的越俎代庖检测（统一委托下 done 任务必须有 handoff）BLOCK——
  // 组合语义：record 的"整体覆盖"不是无害操作，会连带破坏委托证明链（T01 合法 done 变越俎代庖）
  {
    name: '48 execute exit BLOCKED：record 覆盖 handoff（越俎代庖）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      // ① workflow-handoff result 正确记录 T01 的 Return Contract（含 completedChecks）
      const res = runHandoff(['result', 'T01', JSON.stringify({
        commitHash: 'abcd1234',
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/t1.mjs' },
        redEvidence: { command: 'node --check src/t1.mjs' },
      })], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF RESULT: T01');
      // ② record subagent-execute '{"handoffResult":{}}' 整体覆盖 evidence['subagent-execute']
      //（浅合并替换 handoffResult 键）→ 已记录的 T01 handoff 丢失（对照组 A 踩坑路径）
      assertExit(runState(['record', 'subagent-execute', '{"handoffResult":{}}'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') }), 0);
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const hr = st2.evidence['subagent-execute'] && st2.evidence['subagent-execute'].handoffResult;
      if (!hr || hr['T01']) {
        throw new Error('record 未整体覆盖 handoffResult（T01 应被覆盖丢失）: ' + JSON.stringify(st2.evidence['subagent-execute']));
      }
      // ③ exit execute：T01 done 但 handoff 已被覆盖丢失 → 越俎代庖 BLOCK
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 1);
      assertOut(res2, '越俎代庖');
    },
  },

  // 49（多趟语义翻转）：路由 × 节点推进——subagent-execute 已 completed（第一波 parallel 全 done +
  // exit，completedNodes 含该节点）后，第二波 parallel 任务（P02，depends 已满足）出现时：
  // next 重新路由回 subagent-execute（多趟循环路由——委托进入谓词每趟重新求值，单趟限制已移除）；
  // entry subagent-execute 仍放行（completedNodes 含该节点允许重入——每趟完整 entry 检查不绕过）
  {
    name: '49 next 二次路由回 subagent-execute + entry 重入（多趟语义）',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2_PENDING + TASK_T03_PENDING);
      const st = baseState('subagent-execute');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      st.evidence['subagent-execute'] = { summary: 'wave1 delegated and collected' };
      writeState(dir, st);
      // ① next：第二波 eligible 并行存在 → 多趟路由回该节点（旧单趟「不回流」行为已移除）
      const res = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // ② entry subagent-execute：completedNodes 含该节点仍可重入（每趟完整 entry 检查）
      const res2 = runGuard(['entry', 'subagent-execute'], dir);
      assertExit(res2, 0);
      assertOut(res2, 'ENTRY OK');
    },
  },

  // ---------- 审查补充场景（2026-08-08：validateProtocolSchema nodes 校验 / 豁免 summary 严格化 / hook 声明模式 fail-closed） ----------

  // 50: validateProtocolSchema 拒绝空 node（自定义协议 nodes 含空对象 → 加载报错 fail-closed）
  {
    name: '50 自定义协议空 node：schema 校验拒绝（审查补充）',
    run: (dir) => {
      const badProtocol = customProtocol();
      badProtocol.nodes.push({});
      writeFile(dir, 'bad-protocol.json', JSON.stringify(badProtocol, null, 2) + '\n');
      const res = runState(['status', '--protocol', path.join(dir, 'bad-protocol.json')], dir);
      assertExit(res, 1);
      assertOut(res, 'workflow protocol node must have a non-empty string id');
    },
  },

  // 51: normalAdvanceExempt 空对象 evidence 不豁免（completedNodes 最后节点 evidence 是 {} → next BLOCK）
  {
    name: '51 next BLOCKED：豁免节点 evidence 为空对象（审查补充）',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({
        currentNode: 'tdd',
        completedNodes: ['brainstorm'],
        evidence: { brainstorm: {} },
      }));
      writeFile(dir, '.specs/compose-demo/notes.md', '# notes\n');
      const res = runState(['next', '--protocol', custom], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
    },
  },

  // 52: 协议声明 writeWhitelist 未列出节点 → hook BLOCK（fail-closed）
  {
    name: '52 hook BLOCKED：writeWhitelist 未声明节点（审查补充）',
    run: (dir) => {
      const custom = customProtocol();
      custom.writeWhitelist = { brainstorm: ['.specs/'] };
      writeFile(dir, 'partial-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running', currentNode: 'tdd' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'partial-protocol.json') });
      assertExit(res, 2);
      assertOut(res, '未在协议 writeWhitelist 中声明');
    },
  },

  // ----------  场景（分支前缀可配置，适配仓库规范） ----------

  // 53: init --branch-prefix feat/ → 分支创建为 feat/<id>（适配仓库规范如 feat/）
  {
    name: '53 init --branch-prefix feat/ 创建 feat/<id> 分支',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const res = runState(['init', 'prefix-test', '--branch-prefix', 'feat/'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'BRANCH: feat/prefix-test');
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      if (branch !== 'feat/prefix-test') {
        throw new Error('期望分支 feat/prefix-test，实际 ' + branch);
      }
    },
  },

  // 54: 一致性校验用 state.branchPrefix（status 显示 ok）
  {
    name: '54 status 一致性：branchPrefix=feat/ 分支 feat/<id> → ok',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['checkout', '-b', 'feat/pref-state'], { cwd: dir, stdio: 'ignore' });
      const st = baseState('open');
      st.activeChange = 'pref-state';
      st.branchPrefix = 'feat/';
      writeState(dir, st);
      writeFile(dir, '.specs/pref-state/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/pref-state/REQUIREMENT.md', '# REQUIREMENT\n## 用户故事\nx\n## 验收准则（AC）\nx\n');
      const res = runState(['status'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, '一致性: ok');
    },
  },

  // ----------  场景（init 写 status + hook 判定对齐） ----------

  // 55: init 生成的 state 必须含 status:'running'（当前缺——hook 判定不一致的根源）
  {
    name: '55 init state 含 status: running',
    run: (dir) => {
      const res = runState(['init', 'tf15-st'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.status !== 'running') {
        throw new Error('init state 缺 status: running，实际: ' + JSON.stringify(st.status));
      }
    },
  },

  // 56: init 后（open 阶段）越权写源码 → hook BLOCK（当前因 status undefined 放行——三层防线缺口）
  {
    name: '56 hook BLOCKED：init 后越权写源码',
    run: (dir) => {
      const initRes = runState(['init', 'tf15-hk'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(initRes, 0);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 2);
    },
  },

  // 57: status:'completed'（归档后状态）→ hook 放行（当前 exit 1 拦截全部写入）
  {
    name: '57 hook 放行：status completed 归档后状态',
    run: (dir) => {
      writeState(dir, composeState({ status: 'completed', activeChange: null, currentNode: null }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'anything.md') } });
      assertExit(res, 0);
    },
  },

  // ----------  场景（init 创建 .specs/<id>/ 目录，findActiveChange 立即可识别） ----------

  // 58: init 后 next 识别 active change（当前因 .specs/<id>/ 目录未建报 No active change）
  {
    name: '58 init 后 next 识别 active change',
    run: (dir) => {
      const initRes = runState(['init', 'tf16-dir'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(initRes, 0);
      const res = runState(['next'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, '疑似未 exit 节点 open');
      assertNotOut(res, 'No active change');
    },
  },

  // ----------  场景（归档完成态不兜底识别残留目录） ----------

  // 59: state 为归档完成态（completed + activeChange null）→ .specs/ 顶层残留目录（含 TASK.md）不被兜底识别
  {
    name: '59 归档后残留目录不误判为 active',
    run: (dir) => {
      writeState(dir, composeState({ status: 'completed', activeChange: null, currentNode: null }));
      writeFile(dir, '.specs/stale/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/stale/TASK.md', '# TASK\n');
      const res = runState(['status'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'no-change');
      assertNotOut(res, 'stale');
    },
  },

  // ----------  场景（init currentNode 按协议首节点） ----------

  // 60: 自定义协议 init → currentNode = 协议首节点 brainstorm（当前硬编码 open——）
  {
    name: '60 init currentNode 按协议首节点',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const initRes = runState(['init', 'tf18-cp'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(initRes, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.currentNode !== 'brainstorm') {
        throw new Error('init currentNode 应为协议首节点 brainstorm，实际: ' + JSON.stringify(st.currentNode));
      }
    },
  },

  // ---------- 补齐场景（兼容分支固化） ----------

  // 61: 旧 state（无 status 字段但有 activeChange）→ hook 按 running 处理（fail-closed 向后兼容，行为固化）
  {
    name: '61 hook fail-closed：旧 state 无 status 有 activeChange 按 running（既有修复固化）',
    run: (dir) => {
      const st = baseState('open');
      delete st.status;
      st.activeChange = 'legacy-change';
      writeState(dir, st);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 2);
    },
  },

  // 62: init 后（open 阶段）合法写 .specs/ 工件 → hook 放行（ 正确 RED：
  // 修复前 init 无 status → hook「not running」throw exit 1 拦截合法写入——open 阶段无法产出工件）
  {
    name: '62 hook 放行：init 后写 .specs/ 工件',
    run: (dir) => {
      const initRes = runState(['init', 'tf15-ok'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(initRes, 0);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'tf15-ok', 'CHANGE.md') } });
      assertExit(res, 0);
      assertOut(res, 'NODE: open');
    },
  },

  // 63: 新 change 与旧归档同名（state 缺失时走扫描兜底）→ 应识别为 active（ 扩展边界：
  // archivedIds 剥日期前缀匹配不得误伤同名新 change）
  {
    name: '63 同名新 change 不被归档检查误跳过',
    run: (dir) => {
      writeFile(dir, '.specs/sci-notation/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/sci-notation/TASK.md', '# TASK\n');
      writeFile(dir, '.specs/archive/2026-08-08-sci-notation/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runState(['status'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, '"change": "sci-notation"');
    },
  },

  // ---------- 独立验证补充场景（验证者发现） ----------

  // 64: record 命令的 --protocol 参数不得污染 payload（：payload 解析前剥离）
  {
    name: '64 record --protocol 不污染 payload',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const initRes = runState(['init', 'tf14-rec'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(initRes, 0);
      const res = runState(['record', 'open', '{"summary":"x","completedChecks":["a"]}', '--protocol', custom], dir);
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const ev = st.evidence.open || {};
      if (ev.summary !== 'x') {
        throw new Error('summary 被污染，应为 "x"，实际: ' + JSON.stringify(ev.summary));
      }
      if (ev.completedChecks === undefined) {
        throw new Error('completedChecks 丢失（payload 未解析为对象）: ' + JSON.stringify(ev));
      }
    },
  },

  // 65: 自定义协议未声明 writeWhitelist 时，非内置节点写源码 → BLOCK（ 方案 B：
  // 协调者默认 .specs/——当前 fail-open 放行）
  {
    name: '65 自定义节点未声明白名单写源码 BLOCK',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 2);
    },
  },

  // 66: 自定义协议未声明白名单时，写 .specs/ 工件 → 放行（ 协调者默认的正面）
  {
    name: '66 自定义节点未声明白名单写工件放行',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'NODE: brainstorm');
    },
  },

  // 67: 旧格式 state（无 status 字段 + 无 activeChange + 无 currentNode——批次 C 归档后升级场景）
  // → hook 放行（：无 activeChange 与无 state 文件同语义——当前被「not running」拦截）
  {
    name: '67 旧 state 无 status 无 activeChange hook 放行',
    run: (dir) => {
      const st = baseState('open');
      delete st.status;
      st.activeChange = null;
      st.currentNode = null;
      writeState(dir, st);
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.py') } });
      assertExit(res, 0);
    },
  },

  // 68: writeWhitelist 路径支持 <change-id> 占位符（：协议复用自动适配——
  // 与 artifacts paths 同机制——当前字面匹配失败 BLOCK）
  {
    name: '68 writeWhitelist change-id 占位符',
    run: (dir) => {
      const custom = customProtocol();
      custom.writeWhitelist = { brainstorm: ['.specs/<change-id>/'] };
      writeFile(dir, 'ph-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running' }));
      // 写 .specs/compose-demo/（占位符替换为 activeChange=compose-demo）→ 放行
      const r1 = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'ph-protocol.json') });
      assertExit(r1, 0);
      // 写 .specs/other/（不在白名单）→ BLOCK
      const r2 = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'other', 'x.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'ph-protocol.json') });
      assertExit(r2, 2);
    },
  },

  // 69: 自定义协议 init 输出 NODE: 协议首节点（：printNext 硬编码 open——输出与 state 不一致）
  {
    name: '69 init 输出 NODE 协议首节点',
    run: (dir) => {
      const custom = writeCustomProtocol(dir);
      const res = runState(['init', 'tf17-out'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(res, 0);
      assertOut(res, 'NODE: brainstorm');
      assertNotOut(res, 'NODE: open');
    },
  },

  // 70: state completed + activeChange 非空（残留值）→ status 应 no-change（：
  // completed 检查优先于 activeChange 分支——当前 activeChange 分支先命中误判）
  {
    name: '70 completed state 残留 activeChange 不误判',
    run: (dir) => {
      const st = composeState({ status: 'completed', currentNode: null });
      st.activeChange = 'stale-id';
      writeState(dir, st);
      writeFile(dir, '.specs/stale-id/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/stale-id/TASK.md', '# TASK\n');
      const res = runState(['status'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'no-change');
    },
  },

  // 71: 自定义协议未声明 state.statePath（最小 schema）→ hook 不崩溃，写 .specs/ 放行
  // （：statePath 缺省回退 .flow-comet/flow-comet-state.json——与 workflow-state 硬编码一致；
  //  当前空值解析崩溃 exit 1 全量拦截）
  {
    name: '71 无 statePath 协议 hook 不崩溃',
    run: (dir) => {
      const custom = customProtocol();
      delete custom.state;
      writeFile(dir, 'nostate-protocol.json', JSON.stringify(custom, null, 2) + '\n');
      writeState(dir, composeState({ status: 'running' }));
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'notes.md') } },
        { FLOW_COMET_PROTOCOL: path.join(dir, 'nostate-protocol.json') });
      assertExit(res, 0);
    },
  },

  // 72: state 文件带 UTF-8 BOM（外部写入如会话 Write）→ status 正常输出（：
  // 读端 JSON.parse 应容忍 BOM——当前崩）
  {
    name: '72 state 带 BOM 正常读取',
    run: (dir) => {
      const st = composeState({ status: 'running' });
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.flow-comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), raw, 'utf8');
      writeFile(dir, '.specs/compose-demo/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runState(['status'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, '"status": "running"');
    },
  },

  // 73: hook 读带 BOM 的 state → 判定正常（——hook readStateJson 的 BOM 容忍）
  {
    name: '73 hook 读带 BOM state 正常',
    run: (dir) => {
      const st = baseState('open');
      st.status = 'running';
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.flow-comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), raw, 'utf8');
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', 'compose-demo', 'CHANGE.md') } });
      assertExit(res, 0);
      assertOut(res, 'NODE: open');
    },
  },

  // ----------  场景（builtin 降级须含缓存尝试证据） ----------

  // 74: builtin-quickcheck 声明 + 不可用原因但无缓存尝试证据 → BROOKS-LINT WARN
  // （：防「未尝试 Read 插件缓存协议文件」的偷懒降级——修复前不校验 = RED）
  {
    name: '74 builtin 无缓存尝试证据 → WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbuiltin-quickcheck — brooks-lint 不可用（Skill 仅返回占位，插件执行体未加载），按协议降级内置 R1~R6 快查',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 75: cache-brooks 声明（两级降级路径第 2 级——读缓存手动执行成功）→ 放行
  // （ 补：guard method 正则须识别 cache-brooks——修复前正则不匹配 → 全文无 brooks-review/builtin → BLOCKED = RED）
  {
    name: '75 cache-brooks 声明 → 放行',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\ncache-brooks — 已 Read 插件缓存协议文件手动执行完整审查（4-element + file:line + 书引用），结果见「6 维自查」',
        sixDim: '## 6 维自查\n\n- 功能: 通过（cache-brooks 审查已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 76: builtin-quickcheck 声明 + 不可用原因 + 含缓存尝试证据（已 Read 插件缓存协议文件）→ 无 WARN 放行
  // （ 正面：两级降级路径的第 2 级被正确执行后的合法态）
  {
    name: '76 builtin 含缓存尝试证据 → 无 WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbuiltin-quickcheck — 已尝试 Skill 加载（仅占位）并已 Read 插件缓存协议文件（~/.claude/plugins/cache/brooks-lint-marketplace/...）手动执行，仍不可行，brooks-lint 不可用，按协议降级内置 R1~R6 快查',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 77: guard 读带 BOM 的 state → 正常（——guard readStateJson 的 BOM 容忍）
  {
    name: '77 guard 读带 BOM state 正常',
    run: (dir) => {
      const st = baseState('open');
      st.status = 'running';
      const raw = '﻿' + JSON.stringify(st, null, 2) + '\n';
      fs.mkdirSync(path.join(dir, '.flow-comet'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), raw, 'utf8');
      writeFile(dir, '.specs/compose-demo/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const res = runGuard(['entry', 'open'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
    },
  },

  // ----------  场景（worktree 委托链路，验证问题实录） ----------

  // 78: 路由诊断——「未找到可委托并行块」诊断的在场/静默边界。期望随 multipass-exit-hardening
  // ROUTE WARN 前置条件语义更新（ROUTE WARN 增加存在任一 status=pending 的前置条件）：① 夹具存在可解析 pending
  // 任务（串行 pending + 并行全 done）且无可委托并行块 → ROUTE WARN 保持在场（检测失败纠偏可见
  // ——信息量保留）；② 旧模板无 status 属性形态（无可解析 pending）→ 按新前置条件静默
  // （原「旧模板也告警」行为被设计性取代）。
  // nextNode 只看 completedNodes——路由触发场景 = exit plan（completed 后 nextNode=execute → 路由检查）
  {
    name: '78 路由诊断：有 pending 无可委托并行 WARN 在场 / 无可解析 pending 静默',
    run: (dir) => {
      const st = baseState('plan');
      st.completedNodes = ['open', 'design'];
      st.evidence.plan = { summary: 'executed' };
      writeState(dir, st);
      // 上游工件（open=CHANGE+REQUIREMENT、design=DESIGN-lite、plan=TASK）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n## Why\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n## 用户故事\nx\n## 验收准则（AC）\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN-lite.md', '# DESIGN-lite\n## 决策清单\n- d1: x\n');
      // ① 可解析 pending 在场且剩余全串行（并行已 done、串行 pending、无缺 status 畸形块）
      // → M4 静默（P→S 收尾转换无噪音——① 语义随扩展翻转）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P01" parallel="true" status="done">\n  <action>do</action>\n  <verify>echo ok</verify>\n</task>\n' +
        '<task id="T01" parallel="false" status="pending">\n  <action>do serial</action>\n  <verify>echo ok</verify>\n</task>\n');
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const res = runGuard(['exit', 'plan', '--apply'], dir, env);
      assertExit(res, 0);
      assertNotOut(res, 'ROUTE WARN');
      // ② 旧模板无 status 属性（无可解析 pending）→ 前置条件跳过诊断 → 静默
      //（① 的 --apply 已把 currentNode 推进到 execute——先复位 state 再独立跑第二半）
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T02" parallel="true">\n  <action>do legacy</action>\n  <verify>echo ok</verify>\n</task>\n');
      const resLegacy = runGuard(['exit', 'plan', '--apply'], dir, env);
      assertExit(resLegacy, 0);
      assertNotOut(resLegacy, 'ROUTE WARN');
    },
  },

  // 79: C4 catch 可见化——非 git 仓库 → entry execute 输出 C4-CHECK SKIP
  // （检测失败也要可见——修复前 catch 静默 = RED）
  {
    name: '79 C4 catch 非 git 仓库输出 SKIP',
    run: (dir) => {
      const st = baseState('execute');
      writeState(dir, st);
      const res = runGuard(['entry', 'execute'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'C4-CHECK SKIP');
    },
  },

  // 80: handoff result commitHash 存在性校验——不存在 → HANDOFF ERROR（固化：校验已存在（W2-D），经确认）
  {
    name: '80 handoff result 无效 commitHash → ERROR（batch-H 固化）',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
      const payload = JSON.stringify({
        status: 'DONE',
        commitHash: 'deadbeef00000000000000000000000000000000',
        redEvidence: { command: 'echo red', output: 'red' },
        greenEvidence: { command: 'echo green', output: 'green' },
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        riskSignals: ['none'],
      });
      const res = runHandoff(['result', 'T01', payload], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF ERROR: commitHash 无效或 git show 失败');
    },
  },

  // 81: entry/exit WARN COUNT 汇总行——构造 BROOKS-LINT WARN → exit 输出 WARN COUNT
  // （ F：可观测性——修复前无汇总行 = RED）
  {
    name: '81 exit 输出 WARN COUNT 汇总',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbuiltin-quickcheck — brooks-lint 不可用（Skill 仅返回占位，插件执行体未加载），按协议降级内置 R1~R6 快查',
      }));
      const res = runGuard(['exit', 'execute'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'BROOKS-LINT WARN');
      assertOut(res, 'WARN COUNT:');
    },
  },

  // 82: 空退出行为固化——全 parallel 任务 exit execute → task-summaries BLOCKED（现状保护，H1 文档一致化的行为锚点）
  {
    name: '82 全 parallel exit execute BLOCKED 产物（batch-H 固化）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" parallel="true" status="pending">\n  <action>do</action>\n</task>\n<task id="T02" parallel="true" status="pending">\n  <action>do2</action>\n</task>\n');
      const res = runGuard(['exit', 'execute'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, 'missing Output Schema artifacts');
    },
  },

  // 83~91: 自动初始化检测（auto-init-detection）——脚本确定性探测/判决/提示 + agent 生成协作
  // 生成职责（2026-08-10 机制修正）：--init-context 时 CONTEXT 缺失 → INIT-GENERATE 指引（不生成、
  // 不写 last_intel_scan），由 agent 全量阅读生成；生成后重跑 → 脚本校验 7 段 → 通过写 last_intel_scan。
  // 83: CONTEXT 缺失 + 有代码上下文 → init 输出 INIT-NEEDED 且不自动生成（基础探测）
  {
    name: '83 CONTEXT 缺失 + 有代码 → init 输出 INIT-NEEDED 不生成',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-NEEDED');
      if (fs.existsSync(path.join(dir, '.specs', 'CONTEXT.md'))) throw new Error('CONTEXT 不应被自动生成');
    },
  },

  // 84: --init-skip → state.ai_context_doc='none'，下次 init 不再提示（拒绝路径）
  {
    name: '84 --init-skip 记 none 且下次 init 静默',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      runState(['init', CHANGE_ID, '--init-skip'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      const st1 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st1.ai_context_doc !== 'none') throw new Error('ai_context_doc 应为 none');
      const res2 = runState(['init', CHANGE_ID + '-2'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      if (res2.output.includes('INIT-NEEDED') || res2.output.includes('INIT-HINT')) throw new Error('下次 init 不应再提示');
    },
  },

  // 85: CONTEXT 新鲜（last_intel_scan ≤90 天）→ init 零初始化输出（新鲜路径）
  {
    name: '85 CONTEXT 新鲜 → init 零初始化输出',
    run: (dir) => {
      writeState(dir, { ...baseState('open'), last_intel_scan: new Date(Date.now() - 10 * 864e5).toISOString() });
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      if (res.output.includes('INIT-NEEDED') || res.output.includes('INIT-HINT')) throw new Error('不应有初始化提示');
    },
  },

  // 86: 有 CONTEXT 无扫描记录（旧项目迁移）→ INIT-HINT 文案不得含 null
  {
    name: '86 有 CONTEXT 无扫描记录 → INIT-HINT 文案无 null',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-HINT');
      if (res.output.includes('null')) throw new Error('INIT-HINT 不应含 "null"（无扫描记录时用友好文案）');
    },
  },

  // 87: CONTEXT 缺失 + --init-context → INIT-GENERATE 指引且不生成、不写 last_intel_scan（生成协作第一步）
  {
    name: '87 --init-context 无 CONTEXT → INIT-GENERATE 指引不生成',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      if (fs.existsSync(path.join(dir, '.specs', 'CONTEXT.md'))) throw new Error('CONTEXT 不应由脚本生成（生成职责在 agent）');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('校验通过前不应写 last_intel_scan');
    },
  },

  // 88: CONTEXT 缺失 + 既有 AI 文档 + --init-context → INIT-GENERATE 指引含源文档列表
  {
    name: '88 --init-context 指引含源文档列表',
    run: (dir) => {
      writeFile(dir, 'CLAUDE.md', '# CLAUDE\n项目约定：使用 kebab-case 命名。\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      assertOut(res, 'CLAUDE.md');
    },
  },

  // 89: CONTEXT 缺失 + 代码信号 + --init-context → INIT-GENERATE 指引含代码信号
  {
    name: '89 --init-context 指引含代码信号',
    run: (dir) => {
      writeFile(dir, 'requirements.txt', 'pytest\n');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-GENERATE');
      assertOut(res, '代码信号');
    },
  },

  // 90: CONTEXT 已存在且 7 段 + 模板格式完整 + --init-context → INIT-DONE + last_intel_scan 写入（生成协作第二步）
  {
    name: '90 CONTEXT 7 段+格式完整 --init-context → INIT-DONE + state 写入',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- [2026-08-01] 决策一\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-DONE');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.last_intel_scan) throw new Error('校验通过后应写 last_intel_scan');
    },
  },

  // 91: CONTEXT 存在但缺段 + --init-context → INIT-VALIDATE-FAILED 重写指引 + 不写 last_intel_scan。
  // ② 段名判定须为**精确标题**匹配（非全文 includes）：段名变体（`## 技术栈补充`）与正文文本提及
  // 都不得算作段存在——旧 includes 判据下二者会假通过（校验放行 + 写 last_intel_scan）。
  // ③ 标题解析须先排除围栏代码块：代码示例里的 `## 段名` 不是段（否则缺段仍能假通过并写扫描时间）。
  {
    name: '91 CONTEXT 缺段 --init-context → 重写指引不写 state（含围栏代码块段名不假通过）',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      let res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      assertOut(res, '重写');
      let st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('校验失败不应写 last_intel_scan');
      // ② 段名变体（含正文提及）不满足必填段
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈补充\nx\n## 域语言说明\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策说明\n- [2026-08-01] 决策一\n## 默认偏好补充\nx\n## 既有抽象索引附录\nx\n## intel-scan 元数据附录\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n正文提及 域语言 与 默认偏好 与 既有抽象索引（文本非标题）。\n');
      res = runState(['init', CHANGE_ID + '-2', '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('段名变体不应通过校验（不应写 last_intel_scan）');
      // ③ 围栏代码块内的 `## 段名` 不计入标题集合：缺 `## 默认偏好`，但三种围栏形态——
      //    带语言标注的反引号围栏、缩进 2 空格的波浪线围栏、波浪线围栏——内都出现该段名。
      //    标题正则若不跟踪围栏边界，就会把这些示例行当成段存在 → 假通过并写扫描时间（RED）。
      writeFile(dir, '.specs/CONTEXT.md', [
        '# CONTEXT',
        '## 项目概要', 'x',
        '## 技术栈', 'x',
        '## 域语言', '| 术语 | 定义 |', '|---|---|', '| 例 | 定义 |',
        '## 已锁决策', '- [2026-08-01] 决策一',
        '## 既有抽象索引', 'x',
        '## intel-scan 元数据', '- **last_intel_scan**: x', '- **scanner**: x', '- **下次重扫建议**: x',
        '示例（以下均为代码示例，不是段）：',
        '```markdown', '## 默认偏好', '- 反引号围栏内的示例', '```',
        '  ~~~', '## 默认偏好', '  ~~~',
        '~~~text', '## 默认偏好', '~~~',
        '',
      ].join('\n'));
      res = runState(['init', CHANGE_ID + '-3', '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('围栏内的段名不应通过校验（不应写 last_intel_scan）');
    },
  },

  // 92: CONTEXT 7 段齐全但模板格式不满足（已锁决策无日期前缀）→ 格式校验失败重写指引 + 不写 state
  {
    name: '92 CONTEXT 格式不满足模板 → 重写指引不写 state',
    run: (dir) => {
      // 7 段齐全但已锁决策条目缺 [YYYY-MM-DD] 日期前缀（模板格式）
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- 决策缺日期前缀\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      assertOut(res, '日期');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('格式校验失败不应写 last_intel_scan');
    },
  },

  // 93: 新项目骨架 CONTEXT（已锁决策仅占位）→ 占位放行 INIT-DONE（DF-5：占位不是裸条目）
  {
    name: '93 新项目占位 CONTEXT → 校验通过 INIT-DONE',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\n新项目骨架\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| （待沉淀） | 随 change 逐步补充 |\n## 已锁决策\n- （待沉淀——后续 change 按时间倒序追加）\n## 默认偏好\n- 待补充\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-DONE');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.last_intel_scan) throw new Error('占位 CONTEXT 校验通过应写 last_intel_scan');
    },
  },

  // 94: CONTEXT 已满足模板但无扫描记录 + init 无参数 → 提示"记录扫描时间"（C 文案优化——
  // agent 生成后未重跑的悬空态，误导性"扫描时间未知/刷新"文案不出现）
  {
    name: '94 CONTEXT 就绪无扫描记录 → 提示记录扫描时间',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈\nx\n## 域语言\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策\n- [2026-08-01] 决策一\n## 默认偏好\nx\n## 既有抽象索引\nx\n## intel-scan 元数据\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n');
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, '记录扫描时间');
      if (res.output.includes('刷新')) throw new Error('CONTEXT 已就绪不应提示"刷新"（应提示记录扫描时间）');
    },
  },

  // 95: init 同 id 重跑（.specs/<id>/ 已存在）→ WARN 防护输出且不阻断（F）
  {
    name: '95 init 同 id 重跑 → WARN 防护不阻断',
    run: (dir) => {
      writeFile(dir, 'package.json', '{"name":"x"}');
      runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'WARN: change ' + CHANGE_ID + ' 已存在');
      assertOut(res, '重置节点状态');
    },
  },

  // 96~97: 真实项目端到端验证实证的校验误报修复（2026-08-10）
  // 96: 自检方法段内后续行声明方法（子代理把方法名写在列表后续行）→ 放行无 WARN
  // （修复前 guard 正则只匹配段后第一行 → 全文有 cache-brooks 声明 → 误报 BROOKS-LINT WARN = RED）
  {
    name: '96 自检方法段后续行声明 → 放行',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\n- flow-comet-dev Skill 加载成功\n- 自检：第 1 级 brooks-review 返回占位 → 第 2 级 Read 插件缓存协议文件手动执行（selfReview: cache-brooks）',
        sixDim: '## 6 维自查\n\n- 功能: 通过（cache-brooks 审查已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BROOKS-LINT WARN');
    },
  },

  // 97: handoff changedFiles 含任务专属 SUMMARY(.specs/<change-id>/<task-id>-SUMMARY.md,
  // 精确豁免路径)→ 不报越界 WARN;其他 *-SUMMARY.md(非本任务路径)仍判越界
  // (修复前 W2-D 以 endsWith('-SUMMARY.md') 全量豁免 + 前缀匹配 = RED;真实 commitHash 供 git show 校验)
  {
    name: '97 handoff 含 SUMMARY 文件 → 无越界 WARN',
    run: (dir) => {
      const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      g(['init', '-q']);
      g(['config', 'user.email', 't@t']);
      g(['config', 'user.name', 't']);
      writeFile(dir, 'test_stats.py', 'def f():\n    pass\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', '# T01-SUMMARY\n## 做了什么\nx\n');
      // 只提交指定文件（场景运行器预置的 reference/ 协议文件不入提交集）
      g(['add', 'test_stats.py', '.specs/' + CHANGE_ID + '/T01-SUMMARY.md']);
      g(['commit', '-qm', 'init']);
      const hash = g(['rev-parse', 'HEAD']).stdout.trim();
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = {
        handoffRequests: { T01: { writeFiles: ['test_stats.py'] } },
        handoffResult: {},
      };
      writeState(dir, st);
      const res = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', commitHash: hash,
        changedFiles: ['test_stats.py', '.specs/' + CHANGE_ID + '/T01-SUMMARY.md'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check test_stats.py', output: 'ok' },
      })], dir);
      assertExit(res, 0);
      if (res.output.includes('超出 writeFiles 范围')) throw new Error('任务专属 SUMMARY 不应报越界 WARN');
    },
  },

  // ----------  场景（completedChecks 真实性声明机制——skill-load/record/exit 校验 + 交叉自洽 + 旧兼容 + 场景数同步） ----------

  // 98: skill-load 写入声明标记（AC-1）——完整命令形态（--prompt flow-kit/prompts/<阶段>.md，
  // 归属校验通过）→ 标记 .specs/<change-id>/.skill-loads/<node>-<skill>.json 生成，
  // 内容含 node/skill/protocol/at（ISO 时间戳）+ 输出确认提示
  {
    name: '98 skill-load 写入声明标记（AC-1）',
    run: (dir) => {
      // 场景内 flow-kit/prompts/ 提示文件（skill-load --prompt 指向——改名 --prompt 后归属校验仅查
      // 前缀不读内容；协议加载走 env reference 路径，文件无需为 JSON）
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'SKILL-LOAD: open flow-comet-change → .skill-loads/open-flow-comet-change.json');
      const markerPath = path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json');
      if (!fs.existsSync(markerPath)) throw new Error('标记文件未生成: ' + markerPath);
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.node !== 'open' || marker.skill !== 'flow-comet-change') {
        throw new Error('标记 node/skill 字段不符: ' + JSON.stringify(marker));
      }
      // 标记 protocol = --prompt 参数的 basename（与 guard exit 的 节点协议映射表比对同值，
      // 真实链路 skill-load → exit 一致；缺陷修复前写 resolveProtocol 解析后的完整绝对路径，
      // 与 节点协议映射表 basename 精确比对必然失败——机制实际不可用，已修复）
      if (marker.protocol !== '0-change.md') {
        throw new Error('标记 protocol 应为 --prompt 参数的 basename 0-change.md: ' + JSON.stringify(marker));
      }
      if (typeof marker.at !== 'string' || Number.isNaN(Date.parse(marker.at))) {
        throw new Error('标记缺 ISO 时间戳 at: ' + JSON.stringify(marker));
      }
    },
  },

  // 99: skill-load 非法参数拒绝（AC-2）——缺 node/skill / node 非法 / skill 名非法字符 /
  // --prompt 不在 flow-kit/prompts/ 下 → 报错 exit 非 0，不写任何标记（.skill-loads/ 无文件）
  {
    name: '99 skill-load 非法参数拒绝不写标记（AC-2）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // a) 缺参数（无 node/skill）
      const rA = runState(['skill-load'], dir, env);
      assertExit(rA, 1);
      assertOut(rA, 'skill-load requires <node> <skill>');
      // b) node 非法（非内置节点）
      const rB = runState(['skill-load', 'bogus', 'flow-comet-change'], dir, env);
      assertExit(rB, 1);
      assertOut(rB, 'skill-load node 非法');
      // c) skill 名含非法字符
      const rC = runState(['skill-load', 'open', 'bad/name'], dir, env);
      assertExit(rC, 1);
      assertOut(rC, 'skill-load skill 名非法');
      // d) --prompt 不在 flow-kit/prompts/ 下（指向场景内 reference 副本——文件存在可加载，
      //    归属校验拒绝；若归属校验被跳过则此处会成功写标记，断言即失效）
      const rD = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'reference/workflow-protocol.json'], dir, env);
      assertExit(rD, 1);
      assertOut(rD, 'skill-load --prompt 路径必须位于 flow-kit/prompts/ 下');
      // e) 自定义协议下未知节点同样拒绝（node 校验从内置清单改为当前协议节点集合
      // 动态读取——协议外节点名依然非法，fail-closed 行为不变）
      const custom = writeCustomProtocol(dir);
      const rE = runState(['skill-load', 'bogus', 'flow-comet-change'], dir, { FLOW_COMET_PROTOCOL: custom });
      assertExit(rE, 1);
      assertOut(rE, 'skill-load node 非法');
      // 全部拒绝后 .skill-loads/ 不产生任何标记文件
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      if (fs.existsSync(loadsDir) && fs.readdirSync(loadsDir).length > 0) {
        throw new Error('非法参数不应写入标记: ' + fs.readdirSync(loadsDir).join(', '));
      }
    },
  },

  // 100: record 校验 BLOCK（AC-3 反例）——completedChecks 含 required-skill:open.flow-comet-change
  // 条目但无对应声明标记 → BLOCKED + 指引先加载 skill 并运行 skill-load；evidence 不写入
  {
    name: '100 record BLOCKED：completedChecks 缺声明标记（AC-3）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '缺少对应声明标记');
      assertOut(res, 'workflow-state.mjs skill-load open flow-comet-change');
      // BLOCK 先于记录——校验失败后 evidence 不得写入
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.evidence && st.evidence.open) throw new Error('BLOCKED 后不应写入 evidence: ' + JSON.stringify(st.evidence.open));
    },
  },

  // 101: record 校验通过（AC-3 正例）——先 skill-load 写入标记，record 带同条 completedChecks → 正常记录
  {
    name: '101 record 通过：先 skill-load 声明标记（AC-3 正例）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const sl = runState(['skill-load', 'open', 'flow-comet-change'], dir, env);
      assertExit(sl, 0);
      assertOut(sl, 'SKILL-LOAD: open flow-comet-change');
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir, env);
      assertExit(res, 0);
      assertOut(res, 'EVIDENCE: open');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.evidence.open || st.evidence.open.summary !== 'done') {
        throw new Error('record 未写入 evidence: ' + JSON.stringify(st.evidence));
      }
      // 自定义协议节点（compose 兼容）——node 校验按当前协议节点集合动态读取
      // （内置 + 自定义），自定义节点（brainstorm）可 skill-load 声明 + record 声明校验端到端通过
      // （修复前 BUILTIN_NODES 硬编码只含内置 8 节点 → skill-load 拒绝 brainstorm = RED）
      writeFile(dir, 'custom-protocol.json', JSON.stringify(customProtocolWithSkillCall(), null, 2) + '\n');
      const customEnv = { FLOW_COMET_PROTOCOL: path.join(dir, 'custom-protocol.json') };
      const slCustom = runState(['skill-load', 'brainstorm', 'flow-comet-brainstorm'], dir, customEnv);
      assertExit(slCustom, 0);
      assertOut(slCustom, 'SKILL-LOAD: brainstorm flow-comet-brainstorm');
      const resCustom = runState(['record', 'brainstorm', JSON.stringify({ summary: 'brainstorm done', completedChecks: ['required-skill:brainstorm.flow-comet-brainstorm'] })], dir, customEnv);
      assertExit(resCustom, 0);
      assertOut(resCustom, 'EVIDENCE: brainstorm');
    },
  },

  // 102: exit 协议声明标记校验（AC-4）+ 真实链路集成——.skill-loads/ 已激活
  // （目录存在）但无本节点协议标记（<node>-*.json 且 protocol ∈ 该节点协议集，节点协议映射表
  // basename）→ BLOCKED；真实 skill-load --prompt 写入的标记（protocol = basename）→ exit 通过
  // （修复后真实链路一致——缺陷修复前 skill-load 写解析后完整路径，exit 必 BLOCKED）；未传
  // --prompt（标记 protocol = null）→ BLOCKED；损坏标记（protocol 非协议集）→ BLOCKED
  {
    name: '102 exit 协议标记校验：真实链路通过 / 无标记·null·损坏 BLOCKED（AC-4）',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      // 场景内 flow-kit/prompts/ 提示文件（真实 skill-load --prompt 指向——归属校验仅查前缀不读内容）
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      fs.mkdirSync(loadsDir, { recursive: true });
      // ① 机制已激活（.skill-loads/ 存在）但无 open-* 标记（仅他节点标记）→ BLOCKED
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/design-flow-comet-design.json',
        JSON.stringify({ node: 'design', skill: 'flow-comet-design', protocol: '2-design.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resBlock = runGuard(['exit', 'open'], dir);
      assertExit(resBlock, 1);
      assertOut(resBlock, 'BLOCKED');
      assertOut(resBlock, 'exit 缺协议声明标记');
      // ② 真实链路：skill-load --prompt 写入标记（protocol = basename）→ exit 通过
      const markerPath = path.join(loadsDir, 'open-flow-comet-change.json');
      const sl = runState(['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md'], dir, env);
      assertExit(sl, 0);
      assertOut(sl, 'SKILL-LOAD: open flow-comet-change');
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.protocol !== '0-change.md') {
        throw new Error('skill-load 标记 protocol 应为 --prompt 参数的 basename 0-change.md: ' + JSON.stringify(marker));
      }
      const resPass = runGuard(['exit', 'open'], dir);
      assertExit(resPass, 0);
      assertOut(resPass, 'ALL CHECKS PASSED');
      assertNotOut(resPass, 'BLOCKED');
      // ③ skill-load 未传 --prompt → 标记 protocol = null → exit BLOCKED（fail-closed：
      // 无协议声明不可通过——指引补 skill-load --prompt）
      const slNull = runState(['skill-load', 'open', 'flow-comet-change'], dir, env);
      assertExit(slNull, 0);
      const markerNull = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (markerNull.protocol !== null) {
        throw new Error('skill-load 未传 --prompt 标记 protocol 应为 null: ' + JSON.stringify(markerNull));
      }
      const resNull = runGuard(['exit', 'open'], dir);
      assertExit(resNull, 1);
      assertOut(resNull, 'BLOCKED');
      assertOut(resNull, 'exit 缺协议声明标记');
      // ④ 损坏标记（protocol 非协议集 basename）→ BLOCKED（fail-closed）
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '9-other.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resCorrupt = runGuard(['exit', 'open'], dir);
      assertExit(resCorrupt, 1);
      assertOut(resCorrupt, 'BLOCKED');
      assertOut(resCorrupt, 'exit 缺协议声明标记');
    },
  },

  // 103: 交叉自洽（AC-5）——标记存在但 at 晚于 record 时间（手工构造未来时间戳）→ BLOCKED
  // （标记必须先于记录声明——时间序可审计）
  {
    name: '103 record BLOCKED：标记 at 晚于记录时间（AC-5 交叉自洽）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2999-12-31T00:00:00.000Z' }, null, 2) + '\n');
      const res = runState(['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '标记必须先于记录声明');
    },
  },

  // 104: 旧 evidence/旧 change 兼容（AC-6）——旧格式记录（completedChecks 无 required-skill 条目 /
  // 无 completedChecks）无标记照常通过；exit 在 .skill-loads/ 未激活（目录不存在）时
  // SKILL-LOAD WARN 照常通过（声明机制未激活不追溯）
  {
    name: '104 旧 evidence/旧 change 兼容：无标记照常通过（AC-6）',
    run: (dir) => {
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // ① 旧格式 record：completedChecks 无 required-skill 条目 → 无标记也通过
      const resA = runState(['record', 'open', JSON.stringify({ summary: 'legacy', completedChecks: ['unit-tests'] })], dir, env);
      assertExit(resA, 0);
      assertOut(resA, 'EVIDENCE: open');
      // ② 无 completedChecks 的纯 summary 记录 → 通过
      const resB = runState(['record', 'open', JSON.stringify({ summary: 'plain' })], dir, env);
      assertExit(resB, 0);
      // ③ exit open：M5 后 record 已自动补声明标记 → 无 SKILL-LOAD WARN,正常通过
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\n## 验收准则（AC）\n');
      const resC = runGuard(['exit', 'open'], dir);
      assertExit(resC, 0);
      assertOut(resC, 'ALL CHECKS PASSED');
      assertNotOut(resC, 'SKILL-LOAD WARN');
      // M5: record 已自动补 requiredSkillCalls 声明标记
      if (!fs.existsSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads', 'open-flow-comet-change.json'))) {
        throw new Error('record 自动声明标记缺失: open-flow-comet-change.json');
      }
    },
  },

  // 105: 计数一致性自检同步（AC-8 / AC-14）——SCENARIOS.length 或系统测试集项数变更时，
  // 受检文件须同步（场景数：ALL n SCENARIOS PASSED / n scenarios / n 场景 / n/n 变体；
  // 项数：n/n / n items / n 项 变体）。本场景读取权威源仓库的受检文件断言含当前计数变体——
  // 文档漏同步或条目缺失（幽灵条目）即 RED；与底部自检共用同一实现（countSyncProblems），
  // 两处判据不会漂移。安装副本无文档面，跳过。
  {
    name: '105 计数一致性自检同步：受检文件含当前场景数与系统测试集项数变体（AC-8 / AC-14）',
    run: () => {
      if (!isAuthoritativeSourceRepo()) return; // 安装副本无 flow-comet 文档
      const problems = countSyncProblems();
      if (problems.length > 0) {
        throw new Error(problems.join('; '));
      }
    },
  },

  // 106: exit review——REVIEW.md 发现区条目处置状态结构级校验（L3-1：问题处理原则）——
  // 发现项（含 Minor）无处置状态标记（[已修]/[升级]/[转待办]）→ REVIEW WARN 渐进不 BLOCK
  // （防旧 REVIEW 卡死——旧 REVIEW 未按新格式写标记只警告不阻断）；全部带标记 → 无 WARN
  // （发现不得"记录后无声消失"——每条须有处置去向）
  {
    name: '106 exit review WARN：发现区条目缺处置状态标记（L3-1）',
    run: (dir) => {
      const st = baseState('review');
      st.evidence.review = { summary: 'review done' };
      writeState(dir, st);
      // ① 发现区 Minor 条目无处置标记 → REVIEW WARN + 通过（渐进不阻断）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n无\n\n### Major\n\n无\n\n### Minor\n\n- **m-1 · 示例发现**：描述（未处置）\n\n## 结论\n\n通过\n');
      const res = runGuard(['exit', 'review'], dir);
      assertExit(res, 0);
      assertOut(res, 'REVIEW WARN');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② 同一条目带 [转待办] 处置标记 → 无 REVIEW WARN
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n无\n\n### Major\n\n无\n\n### Minor\n\n- **m-1 · 示例发现**：描述 [转待办]\n\n## 结论\n\n通过\n');
      const res2 = runGuard(['exit', 'review'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, 'REVIEW WARN');
      assertOut(res2, 'ALL CHECKS PASSED');
    },
  },

  // 107: determineNode 产物推导 pathBase 感知——compose 自定义协议 outputSchemas 含
  // pathBase='project' 工件（项目根 README.md）时,status/next 按项目根产物正确推进。
  // 修复前 buildNodeCompletionFlags 丢弃 pathBase、nodeFlagsComplete 一律按 .specs/ 解析
  // → 项目根工件永不命中 → 节点判定不完成 → next 钉回（卡死）。
  {
    name: '107 产物推导 pathBase 感知：project 根工件正确推进',
    run: (dir) => {
      // 自定义协议:brief(project 根 README.md)→ doccheck(specs-root report.md)
      const custom = path.join(dir, 'pb-protocol.json');
      writeFile(dir, 'pb-protocol.json', JSON.stringify({
        schemaVersion: 1,
        kind: 'workflow-kernel',
        name: 'pathbase-test',
        goal: 'pathBase 场景：pathBase=project 工件正确推进。',
        nodes: [
          { id: 'brief', label: 'Brief', kind: 'control', responsibility: '产出项目根 README.md。', outputSchemas: ['pathbase.brief.v1'], requiredSkillCalls: [], augmentations: [], disabled: false },
          { id: 'doccheck', label: 'Doc Check', kind: 'control', responsibility: '产出 specs-root report.md。', outputSchemas: ['pathbase.doccheck.v1'], requiredSkillCalls: [], augmentations: [], disabled: false },
        ],
        outputSchemas: [
          { id: 'pathbase.brief.v1', artifacts: [{ id: 'readme', paths: ['README.md'], pathBase: 'project' }] },
          { id: 'pathbase.doccheck.v1', artifacts: [{ id: 'report', paths: ['report.md'] }] },
        ],
      }, null, 2));
      // init(自定义协议经 --protocol CLI)+ 项目根产物 README.md
      assertExit(runState(['init', CHANGE_ID, '--protocol', custom, '--init-skip'], dir), 0);
      writeFile(dir, 'README.md', '# project readme\n');
      // brief 完成(README.md 在项目根存在)→ determineNode 推导下一节点 doccheck
      // （验证点:产物推导尊重 pathBase——修复前 README.md 按 .specs/ 解析永不命中 → currentNode 仍 brief）
      // （注:next 的顺序门禁会 BLOCK 未 exit 节点——那是节点顺序语义,非本场景目标）
      const st = runState(['status', '--protocol', custom], dir);
      assertExit(st, 0);
      assertOut(st, '"currentNode": "doccheck"');
    },
  },

  // 108: 产物推导 fail-fast（B 方案）——协议声明 classic/native pathBase 时状态机推导
  // 暂不支持（guard 侧全量感知、state 侧兜底不一致的已知边界）,显式报错提示改用
  // specs-root/project + 完整路径——不静默兜底（防卡死/误判）。
  {
    name: '108 产物推导 fail-fast：classic/native pathBase 显式报错（B 方案）',
    run: (dir) => {
      // 自定义协议:proposal 节点声明 classic-openspec-root 工件
      const custom = path.join(dir, 'classic-protocol.json');
      writeFile(dir, 'classic-protocol.json', JSON.stringify({
        schemaVersion: 1,
        kind: 'workflow-kernel',
        name: 'classic-test',
        goal: 'fail-fast 场景：classic pathBase 显式报错。',
        nodes: [
          { id: 'proposal', label: 'Proposal', kind: 'control', responsibility: '产出 openspec 产物。', outputSchemas: ['classic.proposal.v1'], requiredSkillCalls: [], augmentations: [], disabled: false },
        ],
        outputSchemas: [
          { id: 'classic.proposal.v1', artifacts: [{ id: 'proposal', paths: ['changes/xxx.md'], pathBase: 'classic-openspec-root' }] },
        ],
      }, null, 2));
      assertExit(runState(['init', CHANGE_ID, '--protocol', custom, '--init-skip'], dir), 0);
      // status:classic/native pathBase → fail-fast 显式报错（不静默兜底）。
      // 措辞订正：guard 侧同样拒绝这三类 pathBase，故消息不再说「由 guard 校验支持」
      // （旧措辞会让人以为只有状态机推导缺支持）——断言随之锁新措辞。
      const st = runState(['status', '--protocol', custom], dir);
      assertExit(st, 1);
      assertOut(st, '已不受 guard 与状态机支持');
      assertOut(st, 'specs-root');
    },
  },

  // 109: execute 出口校验——TASK done 任务 ↔ <id>-SUMMARY.md 存在——
  // 缺任一 done 任务的 SUMMARY → WARN 渐进不 BLOCK（防旧 change 卡死）；齐全 → 无 WARN
  {
    name: '109 execute exit：done 任务缺 SUMMARY → WARN 渐进',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'execute done' };
      st.executionMode = 'direct'; // direct:串行任务主代理直写,不要求 handoff(聚焦产物完整性校验)
      writeState(dir, st);
      // TASK:两个 done 任务(T01/T02)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
        '<task id="T02" status="done"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify></task>\n');
      // ① 只有 T02-SUMMARY.md(T01 缺)→ WARN 点名 T01-SUMMARY.md + 通过（渐进）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T02-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN');
      assertOut(res, 'T01-SUMMARY.md');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② 补 T01-SUMMARY.md → 无缺产物 WARN（既有 SKILL-LOAD 兼容 WARN 与本文无关）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '缺少 T01-SUMMARY.md');
      assertOut(res2, 'ALL CHECKS PASSED');
    },
  },

  // 110: execute 出口越权委托检测——TASK 有 parallel done 任务 + completedNodes
  // 无 subagent-execute + 非 direct 模式 → WARN 渐进（[P] 任务应由 subagent-execute 节点委托,
  // execute 阶段完成 [P] 是越权委托痕迹——上轮真实流程实证的越权委托）;completedNodes 含
  // subagent-execute 或 direct 模式 → 无越权 WARN
  {
    name: '110 execute exit：parallel done 无 subagent-execute → WARN 越权委托',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'execute done' };
      st.completedNodes = ['open', 'design', 'plan', 'execute']; // subagent-execute 未 exit
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) }; // 已委托(共用证据库)
      writeState(dir, st);
      // TASK:parallel done P01 + 产物 SUMMARY(满足 task-summaries 出口门禁 + KI-8)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      // ① completedNodes 无 subagent-execute + 非 direct → WARN（越权委托）
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, '越权委托');
      assertOut(res, 'subagent-execute');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② completedNodes 含 subagent-execute → 无越权 WARN
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      writeState(dir, st);
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '越权委托');
      assertOut(res2, 'ALL CHECKS PASSED');
    },
  },

  // 111: verify 出口越权委托兜底检测——同 KI-10 判定（TASK parallel done +
  // completedNodes 无 subagent-execute + 非 direct）,verify 时仍未 exit → WARN 兜底
  // （execute 出口未拦截的兜底提示）
  {
    name: '111 verify exit：parallel done 无 subagent-execute → WARN 越权委托兜底',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'review']; // 无 subagent-execute
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      // ① completedNodes 无 subagent-execute → WARN 兜底
      const res = runGuard(['exit', 'verify'], dir);
      assertExit(res, 0);
      assertOut(res, '越权委托');
      assertOut(res, 'subagent-execute');
      // ② completedNodes 含 subagent-execute → 无越权 WARN
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      writeState(dir, st);
      const res2 = runGuard(['exit', 'verify'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '越权委托');
    },
  },

  // 112: 节点顺序 BLOCK 消息含恢复指引——next 的「疑似未 exit」BLOCK 与
  // exit 的「currentNode 不匹配」BLOCK 均提示恢复通道（advance 强制推进/select 切换/
  // exit --apply）——防 resume 自锁（上轮真实项目端到端验证观察：机器推导节点无脚本恢复通道）
  {
    name: '112 节点顺序 BLOCK 消息含恢复指引',
    run: (dir) => {
      // ① next:currentNode=execute 但未 exit(无 evidence 记录)→ BLOCK 消息含 advance/select 指引
      const st1 = baseState('execute'); // evidence 空——无豁免,触发"疑似未 exit"BLOCK
      writeState(dir, st1);
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true }); // findActiveChange 要求目录存在
      const nx = runState(['next'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(nx, 1);
      assertOut(nx, 'BLOCKED');
      assertOut(nx, 'advance');
      assertOut(nx, 'select');
      // ② exit:currentNode=design 但 exit open → BLOCK 消息含 advance 指引
      const st2 = baseState('design');
      st2.evidence.design = { summary: 'design done' };
      writeState(dir, st2);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## AC\n');
      const ex = runGuard(['exit', 'open'], dir);
      assertExit(ex, 1);
      assertOut(ex, 'BLOCKED');
      assertOut(ex, 'advance');
      // ③ exit 无 evidence → BLOCK 消息含 record 补证据指引（KI-3 补全）
      const st3 = baseState('design');
      writeState(dir, st3);
      const ex3 = runGuard(['exit', 'open'], dir);
      assertExit(ex3, 1);
      assertOut(ex3, 'missing evidence');
      assertOut(ex3, 'record');
    },
  },

  // 113: plan 出口波次散文一致性检测——TASK 的 ## 波次划分 Wave 行任务带 [P]
  // 标记（并行语义）但 XML 任务无 parallel="true" → WARN（散文与机器路由依据不一致,
  // 以任务标记为准）;XML 补齐 parallel → 无 WARN。容错:无并行语义的 Wave 行不参与比对。
  {
    name: '113 plan exit：波次散文与并行标记不一致 → WARN',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      // TASK:波次散文 Wave 1 (parallel): T01[P], T02[P];XML 仅 T01 parallel（T02 不一致）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 波次划分\n\nWave 1 (parallel): T01[P], T02[P]\n\n## 任务清单\n\n'
        + '<task id="T01" parallel="true" status="pending"><action>a</action><write_files>f1</write_files><verify>v</verify></task>\n'
        + '<task id="T02" status="pending"><action>b</action><write_files>f2</write_files><verify>v</verify></task>\n');
      // ① 散文 T02[P] 但 XML 无 parallel → WARN
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 0);
      assertOut(res, '波次散文');
      assertOut(res, 'T02');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② XML 补 T02 parallel → 无波次 WARN
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 波次划分\n\nWave 1 (parallel): T01[P], T02[P]\n\n## 任务清单\n\n'
        + '<task id="T01" parallel="true" status="pending"><action>a</action><write_files>f1</write_files><verify>v</verify></task>\n'
        + '<task id="T02" parallel="true" status="pending"><action>b</action><write_files>f2</write_files><verify>v</verify></task>\n');
      const res2 = runGuard(['exit', 'plan'], dir);
      assertExit(res2, 0);
      assertNotOut(res2, '波次散文');
      assertOut(res2, 'ALL CHECKS PASSED');
    },
  },

  // 114: init 未知参数(以 -- 开头,如 --help)→ 报错而非当作 change 名执行
  // (此前 --help 会被当作 change id 使用:自动开 change、建分支、写状态——误用有破坏性)
  {
    name: '114 init 未知参数(以 -- 开头)报错而非当作 change 名',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const branchBefore = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
      const res = runState(['init', '--help'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, 'not a change name');
      assertOut(res, 'Usage: workflow-state.mjs init');
      assertNotOut(res, 'BRANCH:');
      const branchAfter = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
      if (branchAfter !== branchBefore) throw new Error('init --help 不应切换或创建分支');
      if (fs.existsSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'))) {
        throw new Error('init --help 不应写状态文件(此前被当作 change 名执行的副作用)');
      }
      if (fs.existsSync(path.join(dir, '.specs', '--help'))) {
        throw new Error('init --help 不应创建 .specs/--help 工件目录');
      }
      // ② 带前导空白的 flag-like 参数(如 " --help")经 trim 后同样应被拒绝
      const res2 = runState(['init', ' --help'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res2, 1);
      assertOut(res2, 'not a change name');
      if (fs.existsSync(path.join(dir, '.specs', ' --help'))) {
        throw new Error('init " --help" 不应创建工件目录(trim 后应被拒绝)');
      }
    },
  },

  // 115: M1 entry 证据化——新 change(enter 机制激活)未 entry 直接 exit → ENTER WARN(渐进不阻断)
  {
    name: '115 execute exit ENTER WARN：enter 机制激活但本节点未 entry（M1）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.enteredNodes = ['open', 'design', 'plan']; // 前序节点 enter 过(机制激活);execute 未 entry
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'ENTER WARN');
    },
  },

  // 116: M1 正例——entry 后 exit 无 enter 证据警告
  {
    name: '116 execute exit 通过：entry 后无 enter 证据警告（M1 正例）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.enteredNodes = ['open', 'design', 'plan'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      assertExit(runGuard(['entry', 'execute'], dir), 0); // entry 记录 enter 标记
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'ENTER WARN');
    },
  },

  // 117: M2——新 change(enter 机制激活)done 任务缺 SUMMARY → BLOCKED(旧 change WARN 渐进保留)
  // 构造:两个 done 任务(T01/T02),仅 T01-SUMMARY 存在(满足产物通配符,隔离 KI-8 语义)
  {
    name: '117 execute exit BLOCKED：新 change done 任务缺 SUMMARY（M2）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'T02']) };
      st.enteredNodes = ['open', 'design', 'plan', 'execute'];
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE_TWO);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir); // T02 缺 SUMMARY
      assertExit(res, 1);
      assertOut(res, 'SUMMARY');
    },
  },

  // 118: M3——新 change(enter 机制激活)handoff 缺 redEvidence → BLOCKED(旧 change WARN 保留)
  // 构造:handoffRequest + handoffResult 齐(满足 Output Schema evidence),仅缺 redEvidence(隔离 M3 语义)
  {
    name: '118 subagent-execute exit BLOCKED：新 change handoff 缺 redEvidence（M3）',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence.execute = { summary: 'executed' };
      st.enteredNodes = ['open', 'design', 'plan', 'subagent-execute'];
      st.newChange = true;
      const handoff = handoffFor(['T01']);
      delete handoff.T01.result.redEvidence;
      st.evidence['subagent-execute'] = { summary: 'delegated', handoffRequest: { T01: { taskId: 'T01' } }, handoffResult: handoff };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'redEvidence');
    },
  },

  // 119: M4——handoff 提交对象不可校验 → HANDOFF ERROR 且含协调者确认提示
  {
    name: '119 handoff result 提交对象不可校验 → 协调者确认提示（M4）',
    run: (dir) => {
      writeState(dir, baseState('subagent-execute'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
      const payload = JSON.stringify({
        status: 'DONE',
        commitHash: 'deadbeef00000000000000000000000000000000',
        redEvidence: { command: 'echo red', output: 'red' },
        greenEvidence: { command: 'echo green', output: 'green' },
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        riskSignals: ['none'],
      });
      const res = runHandoff(['result', 'T01', payload], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF ERROR');
      assertOut(res, '确认'); // 协调者确认提示
    },
  },

  // 120: M5——record 自动补写 skill-load 声明标记(open 节点 requiredSkillCalls)
  {
    name: '120 record 自动补写 skill-load 声明标记（M5）',
    run: (dir) => {
      const st = baseState('open');
      st.enteredNodes = ['open'];
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\nx\n\n## 验收准则（AC）\n- Given x When y Then z');
      const res = runState(['record', 'open', '{"summary":"done"}'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      const loads = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      const changeMarker = path.join(loads, 'open-flow-comet-change.json');
      const requirementMarker = path.join(loads, 'open-flow-comet-requirement.json');
      if (!fs.existsSync(changeMarker)) {
        throw new Error('record 自动声明标记缺失: open-flow-comet-change.json');
      }
      // 子断言:自动补标记的 protocol 字段按 skill 归属协议文件(修复前所有 skill 都写节点
      // 首文件 0-change.md——requirement 标记的协议归属语义错误,此处应 RED)
      const changeMeta = JSON.parse(fs.readFileSync(changeMarker, 'utf8'));
      if (changeMeta.protocol !== '0-change.md') {
        throw new Error('change 自动标记 protocol 应为 0-change.md: ' + JSON.stringify(changeMeta.protocol));
      }
      if (!fs.existsSync(requirementMarker)) {
        throw new Error('record 自动声明标记缺失: open-flow-comet-requirement.json');
      }
      const requirementMeta = JSON.parse(fs.readFileSync(requirementMarker, 'utf8'));
      if (requirementMeta.protocol !== '1-requirement.md') {
        throw new Error('requirement 自动标记 protocol 应为 1-requirement.md(修复前误写 0-change.md): ' + JSON.stringify(requirementMeta.protocol));
      }
    },
  },

  // 121: M6——execute 显式空退出豁免(全 parallel 无串行任务,evidence 声明后通过)
  {
    name: '121 execute exit 通过：显式空退出豁免（M6）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'empty exit', emptyExitApproved: true };
      st.enteredNodes = ['open', 'design', 'plan', 'execute'];
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" parallel="true" status="pending" depends_on="">\n  <name>p</name>\n  <write_files>a</write_files>\n  <action>p</action>\n  <verify>t</verify>\n  <done>d</done>\n</task>');
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      // 子断言:豁免不适用于存在未完成串行任务——防规划错误被豁免掩盖
      // (修复前 emptyExitApproved 会跳过串行 pending 阻断,此处应 RED)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T02" status="pending"><action>串行任务</action><write_files>f</write_files><verify>v</verify></task>\n');
      const resSerial = runGuard(['exit', 'execute'], dir);
      assertExit(resSerial, 1);
      assertOut(resSerial, '串行 pending');
    },
  },

  // 122: M7——旧 change(enter 机制未激活)done 缺 SUMMARY 仍 WARN 渐进,不升级(兼容正例)
  // 构造:两个 done 任务(T01/T02),仅 T01-SUMMARY 存在(满足产物通配符,隔离 KI-8 语义)
  {
    name: '122 execute exit 兼容：旧 change done 缺 SUMMARY 仍 WARN 渐进（M7）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'T02']) };
      writeState(dir, st); // 无 enteredNodes(旧 change)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE_TWO);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir); // T02 缺 SUMMARY → 旧 change 仍 WARN 渐进
      assertExit(res, 0);
      assertOut(res, 'WARN');
    },
  },

  // 123: M8——init 在无提交(空)仓库时输出提示且跳过分支创建(行为一致:
  // 修复前 WARN"无法创建分支"后仍 checkout -b 实际创建——声称与行为矛盾)
  {
    name: '123 init 空仓库提示：无提交仓库的分支创建边界（M8）',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      const res = runState(['init', 'empty-repo'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'EMPTY-REPO');
      // 子断言 ①:警告后不得实际创建分支(unborn HEAD 下 rev-parse 失败 → currentBranch=null
      // → checkout -b 被跳过——分支列表应保持为空)
      const branches = execFileSync('git', ['branch', '--list'], { cwd: dir, encoding: 'utf8' });
      if (branches.includes('change/empty-repo')) {
        throw new Error('空仓库警告后仍创建了 change/empty-repo 分支: ' + branches);
      }
      // 子断言 ②:BRANCH 输出不得声称分支已创建(修复前输出 'BRANCH: change/empty-repo'
      // 但分支实际未创建——声称与行为矛盾,此处应 RED)
      assertNotOut(res, 'BRANCH: change/empty-repo');
    },
  },

  // 124: M3 旧兼容——旧 change(enter 机制未激活)handoff 缺 redEvidence 仍 WARN 渐进(不升级)
  {
    name: '124 subagent-execute exit 兼容：旧 change handoff 缺 redEvidence 仍 WARN（M3 旧兼容）',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence.execute = { summary: 'executed' };
      const handoff = handoffFor(['T01']);
      delete handoff.T01.result.redEvidence;
      st.evidence['subagent-execute'] = { summary: 'delegated', handoffRequest: { T01: { taskId: 'T01' } }, handoffResult: handoff };
      writeState(dir, st); // 无 enteredNodes(旧 change)
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'HANDOFF WARN');
    },
  },

  // 125: R1——新 change(newChange:true)review 处置标记缺失 → BLOCKED(旧 change WARN 保留)
  {
    name: '125 review exit BLOCKED：新 change 处置标记缺失（R1）',
    run: (dir) => {
      const st = baseState('review');
      st.evidence.review = { summary: 'reviewed' };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'review'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题A**: 某处存在一个需要记录的问题描述,但未给出任何处置结论\n\n## 结论\n\n通过\n');
      const res = runGuard(['exit', 'review'], dir);
      assertExit(res, 1);
      assertOut(res, '处置状态标记');
      // 子断言:四要素字段行(Symptom/Source/Consequence/Remedy)不误判为发现条目——
      // 执行者按 brooks 输出格式书写(带处置标记的条目)应正常通过
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题 **[已修]**\n  - **Symptom**: 具体现象\n  - **Source**: 某书某节\n  - **Consequence**: 若不修会怎样\n  - **Remedy**: 怎么改\n\n## 结论\n\n通过\n');
      const resOk = runGuard(['exit', 'review'], dir);
      assertExit(resOk, 0);
      assertOut(resOk, 'ALL CHECKS PASSED');
      // 子断言:字段豁免必须精确匹配完整标签(允许尾冒号)——"Source maps expose paths"
      // 这类以 Source 开头的真实发现标题不得被误豁免(修复前前缀匹配会跳过其处置校验)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **Source maps expose paths**: 某处泄露文件路径,未给出任何处置结论\n\n## 结论\n\n通过\n');
      const resSource = runGuard(['exit', 'review'], dir);
      assertExit(resSource, 1);
      assertOut(resSource, '处置状态标记');
      // 负例对照:完整标签行(Symptom:/Source:)仍豁免(字段行不是发现条目)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题C**: 某处问题 **[已修]**\n  - **Symptom**: 现象\n  - **Source**: 某书\n\n## 结论\n\n通过\n');
      const resOk2 = runGuard(['exit', 'review'], dir);
      assertExit(resOk2, 0);
      assertOut(resOk2, 'ALL CHECKS PASSED');
    },
  },

  // 126: R1——新 change builtin 缓存证据缺失 → BLOCKED
  {
    name: '126 execute exit BLOCKED：新 change builtin 缓存证据缺失（R1）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({
        method: '## 自检方法\n\nbrooks-lint 不可用,builtin-quickcheck',
        sixDim: '## 6 维自查\n\n- 功能: 通过\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
      }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '缓存');
      // 子断言:拦截消息须含关键词引导(声明级校验的执行者体验——级 4 实证:语义完整但
      // 缺关键词被拦,消息应指明所需关键词,防执行者无从下手)
      assertOut(res, '须含关键词');
    },
  },

  // 127: R1——新 change 波次散文不一致 → BLOCKED
  {
    name: '127 plan exit BLOCKED：新 change 波次散文不一致（R1）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'planned' };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 波次划分\n\nWave 1 (parallel): T01[P]\n\n## 任务清单\n\n<task id="T01"><action>a</action><write_files>f</write_files><verify>v</verify><done>d</done></task>\n');
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 1);
      assertOut(res, '波次');
    },
  },

  // 128: R1——新 change 越权委托(KI-10)→ BLOCKED
  {
    name: '128 execute exit BLOCKED：新 change 越权委托（R1）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent()); // 满足 M2
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) }; // 满足越俎代庖,触发 KI-10 越权委托
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '越权');
    },
  },

  // 129: R2——新 change 未 entry 直接 exit → BLOCKED(旧 change ENTER WARN 保留)
  {
    name: '129 execute exit BLOCKED：新 change 未 entry 直接 exit（R2）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'entry');
    },
  },

  // 130: R6——init 写 newChange: true
  {
    name: '130 init 写入 newChange 标记（R6）',
    run: (dir) => {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
      const res = runState(['init', CHANGE_ID], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.newChange !== true) throw new Error('init 未写入 newChange: true');
    },
  },

  // 131: R1 旧兼容——旧 change(无 newChange)处置标记缺失仍 WARN
  {
    name: '131 review exit 兼容：旧 change 处置标记缺失仍 WARN（R1 旧兼容）',
    run: (dir) => {
      const st = baseState('review');
      st.evidence.review = { summary: 'reviewed' };
      writeState(dir, st); // 无 newChange(旧 change)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题A**: 某处存在一个需要记录的问题描述,但未给出任何处置结论\n\n## 结论\n\n通过\n');
      const res = runGuard(['exit', 'review'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN');
    },
  },

  // 132: R3——exit 校验对 auto 声明标记输出 WARN 提示
  {
    name: '132 exit 对 auto 声明标记输出提示（R3）',
    run: (dir) => {
      // 技能加载前置门对齐：record 无声明标记在新 change 下 BLOCK——本场景测 exit 的
      // auto 标记提示，改用旧 change(无 newChange)构造，保留 record 通过 + exit auto 提示
      // 的测试意图（新 change 无声明记录由前置门场景覆盖）。
      const st = baseState('open');
      writeState(dir, st);
      assertExit(runGuard(['entry', 'open'], dir), 0);
      assertExit(runState(['record', 'open', '{"summary":"intake"}'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') }), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\nx\n\n## 验收准则（AC）\n- Given x When y Then z');
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z', auto: true }, null, 2) + '\n');
      const res = runGuard(['exit', 'open'], dir);
      assertExit(res, 0);
      assertOut(res, 'auto');
    },
  },

  // 133: R4——空退出豁免 exit 输出审计提示
  {
    name: '133 execute exit 空退出豁免输出审计提示（R4）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'empty', emptyExitApproved: true };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="P01" parallel="true" status="pending"><action>p</action><write_files>a</write_files><verify>t</verify><done>d</done></task>\n');
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'EMPTY-EXIT');
    },
  },

  // 134: G16——M2 BLOCKED 消息含恢复指引
  {
    name: '134 execute exit BLOCKED 消息含恢复指引（G16）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01', 'T02']) };
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE_TWO);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const res = runGuard(['exit', 'execute'], dir); // T02 缺 SUMMARY
      assertExit(res, 1);
      assertOut(res, '恢复:');
    },
  },

  // 135: R1 旧格式兼容分支——自检方法段含 brooks-review 声明但缺 `## 自检方法` 段标题(旧格式形态):
  // 新 change 全文声明方法但缺段标题 → BLOCKED(强制自检方法段,transition 规则 L2454-2455);
  // 旧 change 同构造 → BROOKS-LINT WARN 渐进(兼容保留,L2457)
  {
    name: '135 execute exit BLOCKED：新 change 自检方法段缺标题（R1 旧格式兼容分支）',
    run: (dir) => {
      // ① 新 change(newChange:true):T01-SUMMARY 含 brooks-review 声明(6 维自查+方法行)但缺
      // `## 自检方法` 段标题(旧格式) → BLOCKED(自检方法段强制;恢复:补 ## 自检方法 段标题)
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'execute'], dir), 0); // R2: 新 change 须先 entry
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({ method: 'brooks-review' }));
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, '自检方法');
      // ② 旧 change(无 newChange)同构造 → BROOKS-LINT WARN 渐进(兼容保留,不阻断)
      const stOld = baseState('execute');
      stOld.evidence.execute = { summary: 'executed' };
      stOld.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, stOld);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent({ method: 'brooks-review' }));
      const resOld = runGuard(['exit', 'execute'], dir);
      assertExit(resOld, 0);
      assertOut(resOld, 'BROOKS-LINT WARN');
    },
  },

  // 136: verifyFailures 按 change 隔离——切换 change 后计数独立(串扰修复:全局计数会让
  // change B 继承 change A 的失败次数,误触发"超限需用户决策");旧顶层字段
  // (verifyFailures)迁移并入当前 change 计数(旧 state 兼容)
  {
    name: '136 verifyFailures 按 change 隔离:切换计数独立 + 旧字段迁移',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // ① 旧字段迁移:旧 state(顶层 verifyFailures=2)→ verify-fail 并入当前 change(2+1=3)不超限
      const st = baseState('verify');
      st.verifyFailures = 2;
      writeState(dir, st);
      // 场景内 ch/ch2 目录(select 要求 change 目录存在)
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const r1 = runState(['verify-fail'], dir, env);
      assertExit(r1, 0);
      assertOut(r1, 'VERIFY-FAIL: 3/3');
      const stAfter = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!stAfter.verifyFailuresByChange || stAfter.verifyFailuresByChange['ch'] !== 3) {
        throw new Error('旧字段未迁移并入 change 计数: ' + JSON.stringify(stAfter.verifyFailuresByChange));
      }
      if (stAfter.verifyFailures !== undefined) {
        throw new Error('旧顶层字段应已清除: ' + JSON.stringify(stAfter.verifyFailures));
      }
      // ② 同 change 第 4 次 → BLOCK(3 >= 3)
      const r2 = runState(['verify-fail'], dir, env);
      assertExit(r2, 1);
      assertOut(r2, '超限');
      // ③ 切换 change:select ch2 → 计数独立(若实现仍用全局计数 3,此处会误 BLOCK = RED)
      writeFile(dir, '.specs/ch2/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const r3 = runState(['select', 'ch2'], dir, env);
      assertExit(r3, 0);
      const r4 = runState(['verify-fail'], dir, env);
      assertExit(r4, 0);
      assertOut(r4, 'VERIFY-FAIL: 1/3');
      // ④ ch2 独立计数:连续 3 次后第 4 次 BLOCK
      assertExit(runState(['verify-fail'], dir, env), 0);
      assertExit(runState(['verify-fail'], dir, env), 0);
      const r7 = runState(['verify-fail'], dir, env);
      assertExit(r7, 1);
      assertOut(r7, '超限');
      // ⑤ 切回 ch:原计数保留(3 → 仍超限,不串扰不回零)
      const r8 = runState(['select', 'ch'], dir, env);
      assertExit(r8, 0);
      const r9 = runState(['verify-fail'], dir, env);
      assertExit(r9, 1);
      assertOut(r9, '超限');
    },
  },

  // 137: next 漂移校正不得推走"已记录证据但未 exit"的进行中节点——exit 被拦截(如
  // 内容级 BLOCKED)后执行者跑 next,校正把 currentNode 推到下一节点,被拦截节点无法
  // 重跑(exit 前置 currentNode 校验拦截),advance/select 均不恢复 → 死结(实测教训)。
  // 修复:evidence 存在且节点未 exit → 视为进行中,next 不校正(currentNode 保持原节点)
  {
    name: '137 next 不推走进行中节点:exit 被拦截后重跑路径保留',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const st = baseState('review');
      st.completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      st.evidence.review = { summary: 'reviewed' }; // record 过但 exit 被拦截
      st.newChange = true;
      writeState(dir, st);
      // 前序产物(execute 产物门控需 *-SUMMARY.md)
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\nx\n\n## 验收准则（AC）\n- Given x When y Then z');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈\npython\n\n## 决策清单\n- d1: x\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" status="done"><action>x</action><write_files>f</write_files><verify>v</verify></task>\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', '# T01-SUMMARY\n## verify 输出\nx\n## 6 维自查\nx\n## 越界检查\nx\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题A**: 某处问题 **[已修]**\n\n## 结论\n\n通过\n');
      // ① next:进行中节点(evidence 存在且未 exit)不被漂移校正推走(修复前校正到 verify = RED)
      const r1 = runState(['next'], dir, env);
      assertExit(r1, 0);
      assertOut(r1, 'NODE: review');
      assertNotOut(r1, 'NODE: verify');
      // ② exit review 重跑路径保留:缺处置标记 → BLOCKED(新 change),补标记后通过
      assertExit(runGuard(['entry', 'review'], dir, env), 0); // 新 change 强制先 entry
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题无处置标记\n\n## 结论\n\n通过\n');
      const rBlock = runGuard(['exit', 'review'], dir, env);
      assertExit(rBlock, 1);
      assertOut(rBlock, '处置状态标记');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题 **[已修]**\n\n## 结论\n\n通过\n');
      const rPass = runGuard(['exit', 'review', '--apply'], dir, env);
      assertExit(rPass, 0);
      assertOut(rPass, 'ALL CHECKS PASSED');
    },
  },

  // ----------  场景（prepare-env 平台选择链——T01 实现：显式单平台/逗号多选/all/both 移除/痕迹探测/幂等） ----------

  // 138: 显式单平台 --platform dsh → dsh 描述符生效（skill 根 .dsh/skills/ + 路径替换 + AGENTS.md 托管区 +
  // $DSH_HOME 全局挂载——DSH_HOME=临时目录,禁止污染真实 ~/.dsh）
  {
    name: '138 prepare-env --platform dsh 显式单平台安装生效',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return; // 安装副本无 prepare-env 脚本（与场景 105 同判据）
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const dshHome = path.join(dir, 'dshhome');
      const res = runPrepareEnv(['--target', proj, '--platform', 'dsh'], dir, { DSH_HOME: dshHome });
      assertExit(res, 0);
      assertOut(res, '平台: DeepSeek Harness');
      // dsh 描述符生效:skill 安装到目标 .dsh/skills/（而非 .claude/）
      if (!fs.existsSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('dsh skill 未安装到 .dsh/skills/');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('dsh 单平台不应生成 .claude/');
      // 路径替换生效:安装副本 SKILL.md 含 .dsh/skills/flow-comet/scripts/ 命令路径（权威源 .claude 形态 → dsh 平台化）
      const skillText = fs.readFileSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'), 'utf8');
      if (!skillText.includes('.dsh/skills/flow-comet/scripts/')) throw new Error('SKILL.md 未做 dsh 路径替换');
      // rules 注入:AGENTS.md 托管区
      const agents = fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8');
      if (!agents.includes('<!-- Managed by flow-comet prepare-env -->')) throw new Error('AGENTS.md 托管区未注入');
      // $DSH_HOME 全局挂载（场景隔离:DSH_HOME=临时目录,禁止污染真实 ~/.dsh）
      if (!fs.existsSync(path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs'))) throw new Error('桥接 loader 未复制到 $DSH_HOME/plugins/');
      const patch = fs.readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8');
      if (!patch.includes('dsh-flow-comet-bridge')) throw new Error('cordis.patch.yml 托管块未注入');
    },
  },

  // 139: 显式逗号多平台 --platform claude-code,dsh → 双平台顺序安装（顺序 = 参数顺序）
  {
    name: '139 prepare-env --platform claude-code,dsh 双平台按参数顺序安装',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code,dsh'], dir, { DSH_HOME: path.join(dir, 'dshhome') });
      assertExit(res, 0);
      // 双平台都装:.claude/skills + .dsh/skills 均生成
      if (!fs.existsSync(path.join(proj, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('claude-code 平台未安装');
      if (!fs.existsSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('dsh 平台未安装');
      // 顺序 = 参数顺序:输出中 Claude Code 先于 DeepSeek Harness
      const ccIdx = res.output.indexOf('平台: Claude Code');
      const dshIdx = res.output.indexOf('平台: DeepSeek Harness');
      if (ccIdx < 0 || dshIdx < 0 || ccIdx > dshIdx) throw new Error('安装顺序非参数顺序（Claude Code 应先于 DeepSeek Harness）');
    },
  },

  // 140: --platform all → 全部平台（顺序 = PLATFORMS 表顺序:claude-code → codex → dsh）
  {
    name: '140 prepare-env --platform all 全部平台按表顺序安装',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const res = runPrepareEnv(['--target', proj, '--platform', 'all'], dir, { DSH_HOME: path.join(dir, 'dshhome') });
      assertExit(res, 0);
      // 全部平台:.claude / .agents / .dsh 三套 skill 根均生成
      for (const root of ['.claude', '.agents', '.dsh']) {
        if (!fs.existsSync(path.join(proj, root, 'skills', 'flow-comet', 'SKILL.md'))) throw new Error(root + ' 平台未安装');
      }
      // 顺序 = PLATFORMS 表顺序（输出位置递增:Claude Code → Codex → DeepSeek Harness）
      const ccIdx = res.output.indexOf('平台: Claude Code');
      const codexIdx = res.output.indexOf('平台: Codex');
      const dshIdx = res.output.indexOf('平台: DeepSeek Harness');
      if (ccIdx < 0 || codexIdx < 0 || dshIdx < 0 || !(ccIdx < codexIdx && codexIdx < dshIdx)) {
        throw new Error('all 顺序非 PLATFORMS 表顺序（Claude Code → Codex → DeepSeek Harness）');
      }
    },
  },

  // 141: 未知平台 --platform gemini → 报错（含逗号列表中的未知项——不得部分安装）
  {
    name: '141 prepare-env 未知平台报错（含逗号列表未知项）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const r1 = runPrepareEnv(['--target', proj, '--platform', 'gemini'], dir);
      assertExit(r1, 1);
      assertOut(r1, '未知平台: gemini');
      const r2 = runPrepareEnv(['--target', proj, '--platform', 'claude-code,gemini'], dir);
      assertExit(r2, 1);
      assertOut(r2, '未知平台: gemini');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('未知平台报错前不应产生任何安装');
    },
  },

  // 142: 移除 both:--platform both → 报错提示（逗号分隔或 all）——逗号列表中的 both 同样被拒
  {
    name: '142 prepare-env --platform both 报错提示逗号或 all',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const r1 = runPrepareEnv(['--target', proj, '--platform', 'both'], dir);
      assertExit(r1, 1);
      assertOut(r1, 'both 已移除');
      assertOut(r1, '逗号分隔');
      const r2 = runPrepareEnv(['--target', proj, '--platform', 'claude-code,both'], dir);
      assertExit(r2, 1);
      assertOut(r2, 'both 已移除');
    },
  },

  // 143: 痕迹探测——仅 .dsh/ → probe=dsh;.claude/ + .dsh/ 双痕迹 → 不武断（提示 + 默认主平台 claude-code）
  // （spawn 非 TTY:走探测/默认路径,不触发交互）
  {
    name: '143 prepare-env 痕迹探测:仅 .dsh/ → dsh;双痕迹默认主平台',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const dshHome = path.join(dir, 'dshhome');
      // ① 仅 .dsh/ 痕迹 → probe=dsh → 无 --platform 缺省安装 dsh
      const proj1 = path.join(dir, 'proj1');
      fs.mkdirSync(path.join(proj1, '.dsh'), { recursive: true });
      const r1 = runPrepareEnv(['--target', proj1], dir, { DSH_HOME: dshHome });
      assertExit(r1, 0);
      if (!fs.existsSync(path.join(proj1, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('仅 .dsh/ 痕迹应探测安装 dsh 平台');
      if (fs.existsSync(path.join(proj1, '.claude'))) throw new Error('仅 .dsh/ 痕迹不应安装 claude-code');
      // ② .claude/ + .dsh/ 双痕迹 → 不武断二选一:输出提示 + 默认主平台 claude-code
      const proj2 = path.join(dir, 'proj2');
      fs.mkdirSync(path.join(proj2, '.claude'), { recursive: true });
      fs.mkdirSync(path.join(proj2, '.dsh'), { recursive: true });
      const r2 = runPrepareEnv(['--target', proj2], dir, { DSH_HOME: dshHome });
      assertExit(r2, 0);
      assertOut(r2, '检测到目标项目同时有');
      assertOut(r2, '默认安装 Claude Code');
      if (!fs.existsSync(path.join(proj2, '.claude', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('双痕迹默认应安装 claude-code');
      if (fs.existsSync(path.join(proj2, '.dsh', 'skills'))) throw new Error('双痕迹默认不应安装 dsh（不武断）');
    },
  },

  // 144: 幂等——同平台重复安装路径替换结果一致（既有语义延续:复制源固定 + 托管区/托管块读-合并-写幂等）
  {
    name: '144 prepare-env 幂等:同平台重复安装结果一致',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true }); // target 项目根须存在（prepare-env 不建父目录——AGENTS.md 写入 ENOENT）
      const dshHome = path.join(dir, 'dshhome');
      const args = ['--target', proj, '--platform', 'dsh'];
      const r1 = runPrepareEnv(args, dir, { DSH_HOME: dshHome });
      assertExit(r1, 0);
      // 首次安装后立即快照——与二次安装后逐字节比较（此前二次后连读恒真，漂移检测失效）
      const skillPath = path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md');
      const sk1 = fs.readFileSync(skillPath, 'utf8');
      const r2 = runPrepareEnv(args, dir, { DSH_HOME: dshHome });
      assertExit(r2, 0);
      // 路径替换结果一致:重复安装后 .dsh/skills 内 SKILL.md 与首次逐字节一致
      const sk2 = fs.readFileSync(skillPath, 'utf8');
      if (sk1 !== sk2) throw new Error('重复安装 SKILL.md 不一致');
      // AGENTS.md 托管区幂等（不重复叠加）
      const agents = fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8');
      const agentsBlocks = agents.split('<!-- Managed by flow-comet prepare-env -->').length - 1;
      if (agentsBlocks !== 1) throw new Error('AGENTS.md 托管区重复注入: ' + agentsBlocks);
      // $DSH_HOME/cordis.patch.yml 托管块幂等（不重复叠加）
      const patch = fs.readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8');
      const patchBlocks = patch.split('# --- flow-comet managed ---').length - 1;
      if (patchBlocks !== 1) throw new Error('cordis.patch.yml 托管块重复注入: ' + patchBlocks);
    },
  },

  // ---------- 场景（多趟路由 plan 出口依赖图校验——多趟语义原位重写：环 BLOCK / 缺失依赖 BLOCK / 混排合法锚 / 旧 change 渐进） ----------

  // 145（多趟语义重写）：新 change + 依赖环（P01↔P02 互为 depends_on）→ exit plan 应 BLOCKED，
  // 输出含「依赖环」（拓扑排序判环）与「depends_on」恢复指引。旧引擎无波次校验静默放行 = 预期 RED。
  {
    name: '145 plan exit BLOCKED：新 change 依赖环（P01↔P02 互为依赖）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_DEP_CYCLE);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '依赖环');
      assertOut(res, 'depends_on');
    },
  },

  // 146（多趟语义重写）：新 change + P01 依赖不存在的 T99 → exit plan 应 BLOCKED，
  // 输出含恢复指引（depends_on 调整）。旧引擎静默放行 = 预期 RED。
  {
    name: '146 plan exit BLOCKED：新 change 并行任务依赖不存在的任务（含恢复指引）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_MISSING_DEP);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'depends_on');
      assertOut(res, 'T99');
    },
  },

  // 147（混排合法锚）：新 change + 串→并→串 → 放行（串行任务位置不再受限，依赖图无环即合法）
  {
    name: '147 plan exit 通过：混排合法锚——串→并→串',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_MIXED_SPS);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 148（混排合法锚）：新 change + 并→串→并 → 放行
  {
    name: '148 plan exit 通过：混排合法锚——并→串→并',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_MIXED_PSP);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 149（混排合法锚）：新 change + 多波混合（≥2 个并行块被串行分隔）→ 放行
  {
    name: '149 plan exit 通过：混排合法锚——多波混合（两并行块被串行分隔）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, renderMultiWaveTasks());
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 150（兼容锚保留）：新 change + 全并行（单连续块仍是合法特例）→ 放行
  {
    name: '150 plan exit 通过：全并行单连续块（合法特例）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_VALID_ALL_PARALLEL);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 151（渐进语义适配）：旧 change（无 newChange）+ 依赖环 → 不 BLOCK（渐进 WARN——断言锁「不阻断」，
  // 检测须真实发生：输出 WARN 且含「依赖环」明细）。混排本身已合法化，渐进路径改由依赖图违规承载。
  {
    name: '151 plan exit 兼容：旧 change 依赖环不 BLOCK（渐进 WARN）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      // 无 newChange（旧 change）
      writeState(dir, st);
      const res = runPlanExit(dir, TASK_DEP_CYCLE);
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      assertOut(res, 'WARN');
      assertOut(res, '依赖环');
    },
  },

  // ----------  场景（契约解析失败检测——record / workflow-handoff result——T01 新增：疑似对象解析失败 fail-closed） ----------

  // 152: record 收到形似对象字面量（{ 开头 / 含 : 或 [）但 JSON.parse 失败的 payload → 应报错含
  // --json-file 提示且不写 evidence。当前实现把不可解析 raw 静默作 summary 字符串落库 = 预期 RED（静默落脏）
  {
    name: '152 record 疑似对象解析失败 → 报错含 --json-file 且不写 evidence',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      // 形似对象字面量但未闭合（PowerShell 剥离内嵌引号后常见的损坏 JSON 形态）
      const bad = '{summary: "intake", completedChecks: ["unit-tests"]';
      const res = runState(['record', 'open', bad], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 1);
      assertOut(res, '--json-file');
      // fail-closed：state 文件须保持原样（evidence.open 未被脏字符串污染）
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st2.evidence.open || st2.evidence.open.summary !== 'intake complete') {
        throw new Error('record 解析失败后仍写入了 evidence（应 fail-closed 不落库）: ' + JSON.stringify(st2.evidence.open));
      }
    },
  },

  // 153: workflow-handoff result 收到形似对象但 JSON.parse 失败的 payload → 应报错含 --json-file
  // 且不写 handoffResult。当前实现把不可解析 raw 静默作字符串存入 handoffResult = 预期 RED（静默落脏）
  {
    name: '153 handoff result 疑似对象解析失败 → 报错含 --json-file 且不写 handoffResult',
    run: (dir) => {
      const st = baseState('subagent-execute');
      st.evidence['subagent-execute'] = { handoffRequest: { T01: { taskId: 'T01' } } };
      writeState(dir, st);
      // 形似对象字面量但未闭合（损坏的 Return Contract JSON）
      const bad = '{"commitHash": "abcd1234", "completedChecks": ["required-skill:';
      const res = runHandoff(['result', 'T01', bad], dir);
      assertExit(res, 1);
      assertOut(res, '--json-file');
      // fail-closed：handoffResult 不得写入
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const hr = st2.evidence && st2.evidence['subagent-execute'] && st2.evidence['subagent-execute'].handoffResult;
      if (hr && hr.T01) {
        throw new Error('handoff result 解析失败后仍写入了 handoffResult（应 fail-closed 不落库）: ' + JSON.stringify(hr.T01));
      }
    },
  },

  // ---------- 场景（mechanism-skill-robustness 试先行 RED：共享判定单一来源 / --json-file 消息分级 /
  // 启发式安全侧边界锚定 / 零提交正式语义 / SUMMARY·TASK7·三文档模板保真 / 技能加载前置门 /
  // next·entry 输出点名 / 技能加载措辞 / next 进行中节点保护扩展） ----------

  // 154: 单一来源静态锁（设计语义 / AC-1 + F-3 / AC-5）——① workflow-state.mjs 与
  // workflow-handoff.mjs 不得各自定义 looksLikeObjectLiteral，必须从 state-schema.mjs import
  //（单一来源 fail-closed）；② F-3：workflow-guard/state/handoff 三消费脚本均须从
  // route-node.mjs import EXECUTE_FAMILY_NODE_IDS，且源码中不得再出现 execute 家族成员内联 pair
  //（<ident> === 'execute' || <ident> === 'subagent-execute'，正反顺序）→ 0 命中。
  // 允许清单：单节点分支 / hasSubagentNode 协议判定 / 证据键与文案不参与 pair 断言。
  // ② 本轮修复在既有场景内扩展（不新增顶层编号，场景数保持 258）。

  {
    name: '154 单一来源静态锁：state/handoff 不内置 looksLikeObjectLiteral + 三消费脚本 import EXECUTE_FAMILY_NODE_IDS 且无内联 pair',
    run: (dir) => {
      const schemaPath = path.join(__dirname, 'state-schema.mjs');
      const script = `
        const fs = require('fs');
        const state = fs.readFileSync(process.argv[1], 'utf8');
        const handoff = fs.readFileSync(process.argv[2], 'utf8');
        const schema = fs.readFileSync(process.argv[3], 'utf8');
        const issues = [];
        if (/function\\s+looksLikeObjectLiteral\\s*\\(/.test(state)) issues.push('workflow-state.mjs 仍自带 looksLikeObjectLiteral 定义');
        if (/function\\s+looksLikeObjectLiteral\\s*\\(/.test(handoff)) issues.push('workflow-handoff.mjs 仍自带 looksLikeObjectLiteral 定义');
        if (!/looksLikeObjectLiteral/.test(schema)) issues.push('state-schema.mjs 未导出共享判定');
        if (!/import\\s*\\{[^}]*looksLikeObjectLiteral[^}]*\\}\\s*from\\s*['"]\\.\\/state-schema\\.mjs['"]/.test(state)) issues.push('workflow-state.mjs 未从 state-schema.mjs import');
        if (!/import\\s*\\{[^}]*looksLikeObjectLiteral[^}]*\\}\\s*from\\s*['"]\\.\\/state-schema\\.mjs['"]/.test(handoff)) issues.push('workflow-handoff.mjs 未从 state-schema.mjs import');
        if (issues.length > 0) { console.error(issues.join('; ')); process.exit(1); }
        console.log('SINGLE SOURCE OK');
      `;
      const res = spawnSync(process.execPath, ['-e', script, STATE, HANDOFF, schemaPath], { encoding: 'utf8', timeout: 60000 });
      assertExit(res, 0);
      assertOut(res, 'SINGLE SOURCE OK');

      // ===== F-3（AC-5）：三消费脚本 execute 家族成员单一来源静态锁 ====
      // ① import 断言：枚举 import 语句后匹配 source + 具名符号（容忍重排/多行/其它符号共存）。
      const importRe = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
      const hasNamedImport = (text, source, name) => {
        importRe.lastIndex = 0;
        let m;
        while ((m = importRe.exec(text)) !== null) {
          if (m[2] === source && m[1].split(',').some((s) => s.trim() === name)) return true;
        }
        return false;
      };
      // ② 内联 pair 检测器：`=== 'execute'` 与 `=== 'subagent-execute'` 经 `||` 直连（正反顺序）。
      // 只命中双侧 === || === 组合；单节点分支（&& / 单 compare）、协议判定、证据键不命中
      //（下方合成正/负例自锚，防检测器退化为永不生效或误伤允许形态）。
      const pairRe = /(?:[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*===\s*'execute'\s*\)?\s*\|\|\s*\(?\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*===\s*'subagent-execute')|(?:[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*===\s*'subagent-execute'\s*\)?\s*\|\|\s*\(?\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*===\s*'execute')/g;
      const detectorPositive = [
        "(node.id === 'execute' || node.id === 'subagent-execute')",
        "(detectedNode === 'subagent-execute' || detectedNode === 'execute')",
        "(nodeId === 'execute' || requestNode === 'subagent-execute')",
      ];
      const detectorNegative = [
        "if (node.id === 'execute' && state.activeChange) {",
        "if (node.id === 'subagent-execute' && state.activeChange) {",
        "(protocol.nodes ?? []).some(n => n.id === 'subagent-execute')",
        "state.evidence['subagent-execute'] = state.evidence['subagent-execute'] || {};",
        "hasSubagentNode(protocol)",
      ];
      const issues = [];
      for (const candidate of detectorPositive) {
        pairRe.lastIndex = 0;
        if (!pairRe.test(candidate)) issues.push('内联 pair 检测器自身失效：未命中已知历史形态 ' + JSON.stringify(candidate));
      }
      for (const candidate of detectorNegative) {
        pairRe.lastIndex = 0;
        if (pairRe.test(candidate)) issues.push('内联 pair 检测器误报允许形态：' + JSON.stringify(candidate));
      }
      const familySources = [
        ['workflow-guard.mjs', GUARD],
        ['workflow-state.mjs', STATE],
        ['workflow-handoff.mjs', HANDOFF],
      ];
      for (const [sourceName, sourceFile] of familySources) {
        const text = fs.readFileSync(sourceFile, 'utf8');
        if (!hasNamedImport(text, './route-node.mjs', 'EXECUTE_FAMILY_NODE_IDS')) {
          issues.push(sourceName + ' 未从 ./route-node.mjs import EXECUTE_FAMILY_NODE_IDS（execute 家族成员须单一来源）');
        }
        const sourceLines = text.split('\n');
        pairRe.lastIndex = 0;
        let m;
        while ((m = pairRe.exec(text)) !== null) {
          const lineNo = text.slice(0, m.index).split('\n').length;
          issues.push(sourceName + ':' + lineNo + ' 出现 execute 家族成员内联 pair（应改用 EXECUTE_FAMILY_NODE_IDS.has(...)）: ' + sourceLines[lineNo - 1].trim());
        }
      }
      if (issues.length > 0) throw new Error(issues.join(String.fromCharCode(10)));
    },
  },

  // 155: record 契约解析失败消息分级（设计语义 / AC-3）——--json-file 传入损坏 JSON（以 { 开头）
  // → 报"文件内容不是合法 JSON" + 长度元数据，且不再建议使用 --json-file；内联传参损坏仍建议
  // --json-file。当前两分支同一英文文案（都建议 use --json-file）→ ① 断言 RED。
  {
    name: '155 record 契约解析失败消息分级：--json-file 损坏提示非合法；内联仍提示 --json-file',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // ① --json-file 指向损坏 JSON（以 { 开头）→ "不是合法 JSON" + 长度元数据，不再建议 --json-file
      writeFile(dir, 'payload.json', '{summary: "broken", completedChecks: ["x"]');
      const resFile = runState(['record', 'open', '--json-file', 'payload.json'], dir, env);
      assertExit(resFile, 1);
      assertNotOut(resFile, '--json-file');
      assertOut(resFile, '不是合法 JSON');
      assertOut(resFile, 'length=');
      // ② 内联传参损坏（以 { 开头）→ 仍建议 --json-file（既有语义保留）
      const bad = '{summary: "broken"';
      const resInline = runState(['record', 'open', bad], dir, env);
      assertExit(resInline, 1);
      assertOut(resInline, '--json-file');
    },
  },

  // 156: 疑似对象启发式安全侧边界锚定（设计语义 / AC-4）——内联纯文本恰好以 [ 开头 → 启发式判为
  // 疑似对象、JSON.parse 失败 → fail-closed（exit 1 + 提示、不落库）。当前即如此 → 本场景 GREEN
  // （只锚定现状，不改行为）。
  {
    name: '156 启发式安全侧边界：内联纯文本以 [ 开头 → fail-closed（锚定现状）',
    run: (dir) => {
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const res = runState(['record', 'open', '[plain-text-not-json'], dir, env);
      assertExit(res, 1);
      if (!/--json-file|not valid JSON|不是合法 JSON/.test(res.output)) {
        throw new Error('fail-closed 应有提示（--json-file / not valid JSON / 不是合法 JSON），实际输出: ' + res.output);
      }
      // fail-closed：evidence 不被污染
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st2.evidence.open || st2.evidence.open.summary !== 'intake complete') {
        throw new Error('纯文本以 [ 开头应 fail-closed 不落库，state 被污染: ' + JSON.stringify(st2.evidence.open));
      }
    },
  },

  // 157: 零提交任务正例（设计语义 / AC-5 / AC-7）——① request write_files 为空 + 契约显式 noCommit +
  // result 无任何提交 → 跳过提交文件子集校验并输出可审计"零提交"提示（不误 BLOCK）；
  // ② 真实 request（F-6）：临时 git 仓 + .gitignore 忽略 .specs/，TASK write_files 全为字面
  // .specs/... 路径 → 引擎记 handoffRequests.<id>.noCommit=true（可证明全部 gitignored）；
  // result 回传无 commitHash 的零提交契约 → 记录成功、输出"零提交"、无 HANDOFF ERROR。
  // 修复前 request 只认「<write_files> 元素存在且为空」→ ② 无 noCommit → 预期 RED。
  {
    name: '157 零提交正例：空 write_files 跳过校验；全字面 gitignored 真实 request 记 noCommit',
    run: (dir) => {
      // ① 空 write_files 既有正例（request 落库夹具；零回归锚）
      const st = baseState('subagent-execute');
      st.newChange = true;
      st.evidence['subagent-execute'] = { handoffRequests: { T01: { description: 'zero-commit task', writeFiles: [] } } };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T01" status="done"><action>only docs already tracked</action><write_files></write_files><verify>node --check src/t1.mjs</verify></task>\n');
      const res = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check src/t1.mjs', output: 'no output（RED 锚点）' },
        greenEvidence: { command: 'node --check src/t1.mjs', output: 'ok' },
      })], dir);
      assertExit(res, 0);
      assertOut(res, '零提交');
      // ② 全字面 gitignored 正例：临时 git 仓 + .gitignore 忽略 .specs/；真实 request 自动解析 TASK.md
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      writeFile(dir, '.gitignore', '.specs/\n');
      writeFile(dir, 'baseline.js', 'export const baseline = 1;\n');
      git('add', '.gitignore', 'baseline.js');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init baseline');
      // write_files 全为字面 .specs/...（被 .gitignore 忽略；不要求预先存在——check-ignore 按规则判）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="T02" status="done"><action>写变更内部面工件</action>'
        + '<write_files>\n.specs/' + CHANGE_ID + '/notes/T02.md\n.specs/' + CHANGE_ID + '/T02-SUMMARY.md\n</write_files>'
        + '<verify>node --check baseline.js</verify></task>\n');
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/subagent-execute-flow-comet-dev.json',
        JSON.stringify({ node: 'subagent-execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const st2 = baseState('subagent-execute');
      st2.newChange = true;
      writeState(dir, st2);
      const resReq = runHandoff(['request', 'T02', 'delegate docs-only slice'], dir);
      assertExit(resReq, 0);
      assertOut(resReq, 'HANDOFF REQUEST: T02');
      // 先断资格落库（RED 取证点：修复前 request 只认空 write_files → 此断言先红），后断审计文案
      const stAfter = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const req = stAfter.evidence['subagent-execute'].handoffRequests.T02;
      if (!req || req.noCommit !== true) {
        throw new Error('全字面 gitignored write_files 应记 noCommit:true，实际 ' + JSON.stringify(req));
      }
      assertOut(resReq, '零提交资格');
      const resZero = runHandoff(['result', 'T02', JSON.stringify({
        status: 'DONE', taskId: 'T02', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check baseline.js', output: 'no output（RED 锚点）' },
        greenEvidence: { command: 'node --check baseline.js', output: 'ok' },
      })], dir);
      assertExit(resZero, 0);
      assertOut(resZero, '零提交');
      assertNotOut(resZero, 'HANDOFF ERROR');
    },
  },

  // 158: 零提交滥用负例（设计语义 / AC-6 / AC-8）——① write_files 非空任务的结果契约声称 noCommit
  // → 不得借零提交声明绕过真实提交检查：仍走完整提交文件子集校验（越界 → 新 change BLOCK），且输出
  // 可审计的"零提交声明与 write_files 非空矛盾"提示；
  // ② F-6 请求侧 fail-closed：glob 魔法 / 路径越界（../）/ 非 git 仓 / 非 git top-level 的 runRoot
  // → request 不记 noCommit（不阻断原流程、仍记 writeFiles）；
  // ③ 请求无资格 + 契约声称 noCommit → 仍完整校验（WARN + 越界 BLOCK，零提交声明无效）。
  {
    name: '158 零提交滥用负例：非空声称 noCommit 仍完整校验；glob/越界/非 git/非 top-level 请求不记 noCommit',
    run: (dir) => {
      const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      g(['init', '-q']);
      g(['config', 'user.email', 't@t']);
      g(['config', 'user.name', 't']);
      writeFile(dir, 'allowed.js', 'export const allowed = 1;\n');
      writeFile(dir, 'rogue.js', 'export const rogue = 1;\n');
      g(['add', 'allowed.js', 'rogue.js']);
      g(['commit', '-qm', 'init']);
      const hash = g(['rev-parse', 'HEAD']).stdout.trim();
      const st = baseState('subagent-execute');
      st.newChange = true;
      st.evidence['subagent-execute'] = { handoffRequests: { T01: { description: 'normal task', writeFiles: ['allowed.js'] } } };
      writeState(dir, st);
      const res = runHandoff(['result', 'T01', JSON.stringify({
        status: 'DONE', taskId: 'T01', noCommit: true, commitHash: hash,
        changedFiles: ['allowed.js', 'rogue.js'],
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check allowed.js', output: 'no output（RED 锚点）' },
        greenEvidence: { command: 'node --check allowed.js', output: 'ok' },
      })], dir);
      assertExit(res, 1);
      assertOut(res, '超出 writeFiles 范围');
      assertOut(res, '零提交');
      // ② F-6 请求侧 fail-closed：不具资格形态 → request 不记 noCommit、不阻断原流程。
      // 夹具加强：.gitignore 同时忽略 src/gen/ 与 .specs/——globs/子目录锚的路径在缺判定时会
      // 被 git check-ignore 命中，故必须由字面/包含判定本身拒绝，锚才具备判别力（可反向构造红）。
      writeFile(dir, '.gitignore', 'src/gen/\n.specs/\n');
      // 请求夹具（旧 change 语义：技能加载门 WARN 渐进，不干扰本锚）
      writeState(dir, baseState('subagent-execute'));
      const readReq = (id) => {
        const s = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
        return (s.evidence['subagent-execute'].handoffRequests || {})[id];
      };
      const requestWithWriteFiles = (id, writeFilesElement) => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
          + '<task id="' + id + '" status="done"><action>边界任务</action>'
          + '<write_files>' + writeFilesElement + '</write_files>'
          + '<verify>node --check allowed.js</verify></task>\n');
        const r = runHandoff(['request', id, 'boundary slice'], dir);
        assertExit(r, 0);
        return r;
      };
      // ②a glob 魔法 `*` → 无可证明资格（不展开 glob、不享受零提交）
      const resGlob = requestWithWriteFiles('T02', 'src/gen/*.mjs');
      assertNotOut(resGlob, 'HANDOFF ERROR');
      const reqGlob = readReq('T02');
      if (!reqGlob || reqGlob.noCommit === true) {
        throw new Error('glob write_files 不应具备零提交资格，实际 ' + JSON.stringify(reqGlob));
      }
      if (!Array.isArray(reqGlob.writeFiles) || reqGlob.writeFiles[0] !== 'src/gen/*.mjs') {
        throw new Error('不具资格也不得丢失 writeFiles 记录: ' + JSON.stringify(reqGlob.writeFiles));
      }
      // ②b 路径越界（../ 逃逸 runRoot）→ 无资格
      requestWithWriteFiles('T03', '../../outside.md');
      const reqEscape = readReq('T03');
      if (!reqEscape || reqEscape.noCommit === true) {
        throw new Error('../ 逃逸 write_files 不应具备零提交资格，实际 ' + JSON.stringify(reqEscape));
      }
      // ②c 非 git 仓（独立临时目录，无 .git）→ 无资格；场景自建临时目录须自清理
      //（运行器只回收场景主目录；残留校验会抓走漏——故 try/finally 内自删）
      const nonGit = makeTmp();
      try {
        writeFile(nonGit, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
          + '<task id="T04" status="done"><action>边界任务</action>'
          + '<write_files>.specs/' + CHANGE_ID + '/x.md</write_files>'
          + '<verify>node --check allowed.js</verify></task>\n');
        writeState(nonGit, baseState('subagent-execute'));
        const resNonGit = runHandoff(['request', 'T04', 'non-git slice'], nonGit);
        assertExit(resNonGit, 0);
        const stNonGit = JSON.parse(fs.readFileSync(path.join(nonGit, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
        const reqNonGit = stNonGit.evidence['subagent-execute'].handoffRequests.T04;
        if (!reqNonGit || reqNonGit.noCommit === true) {
          throw new Error('非 git 仓不应具备零提交资格，实际 ' + JSON.stringify(reqNonGit));
        }
      } finally {
        fs.rmSync(nonGit, { recursive: true, force: true });
      }
      // ②d runRoot 非 git top-level（仓内子目录）→ 无资格
      writeFile(dir, 'sub/.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="T05" status="done"><action>边界任务</action>'
        + '<write_files>.specs/' + CHANGE_ID + '/x.md</write_files>'
        + '<verify>node --check allowed.js</verify></task>\n');
      const sub = path.join(dir, 'sub');
      writeState(sub, baseState('subagent-execute'));
      const resSub = runHandoff(['request', 'T05', 'subdir slice'], sub);
      assertExit(resSub, 0);
      const stSub = JSON.parse(fs.readFileSync(path.join(sub, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const reqSub = stSub.evidence['subagent-execute'].handoffRequests.T05;
      if (!reqSub || reqSub.noCommit === true) {
        throw new Error('runRoot 非 git top-level 不应具备零提交资格，实际 ' + JSON.stringify(reqSub));
      }
      // ③ 请求无资格（glob）+ 契约声称 noCommit → 仍完整提交文件子集校验（越界新 change BLOCK）
      const stIneligible = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      stIneligible.newChange = true;
      writeState(dir, stIneligible);
      writeFile(dir, 'src/deep/rogue.js', 'export const deepRogue = 1;\n');
      g(['add', 'src/deep/rogue.js']);
      g(['commit', '-qm', 'deep rogue']);
      const deepHash = g(['rev-parse', 'HEAD']).stdout.trim();
      const resIneligible = runHandoff(['result', 'T02', JSON.stringify({
        status: 'DONE', taskId: 'T02', noCommit: true, commitHash: deepHash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check allowed.js', output: 'ok' },
        greenEvidence: { command: 'node --check allowed.js', output: 'ok' },
      })], dir);
      assertExit(resIneligible, 1);
      assertOut(resIneligible, '契约声明零提交但 write_files 非空');
      assertOut(resIneligible, '超出 writeFiles 范围');
    },
  },

  // 159: SUMMARY 模板保真（设计语义 / AC-7）——execute 出口每份 *-SUMMARY.md 须含 `# SUMMARY:` 标题 +
  // 首部 4 字段（Change ID/Task ID/完成时间/AI 角色）+ 段序（含 flow-comet 增量 ## 自检方法 段）。
  // 缺任一：新 change BLOCK（exit 1 + 缺失点与恢复指引）；合法变体（编号前缀/括号后缀/大小写）通过；
  // 旧 change → WARN 渐进。当前 guard 只查 verify输出/6维自查/越界检查 3 段存在 → 缺标题等场景 RED。
  {
    name: '159 execute exit SUMMARY 模板保真：缺标题/首部/段序新 BLOCK，合法变体通过，旧 WARN',
    run: (dir) => {
      const marker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/execute-flow-comet-dev.json',
          JSON.stringify({ node: 'execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      const header = [
        '- **Change ID**: ' + CHANGE_ID,
        '- **Task ID**: T01',
        '- **完成时间**: 2026-08-20 10:00',
        '- **AI 角色**: Dev',
      ].join('\n');
      const sections = [
        '## 做了什么\n\n实现 T01（TDD：先写失败场景再实现）。',
        '## 改动文件\n\n| 文件 | 性质 | 说明 |\n|---|---|---|\n| src/t1.mjs | 修改 | 实现 T01 |',
        '## verify 输出\n\n```\nnode --check src/t1.mjs\n```',
        '## 6 维自查\n\n- 功能: 通过（brooks-review 已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
        '## 越界检查\n\n仅修改 src/t1.mjs，无越界。',
        '## 自检方法\n\nbrooks-review',
      ];
      const compose = (title, order) =>
        [title, '', header, '', '---', '', order.join('\n\n')].join('\n');
      const setupExecute = (newChange) => {
        const st = baseState('execute');
        st.evidence.execute = { summary: 'executed' };
        st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
        if (newChange) { st.newChange = true; st.enteredNodes = ['execute']; }
        writeState(dir, st);
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_DONE);
        marker();
      };
      // ① 新 change：缺 `# SUMMARY:` 标题（段齐全）→ BLOCK
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# T01-SUMMARY', sections));
      const res1 = runGuard(['exit', 'execute'], dir);
      assertExit(res1, 1);
      assertOut(res1, 'BLOCKED');
      assertOut(res1, '# SUMMARY:');
      // ② 新 change：标题在但首部缺字段（仅 2 字段）→ BLOCK
      const headerMissing = [
        '- **Change ID**: ' + CHANGE_ID,
        '- **Task ID**: T01',
      ].join('\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md',
        ['# SUMMARY: T01 - 实现 T01', '', headerMissing, '', '---', '', sections.join('\n\n')].join('\n'));
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 1);
      assertOut(res2, 'BLOCKED');
      // ③ 新 change：段序乱（自检方法提前、做了什么滞后）→ BLOCK
      const scrambled = [sections[2], sections[4], sections[3], sections[5], sections[0], sections[1]];
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', scrambled));
      const res3 = runGuard(['exit', 'execute'], dir);
      assertExit(res3, 1);
      assertOut(res3, 'BLOCKED');
      // ④ 合法变体：大小写（# Summary: …）→ 通过
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# Summary: T01 - 实现 T01', sections));
      const res4 = runGuard(['exit', 'execute'], dir);
      assertExit(res4, 0);
      assertOut(res4, 'ALL CHECKS PASSED');
      // ⑤ 合法变体：括号后缀 → 通过
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01（含说明括号）', sections));
      const res5 = runGuard(['exit', 'execute'], dir);
      assertExit(res5, 0);
      assertOut(res5, 'ALL CHECKS PASSED');
      // ⑥ 旧 change：缺标题 → WARN 渐进不阻断
      setupExecute(false);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# T01-SUMMARY', sections));
      const res6 = runGuard(['exit', 'execute'], dir);
      assertExit(res6, 0);
      assertOut(res6, 'WARN');
    },
  },

  // 160: plan exit TASK 7 字段完整性（设计语义 / AC-8）——每个 <task> 须含 name/read_files/
  // write_files/action/verify/done/depends_on。缺任一：新 BLOCK；旧 WARN。当前 guard 只查
  // <verify> 存在 → 缺 write_files 场景新 change 应 BLOCK 却放行 → 预期 RED。
  {
    name: '160 plan exit TASK 7 字段：缺 write_files 新 BLOCK / 旧 WARN',
    run: (dir) => {
      const missingWrite =
        '<task id="T01" status="pending"><name>任务一</name><read_files>src/*</read_files><action>实现 T01</action><verify>node --check src/t1.mjs</verify><done>AC-1</done><depends_on></depends_on></task>\n';
      const addPlanMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/plan-flow-comet-task.json',
          JSON.stringify({ node: 'plan', skill: 'flow-comet-task', protocol: '3-task.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      // ① 新 change：缺 write_files → BLOCK（含字段名）
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      addPlanMarker();
      const res = runPlanExit(dir, missingWrite);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'write_files');
      // ② 旧 change：同构造 → WARN 渐进不阻断
      const stOld = baseState('plan');
      stOld.evidence.plan = { summary: 'plan done' };
      writeState(dir, stOld);
      addPlanMarker();
      const resOld = runPlanExit(dir, missingWrite);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');
    },
  },

  // 161: open/design 出口 CHANGE/REQUIREMENT/DESIGN 模板保真（设计语义 / AC-9）——标题
  // （# CHANGE: / # REQUIREMENT: / # DESIGN:）+ 首部 + 段序（模板派生宽松匹配，编号前缀/括号
  // 后缀/大小写兼容，防误拦）。缺任一：新 BLOCK；旧 WARN。当前 guard 只查 Why/用户故事/AC/
  // 决策清单等单段存在 → 缺标题场景新 change 应 BLOCK 却放行 → 预期 RED。
  {
    name: '161 open/design 出口三文档模板保真：缺标题新 BLOCK / 旧 WARN',
    run: (dir) => {
      const addOpenMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
          JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      const addDesignMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/design-flow-comet-design.json',
          JSON.stringify({ node: 'design', skill: 'flow-comet-design', protocol: '2-design.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      // ① open 出口 新 change：REQUIREMENT 缺 `# REQUIREMENT:` 标题（段齐全）→ BLOCK
      const stOpen = baseState('open');
      stOpen.evidence.open = { summary: 'intake complete' };
      stOpen.newChange = true;
      stOpen.enteredNodes = ['open'];
      writeState(dir, stOpen);
      addOpenMarker();
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# 变更文档\n\n## Why（为什么做）\n\n原因。\n\n## 范围（Scope）\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# 需求文档\n\n## 用户故事\n\n- US-1 作为维护者……\n\n## 验收准则（AC）\n\n- Given X When Y Then Z\n');
      const resOpen = runGuard(['exit', 'open'], dir);
      assertExit(resOpen, 1);
      assertOut(resOpen, 'BLOCKED');
      assertOut(resOpen, 'REQUIREMENT');
      // ② design 出口 新 change：DESIGN 缺 `# DESIGN:` 标题（段齐全）→ BLOCK
      const stDesign = baseState('design');
      stDesign.evidence.design = { summary: 'design done' };
      stDesign.newChange = true;
      stDesign.enteredNodes = ['design'];
      writeState(dir, stDesign);
      addDesignMarker();
      writeFile(dir, 'flow-kit/templates/DESIGN.md', '# DESIGN 模板\n\n## 0. 技术栈选型\n## 1. 技术决策清单\n## 2. 数据流\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# 设计文档\n\n## 0. 技术栈选型\n\n- 选定：Node.js\n\n## 决策清单\n\n| # | 决策 | 选择 | 理由 |\n|---|---|---|---|\n| D1 | X | Y | Z |\n');
      const resDesign = runGuard(['exit', 'design'], dir);
      assertExit(resDesign, 1);
      assertOut(resDesign, 'BLOCKED');
      assertOut(resDesign, 'DESIGN');
      // ③ 旧 change open 同构造（REQUIREMENT 缺标题）→ WARN 渐进不阻断
      const stOld = baseState('open');
      stOld.evidence.open = { summary: 'intake complete' };
      writeState(dir, stOld);
      addOpenMarker();
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# 变更文档\n\n## Why（为什么做）\n\n原因。\n\n## 范围（Scope）\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# 需求文档\n\n## 用户故事\n\n- US-1 作为维护者……\n\n## 验收准则（AC）\n\n- Given X When Y Then Z\n');
      const resOld = runGuard(['exit', 'open'], dir);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');
    },
  },

  // 162: 技能加载前置门（设计语义 / AC-10）——新 change：handoff request 无本节点声明标记
  // 应 BLOCK；record 无声明（payload 不含 completedChecks）应 BLOCK；旧 change → WARN 渐进。
  // 当前 request 不查声明、record 靠 M5 自动补 → 不拦 → 预期 RED。
  {
    name: '162 技能加载前置门：request/record 无声明新 BLOCK / 旧 WARN',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // ① handoff request 前置门：新 change、subagent-execute 节点无声明标记 → BLOCK
      const stReq = baseState('subagent-execute');
      stReq.newChange = true;
      writeState(dir, stReq);
      const resReq = runHandoff(['request', 'T01', 'delegate parallel task'], dir);
      assertExit(resReq, 1);
      assertOut(resReq, '先加载技能');
      // ② record 前置门：新 change、plan 节点无声明标记、payload 不含 completedChecks → BLOCK
      const stRec = baseState('plan');
      stRec.newChange = true;
      writeState(dir, stRec);
      const resRec = runState(['record', 'plan', '{"summary":"plan done"}'], dir, env);
      assertExit(resRec, 1);
      assertOut(resRec, '先加载技能');
      // ③ 旧 change：record 无声明 → WARN 渐进不阻断
      const stOld = baseState('plan');
      writeState(dir, stOld);
      const resOld = runState(['record', 'plan', '{"summary":"plan done"}'], dir, env);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');
    },
  },

  // 163: next / guard entry 输出点名加载（设计语义 / AC-17）——`workflow-state next` 与
  // `workflow-guard entry` 输出应含 `LOAD SKILL: <skill>（用 Skill 工具，禁止跳过）`。
  // 当前 printNext / entry 无该行 → 预期 RED。
  {
    name: '163 next / entry 输出点名 LOAD SKILL：用 Skill 工具，禁止跳过',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // ① next：open 节点 → 输出点名 flow-comet-open
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      const resNext = runState(['next'], dir, env);
      assertExit(resNext, 0);
      assertOut(resNext, 'LOAD SKILL: flow-comet-open');
      assertOut(resNext, '禁止跳过');
      // ② guard entry：plan 节点 → 输出点名 flow-comet-plan
      const st2 = baseState('plan');
      writeState(dir, st2);
      const resEntry = runGuard(['entry', 'plan'], dir, env);
      assertExit(resEntry, 0);
      assertOut(resEntry, 'LOAD SKILL: flow-comet-plan');
      assertOut(resEntry, '禁止跳过');
    },
  },

  // 164: 技能加载措辞（设计语义 / AC-16）——主 SKILL（SKILL.md / GUIDANCE.md）与节点 SKILL
  // 须含「Skill 工具」与「不得跳过/禁止跳过」。当前主 SKILL 已含、部分节点 SKILL 已含，但
  // open/design/plan/verify/archive 等节点 SKILL 缺 → 预期 RED。
  {
    name: '164 技能加载措辞：主 SKILL 与节点 SKILL 含 Skill 工具 + 不得/禁止跳过',
    run: (dir) => {
      const files = [
        path.join(__dirname, '..', 'SKILL.md'),
        path.join(__dirname, '..', 'GUIDANCE.md'),
        ...['flow-comet-open', 'flow-comet-design', 'flow-comet-plan', 'flow-comet-execute',
          'flow-comet-subagent-execute', 'flow-comet-review', 'flow-comet-verify', 'flow-comet-archive']
          .map((s) => path.join(__dirname, '..', '..', s, 'SKILL.md')),
      ];
      const relativeBase = path.join(__dirname, '..', '..', '..');
      const missing = [];
      for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        const hasTool = text.includes('Skill 工具');
        const hasSkip = text.includes('不得跳过') || text.includes('禁止跳过');
        if (!hasTool || !hasSkip) {
          const why = !hasTool && !hasSkip ? '缺「Skill 工具」与「不得/禁止跳过」' : (hasTool ? '缺「不得/禁止跳过」' : '缺「Skill 工具」');
          missing.push(path.relative(relativeBase, f) + ' ' + why);
        }
      }
      if (missing.length > 0) {
        throw new Error('技能加载措辞缺失: ' + missing.join('; '));
      }
    },
  },

  // 165: next 进行中节点保护扩展（承接既有保护场景）——已 entry 但未 record 的节点（enteredNodes 含 plan、
  // TASK.md 存在、无 evidence.plan）跑 next → 不得把 currentNode 推走（保持 plan，输出 NODE: plan）。
  // 当前保护只看 evidence（record 过）→ 会把 currentNode 推到 execute → 预期 RED。
  {
    name: '165 next 保护扩展：entered 未 record 节点不推走（保持 plan）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\n\nx');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n## 用户故事\n\nx\n\n## 验收准则（AC）\n\n- Given x When y Then z');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n## 0. 技术栈选型\n\n- 选定：Node\n\n## 1. 技术决策清单\n\n| # | D | R |\n|---|---|---|\n| D1 | x | y |');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_SERIAL_PENDING);
      const st = {
        activeChange: CHANGE_ID,
        currentNode: 'plan',
        completedNodes: ['open', 'design'],
        enteredNodes: ['open', 'design', 'plan'],
        evidence: {
          open: { summary: 'intake complete' },
          design: { summary: 'design done' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      };
      writeState(dir, st);
      const res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'NODE: plan');
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st2.currentNode !== 'plan') {
        throw new Error('entered 未 record 的节点不应被推进，currentNode 应为 plan，实际: ' + st2.currentNode);
      }
    },
  },

  // 166: 节点 SKILL 加载声明与协议一致（防回归锁）——每个节点 SKILL.md 必须含
  // requiredSkillCalls（非 advisory）对应的完整 skill-load 声明命令行与协议文件映射。
  {
    name: '166 节点 SKILL 声明命令与 workflow-protocol.json 一致',
    run: () => {
      const protocol = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'reference', 'workflow-protocol.json'), 'utf8'));
      const promptBySkill = {
        'flow-comet-change': '0-change.md',
        'flow-comet-requirement': '1-requirement.md',
        'flow-comet-design': '2-design.md',
        'flow-comet-task': '3-task.md',
        'flow-comet-dev': '4-dev.md',
        'flow-comet-review': '6-review.md',
        'flow-comet-test': '5-test.md',
        'flow-comet-integration': '7-integration.md',
      };
      const advisory = new Set(['flow-comet-ui-design']);
      const problems = [];
      for (const node of protocol.nodes) {
        const impl = node.implementation && node.implementation.skill;
        if (!impl) continue;
        const text = fs.readFileSync(path.join(__dirname, '..', '..', impl, 'SKILL.md'), 'utf8');
        for (const call of node.requiredSkillCalls || []) {
          if (advisory.has(call.skill)) continue;
          const promptFile = promptBySkill[call.skill];
          if (!promptFile) { problems.push(impl + ' 缺 ' + call.skill + ' 的 prompt 映射'); continue; }
          const line = 'skill-load ' + node.id + ' ' + call.skill + ' --prompt flow-kit/prompts/' + promptFile;
          if (!text.includes(line)) problems.push(impl + ' 缺声明命令: ' + line);
        }
      }
      if (problems.length > 0) throw new Error('节点 SKILL 声明命令与协议不一致: ' + problems.join('; '));
    },
  },

  // 167: 两层加载模型措辞——阶段层禁止在节点 SKILL 内指示用 Skill 工具加载任何节点实现技能
  //（本节点技能已由入口路由经 Skill 工具加载）；入口层禁止 Implementation/Required 混淆句式；
  // 全部 10 文件禁止无限定「record 会自动补写缺失的声明标记」表述（与新 change 技能加载前置门矛盾）。
  {
    name: '167 两层加载模型措辞：禁自加载句式/禁混淆句式/自动补分新旧',
    run: () => {
      const nodeDirs = ['flow-comet-open', 'flow-comet-design', 'flow-comet-plan', 'flow-comet-execute',
        'flow-comet-subagent-execute', 'flow-comet-review', 'flow-comet-verify', 'flow-comet-archive'];
      const implPattern = /用\s*Skill\s*工具加载[^。\n]{0,60}flow-comet-(open|design|plan|execute|subagent-execute|review|verify|archive)/;
      const autoFill = 'record 会自动补写缺失的声明标记';
      const stageAnchor = '本节点技能已由入口路由经 Skill 工具加载';
      const entryAnchor = 'Skill 工具加载该节点的 Implementation 技能';
      const problems = [];
      for (const id of nodeDirs) {
        const text = fs.readFileSync(path.join(__dirname, '..', '..', id, 'SKILL.md'), 'utf8');
        if (implPattern.test(text)) problems.push(id + ' 含「用 Skill 工具加载节点实现技能」句式');
        if (text.includes(autoFill)) problems.push(id + ' 含无限定自动补表述');
        if (!text.includes(stageAnchor)) problems.push(id + ' 缺阶段层锚点句');
      }
      for (const name of ['SKILL.md', 'GUIDANCE.md']) {
        const text = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
        if (text.includes('见上方 Required Calls 表')) problems.push(name + ' 含 Implementation/Required 混淆句式');
        if (text.includes(autoFill)) problems.push(name + ' 含无限定自动补表述');
        if (!text.includes(entryAnchor)) problems.push(name + ' 缺入口层锚点句');
        if (!text.includes('前置门')) problems.push(name + ' 缺前置门表述');
      }
      if (problems.length > 0) throw new Error('两层加载模型措辞不符: ' + problems.join('; '));
    },
  },

  // 168: verify 出口 EPERM 降级——受限沙箱会话中管道式执行子进程被拒（EPERM）时，
  // 以继承 stdio 重试同一命令：①输出含 VERIFY-DEGRADED 行（降级捕获标记）；②验证命令的
  // 副作用标记文件被真实写入（证明 inherit 重试真实执行——真实受限会话中管道阶段命令根本
  // 不启动，标记文件只能由重试写入）；③最终按退出码判定通过（guard exit=0）。
  // 测试钩子 FLOW_COMET_VERIFY_FORCE_EPERM=1 使首次管道执行模拟 EPERM 拒绝（仅测试用途——
  // 生产触发条件是真实 spawn 层 EPERM），降级路径因此可确定性自动化断言。
  {
    name: '168 verify 出口 EPERM 降级：VERIFY-DEGRADED 行 + inherit 真实重试 + exit 0',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      writeState(dir, st);
      // 验证命令写副作用标记文件（相对 cwd=runRoot）——文件存在即证明命令被真实执行
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "require(\'fs\').writeFileSync(\'verify-marker.txt\',\'ok\')"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      const marker = path.join(dir, 'verify-marker.txt');
      if (fs.existsSync(marker)) fs.rmSync(marker);
      const res = runGuard(['exit', 'verify'], dir, { FLOW_COMET_VERIFY_FORCE_EPERM: '1' });
      assertOut(res, 'VERIFY-DEGRADED');
      if (!fs.existsSync(marker)) {
        throw new Error('EPERM 降级后标记文件未被写入——inherit 重试未真实执行\n实际输出:\n' + res.output);
      }
      if (fs.readFileSync(marker, 'utf8') !== 'ok') throw new Error('标记文件内容异常');
      assertExit(res, 0);
    },
  },

  // 169: 非 EPERM 失败不降级——验证命令真实失败（非零退出、无 EPERM、无钩子）时行为与
  // 现状一致：VERIFY-FAIL 计数语义输出、不含 VERIFY-DEGRADED 行、guard exit≠0。
  // （锚定场景：防止降级逻辑扩大化吞掉真实测试失败——降级边界）
  {
    name: '169 非 EPERM 失败不降级：VERIFY-FAIL 照常且无 VERIFY-DEGRADED 行',
    run: (dir) => {
      const st = baseState('verify');
      st.evidence.verify = { summary: 'verified' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "process.exit(3)"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n通过\n');
      const res = runGuard(['exit', 'verify'], dir);
      assertExit(res, 1);
      assertOut(res, 'VERIFY-FAIL');
      assertNotOut(res, 'VERIFY-DEGRADED');
    },
  },

  // 170: 零提交旁路收紧——noCommit 结果若携带 tracked 提交：新 change BLOCKED / 旧 change
  // HANDOFF WARN；空提交（--allow-empty）正例通过。锚定 AC-1（防「空 write_files 声明」
  // 成为携带任意提交的逃逸口——bot 评审 Major）。
  // ④ F-6 请求侧补 tracked 负例：write_files 路径虽被 .gitignore 命中、但该路径已 tracked
  //（index-aware check-ignore 退出 1）→ 不记 noCommit（tracked 提交仍走完整子集校验）。
  {
    name: '170 零提交旁路：携带 tracked 提交新 BLOCK / 旧 WARN / 空提交通过',
    run: (dir) => {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
      writeFile(dir, 'src/x.js', 'x');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'src/x.js');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'tracked');
      const hashTracked = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const mkState = (isNew) => {
        const st = baseState('subagent-execute');
        if (isNew) st.newChange = true;
        st.evidence['subagent-execute'] = st.evidence['subagent-execute'] || {};
        st.evidence['subagent-execute'].handoffRequests = {
          T9: { description: 'zero-commit', noCommit: true },
          T10: { description: 'zero-commit legacy', noCommit: true },
          T11: { description: 'zero-commit empty', noCommit: true },
        };
        writeState(dir, st);
      };
      const payload = (id, hash) => JSON.stringify({ status: 'DONE', taskId: id, commitHash: hash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'n', output: 'n' }, redEvidence: { command: 'r', output: 'r' } });
      // ① 新 change + 含 tracked 文件的提交 → BLOCKED
      mkState(true);
      const res1 = runHandoff(['result', 'T9', payload('T9', hashTracked)], dir);
      assertExit(res1, 1);
      assertOut(res1, '声明零提交但提交携带');
      // ② 旧 change 同构造 → WARN 不阻断
      mkState(false);
      const res2 = runHandoff(['result', 'T10', payload('T10', hashTracked)], dir);
      assertExit(res2, 0);
      assertOut(res2, 'HANDOFF WARN');
      // ③ 新 change + 空提交 → 通过
      mkState(true);
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'empty');
      const hashEmpty = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const res3 = runHandoff(['result', 'T11', payload('T11', hashEmpty)], dir);
      assertExit(res3, 0);
      assertOut(res3, '提交为空，校验通过');
      // ④ F-6 请求侧 tracked 负例：路径被 .gitignore 命中但已被 index 跟踪 → check-ignore 退出 1
      writeFile(dir, '.gitignore', '.specs/\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/tracked.md', 'tracked\n');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-f', '.specs/' + CHANGE_ID + '/tracked.md');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'track ignored file');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="T12" status="done"><action>边界任务</action>'
        + '<write_files>.specs/' + CHANGE_ID + '/tracked.md</write_files>'
        + '<verify>node --check src/x.js</verify></task>\n');
      writeState(dir, baseState('subagent-execute'));
      const resReqTracked = runHandoff(['request', 'T12', 'tracked path slice'], dir);
      assertExit(resReqTracked, 0);
      const stTracked = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const reqTracked = stTracked.evidence['subagent-execute'].handoffRequests.T12;
      if (!reqTracked || reqTracked.noCommit === true) {
        throw new Error('tracked 文件路径不应具备零提交资格，实际 ' + JSON.stringify(reqTracked));
      }
    },
  },

  // 171: 入口文档首部 Change ID 新 change 强制——标题/段序合规但缺 `- **Change ID**:`
  // 首部字段：新 change open 出口 BLOCKED（文案「首部缺 Change ID」）；旧 change WARN 渐进。
  // （对齐 AC「标题·首部·段序」统一强制口径——bot 评审指出此前仅 softWarning 与承诺不符。）
  {
    name: '171 入口首部 Change ID 新 BLOCK / 旧 WARN',
    run: (dir) => {
      const addOpenMarker = () => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
          JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      const writeChange = (withId) => {
        const head = withId ? '- **Change ID**: ' + CHANGE_ID + '\n' : '';
        writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE: 标题\n\n' + head + '\n## Why（为什么做）\n\n原因。\n');
        writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT: 标题\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 用户故事\n\n- US-1\n\n## 验收准则（AC）\n\n- Given a When b Then c\n');
      };
      // ① 新 change 缺首部字段 → BLOCK
      const stNew = baseState('open');
      stNew.evidence.open = { summary: 'intake complete' };
      stNew.newChange = true;
      stNew.enteredNodes = ['open'];
      writeState(dir, stNew);
      addOpenMarker();
      writeChange(false);
      const resBad = runGuard(['exit', 'open'], dir);
      assertExit(resBad, 1);
      assertOut(resBad, 'BLOCKED');
      assertOut(resBad, '首部缺 Change ID');
      // ② 新 change 含首部字段 → 通过
      writeChange(true);
      const resGood = runGuard(['exit', 'open'], dir);
      assertExit(resGood, 0);
      assertOut(resGood, 'ALL CHECKS PASSED');
      // ③ 旧 change 缺首部字段 → WARN 渐进不阻断
      const stOld = baseState('open');
      stOld.evidence.open = { summary: 'intake complete' };
      writeState(dir, stOld);
      addOpenMarker();
      writeChange(false);
      const resOld = runGuard(['exit', 'open'], dir);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');
    },
  },

  // ---------- 场景（多趟路由核心——多趟推进完成 / 零进展防呆 / 委托节点二次进入完成判定 / 向后兼容等价） ----------

  // 172: 多波混合推进完成（AC-1/AC-2）——多波混合 TASK 经 next 分趟自动路由直至清空：
  // 无 eligible 并行时回串行消化（execute）；依赖满足即再入 subagent-execute（第二趟——
  // completedNodes 已含该节点仍路由回 = 多趟循环路由）；全部 done 后经产物门控进 review。
  // 旧引擎单趟限制下第三步会停留在 execute = 预期 RED。
  {
    name: '172 多波混合推进完成：分趟自动路由直至清空进 review',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      const goNext = (currentNode, doneIds, completedExtra = []) => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + renderMultiWaveTasks(doneIds));
        writeState(dir, {
          activeChange: CHANGE_ID,
          currentNode,
          completedNodes: ['open', 'design', 'plan', ...completedExtra],
          evidence: {
            open: { summary: 'o' },
            design: { summary: 'd' },
            plan: { summary: 'p' },
            ...(completedExtra.includes('subagent-execute') ? { 'subagent-execute': { summary: 'wave delegated' } } : {}),
            ...(completedExtra.includes('execute') ? { execute: { summary: 'serial digested' } } : {}),
          },
          verifyFailures: 0,
          executionMode: 'subagent',
          directOverride: false,
        });
        return runState(['next'], dir, env);
      };
      // 趟 0：无可委托并行（P 波依赖 T01 未完成）、串行 T01 pending → execute
      let res = goNext('execute', []);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // 趟 1：T01 done → P01/P02 eligible → 第一趟委托
      res = goNext('execute', ['T01']);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // 趟间：P01/P02 done（第一趟委托收集完成）→ 回 execute 消化 T02（第二波未满足不抢跑）
      res = goNext('subagent-execute', ['T01', 'P01', 'P02'], ['subagent-execute']);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // 趟 2（多趟关键断言）：T02 done → P03/P04 eligible → 第二趟再入 subagent-execute
      //（真实链路中此处由 execute exit --apply 的平行路由镜像直接落点；next 级断言同一谓词）
      res = goNext('subagent-execute', ['T01', 'P01', 'P02', 'T02'], ['subagent-execute', 'execute']);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // 清空：全部 done + SUMMARY 在场 → 委托与串行均无残留 → review（产物门控照旧）。
      // 状态取真实链路形态：completedNodes 按路由序排列（末元素 = subagent-execute，
      // 其 exit --apply 已把 currentNode 推到 review——正常推进豁免放行 next）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      res = goNext('review', ['T01', 'P01', 'P02', 'T02', 'P03', 'P04'], ['execute', 'subagent-execute']);
      assertExit(res, 0);
      assertOut(res, 'NODE: review');
    },
  },

  // 173: 单趟零进展防呆（三重防呆决策之二·状态机侧）——TASK 仅剩依赖无法满足的孤儿并行任务（depends_on 引用
  // 不存在的 T99）：既无可委托并行又无串行 pending 且 TASK 未全 done → next 应 BLOCKED 防静默死锁。
  // 旧引擎无防呆静默路由 execute = 预期 RED。
  {
    name: '173 单趟零进展 BLOCK：孤儿并行依赖无法满足（检查 depends_on）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify><depends_on>T99</depends_on></task>\n');
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes: ['open', 'design', 'plan'],
        evidence: { open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      const res = runState(['next'], dir, env);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '孤儿并行');
      assertOut(res, 'depends_on');
    },
  },

  // 174: 委托节点二次进入完成判定（AC-2 合取语义）——completedNodes 含 subagent-execute：
  // ① 仍有 eligible 并行 pending → next 返回 NODE: subagent-execute（未最终完成，继续委托）；
  // ② 并行全 done、仅串行 pending → NODE: execute（本趟委托完成，趟间回串行）；
  // ③ 全部 done + SUMMARY 在场 → NODE: review（可委托集合为空 ∧ 无串行 pending → 最终完成）。
  // 旧引擎①停留 execute = 预期 RED。
  {
    name: '174 委托节点二次进入完成判定：eligible 再入 → 趟间串行 → 清空进 review',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      const pDone = (id, deps) =>
        '<task id="' + id + '" status="done" parallel="true"><action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files><verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
        (deps ? '<depends_on>' + deps + '</depends_on>' : '') + '</task>\n';
      const t03 = (status) =>
        '<task id="T03"' + (status ? ' status="' + status + '"' : '') + '><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>P01,P02</depends_on></task>\n';
      // ① 第一波 P01 done + 第二波 P02（dep P01）pending eligible + 串行 T03 pending → 二次进入委托
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2_PENDING + t03(''));
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'subagent-execute',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        evidence: {
          open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' },
          execute: { summary: 'serial digested' }, 'subagent-execute': { summary: 'wave1 delegated' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      let res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // ② P02 也 done → 可委托集合为空、串行 T03 pending → 趟间回 execute
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + pDone('P02', 'P01') + t03(''));
      res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // ③ 全部 done + SUMMARY 在场 → 合取完成（无 eligible ∧ 无 serial pending）→ review
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + pDone('P02', 'P01') + t03('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/T03-SUMMARY.md', summaryContent());
      res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'NODE: review');
    },
  },

  // 175: 向后兼容等价断言（AC-3）——旧合法形态在新引擎下路由结果与旧期望一致（零行为漂移）：
  // 全串行 → execute；并→串首趟 → subagent-execute；并→串委托完成后（无新 eligible）→ execute；
  // 串→并首趟 → execute（先串行）。旧合法序列退化为单趟，行为不变。
  {
    name: '175 向后兼容等价：旧合法形态路由结果与旧期望一致',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      const goNext = (taskContent, currentNode, completedExtra = [], withExecuteEvidence = false) => {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + taskContent);
        writeState(dir, {
          activeChange: CHANGE_ID,
          currentNode,
          completedNodes: ['open', 'design', 'plan', ...completedExtra],
          evidence: {
            open: { summary: 'o' },
            design: { summary: 'd' },
            plan: { summary: 'p' },
            // withExecuteEvidence：模拟首趟串行消化已 record 过 execute（证据跨重入累积——
            // 真实链路 evidence 不清零；无标记 = 尚未进入过 execute 的干净态）
            ...(withExecuteEvidence ? { execute: { summary: 'serial pass recorded' } } : {}),
            ...(completedExtra.includes('subagent-execute') ? { 'subagent-execute': { summary: 'delegated' } } : {}),
          },
          verifyFailures: 0,
          executionMode: 'subagent',
          directOverride: false,
        });
        return runState(['next'], dir, env);
      };
      // ① 全串行（含依赖链）→ execute
      let res = goNext(TASK_VALID_ALL_SERIAL, 'execute');
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // ② 并→串（并存前+串在后）首趟 → subagent-execute（与旧引擎第一趟一致）
      res = goNext(TASK_VALID_PS, 'execute');
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // ③ 并→串委托完成后（并行全 done、无新 eligible）→ execute 消化串行（与旧引擎一致；
      // execute 已 record 过——证据累积，严格顺序校验放行）
      res = goNext(
        '<task id="P01" status="done" parallel="true"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
        '<task id="P02" status="done" parallel="true"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n' +
        '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify><depends_on>P01,P02</depends_on></task>\n',
        'execute', ['subagent-execute'], true);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // ④ 串→并（串在前+并在后）首趟 → execute 先串行（与旧引擎一致）
      res = goNext(TASK_VALID_SP, 'execute');
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
    },
  },

  // 176: 伪并行检测（多趟混排合法化后的语义盲区兜底）——并行任务 write_files 仅声明测试产物
  // 而无任何生产代码文件时，plan 出口输出 WARN（列任务 id 并给出 depends_on/垂直切片建议）
  // 且不阻断——渐进提示语义本身即断言点；write_files 混有生产文件的并行任务不触发。
  {
    name: '176 伪并行 WARN：仅写测试产物的并行任务提示依赖嫌疑且不阻断',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'plan',
        completedNodes: ['open', 'design'],
        evidence: { open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      // 正例：纯测试面并行任务 → WARN 列 id 并建议 depends_on；plan 出口仍通过
      let res = runPlanExit(dir,
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>tests/test_p1.mjs</write_files><verify>node --check tests/test_p1.mjs</verify></task>\n');
      assertExit(res, 0);
      assertOut(res, 'WARN: 伪并行检测');
      assertOut(res, 'P01');
      assertOut(res, 'depends_on');
      // 新形态 a：test 后缀文件（src/helper.test.mjs）——应 WARN
      res = runPlanExit(dir,
        '<task id="P01b" parallel="true" status="pending"><action>实现 P01b</action><write_files>src/helper.test.mjs</write_files><verify>node --check src/helper.test.mjs</verify></task>\n');
      assertExit(res, 0);
      assertOut(res, 'WARN: 伪并行检测');
      assertOut(res, 'P01b');
      // 新形态 b：__tests__/ 目录（__tests__/helper.test.ts）——应 WARN
      res = runPlanExit(dir,
        '<task id="P01c" parallel="true" status="pending"><action>实现 P01c</action><write_files>__tests__/helper.test.ts</write_files><verify>node --check __tests__/helper.test.ts</verify></task>\n');
      assertExit(res, 0);
      assertOut(res, 'WARN: 伪并行检测');
      assertOut(res, 'P01c');
      // 新形态 c：Windows 反斜杠分隔（tests\foo.test.mjs）——应 WARN
      res = runPlanExit(dir,
        '<task id="P01d" parallel="true" status="pending"><action>实现 P01d</action><write_files>tests\\foo.test.mjs</write_files><verify>node --check tests\\foo.test.mjs</verify></task>\n');
      assertExit(res, 0);
      assertOut(res, 'WARN: 伪并行检测');
      assertOut(res, 'P01d');
      // 新形态 d：多行注释块包裹（整块剥除后再解析，注释内容不得当生产文件）——仍 WARN
      res = runPlanExit(dir,
        '<task id="P01e" parallel="true" status="pending"><action>实现 P01e</action><write_files><!-- 规划备注\nsrc/fake.mjs\n-->tests/real.test.mjs</write_files><verify>node --check tests/real.test.mjs</verify></task>\n');
      assertExit(res, 0);
      assertOut(res, 'WARN: 伪并行检测');
      assertOut(res, 'P01e');
      // 反例：write_files 混有生产文件 → 不触发
      res = runPlanExit(dir,
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs\ntests/test_p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n');
      assertExit(res, 0);
      assertNotOut(res, '伪并行检测');
    },
  },

  // 177: hook 项目根判定兜底链（级3 实测暴露的 H5 残留缺口收口）——会话 cwd 漂移后：
  // ① 有 CLAUDE_PROJECT_DIR（CC hook env 注入）→ 越界写 BLOCKED / .specs 写放行；
  // ② 无任何 env → 自 cwd 向上锚定最近含 .flow-comet/flow-comet-state.json 的祖先，同样正确判定。
  // 修复前两种漂移形态下协议读取失败 → exit 1 报错式放行（越界写有痕放过）。
  {
    name: '177 hook 根判定兜底：cwd 漂移经变量/祖先锚定后正确拦截（H5 收口）',
    run: (dir) => {
      // running 态（review 节点白名单 .specs/）
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        status: 'running',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        evidence: {}, verifyFailures: 0, executionMode: 'subagent', directOverride: false,
      });
      fs.mkdirSync(path.join(dir, 'deep'), { recursive: true });
      const spawnDrift = (input, extraEnv) => {
        // 封闭性：剥离宿主可能注入的锚定变量，确保用例只测显式给定的锚定形态
        const inherited = { ...process.env };
        delete inherited.FLOW_COMET_RUN_ROOT;
        delete inherited.CLAUDE_PROJECT_DIR;
        const res = spawnSync(process.execPath, [HOOK, 'before_tool'], {
          cwd: path.join(dir, 'deep'),
          input: JSON.stringify(input),
          env: {
            ...inherited,
            FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json'),
            ...extraEnv,
          },
          encoding: 'utf8', timeout: 60000,
        });
        return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
      };
      const evil = path.join(dir, 'evil', 'x.txt').split(path.sep).join('/');
      const inspec = path.join(dir, '.specs', 'ok.txt').split(path.sep).join('/');
      // ① CLAUDE_PROJECT_DIR 锚定
      let r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: evil } }, { CLAUDE_PROJECT_DIR: dir });
      assertExit(r, 2);
      assertOut(r, 'BLOCKED');
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: inspec } }, { CLAUDE_PROJECT_DIR: dir });
      assertExit(r, 0);
      assertOut(r, 'workflow-hook-guard-ok');
      // ② 无 env → 祖先锚定（dir 含 .flow-comet/flow-comet-state.json）
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: evil } }, {});
      assertExit(r, 2);
      assertOut(r, 'BLOCKED');
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: inspec } }, {});
      assertExit(r, 0);
      assertOut(r, 'workflow-hook-guard-ok');
      // ③ 相对 file_path 按锚定根解析（修复点：曾按漂移 cwd 解析，好写被误拦）
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: '.specs/ok.txt' } }, { CLAUDE_PROJECT_DIR: dir });
      assertExit(r, 0);
      assertOut(r, 'workflow-hook-guard-ok');
      // ④ 相对路径在项目内但白名单外 → 拦截
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: 'evil-rel/x.txt' } }, { CLAUDE_PROJECT_DIR: dir });
      assertExit(r, 2);
      assertOut(r, 'BLOCKED');
      // ⑤ 陈旧 CLAUDE_PROJECT_DIR（不存在的路径）→ 不采纳，落入祖先锚定仍正确判定
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: evil } }, { CLAUDE_PROJECT_DIR: path.join(dir, 'gone') });
      assertExit(r, 2);
      assertOut(r, 'BLOCKED');
      r = spawnDrift({ tool_name: 'Write', tool_input: { file_path: inspec } }, { CLAUDE_PROJECT_DIR: path.join(dir, 'gone') });
      assertExit(r, 0);
      assertOut(r, 'workflow-hook-guard-ok');
    },
  },

  // ---------- 场景族（多趟出口与解析硬化 · AC-1~AC-7）：期望先行 TDD——部分场景对未修复引擎
  // RED 属预期中间态（GREEN 随引擎修复落地后于收口前全量确认）；BLOCKED 文案断言与设计决策
  // 的提示句逐字对齐；既有场景不受本族影响（编号连续接续）。

  // 178: S 开局混排拓扑 execute 首趟出口放行——T01[S] 已委托交付标 done、T02/T03[P] dep T01
  // pending（待下一趟委托）、T04[S] dep T02,T03 pending（依赖未满足）。串行 pending 判定收窄为
  // 「可运行串行」后，依赖未满足的中段串行 = 等后续波次的合法中间态 → 放行，多趟路由零干预续驱；
  // 未修复引擎按「全部 pending 串行」无条件拦截 → 对未修复引擎 RED。
  {
    name: '178 execute 出口放行：S 开局混排拓扑中段串行依赖未满足不再拦',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" parallel="false" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
        '<task id="T02" parallel="true" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T03" parallel="true" status="pending"><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T04" parallel="false" status="pending"><action>实现 T04</action><write_files>src/t4.mjs</write_files><verify>node --check src/t4.mjs</verify><depends_on>T02,T03</depends_on></task>\n' +
        '<task id="T05" parallel="false"><action>遗留无状态串行</action><write_files>src/t5.mjs</write_files><verify>node --check src/t5.mjs</verify></task>\n');
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertOut(res, 'ALL CHECKS PASSED');
      assertNotOut(res, 'BLOCKED');
    },
  },

  // 179: 可运行串行仍拦（保守边界不松动的负例锚）——同拓扑但 T04 depends_on 为空：
  // 依赖已满足、既未委托也未标 done 的串行 pending = 规划错误信号 → BLOCKED 且消息指明该任务 id。
  // 拦截语义与 id 明细既有引擎已具备 → 即刻绿锚，钉住判定收窄不弱化此向。
  {
    name: '179 execute 出口仍拦：可运行串行 pending BLOCKED 且消息含任务 id',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" parallel="false" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
        '<task id="T02" parallel="true" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T03" parallel="true" status="pending"><action>实现 T03</action><write_files>src/t3.mjs</write_files><verify>node --check src/t3.mjs</verify><depends_on>T01</depends_on></task>\n' +
        '<task id="T04" parallel="false" status="pending"><action>实现 T04</action><write_files>src/t4.mjs</write_files><verify>node --check src/t4.mjs</verify></task>\n');
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '串行 pending');
      assertOut(res, 'T04');
    },
  },

  // 180: 委托边界单行分号 write_files 自动解析正例——request 不带 --write-files 走 TASK.md
  // 自动解析，`a; b` 单行分号形态须切分为两条路径（与换行形态等价）；随后 result 回传恰好触碰
  // 这两个文件的提交，提交文件子集校验通过、不出现「超出 writeFiles 范围」误拦。
  {
    name: '180 handoff 分号单行 write_files 自动解析等价换行且 result 子集校验通过',
    run: (dir) => {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      writeFile(dir, 'src/todo_x.py', '# impl\n');
      writeFile(dir, 'tests/test_todo_x.py', '# test\n');
      // 只加任务切片文件——运行器预置的 reference/ 协议副本不属于本任务提交面
      git('add', 'src/todo_x.py');
      git('add', 'tests/test_todo_x.py');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'vertical slice');
      const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01"><action>实现 T01</action><write_files>src/todo_x.py; tests/test_todo_x.py</write_files><verify>node --check src/todo_x.py</verify></task>\n');
      const st = baseState('subagent-execute');
      st.newChange = true;
      writeState(dir, st);
      // 技能加载前置门材料：新 change 下 request 须有本节点声明标记
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/subagent-execute-flow-comet-dev.json',
        JSON.stringify({ node: 'subagent-execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resReq = runHandoff(['request', 'T01', 'delegate todo slice'], dir);
      assertExit(resReq, 0);
      assertOut(resReq, 'HANDOFF REQUEST: T01');
      // 自动解析结果与换行形态等价：单行分号切分为两条独立路径入库
      const stAfter = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const parsedFiles = stAfter.evidence['subagent-execute'].handoffRequests.T01.writeFiles;
      if (!Array.isArray(parsedFiles) || parsedFiles.length !== 2
        || !parsedFiles.includes('src/todo_x.py') || !parsedFiles.includes('tests/test_todo_x.py')) {
        throw new Error('request 自动解析未把单行分号 write_files 切分为两条路径: ' + JSON.stringify(parsedFiles));
      }
      const payload = JSON.stringify({
        status: 'DONE', taskId: 'T01', commitHash: hash,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        greenEvidence: { command: 'node --check src/todo_x.py', output: 'ok' },
        redEvidence: { command: 'node --check tests/test_todo_x.py', output: 'ok' },
      });
      const resResult = runHandoff(['result', 'T01', payload], dir);
      assertExit(resResult, 0);
      assertOut(resResult, 'HANDOFF RESULT: T01');
      assertNotOut(resResult, '超出 writeFiles 范围');
    },
  },

  // 181: 伪并行启发式分号容错（一景双断言）——① 并行任务 write_files 为单行分号垂直切片
  // （生产文件; 测试文件）：未修复引擎按整行匹配测试路径模式 → 误报 WARN（RED 取证点）；
  // 修复补分号二次切分后识别出生产文件 → 不误报。② 纯测试文件并行任务（换行形态）仍输出
  // WARN 且不阻断（真报保持）。WARN 明细行以「无生产代码文件: <任务id>」前缀区分两任务归属。
  {
    name: '181 伪并行检测分号容错：单行垂直切片不误报且纯测试并行任务仍告警',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'plan',
        completedNodes: ['open', 'design'],
        evidence: { open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      const res = runPlanExit(dir,
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>todo_x.py; tests/test_todo_x.py</write_files><verify>node --check todo_x.py</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>tests/test_p2.mjs\ntests/test_p2_helper.mjs</write_files><verify>node --check tests/test_p2.mjs</verify></task>\n');
      assertExit(res, 0); // WARN 渐进不阻断
      assertOut(res, 'WARN: 伪并行检测'); // ② 纯测试并行任务真报保持
      assertOut(res, '无生产代码文件: P02');
      assertNotOut(res, '无生产代码文件: P01'); // ① 分号垂直切片不误报
    },
  },

  // 182: 收尾态 ROUTE WARN 静默——TASK 全部任务 done 后，「未找到可委托并行块」诊断失去
  // 信息量（噪音只在收尾态出现）；增加存在 pending 任务前置条件后静默。未修复引擎无条件
  // 输出 → 对未修复引擎 RED。
  {
    name: '182 execute 出口静默：全部任务 done 后无 ROUTE WARN',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      // 未分类并行任务（缺 status）自初始 TASK 在场——全部可解析任务 done 后，
      // 该任务按「缺 status 不视为 pending」文档语义保持静默（与既有「无可解析 pending 静默」
      // 案例锚同源），不误报路由警告。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2 +
        '<task id="P03" parallel="true"><action>实现 P03</action><write_files>src/p3.mjs</write_files><verify>node --check src/p3.mjs</verify></task>\n');
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/P02-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01', 'P02']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'ROUTE WARN');
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 183: 死结类 BLOCKED 补 advance 边界提示——可运行串行拦截分支的 BLOCKED 消息含逐字句
  // 「无可执行的常规恢复动作时，可用 workflow-state.mjs advance 渡过结构性死结」（仅死结分支
  // 提示，常规缺产物/缺证据情形不适用）。文案由引擎侧任务落地——未修复消息无该句 → RED。
  {
    name: '183 死结 BLOCKED 消息含 advance 边界提示逐字句',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: 'executed' };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 +
        '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify><depends_on>P01</depends_on></task>\n');
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      st2.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) };
      writeState(dir, st2);
      const res = runGuard(['exit', 'execute'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, '无可执行的常规恢复动作时，可用 workflow-state.mjs advance 渡过结构性死结');
    },
  },

  // 184: 技能文本混排合法化语义文本锁——plan 与 subagent-execute 两 SKILL 权威源不得再含
  // 「连续块」「居首」旧波次形态约束表述，且依赖图语义描述（depends_on）在场、「用 Skill 工具」
  // 两层加载句式保持（措辞锁族既有锚不破坏）。文本存在级断言（结构级由其余场景族覆盖）。
  {
    name: '184 技能文本锁：旧连续块/居首表述清零且依赖图语义描述在场',
    run: () => {
      const problems = [];
      for (const skillDir of ['flow-comet-plan', 'flow-comet-subagent-execute']) {
        const text = fs.readFileSync(path.join(__dirname, '..', '..', skillDir, 'SKILL.md'), 'utf8');
        if (text.includes('连续块')) problems.push(skillDir + ' 含「连续块」旧形态约束表述');
        if (text.includes('居首')) problems.push(skillDir + ' 含「居首」旧位置约束表述');
        if (!text.includes('depends_on')) problems.push(skillDir + ' 缺依赖图语义描述（depends_on）');
        if (!text.includes('用 Skill 工具')) problems.push(skillDir + ' 缺「用 Skill 工具」两层加载句式');
      }
      if (problems.length > 0) throw new Error('技能文本混排合法化语义不符: ' + problems.join('; '));
    },
  },

  // ---------- 场景（installer 新链路——flow-kit 获取五态 / bridge-check 六态 / 他方保持 / 强制回退） ----------

  // 185: flow-kit 新装——目标缺失 → clone + detached checkout 到锁定 commit。
  // 克隆源：仓库内 vendored 上游副本在场时经 git 标准 insteadOf 机制本地克隆（HEAD 即锁定点，
  // 离线可复现）；副本缺席（如 CI 全新检出）时真实 clone 上游——与 CI installer 链路同前提。
  {
    name: '185 flow-kit 新装：clone 后 detached checkout 锁定点',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const localUpstream = path.join(REPO_ROOT, 'flow-kit');
      const env = {};
      if (fs.existsSync(path.join(localUpstream, '.git'))) {
        env.GIT_CONFIG_COUNT = '1';
        env.GIT_CONFIG_KEY_0 = 'url.' + localUpstream.replace(/\\/g, '/') + '.insteadOf';
        env.GIT_CONFIG_VALUE_0 = 'https://github.com/rihebty/flow-kit.git';
      }
      const res = runPrepareEnv(['--target', proj, '--platform', 'dsh'], dir, { DSH_HOME: path.join(dir, 'dshhome'), ...env });
      assertExit(res, 0);
      assertOut(res, '[flow-comet] 已获取 flow-kit（锁定 9b5dda7）');
      const fk = path.join(proj, 'flow-kit');
      const head = execFileSync('git', ['-C', fk, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 60000 }).trim();
      if (head !== '9b5dda7206ae841230f118348d660ad8d0ae2830') throw new Error('flow-kit HEAD 非锁定点: ' + head);
      let symref = '';
      try {
        symref = execFileSync('git', ['-C', fk, 'symbolic-ref', '-q', 'HEAD'], { encoding: 'utf8', timeout: 60000 }).trim();
      } catch { /* detached 状态：symbolic-ref 非零，保持空 */ }
      if (symref !== '') throw new Error('flow-kit HEAD 未处于 detached: ' + symref);
    },
  },

  // 186: flow-kit 已存在且 origin 匹配上游 → 只读报告 HEAD 与锁定点差异影响，绝不改动。
  // 夹具 = 本地真实 git 仓库 + origin 指向真实上游 URL（归属判定走本地 config，零网络），
  // HEAD 落在非锁定点提交上 → 断言差异影响输出且安装器不改动用户克隆（非破坏语义）。
  {
    name: '186 flow-kit 已存在：只读报告差异且不动用户克隆',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const fk = path.join(proj, 'flow-kit');
      fs.mkdirSync(fk, { recursive: true });
      execFileSync('git', ['-C', fk, 'init', '-q'], { encoding: 'utf8', timeout: 60000 });
      fs.writeFileSync(path.join(fk, 'fixture.txt'), 'mine\n', 'utf8');
      execFileSync('git', ['-C', fk, 'add', 'fixture.txt'], { encoding: 'utf8', timeout: 60000 });
      execFileSync('git', ['-C', fk, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', '-m', 'fixture'], { encoding: 'utf8', timeout: 60000 });
      execFileSync('git', ['-C', fk, 'remote', 'add', 'origin', 'https://github.com/rihebty/flow-kit.git'], { encoding: 'utf8', timeout: 60000 });
      const headBefore = execFileSync('git', ['-C', fk, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 60000 }).trim();
      const res = runPrepareEnv(['--target', proj, '--platform', 'dsh'], dir, { DSH_HOME: path.join(dir, 'dshhome') });
      assertExit(res, 0);
      assertOut(res, '已有 flow-kit（HEAD=' + headBefore.slice(0, 7) + '，推荐锁定点=9b5dda7）');
      assertOut(res, '差异影响');
      const headAfter = execFileSync('git', ['-C', fk, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 60000 }).trim();
      if (headAfter !== headBefore) throw new Error('安装器改动了用户克隆 HEAD: ' + headAfter);
      if (!fs.existsSync(path.join(fk, 'fixture.txt'))) throw new Error('安装器删除了用户文件');
    },
  },

  // 187: flow-kit 同名非上游目录 → 跳过 + 手动指引，绝不改动、绝不注入 .git（归属判定读本地
  // config 零网络；无 .git → 保守落入非上游分支）。
  {
    name: '187 flow-kit 同名非上游目录：跳过并指引且不触碰用户目录',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const fk = path.join(proj, 'flow-kit');
      fs.mkdirSync(fk, { recursive: true });
      fs.writeFileSync(path.join(fk, 'user-asset.txt'), 'do not touch\n', 'utf8');
      const res = runPrepareEnv(['--target', proj, '--platform', 'dsh'], dir, { DSH_HOME: path.join(dir, 'dshhome') });
      assertExit(res, 0);
      assertOut(res, '目录存在但非上游克隆，已跳过');
      assertOut(res, '手动获取指引');
      assertOut(res, 'git clone https://github.com/rihebty/flow-kit.git');
      if (fs.readFileSync(path.join(fk, 'user-asset.txt'), 'utf8') !== 'do not touch\n') throw new Error('用户资产被改动');
      if (fs.existsSync(path.join(fk, '.git'))) throw new Error('安装器向用户目录注入了 .git');
    },
  },

  // 188: flow-kit clone/checkout 失败（git 官方配置注入机制让 clone 走不可达代理）→
  // WARN + 手动指引，不抛错不阻断，其余安装职责照常、exit 0（网络失败兜底）。
  {
    name: '188 flow-kit 网络失败：WARN 继续且其余安装职责照常 exit 0',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const res = runPrepareEnv(['--target', proj, '--platform', 'dsh'], dir, {
        DSH_HOME: path.join(dir, 'dshhome'),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.proxy',
        GIT_CONFIG_VALUE_0: 'http://127.0.0.1:9',
      });
      assertExit(res, 0);
      assertOut(res, '[flow-comet] 警告: flow-kit 自动获取失败');
      assertOut(res, '手动获取指引');
      assertOut(res, '已准备环境');
      if (!fs.existsSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('安装器其余职责未继续');
      if (fs.existsSync(path.join(proj, 'flow-kit'))) throw new Error('失败后不应残留半成品 flow-kit 目录');
    },
  },

  // 189: --purge --yes 后 flow-kit 原样存在（清理域语义：purge 清单永不包含 flow-kit—
  // 删除清单段逐字断言无 flow-kit 字样，目录与内容保持）。
  {
    name: '189 flow-kit 不属清理域：purge 后原样存在且删除清单无 flow-kit',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const fk = path.join(proj, 'flow-kit');
      fs.mkdirSync(fk, { recursive: true });
      fs.writeFileSync(path.join(fk, 'sentinel.txt'), 'keep me\n', 'utf8');
      const res = runPrepareEnv(['--target', proj, '--platform', 'dsh', '--purge', '--yes'], dir, { DSH_HOME: path.join(dir, 'dshhome') });
      assertExit(res, 0);
      assertOut(res, '警告: --purge 将删除');
      const segStart = res.output.indexOf('警告: --purge 将删除');
      const segEnd = res.output.indexOf('已删除，开始重新生成。');
      if (segStart < 0 || segEnd < 0 || segEnd < segStart) throw new Error('purge 删除清单段未找到');
      const purgeList = res.output.slice(segStart, segEnd);
      if (purgeList.includes('flow-kit')) throw new Error('purge 删除清单包含 flow-kit: ' + purgeList);
      if (!fs.existsSync(path.join(fk, 'sentinel.txt'))) throw new Error('purge 后 flow-kit 目录丢失');
      if (fs.readFileSync(path.join(fk, 'sentinel.txt'), 'utf8') !== 'keep me\n') throw new Error('purge 后 flow-kit 内容被改动');
      if (!fs.existsSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('purge 重建未完成');
    },
  },

  // 190: bridge-check 健康——全检查通过 exit 0。夹具按安装器实际写入形态构造
  // （insert 条目 + file:// 引用 + BRIDGE_VERSION 戳 = 权威源 INSTALLED_VERSION 同值）。
  {
    name: '190 bridge-check 健康：全检查通过 exit 0',
    run: (dir) => {
      const { dshHome } = writeBridgeFixture(dir);
      const res = runBridgeCheck(dir, dshHome);
      assertExit(res, 0);
      assertOut(res, '[OK] loader 文件存在');
      assertOut(res, '[OK] cordis.patch.yml 托管块');
      assertOut(res, '[OK] 块内 file:// 目标可达');
      assertOut(res, '[OK] 重复注册检查');
      assertOut(res, '[OK] 版本一致性');
      assertOut(res, 'bridge-check: 健康（全部检查通过）——exit 0');
    },
  },

  // 191: bridge-check 文件缺失——loader 缺失时存在性检查与 file:// 目标可达性双 FAIL exit 1。
  {
    name: '191 bridge-check 文件缺失：loader 与 file:// 目标双 FAIL exit 1',
    run: (dir) => {
      const { dshHome } = writeBridgeFixture(dir, { skipLoader: true });
      const res = runBridgeCheck(dir, dshHome);
      assertExit(res, 1);
      assertOut(res, '[FAIL] loader 文件缺失');
      assertOut(res, '[FAIL] 托管块指向的 loader 文件缺失');
      assertOut(res, 'bridge-check: 失配 2 项——exit 1');
    },
  },

  // 192: bridge-check 未挂载——loader 存在但托管块缺失 FAIL exit 1（不会监听任何项目）。
  {
    name: '192 bridge-check 未挂载：托管块缺失 FAIL exit 1',
    run: (dir) => {
      const { dshHome } = writeBridgeFixture(dir, {
        patchContent: "- id: other-plugin\n  name: 'file:///C:/plugins/other-plugin.mjs'\n",
      });
      const res = runBridgeCheck(dir, dshHome);
      assertExit(res, 1);
      assertOut(res, '[FAIL] 未挂载');
      assertOut(res, 'bridge-check: 失配 1 项——exit 1');
    },
  },

  // 193: bridge-check 版本比较语义——dev 态后缀归一后按基础版本比较。子锚：
  //   ① 载体原始戳（权威源=发布标记 / 安装副本=dev 戳）vs 不可识别戳 → 原始戳配对 +
  //      归一基础版本双打印，FAIL exit 1（保留 raw-stamp pairing）；
  //   ② release 态严格相等（两原始值逐字相同）→ 既有 `==` 报告健康 exit 0（release 语义不变）；
  //   ③ dev 态安装副本形态（INSTALLED_VERSION=<发布>-<N>-g<hash>）vs 同基础 loader → 归一后健康 exit 0；
  //   ④ 两侧均带 dev 后缀且基础版本一致 → 归一后健康 exit 0；
  //   ⑤ 基础版本不同（两侧均可带 dev 后缀）→ 归一后仍 FAIL exit 1（双值双打印）；
  //   ⑥ 语义化预发布标识（-rc.N）不属 dev 态后缀、不得剥离 → 仍 FAIL exit 1；
  //   ⑦ release 对 release 失配 → 归一不误判健康，仍 FAIL exit 1。
  // 期望值从载体自身 INSTALLED_VERSION 归一出的基础版本派生——权威源（发布标记）与安装副本
  // （git describe dev 戳）两载体形态均可移植；不得再以原始戳冒充归一后的期望值。
  {
    name: '193 bridge-check 版本比较：dev 态同基础健康 / 基础失配与预发布仍 FAIL exit 1',
    run: (dir) => {
      const { dshHome, installedVersion } = writeBridgeFixture(dir, { loaderStamp: '9.9.9-fixture-skew' });
      const baseVersion = fixtureBridgeBaseVersion(installedVersion);
      const skew = runBridgeCheck(dir, dshHome);
      assertExit(skew, 1);
      assertOut(skew, '[FAIL] 版本偏斜: loader BRIDGE_VERSION=9.9.9-fixture-skew != 项目 INSTALLED_VERSION=' + installedVersion + '（归一基础版本: loader=9.9.9-fixture-skew / installed=' + baseVersion + '）——两值如上');
      assertOut(skew, 'bridge-check: 失配 1 项——exit 1');

      // ②~⑦ 安装副本子锚表：执行器逐个跑真实 CLI；期望值均由 baseVersion / devVersion 派生。
      const devVersion = fixtureIsBridgeDevVersion(installedVersion)
        ? installedVersion
        : baseVersion + '-11-g93d96c0';
      for (const subAnchor of bridgeCopyVersionSubAnchorCases(baseVersion, devVersion)) {
        assertInstalledCopyBridgeVersionCase(dir, subAnchor);
      }
    },
  },

  // 194: bridge-check 重复注册——托管块之外另有同 id 注册行 FAIL exit 1（块内安装器固有
  // 条目不计）。outsideBlock 追加在块后——块外扫描精确捕获。
  {
    name: '194 bridge-check 重复注册：托管块外同 id 注册行 FAIL exit 1',
    run: (dir) => {
      const { dshHome } = writeBridgeFixture(dir, {
        outsideBlock: "\n- id: dsh-flow-comet-bridge\n  name: 'file:///C:/plugins/dup.mjs'\n",
      });
      const res = runBridgeCheck(dir, dshHome);
      assertExit(res, 1);
      assertOut(res, '[FAIL] 重复注册: cordis.patch.yml 托管块外另有 1 处同 id 注册行');
      assertOut(res, 'bridge-check: 失配 1 项——exit 1');
    },
  },

  // 195: bridge-check 不适用——项目根无 .dsh/skills/flow-comet → 不适用 exit 0（AC-11）。
  {
    name: '195 bridge-check 不适用：非 dsh 项目 exit 0',
    run: (dir) => {
      const res = runBridgeCheck(dir, path.join(dir, 'dshhome'));
      assertExit(res, 0);
      assertOut(res, '[NA] bridge-check: 不适用（本项目未安装 dsh 平台副本）');
      assertOut(res, 'bridge-check: 不适用（exit 0）');
    },
  },

  // 196: 他方插件与他方注册行在安装与清理两个相中原样保持——$DSH_HOME/plugins/ 下非
  // flow-comet 插件文件与 cordis.patch.yml 托管块外他方注册行均不得被安装/清理触碰
  // （读-合并-写 + 只清托管块的非破坏语义；清理 = 删生成物后重建，托管块重新注入属预期，
  // 他方注册行逐字保持）。
  {
    name: '196 dsh 他方插件与他方注册行在安装与清理双相中原样保持',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const dshHome = path.join(dir, 'dshhome');
      const otherLoader = '// other plugin fixture\nexport const name = \'other-plugin\';\n';
      const otherPatch = "- id: other-plugin\n  name: 'file:///C:/plugins/other-plugin.mjs'\n";
      writeFile(dshHome, 'plugins/other-plugin.mjs', otherLoader);
      writeFile(dshHome, 'cordis.patch.yml', otherPatch);
      const otherBefore = fs.readFileSync(path.join(dshHome, 'plugins', 'other-plugin.mjs'), 'utf8');
      const patchBefore = fs.readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8');
      // 相 1 安装：loader 复制 + 托管块注入，他方内容保持
      const r1 = runPrepareEnv(['--target', proj, '--platform', 'dsh'], dir, { DSH_HOME: dshHome });
      assertExit(r1, 0);
      assertOut(r1, '桥接 loader 首次安装');
      assertOut(r1, '托管块注入完成');
      if (fs.readFileSync(path.join(dshHome, 'plugins', 'other-plugin.mjs'), 'utf8') !== otherBefore) throw new Error('安装相后他方插件被改动');
      const patchAfterInstall = fs.readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8');
      if (!patchAfterInstall.includes('- id: other-plugin') || !patchAfterInstall.includes("name: 'file:///C:/plugins/other-plugin.mjs'")) {
        throw new Error('安装相后他方注册行丢失: ' + patchAfterInstall);
      }
      if (!patchAfterInstall.includes('# --- flow-comet managed ---')) throw new Error('安装相后托管块未注入');
      // 相 2 清理重装：purge 只清托管块与 loader 后重建（生成物域），他方内容保持
      const r2 = runPrepareEnv(['--target', proj, '--platform', 'dsh', '--purge', '--yes'], dir, { DSH_HOME: dshHome });
      assertExit(r2, 0);
      if (fs.readFileSync(path.join(dshHome, 'plugins', 'other-plugin.mjs'), 'utf8') !== otherBefore) throw new Error('清理相后他方插件被改动');
      const patchAfterPurge = fs.readFileSync(path.join(dshHome, 'cordis.patch.yml'), 'utf8');
      // purge = 删生成物后重建：托管块重新注入属预期；他方注册行必须逐字保持（含换行边界）
      if (!patchAfterPurge.startsWith(patchBefore.trim() + '\n\n')) throw new Error('清理相后他方注册行被改动: ' + JSON.stringify(patchAfterPurge));
      if (!patchAfterPurge.includes('# --- flow-comet managed ---')) throw new Error('清理相后托管块未重建注入');
      if (!fs.existsSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('清理相后重建未完成');
    },
  },

  // 197: FORCE_READLINE 强制回退——env 开关置 1 时即便 clack 可加载也直接走 readline
  // 序号/逗号多选（仅测试面的回退测试钩子）。wrapper 注入 TTY 标志 + stdin 输入选择 dsh，
  // 断言 readline 序号提示出现、clack 主路径提示不出现、选择后安装真实生效。
  {
    name: '197 prepare-env 强制回退：FORCE_READLINE 走 readline 序号提示且不走 clack',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      // 非上游 flow-kit 预置——隔离网络，断言聚焦交互分支
      const fk = path.join(proj, 'flow-kit');
      fs.mkdirSync(fk, { recursive: true });
      fs.writeFileSync(path.join(fk, 'sentinel.txt'), 'keep\n', 'utf8');
      const dshHome = path.join(dir, 'dshhome');
      const wrapper = path.join(dir, 'readline-wrapper.mjs');
      fs.writeFileSync(wrapper,
        "import { pathToFileURL } from 'url';\n" +
        "Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });\n" +
        "process.argv = [process.argv[0], process.env.FC_PREPARE_ENV, '--target', process.env.FC_TARGET];\n" +
        "await import(pathToFileURL(process.env.FC_PREPARE_ENV).href);\n", 'utf8');
      const res = spawnSync(process.execPath, [wrapper], {
        cwd: dir,
        input: '3\n', // readline 多选：输入序号 3 = dsh
        env: {
          ...process.env,
          FLOW_COMET_FORCE_READLINE: '1',
          DSH_HOME: dshHome,
          FC_PREPARE_ENV: PREPARE_ENV,
          FC_TARGET: proj,
        },
        encoding: 'utf8',
        timeout: 120000,
      });
      const status = res.status ?? 1;
      const out = String(res.stdout || '') + String(res.stderr || '');
      if (status !== 0) throw new Error('强制回退路径 exit ' + status + '\n' + out);
      if (!out.includes('输入序号或平台名（逗号分隔多选）或回车')) throw new Error('未出现 readline 序号提示:\n' + out);
      if (out.includes('方向键移动、空格勾选')) throw new Error('强制回退仍走了 clack 主路径:\n' + out);
      if (!fs.existsSync(path.join(proj, '.dsh', 'skills', 'flow-comet', 'SKILL.md'))) throw new Error('readline 选择 dsh 后未安装 dsh 平台');
    },
  },

  // 时序收敛回归锚（AC-5 事故回放）：多趟拓扑（并行开路 → 串行衔接 → 并行收尾 → 串行收尾），
  // 逐节点真实走 guard exit --apply 后运行 workflow-state next——断言两者路由结果逐节点一致。
  // 修复前 guard 出口镜像缺「串行 pending → execute」回流（并行收尾完成后直接落到 review，
  // 与权威 next 的 execute 回流偏差）——本场景对未修复引擎为 RED（预期中间态）。
  {
    name: '198 多趟出口路由时序收敛：逐节点 exit --apply 后 next 输出 NODE 与 guard 出口 NODE 一致',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap) => {
        const blk = (id, parallel, deps) =>
          '<task id="' + id + '"' + (parallel ? ' parallel="true"' : '') +
          ' status="' + (statusMap[id] === 'done' ? 'done' : 'pending') + '">' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
          (deps ? '<depends_on>' + deps + '</depends_on>' : '') + '</task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
          blk('P01', true, '') + blk('P02', true, '') +
          blk('S01', false, 'P01,P02') +
          blk('P03', true, 'S01') + blk('P04', true, 'S01') +
          blk('S02', false, 'P03,P04'));
      };
      const readStateObj = () => JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      // appendEvidence 顶层浅合并 + handoffResult 深层合并：多趟委托下 subagent-execute 的
      // handoffResult 是跨趟累积的委托结果库（越俎代庖检测按全部 done 任务查记录）——整体
      // 覆盖会丢失已委托任务记录（与真实链路 handoff 逐趟追加不一致）。其它节点 evidence
      // 为 summary 对象，浅合并语义与整体赋值等价。
      const appendEvidence = (node, evidence) => {
        const o = readStateObj();
        const prev = o.evidence[node] || {};
        const merged = { ...prev, ...evidence };
        if (evidence.handoffResult && typeof evidence.handoffResult === 'object') {
          merged.handoffResult = { ...(prev.handoffResult || {}), ...evidence.handoffResult };
        }
        o.evidence[node] = merged;
        writeState(dir, o);
      };
      const writeSummary = (ids) => { for (const id of ids) writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', summaryContent()); };
      const nodeOf = (out) => (out.match(/^NODE: ([a-z-]+)$/m) || [])[1] ?? null;
      const assertConverge = (guardRes) => {
        assertExit(guardRes, 0);
        const gNode = nodeOf(guardRes.output);
        const nextRes = runState(['next'], dir, env);
        assertExit(nextRes, 0);
        const sNode = nodeOf(nextRes.output);
        if (gNode !== sNode) {
          throw new Error('guard 出口 NODE(' + gNode + ') != next 输出 NODE(' + sNode +
            ')——时序收敛断言失败\nguard 输出:\n' + guardRes.output + '\nnext 输出:\n' + nextRes.output);
        }
      };
      // 预置 open 产物（CHANGE + REQUIREMENT）；design/plan 产物在各自出口前写入（真实链路时序）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## Why（为什么做）\n\nx\n\n## 范围（Scope）\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 用户故事（User Story）\n\nx\n\n## 验收准则（AC）\n\n- Given x When y Then z');
      writeState(dir, baseState('open'));
      assertExit(runGuard(['entry', 'open'], dir), 0);
      // ① open 出口 → design
      appendEvidence('open', { summary: 'intake complete' });
      assertConverge(runGuard(['exit', 'open', '--apply'], dir));
      // ② design 出口 → plan
      assertExit(runGuard(['entry', 'design'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 0. 技术栈选型\n\nNode（纯脚本）\n\n## 决策清单\n\n- [ ] 决策 1');
      appendEvidence('design', { summary: 'design complete' });
      assertConverge(runGuard(['exit', 'design', '--apply'], dir));
      const assertExitRouted = (res, nodeId) => { assertExit(res, 0); if (nodeId) assertOut(res, 'NODE: ' + nodeId); };
      // ③ plan 出口（首波并行可委托）→ subagent-execute（guard 路由跳转；next 侧仅对「直接后继
      // 推进」态可确认输出，委托跳转态不在收敛断言面——收敛锚设在 next 可确认的直接后继/回流态）
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      writeTask({ P01: 'pending', P02: 'pending', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
      appendEvidence('plan', { summary: 'plan complete' });
      assertExitRouted(runGuard(['exit', 'plan', '--apply'], dir), 'subagent-execute');
      // ④ 第一波并行委托完成 → 趟间回串行（guard 路由 execute）
      assertExit(runGuard(['entry', 'subagent-execute'], dir), 0);
      writeTask({ P01: 'done', P02: 'done', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
      writeSummary(['P01', 'P02']);
      // handoff evidence 构造与既有委托出口场景一致合法形态：非空 summary 满足
      // flowkit.handoff.v1 的 schema evidence 前置校验（missingRequiredSchemaEvidence 中
      // summary 视同满足），handoffResult 满足越俎代庖检测的委托结果记录——guard exit 才
      // 能通过证据前置校验并真正断言路由收敛（缺 summary 时前置 BLOCK，属场景构造缺陷）。
      appendEvidence('subagent-execute', { summary: 'wave1 delegated and collected', handoffResult: handoffFor(['P01', 'P02']) });
      assertExitRouted(runGuard(['exit', 'subagent-execute', '--apply'], dir), 'execute');
      // ⑤ 串行衔接完成 → 第二波并行可委托（guard 路由 subagent-execute）
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'pending', P04: 'pending', S02: 'pending' });
      writeSummary(['S01']);
      // 串行衔接任务由 execute 完成，但 subagent 统一委托语义下 execute 出口的越俎代庖检测
      // 要求**所有** done 任务在 subagent-execute 的 handoffResult 有委托记录（真实链路
      // completeTasks 同形态）——追加该任务记录（handoffResult 深层合并保留既有记录）。
      appendEvidence('subagent-execute', { handoffResult: handoffFor(['S01']) });
      appendEvidence('execute', { summary: 'serial wave complete' });
      assertExitRouted(runGuard(['exit', 'execute', '--apply'], dir), 'subagent-execute');
      // ⑥ 第二波并行委托完成 → 收尾串行 pending 应回流 execute（修复核心断言）
      assertExit(runGuard(['entry', 'subagent-execute'], dir), 0);
      writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'pending' });
      writeSummary(['P03', 'P04']);
      // 与 ④ 同形态（既有合法委托出口形态）：非空 summary + handoffResult，guard exit 通过
      // 证据前置校验后才能真正收敛断言（AC-5 时序收敛）。
      appendEvidence('subagent-execute', { summary: 'wave2 delegated and collected', handoffResult: handoffFor(['P03', 'P04']) });
      assertConverge(runGuard(['exit', 'subagent-execute', '--apply'], dir));
      // ⑦ 收尾串行完成 → review
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'done' });
      writeSummary(['S02']);
      // 同 ⑤：收尾串行任务委托记录追加（深层合并后全部 done 任务均在 handoffResult，
      // execute 出口越俎代庖检测通过）。
      appendEvidence('subagent-execute', { handoffResult: handoffFor(['S02']) });
      appendEvidence('execute', { summary: 'final serial complete' });
      assertConverge(runGuard(['exit', 'execute', '--apply'], dir));
      // ⑧ review → verify
      assertExit(runGuard(['entry', 'review'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nreview passed，无遗留问题。\n');
      appendEvidence('review', { summary: 'review complete' });
      assertConverge(runGuard(['exit', 'review', '--apply'], dir));
      // ⑨ verify → archive
      assertExit(runGuard(['entry', 'verify'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```\necho ok\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
      appendEvidence('verify', { summary: 'verify complete' });
      assertConverge(runGuard(['exit', 'verify', '--apply'], dir));
      // ⑩ archive 出口 → 全部完成（两侧均 NEXT: done）
      assertExit(runGuard(['entry', 'archive'], dir), 0);
      writeFile(dir, '.specs/archive/2026-08-28-' + CHANGE_ID + '/KNOWN-ISSUES.md', '# 遗留问题\n\n无。\n');
      appendEvidence('archive', { summary: 'archive complete' });
      const res = runGuard(['exit', 'archive', '--apply'], dir);
      assertExit(res, 0);
      assertOut(res, 'NEXT: done');
      const nextRes = runState(['next'], dir, env);
      assertExit(nextRes, 0);
      assertOut(nextRes, 'NEXT: done');
    },
  },

  // 199: purge 时目标无 flow-kit → 不得获取也不得创建（清理域语义：purge 只清理、不产生
  // 新产物）。注入不可达 http.proxy（与「网络失败 WARN 继续」场景同技法）——若 purge 路径仍调 ensureFlowKit，
  // 会触发 clone 失败 WARN「flow-kit 自动获取失败」→ 断言“该 WARN 不出现 + 已获取不出现 +
  // 无 flow-kit 目录”即对当前实现 RED。
  {
    name: '199 prepare-env purge 不触碰 flow-kit：purge 且无 flow-kit 不获取不创建',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const res = runPrepareEnv(['--target', proj, '--platform', 'dsh', '--purge', '--yes'], dir, {
        DSH_HOME: path.join(dir, 'dshhome'),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.proxy',
        GIT_CONFIG_VALUE_0: 'http://127.0.0.1:9',
      });
      assertExit(res, 0);
      assertNotOut(res, '已获取 flow-kit');
      assertNotOut(res, 'flow-kit 自动获取失败');
      if (fs.existsSync(path.join(proj, 'flow-kit'))) throw new Error('purge 后创建了 flow-kit 目录');
    },
  },

  // 200: 版本戳形态校验——已装 loader 标记行非语义化版本（如 beta，无数字主形）→ 提取失败
  // 警告 + 跳过版本比对 + 照常覆盖；不得作为合法版本进入 compare（畸形值 parseInt 得 NaN，
  // 会产生升/降级方向的错误结论）。覆盖断言从权威源动态提取版本值（单一来源——值随发布
  // 更新时本场景无需同步；断言意图 = 「覆盖后 loader 版本戳 == 权威源文件版本戳」）。
  {
    name: '200 prepare-env 版本戳形态：畸形标记（beta）走提取失败警告而非版本比对',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const dshHome = path.join(dir, 'dshhome');
      writeFile(dshHome, 'plugins/dsh-flow-comet-bridge.mjs',
        '// dsh bridge loader fixture (malformed stamp)\n// BRIDGE_VERSION: beta\n' +
        "export const name = 'dsh-flow-comet-bridge';\nexport const version = '0.0.0-fixture';\n");
      const res = runPrepareEnv(['--target', proj, '--platform', 'dsh'], dir, { DSH_HOME: dshHome });
      assertExit(res, 0);
      assertOut(res, '版本戳提取失败');
      assertNotOut(res, '桥接 loader 升级');
      assertNotOut(res, '桥接 loader 降级');
      const srcText = fs.readFileSync(path.join(path.dirname(PREPARE_ENV), 'dsh-bridge.mjs'), 'utf8');
      const srcStamp = /^\/\/ BRIDGE_VERSION: (\S+)$/m.exec(srcText);
      if (!srcStamp) throw new Error('权威源 loader 未提取到版本戳（场景前置失效）');
      const installed = fs.readFileSync(path.join(dshHome, 'plugins', 'dsh-flow-comet-bridge.mjs'), 'utf8');
      if (!installed.includes('BRIDGE_VERSION: ' + srcStamp[1])) throw new Error('覆盖后 loader 版本戳非权威源值');
      // 子断言（发布同步守卫，以 INSTALLED_VERSION 为权威基准）：权威源 loader 的标记行、
      // 导出常量与 INSTALLED_VERSION 三处同值——任一处漂移时安装副本的 bridge-check 会在已装
      // 项目报版本偏斜（上方断言只证明「覆盖 == 权威源文件」，无法捕获跨文件/跨值分叉）。
      const installedVersion = fs.readFileSync(path.join(__dirname, '..', 'INSTALLED_VERSION'), 'utf8').trim();
      const exportMatch = /^export const version = '([^']+)';$/m.exec(srcText);
      if (!exportMatch) throw new Error('权威源 loader 未提取到 export version（场景前置失效）');
      if (srcStamp[1] !== installedVersion || exportMatch[1] !== installedVersion) {
        throw new Error(
          '权威源版本三处不一致（标记行=' + srcStamp[1] + ' / export=' + exportMatch[1] +
          ' / INSTALLED_VERSION=' + installedVersion + '）——发布同步遗漏（bridge-check 会在安装副本报版本偏斜）'
        );
      }
    },
  },

  // 201: bridge-check 目标一致性——托管块 file:// 指向存在但非期望的 loader 文件
  // （可达性成立、目标错误）：不可报健康（必须 FAIL——解码目标与期望 loaderPath 不符，exit 1）。
  {
    name: '201 bridge-check 可达但目标错误：file:// 指向非期望 loader FAIL exit 1',
    run: (dir) => {
      const wrong = path.join(dir, 'dshhome', 'plugins', 'some-other-loader.mjs');
      fs.mkdirSync(path.dirname(wrong), { recursive: true });
      fs.writeFileSync(wrong, '// some other loader\n', 'utf8');
      const fileUrl = pathToFileURL(wrong).href;
      const { dshHome } = writeBridgeFixture(dir, {
        patchContent:
          '# --- flow-comet managed ---\n- insert:\n    - id: dsh-flow-comet-bridge\n      name: \'' +
          fileUrl.replace(/'/g, "''") + '\'\n# --- end flow-comet managed ---\n',
      });
      const res = runBridgeCheck(dir, dshHome);
      assertExit(res, 1);
      assertOut(res, '[FAIL]');
      assertNotOut(res, '健康（全部检查通过）');
    },
  },

  // 202: 并行文件依赖检测前移（write∩write 强判）——两个同波次 parallel pending 任务
  // write_files 重叠（链式重命名的 .txt 事故面：任务 A 写 bak_a.txt、任务 B 也写 bak_a.txt，
  // 无 depends_on）：新 change 的 plan 出口应 BLOCKED（含任务 id 对、重叠路径、恢复指引
  // 「补显式 depends_on 或拆串行」）。修复前 plan 出口无此检测 = 预期 RED（重叠静默放行）。
  // 引号形态：P02 用单引号属性（XML 合法形态）——属性不解析会让 P02 退化为非并行 → 重叠漏判
  // （本场景退出码/消息断言即 RED），与 TASK_VALID_PS 的路由断言构成两条下游消费路径的覆盖。
  {
    name: '202 plan exit BLOCKED：新 change 写写重叠（链式重命名 .txt 事故面）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const tasks =
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n' +
        "<task id='P02' parallel='true' status='pending'><action>实现 P02</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n";
      const res = runPlanExit(dir, tasks);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'P01×P02');
      assertOut(res, 'bak_a.txt');
      assertOut(res, 'depends_on');
    },
  },

  // 203: 写写强判分级（渐进）——同拓扑旧 change（无 newChange 标记）：plan 出口应 WARN 渐进
  // 不 BLOCK（与依赖环分级同先例）。修复前 plan 出口无检测 = 预期 RED（无 WARN 亦无 BLOCK）。
  {
    name: '203 plan exit 兼容：旧 change 写写重叠不 BLOCK（渐进 WARN）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      writeState(dir, st);
      const tasks =
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n';
      const res = runPlanExit(dir, tasks);
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      assertOut(res, 'WARN');
      assertOut(res, 'P01×P02');
      assertOut(res, 'bak_a.txt');
    },
  },

  // 204: 扩展名白名单闭合——txt/无扩展名写路径重叠同等检出（不再被标准扩展名白名单漏检）。
  // 拓扑：P01 与 P02 重叠于 notes.txt，P03 与 P04 重叠于无扩展名路径 RELEASE。
  {
    name: '204 plan exit BLOCKED：txt/无扩展名写路径重叠检出（扩展名闭合）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const tasks =
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>notes.txt</write_files><verify>node --check notes.txt</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>notes.txt</write_files><verify>node --check notes.txt</verify></task>\n' +
        '<task id="P03" parallel="true" status="pending"><action>实现 P03</action><write_files>RELEASE</write_files><verify>node --check RELEASE</verify></task>\n' +
        '<task id="P04" parallel="true" status="pending"><action>实现 P04</action><write_files>RELEASE</write_files><verify>node --check RELEASE</verify></task>\n';
      const res = runPlanExit(dir, tasks);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'notes.txt');
      assertOut(res, 'RELEASE');
    },
  },

  // 205: read∩write 弱判（渐进提示，触发面=仅无显式 depends_on 关联的并行对）——
  // ① 无关联对：一方 read_files 命中对方 write_files → WARN 提示（新 change 亦不 BLOCK）；
  // ② 有显式关联（依赖已声明）→ 探测跳过 → 零新增告警（既有合法拓扑断言不变）。
  // 修复前无此弱判 = 预期 RED（无 read∩write WARN）。
  {
    name: '205 plan exit 弱判：read∩write 无显式关联对 WARN 不 BLOCK；有显式关联零告警',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      // ① 无显式关联对：P01 读 shared-context.md，P02 写同路径 → WARN 提示级（不 BLOCK）
      const weak =
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><read_files>shared-context.md</read_files><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>shared-context.md</write_files><verify>node --check shared-context.md</verify></task>\n';
      const res = runPlanExit(dir, weak);
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      assertOut(res, 'read∩write');
      assertOut(res, 'P01×P02');
      assertOut(res, 'shared-context.md');
      // ② 有显式关联（P02 depends_on P01 → 跨趟非同波次并行对）→ read∩write 探测跳过 → 零告警
      const associated =
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><read_files>shared-context.md</read_files><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>shared-context.md</write_files><verify>node --check shared-context.md</verify><depends_on>P01</depends_on></task>\n';
      const res2 = runPlanExit(dir, associated);
      assertExit(res2, 0);
      assertNotOut(res2, 'read∩write');
      assertNotOut(res2, 'BLOCKED');
    },
  },

  // 206: 委托前行为保持锚 + 伪并行并存不干扰——① subagent-execute 委托前写写重叠仍 BLOCKED
  // （第二道拦截不变）；② 修复写写重叠后 plan 出口放行，且仅写测试产物的并行任务仍触发伪并行
  // WARN（渐进提示不阻断）——新检测与既有检测并存不干扰。
  {
    name: '206 委托前写写拦截保持锚 + 伪并行并存不干扰',
    run: (dir) => {
      // ① 委托前锚：同波次并行 pending 写写重叠 → entry subagent-execute 仍 BLOCKED
      const st = baseState('subagent-execute');
      st.newChange = true;
      writeState(dir, st);
      const conflictTasksForDelegation =
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>bak_a.txt</write_files><verify>node --check bak_a.txt</verify></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 任务清单\n\n' + conflictTasksForDelegation);
      const resDeleg = runGuard(['entry', 'subagent-execute'], dir);
      assertExit(resDeleg, 1);
      assertOut(resDeleg, 'BLOCKED');
      assertOut(resDeleg, 'write_files 冲突');
      // ② 伪并行并存：修复重叠（各写各的）后 plan 出口放行，且仅写测试产物的并行任务
      // 仍触发伪并行 WARN——新检测与既有检测并存不干扰
      const st2 = baseState('plan');
      st2.evidence.plan = { summary: 'plan done' };
      st2.newChange = true;
      writeState(dir, st2);
      const coexisting =
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>tests/test_p2.mjs</write_files><verify>node --check tests/test_p2.mjs</verify></task>\n';
      const resPlan = runPlanExit(dir, coexisting);
      assertExit(resPlan, 0);
      assertOut(resPlan, 'ALL CHECKS PASSED');
      assertOut(resPlan, '伪并行检测');
      assertNotOut(resPlan, 'BLOCKED');
    },
  },

  // 207: 多趟平行转换门禁共用路由后继——各转换点 exit --apply 后 next 可达且与 guard NEXT
  // 一致（时序锚完整化：既有收敛场景曾把「plan→subagent-execute」「subagent-execute→execute」
  // 两个平行转换点排除在收敛断言面外——next 侧正常推进豁免只认静态直接后继,平行转换被误拦
  // 为「疑似未 exit」;本场景把全转换链纳入收敛断言,覆盖平行跳转与趟间回流）。
  {
    name: '207 多趟平行转换 next 可达且与 guard NEXT 一致（完整时序锚）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const writeTask = (statusMap) => {
        const blk = (id, parallel, deps) =>
          '<task id="' + id + '"' + (parallel ? ' parallel="true"' : '') +
          ' status="' + (statusMap[id] === 'done' ? 'done' : 'pending') + '">' +
          '<action>实现 ' + id + '</action><write_files>src/' + id.toLowerCase() + '.mjs</write_files>' +
          '<verify>node --check src/' + id.toLowerCase() + '.mjs</verify>' +
          (deps ? '<depends_on>' + deps + '</depends_on>' : '') + '</task>\n';
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
          blk('P01', true, '') + blk('P02', true, '') +
          blk('S01', false, 'P01,P02') +
          blk('P03', true, 'S01') + blk('P04', true, 'S01') +
          blk('S02', false, 'P03,P04'));
      };
      const readStateObj = () => JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      const appendEvidence = (node, evidence) => {
        const o = readStateObj();
        const prev = o.evidence[node] || {};
        const merged = { ...prev, ...evidence };
        if (evidence.handoffResult && typeof evidence.handoffResult === 'object') {
          merged.handoffResult = { ...(prev.handoffResult || {}), ...evidence.handoffResult };
        }
        o.evidence[node] = merged;
        writeState(dir, o);
      };
      const writeSummary = (ids) => { for (const id of ids) writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', summaryContent()); };
      const nodeOf = (out) => (out.match(/^NODE: ([a-z-]+)$/m) || [])[1] ?? null;
      const assertConverge = (guardRes) => {
        assertExit(guardRes, 0);
        const gNode = nodeOf(guardRes.output);
        const nextRes = runState(['next'], dir, env);
        assertExit(nextRes, 0);
        const sNode = nodeOf(nextRes.output);
        if (gNode !== sNode) {
          throw new Error('guard 出口 NODE(' + gNode + ') != next 输出 NODE(' + sNode +
            ')——完整时序锚断言失败\nguard 输出:\n' + guardRes.output + '\nnext 输出:\n' + nextRes.output);
        }
      };
      // 前序产物（open/design/plan 产物门控按文件推导——与既有收敛场景同形态；DESIGN/TASK 在
      // 各自节点出口前写入，路由转换按真实时序推进）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## Why（为什么做）\n\nx\n\n## 范围（Scope）\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 用户故事（User Story）\n\nx\n\n## 验收准则（AC）\n\n- Given x When y Then z');
      writeState(dir, baseState('open'));
      // ① open 出口 → design（收敛）
      appendEvidence('open', { summary: 'intake complete' });
      assertExit(runGuard(['entry', 'open'], dir), 0);
      assertConverge(runGuard(['exit', 'open', '--apply'], dir));
      // ② design 出口 → plan（收敛；DESIGN 产物在本节点出口前写入——真实时序）
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 0. 技术栈选型\n\nNode（纯脚本）\n\n## 决策清单\n\n- [ ] 决策 1');
      appendEvidence('design', { summary: 'design complete' });
      assertExit(runGuard(['entry', 'design'], dir), 0);
      assertConverge(runGuard(['exit', 'design', '--apply'], dir));
      // ③ plan 出口 → subagent-execute（平行转换点——修复前 next 误拦「疑似未 exit」）
      writeTask({ P01: 'pending', P02: 'pending', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
      appendEvidence('plan', { summary: 'plan complete' });
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      assertConverge(runGuard(['exit', 'plan', '--apply'], dir));
      // ④ 首波并行委托完成 → 趟间回串行 execute（平行回流点——修复前同样误拦）
      writeTask({ P01: 'done', P02: 'done', S01: 'pending', P03: 'pending', P04: 'pending', S02: 'pending' });
      writeSummary(['P01', 'P02']);
      appendEvidence('subagent-execute', { summary: 'wave 1 delegated and collected', handoffResult: handoffFor(['P01', 'P02']) });
      assertExit(runGuard(['entry', 'subagent-execute'], dir), 0);
      assertConverge(runGuard(['exit', 'subagent-execute', '--apply'], dir));
      // ⑤ 串行衔接完成 → 第二波并行可委托（execute → subagent-execute）
      writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'pending', P04: 'pending', S02: 'pending' });
      writeSummary(['S01']);
      appendEvidence('subagent-execute', { handoffResult: handoffFor(['S01']) });
      appendEvidence('execute', { summary: 'serial wave complete' });
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      assertConverge(runGuard(['exit', 'execute', '--apply'], dir));
      // ⑥ 第二波并行委托完成 → 收尾串行回流 execute（平行回流点）
      writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'pending' });
      writeSummary(['P03', 'P04']);
      appendEvidence('subagent-execute', { summary: 'wave 2 delegated and collected', handoffResult: handoffFor(['P03', 'P04']) });
      assertExit(runGuard(['entry', 'subagent-execute'], dir), 0);
      assertConverge(runGuard(['exit', 'subagent-execute', '--apply'], dir));
      // ⑦ 收尾串行完成 → review
      writeTask({ P01: 'done', P02: 'done', S01: 'done', P03: 'done', P04: 'done', S02: 'done' });
      writeSummary(['S02']);
      appendEvidence('subagent-execute', { handoffResult: handoffFor(['S02']) });
      appendEvidence('execute', { summary: 'final serial wave complete' });
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      assertConverge(runGuard(['exit', 'execute', '--apply'], dir));
      // ⑧ review → verify
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nreview passed。\n');
      appendEvidence('review', { summary: 'review complete' });
      assertExit(runGuard(['entry', 'review'], dir), 0);
      assertConverge(runGuard(['exit', 'review', '--apply'], dir));
      // ⑨ verify → archive
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```\necho ok\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
      appendEvidence('verify', { summary: 'verify complete' });
      assertExit(runGuard(['entry', 'verify'], dir), 0);
      assertConverge(runGuard(['exit', 'verify', '--apply'], dir));
      // ⑩ archive 出口 → 完成（两侧均 NEXT: done）
      writeFile(dir, '.specs/archive/2026-08-28-' + CHANGE_ID + '/KNOWN-ISSUES.md', '# 遗留问题\n\n无。\n');
      appendEvidence('archive', { summary: 'archive complete' });
      assertExit(runGuard(['entry', 'archive'], dir), 0);
      const resArch = runGuard(['exit', 'archive', '--apply'], dir);
      assertExit(resArch, 0);
      assertOut(resArch, 'NEXT: done');
      const nextRes = runState(['next'], dir, env);
      assertExit(nextRes, 0);
      assertOut(nextRes, 'NEXT: done');
    },
  },

  // 208: record 后未 exit 先 next 不提前校正到路由后继（反死结锚——平行转换点：进行中
  // 节点保护此前只认静态直接后继,推导落子在 subagent-execute 时保护失效,currentNode 被
  // 提前校正 → 随后 exit plan 的 currentNode 匹配必 BLOCK → 死结）。
  {
    name: '208 record 后未 exit 先 next 不漂移死结：后续 exit 仍可',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      // 前序产物（open/design 已完成,plan 已进入并 record——未 exit）
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## Why（为什么做）\n\nx\n\n## 范围（Scope）\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md', '# REQUIREMENT\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 用户故事（User Story）\n\nx\n\n## 验收准则（AC）\n\n- Given x When y Then z');
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md', '# DESIGN\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 0. 技术栈选型\n\nNode（纯脚本）\n\n## 决策清单\n\n- [ ] 决策 1');
      // 平行转换前夜：并行任务存在且可委托（无依赖待满足）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/p2.mjs</write_files><verify>node --check src/p2.mjs</verify></task>\n' +
        '<task id="S01" parallel="false" status="pending"><action>实现 S01</action><write_files>src/s1.mjs</write_files><verify>node --check src/s1.mjs</verify><depends_on>P01,P02</depends_on></task>\n');
      const st = baseState('plan');
      st.completedNodes = ['open', 'design'];
      st.enteredNodes = ['open', 'design', 'plan'];
      st.evidence = {
        open: { summary: 'open complete' },
        design: { summary: 'design complete' },
        plan: { summary: 'plan complete' },
      };
      st.newChange = true;
      writeState(dir, st);
      // ① record 后未 exit 先 next：不把 currentNode 提前校正到 subagent-execute（路由后继）
      const r1 = runState(['next'], dir, env);
      assertExit(r1, 0);
      assertOut(r1, 'NODE: plan');
      const stAfterNext = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (stAfterNext.currentNode !== 'plan') {
        throw new Error('record 后未 exit 先 next 不应提前校正 currentNode（应保持 plan），实际: ' + stAfterNext.currentNode);
      }
      // ② 后续 exit plan --apply 仍可（进行中节点保护 → 未漂移 → currentNode 匹配）
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const rExit = runGuard(['exit', 'plan', '--apply'], dir);
      assertExit(rExit, 0);
      assertOut(rExit, 'ALL CHECKS PASSED');
      // ③ exit 推进后 next 路由到 subagent-execute（平行转换点——与 guard 出口一致）
      const r2 = runState(['next'], dir, env);
      assertExit(r2, 0);
      assertOut(r2, 'NODE: subagent-execute');
    },
  },

  // 209: exit 漂移容忍正例——currentNode 已漂移到文件推导下一节点（execute 证据/产物齐→路由已指向
  // review）且本节点证据+产物齐 → 容错 exit execute --apply 可过（补欠账）——BLOCK 不再只有
  // 不可行的 advance/select 指引（M2/L-061 修复锚）。修复前 currentNode 校验必 BLOCK → RED。
  {
    name: '209 exit 漂移容忍：currentNode 已为文件推导下一节点且证据/产物齐 → exit 可过',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      // TASK 全 done（T01 串行）+ SUMMARY（execute 产物门控）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n');
      // 新 change 严格模板保真：SUMMARY 须 `# SUMMARY:` 标题 + 首部 4 字段 + 段序（模板保真场景同款合法形态）
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md',
        ['# SUMMARY: T01 - 实现 T01', '',
          '- **Change ID**: ' + CHANGE_ID, '- **Task ID**: T01', '- **完成时间**: 2026-08-29 10:00', '- **AI 角色**: Dev',
          '', '---', '',
          '## 做了什么\n\n实现 T01（TDD：先写失败场景再实现）。',
          '## 改动文件\n\n| 文件 | 性质 | 说明 |\n|---|---|---|\n| src/t1.mjs | 修改 | 实现 T01 |',
          '## verify 输出\n\n```\nnode --check src/t1.mjs\n```',
          '## 6 维自查\n\n- 功能: 通过（brooks-review 已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
          '## 越界检查\n\n仅修改 src/t1.mjs，无越界。',
          '## 自检方法\n\nbrooks-review', '',
        ].join('\n'));
      // 漂移态：completedNodes=[open,design,plan]（execute 未 completed——欠账），currentNode=review
      // （路由已越过 execute——execute 证据/产物齐）；evidence.execute + enteredNodes 含 execute（防 R2 拦）
      const st = baseState('review');
      st.completedNodes = ['open', 'design', 'plan'];
      st.enteredNodes = ['open', 'design', 'plan', 'execute', 'review'];
      st.evidence = {
        open: { summary: 'open done' },
        design: { summary: 'design done' },
        plan: { summary: 'plan done' },
        execute: { summary: 'executed', parallelTakeoverApproved: true },
      };
      st.newChange = true;
      writeState(dir, st);
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED: currentNode');
      assertOut(res, '容错');
      const stAfter = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!stAfter.completedNodes.includes('execute')) {
        throw new Error('容错 exit execute --apply 后 completedNodes 应含 execute（欠账补齐）;实际: ' + stAfter.completedNodes.join(','));
      }
    },
  },

  // 210: exit 漂移容忍反例——currentNode 已漂移但本节点证据/产物不齐 → 仍 BLOCK（容错不放开未完成）
  {
    name: '210 exit 漂移仍 BLOCK：漂移但证据/产物不齐（容错不放开未完成）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n');
      // 漂移态同 209，但 execute 产物缺失（T01 宣称 done 却无 SUMMARY 文件）——证据虽在，
      // 产物不齐 → 容错判定 tolerable=false → 仍 BLOCK（容错不放开未完成；反过度修复锚）。
      // 注意：证据缺失面由前置证据校验先命中（BLOCKED: missing evidence），本场景故意给证据、
      // 只缺产物——让漂移容错判定真正走到边界，验证「漂移但产物不齐不收容」。
      const st = baseState('review');
      st.completedNodes = ['open', 'design', 'plan'];
      st.enteredNodes = ['open', 'design', 'plan', 'execute', 'review'];
      st.evidence = {
        open: { summary: 'open done' },
        design: { summary: 'design done' },
        plan: { summary: 'plan done' },
        execute: { summary: 'executed' },
      };
      st.newChange = true;
      writeState(dir, st);
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED: currentNode is review');
      assertNotOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 211: 路由诊断静默扩展（M4/R-4·L-061 批次）——剩余 pending 全串行（P→S 收尾转换：并行已全 done、
  // 仅剩串行 pending、无缺 status 畸形块）→ ROUTE WARN 静默（「全 done 静默」锚扩展为
  // 「剩余全串行」也静默——P→S 收尾不再输出噪音；修复前按「无 parallel pending」判定仍报 → RED）
  {
    name: '211 路由诊断静默：剩余 pending 全串行（P→S 收尾转换）无 ROUTE WARN',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      const st = baseState('plan');
      st.completedNodes = ['open', 'design'];
      st.evidence.plan = { summary: 'executed' };
      writeState(dir, st);
      // 并行任务已 done、串行尾任务 pending（全串行剩余、无缺 status 畸形块）→ M4 静默
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P01" parallel="true" status="done">\n  <action>do</action>\n  <verify>echo ok</verify>\n</task>\n' +
        '<task id="S01" parallel="false" status="pending">\n  <action>do serial</action>\n  <verify>echo ok</verify>\n</task>\n');
      const res = runGuard(['exit', 'plan', '--apply'], dir, env);
      assertExit(res, 0);
      assertNotOut(res, 'ROUTE WARN');
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 212: 路由诊断保持（M4 反例）——存在缺 status 的 parallel 块（畸形/旧模板形态）且存在串行
  // pending 时 ROUTE WARN 仍报（结构校验严格保持——缺 status 不视为 pending，不因 M4 误静音；
  // 判定载体：parallel 标记在场对照 + 真畸形块驱动 WARN）
  {
    name: '212 路由诊断保持：parallel 缺 status（畸形块）仍报 ROUTE WARN',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      const st = baseState('plan');
      st.completedNodes = ['open', 'design'];
      st.evidence.plan = { summary: 'executed' };
      writeState(dir, st);
      // 正常并行任务 done + 畸形并行任务（parallel="true" 无 status）+ 串行尾任务 pending → WARN 保持
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P01" parallel="true" status="done">\n  <action>do</action>\n  <verify>echo ok</verify>\n</task>\n' +
        '<task id="P03" parallel="true">\n  <action>do malformed parallel</action>\n  <verify>echo ok</verify>\n</task>\n' +
        '<task id="S02" parallel="false" status="pending">\n  <action>do serial</action>\n  <verify>echo ok</verify>\n</task>\n');
      const res = runGuard(['exit', 'plan', '--apply'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'ROUTE WARN');
    },
  },

  // 213: directOverride 授权约束正例——协调者显式授权留痕在场（executionMode=direct +
  // directOverride=true + 授权审计字段 directOverrideAt/来源）→ execute 出口通过（direct 是
  // 用户决策点,授权留痕即合法路径;修复前出口无授权校验——GREEN 后本场景仍恒过,防过度修复）。
  {
    name: '213 directOverride 授权约束正例：协调者授权 + direct → exit 通过',
    run: (dir) => {
      const st = baseState('execute');
      st.completedNodes = ['open', 'design', 'plan'];
      st.enteredNodes = ['open', 'design', 'plan', 'execute'];
      st.evidence = {
        open: { summary: 'open done' },
        design: { summary: 'design done' },
        plan: { summary: 'plan done' },
        execute: { summary: 'executed' },
      };
      st.executionMode = 'direct';
      st.directOverride = true;
      st.directOverrideAt = '2026-08-29T10:00:00.000Z';
      st.directOverrideSource = 'execution-mode';
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="S01" status="done"><action>实现 S01</action><write_files>src/s1.mjs</write_files><verify>node --check src/s1.mjs</verify></task>\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/S01-SUMMARY.md', strictSummary('S01'));
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      assertOut(res, 'ALL CHECKS PASSED');
    },
  },

  // 214: directOverride 授权约束负例——执行者自切 direct 无授权审计记录（executionMode=direct +
  // directOverride=true 但无 directOverrideAt）→ execute 出口 BLOCKED（direct 是用户决策点,
  // 不可自决——机制约束）+ 恢复指引（协调者显式授权 / 回 subagent）。修复前出口无校验 → RED。
  {
    name: '214 directOverride 授权约束负例：执行者自切 direct 无授权 → exit BLOCKED',
    run: (dir) => {
      const st = baseState('execute');
      st.completedNodes = ['open', 'design', 'plan'];
      st.enteredNodes = ['open', 'design', 'plan', 'execute'];
      st.evidence = {
        open: { summary: 'open done' },
        design: { summary: 'design done' },
        plan: { summary: 'plan done' },
        execute: { summary: 'executed' },
      };
      st.executionMode = 'direct';
      st.directOverride = true;
      // 无 directOverrideAt 授权审计记录（执行者自切/修复前遗留形态）
      st.newChange = true;
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="S01" status="done"><action>实现 S01</action><write_files>src/s1.mjs</write_files><verify>node --check src/s1.mjs</verify></task>\n');
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'directOverride');
      assertOut(res, '授权');
    },
  },

  // 215: directOverride 越界检测——绕过脚本直接改 state 文件（工具写 .flow-comet/flow-comet-state.json,
  // 无授权）→ hook BLOCK（state 文件禁手动工具写——机器字段由脚本通道管理;修复前 direct 模式
  // 白名单 [''] 允许写 state → 越权写入口 fail-open → RED）。
  {
    name: '215 directOverride 越界：直接改 state 文件无授权 → hook BLOCK',
    run: (dir) => {
      const st = baseState('execute');
      st.status = 'running';
      st.executionMode = 'direct';
      st.directOverride = true;
      st.directOverrideAt = '2026-08-29T10:00:00.000Z';
      writeState(dir, st);
      const stateFile = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: stateFile } });
      assertExit(res, 2);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'flow-comet-state.json');
    },
  },

  // 216: directOverride 授权约束恢复——BLOCK 后按指引① 协调者 execution-mode direct（脚本写入
  // 授权留痕）→ exit 通过；② 回 subagent（清除 directOverride 与授权留痕,handoff 在场）→ exit
  // 也通过——两条恢复路径都闭合（修复前无 BLOCK 无从恢复 → RED）。
  {
    name: '216 directOverride 恢复：BLOCK 后补授权 / 回 subagent → exit 通过',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      const buildState = () => {
        const st = baseState('execute');
        st.completedNodes = ['open', 'design', 'plan'];
        st.enteredNodes = ['open', 'design', 'plan', 'execute'];
        st.evidence = {
          open: { summary: 'open done' },
          design: { summary: 'design done' },
          plan: { summary: 'plan done' },
          execute: { summary: 'executed' },
          'subagent-execute': { summary: 'delegated', handoffResult: handoffFor(['S01']) },
        };
        st.newChange = true;
        return st;
      };
      const writeTask = () => writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="S01" status="done"><action>实现 S01</action><write_files>src/s1.mjs</write_files><verify>node --check src/s1.mjs</verify></task>\n');
      const readState = () => JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      // ① 复现 BLOCK（direct 无授权）
      const st1 = buildState();
      st1.executionMode = 'direct';
      st1.directOverride = true;
      writeState(dir, st1);
      writeTask();
      const rBlock = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(rBlock, 1);
      assertOut(rBlock, 'BLOCKED');
      // ② 恢复路径一：协调者 execution-mode direct（脚本写入授权留痕）→ exit 通过
      writeFile(dir, '.specs/' + CHANGE_ID + '/S01-SUMMARY.md', strictSummary('S01'));
      const auth = runState(['execution-mode', 'direct'], dir, env);
      assertExit(auth, 0);
      assertOut(auth, 'DIRECT-AUTH');
      const st2 = readState();
      if (typeof st2.directOverrideAt !== 'string' || st2.directOverrideAt.trim() === '') {
        throw new Error('授权后 state 应含 directOverrideAt 审计字段: ' + JSON.stringify(st2.directOverrideAt));
      }
      const rAuth = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(rAuth, 0);
      assertOut(rAuth, 'ALL CHECKS PASSED');
      // ③ 恢复路径二：回 subagent（清除 directOverride 与授权留痕）→ exit 通过
      const back = runState(['execution-mode', 'subagent'], dir, env);
      assertExit(back, 0);
      const st3 = readState();
      if (st3.directOverride !== false || st3.directOverrideAt !== undefined) {
        throw new Error('回 subagent 应清除 directOverride 与授权审计字段: ' + JSON.stringify({ directOverride: st3.directOverride, directOverrideAt: st3.directOverrideAt }));
      }
      const rBack = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(rBack, 0);
      assertOut(rBack, 'ALL CHECKS PASSED');
    },
  },

  // 217: hook state 文件拦截的大小写变体闭合（CodeRabbit 采纳）——win32/darwin 文件系统大小写
  // 不敏感，`.Flow-Comet/Flow-Comet-State.json` 与机器状态文件（.flow-comet/flow-comet-state.json）
  // 指向同一实体；修复前 blockedStateFileTarget
  // 精确等值比较 → 变体绕过 W4 防线（direct 白名单 [''] 放行）→ 预期 RED（期望 exit 2 实际 exit 0）。
  // 其他平台（大小写敏感文件系统）变体是不同文件，不属机器状态文件 → 放行（与「其他平台保持等值
  // 比较」语义一致，平台分支断言防 CI 误报）。
  {
    name: '217 hook state 拦截：大小写变体路径 BLOCK（win32/darwin；其他平台放行）',
    run: (dir) => {
      const st = baseState('execute');
      st.status = 'running';
      st.executionMode = 'direct';
      st.directOverride = true;
      st.directOverrideAt = '2026-08-29T10:00:00.000Z';
      writeState(dir, st);
      // 变体形态必须跟随机器状态文件的实际相对路径（命名空间 .flow-comet/flow-comet-state.json）
      const caseVariant = path.join(dir, '.Flow-Comet', 'Flow-Comet-State.json');
      const res = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: caseVariant } });
      if (process.platform === 'win32' || process.platform === 'darwin') {
        assertExit(res, 2);
        assertOut(res, 'BLOCKED');
        assertOut(res, '.Flow-Comet/Flow-Comet-State.json');
      } else {
        assertNotOut(res, 'BLOCKED');
      }
    },
  },

  // 218: execute 完成判定 fail-closed（CodeRabbit 采纳）——pending===0 不足为凭：缺/未知 status
  // 的任务既非 pending 也非 done，畸形块若被跳过，会在另一任务已产 SUMMARY 时把完成态误判为
  // 「任务全部 done」→ 提前路由 review。修复前 resolveNextNode 在 done=1 / attrs=2 时跳过畸形块
  // 按「全 done」推进 → NODE: review（误路由 → 预期 RED）；修复后 done !== attrsList.length
  // → 回 execute（不提前放行到后置节点）。
  {
    name: '218 route-node 完成判定：done 任务 + 畸形块(缺 status) → next 仍回 execute',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="T01" status="done"><action>实现 T01</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n' +
        '<task id="T02" parallel="true"><action>实现 T02</action><write_files>src/t2.mjs</write_files><verify>node --check src/t2.mjs</verify></task>\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', summaryContent());
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes: ['open', 'design', 'plan'],
        evidence: { open: { summary: 'o' }, design: { summary: 'd' }, plan: { summary: 'p' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
      });
      const res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      assertNotOut(res, 'NODE: review');
    },
  },

  // 219: 并行文件依赖检测路径归一化闭合（CodeRabbit 采纳）——重叠比较只用原始字符串时，
  // `src/a.mjs` vs `src/./a.mjs`（`.` 段变体——同一路径的两种写法）不判重叠 → 变体绕过
  // 写写强判（修复前 plan 出口漏检 → 预期 RED：期望 BLOCKED 实际放行）。修复后路径解析先
  // 归一化（分隔符统一 `/`、解 `.` 段、`..` 逃出项目根按越界处理不参与比较），归一化集合
  // 用于写写强判与读写弱判——与委托入口共用同一函数，两侧同语义。
  {
    name: '219 plan exit BLOCKED：路径变体重叠检出（src/a.mjs × src/./a.mjs）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'plan done' };
      st.newChange = true;
      writeState(dir, st);
      const tasks =
        '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/a.mjs</write_files><verify>node --check src/a.mjs</verify></task>\n' +
        '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/./a.mjs</write_files><verify>node --check src/./a.mjs</verify></task>\n';
      const res = runPlanExit(dir, tasks);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'P01×P02');
      assertOut(res, 'src/a.mjs');
      assertOut(res, 'depends_on');
    },
  },

  // ---------- 位置迁移 / 备份 / 感知层剥离（真实安装器 + 真实文件系统，端到端执行断言） ----------

  // AC-1 迁移正例：旧命名空间三方共占（flow-comet 运行时文件 + Comet 资产 + 用户自有文件），
  // 安装器只搬白名单在册的运行时文件——新位置逐字节一致、旧位置移除，其余内容原位不动
  // （不搬迁 / 不删除 / 不改写），且不会被按前缀/模式误搬进新命名空间。
  {
    name: '220 状态迁移白名单：仅运行时文件搬移，Comet 资产与用户文件原位不动（AC-1）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return; // 安装副本无安装器脚本（与场景 105 同判据）
      const proj = path.join(dir, 'proj');
      const stateBytes = migratableStateBytes();
      const kept = writeSharedCometDir(proj, stateBytes);
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      assertExit(res, 0);
      assertOut(res, '已迁移');
      // ① 新位置落位且逐字节一致
      const newState = path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME);
      if (!fs.existsSync(newState)) throw new Error('迁移后新位置状态文件缺失: ' + newState);
      if (!fs.readFileSync(newState).equals(stateBytes)) throw new Error('新位置状态与迁移前不逐字节一致');
      // ② 旧位置运行时文件已移除（搬移语义，非复制）
      if (fs.existsSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME))) {
        throw new Error('迁移后旧位置运行时文件应已移除');
      }
      // ③ Comet 资产与用户自有文件原位未动（位置 + 内容都未变）
      for (const item of kept) {
        const target = path.join(proj, LEGACY_RUNTIME_DIR, item.rel);
        if (!fs.existsSync(target)) throw new Error('非白名单内容被搬迁/删除: ' + item.rel);
        if (!fs.readFileSync(target).equals(item.bytes)) throw new Error('非白名单内容被改写: ' + item.rel);
      }
      // ④ 用户自有备份文件未被搬入新命名空间（白名单按精确文件名，不做前缀/模式匹配）
      const leaked = path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME + '.bak-20260901-user');
      if (fs.existsSync(leaked)) throw new Error('用户自有文件被搬入新命名空间（白名单过宽）: ' + leaked);
    },
  },

  // AC-15 迁移前备份：备份在迁移动作之前生成于新命名空间，内容与迁移前逐字节一致、命名含
  // 时间戳、迁移成功后仍保留；且仅凭这份备份即可恢复出可用的旧状态（状态文件不进版本控制的
  // 项目没有 git 回滚载体——备份是唯一回退依据）。
  {
    name: '221 迁移前备份：逐字节一致且迁移后保留，可据以恢复旧状态（AC-15）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const stateBytes = migratableStateBytes();
      writeSharedCometDir(proj, stateBytes);
      writeMigratedProjectArtifacts(proj);
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      assertExit(res, 0);
      assertOut(res, '迁移前备份');
      // ① 备份恰一份，命名含时间戳（.bak-<ISO 时间戳>）
      const backups = migrationBackups(proj);
      if (backups.length !== 1) throw new Error('迁移应恰生成 1 份备份，实际: ' + JSON.stringify(backups));
      if (!/^flow-comet-state\.json\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(backups[0])) {
        throw new Error('备份命名非 .bak-<时间戳> 形态: ' + backups[0]);
      }
      // ② 备份与迁移前逐字节一致
      const backupPath = path.join(proj, RUNTIME_DIR, backups[0]);
      if (!fs.readFileSync(backupPath).equals(stateBytes)) throw new Error('备份与迁移前不逐字节一致');
      // ③ 迁移成功后备份仍保留（安装器不读取、不清理）——再跑一次安装后仍应恰一份
      assertExit(runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir), 0);
      if (migrationBackups(proj).length !== 1) throw new Error('重跑安装后备份应保留且不新增');
      // ④ 仅凭备份即可恢复出可用的旧状态：把备份覆盖回状态文件 → 安装副本读到同一 change/节点
      fs.copyFileSync(backupPath, path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME));
      const st = runInstalled(proj, '.claude', 'workflow-state.mjs', ['status']);
      assertExit(st, 0);
      assertOut(st, '"change": "' + MIGRATION_CHANGE + '"');
      assertOut(st, '"currentNode": "design"');
    },
  },

  // AC-13 边界①：新位置与旧位置同时存在 → 不覆盖任何一方、报错中止（列出两处路径与人工
  // 处置指引），且中止发生在部署与纳管之前（不产生安装产物、不改 gitignore、不生成备份）。
  {
    name: '222 迁移边界 新旧并存：不覆盖任一方，报错中止（AC-13）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const oldBytes = migratableStateBytes();
      const newBytes = Buffer.from('{\n  "activeChange": "already-migrated"\n}\n', 'utf8');
      writeSharedCometDir(proj, oldBytes);
      const newPath = path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME);
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      fs.writeFileSync(newPath, newBytes);
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      if (res.status === 0) throw new Error('新旧并存应报错中止（exit 非 0），实际 exit 0');
      // 报错须列出两处路径（供人工比对判断），并给出处置指引
      assertOut(res, path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME));
      assertOut(res, newPath);
      assertOut(res, '不覆盖任何一方');
      assertOut(res, '重跑安装器');
      // 双方内容都未被改动
      if (!fs.readFileSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME)).equals(oldBytes)) {
        throw new Error('旧件被改写');
      }
      if (!fs.readFileSync(newPath).equals(newBytes)) throw new Error('新件被覆盖');
      // 中止于部署/纳管之前
      if (migrationBackups(proj).length !== 0) throw new Error('中止时不应产生备份');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('中止时不应产生安装产物');
      if (fs.existsSync(path.join(proj, '.gitignore'))) throw new Error('中止时不应改写 gitignore');
    },
  },

  // AC-13 边界②：旧件是符号链接 → 不跟随链接搬移（避免穿越到项目外）、报错中止；
  // 链接本身与链接指向的真实内容都未被改动，新位置不生成文件。
  {
    name: '223 迁移边界 符号链接：不跟随链接搬移，报错中止（AC-13）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const outside = path.join(dir, 'outside-real-dir');
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, 'real.txt'), 'real\n');
      fs.mkdirSync(path.join(proj, LEGACY_RUNTIME_DIR), { recursive: true });
      const linkPath = path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME);
      // 受限形态如实声明：Windows 无文件符号链接权限（EPERM）时用目录 junction——判定走同一
      // isSymbolicLink() 分支；两种链接都建不出来时显式跳过（不静默冒充已覆盖）
      let linkForm = 'junction';
      try {
        fs.symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (e1) {
        linkForm = 'file-symlink';
        try {
          fs.symlinkSync(outside, linkPath, 'file');
        } catch (e2) {
          console.log('  （本机无创建链接的权限，跳过符号链接夹具——' + (e2.code || e2.message) + '）');
          return;
        }
      }
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      if (res.status === 0) throw new Error('符号链接旧件应报错中止（exit 非 0），实际 exit 0（形态=' + linkForm + '）');
      assertOut(res, '符号链接');
      assertOut(res, '不跟随');
      if (!fs.lstatSync(linkPath).isSymbolicLink()) throw new Error('链接本身被改动（不再是链接）');
      if (!fs.readFileSync(path.join(outside, 'real.txt')).equals(Buffer.from('real\n', 'utf8'))) {
        throw new Error('链接指向的真实内容被改动');
      }
      if (fs.existsSync(path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME))) throw new Error('新位置不应生成文件');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('中止时不应产生安装产物');
    },
  },

  // AC-13 边界③：旧件内容损坏（JSON 解析失败）→ 保留原件未改动、报错中止并给修复指引；
  // 中止发生在写入之前（新位置不生成文件、不产生备份）。
  {
    name: '224 迁移边界 JSON 损坏：保留原件报错中止（AC-13）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const broken = Buffer.from('{ "activeChange": \n', 'utf8');
      fs.mkdirSync(path.join(proj, LEGACY_RUNTIME_DIR), { recursive: true });
      fs.writeFileSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME), broken);
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      if (res.status === 0) throw new Error('损坏状态应报错中止（exit 非 0），实际 exit 0');
      assertOut(res, '不是合法 JSON');
      assertOut(res, '保留原件');
      if (!fs.readFileSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME)).equals(broken)) {
        throw new Error('损坏原件被改写');
      }
      if (fs.existsSync(path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME))) throw new Error('新位置不应生成文件');
      if (migrationBackups(proj).length !== 0) throw new Error('中止于写入之前，不应产生备份');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('中止时不应产生安装产物');
    },
  },

  // AC-7 迁移失败不丢数据：迁移目标不可建立（路径异常——目标目录位置被普通文件占用）时，
  // 旧文件完整保留、报错并给出恢复指引，不删除任何既有内容。
  {
    name: '225 迁移失败保护：目标不可建立时旧文件完整保留（AC-7）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const stateBytes = migratableStateBytes();
      writeSharedCometDir(proj, stateBytes);
      const occupied = path.join(proj, RUNTIME_DIR);
      fs.writeFileSync(occupied, 'occupied\n'); // 目标目录位置被普通文件占用（确定性的路径异常形态）
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      if (res.status === 0) throw new Error('迁移目标不可建立应报错中止（exit 非 0），实际 exit 0');
      assertOut(res, '旧文件完整保留');
      assertOut(res, '重跑安装器');
      if (!fs.readFileSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME)).equals(stateBytes)) {
        throw new Error('失败路径下旧文件被改写');
      }
      if (!fs.lstatSync(occupied).isFile()) throw new Error('占位文件被改动（既有内容不得被处置）');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('中止时不应产生安装产物');
    },
  },

  // AC-8 gitignore 形态①（逐条路径）：既有条目一律保留原样（不"更新"为新路径），仅缺失时
  // 追加新命名空间条目；连续两次安装不产生重复行；追加内容沿用既有行尾风格。
  {
    name: '226 gitignore 纳管 逐条路径形态：既有条目保留 + 追加幂等（AC-8）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(path.join(proj, LEGACY_RUNTIME_DIR, 'runs'), { recursive: true }); // Comet 资产在场
      fs.writeFileSync(path.join(proj, LEGACY_RUNTIME_DIR, 'runs', 'run-001.json'), '{"comet":true}\n');
      const legacyLine = LEGACY_RUNTIME_DIR + '/' + RUNTIME_STATE_NAME;
      const initial = legacyLine + '\r\nnode_modules/\r\n# user note\r\n*.bak-*\r\n';
      const result = runGitignoreForm(dir, proj, initial);
      assertGitignoreManaged(result);
      if (!result.afterFirst.startsWith(initial)) {
        throw new Error('既有内容未逐字保留:\n' + JSON.stringify(result.afterFirst));
      }
      if (!result.afterFirst.split(/\r?\n/).includes(legacyLine)) {
        throw new Error('既有逐条路径条目被改写/删除: ' + legacyLine);
      }
      const appended = result.afterFirst.slice(initial.length);
      if (!appended.includes('\r\n') || /(^|[^\r])\n/.test(appended)) {
        throw new Error('追加内容未沿用既有行尾风格（CRLF）: ' + JSON.stringify(appended));
      }
    },
  },

  // AC-8 gitignore 形态②（整目录 .comet/）：整目录条目原样保留——该目录中仍有 Comet 资产，
  // 改写会误伤用户对它们的忽略意图；同样只追加缺失的新命名空间条目且幂等。
  {
    name: '227 gitignore 纳管 整目录形态：既有条目保留 + 追加幂等（AC-8）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(path.join(proj, LEGACY_RUNTIME_DIR, 'runs'), { recursive: true });
      fs.writeFileSync(path.join(proj, LEGACY_RUNTIME_DIR, 'runs', 'run-001.json'), '{"comet":true}\n');
      const initial = LEGACY_RUNTIME_DIR + '/\nnode_modules/\n# user note\n';
      const result = runGitignoreForm(dir, proj, initial);
      assertGitignoreManaged(result);
      if (!result.afterFirst.startsWith(initial)) {
        throw new Error('既有内容未逐字保留:\n' + JSON.stringify(result.afterFirst));
      }
      if (!result.afterFirst.split(/\r?\n/).includes(LEGACY_RUNTIME_DIR + '/')) {
        throw new Error('整目录既有条目被改写/删除: ' + LEGACY_RUNTIME_DIR + '/');
      }
      const appended = result.afterFirst.slice(initial.length);
      if (appended.includes('\r\n')) throw new Error('追加内容引入了 CRLF（既有为 LF）: ' + JSON.stringify(appended));
    },
  },

  // AC-8 gitignore 形态③（完全无条目）：用户其他内容（无关行 / 注释 / 无末行换行）不被改写，
  // 仅追加缺失条目且连续两次安装逐字节不变。
  {
    name: '228 gitignore 纳管 无条目形态：用户内容原样保留 + 追加幂等（AC-8）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      fs.mkdirSync(proj, { recursive: true });
      const initial = 'node_modules/\n# keep\n*.log'; // 末行无换行——追加不得粘接到用户行上
      const result = runGitignoreForm(dir, proj, initial);
      assertGitignoreManaged(result);
      if (!result.afterFirst.startsWith(initial)) {
        throw new Error('既有内容未逐字保留:\n' + JSON.stringify(result.afterFirst));
      }
      if (!/^\*\.log$/m.test(result.afterFirst)) throw new Error('用户末行被改写/粘接: ' + JSON.stringify(result.afterFirst));
    },
  },

  // AC-5 剥离①：同一运行中 workflow 下，Comet classic 资产（.comet/config.yaml + classic
  // change 目录 + overlay 证据）在场与缺席时，hook 与 guard 的判定（退出码 + 归一化输出）
  // 完全一致——判定与这些文件是否存在无关；判定本身非空洞（hook 拦越权写源码 / guard 放行合规出口）。
  {
    name: '229 感知层剥离：classic 资产有无不改变 hook 与 guard 判定（AC-5）',
    run: (dir) => {
      const builtin = path.join(dir, 'reference', 'workflow-protocol.json');
      const build = (name, withClassic) => {
        const proj = path.join(dir, name);
        fs.mkdirSync(path.join(proj, 'reference'), { recursive: true });
        fs.copyFileSync(builtin, path.join(proj, 'reference', 'workflow-protocol.json'));
        writeIntakeArtifacts(proj);
        const st = baseState('open');
        st.status = 'running';
        st.evidence.open = { summary: 'intake complete' };
        writeState(proj, st);
        if (withClassic) writeClassicCometAssets(proj);
        return proj;
      };
      const judge = (proj) => ({
        hook: runHook(['before_tool'], proj,
          { tool_name: 'Write', tool_input: { file_path: path.join(proj, 'src', 'evil.mjs') } }),
        guard: runGuard(['exit', 'open'], proj),
      });
      const withClassic = build('with-classic', true);
      const withoutClassic = build('without-classic', false);
      const a = judge(withClassic);
      const b = judge(withoutClassic);
      // 判定非空洞：运行中 workflow 越权写源码被拦；合规出口放行
      assertExit(a.hook, 2);
      assertOut(a.hook, 'BLOCKED');
      assertExit(a.guard, 0);
      assertOut(a.guard, 'ALL CHECKS PASSED');
      // 一致性：退出码 + 归一化输出逐字相同（路径差异抹除后）
      const norm = (res, proj) => normalizeRoot(outputText(res), proj, dir);
      if (a.hook.status !== b.hook.status || norm(a.hook, withClassic) !== norm(b.hook, withoutClassic)) {
        throw new Error('hook 判定随 classic 资产变化（感知层未剥离干净）:\n' +
          JSON.stringify({ withClassic: norm(a.hook, withClassic), withoutClassic: norm(b.hook, withoutClassic) }, null, 2));
      }
      if (a.guard.status !== b.guard.status || norm(a.guard, withClassic) !== norm(b.guard, withoutClassic)) {
        throw new Error('guard 判定随 classic 资产变化（感知层未剥离干净）:\n' +
          JSON.stringify({ withClassic: norm(a.guard, withClassic), withoutClassic: norm(b.guard, withoutClassic) }, null, 2));
      }
    },
  },

  // AC-5 剥离②：kind 为 comet-five-phase-overlay 的协议不再进入叠加分支——与同节点、
  // kind=workflow-kernel 的协议在完全相同的夹具（含 classic 活动 change）上判定一致；
  // 叠加分支的专属信号（无活动 Comet change / 多 Comet change）不再出现；
  // 另做源码符号检索，确认感知层符号在判定脚本中零残留。
  {
    name: '230 感知层剥离：overlay 协议不再进入叠加分支（AC-5）',
    run: (dir) => {
      const builtinProtocol = JSON.parse(fs.readFileSync(BUILTIN_PROTOCOL_SOURCE, 'utf8'));
      const build = (name, kind) => {
        const proj = path.join(dir, name);
        const protocol = JSON.parse(JSON.stringify(builtinProtocol));
        protocol.kind = kind;
        fs.mkdirSync(path.join(proj, 'reference'), { recursive: true });
        fs.copyFileSync(path.join(dir, 'reference', 'workflow-protocol.json'), path.join(proj, 'reference', 'workflow-protocol.json'));
        writeFile(proj, 'overlay-protocol.json', JSON.stringify(protocol, null, 2) + '\n');
        writeIntakeArtifacts(proj);
        const st = baseState('open');
        st.status = 'running';
        st.evidence.open = { summary: 'intake complete' };
        writeState(proj, st);
        writeClassicCometAssets(proj); // 叠加分支的前置（classic 活动 change）在场
        return proj;
      };
      const overlayProj = build('overlay-kind', 'comet-five-phase-overlay');
      const kernelProj = build('kernel-kind', 'workflow-kernel');
      const runExit = (proj) => runGuard(['exit', 'open', '--protocol', path.join(proj, 'overlay-protocol.json')], proj);
      const a = runExit(overlayProj);
      const b = runExit(kernelProj);
      assertExit(a, 0);
      assertOut(a, 'ALL CHECKS PASSED');
      assertNotOut(a, 'active Comet change');
      if (a.status !== b.status
        || normalizeRoot(outputText(a), overlayProj, dir) !== normalizeRoot(outputText(b), kernelProj, dir)) {
        throw new Error('overlay 协议与同节点 kernel 协议判定不一致（叠加分支未剥离）:\n' +
          JSON.stringify({ overlay: normalizeRoot(outputText(a), overlayProj, dir), kernel: normalizeRoot(outputText(b), kernelProj, dir) }, null, 2));
      }
      // 源码符号检索：感知层符号在判定脚本中零残留
      const SYMBOLS = [
        'isCometOverlay', 'comet-five-phase-overlay', 'resolveCometOverlayChange',
        'activeCometChanges', 'overlayNodeFromState', 'hasOverlayEvidence',
        'readWorkflowProjectPathConfig', 'workflowPathBaseRoot',
      ];
      for (const [label, file] of [['workflow-guard.mjs', GUARD], ['comet-hook-guard.mjs', HOOK]]) {
        const src = fs.readFileSync(file, 'utf8');
        for (const symbol of SYMBOLS) {
          if (src.includes(symbol)) throw new Error(label + ' 仍含 Comet 感知层符号: ' + symbol);
        }
      }
    },
  },

  // AC-14 自检清单有效性：条目齐备且同步 → 零问题；条目缺失 → 显式报告（含文件名），
  // 不得静默跳过（"永不生效的条目"无处藏身）；条目在场但计数未同步 → 同样上报。
  // 用真实清单常量与真实文件系统驱动自检实现（受检根替换为场景临时目录）。
  // ③ 起为系统测试集项数受检面（与场景数面同构，判据同一）。
  {
    name: '231 自检清单：条目缺失被显式报告而非静默跳过（AC-14）',
    run: (dir) => {
      const n = 7; // 夹具自定场景数（受检文件内容与之一致）
      const synced = 'ALL ' + n + ' SCENARIOS PASSED\n';
      for (const rel of SCENARIO_COUNT_FILES) writeFile(dir, rel, synced);
      const clean = scenarioCountSyncProblems(n, dir);
      if (clean.length !== 0) throw new Error('条目齐备且同步时不应报告问题: ' + JSON.stringify(clean));
      // ① 移走一个条目（幽灵条目形态）→ 显式报告缺失项（列出文件名）
      const missingRel = 'docs/VERSIONS-zh.md';
      if (!SCENARIO_COUNT_FILES.includes(missingRel)) throw new Error('夹具前提失效：' + missingRel + ' 不在受检清单内');
      fs.rmSync(path.join(dir, missingRel));
      const problems = scenarioCountSyncProblems(n, dir);
      if (!problems.some((p) => p.includes('缺失') && p.includes(missingRel))) {
        throw new Error('缺失条目未被显式报告: ' + JSON.stringify(problems));
      }
      // ② 条目在场但场景数未同步 → 同样上报（缺省放过即为静默失检）
      writeFile(dir, missingRel, '未同步的内容\n');
      const stale = scenarioCountSyncProblems(n, dir).join(' | ');
      if (!stale.includes('未同步') || !stale.includes(missingRel)) {
        throw new Error('未同步条目未被上报: ' + stale);
      }
      // ③ 系统测试集项数受检面：运行时派生 + 缺失 / 未同步 / 组判定 / 派生源缺失全分支
      exerciseSystemTestCountCheck(dir);
    },
  },

  // ---------- 外部审查修复：hook 双判定路径 / 迁移错误分类 / BOM / purge 时序 ----------

  // 232: worktree 隔离区放行的判定路径一致性——放行分支此前只挂在 file_path 判定处
  // （Bash 分支先执行并直接按协调者白名单判定），同一路径用 Write/Edit 放行、用 Bash
  // 重定向写却被拦（判定随工具而变）。修复后两条判定共用同一隔离区判据——同路径同结论。
  // 穿越形态（`..` 逃出隔离区）在两条路径上都必须仍被拦截：放行不是无条件的。
  // ④ 追加（物理包含性）：隔离区**内**指向区外的符号链接/junction 是同一前缀下的第二种逃逸——
  // 词法归一化对它无能为力（路径字符串确实以隔离区前缀开头），必须按真实落点判定。
  {
    name: '232 hook worktree 放行：Bash 与 file_path 判定一致，穿越形态与区外链接落点仍拦',
    run: (dir) => {
      writeState(dir, { ...baseState('subagent-execute'), status: 'running' });
      const insideWorktree = path.join(dir, '.claude', 'worktrees', 'agent-abc123', 'src', 'x.mjs');
      const posix = (p) => p.split(path.sep).join('/');
      // ① file_path 判定：隔离区内写入放行（既有行为，防回归）
      const viaWrite = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: insideWorktree } });
      assertExit(viaWrite, 0);
      assertOut(viaWrite, 'workflow-hook-guard-ok');
      // ② Bash 判定：同一路径的命令级写入同样放行（修复前按协调者白名单拦截 → RED）
      const viaBash = runHook(['before_tool'], dir,
        { tool_name: 'Bash', tool_input: { command: 'echo x > "' + posix(insideWorktree) + '"' } });
      assertExit(viaBash, 0);
      assertOut(viaBash, 'workflow-hook-guard-ok');
      // ③ 穿越形态：`..` 归一化后逃出隔离区 → 两条判定都仍拦截
      const escape = posix(path.join(dir, '.claude', 'worktrees', 'agent-abc123'))
        + '/../../src/evil.mjs';
      const viaWriteEscape = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: escape } });
      assertExit(viaWriteEscape, 2);
      assertOut(viaWriteEscape, 'BLOCKED');
      const viaBashEscape = runHook(['before_tool'], dir,
        { tool_name: 'Bash', tool_input: { command: 'echo x > "' + escape + '"' } });
      assertExit(viaBashEscape, 2);
      assertOut(viaBashEscape, 'BLOCKED');
      // ④ 物理包含性：隔离区**内**指向区外的符号链接/junction——词法上仍以 `.claude/worktrees/`
      //    开头，真实落点却在隔离区外。放行先于各自的白名单判定返回，故放行这类路径等于
      //    没有任何后续校验兜底 → 两条判定都必须拦截（修复前按词法放行 = RED）。
      //    Windows 用 junction（建 junction 不需要符号链接特权，与真实环境权限无关）；
      //    POSIX 用目录符号链接；平台确实无法构造链接时按下方 ⑤ 的兜底断言如实降级。
      const outsideDir = path.join(dir, 'outside-zone');
      fs.mkdirSync(outsideDir, { recursive: true });
      const agentDir = path.join(dir, '.claude', 'worktrees', 'agent-abc123');
      fs.mkdirSync(agentDir, { recursive: true });
      let linkCreated = false;
      try {
        fs.symlinkSync(outsideDir, path.join(agentDir, 'link'),
          process.platform === 'win32' ? 'junction' : 'dir');
        linkCreated = true;
      } catch { linkCreated = false; }
      if (!linkCreated) {
        console.error('WARN: 当前平台无法构造符号链接/junction，隔离区链接逃逸断言降级为兜底断言');
      }
      if (linkCreated) {
        const escaping = posix(path.join(agentDir, 'link', 'evil.mjs'));
        const viaWriteLink = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: escaping } });
        assertExit(viaWriteLink, 2);
        assertOut(viaWriteLink, 'BLOCKED');
        const viaBashLink = runHook(['before_tool'], dir,
          { tool_name: 'Bash', tool_input: { command: 'echo x > "' + escaping + '"' } });
        assertExit(viaBashLink, 2);
        assertOut(viaBashLink, 'BLOCKED');
      }
      // ⑤ 放行不得过宽：链接**旁**的真实隔离区路径仍须放行（把整个隔离区一并拦掉同样是回归），
      //    非隔离区路径仍按原逻辑判定（协调者白名单拦截）。
      const viaWriteNormal = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(agentDir, 'src', 'y.mjs') } });
      assertExit(viaWriteNormal, 0);
      assertOut(viaWriteNormal, 'workflow-hook-guard-ok');
      const viaWriteOutside = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'evil.mjs') } });
      assertExit(viaWriteOutside, 2);
      assertOut(viaWriteOutside, 'BLOCKED');
    },
  },

  // 233: 迁移前置探测的错误分类——lstat 的**访问类**故障（EACCES/EPERM/EIO）不得被当作
  // 「文件不存在」：吞掉会让迁移报告「已跳过：旧位置不存在」而安装照常继续，用户的旧状态
  // 永远留在旧位置（静默的数据丢失风险）。修复后只有「确实不存在」类（ENOENT/ENOTDIR）
  // 返回 null，其余原样抛出、安装中止并暴露问题。
  // 构造方式：本机/CI 无法用真实文件系统稳定造出访问类故障（受权限与平台差异支配，
  // 见场景 223 的链接权限先例），故用 `--require` 预加载在**子进程内**把 lstatSync 对
  // 「旧位置状态文件」的探测替换为抛 EACCES（故障注入只命中该路径，其余调用走真实实现）——
  // 驱动的仍是真实安装器主流程与真实文件系统状态。
  {
    name: '233 迁移探测错误分类：lstat 访问类故障中止安装，ENOENT 仍按不存在跳过',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      // ① ENOENT（确实不存在）→ 仍按「无需迁移」跳过、安装继续（行为未变）
      const noLegacy = path.join(dir, 'proj-no-legacy');
      fs.mkdirSync(noLegacy, { recursive: true });
      const skipped = runPrepareEnv(['--target', noLegacy, '--platform', 'claude-code'], dir);
      assertExit(skipped, 0);
      assertOut(skipped, '已跳过');
      assertOut(skipped, '无需迁移');
      // ② 访问类故障 → 中止（修复前被吞成「不存在」→ 已跳过 + 安装继续 → RED）
      const proj = path.join(dir, 'proj-lstat-fault');
      const stateBytes = migratableStateBytes();
      writeSharedCometDir(proj, stateBytes);
      const preloadName = 'lstat-fault-preload.cjs';
      writeFile(dir, preloadName, [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        'const realLstatSync = fs.lstatSync;',
        'fs.lstatSync = function (target, ...rest) {',
        '  const segments = path.resolve(String(target)).split(path.sep);',
        "  const isLegacyStateFile = segments[segments.length - 1] === 'flow-comet-state.json'",
        "    && segments[segments.length - 2] === '.comet';",
        '  if (isLegacyStateFile) {',
        "    const error = new Error('EACCES: permission denied, lstat ' + JSON.stringify(String(target)));",
        "    error.code = 'EACCES';",
        '    throw error;',
        '  }',
        '  return realLstatSync.call(fs, target, ...rest);',
        '};',
        '',
      ].join('\n'));
      const spawned = spawnSync(
        process.execPath,
        ['--require', path.join(dir, preloadName), PREPARE_ENV, '--target', proj, '--platform', 'claude-code'],
        { cwd: dir, env: { ...process.env }, encoding: 'utf8', timeout: 120000 },
      );
      const res = { status: spawned.status ?? 1, output: String(spawned.stdout || '') + String(spawned.stderr || '') };
      if (res.status === 0) throw new Error('访问类故障应中止安装（exit 非 0），实际 exit 0');
      assertOut(res, 'EACCES');
      assertNotOut(res, '已跳过');
      assertNotOut(res, '已迁移');
      // 旧件未被处置、新位置不生成文件（中止于任何写操作之前）
      if (!fs.readFileSync(path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME)).equals(stateBytes)) {
        throw new Error('中止路径下旧件被改写');
      }
      if (fs.existsSync(path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME))) throw new Error('中止时新位置不应生成文件');
      if (migrationBackups(proj).length !== 0) throw new Error('中止时不应产生备份');
    },
  },

  // 234: 迁移校验与运行时判定的 BOM 一致性——运行时（workflow-state.mjs readJson）明确容忍
  // UTF-8 BOM（外部写入如会话 Write 可能带 BOM）。迁移侧此前不 strip BOM：同一份数据运行时
  // 读得动、迁移判「不是合法 JSON」而中止安装。修复后校验侧同样容忍 BOM，且**只影响校验**——
  // 备份与新落盘必须保留原始字节（不得改写用户数据）。
  {
    name: '234 状态迁移接受带 BOM 的旧状态：迁移成功且备份与新位置保留原始字节',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const bomStateBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), migratableStateBytes()]);
      writeSharedCometDir(proj, bomStateBytes);
      writeMigratedProjectArtifacts(proj); // ③ 运行时读取断言需要活动 change 目录在场
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code'], dir);
      assertExit(res, 0);
      assertOut(res, '已迁移');
      // ① 新位置落位且逐字节一致（BOM 保留——校验容忍不改写数据）
      const newState = path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME);
      if (!fs.readFileSync(newState).equals(bomStateBytes)) {
        throw new Error('新位置状态未保留原始字节（BOM 被剥离或内容被改写）');
      }
      // ② 备份同样逐字节一致
      const backups = migrationBackups(proj);
      if (backups.length !== 1) throw new Error('迁移应恰生成 1 份备份，实际: ' + JSON.stringify(backups));
      if (!fs.readFileSync(path.join(proj, RUNTIME_DIR, backups[0])).equals(bomStateBytes)) {
        throw new Error('备份未保留原始字节（BOM 被剥离或内容被改写）');
      }
      // ③ 迁移后运行时能读（BOM 容忍是运行时的既有设计决策——两处判定一致）
      const st = runInstalled(proj, '.claude', 'workflow-state.mjs', ['status']);
      assertExit(st, 0);
      assertOut(st, MIGRATION_CHANGE);
    },
  },

  // 235: 被拒绝的命令不得产生副作用——`--purge` 缺 `--yes` 的确认校验此前排在运行时文件
  // 迁移之后：命令最终被拒绝，但迁移已经执行、目标已被修改。修复后确认校验先于一切写操作。
  {
    name: '235 purge 缺 --yes：命令被拒且迁移未发生（零副作用）',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj');
      const stateBytes = migratableStateBytes();
      writeSharedCometDir(proj, stateBytes);
      const res = runPrepareEnv(['--target', proj, '--platform', 'claude-code', '--purge'], dir);
      if (res.status === 0) throw new Error('--purge 缺 --yes 应拒绝执行（exit 非 0），实际 exit 0');
      assertOut(res, '--yes');
      assertNotOut(res, '已迁移');
      // 零副作用：旧件原位未动、新位置不生成文件、不产生备份、无安装产物
      const oldPath = path.join(proj, LEGACY_RUNTIME_DIR, RUNTIME_STATE_NAME);
      if (!fs.existsSync(oldPath)) throw new Error('被拒绝的命令仍执行了迁移（旧位置文件已消失）');
      if (!fs.readFileSync(oldPath).equals(stateBytes)) throw new Error('被拒绝的命令改写了旧件');
      if (fs.existsSync(path.join(proj, RUNTIME_DIR, RUNTIME_STATE_NAME))) throw new Error('被拒绝的命令仍写入了新位置');
      if (migrationBackups(proj).length !== 0) throw new Error('被拒绝的命令仍产生了备份');
      if (fs.existsSync(path.join(proj, '.claude'))) throw new Error('被拒绝的命令仍产生了安装产物');
    },
  },

  // ---------- 命令写判定的写入目标取向（Copy/Move 与位置形态） ----------

  // 236: 命令写判定的写入目标取向——Copy-Item/Move-Item 的 `-Path`/`-LiteralPath` 是**源**路径，
  // 写入目标是 `-Destination`。修复前 cmdlet 模式只捕获 `-(Path|LiteralPath)`（源），且全无
  // `-Destination` 模式 → 目标从不被检查（越界写整条放行）；而同文件 .NET File API 分支按
  // 「Copy/Move 目标 = 第二参数」取第二个捕获组——同一函数两个分支取向相反。
  // 修复后按目的地取值（与 .NET 分支同向）：① 目标越界 → BLOCK（修复前放行 → RED）；
  // ② 源在白名单外而目标在白名单内 → 放行（源是读取方向，不属写入判定；修复前拿源当目标 → 误拦 → RED）；
  // ③ 源与目标都在白名单内 → 放行（放行不得因本次修复收窄）。
  {
    name: '236 hook 命令写：Copy-Item/Move-Item 取 -Destination 为写入目标（目标越界拦、源路径不再误拦）',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      const src = '.specs/' + CHANGE_ID + '/x.md';
      const inside = '.specs/' + CHANGE_ID + '/copy.md';
      // ① 逃逸：目标在协调者白名单（.specs/）之外
      const escapeCopy = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Copy-Item -Path ' + src + ' -Destination CLAUDE.md' },
      });
      assertExit(escapeCopy, 2);
      assertOut(escapeCopy, 'BLOCKED');
      assertOut(escapeCopy, 'CLAUDE.md');
      const escapeMove = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Move-Item -Path ' + src + ' -Destination docs/MECHANISM.md' },
      });
      assertExit(escapeMove, 2);
      assertOut(escapeMove, 'BLOCKED');
      assertOut(escapeMove, 'docs/MECHANISM.md');
      // ② 源在白名单外、目标在白名单内 → 放行（读取方向不判定为写入）
      const sourceOutside = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Copy-Item -LiteralPath CLAUDE.md -Destination ' + inside },
      });
      assertExit(sourceOutside, 0);
      assertOut(sourceOutside, 'workflow-hook-guard-ok');
      // ③ 源与目标都在白名单内 → 放行
      const bothInside = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Copy-Item -Path ' + src + ' -Destination ' + inside },
      });
      assertExit(bothInside, 0);
      assertOut(bothInside, 'workflow-hook-guard-ok');
    },
  },

  // 237: 位置形态 `cp <src> <dst>` / `mv <src> <dst>`——修复前命令写判定只认 PowerShell cmdlet、
  // shell 重定向与 .NET File API，位置形态无任何模式覆盖 → 越界写整条放行。
  // 修复后取最后一个位置参数为目标（开关及其取值不参与）：① 目标越界 → BLOCK（修复前放行 → RED）；
  // ② 目标在白名单内 → 放行；③ `cp` 只作为普通参数出现（不是命令词）时不产生写入目标
  // （命令位置锚定——否则 `grep -n cp <file>` 会把文件名当成写入目标 → 反过来造成误拦）。
  {
    name: '237 hook 命令写：cp/mv 位置形态取最后位置参数为目标（逃逸拦截，命令位置锚定不误判）',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      const src = '.specs/' + CHANGE_ID + '/x.md';
      const inside = '.specs/' + CHANGE_ID + '/copy.md';
      const cpEscape = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp ' + src + ' CLAUDE.md' },
      });
      assertExit(cpEscape, 2);
      assertOut(cpEscape, 'BLOCKED');
      assertOut(cpEscape, 'CLAUDE.md');
      const mvEscape = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'mv -f ' + src + ' README-zh.md' },
      });
      assertExit(mvEscape, 2);
      assertOut(mvEscape, 'BLOCKED');
      assertOut(mvEscape, 'README-zh.md');
      // 目标在白名单内 → 放行（含开关：开关与其取值不参与位置参数扫描）
      const cpInside = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp -f CLAUDE.md ' + inside },
      });
      assertExit(cpInside, 0);
      assertOut(cpInside, 'workflow-hook-guard-ok');
      // 命令位置锚定：`cp` 作为普通参数出现（grep 模式）不是写命令
      const notCommand = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'grep -n cp README.md' },
      });
      assertExit(notCommand, 0);
      assertOut(notCommand, 'workflow-hook-guard-ok');
    },
  },

  // 238: 纯位置形态（`Copy-Item <src> <dst>`）与 `-FilePath`（Out-File 的惯用主参数）修复前均无
  // 模式覆盖 → 放行；修复后两者都按写入目标判定。同场景锚定既有 `-Path` 语义未被本次修复放宽
  // （Set-Content / Remove-Item 的 `-Path` 就是写入目标：越界拦、白名单内放行）。
  {
    name: '238 hook 命令写：纯位置形态与 -FilePath 目标覆盖，既有 -Path 语义保持',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      const src = '.specs/' + CHANGE_ID + '/x.md';
      const positional = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Copy-Item ' + src + ' CLAUDE.md' },
      });
      assertExit(positional, 2);
      assertOut(positional, 'BLOCKED');
      assertOut(positional, 'CLAUDE.md');
      const filePath = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Out-File -FilePath docs/MECHANISM.md' },
      });
      assertExit(filePath, 2);
      assertOut(filePath, 'BLOCKED');
      assertOut(filePath, 'docs/MECHANISM.md');
      // 开关取值不参与位置参数扫描：`-Filter *.md` 的 `*.md` 不是写入目标（当成目标即新的误拦）
      const filterValue = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Remove-Item -Force -Filter *.md' },
      });
      assertExit(filterValue, 0);
      assertOut(filterValue, 'workflow-hook-guard-ok');
      // 既有 -Path 语义保持（回归锚）：越界拦
      const removePath = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Remove-Item -Path docs/MECHANISM.md' },
      });
      assertExit(removePath, 2);
      assertOut(removePath, 'BLOCKED');
      const setContentOut = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Set-Content -Path docs/MECHANISM.md -Value x' },
      });
      assertExit(setContentOut, 2);
      assertOut(setContentOut, 'BLOCKED');
      // 既有 -Path 语义保持（回归锚）：白名单内放行
      const setContentIn = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'Set-Content -Path ' + src + ' -Value x' },
      });
      assertExit(setContentIn, 0);
      assertOut(setContentIn, 'workflow-hook-guard-ok');
    },
  },

  // 239: 目的地型命令的参数段必须止于换行——段捕获 `[^;|&]*` 不排除 `\r`/`\n`，`cp <src> <dst>`
  // 之后紧跟另一行命令时段会跨行吞并：「最后一个位置参数」取到下一行的参数（通常在白名单内）
  // → 整条命令放行，**真正被写的 <dst> 从不被检查**（逃逸方向）。修复后换行/回车都是段边界，
  // 每行命令按各自参数段判定。
  {
    name: '239 hook 命令写：目的地型命令的段不跨行（跨行吞并使真实目标漏检 → 拦）',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      const src = '.specs/' + CHANGE_ID + '/x.md';
      const inside = '.specs/' + CHANGE_ID + '/ok.md';
      // ① 目标越界、下一行参数在白名单内：修复前取到下一行参数 → 放行（逃逸）
      const crossLine = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp ' + src + ' CLAUDE.md\necho ' + inside },
      });
      assertExit(crossLine, 2);
      assertOut(crossLine, 'BLOCKED');
      assertOut(crossLine, 'CLAUDE.md');
      // ② CRLF 行尾（Windows 形态）同判：`\r` 也是段边界
      const crlf = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp ' + src + ' CLAUDE.md\r\necho ' + inside },
      });
      assertExit(crlf, 2);
      assertOut(crlf, 'BLOCKED');
      assertOut(crlf, 'CLAUDE.md');
      // ③ 行首是普通命令、写命令在第二行 → 第二行仍被独立判定（多行命令串的覆盖保持）
      const secondLine = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'echo ' + inside + '\nmv ' + src + ' README-zh.md' },
      });
      assertExit(secondLine, 2);
      assertOut(secondLine, 'BLOCKED');
      assertOut(secondLine, 'README-zh.md');
      // ④ 单行且目标在白名单内 → 放行（收紧段边界不得误伤合法形态）
      const singleLine = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp ' + src + ' ' + inside },
      });
      assertExit(singleLine, 0);
      assertOut(singleLine, 'workflow-hook-guard-ok');
    },
  },

  // 240: GNU cp/mv 的**前置目的地**选项 `-t <dir>` / `--target-directory[= ]<dir>`——目的地不是
  // 最后一个位置参数而是开关的取值。修复前只把开关跳过取值、仍取「最后一个位置参数」= 源
  // （源通常在白名单内）→ 整条命令放行，真正被写的目录不被检查（逃逸方向）。
  {
    name: '240 hook 命令写：cp/mv 前置目的地 -t / --target-directory 取为写入目标',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      const src = '.specs/' + CHANGE_ID + '/x.md';
      const inside = '.specs/' + CHANGE_ID + '/ok.md';
      // ① `-t <dir>`：目的地越界 → 拦（修复前取源 → 放行）
      const shortForm = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp -t docs ' + src },
      });
      assertExit(shortForm, 2);
      assertOut(shortForm, 'BLOCKED');
      assertOut(shortForm, 'docs');
      // ② `--target-directory=<dir>`（等号形态）
      const longFormEquals = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp --target-directory=docs ' + src },
      });
      assertExit(longFormEquals, 2);
      assertOut(longFormEquals, 'BLOCKED');
      assertOut(longFormEquals, 'docs');
      // ③ `--target-directory <dir>`（空格形态）
      const longFormSpace = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'mv --target-directory docs ' + src },
      });
      assertExit(longFormSpace, 2);
      assertOut(longFormSpace, 'BLOCKED');
      assertOut(longFormSpace, 'docs');
      // ④ 前置目的地在白名单内 → 放行（不得因本次修复误拦）
      const insideTarget = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'mv -t .specs/' + CHANGE_ID + ' ' + src },
      });
      assertExit(insideTarget, 0);
      assertOut(insideTarget, 'workflow-hook-guard-ok');
      // ⑤ 反向锚：无前置目的地的普通形态仍按最后位置参数判定（既有语义保持）
      const plain = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'cp -f ' + src + ' ' + inside },
      });
      assertExit(plain, 0);
      assertOut(plain, 'workflow-hook-guard-ok');
    },
  },

  // 241: 命令位置锚定必须引号感知——命令边界集 `[;&|(){}]` 不区分引号内外，`printf '(cp CLAUDE.md)'`
  // 引号内的括号被当成命令边界，括号里的文本被读成写命令 → **合法命令被拦**（误拦方向）。
  // 修复后边界只在引号外生效；引号外的真命令仍按原判据拦截（收紧不得放过真逃逸）。
  {
    name: '241 hook 命令写：引号内的命令分隔符不构成命令位置（合法命令不被读成写命令）',
    run: (dir) => {
      writeState(dir, { ...baseState('review'), status: 'running' });
      // ① 单引号内的括号：不是命令边界
      const singleQuoted = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: "printf '(cp CLAUDE.md)'" },
      });
      assertExit(singleQuoted, 0);
      assertOut(singleQuoted, 'workflow-hook-guard-ok');
      // ② 双引号内的分号：不是命令分隔符
      const doubleQuoted = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'echo "cp CLAUDE.md; mv x README.md"' },
      });
      assertExit(doubleQuoted, 0);
      assertOut(doubleQuoted, 'workflow-hook-guard-ok');
      // ③ 引号外的真写命令仍拦（同一命令串内引号内文本与真命令并存）
      const realCommand = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'printf "(cp x)" ; cp .specs/' + CHANGE_ID + '/x.md CLAUDE.md' },
      });
      assertExit(realCommand, 2);
      assertOut(realCommand, 'BLOCKED');
      assertOut(realCommand, 'CLAUDE.md');
      // ④ 既有意图保持：`cp` 只作为被检索文本出现时不构成命令位置（不误判为写命令）
      const notCommand = runHook(['before_tool'], dir, {
        tool_name: 'Bash',
        tool_input: { command: 'grep -n "cp" README.md' },
      });
      assertExit(notCommand, 0);
      assertOut(notCommand, 'workflow-hook-guard-ok');
    },
  },

  // 242: ATX 标题的**闭合标记**（`## 名称 ##`——合法 Markdown）须在段名归一中被剥离。
  // 不剥离时段名归一为 `名称 ##`，与模板段名不等 → 七段全判缺失 → INIT-VALIDATE-FAILED，
  // 依赖 CONTEXT 结构校验的流程被误阻断（记录扫描时间的正常路径走不通）。
  // 与场景 90（同夹具、无闭合标记）成对：唯一变量就是闭合标记本身。
  {
    name: '242 CONTEXT 段标题带 ATX 闭合标记 → 段存在判定通过（INIT-DONE）',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', [
        '# CONTEXT',
        '## 项目概要 ##', 'x',
        '## 技术栈 ##', 'x',
        '## 域语言 ##', '| 术语 | 定义 |', '|---|---|', '| 例 | 定义 |',
        '## 已锁决策 ##', '- [2026-08-01] 决策一',
        '## 默认偏好 ##', 'x',
        '## 既有抽象索引 ##', 'x',
        '## intel-scan 元数据 ##', '- **last_intel_scan**: x', '- **scanner**: x', '- **下次重扫建议**: x',
        '',
      ].join('\n'));
      writeFile(dir, 'package.json', '{"name":"x"}');
      const res = runState(['init', CHANGE_ID, '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(res, 0);
      assertOut(res, 'INIT-DONE');
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!st.last_intel_scan) throw new Error('闭合标记形态应通过段存在判定并写 last_intel_scan');
      // ② 闭合标记须**前置空白**（CommonMark 语义）：`## 项目概要#` 不是闭合形态，段名即
      //    `项目概要#`——它不得被剥成 `项目概要`（否则缺段被假判为存在）。这条边界锁住剥离
      //    范围：将来把前置空白放宽成「任意位置」，此处即变红。
      writeFile(dir, '.specs/CONTEXT.md', [
        '# CONTEXT',
        '## 项目概要#', 'x',
        '## 技术栈 ##', 'x',
        '## 域语言 ##', '| 术语 | 定义 |', '|---|---|', '| 例 | 定义 |',
        '## 已锁决策 ##', '- [2026-08-01] 决策一',
        '## 默认偏好 ##', 'x',
        '## 既有抽象索引 ##', 'x',
        '## intel-scan 元数据 ##', '- **last_intel_scan**: x', '- **scanner**: x', '- **下次重扫建议**: x',
        '',
      ].join('\n'));
      const boundary = runState(['init', CHANGE_ID + '-2', '--init-context'], dir, { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') });
      assertExit(boundary, 0);
      assertOut(boundary, 'INIT-VALIDATE-FAILED');
      assertOut(boundary, '项目概要');
    },
  },

  // 243: `.gitignore` 读取的**访问类故障**（非「确实不存在」）不得当作「文件缺失」。
  // 当作缺失时 existing='' 且 fileExists=false → 后续 writeFileSync 用默认 flag 'w' 把用户既有
  // .gitignore **截断**为仅含受管条目（数据破坏）；而该调用的自述契约是「失败即中止，可重跑自愈」。
  // 修复后访问类故障原样抛出 → 安装中止且用户文件逐字节不变（与 lstatIfExists 同语义）。
  // 故障注入用 `--require` 预加载（同场景 233 手法），只命中该项目的 .gitignore，其余读取走真实实现。
  {
    name: '243 .gitignore 读取访问类故障 → 中止安装且用户文件不被改写',
    run: (dir) => {
      if (!fs.existsSync(PREPARE_ENV)) return;
      const proj = path.join(dir, 'proj-gitignore-fault');
      fs.mkdirSync(proj, { recursive: true });
      const initial = '# 用户既有内容\nnode_modules/\ndist/\n';
      fs.writeFileSync(path.join(proj, '.gitignore'), initial, 'utf8');
      const preloadName = 'gitignore-read-fault-preload.cjs';
      writeFile(dir, preloadName, [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const target = path.resolve(String(process.env.GITIGNORE_FAULT_TARGET || ''));",
        'const realReadFileSync = fs.readFileSync;',
        'fs.readFileSync = function (file, ...rest) {',
        "  if (target !== '' && path.resolve(String(file)) === target) {",
        "    const error = new Error('EACCES: permission denied, open ' + JSON.stringify(String(file)));",
        "    error.code = 'EACCES';",
        '    throw error;',
        '  }',
        '  return realReadFileSync.call(fs, file, ...rest);',
        '};',
        '',
      ].join('\n'));
      const spawned = spawnSync(
        process.execPath,
        ['--require', path.join(dir, preloadName), PREPARE_ENV, '--target', proj, '--platform', 'claude-code'],
        {
          cwd: dir,
          env: { ...process.env, GITIGNORE_FAULT_TARGET: path.join(proj, '.gitignore') },
          encoding: 'utf8',
          timeout: 120000,
        },
      );
      const res = { status: spawned.status ?? 1, output: String(spawned.stdout || '') + String(spawned.stderr || '') };
      const after = fs.readFileSync(path.join(proj, '.gitignore'), 'utf8');
      if (after !== initial) {
        throw new Error('访问类故障下用户 .gitignore 被改写（应原样保留）:\n' + JSON.stringify({ initial, after }, null, 2));
      }
      if (res.status === 0) throw new Error('读取访问类故障应中止安装（exit 非 0），实际 exit 0\n' + res.output);
      assertOut(res, 'EACCES');
    },
  },

  // 244: 维护文档机检（docs-governance）——docs/internal 死引用 + ROADMAP 最低结构。
  // 判别力四类：正例（干净夹具通过）/ 反例（死引用必须报告且含来源与目标）/
  // 越界（ROADMAP 缺段必须报告）/ 恢复（修复后通过）；另锁「整组缺席即跳过」语义。
  {
    name: '244 维护文档机检：docs/internal 死引用与 ROADMAP 结构（docs-governance）',
    run: (dir) => {
      writeFile(dir, 'docs/internal/ROADMAP.md', '# 路线图\n\n## Now\n\n## Next\n\n## Later\n\n## Open decisions\n');
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/ROADMAP.md` 与 `docs/internal/missing-file.md`。\n');
      const problems = internalDocsProblems(dir);
      if (!problems.some((p) => p.includes('FIXTURE.md:1') && p.includes('missing-file.md'))) {
        throw new Error('死引用未被报告（或未带行号）: ' + JSON.stringify(problems));
      }
      if (!problems.some((p) => p.includes('死引用')) || problems.length !== 1) {
        throw new Error('死引用判定应恰好 1 条（合法引用不得误报）: ' + JSON.stringify(problems));
      }
      // 覆盖：.specs/adr 目标面 + allowlist 分支（未来路径不得被报）
      writeFile(dir, '.specs/adr/ADR-FIXTURE.md', '见 `docs/internal/missing-adr-target.md` 与 `.specs/archive/CONTEXT-history.md`。\n');
      const adrProblems = internalDocsProblems(dir);
      if (!adrProblems.some((p) => p.includes('ADR-FIXTURE.md') && p.includes('missing-adr-target.md'))) {
        throw new Error('adr 面死引用未被报告: ' + JSON.stringify(adrProblems));
      }
      if (adrProblems.some((p) => p.includes('CONTEXT-history.md'))) {
        throw new Error('allowlist 未来路径被误报: ' + JSON.stringify(adrProblems));
      }
      fs.rmSync(path.join(dir, '.specs', 'adr', 'ADR-FIXTURE.md'));
      // 恢复：修好引用 → 通过
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/ROADMAP.md`。\n');
      if (internalDocsProblems(dir).length !== 0) {
        throw new Error('修复后应通过: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      // 越界：删段 → 结构问题必须报告
      writeFile(dir, 'docs/internal/ROADMAP.md', '# 路线图\n\n## Now\n## Next\n## Later\n');
      const structProblems = internalDocsProblems(dir);
      if (!structProblems.some((p) => p.includes('Open decisions'))) {
        throw new Error('ROADMAP 缺段未被报告: ' + JSON.stringify(structProblems));
      }
      // 整组缺席（CI / worktree 形态）→ 跳过，不误红
      fs.rmSync(path.join(dir, 'docs/internal'), { recursive: true, force: true });
      if (internalDocsProblems(dir).length !== 0) {
        throw new Error('组目录缺席时应跳过: ' + JSON.stringify(internalDocsProblems(dir)));
      }
    },
  },

  // 245: Fix 回退态共享判定（共享判定 / AC-1 基础谓词）——正例：review / verify 驻留 + TASK 存在
  // pending 任务 + resolveNextNode(completedNodes) === execute；反例三类：非源节点驻留 /
  // 无 pending 任务（路由仍回 execute，证明 pending 是独立条件）/ 路由不回 execute（前置产物缺失）。
  {
    name: '245 resolveFixRollbackState：源节点 + pending 串/并行 → 目标节点（路由/完成态反例）',
    run: async (dir) => {
      const isRollback = requireRouteNodeExport('resolveFixRollbackState');
      const protocol = readScenarioProtocol(dir);
      const completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      const pendingTasks = '# TASK\n\n' + fixTaskBlock('T01', 'pending') + '\n';
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', pendingTasks);
      const baseArgs = { runRoot: dir, changeName: CHANGE_ID, protocol, completedNodes };
      // 夹具前提：该 completedNodes 下共享路由确实推导回 execute（谓词第三条件成立）
      if ((await routeNodeModule.resolveNextNode(baseArgs)) !== 'execute') {
        throw new Error('夹具前提失效：串行 pending 任务在场时 resolveNextNode 应推导 execute');
      }
      const fromReview = await isRollback({ ...baseArgs, currentNode: 'review' });
      if (fromReview !== 'execute') {
        throw new Error('review 驻留 + 串行 pending 应归位 execute，实际 ' + JSON.stringify(fromReview));
      }
      const fromVerify = await isRollback({ ...baseArgs, currentNode: 'verify' });
      if (fromVerify !== 'execute') {
        throw new Error('verify 驻留 + 串行 pending 应归位 execute，实际 ' + JSON.stringify(fromVerify));
      }
      // pending 并行（依赖已满足）：共享路由推 subagent-execute → 目标节点为 subagent-execute
      // （并行修复任务同样必须归位到 execute 家族，不得因节点 id 差异绕过闭环）。
      const parallelPending = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n'
        + '<task id="P-FIX-01" parallel="true" status="pending">'
        + '<action>实现 P-FIX-01</action><write_files>src/p-fix-01.mjs</write_files>'
        + '<verify>node --check src/p-fix-01.mjs</verify></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', parallelPending);
      if ((await routeNodeModule.resolveNextNode(baseArgs)) !== 'subagent-execute') {
        throw new Error('夹具前提失效：可委托 parallel pending 在场时 resolveNextNode 应推导 subagent-execute');
      }
      const parallelReview = await isRollback({ ...baseArgs, currentNode: 'review' });
      if (parallelReview !== 'subagent-execute') {
        throw new Error('review 驻留 + 并行 pending 应归位 subagent-execute，实际 ' + JSON.stringify(parallelReview));
      }
      const parallelVerify = await isRollback({ ...baseArgs, currentNode: 'verify' });
      if (parallelVerify !== 'subagent-execute') {
        throw new Error('verify 驻留 + 并行 pending 应归位 subagent-execute，实际 ' + JSON.stringify(parallelVerify));
      }
      // 反例①：非 review/verify 驻留（pending 与路由条件仍成立）→ null
      const fromExecute = await isRollback({ ...baseArgs, currentNode: 'execute' });
      if (fromExecute !== null) {
        throw new Error('非源节点驻留应为 null，实际 ' + JSON.stringify(fromExecute));
      }
      // 反例②：无 pending（全 done 但缺 SUMMARY 与出口事件）→ 无闭合信号 → null
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n');
      if ((await routeNodeModule.resolveNextNode(baseArgs)) !== 'execute') {
        throw new Error('夹具前提失效：全 done 且缺 SUMMARY 时 resolveNextNode 应仍推导 execute');
      }
      const noPending = await isRollback({ ...baseArgs, currentNode: 'review' });
      if (noPending !== null) {
        throw new Error('无 pending 且无出口事件应为 null，实际 ' + JSON.stringify(noPending));
      }
      // 反例③：pending 在场但前置产物缺失 → 路由退回 design（非 execute 家族）→ null
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', pendingTasks);
      fs.rmSync(path.join(dir, '.specs', CHANGE_ID, 'DESIGN.md'));
      if ((await routeNodeModule.resolveNextNode(baseArgs)) !== 'design') {
        throw new Error('夹具前提失效：DESIGN.md 缺失时 resolveNextNode 应推导 design');
      }
      const notExecute = await isRollback({ ...baseArgs, currentNode: 'review' });
      if (notExecute !== null) {
        throw new Error('路由不回 execute 家族时应为 null，实际 ' + JSON.stringify(notExecute));
      }
      // 反例④：history 最新 execute 出口事件属于另一个 change（state.history 跨 change 保留）
      // → 不得当作当前 change 的闭合签名（否则 change A 的修复签名会误拦 change B 的源节点出口）。
      writeFile(dir, '.specs/' + CHANGE_ID + '/DESIGN.md',
        '# DESIGN\n\n## 0. 技术栈\n\nNode\n\n## 决策清单\n\n| # | D | R |\n|---|---|---|\n| D1 | x | y |');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n');
      const crossChange = await isRollback({
        ...baseArgs,
        currentNode: 'review',
        history: [{
          event: 'exit-applied', node: 'execute', change: 'other-change',
          at: '2026-09-20T00:00:00.000Z', taskSetSignature: '0'.repeat(64),
        }],
      });
      if (crossChange !== null) {
        throw new Error('其它 change 的出口签名不得判定当前 change 未闭合（应为 null），实际 ' + JSON.stringify(crossChange));
      }
      // done-but-unclosed：任务全 done + execute 家族已在 completedNodes + 最新家族出口签名过时
      // → 返回该出口事件记录的家族节点（execute / subagent-execute 均可作为归位目标）。
      const staleFamilyEvent = (node) => ({
        event: 'exit-applied', node, at: '2026-09-21T00:00:00.000Z',
        taskSetSignature: STALE_FIX_BATCH_SIGNATURE,
      });
      const doneFamily = await isRollback({
        ...baseArgs, currentNode: 'review', history: [staleFamilyEvent('subagent-execute')],
      });
      if (doneFamily !== 'subagent-execute') {
        throw new Error('全 done + 家族出口签名过时（subagent-execute）应归位 subagent-execute，实际 ' + JSON.stringify(doneFamily));
      }
      const doneExecute = await isRollback({
        ...baseArgs, currentNode: 'verify', history: [staleFamilyEvent('execute')],
      });
      if (doneExecute !== 'execute') {
        throw new Error('全 done + 家族出口签名过时（execute）应归位 execute，实际 ' + JSON.stringify(doneExecute));
      }
      // completedNodes 只要求家族中至少一个：execute 缺席、subagent-execute 在场同样成立。
      const doneOtherFamily = await isRollback({
        ...baseArgs,
        completedNodes: ['open', 'design', 'plan', 'subagent-execute'],
        currentNode: 'review',
        history: [staleFamilyEvent('subagent-execute')],
      });
      if (doneOtherFamily !== 'subagent-execute') {
        throw new Error('completedNodes 含 subagent-execute（execute 缺席）时应归位 subagent-execute，实际 ' + JSON.stringify(doneOtherFamily));
      }
      // 最新家族出口签名与当前任务集一致 → 本批已闭合 → null（不得反复回退）。
      const currentSignature = await routeNodeModule.taskSetSignature(
        fs.readFileSync(path.join(dir, '.specs', CHANGE_ID, 'TASK.md'), 'utf8'));
      const closed = await isRollback({
        ...baseArgs,
        currentNode: 'review',
        history: [{
          event: 'exit-applied', node: 'subagent-execute',
          at: '2026-09-22T00:00:00.000Z', taskSetSignature: currentSignature,
        }],
      });
      if (closed !== null) {
        throw new Error('出口签名与当前任务集一致时应为 null（已闭合），实际 ' + JSON.stringify(closed));
      }
    },
  },

  // 246: execute 后第一个未完成节点推导（共享推导基础）——按协议 route 顺序跳过全部
  // execute 家族节点（execute / subagent-execute 均不参与后置推导），返回其后首个未完成
  // 节点：review → verify → archive；协议无 execute 家族 → null（调用方再用 review/verify 收窄）。
  {
    name: '246 firstIncompletePostExecNode：execute 家族后首个未完成节点（review→verify→archive；无 execute 家族→null）',
    run: (dir) => {
      const firstIncomplete = requireRouteNodeExport('firstIncompletePostExecNode');
      const protocol = readScenarioProtocol(dir);
      const pre = ['open', 'design', 'plan'];
      // subagent-execute（execute 家族）未完成不作为后置节点，首个后置节点应为 review
      const review = firstIncomplete({ protocol, completedNodes: [...pre, 'execute'] });
      if (review !== 'review') {
        throw new Error('execute 已完成、subagent-execute 未完成时应为 review，实际 ' + JSON.stringify(review));
      }
      const verify = firstIncomplete({ protocol, completedNodes: [...pre, 'execute', 'subagent-execute', 'review'] });
      if (verify !== 'verify') {
        throw new Error('review 已完成时应为 verify，实际 ' + JSON.stringify(verify));
      }
      const archive = firstIncomplete({ protocol, completedNodes: [...pre, 'execute', 'subagent-execute', 'review', 'verify'] });
      if (archive !== 'archive') {
        throw new Error('review/verify 均已完成时应为 archive，实际 ' + JSON.stringify(archive));
      }
      const noExecuteFamily = firstIncomplete({ protocol: { nodes: [{ id: 'alpha' }, { id: 'beta' }] }, completedNodes: [] });
      if (noExecuteFamily !== null) {
        throw new Error('协议无 execute 家族时应为 null，实际 ' + JSON.stringify(noExecuteFamily));
      }
    },
  },

  // 247: Fix 回程节点推导（共享推导基础）——TASK 全 done → 取 execute 后首个未完成节点，
  // 仅 review/verify 可作回程源（archive / 完成态 → null）；仍有 pending / TASK 缺失 /
  // 零任务块一律 null（fail-closed，不许用半解析结果回程）。
  {
    name: '247 resolveFixReturnNode：全 done 且源节点未完成 → 源节点；否则 null（pending/缺失/零任务块）+ classifyFixReturnCause 基础锚',
    run: async (dir) => {
      const fixReturn = requireRouteNodeExport('resolveFixReturnNode');
      const protocol = readScenarioProtocol(dir);
      const completedNodes = ['open', 'design', 'plan', 'execute'];
      writeIntakeArtifacts(dir);
      const taskPath = path.join(dir, '.specs', CHANGE_ID, 'TASK.md');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n' + fixTaskBlock('T02', 'done') + '\n');
      const baseArgs = { runRoot: dir, changeName: CHANGE_ID, protocol, completedNodes };
      const sourceReview = await fixReturn(baseArgs);
      if (sourceReview !== 'review') {
        throw new Error('review 未完成、任务全 done 时应为 review，实际 ' + JSON.stringify(sourceReview));
      }
      const sourceVerify = await fixReturn({ ...baseArgs, completedNodes: [...completedNodes, 'subagent-execute', 'review'] });
      if (sourceVerify !== 'verify') {
        throw new Error('review 已完成、verify 未完成时应为 verify，实际 ' + JSON.stringify(sourceVerify));
      }
      const pastSources = await fixReturn({ ...baseArgs, completedNodes: [...completedNodes, 'subagent-execute', 'review', 'verify'] });
      if (pastSources !== null) {
        throw new Error('review/verify 均已完成（首个未完成为 archive）时应为 null，实际 ' + JSON.stringify(pastSources));
      }
      // 反例：仍有 pending 任务 → null（即使 resolveNextNode 会推导回 execute）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n' + fixTaskBlock('T02', 'pending') + '\n');
      const stillPending = await fixReturn(baseArgs);
      if (stillPending !== null) {
        throw new Error('仍有 pending 任务时应为 null，实际 ' + JSON.stringify(stillPending));
      }
      // 反例：TASK.md 缺失 → null
      fs.rmSync(taskPath);
      const missingTask = await fixReturn(baseArgs);
      if (missingTask !== null) {
        throw new Error('TASK.md 缺失时应为 null，实际 ' + JSON.stringify(missingTask));
      }
      // 反例：零任务块（仅占位）→ null
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<!-- 占位 -->\n');
      const noBlocks = await fixReturn(baseArgs);
      if (noBlocks !== null) {
        throw new Error('零任务块时应为 null，实际 ' + JSON.stringify(noBlocks));
      }

      // ——classifyFixReturnCause 基础锚（T01：历史签名全量发散 + Fix 结构标记 + unknown 回退）——
      // 分类器缺失时在此显式 RED（requireRouteNodeExport），不做半成品静默通过。
      const classifyCause = requireRouteNodeExport('classifyFixReturnCause');
      const signatureOf = (text) => routeNodeModule.taskSetSignature(text);
      const familyExit = (node, signature, extra = {}) => ({
        event: 'exit-applied', node, at: '2026-09-24T00:00:00.000Z',
        taskSetSignature: signature, ...extra,
      });
      const plainTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n';
      const plainSignature = signatureOf(plainTaskText);
      const divergentSignature = '0'.repeat(64);
      // ① 签名发散：历史任一出口签名 ≠ 当前任务集签名 → fix（无 Fix 标记也成立）
      const divergence = classifyCause({
        history: [familyExit('execute', divergentSignature)],
        changeName: CHANGE_ID, taskContent: plainTaskText, fixSectionTitle: 'Fix 任务',
      });
      if (divergence !== 'fix') {
        throw new Error('历史签名全量发散应判 fix，实际 ' + JSON.stringify(divergence));
      }
      // ② 签名相等：唯一出口签名 == 当前 TASK 签名且无 Fix 标记 → normal
      const equalCause = classifyCause({
        history: [familyExit('subagent-execute', plainSignature)],
        changeName: CHANGE_ID, taskContent: plainTaskText, fixSectionTitle: 'Fix 任务',
      });
      if (equalCause !== 'normal') {
        throw new Error('签名一致且无 Fix 标记应判 normal，实际 ' + JSON.stringify(equalCause));
      }
      // ③ 无签名事件：空串签名 / history 缺席 / 非家族节点 / 其它 change → unknown（都不误判 normal）
      const emptySignature = classifyCause({
        history: [familyExit('execute', '')],
        changeName: CHANGE_ID, taskContent: plainTaskText, fixSectionTitle: 'Fix 任务',
      });
      if (emptySignature !== 'unknown') {
        throw new Error('空签名事件应判 unknown，实际 ' + JSON.stringify(emptySignature));
      }
      const missingHistory = classifyCause({ taskContent: plainTaskText, fixSectionTitle: 'Fix 任务' });
      if (missingHistory !== 'unknown') {
        throw new Error('history 缺席应判 unknown，实际 ' + JSON.stringify(missingHistory));
      }
      const otherChangeOnly = classifyCause({
        history: [familyExit('execute', divergentSignature, { change: 'other-change' })],
        changeName: CHANGE_ID, taskContent: plainTaskText, fixSectionTitle: 'Fix 任务',
      });
      if (otherChangeOnly !== 'unknown') {
        throw new Error('其它 change 的出口事件不得参与分类（应为 unknown），实际 ' + JSON.stringify(otherChangeOnly));
      }
      const nonFamilyOnly = classifyCause({
        history: [familyExit('review', divergentSignature)],
        changeName: CHANGE_ID, taskContent: plainTaskText, fixSectionTitle: 'Fix 任务',
      });
      if (nonFamilyOnly !== 'unknown') {
        throw new Error('非 execute 家族出口事件不得参与分类（应为 unknown），实际 ' + JSON.stringify(nonFamilyOnly));
      }
      // ④ Fix 段内任务块（故意用非 FIX 编号 T02，排除全文编号规则干扰）→ fix（结构标记）
      const fixSectionWithTask = plainTaskText
        + '\n## Fix 任务（来自 REVIEW / INTEGRATION）\n\n' + fixTaskBlock('T02', 'done') + '\n';
      const sectionMarker = classifyCause({
        history: [familyExit('execute', signatureOf(fixSectionWithTask))],
        changeName: CHANGE_ID, taskContent: fixSectionWithTask, fixSectionTitle: 'Fix 任务',
      });
      if (sectionMarker !== 'fix') {
        throw new Error('Fix 段内含 task 块应判 fix，实际 ' + JSON.stringify(sectionMarker));
      }
      // ⑤ Fix 段无任务（仅标题与占位）→ normal（切片边界正确、不把其它段标题误当 Fix 段）
      const fixSectionEmpty = plainTaskText + '\n## Fix 任务（来自 REVIEW / INTEGRATION）\n\n<!-- 占位 -->\n';
      const emptySection = classifyCause({
        history: [familyExit('execute', signatureOf(fixSectionEmpty))],
        changeName: CHANGE_ID, taskContent: fixSectionEmpty, fixSectionTitle: 'Fix 任务',
      });
      if (emptySection !== 'normal') {
        throw new Error('Fix 段无任务块应判 normal，实际 ' + JSON.stringify(emptySection));
      }
      // ⑥ 全文任务 id 修复任务编号前缀（Fix 段之外、文件尾追加形态）→ fix
      const tailTFix = plainTaskText + '\n## 其它\n\n' + fixTaskBlock('T-FIX-01', 'done') + '\n';
      const tailPFix = plainTaskText + '\n## 其它\n\n' + fixTaskBlock('P-FIX-01', 'done') + '\n';
      for (const [label, text] of [['T-FIX-01', tailTFix], ['P-FIX-01', tailPFix]]) {
        const idMarker = classifyCause({
          history: [familyExit('execute', signatureOf(text))],
          changeName: CHANGE_ID, taskContent: text, fixSectionTitle: 'Fix 任务',
        });
        if (idMarker !== 'fix') {
          throw new Error(label + ' 编号（Fix 段外）应判 fix，实际 ' + JSON.stringify(idMarker));
        }
      }
      // ⑦ 标题缺失回退：fixSectionTitle 缺席 / 空串 → 回退内置「Fix 任务」仍命中结构标记；
      //    传入标题优先于内置（Fix 段在场但传入无关标题，结构规则不命中 → normal）。
      for (const [label, title] of [['缺席', undefined], ['空串', '']]) {
        const fallback = classifyCause({
          history: [familyExit('execute', signatureOf(fixSectionWithTask))],
          changeName: CHANGE_ID, taskContent: fixSectionWithTask, fixSectionTitle: title,
        });
        if (fallback !== 'fix') {
          throw new Error('fixSectionTitle ' + label + ' 应回退内置「Fix 任务」判 fix，实际 ' + JSON.stringify(fallback));
        }
      }
      const customTitlePriority = classifyCause({
        history: [familyExit('execute', signatureOf(fixSectionWithTask))],
        changeName: CHANGE_ID, taskContent: fixSectionWithTask, fixSectionTitle: '修复任务',
      });
      if (customTitlePriority !== 'normal') {
        throw new Error('传入标题应优先于内置（无关标题不得命中 Fix 段）应判 normal，实际 ' + JSON.stringify(customTitlePriority));
      }
      // ⑧ 多波次历史：旧签名 ≠ 当前、最新签名 == 当前 → 全量扫描仍判 fix（只看最新会误判 normal）
      const multiWave = classifyCause({
        history: [
          familyExit('execute', divergentSignature, { at: '2026-09-20T00:00:00.000Z' }),
          familyExit('subagent-execute', plainSignature, { at: '2026-09-24T00:00:00.000Z' }),
        ],
        changeName: CHANGE_ID, taskContent: plainTaskText, fixSectionTitle: 'Fix 任务',
      });
      if (multiWave !== 'fix') {
        throw new Error('多波次历史旧签名发散（最新签名 == 当前）应判 fix（全量扫描），实际 ' + JSON.stringify(multiWave));
      }
      // ⑨ legacy 事件（无 change 字段）与既有 latestExecuteExitEvent 兼容语义一致：参与分类
      const legacyDivergence = classifyCause({
        history: [{ event: 'exit-applied', node: 'execute', at: '2026-09-20T00:00:00.000Z', taskSetSignature: divergentSignature }],
        changeName: CHANGE_ID, taskContent: plainTaskText, fixSectionTitle: 'Fix 任务',
      });
      if (legacyDivergence !== 'fix') {
        throw new Error('无 change 字段的 legacy 出口事件应参与分类（发散 → fix），实际 ' + JSON.stringify(legacyDivergence));
      }
    },
  },

  // 248: entry execute 受控归位（review 源）——Fix 回退态（review 驻留 + TASK pending + 共享谓词
  // 路由 execute）直接 entry execute：currentNode 归位 execute 并写盘 + FIX-BATCH 审计行；
  // 反例无 pending（全 done）→ 谓词 false 不归位（currentNode 保持 review、无审计行）；
  // 边界：execute 尚未在 completedNodes（前序欠账态）但共享谓词成立 → 前置拦截不生效仍归位。
  {
    name: '248 entry execute 受控归位：review 源 Fix 态 → currentNode=execute + 审计行',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const st = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: {
          execute: { summary: 'first pass executed' },
          review: { summary: 'review in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ① 正例：pending Fix 任务在场 → 受控归位 + 审计行 + 真实写盘
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, st);
      const res = runGuard(['entry', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'FIX-BATCH: 受控归位 execute（源节点 review）');
      assertOut(res, 'ENTRY OK: execute');
      let after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('受控归位后 currentNode 应为 execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // ② 反例：无 pending（全 done）→ 不归位（机器字段保持 review；无审计行）
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeState(dir, st);
      const resNoFix = runGuard(['entry', 'execute'], dir);
      assertExit(resNoFix, 0);
      assertNotOut(resNoFix, 'FIX-BATCH');
      after = readScenarioState(dir);
      if (after.currentNode !== 'review') {
        throw new Error('无 pending 时 entry execute 不应归位（currentNode 应保持 review），实际 ' + JSON.stringify(after.currentNode));
      }
      // ③ 边界：execute 不在 completedNodes（欠账态）但共享谓词成立 → 前置拦截不生效，仍受控归位
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, { ...st, completedNodes: ['open', 'design', 'plan'] });
      const resDrift = runGuard(['entry', 'execute'], dir);
      assertExit(resDrift, 0);
      assertOut(resDrift, 'FIX-BATCH: 受控归位 execute（源节点 review）');
      after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('欠账态受控归位后 currentNode 应为 execute，实际 ' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 249: entry execute 受控归位（verify 源）——verify 驻留 + 进行中证据/enteredNodes 在场时，
  // Fix 回退态归位不被进行中保护分支挡回 verify（归位是显式分支）；无 pending 反例不归位。
  {
    name: '249 entry execute 受控归位：verify 源 Fix 态 → currentNode=execute + 审计行（进行中证据不挡）',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const st = {
        activeChange: CHANGE_ID,
        currentNode: 'verify',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify'],
        evidence: {
          execute: { summary: 'first pass executed' },
          review: { summary: 'review complete' },
          verify: { summary: 'verify in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, st);
      const res = runGuard(['entry', 'execute'], dir);
      assertExit(res, 0);
      assertOut(res, 'FIX-BATCH: 受控归位 execute（源节点 verify）');
      let after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('verify 源受控归位后 currentNode 应为 execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // 反例：全 done（无 pending）→ 不归位，currentNode 保持 verify
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeState(dir, st);
      const resNoFix = runGuard(['entry', 'execute'], dir);
      assertExit(resNoFix, 0);
      assertNotOut(resNoFix, 'FIX-BATCH');
      after = readScenarioState(dir);
      if (after.currentNode !== 'verify') {
        throw new Error('无 pending 时 entry execute 不应归位（currentNode 应保持 verify），实际 ' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 250: exit execute --apply Fix 二次完成回源（review 源）——execute 在 exit 前已在
  // completedNodes + TASK 全 done：REVIEW.md 已在场（resolveNextNode 会按产物跳过 review 到
  // verify）但 review 未完成 → 受控回程 review（源节点出口必须真实执行，不被产物存在性跳过）。
  {
    name: '250 exit execute --apply Fix 二次完成：回源 review（REVIEW.md 在场但不按产物跳过）',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\n审查结论已记录；Fix 批次由 execute 完成，待回源重新出口。\n');
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: {
          execute: { summary: 'fix batch executed' },
          'subagent-execute': { summary: 'delegated', handoffResult: handoffFor(['T01', 'T-FIX-01']) },
          review: { summary: 'review in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      });
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertOut(res, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertOut(res, 'NODE: review');
      assertNotOut(res, 'NODE: verify');
      const after = readScenarioState(dir);
      if (after.currentNode !== 'review') {
        throw new Error('Fix 回程后 currentNode 应为 review，实际 ' + JSON.stringify(after.currentNode));
      }
      // 出口事件须带本 change 归属 + 任务集签名（跨 change 保留 history 时按 change 过滤）。
      const lastExit = (after.history || []).filter((e) => e && e.event === 'exit-applied').pop();
      if (!lastExit || lastExit.node !== 'execute' || lastExit.change !== CHANGE_ID
        || typeof lastExit.taskSetSignature !== 'string' || lastExit.taskSetSignature === '') {
        throw new Error('exit execute --apply 应记录带 change 与 taskSetSignature 的出口事件，实际 '
          + JSON.stringify(lastExit));
      }

      // ---------- T02 回程行分类子锚（分类只决定审计行；路由/state 写入零变化） ----------
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const familyEvidence = (taskIds) => ({
        execute: { summary: 'fix batch executed' },
        'subagent-execute': { summary: 'delegated', handoffResult: handoffFor(taskIds) },
        review: { summary: 'review in progress' },
      });
      const baseReturnState = (overrides = {}) => ({
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: familyEvidence(['T01']),
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
        ...overrides,
      });
      const FAMILY_COMPLETED = 'open,design,plan,execute,subagent-execute';
      // 分类不得引入新 state 顶层字段；比对除 currentNode（既有路由覆盖 next）、history
      // （既有出口事件追加）与 status（既有 apply 写 running/completed）之外的字段——其中
      // execute 证据的 completedChecks 由既有 required-skill 自动补齐逻辑写入，同样属
      // 收口前既有行为，故从比对形状中排除。
      const stateKeyShape = (s) => JSON.stringify(Object.keys(s).filter((k) => k !== 'status').sort());
      const routingShape = (s) => JSON.stringify({
        activeChange: s.activeChange,
        completedNodes: s.completedNodes,
        enteredNodes: s.enteredNodes,
        verifyFailures: s.verifyFailures,
        executionMode: s.executionMode,
        directOverride: s.directOverride,
        newChange: s.newChange,
        subagentEvidence: s.evidence['subagent-execute'],
        reviewEvidence: s.evidence.review,
      });

      // 250b 正常多趟最终 exit：无 Fix 任务、历史家族出口签名 == 当前 TASK 签名 → 中性
      // RETURN（正常多趟收尾，非 Fix 回修）；不得出现 FIX-BATCH；NODE/state 与收口前一致。
      const normalTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n';
      const normalSignature = routeNodeModule.taskSetSignature(normalTaskText);
      writeFile(dir, taskPath, normalTaskText);
      writeState(dir, baseReturnState({
        history: [{
          event: 'exit-applied', node: 'subagent-execute', change: CHANGE_ID,
          at: '2026-09-23T00:00:00.000Z', taskSetSignature: normalSignature,
        }],
      }));
      const beforeNormal = readScenarioState(dir);
      const resNormal = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resNormal, 0);
      assertOut(resNormal, 'RETURN: 回源节点 review（execute 出口已完成；正常多趟收尾，非 Fix 回修）');
      assertOut(resNormal, 'NODE: review');
      assertNotOut(resNormal, 'FIX-BATCH');
      assertNotOut(resNormal, 'NODE: verify');
      const afterNormal = readScenarioState(dir);
      if (afterNormal.currentNode !== 'review'
        || afterNormal.completedNodes.join(',') !== FAMILY_COMPLETED
        || stateKeyShape(afterNormal) !== stateKeyShape(beforeNormal)
        || routingShape(afterNormal) !== routingShape(beforeNormal)) {
        throw new Error('正常多趟回程只应改审计行（路由按既有 resolveFixReturnNode 覆盖 next），实际 '
          + JSON.stringify({
            currentNode: afterNormal.currentNode,
            completedNodes: afterNormal.completedNodes,
            keys: stateKeyShape(afterNormal),
            routing: routingShape(afterNormal),
          }));
      }
      const normalExit = (afterNormal.history || []).pop();
      if (!normalExit || normalExit.node !== 'execute' || normalExit.change !== CHANGE_ID
        || normalExit.taskSetSignature !== normalSignature) {
        throw new Error('正常多趟出口事件形状应与既有一致（node/change/taskSetSignature），实际 '
          + JSON.stringify(normalExit));
      }

      // 250c 多波次真实 Fix：历史旧签名 ≠ 当前、最新签名 == 当前（只看最新会漏判）→ 保留
      // FIX-BATCH（全量扫描）；TASK 含修复任务与结构标记。
      const multiWaveTaskText = fixBatchTaskText('done');
      const multiWaveSignature = routeNodeModule.taskSetSignature(multiWaveTaskText);
      writeFile(dir, taskPath, multiWaveTaskText);
      writeState(dir, baseReturnState({
        evidence: familyEvidence(['T01', 'T-FIX-01']),
        history: [
          {
            event: 'exit-applied', node: 'execute', change: CHANGE_ID,
            at: '2026-09-20T00:00:00.000Z', taskSetSignature: STALE_FIX_BATCH_SIGNATURE,
          },
          {
            event: 'exit-applied', node: 'subagent-execute', change: CHANGE_ID,
            at: '2026-09-24T00:00:00.000Z', taskSetSignature: multiWaveSignature,
          },
        ],
      }));
      const resMultiWave = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resMultiWave, 0);
      assertOut(resMultiWave, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertOut(resMultiWave, 'NODE: review');
      assertNotOut(resMultiWave, 'RETURN: 回源节点');

      // 250d 反向构造（L-064）——与 250c 一一对应证明分类依据是历史全量扫描（不是只看
      // 最新）：① 无 Fix 编号任务 + 旧签名 ≠ 当前 + 最新签名 == 当前 → 仍判 fix（发散证据
      // 不依赖结构标记）；② 同任务集仅保留最新（签名 == 当前）→ 必须中性 RETURN。
      const plainTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n';
      const plainSignature = routeNodeModule.taskSetSignature(plainTaskText);
      writeFile(dir, taskPath, plainTaskText);
      writeState(dir, baseReturnState({
        history: [
          {
            event: 'exit-applied', node: 'execute', change: CHANGE_ID,
            at: '2026-09-20T00:00:00.000Z', taskSetSignature: STALE_FIX_BATCH_SIGNATURE,
          },
          {
            event: 'exit-applied', node: 'subagent-execute', change: CHANGE_ID,
            at: '2026-09-24T00:00:00.000Z', taskSetSignature: plainSignature,
          },
        ],
      }));
      const resDivergentPlain = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resDivergentPlain, 0);
      assertOut(resDivergentPlain, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(resDivergentPlain, 'RETURN: 回源节点');
      writeState(dir, baseReturnState({
        history: [{
          event: 'exit-applied', node: 'subagent-execute', change: CHANGE_ID,
          at: '2026-09-24T00:00:00.000Z', taskSetSignature: plainSignature,
        }],
      }));
      const resLatestOnlyEqual = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resLatestOnlyEqual, 0);
      assertOut(resLatestOnlyEqual, 'RETURN: 回源节点 review（execute 出口已完成；正常多趟收尾，非 Fix 回修）');
      assertNotOut(resLatestOnlyEqual, 'FIX-BATCH');

      // 250e 源未 entry 的真实 Fix：修复任务 + enteredNodes 不含源节点 review + 历史无
      // 签名（旧态）→ 结构标记仍恢复 fix 标签，保留 FIX-BATCH；不误判 unknown、不卡死。
      writeFile(dir, taskPath, multiWaveTaskText);
      writeState(dir, baseReturnState({
        evidence: familyEvidence(['T01', 'T-FIX-01']),
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        history: [],
      }));
      const resSourceNotEntered = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resSourceNotEntered, 0);
      assertOut(resSourceNotEntered, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertOut(resSourceNotEntered, 'NODE: review');
      assertNotOut(resSourceNotEntered, 'RETURN: 回源节点');
      assertNotOut(resSourceNotEntered, 'BLOCKED');

      // 250f 旧态无签名无标记：历史家族出口无签名 + 任务集无 Fix 标记 → RETURN 未分类；
      // 不 BLOCK、不出现 FIX-BATCH；NODE/state 与收口前一致（只有审计行变化）。
      writeFile(dir, taskPath, plainTaskText);
      writeState(dir, baseReturnState({
        history: [{
          event: 'exit-applied', node: 'execute', change: CHANGE_ID,
          at: '2026-09-19T00:00:00.000Z',
        }],
      }));
      const beforeUnknown = readScenarioState(dir);
      const resUnknown = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resUnknown, 0);
      assertOut(resUnknown, 'RETURN: 回源节点 review（execute 出口已完成；旧 state 缺闭合/修复证据，未分类）');
      assertOut(resUnknown, 'NODE: review');
      assertNotOut(resUnknown, 'FIX-BATCH');
      assertNotOut(resUnknown, 'BLOCKED');
      const afterUnknown = readScenarioState(dir);
      if (afterUnknown.currentNode !== 'review'
        || afterUnknown.completedNodes.join(',') !== FAMILY_COMPLETED
        || stateKeyShape(afterUnknown) !== stateKeyShape(beforeUnknown)
        || routingShape(afterUnknown) !== routingShape(beforeUnknown)) {
        throw new Error('未分类回程只应改审计行（路由按既有 resolveFixReturnNode 覆盖 next），实际 '
          + JSON.stringify({
            currentNode: afterUnknown.currentNode,
            completedNodes: afterUnknown.completedNodes,
            keys: stateKeyShape(afterUnknown),
            routing: routingShape(afterUnknown),
          }));
      }

      // 250g Fix 段标题从 flow-kit/templates/TASK.md 派生（决策 4）：模板段名含括号说明 +
      // 段内非 FIX 编号任务 → 结构标记命中 fix（模板读取路径真实被执行；标题由模板派生）。
      writeFile(dir, 'flow-kit/templates/TASK.md',
        '# TASK 模板\n\n## Fix 任务（来自 REVIEW / INTEGRATION）\n');
      const sectionTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n'
        + '## Fix 任务（来自 REVIEW / INTEGRATION）\n\n' + fixTaskBlock('T02', 'done') + '\n';
      writeFile(dir, taskPath, sectionTaskText);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T02-SUMMARY.md', strictSummary('T02'));
      const sectionSignature = routeNodeModule.taskSetSignature(sectionTaskText);
      writeState(dir, baseReturnState({
        evidence: familyEvidence(['T01', 'T02']),
        history: [{
          event: 'exit-applied', node: 'execute', change: CHANGE_ID,
          at: '2026-09-24T00:00:00.000Z', taskSetSignature: sectionSignature,
        }],
      }));
      const resSection = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resSection, 0);
      assertOut(resSection, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(resSection, 'RETURN: 回源节点');
    },
  },

  // 251: exit execute --apply Fix 二次完成回源（verify 源）——TEST.md/UAT.md 已在场
  // （resolveNextNode 会按产物跳过 verify 去 archive）但 verify 未完成 → 受控回程 verify。
  {
    name: '251 exit execute --apply Fix 二次完成：回源 verify（TEST/UAT 在场但不按产物跳过）',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\n审查结论已记录；待回源 verify 重新出口。\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify'],
        evidence: {
          execute: { summary: 'fix batch executed' },
          'subagent-execute': { summary: 'delegated', handoffResult: handoffFor(['T01', 'T-FIX-01']) },
          review: { summary: 'review complete' },
          verify: { summary: 'verify in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      });
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 0);
      assertOut(res, 'FIX-BATCH: 回源节点 verify（execute 出口已完成）');
      assertOut(res, 'NODE: verify');
      assertNotOut(res, 'NODE: archive');
      const after = readScenarioState(dir);
      if (after.currentNode !== 'verify') {
        throw new Error('Fix 回程后 currentNode 应为 verify，实际 ' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 252: 越界拦截 + 恢复 + 旧 change 渐进——源节点（review/verify）驻留且 TASK 有 pending Fix
  // 任务时直接 exit 源节点收场：新 change BLOCKED 且含恢复指引（不许静默跳过 execute 出口门禁）；
  // 按指引 entry execute 归位 → 完成修复 → exit execute 回源节点可恢复；
  // done-but-unclosed 变体（全任务 done 但本批 execute 出口未重跑：history 最新 exit execute
  // 签名与当前任务集不等）同样 BLOCKED 且 state 零改写，闭合后源节点出口恢复通过；
  // 旧 change（无 newChange 标记）保持渐进 WARN 不阻断（向后兼容）。
  {
    name: '252 越界：源节点 + pending/done-but-unclosed Fix 直接 exit 源节点 BLOCK（新）/WARN（旧）+ 恢复闭环',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\n审查发现需修复项，Fix 任务已追加；待 execute 出口完成后重新出口。\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      const reviewState = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: {
          execute: { summary: 'first pass executed' },
          'subagent-execute': { summary: 'delegated', handoffResult: handoffFor(['T01']) },
          review: { summary: 'review in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ① 新 change：review 源直接 exit review --apply → BLOCKED + 恢复指引（不得静默放行）
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, reviewState);
      const resBlock = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(resBlock, 1);
      assertOut(resBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(resBlock, 'entry execute');
      assertNotOut(resBlock, 'ALL CHECKS PASSED');
      let after = readScenarioState(dir);
      if (after.currentNode !== 'review' || after.completedNodes.includes('review')) {
        throw new Error('BLOCK 不得改写 state（review 未完成/未推进），实际 '
          + JSON.stringify({ currentNode: after.currentNode, completedNodes: after.completedNodes }));
      }
      // ② 恢复：entry execute 受控归位 → 完成 Fix 任务并补 SUMMARY/handoff → exit execute 回源 review
      const recEntry = runGuard(['entry', 'execute'], dir);
      assertExit(recEntry, 0);
      assertOut(recEntry, 'FIX-BATCH: 受控归位 execute（源节点 review）');
      after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('恢复步 entry execute 应归位 execute，实际 ' + JSON.stringify(after.currentNode));
      }
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      after = readScenarioState(dir);
      after.evidence['subagent-execute'] = after.evidence['subagent-execute'] || {};
      after.evidence['subagent-execute'].handoffResult = {
        ...(after.evidence['subagent-execute'].handoffResult || {}),
        ...handoffFor(['T-FIX-01']),
      };
      writeState(dir, after);
      const recExit = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(recExit, 0);
      assertOut(recExit, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      if (readScenarioState(dir).currentNode !== 'review') {
        throw new Error('恢复闭环 exit execute 后应回源 review，实际 ' + JSON.stringify(readScenarioState(dir).currentNode));
      }
      // ③ 新 change：verify 源 + TEST/UAT 产物在场（原路径会跳过 verify 去 archive）→ 同样 BLOCKED
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```bash\nnode -e "1"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, {
        ...reviewState,
        currentNode: 'verify',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify'],
        evidence: { ...reviewState.evidence, verify: { summary: 'verify in progress' } },
      });
      const resVerifyBlock = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(resVerifyBlock, 1);
      assertOut(resVerifyBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(resVerifyBlock, 'entry execute');
      assertNotOut(resVerifyBlock, 'ALL CHECKS PASSED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'verify' || after.completedNodes.includes('verify')) {
        throw new Error('verify 源 BLOCK 不得改写 state，实际 '
          + JSON.stringify({ currentNode: after.currentNode, completedNodes: after.completedNodes }));
      }
      // ③b 越界恢复指引优先于通用 entry 提示：同路径但无 enter 痕迹（enteredNodes 缺失）
      // 仍须给 Fix 恢复指引（不得被「未执行 entry 直接 exit」通用提示覆盖）。
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, { ...reviewState, enteredNodes: [] });
      const resNoEntryBlock = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(resNoEntryBlock, 1);
      assertOut(resNoEntryBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNotOut(resNoEntryBlock, '未执行 entry 直接 exit');
      // ③c 新 change done-but-unclosed（review 源）：Fix 任务已 done，但 history 最新 exit
      // execute 签名仍是追加前值（本批 execute 出口从未重跑）→ 必须 BLOCKED 且 state 字节零
      // 改写（修复前此路径静默放行为 NODE: verify / archive）。
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeState(dir, { ...reviewState, history: fixBatchHistoryWithStaleExecuteExit() });
      const staleReviewBytes = fs.readFileSync(statePath, 'utf8');
      const resDoneBlock = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(resDoneBlock, 1);
      assertOut(resDoneBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(resDoneBlock, 'entry execute');
      assertOut(resDoneBlock, 'workflow-state.mjs next');
      assertOut(resDoneBlock, '恢复');
      assertNotOut(resDoneBlock, 'ALL CHECKS PASSED');
      if (fs.readFileSync(statePath, 'utf8') !== staleReviewBytes) {
        throw new Error('done-but-unclosed BLOCK 不得改写 state 字节');
      }
      // ③c-2 恢复闭环：entry execute 归位 → 补 handoff → exit execute --apply 写当前签名 →
      // 回源 review → exit review 通过（闭合后 done 变体不再拦截）。
      const recDoneEntry = runGuard(['entry', 'execute'], dir);
      assertExit(recDoneEntry, 0);
      assertOut(recDoneEntry, 'FIX-BATCH: 受控归位 execute（源节点 review）');
      after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('done-but-unclosed 恢复步 entry execute 应归位 execute，实际 ' + JSON.stringify(after.currentNode));
      }
      after.evidence['subagent-execute'] = after.evidence['subagent-execute'] || {};
      after.evidence['subagent-execute'].handoffResult = {
        ...(after.evidence['subagent-execute'].handoffResult || {}),
        ...handoffFor(['T-FIX-01']),
      };
      writeState(dir, after);
      assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      const recDoneExit = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(recDoneExit, 0);
      assertOut(recDoneExit, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertOut(recDoneExit, 'NODE: review');
      assertExit(runState(['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'review'], dir), 0);
      const recDoneReview = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(recDoneReview, 0);
      assertOut(recDoneReview, 'ALL CHECKS PASSED');
      assertNotOut(recDoneReview, 'BLOCKED');
      // ③d 新 change done-but-unclosed（verify 源）：TEST/UAT 在场（原路径会跳过 verify 去
      // archive）+ 全 Fix 任务 done + 最新 exit execute 签名过时 → BLOCKED，验证命令未执行，
      // state 字节零改写；闭合后 exit verify 真实执行验证命令并推进 archive。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md',
        '# TEST\n\n## 验证命令\n\n```\nnode -e "require(\'fs\').writeFileSync(\'verify-gate-ran.txt\', \'GATE-RAN\')"\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
      const gateMarker = path.join(dir, 'verify-gate-ran.txt');
      fs.rmSync(gateMarker, { force: true });
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeState(dir, {
        ...reviewState,
        currentNode: 'verify',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify'],
        evidence: { ...reviewState.evidence, review: { summary: 'review complete' }, verify: { summary: 'verify in progress' } },
        history: fixBatchHistoryWithStaleExecuteExit(),
      });
      const staleVerifyBytes = fs.readFileSync(statePath, 'utf8');
      const resDoneVerifyBlock = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(resDoneVerifyBlock, 1);
      assertOut(resDoneVerifyBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertOut(resDoneVerifyBlock, 'entry execute');
      assertNotOut(resDoneVerifyBlock, 'ALL CHECKS PASSED');
      if (fs.existsSync(gateMarker)) throw new Error('done-but-unclosed verify BLOCK 不得执行验证命令');
      if (fs.readFileSync(statePath, 'utf8') !== staleVerifyBytes) {
        throw new Error('done-but-unclosed verify BLOCK 不得改写 state 字节');
      }
      const recDoneVerifyEntry = runGuard(['entry', 'execute'], dir);
      assertExit(recDoneVerifyEntry, 0);
      assertOut(recDoneVerifyEntry, 'FIX-BATCH: 受控归位 execute（源节点 verify）');
      after = readScenarioState(dir);
      after.evidence['subagent-execute'] = after.evidence['subagent-execute'] || {};
      after.evidence['subagent-execute'].handoffResult = {
        ...(after.evidence['subagent-execute'].handoffResult || {}),
        ...handoffFor(['T-FIX-01']),
      };
      writeState(dir, after);
      assertExit(runState(['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      const recDoneVerifyExit = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(recDoneVerifyExit, 0);
      assertOut(recDoneVerifyExit, 'FIX-BATCH: 回源节点 verify（execute 出口已完成）');
      assertOut(recDoneVerifyExit, 'NODE: verify');
      assertExit(runState(['skill-load', 'verify', 'flow-comet-verify', '--prompt', 'flow-kit/prompts/7-integration.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'verify'], dir), 0);
      const recDoneVerify = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(recDoneVerify, 0);
      assertOut(recDoneVerify, 'ALL CHECKS PASSED');
      assertOut(recDoneVerify, 'NODE: archive');
      if (!fs.existsSync(gateMarker) || fs.readFileSync(gateMarker, 'utf8') !== 'GATE-RAN') {
        throw new Error('闭合后 verify 出口未真实执行 TEST.md 验证命令（副作用文件缺失/内容不符）');
      }
      // ④ 旧 change（无 newChange 标记）pending 同路径：渐进 WARN 不阻断（向后兼容）
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, { ...reviewState, newChange: false });
      const resOld = runGuard(['exit', 'review'], dir);
      assertExit(resOld, 0);
      assertOut(resOld, 'FIX-BATCH WARN');
      assertOut(resOld, 'ALL CHECKS PASSED');
      // ④b 过渡态渐进（feature 之前创建的 state 无 exit execute 签名字段）：全 done 也不得
      // 仅凭「签名缺席」误判未闭合——无签名记录 → done 变体不成立，源节点出口保持可走
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeState(dir, { ...reviewState, history: [{ event: 'exit-applied', node: 'execute', at: '2026-09-19T00:00:00.000Z' }] });
      const resLegacyState = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(resLegacyState, 0);
      assertNotOut(resLegacyState, 'BLOCKED');
      assertOut(resLegacyState, 'ALL CHECKS PASSED');
      // ⑤ 并行 Fix 任务（pending）+ review 源：直接 exit review 仍 BLOCKED；next/entry 归位
      // subagent-execute；修复后 exit subagent-execute --apply 为第二趟完成 → 回源 review，
      // 源节点出口随后真实执行（闭合后不得再拦）。
      writeFile(dir, taskPath, fixBatchParallelTaskText('pending'));
      writeState(dir, reviewState);
      const rParBlock = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(rParBlock, 1);
      assertOut(rParBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNotOut(rParBlock, 'ALL CHECKS PASSED');
      writeState(dir, reviewState);
      const rParNext = runState(['next'], dir, env);
      assertExit(rParNext, 0);
      assertOut(rParNext, 'FIX-BATCH: 归位 subagent-execute（源节点 review）');
      assertOut(rParNext, 'NODE: subagent-execute');
      assertNotOut(rParNext, 'NODE: execute');
      writeState(dir, reviewState);
      const rParEntry = runGuard(['entry', 'subagent-execute'], dir);
      assertExit(rParEntry, 0);
      assertOut(rParEntry, 'FIX-BATCH: 受控归位 subagent-execute（源节点 review）');
      after = readScenarioState(dir);
      if (after.currentNode !== 'subagent-execute') {
        throw new Error('并行回退态 entry subagent-execute 后 currentNode 应为 subagent-execute，实际 ' + JSON.stringify(after.currentNode));
      }
      writeFile(dir, taskPath, fixBatchParallelTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P-FIX-01-SUMMARY.md', strictSummary('P-FIX-01'));
      after.evidence['subagent-execute'] = after.evidence['subagent-execute'] || {};
      after.evidence['subagent-execute'].summary = 'parallel fix delegated and collected';
      after.evidence['subagent-execute'].handoffResult = {
        ...(after.evidence['subagent-execute'].handoffResult || {}),
        ...handoffFor(['P-FIX-01']),
      };
      writeState(dir, after);
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      const rParExit = runGuard(['exit', 'subagent-execute', '--apply'], dir);
      assertExit(rParExit, 0);
      assertOut(rParExit, 'FIX-BATCH: 回源节点 review（subagent-execute 出口已完成）');
      assertOut(rParExit, 'NODE: review');
      after = readScenarioState(dir);
      if (after.currentNode !== 'review') {
        throw new Error('并行修复第二趟出口后应回源 review，实际 ' + JSON.stringify(after.currentNode));
      }
      const parFamilyExit = (after.history || [])
        .filter((e) => e && e.event === 'exit-applied' && e.node === 'subagent-execute').pop();
      if (!parFamilyExit || parFamilyExit.change !== CHANGE_ID
        || typeof parFamilyExit.taskSetSignature !== 'string' || parFamilyExit.taskSetSignature === '') {
        throw new Error('并行修复出口应记录本 change + taskSetSignature 的家族出口事件，实际 ' + JSON.stringify(parFamilyExit));
      }
      assertExit(runState(['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md'], dir, env), 0);
      assertExit(runGuard(['entry', 'review'], dir), 0);
      const rParSource = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(rParSource, 0);
      assertOut(rParSource, 'ALL CHECKS PASSED');
      assertNotOut(rParSource, 'BLOCKED');
      // ⑥ verify 源 + 并行 pending：直接 exit verify 同样 BLOCKED（不得绕过家族生命周期）。
      writeFile(dir, taskPath, fixBatchParallelTaskText('pending'));
      writeState(dir, {
        ...reviewState,
        currentNode: 'verify',
        completedNodes: [...reviewState.completedNodes, 'review'],
        enteredNodes: [...reviewState.enteredNodes, 'verify'],
        evidence: { ...reviewState.evidence, review: { summary: 'review complete' }, verify: { summary: 'verify in progress' } },
      });
      const rParVerifyBlock = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(rParVerifyBlock, 1);
      assertOut(rParVerifyBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNotOut(rParVerifyBlock, 'ALL CHECKS PASSED');
      // ⑦ done-but-unclosed 并行变体：全 done + 最新家族出口事件（subagent-execute）签名过时
      // → 直接 exit review BLOCKED；entry 归位 subagent-execute；第二趟出口写当前签名并回源。
      writeFile(dir, taskPath, fixBatchParallelTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P-FIX-01-SUMMARY.md', strictSummary('P-FIX-01'));
      writeState(dir, { ...reviewState, history: fixBatchHistoryWithStaleFamilyExit('subagent-execute') });
      const rDoneParBlock = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(rDoneParBlock, 1);
      assertOut(rDoneParBlock, 'BLOCKED: 存在未归位/未跑出口的 Fix 批次');
      assertNotOut(rDoneParBlock, 'ALL CHECKS PASSED');
      const rDoneParEntry = runGuard(['entry', 'subagent-execute'], dir);
      assertExit(rDoneParEntry, 0);
      assertOut(rDoneParEntry, 'FIX-BATCH: 受控归位 subagent-execute（源节点 review）');
      after = readScenarioState(dir);
      after.evidence['subagent-execute'] = after.evidence['subagent-execute'] || {};
      after.evidence['subagent-execute'].handoffResult = {
        ...(after.evidence['subagent-execute'].handoffResult || {}),
        ...handoffFor(['P-FIX-01']),
      };
      writeState(dir, after);
      assertExit(runState(['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md'], dir, env), 0);
      const rDoneParExit = runGuard(['exit', 'subagent-execute', '--apply'], dir);
      assertExit(rDoneParExit, 0);
      assertOut(rDoneParExit, 'FIX-BATCH: 回源节点 review（subagent-execute 出口已完成）');
      if (readScenarioState(dir).currentNode !== 'review') {
        throw new Error('done-but-unclosed 并行变体闭合后应回源 review，实际 ' + JSON.stringify(readScenarioState(dir).currentNode));
      }
      // ④c change 隔离：history 最新 exit 事件属于另一个 change（state.history 跨 change 保留）
      // → 不得拿它当本 change 的闭合签名；本 change 无该字段的出口事件，done 变体不成立。
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeState(dir, {
        ...reviewState,
        history: [{
          event: 'exit-applied', node: 'execute', change: 'other-change',
          at: '2026-09-20T00:00:00.000Z', taskSetSignature: STALE_FIX_BATCH_SIGNATURE,
        }],
      });
      const resOtherChange = runGuard(['exit', 'review', '--apply'], dir);
      assertExit(resOtherChange, 0);
      assertNotOut(resOtherChange, 'BLOCKED');
      assertOut(resOtherChange, 'ALL CHECKS PASSED');
    },
  },

  // 253: next Fix 回退态显式归位——源节点（review/verify）驻留 + TASK 有 pending
  // Fix 任务 + 共享路由回 execute 时，next 必须显式归位 execute、写盘并输出审计行，不再依赖
  // inProgress 保护副作用（修复前 next 仍输出源节点）。反例：全 done 无 pending → 不归位；
  // done-but-unclosed（全 done + history 最新 exit execute 签名仍是追加前值）同样必须归位。
  {
    name: '253 next Fix 回退态显式归位：review/verify 源 + 审计行（无 pending 反例不归位；done-but-unclosed 归位）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const base = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
        evidence: {
          execute: { summary: 'first pass executed' },
          review: { summary: 'review in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ① review 源：pending Fix 任务在场 → NODE: execute + 审计行 + 机器字段归位写盘
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, base);
      const resReview = runState(['next'], dir, env);
      assertExit(resReview, 0);
      assertOut(resReview, 'FIX-BATCH: 归位 execute（源节点 review）');
      assertOut(resReview, 'NODE: execute');
      assertNotOut(resReview, 'NODE: review');
      assertNotOut(resReview, 'NODE: verify');
      assertNotOut(resReview, 'BLOCKED');
      let after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('review 源回退态 next 后 currentNode 应为 execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // ② verify 源（review 已完成）→ 同样显式归位 + 审计行 + 写盘
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, {
        ...base,
        currentNode: 'verify',
        completedNodes: [...base.completedNodes, 'review'],
        enteredNodes: [...base.enteredNodes, 'verify'],
        evidence: { ...base.evidence, review: { summary: 'review complete' }, verify: { summary: 'verify in progress' } },
      });
      const resVerify = runState(['next'], dir, env);
      assertExit(resVerify, 0);
      assertOut(resVerify, 'FIX-BATCH: 归位 execute（源节点 verify）');
      assertOut(resVerify, 'NODE: execute');
      assertNotOut(resVerify, 'NODE: verify');
      assertNotOut(resVerify, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('verify 源回退态 next 后 currentNode 应为 execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // ③ 反例：全 done（无 pending Fix 任务）→ 非回退态，不得归位 execute（回程逻辑另行覆盖）
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nFix 批次由 execute 完成，待回源重新出口。\n');
      writeState(dir, base);
      const resNoFix = runState(['next'], dir, env);
      assertExit(resNoFix, 0);
      assertNotOut(resNoFix, 'FIX-BATCH: 归位 execute');
      // ③ 全局缺席：无 pending Fix 任务的回程态，state 侧无 Fix 因果——不得出现任何 FIX-BATCH
      // （含旧「回程源节点」误标形态；回程中性行由 RETURN 覆盖）
      assertNotOut(resNoFix, 'FIX-BATCH');
      assertNotOut(resNoFix, 'NODE: execute');
      assertOut(resNoFix, 'NODE: review');
      after = readScenarioState(dir);
      if (after.currentNode !== 'review') {
        throw new Error('无 pending 时不应归位 execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // ④ done-but-unclosed 回退态（全 done + history 最新 exit execute 签名仍是追加前值）：
      // next 同样显式归位 execute（修复前 done 变体无恢复通道，next 停在源节点）。
      writeState(dir, { ...base, history: fixBatchHistoryWithStaleExecuteExit() });
      const resDoneRollback = runState(['next'], dir, env);
      assertExit(resDoneRollback, 0);
      assertOut(resDoneRollback, 'FIX-BATCH: 归位 execute（源节点 review）');
      assertOut(resDoneRollback, 'NODE: execute');
      assertNotOut(resDoneRollback, 'NODE: review');
      assertNotOut(resDoneRollback, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'execute') {
        throw new Error('done-but-unclosed 回退态 next 后 currentNode 应为 execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // ⑤ review 源 + 并行 pending Fix 任务：next 必须归位 subagent-execute（并行路由目标），
      // 不得停在源节点，也不得错配回 execute。
      writeFile(dir, taskPath, fixBatchParallelTaskText('pending'));
      writeState(dir, base);
      const resParallelReview = runState(['next'], dir, env);
      assertExit(resParallelReview, 0);
      assertOut(resParallelReview, 'FIX-BATCH: 归位 subagent-execute（源节点 review）');
      assertOut(resParallelReview, 'NODE: subagent-execute');
      assertNotOut(resParallelReview, 'NODE: review');
      assertNotOut(resParallelReview, 'NODE: execute');
      assertNotOut(resParallelReview, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'subagent-execute') {
        throw new Error('review 源并行回退态 next 后 currentNode 应为 subagent-execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // ⑥ verify 源 + 并行 pending Fix 任务：同样归位 subagent-execute。
      writeFile(dir, taskPath, fixBatchParallelTaskText('pending'));
      writeState(dir, {
        ...base,
        currentNode: 'verify',
        completedNodes: [...base.completedNodes, 'review'],
        enteredNodes: [...base.enteredNodes, 'verify'],
        evidence: { ...base.evidence, review: { summary: 'review complete' }, verify: { summary: 'verify in progress' } },
      });
      const resParallelVerify = runState(['next'], dir, env);
      assertExit(resParallelVerify, 0);
      assertOut(resParallelVerify, 'FIX-BATCH: 归位 subagent-execute（源节点 verify）');
      assertOut(resParallelVerify, 'NODE: subagent-execute');
      assertNotOut(resParallelVerify, 'NODE: verify');
      assertNotOut(resParallelVerify, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'subagent-execute') {
        throw new Error('verify 源并行回退态 next 后 currentNode 应为 subagent-execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // ⑦ done-but-unclosed 并行变体（全 done + 最新 exit subagent-execute 签名过时）：
      // next 必须按事件记录的家族节点归位 subagent-execute。
      writeFile(dir, taskPath, fixBatchParallelTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P-FIX-01-SUMMARY.md', strictSummary('P-FIX-01'));
      writeState(dir, { ...base, history: fixBatchHistoryWithStaleFamilyExit('subagent-execute') });
      const resDoneParallel = runState(['next'], dir, env);
      assertExit(resDoneParallel, 0);
      assertOut(resDoneParallel, 'FIX-BATCH: 归位 subagent-execute（源节点 review）');
      assertOut(resDoneParallel, 'NODE: subagent-execute');
      assertNotOut(resDoneParallel, 'NODE: execute');
      assertNotOut(resDoneParallel, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'subagent-execute') {
        throw new Error('done-but-unclosed 并行变体 next 后 currentNode 应为 subagent-execute，实际 ' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 254: next Fix 回程豁免（review 源）——exit execute --apply 把 currentNode 推回 review 后，
  // REVIEW.md 已在场会让 resolveNextNode 按产物跳过未出口的 review；next 必须在源节点未完成时
  // 显式放行 review（审计行 + 只读不改写 state），不依赖 inProgress 保护副作用；无 review 证据的
  // 引擎回程态同样放行（修复前缺审计行 / 漂移 verify / 无证据时 BLOCK）。
  {
    name: '254 next Fix 回程豁免：review 源（REVIEW.md 在场不跳过；无 inProgress 证据也不 BLOCK）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nFix 批次由 execute 完成，待回源重新出口。\n');
      const completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      const base = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes,
        enteredNodes: [...completedNodes, 'review'],
        evidence: { execute: { summary: 'fix batch executed' }, review: { summary: 'review in progress' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ① 真实回程态（review 已 entry）→ 审计行 + NODE: review + state 只读不改写
      writeState(dir, base);
      const res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'RETURN: 回程源节点 review');
      assertOut(res, 'NODE: review');
      assertNotOut(res, 'NODE: verify');
      assertNotOut(res, 'BLOCKED');
      let after = readScenarioState(dir);
      if (after.currentNode !== 'review' || after.completedNodes.join(',') !== completedNodes.join(',')) {
        throw new Error('回程豁免不得改写 state，实际 '
          + JSON.stringify({ currentNode: after.currentNode, completedNodes: after.completedNodes }));
      }
      // ② 引擎回程态（review 无 evidence/entered；末位已完成节点证据在场）→ 仍放行 review，不漂移 verify
      writeState(dir, {
        ...base,
        enteredNodes: completedNodes.slice(),
        evidence: { execute: { summary: 'fix batch executed' }, 'subagent-execute': { summary: 'delegated' } },
      });
      const resNoEvidence = runState(['next'], dir, env);
      assertExit(resNoEvidence, 0);
      assertOut(resNoEvidence, 'RETURN: 回程源节点 review');
      assertOut(resNoEvidence, 'NODE: review');
      assertNotOut(resNoEvidence, 'NODE: verify');
      assertNotOut(resNoEvidence, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'review') {
        throw new Error('无 inProgress 证据的回程态 next 后 currentNode 应保持 review，实际 ' + JSON.stringify(after.currentNode));
      }
      // ③ 无任何 evidence 的引擎回程态 → 回程豁免先于「疑似未 exit」门禁，不 BLOCK
      writeState(dir, { ...base, enteredNodes: [], evidence: {} });
      const resNoAnyEvidence = runState(['next'], dir, env);
      assertExit(resNoAnyEvidence, 0);
      assertOut(resNoAnyEvidence, 'RETURN: 回程源节点 review');
      assertOut(resNoAnyEvidence, 'NODE: review');
      assertNotOut(resNoAnyEvidence, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'review') {
        throw new Error('回程豁免不得因证据缺失被门禁改写 currentNode，实际 ' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 255: next Fix 回程豁免（verify 源）——TEST.md + UAT.md 已在场会让 resolveNextNode 按
  // 产物跳过未出口的 verify 去 archive；next 必须显式放行 verify（审计行 + 只读不改写 state）；
  // 无 verify 证据时不得漂移 archive；完全无证据时不得被「疑似未 exit」门禁 BLOCK。
  {
    name: '255 next Fix 回程豁免：verify 源（TEST/UAT 在场不跳过；不漂移 archive/不 BLOCK）',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\nreview passed，待回源 verify 重新出口。\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TEST.md', '# TEST\n\n## 验证命令\n\n```\necho ok\n```\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/UAT.md', '# UAT\n\n## 验收\n\n- 通过\n');
      const completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'];
      const base = {
        activeChange: CHANGE_ID,
        currentNode: 'verify',
        completedNodes,
        enteredNodes: [...completedNodes, 'verify'],
        evidence: {
          execute: { summary: 'fix batch executed' },
          review: { summary: 'review complete' },
          verify: { summary: 'verify in progress' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      };
      // ① 真实回程态（verify 已 entry）→ 审计行 + NODE: verify + state 只读不改写
      writeState(dir, base);
      const res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'RETURN: 回程源节点 verify');
      assertOut(res, 'NODE: verify');
      assertNotOut(res, 'NODE: archive');
      assertNotOut(res, 'BLOCKED');
      let after = readScenarioState(dir);
      if (after.currentNode !== 'verify' || after.completedNodes.join(',') !== completedNodes.join(',')) {
        throw new Error('回程豁免不得改写 state，实际 '
          + JSON.stringify({ currentNode: after.currentNode, completedNodes: after.completedNodes }));
      }
      // ② 引擎回程态（verify 无 evidence/entered；末位已完成节点证据在场）→ 不漂移 archive
      writeState(dir, {
        ...base,
        enteredNodes: completedNodes.slice(),
        evidence: { execute: { summary: 'fix batch executed' }, review: { summary: 'review complete' } },
      });
      const resNoEvidence = runState(['next'], dir, env);
      assertExit(resNoEvidence, 0);
      assertOut(resNoEvidence, 'RETURN: 回程源节点 verify');
      assertOut(resNoEvidence, 'NODE: verify');
      assertNotOut(resNoEvidence, 'NODE: archive');
      assertNotOut(resNoEvidence, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'verify') {
        throw new Error('无 inProgress 证据的回程态 next 后 currentNode 应保持 verify，实际 ' + JSON.stringify(after.currentNode));
      }
      // ③ 无任何 evidence → 回程豁免先于「疑似未 exit」门禁，不 BLOCK
      writeState(dir, { ...base, enteredNodes: [], evidence: {} });
      const resNoAnyEvidence = runState(['next'], dir, env);
      assertExit(resNoAnyEvidence, 0);
      assertOut(resNoAnyEvidence, 'RETURN: 回程源节点 verify');
      assertOut(resNoAnyEvidence, 'NODE: verify');
      assertNotOut(resNoAnyEvidence, 'BLOCKED');
    },
  },

  // 256: 负例回归——正常多趟中间态（execute 已完成 + 依赖已满足的 parallel pending 任务）
  // 必须照常路由 subagent-execute：回退谓词（源节点限制）与回程谓词（任务全 done 限制）都不成立，
  // 不得被 Fix 两态分支误分流到 review/verify，也不得输出 FIX-BATCH 审计行。
  {
    name: '256 负例：正常多趟中间态（execute 已完成 + 可委托 parallel pending）不误分流',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', renderMultiWaveTasks(['T01', 'P01', 'P02', 'T02']));
      for (const id of ['T01', 'P01', 'P02', 'T02']) {
        writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', strictSummary(id));
      }
      const completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      writeState(dir, {
        activeChange: CHANGE_ID,
        currentNode: 'execute',
        completedNodes,
        enteredNodes: completedNodes.slice(),
        evidence: {
          execute: { summary: 'serial wave complete' },
          'subagent-execute': { summary: 'wave 1 delegated and collected' },
        },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        newChange: true,
      });
      const res = runState(['next'], dir, env);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      assertNotOut(res, 'NODE: review');
      assertNotOut(res, 'NODE: verify');
      assertNotOut(res, 'FIX-BATCH');
      assertNotOut(res, 'BLOCKED');
      const after = readScenarioState(dir);
      if (after.currentNode !== 'subagent-execute') {
        throw new Error('正常多趟中间态应路由 subagent-execute，实际 currentNode=' + JSON.stringify(after.currentNode));
      }
    },
  },

  // 257: 旧 change 兼容——无 newChange: true 的回退态与回程态都不新增 BLOCK，
  // 且 NODE 输出与判定正确（回退 → execute；回程 → 源节点）。
  {
    name: '257 旧 change 兼容：无 newChange 的回退/回程态不新增 BLOCK 且 NODE 正确',
    run: (dir) => {
      const env = { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json') };
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      const completedNodes = ['open', 'design', 'plan', 'execute', 'subagent-execute'];
      const oldState = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        completedNodes,
        enteredNodes: [...completedNodes, 'review'],
        evidence: { execute: { summary: 'first pass executed' }, review: { summary: 'review in progress' } },
        verifyFailures: 0,
        executionMode: 'subagent',
        directOverride: false,
        // newChange 缺省/null = 旧 change 渐进形态（newChange 校验只接受 true/缺失/null）
      };
      // ① 旧 change 回退态（pending Fix 任务）→ NODE: execute + 审计行，不得 BLOCK
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, oldState);
      const resRollback = runState(['next'], dir, env);
      assertExit(resRollback, 0);
      assertNotOut(resRollback, 'BLOCKED');
      assertOut(resRollback, 'FIX-BATCH: 归位 execute（源节点 review）');
      assertOut(resRollback, 'NODE: execute');
      if (readScenarioState(dir).currentNode !== 'execute') {
        throw new Error('旧 change 回退态 next 后 currentNode 应为 execute，实际 ' + JSON.stringify(readScenarioState(dir).currentNode));
      }
      // ② 旧 change 回程态（无 newChange 字段：全 done + REVIEW.md + 源节点未完成）→ NODE: review，不得 BLOCK
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\n待回源出口。\n');
      writeState(dir, oldState);
      const resReturn = runState(['next'], dir, env);
      assertExit(resReturn, 0);
      assertNotOut(resReturn, 'BLOCKED');
      assertOut(resReturn, 'RETURN: 回程源节点 review');
      assertOut(resReturn, 'NODE: review');
      assertNotOut(resReturn, 'NODE: verify');
      if (readScenarioState(dir).currentNode !== 'review') {
        throw new Error('旧 change 回程态 next 后 currentNode 应保持 review，实际 ' + JSON.stringify(readScenarioState(dir).currentNode));
      }
      // ③ 旧 change 无签名、无 Fix 标记的回程态（决策 2/3 旧态边界）：state 侧同样只输出中性
      // RETURN 回程行——缺 taskSetSignature、TASK 无 Fix 段/编号 → 不得冒充 FIX-BATCH。
      writeFile(dir, taskPath, '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n');
      writeState(dir, oldState);
      const resReturnNoMarker = runState(['next'], dir, env);
      assertExit(resReturnNoMarker, 0);
      assertNotOut(resReturnNoMarker, 'BLOCKED');
      assertNotOut(resReturnNoMarker, 'FIX-BATCH');
      assertOut(resReturnNoMarker, 'RETURN: 回程源节点 review（源节点产物在场且未出口；保留源节点跑出口）');
      assertOut(resReturnNoMarker, 'NODE: review');
      if (readScenarioState(dir).currentNode !== 'review') {
        throw new Error('旧 change 无标记回程态 next 后 currentNode 应保持 review，实际 ' + JSON.stringify(readScenarioState(dir).currentNode));
      }
    },
  },

  // 258: 三节点 SKILL 文本锁（AC-9 / T05 已落地）——execute/review/verify 均含
  // 「## Fix 批次状态机路径」段，段内含受控归位 + 回源节点跑出口 + 禁止绕过；不得把
  // 直接 exit 源节点收场或 advance 当正常路径（反捷径文本锚）。
  // 布局感知（级 3 e2e 副本缺陷）：技能树从 suite 脚本自身位置推导
  // （<skillsRoot>/flow-comet/scripts/ → 组件技能为 <skillsRoot> 下同级目录），权威源
  // .flow-comet/skills/ 与安装副本 .claude|.agents|.dsh/skills/ 同一相对布局通吃。
  {
    name: '258 技能文本锁：三节点 SKILL 含 Fix 批次状态机路径（禁止直接 exit/advance 为正常路径）',
    run: (dir) => {
      const componentSkills = ['flow-comet-execute', 'flow-comet-review', 'flow-comet-verify'];
      // 布局感知回归锚（合成安装副本）：suite 位于 <skillsRoot>/flow-comet/scripts/ 时组件技能
      // 必须解析到同级 <skillsRoot>/<skill>/SKILL.md——与权威源 .flow-comet 布局无关
      //（旧实现硬编码 REPO_ROOT/.flow-comet/skills → 此锚变红）。
      const syntheticSkillsRoot = path.join(dir, 'synthetic-carrier', '.claude', 'skills');
      const syntheticScriptsDir = path.join(syntheticSkillsRoot, 'flow-comet', 'scripts');
      for (const nodeSkill of componentSkills) {
        writeFile(dir, path.join('synthetic-carrier', '.claude', 'skills', nodeSkill, 'SKILL.md'),
          '## Fix 批次状态机路径\n\n受控归位（合成布局锚）\n');
        const expected = path.join(syntheticSkillsRoot, nodeSkill, 'SKILL.md');
        const resolved = resolveComponentSkillFile(nodeSkill, syntheticScriptsDir);
        if (resolved !== expected) {
          throw new Error('技能树布局感知解析错误：期望 ' + expected + '，实际 ' + resolved);
        }
      }
      // 显式失败锚（MECHANISM 三·6）：组件技能缺失时必须报错并给指引，不得静默跳过/空过。
      const emptyScriptsDir = path.join(dir, 'empty-carrier', '.dsh', 'skills', 'flow-comet', 'scripts');
      let missingError = null;
      try {
        resolveComponentSkillFile('flow-comet-execute', emptyScriptsDir);
      } catch (e) {
        missingError = e.message;
      }
      if (!missingError
        || !missingError.includes('技能树布局定位失败')
        || !missingError.includes(path.join('flow-comet-execute', 'SKILL.md'))) {
        throw new Error('组件技能缺失时未显式失败并给指引: ' + JSON.stringify(missingError));
      }
      // 真实三节点文本锁：从本 suite 自身位置推导技能树（不假定权威源布局）。逐份断言：
      // 段在场 + 6 关键词 + 反 advance 捷径 + 不得把直接 exit 源节点收场当正常路径；同时收集
      // 段正文（同一区间：首个 ## Fix 批次状态机路径 → 下一 ## 或 EOF，标题不计入）供 F-4 互比。
      const sectionEntries = [];
      for (const nodeSkill of componentSkills) {
        const file = resolveComponentSkillFile(nodeSkill);
        const text = fs.readFileSync(file, 'utf8');
        const match = text.match(/(?:^|\r?\n)## Fix 批次状态机路径\r?\n([\s\S]*?)(?=\r?\n## |$)/);
        if (!match) {
          throw new Error(nodeSkill + ' SKILL.md 缺「## Fix 批次状态机路径」段');
        }
        const section = match[1];
        for (const keyword of ['受控归位', 'NODE: execute', '回源节点跑出口', 'entry <源节点>', 'exit <源节点> --apply', '禁止绕过']) {
          if (!section.includes(keyword)) {
            throw new Error(nodeSkill + ' Fix 批次状态机路径段缺关键词: ' + keyword);
          }
        }
        if (section.includes('advance')) {
          throw new Error(nodeSkill + ' Fix 批次状态机路径段不得把 advance 作为正常路径');
        }
        for (const line of section.split(/\r?\n/)) {
          if (line.includes('直接') && line.includes('exit') && !/禁止|不得|会被 BLOCKED/.test(line)) {
            throw new Error(nodeSkill + ' Fix 批次状态机路径段不得把直接 exit 源节点收场作为正常路径: ' + line.trim());
          }
        }
        // F-4 段一致性锁：CRLF→LF 归一、不 trim（行尾/空白差异同样算漂移），正文参与三份互比。
        const normalized = section.replace(/\r\n/g, '\n');
        sectionEntries.push({ nodeSkill, body: normalized, hash: createHash('sha256').update(normalized, 'utf8').digest('hex') });
      }
      // F-4：三份段正文必须非空且逐字完全一致（当前无合法 per-node 差异）——任一单文件漂移即
      // 套件失败；失败信息给出三份 hash 与首处差异位置/上下文（L-064 反向构造证明判别力）。
      const emptyEntry = sectionEntries.find((entry) => entry.body.trim() === '');
      if (emptyEntry) {
        throw new Error('Fix 批次状态机路径段不得为空: ' + emptyEntry.nodeSkill);
      }
      const baselineEntry = sectionEntries[0];
      for (const entry of sectionEntries.slice(1)) {
        if (entry.body === baselineEntry.body) continue;
        const limit = Math.min(baselineEntry.body.length, entry.body.length);
        let diffIndex = 0;
        while (diffIndex < limit && baselineEntry.body[diffIndex] === entry.body[diffIndex]) diffIndex += 1;
        const context = baselineEntry.body.slice(Math.max(0, diffIndex - 40), diffIndex + 40);
        throw new Error('Fix 批次状态机路径段三份 SKILL 正文不一致（F-4 段一致性锁）：'
          + baselineEntry.nodeSkill + ' sha256=' + baselineEntry.hash
          + ' vs ' + entry.nodeSkill + ' sha256=' + entry.hash
          + '；首处差异 @' + diffIndex + '（基准上下文: ' + JSON.stringify(context) + '）');
      }
    },
  },
];
// ---------- 运行 ----------

for (const sc of SCENARIOS) {
  const dir = makeTmp();
  try {
    // T06: 协议路径适配——真实项目协议位于 <项目根>/reference/workflow-protocol.json（runRoot 内）。
    // T03 起 workflow-guard 用 readProtocolFile（protected-path：协议路径必须在 runRoot 内），
    // 场景 runRoot=tmpdir、内置协议默认路径在 packageRoot（tmpdir 外）→ 复制到 <dir>/reference/ 内，
    // 由 runGuard 的 FLOW_COMET_PROTOCOL env 指向场景内副本。场景内 writeFile('reference/...') 或
    // --protocol CLI 覆盖保持后写优先语义（CLI --protocol 优先级高于 env）。
    const builtinCopy = path.join(dir, 'reference', 'workflow-protocol.json');
    fs.mkdirSync(path.dirname(builtinCopy), { recursive: true });
    fs.copyFileSync(BUILTIN_PROTOCOL_SOURCE, builtinCopy);
    await sc.run(dir);
    passed += 1;
    console.log('PASS: ' + sc.name);
  } catch (e) {
    failures.push({ name: sc.name, error: e.message });
    console.error('FAIL: ' + sc.name + '\n' + e.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('RESULT: ' + passed + '/' + SCENARIOS.length + ' scenarios passed');

// 文档一致性自检（场景数纪律 + 公开产物零代号纪律工具化，2026-08-10）：
// ① 场景数：受检清单文档须与 SCENARIOS.length 一致（全变体检查），且清单条目必须真实存在
//    （AC-14：缺失显式报告，不静默跳过）；
// ② 公开产物零代号：公开文档不得含过程代号（场景编号/修复编号/批次/缺陷编号/问题级/验证代号/验证轮次/未公开概念——历史 CHANGELOG 回归实证）。
// 仅权威源检出执行；安装副本（目标项目）无 flow-comet 文档面，跳过。
if (isAuthoritativeSourceRepo()) {
  // ① 计数一致性受检清单（分发组恒检 + 维护者组整组在场时检；判据与场景 105 共用同一实现）
  // SCENARIO_COUNT_FILES(_MAINTAINER) / SYSTEM_TEST_COUNT_FILES(_MAINTAINER) 为模块级常量
  // （见文件头定义）——场景数与系统测试集项数两套计数合并检查
  for (const problem of countSyncProblems()) {
    failures.push({ name: '计数一致性', error: problem });
    console.error('FAIL: 计数一致性\n' + problem);
  }

  // ①b 维护文档机检（docs/internal 死引用 + ROADMAP 最低结构；整组缺席即跳过）
  for (const problem of internalDocsProblems()) {
    failures.push({ name: '维护文档机检', error: problem });
    console.error('FAIL: 维护文档机检\n' + problem);
  }

  // ② 公开文档零代号（公开产物纪律——CHANGELOG 历史 S 编号回归的教训，2026-08-10）
  const PUBLIC_DOCS = [
    'README.md', 'README-zh.md', 'CONTRIBUTING.md', 'CONTRIBUTING-zh.md',
    'SECURITY.md', 'SECURITY-zh.md', 'CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT-zh.md',
    'CHANGELOG.md', 'CHANGELOG-zh.md',
    'docs/INSTALLATION.md', 'docs/INSTALLATION-zh.md', 'docs/MECHANISM.md', 'docs/MECHANISM-zh.md',
    'docs/USAGE.md', 'docs/USAGE-zh.md', 'docs/PROTOCOL.md', 'docs/PROTOCOL-zh.md',
    'docs/TROUBLESHOOTING.md', 'docs/TROUBLESHOOTING-zh.md', 'docs/VERSIONS.md', 'docs/VERSIONS-zh.md',
    'docs/ECOSYSTEM.md', 'docs/ECOSYSTEM-zh.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/1-bug_report.yml', '.github/ISSUE_TEMPLATE/2-feature_request.yml',
    '.github/ISSUE_TEMPLATE/3-question.md', '.github/ISSUE_TEMPLATE/4-task.md',
  ];
  // 与 .githooks/internal-codes.mjs 的 BANNED 保持同步（单一来源约定；本文件随 bundle
  // 分发，不能 import 主仓私有 .githooks——改动词表时两份同改，行为必须一致）
  const INTERNAL_CODE_RE = /\bS\d{1,3}\b|T-FIX|batch-(?![a-z])|D-\d+|P[0-7]\b|round\s*\d|dogfood|内部/;
  for (const rel of PUBLIC_DOCS) {
    let text;
    try {
      text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    } catch (e) {
      // ENOENT 同样显式报告：本清单全部为随仓库分发的文件，任何权威源检出都应存在——
      // 静默跳过会让"永不生效的条目"藏身（同类 AC-14 缺陷）。
      failures.push({ name: '公开产物零代号(' + rel + ')', error: '文件缺失: ' + e.message });
      console.error('FAIL: 公开产物零代号(' + rel + ')\n文件缺失: ' + e.message);
      continue;
    }
    const m = text.match(INTERNAL_CODE_RE);
    if (m) {
      failures.push({ name: '公开产物零代号(' + rel + ')', error: rel + ' 含过程代号: "' + m[0] + '"' });
      console.error('FAIL: 公开产物零代号(' + rel + ')\n' + rel + ' 含过程代号: "' + m[0] + '"');
    }
  }
}

// 清理验证：自测套件自身创建的临时目录不留残留
const residue = createdDirs.filter((d) => fs.existsSync(d));
if (residue.length > 0) {
  failures.push({ name: '临时目录清理', error: '残留目录: ' + residue.join(', ') });
  console.error('FAIL: 临时目录清理\n残留目录: ' + residue.join(', '));
}

if (failures.length > 0) {
  console.error('FAILED SCENARIOS: ' + failures.length);
  for (const f of failures) {
    console.error('- ' + f.name + '\n' + f.error);
  }
  process.exit(1);
}

console.log('ALL ' + SCENARIOS.length + ' SCENARIOS PASSED');
