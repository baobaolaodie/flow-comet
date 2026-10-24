// explain（单一归属）：节点现问——只读派生自协议 JSON。
// 「某节点产出什么 / 门禁是什么 / 要加载什么 / 跑哪三条命令」此前只在册子里手抄，本命令把它
// 暴露为节点现问通道。数据全部取自协议 JSON 的 nodes[] 与 outputSchemas[]——零新事实源、零状态
// 读写（不写 state、不改路由、不绕门禁，与 bridge-check 同为纯读通道）。节点 id 非法 →
// fail-closed 并列出协议内全部合法节点。
import path from 'path';
import { nodeTemplateDeclaration, templatePointerLines } from '../protocol-utils.mjs';
import { runRootDir } from './state-io.mjs';

// 命令路径形态（平台化）：权威源保持设计形态 .claude/skills/（与册子命令形态一致，安装时由
// prepare-env 的 pathReplacements 平台化）；安装副本按脚本自定位输出运行根相对形态——.claude /
// .agents / .dsh 乃至将来新增的平台根同一推导覆盖，无需在此登记平台清单；落在运行根之外
// （用户级安装）时输出脚本自身的绝对路径。不得硬编码单一形态：pathReplacements 只处理 .md
// （prepare-env 的 applyPathReplacements 按扩展名过滤），脚本内的字面量在安装副本上不会被
// 替换——硬编码 .claude 会让 Codex / dsh 单平台安装的 explain 输出不存在的命令路径。
// scriptsDir 由入口以自定位绝对路径传入（入口所在目录即脚本目录）。
function platformScriptsDir(scriptsDir) {
  const posixDir = scriptsDir.replace(/\\/g, '/');
  if (posixDir.includes('/.flow-comet/skills/')) return '.claude/skills/flow-comet/scripts';
  const relative = path.relative(runRootDir(), scriptsDir).split(path.sep).join('/');
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return posixDir;
  return relative;
}

// ① 产出物模板现问（加载链的第三环）：与 entry 的 READ TEMPLATE 行同源同实现（protocol-utils
// 的 templatePointerLines），只换标签——两处措辞一处维护。零模板节点不打印。
// 条件模板行在本通道无条件列出（本通道不读状态、不判前端），并显式标注「仅前端 change」：是否
// 真的适用由 CHANGE.md 的视觉调性段决定，design 的入口会按 frontendCriterion 追出。
function printNodeTemplates(node) {
  const declaration = nodeTemplateDeclaration(node);
  if (declaration.required.length === 0 && declaration.optional.length === 0) return;
  for (const line of templatePointerLines(declaration, {
    label: 'TEMPLATE',
    conditional: declaration.optional.length > 0,
  })) {
    console.log(line);
  }
}

// ② 该节点的 outputSchema 名与产物路径（含 evidence id）。产物根语义与状态机 / guard 的节点完成
// 判定一致：'specs-root' → .specs/；'project' / 缺省 → 项目根。悬空 schema 引用如实标注、不编造
// 产物（自定义协议允许悬空引用，route-node 的产物推导同样容忍）。
function printNodeArtifacts(protocol, node) {
  const schemaById = new Map((protocol.outputSchemas ?? []).map((schema) => [schema.id, schema]));
  const schemaIds = node.outputSchemas ?? [];
  if (schemaIds.length === 0) console.log('OUTPUT-SCHEMA: (none)');
  for (const schemaId of schemaIds) {
    const schema = schemaById.get(schemaId);
    console.log('OUTPUT-SCHEMA: ' + schemaId + (schema && schema.description ? ' — ' + schema.description : ''));
    if (!schema) {
      console.log('  ARTIFACT: (none)——协议 outputSchemas[] 未声明该 schema，无法派生产物路径');
      continue;
    }
    for (const artifact of schema.artifacts ?? []) {
      // 同一 artifact 的 paths 为互斥备选（命中任一即产物存在，与节点完成判定同语义）
      const artifactRoot = artifact.pathBase === 'specs-root' ? '.specs/' : '';
      const paths = (artifact.paths ?? []).map((declaredPath) => artifactRoot + String(declaredPath));
      console.log('  ARTIFACT: ' + (artifact.id ?? '(unnamed)')
        + (artifact.kind ? ' [' + artifact.kind + ']' : '')
        + (artifact.required === false ? ' optional' : ' required')
        + ' → ' + (paths.length > 0 ? paths.join(' | ') : '(未声明路径)'));
    }
    const evidenceIds = (schema.evidence ?? []).map((evidence) => evidence.id
      + (evidence.required === false ? ' (optional)' : ' (required)'));
    console.log('  EVIDENCE: ' + (evidenceIds.length > 0 ? evidenceIds.join(' | ') : '(none)'));
  }
}

// ② guardrails 表（id / label / validation）
function printNodeGuardrails(node) {
  const guardrails = node.guardrails ?? [];
  if (guardrails.length === 0) console.log('GUARDRAIL: (none)');
  for (const guardrail of guardrails) {
    console.log('GUARDRAIL: ' + (guardrail.id ?? '(unnamed)') + ' | ' + (guardrail.label ?? '-')
      + ' | ' + (guardrail.validation ?? '-'));
  }
}

// ③ requiredSkillCalls（skill / scope / enforcement / reason）
function printNodeSkillCalls(node) {
  const calls = node.requiredSkillCalls ?? [];
  if (calls.length === 0) console.log('REQUIRED-SKILL: (none)');
  for (const call of calls) {
    console.log('REQUIRED-SKILL: ' + (call.skill ?? '(unnamed)')
      + ' | scope=' + (call.scope ?? '-') + ' | enforcement=' + (call.enforcement ?? '-')
      + ' | reason=' + (call.reason ?? '-'));
  }
}

// ④ 三条命令（entry / exit / record，按节点 id 与平台化路径形态生成）。脚本路径整体加双引号：
// 安装根含空格时未加引号的路径会被 shell 按空格切分（只剩路径首段被当作脚本），打印出来的命令
// 便跑不了——加引号后三种平台语义下都是**单一参数**（引号本身对无空格路径无害）。
function printNodeCommands(node, scriptsDir) {
  const platformDir = platformScriptsDir(scriptsDir);
  console.log('COMMAND entry: node "' + platformDir + '/workflow-guard.mjs" entry ' + node.id);
  console.log('COMMAND exit: node "' + platformDir + '/workflow-guard.mjs" exit ' + node.id + ' --apply');
  console.log('COMMAND record: node "' + platformDir + '/workflow-state.mjs" record ' + node.id
    + " '{\"summary\":\"<完成摘要>\"}'");
}

// explain <node>：缺参 / 纯空白 / 拿选项当节点名（如 --help）→ 用法错误（fail-closed，不猜）
export function runExplain(protocol, argv, scriptsDir) {
  const explainNodeId = argv[3];
  const legalNodeIds = (protocol.nodes ?? []).map((node) => node.id);
  if (typeof explainNodeId !== 'string' || explainNodeId.trim() === '' || explainNodeId.startsWith('--')) {
    throw new Error('explain requires a <node> id. 用法: workflow-state.mjs explain <node>'
      + '（合法节点: ' + legalNodeIds.join('/') + '）');
  }
  const explainNode = (protocol.nodes ?? []).find((node) => node.id === explainNodeId);
  if (!explainNode) {
    throw new Error('explain node 非法: ' + explainNodeId + '（协议节点: ' + legalNodeIds.join('/') + '）');
  }
  console.log('NODE: ' + explainNode.id);
  if (explainNode.label) console.log('LABEL: ' + explainNode.label);
  if (explainNode.kind) console.log('KIND: ' + explainNode.kind);
  if (explainNode.disabled === true) console.log('DISABLED: true（该节点在当前协议中被停用）');
  printNodeTemplates(explainNode);
  printNodeArtifacts(protocol, explainNode);
  printNodeGuardrails(explainNode);
  printNodeSkillCalls(explainNode);
  printNodeCommands(explainNode, scriptsDir);
  return;
}
