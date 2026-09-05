// dsh-privmask docx 脱敏测试（纯内存构造，不依赖第三方库）
import test from 'node:test'
import { redactDocx, writeZip, parseZip } from '../lib/docx.js'

test('docx：正文 <w:t> 脱敏且保留格式结构', () => {
  const documentXml =
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:body><w:p><w:r><w:t>邮箱 alice.wang@privmask-test.com，住址：广东省深圳市南山区。</w:t></w:r>'
    + '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> 密钥 sk-test1234567890abcdef</w:t></w:r></w:p></w:body></w:document>'
  const entries = [
    { name: '[Content_Types].xml', method: 8, data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>') },
    { name: '_rels/.rels', method: 8, data: Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>') },
    { name: 'word/document.xml', method: 8, data: Buffer.from(documentXml) },
    { name: 'word/media/image1.png', method: 0, data: Buffer.from('not-really-png') },
  ]
  const input = writeZip(entries)
  const { buffer, stats } = redactDocx(input)
  if (!stats.counts.email || stats.counts.email < 1 || !stats.counts.addr || !stats.counts.key) {
    throw new Error('docx 未命中预期类别: ' + JSON.stringify(stats.counts))
  }
  const outXml = parseZip(buffer).find((e) => e.name === 'word/document.xml').data.toString('utf8')
  if (outXml.includes('alice.wang@privmask-test.com') || outXml.includes('sk-test1234567890abcdef')) {
    throw new Error('docx 中仍有明文: ' + outXml)
  }
  if (!outXml.includes('[REDACTED_EMAIL_') || !outXml.includes('[REDACTED_ADDR_') || !outXml.includes('[REDACTED_KEY_')) {
    throw new Error('docx 未写入占位符')
  }
  if (!outXml.includes('<w:b/>') || !outXml.includes('xml:space="preserve"')) {
    throw new Error('docx 格式结构被破坏: ' + outXml)
  }
  const media = parseZip(buffer).find((e) => e.name === 'word/media/image1.png')
  if (!media || media.data.toString('utf8') !== 'not-really-png') throw new Error('非文本条目被改动')
})

test('docx：整段合并识别跨 run 敏感值（可选）且编号单调', () => {
  const documentXml =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + '<w:p><w:r><w:t>邮箱 alice.</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>wang@privmask-test.com</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>备用 bob@privmask-test.com</w:t></w:r></w:p>'
    + '</w:body></w:document>'
  const entries = [
    { name: '[Content_Types].xml', method: 8, data: Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>') },
    { name: 'word/document.xml', method: 8, data: Buffer.from(documentXml) },
  ]
  const input = writeZip(entries)
  const { buffer, stats } = redactDocx(input, {}, { wholeParagraph: true })
  const xml = parseZip(buffer).find((e) => e.name === 'word/document.xml').data.toString('utf8')
  if (xml.includes('alice.') || xml.includes('bob@privmask-test.com')) throw new Error('跨 run 邮箱未遮罩: ' + xml)
  if (!xml.includes('[REDACTED_EMAIL_1]') || !xml.includes('[REDACTED_EMAIL_2]')) {
    throw new Error('编号未单调递增: ' + xml)
  }
  const runs = (xml.match(/<w:r>/g) || []).length + (xml.match(/<w:r><w:rPr>/g) || []).length
  if (runs < 3) throw new Error('run 结构被合并删除: ' + xml)
  if (!xml.includes('<w:b/>')) throw new Error('后续 run 格式样式丢失: ' + xml)
  if (!stats.wholeParagraphs || stats.wholeParagraphs < 1) throw new Error('整段合并统计缺失')
})

test('docx：配置化——关闭姓名脱敏时保留姓名但仍遮邮箱', () => {
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + '<w:p><w:r><w:t>原告张三，邮箱 bob@privmask-test.com</w:t></w:r></w:p></w:body></w:document>'
  const input = writeZip([
    { name: '[Content_Types].xml', method: 8, data: Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>') },
    { name: 'word/document.xml', method: 8, data: Buffer.from(xml) },
  ])
  const { buffer } = redactDocx(input, { redactNames: false })
  const out = parseZip(buffer).find((e) => e.name === 'word/document.xml').data.toString('utf8')
  if (!out.includes('张三') || !out.includes('[REDACTED_EMAIL_')) {
    throw new Error('配置化脱敏未按预期生效: ' + out)
  }
})
