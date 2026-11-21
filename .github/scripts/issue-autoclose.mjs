#!/usr/bin/env node
// Close the issues a pull request declares it resolves, once that pull request is merged into `dev`.
//
// The module exports three pure decision functions (body parsing, trigger decision, action plan) so the
// behaviour can be checked without a network. The command line wrapper on top of them reads a webhook
// payload, asks the GitHub REST API for the current issue states, then closes what is still open.
//
// Usage:
//   node .github/scripts/issue-autoclose.mjs [--payload <file>] [--dry-run]
//
//   --payload <file>  webhook payload JSON; defaults to $GITHUB_EVENT_PATH
//   --dry-run         print the plan without issue lookups or write requests
//
// Environment:
//   GITHUB_TOKEN      required unless --dry-run
//   GITHUB_API_URL    defaults to https://api.github.com
//
// A preview deliberately does not ask for issue states: it has to produce the same output locally, in
// CI and on a runner without a token, so it plans against "open" and reports what it would close.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Closing keywords are honoured only as the first meaningful token of a line, so a sentence that
// happens to mention "closes #5" cannot close an issue. The list marker (and its trailing space) is
// skipped, but nothing else in front of the keyword is.
const CLOSING_REFERENCE = /^\s*(?:[-*+]\s+)?(closes|fixes|resolves)\s*:?\s*#(\d+)/i;

// Fences (backticks or tildes) start and end a block whose content is sample text, not intent.
const FENCE = /^\s*(`{3,}|~{3,})/;

// A reference inside inline code is an example as well, so inline code spans are removed before the
// keyword match. The backreference keeps double-backtick spans intact.
const INLINE_CODE = /(`+)[^`]*?\1/g;

const DEFAULT_MAX_REFS = 10;
const SKIP_MARKER = /\[skip-issue-close\]/i;
const SKIP_LABEL = 'no-issue-close';
const COMMENT_BODY = (pullRequestNumber) =>
  `Fixed by #${pullRequestNumber} (merged into \`dev\`); it ships with the next release.`;

/**
 * Collect the issue numbers a pull request body claims to close.
 *
 * @param {string} body pull request body
 * @returns {number[]} distinct numbers, ascending
 */
export function parseClosingReferences(body) {
  const text = typeof body === 'string' ? body : '';
  const numbers = new Set();
  let insideFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    // Quoted lines are someone else's words (the template, an earlier comment), not this PR's claim.
    if (/^\s*>/.test(line)) continue;
    const match = CLOSING_REFERENCE.exec(line.replace(INLINE_CODE, ''));
    if (match === null) continue;
    const number = Number.parseInt(match[2], 10);
    if (Number.isFinite(number)) numbers.add(number);
  }
  return [...numbers].sort((left, right) => left - right);
}

/**
 * Decide whether this payload should close issues at all.
 *
 * Only a merged pull request into `dev` from a branch of the same repository qualifies. A fork head
 * is refused even when the merge landed into `dev`: closing issues from fork-authored text would give
 * the fork author write access to the tracker through a merged pull request.
 *
 * @param {unknown} payload webhook payload
 * @returns {{ act: boolean, reason: string }}
 */
export function decideTrigger(payload) {
  if (!payload || typeof payload !== 'object') return { act: false, reason: 'shape' };
  const pullRequest = payload.pull_request;
  if (!pullRequest || typeof pullRequest !== 'object') return { act: false, reason: 'shape' };
  if (payload.action !== undefined && payload.action !== 'closed') {
    return { act: false, reason: 'not-closed' };
  }
  if (pullRequest.merged !== true) return { act: false, reason: 'not-merged' };
  const base = pullRequest.base;
  if (!base || typeof base !== 'object' || typeof base.ref !== 'string') {
    return { act: false, reason: 'shape' };
  }
  const head = pullRequest.head;
  if (!head || typeof head !== 'object' || !head.repo || typeof head.repo !== 'object'
    || typeof head.repo.full_name !== 'string') {
    return { act: false, reason: 'shape' };
  }
  const repository = payload.repository;
  if (!repository || typeof repository !== 'object' || typeof repository.full_name !== 'string') {
    return { act: false, reason: 'shape' };
  }
  if (base.ref !== 'dev') return { act: false, reason: 'base-not-dev' };
  if (head.repo.full_name !== repository.full_name) return { act: false, reason: 'fork-pr' };
  if (typeof pullRequest.body === 'string' && SKIP_MARKER.test(pullRequest.body)) {
    return { act: false, reason: 'skip-marker' };
  }
  if (pullRequest.labels !== undefined && !Array.isArray(pullRequest.labels)) {
    return { act: false, reason: 'shape' };
  }
  const labels = Array.isArray(pullRequest.labels) ? pullRequest.labels : [];
  if (labels.some((label) => label && typeof label === 'object' && label.name === SKIP_LABEL)) {
    return { act: false, reason: 'skip-label' };
  }
  return { act: true, reason: 'merged-into-dev' };
}

/**
 * Turn the references plus the current issue states into one action per reference.
 *
 * The cap is all-or-nothing: more references than the limit means none of them is closed, because an
 * unexpectedly large list is a sign the body was not meant to be a closing declaration.
 *
 * @param {{ refs?: number[], issues?: { number?: number|string, state?: string }[], limits?: { maxRefs?: number } }} input
 * @returns {{ actions: { number: number, action: 'close'|'skip', reason: string }[] }}
 */
export function planIssueActions(input) {
  const refs = Array.isArray(input && input.refs) ? input.refs : [];
  const limits = input && input.limits;
  const maxRefs = Number.isInteger(limits && limits.maxRefs) ? limits.maxRefs : DEFAULT_MAX_REFS;
  const numbers = refs.map((ref) => Number(ref)).filter((number) => Number.isFinite(number));
  if (numbers.length > maxRefs) {
    return {
      actions: numbers.map((number) => ({ number, action: 'skip', reason: 'too-many-refs' })),
    };
  }
  const byNumber = new Map();
  for (const issue of Array.isArray(input && input.issues) ? input.issues : []) {
    const number = Number(issue && issue.number);
    if (Number.isFinite(number)) byNumber.set(number, issue);
  }
  const actions = numbers.map((number) => {
    const issue = byNumber.get(number);
    if (!issue) return { number, action: 'skip', reason: 'missing' };
    if (issue.state === 'open') return { number, action: 'close', reason: 'open' };
    return { number, action: 'skip', reason: 'already-closed' };
  });
  return { actions };
}

/** Read one JSON response from the REST API, turning a non-2xx status into a thrown Error. */
async function requestJson(url, token, init = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'issue-autoclose',
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await response.text();
  let data = null;
  if (text !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const detail = data && typeof data.message === 'string' ? data.message : text.slice(0, 200);
    throw new Error(`${response.status} ${detail || response.statusText}`);
  }
  return data;
}

/** Parse the command line into `{ payloadFile, dryRun, help }`. */
function parseArguments(argv) {
  const options = { payloadFile: '', dryRun: false, help: false };
  const args = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--payload') {
      options.payloadFile = args[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--payload=')) {
      options.payloadFile = arg.slice('--payload='.length);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

/**
 * Command line entry point. Returns the exit code instead of exiting so the whole flow stays testable.
 *
 * @param {string[]} argv arguments after the script path
 * @returns {Promise<number>} 0 on success (including every skip), 1 when any step failed
 */
async function runCli(argv) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  if (options.help) {
    console.log('用法：node .github/scripts/issue-autoclose.mjs [--payload <file>] [--dry-run]');
    return 0;
  }
  const payloadFile = options.payloadFile || process.env.GITHUB_EVENT_PATH || '';
  if (payloadFile === '') {
    console.error('没有事件载荷：用 --payload <file> 指定，或由环境提供 GITHUB_EVENT_PATH');
    return 1;
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
  } catch (error) {
    console.error(`读取事件载荷失败：${payloadFile}（${error.message}）`);
    return 1;
  }

  const decision = decideTrigger(payload);
  if (!decision.act) {
    console.log(`SKIP: ${decision.reason}`);
    return 0;
  }

  const pullRequest = payload.pull_request;
  const refs = parseClosingReferences(pullRequest.body);
  if (refs.length === 0) {
    console.log('NO-REFS');
    return 0;
  }
  const pullRequestNumber = Number(pullRequest.number);
  const repoFullName = payload.repository.full_name;
  const limits = { maxRefs: DEFAULT_MAX_REFS };

  if (options.dryRun) {
    const preview = planIssueActions({
      refs,
      issues: refs.map((number) => ({ number, state: 'open' })),
      limits,
    });
    for (const action of preview.actions) {
      if (action.action === 'close') console.log(`将关闭 #${action.number}`);
      else console.log(`跳过 #${action.number}（${action.reason}）`);
    }
    return 0;
  }

  const token = process.env.GITHUB_TOKEN || '';
  if (token === '') {
    console.error('缺少 GITHUB_TOKEN（非 --dry-run 运行时必填）');
    return 1;
  }
  const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const failures = [];
  const issues = [];
  for (const number of refs) {
    try {
      const issue = await requestJson(`${api}/repos/${repoFullName}/issues/${number}`, token);
      issues.push({ number, state: issue && typeof issue.state === 'string' ? issue.state : 'unknown' });
    } catch (error) {
      failures.push({ number, step: 'lookup', message: error.message });
    }
  }
  const plan = planIssueActions({ refs, issues, limits });
  const lookedUp = new Set(issues.map((issue) => issue.number));
  let closed = 0;
  let skipped = 0;
  for (const action of plan.actions) {
    if (action.action !== 'close') {
      // A failed lookup is reported as such rather than as "already closed" — the two differ for the
      // reader, and only one of them is a reason to look at the run again.
      const reason = lookedUp.has(action.number) ? action.reason : 'lookup-failed';
      skipped += 1;
      console.log(`跳过 #${action.number}（${reason}）`);
      continue;
    }
    try {
      await requestJson(`${api}/repos/${repoFullName}/issues/${action.number}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
      });
    } catch (error) {
      failures.push({ number: action.number, step: 'close', message: error.message });
      console.log(`失败 #${action.number}（关闭失败：${error.message}）`);
      continue;
    }
    try {
      await requestJson(`${api}/repos/${repoFullName}/issues/${action.number}/comments`, token, {
        method: 'POST',
        body: JSON.stringify({ body: COMMENT_BODY(pullRequestNumber) }),
      });
    } catch (error) {
      failures.push({ number: action.number, step: 'comment', message: error.message });
      console.log(`失败 #${action.number}（已关闭但留言失败：${error.message}）`);
      continue;
    }
    closed += 1;
    console.log(`已关闭 #${action.number}`);
  }
  console.log(`SUMMARY: closed=${closed} skipped=${skipped} failed=${failures.length}`);
  for (const failure of failures) {
    console.error(`FAILED #${failure.number}（${failure.step}）：${failure.message}`);
  }
  return failures.length === 0 ? 0 : 1;
}

// Only the process that names this file as its script runs the command line flow; importing the module
// from a test or another script stays free of I/O, network and exit-code side effects.
const invokedDirectly = typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && typeof process.argv[1] === 'string'
  && process.argv[1] !== ''
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`未处理的错误：${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  });
}
