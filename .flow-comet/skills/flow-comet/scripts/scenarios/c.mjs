// 场景组 c — 声明机制 · 产物推导 · 模板保真 · 技能加载前置门 · 零提交边界
// 元素形态：`{ name, run }`；计数由 `lib/count-derivation.mjs` 从本目录聚合，不手抄数字。
// 组界按场景名前缀与文件内既有分段划，与入口 `SCENARIOS` 的拼接顺序一致。

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import {
  assertExit,
  assertNotOut,
  assertOut,
  assertTrue,
  baseState,
  cleanupTmpDir,
  copyTreePortable,
  runGuard,
  runHandoff,
  runState,
  writeFile,
  writeState,
} from '../lib/test-helpers.mjs';
import {
  BUILTIN_PROTOCOL_SOURCE,
  CHANGE_ID,
  REPO_ROOT,
  SCRIPTS_DIR,
  TASK_DONE,
  TASK_DONE_TWO,
  TASK_P1,
  customProtocolWithSkillCall,
  handoffFor,
  makeTmp,
  summaryContent,
  writeCustomProtocol,
  writeIntakeArtifacts,
} from '../lib/test-fixtures.mjs';
import {
  assertOutMatches,
  readScenarioState,
  runGuardWithProtocol,
  runStateWithProtocol,
  scenarioProtocolPath,
} from '../lib/test-assertions.mjs';
import {
  PUBLIC_FACE_DOCS_DIR,
  PUBLIC_FACE_SELF_CHECK_SKIP_NOTICE,
  VISUAL_TONE_APPLICABLE,
  authoritativeSourceAt,
  countSyncProblems,
  publicFaceDocsAbsent,
  writeDesignExitFixture,
} from '../lib/text-anchor-checks.mjs';

// ---------- 公开面的机器状态字段名口径 + 命令锚（机检；判据与反向构造共用本实现） ----------
// 规则：公开说明面不直写机器状态字段名——引擎在状态文件里拥有的键要么改述为行为描述，要么放进
// **明确标注**的状态输出示例围栏块（白名单）。判据是「键名黑名单 + 示例块白名单」而非精确句锁：
// 改述措辞可以自由演化，键名不能重新走私进正文。routeNode 属公开输出契约名，不在黑名单内。
// 受检面不手抄：从 docs/authority-map.json（公开文档权威与姊妹文档的唯一声明处）取 authority/twin
// 两侧，再并上根目录文档与 docs/examples 的目录扫描——新增公开文档只要登记进映射、或按惯例落在
// 根目录，字段名扫描与命令锚两处判据同时覆盖，不会出现「加进一个清单、漏掉另一个」的静默窄化。
// 两类结构性排除（都不是行为描述面）：① 变更日志——按时间的历史记录，条目引用当时发布的措辞与
// 当时的机器字段名；② 根目录的代理指令文件——本地工作说明，不面向用户、不随包分发。
const PUBLIC_FACE_AUTHORITY_MAP = 'docs/authority-map.json';
const PUBLIC_FACE_EXAMPLES_DIR = 'docs/examples';
const PUBLIC_FACE_HISTORY_DOCS = ['CHANGELOG.md', 'CHANGELOG-zh.md'];
const PUBLIC_FACE_AGENT_DOCS = ['AGENTS.md', 'CLAUDE.md'];
// 示例块白名单的标记词：围栏 info string，或围栏之上紧邻的最后一行非空正文（标题 / 说明）写明
// 这是状态输出示例——只有明说「这是示例数据」才放行，普通代码块不因此获得豁免。
const PUBLIC_FACE_EXAMPLE_MARKERS = ['状态输出示例', 'state output example', 'status output example'];
// 机器状态字段黑名单 = 引擎在状态文件里拥有、**绝不由人写**的键（state-schema 的机器自有字段）。
// 名单不按「今天文档里写了什么」取，而按「状态文件里真的有什么」取：这些键一旦被公开面当成用户
// 面契约直写，读者就会以为可以手改它们。新增机器字段时在这里登记，判据才跟着扩展。
// 驼峰键名在英文 / 中文散文里都不会自然出现，故任何位置命中都算直写（不必依赖反引号）。
const PUBLIC_FACE_STATE_FIELDS = [
  'currentNode', 'stateCurrentNode',
  'completedNodes', 'enteredNodes', 'directOverride', 'newChange',
  // verifyFailures 用前缀匹配覆盖同族的 verifyFailuresByChange（见 fieldNameHitsOnLine）
  'verifyFailures',
];
// evidence 另有散文形态（见 EVIDENCE_FIELD_FRAME_RE 与 fieldNameHitsOnLine 的放行规则）。
// 结构预检命令的公开面锚：三份文档 × 中英都必须在案。新增公开命令不得没有锚——否则删掉或漏写
// 其中任何一份，套件仍然全绿，公开面就真的丢了这条命令。这里只选主题名，路径仍从映射取——「哪份
// 文档承载命令说明」因此也只在映射里声明一次。
const PUBLIC_FACE_PREFLIGHT_TOPICS = ['behaviour', 'workflow', 'troubleshooting'];
const PREFLIGHT_FLAG = '--preflight';

function listMarkdownFiles(absDir, relDir) {
  const out = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = relDir + '/' + entry.name;
    if (entry.isDirectory()) out.push(...listMarkdownFiles(path.join(absDir, entry.name), rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

// 形态判据（公开面能不能派生）：先问「这份检出有没有公开文档面」，再谈派生——npm 包按 package.json
// 的 files 白名单只分发 .flow-comet/skills 与 rules，不含 docs/、CONTRIBUTING.md 与 .github/；安装
// 副本同理。这种形态下「受检面无法派生」不是缺文件事故，而是载体的**正常形态**，说成「仓库缺文件」
// 会把读者引到修复一个不存在的缺陷上。判据落点选**这三份公开面载体是否俱缺**，而不是权威映射文件
// 在不在：只看 docs/ 不够——分支 / 稀疏检出 / 误删把 docs/ 整份拿掉时，「本载体不含公开面」变成假话，
// 计数一致性 / 零代号 / 词表镜像会整块跳过；docs/ 在、映射缺 = 检出被裁坏，仍要在读取处显式失败
// （判据强度不降——跳过通道只对「整份公开面不存在」开放）。
// 形态判据与其跳过提示**从 lib 共用**（底部自检的公开面自检用同一对）：同一种形态在两处各判一次，
// 两份实现迟早各说各话——一处把包形态说成「缺文件」、另一处说成「跳过」，正是本批修掉的误诊。
// 判据落点与措辞只在 lib/text-anchor-checks.mjs 维护（PUBLIC_FACE_DOCS_DIR / publicFaceDocsAbsent /
// PUBLIC_FACE_SELF_CHECK_SKIP_NOTICE）。

// 权威映射缺席或不可解析 = 受检面无从派生（不是「没有东西要查」）：显式失败，不静默退化。
// root 可覆盖读取根（默认仓库根）——仅为可测性接缝：形态判据的探针要在夹具目录上验证「docs/ 在、
// 映射缺仍显式失败」，生产调用不传。
function readPublicFaceAuthorityMap(root = REPO_ROOT) {
  const abs = path.join(root, ...PUBLIC_FACE_AUTHORITY_MAP.split('/'));
  if (!fs.existsSync(abs)) {
    throw new Error('受检面无法派生：' + PUBLIC_FACE_AUTHORITY_MAP
      + ' 不在本检出（公开文档权威映射是受检面的唯一来源）');
  }
  const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !parsed.topics || typeof parsed.topics !== 'object') {
    throw new Error('受检面无法派生：' + PUBLIC_FACE_AUTHORITY_MAP + ' 缺 topics 对象');
  }
  return parsed;
}

// 映射的每个主题 → [authority, twin]（twin 为 null 的主题只登记权威侧）。
// 畸形或空主题一律抛错而不是跳过：跳过等于把该主题的文档静默移出受检面——字段名黑名单与命令锚
// 都不再落到它们身上，而套件依然全绿。主题写坏是可判定的失配，就该是一次显式失败。
function publicFaceTopicPairs(map) {
  const pairs = new Map();
  for (const [topic, spec] of Object.entries(map.topics)) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new Error('受检面无法派生：' + PUBLIC_FACE_AUTHORITY_MAP + ' 的主题 ' + topic + ' 不是对象');
    }
    const pair = [spec.authority, spec.twin].filter((rel) => typeof rel === 'string' && rel.trim() !== '');
    if (pair.length === 0) {
      throw new Error('受检面无法派生：' + PUBLIC_FACE_AUTHORITY_MAP + ' 的主题 ' + topic
        + ' 未登记任何文档路径（authority 与 twin 都为空）');
    }
    pairs.set(topic, pair);
  }
  return pairs;
}

// 受检文档集合 = 映射两侧 ∪ 根目录文档，再减去上面两类排除面。根目录扫描是必要的：按 GitHub 惯例
// 放在根目录的公开文件里有整份未登记进映射的（CODE_OF_CONDUCT 及其双语版、SECURITY-zh.md），
// 只靠映射会静默漏掉它们。
function publicFaceDocPaths(map) {
  const paths = new Set();
  for (const pair of publicFaceTopicPairs(map).values()) for (const rel of pair) paths.add(rel);
  for (const entry of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) paths.add(entry.name);
  }
  for (const rel of [...PUBLIC_FACE_HISTORY_DOCS, ...PUBLIC_FACE_AGENT_DOCS]) paths.delete(rel);
  return [...paths].sort();
}

// 命令锚所在的文档：按主题名从映射取（路径不在此手抄）。
// 主题名取不到即抛错：空集会把锚的受检文档集清空，于是命令锚被整段删掉也不红——「新增公开命令
// 不得无锚」这条判据要防的正是这种静默窄化，主题改名或写错必须显式失败。
function publicFacePreflightDocs(map) {
  const pairs = publicFaceTopicPairs(map);
  const docs = [];
  for (const topic of PUBLIC_FACE_PREFLIGHT_TOPICS) {
    const pair = pairs.get(topic);
    if (!pair) {
      throw new Error('受检面无法派生：' + PUBLIC_FACE_AUTHORITY_MAP + ' 未登记主题 ' + topic
        + '（命令锚文档按主题名派生；主题改名时须同步本判据，不得让锚随主题一起消失）');
    }
    docs.push(...pair);
  }
  return docs;
}

// 受检快照 { texts, preflightDocs }，文本按 Map 组织（rel → 文本或 null）：判据只读这一份快照，
// 反向构造在副本上作业。
function readPublicFaceTexts() {
  const map = readPublicFaceAuthorityMap();
  const texts = new Map();
  for (const rel of publicFaceDocPaths(map)) {
    const abs = path.join(REPO_ROOT, ...rel.split('/'));
    texts.set(rel, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null);
  }
  const examplesRoot = path.join(REPO_ROOT, ...PUBLIC_FACE_EXAMPLES_DIR.split('/'));
  if (!fs.existsSync(examplesRoot)) {
    // 整面缺席显式报告：静默等于把「本检出没有示例面」当成「示例面已校验」。
    texts.set(PUBLIC_FACE_EXAMPLES_DIR + '/**/*.md', null);
  } else {
    for (const rel of listMarkdownFiles(examplesRoot, PUBLIC_FACE_EXAMPLES_DIR)) {
      texts.set(rel, fs.readFileSync(path.join(REPO_ROOT, ...rel.split('/')), 'utf8'));
    }
  }
  return { texts, preflightDocs: publicFacePreflightDocs(map) };
}

function isStatusExampleMarker(line) {
  const lowered = line.toLowerCase();
  return PUBLIC_FACE_EXAMPLE_MARKERS.some((marker) => lowered.includes(marker.toLowerCase()));
}

// 报错要能直接照做：先点名键名与改述方向，再给出唯一的合法展示出口（标注为状态输出示例的
// 围栏块）——否则作者只知道「不能写」，不知道「要展示时该怎么写」。
function fieldNameViolation(where, fieldName) {
  return where + ' 直写了机器状态字段名 ' + fieldName
    + '（改述为行为描述；确需展示状态输出时，放进标注为「状态输出示例」的围栏块）';
}

// 「指名某个字段」的散文框：the `evidence` field / the evidence field / evidence 字段。**单数**才
// 构成指名——复数的 "the evidence fields" 是集合描述（公开面本就有这类句子：the output schemas,
// the gates, the commands, the evidence fields），不指名任何键。
const EVIDENCE_FIELD_FRAME_RE = /(?<![A-Za-z0-9_$])`?evidence`?\s+(?:field|字段)(?![A-Za-z0-9_$])/;

// 键名判据：驼峰键名任何位置命中都算直写（散文里不会自然出现，不必依赖反引号）；evidence 是普通
// 英文名词与状态键同形，只在**被当成字段名写**时算违规：
//   ① 独立成键名的反引号段 `evidence`；
//   ② 指名它的散文框（EVIDENCE_FIELD_FRAME_RE，带不带反引号都命中）；
//   ③ 裸属性后缀 `.evidence`（单独写成字段路径）。
// 放行规则（两类都不是「行为描述面」，故不构成字段名直写）：
//   ① **代码位置引用**：state.evidence 这类带宿主标识符的属性访问说的是「去哪看」，不是把键名写成
//      文档契约——「裸 .evidence」与「X.evidence」由同一个连接式前后界区分，不另写键表；
//   ② **围栏里的示例**：标注为状态输出示例的围栏块整块放行（既有白名单，双向探针在场景 105）。
//      未标注的围栏块不因「它是代码」而豁免：把状态输出贴进普通代码块同样是直写。
// 其余自然语言用法（"the evidence recorded for the node"、`evidence: [{ id, required }]` 这类
// 协议字段说明）不命中任何一条。
function fieldNameHitsOnLine(where, line) {
  const out = [];
  for (const name of PUBLIC_FACE_STATE_FIELDS) {
    // verifyFailures 用前缀匹配：verifyFailuresByChange 是同一族的键，漏掉它等于留后门。
    const matcher = name === 'verifyFailures'
      ? /(?<![A-Za-z0-9_$])verifyFailures[A-Za-z0-9_]*/g
      : new RegExp('(?<![A-Za-z0-9_$])' + name + '(?![A-Za-z0-9_$])', 'g');
    for (const hit of line.matchAll(matcher)) out.push(fieldNameViolation(where, hit[0]));
  }
  for (const span of line.matchAll(/`([^`]*)`/g)) {
    if (span[1].trim() === 'evidence') out.push(fieldNameViolation(where, 'evidence'));
  }
  if (EVIDENCE_FIELD_FRAME_RE.test(line)) out.push(fieldNameViolation(where, 'evidence'));
  if (/(?<![A-Za-z0-9_$])\.evidence(?![A-Za-z0-9_$])/.test(line)) {
    out.push(fieldNameViolation(where, 'evidence'));
  }
  return out;
}

// 逐行扫描：未标注的围栏块同样是正文（把状态输出贴进普通代码块不等于获得白名单）；标注为
// 状态输出示例的围栏块整块放行。行内反引号段里的 evidence 是被当作键名书写，散文里的不是。
function publicFaceFieldProblems(rel, text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let fence = null;
  let fenceIsExample = false;
  let lastContentLine = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const opening = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence === null && opening) {
      fence = opening[1][0];
      fenceIsExample = isStatusExampleMarker(opening[2]) || isStatusExampleMarker(lastContentLine);
      continue;
    }
    if (fence !== null) {
      if (new RegExp('^\\s{0,3}' + fence + '{3,}\\s*$').test(line)) {
        fence = null;
        fenceIsExample = false;
      } else if (!fenceIsExample) {
        out.push(...fieldNameHitsOnLine(rel + ':' + (i + 1), line));
      }
      continue;
    }
    if (line.trim() !== '') lastContentLine = line.trim();
    out.push(...fieldNameHitsOnLine(rel + ':' + (i + 1), line));
  }
  return out;
}

function publicFaceMachineProblems({ texts, preflightDocs }) {
  const out = [];
  for (const [rel, text] of texts) {
    if (typeof text !== 'string') out.push(rel + ' 缺失（公开面不在本检出）');
  }
  for (const [rel, text] of texts) {
    if (typeof text === 'string') out.push(...publicFaceFieldProblems(rel, text));
  }
  for (const rel of preflightDocs) {
    const text = texts.get(rel);
    if (typeof text === 'string' && !text.includes(PREFLIGHT_FLAG)) {
      out.push(rel + ' 缺「' + PREFLIGHT_FLAG + '」锚（结构预检命令须在三份公开面 × 中英在案）');
    }
  }
  return out;
}

// ---------- 权威源设计形态锚（形态探测与上面同源：.flow-comet/ 技能树在场 = 权威源检出） ----------
// 设计形态 = 权威源册子里写出的命令形态（.claude/skills/flow-comet/scripts/…，相对路径），安装时由
// prepare-env 的 pathReplacements 按平台替换。锚的就是这个形态：安装副本按运行根推导同样是对的，但
// 那是另一种载体下的正确形态——两种形态混进一条判据，就谁也锁不住（谁都能满足它）。
const DESIGN_FORM_SCRIPTS_DIR = '.claude/skills/flow-comet/scripts';
// 「本锚只在权威源检出运行」的判据必须看**正在跑的是哪套脚本**，而不是「仓库里有没有 .flow-comet/」——
// 仓库里同时存在 .claude|.agents|.dsh 三份副本，跑副本套件时仓库根锚照样在场；只用根锚会把副本误判成权威源，
// 让安装副本按运行根打印的（对副本而言正确的）路径被判成违规。
const RUNS_FROM_AUTHORITATIVE_SCRIPTS = path.relative(REPO_ROOT, SCRIPTS_DIR).split(path.sep).join('/') === '.flow-comet/skills/flow-comet/scripts';

// 恢复段的形态锚（只在权威源检出运行）。场景 34 的恢复命令断言已改成行为判据（存在 + basename
// + 真执行），三种形态的路径都能满足——于是「权威源打印设计形态」失去锁：把 scriptCommand 改成恒打印
// 绝对安装根，行为判据全绿，而权威源册子里的命令会开始写本机路径。本锚只读打印出来的那段恢复报文
// （不拿 harness 的脚本路径替代），要求命令的脚本路径逐字等于设计形态。
// 锁的是「段内有一条 record 命令 + 路径是设计形态 + 步骤按执行顺序」，不锁「record 紧贴『恢复:』」
// 这种书写形态：措辞可以演化，能按顺序照抄走通才是判据——顺序反了，执行者从上往下第一步就撞门。
function assertDesignFormRecoveryPath(dir) {
  // 触发一条走 scriptCommand 的恢复指引：subagent-execute 有 handoff 结果、缺 summary → 出口按
  // Output Schema evidence 阻塞。夹具是全新临时目录 ⇒ 本节点还没有技能加载声明标记 ⇒ 走「先声明、
  // 再 record」的两步形态（声明已在场时的收敛形态由场景 34 覆盖）。
  const st = baseState('subagent-execute');
  st.evidence['subagent-execute'] = { handoffResult: handoffFor(['P01']) };
  writeState(dir, st);
  writeFile(dir, '.specs/' + CHANGE_ID + '/TASK.md', '# TASK\n\n' + TASK_P1);
  const res = runGuardWithProtocol(dir, ['exit', 'subagent-execute']);
  assertExit(res, 1);
  assertOut(res, 'BLOCKED: missing Output Schema evidence');
  // 本段 = 输出里最后一条恢复段（该段之后引擎直接退出）。
  const start = res.output.lastIndexOf('恢复:');
  const block = start < 0 ? '' : res.output.slice(start);
  if (block === '') {
    throw new Error('缺 Output Schema evidence 的阻塞没给恢复段（设计形态锚无从判定）:\n' + res.output);
  }
  // 两条命令（skill-load 自成一行可整行照抄；record 以「后重试 exit」收尾）：先声明技能加载，再 record。
  const skillLoadLine = (block.match(/^\s*(node "[^"]+" skill-load [^\n]*)$/m) || [])[1];
  const recordLine = (block.match(/(node "[^"]+" record [^\n]*) 后重试 exit/) || [])[1];
  if (!skillLoadLine || !recordLine) {
    throw new Error('恢复段应同时给出可照抄的 skill-load 与 record 命令'
      + '（缺声明时照抄 record 会先被它自己的前置门拦下）:\n' + block);
  }
  // 顺序 = 执行顺序，且步骤标注跟着各自的命令走（不是只在段首提一句）。
  const skillAt = block.indexOf(skillLoadLine);
  const recordAt = block.indexOf(recordLine);
  if (!(skillAt >= 0 && recordAt > skillAt)) {
    throw new Error('恢复段应按执行顺序排列：skill-load（声明技能加载）在前、record（补证据）在后——'
      + '顺序反了执行者照抄会先撞前置门:\n' + block);
  }
  if (!block.slice(0, skillAt).includes('第一步')) {
    throw new Error('恢复段未把技能加载声明标为第一步:\n' + block);
  }
  if (!block.slice(skillAt + skillLoadLine.length, recordAt).includes('第二步')) {
    throw new Error('恢复段未把 record 标为第二步:\n' + block);
  }
  // 路径逐字等于设计形态（两条命令都经 scriptCommand，路径与引号只有这一处实现）。
  const expected = DESIGN_FORM_SCRIPTS_DIR + '/workflow-state.mjs';
  for (const [label, printed] of [['skill-load', skillLoadLine], ['record', recordLine]]) {
    const printedPath = (printed.match(/^node "([^"]+)"/) || [])[1];
    if (printedPath !== expected) {
      throw new Error('权威源检出打印的恢复段 ' + label + ' 命令脚本路径应为设计形态 ' + expected
        + '（相对路径）——实际: ' + JSON.stringify(printedPath)
        + '；安装副本按运行根推导属另一种载体的正确形态，不在本锚范围（本锚只在权威源检出运行）');
    }
  }
}

// ---------- 恢复段给出的命令：解析 → 在夹具内逐字执行（照抄闭合） ----------
//
// 恢复段承诺的是「可照抄的命令」，判据就得**真的照抄**：从报文解析命令文本 → 按当前运行形态解析
// 脚本路径 → 用同一份参数跑一遍（只把 `node` 换成本进程的可执行文件——PATH 解析不是判据对象）。
// 夹具按安装布局复制本套件技能树：权威源打印的设计形态相对路径（.claude/skills/…）才在夹具内可
// 解析，因此执行的是**打印文本**；拿 harness 的绝对脚本路径替代它，「这条命令能不能跑」就等于没判。
function installSkillTreeCopy(root, installDirRel) {
  const skillCopy = path.join(root, installDirRel, 'flow-comet');
  copyTreePortable(path.join(SCRIPTS_DIR, '..'), skillCopy);
  return skillCopy;
}

// 打印命令 → argv：按 shell 分词语义处理双引号与单引号（引号内空白不切分，引号本身不进入参数）。
// 该解析器对「整条路径未加引号」有判别力——缺引号时含空格的路径会被切成多个参数。
function splitPrintedCommand(command) {
  const argv = [];
  let current = '';
  let quote = null;
  let started = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) {
      if (started) { argv.push(current); current = ''; started = false; }
      continue;
    }
    current += ch;
    started = true;
  }
  if (quote) throw new Error('打印命令的引号未闭合: ' + command);
  if (started) argv.push(current);
  return argv;
}

// 真实执行打印出来的那条命令：解释器名 `node` 换成本进程的 node 可执行文件，其余一律照打印文本
// 解析（脚本路径与参数是判据对象，PATH 不是）。
function runPrintedCommand(command, root, envOverrides = {}) {
  const argv = splitPrintedCommand(command);
  const interpreter = /^node(\.exe)?$/i.test(argv[0]) ? process.execPath : argv[0];
  const res = spawnSync(interpreter, argv.slice(1), {
    cwd: root,
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status ?? 1, output: String(res.stdout || '') + String(res.stderr || '') };
}

// 照抄闭环自己的夹具根 + 协议副本：场景运行器给主夹具做的那两步，在闭环的独立根上再走一遍
// （协议文件必须在运行根内才会被守卫读取）。
function makeReplayRoot() {
  const root = makeTmp();
  fs.mkdirSync(path.dirname(scenarioProtocolPath(root)), { recursive: true });
  fs.copyFileSync(BUILTIN_PROTOCOL_SOURCE, scenarioProtocolPath(root));
  return root;
}

// 照抄执行段（两条闭环共用）：按安装布局把本套件技能树复制进夹具（打印出来的设计形态相对路径才可
// 解析），并清掉环境里的协议注入——命令自带的协议上下文必须够用。返回逐条执行打印文本的函数，
// 非 0 即失败并回显命令。
function printedCommandReplay(root, label) {
  installSkillTreeCopy(root, path.join('.claude', 'skills'));
  const cleanEnv = { FLOW_COMET_RUN_ROOT: root, FLOW_COMET_PROTOCOL: '' };
  return (command) => {
    const res = runPrintedCommand(command, root, cleanEnv);
    assertTrue(res.status === 0, label + '：照抄的命令跑不通\n  命令: ' + command
      + '\n  exit ' + res.status + '\n' + res.output);
    return res;
  };
}

// 恢复段 = 输出里最后一条「恢复:」起的整段（该段之后引擎直接退出）。
function lastRecoveryBlock(output) {
  const text = String(output);
  const start = text.lastIndexOf('恢复:');
  return start < 0 ? '' : text.slice(start);
}

// 段内某一类命令的全部可照抄行：record 行以「后重试 exit」收尾，取到它之前；skill-load 自成一行。
function printedCommandsOf(block, verb) {
  const pattern = verb === 'record'
    ? /(node "[^"]+" record [^\n]*) 后重试 exit/g
    : new RegExp('^\\s*(node "[^"]+" ' + verb + ' [^\\n]+)$', 'gm');
  return [...block.matchAll(pattern)].map((match) => match[1]);
}

// 声明恢复的照抄闭合（open / review 同一条判据）：删声明与证据 → exit 被拦 → **逐字照抄**报文给出的
// 每条命令（第一步的声明命令按序，再第二步的 record）→ 同一 exit 通过。缺陷形态：第一步只声明实现
// 技能 + 首份协议、且不带模板清单，照抄完同一 exit 仍被覆盖门点名（缺另一份协议文件与另一个必需
// 技能）——「报文各给一半」正是本断言要钉死的东西：照抄不了就是没修好。
function assertDeclarationRecoveryRoundTrip({ node, fixture, skills, prompts, templates }) {
  const root = makeReplayRoot();
  try {
    fixture(root);
    const blocked = runGuard(['exit', node], root);
    assertExit(blocked, 1);
    assertOut(blocked, 'BLOCKED: missing evidence for Node ' + node);
    const block = lastRecoveryBlock(blocked.output);
    const declared = printedCommandsOf(block, 'skill-load');
    const recordCommand = printedCommandsOf(block, 'record')[0];
    if (declared.length === 0 || !recordCommand) {
      throw new Error(node + '：缺声明 + 缺证据的阻塞应同时给出 skill-load 与 record 命令:\n' + block);
    }
    // 照抄：声明命令按报文顺序执行，再 record。环境里不注入协议——命令自带的上下文必须够用。
    const copyAndRun = printedCommandReplay(root, node);
    for (const command of declared) copyAndRun(command);
    copyAndRun(recordCommand);
    // 核心：照抄完，同一个 exit 必须通过（不是「再去另一条报文里找第二步」）。
    const recovered = runGuard(['exit', node], root);
    assertExit(recovered, 0);
    assertOut(recovered, 'ALL CHECKS PASSED');
    assertDerivedDeclarationCommands({ node, block, declared, skills, prompts, templates });
    assertDeclarationGateRecovery({ node, root, skills, prompts, templates, copyAndRun });
  } finally {
    cleanupTmpDir(root);
  }
}

// 派生形态的判据：每个 guarded 必需技能各一条，且每条都带该节点**全部**协议文件与该节点的模板
// 全清单。照抄闭环已经会红掉「跑不通」的拼法；这一层把推导规则本身钉住——把两份协议分到两条命令、
// 或只给其一，都属于「凑够覆盖但命令不是同一个形态」，下游照抄同样会在模板面 / 协议面漏。
function assertDerivedDeclarationCommands({ node, block, declared, skills, prompts, templates }) {
  if (declared.length !== skills.length) {
    throw new Error(node + '：声明命令应每个 guarded 必需技能各一条（' + skills.length + ' 条），实际 '
      + declared.length + ' 条:\n' + declared.join('\n'));
  }
  const templateFlag = '--templates ' + templates.join(',');
  for (const skill of skills) {
    const command = declared.find((line) => line.includes(' skill-load ' + node + ' ' + skill + ' '));
    if (!command) {
      throw new Error(node + '：恢复段缺技能 ' + skill + ' 的声明命令（该技能是 guarded 必需技能）:\n' + block);
    }
    for (const prompt of prompts) {
      if (!command.includes('--prompt ' + prompt)) {
        throw new Error(node + '：' + skill + ' 的声明命令缺协议文件 ' + prompt
          + '（一条命令要把该节点全部协议文件都带上，照抄才一次到位）: ' + command);
      }
    }
    if (!command.includes(templateFlag)) {
      throw new Error(node + '：' + skill + ' 的声明命令缺模板全清单 ' + templateFlag
        + '（漏模板清单，照抄后会被模板门拦下）: ' + command);
    }
  }
}

// 覆盖门补齐命令的照抄闭合（同一缺陷的第二半：门只给缺项、技能名占位、且漏 --templates）。把声明
// 退回旧口径——只剩一个技能 + 一份协议（模板清单仍写全，否则第一步就撞 skill-load 自己的模板门，
// 测不到覆盖门）→ exit 被覆盖门拦下 → **照抄门给出的命令** → 同一 exit 通过。
function assertDeclarationGateRecovery({ node, root, skills, prompts, templates, copyAndRun }) {
  const loadsDir = path.join(root, '.specs', CHANGE_ID, '.skill-loads');
  const declaredSkill = skills[0];
  for (const name of fs.readdirSync(loadsDir)) fs.rmSync(path.join(loadsDir, name));
  assertExit(runState(['skill-load', node, declaredSkill, '--prompt', prompts[0],
    '--templates', templates.join(',')], root), 0);
  const blocked = runGuard(['exit', node], root);
  assertExit(blocked, 1);
  assertOut(blocked, '缺协议声明标记');
  const block = lastRecoveryBlock(blocked.output);
  const commands = printedCommandsOf(block, 'skill-load');
  if (commands.length === 0) {
    throw new Error(node + '：覆盖门的恢复段没给出可照抄的声明命令:\n' + block);
  }
  // 形态断言（照抄能过 ≠ 命令形态对）：覆盖门的命令按**缺的必需技能子集**派生——已在场的技能不重
  // 复刷，缺的每个技能各一条——且每条都把该节点**全部** --prompt 与模板全清单带全。只锁「照抄后
  // 通过」会放过少一份 --prompt 的拼法：那份协议此刻由既有标记覆盖，缺口要等执行者删掉那条标记
  // 才现形（报文当场就给不全）。少一条命令 / 多刷已声明的技能 / 少任一份 --prompt / 少模板清单，
  // 本断言即红。
  const expectedSkills = skills.filter((skill) => skill !== declaredSkill);
  if (commands.length !== expectedSkills.length) {
    throw new Error(node + '：覆盖门的声明命令应按缺的必需技能子集派生（缺 '
      + expectedSkills.join('、') + ' = ' + expectedSkills.length + ' 条），实际 '
      + commands.length + ' 条:\n' + block);
  }
  const templateFlag = '--templates ' + templates.join(',');
  for (const skill of expectedSkills) {
    const command = commands.find((line) => line.includes(' skill-load ' + node + ' ' + skill + ' '));
    if (!command) {
      throw new Error(node + '：覆盖门的恢复段缺技能 ' + skill + ' 的声明命令（它是缺的必需技能）:\n' + block);
    }
    for (const prompt of prompts) {
      if (!command.includes('--prompt ' + prompt)) {
        throw new Error(node + '：' + skill + ' 的声明命令缺协议文件 ' + prompt
          + '（覆盖门要求该节点全部协议文件都被声明，少给一份，照抄后同一 exit 仍会点名它）: ' + command);
      }
    }
    if (!command.includes(templateFlag)) {
      throw new Error(node + '：' + skill + ' 的声明命令缺模板全清单 ' + templateFlag + ': ' + command);
    }
  }
  for (const command of commands) copyAndRun(command);
  const recovered = runGuard(['exit', node], root);
  assertExit(recovered, 0);
  assertOut(recovered, 'ALL CHECKS PASSED');
}

// 前端 design 的证据门照抄闭合（gated 绑定的那半）：证据里只缺 required-skill:design.flow-comet-ui-design
// ——出口对该绑定**不再自动补写**，恢复必须同一段给全两件事：
//   ① 真实 skill-load 声明（nodeSkillLoadCommands 的同一装配：每个 guarded 必需技能各一条，每条带
//      该节点全部 --prompt（含条件提示词 2a-ui-design.md）与模板全清单）；
//   ② 带该 required-skill 的 record——只补声明不补证据，同一个 exit 仍点名同一条。
// 旧形态（占位提示词、无 --templates、不提 record）照抄后必死循环；本断言逐层钉住这两件，再真的
// 照抄走一遍。
function assertFrontendDesignEvidenceRoundTrip() {
  const root = makeReplayRoot();
  try {
    writeDesignExitFixture(root, {
      newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: false,
    });
    const blocked = runGuard(['exit', 'design'], root);
    assertExit(blocked, 1);
    assertOut(blocked, 'BLOCKED: missing required Skill evidence: required-skill:design.flow-comet-ui-design');
    // ① 占位提示词形态：--prompt 的值位置写「<flow-kit/prompts/ 协议文件>」，bash 下 < 是重定向——
    //    照抄直接语法失败（值位置不接受占位符：路径要么给全，要么别给这个参数）。
    assertNotOut(blocked, '--prompt <');
    const block = lastRecoveryBlock(blocked.output);
    const declared = printedCommandsOf(block, 'skill-load');
    const recordCommand = printedCommandsOf(block, 'record')[0];
    if (declared.length === 0 || !recordCommand) {
      throw new Error('design：gated 绑定的缺口应同时给出 skill-load 与 record 命令'
        + '（只给声明不给 record，照抄后同一 exit 仍点名同一条）:\n' + block);
    }
    // ② record 载荷带上被点名的那条 required-skill——record 是覆盖写，只有把这条写回去才算补齐
    if (!recordCommand.includes('required-skill:design.flow-comet-ui-design')) {
      throw new Error('design：record 的恢复载荷没带上 required-skill:design.flow-comet-ui-design'
        + '（自动补写对该绑定已失效，只补声明不补证据 = 死循环）: ' + recordCommand);
    }
    // ③ 派生形态：每个 guarded 必需技能各一条，每条带全部协议文件（含条件提示词）与模板全清单
    assertDerivedDeclarationCommands({
      node: 'design',
      block,
      declared,
      skills: ['flow-comet-design', 'flow-comet-ui-design'],
      prompts: ['flow-kit/prompts/2-design.md', 'flow-kit/prompts/2a-ui-design.md'],
      templates: ['DESIGN.md'],
    });
    // ④ 真的照抄：按报文顺序执行声明命令，再 record；环境里不注入协议（命令自带上下文必须够用）
    const copyAndRun = printedCommandReplay(root, 'design');
    for (const command of [...declared, recordCommand]) copyAndRun(command);
    const recovered = runGuard(['exit', 'design'], root);
    assertExit(recovered, 0);
    assertOut(recovered, 'ALL CHECKS PASSED');
  } finally {
    cleanupTmpDir(root);
  }
}

// ---------- 声明命令的册子锚（入口册 + 展开册：open 的两条规范命令） ----------
//
// 两册给出 open 的**两条**规范声明命令——每个 guarded 必需技能各一条，每条都带该节点全部 --prompt
// 与模板全清单。只写其中一条时，照抄的人会在同一次 exit 上被覆盖门点名缺另一个技能（报文各给一半
// 的文档版）。锚取整行命令（可辨认、可 grep），不取裸词；两册都要有，只出现在一册不算。
const DECLARATION_BOOK_RELS = ['SKILL.md', path.join('reference', 'entry-detail.md')];
const DECLARATION_BOOK_COMMAND_ANCHORS = [
  ['open 的第一个必需技能（change）',
    'skill-load open flow-comet-change --prompt flow-kit/prompts/0-change.md --prompt flow-kit/prompts/1-requirement.md --templates CHANGE.md,REQUIREMENT.md'],
  ['open 的第二个必需技能（requirement）',
    'skill-load open flow-comet-requirement --prompt flow-kit/prompts/0-change.md --prompt flow-kit/prompts/1-requirement.md --templates CHANGE.md,REQUIREMENT.md'],
];

function declarationBookProblems(skillRoot) {
  const out = [];
  for (const rel of DECLARATION_BOOK_RELS) {
    let text;
    try {
      text = fs.readFileSync(path.join(skillRoot, rel), 'utf8');
    } catch {
      out.push(rel + ' 不在场（声明命令锚无法核对）');
      continue;
    }
    for (const [label, command] of DECLARATION_BOOK_COMMAND_ANCHORS) {
      if (!text.includes(command)) out.push(rel + ' 缺「' + label + '」的规范命令');
    }
  }
  return out;
}

// ---------- 形态判据的判别力探针（同一实现驱动，在夹具目录上作业） ----------
// 三条边界都要有：① 真包形态 / 安装副本形态（有技能树、公开面载体**三者俱缺**）跳过且**可见**，
// 不判红；② docs/ 在场而权威映射缺失仍显式失败——跳过通道只对「整份公开面不存在」开放，不能顺手
// 把真事故一起吞掉；③ docs/ 不在、但 CONTRIBUTING.md 或 .github/ 在场必须判红——它们同样不进 npm
// tarball，任一在场就说明这是**被裁坏的仓库**，不是「本来不含公开面」的载体。
function assertPublicFaceShapeProbes(dir) {
  // 真包形态 = docs/、CONTRIBUTING.md、.github/ 三者都不在本检出（npm tarball 三者都不带）
  if (!publicFaceDocsAbsent(dir)) {
    throw new Error('形态探针前提失效：夹具目录不应预先含 ' + PUBLIC_FACE_DOCS_DIR
      + '/、CONTRIBUTING.md 或 .github/（三者俱缺才是「不含公开面」的包形态）');
  }
  for (const phrase of ['此形态不含公开面', '不是仓库缺文件', '未校验']) {
    if (!PUBLIC_FACE_SELF_CHECK_SKIP_NOTICE.includes(phrase)) {
      throw new Error('跳过提示缺「' + phrase + '」——跳过必须说明这是未校验、不是通过、也不是缺文件: '
        + PUBLIC_FACE_SELF_CHECK_SKIP_NOTICE);
    }
  }
  // docs/ 在场 ⇒ 不属「不含公开文档」形态，判据不得据此跳过（否则真检出会被整面跳过）
  fs.mkdirSync(path.join(dir, ...PUBLIC_FACE_DOCS_DIR.split('/')), { recursive: true });
  if (publicFaceDocsAbsent(dir)) {
    throw new Error('形态判据把含 ' + PUBLIC_FACE_DOCS_DIR + '/ 的检出也判成不含公开文档（真检出会被整面跳过）');
  }
  // docs/ 不在、其余公开面载体在场 ⇒ 仍不属包形态：分支 / 稀疏检出 / 误删会把 docs/ 整份拿掉，那时
  // 「本载体不含公开面」是假话——计数一致性 / 公开产物零代号 / 词表镜像会整块变成可见 SKIP 并 exit 0。
  // 两份载体分开造根：CONTRIBUTING.md 与 .github/ 各自单独在场都足以证明本检出是仓库（两者都不进
  // npm tarball；README 不作判据——npm 会强制包含它，用它判断等于把包形态误判成「有公开面」的仓库）。
  for (const carrier of ['CONTRIBUTING.md', '.github/workflows/ci.yml']) {
    const partial = path.join(dir, 'partial-face-' + carrier.split('/')[0].replace(/\./g, ''));
    fs.mkdirSync(partial, { recursive: true });
    writeFile(partial, carrier, '');
    if (publicFaceDocsAbsent(partial)) {
      throw new Error('docs/ 不在但 ' + carrier + ' 在场仍被判成「不含公开面」的包形态——'
        + '该形态下计数一致性 / 公开产物零代号 / 词表镜像会整块变成 SKIP 并 exit 0');
    }
  }
  // docs/ 在场、权威映射缺 = 检出被裁坏 → 仍是读取处的显式失败（判据强度不因跳过通道下降）
  let threw = null;
  try {
    readPublicFaceAuthorityMap(dir);
  } catch (e) {
    threw = e;
  }
  if (!threw || !String(threw.message).includes('受检面无法派生')) {
    throw new Error('docs/ 在场但权威映射缺失时应显式失败，实际: ' + (threw ? threw.message : '未抛错'));
  }
  // 补上映射 ⇒ 读取处正常返回（证明上一条的失败来自「缺映射」而不是「读不到」）
  writeFile(dir, PUBLIC_FACE_AUTHORITY_MAP,
    JSON.stringify({ topics: { workflow: { authority: PUBLIC_FACE_EXAMPLES_DIR + '/README.md' } } }, null, 2) + '\n');
  const parsed = readPublicFaceAuthorityMap(dir);
  if (!parsed.topics || !parsed.topics.workflow) {
    throw new Error('权威映射在场时读取处应返回 topics（探针前提失效）: ' + JSON.stringify(parsed));
  }
}

export const ENTRIES = [

  // ----------  场景（completedChecks 真实性声明机制——skill-load/record/exit 校验 + 交叉自洽 + 旧兼容 + 场景数同步） ----------

  // 98: skill-load 写入声明标记（AC-1）——完整命令形态（--prompt flow-kit/prompts/<阶段>.md，
  // 归属校验通过）→ 标记 .specs/<change-id>/.skill-loads/<node>-<skill>.json 生成，
  // 内容含 node/skill/protocol/protocols/at（ISO 时间戳）+ 输出确认提示。
  // 原位扩展（多 --prompt 记录）：open 节点该读两份协议，一条命令可一次声明多份——标记里存
  // protocols 数组（逐个 basename，按 --prompt 出现顺序），protocol 仍存首个 basename（旧读法兼容：
  // 入口声明核对与既有读标记的消费方只读 protocol 单值）。
  {
    name: '98 skill-load 写入声明标记（AC-1）',
    run: (dir) => {
      // 场景内 flow-kit/prompts/ 提示文件（skill-load --prompt 指向——改名 --prompt 后归属校验仅查
      // 前缀不读内容；协议加载走 env reference 路径，文件无需为 JSON）
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      writeFile(dir, 'flow-kit/prompts/1-requirement.md', '# 阶段 1 · REQUIREMENT\n\n## 角色\n\n你是 Requirer。\n');
      writeState(dir, baseState('open'));
      fs.mkdirSync(path.join(dir, '.specs', CHANGE_ID), { recursive: true });
      const res = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md', '--prompt', 'flow-kit/prompts/1-requirement.md', '--templates', 'CHANGE.md,REQUIREMENT.md']);
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
      // 与 节点协议映射表 basename 精确比对必然失败——机制实际不可用，已修复）。
      // 多 --prompt 时取首个（旧读法只认单值，保持逐字可读）。
      if (marker.protocol !== '0-change.md') {
        throw new Error('标记 protocol 应为 --prompt 参数的 basename 0-change.md: ' + JSON.stringify(marker));
      }
      // 多 --prompt 全部被记录（缺陷修复前只取第一个，第二个声明被静默丢弃——覆盖判据因此永远
      // 看不到它）。顺序 = 命令行出现顺序，供报文按序点名。
      if (!Array.isArray(marker.protocols) || marker.protocols.join(',') !== '0-change.md,1-requirement.md') {
        throw new Error('标记 protocols 应记录全部 --prompt 的 basename（0-change.md,1-requirement.md）: ' + JSON.stringify(marker));
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
      const sl = runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change', '--templates', 'CHANGE.md,REQUIREMENT.md']);
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

  // 102: exit 协议声明标记校验（AC-4）+ 真实链路集成。判定从「任一命中即通过」改为「全部覆盖」：
  // 节点该读的每个协议文件（NODE_PROTOCOL_FILES，open = 0-change / 1-requirement）都必须被某个标记
  // 覆盖，协议声明的 requiredSkillCalls（enforcement=guarded）也各自要有标记。新 change 缺任一 →
  // BLOCKED 并逐项点名缺哪个协议文件 / 哪个必需技能；旧 change → WARN 渐进（既有 change 不卡死）。
  // 旧单值标记（只有 protocol、没有 protocols）照样计入覆盖——旧写入形态不被新规则判死。
  // ⑧ 另补一格出口**链序**（见该格头注）：同一个「缺声明」既表现为证据清单缺 required-skill、也
  // 表现为标记没覆盖必需项，两段报文的先后是链序的直接读数。
  {
    name: '102 exit 协议标记校验：全部覆盖通过 / 少声明必红点名 / 旧 change 只 WARN / 旧单值标记可读 / 证据门先于覆盖门（AC-4）',
    run: (dir) => {
      const loadsDir = path.join(dir, '.specs', CHANGE_ID, '.skill-loads');
      const markerFile = (skill) => path.join(loadsDir, 'open-' + skill + '.json');
      const readMarker = (skill) => JSON.parse(fs.readFileSync(markerFile(skill), 'utf8'));
      // 新 change 夹具（init 标记 = newChange:true）+ entry 已记录（否则先被 entry 记录门拦下，
      // 测不到声明门本身）
      const newChangeState = () => {
        const st = baseState('open');
        st.evidence.open = { summary: 'intake complete' };
        st.newChange = true;
        st.enteredNodes = ['open'];
        return st;
      };
      writeState(dir, newChangeState());
      // 新 change 下入口文档另有首部门（Change ID 必在场）——夹具让它在场，才能把断言收敛到声明门上
      writeFile(dir, '.specs/' + CHANGE_ID + '/CHANGE.md',
        '# CHANGE: 声明门夹具\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## Why\n\n夹具。\n\n## 范围\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REQUIREMENT.md',
        '# REQUIREMENT: 声明门夹具\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## 用户故事\n\n- US-1\n\n## 验收准则（AC）\n\n- Given a When b Then c\n');
      // 场景内 flow-kit/prompts/ 提示文件（真实 skill-load --prompt 指向——归属校验仅查前缀不读内容）
      writeFile(dir, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
      writeFile(dir, 'flow-kit/prompts/1-requirement.md', '# 阶段 1 · REQUIREMENT\n\n## 角色\n\n你是 Requirer。\n');
      // ① 机制已激活（.skill-loads/ 存在）但无 open-* 标记（仅他节点标记）→ BLOCKED，逐项点名
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/design-flow-comet-design.json',
        JSON.stringify({ node: 'design', skill: 'flow-comet-design', protocol: '2-design.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resNoMarker = runGuard(['exit', 'open'], dir);
      assertExit(resNoMarker, 1);
      assertOut(resNoMarker, 'BLOCKED');
      assertOut(resNoMarker, 'exit 缺协议声明标记');
      assertOut(resNoMarker, '缺协议文件: 0-change.md、1-requirement.md');
      assertOut(resNoMarker, '缺必需技能声明: flow-comet-change、flow-comet-requirement');
      // ② 少声明（新 change，真实链路）——只声明一个协议文件、只覆盖一个必需技能 → BLOCKED 并
      //    逐项点名缺哪个协议文件、哪个必需技能。缺陷形态：门禁把「该读的协议清单」当允许集合、
      //    任一命中即通过 → 这条会 exit 0（第二个声明被静默丢弃，覆盖缺口看不见）
      assertExit(runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md', '--templates', 'CHANGE.md,REQUIREMENT.md']), 0);
      const resPartial = runGuard(['exit', 'open'], dir);
      assertExit(resPartial, 1);
      assertOut(resPartial, 'BLOCKED');
      assertOut(resPartial, 'exit 缺协议声明标记');
      assertOut(resPartial, '缺协议文件: 1-requirement.md');
      assertOut(resPartial, '缺必需技能声明: flow-comet-requirement');
      assertNotOut(resPartial, 'ALL CHECKS PASSED');
      // ③ 全部声明（新 change，真实链路）→ exit 通过。一条命令多个 --prompt：两份协议都记进同一个
      //    标记的 protocols 数组（protocol 保留首个 basename 供旧读法）
      assertExit(runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change', '--prompt', 'flow-kit/prompts/0-change.md', '--prompt', 'flow-kit/prompts/1-requirement.md', '--templates', 'CHANGE.md,REQUIREMENT.md']), 0);
      const multiMarker = readMarker('flow-comet-change');
      if (multiMarker.protocol !== '0-change.md' || !Array.isArray(multiMarker.protocols)
        || multiMarker.protocols.join(',') !== '0-change.md,1-requirement.md') {
        throw new Error('多 --prompt 应全部记入 protocols 且 protocol 保留首个: ' + JSON.stringify(multiMarker));
      }
      assertExit(runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-requirement', '--prompt', 'flow-kit/prompts/1-requirement.md', '--templates', 'CHANGE.md,REQUIREMENT.md']), 0);
      const resPass = runGuard(['exit', 'open'], dir);
      assertExit(resPass, 0);
      assertOut(resPass, 'ALL CHECKS PASSED');
      assertNotOut(resPass, 'BLOCKED');
      assertNotOut(resPass, 'SKILL-LOAD WARN');
      // ④ 旧单值标记仍可读——只有 protocol、没有 protocols 的两条标记（收紧前的写入形态）各覆盖
      //    一份协议文件：覆盖判据照样把它们算进去 → exit 通过
      fs.rmSync(loadsDir, { recursive: true, force: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', templates: ['CHANGE', 'REQUIREMENT'], at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-requirement.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-requirement', protocol: '1-requirement.md', templates: ['CHANGE', 'REQUIREMENT'], at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resLegacy = runGuard(['exit', 'open'], dir);
      assertExit(resLegacy, 0);
      assertOut(resLegacy, 'ALL CHECKS PASSED');
      assertNotOut(resLegacy, 'BLOCKED');
      // ⑤ 旧 change（无 newChange）：同样的「少声明」构造 → 只 WARN 不阻断（不收死既有 change），
      //    报文与 ② 同样逐项点名
      const legacyState = baseState('open');
      legacyState.evidence.open = { summary: 'intake complete' };
      writeState(dir, legacyState);
      fs.rmSync(loadsDir, { recursive: true, force: true });
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '0-change.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resWarn = runGuard(['exit', 'open'], dir);
      assertExit(resWarn, 0);
      assertOut(resWarn, 'SKILL-LOAD WARN');
      assertOut(resWarn, '缺协议文件: 1-requirement.md');
      assertOut(resWarn, '缺必需技能声明: flow-comet-requirement');
      assertOut(resWarn, 'ALL CHECKS PASSED');
      // ⑥ 未传 --prompt（protocol = null / protocols 空）→ 两个必需技能都在场，但没有协议文件被
      //    覆盖 → BLOCKED（fail-closed：声明了技能不等于读了两份协议）
      writeState(dir, newChangeState());
      fs.rmSync(loadsDir, { recursive: true, force: true });
      assertExit(runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-change', '--templates', 'CHANGE.md,REQUIREMENT.md']), 0);
      assertExit(runStateWithProtocol(dir, ['skill-load', 'open', 'flow-comet-requirement', '--templates', 'CHANGE.md,REQUIREMENT.md']), 0);
      const markerNull = readMarker('flow-comet-change');
      if (markerNull.protocol !== null || !Array.isArray(markerNull.protocols) || markerNull.protocols.length !== 0) {
        throw new Error('未传 --prompt 时 protocol 应为 null、protocols 应为空数组: ' + JSON.stringify(markerNull));
      }
      const resNull = runGuard(['exit', 'open'], dir);
      assertExit(resNull, 1);
      assertOut(resNull, 'BLOCKED');
      assertOut(resNull, 'exit 缺协议声明标记');
      assertOut(resNull, '缺协议文件: 0-change.md、1-requirement.md');
      assertNotOut(resNull, '缺必需技能声明');
      // ⑦ 损坏标记（protocol / protocols 均非协议集 basename）→ 该文件不算被覆盖 → BLOCKED
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-change.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-change', protocol: '9-other.md', protocols: ['9-other.md'], at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      writeFile(dir, '.specs/' + CHANGE_ID + '/.skill-loads/open-flow-comet-requirement.json',
        JSON.stringify({ node: 'open', skill: 'flow-comet-requirement', protocol: '1-requirement.md', at: '2026-08-01T00:00:00.000Z' }, null, 2) + '\n');
      const resCorrupt = runGuard(['exit', 'open'], dir);
      assertExit(resCorrupt, 1);
      assertOut(resCorrupt, 'BLOCKED');
      assertOut(resCorrupt, 'exit 缺协议声明标记');
      assertOut(resCorrupt, '缺协议文件: 0-change.md');
      assertNotOut(resCorrupt, '缺必需技能声明');
      // ⑧ 出口链序：同一个「缺声明」既可能是证据清单缺 required-skill（证据门的报文给出该绑定的
      //    补齐命令），也可能是声明标记没覆盖必需项（覆盖门逐项点名缺哪个技能）。两者都说同一件事
      //    时，证据门必须先说话、覆盖门收口——颠倒顺序会让执行者只看到「缺协议声明标记」，看不到
      //    证据门指出的那条绑定。反向构造：把 workflow-guard 出口链上的两处调用对调（覆盖门排到
      //    证据族之前）→ 本格第一趟先报覆盖门 → 本格 RED。
      //    两段报文**不可能**同处一趟输出（任一命中即 process.exit），故按两趟真实顺序断言：第一趟
      //    只有证据门说话，补齐证据后第二趟才轮到覆盖门；「行序」取两趟输出拼接后的位置。
      //    夹具根独立（design 出口夹具与前七格的 open 夹具互不污染），协议副本按套件同一表达式预置。
      const chainRoot = makeTmp();
      try {
        fs.mkdirSync(path.dirname(scenarioProtocolPath(chainRoot)), { recursive: true });
        fs.copyFileSync(BUILTIN_PROTOCOL_SOURCE, scenarioProtocolPath(chainRoot));
        writeDesignExitFixture(chainRoot, {
          newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: false,
        });
        // 先写一条真实声明（design 技能 + 2-design.md）：机制已激活，缺口收敛到 ui-design 这一条绑定
        assertExit(runState(['skill-load', 'design', 'flow-comet-design', '--prompt', 'flow-kit/prompts/2-design.md', '--templates', 'DESIGN.md'], chainRoot), 0);
        const bothMissing = runGuard(['exit', 'design'], chainRoot);
        assertExit(bothMissing, 1);
        assertOut(bothMissing, 'BLOCKED: missing required Skill evidence: required-skill:design.flow-comet-ui-design');
        assertNotOut(bothMissing, '缺协议声明标记');
        // 第二趟：证据补齐（同一夹具的 declareUiDesign），声明覆盖仍缺 → 覆盖门收口并点名该技能
        writeDesignExitFixture(chainRoot, {
          newChange: true, visualTone: VISUAL_TONE_APPLICABLE, uiDesign: true, declareUiDesign: true,
        });
        const markerMissing = runGuard(['exit', 'design'], chainRoot);
        assertExit(markerMissing, 1);
        assertOut(markerMissing, '缺协议声明标记');
        assertOut(markerMissing, '缺必需技能声明: flow-comet-ui-design');
        // 本格的核心断言：两段报文都在场，且「证据门」那段的行序早于「缺协议声明标记」那行——覆盖门
        // 的报文出现即证明链条已越过证据门（证据门命中会 process.exit，覆盖门就不会有输出）。
        const chainText = bothMissing.output + '\n' + markerMissing.output;
        const evidenceAt = chainText.indexOf('missing required Skill evidence');
        const markerAt = chainText.indexOf('缺协议声明标记');
        if (evidenceAt < 0 || markerAt < 0 || evidenceAt > markerAt) {
          throw new Error('链序：证据门报文应在「缺协议声明标记」之前（两段报文都必须在场）: '
            + JSON.stringify({ evidenceAt, markerAt }));
        }
      } finally {
        cleanupTmpDir(chainRoot);
      }
      // ⑨ 恢复段命令的照抄闭合（本场景的核心扩展；不新增场景条目）：open 与 review 各删声明与证据 →
      // exit 被拦 → **逐字照抄**报文给出的每条命令 → 同一 exit 通过。缺陷形态：恢复段第一步只声明
      // 实现技能 + 首份协议、且不带模板清单（声明覆盖门的补齐命令则只给缺项、同样漏模板），照抄完
      // 同一 exit 仍被覆盖门点名缺另一份协议文件与另一个必需技能——两处各给一半。
      assertDeclarationRecoveryRoundTrip({
        node: 'open',
        skills: ['flow-comet-change', 'flow-comet-requirement'],
        prompts: ['flow-kit/prompts/0-change.md', 'flow-kit/prompts/1-requirement.md'],
        templates: ['CHANGE.md', 'REQUIREMENT.md'],
        fixture: (root) => {
          const st = newChangeState();
          delete st.evidence.open; // 证据整体缺席：恢复段必须把「先声明」这一步一并给全
          writeState(root, st);
          writeFile(root, '.specs/' + CHANGE_ID + '/CHANGE.md',
            '# CHANGE: 声明门夹具\n\n- **Change ID**: ' + CHANGE_ID + '\n\n## Why\n\n夹具。\n\n## 范围\n');
          writeFile(root, '.specs/' + CHANGE_ID + '/REQUIREMENT.md',
            '# REQUIREMENT: 声明门夹具\n\n- **Change ID**: ' + CHANGE_ID
            + '\n\n## 用户故事\n\n- US-1\n\n## 验收准则（AC）\n\n- Given a When b Then c\n');
          writeFile(root, 'flow-kit/prompts/0-change.md', '# 阶段 0 · CHANGE\n\n## 角色\n\n你是 Changeer。\n');
          writeFile(root, 'flow-kit/prompts/1-requirement.md', '# 阶段 1 · REQUIREMENT\n\n## 角色\n\n你是 Requirer。\n');
        },
      });
      assertDeclarationRecoveryRoundTrip({
        node: 'review',
        skills: ['flow-comet-review', 'flow-comet-test'],
        prompts: ['flow-kit/prompts/6-review.md', 'flow-kit/prompts/5-test.md'],
        templates: ['REVIEW.md', 'TEST.md'],
        fixture: (root) => {
          const st = baseState('review');
          st.newChange = true;
          st.enteredNodes = ['review'];
          writeState(root, st);
          writeFile(root, '.specs/' + CHANGE_ID + '/REVIEW.md',
            '# REVIEW\n\n## Critical\n\n无。\n\n## 发现\n\n- **问题B**: 某处问题 **[已修]**\n'
            + '  - **Symptom**: 具体现象\n  - **Source**: 某书某节\n'
            + '  - **Consequence**: 若不修会怎样\n  - **Remedy**: 怎么改\n\n## 结论\n\n通过\n');
          writeFile(root, 'flow-kit/prompts/6-review.md', '# 阶段 6 · REVIEW\n\n## 角色\n\n你是 Reviewer。\n');
          writeFile(root, 'flow-kit/prompts/5-test.md', '# 阶段 5 · TEST\n\n## 角色\n\n你是 Tester。\n');
        },
      });
      // ⑩ 前端 design 的证据门照抄闭合（不新增场景条目）：证据缺一条 gated 绑定（ui-design）时，
      //    恢复段必须给全「真实声明 + 带该 required-skill 的 record」两步，照抄后同一 exit 通过。
      assertFrontendDesignEvidenceRoundTrip();
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

  // 105: 计数一致性自检同步（AC-8 / AC-14）+ 公开面机器字段名黑名单 + 结构预检命令锚 + 权威源设计
  // 形态锚（in-place 扩展，不新增场景）——组文件里的场景数或系统测试集项数变更时，受检文件须同步
  // （场景数：ALL n SCENARIOS PASSED / n scenarios / n 场景 / n/n 变体；项数：n/n / n items / n 项
  // 变体）。本场景读取权威源仓库的受检文件断言含当前计数变体——文档漏同步或条目缺失（幽灵条目）即
  // RED；与底部自检共用同一实现（countSyncProblems），两处判据不会漂移。
  // 公开面口径：用户阅读面不得直写机器状态字段名（黑名单），被明确标注为状态输出示例的围栏块
  // 放行；机制 / 用法 / 排障三份文档 × 中英都必须出现 `--preflight`（新增公开命令不得无锚）。
  // 判别力由反向构造证明：注入键名、抽掉命令锚 ⇒ 必报；标注示例块放行、撤掉标注 ⇒ 再报。
  // 形态分派（只按载体形态判，不猜）：安装副本（无 .flow-comet/ 技能树）与分发包（技能树在、docs/ +
  // CONTRIBUTING.md + .github/ 三者俱缺）都没有公开文档面——跳过且**可见**（SKIP = 未校验，不是通过）；
  // 只有权威源检出才跑公开面判据与设计形态锚。形态边界由 assertPublicFaceShapeProbes 自己钉住。
  {
    name: '105 计数一致性自检同步 + 公开面机器字段名黑名单 + --preflight 锚 + 声明命令册子锚 + 权威源设计形态锚（AC-8 / AC-14）',
    run: async (dir) => {
      // 声明命令的册子锚：不按载体形态分派（两册随技能包一起分发，装到哪都该给出同一组命令）——
      // 这也是「缺声明时报文给出的命令」与册子口径一致的那条机检（两边各给一半时必有一侧缺锚）。
      const bookProblems = declarationBookProblems(path.join(SCRIPTS_DIR, '..'));
      if (bookProblems.length > 0) throw new Error(bookProblems.join('；'));
      // 权威源判定走 lib 的同一份探针（authoritativeSourceAt：与真实检出同一技能树锚，可带受检根）——
      // 本场景不再自持一份前置判定，形态问题只有一处说了算。
      if (!authoritativeSourceAt()) {
        // 安装副本：无公开文档面，也无「权威源打印设计形态」这回事——跳过必须可见。
        console.log('SKIP: 公开面与设计形态判据（安装副本检出：本检出无 .flow-comet/skills/flow-comet/SKILL.md）'
          + '——本次未校验公开面键名黑名单 / 命令锚，也未校验恢复命令的脚本路径是否为权威源设计形态'
          + '（SKIP = 未校验，不是通过）');
        return;
      }
      // 形态判据自己的判别力（纯夹具，先于任何派生）
      assertPublicFaceShapeProbes(dir);
      // 设计形态锚：只读打印出来的恢复段，要求命令的脚本路径逐字为设计形态、步骤按执行顺序。仅在
      // **正在跑权威源脚本**时适用；
      // 跑安装副本套件时，副本按运行根推导出的路径才是那种载体的正确形态，不属于本锚范围——跳过必须可见。
      if (RUNS_FROM_AUTHORITATIVE_SCRIPTS) {
        assertDesignFormRecoveryPath(dir);
      } else {
        console.log('SKIP: 权威源设计形态锚（当前运行的是安装副本脚本：' + path.relative(REPO_ROOT, SCRIPTS_DIR)
          + '）——安装副本按运行根推导路径属另一种载体的正确形态，本锚只在权威源脚本下适用（SKIP = 未校验，不是通过）');
      }
      // 分发包形态（npm 包 / 安装副本）：公开面载体三者俱缺（docs/ + CONTRIBUTING.md + .github/）⇒
      // 公开面无从派生，也就无从检查。跳过的就是**公开面这一整块**（含计数同步——它数的文件同样不随
      // 包分发）；计数面在底部自检里另有一次独立执行，不会因这条跳过而整体失踪。判据本体在 lib
      // （publicFaceDocsAbsent）：只按 docs/ 在不在分流，会把「docs/ 被裁掉、其余公开面还在」的检出
      // 一并放过——那正是整块判据静默失效的形态。
      if (publicFaceDocsAbsent(REPO_ROOT)) {
        console.log(PUBLIC_FACE_SELF_CHECK_SKIP_NOTICE);
        return;
      }
      const problems = [...await countSyncProblems()];
      const publicFace = readPublicFaceTexts();
      problems.push(...publicFaceMachineProblems(publicFace));
      // 反向构造（同一判据驱动）：探针在快照副本上作业，真实断言与探针调用同一个函数。
      const mutated = (rel, mutate) => {
        const text = publicFace.texts.get(rel);
        if (typeof text !== 'string') return null; // 缺失已由真实判据报告，避免探针掩盖真实原因
        const next = mutate(text);
        return next === text ? null : { ...publicFace, texts: new Map(publicFace.texts).set(rel, next) };
      };
      // 受检面来自派生（映射 + 根目录扫描）：按 GitHub 惯例放在根目录的公开文件若被漏在受检面之外，
      // 就没有注入点——这里直接判红，不让探针静默跳过。探针必须是**只有根目录扫描能贡献**的文件：
      // 映射已登记的路径（SECURITY.md 就由 security 主题提供）在根目录扫描缺席时仍在面内，取它做
      // 探针等于空断言，所以在选型处就对这条前提本身设防。
      const ROOT_FACE_PROBE = 'CODE_OF_CONDUCT.md';
      const mappedFacePaths = new Set([...publicFaceTopicPairs(readPublicFaceAuthorityMap()).values()].flat());
      if (mappedFacePaths.has(ROOT_FACE_PROBE)) {
        throw new Error('根目录探针失去判别力（' + ROOT_FACE_PROBE + ' 已由权威映射提供，'
          + '根目录扫描缺席时它仍在受检面内）');
      }
      if (!publicFace.texts.has(ROOT_FACE_PROBE)) {
        throw new Error('受检面漏了根目录公开文档（' + ROOT_FACE_PROBE + ' 未纳入派生的受检面）');
      }
      const probes = [
        ['注入机器字段名（用法册）', mutated('docs/USAGE.md', (text) => text + '\n`currentNode`\n'), '直写了机器状态字段名'],
        ['注入 evidence 键名（机制册）', mutated('docs/MECHANISM.md', (text) => text + '\n`evidence`\n'), '直写了机器状态字段名 evidence'],
        // 散文形态（不带反引号）：字段名不写反引号同样是把它当成用户面契约——这是黑名单原先的盲区
        ['注入 evidence 散文名（机制册，不带反引号）',
          mutated('docs/MECHANISM.md', (text) => text + '\nthe evidence field is written by record\n'),
          '直写了机器状态字段名 evidence'],
        ['注入 evidence 散文名（机制册，带反引号）',
          mutated('docs/MECHANISM.md', (text) => text + '\nthe `evidence` field is written by record\n'),
          '直写了机器状态字段名 evidence'],
        ['注入字段族键名（机制册）', mutated('docs/MECHANISM.md', (text) => text + '\n`verifyFailuresByChange`\n'), '直写了机器状态字段名 verifyFailuresByChange'],
        ['抽掉命令锚（排障册中文）', mutated('docs/TROUBLESHOOTING-zh.md', (text) => text.split('--preflight').join('')), '缺「--preflight」'],
        ['注入机器字段名（根目录公开文档）', mutated(ROOT_FACE_PROBE, (text) => text + '\n`currentNode`\n'), '直写了机器状态字段名'],
      ];
      for (const [label, texts, expected] of probes) {
        if (texts === null) continue;
        if (!publicFaceMachineProblems(texts).some((p) => p.includes(expected))) {
          throw new Error('反向构造判别力缺失（' + label + ' 未被判违规）');
        }
      }
      // 允许段白名单双向判别：同一段键名，标注为状态输出示例时放行，撤掉标注后必须报。
      const exampleBlock = (heading) => '\n' + heading + '\n\n```json\n{ "currentNode": "review" }\n```\n';
      const allowed = mutated('docs/MECHANISM.md', (text) => text + exampleBlock('### 状态输出示例'));
      if (allowed && publicFaceMachineProblems(allowed).some((p) => p.includes('docs/MECHANISM.md') && p.includes('直写了机器状态字段名'))) {
        throw new Error('允许段白名单失效（标注为状态输出示例的围栏块内键名被误判违规）');
      }
      const unmarked = mutated('docs/MECHANISM.md', (text) => text + exampleBlock('### 输出草稿'));
      if (unmarked && !publicFaceMachineProblems(unmarked).some((p) => p.includes('docs/MECHANISM.md') && p.includes('直写了机器状态字段名'))) {
        throw new Error('允许段白名单判别力缺失（未标注为状态输出示例的围栏块内键名未被判违规）');
      }
      // 黑名单扩容的判别力逐名验：加进数组不算数，每个名字都要真的命中——漏登记的键照样能走私进来。
      const WIDENED_KEYS = ['completedNodes', 'enteredNodes', 'directOverride', 'newChange'];
      const widened = mutated('docs/MECHANISM.md',
        (text) => text + '\n' + WIDENED_KEYS.map((name) => '`' + name + '`').join(' ') + '\n');
      for (const name of WIDENED_KEYS) {
        if (widened && !publicFaceMachineProblems(widened)
          .some((p) => p.includes('直写了机器状态字段名 ' + name))) {
          throw new Error('机器字段黑名单漏了 ' + name + '（注入后未被判违规）');
        }
      }
      // 放行规则的反向判别：黑名单扩容最容易砸到的既有句子——代码位置引用（state.evidence）与普通
      // 英文名词用法（the evidence recorded for the node）都必须放行，否则判据只能靠改文档来变绿。
      const released = mutated('docs/MECHANISM.md', (text) => text
        + '\n位置引用：恢复记录写在 state.evidence 下。\n'
        + '\nThe evidence recorded for the node is what the exit reads.\n');
      if (released && publicFaceMachineProblems(released)
        .some((p) => p.includes('docs/MECHANISM.md') && p.includes('直写了机器状态字段名'))) {
        throw new Error('放行规则失效（state.evidence 位置引用 / 普通英文 evidence 被误判为字段名直写）');
      }
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
      // ②④ 共用：本夹具下允许出现的 REVIEW WARN 类别由调用方逐条枚举，**枚举外的行一律算失败**——
      // 逐条 assertNotOut 只挡得住被点名的那一类，夹具上再冒出一类无关告警时不会红（判别力退化）。
      const reviewWarnsOutside = (res, allowed) => String(res.output || '').split(/\r?\n/)
        .filter((line) => line.includes('REVIEW WARN') && !allowed.some((marker) => line.includes(marker)));
      // ① 发现区 Minor 条目无处置标记 → REVIEW WARN + 通过（渐进不阻断）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n无\n\n### Major\n\n无\n\n### Minor\n\n- **m-1 · 示例发现**：描述（未处置）\n\n## 结论\n\n通过\n');
      const res = runGuard(['exit', 'review'], dir);
      assertExit(res, 0);
      assertOut(res, 'REVIEW WARN');
      assertOut(res, 'ALL CHECKS PASSED');
      // ② 同一条目带 [转待办] 处置标记 → 不再报「缺处置状态标记」（该条已有处置去向；Minor 延期
      // 另受裁决/判据门槛约束，旧 change 只 WARN 不阻断）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n### Critical\n\n无\n\n### Major\n\n无\n\n### Minor\n\n- **m-1 · 示例发现**：描述 [转待办]\n\n## 结论\n\n通过\n');
      const res2 = runGuard(['exit', 'review'], dir);
      assertExit(res2, 0);
      // [转待办] 另触发延期裁决与 Minor 判据两道门——这两类之外不得出现任何 REVIEW WARN
      // （含「缺处置状态标记」：该条已有处置去向，误报即本场景的回归）。
      const outside2 = reviewWarnsOutside(res2, ['缺少用户裁决记录', '缺 `判 Minor：` 行']);
      assertTrue(outside2.length === 0, '② 出现枚举外的 REVIEW WARN（未知告警类别）:\n' + outside2.join('\n'));
      assertOut(res2, 'ALL CHECKS PASSED');
      // ③ 有序条目（1. **...**）与无序同口径——缺处置标记 → 旧 change 仍渐进 REVIEW WARN
      // （修复前 .filter((item) => !item.ordered) 使有序条目静默通过 = RED）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n1. **m-2 · 有序未处置**：某处问题，未给出任何处置结论，描述足够长以避免内容不足\n\n## 结论\n\n通过\n');
      const resOrdered = runGuard(['exit', 'review'], dir);
      assertExit(resOrdered, 0);
      assertOut(resOrdered, 'REVIEW WARN');
      assertNotOut(resOrdered, 'BLOCKED');
      // ④ 有序 Minor 带 [转待办] → 无「缺处置状态标记」告警（有序条目接入校验不误报已处置项）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md',
        '# REVIEW\n\n## 发现\n\n1. **m-3 · 有序小项**：某处小问题，已登记下一 change 跟踪处置 [转待办]\n\n## 结论\n\n通过\n');
      const resOrderedOk = runGuard(['exit', 'review'], dir);
      assertExit(resOrderedOk, 0);
      // 有序条目未标严重度 → 只允许延期待裁决一类告警（Minor 判据门对未标严重度的条目不适用）。
      const outsideOrdered = reviewWarnsOutside(resOrderedOk, ['缺少用户裁决记录']);
      assertTrue(outsideOrdered.length === 0, '④ 出现枚举外的 REVIEW WARN（未知告警类别）:\n' + outsideOrdered.join('\n'));
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
  // execute 阶段完成 [P] 是越权委托痕迹）;completedNodes 含
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
  // exit --apply）——防 resume 自锁（机器推导出的节点没有脚本恢复通道）
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

  // 123: init 在无提交(空)仓库时输出提示且跳过分支创建——提示与行为必须一致：
  // 警告之后仍 checkout -b 实际创建分支，就是声称与行为矛盾
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
  // 并内扩延期裁决门禁（覆盖任何严重度，含 Minor）：无用户裁决 BLOCK / 同段或其它段落裁决（由
  // [升级] 承接）放行 / 有裁决但缺 [升级] 承接仍 BLOCK；Minor 另须在条目块内自证判据
  // 「判 Minor：<一句话理由>」——判据落在**判定当时**，与处置标记无关（[已修]/[升级]/[转待办]
  // 一律要；缺则改判 Major，默认 Major）。
  {
    name: '125 review exit BLOCKED：新 change 处置标记缺失 + 延期待裁决（R1）',
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
      // 子断言:Minor [转待办] 与 Major 同口径——无用户裁决记录 → BLOCKED(报文点名条目 + 给出
      // 裁决记录形态；修复前 Minor 可自行延期直接放行 = RED)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-1 · 小项**：某处小问题 [转待办]\n  判 Minor：仅影响日志措辞，不改变行为与接口\n\n## 结论\n\n通过\n');
      const resMinor = runGuard(['exit', 'review'], dir);
      assertExit(resMinor, 1);
      assertOut(resMinor, 'BLOCKED');
      assertOut(resMinor, 'm-1 · 小项');
      assertOut(resMinor, '用户裁决：接受延期');
      // 子断言:同一条目补上裁决记录（指向该条目 + [升级] 承接）→ 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-1 · 小项**：某处小问题 [升级] [转待办]\n  判 Minor：仅影响日志措辞，不改变行为与接口\n\n- 用户裁决：接受延期 —— 发现 m-1：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resMinorAdjudicated = runGuard(['exit', 'review'], dir);
      assertExit(resMinorAdjudicated, 0);
      assertOut(resMinorAdjudicated, 'ALL CHECKS PASSED');
      assertNotOut(resMinorAdjudicated, 'BLOCKED');
      // 子断言:Minor 条目缺判定理由「判 Minor：<理由>」→ BLOCKED(报文点名条目 + 给出形态)；
      // 补上判据后放行(裁决记录仍在，缺的只是 Minor 判据本身)
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-5 · 缺判据的小项**：某处小问题 [升级] [转待办]\n\n- 用户裁决：接受延期 —— 发现 m-5：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resMinorNoReason = runGuard(['exit', 'review'], dir);
      assertExit(resMinorNoReason, 1);
      assertOut(resMinorNoReason, 'BLOCKED');
      assertOut(resMinorNoReason, 'm-5 · 缺判据的小项');
      assertOut(resMinorNoReason, '判 Minor：');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-5 · 缺判据的小项**：某处小问题 [升级] [转待办]\n  判 Minor：只影响内部诊断输出\n\n- 用户裁决：接受延期 —— 发现 m-5：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resMinorReasonOk = runGuard(['exit', 'review'], dir);
      assertExit(resMinorReasonOk, 0);
      assertOut(resMinorReasonOk, 'ALL CHECKS PASSED');
      // 子断言(R2 判定时门禁)：判为 Minor 就要在**判定当时**自证判据，与处置标记无关——[已修]
      // 的 Minor 缺「判 Minor：」行 → BLOCKED（修复前只查 [转待办]，[已修]/[升级] 的 Minor 直接
      // 放行 = RED）；报文点名条目 + 严重度 + 缺行 + 正确形态 + 「改判 Major」兜底。
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-9 · 已修但缺判据的小项**：某处小问题 [已修]\n\n## 结论\n\n通过\n');
      const resMinorFixed = runGuard(['exit', 'review'], dir);
      assertExit(resMinorFixed, 1);
      assertOut(resMinorFixed, 'BLOCKED');
      assertOut(resMinorFixed, 'm-9 · 已修但缺判据的小项');
      assertOut(resMinorFixed, '（Minor）');
      assertOut(resMinorFixed, '缺 `判 Minor：` 行');
      assertOut(resMinorFixed, '改判 Major');
      // 补上判据行 → 放行（[已修] 不是「没有 Minor 判定」的理由）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-9 · 已修但缺判据的小项**：某处小问题 [已修]\n  判 Minor：仅影响日志措辞，不改变行为与接口\n\n## 结论\n\n通过\n');
      const resMinorFixedOk = runGuard(['exit', 'review'], dir);
      assertExit(resMinorFixedOk, 0);
      assertOut(resMinorFixedOk, 'ALL CHECKS PASSED');
      // [升级] 的 Minor 同形态：缺判据 → BLOCKED；补上 → 放行
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-10 · 升级但缺判据的小项**：某处小问题 [升级]\n\n## 结论\n\n通过\n');
      const resMinorEscalated = runGuard(['exit', 'review'], dir);
      assertExit(resMinorEscalated, 1);
      assertOut(resMinorEscalated, 'BLOCKED');
      assertOut(resMinorEscalated, 'm-10 · 升级但缺判据的小项');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-10 · 升级但缺判据的小项**：某处小问题 [升级]\n  判 Minor：只涉及命名一致性\n\n## 结论\n\n通过\n');
      const resMinorEscalatedOk = runGuard(['exit', 'review'], dir);
      assertExit(resMinorEscalatedOk, 0);
      assertOut(resMinorEscalatedOk, 'ALL CHECKS PASSED');
      // 既有 [转待办] 不回归：R2 扩面不取代 R1——只补判据、无裁决 → 仍 BLOCKED（裁决门独立，
      // 判据门不再报）；补裁决 + [升级] 承接后才放行（双重约束各自在场）。
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-11 · 延期缺判据的小项**：某处小问题 [转待办]\n\n## 结论\n\n通过\n');
      const resMinorDeferredNoReason = runGuard(['exit', 'review'], dir);
      assertExit(resMinorDeferredNoReason, 1);
      assertOut(resMinorDeferredNoReason, '用户裁决');
      assertOut(resMinorDeferredNoReason, '判 Minor：');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-11 · 延期缺判据的小项**：某处小问题 [转待办]\n  判 Minor：仅影响内部日志\n\n## 结论\n\n通过\n');
      const resMinorDeferredReasonOnly = runGuard(['exit', 'review'], dir);
      assertExit(resMinorDeferredReasonOnly, 1);
      assertOut(resMinorDeferredReasonOnly, '用户裁决');
      assertNotOut(resMinorDeferredReasonOnly, '判 Minor：');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-11 · 延期缺判据的小项**：某处小问题 [升级] [转待办]\n  判 Minor：仅影响内部日志\n\n- 用户裁决：接受延期 —— 发现 m-11：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resMinorDeferredOk = runGuard(['exit', 'review'], dir);
      assertExit(resMinorDeferredOk, 0);
      assertOut(resMinorDeferredOk, 'ALL CHECKS PASSED');
      // 子断言(R2 覆盖边界)：Major 的任何处置都不受判据门影响——[已修] / [升级] 均不要求
      // 「判 Minor：」行（[转待办] + 用户裁决的 Major 由上面的 F2 覆盖）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Major\n\n- **F11 · 已修的大项**：某处问题 [已修]\n- **F12 · 升级的大项**：另一处问题 [升级]\n\n## 结论\n\n通过\n');
      const resMajorDisposed = runGuard(['exit', 'review'], dir);
      assertExit(resMajorDisposed, 0);
      assertOut(resMajorDisposed, 'ALL CHECKS PASSED');
      assertNotOut(resMajorDisposed, '判 Minor：');
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
      // 子断言:条目正文引用 [Major] 标签字样（自身 [转待办]）→ 严重度以条目自身标题/行首为准，
      // 正文标签不改变本条判定（报文按「未标严重度」点名，不因正文出现 [Major] 就升格为 Major）；
      // 补上裁决记录后放行——延期门禁对任何严重度生效，处置由裁决记录承接
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n- **m-2 · 引用 Major 的小项**：本条与 [Major] F1 项不同，是独立问题 [转待办]\n\n## 结论\n\n通过\n');
      const resCited = runGuard(['exit', 'review'], dir);
      assertExit(resCited, 1);
      assertOut(resCited, '未标严重度');
      assertNotOut(resCited, '（Major）');
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n- **m-2 · 引用 Major 的小项**：本条与 [Major] F1 项不同，是独立问题 [升级] [转待办]\n\n- 用户裁决：接受延期 —— 发现 m-2：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resCitedOk = runGuard(['exit', 'review'], dir);
      assertExit(resCitedOk, 0);
      assertOut(resCitedOk, 'ALL CHECKS PASSED');
      assertNotOut(resCitedOk, 'BLOCKED');
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
        + '### Minor\n\n- **m-4 · 小项**：另一个独立问题 [已修]\n  判 Minor：仅措辞问题\n\n## 结论\n\n通过\n');
      const resMidParagraph = runGuard(['exit', 'review'], dir);
      assertExit(resMidParagraph, 0);
      assertOut(resMidParagraph, 'ALL CHECKS PASSED');
      // 子断言:文档口径与实现对齐——review SKILL 须写明「单独段落（指向条目 + [升级] 承接）」
      // 也是合法裁决位置，避免文档只写「同段或文末」而收窄实现语义（文档未同步 = RED）。
      const reviewSkillText = fs.readFileSync(
        path.join(SCRIPTS_DIR, '..', '..', 'flow-comet-review', 'SKILL.md'), 'utf8');
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
      // 同样改为断言顺序句本身——「先对当前节点 record + exit」+「未 exit 前不得 entry」。
      // 旧的裸 'entry subagent-execute' 会同时命中禁止句里的目标节点名，无法区分两种语义。
      assertOut(resWrongNode, '先对当前节点 execute record + exit');
      assertOut(resWrongNode, '不要在未 exit 前 entry 目标节点');
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

  // 131: R1 旧兼容——旧 change(无 newChange)处置标记缺失仍 WARN；并内扩延期裁决门禁（含 Minor）
  // 的旧 change 渐进面：无用户裁决 / Minor 缺判据 → 只 WARN 不 BLOCK（不卡死旧 REVIEW）；有裁决
  // +[升级] → 放行。Minor 判据门（R2）扩到 [已修]/[升级] 后旧 change 同一渐进口径。
  {
    name: '131 review exit 兼容：旧 change 处置标记缺失仍 WARN + 延期渐进（R1 旧兼容）',
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
      // 子断言:Minor [转待办] 无用户裁决 → 旧 change 同样只 WARN 不 BLOCK（延期门禁覆盖任何
      // 严重度，旧 REVIEW 渐进提示、不卡死既有 change）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-6 · 旧 change 未裁决的小项**：某处小问题 [转待办]\n\n## 结论\n\n通过\n');
      const resMinorDeferred = runGuard(['exit', 'review'], dir);
      assertExit(resMinorDeferred, 0);
      assertOut(resMinorDeferred, 'REVIEW WARN');
      assertOut(resMinorDeferred, 'm-6 · 旧 change 未裁决的小项');
      assertOut(resMinorDeferred, '用户裁决');
      assertNotOut(resMinorDeferred, 'BLOCKED');
      // 子断言:Minor [转待办] + 裁决记录但缺「判 Minor：」判据 → 旧 change 只 WARN 不 BLOCK
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-7 · 旧 change 缺判据的小项**：某处小问题 [升级] [转待办]\n\n- 用户裁决：接受延期 —— 发现 m-7：下一 change 首修。\n\n## 结论\n\n通过\n');
      const resMinorNoReason = runGuard(['exit', 'review'], dir);
      assertExit(resMinorNoReason, 0);
      assertOut(resMinorNoReason, 'REVIEW WARN');
      assertOut(resMinorNoReason, '判 Minor：');
      assertNotOut(resMinorNoReason, 'BLOCKED');
      // 子断言(R2 判定时门禁的旧 change 渐进面)：[已修] 的 Minor 缺判据同样只 WARN 不 BLOCK
      // ——不卡死既有 REVIEW，与 [转待办] 形态同一渐进口径（新 change 见 125）
      writeFile(dir, '.specs/' + CHANGE_ID + '/REVIEW.md', '# REVIEW\n\n## 发现\n\n### Minor\n\n- **m-8 · 旧 change 已修缺判据的小项**：某处小问题 [已修]\n\n## 结论\n\n通过\n');
      const resMinorFixedNoReason = runGuard(['exit', 'review'], dir);
      assertExit(resMinorFixedNoReason, 0);
      assertOut(resMinorFixedNoReason, 'REVIEW WARN');
      assertOut(resMinorFixedNoReason, 'm-8 · 旧 change 已修缺判据的小项');
      assertOut(resMinorFixedNoReason, '判 Minor：');
      assertNotOut(resMinorFixedNoReason, 'BLOCKED');
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
];
