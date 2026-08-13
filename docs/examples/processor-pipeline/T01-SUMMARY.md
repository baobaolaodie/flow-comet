# SUMMARY: T01 - dedupe 增强:自定义 key 去重

- **Change ID**: processor-pipeline
- **Task ID**: T01
- **AI 角色**: Dev(subagent,parallel 委托,worktree 隔离)

---

## 做了什么

在 `processor/dedupe.py` 的 `dedupe` 函数增加可选参数 `key=None`(DESIGN D2):key 为 callable 时按 `key(item)` 结果去重(保留首个出现);key=None 时保持既有语义(按元素本身去重)。既有调用 `dedupe(items)` 完全兼容(默认参数)。TDD 流程:先写 AC-2 失败用例(RED:TypeError 缺 key 参数)→ 实现 → GREEN。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `processor/dedupe.py` | 修改 | `dedupe` 增 `key=None` 参数(按 key 去重,保留首个) |
| `test_dedupe.py` | 修改 | 追加 AC-2 用例(3 个:dict 按 key 去重保留首个/无 key 语义不变/key 为 lambda 与内置函数) |

## verify 输出

```text
$ pytest test_dedupe.py -q
........ [100%]
8 passed in 0.09s（3 个新增 AC-2 用例 + 5 个既有用例全绿）
```

## 6 维自查

- 功能:通过(brooks-review 审查已跑)——AC-2 三条断言全过
- 性能:无影响——单次遍历 + 集合去重,O(n)
- 安全:通过——纯函数,无 IO/权限面
- 兼容:通过——`key=None` 默认参数保持既有调用完全兼容(AC-6)
- 可观测:通过——无新增输出,纯函数返回值
- 可维护:通过——与既有函数风格一致(默认参数扩展),语义内聚

## 越界检查

```
✅ 越界检查(R6.5):
  - TASK write_files:2 项
  - 实际 diff 涉及:2 项(dedupe.py / test_dedupe.py)
  - 越界:0
```

## 自检方法

brooks-review(worktree 子代理 Skill 加载后执行完整审查,6 维自查按审查输出整理)
