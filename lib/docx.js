/**
 * dsh-privmask docx 本地脱敏（MVP）。
 *
 * 纯 Node 内置模块实现（zlib / crc32 手工表），不依赖第三方解压库：
 * - 读取 .docx（zip），只改写正文与页眉/页脚/脚注/批注中的 <w:t> 文本节点；
 * - 其余条目（样式、媒体、关系、[Content_Types].xml）原样保留；
 * - 输出“脱敏副本”，不修改原文件。
 *
 * 已知边界（MVP）：跨多个 <w:t> 分段存储的敏感值（Word 把一个词拆成多个 run）
 * 不会被合并识别；正式使用前请抽查。
 * @module dsh-privmask/docx
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { Config } from './index.js'
import { createEngine } from './engine.js'

// ── zip 工具（最小实现，只支持 store/deflate，目录项保持目录） ──
const SIG_EOCD = 0x06054b50
const SIG_CD = 0x02014b50
const SIG_LOCAL = 0x04034b50

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function parseZip(buffer) {
  // EOCD：文件末尾 64KB 内查找
  let eocd = -1
  const tailStart = Math.max(0, buffer.length - 65557)
  for (let i = buffer.length - 22; i >= tailStart; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('docx: 找不到 zip 中央目录（文件可能损坏或不是 docx）')
  const count = buffer.readUInt16LE(eocd + 10)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  const entries = []
  let pos = cdOffset
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pos) !== SIG_CD) throw new Error('docx: 中央目录损坏')
    const flags = buffer.readUInt16LE(pos + 8)
    const method = buffer.readUInt16LE(pos + 10)
    const crc = buffer.readUInt32LE(pos + 16)
    const compSize = buffer.readUInt32LE(pos + 20)
    const nameLen = buffer.readUInt16LE(pos + 28)
    const extraLen = buffer.readUInt16LE(pos + 30)
    const commentLen = buffer.readUInt16LE(pos + 32)
    const localOffset = buffer.readUInt32LE(pos + 42)
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLen)
    entries.push({ name, flags, method, crc, compSize, localOffset })
    pos += 46 + nameLen + extraLen + commentLen
  }
  for (const entry of entries) {
    if (entry.flags & 0x1) throw new Error('docx: 不支持加密条目: ' + entry.name)
    const local = entry.localOffset
    if (buffer.readUInt32LE(local) !== SIG_LOCAL) throw new Error('docx: 本地头损坏: ' + entry.name)
    const nameLen = buffer.readUInt16LE(local + 26)
    const extraLen = buffer.readUInt16LE(local + 28)
    const dataStart = local + 30 + nameLen + extraLen
    const compressed = buffer.subarray(dataStart, dataStart + entry.compSize)
    if (entry.name.endsWith('/')) {
      entry.data = Buffer.alloc(0)
      entry.method = 0
    } else if (entry.method === 0) {
      entry.data = Buffer.from(compressed)
    } else if (entry.method === 8) {
      entry.data = inflateRawSync(compressed)
    } else {
      throw new Error('docx: 不支持的压缩方式 ' + entry.method + ': ' + entry.name)
    }
  }
  return entries
}

function u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b }

export function writeZip(entries) {
  const chunks = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    let data = entry.data
    let method = entry.method
    if (entry.name.endsWith('/')) { data = Buffer.alloc(0); method = 0 }
    else if (method !== 0) {
      data = deflateRawSync(data)
      method = 8
    }
    const crc = crc32(entry.data)
    const flags = 0x0800 // UTF-8 文件名
    const now = new Date()
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
    const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
    const local = Buffer.concat([
      u32(SIG_LOCAL), u16(20), u16(flags), u16(method), u16(dosTime), u16(dosDate),
      u32(crc), u32(data.length), u32(entry.data.length),
      u16(nameBuf.length), u16(0),
      nameBuf, Buffer.alloc(0),
    ])
    chunks.push(local, data)
    const centralHead = Buffer.concat([
      u32(SIG_CD), u16(20), u16(20), u16(flags), u16(method), u16(dosTime), u16(dosDate),
      u32(crc), u32(data.length), u32(entry.data.length),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset),
      nameBuf, Buffer.alloc(0),
    ])
    central.push(centralHead)
    offset += local.length + data.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.concat([
    u32(SIG_EOCD), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBuf.length), u32(offset), u16(0),
  ])
  return Buffer.concat([...chunks, centralBuf, eocd])
}

// ── XML 文本节点处理 ──
function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function encodeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

const TEXT_NODE_RE = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
const TEXT_PART_RE = /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/

/**
 * 脱敏一个 docx 的 buffer，返回 { buffer, stats }。
 * @param {Buffer} input - .docx 文件内容
 * @param {object} [cfg] - privmask 配置（缺省用默认）
 */
export function redactDocx(input, cfg = {}) {
  const resolved = Config(cfg)
  const engine = createEngine(resolved)
  const entries = parseZip(input)
  const counts = {}
  let nodes = 0
  for (const entry of entries) {
    if (!TEXT_PART_RE.test(entry.name)) continue
    const xml = entry.data.toString('utf8')
    let changed = false
    const next = xml.replace(TEXT_NODE_RE, (whole, inner) => {
      nodes += 1
      const rctx = { maps: new Map(), seq: new Map(), counts: new Map(), fields: 0 }
      const text = decodeXml(inner)
      if (text === '') return whole
      const r = engine.redactText(text, rctx)
      if (!r.changed) return whole
      changed = true
      for (const [cat, n] of rctx.counts) counts[cat] = (counts[cat] || 0) + n
      return whole.replace(inner, encodeXml(r.text))
    })
    if (changed) entry.data = Buffer.from(next, 'utf8')
  }
  return { buffer: writeZip(entries), stats: { nodes, counts, files: entries.length } }
}
