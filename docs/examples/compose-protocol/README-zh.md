# compose-protocol 示例：自定义协议（brainstorm → tdd → codereview）

> 用 `/flow-comet-compose` 组合三个已安装 skill 生成自定义工作流的**完整示例**——协议 JSON + 冒烟验证记录。节点 id 避开内置 8 节点 id（`brainstorm`/`tdd`/`codereview`），特化校验不误触发。

## 文件

| 文件 | 说明 |
|------|------|
| `protocol.json` | 自定义协议（brainstorm → tdd → codereview，writeWhitelist 用 `<change-id>` 占位符——协议跨 change 复用自动适配） |
| `VALIDATION.md` | `validateProtocolSchema` 冒烟验证记录（协议生效证据） |

## 使用

1. 复制 `protocol.json` 到你的项目（建议 `.specs/protocols/<name>.json`）
2. 把 `implementation.skill` 替换为你实际安装的 skill 名（示例为 superpowers 系占位）
3. 冒烟验证（见 VALIDATION.md 的命令）
4. 启动：`/flow-comet`（配合 `FLOW_COMET_PROTOCOL` 环境变量指向协议，或由 Claude 以 `--protocol` 附带）

## 协议要点

- **每节点有产物**：outputSchemas 引用非空 `artifacts[].paths`
- **每节点有 evidence**：每条 schema 带 `evidence: [{ id, required }]`
- **写源码需声明**：`writeWhitelist.tdd` 需声明源码路径（如 `calc/`、`tests/`）——未声明时自定义节点默认协调者白名单 `.specs/`，写源码会被 hook BLOCK
- **`<change-id>` 占位符**：writeWhitelist 与 artifacts paths 均支持，协议跨 change 复用无需手工改路径
