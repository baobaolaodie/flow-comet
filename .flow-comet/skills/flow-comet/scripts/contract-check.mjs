#!/usr/bin/env node
/**
 * contract-check.mjs — 前后端契约核对辅助脚本（O-8）
 *
 * 用途：审查（Round 1.5）时自动提取前后端的枚举值/校验规则，输出两端清单，
 * 供 reviewer 快速比对一致性（防 status/type 枚举错位、字段名、min/required 不匹配）。
 *
 * 用法：
 *   node contract-check.mjs <field> [--project <root>] [--backend <dir>] [--frontend <dir>]
 *   例：node contract-check.mjs status
 *   --project <root> 优先于当前目录（未指定时用 cwd）
 *   --backend/--frontend 相对 --project 或 cwd 解析；缺省回退 <root>/app 与 <root>/src
 *
 * 输出：后端定义清单 + 前端定义清单（头部打印实际解析路径），人工比对（脚本不自动判定正确性——需要业务语义）。
 */
import { promises as fs } from 'fs';
import path from 'path';

// 用法串单一来源（缺参 / 缺值两条错误路径同源——新增选项只改一行）
const USAGE = '用法: node contract-check.mjs <field> [--project <root>] [--backend <dir>] [--frontend <dir>]';

const runRoot = process.cwd();
const field = process.argv[2];
if (!field) {
  console.error(USAGE);
  console.error('例: node contract-check.mjs status');
  process.exit(1);
}

// 正则元字符转义（field 直接拼进 RegExp 会改变匹配语义：`item[0]` 被当字符类；`[` 直接抛错）
const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 目录类选项读取（单一来源 · 与既有 --project 同规则）：显式参数优先于缺省回退；
// 其后缺值（末尾 / 空串 / 纯空白 / 缺值处又跟了选项）→ 用法错误 + 非零退出
function readDirOption(name, missingMessage) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
    console.error(USAGE);
    console.error(missingMessage);
    process.exit(1);
  }
  return value;
}

const projectRoot = readDirOption('--project', '--project 后缺少项目根目录值');
const backendArg = readDirOption('--backend', '--backend 后缺少后端目录值');
const frontendArg = readDirOption('--frontend', '--frontend 后缺少前端目录值');

// 定位后端/前端目录：显式 --backend/--frontend 优先于缺省回退（<root>/app 与 <root>/src）；
// 相对路径按 --project 或 cwd 解析——显式参数优于目录形态探测，不做项目耦合硬编码
function findRoots() {
  const root = projectRoot ?? runRoot;
  return {
    root,
    backend: backendArg ? path.resolve(root, backendArg) : path.join(root, 'app'),
    frontend: frontendArg ? path.resolve(root, frontendArg) : path.join(root, 'src'),
  };
}

async function grepFiles(dir, patterns, exclude = ['node_modules', '__pycache__', 'dist']) {
  const hits = [];
  async function walk(d) {
    let entries;
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (exclude.includes(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (/\.(py|ts|tsx)$/.test(e.name)) {
        const text = await fs.readFile(full, 'utf8');
        for (const pat of patterns) {
          const re = new RegExp(pat, 'g');
          let m;
          while ((m = re.exec(text)) !== null) {
            const line = text.slice(0, m.index).split('\n').length;
            hits.push({ file: path.relative(dir, full), line, match: m[0].trim() });
          }
        }
      }
    }
  }
  await walk(dir);
  return hits;
}

async function main() {
  const { root, backend, frontend } = findRoots();
  console.log(`# 契约核对: ${field}（project: ${root}）`);
  console.log(`# backend: ${backend}`);
  console.log(`# frontend: ${frontend}`);
  console.log('');

  // 后端：Pydantic 校验 + service 赋值
  console.log('## 后端（Pydantic 校验 / service 赋值）');
  const backendHits = await grepFiles(backend, [
    `(?:Field\\([^)]*ge=|le=)[^)]*\\b${escapedField}\\b`,
    `\\b${escapedField}\\s*=\\s*Field\\(`,
    `\\b${escapedField}\\s*=\\s*\\d+`,       // status = 3 类赋值
    `status=\\d+`,                     // update_status(..., status=N)
    `${escapedField}\\s*:\\s*Literal`,
  ]);
  if (backendHits.length === 0) {
    console.log('（未命中——该字段可能无后端校验/赋值，或路径不对）');
  } else {
    const seen = new Set();
    for (const h of backendHits.slice(0, 30)) {
      const key = `${h.file}:${h.line}:${h.match}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`- ${h.file}:${h.line}  ${h.match}`);
    }
  }

  // 前端：map / derive / Form rules
  console.log('\n## 前端（map / derive / form rules）');
  const frontendHits = await grepFiles(frontend, [
    `\\b${escapedField}===\\s*\\d+`,          // status===3
    `\\b${escapedField}\\s*===?\\s*\\d+`,
    `['"]${escapedField}['"]\\s*:.*ge|le|min|max`,  // 校验
    `Record<number.*>`,
    `Field\\([^)]*ge=|le=`,
  ]);
  if (frontendHits.length === 0) {
    console.log('（未命中）');
  } else {
    const seen = new Set();
    for (const h of frontendHits.slice(0, 30)) {
      const key = `${h.file}:${h.line}:${h.match}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`- ${h.file}:${h.line}  ${h.match}`);
    }
  }

  console.log('\n> 提示：人工比对两端枚举值/校验规则是否一致（脚本不判定语义正确性）。');
  console.log('> 常见错位：前端 map 值 ≠ 后端 status 语义（如后端 3=已生成、前端 3=已发布）。');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
