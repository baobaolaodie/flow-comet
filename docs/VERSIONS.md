<div align="right">

[English](VERSIONS.md) · [中文](VERSIONS-zh.md)

</div>

# Versions & Compatibility

## Version policy

| Item | Description |
|------|-------------|
| **Current version** | v1.5.0-rc.1. Release truth: [CHANGELOG.md](../CHANGELOG.md) + git tag (created at the release step); README badge mirrors it; `skills/flow-comet/INSTALLED_VERSION` is checked installed-copy metadata (git describe of the source repo). The dsh platform (via `prepare-env --platform dsh`) carries the same version marker in its project-level skill copy; there is no separate npm package (a later item). v1.0.0 = first stable: 8-node workflow + three defense layers + guard validation |
| **Versioning** | Semantic Versioning: feature release → minor (1.2.0), bug fix → patch (1.1.1), breaking change → major (2.0.0); bump at the end of each feature release |
| **Bundle version decoupling** | `bundle.yaml`/`skill.yaml` version stays 1.0.0 (decoupled from release versioning); git tag + CHANGELOG are the single source of truth |

## Dependencies

| Type | Item |
|------|------|
| **Required** | [flow-kit](https://github.com/rihebty/flow-kit) (methodology and artifact templates); Claude Code |
| **Platform** | Claude Code (skill system, default); Codex (skills/rules/hook via `prepare-env --platform codex`, see [Installation](INSTALLATION.md#platforms)); DeepSeek Harness (project-level skill + global bridge loader via `prepare-env --platform dsh`, see [Installation](INSTALLATION.md#option-c--deepseek-harness-dsh-platform)); other platforms (Gemini/Cursor) not guaranteed |
| **Runtime** | Node.js ESM (Node ≥ 18); artifact language follows the project's primary language |

## Compatibility strategy

- Old changes / old states auto-fill default fields (executionMode/branchMode/enablePrReview); changes without a branch run unchanged — backward compatible
- Progressive WARN (not BLOCK) for legacy change re-entry (missing redEvidence/greenEvidence, pure-string handoff)
- Regression baseline (two-tier): `guard-self-test.mjs` 171 scenarios + `system-test.mjs` 61 items green (required after every change)
- dsh platform: the project-level skill copy carries an `INSTALLED_VERSION` marker synced with flow-comet releases; uninstall via `prepare-env --purge --platform dsh --yes` (see [Installation](INSTALLATION.md#option-c--deepseek-harness-dsh-platform))

## Release checklist (per release)

Releases are **batched**: `dev` accumulates feature changes; one release PR ships the batch. Before releasing, present a **release approval sheet** (changes included / verification results / version) and get one approval.

1. Update CHANGELOG (Added/Changed/Fixed — with PR links)
2. Update README version badge + version status
3. `git tag vX.Y.Z` + push --tags
4. prepare-env release to all installed copies (main `.claude/` + target projects) when functionality changed
5. Fast-forward `dev` to `main` (right after the release merge): the release PR merge makes dev's tip an ancestor of main, so `git merge main` on dev is a zero-commit fast-forward — dev becomes identical to main (no sync merge commit)
