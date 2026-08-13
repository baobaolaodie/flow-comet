# CHANGE: processor 包管道化增强

- **Change ID**: processor-pipeline
- **状态**: active

---

## Why（为什么做）

`processor/` 包现有 4 个独立处理器（chunk / dedupe / sort / stats），调用方需要逐函数手动串联，组合场景（先排序再去重再分块）要写多层嵌套调用，可读性与可测试性差。同时各处理器能力有缺口：`dedupe` 只能按元素本身去重（无法按字段/key 去重）、`chunk` 只能按固定数量分块（无法按大小/字节分块）、`sort` 非稳定且不支持逆序、`stats` 无百分位计算。数据管道场景（ETL 式"过滤→去重→排序→分块→统计"）需要组合能力与参数灵活性。

## What（做什么）

1. **新增 `pipeline` 模块**：`pipe(*processors)` 串联任意处理器（前一个输出作为后一个输入），返回组合函数；空管道返回恒等函数。
2. **`dedupe` 增强**：新增可选 `key` 参数（`dedupe(items, key=None)`）——按 `key(item)` 结果去重；`key=None` 时保持既有语义（按元素本身）。
3. **`chunk` 增强**：新增可选 `max_size` 参数（`chunk(items, size, max_size=None)`）——按"每块累计元素总长（len 或字节）≤ max_size"分块；未指定时保持既有按数量分块。
4. **`sort` 增强**：新增 `key` 与 `reverse` 参数（`sort(items, key=None, reverse=False)`）——稳定排序（Python 内置 `sorted` 即稳定）+ 逆序；`key=None` 时按元素本身。
5. **`stats` 增强**：新增 `percentile` 函数（`percentile(values, p)`，p∈[0,100]，线性插值）——与既有 `mean/median` 同风格。

## 影响面

- [x] 影响 `REQUIREMENT.md`
- [x] 影响 `DESIGN.md` / 引入新 ADR
- [ ] 影响现有 AC（写出哪些）
- [ ] 影响数据模型 / 迁移
- [ ] 影响外部 API 兼容性
- [x] 仅新增参数与新增函数，既有调用完全兼容（默认参数保持既有行为）

## 范围排除（这次不做）

- 不做异步管道 / 并行执行（`pipe` 为同步串联，异步留待后续）。
- 不引入第三方依赖（`functools`/`statistics` 等标准库足够）。
- 不做管道中途短路/异常处理增强（`pipe` 直接透传异常，调用方自行处理）。

## 验收线（粗粒度，不是 AC）

- `pipe(dedupe, sort, chunk)` 等组合可正确串联各处理器，行为与逐函数调用一致。
- `dedupe`/`chunk`/`sort`/`stats` 新增参数全部有测试覆盖，既有 82 测试零破坏。

## 风险与未知

- `chunk` 的 `max_size` 语义（len vs 字节）需在 REQUIREMENT/DESIGN 明确——按元素 `len()`（字符串/列表等序列）计，文档注明。
- `percentile` 插值算法（线性插值 vs 最近秩）需明确——采用 numpy 风格线性插值，文档注明。
