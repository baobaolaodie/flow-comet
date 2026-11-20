#!/usr/bin/env node
// 节点参考页 Mermaid 图语法检查（受检入库；CI quality 步骤使用）。
//
// 判据只有一条：mermaid 解析器能接受该图。不做「看起来像 mermaid 就算过」的弱检查——
// 图是否畸形只有解析器说了算。
//
// 依赖边界（ADR-007：全仓唯一第三方依赖是 @clack/prompts）：
//   mermaid / jsdom 不进 package.json。本脚本用动态 import 的裸说明符，按脚本自身位置解析
//   依赖；CI 把脚本复制到临时安装目录（那里装了 mermaid + jsdom）后以仓库根为参数运行。
//   依赖不可用时输出 NOT-CHECKED 并以退出码 2 结束——未验证 ≠ 通过。
//
// 用法：node scripts/check-mermaid.mjs [repoRoot]
// 退出码：0 = 全部图块可解析；1 = 解析失败或页面缺失；2 = 依赖不可用（未检查）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES = ['docs/NODES.md', 'docs/NODES-zh.md'];
const DEPENDENCY_HINT = 'npm install --no-save --package-lock=false mermaid@12.3.0 jsdom@29.1.1';

// 抽取全部 mermaid 块（先归一化 CRLF）。围栏按 CommonMark 逐行扫描：
//  - 开启围栏允许 0~3 个前导空格，围栏 ≥ 3 个连续的反引号或波浪线（``` 与 ~~~ 是两种围栏）；
//  - 反引号围栏的 info string 不得含反引号——反引号后面又跟一段带反引号的文本（例如
//    ```example```）是普通文本，不是开围栏；当成开围栏会把其后的真图当作该围栏的正文吞掉
//    （整页图块数归零，检查却报「通过」）。波浪线围栏没有这条限制，info string 里可以有反引号；
//  - 闭合围栏必须与开启围栏**同字符**、长度不短于开启，且其后仅余空白：更短的反引号不会提前
//    截断正文，``` 也不会被 ~~~ 关闭（混字符互不闭合）；
//  - info string 的**第一个词**是 mermaid 才算图块（后续词是该图的信息串），所以写在 text 围栏
//    内的同名标记不会被误抽。
// 未闭合的围栏按 Markdown 规则延续到文件尾，仍交给解析器判定，不静默丢弃。
export function extractMermaidBlocks(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let fenceChar = null;
  let fenceLength = 0;
  let isMermaid = false;
  let body = [];
  for (const line of lines) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceChar === null) {
      if (!fence) continue;
      // CommonMark：反引号围栏的 info string 里不许出现反引号——该行是普通文本，不进入围栏状态。
      if (fence[1][0] === '`' && fence[2].includes('`')) continue;
      fenceChar = fence[1][0];
      fenceLength = fence[1].length;
      isMermaid = fence[2].trim().split(/\s+/u)[0] === 'mermaid';
      body = [];
      continue;
    }
    if (fence && fence[1][0] === fenceChar && fence[1].length >= fenceLength && fence[2].trim() === '') {
      if (isMermaid) blocks.push(body.join('\n'));
      fenceChar = null;
      fenceLength = 0;
      isMermaid = false;
      body = [];
      continue;
    }
    if (isMermaid) body.push(line);
  }
  if (isMermaid) blocks.push(body.join('\n'));
  return blocks;
}

// mermaid 运行在浏览器 DOM 上：jsdom 建最小文档，把解析器会碰到的构造器挂到全局。
// 垫片只提供 mermaid 解析路径需要的 DOM 构造器（window / document / Element /
// HTMLElement / SVGElement），不额外初始化 mermaid 配置。
async function loadMermaid() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Element = dom.window.Element;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.SVGElement = dom.window.SVGElement;
  const mermaid = (await import('mermaid')).default;
  if (!mermaid || typeof mermaid.parse !== 'function') {
    throw new Error('mermaid 模块未导出 parse（版本不符？需要 mermaid@12）');
  }
  return mermaid;
}

function errorMessage(err) {
  if (err && typeof err === 'object' && typeof err.message === 'string') return err.message;
  return String(err);
}

async function checkPage(page, mermaid) {
  const blocks = extractMermaidBlocks(fs.readFileSync(page.abs, 'utf8'));
  if (blocks.length === 0) {
    console.error(`${page.rel} FAIL 未抽到任何 mermaid 块（围栏格式变化或图被删）`);
    return { total: 0, failures: 1 };
  }
  let failures = 0;
  for (const [i, code] of blocks.entries()) {
    const index = i + 1;
    try {
      const result = await mermaid.parse(code);
      const type = result && result.diagramType ? ` (${result.diagramType})` : '';
      console.log(`${page.rel} #${index} ok${type}`);
    } catch (err) {
      failures += 1;
      const detail = errorMessage(err).split('\n');
      console.error(`${page.rel} #${index} FAIL ${detail[0].trim()}`);
      for (const line of detail.slice(1)) console.error(`    ${line}`);
    }
  }
  return { total: blocks.length, failures };
}

async function main(argv) {
  const repoRoot = path.resolve(argv[2] ?? process.cwd());
  const pages = PAGES.map((rel) => ({ rel, abs: path.join(repoRoot, rel) }));

  const missing = pages.filter((page) => !fs.existsSync(page.abs));
  if (missing.length > 0) {
    for (const page of missing) console.error(`MISSING ${page.rel}（${repoRoot} 下不存在）`);
    console.error('Mermaid 语法检查未执行：页面缺失，不能当作通过');
    return 1;
  }

  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (err) {
    console.error('NOT-CHECKED：mermaid / jsdom 不可用，图语法未校验（未验证 ≠ 通过）');
    console.error(`  原因：${errorMessage(err)}`);
    console.error('  本地安装（不写入 package.json / package-lock.json）：');
    console.error(`    ${DEPENDENCY_HINT}`);
    console.error(`  再以仓库根为参数运行：node scripts/check-mermaid.mjs "${repoRoot}"`);
    console.error('  CI 会把本脚本复制到临时安装目录后运行，依赖只装在那里。');
    return 2;
  }

  let total = 0;
  let failures = 0;
  for (const page of pages) {
    const result = await checkPage(page, mermaid);
    total += result.total;
    failures += result.failures;
  }

  if (failures > 0) {
    console.error(`Mermaid 语法检查失败：${failures} 个问题（已解析 ${total} 个图块）`);
    return 1;
  }
  console.log(`Mermaid 语法检查通过：${total} 个图块（${pages.length} 页）全部由 mermaid 解析器接受`);
  return 0;
}

// 直接运行才执行检查：被 import 时（调用方只读 extractMermaidBlocks）不得触发解析。
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv).then(
    (code) => { process.exitCode = code; },
    (err) => {
      console.error(`Mermaid 语法检查异常：${err && err.stack ? err.stack : String(err)}`);
      process.exitCode = 1;
    },
  );
}
