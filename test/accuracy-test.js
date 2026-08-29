// dsh-privmask 准确性测试：法律文档矩阵 / 误伤 / 凭据 / PII 校验 / 边界 / 还原 / 配置 / 幂等 / 性能。
// 运行：node test/accuracy-test.js
import test from 'node:test'
import { apply } from '../lib/index.js'

function makeHarness(config) {
  let listener = null
  let received = null
  const llmStub = { stream(o) { received = o; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); } }
  const ctx = {
    on(n, f) { if (n === 'llm/stream') listener = f; return () => {}; },
    get(n) { return n === 'llm' ? llmStub : undefined; },
  }
  apply(ctx, config)
  return {
    async dispatch(text) {
      received = null
      const opts = { provider: 't', model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text }] }] }
      const gen = listener(opts, () => { received = opts; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); })
      for await (const _ of gen) {}
      return received.messages[0].content[0].text
    },
  }
}

const H = makeHarness({ logRedactions: false })

/** 生成校验位正确的统一社会信用代码（避免假代码被校验器拒绝） */
const uscc = (() => {
  const p = '91110108MA01ABCDE'
  const cs = '0123456789ABCDEFGHJKLMNPQRTUWXY'
  const ws = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]
  let sum = 0
  for (let i = 0; i < 17; i++) sum += cs.indexOf(p[i]) * ws[i]
  const r = sum % 31
  return p + cs[r === 0 ? 0 : 31 - r]
})()

test('法律文档矩阵：实体脱敏、金额/案号/日期保留', async () => {
  const doc = '原告张三，被告李四，公司为深圳市南山科技有限公司，统一社会信用代码 ' + uscc + '，住址：广东省深圳市南山区粤海街道，电话 13800138000，邮箱 test123@qq.com，案号（2024）粤01民初123号，出生日期 1985年2月12日，涉案金额 1200000 元。'
  const out = await H.dispatch(doc)
  const masked = out.includes('[REDACTED_NAME_') && out.includes('[REDACTED_COMPANY_') && out.includes('[REDACTED_USCC_') && out.includes('[REDACTED_ADDR') && out.includes('[REDACTED_MOBILE_') && out.includes('[REDACTED_EMAIL_')
  const kept = out.includes('（2024）粤01民初123号') && out.includes('1200000') && out.includes('1985年2月12日')
  const leaked = out.includes('张三') || out.includes('李四') || out.includes('深圳市南山科技有限公司') || out.includes('13800138000') || out.includes('test123@qq.com')
  if (!masked || !kept || leaked) throw new Error('矩阵不达标: ' + out)
})

test('还原往返：模型回显占位符 → 本地还原原值', async () => {
  const Hr = makeHarness({ logRedactions: false })
  let preStep = null
  const llmStub = { stream(o) { return (async function* () { for (const c of canned) yield c })() } }
  let canned = []
  const ctx = { on(n, f) { if (n === 'agent/pre-step') preStep = f; else if (n === 'llm/stream') llmFn = f; return () => {} }, get(n) { return n === 'llm' ? llmStub : undefined } }
  let llmFn = null
  apply(ctx, { logRedactions: false })
  const d = await preStep({ agent: { session: { id: 'a' } }, messages: [] }, async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: '邮箱 test123@qq.com' }] }] }))
  const masked = d.messages[0].content[0].text
  const ph = masked.match(/\[REDACTED_[A-Z_]+_\d+\]/)[0]
  canned = [{ type: 'block-end', index: 0, block: { type: 'text', text: '已记住 ' + ph } }, { type: 'finish', reason: { kind: 'stop' } }]
  const opts = { provider: 't', model: 'm', sessionId: 'a', messages: [{ role: 'user', content: [{ type: 'text', text: masked }] }] }
  const gen = llmFn(opts, () => (async function* () {})())
  const out = []
  for await (const c of gen) out.push(c)
  const txt = out.map((c) => c.text || (c.block && c.block.text) || '').join('|')
  if (!txt.includes('test123@qq.com') || txt.includes('REDACTED_')) throw new Error('还原失败: ' + txt)
})

test('误伤防回归', async () => {
  const cases = [
    ['认为', '原告认为被告的行为构成侵权'],
    ['该公司', '该公司与本公司的协商'],
    ['URL', 'visit https://example.com/a'],
    ['版本号', 'v1.2.3'],
    ['日期', '2024-01-15'],
    ['时间', 'at 12:30:45'],
    ['订单号', '订单号 10086'],
    ['C++', 'std::vector<int> x'],
  ]
  for (const [name, text] of cases) {
    const out = await H.dispatch(text)
    if (out !== text) throw new Error(name + ' 误伤: ' + out)
  }
})

test('凭据矩阵', async () => {
  const cases = [
    ['PEM', '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAA==\n-----END RSA PRIVATE KEY-----'],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'],
    ['sk-', 'sk-test1234567890abcdef'],
    ['ghp_', 'ghp_abcdefghijklmnopqrstuvwxyz123456'],
    ['AWS', 'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ['Bearer', 'Authorization: Bearer abcdefghijklmnop12345678'],
    ['key=val', 'api_key=abcdef1234567890'],
  ]
  for (const [name, text] of cases) {
    const out = await H.dispatch(text)
    if (!out.includes('[REDACTED_KEY_') && !out.includes('[REDACTED_JWT_') && !out.includes('[REDACTED_PEM_')) throw new Error(name + ' 未脱敏: ' + out.slice(0, 40))
  }
})

test('PII 校验位：合法脱敏、非法放行', async () => {
  const ok = await H.dispatch('身份证号 11010519491231002X') // 校验位合法
  if (!ok.includes('[REDACTED_ID18_')) throw new Error('合法身份证未脱敏: ' + ok)
  const bad = await H.dispatch('号码 12345678901234567X') // 校验位非法
  if (!bad.includes('12345678901234567X')) throw new Error('非法身份证被误脱敏')
})

test('姓名/公司/机关边界', async () => {
  const cn = (...cps) => String.fromCharCode(...cps)
  const zhan = cn(0x8a79, 0x6c38, 0x98de) // 詹永飞
  const li = cn(0x674e, 0x4e3d) // 李丽
  const cases = [
    ['原告' + zhan + '与被告' + li + '离婚纠纷', true],
    ['原告' + zhan + '诉被告' + li, true],
    ['查询' + cn(0x963f, 0x91cc, 0x5df4, 0x5df4, 0x96c6, 0x56e2) + '工商信息', true], // 阿里巴巴集团
    ['委托' + cn(0x5317, 0x4eac, 0x5e02, 0x7b2c, 0x4e00, 0x4e2d, 0x7ea7, 0x4eba, 0x6c11, 0x6cd5, 0x9662) + '代理', true], // 北京市第一中级人民法院
  ]
  for (const [text] of cases) {
    const out = await H.dispatch(text)
    if (!out.includes('[REDACTED_')) throw new Error('边界未命中: ' + text + ' => ' + out)
  }
})

test('配置矩阵：全面脱敏档', async () => {
  const Hf = makeHarness({ logRedactions: false, redactNames: true, redactCompanies: true, redactOrgs: true })
  const out = await Hf.dispatch('原告张三，被告李四，公司为深圳市南山科技有限公司')
  if (!out.includes('[REDACTED_NAME_') || !out.includes('[REDACTED_COMPANY_')) throw new Error('全面档未生效: ' + out)
})

test('自定义词表 + 白名单', async () => {
  const Hc = makeHarness({ logRedactions: false, customTerms: ['欧阳雪'], preserveValues: ['test123@qq.com'] })
  const out = await Hc.dispatch('欧阳雪今天来访，联系 test123@qq.com')
  if (!out.includes('[REDACTED_CUSTOM_')) throw new Error('词表未生效')
  if (!out.includes('test123@qq.com')) throw new Error('白名单未放行')
})

test('strictUnknown：嵌套非普通对象拦截', async () => {
  const raw = makeHarness({ logRedactions: false })
  // 通过带 Buffer 的额外字段触发 failClosed
  let listener = null
  let received = null
  const ctx = { on(n, f) { if (n === 'llm/stream') listener = f; return () => {} }, get(n) { return n === 'llm' ? { stream() { return (async function* () {})() } } : undefined } }
  apply(ctx, { logRedactions: false })
  const opts = { provider: 't', model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], extra: { buf: Buffer.from('sk-secret') } }
  const gen = listener(opts, () => { received = opts; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })() })
  let reason = null
  for await (const ev of gen) { if (ev.type === 'finish') reason = ev.reason }
  if (!reason || reason.kind !== 'error' || reason.failure.code !== 'PRIVMASK_REDACTION_FAILED') throw new Error('Buffer 未拦截')
  if (received !== null) throw new Error('Buffer 请求触达适配器')
})

test('幂等：二次脱敏不变', async () => {
  const once = await H.dispatch('联系 alice@example.com 和 13900138000 密钥 sk-test1234567890abcdef')
  const twice = await H.dispatch(once)
  if (once !== twice) throw new Error('幂等失败')
})

test('性能阈值', async () => {
  const big = ('联系 alice@example.com 和 13900138000 密钥 sk-test1234567890\n').repeat(5000)
  const t0 = Date.now()
  await H.dispatch(big)
  const cost = Date.now() - t0
  if (cost > 1000) throw new Error('150KB 超时: ' + cost + 'ms')
  const t1 = Date.now()
  await H.dispatch('普通法律文书文本没有敏感信息的重复填充。'.repeat(4000))
  const cost2 = Date.now() - t1
  if (cost2 > 500) throw new Error('纯文本超时: ' + cost2 + 'ms')
})
