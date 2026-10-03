<div align="right">

[English](README.md) · [中文](README-zh.md)

</div>

<h1 align="center">flow-comet</h1>

<p align="center">
  <strong>An automated execution engine that turns AI coding discipline into a verifiable state machine — for the flow-kit 9-stage workflow, built for Claude Code, Codex, and DeepSeek Harness.</strong>
  <br />
  <em>For AI coding workflows — deterministic state machine · protocol-driven · guard-validated · subagent-isolated</em>
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/Quick_Start-4CAF50?style=for-the-badge" alt="Quick Start" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License" /></a>
</p>

<p align="center">
  <a href="https://claude.ai/code"><img src="https://img.shields.io/badge/Claude_Code-D97757?style=flat&logo=claude&logoColor=white" alt="Claude Code" /></a>
  <a href="https://github.com/openai/codex"><img src="https://img.shields.io/badge/Codex-10A37F?style=flat&logoColor=white" alt="Codex" /></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek_Harness-4D6BFE?style=flat&logoColor=white" alt="DeepSeek Harness" /></a>
  <a href="https://github.com/rihebty/flow-kit"><img src="https://img.shields.io/badge/flow--kit-4CAF50?style=flat" alt="flow-kit" /></a>
  <a href="https://github.com/rpamis/comet"><img src="https://img.shields.io/badge/comet-4CAF50?style=flat" alt="comet" /></a>
</p>

<p align="center">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js_%E2%89%A518-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js 18+" /></a>
  <a href="https://github.com/baobaolaodie/flow-comet/actions"><img src="https://img.shields.io/github/actions/workflow/status/baobaolaodie/flow-comet/ci.yml?style=flat" alt="CI" /></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.6.2-blue.svg" alt="Version" /></a>
</p>

---

## Quick Start

Three steps, run from your project directory:

```bash
# 1. Install the CLI globally (Node.js 18+)
npm install -g flow-comet

# 2. Go to your project
cd <your project>

# 3. Install flow-comet into it
fcomet init
```

`fcomet` and `flow-comet` are two names for the same installer. The `init` token may be omitted whenever another argument expresses the intent (`fcomet --target <dir>`), and `--target` itself defaults to the current directory; called with no arguments at all the command prints its usage and exits non-zero instead of installing. On a terminal the first run asks which platform to set up; for a non-interactive pick use `--platform claude-code`, `--platform codex`, `--platform dsh`, a comma-separated combination such as `--platform claude-code,dsh`, or `--platform all`. Re-running the same command updates an existing install and is idempotent. Upgrading the global package only replaces the CLI — run `fcomet init` in a project again to refresh that project's copy.

**Verify**:

```bash
fcomet --version                                   # the installed CLI version
cat .claude/skills/flow-comet/INSTALLED_VERSION    # the version written into this project
```

The installer writes the marker to `.claude/skills/flow-comet/INSTALLED_VERSION` for Claude Code, `.agents/skills/...` for Codex and `.dsh/skills/...` for dsh. It records the version the copy came from: the package's release version for an npm install, or the repository's `git describe` value for an install run from a clone (that form carries a `-<n>-g<hash>` suffix when the clone is ahead of its tag).

## Use it

Open a session in your project and invoke the workflow:

- **Claude Code** — `/flow-comet`
- **Codex** — invoke the skill (`/use flow-comet`, or simply ask for the flow-comet workflow in natural language)
- **DeepSeek Harness** — invoke the `flow-comet` skill

The first call confirms scope, then creates the branch for the change, initializes the state and enters the first node, producing that change's `CHANGE.md` / `REQUIREMENT.md` under `.specs/`. Every later stage is routed automatically — you only answer the decision points (scope, tech stack, destructive changes, review findings, archive confirmation). On first use in a project it detects a missing project context and offers to build one from your existing documents before starting.

To see where it is, just ask it — or inspect it from the command line with `status` and `next` in the project (the per-platform paths are in [Installation](docs/INSTALLATION.md)).

Artifacts live in `.specs/<change-id>/`; on archive they move to `.specs/archive/<date>-<change-id>/` and a row is added to `.specs/CHANGELOG.md`. The node-by-node walkthrough — including what the workflow runs underneath, and how to drive a node by hand when you need to — is in [Usage](docs/USAGE.md).

## Pick a platform

| Platform | Skills install to | Hook / bridge | First use |
|---|---|---|---|
| Claude Code (default) | `.claude/skills/` | `settings.local.json` → `hooks.PreToolUse` | the workspace must be trusted; headless sessions need that trust pre-accepted |
| Codex | `.agents/skills/` | `.codex/hooks.json`, plus a managed block in `AGENTS.md` | trust the project hook once (interactive), or pass the automation flag for scripted runs — see [Installation](docs/INSTALLATION.md) |
| DeepSeek Harness (dsh) | `.dsh/skills/` | global bridge loader under `$DSH_HOME`, plus a managed block in `AGENTS.md` | no hook-trust step |

Prerequisites, all four install options, the per-platform verification steps and uninstall/reset behaviour: [Installation](docs/INSTALLATION.md).

## Why

If you use skill-based disciplines like [superpowers](https://github.com/obra/superpowers), [OpenSpec](https://github.com/Fission-AI/OpenSpec), or [GSD](https://github.com/open-gsd/gsd-core), you know the pain: discipline relies on the model's compliance, and progress lives in chat history. flow-comet turns the flow-kit 9-stage process (CHANGE → REQUIREMENT → DESIGN → TASK → DEV → TEST → REVIEW → INTEGRATION → ARCHIVE) from a discipline-dependent manual flow into a **verifiable deterministic state machine**:

- **Automated routing** — scripts manage stage transitions, guard validations, and hook-based write interception
- **Protocol-driven** — the built-in 8-node protocol is the default workflow; custom protocols composed from any installed skill run on the same engine (see [Custom Protocols](docs/MECHANISM.md#custom-protocols))
- **Three defense layers** — physical write interception (hook), coordinator prohibition, and exit takeover detection
- **Subagent-isolated execution** — implementation work is delegated to fresh-context subagents with a verifiable Return Contract
- **File-as-truth recovery** — state is derived from `.specs/` artifacts, so recovery never depends on conversation history

## Why flow-comet

### Horizontal comparison

| Project | Positioning | Mechanism | Relationship to flow-comet |
|---------|-------------|-----------|---------------------------|
| **flow-kit** | Pure-Markdown methodology pack: 9-stage process + `.specs/` templates + R1-R8 rules, zero runtime | Humans load prompt files stage by stage; state flows through `.md` artifacts | **Dependency / base** — flow-comet is its automation layer; artifacts and rules fully inherited |
| **OpenSpec** (Fission-AI) | Spec-driven development framework: a lightweight spec layer before coding | `openspec/` directory, one proposal/specs/design/tasks per change, propose→apply→verify→archive | **Idea source + lighter alternative** — spec-first thinking fused into flow-kit; standalone use is lighter (no state machine, no stage gates) |
| **Superpowers** (obra) | Claude Code skill set + full dev methodology | Composable skills (brainstorm/plan/TDD/debug/review), triggered by context, enforced by instructions | **Idea source + partial overlap** — skill-based discipline relies on model compliance; flow-comet scripts and machine-verifies the same discipline |
| **comet** (rpamis) | Resumable long-task workflows + skill platform: protocol state machine, guard gates, hook interception | `/comet` routes by config; Classic = OpenSpec + Superpowers 5-stage state machine | **Mechanism source** — flow-comet borrows its mechanism shapes (protocol-as-truth, script-owned state, guard gates, hook whitelist) and drops its platform facilities (eval/publish); state does not interoperate with Comet Classic |
| **GSD** | Spec-driven development meta-prompt / context-engineering workflow | Milestones → slices → tasks; fresh context per stage with pre-inlined context; worktree isolation + UAT | **Idea source (same lane)** — fresh-context execution and stage gates align; no script state-machine routing, relies on prompt discipline |
| **spec-kit** (GitHub) | SDD toolkit: Spec → Plan → Tasks → Implement | Each stage feeds markdown artifacts to the next; task format with order IDs, parallel `[P]` markers, file paths | **Idea source (same lane)** — task-with-file-paths/parallel-marker shape is same-origin with flow-kit TASK; no stage-transition enforcement |
| **claude-task-master** | AI-driven task management (MCP + CLI) | PRD parsing → task decomposition → dependency graph → next-task orchestration | **Complement** — manages the task layer only (decomposition/ordering/dependencies), not stage gates, artifact validation, or write permissions |

### Vertical comparison: manual flow-kit → flow-comet

| Dimension | Manual flow-kit (discipline) | flow-comet (automated) |
|-----------|------------------------------|------------------------|
| Stage routing | Humans remember the flow and load prompts manually; skipping stages is on you | Scripts derive the current node from `.specs/` artifacts and route automatically; order violations are blocked |
| Validation | Humans eyeball artifacts against the rules; TEST.md commands "should" run | Guards enforce required artifacts/sections at every node entry/exit; verify actually executes the TEST.md commands and counts failures |
| Discipline enforcement | Rules are markdown text the model may ignore | Three defense layers: write whitelist physically blocks out-of-scope writes / coordinator prohibition / exit takeover detection |
| Recovery | Depends on conversation memory; progress is lost across sessions | File-as-truth: re-derive the node from `.specs/` and auto-correct state; any session resumes correctly |
| Parallel implementation | Humans coordinate multiple windows, easy to overstep | Subagents implement in isolated worktrees (coordinators cannot write source) and must return a verified contract (commit hash + evidence) |
| Decision burden | A confirmation point at every stage, humans answer everything | Decisions are classified (user-decided / auto-handled / stop conditions / manual handover); humans only intervene at key points (scope, tech stack, breaking changes, review findings, archive) |

### Why pick flow-comet

1. **Discipline goes from "self-discipline" to "machine-checked"** — every stage entry/exit has script validation: artifacts complete, sections filled, verify commands actually run, tasks stay in bounds.
2. **No lost progress across sessions** — where you are is always derived from `.specs/` artifacts, never from conversation memory; reopen and continue from the right node.
3. **Implementation and coordination are physically separated** — implementation runs in fresh-context subagents inside isolated worktrees and must return a verified contract; the coordinator is banned from writing source, and the write whitelist blocks violations at the physical layer.
4. **The native automation layer for flow-kit** — not a re-invention: artifact formats, rules, and stages are identical to flow-kit; a flow-kit project upgrades to a machine-driven flow by installing flow-comet, no migration needed.
5. **Protocol-driven, minimal dependency, install-and-run** — the built-in 8-node flow works out of the box; any installed skill can be composed into a custom protocol on the same engine; Node.js 18+; the only third-party dependency is `@clack/prompts`, used exclusively by the installer's TTY multi-select (with an automatic readline fallback otherwise); one command installs it.

**Fit**: flow-comet is built for long-running, multi-session development changes on Claude Code — the discipline it automates pays off when a change spans hours and multiple sessions. It is not a general CI/CD or project-management tool; Codex and DeepSeek Harness are supported (see [Installation](docs/INSTALLATION.md#platforms)), other platforms (Gemini / Cursor) are not guaranteed.

## Real-run artifacts

A complete 8-node run produces the full artifact trail shown in [docs/examples/processor-pipeline](docs/examples/processor-pipeline/) — a real archived change (end-to-end test project, 2026-08-13): CHANGE / REQUIREMENT / DESIGN / TASK / six-section summaries / REVIEW with disposition markers / TEST / UAT / KNOWN-ISSUES / skill-load declaration markers.

```
processor-pipeline/            (archived change, full artifact set)
├── CHANGE.md / REQUIREMENT.md / DESIGN.md / TASK.md
├── T01~T06-SUMMARY.md          (six-section summaries)
├── REVIEW.md                   (findings with disposition markers)
├── TEST.md / UAT.md            (verify actually executes the test command)
├── KNOWN-ISSUES.md
└── .skill-loads/               (11 skill-load declaration markers)
```

**Stable skill triggering** — workflow skills keep loading correctly through a 4h+ session:

![Skill triggering](images/long-run-4h-and-skill-triggering.png)

**5-hour verification run** — full validation and UAT at the end of a 5h14m session (↓399k tokens):

![Verification run](images/long-run-5h.png)

## Relationship to the upstream project

flow-comet automates the methodology of [flow-kit](https://github.com/rihebty/flow-kit) — its stages, artifacts, rules and templates are inherited rather than reinvented. The two projects do not share files: flow-kit is consumed as a read-only, pinned dependency, and this repository vendors a copy only as a format baseline. What may be borrowed, and how divergences are declared, is written down in [CONTRIBUTING.md](CONTRIBUTING.md#borrowing-boundary).

## Documentation

| Document | What it is the single place for |
|---|---|
| [Installation](docs/INSTALLATION.md) | Prerequisites, the four install options, platform choice, verification, and reset (purge is delete-and-rebuild, not uninstall) |
| [Usage](docs/USAGE.md) | The 8-node workflow, the per-node lifecycle and its commands, artifacts, branch mode, execution modes, user entry points |
| [Core Mechanisms](docs/MECHANISM.md) | The behaviour contract, the three defense layers, guard validation, and custom protocols |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Symptoms grouped by where they bite: installation, first run, a stuck node, platform |
| [Versions](docs/VERSIONS.md) | Version semantics, the nine version surfaces, and the release checklist |
| [CHANGELOG](CHANGELOG.md) | Per-version history |
| [Contributing](CONTRIBUTING.md) | Contribution flow and the borrowing boundary |
| [Security](SECURITY.md) | Reporting a vulnerability |

## Contributing

Full guide in [CONTRIBUTING.md](CONTRIBUTING.md) — branch model (`feature → dev → main`), PR workflow, merge rules, and commit convention. In short:

1. Branch from `dev`: `git checkout dev && git checkout -b feat/<description>`
2. Edit skills/scripts under `.flow-comet/skills/` (authoritative source); TDD with RED scenario first
3. Run regression: `node .flow-comet/skills/flow-comet/scripts/guard-self-test.mjs` → `ALL 309 SCENARIOS PASSED`
4. Open a PR into `dev` (squash — one change-level commit); release PR `dev → main` (merge — dev's change-level commits enter main, and dev stops leading after each release)

CI enforces the repository conventions automatically on every PR and push (regression, PR discipline, version consistency, dead links). Local hooks (commit/push message checks) install with `node scripts/install-commit-hook.mjs` — see [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## License

[MIT](LICENSE) © 2026 baobaolaodie

flow-comet depends on [flow-kit](https://github.com/rihebty/flow-kit) (MIT) and [Comet](https://github.com/rpamis/comet) (MIT).
