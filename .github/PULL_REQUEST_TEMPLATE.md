# Pull Request

## 摘要

<!-- 改了什么、为什么；关联 issue 时附链接 -->

## 改动范围（勾选）

- [ ] 工作流脚本（`.comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/`）
- [ ] Skill 指令（`skills/flow-comet*/`）
- [ ] 安装器（`scripts/prepare-env.mjs`）
- [ ] 回归场景（guard-self-test）
- [ ] 文档（README / docs/ / CHANGELOG / CONTRIBUTING）
- [ ] 版本收尾（CHANGELOG 条目 + 徽章 + VERSIONS）
- [ ] 其他：

## 验证（勾选已执行）

- [ ] 回归测试：`node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/guard-self-test.mjs` → ALL 87 SCENARIOS PASSED
- [ ] 脚本改动：先写失败测试（确认测试因缺陷失败）再实现
- [ ] 文档改动：中英双语同步
- [ ] 发布验证：各安装副本回归通过
- [ ] 未运行（说明原因）：

## 自查（勾选）

- [ ] 提交信息为纯描述（无代号、编号、行话）
- [ ] CHANGELOG 条目含 PR 链接（行为变化时）
- [ ] 版本号 / 场景数与实现一致
- [ ] 向后兼容：无破坏性变更（如有已说明）
- [ ] 无无关文件或本地伪影

## 审查注意点

<!-- reviewer 需特别关注的点 -->
