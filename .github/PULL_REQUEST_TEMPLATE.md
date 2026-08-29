# Pull Request

## 摘要 / Summary

<!-- 标题须为 Conventional Commits：<type>(<scope>): <subject>，如 feat: ... / fix: ... / docs: ... / ci: ... -->
<!-- Title must be Conventional Commits: <type>(<scope>): <subject>, e.g. feat: ... / fix: ... / docs: ... / ci: ... -->
<!-- 结构引导：动机(为什么做)→ 做法(改了什么)→ 影响(影响范围与验证依据) / Structure: Motivation → What changed → Impact -->

## 改动范围（勾选）/ Scope of Changes (check)

- [ ] 工作流脚本 / Workflow scripts（`.comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/`）
- [ ] Skill 指令 / Skill instructions（`.comet/bundle-drafts/flow-comet/skills/flow-comet*/`）
- [ ] 安装器 / Installer（`scripts/prepare-env.mjs`）
- [ ] 回归场景 / Regression scenarios（guard-self-test；场景数变化需全库同步 / scenario-count changes require repo-wide sync）
- [ ] 文档 / Docs（README / docs/ / CHANGELOG / CONTRIBUTING）
- [ ] 版本收尾 / Version wrap-up（CHANGELOG 条目 + 徽章 + VERSIONS + 权威源 INSTALLED_VERSION）
- [ ] 其他 / Other：

## 验证（勾选已执行）/ Verification (check executed)

<!-- 关键验证输出请粘贴到验证段下方(如回归结果/失败日志),reviewer 可直接核验 / Paste key verification output below (e.g. regression result, failure logs) so reviewers can check directly -->
- [ ] 回归测试 / Regression：`node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs` → ALL 208 SCENARIOS PASSED + `node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/system-test.mjs` → ALL SYSTEM TESTS PASSED
- [ ] 脚本改动：先写失败测试（确认测试因缺陷失败）再实现 / Script changes: write a failing test first (confirm it fails for the right reason) before implementing
- [ ] 文档改动：中英双语同步 / Doc changes: EN and ZH mirrored
- [ ] 发布验证：各安装副本回归通过 / Release check: regression passes in all installed copies
- [ ] 如有未运行的验证项（说明原因）/ Not run if any (explain)：

## 自查（勾选）/ Self-check (check)

- [ ] 提交信息为纯描述（无代号、编号、行话）/ Commit messages are plain descriptions (no codes, numbers, jargon)
- [ ] 版本号 / 场景数与实现一致 / Version number / scenario count match the implementation
- [ ] 行为变化已记入 CHANGELOG（Unreleased）/ Behavior changes recorded in CHANGELOG (Unreleased)
- [ ] 向后兼容：无破坏性变更（如有已说明）/ Backward compatible: no breaking changes (explain if any)
- [ ] 无无关文件或本地伪影 / No unrelated files or local artifacts

## 基于版本 / Based on

<!-- 基于哪个基线开发：main 最近发布版本 / 最新 dev / 具体 commit / Which baseline (e.g. latest release on main, latest dev, specific commit) -->

## 关联（可选）/ Related (optional)

<!-- 仅本 PR 解决的 issue 用 Fixes/Closes/Resolves #N（合入默认分支时自动关闭）；注意：开发 PR 目标是 dev（非默认分支），关键词不会触发自动关闭——需在发布 PR（dev → main）中处理。
Only use Fixes/Closes/Resolves #N for issues this PR actually resolves (auto-closed on merge into the default branch). Note: dev-targeted PRs are not the default branch, so these keywords do not auto-close — handle closing in the release PR (dev → main).
非解决性事项用文字描述即可，不要引用 issue 编号（避免在 issue 时间线留下误导性引用）。
For anything not resolved by this PR, describe it in text without referencing issue numbers (avoids misleading cross-references on the issue timeline). -->

## 审查注意点 / Review Notes

<!-- reviewer 需特别关注的点 -->
<!-- Points the reviewer should pay special attention to -->
