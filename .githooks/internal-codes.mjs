#!/usr/bin/env node
/**
 * internal-codes.mjs — 本项目内部词(过程代号)检测正则单一来源(入库)
 *
 * 定位:仓库约定(与 .github/workflows/ci.yml 同类)——主仓私有,**不分发**到
 *       flow-comet 安装副本(各项目的内部词由各项目自己定义,非通用词表)。
 *       hook(commit-msg/pre-push)与本地检查工具
 *       共用本文件,消除两处正则漂移——两者对同一 subject / 同一文本
 *       得出同一判定(判据单一来源;hook 拦提交 subject,本地工具拦三层产物)。
 *
 * BANNED:提交消息 / PR 表述 / 文件内容检测层共用。两类词:
 *   ① 固定代号族:S 编号 / T-FIX / batch- / D-NN / P0~P7 / round N / dogfood / 「内部」
 *   ② 未公开概念族(五条**收窄**模式,2026-10-01 增补):
 *        `批次 [A-Z0-9]` / `批 ?\d` / `级 [0-9]` / `UAT-\d` / `(?<![A-Za-z])R-\d{2}`
 *      语义 = 「词 + 词界/编号后缀」,**不是裸词**——裸 `批次` / `级` 会误伤公开面既有的
 *      合法中文用法(发布批次 / 维护批次 / 级联 等),故只拦"词后紧跟编号"的写法;
 *      `R-\d{2}` 的字母边界同时排除 `ADR-013` / `PR-130` 这类含相似子串的合法编号。
 *      适用面与既有族一致:公开产物 / 分发技能文本 / 分发脚本注释三层。
 *      内部面(docs/internal/**)与工件面(.specs/**)用内部词汇是合法的,
 *      **永不纳入扫描**——那两面的同类字样属合法内部词汇,不是泄漏。
 * BANNED_COMMENT:注释层专用扩展(= BANNED + 无连字符 D 编号,如 D7)——仅限注释层
 *                 检测,不可用于公开产物(README 徽章色码 D97757 等会误伤)。
 *                 由 BANNED.source 拼接构造,故 BANNED 增补即注释层同步生效。
 */
export const BANNED = /\bS\d{1,3}\b|T-FIX|batch-(?![a-z])|D-\d+|P[0-7]\b|round\s*\d|dogfood|内部|批次 [A-Z0-9]|批 ?\d|级 [0-9]|UAT-\d|(?<![A-Za-z])R-\d{2}/;

export const BANNED_COMMENT = new RegExp(BANNED.source + '|(?<![A-Za-z])D\\d+(?![A-Za-z0-9-])');
