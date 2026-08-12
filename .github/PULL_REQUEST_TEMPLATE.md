# Pull Request

## 摘要 / Summary

<!-- 结构引导：动机(为什么做)→ 做法(改了什么)→ 影响(影响范围与验证依据) / Structure: Motivation → What changed → Impact -->

## 改动范围（勾选）/ Scope of Changes (check)

- [ ] 工作流脚本 / Workflow scripts（`.comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/`）
- [ ] Skill 指令 / Skill instructions（`skills/flow-comet*/`）
- [ ] 安装器 / Installer（`scripts/prepare-env.mjs`）
- [ ] 回归场景 / Regression scenarios（guard-self-test）
- [ ] 文档 / Docs（README / docs/ / CHANGELOG / CONTRIBUTING）
- [ ] 版本收尾 / Version wrap-up（CHANGELOG 条目 + 徽章 + VERSIONS）
- [ ] 其他 / Other：

## 验证（勾选已执行）/ Verification (check executed)

- [ ] 回归测试 / Regression：`node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs` → ALL 113 SCENARIOS PASSED + `system-test.mjs` → ALL SYSTEM TESTS PASSED
- [ ] 脚本改动：先写失败测试（确认测试因缺陷失败）再实现 / Script changes: write a failing test first (confirm it fails for the right reason) before implementing
- [ ] 文档改动：中英双语同步 / Doc changes: EN and ZH mirrored
- [ ] 发布验证：各安装副本回归通过 / Release check: regression passes in all installed copies
- [ ] 未运行（说明原因）/ Not run (explain)：

## 自查（勾选）/ Self-check (check)

- [ ] 提交信息为纯描述（无代号、编号、行话）/ Commit messages are plain descriptions (no codes, numbers, jargon)
- [ ] 版本号 / 场景数与实现一致 / Version number / scenario count match the implementation
- [ ] 向后兼容：无破坏性变更（如有已说明）/ Backward compatible: no breaking changes (explain if any)
- [ ] 无无关文件或本地伪影 / No unrelated files or local artifacts

## 基于版本 / Based on

<!-- 基于哪个基线开发：main v1.3.1 / 最新 dev / 具体 commit / Which baseline (e.g. main v1.3.1, latest dev, specific commit) -->

## 关联（可选）/ Related (optional)

<!-- 关联 issue / PR（如 Fixes #39）/ Related issues / PRs -->

## 审查注意点 / Review Notes

<!-- reviewer 需特别关注的点 -->
<!-- Points the reviewer should pay special attention to -->
