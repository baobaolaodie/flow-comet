// text-anchor-checks.mjs — 文档面与源文本的机检判据（单一来源）
//
// 定位：技能树文本锁、分发面文档判据、计数一致性（场景数 / 系统测试集项数）与维护者面
// 引用/结构机检。判据一律「读文本 → 返回问题描述数组」，收口方（套件底部自检、场景）只负责
// 报告；计数取数经 `count-derivation.mjs` 单一通道，本模块不再自持正则或虚拟机求值。

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { scenarioCount, systemItemCount } from './count-derivation.mjs';
import {
  assertExit,
  baseState,
  runHandoff,
  writeFile,
  writeState,
} from './test-helpers.mjs';
import {
  CHANGE_ID,
  HOOK,
  REPO_ROOT,
  SCRIPTS_DIR,
  engineCodeText,
  engineDefinitionModule,
  engineDefinitionPattern,
  engineImportsSymbolFrom,
  engineScriptFiles,
  engineScriptTexts,
} from './test-fixtures.mjs';
import {
  requireRouteNodeExport,
  scenarioProtocolPath,
} from './test-assertions.mjs';

// 公开产物零代号判据（与 .githooks/internal-codes.mjs 的 BANNED 保持同步——单一来源约定：
// 本文件随技能包分发，不能 import 主仓私有的 .githooks；改动词表时两份同改，行为必须一致）。
// 等价性不只靠注释约定：底部自检在权威源检出下读该私有件**逐字符比对**（主仓形态），安装副本
// 形态输出显式「不适用」描述符（未验证 ≠ 通过）——见词表镜像漂移判据。
// 除既有过程代号外，本批并入"未公开概念"类**收窄模式**：批次编号 / 批+数字 / 级别编号 /
// 验收代号 / 工作项编号。模式刻意收窄（词界 + 字母边界）：合法中文用法（发布批次 / 维护批次 /
// 级联 / 变更请求与采纳编号前缀）不命中；判别力与边界锚见维护文档机检场景族（表驱动等价性：
// 词表每个分支各一条正例 + 一条对应反例，另加本文件注释层零残留——三向自检）。禁止放宽为裸词
// ——那会误伤公开面大量合法中文用法。
// 收窄一处：「批 + 数字」补中文序数否定环视——「第 N 批 + 数字」是普通计数短语
// （合法中文用法），旧模式把它当未公开概念命中。序号与「批」之间隔着数字（阿拉伯或中文），
// 故环视必须吸收这段数字（变长环视），且**允许两侧空格**（`第 1 批 2 次` 同属普通计数短语）；
// 工作项编号补**尾界**（要求恰好两位，`R-123` 形态不命中）。以上均属"只收窄不放宽"；
// 只排除这两类形态，其余判定不变。无空格连写形态（如「批次2」）刻意不命中：实测受检三层 0 处，
// 放宽会增误报。本正则与 `.githooks/internal-codes.mjs` 的 `BANNED` 保持 **source 逐字符相等**
// （主仓形态由镜像漂移判据强制，改一侧必须同步另一侧）。
export const PUBLIC_CODE_RE = /\bS\d{1,3}\b|T-FIX|batch-(?![a-z])|D-\d+|P[0-7]\b|round\s*\d|dogfood|内部|批次 [A-Z0-9]|(?<!第 ?[0-9一二三四五六七八九十百千万]* ?)批 ?\d|级 [0-9]|UAT-\d|(?<![A-Za-z])R-\d{2}(?![A-Za-z0-9_-])/;

// 场景数一致性自检清单（15 文件 = 9 分发组 + 6 维护者组，全变体：ALL n SCENARIOS PASSED / n scenarios / n 场景 / n/n）——
// 数字由下方常量清单**推导**、不硬编码：9 = SCENARIO_COUNT_FILES 9 条与 SYSTEM_TEST_COUNT_FILES 4 条的
// 并集（后者是前者子集）；6 = SCENARIO_COUNT_FILES_MAINTAINER 6 条与 SYSTEM_TEST_COUNT_FILES_MAINTAINER
// 6 条的并集（后者是前者子集，故并集即 6 条）——底部自检输出「受检面: n 文件」实际值，清单/数字漂移即可见（防再漂移）。
// 场景数自检与底部自检共用同一清单/同一实现（自检常量同步：SCENARIOS.length 变更 → 全部受检文件须同步）。
// 分两组按"分发形态"划界（AC-14：条目缺失必须显式报告，不得静默跳过——幽灵条目无处藏身）：
//   ① 分发组：随仓库分发（受版本控制），**任何**权威源检出都必须存在——维护者工作副本、
//      CI 全新检出、worktree 检出皆然 → 条目缺失即报错（幽灵条目在此被强制暴露）。
//   ② 维护者组：被 .gitignore 排除（docs/internal/），只存在于维护者工作副本；CI 全新检出与
//      worktree 检出**整组必然缺席** → 判据取"整组是否在场"而非"单条目是否在场"：整组缺席 =
//      该检出无此文档面，跳过该组；整组在场时同样逐条强制存在与同步，缺失即报错。
//      （单条目静默跳过正是本 change 修正的缺陷——故跳过粒度只能是"整组"，不能是"单条"。）
// CLAUDE.md 为主仓私有指导文件（gitignore 不随 clone 分发）——现列入**维护者组**受检清单：
// 与 docs/internal/ 同进同退（该目录缺席即整组跳过，非维护者检出不会误红），主仓形态下其
// 计数不再由人工维护。分发组仍只含随仓库分发的文件。
// 文档重构：计数只允许出现在入口页徽章行、发布权威与机器锁面（PR 模板 / CI / 欢迎消息 / 变更日志）；
// 其余公开文档一律改述为「见 VERSIONS」，因此本清单随之收缩（此前把 CONTRIBUTING/INSTALLATION/MECHANISM 也列进来，
// 与单一权威策略冲突：同一数字散落越多越容易漂移）。
export const SCENARIO_COUNT_FILES = [
  'README.md', 'README-zh.md',
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
export const SCENARIO_COUNT_FILES_MAINTAINER = [
  'docs/internal/ARCHITECTURE.md', 'docs/internal/DOC-CHECKLIST.md', 'docs/internal/MECHANISM.md',
  'docs/internal/ROADMAP.md',
  'docs/internal/WORKING-METHOD.md',
  // 主仓私有指导面（见上方分组说明）：纳入维护者组后其场景数由机检维护；docs/internal/ 缺席
  // 的检出形态整组跳过（该文件同样被 gitignore，两种缺席同源）。
  'CLAUDE.md',
];
export const MAINTAINER_DOC_DIR = 'docs/internal';
// 本仓 CONTEXT 工件（**流程工件面**：.specs/ 被 gitignore）。存在性即「维护者形态」判据——
// CI 全新检出 / worktree 下结构性缺席，依赖它的场景须输出**可见 SKIP**（未验证 ≠ 通过），
// 不得把「文件不在场」当成「校验通过」。与 docs/internal/（MAINTAINER_DOC_DIR）同源缺席。
export const REPO_CONTEXT_FILE = path.join(REPO_ROOT, '.specs', 'CONTEXT.md');
// 三册显式清单（维护文档机检扫描面；与 docs/internal/*.md、.specs/adr/*.md 并列）：
// 知识权威累积面，更新频率高——写入即需校验。显式清单（不用 .specs/*.md 通配）可预测、
// 可按册 allowlist，未来新增册需手工登记（与计数受检清单同纪律）。
export const MAINTAINER_BOOKS = ['.specs/CONTEXT.md', '.specs/LESSONS.md', '.specs/CHANGELOG.md'];

// 系统测试集项数受检清单——与场景数清单**并列不合并**：两者数字不同、受检文件面也不同
// （项数只出现在下面这些文档里；场景数散布更广，含 README / 模板 / CI）。清单本身是
// 单一来源：改动项数必须同步列出的全部文件，漏同步即套件报错（此前无任何机检锚定，
// 漂移只能靠人工发现）。分组语义与场景数清单一致（见上方分组说明）：分发组恒检，
// 维护者组整组在场时逐条严检。
export const SYSTEM_TEST_COUNT_FILES = [
  'docs/VERSIONS.md', 'docs/VERSIONS-zh.md',
  'CHANGELOG.md', 'CHANGELOG-zh.md',
];
export const SYSTEM_TEST_COUNT_FILES_MAINTAINER = [
  'docs/internal/ARCHITECTURE.md', 'docs/internal/DOC-CHECKLIST.md', 'docs/internal/MECHANISM.md',
  'docs/internal/ROADMAP.md', 'docs/internal/WORKING-METHOD.md',
  // 与场景数维护者组同面同序（该组为子集关系，便于并集口径一眼可核）：机制知识册纳入后
  // 其项数由机检维护；CLAUDE.md 同属主仓私有面。
  'CLAUDE.md',
];
// 刻意不收进清单的项数副本（逐条留痕，避免"清单外漏网"变成无声的例外）：
//   - .specs/CONTEXT.md：流程工件目录随 change 清理/归档——收进清单会让套件在维护者检出
//     依赖流程工件状态。
// 两条原排除说明已结清：CLAUDE.md 与 docs/internal/MECHANISM.md 现均列入维护者组受检清单
// （前者随 docs/internal/ 缺席整组跳过；后者的项数已与当前值同步）。presence 之外另有 stale
// 检测兜住"在场但值过期"的形态（见下方 staleCountProblems）。
export const SYSTEM_TEST_SCRIPT_REL = '.flow-comet/skills/flow-comet/scripts/system-test.mjs';

// ---------- 工具函数 ----------

// 计数变体：受检文档可接受的写法（含运行时输出形态）。场景数沿用既有全变体；
// 系统测试集项数用它真实出现的三形态（运行输出 `SYSTEM TEST: n/n passed` 与文档手抄
// `n items` / `n 项`）。
export function scenarioCountVariants(n) {
  return ['ALL ' + n + ' SCENARIOS PASSED', n + ' scenarios', n + ' 场景', n + '/' + n];
}
export function systemTestCountVariants(itemCount) {
  return [itemCount + '/' + itemCount, itemCount + ' items', itemCount + ' 项'];
}

// 受检文件扫描（单一实现，两套计数共用）：返回 { missing, unsynced }（空数组 = 通过）。
// AC-14：条目缺失**显式报告**，不静默跳过。
// root 可覆盖扫描根（默认仓库根）——仅为可测性接缝：使「清单条目缺失 → 显式报告」
// 这一分支能在真实文件系统上被场景驱动（否则该分支只能靠人工实验验证，回归时可能被改回
// 静默跳过而套件仍全绿）。生产调用不传该参数。
export function scanCountFiles(files, variants, root = REPO_ROOT) {
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

// 维护者面的在场探针（单一来源）：以**组外**目录 docs/internal/ 是否存在为判据——不能用组内
// 成员当探针（成员缺失会被误判成「整组缺席」而跳过，正好藏起该成员的缺失）。计数受检清单的
// 维护者组与 maintainerFaceSkips 的计数面描述符共用本判据（单一决策，避免多处各写一份而漂移）。
export function maintainerFacePresent(root = REPO_ROOT) {
  return fs.existsSync(path.join(root, MAINTAINER_DOC_DIR));
}

// ---------- 计数 stale 检测（presence 之外的判别力补足） ----------
// presence 只能证明"当前值在场"，证不了"旧值不在场"：维护面曾长期带着无标记旧值仍全绿。
// 判据：受检面里出现**计数形态 token**、数值落在合理量程、且不等于当前值、且行内没有历史
// 标记 → 报"旧值未标记"（在场 + 旧值不在场两条一起才叫同步）。
//   ① token 白名单（只认这几种计数写法，避免把通用比值/编号误当计数）：`N 场景` / `N scenarios` /
//      `N 项` / `N items` / `ALL N SCENARIOS` / `N/N`——最后一种还须**同行点名套件**
//      （guard-self-test|system-test|SYSTEM TEST|SCENARIOS|场景|项|items|scenarios），
//      否则 `69/69 = 100%` 一类通用比值会被误伤（设计期实测口径）。
//   ② 量程门：30~400 之外不参与（把版本号、年份、行号一类数字挡在外面）。
//   ③ 历史标记豁免：行内出现"历史 / history / VERSIONS"即视为已标注的历史值。另有两枚等价标记
//      `本轮`（维护笔记记述既往事件的固定措辞）与 `过时`（行内自述该值已过期）——实测受检面里
//      仅有的两处旧值都出现在这类回顾叙述行里，它们是**已标注**的历史值，不是"未标记旧值"。
// 受检面（staleCountTargets）：维护者面（docs/internal/ 全册 + CLAUDE.md）+ 参考册
// （reference/*.md，路径从本脚本自身位置推导）。**分发组计数清单不入本面**：变更日志按语义
// 就是历史记录（双语实测 42 处既往计数），纳入即灾难性误报；分发组的"当前值在场"要求照旧
// 由 presence 判据覆盖（见上方清单）。
export const STALE_COUNT_TOKEN_RE = /\b(\d{2,4})\s*(?:场景|scenarios|项|items)|\b(\d{2,4})\/(\d{2,4})\b|\bALL (\d{2,4}) SCENARIOS\b/g;
export const STALE_COUNT_SUITE_KEYWORD_RE = /guard-self-test|system-test|SYSTEM TEST|SCENARIOS|场景|项|items|scenarios/;
export const STALE_COUNT_HISTORY_MARKER_RE = /历史|history|VERSIONS|本轮|过时|outdated|superseded/i;
export const STALE_COUNT_MIN = 30;
export const STALE_COUNT_MAX = 400;
// 参考册面（分发参考册）：技能树从本脚本自身位置推导——权威源与各安装副本（.claude / .agents /
// .dsh/skills）同一推导覆盖，不假定权威源布局（与技能树布局感知注释同一纪律）。
export const REFERENCE_FACE_DIR_REL = path
  .relative(REPO_ROOT, path.join(SCRIPTS_DIR, '..', 'reference'))
  .split(path.sep).join('/');

export function staleCountTargets(root = REPO_ROOT) {
  const targets = [];
  const internalDir = path.join(root, MAINTAINER_DOC_DIR);
  if (fs.existsSync(internalDir)) {
    for (const name of fs.readdirSync(internalDir)) {
      if (name.endsWith('.md')) targets.push(path.posix.join(MAINTAINER_DOC_DIR, name));
    }
  }
  const referenceDir = path.join(root, REFERENCE_FACE_DIR_REL);
  if (fs.existsSync(referenceDir)) {
    for (const name of fs.readdirSync(referenceDir)) {
      if (name.endsWith('.md')) targets.push(path.posix.join(REFERENCE_FACE_DIR_REL, name));
    }
  }
  if (fs.existsSync(path.join(root, 'CLAUDE.md'))) targets.push('CLAUDE.md');
  return targets;
}

// counts = 当前值集合（场景数 / 系统测试集项数；派生失败时按 null 过滤——派生失败本身已由
// 计数一致性判据显式报告，不在此重复）。返回问题描述数组（空数组 = 无未标记旧值）。
export function staleCountProblems(counts, root = REPO_ROOT) {
  const problems = [];
  const current = new Set(counts.filter((v) => typeof v === 'number' && Number.isFinite(v)));
  for (const rel of staleCountTargets(root)) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch (e) {
      // 与维护文档机检同型：读取失败不得静默跳过（"未执行 ≠ 通过"）。
      const reason = e && e.code ? e.code : (e && e.message ? e.message : String(e));
      problems.push('无法读取: ' + rel + ': ' + reason);
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (STALE_COUNT_HISTORY_MARKER_RE.test(line)) continue;
      for (const m of line.matchAll(STALE_COUNT_TOKEN_RE)) {
        let value = null;
        if (m[1] !== undefined) {
          value = Number(m[1]);
        } else if (m[2] !== undefined) {
          if (m[2] !== m[3]) continue; // 非等值比值（如 69/70）不是计数形态
          if (!STALE_COUNT_SUITE_KEYWORD_RE.test(line)) continue; // 通用比值须同行点名套件
          value = Number(m[2]);
        } else {
          value = Number(m[4]);
        }
        if (!Number.isFinite(value) || value < STALE_COUNT_MIN || value > STALE_COUNT_MAX) continue;
        if (current.has(value)) continue;
        problems.push('旧值未标记: ' + rel + ':' + (i + 1) + ' 计数 ' + m[0].trim()
          + '（当前值 ' + [...current].join(' / ') + '）——请改写为当前值，或补历史标记'
          + '（历史 / VERSIONS 指针 / 过时 说明）');
      }
    }
  }
  return problems;
}

// 场景数一致性检查（单一来源）：场景 105 与底部自检共用同一实现与同一判据。
// 返回问题描述数组（空数组 = 通过）。
// root 可覆盖扫描根（默认仓库根）——同上：仅为可测性接缝（生产调用不传，判据与改前一致）。
export function scenarioCountSyncProblems(n, root = REPO_ROOT) {
  const problems = [];
  const dist = scanCountFiles(SCENARIO_COUNT_FILES, scenarioCountVariants(n), root);
  if (dist.missing.length > 0) problems.push('受检条目文件缺失（幽灵条目）: ' + dist.missing.join(', '));
  if (dist.unsynced.length > 0) problems.push('场景数未同步（应为 ' + n + '）: ' + dist.unsynced.join(', '));
  // 维护者组：整组在场才检查（CI 全新检出 / worktree 检出整组必然缺席——见清单分组说明）
  if (maintainerFacePresent(root)) {
    const mnt = scanCountFiles(SCENARIO_COUNT_FILES_MAINTAINER, scenarioCountVariants(n), root);
    if (mnt.missing.length > 0) problems.push('维护者文档条目文件缺失（幽灵条目）: ' + mnt.missing.join(', '));
    if (mnt.unsynced.length > 0) problems.push('维护者文档场景数未同步（应为 ' + n + '）: ' + mnt.unsynced.join(', '));
  }
  return problems;
}

// 系统测试集项数派生（经 count-derivation 单一通道）：派生源缺失 = 数据层尚未落地这一事实，
// 不是判据失败——调用方须**显式报告**（未执行 ≠ 通过），故以 { count: null, missing } 返回而非
// 静默计 0；其余派生错误（组文件不合约定等）原样抛出（fail-closed）。
export async function deriveSystemItemCount(scriptsDir = SCRIPTS_DIR) {
  try {
    return { count: await systemItemCount(scriptsDir), missing: null };
  } catch (e) {
    if (e && e.code === 'COUNT_SOURCE_MISSING') return { count: null, missing: e.path || SYSTEM_TEST_SCRIPT_REL };
    throw e;
  }
}

// 派生源在报告里的名字：能相对受检根表达就用相对路径（消息可核），否则原样给出。
export function derivationSourceLabel(root, missing) {
  const abs = String(missing || '');
  if (!abs) return SYSTEM_TEST_SCRIPT_REL;
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : abs;
}

// 系统测试集项数一致性检查：受检面与场景数面同构（分发组恒检 + 维护者组整组在场时严检）。
export async function systemTestCountSyncProblems(root = REPO_ROOT, scriptsDir = SCRIPTS_DIR) {
  const { count: itemCount, missing } = await deriveSystemItemCount(scriptsDir);
  if (missing) return ['系统测试集项数派生源缺失（无法核对项数）: ' + derivationSourceLabel(root, missing)];
  return systemTestCountProblems(itemCount, root);
}

// presence 面检查（给定已派生的项数）：分发组恒检 + 维护者组整组在场时严检。
export function systemTestCountProblems(itemCount, root = REPO_ROOT) {
  const problems = [];
  const dist = scanCountFiles(SYSTEM_TEST_COUNT_FILES, systemTestCountVariants(itemCount), root);
  if (dist.missing.length > 0) problems.push('系统测试集项数条目文件缺失（幽灵条目）: ' + dist.missing.join(', '));
  if (dist.unsynced.length > 0) problems.push('系统测试集项数未同步（应为 ' + itemCount + '）: ' + dist.unsynced.join(', '));
  if (maintainerFacePresent(root)) {
    const mnt = scanCountFiles(SYSTEM_TEST_COUNT_FILES_MAINTAINER, systemTestCountVariants(itemCount), root);
    if (mnt.missing.length > 0) problems.push('维护者文档系统测试集项数条目文件缺失（幽灵条目）: ' + mnt.missing.join(', '));
    if (mnt.unsynced.length > 0) problems.push('维护者文档系统测试集项数未同步（应为 ' + itemCount + '）: ' + mnt.unsynced.join(', '));
  }
  return problems;
}

// 计数一致性检查（两套计数合并 + stale 检测）：场景 105 与底部自检共用，两处判据不会漂移。
// 顺序有意为之：先跑 presence（含派生源缺失/失败，必要时 fail-closed 抛出），再跑 stale——
// 当前值取自同一派生（场景数 = SCENARIOS.length，项数 = 系统测试集脚本派生），不二次硬编码。
export async function countSyncProblems(root = REPO_ROOT, scriptsDir = SCRIPTS_DIR) {
  const scenarioTotal = await scenarioCount(scriptsDir);
  const { count: itemCount, missing } = await deriveSystemItemCount(scriptsDir);
  const problems = [
    ...scenarioCountSyncProblems(scenarioTotal, root),
    ...(missing
      ? ['系统测试集项数派生源缺失（无法核对项数）: ' + derivationSourceLabel(root, missing)]
      : systemTestCountProblems(itemCount, root)),
  ];
  problems.push(...staleCountProblems([scenarioTotal, itemCount], root));
  return problems;
}

// 维护文档机检（docs-governance）：覆盖 CI 结构上不可见的维护者面——docs/internal/、
// .specs/adr/ 与三册显式清单（见 MAINTAINER_BOOKS）的
// ① 死引用（文档中的仓库相对路径引用必须存在）；② ROADMAP 最低结构（Now / Next / Later / Open decisions）。
// 与计数检查同构：全部目标面缺席（CI 全新检出 / worktree 检出）→ 跳过（空数组，不误红）。
// 判别力边界（实测教训）：提取必须取「完整路径 token」而非后缀子串；scripts/… 一类简写按技能树基准解析；
// 占位符 / 通配 / 未来路径不参与判定（见 ALLOWLIST）。
// 解析基准（数据驱动，扩展条目不写逻辑分支）：前四条为既有基准（技能树 / 包根 / 上游），
// 新增基准覆盖权威树根（.flow-comet）、技能树根（.flow-comet/skills、.claude/skills、
// .agents/skills、.dsh/skills）、规则树根（.flow-comet/rules、.claude/rules）与平台副本根
// （.claude）——用于解析 `rules/…`、`flow-comet-*/SKILL.md` 这类树根相对形态。
export const INTERNAL_DOC_REF_BASES = [
  '.flow-comet/skills/flow-comet', '.claude/skills/flow-comet', '', 'flow-kit',
  '.flow-comet', '.flow-comet/skills', '.flow-comet/rules',
  '.claude', '.claude/skills', '.claude/rules', '.agents/skills', '.dsh/skills',
];
// 窄域报告规则（判别力补丁）：基准全部未解析时，首段属于下列「仓库内树根相对形态」族的引用
// 必须按死引用报告——即使顶层目录在仓库根不存在也报（这正是旧逻辑「顶层整体缺席 → 跳过」
// 会静默放过的形态）。族为声明式清单，只覆盖已确证的形态：flow-comet* 技能目录 / rules。
export const INTERNAL_DOC_REF_TREE_ROOT_FAMILIES = [/^flow-comet[A-Za-z0-9-]*$/, /^rules$/];
export function isTreeRootRelativeRef(ref) {
  const firstSegment = ref.split('/')[0];
  return INTERNAL_DOC_REF_TREE_ROOT_FAMILIES.some((re) => re.test(firstSegment));
}
// 声明式族（取代"顶层段不存在即静默跳过"）：解析失败后仍允许跳过的形态必须**逐条显式登记**，
// 未登记者一律按死引用报告（fail-closed）。旧语义实测吞掉过指向已移除临时区的真实残留——
// 隐含边界把"允许"藏进了代码，声明式族把允许面变成可见清单，新增跳过必须显式登记。
//   ① 外部命名空间族（前缀声明）：平台侧命名空间，本仓库根天然不存在。
export const EXTERNAL_NAMESPACE_PREFIXES = ['DSH_HOME/', 'dsh-tui/', 'dsh-base/'];
//   ② 退役命名空间允许面（**按角色 / 前缀匹配**，不再逐条硬编码精确 ref）：仅限**记录该迁移**
//      的决策件与决策册——退役命名空间在那里是历史事实，改掉反而丢失迁移记录。
//      匹配 = 文件面（前缀形态 `filePrefix` 或角色形态 `role`）+ 引用面（退役命名空间前缀）。
//      精确 ref 硬编码的脆性在于：文件改名即静默失配 → 合法历史迁移记录被误报死引用（误红），
//      而误红会诱导维护者删掉历史事实。改名不改角色，故按角色/前缀匹配；反过来**不**放宽
//      引用面与文件面之外的部分：未登记文件 / 未登记命名空间的引用照旧一律报（fail-closed）。
export const RETIRED_NAMESPACE_PREFIX = '.comet/';
// 决策册角色判定：`.specs` 下的决策账本族文件（含改名后的 `CONTEXT-<后缀>.md` 形态）——
// 角色判定按语义而非精确文件名，改名不该让合法迁移记录变成死引用误报。
// 边界（登记）：角色判定只作用于**扫描目标**（该族文件本身须在受检目标清单内才会被扫描）。
export function isDecisionLedgerFile(rel) {
  return /^\.specs\/CONTEXT(?:[-.][A-Za-z0-9_.-]+)?\.md$/i.test(rel);
}
// 文件面匹配器（声明式）：kind = filePrefix（路径前缀，改名后缀不影响）| role（角色判定函数）。
export const RETIRED_NAMESPACE_FILE_MATCHERS = {
  'decision-ledger': isDecisionLedgerFile,
};
export const RETIRED_NAMESPACE_ALLOWLIST = [
  {
    filePrefix: '.specs/adr/ADR-009',
    refPrefix: RETIRED_NAMESPACE_PREFIX,
    reason: '记录运行时命名空间迁移的决策件：退役命名空间作为迁移前事实保留（改名不改角色）',
  },
  {
    filePrefix: '.specs/adr/ADR-010',
    refPrefix: RETIRED_NAMESPACE_PREFIX,
    reason: '同族决策件（迁移决策的后续修订）：迁移前事实同样保留，按前缀匹配避免改名失配',
  },
  {
    role: 'decision-ledger',
    refPrefix: RETIRED_NAMESPACE_PREFIX,
    reason: '决策册角色（.specs 下决策账本族）：已锁决策记录迁移事实（退役命名空间的历史形态）',
  },
];
// 允许面条目匹配（单一实现）：文件面（前缀 / 角色）与引用面（前缀）同时命中才算登记在案。
export function matchesRetiredNamespaceEntry(entry, rel, ref) {
  const refOk = typeof entry.refPrefix === 'string' && ref.startsWith(entry.refPrefix);
  if (!refOk) return false;
  if (typeof entry.filePrefix === 'string' && rel.startsWith(entry.filePrefix)) return true;
  if (typeof entry.role === 'string') {
    const roleMatcher = RETIRED_NAMESPACE_FILE_MATCHERS[entry.role];
    if (typeof roleMatcher === 'function' && roleMatcher(rel)) return true;
  }
  return false;
}
//   ③ 示例形态允许面（逐条 {file, ref, reason}）：文档里的示意路径。清单**逐条登记**——
//      未登记即报（fail-closed），不是「该判据不生效」；查询带长度短路（零条目时不进入匹配），
//      避免把零条目扩展点当成隐式权限。出现新示例时在此登记（登记即把边界显式化：文档措辞
//      不动，只声明「该路径是示意、不是真实文件」）。
export const EXAMPLE_REF_ALLOWLIST = [
  {
    file: '.specs/adr/ADR-014-parallel-delegation-contract.md',
    ref: 'src/foo.mjs',
    reason: '写冲突盲区的示例路径（非真实文件）',
  },
];
export function isDeclaredReferenceSkip(rel, ref) {
  if (EXTERNAL_NAMESPACE_PREFIXES.some((prefix) => ref.startsWith(prefix))) return true;
  if (RETIRED_NAMESPACE_ALLOWLIST.some((e) => matchesRetiredNamespaceEntry(e, rel, ref))) return true;
  if (EXAMPLE_REF_ALLOWLIST.length > 0
    && EXAMPLE_REF_ALLOWLIST.some((e) => e.file === rel && e.ref === ref)) return true;
  return false;
}
export const INTERNAL_DOC_REF_ALLOWLIST = new Set(['.specs/archive/CONTEXT-history.md']);
// 引用提取：既有形态（≥1 段路径 + 扩展名）+ **可选行号后缀**（`:N` / `:N-M` / 逗号列表
// `:N,M`）——行号存在性与不越界判据需要把行号一起取出来（见 internalDocsProblems）。
export const INTERNAL_DOC_REF_RE = /(?<![A-Za-z0-9_.\-\/])(\.?(?:[A-Za-z0-9_][A-Za-z0-9_.\-]*\/)+[A-Za-z0-9_.\-]+\.(?:md|mjs|cjs|js|ts|json|ya?ml|sh|patch|toml))(?::(\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*))?(?![A-Za-z0-9])/gm;
// 并列写法护栏：首段**本身带文件扩展名**的 token 不是路径引用（如 `TEST.md/REVIEW.md` 是两个
// 文件名并列写法）——不参与解析（存在性判据与行号判据同此）。判据必须收窄到"首段带扩展名"：
// 用"首段含 `.`"会把 `.specs/…` / `.flow-comet/…` 这类隐藏目录一并误排（设计期实测该写法把
// 5 处带行号引用压成 3 处）。
export const INTERNAL_DOC_REF_PARALLEL_RE = /\.(?:md|mjs|cjs|js|ts|json|ya?ml|sh|patch|toml)$/i;

// 行号后缀 → 数值数组（区间取两端；逗号列表逐项展开）。
export function parseRefLineNumbers(suffix) {
  if (!suffix) return [];
  const out = [];
  for (const part of suffix.split(/\s*,\s*/)) {
    if (part.includes('-')) {
      const [start, end] = part.split('-');
      out.push(Number(start), Number(end));
    } else {
      out.push(Number(part));
    }
  }
  return out;
}

export function internalDocRefCandidates(text) {
  const out = [];
  const seen = new Set();
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of lines[i].matchAll(INTERNAL_DOC_REF_RE)) {
      const token = m[1];
      if (token.includes('*') || token.includes('<')) continue; // 通配 / 占位符
      if (INTERNAL_DOC_REF_PARALLEL_RE.test(token.split('/')[0])) continue; // 并列写法（见上方护栏）
      const key = i + 1 + ' ' + token + ':' + (m[2] || '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ref: token, line: i + 1, lineRefs: parseRefLineNumbers(m[2]) });
    }
  }
  return out;
}

// 引用解析（单一实现）：按声明式基准清单逐个试解析，命中即返回绝对路径；全部失败返回 null。
export function resolveInternalDocRef(ref, root = REPO_ROOT) {
  for (const base of INTERNAL_DOC_REF_BASES) {
    const p = base === '' ? path.join(root, ref) : path.join(root, base, ref);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 维护文档机检的受检目标清单（单一来源）：docs/internal/*.md（目录在场时）+ .specs/adr/*.md
// + 三册显式清单（MAINTAINER_BOOKS）。三册是知识权威累积面、更新频率高（写入即需校验）；
// 显式清单可预测，未来新增第四册需手工登记（与计数受检清单同纪律）。
// 全部目标面缺席 → 空数组（组缺席语义；internalDocsProblems 与 maintainerFaceSkips 共用同一判据）。
export function internalDocTargets(root = REPO_ROOT) {
  const targets = [];
  const internalDir = path.join(root, MAINTAINER_DOC_DIR);
  if (fs.existsSync(internalDir)) {
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
  for (const rel of MAINTAINER_BOOKS) {
    if (fs.existsSync(path.join(root, rel))) targets.push(rel);
  }
  return targets;
}

// ROADMAP 表头新鲜度（内容锚）：声明式表头行 `> 最后更新：<YYYY-MM-DD>` 的日期必须 ≥ 该文件
// 正文中出现过的最大日期。维护面无 git 跟踪文件（实测 0 跟踪），提交日锚不可得——内容锚纯结构、
// 可夹具驱动。未声明表头的目标跳过（登记边界：表头即"最后更新"声明，没声明就没得比）。
export const ROADMAP_HEADER_RE = /^\s*>\s*最后更新[:：]\s*(20\d{2}-\d{2}-\d{2})/m;
export const INTERNAL_DOC_DATE_RE = /20\d{2}-\d{2}-\d{2}/g;
// 归档目录条目：`<日期>-<change-id>`。
export const ARCHIVE_DIR_ENTRY_RE = /^\d{4}-\d{2}-\d{2}-(.+)$/;

// 行号存在与不越界判定（结构级；单一实现）：只在引用本身解析成功后才调用——引用不存在时由
// 死引用判据负责报告（同一处只报一次，不叠两条）。区间取两端、逗号列表逐项，逐个校验 1..N。
export function lineNumberProblems(rel, entry, resolvedPath, lineCountOf) {
  const problems = [];
  if (entry.lineRefs.length === 0) return problems;
  const total = lineCountOf(resolvedPath);
  if (total === null) return problems; // 目标瞬时不可读：存在性已通过，行号按不可判跳过
  for (const num of entry.lineRefs) {
    if (num < 1 || num > total) {
      problems.push('行号越界: ' + rel + ':' + entry.line + ' → ' + entry.ref + ':' + num
        + '（目标共 ' + total + ' 行）——请改指目标里真实存在的行，或删除行号后缀');
    }
  }
  return problems;
}

// 表头新鲜度判定（内容锚；单一实现）：无表头声明 → 跳过（登记边界）；表头日期 < 正文最大日期 → 报。
export function headerFreshnessProblems(rel, text) {
  const header = text.match(ROADMAP_HEADER_RE);
  if (!header) return [];
  const dates = [...text.matchAll(INTERNAL_DOC_DATE_RE)].map((m) => m[0]);
  const maxBody = dates.reduce((a, b) => (a > b ? a : b), '');
  if (maxBody === '' || header[1] >= maxBody) return [];
  return ['表头不新鲜: ' + rel + ' 表头 ' + header[1] + ' < 正文最大 ' + maxBody
    + '——请把表头日期刷新到不早于正文最大日期'];
}

// 已归档 change 清单（读目录名；归档面缺席 → 空数组，非维护者检出/夹具形态不误红）。
export function archivedChangeIds(root = REPO_ROOT) {
  const archiveDir = path.join(root, '.specs', 'archive');
  if (!fs.existsSync(archiveDir)) return [];
  const ids = [];
  for (const name of fs.readdirSync(archiveDir)) {
    const m = ARCHIVE_DIR_ENTRY_RE.exec(name);
    if (m) ids.push({ id: m[1], dir: name });
  }
  return ids;
}

// `## Now`（在办段）不得出现已归档 change-id：段定位**必须用标题扫描**（允许段名尾部括号注记），
// 切到下一个二级标题 Next 为止。禁止用 indexOf('## Now')——该册文件头的目录说明行里含被反引号
// 包住的同名标题字样，indexOf 会命中说明行、切出极短窗口使判据恒过（实测教训：判据的定位口径
// 必须自实测推导，不能被同一文件里"看起来对"的文本骗过）。
export function roadmapNowArchivedProblems(rel, text, root = REPO_ROOT) {
  const problems = [];
  const nowRe = /^##\s*Now\s*(?:[（(][^）)\n]*[）)])?\s*$/m;
  const nowMatch = nowRe.exec(text);
  if (!nowMatch) return problems; // 段缺席由结构判据报告，此处不重复
  const rest = text.slice(nowMatch.index + nowMatch[0].length);
  const nextRe = /^##\s*Next\s*(?:[（(][^）)\n]*[）)])?\s*$/m;
  const nextMatch = nextRe.exec(rest);
  const section = nextMatch ? rest.slice(0, nextMatch.index) : rest;
  for (const { id, dir } of archivedChangeIds(root)) {
    // 命中面 = id 及其路径形态（两形态都要判：只判路径会漏掉裸 id 写法）。
    // id 用**整词**匹配（字母/数字/连字符为词字符）——直接 `includes(id)` 会让短 id 命中更长 id
    // 或同族更长 id 的中间（如归档 id `archived-fixture` 命中 `archived-fixture-v2`），属假红。
    const idRe = new RegExp('(?<![A-Za-z0-9_-])' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_-])');
    if (idRe.test(section) || section.includes(dir)) {
      problems.push('Now 段含已归档 change-id: ' + id + '（' + rel + ' 的在办段引用了已归档记录 '
        + dir + '）——请从在办段移出（历史指针面记录）');
    }
  }
  return problems;
}

export function internalDocsProblems(root = REPO_ROOT) {
  const problems = [];
  const targets = internalDocTargets(root);
  if (targets.length === 0) return problems; // 全部目标面缺席 → 整组跳过（CI / worktree 形态）
  const lineCountCache = new Map();
  const lineCountOf = (p) => {
    if (!lineCountCache.has(p)) {
      try {
        // 逻辑行数：**尾随换行不产生额外一行**（`a\nb\nc\n` = 3 行），**空文件 = 0 行**（不是 1 行）。
        // 直接取 `split(/\r?\n/).length` 会把尾随空段算成一行 → `:N+1` 越界被漏报；空文件若按段数
        // 计会得 1 行 → `:1` 被放过（空文件没有任何行，任何行号都越界）。
        const body = fs.readFileSync(p, 'utf8');
        const parts = body === '' ? [] : body.split(/\r?\n/);
        if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
        lineCountCache.set(p, parts.length);
      } catch {
        lineCountCache.set(p, null); // 目标瞬时不可读：存在性已通过，行号判据按不可判跳过
      }
    }
    return lineCountCache.get(p);
  };
  for (const rel of targets) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch (e) {
      // F4：读取失败（EACCES / EBUSY / EISDIR 等）不得静默 continue——该目标既没被判死引用、
      // 也没被判缺失，静默跳过会让受检面出现「未执行 ≠ 通过」的黑洞（同类静默通道；本批
      // 正落在新扩扫描面上）。按可见问题报告，并继续扫描其余目标（一个目标损坏不吞整册扫描面）。
      const reason = e && e.code ? e.code : (e && e.message ? e.message : String(e));
      problems.push('无法读取: ' + rel + ': ' + reason);
      continue;
    }
    for (const entry of internalDocRefCandidates(text)) {
      if (INTERNAL_DOC_REF_ALLOWLIST.has(entry.ref)) continue;
      const resolved = resolveInternalDocRef(entry.ref, root);
      if (resolved !== null) {
        problems.push(...lineNumberProblems(rel, entry, resolved, lineCountOf));
        continue;
      }
      // 窄域报告规则：树根相对形态（flow-comet* 技能目录 / rules）基准全失败 → 按死引用报告，
      // 不再落入「顶层整体缺席 → 跳过」（旧逻辑在此静默放过——族见上方声明）。
      if (isTreeRootRelativeRef(entry.ref)) {
        problems.push('死引用: ' + rel + ':' + entry.line + ' → ' + entry.ref
          + '（树根相对形态未解析：技能树 / 规则树内不存在该目标）');
        continue;
      }
      // 声明式族：登记在案的外部命名空间 / 退役命名空间 / 示例形态 → 跳过；其余一律按死引用报
      // （顶层段不存在不再是免检理由——那正是旧逻辑吞掉真实残留的通道）。
      if (isDeclaredReferenceSkip(rel, entry.ref)) continue;
      problems.push('死引用: ' + rel + ':' + entry.line + ' → ' + entry.ref
        + '（顶层段不存在且未登记为允许跳过；请修正路径，或按声明式族逐条登记理由）');
    }
    // 表头新鲜度（内容锚；未声明表头 → 跳过）
    problems.push(...headerFreshnessProblems(rel, text));
  }
  const roadmapRel = path.posix.join(MAINTAINER_DOC_DIR, 'ROADMAP.md');
  if (!fs.existsSync(path.join(root, roadmapRel))) {
    problems.push('ROADMAP 缺失: ' + roadmapRel);
  } else {
    let text = null;
    try {
      text = fs.readFileSync(path.join(root, roadmapRel), 'utf8');
    } catch (e) {
      // F4 语义的结构检查侧补齐：ROADMAP 自身读取失败（EACCES / EBUSY / EISDIR 等）与目标扫描
      // 同型报告（同一错误摘要口径），并跳过四段结构检查——不得让同一受检面在结构检查处抛
      // 未捕获异常、以堆栈崩溃整个套件（读取失败可见化在两个消费点语义一致）。
      const reason = e && e.code ? e.code : (e && e.message ? e.message : String(e));
      problems.push('无法读取: ' + roadmapRel + ': ' + reason);
    }
    if (text !== null) {
      for (const section of ['Now', 'Next', 'Later', 'Open decisions']) {
        const sectionRe = new RegExp('^##\\s*' + section + '\\s*(?:[（(][^）)\\n]*[）)])?\\s*$', 'm');
        if (!sectionRe.test(text)) {
          problems.push('ROADMAP 结构缺段: ' + section + '（' + roadmapRel + '）');
        }
      }
      problems.push(...roadmapNowArchivedProblems(roadmapRel, text, root));
    }
  }
  return problems;
}

// 维护者面缺席可见化（可测接缝；root 可覆盖=测试专用入口，生产调用不传）：
// 返回被跳过的面与原因描述符数组（空数组 = 全部维护者面在场，无跳过）。与消费点共用同一在场
// 判据——① 计数受检清单的维护者组复用 maintainerFacePresent（组外目录探针，与
// scenarioCountSyncProblems 同源）；② 维护文档机检以 internalDocTargets 是否为空为判据
// （同 internalDocsProblems）。
// 只产出描述符，不改任何判定 / 返回值语义 / 退出码；套件底部据此输出可见的 SKIP 行
// （worktree / CI 全新检出等结构性缺席不误红，但不得被当成「已校验」——以维护者主树 L1 为准）。
export function maintainerFaceSkips(root = REPO_ROOT) {
  const skips = [];
  if (!maintainerFacePresent(root)) {
    skips.push({
      face: '维护者文档计数面（场景数 + 系统测试集项数）',
      reason: MAINTAINER_DOC_DIR + '/ 目录缺席（CI 全新检出 / worktree 检出等非维护者形态）',
    });
  }
  if (internalDocTargets(root).length === 0) {
    skips.push({
      face: '维护文档机检（引用解析 + 路线图结构）',
      reason: '受检目标面全部缺席（' + MAINTAINER_DOC_DIR + ' 与 .specs/adr 与三册均不可见）',
    });
  }
  return skips;
}

// 系统测试集项数受检面的分支夹具（场景 231 用）：逐条驱动组文件派生、组文件契约违约（导出非数组 /
// 空数组 / 元素缺 name 各自 fail-closed 且指名文件）、条目缺失、项数未同步、维护者组整组在场判定、
// 组文件目录缺失（目录缺席 / 空目录 / 套件入口在场三种输入形态）——判据统一是「显式报告、不静默
// 跳过」（AC-14 同型）。
// 夹具根即受检根：数据层按组文件约定建在 <dir>/scripts/items/ 下，并把该 scripts/ 作为派生的
// 可测接缝传入——派生值必须是「读组文件」得来，不是常量。
export async function exerciseSystemTestCountCheck(dir) {
  const scriptsDir = path.join(dir, 'scripts');
  // 契约违约探针：写一份畸形组文件 → 派生必须抛错，且消息指名该文件与违约形态（fail-closed；
  // 分支若改成静默计 0，这里即红）。文件名逐组不同——ESM 按 URL 缓存模块，同名复用会取回上一份
  // 已求值的模块。验完即删，后续步骤仍以 3 条合法条目为前提。
  const expectContractError = async (fileName, source, ...expected) => {
    const rel = path.posix.join('items', fileName);
    writeFile(scriptsDir, rel, source);
    let caught = null;
    try {
      await systemItemCount(scriptsDir);
    } catch (e) {
      caught = e;
    }
    fs.rmSync(path.join(scriptsDir, rel));
    if (!caught) throw new Error('组文件违约未被 fail-closed 抛出（静默计数）: ' + rel);
    for (const frag of [rel, ...expected]) {
      if (!String(caught.message).includes(frag)) {
        throw new Error('组文件违约报告未指向「' + frag + '」: ' + caught.message);
      }
    }
  };
  // ① 组文件派生：两份组文件共 3 条 → 派生值必须是 3（证明计数是读出来的，不是硬编码）
  writeFile(scriptsDir, 'items/a.mjs', 'export const ENTRIES = [\n'
    + '  { name: \'x1\', run: () => {} },\n'
    + '  { name: \'x2\', run: () => {} },\n'
    + '];\n');
  writeFile(scriptsDir, 'items/b.mjs', 'export const ENTRIES = [\n'
    + '  { name: \'x3\', run: () => {} },\n'
    + '];\n');
  const derived = await deriveSystemItemCount(scriptsDir);
  if (derived.count !== 3) throw new Error('项数未从组文件派生（应为 3）: ' + JSON.stringify(derived));
  const itemCount = derived.count;
  for (const rel of SYSTEM_TEST_COUNT_FILES) writeFile(dir, rel, itemCount + ' items\n');
  const clean = await systemTestCountSyncProblems(dir, scriptsDir);
  if (clean.length !== 0) {
    throw new Error('受检面齐备且同步时不应报告问题: ' + JSON.stringify(clean));
  }
  // ② 组文件契约违约三形态（AC-9 的「篡改」支）：各自 fail-closed，消息含文件名 + 违约形态
  await expectContractError('bad-nonarray.mjs', 'export const ENTRIES = {};\n', '未导出 ENTRIES 数组');
  await expectContractError('bad-empty.mjs', 'export const ENTRIES = [];\n', '为空数组');
  await expectContractError('bad-noname.mjs', 'export const ENTRIES = [\n  { run: () => {} },\n];\n', '缺 name 字段');
  // ③ 移走一个条目（幽灵条目形态）→ 显式报告缺失项（列出文件名）
  const missingRel = 'CHANGELOG-zh.md';
  if (!SYSTEM_TEST_COUNT_FILES.includes(missingRel)) throw new Error('夹具前提失效：' + missingRel + ' 不在受检清单内');
  fs.rmSync(path.join(dir, missingRel));
  const missingProblems = await systemTestCountSyncProblems(dir, scriptsDir);
  if (!missingProblems.some((p) => p.includes('缺失') && p.includes(missingRel))) {
    throw new Error('系统测试集项数缺失条目未被显式报告: ' + JSON.stringify(missingProblems));
  }
  // ④ 条目在场但项数未同步 → 同样上报（缺省放过即为静默失检）
  writeFile(dir, missingRel, '未同步的内容\n');
  const stale = (await systemTestCountSyncProblems(dir, scriptsDir)).join(' | ');
  if (!stale.includes('未同步') || !stale.includes(missingRel)) {
    throw new Error('系统测试集项数未同步条目未被上报: ' + stale);
  }
  // ⑤ 维护者组整组在场判定：组目录缺席 → 整组跳过（CI 全新检出形态，不可判成假红）
  writeFile(dir, missingRel, itemCount + ' items\n');
  const groupAbsent = await systemTestCountSyncProblems(dir, scriptsDir);
  if (groupAbsent.length !== 0) {
    throw new Error('组目录缺席时应整组跳过: ' + JSON.stringify(groupAbsent));
  }
  // ⑥ 组目录在场 → 逐条严检：成员缺席照样显式报告（"整组跳过"不等于"组内在场者免检"）
  writeFile(dir, path.posix.join(MAINTAINER_DOC_DIR, 'stand-in.md'), 'stand-in\n');
  const mntMissing = await systemTestCountSyncProblems(dir, scriptsDir);
  if (!mntMissing.some((p) => p.includes('缺失') && p.includes(SYSTEM_TEST_COUNT_FILES_MAINTAINER[0]))) {
    throw new Error('维护者组成员缺席未被显式报告: ' + JSON.stringify(mntMissing));
  }
  // ⑦ 组文件目录缺失 → fail-closed 且指向真实缺口（组文件目录），不静默计 0。三种输入形态：
  // A 目录缺席 / A′ 空目录 / B 真实安装形态（目录缺席而套件入口在场——派生不得回落去解析入口文本，
  // 改动前此处抛 `ReferenceError: GROUP_A is not defined`）。
  const itemsDir = path.join(scriptsDir, 'items');
  const expectMissingDir = async (label) => {
    let caught = null;
    try {
      await systemItemCount(scriptsDir);
    } catch (e) {
      caught = e;
    }
    if (!caught || caught.code !== 'COUNT_SOURCE_MISSING') {
      throw new Error(label + '：组文件目录缺失未抛 COUNT_SOURCE_MISSING: '
        + (caught ? (caught.code + ' ' + caught.message) : '未抛错'));
    }
    if (!String(caught.message).includes(itemsDir)) {
      throw new Error(label + '：缺失报告未指向组文件目录 ' + itemsDir + ': ' + caught.message);
    }
    const reported = (await systemTestCountSyncProblems(dir, scriptsDir)).join(' | ');
    if (!reported.includes('缺失') || !reported.includes('scripts/items')) {
      throw new Error(label + '：消费方的显式「缺失」报告未指向组文件目录: ' + reported);
    }
  };
  fs.rmSync(itemsDir, { recursive: true, force: true });
  await expectMissingDir('形态 A（目录缺席）');
  fs.mkdirSync(itemsDir, { recursive: true });
  await expectMissingDir('形态 A′（空目录）');
  fs.rmSync(itemsDir, { recursive: true, force: true });
  writeFile(scriptsDir, 'system-test.mjs', 'const TEST_ITEMS = [\n  ...GROUP_A,\n];\n');
  await expectMissingDir('形态 B（组文件目录缺席，套件入口在场）');
}
// ---------- 词表镜像漂移判据（主仓私有单一来源 ↔ 分发套件的同义镜像） ----------
// 背景：套件随技能包分发、不能 import 主仓私有的 .githooks（该面不随 clone 分发），故套件内
// 保留同义镜像 PUBLIC_CODE_RE。两份此前只有注释互指"同步"，零一致性判据：主仓增补模式时
// 分发侧扫描静默落后（新词可在公开面长期存活而套件全绿），反向则分发面误红——正是
// 「同一判据两份实现必然分叉」点名的形态。本判据把等价性变成机检事实：
//   · 主仓形态（权威源检出）：读 .githooks 的 BANNED.source，与套件镜像**逐字符比对**，
//     不等即报（消息含两侧 source 片段、长度与首个差异位置，可直接定位）；
//   · 安装副本形态：该私有面结构性缺席 → 判据**不适用**，由调用方输出显式「不适用」描述符
//     （未验证 ≠ 通过，与维护者面缺席的可见 SKIP 同族语义）。
export const GITHOOKS_CODES_REL = path.posix.join('.githooks', 'internal-codes.mjs');

// 导出正则字面量抽取（\ 转义感知）：从 `export const <name> = /<body>/<flags>;` 取 body 与 flags。
// 解析失败返回 null（调用方按"判据未执行"显式报告，不静默放过）。
export function extractExportedRegexLiteral(text, name) {
  const re = new RegExp('export\\s+const\\s+' + name + '\\s*=\\s*/((?:\\\\.|[^/\\\\\\n])*)/([a-z]*)\\s*;');
  const m = re.exec(text);
  return m === null ? null : { source: m[1], flags: m[2] };
}

export function vocabularyMirrorProblems(root = REPO_ROOT) {
  const problems = [];
  const rel = GITHOOKS_CODES_REL;
  let text;
  try {
    text = fs.readFileSync(path.join(root, rel), 'utf8');
  } catch (e) {
    const reason = e && e.code ? e.code : (e && e.message ? e.message : String(e));
    problems.push('词表镜像漂移判据无法执行: ' + rel + ' 读取失败（' + reason
      + '）——未执行 ≠ 通过；请在主仓私有面在场处重跑（主树 L1）');
    return problems;
  }
  const banned = extractExportedRegexLiteral(text, 'BANNED');
  if (banned === null) {
    problems.push('词表镜像漂移判据无法执行: ' + rel + ' 未解析出导出的 BANNED 正则字面量'
      + '（词表单一来源形态变化）——未执行 ≠ 通过');
    return problems;
  }
  const mine = PUBLIC_CODE_RE.source;
  if (banned.source !== mine) {
    const shared = Math.min(banned.source.length, mine.length);
    let firstDiff = shared;
    for (let i = 0; i < shared; i += 1) {
      if (banned.source[i] !== mine[i]) { firstDiff = i; break; }
    }
    const fragment = (s) => (s.length > 80 ? s.slice(0, 80) + '…' : s);
    problems.push('词表镜像漂移: ' + rel + ' 的 BANNED.source（' + banned.source.length
      + ' 字符）≠ 套件 PUBLIC_CODE_RE.source（' + mine.length + ' 字符）；首个差异位置 ' + firstDiff
      + '；主仓侧片段「' + fragment(banned.source) + '」；套件侧片段「' + fragment(mine)
      + '」——两侧必须逐字符等价，请同改（词表只许收窄、不许放宽）');
  }
  if (banned.flags !== PUBLIC_CODE_RE.flags) {
    problems.push('词表镜像标志位漂移: ' + rel + ' 的 BANNED flags=' + JSON.stringify(banned.flags)
      + ' ≠ 套件 PUBLIC_CODE_RE flags=' + JSON.stringify(PUBLIC_CODE_RE.flags));
  }
  return problems;
}

export function twoLayerEntryProblems(rel, text) {
  const out = [];
  if (text.includes('见上方 Required Calls 表')) out.push(rel + ' 含 Implementation/Required 混淆句式');
  if (text.includes('record 会自动补写缺失的声明标记')) out.push(rel + ' 含无限定自动补表述');
  if (!text.includes('Skill 工具加载该节点的 Implementation 技能')) out.push(rel + ' 缺入口层锚点句');
  if (!text.includes('前置门')) out.push(rel + ' 缺前置门表述');
  return out;
}

// 技能加载措辞判据（场景 164 使用；纯函数 + 合成输入可驱动）：主 SKILL / 入口展开册 / 八个节点册
// 各须含「Skill 工具」与「不得跳过 / 禁止跳过」两条存在级锚点句（加载 = Skill 工具注入会话，
// 只读文件不叫加载）。返回问题描述数组（空 = 两条齐备）；判别力由场景内的逐条抽掉构造常驻证明。
export function skillLoadingWordingProblems(rel, text) {
  const out = [];
  if (!text.includes('Skill 工具')) out.push(rel + ' 缺「Skill 工具」');
  if (!text.includes('不得跳过') && !text.includes('禁止跳过')) out.push(rel + ' 缺「不得跳过/禁止跳过」');
  return out;
}

// 委托纪律三块归一处（场景 184 的 ⑥ 使用；纯函数 + 合成输入可驱动）：ADR-016 把「两册三块逐字
// 一致（切片 ≥400 字符）+ 两册各持 41 条判别句」重定向为「两册各自的要点句在场 + 权威处唯一 +
// 留正文的判别句逐句留原文但**不再要求两册相同**」。归一处：pathspec 五要素与集成四要素的**全文**
// → `reference/commit-discipline.md`；四属性契约（能力契约锚）→ 两册正文 + 入口册 + 平台事实册。
//   ① 要素级 token 组：措辞可分叉（逐字锁已作废），但**要素一条不得缺**（两册 + 权威处同时受限）；
//   ② 权威处正文在场：权威处独有的判别句必须在该文件（缺句即红）；
//   ③ 权威处唯一：权威处正文**回流任一册即红**——这一侧原逐字锁完全没有（它**要求**两册各持一份）；
//   ④ 证据与判级类判别句（随平台事实移走）：只在权威处，回流册子即红；
//   ⑤ 条件句指针：两册各自须指向 commit-discipline / platform-facts / fix-loop 三个权威文件。
export const COMMIT_DISCIPLINE_REL = 'flow-comet/reference/commit-discipline.md';
export const PLATFORM_FACTS_REL = 'flow-comet/reference/platform-facts.md';
export const COMMIT_DISCIPLINE_ELEMENT_GROUPS = [
  ['提交面 pathspec 纪律 · 适用条件', ['**各自独立工作区（worktree 等）内的局部 `reset` / `clean` 不在禁令内**']],
  ['提交面 pathspec 纪律 · 要素 1（字面路径集）',
    ['`git add -- <自己字面路径>`', '`git commit -- <同一路径>`', 'write_files']],
  ['提交面 pathspec 纪律 · 要素 2（锁失败重试）', ['锁失败重试', 'index.lock', '失败即重试']],
  ['提交面 pathspec 纪律 · 要素 3（禁裸命令）',
    ['禁裸', '`commit -a`', '`stash`', '`clean`', '`reset`']],
  ['提交面 pathspec 纪律 · 要素 4（为什么 · 索引竞态）', ['并发索引竞态', '索引与工作树']],
  ['提交面 pathspec 纪律 · 要素 5（并行波次附加两条）', ['`git commit --amend`', '`--soft`']],
  ['集成纪律 · 要素 1（机制选择）', ['`git merge --no-ff`', 'cherry-pick']],
  ['集成纪律 · 要素 2（顺序）', ['拓扑序', 'task id 升序']],
  ['集成纪律 · 要素 3（审计留痕）', ['INTEGRATE: <task-id> <commitHash> → <集成提交>']],
  ['集成纪律 · 要素 4（冲突处置两类）', ['机械冲突', '语义冲突', '上抛']],
];
// 权威处**正文**（逐字搬运进 `commit-discipline.md` 的原句；实测两册均无这些整句——回流即红）。
export const COMMIT_DISCIPLINE_AUTHORITY_PHRASES = [
  '2. **`git commit -- <同一路径>`**：提交以 pathspec 限定范围，保证提交只含自己的文件；路径集与上一步**逐字一致**。',
  '3. **锁失败重试**：并发提交会撞 `index.lock` / `cannot lock ref`——**失败即重试**（临时仓真并发实测：20 提交 / 25 次锁失败全部重试成功）；不得因锁失败改用宽泛命令。',
  '5. **为什么**：并发写者共享**同一个索引与工作树**——宽泛命令存在**并发索引竞态**：一方 `add -A` 会把另一方的半成品纳入自己的提交（串味 / 多文件提交）；`stash` / `clean` / `reset` 更会直接破坏同伴的未提交工作。',
  '**并行波次附加两条（与上列五要素并列适用 · 不改其语义与适用条件）**：',
  '- **并行波次禁用 `git commit --amend`**：共享工作区下 HEAD 会被并行写者推进——`--amend` 改的是 **HEAD 指向的提交**、不一定是「你的提交」，会把同伴的提交连同提交信息一并改写（本仓实测撞过：amend 误改了另一并行任务的提交，经 `reset --soft` 复原，内容零损失）。确需修正时必须**先断言 `git rev-parse HEAD` 等于自己刚提交的哈希**，否则一律改用**新提交追加**。',
  '- **误改后的自救通道（与上列第 4 条的定向例外）**：合法修复路径 = **先断言** `git rev-parse HEAD` 即被误改的那次提交，再 `git reset --soft <自己的父提交>` 回退（**只用 `--soft`**：只移动 HEAD、不动索引与工作树，同伴的未提交工作零影响），最后以 **pathspec** 重建自己的提交。纪律必须留出这条明路——让执行者**不必违规**（force-push / 手改历史）即可收拾；**无合法修复通道时人会暗改**（见 ADR-013 记录的同型教训）。',
  '2. **顺序（确定性规则）**：先按 `depends_on` 的**拓扑序**集成（被依赖者先入）；同一拓扑层内按 **task id 升序**（计划期固定的稳定键，与完成先后无关）。**不得依赖书写顺序** / 提交到达顺序 / 完成先后等运行期不确定量。',
  '3. **审计留痕**：每次集成输出一行审计行 `INTEGRATE: <task-id> <commitHash> → <集成提交>`；降级路径为 `INTEGRATE: <task-id> <commitHash> via cherry-pick -- 降级原因：<原因>`。映射（task-id → commitHash → 集成提交）记入该趟流程记录（`<task-id>-SUMMARY.md` / handoff evidence 文本字段）。**判级**：审计行是**执行纪律**（review 把关），本节点不声称存在机械门禁校验它。',
  '   - **机械冲突**（不改用户可见行为：同一文件不同区域 / 相邻行 / 纯格式）：执行者**可自行解决**——解决后必须跑**合并后验证**（该任务 `verify` + 受影响任务的判据），并在审计行记录冲突与解决方式。',
  '   - **语义冲突**（两侧对同一行为 / 契约 / 接口给出不同语义：同一函数语义分叉、同一 AC 的两种实现、公共 API 形状不一致）：**必须中止集成并上抛**（记 BLOCKED + 恢复指引），**不得**由执行者自行拍板；由协调者 / 用户裁决（补 `depends_on`、拆任务或开新 change）。',
];
// 四属性契约（能力契约锚 · ADR-016 明示「该怎么干」类 ⇒ 留两册正文；两册不再要求逐字相同）。
export const PARALLEL_CONTRACT_BOOK_PHRASES = [
  '> **并行安全四属性契约**：契约对象是**四属性**，不是 worktree',
  '| ① | **写权限** | 每个写者必须有一条被守卫认可的写入通道 |',
  '| ③ | **验证隔离** | 同一时刻只有一个写者：全量判据不得与在飞写者并行 |',
  '出口校验锚 = `handoffRequests` 有 request 无对应 `handoffResult` ⇒ 新 change BLOCKED / 旧 change WARN；全部有 result ⇒ 放行；无证据 ⇒ 零输出',
  '**已撤回的 request 不构成在飞委托**',
  '`workflow-handoff.mjs withdraw <task-id> --by <来源>` 在原记录上留痕 `withdrawnAt` + `withdrawnBy`，已撤回 = 终态、历史不删',
  '**并同时注入桥接通道标记 `FLOW_COMET_AGENT_DEPTH_SOURCE`——守卫要求标记与深度同时在场才接受该通道**',
  '**写面含 gitignored 面的任务（四属性映射 · 与其他任务同一判据）**',
  '① **写权限**仍走**身份通道**',
  '② **提交隔离**走既有 **`noCommit` 资格**',
  '**并行 × 零提交**因此合法',
  '**留痕的边界（诚实声明 · 与 `directOverride` / `completedChecks` / `reentryAuthorization` 同族）**',
  '留痕记录的是「**发生过委派**」，**不是**对执行者身份的物理证明',
  '与 `completedChecks` 只能记录声明、`directOverride` 只能记录授权、`reentryAuthorization` 只能记录授权源同理',
];
// 四属性的四个属性名（硬约束要求保留的能力契约锚；两册正文逐册在场）。
export const PARALLEL_CONTRACT_ATTRIBUTE_NAMES = ['**写权限**', '**提交隔离**', '**验证隔离**', '**集成纪律**'];
// 证据与判级类判别句（ADR-016 ⑥：随平台事实移走）——只在 `platform-facts.md`，回流册子即红。
export const CONTRACT_EVIDENCE_AUTHORITY_PHRASES = [
  '**+ 通道标记 `FLOW_COMET_AGENT_DEPTH_SOURCE`**；0 / 缺失 / 无标记 = 协调者',
  '**证实**——Codex 交互式会话的原生子代理载荷含 `agent_id`',
  '**推翻**——「Codex 载荷无身份字段」只对 `codex exec` headless 主线程成立，**不得外推**为平台结论。',
  '**未覆盖（显式标注，不得写成已支持）**',
  '> | **Claude Code** | 身份分派（载荷含 `agent_id` / `agent_type`——**证实**：真机实测子代理载荷含二者、主会话载荷不含，与 Codex 同一判据）',
  'CC 子代理载荷含 `agent_id` / `agent_type`（真机实测：子代理载荷含二者、主会话载荷不含，与 Codex 同一判据）',
  '非 `bypassPermissions` 权限模式下的载荷形态',
];
// 两册各自须持的三个条件句指针（`reference/fix-loop.md` 属修复回路段，见场景 258）。
export const DELEGATION_POINTER_RELS = [
  'reference/commit-discipline.md', 'reference/platform-facts.md', 'reference/fix-loop.md',
];
export function delegationDisciplineProblems({ books, elementDocs, authorityTexts }) {
  const problems = [];
  for (const [rel, text] of elementDocs) {
    for (const [label, tokens] of COMMIT_DISCIPLINE_ELEMENT_GROUPS) {
      const missing = tokens.filter((token) => !text.includes(token));
      if (missing.length > 0) {
        problems.push(rel + ' 缺「' + label + '」要点句（缺 token: ' + missing.join(' / ') + '）');
      }
    }
  }
  const authorityText = authorityTexts.get(COMMIT_DISCIPLINE_REL);
  for (const phrase of COMMIT_DISCIPLINE_AUTHORITY_PHRASES) {
    if (!authorityText.includes(phrase)) {
      problems.push(COMMIT_DISCIPLINE_REL + ' 缺权威处判别句：' + phrase.slice(0, 40) + '…');
    }
    for (const [rel, text] of books) {
      if (text.includes(phrase)) {
        problems.push(rel + ' 回流了 ' + COMMIT_DISCIPLINE_REL + ' 的权威处正文：' + phrase.slice(0, 40) + '…');
      }
    }
  }
  for (const [rel, text] of books) {
    for (const phrase of PARALLEL_CONTRACT_BOOK_PHRASES) {
      if (!text.includes(phrase)) {
        problems.push(rel + ' 缺四属性契约判别句：' + phrase.slice(0, 40) + '…');
      }
    }
    for (const attribute of PARALLEL_CONTRACT_ATTRIBUTE_NAMES) {
      if (!text.includes(attribute)) {
        problems.push(rel + ' 缺四属性契约属性名：' + attribute);
      }
    }
    for (const pointer of DELEGATION_POINTER_RELS) {
      if (!text.includes(pointer)) {
        problems.push(rel + ' 缺条件句（指针不在场）: ' + pointer);
      }
    }
  }
  const evidenceText = authorityTexts.get(PLATFORM_FACTS_REL);
  for (const phrase of CONTRACT_EVIDENCE_AUTHORITY_PHRASES) {
    if (!evidenceText.includes(phrase)) {
      problems.push(PLATFORM_FACTS_REL + ' 缺证据与判级判别句：' + phrase.slice(0, 40) + '…');
    }
    for (const [rel, text] of books) {
      if (text.includes(phrase)) {
        problems.push(rel + ' 回流了证据与判级判别句：' + phrase.slice(0, 40) + '…（权威处唯一）');
      }
    }
  }
  return problems;
}

// 前端判据散文口径（场景 286 使用；纯函数 + 合成文本面可驱动）：ADR-016 把原「五份文本**各自**
// 陈述五个结构 token」重定向为「**一处权威**（`flow-comet-ui-design` 册的「触发与跳过」段陈述
// 结构形态三种 + 词形边界 + 命中片段回显）+ **各引用册指针在场**（条件句指向该册，缺即红）+
// **该口径正文唯一**（块级跨距：任何其它分发文本不得含权威口径段的 ≥ `FRONTEND_CRITERION_BLOCK_SPAN`
// 字符逐字副本——短片段（要素名 / 命令形态 / 互指指针 / 压缩要点句）天然重合，按 T-03 实测建议
// 取块级跨距，避免必然假红）。反向构造的目标随之从「每份文本」改到**权威处**。
export const FRONTEND_CRITERION_AUTHORITY_REL = 'flow-comet-ui-design/SKILL.md';
export const FRONTEND_CRITERION_BLOCK_SPAN = 120;
// 各引用册的指针判别句式（逐册 token 组：必须同指该唯一权威，缺一册即红）。
export const FRONTEND_CRITERION_POINTER_RELS = [
  ['flow-comet/SKILL.md', ['唯一权威是 `flow-comet-ui-design` 册']],
  ['flow-comet-design/SKILL.md', ['唯一权威 → `flow-comet-ui-design` 册', '「触发与跳过」段']],
  ['flow-comet-change/SKILL.md', ['**判据与强制等级（唯一权威）**', '`flow-comet-ui-design` 册的「触发与跳过」段']],
];
export function frontendCriterionAuthorityBlock(text) {
  const match = /「结构形态」的三种任一[\s\S]*?仍判前端。/.exec(text);
  return match ? match[0] : null;
}
export function frontendCriterionRedirectProblems({ authorityRel, authorityText, pointerDocs, docs }) {
  const problems = [];
  // ① 一处权威：结构形态五 token 齐备（同一判据前端散文函数）+ 旧口径零残留。
  problems.push(...frontendCriterionProseProblems(authorityRel, authorityText));
  const block = frontendCriterionAuthorityBlock(authorityText);
  if (block === null) {
    problems.push(authorityRel + ' 缺权威口径段（「结构形态」三种任一 → 仍判前端 的整段）');
  } else if (block.length < FRONTEND_CRITERION_BLOCK_SPAN) {
    problems.push(authorityRel + ' 权威口径段过短（' + block.length + ' 字符 < '
      + FRONTEND_CRITERION_BLOCK_SPAN + '）——正文唯一性判据无从成立');
  }
  // ② 各引用册指针在场：每册须含指向该权威的条件句（缺任一册即红）。
  for (const [rel, tokens] of FRONTEND_CRITERION_POINTER_RELS) {
    const text = pointerDocs.get(rel);
    if (text === undefined) {
      problems.push(rel + ' 不在场（前端判据的引用册指针无从校验）');
      continue;
    }
    const missing = tokens.filter((token) => !text.includes(token));
    if (missing.length > 0) {
      problems.push(rel + ' 指针不在场（缺指向 ' + authorityRel + ' 的条件句 token: ' + missing.join(' / ') + '）');
    }
  }
  // ③ 正文唯一：权威口径段不得在第二份分发文本里逐字出现（块级跨距）。
  if (block !== null) {
    for (const [rel, text] of docs) {
      if (rel === authorityRel) continue;
      const span = longestCommonSpan(block, text);
      if (span.length >= FRONTEND_CRITERION_BLOCK_SPAN) {
        problems.push(rel + ' 出现结构判据口径的第二份正文（连续同文 ' + span.length + ' 字符 ≥ '
          + FRONTEND_CRITERION_BLOCK_SPAN + '）——权威处唯一');
      }
    }
  }
  return problems;
}

// 修复回路状态机路径（场景 258 使用；纯函数 + 合成输入可驱动）：ADR-016 把「三册段正文 sha256
// 完全一致」的逐字锁重定向为「三册各含要点句与条件句 + 该段正文**仅一处**（权威 =
// `reference/fix-loop.md`）+ 原 6 个关键词与『禁 `advance` 作正常路径』断言**迁到权威处**」。
// 要点句取**要素级 token 组**（措辞可分叉——ADR-016 明示三册口径一致但不再要求逐字相同）；
// 「仅一处」用块级跨距（连续同文 ≥ `FIX_LOOP_BLOCK_SPAN` 字符）判：册子的要点句与权威段落天然
// 局部重合（公式化命令形态 / 要素名），短片段不计——只有把权威段落**整段复制回册子**才红。
export const FIX_LOOP_AUTHORITY_REL = 'flow-comet/reference/fix-loop.md';
export const FIX_LOOP_SECTION_HEADING = '## 修复回路状态机路径';
export const FIX_LOOP_AUTHORITY_KEYWORDS = [
  '受控归位', 'NODE: execute', '回源节点跑出口', 'entry <源节点>', 'exit <源节点> --apply', '禁止绕过',
];
export const FIX_LOOP_BLOCK_SPAN = 120;
export const FIX_LOOP_BOOK_ELEMENT_GROUPS = [
  ['追加 Fix 任务', ['## Fix 任务', '禁止文件尾追加']],
  ['受控归位 execute', ['受控归位', 'NODE: execute']],
  ['execute 四类出口', ['record execute', 'exit execute --apply', '任务集签名']],
  ['回源节点跑出口', ['回源节点跑出口', 'entry <源节点>', 'exit <源节点> --apply']],
  ['禁止绕过', ['禁止绕过', 'BLOCKED']],
  ['条件句指针', ['reference/fix-loop.md']],
];
// 段切片（同一区间：首个 `## 修复回路状态机路径` → 下一 `##` 或 EOF，标题不计入）。
export function fixLoopStateMachineSectionOf(text) {
  const match = text.match(/(?:^|\r?\n)## 修复回路状态机路径\r?\n([\s\S]*?)(?=\r?\n## |$)/);
  return match ? match[1].replace(/\r\n/g, '\n') : null;
}
export function fixLoopStateMachineProblems({ books, authority }) {
  const problems = [];
  for (const [rel, text] of books) {
    const section = fixLoopStateMachineSectionOf(text);
    if (section === null) {
      problems.push(rel + ' SKILL.md 缺「' + FIX_LOOP_SECTION_HEADING + '」段');
      continue;
    }
    if (section.trim() === '') problems.push(rel + ' 修复回路状态机路径段不得为空');
    for (const [label, tokens] of FIX_LOOP_BOOK_ELEMENT_GROUPS) {
      const missing = tokens.filter((token) => !section.includes(token));
      if (missing.length > 0) {
        problems.push(rel + ' 缺「' + label + '」要点句（缺 token: ' + missing.join(' / ') + '）');
      }
    }
    // 反捷径（册内一侧）：`advance` 不作正常路径；「直接 exit 源节点收场」只允许以被禁形态出现。
    if (section.includes('advance')) {
      problems.push(rel + ' 修复回路状态机路径段不得把 advance 作为正常路径');
    }
    for (const line of section.split(/\r?\n/)) {
      if (line.includes('直接') && line.includes('exit') && !/禁止|不得|会被 BLOCKED/.test(line)) {
        problems.push(rel + ' 修复回路状态机路径段不得把直接 exit 源节点收场作为正常路径: ' + line.trim());
      }
    }
  }
  // 权威处：原 6 个关键词 + 反 advance + 「禁止直接 exit 收场」断言全部迁到该文件。
  const authoritySection = fixLoopStateMachineSectionOf(authority);
  if (authoritySection === null) {
    problems.push(FIX_LOOP_AUTHORITY_REL + ' 缺「' + FIX_LOOP_SECTION_HEADING + '」段（唯一权威处缺失）');
    return problems;
  }
  for (const keyword of FIX_LOOP_AUTHORITY_KEYWORDS) {
    if (!authoritySection.includes(keyword)) {
      problems.push(FIX_LOOP_AUTHORITY_REL + ' 修复回路段缺关键词: ' + keyword);
    }
  }
  if (authoritySection.includes('advance')) {
    problems.push(FIX_LOOP_AUTHORITY_REL + ' 修复回路段不得把 advance 作为正常路径');
  }
  let hasForbiddenForm = false;
  for (const line of authoritySection.split(/\r?\n/)) {
    if (line.includes('直接') && line.includes('exit') && /禁止|不得|会被 BLOCKED/.test(line)) hasForbiddenForm = true;
    if (line.includes('直接') && line.includes('exit') && !/禁止|不得|会被 BLOCKED/.test(line)) {
      problems.push(FIX_LOOP_AUTHORITY_REL + ' 修复回路段不得把直接 exit 源节点收场作为正常路径: ' + line.trim());
    }
  }
  if (!hasForbiddenForm) {
    problems.push(FIX_LOOP_AUTHORITY_REL + ' 修复回路段缺「禁止直接 exit 源节点收场」的显式断言（原册内断言未随迁）');
  }
  // 正文唯一：权威段落整段回流任一册即红（块级跨距 ≥ FIX_LOOP_BLOCK_SPAN）。比对面取**整册正文**：
  // 复制回流的落点不限于同名小节（换个标题贴进别处同样算第二份正文）。
  for (const [rel, text] of books) {
    const span = longestCommonSpan(authoritySection, text);
    if (span.length >= FIX_LOOP_BLOCK_SPAN) {
      problems.push(rel + ' 出现 ' + FIX_LOOP_AUTHORITY_REL + ' 的第二份正文（该段正文仅一处；连续同文 '
        + span.length + ' 字符 ≥ ' + FIX_LOOP_BLOCK_SPAN + '）');
    }
  }
  return problems;
}

// 技能树正文里的**相对路径引用必须解析得到**（场景 184 附；纯函数 + 合成输入可驱动）：本轮
// `GUIDANCE.md` → `reference/entry-detail.md` 的改名曾造成 5 册死引用而**零红灯**——技能树正文的
// 相对引用此前没有任何机检覆盖（只能靠人工/子代理顺带发现）。判据面刻意收窄到技能树内的
// `reference/**.md|json` 相对引用。
// **解析基准 = 引用处所在册的册根**（不是「任何册都按入口册册根解析」）：裸形态 `reference/<file>`
// 是**册根相对**形态，故候选 = ① 引用处文件所在目录（入口册 `SKILL.md` 与入口册 `reference/**`
// 展开面正是这一形态）；② 引用处**所在册的册根**（`<册>/reference/<file>`，覆盖展开面文件引用
// 同册兄弟文件的写法）。跨册引用必须写**显式形态** `../flow-comet/reference/<file>`（先例 =
// `flow-comet-compose` 引 `../flow-comet/reference/workflow-protocol.json`），只对该形态接受
// **入口册册根**这一额外候选——裸形态在节点册里因此**解析不到即红**：节点册没有 `reference/`
// 目录，而旧实现给每个引用合成「入口册册根」第二候选，把节点册里的裸指针一律静默判绿
//（**为抓这一类而写的锚放过了这一类的实例**）。
// `flow-kit/**` 一类**技能树外**引用不在判据面（其根随安装形态变化，由项目根决定）。
export const SKILL_TREE_REFERENCE_RE = /(?<!flow-kit\/)(?<![\w./-])(?:\.\.\/flow-comet\/)?reference\/[A-Za-z0-9._-]+\.(?:md|json)/g;
export const SKILL_TREE_ENTRY_BOOK = 'flow-comet';
export const SKILL_TREE_EXPLICIT_REFERENCE_PREFIX = '../flow-comet/';
export function skillTreeReferenceCandidates(rel, ref) {
  const tail = ref.replace(/^\.\.\/flow-comet\//, '');
  const explicit = ref.startsWith(SKILL_TREE_EXPLICIT_REFERENCE_PREFIX);
  // 裸形态按**引用处所在册的册根**解析；跨册解析只对显式形态开放（收窄点）。
  const crossBookRoot = explicit ? SKILL_TREE_ENTRY_BOOK : rel.split('/')[0];
  return [
    path.posix.normalize(path.posix.join(path.posix.dirname(rel), ref)),
    path.posix.normalize(path.posix.join(crossBookRoot, tail)),
  ];
}
export function skillTreeReferenceProblems(docs, skillsRoot) {
  const problems = [];
  for (const [rel, text] of docs) {
    for (const ref of new Set(text.match(SKILL_TREE_REFERENCE_RE) ?? [])) {
      const candidates = skillTreeReferenceCandidates(rel, ref);
      if (!candidates.some((candidate) => fs.existsSync(path.join(skillsRoot, candidate)))) {
        problems.push(rel + ' 的相对路径引用解析不到: ' + ref + '（候选: ' + candidates.join(' / ') + '）');
      }
    }
  }
  return problems;
}

// **成对展开文件的指针不得指错**（场景 184 附 2；纯函数 + 合成输入可驱动）：本仓是「`SKILL.md` 手写区 +
// **同目录同名 `GUIDANCE.md` 展开版**」的成对形态——册首注释里的**裸文件名**指本册自己那份。修"死引用"
// 的过程里四册曾被改成指向**入口册**的展开版（`../flow-comet/reference/entry-detail.md`）：目标确实存在、
// 上面那条解析判据全绿，但它**指错了文档**，各册展开版里的独有内容从此再无入口可读——「**能解析 ≠ 指对了**」。
// 判据 = ① 同目录有同名 `GUIDANCE.md` 的册 ⇒ 指针必须是裸文件名 `GUIDANCE.md`（本册那份）；
// ② 入口册（无同名展开版，展开版为 `reference/entry-detail.md`）⇒ **唯一例外**，指针必须是该文件；
// ③ 既无同名展开版又非入口册的册 ⇒ 不允许出现该指针（在册里指谁都是指错）。
// 取目标用**注释整句的捕获组**（不是"是否含 `GUIDANCE.md` 子串"）——裸子串判据会被同文件其它
// 上下文满足而恒真空过，下文的反向构造即证「换成别处的展开版必红」。
export const PAIRED_GUIDANCE_ENTRY_REL = 'flow-comet/SKILL.md';
export const PAIRED_GUIDANCE_ENTRY_TARGET = 'reference/entry-detail.md';
export const PAIRED_GUIDANCE_POINTER_RE = /<!--\s*手写区详细协议见\s*([^\s（）]+)（可选阅读）\s*-->/g;
export function pairedGuidancePointerProblems(docs, skillsRoot) {
  const problems = [];
  for (const [rel, text] of docs) {
    if (!rel.endsWith('/SKILL.md')) continue;
    const dir = path.posix.dirname(rel);
    if (dir.includes('/')) continue; // 只判册根层（`<册>/SKILL.md`）
    const targets = [...text.matchAll(PAIRED_GUIDANCE_POINTER_RE)].map((match) => match[1]);
    const hasOwnGuidance = fs.existsSync(path.join(skillsRoot, dir, 'GUIDANCE.md'));
    if (targets.length === 0) {
      if (hasOwnGuidance) {
        problems.push(rel + ' 缺「手写区详细协议见 …」指针（同目录有 GUIDANCE.md ⇒ 指针须在场且指向本册）');
      }
      continue;
    }
    if (targets.length > 1) {
      problems.push(rel + ' 的「手写区详细协议见 …」指针出现 ' + targets.length + ' 处（只允许 1 处）');
    }
    const expected = hasOwnGuidance ? 'GUIDANCE.md'
      : (rel === PAIRED_GUIDANCE_ENTRY_REL ? PAIRED_GUIDANCE_ENTRY_TARGET : null);
    if (expected === null) {
      problems.push(rel + ' 的「手写区详细协议见 …」指针指向 ' + targets.join(' / ')
        + '，但该册既无同目录 GUIDANCE.md 也非入口册（无配对展开版即不得保留指针）');
      continue;
    }
    for (const target of targets) {
      if (target !== expected) {
        problems.push(rel + ' 的「手写区详细协议见 ' + target + '」指错文档（应为 ' + expected + '）');
      }
    }
  }
  return problems;
}

// CC 行判级升格 + 三平台 cwd 语义对照（场景 184 的 ⑦ 使用；纯函数 + 合成文本面可驱动）：判级由
// 「未覆盖」升为「证实」后，落地形态由**两处**承载——入口册（用户可见总表 + 已知边界旁的三平台
// `cwd` 对照，7 条字面量是能力契约锚，本批明文保留）与 `reference/platform-facts.md`（原
// `reference/worktree-notes.md` 的同一批整句随文件移出技能树后**逐字搬入**的新落点）。判据：
// 「两处正文在场 + 其余册零回流（唯一处）+ 旧「未覆盖」判级句零残留」。
export const IDENTITY_UPGRADE_ENTRY_PHRASES = [
  '| ① 写权限 | 载荷 `agent_id` / `agent_type`——**证实**（真机实测：子代理载荷含二者、主会话载荷不含；与 Codex 同一判据） |',
  '**三平台 `cwd` 语义对照（真机实测新增的精确事实 · 「身份先于路径」的精确理由）**',
  '| **Claude Code** | **子代理的工作目录**（`…\\.claude\\worktrees\\<agent-id>`） | **路径判定是正确的** |',
  '| **Codex** | **恒等于会话根**（子代理在 worktree 写入而 `cwd` 仍是主工程） | **路径判定必错** |',
  '| **dsh** | 载荷**无** `cwd`（桥接另读会话 header cwd） | 路径判定**不适用** |',
  '三平台 `cwd` 语义各不相同（正确 / 恒错 / 无）——只有身份判据是三平台同义的',
  '非 `bypassPermissions` 权限模式**均未覆盖**',
];
export const IDENTITY_UPGRADE_AUTHORITY_PHRASES = [
  '载荷 `agent_id` / `agent_type`——**证实**（真机实测：子代理载荷含二者、主会话载荷不含；与 Codex 同一判据）',
  '**三平台 `cwd` 语义对照（真机实测新增的精确事实 · 「身份先于路径」的精确理由）**——同为载荷 `cwd`，三平台语义各不相同；下表**三行各自独立**，缺一行即口径残缺：',
  '| **Claude Code** | **子代理的工作目录**（`…\\.claude\\worktrees\\<agent-id>`） | **路径判定是正确的** |',
  '| **Codex** | **恒等于会话根**（子代理在 worktree 写入而 `cwd` 仍是主工程） | **路径判定必错** |',
  '| **dsh** | 载荷**无** `cwd`（桥接另读会话 header cwd） | 路径判定**不适用** |',
  '三平台 `cwd` 语义各不相同（正确 / 恒错 / 无）——只有身份判据是三平台同义的',
];
export const IDENTITY_UPGRADE_STALE_PHRASES = ['该次实测只覆盖 Codex', '真机会话复核待补', 'CC 隔离树的真实落点探针待补'];
export function identityUpgradeProblems({ entry, facts, others }) {
  const problems = [];
  for (const phrase of IDENTITY_UPGRADE_ENTRY_PHRASES) {
    if (!entry.includes(phrase)) {
      problems.push('flow-comet/SKILL.md 缺「CC 行升格 / 三平台 cwd 对照」判别句式：' + phrase.slice(0, 40) + '…');
    }
  }
  for (const phrase of IDENTITY_UPGRADE_AUTHORITY_PHRASES) {
    if (!facts.includes(phrase)) {
      problems.push(PLATFORM_FACTS_REL + ' 缺「CC 行升格 / 三平台 cwd 对照」判别句式：' + phrase.slice(0, 40) + '…');
    }
  }
  const carried = [...IDENTITY_UPGRADE_ENTRY_PHRASES, ...IDENTITY_UPGRADE_AUTHORITY_PHRASES];
  for (const [rel, text] of others) {
    for (const phrase of carried) {
      if (text.includes(phrase)) {
        problems.push(rel + ' 回流了 cwd 对照 / CC 判级句（唯一处 = 入口册 + 平台事实册）：'
          + phrase.slice(0, 40) + '…');
      }
    }
  }
  for (const [rel, text] of [['flow-comet/SKILL.md', entry], [PLATFORM_FACTS_REL, facts]]) {
    for (const stale of IDENTITY_UPGRADE_STALE_PHRASES) {
      if (text.includes(stale)) {
        problems.push(rel + ' 残留 CC 行旧「未覆盖」判级表述：' + stale);
      }
    }
  }
  return problems;
}

// 平台事实（场景 184 的 ⑤ / ⑦ 使用；纯函数 + 合成输入可驱动）：Codex 平台事实与支持面的判别句
// 随 `worktree-notes.md` 移出技能树后**唯一权威处** = `flow-comet/reference/platform-facts.md`
//（T07 已按「逐字搬运，不重写」搬入）。判据三侧：① 权威处在场（判别句 + 旧独断句只允许被反驳
// 引用形态 + 适用范围限定 + fail-open / 未闭合的现判据）；② 各引用册**指针在场**；③ **证据正文
// 不回流册子**（权威处唯一——原逐字锁「多处各持一份」的方向已反转）。
// `PLATFORM_FACTS_ONLY_PHRASES` 是**证据与过程记录**类判别句（按 ADR-016 的「证据与判级随平台事实
// 移走」分类）：它们只允许出现在权威处，回流任一册即红。
export const PLATFORM_FACTS_ONLY_PHRASES = [
  '**旧结论（实测 2026-08-13；证据已不可复核',
  '`codex features list` 可查',
  '本机真实交互式会话日志中记录到 `spawn_agent` / `wait_agent` / `close_agent` 的实际调用',
  '**静态喂测（独立复现）**',
  '**hook 触发条件**：隔离 `CODEX_HOME` 无持久信任时默认 headless **不执行**项目 hook',
  '实测 3/21；补 `--dangerously-bypass-approvals-and-sandbox` 后 5/5',
  '**交互式 Codex 实测口径',
];
export function platformFactsAuthorityProblems(rel, facts, pointerBooks) {
  const problems = [];
  const refutedClaim = '「Codex 不能委派 / 不使用并行委托」';
  for (const keyword of ['multi_agent', '机制缺口']) {
    if (!facts.includes(keyword)) {
      problems.push(rel + ' 缺「' + keyword + '」（Codex 平台事实与支持面判别锚）');
    }
  }
  // 旧独断句只允许以被反驳引用的完整形态出现：剥离该引用后不得再有残句。
  if (facts.split(refutedClaim).join('').includes('不使用并行委托')) {
    problems.push(rel + ' 残留旧独断句「不使用并行委托」（非被反驳引用形态）');
  }
  if (!facts.includes('不得外推') && !facts.includes('不可外推')) {
    problems.push(rel + ' 缺「不得外推 / 不可外推」适用范围限定');
  }
  for (const keyword of ['fail-open', '未闭合']) {
    if (!facts.includes(keyword)) {
      problems.push(rel + ' 缺「' + keyword + '」（Codex/worktree 订正限定）');
    }
  }
  for (const [stale, label] of [
    ['受支持的工作流仍是串行执行', '旧独断句'],
    ['写入仍会被协调者白名单拦截', '旧过宽句'],
  ]) {
    if (facts.includes(stale)) problems.push(rel + ' 残留「' + stale + '」' + label);
  }
  for (const phrase of PLATFORM_FACTS_ONLY_PHRASES) {
    if (!facts.includes(phrase)) {
      problems.push(rel + ' 缺证据与过程记录判别句：' + phrase.slice(0, 40) + '…');
    }
  }
  for (const [bookRel, text] of pointerBooks) {
    if (!text.includes('reference/platform-facts.md')) {
      problems.push(bookRel + ' 缺「reference/platform-facts.md」条件句（平台事实的引用册指针不在场）');
    }
    for (const phrase of PLATFORM_FACTS_ONLY_PHRASES) {
      if (text.includes(phrase)) {
        problems.push(bookRel + ' 回流了平台事实的证据正文：' + phrase.slice(0, 40) + '…（权威处唯一）');
      }
    }
    if (text.includes('写入会被协调者白名单拦截')) {
      problems.push(bookRel + ' 残留「写入会被协调者白名单拦截」旧过宽句');
    }
  }
  return problems;
}

// 模板权威声明（场景 184 的 ② 使用；纯函数 + 合成文档面可驱动）：ADR-016 把原「14 册同持整句」
// 的逐字锁重定向为「单一权威 + 指针在场 + 正文唯一」三件套。本函数是**单一实现**——真实判据与
// 反向构造探针共用，逐条对应重定向后的一侧：
//   · 指针在场：每份文档须含模板权威锚句，句内按序组合五个锚点（整句语义组合，防拆句 / 半句）；
//   · 该句只在 1 处（册内一侧）：同一文档出现第二处锚行即红（重复回潮的同册形态）；
//   · 单一权威：持锚行必须点名 `flow-kit/templates/**`——段形权威只能指向这一个来源；
//   · 正文唯一（声明块的**正文部分**）：判据面 = 锚行所在的 `>` 块**减去锚行本身**——锚行是全册
//     **按形态要求必须持有**的指针句（「本节点」9 册 / 「本技能」5 册逐字同文属**设计要求**，不是
//     重复），把它算进判据面必然要么假红要么恒真；块内锚行之外的正文行才是「第二份正文」的入口。
//     阈值**按对派生自受保护内容**：一对正文以**较短一侧的实际块长**为界——只要一侧的正文整段
//     （或更长）出现在另一侧即红，两侧各写各的措辞不误伤。**旧写死阈值 400 的教训**（`LESSONS`
//     候选取证）：旧判据面含锚行且阈值写死 400，而实测块长只有 109 / 211（入口册与
//     `reference/entry-detail.md` 曾各持同一段 211 字符块 = 锚行 + archive 读法行）⇒ 锚**数学
//     不可触发**、真实重复就在眼前却恒绿（Coverage Illusion 型假绿）；阈值改为从受保护内容派生
//     后，该对真实重复当场变红，本批同批把重复收成「一处 + 指针」。
export const TEMPLATE_AUTHORITY_SKILLS = [
  'flow-comet-open', 'flow-comet-design', 'flow-comet-plan', 'flow-comet-execute',
  'flow-comet-subagent-execute', 'flow-comet-review', 'flow-comet-verify', 'flow-comet-archive',
  'flow-comet-task',
  'flow-comet-change', 'flow-comet-requirement', 'flow-comet-dev', 'flow-comet-test',
  'flow-comet-integration',
];
export const TEMPLATE_AUTHORITY_ANCHORS = [
  '唯一权威 = ', '`flow-kit/templates/**`', '是历史证据', '不是模板来源', '上一轮就是这么写的',
];
// 整句形态**专有**的展开锚点（短指针形态不含）：出现任一条即要求整句按序齐备（半句 / 拆句防护）。
export const TEMPLATE_AUTHORITY_EXPANSION_ANCHORS = [
  '唯一权威 = ', '是历史证据', '不是模板来源', '上一轮就是这么写的',
];
// 「模板权威」声明的**段落切片**：锚行所在的那一段连续引用行（`>` 块）——正文唯一判据的判据面。
export function templateAuthorityParagraphs(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('模板权威')) continue;
    let start = i;
    while (start > 0 && lines[start - 1].startsWith('>')) start -= 1;
    let end = i;
    while (end + 1 < lines.length && lines[end + 1].startsWith('>')) end += 1;
    out.push(lines.slice(start, end + 1).join('\n'));
  }
  return out;
}
// 声明块的**正文部分** = 块内锚行之外的引用行（锚行是每册必须逐字持有的指针句，见上；空串 =
// 该册只有锚行一行，正文唯一判据对它不发声——「只持指针」是设计要求，不是重复）。
export function templateAuthorityBody(paragraph) {
  return paragraph.split('\n').filter((line) => !line.includes('模板权威')).join('\n');
}
// 最长连续同文跨距（返回该片段本身；空串 = 无重合）。
export function longestCommonSpan(a, b) {
  const left = String(a);
  const right = String(b);
  let best = '';
  const dp = new Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    let prev = 0;
    for (let j = 1; j <= right.length; j += 1) {
      const tmp = dp[j];
      if (left[i - 1] === right[j - 1]) {
        dp[j] = prev + 1;
        if (dp[j] > best.length) best = left.slice(i - dp[j], i);
      } else {
        dp[j] = 0;
      }
      prev = tmp;
    }
  }
  return best;
}
export function templateAuthorityProblems(docs) {
  const problems = [];
  const paragraphs = [];
  for (const [rel, text] of docs) {
    const lines = text.split(/\r?\n/).filter((line) => line.includes('模板权威'));
    if (lines.length === 0) {
      problems.push(rel + ' 缺模板权威整句声明（正向权威 + 反向历史证据组合缺失）');
      continue;
    }
    if (lines.length > 1) {
      problems.push(rel + ' 模板权威锚句出现 ' + lines.length + ' 处（同一册只允许 1 处）');
    }
    const line = lines[0];
    // 指针在场（两形态皆算、缺一即红）：① **短指针形态**——点名唯一权威 `flow-kit/templates/**`；
    // ② **整句形态**——锚点按序组合（正向权威 + 反向历史证据）。ADR-016 的方向是「13 册留短指针」，
    // 故两种形态都必须算通过（当前 14 册为整句形态、入口册与入口展开册为短指针形态，判据对**两种
    // 布局都成立**——书籍侧若按 ADR 收敛成短指针，本锚不会因此变红）。
    if (!line.includes('`flow-kit/templates/**`')) {
      problems.push(rel + ' 的模板权威行未指向 `flow-kit/templates/**`（段形权威被指到别处）');
    }
    if (!line.includes('唯一权威')) {
      problems.push(rel + ' 的模板权威行未声明「唯一权威」（指针未指向唯一来源）');
    }
    // 半句 / 拆句防护：一旦行内出现**整句形态专有**的展开锚点（历史证据 / 反向声明 / 收口句），
    // 五个锚点必须按序齐备（不得只留半句）——短指针形态只点名唯一权威，不触发本项。
    const expansionAnchors = TEMPLATE_AUTHORITY_EXPANSION_ANCHORS.filter((anchor) => line.includes(anchor));
    if (expansionAnchors.length > 0) {
      let cursor = -1;
      for (const anchor of TEMPLATE_AUTHORITY_ANCHORS) {
        const at = line.indexOf(anchor, cursor + 1);
        if (at < 0) {
          problems.push(rel + ' 模板权威整句缺「' + anchor + '」（整句语义组合）');
        } else {
          cursor = at;
        }
      }
    }
    if (text.includes('archive 是模板来源')) {
      problems.push(rel + ' 含「archive 是模板来源」旧反向声明');
    }
    for (const paragraph of templateAuthorityParagraphs(text)) {
      paragraphs.push([rel, templateAuthorityBody(paragraph)]);
    }
  }
  for (let i = 0; i < paragraphs.length; i += 1) {
    for (let j = i + 1; j < paragraphs.length; j += 1) {
      const [relA, bodyA] = paragraphs[i];
      const [relB, bodyB] = paragraphs[j];
      if (relA === relB || bodyA === '' || bodyB === '') continue;
      const span = longestCommonSpan(bodyA, bodyB);
      // 阈值**按对派生自受保护内容**（较短一侧的实际正文块长）：一侧的正文整段出现在另一侧即红。
      const derived = Math.min(bodyA.length, bodyB.length);
      if (span.length >= derived) {
        problems.push('模板权威声明出现第二份展开正文（' + relA + ' ↔ ' + relB
          + '，连续同文 ' + span.length + ' 字符 ≥ 较短一侧正文块长 ' + derived + '）');
      }
    }
  }
  return problems;
}
// 作者面完备性判据（纯函数；真实判据与反向构造探针共用）：实际持「模板权威」声明的技能树文本
// 必须**登记**在受检面（`TEMPLATE_AUTHORITY_SKILLS` + 入口册两件）里；未登记 ⇒ 报「未登记的
// 权威声明」，报错指向真实动作（登记新册）。**单向判定**：受检面成员**缺**声明由
// `templateAuthorityProblems` 的逐份「缺模板权威整句声明」覆盖，故不需要计数相等——计数相等
// 正是同文件别处判据注释明确反对的「以总量取红」自锁探针（合法扩册先撞红，报错指向锚）。
export function templateAuthorityRegistrationProblems(actualHolders, expectedHolders) {
  const problems = [];
  for (const rel of actualHolders) {
    if (!expectedHolders.includes(rel)) {
      problems.push(rel + ' 持有「模板权威」声明但未登记在受检面（新增册须同批登记 TEMPLATE_AUTHORITY_SKILLS）');
    }
  }
  return problems;
}

// ——— 7 字段集合的文本 ↔ 实现一致锚（场景 184 使用） ———
// 唯一权威 = 引擎的 `TASK7_REQUIRED` 常量（plan 出口判据与执行期 `replan` 判据的共同集合来源；所在
// 模块由导出符号反查，锚里不写文件名）。锚**从常量派生**集合后再与技能树文本逐处对账：任一处枚举
// 与判据分叉即红——「两册三处而两级基线全绿」的成因正是「同一口径另写一份、且没有断言绑定」；锚里
// **不得把集合再抄一遍**（抄一遍就是又造一处同口径表达）。
export const TASK7_AUTHORITY_CONSTANT = 'TASK7_REQUIRED';
// 7 字段 BLOCKED 文案的**渲染片段**：文案落点由该片段在引擎面内反查。常量已下沉到最底层模块——
// 「权威常量所在模块」与「渲染文案的模块」不再同址，落点判定不得再假定两者合一。
export const TASK7_MESSAGE_ANCHOR = '任务缺 7 字段（';
// 「7 字段」标记（中文 / 英文两形态）：标记与枚举**同行**是当前唯一形态；标记行不带枚举（指针形态，
// 如「集合见上表」）不算缺席——判据只对「标记 + 枚举」同场的行发声。
export const TASK7_MARKER_RE = /7\s*个?\s*字段|7 required fields|7-field set/;
// 斜杠枚举形态（`` `name` / `read_files` / … ``；同时覆盖无引号的裸形态）。
export const TASK7_RUN_RE = /(?:`?[a-z][a-z_]*`?[ \t]*\/[ \t]*)+`?[a-z][a-z_]*`?/g;
// **已知站点基线**（每站 = 该枚举行上独有的判别句式，即站点的身份）：锚**逐站点**断言「该站点仍持与派生
// 集合一致的枚举」——任一处丢失（改成指针 / 删掉该行 / 抽掉枚举）即红；**新增站点不受限**（自动进入逐处
// 对账，不因新增而红）。身份**不用 `file:line`**：行号随无关编辑漂移，会把「无关改动」误判成「站点丢失」
// （同族自锁——报错方向指向锚而非真实原因）。**站点集合是处数的唯一事实源**（无独立处数常量）。
export const TASK7_KNOWN_SITES = [
  { rel: 'flow-comet-plan/SKILL.md', anchor: '| TASK.md | 至少一个' },
  { rel: 'flow-comet-plan/SKILL.md', anchor: 'Populate 7 required fields per task' },
  { rel: 'flow-comet-plan/SKILL.md', anchor: 'the 7-field set' },
  { rel: 'flow-comet-task/SKILL.md', anchor: '**每任务 7 字段**' },
];
// 探针期望哨兵：该探针要求**零问题**（合法新增站点不得被判违规）——与「必报某问题」的期望区分。
export const TASK7_ZERO_PROBLEMS = '（该探针要求零问题）';

// 从实现侧常量**派生** 7 字段集合（null = 权威常量缺席 ⇒ 由调用方报红，锚里不写第二份集合）。
export function task7RequiredSet(guardSrc) {
  const match = guardSrc.match(new RegExp('const\\s+' + TASK7_AUTHORITY_CONSTANT + '\\s*=\\s*\\[([^\\]]*)\\]'));
  if (!match) return null;
  const fields = match[1].split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter((part) => part !== '');
  return fields.length > 0 ? fields : null;
}

// 值恰好等于权威集合的常量名（断言 BLOCKED 文案**从常量派生**用——文案里再写字面集合即第二处同口径表达）。
export function task7ConstantNames(src, fieldSet) {
  const names = [];
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\[([^\]]*)\];/g;
  let match;
  while ((match = re.exec(src)) !== null) {
    const fields = match[2].split(',')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .filter((part) => part !== '');
    if (fields.length === fieldSet.length && fields.every((field, index) => field === fieldSet[index])) {
      names.push(match[1]);
    }
  }
  return names;
}

// 文案落点（判据形态：不写文件名）：引擎面内**渲染**该 BLOCKED 文案的模块——注释层引用不是渲染点
// （`engineCodeText` 去注释行）。常量搬家、落点新增都不必改锚：新增落点自动进入逐处对账。
export function task7MessageSites(scriptsDir = SCRIPTS_DIR) {
  return [...engineScriptTexts(scriptsDir)]
    .filter(([, text]) => engineCodeText(text).includes(TASK7_MESSAGE_ANCHOR))
    .map(([rel]) => rel);
}

// 值等于权威集合的常量名（文案派生的合法来源）：① 本模块自持的字面常量（`const NAME = [<集合>];`）；
// ② **单源取用**的权威常量（以具名 import 从权威模块取用，含经再导出枢纽的情形）——常量下沉到最底层
// 模块后，文案落点不再自持字面量，取用共享常量同样是「从判据常量派生」，判据「不得再写一遍字面
// 集合」不变。
export function task7DerivationNames(src, fieldSet, { rel, authorityRel, scriptsDir = SCRIPTS_DIR } = {}) {
  const names = task7ConstantNames(src, fieldSet);
  if (rel !== undefined && authorityRel !== undefined
    && engineImportsSymbolFrom({
      text: src, consumerRel: rel, symbol: TASK7_AUTHORITY_CONSTANT, sourceRel: authorityRel, scriptsDir,
    })) {
    names.push(TASK7_AUTHORITY_CONSTANT);
  }
  return names;
}

// 单行「标记同行枚举」提取（逐处对账与站点断言共用同一实现）：返回 { raw, tokens } 列表。
export function task7LineEnumerationTokens(fieldSet, line) {
  if (!TASK7_MARKER_RE.test(line)) return [];
  const out = [];
  for (const raw of line.match(TASK7_RUN_RE) ?? []) {
    const tokens = raw.split('/').map((token) => token.trim().replace(/`/g, ''));
    if (tokens.length < 3) continue;
    // 只认「字段枚举」：过半数 token 落在派生集合内（同行的其它斜杠短语不参与）。
    if (tokens.filter((token) => fieldSet.includes(token)).length * 2 <= tokens.length) continue;
    out.push({ raw, tokens });
  }
  return out;
}

// 技能树「7 字段」枚举行扫描（真实判据与反向构造探针共用同一实现；每处记原始片段供探针精确改行）。
export function task7EnumerationRuns(fieldSet, docs) {
  const runs = [];
  for (const [rel, text] of docs) {
    text.split(/\r?\n/).forEach((line, index) => {
      for (const { raw, tokens } of task7LineEnumerationTokens(fieldSet, line)) {
        runs.push({ rel, line: index + 1, raw, tokens });
      }
    });
  }
  return runs;
}

// 已知站点上的枚举行（站点在场断言与站点级反向构造探针共用同一实现）。
export function task7KnownSiteRuns(fieldSet, docs) {
  const runs = [];
  for (const site of TASK7_KNOWN_SITES) {
    const text = docs.get(site.rel);
    if (typeof text !== 'string') continue;
    text.split(/\r?\n/).forEach((line, index) => {
      if (!line.includes(site.anchor)) return;
      for (const { raw, tokens } of task7LineEnumerationTokens(fieldSet, line)) {
        runs.push({ site, rel: site.rel, line: index + 1, raw, tokens });
      }
    });
  }
  return runs;
}

// 判据：① 每处「标记同行枚举」须与派生集合**逐字同序同值**（含新增站点）；② 每个**已知站点**仍须持有
// 这样的枚举——站点丢失即红（这才是「处数下降即红」的站点级实现，且不与「新增站点」对冲）。
export function task7EnumerationProblems(fieldSet, docs) {
  const out = [];
  const expected = fieldSet.join('/');
  for (const run of task7EnumerationRuns(fieldSet, docs)) {
    const actual = run.tokens.join('/');
    if (actual !== expected) {
      out.push(run.rel + ':' + run.line + ' 的 7 字段枚举与实现集合不一致（文本 ' + actual + ' / 实现 ' + expected + '）');
    }
  }
  const siteRuns = task7KnownSiteRuns(fieldSet, docs);
  for (const site of TASK7_KNOWN_SITES) {
    if (siteRuns.some((run) => run.site === site)) continue;
    out.push('已知 7 字段站点「' + site.anchor + '」（' + site.rel + '）的标记同行枚举不在场'
      + '（该行已改为指针 / 被删 / 枚举被抽掉，或已不含实现集合的多数项）');
  }
  return out;
}

// 判据：「文案落后于判据」静默面——每处 BLOCKED 文案的集合字符串必须从**值等于权威集合的常量**
// 派生（文案区域须出现该常量的 .join('/')，且不得再现该集合的字面拼接）。构造方式变了、渲染结果
// 不变；`sources` = 文案落点（rel → 文本），`context.authorityRel` 供单源取用判定用。
export function task7MessageDerivationProblems(fieldSet, sources, context = {}) {
  const out = [];
  const joined = fieldSet.join('/');
  for (const [rel, src] of sources) {
    const at = src.indexOf(TASK7_MESSAGE_ANCHOR);
    if (at < 0) {
      out.push(rel + ' 未找到「任务缺 7 字段」文案锚点（文案派生判据无从对账）');
      continue;
    }
    const region = src.slice(at, at + 240);
    const constants = task7DerivationNames(src, fieldSet, { ...context, rel });
    if (constants.length === 0) {
      out.push(rel + ' 未找到值等于权威集合的常量（判据与文案的共同来源缺席）');
      continue;
    }
    if (!constants.some((name) => region.includes(name + ".join('/')"))) {
      out.push(rel + ' 的 7 字段 BLOCKED 文案未从判据常量派生（缺 <常量>.join(\'/\')）——文案会静默落后于判据');
    }
    if (region.includes(joined)) {
      out.push(rel + ' 的 7 字段 BLOCKED 文案又写了一遍字面集合（' + joined + '）——第二处同口径表达');
    }
  }
  return out;
}

// 7 字段集合锚的聚合判据（真实判据 + 反向构造探针；场景 184e 调用，返回问题描述数组）。
// **落点反查**（判据形态：不写文件名）：权威常量所在模块由导出符号反查、文案落点由渲染片段反查——
// 模块再切分 / 再搬家不必改锚（"唯一权威在 workflow-guard.mjs 里" 这类布局事实不再在锚里存第二份）；
// 常量模块与文案落点**各自独立**反查（常量下沉后两者不再同址）；任一前提不在场即显式报失效。
export function task7SetAnchorProblems({ docs, scriptsDir = SCRIPTS_DIR }) {
  const out = [];
  const authority = engineDefinitionModule(TASK7_AUTHORITY_CONSTANT, scriptsDir);
  if (authority === null) {
    out.push(TASK7_AUTHORITY_CONSTANT + ' 常量缺席或其定义面不唯一（7 字段集合的唯一权威不在场，文本侧无从对账）: '
      + JSON.stringify(engineDefinitionHits(TASK7_AUTHORITY_CONSTANT, scriptsDir)));
    return out;
  }
  const fieldSet = task7RequiredSet(authority.text);
  if (fieldSet === null || fieldSet.length !== 7) {
    out.push(authority.file + ' 的 ' + TASK7_AUTHORITY_CONSTANT
      + ' 常量元素数 ≠ 7（7 字段集合的唯一权威不在场，文本侧无从对账）');
    return out;
  }
  // 文案落点（plan 出口门禁 + 执行期 replan 各一处）须都在场：任一处文案被删 / 改成指针，文案派生
  // 判定面即残缺——按**前提失效**显式报（不静默取小集后照样判绿）。
  const messageRels = task7MessageSites(scriptsDir);
  if (messageRels.length < 2) {
    out.push('7 字段 BLOCKED 文案落点不足两处（plan 出口门禁与 replan 出口须各自渲染该文案）: '
      + JSON.stringify(messageRels));
    return out;
  }
  const sources = new Map(messageRels.map((rel) => [rel, fs.readFileSync(path.join(scriptsDir, rel), 'utf8')]));
  const context = { authorityRel: authority.file, scriptsDir };
  out.push(...task7EnumerationProblems(fieldSet, docs));
  out.push(...task7MessageDerivationProblems(fieldSet, sources, context));
  out.push(...task7ReverseConstructionProblems(fieldSet, docs, sources, context));
  return out;
}

// 反向构造（判别句式 + 反向构造；与真实判据同一实现驱动）：逐项把锚的输入改坏 ⇒ 必红；
// 另含**判别力方向**探针——合法新增站点必须**零问题**（防「全局计数地板」式自锁：以总量取红的探针会让
// 「新增一处」与「丢失一处」对冲，且把报错方向指向探针而非真实原因）。
export function task7ReverseConstructionProblems(fieldSet, docs, sources, context) {
  const out = [];
  const replaceRunLine = (targetDocs, run, mutate) => new Map(targetDocs).set(run.rel,
    (targetDocs.get(run.rel) ?? '').split(/\r?\n/)
      .map((line, index) => (index === run.line - 1 ? mutate(line) : line)).join('\n'));
  const dropRunLine = (targetDocs, run) => new Map(targetDocs).set(run.rel,
    (targetDocs.get(run.rel) ?? '').split(/\r?\n/)
      .filter((line, index) => index !== run.line - 1).join('\n'));
  const appendSite = (targetDocs, rel, fields) => new Map(targetDocs).set(rel,
    (targetDocs.get(rel) ?? '') + '\n（反向构造：新增站点）7 字段：' + fields.join(' / ') + '\n');
  // 文案落点全数改写（逐个落点同改：文案面探针须证明**每一处**落点的派生都被判据守住，而不是只守住
  // 反查所得的第一个）。
  const rewriteSourceTexts = (from, to) => new Map([...sources].map(([rel, src]) => [rel, src.replaceAll(from, to)]));
  const sample = task7KnownSiteRuns(fieldSet, docs)[0];
  if (sample === undefined) {
    out.push('7 字段枚举反向构造的前提不成立：已知站点上找不到与派生集合一致的枚举');
    return out;
  }
  const siteLabel = '已知站点「' + sample.site.anchor + '」（' + sample.rel + ':' + sample.line + '）';
  const probes = [
    // 站点丢失面（「处数下降即红」的站点级实现）：抽掉该站点整处枚举 / 删掉整行 ⇒ 必红
    ['抽掉 ' + siteLabel + ' 的整处枚举（改指针形态）',
      () => task7EnumerationProblems(fieldSet, replaceRunLine(docs, sample,
        (line) => line.replace(sample.raw, '（反向构造：改为指针形态）'))), '已知 7 字段站点'],
    ['删掉 ' + siteLabel + ' 整行',
      () => task7EnumerationProblems(fieldSet, dropRunLine(docs, sample)), '已知 7 字段站点'],
    // 新增站点面（自锁回归）：合法新增必须零问题；错误新增仍必红
    ['新增一处集合正确的站点（不得被判违规）',
      () => task7EnumerationProblems(fieldSet, appendSite(docs, sample.rel, fieldSet)), TASK7_ZERO_PROBLEMS],
    ['新增一处集合错误的新站点',
      () => task7EnumerationProblems(fieldSet, appendSite(docs, sample.rel,
        fieldSet.map((field) => (field === 'depends_on' ? 'id' : field)))), '与实现集合不一致'],
    // 集合分叉面
    ['把 ' + siteLabel + ' 的 depends_on 换成 id',
      () => task7EnumerationProblems(fieldSet, replaceRunLine(docs, sample,
        (line) => line.replace(sample.raw, sample.raw.replace('depends_on', 'id')))), '与实现集合不一致'],
    ['把 id 追加成第 8 项',
      () => task7EnumerationProblems(fieldSet, replaceRunLine(docs, sample,
        (line) => line.replace(sample.raw, sample.raw + ' / id'))), '与实现集合不一致'],
    ['实现侧常量把 depends_on 改成 dependsOn',
      () => task7EnumerationProblems(fieldSet.map((field) => (field === 'depends_on' ? 'dependsOn' : field)), docs),
      '与实现集合不一致'],
    // 文案派生面（⑧）：构造方式回退 / 派生被抽掉 ⇒ 必红（探针改坏的是**反查所得**的全部文案落点）
    ['文案回写字面集合',
      () => task7MessageDerivationProblems(fieldSet,
        rewriteSourceTexts(TASK7_AUTHORITY_CONSTANT + ".join('/')", "'" + fieldSet.join('/') + "'"), context),
      '又写了一遍字面集合'],
    ['文案抽掉派生',
      () => task7MessageDerivationProblems(fieldSet,
        rewriteSourceTexts(TASK7_AUTHORITY_CONSTANT + ".join('/')", "'7 字段'"), context),
      '未从判据常量派生'],
  ];
  // 探针判定只看**相对当前文本的新增问题**（`ambient` 差分）：工作树本身已红时，探针不得把
  // 「环境里已有的问题」记成自己的判别力（否则报错方向会指向探针，而不是指向真实原因）。
  const ambient = task7EnumerationProblems(fieldSet, docs);
  for (const [label, probe, expected] of probes) {
    const added = probe().filter((problem) => !ambient.includes(problem));
    const passed = expected === TASK7_ZERO_PROBLEMS
      ? added.length === 0
      : added.some((problem) => problem.includes(expected));
    if (!passed) {
      out.push(expected === TASK7_ZERO_PROBLEMS
        ? '反向构造判别力缺失（' + label + ' 被判违规——锚对合法扩展自锁）: ' + added.join('; ')
        : '反向构造判别力缺失（' + label + ' 未被判违规）');
    }
  }
  return out;
}

// 前端判据**散文口径**判据（场景 286 使用；纯函数 + 合成输入可驱动）：引擎侧判据已升为结构形态
// （独立行 / 行首 / 适用性标签的字段值位 + 词形边界 + 命中片段回显），五份分发文本是它的散文副本——
// 副本必须陈述**结构形态**，不得残留旧口径（「段内不含 / 未标注字面『不适用』」这类把判据说成
// 段内任意位置子串的表述，正是「一处措辞即关闸」fail-open 的文字版）。返回问题描述数组。
export const FRONTEND_CRITERION_STRUCTURE_GROUPS = [
  ['独立行', '独占一行'],
  ['行首'],
  ['字段值位'],
  ['词形边界'],
  ['命中片段', '回显'],
];
// 旧口径的**显式措辞**（逐条对应改前的真实句子，收窄到这些形态以免误伤新口径的正常行文）。
export const FRONTEND_CRITERION_STALE_PROSE_RES = [
  /段内\s*\*{0,2}(?:不含|不包含|未含|不得含|不得出现)\*{0,2}\s*(?:字面\s*)?「?不适用」?/,
  /段内\s*\*{0,2}(?:标注|标记)\*{0,2}\s*「?不适用」?\s*(?:两个)?字面/,
  /未标注\s*「不适用」/,
  /不含\s*字面\s*「不适用」/,
];
export function frontendCriterionProseProblems(label, text) {
  const problems = [];
  for (const group of FRONTEND_CRITERION_STRUCTURE_GROUPS) {
    if (!group.some((token) => text.includes(token))) {
      problems.push(label + ' 未陈述结构形态「' + group[0] + '」（散文副本须与引擎的结构判据同口径）');
    }
  }
  for (const re of FRONTEND_CRITERION_STALE_PROSE_RES) {
    const hit = re.exec(text);
    if (hit !== null) problems.push(label + ' 残留旧口径表述: ' + JSON.stringify(hit[0]));
  }
  return problems;
}

// 时间纪律四条硬规则的**文本判据**（场景 302 使用；纯函数 + 合成输入可驱动）：入参是承载该纪律的
// 文本（入口技能 / 验证阶梯），按规则逐条检查关键词组合；返回问题描述数组（空数组 = 四条齐备）。
// 判别力由场景内的逐条移除构造常驻证明（移掉任一条的关键词 → 必报），不依赖人工实验。
export const TIME_DISCIPLINE_RULES = [
  ['规则① 时间戳一律本地时间 + 显式偏移', ['本地时间 + 显式偏移']],
  ['规则② 比较一律 Date.parse 差值', ['Date.parse']],
  ['规则③ 判活 / 判时以 mtime 或 git 时间为准、date 不作基准', ['mtime', 'git 时间', '不作基准']],
  ['规则④ 纪律已写入验证阶梯', ['验证阶梯']],
];
export function timeDisciplineTextProblems(label, text) {
  const problems = [];
  for (const [rule, tokens] of TIME_DISCIPLINE_RULES) {
    const missing = tokens.filter((token) => !text.includes(token));
    if (missing.length > 0) problems.push(label + ' 缺 ' + rule + '（缺 ' + missing.join(' / ') + '）');
  }
  return problems;
}

// CRLF 行尾判据（场景 303 使用；纯函数 + 合成输入可驱动）：CRLF 文档的**每一条行**都必须以 CRLF
// 终结——`split('\n')` 之后除末尾哨兵外每个元素都须以 `\r` 收尾，且文档得以换行收尾。返回违例
// 行号（空数组 = 整篇行尾一致）。旧实现在「以换行收尾的文档」上直接于哨兵之后追加，拼出一条
// **无 `\r` 的空行**：同一文件两种行尾，渲染层看不见、diff 层刺眼（REVIEW 实测形态）。
export function crlfLineViolations(text) {
  const value = String(text);
  const lines = value.split('\n');
  const offenders = [];
  if (!value.endsWith('\n')) offenders.push(lines.length);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].endsWith('\r')) offenders.push(i + 1);
  }
  return offenders;
}

// EVOLVE 报告列表符号判据（场景 304 使用；纯函数 + 合成输入可驱动）：报告行不得出现 `- -`
// 双层列表符号——`  - ` 前缀与条目自带的 `- ` 叠加后渲染成「空壳父项 + 子项」，读者看到两条。
export function evolveReportBulletProblems(reportText) {
  const problems = [];
  const lines = String(reportText).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*-\s+-\s/.test(lines[i])) {
      problems.push('第 ' + (i + 1) + ' 行出现双列表符号: ' + JSON.stringify(lines[i]));
    }
  }
  return problems;
}

// 确定性层「每项都带可复现命令」判据（场景 306 使用，对应验收条款的该子句；纯函数 + 合成输入
// 可驱动）：确定性层以 `### k · 名称` 分项，每个项内必须随附 `- 复现命令：` 行——项是「机器可判」
// 的承诺，复现命令是它的兑现方式：缺一项，该层就有一格不可复核（读数与命令两边只在校验报告里
// 出现过一次，读者无法自己重算）。返回问题描述数组（空 = 每项都有）。
export function deterministicReproProblems(reportText) {
  const layer = /## 确定性层（机器可判）\n([\s\S]*?)(?=\n## |$)/.exec(String(reportText));
  if (layer === null) return ['缺「## 确定性层（机器可判）」段'];
  const chunks = layer[1].split(/\n(?=### )/).filter((chunk) => chunk.startsWith('### '));
  if (chunks.length === 0) return ['确定性层零个分项（判据无从校验）'];
  const problems = [];
  for (const chunk of chunks) {
    const title = chunk.split('\n')[0].replace(/^###\s*/, '').trim();
    if (!/^- 复现命令：/m.test(chunk)) problems.push('确定性项缺复现命令: ' + title);
  }
  return problems;
}

// 上游覆盖声明四要素判据（场景 307 使用；纯函数 + 合成输入可驱动）。上游语义被本仓有意覆盖，
// 声明此前是纯文本、无机检——读者无从判断「说没说清不采用什么」。四要素：
//   ① 上游文件标记为**只读基准**；② **「不采用」栏** ≥1 条（逐条点名，不是笼统「有意偏离」）；
//   ③ **「沿用上游」栏** ≥1 条（**指针式入口豁免**——细则在各自技能册，入口只留指针）；
//   ④ **「以…为准」兜底语**（冲突时以本节为准）。
// 「栏内条目」计数容忍两种行文形态：序号标记（①②③…）与顿号 / 分号列举——技能册一用序号、
// 一用顿号，形态差异不是「有没有条目」的差异；判据只锚「栏在场且至少一条」。
export const OVERRIDE_CLAUSE_ITEM_MARKS = /[①②③④⑤⑥⑦⑧⑨⑩]/g;
// 兜底语 = **冲突优先**声明（「以本节为准」式）：判据不认任何 `以…为准`——`以安装平台为准`
// 一类是无关行文，`冲突以 state 为准` 一类是局部字段优先级，都会被它冒充满足。
export const OVERRIDE_FALLBACK_RE = /以(?:本节|本册|本文)[^\n。]{0,20}为准|冲突[^\n。]{1,60}为准/;
// 声明块 = 「只读基准」所在行起，向后吞掉「空行 / 粗体栏名开头的段落 / 兜底语所在行」，直到首个
// 既非空行、也不以 `**` 开头、也不含兜底语的行为止——四要素都必须落在**块内**。没有块边界，
// 判据会被文件里别处的 `以…为准` / 局部优先级条款冒充满足（「锚偏弱」的另一种形态）。
export function overrideDeclarationBlock(text) {
  const lines = String(text).split('\n');
  const start = lines.findIndex((line) => line.includes('只读基准'));
  if (start < 0) return null;
  let end = start + 1;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (i > start && line.trim() !== '' && !line.startsWith('**') && !OVERRIDE_FALLBACK_RE.test(line)) break;
    end = i + 1;
  }
  return lines.slice(start, end).join('\n');
}
export function labeledClauseItemCount(text, label) {
  const value = String(text);
  const at = value.indexOf(label);
  if (at < 0) return null;
  const nextLine = value.indexOf('\n', at);
  const line = value.slice(at, nextLine < 0 ? value.length : nextLine);
  // 栏名之后先剥掉自身的粗体闭合与冒号，再截到**下一个栏名**（粗体 + 冒号形态）为止：
  // 栏内联的粗体强调（`**确定性子集**（…）`）不是栏名，不能当成栏边界。
  const rest = line.slice(label.length).replace(/^[*：:\s]+/, '');
  const nextLabel = rest.search(/\*\*[^*]{1,20}\*\*\s*[:：]/);
  const body = nextLabel < 0 ? rest : rest.slice(0, nextLabel);
  const marked = (body.match(OVERRIDE_CLAUSE_ITEM_MARKS) ?? []).length;
  const listed = body.split(/[、；]/).map((piece) => piece.trim()).filter((piece) => piece.length > 0).length;
  return Math.max(marked, listed);
}
export function overrideDeclarationProblems(label, text, { pointer = false } = {}) {
  const problems = [];
  const block = overrideDeclarationBlock(text);
  if (block === null) return [label + ' 找不到覆盖声明块（缺「只读基准」标记）'];
  if (!block.includes('只读基准')) problems.push(label + ' 未把上游文件标记为「只读基准」');
  const notAdopted = labeledClauseItemCount(block, '不采用');
  if (notAdopted === null) problems.push(label + ' 缺「不采用」栏');
  else if (notAdopted === 0) problems.push(label + ' 的「不采用」栏零条目（须逐条点名上游语义）');
  if (!pointer) {
    const kept = labeledClauseItemCount(block, '沿用上游');
    if (kept === null) problems.push(label + ' 缺「沿用上游」栏');
    else if (kept === 0) problems.push(label + ' 的「沿用上游」栏零条目');
  }
  if (!OVERRIDE_FALLBACK_RE.test(block)) {
    problems.push(label + ' 缺「以…为准」兜底语（冲突时以本节 / 本册为准）');
  }
  return problems;
}

// 覆盖声明里点名的上游工件路径（`flow-kit/prompts/...` 形态，含 `{a,b,c}.md` 花括号合写）：
// 逐条展开为可 stat 的真实路径——声明的锚必须指向在场实体，不能指向幽灵路径。尖括号占位形态
// （`flow-kit/prompts/<阶段>.md` 一类说明性写法）不是实体，直接排除。
export function upstreamArtifactPaths(text) {
  const found = String(text).match(/flow-kit\/prompts\/[^\s`）()、，。]+\.md/g) ?? [];
  const out = [];
  for (const raw of found) {
    if (raw.includes('<') || raw.includes('>')) continue;
    const brace = /\{([^}]*)\}/.exec(raw);
    if (brace === null) { out.push(raw); continue; }
    for (const name of brace[1].split(',')) out.push(raw.replace(brace[0], name.trim()));
  }
  return out;
}

// 原子写惯用法指纹（两条件同现于一个文件）：`+ '.tmp'` 拼接 + `fs.rename(` 落位——即「同目录固定
// 临时名 + rename」的写法。**受检面 = 引擎实现面（入口 ∪ `lib/`）**，唯一实现只许落在原子写的
// 单一来源模块；受保护写入是**独立的安全硬化通道**（临时名含 pid + 随机段），由 uniqueTempNameHits
// 的**形态锚**认出并作为已登记例外（形态一旦退回本惯用法即红），不是静默排除。
// root / files 是可测性接缝：使「第二份实现 → 检出 2 处」能在合成目录上被场景驱动，
// 否则该判据只能靠人工实验证明判别力、回归时可能被改成恒真空过（场景 291 反向构造）。
export const ATOMIC_TEMP_SUFFIX_RE = /\+\s*'\.tmp'/g;
export function atomicWriteIdiomHits(root = SCRIPTS_DIR, files = null) {
  const candidates = files ?? engineScriptFiles(root);
  const hits = [];
  for (const file of candidates) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const count = (text.match(ATOMIC_TEMP_SUFFIX_RE) ?? []).length;
    if (count > 0 && text.includes('fs.rename(')) hits.push({ file, count });
  }
  return hits;
}

// 「唯一临时名」硬化通道的**形态锚**：临时名含 pid + 随机段（固定同目录名会被并发写者互相覆盖，
// 故受保护写入必须唯一化）。它按形态定位、不写文件名——通道退回「固定 `.tmp`」惯用法时检出 0 处
// 即红（强制重评它是否落回原子写收敛面）。原子写受检面据此把它认成**已登记例外**而非漏网。
const UNIQUE_TEMP_PID_RE = /String\(process\.pid\)/;
const UNIQUE_TEMP_RANDOM_RE = /Math\.random\(\)\.toString\(16\)/;
export function uniqueTempNameHits(root = SCRIPTS_DIR, files = null) {
  const candidates = files ?? engineScriptFiles(root);
  const hits = [];
  for (const file of candidates) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    if (UNIQUE_TEMP_PID_RE.test(text) && UNIQUE_TEMP_RANDOM_RE.test(text)) hits.push({ file });
  }
  return hits;
}

// 日期前缀判据的**表达式形态**扫描（与原子写惯用法同型）：报告 / 工件名的「日期前缀」判定只许由
// time-utils.mjs 表达一处——本判据认的形态是「日期三分量以**字面连字符**相接」的前缀写法
// （`/^(\d{4}-\d{2}-\d{2})/` 一类），在其它脚本内联第二份即为单源违规（注释互指同源不作数，
// 判据只认形态）。时刻形态 `\d{4})-(\d{2})-(\d{2})T…`（`TIMESTAMP_SHAPE`）是另一个判据面，同样
// 落在 time-utils 一处，不在本形态内。**受检面 = 引擎实现面**：归档日志的日期条目匹配（行锚 +
// `matchAll(.../gm)`）是**文档内容**里的日期匹配、不是文件名前缀判定，由 dateContentMatchHits 的
// **形态锚**认出并作为已登记例外（形态一旦不再是内容条目匹配即红），不是静默排除。
// root / files 是可测性接缝：使「第二份实现 → 检出 2 处」能在合成目录上被场景驱动，
// 否则该判据只能靠人工实验证明判别力、回归时可能被改成恒真空过（场景 295 反向构造）。
export const DATE_PREFIX_LITERAL_RE = /\\d\{4\}-\\d\{2\}-\\d\{2\}/g;
// 归档日志日期条目的形态锚（`matchAll(/^…\d{4}-\d{2}-\d{2}…/gm)`）：按形态定位、不写文件名。
const DATE_CONTENT_MATCH_RE = /matchAll\(\/\^[^\n]*\\d\{4\}-\\d\{2\}-\\d\{2\}[^\n]*\/gm\)/g;
export function dateContentMatchHits(root = SCRIPTS_DIR, files = null) {
  const candidates = files ?? engineScriptFiles(root);
  const hits = [];
  for (const file of candidates) {
    const count = (fs.readFileSync(path.join(root, file), 'utf8').match(DATE_CONTENT_MATCH_RE) ?? []).length;
    if (count > 0) hits.push({ file, count });
  }
  return hits;
}
export function datePrefixRegexpHits(root = SCRIPTS_DIR, files = null) {
  const candidates = files ?? engineScriptFiles(root);
  const hits = [];
  for (const file of candidates) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const count = (text.match(DATE_PREFIX_LITERAL_RE) ?? []).length;
    if (count > 0) hits.push({ file, count });
  }
  return hits;
}

// 备份实现形态（改写前版本落盘）：`命名族字面量 + fs.copyFile(` 同现于一个文件即「一份备份实现」。
// 收敛面 = 单源模块 state-schema.mjs + 两个消费方：实现只许落在单源模块一处，消费方只许具名
// import 后消费导出（此前 evolve 与 context-scan 各写一份——命名族或失败处置再演进时只改到一侧）。
// root / files 是可测性接缝（默认引擎脚本目录）：使「第二份实现 → 检出 2 处」能在合成目录上被场景
// 驱动，否则该判据只能靠人工实验证明判别力、回归时可能被改成恒真空过（场景 301）。
export const BACKUP_NAME_LITERAL = "'.bak-'";
export const BACKUP_IMPL_FACE = ['state-schema.mjs', 'evolve.mjs', 'context-scan.mjs'];
export function inlineBackupHits(root = SCRIPTS_DIR, files = null) {
  const candidates = files ?? engineScriptFiles(root);
  const hits = [];
  for (const file of candidates) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    if (!text.includes(BACKUP_NAME_LITERAL)) continue;
    const count = (text.match(/await fs\.copyFile\(/g) ?? []).length;
    if (count > 0) hits.push({ file, count });
  }
  return hits;
}

// 裸时间拼接静态锚（DESIGN R4「禁裸拼接」）：时间形态 / 格式化的唯一权威是 time-utils.mjs。
// 两面判据——① 三条侧命令**零容忍**（它们的产物是人可见报告、CLI 摘要行与备份名）；
// ② 其余引擎脚本走**显式白名单 + 逐条理由**：既有落点都是已持久化的机器字段（state 时刻 /
// handoff 工件字段 / 审计事件），迁移须连同一批历史值的解析与比较面，留专门窗口并登记债务；
// 白名单**精确匹配**（新增与消失都必须显式改这里，不许静默漂移）。判据只看代码不看散文：
// 行注释剥掉后计数——注释里的反例引用不是「实现」（time-utils 的头部注释就引用了该形态）。
// root / files 是可测性接缝：合成目录可驱动「新增即红」（场景 298）。
export const BARE_ISO_TIMESTAMP_RE = /new Date\(\)\.toISOString\(\)/g;
export const BARE_ISO_SIDE_COMMANDS = ['health.mjs', 'evolve.mjs', 'context-scan.mjs'];
// 条目按**落点**登记（迁移后的实现在 `lib/`：state 机器字段随拆分分落三个命令模块；白名单面
// 与受检面同口径——递归的引擎面，数据层夹具不登记）。
export const BARE_ISO_ENGINE_WHITELIST = [
  {
    file: 'lib/state-commands-flow.mjs',
    count: 3,
    reason: 'state 的机器字段时间戳（init 的 createdAt / record 的记录时刻 / 强制推进事件的 at）：Z 形已随既有 state 与事件流持久化，迁移须同批处理历史值的解析与比较，留专门窗口（登记 KNOWN-ISSUES）；扫描时刻（last_intel_scan）已迁出本条——写入走 time-utils 的 nowTimestamp（场景 308 的形态锚 + 277 的单源消费面看守）',
  },
  {
    file: 'lib/state-commands-admin.mjs',
    count: 2,
    reason: 'state 的机器字段时间戳（execution-mode 的 directOverrideAt 授权留痕 / skill-load 标记的 at）：与 state 其余时刻同形、同批迁移；标记 at 的**读取**已走 time-utils 的比较面（场景 277 的单源消费面看守）',
  },
  {
    file: 'lib/state-commands-recovery.mjs',
    count: 2,
    reason: '受控重入 / 重校授权的机器时刻（authorizedAt）：随 state 事件流时间形态一并迁移；轮次推导已由综合判定派生，本条只剩落盘时刻',
  },
  {
    file: 'workflow-handoff.mjs',
    count: 4,
    reason: 'handoff 请求 / 结果的机器字段（requestedAt / revokedAt / completedAt）：Z 形是既有 handoff 工件契约，须与 workflow-state 同批迁移；新增的撤回留痕不走本条——withdrawnAt 由 time-utils 的 nowTimestamp 生成（本地时间 + 显式偏移），人可见回显亦按标准形态格式化',
  },
  {
    file: 'workflow-guard.mjs',
    count: 1,
    reason: 'exit-applied 审计事件的机器时刻：非人可见报告面，随事件流时间形态一并迁移',
  },
];
// intel-scan 元数据「段名 / 字段名」字面量的跨文件一致判据（纯函数 + 合成输入可驱动）：双落点判据在
// init 侧按「段名 + 字段名」定位段内取值，段行的写通道在 context-scan 侧——同一条命名决定落在两处
// 声明里（单一来源收口须改到测试面之外的脚本，见场景 309 的登记）。字面量若各自漂移，init 侧会
// **静默**退化成「段不在场」（零提示）——静默面正是该机制要消灭的形态，故此处让「两处声明逐字相等」
// 可机检。返回问题描述数组（空数组 = 一致）。
export const INTEL_NAME_DECL_RE = /const\s+(INTEL_SECTION(?:_NAME)?|INTEL_FIELD(?:_NAME)?)\s*=\s*'([^']+)'/g;
export function intelMetadataNameDeclarations(text) {
  const out = {};
  for (const match of String(text).matchAll(INTEL_NAME_DECL_RE)) {
    out[match[1].startsWith('INTEL_SECTION') ? 'section' : 'field'] = match[2];
  }
  return out;
}
export function intelMetadataNameProblems(consumerText, producerText) {
  const problems = [];
  const consumer = intelMetadataNameDeclarations(consumerText);
  const producer = intelMetadataNameDeclarations(producerText);
  for (const role of ['section', 'field']) {
    const label = role === 'section' ? '段名' : '字段名';
    if (consumer[role] === undefined) { problems.push('init 侧未声明 intel-scan ' + label + '字面量'); continue; }
    if (producer[role] === undefined) { problems.push('重扫命令侧未声明 intel-scan ' + label + '字面量'); continue; }
    if (consumer[role] !== producer[role]) {
      problems.push('intel-scan ' + label + '字面量两处声明不一致: init 侧 ' + JSON.stringify(consumer[role])
        + ' / 重扫命令侧 ' + JSON.stringify(producer[role]) + '（段侧定位会静默退化为「段不在场」）');
    }
  }
  return problems;
}

// 行注释剥离（`//` 之后非代码）：判据的语义是「代码里有没有裸拼接」，散文引用不算实现。
// 字符串里的 `//`（URL 一类）会把其后内容当注释剥掉——只可能**少计**（判据变松），而白名单面
// 另有精确条数锚（13 处）兜底；不为注释识别引入字符串感知的复杂度。
export function stripLineComments(text) {
  return text.split('\n').map((line) => {
    const at = line.indexOf('//');
    return at === -1 ? line : line.slice(0, at);
  }).join('\n');
}
export function bareIsoTimestampHits(root = SCRIPTS_DIR, files = null) {
  const candidates = files ?? engineScriptFiles(root);
  const hits = [];
  for (const file of candidates) {
    const text = stripLineComments(fs.readFileSync(path.join(root, file), 'utf8'));
    const count = (text.match(BARE_ISO_TIMESTAMP_RE) ?? []).length;
    if (count > 0) hits.push({ file, count });
  }
  return hits;
}
// 白名单判定（纯函数，合成输入可驱动）：条数漂移（增 / 减）与未登记文件各自必报。
export function bareIsoWhitelistProblems(hits, whitelist) {
  const problems = [];
  const actual = new Map(hits.map((hit) => [hit.file, hit.count]));
  for (const entry of whitelist) {
    const count = actual.get(entry.file) ?? 0;
    if (count === entry.count) continue;
    problems.push(entry.file + ' 白名单 ' + entry.count + ' 处 / 实际 ' + count
      + ' 处（须显式改白名单：新增落点先迁移到 time-utils，已迁移的落点同步收窄；理由：' + entry.reason + '）');
  }
  for (const hit of hits) {
    if (whitelist.some((entry) => entry.file === hit.file)) continue;
    problems.push(hit.file + ' 未登记白名单（' + hit.count
      + ' 处）——人可见面禁新增裸时间拼接，改用 time-utils.mjs 的 nowTimestamp / formatLocalTimestamp');
  }
  return problems;
}

// 分发面源码的**注释层零代号**判据（纯函数 + 合成输入可驱动）：受检面由调用方给定的
// { rel → 文本 } 派生（生产侧 = 技能树内全部脚本，递归），注释行判定与词表判据同口径
//（行首 `//` / `*` / `/*` 才算注释行）。旧形态只扫套件入口单文件——拆分后注释量最大的新模块
// 全在面外，判据仍在而判别力消失；故受检面与反向构造探针都由本函数驱动（单一实现）。
export function commentCodeProblems(texts) {
  const out = [];
  for (const [rel, text] of texts) {
    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^\s*(\/\/|\*|\/\*)/.test(lines[i])) continue;
      const hit = lines[i].match(PUBLIC_CODE_RE);
      if (hit) out.push(rel + ':' + (i + 1) + ': ' + hit[0]);
    }
  }
  return out;
}

// 单一来源静态锁（纯函数 + 合成输入可驱动）：某符号的实现只许落在**单源模块**一处，
// 消费面（入口 ∪ `lib/**`）一律具名取用、不得自带第二份定义。判据形态两处都不写文件名：
// 单源模块由调用方**反查**（engineDefinitionModule）传入，消费方由 `texts` 的真实引用派生
// （所以模块再切分 / 再搬家不必改锚，新增消费方自动进入对账）。
export function singleSourceImportProblems({ symbol, sourceRel, texts }) {
  const out = [];
  const definitionRe = engineDefinitionPattern(symbol);
  const mentionRe = new RegExp('\\b' + symbol + '\\b');
  const definers = [...texts.entries()].filter(([, text]) => definitionRe.test(text)).map(([rel]) => rel);
  if (definers.length !== 1 || definers[0] !== sourceRel) {
    out.push('单一来源被破坏：' + symbol + ' 的实现面应为 [' + sourceRel + ']，实际 ' + JSON.stringify(definers));
  }
  for (const [rel, text] of texts) {
    if (rel === sourceRel) continue;
    if (!mentionRe.test(engineCodeText(text))) continue;
    if (definitionRe.test(text)) {
      out.push(rel + ' 自带第二份 ' + symbol + ' 定义（应取用单一来源）');
      continue;
    }
    // 取用面走**唯一实现**（import 自单源 / import 自再导出枢纽 / `export … from` 单源）
    const taken = engineImportsSymbolFrom({ text, consumerRel: rel, symbol, sourceRel, texts });
    if (!taken) out.push(rel + ' 未从 ' + sourceRel + ' 取用 ' + symbol + '（单一来源 fail-closed）');
  }
  return out;
}
// health 报告夹具：报告名的日期前缀与读数快照都是**构造出来的输入面**——快照哨兵值只在被采作
// 基线时才出现在新报告里（哨兵 → `999999 → …`），据此可判「当前基线到底是哪一份」，不必解析
// 报告结构。哨兵键取全小写键（快照行的键形态判据只认小写字母与 `.` / `_`），与既有 `context.exists`
// 一类保持一致。
export function healthReportFixture(date, sentinelEntries) {
  return [
    '# 健康巡检 · ' + date,
    '',
    '## 读数快照（机器可读 · 供下次报告对比）',
    '',
    '```text',
    'lessons.exists=true',
    'lessons.entries=' + sentinelEntries,
    '```',
    '',
    '## 与上次对比',
    '',
    '- 基线：无（夹具报告）',
    '',
  ].join('\n');
}

// 读数快照的**往返夹具**：把生产者自己产出的快照段整段（不解析、不重排、不改键名）当作历史
// 基线喂回去——写方与读方的键形态是否同源，由「每个产出的键都能被读回」这一往返判定，而不是
// 由套件再持一份键形态（第三份表达只会掩盖同一类缺陷）。此前写方发 6 个含大写字母的键、读方的
// 键形态正则只认全小写，这 6 个键在对比段恒判「（基线无此读数）」：逐键趋势静默失效且不报错。
export function healthReportWithSnapshot(date, snapshotSectionText) {
  return [
    '# 健康巡检 · ' + date,
    '',
    snapshotSectionText.trimEnd(),
    '',
    '## 与上次对比',
    '',
    '- 基线：无（夹具报告）',
    '',
  ].join('\n');
}
// 报告里「## 读数快照」段的原文切片（往返夹具的输入 = 生产面的真实字节）
export function snapshotSectionOf(reportText) {
  const start = reportText.indexOf('## 读数快照');
  if (start === -1) return null;
  const rest = reportText.slice(start);
  const end = rest.indexOf('\n## ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}
// 快照段内的读数条数（`key=value` 行，排除围栏与空行）——往返判据的「应读到条数」由生产面原文派生
export function snapshotEntryCount(sectionText) {
  return sectionText.split('\n').filter((line) => /^[^`\s][^=]*=/.test(line)).length;
}

// CONTEXT.md 夹具（七段骨架 + 可选 evolve 段）——夹具不装 flow-kit 模板时 validateContext
// 取内置基准段名；`intel-scan 元数据` / `evolve 元数据` 字段行与模板同形。
// 与 system-test.mjs 的同名夹具**同形镜像**（两份载体刻意独立、不互相 import：夹具若从被测模块
// 派生，锚点会退化成同义反复）——改段名 / 字段名时必须两份同改（与词表镜像同纪律）。
export const CONTEXT_BASE_SECTION_NAMES = ['项目概要', '技术栈', '域语言', '已锁决策', '默认偏好', '既有抽象索引'];
// 段侧扫描时刻的取值与行尾说明：**真实生成件形态**（`--init-context` 的 CONTEXT 生成物 = 取值词元 +
// 行尾说明；写侧 `context-scan` 只替换首个取值词元、说明原样保留）。夹具取这一形态——裸取值词元
// 夹具下「读侧取整行剩余文本」的口径缺陷在两级基线下都不可见（见场景 308 的单变量对照）。
export const INTEL_FIELD_VALUE = '2026-09-01T10:00:00+08:00';
export const INTEL_FIELD_SUFFIX = ' （首次接入生成时留占位；由 `init --init-context` 或 `context-scan` 记录扫描时间）';
export const INTEL_METADATA_FIELD_LINES = [
  '- **last_intel_scan**: ' + INTEL_FIELD_VALUE + INTEL_FIELD_SUFFIX,
  '- **scanner**: `flow-comet`',
  '- **下次重扫建议**: 3 个月后',
];
export const EVOLVE_METADATA_FIELD_LINES = [
  '- **last_evolve_at**: `2026-09-01T10:00:00+08:00`',
  '- **scanner**: `flow-comet-evolve`',
  '- **下次建议**: 约 60 天后，或新增 ≥ 5 个带 §9 内容的 change 之后',
];

export function contextFixtureText({ evolveSection = null, intelSection = true, tail = '' } = {}) {
  const lines = ['# 项目上下文', ''];
  for (const name of CONTEXT_BASE_SECTION_NAMES) {
    lines.push('## ' + name, '');
    if (name === '已锁决策') {
      lines.push('- [2026-09-01] 夹具决策 — 来自 @.specs/CONTEXT.md', '');
      continue;
    }
    if (name === '域语言') {
      // 域语言段须带模板表格表头（格式判据：`| 术语 | 定义 |`）
      lines.push('| 术语 | 定义 |', '|---|---|', '| 夹具 | 测试用上下文 |', '');
      continue;
    }
    lines.push('- 夹具条目（' + name + '）', '');
  }
  if (intelSection) lines.push('## intel-scan 元数据', '', ...INTEL_METADATA_FIELD_LINES, '');
  if (evolveSection !== null) lines.push('## evolve 元数据', '', ...evolveSection, '');
  if (tail !== '') lines.push(tail, '');
  return lines.join('\n');
}

// 段侧取值的读取口径：结构提取返回的是**整行剩余文本**（取值词元 + markdown 引号 + 行尾说明），
// 而写侧（`context-scan` 的 `INTEL_FIELD_LINE`）只替换首个 `(\S+)` 取值词元、说明原样保留——
// 断言必须与写侧同口径取词元，否则「带说明行」会被判成不一致（本缺陷的成因即读侧取整行）。
export function intelFieldToken(value) {
  return String(value).trim().split(/\s+/)[0].replace(/^`+/, '').replace(/`+$/, '');
}

// design 出口 ui-design 门夹具：CHANGE.md 的「视觉调性」段是结构级前端判据的输入面
export const VISUAL_TONE_APPLICABLE = '## 视觉调性（Visual Tone）\n\n现代、克制的工具型界面。\n';
export const VISUAL_TONE_NOT_APPLICABLE = '## 视觉调性（Visual Tone）\n\n不适用（非前端项目）。\n';
// 负向标记的另外几种形态（判据不接受裸子串，只接受结构形态）：
// 行首形态（标记 + 破折号理由，非独立行）
export const VISUAL_TONE_LINE_HEAD_MARKER = '## 视觉调性（Visual Tone）\n\n不适用 —— CLI 工具，无用户可见界面。\n';
// 字段值位（`- 适用性：不适用`）
export const VISUAL_TONE_FIELD_MARKER = '## 视觉调性（Visual Tone）\n\n- 适用性：不适用（CLI 工具，无用户可见界面）\n';
// 子维度字段（标签不是适用性标签）——结构形态在场，但主体是暗色主题，不得关掉整道门
export const VISUAL_TONE_SUBDIMENSION_FIELD = '## 视觉调性（Visual Tone）\n\n- 选定：克制工具型\n- 暗色主题：不适用\n';
// 自然句子（标记词出现在行首与句内，但都不成结构形态）——不得据它把前端 change 改判非前端
export const VISUAL_TONE_NATURAL_SENTENCE = '## 视觉调性（Visual Tone）\n\n不适用于暗色主题，本 change 仅覆盖浅色分支。\n';

// ui-design 门键控夹具：以内置协议副本（runGuardWithProtocol 指向的同一路径）为基准改写 design
// 节点的 flow-comet-ui-design 绑定——'guarded'（默认形态，写回）/ 'advisory'（等级降级）/
// 'absent'（删掉绑定）。协议副本是「门是否在场」的唯一输入面。
export function writeUiDesignBindingVariant(dir, variant) {
  const file = scenarioProtocolPath(dir);
  const protocol = JSON.parse(fs.readFileSync(file, 'utf8'));
  const design = (protocol.nodes ?? []).find((node) => node.id === 'design');
  if (!design) throw new Error('内置协议缺 design 节点（夹具前提不成立）');
  const kept = (design.requiredSkillCalls ?? []).filter((call) => call.skill !== 'flow-comet-ui-design');
  if (variant !== 'absent') {
    kept.push({
      skill: 'flow-comet-ui-design', operation: 'require', scope: 'main', enforcement: variant, reason: 'UI-DESIGN（仅前端）',
    });
  }
  design.requiredSkillCalls = kept;
  fs.writeFileSync(file, JSON.stringify(protocol, null, 2) + '\n');
}

export function writeDesignExitFixture(dir, {
  newChange, visualTone, uiDesign, declareUiDesign, changeName = CHANGE_ID, changeTail = '', declareDesign = true,
}) {
  writeFile(dir, 'flow-kit/templates/DESIGN.md', '# DESIGN 模板\n\n## 0. 技术栈选型\n## 1. 技术决策清单\n');
  const state = baseState('design');
  state.newChange = newChange === true;
  state.enteredNodes = ['design'];
  const checks = [];
  if (declareDesign) checks.push('required-skill:design.flow-comet-design');
  if (declareUiDesign) checks.push('required-skill:design.flow-comet-ui-design');
  state.evidence.design = { summary: 'design done', completedChecks: checks };
  writeState(dir, state);
  writeFile(dir, '.specs/' + changeName + '/CHANGE.md',
    '# CHANGE\n\n- **Change ID**: ' + changeName + '\n\n## Why（为什么做）\n\n夹具。\n\n' + visualTone + changeTail);
  writeFile(dir, '.specs/' + changeName + '/DESIGN.md',
    '# DESIGN\n\n- **Change ID**: ' + changeName + '\n\n## 0. 技术栈选型\n\nNode（纯脚本）\n\n## 1. 技术决策清单\n\n- [ ] 决策 1\n');
  if (uiDesign) {
    writeFile(dir, '.specs/' + changeName + '/UI-DESIGN.md',
      '# UI-DESIGN\n\n## 1. 设计 token\n\n- 主色 `oklch(0.6 0.1 250)`\n');
  } else {
    // 同一目录里连续构造四个子用例：缺席必须真实缺席（残留上一用例的工件会让缺件门形同虚设）
    fs.rmSync(path.join(dir, '.specs', changeName, 'UI-DESIGN.md'), { force: true });
  }
}

// ---------- 锚助手（模块级具名实现：场景主体只调用，避免长体内插） ----------

// apply_patch heredoc 目标解析的耐久锚。载荷形态 = Codex 承载补丁的真实调用
// （tool_name="Bash"、补丁正文在 tool_input.command、载荷无 file_path）：四类补丁摘要行
// （Update / Add / Delete / Move to）× 身份 / 协调者白名单两态 × 定界符变体 × 反例组。
// 判据含**内建反向构造**：把守卫副本的补丁解析停用（解析器入口早退）后，同一组
// 载荷里预期拦截的用例必须**全部**翻成放行——证明本锚断言的不是恒真形态。副本落在场景临时
// 目录（只复制守卫与其三个同包依赖），不触碰权威源文件（零写入、零临时改名）。
// 保护集第二目标按**本次运行实际生效的协议文件**取值（FLOW_COMET_PROTOCOL 的解析结果），
// 不是「任意名为 workflow-protocol.json 的文件」——同名异路径用例（allow）即该边界的判别锚。
export function applyPatchPayloadMatrix() {
  const stateTarget = '.flow-comet/flow-comet-state.json';
  const protocolTarget = 'reference/workflow-protocol.json'; // = 本场景实际生效的协议路径
  const sameNameElsewhere = '.specs/' + CHANGE_ID + '/workflow-protocol.json';
  const srcTarget = 'src/patched.mjs';
  const specsTarget = '.specs/' + CHANGE_ID + '/patched.md';
  const identity = { agent_id: 'agent-abc123' };
  // 补丁承载形态：`apply_patch <<'PATCH'` + 正文 + 定界行；dash / 引号形态按 shell 语义拼装。
  const patchCommand = (bodyLines, { delimiter = "'PATCH'", dash = false, close = true } = {}) => {
    const closing = (dash ? '\t' : '') + delimiter.replace(/^["']|["']$/g, '');
    const lines = ['apply_patch <<' + (dash ? '-' : '') + delimiter, '*** Begin Patch', ...bodyLines];
    if (close) lines.push(closing);
    return lines.join('\n');
  };
  const payloads = [];
  const add = (label, command, expect, withIdentity = true) =>
    payloads.push({ label, command, expect, identity: withIdentity ? identity : {} });
  // ① 四类摘要行 × 身份态 → 机器状态文件仍受拦（保护集，身份放行不放行它）
  for (const header of ['*** Update File:', '*** Add File:', '*** Delete File:', '*** Move to:']) {
    add('身份 + ' + header + ' state 文件', patchCommand([header + ' ' + stateTarget]), 'block');
  }
  // ② 身份态对照：普通源码放行（不过宽）；实际生效的协议文件受拦；**同名异路径**放行（判据是
  //    解析结果而非文件名——保护集第二目标的边界）
  add('身份 + Update File 普通源码', patchCommand(['*** Update File: ' + srcTarget]), 'allow');
  add('身份 + Update File 生效协议文件', patchCommand(['*** Update File: ' + protocolTarget]), 'block');
  add('身份 + Update File 同名异路径协议文件', patchCommand(['*** Update File: ' + sameNameElsewhere]), 'allow');
  // ③ 协调者白名单态（无身份）：.specs/ 放行；源码拦截；state 文件仍受拦（保护集无条件）
  add('无身份 + Update File .specs/ 工件', patchCommand(['*** Update File: ' + specsTarget]), 'allow', false);
  add('无身份 + Update File 源码', patchCommand(['*** Update File: ' + srcTarget]), 'block', false);
  add('无身份 + Update File state 文件', patchCommand(['*** Update File: ' + stateTarget]), 'block', false);
  // ④ 定界符变体 × state 文件 × 身份态 → 仍受拦
  add('双引号定界符', patchCommand(['*** Update File: ' + stateTarget], { delimiter: '"PATCH"' }), 'block');
  add('裸定界符', patchCommand(['*** Update File: ' + stateTarget], { delimiter: 'PATCH' }), 'block');
  add('<<- 制表符定界行', patchCommand(['*** Update File: ' + stateTarget], { delimiter: "'PATCH'", dash: true }), 'block');
  // ⑤ 反例：定界符之后的散行不得被吞并（吞并会把下游命令的参数读成写入目标）；正文无摘要行、
  //    非 heredoc 的内联文本、引号内同名文本、无命令名的摘要行一律不误报
  add('定界符后散行不吞并',
    patchCommand(['*** Update File: ' + specsTarget]) + '\n*** Update File: ' + stateTarget, 'allow');
  add('正文无摘要行', patchCommand(['@@ -1 +1 @@', '-old', '+new']), 'allow');
  add('内联文本无 heredoc', 'echo "*** Update File: ' + stateTarget + '"', 'allow');
  add('引号内 apply_patch 文本', 'echo "apply_patch <<\'PATCH\'"', 'allow');
  add('无 apply_patch 命令名', 'grep -n "*** Update File: ' + stateTarget + '" patch.diff', 'allow');
  // ⑥ 未闭合 heredoc：按「正文到命令末尾」处理（偏拦截方向的 fail-closed），摘要行仍被抽出
  add('未闭合 heredoc', patchCommand(['*** Update File: ' + stateTarget], { close: false }), 'block');
  return payloads;
}

// 单组载荷求值（真实守卫与反向构造副本共用）：cwd / runRoot / 协议路径与场景夹具一致。
export function runApplyPatchPayload(dir, hookPath, payload) {
  const res = spawnSync(process.execPath, [hookPath, 'before_tool'], {
    cwd: dir,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: payload.command }, ...payload.identity }),
    env: {
      ...process.env,
      FLOW_COMET_RUN_ROOT: dir,
      FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'workflow-protocol.json'),
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 矩阵求值（单一实现）：逐组比对期望出口码与拦截报文，返回问题串。
export function applyPatchVerdictProblems(dir, hookPath, payloads) {
  const problems = [];
  for (const payload of payloads) {
    const expected = payload.expect === 'block' ? 2 : 0;
    const res = runApplyPatchPayload(dir, hookPath, payload);
    if (res.status !== expected) {
      problems.push('apply_patch 锚（' + payload.label + '）预期 exit ' + expected
        + '，实际 exit ' + res.status + '：' + res.output.trim().slice(0, 120));
    } else if (payload.expect === 'block' && !res.output.includes('BLOCKED')) {
      problems.push('apply_patch 锚（' + payload.label + '）拦截报文缺 BLOCKED：' + res.output.trim().slice(0, 120));
    }
  }
  return problems;
}

// 耐久锚主体：真实矩阵 + 内建反向构造。
export function applyPatchAnchorProblems(dir) {
  const payloads = applyPatchPayloadMatrix();
  const problems = applyPatchVerdictProblems(dir, HOOK, payloads);
  // 内建反向构造：停用补丁解析 ⇒ 依赖该解析的拦截用例必须全部变红（此处判红）。
  const probeDir = path.join(dir, 'probe-scripts');
  fs.mkdirSync(probeDir, { recursive: true });
  for (const rel of ['comet-hook-guard.mjs', 'protocol-utils.mjs', 'state-schema.mjs', 'time-utils.mjs']) {
    fs.copyFileSync(path.join(SCRIPTS_DIR, rel), path.join(probeDir, rel));
  }
  const probeHookPath = path.join(probeDir, 'comet-hook-guard.mjs');
  const probeSource = fs.readFileSync(probeHookPath, 'utf8');
  const entry = probeSource.indexOf('function applyPatchHeredocs(command) {');
  if (entry < 0) {
    problems.push('反向构造探针无法定位补丁解析入口（实现已改名——锚与实现漂移）');
    return problems;
  }
  const brace = probeSource.indexOf('{', entry);
  fs.writeFileSync(probeHookPath,
    probeSource.slice(0, brace + 1) + '\n  return []; // 反向构造：停用补丁解析\n' + probeSource.slice(brace + 1), 'utf8');
  let flipped = 0;
  for (const payload of payloads) {
    const res = runApplyPatchPayload(dir, probeHookPath, payload);
    if (payload.expect === 'block') {
      if (res.status === 0) flipped += 1;
      else problems.push('反向构造判别力缺失（' + payload.label + ' 在解析停用后仍拦截）');
    } else if (res.status !== 0) {
      problems.push('反向构造引入新拦截（' + payload.label + ' 在解析停用后被拦）');
    }
  }
  const blockCases = payloads.filter((p) => p.expect === 'block').length;
  if (flipped !== blockCases) {
    problems.push('反向构造未覆盖全部拦截用例（' + flipped + '/' + blockCases + ' 翻红）');
  }
  console.log('ANCHOR: apply_patch 目标解析矩阵 ' + payloads.length + ' 组（四类摘要行 × 身份/白名单两态 × '
    + '定界符变体 × 反例；反向构造停用解析后 ' + flipped + '/' + blockCases + ' 组拦截用例全部翻红）');
  fs.rmSync(probeDir, { recursive: true, force: true });
  return problems;
}

// 段内 glob 语义两处实现的等价性锚（route-node 的计划期重叠判定 ↔ workflow-handoff 的提交
// 子集校验）：同一 (声明, 字面) 矩阵两侧求值必须同判——否则「形态同源 + 漂移可见」无凭据。
// 等价域 = **已归一**声明 × git 报告的**字面**路径（route-node 侧入参经计划期归一；handoff 侧
// 的文件名来自 git，永不含 glob）。域外边界显式声明：双侧 glob 的保守重叠判定在 handoff 侧无
// 对应物（提交文件名不可能是 glob），不在等价断言内。
export function globEquivalenceProblems(dir) {
  const problems = [];
  const overlaps = requireRouteNodeExport('collectPathOverlaps');
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  const commitFile = (rel) => {
    writeFile(dir, rel, 'export const probe = 1;\n');
    git('add', '--', rel);
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'chore: glob probe ' + rel);
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  };
  const hashes = new Map();
  const hashFor = (rel) => {
    if (!hashes.has(rel)) hashes.set(rel, commitFile(rel));
    return hashes.get(rel);
  };
  // 矩阵：{ pattern: 已归一声明, literal: 真实提交路径, covered: 两侧应同判的结论 }
  const matrix = [
    { pattern: 'src/*.mjs', literal: 'src/a.mjs', covered: true, label: '段内通配命中' },
    { pattern: 'src/*.mjs', literal: 'src/b.ts', covered: false, label: '段内通配扩展名不符' },
    { pattern: 'src/*.mjs', literal: 'src/deep/a.mjs', covered: false, label: '段数不等不跨 /' },
    { pattern: 'src/*', literal: 'src/a.mjs', covered: true, label: '整段通配' },
    { pattern: 'src/a.mjs', literal: 'src/a.mjs', covered: true, label: '字面相等' },
    { pattern: 'src/foo.mjs', literal: 'src/foobar.mjs', covered: false, label: '字面非前缀匹配' },
    { pattern: 'SRC/*.mjs', literal: 'src/a.mjs', covered: false, label: '大小写不同不命中' },
    { pattern: 'src/a?.mjs', literal: 'src/a1.mjs', covered: false, label: '非 * 元字符按字面（两侧同口径）' },
  ];
  let index = 0;
  for (const cell of matrix) {
    index += 1;
    const taskId = 'E' + String(index).padStart(2, '0');
    const routeSide = overlaps([cell.pattern], [cell.literal]).length > 0;
    assertExit(runHandoff(['request', taskId, '--write-files', cell.pattern], dir), 0);
    const handoffSide = runHandoff(['result', taskId, JSON.stringify({
      status: 'DONE', taskId, commitHash: hashFor(cell.literal),
      completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
      redEvidence: { command: 'echo ok' },
      greenEvidence: { command: 'echo ok', output: 'ok' },
    })], dir);
    const handoffCovered = handoffSide.status === 0;
    if (!handoffCovered && !handoffSide.output.includes('超出 writeFiles 范围')) {
      problems.push('等价性锚（' + cell.label + '）提交子集校验未给出可判定结论：'
        + handoffSide.output.trim().slice(0, 120));
      continue;
    }
    if (routeSide !== cell.covered || handoffCovered !== cell.covered) {
      problems.push('glob 语义两处实现不一致（' + cell.label + '）：声明 ' + cell.pattern + ' × 字面 '
        + cell.literal + ' 期望 ' + cell.covered + '，route-node=' + routeSide + '，handoff=' + handoffCovered);
    }
  }
  const coveredCount = matrix.filter((c) => c.covered).length;
  console.log('ANCHOR: 段内 glob 等价性矩阵 ' + matrix.length + ' 格（命中 ' + coveredCount + ' / 不命中 '
    + (matrix.length - coveredCount) + '）——route-node 计划期重叠判定与 workflow-handoff 提交子集校验同判；'
    + '任一恒真或恒假实现即红');
  return problems;
}

