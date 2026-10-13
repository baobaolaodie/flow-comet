// 场景组 i — 命令写判定取向 · CONTEXT 段标题归一 · gitignore 访问故障 · 维护文档机检 · Fix 路由纯函数与受控归位
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  assertExit,
  assertNotOut,
  assertOut,
  runGuard,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  PREPARE_ENV,
  SCRIPTS_DIR,
  handoffFor,
  routeNodeModule,
  strictSummary,
  writeIntakeArtifacts,
} from '../lib/test-fixtures.mjs';
import {
  FIX_RETURN_FAMILY_COMPLETED,
  FIX_RETURN_REVIEW_TEXT,
  STALE_FIX_BATCH_SIGNATURE,
  assertStateOnlyChanged,
  fixBatchTaskText,
  fixReturnBaseState,
  fixReturnFamilyEvidence,
  fixTaskBlock,
  readScenarioProtocol,
  readScenarioState,
  requireRouteNodeExport,
  writeFixReturnSummaries,
} from '../lib/test-assertions.mjs';
import {
  PUBLIC_CODE_RE,
  internalDocsProblems,
  isDeclaredReferenceSkip,
  maintainerFaceSkips,
  vocabularyMirrorProblems,
} from '../lib/text-anchor-checks.mjs';

export const ENTRIES = [

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

  // 244a: 维护文档机检（docs-governance）——死引用基线：正例（干净夹具通过）/ 反例（死引用必须
  // 报告且含来源与目标）/ 覆盖面（.specs/adr + allowlist 未来路径）/ 恢复（修复后通过）。
  {
    name: '244a 维护文档机检：死引用正反例 + adr 面 + allowlist + 恢复',
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
    },
  },

  // 244b: 扫描面扩展——三册显式清单（.specs 三册）正/反例；树根相对形态（flow-comet-* 技能目录 /
  // rules）解析正例与同族缺目标反例（窄域规则的判别力证据）。
  {
    name: '244b 维护文档机检：三册扫描面 + 树根相对形态解析',
    run: (dir) => {
      writeFile(dir, 'docs/internal/ROADMAP.md', '# 路线图\n\n## Now\n\n## Next\n\n## Later\n\n## Open decisions\n');
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/ROADMAP.md`。\n');
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
    },
  },

  // 244c: 声明式允许面族（外部命名空间 / 退役命名空间 / 决策册角色）+ 行号存在与不越界 +
  // 表头新鲜度 + ROADMAP「Now 段不得引用已归档 change-id」。
  {
    name: '244c 维护文档机检：声明式允许面 + 行号越界 + 表头新鲜度 + Now 段归档 id',
    run: (dir) => {
      writeFile(dir, 'docs/internal/ROADMAP.md', '# 路线图\n\n## Now\n\n## Next\n\n## Later\n\n## Open decisions\n');
      writeFile(dir, 'docs/internal/FIXTURE.md', '见 `docs/internal/ROADMAP.md`。\n');
      // —— in-place 增锚（声明式族：外部命名空间 / 退役命名空间 / 示例）——旧语义
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
      // （旧实现按 split 段数计行，尾随空段被算作一行 → :4 被放过）
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
      // （旧实现用 includes 子串匹配 → 短 id 会命中更长 id 或同族更长 id 的中间）
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
    },
  },

  // 244d: ROADMAP 最低结构 + 维护者面缺席可见化描述符（在场 → 无描述符；缺段 → 结构问题必报）。
  {
    name: '244d 维护文档机检：ROADMAP 四段结构 + 缺席描述符',
    run: (dir) => {
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
    },
  },

  // 244e: 读取失败可见化（「未执行 ≠ 通过」）——目标扫描侧与 ROADMAP 结构检查侧都必须把不可读
  // 目标报成问题条目（含「无法读取: <rel>: <err 摘要>」），不得静默跳过、也不得抛出崩溃。
  {
    name: '244e 维护文档机检：不可读目标可见化（扫描侧 + ROADMAP 结构侧）',
    run: (dir) => {
      writeFile(dir, 'docs/internal/ROADMAP.md', '# 路线图\n\n## Now\n\n## Next\n\n## Later\n\n## Open decisions\n');
      // —— in-place 增锚（F4：读取失败可见化）——以同名目录替换 .md 文件 → readFileSync
      // 抛 EISDIR（目录读取错误，跨平台同码）；旧实现 catch → continue 静默跳过，该目标既无
      // FAIL 也无 SKIP（「未执行 ≠ 通过」的静默通道）→ 必须报告
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
      const selfLines = fs.readFileSync(path.join(SCRIPTS_DIR, 'guard-self-test.mjs'), 'utf8').split(/\r?\n/);
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

      // 本族反向构造——与上文正向断言一一对应，证明分类依据是历史全量扫描（不是只看
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

];
