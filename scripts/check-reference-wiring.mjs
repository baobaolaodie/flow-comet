#!/usr/bin/env node
/**
 * check-reference-wiring.mjs — `reference/` 接线检查（本地工具，gitignore 不随发布分发）
 *
 * 用途：AC-2 的机检面——`reference/*.md` 的每个文件都必须被某册 `SKILL.md` **按条件**点名
 * （说明「什么时候该读它」）。只说「见某文件」而不说何时读，对执行者等于不可达：他不知道
 * 自己此刻该不该翻。本工具逐个文件判定，输出未接线清单。
 *
 * 判据（两层，缺一不可）：
 *   ① 点名——某册 `SKILL.md` 的**同一行**里出现该文件名（`reference/x.md` 与裸 `x.md` 都算）；
 *   ② 条件语——该次点名**附近**（提名前后各 60 字符内）另有一处条件句式，三类：
 *        · 当…时读    （「当你判定需要开修复回路时，先读它再动手」）
 *        · 开始…前读  （「开始委托前读它」/「委托前按 `reference/dirty-worktree.md` 检查」）
 *        · 要判定…时读（「要核对某个字段由谁管理时读它」）
 *      裸文件名引用（「见 `reference/recovery.md`」）**不算接线**——条件语与读取动词必须同在。
 *
 * 接线是文本级约定，故判据按「同一行 + 邻近窗口」判定，不做跨行猜测：条件句与文件名分行的
 * 写法会被报成未接线，修法是把条件语并到同一行（这正是接线句式的形态要求）。
 *
 * 只读：不写任何仓库文件。
 * 用法：node scripts/check-reference-wiring.mjs [--root <项目根>]
 * 退出码：0 = 全部接线；1 = 存在未接线文件（列出缺口）或环境缺失。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 参考文件所在位置（入口技能下的 reference/ 目录）
const ENTRY_SKILL = 'flow-comet';
const REFERENCE_DIR = 'reference';

// 题名邻近窗口（字符）——条件语须落在提名前后这个范围内，防止"整行里别处有 时…见"式误判
const NEAR = 60;

// 条件语三类 + 两条兼容既有合规样例的通用式。
// 各条 `{0,N}` 是**宽松上限**（同一句内的字数容差），不是精确语法：
// 判据只要求"同一行、邻近窗口里同时出现条件词与读取动词"，不解析句法。
const CONDITION_CLASSES = [
  ['当…时读', /当[^。\n]{0,60}时[^。\n]{0,24}(读|查阅|查看|按|见)/],
  ['开始…前读', /(开始|委托|动手|进入|执行|提交)[^。\n]{0,40}前[^。\n]{0,24}(读|查阅|查看|按|见)/],
  ['要判定…时读', /要[^。\n]{0,60}时[^。\n]{0,24}(读|查阅|查看|按)/],
  ['…时/前读（通用式）', /[^。\n]{1,40}(时|前)[^。\n]{0,12}(先)?(读|查阅|查看)/],
  ['…时/前见或按（既有样例式）', /[^。\n]{1,40}(时|前)[^。\n]{0,12}(详见|参见|见|按)/],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripCr = (s) => s.replace(/\r/g, '');

function parseRoot(argv) {
  const i = argv.indexOf('--root');
  const given = i >= 0 ? argv[i + 1] : null;
  return given ? path.resolve(given) : path.resolve(__dirname, '..');
}

function listReferenceMd(refDir) {
  return fs.readdirSync(refDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
}

function listSkillBooks(skillsDir) {
  const books = [];
  for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(skillsDir, e.name, 'SKILL.md');
    if (fs.existsSync(p)) books.push({ label: e.name + '/SKILL.md', lines: stripCr(fs.readFileSync(p, 'utf8')).split('\n') });
  }
  return books;
}

// 单行扫描：每次提名记下它的位置与临近窗口里匹配到的条件语类名（无条件语则为 null）
function scanLine(line, lineNo, re, label) {
  const hits = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    const window = line.slice(Math.max(0, m.index - NEAR), m.index + m[0].length + NEAR);
    const cls = CONDITION_CLASSES.find(([, rx]) => rx.test(window));
    hits.push({ where: label + ':' + lineNo, cls: cls ? cls[0] : null, text: line.trim() });
  }
  return hits;
}

// 全册扫描：同一文件名的每次提名按「有条件语 / 裸引用」分流
function findMentions(books, fileName) {
  const re = new RegExp(escapeRe(fileName), 'g');
  const wired = [];
  const bare = [];
  for (const book of books) {
    book.lines.forEach((line, i) => {
      for (const hit of scanLine(line, i + 1, re, book.label)) {
        (hit.cls ? wired : bare).push(hit);
      }
    });
  }
  return { wired, bare };
}

function describeBare(bare) {
  if (!bare.length) return '（零引用）';
  return '（有 ' + bare.length + ' 处裸引用但无条件语: ' + bare.map((b) => b.where).join(', ') + '）';
}

function main() {
  const root = parseRoot(process.argv.slice(2));
  const skillsDir = path.join(root, '.flow-comet', 'skills');
  const refDir = path.join(skillsDir, ENTRY_SKILL, REFERENCE_DIR);
  if (!fs.existsSync(refDir)) {
    console.error('FAIL: 找不到 ' + refDir + '（请在项目根运行，或用 --root 指定）');
    process.exit(1);
  }
  const files = listReferenceMd(refDir);
  const books = listSkillBooks(skillsDir);
  console.log('reference/ 接线检查（根 = ' + root + '）');
  console.log('  参考文件 ' + files.length + ' 个 · SKILL.md ' + books.length + ' 册 · 条件语三类: ' +
    CONDITION_CLASSES.slice(0, 3).map(([l]) => l).join(' / '));
  console.log('');

  const gaps = [];
  for (const f of files) {
    const { wired, bare } = findMentions(books, f);
    if (wired.length) {
      const w = wired[0];
      console.log('✅ ' + f.padEnd(28) + ' ← ' + w.where + '（' + w.cls + '）');
    } else {
      gaps.push({ name: f, note: describeBare(bare) });
      console.log('❌ ' + f.padEnd(28) + ' ' + describeBare(bare));
    }
  }
  console.log('');
  console.log('未接线: ' + gaps.length + ' / ' + files.length);
  if (!gaps.length) {
    console.log('OK: 全部 reference/*.md 均被按条件点名（AC-2）');
    return;
  }
  console.log('未接线文件清单:');
  for (const g of gaps) console.log('  - ' + g.name + ' ' + g.note);
  console.error('FAIL: ' + gaps.length + ' 个 reference/*.md 未被按条件点名（AC-2：每个文件至少一处条件语点名）');
  process.exit(1);
}

main();
