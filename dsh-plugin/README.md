# dsh-flow-comet

`dsh-flow-comet` is the official DeepSeek Harness (dsh) plugin distribution of [flow-comet](https://github.com/baobaolaodie/flow-comet). It packages the complete flow-comet skill tree, the write-guard decision core, orchestration rules, and an explicit uninstall cleanup script into one npm plugin.

> The `flow-comet` npm package name is reserved for the 1.5.0 flow-comet core npm distribution; this plugin uses the ecosystem-prefixed name `dsh-flow-comet`.

## Requirements

- dsh CLI `0.1.0-rc.6` or newer (dev preview; API signatures may change)
- Node.js 18+

## Install

Published from the npm registry:

```bash
dsh plugin --profile <name> add dsh-flow-comet
```

The officially validated install forms also include local development forms:

```bash
# Local directory (source bundle in the flow-comet repository)
dsh plugin --profile <name> add ./dsh-plugin

# Local tarball (pnpm pack output)
pnpm pack ./dsh-plugin
dsh plugin --profile <name> add ./dsh-flow-comet-1.4.2.tgz
```

- **`github:owner/repo#<sha>` direct install is not supported yet.** `dsh-plugin/` is currently a subdirectory of the flow-comet repository, so git installs resolve at the repository root instead of the plugin package. A standalone `dsh-plugin` repository is a later decision / 1.5.0 item.
- **Remote https tarball URLs are not promoted.** They are not evidenced by the official dsh publish guide; use the npm registry, local directory, or local tarball forms above.

### allowBuilds

`dsh-flow-comet` is pure ESM with zero third-party dependencies and no build step. In pnpm-based dsh environments, `allowBuilds` authorization is only required for packages with install/prepare scripts or git dependencies; for this package it is normally not needed. If your environment still asks you to approve builds (for example when installing from a git source that runs `prepare`), add the package to the `allowBuilds` list in `pnpm-workspace.yaml` as instructed by your pnpm/dsh version.

## Activation

The plugin uses **project-level activation by default**: skills are activated when the session project root contains `.comet/` or `.specs/` traces. Global activation is opt-in through plugin config (`mode: global`); in global mode, injection still only happens for projects with flow-comet traces.

On activation, the plugin:

1. **Injects orchestration rules** into `<project>/AGENTS.md` inside a managed block (`<!-- Managed by flow-comet prepare-env -->` ...), preserving user content outside the block.
2. **Copies the workflow protocol** to `<project>/reference/.flow-comet-workflow-protocol.json` (idempotent overwrite; this satisfies the protected-read requirement) and points `FLOW_COMET_PROTOCOL` at it. Cleanup removes this copy.
3. **Registers the flow-comet skill provider** and installs `tools/pre-execute` write-guard interception, calling the existing `comet-hook-guard.mjs` CLI as a child process.

## Uninstall

`dsh plugin remove` removes only the bundle layer: it does not boot the plugin and does not run disposers. Therefore, uninstall is an explicit two-step process:

```bash
node <plugin-path>/scripts/cleanup.mjs
dsh plugin --profile <name> remove dsh-flow-comet
```

`cleanup.mjs` strips the AGENTS.md managed block, removes the protocol copy, clears injection records, and preserves user content outside the managed block.

## Audit log

The plugin writes append-only audit records to `$DSH_HOME/flow-comet-audit.jsonl`. `cleanup.mjs` does **not** delete this file — it is shared across profiles and intentionally retained for manual deletion.

## Relationship to flow-comet

`dsh-flow-comet` is the dsh platform distribution of flow-comet. It contains the same skill tree, decision scripts, orchestration rules, and `INSTALLED_VERSION` as the flow-comet bundle. The flow-comet engine and protocol are unchanged: the plugin reuses the existing `comet-hook-guard.mjs` decision core through a subprocess, so the engine remains zero-modified across platforms.

See [flow-comet installation docs](https://github.com/baobaolaodie/flow-comet/blob/main/docs/INSTALLATION.md) for the full platform installation guide.
