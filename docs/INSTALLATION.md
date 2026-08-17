<div align="right">

[English](INSTALLATION.md) · [中文](INSTALLATION-zh.md)

</div>

# Installation

## Requirements

- [Claude Code](https://claude.ai/code), installed and authenticated (default platform)
- [Codex](https://github.com/openai/codex) CLI, installed (skills/rules/hook support as described under [Platforms](#platforms))
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) CLI `0.1.0-rc.6` or newer for the dsh platform (optional; see [Option C](#option-c--deepseek-harness-dsh-platform))
- [flow-kit](https://github.com/rihebty/flow-kit) installed in the target project:

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

On an interactive terminal, the first run prompts for the platform with a multi-select (arrow keys + space to toggle, Enter to confirm; pre-checked from existing traces — see the selection chain under [Platforms](#platforms)).

`prepare-env` does:

1. **Generates/overwrites `rules/` and `skills/`** — all flow-comet* skills, from the authoritative source `.comet/bundle-drafts/flow-comet/`
2. **Injects the hook into `settings.local.json`** — read-merge-write: preserves everything already in the target project (`permissions`, custom hooks, other matcher groups), only injects/updates the comet-hook-guard entry under `hooks.PreToolUse` (existing comet hooks are replaced, not duplicated — idempotent). First-time creation writes only the hook entry; existing files are merged.

**Non-destructive by default**: nothing under the target project's install root (`.claude/` for Claude Code, `.agents/` for Codex) is deleted (`commands/`, custom skills, custom config all preserved). Explicit `--purge --yes` deletes the generated files and rebuilds — on Claude Code the entire `.claude/` is removed; on Codex only the flow-comet skills + managed hook entries + AGENTS.md managed block are removed (`.agents/` is shared with other tools; user entries are preserved). Prints the deletion list + warning; `--yes` is a second confirmation.

```bash
# View the overwrite list, then confirm (non-destructive, safe)
node scripts/prepare-env.mjs --target <absolute path to target project>
# Destructive rebuild (clean environments only; requires --yes)
node scripts/prepare-env.mjs --target <absolute path to target project> --purge --yes
```

**Prerequisites for use**: run the script inside the flow-comet repository (it reads from `.comet/bundle-drafts/flow-comet/`); `--target` points at the target project.

**Updating an installed flow-comet**: re-run the same Option A command — idempotent (overwrites generated files + merges the hook, preserves existing config).

### Platforms

The installer targets **Claude Code** by default (unchanged behavior). The target platform is chosen in this order:

1. **Explicit flag**: `--platform <claude-code|codex|dsh|claude-code,dsh|all>` always wins (headless/CI compatible). It accepts a single platform, a comma-separated list (installed in argument order), or `all` (all platforms in table order). Unknown platforms error out (including any unknown item inside a comma list — no partial install). The old `both` option is removed — `--platform both` errors with a hint to use a comma list or `all`.
2. **Interactive prompt**: when run on an interactive terminal (TTY) without `--platform`, the installer shows a multi-select (arrow keys + space to toggle, Enter to confirm; optional `@clack/prompts` dependency with a readline number/comma fallback) — Claude Code / Codex / dsh, pre-checked from existing `.claude/` / `.codex/` / `.dsh/` traces; press Enter to accept the pre-checked selection (fallback default Claude Code).
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
2. **Config loadability**: `settings.local.json` is valid JSON; `hooks.PreToolUse[].command` points to `node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs` and that file exists
3. **Consistency**: diff against the authoritative source (run inside the flow-comet repo; no output = identical):
   `diff -r --strip-trailing-cr .comet/bundle-drafts/flow-comet/rules <target>/.claude/rules` and the same for `skills`
4. **Smoke test** (run inside the target project): `cd <target> && node .claude/skills/flow-comet/scripts/workflow-state.mjs status` — expected output is a JSON state object (`{"status":"no-change",...}` for a fresh project, `{"status":"running","change":...}` when a workflow is active)

> Commands are POSIX-style (Git Bash / WSL / macOS terminal); Windows users should run them in Git Bash.
> **Note**: `guard-self-test.mjs` (144 scenarios) is the **author regression baseline** (self-test of script logic in a sandboxed environment — it does not depend on installation completeness and is not an installation verification criterion).

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

**3. Register the hook (manual)**: merge the following into the target project's `.claude/settings.local.json` (preserve existing content, e.g. `permissions`). The hook command's relative path resolves against the Claude Code project root (i.e. `<target>/.claude/skills/flow-comet/scripts/comet-hook-guard.mjs`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs"
          }
        ]
      }
    ]
  }
}
```

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
2. **AGENTS.md managed block** — the orchestration rule is injected into `<project>/AGENTS.md` inside the managed block (`<!-- Managed by flow-comet prepare-env -->` … `<!-- /Managed by flow-comet prepare-env -->`), merged non-destructively — user content outside the block is preserved. The marker is shared with the Codex platform, so either platform's uninstall can clean the block.
3. **Global bridge loader** — a thin loader is mounted at `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` plus a managed block in `$DSH_HOME/cordis.patch.yml` (read-merge-write — existing blocks such as dsh-skin are preserved; the home patch applies to all profiles). The loader listens on dsh's native `tools/pre-execute` waterfall event, maps tool arguments to the guard contract (`Write`/`Edit` → `file_path`, `Bash` → `command`), calls the project-local `comet-hook-guard.mjs` in a child process, and returns `{kind:'deny', reason}` with a BLOCK message and recovery guidance for out-of-scope writes. It only engages when the session project root contains `.dsh/skills/flow-comet` (narrow listening — non-flow-comet projects are untouched). Shape mismatches and abnormal exits fail closed.

> **Note — the installer writes to your home directory**: mounting the bridge loader writes to `$DSH_HOME` (default `~/.dsh`; resolution: explicit config > `$DSH_HOME` env var > `~/.dsh`). This is the intended, **non-destructive** design: `cordis.patch.yml` is read-merged (existing blocks such as dsh-skin preserved; an unparseable file fails safely instead of being overwritten) and the loader file is added/removed by name. Restore via purge (below), which removes the managed block and the loader file while keeping everything else.

### Using flow-comet on dsh

- **First use**: no hook-trust step — the bridge loader is a global plugin mounted by the installer; start a dsh session in the target project and invoke the skill by name (rank 100, auto-discovered). The bridge only intercepts when the session's project root contains `.dsh/skills/flow-comet` — projects without it are untouched.
- **Version anchor**: dsh `0.1.0-rc.6` is the tested minimum; below it, skill discovery or interception may silently fail — upgrade dsh.
- **Windows**: 8.3 short paths are normalized before containment checks (a short path inside the project is not misjudged as out-of-scope).

### Verifying a dsh installation

1. **Structure**: `flow-comet` skill directory under `<target>/.dsh/skills/` + `AGENTS.md` managed block (`grep "Managed by flow-comet" <target>/AGENTS.md`) + `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` + the managed block in `$DSH_HOME/cordis.patch.yml` + `<target>/.dsh/skills/flow-comet/INSTALLED_VERSION`
2. **Command paths rewritten**: `grep -c "\.claude/skills/flow-comet/scripts/" <target>/.dsh/skills/flow-comet/SKILL.md` → 0; `grep -c "\.dsh/skills/flow-comet/scripts/" <target>/.dsh/skills/flow-comet/SKILL.md` → non-zero
3. **Smoke test** (run inside the target project): `cd <target> && node .dsh/skills/flow-comet/scripts/workflow-state.mjs status` → JSON state object

### Uninstall (purge)

```bash
node scripts/prepare-env.mjs --target <absolute path to target project> --purge --platform dsh --yes
```

Purge removes:

- `<project>/.dsh/skills/` entries for `flow-comet*` (non-flow-comet entries are kept; empty `.dsh` directories are removed)
- the AGENTS.md managed block (file and user content preserved)
- the `$DSH_HOME/cordis.patch.yml` managed block (other blocks such as dsh-skin kept; the file itself is deleted when it becomes empty) and the `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` loader file

**Multi-project semantics**: each project installs its own skill tree (an uninstalled project cannot see the skill); the bridge loader is a single global copy serving all flow-comet projects (per-session project detection — equivalent to the Claude Code project-level hook).

## Uninstalling

Remove flow-comet from a target project (Claude Code / Codex below; for DeepSeek Harness (dsh), see the purge command in [Option C](#option-c--deepseek-harness-dsh-platform)):

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
