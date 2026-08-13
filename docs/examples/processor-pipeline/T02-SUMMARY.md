# SUMMARY: T02 - chunk 增强:按大小分块

- **Change ID**: processor-pipeline
- **Task ID**: T02
- **AI 角色**: Dev(subagent,parallel 委托,worktree 隔离)

---

## 做了什么

在 `processor/chunk.py` 的 `chunk` 函数增加可选参数 `max_size=None`(DESIGN D3):max_size 非 None 时按"每块累计元素 `len()` ≤ max_size"分块(当前块放不下时开新块);max_size=None 时保持既有按数量分块语义。单个元素 `len()` 超过 max_size 时独立成块(不拆分元素)。TDD 流程:先写 AC-3 失败用例(RED:TypeError 缺 max_size 参数)→ 实现 → GREEN。实现前先按 R6.4 做了抽象 grep(沿用既有默认参数风格)。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `processor/chunk.py` | 修改 | `chunk` 增 `max_size=None` 参数(按累计 len 分块) |
| `test_chunk.py` | 修改 | 追加 AC-3 用例(4 个:累计 len 分块/max_size=None 默认/超限元素独立成块/列表元素) |

## verify 输出

```text
$ pytest test_chunk.py -q
......... [100%]
9 passed in 0.07s（5 个既有 + 4 个新增 AC-3 用例）
```

## 6 维自查

- 功能:通过(brooks-review 审查已跑,缓存协议手动执行 cache-brooks)——AC-3 四条断言全过
- 性能:无影响——单次遍历累计,O(n)
- 安全:通过——纯函数,无 IO/权限面
- 兼容:通过——`max_size=None` 默认参数保持既有按数量分块(AC-6)
- 可观测:通过——无新增输出
- 可维护:通过——默认参数扩展与既有风格一致;max_size 语义已注释(仅序列元素)

## 越界检查

```
✅ 越界检查(R6.5):
  - TASK write_files:2 项
  - 实际 diff 涉及:2 项(chunk.py / test_chunk.py)
  - 越界:0(.specs/ 与并行任务文件零触碰)
```

## 自检方法

brooks-review(Skill 加载返回占位 → Read 插件缓存协议文件手动执行完整审查,cache-brooks;6 维自查按审查输出整理)
