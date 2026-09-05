#!/usr/bin/env node
/**
 * dsh-privmask 纯文本脱敏 CLI（本地）。
 * 用法：node tools/redact-text.mjs <输入.txt> [输出.txt] [--config cfg.json]
 * 输出缺省为 <输入>.redacted.txt。
 */

import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { Config } from '../lib/index.js'
import { createEngine } from '../lib/engine.js'

const args = process.argv.slice(2)
const configIdx = args.indexOf('--config')
let config = {}
if (configIdx >= 0) {
  const file = args[configIdx + 1]
  if (!file) {
    console.error('用法：--config <配置文件.json>')
    process.exit(2)
  }
  config = JSON.parse(await readFile(resolve(file), 'utf8'))
}
const skip = new Set()
if (configIdx >= 0) { skip.add(configIdx); skip.add(configIdx + 1) }
const positional = args.filter((a, i) => !a.startsWith('--') && !skip.has(i))
const inputArg = positional[0]
if (!inputArg) {
  console.error('用法：node tools/redact-text.mjs <输入.txt> [输出.txt] [--config cfg.json]')
  process.exit(2)
}
const input = resolve(inputArg)
const output = positional[1]
  ? resolve(positional[1])
  : join(dirname(input), basename(input, extname(input)) + '.redacted' + extname(input))
if (resolve(output) === input) {
  console.error('输出不能覆盖输入文件，请另指定输出路径')
  process.exit(2)
}

const engine = createEngine(Config(config))
const text = await readFile(input, 'utf8')
const rctx = { maps: new Map(), seq: new Map(), counts: new Map(), fields: 0 }
const r = engine.redactText(text, rctx)
const stat = {}
for (const m of r.text.matchAll(/\[REDACTED_([A-Z0-9_]+)_\d+\]/g)) {
  stat[m[1].toLowerCase()] = (stat[m[1].toLowerCase()] || 0) + 1
}
const summary = Object.entries(stat).map(([k, v]) => k + '=' + v).join(', ')
if (!r.changed) {
  console.log('未发现需要脱敏的内容，输出原文副本：' + output)
} else {
  console.log('已生成脱敏副本：' + output + '（命中：' + (summary || '无') + '）')
}
await writeFile(output, r.text)
