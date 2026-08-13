# TASK: processor 包管道化增强

- **Change ID**: processor-pipeline
- **关联**: `@.specs/processor-pipeline/REQUIREMENT.md`、`@.specs/processor-pipeline/DESIGN.md`

---

## 波次划分

```
Wave 1 (parallel): T01[P]（dedupe key 增强）, T02[P]（chunk max_size 增强）
Wave 2 (serial):   T03（sort 增强）, T04（stats percentile）
Wave 3 (serial):   T05（pipeline pipe，depends on T01~T04）
Wave 4 (serial):   T06（收口：全量回归 + 文档，depends on T05）
```

> 同 wave = 可并行；跨 wave = 必须顺序执行。T01/T02 触碰不同模块（dedupe.py/chunk.py）无冲突可同时委托子代理；T03/T04 独立模块串行；T05 组合函数依赖全部处理器；T06 收口回归。

---

## 任务清单

```xml
<task id="T01" parallel="true" status="done">
  <action>
    在 processor/dedupe.py 的 dedupe 函数增加可选参数 key=None（DESIGN D2）：key 为 callable 时按 key(item) 结果去重（保留首个），key=None 时保持既有语义（按元素本身去重）。
    保持既有调用 dedupe(items) 完全兼容（默认参数）。
    在 test_dedupe.py 追加 AC-2 用例：dict 列表按 key 去重保留首个；无 key 语义不变；key 为 lambda 与内置函数均可用。
  </action>
  <write_files>
    processor/dedupe.py
    test_dedupe.py
  </write_files>
  <verify>
    pytest test_dedupe.py -q
  </verify>
  <depends_on></depends_on>
</task>

<task id="T02" parallel="true" status="done">
  <action>
    在 processor/chunk.py 的 chunk 函数增加可选参数 max_size=None（DESIGN D3）：max_size 非 None 时按"每块累计元素 len() ≤ max_size"分块（当前块放不下时开新块）；max_size=None 时保持既有按数量分块语义。
    注意：max_size 仅适用于序列元素（字符串/列表），文档注明；非序列元素时 len() 抛 TypeError 属预期。
    在 test_chunk.py 追加 AC-3 用例：字符串列表按 len 分块；max_size=None 时按数量分块不变；块内元素不拆分（单个元素 len > max_size 时独立成块）。
  </action>
  <write_files>
    processor/chunk.py
    test_chunk.py
  </write_files>
  <verify>
    pytest test_chunk.py -q
  </verify>
  <depends_on></depends_on>
</task>

<task id="T03" status="done">
  <action>
    在 processor/sort.py 的 sort 函数增加可选参数 key=None, reverse=False（DESIGN D5）：直接透传给内置 sorted（Python sorted 天然稳定——AC-4 稳定性断言）；key=None 时按元素本身排序。
    在 test_sort.py 追加 AC-4 用例：tuple 列表按 key 稳定排序（相等 key 保持原相对顺序）；reverse=True 逆序；无参调用保持既有行为。
  </action>
  <write_files>
    processor/sort.py
    test_sort.py
  </write_files>
  <verify>
    pytest test_sort.py -q
  </verify>
  <depends_on></depends_on>
</task>

<task id="T04" status="done">
  <action>
    在 processor/stats.py 新增 percentile(values, p) 函数（DESIGN D4）：numpy 风格线性插值（index = (n-1)*p/100，整数索引取该值、小数索引线性插值）；p 越界（&lt;0 或 &gt;100）抛 ValueError；空列表抛 ValueError。
    在 test_stats.py 追加 AC-5 用例：整数索引（[1,2,3,4] p=0 → 1, p=100 → 4）；小数索引（p=50 → 2.5）；越界抛 ValueError；空列表抛 ValueError。
  </action>
  <write_files>
    processor/stats.py
    test_stats.py
  </write_files>
  <verify>
    pytest test_stats.py -q
  </verify>
  <depends_on></depends_on>
</task>

<task id="T05" status="done">
  <action>
    新增 processor/pipeline.py（DESIGN D1）：pipe(*processors) 用 functools.reduce 串联各处理器（前一个输出作为后一个输入），返回组合函数；空管道（pipe()）返回恒等函数 lambda x: x；异常直接透传（不做短路）。
    在 processor/__init__.py 导出 pipe（仅追加，不删改既有导出）。
    新增 test_pipeline.py 追加 AC-1 用例：pipe(dedupe, sort) 组合（先去重再排序）；pipe(dedupe, sort, chunk) 三步组合；pipe() 恒等；pipe 单函数等价于直接调用；pipe 中异常透传（中间处理器抛错向上传播）。
  </action>
  <write_files>
    processor/pipeline.py
    processor/__init__.py
    test_pipeline.py
  </write_files>
  <verify>
    pytest test_pipeline.py -q
  </verify>
  <depends_on>T01,T02,T03,T04</depends_on>
</task>

<task id="T06" status="done">
  <action>
    全量回归：pytest -q（AC-6：既有 82 测试 + 新增用例全部通过，零破坏）。
    更新 README.md（processor 包用法补 pipe/新参数示例）与 CHANGELOG.md（追加 feat 条目）。
    若全量回归发现既有测试被新参数破坏，修复或显式接受并记录。
  </action>
  <write_files>
    README.md
    CHANGELOG.md
    test_dedupe.py
    test_chunk.py
    test_sort.py
    test_stats.py
    test_pipeline.py
  </write_files>
  <verify>
    pytest -q
  </verify>
  <depends_on>T05</depends_on>
</task>
```

> **注意**：`write_files` 是 R7.3 强约束，必须**严格在 DESIGN `## 0.5.1` 「触碰模块 + 新增模块」范围内**，且**不能包含「禁动清单」**。否则 4-dev 步骤 5 提交前 verify 会 fail。

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

> 此区域由 review/integration 阶段自动追加，编号 `FIX-XX`。

```xml
<!-- 占位 -->
```
