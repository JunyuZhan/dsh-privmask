#!/usr/bin/env node
/**
 * dsh-privmask docx 脱敏 CLI（本地、保留格式）。
 * 用法：node tools/redact-docx.mjs <输入.docx> [输出.docx]
 * 缺省输出：同目录 <原名>.redacted.docx（不会覆盖原文件）。
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { redactDocx } from '../lib/docx.js'

const args = process.argv.slice(2)
const wholeParagraph = args.includes('--whole-paragraph')
const outDirIdx = args.indexOf('--out-dir')
const outDir = outDirIdx >= 0 ? args[outDirIdx + 1] : undefined
if (outDirIdx >= 0 && !outDir) {
  console.error('用法：--out-dir <目录>')
  process.exit(2)
}
const reportIdx = args.indexOf('--report')
const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : undefined
if (reportIdx >= 0 && !reportPath) {
  console.error('用法：--report <输出.json>')
  process.exit(2)
}
const configIdx = args.indexOf('--config')
let config = {}
if (configIdx >= 0) {
  const file = args[configIdx + 1]
  if (!file) {
    console.error('用法：--config <配置文件.json>（可选，键同 README 配置表）')
    process.exit(2)
  }
  config = JSON.parse(await readFile(resolve(file), 'utf8'))
}
const skip = new Set()
if (configIdx >= 0) { skip.add(configIdx); skip.add(configIdx + 1) }
if (outDirIdx >= 0) { skip.add(outDirIdx); skip.add(outDirIdx + 1) }
if (reportIdx >= 0) { skip.add(reportIdx); skip.add(reportIdx + 1) }
const positional = args.filter((a, i) => !a.startsWith('--') && !skip.has(i))
if (positional.length === 0) {
  console.error('用法：node tools/redact-docx.mjs <输入.docx...> [输出.docx] [--whole-paragraph] [--config cfg.json] [--out-dir 目录] [--report 报告.json]')
  process.exit(2)
}

const inputs = positional.map((p) => resolve(p))
let singleOutput = null
if (positional.length === 2 && outDir === undefined && !/\.docx$/i.test(positional[1])) {
  // 兼容旧用法：第二个位置参数是输出文件
  singleOutput = resolve(positional[1])
  inputs.length = 1
}

if (outDir) await mkdir(resolve(outDir), { recursive: true })
const report = []
let failed = 0
for (const input of inputs) {
  const output = singleOutput
    ?? (outDir
      ? join(resolve(outDir), basename(input, extname(input)) + '.redacted' + extname(input))
      : join(dirname(input), basename(input, extname(input)) + '.redacted' + extname(input)))
  if (resolve(output) === input) {
    console.error('输出不能覆盖输入文件：' + input + '（请用 --out-dir）')
    failed += 1
    continue
  }
  try {
    const raw = await readFile(input)
    const { buffer, stats } = redactDocx(raw, config, { wholeParagraph })
    await writeFile(output, buffer)
    const summary = Object.entries(stats.counts).map(([k, v]) => k + '=' + v).join(', ')
    console.log('已生成脱敏副本：' + output)
    console.log('  文本节点 ' + stats.nodes + (wholeParagraph ? '，整段合并 ' + stats.wholeParagraphs : '') + '，命中：' + (summary || '无'))
    report.push({ input, output, stats })
  } catch (e) {
    failed += 1
    console.error('处理失败：' + input + ' —— ' + (e && e.message ? e.message : e))
    report.push({ input, error: String(e && e.message ? e.message : e) })
  }
}
if (reportPath) {
  await writeFile(resolve(reportPath), JSON.stringify(report, null, 2))
  console.log('报告已写入：' + reportPath)
}
if (wholeParagraph) console.log('注意：整段合并会把段落格式并入首 run，请用 Word 抽查后再使用。')
else if (inputs.length > 1) console.log('注意：未开启 --whole-paragraph 时不跨 Word 文本分段识别；敏感值被拆成多段时请开启该选项。')
process.exit(failed > 0 ? 1 : 0)
