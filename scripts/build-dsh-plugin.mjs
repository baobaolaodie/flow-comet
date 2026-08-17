#!/usr/bin/env node
/**
 * build-dsh-plugin.mjs
 *
 * Builds the dsh-flow-comet plugin payload inside this repository by copying
 * the authoritative flow-comet skill tree and orchestration rule into the
 * npm package source directory (dsh-plugin/).
 *
 * Build mode (default):
 *   node scripts/build-dsh-plugin.mjs
 *
 * Check mode (idempotent comparison, CI-friendly):
 *   node scripts/build-dsh-plugin.mjs --check
 *
 * The build is intentionally non-destructive: it overwrites generated files
 * but never removes existing files from the target directory (L-008).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const AUTHORITATIVE_SKILLS = path.join(
  REPO_ROOT,
  '.comet',
  'bundle-drafts',
  'flow-comet',
  'skills',
  'flow-comet',
);
const TARGET_SKILLS = path.join(REPO_ROOT, 'dsh-plugin', 'skills', 'flow-comet');

const AUTHORITATIVE_RULES = path.join(
  REPO_ROOT,
  '.comet',
  'bundle-drafts',
  'flow-comet',
  'rules',
);
const TARGET_RULES = path.join(REPO_ROOT, 'dsh-plugin', 'rules');
const ORCHESTRATION_RULE = 'flow-comet-orchestration.md';

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function collectFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) {
    return files;
  }
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolute));
      }
    }
  })(root);
  return files.sort();
}

function copyTree(srcDir, dstDir) {
  const files = collectFiles(srcDir);
  if (files.length === 0) {
    throw new Error(`源目录为空或不存在: ${srcDir}`);
  }
  for (const relative of files) {
    const sourceFile = path.join(srcDir, relative);
    const targetFile = path.join(dstDir, relative);
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(sourceFile, targetFile);
  }
  return files.length;
}

function compareFile(sourceFile, targetFile, label) {
  if (!fs.existsSync(targetFile)) {
    return [`missing: ${label}`];
  }
  const sourceBuffer = fs.readFileSync(sourceFile);
  const targetBuffer = fs.readFileSync(targetFile);
  return sourceBuffer.equals(targetBuffer) ? [] : [`changed: ${label}`];
}

function compareTree(srcDir, dstDir, label) {
  const problems = [];
  const sourceFiles = collectFiles(srcDir);
  const targetFiles = collectFiles(dstDir);
  const targetSet = new Set(targetFiles);

  for (const relative of sourceFiles) {
    const display = `${label}/${toPosix(relative)}`;
    if (!targetSet.has(relative)) {
      problems.push(`missing: ${display}`);
      continue;
    }
    const sourceFile = path.join(srcDir, relative);
    const targetFile = path.join(dstDir, relative);
    if (!fs.readFileSync(sourceFile).equals(fs.readFileSync(targetFile))) {
      problems.push(`changed: ${display}`);
    }
  }

  const sourceSet = new Set(sourceFiles);
  for (const relative of targetFiles) {
    if (!sourceSet.has(relative)) {
      problems.push(`extra: ${label}/${toPosix(relative)}`);
    }
  }

  return problems;
}

function build() {
  const skillFiles = copyTree(AUTHORITATIVE_SKILLS, TARGET_SKILLS);

  fs.mkdirSync(TARGET_RULES, { recursive: true });
  const sourceRule = path.join(AUTHORITATIVE_RULES, ORCHESTRATION_RULE);
  const targetRule = path.join(TARGET_RULES, ORCHESTRATION_RULE);
  if (!fs.existsSync(sourceRule)) {
    throw new Error(`权威规则文件不存在: ${sourceRule}`);
  }
  fs.copyFileSync(sourceRule, targetRule);

  console.log(
    `[build-dsh-plugin] skills/flow-comet: ${skillFiles} files copied -> ${path.relative(REPO_ROOT, TARGET_SKILLS)}`,
  );
  console.log(
    `[build-dsh-plugin] rules/${ORCHESTRATION_RULE}: copied -> ${path.relative(REPO_ROOT, targetRule)}`,
  );
  console.log('[build-dsh-plugin] build OK');
}

function check() {
  const problems = [];

  if (!fs.existsSync(AUTHORITATIVE_SKILLS)) {
    throw new Error(`权威源技能目录不存在: ${AUTHORITATIVE_SKILLS}`);
  }
  if (!fs.existsSync(path.join(AUTHORITATIVE_RULES, ORCHESTRATION_RULE))) {
    throw new Error(`权威规则文件不存在: ${path.join(AUTHORITATIVE_RULES, ORCHESTRATION_RULE)}`);
  }

  problems.push(...compareTree(AUTHORITATIVE_SKILLS, TARGET_SKILLS, 'skills/flow-comet'));

  const sourceRule = path.join(AUTHORITATIVE_RULES, ORCHESTRATION_RULE);
  const targetRule = path.join(TARGET_RULES, ORCHESTRATION_RULE);
  problems.push(...compareFile(sourceRule, targetRule, `rules/${ORCHESTRATION_RULE}`));

  // dsh-plugin/rules must contain exactly the orchestration rule managed by this script.
  for (const relative of collectFiles(TARGET_RULES)) {
    if (relative !== ORCHESTRATION_RULE) {
      problems.push(`extra: rules/${toPosix(relative)}`);
    }
  }

  if (problems.length > 0) {
    console.error('[build-dsh-plugin] --check failed:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }

  console.log('[build-dsh-plugin] --check OK: dsh-plugin skills/rules match authoritative source');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/build-dsh-plugin.mjs [--check]');
    return;
  }
  if (args.includes('--check')) {
    check();
  } else {
    build();
  }
}

try {
  main();
} catch (error) {
  console.error(`[build-dsh-plugin] 错误: ${error.message}`);
  process.exit(1);
}
