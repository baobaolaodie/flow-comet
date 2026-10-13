// count-derivation.mjs — 计数派生的单一来源：场景数与系统测试集项数的**唯一取数通道**
//
// 定位：套件底部自检、本地文档健康工具对「场景数 / 项数」的核对，一律经本模块取数。任何消费方
// 都不得再自持正则或虚拟机求值——同一计数出现第二份实现必然漂移（改了一处、另一处照旧通过）。
//
// 输入约定（组文件形态）：
//   · 场景 —— scripts/scenarios/*.mjs，每个文件 `export const ENTRIES = [...]`，元素是场景对象
//     （含 name 与 run）；
//   · 条目 —— scripts/items/*.mjs，同约定，元素是测试项对象（含 name 与 run）。
//   聚合口径 = 目录内全部 .mjs 组文件的 ENTRIES.length 之和：读代码求长度，不读文本、不手抄数字。
//   目录缺席或空目录 ⇒ 视同组文件尚未落地，走下面的过渡回退。
//
// 阶段无关性：派生值是「组文件清单 + 每份文件的条目数」的函数，与流程阶段（开发态 / 发布态 /
// 归档态）无关——组文件不随阶段搬移或改写，故不存在只在某一阶段成立的形态假设。
//
// 过渡回退（组文件落地后删除）：两个套件此时还没有把数据搬进组文件，回退解析套件入口里的旧
// 数组（guard-self-test.mjs 的 SCENARIOS / system-test.mjs 的 TEST_ITEMS），使消费方在任何时点
// 都能取到数。回退实现只此一处，且是过渡形态——组文件落地（T05/T06）后整段删除。
//
// 两个导出均为 async：组文件用动态 import 载入（载入即求值，故不静态 import 数据层）。派生源缺失
// （回退源文件不存在）抛 code === 'COUNT_SOURCE_MISSING' 的错误，调用方据此显式报告，不静默计 0。
// 可选参数 scriptsDir 是**测试接缝**（默认取本模块所在技能树的 scripts/ 目录，权威源与各平台
// 安装副本同一相对形态，不假定仓库根布局）——夹具可在临时目录里构造组文件来验证派生确实在
// 「读」，而不是硬编码。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPTS_DIR = path.resolve(LIB_DIR, '..');

// 组文件目录（数据层）
const SCENARIOS_DIR = 'scenarios';
const ITEMS_DIR = 'items';

// 回退源（过渡形态）：套件入口与其中的旧数组名
const GUARD_SUITE = 'guard-self-test.mjs';
const SYSTEM_SUITE = 'system-test.mjs';

function missingSource(name, file) {
  const err = new Error('计数派生源不存在: ' + name + '（' + file + '）');
  err.code = 'COUNT_SOURCE_MISSING';
  err.path = file;
  return err;
}

function readSuiteSource(scriptsDir, name) {
  const file = path.join(scriptsDir, name);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw missingSource(name, file);
    throw e;
  }
}

// 组文件枚举：目录缺席 / 空目录 → null（交回退）；子目录与非 .mjs 不参与。
function listGroupFiles(scriptsDir, groupDir) {
  const dir = path.join(scriptsDir, groupDir);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => path.join(dir, e.name))
    .sort();
  return files.length === 0 ? null : files;
}

function labelOf(scriptsDir, file) {
  return path.relative(scriptsDir, file).split(path.sep).join('/');
}

// 聚合：逐文件动态 import，累计 ENTRIES.length。任一组文件不合约定即抛出（fail-closed——
// 数据层出现一个不是组文件的模块，或组文件导出为空，都是必须当场暴露的错误，不静默计数）。
async function countGroupEntries(files, scriptsDir) {
  let total = 0;
  for (const file of files) {
    const label = labelOf(scriptsDir, file);
    const mod = await import(pathToFileURL(file).href);
    if (!Array.isArray(mod.ENTRIES)) throw new Error(label + ' 未导出 ENTRIES 数组（组文件约定）');
    if (mod.ENTRIES.length === 0) throw new Error(label + ' 的 ENTRIES 为空数组（组文件约定）');
    for (const entry of mod.ENTRIES) {
      if (!entry || typeof entry.name !== 'string' || entry.name === '') {
        throw new Error(label + ' 的 ENTRIES 含缺 name 字段的元素（组文件约定）');
      }
    }
    total += mod.ENTRIES.length;
  }
  return total;
}

// ---------- 过渡回退（组文件落地后删除整段） ----------

// 场景：旧数组元素是场景对象，逐个求值会因闭包引用失败，故按元素形态计数。
function fallbackScenarioCount(scriptsDir) {
  const src = readSuiteSource(scriptsDir, GUARD_SUITE);
  const literal = src.match(/const SCENARIOS\s*=\s*\[([\s\S]*?)\n\];/);
  if (!literal) throw new Error(GUARD_SUITE + ' 的 SCENARIOS 数组未匹配（计数回退源失效）');
  const count = (literal[1].match(/\{\s*name:/g) || []).length;
  if (count === 0) throw new Error(GUARD_SUITE + ' 的 SCENARIOS 数组解析出 0 条（计数回退源失效）');
  return count;
}

// 系统测试集项数：条目里的运行体是函数值，求值只构造数组元素、不调用它们。
function fallbackItemCount(scriptsDir) {
  const src = readSuiteSource(scriptsDir, SYSTEM_SUITE);
  const decl = src.indexOf('const TEST_ITEMS = [');
  if (decl < 0) throw new Error(SYSTEM_SUITE + ' 中找不到 TEST_ITEMS 声明（计数回退源失效）');
  const open = src.indexOf('[', decl);
  const close = src.indexOf('\n];', open); // 数组按脚本自身格式以顶格 ]; 收尾
  if (close < 0) throw new Error(SYSTEM_SUITE + ' 的 TEST_ITEMS 未以顶格 ]; 收尾（计数回退源失效）');
  const items = vm.runInNewContext('[' + src.slice(open + 1, close) + ']', {}, { filename: SYSTEM_SUITE });
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(SYSTEM_SUITE + ' 的 TEST_ITEMS 求值结果异常（应有非空数组）');
  }
  for (const item of items) {
    if (!item || typeof item.name !== 'string') throw new Error(SYSTEM_SUITE + ' 的 TEST_ITEMS 条目缺 name 字段');
  }
  return items.length;
}

// ---------- 对外导出 ----------

export async function scenarioCount(scriptsDir = DEFAULT_SCRIPTS_DIR) {
  const files = listGroupFiles(scriptsDir, SCENARIOS_DIR);
  return files ? countGroupEntries(files, scriptsDir) : fallbackScenarioCount(scriptsDir);
}

export async function systemItemCount(scriptsDir = DEFAULT_SCRIPTS_DIR) {
  const files = listGroupFiles(scriptsDir, ITEMS_DIR);
  return files ? countGroupEntries(files, scriptsDir) : fallbackItemCount(scriptsDir);
}
