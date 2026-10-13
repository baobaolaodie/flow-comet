/**
 * installer-loader.mjs — 桥接 loader 的版本比对与托管块注入（prepare-env 的逻辑层模块）
 *
 * 为什么版本比对与 cordis patch 同处一个模块：两者都作用于「$DSH_HOME 全局挂载的桥接 loader」
 * 这一条生命周期链——loader 覆盖前先报版本方向（首次安装 / 升级 / 降级 / 版本一致），再按同一个
 * loader 路径生成 cordis.patch.yml 的托管块；而托管块的插入与移除又共用同一幂等替换边界
 * （stripManagedBlock，AGENTS.md 托管区亦复用它）。拆成两处会让「loader 路径 → patch 引用」的
 * 对应关系失去单一落点，两处路径推导一旦漂移，patch 会静默指向不存在的文件。
 *
 * 依赖方向：本模块是叶子（只用 node 内置模块）；installer-hooks 与 installer-platforms 依赖它。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// $DSH_HOME/cordis.patch.yml 托管块标记（dsh 平台 home patch 注入——幂等替换边界；
// 参照本机既有惯例：# --- dsh-skin managed --- ... # --- end dsh-skin managed ---）
const MANAGED_CORDIS_START = '# --- flow-comet managed ---';
const MANAGED_CORDIS_END = '# --- end flow-comet managed ---';
// ---------- loader 覆盖前版本比对（全局挂载的桥接 loader 生命周期治理） ----------

// 版本戳锚点正则（标记行格式契约：独立整行、行首无缩进、冒号后恰一个空格、行尾无其它字符；
// 格式禁动——安装器与 bridge-check 双侧提取以此为准；技能包自包含，语义同值复刻不跨模块 import）。
const BRIDGE_VERSION_RE = /^\/\/ BRIDGE_VERSION: ([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/m;

/**
 * 从 loader 文件提取版本戳（同一锚点正则）。返回 { ok:true, version }；
 * 文件缺失/读取失败/无标记行 → { ok:false, reason }（调用方告警兜底，不抛错）。
 */
function extractBridgeVersion(loaderPath) {
  let text;
  try {
    text = fs.readFileSync(loaderPath, 'utf8');
  } catch {
    return { ok: false, reason: '文件读取失败' };
  }
  const match = BRIDGE_VERSION_RE.exec(text);
  if (match) return { ok: true, version: match[1] };
  // 标记行存在但形态非法（区别于「无标记行」）——仍走既有警告路径，原因精确可诊断
  const loose = /^\/\/ BRIDGE_VERSION: (.*)$/m.exec(text);
  return loose
    ? { ok: false, reason: '版本戳形态非法（非语义化版本: ' + loose[1] + '）' }
    : { ok: false, reason: '未提取到版本戳标记行' };
}

/**
 * 语义化版本数值序比较（覆盖前判定方向）：major.minor.patch 逐段按数值比较
 * （如 1.10.0 > 1.6.0——非字典序）；核心版本相等时按语义化版本规则处理预发布后缀
 * （如 1.6.0-alpha.1 < 1.6.0）。返回 -1 / 0 / 1。
 */
function compareBridgeVersions(a, b) {
  const parse = (v) => {
    const text = String(v);
    const dash = text.indexOf('-');
    const core = (dash === -1 ? text : text.slice(0, dash)).split('.').map((seg) => parseInt(seg, 10));
    return { core, pre: dash === -1 ? null : text.slice(dash + 1) };
  };
  const av = parse(a);
  const bv = parse(b);
  const coreLen = Math.max(av.core.length, bv.core.length);
  for (let i = 0; i < coreLen; i++) {
    const x = av.core[i] ?? 0;
    const y = bv.core[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  const ap = av.pre !== null;
  const bp = bv.pre !== null;
  if (ap !== bp) return ap ? -1 : 1; // 预发布 < 正式版
  if (!ap) return 0;
  const ai = av.pre.split('.');
  const bi = bv.pre.split('.');
  const preLen = Math.max(ai.length, bi.length);
  for (let i = 0; i < preLen; i++) {
    if (i >= ai.length) return -1; // 更短标识符列表是更长列表的前缀 → 更小
    if (i >= bi.length) return 1;
    const x = ai[i];
    const y = bi[i];
    if (x === y) continue;
    const xn = /^\d+$/.test(x) ? parseInt(x, 10) : null;
    const yn = /^\d+$/.test(y) ? parseInt(y, 10) : null;
    if (xn !== null && yn !== null) return xn < yn ? -1 : 1;
    if (xn !== null) return -1; // 数字标识符 < 字母标识符（语义化版本规则）
    if (yn !== null) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * 覆盖前版本比对明示：从权威源 loader 与已装 loader 各提取版本戳，按数值序输出
 * 首次安装 / 升级 A→B / 降级 A→B / 版本一致 四类结论之一（人读、带 [flow-comet] 前缀）。
 * 任一侧提取失败（文件缺失/无标记行）→ 告警并跳过比对——不抛错、不中断安装；
 * 覆盖动作（copyFileSync）由调用方照常执行，幂等语义不变。
 */
export function reportLoaderVersionTransition(loaderSrc, loaderDst) {
  if (!fs.existsSync(loaderDst)) {
    console.log('[flow-comet] 桥接 loader 首次安装（$DSH_HOME/plugins 无已装 loader）');
    return;
  }
  const src = extractBridgeVersion(loaderSrc);
  const installed = extractBridgeVersion(loaderDst);
  if (!src.ok || !installed.ok) {
    const failedSide = !src.ok ? '权威源 loader' : '已装 loader';
    const reason = !src.ok ? src.reason : installed.reason;
    console.warn(
      `[flow-comet] 警告: ${failedSide} 版本戳提取失败（${reason}）——跳过版本比对，继续覆盖安装`
    );
    return;
  }
  const a = installed.version;
  const b = src.version;
  const cmp = compareBridgeVersions(a, b);
  if (cmp < 0) {
    console.log(`[flow-comet] 桥接 loader 升级 ${a} → ${b}`);
  } else if (cmp > 0) {
    console.log(`[flow-comet] 桥接 loader 降级 ${a} → ${b}`);
  } else {
    console.log(`[flow-comet] 桥接 loader 版本一致（${a}）`);
  }
}

/**
 * 极简 YAML 形状校验（零依赖——用于 cordis.patch.yml 的 fail-safe 判定）：
 * 文件须为顶层 YAML 列表形态（行形态：注释 / 空行 / 顶层 `- 条目` / 条目下缩进内容 / 文档分隔符），
 * 无法识别（二进制、顶层 map 形态等）→ 返回 false——调用方据此 fail-safe 不覆盖（保护用户配置）。
 */
function isSimpleYamlText(text) {
  return text.split(/\r?\n/).every((line) => {
    const t = line.trimEnd();
    if (t.trim() === '') return true; // 空行
    if (/^\s*#/.test(t)) return true; // 注释
    if (/^\s*---\s*$/.test(t)) return true; // 文档分隔符
    if (/^\s*-\s+\S/.test(t)) return true; // 顶层列表条目
    if (/^\s+\S/.test(t)) return true; // 条目下缩进内容（键值/嵌套列表；YAML 允许 1 空格缩进）
    return false;
  });
}

/**
 * 注入桥接 loader 托管块到 $DSH_HOME/cordis.patch.yml（dsh 平台 home patch——
 * 读-合并-写，L-008 非破坏）：
 * 读现有 cordis.patch.yml（缺失 → 空）→ 移除旧托管块（幂等）→ 托管块内联 loader 的
 * file:// 引用（**insert 形态**：无 id 的顶层 `- insert:` 条目内嵌插件行
 * `- id: dsh-flow-comet-bridge` + `name: 'file:///<abs 路径>'`——dsh-app-boot 的
 * applyEntryPatches 语义是 id-targeted patch（id 必须已存在于配置树）；无 id 的
 * `insert:` 顶层条目才执行 data.push 追加新插件行，是 home patch 新增插件的唯一正确形态；
 * 旧的 `- id: ... + name:` patch 形态对不存在的 id 报 entry not found 并跳过——
 * loader 从不加载 → 拦截整链静默失效）
 * → 保留托管块外既有块（dsh-skin 等）→ 写回。
 * fail-safe：文件存在但内容无法识别为 YAML → 抛错退出不覆盖（参照 injectSettingsHook 模式）。
 */
export function injectDshCordisPatch(dshHome, loaderPath) {
  const patchPath = path.join(dshHome, 'cordis.patch.yml');
  let existing = '';
  let fileExists = false;
  try {
    existing = fs.readFileSync(patchPath, 'utf8');
    fileExists = true;
  } catch { /* 文件缺失 = 首次安装 */ }
  if (fileExists && !isSimpleYamlText(existing)) {
    throw new Error(
      `cordis.patch.yml 已存在但内容无法解析为 YAML（${patchPath}）——为保护用户配置，中止注入。` +
        `请修复该文件（顶层 YAML 列表形态）后重试，或手动添加桥接 loader 引用。`
    );
  }
  const stripped = stripManagedBlock(existing, MANAGED_CORDIS_START, MANAGED_CORDIS_END);
  const fileUrl = pathToFileURL(loaderPath).href;
  const managedBlock =
    MANAGED_CORDIS_START + '\n' +
    '- insert:\n' +
    '    - id: dsh-flow-comet-bridge\n' +
    `      name: '${fileUrl.replace(/'/g, "''")}'\n` +
    MANAGED_CORDIS_END + '\n';
  const merged = (stripped.trim() ? stripped.trim() + '\n\n' : '') + managedBlock;
  fs.mkdirSync(dshHome, { recursive: true });
  fs.writeFileSync(patchPath, merged, 'utf8');
  return merged;
}

/**
 * 移除 $DSH_HOME/cordis.patch.yml 中的托管块（purge 语义：移除而非注入——保留 dsh-skin
 * 等既有块与用户内容）。文件缺失 → 跳过；内容无法识别为 YAML → 不动（fail-safe 保护
 * 用户配置）。移除后文件为空 → 删除文件本身。返回删除清单条目（供 purge 打印）。
 */
export function removeDshCordisPatch(dshHome) {
  const patchPath = path.join(dshHome, 'cordis.patch.yml');
  const removed = [];
  if (!fs.existsSync(patchPath)) return removed;
  let content;
  try {
    content = fs.readFileSync(patchPath, 'utf8');
  } catch { return removed; }
  if (!content.includes(MANAGED_CORDIS_START)) return removed;
  if (!isSimpleYamlText(content)) {
    // 无法识别 → 不触碰（fail-safe 语义与注入一致——保护用户配置）
    return removed;
  }
  const stripped = stripManagedBlock(content, MANAGED_CORDIS_START, MANAGED_CORDIS_END);
  const trimmed = stripped.trim();
  if (trimmed) {
    fs.writeFileSync(patchPath, trimmed + '\n', 'utf8');
  } else {
    fs.rmSync(patchPath, { force: true });
  }
  removed.push(patchPath + '（托管块）');
  return removed;
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

// 移除托管块（幂等替换边界）：start 标记到 end 标记（含尾随换行）之间的全部内容。
// 注入与清理共用——AGENTS.md 托管区 / cordis.patch.yml 托管块（L-008 读-合并-写）。
export function stripManagedBlock(content, startMarker, endMarker) {
  return content.replace(
    new RegExp(escapeRegExp(startMarker) + '[\\s\\S]*?' + escapeRegExp(endMarker) + '\\n?'),
    ''
  );
}
