#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const required = [
  "SKILL.md",
  "../flow-comet-open/SKILL.md",
  "../flow-comet-design/SKILL.md",
  "../flow-comet-plan/SKILL.md",
  "../flow-comet-execute/SKILL.md",
  "../flow-comet-subagent-execute/SKILL.md",
  "../flow-comet-review/SKILL.md",
  "../flow-comet-verify/SKILL.md",
  "../flow-comet-archive/SKILL.md",
  "reference/resolved-skills.json",
  "reference/workflow-protocol.json",
  "reference/decision-points.md",
  "reference/recovery.md",
  "reference/authoring-lanes.json",
  "reference/skill-review.md",
  "reference/composition-report.md",
  "reference/subagents/script-author.md",
  "scripts/comet-plan.mjs",
  "scripts/comet-check.mjs",
  "scripts/comet-hook-guard.mjs",
  "scripts/workflow-state.mjs",
  "scripts/workflow-guard.mjs",
  "scripts/workflow-handoff.mjs",
  "comet/skill.yaml",
  "comet/guardrails.yaml",
  "comet/checks.yaml",
  "comet/eval.yaml"
];

async function main() {
  const missing = [];
  for (const relative of required) {
    try {
      const stats = await fs.stat(path.join(packageRoot, relative));
      if (!stats.isFile()) missing.push(relative);
    } catch {
      missing.push(relative);
    }
  }
  if (missing.length > 0) {
    console.error('Missing required workflow contract files: ' + missing.join(', '));
    process.exit(1);
  }
  const protocol = JSON.parse(await fs.readFile(path.join(packageRoot, 'reference', 'workflow-protocol.json'), 'utf8'));
  if (protocol.schemaVersion !== 1 || !Array.isArray(protocol.nodes)) {
    throw new Error('workflow-protocol.json must use the current schema with nodes');
  }
  console.log('workflow-contract-ok');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
