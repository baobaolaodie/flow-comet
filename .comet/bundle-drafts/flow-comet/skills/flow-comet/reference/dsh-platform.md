# dsh 平台锚定参考（dsh-platform）

> 内部参考文档：dsh 平台适配的版本锚定、API 签名、安装/激活/卸载与验证记录模板。
> 权威依据：`@.specs/deepseek-harness-platform/DESIGN.md`（D7 / 7.1 / 7.2）、`@.specs/deepseek-harness-platform/REQUIREMENT.md`（AC-1~AC-7）、T03 action。
> dsh 为 dev-preview：本文件锚定实测版本；破坏性变更风险显式声明。

## 1. 版本锚定

| 项 | 值 |
|---|---|
| 最低 dsh 版本 | `0.1.0-rc.6` |
| 插件包 | `dsh-flow-comet`（npm，版本与 flow-comet 同步 1.4.2） |
| 安装命令 | `dsh plugin --profile <name> add dsh-flow-comet` |
| 卸载双步 | `node …/scripts/cleanup.mjs` → `dsh plugin --profile <name> remove dsh-flow-comet` |
| 破坏性变更 | dev-preview 中 `tools/pre-execute` / `ctx.skills.registerProvider` 签名可能变化；低于锚定版本时拦截/注册可能失效 |

> 版本不匹配时拦截可能失效——必须文档警示 + 级 3 实测兜底（D7）。

## 2. tools/pre-execute 签名

```js
ctx.on('tools/pre-execute', async (exec, next) => {
  // exec: ToolExecution
  //   { callId, name, arguments, signal, agent?, parent? }
  // 放行: return next();
  // 拒绝: return { kind: 'deny', reason: '…' };
  // 询问: return { kind: 'ask', reason? };
});
```

- PreToolDecision 形状：`{kind:'allow'}` | `{kind:'deny', reason}` | `{kind:'ask', reason?}`；deny 必须带 `kind` 字段。
- 不调 `next()` 即短路；`deny` 使工具体跳过。
- 会话 cwd：`exec.agent.session.header.cwd`（逐会话；Web UI 切换 workspace 时按会话判定，非进程 cwd）。

## 3. fs/write-intent（single-slot 守卫瀑布）

```ts
(target: FsTarget, actor: object | undefined, next) => FsWriteIntent | undefined
```

- 决策形状：`{kind:'createIfAbsent'}` | `{kind:'replaceIfVersion', version}`——守卫，**无 deny 决策面**。
- single-slot：first-wins by registration order。
- **flow-comet 不注册该槽位**（避免 shadow 官方 `dsh-fs-observation-policy` 的 freshness 检查）；拦截能力由 `tools/pre-execute` 全覆盖。

## 4. fs/observed（观察/审计通道）

- 事件：`fs/observed` 为 emit 记录事件（FsObservation：present/absent）。
- 监听必须**同步、side-effect-only**；append 失败仅 WARN、不得 throw（throw 会替换读错误或使工具 isError）。
- flow-comet 用途：记录写入观察事件到 `$DSH_HOME/flow-comet-audit.jsonl`（append-only）。
- 过滤：仅记录 actor 工具名 `write`/`edit` 的写入观察（read 不记）；Bash 放行写入不经 fs/* 事件不入审计；deny 事件由 tools/pre-execute 分支同步记录。
- `$DSH_HOME` 解析：优先 `DSH_HOME` 环境变量，未设置时用 dsh CLI 同款默认 `~/.dsh`。

## 5. ctx.skills 注册（provider 注册模型）

```ts
ctx.skills.registerProvider(create)
// SkillProvider = {
//   name: string,
//   list({cwd, signal}),
//   get(candidate, {cwd, signal})
// }
```

- 主选：`registerProvider`（provider 注册模型），**非直接 `register` 技能内容**。
- 本地发现目录（`.agents/skills` rank 200 / customSkillDirs rank 300）由 skill-filesystem 提供。
- 包内技能命令路径在注册时注入包内实际路径（`import.meta.url` 解析）。

## 6. 安装 / 激活 / 卸载

### 安装

- 正式：`dsh plugin --profile <name> add dsh-flow-comet`（npm registry）。
- 开发/级 3 冒烟：`dsh plugin add ./dsh-flow-comet-1.4.2.tgz`（pnpm pack 产物等价）。
- 无 prepare-env / 无安装脚本参与。

### 激活（项目级默认 / 全局可选）

- 项目级默认：会话 cwd 含 `.comet/` 或 `.specs/` 痕迹才激活（技能/拦截/注入）。
- 全局：显式配置启用后所有项目技能可见；**注入（AGENTS.md 托管区 + 协议副本）仍仅对含痕迹项目**。
- 激活动作：
  - AGENTS.md 托管区注入（`<!-- Managed by flow-comet prepare-env -->` 包裹 flow-comet-orchestration.md 全文；非破坏合并；orchestration 中 `skills/flow-comet/…` 相对指针改写为包内实际路径）。
  - 协议副本复制：`<项目根>/reference/.flow-comet-workflow-protocol.json`（幂等覆盖）。
  - spawn 判定时设 `FLOW_COMET_PROTOCOL=<项目根>/reference/.flow-comet-workflow-protocol.json`。
  - **spawn cwd 必须 = 会话项目根**（`exec.agent.session.header.cwd`）——相对 file_path 按 cwd 解析；cwd≠项目根 = fail-open 不可接受。
  - 注入项目记录持久化到 `$DSH_HOME/flow-comet-injected.json`（`{ "version": 1, "projects": [{ "cwd": "<abs>", "injectedAt": "<iso>" }] }`，按 cwd 幂等 upsert）。

### 卸载（显式双步）

1. `node …/scripts/cleanup.mjs`：读 `$DSH_HOME/flow-comet-injected.json` → 逐个 strip AGENTS.md 托管区（保留托管区外用户内容）→ 移除 `<项目根>/reference/.flow-comet-workflow-protocol.json` → 清空记录。
2. `dsh plugin --profile <name> remove dsh-flow-comet`：官方 CLI 移除 bundle 层。

- 幂等容错：AGENTS.md 已被删除/无托管区、协议副本不存在 → 跳过不报错。
- `$DSH_HOME/flow-comet-audit.jsonl` 为 append-only 保留物：cleanup 在最后一份注入记录清空时提示「审计日志保留于 $DSH_HOME/flow-comet-audit.jsonl，如需删除请手动处理」。
- 不依赖插件 disposer（官方实证：remove 不 boot、不加载插件）。

## 7. 验证记录模板

> 级 3 / 级 4 执行后按此模板回填；发布前逐项闭环（DESIGN 7.3）。

### 环境

- 日期：
- dsh 版本：
- 插件包版本/来源（npm / tgz / 本地目录）：
- profile：
- 临时项目路径：

### 检查项

| # | 检查 | 结果 | 证据（命令/输出摘要） |
|---|---|---|---|
| 1 | `dsh plugin add` 安装成功（bundle manifest 生效） |  |  |
| 2 | 技能 provider 注册与命令路径注入 |  |  |
| 3 | 项目级激活：痕迹项目激活 / 非痕迹项目零写入 |  |  |
| 4 | 全局模式：痕迹项目注入 / 无痕迹项目不写文件 |  |  |
| 5 | 越权 Write deny（PreToolDecision `{kind:'deny', reason}`）+ BLOCK 消息 |  |  |
| 6 | 参数形状不符 → fail-closed deny + WARN |  |  |
| 7 | 合法写放行 |  |  |
| 8 | 协议副本存在 + FLOW_COMET_PROTOCOL 指向生效 + spawn exit 非 1 |  |  |
| 9 | spawn cwd = 会话项目根（负向：cwd≠项目根不可接受） |  |  |
| 10 | AGENTS.md 托管区注入 + 用户内容保留 |  |  |
| 11 | fs 槽位竞争：未注册 fs/write-intent（官方 policy 未被 shadow） |  |  |
| 12 | audit.jsonl 写入 + write/edit 过滤 + Bash 不入审计 + append 失败仅 WARN |  |  |
| 13 | cleanup 后托管区/协议副本移除 + 用户内容保留 + audit 保留提示 |  |  |
| 14 | remove 后技能不可见 / 拦截不再生效 |  |  |
| 15 | 升级重装：幂等重注册/重注入 + 协议副本随版本刷新 |  |  |

### 结论

- 通过 / 不通过：
- 失败项与修复记录：
- 遗留风险：
