# SUMMARY: T04 - stats percentile 测试固化

- **Change ID**: processor-pipeline
- **Task ID**: T04
- **AI 角色**: Dev(串行委托,worktree 隔离)

---

## 做了什么

`processor/stats.py` 的 `percentile(values, p)` 已由既有 stats-aggregation change 实现(与 AC-5/DESIGN D4 语义完全一致:numpy 风格线性插值 `index = (n-1)*p/100`、p 越界/空列表抛 ValueError)。T04 的实际增量:按 TASK.md 在 `test_stats.py` 追加 AC-5 字面用例(整数索引端点/小数索引/越界/空列表),把既有能力固化为可验证断言。实现文件零改动(避免无意义 churn)。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `test_stats.py` | 修改 | 追加 AC-5 用例(4 个:整数索引端点 [1,2,3,4] p=0→1/p=100→4;小数索引 p=50→2.5;越界 -0.1/100.1 抛 ValueError;空列表抛 ValueError) |

## verify 输出

```text
$ pytest test_stats.py -q
.................................................. [100%]
58 passed in 0.10s（54 既有 + 4 新增 AC-5 用例）
```

## 6 维自查

- 功能:通过(brooks-review 审查已跑)——AC-5 四条断言全过
- 性能:无影响——既有实现,O(n log n)(排序)
- 安全:通过——纯函数;越界输入显式抛 ValueError
- 兼容:通过——新增测试不改变实现(AC-6)
- 可观测:通过——无新增输出
- 可维护:通过——能力已存在,本次补测试固化;实现零改动

## 越界检查

```
✅ 越界检查(R6.5):
  - TASK write_files:2 项
  - 实际 diff 涉及:1 项(test_stats.py;实现已满足规格,零改动)
  - 越界:0
```

## 自检方法

brooks-review(6 维自查按审查输出整理)
