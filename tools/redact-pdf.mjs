#!/usr/bin/env node
/**
 * dsh-privmask PDF 覆写式脱敏工具（本地原型）。
 *
 * 用法：node tools/redact-pdf.mjs <输入.pdf...> [--out-dir <目录>] [--report <输出.json>]
 *       [--config cfg.json] [--dpi 200]
 *
 * 原理：
 * 1. pdftotext -bbox 取每页单词框（PDF 点，y 自顶向下）；
 * 2. 按行重组文本并走与对话同一套脱敏规则，用占位符映射反向定位敏感片段，
 *    计算出需要涂黑的词框（跨词敏感值一并覆盖；找不到精确片段时整行兜底）；
 * 3. ghostscript 把每页栅格化为 PNG，像素级把命中区域涂黑；
 * 4. 把每页重组成“图片型脱敏 PDF”（无可选文本层，适合留档/外发）。
 *
 * 依赖（缺失时给出指引）：poppler（pdftotext/pdfinfo）与 ghostscript（gs）。
 * 已知取舍：输出为图片型 PDF，文件变大且无文本层；请用 pdf-preflight 先看脱敏文本预览。
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { inflateSync, deflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { Config } from '../lib/index.js'
import { createEngine } from '../lib/engine.js'

const execFileAsync = promisify(execFile)

// ── 最小 PNG 解码（8bit RGB，无隔行，gs png16m 输出即此形态） ──
function decodePng(buffer) {
  let w = 0; let h = 0; let bit = 0; let color = 0
  const idat = []
  let pos = 8
  while (pos + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); bit = data[8]; color = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (color !== 2 || bit !== 8) throw new Error('仅支持 8bit RGB PNG（gs png16m 输出）')
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = 3
  const stride = w * bpp
  const out = Buffer.alloc(stride * h)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  let off = 0
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[off]; off += 1
    const row = raw.subarray(off, off + stride); off += stride
    const cur = Buffer.from(row)
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? cur[i - bpp] : 0
      const up = prev[i]
      const ul = i >= bpp ? prev[i - bpp] : 0
      if (filter === 1) cur[i] = (cur[i] + left) & 0xff
      else if (filter === 2) cur[i] = (cur[i] + up) & 0xff
      else if (filter === 3) cur[i] = (cur[i] + ((left + up) >> 1)) & 0xff
      else if (filter === 4) cur[i] = (cur[i] + paeth(left, up, ul)) & 0xff
    }
    cur.copy(out, y * stride)
    prev = cur
  }
  return { w, h, data: out }
}
function fillBlack(data, w, h, x0, y0, x1, y1) {
  const sx = Math.max(0, Math.floor(Math.min(x0, x1)))
  const sy = Math.max(0, Math.floor(Math.min(y0, y1)))
  const ex = Math.min(w, Math.ceil(Math.max(x0, x1)))
  const ey = Math.min(h, Math.ceil(Math.max(y0, y1)))
  for (let y = sy; y < ey; y++) {
    for (let x = sx; x < ex; x++) {
      const p = (y * w + x) * 3
      data[p] = 0; data[p + 1] = 0; data[p + 2] = 0
    }
  }
}

// ── 参数 ──
async function parseArgs(argv) {
  const out = { inputs: [], outDir: null, report: null, dpi: 200, config: {} }
  const flagVal = (name) => {
    const i = argv.indexOf(name)
    if (i < 0) return null
    const v = argv[i + 1]
    if (!v) throw new Error('用法：' + name + ' <值>')
    argv[i] = ''; argv[i + 1] = ''
    return v
  }
  const dpiVal = flagVal('--dpi')
  const cfgFile = flagVal('--config')
  out.outDir = flagVal('--out-dir')
  out.report = flagVal('--report')
  if (dpiVal) out.dpi = Number(dpiVal)
  if (!(out.dpi >= 72 && out.dpi <= 600)) throw new Error('--dpi 需在 72-600 之间')
  out.inputs = argv.filter((a) => a && !a.startsWith('--')).map((p) => resolve(p))
  if (cfgFile) out.config = JSON.parse(await readFile(resolve(cfgFile), 'utf8'))
  return out
}

const args = await parseArgs(process.argv.slice(2))
if (args.inputs.length === 0) {
  console.error('用法：node tools/redact-pdf.mjs <输入.pdf...> [--out-dir 目录] [--report 报告.json] [--config cfg.json] [--dpi 200]')
  process.exit(2)
}

async function haveBin(name, probe) {
  try { await execFileAsync(name, probe); return true } catch { return false }
}
const need = [
  ['pdftotext', ['-v']],
  ['pdfinfo', ['-v']],
  ['gs', ['--version']],
]
for (const [bin, probe] of need) {
  if (!(await haveBin(bin, probe))) {
    console.error('缺少 ' + bin + '（poppler/ghostscript）。macOS: brew install poppler ghostscript')
    process.exit(3)
  }
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

async function pageInfo(pdf) {
  const [infoOut, bboxOut] = await Promise.all([
    execFileAsync('pdfinfo', [pdf], { maxBuffer: 1024 * 1024 }),
    execFileAsync('pdftotext', ['-bbox', pdf, '-'], { maxBuffer: 64 * 1024 * 1024 }),
  ])
  const pages = Number((infoOut.stdout.match(/^Pages:\s+(\d+)/m) || [])[1] || 0)
  const size = (infoOut.stdout.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m) || [])
  const pageW = Number(size[1] || 612)
  const pageH = Number(size[2] || 792)
  const pageBlocks = []
  const rePage = /<page[^>]*>([\s\S]*?)<\/page>/g
  const reWord = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/g
  let m
  while ((m = rePage.exec(bboxOut.stdout))) {
    const words = []
    let w
    while ((w = reWord.exec(m[1]))) {
      words.push({
        x0: Number(w[1]), y0: Number(w[2]), x1: Number(w[3]), y1: Number(w[4]),
        text: decodeEntities(w[5]),
      })
    }
    pageBlocks.push(words)
  }
  if (pages === 0 || pageBlocks.length === 0) throw new Error('无法解析 PDF 文本层：' + pdf)
  return { pages, pageW, pageH, pageBlocks }
}

/** 按 y 邻近聚成行，行内按 x 排序 */
function clusterLines(words) {
  const sorted = [...words].sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0))
  const lines = []
  for (const word of sorted) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(word.y0 - last.y0) < 4) {
      last.words.push(word)
      if (word.y1 > last.y1) last.y1 = word.y1
    } else {
      lines.push({ y0: word.y0, y1: word.y1, words: [word] })
    }
  }
  return lines.map((line) => {
    line.words.sort((a, b) => a.x0 - b.x0)
    let text = ''
    const ranges = []
    for (const word of line.words) {
      const start = text.length
      if (text) text += ' '
      const s2 = text.length
      text += word.text
      ranges.push({ word, start: s2, end: text.length })
      void start
    }
    return { y0: line.y0, y1: line.y1, words: line.words, text, ranges }
  })
}

function sensitiveValues(rctx) {
  const values = []
  for (const catMap of rctx.maps.values()) {
    for (const value of catMap.keys()) {
      if (value && value.length > 0 && value.length < 2000) values.push(value)
    }
  }
  return values
}

async function rasterize(pdf, page, dpi, dir) {
  const pngPath = join(dir, 'page-' + randomUUID() + '.png')
  await execFileAsync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=png16m', '-r' + dpi,
    '-dFirstPage=' + page, '-dLastPage=' + page, '-sOutputFile=' + pngPath, pdf], { timeout: 180000, maxBuffer: 32 * 1024 * 1024 })
  const decoded = decodePng(await readFile(pngPath))
  return { pngPath, ...decoded }
}

const engine = createEngine(Config(args.config))
const rctx = { maps: new Map(), seq: new Map(), counts: new Map(), fields: 0 }
const filesReport = []

for (const pdf of args.inputs) {
  const { pages, pageW, pageH, pageBlocks } = await pageInfo(pdf)
  const dir = await mkdtemp(join(tmpdir(), 'privmask-pdfred-'))
  const pageImages = []
  const pageHits = []
  try {
    for (let p = 1; p <= pages; p++) {
      const words = pageBlocks[p - 1] || []
      const covers = []
      const changedLines = []
      for (const line of clusterLines(words)) {
        const before = new Set(sensitiveValues(rctx))
        const r = engine.redactText(line.text, rctx)
        if (!r.changed) continue
        changedLines.push(line)
        // 精确片段：本行新增或已有的敏感值出现在行文本中 → 覆盖重叠词
        const valueHits = []
        for (const value of sensitiveValues(rctx)) {
          if (before.has(value) || value.length === 0) continue
          let from = 0
          let idx = line.text.indexOf(value, from)
          while (idx >= 0) {
            valueHits.push({ value, start: idx, end: idx + value.length })
            from = idx + 1
            idx = line.text.indexOf(value, from)
          }
        }
        // 旧值再次出现（同一映射）也要覆盖
        if (valueHits.length === 0) {
          for (const value of sensitiveValues(rctx)) {
            let from = 0
            let idx = line.text.indexOf(value, from)
            while (idx >= 0) {
              valueHits.push({ value, start: idx, end: idx + value.length })
              from = idx + 1
              idx = line.text.indexOf(value, from)
            }
          }
        }
        if (valueHits.length === 0) {
          for (const word of line.words) covers.push({ x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 })
          continue
        }
        for (const hit of valueHits) {
          for (const range of line.ranges) {
            if (range.start < hit.end && range.end > hit.start) {
              const word = range.word
              covers.push({ x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 })
            }
          }
        }
      }
      const image = await rasterize(pdf, p, args.dpi, dir)
      const scaleX = image.w / pageW
      const scaleY = image.h / pageH
      const dedup = new Map()
      for (const c of covers) {
        const key = c.x0.toFixed(1) + ',' + c.y0.toFixed(1) + ',' + c.x1.toFixed(1) + ',' + c.y1.toFixed(1)
        if (!dedup.has(key)) dedup.set(key, c)
      }
      for (const c of dedup.values()) {
        fillBlack(image.data, image.w, image.h, c.x0 * scaleX, c.y0 * scaleY, c.x1 * scaleX, c.y1 * scaleY)
      }
      pageImages.push({ w: image.w, h: image.h, stream: deflateSync(image.data) })
      pageHits.push({ page: p, coveredBoxes: dedup.size, changedLines: changedLines.length })
      await rm(image.pngPath, { force: true }).catch(() => {})
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  // 重组为图片型 PDF（干净版本：对象 = Catalog/Pages/每页(page,image,content)）
  const outDir = args.outDir ? resolve(args.outDir) : dirname(pdf)
  await mkdir(outDir, { recursive: true })
  const outFile = join(outDir, basename(pdf, extname(pdf)) + '.redacted.pdf')
  const totalObjs = 3 + pageImages.length * 3
  const contentOf = (i) => {
    const content = 'q\n' + pageW + ' 0 0 ' + pageH + ' 0 0 cm\n/Im0 Do\nQ\n'
    return content
  }
  const contentType = (i) => {
    const content = contentOf(i)
    return '<< /Length ' + Buffer.byteLength(content, 'latin1') + ' >>\nstream\n' + content + 'endstream'
  }
  let pdfBuf = Buffer.from('%PDF-1.4\n', 'latin1')
  const offs = []
  const write = (text) => {
    const b = Buffer.from(text, 'latin1')
    pdfBuf = Buffer.concat([pdfBuf, b])
    return b.length
  }
  offs[1] = pdfBuf.length; write('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  const kids = []
  for (let i = 0; i < pageImages.length; i++) kids.push((3 + i * 3) + ' 0 R')
  offs[2] = pdfBuf.length
  write('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pageImages.length + ' >>\nendobj\n')
  for (let i = 0; i < pageImages.length; i++) {
    const base = 3 + i * 3
    const pageImg = pageImages[i]
    offs[base] = pdfBuf.length
    write('' + base + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Resources << /XObject << /Im0 ' + (base + 1) + ' 0 R >> >> /Contents ' + (base + 2) + ' 0 R >>\nendobj\n')
    offs[base + 1] = pdfBuf.length
    write('' + (base + 1) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + pageImg.w + ' /Height ' + pageImg.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ' + pageImg.stream.length + ' >>\nstream\n')
    pdfBuf = Buffer.concat([pdfBuf, pageImg.stream])
    write('\nendstream\nendobj\n')
    offs[base + 2] = pdfBuf.length
    write('' + (base + 2) + ' 0 obj\n' + contentType(i) + '\nendobj\n')
  }
  const xref = pdfBuf.length
  let xrefText = 'xref\n0 ' + totalObjs + '\n0000000000 65535 f \n'
  for (let i = 1; i < totalObjs; i++) xrefText += String(offs[i]).padStart(10, '0') + ' 00000 n \n'
  xrefText += 'trailer\n<< /Size ' + totalObjs + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'
  pdfBuf = Buffer.concat([pdfBuf, Buffer.from(xrefText, 'latin1')])
  await writeFile(outFile, pdfBuf)
  filesReport.push({
    input: pdf,
    output: outFile,
    pages: pageHits,
    coveredTotal: pageHits.reduce((s, x) => s + x.coveredBoxes, 0),
  })
  console.log('已生成覆写式脱敏 PDF：' + outFile + '（涂黑框 ' + filesReport[filesReport.length - 1].coveredTotal + '）')
}

if (args.report) {
  const reportFile = resolve(args.report)
  await mkdir(dirname(reportFile), { recursive: true })
  await writeFile(reportFile, JSON.stringify({ tool: 'dsh-privmask/redact-pdf', generatedAt: new Date().toISOString(), files: filesReport }, null, 2))
}
