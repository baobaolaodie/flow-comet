#!/usr/bin/env node
/**
 * internal-codes.mjs — 本项目内部词(过程代号)检测正则单一来源(入库)
 *
 * 定位:仓库约定(与 .github/workflows/ci.yml 同类)——主仓私有,**不分发**到
 *       flow-comet 安装副本(各项目的内部词由各项目自己定义,非通用词表)。
 *       hook(commit-msg/pre-push)与本地检查工具
 *       共用本文件,消除两处正则漂移。
 *
 * BANNED:提交消息 / PR 表述 / 文件内容检测层共用。
 * BANNED_COMMENT:注释层专用扩展(另拦无连字符 D 编号,如 D7)——仅限注释层
 *                 检测,不可用于公开产物(README 徽章色码 D97757 等会误伤)。
 */
export const BANNED = /\bS\d{2}\b|T-FIX|batch-(?![a-z])|D-\d+|P[0-7]\b|round\s*\d|dogfood|内部/;

export const BANNED_COMMENT = new RegExp(BANNED.source + '|(?<![A-Za-z])D\\d+(?![A-Za-z0-9-])');
