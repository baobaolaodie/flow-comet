<div align="right">

[中文](SECURITY-zh.md)

</div>

# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** via GitHub's private security advisory — not as a public issue. This keeps the vulnerability hidden until it is addressed.

1. Go to the **Security** tab of the repository → **Report a vulnerability** (or <https://github.com/baobaolaodie/flow-comet/security/advisories/new>).
2. Describe the issue, the affected version (see `INSTALLED_VERSION` in your installed copy, or `git describe --tags` in the source repo), and reproduction steps.
3. Do not disclose the vulnerability publicly before a fix is released.

We aim to acknowledge reports within 72 hours and to respond with a fix plan or an assessment.

## Scope

In scope:

- Skill scripts under the authoritative source (`.comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/`): workflow state/guard/handoff, hook guard, context init
- The installer (`scripts/prepare-env.mjs`) and local hooks (`.githooks/`)
- GitHub Actions workflows (`.github/workflows/`)

Out of scope:

- Third-party runtime dependencies (there are none — Node.js built-ins only)
- Upstream templates and content from [flow-kit](https://github.com/rihebty/flow-kit)
- Content of user projects using flow-comet (their own code and artifacts)

## Supported versions

Security fixes are applied to the latest release. Older releases are supported on a best-effort basis; we recommend keeping installed copies up to date.
