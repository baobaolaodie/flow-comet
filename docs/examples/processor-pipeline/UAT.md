# UAT: processor 包管道化增强

- **Change ID**: processor-pipeline

---

## AC-1 · pipeline 组合串联

- **验证**: `pytest test_pipeline.py -q` → 5 passed(pipe(dedupe, sort)([3,1,3,2]) → [1,2,3];pipe() 恒等;三步组合;异常透传)
- **结果**: ✅ 通过

## AC-2 · dedupe 自定义 key

- **验证**: `pytest test_dedupe.py -q` → 8 passed(dict 按 id 去重保留首个;无 key 语义不变)
- **结果**: ✅ 通过

## AC-3 · chunk 按大小分块

- **验证**: `pytest test_chunk.py -q` → 9 passed(["ab","cd","e"] size=2 max_size=3 → [["ab"],["cd","e"]];max_size=None 按数量)
- **结果**: ✅ 通过

## AC-4 · sort 稳定与逆序

- **验证**: `pytest test_sort.py -q` → 14 passed(tuple 按 key 稳定排序相等 key 保持原序;reverse=True 逆序)
- **结果**: ✅ 通过

## AC-5 · stats percentile

- **验证**: `pytest test_stats.py -q` → 58 passed([1,2,3,4] p=50 → 2.5 线性插值;越界/空列表 ValueError)
- **结果**: ✅ 通过

## AC-6 · 向后兼容

- **验证**: `pytest -q` → 101 passed(既有 82 测试零破坏)
- **结果**: ✅ 通过

---

## 结论

6/6 AC 全部通过;全量回归 101 passed 零破坏。
