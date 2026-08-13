# SUMMARY: T05 - pipeline pipe 组合函数

- **Change ID**: processor-pipeline
- **Task ID**: T05
- **AI 角色**: Dev(串行委托,worktree 隔离)

---

## 做了什么

新增 `processor/pipeline.py`(DESIGN D1):`pipe(*processors)` 用 `functools.reduce` 串联各处理器(前一个输出作为后一个输入),返回组合函数;空管道(`pipe()`)返回恒等函数;异常直接透传(不做短路)。在 `processor/__init__.py` 导出 `pipe`(仅追加,不删改既有导出)。TDD 流程:先写 AC-1 失败用例(RED:ImportError 无 pipeline 模块)→ 实现 → GREEN。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `processor/pipeline.py` | 新增 | `pipe(*processors)` 组合函数(functools.reduce 串联) |
| `processor/__init__.py` | 修改 | 追加导出 `pipe`(仅追加,不删改既有) |
| `test_pipeline.py` | 新增 | AC-1 用例(5 个:pipe 组合先去重再排序/三步组合/空管道恒等/单函数等价/异常透传) |

## verify 输出

```text
$ pytest test_pipeline.py -q
..... [100%]
5 passed in 0.05s
```

## 6 维自查

- 功能:通过(brooks-review 审查已跑)——AC-1 五条断言全过(pipe(dedupe, sort)([3,1,3,2]) → [1,2,3])
- 性能:无影响——reduce 线性串联,每函数自身复杂度不变
- 安全:通过——纯函数组合,无 IO/权限面
- 兼容:通过——新模块新导出,既有调用零影响(AC-6)
- 可观测:通过——异常直接透传(范围排除已声明,不做短路)
- 可维护:通过——reduce 一行实现,语义清晰;空管道恒等函数边界明确

## 越界检查

```
✅ 越界检查(R6.5):
  - TASK write_files:3 项
  - 实际 diff 涉及:3 项(pipeline.py 新增 / __init__.py 追加导出 / test_pipeline.py 新增)
  - 越界:0
```

## 自检方法

brooks-review(6 维自查按审查输出整理)
