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
