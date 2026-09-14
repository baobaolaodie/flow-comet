# dsh 平台锚定参考（dsh-platform）

> 维护者参考文档：dsh 平台适配的版本锚定、安装形态、API 签名、桥接 loader 契约与验证记录模板。
> 权威依据：`@.specs/deepseek-harness-platform/DESIGN.md`（D1~D10 / 7.1 / 7.2 / 7.3）、`@.specs/deepseek-harness-platform/REQUIREMENT.md`（AC-1~AC-7）、`@.specs/adr/ADR-005-dsh-install-via-installer.md`。
> dsh 为 dev-preview：本文件锚定认证版本（0.1.5-rc.1，2026-09-10 全接缝运行时认证；历史锚 0.1.0-rc.6 → 0.1.1-rc.2 实测线）；破坏性变更风险显式声明。

## 1. 版本锚定

| 项 | 值 |
|---|---|
| 认证 dsh 版本 | `0.1.5-rc.1`（2026-09-10 全接缝运行时认证；历史锚 `0.1.0-rc.6` → `0.1.1-rc.2` 实测线） |
| 安装入口 | `node scripts/prepare-env.mjs --target <项目> --platform dsh`（或交互终端多选勾选 dsh）——唯一入口（D1） |
| 重置/重新生成（purge——删除后重建到完整安装态，**不是卸载**） | `node scripts/prepare-env.mjs --target <项目> --purge --platform dsh --yes` |
| npm 包 | **自 `1.5.0-rc.3` 起已发布**（`npm i -g flow-comet` → `fcomet init`，dist-tag `latest`）——分发的为**安装器**，非 dsh 插件包；旧 npm 插件包安装形态已废弃（verify 阶段推翻，见 ADR-005） |
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

- `DSH_HOME` 解析（与 dsh CLI 同款默认，**两态**）：`$DSH_HOME` 环境变量 > `~/.dsh`。dsh-home-paths 库 API 支持显式配置参数（configured），但 dsh CLI 0.1.0-rc.6 实际无参调用（profile-boot 调 `resolveDshHome()` 不传 configured），该层不生效；prepare-env 安装器与 dsh CLI 行为一致（两态）。
- **`DSH_` 前缀 bootstrap-only**：项目 `.env` 中设置 `DSH_HOME` 被直接拒绝——`.env` 方案不可行，文档明确不推荐（ADR-005 源码实证）。
- `$DSH_HOME/cordis.patch.yml` 为 home 级 patch，对所有 profile 生效——dsh 加载链 `bundles → profile → home → overlays`（ADR-005 源码核实）。
- flow-comet 托管块：`# --- flow-comet managed ---` … `# --- end flow-comet managed ---`，内容为 **insert 形态**（无 id 顶层 `- insert:` 条目内嵌插件行——追加到条目列表，而非覆盖既有条目）：

```yaml
# --- flow-comet managed ---
- insert:
    - id: dsh-flow-comet-bridge
      name: 'file:///<loader 绝对路径>'
# --- end flow-comet managed ---
```

- **机制事实（为何必须 insert 形态）**：cordis.patch.yml 是 **id-targeted patch 层**——dsh-app-boot 的 `applyEntryPatches` 对 `{id, ...overrides}` 仅能覆盖已存在条目，id 不存在报 `entry not found` 跳过（旧 `- id: … + name:` patch 形态对不存在的 id 即跳过，loader 从不加载——拦截整链静默失效）；**新增插件必须用无 id 顶层 `- insert:` 条目**。读-合并-写保留既有块；文件存在但内容无法识别为 YAML → fail-safe 报错退出不覆盖。

## 5. fs/write-intent（single-slot 守卫瀑布）

```ts
(target: FsTarget, actor: object | undefined, next) => FsWriteIntent | undefined
```

- 决策形状：`{kind:'createIfAbsent'}` | `{kind:'replaceIfVersion', version}`——守卫，**无 deny 决策面**。
- single-slot：first-wins by registration order。
- **flow-comet 不注册该槽位**（避免 shadow 官方 `dsh-fs-observation-policy` 的 freshness 检查）；拦截能力由 `tools/pre-execute` 全覆盖（D6）。
- `fs/observed` 审计通道设计上不采用（v1 桥接 loader 极薄——D6；v2 可按需加）。

## 6. 安装 / 激活 / 重置（prepare-env 平台描述符——唯一入口）

### 安装

- 正式：`node scripts/prepare-env.mjs --target <项目> --platform dsh`。
- 多平台：`--platform claude-code,dsh`（逗号分隔，按参数顺序安装）/ `--platform all`（全部平台，按 PLATFORMS 表顺序：claude-code → codex → dsh）；旧 `both` 已移除——`--platform both` 报错并提示用逗号列表或 all；未知平台报错（含逗号列表中的未知项——不得部分安装）。
- 交互（缺省选择链）：显式 `--platform` > TTY 交互多选 > 探测 > 默认 claude-code。TTY 多选 = @clack/prompts 方向键多选（可选依赖，未安装自动回退 readline 数字/逗号多选），按目标项目痕迹 `.claude/`/`.codex/`/`.dsh/` 预勾选，回车默认 = 探测推荐；无 TTY 探测：仅 `.codex/` → codex、仅 `.dsh/` → dsh、含 `.claude/` → claude-code、皆无 → 默认 claude-code；多痕迹（≥2 并存）不武断二选一——默认主平台 claude-code 并输出提示。
- 安装动作（dsh 描述符）：
  1. `installHooks`：复制 `scripts/dsh-bridge.mjs` → `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs`（全局挂载——home patch 对所有 profile 生效）+ `$DSH_HOME/cordis.patch.yml` 托管块注入（读-合并-写，保留既有块；源文件缺失时 WARN 同时跳过 loader 复制与托管块注入（避免注入指向不存在文件的 file:// 引用），其余安装照常
  2. `installRules`：AGENTS.md 托管区注入（`<!-- Managed by flow-comet prepare-env -->` … `<!-- /Managed by flow-comet prepare-env -->` 包裹编排规则全文；非破坏合并，保留托管区外用户内容；codex/dsh 共用标记——任一平台的移除流程均可清理该区）。
  3. skills：复制权威源 `skills/flow-comet/**` → `<项目>/.dsh/skills/flow-comet/` + pathReplacements（包内命令路径 `.claude/skills/flow-comet/scripts/` → `.dsh/skills/flow-comet/scripts/`，仅 .md，幂等）+ INSTALLED_VERSION 版本标识。

### 激活（天然项目级）

- 目录物理存在即激活——dsh 启动自动发现 `/flow-comet`（rank 100，chokidar 热发现免重启）；未安装该目录的项目不可见（无痕迹判定、无 chicken-and-egg）。
- dsh 对项目 AGENTS.md 的注入行为**已认证**（0.1.5-rc.1 headless 会话：项目根 AGENTS.md 作为上下文注入，托管区内容被会话逐字引用——见下方认证记录）；**边界**：认证面向 headless profile，dsh-tui / web 运行时未验。

### 重置/重新生成（prepare-env --purge --yes——删除后重建，**不是卸载**）

- `node scripts/prepare-env.mjs --target <项目> --purge --platform dsh --yes`：**先删除生成物、随后重新生成**（与 claude-code/codex 平台同一 main 模式）：
  1. 删 `<项目>/.dsh/skills/` 下全部 `flow-comet*` 条目（非 flow-comet 条目保留）+ 空 `.dsh` 目录（有内容保留）。
  2. AGENTS.md 托管区移除（保留文件与用户内容）——重建流程随后重新注入新托管区（purge = 移除旧生成物后重建）。
  3. `$DSH_HOME/cordis.patch.yml` 托管块移除（保留 dsh-skin 等既有块；移除后文件为空 → 删除文件本身）+ `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs` 删除——重建流程随后重新挂载 loader。
- **重置 ≠ 卸载（安全面警示）**：purge 后 flow-comet **仍完整安装**——skill 重新生成、AGENTS.md 托管区重新注入、全局 loader 继续挂载（所有 profile 拦截恢复）。用户想「卸载」而执行 purge 会得到完整安装态，不是移除。
- **真实卸载需手动**（purge 不是卸载途径）：删 `<项目>/.dsh/skills/flow-comet*` + AGENTS.md 托管区（`<!-- Managed by flow-comet prepare-env -->` … `<!-- /Managed by flow-comet prepare-env -->`）+ `$DSH_HOME/cordis.patch.yml` 托管块 + `$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs`；AGENTS.md 与 cordis.patch.yml 的托管区/托管块之外的用户内容保留。
- 多项目语义：每项目独立安装 skill（未安装项目不可见）；loader 全局一份（按会话项目判定——与 claude-code 项目级 hook 等价）；同一 loader 服务多个 flow-comet 项目。

## 7. 桥接 loader 契约（$DSH_HOME/plugins/dsh-flow-comet-bridge.mjs）

- 形态：dsh 官方插件形态——ESM 模块导出 `{ name: 'dsh-flow-comet-bridge', apply(ctx) }`，ctx 由 dsh 注入；纯 ESM 零第三方依赖；模块级幂等（同进程重复 apply 跳过已注册监听）。
- 职责链：`tools/pre-execute` 监听 → 会话项目判定 → 参数映射 → 流程态门 → 包含性校验 → 子进程调项目本地 guard → 决策映射。
  1. **窄监听（硬性契约）**：工具名归一化（非 Write/Edit/Bash 直接 `next()`）；会话 cwd（`exec.agent.session.header.cwd` 锚定，缺失回退）的最近 `.git` 项目根下**存在 `.dsh/skills/flow-comet` 才处理**，否则直接 `next()`——非 flow-comet 项目零拦截零开销（D6/R7）。
  2. **参数映射（fail-closed）**：dsh 工具名归一化到 guard CLI 契约名（Write/Edit/Bash；别名：write/writefile/file-write、edit/editfile/file-edit、bash/shell/powershell/pwsh/run_command/run-command）；Write/Edit → `file_path`、Bash → `command`；形状不符/缺关键字段 → WARN + fail-closed deny（不静默放行）。
  3. **流程态门（B 方案——包含性仅运行中生效）**：读项目根 `.flow-comet/flow-comet-state.json`（UTF-8 BOM 容错；判定规则锚定 guard `comet-hook-guard.mjs` L1882-1895）：空闲（无 state / 无 `activeChange` / `status==='completed'`）→ 直接 `next()` 放行——跳过包含性校验与 guard 白名单（与 Claude Code / Codex 的 active-change 门语义对齐）；解析失败 / 未知 status → WARN + fail-closed deny（不视为空闲放行）；`activeChange` 存在且 `status==='running'` 或缺失（undefined）→ 继续下方包含性校验与 guard（现状不变）。
   - **空闲边界（refined）**：空闲 = 无 state / 无 activeChange / status==='completed' → 项目外写 next() 放行；解析失败 / 未知 status 保持 fail-closed deny（不视为空闲），与 Claude Code / Codex 的 guard 语义一致。
  4. **包含性校验**：Write/Edit 的 `file_path` 必须解析后位于项目根内——`realpathSync.native` 展开 Windows 8.3 短路径（词法 path.relative 会把项目内短路径误判为越界）；**运行中**越界直接 deny（不进 guard——guard 侧 target=null 会跳过白名单判定 = fail-open）；通过后传规范化长路径。
  5. **代理身份分派（B1——dsh 子代理=执行者）**：读 `exec.agent.session.header.delegationDepth`（`agentDepth(exec)` 纯函数）——**>0 = 子代理（执行者）→ 跳过 guard 白名单判定直接 `next()` 放行**（子代理写源码是执行者职责，对应 Claude Code worktree 子代理物理自由写；形状 fail-closed 与项目根包含性校验已在上方对子代理同样执行，不因身份放宽）；**0/缺失 = 协调者 → 走 guard 白名单判定**（协调者禁令物理拦截保留）。dsh 子代理系统在 dsh-base 自带（`tool-subagent`/`subagent-spawn-in-process` 等，headless/web/tui 全 profile 激活），`childSessionMeta` 写入 delegationDepth=parentDepth+1（dsh-subagent 源码锚定 rc.6）；不识别此字段会导致 subagent 执行模式下子代理写源码被 guard 白名单（execute → `.specs/`）误拦（B1，DOGFOOD-REPORT 实证）。级 3 实测（2026-08-18 UAT-7）：真实模型调 subagent → 子代理（delegationDepth:1）写 `scripts/` 放行、协调者（delegationDepth:0）写同路径被 deny 保留。
  6. **判定调用**：`spawn node <项目根>/.dsh/skills/flow-comet/scripts/comet-hook-guard.mjs before_tool`，stdin JSON `{tool_name, tool_input}`；**spawn cwd 必须 = 会话项目根的长形态规范化（硬性）**（相对 file_path 按 cwd 解析，cwd≠项目根 = fail-open；8.3 短形态项目根若原样传入、而 file_path 已归一化为长形态时，guard 词法 path.relative 得 target=null → 白名单跳过 = fail-open——桥接修复已关闭，系统测试 K11 断言锁定；不得以设 env 替代 cwd）；guard 文件缺失（安装未完成/被删除）→ WARN + `next()` 放行（不阻断非 flow-comet 语义）；spawn 异常 → fail-closed deny + WARN。
  7. **决策映射**：exit 0 → `next()` 放行；exit 2 → `{kind:'deny', reason}`（BLOCK 消息 + 恢复指引透传）；其它/异常 → fail-closed deny + WARN。
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
| 6 | 运行中越权 Write deny（PreToolDecision `{kind:'deny', reason}`）+ BLOCK 消息 + 恢复指引 |  |  |
| 7 | 合法写放行 |  |  |
| 8 | 非 flow-comet 项目 `next()` 负向（窄监听零拦截） |  |  |
| 9 | 参数形状不符 → fail-closed deny + WARN |  |  |
| 10 | 8.3 短路径包含性（realpath 展开——迁移复测） |  |  |
| 11 | spawn cwd = 会话项目根（负向：cwd≠项目根不可接受） |  |  |
| 12 | 协议文件随 skill 树（无 FLOW_COMET_PROTOCOL 机制） |  |  |
| 13 | purge 重置：删除后重新生成到完整安装态（skill 重新可见 / 托管区重新注入 / loader 重新挂载）/ 用户内容与 dsh-skin 块保留 |  |  |
| 14 | 多项目切换：A 项目装 B 项目不装——A 拦截 B 放行 |  |  |
| 15 | 幂等重装：重复安装结果一致（托管区/托管块读-合并-写幂等） |  |  |

### 结论

- 通过 / 不通过：
- 失败项与修复记录：
- 遗留风险：


### rc.8 三态冒烟（2026-08-20）

- 环境：dsh CLI 0.1.0-rc.8 / Harness 核心 rc.8 / dsh-tui 0.8.5
- 结果：运行中协调者项目外 Write → deny；运行中子代理项目内 Write → next()；空闲态（无 state）项目外 Write → next()；解析失败/未知 status → fail-closed deny（system-test 61/61 ALL PASSED，K11/K12 断言覆盖）
- 载体：prepare-env --platform dsh 经临时项目重推真实 ~/.dsh 桥接 loader，loader 与权威源 SHA-256 一致；真实交互式 TUI/Web 冒烟留待开放项

### 0.1.5-rc.1 全接缝认证（2026-09-10）

- 环境：dsh CLI 0.1.5-rc.1 / Node v24.14.1 / dsh-tui 0.10.0；headless profile；真实 `~/.dsh`（loader 与权威源逐字节一致）
- 方式：真实 headless 会话逐接缝运行时检测——每场景独立运行，证据取会话日志（`session.v3.jsonl` 解压）与文件系统双重判定；配套无 skill 目录负向载体
- 结果（全部通过）：
  - 运行中协调者写项目内白名单外 Write → deny（桥接消息 + guard 的 `BLOCKED: phase ... 允许范围: .specs/` 详情透传）；写白名单内 → 放行
  - 空闲态（无 state）项目内 Write → 放行；state 解析失败 → fail-closed deny（不视为空闲）
  - 真实子代理（child session header `delegationDepth: 1`、`origin: subagent`）写源码 → 放行；子代理越界写 → 桥接包含性 deny（bridge 消息而非 sandbox 消息——证明子代理判定全程经过桥接，非未触发）
  - `pwsh` 命令级写入 → deny（命令写入检测：`命令写入 ... 不在当前节点允许范围`）
  - 窄监听负向（运行态 state 但无 `.dsh/skills/flow-comet` 的项目）→ 零拦截；项目级 skill 发现正常（flow-comet 全系可见）
  - AGENTS.md 注入实证：dsh 将项目根 AGENTS.md 作为上下文注入（`Instructions from: AGENTS.md`），托管区内容被会话逐字引用
- 安装链：bridge-check 四项全绿（loader 存在 / 托管块 insert 形态 / `file://` 目标可达 / 无重复注册）
- 边界：认证面向 headless profile（自动化通道）；dsh-tui / web 为静态证据（组合树含桥接行），交互式运行时留待日常使用或手动步骤清单；`str_replace_editor` 自 0.1.5-alpha.2 起为 opt-in（默认不挂载）
- 结论：桥接与 workflow-kernel 均无需修改（完整认证记录见维护者归档）
