<div align="right">

[English](CONTRIBUTING.md) · [中文](CONTRIBUTING-zh.md)

</div>

# Contributing

Thanks for contributing to flow-comet. This guide covers the branch model, pull-request workflow, merge rules, and code standards — the repository is protected by these rules, so following them keeps the flow smooth.

## Branch model

```
feat/xxx ──PR(squash)──▶ dev          (integration branch — change-level commits)
                                      │
dev ──PR(squash)──▶ main   (release branch — one squash commit per release)
```

| Branch | Role | Merge style | History |
|--------|------|-------------|---------|
| `main` | Release branch | **squash** | One release commit per PR (message summarizes dev change-level commits) |
| `dev` | Integration branch | **squash** | One change-level commit per PR — internal fix detail lives in the PR's Commits list |
| `feat/*` | Development branch | — | Working history, deleted after merge |

**Why this split**: `dev` carries one **change-level commit per PR** (squash) — a clean, stable sequence where each PR is one unit; the PR's internal commit history (each TDD fix) remains browsable in that PR's Commits list. `main` receives **one squash commit per release** — the release commit message summarizes dev.s accumulated change-level commits; release history stays clean with no internal process detail.

## Pull-request workflow

1. **Create a feature branch** from `dev` (prefix `feat/`, or `fix/` for bug fixes) — **all changes (including documentation) must go through a feature branch; never commit directly to `dev`**:

   ```bash
   git checkout dev
   git checkout -b feat/<description>
   ```

2. **Develop** on the feature branch — follow the [Development standards](#development-standards) below.
3. **Open a PR** into `dev` (base `dev`, head `feat/<description>`). **Use the repository PR template** (`.github/PULL_REQUEST_TEMPLATE.md` — scope / verification / self-check checklists). Fill in what changed, why, and verification evidence. **Keep the full checklist visible**: mark involved items `[x]` and leave non-involved items `[ ]` — do not delete unchecked items (the checklist is the reviewer's completeness signal).
4. **Get review approval** — one approving review is required (branch protection).
5. **Merge into `dev`** — **squash** merge: one **change-level commit** per PR (the PR's internal commits remain browsable in its Commits list). `dev` **accumulates** changes — do not release after every change.
6. **Release PR (batched)** — when `dev` has accumulated a set of related changes (a feature batch or a maintenance batch), open **one** release PR into `main` (base `main`, head `dev`). Merge with **squash** — one release commit whose message summarizes dev.s accumulated change-level commits; each change.s internal detail stays browsable in its PR Commits list.
7. After merge, delete the feature branch.

**Maintenance batches**: pure-documentation or cleanup changes without behavior impact may accumulate on a single branch (e.g. `docs/maintenance-<date>`) and ship as **one** PR into `dev` — reducing PR count without losing traceability.

## Branch protection (reference)

| Rule | `main` | `dev` |
|------|--------|-------|
| Require pull request reviews | ✅ (1 approve) | ✅ (1 approve) |
| Block force pushes | ✅ | ✅ |
| Block deletions | ✅ | ✅ |
| Dismiss stale reviews | ✅ | ✅ |

**Dev syncs main** (after each release merge into `main`):

```bash
git checkout dev
git merge --no-ff main -m "sync: main → dev（<summary>）"
git push origin dev
```

**Hotfix fast path** (production emergency fix, independent of the dev release cadence):

```bash
git checkout main
git checkout -b hotfix/<description>
# fix → commit (fix: subject) → test
# hotfix merges via squash — one clean commit into main, consistent with the release squash policy
git checkout main && git merge --squash hotfix/<description> && git commit -m "fix: hotfix <description>"
git checkout dev && git merge --no-ff main -m "sync: main → dev（hotfix <description>）"
git branch -d hotfix/<description>
```

## Development setup

- **Runtime**: Node.js ≥ 18 (ESM)
- **Repo**: clone, then verify the regression baseline runs:
  `node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs` → `ALL 112 SCENARIOS PASSED`
- **Authoring environment**: Claude Code (skills/hooks run in Claude Code sessions); the hook is installed via `prepare-env` into your project's `.claude/`
- **For mechanism work**: read [docs/MECHANISM.md](docs/MECHANISM.md) for the mechanism semantics (behavior layer) before touching scripts

### CI enforcement (no local setup needed)

CI runs automatically on every PR and push — it enforces the repository conventions server-side (regression suite with scenario-count and public-artifact code self-checks, script syntax, BOM guard, installer reproducibility, workflow yaml validity, PR template completeness, version consistency, CHANGELOG PR links, dead links). Nothing to install or configure locally.

Before pushing, the only local pre-check you need is the regression baseline:

```bash
node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs   # → ALL 112 SCENARIOS PASSED
```

CI handles everything else.

## Issues (reporting bugs / proposing features)

Open an issue with a clear description:

- **Bug**: what happened vs expected, reproduction steps (or the exact BLOCKED/WARN message), environment (Node version, install method)
- **Feature proposal**: the goal, the workflow you want, any skill combination you have in mind (see [PROTOCOL.md](docs/PROTOCOL.md) for custom protocols)

After the issue is confirmed: bug fixes use a `fix/` branch, features use a `feat/` branch — both PR into `dev` per the [Pull-request workflow](#pull-request-workflow).

## Development standards

- **Authoritative source**: edit skills/scripts under `.comet/bundle-drafts/flow-comet/skills/` (the single source; `.claude/` copies are install artifacts — update them via `prepare-env`, never by hand)
- **TDD**: every mechanism fix starts with a RED scenario in `guard-self-test.mjs` (watch it fail for the right reason), then GREEN, then full regression
- **Regression baseline**: `node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs` → `ALL 112 SCENARIOS PASSED` (mandatory after every change)
- **Documentation sync**: behavior-layer docs live in `docs/` (bilingual EN/zh — keep both in sync when a doc changes); implementation details stay out of public docs
- **Bilingual discipline**: English docs contain no Chinese (except the language switcher, flow-kit artifact section names, and runtime message quotes); Chinese docs contain no long English sentences (except commands, URLs, and proper terms). Local optional check: `node scripts/check-docs-local.mjs` (a gitignored local tool — English-doc zero-Chinese, Chinese-doc zero-English-sentences, bilingual symmetry, version/scenario consistency)
- **Backward compatibility**: old changes/states keep working — progressive WARN over BLOCK
- **Public docs stay jargon-free**: no codes, numbers, or process shorthand in README/docs/CHANGELOG/commit messages

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/):

> **Commit messages are public artifacts** — they are visible in the git history on GitHub. Write them as plain descriptions: **no codes, numbers, or jargon**. Use the same public-facing language as CHANGELOG and the docs. Example: `fix: brooks 6-dimension self-check two-tier fallback`.

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
node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs   # re-run regression
git push --force-with-lease origin feat/<description>     # force push is allowed on feature branches
```

Force push is allowed on your own feature branch (no protection); a new push invalidates previous approvals (dismiss stale reviews), so request re-review after updating.

## Release process (maintainers)

**Release approval sheet** — before every release, present this sheet to the user and get **one** approval; then execute the full release (merge release PR + distribute + tag) without further per-step prompts:

```markdown
## Release approval sheet

- Changes: PR list + one-line summary each
- Verification: regression (112 scenarios) / installed-copy checks
- Version: X.Y.Z (doc-only batches may skip the bump)
```

Per release (see [VERSIONS.md](docs/VERSIONS.md)):

1. Update CHANGELOG (Added/Changed/Fixed — bilingual)
2. Update README version badge
3. `git tag vX.Y.Z` + push --tags (after merging the release PR into main)
4. prepare-env release to all installed copies (main `.claude/` + target projects) — verify each copy's `guard-self-test` after release

**Release PR specifics**:
- The release PR (dev → main) lists dev.s change-level commits (by design — each PR = one change); merging it produces one clean squash release commit on main
- Merge with `gh pr merge --squash` — the squash message is written in public-facing language (release summary), so internal process detail never enters main.s history
