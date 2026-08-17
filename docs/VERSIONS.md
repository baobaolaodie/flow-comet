<div align="right">

[English](VERSIONS.md) · [中文](VERSIONS-zh.md)

</div>

# Versions & Compatibility

## Version policy

| Item | Description |
|------|-------------|
| **Current version** | v1.4.2. Release truth: [CHANGELOG.md](../CHANGELOG.md) + git tag (created at the release step); README badge mirrors it; `skills/flow-comet/INSTALLED_VERSION` is checked installed-copy metadata (git describe of the source repo); the dsh plugin package `dsh-flow-comet` is version-synced at 1.4.2. v1.0.0 = first stable: 8-node workflow + three defense layers + guard validation |
| **Versioning** | Semantic Versioning: feature release → minor (1.2.0), bug fix → patch (1.1.1), breaking change → major (2.0.0); bump at the end of each feature release |
| **Bundle version decoupling** | `bundle.yaml`/`skill.yaml` version stays 1.0.0 (decoupled from release versioning); git tag + CHANGELOG are the single source of truth |

## Dependencies

| Type | Item |
|------|------|
| **Required** | [flow-kit](https://github.com/rihebty/flow-kit) (methodology and artifact templates); Claude Code |
| **Platform** | Claude Code (skill system, default); Codex (skills/rules/hook via `prepare-env --platform codex`, see [Installation](INSTALLATION.md#platforms)); DeepSeek Harness (dsh plugin `dsh-flow-comet`, see [Installation](INSTALLATION.md#option-c--deepseek-harness-dsh-plugin)); other platforms (Gemini/Cursor) not guaranteed |
| **Runtime** | Node.js ESM (Node ≥ 18); artifact language follows the project's primary language |

## Compatibility strategy

- Old changes / old states auto-fill default fields (executionMode/branchMode/enablePrReview); changes without a branch run unchanged — backward compatible
- Progressive WARN (not BLOCK) for legacy change re-entry (missing redEvidence/greenEvidence, pure-string handoff)
- Regression baseline (two-tier): `guard-self-test.mjs` 144 scenarios + `system-test.mjs` 59 items green (required after every change)
- dsh plugin package `dsh-flow-comet` is version-synced with flow-comet releases; uninstall uses the bundled `scripts/cleanup.mjs` first (see [Installation](INSTALLATION.md#option-c--deepseek-harness-dsh-plugin))

## Release checklist (per release)

Releases are **batched**: `dev` accumulates feature changes; one release PR ships the batch. Before releasing, present a **release approval sheet** (changes included / verification results / version) and get one approval.

1. Update CHANGELOG (Added/Changed/Fixed — with PR links)
2. Update README version badge + version status
3. `git tag vX.Y.Z` + push --tags
4. prepare-env release to all installed copies (main `.claude/` + target projects) when functionality changed
5. Fast-forward `dev` to `main` (right after the release merge): the release PR merge makes dev's tip an ancestor of main, so `git merge main` on dev is a zero-commit fast-forward — dev becomes identical to main (no sync merge commit)
