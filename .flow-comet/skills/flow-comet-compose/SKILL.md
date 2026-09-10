---
name: flow-comet-compose
description: "Use only when explicitly invoked as /flow-comet-compose. Not part of the 8-node flow. Guides composing installed skills into a custom workflow protocol JSON, driven by the flow-comet kernel (state routing / guard validation / hook interception)."
---

# flow-comet-compose（横向命令 · 自定义协议组装）

## 定位

`flow-comet-compose` 是横向命令（与 flow-comet-evolve / flow-comet-health 同类），**独立 skill，不是 8 节点流程的一部分**。它引导用户把任意已安装 skill 组合成自定义工作流，并生成 workflow-kernel 协议 JSON（protocol）。

自定义协议生成后，由 flow-comet 现有机制完整驱动，无需新增任何运行时能力：

- **状态机路由**：`workflow-state.mjs` 按节点顺序推进、记录 evidence、管理状态
- **guard 校验**：`workflow-guard.mjs` 按节点 guardrail（artifact-exists / evidence-only / state-transition）做阶段门禁
- **hook 拦截**：`comet-hook-guard.mjs` 按 writeWhitelist 做写入边界守卫

**内置 8 节点协议不可被取代**：`reference/workflow-protocol.json`（open→design→plan→execute→subagent-execute→review→verify→archive）永远是默认工作流；自定义协议只在用户显式指定时加载（见「与内置协议的关系」）。

## 交互流程（逐步）

### Step 1：目标收集

问用户「做什么 + 要哪些机制」。**每轮最多 3 问，答完一轮再问下一轮**，禁止一次性倾倒全部问题：

1. 你要组合的流程解决什么问题？期望的节点序列是什么？
2. 需要哪些机制？（状态机路由 / guard 产物校验 / hook 写入拦截 / handoff 子代理交接）
3. 每个节点输出什么产物、记录什么 evidence？

用户回答不完整时，只追问缺口，不复述已确认内容。

### Step 2：skill 库扫描

1. 列出已安装 skill：`ls .claude/skills/` 与 `ls .comet/bundle-drafts/flow-comet/skills/`；用户也可直接提供候选 skill 名。
2. 把候选列表贴给用户，确认组合：哪些 skill 作为节点 implementation，哪些作为 requiredSkillCalls。
3. 确认每个 skill 实际存在；不存在时标记为占位并提醒用户安装。

### Step 3：节点组装

用户确定节点序列后，为**每个节点**绑定：

| 字段 | 说明 |
|------|------|
| `id` | 节点唯一标识（英文，避免与内置 8 节点 id 冲突，见强制最小规则 3） |
| `label` | 展示名 |
| `kind` | `control` / `handoff` |
| `responsibility` | 该节点职责（一句话） |
| `implementation.skill` | 节点执行 skill（`require` / `augment` / `override`） |
| `requiredSkillCalls` | 必调 skill 列表（可空） |
| `outputSchemas` | 引用的产物 schema id（必须与顶层 `outputSchemas[]` 对应） |
| `guardrails` | 可选：阶段门禁（artifact-exists / evidence-only / state-transition） |

### Step 4：协议生成

按 workflow-kernel schema 写 JSON（锚点见 `../flow-comet/reference/workflow-protocol.json`）：

- 必填顶层字段：`schemaVersion: 1`、`kind: "workflow-kernel"`、`name`、`goal`、`nodes[]`、`outputSchemas[]`、`state{}`
- **`edges` 可省略 = 顺序推进**：不写 edges 时按 `nodes[]` 数组顺序推进，同内置协议行为；写 edges 则按显式转移表路由
- 可选顶层字段：
  - `writeWhitelist`：hook 白名单（节点 id → 允许写入的路径前缀数组）。**路径支持 `<change-id>` 占位符**（与 outputSchemas 的 artifacts paths 同机制，协议复用自动适配当前 change）。**未声明时**：内置节点 id 用内置白名单表；**自定义节点 id 默认协调者白名单 `['.specs/']`**（写源码必须显式声明）
  - `taskFile`：任务文件路径字符串

生成的协议**写用户指定路径**（建议 `.specs/` 或项目根，例如 `.specs/protocols/<name>.json`），并在写前与用户确认。

### Step 5：冒烟验证

**生成的协议必须通过 `validateProtocolSchema`**（fail-closed：schemaVersion 必须为 1、nodes 必须是非空数组、writeWhitelist/taskFile 存在则校验形状）。校验命令（把 `<协议路径>` 换成实际路径）：

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { validateProtocolSchema } from './.claude/skills/flow-comet/scripts/protocol-utils.mjs';
const protocol = JSON.parse(readFileSync('<协议路径>', 'utf8'));
validateProtocolSchema(protocol);
console.log('protocol valid');
"
```

- `protocol-utils.mjs` 位于 flow-comet skill 的 `scripts/` 目录；若 bundle 未安装为 `.claude/skills/flow-comet`，按实际路径（如 `.comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/protocol-utils.mjs`）调整
- 校验不通过 → 修复字段 → 重跑，直到输出 `protocol valid`
- 校验通过后，把校验命令与输出写入该协议所在目录的验证记录（或直接回显给用户），作为协议生效证据

## 强制最小规则（质量语义，不可跳过）

1. **每节点必须有产物**：节点 `outputSchemas` 引用的 schema 必须存在于顶层 `outputSchemas[]`，且含非空 `artifacts[].paths`。禁止无产物节点——没有产物就无法做 guard 校验与恢复。
2. **每节点必须有 evidence 字段**：每个 outputSchema 必须带 `evidence: [{ id, required }]`（flowkit.*.v1 风格），供 `workflow-state.mjs record` 记录节点证据。
3. **节点 id 避免与内置 8 节点 id 冲突**：`open` / `design` / `plan` / `execute` / `subagent-execute` / `review` / `verify` / `archive` 为内置保留 id，自定义协议不得复用——防止特化校验（ADR-002 语义）误触发。
4. **协议路径由用户指定**：生成的协议写用户指定路径（建议 `.specs/` 或项目根），禁止擅自写入 bundle 或 skill 目录。

## 产物示例（最小 3 节点协议）

以下示例组合「头脑风暴 → TDD 实现 → 代码审查」三个节点，节点 id 用 `brainstorm` / `tdd` / `codereview`（第三个节点的 id 避开内置 `review`，标签仍为 Review——见强制最小规则 3），`implementation.skill` 为占位 skill 名（使用前替换为实际已安装 skill），`outputSchemas` 引用自定义 schema（`compose.*.v1`）。edges 省略 = 顺序推进。

```json
{
  "schemaVersion": 1,
  "kind": "workflow-kernel",
  "name": "brainstorm-tdd-review",
  "goal": "示例：头脑风暴 → TDD 实现 → 代码审查 的轻量自定义流程",
  "nodes": [
    {
      "id": "brainstorm",
      "label": "Brainstorm",
      "kind": "control",
      "responsibility": "澄清意图与需求，产出 BRAINSTORM.md",
      "implementation": {
        "skill": "superpowers:brainstorming",
        "operation": "require",
        "scope": "main",
        "enforcement": "guarded"
      },
      "operations": ["require", "augment"],
      "requiredSkillCalls": [],
      "outputSchemas": ["compose.brainstorm.v1"],
      "guardrails": [
        {
          "id": "brainstorm-artifacts",
          "label": "BRAINSTORM.md exists",
          "validation": "artifact-exists"
        }
      ],
      "augmentations": [],
      "satisfies": [],
      "disabled": false
    },
    {
      "id": "tdd",
      "label": "TDD",
      "kind": "control",
      "responsibility": "按 TDD 实现功能，产出 SUMMARY.md",
      "implementation": {
        "skill": "superpowers:test-driven-development",
        "operation": "require",
        "scope": "main",
        "enforcement": "guarded"
      },
      "operations": ["require", "augment"],
      "requiredSkillCalls": [],
      "outputSchemas": ["compose.tdd.v1"],
      "guardrails": [
        {
          "id": "tdd-evidence",
          "label": "SUMMARY.md produced",
          "validation": "artifact-exists"
        }
      ],
      "augmentations": [],
      "satisfies": [],
      "disabled": false
    },
    {
      "id": "codereview",
      "label": "Review",
      "kind": "control",
      "responsibility": "代码审查，产出 REVIEW.md",
      "implementation": {
        "skill": "superpowers:requesting-code-review",
        "operation": "require",
        "scope": "main",
        "enforcement": "guarded"
      },
      "operations": ["require", "augment"],
      "requiredSkillCalls": [],
      "outputSchemas": ["compose.review.v1"],
      "guardrails": [
        {
          "id": "review-artifacts",
          "label": "REVIEW.md exists",
          "validation": "artifact-exists"
        }
      ],
      "augmentations": [],
      "satisfies": [],
      "disabled": false
    }
  ],
  "outputSchemas": [
    {
      "id": "compose.brainstorm.v1",
      "description": "BRAINSTORM.md",
      "artifacts": [
        {
          "id": "brainstorm-doc",
          "kind": "file",
          "required": true,
          "paths": ["<change-id>/BRAINSTORM.md"],
          "pathBase": "specs-root"
        }
      ],
      "evidence": [
        { "id": "brainstorm-summary", "required": true }
      ]
    },
    {
      "id": "compose.tdd.v1",
      "description": "SUMMARY.md per task",
      "artifacts": [
        {
          "id": "task-summaries",
          "kind": "file",
          "required": true,
          "paths": ["<change-id>/*-SUMMARY.md"],
          "pathBase": "specs-root"
        }
      ],
      "evidence": [
        { "id": "implementation-summary", "required": true }
      ]
    },
    {
      "id": "compose.review.v1",
      "description": "REVIEW.md",
      "artifacts": [
        {
          "id": "review-doc",
          "kind": "file",
          "required": true,
          "paths": ["<change-id>/REVIEW.md"],
          "pathBase": "specs-root"
        }
      ],
      "evidence": [
        { "id": "review-summary", "required": true }
      ]
    }
  ],
  "state": {
    "kind": "workflow-run",
    "statePath": ".comet/flow-comet-state.json",
    "currentNodeField": "currentNode",
    "completedNodesField": "completedNodes",
    "evidenceField": "evidence"
  }
}
```

## 与内置协议的关系

| 维度 | 内置 8 节点协议（默认） | 自定义协议 |
|------|------------------------|-----------|
| 位置 | `../flow-comet/reference/workflow-protocol.json` | 用户指定路径（建议 `.specs/` 或项目根） |
| 加载时机 | 未显式指定时一律使用 | 用户显式指定 `--protocol` 或 `FLOW_COMET_PROTOCOL` |
| 优先级 | 最低（默认） | `--protocol` CLI 参数 > `FLOW_COMET_PROTOCOL` 环境变量 > 内置默认（resolveProtocol） |
| 驱动机制 | workflow-state.mjs + workflow-guard.mjs + comet-hook-guard.mjs | 同一套机制，零差异 |

- **加载方式**：`--protocol <path>`（或 `--protocol=<path>`）CLI 参数，或 `FLOW_COMET_PROTOCOL` 环境变量；两种方式均被工作流脚本（resolveProtocol）支持。
- **hook 白名单**：自定义协议可声明 `writeWhitelist`（节点 id → 路径前缀数组，**支持 `<change-id>` 占位符**）；缺省时内置节点 id 用内置白名单表、**自定义节点 id 用协调者默认 `['.specs/']`**（写源码必须显式声明——防 fail-open）。
- **默认不可变**：自定义协议不持久化生效，未显式指定时一切行为与内置协议完全一致；内置 8 节点协议始终可用，作为默认工作流不可被取代。
- 自定义协议与内置协议互不干扰，可并存；切换只需修改启动参数或环境变量。
