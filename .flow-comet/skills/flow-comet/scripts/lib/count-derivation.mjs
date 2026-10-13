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
//   目录缺席或空目录 ⇒ fail-closed：抛 code === 'COUNT_SOURCE_MISSING' 的错误并指向缺失的组文件
//   目录，不静默计 0、也不回落到套件入口的文本解析。
//
// 阶段无关性：派生值是「组文件清单 + 每份文件的条目数」的函数，与流程阶段（开发态 / 发布态 /
// 归档态）无关——组文件不随阶段搬移或改写，故不存在只在某一阶段成立的形态假设；缺口在任何阶段
// 都以同一形态（缺哪个目录就报哪个目录）暴露出来。
//
// 两个导出均为 async：组文件用动态 import 载入（载入即求值，故不静态 import 数据层）。组文件目录
// 缺失或为空抛 code === 'COUNT_SOURCE_MISSING' 的错误（err.path = 该目录），调用方据此显式报告，
// 不静默计 0。
// 可选参数 scriptsDir 是**测试接缝**（默认取本模块所在技能树的 scripts/ 目录，权威源与各平台
// 安装副本同一相对形态，不假定仓库根布局）——夹具可在临时目录里构造组文件来验证派生确实在
// 「读」，而不是硬编码。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPTS_DIR = path.resolve(LIB_DIR, '..');

// 组文件目录（数据层）
const SCENARIOS_DIR = 'scenarios';
const ITEMS_DIR = 'items';

function missingSource(name, file) {
  const err = new Error('计数派生源不存在: ' + name + '（' + file + '）');
  err.code = 'COUNT_SOURCE_MISSING';
  err.path = file;
  return err;
}

// 组文件枚举：目录缺席 / 空目录 → null（调用方据此 fail-closed 并指向该目录）；子目录与非 .mjs
// 不参与。
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

// ---------- 对外导出 ----------

// 组文件目录缺失 / 为空 ⇒ 抛 COUNT_SOURCE_MISSING（err.path = 缺失的目录），交调用方显式报告。
export async function scenarioCount(scriptsDir = DEFAULT_SCRIPTS_DIR) {
  const files = listGroupFiles(scriptsDir, SCENARIOS_DIR);
  if (!files) throw missingSource(SCENARIOS_DIR + ' 组文件目录', path.join(scriptsDir, SCENARIOS_DIR));
  return countGroupEntries(files, scriptsDir);
}

export async function systemItemCount(scriptsDir = DEFAULT_SCRIPTS_DIR) {
  const files = listGroupFiles(scriptsDir, ITEMS_DIR);
  if (!files) throw missingSource(ITEMS_DIR + ' 组文件目录', path.join(scriptsDir, ITEMS_DIR));
  return countGroupEntries(files, scriptsDir);
}
