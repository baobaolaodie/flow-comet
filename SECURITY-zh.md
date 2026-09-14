<div align="right">

[English](SECURITY.md) · [中文](SECURITY-zh.md)

</div>

# 安全政策

## 报告漏洞

请通过 GitHub 的**私密安全公告(private security advisory)**私下报告安全漏洞——不要以公开 issue 形式报告。这会在漏洞修复前保持其不公开。

1. 进入仓库 **Security** 标签 → **Report a vulnerability**(或 <https://github.com/baobaolaodie/flow-comet/security/advisories/new>)。
2. 描述问题、受影响版本(安装副本的 `INSTALLED_VERSION`,或源仓库的 `git describe --tags`)与复现步骤。
3. 在修复发布前,请勿公开披露漏洞。

我们以 72 小时内确认报告为目标,并尽快给出修复计划或评估。

## 范围

范围内:

- 权威源下的技能脚本(`.flow-comet/skills/flow-comet/scripts/`):状态机/门禁/交接、hook 防线、上下文初始化
- 安装器(`scripts/prepare-env.mjs`)与本地 hook(`.githooks/`)
- GitHub Actions 工作流(`.github/workflows/`)
- flow-comet 对该第三方依赖的用法——调用路径,以及本项目对该包行为所作的假设

范围外:

- 第三方包自身的漏洞:安装器依赖 `@clack/prompts`(锁定精确版本)实现交互式平台多选,该依赖不可用时自动回退 readline——它自身的漏洞请向上游报告。flow-comet 的其余部分仅使用 Node.js 内置模块
- [flow-kit](https://github.com/rihebty/flow-kit) 的上游模板与内容
- 使用 flow-comet 的用户项目内容(其自有代码与工件)

## 受支持版本

安全修复应用于最新发布版本。旧版本按尽力而为原则支持;建议保持安装副本更新。
