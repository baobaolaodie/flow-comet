# KNOWN-ISSUES(processor-pipeline 归档遗留)

## 遗留清单

- **percentile 实现与测试分离**:processor/stats.py 的 percentile 由既有 stats-aggregation change 实现,本次 T04 仅补测试——能力归属跨 change。跟进:后续 percentile 语义变更时以 stats.py 实现为准(REVIEW m-1 转待办)
- **chunk 的 max_size 仅适用于序列元素**:非序列元素(如 int)调用会抛 TypeError——文档已注明,但调用方误用时错误信息可读性一般。跟进:可在后续 change 补充类型检查与友好错误(REVIEW m-2 转待办)

## 使用说明

- 跟进:下一 change 或维护批次按清单逐项处置,处置后移除条目并注明处置结果
