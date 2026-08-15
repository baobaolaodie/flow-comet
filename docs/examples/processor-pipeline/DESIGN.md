# DESIGN: processor 包管道化增强

- **Change ID**: processor-pipeline
- **关联**: `@.specs/processor-pipeline/REQUIREMENT.md`、`@.specs/CONTEXT.md`

---

## 0. 技术栈选定

> 由 2-design 步骤 0 锁定。变栈视为开新 CHANGE（R7.1）。

- **选定**: 沿用现有纯 Python 标准库栈（`functools` / `statistics`），不引入新依赖
- **语言/运行时**: Python 3（与既有 processor 包一致）
- **测试**: pytest（既有测试框架，82 个既有用例）
- **关键依赖**: `functools.reduce`（pipe 串联）、`statistics`（percentile 插值手写，numpy 风格线性插值）
- **理由**: 全部为纯函数增强，标准库足够；不引入第三方依赖符合包定位
- **明确排除**: numpy/scipy（percentile 插值手写 5 行）、异步（范围排除）

---

## 0.5 既有架构对齐（brownfield 必填 · 来自 2-design 步骤 0.5 / B2 老项目护栏）

### 0.5.1 本次 change 触碰的既有模块

```
触碰模块（grep 出来的实际清单）：
- processor/__init__.py（既有 · 导出新增 pipe/percentile）
- processor/dedupe.py（既有 · 新增 key 参数）
- processor/chunk.py（既有 · 新增 max_size 参数）
- processor/sort.py（既有 · 新增 key/reverse 参数）
- processor/stats.py（既有 · 新增 percentile 函数）

新增模块：
- processor/pipeline.py（新增 · pipe 组合函数）

测试与文档文件（随各任务 write_files 新增，不在此列举——以 TASK.md 的 write_files 边界为准）：
- test_pipeline.py（新增）、test_dedupe.py / test_chunk.py / test_sort.py / test_stats.py（修改）

禁动清单（与本次无关，AI 不许"顺手"碰）：
- processor/__init__.py 的既有导出签名（仅追加，不删改）
- 既有 82 个测试的断言（只追加新用例）
```

### 0.5.2 既有抽象沿用对照表

| 本次需要 | 既有有没有？路径 | 决定 |
|---|---|---|
| 函数串联 | 无（各处理器独立调用） | 新增 `pipe`（functools.reduce） |
| 按 key 去重 | 无（`dedupe` 仅按元素） | `dedupe` 增 `key=None` 参数 |
| 按大小分块 | 无（`chunk` 仅按数量） | `chunk` 增 `max_size=None` 参数 |
| 稳定/逆序排序 | 部分（`sort` 用 `sorted`，已稳定但无 reverse 参数） | `sort` 增 `key=None, reverse=False` |
| 百分位 | 无（`stats` 有 mean/median） | 新增 `percentile(values, p)` 线性插值 |

### 0.5.3 沿用模式 vs 引入新模式

```
- 处理器形态：**沿用** 纯函数 + 默认参数（dedupe/sort 同款签名风格）
- 组合方式：**引入轻量新模式** pipe（functools.reduce 串联，返回组合函数）
- 测试形态：**沿用** pytest 纯函数用例
```

---

## 1. 决策清单

| # | 决策 | 备选 | 选择理由 | 取舍代价 |
|---|---|---|---|---|
| D1 | `pipe` 用 `functools.reduce` 串联 | 手写循环 / 类 Pipeline | reduce 一行实现，语义清晰；空管道返回恒等函数 | 异常直接透传（不做短路——范围排除已声明） |
| D2 | `dedupe` 用 `key=None` 默认参数扩展 | 新函数 `dedupe_by_key` | 默认参数保持既有调用完全兼容（AC-6）；语义内聚 | 签名从 1 参变 2 参（向后兼容） |
| D3 | `chunk` 的 `max_size` 按元素 `len()` 计 | 按字节（mode="bytes"） | 元素为字符串/列表等序列时 len 即体积；字节模式 v2 再做 | 非序列元素（int）的 len 会 TypeError——文档注明 max_size 仅适用于序列元素 |
| D4 | `percentile` 用 numpy 风格线性插值 | 最近秩（R-7 类） | numpy 风格是业界默认（P50/P90/P95 报告惯例） | 插值实现手写 5 行（`index = (n-1)*p/100` 线性插值） |
| D5 | `sort` 直接透传 `key/reverse` 给 `sorted` | 包装自定义排序 | Python `sorted` 天然稳定（AC-4 稳定性断言直接成立） | 无（零成本） |

## 2. 数据流 / 架构图

```
调用方：
  pipe(dedupe, sort, chunk)(items)
      │  functools.reduce 逐函数串联
      ▼
  dedupe(items, key=None) ──▶ 去重后列表
      ▼
  sort(items, key=None, reverse=False) ──▶ 排序后列表
      ▼
  chunk(items, size, max_size=None) ──▶ 分块后列表
```

## 3. 关键状态机（如有）

无状态机变更。全部为纯函数增强，无状态转移。

## 4. ADR 索引

- D1（pipe 用 reduce）可逆性低但实现极简，不写独立 ADR；语义记入 CONTEXT 术语表"管道"与 AC-1。

## 5. 风险

| # | 风险 | 影响 | 概率 | 缓解 |
|---|---|---|---|---|
| R1 | `chunk` 的 `max_size` 对非序列元素（int/float）`len()` 抛 TypeError | 调用方误用崩溃 | 中 | 文档注明 max_size 仅适用于序列元素；测试覆盖字符串/列表；错误信息自然（TypeError 明确） |
| R2 | `percentile` 插值算法与 numpy 有细微差异 | 边界值偏差 | 低 | 采用 numpy 官方插值公式（`(n-1)*p/100` 索引 + 线性插值），测试覆盖整数/小数索引 |
| R3 | `pipe` 异常透传语义不清 | 调用方困惑 | 低 | 文档注明"pipe 直接透传异常，不做短路"（范围排除已声明） |

## 6. 不在范围

- 异步管道 / 并行执行
- `chunk` 按字节分块（mode="bytes"）
- 管道中途短路 / 异常处理增强
- 第三方依赖

---

## 9. 架构沉淀建议（本 change 完成后供 `A-evolve` 同步用 · 软约束）

### 9.1 新增的可复用抽象（建议 append 到 CONTEXT 「既有抽象索引」段）

| 路径 | 能力 | 触发场景 | 复用建议 |
|---|---|---|---|
| `processor/pipeline.py` `pipe` | 纯函数串联组合 | 任何"多步纯函数变换"场景 | 组合函数统一用 pipe，避免嵌套调用 |

### 9.2 新增 / 改变的项目级技术决策（建议 append 到 CONTEXT「已锁技术决策」段 · 或将来升 ARCHITECTURE.md「ADR 列表」）

| 决策 | 取值 | 影响范围 | 推翻代价 |
|---|---|---|---|
| 处理器扩展一律默认参数向后兼容 | 新增参数带默认值 | 全部 processor 模块 | 低 |
| 百分位插值采用 numpy 风格 | 线性插值 | stats 模块 | 低 |

### 9.3 新增 / 修改的跨模块契约（API / Schema / 事件总线）（建议 append 到 CONTEXT「跨模块契约」段）

```
- pipeline.pipe(*processors) → callable（空管道 = 恒等函数）
- dedupe(items, key=None) → list（key 为 callable 或 None）
- chunk(items, size, max_size=None) → list[list]（max_size 按元素 len()）
- sort(items, key=None, reverse=False) → list（稳定排序）
- stats.percentile(values, p) → float（p∈[0,100]，线性插值；越界 ValueError）
```

### 9.4 新增 / 升级的依赖（建议 append 到 CONTEXT「技术栈」段）

| 包 | 版本 | 用途 | 是否替换既有 |
|---|---|---|---|
| 无 | — | 标准库足够（functools/statistics） | 否 |

### 9.5 禁动清单变化（建议 patch CONTEXT「禁动清单」段）

```
- 新增禁动：processor/__init__.py 既有导出签名（仅追加，不删改）
```

---

> 本文件不包含完整代码实现。函数签名、伪代码、接口定义可以；函数体不行。
