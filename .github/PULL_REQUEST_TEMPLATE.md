# Pull Request

## 摘要 / Summary

<!-- 改了什么、为什么；关联 issue 时附链接 -->
<!-- What changed and why; link related issues -->

## 改动范围（勾选）/ Scope of Changes (check)

- [ ] 工作流脚本 / Workflow scripts（`.comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/`）
- [ ] Skill 指令 / Skill instructions（`skills/flow-comet*/`）
- [ ] 安装器 / Installer（`scripts/prepare-env.mjs`）
- [ ] 回归场景 / Regression scenarios（guard-self-test）
- [ ] 文档 / Docs（README / docs/ / CHANGELOG / CONTRIBUTING）
- [ ] 版本收尾 / Version wrap-up（CHANGELOG 条目 + 徽章 + VERSIONS）
- [ ] 其他 / Other：

## 验证（勾选已执行）/ Verification (check executed)

- [ ] 回归测试 / Regression：`node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs` → ALL 105 SCENARIOS PASSED
- [ ] 脚本改动：先写失败测试（确认测试因缺陷失败）再实现 / Script changes: write a failing test first (confirm it fails for the right reason) before implementing
- [ ] 文档改动：中英双语同步 / Doc changes: EN and ZH mirrored
- [ ] 发布验证：各安装副本回归通过 / Release check: regression passes in all installed copies
- [ ] 未运行（说明原因）/ Not run (explain)：

## 自查（勾选）/ Self-check (check)

- [ ] 提交信息为纯描述（无代号、编号、行话）/ Commit messages are plain descriptions (no codes, numbers, jargon)
- [ ] CHANGELOG 条目含 PR 链接（行为变化时）/ CHANGELOG entry links its PR (when behavior changes)
- [ ] 版本号 / 场景数与实现一致 / Version number / scenario count match the implementation
- [ ] 向后兼容：无破坏性变更（如有已说明）/ Backward compatible: no breaking changes (explain if any)
- [ ] 无无关文件或本地伪影 / No unrelated files or local artifacts

## 审查注意点 / Review Notes

<!-- reviewer 需特别关注的点 -->
<!-- Points the reviewer should pay special attention to -->
