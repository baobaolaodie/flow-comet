# dirty-worktree 归属协议

## 触发

进入 execute / verify 节点前，运行：

```bash
git status --short
git diff --stat
git diff --cached --stat
git ls-files --others --exclude-standard
```

## 归属三分类

1. **属于当前 change** → 吸收进当前任务，不重做
2. **不属于当前 change** → 暂停问用户（并入 / 拆新 change / 不动 / 授权丢弃）
3. **来源不清** → 暂停报告，不推进阶段

## 构建产物排除

`??` 匹配 .gitignore（node_modules/dist/__pycache__ 等）自动跳过归属。

## 禁令

- 脏工作树只算代码证据，不自动推进 phase / 勾选 tasks
- 未弄清来源前禁止覆盖 / 还原 / 格式化 / 忽略用户改动
- 脏 diff 未解释禁止标记 verify 通过
