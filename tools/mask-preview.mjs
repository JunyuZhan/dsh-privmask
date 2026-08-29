#!/usr/bin/env node
/**
 * dsh-privmask 脱敏对照工具（纯本地，不发送任何数据）。
 *
 * 用法：
 *   node tools/mask-preview.mjs <文件路径> [--redactFacts]
 *   cat 文件.txt | node tools/mask-preview.mjs [--redactFacts]
 *
 * 输出三份对照：
 *   1. 原文
 *   2. 脱敏后（发往云端的样子）
 *   3. 还原后（模型产出经本地还原的样子）
 *
 * --redactFacts / -f：同时脱敏姓名、公司、机关（更严隐私档）。
 */

import { readFileSync } from 'node:fs';
import { Config } from '../lib/index.js';
import { createEngine } from '../lib/engine.js';
import { restoreChunkText } from '../lib/restore.js';

const args = process.argv.slice(2);
const facts = args.includes('--redactFacts') || args.includes('-f');
const file = args.find((a) => !a.startsWith('-'));

let input;
if (file !== undefined) {
  input = readFileSync(file, 'utf8');
} else {
  input = readFileSync(0, 'utf8'); // stdin
}

const cfg = Config({
  logRedactions: false,
  ...(facts ? { redactNames: true, redactCompanies: true, redactOrgs: true } : {}),
});
const engine = createEngine(cfg);
const { result, rctx } = engine.sanitizeRequest({
  provider: 'preview',
  model: 'preview',
  sessionId: 'preview',
  messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
});

const maskedBlock = result.messages[0].content.find((b) => b && b.type === 'text');
const masked = maskedBlock ? maskedBlock.text : input;
const entries = [...engine.reverseMap(rctx).entries()].sort((a, b) => b[0].length - a[0].length);
const restored = restoreChunkText(masked, entries);

console.log('=== 1. 原文 ===');
console.log(input.trimEnd() + '\n');
console.log('=== 2. 脱敏后（发往云端） ===');
console.log(masked.trimEnd() + '\n');
console.log('=== 3. 还原后（本地还原） ===');
console.log(restored.trimEnd() + '\n');
console.log('占位符统计: ' + JSON.stringify(Object.fromEntries(rctx.counts), null, 0));
