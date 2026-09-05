#!/usr/bin/env node
/**
 * dsh-privmask docx 脱敏 CLI（本地、保留格式）。
 * 用法：node tools/redact-docx.mjs <输入.docx> [输出.docx]
 * 缺省输出：同目录 <原名>.redacted.docx（不会覆盖原文件）。
 */

import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { redactDocx } from '../lib/docx.js'

const [, , inputArg, outputArg] = process.argv
if (!inputArg) {
  console.error('用法：node tools/redact-docx.mjs <输入.docx> [输出.docx]')
  process.exit(2)
}

const input = resolve(inputArg)
const output = outputArg ? resolve(outputArg) : join(dirname(input), basename(input, extname(input)) + '.redacted' + extname(input))
if (resolve(output) === input) {
  console.error('输出不能覆盖输入文件，请另指定输出路径')
  process.exit(2)
}

const raw = await readFile(input)
const { buffer, stats } = redactDocx(raw)
await writeFile(output, buffer)
const summary = Object.entries(stats.counts).map(([k, v]) => k + '=' + v).join(', ')
console.log('已生成脱敏副本：' + output)
console.log('处理文本节点：' + stats.nodes + '，命中类别：' + (summary || '无'))
console.log('注意：MVP 不跨 Word 文本分段识别；如需高保证请抽样核对。')
