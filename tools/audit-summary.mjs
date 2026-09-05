#!/usr/bin/env node
/**
 * dsh-privmask 离境审计摘要：汇总 $DSH_HOME/privmask-egress.jsonl。
 *
 * 用法：
 *   node tools/audit-summary.mjs                 # 默认读取 $DSH_HOME 或 ~/.dsh
 *   node tools/audit-summary.mjs --file <path>   # 指定审计文件
 *   node tools/audit-summary.mjs --since 2026-09-01T00:00:00+08:00
 *
 * 退出码：0=正常；2=存在 rawMedia（有媒体原样离境），便于脚本/CI 告警。
 * 仅本地读取，不联网、不写审计文件。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function parseArgs(argv) {
  const out = { file: null, since: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file' && argv[i + 1]) out.file = argv[i + 1];
    else if (argv[i] === '--since' && argv[i + 1]) out.since = new Date(argv[i + 1]).getTime();
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('dsh-privmask 离境审计摘要');
  console.log('用法: node tools/audit-summary.mjs [--file <path>] [--since <ISO>]');
  console.log('退出码: 0=正常, 2=存在 rawMedia（媒体原样离境）');
  process.exit(0);
}

const file = args.file || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'privmask-egress.jsonl');
const since = args.since || 0;
let raw = '';
try {
  raw = readFileSync(file, 'utf8');
} catch {
  console.error('无法读取审计文件: ' + file + '\n（未产生过出站请求，或 egressAudit=false）');
  process.exit(1);
}

const counts = { masked: 0, clean: 0, blocked: 0, error: 0, rawMedia: 0 };
const category = new Map();
const media = { dropped: 0, preflight: 0, raw: 0 };
const rawEvents = [];
let parsed = 0;
let broken = 0;
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  let entry = null;
  try {
    entry = JSON.parse(line);
  } catch {
    broken += 1;
    continue;
  }
  const ts = Date.parse(entry.ts || '');
  if (Number.isNaN(ts) || ts < since) continue;
  parsed += 1;
  const d = entry.decision;
  if (d === 'masked' || d === 'clean' || d === 'blocked' || d === 'error') counts[d] += 1;
  else counts.clean += 1;
  if (entry.rawMedia === true) {
    counts.rawMedia += 1;
    if (rawEvents.length < 10) rawEvents.push(entry);
  }
  if (entry.media) {
    media.dropped += Number(entry.media.dropped || 0);
    media.preflight += Number(entry.media.preflight || 0);
    media.raw += Number(entry.media.raw || 0);
  }
  if (entry.counts && typeof entry.counts === 'object') {
    for (const [k, v] of Object.entries(entry.counts)) {
      category.set(k, (category.get(k) || 0) + Number(v || 0));
    }
  }
}

const topCat = [...category.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([k, v]) => k + '=' + v).join(' · ');

console.log('离境审计摘要');
console.log('文件: ' + file);
console.log('有效行: ' + parsed + (broken ? ' · 损坏行(忽略): ' + broken : ''));
console.log('决策: masked=' + counts.masked + ' clean=' + counts.clean + ' blocked=' + counts.blocked + ' error=' + counts.error);
console.log('媒体: raw=' + media.raw + ' preflight=' + media.preflight + ' dropped=' + media.dropped);
if (topCat) console.log('脱敏类别 Top: ' + topCat);
if (counts.rawMedia > 0 || media.raw > 0) {
  console.log('');
  console.log('⚠ 存在媒体原样离境（rawMedia）：' + counts.rawMedia + ' 次，请检查 nonTextPolicy/allowRawMedia 配置');
  for (const e of rawEvents) {
    console.log('  ' + (e.ts || '?') + ' provider=' + (e.provider || '?') + ' model=' + (e.model || '?') + ' decision=' + (e.decision || '?'));
  }
  process.exit(2);
}
process.exit(0);
