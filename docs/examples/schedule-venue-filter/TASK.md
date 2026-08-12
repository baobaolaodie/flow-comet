# TASK: 赛事列表按场地筛选

- **Change ID**: test-schedule-venue-filter
- **关联**: `@.specs/test-schedule-venue-filter/REQUIREMENT.md`、`@.specs/test-schedule-venue-filter/DESIGN.md`

---

## 波次划分

```
Wave 1 (parallel): T01[P]（后端 API 过滤）, T02[P]（前端 API 层扩展）
Wave 2 (serial):   T03（depends on T01）, T04（depends on T02）
Wave 3 (serial):   T05（depends on T03, T04）
```

> 同 wave = 可并行；跨 wave = 必须顺序执行。T01/T02 无依赖可同时委托子代理；T03/T04 依赖各自上游；T05 收口回归。

---

## 任务清单

```xml
<task id="T01" parallel="true" status="done">
  <name>后端：列表接口 venue_id 过滤 + venue_names 计算字段</name>
  <read_files>
    app/api/v1/endpoints/tournaments.py
    app/crud/crud_tournament.py
    app/schemas/tournament.py
    app/services/tournament_service.py
    app/models/venue.py
  </read_files>
  <write_files>
    app/api/v1/endpoints/tournaments.py
    app/crud/crud_tournament.py
    app/schemas/tournament.py
    app/services/tournament_service.py
    tests/test_api_tournaments_venue_filter.py
  </write_files>
  <action>
    在 CRUDTournament.get_multi_with_filter（app/crud/crud_tournament.py:87）增加 venue_id: int | None = None 参数，过滤写法沿用 DESIGN D1：
    venue_subq = select(Venue.tournament_id).where(Venue.id == venue_id).distinct()
    filters.append(Tournament.id.in_(venue_subq))
    ——与既有 event_type 分支（crud_tournament.py:127-133）完全同构。
    在 TournamentResponse（app/schemas/tournament.py:109）追加 venue_names: list[str] = Field(default=[], description="关联场地名称列表")。
    在 set_tournament_list_counts（app/services/tournament_service.py）追加 venue_names 批量预取：一次 SELECT venues WHERE tournament_id IN (item ids) 后按 tournament_id 归组（DESIGN D2，防 N+1）。
    在 app/api/v1/endpoints/tournaments.py:35 list_tournaments 增加 venue_id: int | None = Query(None, ge=1) 参数，ES 分支 filters["venue_id"]=venue_id 透传（DESIGN 风险 R3），MySQL 分支传给 get_multi_with_filter。
    编写覆盖 AC-1/AC-3/AC-5 的 pytest（tests/test_api_tournaments_venue_filter.py）：筛选返回、AND 叠加、向后兼容。
  </action>
  <verify>
    cd pingpong-tournament && pytest tests/test_api_tournaments_venue_filter.py -q
  </verify>
  <done>
    AC-1 / AC-3 / AC-5 的后端断言通过
  </done>
  <depends_on></depends_on>
</task>

<task id="T02" parallel="true" status="done">
  <name>前端：API 层扩展（fetchAllVenues + venue_id 透传 + 类型）</name>
  <read_files>
    frontend/src/api/adminApi.ts
    frontend/src/api/tournaments.ts
    frontend/src/types/tournament.ts
    frontend/src/types/admin.ts
  </read_files>
  <write_files>
    frontend/src/api/adminApi.ts
    frontend/src/api/tournaments.ts
    frontend/src/types/tournament.ts
  </write_files>
  <action>
    在 adminApi.ts 新增 fetchAllVenues(): Promise&lt;{id:number;name:string}[]&gt;，请求 GET /tournaments/venues（DESIGN D3，透传 response.data.data）。
    扩展 fetchAdminTournaments 参数签名（adminApi.ts:113）：params 增加 venue_id?: number，params 对象在 venue_id !== undefined 时透传。
    扩展 fetchTournaments 的 TournamentQueryParams（tournaments.ts:4）：增加 venue_id?: number | null。
    Tournament 类型（frontend/src/types/tournament.ts）追加 venue_names?: string[]。
    编写 T02 相关纯函数/类型的 vitest 单测（可并入 AdminTournaments 单测，此处仅确保 API 层参数拼装正确）。
  </action>
  <verify>
    cd frontend && npx vitest run src/api/__tests__/adminApi.venue.test.ts
  </verify>
  <done>
    AC-4 后端接口 GET /tournaments/venues 可返回全量启用场地；AC-3 参数透传链路可用
  </done>
  <depends_on></depends_on>
</task>

<task id="T03" status="done">
  <name>后端：/tournaments/venues 全量启用场地下拉接口 + 集成测试</name>
  <read_files>
    app/api/v1/endpoints/tournaments.py
    app/crud/crud_venue.py
    app/models/venue.py
    tests/test_api_tournaments_venue_filter.py
  </read_files>
  <write_files>
    app/api/v1/endpoints/tournaments.py
    app/crud/crud_venue.py
    tests/test_api_tournaments_venue_filter.py
  </write_files>
  <action>
    在 tournaments.py router 上新增 GET /venues 子路由（挂在同一 router，路径前缀 /tournaments/venues）：
    函数签名带 _: CurrentAdmin = Depends(get_current_admin)（DESIGN 风险 R4 权限）。
    在 crud_venue.py 新增 get_active_venues_all（或复用现有 get_active_venues_by_tournament 的语义做全量）：SELECT id,name FROM venues WHERE is_active=1 ORDER BY name。
    补齐 AC-4 集成测试 test_list_all_active_venues（含停用场地被过滤断言）。
  </action>
  <verify>
    cd pingpong-tournament && pytest tests/test_api_tournaments_venue_filter.py::test_list_all_active_venues -q
  </verify>
  <done>
    AC-4 通过
  </done>
  <depends_on>T01</depends_on>
</task>

<task id="T04" status="done">
  <name>前端：赛事列表页场地筛选下拉 + 场地名称列 + 单测</name>
  <read_files>
    frontend/src/pages/admin/AdminTournaments.tsx
    frontend/src/api/adminApi.ts
    frontend/src/pages/admin/__tests__/AdminTournaments.test.tsx
  </read_files>
  <write_files>
    frontend/src/pages/admin/AdminTournaments.tsx
    frontend/src/pages/admin/__tests__/AdminTournaments.test.tsx
  </write_files>
  <action>
    AdminTournaments.tsx 新增 venueFilter state 与 venueOptions state（mount 时 fetchAllVenues 缓存，DESIGN D3）。
    在既有筛选栏（statusFilter Select 同排）新增"场地"Select：value=venueFilter，onChange 重置 page=1 并 loadList。
    loadList（AdminTournaments.tsx:74）透传 venue_id: venueFilter || undefined 给 fetchAdminTournaments。
    表格新增"场地"列：render venue_names?.length ? venue_names.join("、") : "—"（AC-2，DESIGN D4）。
    单测补：render venue column（有/无场地两种）、change venue filter 触发带 venue_id 的 fetch（AC-2/AC-3）。
  </action>
  <verify>
    cd frontend && npx vitest run src/pages/admin/__tests__/AdminTournaments.test.tsx
  </verify>
  <done>
    AC-2 通过（前端单测）；UAT-1 可操作
  </done>
  <depends_on>T02</depends_on>
</task>

<task id="T05" status="done">
  <name>收口：全量回归 + 契约核对 + 文档</name>
  <read_files>
    pingpong-tournament/tests/
    frontend/src/pages/admin/AdminTournaments.tsx
    frontend/src/api/adminApi.ts
    docs/CHANGELOG.md
    docs/known_issues.md
  </read_files>
  <write_files>
    docs/CHANGELOG.md
    docs/known_issues.md
    tests/test_api_tournaments_venue_filter.py
    frontend/src/pages/admin/__tests__/AdminTournaments.test.tsx
  </write_files>
  <action>
    全量回归：cd pingpong-tournament && pytest tests/ -q 与 cd frontend && npx vitest run src。
    契约核对：node .claude/skills/flow-comet/scripts/contract-check.mjs venue_names --project .（核对前后端 venue_names 字段一致）。
    更新 docs/CHANGELOG.md（追加 feat 条目）与 docs/known_issues.md（记录 venues 1:1 技术债，见 CONTEXT）。
    若全量回归发现既有测试被 venue_id 新参数破坏，修复或显式接受并记录。
  </action>
  <verify>
    cd pingpong-tournament && pytest tests/ -q &amp;&amp; cd frontend &amp;&amp; npx vitest run src
  </verify>
  <done>
    后端全量 + 前端全量通过；CHANGELOG/known_issues 已更新
  </done>
  <depends_on>T03,T04</depends_on>
</task>
```

> **注意**：`read_files` 和 `write_files` 是 R7.3 强约束。`write_files` 必须**严格在 DESIGN `## 0.5.1` 「触碰模块 + 新增模块」范围内**，且**不能包含「禁动清单」**。否则 4-dev 步骤 5 提交前 verify 会 fail。

---

## 状态字段说明

- `status="pending"` — 未开始
- `status="in_progress"` — 进行中（同时只允许一个非 [P] 任务为此状态）
- `status="done"` — 已完成（verify 通过）
- `status="blocked"` — 阻塞（必须在文件末尾「阻塞日志」记录）

---

## 阻塞日志

| 任务 | 阻塞原因 | 待人工决策项 | 时间 |
|---|---|---|---|
|  |  |  |  |

---

## Fix 任务（来自 REVIEW / INTEGRATION）

> 此区域由 review/integration 阶段自动追加，编号 `T-FIX-XX`。

```xml
<!-- 占位 -->
```
