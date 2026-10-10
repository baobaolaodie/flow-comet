# Installation

Installs flow-comet into a project so that a Claude Code, Codex or DeepSeek Harness session in that project gets the workflow skills, the write-guard hook and the flow-kit artifact templates.

## Requirements

- **Node.js 18 or newer** (`node --version`).
- **One agent platform** — Claude Code (default), Codex, or DeepSeek Harness. Pick one; installing a second one later is a re-run with a different `--platform`.
- **A project directory** to install into. The installer only writes inside it (plus, for dsh, the `$DSH_HOME` plugin directory).

flow-kit is fetched by the installer itself: an existing `flow-kit/` directory in the project is respected, a missing one is cloned and pinned, and the directory is never modified afterwards.

## Option A · npm package (recommended)

```bash
npm install -g flow-comet     # 1. the CLI (package: flow-comet)
cd <your project>             # 2. the project you want to install into
fcomet init                   # 3. install into it
```

The package ships two command names for the same installer: `fcomet` (primary) and `flow-comet` (alias). The `init` token may be omitted whenever another argument already expresses the intent — `fcomet --target <dir>` equals `fcomet init --target <dir>` — and `--target` itself is optional (default: the current directory). **Called with no arguments at all, the command prints its usage and exits non-zero instead of installing.**

On an interactive terminal the first run asks which platform to set up (arrow keys, space to toggle, enter to confirm; Claude Code is the default). For a non-interactive pick use `--platform`:

```bash
fcomet init --platform claude-code
fcomet init --platform codex
fcomet init --platform dsh
fcomet init --platform claude-code,dsh     # comma-separated combination
fcomet init --platform all                 # all three at once
```

**Updating an installed copy**: re-run the same command; generated files are overwritten, hook entries are merged in place and everything else in the project is preserved. It is idempotent — a second run leaves the generated files byte-identical. Upgrading the global package (`npm install -g flow-comet`) only replaces the CLI: a project keeps its copy until you run `fcomet init` there again.

## Verify the installation

```bash
fcomet --version                                    # the installed CLI version
cat .claude/skills/flow-comet/INSTALLED_VERSION     # the version written into this project
```

Both print the same value for an npm install (the release the package came from). The marker file lives in the platform's skill tree — `.claude/skills/flow-comet/INSTALLED_VERSION`, `.agents/skills/flow-comet/INSTALLED_VERSION` or `.dsh/skills/flow-comet/INSTALLED_VERSION` — and an install run from a repository clone records that clone's `git describe` value instead, which carries a `-<n>-g<hash>` suffix when the clone is ahead of its tag.

What the installer should have produced:

| Platform | Skill tree | Hook / bridge | Extra |
|---|---|---|---|
| Claude Code | `.claude/skills/` (19 skills) | a `PreToolUse` entry in `.claude/settings.local.json` pointing into the project's skill tree | `.claude/rules/` (auto-loaded orchestration notes) |
| Codex | `.agents/skills/` (19 skills) | a `PreToolUse` entry in `.codex/hooks.json`, plus `hooks = true` in `.codex/config.toml` | a managed block in `AGENTS.md` |
| DeepSeek Harness (dsh) | `.dsh/skills/` (19 skills) | a managed block in `$DSH_HOME/cordis.patch.yml` referring to the bridge loader copied into `$DSH_HOME/plugins/` | a managed block in `AGENTS.md` |

All three platforms also get `flow-kit/` (templates and rules) and a `.gitignore` entry managing the `.flow-comet/` runtime directory. The installer is non-destructive: nothing already present in the project is deleted, and an existing `.gitignore` keeps its contents — the managed entry is appended. "Non-destructive" means your own content: the installer does clean up its own earlier output that the current skill set no longer contains — confined to the flow-comet skill directories it installed under the platform's skill tree, and anything whose ownership cannot be established is kept.

## First use per platform

- **Claude Code** — trust the project workspace when the session asks; a headless session needs that trust to be accepted beforehand. Project hooks are then trusted with the workspace.
- **Codex** — the first use asks you to trust the project hook (the interactive `/hooks` flow). Scripted or headless runs must pass the platform's hook-trust bypass flag, otherwise the project hook is simply not executed.
- **DeepSeek Harness (dsh)** — no hook-trust step: the bridge loader is a global plugin mounted by the installer. Start a session in the target project and invoke the skill.

Platform-level behaviour (what blocks what, and the limits) is described in [Core Mechanisms](MECHANISM.md); symptom-driven fixes are in [Troubleshooting](TROUBLESHOOTING.md).

## Moving a project after installation

The Codex hook command is written with the **absolute path** of the project it was installed into, so a project that is moved or renamed keeps a hook pointing at the old location — re-run `fcomet init` in the moved project to rewrite it. Claude Code's hook refers to the project directory through the platform's own variable and does not have this problem; the dsh bridge is global and refers to the project at runtime.

## Reset (purge)

`--purge --yes` **resets** an installation by deleting the platform's generated files and rebuilding them — it is a delete-and-rebuild, **not an uninstall**:

```bash
fcomet init --purge --yes --platform claude-code
```

It prints a warning plus the deletion list before doing anything; `--yes` is the second confirmation, and without it nothing is deleted. The deletion scope is platform-specific:

- **Claude Code** — the entire `.claude/` directory is removed and regenerated, so keep anything you added there elsewhere.
- **Codex** — only the `flow-comet*` skill directories, the managed hook entries and the managed `AGENTS.md` block are removed; other content under `.agents/` and everything you wrote in `AGENTS.md` is preserved (`.agents/` is shared with other tooling).
- **deepseek harness (dsh)** — the project-side skill tree and the managed blocks; the global loader in `$DSH_HOME` is rewritten by the installer.
- **`flow-kit/` is never deleted by a purge** — it is outside the installer's generated-artifact domain, so an existing copy stays.

## Option B · Installer from a repository clone

For working on flow-comet itself, or when installing from a source checkout:

```bash
git clone https://github.com/baobaolaodie/flow-comet
cd flow-comet
node scripts/prepare-env.mjs --target "<absolute path to the target project>" --platform claude-code
```

Semantics are identical to Option A, with two differences: the installer reads the skills from this repository's authoritative source, and the version marker it writes comes from `git describe` of the clone rather than from a published package. `--target` takes an absolute path here; omitting it installs into the current directory.

## Option C · Manual copy (fallback)

Copy `.flow-comet/skills/*` from a checkout into the project's platform directory (`.claude/skills/`, `.agents/skills/` or `.dsh/skills/`), keep `flow-kit/` next to it, and add the platform's hook entry yourself. This bypasses the installer's merge, idempotence and `.gitignore` handling — use it only where the installer cannot run, and expect to redo it on updates.

## Option D · DeepSeek Harness (dsh)

Installing with `--platform dsh` writes the project-side skill tree into `.dsh/skills/`, injects the managed block into `AGENTS.md`, copies the bridge loader into `$DSH_HOME/plugins/` and mounts it through a managed block in `$DSH_HOME/cordis.patch.yml`. Nothing else is needed: dsh discovers `.dsh/skills/` on its own and the loader is applied by the host.

A read-only self-check is available from any installed copy:

```bash
node .dsh/skills/flow-comet/scripts/workflow-state.mjs bridge-check
```

It reports whether the loader is present, whether the managed block is mounted, whether it is registered exactly once and whether the loader's version stamp matches the project's marker. Uninstalling the platform later is `fcomet init --purge --platform dsh --yes`.

## If the installation fails

See [Troubleshooting](TROUBLESHOOTING.md) — it groups symptoms by installation, first run, a stuck node and platform-specific issues, each with the command to run. Installation-specific ones include a command that is not found, a platform that was picked wrong (re-run with `--platform`), and an unexpected non-zero exit with usage output (that is the no-argument behaviour).
