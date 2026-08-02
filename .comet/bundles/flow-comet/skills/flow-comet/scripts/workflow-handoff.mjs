#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

async function main() {
  const protocol = JSON.parse(await fs.readFile(path.join(packageRoot, 'reference', 'workflow-protocol.json'), 'utf8'));
  console.log(JSON.stringify({
    workflow: protocol.name,
    nodes: protocol.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      requiredSkillCalls: node.requiredSkillCalls ?? [],
      augmentations: node.augmentations ?? [],
      outputSchemas: node.outputSchemas ?? [],
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
