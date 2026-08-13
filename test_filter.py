"""过滤工具测试 — e2e-processor change T01。

覆盖：基础过滤、空列表、key 提取过滤、输入不可变性、全过滤、顺序保持。
"""

import unittest

from processor.filter import filter_items


class TestFilterItems(unittest.TestCase):
    def test_basic_filter(self):
        self.assertEqual(filter_items([1, 2, 3, 4], lambda x: x > 2), [3, 4])

    def test_empty_list(self):
        self.assertEqual(filter_items([], lambda x: x > 0), [])

    def test_key_extracts_then_filters(self):
        items = [{"n": 1}, {"n": 3}]
        self.assertEqual(
            filter_items(items, lambda v: v > 2, key=lambda x: x["n"]),
            [{"n": 3}],
        )

    def test_does_not_modify_input(self):
        items = [1, 2, 3]
        filter_items(items, lambda x: x < 3)
        self.assertEqual(items, [1, 2, 3])

    def test_all_filtered_out(self):
        self.assertEqual(filter_items([1, 2, 3], lambda x: x > 100), [])

    def test_preserves_order(self):
        self.assertEqual(filter_items([5, 1, 4, 2], lambda x: x >= 2), [5, 4, 2])


if __name__ == "__main__":
    unittest.main()
