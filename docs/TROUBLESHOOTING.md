# Troubleshooting

Find your symptom, run the command. Everything here assumes you are inside the project you installed into.

## Symptoms

### Installation

**`fcomet: command not found`** — the CLI is not on your PATH. Re-run `npm install -g flow-comet` and check `npm bin -g` (or `npm prefix -g`) is on PATH; `node --version` must report 18 or newer.

**The command printed usage and exited non-zero** — that is the no-argument behaviour: with no arguments at all the installer only prints its usage. Add the intent: `fcomet init`, or `fcomet --target <dir>`, or `--platform <name>`.

**It installed the wrong platform** — re-run with the platform named explicitly: `fcomet init --platform claude-code`, `--platform codex`, `--platform dsh`, or a comma-separated list / `all`. Re-running is idempotent; it does not delete what is already there.

**`.gitignore` was not updated** — check you ran the installer in a project (not inside the flow-comet repository itself, where `.flow-comet/` must stay tracked). The managed entry is appended, never replacing existing lines.

### First run

**Claude Code never blocks an out-of-scope write** — the hook runs through a shell the host must be able to find. On Windows, tell the platform where Git Bash is (the host looks for it) and retry; a headless session additionally needs the workspace trust to be accepted beforehand.

**Codex never blocks anything** — project hooks only run once their trust has been accepted (interactive `/hooks`), or when a scripted run passes `--dangerously-bypass-hook-trust`. Without either, the hook is not executed at all.

**dsh: writes are not intercepted** — run the read-only self-check in the project: `node .dsh/skills/flow-comet/scripts/workflow-state.mjs bridge-check`. It reports whether the loader is present, whether the managed block in `$DSH_HOME` is mounted, whether it is registered once, and whether the loader's version stamp matches the project marker. Re-running `fcomet init --platform dsh` rewrites both the loader and the managed block.

### A stuck node

**`BLOCKED: … 未执行 entry 直接 exit`** — the guard requires an entry for every node on a new change: run `workflow-guard.mjs entry <node> --apply` first.

**`BLOCKED: … 缺少技能加载声明标记`** — load the node's skill and declare it: `workflow-state.mjs skill-load <node> <skill>`, then repeat the `record` and the exit.

**`BLOCKED: … 模板保真校验失败`** — the node's document is missing a header field or a section the flow-kit template defines. Compare it with `flow-kit/templates/<DOC>.md` and add the named field or section; the message names what it wanted.

**`BLOCKED: … TASK.md 任务集被修改（签名不匹配）`** — the task set changed after the execution node was entered. Restore the task list and re-enter the node (or add the work as a new task before entering), rather than editing tasks mid-flight.

**`BLOCKED: done 任务 … 缺少 <id>-SUMMARY.md`** — every completed task needs its summary document with the template's sections. Write it, or revert the task to pending if it is not actually done.

**`BLOCKED: … 任务被主代理直接标记 done（越俎代庖）`** — in the default execution mode the coordinating session may not complete tasks itself. Delegate the task, or declare the takeover explicitly with `workflow-state.mjs record execute '{"parallelTakeoverApproved":true}'`.

**`verify` fails with a timeout or a non-zero command** — the exit runs the command block from `TEST.md`. Run that command yourself to see the output; a suite that legitimately needs longer can be given a larger budget through the documented `FLOW_COMET_VERIFY_TIMEOUT_MS` environment variable.

**`BLOCKED: missing Output Schema artifacts`** — the archive exit wants the archived directory and its leftover list. Move the change directory into `.specs/archive/<date>-<change-id>/` and make sure `KNOWN-ISSUES.md` exists inside it (write "no leftovers" explicitly if there are none).

### Platform

**Codex hook stopped working after moving the project** — the Codex hook stores the absolute path it was installed with. Re-run `fcomet init --platform codex` in the project's new location.

**dsh reports a version skew** — the loader's version stamp and the project marker disagree. Re-run `fcomet init --platform dsh` (it rewrites both), then re-check with `bridge-check`. A development suffix on one side is normal for an install from a clone.

### Upgrade and reset

**The project still runs the old version after `npm install -g flow-comet`** — upgrading the global package only replaces the CLI. Run `fcomet init` in the project again; it overwrites generated files and is idempotent.

**I want to start over** — `fcomet init --purge --yes --platform <platform>` deletes that platform's generated files and rebuilds them. It is a delete-and-rebuild, **not an uninstall**: on Claude Code the whole `.claude/` directory is removed (keep your own additions elsewhere), on Codex only the flow-comet skills and managed entries are removed, and `flow-kit/` is never deleted. The deletion list is printed before anything happens; `--yes` is the second confirmation.
