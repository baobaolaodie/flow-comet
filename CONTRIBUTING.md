<div align="right">

[English](CONTRIBUTING.md) · [中文](CONTRIBUTING-zh.md)

</div>

# Contributing

Thanks for contributing to flow-comet. This guide covers the branch model, pull-request workflow, merge rules, and code standards — the repository is protected by these rules, so following them keeps the flow smooth.

## Branch model

```
feat/xxx ──PR(merge commit)──▶ dev        (integration branch — full history)
                                      │
dev ──PR(squash)──▶ main               (release branch — clean history)
```

| Branch | Role | Merge style | History |
|--------|------|-------------|---------|
| `main` | Release branch | **squash** | Clean — one commit per release/feature batch |
| `dev` | Integration branch | **merge commit** | Full — every feature commit preserved, traceable |
| `feat/*` | Development branch | — | Working history, deleted after merge |

**Why this split**: `dev` preserves the complete history of every TDD fix (traceability — each commit is a RED→GREEN loop), while `main` stays clean for release and changelog purposes.

## Pull-request workflow

1. **Create a feature branch** from `dev` (prefix `feat/`, or `fix/` for bug fixes):

   ```bash
   git checkout dev
   git checkout -b feat/<description>
   ```

2. **Develop** on the feature branch — follow the [Development standards](#development-standards) below.
3. **Open a PR** into `dev` (base `dev`, head `feat/<description>`). Fill in the PR description: what changed, why, verification evidence.
4. **Get review approval** — one approving review is required (branch protection).
5. **Merge into `dev`** — **merge commit** (preserves feature history).
6. **Release PR** — when `dev` is ready, open a PR into `main` (base `main`, head `dev`). Merge with **squash** — one clean commit per release.
7. After merge, delete the feature branch.

## Branch protection (reference)

| Rule | `main` | `dev` |
|------|--------|-------|
| Require pull request reviews | ✅ (1 approve) | ✅ (1 approve) |
| Block force pushes | ✅ | ❌ allowed (integration rebases) |
| Block deletions | ✅ | ✅ |
| Dismiss stale reviews | ✅ | ✅ |

## Development setup

- **Runtime**: Node.js ≥ 18 (ESM)
- **Repo**: clone, then verify the regression baseline runs:
  `node .claude/skills/flow-comet/scripts/guard-self-test.mjs` → `ALL 82 SCENARIOS PASSED`
- **Authoring environment**: Claude Code (skills/hooks run in Claude Code sessions); the hook is installed via `prepare-env` into your project's `.claude/`
- **For mechanism work**: read [docs/MECHANISM.md](docs/MECHANISM.md) for the mechanism semantics (behavior layer) before touching scripts

## Issues (reporting bugs / proposing features)

Open an issue with a clear description:

- **Bug**: what happened vs expected, reproduction steps (or the exact BLOCKED/WARN message), environment (Node version, install method)
- **Feature proposal**: the goal, the workflow you want, any skill combination you have in mind (see [PROTOCOL.md](docs/PROTOCOL.md) for custom protocols)

After the issue is confirmed: bug fixes use a `fix/` branch, features use a `feat/` branch — both PR into `dev` per the [Pull-request workflow](#pull-request-workflow).

## Development standards

- **Authoritative source**: edit skills/scripts under `.comet/bundle-drafts/flow-comet/skills/` (the single source; `.claude/` copies are install artifacts — update them via `prepare-env`, never by hand)
- **TDD**: every mechanism fix starts with a RED scenario in `guard-self-test.mjs` (watch it fail for the right reason), then GREEN, then full regression
- **Regression baseline**: `node .claude/skills/flow-comet/scripts/guard-self-test.mjs` → `ALL 82 SCENARIOS PASSED` (mandatory after every change)
- **Documentation sync**: behavior-layer docs live in `docs/` (bilingual EN/zh — keep both in sync when a doc changes); implementation details stay out of public docs
- **Backward compatibility**: old changes/states keep working — progressive WARN over BLOCK
- **No internal terms in public docs**: no batch ids (E-NN), no dogfood/T-FIX/D- references, no pointers to `docs/internal/`

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/):

> **Commit messages are public artifacts** — they are visible in the git history on GitHub. Write them as plain descriptions: **no internal identifiers** (batch codes like `batch-H`, defect/task ids like `T-FIX-19` / `P1` / `S79`, internal terms like `dogfood` / `round2`). Use the same public-facing standard as CHANGELOG and the docs. Example: `fix: brooks 6-dimension self-check two-tier fallback` — not `fix: T-FIX-19 ...`.

```
<type>(<scope>): <subject>

feat:      new feature / mechanism
fix:       bug fix (mechanism, script, hook)
refactor:  behavior-preserving restructuring
perf:      performance improvement
docs:      documentation (README, docs/, CHANGELOG)
test:      test-only changes (guard-self-test scenarios)
build:     build/tooling changes (scripts, installer)
ci:        CI pipeline changes
chore:     tooling, release wrap-up
revert:    reverts a previous commit
```

Examples:

```
fix: init state gains status:'running' + three-tier hook semantics
docs: README restructured into multi-document bilingual layout
test: BOM-tolerance scenarios — state/evidence files with UTF-8 BOM parse normally
```

**Branch prefix alignment**: the prefix should match the change type, not a fixed default. Two ways to create a branch — pick by how you develop:

- **Pure git development** (no flow-comet workflow): `git checkout -b feat/<description>` (or `fix/`) as in the [Pull-request workflow](#pull-request-workflow)
- **Through the flow-comet workflow**: `init` creates the branch for you — specify the matching prefix:

```bash
node .claude/skills/flow-comet/scripts/workflow-state.mjs init <change-id> --branch-prefix feat/   # feature work
node .claude/skills/flow-comet/scripts/workflow-state.mjs init <change-id> --branch-prefix fix/    # bug fixes
node .claude/skills/flow-comet/scripts/workflow-state.mjs init <change-id> --branch-prefix docs/   # documentation
```

The built-in default prefix is `change/` (backward-compatible with existing changes); this repository's convention is to specify the type prefix explicitly so the branch matches the change type — same convention as the manual `feat/`/`fix/` branches.

## Review requirements

- **PR description**: what changed, why, verification evidence (test output, real-session evidence)
- **Scope**: code change → accompany tests + regression; doc change → both languages in sync
- **One approving review** required (branch protection); a new push invalidates the previous approval (dismiss stale reviews)

## Keeping a PR current

While a PR is open, keep it up to date with `dev`:

```bash
git fetch origin
git rebase origin/dev        # rebase your feature branch onto the latest dev
# resolve conflicts if any, then:
node .claude/skills/flow-comet/scripts/guard-self-test.mjs   # re-run regression
git push --force-with-lease origin feat/<description>     # force push is allowed on feature branches
```

Force push is allowed on your own feature branch (no protection); a new push invalidates previous approvals (dismiss stale reviews), so request re-review after updating.

## Release process (maintainers)

Per release (see [VERSIONS.md](docs/VERSIONS.md)):

1. Update CHANGELOG (Added/Changed/Fixed — bilingual)
2. Update README version badge
3. `git tag vX.Y.Z` + push --tags (after merging the release PR into main)
4. prepare-env release to all installed copies (main `.claude/` + target projects) — verify each copy's `guard-self-test` after release
