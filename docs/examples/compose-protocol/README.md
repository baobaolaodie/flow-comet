<div align="right">

[English](README.md) · [中文](README-zh.md)

</div>

# compose-protocol example: custom protocol (brainstorm → tdd → codereview)

> A complete example of composing three installed skills into a custom workflow via `/flow-comet-compose` — protocol JSON + smoke-validation record. Node ids avoid the built-in 8-node ids (`brainstorm`/`tdd`/`codereview`), so specialization validation never misfires.

## Files

| File | Description |
|------|-------------|
| `protocol.json` | Custom protocol (brainstorm → tdd → codereview; `writeWhitelist` uses the `<change-id>` placeholder — protocols reuse across changes with automatic adaptation) |
| `VALIDATION.md` | `validateProtocolSchema` smoke-validation record (protocol effectiveness evidence) |

## Usage

1. Copy `protocol.json` into your project (suggest `.specs/protocols/<name>.json`)
2. Replace `implementation.skill` with skills actually installed in your project (the example uses superpowers placeholders)
3. Smoke-validate (see the command in VALIDATION.md)
4. Start: `/flow-comet` (with `FLOW_COMET_PROTOCOL` env pointing at the protocol, or Claude attaches `--protocol`)

## Protocol essentials

- **Every node has artifacts**: `outputSchemas` references carry non-empty `artifacts[].paths`
- **Every node has evidence**: each schema carries `evidence: [{ id, required }]`
- **Writing source code requires declaration**: `writeWhitelist.tdd` must declare source paths (e.g. `calc/`, `tests/`) — undeclared custom nodes default to the coordinator whitelist `.specs/`, and source writes are BLOCKED by the hook
- **`<change-id>` placeholder**: supported in both `writeWhitelist` and artifact paths — protocols reuse across changes without manual path edits
