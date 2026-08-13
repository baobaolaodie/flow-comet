# TEST: processor 包管道化增强

- **Change ID**: processor-pipeline
- **项目类型**: Python 纯函数库(processor 包)

---

## 0. 本次测试范围声明(5 轮金字塔)

| 轮次 | 状态 | 范围 | 跳过理由 |
|---|---|---|---|
| 第 1 轮 · 功能 | ✅ 必跑 | AC-1~6 全部 | — |
| 第 2 轮 · 性能 | ⚠️ 部分 | pipe 组合与 percentile 的复杂度断言(单次遍历/排序) | 无压测基准,纯函数微秒级 |
| 第 3 轮 · 安全 | ✅ 必跑 | percentile 越界输入 ValueError;chunk max_size 非序列元素 TypeError(文档注明) | — |
| 第 4 轮 · 兼容 | ✅ 必跑 | 全量回归零破坏(既有 82 测试) | — |
| 第 5 轮 · 可观测 | N/A | 纯函数无埋点 | 无观测面 |

---

## 第 1 轮 · 功能测试

### 1.1 测试矩阵(AC → 用例)

| AC | 类型 | 用例文件 | 状态 |
|---|---|---|---|
| AC-1 | unit | `test_pipeline.py`(pipe 组合/恒等/异常透传,5 用例) | ✅ |
| AC-2 | unit | `test_dedupe.py`(key 去重保留首个/无 key 语义/lambda 与内置 key,3 新增) | ✅ |
| AC-3 | unit | `test_chunk.py`(累计 len 分块/max_size 默认/超限独立成块,4 新增) | ✅ |
| AC-4 | unit | `test_sort.py`(稳定排序/逆序/无参,3 新增) | ✅ |
| AC-5 | unit | `test_stats.py`(整数/小数索引/越界/空列表,4 新增) | ✅ |
| AC-6 | regression | `pytest -q`(全量 101) | ✅ |

## 验证命令

```bash
pytest -q
```

---

## 第 2 轮 · 性能测试

- pipe 组合:reduce 线性串联,各函数自身复杂度不变(断言单次调用通过,无新增循环)
- percentile:排序后插值 O(n log n),与既有 mean/median 同级

## 第 3 轮 · 安全测试

- percentile p 越界(<0 / >100)→ ValueError;空列表 → ValueError(断言覆盖)
- chunk max_size 非序列元素 → TypeError(文档注明为预期行为)

## 第 4 轮 · 兼容性测试

- 全量回归 101 passed:既有 82 测试零破坏(AC-6 断言)
- 新增参数均为默认值,既有调用签名不变

## 第 5 轮 · 可观测性验证

N/A——纯函数库,无埋点面(REQUIREMENT 已声明)。

---

## 新增测试登记

| 文件 | 新增用例 | 对应 AC |
|---|---|---|
| `test_pipeline.py`(新增) | 5 | AC-1 |
| `test_dedupe.py` | 3 | AC-2 |
| `test_chunk.py` | 4 | AC-3 |
| `test_sort.py` | 3 | AC-4 |
| `test_stats.py` | 4 | AC-5 |

## 回归保护

- 全量回归 `pytest -q` 为 AC-6 验证命令,零破坏断言
- 新增参数默认值保证向后兼容(既有 82 测试即回归保护)
