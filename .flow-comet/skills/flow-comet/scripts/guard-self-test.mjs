#!/usr/bin/env node
// C1 · flow-comet 引擎自测套件（场景数以 SCENARIOS.length 为准：节点门禁 entry/exit 校验正反例与 WARN 渐进、自定义协议加载路由与防线、TASK 签名与 next 推进、handoff Return Contract 与时间序、init 状态机与 hook 写白名单、CONTEXT 自动初始化检测、completedChecks 真实性声明机制（skill-load/record/exit 校验 + 交叉自洽 + 旧兼容）、init 参数误用防护、执行遗漏防护、严格模式、验证失败计数按变更隔离、多趟路由依赖图校验（环/缺失依赖 BLOCK 与混排合法锚）、契约解析失败检测、计数一致性自检（场景数 + 系统测试集项数）、prepare-env 平台选择链、零提交边界与入口首部强制、多趟出口硬化（可运行串行放行与拦截双向锚、单行分号 write_files 容错、收尾态路由静默、死结提示与技能文本锁）、installer 新链路（flow-kit 获取五态 / 桥接健康六态 / 他方保持 / 强制回退）、并行文件依赖检测（写写重叠强判前移 plan 出口 + read 读写弱判渐进 + 触发面排除 + 委托前保持锚 + 扩展名闭合）、directOverride 授权约束（协调者授权留痕正例 / 执行者自切无授权 BLOCK / 越界改 state hook 拦截 / 恢复双路径）、hook state 大小写变体拦截（win32/darwin 闭合 / 其他平台放行）、路由完成判定 fail-closed（缺/未知 status 畸形块不提前放行）、并行文件依赖路径归一化（`.` 段变体重叠检出）、运行时文件位置迁移（白名单搬移 / 迁移前备份与回退 / 新旧并存·符号链接·内容损坏三边界 / 失败保护 / gitignore 三形态保守纳管与幂等）、Comet 感知层剥离（classic 资产有无判定一致 / overlay 协议不再进入叠加分支 + 源码符号检索）、自检清单条目缺失显式报告、受控计划重校重签（replan 授权 fail-closed / 轮次上限与显式续轮 / 幂等空操作 / 重签后 execute 出口放行 / 校验不豁免与任务图分析单源锚）与强制推进留痕（advance-forced 事件 / status.forcedNodes 派生视图）、扫描时刻双落点一致（init 侧的形态单一来源 + 漂移可见提示 + 段名/字段名跨文件一致））
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
import { isDeepStrictEqual } from 'util'; // 白名单外深比（state 字节级不变量断言，标准库零依赖）
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
// （REPO_ROOT/.flow-comet/skills 在安装副本形态不存在 → 技能文本锁场景 ENOENT，端到端冒烟缺陷）。
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

// 技能树分发面文档遍历（返回 [相对 skillsRoot 的斜杠路径, 绝对路径]）：全部 `*.md`
//（各册 `SKILL.md` + `flow-comet/reference/**.md`）。用于「持某锚句的文本集合」「相对路径引用
// 可解析性」这类**跨册面**判据——单一册判据不用它，避免判据面被无谓放大。
function skillTreeDocFiles(scriptsDir = __dirname) {
  const root = skillsRootForScriptsDir(scriptsDir);
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      out.push([path.relative(root, abs).replaceAll('\\', '/'), abs]);
    }
  };
  walk(root);
  return out;
}

// 公开产物零代号判据（与 .githooks/internal-codes.mjs 的 BANNED 保持同步——单一来源约定：
// 本文件随技能包分发，不能 import 主仓私有的 .githooks；改动词表时两份同改，行为必须一致）。
// 等价性不只靠注释约定：底部自检在权威源检出下读该私有件**逐字符比对**（主仓形态），安装副本
// 形态输出显式「不适用」描述符（未验证 ≠ 通过）——见词表镜像漂移判据。
// 除既有过程代号外，本批并入"未公开概念"类**收窄模式**：批次编号 / 批+数字 / 级别编号 /
// 验收代号 / 工作项编号。模式刻意收窄（词界 + 字母边界）：合法中文用法（发布批次 / 维护批次 /
// 级联 / 变更请求与采纳编号前缀）不命中；判别力与边界锚见维护文档机检场景族（表驱动等价性：
// 词表每个分支各一条正例 + 一条对应反例，另加本文件注释层零残留——三向自检）。禁止放宽为裸词
// ——那会误伤公开面大量合法中文用法。
// 2026-10-01 收窄一处：「批 + 数字」补中文序数否定环视——「第 N 批 + 数字」是普通计数短语
// （合法中文用法），旧模式把它当未公开概念命中。序号与「批」之间隔着数字（阿拉伯或中文），
// 故环视必须吸收这段数字（变长环视），且**允许两侧空格**（`第 1 批 2 次` 同属普通计数短语）；
// 工作项编号补**尾界**（要求恰好两位，`R-123` 形态不命中）。以上均属"只收窄不放宽"；
// 只排除这两类形态，其余判定不变。无空格连写形态（如「批次2」）刻意不命中：实测受检三层 0 处，
// 放宽会增误报。本正则与 `.githooks/internal-codes.mjs` 的 `BANNED` 保持 **source 逐字符相等**
// （主仓形态由镜像漂移判据强制，改一侧必须同步另一侧）。
const PUBLIC_CODE_RE = /\bS\d{1,3}\b|T-FIX|batch-(?![a-z])|D-\d+|P[0-7]\b|round\s*\d|dogfood|内部|批次 [A-Z0-9]|(?<!第 ?[0-9一二三四五六七八九十百千万]* ?)批 ?\d|级 [0-9]|UAT-\d|(?<![A-Za-z])R-\d{2}(?![A-Za-z0-9_-])/;

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
// 2026-09-27 文档重构：计数只允许出现在入口页徽章行、发布权威与机器锁面（PR 模板 / CI / 欢迎消息 / 变更日志）；
// 其余公开文档一律改述为「见 VERSIONS」，因此本清单随之收缩（此前把 CONTRIBUTING/INSTALLATION/MECHANISM 也列进来，
// 与单一权威策略冲突：同一数字散落越多越容易漂移）。
const SCENARIO_COUNT_FILES = [
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
const SCENARIO_COUNT_FILES_MAINTAINER = [
  'docs/internal/ARCHITECTURE.md', 'docs/internal/DOC-CHECKLIST.md', 'docs/internal/MECHANISM.md',
  'docs/internal/ROADMAP.md',
  'docs/internal/WORKING-METHOD.md',
  // 主仓私有指导面（见上方分组说明）：纳入维护者组后其场景数由机检维护；docs/internal/ 缺席
  // 的检出形态整组跳过（该文件同样被 gitignore，两种缺席同源）。
  'CLAUDE.md',
];
const MAINTAINER_DOC_DIR = 'docs/internal';
// 本仓 CONTEXT 工件（**流程工件面**：.specs/ 被 gitignore）。存在性即「维护者形态」判据——
// CI 全新检出 / worktree 下结构性缺席，依赖它的场景须输出**可见 SKIP**（未验证 ≠ 通过），
// 不得把「文件不在场」当成「校验通过」。与 docs/internal/（MAINTAINER_DOC_DIR）同源缺席。
const REPO_CONTEXT_FILE = path.join(REPO_ROOT, '.specs', 'CONTEXT.md');
// 三册显式清单（维护文档机检扫描面；与 docs/internal/*.md、.specs/adr/*.md 并列）：
// 知识权威累积面，更新频率高——写入即需校验。显式清单（不用 .specs/*.md 通配）可预测、
// 可按册 allowlist，未来新增册需手工登记（与计数受检清单同纪律）。
const MAINTAINER_BOOKS = ['.specs/CONTEXT.md', '.specs/LESSONS.md', '.specs/CHANGELOG.md'];

// 系统测试集项数受检清单——与场景数清单**并列不合并**：两者数字不同、受检文件面也不同
// （项数只出现在下面这些文档里；场景数散布更广，含 README / 模板 / CI）。清单本身是
// 单一来源：改动项数必须同步列出的全部文件，漏同步即套件报错（此前无任何机检锚定，
// 漂移只能靠人工发现）。分组语义与场景数清单一致（见上方分组说明）：分发组恒检，
// 维护者组整组在场时逐条严检。
const SYSTEM_TEST_COUNT_FILES = [
  'docs/VERSIONS.md', 'docs/VERSIONS-zh.md',
  'CHANGELOG.md', 'CHANGELOG-zh.md',
];
const SYSTEM_TEST_COUNT_FILES_MAINTAINER = [
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

// 维护者面的在场探针（单一来源）：以**组外**目录 docs/internal/ 是否存在为判据——不能用组内
// 成员当探针（成员缺失会被误判成「整组缺席」而跳过，正好藏起该成员的缺失）。计数受检清单的
// 维护者组与 maintainerFaceSkips 的计数面描述符共用本判据（单一决策，避免多处各写一份而漂移）。
function maintainerFacePresent(root = REPO_ROOT) {
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
const STALE_COUNT_TOKEN_RE = /\b(\d{2,4})\s*(?:场景|scenarios|项|items)|\b(\d{2,4})\/(\d{2,4})\b|\bALL (\d{2,4}) SCENARIOS\b/g;
const STALE_COUNT_SUITE_KEYWORD_RE = /guard-self-test|system-test|SYSTEM TEST|SCENARIOS|场景|项|items|scenarios/;
const STALE_COUNT_HISTORY_MARKER_RE = /历史|history|VERSIONS|本轮|过时|outdated|superseded/i;
const STALE_COUNT_MIN = 30;
const STALE_COUNT_MAX = 400;
// 参考册面（分发参考册）：技能树从本脚本自身位置推导——权威源与各安装副本（.claude / .agents /
// .dsh/skills）同一推导覆盖，不假定权威源布局（与技能树布局感知注释同一纪律）。
const REFERENCE_FACE_DIR_REL = path
  .relative(REPO_ROOT, path.join(__dirname, '..', 'reference'))
  .split(path.sep).join('/');

function staleCountTargets(root = REPO_ROOT) {
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
function staleCountProblems(counts, root = REPO_ROOT) {
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
function scenarioCountSyncProblems(n, root = REPO_ROOT) {
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
function countSyncProblems(root = REPO_ROOT) {
  const problems = [
    ...scenarioCountSyncProblems(SCENARIOS.length, root),
    ...systemTestCountSyncProblems(root),
  ];
  const { count: itemCount } = readSystemTestItemCount(root);
  problems.push(...staleCountProblems([SCENARIOS.length, itemCount], root));
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
const INTERNAL_DOC_REF_BASES = [
  '.flow-comet/skills/flow-comet', '.claude/skills/flow-comet', '', 'flow-kit',
  '.flow-comet', '.flow-comet/skills', '.flow-comet/rules',
  '.claude', '.claude/skills', '.claude/rules', '.agents/skills', '.dsh/skills',
];
// 窄域报告规则（判别力补丁）：基准全部未解析时，首段属于下列「仓库内树根相对形态」族的引用
// 必须按死引用报告——即使顶层目录在仓库根不存在也报（这正是旧逻辑「顶层整体缺席 → 跳过」
// 会静默放过的形态）。族为声明式清单，只覆盖已确证的形态：flow-comet* 技能目录 / rules。
const INTERNAL_DOC_REF_TREE_ROOT_FAMILIES = [/^flow-comet[A-Za-z0-9-]*$/, /^rules$/];
function isTreeRootRelativeRef(ref) {
  const firstSegment = ref.split('/')[0];
  return INTERNAL_DOC_REF_TREE_ROOT_FAMILIES.some((re) => re.test(firstSegment));
}
// 声明式族（取代"顶层段不存在即静默跳过"）：解析失败后仍允许跳过的形态必须**逐条显式登记**，
// 未登记者一律按死引用报告（fail-closed）。旧语义实测吞掉过指向已移除临时区的真实残留——
// 隐含边界把"允许"藏进了代码，声明式族把允许面变成可见清单，新增跳过必须显式登记。
//   ① 外部命名空间族（前缀声明）：平台侧命名空间，本仓库根天然不存在。
const EXTERNAL_NAMESPACE_PREFIXES = ['DSH_HOME/', 'dsh-tui/', 'dsh-base/'];
//   ② 退役命名空间允许面（**按角色 / 前缀匹配**，不再逐条硬编码精确 ref）：仅限**记录该迁移**
//      的决策件与决策册——退役命名空间在那里是历史事实，改掉反而丢失迁移记录。
//      匹配 = 文件面（前缀形态 `filePrefix` 或角色形态 `role`）+ 引用面（退役命名空间前缀）。
//      精确 ref 硬编码的脆性在于：文件改名即静默失配 → 合法历史迁移记录被误报死引用（误红），
//      而误红会诱导维护者删掉历史事实。改名不改角色，故按角色/前缀匹配；反过来**不**放宽
//      引用面与文件面之外的部分：未登记文件 / 未登记命名空间的引用照旧一律报（fail-closed）。
const RETIRED_NAMESPACE_PREFIX = '.comet/';
// 决策册角色判定：`.specs` 下的决策账本族文件（含改名后的 `CONTEXT-<后缀>.md` 形态）——
// 角色判定按语义而非精确文件名，改名不该让合法迁移记录变成死引用误报。
// 边界（登记）：角色判定只作用于**扫描目标**（该族文件本身须在受检目标清单内才会被扫描）。
function isDecisionLedgerFile(rel) {
  return /^\.specs\/CONTEXT(?:[-.][A-Za-z0-9_.-]+)?\.md$/i.test(rel);
}
// 文件面匹配器（声明式）：kind = filePrefix（路径前缀，改名后缀不影响）| role（角色判定函数）。
const RETIRED_NAMESPACE_FILE_MATCHERS = {
  'decision-ledger': isDecisionLedgerFile,
};
const RETIRED_NAMESPACE_ALLOWLIST = [
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
function matchesRetiredNamespaceEntry(entry, rel, ref) {
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
const EXAMPLE_REF_ALLOWLIST = [
  {
    file: '.specs/adr/ADR-014-parallel-delegation-contract.md',
    ref: 'src/foo.mjs',
    reason: '写冲突盲区的示例路径（非真实文件）',
  },
];
function isDeclaredReferenceSkip(rel, ref) {
  if (EXTERNAL_NAMESPACE_PREFIXES.some((prefix) => ref.startsWith(prefix))) return true;
  if (RETIRED_NAMESPACE_ALLOWLIST.some((e) => matchesRetiredNamespaceEntry(e, rel, ref))) return true;
  if (EXAMPLE_REF_ALLOWLIST.length > 0
    && EXAMPLE_REF_ALLOWLIST.some((e) => e.file === rel && e.ref === ref)) return true;
  return false;
}
const INTERNAL_DOC_REF_ALLOWLIST = new Set(['.specs/archive/CONTEXT-history.md']);
// 引用提取：既有形态（≥1 段路径 + 扩展名）+ **可选行号后缀**（`:N` / `:N-M` / 逗号列表
// `:N,M`）——行号存在性与不越界判据需要把行号一起取出来（见 internalDocsProblems）。
const INTERNAL_DOC_REF_RE = /(?<![A-Za-z0-9_.\-\/])(\.?(?:[A-Za-z0-9_][A-Za-z0-9_.\-]*\/)+[A-Za-z0-9_.\-]+\.(?:md|mjs|cjs|js|ts|json|ya?ml|sh|patch|toml))(?::(\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*))?(?![A-Za-z0-9])/gm;
// 并列写法护栏：首段**本身带文件扩展名**的 token 不是路径引用（如 `TEST.md/REVIEW.md` 是两个
// 文件名并列写法）——不参与解析（存在性判据与行号判据同此）。判据必须收窄到"首段带扩展名"：
// 用"首段含 `.`"会把 `.specs/…` / `.flow-comet/…` 这类隐藏目录一并误排（设计期实测该写法把
// 5 处带行号引用压成 3 处）。
const INTERNAL_DOC_REF_PARALLEL_RE = /\.(?:md|mjs|cjs|js|ts|json|ya?ml|sh|patch|toml)$/i;

// 行号后缀 → 数值数组（区间取两端；逗号列表逐项展开）。
function parseRefLineNumbers(suffix) {
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

function internalDocRefCandidates(text) {
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
function resolveInternalDocRef(ref, root = REPO_ROOT) {
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
function internalDocTargets(root = REPO_ROOT) {
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
const ROADMAP_HEADER_RE = /^\s*>\s*最后更新[:：]\s*(20\d{2}-\d{2}-\d{2})/m;
const INTERNAL_DOC_DATE_RE = /20\d{2}-\d{2}-\d{2}/g;
// 归档目录条目：`<日期>-<change-id>`。
const ARCHIVE_DIR_ENTRY_RE = /^\d{4}-\d{2}-\d{2}-(.+)$/;

// 行号存在与不越界判定（结构级；单一实现）：只在引用本身解析成功后才调用——引用不存在时由
// 死引用判据负责报告（同一处只报一次，不叠两条）。区间取两端、逗号列表逐项，逐个校验 1..N。
function lineNumberProblems(rel, entry, resolvedPath, lineCountOf) {
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
function headerFreshnessProblems(rel, text) {
  const header = text.match(ROADMAP_HEADER_RE);
  if (!header) return [];
  const dates = [...text.matchAll(INTERNAL_DOC_DATE_RE)].map((m) => m[0]);
  const maxBody = dates.reduce((a, b) => (a > b ? a : b), '');
  if (maxBody === '' || header[1] >= maxBody) return [];
  return ['表头不新鲜: ' + rel + ' 表头 ' + header[1] + ' < 正文最大 ' + maxBody
    + '——请把表头日期刷新到不早于正文最大日期'];
}

// 已归档 change 清单（读目录名；归档面缺席 → 空数组，非维护者检出/夹具形态不误红）。
function archivedChangeIds(root = REPO_ROOT) {
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
function roadmapNowArchivedProblems(rel, text, root = REPO_ROOT) {
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

function internalDocsProblems(root = REPO_ROOT) {
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
      // 也没被判缺失，静默跳过会让受检面出现「未执行 ≠ 通过」的黑洞（L-079 同类通道；本批
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
function maintainerFaceSkips(root = REPO_ROOT) {
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

function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-comet-guard-test-'));
  createdDirs.push(dir);
  return dir;
}

// 场景夹具清理（Windows 韧性，2026-10-01 实证）：子进程退出后，其 cwd / 文件句柄可能仍被短暂占用
// → `rmSync` 抛 EPERM/EBUSY。Node 的 `maxRetries`/`retryDelay` 正是为该窗口设计（对 EBUSY /
// EMFILE / ENFILE / ENOTEMPTY / EPERM 线性退避重试）。**仍失败不得让整轮崩溃**——旧写法把
// `rmSync` 裸放在 finally 里，一个目录删不掉就抛未捕获异常：后续场景不执行、末尾的「临时目录
// 清理」判据与失败报告也全都不执行（本机实测：整轮 exit 1 且无 RESULT 行，并每次留下一个残留目录）。
// 现改为「重试 + 容忍」：清理不了的目录留待末尾判据统一报告（可见失败，不静默、也不自杀）。
const CLEANUP_RETRIES = 10;
const CLEANUP_RETRY_DELAY_MS = 150;
// 不返回清理状态：调用方不据它分支，且「清理成功」的**单一判定点**是末尾「临时目录清理」判据
// （避免 helper 与调用方各自 existsSync 形成两套判定——Sourcery 评审指出，2026-10-01 收敛）。
function cleanupTmpDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: CLEANUP_RETRIES, retryDelay: CLEANUP_RETRY_DELAY_MS });
  } catch {
    // 交由末尾「临时目录清理」判据报告
  }
}

// 同步小睡（末尾延迟重试用；主线程可用 Atomics.wait 阻塞等待）
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

// 桥接身份透传契约（套件侧单一构造点，与真实桥接同形）：dsh 桥接在注入身份深度的**同时**注入
// 通道标记 FLOW_COMET_AGENT_DEPTH_SOURCE='dsh-bridge'；守卫要求两者同时在场才接受 env 面身份。
// 套件里凡是要表达「经桥接通道的子代理身份」，一律经本函数构造 env——变量名/标记值只此一处，
// 免得各处手抄而与守卫或桥接漂移。反向形态（只注入深度、不注入标记）由身份族的继承形态断言覆盖。
function bridgeIdentityEnv(depthValue) {
  return {
    FLOW_COMET_AGENT_DEPTH: depthValue,
    FLOW_COMET_AGENT_DEPTH_SOURCE: 'dsh-bridge',
  };
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

// 发布同步守卫（场景 200 子断言）纯函数：权威源 loader 的标记行 / 导出常量与载体
// INSTALLED_VERSION 三处一致性判定——比较语义 = bridge-check 既有语义（MECHANISM 二·二十七
// 「bridge-check 基础版本归一」：比较前剥离 git-describe dev 态后缀 `-<N>-g<hash>`、按基础版本
// 比较；预发布标识（如 -rc.N）不是 dev 态后缀、不剥离；基础版本不同（含发布版对发布版）仍报
// 漂移）。归一复用 fixtureBridgeBaseVersion（单点正则，不再复制第二份实现）——发布态权威源与
// dev 态安装副本（INSTALLED_VERSION = `<发布>-<N>-g<hash>`）归一后同基础判同步；真实跨文件/
// 跨值分叉仍必报。返回问题描述数组（空 = 三处基础版本一致）。
function bridgeStampSyncProblems(markerStamp, exportStamp, installedVersion) {
  const base = fixtureBridgeBaseVersion;
  const problems = [];
  if (base(markerStamp) !== base(installedVersion)) {
    problems.push('标记行=' + markerStamp + '（基础 ' + base(markerStamp) + '）vs INSTALLED_VERSION=' + installedVersion + '（基础 ' + base(installedVersion) + '）');
  }
  if (base(exportStamp) !== base(installedVersion)) {
    problems.push('export=' + exportStamp + '（基础 ' + base(exportStamp) + '）vs INSTALLED_VERSION=' + installedVersion + '（基础 ' + base(installedVersion) + '）');
  }
  return problems;
}

// 发布同步守卫（场景 200）子锚表（判别力双向，全部由载体基础版本派生）：正例 = 三处基础版本一致
// （含 dev 态副本戳 vs 权威源发布戳的真实形态、两侧 dev 后缀同基础）；负例 = 标记行 / export
// 任一基础版本漂移、发布版对发布版失配、预发布标识不剥离——归一不得放行真实漂移。
function bridgeStampSyncSubAnchorCases(baseVersion, devVersion) {
  const major = parseInt(baseVersion.split('.')[0], 10);
  const otherBase = (major + 9) + '.0.0';
  return [
    { label: 'dev 态副本戳 vs 权威源发布戳同基础', expectSync: true, problems: bridgeStampSyncProblems(baseVersion, baseVersion, devVersion) },
    { label: '两侧 dev 后缀同基础', expectSync: true, problems: bridgeStampSyncProblems(baseVersion + '-2-g1234567', baseVersion + '-1-gabcdef0', devVersion) },
    { label: '标记行基础版本不同', expectSync: false, problems: bridgeStampSyncProblems(otherBase, baseVersion, devVersion) },
    { label: 'export 基础版本不同', expectSync: false, problems: bridgeStampSyncProblems(baseVersion, otherBase, devVersion) },
    { label: '发布版对发布版失配', expectSync: false, problems: bridgeStampSyncProblems('9.9.9-fixture-skew', baseVersion, baseVersion) },
    { label: '预发布标识不剥离', expectSync: false, problems: bridgeStampSyncProblems(baseVersion + '-rc.3', baseVersion, devVersion) },
  ];
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
// 便携递归复制：不使用 fs.cpSync——实测在 Windows 且**源路径含非 ASCII 字符**时 cpSync 会让
// 进程静默崩溃（同一进程内 ASCII 源正常、中文源直接退出，逐文件复制两种源都正常），使本套件在
// 路径含中文的项目内无法跑完。逐目录逐文件复制无此问题，且复制完整性与内容可断言。
function copyTreePortable(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTreePortable(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
  }
}

function writeInstalledCopyBridgeFixture(dir, { installedVersion, loaderStamp }) {
  const skillCopy = path.join(dir, '.dsh', 'skills', 'flow-comet');
  copyTreePortable(path.join(__dirname, '..'), skillCopy);
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

// result 重验撤销审计断言（共享单一来源）：撤销后 request evidence 必须 noCommit=false，
// 且含非空、可被 Date 解析的 revokedAt 与失败类别对应的 revokeReason（缺任一即审计缺口）。
function assertRevocationAudit(req, expectedReason, label) {
  if (!req || req.noCommit !== false) {
    throw new Error(label + '：撤销后 request evidence 应为 noCommit=false，实际 ' + JSON.stringify(req));
  }
  if (typeof req.revokedAt !== 'string' || req.revokedAt.trim() === '' || Number.isNaN(Date.parse(req.revokedAt))) {
    throw new Error(label + '：撤销应记录非空且可被 Date 解析的 revokedAt，实际 ' + JSON.stringify(req.revokedAt));
  }
  if (req.revokeReason !== expectedReason) {
    throw new Error(label + '：撤销应记录 revokeReason=' + expectedReason + '，实际 ' + JSON.stringify(req.revokeReason));
  }
}

// state 不变量断言（m-09 / AC-4 / AC-12）：白名单外深比 + history 旧前缀稳定 + 恰新增一条
// exit-applied 事件。白名单为点分路径（如 'currentNode' / 'evidence.execute.completedChecks'）。
// 判别力：实现若顺手写白名单外字段、重写 history 旧条目、多推/漏推出口事件即抛错。
function omitStatePath(root, dottedPath) {
  const parts = String(dottedPath).split('.');
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cursor || typeof cursor !== 'object') return;
    cursor = cursor[parts[i]];
  }
  if (cursor && typeof cursor === 'object') delete cursor[parts[parts.length - 1]];
}

function assertStateOnlyChanged(before, after, options = {}) {
  const label = options.label ? '[' + options.label + '] ' : '';
  const allowed = Array.isArray(options.allowed) ? options.allowed : [];
  const expectNewExitApplied = options.expectNewExitApplied === undefined ? 1 : options.expectNewExitApplied;
  const beforeCmp = JSON.parse(JSON.stringify(before));
  const afterCmp = JSON.parse(JSON.stringify(after));
  for (const p of allowed) {
    omitStatePath(beforeCmp, p);
    omitStatePath(afterCmp, p);
  }
  if (!isDeepStrictEqual(beforeCmp, afterCmp)) {
    throw new Error(label + '白名单外 state 深度不变量被破坏（allowed=' + JSON.stringify(allowed) + '）\n'
      + 'before=' + JSON.stringify(beforeCmp) + '\nafter=' + JSON.stringify(afterCmp));
  }
  const beforeHistory = Array.isArray(before?.history) ? before.history : [];
  const afterHistory = Array.isArray(after?.history) ? after.history : [];
  if (!isDeepStrictEqual(afterHistory.slice(0, beforeHistory.length), beforeHistory)) {
    throw new Error(label + 'history 旧前缀被改写（旧条目必须逐字稳定）');
  }
  const appended = afterHistory.slice(beforeHistory.length);
  if (appended.length !== expectNewExitApplied) {
    throw new Error(label + 'history 应恰新增 ' + expectNewExitApplied + ' 条，实际 ' + appended.length
      + '：' + JSON.stringify(appended));
  }
  for (const event of appended) {
    if (!event || event.event !== 'exit-applied') {
      throw new Error(label + '新增 history 条目应为 exit-applied：' + JSON.stringify(event));
    }
  }
  return appended;
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
  return JSON.parse(fs.readFileSync(scenarioProtocolPath(dir), 'utf8'));
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

// exit execute 二次完成回源场景公共夹具（场景族拆分后由三个顶层场景共享；每个场景仍在独立
// 临时目录运行，状态不跨场景共享）：家族证据与基础 state 的字段基线在此单一表达。
function fixReturnFamilyEvidence(taskIds) {
  return {
    execute: { summary: 'fix batch executed', completedChecks: ['required-skill:execute.flow-comet-dev'] },
    'subagent-execute': { summary: 'delegated', handoffResult: handoffFor(taskIds) },
    review: { summary: 'review in progress' },
  };
}

function fixReturnBaseState(overrides = {}) {
  return {
    activeChange: CHANGE_ID,
    currentNode: 'execute',
    completedNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
    enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
    evidence: fixReturnFamilyEvidence(['T01']),
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
    newChange: true,
    ...overrides,
  };
}

const FIX_RETURN_FAMILY_COMPLETED = 'open,design,plan,execute,subagent-execute';

// 回源夹具的 REVIEW.md 正文：内容表达「审查未完成、Fix 批次待回源出口」，文件在场即触发
// 路由按产物跳过 review 的行为。
const FIX_RETURN_REVIEW_TEXT = '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\n审查结论已记录；Fix 批次由 execute 完成，待回源重新出口。\n';

// 逐任务写入摘要夹具（id 列表由调用场景给出，未列出的任务不会凭空出现摘要）。
function writeFixReturnSummaries(dir, taskIds) {
  for (const id of taskIds) {
    writeFile(dir, '.specs/' + CHANGE_ID + '/' + id + '-SUMMARY.md', strictSummary(id));
  }
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

// ---------- 受控重入（archive 源回边）场景材料（先写期望后执行） ----------
// archive 已 entry 且归档目录仍在原位时的受控重入契约（设计决策清单全部条目 /
// REQUIREMENT AC-1~AC-10）：CLI 入口为
// `workflow-state.mjs reenter <target> --authorized-by <source> --reason <text>`。
// 本段只装配夹具与断言助手；判定语义的唯一权威在 route-node.mjs（测试侧不复制生产判定——
// L-067）；前驱交集期望值由内置协议 success 边独立推导，是测试判据的独立复算。

// 内置协议（route 顺序 open→design→plan→execute→subagent-execute→review→verify→archive）
// 下 predecessors(target) 的期望交集：success 边反向传递闭包，按协议顺序输出。
const REENTRY_EXPECTED_INTERSECTION = {
  'execute': ['open', 'design', 'plan'],
  'subagent-execute': ['open', 'design', 'plan', 'execute'],
  'review': ['open', 'design', 'plan', 'execute', 'subagent-execute'],
  'verify': ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review'],
};
const REENTRY_FULL_COMPLETED = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify'];

// archive 已 entry 夹具（AC-1 初始状态）：归档目录仍在原位、status=running、前驱全已完成；
// overrides 覆盖旧 change（无 newChange 字段）/ status=completed / 轮次事件等形态。
// branchMode / enablePrReview / branchPrefix 显式在场——避免 readState 的旧 state 默认补齐
// 让「白名单外字段零改写」断言混入实现细节噪音。
function reentryArchiveState(overrides = {}) {
  return {
    activeChange: CHANGE_ID,
    currentNode: 'archive',
    completedNodes: [...REENTRY_FULL_COMPLETED],
    enteredNodes: [...REENTRY_FULL_COMPLETED, 'archive'],
    evidence: {},
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
    newChange: true,
    status: 'running',
    branchMode: true,
    enablePrReview: false,
    branchPrefix: 'change/',
    history: [{ event: 'exit-applied', node: 'verify', at: '2026-09-20T00:00:00.000Z', change: CHANGE_ID }],
    ...overrides,
  };
}

// 归档目录仍在原位（移动边界判定的前提之一）：CHANGE.md + TASK.md 在场
function writeReentryChangeDir(dir, changeName = CHANGE_ID) {
  writeFile(dir, '.specs/' + changeName + '/CHANGE.md', '# CHANGE\n\n## Why\n\n受控重入夹具。\n');
  writeFile(dir, '.specs/' + changeName + '/TASK.md', '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n');
}

// 受控重入 CLI（真实命令路径）：env 显式注入协议路径（门禁不得静默跳过）；
// extra 供 --protocol 等追加参数；reenter 未落地前本路径因 unknown subcommand 必然 RED。
function runReenter(dir, target, options = {}) {
  const args = ['reenter', target];
  if (options.source !== undefined) args.push('--authorized-by', options.source);
  if (options.reason !== undefined) args.push('--reason', options.reason);
  if (Array.isArray(options.extra)) args.push(...options.extra);
  return runState(args, dir, {
    FLOW_COMET_PROTOCOL: options.protocol || scenarioProtocolPath(dir),
  });
}

// state 原始字节：BLOCK / 空操作路径的「字节零改写」判据（JSON 深比会漏掉格式化、键序与
// 序列化表示漂移——字节比较才是契约）。
function readStateBytes(dir) {
  const file = path.join(dir, '.flow-comet', 'flow-comet-state.json');
  if (!fs.existsSync(file)) {
    throw new Error('state 文件缺失（夹具错误或命令删除了 state）: ' + file);
  }
  return fs.readFileSync(file, 'utf8');
}

function assertStateBytesUnchanged(dir, before, label) {
  const after = readStateBytes(dir);
  if (after !== before) {
    throw new Error(label + '：要求 state 字节零改写，实际发生变化\nbefore:\n' + before + '\nafter:\n' + after);
  }
}

// 备份文件清单（备份路径规则 .specs/<change-id>/.reentry-backups/）：BLOCK / 空操作路径必须零新增。
function reentryBackupFiles(dir, changeName = CHANGE_ID) {
  const backupDir = path.join(dir, '.specs', changeName, '.reentry-backups');
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).sort();
}

// 轮次事件夹具：change 归属字段是跨 change 隔离的唯一依据（写侧必须带 change）——
// 不带 change 的旧事件按 legacy 形态参与（reentry-applied 为新事件类型，实际不会出现）。
function reentryHistoryEvent(roundNumber, changeName = CHANGE_ID) {
  return {
    event: 'reentry-applied',
    from: 'archive',
    to: 'verify',
    round: roundNumber,
    change: changeName,
    authorization: { round: roundNumber, at: '2026-09-20T00:00:00.000Z', source: 'user-approval', target: 'verify' },
    backup: '.specs/' + changeName + '/.reentry-backups/2026-09-20T00-00-00.000Z-pre-verify.json',
    fingerprint: '0'.repeat(64),
    at: '2026-09-20T00:00:00.000Z',
  };
}

// 授权形态纯函数锚（AC-2 的 guard-self-test 验证方式）：形态合法性由 route-node 的
// parseReentryAuthorization 单一权威判定，本助手只声明期望（malformed → ok:false）。
function assertReentryAuthorizationShape(authorization, target, expectedOk, label) {
  const parse = requireRouteNodeExport('parseReentryAuthorization');
  const result = parse({ authorization, target });
  if (!result || result.ok !== expectedOk) {
    throw new Error('[' + label + '] 授权形态判定应为 ok=' + expectedOk + '，实际 ' + JSON.stringify(result));
  }
  return result;
}

// 输出正则断言（BLOCK 指引类断言的共享助手；精确关键词断言用 assertOut）。
function assertOutMatches(res, pattern, label) {
  const text = outputText(res);
  if (!pattern.test(text)) {
    throw new Error((label || '输出') + ' 应匹配 ' + pattern + '，实际输出:\n' + text);
  }
}

// ---------- 受控计划重校重签（replan）与强制推进留痕（advance-forced）场景材料 ----------
// replan 是"计划在执行中被证明有缺陷"时的受控通道（ADR-013）：仅 execute / subagent-execute
// 相位可用、停原位、不跳节点——重新校验任务图与任务字段 → 重录 state.taskHash → 双写留痕
// （evidence.<node>.replanAuthorization + history 事件 replan-applied）。判定语义的唯一权威在
// route-node.mjs（测试侧不复制生产判定——L-067）；本段只装配夹具与断言助手。纯函数契约按
// reentry 族同构声明：
//   parseReplanAuthorization({ authorization, node })  // authorization = { round, at, source, reason, node }
//   replanRoundCount({ history, changeName })
//   replanRoundDecision({ history, changeName, continuationAuthorized })
//   replanNoOpDecision({ state, taskContent })
//   resolveReplanDecision({ protocol, state, authorization, continuationRound })
// 缺失导出由 requireRouteNodeExport 在场景内显式报告（RED 可定位到具体场景，不整套件 abort）。

// 修订前的任务集（entry 形态）：一个串行待办任务
const REPLAN_TASK_INITIAL =
  '<task id="S01" status="pending" parallel="false"><action>实现 S01</action>'
  + '<write_files>src/s01.mjs</write_files><verify>node --check src/s01.mjs</verify></task>\n';
// 修订后的任务集（死锁现场）：原任务完成 + 计划外新增的并行就绪任务
const REPLAN_TASK_REVISED =
  '<task id="S01" status="done" parallel="false"><action>实现 S01</action>'
  + '<write_files>src/s01.mjs</write_files><verify>node --check src/s01.mjs</verify></task>\n'
  + '<task id="P02" status="pending" parallel="true"><action>实现计划外新增的 P02</action>'
  + '<write_files>src/p02.mjs</write_files><verify>node --check src/p02.mjs</verify></task>\n';
// 缺 <verify> 字段的负例任务集（plan 出口与 replan 共用的任务字段校验）
const REPLAN_TASK_NO_VERIFY =
  '<task id="S01" status="pending" parallel="false"><action>实现 S01</action>'
  + '<write_files>src/s01.mjs</write_files></task>\n';
// 过期签名占位（与哈希算法实现解耦：只比较是否相等/同版本，不依赖真实摘要值）
const REPLAN_STALE_SIGNATURE = 'v1:' + '0'.repeat(64);

// replan 相位夹具：execute 已 entry、前序完成、证据齐备（execute 出口可通过）、TASK.md 在场。
// branchMode / enablePrReview / branchPrefix 显式在场——避免 readState 兼容默认值让「零改写」
// 口径混入实现细节噪音（与受控重入夹具同做法）。
function replanExecuteState(overrides = {}) {
  return {
    activeChange: CHANGE_ID,
    currentNode: 'execute',
    completedNodes: ['open', 'design', 'plan'],
    enteredNodes: ['open', 'design', 'plan', 'execute'],
    evidence: {
      open: { summary: 'open done' },
      design: { summary: 'design done' },
      plan: { summary: 'plan done' },
      execute: { summary: 'implementation recorded' },
      'subagent-execute': { handoffResult: handoffFor(['S01']) },
    },
    verifyFailures: 0,
    executionMode: 'subagent',
    directOverride: false,
    newChange: true,
    status: 'running',
    branchMode: false,
    enablePrReview: false,
    branchPrefix: 'change/',
    history: [{ event: 'exit-applied', node: 'plan', at: '2026-09-27T00:00:00.000Z', change: CHANGE_ID }],
    ...overrides,
  };
}

// 备份目录/清单（replan 备份规则 .specs/<change-id>/replan-backups/）：BLOCK / 空操作路径零新增。
function replanBackupFiles(dir, changeName = CHANGE_ID) {
  const backupDir = path.join(dir, '.specs', changeName, 'replan-backups');
  return fs.existsSync(backupDir) ? fs.readdirSync(backupDir).sort() : [];
}

// replan-applied 事件过滤（轮次按 change 从 history 派生——与受控重入同计数法）
function replanEventsOf(state) {
  return (state.history || []).filter((e) => e && e.event === 'replan-applied');
}

// 轮次事件夹具：change 归属字段是跨 change 隔离的唯一依据（写侧必须带 change）
function replanHistoryEvent(roundNumber, changeName = CHANGE_ID) {
  return {
    event: 'replan-applied',
    node: 'execute',
    round: roundNumber,
    change: changeName,
    reason: '计划重校',
    authorizedBy: 'user-approval',
    taskSetSignature: REPLAN_STALE_SIGNATURE,
    at: '2026-09-27T00:00:00.000Z',
  };
}

// advance-forced 事件夹具（status.forcedNodes 事件判据）：change 归属过滤与 advance 写侧同形——
// 派生只取 event / change / node，skipped 等字段保留以贴近真实事件。
function advanceForcedEvent(node, changeName = CHANGE_ID) {
  return {
    event: 'advance-forced',
    change: changeName,
    node,
    skipped: ['exit:' + node],
    reason: 'advance',
    at: '2026-09-28T00:00:00.000Z',
  };
}

// 授权形态纯函数锚（AC-2 的 guard-self-test 验证方式）：形态合法性由 route-node 的
// parseReplanAuthorization 单一权威判定，本助手只声明期望（malformed → ok:false）。
function assertReplanAuthorizationShape(authorization, node, expectedOk, label) {
  const parse = requireRouteNodeExport('parseReplanAuthorization');
  const result = parse({ authorization, node });
  if (!result || result.ok !== expectedOk) {
    throw new Error('[' + label + '] replan 授权形态判定应为 ok=' + expectedOk + '，实际 ' + JSON.stringify(result));
  }
  return result;
}

// 重签复核：state.taskHash 必须等于当前 TASK.md 的签名（同版本比较复用 route-node 既有实现，
// 不在此内联第二份判据）。
function assertReplanSignatureRecorded(state, taskContent, label) {
  const same = requireRouteNodeExport('sameTaskSetSignature');
  const signature = requireRouteNodeExport('taskSetSignature')(taskContent);
  if (!same(state.taskHash, signature)) {
    throw new Error(label + '：state.taskHash 应重签为当前 TASK.md 的签名，实际 '
      + JSON.stringify(state.taskHash) + '，期望 ' + JSON.stringify(signature));
  }
  return signature;
}

// status 输出（JSON 块 + 尾巴行）解析：只取首个 { 到末个 } 之间的 JSON 对象。
function parseStatusJson(res) {
  const text = outputText(res);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('status 输出缺少 JSON 块:\n' + text);
  return JSON.parse(text.slice(start, end + 1));
}

// 场景协议副本路径（单一来源，L-067）：以 dir 为基准的协议路径表达式只在此处出现一次；
// 调用面统一走下方助手。跨树（root）/ 安装副本（skillCopy）/ 自定义协议（options.protocol 或
// --protocol CLI）场景仍各自显式传路径，不经本助手（数据点保留）。
function scenarioProtocolPath(dir) {
  return path.join(dir, 'reference', 'workflow-protocol.json');
}

// 场景内受控命令（replan / advance / status / next）：显式注入场景协议副本路径
// （L-079：依赖协议解析的门禁不得静默跳过；副本由运行器预置在 <dir>/reference/）。
function runStateWithProtocol(dir, args) {
  return runState(args, dir, { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
}

// 同形 runGuard 助手（入口/出口门禁场景）：注入与 runStateWithProtocol 同一 FLOW_COMET_PROTOCOL 表达。
function runGuardWithProtocol(dir, args) {
  return runGuard(args, dir, { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
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
    '## 数据库迁移',
    '',
    'N/A：本任务无 schema 变更（条件段按模板占位）。',
    '',
    '## 越界检查',
    '',
    '仅修改 src/' + taskId.toLowerCase() + '.mjs，无越界。',
    '',
    '## 破坏性变更',
    '',
    'N/A：本任务不涉及破坏性变更。',
    '',
    '## 决策与偏离',
    '',
    '无偏离。',
    '',
    '## 是否触发新工作',
    '',
    '无。',
    '',
    '## 完成判定',
    '',
    '- TASK.md 中对应任务已勾选：是',
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
// 并行写冲突（replan 越界场景扩展）：前置串行任务已 done，两个并行任务依赖已满足且 write_files
// 重叠——plan 出口写写强判为 BLOCKED，replan 不做校验豁免、必须同样 BLOCK 且状态零改写（禁止备份先于拦截）。
const TASK_PARALLEL_WRITE_CONFLICT =
  '<task id="S01" parallel="false" status="done"><action>完成 S01</action><write_files>src/s01.mjs</write_files><verify>node --check src/s01.mjs</verify></task>\n' +
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify><depends_on>S01</depends_on></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify><depends_on>S01</depends_on></task>\n';

// 并行读写弱判（replan 侧，2026-09-28 PR 审查补锚）：同一对并行任务无显式 depends_on，一方读取对方
// 写路径 → 与 plan 出口同一判据：read∩write 仅 WARN 不阻断，replan 照常重签并写重签前备份。
const TASK_PARALLEL_READ_OVERLAP =
  '<task id="P01" parallel="true" status="pending"><action>实现 P01</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify></task>\n' +
  '<task id="P02" parallel="true" status="pending"><action>实现 P02</action><read_files>src/shared.mjs</read_files><write_files>src/other.mjs</write_files><verify>node --check src/other.mjs</verify></task>\n';

// 同文件跨任务（第三族）夹具族：串行拆分出的同文件任务、彼此无 depends_on（#125 要抓的形态）。
// ① 非修复任务对 → 必须命中；② 修复任务族对（同文件回修）→ 不参与（顺序由修复生命周期保证）；
// ③ 混合夹具：两类并存 → 只报非修复对（反向构造：第三族缺位时 ①③ 必然放过）。
const CROSS_TASK_PLAIN_PAIR =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify></task>\n'
  + '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify></task>\n';
const CROSS_TASK_FIX_PAIR =
  '<task id="T-FIX-01" parallel="false" status="pending"><action>修复 T-FIX-01</action><write_files>src/fix-shared.mjs</write_files><verify>node --check src/fix-shared.mjs</verify></task>\n'
  + '<task id="T-FIX-02" parallel="false" status="pending"><action>修复 T-FIX-02</action><write_files>src/fix-shared.mjs</write_files><verify>node --check src/fix-shared.mjs</verify></task>\n';
const CROSS_TASK_MIXED_PAIR =
  '<task id="T01" parallel="false" status="pending"><action>实现 T01</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify></task>\n'
  + '<task id="T02" parallel="false" status="pending"><action>实现 T02</action><write_files>src/shared.mjs</write_files><verify>node --check src/shared.mjs</verify></task>\n'
  + '<task id="T-FIX-01" parallel="false" status="pending"><action>修复 T-FIX-01</action><write_files>src/other-shared.mjs</write_files><verify>node --check src/other-shared.mjs</verify></task>\n'
  + '<task id="T-FIX-02" parallel="false" status="pending"><action>修复 T-FIX-02</action><write_files>src/other-shared.mjs</write_files><verify>node --check src/other-shared.mjs</verify></task>\n';
// ④ **段归属分支**夹具：修复段内的任务 id **不带**修复族前缀（F01/F02）——判定必须靠「位于修复
// 任务段内」这条边界，而不是 id 命名。既有 ② 用的是带前缀 id，走的是 id 分支，段归属分支此前
// 没有行为夹具（该分支的行尾归一口径缺陷因此漏过，2026-10-01 PR 审查发现后补）。
// **块内必须跨行**：单行块在 LF 与 CRLF 下文本完全相同，行尾口径缺陷无从显现——真实 TASK.md
// 的任务块本就跨行，夹具按真实形态构造（否则夹具自身无判别力）。
const CROSS_TASK_FIX_SECTION_PAIR =
  '## Fix 任务（来自 REVIEW）\n\n'
  + '<task id="F01" parallel="false" status="pending">\n'
  + '  <action>回修 F01</action>\n'
  + '  <write_files>src/section-shared.mjs</write_files>\n'
  + '  <verify>node --check src/section-shared.mjs</verify>\n'
  + '</task>\n'
  + '<task id="F02" parallel="false" status="pending">\n'
  + '  <action>回修 F02</action>\n'
  + '  <write_files>src/section-shared.mjs</write_files>\n'
  + '  <verify>node --check src/section-shared.mjs</verify>\n'
  + '</task>\n';

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

// ---------- 结构锚的共享判定（判别力升级：按表达式形态计数，而不只是数标识符名） ----------

// 引擎脚本集（不含套件自身与系统测试集）：结构锚共用同一清单——多处各写一份过滤表达式会在
// 清单口径变化时漂移（同一事实的第二实现）。
function engineScriptFiles(scriptsDir = __dirname) {
  return fs.readdirSync(scriptsDir)
    .filter((f) => f.endsWith('.mjs') && f !== 'guard-self-test.mjs' && f !== 'system-test.mjs');
}

// 注释行判定：与检查工具的注释层口径一致（行首 // / /* / * 才算注释行，行尾注释不在此列）。
function isScriptCommentLine(line) {
  return /^\s*(\/\/|\*|\/\*)/.test(line);
}

// 具名函数体文本：先配平参数表圆括号（解构入参内含 `new Map()` 一类调用），再配平函数体花括号。
// 目标函数体内不含字符串花括号，故不做字面量扫描。找不到定义返回 null——调用方据此显式报告
// "结构锚前提失效"，不静默按通过处理。
function functionBodyText(text, name) {
  const start = text.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = text.indexOf('(', start);
  if (i < 0) return null;
  let parens = 0;
  for (; i < text.length; i += 1) {
    if (text[i] === '(') parens += 1;
    else if (text[i] === ')') {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  i = text.indexOf('{', i);
  if (i < 0) return null;
  let depth = 0;
  for (; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// 修复族 id 前缀边界的权威表达式文本（单一来源：判据与夹具锚共用同一份字面量）。
const FIX_PREFIX_LITERAL_TEXT = '/^[TP]-FIX-/i';

// 修复族边界"出现处"扫描（纯读取，单一实现）：引擎脚本里的五类出现面——
//   前缀正则字面量 / 含 FIX 词干的其它正则字面量 / 修复族 id 字符串字面量 / 段内成员判定 /
//   边界常量的按文件使用次数。注释行不参与（与检查工具的注释层口径一致）：注释里提到标识符
//   是说明，不是第二份实现。判定与扫描分离（本函数只收集事实，下函数只下结论）。
function fixFamilyBoundarySites(scriptsDir = __dirname) {
  const sites = {
    prefixLiterals: [],
    otherFixRegexes: [],
    idLiterals: [],
    sectionMemberships: [],
    prefixUsesByFile: new Map(),
    texts: new Map(),
  };
  for (const file of engineScriptFiles(scriptsDir)) {
    const text = fs.readFileSync(path.join(scriptsDir, file), 'utf8');
    sites.texts.set(file, text);
    const lines = text.split(/\r?\n/);
    let prefixUses = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (isScriptCommentLine(line)) continue;
      let at = line.indexOf(FIX_PREFIX_LITERAL_TEXT);
      while (at >= 0) {
        sites.prefixLiterals.push(file + ':' + (i + 1));
        at = line.indexOf(FIX_PREFIX_LITERAL_TEXT, at + 1);
      }
      // 含 FIX 词干的其它正则字面量（单行内闭合、\ 转义感知）：第二份前缀表达式在此现形
      for (const m of line.matchAll(/\/(?:\\.|[^/\\\n])*FIX(?:\\.|[^/\\\n])*\/[a-z]*/g)) {
        if (m[0] !== FIX_PREFIX_LITERAL_TEXT) sites.otherFixRegexes.push(file + ':' + (i + 1) + ' ' + m[0]);
      }
      for (const token of ['T-FIX', 'P-FIX']) {
        if (line.includes(token)) sites.idLiterals.push(file + ':' + (i + 1) + ' ' + token);
      }
      if (line.includes('sectionBlocks.has(')) sites.sectionMemberships.push(file + ':' + (i + 1));
      prefixUses += line.split('FIX_TASK_ID_PREFIX').length - 1;
    }
    if (prefixUses > 0) sites.prefixUsesByFile.set(file, prefixUses);
  }
  return sites;
}

// 修复族约定「只表达一次」判定（AC-15 判别力锚）：返回问题描述数组（空数组 = 唯一表达）。
// 判别力设计——旧锚按**标识符名**统计（哪个文件里出现该常量名），对"同一约定被表达两次"
// 零判别力：第二份等价前缀表达式（交替式写法）不含该常量名 → 旧锚必放过（虚假单一来源信心）。
// 本判据按**表达式形态**计数（扫描见 fixFamilyBoundarySites），四条一起构成"约定被表达两次即红"：
//   ① id 前缀边界：唯一前缀正则字面量只允许出现一次，且必须位于 route-node.mjs；
//   ② 第二份表达式：引擎代码行不得出现其它含 FIX 词干的正则字面量，也不得出现修复族 id 的
//      字符串字面量（`.startsWith(...)` 一类内联前缀判定形态）；
//   ③ 段内边界：段内成员判定（`sectionBlocks.has(`）只允许出现一次——「位于修复段内」这条
//      边界只在唯一分类器里表达；
//   ④ 谓词共用：修复族标记与并行文件依赖第三族的参与者排除必须各自调用唯一分类器，且不得
//      自持边界常量 / 段切片（任一消费方自建第二份边界即红）。
// 判据自身的判别力由场景内的反向夹具锚（同源 → 无问题；逐条注入 → 逐条专项报告）常驻保证。
function fixFamilyBoundaryProblems(scriptsDir = __dirname) {
  const problems = [];
  const sites = fixFamilyBoundarySites(scriptsDir);
  if (sites.prefixLiterals.length !== 1 || !sites.prefixLiterals[0].startsWith('route-node.mjs:')) {
    problems.push('修复族 id 前缀边界必须只表达一次且位于 route-node.mjs，实际出现处: '
      + JSON.stringify(sites.prefixLiterals));
  }
  if (sites.otherFixRegexes.length !== 0) {
    problems.push('引擎内出现第二份修复族 id 前缀表达式（同一约定被表达两次）: '
      + sites.otherFixRegexes.join('; '));
  }
  if (sites.idLiterals.length !== 0) {
    problems.push('引擎代码行出现修复族 id 字面量（内联前缀判定形态，应经唯一分类器）: '
      + sites.idLiterals.join('; '));
  }
  if (sites.sectionMemberships.length !== 1) {
    problems.push('「位于修复段内」边界（段内成员判定）必须只表达一次，实际出现处: '
      + JSON.stringify(sites.sectionMemberships));
  }
  // 边界常量的使用面：定义 1 处 + 唯一分类器内 1 次 test = 2（其他消费方一律经分类器）
  const prefixUseTotal = [...sites.prefixUsesByFile.values()].reduce((a, b) => a + b, 0);
  if (prefixUseTotal !== 2 || sites.prefixUsesByFile.size !== 1 || !sites.prefixUsesByFile.has('route-node.mjs')) {
    problems.push('修复族 id 边界常量的使用面必须恰为「定义 + 唯一分类器内一次判定」，实际: '
      + JSON.stringify([...sites.prefixUsesByFile.entries()]));
  }
  const routeText = sites.texts.get('route-node.mjs') ?? '';
  for (const fnName of ['fixTaskMarker', 'collectCrossTaskConflicts']) {
    const body = functionBodyText(routeText, fnName);
    if (body === null) {
      problems.push('结构锚前提失效：route-node.mjs 未找到 ' + fnName + ' 的定义');
      continue;
    }
    if (!/fixTaskClassifier\s*\(/.test(body)) {
      problems.push(fnName + ' 必须经唯一分类器判定修复族（不得自持第二份边界）');
    }
    if (/FIX_TASK_ID_PREFIX|fixSectionBody/.test(body)) {
      problems.push(fnName + ' 自持修复族边界常量 / 段切片（应只调用唯一分类器）');
    }
  }
  return problems;
}

// ---------- 词表镜像漂移判据（主仓私有单一来源 ↔ 分发套件的同义镜像；L-067 收口） ----------
// 背景：套件随技能包分发、不能 import 主仓私有的 .githooks（该面不随 clone 分发），故套件内
// 保留同义镜像 PUBLIC_CODE_RE。两份此前只有注释互指"同步"，零一致性判据：主仓增补模式时
// 分发侧扫描静默落后（新词可在公开面长期存活而套件全绿），反向则分发面误红——正是
// 「同一判据两份实现必然分叉」点名的形态。本判据把等价性变成机检事实：
//   · 主仓形态（权威源检出）：读 .githooks 的 BANNED.source，与套件镜像**逐字符比对**，
//     不等即报（消息含两侧 source 片段、长度与首个差异位置，可直接定位）；
//   · 安装副本形态：该私有面结构性缺席 → 判据**不适用**，由调用方输出显式「不适用」描述符
//     （未验证 ≠ 通过，与维护者面缺席的可见 SKIP 同族语义）。
const GITHOOKS_CODES_REL = path.posix.join('.githooks', 'internal-codes.mjs');

// 导出正则字面量抽取（\ 转义感知）：从 `export const <name> = /<body>/<flags>;` 取 body 与 flags。
// 解析失败返回 null（调用方按"判据未执行"显式报告，不静默放过）。
function extractExportedRegexLiteral(text, name) {
  const re = new RegExp('export\\s+const\\s+' + name + '\\s*=\\s*/((?:\\\\.|[^/\\\\\\n])*)/([a-z]*)\\s*;');
  const m = re.exec(text);
  return m === null ? null : { source: m[1], flags: m[2] };
}

function vocabularyMirrorProblems(root = REPO_ROOT) {
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

// ---------- 侧命令锚点材料（evolve / health / context-scan + 到期提示 + ui-design 强制等级） ----------
// 三条侧命令与 ui-design 门是横向机制：判据一律走**真实 CLI**（spawn）或**模块导出**（动态导入
// 同一实现），套件内不复制第二份判据。零写入判据用**树指纹**（相对路径清单 + 文件 sha256）表达——
// 「跑完没变」与「跑前跑后一致」是同一判据的两种说法，此处只实现一次。

const timeUtilsModule = await import(pathToFileURL(path.join(__dirname, 'time-utils.mjs')).href);
const contextInitModule = await import(pathToFileURL(path.join(__dirname, 'context-init.mjs')).href);
const stateSchemaModule = await import(pathToFileURL(path.join(__dirname, 'state-schema.mjs')).href);

const SIDE_EVOLVE = path.join(__dirname, 'evolve.mjs');
const SIDE_HEALTH = path.join(__dirname, 'health.mjs');
const SIDE_CONTEXT_SCAN = path.join(__dirname, 'context-scan.mjs');
const SKILL_PROTOCOL_FILE = path.join(__dirname, '..', 'reference', 'workflow-protocol.json');

function requireModuleExport(moduleObject, name, where) {
  const value = moduleObject[name];
  if (value === undefined) {
    throw new Error(where + ' 缺导出 ' + name + '（套件锚点前提失效：单一实现被改名 / 移除）');
  }
  return value;
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + '：期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
}

// 侧命令真实调用（cwd = 项目根；--root 由调用方显式传入——侧命令不进 8 节点流程）。
// FLOW_COMET_PROTOCOL 注入场景内协议副本，与 runGuard / runStateWithProtocol 同一表达：协议路径的
// 唯一权威是 state-schema 的选择器（state.protocolPath > 环境变量 > 内置默认），侧命令的子进程
// （workflow-state 通道）因此要看到与门禁同一份协议来源——平台侧注入环境变量正是真实项目形态。
// 需要构造「无环境变量」的场景用 `{ FLOW_COMET_PROTOCOL: '' }` 覆盖（空串按未设置处理）。
function runSideScript(script, args, root, envOverrides = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: {
      ...process.env,
      FLOW_COMET_PROTOCOL: path.join(root, 'reference', 'workflow-protocol.json'),
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: 120000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 树指纹：目录（含空目录）与文件内容的 sha256，按相对路径排序
function treeFingerprint(root) {
  const rows = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) { rows.push(rel + '/'); walk(full); continue; }
      rows.push(rel + ' ' + createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  };
  walk(root);
  return rows.join('\n');
}

function fingerprintChanges(before, after) {
  const beforeRows = before === '' ? [] : before.split('\n');
  const afterRows = after === '' ? [] : after.split('\n');
  const beforeSet = new Set(beforeRows);
  const afterSet = new Set(afterRows);
  return [
    ...beforeRows.filter((row) => !afterSet.has(row)).map((row) => '消失: ' + row),
    ...afterRows.filter((row) => !beforeSet.has(row)).map((row) => '新增: ' + row),
  ];
}

// 定义处计数：某名字在本脚本同级目录（引擎脚本目录）内的定义次数——单源结构锚用
// 定义面扫描（默认引擎脚本目录）。root 是可测性接缝：使「同名第二份定义 → 检出 2 处」能在合成
// 目录上被场景驱动（场景 277 的反向构造），否则该判据只能靠人工实验证明判别力。
function engineDefinitionHits(name, root = __dirname) {
  const pattern = new RegExp('(?:export\\s+)?(?:async\\s+)?function\\s+' + name + '\\b'
    + '|(?:export\\s+)?const\\s+' + name + '\\s*=', 'g');
  const hits = [];
  for (const file of fs.readdirSync(root).sort()) {
    if (!file.endsWith('.mjs')) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const count = (text.match(pattern) ?? []).length;
    if (count > 0) hits.push({ file, count });
  }
  return hits;
}

// 时间单源**消费面**判据（场景 277 使用；纯函数 + 合成输入可驱动）：每个符号必须同时满足
// 「具名 import 自 time-utils.mjs」与「真实调用」才算真实消费。旧判据只看 `name + '('` 的子串——
// 消费脚本里内联一份同名实现即可满足（判据被本地影子实现骗过），故必须查 import 来源。
function timeSingleSourceConsumerProblems(text, symbols, file = '') {
  const problems = [];
  const prefix = file === '' ? '' : file + ' ';
  for (const symbol of symbols) {
    if (!hasNamedImport(text, './time-utils.mjs', symbol)) {
      problems.push(prefix + '未从 time-utils.mjs 具名 import ' + symbol
        + '（单源纪律：不得在消费脚本内联同名第二份实现）');
    }
    if (!text.includes(symbol + '(')) {
      problems.push(prefix + '未真实消费 ' + symbol + '（单一权威应被调用）');
    }
  }
  return problems;
}

// 两层加载模型的**入口层**判据（场景 167 使用；纯函数 + 合成输入可驱动）：入口册与入口展开册
// 各须含入口层锚点句（「Skill 工具加载该节点的 Implementation 技能」）与「前置门」表述，且不得含
// Implementation/Required 混淆句式与无限定自动补表述。返回问题描述数组。
function twoLayerEntryProblems(rel, text) {
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
function skillLoadingWordingProblems(rel, text) {
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
const COMMIT_DISCIPLINE_REL = 'flow-comet/reference/commit-discipline.md';
const PLATFORM_FACTS_REL = 'flow-comet/reference/platform-facts.md';
const COMMIT_DISCIPLINE_ELEMENT_GROUPS = [
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
const COMMIT_DISCIPLINE_AUTHORITY_PHRASES = [
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
const PARALLEL_CONTRACT_BOOK_PHRASES = [
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
const PARALLEL_CONTRACT_ATTRIBUTE_NAMES = ['**写权限**', '**提交隔离**', '**验证隔离**', '**集成纪律**'];
// 证据与判级类判别句（ADR-016 ⑥：随平台事实移走）——只在 `platform-facts.md`，回流册子即红。
const CONTRACT_EVIDENCE_AUTHORITY_PHRASES = [
  '**+ 通道标记 `FLOW_COMET_AGENT_DEPTH_SOURCE`**；0 / 缺失 / 无标记 = 协调者',
  '**证实**——Codex 交互式会话的原生子代理载荷含 `agent_id`',
  '**推翻**——「Codex 载荷无身份字段」只对 `codex exec` headless 主线程成立，**不得外推**为平台结论。',
  '**未覆盖（显式标注，不得写成已支持）**',
  '> | **Claude Code** | 身份分派（载荷含 `agent_id` / `agent_type`——**证实**：真机实测子代理载荷含二者、主会话载荷不含，与 Codex 同一判据）',
  'CC 子代理载荷含 `agent_id` / `agent_type`（真机实测：子代理载荷含二者、主会话载荷不含，与 Codex 同一判据）',
  '非 `bypassPermissions` 权限模式下的载荷形态',
];
// 两册各自须持的三个条件句指针（`reference/fix-loop.md` 属修复回路段，见场景 258）。
const DELEGATION_POINTER_RELS = [
  'reference/commit-discipline.md', 'reference/platform-facts.md', 'reference/fix-loop.md',
];
function delegationDisciplineProblems({ books, elementDocs, authorityTexts }) {
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
const FRONTEND_CRITERION_AUTHORITY_REL = 'flow-comet-ui-design/SKILL.md';
const FRONTEND_CRITERION_BLOCK_SPAN = 120;
// 各引用册的指针判别句式（逐册 token 组：必须同指该唯一权威，缺一册即红）。
const FRONTEND_CRITERION_POINTER_RELS = [
  ['flow-comet/SKILL.md', ['唯一权威是 `flow-comet-ui-design` 册']],
  ['flow-comet-design/SKILL.md', ['唯一权威 → `flow-comet-ui-design` 册', '「触发与跳过」段']],
  ['flow-comet-change/SKILL.md', ['**判据与强制等级（唯一权威）**', '`flow-comet-ui-design` 册的「触发与跳过」段']],
];
function frontendCriterionAuthorityBlock(text) {
  const match = /「结构形态」的三种任一[\s\S]*?仍判前端。/.exec(text);
  return match ? match[0] : null;
}
function frontendCriterionRedirectProblems({ authorityRel, authorityText, pointerDocs, docs }) {
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
const FIX_LOOP_AUTHORITY_REL = 'flow-comet/reference/fix-loop.md';
const FIX_LOOP_SECTION_HEADING = '## 修复回路状态机路径';
const FIX_LOOP_AUTHORITY_KEYWORDS = [
  '受控归位', 'NODE: execute', '回源节点跑出口', 'entry <源节点>', 'exit <源节点> --apply', '禁止绕过',
];
const FIX_LOOP_BLOCK_SPAN = 120;
const FIX_LOOP_BOOK_ELEMENT_GROUPS = [
  ['追加 Fix 任务', ['## Fix 任务', '禁止文件尾追加']],
  ['受控归位 execute', ['受控归位', 'NODE: execute']],
  ['execute 四类出口', ['record execute', 'exit execute --apply', '任务集签名']],
  ['回源节点跑出口', ['回源节点跑出口', 'entry <源节点>', 'exit <源节点> --apply']],
  ['禁止绕过', ['禁止绕过', 'BLOCKED']],
  ['条件句指针', ['reference/fix-loop.md']],
];
// 段切片（同一区间：首个 `## 修复回路状态机路径` → 下一 `##` 或 EOF，标题不计入）。
function fixLoopStateMachineSectionOf(text) {
  const match = text.match(/(?:^|\r?\n)## 修复回路状态机路径\r?\n([\s\S]*?)(?=\r?\n## |$)/);
  return match ? match[1].replace(/\r\n/g, '\n') : null;
}
function fixLoopStateMachineProblems({ books, authority }) {
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
// `reference/**.md|json` 相对引用，逐条候选路径 = ① 引用处文件所在目录；② `<skillsRoot>/flow-comet/`
//（跨技能相对引用先例：`flow-comet-compose` 引 `../flow-comet/reference/workflow-protocol.json`）。
// `flow-kit/**` 一类**技能树外**引用不在判据面（其根随安装形态变化，由项目根决定）。
const SKILL_TREE_REFERENCE_RE = /(?<!flow-kit\/)(?<![\w./-])(?:\.\.\/flow-comet\/)?reference\/[A-Za-z0-9._-]+\.(?:md|json)/g;
function skillTreeReferenceProblems(docs, skillsRoot) {
  const problems = [];
  for (const [rel, text] of docs) {
    const dir = path.posix.dirname(rel);
    for (const ref of new Set(text.match(SKILL_TREE_REFERENCE_RE) ?? [])) {
      const tail = ref.replace(/^\.\.\/flow-comet\//, '');
      const candidates = [
        path.posix.normalize(path.posix.join(dir, ref)),
        path.posix.normalize(path.posix.join('flow-comet', tail)),
      ];
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
// 上下文满足而恒真空过（L-106），下文的反向构造即证「换成别处的展开版必红」。
const PAIRED_GUIDANCE_ENTRY_REL = 'flow-comet/SKILL.md';
const PAIRED_GUIDANCE_ENTRY_TARGET = 'reference/entry-detail.md';
const PAIRED_GUIDANCE_POINTER_RE = /<!--\s*手写区详细协议见\s*([^\s（）]+)（可选阅读）\s*-->/g;
function pairedGuidancePointerProblems(docs, skillsRoot) {
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
const IDENTITY_UPGRADE_ENTRY_PHRASES = [
  '| ① 写权限 | 载荷 `agent_id` / `agent_type`——**证实**（真机实测：子代理载荷含二者、主会话载荷不含；与 Codex 同一判据） |',
  '**三平台 `cwd` 语义对照（真机实测新增的精确事实 · 「身份先于路径」的精确理由）**',
  '| **Claude Code** | **子代理的工作目录**（`…\\.claude\\worktrees\\<agent-id>`） | **路径判定是正确的** |',
  '| **Codex** | **恒等于会话根**（子代理在 worktree 写入而 `cwd` 仍是主工程） | **路径判定必错** |',
  '| **dsh** | 载荷**无** `cwd`（桥接另读会话 header cwd） | 路径判定**不适用** |',
  '三平台 `cwd` 语义各不相同（正确 / 恒错 / 无）——只有身份判据是三平台同义的',
  '非 `bypassPermissions` 权限模式**均未覆盖**',
];
const IDENTITY_UPGRADE_AUTHORITY_PHRASES = [
  '载荷 `agent_id` / `agent_type`——**证实**（真机实测：子代理载荷含二者、主会话载荷不含；与 Codex 同一判据）',
  '**三平台 `cwd` 语义对照（真机实测新增的精确事实 · 「身份先于路径」的精确理由）**——同为载荷 `cwd`，三平台语义各不相同；下表**三行各自独立**，缺一行即口径残缺：',
  '| **Claude Code** | **子代理的工作目录**（`…\\.claude\\worktrees\\<agent-id>`） | **路径判定是正确的** |',
  '| **Codex** | **恒等于会话根**（子代理在 worktree 写入而 `cwd` 仍是主工程） | **路径判定必错** |',
  '| **dsh** | 载荷**无** `cwd`（桥接另读会话 header cwd） | 路径判定**不适用** |',
  '三平台 `cwd` 语义各不相同（正确 / 恒错 / 无）——只有身份判据是三平台同义的',
];
const IDENTITY_UPGRADE_STALE_PHRASES = ['该次实测只覆盖 Codex', '真机会话复核待补', 'CC 隔离树的真实落点探针待补'];
function identityUpgradeProblems({ entry, facts, others }) {
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
const PLATFORM_FACTS_ONLY_PHRASES = [
  '**旧结论（实测 2026-08-13；证据已不可复核',
  '`codex features list` 可查',
  '本机真实交互式会话日志中记录到 `spawn_agent` / `wait_agent` / `close_agent` 的实际调用',
  '**静态喂测（独立复现）**',
  '**hook 触发条件**：隔离 `CODEX_HOME` 无持久信任时默认 headless **不执行**项目 hook',
  '实测 3/21；补 `--dangerously-bypass-approvals-and-sandbox` 后 5/5',
  '**交互式 Codex 实测口径',
];
function platformFactsAuthorityProblems(rel, facts, pointerBooks) {
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
//   · 正文唯一（块级跨距）：声明的**展开副本**（连续同文 ≥ `TEMPLATE_AUTHORITY_BLOCK_SPAN` 字符，
//     取旧逐字锁的切片粒度 400）不得出现第二份。**粒度说明**（`LESSONS` 候选取证）：短锚句是
//     ADR-015 B 类子规则 2 允许的「要点 / 指针」形态（各册按语境表述），公式化短片段天然重合 ⇒
//     按 T-03 实测建议取块级跨距而非短子串查重，避免必然假红；展开成正文段落后被复制即红。
const TEMPLATE_AUTHORITY_SKILLS = [
  'flow-comet-open', 'flow-comet-design', 'flow-comet-plan', 'flow-comet-execute',
  'flow-comet-subagent-execute', 'flow-comet-review', 'flow-comet-verify', 'flow-comet-archive',
  'flow-comet-task',
  'flow-comet-change', 'flow-comet-requirement', 'flow-comet-dev', 'flow-comet-test',
  'flow-comet-integration',
];
const TEMPLATE_AUTHORITY_ANCHORS = [
  '唯一权威 = ', '`flow-kit/templates/**`', '是历史证据', '不是模板来源', '上一轮就是这么写的',
];
// 整句形态**专有**的展开锚点（短指针形态不含）：出现任一条即要求整句按序齐备（半句 / 拆句防护）。
const TEMPLATE_AUTHORITY_EXPANSION_ANCHORS = [
  '唯一权威 = ', '是历史证据', '不是模板来源', '上一轮就是这么写的',
];
const TEMPLATE_AUTHORITY_BLOCK_SPAN = 400;
// 「模板权威」声明的**段落切片**：锚行所在的那一段连续引用行（`>` 块）——展开副本的判据面。
function templateAuthorityParagraphs(text) {
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
// 最长连续同文跨距（返回该片段本身；空串 = 无重合）。
function longestCommonSpan(a, b) {
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
function templateAuthorityProblems(docs) {
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
    for (const paragraph of templateAuthorityParagraphs(text)) paragraphs.push([rel, paragraph]);
  }
  for (let i = 0; i < paragraphs.length; i += 1) {
    for (let j = i + 1; j < paragraphs.length; j += 1) {
      if (paragraphs[i][0] === paragraphs[j][0]) continue;
      const span = longestCommonSpan(paragraphs[i][1], paragraphs[j][1]);
      if (span.length >= TEMPLATE_AUTHORITY_BLOCK_SPAN) {
        problems.push('模板权威声明出现第二份展开正文（' + paragraphs[i][0] + ' ↔ ' + paragraphs[j][0]
          + '，连续同文 ' + span.length + ' 字符 ≥ ' + TEMPLATE_AUTHORITY_BLOCK_SPAN + '）');
      }
    }
  }
  return problems;
}

// ——— 7 字段集合的文本 ↔ 实现一致锚（场景 184 使用） ———
// 唯一权威 = `workflow-guard.mjs` 的 `TASK7_REQUIRED` 常量（plan 出口判据的集合来源）。锚**从常量派生**
// 集合后再与技能树文本逐处对账：任一处枚举与判据分叉即红——「两册三处而两级基线全绿」的成因正是
// 「同一口径另写一份、且没有断言绑定」（`LESSONS` L-067）；锚里**不得把集合再抄一遍**（抄一遍就是
// 又造一处同口径表达）。
const TASK7_AUTHORITY_CONSTANT = 'TASK7_REQUIRED';
// 「7 字段」标记（中文 / 英文两形态）：标记与枚举**同行**是当前唯一形态；标记行不带枚举（指针形态，
// 如「集合见上表」）不算缺席——判据只对「标记 + 枚举」同场的行发声。
const TASK7_MARKER_RE = /7\s*个?\s*字段|7 required fields|7-field set/;
// 斜杠枚举形态（`` `name` / `read_files` / … ``；同时覆盖无引号的裸形态）。
const TASK7_RUN_RE = /(?:`?[a-z][a-z_]*`?[ \t]*\/[ \t]*)+`?[a-z][a-z_]*`?/g;
// **已知站点基线**（每站 = 该枚举行上独有的判别句式，即站点的身份）：锚**逐站点**断言「该站点仍持与派生
// 集合一致的枚举」——任一处丢失（改成指针 / 删掉该行 / 抽掉枚举）即红；**新增站点不受限**（自动进入逐处
// 对账，不因新增而红）。身份**不用 `file:line`**：行号随无关编辑漂移，会把「无关改动」误判成「站点丢失」
// （同族自锁——报错方向指向锚而非真实原因）。**站点集合是处数的唯一事实源**（无独立处数常量）。
const TASK7_KNOWN_SITES = [
  { rel: 'flow-comet-plan/SKILL.md', anchor: '| TASK.md | 至少一个' },
  { rel: 'flow-comet-plan/SKILL.md', anchor: 'Populate 7 required fields per task' },
  { rel: 'flow-comet-plan/SKILL.md', anchor: 'the 7-field set' },
  { rel: 'flow-comet-task/SKILL.md', anchor: '**每任务 7 字段**' },
];
// 探针期望哨兵：该探针要求**零问题**（合法新增站点不得被判违规）——与「必报某问题」的期望区分。
const TASK7_ZERO_PROBLEMS = '（该探针要求零问题）';

// 从实现侧常量**派生** 7 字段集合（null = 权威常量缺席 ⇒ 由调用方报红，锚里不写第二份集合）。
function task7RequiredSet(guardSrc) {
  const match = guardSrc.match(new RegExp('const\\s+' + TASK7_AUTHORITY_CONSTANT + '\\s*=\\s*\\[([^\\]]*)\\]'));
  if (!match) return null;
  const fields = match[1].split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter((part) => part !== '');
  return fields.length > 0 ? fields : null;
}

// 值恰好等于权威集合的常量名（断言 BLOCKED 文案**从常量派生**用——文案里再写字面集合即第二处同口径表达）。
function task7ConstantNames(src, fieldSet) {
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

// 单行「标记同行枚举」提取（逐处对账与站点断言共用同一实现）：返回 { raw, tokens } 列表。
function task7LineEnumerationTokens(fieldSet, line) {
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
function task7EnumerationRuns(fieldSet, docs) {
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
function task7KnownSiteRuns(fieldSet, docs) {
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
function task7EnumerationProblems(fieldSet, docs) {
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

// 判据：「文案落后于判据」静默面——两处 BLOCKED 文案的集合字符串必须从判据常量派生（文案区域须出现
// 「值等于权威集合的常量」的 .join('/')，且不得再现该集合的字面拼接）。构造方式变了、渲染结果不变。
function task7MessageDerivationProblems(fieldSet, sources) {
  const out = [];
  const joined = fieldSet.join('/');
  for (const [rel, src] of Object.entries(sources)) {
    const at = src.indexOf('任务缺 7 字段（');
    if (at < 0) {
      out.push(rel + ' 未找到「任务缺 7 字段」文案锚点（文案派生判据无从对账）');
      continue;
    }
    const region = src.slice(at, at + 240);
    const constants = task7ConstantNames(src, fieldSet);
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

// 7 字段集合锚的聚合判据（真实判据 + 反向构造探针；场景 184 调用，返回问题描述数组）。
function task7SetAnchorProblems({ guardSrc, stateSrc, docs }) {
  const out = [];
  const fieldSet = task7RequiredSet(guardSrc);
  if (fieldSet === null || fieldSet.length !== 7) {
    out.push('workflow-guard.mjs 的 ' + TASK7_AUTHORITY_CONSTANT
      + ' 常量缺席或元素数 ≠ 7（7 字段集合的唯一权威不在场，文本侧无从对账）');
    return out;
  }
  const sources = { 'workflow-guard.mjs': guardSrc, 'workflow-state.mjs': stateSrc };
  out.push(...task7EnumerationProblems(fieldSet, docs));
  out.push(...task7MessageDerivationProblems(fieldSet, sources));
  out.push(...task7ReverseConstructionProblems(fieldSet, docs, sources));
  return out;
}

// 反向构造（`LESSONS` L-106：判别句式 + 反向构造；与真实判据同一实现驱动）：逐项把锚的输入改坏 ⇒ 必红；
// 另含**判别力方向**探针——合法新增站点必须**零问题**（防「全局计数地板」式自锁：以总量取红的探针会让
// 「新增一处」与「丢失一处」对冲，且把报错方向指向探针而非真实原因）。
function task7ReverseConstructionProblems(fieldSet, docs, sources) {
  const out = [];
  const replaceRunLine = (targetDocs, run, mutate) => new Map(targetDocs).set(run.rel,
    (targetDocs.get(run.rel) ?? '').split(/\r?\n/)
      .map((line, index) => (index === run.line - 1 ? mutate(line) : line)).join('\n'));
  const dropRunLine = (targetDocs, run) => new Map(targetDocs).set(run.rel,
    (targetDocs.get(run.rel) ?? '').split(/\r?\n/)
      .filter((line, index) => index !== run.line - 1).join('\n'));
  const appendSite = (targetDocs, rel, fields) => new Map(targetDocs).set(rel,
    (targetDocs.get(rel) ?? '') + '\n（反向构造：新增站点）7 字段：' + fields.join(' / ') + '\n');
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
    // 文案派生面（⑧）：构造方式回退 / 派生被抽掉 ⇒ 必红
    ['文案回写字面集合',
      () => task7MessageDerivationProblems(fieldSet, { ...sources,
        'workflow-guard.mjs': sources['workflow-guard.mjs'].replace(
          TASK7_AUTHORITY_CONSTANT + ".join('/')", "'" + fieldSet.join('/') + "'") }), '又写了一遍字面集合'],
    ['文案抽掉派生',
      () => task7MessageDerivationProblems(fieldSet, { ...sources,
        'workflow-state.mjs': sources['workflow-state.mjs'].replace("replanTask7Required.join('/')", "'7 字段'") }),
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
const FRONTEND_CRITERION_STRUCTURE_GROUPS = [
  ['独立行', '独占一行'],
  ['行首'],
  ['字段值位'],
  ['词形边界'],
  ['命中片段', '回显'],
];
// 旧口径的**显式措辞**（逐条对应改前的真实句子，收窄到这些形态以免误伤新口径的正常行文）。
const FRONTEND_CRITERION_STALE_PROSE_RES = [
  /段内\s*\*{0,2}(?:不含|不包含|未含|不得含|不得出现)\*{0,2}\s*(?:字面\s*)?「?不适用」?/,
  /段内\s*\*{0,2}(?:标注|标记)\*{0,2}\s*「?不适用」?\s*(?:两个)?字面/,
  /未标注\s*「不适用」/,
  /不含\s*字面\s*「不适用」/,
];
function frontendCriterionProseProblems(label, text) {
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
const TIME_DISCIPLINE_RULES = [
  ['规则① 时间戳一律本地时间 + 显式偏移', ['本地时间 + 显式偏移']],
  ['规则② 比较一律 Date.parse 差值', ['Date.parse']],
  ['规则③ 判活 / 判时以 mtime 或 git 时间为准、date 不作基准', ['mtime', 'git 时间', '不作基准']],
  ['规则④ 纪律已写入验证阶梯', ['验证阶梯']],
];
function timeDisciplineTextProblems(label, text) {
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
function crlfLineViolations(text) {
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
function evolveReportBulletProblems(reportText) {
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
function deterministicReproProblems(reportText) {
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
const OVERRIDE_CLAUSE_ITEM_MARKS = /[①②③④⑤⑥⑦⑧⑨⑩]/g;
// 兜底语 = **冲突优先**声明（「以本节为准」式）：判据不认任何 `以…为准`——`以安装平台为准`
// 一类是无关行文，`冲突以 state 为准` 一类是局部字段优先级，都会被它冒充满足。
const OVERRIDE_FALLBACK_RE = /以(?:本节|本册|本文)[^\n。]{0,20}为准|冲突[^\n。]{1,60}为准/;
// 声明块 = 「只读基准」所在行起，向后吞掉「空行 / 粗体栏名开头的段落 / 兜底语所在行」，直到首个
// 既非空行、也不以 `**` 开头、也不含兜底语的行为止——四要素都必须落在**块内**。没有块边界，
// 判据会被文件里别处的 `以…为准` / 局部优先级条款冒充满足（「锚偏弱」的另一种形态）。
function overrideDeclarationBlock(text) {
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
function labeledClauseItemCount(text, label) {
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
function overrideDeclarationProblems(label, text, { pointer = false } = {}) {
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
function upstreamArtifactPaths(text) {
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

// 具名 import 断言（容忍多行 / 符号重排 / 其它符号共存）：source 为模块说明符（`./state-schema.mjs`）。
// 与场景 154 的内联写法同判据，本处提为复用工具（原子写与元数据常量两处消费面都要断言）。
function hasNamedImport(text, source, name) {
  const pattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(String(text))) !== null) {
    if (match[2] !== source) continue;
    const names = match[1].split(',').map((piece) => piece.trim().split(/\s+as\s+/).pop());
    if (names.includes(name)) return true;
  }
  return false;
}

// 原子写惯用法指纹（两条件同现于一个文件）：`+ '.tmp'` 拼接 + `fs.rename(` 落位——即「同目录固定
// 临时名 + rename」的写法。**收敛面 = 任务写边界内的写盘脚本**（状态/侧命令的state 与文档落盘），
// 由调用方显式传入清单：`workflow-guard.mjs` 的受保护写入是**独立的安全硬化通道**（临时名含 pid +
// 随机段、写后 fsync 与快照复核、保护目录校验），不属于本惯用法，且不在本任务写边界内——它的
// 排除在场景里另有**边界锚**看守（形态一旦退回本惯用法即变红），不是静默跳过。
// root 是可测性接缝（默认引擎脚本目录）：使「第二份实现 → 检出 2 处」能在合成目录上被场景驱动，
// 否则该判据只能靠人工实验证明判别力、回归时可能被改成恒真空过（场景 291 反向构造）。
// 套件自身不是引擎写盘面（夹具文本会携带惯用法样例），排除在扫描外。
const ATOMIC_TEMP_SUFFIX_RE = /\+\s*'\.tmp'/g;
const ENGINE_IDIOM_SCAN_EXCLUDE = new Set(['guard-self-test.mjs', 'system-test.mjs']);
function atomicWriteIdiomHits(root = __dirname, files = null) {
  const candidates = files ?? fs.readdirSync(root).sort()
    .filter((file) => file.endsWith('.mjs') && !ENGINE_IDIOM_SCAN_EXCLUDE.has(file));
  const hits = [];
  for (const file of candidates) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const count = (text.match(ATOMIC_TEMP_SUFFIX_RE) ?? []).length;
    if (count > 0 && text.includes('fs.rename(')) hits.push({ file, count });
  }
  return hits;
}
// 原子写收敛面（本任务写边界内的写盘脚本 + 单源模块）：全引擎只应有 state-schema.mjs 一处实现。
const ATOMIC_WRITE_CONVERGENCE_FACE = [
  'state-schema.mjs', 'workflow-state.mjs', 'workflow-handoff.mjs', 'evolve.mjs', 'context-scan.mjs',
];

// 日期前缀判据的**表达式形态**扫描（与原子写惯用法同型）：报告 / 工件名的「日期前缀」判定只许由
// time-utils.mjs 表达一处——本判据认的形态是「日期三分量以**字面连字符**相接」的前缀写法
// （`/^(\d{4}-\d{2}-\d{2})/` 一类），在其它脚本内联第二份即为单源违规（注释互指同源不作数，
// 判据只认形态）。时刻形态 `\d{4})-(\d{2})-(\d{2})T…`（`TIMESTAMP_SHAPE`）是另一个判据面，同样
// 落在 time-utils 一处，不在本形态内。**收敛面 = 本任务写边界内的日期前缀消费方 + 单源模块**：
// `workflow-guard.mjs` 的两处日期匹配是**文档内容**里的日期条目匹配（行锚 + `matchAll(.../gm)`），
// 不是文件名前缀判定，且不在本任务写边界内——该排除在场景里另有**边界锚**看守（形态一旦不再是
// 内容条目匹配即变红），不是静默跳过。root 是可测性接缝（默认引擎脚本目录）：使「第二份实现 →
// 检出 2 处」能在合成目录上被场景驱动，否则该判据只能靠人工实验证明判别力、回归时可能被改成
// 恒真空过（场景 295 反向构造）。
const DATE_PREFIX_LITERAL_RE = /\\d\{4\}-\\d\{2\}-\\d\{2\}/g;
const DATE_PREFIX_CONVERGENCE_FACE = ['time-utils.mjs', 'health.mjs', 'context-scan.mjs'];
function datePrefixRegexpHits(root = __dirname, files = null) {
  const candidates = files ?? fs.readdirSync(root).sort().filter((file) => file.endsWith('.mjs'));
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
const BACKUP_NAME_LITERAL = "'.bak-'";
const BACKUP_IMPL_FACE = ['state-schema.mjs', 'evolve.mjs', 'context-scan.mjs'];
function inlineBackupHits(root = __dirname, files = null) {
  const candidates = files ?? fs.readdirSync(root).sort().filter((file) => file.endsWith('.mjs'));
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
const BARE_ISO_TIMESTAMP_RE = /new Date\(\)\.toISOString\(\)/g;
const BARE_ISO_SIDE_COMMANDS = ['health.mjs', 'evolve.mjs', 'context-scan.mjs'];
const BARE_ISO_ENGINE_WHITELIST = [
  {
    file: 'workflow-state.mjs',
    count: 7,
    reason: 'state 的机器字段时间戳（createdAt / 事件 at / 授权与覆盖时刻）：Z 形已随既有 state 与事件流持久化，迁移须同批处理历史值的解析与比较，留专门窗口（登记 KNOWN-ISSUES）；扫描时刻（last_intel_scan）已迁出本条——写入走 time-utils 的 nowTimestamp（场景 308 的形态锚 + 277 的单源消费面看守）',
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
  {
    file: 'system-test.mjs',
    count: 1,
    reason: 'L2 套件夹具构造的 round 覆盖时刻（测试载体，非人可见面）：随 state 时间形态迁移批次一并改',
  },
];
// intel-scan 元数据「段名 / 字段名」字面量的跨文件一致判据（纯函数 + 合成输入可驱动）：双落点判据在
// init 侧按「段名 + 字段名」定位段内取值，段行的写通道在 context-scan 侧——同一条命名决定落在两处
// 声明里（单一来源收口须改到测试面之外的脚本，见场景 309 的登记）。字面量若各自漂移，init 侧会
// **静默**退化成「段不在场」（零提示）——静默面正是该机制要消灭的形态，故此处让「两处声明逐字相等」
// 可机检。返回问题描述数组（空数组 = 一致）。
const INTEL_NAME_DECL_RE = /const\s+(INTEL_SECTION(?:_NAME)?|INTEL_FIELD(?:_NAME)?)\s*=\s*'([^']+)'/g;
function intelMetadataNameDeclarations(text) {
  const out = {};
  for (const match of String(text).matchAll(INTEL_NAME_DECL_RE)) {
    out[match[1].startsWith('INTEL_SECTION') ? 'section' : 'field'] = match[2];
  }
  return out;
}
function intelMetadataNameProblems(consumerText, producerText) {
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
function stripLineComments(text) {
  return text.split('\n').map((line) => {
    const at = line.indexOf('//');
    return at === -1 ? line : line.slice(0, at);
  }).join('\n');
}
function bareIsoTimestampHits(root = __dirname, files = null) {
  const candidates = files ?? fs.readdirSync(root).sort().filter((file) => file.endsWith('.mjs'));
  const hits = [];
  for (const file of candidates) {
    const text = stripLineComments(fs.readFileSync(path.join(root, file), 'utf8'));
    const count = (text.match(BARE_ISO_TIMESTAMP_RE) ?? []).length;
    if (count > 0) hits.push({ file, count });
  }
  return hits;
}
// 白名单判定（纯函数，合成输入可驱动）：条数漂移（增 / 减）与未登记文件各自必报。
function bareIsoWhitelistProblems(hits, whitelist) {
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

// health 报告夹具：报告名的日期前缀与读数快照都是**构造出来的输入面**——快照哨兵值只在被采作
// 基线时才出现在新报告里（哨兵 → `999999 → …`），据此可判「当前基线到底是哪一份」，不必解析
// 报告结构。哨兵键取全小写键（快照行的键形态判据只认小写字母与 `.` / `_`），与既有 `context.exists`
// 一类保持一致。
function healthReportFixture(date, sentinelEntries) {
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
function healthReportWithSnapshot(date, snapshotSectionText) {
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
function snapshotSectionOf(reportText) {
  const start = reportText.indexOf('## 读数快照');
  if (start === -1) return null;
  const rest = reportText.slice(start);
  const end = rest.indexOf('\n## ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}
// 快照段内的读数条数（`key=value` 行，排除围栏与空行）——往返判据的「应读到条数」由生产面原文派生
function snapshotEntryCount(sectionText) {
  return sectionText.split('\n').filter((line) => /^[^`\s][^=]*=/.test(line)).length;
}

// CONTEXT.md 夹具（七段骨架 + 可选 evolve 段）——夹具不装 flow-kit 模板时 validateContext
// 取内置基准段名；`intel-scan 元数据` / `evolve 元数据` 字段行与模板同形。
// 与 system-test.mjs 的同名夹具**同形镜像**（两份载体刻意独立、不互相 import：夹具若从被测模块
// 派生，锚点会退化成同义反复）——改段名 / 字段名时必须两份同改（与词表镜像同纪律）。
const CONTEXT_BASE_SECTION_NAMES = ['项目概要', '技术栈', '域语言', '已锁决策', '默认偏好', '既有抽象索引'];
// 段侧扫描时刻的取值与行尾说明：**真实生成件形态**（`--init-context` 的 CONTEXT 生成物 = 取值词元 +
// 行尾说明；写侧 `context-scan` 只替换首个取值词元、说明原样保留）。夹具取这一形态——裸取值词元
// 夹具下「读侧取整行剩余文本」的口径缺陷在两级基线下都不可见（见场景 308 的单变量对照）。
const INTEL_FIELD_VALUE = '2026-09-01T10:00:00+08:00';
const INTEL_FIELD_SUFFIX = ' （首次接入生成时留占位；由 `init --init-context` 或 `context-scan` 记录扫描时间）';
const INTEL_METADATA_FIELD_LINES = [
  '- **last_intel_scan**: ' + INTEL_FIELD_VALUE + INTEL_FIELD_SUFFIX,
  '- **scanner**: `flow-comet`',
  '- **下次重扫建议**: 3 个月后',
];
const EVOLVE_METADATA_FIELD_LINES = [
  '- **last_evolve_at**: `2026-09-01T10:00:00+08:00`',
  '- **scanner**: `flow-comet-evolve`',
  '- **下次建议**: 约 60 天后，或新增 ≥ 5 个带 §9 内容的 change 之后',
];

function contextFixtureText({ evolveSection = null, intelSection = true, tail = '' } = {}) {
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
function intelFieldToken(value) {
  return String(value).trim().split(/\s+/)[0].replace(/^`+/, '').replace(/`+$/, '');
}

// design 出口 ui-design 门夹具：CHANGE.md 的「视觉调性」段是结构级前端判据的输入面
const VISUAL_TONE_APPLICABLE = '## 视觉调性（Visual Tone）\n\n现代、克制的工具型界面。\n';
const VISUAL_TONE_NOT_APPLICABLE = '## 视觉调性（Visual Tone）\n\n不适用（非前端项目）。\n';
// 负向标记的另外几种形态（判据不接受裸子串，只接受结构形态）：
// 行首形态（标记 + 破折号理由，非独立行）
const VISUAL_TONE_LINE_HEAD_MARKER = '## 视觉调性（Visual Tone）\n\n不适用 —— CLI 工具，无用户可见界面。\n';
// 字段值位（`- 适用性：不适用`）
const VISUAL_TONE_FIELD_MARKER = '## 视觉调性（Visual Tone）\n\n- 适用性：不适用（CLI 工具，无用户可见界面）\n';
// 子维度字段（标签不是适用性标签）——结构形态在场，但主体是暗色主题，不得关掉整道门
const VISUAL_TONE_SUBDIMENSION_FIELD = '## 视觉调性（Visual Tone）\n\n- 选定：克制工具型\n- 暗色主题：不适用\n';
// 自然句子（标记词出现在行首与句内，但都不成结构形态）——不得据它把前端 change 改判非前端
const VISUAL_TONE_NATURAL_SENTENCE = '## 视觉调性（Visual Tone）\n\n不适用于暗色主题，本 change 仅覆盖浅色分支。\n';

// ui-design 门键控夹具：以内置协议副本（runGuardWithProtocol 指向的同一路径）为基准改写 design
// 节点的 flow-comet-ui-design 绑定——'guarded'（默认形态，写回）/ 'advisory'（等级降级）/
// 'absent'（删掉绑定）。协议副本是「门是否在场」的唯一输入面。
function writeUiDesignBindingVariant(dir, variant) {
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

function writeDesignExitFixture(dir, {
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
// 判据含**内建反向构造**（L-064）：把守卫副本的补丁解析停用（解析器入口早退）后，同一组
// 载荷里预期拦截的用例必须**全部**翻成放行——证明本锚断言的不是恒真形态。副本落在场景临时
// 目录（只复制守卫与其三个同包依赖），不触碰权威源文件（零写入、零临时改名）。
// 保护集第二目标按**本次运行实际生效的协议文件**取值（FLOW_COMET_PROTOCOL 的解析结果），
// 不是「任意名为 workflow-protocol.json 的文件」——同名异路径用例（allow）即该边界的判别锚。
function applyPatchPayloadMatrix() {
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
function runApplyPatchPayload(dir, hookPath, payload) {
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
function applyPatchVerdictProblems(dir, hookPath, payloads) {
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

// 耐久锚主体：真实矩阵 + 内建反向构造（L-064）。
function applyPatchAnchorProblems(dir) {
  const payloads = applyPatchPayloadMatrix();
  const problems = applyPatchVerdictProblems(dir, HOOK, payloads);
  // 内建反向构造（L-064）：停用补丁解析 ⇒ 依赖该解析的拦截用例必须全部变红（此处判红）。
  const probeDir = path.join(dir, 'probe-scripts');
  fs.mkdirSync(probeDir, { recursive: true });
  for (const rel of ['comet-hook-guard.mjs', 'protocol-utils.mjs', 'state-schema.mjs', 'time-utils.mjs']) {
    fs.copyFileSync(path.join(__dirname, rel), path.join(probeDir, rel));
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
function globEquivalenceProblems(dir) {
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

// ---------- 场景表 ----------

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
  // in-place 扩展（验证隔离三态 + 派遣留痕）：① 全部收工 ⇒ 放行（原断言）；② 有 request 无对应
  // result（写者未收工的既有可判形态）⇒ 新 change BLOCKED + 恢复指引 / 旧 change 渐进 WARN；
  // ③ 无该证据对象 ⇒ 零输出（不制造噪音）；④ 派遣留痕落在既有嵌套字段（零新增 state 顶层字段）
  // 的静态锚。反向构造：把出口校验的判据从「有 request 无 result」放宽成恒空 ⇒ ② 必红。
  {
    name: '15 subagent-execute exit 三态（在飞委托 BLOCK·全部收工放行·无证据零输出）+ 留痕嵌套锚',
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
      assertNotOut(res, '在飞委托');

      // ①b 并行 × 零提交通过出口（AC-9）：parallel done 任务的留痕为「request 记 noCommit:true +
      //     result 回传无 commitHash 的零提交契约」⇒ 出口按该资格豁免缺 commitHash，不因并行维度
      //     而拦。判别力内建对照：同一并行任务去掉 request 的 noCommit 资格 ⇒ 必按缺 commitHash
      //     拦截——证明豁免由资格驱动，不是并行维度的恒真形态。
      const zeroParallelTask = '<task id="P01" status="done" parallel="true"><action>并行零提交</action>'
        + '<write_files>.specs/' + CHANGE_ID + '/P01-SUMMARY.md</write_files><verify>echo ok</verify></task>\n';
      const zeroParallelResult = (taskId) => ({
        result: {
          status: 'DONE', taskId, noCommit: true,
          completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
          redEvidence: { command: 'echo ok' },
          greenEvidence: { command: 'echo ok', output: 'ok' },
        },
      });
      const zeroParallel = { ...baseState('subagent-execute') };
      zeroParallel.evidence['subagent-execute'] = {
        summary: 'parallel zero-commit task collected',
        handoffRequests: { P01: { writeFiles: ['.specs/' + CHANGE_ID + '/P01-SUMMARY.md'], noCommit: true } },
        handoffResult: { P01: zeroParallelResult('P01') },
      };
      writeState(dir, zeroParallel);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + zeroParallelTask);
      const zeroParallelExit = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(zeroParallelExit, 0);
      assertNotOut(zeroParallelExit, '缺 commitHash');
      const unqualifiedParallel = JSON.parse(JSON.stringify(zeroParallel));
      delete unqualifiedParallel.evidence['subagent-execute'].handoffRequests.P01.noCommit;
      writeState(dir, unqualifiedParallel);
      const unqualifiedExit = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(unqualifiedExit, 1);
      assertOut(unqualifiedExit, '缺 commitHash');

      // ② 在飞委托（有 request 无对应 result）⇒ 新 change BLOCKED，报文点名未收工任务并给恢复指引
      const inFlight = { ...baseState('subagent-execute'), newChange: true };
      inFlight.enteredNodes = ['subagent-execute'];
      inFlight.evidence['subagent-execute'] = {
        summary: 'delegated, one writer still running',
        handoffRequests: {
          P01: { writeFiles: ['src/p1.mjs'] },
          P03: { writeFiles: ['src/p3.mjs'] },
        },
        handoffResult: handoffFor(['P01']),
      };
      writeState(dir, inFlight);
      const blocked = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, '在飞委托');
      assertOut(blocked, '待写入者收工后重跑');
      assertOut(blocked, 'P03');
      assertNotOut(blocked, 'P01（');
      // ②b 旧 change 同形态 ⇒ 渐进 WARN 不阻断（向后兼容硬约束），指引仍在
      const inFlightOld = { ...inFlight };
      delete inFlightOld.newChange;
      writeState(dir, inFlightOld);
      const warned = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(warned, 0);
      assertOut(warned, 'WARN');
      assertOut(warned, '在飞委托');
      assertOut(warned, '待写入者收工后重跑');
      // ③ 无该证据对象（从未进入委托节点）⇒ 零输出：判据不得在无证据形态下制造噪音
      const noEvidence = { ...baseState('subagent-execute') };
      noEvidence.evidence = {};
      writeState(dir, noEvidence);
      const silent = runGuard(['exit', 'subagent-execute'], dir);
      assertNotOut(silent, '在飞委托');
      assertNotOut(silent, '待写入者收工后重跑');

      // ②c 撤回通道（在飞委托族的 in-place 扩展）：被遗弃的 request 可经受支持接口撤回——撤回在
      //     **原记录**上加法式落留痕（withdrawnAt 时间戳 + withdrawnBy 来源），守卫按同一判据把已撤回
      //     的 request 移出在飞集合 ⇒ 出口放行；记录本身不删除（历史留痕），重新委托时撤回落痕转入
      //     previousWithdrawals 而非被静默丢弃。已撤回 = **终态**：重复撤回被拒、撤回后 result 被拒。
      //     判据要求留痕**两字段齐备**才成立（只写时间戳的手改形态仍按在飞处理——fail-closed）。
      //     反向构造：守卫不忽略已撤回的 request ⇒ ②c-3 必红；判据只看单一字段 ⇒ ②c-6 必红。
      const withdrawRequests = () => ({
        P01: { writeFiles: ['src/p1.mjs'] },
        P02: { writeFiles: ['src/p2.mjs'], requestedAt: '2026-10-07T00:00:00.000Z' },
      });
      const withdrawCase = { ...baseState('subagent-execute'), newChange: true };
      withdrawCase.enteredNodes = ['subagent-execute'];
      withdrawCase.evidence['subagent-execute'] = {
        summary: 'delegated, one request abandoned',
        handoffRequests: withdrawRequests(),
        handoffResult: handoffFor(['P01']),
      };
      writeState(dir, withdrawCase);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + TASK_P2);
      // 严格形态（newChange:true）下 done 任务须有对应 SUMMARY——补两份，使「撤回 ⇒ 出口放行」
      // 的断言落在**唯一**阻塞点（在飞委托）上，而不是被无关门禁干扰。
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', strictSummary('P01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P02-SUMMARY.md', strictSummary('P02'));
      // ②c-0 撤回前：P02 在飞 ⇒ 出口拦（撤回通道的必要性前提 + 恢复指引点名该命令）
      const beforeWithdraw = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(beforeWithdraw, 1);
      assertOut(beforeWithdraw, 'P02');
      assertOut(beforeWithdraw, 'workflow-handoff.mjs withdraw');
      // ②c-0b 前置拒绝（适用面自洽）：P01 已收工（handoffResult 在场）⇒ 撤回被拒（非零退出 + 报文
      //       写清为何拒 + 恢复指引），且 state 字节零改写（不落留痕、不动既有 request / result——
      //       撤回的适用面是「在飞且被遗弃的 request」，与动作自述一致）。
      //       反向构造：把该前置拒绝去掉 ⇒「撤回已收工的委托」又变 exit 0，本格必红。
      const bytesBeforeCompletedWithdraw = readStateBytes(dir);
      const completedWithdraw = runHandoff(['withdraw', 'P01', '--by', 'user'], dir);
      assertExit(completedWithdraw, 1);
      assertOut(completedWithdraw, '已收工');
      assertOut(completedWithdraw, 'handoffResult 在场');
      assertOut(completedWithdraw, '撤回只适用于被遗弃的 request');
      assertOut(completedWithdraw, '恢复:');
      assertNotOut(completedWithdraw, 'HANDOFF WITHDRAW');
      assertStateBytesUnchanged(dir, bytesBeforeCompletedWithdraw, '撤回已收工的委托被拒');
      // ②c-1 真实 CLI 撤回：缺 --by 先被拒（留痕来源不可缺省）⇒ 补齐后撤回成功
      const noBy = runHandoff(['withdraw', 'P02'], dir);
      assertExit(noBy, 1);
      assertOut(noBy, '--by');
      const withdrawn = runHandoff(['withdraw', 'P02', '--by', 'coordinator', '--reason', '零提交复验失败后作废'], dir);
      assertExit(withdrawn, 0);
      assertOut(withdrawn, 'HANDOFF WITHDRAW: P02');
      assertOut(withdrawn, 'withdrawnAt=');
      // ②c-2 留痕在场且历史不删：撤回两字段齐备，原 request 字段（writeFiles / requestedAt）原样保留
      const stWithdrawn = JSON.parse(readStateBytes(dir));
      const p02Withdrawn = stWithdrawn.evidence['subagent-execute'].handoffRequests.P02;
      if (typeof p02Withdrawn.withdrawnAt !== 'string' || p02Withdrawn.withdrawnAt.trim() === '') {
        throw new Error('撤回应落 withdrawnAt 时间戳: ' + JSON.stringify(p02Withdrawn));
      }
      // 时间纪律：新写入路径走 time-utils 单一权威 ⇒ 标准形态为本地时间 + 显式偏移；裸 Z 形态
      // （自行拼接的产物）在此必红，且 298 的白名单代数会同时漂移（两条判据互相印证）。
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(p02Withdrawn.withdrawnAt)) {
        throw new Error('withdrawnAt 应为标准形态（本地时间 + 显式偏移，走 time-utils 的 nowTimestamp）: '
          + JSON.stringify(p02Withdrawn.withdrawnAt));
      }
      if (Number.isNaN(timeUtilsModule.parseTimestamp(p02Withdrawn.withdrawnAt))) {
        throw new Error('withdrawnAt 应可被时间单一权威解析: ' + JSON.stringify(p02Withdrawn.withdrawnAt));
      }
      if (p02Withdrawn.withdrawnBy !== 'coordinator') {
        throw new Error('撤回应落 withdrawnBy 来源: ' + JSON.stringify(p02Withdrawn));
      }
      if (p02Withdrawn.withdrawReason !== '零提交复验失败后作废') {
        throw new Error('撤回原因应留痕: ' + JSON.stringify(p02Withdrawn));
      }
      if (!Array.isArray(p02Withdrawn.writeFiles) || p02Withdrawn.writeFiles[0] !== 'src/p2.mjs'
        || p02Withdrawn.requestedAt !== '2026-10-07T00:00:00.000Z') {
        throw new Error('撤回不得删除原 request 字段（writeFiles / requestedAt 应原样保留）: ' + JSON.stringify(p02Withdrawn));
      }
      // ②c-3 撤回后 ⇒ 出口放行（守卫忽略已撤回的 request；同一出口、同一 state 其余字段不变）
      const afterWithdraw = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(afterWithdraw, 0);
      assertOut(afterWithdraw, 'ALL CHECKS PASSED');
      assertNotOut(afterWithdraw, '在飞委托');
      // ②c-4 终态之一：重复撤回被拒，且不改写既有留痕
      const withdrawAgain = runHandoff(['withdraw', 'P02', '--by', 'coordinator'], dir);
      assertExit(withdrawAgain, 1);
      assertOut(withdrawAgain, '终态');
      const stAfterAgain = JSON.parse(readStateBytes(dir));
      if (stAfterAgain.evidence['subagent-execute'].handoffRequests.P02.withdrawnAt !== p02Withdrawn.withdrawnAt) {
        throw new Error('重复撤回不得改写既有撤回留痕');
      }
      // ②c-5 终态之二：已撤回的 request 不再接受 result（撤回语义不被事后「复活」绕过）
      const resultAfterWithdraw = runHandoff(['result', 'P02', '{"commitHash":"deadbee","completedChecks":[]}'], dir);
      assertExit(resultAfterWithdraw, 1);
      assertOut(resultAfterWithdraw, '已撤回（终态）');
      // ②c-6 判据要求留痕两字段齐备：抽掉 withdrawnBy（手改形态）⇒ 重新计为在飞委托 ⇒ 出口回收
      const strippedWithdraw = JSON.parse(readStateBytes(dir));
      delete strippedWithdraw.evidence['subagent-execute'].handoffRequests.P02.withdrawnBy;
      writeState(dir, strippedWithdraw);
      const restripped = runGuard(['exit', 'subagent-execute'], dir);
      assertExit(restripped, 1);
      assertOut(restripped, '在飞委托');
      // ②c-7 撤回 → 重新委托：撤回落痕转入 previousWithdrawals，不被静默丢弃
      //     （先补回 ②c-6 抽掉的来源字段——那一抽是为验证判据要求两字段齐备，不是状态终态）
      strippedWithdraw.evidence['subagent-execute'].handoffRequests.P02.withdrawnBy = 'coordinator';
      writeState(dir, strippedWithdraw);
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/subagent-execute-flow-comet-dev.json',
        JSON.stringify({ node: 'subagent-execute', skill: 'flow-comet-dev', at: '2026-10-07T00:00:00.000Z' }, null, 2) + '\n');
      assertExit(runHandoff(['request', 'P02', '重新委托 P02', '--write-files', 'src/p2.mjs'], dir), 0);
      const stReRequest = JSON.parse(readStateBytes(dir));
      const p02ReRequested = stReRequest.evidence['subagent-execute'].handoffRequests.P02;
      if (p02ReRequested.withdrawnAt !== undefined) {
        throw new Error('重新委托应重置当前态（withdrawnAt 不得残留在当前字段）: ' + JSON.stringify(p02ReRequested));
      }
      if (!Array.isArray(p02ReRequested.previousWithdrawals) || p02ReRequested.previousWithdrawals.length !== 1
        || p02ReRequested.previousWithdrawals[0].withdrawnBy !== 'coordinator') {
        throw new Error('重新委托不得静默丢弃撤回落痕（应转入 previousWithdrawals）: ' + JSON.stringify(p02ReRequested));
      }
      // ②c-8 撤回只作用于已记录的 request：未知任务被拒、不新建记录
      const withdrawUnknown = runHandoff(['withdraw', 'P99', '--by', 'coordinator'], dir);
      assertExit(withdrawUnknown, 1);
      assertOut(withdrawUnknown, '无对应 request 记录');
      // ②c-9 前置拒绝的边界（与守卫同一把尺子）：handoffResult 的**显式 null 占位**读作未收工——
      //       守卫的两处消费方（在飞判据按 undefined / null，越俎代庖检测按 falsy）都把它读作
      //       「无结果」，故撤回仍可用，不给「出口拦 + 撤回拒」留下无出口的死角
      //       （真实链路：先 request，再落空占位，再撤回）。
      assertExit(runHandoff(['request', 'P03', '遗弃的在飞委托', '--write-files', 'src/p3.mjs'], dir), 0);
      const nullPlaceholderState = JSON.parse(readStateBytes(dir));
      nullPlaceholderState.evidence['subagent-execute'].handoffResult.P03 = null;
      writeState(dir, nullPlaceholderState);
      const nullPlaceholderWithdraw = runHandoff(['withdraw', 'P03', '--by', 'coordinator'], dir);
      assertExit(nullPlaceholderWithdraw, 0);
      assertOut(nullPlaceholderWithdraw, 'HANDOFF WITHDRAW: P03');

      // ④ 派遣留痕的静态锚（零新增 state 顶层字段）：留痕只允许落在既有嵌套字段
      //    evidence['subagent-execute'] 下——引擎脚本不得出现顶层留痕键赋值；顶层字段清单
      //    以状态字段校验器为单一来源（新增顶层字段必须先过校验器，否则本锚即红）。
      const engineScripts = [
        'workflow-state.mjs', 'workflow-guard.mjs', 'workflow-handoff.mjs',
        'route-node.mjs', 'comet-hook-guard.mjs', 'state-schema.mjs',
      ];
      const traceShapeProblems = ({ scripts, handoff, schema }) => {
        const out = [];
        const topLevelTraceWriteRe = /\bstate\.(handoffRequests|handoffResult|delegationTrace|dispatchTrace|delegations)\b/;
        for (const [script, src] of Object.entries(scripts)) {
          const hit = src.match(topLevelTraceWriteRe);
          if (hit) {
            out.push(script + ' 出现留痕键的顶层形态「' + hit[0] + '」——留痕必须落在 evidence 嵌套字段（零新增 state 顶层字段）');
          }
        }
        if (!handoff.includes("state.evidence['subagent-execute'].handoffRequests")) {
          out.push('留痕未落在嵌套证据字段（既有同族形态）——顶层字段禁令的正面锚缺失');
        }
        const declaredFields = [...schema.matchAll(/\{ field: '([A-Za-z_$][\w$]*)'/g)].map((m) => m[1]);
        for (const traceKey of ['handoffRequests', 'handoffResult', 'delegationTrace', 'dispatchTrace']) {
          if (declaredFields.includes(traceKey)) {
            out.push('状态字段校验器声明了留痕顶层字段「' + traceKey + '」（应保持嵌套、零新增顶层字段）');
          }
        }
        const writtenTopLevel = [...handoff.matchAll(/\bstate\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]);
        const undeclared = [...new Set(writtenTopLevel)].filter((key) => !declaredFields.includes(key));
        if (undeclared.length > 0) {
          out.push('workflow-handoff.mjs 写入了未在状态字段校验器声明的顶层字段: ' + undeclared.join(', '));
        }
        return out;
      };
      const engineSources = Object.fromEntries(engineScripts.map((script) => [script, fs.readFileSync(path.join(__dirname, script), 'utf8')]));
      const handoffSource = engineSources['workflow-handoff.mjs'];
      const schemaSource = engineSources['state-schema.mjs'];
      const traceSources = { scripts: engineSources, handoff: handoffSource, schema: schemaSource };
      for (const problem of traceShapeProblems(traceSources)) throw new Error(problem);
      // 反向构造（同一判据驱动）：逐项注入退化形态 ⇒ 必报（判据不恒真空过）。
      const traceProbes = [
        ['留痕键顶层赋值注入', {
          scripts: { ...engineSources, 'workflow-handoff.mjs': handoffSource + '\nstate.delegationTrace = {};\n' },
          handoff: handoffSource + '\nstate.delegationTrace = {};\n',
        }, '顶层形态'],
        ['嵌套落点改顶层', { handoff: handoffSource.replaceAll("state.evidence['subagent-execute'].handoffRequests", 'state.handoffRequests') }, '留痕未落在嵌套证据字段'],
        ['校验器声明留痕顶层字段', { schema: schemaSource.replace('export const STATE_FIELD_VALIDATORS = [', "export const STATE_FIELD_VALIDATORS = [\n  { field: 'delegationTrace', check: () => true },") }, '声明了留痕顶层字段'],
        ['未声明顶层字段写入', { handoff: handoffSource + '\nstate.undeclaredProbe = 1;\n' }, '未在状态字段校验器声明'],
      ];
      for (const [probeLabel, override, expected] of traceProbes) {
        const probed = { ...traceSources, ...override };
        if (!traceShapeProblems(probed).some((p) => p.includes(expected))) {
          throw new Error('反向构造判别力缺失（' + probeLabel + ' 未被判违规）');
        }
      }
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
      // AC-5 隔离：verify 成功只清 verify 计数，不得清 Fix 归位轮次（预置计数，成功出口后核对）
      const stBeforePass = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      stBeforePass.fixRoundsByChange = { ...(stBeforePass.fixRoundsByChange || {}), [CHANGE_ID]: 2 };
      fs.writeFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), JSON.stringify(stBeforePass, null, 2) + '\n');
      const resPass = runGuard(['exit', 'verify', '--apply'], dir);
      assertExit(resPass, 0);
      const stPass = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (!stPass.verifyFailuresByChange || stPass.verifyFailuresByChange[CHANGE_ID] !== 0) {
        throw new Error('exit verify 成功未清零当前 change 计数: ' + JSON.stringify(stPass.verifyFailuresByChange));
      }
      if (stPass.fixRoundsByChange?.[CHANGE_ID] !== 2) {
        throw new Error('exit verify 成功不得清 Fix 归位轮次（计数隔离）: '
          + JSON.stringify(stPass.fixRoundsByChange));
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
      // ③ state.protocolPath 持久化绑定优先于 FLOW_COMET_PROTOCOL env：env 指向内置协议
      // （无 brainstorm 节点），state 绑定自定义协议 → 仍按自定义协议通过。修复前 guard 只看
      // CLI/env → 走内置协议报 Unknown Node（RED）。
      const bound = composeState({
        currentNode: 'brainstorm',
        evidence: { brainstorm: { summary: 'brainstorm done' } },
        protocolPath: 'custom-protocol.json',
      });
      writeState(dir, bound);
      const resBound = runGuard(['exit', 'brainstorm'], dir); // runGuard 默认 env=内置协议副本
      assertExit(resBound, 0);
      assertOut(resBound, 'ALL CHECKS PASSED');
      assertNotOut(resBound, 'Unknown workflow Node');
      // ④ state.protocolPath 绑定不可读 → fail-closed 不回退 env/默认协议，错误说明来源与
      // 不回退语义（归属门禁可跳过校验，节点门禁没有等价降级路径）。
      writeState(dir, composeState({ protocolPath: 'missing-protocol.json' }));
      const resBoundMissing = runGuard(['exit', 'brainstorm'], dir);
      assertExit(resBoundMissing, 1);
      assertOut(resBoundMissing, 'state.protocolPath');
      assertOut(resBoundMissing, '不回退');
      assertNotOut(resBoundMissing, 'Unknown workflow Node');
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
      const res = runStateWithProtocol(dir, ['next']);
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
      const res = runStateWithProtocol(dir, ['next']);
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
      const res = runStateWithProtocol(dir, ['next']);
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
      const res = runStateWithProtocol(dir, ['next']);
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
      const res = runStateWithProtocol(dir, ['next']);
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
      const res = runStateWithProtocol(dir, ['next']);
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
      assertExit(runStateWithProtocol(dir, ['record', 'subagent-execute', '{"handoffResult":{}}']), 0);
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
      const res = runStateWithProtocol(dir, ['next']);
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
      const res = runStateWithProtocol(dir, ['init', 'prefix-test', '--branch-prefix', 'feat/']);
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
      const res = runStateWithProtocol(dir, ['status']);
      assertExit(res, 0);
      assertOut(res, '一致性: ok');
    },
  },

  // ----------  场景（init 写 status + hook 判定对齐） ----------

  // 55: init 生成的 state 必须含 status:'running'（当前缺——hook 判定不一致的根源）
  {
    name: '55 init state 含 status: running',
    run: (dir) => {
      const res = runStateWithProtocol(dir, ['init', 'tf15-st']);
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
      const initRes = runStateWithProtocol(dir, ['init', 'tf15-hk']);
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
      const initRes = runStateWithProtocol(dir, ['init', 'tf16-dir']);
      assertExit(initRes, 0);
      const res = runStateWithProtocol(dir, ['next']);
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
      const res = runStateWithProtocol(dir, ['status']);
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
      const initRes = runStateWithProtocol(dir, ['init', 'tf15-ok']);
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
      const res = runStateWithProtocol(dir, ['status']);
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
      const initRes = runStateWithProtocol(dir, ['init', 'tf14-rec']);
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

  // 67: 旧格式 state（无 status 字段 + 无 activeChange + 无 currentNode——归档批次的升级场景）
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
      const res = runStateWithProtocol(dir, ['status']);
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
      const res = runStateWithProtocol(dir, ['status']);
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
      const res = runGuardWithProtocol(dir, ['entry', 'open']);
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
      const res = runGuardWithProtocol(dir, ['exit', 'plan', '--apply']);
      assertExit(res, 0);
      assertNotOut(res, 'ROUTE WARN');
      // ② 旧模板无 status 属性（无可解析 pending）→ 前置条件跳过诊断 → 静默
      //（① 的 --apply 已把 currentNode 推进到 execute——先复位 state 再独立跑第二半）
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<task id="T02" parallel="true">\n  <action>do legacy</action>\n  <verify>echo ok</verify>\n</task>\n');
      const resLegacy = runGuardWithProtocol(dir, ['exit', 'plan', '--apply']);
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
      const res = runGuardWithProtocol(dir, ['entry', 'execute']);
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
      const res = runGuardWithProtocol(dir, ['exit', 'execute']);
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
      const res = runGuardWithProtocol(dir, ['exit', 'execute']);
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
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
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
      runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-skip']);
      const st1 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st1.ai_context_doc !== 'none') throw new Error('ai_context_doc 应为 none');
      const res2 = runStateWithProtocol(dir, ['init', CHANGE_ID + '-2']);
      if (res2.output.includes('INIT-NEEDED') || res2.output.includes('INIT-HINT')) throw new Error('下次 init 不应再提示');
    },
  },

  // 85: CONTEXT 新鲜（last_intel_scan ≤90 天）→ init 零初始化输出（新鲜路径）
  {
    name: '85 CONTEXT 新鲜 → init 零初始化输出',
    run: (dir) => {
      writeState(dir, { ...baseState('open'), last_intel_scan: new Date(Date.now() - 10 * 864e5).toISOString() });
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      if (res.output.includes('INIT-NEEDED') || res.output.includes('INIT-HINT')) throw new Error('不应有初始化提示');
    },
  },

  // 86: 有 CONTEXT 无扫描记录（旧项目迁移）→ INIT-HINT 文案不得含 null
  {
    name: '86 有 CONTEXT 无扫描记录 → INIT-HINT 文案无 null',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n');
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
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
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
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
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
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
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
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
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
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
      let res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(res, 0);
      assertOut(res, 'INIT-VALIDATE-FAILED');
      assertOut(res, '重写');
      let st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.last_intel_scan) throw new Error('校验失败不应写 last_intel_scan');
      // ② 段名变体（含正文提及）不满足必填段
      writeFile(dir, '.specs/CONTEXT.md', '# CONTEXT\n## 项目概要\nx\n## 技术栈补充\nx\n## 域语言说明\n| 术语 | 定义 |\n|---|---|\n| 例 | 定义 |\n## 已锁决策说明\n- [2026-08-01] 决策一\n## 默认偏好补充\nx\n## 既有抽象索引附录\nx\n## intel-scan 元数据附录\n- **last_intel_scan**: x\n- **scanner**: x\n- **下次重扫建议**: x\n正文提及 域语言 与 默认偏好 与 既有抽象索引（文本非标题）。\n');
      res = runStateWithProtocol(dir, ['init', CHANGE_ID + '-2', '--init-context']);
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
      res = runStateWithProtocol(dir, ['init', CHANGE_ID + '-3', '--init-context']);
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
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
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
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
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
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
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
      runStateWithProtocol(dir, ['init', CHANGE_ID]);
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
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
      const res = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md']);
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
      // a) 缺参数（无 node/skill）
      const rA = runStateWithProtocol(dir, ['skill-load']);
      assertExit(rA, 1);
      assertOut(rA, 'skill-load requires <node> <skill>');
      // b) node 非法（非内置节点）
      const rB = runStateWithProtocol(dir, ['skill-load', 'bogus', 'flow-comet-change']);
      assertExit(rB, 1);
      assertOut(rB, 'skill-load node 非法');
      // c) skill 名含非法字符
      const rC = runStateWithProtocol(dir, ['skill-load', 'open', 'bad/name']);
      assertExit(rC, 1);
      assertOut(rC, 'skill-load skill 名非法');
      // d) --prompt 不在 flow-kit/prompts/ 下（指向场景内 reference 副本——文件存在可加载，
      //    归属校验拒绝；若归属校验被跳过则此处会成功写标记，断言即失效）
      const rD = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change', '--prompt', 'reference/workflow-protocol.json']);
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
      const res = runStateWithProtocol(dir, ['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })]);
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
      const sl = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change']);
      assertExit(sl, 0);
      assertOut(sl, 'SKILL-LOAD: open flow-comet-change');
      const res = runStateWithProtocol(dir, ['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })]);
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
      const sl = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md']);
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
      const slNull = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change']);
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
      const res = runStateWithProtocol(dir, ['record', 'open', JSON.stringify({ summary: 'done', completedChecks: ['required-skill:open.flow-comet-change'] })]);
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
      // ① 旧格式 record：completedChecks 无 required-skill 条目 → 无标记也通过
      const resA = runStateWithProtocol(dir, ['record', 'open', JSON.stringify({ summary: 'legacy', completedChecks: ['unit-tests'] })]);
      assertExit(resA, 0);
      assertOut(resA, 'EVIDENCE: open');
      // ② 无 completedChecks 的纯 summary 记录 → 通过
      const resB = runStateWithProtocol(dir, ['record', 'open', JSON.stringify({ summary: 'plain' })]);
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
      // ③ 有序条目（1. **...**）与无序同口径——缺处置标记 → 旧 change 仍渐进 REVIEW WARN
      // （修复前 .filter((item) => !item.ordered) 使有序条目静默通过 = RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n1. **m-2 · 有序未处置**：某处问题，未给出任何处置结论，描述足够长以避免内容不足\n\n## 结论\n\n通过\n');
      const resOrdered = runGuard(['exit', 'review'], dir);
      assertExit(resOrdered, 0);
      assertOut(resOrdered, 'REVIEW WARN');
      assertNotOut(resOrdered, 'BLOCKED');
      // ④ 有序 Minor 带 [转待办] → 无该渐进告警（有序条目接入校验不误报已处置项）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n1. **m-3 · 有序小项**：某处小问题，已登记下一 change 跟踪处置 [转待办]\n\n## 结论\n\n通过\n');
      const resOrderedOk = runGuard(['exit', 'review'], dir);
      assertExit(resOrderedOk, 0);
      assertNotOut(resOrderedOk, 'REVIEW WARN');
      assertOut(resOrderedOk, 'ALL CHECKS PASSED');
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
      const nx = runStateWithProtocol(dir, ['next']);
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
  // ③④ 追加同判据的段尾分支回归锚（波次段即文末，新 change 形态 ⇒ 必 BLOCK）：段尾判定若
  // 不成立，该检查会被整段静默跳过——下一条 [P] 行漏扫的同族形态见上一场景。
  {
    name: '113 plan exit：波次散文与并行标记不一致 → WARN（旧 change）/ BLOCK（新 change，含段即文末形态）',
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
      // ③ 段即文末形态（新 change）：段提取的段尾判定第三个分支——波次段**即文末**（其后再无段
      //    标题、亦无分隔线）。先跑「抽掉必报」对照：同 ④ 夹具仅去掉散文行的 [P] 标记 ⇒ 无并行
      //    语义行 ⇒ 放行（该对照因此在任一态都可观测到）。
      const stEof = baseState('plan');
      stEof.evidence.plan = { summary: 'plan done' };
      stEof.newChange = true;
      writeState(dir, stEof);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const taskT01Eof = '<task id="T01"><action>a</action><write_files>f</write_files><verify>v</verify><done>d</done></task>\n';
      const eofHead = '# TASK\n\n## 波次划分\n\nWave 1 (parallel): ';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', eofHead + 'T01\n\n' + taskT01Eof);
      const resEofControl = runGuard(['exit', 'plan'], dir);
      assertExit(resEofControl, 0);
      assertNotOut(resEofControl, 'BLOCKED');
      // ④ 同 ③ 夹具补回 [P] 标记（唯一变量）→ 段尾判定须成立、该检查不得被整段静默跳过 ⇒ BLOCK。
      //    夹具形态自证（判别力前提）：波次段之后不得再出现段标题 / 分隔线——否则该夹具退化为
      //    「段后有下一段标题」形态，段尾第三分支失去覆盖而断言在两种写法下都成立（假绿）。
      const eofFixture = eofHead + 'T01[P]\n\n' + taskT01Eof;
      assertTrue(!/\n##\s|\n---/.test(eofFixture.slice(eofFixture.indexOf('## 波次划分'))),
        '夹具形态前提不成立：波次段须为文末（其后不得再出现段标题或分隔线），否则段尾分支无覆盖');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', eofFixture);
      const resEof = runGuard(['exit', 'plan'], dir);
      assertExit(resEof, 1);
      assertOutMatches(resEof, /波次散文标记任务为并行（\[P\]）但任务无 parallel="true"/, '波次段即文末时检查被整段跳过');
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
      const res = runStateWithProtocol(dir, ['init', '--help']);
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
      const res2 = runStateWithProtocol(dir, ['init', ' --help']);
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
      const res = runStateWithProtocol(dir, ['record', 'open', '{"summary":"done"}']);
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
      const res = runStateWithProtocol(dir, ['init', 'empty-repo']);
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

  // 125: R1——新 change(newChange:true)review 处置标记缺失 → BLOCKED(旧 change WARN 保留)；
  // 并内扩 Major 延期待裁决门禁三态+一反例：无用户裁决 BLOCK / 同段或文末裁决（由 [升级]
  // 承接）放行 / Minor [转待办] 不受影响 / 有裁决但缺 [升级] 承接仍 BLOCK。
  {
    name: '125 review exit BLOCKED：新 change 处置标记缺失 + Major 延期待裁决（R1）',
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
      // 子断言:Major [转待办] 属用户决策点——无用户裁决记录 → BLOCKED(修复前放行 = RED)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F1 · 未裁决的延期**：某处问题 [转待办]\n\n## 结论\n\n通过\n');
      const resMajor = runGuard(['exit', 'review'], dir);
      assertExit(resMajor, 1);
      assertOut(resMajor, 'BLOCKED');
      assertOut(resMajor, 'Major');
      assertOut(resMajor, '用户裁决');
      // 子断言:同段用户裁决 + [升级] 承接 → 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F2 · 已裁决的延期**：某处问题 [升级] [转待办]（用户裁决：接受延期，下一 change 首修）\n\n## 结论\n\n通过\n');
      const resAdjudicated = runGuard(['exit', 'review'], dir);
      assertExit(resAdjudicated, 0);
      assertOut(resAdjudicated, 'ALL CHECKS PASSED');
      assertNotOut(resAdjudicated, '用户裁决');
      // 子断言:Minor [转待办] 不受影响 → 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-1 · 小项**：某处小问题 [转待办]\n\n## 结论\n\n通过\n');
      const resMinor = runGuard(['exit', 'review'], dir);
      assertExit(resMinor, 0);
      assertOut(resMinor, 'ALL CHECKS PASSED');
      // 子断言:文末用户裁决 + 指向该条目 + [升级] 承接 → 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F3 · 文末裁决的延期**：某处问题 [升级] [转待办]\n\n## 用户裁决\n\n- 用户裁决：接受延期 —— 发现 F3（文末裁决的延期）：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resTail = runGuard(['exit', 'review'], dir);
      assertExit(resTail, 0);
      assertOut(resTail, 'ALL CHECKS PASSED');
      // 子断言:尾部裁决段落引用条目整行（引用块）时不得被误判为条目自身段落 → 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F5 · 引用条目行的尾部裁决**：某处问题 [升级] [转待办]\n\n## 用户裁决\n\n> - **F5 · 引用条目行的尾部裁决**：某处问题 [升级] [转待办]\n> 用户裁决：接受延期 —— 发现 F5：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resQuotedTail = runGuard(['exit', 'review'], dir);
      assertExit(resQuotedTail, 0);
      assertOut(resQuotedTail, 'ALL CHECKS PASSED');
      // 子断言:有用户裁决但缺 [升级] 承接 → 仍 BLOCKED（不因裁决在文末就跳过承接校验）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F4 · 无升级承接**：某处问题 [转待办]\n\n## 用户裁决\n\n- 用户裁决：接受延期 —— 发现 F4（无升级承接）：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resNoEscalation = runGuard(['exit', 'review'], dir);
      assertExit(resNoEscalation, 1);
      assertOut(resNoEscalation, 'BLOCKED');
      assertOut(resNoEscalation, 'Major');
      assertOut(resNoEscalation, '用户裁决');
      // 子断言:Minor 条目正文引用 [Major] 标签字样（自身 [转待办]）→ 放行——严重度/处置
      // 以条目自身标题/行首为准，不做整块标签扫描（修复前误判 Major 并触发延期门禁 = RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n- **m-2 · 引用 Major 的小项**：本条与 [Major] F1 项不同，是独立问题 [转待办]\n\n## 结论\n\n通过\n');
      const resCited = runGuard(['exit', 'review'], dir);
      assertExit(resCited, 0);
      assertOut(resCited, 'ALL CHECKS PASSED');
      assertNotOut(resCited, 'BLOCKED');
      // 子断言:Major 条目自身处置为 [已修]，续行正文引用他条 [转待办] → 放行——
      // 延期门禁只看该条目自身标题/行首的处置标记，不做整块扫描
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **[Major] F9 · 已修项引用他条**：某处问题 [已修]\n  （续行仅引用他条的处置去向 [转待办]，非本条处置）\n\n## 结论\n\n通过\n');
      const resQuotedDisposition = runGuard(['exit', 'review'], dir);
      assertExit(resQuotedDisposition, 0);
      assertOut(resQuotedDisposition, 'ALL CHECKS PASSED');
      assertNotOut(resQuotedDisposition, 'BLOCKED');
      // 子断言:有序 Major 标签条目缺任何处置标记 → BLOCKED（修复前有序条目被跳过 = RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n1. **[Major] F6 · 有序无处置**：某处问题，未给出任何处置结论，描述足够长以避免内容不足\n\n## 结论\n\n通过\n');
      const resOrderedMissing = runGuard(['exit', 'review'], dir);
      assertExit(resOrderedMissing, 1);
      assertOut(resOrderedMissing, '处置状态标记');
      // 子断言:有序 Major [转待办] 无用户裁决 → BLOCKED（Major 延期门禁对有序条目同口径）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n1. **F7 · 有序未裁决的延期**：某处问题 [转待办]\n\n## 结论\n\n通过\n');
      const resOrderedDeferred = runGuard(['exit', 'review'], dir);
      assertExit(resOrderedDeferred, 1);
      assertOut(resOrderedDeferred, 'Major');
      assertOut(resOrderedDeferred, '用户裁决');
      // 子断言:有序 Major [升级] [转待办] + 同段用户裁决（[升级] 承接）→ 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n1. **F8 · 有序已裁决的延期**：某处问题 [升级] [转待办]（用户裁决：接受延期，下一 change 首修）\n\n## 结论\n\n通过\n');
      const resOrderedAdjudicated = runGuard(['exit', 'review'], dir);
      assertExit(resOrderedAdjudicated, 0);
      assertOut(resOrderedAdjudicated, 'ALL CHECKS PASSED');
      assertNotOut(resOrderedAdjudicated, '用户裁决');
      // 子断言:中间位置的独立裁决段落（不与条目同段、也不在文末）——指向该条目且含
      // [升级] 承接 → 放行。实现按独立段落匹配，位置不限；文档须写明这一合法形态。
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Major\n\n'
        + '- **F10 · 中段裁决的延期**：某处问题 [升级] [转待办]\n\n'
        + '- 用户裁决：接受延期 —— 发现 F10（中段裁决的延期）：下一 change 首修。\n\n'
        + '### Minor\n\n- **m-4 · 小项**：另一个独立问题 [已修]\n\n## 结论\n\n通过\n');
      const resMidParagraph = runGuard(['exit', 'review'], dir);
      assertExit(resMidParagraph, 0);
      assertOut(resMidParagraph, 'ALL CHECKS PASSED');
      // 子断言:文档口径与实现对齐——review SKILL 须写明「单独段落（指向条目 + [升级] 承接）」
      // 也是合法裁决位置，避免文档只写「同段或文末」而收窄实现语义（文档未同步 = RED）。
      const reviewSkillText = fs.readFileSync(
        path.join(__dirname, '..', '..', 'flow-comet-review', 'SKILL.md'), 'utf8');
      if (!reviewSkillText.includes('单独段落') || !reviewSkillText.includes('指向') || !reviewSkillText.includes('[升级]')) {
        throw new Error('flow-comet-review/SKILL.md 未写明「单独段落（指向条目 + [升级] 承接）」合法');
      }
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
      // 子断言:拦截消息须含关键词引导(声明级校验的执行者体验——真机回归实证:语义完整但
      // 缺关键词被拦,消息应指明所需关键词,防执行者无从下手)
      assertOut(res, '须含关键词');
    },
  },

  // 127: R1——新 change 波次散文不一致 → BLOCKED。波次段提取的「段尾」判定在此留一格判别夹具 +
  // 一格单变量对照：① 段后紧跟下一段标题、段内无大写 Z（阳性对照，检查本身在场，两态同判）；
  // ② 段内**早于** [P] 行出现大写 Z（机检标记字面量形态）但散文行无 [P] 标记（「抽掉必报」对照：
  // 去掉 [P] 这一个变量 ⇒ 无并行语义行 ⇒ 放行，两态同判）；③ 同 ② 的夹具补回 [P] 标记 ⇒ 段体
  // 若在段内首个大写 Z 处提前收尾，该 [P] 行整行漏扫 ⇒ 本应 BLOCK 却静默放过（③ 即该形态的
  // 常驻回归锚）。段即文末的第二形态见下一场景（同判据、另一段尾分支，独立成景以便单轮同时可见）。
  // 两格夹具各自带「形态前提」断言（Z 早于 [P] 行）——形态漂移会让锚静默退化成假绿。
  {
    name: '127 plan exit BLOCKED：新 change 波次散文不一致（R1；段内大写 Z 早于 [P] 行形态）',
    run: (dir) => {
      const st = baseState('plan');
      st.evidence.plan = { summary: 'planned' };
      st.newChange = true;
      writeState(dir, st);
      assertExit(runGuard(['entry', 'plan'], dir), 0);
      const planTask = (text) => writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', text);
      const taskT01 = '<task id="T01"><action>a</action><write_files>f</write_files><verify>v</verify><done>d</done></task>\n';
      // 判别句式锚（非裸子串）：拦因句 + 判据分支，抽掉该句即红
      const waveBlocked = /波次散文标记任务为并行（\[P\]）但任务无 parallel="true"/;
      // 大写 Z 说明行：段内早于 [P] 行，且自身不含并行语义词（避免截断态/完整态的行筛选差异）
      const waveZNote = '- 机检标记形态说明（ZERO-LOGIC-CHANGE-OK）';
      // ① 段后有下一段标题、段内无 Z → BLOCK（阳性对照：两态同判）
      planTask('# TASK\n\n## 波次划分\n\nWave 1 (parallel): T01[P]\n\n## 任务清单\n\n' + taskT01);
      const res = runGuard(['exit', 'plan'], dir);
      assertExit(res, 1);
      assertOutMatches(res, waveBlocked, '波次散文不一致');
      // 段内大写 Z 说明行 + 散文行共用夹具（散文行的 [P] 标记为唯一变量）：② 不带 [P]（抽掉必报
      // 对照）、③ 带 [P]（判别夹具）。形态自证：大写 Z 必须**早于** [P] 行——若 Z 排在 [P] 行之后，
      // 段体截断点落在该行之后、该行仍会被扫描，本族断言在两种写法下都成立（假绿 ⇒ 零判别力）。
      const zWaveFixture = (marker) => '# TASK\n\n## 波次划分\n\n' + waveZNote + '\n\nWave 1 (parallel): T01' + marker + '\n\n## 任务清单\n\n' + taskT01;
      assertTrue(zWaveFixture('[P]').indexOf(waveZNote) < zWaveFixture('[P]').indexOf('T01[P]'),
        '夹具形态前提不成立：大写 Z 说明行须早于 [P] 行，否则段尾截断不影响该行扫描（锚零判别力）');
      // ② 抽掉必报自证（单变量对照）：段内大写 Z 说明行在场、散文行无 [P] 标记 → 放行
      planTask(zWaveFixture(''));
      const resNoMarker = runGuard(['exit', 'plan'], dir);
      assertExit(resNoMarker, 0);
      assertNotOut(resNoMarker, 'BLOCKED');
      assertOut(resNoMarker, 'ALL CHECKS PASSED');
      // ③ 同一夹具补回散文行的 [P] 标记（唯一变量）→ 段内大写 Z 之后的 [P] 行不得漏扫 ⇒ BLOCK
      planTask(zWaveFixture('[P]'));
      const resZ = runGuard(['exit', 'plan'], dir);
      assertExit(resZ, 1);
      assertOutMatches(resZ, waveBlocked, '段内大写 Z 之后的 [P] 行漏扫');
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

      // ===== M-02 request 时刻归属门禁（AC-1/AC-2/AC-3 的 L1 面）=====
      // 夹具前提：新 change 驻留 execute + 本节点技能声明标记在场（否则先被技能声明门 BLOCK，
      // 测不到归属门禁本身）；协议副本由运行器放入 <dir>/reference/ 并显式指向（env 优先级）。
      const reqEnv = { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) };
      const reqStatePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/execute-flow-comet-dev.json',
        JSON.stringify({ node: 'execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const pendingParallelTask =
        '<task id="P-M02" parallel="true" status="pending"><action>实现 P-M02</action><write_files>src/p-m02.mjs</write_files><verify>node --check src/p-m02.mjs</verify></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + pendingParallelTask);
      // ① 新 change 错误节点 pending 并行 request → BLOCK + state 字节零改写 + 不落请求记录 + 恢复指引
      const reqState = baseState('execute');
      reqState.newChange = true;
      reqState.enteredNodes = ['execute'];
      writeState(dir, reqState);
      const beforeReqBytes = fs.readFileSync(reqStatePath, 'utf8');
      const resWrongNode = runHandoff(['request', 'P-M02', 'parallel fix slice'], dir, reqEnv);
      assertExit(resWrongNode, 1);
      assertOut(resWrongNode, 'BLOCKED: 任务 P-M02（并行 pending）应归属节点 subagent-execute');
      assertOut(resWrongNode, 'workflow-state next');
      assertOut(resWrongNode, 'entry subagent-execute');
      assertOut(resWrongNode, '本次请求未写入 state');
      if (fs.readFileSync(reqStatePath, 'utf8') !== beforeReqBytes) {
        throw new Error('M-02 BLOCK 必须 state 字节零改写');
      }
      const stAfterBlock = readScenarioState(dir);
      const reqsAfterBlock = stAfterBlock.evidence?.['subagent-execute']?.handoffRequests ?? {};
      if (reqsAfterBlock['P-M02']) {
        throw new Error('M-02 BLOCK 不得落 handoffRequests: ' + JSON.stringify(reqsAfterBlock));
      }
      // ② 旧 change 同构造 → 可见 WARN + 照常落库（AC-3 渐进兼容）
      writeState(dir, { ...baseState('execute'), enteredNodes: ['execute'] });
      const resOldChange = runHandoff(['request', 'P-M02', 'parallel fix slice'], dir, reqEnv);
      assertExit(resOldChange, 0);
      assertOut(resOldChange, 'WARN: 任务 P-M02（并行 pending）应归属节点 subagent-execute');
      assertOut(resOldChange, '旧 change 渐进不阻断');
      assertOut(resOldChange, 'HANDOFF REQUEST: P-M02');
      const stOldChange = readScenarioState(dir);
      if (!stOldChange.evidence?.['subagent-execute']?.handoffRequests?.['P-M02']) {
        throw new Error('旧 change 错误节点请求应照常落库（AC-3），实际 ' + JSON.stringify(stOldChange.evidence));
      }
      // ③ pending 并行任务依赖未满足 → 当前不可委托。恢复指引必须以 next 实际输出为准：
      // next 对依赖未满足的并行任务按串行消化输出 execute——指引不得再固定指向
      // entry subagent-execute（否则按指引进入会被 currentNode 门禁拦成死路）。
      writeIntakeArtifacts(dir);
      const unmetDepsTask =
        '<task id="S-M01" parallel="false" status="pending"><action>实现 S-M01</action><write_files>src/s-m01.mjs</write_files><verify>node --check src/s-m01.mjs</verify></task>\n' +
        '<task id="P-M03" parallel="true" status="pending"><action>实现 P-M03</action><write_files>src/p-m03.mjs</write_files><verify>node --check src/p-m03.mjs</verify><depends_on>S-M01</depends_on></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + unmetDepsTask);
      const unmetState = baseState('execute');
      unmetState.newChange = true;
      unmetState.enteredNodes = ['execute'];
      unmetState.completedNodes = ['open', 'design', 'plan'];
      unmetState.evidence = { plan: { summary: 'plan done' } };
      writeState(dir, unmetState);
      const unmetBytesBefore = fs.readFileSync(reqStatePath, 'utf8');
      const resUnmet = runHandoff(['request', 'P-M03', 'parallel slice with unmet deps'], dir, reqEnv);
      assertExit(resUnmet, 1);
      assertOut(resUnmet, 'BLOCKED: 任务 P-M03（并行 pending）当前不可委托：依赖未满足');
      assertOut(resUnmet, '未完成: S-M01');
      assertOut(resUnmet, '原始 currentNode=execute');
      assertOut(resUnmet, 'workflow-state next');
      assertOut(resUnmet, '按输出的 NODE 进入');
      assertOut(resUnmet, '若输出 execute 表示依赖未满足');
      assertOut(resUnmet, '待任务变为可委托');
      // 不得固定指引 next 不会输出的节点（进入即死路的反锚）
      assertNotOut(resUnmet, 'entry subagent-execute');
      assertNotOut(resUnmet, 'HANDOFF REQUEST');
      if (fs.readFileSync(reqStatePath, 'utf8') !== unmetBytesBefore) {
        throw new Error('依赖未满足 BLOCK 必须 state 字节零改写');
      }
      const stUnmet = readScenarioState(dir);
      if (stUnmet.evidence?.['subagent-execute']?.handoffRequests?.['P-M03']) {
        throw new Error('依赖未满足 BLOCK 不得落 handoffRequests: ' + JSON.stringify(stUnmet.evidence));
      }
      // 同构真实链路：next 对当前 TASK 实际输出 execute（依赖未满足/串行消化），与指引条件分支一致
      const resUnmetNext = runStateWithProtocol(dir, ['next']);
      assertExit(resUnmetNext, 0);
      if (!/^NODE: execute$/m.test(resUnmetNext.output)) {
        throw new Error('依赖未满足时 next 应输出 execute（指引一致性锚）：\n' + resUnmetNext.output);
      }
      if (readScenarioState(dir).currentNode !== 'execute') {
        throw new Error('依赖未满足时 next 应把工作归属留在 execute: ' + JSON.stringify(readScenarioState(dir).currentNode));
      }
      // 旧 change 同形态 → 可见 WARN + 照常落库（渐进兼容，不因依赖未满足而卡死）
      const oldUnmetState = { ...unmetState };
      delete oldUnmetState.newChange;
      writeState(dir, oldUnmetState);
      const resUnmetOld = runHandoff(['request', 'P-M03', 'old change unmet deps'], dir, reqEnv);
      assertExit(resUnmetOld, 0);
      assertOut(resUnmetOld, 'WARN: 任务 P-M03（并行 pending）当前不可委托：依赖未满足');
      assertOut(resUnmetOld, '旧 change 渐进不阻断');
      assertOut(resUnmetOld, 'HANDOFF REQUEST: P-M03');
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
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(res, 0);
      const st = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (st.newChange !== true) throw new Error('init 未写入 newChange: true');
    },
  },

  // 131: R1 旧兼容——旧 change(无 newChange)处置标记缺失仍 WARN；并内扩 Major 延期待裁决
  // 门禁旧 change 渐进面：无用户裁决 → WARN 不 BLOCK（不卡死旧 REVIEW）；有裁决+[升级] → 放行。
  {
    name: '131 review exit 兼容：旧 change 处置标记缺失仍 WARN + Major 延期渐进（R1 旧兼容）',
    run: (dir) => {
      const st = baseState('review');
      st.evidence.review = { summary: 'reviewed' };
      writeState(dir, st); // 无 newChange(旧 change)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题A**: 某处存在一个需要记录的问题描述,但未给出任何处置结论\n\n## 结论\n\n通过\n');
      const res = runGuard(['exit', 'review'], dir);
      assertExit(res, 0);
      assertOut(res, 'WARN');
      // 子断言:Major [转待办] 无用户裁决 → 旧 change 渐进 WARN 且不 BLOCK（不卡死旧 REVIEW）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F1 · 未裁决的延期**：某处问题 [转待办]\n\n## 结论\n\n通过\n');
      const resMajor = runGuard(['exit', 'review'], dir);
      assertExit(resMajor, 0);
      assertOut(resMajor, 'REVIEW WARN');
      assertOut(resMajor, 'Major');
      assertOut(resMajor, '用户裁决');
      assertNotOut(resMajor, 'BLOCKED');
      // 子断言:有同段用户裁决 + [升级] 承接 → 无该渐进告警
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F2 · 已裁决的延期**：某处问题 [升级] [转待办]（用户裁决：接受延期）\n\n## 结论\n\n通过\n');
      const resOk = runGuard(['exit', 'review'], dir);
      assertExit(resOk, 0);
      assertNotOut(resOk, '用户裁决');
      assertOut(resOk, 'ALL CHECKS PASSED');
      // 子断言:有序 Major [转待办] 无用户裁决 → 旧 change 渐进 WARN 不 BLOCK（有序同口径）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n1. **F3 · 有序未裁决的延期**：某处问题 [转待办]\n\n## 结论\n\n通过\n');
      const resOrderedMajor = runGuard(['exit', 'review'], dir);
      assertExit(resOrderedMajor, 0);
      assertOut(resOrderedMajor, 'REVIEW WARN');
      assertOut(resOrderedMajor, '用户裁决');
      assertNotOut(resOrderedMajor, 'BLOCKED');
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
      assertExit(runStateWithProtocol(dir, ['record', 'open', '{"summary":"intake"}']), 0);
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
      // ① 旧字段迁移:旧 state(顶层 verifyFailures=2)→ verify-fail 并入当前 change(2+1=3)不超限
      const st = baseState('verify');
      st.verifyFailures = 2;
      writeState(dir, st);
      // 场景内 ch/ch2 目录(select 要求 change 目录存在)
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const r1 = runStateWithProtocol(dir, ['verify-fail']);
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
      const r2 = runStateWithProtocol(dir, ['verify-fail']);
      assertExit(r2, 1);
      assertOut(r2, '超限');
      // ③ 切换 change:select ch2 → 计数独立(若实现仍用全局计数 3,此处会误 BLOCK = RED)
      writeFile(dir, '.specs/ch2/CHANGE.md', '# CHANGE\n## Why\nx\n');
      const r3 = runStateWithProtocol(dir, ['select', 'ch2']);
      assertExit(r3, 0);
      const r4 = runStateWithProtocol(dir, ['verify-fail']);
      assertExit(r4, 0);
      assertOut(r4, 'VERIFY-FAIL: 1/3');
      // ④ ch2 独立计数:连续 3 次后第 4 次 BLOCK
      assertExit(runStateWithProtocol(dir, ['verify-fail']), 0);
      assertExit(runStateWithProtocol(dir, ['verify-fail']), 0);
      const r7 = runStateWithProtocol(dir, ['verify-fail']);
      assertExit(r7, 1);
      assertOut(r7, '超限');
      // ⑤ 切回 ch:原计数保留(3 → 仍超限,不串扰不回零)
      const r8 = runStateWithProtocol(dir, ['select', 'ch']);
      assertExit(r8, 0);
      const r9 = runStateWithProtocol(dir, ['verify-fail']);
      assertExit(r9, 1);
      assertOut(r9, '超限');
      // ⑥ 计数隔离扩展（AC-5）：verify 失败计数与 Fix 归位轮次各自独立——verify-fail 只动
      // verifyFailuresByChange，绝不触碰 fixRoundsByChange（旧实现只读 verify 计数已通过；
      // 若未来把二者混用 / 共用容器，本条按 change 逐项断言变红）。
      const stIsolated = readScenarioState(dir);
      stIsolated.fixRoundsByChange = { ch: 2, ch2: 1 };
      writeState(dir, stIsolated);
      writeFile(dir, '.specs/ch3/CHANGE.md', '# CHANGE\n## Why\nx\n');
      assertExit(runStateWithProtocol(dir, ['select', 'ch3']), 0);
      const stCh3Before = readScenarioState(dir);
      stCh3Before.fixRoundsByChange = { ch: 2, ch2: 1, ch3: 5 };
      writeState(dir, stCh3Before);
      const r10 = runStateWithProtocol(dir, ['verify-fail']);
      assertExit(r10, 0);
      assertOut(r10, 'VERIFY-FAIL: 1/3');
      const stCh3After = readScenarioState(dir);
      if (stCh3After.verifyFailuresByChange?.ch3 !== 1) {
        throw new Error('verify-fail 应按 change 递增 verify 计数，实际 '
          + JSON.stringify(stCh3After.verifyFailuresByChange));
      }
      if (JSON.stringify(stCh3After.fixRoundsByChange) !== JSON.stringify({ ch: 2, ch2: 1, ch3: 5 })) {
        throw new Error('verify 失败计数与 Fix 轮次计数不得串扰（fixRoundsByChange 被改写）: '
          + JSON.stringify(stCh3After.fixRoundsByChange));
      }
    },
  },

  // 137: next 漂移校正不得推走"已记录证据但未 exit"的进行中节点——exit 被拦截(如
  // 内容级 BLOCKED)后执行者跑 next,校正把 currentNode 推到下一节点,被拦截节点无法
  // 重跑(exit 前置 currentNode 校验拦截),advance/select 均不恢复 → 死结(实测教训)。
  // 修复:evidence 存在且节点未 exit → 视为进行中,next 不校正(currentNode 保持原节点)
  {
    name: '137 next 不推走进行中节点:exit 被拦截后重跑路径保留',
    run: (dir) => {
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
      const r1 = runStateWithProtocol(dir, ['next']);
      assertExit(r1, 0);
      assertOut(r1, 'NODE: review');
      assertNotOut(r1, 'NODE: verify');
      // ② exit review 重跑路径保留:缺处置标记 → BLOCKED(新 change),补标记后通过
      assertExit(runGuardWithProtocol(dir, ['entry', 'review']), 0); // 新 change 强制先 entry
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题无处置标记\n\n## 结论\n\n通过\n');
      const rBlock = runGuardWithProtocol(dir, ['exit', 'review']);
      assertExit(rBlock, 1);
      assertOut(rBlock, '处置状态标记');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题 **[已修]**\n\n## 结论\n\n通过\n');
      const rPass = runGuardWithProtocol(dir, ['exit', 'review', '--apply']);
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
      const res = runStateWithProtocol(dir, ['record', 'open', bad]);
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
  // ② 该轮修复在既有场景内扩展（不新增顶层编号）。

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
      // ① import 断言走模块级 hasNamedImport（同一判据只实现一次——本场景原先内联了同形闭包，
      // 两处实现会在容忍面上漂移）。
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
      // ① --json-file 指向损坏 JSON（以 { 开头）→ "不是合法 JSON" + 长度元数据，不再建议 --json-file
      writeFile(dir, 'payload.json', '{summary: "broken", completedChecks: ["x"]');
      const resFile = runStateWithProtocol(dir, ['record', 'open', '--json-file', 'payload.json']);
      assertExit(resFile, 1);
      assertNotOut(resFile, '--json-file');
      assertOut(resFile, '不是合法 JSON');
      assertOut(resFile, 'length=');
      // ② 内联传参损坏（以 { 开头）→ 仍建议 --json-file（既有语义保留）
      const bad = '{summary: "broken"';
      const resInline = runStateWithProtocol(dir, ['record', 'open', bad]);
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
      const res = runStateWithProtocol(dir, ['record', 'open', '[plain-text-not-json']);
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
      // ③ m-13 result 重验失败（.gitignore 变化）新 change：HANDOFF ERROR + request.noCommit 置 false
      // + 不落/不覆盖 result（资格建立后把 .specs/ 从忽略规则移除 → 重验失败）
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const priorCompletedAt = JSON.parse(fs.readFileSync(statePath, 'utf8'))
        .evidence['subagent-execute'].handoffResult.T02.completedAt;
      writeFile(dir, '.gitignore', 'baseline-only\n');
      const resRevalBlock = runHandoff(['result', 'T02', JSON.stringify({
        status: 'DONE', taskId: 'T02', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check baseline.js', output: 'ok' },
        greenEvidence: { command: 'node --check baseline.js', output: 'ok' },
      })], dir);
      assertExit(resRevalBlock, 1);
      assertOut(resRevalBlock, 'HANDOFF ERROR');
      assertOut(resRevalBlock, 'noCommit=false');
      assertOut(resRevalBlock, '不落 result');
      const stRevalBlock = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const reqBlocked = stRevalBlock.evidence['subagent-execute'].handoffRequests.T02;
      if (!reqBlocked || reqBlocked.noCommit !== false) {
        throw new Error('result 重验失败应把 request.noCommit 置 false，实际 ' + JSON.stringify(reqBlocked));
      }
      if (stRevalBlock.evidence['subagent-execute'].handoffResult.T02.completedAt !== priorCompletedAt) {
        throw new Error('新 change result 重验失败不得覆盖既有 handoffResult（completedAt 变化）');
      }
      // F6 审计：忽略规则变化（过期资格）撤销必须留 at/reason，且失败类别与既有归类一致
      assertRevocationAudit(reqBlocked, 'stale-eligibility', '157③ 新 change .gitignore 变化');
      assertOut(resRevalBlock, 'revokedAt=');
      assertOut(resRevalBlock, 'revokeReason=stale-eligibility');
      // ④ 旧 change 同构造：HANDOFF WARN + 照常落 result + noCommit 同样置 false（渐进兼容）
      writeFile(dir, '.gitignore', '.specs/\n'); // 恢复忽略规则 → 重新 request 取得资格
      const stReReq = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      delete stReReq.newChange; // 旧 change = 缺省/null（validator 不接受 false）
      writeState(dir, stReReq);
      assertExit(runHandoff(['request', 'T02', 'delegate docs-only slice again'], dir), 0);
      const stReReqAfter = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (stReReqAfter.evidence['subagent-execute'].handoffRequests.T02.noCommit !== true) {
        throw new Error('恢复忽略规则后重新 request 应重新取得 noCommit 资格，实际 '
          + JSON.stringify(stReReqAfter.evidence['subagent-execute'].handoffRequests.T02));
      }
      const legacyCompletedAt = stReReqAfter.evidence['subagent-execute'].handoffResult.T02.completedAt;
      writeFile(dir, '.gitignore', 'baseline-only\n');
      const resRevalWarn = runHandoff(['result', 'T02', JSON.stringify({
        status: 'DONE', taskId: 'T02', noCommit: true,
        completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
        redEvidence: { command: 'node --check baseline.js', output: 'ok' },
        greenEvidence: { command: 'node --check baseline.js', output: 'ok' },
      })], dir);
      assertExit(resRevalWarn, 0);
      assertOut(resRevalWarn, 'HANDOFF WARN');
      assertOut(resRevalWarn, 'noCommit=false');
      const stRevalWarn = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (stRevalWarn.evidence['subagent-execute'].handoffRequests.T02.noCommit !== false) {
        throw new Error('旧 change 重验失败同样应撤销 request.noCommit，实际 '
          + JSON.stringify(stRevalWarn.evidence['subagent-execute'].handoffRequests.T02));
      }
      // F6 审计：旧 change 渐进撤销同样必须留 at/reason（与失败类别对应）
      assertRevocationAudit(stRevalWarn.evidence['subagent-execute'].handoffRequests.T02,
        'stale-eligibility', '157④ 旧 change .gitignore 变化');
      assertOut(resRevalWarn, 'revokeReason=stale-eligibility');
      const legacyResult = stRevalWarn.evidence['subagent-execute'].handoffResult.T02;
      if (!legacyResult || legacyResult.completedAt === legacyCompletedAt || legacyResult.result.noCommit !== true) {
        throw new Error('旧 change 重验失败应照常落 result（渐进），实际 ' + JSON.stringify(legacyResult));
      }
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
      // ②e/②f m-13 symlink/junction 逃逸（Windows junction 先例）：request 时刻逐段 lstat
      // 拒绝 symlink/junction 祖先；result 时刻对资格重验——资格建立后把真实目录替换为
      // junction 指向 runRoot 外 → 新 change HANDOFF ERROR、noCommit 撤销、不落 result。
      const outsideDir = makeTmp();
      const linkPathA = path.join(dir, 'linked-out');
      const linkPathB = path.join(dir, 'linked-out2');
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      try {
        writeFile(outsideDir, 'escape.md', 'outside\n');
        // ②e request 资格拒绝：write_files 祖先段为 junction（目标在 runRoot 外），即使
        // .gitignore 命中该路径也不得授予零提交（旧实现只看 check-ignore → noCommit:true = RED）
        fs.symlinkSync(outsideDir, linkPathA, linkType);
        writeFile(dir, '.gitignore', 'linked-out/\n');
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
          + '<task id="T06" status="done"><action>symlink 边界任务</action>'
          + '<write_files>linked-out/escape.md</write_files>'
          + '<verify>node --check allowed.js</verify></task>\n');
        writeState(dir, baseState('subagent-execute'));
        const resLink = runHandoff(['request', 'T06', 'symlink slice'], dir);
        assertExit(resLink, 0);
        const stLink = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
        const reqLink = stLink.evidence['subagent-execute'].handoffRequests.T06;
        if (!reqLink || reqLink.noCommit === true) {
          throw new Error('symlink/junction 祖先不得具备零提交资格（fail-closed），实际 ' + JSON.stringify(reqLink));
        }
        // ②f result 重验拒绝：先以真实目录建立资格，再把目录替换为 junction → 重验失败
        writeFile(dir, 'linked-out2/escape.md', 'inside\n');
        writeFile(dir, '.gitignore', 'linked-out2/\n');
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
          + '<task id="T07" status="done"><action>junction 重验边界任务</action>'
          + '<write_files>linked-out2/escape.md</write_files>'
          + '<verify>node --check allowed.js</verify></task>\n');
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/subagent-execute-flow-comet-dev.json',
          JSON.stringify({ node: 'subagent-execute', skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
        const stReqLink = baseState('subagent-execute');
        stReqLink.newChange = true;
        writeState(dir, stReqLink);
        const resReqLink = runHandoff(['request', 'T07', 'junction revalidate slice'], dir);
        assertExit(resReqLink, 0);
        const stReqLinkAfter = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
        if (stReqLinkAfter.evidence['subagent-execute'].handoffRequests.T07.noCommit !== true) {
          throw new Error('真实目录 + 命中忽略规则时 request 应取得 noCommit 资格，实际 '
            + JSON.stringify(stReqLinkAfter.evidence['subagent-execute'].handoffRequests.T07));
        }
        fs.rmSync(linkPathB, { recursive: true, force: true });
        fs.symlinkSync(outsideDir, linkPathB, linkType);
        const resRevalLink = runHandoff(['result', 'T07', JSON.stringify({
          status: 'DONE', taskId: 'T07', noCommit: true,
          completedChecks: ['required-skill:subagent-execute.flow-comet-dev'],
          redEvidence: { command: 'node --check allowed.js', output: 'ok' },
          greenEvidence: { command: 'node --check allowed.js', output: 'ok' },
        })], dir);
        assertExit(resRevalLink, 1);
        assertOut(resRevalLink, 'HANDOFF ERROR');
        assertOut(resRevalLink, 'noCommit=false');
        const stRevalLink = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
        if (stRevalLink.evidence['subagent-execute'].handoffRequests.T07.noCommit !== false) {
          throw new Error('junction 逃逸重验失败应撤销 request.noCommit，实际 '
            + JSON.stringify(stRevalLink.evidence['subagent-execute'].handoffRequests.T07));
        }
        // F6 审计：symlink/junction 逃逸撤销留 at/reason，类别与既有失败归类一致
        assertRevocationAudit(stRevalLink.evidence['subagent-execute'].handoffRequests.T07,
          'symlink-junction-escape', '158②f junction/symlink 重验');
        assertOut(resRevalLink, 'revokeReason=symlink-junction-escape');
        if (stRevalLink.evidence['subagent-execute'].handoffResult?.T07) {
          throw new Error('junction 逃逸重验失败不得落 handoffResult');
        }
      } finally {
        for (const linkPath of [linkPathA, linkPathB]) {
          try { fs.unlinkSync(linkPath); } catch { try { fs.rmdirSync(linkPath); } catch { /* 已移除 */ } }
        }
        fs.rmSync(outsideDir, { recursive: true, force: true });
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
  // ⑫⑬ 追加 6 维自查段提取的段尾判定回归锚（段内大写 Z 早于方法名 ⇒ 不得误拦；方法声明真缺席 ⇒
  // 仍须 BLOCK）——与模板保真共用同一新 change 严格出口链路。
  {
    name: '159 execute exit SUMMARY 模板保真：缺标题/首部/段序新 BLOCK，合法变体通过，旧 WARN；6 维段内大写 Z 不误拦 + 未声明仍 BLOCK',
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
      const sectionText = {
        what: '## 做了什么\n\n实现 T01（TDD：先写失败场景再实现）。',
        files: '## 改动文件\n\n| 文件 | 性质 | 说明 |\n|---|---|---|\n| src/t1.mjs | 修改 | 实现 T01 |',
        verify: '## verify 输出\n\n```\nnode --check src/t1.mjs\n```',
        sixDim: '## 6 维自查\n\n- 功能: 通过（brooks-review 已跑）\n- 性能: 无影响\n- 安全: 无影响\n- 兼容: 通过\n- 可观测: 通过\n- 可维护: 通过',
        db: '## 数据库迁移\n\nN/A：本任务无 schema 变更。',
        bounds: '## 越界检查\n\n仅修改 src/t1.mjs，无越界。',
        breaking: '## 破坏性变更\n\nN/A：本任务不涉及破坏性变更。',
        deviation: '## 决策与偏离\n\n无偏离。',
        newWork: '## 是否触发新工作\n\n无。',
        done: '## 完成判定\n\n- TASK.md 中对应任务已勾选：是',
        method: '## 自检方法\n\nbrooks-review',
      };
      // 模板序 = flow-kit/templates/SUMMARY.md 全部 H2（含 5 个条件段）；## 自检方法 不属骨架，
      // 单独按位置校核（文末或紧随 ## 越界检查两种合法位置）。
      const skeletonOrder = [sectionText.what, sectionText.files, sectionText.verify, sectionText.sixDim,
        sectionText.db, sectionText.bounds, sectionText.breaking, sectionText.deviation, sectionText.newWork, sectionText.done];
      const fullSections = [...skeletonOrder, sectionText.method]; // 自检方法在文末（合法位置一）
      const afterBoundsSections = [...skeletonOrder.slice(0, 6), sectionText.method, ...skeletonOrder.slice(6)]; // 紧随越界（合法位置二）
      const illegalSelfSections = [...skeletonOrder.slice(0, 4), sectionText.method, ...skeletonOrder.slice(4)]; // 自检方法夹在中间（非法）
      const missingTailSections = [...skeletonOrder.slice(0, 9), sectionText.method]; // 缺尾段 完成判定
      const outOfOrderSections = [
        ...skeletonOrder.slice(0, 5), sectionText.bounds, sectionText.db, ...skeletonOrder.slice(6), sectionText.method,
      ]; // 数据库迁移排到越界检查之后（段序偏离）
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
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# T01-SUMMARY', fullSections));
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
        ['# SUMMARY: T01 - 实现 T01', '', headerMissing, '', '---', '', fullSections.join('\n\n')].join('\n'));
      const res2 = runGuard(['exit', 'execute'], dir);
      assertExit(res2, 1);
      assertOut(res2, 'BLOCKED');
      // ③ 新 change：段序乱（自检方法提前、做了什么滞后）→ BLOCK
      const scrambled = [
        sectionText.verify, sectionText.bounds, sectionText.sixDim, sectionText.method,
        sectionText.what, sectionText.files, sectionText.db, sectionText.breaking,
        sectionText.deviation, sectionText.newWork, sectionText.done,
      ];
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', scrambled));
      const res3 = runGuard(['exit', 'execute'], dir);
      assertExit(res3, 1);
      assertOut(res3, 'BLOCKED');
      // ④ 合法变体：大小写（# Summary: …）→ 通过
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# Summary: T01 - 实现 T01', fullSections));
      const res4 = runGuard(['exit', 'execute'], dir);
      assertExit(res4, 0);
      assertOut(res4, 'ALL CHECKS PASSED');
      // ⑤ 合法变体：括号后缀 → 通过
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01（含说明括号）', fullSections));
      const res5 = runGuard(['exit', 'execute'], dir);
      assertExit(res5, 0);
      assertOut(res5, 'ALL CHECKS PASSED');
      // ⑥ 旧 change：缺标题 → WARN 渐进不阻断
      setupExecute(false);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# T01-SUMMARY', fullSections));
      const res6 = runGuard(['exit', 'execute'], dir);
      assertExit(res6, 0);
      assertOut(res6, 'WARN');
      // ⑦ 起：写入 SUMMARY 模板副本——M1 全骨架硬阻断只在 runRoot 内存在
      // flow-kit/templates/SUMMARY.md 时生效（模板缺失仅内置骨架提示，不新增 BLOCK）。
      // 维护者工作副本含 vendored flow-kit → 复制真实模板；CI 全新检出 flow-kit 被
      // .gitignore 排除（不可分发）→ 用与真实模板 H2 逐字对齐的内置镜像（skeleton 派生结果
      // 等价），保证硬阻断锚在两级载体都可执行、不静默跳过。
      const realSummaryTemplate = path.join(REPO_ROOT, 'flow-kit', 'templates', 'SUMMARY.md');
      const summaryTemplateFixture = fs.existsSync(realSummaryTemplate)
        ? fs.readFileSync(realSummaryTemplate, 'utf8')
        : [
            '# SUMMARY: <T01 - 任务名>',
            '',
            '## 做了什么（一段话）',
            '',
            '## 改动文件',
            '',
            '## verify 输出（必填）',
            '',
            '## 6 维自查（生产代码改动必填 · 来自 4-dev 步骤 4）',
            '',
            '## 数据库迁移（涉及 schema 变更必填 · 来自 4-dev 步骤 1.7 / R4.5）',
            '',
            '## 越界检查（必填 · 来自 4-dev 步骤 5 / R6.5 / B3 老项目护栏）',
            '',
            '## 破坏性变更（涉及破坏性改动必填 · 来自 4-dev 步骤 1.8 / R4.6 / B4 老项目护栏）',
            '',
            '## 决策与偏离（如有）',
            '',
            '## 是否触发新工作',
            '',
            '## 完成判定',
            '',
          ].join('\n');
      writeFile(dir, 'flow-kit/templates/SUMMARY.md', summaryTemplateFixture);
      // ⑦ 新 change 缺尾段（完成判定）→ BLOCK + 缺段 + 「补 N/A 段」恢复指引
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', missingTailSections));
      const res7 = runGuard(['exit', 'execute'], dir);
      assertExit(res7, 1);
      assertOut(res7, 'BLOCKED');
      assertOut(res7, '完成判定');
      assertOut(res7, 'N/A');
      // ⑧ 段序偏离（数据库迁移排到越界检查之后）→ BLOCK + 段序 + 缺段点可定位
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', outOfOrderSections));
      const res8 = runGuard(['exit', 'execute'], dir);
      assertExit(res8, 1);
      assertOut(res8, 'BLOCKED');
      assertOut(res8, '段序');
      assertOut(res8, '数据库迁移');
      // ⑨ 合法位置一：## 自检方法 位于文末 → 通过（真实模板在场）
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', fullSections));
      const res9 = runGuard(['exit', 'execute'], dir);
      assertExit(res9, 0);
      assertOut(res9, 'ALL CHECKS PASSED');
      assertNotOut(res9, 'BLOCKED');
      // ⑩ 合法位置二：## 自检方法 紧随 ## 越界检查 之后 → 通过（真实模板在场）
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', afterBoundsSections));
      const res10 = runGuard(['exit', 'execute'], dir);
      assertExit(res10, 0);
      assertOut(res10, 'ALL CHECKS PASSED');
      assertNotOut(res10, 'BLOCKED');
      // ⑪ 自检方法位置非法（夹在 6 维自查与数据库迁移之间）→ BLOCK
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', illegalSelfSections));
      const res11 = runGuard(['exit', 'execute'], dir);
      assertExit(res11, 1);
      assertOut(res11, 'BLOCKED');
      assertOut(res11, '自检方法');
      // ⑫ 6 维自查段提取的段尾判定（常驻回归锚 · 假阳性误拦位点）：段内**早于**方法名出现大写 Z
      //    （机检标记字面量形态）——串尾若被写成字面字符 Z，惰性段体在段内首个 Z 处提前收尾，
      //    段内的方法声明被截掉 ⇒ 出口误判「6 维自查未声明自检方法」而 BLOCK。
      //    单变量对照：与 ⑨/⑩ 的无 Z 合规基线相比只多一行 Z 说明（同一份 dims 原文逐字不变），
      //    两者都必须 PASS——即该行不得改变判定（既不放宽也不误拦）。
      const zNote = '> 本任务 diff 属零逻辑改动（机检标记 ZERO-LOGIC-CHANGE-OK），按协议执行 PR Review。';
      const withSixDim = (six) => fullSections.map((s) => (s === sectionText.sixDim ? six : s));
      const sixDimZFirst = sectionText.sixDim.replace('## 6 维自查\n\n', '## 6 维自查\n\n' + zNote + '\n\n');
      assertTrue(sixDimZFirst !== sectionText.sixDim, '单变量前提不成立：6 维自查段标题形态变化，Z 说明行未插入');
      assertEqual(sixDimZFirst.replace('## 6 维自查\n\n' + zNote + '\n\n', '## 6 维自查\n\n'),
        sectionText.sixDim, '单变量前提不成立：Z 说明行不是与无 Z 基线的唯一差异');
      assertTrue(sixDimZFirst.indexOf(zNote) < sixDimZFirst.indexOf('brooks-review'),
        '夹具形态前提不成立：Z 说明行须早于方法声明，否则段尾截断不影响该声明（锚零判别力）');
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', fullSections));
      const res12Base = runGuard(['exit', 'execute'], dir);
      assertExit(res12Base, 0);
      assertOut(res12Base, 'ALL CHECKS PASSED');
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', withSixDim(sixDimZFirst)));
      const res12 = runGuard(['exit', 'execute'], dir);
      assertExit(res12, 0);
      assertOut(res12, 'ALL CHECKS PASSED');
      assertNotOut(res12, 'BLOCKED');
      // ⑬ 判据未放宽对照 + 抽掉必报自证：同 ⑫ 夹具仅抽掉 6 维段内的方法声明行（其余逐字不变）
      //    ⇒ 6 维自查段确实未声明自检方法 ⇒ 仍须 BLOCK，且拦因须落在该判据上（而非段空 / 段缺席）。
      const sixDimNoDecl = sixDimZFirst.replace('- 功能: 通过（brooks-review 已跑）', '- 功能: 通过（内置快查）');
      assertTrue(sixDimNoDecl !== sixDimZFirst, '对照夹具前提不成立：6 维段内方法声明行未命中');
      setupExecute(true);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', compose('# SUMMARY: T01 - 实现 T01', withSixDim(sixDimNoDecl)));
      const res13 = runGuard(['exit', 'execute'], dir);
      assertExit(res13, 1);
      assertOut(res13, '6 维自查未声明使用 /brooks-review');
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
      const env = { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) };
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
      const resRec = runStateWithProtocol(dir, ['record', 'plan', '{"summary":"plan done"}']);
      assertExit(resRec, 1);
      assertOut(resRec, '先加载技能');
      // ③ 旧 change：record 无声明 → WARN 渐进不阻断
      const stOld = baseState('plan');
      writeState(dir, stOld);
      const resOld = runStateWithProtocol(dir, ['record', 'plan', '{"summary":"plan done"}']);
      assertExit(resOld, 0);
      assertOut(resOld, 'WARN');

      // ===== M-02 request 时刻归属门禁（AC-2 不误伤面）=====
      // 正确节点成功 / 串行错配 BLOCK / 未 entry WARN / done 与显式 write-files 旁路 /
      // 协议无对应 enabled 节点跳过 / 协议不可读可见 WARN 后放行（不静默）。归属门禁位于
      // 技能声明门之后——新 change 夹具必须放入本节点声明标记，否则先被技能门 BLOCK，
      // 测不到归属门禁本身。
      const writeMarker = (node) => {
        fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID, '.skill-loads'), { recursive: true });
        writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/' + node + '-flow-comet-dev.json',
          JSON.stringify({ node, skill: 'flow-comet-dev', protocol: '4-dev.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      };
      const taskXml = (id, attrs, writeFiles) =>
        '# TASK\n\n<task id="' + id + '" ' + attrs + '><action>实现 ' + id + '</action>'
        + '<write_files>' + writeFiles + '</write_files><verify>node --check src/x.mjs</verify></task>\n';
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      // ④ 正确节点（subagent-execute）+ pending 并行 → 成功落库（不误伤）
      writeMarker('subagent-execute');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P01', 'parallel="true" status="pending"', 'src/p01.mjs'));
      const stOk = baseState('subagent-execute');
      stOk.newChange = true;
      stOk.enteredNodes = ['subagent-execute'];
      writeState(dir, stOk);
      const resOk = runHandoff(['request', 'P01', 'delegate'], dir, env);
      assertExit(resOk, 0);
      assertOut(resOk, 'HANDOFF REQUEST: P01');
      const recOk = readScenarioState(dir).evidence?.['subagent-execute']?.handoffRequests?.P01;
      if (!recOk) throw new Error('正确节点并行 pending 请求应成功落库，实际 ' + JSON.stringify(recOk));
      // ⑤ 串行 pending 在 subagent-execute 请求（目标 execute 不匹配）→ BLOCK + 字节零改写
      writeMarker('execute');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('S01', 'parallel="false" status="pending"', 'src/s01.mjs'));
      const stSerial = baseState('subagent-execute');
      stSerial.newChange = true;
      stSerial.enteredNodes = ['subagent-execute'];
      writeState(dir, stSerial);
      const beforeSerial = fs.readFileSync(statePath, 'utf8');
      const resSerial = runHandoff(['request', 'S01', 'serial slice'], dir, env);
      assertExit(resSerial, 1);
      assertOut(resSerial, 'BLOCKED: 任务 S01（串行 pending）应归属节点 execute');
      assertOut(resSerial, 'entry execute');
      if (fs.readFileSync(statePath, 'utf8') !== beforeSerial) {
        throw new Error('串行错配 BLOCK 必须 state 字节零改写');
      }
      // ⑥ 正确节点但尚未 entry → 仅 WARN + 照常落库
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('S02', 'parallel="false" status="pending"', 'src/s02.mjs'));
      const stNotEntered = baseState('execute');
      stNotEntered.newChange = true; // enteredNodes 缺 execute
      writeState(dir, stNotEntered);
      const resNotEntered = runHandoff(['request', 'S02', 'serial slice'], dir, env);
      assertExit(resNotEntered, 0);
      assertOut(resNotEntered, 'WARN: 任务 S02 的归属节点 execute 与原始 currentNode 一致');
      assertOut(resNotEntered, '尚未 entry');
      assertOut(resNotEntered, 'HANDOFF REQUEST: S02');
      // ⑦ done 任务补录（非 pending）→ 归属门禁跳过，不误伤
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('D01', 'parallel="true" status="done"', 'src/d01.mjs'));
      const stDone = baseState('execute');
      stDone.newChange = true;
      stDone.enteredNodes = ['execute'];
      writeState(dir, stDone);
      const resDone = runHandoff(['request', 'D01', 'backfill'], dir, env);
      assertExit(resDone, 0);
      assertNotOut(resDone, 'BLOCKED');
      assertOut(resDone, 'HANDOFF REQUEST: D01');
      // ⑧ 显式 --write-files 且 TASK 无匹配任务 → 可见 WARN + 跳过归属门禁（不误伤）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n<!-- 无匹配任务块 -->\n');
      const stExplicit = baseState('execute');
      stExplicit.newChange = true;
      stExplicit.enteredNodes = ['execute'];
      writeState(dir, stExplicit);
      const resExplicit = runHandoff(['request', 'X01', 'explicit slice', '--write-files', 'src/x01.mjs'], dir, env);
      assertExit(resExplicit, 0);
      assertOut(resExplicit, '显式 --write-files 且 TASK.md 无匹配任务 X01');
      assertOut(resExplicit, 'HANDOFF REQUEST: X01');
      assertNotOut(resExplicit, 'BLOCKED');
      // ⑨ 协议无对应 enabled 节点 → 跳过归属门禁（删除 subagent-execute 节点）：驻留 execute
      // 但任务为并行 pending——若实现不做协议感知会误判目标 subagent-execute ≠ execute 而 BLOCK
      writeMarker('execute');
      const proto = JSON.parse(fs.readFileSync(scenarioProtocolPath(dir), 'utf8'));
      const noSubProto = { ...proto, nodes: proto.nodes.filter((n) => n.id !== 'subagent-execute') };
      writeFile(dir, 'reference/protocol-nosub.json', JSON.stringify(noSubProto, null, 2) + '\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P02', 'parallel="true" status="pending"', 'src/p02.mjs'));
      const stNoSub = baseState('execute');
      stNoSub.newChange = true;
      stNoSub.enteredNodes = ['execute'];
      writeState(dir, stNoSub);
      const resNoSub = runHandoff(['request', 'P02', 'no-sub protocol'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'protocol-nosub.json') });
      assertExit(resNoSub, 0);
      assertNotOut(resNoSub, 'BLOCKED');
      assertNotOut(resNoSub, '本次未执行归属校验'); // 协议可读且无对应 enabled 节点 → 跳过校验，不产生归属 WARN
      assertOut(resNoSub, 'HANDOFF REQUEST: P02');
      // ⑩ 节点被 disabled → 同样跳过归属门禁
      const disabledProto = { ...proto, nodes: proto.nodes.map((n) => (n.id === 'subagent-execute' ? { ...n, disabled: true } : n)) };
      writeFile(dir, 'reference/protocol-disabled.json', JSON.stringify(disabledProto, null, 2) + '\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P03', 'parallel="true" status="pending"', 'src/p03.mjs'));
      const stDisabled = baseState('execute');
      stDisabled.newChange = true;
      stDisabled.enteredNodes = ['execute'];
      writeState(dir, stDisabled);
      const resDisabled = runHandoff(['request', 'P03', 'disabled protocol'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'protocol-disabled.json') });
      assertExit(resDisabled, 0);
      assertNotOut(resDisabled, 'BLOCKED');
      assertNotOut(resDisabled, '本次未执行归属校验'); // disabled 节点语义与缺节点一致 → 跳过校验且无归属 WARN
      assertOut(resDisabled, 'HANDOFF REQUEST: P03');
      // ⑪ pending 并行任务依赖未满足 → BLOCK 指引与 next 实际输出一致（next 按串行消化输出
      // execute）；依赖满足后按 next 输出进入委托节点，request 恢复成功——无 entry 死路。
      writeIntakeArtifacts(dir);
      const unmetDepsTask =
        '<task id="S03" parallel="false" status="pending"><action>实现 S03</action><write_files>src/s03.mjs</write_files><verify>node --check src/s03.mjs</verify></task>\n' +
        '<task id="P04" parallel="true" status="pending"><action>实现 P04</action><write_files>src/p04.mjs</write_files><verify>node --check src/p04.mjs</verify><depends_on>S03</depends_on></task>\n';
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + unmetDepsTask);
      const stUnmet = baseState('execute');
      stUnmet.newChange = true;
      stUnmet.enteredNodes = ['execute'];
      stUnmet.completedNodes = ['open', 'design', 'plan'];
      stUnmet.evidence = { plan: { summary: 'plan done' } };
      writeState(dir, stUnmet);
      const unmetBytesBefore = fs.readFileSync(statePath, 'utf8');
      const resUnmet = runHandoff(['request', 'P04', 'parallel slice with unmet deps'], dir, env);
      assertExit(resUnmet, 1);
      assertOut(resUnmet, 'BLOCKED: 任务 P04（并行 pending）当前不可委托：依赖未满足');
      assertOut(resUnmet, '未完成: S03');
      assertOut(resUnmet, 'workflow-state next');
      assertOut(resUnmet, '若输出 execute 表示依赖未满足');
      assertOut(resUnmet, '待任务变为可委托');
      assertNotOut(resUnmet, 'entry subagent-execute');
      if (fs.readFileSync(statePath, 'utf8') !== unmetBytesBefore) {
        throw new Error('依赖未满足 BLOCK 必须 state 字节零改写');
      }
      if (readScenarioState(dir).evidence?.['subagent-execute']?.handoffRequests?.P04) {
        throw new Error('依赖未满足 BLOCK 不得落 handoffRequests');
      }
      const resUnmetNext = runStateWithProtocol(dir, ['next']);
      assertExit(resUnmetNext, 0);
      if (!/^NODE: execute$/m.test(resUnmetNext.output)) {
        throw new Error('依赖未满足时 next 应输出 execute：\n' + resUnmetNext.output);
      }
      // 依赖满足：串行任务消化完成后 next 输出 subagent-execute；按输出 entry 后 request 成功
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="S03" parallel="false" status="done"><action>实现 S03</action><write_files>src/s03.mjs</write_files><verify>node --check src/s03.mjs</verify></task>\n'
        + '<task id="P04" parallel="true" status="pending"><action>实现 P04</action><write_files>src/p04.mjs</write_files><verify>node --check src/p04.mjs</verify><depends_on>S03</depends_on></task>\n');
      const afterSerial = readScenarioState(dir);
      afterSerial.completedNodes = [...new Set([...(afterSerial.completedNodes || []), 'execute'])];
      afterSerial.evidence = { ...(afterSerial.evidence || {}), execute: { summary: 'serial digest done' } };
      writeState(dir, afterSerial);
      const resDelegableNext = runStateWithProtocol(dir, ['next']);
      assertExit(resDelegableNext, 0);
      if (!/^NODE: subagent-execute$/m.test(resDelegableNext.output)) {
        throw new Error('依赖满足后 next 应输出 subagent-execute：\n' + resDelegableNext.output);
      }
      if (readScenarioState(dir).currentNode !== 'subagent-execute') {
        throw new Error('依赖满足后 next 应把工作归属推到 subagent-execute');
      }
      writeMarker('subagent-execute');
      assertExit(runGuardWithProtocol(dir, ['entry', 'subagent-execute']), 0);
      const resRecovered = runHandoff(['request', 'P04', 'now delegable'], dir, env);
      assertExit(resRecovered, 0);
      assertOut(resRecovered, 'HANDOFF REQUEST: P04');
      // ⑫ 协议不可读（默认解析指向 runRoot 外的内置协议，受保护读取拒绝）→ 可见 WARN（原因 +
      // 「本次未执行归属校验」）+ 放行语义不变。修复前此形态静默 skip（无 WARN、照常落库）＝假绿。
      writeMarker('execute');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P05', 'parallel="true" status="pending"', 'src/p05.mjs'));
      const stNoProtocol = baseState('execute');
      stNoProtocol.newChange = true;
      stNoProtocol.enteredNodes = ['execute'];
      writeState(dir, stNoProtocol);
      const resNoProtocol = runHandoff(['request', 'P05', 'no protocol'], dir, { FLOW_COMET_PROTOCOL: '' });
      assertExit(resNoProtocol, 0);
      assertOut(resNoProtocol, 'WARN:');
      assertOut(resNoProtocol, '本次未执行归属校验');
      assertOut(resNoProtocol, '协议路径不在当前项目根内');
      assertOut(resNoProtocol, 'HANDOFF REQUEST: P05');
      assertNotOut(resNoProtocol, 'BLOCKED');
      if (!readScenarioState(dir).evidence?.['subagent-execute']?.handoffRequests?.P05) {
        throw new Error('协议不可读应可见 WARN 后照常落库（放行语义不变），实际未落请求记录');
      }
      // ⑬ 协议文件缺失（显式指向 runRoot 内不存在的路径）→ 同类可见 WARN（原因=文件不存在）+ 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P06', 'parallel="true" status="pending"', 'src/p06.mjs'));
      const stProtocolMissing = baseState('execute');
      stProtocolMissing.newChange = true;
      stProtocolMissing.enteredNodes = ['execute'];
      writeState(dir, stProtocolMissing);
      const resProtocolMissing = runHandoff(['request', 'P06', 'missing protocol'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'protocol-missing.json') });
      assertExit(resProtocolMissing, 0);
      assertOut(resProtocolMissing, 'WARN:');
      assertOut(resProtocolMissing, '本次未执行归属校验');
      assertOut(resProtocolMissing, '协议文件不存在');
      assertOut(resProtocolMissing, 'HANDOFF REQUEST: P06');
      assertNotOut(resProtocolMissing, 'BLOCKED');
      // 旧 change 同形态 → 同样仅可见 WARN + 照常落库（协议不可读不区分新旧 change 新增硬 BLOCK）
      const stProtocolMissingOld = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      delete stProtocolMissingOld.newChange;
      writeState(dir, stProtocolMissingOld);
      const resProtocolMissingOld = runHandoff(['request', 'P06', 'missing protocol legacy'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'protocol-missing.json') });
      assertExit(resProtocolMissingOld, 0);
      assertOut(resProtocolMissingOld, '本次未执行归属校验');
      assertOut(resProtocolMissingOld, 'HANDOFF REQUEST: P06');
      assertNotOut(resProtocolMissingOld, 'BLOCKED');
      // ⑭ 协议解析失败（非法 JSON 文件）→ 同类可见 WARN（原因=不是合法 JSON）+ 放行
      writeFile(dir, 'reference/protocol-broken.json', '{ not-json\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskXml('P07', 'parallel="true" status="pending"', 'src/p07.mjs'));
      const stProtocolBroken = baseState('execute');
      stProtocolBroken.newChange = true;
      stProtocolBroken.enteredNodes = ['execute'];
      writeState(dir, stProtocolBroken);
      const resProtocolBroken = runHandoff(['request', 'P07', 'broken protocol'], dir,
        { FLOW_COMET_PROTOCOL: path.join(dir, 'reference', 'protocol-broken.json') });
      assertExit(resProtocolBroken, 0);
      assertOut(resProtocolBroken, 'WARN:');
      assertOut(resProtocolBroken, '本次未执行归属校验');
      assertOut(resProtocolBroken, '不是合法 JSON');
      assertOut(resProtocolBroken, 'HANDOFF REQUEST: P07');
      assertNotOut(resProtocolBroken, 'BLOCKED');
      // ⑮ state 协议绑定：init --protocol 指向自定义协议（无 execute / subagent-execute
      // 节点）→ state.protocolPath 持久化；后续 request 按该协议判定，串行 pending 无对应
      // enabled 委托节点 → 跳过归属校验。若协议来源未持久化，env 指向内置协议会把串行
      // pending 误判为归属 execute → BLOCK（修复前 RED）。
      const boundChange = 'bound-proto';
      const boundProtocol = {
        ...proto,
        nodes: proto.nodes.filter((n) => n.id !== 'execute' && n.id !== 'subagent-execute'),
      };
      writeFile(dir, 'reference/protocol-bound.json', JSON.stringify(boundProtocol, null, 2) + '\n');
      assertExit(runState(['init', boundChange, '--init-skip', '--protocol', 'reference/protocol-bound.json'], dir), 0);
      writeFile(dir, '.specs/' + boundChange + '/TASK.md', taskXml('B01', 'parallel="false" status="pending"', 'src/b01.mjs'));
      const resBound = runHandoff(['request', 'B01', 'bound protocol serial'], dir,
        { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
      assertExit(resBound, 0);
      assertOut(resBound, 'HANDOFF REQUEST: B01');
      assertNotOut(resBound, 'BLOCKED');
      assertNotOut(resBound, '本次未执行归属校验'); // 协议可读且无对应 enabled 节点 → 跳过校验，不产生不可读 WARN
      const boundState = readScenarioState(dir);
      if (boundState.protocolPath !== 'reference/protocol-bound.json') {
        throw new Error('init 应把解析后的协议路径持久化为项目根相对形态，实际: ' + JSON.stringify(boundState.protocolPath));
      }
      if (!boundState.evidence?.['subagent-execute']?.handoffRequests?.B01) {
        throw new Error('state 绑定协议下的 request 应照常落库');
      }
      // ⑯ state.protocolPath 存在但不可读 → 不回退 env/默认（回退会按内置协议把串行 pending
      // 误判为归属 execute → BLOCK）；可见 WARN 说明来源 +「本次未执行归属校验」后放行。
      const boundMissingState = readScenarioState(dir);
      boundMissingState.protocolPath = 'reference/protocol-bound-missing.json';
      writeState(dir, boundMissingState);
      writeFile(dir, '.specs/' + boundChange + '/TASK.md', taskXml('B02', 'parallel="false" status="pending"', 'src/b02.mjs'));
      const resBoundMissing = runHandoff(['request', 'B02', 'bound protocol unreadable'], dir,
        { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
      assertExit(resBoundMissing, 0);
      assertOut(resBoundMissing, 'WARN:');
      assertOut(resBoundMissing, '本次未执行归属校验');
      assertOut(resBoundMissing, 'state.protocolPath');
      assertOut(resBoundMissing, '协议文件不存在');
      assertOut(resBoundMissing, 'HANDOFF REQUEST: B02');
      assertNotOut(resBoundMissing, 'BLOCKED');
      if (!readScenarioState(dir).evidence?.['subagent-execute']?.handoffRequests?.B02) {
        throw new Error('state.protocolPath 不可读应可见 WARN 后照常落库');
      }
      // ⑰ 旧 state（无 protocolPath 字段）→ env/默认回退不回归：env 指向内置协议时，串行
      // pending 在 open 节点发起仍按内置协议归属 execute → BLOCK（缺字段 = 渐进兼容路径）。
      const legacyBoundState = readScenarioState(dir);
      delete legacyBoundState.protocolPath;
      legacyBoundState.currentNode = 'open';
      writeState(dir, legacyBoundState);
      writeFile(dir, '.specs/' + boundChange + '/TASK.md', taskXml('B03', 'parallel="false" status="pending"', 'src/b03.mjs'));
      const resLegacyBound = runHandoff(['request', 'B03', 'legacy state no binding'], dir,
        { FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir) });
      assertExit(resLegacyBound, 1);
      assertOut(resLegacyBound, 'BLOCKED: 任务 B03（串行 pending）应归属节点 execute');
    },
  },

  // 163: next / guard entry 输出点名加载（设计语义 / AC-17）——`workflow-state next` 与
  // `workflow-guard entry` 输出应含 `LOAD SKILL: <skill>（用 Skill 工具，禁止跳过）`。
  // 当前 printNext / entry 无该行 → 预期 RED。
  {
    name: '163 next / entry 输出点名 LOAD SKILL：用 Skill 工具，禁止跳过',
    run: (dir) => {
      // ① next：open 节点 → 输出点名 flow-comet-open
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const st = baseState('open');
      st.evidence.open = { summary: 'intake complete' };
      writeState(dir, st);
      const resNext = runStateWithProtocol(dir, ['next']);
      assertExit(resNext, 0);
      assertOut(resNext, 'LOAD SKILL: flow-comet-open');
      assertOut(resNext, '禁止跳过');
      // ② guard entry：plan 节点 → 输出点名 flow-comet-plan
      const st2 = baseState('plan');
      writeState(dir, st2);
      const resEntry = runGuardWithProtocol(dir, ['entry', 'plan']);
      assertExit(resEntry, 0);
      assertOut(resEntry, 'LOAD SKILL: flow-comet-plan');
      assertOut(resEntry, '禁止跳过');
    },
  },

  // 164: 技能加载措辞（设计语义 / AC-16）——主 SKILL（SKILL.md + 入口展开册）与节点 SKILL
  // 须含「Skill 工具」与「不得跳过/禁止跳过」。入口展开册随 `GUIDANCE.md` 改名同步为
  // `reference/entry-detail.md`（判据强度不变：仍是同两条存在级锚点句，只是文件名换了）。
  // 判据抽成纯函数（单一实现）：真实判据与反向构造探针共用，逐份抽掉任一条锚点必红。
  {
    name: '164 技能加载措辞：主 SKILL 与节点 SKILL 含 Skill 工具 + 不得/禁止跳过',
    run: (dir) => {
      const files = [
        [path.join('flow-comet', 'SKILL.md'), path.join(__dirname, '..', 'SKILL.md')],
        [path.join('flow-comet', 'reference', 'entry-detail.md'),
          path.join(__dirname, '..', 'reference', 'entry-detail.md')],
        ...['flow-comet-open', 'flow-comet-design', 'flow-comet-plan', 'flow-comet-execute',
          'flow-comet-subagent-execute', 'flow-comet-review', 'flow-comet-verify', 'flow-comet-archive']
          .map((s) => [path.join(s, 'SKILL.md'), path.join(__dirname, '..', '..', s, 'SKILL.md')]),
      ];
      const missing = [];
      for (const [rel, f] of files) {
        const text = fs.readFileSync(f, 'utf8');
        missing.push(...skillLoadingWordingProblems(rel, text));
        // 反向构造（同一判据驱动）：逐条锚点句抽掉 ⇒ 必报该条缺失——存在级锚点不得恒真空过。
        for (const [label, stripped] of [
          ['Skill 工具', text.split('Skill 工具').join('（反向构造：抽掉）')],
          ['不得跳过/禁止跳过', text.split('禁止跳过').join('（反向构造：抽掉）').split('不得跳过').join('（反向构造：抽掉）')],
        ]) {
          if (stripped === text) continue; // 该条本就不在场，缺失已由真实判据报告
          if (!skillLoadingWordingProblems(rel, stripped).some((p) => p.includes(label))) {
            missing.push(rel + ' 反向构造判别力缺失（抽掉「' + label + '」未被判缺失）');
          }
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
      const res = runStateWithProtocol(dir, ['next']);
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
  // 入口层的第二份随 `GUIDANCE.md` 改名同步为 `reference/entry-detail.md`（判据强度不变）。
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
      const entryLevelFiles = [
        ['flow-comet/SKILL.md', path.join(__dirname, '..', 'SKILL.md')],
        ['flow-comet/reference/entry-detail.md', path.join(__dirname, '..', 'reference', 'entry-detail.md')],
      ];
      for (const [rel, file] of entryLevelFiles) {
        const text = fs.readFileSync(file, 'utf8');
        problems.push(...twoLayerEntryProblems(rel, text));
        // 反向构造（同一判据驱动）：逐条锚点句抽掉 ⇒ 必报；还原混淆句式 / 无限定自动补表述 ⇒ 必报。
        for (const [label, stripped] of [
          ['入口层锚点句', text.split(entryAnchor).join('（反向构造：抽掉）')],
          ['前置门', text.split('前置门').join('（反向构造：抽掉）')],
        ]) {
          if (stripped === text) continue; // 该条本就不在场，缺失已由真实判据报告
          if (!twoLayerEntryProblems(rel, stripped).some((p) => p.includes(label))) {
            problems.push(rel + ' 反向构造判别力缺失（抽掉「' + label + '」未被判缺失）');
          }
        }
        const regressed = text + '\n见上方 Required Calls 表。' + autoFill + '。\n';
        const regressedProblems = twoLayerEntryProblems(rel, regressed);
        for (const label of ['Implementation/Required 混淆句式', '无限定自动补表述']) {
          if (!regressedProblems.some((p) => p.includes(label))) {
            problems.push(rel + ' 反向构造判别力缺失（还原「' + label + '」未被判违规）');
          }
        }
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
      // ④b m-13 result 重验：request 时路径不存在（记资格），随后路径被强制跟踪 →
      // result 重验失败撤销 noCommit，失败类别 = became-tracked，且留 at/reason 审计。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n'
        + '<task id="T15" status="done"><action>tracked-after-request 边界任务</action>'
        + '<write_files>.specs/' + CHANGE_ID + '/T15.md</write_files>'
        + '<verify>node --check src/x.js</verify></task>\n');
      writeState(dir, baseState('subagent-execute'));
      const resReqT15 = runHandoff(['request', 'T15', 'tracked-after-request slice'], dir);
      assertExit(resReqT15, 0);
      const stReqT15 = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      if (stReqT15.evidence['subagent-execute'].handoffRequests.T15.noCommit !== true) {
        throw new Error('request 时未跟踪且被忽略的路径应取得 noCommit 资格，实际 '
          + JSON.stringify(stReqT15.evidence['subagent-execute'].handoffRequests.T15));
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/T15.md', 'tracked after request\n');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-f', '.specs/' + CHANGE_ID + '/T15.md');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'track after request');
      stReqT15.newChange = true;
      writeState(dir, stReqT15);
      const resRevokeTracked = runHandoff(['result', 'T15', payload('T15', '')], dir);
      assertExit(resRevokeTracked, 1);
      assertOut(resRevokeTracked, 'HANDOFF ERROR');
      assertOut(resRevokeTracked, 'revokeReason=became-tracked');
      const stRevokeTracked = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      assertRevocationAudit(stRevokeTracked.evidence['subagent-execute'].handoffRequests.T15,
        'became-tracked', '170④b 路径变 tracked 重验');
      if (stRevokeTracked.evidence['subagent-execute'].handoffResult?.T15) {
        throw new Error('tracked 重验失败不得落 result');
      }
      // ⑤ merge commit 负例（evil merge）：merge 提交独有的越界文件不得绕过完整提交子集校验
      // → 新 change BLOCK 且列出越界文件（merge 与普通提交走同一 fail-closed 路径）
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      git('checkout', '-q', '-b', 'feature-merge');
      writeFile(dir, 'src/feature-merge.js', 'feature\n');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'src/feature-merge.js');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'feature branch');
      git('checkout', '-q', branch);
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '--no-ff', '--no-commit', 'feature-merge');
      writeFile(dir, 'src/evil-merge.js', 'evil\n');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'src/evil-merge.js');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'evil merge');
      const mergeHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const stMerge = baseState('subagent-execute');
      stMerge.newChange = true;
      stMerge.evidence['subagent-execute'] = { handoffRequests: { T13: { description: 'merge boundary', writeFiles: ['src/x.js'] } } };
      writeState(dir, stMerge);
      const resMerge = runHandoff(['result', 'T13', payload('T13', mergeHash)], dir);
      assertExit(resMerge, 1);
      assertOut(resMerge, '超出 writeFiles 范围');
      assertOut(resMerge, 'src/evil-merge.js');
      // ⑥ invalid hash 负例：非法 commitHash 不得被静默当作合法提交——必须输出可见 HANDOFF ERROR
      //（记录不被拒绝是既有渐进语义；此处锚定「可见报错 + 不作为合法提交校验」的契约边界）
      const stInvalidHash = baseState('subagent-execute');
      stInvalidHash.newChange = true;
      stInvalidHash.evidence['subagent-execute'] = { handoffRequests: { T14: { description: 'invalid hash', writeFiles: ['src/x.js'] } } };
      writeState(dir, stInvalidHash);
      const resInvalidHash = runHandoff(['result', 'T14', payload('T14', 'not-a-commit-hash')], dir);
      assertExit(resInvalidHash, 0);
      assertOut(resInvalidHash, 'HANDOFF ERROR');
      assertOut(resInvalidHash, 'commitHash 格式非法');
      assertNotOut(resInvalidHash, '提交为空，校验通过');
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
        return runStateWithProtocol(dir, ['next']);
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
      const res = runStateWithProtocol(dir, ['next']);
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
      let res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: subagent-execute');
      // ② P02 也 done → 可委托集合为空、串行 T03 pending → 趟间回 execute
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + pDone('P02', 'P01') + t03(''));
      res = runStateWithProtocol(dir, ['next']);
      assertExit(res, 0);
      assertOut(res, 'NODE: execute');
      // ③ 全部 done + SUMMARY 在场 → 合取完成（无 eligible ∧ 无 serial pending）→ review
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1 + pDone('P02', 'P01') + t03('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/P01-SUMMARY.md', summaryContent());
      writeFile(dir, '.specs/' + CHANGE_ID + '/T03-SUMMARY.md', summaryContent());
      res = runStateWithProtocol(dir, ['next']);
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
        return runStateWithProtocol(dir, ['next']);
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
            FLOW_COMET_PROTOCOL: scenarioProtocolPath(dir),
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

  // 184: 技能文本混排合法化语义文本锁（in-place 扩展：模板权威整句 / 入口 archive 读法 /
  // 规划约束 / Codex 平台事实）——plan 与 subagent-execute 两 SKILL 权威源不得再含
  // 「连续块」「居首」旧波次形态约束表述，且依赖图语义描述（depends_on）在场、「用 Skill 工具」
  // 两层加载句式保持（措辞锁族既有锚不破坏）。
  // **逐字锁重定向（ADR-016）**：原「同一文字须在多册出现」的硬锁一律改为「单一权威 + 指针在场 +
  // 正文唯一」三件套，每条新锚自带反向构造（抽掉目标文字必红——`LESSONS` L-106 判别句式，非裸子串）：
  //   ② 模板权威：14 册各自的锚句**即指向唯一权威 `flow-kit/templates/**` 的指针**（整句语义组合
  //      仍在场，缺任一册即红）；「该句只在 1 处」落在**册内一侧**（每册恰一处——同册复制第二份即红），
  //      并补「作者面唯一」：全部持锚行的分发文本必须同指 `flow-kit/templates/**`（指向别处即红）。
  //   ⑤ 平台事实：判别句随 `worktree-notes.md` 移出而迁入 `reference/platform-facts.md`（T07 已搬入）
  //      ——判据改为「权威文件在场 + 判别句在权威处 + 各引用册指针在场 + 判别句**不再回流册子**」。
  //   ⑥ 三块归一处：`reference/commit-discipline.md` 持 pathspec 五要素与集成四要素**全文**（权威处），
  //      两册只留要点句（**不再要求逐字一致**，逐字锁已作废）；权威处独有的「证据与判级」判别句
  //      回流任一册即红。
  //   ⑦ 入口册的 7 条字面量与「建树适用面两句」保留（能力契约锚）；`worktree-notes.md` 的 6 条整句
  //      随文件移出改锚到 `reference/platform-facts.md`，并断言各引用册指针在场。
  //   ⑧ 文本↔实现一致（文本不得说谎）：**保留原样**——它不是「多册同文字」类锁，本批不动。
  //   附：技能树正文的相对路径引用必须解析得到（本轮 `GUIDANCE.md` 改名曾造成 5 册死引用而零红灯）。
  //   附 2：成对展开文件的指针**不得指错**——「能解析 ≠ 指对了」：同目录带同名 `GUIDANCE.md` 的册，
  //     册首「手写区详细协议见 …」必须是本册裸文件名；入口册（展开版为 `reference/entry-detail.md`）
  //     是唯一例外。解析判据只证明目标**存在**，证明不了**指对了**——本附与之互补。
  // 文本存在级断言（结构级由其余场景族覆盖）。
  // in-place 扩展（委托契约纪律文本锁）：两册（委托册 / 串行册）各自须含四属性契约、提交面 pathspec
  // 纪律与集成纪律的**要点句与条件句**；旧表述零残留（无条件 worktree 口号仅允许被反驳形态、
  // 「未获机制明文放行」清零）；文本点名的实现常量 / 载荷键名 / 受保护目标与引擎实现逐项对照
  //（文本说 A、实现说 B 即红）。
  {
    name: '184 技能文本锁：模板权威指针在场 + 三块归一处 + 纪律判别句式 + 文本↔实现一致',
    run: () => {
      const problems = [];
      // —— 既有锚（原文语义与失败消息保持）——
      for (const skillDir of ['flow-comet-plan', 'flow-comet-subagent-execute']) {
        const text = fs.readFileSync(path.join(__dirname, '..', '..', skillDir, 'SKILL.md'), 'utf8');
        if (text.includes('连续块')) problems.push(skillDir + ' 含「连续块」旧形态约束表述');
        if (text.includes('居首')) problems.push(skillDir + ' 含「居首」旧位置约束表述');
        if (!text.includes('depends_on')) problems.push(skillDir + ' 缺依赖图语义描述（depends_on）');
        if (!text.includes('用 Skill 工具')) problems.push(skillDir + ' 缺「用 Skill 工具」两层加载句式');
      }
      // —— ② 模板权威（重定向后的三件套）——成员面与整句锚点取自模块级常量（单一来源）：
      // 9 个既有成员 + 5 个 flow-kit 阶段协议技能 = 14 个真实成员（含 task）；受检面另加
      // 入口册与入口展开册（两者是「短指针」形态的既有持有者）。
      const templateAuthoritySkills = TEMPLATE_AUTHORITY_SKILLS;
      const templateAuthorityDocs = new Map();
      for (const skillDir of templateAuthoritySkills) {
        templateAuthorityDocs.set(skillDir + '/SKILL.md',
          fs.readFileSync(path.join(__dirname, '..', '..', skillDir, 'SKILL.md'), 'utf8'));
      }
      templateAuthorityDocs.set('flow-comet/SKILL.md', fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8'));
      templateAuthorityDocs.set('flow-comet/reference/entry-detail.md',
        fs.readFileSync(path.join(__dirname, '..', 'reference', 'entry-detail.md'), 'utf8'));
      problems.push(...templateAuthorityProblems(templateAuthorityDocs));
      // 反向构造（同一判据驱动，逐条对应重定向后的两侧）：
      // ① 同一册复制第二份锚行 ⇒ 必报「只允许 1 处」（重复回潮的同册形态）；
      // ② 权威目标改指别处 ⇒ 必报「未指向」（单一权威侧）；
      // ③ 同一段 ≥400 字符展开副本落进两份文档 ⇒ 必报「第二份展开正文」（正文唯一侧）；
      // ④ 抽掉某册锚句 ⇒ 必报该册缺声明（指针在场侧）。
      {
        const openRel = 'flow-comet-open/SKILL.md';
        const changeRel = 'flow-comet-change/SKILL.md';
        const openText = templateAuthorityDocs.get(openRel);
        const changeText = templateAuthorityDocs.get(changeRel);
        const anchorLine = openText.split(/\r?\n/).find((l) => l.includes('模板权威'));
        const expansion = '> **模板权威**：段形唯一权威 = `flow-kit/templates/**`；'
          + '（展开副本，反向构造探针）' + 'y'.repeat(TEMPLATE_AUTHORITY_BLOCK_SPAN) + '\n';
        const probes = [
          ['同册复制第二份锚行', new Map(templateAuthorityDocs).set(openRel, openText + '\n' + anchorLine + '\n'),
            '只允许 1 处'],
          ['权威目标改指别处', new Map(templateAuthorityDocs).set(openRel,
            openText.split('`flow-kit/templates/**`').join('`.specs/archive/**`')), '未指向'],
          ['展开副本落进两份文档', new Map(templateAuthorityDocs)
            .set(openRel, openText + '\n' + expansion)
            .set(changeRel, changeText + '\n' + expansion), '第二份展开正文'],
          ['抽掉某册锚句', new Map(templateAuthorityDocs).set(openRel,
            openText.split(anchorLine).join('（反向构造：抽掉锚句）')), '缺模板权威'],
        ];
        for (const [label, probed, expected] of probes) {
          if (!templateAuthorityProblems(probed).some((p) => p.includes(expected))) {
            problems.push('反向构造判别力缺失（模板权威: ' + label + ' 未被判违规）');
          }
        }
      }
      // 作者面完备性：持「模板权威」声明的技能树文本集合须**恰好**等于受检面（多出来的持锚文本
      // 是「第二份正文」的入口——例如某册偷偷加一条自己的权威声明）。
      {
        const expectedHolders = [...templateAuthorityDocs.keys()].sort();
        const actualHolders = skillTreeDocFiles()
          .filter(([, file]) => fs.readFileSync(file, 'utf8').includes('模板权威'))
          .map(([rel]) => rel)
          .sort();
        for (const rel of actualHolders) {
          if (!expectedHolders.includes(rel)) {
            problems.push(rel + ' 持有「模板权威」声明但不在受检面内（第二处权威声明的入口）');
          }
        }
        if (actualHolders.length !== expectedHolders.length) {
          problems.push('持模板权威声明的技能树文本数 ' + actualHolders.length
            + ' ≠ 受检面 ' + expectedHolders.length + '（实际: ' + actualHolders.join(', ') + '）');
        }
      }
      // —— 附：技能树正文的相对路径引用必须解析得到（本轮改名造成 5 册死引用而**零红灯**）——
      {
        const skillsRootAbs = path.join(__dirname, '..', '..');
        const treeDocs = new Map(skillTreeDocFiles().map(([rel, file]) => [rel, fs.readFileSync(file, 'utf8')]));
        problems.push(...skillTreeReferenceProblems(treeDocs, skillsRootAbs));
        // 反向构造（同一判据驱动）：① 把引用改写成不存在的目标 ⇒ 必报「解析不到」；
        // ② 抽掉引用 ⇒ 判据面收缩但**不误报**（证明判据只在引用在场时发声，不恒真）。
        const sampleEntry = [...treeDocs].find(([, text]) => SKILL_TREE_REFERENCE_RE.test(text));
        SKILL_TREE_REFERENCE_RE.lastIndex = 0;
        if (!sampleEntry) {
          problems.push('相对路径引用判据的前提不成立：技能树里找不到任何 reference/ 相对引用');
        } else {
          const [sampleRel, sampleText] = sampleEntry;
          const sampleRef = sampleText.match(SKILL_TREE_REFERENCE_RE)[0];
          const broken = new Map(treeDocs).set(sampleRel,
            sampleText.split(sampleRef).join('reference/renamed-away-fixture.md'));
          if (!skillTreeReferenceProblems(broken, skillsRootAbs).some((p) => p.includes('解析不到'))) {
            problems.push('反向构造判别力缺失（死引用未被判「解析不到」）: ' + sampleRel + ' → ' + sampleRef);
          }
          const dropped = new Map(treeDocs).set(sampleRel, sampleText.split(sampleRef).join(''));
          if (skillTreeReferenceProblems(dropped, skillsRootAbs).some((p) => p.startsWith(sampleRel))) {
            problems.push('相对路径引用判据误报（抽掉引用后仍报该册）: ' + sampleRel);
          }
        }
        // —— 附 2：成对展开文件的指针不得指错（上一条只证明目标**存在**，本条判**指对了**）——
        {
          const bookRels = [...treeDocs.keys()].filter((rel) => rel.endsWith('/SKILL.md')
            && !path.posix.dirname(rel).includes('/'));
          const hasOwnGuidance = (rel) => fs.existsSync(path.join(skillsRootAbs, path.posix.dirname(rel), 'GUIDANCE.md'));
          const pairedRels = bookRels.filter(hasOwnGuidance);
          const entryHasOwn = hasOwnGuidance(PAIRED_GUIDANCE_ENTRY_REL);
          // 前提：成对形态在场（否则判据空转）+ 入口册的例外目标在场（入口册无同名展开版时）。
          if (pairedRels.length === 0) {
            problems.push('成对指针判据的前提不成立：技能树里找不到任何带同目录 GUIDANCE.md 的册');
          }
          if (!entryHasOwn
            && !fs.existsSync(path.join(skillsRootAbs, path.posix.dirname(PAIRED_GUIDANCE_ENTRY_REL),
              PAIRED_GUIDANCE_ENTRY_TARGET))) {
            problems.push('成对指针判据的前提不成立：入口册展开版 ' + PAIRED_GUIDANCE_ENTRY_TARGET + ' 不在场（唯一例外无处指向）');
          }
          problems.push(...pairedGuidancePointerProblems(treeDocs, skillsRootAbs));
          // 反向构造（同一判据驱动）：① 带同目录 GUIDANCE 的册改指**入口册**展开版 ⇒ 必报「指错文档」；
          // ② 改指**另一册**的展开版 ⇒ 必报（另一侧形态，证明判据不靠"是否含 GUIDANCE.md 子串"恒真）；
          // ③ 入口册改指裸文件名 ⇒ 必报（唯一例外侧）；④ 抽掉指针 ⇒ 必报缺指针；⑤ 同册第二处指针 ⇒ 必报
          // 重复；⑥ 无配对展开版的册带指针 ⇒ 必报；⑦ 无配对展开版的册不带指针 ⇒ **零误报**（判据不恒真）。
          const pointerProbe = (rel, target) => new Map(treeDocs).set(rel,
            (treeDocs.get(rel) ?? '').replace(PAIRED_GUIDANCE_POINTER_RE,
              '<!-- 手写区详细协议见 ' + target + '（可选阅读） -->'));
          const probeRel = pairedRels.find((rel) => rel !== PAIRED_GUIDANCE_ENTRY_REL);
          const otherProbeRel = pairedRels.find((rel) => rel !== probeRel);
          const quietRel = bookRels.find((rel) => rel !== PAIRED_GUIDANCE_ENTRY_REL && !hasOwnGuidance(rel));
          const probeText = treeDocs.get(probeRel) ?? '';
          const pointerLine = probeText.match(PAIRED_GUIDANCE_POINTER_RE)?.[0] ?? '';
          if (!probeRel || !otherProbeRel || !quietRel || !pointerLine) {
            problems.push('成对指针反向构造的前提不成立：成对册不足两册 / 无无配对展开版的非入口册 / 探针册无指针行');
          } else {
            const probes = [
              ['册改指入口册展开版', pointerProbe(probeRel, '../flow-comet/reference/entry-detail.md'), '指错文档'],
              ['册改指另一册展开版', pointerProbe(probeRel,
                '../' + path.posix.dirname(otherProbeRel) + '/GUIDANCE.md'), '指错文档'],
              ['抽掉指针', new Map(treeDocs).set(probeRel, probeText.replace(PAIRED_GUIDANCE_POINTER_RE, '')),
                '缺「手写区详细协议见 …」指针'],
              ['同册第二处指针', new Map(treeDocs).set(probeRel, probeText + '\n' + pointerLine), '只允许 1 处'],
              ['无配对展开版的册带指针', new Map(treeDocs).set(quietRel,
                (treeDocs.get(quietRel) ?? '') + '\n' + pointerLine), '既无同目录 GUIDANCE.md 也非入口册'],
            ];
            if (!entryHasOwn) {
              probes.push(['入口册改指裸文件名', pointerProbe(PAIRED_GUIDANCE_ENTRY_REL, 'GUIDANCE.md'), '指错文档']);
            }
            for (const [label, probed, expected] of probes) {
              if (!pairedGuidancePointerProblems(probed, skillsRootAbs).some((p) => p.includes(expected))) {
                problems.push('反向构造判别力缺失（成对指针: ' + label + ' 未被判违规）');
              }
            }
          }
          if (!quietRel) {
            problems.push('成对指针反向构造的前提不成立：找不到无配对展开版的非入口册');
          } else if (pairedGuidancePointerProblems(new Map([[quietRel,
            (treeDocs.get(quietRel) ?? '').replace(PAIRED_GUIDANCE_POINTER_RE, '')]]), skillsRootAbs).length !== 0) {
            problems.push('成对指针判据误报（无配对展开版且不带指针的册被判违规）: ' + quietRel);
          }
        }
      }
      // —— 入口 archive 读法：三要素关键词在场 ——
      {
        const entry = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
        for (const keyword of ['flow-kit/templates', '何时可读', '不读什么']) {
          if (!entry.includes(keyword)) {
            problems.push('flow-comet/SKILL.md 缺「' + keyword + '」（入口 archive 读法三要素）');
          }
        }
      }
      // —— 规划约束：plan / task 判别句式 + GUIDANCE 委托消化 ——
      {
        const directLockPhrase = 'direct 不是并行任务的逃生口';
        const r15Keywords = {
          'flow-comet-plan': ['同一文件', '并发同伴', directLockPhrase],
          'flow-comet-task': ['同一文件', '并发同伴', directLockPhrase],
        };
        const planText = fs.readFileSync(path.join(__dirname, '..', '..', 'flow-comet-plan', 'SKILL.md'), 'utf8');
        const taskText = fs.readFileSync(path.join(__dirname, '..', '..', 'flow-comet-task', 'SKILL.md'), 'utf8');
        for (const [skillDir, keywords] of Object.entries(r15Keywords)) {
          const text = skillDir === 'flow-comet-plan' ? planText : taskText;
          for (const keyword of keywords) {
            if (!text.includes(keyword)) {
              problems.push(skillDir + '/SKILL.md 缺「' + keyword + '」（规划期约束判别句式）');
            }
          }
        }
        if (planText.includes('Same layer = same wave (parallel execution)')) {
          problems.push('flow-comet-plan/SKILL.md 残留「Same layer = same wave (parallel execution)」旧同层并行句');
        }
        if (!planText.includes('以本节为准')) {
          problems.push('flow-comet-plan/SKILL.md 缺「以本节为准」（上游宽松语义显式覆盖锚）');
        }
        if (taskText.includes('同层并行，跨层串行')) {
          problems.push('flow-comet-task/SKILL.md 残留「同层并行，跨层串行」旧波次句');
        }
        if (!taskText.includes('以本节点为准')) {
          problems.push('flow-comet-task/SKILL.md 缺「以本节点为准」（上游宽松语义显式覆盖锚）');
        }
        const guidanceRel = 'flow-comet/reference/entry-detail.md';
        const guidance = fs.readFileSync(path.join(__dirname, '..', 'reference', 'entry-detail.md'), 'utf8');
        if (!guidance.includes('仍必须由 subagent-execute 委托消化')) {
          problems.push(guidanceRel + ' 缺「仍必须由 subagent-execute 委托消化」（direct 委托消化判别句）');
        }
      }
      // —— ⑤ Codex 平台事实与支持面（**判别句随 `worktree-notes.md` 移出技能树而迁入
      // `reference/platform-facts.md`**，ADR-016）：判据 = 权威文件在场 + 判别句在权威处
      //（含被反驳引用形态、适用范围限定、fail-open / 未闭合的现判据）+ 各引用册指针在场 +
      // **判别句不再回流册子**（权威处唯一——原「两处各自须含」的逐字锁已作废）。
      {
        const platformFactsRel = 'flow-comet/reference/platform-facts.md';
        const factsFile = path.join(__dirname, '..', 'reference', 'platform-facts.md');
        const pointerBooks = [
          ['flow-comet-subagent-execute/SKILL.md', fs.readFileSync(path.join(__dirname, '..', '..', 'flow-comet-subagent-execute', 'SKILL.md'), 'utf8')],
          ['flow-comet-execute/SKILL.md', fs.readFileSync(path.join(__dirname, '..', '..', 'flow-comet-execute', 'SKILL.md'), 'utf8')],
          ['flow-comet/SKILL.md', fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8')],
        ];
        if (!fs.existsSync(factsFile)) {
          problems.push(platformFactsRel + ' 不在场（判别句的唯一权威处缺失——原 worktree-notes 的锚无处可寻）');
        } else {
          const facts = fs.readFileSync(factsFile, 'utf8');
          problems.push(...platformFactsAuthorityProblems(platformFactsRel, facts, pointerBooks));
          // 反向构造（同一判据驱动）：① 权威处逐条抽掉判别句 ⇒ 必报缺句；② 判别句回流任一册 ⇒ 必报
          //（「权威处唯一」——原逐字锁**要求**两处各持一份，恰恰抓不到回流）；③ 旧独断句 / 旧过宽句
          // 还原进权威处 ⇒ 必报残留。
          for (const phrase of [...PLATFORM_FACTS_ONLY_PHRASES, 'fail-open', '未闭合']) {
            const stripped = facts.split(phrase).join('（反向构造：抽掉）');
            if (stripped === facts) continue;
            if (!platformFactsAuthorityProblems(platformFactsRel, stripped, pointerBooks)
              .some((p) => p.includes(phrase.slice(0, 20)))) {
              problems.push('反向构造判别力缺失（平台事实: 抽掉「' + phrase.slice(0, 20) + '…」未被判缺失）');
            }
          }
          for (const phrase of PLATFORM_FACTS_ONLY_PHRASES) {
            const injected = pointerBooks.map(([rel, text]) => [rel, text + '\n' + phrase + '\n']);
            if (!platformFactsAuthorityProblems(platformFactsRel, facts, injected)
              .some((p) => p.includes('回流了平台事实的证据正文'))) {
              problems.push('反向构造判别力缺失（平台事实: 把证据正文复制回册子未被判违规）');
            }
          }
          const revertedFacts = platformFactsAuthorityProblems(platformFactsRel,
            facts + '\n受支持的工作流仍是串行执行。写入仍会被协调者白名单拦截。\n', pointerBooks);
          for (const label of ['旧独断句', '旧过宽句']) {
            if (!revertedFacts.some((p) => p.includes(label))) {
              problems.push('反向构造判别力缺失（平台事实: 还原' + label + '未被判残留）');
            }
          }
          const revertedClaimFacts = platformFactsAuthorityProblems(platformFactsRel,
            facts + '\n不使用并行委托。\n', pointerBooks);
          if (!revertedClaimFacts.some((p) => p.includes('非被反驳引用形态'))) {
            problems.push('反向构造判别力缺失（平台事实: 还原裸旧独断句未被判违规）');
          }
          if (!platformFactsAuthorityProblems(platformFactsRel, facts, [
            ...pointerBooks.slice(0, 1).map(([rel, text]) => [rel, text.split('`reference/platform-facts.md`').join('（反向构造：抽掉指针）')]),
            ...pointerBooks.slice(1),
          ]).some((p) => p.includes('引用册指针不在场'))) {
            problems.push('反向构造判别力缺失（平台事实: 抽掉引用册指针未被判违规）');
          }
        }
      }
      // —— ⑥ 三块归一处（ADR-016）：原「两册三块逐字一致（切片 ≥400 字符）+ 两册各持 41 条判别句」
      // 的逐字锁**作废**，改为「两册各自的要点句在场 + 权威处唯一 + 留正文的判别句逐句留原文但
      // **不再要求两册相同**」。归一处：pathspec 与集成 → `reference/commit-discipline.md` 全文；
      // 四属性契约 → 入口册 + `reference/platform-facts.md`。判别句按性质分流：属「该怎么干」的
      // 留两册正文（外部原则：非显然的坑留正文），属「证据与判级」的随平台事实移走。
      {
        const bookTexts = new Map([
          ['flow-comet-subagent-execute/SKILL.md', fs.readFileSync(path.join(__dirname, '..', '..', 'flow-comet-subagent-execute', 'SKILL.md'), 'utf8')],
          ['flow-comet-execute/SKILL.md', fs.readFileSync(path.join(__dirname, '..', '..', 'flow-comet-execute', 'SKILL.md'), 'utf8')],
        ]);
        const commitDisciplineText = fs.readFileSync(
          path.join(__dirname, '..', 'reference', 'commit-discipline.md'), 'utf8');
        const elementDocs = new Map([...bookTexts, [COMMIT_DISCIPLINE_REL, commitDisciplineText]]);
        const authorityTexts = new Map([
          [COMMIT_DISCIPLINE_REL, commitDisciplineText],
          [PLATFORM_FACTS_REL, fs.readFileSync(path.join(__dirname, '..', 'reference', 'platform-facts.md'), 'utf8')],
          ['flow-comet/SKILL.md', fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8')],
        ]);
        const disciplineSources = { books: bookTexts, elementDocs, authorityTexts };
        problems.push(...delegationDisciplineProblems(disciplineSources));
        // 反向构造（同一判据驱动）：逐条抽掉 ⇒ 必报；逐条回流 ⇒ 必报。判别力不依赖人工实验：
        // 要素级 token / 权威处判别句 / 能力契约判别句 / 条件句指针 / 证据与判级判别句五组各取全量。
        const subRel = 'flow-comet-subagent-execute/SKILL.md';
        const exRel = 'flow-comet-execute/SKILL.md';
        const strip = (text, phrase) => text.split(phrase).join('（反向构造：抽掉）');
        const withBook = (rel, text) => ({ ...disciplineSources, books: new Map(bookTexts).set(rel, text) });
        const withElementDoc = (rel, text) => ({ ...disciplineSources, elementDocs: new Map(elementDocs).set(rel, text) });
        const withAuthority = (rel, text) => ({ ...disciplineSources, authorityTexts: new Map(authorityTexts).set(rel, text) });
        for (const [label, tokens] of COMMIT_DISCIPLINE_ELEMENT_GROUPS) {
          const stripped = strip(elementDocs.get(subRel), tokens[0]);
          if (stripped === elementDocs.get(subRel)) continue;
          if (!delegationDisciplineProblems(withElementDoc(subRel, stripped)).some((p) => p.includes(label))) {
            problems.push('反向构造判别力缺失（' + label + ' 的要点 token 被抽掉未被判缺）');
          }
        }
        for (const phrase of COMMIT_DISCIPLINE_AUTHORITY_PHRASES) {
          if (!commitDisciplineText.includes(phrase)) continue; // 缺失已由真实判据报告
          if (!delegationDisciplineProblems(withAuthority(COMMIT_DISCIPLINE_REL, strip(commitDisciplineText, phrase)))
            .some((p) => p.includes(phrase.slice(0, 40)))) {
            problems.push('反向构造判别力缺失（抽掉 ' + COMMIT_DISCIPLINE_REL + ' 权威处判别句未被判缺）: '
              + phrase.slice(0, 40) + '…');
          }
          if (!delegationDisciplineProblems(withBook(subRel, bookTexts.get(subRel) + '\n' + phrase + '\n'))
            .some((p) => p.includes('回流了'))) {
            problems.push('反向构造判别力缺失（权威处正文回流册子未被判违规）: ' + phrase.slice(0, 40) + '…');
          }
        }
        for (const phrase of PARALLEL_CONTRACT_BOOK_PHRASES) {
          if (!bookTexts.get(exRel).includes(phrase)) continue;
          if (!delegationDisciplineProblems(withBook(exRel, strip(bookTexts.get(exRel), phrase)))
            .some((p) => p.includes(phrase.slice(0, 40)))) {
            problems.push('反向构造判别力缺失（抽掉四属性契约判别句未被判缺）: ' + phrase.slice(0, 40) + '…');
          }
        }
        for (const pointer of DELEGATION_POINTER_RELS) {
          const stripped = bookTexts.get(subRel).split(pointer).join('（反向构造：抽掉指针）');
          if (!delegationDisciplineProblems(withBook(subRel, stripped)).some((p) => p.includes('指针不在场'))) {
            problems.push('反向构造判别力缺失（抽掉条件句指针未被判违规）: ' + pointer);
          }
        }
        for (const phrase of CONTRACT_EVIDENCE_AUTHORITY_PHRASES) {
          if (!authorityTexts.get(PLATFORM_FACTS_REL).includes(phrase)) continue;
          if (!delegationDisciplineProblems(withAuthority(PLATFORM_FACTS_REL,
            strip(authorityTexts.get(PLATFORM_FACTS_REL), phrase))).some((p) => p.includes(phrase.slice(0, 40)))) {
            problems.push('反向构造判别力缺失（抽掉证据与判级判别句未被判缺）: ' + phrase.slice(0, 40) + '…');
          }
          if (!delegationDisciplineProblems(withBook(subRel, bookTexts.get(subRel) + '\n' + phrase + '\n'))
            .some((p) => p.includes('回流了证据与判级判别句'))) {
            problems.push('反向构造判别力缺失（证据与判级判别句回流册子未被判违规）: ' + phrase.slice(0, 40) + '…');
          }
        }
        // 旧表述零残留（原文语义与失败消息保持）：无条件 worktree 口号只允许以「已作废」的被反驳
        // 形态出现；「未获机制明文放行」现状表述一律清零（集成纪律已成文）。配逐条反向构造。
        const staleResidueProblems = (rel, text) => {
          const out = [];
          if (text.split('「一律 worktree」的口号已作废').join('').includes('一律 worktree')) {
            out.push(rel + ' 残留无条件 worktree 口号（非被反驳形态）');
          }
          if (text.includes('未获机制明文放行')) {
            out.push(rel + ' 残留「未获机制明文放行」现状表述（集成纪律已成文）');
          }
          return out;
        };
        for (const [rel, text] of bookTexts) {
          problems.push(...staleResidueProblems(rel, text));
          const revertedSlogan = text.split('「一律 worktree」的口号已作废').join('一律 worktree 是必须的');
          if (!staleResidueProblems(rel, revertedSlogan).some((p) => p.includes('无条件 worktree 口号'))) {
            problems.push(rel + ' 反向构造判别力缺失（还原无条件 worktree 口号未被判违规）');
          }
          const revertedStatus = text + '\n未获机制明文放行。\n';
          if (!staleResidueProblems(rel, revertedStatus).some((p) => p.includes('未获机制明文放行'))) {
            problems.push(rel + ' 反向构造判别力缺失（还原现状表述未被判违规）');
          }
        }
        // —— ⑦ CC 行判级升格 + 三平台 cwd 语义对照（真机实测落地）——重定向后判据 = 「权威处
        // 正文在场 + 各引用册指针在场 + **仅两处承载**」：入口册的 7 条字面量是**能力契约锚**（本
        // 批明文保留），原 `reference/worktree-notes.md` 的 6 条整句随文件移出技能树而改锚到
        // `reference/platform-facts.md`（T07 逐字搬入）；两组文本都不得散进其余册（唯一处 = 入口册
        // + 平台事实册）。锚一律取**段内独有判别句式**（裸子串会被同文件其它上下文满足而恒真——
        // `L-106`）；cwd 对照表**逐行有锚**（三行各自独立，缺任一行即判残缺）；旧「未覆盖」判级句零残留。
        const entrySkillText = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
        const platformFactsText = fs.readFileSync(path.join(__dirname, '..', 'reference', 'platform-facts.md'), 'utf8');
        const otherBooks = new Map([
          ['flow-comet-subagent-execute/SKILL.md', bookTexts.get('flow-comet-subagent-execute/SKILL.md')],
          ['flow-comet-execute/SKILL.md', bookTexts.get('flow-comet-execute/SKILL.md')],
        ]);
        for (const [, file] of skillTreeDocFiles()) {
          const rel = path.relative(path.join(__dirname, '..', '..'), file).replaceAll('\\', '/');
          if (rel === 'flow-comet/SKILL.md' || rel === 'flow-comet/reference/platform-facts.md') continue;
          if (otherBooks.has(rel)) continue;
          otherBooks.set(rel, fs.readFileSync(file, 'utf8'));
        }
        const upgradeSources = { entry: entrySkillText, facts: platformFactsText, others: otherBooks };
        problems.push(...identityUpgradeProblems(upgradeSources));
        // 反向构造（同一判据驱动）：① 权威处 / 入口册逐句抽掉 ⇒ 必报该句缺失；② 把整句复制进
        // 其余任一册 ⇒ 必报「回流」（唯一处的方向——原两处锁**要求**多份，抓不到散播）；③ 旧判级
        // 句还原 ⇒ 必报残留。
        for (const [side, phrase] of [
          ...IDENTITY_UPGRADE_ENTRY_PHRASES.map((p) => ['entry', p]),
          ...IDENTITY_UPGRADE_AUTHORITY_PHRASES.map((p) => ['facts', p]),
        ]) {
          const source = side === 'entry' ? entrySkillText : platformFactsText;
          if (!source.includes(phrase)) continue; // 缺失已由真实判据报告
          const stripped = identityUpgradeProblems({
            ...upgradeSources, [side]: source.split(phrase).join('（反向构造：抽掉）'),
          });
          if (!stripped.some((p) => p.includes(phrase.slice(0, 40)))) {
            problems.push('反向构造判别力缺失（抽掉「CC 行升格 / 三平台 cwd 对照」判别句未被判缺）: '
              + phrase.slice(0, 40) + '…');
          }
        }
        const injectedBookRel = 'flow-comet-subagent-execute/SKILL.md';
        for (const phrase of [...IDENTITY_UPGRADE_ENTRY_PHRASES, ...IDENTITY_UPGRADE_AUTHORITY_PHRASES]) {
          const injected = identityUpgradeProblems({
            ...upgradeSources,
            others: new Map(otherBooks).set(injectedBookRel, otherBooks.get(injectedBookRel) + '\n' + phrase + '\n'),
          });
          if (!injected.some((p) => p.includes('回流'))) {
            problems.push('反向构造判别力缺失（cwd 对照 / CC 判级句散进其余册未被判违规）: ' + phrase.slice(0, 40) + '…');
          }
        }
        for (const stale of IDENTITY_UPGRADE_STALE_PHRASES) {
          const revertedUpgrade = identityUpgradeProblems({
            ...upgradeSources,
            entry: entrySkillText + '\n' + stale + '。\n',
            facts: platformFactsText + '\n' + stale + '。\n',
          });
          if (!revertedUpgrade.some((p) => p.includes('旧「未覆盖」判级表述'))) {
            problems.push('反向构造判别力缺失（还原旧「未覆盖」判级句未被判残留）: ' + stale);
          }
        }
        // —— 文本 ↔ 实现一致锚：文本点名的实现常量 / 载荷键名 / 受保护目标必须与引擎同值 ——
        const guardSrc = fs.readFileSync(path.join(__dirname, 'comet-hook-guard.mjs'), 'utf8');
        // 桥接源位于**仓库根** scripts/（分发面脚本，非技能包内）——安装副本形态（目标项目）该面
        // 结构性缺席：缺席时该侧锚不适用，但必须**显式可见**（未验证 ≠ 通过），不得静默跳过。
        const bridgePath = path.join(REPO_ROOT, 'scripts', 'dsh-bridge.mjs');
        const bridgeSrc = fs.existsSync(bridgePath) ? fs.readFileSync(bridgePath, 'utf8') : null;
        if (bridgeSrc === null) {
          console.log('SKIP: 184 的桥接侧一致锚（仓库根 scripts/dsh-bridge.mjs 为权威源检出面）'
            + '——本次未校验「文本点名的身份透传变量与桥接注入处同值」，请在权威源检出重跑本套件');
        }
        const stateSchemaSrc = fs.readFileSync(path.join(__dirname, 'state-schema.mjs'), 'utf8');
        const handoffSrc = fs.readFileSync(path.join(__dirname, 'workflow-handoff.mjs'), 'utf8');
        // 出口校验（节点门禁）脚本的另一册：在飞委托判据落在 workflow-guard.mjs（hook 守卫只做写入
        // 拦截，两者同包不同册）——撤回留痕被判据消费这一条须在**该**源上核对。
        const workflowGuardSrc = fs.readFileSync(path.join(__dirname, 'workflow-guard.mjs'), 'utf8');
        // 一致性判据（单一实现：真实判据与反向构造探针共用本函数）。
        const consistencyProblems = ({ guard, bridge, schema, handoff, workflowGuard, books }) => {
          const out = [];
          // ① 身份判据的载荷键：文本声称判据 = agent_id；引擎身份判据段必须读取该键。
          const regionStart = guard.indexOf('function payloadAgentIdentity');
          const regionEnd = guard.indexOf('const __dirname');
          if (regionStart < 0 || regionEnd <= regionStart) {
            out.push('comet-hook-guard.mjs 未找到身份判据段（文本与实现无法对照）');
          } else {
            const identityRegion = guard.slice(regionStart, regionEnd);
            if (!identityRegion.includes('input.agent_id')) {
              out.push('身份判据段未读取载荷 agent_id（文本声称的判据键与实现不一致）');
            }
            // ② agent_type 只是载荷形态描述、不是判据：身份判据段零使用（文本与实现逐字一致）。
            if (identityRegion.includes('agent_type')) {
              out.push('身份判据段使用了 agent_type（文本声称判据 = agent_id，二者不一致）');
            }
          }
          // ③ 身份透传的环境变量名单一：守卫读取处与桥接注入处同值（文本两侧同值）。
          if (!guard.includes('process.env.FLOW_COMET_AGENT_DEPTH')) {
            out.push('守卫未读取环境变量身份深度（与文本 / 桥接不一致）');
          }
          if (bridge === null) {
            // 结构性缺席（安装副本形态无仓库根 scripts/）：该侧锚不适用——可见 SKIP 由场景主体输出，
            // 此处不判违规也不静默当通过（未验证 ≠ 通过）。
          } else if (!bridge.includes('FLOW_COMET_AGENT_DEPTH')) {
            out.push('桥接未透传环境变量身份深度（与文本 / 守卫不一致）');
          }
          // ③b 桥接通道标记的名单一与值单一（env 面身份的作用域收紧）：守卫读取处、守卫判据常量、
          //     桥接注入处三处同值；缺任一处即「文本声称需标记自证、实现却直接认深度」的分叉。
          //     文本侧的判据由两册同锁块承载（见上方 contractLockPhrases 的标记判别句）。
          if (!guard.includes('process.env.FLOW_COMET_AGENT_DEPTH_SOURCE')) {
            out.push('守卫未读取桥接通道标记（env 面身份的作用域收紧无实现承载）');
          }
          if (!guard.includes("BRIDGE_DEPTH_CHANNEL_MARKER = 'dsh-bridge'")) {
            out.push('守卫缺桥接通道标记的判据常量（标记值无单一来源）');
          }
          if (bridge === null) {
            // 同上：安装副本形态无仓库根 scripts/，该侧锚不适用。
          } else if (!/FLOW_COMET_AGENT_DEPTH_SOURCE:\s*'dsh-bridge'/.test(bridge)) {
            out.push('桥接未注入桥接通道标记 ' + "'dsh-bridge'" + '（守卫要求标记在场，桥接不注入即通道失效）');
          }
          // ③c 撤回留痕的字段名与判据落点：文本点名的两个字段由单一实现判定，且守卫的在飞判据
          //     必须消费该实现（缺一即「文本说撤回可放行、实现仍按在飞拦」）。
          if (!schema.includes('withdrawnAt') || !schema.includes('withdrawnBy')) {
            out.push('撤回留痕字段名未落在单一判据实现（与文本声称的 withdrawnAt / withdrawnBy 不一致）');
          }
          if (!/handoffRequestWithdrawn\(requests\[taskId\]\)/.test(workflowGuard)) {
            out.push('在飞委托判据未消费撤回留痕判据（撤回的 request 仍会被计为在飞）');
          }
          // ④ 最小保护集的两个目标：实现侧取值来源（状态文件路径常量 + 协议解析结果）与文本字面同值。
          if (!schema.includes("RUNTIME_DIR = '.flow-comet'")
            || !schema.includes("RUNTIME_STATE_FILE_NAME = 'flow-comet-state.json'")) {
            out.push('状态文件路径常量与文本声称的受保护目标不一致');
          }
          if (!guard.includes('blockedStateFileTarget') || !guard.includes('blockedProtocolFileTarget')) {
            out.push('守卫缺最小保护集判定入口（文本声称的两个受保护目标无实现承载）');
          }
          // ⑤ 留痕字段与落点：文本点名的既有字段 = 实现写入的嵌套键（零新增 state 顶层字段）。
          if (!handoff.includes("state.evidence['subagent-execute'].handoffRequests")) {
            out.push('留痕未落在嵌套证据（与文本声称的同族嵌套形态不一致）');
          }
          // ⑥ 零提交资格字段与落库形态：文本声称「提交隔离走既有 noCommit 资格」——实现必须在
          //    request 侧真实记录该字段（文本说 A、实现说 B 即红）。
          if (!handoff.includes('noCommit: true')) {
            out.push('零提交资格落库形态与文本声称的 request 记录不一致（缺 noCommit: true）');
          }
          for (const [rel, text] of books) {
            if (!text.includes('.flow-comet/flow-comet-state.json')) {
              out.push(rel + ' 缺最小保护集目标字面（机器状态文件）');
            }
            if (!text.includes('reference/workflow-protocol.json')) {
              out.push(rel + ' 缺最小保护集目标字面（协议保护路径）');
            }
            if (!text.includes('handoffRequests') || !text.includes('handoffResult')) {
              out.push(rel + ' 缺留痕字段名（handoffRequests / handoffResult）');
            }
            if (!text.includes('noCommit')) {
              out.push(rel + ' 缺零提交资格字段名（noCommit）');
            }
            // 桥接通道标记名（env 面身份的作用域收紧）：两册文本须点名标记本身——只说「env 透传
            // 深度」会让读者以为继承来的深度变量也能当身份用（正是收紧前的缺口表述）。
            if (!text.includes('FLOW_COMET_AGENT_DEPTH_SOURCE')) {
              out.push(rel + ' 缺桥接通道标记名（文本声称 env 面身份需标记自证，却未点名标记）');
            }
          }
          return out;
        };
        const consistencySources = { guard: guardSrc, bridge: bridgeSrc, schema: stateSchemaSrc, handoff: handoffSrc, workflowGuard: workflowGuardSrc, books: bookTexts };
        problems.push(...consistencyProblems(consistencySources));
        // 反向构造（同一判据驱动）：逐项把实现侧常量改成与文本不同的值 ⇒ 必报（文本说 A、实现说 B 即红）。
        const consistencyProbes = [
          ['载荷键改名', { guard: guardSrc.replace('input.agent_id', 'input.agentId') }, 'agent_id'],
          ['agent_type 混入判据段', {
            guard: guardSrc.replace('function payloadAgentIdentity',
              "function payloadAgentIdentity(input) { const probe = input.agent_type;\n"),
          }, 'agent_type'],
          ['环境变量改名', { guard: guardSrc.replaceAll('FLOW_COMET_AGENT_DEPTH', 'FLOW_COMET_DEPTH') }, '环境变量身份深度'],
          // 桥接通道标记（env 面身份的作用域收紧）与撤回通道：逐项抽掉实现侧或文本侧的承载 ⇒ 必报。
          ['桥接标记读取抽掉', { guard: guardSrc.replaceAll('process.env.FLOW_COMET_AGENT_DEPTH_SOURCE', 'process.env.FLOW_COMET_DEPTH_SOURCE') }, '桥接通道标记'],
          ['桥接标记判据常量改名', { guard: guardSrc.replace("BRIDGE_DEPTH_CHANNEL_MARKER = 'dsh-bridge'", "BRIDGE_DEPTH_CHANNEL_MARKER = 'bridge'") }, '标记值无单一来源'],
          // 桥接源在安装副本形态结构性缺席（见上方 SKIP 行）：该探针不构造——未验证 ≠ 通过，
          // 由 SKIP 行显式声明；不构造也不得让整块判据崩掉（缺席面不得变成套件错误）。
          ...(bridgeSrc === null ? [] : [['桥接注入标记值漂移', { bridge: bridgeSrc.replaceAll("FLOW_COMET_AGENT_DEPTH_SOURCE: 'dsh-bridge'", "FLOW_COMET_AGENT_DEPTH_SOURCE: 'other'") }, '桥接未注入桥接通道标记']]),
          ['撤回留痕字段改名', { schema: stateSchemaSrc.replaceAll('withdrawnBy', 'cancelledBy') }, '撤回留痕字段名未落在单一判据实现'],
          ['在飞判据不消费撤回留痕', { workflowGuard: workflowGuardSrc.replace('handoffRequestWithdrawn(requests[taskId])', 'false') }, '在飞委托判据未消费撤回留痕判据'],
          ['文本侧桥接标记名缺失', { books: new Map([...bookTexts].map(([rel, text]) => [rel, text.split('FLOW_COMET_AGENT_DEPTH_SOURCE').join('（反向构造：抽掉）')])) }, '桥接通道标记名'],
          ['状态文件路径常量改名', { schema: stateSchemaSrc.replace("RUNTIME_STATE_FILE_NAME = 'flow-comet-state.json'", "RUNTIME_STATE_FILE_NAME = 'state.json'") }, '状态文件路径常量'],
          ['留痕落点改顶层', { handoff: handoffSrc.replaceAll("state.evidence['subagent-execute'].handoffRequests", 'state.handoffRequests') }, '留痕未落在嵌套证据'],
          ['零提交落库形态改名', { handoff: handoffSrc.replaceAll('noCommit: true', 'zeroCommitFlag: true') }, '零提交资格落库形态'],
          ['文本侧目标字面缺失', { books: new Map([...bookTexts].map(([rel, text]) => [rel, text.split('.flow-comet/flow-comet-state.json').join('（反向构造：抽掉）')])) }, '机器状态文件'],
          ['文本侧零提交字段缺失', { books: new Map([...bookTexts].map(([rel, text]) => [rel, text.split('noCommit').join('（反向构造：抽掉）')])) }, '零提交资格字段名'],
        ];
        for (const [probeLabel, override, expected] of consistencyProbes) {
          const probed = { ...consistencySources, ...override };
          if (!consistencyProblems(probed).some((p) => p.includes(expected))) {
            problems.push('反向构造判别力缺失（' + probeLabel + ' 未被判不一致）');
          }
        }
      }
      // —— 7 字段集合的文本 ↔ 实现一致锚（文本不得说谎的**根治**面：任一处枚举分叉即红）——
      // 判据与反向构造探针见模块级 `task7SetAnchorProblems`（单一实现）：唯一权威 = `workflow-guard.mjs`
      // 的 `TASK7_REQUIRED` 常量（plan 出口判据的集合来源），技能树侧枚举**从该常量派生**后逐处对账——
      // 锚里不写第二份集合（第二份同口径表达会在判据演进时分叉，`LESSONS` L-067）；覆盖双语形态与斜杠
      // 枚举形态，同批固化「文案落后于判据」静默面（两处 BLOCKED 文案从判据常量派生）。反向构造（L-106）：
      // 任一处枚举改字段名（depends_on → id）/ 抽掉整处枚举 / 常量侧改名 / 文案回写字面集合 ⇒ 必红。
      problems.push(...task7SetAnchorProblems({
        guardSrc: fs.readFileSync(path.join(__dirname, 'workflow-guard.mjs'), 'utf8'),
        stateSrc: fs.readFileSync(path.join(__dirname, 'workflow-state.mjs'), 'utf8'),
        docs: new Map(skillTreeDocFiles().map(([rel, file]) => [rel, fs.readFileSync(file, 'utf8')])),
      }));
      // —— 公开面口径机检（文档不说假话）：公开机制册的判级须与技能册一致、公开变更日志的新增
      //    条目须带**编号** PR 链接、技能册的已关闭缺口与建树适用面须写成本文。三面各自可判，
      //    并配反向构造（抽掉新表述 / 还原旧表述 ⇒ 必报）。公开面在安装副本形态结构性缺席：
      //    缺席时输出可见 SKIP（未验证 ≠ 通过），不得静默当通过。
      {
        const publicDocRelPaths = ['docs/MECHANISM.md', 'docs/MECHANISM-zh.md', 'CHANGELOG.md', 'CHANGELOG-zh.md'];
        const publicDocs = new Map(publicDocRelPaths.map((rel) => {
          const abs = path.join(REPO_ROOT, rel);
          return [rel, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null];
        }));
        const missingDocFaces = [...publicDocs].filter(([, text]) => text === null).map(([rel]) => rel);
        if (missingDocFaces.length > 0) {
          console.log('SKIP: 184 的公开面口径锚（' + missingDocFaces.join(', ') + '）——本次检出无该公开文档面，'
            + '未校验「公开机制册判级与技能册一致 / 变更日志新增条目链接带编号 / 建树适用面成文」，请在权威源检出重跑本套件');
        }
        const subagentFaceText = fs.readFileSync(
          path.join(__dirname, '..', '..', 'flow-comet-subagent-execute', 'SKILL.md'), 'utf8');
        const entryFaceText = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
        // 第三面随 `worktree-notes.md` 移出技能树改读 `reference/platform-facts.md`（判别句新落点）。
        const factsFaceText = fs.readFileSync(path.join(__dirname, '..', 'reference', 'platform-facts.md'), 'utf8');
        const treeScopeSentence = '**建树选择的适用面**';
        const treeBypassSentence = '**以建树绕过边界**不受支持';
        const staleTreeBan = '手工 `git worktree add <任意路径>` **不是受支持路径**';
        const gapClosureSentence = '该缺口现已被守卫关闭';
        // 公开变更日志的 Unreleased 段切片（止于下一个版本标题）。
        const unreleasedSectionOf = (text) => {
          const start = text.indexOf('## [Unreleased]');
          if (start < 0) return null;
          const next = text.indexOf('\n## [', start + 1);
          return text.slice(start, next < 0 ? text.length : next);
        };
        // 一致性判据（单一实现：真实判据与反向构造探针共用本函数）。
        const publicFaceProblems = ({ mechanism, mechanismZh, changelog, changelogZh, subagentBook, entryBook, factsBook }) => {
          const out = [];
          // 公开机制册双语判级：CC 行「证实 + 限定形态」，未覆盖项照旧标注，旧判级句零残留。
          const gradeCases = [
            ['docs/MECHANISM.md', mechanism,
              'payload `agent_id` / `agent_type` — **verified**, in a stated shape only',
              ['`agent_type`', 'nested delegations', 'non-Windows environments', 'remain uncovered'],
              'payload `agent_id` — **not yet covered**'],
            ['docs/MECHANISM-zh.md', mechanismZh,
              '载荷 `agent_id` / `agent_type`——**证实**，且**限定形态**',
              ['`agent_type` 取值域', '嵌套委派载荷', '非 Windows 环境', '仍未覆盖'],
              '载荷 `agent_id`——真机会话**尚未覆盖**'],
          ];
          for (const [rel, text, phrase, keep, stale] of gradeCases) {
            if (text === null) continue;
            if (!text.includes(phrase)) out.push(rel + ' 未把 CC 身份通道标为证实（缺判别句：' + phrase.slice(0, 30) + '…）');
            for (const item of keep) {
              if (!text.includes(item)) out.push(rel + ' 判级升格时丢了限定形态 / 未覆盖项（缺「' + item + '」）');
            }
            if (text.includes(stale)) out.push(rel + ' 残留旧判级表述「' + stale + '」');
          }
          // 公开变更日志：Unreleased 段内条目数与带编号 PR 链接数一致，且不得有空链接。
          for (const [rel, text] of [['CHANGELOG.md', changelog], ['CHANGELOG-zh.md', changelogZh]]) {
            if (text === null) continue;
            const section = unreleasedSectionOf(text);
            if (section === null) { out.push(rel + ' 缺 Unreleased 段（新增条目无处登记）'); continue; }
            const entries = (section.match(/^- /gm) ?? []).length;
            const numbered = (section.match(/\/pull\/\d+/g) ?? []).length;
            const bare = (section.match(/\/pull\/\)/g) ?? []).length;
            if (bare > 0) out.push(rel + ' 新增条目含空 PR 链接（pull/ 无编号）×' + bare);
            if (entries > 0 && numbered !== entries) {
              out.push(rel + ' 新增条目与带编号 PR 链接数不一致（条目 ' + entries + ' / 链接 ' + numbered + '）');
            }
          }
          // 已关闭缺口：**权威处**（`reference/platform-facts.md`）的陈旧注释须以「已关闭 + 当前判据」
          // 形态在场（边界陈述保留）；两册**不得**再持该证据段正文（随平台事实移走——回流即红）。
          const gapCases = [
            [PLATFORM_FACTS_REL, factsBook, ['**fail-open**', '**未闭合**', '补丁体按行语义解析出']],
          ];
          for (const [rel, text, keep] of gapCases) {
            if (text === null) continue;
            if (!text.includes(gapClosureSentence)) {
              out.push(rel + ' 未把已关闭的守卫缺口写成本文（缺「' + gapClosureSentence + '」——陈旧注释仍在描述现状）');
            }
            for (const item of keep) {
              if (!text.includes(item)) out.push(rel + ' 已关闭缺口的当前判据 / 边界陈述缺失（缺「' + item + '」）');
            }
          }
          for (const [rel, text] of [['flow-comet-subagent-execute/SKILL.md', subagentBook]]) {
            if (text === null) continue;
            if (text.includes(gapClosureSentence)) {
              out.push(rel + ' 回流了已关闭缺口的证据段正文（缺「' + gapClosureSentence + '」段的权威处唯一）');
            }
          }
          // 建树适用面：三处同写「显式建树受支持 / 以建树绕过边界不受支持」（能力契约锚，ADR-016 保留），
          // 旧一刀切禁令零残留。
          for (const [rel, text] of [
            ['flow-comet/SKILL.md', entryBook],
            ['flow-comet-subagent-execute/SKILL.md', subagentBook],
            [PLATFORM_FACTS_REL, factsBook],
          ]) {
            if (text === null) continue;
            if (!text.includes(treeScopeSentence)) out.push(rel + ' 未写清建树适用面（缺「' + treeScopeSentence + '」）');
            if (!text.includes(treeBypassSentence)) out.push(rel + ' 未写清绕过面边界（缺「' + treeBypassSentence + '」）');
            if (text.includes(staleTreeBan)) {
              out.push(rel + ' 残留一刀切禁令「' + staleTreeBan + '…」（与入口册平台通道表口径相反）');
            }
          }
          return out;
        };
        // 面缺席（安装副本形态）时的 null 安全改写：缺席面既无真实判据也无反向构造，
        // 由上方 SKIP 行显式声明未验证；探针循环再跳过含缺席面的探针（不静默当通过）。
        const patchText = (text, from, to) => (text === null ? null : text.split(from).join(to));
        const publicFaceSources = {
          mechanism: publicDocs.get('docs/MECHANISM.md'),
          mechanismZh: publicDocs.get('docs/MECHANISM-zh.md'),
          changelog: publicDocs.get('CHANGELOG.md'),
          changelogZh: publicDocs.get('CHANGELOG-zh.md'),
          subagentBook: subagentFaceText,
          entryBook: entryFaceText,
          factsBook: factsFaceText,
        };
        problems.push(...publicFaceProblems(publicFaceSources));
        // 反向构造（同一判据驱动）：逐项抽掉新表述 / 还原旧表述 ⇒ 必报该问题。
        const publicFaceProbes = [
          ['公开册判级回退', {
            mechanism: patchText(publicFaceSources.mechanism, 'payload `agent_id` / `agent_type` — **verified**, in a stated shape only', 'payload `agent_id` — **not yet covered** in a real session, in a stated shape only'),
            mechanismZh: patchText(publicFaceSources.mechanismZh, '载荷 `agent_id` / `agent_type`——**证实**，且**限定形态**', '载荷 `agent_id`——真机会话**尚未覆盖**，且**限定形态**'),
          }, '残留旧判级表述'],
          ['公开册限定形态抽掉', {
            mechanism: patchText(publicFaceSources.mechanism, 'nested delegations', 'REMOVED'),
            mechanismZh: patchText(publicFaceSources.mechanismZh, '嵌套委派载荷', 'REMOVED'),
          }, '丢了限定形态'],
          ['变更日志链接编号抽掉', {
            changelog: patchText(publicFaceSources.changelog, '/pull/145', '/pull/'),
            changelogZh: patchText(publicFaceSources.changelogZh, '/pull/145', '/pull/'),
          }, '空 PR 链接'],
          ['已关闭缺口注解抽掉', {
            factsBook: publicFaceSources.factsBook.split(gapClosureSentence).join('REMOVED'),
          }, '未把已关闭的守卫缺口写成本文'],
          ['已关闭缺口证据回流册子', {
            subagentBook: publicFaceSources.subagentBook + '\n' + gapClosureSentence + '：补丁体按行语义解析出。\n',
          }, '回流了已关闭缺口的证据段正文'],
          ['建树适用面句抽掉', {
            entryBook: publicFaceSources.entryBook.split(treeScopeSentence).join('REMOVED'),
            subagentBook: publicFaceSources.subagentBook.split(treeScopeSentence).join('REMOVED'),
            factsBook: publicFaceSources.factsBook.split(treeScopeSentence).join('REMOVED'),
          }, '未写清建树适用面'],
          ['旧一刀切禁令还原', {
            subagentBook: publicFaceSources.subagentBook + '\n' + staleTreeBan + '，不得作为绕过手段。\n',
          }, '残留一刀切禁令'],
        ];
        for (const [probeLabel, override, expected] of publicFaceProbes) {
          const probed = { ...publicFaceSources, ...override };
          // 含缺席面的探针不执行（该面既无真实判据也无反向构造）——上方 SKIP 行已显式声明未验证。
          if (Object.values(probed).some((value) => value === null)) continue;
          if (!publicFaceProblems(probed).some((problem) => problem.includes(expected))) {
            problems.push('公开面口径反向构造判别力缺失（' + probeLabel + ' 未被判违规）');
          }
        }
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
      // ⑧ 便携复制锚：源路径含非 ASCII 字符时仍能完整复制技能树——旧实现用 fs.cpSync，在 Windows 上
      // 会让进程静默崩溃（中文路径项目内本套件曾中断于本场景）。比对用「相对路径 + 条目类型 +
      // 内容哈希（文件）/ 链接目标（符号链接）」全量清单：只比条目数会放过「少一个、多一个改名」
      // 这类等数错误，也无法发现内容被改写。
      {
        const cjkSource = path.join(dir, '源-中文-技能树');
        const cjkTarget = path.join(dir, '复制-目标');
        copyTreePortable(path.join(__dirname, '..'), cjkSource);
        copyTreePortable(cjkSource, cjkTarget);
        const listTree = (root, base = '', out = []) => {
          for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            const rel = base ? base + '/' + entry.name : entry.name;
            const full = path.join(root, entry.name);
            if (entry.isDirectory()) listTree(full, rel, out);
            else if (entry.isSymbolicLink()) out.push('link ' + rel + ' -> ' + fs.readlinkSync(full));
            else out.push('file ' + rel + ' ' + createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
          }
          return out.sort();
        };
        const expected = listTree(path.join(__dirname, '..'));
        const actual = listTree(cjkTarget);
        if (expected.length !== actual.length) {
          throw new Error('非 ASCII 源路径的递归复制条目数不一致：期望 ' + expected.length + '，实际 ' + actual.length);
        }
        for (let i = 0; i < expected.length; i += 1) {
          if (expected[i] !== actual[i]) {
            throw new Error('非 ASCII 源路径的递归复制内容不一致（第 ' + (i + 1) + ' 项）：期望 ' + expected[i] + '，实际 ' + actual[i]);
          }
        }
      }
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
        const nextRes = runStateWithProtocol(dir, ['next']);
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
      const nextRes = runStateWithProtocol(dir, ['next']);
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
      // 子断言（发布同步守卫）：权威源 loader 的标记行、导出常量与载体 INSTALLED_VERSION
      // 三处按 **bridge-check 既有语义**比较（MECHANISM 二·二十七「bridge-check 基础版本归一」：
      // 剥离 dev 态后缀 `-<N>-g<hash>`、按基础版本比较；预发布标识不剥离）——任一处基础版本漂移
      // 时安装副本的 bridge-check 会在已装项目报版本偏斜（上方断言只证明「覆盖 == 权威源文件」，
      // 无法捕获跨文件/跨值分叉）。旧严格全等使主仓「dev 态副本 + 权威源」形态结构性必红（F6）；
      // 归一后 dev 态同基础判同步，真实漂移仍必报（判别力见下方子锚表）。
      const installedVersion = fs.readFileSync(path.join(__dirname, '..', 'INSTALLED_VERSION'), 'utf8').trim();
      const exportMatch = /^export const version = '([^']+)';$/m.exec(srcText);
      if (!exportMatch) throw new Error('权威源 loader 未提取到 export version（场景前置失效）');
      const syncProblems = bridgeStampSyncProblems(srcStamp[1], exportMatch[1], installedVersion);
      if (syncProblems.length > 0) {
        throw new Error(
          '权威源版本三处基础版本不一致（标记行=' + srcStamp[1] + ' / export=' + exportMatch[1] +
          ' / INSTALLED_VERSION=' + installedVersion + '）——发布同步遗漏（bridge-check 会在安装副本报版本偏斜）：' +
          syncProblems.join('；')
        );
      }
      // in-place 锚（F6：发布同步守卫判别力双向证明，不新增顶层编号）——权威源 loader 的发布戳
      // 与 dev 态副本 INSTALLED_VERSION 必须按 bridge-check 既有语义比较：剥离 dev 态后缀按基础
      // 版本判同步（锚表正例即该真实形态），真实漂移（基础版本不同 / 发布版对发布版 / 预发布标识
      // 不剥离）仍必报。
      const baseVersion = fixtureBridgeBaseVersion(installedVersion);
      for (const subAnchor of bridgeStampSyncSubAnchorCases(baseVersion, installedVersion)) {
        const synced = subAnchor.problems.length === 0;
        if (synced !== subAnchor.expectSync) {
          throw new Error('发布同步守卫子锚失败（' + subAnchor.label + '）：期望'
            + (subAnchor.expectSync ? '同步' : '报漂移') + '，实际 problems=' + JSON.stringify(subAnchor.problems));
        }
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
  // in-place 扩展（glob 形态盲区闭合）：单侧含元字符 ⇒ 用该侧模式匹配另一侧字面路径（段内 `*`
  // 不跨 `/`）；段数不等 / 段内不匹配 ⇒ 不重叠放行；双侧 glob ⇒ 保守判重叠；补依赖路径 ⇒ 放行
  // （判据不恒真空过）。反向构造：把重叠判定回退成逐字相等 ⇒ ③/③d 必红。
  {
    name: '202 plan exit 写写重叠：字面/glob 单侧与双侧/段内不跨斜杠/补依赖路径（含恢复）',
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

      // ③ glob 形态重叠（单侧元字符 × 字面路径）：修复前逐字相等判定漏检 ⇒ 静默放行
      const globTasks = (firstWrite, secondWrite, secondDeps = '') =>
        '<task id="G01" parallel="true" status="pending"><action>实现 G01</action><write_files>' + firstWrite + '</write_files><verify>node --check src/x.mjs</verify></task>\n' +
        '<task id="G02" parallel="true" status="pending"><action>实现 G02</action><write_files>' + secondWrite + '</write_files><verify>node --check src/x.mjs</verify>' + secondDeps + '</task>\n';
      const globOverlap = runPlanExit(dir, globTasks('src/*.mjs', 'src/foo.mjs'));
      assertExit(globOverlap, 1);
      assertOut(globOverlap, 'BLOCKED');
      assertOut(globOverlap, 'G01×G02');
      assertOut(globOverlap, 'src/*.mjs');
      assertOut(globOverlap, 'src/foo.mjs');
      assertOut(globOverlap, 'depends_on');
      // ③b 段内 `*` 不跨 `/`：段数不等 ⇒ 不重叠 ⇒ 放行
      const depthMismatch = runPlanExit(dir, globTasks('src/*.mjs', 'src/deep/foo.mjs'));
      assertExit(depthMismatch, 0);
      assertNotOut(depthMismatch, 'BLOCKED');
      // ③c 段内模式不匹配（扩展名不符）⇒ 不重叠 ⇒ 放行
      const suffixMismatch = runPlanExit(dir, globTasks('src/*.mjs', 'src/foo.js'));
      assertExit(suffixMismatch, 0);
      assertNotOut(suffixMismatch, 'BLOCKED');
      // ③d 双侧 glob ⇒ 保守视为重叠（宁可误拦不可漏检——漏检正是本判据要修的缺陷）
      const doubleGlob = runPlanExit(dir, globTasks('src/*.mjs', 'src/*.js'));
      assertExit(doubleGlob, 1);
      assertOut(doubleGlob, 'BLOCKED');
      assertOut(doubleGlob, 'G01×G02');
      assertOut(doubleGlob, '∩');
      // ③e 恢复路径一：补显式 depends_on（重叠路径不改，不是靠改路径避开重叠）⇒ 放行
      const directDep = runPlanExit(dir, globTasks('src/*.mjs', 'src/foo.mjs', '<depends_on>G01</depends_on>'));
      assertExit(directDep, 0);
      assertNotOut(directDep, 'BLOCKED');
      // ③f 恢复路径二：经中间任务补依赖路径（G02 → M01 → G01）⇒ 依赖拓扑下不再同趟 ⇒ 放行
      const transitiveDep = runPlanExit(dir,
        '<task id="G01" parallel="true" status="pending"><action>实现 G01</action><write_files>src/*.mjs</write_files><verify>node --check src/x.mjs</verify></task>\n' +
        '<task id="M01" status="pending"><action>实现 M01</action><write_files>src/mid.mjs</write_files><verify>node --check src/mid.mjs</verify><depends_on>G01</depends_on></task>\n' +
        '<task id="G02" parallel="true" status="pending"><action>实现 G02</action><write_files>src/foo.mjs</write_files><verify>node --check src/x.mjs</verify><depends_on>M01</depends_on></task>\n');
      assertExit(transitiveDep, 0);
      assertNotOut(transitiveDep, 'BLOCKED');

      // ③g 等价性锚（in-place 扩展）：段内 glob 语义的两处实现——route-node 的计划期重叠判定
      //     （collectPathOverlaps）与 workflow-handoff 的提交子集校验（matchWriteFilePattern）
      //     ——对同一 (声明, 字面) 矩阵必须同判。两侧各测一侧不叫等价：此锚同一矩阵两侧求值。
      //     反向构造内建：矩阵里每一格都先断「两侧同判」，任一侧语义漂移即红（判别力由同一判据驱动）。
      const globProblems = globEquivalenceProblems(dir);
      if (globProblems.length > 0) {
        throw new Error('段内 glob 语义两处实现等价性锚失败: ' + globProblems.join('; '));
      }
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
        const nextRes = runStateWithProtocol(dir, ['next']);
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
      const nextRes = runStateWithProtocol(dir, ['next']);
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
      const r1 = runStateWithProtocol(dir, ['next']);
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
      const r2 = runStateWithProtocol(dir, ['next']);
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
      writeIntakeArtifacts(dir);
      const st = baseState('plan');
      st.completedNodes = ['open', 'design'];
      st.evidence.plan = { summary: 'executed' };
      writeState(dir, st);
      // 并行任务已 done、串行尾任务 pending（全串行剩余、无缺 status 畸形块）→ M4 静默
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' +
        '<task id="P01" parallel="true" status="done">\n  <action>do</action>\n  <verify>echo ok</verify>\n</task>\n' +
        '<task id="S01" parallel="false" status="pending">\n  <action>do serial</action>\n  <verify>echo ok</verify>\n</task>\n');
      const res = runGuardWithProtocol(dir, ['exit', 'plan', '--apply']);
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
      const res = runGuardWithProtocol(dir, ['exit', 'plan', '--apply']);
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
      const auth = runStateWithProtocol(dir, ['execution-mode', 'direct']);
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
      const back = runStateWithProtocol(dir, ['execution-mode', 'subagent']);
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
      const res = runStateWithProtocol(dir, ['next']);
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
      const builtin = scenarioProtocolPath(dir);
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
        fs.copyFileSync(scenarioProtocolPath(dir), path.join(proj, 'reference', 'workflow-protocol.json'));
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
      // ④ stale 检测（presence 之外的判别力）：在场 ≠ 同步——旧值不在场才是同步的另一半。
      // 受检面 = 维护者面（docs/internal/ 全册 + CLAUDE.md）+ 参考册（reference/*.md，路径从本
      // 脚本自身位置推导）；夹具用独立临时根驱动（夹具根下参考册缺席 → 该面为空，不误红）。
      const staleRoot = makeTmp();
      writeFile(staleRoot, 'docs/internal/DOC.md',
        '当前 ' + SCENARIOS.length + ' 场景 全部通过。\n');
      writeFile(staleRoot, 'CLAUDE.md', '回归基线：ALL ' + SCENARIOS.length + ' SCENARIOS PASSED\n');
      if (staleCountProblems([SCENARIOS.length, 86], staleRoot).length !== 0) {
        throw new Error('当前值不得被判成旧值: ' + JSON.stringify(staleCountProblems([SCENARIOS.length, 86], staleRoot)));
      }
      // 反例（旧 presence 判据必然放过：当前值在场即全绿，旁边的旧值不可见）
      writeFile(staleRoot, 'docs/internal/DOC.md', '当前 ' + SCENARIOS.length + ' 场景；另有 120 场景 的记录。\n');
      const staleOld = staleCountProblems([SCENARIOS.length, 86], staleRoot);
      if (!(staleOld.some((p) => p.includes('旧值未标记') && p.includes('docs/internal/DOC.md:1')
        && p.includes('120')))) {
        throw new Error('无标记旧值未被报告（应含文件:行 + 旧值）: ' + JSON.stringify(staleOld));
      }
      // 历史标记豁免：已标注的历史值不是"未标记旧值"（四枚标记各取一例——标记清单本身也受锚）
      for (const marked of ['（历史）120 场景。\n', '该值 120 场景 已过时。\n', '回顾：120 场景（history）。\n',
        '本轮踩坑：模板里写过 120 场景。\n']) {
        writeFile(staleRoot, 'docs/internal/DOC.md', marked);
        if (staleCountProblems([SCENARIOS.length, 86], staleRoot).length !== 0) {
          throw new Error('带历史标记的行不得报告: ' + JSON.stringify([marked, staleCountProblems([SCENARIOS.length, 86], staleRoot)]));
        }
      }
      // 量程门：30 以下 / 400 以上不参与（年份、编号一类数字挡在外面）
      writeFile(staleRoot, 'docs/internal/DOC.md', '夹具 7 场景 与 9999 场景。\n');
      if (staleCountProblems([SCENARIOS.length, 86], staleRoot).length !== 0) {
        throw new Error('量程外的数字不得参与: ' + JSON.stringify(staleCountProblems([SCENARIOS.length, 86], staleRoot)));
      }
      // 通用比值门控：同行未点名套件的 N/N 不参与（覆盖率一类通用比值不误伤）；点名套件才判
      writeFile(staleRoot, 'docs/internal/DOC.md', '覆盖率 120/120。\n');
      if (staleCountProblems([SCENARIOS.length, 86], staleRoot).length !== 0) {
        throw new Error('同行未点名套件的通用比值不得参与: ' + JSON.stringify(staleCountProblems([SCENARIOS.length, 86], staleRoot)));
      }
      writeFile(staleRoot, 'docs/internal/DOC.md', 'guard-self-test 覆盖率 120/120。\n');
      if (!staleCountProblems([SCENARIOS.length, 86], staleRoot).some((p) => p.includes('旧值未标记') && p.includes('120/120'))) {
        throw new Error('点名套件的旧比值未被报告: ' + JSON.stringify(staleCountProblems([SCENARIOS.length, 86], staleRoot)));
      }
      writeFile(staleRoot, 'docs/internal/DOC.md', 'guard-self-test 覆盖率 120/121。\n');
      if (staleCountProblems([SCENARIOS.length, 86], staleRoot).length !== 0) {
        throw new Error('非等值比值不是计数形态（不得参与）: ' + JSON.stringify(staleCountProblems([SCENARIOS.length, 86], staleRoot)));
      }
      // 声明的 CLAUDE.md 形态：维护者面逐册纳入（夹具根下 CLAUDE.md 在场即入面）
      writeFile(staleRoot, 'CLAUDE.md', '自检套件 120 场景。\n');
      if (!staleCountProblems([SCENARIOS.length, 86], staleRoot).some((p) => p.includes('CLAUDE.md:1') && p.includes('旧值未标记'))) {
        throw new Error('CLAUDE.md 未纳入 stale 受检面: ' + JSON.stringify(staleCountProblems([SCENARIOS.length, 86], staleRoot)));
      }
      // 读取失败可见化：与维护文档机检同型（同名目录 → 读取错误，不得静默跳过）
      fs.mkdirSync(path.join(staleRoot, 'docs', 'internal', 'DIR.md'), { recursive: true });
      if (!staleCountProblems([SCENARIOS.length, 86], staleRoot).some((p) => p.includes('无法读取: docs/internal/DIR.md'))) {
        throw new Error('stale 受检面里的不可读目标被静默跳过: ' + JSON.stringify(staleCountProblems([SCENARIOS.length, 86], staleRoot)));
      }
      fs.rmSync(staleRoot, { recursive: true, force: true }); // 夹具根清理（残留目录由底部统一校验）
      // ⑤ 面路径的推导纪律锚（同类断言回扫）：参考册受检面必须**从本脚本自身位置**推导——
      //    权威源（.flow-comet/skills）与各安装副本（.claude / .agents / .dsh/skills）同一推导
      //    覆盖；硬编码树根相对路径会在安装副本形态指向不存在的面（静默空面 = 未执行当通过）。
      if (path.resolve(REPO_ROOT, REFERENCE_FACE_DIR_REL) !== path.resolve(__dirname, '..', 'reference')) {
        throw new Error('参考册受检面必须由脚本自身位置推导（不得硬编码树根相对路径），实际: ' + REFERENCE_FACE_DIR_REL);
      }
      if (path.basename(REFERENCE_FACE_DIR_REL) !== 'reference') {
        throw new Error('参考册受检面路径异常: ' + REFERENCE_FACE_DIR_REL);
      }
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
    name: '232 hook 判定一致性：worktree 放行双分支一致 + 穿越仍拦 + 身份三态 × 桥接标记在场判据 × 最小保护集 + runRoot 外对称',
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

      // ---------- in-place 扩展：身份分派 × 最小保护集 × 顺序锚 × 两分支对称 ----------
      // ⑥ 身份三态（子代理语义的增量通道）：载荷 agent_id 在场（CC / Codex 原生子代理的载荷形态）
      //    或环境变量身份深度为正整数（dsh 桥接透传）⇒ 子代理语义放行；两者皆缺（主线程）⇒
      //    维持既有路径判定——新判据是增量通道，不是对旧语义的替换（不放宽也不误拦）。
      //    反向构造：把身份短路回退成纯路径判定 ⇒ ⑥a / ⑥c / ⑦a / ⑦c 必红（判别力见交付证据）。
      const whitelistOutside = path.join(dir, 'src', 'foo.mjs');
      const identityPayload = (extra) => ({
        tool_name: 'Write',
        tool_input: { file_path: whitelistOutside },
        ...extra,
      });
      // ⑥a 含 agent_id（子代理）⇒ 放行（路径在协调者白名单之外，身份未短路时必 BLOCK ⇒ RED）
      const viaAgentId = runHook(['before_tool'], dir, identityPayload({ agent_id: 'agent-abc123' }));
      assertExit(viaAgentId, 0);
      assertOut(viaAgentId, 'workflow-hook-guard-ok');
      assertOut(viaAgentId, '(subagent identity)');
      // ⑥b 不含 agent_id（主线程）⇒ 维持既有路径判定：白名单外源码仍 BLOCK
      const viaMainThread = runHook(['before_tool'], dir, identityPayload({}));
      assertExit(viaMainThread, 2);
      assertOut(viaMainThread, 'BLOCKED');
      // ⑥c dsh 桥接身份透传（环境变量正整数 + 桥接通道标记）⇒ 与载荷面归并为同一判据 ⇒ 放行
      const viaDepth = runHook(['before_tool'], dir, identityPayload({}), bridgeIdentityEnv('1'));
      assertExit(viaDepth, 0);
      assertOut(viaDepth, '(subagent identity)');
      // ⑥c2 env 面作用域收紧：**只有深度变量在场、桥接通道标记不在场** ⇒ 按协调者语义（白名单外
      //     源码仍 BLOCK）——CC / Codex 生成的 hook 直接调用本文件、并不自证是桥接，继承来的深度
      //     变量不得据此走子代理路径（否则守卫在 phase / worktree / runRoot 检查之前就返回）。
      //     反向构造：守卫去掉标记要求 ⇒ ⑥c2 必红（同载荷被误判为子代理而放行）。
      for (const inheritedDepth of ['1', '2', '9']) {
        const inherited = runHook(['before_tool'], dir, identityPayload({}), { FLOW_COMET_AGENT_DEPTH: inheritedDepth });
        assertExit(inherited, 2);
        assertOut(inherited, 'BLOCKED');
        assertNotOut(inherited, '(subagent identity)');
      }
      // ⑥c3 标记形态收窄（fail-closed）：值不符 / 大小写变体 / 空白变体 / 空串 / 非桥接来源一律不算
      for (const marker of ['', ' ', 'dsh', 'DSH-BRIDGE', 'Dsh-Bridge', 'dsh-bridge ', ' dsh-bridge', 'bridged']) {
        const res = runHook(['before_tool'], dir, identityPayload({}),
          { FLOW_COMET_AGENT_DEPTH: '1', FLOW_COMET_AGENT_DEPTH_SOURCE: marker });
        assertExit(res, 2);
        assertOut(res, 'BLOCKED');
      }
      // ⑥c4 标记在场但深度非法 ⇒ 仍非身份（两条判据都闭合：标记只证明通道，不代替取值形态收窄）
      for (const raw of ['0', '', 'abc', '-1']) {
        const res = runHook(['before_tool'], dir, identityPayload({}),
          { FLOW_COMET_AGENT_DEPTH: raw, FLOW_COMET_AGENT_DEPTH_SOURCE: 'dsh-bridge' });
        assertExit(res, 2);
        assertOut(res, 'BLOCKED');
      }
      // ⑥d 取值形态收窄（fail-closed 方向）：'0'（协调者）/ 空串 / 纯空白 / 非十进制 / 负数 /
      //    小数 / 科学计数 / 带符号 一律非身份 ⇒ 退回路径判定（不得读成放宽）
      for (const raw of ['0', '', '  ', 'abc', '-1', '1.5', '1e1', '+1', '2x']) {
        const res = runHook(['before_tool'], dir, identityPayload({}), bridgeIdentityEnv(raw));
        assertExit(res, 2);
        assertOut(res, 'BLOCKED');
      }
      // ⑥e 载荷面收窄：agent_id 非字符串 / 空串 / 纯空白 ⇒ 非身份；agent_type 单独在场不构成
      //    身份（实现判据只认 agent_id——文本与实现一致锚见技能文本锁场景）
      for (const bad of [undefined, null, 42, '', '   ']) {
        const res = runHook(['before_tool'], dir, identityPayload({ agent_id: bad }));
        assertExit(res, 2);
        assertOut(res, 'BLOCKED');
      }
      const viaAgentTypeOnly = runHook(['before_tool'], dir, identityPayload({ agent_type: 'codex-subagent' }));
      assertExit(viaAgentTypeOnly, 2);
      assertOut(viaAgentTypeOnly, 'BLOCKED');
      // ⑥f 两平台对照（同一判据、无平台分支）：codex 分支放行输出严格 JSON `{}`、拦截输出
      //    decision:block 且 exit 0；claude-code 分支放行输出既有文本、拦截 exit 2（见 ⑥a / ⑥b）
      const codexAllow = runHook(['before_tool', '--platform', 'codex'], dir, identityPayload({ agent_id: 'agent-abc123' }));
      assertExit(codexAllow, 0);
      if (codexAllow.output.trim() !== '{}') {
        throw new Error('codex 分支放行应输出严格 JSON {}，实际: ' + JSON.stringify(codexAllow.output));
      }
      const codexBlock = runHook(['before_tool', '--platform', 'codex'], dir, identityPayload({}));
      assertExit(codexBlock, 0);
      assertOut(codexBlock, '"decision":"block"');

      // ⑦ 顺序锚：身份判据**先于**路径判据求值——身份在场且目标在 runRoot 之外 ⇒ 放行。
      //    顺序若反转（先解析路径）该目标必 BLOCK ⇒ 本断言本身即顺序判据（判定顺序可断言）。
      const outsideRoot = path.join(dir, '..', 'outside-232', 'src', 'x.mjs');
      const orderViaWrite = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: outsideRoot }, agent_id: 'agent-abc123' });
      assertExit(orderViaWrite, 0);
      assertOut(orderViaWrite, '(subagent identity)');
      const orderViaBash = runHook(['before_tool'], dir,
        { tool_name: 'Bash', tool_input: { command: 'echo x > "' + posix(outsideRoot) + '"' }, agent_id: 'agent-abc123' });
      assertExit(orderViaBash, 0);
      // ⑦b 载荷 cwd 不参与路径解释（会话 cwd 与实际工作目录不一致的实测形态）：身份在场时
      //     cwd 指向别处 + 相对路径 ⇒ 仍按身份放行（不因 cwd 不一致而误拦）
      const viaCwdDrift = runHook(['before_tool'], dir, {
        tool_name: 'Write',
        tool_input: { file_path: 'src/rel.mjs' },
        cwd: path.join(dir, '..', 'elsewhere-232'),
        agent_id: 'agent-abc123',
      });
      assertExit(viaCwdDrift, 0);
      // ⑦c 同载荷无身份 ⇒ 相对路径按 runRoot 解析（cwd 不参与）⇒ 白名单外 BLOCK，且报文中不出现
      //     按 cwd 解析出的错路径（cwd 漂移不得改变判定依据）
      const cwdDriftMain = runHook(['before_tool'], dir, {
        tool_name: 'Write',
        tool_input: { file_path: 'src/rel.mjs' },
        cwd: path.join(dir, '..', 'elsewhere-232'),
      });
      assertExit(cwdDriftMain, 2);
      assertOut(cwdDriftMain, 'BLOCKED');
      assertNotOut(cwdDriftMain, 'elsewhere-232');

      // ⑧ runRoot 外写入的关断，两分支对称：同一目标经 Write / Edit（file_path 分支）与 Bash
      //    （命令级写入）同判 BLOCK——修复前 file_path 分支静默放行（fail-open）而 Bash 分支拦截。
      //    反向构造：恢复 file_path 分支的静默放行 ⇒ ⑧a / ⑧b 必红。
      const outsideWrite = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: outsideRoot } });
      assertExit(outsideWrite, 2);
      assertOut(outsideWrite, 'BLOCKED');
      assertOut(outsideWrite, '项目根之外');
      const outsideEdit = runHook(['before_tool'], dir,
        { tool_name: 'Edit', tool_input: { file_path: outsideRoot } });
      assertExit(outsideEdit, 2);
      assertOut(outsideEdit, 'BLOCKED');
      const outsideBash = runHook(['before_tool'], dir,
        { tool_name: 'Bash', tool_input: { command: 'echo x > "' + posix(outsideRoot) + '"' } });
      assertExit(outsideBash, 2);
      assertOut(outsideBash, 'BLOCKED');
      // ⑧b 身份在场时两分支同样对称放行（顺序锚在 Bash 分支上的对照——见 ⑦a 第二例）

      // ⑨ 最小保护集：身份放行**不放行**两个机器面目标——机器状态文件与本次运行实际生效的
      //    协议文件（三平台身份形态一致受拦）。反向构造：身份短路时跳过保护集判定 ⇒ ⑨ 必红。
      const stateFileTarget = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const protocolFileTarget = path.join(dir, 'reference', 'workflow-protocol.json');
      for (const [label, target] of [['机器状态文件', stateFileTarget], ['协议保护路径', protocolFileTarget]]) {
        const viaIdentityWrite = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: target }, agent_id: 'agent-abc123' });
        assertExit(viaIdentityWrite, 2);
        assertOut(viaIdentityWrite, 'BLOCKED');
        const viaIdentityEdit = runHook(['before_tool'], dir,
          { tool_name: 'Edit', tool_input: { file_path: target }, agent_id: 'agent-abc123' });
        assertExit(viaIdentityEdit, 2);
        assertOut(viaIdentityEdit, 'BLOCKED');
        const viaIdentityBash = runHook(['before_tool'], dir,
          { tool_name: 'Bash', tool_input: { command: 'echo x > "' + posix(target) + '"' }, agent_id: 'agent-abc123' });
        assertExit(viaIdentityBash, 2);
        assertOut(viaIdentityBash, 'BLOCKED');
        const viaDepthWrite = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: target } }, bridgeIdentityEnv('2'));
        assertExit(viaDepthWrite, 2);
        assertOut(viaDepthWrite, 'BLOCKED');
        // 报文须点名保护集类别（经桥接通道身份放行下的拦截理由）：协调者路径的报语文义不同
        // （state 文件另有同族点名的协调者分支，协议面则是「不在允许范围」）⇒ 本断言锁住「身份
        // 在场仍走保护集判定」而非靠白名单兜底（判别力见 ⑥c2 的继承形态对照）。
        assertOut(viaDepthWrite, label === '机器状态文件' ? 'state 文件' : '协议文件');
        const codexIdentityBlock = runHook(['before_tool', '--platform', 'codex'], dir,
          { tool_name: 'Write', tool_input: { file_path: target }, agent_id: 'agent-abc123' });
        assertExit(codexIdentityBlock, 0);
        assertOut(codexIdentityBlock, '"decision":"block"');
        if (!codexIdentityBlock.output.includes(label === '机器状态文件' ? 'state 文件' : '协议文件')) {
          throw new Error('保护集拦截报文应点名目标类别（' + label + '）: ' + JSON.stringify(codexIdentityBlock.output));
        }
      }
      // ⑨b 对照：同一身份写普通源码 / 工件路径 ⇒ 放行（保护集不扩大——只此两个目标）
      const identityAllowedSource = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: whitelistOutside }, agent_id: 'agent-abc123' });
      assertExit(identityAllowedSource, 0);
      const identityAllowedArtifact = runHook(['before_tool'], dir,
        { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.specs', CHANGE_ID, 'note.md') }, agent_id: 'agent-abc123' });
      assertExit(identityAllowedArtifact, 0);
      // ⑨c 别名形态闭合（物理同一性）：经 8.3 短路径 / 符号链接拼写的同一状态文件同样受拦
      //     （词法比较看不见别名——身份放行下保护集是唯一防线，故须闭合）。平台无法构造链接时
      //     如实降级为可见提示，不静默跳过。
      const stateAliasDir = path.join(dir, '.flow-comet-alias');
      let aliasLinkCreated = false;
      try {
        fs.symlinkSync(path.join(dir, '.flow-comet'), stateAliasDir,
          process.platform === 'win32' ? 'junction' : 'dir');
        aliasLinkCreated = true;
      } catch { aliasLinkCreated = false; }
      if (aliasLinkCreated) {
        const viaAlias = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: path.join(stateAliasDir, 'flow-comet-state.json') }, agent_id: 'agent-abc123' });
        assertExit(viaAlias, 2);
        assertOut(viaAlias, 'BLOCKED');
      } else {
        console.error('WARN: 当前平台无法构造目录链接，保护集别名形态断言降级（词法判定仍由 ⑨ 覆盖）');
      }
      // ⑨d 盘符根拼写（Windows 上 Git-Bash 类 shell 的 `/d/<剩余>` 形态）与盘符拼写**同判**：
      //     win32 的目标解析把 `/d/<剩余>` 读成「当前盘根下的 \d\<剩余>」而非 `D:\<剩余>` ⇒
      //     词法相对化判为根外（相对路径为空）⇒ 状态文件判据被跳过；物理判据对错解路径 stat
      //     失败 ⇒ 两道判据同时失守——身份放行下保护集形同虚设（fail-open）。归一入口唯一
      //     （既有写入目标解析），故两条判据同时闭合、各等价拼写同判。
      //     该拼写是 Windows 上 Git-Bash 类 shell 的自然产物；非 win32 平台它是普通 POSIX
      //     绝对路径，语义不同 ⇒ 显式不适用（不静默跳过——未验证 ≠ 通过）。
      const hasDriveRoot = /^[A-Za-z]:[\\/]/.test(dir);
      if (process.platform === 'win32' && hasDriveRoot) {
        const driveRootSpelling = (p) => '/' + p[0].toLowerCase() + p.slice(2).replaceAll('\\', '/');
        for (const [label, target, marker] of [
          ['机器状态文件', stateFileTarget, 'state 文件'],
          ['协议保护路径', protocolFileTarget, '协议文件'],
        ]) {
          const exits = [];
          const forms = [['盘符根拼写', driveRootSpelling(target)], ['盘符拼写', posix(target)]];
          for (const [formLabel, form] of forms) {
            const viaWrite = runHook(['before_tool'], dir,
              { tool_name: 'Write', tool_input: { file_path: form }, agent_id: 'agent-abc123' });
            assertExit(viaWrite, 2);
            assertOut(viaWrite, marker);
            const viaBash = runHook(['before_tool'], dir,
              { tool_name: 'Bash', tool_input: { command: 'cp "' + form + '" "' + form + '"' }, agent_id: 'agent-abc123' });
            assertExit(viaBash, 2);
            assertOut(viaBash, marker);
            exits.push(viaWrite.status, viaBash.status);
            if (formLabel === '盘符根拼写') {
              // 盘符字母大写变体同归一（同族拼写不得因大小写漏判）
              const upper = runHook(['before_tool'], dir,
                { tool_name: 'Write', tool_input: { file_path: '/' + form[1].toUpperCase() + form.slice(2) }, agent_id: 'agent-abc123' });
              assertExit(upper, 2);
              assertOut(upper, marker);
            }
          }
          if (exits.some((code) => code !== exits[0])) {
            throw new Error(label + ' 的两种拼写应同判，实际 exit: ' + JSON.stringify(exits));
          }
          if (label === '机器状态文件') {
            // 协调者路径（无身份）同样闭合：命令级写入的盘符根拼写命中状态文件判据 ⇒ 报文点名
            // 目标类别（修复前落到「不在允许范围」兜底分支——证明目标确被抽取，缺口在判定）
            const msysMain = driveRootSpelling(target);
            const asMain = runHook(['before_tool'], dir,
              { tool_name: 'Bash', tool_input: { command: 'cp "' + msysMain + '" "' + msysMain + '"' } });
            assertExit(asMain, 2);
            assertOut(asMain, marker);
          }
        }
        // ⑨e 对照：同一身份写普通源码的盘符根拼写 ⇒ 放行（归一不得把保护集扩大到其余路径）
        const msysSource = driveRootSpelling(whitelistOutside);
        const msysSourceWrite = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: msysSource }, agent_id: 'agent-abc123' });
        assertExit(msysSourceWrite, 0);
        assertOut(msysSourceWrite, '(subagent identity)');
        const msysSourceBash = runHook(['before_tool'], dir,
          { tool_name: 'Bash', tool_input: { command: 'cp "' + msysSource + '" "' + msysSource + '"' }, agent_id: 'agent-abc123' });
        assertExit(msysSourceBash, 0);
        // ⑨f 单字母限定（`/dev`、`/etc` 一类多字母首段不得被当作盘符根）：该目标按「当前盘根下的
        //     同名目录」解析 ⇒ 项目根之外 ⇒ 协调者拦截报文带根外语义。若归一放宽为「首字母后不要求
        //     分隔符」，目标被改写成盘符相对形态后落在项目根内 ⇒ 报文语义改变 ⇒ 本断言必红。
        const notDriveRoot = '/' + dir[0].toLowerCase() + 'ev/probe.md';
        const notDriveRootRes = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: notDriveRoot } });
        assertExit(notDriveRootRes, 2);
        assertOut(notDriveRootRes, '项目根之外');
      } else {
        // 非 win32：该拼写是**普通 POSIX 绝对路径**，归一只许在 win32 生效（否则同一目标会被改写成
        //     项目根内的相对形态，报文失去根外语义）。本断言锁的是「平台限定」这半边——正向断言在
        //     本平台不适用，故此处改为可判别的替代锚（断言失败即说明归一变无条件）。
        const posixSpelling = '/d/probe.md';
        const posixRes = runHook(['before_tool'], dir,
          { tool_name: 'Write', tool_input: { file_path: posixSpelling } });
        assertExit(posixRes, 2);
        assertOut(posixRes, '项目根之外');
        console.error('注意: 本平台无盘符根形态，盘符根拼写的归一等价性断言**显式不适用**'
          + '（dsh/pwsh 与 Codex/cmd 不产生该拼写；win32 侧为唯一判别面）——已改为断言平台限定半边'
          + '（该拼写在本平台不得被归一到项目根内）；未验证 ≠ 通过');
      }

      // ⑩ apply_patch 承载形态的耐久锚（in-place 扩展）：补丁正文写在 tool_input.command、
      //    载荷无 file_path——目标须由补丁摘要行抽出后才进入既有判定入口（白名单与最小保护集
      //    共用同一返回值）。判据与内建反向构造见模块级 applyPatchAnchorProblems。
      const patchProblems = applyPatchAnchorProblems(dir);
      if (patchProblems.length > 0) {
        throw new Error('apply_patch 目标解析锚失败: ' + patchProblems.join('; '));
      }
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
      const res = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
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
      const boundary = runStateWithProtocol(dir, ['init', CHANGE_ID + '-2', '--init-context']);
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

  // 244: 维护文档机检（docs-governance）——死引用 + ROADMAP 最低结构。
  // 判别力四类：正例（干净夹具通过）/ 反例（死引用必须报告且含来源与目标）/
  // 越界（ROADMAP 缺段必须报告）/ 恢复（修复后通过）；另锁「整组缺席即跳过」语义。
  // 本批 in-place 扩展（不新增顶层编号）：① 三册显式扫描面（.specs 三册）正/反例；
  // ② 树根相对形态解析正例与同族缺目标反例——后者是窄域规则的判别力证据（旧逻辑在顶层目录
  // 不存在时直接跳过，必然放过）；③ 窄域边界负例（外部命名空间 / 已移除临时区仍跳过）；
  // ④ maintainerFaceSkips 描述符正/反例。
  {
    name: '244 维护文档机检：死引用与 ROADMAP 结构（含三册扫描面与树根相对解析）',
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
      // —— 扫描面扩展：三册显式清单（.specs/CONTEXT.md / LESSONS.md / CHANGELOG.md）——
      // 正例：三册在场且互相引用（册间互引）→ 合法引用不得误报
      writeFile(dir, '.specs/CONTEXT.md', '见 `docs/internal/ROADMAP.md` 与 `.specs/LESSONS.md`。\n');
      writeFile(dir, '.specs/LESSONS.md', '见 `.specs/CONTEXT.md`。\n');
      writeFile(dir, '.specs/CHANGELOG.md', '见 `.specs/LESSONS.md`。\n');
      if (internalDocsProblems(dir).length !== 0) {
        throw new Error('三册合法引用不得误报: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      // 反例：逐册注入一行死引用——每册都必须被扫到，且报告需带册名与行号
      for (const [book, deadRef] of [
        ['.specs/CONTEXT.md', 'docs/internal/missing-context-target.md'],
        ['.specs/LESSONS.md', 'docs/internal/missing-lessons-target.md'],
        ['.specs/CHANGELOG.md', 'docs/internal/missing-changelog-target.md'],
      ]) {
        writeFile(dir, book, '第一行。\n见 `' + deadRef + '`。\n');
        const bookProblems = internalDocsProblems(dir);
        if (!bookProblems.some((p) => p.includes(path.posix.basename(book) + ':2') && p.includes(deadRef))) {
          throw new Error(book + ' 死引用未被报告（三册扫描面缺失）: ' + JSON.stringify(bookProblems));
        }
        if (bookProblems.length !== 1) {
          throw new Error(book + ' 死引用判定应恰 1 条: ' + JSON.stringify(bookProblems));
        }
        writeFile(dir, book, '见 `.specs/CONTEXT.md`。\n'); // 修复 → 复绿
      }
      if (internalDocsProblems(dir).length !== 0) {
        throw new Error('三册修复后应通过: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      // —— 解析基准扩展：树根相对形态（flow-comet-* 技能目录 / rules）——
      // 正例：目标真实存在（技能树根 / 规则树根各一）→ 不报
      writeFile(dir, '.flow-comet/skills/flow-comet-fixture/SKILL.md', '# fixture\n');
      writeFile(dir, '.flow-comet/rules/fixture-rule.md', '# rule\n');
      writeFile(dir, 'docs/internal/FIXTURE.md',
        '见 `flow-comet-fixture/SKILL.md` 与 `rules/fixture-rule.md` 与 `docs/internal/ROADMAP.md`。\n');
      const treePositive = internalDocsProblems(dir);
      if (treePositive.length !== 0) {
        throw new Error('树根相对形态（技能目录 / 规则树）既有目标应解析通过: ' + JSON.stringify(treePositive));
      }
      // 反例（窄域规则判别力）：同族形态但目标不存在，且顶层目录在仓库根不存在——
      // 旧判定会以「顶层整体缺席 → 跳过」静默放行，窄域规则必须按死引用报告
      writeFile(dir, 'docs/internal/FIXTURE.md',
        '见 `flow-comet-missing-fixture/SKILL.md` 与 `rules/missing-rule.md` 与 `docs/internal/ROADMAP.md`。\n');
      const treeNegative = internalDocsProblems(dir);
      for (const deadRef of ['flow-comet-missing-fixture/SKILL.md', 'rules/missing-rule.md']) {
        if (!treeNegative.some((p) => p.includes('FIXTURE.md:1') && p.includes(deadRef))) {
          throw new Error('同族缺目标（' + deadRef + '）必须按死引用报告（窄域规则）: ' + JSON.stringify(treeNegative));
        }
      }
      // —— 本批 in-place 增锚（声明式族：外部命名空间 / 退役命名空间 / 示例）——旧语义
      // "顶层段不存在即静默跳过"在此被替换：允许面必须显式登记，未登记者一律按死引用报告
      // （fail-closed；旧逻辑对下列②③两种形态都静默放过——判别力差异即反向构造证据）。
      // ① 外部命名空间族（前缀声明）→ 仍跳过（平台侧命名空间在本仓库根天然不存在）
      writeFile(dir, 'docs/internal/FIXTURE.md',
        '见 `DSH_HOME/skills/x/SKILL.md` 与 `dsh-tui/lib/a.js` 与 `dsh-base/cordis.patch.yml` 与 `docs/internal/ROADMAP.md`。\n');
      const externalProblems = internalDocsProblems(dir);
      if (externalProblems.length !== 0) {
        throw new Error('声明式外部命名空间族不得误报: ' + JSON.stringify(externalProblems));
      }
      // ② 退役命名空间：登记在案（记录迁移的决策件）→ 跳过；未登记文件里的同形态引用 → 必须按死引用报
      writeFile(dir, '.specs/adr/ADR-009-runtime-namespace.md', '见 `.comet/config.yaml` 与 `.comet/flow-comet-state.json`。\n');
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `.comet/config.yaml` 与 `docs/internal/ROADMAP.md`。\n');
      const retiredProblems = internalDocsProblems(dir);
      if (!retiredProblems.some((p) => p.includes('FIXTURE.md:1') && p.includes('.comet/config.yaml'))) {
        throw new Error('未登记的退役命名空间引用必须按死引用报告: ' + JSON.stringify(retiredProblems));
      }
      if (retiredProblems.some((p) => p.includes('ADR-009-runtime-namespace.md'))) {
        throw new Error('登记在案的迁移记录件不得误报: ' + JSON.stringify(retiredProblems));
      }
      // ②b 允许面按角色 / 前缀匹配（改名不误报）：同一决策件 / 同族后续决策件换名后仍须跳过——
      // 精确 ref 硬编码下改名即静默失配 → 合法历史迁移记录被误报死引用（误红会诱导维护者
      // 删掉历史事实）。本锚即"改名后仍正确跳过"的反向构造。
      fs.renameSync(path.join(dir, '.specs', 'adr', 'ADR-009-runtime-namespace.md'),
        path.join(dir, '.specs', 'adr', 'ADR-009-runtime-namespace-renamed.md'));
      writeFile(dir, '.specs/adr/ADR-010-namespace-followup.md', '见 `.comet/config.yaml`。\n');
      const renamedProblems = internalDocsProblems(dir);
      for (const renamed of ['ADR-009-runtime-namespace-renamed.md', 'ADR-010-namespace-followup.md']) {
        if (renamedProblems.some((p) => p.includes(renamed))) {
          throw new Error('决策件改名后不得误报死引用（按前缀匹配退役命名空间允许面）: ' + renamed
            + ' → ' + JSON.stringify(renamedProblems));
        }
      }
      // ②c 决策册角色匹配（角色面正 / 反例；角色判定直接锚 + 引用面不得被角色面放宽）
      if (!isDeclaredReferenceSkip('.specs/CONTEXT.md', '.comet/config.yaml')
        || !isDeclaredReferenceSkip('.specs/CONTEXT-decisions.md', '.comet/flow-comet-state.json')) {
        throw new Error('决策册角色（含改名形态）必须按角色命中退役命名空间允许面');
      }
      if (isDeclaredReferenceSkip('.specs/CONTEXT-decisions.md', 'docs/internal/missing-target.md')
        || isDeclaredReferenceSkip('.specs/OTHER.md', '.comet/config.yaml')) {
        throw new Error('允许面不得面化：引用面（退役命名空间前缀）与文件面（角色 / 前缀）须同时命中');
      }
      // 反例（fail-closed 仍成立）：非登记角色的同形态引用 → 必须照报（允许面不得变成宽面）
      writeFile(dir, '.specs/adr/ADR-008-unrelated.md', '见 `.comet/config.yaml`。\n');
      const unrelatedProblems = internalDocsProblems(dir);
      if (!unrelatedProblems.some((p) => p.includes('ADR-008-unrelated.md') && p.includes('.comet/config.yaml'))) {
        throw new Error('非登记角色的退役命名空间引用必须照报: ' + JSON.stringify(unrelatedProblems));
      }
      fs.rmSync(path.join(dir, '.specs', 'adr', 'ADR-009-runtime-namespace-renamed.md'));
      fs.rmSync(path.join(dir, '.specs', 'adr', 'ADR-010-namespace-followup.md'));
      fs.rmSync(path.join(dir, '.specs', 'adr', 'ADR-008-unrelated.md'));
      // 夹具移除后本组不再产生任何报告（判别力反向确认：上面三类断言确由这些夹具驱动，
      // 不是被其它夹具的既有报告蒙对）。此处只对本组文件断言——docs/internal/FIXTURE.md
      // 仍带着上一段夹具的未登记引用（其报告由上一段断言负责）。
      const afterAllowlistCleanup = internalDocsProblems(dir);
      for (const removed of ['ADR-009-runtime-namespace-renamed.md', 'ADR-010-namespace-followup.md', 'ADR-008-unrelated.md']) {
        if (afterAllowlistCleanup.some((p) => p.includes(removed))) {
          throw new Error('允许面夹具移除后不得再报该文件: ' + removed + ' → ' + JSON.stringify(afterAllowlistCleanup));
        }
      }
      // ③ 已移除临时区（未登记形态）→ 必须报（真实残留曾因旧跳过语义长期不可见）
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `.verify-tools/level3-smoke.mjs` 与 `docs/internal/ROADMAP.md`。\n');
      const residueProblems = internalDocsProblems(dir);
      if (!residueProblems.some((p) => p.includes('FIXTURE.md:1') && p.includes('.verify-tools/level3-smoke.mjs'))) {
        throw new Error('未登记的临时区引用必须按死引用报告: ' + JSON.stringify(residueProblems));
      }
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/ROADMAP.md`。\n');
      // —— 行号存在与不越界（结构级）：引用解析成功后才校验行号 ——
      writeFile(dir, 'docs/internal/TARGET.md', '第一行\n第二行\n第三行\n');
      writeFile(dir, 'docs/internal/FIXTURE.md',
        '见 `docs/internal/TARGET.md:1` 与 `docs/internal/TARGET.md:1-3` 与 `docs/internal/TARGET.md:2,3`。\n');
      if (internalDocsProblems(dir).length !== 0) {
        throw new Error('合法行号引用（单值 / 区间 / 逗号列表）不得误报: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      // 反例：越界（旧实现只判路径存在性，行号部分根本不参与解析 → 必然放过）
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/TARGET.md:99`。\n');
      const lineProblems = internalDocsProblems(dir);
      if (!(lineProblems.some((p) => p.includes('行号越界') && p.includes('FIXTURE.md:1')
        && p.includes('TARGET.md:99') && p.includes('目标共')))) {
        throw new Error('越界行号未被报告（应含「行号越界」+ 受检文件:行 + 目标:行号 + 目标行数）: '
          + JSON.stringify(lineProblems));
      }
      // 反例：下界（第 0 行不存在）
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/TARGET.md:0`。\n');
      if (!internalDocsProblems(dir).some((p) => p.includes('行号越界') && p.includes('TARGET.md:0'))) {
        throw new Error('下界越界（引用第 0 行）未被报告: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      // 反例：尾随换行不得让目标文件被算成"多一行"——3 行文件引 `:4` 必须越界
      // （旧实现按 split 段数计行，尾随空段被算作一行 → :4 被放过；2026-10-01 PR 审查发现）
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/TARGET.md:4`。\n');
      if (!internalDocsProblems(dir).some((p) => p.includes('行号越界') && p.includes('TARGET.md:4'))) {
        throw new Error('尾随换行被算成额外一行（3 行目标文件引 :4 未报越界）: '
          + JSON.stringify(internalDocsProblems(dir)));
      }
      // 反例：**空文件 = 0 行**——空目标文件的任何行号都越界（按 split 段数计会得 1 行 → `:1` 被放过）
      writeFile(dir, 'docs/internal/EMPTY.md', '');
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/EMPTY.md:1`。\n');
      if (!internalDocsProblems(dir).some((p) => p.includes('行号越界') && p.includes('EMPTY.md:1'))) {
        throw new Error('空目标文件引 :1 未报越界（空文件应为 0 行）: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      fs.rmSync(path.join(dir, 'docs/internal', 'EMPTY.md'));
      // 反例：区间上端越界（区间取两端逐一校验）
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/TARGET.md:2-99`。\n');
      if (!internalDocsProblems(dir).some((p) => p.includes('行号越界') && p.includes('TARGET.md:99'))) {
        throw new Error('区间上端越界未被报告: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      // 反例：逗号列表中的越界项
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/TARGET.md:1,99`。\n');
      if (!internalDocsProblems(dir).some((p) => p.includes('行号越界') && p.includes('TARGET.md:99'))) {
        throw new Error('逗号列表中的越界项未被报告: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      // 并列写法护栏：首段带文件扩展名的 token 不是路径引用（两个文件名并列）→ 不参与解析；
      // 同一行里真实的越界引用照报（证明护栏没有把整行一起吞掉——判据必须收窄到"首段带扩展名"）
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `TEST.md/REVIEW.md` 与 `docs/internal/TARGET.md:99`。\n');
      const parallelProblems = internalDocsProblems(dir);
      if (parallelProblems.some((p) => p.includes('TEST.md/REVIEW.md'))) {
        throw new Error('并列写法（首段带扩展名）不得按路径引用解析: ' + JSON.stringify(parallelProblems));
      }
      if (!parallelProblems.some((p) => p.includes('TARGET.md:99'))) {
        throw new Error('并列写法护栏不得吞掉同一行的真实越界引用: ' + JSON.stringify(parallelProblems));
      }
      // 目标本身不存在时只报死引用，不叠报行号越界（同一处只报一次）
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/MISSING-TARGET.md:99`。\n');
      const missingTargetProblems = internalDocsProblems(dir);
      if (!missingTargetProblems.some((p) => p.includes('死引用') && p.includes('MISSING-TARGET.md'))) {
        throw new Error('不存在的目标应报死引用: ' + JSON.stringify(missingTargetProblems));
      }
      if (missingTargetProblems.some((p) => p.includes('行号越界'))) {
        throw new Error('目标不存在时不得叠报行号越界: ' + JSON.stringify(missingTargetProblems));
      }
      fs.rmSync(path.join(dir, 'docs/internal', 'TARGET.md'));
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/ROADMAP.md`。\n');
      // —— 表头新鲜度（内容锚：表头日期 ≥ 正文最大日期；未声明表头 → 跳过）——
      writeFile(dir, 'docs/internal/HEADER.md', '> 最后更新：2026-01-01\n\n正文提到 2026-02-02 的事。\n');
      const staleHeaderProblems = internalDocsProblems(dir);
      if (!(staleHeaderProblems.some((p) => p.includes('表头不新鲜') && p.includes('HEADER.md')
        && p.includes('2026-01-01') && p.includes('2026-02-02')))) {
        throw new Error('表头落后于正文最大日期未被报告（应含文件与两侧日期）: ' + JSON.stringify(staleHeaderProblems));
      }
      writeFile(dir, 'docs/internal/HEADER.md', '> 最后更新：2026-02-02\n\n正文提到 2026-02-02 的事。\n');
      if (internalDocsProblems(dir).some((p) => p.includes('表头不新鲜'))) {
        throw new Error('表头与正文最大日期相等（新鲜）不得误报: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      writeFile(dir, 'docs/internal/HEADER.md', '正文提到 2026-12-31 的事，但本册没声明表头。\n');
      if (internalDocsProblems(dir).some((p) => p.includes('表头不新鲜'))) {
        throw new Error('未声明表头的目标必须跳过（登记边界）: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      fs.rmSync(path.join(dir, 'docs/internal', 'HEADER.md'));
      // —— `## Now` 段不得出现已归档 change-id（旧逻辑无此判据 → 必然放过）——
      writeFile(dir, '.specs/archive/2026-01-01-archived-fixture/CHANGE.md', '# 归档夹具\n');
      writeFile(dir, 'docs/internal/ROADMAP.md',
        '# 路线图\n\n> 最后更新：2026-01-01\n\n## Now\n\n- 在办：archived-fixture 的后续\n\n## Next\n\n## Later\n\n## Open decisions\n');
      const nowProblems = internalDocsProblems(dir);
      if (!nowProblems.some((p) => p.includes('Now 段含已归档 change-id: archived-fixture'))) {
        throw new Error('在办段引用已归档 change-id 未被报告: ' + JSON.stringify(nowProblems));
      }
      // 正例：同一 id 只出现在 Now 段之外 → 不报（判据只约束在办段，历史段本就该记已归档项）
      writeFile(dir, 'docs/internal/ROADMAP.md',
        '# 路线图\n\n> 最后更新：2026-01-01\n\n## Now\n\n- 在办：别的主题\n\n## Next\n\n## Later\n\n- 历史：archived-fixture\n\n## Open decisions\n');
      if (internalDocsProblems(dir).some((p) => p.includes('Now 段含已归档'))) {
        throw new Error('Now 段之外的归档 id 不得误报: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      // 反例：归档 id 必须**整词**匹配——`archived-fixture-v2` 含 `archived-fixture` 但不得误报
      // （旧实现用 includes 子串匹配 → 短 id 会命中更长 id 或同族更长 id 的中间；2026-10-01 PR 审查发现）
      writeFile(dir, 'docs/internal/ROADMAP.md',
        '# 路线图\n\n> 最后更新：2026-01-01\n\n## Now\n\n- 在办：archived-fixture-v2 的后续\n\n## Next\n\n## Later\n\n## Open decisions\n');
      if (internalDocsProblems(dir).some((p) => p.includes('Now 段含已归档 change-id'))) {
        throw new Error('归档 id 子串误命中（archived-fixture-v2 不得命中 archived-fixture）: '
          + JSON.stringify(internalDocsProblems(dir)));
      }
      // 定位口径锚：文件头目录说明行里出现被反引号包住的同名标题字样时，段定位必须仍命中真实
      // 在办段（按行首标题扫描，而不是按子串首次出现位置切段——后者会切出极短窗口使判据恒过）
      writeFile(dir, 'docs/internal/ROADMAP.md',
        '# 路线图\n\n> 最后更新：2026-01-01\n\n目录说明：`## Now` 与 `## Next` 两段。\n\n## Now\n\n- 在办：archived-fixture\n\n## Next\n\n## Later\n\n## Open decisions\n');
      if (!internalDocsProblems(dir).some((p) => p.includes('Now 段含已归档 change-id: archived-fixture'))) {
        throw new Error('目录说明行含标题字样时仍须命中真实在办段（标题扫描口径）: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      fs.rmSync(path.join(dir, '.specs', 'archive'), { recursive: true, force: true });
      writeFile(dir, 'docs/internal/ROADMAP.md', '# 路线图\n\n## Now\n\n## Next\n\n## Later\n\n## Open decisions\n');
      // 缺席可见化描述符（正例）：维护者面全在场 → 无跳过描述符
      if (maintainerFaceSkips(dir).length !== 0) {
        throw new Error('维护者面在场时应无跳过描述符: ' + JSON.stringify(maintainerFaceSkips(dir)));
      }
      // 越界：删段 → 结构问题必须报告
      writeFile(dir, 'docs/internal/ROADMAP.md', '# 路线图\n\n## Now\n## Next\n## Later\n');
      const structProblems = internalDocsProblems(dir);
      if (!structProblems.some((p) => p.includes('Open decisions'))) {
        throw new Error('ROADMAP 缺段未被报告: ' + JSON.stringify(structProblems));
      }
      // —— 本批 in-place 增锚（F4：读取失败可见化）——以同名目录替换 .md 文件 → readFileSync
      // 抛 EISDIR（目录读取错误，跨平台同码）；旧实现 catch → continue 静默跳过，该目标既无
      // FAIL 也无 SKIP（「未执行 ≠ 通过」的静默通道，L-079 同类）→ 必须报告
      // 「无法读取: <rel>: <err 摘要>」。前置：ROADMAP 复原为完整结构，确保本锚的失败只可能
      // 来自不可读目标（无结构噪声）。
      writeFile(dir, 'docs/internal/ROADMAP.md', '# 路线图\n\n## Now\n\n## Next\n\n## Later\n\n## Open decisions\n');
      if (internalDocsProblems(dir).length !== 0) {
        throw new Error('不可读目标锚前置：干净夹具应通过: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      fs.mkdirSync(path.join(dir, 'docs/internal', 'UNREADABLE.md'), { recursive: true });
      const unreadableProblems = internalDocsProblems(dir);
      if (!unreadableProblems.some((p) => p.includes('无法读取: docs/internal/UNREADABLE.md'))) {
        throw new Error('不可读目标被静默跳过（应报告「无法读取: <rel>: <err 摘要>」）: ' + JSON.stringify(unreadableProblems));
      }
      fs.rmSync(path.join(dir, 'docs/internal', 'UNREADABLE.md'), { recursive: true, force: true });
      if (internalDocsProblems(dir).length !== 0) {
        throw new Error('移除不可读目标后应复绿: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      // —— 本批 in-place 增锚（F4 语义的结构检查侧补齐）——：目标扫描的读取失败已可见化，但
      // ROADMAP 结构检查此前仍对同一路径直接 readFileSync——ROADMAP 自身不可读（同名目录 →
      // EISDIR / 访问类错误）时未捕获异常会把整个套件打成堆栈崩溃，而不是给出可见问题条目。
      // 夹具把 ROADMAP.md 换成同名目录（其余受检面保持合法，失败只可能来自该目标）→ 断言
      // 返回问题数组且含「无法读取: docs/internal/ROADMAP.md」（不是抛出），且不得以「结构缺段」
      // 噪声替代读取失败可见化（读取失败即跳过四段结构检查）；移除目录、写回合法 ROADMAP → 复绿。
      fs.rmSync(path.join(dir, 'docs/internal', 'ROADMAP.md'), { force: true });
      fs.mkdirSync(path.join(dir, 'docs/internal', 'ROADMAP.md'), { recursive: true });
      const unreadableRoadmap = internalDocsProblems(dir);
      if (!Array.isArray(unreadableRoadmap)) {
        throw new Error('ROADMAP 不可读时应返回问题数组（不得抛出）: ' + String(unreadableRoadmap));
      }
      if (!unreadableRoadmap.some((p) => p.includes('无法读取: docs/internal/ROADMAP.md'))) {
        throw new Error('ROADMAP 自身不可读未被报告（应含「无法读取: docs/internal/ROADMAP.md」）: ' + JSON.stringify(unreadableRoadmap));
      }
      if (unreadableRoadmap.some((p) => p.includes('ROADMAP 结构缺段'))) {
        throw new Error('ROADMAP 读取失败时不得继续四段结构检查: ' + JSON.stringify(unreadableRoadmap));
      }
      fs.rmSync(path.join(dir, 'docs/internal', 'ROADMAP.md'), { recursive: true, force: true });
      writeFile(dir, 'docs/internal/ROADMAP.md', '# 路线图\n\n## Now\n\n## Next\n\n## Later\n\n## Open decisions\n');
      if (internalDocsProblems(dir).length !== 0) {
        throw new Error('ROADMAP 写回合法结构后应复绿: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      // 整组缺席（CI / worktree 形态）→ 跳过，不误红：目标面 = docs/internal 与 .specs/adr 与
      // 三册——组缺席判据是「全部目标面缺席」（targets.length === 0），故夹具同步移除三册。
      fs.rmSync(path.join(dir, 'docs/internal'), { recursive: true, force: true });
      fs.rmSync(path.join(dir, '.specs'), { recursive: true, force: true });
      if (internalDocsProblems(dir).length !== 0) {
        throw new Error('目标面整组缺席时应跳过: ' + JSON.stringify(internalDocsProblems(dir)));
      }
      // 缺席可见化描述符（反例）：维护者面整体缺席 → 逐面给出「面名 + 原因」，
      // 供套件底部输出可见 SKIP 行；本节同时锁住「判定语义零变化」（上面跳过断言）。
      const skips = maintainerFaceSkips(dir);
      if (skips.length !== 2) {
        throw new Error('维护者面缺席应给出 2 条跳过描述符，实际 ' + JSON.stringify(skips));
      }
      for (const skip of skips) {
        if (typeof skip.face !== 'string' || skip.face.trim() === ''
          || typeof skip.reason !== 'string' || skip.reason.trim() === '') {
          throw new Error('跳过描述符须含面名与原因: ' + JSON.stringify(skip));
        }
      }
      if (!skips.some((s) => s.face.includes('计数') && s.reason.includes('docs/internal'))) {
        throw new Error('计数面跳过描述符应说明 docs/internal 缺席: ' + JSON.stringify(skips));
      }
      if (!skips.some((s) => s.face.includes('机检') && s.reason.includes('目标面'))) {
        throw new Error('维护文档机检面跳过描述符应说明目标面缺席: ' + JSON.stringify(skips));
      }
      // —— 本批 in-place 增锚（公开产物零代号判据 + 词表镜像漂移判据）——
      // 与 .githooks 词表单一来源同判据（该文件主仓私有、不随技能包分发；本文件内保留同义镜像，
      // 两处同改）。① 表驱动等价性：词表**每个分支**各一条正例（分支被删 / 被收窄过头 → 该行
      // 先红）与一条对应反例（分支被放宽成裸词 / 宽前缀 → 该行先红）——反例按"放宽后会被误
      // 命中的合法或无关形态"选取，故"某分支被动过"必然落在某个（正例，反例）对上；
      // ② 本文件注释层零残留（清理后不许回潮）；③ 词表镜像漂移判据夹具锚（同源 → 绿 /
      // 改一字符 → 红且消息含两侧片段与长度 / 私有面缺席 → 显式"无法执行"而非静默放过）。
      // 注意：形态字面量只能写在非注释行——本锚的②正是扫注释层。
      const CODE_BRANCH_SAMPLES = [
        ['场景编号', 'S12', 'S1234'],
        ['修复族 id', 'T-FIX-01', 'FIX-01'],
        ['批次连字符前缀', 'batch-2', 'batch-name'],
        ['缺陷编号', 'D-12', 'D-abc'],
        ['优先级编号', 'P3', 'P9'],
        ['验证轮次', 'round 3', 'round-table'],
        ['英文本地实践词', 'dogfood', 'dog food'],
        ['内部标识词', '内部', '内卷'],
        ['批次加编号', '批次 D', '批次发布'],
        ['批加编号', '批 2', '第一批 2 次'],
        ['批加编号（序数与批之间有空格）', '批 2', '第 1 批 2 次'],
        ['级加编号', '级 3', '级联'],
        ['验收代号', 'UAT-7', 'UAT-x'],
        ['工作项编号', 'R-14', 'ADR-013'],
        ['工作项编号（三位不截断）', 'R-14', 'R-123'],
      ];
      for (const [label, hit, miss] of CODE_BRANCH_SAMPLES) {
        if (!PUBLIC_CODE_RE.test(hit)) {
          throw new Error('词表分支缺失或被收窄过头（正例不再命中）: ' + label + ' → ' + JSON.stringify(hit));
        }
        if (PUBLIC_CODE_RE.test(miss)) {
          throw new Error('词表分支被放宽（反例被误命中）: ' + label + ' → ' + JSON.stringify(miss));
        }
      }
      for (const legit of ['PR-130', '维护批次', '批处理', 'Fix 批次']) {
        if (PUBLIC_CODE_RE.test(legit)) {
          throw new Error('合法相似子串被零代号判据误报: ' + legit);
        }
      }
      // ③ 词表镜像漂移判据（夹具驱动；不依赖真实私有面在场——权威源与安装副本两形态都可跑）
      const mirrorFixtureRel = path.posix.join('.githooks', 'internal-codes.mjs');
      const mirrorText = 'export const BANNED = /' + PUBLIC_CODE_RE.source + '/;\n';
      writeFile(dir, mirrorFixtureRel, mirrorText);
      const mirrorOk = vocabularyMirrorProblems(dir);
      if (mirrorOk.length !== 0) {
        throw new Error('同源词表镜像不得报漂移: ' + JSON.stringify(mirrorOk));
      }
      // 逐字符比对必有判别力：镜像侧改动一个字符（这里放宽一条分支）→ 必报，且消息可定位
      const driftedSource = PUBLIC_CODE_RE.source.replace('dogfood', 'dogfoods');
      if (driftedSource === PUBLIC_CODE_RE.source) {
        throw new Error('夹具前提失效：漂移注入未改变镜像 source（词表分支名已变）');
      }
      writeFile(dir, mirrorFixtureRel, 'export const BANNED = /' + driftedSource + '/;\n');
      const driftProblems = vocabularyMirrorProblems(dir);
      if (!driftProblems.some((p) => p.includes('词表镜像漂移') && p.includes('主仓侧片段')
        && p.includes('套件侧片段') && p.includes('首个差异位置')
        && p.includes(String(driftedSource.length)) && p.includes(String(PUBLIC_CODE_RE.source.length)))) {
        throw new Error('镜像侧改动一个字符必须报漂移且消息含两侧片段与长度: ' + JSON.stringify(driftProblems));
      }
      writeFile(dir, mirrorFixtureRel, mirrorText);
      if (vocabularyMirrorProblems(dir).length !== 0) {
        throw new Error('镜像还原后应复绿: ' + JSON.stringify(vocabularyMirrorProblems(dir)));
      }
      // 私有面结构性缺席（安装副本形态）→ 显式"判据无法执行"，不得静默返回空
      fs.rmSync(path.join(dir, '.githooks'), { recursive: true, force: true });
      const mirrorMissing = vocabularyMirrorProblems(dir);
      if (!mirrorMissing.some((p) => p.includes('无法执行') && p.includes(mirrorFixtureRel))) {
        throw new Error('私有面缺席必须显式报告判据未执行（未验证 ≠ 通过）: ' + JSON.stringify(mirrorMissing));
      }
      const selfLines = fs.readFileSync(path.join(__dirname, 'guard-self-test.mjs'), 'utf8').split(/\r?\n/);
      const commentHits = [];
      for (let i = 0; i < selfLines.length; i += 1) {
        if (!/^\s*(\/\/|\*|\/\*)/.test(selfLines[i])) continue;
        const hit = selfLines[i].match(PUBLIC_CODE_RE);
        if (hit) commentHits.push((i + 1) + ': ' + hit[0]);
      }
      if (commentHits.length !== 0) {
        throw new Error('本文件注释层仍有未公开概念字样（判据锚：注释层零残留）: ' + commentHits.join(', '));
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

      // ---------- m-12 轮次计数纯函数锚（唯一写点 applyFixRollbackRound）----------
      // 第 1~3 轮递增并带审计后缀；第 4 轮新 change BLOCK 且不写计数器；用户显式授权后
      // 放行该轮；旧 change 缺字段缺省 0 不 BLOCK；done-but-unclosed 分支不计数。
      const applyRound = requireRouteNodeExport('applyFixRollbackRound');
      const roundState = {
        activeChange: CHANGE_ID,
        currentNode: 'review',
        evidence: { review: { summary: 'pending fix' } },
        newChange: true,
      };
      const pendingDecision = { kind: 'pending', target: 'execute' };
      for (let round = 1; round <= 3; round += 1) {
        const applied = applyRound({ state: roundState, sourceNode: 'review', decision: pendingDecision });
        if (!applied.counted || applied.blocked || applied.round !== round
          || applied.auditSuffix !== '（第 ' + round + '/3 轮）') {
          throw new Error('第 ' + round + ' 轮应计数并输出轮次审计后缀，实际 ' + JSON.stringify(applied));
        }
        if (roundState.fixRoundsByChange?.[CHANGE_ID] !== round) {
          throw new Error('第 ' + round + ' 轮后计数器应为 ' + round + '，实际 '
            + JSON.stringify(roundState.fixRoundsByChange));
        }
      }
      const blocked = applyRound({ state: roundState, sourceNode: 'review', decision: pendingDecision });
      if (!blocked.blocked || blocked.counted || blocked.round !== 4) {
        throw new Error('新 change 第 4 轮应 BLOCK 且不计数，实际 ' + JSON.stringify(blocked));
      }
      if (roundState.fixRoundsByChange?.[CHANGE_ID] !== 3) {
        throw new Error('第 4 轮 BLOCK 不得写计数器（应保持 3），实际 '
          + JSON.stringify(roundState.fixRoundsByChange));
      }
      if (!String(blocked.blockedMessage).includes('继续修') || !String(blocked.blockedMessage).includes('停止')) {
        throw new Error('第 4 轮 BLOCK 消息应含「继续修/停止」决策指引，实际 ' + JSON.stringify(blocked.blockedMessage));
      }
      // F5 fail-closed：完整授权形态 = round 正整数 + at/source 非空字符串；任一缺失、类型非法、
      // 空串/纯空白一律按未授权处理——第 4 轮继续 BLOCK、不计数、不写 state（state 字节零改写）。
      const invalidOverrides = [
        ['仅 round（缺 at/source）', { round: 4 }],
        ['缺 at', { round: 4, source: 'fixture-user' }],
        ['缺 source', { round: 4, at: '2026-09-25T00:00:00.000Z' }],
        ['round 为字符串', { round: '4', at: '2026-09-25T00:00:00.000Z', source: 'fixture-user' }],
        ['round 为零', { round: 0, at: '2026-09-25T00:00:00.000Z', source: 'fixture-user' }],
        ['round 为负数', { round: -1, at: '2026-09-25T00:00:00.000Z', source: 'fixture-user' }],
        ['round 为小数', { round: 4.5, at: '2026-09-25T00:00:00.000Z', source: 'fixture-user' }],
        ['at 类型非法（数字）', { round: 4, at: 123, source: 'fixture-user' }],
        ['source 类型非法（数组）', { round: 4, at: '2026-09-25T00:00:00.000Z', source: ['fixture-user'] }],
        ['at 空串', { round: 4, at: '', source: 'fixture-user' }],
        ['source 空串', { round: 4, at: '2026-09-25T00:00:00.000Z', source: '' }],
        ['at 纯空白', { round: 4, at: '   ', source: 'fixture-user' }],
        ['source 纯空白', { round: 4, at: '2026-09-25T00:00:00.000Z', source: '\t' }],
        ['override 为 null', null],
      ];
      for (const [label, badOverride] of invalidOverrides) {
        roundState.evidence.review.fixRoundOverride = badOverride;
        const badResult = applyRound({ state: roundState, sourceNode: 'review', decision: pendingDecision });
        if (!badResult.blocked || badResult.counted || badResult.overrideUsed || badResult.round !== 4
          || roundState.fixRoundsByChange?.[CHANGE_ID] !== 3) {
          throw new Error('F5 非法授权形态必须按未授权 fail-closed BLOCK 且零改写（' + label + '），实际 '
            + JSON.stringify({ badResult, rounds: roundState.fixRoundsByChange }));
        }
      }
      // 合法三元组（嵌套 evidence）→ 放行被 BLOCK 的那一轮并留审计
      roundState.evidence.review.fixRoundOverride = { round: 4, at: '2026-09-25T00:00:00.000Z', source: 'fixture-user' };
      const override = applyRound({ state: roundState, sourceNode: 'review', decision: pendingDecision });
      if (!override.counted || !override.overrideUsed || override.blocked || override.round !== 4) {
        throw new Error('用户显式授权后第 4 轮应放行并标记 overrideUsed，实际 ' + JSON.stringify(override));
      }
      if (roundState.fixRoundsByChange?.[CHANGE_ID] !== 4) {
        throw new Error('授权放行后计数器应为 4，实际 ' + JSON.stringify(roundState.fixRoundsByChange));
      }
      // 旧 change 缺轮次字段 → 缺省 0、不因计数 BLOCK
      const legacyRoundState = { activeChange: CHANGE_ID, currentNode: 'review', evidence: {}, newChange: false };
      const legacyRound = applyRound({ state: legacyRoundState, sourceNode: 'review', decision: pendingDecision });
      if (!legacyRound.counted || legacyRound.blocked || legacyRound.round !== 1) {
        throw new Error('旧 change 缺省 0 应可从第 1 轮计数，实际 ' + JSON.stringify(legacyRound));
      }
      if (legacyRoundState.fixRoundsByChange?.[CHANGE_ID] !== 1) {
        throw new Error('旧 change 第 1 轮应写入缺省容器，实际 ' + JSON.stringify(legacyRoundState.fixRoundsByChange));
      }
      // 分支② done-but-unclosed 不计数（计数语义 = 一次受控归位）
      const unclosedState = { activeChange: CHANGE_ID, currentNode: 'review', evidence: {}, newChange: true };
      const unclosedRound = applyRound({ state: unclosedState, sourceNode: 'review', decision: { kind: 'unclosed', target: 'execute' } });
      if (unclosedRound.counted || unclosedRound.round !== null || unclosedState.fixRoundsByChange) {
        throw new Error('done-but-unclosed 分支不得计数/建容器，实际 '
          + JSON.stringify({ unclosedRound, rounds: unclosedState.fixRoundsByChange }));
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

      // ⑩ m-14 签名算法版本三态 + 冻结锚（分类器与 C3 消费点共用 route-node 谓词）
      // 冻结锚：算法版本升级必须先更新版本决策与测试锚——本断言变红强制该决策。
      if (routeNodeModule.TASK_SET_SIGNATURE_ALGO !== 'v1') {
        throw new Error('签名算法版本冻结锚失效：期望 v1，实际 '
          + JSON.stringify(routeNodeModule.TASK_SET_SIGNATURE_ALGO)
          + '——升级算法前必须先更新版本决策与测试锚');
      }
      const parseSig = requireRouteNodeExport('parseTaskSetSignature');
      const sameSig = requireRouteNodeExport('sameTaskSetSignature');
      const sigSkew = requireRouteNodeExport('taskSetSignatureVersionSkew');
      const versioned = routeNodeModule.taskSetSignature(plainTaskText);
      if (!/^v1:[0-9a-f]{64}$/.test(versioned)) {
        throw new Error('新版本签名值应为 v1:<sha256 hex>，实际 ' + JSON.stringify(versioned));
      }
      const versionedParsed = parseSig(versioned);
      if (!versionedParsed || versionedParsed.algo !== 'v1'
        || versionedParsed.digest !== parseSig(signatureOf(plainTaskText)).digest) {
        throw new Error('parseTaskSetSignature 应解析 vN:<digest> 元数据，实际 ' + JSON.stringify(versionedParsed));
      }
      // legacy 裸 hex 按 v1 语义（旧 taskHash / 旧事件）
      const legacyParsed = parseSig(versionedParsed.digest);
      if (!legacyParsed || legacyParsed.algo !== 'v1' || legacyParsed.digest !== versionedParsed.digest) {
        throw new Error('legacy 裸 hex 应按 v1 解析，实际 ' + JSON.stringify(legacyParsed));
      }
      // C3 三态谓词：同版本同 digest 一致 / 同版本不同 digest 不一致 / 跨版本 skew 跳过比对
      if (!sameSig(versioned, 'v1:' + versionedParsed.digest)
        || sameSig(versioned, 'v1:' + divergentSignature)
        || sameSig(versioned, 'v2:' + versionedParsed.digest)) {
        throw new Error('同版本一致性谓词三态错误（sameTaskSetSignature）');
      }
      if (!sigSkew(versioned, 'v2:' + versionedParsed.digest)
        || sigSkew(versioned, versioned)
        || sigSkew(versioned, versionedParsed.digest)) {
        throw new Error('跨版本 skew 谓词三态错误（taskSetSignatureVersionSkew）');
      }
      if (parseSig('v1:not-a-digest') !== null || parseSig('') !== null || parseSig(null) !== null) {
        throw new Error('非法签名形态应解析为 null（fail-closed）');
      }
      // 分类器三态：新版本相等 → normal；legacy 裸 hex 相等 → normal（legacy=v1）；
      // 跨版本 / 声明版本与值不一致 → 跳过比对（unknown，不误判 fix）。
      const versionedEqual = classifyCause({
        history: [familyExit('execute', versioned)],
        changeName: CHANGE_ID, taskContent: plainTaskText, fixSectionTitle: 'Fix 任务',
      });
      if (versionedEqual !== 'normal') {
        throw new Error('新版本签名相等应判 normal，实际 ' + JSON.stringify(versionedEqual));
      }
      const legacyEqual = classifyCause({
        history: [familyExit('execute', versionedParsed.digest)],
        changeName: CHANGE_ID, taskContent: plainTaskText, fixSectionTitle: 'Fix 任务',
      });
      if (legacyEqual !== 'normal') {
        throw new Error('legacy 裸 hex 与当前摘要相等应判 normal（legacy=v1），实际 ' + JSON.stringify(legacyEqual));
      }
      const crossVersion = classifyCause({
        history: [familyExit('execute', 'v2:' + divergentSignature, { signatureAlgo: 'v2' })],
        changeName: CHANGE_ID, taskContent: plainTaskText, fixSectionTitle: 'Fix 任务',
      });
      if (crossVersion !== 'unknown') {
        throw new Error('跨算法版本历史事件应跳过比对（unknown，不误判 fix），实际 ' + JSON.stringify(crossVersion));
      }
      const mismatchedDeclared = classifyCause({
        history: [familyExit('execute', versioned, { signatureAlgo: 'v2' })],
        changeName: CHANGE_ID, taskContent: plainTaskText, fixSectionTitle: 'Fix 任务',
      });
      if (mismatchedDeclared !== 'unknown') {
        throw new Error('signatureAlgo 与值版本不一致的畸形事件应跳过（unknown），实际 ' + JSON.stringify(mismatchedDeclared));
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
      // ④ m-12 第 1~3 轮递增（AC-4）：逐轮重置驻留态，审计后缀第 n/3 轮且计数器同步 +1
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      for (let round = 1; round <= 3; round += 1) {
        writeState(dir, st);
        const stRound = readScenarioState(dir);
        stRound.fixRoundsByChange = { [CHANGE_ID]: round - 1 };
        writeState(dir, stRound);
        const resRound = runGuard(['entry', 'execute'], dir);
        assertExit(resRound, 0);
        assertOut(resRound, 'FIX-BATCH: 受控归位 execute（源节点 review）（第 ' + round + '/3 轮）');
        const stAfterRound = readScenarioState(dir);
        if (stAfterRound.fixRoundsByChange?.[CHANGE_ID] !== round) {
          throw new Error('第 ' + round + ' 轮 entry 归位后计数器应为 ' + round + '，实际 '
            + JSON.stringify(stAfterRound.fixRoundsByChange));
        }
      }
      // ⑤ 第 4 轮新 change BLOCK：state 字节零改写（不写 currentNode、不写计数器）
      writeState(dir, { ...st, fixRoundsByChange: { [CHANGE_ID]: 3 } });
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const beforeRound4 = fs.readFileSync(statePath, 'utf8');
      const resRound4 = runGuard(['entry', 'execute'], dir);
      assertExit(resRound4, 1);
      assertOut(resRound4, 'BLOCKED: Fix 批次受控归位已达 3 轮上限');
      assertOut(resRound4, '继续修');
      assertOut(resRound4, '停止');
      if (fs.readFileSync(statePath, 'utf8') !== beforeRound4) {
        throw new Error('第 4 轮 BLOCK 必须 state 字节零改写（不写 currentNode/计数器）');
      }
      const stBlocked = readScenarioState(dir);
      if (stBlocked.currentNode !== 'review' || stBlocked.fixRoundsByChange?.[CHANGE_ID] !== 3) {
        throw new Error('第 4 轮 BLOCK 后 currentNode 应保持 review、计数器保持 3，实际 '
          + JSON.stringify({ currentNode: stBlocked.currentNode, rounds: stBlocked.fixRoundsByChange }));
      }
      // ⑤b F5：非法授权形态（仅 round，缺 at/source）在真实 entry 链路上仍按未授权 fail-closed——
      // 继续 BLOCK、state 字节零改写、currentNode 保持 review、计数器保持 3。
      const stBadOverride = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      stBadOverride.evidence.review.fixRoundOverride = { round: 4 };
      writeState(dir, stBadOverride);
      const badOverrideBytes = fs.readFileSync(statePath, 'utf8');
      const resBadOverride = runGuard(['entry', 'execute'], dir);
      assertExit(resBadOverride, 1);
      assertOut(resBadOverride, 'BLOCKED: Fix 批次受控归位已达 3 轮上限');
      assertNotOut(resBadOverride, '（第 4/3 轮）');
      if (fs.readFileSync(statePath, 'utf8') !== badOverrideBytes) {
        throw new Error('F5 缺 at/source 的授权形态必须在 entry 链路上 state 字节零改写');
      }
      const stBadAfter = readScenarioState(dir);
      if (stBadAfter.currentNode !== 'review' || stBadAfter.fixRoundsByChange?.[CHANGE_ID] !== 3) {
        throw new Error('F5 缺 at/source 不得放行第 4 轮（currentNode 保持 review、计数保持 3），实际 '
          + JSON.stringify({ currentNode: stBadAfter.currentNode, rounds: stBadAfter.fixRoundsByChange }));
      }
      // ⑥ 用户显式授权（嵌套 evidence，完整三元组）→ 放行第 4 轮并写 currentNode + 计数器
      const stOverride = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      stOverride.evidence.review.fixRoundOverride = { round: 4, at: '2026-09-25T00:00:00.000Z', source: 'fixture-user' };
      writeState(dir, stOverride);
      const resOverride = runGuard(['entry', 'execute'], dir);
      assertExit(resOverride, 0);
      assertOut(resOverride, '（第 4/3 轮）');
      const stAuthorized = readScenarioState(dir);
      if (stAuthorized.currentNode !== 'execute' || stAuthorized.fixRoundsByChange?.[CHANGE_ID] !== 4) {
        throw new Error('授权后第 4 轮应放行归位（currentNode=execute、计数器=4），实际 '
          + JSON.stringify({ currentNode: stAuthorized.currentNode, rounds: stAuthorized.fixRoundsByChange }));
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
      // ③ m-12/AC-5 计数隔离：verify 源归位只增 Fix 轮次，verify 失败计数保持不动
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      writeState(dir, { ...st, fixRoundsByChange: { [CHANGE_ID]: 1 }, verifyFailuresByChange: { [CHANGE_ID]: 2 } });
      const resRound2 = runGuard(['entry', 'execute'], dir);
      assertExit(resRound2, 0);
      assertOut(resRound2, '受控归位 execute（源节点 verify）（第 2/3 轮）');
      let stIsolated = readScenarioState(dir);
      if (stIsolated.fixRoundsByChange?.[CHANGE_ID] !== 2 || stIsolated.verifyFailuresByChange?.[CHANGE_ID] !== 2) {
        throw new Error('verify 源归位应只增 Fix 轮次（2）、verify 失败计数保持 2，实际 '
          + JSON.stringify({ rounds: stIsolated.fixRoundsByChange, verifyFailures: stIsolated.verifyFailuresByChange }));
      }
      // ④ 第 4 轮 BLOCK + state 字节零改写 + 授权放行（verify 源）
      writeState(dir, { ...st, fixRoundsByChange: { [CHANGE_ID]: 3 }, verifyFailuresByChange: { [CHANGE_ID]: 2 } });
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const beforeBlocked = fs.readFileSync(statePath, 'utf8');
      const resBlocked = runGuard(['entry', 'execute'], dir);
      assertExit(resBlocked, 1);
      assertOut(resBlocked, 'BLOCKED: Fix 批次受控归位已达 3 轮上限');
      if (fs.readFileSync(statePath, 'utf8') !== beforeBlocked) {
        throw new Error('verify 源第 4 轮 BLOCK 必须 state 字节零改写');
      }
      const stVBlocked = readScenarioState(dir);
      if (stVBlocked.currentNode !== 'verify' || stVBlocked.verifyFailuresByChange?.[CHANGE_ID] !== 2) {
        throw new Error('verify 源第 4 轮 BLOCK 后 currentNode/verify 计数不得改写，实际 '
          + JSON.stringify({ currentNode: stVBlocked.currentNode, verifyFailures: stVBlocked.verifyFailuresByChange }));
      }
      const stVOverride = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      stVOverride.evidence.verify.fixRoundOverride = { round: 4, at: '2026-09-25T00:00:00.000Z', source: 'fixture-user' };
      writeState(dir, stVOverride);
      const resVOverride = runGuard(['entry', 'execute'], dir);
      assertExit(resVOverride, 0);
      assertOut(resVOverride, '（第 4/3 轮）');
      const stVAfter = readScenarioState(dir);
      if (stVAfter.currentNode !== 'execute' || stVAfter.fixRoundsByChange?.[CHANGE_ID] !== 4
        || stVAfter.verifyFailuresByChange?.[CHANGE_ID] !== 2) {
        throw new Error('verify 源授权放行后应 currentNode=execute、轮次=4、verify 计数保持 2，实际 '
          + JSON.stringify({ currentNode: stVAfter.currentNode, rounds: stVAfter.fixRoundsByChange, verifyFailures: stVAfter.verifyFailuresByChange }));
      }
    },
  },

  // 250: exit execute --apply Fix 二次完成回源（review 源）——execute 在 exit 前已在
  // completedNodes + TASK 全 done：REVIEW.md 已在场（resolveNextNode 会按产物跳过 review 到
  // verify）但 review 未完成 → 受控回程 review（源节点出口必须真实执行，不被产物存在性跳过）。
  // 本场景族拆自原 250 单场景，断言与失败信息保持不变；本段覆盖回源归属与出口事件形状。
  {
    name: '250 exit execute --apply Fix 二次完成：回源 review（REVIEW.md 在场但不按产物跳过）',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFixReturnSummaries(dir, ['T01', 'T-FIX-01']);
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', FIX_RETURN_REVIEW_TEXT);
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

      // 250e 源未 entry 的真实 Fix：修复任务 + enteredNodes 不含源节点 review + 历史无
      // 签名（旧态）→ 结构标记仍恢复 fix 标签，保留 FIX-BATCH；不误判 unknown、不卡死。
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeState(dir, fixReturnBaseState({
        evidence: fixReturnFamilyEvidence(['T01', 'T-FIX-01']),
        enteredNodes: ['open', 'design', 'plan', 'execute', 'subagent-execute'],
        history: [],
      }));
      const resSourceNotEntered = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resSourceNotEntered, 0);
      assertOut(resSourceNotEntered, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertOut(resSourceNotEntered, 'NODE: review');
      assertNotOut(resSourceNotEntered, 'RETURN: 回源节点');
      assertNotOut(resSourceNotEntered, 'BLOCKED');
    },
  },

  // 250b: 回程行分类与 Fix 段标题路径——历史全量扫描 / 旧态未分类 / 模板派生与缺失回退。
  // 本场景族拆自原 250 单场景，断言与失败信息保持不变。
  {
    name: '250b 回程行分类与 Fix 段标题路径：历史扫描、旧态未分类、模板派生与回退',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      writeFixReturnSummaries(dir, ['T01', 'T-FIX-01']);
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', FIX_RETURN_REVIEW_TEXT);

      // 250d 反向构造（L-064）——与 250c 一一对应证明分类依据是历史全量扫描（不是只看
      // 最新）：① 无 Fix 编号任务 + 旧签名 ≠ 当前 + 最新签名 == 当前 → 仍判 fix（发散证据
      // 不依赖结构标记）；② 同任务集仅保留最新（签名 == 当前）→ 必须中性 RETURN。
      const plainTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n';
      const plainSignature = routeNodeModule.taskSetSignature(plainTaskText);
      writeFile(dir, taskPath, plainTaskText);
      writeState(dir, fixReturnBaseState({
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
      writeState(dir, fixReturnBaseState({
        history: [{
          event: 'exit-applied', node: 'subagent-execute', change: CHANGE_ID,
          at: '2026-09-24T00:00:00.000Z', taskSetSignature: plainSignature,
        }],
      }));
      const resLatestOnlyEqual = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resLatestOnlyEqual, 0);
      assertOut(resLatestOnlyEqual, 'RETURN: 回源节点 review（execute 出口已完成；正常多趟收尾，非 Fix 回修）');
      assertNotOut(resLatestOnlyEqual, 'FIX-BATCH');

      // 250f 旧态无签名无标记：历史家族出口无签名 + 任务集无 Fix 标记 → RETURN 未分类；
      // 不 BLOCK、不出现 FIX-BATCH；NODE/state 与收口前一致（只有审计行变化）。
      writeState(dir, fixReturnBaseState({
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
      if (afterUnknown.currentNode !== 'review' || afterUnknown.completedNodes.join(',') !== FIX_RETURN_FAMILY_COMPLETED) {
        throw new Error('未分类回程应只覆盖路由到 review 且 completedNodes 不变，实际 '
          + JSON.stringify({ currentNode: afterUnknown.currentNode, completedNodes: afterUnknown.completedNodes }));
      }
      assertStateOnlyChanged(beforeUnknown, afterUnknown, {
        label: '250f 旧态未分类回程',
        allowed: ['currentNode', 'status', 'history'],
      });

      // 250g Fix 段标题从 flow-kit/templates/TASK.md 派生（决策 4）：模板段名含括号说明 +
      // 段内非 FIX 编号任务 → 结构标记命中 fix（模板读取路径真实被执行；标题由模板派生）。
      writeFile(dir, 'flow-kit/templates/TASK.md',
        '# TASK 模板\n\n## Fix 任务（来自 REVIEW / INTEGRATION）\n');
      const sectionTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n'
        + '## Fix 任务（来自 REVIEW / INTEGRATION）\n\n' + fixTaskBlock('T02', 'done') + '\n';
      writeFile(dir, taskPath, sectionTaskText);
      writeFile(dir, '.specs/' + CHANGE_ID + '/T02-SUMMARY.md', strictSummary('T02'));
      const sectionSignature = routeNodeModule.taskSetSignature(sectionTaskText);
      writeState(dir, fixReturnBaseState({
        evidence: fixReturnFamilyEvidence(['T01', 'T02']),
        history: [{
          event: 'exit-applied', node: 'execute', change: CHANGE_ID,
          at: '2026-09-24T00:00:00.000Z', taskSetSignature: sectionSignature,
        }],
      }));
      const resSection = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resSection, 0);
      assertOut(resSection, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(resSection, 'RETURN: 回源节点');

      // 250h m-06 模板缺失 + 闭合 ATX + 非 FIX 编号：guard 无模板派生标题 → 回退内置
      // 「Fix 任务」，段内 T02 由结构标记判 fix（模板缺席不得让 Fix 批次漏判）。
      fs.rmSync(path.join(dir, 'flow-kit', 'templates', 'TASK.md'), { force: true });
      const missingTplTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n'
        + '## Fix 任务 ##\n\n' + fixTaskBlock('T02', 'done') + '\n';
      writeFile(dir, taskPath, missingTplTaskText);
      writeState(dir, fixReturnBaseState({ evidence: fixReturnFamilyEvidence(['T01', 'T02']), history: [] }));
      const resMissingTpl = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resMissingTpl, 0);
      assertOut(resMissingTpl, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(resMissingTpl, 'RETURN: 回源节点');
      assertNotOut(resMissingTpl, 'BLOCKED');

      // 250i m-06 模板基名不同（Fix Tasks）+ 闭合 ATX + 非 FIX 编号：标题归一来自共享权威，
      // 语言后缀可变仍命中 Fix 段（旧硬编码中文基名会漏判 → RETURN-normal）。
      writeFile(dir, 'flow-kit/templates/TASK.md',
        '# TASK 模板\n\n## Fix Tasks（来自 REVIEW / INTEGRATION）\n');
      const renamedTplTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n'
        + '## Fix Tasks ##\n\n' + fixTaskBlock('T02', 'done') + '\n';
      writeFile(dir, taskPath, renamedTplTaskText);
      writeState(dir, fixReturnBaseState({ evidence: fixReturnFamilyEvidence(['T01', 'T02']), history: [] }));
      const resRenamedTpl = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resRenamedTpl, 0);
      assertOut(resRenamedTpl, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertNotOut(resRenamedTpl, 'RETURN: 回源节点');
      assertNotOut(resRenamedTpl, 'BLOCKED');
    },
  },

  // 250c: 多趟收尾与签名元数据——中性回程 / 多波次真实修复 / 任务集签名同版本三态。
  // 本场景族拆自原 250 单场景，断言与失败信息保持不变。
  {
    name: '250c 多趟收尾与签名元数据：中性回程、多波次修复、任务集签名三态',
    run: (dir) => {
      writeIntakeArtifacts(dir);
      const taskPath = '.specs/' + CHANGE_ID + '/TASK.md';
      writeFixReturnSummaries(dir, ['T01', 'T-FIX-01']);
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', FIX_RETURN_REVIEW_TEXT);
      // state 不变量统一走 assertStateOnlyChanged（白名单外深比 + history 旧前缀稳定 + 恰新增
      // 一条 exit-applied）——白名单仅 currentNode（既有路由覆盖 next）、status（既有 apply 写
      // running/completed）、history（既有出口事件追加）；execute 证据的 completedChecks 已预置，
      // 不在白名单内假豁免。

      // 250b 正常多趟最终 exit：无 Fix 任务、历史家族出口签名 == 当前 TASK 签名 → 中性
      // RETURN（正常多趟收尾，非 Fix 回修）；不得出现 FIX-BATCH；NODE/state 与收口前一致。
      const normalTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n';
      const normalSignature = routeNodeModule.taskSetSignature(normalTaskText);
      writeFile(dir, taskPath, normalTaskText);
      writeState(dir, fixReturnBaseState({
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
      if (afterNormal.currentNode !== 'review' || afterNormal.completedNodes.join(',') !== FIX_RETURN_FAMILY_COMPLETED) {
        throw new Error('正常多趟回程应只覆盖路由到 review 且 completedNodes 不变，实际 '
          + JSON.stringify({ currentNode: afterNormal.currentNode, completedNodes: afterNormal.completedNodes }));
      }
      const [normalAppended] = assertStateOnlyChanged(beforeNormal, afterNormal, {
        label: '250b 正常多趟回程',
        allowed: ['currentNode', 'status', 'history'],
      });
      // m-14 新版本元数据锚：exit-applied 事件带 signatureAlgo 且签名值为 vN:<digest> 形态
      if (!normalAppended || normalAppended.node !== 'execute' || normalAppended.change !== CHANGE_ID
        || normalAppended.taskSetSignature !== normalSignature
        || !/^v\d+:[0-9a-f]{64}$/.test(String(normalAppended.taskSetSignature))
        || normalAppended.signatureAlgo !== routeNodeModule.TASK_SET_SIGNATURE_ALGO) {
        throw new Error('正常多趟出口事件应记录本 change + vN:<digest> 签名 + signatureAlgo 元数据，实际 '
          + JSON.stringify(normalAppended));
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
      writeState(dir, fixReturnBaseState({
        evidence: fixReturnFamilyEvidence(['T01', 'T-FIX-01']),
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

      writeFile(dir, '.specs/' + CHANGE_ID + '/T02-SUMMARY.md', strictSummary('T02'));
      // 250j~l m-14 C3 三态（guard exit 入口签名比对消费点）：同版本一致 → 放行；
      // 同版本不一致 → BLOCK；跨算法版本 → SIGNATURE-ALGO WARN 跳过比对不阻断。
      writeFile(dir, 'flow-kit/templates/TASK.md',
        '# TASK 模板\n\n## Fix Tasks（来自 REVIEW / INTEGRATION）\n');
      const renamedTplTaskText = '# TASK\n\n' + fixTaskBlock('T01', 'done') + '\n'
        + '## Fix Tasks ##\n\n' + fixTaskBlock('T02', 'done') + '\n';
      writeFile(dir, taskPath, renamedTplTaskText);
      const c3Evidence = fixReturnFamilyEvidence(['T01', 'T02']);
      const c3Digest = routeNodeModule.parseTaskSetSignature(
        routeNodeModule.taskSetSignature(renamedTplTaskText))?.digest;
      writeState(dir, fixReturnBaseState({ evidence: c3Evidence, history: [], taskHash: routeNodeModule.taskSetSignature(renamedTplTaskText) }));
      const resC3Same = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resC3Same, 0);
      assertNotOut(resC3Same, 'BLOCKED');
      // 同版本不一致（占位 digest）→ 新 change BLOCK 任务集被修改
      writeState(dir, fixReturnBaseState({ evidence: c3Evidence, history: [], taskHash: 'v1:' + '0'.repeat(64) }));
      const resC3Diff = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resC3Diff, 1);
      assertOut(resC3Diff, 'BLOCKED: TASK.md 任务集被修改');
      // 跨算法版本（v2 值 + v2 声明）→ 不可比，WARN 跳过比对，不误拦任务集
      writeState(dir, fixReturnBaseState({ evidence: c3Evidence, history: [], taskHash: 'v2:' + c3Digest }));
      const resC3Skew = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resC3Skew, 0);
      assertOut(resC3Skew, 'SIGNATURE-ALGO WARN');
      assertNotOut(resC3Skew, 'BLOCKED: TASK.md 任务集被修改');
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
      assertExit(runStateWithProtocol(dir, ['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md']), 0);
      const recDoneExit = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(recDoneExit, 0);
      assertOut(recDoneExit, 'FIX-BATCH: 回源节点 review（execute 出口已完成）');
      assertOut(recDoneExit, 'NODE: review');
      assertExit(runStateWithProtocol(dir, ['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md']), 0);
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
      assertExit(runStateWithProtocol(dir, ['skill-load', 'execute', 'flow-comet-execute', '--prompt', 'flow-kit/prompts/4-dev.md']), 0);
      const recDoneVerifyExit = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(recDoneVerifyExit, 0);
      assertOut(recDoneVerifyExit, 'FIX-BATCH: 回源节点 verify（execute 出口已完成）');
      assertOut(recDoneVerifyExit, 'NODE: verify');
      assertExit(runStateWithProtocol(dir, ['skill-load', 'verify', 'flow-comet-verify', '--prompt', 'flow-kit/prompts/7-integration.md']), 0);
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
      const rParNext = runStateWithProtocol(dir, ['next']);
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
      assertExit(runStateWithProtocol(dir, ['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md']), 0);
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
      assertExit(runStateWithProtocol(dir, ['skill-load', 'review', 'flow-comet-review', '--prompt', 'flow-kit/prompts/6-review.md']), 0);
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
      assertExit(runStateWithProtocol(dir, ['skill-load', 'subagent-execute', 'flow-comet-dev', '--prompt', 'flow-kit/prompts/4-dev.md']), 0);
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
      const resReview = runStateWithProtocol(dir, ['next']);
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
      const resVerify = runStateWithProtocol(dir, ['next']);
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
      const resNoFix = runStateWithProtocol(dir, ['next']);
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
      const resDoneRollback = runStateWithProtocol(dir, ['next']);
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
      const resParallelReview = runStateWithProtocol(dir, ['next']);
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
      const resParallelVerify = runStateWithProtocol(dir, ['next']);
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
      const resDoneParallel = runStateWithProtocol(dir, ['next']);
      assertExit(resDoneParallel, 0);
      assertOut(resDoneParallel, 'FIX-BATCH: 归位 subagent-execute（源节点 review）');
      assertOut(resDoneParallel, 'NODE: subagent-execute');
      assertNotOut(resDoneParallel, 'NODE: execute');
      assertNotOut(resDoneParallel, 'BLOCKED');
      after = readScenarioState(dir);
      if (after.currentNode !== 'subagent-execute') {
        throw new Error('done-but-unclosed 并行变体 next 后 currentNode 应为 subagent-execute，实际 ' + JSON.stringify(after.currentNode));
      }
      // ⑧ m-12 next 入口第 1~3 轮递增：逐轮重置驻留 review，审计后缀第 n/3 轮且计数器同步 +1
      writeFile(dir, taskPath, fixBatchTaskText('pending'));
      for (let round = 1; round <= 3; round += 1) {
        writeState(dir, base);
        const stRound = readScenarioState(dir);
        stRound.fixRoundsByChange = { [CHANGE_ID]: round - 1 };
        writeState(dir, stRound);
        const resRound = runStateWithProtocol(dir, ['next']);
        assertExit(resRound, 0);
        assertOut(resRound, 'FIX-BATCH: 归位 execute（源节点 review）（第 ' + round + '/3 轮）');
        const stAfterRound = readScenarioState(dir);
        if (stAfterRound.fixRoundsByChange?.[CHANGE_ID] !== round) {
          throw new Error('next 第 ' + round + ' 轮归位后计数器应为 ' + round + '，实际 '
            + JSON.stringify(stAfterRound.fixRoundsByChange));
        }
      }
      // ⑨ 第 4 轮新 change BLOCK：state 字节零改写（不写 currentNode、不写计数器）
      writeState(dir, { ...base, fixRoundsByChange: { [CHANGE_ID]: 3 } });
      const statePath = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      const beforeRound4 = fs.readFileSync(statePath, 'utf8');
      const resRound4 = runStateWithProtocol(dir, ['next']);
      assertExit(resRound4, 1);
      assertOut(resRound4, 'BLOCKED: Fix 批次受控归位已达 3 轮上限');
      assertOut(resRound4, '继续修');
      assertOut(resRound4, '停止');
      if (fs.readFileSync(statePath, 'utf8') !== beforeRound4) {
        throw new Error('next 第 4 轮 BLOCK 必须 state 字节零改写');
      }
      const stBlocked = readScenarioState(dir);
      if (stBlocked.currentNode !== 'review' || stBlocked.fixRoundsByChange?.[CHANGE_ID] !== 3) {
        throw new Error('next 第 4 轮 BLOCK 后 currentNode/计数器不得改写，实际 '
          + JSON.stringify({ currentNode: stBlocked.currentNode, rounds: stBlocked.fixRoundsByChange }));
      }
      // ⑨b F5：非法授权形态（仅 round，缺 at/source）在 next 链路上仍按未授权 fail-closed——
      // 继续 BLOCK、state 字节零改写、currentNode 保持 review、计数器保持 3。
      const stBadOverride = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      stBadOverride.evidence.review.fixRoundOverride = { round: 4 };
      writeState(dir, stBadOverride);
      const badOverrideBytes = fs.readFileSync(statePath, 'utf8');
      const resBadOverride = runStateWithProtocol(dir, ['next']);
      assertExit(resBadOverride, 1);
      assertOut(resBadOverride, 'BLOCKED: Fix 批次受控归位已达 3 轮上限');
      assertNotOut(resBadOverride, '（第 4/3 轮）');
      if (fs.readFileSync(statePath, 'utf8') !== badOverrideBytes) {
        throw new Error('F5 缺 at/source 的授权形态必须在 next 链路上 state 字节零改写');
      }
      const stBadAfter = readScenarioState(dir);
      if (stBadAfter.currentNode !== 'review' || stBadAfter.fixRoundsByChange?.[CHANGE_ID] !== 3) {
        throw new Error('F5 缺 at/source 不得放行第 4 轮（currentNode 保持 review、计数保持 3），实际 '
          + JSON.stringify({ currentNode: stBadAfter.currentNode, rounds: stBadAfter.fixRoundsByChange }));
      }
      // ⑩ 用户显式授权（嵌套 evidence，完整三元组）→ next 第 4 轮放行并写盘
      const stOverride = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      stOverride.evidence.review.fixRoundOverride = { round: 4, at: '2026-09-25T00:00:00.000Z', source: 'fixture-user' };
      writeState(dir, stOverride);
      const resOverride = runStateWithProtocol(dir, ['next']);
      assertExit(resOverride, 0);
      assertOut(resOverride, '（第 4/3 轮）');
      const stAuthorized = readScenarioState(dir);
      if (stAuthorized.currentNode !== 'execute' || stAuthorized.fixRoundsByChange?.[CHANGE_ID] !== 4) {
        throw new Error('next 授权后第 4 轮应放行归位（currentNode=execute、计数器=4），实际 '
          + JSON.stringify({ currentNode: stAuthorized.currentNode, rounds: stAuthorized.fixRoundsByChange }));
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
      const res = runStateWithProtocol(dir, ['next']);
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
      const resNoEvidence = runStateWithProtocol(dir, ['next']);
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
      const resNoAnyEvidence = runStateWithProtocol(dir, ['next']);
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
      const res = runStateWithProtocol(dir, ['next']);
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
      const resNoEvidence = runStateWithProtocol(dir, ['next']);
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
      const resNoAnyEvidence = runStateWithProtocol(dir, ['next']);
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
      const res = runStateWithProtocol(dir, ['next']);
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
      const resRollback = runStateWithProtocol(dir, ['next']);
      assertExit(resRollback, 0);
      assertNotOut(resRollback, 'BLOCKED');
      assertOut(resRollback, 'FIX-BATCH: 归位 execute（源节点 review）');
      assertOut(resRollback, 'NODE: execute');
      // 旧 change 缺 fixRoundsByChange 字段 → 缺省 0，从第 1 轮计数且不 BLOCK（AC-5 旧兼容）
      assertOut(resRollback, '（第 1/3 轮）');
      const stLegacyRollback = readScenarioState(dir);
      if (stLegacyRollback.currentNode !== 'execute' || stLegacyRollback.fixRoundsByChange?.[CHANGE_ID] !== 1) {
        throw new Error('旧 change 回退态 next 后应归位 execute 且计数器缺省 0→1，实际 '
          + JSON.stringify({ currentNode: stLegacyRollback.currentNode, rounds: stLegacyRollback.fixRoundsByChange }));
      }
      // ② 旧 change 回程态（无 newChange 字段：全 done + REVIEW.md + 源节点未完成）→ NODE: review，不得 BLOCK
      writeFile(dir, taskPath, fixBatchTaskText('done'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T01-SUMMARY.md', strictSummary('T01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/T-FIX-01-SUMMARY.md', strictSummary('T-FIX-01'));
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n- 无\n\n### Major\n\n- 无\n\n### Minor\n\n- 无\n\n## 结论\n\n待回源出口。\n');
      writeState(dir, oldState);
      const resReturn = runStateWithProtocol(dir, ['next']);
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
      const resReturnNoMarker = runStateWithProtocol(dir, ['next']);
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
  // 「## 修复回路状态机路径」段，段内含受控归位 + 回源节点跑出口 + 禁止绕过；不得把
  // 直接 exit 源节点收场或 advance 当正常路径（反捷径文本锚）。
  // 布局感知（端到端冒烟副本缺陷）：技能树从 suite 脚本自身位置推导
  // （<skillsRoot>/flow-comet/scripts/ → 组件技能为 <skillsRoot> 下同级目录），权威源
  // .flow-comet/skills/ 与安装副本 .claude|.agents|.dsh/skills/ 同一相对布局通吃。
  {
    name: '258 技能文本锁：三节点 SKILL 含修复回路状态机路径（禁止直接 exit/advance 为正常路径）',
    run: (dir) => {
      const componentSkills = ['flow-comet-execute', 'flow-comet-review', 'flow-comet-verify'];
      // 布局感知回归锚（合成安装副本）：suite 位于 <skillsRoot>/flow-comet/scripts/ 时组件技能
      // 必须解析到同级 <skillsRoot>/<skill>/SKILL.md——与权威源 .flow-comet 布局无关
      //（旧实现硬编码 REPO_ROOT/.flow-comet/skills → 此锚变红）。
      const syntheticSkillsRoot = path.join(dir, 'synthetic-carrier', '.claude', 'skills');
      const syntheticScriptsDir = path.join(syntheticSkillsRoot, 'flow-comet', 'scripts');
      for (const nodeSkill of componentSkills) {
        writeFile(dir, path.join('synthetic-carrier', '.claude', 'skills', nodeSkill, 'SKILL.md'),
          '## 修复回路状态机路径\n\n受控归位（合成布局锚）\n');
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
      // 真实三节点文本锁（ADR-016 重定向）：原「三册段正文 sha256 完全一致」的逐字锁**作废**，
      // 改为「三册各含要点句与条件句 + 该段正文**仅一处**（权威 = `reference/fix-loop.md`）+
      // 原 6 关键词与「禁 `advance` 作正常路径」断言**迁到权威处**」。判据抽成纯函数（单一实现：
      // 真实判据与反向构造探针共用），逐条自带反向构造。
      const componentTexts = new Map();
      for (const nodeSkill of componentSkills) {
        componentTexts.set(nodeSkill, fs.readFileSync(resolveComponentSkillFile(nodeSkill), 'utf8'));
      }
      const fixLoopAuthorityPath = path.join(__dirname, '..', 'reference', 'fix-loop.md');
      if (!fs.existsSync(fixLoopAuthorityPath)) {
        throw new Error(FIX_LOOP_AUTHORITY_REL + ' 不在场（修复回路段的唯一权威处缺失）');
      }
      const fixLoopAuthorityText = fs.readFileSync(fixLoopAuthorityPath, 'utf8');
      const fixLoopSources = { books: componentTexts, authority: fixLoopAuthorityText };
      const fixLoopProblems = fixLoopStateMachineProblems(fixLoopSources);
      if (fixLoopProblems.length > 0) {
        throw new Error('修复回路状态机路径文本锁不符（重定向后判据）: ' + fixLoopProblems.join('; '));
      }
      // 反向构造（同一判据驱动，逐条对应重定向后的两侧）：
      // ① 逐册抽掉任一要点 token ⇒ 必报（三册各自的要点句在场）；
      // ② 权威处逐条抽掉关键词 ⇒ 必报（原 6 关键词已迁到权威处）；
      // ③ 把权威段落复制进任一册 ⇒ 必报「第二份正文」（正文唯一——原 sha256 锁**要求**三份一致，
      //    恰恰抓不到这一侧）；④ 册内还原 `advance` 捷径 / 直接 exit 收场 ⇒ 必报。
      const stripFixLoopToken = (text, token) => text.split(token).join('（反向构造：抽掉）');
      for (const [nodeSkill, text] of componentTexts) {
        for (const [label, tokens] of FIX_LOOP_BOOK_ELEMENT_GROUPS) {
          const probed = new Map(componentTexts).set(nodeSkill, stripFixLoopToken(text, tokens[0]));
          if (probed.get(nodeSkill) === text) continue;
          if (!fixLoopStateMachineProblems({ ...fixLoopSources, books: probed }).some((p) => p.includes(label))) {
            throw new Error('反向构造判别力缺失（' + nodeSkill + ' 抽掉「' + label + '」要点 token 未被判违规）');
          }
        }
      }
      for (const keyword of FIX_LOOP_AUTHORITY_KEYWORDS) {
        if (!fixLoopAuthorityText.includes(keyword)) continue; // 缺失已由真实判据报告
        if (!fixLoopStateMachineProblems({
          ...fixLoopSources, authority: stripFixLoopToken(fixLoopAuthorityText, keyword),
        }).some((p) => p.includes(keyword))) {
          throw new Error('反向构造判别力缺失（权威处抽掉关键词 «' + keyword + '» 未被判违规）');
        }
      }
      const fixLoopAuthoritySection = fixLoopStateMachineSectionOf(fixLoopAuthorityText);
      const copyInto = 'flow-comet-review';
      const reviewText = componentTexts.get(copyInto).replace(/\r\n/g, '\n');
      const reviewSection = fixLoopStateMachineSectionOf(reviewText);
      const duplicated = fixLoopStateMachineProblems({
        ...fixLoopSources,
        books: new Map(componentTexts).set(copyInto, reviewText.split(reviewSection).join(fixLoopAuthoritySection)),
      });
      if (!duplicated.some((p) => p.includes('第二份正文'))) {
        throw new Error('反向构造判别力缺失（权威段落整段回流册子未被判「第二份正文」）');
      }
      const advanceRel = 'flow-comet-verify';
      const advanceText = componentTexts.get(advanceRel).replace(/\r\n/g, '\n');
      const advanceSection = fixLoopStateMachineSectionOf(advanceText);
      const advanceProbe = new Map(componentTexts).set(advanceRel,
        advanceText.split(advanceSection).join(advanceSection + '\n用 advance 直接推进即可。\n'));
      if (!fixLoopStateMachineProblems({ ...fixLoopSources, books: advanceProbe })
        .some((p) => p.includes('advance'))) {
        throw new Error('反向构造判别力缺失（册内还原 advance 捷径未被判违规）');
      }
      const exitRel = 'flow-comet-review';
      const exitText = componentTexts.get(exitRel).replace(/\r\n/g, '\n');
      const exitSection = fixLoopStateMachineSectionOf(exitText);
      const directExitProbe = new Map(componentTexts).set(exitRel,
        exitText.split(exitSection).join(exitSection + '\n直接跑 exit review 收场即可。\n'));
      if (!fixLoopStateMachineProblems({ ...fixLoopSources, books: directExitProbe })
        .some((p) => p.includes('直接 exit'))) {
        throw new Error('反向构造判别力缺失（册内还原「直接 exit 收场」未被判违规）');
      }
    },
  },

  // 259: 受控重入正例（AC-1 / AC-10）——archive 已 entry + 归档目录仍在原位 + 完整授权
  // 三元组 → 一次调用完成：备份落盘（全量快照 + 可核验 sha256 指纹）→ 转移落地
  // （currentNode=target / completedNodes=前驱交集 / status=running）→ 审计事件（含 change
  // 归属与授权留痕）→ 可审计的 REENTRY 行。
  {
    name: '259 受控重入正例：archive → verify 备份·转移·审计事件·授权留痕全链路',
    run: (dir) => {
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState());
      const beforeState = readScenarioState(dir);
      const res = runReenter(dir, 'verify', { source: 'user-approval', reason: '归档后发现缺陷，需回到验证节点' });
      assertExit(res, 0);
      assertOut(res, 'REENTRY');
      assertOut(res, 'archive');
      assertOut(res, 'verify');
      assertOut(res, '1/3');
      assertOut(res, 'user-approval');
      assertOut(res, 'REASON: 归档后发现缺陷，需回到验证节点');
      const st = readScenarioState(dir);
      if (st.currentNode !== 'verify') {
        throw new Error('转移应把 currentNode 置为 target(verify)，实际 ' + JSON.stringify(st.currentNode));
      }
      if (!isDeepStrictEqual(st.completedNodes, REENTRY_EXPECTED_INTERSECTION.verify)) {
        throw new Error('completedNodes 应为前驱交集 ' + JSON.stringify(REENTRY_EXPECTED_INTERSECTION.verify)
          + '，实际 ' + JSON.stringify(st.completedNodes));
      }
      if (st.status !== 'running') {
        throw new Error('重入应把 status 置为 running，实际 ' + JSON.stringify(st.status));
      }
      // 除四类机器字段与 evidence（授权留痕）外，state 其余字段逐项不变、不得新增/删除
      const mutable = new Set(['currentNode', 'completedNodes', 'status', 'history', 'evidence']);
      for (const key of Object.keys(st)) {
        if (mutable.has(key)) continue;
        if (!isDeepStrictEqual(beforeState[key], st[key])) {
          throw new Error('受控重入不得改写 ' + key + '：before=' + JSON.stringify(beforeState[key])
            + ' after=' + JSON.stringify(st[key]));
        }
      }
      for (const key of Object.keys(beforeState)) {
        if (!(key in st)) throw new Error('受控重入不得删除 state 字段: ' + key);
      }
      // history：旧前缀逐字稳定 + 恰新增一条 reentry-applied
      const history = Array.isArray(st.history) ? st.history : [];
      if (history.length !== beforeState.history.length + 1) {
        throw new Error('history 应恰新增 1 条，实际新增 ' + (history.length - beforeState.history.length)
          + '：' + JSON.stringify(history.slice(beforeState.history.length)));
      }
      if (!isDeepStrictEqual(history.slice(0, beforeState.history.length), beforeState.history)) {
        throw new Error('history 旧前缀被改写（既有事件必须逐字稳定）');
      }
      const event = history[history.length - 1];
      if (!event || event.event !== 'reentry-applied') {
        throw new Error('新增 history 事件应为 reentry-applied：' + JSON.stringify(event));
      }
      if (event.from !== 'archive' || event.to !== 'verify') {
        throw new Error('审计事件应记录 from=archive / to=verify，实际 '
          + JSON.stringify({ from: event.from, to: event.to }));
      }
      if (event.round !== 1) {
        throw new Error('首次重入轮次应为 1，实际 ' + JSON.stringify(event.round));
      }
      if (event.change !== CHANGE_ID) {
        throw new Error('reentry-applied 事件必须带 change 字段（跨 change 轮次隔离的唯一依据），实际 '
          + JSON.stringify(event.change));
      }
      if (typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at))) {
        throw new Error('审计事件应带可解析的 at 时间戳，实际 ' + JSON.stringify(event.at));
      }
      const authorization = event.authorization;
      if (!authorization || authorization.round !== 1 || authorization.source !== 'user-approval'
        || authorization.target !== 'verify'
        || typeof authorization.at !== 'string' || authorization.at.trim() === '') {
        throw new Error('审计事件 authorization 记录不完整（round / at / source / target 与本次调用绑定）：'
          + JSON.stringify(authorization));
      }
      if (typeof event.backup !== 'string' || event.backup.trim() === '') {
        throw new Error('审计事件应记录备份路径，实际 ' + JSON.stringify(event.backup));
      }
      if (typeof event.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(event.fingerprint)) {
        throw new Error('审计事件应记录 sha256 指纹（64 位小写十六进制），实际 ' + JSON.stringify(event.fingerprint));
      }
      // 授权嵌套留痕（evidence.<target>.reentryAuthorization）
      const record = st.evidence?.verify?.reentryAuthorization;
      if (!record) {
        throw new Error('evidence.verify.reentryAuthorization 授权留痕缺失：' + JSON.stringify(st.evidence));
      }
      if (record.round !== 1 || record.source !== 'user-approval' || record.target !== 'verify'
        || typeof record.at !== 'string' || record.at.trim() === '') {
        throw new Error('授权留痕字段不完整：' + JSON.stringify(record));
      }
      if (record.backup !== event.backup || record.fingerprint !== event.fingerprint) {
        throw new Error('授权留痕的 backup / fingerprint 应与审计事件一致：' + JSON.stringify({ record, event }));
      }
      // --reason 必须落盘（事件 + 嵌套授权记录）：只打印不落盘的必填参数无法支撑事后审计追溯
      if (event.reason !== '归档后发现缺陷，需回到验证节点') {
        throw new Error('审计事件应记录本次 --reason（可追溯），实际 ' + JSON.stringify(event.reason));
      }
      if (record.reason !== event.reason) {
        throw new Error('授权留痕的 reason 应与审计事件逐字一致：' + JSON.stringify({ record: record.reason, event: event.reason }));
      }
      // 备份：路径形态 + 全量快照语义 + 指纹可核验
      const backupPath = path.isAbsolute(event.backup) ? event.backup : path.join(dir, event.backup);
      if (!fs.existsSync(backupPath)) {
        throw new Error('备份文件不在场：' + backupPath);
      }
      const backupRel = path.relative(dir, backupPath).split(path.sep).join('/');
      if (!backupRel.startsWith('.specs/' + CHANGE_ID + '/.reentry-backups/')
        || !/-pre-verify\.json$/.test(path.basename(backupPath))) {
        throw new Error('备份路径应符合 .specs/<id>/.reentry-backups/<ISO>-pre-<target>.json，实际 ' + backupRel);
      }
      const backupBytes = fs.readFileSync(backupPath);
      const fingerprint = createHash('sha256').update(backupBytes).digest('hex');
      if (fingerprint !== event.fingerprint) {
        throw new Error('备份指纹与文件内容不一致（AC-9 可核验）：事件=' + event.fingerprint + ' 实算=' + fingerprint);
      }
      if (!isDeepStrictEqual(JSON.parse(backupBytes.toString('utf8')), beforeState)) {
        throw new Error('备份应为重入前 state 的全量快照');
      }
    },
  },

  // 260: 授权门禁 fail-closed（AC-2）——缺授权 / source 空串 / source 纯空白 → BLOCK、
  // state 字节零改写、零备份、零事件；授权形态（round 正整数、at / source 非空字符串、
  // target 与授权一致）由 route-node 纯函数单一权威判定（形态锚 + 合法形态放行对照）。
  {
    name: '260 授权 fail-closed：缺授权·空/纯空白 source BLOCK 零改写 + 形态纯函数锚',
    run: (dir) => {
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState());
      const bytes = readStateBytes(dir);
      const blockedCases = [
        ['缺授权（无 --authorized-by / --reason）', () => runReenter(dir, 'verify')],
        ['source 空串', () => runReenter(dir, 'verify', { source: '', reason: 'x' })],
        ['source 纯空白', () => runReenter(dir, 'verify', { source: '   ', reason: 'x' })],
      ];
      for (const [label, call] of blockedCases) {
        const res = call();
        assertExit(res, 1);
        assertOut(res, 'BLOCKED');
        assertStateBytesUnchanged(dir, bytes, label);
      }
      if (reentryBackupFiles(dir).length !== 0) {
        throw new Error('授权非法路径不得产生备份：' + JSON.stringify(reentryBackupFiles(dir)));
      }
      const st = readScenarioState(dir);
      const reentryEvents = (st.history || []).filter((e) => e.event === 'reentry-applied');
      if (reentryEvents.length !== 0) {
        throw new Error('授权非法路径不得写审计事件：' + JSON.stringify(reentryEvents));
      }
      // 授权形态纯函数锚：malformed 一律 ok:false，合法 ok:true（放行侧对照）
      const valid = { round: 1, at: '2026-09-20T00:00:00.000Z', source: 'user-approval', target: 'verify' };
      assertReentryAuthorizationShape(valid, 'verify', true, '合法三元组');
      const malformed = [
        ['缺 authorization', undefined],
        ['round=0', { ...valid, round: 0 }],
        ['round=-1', { ...valid, round: -1 }],
        ['round=1.5 非整数', { ...valid, round: 1.5 }],
        ['round="1" 类型错误', { ...valid, round: '1' }],
        ['round 缺失', { ...valid, round: undefined }],
        ['at=42 类型错误', { ...valid, at: 42 }],
        ['at 空串', { ...valid, at: '' }],
        ['at 纯空白', { ...valid, at: '  ' }],
        ['at 缺失', { ...valid, at: undefined }],
        ['source=[] 类型错误', { ...valid, source: [] }],
        ['source 空串', { ...valid, source: '' }],
        ['source 纯空白', { ...valid, source: '  ' }],
        ['source 缺失', { ...valid, source: undefined }],
        ['target 与授权不一致', { ...valid, target: 'execute' }],
      ];
      for (const [label, authorization] of malformed) {
        assertReentryAuthorizationShape(authorization, 'verify', false, label);
      }
      // 综合判定：archive 源 + 合法 target + 形态非法授权 → block（不抛异常），合法 → apply
      const decide = requireRouteNodeExport('resolveReentryDecision');
      const protocol = readScenarioProtocol(dir);
      const decideState = {
        activeChange: CHANGE_ID,
        currentNode: 'archive',
        completedNodes: [...REENTRY_FULL_COMPLETED],
        history: [],
      };
      for (const [label, authorization] of malformed) {
        const decision = decide({ protocol, state: decideState, target: 'verify', authorization });
        if (!decision || decision.ok !== false || decision.action !== 'block') {
          throw new Error('[' + label + '] resolveReentryDecision 应返回 block，实际 ' + JSON.stringify(decision));
        }
      }
      const applied = decide({ protocol, state: decideState, target: 'verify', authorization: valid });
      if (!applied || applied.ok !== true || applied.action !== 'apply' || applied.round !== 1) {
        throw new Error('合法授权 + archive 源应返回 apply / 第 1 轮，实际 ' + JSON.stringify(applied));
      }
    },
  },

  // 261: 越界拦截（AC-5 / AC-6 / AC-7）——目标不在白名单 / 协议 disabled 节点 / 源不是
  // archive / status=completed / 归档移动已发生 / 超轮次上限：一律 BLOCK 且 state 字节零改写；
  // 轮次按 change 隔离（他 change 的历史事件不占本 change 配额）——同场景断言 BLOCK 与放行两态。
  {
    name: '261 越界拦截：目标/协议/源/归档移动/上限全 BLOCK 零改写 + 轮次跨 change 隔离',
    run: (dir) => {
      // ① 目标不在白名单（design / open / archive 自身）
      for (const target of ['design', 'open', 'archive']) {
        writeReentryChangeDir(dir);
        writeState(dir, reentryArchiveState());
        const bytes = readStateBytes(dir);
        const res = runReenter(dir, target, { source: 'user-approval', reason: 'x' });
        assertExit(res, 1);
        assertOut(res, 'BLOCKED');
        assertStateBytesUnchanged(dir, bytes, '目标越界: ' + target);
      }
      // ② 协议 disabled 节点不可作目标（自定义协议禁用 verify）
      const customProtocolPath = path.join(dir, 'reentry-protocol-disabled.json');
      const customProtocol = readScenarioProtocol(dir);
      customProtocol.nodes.find((n) => n.id === 'verify').disabled = true;
      writeFile(dir, 'reentry-protocol-disabled.json', JSON.stringify(customProtocol, null, 2) + '\n');
      writeState(dir, reentryArchiveState());
      const bytesDisabled = readStateBytes(dir);
      const resDisabled = runReenter(dir, 'verify', {
        source: 'user-approval', reason: 'x', extra: ['--protocol', customProtocolPath],
      });
      assertExit(resDisabled, 1);
      assertOut(resDisabled, 'BLOCKED');
      assertStateBytesUnchanged(dir, bytesDisabled, '协议 disabled 节点');
      // ③ 源不是 archive（execute 驻留；目标 verify 形态未成立 → 不被空操作短路）
      writeState(dir, reentryArchiveState({ currentNode: 'execute' }));
      const bytesSource = readStateBytes(dir);
      const resSource = runReenter(dir, 'verify', { source: 'user-approval', reason: 'x' });
      assertExit(resSource, 1);
      assertOut(resSource, 'BLOCKED');
      assertStateBytesUnchanged(dir, bytesSource, '源不是 archive');
      // ④ status=completed（归档已出口 / 已发布形态）→ BLOCK + 人工处置或新 change 指引
      writeState(dir, reentryArchiveState({ status: 'completed' }));
      const bytesCompleted = readStateBytes(dir);
      const resCompleted = runReenter(dir, 'verify', { source: 'user-approval', reason: 'x' });
      assertExit(resCompleted, 1);
      assertOut(resCompleted, 'BLOCKED');
      assertOutMatches(resCompleted, /人工|新 ?change|hotfix/, 'status=completed 指引');
      assertStateBytesUnchanged(dir, bytesCompleted, 'status=completed');
      // ⑤ 归档移动已发生（.specs/<id>/ 不在原位，已搬入 .specs/archive/<日期>-<id>/）
      fs.rmSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true, force: true });
      writeFile(dir, '.specs/archive/2026-09-26-' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n已归档。\n');
      writeState(dir, reentryArchiveState());
      const bytesMoved = readStateBytes(dir);
      const resMoved = runReenter(dir, 'verify', { source: 'user-approval', reason: 'x' });
      assertExit(resMoved, 1);
      assertOut(resMoved, 'BLOCKED');
      assertOutMatches(resMoved, /人工|新 ?change|hotfix/, '归档移动已发生指引');
      assertStateBytesUnchanged(dir, bytesMoved, '归档移动已发生');
      // ⑥ 超轮次上限：本 change 已有 3 条 reentry-applied → 第 4 次 BLOCK + 「继续 / 停止」指引
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState({
        history: [reentryHistoryEvent(1), reentryHistoryEvent(2), reentryHistoryEvent(3)],
      }));
      const bytesCapped = readStateBytes(dir);
      const resCapped = runReenter(dir, 'verify', { source: 'user-approval', reason: 'x' });
      assertExit(resCapped, 1);
      assertOut(resCapped, 'BLOCKED');
      assertOut(resCapped, '继续');
      assertOut(resCapped, '停止');
      assertStateBytesUnchanged(dir, bytesCapped, '超轮次上限');
      // ⑦ 轮次跨 change 隔离：他 change 的 3 条事件不占本 change 配额 → 放行且为第 1 轮
      writeState(dir, reentryArchiveState({
        history: [
          reentryHistoryEvent(1, 'other-change'),
          reentryHistoryEvent(2, 'other-change'),
          reentryHistoryEvent(3, 'other-change'),
        ],
      }));
      const resIsolated = runReenter(dir, 'verify', { source: 'user-approval', reason: 'x' });
      assertExit(resIsolated, 0);
      assertOut(resIsolated, '1/3');
      const isolatedState = readScenarioState(dir);
      const appliedEvent = (isolatedState.history || [])
        .find((e) => e.event === 'reentry-applied' && e.change === CHANGE_ID);
      if (!appliedEvent || appliedEvent.round !== 1) {
        throw new Error('他 change 的轮次事件不应占用本 change 配额（本 change 应为第 1 轮），实际 '
          + JSON.stringify(appliedEvent));
      }
      // ⑧ select 入口收紧：多段路径（归档相对路径形态）与保留目录名不得被选为 activeChange
      fs.mkdirSync(path.join(dir, '.specs', 'archive', '2026-09-26-' + CHANGE_ID), { recursive: true });
      const beforeSelect = readStateBytes(dir);
      assertExit(runStateWithProtocol(dir, ['select', 'archive/2026-09-26-' + CHANGE_ID]), 1);
      assertStateBytesUnchanged(dir, beforeSelect, 'select 归档相对路径');
      assertExit(runStateWithProtocol(dir, ['select', 'archive']), 1);
      assertStateBytesUnchanged(dir, beforeSelect, 'select 保留目录名');
      // ⑧b 名字变体族：保留目录名大小写变体（ARCHIVE/Archive）、真实目录名的大小写变体（CH）与
      // 首尾空白变体在大小写不敏感文件系统上同样可达，但会让 activeChange 与实际目录名不一致
      // （轮次事件按 activeChange 精确匹配 → 配额被换键重置）→ 一律拒绝且 state 字节零改写
      assertExit(runStateWithProtocol(dir, ['select', 'ARCHIVE']), 1);
      assertStateBytesUnchanged(dir, beforeSelect, 'select 保留目录名大小写变体');
      assertExit(runStateWithProtocol(dir, ['select', 'Archive']), 1);
      assertStateBytesUnchanged(dir, beforeSelect, 'select 保留目录名混合大小写变体');
      const caseVariant = String(CHANGE_ID).toUpperCase();
      if (caseVariant !== CHANGE_ID) {
        assertExit(runStateWithProtocol(dir, ['select', caseVariant]), 1);
        assertStateBytesUnchanged(dir, beforeSelect, 'select 真实目录名大小写变体');
      }
      assertExit(runStateWithProtocol(dir, ['select', ' ' + CHANGE_ID + ' ']), 1);
      assertStateBytesUnchanged(dir, beforeSelect, 'select 首尾空白变体');
      if (readScenarioState(dir).activeChange !== CHANGE_ID) {
        throw new Error('被拒绝的 select 不得改写 activeChange：' + JSON.stringify(readScenarioState(dir).activeChange));
      }
      // ⑨ change 键被换成归档相对路径（换键重置轮次配额的绕过形态）→ 写盘前 BLOCK：本 change 的
      // 3 条事件既不得被换键忽略，也不得产生新事件 / 备份 / 机器字段改写
      writeState(dir, reentryArchiveState({
        activeChange: 'archive/2026-09-26-' + CHANGE_ID,
        history: [reentryHistoryEvent(1), reentryHistoryEvent(2), reentryHistoryEvent(3)],
      }));
      const nestedBytes = readStateBytes(dir);
      const nestedBackupsBefore = reentryBackupFiles(dir).length;
      const nestedRes = runReenter(dir, 'verify', { source: 'user-approval', reason: '换键重入' });
      assertExit(nestedRes, 1);
      assertOut(nestedRes, 'BLOCKED');
      assertStateBytesUnchanged(dir, nestedBytes, '归档相对路径 change 名');
      if (reentryBackupFiles(dir).length !== nestedBackupsBefore) {
        throw new Error('归档相对路径 change 名不得产生备份');
      }
      // ⑩ history 存在但非数组 → fail-closed BLOCK，不得静默清空覆盖审计历史
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState({ history: 'corrupted-history' }));
      const corruptBytes = readStateBytes(dir);
      const corruptRes = runReenter(dir, 'verify', { source: 'user-approval', reason: 'history 损坏' });
      assertExit(corruptRes, 1);
      assertOut(corruptRes, 'BLOCKED');
      assertOut(corruptRes, 'history');
      assertStateBytesUnchanged(dir, corruptBytes, '非数组 history');
      if (readScenarioState(dir).history !== 'corrupted-history') {
        throw new Error('损坏的 history 不得被静默清空覆盖：' + JSON.stringify(readScenarioState(dir).history));
      }
      // ⑪ 备份写入包含性：.specs/<change> 为 junction（指向 runRoot 外）→ BLOCK 零改写，
      // runRoot 外不得出现任何备份字节
      const linkedOutsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-comet-reentry-outside-'));
      writeFile(linkedOutsideDir, 'CHANGE.md', '# CHANGE\n\n## Why\n\njunction 目标。\n');
      const linkedName = 'linked-change';
      fs.symlinkSync(linkedOutsideDir, path.join(dir, '.specs', linkedName), 'junction');
      writeState(dir, reentryArchiveState({ activeChange: linkedName }));
      const linkedBytes = readStateBytes(dir);
      const linkedRes = runReenter(dir, 'verify', { source: 'user-approval', reason: 'junction 逃逸' });
      assertExit(linkedRes, 1);
      assertOut(linkedRes, 'BLOCKED');
      assertStateBytesUnchanged(dir, linkedBytes, 'junction 逃逸');
      if (fs.existsSync(path.join(linkedOutsideDir, '.reentry-backups'))) {
        throw new Error('junction 逃逸不得在 runRoot 外产生备份：'
          + JSON.stringify(fs.readdirSync(path.join(linkedOutsideDir, '.reentry-backups'))));
      }
      fs.rmSync(linkedOutsideDir, { recursive: true, force: true });
      try { fs.rmSync(path.join(dir, '.specs', linkedName), { recursive: true, force: true }); } catch { /* 场景目录整体清理兜底 */ }
      // ⑫ 上限后的显式授权续轮（AC-7 后半句）：合法授权 → 放行并计下一轮（事件 / 授权留痕带
      // 续轮标记与原因）；授权轮次不足或未达上限即传续轮 → BLOCK 且 state 字节零改写
      const threeRounds = [reentryHistoryEvent(1), reentryHistoryEvent(2), reentryHistoryEvent(3)];
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState({ history: threeRounds }));
      const continued = runReenter(dir, 'verify', {
        source: 'admin-approval', reason: '上限后显式授权续轮', extra: ['--continue-round', '4'],
      });
      assertExit(continued, 0);
      assertOut(continued, 'REENTRY');
      assertOut(continued, '续轮');
      const continuedState = readScenarioState(dir);
      if (continuedState.currentNode !== 'verify') {
        throw new Error('续轮放行后 currentNode 应为 verify，实际 ' + JSON.stringify(continuedState.currentNode));
      }
      const continuedEvent = (continuedState.history || [])
        .filter((e) => e.event === 'reentry-applied')
        .pop();
      if (!continuedEvent || continuedEvent.round !== 4 || continuedEvent.change !== CHANGE_ID
        || continuedEvent.continuationAuthorized !== true
        || continuedEvent.reason !== '上限后显式授权续轮') {
        throw new Error('续轮审计事件字段不符（round=4 / change / 续轮标记 / reason）：' + JSON.stringify(continuedEvent));
      }
      const continuedRecord = continuedState.evidence?.verify?.reentryAuthorization;
      if (!continuedRecord || continuedRecord.continuationAuthorized !== true
        || continuedRecord.reason !== '上限后显式授权续轮') {
        throw new Error('续轮授权留痕不符：' + JSON.stringify(continuedRecord));
      }
      writeState(dir, reentryArchiveState({ history: threeRounds }));
      const insufficientBytes = readStateBytes(dir);
      const insufficient = runReenter(dir, 'verify', {
        source: 'admin-approval', reason: '轮次不足', extra: ['--continue-round', '3'],
      });
      assertExit(insufficient, 1);
      assertOut(insufficient, 'BLOCKED');
      assertStateBytesUnchanged(dir, insufficientBytes, '续轮授权轮次不足');
      writeState(dir, reentryArchiveState());
      const earlyBytes = readStateBytes(dir);
      const early = runReenter(dir, 'verify', {
        source: 'admin-approval', reason: '未达上限', extra: ['--continue-round', '4'],
      });
      assertExit(early, 1);
      assertOut(early, 'BLOCKED');
      assertStateBytesUnchanged(dir, earlyBytes, '未达上限即传续轮');
      // ⑬ 写盘失败路径：原子写因临时路径被占而失败 → 非零退出、state 不截断、本次孤儿备份回滚
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState());
      const atomicBytes = readStateBytes(dir);
      const atomicBackupsBefore = reentryBackupFiles(dir);
      const blockedTempDir = path.join(dir, '.flow-comet', 'flow-comet-state.json.tmp');
      fs.mkdirSync(blockedTempDir, { recursive: true });
      const atomicRes = runReenter(dir, 'verify', { source: 'user-approval', reason: '模拟写盘失败' });
      assertExit(atomicRes, 1);
      assertStateBytesUnchanged(dir, atomicBytes, '写盘失败路径');
      if (!isDeepStrictEqual(reentryBackupFiles(dir), atomicBackupsBefore)) {
        throw new Error('写盘失败必须回滚本次孤儿备份：before=' + JSON.stringify(atomicBackupsBefore)
          + ' after=' + JSON.stringify(reentryBackupFiles(dir)));
      }
      fs.rmSync(blockedTempDir, { recursive: true, force: true });
    },
  },

  // 262: 恢复链（AC-2 的「BLOCK → 补全授权 → 放行」/ 编排顺序 / 幂等重放）——未授权 BLOCK 且
  // 字节零改写、零备份；补齐授权三元组后放行（备份 + 转移 + 审计）；重复同目标调用 = 空操作
  // （放行 + 可见提示 + 零备份新增 + 零计数 + 零事件 + 字节零改写）。
  {
    name: '262 恢复链：未授权 BLOCK → 补全授权放行 → 重复同目标空操作（零副作用）',
    run: (dir) => {
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState());
      const blockedBytes = readStateBytes(dir);
      const resBlocked = runReenter(dir, 'verify');
      assertExit(resBlocked, 1);
      assertOut(resBlocked, 'BLOCKED');
      assertStateBytesUnchanged(dir, blockedBytes, '未授权 BLOCK');
      if (reentryBackupFiles(dir).length !== 0) {
        throw new Error('未授权 BLOCK 不得产生备份');
      }
      const resAllowed = runReenter(dir, 'verify', { source: 'user-approval', reason: '用户显式授权重入' });
      assertExit(resAllowed, 0);
      assertOut(resAllowed, 'REENTRY');
      const appliedState = readScenarioState(dir);
      if (appliedState.currentNode !== 'verify') {
        throw new Error('补全授权后应放行并把 currentNode 置为 verify，实际 ' + JSON.stringify(appliedState.currentNode));
      }
      const backupsAfterApply = reentryBackupFiles(dir);
      if (backupsAfterApply.length !== 1) {
        throw new Error('放行应恰产生 1 份备份，实际 ' + JSON.stringify(backupsAfterApply));
      }
      const appliedEvents = (appliedState.history || []).filter((e) => e.event === 'reentry-applied');
      if (appliedEvents.length !== 1) {
        throw new Error('放行应恰写 1 条 reentry-applied 事件，实际 ' + JSON.stringify(appliedEvents));
      }
      const noopBytes = readStateBytes(dir);
      const resNoop = runReenter(dir, 'verify', { source: 'user-approval', reason: '重复调用同目标' });
      assertExit(resNoop, 0);
      assertNotOut(resNoop, 'BLOCKED');
      if (outputText(resNoop).trim() === '') {
        throw new Error('空操作应打印一条可见提示');
      }
      assertStateBytesUnchanged(dir, noopBytes, '重复同目标空操作');
      if (!isDeepStrictEqual(reentryBackupFiles(dir), backupsAfterApply)) {
        throw new Error('空操作不得新增备份：' + JSON.stringify(reentryBackupFiles(dir)));
      }
      const noopState = readScenarioState(dir);
      if ((noopState.history || []).length !== (appliedState.history || []).length) {
        throw new Error('空操作不得写事件：history 长度由 ' + (appliedState.history || []).length
          + ' 变为 ' + (noopState.history || []).length);
      }
    },
  },

  // 263: 旧 change（无 newChange 字段 · AC-3 与本 change 的显式例外）——授权门禁对一切
  // change 无条件 fail-closed：旧 change 未授权同样 BLOCK（安全面不因 change 新旧降级）；
  // 合法授权放行并与新 change 走同一转移 / 审计路径。
  {
    name: '263 旧 change：未授权仍 BLOCK（显式例外）+ 合法授权放行',
    run: (dir) => {
      writeReentryChangeDir(dir);
      const legacyState = reentryArchiveState();
      delete legacyState.newChange;
      writeState(dir, legacyState);
      const blockedBytes = readStateBytes(dir);
      const resBlocked = runReenter(dir, 'verify');
      assertExit(resBlocked, 1);
      assertOut(resBlocked, 'BLOCKED');
      assertStateBytesUnchanged(dir, blockedBytes, '旧 change 未授权');
      if (reentryBackupFiles(dir).length !== 0) {
        throw new Error('旧 change 未授权 BLOCK 不得产生备份');
      }
      const resAllowed = runReenter(dir, 'verify', { source: 'user-approval', reason: '旧 change 显式授权' });
      assertExit(resAllowed, 0);
      assertOut(resAllowed, 'REENTRY');
      const st = readScenarioState(dir);
      if (st.currentNode !== 'verify') {
        throw new Error('旧 change 合法授权应放行并转移，实际 ' + JSON.stringify(st.currentNode));
      }
      if (!isDeepStrictEqual(st.completedNodes, REENTRY_EXPECTED_INTERSECTION.verify)) {
        throw new Error('旧 change 转移后 completedNodes 应为前驱交集，实际 ' + JSON.stringify(st.completedNodes));
      }
      const appliedEvent = (st.history || []).find((e) => e.event === 'reentry-applied');
      if (!appliedEvent || appliedEvent.change !== CHANGE_ID || appliedEvent.round !== 1) {
        throw new Error('旧 change 的审计事件应带 change 且为第 1 轮，实际 ' + JSON.stringify(appliedEvent));
      }
      // 最小旧 state（仅 7 个键、无 readState 兼容默认字段）：apply 只写本次实际改动的字段，
      // 兼容默认值不得随重入回写（键集逐项不变——「其余字段零改写」口径覆盖真实最小旧 state）
      const minimalLegacy = {
        activeChange: CHANGE_ID,
        currentNode: 'archive',
        completedNodes: [...REENTRY_FULL_COMPLETED],
        evidence: {},
        verifyFailures: 0,
        status: 'running',
        history: [{ event: 'exit-applied', node: 'verify', at: '2026-09-20T00:00:00.000Z', change: CHANGE_ID }],
      };
      writeState(dir, minimalLegacy);
      const minimalKeysBefore = Object.keys(readScenarioState(dir)).sort();
      const minimalRes = runReenter(dir, 'verify', { source: 'user-approval', reason: '最小旧 state 重入' });
      assertExit(minimalRes, 0);
      assertOut(minimalRes, 'REENTRY');
      const minimalAfter = readScenarioState(dir);
      const minimalKeysAfter = Object.keys(minimalAfter).sort();
      if (!isDeepStrictEqual(minimalKeysAfter, minimalKeysBefore)) {
        throw new Error('最小旧 state 重入后键集必须逐项不变（兼容默认值不得回写）：before='
          + JSON.stringify(minimalKeysBefore) + ' after=' + JSON.stringify(minimalKeysAfter));
      }
      for (const defaultKey of ['executionMode', 'directOverride', 'branchMode', 'enablePrReview', 'branchPrefix']) {
        if (defaultKey in minimalAfter) {
          throw new Error('readState 兼容默认字段不得随重入回写: ' + defaultKey);
        }
      }
    },
  },

  // 264: history 事件类型集合静态锚（唯一事件类型例外 / 禁止扩散）——扫描引擎生产脚本的
  // 事件类型字面量：写侧集合必须恰为 {exit-applied, reentry-applied, replan-applied,
  // advance-forced}（新增类型必须由引擎写侧真实落地 + 显式更新本锚，未落地即 RED），读侧集合
  // 必须 ⊆ 允许集（出现允许集外的事件类型即红）；另锚新的两类写点必须带跨 change 归属字段
  // （replan-applied → change）与「被跳过的出口门禁」标识（advance-forced → skipped：
  // exit:<node>），事件对象的动态断言在 259 / 263 / 受控计划重校场景族。
  {
    name: '264 history 事件类型集合静态锚：既有类型 + replan-applied / advance-forced（新增即红、判据不放宽）',
    run: () => {
      const allowed = ['exit-applied', 'reentry-applied', 'replan-applied', 'advance-forced'];
      const scripts = fs.readdirSync(__dirname)
        .filter((f) => f.endsWith('.mjs') && f !== 'guard-self-test.mjs' && f !== 'system-test.mjs');
      const writers = new Set();
      const readers = new Set();
      const writeSites = new Map();
      for (const file of scripts) {
        const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
        for (const match of text.matchAll(/event:\s*'([a-z][a-z-]*)'/g)) {
          writers.add(match[1]);
          writeSites.set(match[1], { file, text, index: match.index });
        }
        for (const match of text.matchAll(/\.event\s*(?:===|!==)\s*'([a-z][a-z-]*)'/g)) {
          readers.add(match[1]);
        }
      }
      const extra = [...new Set([...writers, ...readers])].filter((type) => !allowed.includes(type));
      if (extra.length > 0) {
        throw new Error('history 事件类型出现允许集外的新类型（唯一事件类型例外不得扩散）: ' + extra.join(', ')
          + '；写侧=' + [...writers].join(',') + '；读侧=' + [...readers].join(','));
      }
      const missingWriters = allowed.filter((type) => !writers.has(type));
      if (missingWriters.length > 0) {
        throw new Error('history 事件类型写侧缺类型（受控通道未落地即 RED）: ' + missingWriters.join(', ')
          + '；实际写侧=' + [...writers].join(','));
      }
      // 跨 change 归属字段锚：轮次/配额按 change 隔离依赖事件的 change 字段（reentry / replan 同判据）
      const changeFieldTypes = ['reentry-applied', 'replan-applied'];
      for (const type of changeFieldTypes) {
        const site = writeSites.get(type);
        if (!site) throw new Error(type + ' 写点缺失（审计事件必须由引擎脚本写入）');
        const windowText = site.text.slice(site.index, site.index + 800);
        if (!/\bchange\s*:/.test(windowText)) {
          throw new Error(type + ' 写点必须带 change 字段（跨 change 轮次隔离依据）: ' + site.file);
        }
      }
      // 强制推进留痕锚：事件必须记录被跳过的出口门禁标识（skipped: ['exit:<node>']）
      const forcedSite = writeSites.get('advance-forced');
      if (!forcedSite) throw new Error('advance-forced 写点缺失（逃生口留痕必须由引擎脚本写入）');
      const forcedWindow = forcedSite.text.slice(forcedSite.index, forcedSite.index + 800);
      if (!/\bskipped\s*:/.test(forcedWindow)) {
        throw new Error('advance-forced 写点必须带 skipped 字段（记录被跳过的出口门禁）: ' + forcedSite.file);
      }
      if (!/exit:/.test(forcedWindow)) {
        throw new Error('advance-forced 写点的 skipped 值必须标识 exit:<node> 形态的门禁: ' + forcedSite.file);
      }
    },
  },

  // 265: 幂等锚（空操作判定）——目标形态已成立（currentNode=target 且 completedNodes 已等于
  // 前驱交集）时重复调用 = 空操作：放行 + 可见提示 + 不备份 / 不计数 / 不写事件 / state 字节
  // 零改写。夹具直接构造目标形态（不经 apply 路径），同时锁定判定顺序：空操作短路必须先于
  // 源判定——否则 currentNode=verify ≠ archive 会先被源门禁误 BLOCK；但空操作短路不得先于
  // 上限判定——达上限的同目标形态必须走人工裁决 BLOCK（不得以空操作退出 0）。
  {
    name: '265 幂等锚：目标形态已成立的重复调用 = 空操作（零备份·零计数·零事件·零改写），超限同目标仍 BLOCK',
    run: (dir) => {
      writeReentryChangeDir(dir);
      writeState(dir, reentryArchiveState({
        currentNode: 'verify',
        completedNodes: [...REENTRY_EXPECTED_INTERSECTION.verify],
      }));
      const bytes = readStateBytes(dir);
      const beforeHistoryLength = (readScenarioState(dir).history || []).length;
      const res = runReenter(dir, 'verify', { source: 'user-approval', reason: '重复调用同目标' });
      assertExit(res, 0);
      assertNotOut(res, 'BLOCKED');
      if (outputText(res).trim() === '') {
        throw new Error('空操作应打印一条可见提示');
      }
      assertStateBytesUnchanged(dir, bytes, '目标形态已成立的空操作');
      if (reentryBackupFiles(dir).length !== 0) {
        throw new Error('空操作不得备份：' + JSON.stringify(reentryBackupFiles(dir)));
      }
      const st = readScenarioState(dir);
      if ((st.history || []).length !== beforeHistoryLength) {
        throw new Error('空操作不得写事件：history 长度由 ' + beforeHistoryLength + ' 变为 ' + (st.history || []).length);
      }
      if ((st.history || []).some((e) => e.event === 'reentry-applied')) {
        throw new Error('空操作不得写入 reentry-applied 事件');
      }
      // 上限判定必须先于空操作短路：达到上限的 change 即使处于同目标形态也走人工裁决 BLOCK，
      // 不得以空操作退出 0（幂等豁免不越过上限；state 仍字节零改写）
      writeState(dir, reentryArchiveState({
        currentNode: 'verify',
        completedNodes: [...REENTRY_EXPECTED_INTERSECTION.verify],
        history: [reentryHistoryEvent(1), reentryHistoryEvent(2), reentryHistoryEvent(3)],
      }));
      const cappedBytes = readStateBytes(dir);
      const cappedRes = runReenter(dir, 'verify', { source: 'user-approval', reason: '超限同目标' });
      assertExit(cappedRes, 1);
      assertOut(cappedRes, 'BLOCKED');
      assertOut(cappedRes, '继续');
      assertOut(cappedRes, '停止');
      assertNotOut(cappedRes, '空操作');
      assertStateBytesUnchanged(dir, cappedBytes, '超限同目标形态');
      if (reentryBackupFiles(dir).length !== 0) {
        throw new Error('超限同目标形态不得产生备份：' + JSON.stringify(reentryBackupFiles(dir)));
      }
      if ((readScenarioState(dir).history || []).length !== 3) {
        throw new Error('超限同目标形态不得追加审计事件');
      }
    },
  },

  // 266: replan 授权 fail-closed（AC-2 / ADR-013 决策 5）——缺 --authorized-by / 空串 /
  // 纯空白 / 缺 <reason> / 纯空白 reason → BLOCKED、state 字节（sha256）零改写、零备份、零事件；
  // 授权形态由 route-node 纯函数单一权威判定（malformed → block + 合法形态放行对照）。
  {
    name: '266 replan 授权 fail-closed：缺/空/纯空白授权与缺原因 → BLOCKED 零改写 + 形态纯函数锚',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_INITIAL);
      writeState(dir, replanExecuteState());
      // entry 形态：真实记录修订前的任务集签名（后续修订使其成为「到期签名」）
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
      const bytes = readStateBytes(dir);
      const shaBefore = createHash('sha256').update(bytes, 'utf8').digest('hex');
      const blockedCases = [
        ['缺 --authorized-by（仅位置 reason）', ['replan', '计划有缺陷：新增并行任务']],
        ['--authorized-by 空串', ['replan', '计划有缺陷：新增并行任务', '--authorized-by', '']],
        ['--authorized-by 纯空白', ['replan', '计划有缺陷：新增并行任务', '--authorized-by', '   ']],
        ['缺 <reason>（仅授权）', ['replan', '--authorized-by', 'user-approval']],
        ['<reason> 纯空白', ['replan', '   ', '--authorized-by', 'user-approval']],
      ];
      for (const [label, args] of blockedCases) {
        const res = runStateWithProtocol(dir, args);
        assertExit(res, 1);
        assertOut(res, 'BLOCKED');
        assertStateBytesUnchanged(dir, bytes, label);
        const shaNow = createHash('sha256').update(readStateBytes(dir), 'utf8').digest('hex');
        if (shaNow !== shaBefore) {
          throw new Error(label + '：state sha256 应零改写，实际 ' + shaNow + ' ≠ ' + shaBefore);
        }
      }
      if (replanBackupFiles(dir).length !== 0) {
        throw new Error('授权非法路径不得产生备份：' + JSON.stringify(replanBackupFiles(dir)));
      }
      if (replanEventsOf(readScenarioState(dir)).length !== 0) {
        throw new Error('授权非法路径不得写审计事件：' + JSON.stringify(replanEventsOf(readScenarioState(dir))));
      }
      // 授权形态纯函数锚：malformed 一律 ok:false；合法形态 ok:true 且归一化字段完整
      const valid = {
        round: 1,
        at: '2026-09-27T00:00:00.000Z',
        source: 'user-approval',
        reason: '计划有缺陷',
        node: 'execute',
      };
      const parsedValid = assertReplanAuthorizationShape(valid, 'execute', true, '合法授权三元组');
      if (!parsedValid.authorization || parsedValid.authorization.source !== 'user-approval'
        || parsedValid.authorization.reason !== '计划有缺陷' || parsedValid.authorization.node !== 'execute') {
        throw new Error('合法授权的归一化结果不完整：' + JSON.stringify(parsedValid.authorization));
      }
      const malformed = [
        ['缺 authorization', undefined],
        ['authorization 为数组', []],
        ['round=0', { ...valid, round: 0 }],
        ['round 非整数', { ...valid, round: 1.5 }],
        ['round 类型错误', { ...valid, round: '1' }],
        ['at 空串', { ...valid, at: '' }],
        ['at 纯空白', { ...valid, at: '  ' }],
        ['at 类型错误', { ...valid, at: 42 }],
        ['source 空串', { ...valid, source: '' }],
        ['source 纯空白', { ...valid, source: '  ' }],
        ['source 类型错误', { ...valid, source: [] }],
        ['node 与调用不一致', { ...valid, node: 'subagent-execute' }],
      ];
      for (const [label, authorization] of malformed) {
        assertReplanAuthorizationShape(authorization, 'execute', false, label);
      }
      // 综合判定的未授权路径：非法授权 → block（不抛异常、不写盘；零改写由上方 CLI 用例锚定）
      const decide = requireRouteNodeExport('resolveReplanDecision');
      const decideState = replanExecuteState();
      for (const [label, authorization] of malformed) {
        const decision = decide({ protocol: readScenarioProtocol(dir), state: decideState, authorization });
        if (!decision || decision.ok !== false || decision.action !== 'block') {
          throw new Error('[' + label + '] resolveReplanDecision 应返回 block，实际 ' + JSON.stringify(decision));
        }
      }
      // 纯函数族存在性锚（T03 交付面）：五项导出缺任一即本场景 RED
      requireRouteNodeExport('replanRoundCount');
      requireRouteNodeExport('replanRoundDecision');
      requireRouteNodeExport('replanNoOpDecision');
    },
  },

  // 267: replan 校验不豁免（ADR-013 决策 3 / 明确 out：replan 绝不做校验豁免）——依赖环 /
  // 缺失依赖 / 缺 <verify> / 并行写冲突四类任务集在 replan 上一律 BLOCKED 且状态零改写；
  // 并且 plan 出口与 replan 对同一输入给出同一机器分类。同源是结构事实而非注释声明（L-067）：
  // 任务图分析与并行写冲突检测各只有一份实现（route-node.mjs 定义并导出），
  // workflow-guard 静态 import 使用它。
  {
    name: '267 replan 校验不豁免：依赖环/缺失依赖/缺 verify/并行写冲突 → BLOCKED 零改写 + 单源锚',
    run: async (dir) => {
      const cases = [
        ['依赖环', TASK_DEP_CYCLE, '依赖环', '依赖环'],
        ['依赖不存在的任务', TASK_MISSING_DEP, '依赖不存在的任务', '依赖'],
        ['缺 <verify> 字段', REPLAN_TASK_NO_VERIFY, '缺 <verify> 字段', 'verify'],
        ['并行写冲突', TASK_PARALLEL_WRITE_CONFLICT, 'write_files', '并行写冲突'],
      ];
      for (const [label, taskContent, planExpected, replanExpected] of cases) {
        // ① plan 出口（既有判定路径）对同一输入的机器分类
        const planState = baseState('plan');
        planState.evidence.plan = { summary: 'plan done' };
        planState.newChange = true;
        writeState(dir, planState);
        const planRes = runPlanExit(dir, taskContent);
        assertExit(planRes, 1);
        assertOut(planRes, 'BLOCKED');
        assertOut(planRes, planExpected);
        // ② replan 对同一输入：同一分类 + BLOCKED + state 零改写
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', taskContent);
        writeState(dir, replanExecuteState({ taskHash: REPLAN_STALE_SIGNATURE }));
        const bytes = readStateBytes(dir);
        const replanRes = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
        assertExit(replanRes, 1);
        assertOut(replanRes, 'BLOCKED');
        assertOut(replanRes, replanExpected);
        assertStateBytesUnchanged(dir, bytes, 'replan ' + label);
        // 显式 sha256 前后相同（字节零改写的独立哈希表达，L-069：断言覆盖完整契约而非关键词）
        const shaBefore = createHash('sha256').update(bytes).digest('hex');
        const shaAfter = createHash('sha256').update(readStateBytes(dir)).digest('hex');
        if (shaBefore !== shaAfter) {
          throw new Error(label + '：replan BLOCK 路径 state sha256 应前后相同，实际 '
            + shaBefore + ' → ' + shaAfter);
        }
        if (replanBackupFiles(dir).length !== 0) {
          throw new Error(label + '：校验失败路径不得产生备份');
        }
        if (replanEventsOf(readScenarioState(dir)).length !== 0) {
          throw new Error(label + '：校验失败路径不得写审计事件');
        }
      }
      // 读写弱判（read∩write，plan 出口同判据）：仅 WARN 不阻断——replan 照常重签、写重签前备份、
      // 写审计事件（覆盖写写强判之外的非阻断分支，2026-09-28 PR 审查补锚）。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', TASK_PARALLEL_READ_OVERLAP);
      writeState(dir, replanExecuteState({ taskHash: REPLAN_STALE_SIGNATURE }));
      const readWarnRes = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
      assertExit(readWarnRes, 0);
      assertOut(readWarnRes, 'REPLAN:');
      assertOut(readWarnRes, 'WARN: TASK.md 并行任务 read∩write 隐式依赖嫌疑');
      assertOut(readWarnRes, 'P02×P01(src/shared.mjs)');  // 输出为「读取方×写入方」（P02 读 P01 写路径）
      if (replanBackupFiles(dir).length !== 1) {
        throw new Error('read∩write 弱判不得阻断 replan：应恰有 1 份重签前备份，实际 '
          + replanBackupFiles(dir).length);
      }
      if (replanEventsOf(readScenarioState(dir)).length !== 1) {
        throw new Error('read∩write 弱判不得阻断 replan：应写入 1 条 replan-applied 审计事件，实际 '
          + replanEventsOf(readScenarioState(dir)).length);
      }
      // 同源结构锚：任务图分析全引擎只有一处定义，且位于 route-node.mjs（可由 replan 复用）
      const analyze = requireRouteNodeExport('analyzeDependencyGraph');
      const cyclicBlocks = TASK_DEP_CYCLE.match(/<task[\s\S]*?<\/task>/g) || [];
      const verdict = analyze(cyclicBlocks);
      if (!verdict || verdict.cyclic !== true || !Array.isArray(verdict.cycleIds) || verdict.cycleIds.length === 0) {
        throw new Error('route-node 导出的任务图分析对依赖环应返回 cyclic=true + cycleIds，实际 ' + JSON.stringify(verdict));
      }
      const missingVerdict = analyze(TASK_MISSING_DEP.match(/<task[\s\S]*?<\/task>/g) || []);
      if (!missingVerdict || missingVerdict.missing.length === 0 || missingVerdict.cyclic !== false) {
        throw new Error('route-node 导出的任务图分析对缺失依赖应返回 missing 明细，实际 ' + JSON.stringify(missingVerdict));
      }
      const engineScripts = engineScriptFiles();
      const definitionFiles = engineScripts.filter((file) =>
        /function\s+analyzeDependencyGraph\s*\(/.test(fs.readFileSync(path.join(__dirname, file), 'utf8')));
      if (definitionFiles.length !== 1 || definitionFiles[0] !== 'route-node.mjs') {
        throw new Error('任务图分析必须只有一份实现且位于 route-node.mjs（plan 出口与 replan 共用），实际定义处: '
          + JSON.stringify(definitionFiles));
      }
      const guardText = fs.readFileSync(GUARD, 'utf8');
      if (!/import[^;]*\banalyzeDependencyGraph\b[^;]*from\s*'\.\/route-node\.mjs'/.test(guardText)) {
        throw new Error('workflow-guard.mjs 必须静态 import route-node 的任务图分析（不得内联第二份判定）');
      }
      // 并行写冲突检测单源锚（CR-2 抽取）：全引擎只有一份定义且位于 route-node.mjs，
      // workflow-guard 静态 import 使用它（replan 与 plan 出口同一判据，禁止内联第二份）。
      const conflictDefinitionFiles = engineScripts.filter((file) =>
        /function\s+findParallelWriteConflicts\s*\(/.test(fs.readFileSync(path.join(__dirname, file), 'utf8')));
      if (conflictDefinitionFiles.length !== 1 || conflictDefinitionFiles[0] !== 'route-node.mjs') {
        throw new Error('并行写冲突检测必须只有一份实现且位于 route-node.mjs（plan 出口与 replan 共用），实际定义处: '
          + JSON.stringify(conflictDefinitionFiles));
      }
      if (!/import[^;]*\bfindParallelWriteConflicts\b[^;]*from\s*'\.\/route-node\.mjs'/.test(guardText)) {
        throw new Error('workflow-guard.mjs 必须静态 import route-node 的并行写冲突检测（不得内联第二份判定）');
      }
      // —— 本批 in-place 增锚（第三族：同文件跨任务且无依赖路径）——
      // ① 单一实现锚（结构事实而非注释声明）：第三族的构件（修复任务族前缀常量 / 任务对键 /
      //    依赖可达闭包）与结果产出在全引擎脚本里只能出现一次且位于 route-node.mjs——消费脚本
      //    内自建第二份（依赖闭包或写入面交集实现）会在此变红。
      for (const piece of ['FIX_TASK_ID_PREFIX', 'taskPairKey', 'reachableTaskIds']) {
        const pieceFiles = engineScripts.filter((file) =>
          new RegExp('\\b' + piece + '\\b').test(fs.readFileSync(path.join(__dirname, file), 'utf8')));
        if (pieceFiles.length !== 1 || pieceFiles[0] !== 'route-node.mjs') {
          throw new Error('第三族判定构件 ' + piece + ' 必须只出现在 route-node.mjs，实际: ' + JSON.stringify(pieceFiles));
        }
      }
      const crossTaskProducerFiles = engineScripts.filter((file) =>
        /const\s+crossTaskConflicts\s*=/.test(fs.readFileSync(path.join(__dirname, file), 'utf8')));
      if (crossTaskProducerFiles.length !== 1 || crossTaskProducerFiles[0] !== 'route-node.mjs') {
        throw new Error('第三族结果只能由 route-node.mjs 产出（不得在消费脚本内内联），实际: ' + JSON.stringify(crossTaskProducerFiles));
      }
      if (!/\bcrossTaskConflicts\b/.test(guardText)) {
        throw new Error('workflow-guard.mjs 必须消费 route-node 的第三族结果（plan 出口判定）');
      }
      // ①b 修复族约定「只表达一次」锚（判别力升级：按表达式形态计数，不再只数标识符名）——
      //     两条边界（id 前缀 / 「位于修复段内」）各只允许一处实现，第三族参与者排除与修复族
      //     标记必须共用同一分类器；第二份等价前缀表达式（含内联前缀判定）在此变红。
      //     旧锚只统计"哪个文件含该常量名"：第二份写法（不含该名字的等价正则）必然被放过——
      //     本锚即对该盲区的判别力补齐。
      for (const problem of fixFamilyBoundaryProblems()) {
        throw new Error('修复族约定未被唯一表达: ' + problem);
      }
      // ①b-1 该判据自身的夹具锚（常驻判别力，不依赖外部临时注入）：同源形态 → 无问题；
      //      逐条注入"同一约定被表达两次"的变体 → 逐条专项报告。夹具目录即判据的 scriptsDir
      //      接缝（合成引擎脚本，不被执行、只被扫描）。
      const engineFixtureDir = path.join(dir, 'engine-fixture');
      // 夹具文本的权威前缀表达式自模块常量拼接（不在夹具里再写一份字面量——同源才测得准）
      const canonicalPrefixDecl = 'const FIX_TASK_ID_PREFIX = ' + FIX_PREFIX_LITERAL_TEXT + ';';
      const canonicalEngine = [
        canonicalPrefixDecl,
        'function fixTaskClassifier(taskContent, fixSectionTitle) {',
        '  const section = fixSectionBody(taskContent, fixSectionTitle);',
        '  const sectionBlocks = new Set(section === null ? [] : taskBlocks(section));',
        '  return (block) => FIX_TASK_ID_PREFIX.test(taskOpeningAttrs(block).id) || sectionBlocks.has(block);',
        '}',
        'function fixTaskMarker(taskContent, fixSectionTitle) {',
        '  const isFixTask = fixTaskClassifier(taskContent, fixSectionTitle);',
        '  return taskBlocks(String(taskContent ?? "")).some((block) => isFixTask(block));',
        '}',
        'function collectCrossTaskConflicts({ taskContent = "", allBlocks = [] } = {}) {',
        '  const isFixTask = fixTaskClassifier(taskContent);',
        '  return allBlocks.filter((block) => !isFixTask(block));',
        '}',
        '',
      ].join('\n');
      const fixtureFileRel = path.join('engine-fixture', 'route-node.mjs');
      writeFile(dir, fixtureFileRel, canonicalEngine);
      const canonicalProblems = fixFamilyBoundaryProblems(engineFixtureDir);
      if (canonicalProblems.length !== 0) {
        throw new Error('唯一表达形态不得报问题（判据夹具模板）: ' + JSON.stringify(canonicalProblems));
      }
      const boundaryCases = [
        ['第二份前缀表达式', canonicalEngine + 'const legacyFixPrefix = /^(T-FIX|P-FIX)/i;\n',
          '第二份修复族 id 前缀表达式'],
        ['内联前缀判定（id 字面量）', canonicalEngine + 'const legacyIds = ["T-FIX-01"];\n',
          '修复族 id 字面量'],
        ['前缀边界被删', canonicalEngine.replace(canonicalPrefixDecl, 'const FIX_TASK_ID_PREFIX = /nope/;'),
          '修复族 id 前缀边界必须只表达一次'],
        ['段内成员判定第二份',
          canonicalEngine.replace('  return allBlocks.filter((block) => !isFixTask(block));',
            '  sectionBlocks.has({});\n  return allBlocks.filter((block) => !isFixTask(block));'),
          '段内成员判定）必须只表达一次'],
        ['消费方自持边界（不共用分类器）',
          canonicalEngine.replace('  const isFixTask = fixTaskClassifier(taskContent);',
            '  const isFixTask = () => false;'),
          '必须经唯一分类器判定修复族'],
      ];
      for (const [label, mutated, expected] of boundaryCases) {
        writeFile(dir, fixtureFileRel, mutated);
        const mutatedProblems = fixFamilyBoundaryProblems(engineFixtureDir);
        if (!mutatedProblems.some((p) => p.includes(expected))) {
          throw new Error('修复族边界反向夹具（' + label + '）未按预期报告「' + expected + '」: '
            + JSON.stringify(mutatedProblems));
        }
      }
      // ①c replan 消费锚（结构锚；replan 的真实命令链路由系统测试集承担，此处不重复造链路）：
      //     第三族必须①被解构（只解构两族 = 静默丢失该判据，即修订通道可静默引入该形态）、
      //     ②在 BLOCK 早于备份与写盘的位置判定、③消息与恢复指引与 plan 出口同族（新 change
      //     阻断 / 旧 change 渐进）。断言写成对 workflow-state.mjs 文本的结构判定。
      const stateText = fs.readFileSync(STATE, 'utf8');
      const destructured = stateText.match(/const\s*\{([^}]*)\}\s*=\s*await\s+findParallelWriteConflicts\s*\(/);
      if (destructured === null || !/\bcrossTaskConflicts\b/.test(destructured[1])) {
        throw new Error('workflow-state.mjs 的 replan 必须解构 route-node 第三族结果'
          + '（只解构两族即静默丢失该判据）: ' + JSON.stringify(destructured === null ? null : destructured[1].trim()));
      }
      const crossJudgeAt = stateText.indexOf('crossTaskConflicts.length > 0');
      const backupAt = stateText.indexOf('-pre-replan.json');
      if (crossJudgeAt < 0) {
        throw new Error('workflow-state.mjs 的 replan 未消费第三族（缺判定分支）');
      }
      if (backupAt < 0 || crossJudgeAt > backupAt) {
        throw new Error('replan 的第三族判定必须早于重签前备份（BLOCK 早于落盘的零改写语义）: '
          + '判定位置 ' + crossJudgeAt + ' / 备份位置 ' + backupAt);
      }
      for (const message of ['同文件跨任务且无依赖路径', '补显式 depends_on 或合并为一个任务']) {
        if (!stateText.includes(message)) {
          throw new Error('replan 的第三族消息必须与 plan 出口同族（缺「' + message + '」）');
        }
      }
      if (!/WARN: TASK\.md 同文件跨任务且无依赖路径（旧 change 渐进不阻断）/.test(stateText)) {
        throw new Error('replan 的第三族必须保留旧 change 渐进分支（WARN 不阻断）');
      }
      // ② 行为锚（直接驱动判定函数，plan 出口与 replan 共用同一实现）：非修复同文件对命中、
      //    修复任务族对不参与（其顺序由修复生命周期保证，回修同文件是必然形态）。
      const findConflicts = requireRouteNodeExport('findParallelWriteConflicts');
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 任务清单\n\n' + CROSS_TASK_PLAIN_PAIR);
      const plainConflicts = await findConflicts(path.join(dir, '.specs', CHANGE_ID));
      if (plainConflicts.crossTaskConflicts.length !== 1
        || plainConflicts.crossTaskConflicts[0].files.join(',') !== 'src/shared.mjs') {
        throw new Error('非修复同文件无依赖对必须命中第三族: ' + JSON.stringify(plainConflicts.crossTaskConflicts));
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n## 任务清单\n\n' + CROSS_TASK_FIX_PAIR);
      const fixConflicts = await findConflicts(path.join(dir, '.specs', CHANGE_ID));
      if (fixConflicts.crossTaskConflicts.length !== 0 || fixConflicts.writeConflicts.length !== 0) {
        throw new Error('修复任务族对不得进入第三族（也不得进入写写强判）: ' + JSON.stringify(fixConflicts));
      }
      // ②-附 段归属分支 + 行尾归一（LF 与 CRLF 两形态都必须识别为修复族）：
      //     段内块来自 LF 归一后的段体，而待判 block 来自原文——Windows 下原文是 CRLF，
      //     不归一会让段内匹配失败 → 修复族对被当普通参与者误拦（2026-10-01 PR 审查发现）。
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n## 任务清单\n\n' + CROSS_TASK_FIX_SECTION_PAIR);
      const sectionConflicts = await findConflicts(path.join(dir, '.specs', CHANGE_ID));
      if (sectionConflicts.crossTaskConflicts.length !== 0 || sectionConflicts.writeConflicts.length !== 0) {
        throw new Error('修复段内**非前缀 id** 的任务对不得进入第三族（段归属分支）: '
          + JSON.stringify(sectionConflicts));
      }
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\r\n\r\n## 任务清单\r\n\r\n' + CROSS_TASK_FIX_SECTION_PAIR.replace(/\n/g, '\r\n'));
      const crlfConflicts = await findConflicts(path.join(dir, '.specs', CHANGE_ID));
      if (crlfConflicts.crossTaskConflicts.length !== 0 || crlfConflicts.writeConflicts.length !== 0) {
        throw new Error('CRLF 行尾下修复段归属判定必须一致（行尾归一口径）: ' + JSON.stringify(crlfConflicts));
      }
      // ③ 出口链路锚（新 change）：非修复对照对 → BLOCKED 且消息带任务对与重叠文件；
      //    修复族对 → exit 0 且不出现该族消息（BLOCKED / WARN 两形态都不许有）。
      const crossState = baseState('plan');
      crossState.evidence.plan = { summary: 'plan done' };
      crossState.newChange = true;
      writeState(dir, crossState);
      const plainRes = runPlanExit(dir, CROSS_TASK_PLAIN_PAIR);
      assertExit(plainRes, 1);
      assertOut(plainRes, 'BLOCKED');
      assertOut(plainRes, '同文件跨任务且无依赖路径');
      assertOut(plainRes, 'T01×T02');
      assertOut(plainRes, 'src/shared.mjs');
      assertOut(plainRes, 'depends_on');
      writeState(dir, crossState);
      const fixRes = runPlanExit(dir, CROSS_TASK_FIX_PAIR);
      assertExit(fixRes, 0);
      assertNotOut(fixRes, '同文件跨任务');
      assertNotOut(fixRes, 'BLOCKED');
      // ④ 混合夹具：两类并存 → 只报非修复对（修复族对不出现在消息里）
      writeState(dir, crossState);
      const mixedRes = runPlanExit(dir, CROSS_TASK_MIXED_PAIR);
      assertExit(mixedRes, 1);
      assertOut(mixedRes, 'BLOCKED');
      assertOut(mixedRes, 'T01×T02');
      assertNotOut(mixedRes, 'T-FIX-01×T-FIX-02');
    },
  },

  // 268: replan 轮次上限与显式续轮（AC-3 / ADR-013 决策 6）——按 history 中本 change 的
  // replan-applied 事件计数，上限 3：第 4 次 BLOCKED 且给出「继续 / 停止」人工裁决指引；
  // --continue-round <n> 满足 n ≥ 已用 + 1 才放行并计入下一轮（审计事件 / 授权留痕带续轮标记）；
  // n 不足则 BLOCK 零改写；轮次按 change 隔离（他 change 的事件不占本 change 配额）。
  {
    name: '268 replan 轮次上限 3 与显式续轮：超限 BLOCK 人工裁决·续轮放行计下一轮·授权不足 BLOCK·跨 change 隔离',
    run: (dir) => {
      const baseHistory = [replanHistoryEvent(1), replanHistoryEvent(2), replanHistoryEvent(3)];
      const blockedCases = [
        ['超限未续轮', []],
        ['续轮授权轮次不足（n=3 < 已用+1）', ['--continue-round', '3']],
      ];
      for (const [label, extra] of blockedCases) {
        writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
        writeState(dir, replanExecuteState({ history: [...baseHistory], taskHash: REPLAN_STALE_SIGNATURE }));
        const bytes = readStateBytes(dir);
        const res = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval', ...extra]);
        assertExit(res, 1);
        assertOut(res, 'BLOCKED');
        assertOut(res, '继续');
        assertOut(res, '停止');
        assertStateBytesUnchanged(dir, bytes, label);
        if (replanBackupFiles(dir).length !== 0) {
          throw new Error(label + '：上限拦截不得产生备份');
        }
        if (replanEventsOf(readScenarioState(dir)).length !== 3) {
          throw new Error(label + '：上限拦截不得追加审计事件');
        }
      }
      // 显式续轮放行：n = 已用 + 1 → 计入第 4 轮（审计行标注续轮）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
      writeState(dir, replanExecuteState({ history: [...baseHistory], taskHash: REPLAN_STALE_SIGNATURE }));
      const continued = runStateWithProtocol(
        dir, ['replan', '计划缺陷重校（上限后显式续轮）', '--authorized-by', 'admin-approval', '--continue-round', '4']);
      assertExit(continued, 0);
      assertOut(continued, 'REPLAN');
      assertOut(continued, '续轮');
      const continuedState = readScenarioState(dir);
      const continuedEvents = replanEventsOf(continuedState);
      if (continuedEvents.length !== 4) {
        throw new Error('续轮放行应写入第 4 条 replan-applied 事件，实际 ' + JSON.stringify(continuedEvents.length));
      }
      const continuedEvent = continuedEvents[continuedEvents.length - 1];
      if (continuedEvent.round !== 4 || continuedEvent.change !== CHANGE_ID
        || continuedEvent.reason !== '计划缺陷重校（上限后显式续轮）'
        || continuedEvent.continuationAuthorized !== true) {
        throw new Error('续轮审计事件字段不符（round=4 / change / 续轮标记 / reason）：' + JSON.stringify(continuedEvent));
      }
      const continuedRecord = continuedState.evidence?.execute?.replanAuthorization;
      if (!continuedRecord || continuedRecord.continuationAuthorized !== true
        || continuedRecord.round !== 4 || continuedRecord.source !== 'admin-approval') {
        throw new Error('续轮授权留痕不符：' + JSON.stringify(continuedRecord));
      }
      assertReplanSignatureRecorded(continuedState, REPLAN_TASK_REVISED, '续轮放行');
      if (replanBackupFiles(dir).length !== 1) {
        throw new Error('续轮放行应产生一份备份，实际 ' + JSON.stringify(replanBackupFiles(dir)));
      }
      // 跨 change 隔离：他 change 的 3 条事件不占本 change 配额 → 本 change 为第 1 轮
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
      writeState(dir, replanExecuteState({
        history: [replanHistoryEvent(1, 'other-change'), replanHistoryEvent(2, 'other-change'), replanHistoryEvent(3, 'other-change')],
        taskHash: REPLAN_STALE_SIGNATURE,
      }));
      const isolated = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
      assertExit(isolated, 0);
      assertOut(isolated, 'REPLAN');
      assertOut(isolated, '1/3');
      const isolatedEvent = replanEventsOf(readScenarioState(dir)).find((e) => e.change === CHANGE_ID);
      if (!isolatedEvent || isolatedEvent.round !== 1) {
        throw new Error('他 change 的轮次事件不应占用本 change 配额（本 change 应为第 1 轮），实际 '
          + JSON.stringify(isolatedEvent));
      }
      // 轮次判定纯函数锚（阈值只从实现常量取——本锚同时锁上限 = 3）
      const roundCount = requireRouteNodeExport('replanRoundCount');
      if (roundCount({ history: baseHistory, changeName: CHANGE_ID }) !== 3) {
        throw new Error('replanRoundCount 应统计本 change 的 replan-applied 事件数（3）');
      }
      if (roundCount({ history: baseHistory, changeName: 'other-change' }) !== 0) {
        throw new Error('replanRoundCount 应按 change 过滤（他 change 应为 0）');
      }
      if (roundCount({ history: 'corrupted', changeName: CHANGE_ID }) !== 0) {
        throw new Error('replanRoundCount 对非数组 history 应返回 0（旧 state 形态）');
      }
      const roundDecision = requireRouteNodeExport('replanRoundDecision');
      const available = roundDecision({ history: [replanHistoryEvent(1)], changeName: CHANGE_ID });
      if (!available || available.ok !== true || available.nextRound !== 2 || available.limit !== 3) {
        throw new Error('replanRoundDecision 未达上限应放行并给出下一轮：' + JSON.stringify(available));
      }
      const capped = roundDecision({ history: baseHistory, changeName: CHANGE_ID });
      if (!capped || capped.ok !== false || capped.limit !== 3) {
        throw new Error('replanRoundDecision 达上限且无续轮应 blocked：' + JSON.stringify(capped));
      }
      const continuation = roundDecision({ history: baseHistory, changeName: CHANGE_ID, continuationAuthorized: true });
      if (!continuation || continuation.ok !== true || continuation.nextRound !== 4) {
        throw new Error('replanRoundDecision 持显式续轮授权应放行第 4 轮：' + JSON.stringify(continuation));
      }
    },
  },

  // 269: replan 幂等空操作（AC-5 / ADR-013 决策 9）——目标形态已成立（state.taskHash 已等于
  // 当前 TASK.md 签名）时重复调用 = 空操作：可见提示 + 零备份 / 零轮次计数 / 零事件 /
  // state 字节零改写（与 archive 重入的幂等锚同构）。
  {
    name: '269 replan 幂等空操作：重签后重复同形态 → 零备份·零轮次·零事件·零改写',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
      writeState(dir, replanExecuteState({ taskHash: REPLAN_STALE_SIGNATURE }));
      const first = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
      assertExit(first, 0);
      assertOut(first, 'REPLAN');
      const afterApply = readStateBytes(dir);
      const appliedState = readScenarioState(dir);
      if (replanEventsOf(appliedState).length !== 1) {
        throw new Error('首次重签应恰写 1 条 replan-applied 事件，实际 '
          + JSON.stringify(replanEventsOf(appliedState).length));
      }
      const backupsAfterApply = replanBackupFiles(dir);
      if (backupsAfterApply.length !== 1) {
        throw new Error('首次重签应恰产生一份备份，实际 ' + JSON.stringify(backupsAfterApply));
      }
      assertReplanSignatureRecorded(appliedState, REPLAN_TASK_REVISED, '首次重签');
      // 同形态重复调用 → 空操作（零副作用）
      const noop = runStateWithProtocol(dir, ['replan', '重复调用同形态', '--authorized-by', 'user-approval']);
      assertExit(noop, 0);
      assertOut(noop, '空操作');
      assertNotOut(noop, 'BLOCKED');
      assertStateBytesUnchanged(dir, afterApply, '重复同形态空操作');
      if (!isDeepStrictEqual(replanBackupFiles(dir), backupsAfterApply)) {
        throw new Error('空操作不得新增备份：' + JSON.stringify(replanBackupFiles(dir)));
      }
      if (replanEventsOf(readScenarioState(dir)).length !== 1) {
        throw new Error('空操作不得写审计事件（history 长度漂移）');
      }
      // 空操作判定纯函数存在性锚（T04 编排消费的判定点）
      requireRouteNodeExport('replanNoOpDecision');
    },
  },

  // 270: 重签后 execute 出口放行（AC-1）——entry 后修订任务集（计划外新增并行就绪任务）使
  // exit execute 撞签名门禁 → replan 重校重签 → 同一出口再跑通过（不再报签名不匹配）→
  // next 正常路由到委托节点；审计事件 / 授权留痕 / 备份快照齐备，重签值与会话当前 TASK.md 同签。
  {
    name: '270 replan 重签后 exit execute --apply 通过：修订任务集（含并行就绪任务）→ 签名 BLOCKED → 重签 → 出口放行',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_INITIAL);
      writeFile(dir, '.specs/' + CHANGE_ID + '/S01-SUMMARY.md', strictSummary('S01'));
      // 夹具忠实性修复（协调者授权 A · 夹具缺陷而非放宽带锚）：resolveNextNode 的 execute 前
      // 产物门控按文件存在性判定（不读 completedNodes）——路由到委托节点要求 open / design 的
      // 前置产物在场。此处补齐 CHANGE.md / REQUIREMENT.md / DESIGN.md（writeIntakeArtifacts
      // 三件全写，其定义内已含 DESIGN.md），使夹具与真实链路的产物现场一致；不改任何断言 / 锚 /
      // 判据 / 计数。
      writeIntakeArtifacts(dir);
      writeState(dir, replanExecuteState());
      assertExit(runGuard(['entry', 'execute'], dir), 0);
      // 任务集修订（#119 死锁现场）：新增计划外的并行就绪任务
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_REVISED);
      const blockedBytes = readStateBytes(dir);
      const blocked = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, '签名不匹配');
      assertStateBytesUnchanged(dir, blockedBytes, '修订任务集后的签名门禁 BLOCK');
      // 受控重校重签
      const reason = '计划有缺陷：新增并行任务 P02';
      const beforeReplan = readScenarioState(dir);
      const res = runStateWithProtocol(dir, ['replan', reason, '--authorized-by', 'user-approval']);
      assertExit(res, 0);
      assertOut(res, 'REPLAN');
      assertOut(res, 'execute');
      assertOut(res, '1/3');
      assertOut(res, 'user-approval');
      assertOut(res, reason);
      const st = readScenarioState(dir);
      // 留痕（双写）：history 事件 + evidence.<node>.replanAuthorization
      const events = replanEventsOf(st);
      if (events.length !== 1) {
        throw new Error('重签应恰写 1 条 replan-applied 事件，实际 ' + JSON.stringify(events));
      }
      const event = events[0];
      if (event.change !== CHANGE_ID || event.node !== 'execute' || event.round !== 1
        || event.authorizedBy !== 'user-approval' || event.reason !== reason
        || typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at))) {
        throw new Error('replan-applied 事件字段不完整（change / node / round / reason / authorizedBy / at）：'
          + JSON.stringify(event));
      }
      const record = st.evidence?.execute?.replanAuthorization;
      if (!record || record.source !== 'user-approval' || record.reason !== reason || record.round !== 1
        || typeof record.at !== 'string' || record.at.trim() === '') {
        throw new Error('evidence.execute.replanAuthorization 授权留痕不完整：' + JSON.stringify(record));
      }
      // 重签值 = 当前 TASK.md 签名（事件同步记录同一签名）
      const signed = assertReplanSignatureRecorded(st, REPLAN_TASK_REVISED, '重签');
      if (!requireRouteNodeExport('sameTaskSetSignature')(event.taskSetSignature, signed)) {
        throw new Error('replan-applied 事件记录的签名应与 state.taskHash 同签：'
          + JSON.stringify({ event: event.taskSetSignature, state: st.taskHash }));
      }
      // 转移前备份：全量快照 + sha256 指纹在任何留痕面可核验（ADR-013 决策 7）
      const backups = replanBackupFiles(dir);
      if (backups.length !== 1) {
        throw new Error('重签应恰产生一份备份，实际 ' + JSON.stringify(backups));
      }
      if (!/-pre-replan\.json$/.test(backups[0])) {
        throw new Error('备份命名应为 <UTC ISO>-pre-replan.json，实际 ' + backups[0]);
      }
      const backupBytes = fs.readFileSync(path.join(dir, '.specs', CHANGE_ID, 'replan-backups', backups[0]));
      const backupState = JSON.parse(backupBytes.toString('utf8'));
      if (!isDeepStrictEqual(backupState, beforeReplan)) {
        throw new Error('备份应为重签前的 state 全量快照');
      }
      const fingerprint = createHash('sha256').update(backupBytes).digest('hex');
      const haystack = (JSON.stringify(st) + '\n' + outputText(res)).toLowerCase();
      if (!haystack.includes(fingerprint)) {
        throw new Error('备份 sha256 指纹未在任何留痕面出现（备份不可核验）: ' + fingerprint);
      }
      // 同一出口再跑：签名已重签 → 放行；并行就绪任务使 next 路由到委托节点
      const exitRes = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(exitRes, 0);
      assertOut(exitRes, 'ALL CHECKS PASSED');
      if (!/^NODE: subagent-execute$/m.test(outputText(exitRes))) {
        throw new Error('重签后出口应路由到委托节点（并行就绪任务），实际输出:\n' + outputText(exitRes));
      }
      const next = runStateWithProtocol(dir, ['next']);
      assertExit(next, 0);
      if (!/^NODE: subagent-execute$/m.test(outputText(next))) {
        throw new Error('next 应正常路由到 subagent-execute，实际输出:\n' + outputText(next));
      }
    },
  },

  // 271: advance 留痕 + 状态可见（AC-4）——advance 仍推进（语义不变），但必须写
  // history 事件 advance-forced（node + skipped: ['exit:<node>'] + reason: 'advance'）并打印
  // ADVANCE-AUDIT；status 输出派生字段 forcedNodes 以 history 中本 change 的 advance-forced
  // 事件为准（2026-09-28 PR 审查采纳）——record 后 advance / replanAuthorization 留痕后
  // advance 两类真实反例都不得漏报；旧 state（无 history 字段）回退「completedNodes 含而
  // evidence 不含」判据（当时 advance 无痕，无事件可依）。
  // 正反断言（L-069）：被强制推进的节点必现；有出口证据但未被强制的不现。
  {
    name: '271 advance 留痕：advance-forced 事件 + status.forcedNodes 派生视图（含反向断言）',
    run: (dir) => {
      assertExit(runStateWithProtocol(dir, ['init', CHANGE_ID]), 0);
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n推进留痕夹具。\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md',
        '# REQUIREMENT\n\n## 用户故事\n\nx\n\n## 验收准则（AC）\n\n- 通过\n');
      const res = runStateWithProtocol(dir, ['advance']);
      assertExit(res, 0);
      assertOut(res, 'Advanced to: design');
      assertOut(res, 'ADVANCE-AUDIT');
      assertOut(res, 'open');
      const st = readScenarioState(dir);
      const events = (st.history || []).filter((e) => e && e.event === 'advance-forced');
      if (events.length !== 1) {
        throw new Error('advance 应恰写 1 条 advance-forced 事件，实际 ' + JSON.stringify(events));
      }
      const event = events[0];
      if (event.change !== CHANGE_ID || event.node !== 'open') {
        throw new Error('advance-forced 事件应记录 change / 被推进节点，实际 ' + JSON.stringify(event));
      }
      if (!isDeepStrictEqual(event.skipped, ['exit:open'])) {
        throw new Error("advance-forced 事件应记录被跳过的出口门禁 skipped: ['exit:open']，实际 "
          + JSON.stringify(event.skipped));
      }
      if (event.reason !== 'advance') {
        throw new Error('advance-forced 事件应记录 reason: \'advance\'，实际 ' + JSON.stringify(event.reason));
      }
      if (typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at))) {
        throw new Error('advance-forced 事件应带可解析时间戳，实际 ' + JSON.stringify(event.at));
      }
      const status = runStateWithProtocol(dir, ['status']);
      assertExit(status, 0);
      const parsed = parseStatusJson(status);
      if (!Array.isArray(parsed.forcedNodes) || !parsed.forcedNodes.includes('open')) {
        throw new Error('status.forcedNodes 应包含被强制推进且无出口证据的 open，实际 '
          + JSON.stringify(parsed.forcedNodes));
      }
      if (parsed.forcedNodes.includes('design')) {
        throw new Error('status.forcedNodes 只能包含已完成节点，实际 ' + JSON.stringify(parsed.forcedNodes));
      }
      // 反向：有出口证据且未被 advance 强制的 completed 节点不得进入 forcedNodes；
      // 无出口证据但被 advance 强制的节点仍收录（事件判据）。事件派生下「强制」由 history 决定：
      // 夹具把 advance-forced 事件挂到 design（open 只留 exit 证据），反向断言语义保持不变。
      const st2 = readScenarioState(dir);
      st2.completedNodes = ['open', 'design'];
      st2.currentNode = 'plan';
      st2.evidence = { ...(st2.evidence || {}), open: { summary: 'open exited' } };
      st2.history = [advanceForcedEvent('design')];
      writeState(dir, st2);
      const status2 = runStateWithProtocol(dir, ['status']);
      assertExit(status2, 0);
      const parsed2 = parseStatusJson(status2);
      if (!Array.isArray(parsed2.forcedNodes) || !parsed2.forcedNodes.includes('design')) {
        throw new Error('无出口证据的 completed 节点应进入 forcedNodes，实际 ' + JSON.stringify(parsed2.forcedNodes));
      }
      if (parsed2.forcedNodes.includes('open')) {
        throw new Error('有出口证据的 completed 节点不得进入 forcedNodes，实际 ' + JSON.stringify(parsed2.forcedNodes));
      }
      // (i) 有 record 出口证据且被 advance 强制 → 必须出现（旧「缺 evidence」推断会漏报）
      const stRecord = replanExecuteState({
        completedNodes: ['open', 'design'],
        currentNode: 'plan',
        evidence: { open: { summary: 'record 出口证据（advance 事件之外的真实证据）' } },
        history: [advanceForcedEvent('open')],
      });
      writeState(dir, stRecord);
      const statusRecord = runStateWithProtocol(dir, ['status']);
      assertExit(statusRecord, 0);
      const parsedRecord = parseStatusJson(statusRecord);
      const failures271 = [];
      if (!Array.isArray(parsedRecord.forcedNodes) || !parsedRecord.forcedNodes.includes('open')) {
        failures271.push('(i) 有 record 证据且被 advance 强制的 open 应进入 forcedNodes，实际 '
          + JSON.stringify(parsedRecord.forcedNodes));
      }
      // (ii) 只有 replanAuthorization 授权留痕且被 advance 强制 → 必须出现（旧对象判据会漏报）
      const stAuth = replanExecuteState({
        completedNodes: ['open', 'design'],
        currentNode: 'plan',
        evidence: {
          open: { summary: 'open exited' },
          design: {
            replanAuthorization: {
              round: 1,
              at: '2026-09-28T00:00:00.000Z',
              source: 'user',
              reason: '计划重校',
              backup: '.specs/' + CHANGE_ID + '/replan-backups/x.json',
              fingerprint: '0'.repeat(64),
            },
          },
        },
        history: [advanceForcedEvent('design')],
      });
      writeState(dir, stAuth);
      const statusAuth = runStateWithProtocol(dir, ['status']);
      assertExit(statusAuth, 0);
      const parsedAuth = parseStatusJson(statusAuth);
      if (!Array.isArray(parsedAuth.forcedNodes) || !parsedAuth.forcedNodes.includes('design')) {
        failures271.push('(ii) 仅有 replanAuthorization 留痕且被 advance 强制的 design 应进入 forcedNodes，实际 '
          + JSON.stringify(parsedAuth.forcedNodes));
      }
      // (iv) 旧 state（无 history 字段）→ 回退「缺 evidence」判据仍生效
      const stLegacy = replanExecuteState({
        completedNodes: ['open', 'design'],
        currentNode: 'plan',
        evidence: { open: { summary: 'open exited' } },
      });
      delete stLegacy.history;
      writeState(dir, stLegacy);
      const statusLegacy = runStateWithProtocol(dir, ['status']);
      assertExit(statusLegacy, 0);
      const parsedLegacy = parseStatusJson(statusLegacy);
      if (!Array.isArray(parsedLegacy.forcedNodes) || !parsedLegacy.forcedNodes.includes('design')) {
        failures271.push('(iv) 旧 state（无 history）应回退缺 evidence 判据：design 应在 forcedNodes，实际 '
          + JSON.stringify(parsedLegacy.forcedNodes));
      }
      if (parsedLegacy.forcedNodes.includes('open')) {
        failures271.push('(iv) 旧 state（无 history）有出口证据的 open 不得进入 forcedNodes，实际 '
          + JSON.stringify(parsedLegacy.forcedNodes));
      }
      if (failures271.length > 0) {
        throw new Error('advance-forced 事件派生判据失败: ' + failures271.join(' | '));
      }
    },
  },

  // 274: M6 收窄——空退出豁免仅适用于「无任何串行任务」的全并行 change；含串行任务
  // （parallel="false"/缺省，无论 pending/done）时豁免不生效，产物校验照常执行。
  // 夹具用旧 change 语义（无 newChange）：done 缺 SUMMARY 在 M2 只 WARN → 放行与否
  // 唯一取决于 M6 是否跳过 task-summaries 产物校验（隔离判据；新 change 由 M2 硬门先行，
  // 无法观察 M6 行为）。修复前 emptyExitApproved 无条件跳过 → exit 0（本场景 RED）。
  {
    name: '274 execute exit BLOCKED：含串行任务的 change 空退出豁免不生效（M6 收窄）',
    run: (dir) => {
      const st = baseState('execute');
      st.evidence.execute = { summary: '陈旧空退出标记', emptyExitApproved: true };
      st.evidence['subagent-execute'] = { handoffResult: handoffFor(['T01']) };
      writeState(dir, st);
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="T01" parallel="false" status="done"><action>串行任务已完成但缺 SUMMARY</action><write_files>src/t1.mjs</write_files><verify>node --check src/t1.mjs</verify></task>\n');
      const res = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(res, 1);
      assertOut(res, 'BLOCKED');
      assertOut(res, 'task-summaries');
      assertOut(res, 'EMPTY-EXIT 未生效');
      assertNotOut(res, '豁免已生效');
      // 反向子锚：全并行 change 时豁免仍生效，且输出被跳过项清单（补既有全 parallel 通过锚）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md',
        '# TASK\n\n<task id="P01" parallel="true" status="pending"><action>并行任务</action><write_files>src/p1.mjs</write_files><verify>node --check src/p1.mjs</verify></task>\n');
      const resParallel = runGuard(['exit', 'execute', '--apply'], dir);
      assertExit(resParallel, 0);
      assertOut(resParallel, '豁免已生效');
      assertOut(resParallel, 'EMPTY-EXIT-SKIPPED');
    },
  },
  // 275: replan 任务内容缺失 fail-closed（引擎既有分支的回归锚）——TASK.md 不存在 / 为空（0 字节）
  // 时，真实 CLI 的 replan 必须 BLOCKED、消息给出 fail-closed 指引，且 state 字节零改写、零备份、
  // 零审计事件（判定必须先于任何写盘；不得以「空任务集签名」判幂等空操作放行）。纯空白是边界：
  // 非空串不落 task-content-missing，但同样 fail-closed 拒绝重签（无 <task> 块）。对照：同一夹具
  // 下 TASK.md 恢复为可解析任务集 → replan 放行（证明 BLOCK 来自内容缺失而非夹具畸形）。
  {
    name: '275 replan 任务内容缺失/为空 → BLOCKED fail-closed 零改写（含放行对照）',
    run: (dir) => {
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why\n\n任务内容缺失回归锚。\n');
      writeState(dir, replanExecuteState({ taskHash: REPLAN_STALE_SIGNATURE }));
      const beforeBytes = readStateBytes(dir);
      const blockedCases = [
        ['TASK.md 缺失', null],
        ['TASK.md 为空（0 字节）', ''],
      ];
      for (const [label, content] of blockedCases) {
        if (content === null) {
          fs.rmSync(path.join(dir, '.specs', CHANGE_ID, 'TASK.md'), { force: true });
        } else {
          writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', content);
        }
        const res = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
        assertExit(res, 1);
        assertOut(res, 'BLOCKED');
        assertOut(res, '任务内容缺失');
        assertOut(res, 'fail-closed');
        assertOut(res, 'TASK.md');
        assertStateBytesUnchanged(dir, beforeBytes, label);
      }
      // 边界：纯空白非空串 → 不落 task-content-missing，但同样拒绝重签（无 <task> 块），零改写
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '   \n');
      const blank = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
      assertExit(blank, 1);
      assertOut(blank, 'BLOCKED');
      assertOut(blank, '无 <task> 块');
      assertOut(blank, '零改写');
      assertStateBytesUnchanged(dir, beforeBytes, 'TASK.md 纯空白');
      // 三条 BLOCK 路径都不得产生备份 / 审计事件（写盘前拦截）
      if (replanBackupFiles(dir).length !== 0) {
        throw new Error('内容缺失路径不得产生备份: ' + JSON.stringify(replanBackupFiles(dir)));
      }
      if (replanEventsOf(readScenarioState(dir)).length !== 0) {
        throw new Error('内容缺失路径不得写审计事件: ' + JSON.stringify(replanEventsOf(readScenarioState(dir))));
      }
      // 放行对照：同夹具下 TASK.md 可解析 → replan 真实重签成功（判别力：BLOCK 不是夹具畸形导致）
      writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', REPLAN_TASK_INITIAL);
      const ok = runStateWithProtocol(dir, ['replan', '计划缺陷重校', '--authorized-by', 'user-approval']);
      assertExit(ok, 0);
      assertOut(ok, 'REPLAN');
      if (replanEventsOf(readScenarioState(dir)).length !== 1) {
        throw new Error('放行对照应恰写 1 条 replan-applied 事件');
      }
    },
  },

  // 276: 时间形态三态——本地 `+HH:mm` 与历史 `Z`（含毫秒）合法且解析等值；纯日期 / 缺时区 /
  // 偏移缺冒号 / 日历不自洽（2026-02-30，Date.parse 会静默滚动）一律非法。判据走 time-utils
  // 的导出（与消费脚本同一实现，不在套件里复制第二份）。
  {
    name: '276 时间形态三态：本地 +HH:mm / 历史 Z（含毫秒）合法等值，形态不符与日历不自洽非法',
    run: () => {
      const parse = requireModuleExport(timeUtilsModule, 'parseTimestamp', 'time-utils.mjs');
      const format = requireModuleExport(timeUtilsModule, 'formatLocalTimestamp', 'time-utils.mjs');
      const isValid = requireModuleExport(timeUtilsModule, 'isValidTimestamp', 'time-utils.mjs');

      const localWithOffset = '2026-10-02T18:30:00+08:00';
      const zulu = '2026-10-02T10:30:00Z';
      const zuluMillis = '2026-10-02T10:30:00.500Z';
      assertEqual(parse(localWithOffset), Date.parse(localWithOffset), '本地 +HH:mm 形态解析');
      assertEqual(parse(zulu), Date.parse(zulu), '历史 Z 形态解析');
      assertEqual(parse(zuluMillis), Date.parse(zuluMillis), '历史 Z + 毫秒解析');
      assertEqual(parse(localWithOffset), parse(zulu), '同一时刻的两种形态解析等值');
      assertEqual(parse(zuluMillis) - parse(zulu), 500, '毫秒分量参与解析');

      const illegal = [
        ['2026-10-02', '纯日期（无法表达时刻）'],
        ['2026-10-02T10:30:00', '缺时区'],
        ['2026-10-02T10:30:00+0800', '偏移缺冒号'],
        ['2026-10-02T10:30:00+24:00', '偏移越界'],
        ['2026-10-02T10:30:00-08:60', '偏移分钟越界'],
        ['2026-02-30T00:00:00Z', '日历不自洽'],
        ['2026-13-01T00:00:00Z', '月份越界'],
        ['不是时间', '垃圾值'],
        ['', '空串'],
        [null, '非字符串'],
      ];
      for (const [value, label] of illegal) {
        assertTrue(Number.isNaN(parse(value)),
          '非法形态未被拒绝: ' + label + ' = ' + JSON.stringify(value));
        assertTrue(!isValid(value), 'isValidTimestamp 未拒绝非法形态: ' + label);
      }

      // 生成侧：本地时间 + 显式偏移；生成 → 解析回环等值（秒级精度）
      const instant = Date.parse('2026-10-02T10:30:15Z');
      const formatted = format(new Date(instant));
      assertTrue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(formatted),
        '生成形态非「本地时间 + 显式偏移」: ' + formatted);
      assertEqual(parse(formatted), instant, '生成 → 解析回环');
    },
  },

  // 277: 单源结构锚——时间与窗口判据（formatLocalTimestamp / nowTimestamp / parseTimestamp /
  // hasSection9 / isArchivedAfterTimestamp）在全引擎**各只有一处定义**，且四个消费脚本一律从
  // time-utils 取值（含 init 写扫描时刻的 nowTimestamp：形态单一来源是双落点一致的形态前提）。
  // 判别力边界（修正旧注释的夸大——「第二份内联实现必然让本场景变红」只在**同名**时成立）：
  //   ① 定义面按**同名定义**计数：同名第二份实现（函数声明 / const 箭头）即变红；
  //   ② 消费面按**具名 import 自 time-utils.mjs + 真实调用**判定（不是纯文本存在性）：消费脚本
  //      内联同名实现顶替导出会变红——旧判据 `text.includes(name + '(')` 会被内联同名实现满足，
  //      属假绿形态（本锚升级的正是这半边）；
  //   ③ **不在本锚覆盖内**：与单源导出**不同名**、且消费方仍保留一次真实调用的等价内联实现——
  //      那类形态由各判据族的形态锚分族承担（如 295 日期前缀 / 298 裸拼接），本锚不冒充覆盖它。
  // 判别力由两条合成反向构造常驻证明（同名第二份定义 / 未具名 import 的内联实现）。
  {
    name: '277 单源结构锚：时间与窗口判据全引擎各一处定义，四个消费脚本零内联',
    run: () => {
      const singleSource = ['formatLocalTimestamp', 'nowTimestamp', 'parseTimestamp', 'hasSection9', 'isArchivedAfterTimestamp'];
      for (const name of singleSource) {
        const hits = engineDefinitionHits(name);
        assertEqual(hits.length, 1, name + ' 的定义面数量（全引擎应恰 1 处）实际 ' + JSON.stringify(hits));
        assertEqual(hits[0].file, 'time-utils.mjs', name + ' 的定义文件');
        assertEqual(hits[0].count, 1, name + ' 在 ' + hits[0].file + ' 内的定义处数');
      }
      const consumers = {
        'workflow-state.mjs': ['isValidTimestamp', 'daysSince', 'hasSection9', 'isArchivedAfterTimestamp', 'nowTimestamp', 'parseTimestamp'],
        'evolve.mjs': ['parseTimestamp', 'hasSection9', 'isArchivedAfterTimestamp', 'nowTimestamp'],
        'context-scan.mjs': ['nowTimestamp', 'formatLocalDate', 'archiveDateFromName'],
        'health.mjs': ['formatLocalTimestamp', 'formatLocalDate'],
      };
      for (const [file, symbols] of Object.entries(consumers)) {
        const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
        const problems = timeSingleSourceConsumerProblems(text, symbols, file);
        assertEqual(problems.length, 0, '消费面单源违规: ' + problems.join(' | '));
      }

      // 反向构造 ①（合成目录 · 纯函数）：同名第二份定义 → 定义面检出 2（判据不恒真空过）。
      // 样例经拼接构造，避免套件自身源码携带定义形态字面量而污染真实面计数（本套件同样在扫描面内）。
      const definitionSample = (name) => 'function ' + name + '(date) { return String(date); }\n';
      const synthetic = makeTmp();
      try {
        writeFile(synthetic, 'single.mjs', definitionSample('formatLocalTimestamp'));
        assertEqual(engineDefinitionHits('formatLocalTimestamp', synthetic).length, 1, '合成目录单份定义检出数');
        writeFile(synthetic, 'second.mjs', definitionSample('formatLocalTimestamp'));
        assertEqual(engineDefinitionHits('formatLocalTimestamp', synthetic).length, 2,
          '合成目录同名第二份定义检出数（判据须变红）');
      } finally {
        cleanupTmpDir(synthetic);
      }

      // 反向构造 ②（合成文本 · 纯函数）：内联同名实现顶替导出——旧子串判据会放过、本锚必须拒绝；
      // 另两态证明判据不恒真（具名 import 但零调用 → 必报；具名 import + 真实调用 → 零问题）。
      // 同一拼接纪律：调用形态的 `name + '('` 可以字面出现（它不是定义形态），定义形态不可。
      const inlined = 'function ' + 'parseTimestamp(text) {\n  return Date.parse(text);\n}\n'
        + "parseTimestamp('2026-10-02T10:00:00+08:00');\n";
      assertTrue(inlined.includes('parseTimestamp('), '反向构造前提不成立：旧子串判据本应命中内联实现');
      const inlinedProblems = timeSingleSourceConsumerProblems(inlined, ['parseTimestamp'], 'synthetic.mjs');
      assertTrue(inlinedProblems.some((problem) => problem.includes('未从 time-utils.mjs 具名 import')),
        '内联同名实现未被判违规（旧判据的假绿形态）: ' + JSON.stringify(inlinedProblems));
      const importedOnly = "import { parseTimestamp } from './time-utils.mjs';\nconst unused = 1;\n";
      assertTrue(timeSingleSourceConsumerProblems(importedOnly, ['parseTimestamp'], 'synthetic.mjs')
        .some((problem) => problem.includes('未真实消费')), '具名 import 但零调用未被判违规');
      const genuine = "import { parseTimestamp } from './time-utils.mjs';\n"
        + 'export const instant = (value) => parseTimestamp(value);\n';
      assertEqual(timeSingleSourceConsumerProblems(genuine, ['parseTimestamp'], 'synthetic.mjs').length, 0,
        '具名 import + 真实调用不应被判违规');
    },
  },

  // 278: evolve 增量窗口与历史 `Z` 兼容——窗口内入选 / 窗口外排除 / 无基线全量；扫描严格限定在
  // 设计文档的沉淀段（其它段的标记串不得出现在输出）；`scan` 零写入用树指纹对照。
  {
    name: '278 evolve 窗口：窗口内入选·窗口外排除·无基线全量 + 历史 Z 兼容 + 只读沉淀段 + 零写入',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-08-20-old/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n- 窗口外条目\n');
      writeFile(dir, '.specs/archive/2026-09-10-new/DESIGN.md',
        '# DESIGN\n\n## 5. 其它段\n\nOTHER-SECTION-MARKER\n\n## 9. 架构沉淀\n\n- 窗口内条目\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      const state = baseState('open');
      state.last_evolve_at = '2026-09-01T00:00:00Z'; // 历史 Z 形态基线
      writeState(dir, state);

      const before = treeFingerprint(dir);
      const res = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(res, 0);
      assertOut(res, 'EVOLVE: 扫描');
      assertOut(res, '窗口 起始 = 2026-09-01T00:00:00Z');
      assertOut(res, '归档 2 个 · 窗口内 1 个 · 含沉淀段 1 个');
      assertOut(res, '2026-09-10-new#1');
      assertNotOut(res, '2026-08-20-old#');
      assertNotOut(res, 'OTHER-SECTION-MARKER'); // 只读沉淀段：其它段的标记串不进候选
      const written = fingerprintChanges(before, treeFingerprint(dir));
      assertEqual(written.length, 0, 'scan 必须零写入，实际树变化: ' + JSON.stringify(written));

      // 等值的 `+00:00` 形态给出同一窗口（兼容历史 Z 与本地偏移两种写法，不是两套语义）
      const offsetState = { ...state, last_evolve_at: '2026-09-01T00:00:00+00:00' };
      writeState(dir, offsetState);
      const offsetRes = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(offsetRes, 0);
      assertOut(offsetRes, '窗口 起始 = 2026-09-01T00:00:00+00:00');
      assertOut(offsetRes, '窗口内 1 个');
      assertNotOut(offsetRes, '上次沉淀时间不可解析');

      // 不可解析的基线 → 显式按全量扫描（不静默当成「无新增」）
      writeState(dir, { ...state, last_evolve_at: '不是时间' });
      const broken = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(broken, 0);
      assertOut(broken, '上次沉淀时间不可解析（按全量扫描）');
      assertOut(broken, '窗口内 2 个');

      // 无基线（字段缺席）→ 全量扫描
      writeState(dir, baseState('open'));
      const noBaseline = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(noBaseline, 0);
      assertOut(noBaseline, '无基线（首次运行，全量扫描）');
      assertOut(noBaseline, '窗口内 2 个');
      assertOut(noBaseline, '2026-08-20-old#1');
    },
  },

  // 279: 到期提示两因与静默——「距今 > 60 天」或「该时刻之后新增 ≥ 5 个带 §9 的归档 change」
  // 达阈值即输出 `EVOLVE-DUE`（提示行不含花括号，status 的 JSON 块仍可被既有消费方解析）；
  // 未达阈值 / 字段缺席（从未跑过 evolve）一律零输出；非法值经 `config set` 写入 → BLOCKED 零改写。
  {
    name: '279 到期提示：按天数·按新增数达阈值提示，未达阈值与字段缺席静默，JSON 块可解析',
    run: (dir) => {
      const formatStamp = requireModuleExport(timeUtilsModule, 'formatLocalTimestamp', 'time-utils.mjs');
      const formatDate = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs');
      const dayMs = 24 * 60 * 60 * 1000;
      const stampDaysAgo = (days) => formatStamp(new Date(Date.now() - days * dayMs));
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md', '# CHANGE\n\n## Why（为什么做）\n\n夹具。\n');

      // ① 按天数：距今 100 天 → 提示行 + JSON 块仍可解析
      writeState(dir, { ...baseState('open'), last_evolve_at: stampDaysAgo(100) });
      const aged = runStateWithProtocol(dir, ['status']);
      assertExit(aged, 0);
      assertOut(aged, 'EVOLVE-DUE: 上次架构沉淀');
      assertOut(aged, '超阈值 60 天');
      assertEqual(parseStatusJson(aged).status, 'running', '提示行在场时 status 的 JSON 块解析');

      // ② 未达阈值（新鲜）→ 静默；③ 字段缺席（从未跑过 evolve）→ 同样静默
      writeState(dir, { ...baseState('open'), last_evolve_at: stampDaysAgo(1) });
      assertNotOut(runStateWithProtocol(dir, ['status']), 'EVOLVE-DUE');
      writeState(dir, baseState('open'));
      assertNotOut(runStateWithProtocol(dir, ['status']), 'EVOLVE-DUE');

      // ④ 按新增数：基线之后 5 个带 §9 的归档 change → 提示；取走一个（4 个）→ 静默
      const baselineMs = Date.now() - 30 * dayMs;
      const baselineStamp = formatStamp(new Date(baselineMs));
      const archiveDirName = (offsetDays) => formatDate(new Date(baselineMs + offsetDays * dayMs)) + '-new-' + offsetDays;
      for (let offset = 1; offset <= 5; offset += 1) {
        writeFile(dir, '.specs/archive/' + archiveDirName(offset) + '/DESIGN.md',
          '# DESIGN\n\n## 9. 架构沉淀\n\n- 条目 ' + offset + '\n');
      }
      writeState(dir, { ...baseState('open'), last_evolve_at: baselineStamp });
      const byCount = runStateWithProtocol(dir, ['status']);
      assertExit(byCount, 0);
      assertOut(byCount, 'EVOLVE-DUE: 上次架构沉淀');
      assertOut(byCount, '其后新增 5 个带 §9 的归档 change，达阈值 5 个');
      parseStatusJson(byCount);
      fs.rmSync(path.join(dir, '.specs', 'archive', archiveDirName(5)), { recursive: true, force: true });
      assertNotOut(runStateWithProtocol(dir, ['status']), 'EVOLVE-DUE');

      // ⑤ 非法值经唯一写通道写入 → BLOCKED 且 state 字节零改写
      const beforeBytes = readStateBytes(dir);
      const illegal = runStateWithProtocol(dir, ['config', 'set', 'last_evolve_at', '2026-02-30T00:00:00Z']);
      assertExit(illegal, 1);
      assertOut(illegal, 'BLOCKED');
      assertOut(illegal, 'last_evolve_at');
      assertStateBytesUnchanged(dir, beforeBytes, 'last_evolve_at 非法值');
    },
  },

  // 280: health 复现性——同一冻结树两次运行，差异必须落在报告的「易变行声明」集合内（声明的
  // 差异集合之外逐字节一致）；`--stdout` 与落盘逐字节相同；state 零改写（报告是唯一写入面）。
  {
    name: '280 health 两次运行：易变行声明之外逐字节一致 + --stdout 与落盘相同 + state 零改写',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n\n### L-002 次条\n');
      writeState(dir, baseState('open'));
      const stateBytes = readStateBytes(dir);

      const first = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(first, 0);
      assertOut(first, '## 确定性层（机器可判）');
      assertOut(first, '### 1 · 项目上下文一致性');
      assertOut(first, '### 2 · 经验条目编号连续性');
      assertOut(first, '- 缺失编号（0）：无');
      assertOut(first, '## 增补层（代码体检工具的 4 维结果 · 可选）');
      assertOut(first, '## 降级声明');
      assertOut(first, '## 易变行声明（两次运行的允许差异集合）');

      const second = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(second, 0);
      const volatilePrefixes = ['- **生成时间**：', '- 最近 30 天提交数：'];
      const firstLines = first.output.split('\n');
      const secondLines = second.output.split('\n');
      const differing = [];
      for (let i = 0; i < Math.max(firstLines.length, secondLines.length); i += 1) {
        if (firstLines[i] === secondLines[i]) continue;
        const line = firstLines[i] ?? secondLines[i] ?? '';
        if (volatilePrefixes.some((prefix) => line.startsWith(prefix))) continue;
        differing.push('第 ' + (i + 1) + ' 行 ' + JSON.stringify(firstLines[i]) + ' → ' + JSON.stringify(secondLines[i]));
      }
      assertEqual(differing.length, 0, '两次运行的差异落在易变行声明之外: ' + differing.join(' | '));

      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const reportFile = path.join(dir, '.specs', 'health', today + '-HEALTH.md');
      assertTrue(fs.existsSync(reportFile), '报告未按 <日期>-HEALTH.md 形态落盘: ' + reportFile);
      // `--stdout` = 落盘报告正文原样在前 + `HEALTH:` 审计行追加在后：审计行是 CLI 摘要而非报告
      // 内容，不进报告字节（报告仍是唯一写入面）；正文部分与落盘逐字节一致。
      const reportText = fs.readFileSync(reportFile, 'utf8');
      assertTrue(second.output.startsWith(reportText),
        '--stdout 的报告正文应与落盘逐字节一致（审计行追加在后）: ' + JSON.stringify(second.output.slice(0, 120)));
      assertOut(second, 'HEALTH: 报告 `.specs/health/' + today + '-HEALTH.md`');
      assertOut(second, 'HEALTH-DONE');
      assertOut(second, '- **写入边界**：只写本报告文件；不改代码、不写运行状态文件（本命令不新增任何状态字段）');
      assertStateBytesUnchanged(dir, stateBytes, 'health 运行后');
      // 同日重跑不与自己对比（否则报告自我污染、复现性判据失效）
      assertOut(second, '基线：无（`.specs/health` 下无日期不同的历史报告）');
    },
  },

  // 281: health 缺可选工具的两态之一——隔离 HOME/USERPROFILE（用户级插件缓存与用户技能目录
  // 都落主目录）→ 增补层逐项不在场、降级声明可见，确定性层照常完整、退出码 0（可选工具缺席
  // 不构成失败；本机实际装有 brooks，故须隔离而不是假设）。
  {
    name: '281 health 隔离 HOME：增补层逐项不在场 + 降级声明可见 + 确定性层完整 + exit 0',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n');
      const isolatedHome = path.join(dir, 'isolated-home');
      fs.mkdirSync(isolatedHome, { recursive: true });

      const isolated = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir,
        { HOME: isolatedHome, USERPROFILE: isolatedHome });
      assertExit(isolated, 0);
      assertOut(isolated, '- **在场判定**：不在场——下列探测面逐项未命中（未安装 / 未加载）');
      assertOut(isolated, 'Claude Code 插件缓存（用户级）');
      assertOut(isolated, '- **降级**：4 维结果缺省；报告只由确定性层构成（判据不因缺可选工具而失败）');
      assertOut(isolated, '- **brooks-lint**：不可用——探测面逐项未命中');
      assertOut(isolated, '## 确定性层（机器可判）');
      assertOut(isolated, '### 5 · 版本历史统计（git）');
      assertOut(isolated, '缺席不影响本命令成功（退出码 0）');

      // 对照：未隔离运行同样以完整报告 + 退出码 0 收尾（在场与否随环境，报告形态不变）
      const openEnv = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(openEnv, 0);
      assertOut(openEnv, '- **探测面（固定清单 · 逐项判定）**：');
      assertOut(openEnv, '## 确定性层（机器可判）');
    },
  },

  // 282: context-scan 首次无基线与二次差异——首次显式声明「本次为基线，无差异可比」；第二次
  // 逐项比对出新增；同一秒连续重扫不得误 BLOCK；双落点（state 的 last_intel_scan 与 CONTEXT
  // 的 `## intel-scan 元数据` 字段）取值一致；工件含机器快照标记。
  {
    name: '282 context-scan 首次无基线 → 二次差异：新增可比 + 同秒重扫 exit 0 + 双落点一致',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      const first = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(first, 0);
      assertOut(first, 'CONTEXT-SCAN: 基线 无（本次为基线，无差异可比）');
      assertOut(first, 'CONTEXT-SCAN: 差异 无（本次为基线，无差异可比）');
      assertOut(first, 'CONTEXT-SCAN-DONE');

      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const reportFile = path.join(dir, '.specs', 'context-scan', today + '-SCAN.md');
      assertTrue(fs.existsSync(reportFile), '扫描工件未落盘: ' + reportFile);
      const reportText = fs.readFileSync(reportFile, 'utf8');
      assertTrue(reportText.includes('<!-- context-scan-snapshot -->'), '工件缺机器快照标记');
      assertTrue(/```json\r?\n/.test(reportText.slice(reportText.indexOf('<!-- context-scan-snapshot -->'))),
        '机器快照标记之后缺 json 块');

      // 同一秒连续重扫（取值未变）不得被误判成字段行形态不符
      const immediate = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(immediate, 0);
      assertOut(immediate, 'CONTEXT-SCAN-DONE');

      // 双落点：state 的 last_intel_scan 与 CONTEXT 段内字段**取值词元**一致（夹具段行带行尾说明）
      const structure = requireModuleExport(contextInitModule, 'extractContextStructure', 'context-init.mjs')(
        fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8'));
      const landed = intelFieldToken(structure.metadata['intel-scan 元数据'].last_intel_scan.value);
      const stateFile = JSON.parse(fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8'));
      assertEqual(stateFile.last_intel_scan, landed, '双落点取值（state 与 CONTEXT 段）');
      assertTrue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(landed),
        '落盘扫描时刻形态非「本地时间 + 显式偏移」: ' + landed);

      // 二次差异：新增一份 AI 上下文文档 → 差异段「新增」列出该条目（条目在工件内，摘要行只给计数）
      writeFile(dir, 'AGENTS.md', '# AGENTS\n\n夹具。\n');
      const second = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(second, 0);
      assertOut(second, 'CONTEXT-SCAN: 基线');
      assertOut(second, '差异 新增 1 ');
      assertOut(second, 'CONTEXT-SCAN-DONE');
      const diffReport = fs.readFileSync(reportFile, 'utf8');
      assertTrue(diffReport.includes('### 新增（1）'), '工件缺「新增（1）」段');
      assertTrue(diffReport.includes('- AI 上下文文档 · AGENTS.md'),
        '工件的新增段未列出新增的 AI 上下文文档');
    },
  },

  // 283: context-scan 四类边界——① 既有基线不含机器快照 → 显式「无法比对」（不静默省略差异段）；
  // ② 结构校验不通过的一轮零写入且基线不前进（工件与 state 逐字节不变）；③ 未初始化项目 →
  // INIT-GENERATE 指引 + 零写入 + exit 1；④ state 在场但字段非法 → CONTEXT 段零改写
  // （校验先于两次写入，双落点不被拆成两半）。
  {
    name: '283 context-scan 边界：旧基线无快照显式无法比对 / BLOCK 轮不推进基线 / 未初始化零写入 / state 字段非法零改写',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      // ① 旧基线不含机器快照（人读工件的历史形态）
      const legacyBaseline = path.join(dir, '.specs', 'context-scan', '2020-01-01-SCAN.md');
      fs.mkdirSync(path.dirname(legacyBaseline), { recursive: true });
      fs.writeFileSync(legacyBaseline, '# 项目上下文重扫报告 · 2020-01-01\n\n（历史工件，无机器快照块）\n', 'utf8');
      const legacyRes = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(legacyRes, 0);
      assertOut(legacyRes, 'CONTEXT-SCAN: 差异 无（既有基线不含机器快照，无法比对）');
      assertOut(legacyRes, 'CONTEXT-SCAN-DONE');

      // ② 结构校验不通过的一轮：零写入，基线不前进
      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const baselineFile = path.join(dir, '.specs', 'context-scan', today + '-SCAN.md');
      assertTrue(fs.existsSync(baselineFile), '本轮基线工件应在场: ' + baselineFile);
      const baselineBytes = fs.readFileSync(baselineFile);
      const stateBytes = readStateBytes(dir);
      fs.writeFileSync(path.join(dir, '.specs', 'CONTEXT.md'),
        contextFixtureText().replace('## 默认偏好\n', ''), 'utf8');
      const blocked = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED: CONTEXT.md 未通过结构校验');
      assertTrue(fs.readFileSync(baselineFile).equals(baselineBytes), 'BLOCK 的一轮改写了基线工件');
      assertStateBytesUnchanged(dir, stateBytes, 'context-scan BLOCK 轮');

      // ③ 未初始化项目：INIT-GENERATE 指引 + 零写入 + exit 1
      const fresh = path.join(dir, 'fresh-project');
      fs.mkdirSync(fresh, { recursive: true });
      const freshBefore = treeFingerprint(fresh);
      const freshRes = runSideScript(SIDE_CONTEXT_SCAN, ['--root', fresh], fresh);
      assertExit(freshRes, 1);
      assertOut(freshRes, 'INIT-GENERATE');
      assertOut(freshRes, 'BLOCKED');
      const freshChanges = fingerprintChanges(freshBefore, treeFingerprint(fresh));
      assertEqual(freshChanges.length, 0, '未初始化项目必须零写入，实际树变化: ' + JSON.stringify(freshChanges));

      // ④ state 在场但字段非法（写闸门会拒）：CONTEXT 段必须零改写。校验此前排在 CONTEXT 改写之后
      //   ⇒ 段侧先落新扫描时刻、state 侧被拒，双落点被拆成两半（且段侧指向引擎根本不认的时刻）。
      //   与同一命令的损坏态判定（preflight ②：状态不可信 → 零元数据写入）是同一姿态。
      const badStateRoot = path.join(dir, 'bad-state-field');
      writeFile(badStateRoot, '.specs/CONTEXT.md', contextFixtureText());
      writeState(badStateRoot, { ...baseState('open'), executionMode: 'not-a-mode' });
      const badContextBefore = fs.readFileSync(path.join(badStateRoot, '.specs', 'CONTEXT.md'));
      const badStateBytes = readStateBytes(badStateRoot);
      const badStateRes = runSideScript(SIDE_CONTEXT_SCAN, ['--root', badStateRoot], badStateRoot);
      assertExit(badStateRes, 1);
      assertOut(badStateRes, 'BLOCKED');
      assertTrue(fs.readFileSync(path.join(badStateRoot, '.specs', 'CONTEXT.md')).equals(badContextBefore),
        'state 字段非法的一轮改写了 CONTEXT 段（双落点被拆成两半）');
      assertStateBytesUnchanged(badStateRoot, badStateBytes, 'context-scan state 字段非法轮');
    },
  },

  // 284: 本仓 CONTEXT 的七段校验 + 可选的 `## evolve 元数据` 段语义——缺席不报（没跑过架构
  // 沉淀的项目不补段）；在场则三字段必须齐（跑过一次却写残的半成品正是要拦的形态）；判据
  // **限定在段内**（别处的同名字段不得让残缺的 evolve 段蒙混过关）。
  // ① 是本仓真实文件的**维护者形态**断言（.specs/ 被 gitignore）：文件结构性缺席（CI 全新检出 /
  // worktree）时输出可见 SKIP 行（未验证 ≠ 通过），**在场时判据逐字不变**；②~⑤ 恒检（夹具驱动）。
  {
    name: '284 CONTEXT 七段校验 + evolve 元数据可选段：缺席不报·在场缺一即报·判据限段内',
    run: async () => {
      const validate = requireModuleExport(contextInitModule, 'validateContext', 'context-init.mjs');

      // ① 本仓 CONTEXT.md 通过七段校验（真实文件，非夹具）——文件缺席即非维护者形态，可见跳过
      if (fs.existsSync(REPO_CONTEXT_FILE)) {
        const repo = await validate(REPO_ROOT);
        assertEqual(repo.missingSections.length, 0, '本仓 CONTEXT.md 缺段: ' + JSON.stringify(repo.missingSections));
        assertEqual(repo.formatIssues.length, 0, '本仓 CONTEXT.md 格式问题: ' + JSON.stringify(repo.formatIssues));
      } else {
        console.log('SKIP: 284 的本仓 CONTEXT 面（.specs/CONTEXT.md 为流程工件面，可能结构性缺席）'
          + '——本仓 CONTEXT 缺席 = 非维护者形态；本次检出未校验本仓 CONTEXT.md 的七段与 evolve 元数据段语义，'
          + '请在维护者主树重跑本套件');
      }

      // ② 夹具：七段齐备、evolve 段缺席 → 通过（可选段的缺席不报）
      const project = makeTmp();
      try {
        writeFile(project, '.specs/CONTEXT.md', contextFixtureText());
        const absent = await validate(project);
        assertEqual(absent.missingSections.length, 0, '七段骨架缺段: ' + JSON.stringify(absent.missingSections));
        assertEqual(absent.formatIssues.length, 0, 'evolve 段缺席不应报格式问题: ' + JSON.stringify(absent.formatIssues));

        // ③ evolve 段在场且三字段齐 → 通过
        writeFile(project, '.specs/CONTEXT.md',
          contextFixtureText({ evolveSection: EVOLVE_METADATA_FIELD_LINES }));
        const complete = await validate(project);
        assertEqual(complete.formatIssues.length, 0, 'evolve 段齐备仍报格式问题: ' + JSON.stringify(complete.formatIssues));

        // ④ 段内缺一个字段 → 报「evolve 元数据三字段」
        writeFile(project, '.specs/CONTEXT.md',
          contextFixtureText({ evolveSection: EVOLVE_METADATA_FIELD_LINES.slice(0, 2) }));
        const incomplete = await validate(project);
        assertTrue(incomplete.formatIssues.some((issue) => issue.includes('evolve 元数据三字段')),
          'evolve 段缺字段未报出: ' + JSON.stringify(incomplete.formatIssues));

        // ⑤ 判据限段内：缺的那个字段出现在**其它段**里，不得让残缺的 evolve 段蒙混过关
        writeFile(project, '.specs/CONTEXT.md', contextFixtureText({
          evolveSection: EVOLVE_METADATA_FIELD_LINES.slice(0, 2),
          tail: '## 其它段\n\n- **下次建议**: 别处的同名字段',
        }));
        const outside = await validate(project);
        assertTrue(outside.formatIssues.some((issue) => issue.includes('evolve 元数据三字段')),
          '判据未限定段内（别处的同名字段放行了残缺段）: ' + JSON.stringify(outside.formatIssues));
      } finally {
        cleanupTmpDir(project);
      }
    },
  },

  // 285: design 出口 ui-design 门四类——正例（前端齐备 + 真实声明 → 放行）/ 负例（缺工件
  // BLOCKED、缺声明 BLOCKED 且不再自动补写）/ 越界（非前端 → 可见跳过，不要求工件与声明）/
  // 恢复（旧 change 前端缺件 → WARN 渐进不卡死）。前端判据是结构级：CHANGE.md「视觉调性」段。
  {
    name: '285 ui-design 门四类：前端齐备放行 / 前端缺件 BLOCK / 非前端可见跳过 / 旧 change WARN',
    run: (dir) => {
      // 正例：前端（「视觉调性」段在场且未标注不适用）+ 工件齐备 + 真实声明
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: true,
      });
      const positive = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(positive, 0);
      assertOut(positive, 'ALL CHECKS PASSED');
      assertNotOut(positive, 'UI-DESIGN: skipped');

      // 负例 A：前端缺 UI-DESIGN.md → BLOCKED + 两条恢复路径
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: true,
      });
      const missingArtifact = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(missingArtifact, 1);
      assertOut(missingArtifact, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertOut(missingArtifact, '恢复: 补 .specs/' + CHANGE_ID + '/UI-DESIGN.md');

      // 负例 B：工件齐备但缺 `required-skill:design.flow-comet-ui-design` → BLOCKED（出口不再自动补写）
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: false,
      });
      const missingDeclaration = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(missingDeclaration, 1);
      assertOut(missingDeclaration, 'BLOCKED: missing required Skill evidence: required-skill:design.flow-comet-ui-design');
      assertOut(missingDeclaration, '不再由出口自动补写');

      // 越界：非前端（「视觉调性」段标注不适用）→ 可见跳过，不要求工件、也不要求该声明
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_NOT_APPLICABLE, uiDesign: false, declareUiDesign: false,
      });
      const nonFrontend = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(nonFrontend, 0);
      assertOut(nonFrontend, 'UI-DESIGN: skipped（非前端）');
      assertOut(nonFrontend, 'ALL CHECKS PASSED');

      // 恢复：旧 change 前端缺件 → WARN 渐进（不阻断，也不静默放行）
      writeDesignExitFixture(dir, {
        newChange: false, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: true,
      });
      const legacy = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(legacy, 0);
      assertOut(legacy, 'UI-DESIGN WARN: 缺 .specs/' + CHANGE_ID + '/UI-DESIGN.md');
      assertOut(legacy, '旧 change 渐进不阻断');
    },
  },

  // 286: ui-design 强制等级的文本一致性锚——协议 `design.requiredSkillCalls[flow-comet-ui-design]`
  // 为 `guarded`，**五份**技能文本（ui-design 技能 / 入口 SKILL / design 节点 SKILL / 入口展开册
  // `reference/entry-detail.md` / change 阶段 SKILL）不得残留 `advisory` 表述且须同时点名该绑定与
  // `guarded`。等级只在协议里表达一次，文本是它的散文副本：副本漂移即红（旧表述「advisory，不要求
  // 声明」正是被本锚拦下的形态）。
  // **判据散文口径（ADR-016 重定向）**：原判据要求**五份文本各自**陈述五个结构 token，且反向构造
  // 断言**每份**文本都含「词形边界」——T05 把口径收归 `flow-comet-ui-design` 册一处权威后，那一侧
  // 会以两种方式失败（五份各自的 token 缺失 + 反向构造前提不成立）。新判据三件套：**一处权威**
  //（ui-design 册陈述五个结构 token 且零旧口径）+ **入口册指针在场**（各引用册以条件句指向该册）
  // + **该口径正文唯一**（块级跨距：任何其它分发文本不得含权威口径段的 ≥120 字符逐字副本）。
  {
    name: '286 ui-design 强制等级一致性锚：协议 guarded + 五处技能文本零 advisory 残留 + 结构判据散文口径',
    run: () => {
      const protocol = JSON.parse(fs.readFileSync(SKILL_PROTOCOL_FILE, 'utf8'));
      const designNode = (protocol.nodes ?? []).find((node) => node.id === 'design');
      assertTrue(designNode !== undefined, '协议缺 design 节点');
      const binding = (designNode.requiredSkillCalls ?? []).find((call) => call.skill === 'flow-comet-ui-design');
      assertTrue(binding !== undefined, '协议 design 节点缺 flow-comet-ui-design 绑定');
      assertEqual(binding.enforcement, 'guarded', '协议 flow-comet-ui-design 绑定的强制等级');

      const skillsRoot = skillsRootForScriptsDir(__dirname);
      const texts = {
        'flow-comet-ui-design/SKILL.md': path.join(skillsRoot, 'flow-comet-ui-design', 'SKILL.md'),
        'flow-comet/SKILL.md': path.join(skillsRoot, 'flow-comet', 'SKILL.md'),
        'flow-comet-design/SKILL.md': path.join(skillsRoot, 'flow-comet-design', 'SKILL.md'),
        'flow-comet/reference/entry-detail.md': path.join(skillsRoot, 'flow-comet', 'reference', 'entry-detail.md'),
        'flow-comet-change/SKILL.md': path.join(skillsRoot, 'flow-comet-change', 'SKILL.md'),
      };
      const textByRel = new Map();
      for (const [label, file] of Object.entries(texts)) {
        const text = fs.readFileSync(file, 'utf8');
        textByRel.set(label, text);
        assertTrue(!/advisory/i.test(text), label + ' 残留 advisory 等级表述（协议为 guarded）');
        assertTrue(text.includes('guarded'), label + ' 未点名 guarded 等级');
        assertTrue(text.includes('flow-comet-ui-design'), label + ' 未点名 flow-comet-ui-design 绑定');
      }
      // —— 结构判据散文口径的三件套（重定向后判据；纯函数 + 合成文本面驱动）——
      const criterionSources = {
        authorityRel: FRONTEND_CRITERION_AUTHORITY_REL,
        authorityText: textByRel.get(FRONTEND_CRITERION_AUTHORITY_REL),
        pointerDocs: new Map(FRONTEND_CRITERION_POINTER_RELS.map(([rel]) => [rel, textByRel.get(rel)])),
        docs: new Map(skillTreeDocFiles().map(([rel, file]) => [rel, fs.readFileSync(file, 'utf8')])),
      };
      const criterionProblems = frontendCriterionRedirectProblems(criterionSources);
      assertEqual(criterionProblems.length, 0, '判据散文口径未对齐: ' + criterionProblems.join(' | '));
      // 反向构造（合成输入驱动同一判据，证明它不恒真空过）：
      // ① 结构词缺一 → 必报；② 旧口径句注入权威处 → 必报「残留旧口径」；
      // ③ 权威口径段复制进第二册 → 必报「第二份正文」（原「五份各自陈述」的方向已反转）；
      // ④ 抽掉入口册指针 → 必报「指针不在场」。
      const structuralSample = '前端判据是结构级的：独立行 / 行首 / 适用性标签的字段值位三种形态，'
        + '标记后须成词形边界，命中片段回显。\n';
      assertEqual(frontendCriterionProseProblems('sample', structuralSample).length, 0,
        '结构口径样本不应被判违规（判据不恒真）');
      const staleSamples = [
        '前端判据是结构级的：`CHANGE.md` 的「视觉调性」段在场且段内未标注「不适用」。',
        '段在场，段内**不含**字面「不适用」',
        '非前端项目：在段内标注「不适用」两个字面。',
      ];
      for (const stale of staleSamples) {
        const probed = frontendCriterionRedirectProblems({
          ...criterionSources,
          authorityText: criterionSources.authorityText + '\n' + stale + '\n',
        });
        assertTrue(probed.some((problem) => problem.includes('残留旧口径')),
          '旧口径样本未被判违规: ' + JSON.stringify(stale) + ' → ' + JSON.stringify(probed));
      }
      for (const group of FRONTEND_CRITERION_STRUCTURE_GROUPS) {
        // OR 组的反向构造必须抽掉**整组** token（只抽一个会被组内另一形态满足而恒真）。
        const strippedText = group.reduce((acc, token) => acc.split(token).join('（反向构造：抽掉）'),
          criterionSources.authorityText);
        const stripped = frontendCriterionRedirectProblems({
          ...criterionSources,
          authorityText: strippedText,
        });
        assertTrue(stripped.some((problem) => problem.includes('未陈述结构形态')),
          '权威处抽掉结构形态组「' + group.join(' / ') + '」未被判违规: ' + JSON.stringify(stripped));
      }
      const criterionBlock = frontendCriterionAuthorityBlock(criterionSources.authorityText);
      assertTrue(criterionBlock !== null, '权威口径段切片为空（缺「结构形态」三种任一 → 仍判前端 的整段）');
      const copied = frontendCriterionRedirectProblems({
        ...criterionSources,
        docs: new Map(criterionSources.docs).set('flow-comet-design/SKILL.md',
          criterionSources.docs.get('flow-comet-design/SKILL.md') + '\n' + criterionBlock + '\n'),
      });
      assertTrue(copied.some((problem) => problem.includes('第二份正文')),
        '权威口径段复制进第二册未被判违规: ' + JSON.stringify(copied));
      const pointerStripped = frontendCriterionRedirectProblems({
        ...criterionSources,
        pointerDocs: new Map([...criterionSources.pointerDocs].map(([rel, text]) => [rel,
          text.split('唯一权威').join('（反向构造：抽掉指针）')])),
      });
      assertTrue(pointerStripped.some((problem) => problem.includes('指针不在场')),
        '抽掉各册指针未被判违规: ' + JSON.stringify(pointerStripped));
      // 行为口径的散文锚：非前端可见跳过 + 旧 change 渐进（与 285 的行为断言同源）
      const uiDesignSkill = fs.readFileSync(texts['flow-comet-ui-design/SKILL.md'], 'utf8');
      assertTrue(uiDesignSkill.includes('UI-DESIGN: skipped（非前端）'), 'ui-design 技能缺非前端跳过口径');
      assertTrue(uiDesignSkill.includes('旧 change') && uiDesignSkill.includes('WARN'),
        'ui-design 技能缺旧 change 渐进口径');
    },
  },

  // 287: 真实 `init` 跨 change 的 evolve 基线保留——`last_evolve_at` 与 `last_intel_scan` 同形
  // （两者都是**项目级**字段：换 change 不该丢）。场景 278/279 的窗口与到期锚全用 `writeState` 直注
  // （覆盖缺口：那条旁路绕开了 init 的保留清单，本缺陷因此完整逃过 286+90）；
  // 本场景**全程只走真实 `init` 子命令**，证明的是「跨 change 持久性」这条正常路径：
  //   设基线 → init 新 change → 基线仍在 + `status` 的 EVOLVE-DUE 仍生效 + `evolve scan` 窗口仍按基线过滤。
  // 断言面刻意覆盖 C1 的全部三条后果（字段丢失 / 到期提示消失 / 窗口静默退化为全量）。
  {
    name: '287 真实 init 跨 change：last_evolve_at 保留（基线在场·到期提示仍生效·扫描窗口仍过滤）',
    run: (dir) => {
      const formatStamp = requireModuleExport(timeUtilsModule, 'formatLocalTimestamp', 'time-utils.mjs');
      const formatDate = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs');
      const dayMs = 24 * 60 * 60 * 1000;
      const dateDaysAgo = (days) => formatDate(new Date(Date.now() - days * dayMs));
      // 窗口两侧各一条带 §9 的归档 change（窗口过滤按目录名日期前缀判定，基线落在两者之间）
      writeFile(dir, '.specs/archive/' + dateDaysAgo(101) + '-before-baseline/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n- 窗口外条目\n');
      writeFile(dir, '.specs/archive/' + dateDaysAgo(99) + '-after-baseline/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n- 窗口内条目\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());

      // ① 真实 init 建首个 change → 经**唯一写通道**落基线（100 天前：到期判据按天数必然触发）
      assertExit(runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-skip']), 0);
      const baseline = formatStamp(new Date(Date.now() - 100 * dayMs));
      const setRes = runStateWithProtocol(dir, ['config', 'set', 'last_evolve_at', baseline]);
      assertExit(setRes, 0);
      assertOut(setRes, 'CONFIG: last_evolve_at = ' + baseline);

      // ② 真实 init 换 change——跨 change 的全部动作就是这一步（不碰 writeState）
      const secondInit = runStateWithProtocol(dir, ['init', CHANGE_ID + '-2', '--init-skip']);
      assertExit(secondInit, 0);
      const state = JSON.parse(readStateBytes(dir));
      assertEqual(state.activeChange, CHANGE_ID + '-2', 'init 后 activeChange');
      assertEqual(state.last_evolve_at, baseline, 'init 跨 change 保留 last_evolve_at');

      // ③ 到期提示仍生效（AC-18 的跨 change 形态）+ 提示行在场时 status 的 JSON 块仍可解析
      const status = runStateWithProtocol(dir, ['status']);
      assertExit(status, 0);
      assertOut(status, 'EVOLVE-DUE: 上次架构沉淀 ' + baseline);
      assertOut(status, '超阈值 60 天');
      assertEqual(parseStatusJson(status).status, 'running', '提示行在场时 status 的 JSON 块解析');

      // ④ 增量窗口仍按基线过滤（AC-4 的跨 change 形态）：窗口内入选、窗口外排除，
      //    且**不**退回「无基线（首次运行，全量扫描）」——后者正是窗口静默退化为全量的形态
      const scan = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(scan, 0);
      assertOut(scan, '窗口 起始 = ' + baseline);
      assertOut(scan, '归档 2 个 · 窗口内 1 个 · 含沉淀段 1 个');
      assertOut(scan, 'after-baseline#1');
      assertNotOut(scan, 'before-baseline#');
      assertNotOut(scan, '无基线（首次运行，全量扫描）');
    },
  },

  // 288: ui-design 工件门按协议绑定键控（负例面：协议删掉绑定）——闸门开关由协议里的 binding
  // 表达（在场 ∧ 等级 = guarded），门禁侧只复用同一登记表 / requiredSkillCalls 查询，不存在第二份
  // 键表。四类：负例（删绑定 → 门随绑定退场，且留可见「门未启用」行，不静默消失）/ 正例（绑定在
  // 场且 guarded → 前端缺件仍 BLOCKED，键控未误伤既有语义）/ 越界（绑定缺席时 design 的另一
  // guarded 绑定仍由出口自动补写——其它绑定路径逐字不变）/ 恢复（协议写回 guarded 绑定 → 门重新
  // 拦住，键控是活判据不是一次性快照）。
  {
    name: '288 ui-design 门按协议绑定键控：删绑定门退场（可见行）/ 在场仍拦 / 其它绑定零改动 / 写回即恢复',
    run: (dir) => {
      // 负例：协议删掉该绑定 → 前端判据成立且缺件也不再拦（门随绑定退场）
      writeUiDesignBindingVariant(dir, 'absent');
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: true,
      });
      const absent = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(absent, 0);
      assertOut(absent, 'ALL CHECKS PASSED');
      assertOut(absent, 'UI-DESIGN: 门未启用（协议 design 节点未登记 flow-comet-ui-design 绑定）');
      assertNotOut(absent, 'BLOCKED');
      assertNotOut(absent, 'UI-DESIGN: skipped');

      // 越界：绑定缺席时 design 的另一 guarded 绑定（flow-comet-design）仍由出口自动补写——
      // 零真实声明也放行，证明自动补语义只在登记表命中的绑定上改道
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: false, declareDesign: false,
      });
      const otherBindings = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(otherBindings, 0);
      assertOut(otherBindings, 'ALL CHECKS PASSED');

      // 正例：协议写回 guarded 绑定 → 同一夹具、同一 change 立刻恢复拦截（与既有语义逐字一致）
      writeUiDesignBindingVariant(dir, 'guarded');
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: true,
      });
      const guardedInPlace = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(guardedInPlace, 1);
      assertOut(guardedInPlace, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertNotOut(guardedInPlace, 'UI-DESIGN: 门未启用');

      // 恢复：补齐工件 + 真实声明 → 出口放行（恢复路径未被键控改动波及）
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: true,
      });
      const recovered = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(recovered, 0);
      assertOut(recovered, 'ALL CHECKS PASSED');
    },
  },

  // 289: ui-design 工件门按协议绑定键控（负例面：等级降回 advisory）——`enforcement` 是该门的单一
  // 表达处：等级非 guarded ⇒ 门不适用，且该绑定的出口自动补写回到未登记路径的原语义（声明照旧
  // 由出口代记）。四类：负例（advisory → 不再拦）/ 正例（写回 guarded → 仍拦）/ 越界（同一节点
  // 的另一绑定不受影响）/ 恢复（等级回到 guarded 即恢复拦截）。
  {
    name: '289 ui-design 门按协议等级键控：调回 advisory 不再拦且自动补写原语义 / 写回 guarded 即恢复',
    run: (dir) => {
      // 负例：等级调回 advisory → 缺工件 + 零真实声明也放行（自动补写保持原语义）
      writeUiDesignBindingVariant(dir, 'advisory');
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: false,
      });
      const advisory = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(advisory, 0);
      assertOut(advisory, 'ALL CHECKS PASSED');
      assertOut(advisory, 'UI-DESIGN: 门未启用（协议 design 绑定等级 = advisory，非 guarded）');
      assertNotOut(advisory, 'BLOCKED');
      assertNotOut(advisory, 'UI-DESIGN: skipped');

      // 越界：同一节点的另一 guarded 绑定零真实声明仍放行（自动补语义未被本次键控改道）
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: false, declareDesign: false,
      });
      const otherBindings = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(otherBindings, 0);
      assertOut(otherBindings, 'ALL CHECKS PASSED');

      // 正例：等级写回 guarded → 缺件与缺声明双拦截同时回来
      writeUiDesignBindingVariant(dir, 'guarded');
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: false, declareUiDesign: true,
      });
      const guardedInPlace = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(guardedInPlace, 1);
      assertOut(guardedInPlace, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertNotOut(guardedInPlace, 'UI-DESIGN: 门未启用');

      // 恢复：补齐工件 + 真实声明 → 放行
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: true,
      });
      const recovered = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(recovered, 0);
      assertOut(recovered, 'ALL CHECKS PASSED');
    },
  },

  // 290: 前端判据的负向标记是结构约束（不是裸子串）——三种结构形态（独立行 / 行首 / 字段值位）
  // 任一命中即判非前端并**回显命中片段**；自然句子与子维度字段里的标记词一律不关掉整道门。
  // 四类：负例（行首的「不适用于暗色主题」与结构形态的 `- 暗色主题：不适用` → 仍判前端，前端
  // 缺件照样 BLOCKED）/ 正例（独立行带括注、行首带理由、字段值位三种形态可见跳过并回显片段）/
  // 越界（段外独立行不参与判据，判据限段内）/ 恢复（改段即放行）。
  {
    name: '290 负向标记结构约束：独立行·行首·字段值位跳过并回显片段 / 自然句子·子维度字段·段外标记不关闸',
    run: (dir) => {
      // 负例：自然句子（标记词在行首且后接「于」，句内再出现一次）→ 判据仍是前端 ⇒ 缺件 BLOCKED
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_NATURAL_SENTENCE, uiDesign: false, declareUiDesign: true,
      });
      const naturalSentence = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(naturalSentence, 1);
      assertOut(naturalSentence, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertNotOut(naturalSentence, 'UI-DESIGN: skipped');
      assertNotOut(naturalSentence, '命中片段');

      // 负例（结构形态的越界面）：子维度字段 `- 暗色主题：不适用` 是结构形态但主体不是本 change
      // 的适用性 ⇒ 仍判前端（标签表把可误伤的字段形态挡在外面）
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_SUBDIMENSION_FIELD, uiDesign: false, declareUiDesign: true,
      });
      const subDimensionField = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(subDimensionField, 1);
      assertOut(subDimensionField, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertNotOut(subDimensionField, 'UI-DESIGN: skipped');

      // 越界：标记出现在「视觉调性」段之外的独立行 → 不参与判据（判据限段内）
      writeDesignExitFixture(dir, {
        newChange: true,
        visualTone: VISUAL_TONE_APPLICABLE,
        changeTail: '\n## 范围排除（Out of Scope）\n\n不适用。\n',
        uiDesign: false,
        declareUiDesign: true,
      });
      const outsideSection = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(outsideSection, 1);
      assertOut(outsideSection, 'BLOCKED: design 出口缺 UI-DESIGN.md');
      assertNotOut(outsideSection, 'UI-DESIGN: skipped');

      // 正例 A：独立行（带括注理由）→ 可见跳过 + 回显命中片段
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_NOT_APPLICABLE, uiDesign: false, declareUiDesign: false,
      });
      const standalone = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(standalone, 0);
      assertOut(standalone, 'UI-DESIGN: skipped（非前端）');
      assertOut(standalone, '命中片段: 不适用（非前端项目）。');
      assertNotOut(standalone, 'BLOCKED');

      // 正例 B：字段值位（`- 适用性：不适用（…）`）→ 同样判非前端（结构形态之二，非行首）
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_FIELD_MARKER, uiDesign: false, declareUiDesign: false,
      });
      const fieldValue = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(fieldValue, 0);
      assertOut(fieldValue, 'UI-DESIGN: skipped（非前端）');
      assertOut(fieldValue, '命中片段: - 适用性：不适用（CLI 工具，无用户可见界面）');
      assertNotOut(fieldValue, 'BLOCKED');

      // 正例 C：行首形态（标记 + 破折号理由，非独立行）→ 同样判非前端
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_LINE_HEAD_MARKER, uiDesign: false, declareUiDesign: false,
      });
      const lineHead = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(lineHead, 0);
      assertOut(lineHead, 'UI-DESIGN: skipped（非前端）');
      assertOut(lineHead, '命中片段: 不适用 —— CLI 工具，无用户可见界面。');
      assertNotOut(lineHead, 'BLOCKED');

      // 恢复：把调性段改成结构形态（标注路径）→ 同一 change 放行，命中片段一并回显
      writeDesignExitFixture(dir, {
        newChange: true, visualTone: VISUAL_TONE_NOT_APPLICABLE, uiDesign: false, declareUiDesign: false,
      });
      const recovered = runGuardWithProtocol(dir, ['exit', 'design']);
      assertExit(recovered, 0);
      assertOut(recovered, 'UI-DESIGN: skipped（非前端）');
      assertOut(recovered, '命中片段: 不适用（非前端项目）。');
    },
  },

  // 291: 原子写单一来源——「同目录固定 `.tmp` + rename + 失败清理」惯用法在收敛面（状态 / 侧命令 /
  // handoff 的写盘脚本 + 单源模块）内恰一处实现（落点 = 既有单源模块 state-schema.mjs），三个侧命令
  // 与 handoff 的 state 直写一律消费同一导出、零内联。判别力两条：① 具名导出被真实消费（import +
  // 调用，不是纯文本存在性）；② **合成目录反向构造**——把第二份实现丢进合成引擎目录，检出数必须
  // 从 1 变 2（证明检出不恒真空过）。guard 的受保护写入按边界锚显式排除，不静默跳过。
  {
    name: '291 原子写单一来源：收敛面内一处实现 + 四消费方零内联 + 合成反向构造判别力',
    run: async () => {
      // ① 惯用法唯一实现（收敛面 = 本任务写边界内的写盘脚本 + 单源模块）
      const idiom = atomicWriteIdiomHits(__dirname, ATOMIC_WRITE_CONVERGENCE_FACE);
      assertEqual(idiom.length, 1, '原子写惯用法实现面（收敛面内应恰 1 处）实际 ' + JSON.stringify(idiom));
      assertEqual(idiom[0].file, 'state-schema.mjs', '原子写惯用法落点文件');
      assertEqual(idiom[0].count, 1, 'state-schema.mjs 内惯用法处数');

      // ①b 边界锚（可见，不静默排除）：guard 的受保护写入是独立安全硬化通道——唯一临时名 + 快照
      // 复核；形态一旦退回「固定 `<目标>.tmp`」惯用法即变红，强制重新评估它是否落回收敛面。
      const guardText = fs.readFileSync(path.join(__dirname, 'workflow-guard.mjs'), 'utf8');
      assertTrue(guardText.includes('String(process.pid)') && /Math\.random\(\)\.toString\(16\)/.test(guardText),
        'workflow-guard 的受保护写入不再是「唯一临时名」硬化通道——须重新评估原子写收敛面');
      assertTrue(hasNamedImport(guardText, './state-schema.mjs', 'RUNTIME_STATE_PATH'),
        'workflow-guard 未从 state-schema.mjs import 运行时路径常量（单源关系被破坏，收敛面须重评）');

      // ② 具名导出唯一定义 + 行为可用（落盘、无临时残留、失败路径 fail-closed）
      const writeAtomic = requireModuleExport(stateSchemaModule, 'writeFileAtomic', 'state-schema.mjs');
      const definition = engineDefinitionHits('writeFileAtomic');
      assertEqual(definition.length, 1, 'writeFileAtomic 定义面（全引擎应恰 1 处）实际 ' + JSON.stringify(definition));
      assertEqual(definition[0].file, 'state-schema.mjs', 'writeFileAtomic 定义文件');
      const probe = makeTmp();
      try {
        const target = path.join(probe, 'nested', 'out.json');
        await writeAtomic(target, '{"ok":true}\n');
        assertEqual(fs.readFileSync(target, 'utf8'), '{"ok":true}\n', '原子写落盘内容');
        assertTrue(!fs.existsSync(target + '.tmp'), '原子写成功路径不得残留临时文件');
        const blocked = path.join(probe, 'blocked.txt');
        fs.mkdirSync(blocked + '.tmp');
        let thrown = null;
        try { await writeAtomic(blocked, '半写'); } catch (e) { thrown = e; }
        assertTrue(thrown !== null, '临时路径被占用时原子写必须抛错（fail-closed）');
        assertTrue(!fs.existsSync(blocked), '失败路径不得留下半写目标文件');
      } finally {
        cleanupTmpDir(probe);
      }

      // ③ 四个消费方：具名 import 自 state-schema.mjs + 真实调用 + 零内联第二份实现
      const consumers = {
        'workflow-state.mjs': 'writeJsonAtomic',
        'workflow-handoff.mjs': 'writeJsonAtomic',
        'evolve.mjs': 'writeFileAtomic',
        'context-scan.mjs': 'writeJsonAtomic',
      };
      for (const [file, symbol] of Object.entries(consumers)) {
        const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assertTrue(hasNamedImport(text, './state-schema.mjs', symbol),
          file + ' 未从 state-schema.mjs import ' + symbol + '（单源纪律：写盘不得在本脚本内联第二份）');
        assertTrue(text.includes(symbol + '('), file + ' 未真实消费 ' + symbol + '（单一权威应被调用）');
        const inline = (text.match(ATOMIC_TEMP_SUFFIX_RE) ?? []).length;
        assertEqual(inline, 0, file + ' 仍内联原子写惯用法（第二份实现）处数');
      }

      // ④ 反向构造：合成引擎目录（单文件 1 处 → 检出 1；再放第二份实现 → 检出 2）——
      // 证明③的判据确实会因第二份实现变红，而非恒真空过。
      const synthetic = makeTmp();
      try {
        writeFile(synthetic, 'single.mjs',
          "export async function duplicateWriter(file, text) {\n"
          + "  const temporary = file + '.tmp';\n"
          + '  await fs.writeFile(temporary, text);\n'
          + '  await fs.rename(temporary, file);\n'
          + '}\n');
        assertEqual(atomicWriteIdiomHits(synthetic).length, 1, '合成目录单实现检出数');
        writeFile(synthetic, 'second.mjs',
          "async function anotherWriter(file, text) {\n"
          + "  const temporary = file + '.tmp';\n"
          + '  await fs.writeFile(temporary, text);\n'
          + '  await fs.rename(temporary, file);\n'
          + '}\n');
        assertEqual(atomicWriteIdiomHits(synthetic).length, 2, '合成目录第二份实现检出数（判据须变红）');
      } finally {
        cleanupTmpDir(synthetic);
      }
    },
  },

  // 292: evolve 元数据字段面单一来源——`## evolve 元数据` 的段名与三字段名在 state-schema.mjs
  // 唯一导出，写方（evolve）与校验方（context-init）同源消费、零内联字面量；容差收窄到单形：
  // 无生产者的旧别名「下次同步建议」不再被静默接受，而是**可见**的格式提示（点名旧别名 + 应改
  // 写的字段名）。写→校一致性用真实链路：evolve apply 生成的段必须零格式问题通过校验。
  {
    name: '292 evolve 元数据单一来源：常量集唯一导出·写校同源·旧别名收窄为可见提示',
    run: async (dir) => {
      // ① 常量集唯一导出 + 取值单形（去掉无生产者的旧别名是**取值**层面的收窄）
      for (const name of ['EVOLVE_METADATA_SECTION', 'EVOLVE_METADATA_FIELDS']) {
        const hits = engineDefinitionHits(name);
        assertEqual(hits.length, 1, name + ' 定义面（全引擎应恰 1 处）实际 ' + JSON.stringify(hits));
        assertEqual(hits[0].file, 'state-schema.mjs', name + ' 定义文件');
      }
      const section = requireModuleExport(stateSchemaModule, 'EVOLVE_METADATA_SECTION', 'state-schema.mjs');
      const fields = requireModuleExport(stateSchemaModule, 'EVOLVE_METADATA_FIELDS', 'state-schema.mjs');
      assertEqual(section, 'evolve 元数据', '段名常量取值');
      assertEqual(fields.join(','), ['last_evolve_at', 'scanner', '下次建议'].join(','), '三字段常量取值');

      // ② 写方与校验方同源消费 + 零内联字面量（第二份表达即变红）
      for (const file of ['evolve.mjs', 'context-init.mjs']) {
        const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assertTrue(hasNamedImport(text, './state-schema.mjs', 'EVOLVE_METADATA_SECTION'),
          file + ' 未从 state-schema.mjs import 段名常量');
        assertTrue(text.includes('EVOLVE_METADATA_FIELDS'), file + ' 未消费字段常量集');
        assertTrue(!/'evolve 元数据'/.test(text), file + ' 仍内联段名字面量（第二份表达）');
        assertTrue(!/'下次建议'/.test(text), file + ' 仍内联第三字段字面量（第二份表达）');
      }

      // ③ 写→校一致性（真实链路）：evolve apply 产出的段必须被校验方无问题接收
      writeFile(dir, '.specs/archive/2026-10-02-fixture/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 夹具抽象条目（元数据单一来源）\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));
      const apply = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-fixture#1', '--root', dir], dir);
      assertExit(apply, 0);
      assertOut(apply, 'EVOLVE-OK');
      const written = fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      for (const field of fields) {
        assertTrue(written.includes('**' + field + '**'), '写方产出的段缺字段 ' + field);
      }
      const validate = requireModuleExport(contextInitModule, 'validateContext', 'context-init.mjs');
      const consistent = await validate(dir);
      assertEqual(consistent.missingSections.length, 0,
        '夹具七段骨架缺段: ' + JSON.stringify(consistent.missingSections));
      assertEqual(consistent.formatIssues.length, 0,
        '写方产物未通过校验方（同源失配）: ' + JSON.stringify(consistent.formatIssues));

      // ④ 容差收窄判别力：旧别名顶替第三字段 → 必报，且提示点名旧别名与应写字段（可见，不静默）
      const aliased = contextFixtureText({ evolveSection: [
        '- **' + fields[0] + '**: `2026-10-02T10:00:00+08:00`',
        '- **' + fields[1] + '**: `flow-comet-evolve`',
        '- **下次同步建议**: 约 60 天后',
      ] });
      writeFile(dir, '.specs/CONTEXT.md', aliased);
      const aliasedIssues = (await validate(dir)).formatIssues;
      assertTrue(aliasedIssues.some((issue) => issue.includes('evolve 元数据三字段')),
        '旧别名未被收窄（仍静默通过）: ' + JSON.stringify(aliasedIssues));
      assertTrue(aliasedIssues.some((issue) => issue.includes('下次同步建议') && issue.includes('不再接受')),
        '旧别名未给出可见格式提示: ' + JSON.stringify(aliasedIssues));
    },
  },

  // 293: 侧命令 CLI 契约——三条横向命令的 `--root` 两种形态 / `--stdout` / `--help` /
  // 未知参数走**同一份**共享助手：等号形三命令一致（修复前 evolve 报「未知参数: --root=.」exit 1）、
  // `--help`/`-h` 三命令一致（修复前只有 health 有）、空格形与未知参数的退出码语义保持不变；
  // 位置参数语义由各命令自持（evolve 的 scan/apply 子命令与候选 id）。结构锚：带引号的 `--root`
  // 解析形态与「未知参数」构造在三条命令里**只允许出现在共享助手一处**，第二份自写脚手架即红。
  {
    name: '293 侧命令 CLI 契约：--root 两形态·--stdout·--help 三命令同形 + 未知参数语义不变 + 解析面单源',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-10-02-cli/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- CLI 契约夹具条目\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      // ① 等号形 `--root=<目录>`：三命令等价（修复前 evolve 是唯一不支持的一条）
      const evolveEq = runSideScript(SIDE_EVOLVE, ['scan', '--root=' + dir], dir);
      assertExit(evolveEq, 0);
      assertOut(evolveEq, 'EVOLVE: 窗口');
      assertOut(evolveEq, '2026-10-02-cli#1');
      const healthEq = runSideScript(SIDE_HEALTH, ['--root=' + dir, '--stdout'], dir);
      assertExit(healthEq, 0);
      assertOut(healthEq, '## 确定性层（机器可判）');
      const scanEq = runSideScript(SIDE_CONTEXT_SCAN, ['--root=' + dir], dir);
      assertExit(scanEq, 0);
      assertOut(scanEq, 'CONTEXT-SCAN-DONE');

      // ② 空格形 `--root <目录>`：向后兼容（三命令语义不变）
      const evolveSpace = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(evolveSpace, 0);
      assertOut(evolveSpace, 'EVOLVE: 窗口');
      const healthSpace = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(healthSpace, 0);
      assertOut(healthSpace, '## 确定性层（机器可判）');
      const scanSpace = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(scanSpace, 0);
      assertOut(scanSpace, 'CONTEXT-SCAN-DONE');

      // ③ `--help` / `-h`：三命令一律打印**自己的**用法后 exit 0（用法里各自列出自身命令形态）
      const helpCases = [
        { args: ['--help'], keywords: ['evolve.mjs scan', 'evolve.mjs apply', '--stdout'] },
        { args: ['-h'], keywords: ['health.mjs', '--root', '--stdout'] },
        { args: ['--help'], keywords: ['context-scan.mjs', '--root', '--stdout'] },
      ];
      const helpScripts = [SIDE_EVOLVE, SIDE_HEALTH, SIDE_CONTEXT_SCAN];
      for (let i = 0; i < helpScripts.length; i += 1) {
        const res = runSideScript(helpScripts[i], helpCases[i].args, dir);
        assertExit(res, 0);
        for (const keyword of helpCases[i].keywords) assertOut(res, keyword);
      }
      // 子命令之后的 `--help` 同样短路（不因缺候选 id 报用法错误）
      const applyHelp = runSideScript(SIDE_EVOLVE, ['apply', '--help'], dir);
      assertExit(applyHelp, 0);
      assertOut(applyHelp, 'evolve.mjs apply');
      // `--stdout` 三命令均被接受（evolve 的 scan 本就全量输出到标准输出）
      assertExit(runSideScript(SIDE_EVOLVE, ['scan', '--stdout', '--root', dir], dir), 0);
      // evolve 的 `--stdout` 语义 = 本次追加进报告的内容原样输出（与落盘块逐字节相同）；
      // 命令自有取值开关的等号形同样走共享助手（`--scanner=<文本>`）
      const applyOut = runSideScript(SIDE_EVOLVE,
        ['apply', '2026-10-02-cli#1', '--root', dir, '--stdout', '--scanner=契约夹具扫描器'], dir);
      assertExit(applyOut, 0);
      assertOut(applyOut, 'EVOLVE-OK');
      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const evolveReport = fs.readFileSync(path.join(dir, '.specs', 'evolve', today + '-EVOLVE.md'), 'utf8');
      assertTrue(applyOut.output.includes(evolveReport),
        '--stdout 输出应与落盘报告块逐字节一致（stdout 与文件各自渲染即漂移）');
      assertTrue(fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8').includes('契约夹具扫描器'),
        '命令自有取值开关（--scanner=<文本>）未生效');

      // ④ 未知参数：三命令一律 exit 1 且点名该词元（既有退出码语义不变）
      for (const script of helpScripts) {
        const unknown = runSideScript(script, ['--bogus'], dir);
        assertExit(unknown, 1);
        assertOut(unknown, '未知参数: --bogus');
      }
      // 位置参数语义按命令自持：evolve 的 scan 拒位置参数、apply 缺候选 id 仍报用法错误
      const scanExtra = runSideScript(SIDE_EVOLVE, ['scan', 'extra'], dir);
      assertExit(scanExtra, 1);
      assertOut(scanExtra, 'scan 不接受位置参数: extra');
      const applyEmpty = runSideScript(SIDE_EVOLVE, ['apply', '--root', dir], dir);
      assertExit(applyEmpty, 1);
      assertOut(applyEmpty, 'apply 需要至少一个候选 id');
      // 取值开关悬空 → 用法错误（三命令同一文案、同一退出码）
      for (const script of helpScripts) {
        const dangling = runSideScript(script, ['--root'], dir);
        assertExit(dangling, 1);
        assertOut(dangling, '--root 需要一个目录参数');
      }

      // ⑤ 结构锚：解析形态只此一处（共享助手）；两个消费方具名 import + 真实调用
      const parseFace = new Map(helpScripts.map((script) => [path.basename(script), fs.readFileSync(script, 'utf8')]));
      const rootTokenFiles = [...parseFace].filter(([, text]) => text.includes("'--root'")).map(([file]) => file);
      assertEqual(rootTokenFiles.join(','), 'evolve.mjs',
        '带引号的 `--root` 解析形态应只出现在共享助手一处（实际: ' + (rootTokenFiles.join(',') || '无') + '）');
      const unknownTokenFiles = [...parseFace].filter(([, text]) => text.includes('未知参数: ')).map(([file]) => file);
      assertEqual(unknownTokenFiles.join(','), 'evolve.mjs',
        '「未知参数」构造应只出现在共享助手一处（实际: ' + (unknownTokenFiles.join(',') || '无') + '）');
      for (const file of ['health.mjs', 'context-scan.mjs']) {
        const text = parseFace.get(file);
        assertTrue(hasNamedImport(text, './evolve.mjs', 'parseSideCommandArgs'),
          file + ' 未从共享助手模块具名 import parseSideCommandArgs（第二份脚手架或未接线）');
        assertTrue(text.includes('parseSideCommandArgs('), file + ' 未真实调用共享助手');
      }
    },
  },

  // 294: 损坏 state 的 fail-closed 与「首次运行」口径收窄 + 协议路径单源——
  // ① state 文件在场但不可解析（含顶层非对象）→ `evolve scan` BLOCKED 且零写入，不再谎称
  //    「无基线（首次运行，全量扫描）」把增量窗口静默退化为全量；② 「首次运行」只限
  //    「state 可读且字段缺席」，state 不在场另有措辞（不冒充首次运行）；③ 协议路径走
  //    state-schema 的唯一选择器：state.protocolPath 绑定**独占**（项目内约定副本坏掉也必须成功、
  //    绑定本身坏掉也不回退候选布局），本模块零候选布局表。
  {
    name: '294 损坏 state fail-closed：scan/apply BLOCKED 零写入·首次运行口径收窄 + 协议路径走单源选择器',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-10-02-state/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 状态口径夹具条目\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      const stateFile = path.join(dir, '.flow-comet', 'flow-comet-state.json');
      writeState(dir, baseState('open'));

      // ① state 不在场：显式点名「state 不在场」，不冒充「首次运行」（全量扫描仍可用）
      fs.rmSync(stateFile);
      const noState = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(noState, 0);
      assertOut(noState, 'state 不在场');
      assertNotOut(noState, '无基线（首次运行，全量扫描）');

      // ② state 可读且字段缺席 = 唯一的「首次运行」口径（全量扫描）
      writeState(dir, baseState('open'));
      const firstRun = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(firstRun, 0);
      assertOut(firstRun, '无基线（首次运行，全量扫描）');
      assertOut(firstRun, '窗口内 1 个');

      // ③ 损坏 state（JSON 截断）：fail-closed —— BLOCKED + 零写入，不再退化成全量扫描
      const stateText = fs.readFileSync(stateFile, 'utf8');
      const truncated = stateText.slice(0, Math.max(1, Math.floor(stateText.length / 2)));
      fs.writeFileSync(stateFile, truncated, 'utf8');
      const damagedBytes = readStateBytes(dir);
      const before = treeFingerprint(dir);
      const blocked = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertOut(blocked, '无法解析');
      assertNotOut(blocked, '首次运行');
      assertNotOut(blocked, '候选清单');
      assertEqual(readStateBytes(dir), damagedBytes, '损坏 state 的 scan 轮改写了 state');
      assertEqual(fingerprintChanges(before, treeFingerprint(dir)).join(' | '), '',
        '损坏 state 的 scan 轮有写入');

      // ④ 顶层非对象（数组）同样判「不可信」——不得冒充「字段缺席」
      fs.writeFileSync(stateFile, '[]\n', 'utf8');
      const arrayState = runSideScript(SIDE_EVOLVE, ['scan', '--root', dir], dir);
      assertExit(arrayState, 1);
      assertOut(arrayState, 'BLOCKED');
      assertOut(arrayState, '无法解析');

      // ⑤ 损坏态下 apply 同样 fail-closed：目标文档 / 报告 / state 三处零改动
      fs.writeFileSync(stateFile, truncated, 'utf8');
      const contextBefore = fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      const applyBlocked = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-state#1', '--root', dir], dir);
      assertExit(applyBlocked, 1);
      assertOut(applyBlocked, 'BLOCKED');
      assertEqual(fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8'), contextBefore,
        '损坏 state 的 apply 轮改写了目标文档');
      assertTrue(!fs.existsSync(path.join(dir, '.specs', 'evolve')), '损坏 state 的 apply 轮落了报告');

      // ⑥ 协议路径单源：state.protocolPath 绑定独占——项目内约定副本坏掉，绑定好 → 必须成功
      //   （修复前的候选布局表先命中 <根>/reference/workflow-protocol.json → 子进程按坏协议 BLOCK）
      writeFile(dir, '.specs/archive/2026-10-02-proto/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 协议绑定夹具条目\n');
      fs.writeFileSync(path.join(dir, 'reference', 'workflow-protocol.json'),
        '{"schemaVersion": 99, "nodes": []}\n', 'utf8');
      fs.copyFileSync(SKILL_PROTOCOL_FILE, path.join(dir, 'bound-protocol.json'));
      writeState(dir, { ...baseState('open'), protocolPath: 'bound-protocol.json' });
      const bound = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-proto#1', '--root', dir], dir,
        { FLOW_COMET_PROTOCOL: '' });
      assertExit(bound, 0);
      assertOut(bound, 'EVOLVE-OK');
      assertTrue(fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8').includes('协议绑定夹具条目'),
        '状态绑定协议下的 apply 未落盘条目');

      // ⑦ 绑定本身坏掉 → fail-closed 可见（不回退项目内约定副本），指引指向绑定修正
      fs.copyFileSync(SKILL_PROTOCOL_FILE, path.join(dir, 'reference', 'workflow-protocol.json'));
      fs.writeFileSync(path.join(dir, 'broken-protocol.json'), '{"schemaVersion": 99, "nodes": []}\n', 'utf8');
      writeState(dir, { ...baseState('open'), protocolPath: 'broken-protocol.json' });
      const brokenBytes = readStateBytes(dir);
      const broken = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-proto#1', '--root', dir], dir,
        { FLOW_COMET_PROTOCOL: '' });
      assertExit(broken, 1);
      assertOut(broken, 'state 写入通道失败');
      assertOut(broken, 'state.protocolPath');
      assertEqual(readStateBytes(dir), brokenBytes, '绑定损坏的 apply 轮改写了 state');

      // ⑧ 写入前先验 state 通道（协议闸门）：通道排在文档之后，不预验就有半成品——候选**未应用过**
      //   （目标文档必然会被改写），绑定指向 schema 非法的根内副本 ⇒ 必须零文档改动、零报告、零 state。
      const halfRoot = path.join(dir, 'half-write');
      writeFile(halfRoot, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(halfRoot, '.specs/archive/2026-10-02-half/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 半成品夹具条目\n');
      fs.writeFileSync(path.join(halfRoot, 'broken-protocol.json'), '{"schemaVersion": 99, "nodes": []}\n', 'utf8');
      writeState(halfRoot, { ...baseState('open'), protocolPath: 'broken-protocol.json' });
      const halfContextBefore = fs.readFileSync(path.join(halfRoot, '.specs', 'CONTEXT.md'));
      const halfStateBefore = readStateBytes(halfRoot);
      const half = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-half#1', '--root', halfRoot], halfRoot,
        { FLOW_COMET_PROTOCOL: '' });
      assertExit(half, 1);
      assertOut(half, 'state 写入通道失败');
      assertOut(half, 'state.protocolPath');
      assertTrue(fs.readFileSync(path.join(halfRoot, '.specs', 'CONTEXT.md')).equals(halfContextBefore),
        'state 通道不可用的 apply 轮改写了目标文档（写入前未验通道 ⇒ 半成品）');
      assertStateBytesUnchanged(halfRoot, halfStateBefore, 'state 通道不可用的 apply 轮');
      assertTrue(!fs.existsSync(path.join(halfRoot, '.specs', 'evolve')),
        'state 通道不可用的 apply 轮落了报告');

      // ⑨ 第二条确定性闸门（state 字段非法）同样必须在文档写入之前拦下——通道预验不能只验协议。
      //   协议经 state.protocolPath 绑到根内合法副本（这一格只考字段闸门，不考协议闸门）。
      const fieldRoot = path.join(dir, 'half-write-field');
      writeFile(fieldRoot, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(fieldRoot, '.specs/archive/2026-10-02-field/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 字段闸门夹具条目\n');
      fs.mkdirSync(path.join(fieldRoot, 'reference'), { recursive: true });
      fs.copyFileSync(SKILL_PROTOCOL_FILE, path.join(fieldRoot, 'reference', 'workflow-protocol.json'));
      writeState(fieldRoot, {
        ...baseState('open'), executionMode: 'not-a-mode', protocolPath: 'reference/workflow-protocol.json',
      });
      const fieldContextBefore = fs.readFileSync(path.join(fieldRoot, '.specs', 'CONTEXT.md'));
      const fieldStateBefore = readStateBytes(fieldRoot);
      const fieldGate = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-field#1', '--root', fieldRoot], fieldRoot,
        { FLOW_COMET_PROTOCOL: '' });
      assertExit(fieldGate, 1);
      assertOut(fieldGate, 'state 写入通道失败');
      assertOut(fieldGate, 'executionMode');
      assertTrue(fs.readFileSync(path.join(fieldRoot, '.specs', 'CONTEXT.md')).equals(fieldContextBefore),
        'state 字段非法的一轮改写了目标文档（写入前未验字段闸门 ⇒ 半成品）');
      assertStateBytesUnchanged(fieldRoot, fieldStateBefore, 'state 字段非法的 apply 轮');

      // ⑩ 结构锚：本模块不再自持候选布局表；协议路径只经 state-schema 的唯一导出选择；
      //    state 三态读入口两条侧命令共用一个实现（第二份内联即红）
      const evolveText = fs.readFileSync(SIDE_EVOLVE, 'utf8');
      assertTrue(hasNamedImport(evolveText, './state-schema.mjs', 'resolveProtocolPathWithState'),
        'evolve.mjs 未从 state-schema.mjs 具名 import 协议路径选择器');
      assertTrue(evolveText.includes('resolveProtocolPathWithState('), 'evolve.mjs 未真实调用协议路径选择器');
      assertTrue(!evolveText.includes("'reference', 'workflow-protocol.json'"),
        'evolve.mjs 仍自持项目内约定副本候选（第二套「协议在哪」表达）');
      assertTrue(!evolveText.includes("'.flow-comet', 'skills'"),
        'evolve.mjs 仍自持权威源布局候选（第二套「协议在哪」表达）');
      const scanText = fs.readFileSync(SIDE_CONTEXT_SCAN, 'utf8');
      assertTrue(hasNamedImport(scanText, './evolve.mjs', 'readStateInfo'),
        'context-scan.mjs 未共用 state 三态读入口（第二份读盘实现）');
      assertTrue(scanText.includes('readStateInfo('), 'context-scan.mjs 未真实调用共用的 state 读入口');
      assertTrue(!/function\s+readStateFile\b/.test(scanText),
        'context-scan.mjs 仍保留本地 state 读实现（三态判定第二份表达）');
    },
  },

  // 295: health 基线日期判据单源——报告名的「日期前缀 + 日历自洽」判定收敛到 time-utils
  //（真实消费 `archiveDateFromName`），本模块不再自写前缀正则：日历不自洽的
  // `2026-02-30-HEALTH.md` 不再被采作基线（旧实现单独在场时直接采作基线、并输出看似有据的
  // ↑/↓ 趋势；与合法旧报告并存时又因「取排序最后一份」必然取到它）。判据面配**合成目录
  // 反向构造**：第二份前缀正则丢进合成引擎目录必须被检出（证明形态判据不恒真空过）。
  {
    name: '295 health 基线日期判据单源：日历不自洽前缀不入选·合法旧报告入选 + 零自写前缀正则',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      // ① 负例：前缀形态合法、日历不自洽（2026-02-30 不存在）——不得被采作基线。快照哨兵
      //    `lessons.entries=123456` 一旦出现在输出里，即证明这份报告被当成了基线。
      writeFile(dir, '.specs/health/2026-02-30-HEALTH.md', healthReportFixture('2026-02-30', 123456));
      const invalidOnly = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(invalidOnly, 0);
      assertOut(invalidOnly, '基线：无（`.specs/health` 下无日期不同的历史报告）');
      assertNotOut(invalidOnly, '2026-02-30-HEALTH.md');
      assertNotOut(invalidOnly, '123456');

      // ② 正例 + 越界：合法旧报告与日历不自洽者并存 → 取合法那份（日历不自洽的名字排序在后，
      //    旧实现「取最后一份」必然取到它 → 哨兵串成 123456 而非 999999）
      writeFile(dir, '.specs/health/2026-01-05-HEALTH.md', healthReportFixture('2026-01-05', 999999));
      const picked = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(picked, 0);
      assertOut(picked, '基线：`.specs/health/2026-01-05-HEALTH.md`');
      assertOut(picked, '`lessons.entries`：999999 → ');
      assertNotOut(picked, '2026-02-30-HEALTH.md');
      assertNotOut(picked, '123456');

      // ③ 结构锚：health 真实消费 time-utils 的日期判定；收敛面内只许 time-utils 表达该形态
      const healthText = fs.readFileSync(SIDE_HEALTH, 'utf8');
      assertTrue(hasNamedImport(healthText, './time-utils.mjs', 'archiveDateFromName'),
        'health.mjs 未从 time-utils.mjs 具名 import archiveDateFromName（日期判据第二份表达）');
      assertTrue(healthText.includes('archiveDateFromName('),
        'health.mjs 未真实消费 archiveDateFromName（单一权威应被调用）');
      const faceHits = datePrefixRegexpHits(__dirname, DATE_PREFIX_CONVERGENCE_FACE);
      assertEqual(faceHits.length, 1, '日期前缀形态实现面（收敛面内应恰 1 处）实际 ' + JSON.stringify(faceHits));
      assertEqual(faceHits[0].file, 'time-utils.mjs', '日期前缀形态落点文件');

      // ③b 边界锚（可见，不静默排除）：guard 的两处日期匹配是文档**内容**里的日期条目匹配
      //（行锚 + `matchAll(.../gm)`），不是文件名前缀判定，且不在本任务写边界内——形态一旦
      // 改变即变红，强制重评收敛面。
      const guardText = fs.readFileSync(path.join(__dirname, 'workflow-guard.mjs'), 'utf8');
      assertEqual((guardText.match(/matchAll\(\/\^[^\n]*\\d\{4\}-\\d\{2\}-\\d\{2\}[^\n]*\/gm\)/g) ?? []).length, 2,
        'workflow-guard 的日期匹配不再是「行锚 + 内容条目」两处形态——须重评日期前缀判据的收敛面');

      // ④ 反向构造：合成引擎目录（单份前缀正则 → 检出 1；再放第二份 → 检出 2）
      const synthetic = makeTmp();
      try {
        writeFile(synthetic, 'single.mjs', "const REPORT_DATE_PREFIX = /^(\\d{4}-\\d{2}-\\d{2})/;\n");
        assertEqual(datePrefixRegexpHits(synthetic).length, 1, '合成目录单实现检出数');
        writeFile(synthetic, 'second.mjs',
          "function reportDateOf(name) {\n  return /^(\\d{4}-\\d{2}-\\d{2})/.exec(name);\n}\n");
        assertEqual(datePrefixRegexpHits(synthetic).length, 2, '合成目录第二份实现检出数（判据须变红）');
      } finally {
        cleanupTmpDir(synthetic);
      }
    },
  },

  // 296: context-scan 改写 CONTEXT.md 前落备份——命名族（目标文档同目录 + `.bak-<本地日期>`）与
  // 失败处置由 state-schema.mjs 的共享助手单源提供（消费关系与零内联见场景 301）：备份内容 =
  // 改写前版本；同日重复改写只保留一份当日备份（同名覆盖，不堆积）；复制不成功时目标与 state
  // 逐字节不变（备份**先于**写入，不是事后补）。
  {
    name: '296 context-scan 改写前落备份：同形命名·内容为改写前版本·复制失败 fail-closed 零写入',
    run: (dir) => {
      const contextFile = path.join(dir, '.specs', 'CONTEXT.md');
      const original = contextFixtureText();
      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      writeFile(dir, '.specs/CONTEXT.md', original);
      writeState(dir, baseState('open'));

      // ① 改写落备份：同目录、命名族 `.bak-<日期>`、内容 = 改写前版本；双落点写入照常
      const first = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(first, 0);
      const backups = fs.readdirSync(path.join(dir, '.specs'))
        .filter((name) => /^CONTEXT\.md\.bak-\d{4}-\d{2}-\d{2}$/.test(name));
      assertEqual(backups.length, 1, '改写前的备份份数（应恰 1 份同目录 `.bak-<日期>`）实际 ' + JSON.stringify(backups));
      assertEqual(backups[0], 'CONTEXT.md.bak-' + today, '备份命名（应为改写当日的本地日期）');
      assertEqual(fs.readFileSync(path.join(dir, '.specs', backups[0]), 'utf8'), original, '备份内容应为改写前版本');
      assertTrue(fs.readFileSync(contextFile, 'utf8') !== original, 'CONTEXT.md 未被改写（夹具前提不成立）');

      // ② 同日再改写：同名覆盖——只保留一份当日备份，内容为该轮改写前版本（不堆积、链路不丢）
      const intermediate = contextFixtureText().replace('2026-09-01T10:00:00+08:00', '2026-09-02T10:00:00+08:00');
      writeFile(dir, '.specs/CONTEXT.md', intermediate);
      const second = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(second, 0);
      assertEqual(fs.readdirSync(path.join(dir, '.specs'))
        .filter((name) => name.startsWith('CONTEXT.md.bak-')).length, 1, '同日重复改写的当日备份份数');
      assertEqual(fs.readFileSync(path.join(dir, '.specs', backups[0]), 'utf8'), intermediate,
        '第二轮的备份内容应为该轮改写前版本');

      // ③ 复制不成功 → fail-closed：目标文档与 state 逐字节不变（备份先于写入，写入面不留半态）
      writeFile(dir, '.specs/CONTEXT.md', original);
      const stateBytes = readStateBytes(dir);
      fs.rmSync(path.join(dir, '.specs', backups[0]), { force: true });
      fs.mkdirSync(path.join(dir, '.specs', backups[0]));
      const blocked = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertEqual(fs.readFileSync(contextFile, 'utf8'), original, '备份失败的一轮改写了 CONTEXT.md');
      assertStateBytesUnchanged(dir, stateBytes, '备份失败的一轮');

      // ④ 命名族与失败处置的**同源**判据已随备份助手抽取移到场景 301（唯一定义 + 两消费方零内联
      //    + 合成反向构造）：此处不重复表达同一判据，只保留上面的真实行为锚。
    },
  },

  // 297: health 的审计行与报告落盘路径**恒输出**——报告是唯一写入面，调用方至少要能从标准输出
  // 确认「跑没跑、落在哪、基线是谁」：不带 `--stdout` 时此前 stdout 为空（审计行 0 命中），
  // 报告路径无处可见；`--stdout` 时报告正文在前、审计行追加在后（正文仍是落盘字节，审计行不进
  // 报告）。审计行内容当日确定（日期 / 在场判定 / 基线），不引入新的易变行。另锚：审计行用的
  // CLI 路径标签是三条侧命令的**共享助手**（evolve.mjs 唯一定义），不给同一显示决定留下第二份。
  {
    name: '297 health 审计行恒输出：HEALTH: 行与报告落盘路径（不带 --stdout 亦然）+ 正文不回流 + --help 不产报告',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));
      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const reportFile = path.join(dir, '.specs', 'health', today + '-HEALTH.md');
      const reportLine = 'HEALTH: 报告 `.specs/health/' + today + '-HEALTH.md`';

      // ① 不带 `--stdout`：审计行与报告路径仍必须输出，且**不**把报告正文回流
      const quiet = runSideScript(SIDE_HEALTH, ['--root', dir], dir);
      assertExit(quiet, 0);
      assertOut(quiet, reportLine);
      assertOut(quiet, 'HEALTH-DONE');
      assertNotOut(quiet, '## 确定性层（机器可判）');
      // 审计行点名的路径必须是真实落盘的工件（文案与产物同源）
      assertTrue(fs.existsSync(reportFile), '审计行点名的报告未落盘: ' + reportFile);

      // ② 带 `--stdout`：报告正文在前（与落盘逐字节一致）、审计行在后
      const loud = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(loud, 0);
      assertOut(loud, reportLine);
      assertOut(loud, 'HEALTH-DONE');
      const reportText = fs.readFileSync(reportFile, 'utf8');
      assertTrue(loud.output.startsWith(reportText), '--stdout 的报告正文应与落盘逐字节一致（审计行追加在后）');
      assertTrue(loud.output.indexOf('HEALTH-DONE') > loud.output.indexOf(reportText),
        '审计行应在报告正文之后（顺序反了会让消费方把摘要当正文）');

      // ③ 审计行回显本次采用的基线：合法旧报告在场时点名它（同日重跑不与自己对比）
      writeFile(dir, '.specs/health/2026-01-05-HEALTH.md', healthReportFixture('2026-01-05', 999999));
      const withBaseline = runSideScript(SIDE_HEALTH, ['--root', dir], dir);
      assertExit(withBaseline, 0);
      assertOut(withBaseline, 'HEALTH: 日期 ' + today);
      assertOut(withBaseline, '基线 `.specs/health/2026-01-05-HEALTH.md`');

      // ④ `--help` 短路：打用法、不产报告、不输出审计行（用法面语义不变）
      const help = runSideScript(SIDE_HEALTH, ['--help'], dir);
      assertExit(help, 0);
      assertOut(help, 'health.mjs');
      assertNotOut(help, 'HEALTH: 报告');

      // ⑤ 结构锚：CLI 路径标签**单一来源**（三条命令的摘要行同形）——定义只在共享助手模块
      //    evolve.mjs（侧命令共享助手的既有落点），另两条具名 import 后真实调用；第二份同名
      //    助手（或改回各处内联）即红。
      const labelDefinition = engineDefinitionHits('relativeLabel');
      assertEqual(labelDefinition.length, 1, 'relativeLabel 定义面（全引擎应恰 1 处）实际 ' + JSON.stringify(labelDefinition));
      assertEqual(labelDefinition[0].file, 'evolve.mjs', 'relativeLabel 定义文件');
      for (const file of ['health.mjs', 'context-scan.mjs']) {
        const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assertTrue(hasNamedImport(text, './evolve.mjs', 'relativeLabel'),
          file + ' 未从共享助手模块 import 路径标签（第二份同名助手或未接线）');
        assertTrue(text.includes('relativeLabel('), file + ' 未真实调用共享路径标签');
      }
    },
  },

  // 298: 禁裸拼接静态锚（DESIGN R4 的落地）——时间形态 / 格式化的唯一权威是 time-utils.mjs：
  // 三条侧命令零容忍（人可见报告 / CLI 摘要行 / 备份名）；其余引擎脚本走**显式白名单 + 逐条理由**
  // （既有 13 处都是已持久化的机器字段，迁移留专门窗口；新增写入路径一律走 time-utils，不得把
  // 白名单当增量口——撤回留痕 withdrawnAt 即按此落 nowTimestamp）。判别力两条：① 白名单判定是纯函数，
  // 合成输入可驱动「条数漂移（增 / 减）」与「未登记文件」三态必报；② 合成引擎目录注入第二处
  // 裸拼接 → 检出必增（证明真实面判据不恒真空过）。
  {
    name: '298 禁裸拼接静态锚：三侧命令零容忍 + 引擎 13 处显式白名单（逐条理由）+ 合成反向构造',
    run: () => {
      // ① 三条侧命令零容忍（人可见面的时间形态只许走 time-utils）
      const sideHits = bareIsoTimestampHits(__dirname, BARE_ISO_SIDE_COMMANDS);
      assertEqual(sideHits.length, 0,
        '侧命令出现裸时间拼接（人可见面须走 time-utils 的 nowTimestamp / formatLocalTimestamp）: ' + JSON.stringify(sideHits));

      // ② 其余引擎脚本 = 精确白名单：条数逐文件相等 + 每条例外带非空理由
      const engineHits = bareIsoTimestampHits(__dirname).filter((hit) => !BARE_ISO_SIDE_COMMANDS.includes(hit.file));
      assertEqual(engineHits.reduce((sum, hit) => sum + hit.count, 0), 13, '引擎既有裸拼接落点总数（白名单代数）');
      const problems = bareIsoWhitelistProblems(engineHits, BARE_ISO_ENGINE_WHITELIST);
      assertEqual(problems.length, 0, '白名单漂移: ' + problems.join(' | '));
      for (const entry of BARE_ISO_ENGINE_WHITELIST) {
        assertTrue(typeof entry.reason === 'string' && entry.reason.length >= 20,
          entry.file + ' 的白名单条目缺理由（豁免必须是显式且有据的，不是静默名单）');
      }

      // ③ 白名单判定的判别力（纯函数 · 合成输入）：等价集合不报；三类漂移各自必报
      //    （合成等价集合的条数取真实白名单首条的当前值——它必须与常量同值，否则第 1 条断言即红）
      const equivalent = [{ file: 'a.mjs', count: 7 }, { file: 'b.mjs', count: 4 }, { file: 'c.mjs', count: 1 }, { file: 'd.mjs', count: 1 }];
      const whitelist = BARE_ISO_ENGINE_WHITELIST.map((entry, index) => ({ ...entry, file: equivalent[index].file }));
      assertEqual(bareIsoWhitelistProblems(equivalent, whitelist).length, 0, '等价集合不应报白名单漂移');
      const newcomer = bareIsoWhitelistProblems([...equivalent, { file: 'newcomer.mjs', count: 1 }], whitelist);
      assertTrue(newcomer.some((problem) => problem.includes('newcomer.mjs') && problem.includes('未登记白名单')),
        '未登记文件的裸拼接未被判定: ' + JSON.stringify(newcomer));
      const grown = bareIsoWhitelistProblems(
        equivalent.map((hit, index) => (index === 0 ? { ...hit, count: hit.count + 1 } : hit)), whitelist);
      assertTrue(grown.some((problem) => problem.includes('白名单 7 处 / 实际 8 处')),
        '白名单条数增长未被判定: ' + JSON.stringify(grown));
      const shrunk = bareIsoWhitelistProblems(equivalent.slice(1), whitelist);
      assertTrue(shrunk.some((problem) => problem.includes('白名单 7 处 / 实际 0 处')),
        '已迁移落点未同步收窄白名单未被判定: ' + JSON.stringify(shrunk));

      // ④ 合成引擎目录反向构造：单处 → 检出 1；再注入一处 → 检出 2（判据不恒真空过）。
      //    样例经拼接构造，避免套件自身源码携带该字面量而污染真实面计数（本套件同样在扫描面内）。
      const bareIsoSample = 'new Date().' + 'toISOString()';
      const synthetic = makeTmp();
      try {
        writeFile(synthetic, 'one.mjs', 'export const a = () => ' + bareIsoSample + ';\n');
        assertEqual(bareIsoTimestampHits(synthetic).length, 1, '合成目录单处检出数');
        writeFile(synthetic, 'two.mjs', 'export const b = () => ' + bareIsoSample + ';\n');
        assertEqual(bareIsoTimestampHits(synthetic).length, 2, '合成目录第二处检出数（判据须变红）');
        // 注释里的引用不算实现（判据只看代码）
        writeFile(synthetic, 'three.mjs', '// 反例引用: ' + bareIsoSample + '\nexport const c = 1;\n');
        assertEqual(bareIsoTimestampHits(synthetic).length, 2, '行注释中的引用不应计入实现面');
      } finally {
        cleanupTmpDir(synthetic);
      }
    },
  },

  // 299: 可选工具超时预算（60s 内）+ 超时不静默——常量与调用点同源，且「工具在场但运行未完成」
  // 必须把降级原因（含本次超时预算）写进报告、快照读数按 `present` 而非 `ok` 落盘，退出码仍 0
  // （可选工具不可用不是失败）。判别力：常量越预算即红；夹具工具（在场但跑不起来）触发同一
  // 失败分支，报告里必须看到降级原因——不静默、不冒充成功读数。
  {
    name: '299 工具超时收口：常量 ≤ 60s 且与调用点同源 + 在场但运行失败必记降级原因（含预算）',
    run: (dir) => {
      const healthText = fs.readFileSync(SIDE_HEALTH, 'utf8');
      const match = /const TOOL_TIMEOUT_MS = (\d+);/.exec(healthText);
      assertTrue(match !== null, 'health.mjs 缺工具超时常量 TOOL_TIMEOUT_MS');
      const budget = Number(match[1]);
      assertTrue(budget > 0 && budget <= 60000, '工具超时常量超出 60s 预算: ' + budget + ' ms');
      assertTrue(/timeout: TOOL_TIMEOUT_MS/.test(healthText), '工具调用未消费超时常量（常量会变成装饰）');
      assertTrue(healthText.includes('超时预算'), '降级原因未回显本次超时预算（超时须可自证，不静默）');

      // 真实链路：夹具工具「在场」（探面命中 <根>/node_modules/.bin/）但跑不起来 → 同一失败分支
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n\n### L-002 次条\n');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
      const toolPath = path.join(dir, 'node_modules', '.bin', 'jscpd');
      fs.writeFileSync(toolPath, '#!/usr/bin/env node\nprocess.exit(3);\n', 'utf8');
      fs.chmodSync(toolPath, 0o755);
      const res = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(res, 0);
      assertOut(res, '未采集——工具在场但运行未完成（超时预算 ' + budget + ' ms；');
      assertOut(res, 'redundancy.jscpd=present');
      assertNotOut(res, 'redundancy.jscpd=ok');
      assertOut(res, '- **jscpd**：在场——字面重复块读数见「冗余扫描」段');
    },
  },

  // 300: 读数快照的键形态**单一来源**——往返判据：把生产者自己产出的快照段整段当作历史基线
  // 喂回去，每个产出的键都必须被读回（零「基线无此读数」、条数与产出条数相等）；反例：给写方
  // 真实产出的键写异常值 → 必出趋势行；近形状键（大小写不符）不得被读走。此前写方发 6 个含
  // 大写字母的键、读方的键形态正则只认全小写：6/18 个键恒判「（基线无此读数）」，逐键趋势
  // 静默失效且不报错（假绿形态）。
  {
    name: '300 快照键形态单一来源：产出快照往返零「基线无此读数」+ 真实键异常值必出趋势行 + 近形状键不误读',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n\n### L-002 次条\n');
      writeState(dir, baseState('open'));

      // ① 生产面自证：先跑一次拿到真实报告，取其快照段原文（不解析、不重排）
      const firstRun = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(firstRun, 0);
      const firstReport = fs.readFileSync(path.join(dir, '.specs', 'health',
        requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date()) + '-HEALTH.md'), 'utf8');
      const section = snapshotSectionOf(firstReport);
      assertTrue(section !== null, '报告缺「## 读数快照」段（往返夹具前提不成立）');
      const producedEntries = snapshotEntryCount(section);
      assertTrue(producedEntries >= 10, '快照条数异常（往返判据的样本太小）: ' + producedEntries);

      // ② 往返：产出快照整段当作 2026-01-05 的历史基线 → 每个键都必须被读回
      writeFile(dir, '.specs/health/2026-01-05-HEALTH.md', healthReportWithSnapshot('2026-01-05', section));
      const roundTrip = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(roundTrip, 0);
      assertOut(roundTrip, '基线：`.specs/health/2026-01-05-HEALTH.md`');
      assertNotOut(roundTrip, '（基线无此读数）');
      const unchanged = (roundTrip.output.match(/（无变化）/g) ?? []).length;
      assertEqual(unchanged, producedEntries, '往返后逐键「无变化」条数应等于产出条数（有键没被读回）');

      // ③ 真实产出的键（含此前恒被判「基线无此读数」的驼峰键）写异常值 → 必出趋势行
      const anomalous = section
        .replace(/(^|\n)context\.lineCount=[^\n]*/, '$1context.lineCount=999999')
        .replace(/(^|\n)git\.head=[^\n]*/, '$1git.head=ffffffff');
      writeFile(dir, '.specs/health/2026-01-06-HEALTH.md', healthReportWithSnapshot('2026-01-06', anomalous));
      const trend = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(trend, 0);
      assertOut(trend, '基线：`.specs/health/2026-01-06-HEALTH.md`');
      assertOut(trend, '`context.lineCount`：999999 → ');
      assertOut(trend, '`git.head`：ffffffff → ');
      assertNotOut(trend, '999999（基线无此读数）');
      assertNotOut(trend, 'ffffffff（基线无此读数）');

      // ④ 近形状键（大小写不符）不是本版本的读数面：不得被读走（报「基线无此读数」而非伪造趋势）
      const nearMiss = section.replace(/(^|\n)context\.lineCount=[^\n]*/, '$1context.linecount=888888');
      writeFile(dir, '.specs/health/2026-01-07-HEALTH.md', healthReportWithSnapshot('2026-01-07', nearMiss));
      const miss = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(miss, 0);
      assertOut(miss, '基线：`.specs/health/2026-01-07-HEALTH.md`');
      assertNotOut(miss, '888888');
      assertOut(miss, '`context.lineCount`：');
      assertOut(miss, '（基线无此读数）');
    },
  },

  // 301: 备份改写前版本**单一来源**——命名族（目标文档同目录 + `.bak-<本地日期>`）与失败处置
  // 收敛为 state-schema.mjs 的单一导出（与原子写同址），evolve 与 context-scan 只消费导出：
  // 命名族或失败处置再演进时不会只改到一侧。判别力：① 定义面唯一 + 两消费方零内联（第二份
  // 实现 → 收敛面内检出 2 处）；② evolve 真实链路（备份 = 改写前版本、命名族命中当日日期、
  // 复制失败整轮 fail-closed：目标文档 / state / 报告三处零改动，与 context-scan 同处置）；
  // ③ 合成目录反向构造证明①的判据不恒真空过。
  {
    name: '301 备份助手单一来源：state-schema 唯一导出·两消费方零内联 + evolve 真实链路 fail-closed',
    run: async (dir) => {
      // ① 收敛面内恰一处实现（命名族字面量 + 复制调用同现者）——修复前 evolve 与 context-scan
      //    各一份（同形但两份），此断言即「第二份实现必红」的落点
      const impl = inlineBackupHits(__dirname, BACKUP_IMPL_FACE);
      assertEqual(impl.length, 1, '备份实现面（收敛面内应恰 1 处）实际 ' + JSON.stringify(impl));
      assertEqual(impl[0].file, 'state-schema.mjs', '备份实现落点文件');

      // ② 定义面唯一 + 两消费方具名 import 与真实调用
      const definition = engineDefinitionHits('backupBeforeWrite');
      assertEqual(definition.length, 1, 'backupBeforeWrite 定义面（全引擎应恰 1 处）实际 ' + JSON.stringify(definition));
      assertEqual(definition[0].file, 'state-schema.mjs', 'backupBeforeWrite 定义文件');
      const backupHelper = requireModuleExport(stateSchemaModule, 'backupBeforeWrite', 'state-schema.mjs');
      for (const file of ['evolve.mjs', 'context-scan.mjs']) {
        const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assertTrue(hasNamedImport(text, './state-schema.mjs', 'backupBeforeWrite'),
          file + ' 未从 state-schema.mjs 具名 import 备份助手（第二份实现或未接线）');
        assertTrue(text.includes('backupBeforeWrite('), file + ' 未真实调用共享备份助手');
      }

      // ③ 单一导出的行为（命名族由共享实现派生：`.bak-<本地日期>`，内容 = 改写前版本）
      const today = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const stamp = requireModuleExport(timeUtilsModule, 'nowTimestamp', 'time-utils.mjs')();
      const probe = makeTmp();
      try {
        const target = path.join(probe, 'doc.md');
        writeFile(probe, 'doc.md', '改写前内容\n');
        await backupHelper(target, stamp);
        const produced = target + '.bak-' + today;
        assertTrue(fs.existsSync(produced), '备份未按「同目录 + 当日本地日期」落点: ' + produced);
        assertEqual(fs.readFileSync(produced, 'utf8'), '改写前内容\n', '备份内容应为改写前版本');
      } finally {
        cleanupTmpDir(probe);
      }

      // ④ evolve 真实链路：apply 落备份（内容 = 改写前版本）
      writeFile(dir, '.specs/archive/2026-10-02-backup/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 备份单一来源夹具条目\n');
      const original = contextFixtureText();
      const contextFile = path.join(dir, '.specs', 'CONTEXT.md');
      const backupFile = contextFile + '.bak-' + today;
      writeFile(dir, '.specs/CONTEXT.md', original);
      writeState(dir, baseState('open'));
      const apply = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-backup#1', '--root', dir], dir);
      assertExit(apply, 0);
      assertTrue(fs.existsSync(backupFile), 'evolve apply 未落改写前备份: ' + backupFile);
      assertEqual(fs.readFileSync(backupFile, 'utf8'), original, '备份内容应为改写前版本');
      assertTrue(fs.readFileSync(contextFile, 'utf8') !== original, 'CONTEXT.md 未被改写（夹具前提不成立）');

      // ⑤ 复制不成功 → fail-closed：目标文档 / state / 报告三处零改动（与 context-scan 同处置）
      writeFile(dir, '.specs/CONTEXT.md', original);
      const stateBytes = readStateBytes(dir);
      const reportFile = path.join(dir, '.specs', 'evolve', today + '-EVOLVE.md');
      const reportBefore = fs.readFileSync(reportFile);
      fs.rmSync(backupFile, { force: true });
      fs.mkdirSync(backupFile);
      const blocked = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-backup#1', '--root', dir], dir);
      assertExit(blocked, 1);
      assertOut(blocked, 'BLOCKED');
      assertEqual(fs.readFileSync(contextFile, 'utf8'), original, '备份失败的 apply 轮改写了 CONTEXT.md');
      assertStateBytesUnchanged(dir, stateBytes, '备份失败的 apply 轮');
      assertTrue(fs.readFileSync(reportFile).equals(reportBefore), '备份失败的 apply 轮改写了报告');

      // ⑥ 合成目录反向构造：单实现 → 1；再放第二份 → 2
      const synthetic = makeTmp();
      try {
        writeFile(synthetic, 'single.mjs',
          "export async function duplicateBackup(file, ts) {\n"
          + "  const backup = file + '.bak-' + ts;\n"
          + '  await fs.copyFile(file, backup);\n'
          + '}\n');
        assertEqual(inlineBackupHits(synthetic).length, 1, '合成目录单实现检出数');
        writeFile(synthetic, 'second.mjs',
          "async function anotherBackup(file, ts) {\n"
          + "  const backup = file + '.bak-' + ts;\n"
          + '  await fs.copyFile(file, backup);\n'
          + '}\n');
        assertEqual(inlineBackupHits(synthetic).length, 2, '合成目录第二份实现检出数（判据须变红）');
      } finally {
        cleanupTmpDir(synthetic);
      }
    },
  },

  // 302: AC-11 的四条时间硬规则文本锚（存在级，但**指真实实体**）：① 分发面技能文本（入口 SKILL
  // 的侧命令「共同边界」）陈述规则 ①②③；② 验证阶梯（docs/internal/WORKING-METHOD.md 一·五 的
  // 「环境 / 过程纪律·时间」条）承载规则 ①~③ 并落实 ④（纪律已写入阶梯本身）；③ 文本点名的实体
  // 在树内真实存在——`time-utils.mjs` 在场且真实定义被点名的判据符号（防锚指向幽灵：散文提到的
  // 东西必须在树里找得到）。维护者面结构性缺席（CI 全新检出 / worktree）时验证阶梯半边输出可见
  // SKIP 行（未验证 ≠ 通过），分发面半边恒检。
  {
    name: '302 时间纪律四条硬规则文本锚：入口技能陈述 ①②③ + 验证阶梯承载四条 + 点名实体真实在场',
    run: () => {
      const skillsRoot = skillsRootForScriptsDir(__dirname);
      const entrySkill = path.join(skillsRoot, 'flow-comet', 'SKILL.md');
      const skillText = fs.readFileSync(entrySkill, 'utf8');
      const skillProblems = timeDisciplineTextProblems('入口 SKILL', skillText);
      assertEqual(skillProblems.length, 0, '时间纪律文本锚: ' + skillProblems.join(' | '));

      // 反向构造（真实文本逐条移除 · 合成输入驱动同一判据）：任一条规则的关键词被移走 → 该条必报。
      for (const [rule, tokens] of TIME_DISCIPLINE_RULES) {
        const stripped = tokens.reduce((text, token) => text.replace(token, '（反向构造：移除）'), skillText);
        assertTrue(stripped !== skillText, '反向构造前提不成立（入口 SKILL 缺该条关键词）: ' + rule);
        assertTrue(timeDisciplineTextProblems('入口 SKILL', stripped).some((problem) => problem.includes(rule)),
          '逐条移除未被判违规（判别力缺失）: ' + rule);
      }

      if (maintainerFacePresent()) {
        const ladder = fs.readFileSync(path.join(REPO_ROOT, 'docs/internal/WORKING-METHOD.md'), 'utf8');
        const ladderProblems = timeDisciplineTextProblems('验证阶梯', ladder);
        assertEqual(ladderProblems.length, 0, '验证阶梯文本锚: ' + ladderProblems.join(' | '));
        assertTrue(ladder.includes('环境 / 过程纪律'), '验证阶梯缺「环境 / 过程纪律」条（规则④的落点）');
        assertTrue(ladder.includes('L-096'), '验证阶梯的时间纪律条未点名 L-096 实证（规则③的依据）');
      } else {
        console.log('SKIP: 302 的验证阶梯面（docs/internal/WORKING-METHOD.md 一·五「环境 / 过程纪律」条）'
          + '——维护者面结构性缺席；本次检出未校验规则 ①~④ 已写入验证阶梯，请在维护者主树重跑本套件');
      }

      // 点名实体真实在场：time-utils.mjs（规则①②的单一权威）在场，且真实定义被点名的判据符号。
      const timeUtilsFile = path.join(__dirname, 'time-utils.mjs');
      assertTrue(fs.existsSync(timeUtilsFile), '入口 SKILL 的时间纪律点名 time-utils.mjs，但树内无此文件（锚指向幽灵实体）');
      for (const symbol of ['formatLocalTimestamp', 'parseTimestamp']) {
        assertTrue(engineDefinitionHits(symbol).some((hit) => hit.file === 'time-utils.mjs'),
          'time-utils.mjs 未定义被点名的判据符号 ' + symbol + '（散文与实现脱节）');
      }
    },
  },

  // 303: 收尾打磨之首——`evolve` 在 **CRLF 文档**上追加「## evolve 元数据」段前不得留裸 LF 行。
  // 复现形态（评审实测 `-->\r\n\n\r\n---`）：`split('\n')` 对「以换行收尾的文档」留有一个零长度
  // 哨兵元素，旧实现直接在哨兵之后 push，于是拼出一条**无 `\r` 的空行**（同一文件两种行尾）。
  // 断言面：整篇每条行都以 CRLF 终结（逐行行号可读）+ 追加块前后形态逐字 + LF 文档对照
  // （证明修复不是「CRLF 专属补丁」——两种行尾约定下追加块都退化为**单空行**）。
  {
    name: '303 侧命令 CRLF 追加块：evolve 追加元数据段零裸 LF 行 · 两种行尾约定形态一致',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-10-02-crlf/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- CRLF 夹具条目\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      // ① CRLF 文档：夹具本身必须整篇 CRLF（否则「裸 LF」判据的前提不成立）
      const crlfFixture = contextFixtureText({ tail: '<!-- crlf-tail -->' }).replace(/\n/g, '\r\n');
      assertEqual(crlfLineViolations(crlfFixture).length, 0, '夹具前提不成立：CRLF 夹具本身含非 CRLF 行');
      writeFile(dir, '.specs/CONTEXT.md', crlfFixture);

      const applied = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-crlf#1', '--root', dir], dir);
      assertExit(applied, 0);
      assertOut(applied, 'EVOLVE-OK');
      const crlfText = fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      const violations = crlfLineViolations(crlfText);
      assertEqual(violations.join(','), '',
        'CRLF 文档追加后出现非 CRLF 行（行号）: ' + violations.join(','));
      assertTrue(crlfText.includes('<!-- crlf-tail -->\r\n\r\n---\r\n\r\n## evolve 元数据\r\n\r\n'),
        '追加块前后形态不符（期望单空行 + 全 CRLF）: '
          + JSON.stringify(crlfText.slice(crlfText.indexOf('<!-- crlf-tail -->'))));
      // 判别力（合成变异驱动同一判据）：把评审实测的修复前形态灌回真实文本 → 必报
      const regressed = crlfText.replace('\r\n\r\n---\r\n', '\r\n\n\r\n---\r\n');
      assertTrue(regressed !== crlfText, '反向构造前提不成立（追加块形态已变）');
      assertTrue(crlfLineViolations(regressed).length > 0, '裸 LF 行未被判违规（判别力缺失）');

      // ② LF 文档对照：行尾约定不变（单空行 + 全 LF），且不得被写入 CR
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText({ tail: '<!-- lf-tail -->' }));
      writeState(dir, baseState('open'));
      const appliedLf = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-crlf#1', '--root', dir], dir);
      assertExit(appliedLf, 0);
      const lfText = fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      assertTrue(lfText.includes('<!-- lf-tail -->\n\n---\n\n## evolve 元数据\n\n'),
        'LF 文档追加块形态回归: ' + JSON.stringify(lfText.slice(lfText.indexOf('<!-- lf-tail -->'))));
      assertTrue(!lfText.includes('\r'), 'LF 文档被写入 CR（行尾约定不得被改写）');
    },
  },

  // 304: 收尾打磨之二——EVOLVE 报告的「## 应用 patch」条目此前是 `  - ` 前缀与条目自带的 `- `
  // 叠加（`  - - <条目>`）：Markdown 渲染成「空壳父项 + 子项」两条，报告读者数不清应用了几条。
  // 断言面：报告零 `- -` 双符号行 + 条目行逐字（单符号）+ 父项在场（子项挂在正确的父项下）。
  {
    name: '304 EVOLVE 报告条目单一列表符号：零 `- -` 双符号行 · 条目行逐字',
    run: (dir) => {
      writeFile(dir, '.specs/archive/2026-10-02-report/DESIGN.md',
        '# DESIGN\n\n## 9. 架构沉淀\n\n### 可复用抽象\n\n- 报告条目夹具\n');
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));
      const applied = runSideScript(SIDE_EVOLVE, ['apply', '2026-10-02-report#1', '--root', dir], dir);
      assertExit(applied, 0);
      assertOut(applied, 'EVOLVE-OK');

      const date = requireModuleExport(timeUtilsModule, 'formatLocalDate', 'time-utils.mjs')(new Date());
      const reportFile = path.join(dir, '.specs', 'evolve', date + '-EVOLVE.md');
      assertTrue(fs.existsSync(reportFile), 'EVOLVE 报告未落盘: ' + reportFile);
      const reportText = fs.readFileSync(reportFile, 'utf8');
      const bulletProblems = evolveReportBulletProblems(reportText);
      assertEqual(bulletProblems.length, 0, 'EVOLVE 报告列表符号: ' + bulletProblems.join(' | '));
      assertTrue(reportText.includes('- [2026-10-02-report#1] → `.specs/CONTEXT.md`「既有抽象索引」'),
        '报告缺应用项的父条目行: ' + JSON.stringify(reportText.slice(reportText.indexOf('## 应用 patch'))));
      assertTrue(reportText.includes('  - 报告条目夹具 · 来源 @.specs/archive/2026-10-02-report/DESIGN.md'),
        '报告条目行不是单一列表符号: ' + JSON.stringify(reportText.slice(reportText.indexOf('## 应用 patch'))));
      // 判别力（合成变异驱动同一判据）：把双符号灌回真实报告 → 必报
      const regressed = reportText.replace('  - 报告条目夹具', '  - - 报告条目夹具');
      assertTrue(regressed !== reportText, '反向构造前提不成立（报告缺条目行）');
      assertTrue(evolveReportBulletProblems(regressed).length > 0, '双列表符号未被判违规（判别力缺失）');
    },
  },

  // 305: 收尾打磨之三——`health` 的「技术债表项数」复现命令此前硬编码 H3（`/^### 技术债/`），
  // 而同一项的判据把段标题层级放宽到二~四级：`## 技术债` 的项目照抄命令复现不出报告读数
  // （读数说 0，其实段在场有表项）——命令与判据各说一套。
  // 同一条判据的残留边界（同批收口）：段边界此前按「任意 H1~H4 标题」截断，段内**子标题**之后的
  // 表格整段丢失（`## 技术债` + `### 明细` 与 `### 技术债` + `#### 明细` 都读成 0 表项）——层级
  // 必须与段标题自身比较。断言面 = 标题层级 × 有无子标题的**六格矩阵**（H4 + 更深子标题是控制格：
  // 更深子标题本就不该截断），复现命令的段终点同步改为「同级或更高级标题，或分隔线」而与判据同源。
  {
    name: '305 health 技术债段级与段边界按判据动态取：H2/H3/H4 × 子标题六格矩阵 · 段缺席退回区间',
    run: (dir) => {
      const withDebt = (heading, sub) => contextFixtureText()
        + '\n' + heading + '（夹具技术债）\n\n' + (sub === '' ? '' : sub + '\n\n')
        + '| 项 | 说明 |\n|---|---|\n| 债 A | 说明 A |\n| 债 B | 说明 B |\n';
      // 复现命令的段级与段终点都取自判据本身（段级 = 文档里真实命中的标题层级；终点 = 同级或更
      // 高级标题，或分隔线）——命令与读数才是同一件事的两种说法。
      const reproLine = (bound) => "- 复现命令：`awk 'f&&(/^#{1," + bound
        + "}[[:space:]]/||/^-{3,}[[:space:]]*$/){exit} /^#{2,4}[[:space:]]*技术债/{f=1} f' .specs/CONTEXT.md"
        + " | grep -c '^|'`（含表头与分隔行，减去 2 即表项数）";

      for (const [label, heading, sub, bound] of [
        ['H2', '## 技术债', '', '2'],
        ['H2-sub', '## 技术债', '### 明细', '2'],
        ['H3', '### 技术债', '', '3'],
        ['H3-sub', '### 技术债', '#### 明细', '3'],
        ['H4', '#### 技术债', '', '4'],
        ['H4-sub', '#### 技术债', '##### 明细', '4'],
      ]) {
        const root = path.join(dir, label.toLowerCase());
        writeFile(root, '.specs/CONTEXT.md', withDebt(heading, sub));
        writeFile(root, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n');
        const res = runSideScript(SIDE_HEALTH, ['--root', root, '--stdout'], dir);
        assertExit(res, 0);
        assertOut(res, '- 表项数：2');
        assertOut(res, reproLine(bound));
        if (bound !== '3') assertNotOut(res, reproLine('3'));
      }
      // 命令形态已换（段终点须能表达「同级或更高级」）——旧的 `/^---/` 单终点形态不得再出现
      const h2 = runSideScript(SIDE_HEALTH, ['--root', path.join(dir, 'h2'), '--stdout'], dir);
      assertNotOut(h2, "- 复现命令：`sed -n ");

      // 段缺席：没有可取的层级 → 退回判据的层级区间（二~四级）形态；读数仍为 0（复现命令成立）
      const absentRoot = path.join(dir, 'absent');
      writeFile(absentRoot, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(absentRoot, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n');
      const absent = runSideScript(SIDE_HEALTH, ['--root', absentRoot, '--stdout'], dir);
      assertExit(absent, 0);
      assertOut(absent, '- 表项数：0');
      assertOut(absent, reproLine('4'));
    },
  },

  // 306: 验收条款子句的机检锚——「确定性层**每项**都带可复现命令」。此前该子句只由「state 字节
  // 零改写」间接代表（评审记为锚偏弱）：报告里说「逐项带计数与判据」，但「每项都有复现命令」
  // 无人核。断言面：确定性层逐项都有 `- 复现命令：` 行（非仓库态与真实 git 仓库态两态）+ 逐项
  // 抽掉该项的复现命令 → 每抽一次必报（判据不是只看第一项）。
  {
    name: '306 health 确定性层每项带复现命令：逐项机检 + 逐项抽掉必报 + git 两态覆盖',
    run: (dir) => {
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(dir, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n');
      const plain = runSideScript(SIDE_HEALTH, ['--root', dir, '--stdout'], dir);
      assertExit(plain, 0);
      assertOut(plain, '### 5 · 版本历史统计（git）');
      const plainProblems = deterministicReproProblems(plain.output);
      assertEqual(plainProblems.length, 0, '确定性层缺复现命令: ' + plainProblems.join(' | '));

      // 逐项判别力（合成变异驱动同一判据）：确定性子集逐项各抽掉一次复现命令 → 每次都必报
      const rows = plain.output.split('\n');
      const starts = rows.map((line, i) => (line.startsWith('### ') ? i : -1)).filter((i) => i >= 0);
      assertTrue(starts.length >= 5, '确定性层分项数不足（判据无从覆盖）: ' + starts.length);
      for (const start of starts) {
        const nextStart = rows.findIndex((line, i) => i > start && line.startsWith('### '));
        const stop = nextStart < 0 ? rows.length : nextStart;
        const at = rows.findIndex((line, i) => i > start && i < stop && line.startsWith('- 复现命令：'));
        assertTrue(at >= 0, '确定性项缺复现命令: ' + rows[start]);
        const mutated = [...rows.slice(0, at), ...rows.slice(at + 1)].join('\n');
        assertTrue(deterministicReproProblems(mutated).length > 0,
          '抽掉该项复现命令未被判违规（判别力缺失）: ' + rows[start]);
      }

      // git 在场态：另起一个真实仓库根（`git init`）→ 第 5 项走「是」分支，同样带复现命令
      const repoRoot = path.join(dir, 'repo-root');
      writeFile(repoRoot, '.specs/CONTEXT.md', contextFixtureText());
      writeFile(repoRoot, '.specs/LESSONS.md', '# LESSONS\n\n### L-001 首条\n');
      execFileSync('git', ['init', '-q'], { cwd: repoRoot, stdio: 'ignore' });
      const inRepo = runSideScript(SIDE_HEALTH, ['--root', repoRoot, '--stdout'], dir);
      assertExit(inRepo, 0);
      assertOut(inRepo, '- git 仓库：是');
      const repoProblems = deterministicReproProblems(inRepo.output);
      assertEqual(repoProblems.length, 0, 'git 在场态确定性层缺复现命令: ' + repoProblems.join(' | '));
    },
  },

  // 307: 覆盖声明四要素机检锚（评审登记的移交项）——三处「上游 vendored 只读」覆盖声明此前是
  // **纯文本、无机检**。四要素：① 上游文件标记为只读基准（且点名的上游文件真实在场）；
  // ② 「不采用」栏 ≥1 条；③ 「沿用上游」栏 ≥1 条（入口为**指针式** → 该栏豁免，细则在各自技能册）；
  // ④ 「以…为准」兜底语。负向控制：把任一要素从**真实文本**里抽掉 → 必红。
  {
    name: '307 上游覆盖声明四要素：三处声明齐备 + 点名上游实体在场 + 逐要素抽掉必红',
    run: () => {
      const skillsRoot = skillsRootForScriptsDir(__dirname);
      const declarations = [
        { label: 'flow-comet-health/SKILL.md', file: path.join(skillsRoot, 'flow-comet-health', 'SKILL.md'), pointer: false },
        { label: 'flow-comet-evolve/SKILL.md', file: path.join(skillsRoot, 'flow-comet-evolve', 'SKILL.md'), pointer: false },
        { label: 'flow-comet/SKILL.md', file: path.join(skillsRoot, 'flow-comet', 'SKILL.md'), pointer: true },
      ];
      for (const declaration of declarations) {
        const text = fs.readFileSync(declaration.file, 'utf8');
        const problems = overrideDeclarationProblems(declaration.label, text, { pointer: declaration.pointer });
        assertEqual(problems.length, 0, '覆盖声明四要素: ' + problems.join(' | '));

        // 逐要素抽掉（真实文本驱动同一判据）：该要素必报——判据不恒真空过。
        // 兜底语取**声明块内**的匹配（文件里别处的 `冲突…以文件为准` 一类行文不是该要素，
        // 抽错目标会让判别力断言变成假绿）。
        const probes = [
          { element: '只读基准', strip: (value) => value.replaceAll('只读基准', '（反向构造：抽掉）') },
          { element: '不采用栏', strip: (value) => value.replaceAll('不采用', '（反向构造：抽掉）') },
          {
            element: '兜底语',
            strip: (value) => {
              const blockFallback = OVERRIDE_FALLBACK_RE.exec(overrideDeclarationBlock(value));
              return value.replace(blockFallback[0], '（反向构造：抽掉）');
            },
          },
        ];
        if (!declaration.pointer) {
          probes.push({ element: '沿用上游栏', strip: (value) => value.replaceAll('沿用上游', '（反向构造：抽掉）') });
        }
        for (const probe of probes) {
          const stripped = probe.strip(text);
          assertTrue(stripped !== text, '反向构造前提不成立（文本缺该要素）: ' + declaration.label + ' / ' + probe.element);
          assertTrue(overrideDeclarationProblems(declaration.label, stripped, { pointer: declaration.pointer })
            .some((problem) => problem.includes(probe.element.replace(/栏$/, '')) || problem.includes('兜底语')),
            '抽掉要素未被判违规（判别力缺失）: ' + declaration.label + ' / ' + probe.element);
        }
      }

      // 点名的上游实体真实在场：vendored 上游面结构性缺席时输出可见 SKIP（未验证 ≠ 通过）。
      // 取「声明块内」点名的路径——文件别处的说明性写法（`flow-kit/prompts/<阶段>.md` 占位）
      // 不是本声明的落点。
      const promptsRoot = path.join(REPO_ROOT, 'flow-kit', 'prompts');
      if (fs.existsSync(promptsRoot)) {
        for (const declaration of declarations) {
          const block = overrideDeclarationBlock(fs.readFileSync(declaration.file, 'utf8'));
          const paths = upstreamArtifactPaths(block);
          assertTrue(paths.length > 0, declaration.label + ' 未点名任何上游工件（声明的锚缺落点）');
          for (const rel of paths) {
            assertTrue(fs.existsSync(path.join(REPO_ROOT, rel)),
              declaration.label + ' 点名的上游文件不存在（锚指向幽灵实体）: ' + rel);
          }
        }
      } else {
        console.log('SKIP: 307 的上游实体面（flow-kit/prompts 为 vendored 上游面，可能结构性缺席）'
          + '——本次检出未校验「覆盖声明点名的上游文件真实在场」，请在 vendored 上游在场处重跑本套件');
      }
    },
  },

  // 308: `last_intel_scan` 双落点一致（原症状顺序 · 真实链路）——先 `context-scan` 建双落点，真实时间
  // 流逝后再跑 `init --init-context`：state 侧取值必须以**统一形态**（本地时间 + 显式偏移，经
  // time-utils）写入；段侧不由 init 改写（段行的唯一写通道是 context-scan，其改写与备份实现只有
  // 一份）；两者取值不一致时**必须有可见提示**并点名收敛命令——修复前是「写 `Z` 形态 + 段未更新 +
  // 零提示」的静默漂移。反向控制：两处取值一致时零提示（不误报），且未刷新路径不改写既有取值。
  // 段行夹具 = **真实生成件形态**（取值词元 + 行尾说明，见 INTEL_FIELD_SUFFIX）：读侧若按整行剩余
  // 文本比对，则同刻同形态（②）与收敛后（⑥）都会恒亮、漂移类别退化成「段内取值不是合法时间戳」
  // （④）——三条都是本场景的判据；⑦ 单变量对照（只剥掉说明）证明判别条件是词元口径而非说明本身。
  {
    name: '308 双落点一致：带行尾说明的段行同刻静默 + 漂移类别正确 + 重扫收敛后零提示 + 单变量对照',
    run: (dir) => {
      const parse = requireModuleExport(timeUtilsModule, 'parseTimestamp', 'time-utils.mjs');
      const extract = requireModuleExport(contextInitModule, 'extractContextStructure', 'context-init.mjs');
      const readContext = () => fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      const readLandedState = () => JSON.parse(
        fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8')).last_intel_scan;
      // 段侧取值的读取口径与生产侧同源：结构提取定位字段 → 取**取值词元**（写侧只换词元，说明原样保留）
      const readLandedSection = () => {
        const field = extract(readContext()).metadata['intel-scan 元数据'];
        return field === undefined ? undefined : intelFieldToken(field.last_intel_scan.value);
      };

      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText());
      writeState(dir, baseState('open'));

      // ① 首扫：双落点建立且同刻同形态；段行的行尾说明原样保留（写侧只替换取值词元）
      const scan = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(scan, 0);
      assertOut(scan, 'CONTEXT-SCAN-DONE');
      const scanned = readLandedState();
      assertEqual(readLandedSection(), scanned, '首扫后双落点应同刻同形态');
      assertTrue(readContext().includes(INTEL_FIELD_SUFFIX), '重扫改写了段行的行尾说明（写侧只应替换取值词元）');

      // ② 带行尾说明的同刻同形态 ⇒ **静默**（未刷新路径的 init 不改写既有取值）——整行口径的读侧在此恒亮
      const quietLanded = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(quietLanded, 0);
      assertEqual(readLandedState(), scanned, '未刷新路径应原样保留既有扫描时刻');
      assertNotOut(quietLanded, 'INIT-NOTICE');

      // ③ 真实时间流逝——时间戳是秒级精度，同一秒内的两次写入取值可能相同（漂移不可判）
      sleepSync(1100);

      // ④ 原症状顺序：`init --init-context`（CONTEXT 校验通过路径 → 记录扫描时刻）
      const reinit = runStateWithProtocol(dir, ['init', CHANGE_ID, '--init-context']);
      assertExit(reinit, 0);
      assertOut(reinit, 'INIT-DONE');
      const stateAfter = readLandedState();
      assertTrue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(stateAfter),
        'init 写入的扫描时刻形态非「本地时间 + 显式偏移」: ' + stateAfter);
      assertTrue(parse(stateAfter) > parse(scanned),
        'init 写入的扫描时刻应晚于首扫（不得回退）: ' + stateAfter + ' vs ' + scanned);
      assertEqual(readLandedSection(), scanned, 'init 不应改写 CONTEXT 段（该段行的写通道是 context-scan）');
      // 漂移不得静默：提示在场 + 两侧取值回显 + 点名收敛命令 + **类别正确**（两侧同为「本地时间 +
      // 显式偏移」形态、仅时刻不同 ⇒ 「刻与形态均不一致」；行尾说明不得把类别打成取值非法）
      assertOut(reinit, 'INIT-NOTICE');
      assertOut(reinit, stateAfter);
      assertOut(reinit, scanned);
      assertOut(reinit, '刻与形态均不一致');
      assertNotOut(reinit, '段内取值不是合法时间戳');
      assertOut(reinit, 'context-scan');

      // ⑤ 收敛：重扫一次 → 双落点同刻同形态（行尾说明原样保留）
      const converge = runSideScript(SIDE_CONTEXT_SCAN, ['--root', dir], dir);
      assertExit(converge, 0);
      assertOut(converge, 'CONTEXT-SCAN-DONE');
      const converged = readLandedState();
      assertEqual(readLandedSection(), converged, '重扫后双落点应收敛为同刻同形态');
      assertTrue(readContext().includes(INTEL_FIELD_SUFFIX), '收敛轮改写了段行的行尾说明');

      // ⑥ 收敛后：取值一致时的 init（未授权刷新 → 原样保留既有扫描时刻）零提示——提示承诺的收敛可达
      const quiet = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(quiet, 0);
      assertEqual(readLandedState(), converged, '未刷新路径应原样保留既有扫描时刻');
      assertNotOut(quiet, 'INIT-NOTICE');

      // ⑦ 单变量对照：**只**剥掉段行的行尾说明（取值词元不变、state 不变）→ 仍然静默——判别条件是
      //    「取值词元」口径而非「有没有说明」；裸取值行（无说明）是写侧支持的既有形态，须继续正确
      const bareLine = readContext().replace(INTEL_FIELD_SUFFIX, '');
      assertTrue(bareLine !== readContext(), '单变量对照前提不成立：段行不含夹具行尾说明');
      writeFile(dir, '.specs/CONTEXT.md', bareLine);
      const quietBare = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(quietBare, 0);
      assertNotOut(quietBare, 'INIT-NOTICE');

      // ⑧ 向后兼容：取值词元带 markdown 引号（`` `…` ``；模板/旧夹具形态）时按词元归一后比对 → 静默
      writeFile(dir, '.specs/CONTEXT.md',
        contextFixtureText().replace(INTEL_FIELD_VALUE + INTEL_FIELD_SUFFIX,
          '`' + converged + '`' + INTEL_FIELD_SUFFIX));
      const quietQuoted = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(quietQuoted, 0);
      assertNotOut(quietQuoted, 'INIT-NOTICE');
    },
  },

  // 309: 漂移判据的形态边界与反向控制（判别力 + 零误报）——① **同一时刻的两种形态**（state 为历史
  // `Z` 值、段侧为本地偏移）也判漂移：提示在场且点名形态差异（修复前该形态零提示、state 被原样保留）；
  // ② 段缺席 = 无可比对面 → 零提示（不无中生有）；③ 段内取值不可解析（占位）→ 仍判漂移（不静默）；
  // 提示一律不阻断 init（exit 0）；④ 判据输入端的两条命名声明（段名 / 字段名）跨文件逐字一致——
  // 段行夹具一律**带行尾说明**（真实生成件形态）：整行口径的读侧会让 ① 退化成「取值非法」、③ 的
  // 类别也由说明决定——故 ① 显式断言「同刻不同形态」且不得落到取值非法类别。
  // 两处各写一份字面量是本机制的既有形态（单一来源收口须改到写边界外的脚本，见 SUMMARY 的已知接受），
  // 故此处把「不得静默漂移」机检化：任一侧改名即红，而漂移的后果正是 ② 的静默路径。
  {
    name: '309 漂移判据边界：同刻不同形态必报 + 段缺席零误报 + 段内占位取值不静默 + 命名声明跨文件一致',
    run: (dir) => {
      const readContext = () => fs.readFileSync(path.join(dir, '.specs', 'CONTEXT.md'), 'utf8');
      const readLandedState = () => JSON.parse(
        fs.readFileSync(path.join(dir, '.flow-comet', 'flow-comet-state.json'), 'utf8')).last_intel_scan;

      // ① state = `Z` 形态（历史写入的真实形态）；段 = 同一时刻的「本地时间 + 显式偏移」，**带行尾说明**
      //    （真实生成件形态）——两侧同刻 ⇒ 类别必须是「同刻不同形态」，不得退化成取值非法
      const zForm = '2026-09-24T18:14:23Z';
      const localForm = '2026-09-25T02:14:23+08:00';
      writeState(dir, { ...baseState('open'), last_intel_scan: zForm });
      writeFile(dir, '.specs/CONTEXT.md',
        contextFixtureText().replace(INTEL_FIELD_VALUE, localForm));
      const sameMoment = runStateWithProtocol(dir, ['init', CHANGE_ID]);
      assertExit(sameMoment, 0);
      assertOut(sameMoment, 'INIT-NOTICE');
      assertOut(sameMoment, '同刻不同形态');
      assertNotOut(sameMoment, '段内取值不是合法时间戳');
      assertOut(sameMoment, zForm);
      assertOut(sameMoment, localForm);
      assertEqual(readLandedState(), zForm, '未刷新路径不得改写既有扫描时刻');

      // ② 段缺席（CONTEXT 不含 intel-scan 段）→ 无可比对面 → 零提示
      writeFile(dir, '.specs/CONTEXT.md', contextFixtureText({ intelSection: false }));
      const noSection = runStateWithProtocol(dir, ['init', CHANGE_ID + '-no-section']);
      assertExit(noSection, 0);
      assertNotOut(noSection, 'INIT-NOTICE');

      // ③ 段内取值词元不可解析（占位形态）→ 仍判漂移且点明该类别（静默放过会让「段侧从未被正确
      //    写入」长期不可见）；占位词元之后的说明不参与判定（类别由词元决定）
      writeFile(dir, '.specs/CONTEXT.md',
        contextFixtureText().replace(INTEL_FIELD_VALUE, '（待扫描）'));
      const placeholder = runStateWithProtocol(dir, ['init', CHANGE_ID + '-placeholder']);
      assertExit(placeholder, 0);
      assertOut(placeholder, 'INIT-NOTICE');
      assertOut(placeholder, '段内取值不是合法时间戳');
      assertOut(placeholder, '（待扫描）');

      // ④ 取值词元口径的夹具前提（合成输入 · 纯函数口径）：段行带行尾说明时，结构提取返回的是
      //    「词元 + 说明」整串——按整行比对会落「取值非法」（缺陷形态），按词元比对才落正确类别
      //    （类别本身已在 ① 的真实命令面断言）。此处把夹具形态与词元提取钉住：夹具若退回裸词元，
      //    本锚立即红（防「缺陷形态重新变得不可见」的假绿）。
      const fieldsWithSuffix = requireModuleExport(contextInitModule, 'extractContextStructure', 'context-init.mjs')(
        contextFixtureText()).metadata['intel-scan 元数据'].last_intel_scan.value;
      assertTrue(fieldsWithSuffix.includes(INTEL_FIELD_SUFFIX),
        '夹具段行未带行尾说明（真实生成件形态前提不成立）: ' + JSON.stringify(fieldsWithSuffix));
      assertTrue(intelFieldToken(fieldsWithSuffix) === INTEL_FIELD_VALUE,
        '取值词元口径提取错误: ' + JSON.stringify(intelFieldToken(fieldsWithSuffix)));

      // ⑤ 命名声明跨文件一致（结构锚 + 反向构造）：init 侧按段名 / 字段名定位段内取值，两处声明
      //    漂移会让判据静默退化成 ② 的「无可比对面」——故两处字面量必须逐字相等，合成改写即红。
      const consumerText = fs.readFileSync(path.join(__dirname, 'workflow-state.mjs'), 'utf8');
      const producerText = fs.readFileSync(SIDE_CONTEXT_SCAN, 'utf8');
      const namingProblems = intelMetadataNameProblems(consumerText, producerText);
      assertEqual(namingProblems.length, 0, 'intel-scan 命名声明漂移: ' + namingProblems.join(' | '));
      const tamperedSection = producerText.replace("'intel-scan 元数据'", "'intel-scan 元数据（漂移）'");
      assertTrue(tamperedSection !== producerText, '反向构造前提不成立：重扫命令侧缺段名字面量声明');
      assertTrue(intelMetadataNameProblems(consumerText, tamperedSection)
        .some((problem) => problem.includes('段名字面量两处声明不一致')),
      '段名漂移未被判定（判别力缺失）');
      const tamperedField = producerText.replace("'last_intel_scan'", "'last_intel_scan_v2'");
      assertTrue(tamperedField !== producerText, '反向构造前提不成立：重扫命令侧缺字段名字面量声明');
      assertTrue(intelMetadataNameProblems(consumerText, tamperedField)
        .some((problem) => problem.includes('字段名字面量两处声明不一致')),
      '字段名漂移未被判定（判别力缺失）');
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
    const builtinCopy = scenarioProtocolPath(dir);
    fs.mkdirSync(path.dirname(builtinCopy), { recursive: true });
    fs.copyFileSync(BUILTIN_PROTOCOL_SOURCE, builtinCopy);
    await sc.run(dir);
    passed += 1;
    console.log('PASS: ' + sc.name);
  } catch (e) {
    failures.push({ name: sc.name, error: e.message });
    console.error('FAIL: ' + sc.name + '\n' + e.message);
  } finally {
    // 清理失败不抛（见 cleanupTmpDir 注释）：残留由末尾判据报告，避免整轮崩
    cleanupTmpDir(dir);
  }
}

console.log('RESULT: ' + passed + '/' + SCENARIOS.length + ' scenarios passed');

// 文档一致性自检（场景数纪律 + 公开产物零代号纪律工具化，2026-08-10）：
// ① 场景数：受检清单文档须与 SCENARIOS.length 一致（全变体检查），且清单条目必须真实存在
//    （AC-14：缺失显式报告，不静默跳过）；
// ② 公开产物零代号：公开文档不得含过程代号（场景编号/修复编号/批次/缺陷编号/问题级/验证代号/验证轮次/未公开概念——历史 CHANGELOG 回归实证）。
// 仅权威源检出执行；安装副本（目标项目）无 flow-comet 文档面，跳过。
if (isAuthoritativeSourceRepo()) {
  // ①a 受检面可见化（F2 防漂移）：实际受检文件数由模块级常量**推导**、不硬编码——分发组 =
  // SCENARIO_COUNT_FILES ∪ SYSTEM_TEST_COUNT_FILES（后者为前者子集），维护者组 =
  // SCENARIO_COUNT_FILES_MAINTAINER ∪ SYSTEM_TEST_COUNT_FILES_MAINTAINER（后者为前者子集）；
  // 维护者面缺席（CI 全新检出 / worktree）时按组跳过语义只计分发面。本行是对外可复核的
  // 「覆盖面事实」——清单增删/口径漂移在此直接可见，不再依赖人工核对注释（F2 根因）。
  const distFaceCount = new Set([...SCENARIO_COUNT_FILES, ...SYSTEM_TEST_COUNT_FILES]).size;
  const maintainerFaceCount = maintainerFacePresent()
    ? new Set([...SCENARIO_COUNT_FILES_MAINTAINER, ...SYSTEM_TEST_COUNT_FILES_MAINTAINER]).size
    : 0;
  console.log('受检面: ' + (distFaceCount + maintainerFaceCount) + ' 文件（分发 ' + distFaceCount
    + ' + 维护者 ' + maintainerFaceCount + '）');
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

  // ①c 维护者面缺席可见化：结构性缺席（worktree / CI 全新检出）不判失败（退出码不变、不误红），
  // 但必须可见——逐面输出 SKIP 行（面名 + 原因 + 本检出未执行什么校验 + 回维护者主树重跑的指引）。
  for (const skip of maintainerFaceSkips()) {
    console.log('SKIP: ' + skip.face + ' — ' + skip.reason
      + '；本次检出未执行该面校验，请在维护者主树重跑本套件（主树 L1），勿把跳过当成已校验。');
  }

  // ② 公开文档零代号（公开产物纪律——CHANGELOG 历史 S 编号回归的教训，2026-08-10）
  const PUBLIC_DOCS = [
    'README.md', 'README-zh.md', 'CONTRIBUTING.md', 'CONTRIBUTING-zh.md',
    'SECURITY.md', 'SECURITY-zh.md', 'CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT-zh.md',
    'CHANGELOG.md', 'CHANGELOG-zh.md',
    'docs/INSTALLATION.md', 'docs/INSTALLATION-zh.md', 'docs/MECHANISM.md', 'docs/MECHANISM-zh.md',
    'docs/USAGE.md', 'docs/USAGE-zh.md',
    'docs/TROUBLESHOOTING.md', 'docs/TROUBLESHOOTING-zh.md', 'docs/VERSIONS.md', 'docs/VERSIONS-zh.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/1-bug_report.yml', '.github/ISSUE_TEMPLATE/2-feature_request.yml',
    '.github/ISSUE_TEMPLATE/3-question.md', '.github/ISSUE_TEMPLATE/4-task.md',
  ];
  // 词表判据 = 模块级 PUBLIC_CODE_RE（与 .githooks/internal-codes.mjs 的 BANNED 同判据，
  // 见其定义处的同步约定；维护文档机检场景族另有该判据的判别力/边界锚）。
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
    const m = text.match(PUBLIC_CODE_RE);
    if (m) {
      failures.push({ name: '公开产物零代号(' + rel + ')', error: rel + ' 含过程代号: "' + m[0] + '"' });
      console.error('FAIL: 公开产物零代号(' + rel + ')\n' + rel + ' 含过程代号: "' + m[0] + '"');
    }
  }

  // ③ 词表镜像漂移（L-067 收口）：主仓私有的词表单一来源与套件内的同义镜像必须**逐字符
  // 等价**——两侧此前只有注释互指"同步"、零一致性判据：主仓增补模式时分发侧扫描静默落后
  // （新词可在公开面长期存活而套件全绿），反向则分发面误红。判据只读文件、不改任何判定语义。
  for (const problem of vocabularyMirrorProblems()) {
    failures.push({ name: '词表镜像漂移', error: problem });
    console.error('FAIL: 词表镜像漂移\n' + problem);
  }
} else {
  // 安装副本形态：.githooks 是主仓私有面（随 clone 不分发）→ 该判据**不适用**。结构性缺席
  // 不判失败（退出码不变、不误红），但必须显式可见——未验证 ≠ 通过，不得静默跳过。
  console.log('SKIP/NOT-APPLICABLE: 词表镜像漂移判据（.githooks 为主仓私有面）'
    + '；本次检出无该私有面，未执行「词表单一来源 ↔ 套件同义镜像」的逐字符等价性比对'
    + '——请在主仓私有面在场处重跑本套件（主树 L1），勿把不适用当成已校验。');
}

// 清理验证：自测套件自身创建的临时目录不留残留
// 先做一次延迟重试：跨场景仍被占用的句柄（子进程退出、扫描器）可能晚于最后一个场景的清理才释放。
// 只等**一次**（不是每个残留目录各等一次），再逐个重试；随后由下方单一判定点统一报告。
const remainingDirs = createdDirs.filter((d) => fs.existsSync(d));
if (remainingDirs.length > 0) {
  sleepSync(300);
  for (const d of remainingDirs) cleanupTmpDir(d);
}
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
