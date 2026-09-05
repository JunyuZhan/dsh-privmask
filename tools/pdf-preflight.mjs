#!/usr/bin/env node
/**
 * dsh-privmask PDF 本地脱敏预检与文本导出（本地，不修改原 PDF）。
 *
 * 用法：
 *   node tools/pdf-preflight.mjs <输入.pdf...> [--config cfg.json]
 *       [--out-dir <目录>] [--report <输出.json>] [--ocr]
 *
 * - 数字文本层页：调用系统 poppler 的 pdftotext 提取每页文本；
 * - 扫描/空文本页（--ocr）：用 ghostscript 栅格化该页后调用 ~/.ocr-tool/ocr.py 本地 OCR；
 * - 每页文本走与对话/文档同一套脱敏规则，输出 <原名>.redacted.txt 脱敏文本预览；
 *   原 PDF 保持不变。本工具是“先看云端会读到什么”的预检，不是“改 PDF 原文”的终态工具。
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Config } from '../lib/index.js'
import { createEngine } from '../lib/engine.js'

const execFileAsync = promisify(execFile)
const OCR_PY = join(homedir(), '.ocr-tool', 'venv', 'bin', 'python')
const OCR_SCRIPT = join(homedir(), '.ocr-tool', 'ocr.py')

async function parseArgs(argv) {
  const out = { inputs: [], outDir: null, report: null, config: {}, ocr: false }
  const skip = new Set()
  const findVal = (flag) => {
    const i = argv.indexOf(flag)
    if (i >= 0) {
      const v = argv[i + 1]
      if (!v) throw new Error('用法：' + flag + ' <值>')
      skip.add(i); skip.add(i + 1)
      return v
    }
    return null
  }
  const configFile = findVal('--config')
  out.outDir = findVal('--out-dir')
  out.report = findVal('--report')
  out.ocr = argv.includes('--ocr')
  if (argv.includes('--config')) { const i = argv.indexOf('--config'); skip.add(i); skip.add(i + 1) }
  if (argv.includes('--out-dir')) { const i = argv.indexOf('--out-dir'); skip.add(i); skip.add(i + 1) }
  if (argv.includes('--report')) { const i = argv.indexOf('--report'); skip.add(i); skip.add(i + 1) }
  out.inputs = argv.filter((a, i) => !a.startsWith('--') && !skip.has(i)).map((p) => resolve(p))
  if (configFile) out.config = JSON.parse(await readFile(resolve(configFile), 'utf8'))
  return out
}

const args = await parseArgs(process.argv.slice(2))
if (args.inputs.length === 0) {
  console.error('用法：node tools/pdf-preflight.mjs <输入.pdf...> [--config cfg.json] [--out-dir 目录] [--report 报告.json] [--ocr]')
  process.exit(2)
}

async function haveBin(name, probeArgs) {
  try {
    await execFileAsync(name, probeArgs)
    return true
  } catch {
    return false
  }
}

const havePdftotext = await haveBin('pdftotext', ['-v'])
if (!havePdftotext) {
  console.error('未找到 pdftotext（poppler）。请先安装：brew install poppler（macOS），或 apt install poppler-utils。')
  process.exit(3)
}
const haveGs = await haveBin('gs', ['--version'])
const haveOcr = await haveBin(OCR_PY, [OCR_SCRIPT, '--check']).catch(() => false)

async function pdfPageCount(pdf) {
  const { stdout } = await execFileAsync('pdfinfo', [pdf], { maxBuffer: 1024 * 1024 })
  const m = stdout.match(/^Pages:\s+(\d+)/m)
  if (!m) throw new Error('pdfinfo 无法解析页数：' + pdf)
  return Number(m[1])
}

async function extractTextPage(pdf, page) {
  const { stdout } = await execFileAsync('pdftotext', ['-f', String(page), '-l', String(page), pdf, '-'], { maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

async function ocrPage(pdf, page) {
  const dir = await mkdtemp(join(tmpdir(), 'privmask-pdf-'))
  const png = join(dir, 'page-' + randomUUID() + '.png')
  try {
    await execFileAsync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=png16m', '-r200',
      '-dFirstPage=' + page, '-dLastPage=' + page, '-sOutputFile=' + png, pdf], { timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
    const { stdout } = await execFileAsync(OCR_PY, [OCR_SCRIPT, png, '--mode', 'json'], { timeout: 120000, maxBuffer: 64 * 1024 * 1024 })
    const out = JSON.parse(stdout.trim())
    if (!out || out.ok !== true) {
      const detail = out && (out.metadata && out.metadata.error || out.error)
      return { ok: false, error: String(detail || 'OCR 失败') }
    }
    return { ok: true, text: String(out.result ?? '') }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

const engine = createEngine(Config(args.config))
const rctx = { maps: new Map(), seq: new Map(), counts: new Map(), fields: 0 }
const totals = { pages: 0, textPages: 0, ocrPages: 0, emptyPages: 0, redactedPages: 0 }
const category = new Map()
const perInput = []

for (const pdf of args.inputs) {
  const pages = await pdfPageCount(pdf)
  const pageResults = []
  const outName = basename(pdf, extname(pdf)) + '.redacted.txt'
  const outDir = args.outDir ? resolve(args.outDir) : dirname(pdf)
  await mkdir(outDir, { recursive: true })
  const lines = ['# PDF 本地脱敏文本预览（原 PDF 未修改，仅供上云前核对）', '# 输入: ' + pdf, '# 页数: ' + pages, '']
  for (let p = 1; p <= pages; p++) {
    totals.pages += 1
    let source = 'text'
    let text = ''
    try {
      text = await extractTextPage(pdf, p)
    } catch {
      text = ''
    }
    let note = null
    if (!text.trim() && args.ocr) {
      if (!haveGs || !haveOcr) {
        note = '第 ' + p + ' 页无文本层且 OCR 前置缺失（gs=' + haveGs + ' ocr=' + haveOcr + '）'
        totals.emptyPages += 1
      } else {
        const r = await ocrPage(pdf, p)
        if (r.ok) {
          source = 'ocr'
          text = r.text
          totals.ocrPages += 1
        } else {
          note = '第 ' + p + ' 页 OCR 失败：' + r.error
          totals.emptyPages += 1
        }
      }
    } else if (!text.trim()) {
      note = '第 ' + p + ' 页无文本层（扫描件可加 --ocr 用本地 OCR）'
      totals.emptyPages += 1
    }
    const r = engine.redactText(text, rctx)
    const pageCounts = {}
    for (const m of r.text.matchAll(/\[REDACTED_([A-Z0-9_]+)_\d+\]/g)) {
      const k = m[1].toLowerCase()
      pageCounts[k] = (pageCounts[k] || 0) + 1
      category.set(k, (category.get(k) || 0) + 1)
    }
    if (r.changed) totals.redactedPages += 1
    if (source === 'text' && text.trim()) totals.textPages += 1
    lines.push('## 第 ' + p + ' 页（' + (source === 'ocr' ? '本地OCR' : '文本层') + '）')
    if (note) lines.push('[注意] ' + note)
    lines.push(r.text || '(本页无可用文本)', '')
    pageResults.push({ page: p, source, chars: text.length, changed: r.changed, counts: pageCounts, note })
  }
  const outFile = join(outDir, outName)
  await writeFile(outFile, lines.join('\n'))
  perInput.push({ input: pdf, output: outFile, pages: pageResults })
  const cat = [...category.entries()].map(([k, v]) => k + '=' + v).join(', ')
  console.log('已生成脱敏文本预览：' + outFile + '（脱敏页 ' + totals.redactedPages + '/' + pages + (cat ? '；命中 ' + cat : '') + '）')
}

if (args.report) {
  await mkdir(dirname(resolve(args.report)), { recursive: true })
  await writeFile(resolve(args.report), JSON.stringify({
    tool: 'dsh-privmask/pdf-preflight',
    generatedAt: new Date().toISOString(),
    totals: { pages: totals.pages, textPages: totals.textPages, ocrPages: totals.ocrPages, emptyPages: totals.emptyPages, redactedPages: totals.redactedPages },
    files: perInput,
  }, null, 2))
}
