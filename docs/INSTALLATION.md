<div align="right">

[English](INSTALLATION.md) · [中文](INSTALLATION-zh.md)

</div>

# Installation

## Requirements

- [Claude Code](https://claude.ai/code), installed and authenticated
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
node scripts/prepare-env.mjs --target <absolute path to target project>
```

`prepare-env` does:

1. **Generates/overwrites `rules/` and `skills/`** — all flow-comet* skills, from the authoritative source `.comet/bundle-drafts/flow-comet/`
2. **Injects the hook into `settings.local.json`** — read-merge-write: preserves everything already in the target project (`permissions`, custom hooks, other matcher groups), only injects/updates the comet-hook-guard entry under `hooks.PreToolUse` (existing comet hooks are replaced, not duplicated — idempotent). First-time creation writes only the hook entry; existing files are merged.

**Non-destructive by default**: nothing under the target project's `.claude/` is deleted (`commands/`, custom skills, custom config all preserved). Explicit `--purge --yes` deletes the entire `.claude/` and rebuilds (prints the deletion list + warning; `--yes` is a second confirmation).

```bash
# View the overwrite list, then confirm (non-destructive, safe)
node scripts/prepare-env.mjs --target <absolute path to target project>
# Destructive rebuild (clean environments only; requires --yes)
node scripts/prepare-env.mjs --target <absolute path to target project> --purge --yes
```

**Prerequisites for use**: run the script inside the flow-comet repository (it reads from `.comet/bundle-drafts/flow-comet/`); `--target` points at the target project.

**Updating an installed flow-comet**: re-run the same Option A command — idempotent (overwrites generated files + merges the hook, preserves existing config).

### Verifying installation (no side effects, no change created)

1. **Structure**: `flow-comet*` skill directories under `<target>/.claude/skills/` (count matches prepare-env output, currently 19) + `rules/flow-comet-orchestration.md` + `settings.local.json`
2. **Config loadability**: `settings.local.json` is valid JSON; `hooks.PreToolUse[].command` points to `node .claude/skills/flow-comet/scripts/comet-hook-guard.mjs` and that file exists
3. **Consistency**: diff against the authoritative source (run inside the flow-comet repo; no output = identical):
   `diff -r --strip-trailing-cr .comet/bundle-drafts/flow-comet/rules <target>/.claude/rules` and the same for `skills`
4. **Smoke test** (run inside the target project): `cd <target> && node .claude/skills/flow-comet/scripts/workflow-state.mjs status` — expected output is a JSON state object (`{"status":"no-change",...}` for a fresh project, `{"status":"running","change":...}` when a workflow is active)

> Commands are POSIX-style (Git Bash / WSL / macOS terminal); Windows users should run them in Git Bash.
> **Note**: `guard-self-test.mjs` (87 scenarios) is the **author regression baseline** (self-test of script logic in a sandboxed environment — it does not depend on installation completeness and is not an installation verification criterion).

## Option B · Manual copy (fallback)

When prepare-env cannot be run:

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
        "matcher": "Write|Edit",
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

在这个仓库中，开始处理需要改动或调查的任务前，如果可能存在活跃 Comet workflow，按以下顺序检查：

### 优先级 1：flow-comet 路由（项目主工作流）

如果 `.claude/skills/flow-comet/SKILL.md` 存在（flow-comet 已安装）：

1. 检查 `.comet/current-change.json` 或运行 `comet state get <change> phase` 确认是否有活跃 change
2. 如有活跃 change 且 `phase=build`，直接进入 `/flow-comet`（不要运行 resume probe）
3. 如有活跃 change 但 phase 不是 build，按 flow-comet 的节点路由表决定入口
4. 如无活跃 change，用户明确要开发时进入 `/flow-comet`（它会路由到 open 阶段）

### 优先级 2：Comet 标准探针（flow-comet 不适用时）

仅当 flow-comet 未安装或用户明确调用 `/comet-classic` 时，运行标准探针：
`comet resume-probe . --stdin --json`

- 如果用户通过宿主明确调用任意 Comet Skill（例如 `/comet`、`/comet-classic`、`/comet-hotfix`），显式调用优先于本恢复协议。
- 如果 probe 返回 `auto_resume`，简短说明选中的 active change，并进入 `nextCommand` 指向的永久入口。
- 如果 probe 返回 `ask_user`，只问一个简短问题并等待用户回复。
- 如果 probe 返回 `out_of_scope` 或 `none`，不要进入 Comet workflow。
- 不能只因为存在 active change 就把无关任务挂到该 change。
</comet-ambient-resume>
```

flow-comet customizes the `<comet-ambient-resume>` block injected by `comet init` so recovery routes to `/flow-comet` first — otherwise recovery only runs the Comet standard probe:

1. If the target project has run `comet init`, replace the block with the flow-comet-priority variant (route to `/flow-comet` when `flow-comet` is installed, fall back to the standard probe otherwise).
2. Note: the `Managed by Comet` marker is preserved — re-running `comet init`/`comet update` overwrites the block back to standard content; re-apply the customization.
3. If the project never ran `comet init`, this customization is optional (flow-comet does not depend on the resume-probe; it has its own state machine + determineNode file-derived recovery).
