---
name: flow-comet-test
description: "flow-kit TEST 阶段协议：5 轮测试金字塔（功能/性能/安全/兼容/可观测）+ 测试质量 6 维自检。flow-comet review 节点的 flow-kit 增强。"
---

# flow-kit TEST Protocol

本 Skill 为 flow-comet 的 review 节点提供 flow-kit 的 5 轮测试金字塔。

## 加载

读取 `flow-kit/prompts/5-test.md` 并按其执行。

### 5 轮测试金字塔

| 轮次 | 内容 | 适用性 |
|------|------|--------|
| 第 1 轮 · 功能 | AC→测试映射 + 覆盖率 + 边界用例 + T1~T6 测试质量自检 | ✅ 必跑 |
| 第 2 轮 · 性能 | Lighthouse / k6 / locust + 慢查询审计 + N+1 检测 | 按项目 |
| 第 3 轮 · 安全 | 依赖漏洞 + 秘钥扫描 + SAST + OWASP Top 10 | 按项目 |
| 第 4 轮 · 兼容 | 跨浏览器 + 数据迁移验证 + 跨版本 | 按项目 |
| 第 5 轮 · 可观测 | 日志 + 指标 + 告警 + 健康检查 | 按项目 |

### 测试质量 6 维自检（T1~T6）

| 编号 | 风险 | 来源 |
|------|------|------|
| T1 | Test Obscurity 测试晦涩 | xUnit Test Patterns |
| T2 | Test Brittleness 测试脆弱 | The Art of Unit Testing |
| T3 | Test Duplication 测试重复 | How Google Tests Software |
| T4 | Mock Abuse Mock 滥用 | Working Effectively with Legacy Code |
| T5 | Coverage Illusion 覆盖率幻觉 | xUnit Test Patterns |
| T6 | Architecture Mismatch 架构错配 | How Google Tests Software |

## 产物

- `.specs/<change-id>/TEST.md`（使用 `flow-kit/templates/TEST.md`）

## 使用范围

TEST.md 的完整性由 review 节点第 2 轮检查。brooks-lint 已装时用 `/brooks-test`（Codex 用 `$brooks-test`），未装时用内置清单。
