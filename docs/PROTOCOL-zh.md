<div align="right">

[English](PROTOCOL.md) · [中文](PROTOCOL-zh.md)

</div>

# 自定义协议（flow-comet-compose）

`/flow-comet-compose` 是横向命令（与 `/flow-comet-evolve`、`/flow-comet-health` 同类，**不属于 8 节点流程**）：引导你把任意已安装 skill 组合成自定义工作流协议（JSON），生成后由同一套机制完整驱动（状态路由 / guard 校验 / hook 拦截），无需新增任何运行时能力。内置 8 节点协议是默认工作流，**不可被取代**。

## 协议加载方式

| 方式 | 说明 |
|------|------|
| `--protocol <path>`（或 `--protocol=<path>`） | CLI 参数——由 Claude 在流程中自动附带 |
| `FLOW_COMET_PROTOCOL` | 环境变量——写入项目环境（如 `.claude/settings.json` 的 `env`）可持久生效 |

优先级：`--protocol` CLI > `FLOW_COMET_PROTOCOL` 环境变量 > 内置默认（resolveProtocol）。未显式指定时一切行为与内置协议完全一致。

## 协议最小结构

| 字段 | 说明 |
|------|------|
| `schemaVersion` | `1` |
| `kind` | `"workflow-kernel"` |
| `name` | 协议名 |
| `nodes[]` | 节点数组：`id`（避开内置 8 节点 id）、`implementation.skill`、`requiredSkillCalls`、`outputSchemas` |
| `outputSchemas[]` | 产物 schema：`artifacts[].paths` + `evidence` |
| `writeWhitelist`（可选） | hook 白名单（节点 id → 允许写入的路径前缀数组；**支持 `<change-id>` 占位符**——协议复用自动适配）；未声明时内置 id 用内置表、自定义 id 默认协调者白名单 `['.specs/']`（写源码必须显式声明） |
| `taskFile`（可选） | 任务文件路径，缺省 `TASK.md` |

## 强制最小规则

1. **每节点必须有产物**：`outputSchemas` 引用的 schema 必须存在于顶层 `outputSchemas[]`，且 `artifacts[].paths` 非空——没有产物就无法做 guard 校验与恢复
2. **每节点必须有 evidence**：每个 outputSchema 必须带 `evidence: [{ id, required }]`，供 `workflow-state.mjs record` 记录
3. **节点 id 避开内置 8 节点 id**：`open`/`design`/`plan`/`execute`/`subagent-execute`/`review`/`verify`/`archive` 为保留 id——复用会触发特化校验（ADR-002 语义）

## 最小协议示例

```json
{
  "schemaVersion": 1,
  "kind": "workflow-kernel",
  "name": "compose-demo",
  "nodes": [
    { "id": "brainstorm",  "outputSchemas": ["compose.notes.v1"],    "requiredSkillCalls": [], "augmentations": [] },
    { "id": "tdd",         "outputSchemas": ["compose.tdd.v1"],      "requiredSkillCalls": [], "augmentations": [] },
    { "id": "codereview",  "outputSchemas": ["compose.verdict.v1"],  "requiredSkillCalls": [], "augmentations": [] }
  ],
  "outputSchemas": [
    {
      "id": "compose.notes.v1",
      "artifacts": [
        { "id": "notes", "kind": "file", "required": true,
          "paths": ["<change-id>/notes.md"], "pathBase": "specs-root" }
      ],
      "evidence": [ { "id": "notes", "required": true } ]
    }
  ],
  "writeWhitelist": { "brainstorm": [".specs/"] }
}
```

> 每个节点必须有非空 `outputSchemas` 引用 + 每条 schema 必须带 `evidence`；`writeWhitelist` 省略时内置 id 用内置表、自定义 id 用协调者默认 `['.specs/']`（写源码必须显式声明）。完整生成流程见 `/flow-comet-compose` skill 的「产物示例」。

## 与内置协议的关系

| 维度 | 内置 8 节点协议（默认） | 自定义协议 |
|------|------------------------|-----------|
| 位置 | `reference/workflow-protocol.json` | 用户指定路径（建议 `.specs/` 或项目根） |
| 加载时机 | 未显式指定时一律使用 | 用户显式指定 `--protocol` 或 `FLOW_COMET_PROTOCOL` |
| 优先级 | 最低（默认） | `--protocol` CLI > `FLOW_COMET_PROTOCOL` 环境变量 > 内置默认 |
| 驱动机制 | workflow-state + workflow-guard + comet-hook-guard | 同一套机制，零差异 |

- **并存、互不干扰**：切换只需修改启动参数或环境变量
- **默认不可变**：自定义协议不持久化生效，未显式指定时一切行为与内置协议完全一致
- 内置 8 节点协议始终可用，作为默认工作流**不可被取代**
- **质量防线不稀释**：自定义协议同样物理校验（evidence/artifacts/Return Contract/verify 真实执行/fail-closed）；特化校验仅内置节点 id 触发

完整交互流程、逐节点绑定字段与冒烟验证：见 `/flow-comet-compose` skill。
