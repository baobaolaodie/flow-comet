# VALIDATION：协议冒烟验证记录

**协议**：`protocol.json`（brainstorm → tdd → codereview）
**日期**：2026-08-08
**校验命令**（`validateProtocolSchema`——fail-closed：schemaVersion 必须为 1、nodes 必须是非空数组、writeWhitelist/taskFile 存在则校验形状）：

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { validateProtocolSchema } from './.claude/skills/flow-comet/scripts/protocol-utils.mjs';
const protocol = JSON.parse(readFileSync('protocol.json', 'utf8'));
validateProtocolSchema(protocol);
console.log('protocol valid');
"
```

> 路径按实际安装位置调整（如 `.comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/protocol-utils.mjs`）。

## 验证结果

```
protocol valid
```

## 运行时行为（guard-self-test 场景覆盖）

| 行为 | 验证 |
|------|------|
| init 后 currentNode = 协议首节点 brainstorm（非硬编码 open） | ✅ |
| 未声明/声明 writeWhitelist 的自定义节点白名单判定 | ✅ |
| writeWhitelist `<change-id>` 占位符替换（协议跨 change 复用） | ✅ |
| 无 statePath 声明时 hook 回退默认路径（最小 schema 协议不崩溃） | ✅ |
| 特化校验不误触发自定义节点 id | ✅ |

## 真实项目实证

该协议（或同构变体）已在真实项目中完整跑通三个 change：

| change | 协议形态 | 结果 |
|--------|---------|------|
> 下方 passed 数为**当时目标项目（calc 仓库）的测试计数**，非 flow-comet 场景数（2026-08-08 实证时 114；当前 123）；为 2026-08-08 实证记录。

| sci-notation（科学计数法） | 同构协议 + 声明白名单 | 87 passed 零回归，完整流程+归档 |
| calc-mod（取模） | 声明白名单（含 `<change-id>` 适配） | 101 passed，guard 全过 |
| calc-min（min 函数） | **未声明白名单**（协调者默认） | 168 passed，流程不卡，协调者默认白名单语义验证 |
