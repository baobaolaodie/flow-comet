# flow-comet 系统测试矩阵（TEST-MATRIX）

> 定位：系统测试集（`system-test.mjs`）的设计文档——说明测试覆盖的机制面、测试载体与判定规则。
> 运行：`node .comet/bundle-drafts/flow-comet/skills/flow-comet/scripts/system-test.mjs`（权威源直接跑；安装副本路径同理）。

## 一、测试载体说明

- **载体**：每个测试项 = 一个独立临时目录（`fs.mkdtemp`）+ 内置协议副本复制到 `<tmp>/reference/`（受保护路径要求协议文件位于 runRoot 内）+ **真实命令序列**（`init → record → guard entry/exit → handoff → hook` 的 `spawnSync` 调用）+ 断言退出码与输出关键词；测试项跑完 `rmSync` 清理。
- **与引擎回归的关系**：`guard-self-test.mjs` 是引擎脚本的单元/场景级回归（fixture 构造为主，114 场景）；本系统测试集是**系统级**——每个测试项走真实命令链路，验证机制在真实调用序列下生效（行为锚定归场景回归，集成正确性归系统测试）。
- **运行环境**：仅 node 内置模块（child_process/fs/os/path），无网络、无第三方依赖。
- **输出纪律**：逐项 PASS/FAIL + 汇总（`SYSTEM TEST: N/M passed`）；全过 exit 0，有 FAIL exit 1。测试项命名为公开面——零过程代号。

## 二、判定规则

- **全部 PASS = 级 2（系统测试集）完整通过**：与级 1 引擎回归（guard-self-test 全绿）构成统一测试集两级基线，方可进入下一级验证（CLI 冒烟）。
- **任一 FAIL**：修复后重跑（修复只改权威源一处，重跑至全绿）。
- **误通过 = 测试无效，必须修**：该拦截未拦截 / 该放行未放行，说明测试自身没守住机制边界——测试先于功能守边界，不许自欺（"当时能过"不等于"现在正确"）。

## 三、机制面覆盖矩阵（A~K 十一类）

### A. 状态机与路由

覆盖：init 全分支（状态写入/工件目录/同 id 重跑防护/分支模式）、status 节点推导与无活跃兜底、next 推进与状态漂移校正、next 未出口节点严格拦截、select 切换、advance 推进、record 基础证据、execution-mode 切换与记录、config 设置与非法值拒绝。

测试项（11）：A1 init 状态写入与工件目录创建 / A2 init 分支模式与非法前缀拒绝 / A3 init 同 id 重跑防护 / A4 status 节点推导与无活跃兜底 / A5 next 推进与状态漂移校正 / A6 next 未出口节点严格拦截 / A7 select 切换与缺失拒绝 / A8 advance 节点推进 / A9 record 基础证据记录 / A10 execution-mode 切换与记录 / A11 config 配置与非法值拒绝。

### B. 声明机制

覆盖：skill-load 声明标记写入（协议归属）、非法参数拒绝不落标记、record 缺声明标记拦截、声明后记录通过、声明时间序自洽、损坏声明标记 fail-closed、委托范围条目豁免（有委托通过/无委托拦截）、exit 协议声明标记校验（真实链路通过/无标记·空协议·损坏拦截）、旧项目兼容（未激活声明机制照常通过）。

测试项（9）：B1 声明标记写入 / B2 非法参数拒绝 / B3 缺声明标记拦截 / B4 声明后记录通过 / B5 声明时间序自洽 / B6 损坏标记 fail-closed / B7 委托范围条目豁免 / B8 exit 协议声明标记校验 / B9 旧项目兼容。

### C. 委托链路

覆盖：handoff 请求/结果/状态全链路（含提交校验）、红绿证据时间序（先红后绿通过/补录拦截）、委托后 exit 证据键名契约与契约校验（通过/空交接拦截）。

测试项（3）：C1 handoff 全链路 / C2 红绿证据时间序 / C3 委托后 exit 契约校验。

### D. hook 写白名单

覆盖：open 阶段工件放行与源码拦截、execute 按执行模式收窄（subagent 只写 .specs/，direct 放宽）、归档阶段白名单与完成态放行。

测试项（3）：D1 open 阶段白名单 / D2 execute 执行模式收窄 / D3 归档阶段白名单与完成态放行。

### E. 自定义协议

覆盖：自定义协议加载路由与节点推导（`--protocol`/env 加载）、自定义节点声明机制与出口全链路（含技能绑定）、内置特化校验对自定义协议不误触发。

测试项（2）：E1 加载路由与节点推导 / E2 声明机制与出口全链路。

### F. 自动初始化

覆盖：上下文缺失提示且不自动生成、跳过记忆、新鲜上下文静默、生成协作全链路（7 段校验 + 扫描时间记录）。

测试项（4）：F1 上下文缺失提示 / F2 跳过记忆 / F3 新鲜上下文静默 / F4 生成协作全链路。

### G. 分支模式

覆盖：init 建分支与一致性、归档入口分支校验、分支一致性失配警告。

测试项（3）：G1 init 建分支与一致性 / G2 归档入口分支校验 / G3 一致性失配警告。

### H. verify 与归档

覆盖：验证命令真实执行与超时配置、归档完整流程（遗留清单 + 目录移动 + 完成态）、归档路径声明标记查找（先移目录后 exit 顺序下标记只存归档路径）。

测试项（3）：H1 验证命令真实执行与超时 / H2 归档完整流程 / H3 归档路径声明标记查找。

### I. 异常路径

覆盖：损坏状态文件 fail-closed、缺工件出口拦截、非法参数拒绝、状态字段类型非法拦截。

测试项（4）：I1 损坏状态文件 fail-closed / I2 缺工件出口拦截 / I3 非法参数拒绝 / I4 状态字段类型非法拦截。

### J. 文档一致性

覆盖：双语健康检查（英文文档零中文/中文文档零英文长句/双语镜像对称/版本场景数）、公开产物零代号检查（调用仓库本地工具；安装副本无仓库文档跳过）。注：本地工具为发布快照——开发窗口期场景数一致性子检查按结构检查放行，权威判定在引擎自测。

测试项（2）：J1 双语健康检查 / J2 公开产物零代号检查。

### K. 安装器（版本标识 + 多平台）

覆盖：prepare-env 生成的版本标识（优先源仓库 git describe：发布版 = 精确 tag、开发态 = `<tag>-N-g<hash>`；无 git 时回退权威源随技能包分发的 INSTALLED_VERSION）精确反映源仓库状态；权威源文件与 CHANGELOG 首个版本段一致（CI release-consistency 同规则）；多平台安装（平台描述符驱动：claude-code 默认零变化 / codex——技能落 `.agents/skills/`、SKILL 命令路径平台化替换、`.codex/hooks.json`（顶层 hooks 包裹层 + matcher `*`）注入、`config.toml [features] hooks` 启用、AGENTS.md 托管区、纯 codex 不生成 `.claude/`）；hook 平台分支输出契约（codex = `{"decision":"block"}` deny 通道 + Bash 命令写入检测（PowerShell cmdlet / .NET File API / 重定向）、放行 `{}`；claude-code 文本输出不变）；平台选择链（`--platform` 显式 / TTY 交互 / 无 TTY 探测 `.codex/`·`.claude/` / 默认 claude-code）；purge 语义（缺 `--yes` 拒绝 / 重建 / 用户内容保留）。

测试项（5）：K1 安装器版本标识 / K2 codex 平台安装冒烟（技能/路径替换/hooks.json/AGENTS 托管区 + 非法 hooks.json fail-safe）/ K3 hook 平台分支 JSON 契约 + CC 分支不变 / K4 平台选择链（显式/无 TTY 探测/默认/未知平台拒绝）/ K5 purge 语义（缺 --yes 拒绝/重建/用户内容保留）。

## 四、附：design 节点 required 自指核验结论

**核验对象**：`workflow-protocol.json` 的 design 节点——`requiredSkillCalls` 含与 `implementation` 相同的技能（自指），对照 open / review 两模式核验（本批次遗留核验项）。

**三模式对照**：

| 节点 | implementation | requiredSkillCalls | 含自身? |
|---|---|---|---|
| open | flow-comet-open | flow-comet-change, flow-comet-requirement | 否 |
| design | flow-comet-design | flow-comet-design, flow-comet-ui-design | 是 |
| review | flow-comet-review | flow-comet-review, flow-comet-test | 是 |

**结论：设计如此，非缺陷。** 理由：

1. **协议承载型入口 vs 纯壳编排**：design 与 review 的入口技能即协议本体（flow-comet-design 承载 DESIGN 阶段协议，flow-comet-review 承载 REVIEW 阶段协议），其 `required` 列表 = 执行者必须加载并声明的协议技能集合，含自身是「入口即协议承载」的自然形态。open 是纯壳编排者（flow-comet-open 自身无协议文件，协议由 flow-comet-change / flow-comet-requirement 两个独立技能承载），故 required 不含自身——open 若含自身反而无法声明（没有对应协议文件可声明）。
2. **required 自条目是加载声明的载体**：执行者加载 flow-comet-design 后运行 `skill-load design flow-comet-design --prompt flow-kit/prompts/2-design.md` 写入声明标记——该标记同时满足记录校验（required-skill 条目须有对应标记）与节点 exit 的协议声明校验（design 节点要求 2-design.md 标记），两处复用同一文件，机械上自洽。
3. **review 同构佐证**：review 的 required（flow-comet-review + flow-comet-test）与其节点协议文件集（6-review.md + 5-test.md）一一对应——两个节点同构，是设计而非偶发。
4. **与 plan 节点修正不同类**：plan 节点那次修正的缺陷在 `implementation` 字段指向错误（指向协议技能而非节点入口技能），修正后确立「implementation = 节点入口、required = 需加载声明的协议技能」语义——design 的 implementation 指向正确，required 含自身不违反该语义。
5. **机械上无害**：required 条目在节点 exit 时自动补全，不产生额外拦截；删除反而破坏上述声明载体对应关系。

**边界**：若未来把 design 重构为「壳 + 独立协议技能」双层结构（同 open），required 自条目随结构自然去除；当前形态保持，无需修复。
