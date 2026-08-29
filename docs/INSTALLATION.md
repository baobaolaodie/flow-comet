<div align="right">

[English](INSTALLATION.md) · [中文](INSTALLATION-zh.md)

</div>

# Installation

## Requirements

- [Claude Code](https://claude.ai/code), installed and authenticated (default platform)
- [Codex](https://github.com/openai/codex) CLI, installed (skills/rules/hook support as described under [Platforms](#platforms))
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) CLI `0.1.0-rc.6` or newer for the dsh platform (optional; see [Option C](#option-c--deepseek-harness-dsh-platform))
- [flow-kit](https://github.com/rihebty/flow-kit) installed in the target project — the installer obtains it automatically (locked snapshot; existing copies are only inspected read-only, see [flow-kit acquisition](#flow-kit-acquisition)):

```bash
cd <target project>
git clone https://github.com/rihebty/flow-kit.git flow-kit
```

Verify flow-kit: `ls <target project>/flow-kit/templates/` should list workflow artifact templates (CHANGE.md, REQUIREMENT.md, etc.).

## Option A · prepare-env installer (recommended)

Automated installation from this repository (no Comet CLI required):

```bash
cd <flow-comet repo>
node scripts/prepare-env.mjs --target <absolute path to target project>          # Claude Code (default)
node scripts/prepare-env.mjs --target <absolute path to target project> --platform codex   # Codex
node scripts/prepare-env.mjs --target <absolute path to target project> --platform dsh     # DeepSeek Harness
node scripts/prepare-env.mjs --target <absolute path to target project> --platform claude-code,dsh   # multi-platform, comma-separated
node scripts/prepare-env.mjs --target <absolute path to target project> --platform all     # all platforms
```

On an interactive terminal, the first run prompts for the platform with a direction-key multi-select (arrow keys + space to toggle, Enter to confirm; pre-checked from existing traces — see the selection chain under [Platforms](#platforms)): `@clack/prompts` is the primary path, with an automatic readline number/comma multi-select fallback when the dependency is not installed, offline, or stdin has no raw mode; `FLOW_COMET_FORCE_READLINE=1` forces the fallback for testing.

`prepare-env` does:

1. **Generates/overwrites `rules/` and `skills/`** — all flow-comet* skills, from the authoritative source `.comet/bundle-drafts/flow-comet/`
2. **Injects the hook into `settings.local.json`** — read-merge-write: preserves everything already in the target project (`permissions`, custom hooks, other matcher groups), only injects/updates the comet-hook-guard entry under `hooks.PreToolUse` (existing comet hooks are replaced, not duplicated — idempotent). First-time creation writes only the hook entry; existing files are merged.
3. **Ensures `flow-kit` in the target project** — clones the upstream and checks out the locked snapshot when missing; an existing upstream clone is only inspected read-only (current HEAD vs the locked snapshot is reported); a same-name non-clone directory is skipped with guidance; a network failure warns and continues (see [flow-kit acquisition](#flow-kit-acquisition))

**Non-destructive by default**: nothing under the target project's install root (`.claude/` for Claude Code, `.agents/` for Codex) is deleted (`commands/`, custom skills, custom config all preserved). Explicit `--purge --yes` resets the install — deletes the generated files and regenerates them to a full install state (purge is delete-and-rebuild, **not uninstall**): on Claude Code the entire `.claude/` is removed; on Codex only the flow-comet skills + managed hook entries + AGENTS.md managed block are removed (`.agents/` is shared with other tools; user entries are preserved). Prints the deletion list + warning; `--yes` is a second confirmation.

```bash
# View the overwrite list, then confirm (non-destructive, safe)
node scripts/prepare-env.mjs --target <absolute path to target project>
# Destructive rebuild (clean environments only; requires --yes)
node scripts/prepare-env.mjs --target <absolute path to target project> --purge --yes
```

**Prerequisites for use**: run the script inside the flow-comet repository (it reads from `.comet/bundle-drafts/flow-comet/`); `--target` points at the target project.

**Updating an installed flow-comet**: re-run the same Option A command — idempotent (overwrites generated files + merges the hook, preserves existing config).

### flow-kit acquisition

Before the platform install loop (platform-independent, once per run), `prepare-env` ensures `<target>/flow-kit/` is in place:

- **Missing** → the installer clones the upstream and checks out the locked snapshot commit `9b5dda7` (the upstream has no tags, so a commit is the only precise pin; verified against the upstream head on 2026-08-23), then prints a summary with the locked short SHA.
- **Existing upstream clone** (`.git` present and the `origin` remote URL matches `github.com/rihebty/flow-kit`) → read-only inspection only: the current HEAD is compared with the locked snapshot and the difference impact is reported (the installer never fetches or checks out over an existing clone). An identical HEAD is confirmed; a differing HEAD warns that guard section names and protocol references may deviate from the locked content, with manual alignment instructions.
- **Existing same-name non-clone directory** (or an origin that cannot be confirmed) → skipped with manual guidance (clone + checkout commands); never modified.
- **Network failure** (clone/checkout error) → WARN + manual acquisition guidance (upstream URL + target path); the install continues and exits 0 — without flow-kit, guard section names fall back to the built-in baseline and protocol references may point at missing files.
- **Purge never includes `flow-kit`** (including `--purge --yes`): it is outside the installer's generated-artifact domain, so a copy created by the installer is expected to remain after purge.

### Hook upgrade

The injected hook command shape evolves across releases: newer releases reference the guard script through the host's project-root variable instead of a relative path, so interception keeps working when the session's working directory drifts away from the project root. **Re-running the same Option A installer command upgrades the managed hook entry in place** — the entry is recognized by the script it points to regardless of its command shape and replaced with the current form: no duplicates, no residue, no manual cleanup of old settings. If you installed via Option B (manual copy), update the entry by hand to match the recommended command in step 3 above. If out-of-scope writes stopped being blocked after working-directory drift (hook log shows `Cannot find module ...comet-hook-guard`), that is the legacy relative-path entry failing to resolve — the fix is the same re-run; see the matching symptom row in [Troubleshooting](TROUBLESHOOTING.md).

> **Fail-open boundary**: a host that degrades a crashing hook to non-blocking lets the tool call through, and flow-comet cannot change that host behavior — the only fix is to remove the crash itself. The project-root reference resolves from the injected project root instead of the session's working directory, so the guard script is always found and the `Cannot find module ...comet-hook-guard` failure mode no longer occurs (crash probability for this cause drops to zero).

### Platforms

The installer targets **Claude Code** by default (unchanged behavior). The target platform is chosen in this order:

1. **Explicit flag**: `--platform <claude-code|codex|dsh|claude-code,dsh|all>` always wins (headless/CI compatible). It accepts a single platform, a comma-separated list (installed in argument order), or `all` (all platforms in table order). Unknown platforms error out (including any unknown item inside a comma list — no partial install). The old `both` option is removed — `--platform both` errors with a hint to use a comma list or `all`.
2. **Interactive prompt**: when run on an interactive terminal (TTY) without `--platform`, the installer shows a direction-key multi-select (arrow keys + space to toggle, Enter to confirm; `@clack/prompts` is the primary path) — when the dependency is not installed, offline, or stdin has no raw mode, it automatically falls back to a readline number/comma multi-select (`FLOW_COMET_FORCE_READLINE=1` forces the fallback for testing). Claude Code / Codex / dsh are pre-checked from existing `.claude/` / `.codex/` / `.dsh/` traces; press Enter to accept the pre-checked selection (fallback default Claude Code).
3. **Auto-detection**: without a TTY (CI, scripts, pipelines), traces in the target project are detected — `.codex/` only → Codex; `.dsh/` only → dsh; `.claude/` present → Claude Code; **multiple traces → Claude Code (primary) with a hint** (for another set, run in an interactive terminal for the multi-select, or pass `--platform` explicitly).
4. **Fallback**: if no trace exists, Claude Code is used.

| Platform | Skills | Orchestration rule | Write-guard hook |
|----------|--------|--------------------|-------------------|
| Claude Code (default) | `.claude/skills/` (unchanged) | `.claude/rules/` (auto-loaded) | `settings.local.json` → `hooks.PreToolUse` (text output, exit 2 blocks) |
| Codex | `.agents/skills/` (auto-discovered by Codex) | `AGENTS.md` managed block (inlined at install; Codex's `rules/` directory serves command-approval policies, not instruction files) | `.codex/hooks.json` (matcher `*` — Codex PreToolUse intercepts Bash tool calls; deny via `{"decision":"block"}`) |
| dsh | `.dsh/skills/flow-comet` (auto-discovered by dsh at rank 100, no restart) | `AGENTS.md` managed block (non-destructive merge) | global bridge loader — `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` + `$DSH_HOME/cordis.patch.yml` managed block (`tools/pre-execute` interception, all profiles) |

On non-default platforms, command paths inside SKILL/GUIDANCE files are rewritten at install time to the platform's actual skill location (the authoritative source stays in `.claude` form). Codex support has been exercised end-to-end (8-node flow on Codex CLI 0.146.0); the write-guard hook intercepts Bash write commands (PowerShell cmdlets, .NET File API, redirection) — command-level interception covers the mainstream patterns, alternate spellings may bypass it (Codex platform limit). The dsh platform installs a thin bridge loader globally in `$DSH_HOME` (see [Option C](#option-c--deepseek-harness-dsh-platform)) — the engine is untouched; the guard decision core is reused unchanged via subprocess calls.

### Verifying installation (no side effects, no change created)

1. **Structure**: `flow-comet*` skill directories under `<target>/.claude/skills/` (count matches prepare-env output, currently 19) + `rules/flow-comet-orchestration.md` + `settings.local.json` + `skills/flow-comet/INSTALLED_VERSION` (version marker shipped with the skill bundle — `cat .claude/skills/flow-comet/INSTALLED_VERSION`; it equals the latest release version, or for prepare-env installs with git available, a precise `<release>-<n>-g<hash>` describing how far the source has accumulated since that release)
2. **Config loadability**: `settings.local.json` is valid JSON; `hooks.PreToolUse[].hooks[].command` points to the project-root reference `node %CLAUDE_PROJECT_DIR%\.claude\skills\flow-comet\scripts\comet-hook-guard.mjs` (POSIX hosts: `node $CLAUDE_PROJECT_DIR/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs`) and `<target>/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs` exists. Claude Code injects `CLAUDE_PROJECT_DIR` with the project root when a hook runs, so the path resolves from the project root rather than the session's working directory — it still resolves after the working directory drifts out of the project root (the recommended shape under [Hook upgrade](#hook-upgrade))
3. **Consistency**: diff against the authoritative source (run inside the flow-comet repo; no output = identical):
   `diff -r --strip-trailing-cr .comet/bundle-drafts/flow-comet/rules <target>/.claude/rules` and the same for `skills`
4. **Smoke test** (run inside the target project): `cd <target> && node .claude/skills/flow-comet/scripts/workflow-state.mjs status` — expected output is a JSON state object (`{"status":"no-change",...}` for a fresh project, `{"status":"running","change":...}` when a workflow is active)

> Commands are POSIX-style (Git Bash / WSL / macOS terminal); Windows users should run them in Git Bash.
> **Note**: `guard-self-test.mjs` (216 scenarios) is the **author regression baseline** (self-test of script logic in a sandboxed environment — it does not depend on installation completeness and is not an installation verification criterion).

### Using flow-comet on Codex

Measured on Codex CLI 0.146.0 — the 8-node flow runs end-to-end.

- **First use**: trust the write-guard hook — run `/hooks` in an interactive session and trust the flow-comet hook entry; for scripted automation pass `--dangerously-bypass-hook-trust` to `codex exec`.
- **Scripted automation**: `codex exec … </dev/null` — when stdin is piped, Codex waits for stdin to close before starting (add the redirect when driving it from scripts/CI).
- **Execution mode**: the execute node runs in **direct** mode (the Codex main agent implements; switch with `execution-mode direct`). The `subagent-execute` node delegates `parallel="true"` tasks through **git worktrees** (one worktree per task: `git worktree add <path> -b <branch>` → `codex exec` inside the worktree, loading `flow-comet-dev` and returning a Return Contract → verify the commitHash and `git worktree remove` after the task) — worktree isolation matches Claude Code's delegation semantics; Codex CLI has no `--worktree` one-command flag (tracked in [openai/codex#12862](https://github.com/openai/codex/issues/12862)), so the coordinator manages worktrees explicitly.
- **Windows PowerShell argument quoting**: `node … '{"summary":"…"}'` loses embedded double quotes through PowerShell 5.1 — run such commands via .NET `ProcessStartInfo`/`ArgumentList`, or from Git Bash.
- **Commit discipline**: the workflow scripts validate artifacts, not git commits — mark tasks `status="done"` in TASK.md and commit as part of the execute node protocol.
- **Archive order**: run `skill-load archive flow-comet-integration --prompt flow-kit/prompts/7-integration.md` **before** copying the archive directory (declaration markers travel with the directory copy).
- **Chinese artifact writing (measured)**: session Bash writing Chinese via the PowerShell pipeline may corrupt it into literal `?` (`$OutputEncoding` encoding) — write via Python with `encoding='utf-8'`, set `$OutputEncoding` to `[System.Text.Encoding]::UTF8`, or use full `\uXXXX` escapes; `python` with the `-c` argument and embedded Chinese is lossless.
- **JSON argument quoting (measured)**: PowerShell 5.1 strips embedded double quotes when passing arguments to native commands (`handoff result` / `record` may store dirty strings) — use `--json-file` to read the JSON payload from a file, or run from Git Bash.
- **Git proxy operations (measured)**: git is restricted inside the codex sandbox (init branch creation fails, worktree subagents cannot self-commit) — init branch failure degrading to file-only mode is expected; commits from delegated subagents are made by the coordinator outside the sandbox, and the Return Contract's commitHash remains verifiable.
- **Leading `>` misdetection (measured)**: the hook treats a command-line leading `>` as a shell redirection (markdown quote lines get blocked) — escape and restore with `>`.

### Verifying a Codex installation

1. **Structure**: `flow-comet*` skill directories under `<target>/.agents/skills/` (19) + `AGENTS.md` managed block (`grep "Managed by flow-comet" <target>/AGENTS.md`) + `.codex/hooks.json` managed hook entry + `<target>/.agents/skills/flow-comet/INSTALLED_VERSION`
2. **Command paths rewritten**: `grep -c "\.claude/skills/flow-comet/scripts/" <target>/.agents/skills/flow-comet/SKILL.md` → 0; `grep -c "\.agents/skills/flow-comet/scripts/" <target>/.agents/skills/flow-comet/SKILL.md` → non-zero
3. **Hook contract smoke** (run inside the target project): feed the guard an out-of-scope write target and expect a JSON block decision — `echo '{"tool_name":"Write","tool_input":{"file_path":"src/evil.py"}}' | node .agents/skills/flow-comet/scripts/comet-hook-guard.mjs before_tool --platform codex` → `{"decision":"block",...}`
4. **Smoke test** (run inside the target project): `cd <target> && node .agents/skills/flow-comet/scripts/workflow-state.mjs status` → JSON state object

## Option B · Manual copy (fallback)

When prepare-env cannot be run (Claude Code target; Codex users should prefer Option A — manual copy does not run the platform path replacement):

```bash
cd <flow-comet repo>
SKILLS=.comet/bundle-drafts/flow-comet/skills
TARGET=<absolute path to target project>

# 1. Copy all flow-comet* skills (with GUIDANCE and scripts)
cp -r $SKILLS/flow-comet* "$TARGET/.claude/skills/"

# 2. Copy the orchestration rule
cp .comet/bundle-drafts/flow-comet/rules/flow-comet-orchestration.md "$TARGET/.claude/rules/"
```

**3. Register the hook (manual)**: merge the following into the target project's `.claude/settings.local.json` (preserve existing content, e.g. `permissions`). The command references the guard script through Claude Code's project-root variable (`CLAUDE_PROJECT_DIR`, injected with the project root when a hook runs; `%CLAUDE_PROJECT_DIR%` on Windows, `$CLAUDE_PROJECT_DIR` on POSIX), so it resolves from the project root instead of the session's working directory (i.e. `<target>/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node %CLAUDE_PROJECT_DIR%\\.claude\\skills\\flow-comet\\scripts\\comet-hook-guard.mjs"
          }
        ]
      }
    ]
  }
}
```

POSIX hosts use the forward-slash command form instead: `node $CLAUDE_PROJECT_DIR/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs`.

> **Upgrade note**: projects that installed earlier with the legacy relative-path entry (`node .claude/skills/...`) can upgrade in place — re-running the Option A installer replaces that entry with the project-root form above (managed entries are recognized by the script name and overwritten, no manual cleanup needed).

**4. Runtime state**: `.comet/flow-comet-state.json` is created by `init` (or the first `/flow-comet` call).

## Option C · DeepSeek Harness (dsh) platform

DeepSeek Harness (dsh) is supported through the **prepare-env installer** — the same entry point as Claude Code / Codex, with a dedicated dsh platform descriptor. There is no plugin bundle and no npm package (the npm distribution is a later / 1.5.0 item):

```bash
cd <flow-comet repo>
node scripts/prepare-env.mjs --target <absolute path to target project> --platform dsh
```

On an interactive terminal, dsh is one of the multi-select options (see [Platforms](#platforms)).

**Minimum dsh version**: `0.1.0-rc.6` (dev preview; API signatures and skill-discovery rank may change — below the anchor, interception may silently fail).

### What gets installed

1. **Project-level skill tree** — `<project>/.dsh/skills/flow-comet` (with path replacement `.claude/skills/flow-comet/scripts/` → `.dsh/skills/flow-comet/scripts/` in `.md` files, and an `INSTALLED_VERSION` version marker). dsh auto-discovers skills under `<project>/.dsh/skills/` at **rank 100** via file watching — no restart, and projects **without that directory cannot see the skill**, so activation is naturally project-level (no runtime trace detection, no chicken-and-egg).
2. **AGENTS.md managed block** — the orchestration rule is injected into `<project>/AGENTS.md` inside the managed block (`<!-- Managed by flow-comet prepare-env -->` … `<!-- /Managed by flow-comet prepare-env -->`), merged non-destructively — user content outside the block is preserved. The marker is shared with the Codex platform, so either platform's removal flow can clean the block — when uninstalling, remove the shared block only if no other platform still uses it.
3. **Global bridge loader** — a thin loader is mounted at `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` plus a managed block in `$DSH_HOME/cordis.patch.yml` (read-merge-write — existing blocks such as dsh-skin are preserved; the home patch applies to all profiles). The loader listens on dsh's native `tools/pre-execute` waterfall event, maps tool arguments to the guard contract (`Write`/`Edit` → `file_path`, `Bash` → `command`), calls the project-local `comet-hook-guard.mjs` in a child process, and returns `{kind:'deny', reason}` with a BLOCK message and recovery guidance for out-of-scope writes while the flow is running. It only engages when the session project root contains `.dsh/skills/flow-comet` (narrow listening — non-flow-comet projects are untouched). Shape mismatches and abnormal exits fail closed. Write containment applies only while a flow is running: in the idle state (no state / no `activeChange` / `completed`) writes outside the project root are allowed; parse failures or unknown workflow status stay fail-closed.

> **Note — the installer writes to your home directory**: mounting the bridge loader writes to `$DSH_HOME` (default `~/.dsh`; resolution: `$DSH_HOME` env var > `~/.dsh`). This is the intended, **non-destructive** design: `cordis.patch.yml` is read-merged (existing blocks such as dsh-skin preserved; an unparseable file fails safely instead of being overwritten) and the loader file is added/removed by name. Restore via purge (below), which removes the managed block and the loader file while keeping everything else.

### Loader version handling

The bridge loader carries an embedded version stamp (`// BRIDGE_VERSION: <version>` in `scripts/dsh-bridge.mjs`). On every dsh install, the installer extracts the stamp from the authoritative loader and from the currently installed loader (if any) and reports the transition before overwriting the mounted file: first install / **upgrade `A → B`** / **downgrade `A → B`** / **version consistent**. The stamp is also the contract anchor for `bridge-check` below.

### bridge-check (read-only self-check)

`workflow-state.mjs bridge-check` (available in every installed copy under the platform's skill path) performs a strictly read-only dsh bridge health check — zero writes, zero network. It reports six states:

| State | Meaning | Exit |
|-------|---------|------|
| healthy | loader installed and mounted with the expected insert shape, the referenced `file://` target is reachable, no duplicate registration, and the loader stamp matches the project `INSTALLED_VERSION` | 0 |
| file missing | `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` is absent | 1 |
| not mounted | the managed block is missing from `$DSH_HOME/cordis.patch.yml` (or the patch file is absent), or the block has the wrong shape (e.g. id-targeted instead of insert) | 1 |
| version skew | loader `BRIDGE_VERSION` differs from the project `INSTALLED_VERSION` | 1 |
| duplicate registration | the patch file registers `dsh-flow-comet-bridge` outside the managed block | 1 |
| not applicable | the project root contains no `.dsh/skills/flow-comet` (dsh platform copy not installed) — all other checks are skipped | 0 |

Unrecognized YAML shapes are reported as approximate warnings (warn without deciding — never a false fail); only explicit mismatches force a non-zero exit.

```bash
# Run inside the target project (dsh install shape)
node .dsh/skills/flow-comet/scripts/workflow-state.mjs bridge-check
```

### Using flow-comet on dsh

- **First use**: no hook-trust step — the bridge loader is a global plugin mounted by the installer; start a dsh session in the target project and invoke the skill by name (rank 100, auto-discovered). The bridge only intercepts when the session's project root contains `.dsh/skills/flow-comet` — projects without it are untouched. Interception only applies while a flow is running — in the idle state (no state / no `activeChange` / `completed`) writes outside the project root are allowed; parse failures or unknown workflow status stay fail-closed.
- **Version anchor**: dsh `0.1.0-rc.6` is the tested minimum; below it, skill discovery or interception may silently fail — upgrade dsh.
- **Subagent execution**: delegated subagents (identified by the session's subagent delegation depth) write source code as the executor — matching the worktree-isolation semantics of the other platforms — while the coordinating agent remains subject to the phase write whitelist. Out-of-project writes and malformed tool arguments stay denied for both. The subagent tool suite ships with dsh and is available in every session form.
- **Windows**: 8.3 short paths are normalized before containment checks (a short path inside the project is not misjudged as out-of-scope); the project root is canonicalized to its long form before the guard decision, so a short-form root and the normalized write target can never diverge into a fail-open.

### Verifying a dsh installation

1. **Structure**: `flow-comet` skill directory under `<target>/.dsh/skills/` + `AGENTS.md` managed block (`grep "Managed by flow-comet" <target>/AGENTS.md`) + `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` + the managed block in `$DSH_HOME/cordis.patch.yml` + `<target>/.dsh/skills/flow-comet/INSTALLED_VERSION`
2. **Command paths rewritten**: `grep -c "\.claude/skills/flow-comet/scripts/" <target>/.dsh/skills/flow-comet/SKILL.md` → 0; `grep -c "\.dsh/skills/flow-comet/scripts/" <target>/.dsh/skills/flow-comet/SKILL.md` → non-zero
3. **Smoke test** (run inside the target project): `cd <target> && node .dsh/skills/flow-comet/scripts/workflow-state.mjs status` → JSON state object
4. **Bridge health (optional)**: `cd <target> && node .dsh/skills/flow-comet/scripts/workflow-state.mjs bridge-check` → `healthy` (exit 0) on a correctly installed dsh project, or `not applicable` (exit 0) on a project without the dsh platform copy

### Reset and regenerate (purge — not uninstall)

```bash
node scripts/prepare-env.mjs --target <absolute path to target project> --purge --platform dsh --yes
```

`--purge` removes the generated files and then **regenerates them** — after a purge, flow-comet is **still fully installed** (skills regenerated, AGENTS.md managed block re-injected, the global bridge loader re-mounted). Purge is a delete-and-rebuild reset for clean re-installation, **not an uninstall**.

During the reset, the following generated artifacts are removed (then regenerated):

- `<project>/.dsh/skills/` entries for `flow-comet*` (non-flow-comet entries are kept; empty `.dsh` directories are removed)
- the AGENTS.md managed block (file and user content preserved; only when no other platform still uses the shared marker)
- the `$DSH_HOME/cordis.patch.yml` managed block (other blocks such as dsh-skin kept; the file itself is deleted when it becomes empty) and the `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` loader file — only when no other flow-comet project uses dsh (loader and home patch are global)

**To fully uninstall dsh platform support, remove the artifacts manually** (purge is not an uninstall path):

```bash
# 1. Remove the project-level skill tree
rm -rf <target>/.dsh/skills/flow-comet*

# 2. Remove the AGENTS.md managed block
#    (delete only the `<!-- Managed by flow-comet prepare-env -->` … `<!-- /Managed by flow-comet prepare-env -->` block,
#     keeping everything else in the file)

# 3. Remove the global bridge loader and the home-patch managed block
#    (delete the `# --- flow-comet managed ---` … `# --- end flow-comet managed ---` block in $DSH_HOME/cordis.patch.yml
#     and the file $DSH_HOME/plugins/dsh-flow-comet-bridge.mjs)
```

**Multi-project semantics**: each project installs its own skill tree (a project that has not installed the skill cannot see it); the bridge loader is a single global copy serving all flow-comet projects (per-session project detection — equivalent to the Claude Code project-level hook).

## Branch naming alignment

By default the engine creates the workflow branch as `change/<id>`. If your project follows a different local branch convention, pass a custom prefix when initializing the change:

```bash
cd <target project>
node .claude/skills/flow-comet/scripts/workflow-state.mjs init <id> --branch-prefix feat/
```

On Codex the same init runs against `.agents/skills/flow-comet/scripts/workflow-state.mjs`; on dsh against `.dsh/skills/flow-comet/scripts/workflow-state.mjs` (paths are rewritten at install time — see [Platforms](#platforms)). A missing trailing `/` is added automatically, so `--branch-prefix feat` and `--branch-prefix feat/` are equivalent.

Branch/state consistency checks (`status`/`next`) compare the current branch with the active change and emit a `WARN:` line on mismatch. The warning is a non-blocking hint, not an error — the workflow keeps running. To clear it, check out the expected branch (`git checkout <prefix><activeChange>`); the full symptom table lives in [Troubleshooting](TROUBLESHOOTING.md). Day-to-day branch behavior once the workflow is running (automatic creation, archive wrap-up, merge-back) is described in [Usage](USAGE.md).

## Uninstalling

Remove flow-comet from a target project (Claude Code / Codex below; for DeepSeek Harness (dsh), see the manual uninstall steps in [Option C](#option-c--deepseek-harness-dsh-platform)):

```bash
# 1. Remove the skill directories and the orchestration rule
rm -rf <target>/.claude/skills/flow-comet*
rm <target>/.claude/rules/flow-comet-orchestration.md

# 2. Remove the hook entry from .claude/settings.local.json
#    (delete only the PreToolUse entry whose command references comet-hook-guard.mjs,
#     keeping everything else — permissions, custom hooks, other matcher groups)

# 3. Optional: remove workflow state and artifacts
rm <target>/.comet/flow-comet-state.json
rm -rf <target>/.specs/          # only if you no longer need the workflow artifacts
```

## Integration with Comet (only when the target project also uses Comet)

> **Applicability**: the following customization is only for projects that have run `comet init` (their CLAUDE.md contains a `<comet-ambient-resume>` block). Projects not using Comet should skip this section — flow-comet does not depend on Comet; it has its own state machine and file-derived recovery.

> **Template language** follows the target project's primary language (Chinese shown here as an example).

Replace the following content in the target project's CLAUDE.md:
```markdown
<comet-ambient-resume>
<!-- Managed by Comet. Edits inside this block may be replaced by comet init/update. -->
<!-- Contract: comet.resume_probe.v2 -->
<!-- flow-comet overlay: project uses flow-comet as primary workflow -->

## Comet Ambient Resume

Before starting a task that changes or investigates the repo, if an active Comet workflow may exist, check in this order:

### Priority 1: flow-comet routing (project main workflow)

If `.claude/skills/flow-comet/SKILL.md` exists (flow-comet installed):

1. Check `.comet/current-change.json` or run `comet state get <change> phase` to confirm an active change
2. If an active change exists and `phase=build`, go straight to `/flow-comet` (do not run the resume probe)
3. If an active change exists but phase is not build, pick the entry per the flow-comet node routing table
4. If no active change, enter `/flow-comet` when the user explicitly wants to develop (it routes to the open stage)

### Priority 2: Comet standard probe (when flow-comet does not apply)

Only when flow-comet is not installed or the user explicitly invokes `/comet-classic`, run the standard probe:
`comet resume-probe . --stdin --json`

- If the user explicitly invokes any Comet Skill through the host (e.g. `/comet`, `/comet-classic`, `/comet-hotfix`), the explicit invocation takes precedence over this resume protocol.
- If the probe returns `auto_resume`, briefly state the selected active change and enter the permanent entry pointed to by `nextCommand`.
- If the probe returns `ask_user`, ask one short question and wait for the reply.
- If the probe returns `out_of_scope` or `none`, do not enter the Comet workflow.
- Do not attach an unrelated task to an active change just because one exists.
</comet-ambient-resume>
```

flow-comet customizes the `<comet-ambient-resume>` block injected by `comet init` so recovery routes to `/flow-comet` first — otherwise recovery only runs the Comet standard probe:

1. If the target project has run `comet init`, replace the block with the flow-comet-priority variant (route to `/flow-comet` when `flow-comet` is installed, fall back to the standard probe otherwise).
2. Note: the `Managed by Comet` marker is preserved — re-running `comet init`/`comet update` overwrites the block back to standard content; re-apply the customization.
3. If the project never ran `comet init`, this customization is optional (flow-comet does not depend on the resume-probe; it has its own state machine + determineNode file-derived recovery).
