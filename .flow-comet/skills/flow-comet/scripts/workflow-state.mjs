#!/usr/bin/env node
// 状态机 CLI 入口（薄壳契约）：只做 CLI 参数解析、命令分派与退出码/输出收口；命令实现与
// 判定族一律落在 lib/state-*.mjs（单一来源，入口零内联判据）。
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveProtocol, readProtocolFile, validateProtocolSchema } from './protocol-utils.mjs';
import { initStateContext } from './lib/state-io.mjs';
import { runAdvance, runInit, runNext, runRecord, runSelect, runStatus } from './lib/state-commands-flow.mjs';
import { runConfig, runExecutionMode, runSkillLoad, runVerifyFail } from './lib/state-commands-admin.mjs';
import { runReenter, runReplan } from './lib/state-commands-recovery.mjs';
import { runBridgeCheck } from './lib/state-bridgecheck.mjs';
import { runExplain } from './lib/state-explain.mjs';

const command = process.argv[2] ?? 'status';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const runRoot = process.cwd();
// 路径上下文（runRoot / specsRoot / statePath）在分派前初始化一次——状态的读写与 .specs 路径
// 判定统一由 lib/state-io.mjs 承担
initStateContext(runRoot);
// 协议解析: 协议路径统一由 resolveProtocol 解析——优先级：--protocol CLI 参数 → FLOW_COMET_PROTOCOL
// 环境变量 → 内置默认 reference/workflow-protocol.json。--protocol 为全局参数（可放在 command
// 之后的任意位置）；cliArgs = 去掉 command 后的剩余参数数组。
const protocolPath = resolveProtocol(packageRoot, runRoot, process.argv.slice(3));

// 内置节点常量: 内置 8 节点常量（供其他用途参照——如 guard 的节点→协议映射对照；skill-load 的 node
// 参数校验已改为当前协议节点集合动态读取——compose 自定义协议节点可声明）
const BUILTIN_NODES = ['open', 'design', 'plan', 'execute', 'subagent-execute', 'review', 'verify', 'archive'];

async function main() {
  // 协议加载 = resolveProtocol 解析路径 + 受保护读取 + fail-closed schema 校验
  // （读失败/校验失败直接 throw，沿用现有错误处理风格）
  const protocol = await readProtocolFile(runRoot, protocolPath);
  validateProtocolSchema(protocol);

  if (command === 'bridge-check') {
    // 只读 dsh 桥接健康检查：零写入零网络；
    // 不依赖协议/状态，直接执行后返回。
    await runBridgeCheck({ runRoot, packageRoot });
    return;
  }

  if (command === 'init') { await runInit(protocol, process.argv, protocolPath); return; }

  if (command === 'status') { await runStatus(protocol); return; }

  if (command === 'next') { await runNext(protocol); return; }

  if (command === 'select') { await runSelect(protocol, process.argv); return; }

  if (command === 'skill-load') { await runSkillLoad(protocol, process.argv); return; }

  if (command === 'record') { await runRecord(protocol, process.argv); return; }

  if (command === 'config') { await runConfig(process.argv); return; }

  if (command === 'execution-mode') { await runExecutionMode(process.argv); return; }

  if (command === 'verify-fail') { await runVerifyFail(); return; }

  if (command === 'advance') { await runAdvance(protocol); return; }

  if (command === 'reenter') { await runReenter(protocol, process.argv); return; }

  if (command === 'replan') { await runReplan(protocol, process.argv); return; }

  if (command === 'explain') { runExplain(protocol, process.argv, __dirname); return; }

  throw new Error('Unknown command: ' + command + '. Use: init, status, next, select, record, verify-fail, advance, execution-mode, config, skill-load, bridge-check, reenter, replan, explain');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
