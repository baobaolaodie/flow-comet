# 故障排查

对号入座找症状，然后执行给出的命令。以下都假定你在安装过的项目内。

## 症状

### 安装

**`fcomet: command not found`** —— CLI 不在 PATH 上。重跑 `npm install -g flow-comet`，确认 `npm prefix -g` 在 PATH 中；`node --version` 必须 ≥ 18。

**命令打印用法并非零退出** —— 那正是无参数行为：不带任何参数时安装器只打印用法。补上意图即可：`fcomet init`，或 `fcomet --target <dir>`，或 `--platform <名字>`。

**装错了平台** —— 显式指定重跑：`fcomet init --platform claude-code`、`--platform codex`、`--platform dsh`，或逗号组合 / `all`。重跑是幂等的，且不会删除托管技能目录之外的既有内容；目录内的清理按位置判定——请勿在其中存放自有文件。

**`.gitignore` 没被更新** —— 确认是在项目里跑的（不是在 flow-comet 仓库自身内——那里 `.flow-comet/` 必须保持被跟踪）。托管条目是追加的，不会替换既有行。

### 首次运行

**Claude Code 从不拦截越界写入** —— hook 要通过宿主能找到的 shell 执行。Windows 上需把 Git Bash 的位置告知平台后重试；无头会话还需预先接受工作区信任。

**Codex 什么都不拦** —— 项目 hook 仅在信任被接受后（交互式 `/hooks`）执行，或由脚本化运行传入 `--dangerously-bypass-hook-trust`。两者都没有时，hook 根本不会执行。

**dsh：写入未被拦截** —— 在项目里跑只读自检：`node .dsh/skills/flow-comet/scripts/workflow-state.mjs bridge-check`，它会报告 loader 是否存在、`$DSH_HOME` 托管块是否挂载、是否只注册一次、loader 版本戳与项目标识是否一致。重跑 `fcomet init --platform dsh` 会同时重写 loader 与托管块。

### 节点卡住

**`BLOCKED: … 未执行 entry 直接 exit`** —— 每个节点都要先进入：先跑 `workflow-guard.mjs entry <node> --apply`。

**`BLOCKED: … 缺少技能加载声明标记`** —— 加载该节点技能并声明：`workflow-state.mjs skill-load <node> <skill>`，然后重做 `record` 与出口。

**`BLOCKED: … skill-load 声明 --prompt 与节点协议文件不符`** —— 该节点已写下的某条声明指向了节点协议面之外的路径。用报文给出的路径（`flow-kit/prompts/<file>`）重跑 `skill-load`；校验发生在下一次入口，所以重跑声明即可，不要手改标记。

**`BLOCKED: … 的模板声明与节点映射不一致`** —— `--templates` 清单与该节点的模板不一致。报文会点名漏写或多写/错名的项，并给出可直接照抄的重新声明命令：`open` 写 `CHANGE.md,REQUIREMENT.md`，`design` 写 `DESIGN.md`（前端 change 再加 `UI-DESIGN.md`），`plan` 写 `TASK.md`，`execute` / `subagent-execute` 写 `SUMMARY.md`，`review` 写 `REVIEW.md,TEST.md`；`verify` 与 `archive` 没有模板，省略该参数。

**`BLOCKED: … exit 缺协议声明标记`** —— 本节点已写下的标记没有覆盖它的全部必需项。报文会逐条列出读不到声明的协议文件、以及缺标记的必需技能（并给出该技能本该写出的标记文件），并为每个缺项给出可照抄的声明命令：每条命令带上该节点的**全部**协议文件与该节点的模板清单，且**每个 guarded 必需技能各一条**（一条命令只写一个技能标记），例如 `open` 要给两条——`workflow-state.mjs skill-load open flow-comet-change --prompt flow-kit/prompts/0-change.md --prompt flow-kit/prompts/1-requirement.md --templates CHANGE.md,REQUIREMENT.md` 与 `workflow-state.mjs skill-load open flow-comet-requirement --prompt flow-kit/prompts/0-change.md --prompt flow-kit/prompts/1-requirement.md --templates CHANGE.md,REQUIREMENT.md`——一条命令可以带多个 `--prompt`，同名节点与技能重跑会覆写那份标记，而 `--templates` 清单正是 `skill-load` 接下来要核对的东西；两条都跑完再重试出口，只跑一条会在同一次出口上被覆盖门点名缺另一个技能。标记目录整体不存在时，按「一项都没声明」拦下并逐项点名（与「目录在但没覆盖」同一报文形态）。

**`record` 拒绝证据载荷并点名字段与类型** —— 载荷在写入前先校验形状：`summary` 必须是非空字符串，`completedChecks` 必须是字符串数组，`lessonsNomination` 必须是对象且其 `nominated` 是字符串数组、`reasonIfNone` 是字符串。报文的每一行形如 `字段路径: 必须是什么（当前是什么类型）`，例如 `completedChecks[0]: 必须是字符串（当前是 object）`；状态保持原样不被改写，把载荷改对即可重试。引号被 shell 吞掉时，把同一份 JSON 写进文件用 `--json-file <路径>` 传入；在 `cmd.exe` 里用双引号包住载荷，并转义载荷内原有的双引号。

**`BLOCKED: … 模板结构校验失败`** —— 工件的标题形态、首部字段、段集合或段序、空正文、照抄模板占位符里有一项不合模板。报文分两阶段：**首次只给模板路径与类别计数**（例如「缺段 3 项」），对照 `flow-kit/templates/<DOC>.md` 补齐；**同一工件再次失败时才列段名**——这份记账在 `.specs/<change>/.template-hints.json`，工件通过后自动清除。条件段保留标题、正文写 `N/A` 即可；父段整段 `N/A` 时其结构子段不要求；模板之外自加的段不参与校验。

**出口打印「未校验（模板缺失）」** —— 项目根没有 `flow-kit/templates/<DOC>.md`，这份工件的模板派生段形判据整体跳过——**未校验不等于通过**。按安装页的指引取回 flow-kit 模板后重试；若同一行说的是登记表缺失，那是技能包缺 `reference/artifact-templates.json`，重装技能包即可。`UAT.md` 与归档的遗留清单没有上游模板，永远不进这条校验：只要求存在性。

**`TEMPLATE-FINGERPRINT WARN`** —— 登记表锁定的上游提交与 `flow-kit/` 下的检出不一致。它是提示，不是阻断：骨架仍按登记表快照校验。把 `flow-kit/` 检出到登记表点名的提交，或把 `templateCommit` 与每份模板的 sha256 一起更新——quality 作业会比对两侧，只改一半会被判红。

**`TEMPLATE-REGISTRY WARN`** —— 登记表登记了某个段，而它的模板里已经没有这个段。段集合由模板决定，因此该段按忽略处理、运行继续；告警会一直在，直到登记表被订正——在删掉该段的那次改动里更新 `reference/artifact-templates.json`。

**`BLOCKED: … TASK.md 任务集被修改（签名不匹配）`** —— 进入执行节点后任务集被改动。恢复任务清单后重新进入节点（或把新工作作为任务在进入前加好），不要在流程中途改任务。

**`BLOCKED: TASK.md 波次划分与依赖层级不一致`** —— 波次段与依赖层级不一致。明细逐行点名一个任务、它的依赖、它声明的波次与它应到的波次；Wave 行一次都没提到的任务按「未声明」列出。出路是把它移到应到的波次，或补上「它为何排在后面」的那条依赖——没有「当前波」可挪的任务，只能把它写进对应波次的 Wave 行。若报文说的是段本身读不出来（`BLOCKED: TASK.md 波次划分段内容不可判`），那是段内没有一行能落到真实任务：按 `Wave 1: T01, T02` 的形态写，任务 id 与任务块逐字一致——段正文写 `N/A` 不构成波次声明。完全没有波次段时，波次判据打印「未校验（无波次段）」——它没有可读对象，因此不据此阻断；但该段是模板段，缺段仍由 TASK 段形门判定，这道门在 plan 出口与 `replan` 重签时都会跑——缺段即拒绝——所以删段换不到放行。

**`BLOCKED: TASK.md 同波任务可并行却未标 [P]`** —— 两个任务同处一波，彼此没有依赖路径（直接或间接都没有），写面也不重叠，但其中至少一个没标并行。两条出路任选：两个都标 `parallel="true"`、并在 Wave 行补 `[P]`，让它们真的同波并行；或补一条 `depends_on` 把它们排到不同波次，让顺序显式。只标一个不起作用——路由读的是任务块，不是 Wave 行。修复任务不参与这条成对判据。

**`BLOCKED: done 任务 … 缺少 <id>-SUMMARY.md`** —— 每个完成任务都要有摘要文档且含模板各段。补写它，或把该任务回退为未完成。

**`BLOCKED: … 任务被主代理直接标记 done（越俎代庖）`** —— 默认执行模式下协调会话不得亲自完成任务。请委托，或用 `workflow-state.mjs record execute '{"parallelTakeoverApproved":true}'` 显式声明接管。

**`verify` 超时或命令非零退出** —— 出口会执行 `TEST.md` 的命令块。先自己跑那条命令看输出；确实需要更长时间的套件，可用文档化的 `FLOW_COMET_VERIFY_TIMEOUT_MS` 环境变量放宽预算。

**`BLOCKED: TEST.md 的 1.1 测试矩阵缺 AC 覆盖`** —— 矩阵里没有报文所列准则的对应行。在 1.1 测试矩阵里每条准则补一行（`| AC-N | 类型 | 用例文件 / UAT | 状态 |`）后重试出口；review 出口会把同一份清单打成一行汇总且不阻断，那里只是预览，不是裁决。若报文说的是判据无法执行（`BLOCKED: AC 覆盖判据无法执行`），那是**承载段或段内清单读不出来**：验收准则段被删掉、准则没有 `AC-N` 编号、第 1 轮段缺席、或第 1 轮段里没有 1.1 矩阵（整段 `N/A` 就是这一形态）——按模板把段与矩阵补回来，删段不是跳过判据的写法。只有**模板缺席**（段名无从派生）才报「未校验」、不改退出码；**change 自己的 `REQUIREMENT.md` / `TEST.md` 缺席属内容不可判**——这两个文件是这个 change 自己的东西，删掉它换不到放行，与承载段被删掉同一侧：出口被拒绝。围栏代码块里的示例行不算覆盖（矩阵段跨过围栏读段界，示例仍是示例），验收段围栏里的编号也只是写法样例、不构成声明。

**`BLOCKED: missing Output Schema artifacts`** —— 归档出口要求 change 目录已在归档里、且带上它的遗留清单。顺序是声明、记录、再搬移：搬移之后才补的声明会写进归档目录，记录也对得上搬移后的产物，所以搬家之后漏掉的一步仍可补。把目录移入 `.specs/archive/<YYYY-MM-DD>-<change-id>/`，并确保其内存在 `KNOWN-ISSUES.md`（无遗留也要显式写明）——出口只读带日期的目录名。

**`BLOCKED: 归档目录名不合规`** —— 归档区里有目录带了本 change 的 id 却没有日期前缀，因此运行命令不把它读作本 change 的目录。报文会逐个点出这些目录，并给出一条把它改成 `<YYYY-MM-DD>-<change-id>` 的 `mv` 命令：照抄执行后重试出口。引擎不替你改目录名，也不猜。

**`BLOCKED: change 目录缺失`** —— 状态仍把某个 change 记为在办，但 `.specs/<change-id>/` 与 `.specs/archive/` 下带日期的同名目录都不存在，产物既读不到也无处可写。把目录移回 `.specs/<change-id>/`，或按 `<YYYY-MM-DD>-<change-id>` 的名字放进 `.specs/archive/`，再重试：这里引擎选择拒绝，而不是报「没有 change」。若同一条命令改报「归档目录多候选」，说明同名归档有多份且日期判不出唯一一份——保留一份后重试；只有没有任何两份同日时，最新日期才胜出。

**`BLOCKED: SUMMARY 使用 builtin-quickcheck 未声明…`** —— 声明走内置快查时，必须同时写明审查引擎为什么不可用、以及替读了什么——点名插件缓存、缓存协议文件或它们的路径。缺任一半都会拒绝出口。

**`BLOCKED: SUMMARY 的 6 维自查未声明使用 /brooks-review`** —— 该声明在**自查段内**按字面匹配：写成 `# Brooks-Lint Review` 这样的标题不会被读成方法名，且只在自检方法段写理由不满足这项校验。请在自查段本身写出 `brooks-review`（或 `cache-brooks`）。

**出口说 SUMMARY 缺结构子段，可该段正文明明写了 N/A** —— 不适用标记必须出现在正文开头。把正文改成以 `N/A` 开头（后面可以跟一句理由），不要在前面加说明文字，也不要把标记包在句子里；粗体、引用、列表、括号与反引号包裹的标记都认可。报文还会指出误挂的子段实际挂在哪个父段下，并说明真正不适用时该怎么写。

**`next` 一直指着我刚干完活的那个节点** —— 已进入、但还没退出的节点仍占着路由。先 `record` 再 `exit <节点>`；`status` 的 `ROUTE` 行与 `next` 的 `WHY` 行会说明它为什么停在那里。想知道某个任务的 SUMMARY 还差什么，就运行结构预检 `exit <节点> --preflight`：它只读、只查文档结构，既不写状态也不写提示账本，所以缺 H2 段只报计数；结构子段与「该挂在哪个父段下」的写法建议会点名到具体段。要看被计数的那些段名，请等节点收尾的完整 `exit`（它维护那份账本），或直接按模板逐段对照。

**`BLOCKED: 在途 change … 尚未完成`** —— 另一个 change 还没结束，`init` 不会顺手覆盖它的状态。先把它做完（报文会打印 `status` 命令看进度），或把被替换的那个显式点名：`workflow-state.mjs init <新change> --replace <旧change> --reason <原因>`。原因必填并且会写进留档；覆盖之前，旧状态先被逐字节快照到该 change 的 `recovery/` 目录，报文会打印快照、记录与回滚命令。

### 平台

**移动项目后 Codex hook 失效** —— Codex hook 记录的是安装时的绝对路径。在新位置重跑 `fcomet init --platform codex`。

**dsh 报版本偏斜** —— loader 版本戳与项目标识不一致。重跑 `fcomet init --platform dsh`（两者都会被重写），再用 `bridge-check` 复查。从 clone 安装时一侧带开发态后缀属正常。

**写入被拒，但不知道是哪条判据** —— 拒绝消息会点名判据。`不在当前节点 ... 允许范围` 表示目标不在当前节点的白名单内：用 `status` 确认节点，再对照消息里列出的允许范围。`不在项目根 ... 内` 表示解析后的目标在项目之外。`最小保护集` 指状态文件与协议文件——状态文件任何流程状态（含空闲）都不放行；协议文件在流程运行中、以及子代理通道上同样不放行。`workdir` 与 `script_path` 是仅针对协调者的两条运行态拒绝：结束或归档流程、把写入放在项目内，或把工作交给子代理（它是执行者，不受这两条约束）。

**dsh 上空闲项目里写状态文件没有被拦** —— dsh 桥接对空闲项目（无 state、无 activeChange，或已完成）直接跳过守卫，让空闲工作在零拦截开销下进行。Claude Code 与 Codex 在任何状态都拒绝写状态文件（这是空闲态唯一保留的一条）；dsh 上这条只在流程运行中生效。协议文件、链接拒绝与写入白名单在三个平台上都只在流程运行中判定。这是已知的平台差异，不是配置项。

**重跑安装器后 dsh 的写入行为没变** —— 桥接是 `$DSH_HOME/plugins/` 下的全局插件，宿主只在启动时加载一次。请完全退出 dsh 宿主再启动；在会话内热重载不够。桥接是共享的，但它调用的守卫是**每个项目各自一份**：要更新的每个项目都要重跑 `fcomet init --platform dsh`，否则该项目仍用旧守卫判定。

### 升级与重置

**`npm install -g flow-comet` 之后项目还是旧版本** —— 升级全局包只换 CLI。在该项目重跑 `fcomet init`；它会覆盖生成文件且是幂等的。

**我想重来** —— `fcomet init --purge --yes --platform <平台>` 会删除该平台的生成物并重建。它是删除并重建，**不是卸载**：Claude Code 会移除整个 `.claude/`（自定义内容请另置），Codex 只移除 flow-comet 技能与托管条目，`flow-kit/` 永不被删。删除清单会在动手前打印；`--yes` 是第二次确认。
