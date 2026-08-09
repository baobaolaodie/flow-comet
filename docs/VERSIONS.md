<div align="right">

[English](VERSIONS.md) · [中文](VERSIONS-zh.md)

</div>

# Versions & Compatibility

## Version policy

| Item | Description |
|------|-------------|
| **Current version** | v1.3.0 (recorded in [CHANGELOG.md](../CHANGELOG.md) and git tag — created at each release; v1.0.0 = first stable: 8-node workflow + three defense layers + guard validation) |
| **Versioning** | Semantic Versioning: feature release → minor (1.2.0), bug fix → patch (1.1.1), breaking change → major (2.0.0); bump at the end of each feature release |
| **Bundle version decoupling** | `bundle.yaml`/`skill.yaml` version stays 1.0.0 (decoupled from release versioning); git tag + CHANGELOG are the single source of truth |

## Dependencies

| Type | Item |
|------|------|
| **Required** | [flow-kit](https://github.com/rihebty/flow-kit) (methodology and artifact templates); Claude Code |
| **Platform** | Claude Code (skill system); other platforms (Codex/Gemini/Cursor) not guaranteed |
| **Runtime** | Node.js ESM (Node ≥ 18); artifact language follows the project's primary language |

## Compatibility strategy

- Old changes / old states auto-fill default fields (executionMode/branchMode/enablePrReview); changes without a branch run unchanged — backward compatible
- Progressive WARN (not BLOCK) for legacy change re-entry (missing redEvidence/greenEvidence, pure-string handoff)
- Regression baseline: `guard-self-test.mjs` 87 scenarios green (required after every change)

## Release checklist (per release)

Releases are **batched**: `dev` accumulates feature changes; one release PR ships the batch. Before releasing, present a **release approval sheet** (changes included / verification results / version) and get one approval.

1. Update CHANGELOG (Added/Changed/Fixed — with PR links)
2. Update README version badge + version status
3. `git tag vX.Y.Z` + push --tags
4. prepare-env release to all installed copies (main `.claude/` + target projects) when functionality changed
5. Sync `dev` to `main` after the release PR merges
