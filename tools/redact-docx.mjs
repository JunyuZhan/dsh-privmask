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
const htmlReportIdx = args.indexOf('--html-report')
const htmlReportPath = htmlReportIdx >= 0 ? args[htmlReportIdx + 1] : undefined
if (htmlReportIdx >= 0 && !htmlReportPath) {
  console.error('用法：--html-report <输出.html>')
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
if (htmlReportIdx >= 0) { skip.add(htmlReportIdx); skip.add(htmlReportIdx + 1) }
const positional = args.filter((a, i) => !a.startsWith('--') && !skip.has(i))
if (positional.length === 0) {
  console.error('用法：node tools/redact-docx.mjs <输入.docx...> [输出.docx] [--whole-paragraph] [--config cfg.json] [--out-dir 目录] [--report 报告.json] [--html-report 汇总.html]')
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
    report.push({ input, output, stats, crossRunNotChecked: !wholeParagraph })
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
if (htmlReportPath) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const rows = report.map((it) => {
    if (it.error) {
      return `<tr><td>${esc(it.input)}</td><td colspan="4" style="color:#c0392b">失败：${esc(it.error)}</td></tr>`
    }
    const counts = Object.entries(it.stats.counts).map(([k, v]) => esc(k) + '=' + v).join('、') || '无'
    const risk = it.crossRunNotChecked
      ? '<span style="color:#b7791f">默认模式：未做跨 run 复核</span>'
      : '整段合并模式'
    return `<tr><td>${esc(it.input)}</td><td>${esc(it.output)}</td><td>${esc(it.stats.nodes)}</td><td>${counts}</td><td>${risk}</td></tr>`
  }).join('\n')
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>dsh-privmask 脱敏报告</title>
<body><h1>dsh-privmask 脱敏报告</h1><p>生成时间：${new Date().toISOString()}</p>
<table border="1" cellpadding="6" style="border-collapse:collapse"><thead><tr><th>输入</th><th>输出</th><th>文本节点</th><th>命中</th><th>风险</th></tr></thead><tbody>${rows}</tbody></table>
<p>注意：启发式脱敏不保证零漏检；涉密文件请抽样人工核对。</p></body></html>`
  await writeFile(resolve(htmlReportPath), html)
  console.log('HTML 汇总已写入：' + htmlReportPath)
}
if (wholeParagraph) console.log('注意：整段合并会把段落格式并入首 run，请用 Word 抽查后再使用。')
else console.log('注意：默认模式不跨 Word 文本分段识别；报告已标注 crossRunNotChecked，重要文档请用 --whole-paragraph 复核。')
process.exit(failed > 0 ? 1 : 0)
