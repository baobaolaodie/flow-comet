"""过滤工具 — e2e-processor change T01。

D2 决策：filter_items 用列表推导返回新列表（AC 要求"返回新列表"、
不修改输入，故不用原地过滤）；key 存在时先提取再判定。
"""


def filter_items(items, predicate, key=None):
    """返回 items 中满足 predicate 的项组成的新列表，不修改输入。

    - 空列表返回空列表
    - key 存在时：先按 key(item) 提取值，再对该值应用 predicate
      （即保留 key(item) 满足 predicate 的项）
    """
    if key is None:
        return [item for item in items if predicate(item)]
    return [item for item in items if predicate(key(item))]
