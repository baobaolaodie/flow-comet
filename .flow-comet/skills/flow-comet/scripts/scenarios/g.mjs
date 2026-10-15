// 场景组 g — 安装器新链路 · 写写重叠 · 漂移容忍 · directOverride 授权约束
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import {
  assertExit,
  assertNotOut,
  assertOut,
  baseState,
  copyTreePortable,
  runGuard,
  runHook,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  CHANGE_ID,
  PREPARE_ENV,
  REPO_ROOT,
  SCRIPTS_DIR,
  bridgeStampSyncProblems,
  bridgeStampSyncSubAnchorCases,
  fixtureBridgeBaseVersion,
  fixtureIsBridgeDevVersion,
  handoffFor,
  runBridgeCheck,
  runPlanExit,
  runPrepareEnv,
  strictSummary,
  summaryContent,
  writeBridgeFixture,
  writeIntakeArtifacts,
} from '../lib/test-fixtures.mjs';
import {
  assertInstalledCopyBridgeVersionCase,
  bridgeCopyVersionSubAnchorCases,
  runGuardWithProtocol,
  runStateWithProtocol,
} from '../lib/test-assertions.mjs';
import {
  globEquivalenceProblems,
} from '../lib/text-anchor-checks.mjs';

export const ENTRIES = [

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
        copyTreePortable(path.join(SCRIPTS_DIR, '..'), cjkSource);
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
        const expected = listTree(path.join(SCRIPTS_DIR, '..'));
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
      // ⑨ 便携复制的**使用面**锚：会复制目录的模块必须走同一个便携实现。⑧ 只证明工具本身可用，
      // 锚不住「谁在用它」——system-fixtures 与 items/k 曾直接用 fs.cpSync，中文路径检出里整套
      // 会静默中断（无失败报告、无总结行，最容易被误读成通过）。
      //
      // 判据形状（两轮外部审查共指出四条逃逸/误报路径，均已按下述规则收口）：
      //   · **全树扫描**：不再有文件清单——写死清单会漏掉新增的复制模块。
      //   · **只在代码行上匹配**（跳过注释行）：注释里写个调用样子不该把套件判红（本锚第一版就
      //     因此把自己判成违规——注释里写了带括号的调用形态字面量）。
      //   · **要求调用形态**：点号访问、方括号访问、裸标识符调用三种写法都要带左括号才算；
      //     光是一个引号里的属性读不算（否则字符串与说明文字会误报）。
      //   · **补「导入绑定」这一路**：解构导入（`import { … } from 'fs'`）含 `as` 别名先在导入处
      //     拦下——裸标识符调用的唯一来路就是它，拦住导入即等于拦住别名写法。导入规则同样只看
      //     代码行：本注释第一版把导入写法当例子写在注释里，锚又把自己判成了违规。
      //
      // **判据的诚实边界**：动态拼名（`fs['cp' + 'Sync']`）不在覆盖内——那是刻意规避，名称型回归
      // 守卫不承担这个职责（要覆盖它得引入解析器，而全仓只允许一个第三方依赖）。其它复制通道
      // （`fs.cp` 等）同理：**先补 Windows + 非 ASCII 源路径的实测**，再决定是否纳入本判据——
      // 不要把「没测过」当成「没问题」，也不要在没有实测的情况下扩大模式。
      {
        const cpName = 'cp' + 'Sync';
        const isCommentLine = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);
        const codeOnly = (text) => text.split(/\r?\n/).filter((l) => !isCommentLine(l)).join('\n');
        const cpCalls = new RegExp(
          '\\.' + cpName + '\\s*\\('
          + '|\\[\\s*[\'"]' + cpName + '[\'"]\\s*\\]\\s*\\('
          + '|(?:^|[^\\w.$])' + cpName + '\\s*\\(',
        );
        const cpImport = new RegExp('\\b' + cpName + '\\b[^;]*from\\s*[\'"]');
        const offenders = [];
        const walkScripts = (root) => {
          for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            const full = path.join(root, entry.name);
            if (entry.isDirectory()) walkScripts(full);
            else if (entry.name.endsWith('.mjs')) {
              const text = fs.readFileSync(full, 'utf8');
              const code = codeOnly(text);
              if (cpCalls.test(code) || cpImport.test(code)) offenders.push(full);
            }
          }
        };
        walkScripts(SCRIPTS_DIR);
        if (offenders.length) {
          throw new Error('仍在直接使用 cpSync 复制目录（中文路径检出会静默崩溃，请走 copyTreePortable）：'
            + offenders.map((f) => path.relative(SCRIPTS_DIR, f).replace(/\\/g, '/')).join(', '));
        }
        const defs = [];
        // 针同样拼接：本断言自身就在这个文件里，整字面量会自指命中（实测踩到过一次）。
        const defNeedle = 'export function copy' + 'TreePortable';
        const walkDefs = (root) => {
          for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            const full = path.join(root, entry.name);
            if (entry.isDirectory()) walkDefs(full);
            else if (entry.name.endsWith('.mjs') && fs.readFileSync(full, 'utf8').includes(defNeedle)) defs.push(full);
          }
        };
        walkDefs(SCRIPTS_DIR);
        if (defs.length !== 1 || path.basename(defs[0]) !== 'test-helpers.mjs') {
          throw new Error('copyTreePortable 的定义必须是唯一且落在 test-helpers.mjs，实际：'
            + (defs.map((f) => path.basename(f)).join(', ') || '零处'));
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
      const installedVersion = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'INSTALLED_VERSION'), 'utf8').trim();
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
  // 不可行的 advance/select 指引（修复锚）。修复前 currentNode 校验必 BLOCK → RED。
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

  // 211: 路由诊断静默扩展——剩余 pending 全串行（P→S 收尾转换：并行已全 done、
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

  // 217: hook state 文件拦截的大小写变体闭合——win32/darwin 文件系统大小写
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

  // 218: execute 完成判定 fail-closed——pending===0 不足为凭：缺/未知 status
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

  // 219: 并行文件依赖检测路径归一化闭合——重叠比较只用原始字符串时，
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
];
