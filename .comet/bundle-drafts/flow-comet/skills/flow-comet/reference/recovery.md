# Workflow Recovery

> 正文为中文;结构标题保留协议英文概念名（workflow-run / overlay）便于与协议字段对应。

## 状态模型：workflow-run（主）

- State model: `workflow-run`（protocol `state.kind` 定义，flow-comet 实际使用）
- State path: `.comet/flow-comet-state.json`（单文件 JSON，机器字段由脚本管理，绝不手改）
- Resume by reading the first incomplete Workflow Node（`completedNodes` 之后的第一个节点）
- 状态推导：从 `.specs/<change-id>/` 工件文件推导（file-as-truth），脚本状态只是加速器；状态文件缺失或与产物冲突时以产物为准

## 恢复指引（workflow-run）

- 未 entry 直接 exit 被拦（新 change BLOCKED）：先 `workflow-guard.mjs entry <node>` 再重试 exit——entry 的进入检查（协调者禁令/委托前检查/签名记录）是节点进入前置，不可跳过

## Overlay 模型（comet 平台模型，仅 compose/平台集成场景）

- `comet-overlay`（`changes/*/.comet.yaml`）是 **comet 平台模型**，非 flow-comet 默认状态——hook 中以 `isCometOverlay(protocol)` 分支（`protocol.kind === 'comet-five-phase-overlay'`）识别并走 overlay 状态读取路径
- 适用场景：通过 comet 平台把 flow-comet 当作 five-phase overlay 挂载时（compose 自定义协议 / 平台集成）；此时状态由 overlay 文件承载，恢复时读 overlay 状态 + 对应 change 的产物
- 默认协议（内置 8 节点）与绝大多数目标项目使用 workflow-run；两者不可互换——按实际加载的 protocol `state.kind` 选择恢复路径
