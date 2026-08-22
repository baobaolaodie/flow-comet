// task-parsing.mjs — <task ...> 开标签属性解析（单一来源）
// workflow-state 路由与 workflow-guard 校验共享：只读 <task ...> 开标签（不扫描块全文 / 子元素
// 文本），保证属性序无关、且不被 <action>/<verify> 等内容文本干扰。
// 语义：parallel = 开标签中 parallel="true"（缺省视为串行 false）；status = 开标签 status 属性值
// （无则 null）。判定「并行 pending 任务」统一为 parallel===true 且 status==='pending'。

// 解析 <task ...> 开标签属性。输入为包含开标签的块字符串；非 <task 开头 / 无开标签 → null。
export function taskOpeningAttrs(block) {
  const m = String(block ?? '').match(/<task\b([^>]*)>/);
  if (!m) return null;
  const attrs = {};
  for (const attr of m[1].matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g)) {
    attrs[attr[1]] = attr[2];
  }
  return {
    id: attrs.id ?? null,
    status: attrs.status ?? null,
    parallel: attrs.parallel === 'true',
  };
}

// 从 TASK.md 全文提取全部 <task> 块（<task 开标签 → 首个 </task> 闭合）。未闭合标签不产生块。
export function taskBlocks(content) {
  return [...String(content ?? '').matchAll(/<task\b[^>]*>[\s\S]*?<\/task>/g)].map((m) => m[0]);
}
