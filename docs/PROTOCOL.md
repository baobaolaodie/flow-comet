<div align="right">

[English](PROTOCOL.md) · [中文](PROTOCOL-zh.md)

</div>

# Custom Protocols (flow-comet-compose)

`/flow-comet-compose` is a side command (same family as `/flow-comet-evolve` and `/flow-comet-health`, **not part of the 8-node flow**). It guides you through composing any installed skill into a custom workflow protocol (JSON), which is then driven by the same engine — state routing, guard validation, and hook interception — with no new runtime capability required. The built-in 8-node protocol is the default workflow and **cannot be replaced**.

## Loading a protocol

| Method | Description |
|--------|-------------|
| `--protocol <path>` (or `--protocol=<path>`) | CLI argument — attached automatically by Claude during the flow |
| `FLOW_COMET_PROTOCOL` | Environment variable — persistent when set in project env (e.g. `.claude/settings.json` `env`) |

Priority: `--protocol` CLI > `FLOW_COMET_PROTOCOL` env > built-in default (resolveProtocol). Without explicit specification, everything behaves exactly like the built-in protocol.

## Minimal protocol structure

| Field | Description |
|-------|-------------|
| `schemaVersion` | `1` |
| `kind` | `"workflow-kernel"` |
| `name` | protocol name |
| `nodes[]` | node array: `id` (avoid built-in 8-node ids), `implementation.skill`, `requiredSkillCalls`, `outputSchemas` |
| `outputSchemas[]` | artifact schemas: `artifacts[].paths` + `evidence` |
| `writeWhitelist` (optional) | hook whitelist (node id → allowed path-prefix array; **supports `<change-id>` placeholder** — protocols reuse across changes); when omitted, built-in ids use the built-in table, custom ids default to coordinator whitelist `['.specs/']` (writing source code requires explicit declaration) |
| `taskFile` (optional) | task file path, default `TASK.md` |

## Mandatory minimum rules

1. **Every node must have artifacts**: `outputSchemas` references must exist in top-level `outputSchemas[]` with non-empty `artifacts[].paths` — no artifact, no guard validation or recovery
2. **Every node must have evidence**: each outputSchema carries `evidence: [{ id, required }]`, for `workflow-state.mjs record`
3. **Node ids must avoid the built-in 8-node ids**: `open`/`design`/`plan`/`execute`/`subagent-execute`/`review`/`verify`/`archive` are reserved — reusing them triggers specialization validation (ADR-002 semantics)

## Minimal protocol example

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

> Each node must have non-empty `outputSchemas` references, and each schema must carry `evidence`; when `writeWhitelist` is omitted, built-in ids use the built-in table and custom ids default to the coordinator whitelist `['.specs/']` (writing source code requires explicit declaration). Full generation flow: see the `/flow-comet-compose` skill's artifact example.

## Relationship with the built-in protocol

| Dimension | Built-in 8-node protocol (default) | Custom protocol |
|-----------|-----------------------------------|-----------------|
| Location | `reference/workflow-protocol.json` | user-specified path (suggest `.specs/` or project root) |
| Loading | always used when nothing is specified | explicit `--protocol` or `FLOW_COMET_PROTOCOL` |
| Priority | lowest (default) | `--protocol` CLI > `FLOW_COMET_PROTOCOL` env > built-in default |
| Engine | workflow-state + workflow-guard + comet-hook-guard | the same engine, zero difference |

- **Coexistence**: switching only requires changing the launch argument or environment variable
- **Default unchanged**: custom protocols are not persistent; without explicit specification everything behaves exactly like the built-in protocol
- The built-in 8-node protocol always remains available as the default workflow and **cannot be replaced**
- **Quality defense is not diluted**: custom protocols undergo the same physical validation (evidence/artifacts/Return Contract/verify execution/fail-closed); specialization validation only fires for built-in node ids

Full interactive flow, per-node binding fields, and smoke validation: see the `/flow-comet-compose` skill.
