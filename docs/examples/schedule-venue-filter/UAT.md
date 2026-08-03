# UAT: 赛事列表按场地筛选

- **Change ID**: test-schedule-venue-filter
- **验证时间**: 2026-08-04 11:00 ~ 11:15
- **执行人**: 管理员
- **环境**: 本地全栈（uvicorn :8000 + vite :5173），seed 管理员 13800000000

---

## AC-1 · 按场地过滤赛事

- **前置**: 启用场地 v1="市体育馆"（归属赛事 A）、v2="工人文化宫"（归属赛事 B）
- **验证方式**: `pytest tests/test_api_tournaments_venue_filter.py::test_list_tournaments_filter_by_venue_id -q`
- **结果**: 通过（`GET /tournaments?venue_id=1` 仅返回赛事 A，total=1，venue_names=["市体育馆"]）
- **补充**: 手动 curl 验证 `venue_id=2` 返回赛事 B，`venue_id=99999`（不存在）返回空 items / total=0

## AC-2 · 场地名称展示在列表项中

- **前置**: 赛事 A 关联启用场地 v1
- **验证方式**: `AdminTournaments.test.tsx` 两个渲染用例 + UAT-1
- **结果**: 通过（列表行"场地"列显示"市体育馆"；未关联场地显示"—"）

## AC-3 · 筛选与既有筛选叠加不冲突

- **前置**: 赛事 A status=5、赛事 B status=6
- **验证方式**: `test_list_tournaments_venue_and_status_and_keyword` + `AdminTournaments.test.tsx` AND 组合 + UAT-2
- **结果**: 通过（venue_id + status + keyword 三条件 AND 语义，keyword 走 ES 命中集合 + DB 侧二次过滤路径正确）

## AC-4 · 全量场地下拉数据接口

- **前置**: 启用场地 v1、v2 与停用场地 v3
- **验证方式**: `test_list_all_active_venues` + UAT-3
- **结果**: 通过（返回 `[{id:1,name:"市体育馆"},{id:2,name:"工人文化宫"}]`，不含 v3，按 name 排序；未授权请求返回 401）

## AC-5 · 响应向后兼容

- **前置**: 客户端 A 使用旧版参数
- **验证方式**: `test_tournament_list_backward_compatible` + `contract-check.mjs venue_names`
- **结果**: 通过（旧参数响应结构完全一致，`venue_names` 为新增可选数组字段，旧字段未删改）

---

## 结论

| 项 | 值 |
|---|---|
| 通过 AC | 5 / 5 |
| 失败 AC | 0 |
| 遗留问题 | 0（R3 知识重复为 REVIEW 阶段已知接受的 Major，非功能缺陷） |
| 验收判定 | **通过** |

> 本次 UAT 无失败轮次，verify-fail 计数 0。
