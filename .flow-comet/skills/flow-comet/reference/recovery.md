# Workflow Recovery

> 正文为中文;结构标题保留协议英文概念名（workflow-run）便于与协议字段对应。

## 状态模型：workflow-run（主）

- State model: `workflow-run`（protocol `state.kind` 定义，flow-comet 实际使用）
- State path: `.flow-comet/flow-comet-state.json`（单文件 JSON，机器字段由脚本管理，绝不手改）
- Resume by reading the first incomplete Workflow Node（`completedNodes` 之后的第一个节点）
- 状态推导：从 `.specs/<change-id>/` 工件文件推导（file-as-truth），脚本状态只是加速器；状态文件缺失或与产物冲突时以产物为准

## 恢复指引（workflow-run）

- 未 entry 直接 exit 被拦（新 change BLOCKED）：先 `workflow-guard.mjs entry <node>` 再重试 exit——entry 的进入检查（协调者禁令/委托前检查/签名记录）是节点进入前置，不可跳过
