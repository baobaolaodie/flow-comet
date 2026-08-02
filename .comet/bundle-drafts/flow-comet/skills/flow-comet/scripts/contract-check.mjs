#!/usr/bin/env node
/**
 * contract-check.mjs — 前后端契约核对辅助脚本（O-8）
 *
 * 用途：审查（Round 1.5）时自动提取前后端的枚举值/校验规则，输出两端清单，
 * 供 reviewer 快速比对一致性（防 status/type 枚举错位、字段名、min/required 不匹配）。
 *
 * 用法：
 *   node contract-check.mjs <field> [--project <root>]
 *   例：node contract-check.mjs status
 *
 * 输出：后端定义清单 + 前端定义清单，人工比对（脚本不自动判定正确性——需要业务语义）。
 */
import { promises as fs } from 'fs';
import path from 'path';

const runRoot = process.cwd();
const field = process.argv[2];
if (!field) {
  console.error('用法: node contract-check.mjs <field> [--project <root>]');
  console.error('例: node contract-check.mjs status');
  process.exit(1);
}

// 定位后端/前端目录（从 project root 或约定路径）
async function findRoots() {
  const candidates = [
    runRoot,
    ...(process.argv.includes('--project')
      ? [process.argv[process.argv.indexOf('--project') + 1]]
      : []),
  ];
  for (const root of candidates) {
    const backend = path.join(root, 'pingpong-tournament', 'app');
    const frontend = path.join(root, 'frontend', 'src');
    if ((await exists(backend)) && (await exists(frontend))) {
      return { root, backend, frontend };
    }
  }
  return { root: runRoot, backend: path.join(runRoot, 'app'), frontend: path.join(runRoot, 'src') };
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
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
  const { root, backend, frontend } = await findRoots();
  console.log(`# 契约核对: ${field}（project: ${root}）\n`);

  // 后端：Pydantic 校验 + service 赋值
  console.log('## 后端（Pydantic 校验 / service 赋值）');
  const backendHits = await grepFiles(backend, [
    `(?:Field\\([^)]*ge=|le=)[^)]*\\b${field}\\b`,
    `\\b${field}\\s*=\\s*Field\\(`,
    `\\b${field}\\s*=\\s*\\d+`,       // status = 3 类赋值
    `status=\\d+`,                     // update_status(..., status=N)
    `${field}\\s*:\\s*Literal`,
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
    `\\b${field}===\\s*\\d+`,          // status===3
    `\\b${field}\\s*===?\\s*\\d+`,
    `['"]${field}['"]\\s*:.*ge|le|min|max`,  // 校验
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
