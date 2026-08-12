# CHANGE: 赛事列表按场地筛选

- **Change ID**: test-schedule-venue-filter
- **创建日期**: 2026-08-04
- **路径建议**: 完整
- **状态**: active

---

## Why（为什么做）

管理端 `AdminTournaments.tsx` 的赛事列表页目前只支持状态筛选和关键词搜索，没有场地维度。运营场景：线下多赛事并行筹办时，同一批管理员往往要按"在哪个场馆办"来核对赛事清单。现状是管理员只能逐条点进 `AdminTournamentDetail` 或依赖赛程管理页（`AdminSchedules.tsx` 的"场地管理"）才知道某赛事挂在哪个场地，列表页无法按场地收敛，核对成本随赛事数量线性增长。用户（管理员）反馈：场地数量超过 8 个后，列表页找"某某球馆办的赛事"要翻 3~4 页。

## What（做什么）

给赛事列表接口 `GET /tournaments`（`app/api/v1/endpoints/tournaments.py:35`）新增可选 `venue_id` 查询参数，后端按"赛事包含该场地"（`venues.tournament_id = tournaments.id` 的 IN 子查询）过滤；同时新增管理员专用接口 `GET /tournaments/venues` 返回全量启用场地下拉数据，并在赛事列表响应项 `TournamentResponse` 上追加计算字段 `venue_names: list[str]`；前端 `AdminTournaments.tsx` 新增场地筛选下拉（Select）+ 表格场地名称列，`fetchAdminTournaments` 透传 `venue_id`。

## 视觉调性（前端项目必填，由 0-change 步骤 0.6 预选填入）

- **选定**：6 有机 / Organic
- **理由**：场地筛选是运营日常操作的低打扰辅助控件，沿用现有 Ant Design 表格 + Select 的观感即可，不引入新视觉语言。
- **参考产品**：飞书多维表格筛选栏、Notion Database Filter、Trello 看板过滤器
- **明确排除**：3 极简科技（筛选控件需要清晰的分组语义，不宜过度扁平）、8 赛博朋克（运营后台不需要高饱和霓虹）、4 玻璃拟态（下拉浮层上叠加毛玻璃易与现有卡片层级冲突）

> 此选择会被 `2a-ui-design.md` 继承，2a 阶段不再重选调性，只在此基础上深化（颜色 / 字体 / 间距 / 等）。

## 影响面

- [x] 影响 `REQUIREMENT.md`
- [x] 影响 `DESIGN.md` / 引入新 ADR
- [ ] 影响现有 AC（写出哪些）
- [ ] 影响数据模型 / 迁移
- [x] 影响外部 API 兼容性（`GET /tournaments` 新增可选参数 + 响应新增字段，向后兼容）
- [ ] 仅修复 bug，无范围变化

## 范围排除（这次不做）

- 不改 `venues` 表结构，不做"一个场地可被多个赛事共享"的多对多改造（受 `Venue.tournament_id` 非空 FK 约束，见 `app/models/venue.py:23`）。本次筛选语义是"赛事包含该场地"，对当前 1 场 1 馆的数据足够。
- 不动 `AdminSchedules.tsx` 的"场地管理 / 场地可用时间"功能（既有实现，见 `crud_schedule.py:254` 起）。
- 不在赛事表单里新增"绑定场地"的多选（场地归属由赛程生成/手动指定流程决定）。

## 验收线（粗粒度，不是 AC）

- 管理员在赛事列表页能通过场地下拉筛出"在该场地举办的赛事"，且列表每行显示该赛事关联的场地名称。
- `GET /tournaments?venue_id=N` 与不带参数时响应结构完全兼容，老客户端不受影响。
- 未配置任何场地的赛事在"全部"视图下照常显示，不被误过滤。

## 风险与未知

- `Venue.tournament_id` 为必填外键，一个场地只归属一个赛事——"按场地筛赛事"的返回集会退化成"该场地所属赛事"，需在 DESIGN 里明确语义并写进 AC，避免产品预期（多赛事共享场馆）与实现（1:1）不一致。
- `venue_names` 计算字段需要 N+1 查询防护（现有 `set_tournament_list_counts` 已用批量查询，需沿用同款批量预取），否则列表页每行多一条 venue 查询。
- 未知：管理端是否已有"全量启用场地"的聚合查询接口可复用（`fetchVenues(eventId)` 是按 event 粒度的，见 `adminApi.ts:641`），DESIGN 阶段需 grep 确认；若无则新增 `GET /tournaments/venues`。

---

> 后续 AC 与设计细节进入 `REQUIREMENT.md` / `DESIGN.md`，本文件不再扩展。
