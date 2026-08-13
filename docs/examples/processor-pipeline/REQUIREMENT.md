# REQUIREMENT: processor 包管道化增强

- **Change ID**: processor-pipeline

---

## 用户故事

- **US-1**：作为调用方，我想用 `pipe(dedupe, sort, chunk)` 一条语句串联多个处理器，以便数据管道场景（去重→排序→分块）不再写多层嵌套调用。
- **US-2**：作为调用方，我想 `dedupe` 支持按字段去重（如按 dict 的 `id` 键），以便处理结构化数据时按业务键去重。
- **US-3**：作为调用方，我想 `chunk` 支持按内容大小分块（而非固定数量），以便分块大小由数据体积而非条数决定。
- **US-4**：作为调用方，我想 `sort` 支持稳定排序与逆序，以便结果顺序可预测（稳定）且可降序输出。
- **US-5**：作为调用方，我想 `stats` 支持百分位计算，以便报告分布（P50/P90/P95）而不只均值中位数。

## 验收准则（AC）

每条用 Given / When / Then，必须可验证。

### AC-1 · pipeline 组合串联

- **Given** 处理器 `dedupe` 与 `sort` 已存在
- **When** 调用 `pipe(dedupe, sort)([3, 1, 3, 2])`
- **Then** 返回 `[1, 2, 3]`（先去重再排序），且 `pipe()` 空调用返回恒等函数
- **验证方式**: `pytest test_pipeline.py -q`

### AC-2 · dedupe 自定义 key

- **Given** 元素为 dict 列表 `[{"id": 1, "v": "a"}, {"id": 1, "v": "b"}]`
- **When** 调用 `dedupe(items, key=lambda x: x["id"])`
- **Then** 返回保留首个 `[{"id": 1, "v": "a"}]`；`dedupe(items)`（无 key）保持既有语义
- **验证方式**: `pytest test_dedupe.py -q`

### AC-3 · chunk 按大小分块

- **Given** 元素为字符串列表 `["ab", "cd", "e"]`
- **When** 调用 `chunk(items, size=2, max_size=3)`
- **Then** 返回 `[["ab"], ["cd", "e"]]`（每块累计 len ≤ 3）；`chunk(items, size=2)` 保持按数量分块
- **验证方式**: `pytest test_chunk.py -q`

### AC-4 · sort 稳定与逆序

- **Given** 元素为 tuple 列表 `[("a", 2), ("b", 1), ("a", 1)]`
- **When** 调用 `sort(items, key=lambda x: x[0])`
- **Then** 相等 key 保持原相对顺序（稳定）`[("a", 2), ("a", 1), ("b", 1)]`；`sort(items, reverse=True)` 逆序
- **验证方式**: `pytest test_sort.py -q`

### AC-5 · stats percentile

- **Given** 数值列表 `[1, 2, 3, 4]`
- **When** 调用 `percentile(values, 50)`
- **Then** 返回 `2.5`（线性插值，numpy 风格）；`p` 越界（<0 或 >100）抛 ValueError
- **验证方式**: `pytest test_stats.py -q`

### AC-6 · 向后兼容

- **Given** 既有 82 个测试
- **When** 跑 `pytest -q`
- **Then** 全部通过（新增参数默认值保持既有行为，零破坏）
- **验证方式**: `pytest -q`

---

## 范围切分

### v1（本次必做）

- `pipeline.pipe(*processors)` 组合函数 + 单元测试
- `dedupe(key=None)` / `chunk(max_size=None)` / `sort(key=None, reverse=False)` / `stats.percentile(values, p)` 增强 + 单元测试
- 全量回归 + README/CHANGELOG 更新

### v2（下次）

- 异步管道（`async_pipe`）/ 中途短路
- `chunk` 按字节分块（`mode="bytes"`）

### out（不做）

- 第三方依赖 / 可视化
