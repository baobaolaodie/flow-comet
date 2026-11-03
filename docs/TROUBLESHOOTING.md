# Troubleshooting

Find your symptom, run the command. Everything here assumes you are inside the project you installed into.

## Symptoms

### Installation

**`fcomet: command not found`** — the CLI is not on your PATH. Re-run `npm install -g flow-comet` and check `npm bin -g` (or `npm prefix -g`) is on PATH; `node --version` must report 18 or newer.

**The command printed usage and exited non-zero** — that is the no-argument behaviour: with no arguments at all the installer only prints its usage. Add the intent: `fcomet init`, or `fcomet --target <dir>`, or `--platform <name>`.

**It installed the wrong platform** — re-run with the platform named explicitly: `fcomet init --platform claude-code`, `--platform codex`, `--platform dsh`, or a comma-separated list / `all`. Re-running is idempotent, and it does not delete anything outside the managed skill directories; cleanup inside them is decided by location — do not place your own files there.

**`.gitignore` was not updated** — check you ran the installer in a project (not inside the flow-comet repository itself, where `.flow-comet/` must stay tracked). The managed entry is appended, never replacing existing lines.

### First run

**Claude Code never blocks an out-of-scope write** — the hook runs through a shell the host must be able to find. On Windows, tell the platform where Git Bash is (the host looks for it) and retry; a headless session additionally needs the workspace trust to be accepted beforehand.

**Codex never blocks anything** — project hooks only run once their trust has been accepted (interactive `/hooks`), or when a scripted run passes `--dangerously-bypass-hook-trust`. Without either, the hook is not executed at all.

**dsh: writes are not intercepted** — run the read-only self-check in the project: `node .dsh/skills/flow-comet/scripts/workflow-state.mjs bridge-check`. It reports whether the loader is present, whether the managed block in `$DSH_HOME` is mounted, whether it is registered once, and whether the loader's version stamp matches the project marker. Re-running `fcomet init --platform dsh` rewrites both the loader and the managed block.

### A stuck node

**`BLOCKED: … 未执行 entry 直接 exit`** — the guard requires an entry for every node on a new change: run `workflow-guard.mjs entry <node> --apply` first.

**`BLOCKED: … 缺少技能加载声明标记`** — load the node's skill and declare it: `workflow-state.mjs skill-load <node> <skill>`, then repeat the `record` and the exit.

**`BLOCKED: … skill-load 声明 --prompt 与节点协议文件不符`** — a declaration already written for this node names a protocol file outside the node's own set. Re-run `skill-load` with the path the message prints (`flow-kit/prompts/<file>`); the declaration is checked at the next entry, so re-declare instead of editing the marker.

**`BLOCKED: … 的模板声明与节点映射不一致`** — the `--templates` list does not match the node's templates. The message names what is missing or extra and prints the command that re-declares it: `open` takes `CHANGE.md,REQUIREMENT.md`, `design` `DESIGN.md` (plus `UI-DESIGN.md` on a frontend change), `plan` `TASK.md`, `execute` / `subagent-execute` `SUMMARY.md`, `review` `REVIEW.md,TEST.md`; `verify` and `archive` have none and omit the flag. A change created before this rule warns instead of refusing.

**`BLOCKED: … exit 缺协议声明标记`** — the markers written for this node do not cover everything it requires. The message lists each protocol file it could not find declared and each required skill whose marker is missing, with the marker file that skill would write; declare each missing skill with its own `skill-load` call and attach the protocol files on that same command — `workflow-state.mjs skill-load <node> <skill> --prompt flow-kit/prompts/<file> --prompt flow-kit/prompts/<other-file>` — since one call may carry several `--prompt` flags, and repeating the same node and skill overwrites that marker; then retry the exit. A change created before this rule is warned instead of blocked, and a change with no marker directory at all prints a `SKILL-LOAD WARN` saying the check was skipped.

**`record` refuses the evidence payload, naming a field and its type** — the payload is shape-checked before anything is written: `summary` must be a non-empty string, `completedChecks` a list of strings, and `lessonsNomination` an object whose `nominated` is a list of strings and `reasonIfNone` a string. Each line of the message reads as a field path, the shape it needs and the type it actually holds (for example `completedChecks[0]` needing a string while holding an object); the state is left untouched, so correct the payload and retry. When the shell mangles the quotes, put the same JSON in a file and pass `--json-file <path>`; in `cmd.exe` use double quotes around the payload and escape the double quotes inside it.

**`BLOCKED: … 模板结构校验失败`** — one of the document's checks failed: title form, header fields, the section set or its order, a blank body, or text copied verbatim from the template. The message works in two stages: **the first failure gives only the template path and a count per category** (for example "3 sections missing"), which you fix against `flow-kit/templates/<DOC>.md`; **the section names are listed only when the same document fails again** — that ledger lives in `.specs/<change>/.template-hints.json` and is cleared once the document passes. A conditional section keeps its heading (write `N/A` in the body), a structural subsection is not required when its parent section is `N/A` as a whole, and sections you add beyond the template are not checked.

**The exit reports a document as unchecked because its template is missing** — `flow-kit/templates/<DOC>.md` is not in the project root, so every template-derived check for that document is skipped — **unchecked is not passed**. Restore the flow-kit templates as the installation page describes and retry; if the same line blames the registry instead, the skill tree is missing `reference/artifact-templates.json` and needs reinstalling. `UAT.md` and the archive's leftovers list have no upstream template, so they are never part of this check: only their existence is required.

**`TEMPLATE-FINGERPRINT WARN`** — the registry's locked upstream commit and the checkout under `flow-kit/` disagree. It is a hint, not a block: the skeleton keeps being checked against the registry snapshot. Check `flow-kit/` out at the commit the registry names, or update `templateCommit` together with every template's sha256 — the quality job compares the two sides and refuses a half-done update.

**`TEMPLATE-REGISTRY WARN`** — the registry lists a section its template no longer has. The template decides the section set, so the section is ignored and the run continues; the warning stays until the registry is corrected, which means updating `reference/artifact-templates.json` in the same change that removed the section.

**`BLOCKED: … TASK.md 任务集被修改（签名不匹配）`** — the task set changed after the execution node was entered. Restore the task list and re-enter the node (or add the work as a new task before entering), rather than editing tasks mid-flight.

**`BLOCKED: TASK.md 波次划分与依赖层级不一致`** — the wave section and the dependency levels disagree. Each line names one task, its dependencies, the wave it declares and the wave it should reach; a task no wave line mentions is listed as undeclared. Either move that task to the wave it should reach, or give it the dependency that explains why it sits later — a task listed nowhere has no wave to move from, so write it into its wave's line instead. When the message instead says the section itself cannot be read (`BLOCKED: TASK.md 波次划分段内容不可判`), no line in it resolves to a real task: write each wave as `Wave 1: T01, T02` with the ids spelled exactly as the task blocks spell them, since `N/A` in the body is not a wave declaration. A plan with no wave section at all prints `未校验（无波次段）` and keeps its exit code, and a change created before this rule is only warned.

**`BLOCKED: TASK.md 同波任务可并行却未标 [P]`** — two tasks share a wave, neither depends on the other (directly or through a chain) and their write surfaces do not overlap, yet at least one of them is not marked parallel. Take one of the two ways out: mark both `parallel="true"` and add `[P]` on the wave line so they really run together, or add a `depends_on` that puts them in different waves and makes the order explicit. Marking only one changes nothing — routing follows the task block, not the wave line — and a change created before this rule is warned instead of blocked; fix tasks are not part of the pair rule.

**`BLOCKED: done 任务 … 缺少 <id>-SUMMARY.md`** — every completed task needs its summary document with the template's sections. Write it, or revert the task to pending if it is not actually done.

**`BLOCKED: … 任务被主代理直接标记 done（越俎代庖）`** — in the default execution mode the coordinating session may not complete tasks itself. Delegate the task, or declare the takeover explicitly with `workflow-state.mjs record execute '{"parallelTakeoverApproved":true}'`.

**`verify` fails with a timeout or a non-zero command** — the exit runs the command block from `TEST.md`. Run that command yourself to see the output; a suite that legitimately needs longer can be given a larger budget through the documented `FLOW_COMET_VERIFY_TIMEOUT_MS` environment variable.

**`BLOCKED: TEST.md 的 1.1 测试矩阵缺 AC 覆盖`** — the matrix has no row for the criteria the message lists. Add one row per criterion to the 1.1 matrix (`| AC-N | 类型 | 用例文件 / UAT | 状态 |`) and retry the exit; the review exit prints the same list as a single summary line and does not block, so it is a preview rather than the verdict. When the message instead says the rule could not run (`BLOCKED: AC 覆盖判据无法执行`), the criteria carry no `AC-N` numbers or the first round has no 1.1 matrix at all — a whole-section `N/A` is that shape — so number the criteria and write the matrix. Only a missing carrier (no requirement document, no test document, no template, no acceptance section, no first-round section) is reported as not checked and leaves the exit code alone, and a change created before this rule is warned instead of blocked.

**`BLOCKED: missing Output Schema artifacts`** — the archive exit wants the archived directory and its leftover list. Move the change directory into `.specs/archive/<date>-<change-id>/` and make sure `KNOWN-ISSUES.md` exists inside it (write "no leftovers" explicitly if there are none).

**`BLOCKED: SUMMARY 使用 builtin-quickcheck 未声明…（新 change 强制）`** — a new change that declares the built-in quick check must state both why the review engine was unavailable and what was read in its place — name the plugin cache, the cached protocol files or their path. Missing either half refuses the exit; a change created before the rule warns instead.

**`BLOCKED: SUMMARY 的 6 维自查未声明使用 /brooks-review`** — the declaration is matched as a literal string **inside the self-check section**: a heading such as `# Brooks-Lint Review` is not read as the method name, and a reason written in the self-check-method section does not satisfy this check. Write `brooks-review` (or `cache-brooks`) in the self-check section itself.

**The exit refuses a summary over a missing structural subsection although the section says N/A** — the marker has to open the body. Rewrite the body so `N/A` is its first token (a short reason may follow) instead of putting an explanation in front of it or folding the marker into a sentence; bold, a block quote, a list bullet, parentheses and backticks around the marker are accepted. The message also names the parent section a misplaced subsection actually sits under, and states how to write the section when it truly does not apply.

**`next` keeps pointing at the node I have just finished** — an entered node that has not exited still owns the route. Run `record` and then `exit <node>`; the `ROUTE` line in `status` and the `WHY` line in `next` say why it is stopped there. To see what a task's SUMMARY still lacks, run the structural preflight `exit <node> --preflight`: it is read-only, checks the documents' structure only, and writes neither state nor the hint ledger, so missing H2 sections come back as counts; a missing structural subsection, and the advice naming the parent section that should hold it, are reported by name. For the counted headings themselves, wait for the node's closing full `exit` (which keeps that ledger) or compare the document against the template section by section.

### Platform

**Codex hook stopped working after moving the project** — the Codex hook stores the absolute path it was installed with. Re-run `fcomet init --platform codex` in the project's new location.

**dsh reports a version skew** — the loader's version stamp and the project marker disagree. Re-run `fcomet init --platform dsh` (it rewrites both), then re-check with `bridge-check`. A development suffix on one side is normal for an install from a clone.

### Upgrade and reset

**The project still runs the old version after `npm install -g flow-comet`** — upgrading the global package only replaces the CLI. Run `fcomet init` in the project again; it overwrites generated files and is idempotent.

**I want to start over** — `fcomet init --purge --yes --platform <platform>` deletes that platform's generated files and rebuilds them. It is a delete-and-rebuild, **not an uninstall**: on Claude Code the whole `.claude/` directory is removed (keep your own additions elsewhere), on Codex only the flow-comet skills and managed entries are removed, and `flow-kit/` is never deleted. The deletion list is printed before anything happens; `--yes` is the second confirmation.
