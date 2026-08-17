# dsh 平台锚定参考（dsh-platform）

> 维护者参考文档：dsh 平台适配的版本锚定、安装形态、API 签名、桥接 loader 契约与验证记录模板。
> 权威依据：`@.specs/deepseek-harness-platform/DESIGN.md`（D1~D10 / 7.1 / 7.2 / 7.3）、`@.specs/deepseek-harness-platform/REQUIREMENT.md`（AC-1~AC-7）、`@.specs/adr/ADR-005-dsh-install-via-installer.md`。
> dsh 为 dev-preview：本文件锚定实测版本（0.1.0-rc.6）；破坏性变更风险显式声明。

## 1. 版本锚定

| 项 | 值 |
|---|---|
| 最低 dsh 版本 | `0.1.0-rc.6` |
| 安装入口 | `node scripts/prepare-env.mjs --target <项目> --platform dsh`（或交互终端多选勾选 dsh）——唯一入口（D1） |
| 卸载 | `node scripts/prepare-env.mjs --target <项目> --purge --platform dsh --yes` |
| npm 包 | 暂不发布（D8——1.5.0 一并处理）；旧 npm 插件包安装形态已废弃（verify 阶段推翻，见 ADR-005） |
| 破坏性变更 | dev-preview 中 `tools/pre-execute` 签名 / skill 发现 rank / `DSH_HOME` 语义可能变化；低于锚定版本时拦截/发现可能失效 |

> 版本不匹配时拦截可能失效——必须文档警示 + 级 3 实测兜底（D9）。

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
- 不调 `next()` 即否决（waterfall 事件——监听方不续传则工具被短路）。
- 会话 cwd 锚定：`exec.agent.session.header.cwd`（逐会话；缺失时逐级回退 exec 上下文其它路径字段——见桥接 loader sessionCwd；Web UI 切换 workspace 时按会话判定，非进程 cwd）。

## 3. skill 发现（文件系统级——取代 provider 注册模型）

- dsh skill 发现 rank 区间 100~500；**rank 100（最高）= `<项目根>/.dsh/skills`**（0.1.0-rc.6 源码核实）——目录存在于项目根下即自动发现（chokidar 热发现，免重启）；未安装该目录的项目不可见该 skill → **天然项目级**（无运行时痕迹判定、无 chicken-and-egg）。
- 项目根 = 会话 cwd 的最近 `.git` 祖先（`.git` 可为目录或文件——worktree/submodule 形态）。
- 旧 provider 注册模型（`ctx.skills.registerProvider`）已废弃——skill 不再运行时注册，由文件系统发现 + 安装器物理安装（D3/D6）。

## 4. DSH_HOME 与 home patch

- `DSH_HOME` 解析（与 dsh CLI 同款默认）：显式配置 > `$DSH_HOME` 环境变量 > `~/.dsh`。
- **`DSH_` 前缀 bootstrap-only**：项目 `.env` 中设置 `DSH_HOME` 被直接拒绝——`.env` 方案不可行，文档明确不推荐（ADR-005 源码实证）。
- `$DSH_HOME/cordis.patch.yml` 为 home 级 patch，对所有 profile 生效——dsh 加载链 `bundles → profile → home → overlays`（ADR-005 源码核实）。
- flow-comet 托管块：`# --- flow-comet managed ---` … `# --- end flow-comet managed ---`（`- id: dsh-flow-comet-bridge` + `name: 'file:///<abs 路径>'`——参照本机既有惯例 dsh-skin 托管块）；读-合并-写保留既有块；文件存在但内容无法识别为 YAML → fail-safe 报错退出不覆盖。

## 5. fs/write-intent（single-slot 守卫瀑布）

```ts
(target: FsTarget, actor: object | undefined, next) => FsWriteIntent | undefined
```

- 决策形状：`{kind:'createIfAbsent'}` | `{kind:'replaceIfVersion', version}`——守卫，**无 deny 决策面**。
- single-slot：first-wins by registration order。
- **flow-comet 不注册该槽位**（避免 shadow 官方 `dsh-fs-observation-policy` 的 freshness 检查）；拦截能力由 `tools/pre-execute` 全覆盖（D6）。
- `fs/observed` 审计通道设计上不采用（v1 桥接 loader 极薄——D6；v2 可按需加）。

## 6. 安装 / 激活 / 卸载（prepare-env 平台描述符——唯一入口）

### 安装

- 正式：`node scripts/prepare-env.mjs --target <项目> --platform dsh`。
- 多平台：`--platform claude-code,dsh`（逗号分隔，按参数顺序安装）/ `--platform all`（全部平台，按 PLATFORMS 表顺序：claude-code → codex → dsh）；旧 `both` 已移除——`--platform both` 报错并提示用逗号列表或 all；未知平台报错（含逗号列表中的未知项——不得部分安装）。
- 交互（缺省选择链）：显式 `--platform` > TTY 交互多选 > 探测 > 默认 claude-code。TTY 多选 = @clack/prompts 方向键多选（可选依赖，未安装自动回退 readline 数字/逗号多选），按目标项目痕迹 `.claude/`/`.codex/`/`.dsh/` 预勾选，回车默认 = 探测推荐；无 TTY 探测：仅 `.codex/` → codex、仅 `.dsh/` → dsh、含 `.claude/` → claude-code、皆无 → 默认 claude-code；多痕迹（≥2 并存）不武断二选一——默认主平台 claude-code 并输出提示。
- 安装动作（dsh 描述符）：
  1. `installHooks`：复制 `scripts/dsh-bridge.mjs` → `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs`（全局挂载——home patch 对所有 profile 生效）+ `$DSH_HOME/cordis.patch.yml` 托管块注入（读-合并-写，保留既有块；源文件缺失时 WARN 跳过 loader 复制，其余安装照常）。
  2. `installRules`：AGENTS.md 托管区注入（`<!-- Managed by flow-comet prepare-env -->` … `<!-- /Managed by flow-comet prepare-env -->` 包裹编排规则全文；非破坏合并，保留托管区外用户内容；codex/dsh 共用标记——任一平台卸载可清）。
  3. skills：复制权威源 `skills/flow-comet/**` → `<项目>/.dsh/skills/flow-comet/` + pathReplacements（包内命令路径 `.claude/skills/flow-comet/scripts/` → `.dsh/skills/flow-comet/scripts/`，仅 .md，幂等）+ INSTALLED_VERSION 版本标识。

### 激活（天然项目级）

- 目录物理存在即激活——dsh 启动自动发现 `/flow-comet`（rank 100，chokidar 热发现免重启）；未安装该目录的项目不可见（无痕迹判定、无 chicken-and-egg）。
- dsh 对项目 AGENTS.md 的注入行为未实测（R2 遗留）——级 3 必测项；若 dsh 不注入则备选同时写 CLAUDE.md（symlink 同内容）并如实文档化。

### 卸载（prepare-env --purge --yes）

- `node scripts/prepare-env.mjs --target <项目> --purge --platform dsh --yes`：
  1. 删 `<项目>/.dsh/skills/` 下全部 `flow-comet*` 条目（非 flow-comet 条目保留）+ 空 `.dsh` 目录（有内容保留）。
  2. AGENTS.md 托管区移除（保留文件与用户内容）。
  3. `$DSH_HOME/cordis.patch.yml` 托管块移除（保留 dsh-skin 等既有块；移除后文件为空 → 删除文件本身）+ `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` 删除。
- 多项目语义：每项目独立安装 skill（未安装项目不可见）；loader 全局一份（按会话项目判定——与 claude-code 项目级 hook 等价）；同一 loader 服务多个 flow-comet 项目。

## 7. 桥接 loader 契约（$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs）

- 形态：dsh 官方插件形态——ESM 模块导出 `{ name: 'dsh-flow-comet-bridge', apply(ctx) }`，ctx 由 dsh 注入；纯 ESM 零第三方依赖；模块级幂等（同进程重复 apply 跳过已注册监听）。
- 职责链：`tools/pre-execute` 监听 → 会话项目判定 → 参数映射 → 包含性校验 → 子进程调项目本地 guard → 决策映射。
  1. **窄监听（硬性契约）**：工具名归一化（非 Write/Edit/Bash 直接 `next()`）；会话 cwd（`exec.agent.session.header.cwd` 锚定，缺失回退）的最近 `.git` 项目根下**存在 `.dsh/skills/flow-comet` 才处理**，否则直接 `next()`——非 flow-comet 项目零拦截零开销（D6/R7）。
  2. **参数映射（fail-closed）**：dsh 工具名归一化到 guard CLI 契约名（Write/Edit/Bash；别名：write/writefile/file-write、edit/editfile/file-edit、bash/shell/powershell/run_command/run-command）；Write/Edit → `file_path`、Bash → `command`；形状不符/缺关键字段 → WARN + fail-closed deny（不静默放行）。
  3. **包含性校验**：Write/Edit 的 `file_path` 必须解析后位于项目根内——`realpathSync.native` 展开 Windows 8.3 短路径（词法 path.relative 会把项目内短路径误判为越界）；越界直接 deny（不进 guard——guard 侧 target=null 会跳过白名单判定 = fail-open）；通过后传规范化长路径。
  4. **判定调用**：`spawn node <项目根>/.dsh/skills/flow-comet/scripts/comet-hook-guard.mjs before_tool`，stdin JSON `{tool_name, tool_input}`；**spawn cwd 必须 = 会话项目根（硬性——相对 file_path 按 cwd 解析，cwd≠项目根 = fail-open；不得以设 env 替代 cwd）**；guard 文件缺失（安装未完成/被删除）→ WARN + `next()` 放行（不阻断非 flow-comet 语义）；spawn 异常 → fail-closed deny + WARN。
  5. **决策映射**：exit 0 → `next()` 放行；exit 2 → `{kind:'deny', reason}`（BLOCK 消息 + 恢复指引透传）；其它/异常 → fail-closed deny + WARN。
- 协议文件：天然在项目内（skill 包 `reference/` 随树复制）——受保护读取满足，**无 FLOW_COMET_PROTOCOL 机制**。
- 明确不做（D6——旧完整插件功能废弃）：不注册 `fs/write-intent` 槽位；不做 `fs/observed` 审计；不做技能注册/AGENTS.md 运行时注入（安装器职责）。

## 8. 验证记录模板

> 级 3 / 级 4 执行后按此模板回填；发布前逐项闭环（DESIGN 7.3）。

### 环境

- 日期：
- dsh 版本：
- prepare-env / 仓库版本：
- profile：
- 临时项目路径：

### 检查项（级 3 新形态命令——非旧插件冒烟形态）

| # | 检查 | 结果 | 证据（命令/输出摘要） |
|---|---|---|---|
| 1 | `prepare-env --platform dsh` 安装成功（skill 落 `.dsh/skills/flow-comet` + INSTALLED_VERSION + pathReplacements 生效） |  |  |
| 2 | 平台选择链：`--platform dsh` / `claude-code,dsh` / `all` / TTY 多选预勾选 / 未知平台报错 / `both` 已移除 |  |  |
| 3 | skill 可见断言：项目内 dsh 会话查询 `/flow-comet`（未安装项目不可见负向） |  |  |
| 4 | AGENTS.md 托管区注入 + 用户内容保留 + dsh 实际注入行为（R2 必测） |  |  |
| 5 | 桥接 loader 就位：`$DSH_HOME/plugins/` 文件 + `cordis.patch.yml` 托管块读-合并-写（dsh-skin 块保留断言） |  |  |
| 6 | 越权 Write deny（PreToolDecision `{kind:'deny', reason}`）+ BLOCK 消息 + 恢复指引 |  |  |
| 7 | 合法写放行 |  |  |
| 8 | 非 flow-comet 项目 `next()` 负向（窄监听零拦截） |  |  |
| 9 | 参数形状不符 → fail-closed deny + WARN |  |  |
| 10 | 8.3 短路径包含性（realpath 展开——迁移复测） |  |  |
| 11 | spawn cwd = 会话项目根（负向：cwd≠项目根不可接受） |  |  |
| 12 | 协议文件随 skill 树（无 FLOW_COMET_PROTOCOL 机制） |  |  |
| 13 | purge 恢复：skill 不可见 / AGENTS.md 托管区清除 / loader 卸载 / 用户内容保留 / dsh-skin 块保留 |  |  |
| 14 | 多项目切换：A 项目装 B 项目不装——A 拦截 B 放行 |  |  |
| 15 | 幂等重装：重复安装结果一致（托管区/托管块读-合并-写幂等） |  |  |

### 结论

- 通过 / 不通过：
- 失败项与修复记录：
- 遗留风险：
