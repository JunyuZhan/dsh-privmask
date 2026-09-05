import test from 'node:test';
// dsh-privmask 自测：模拟最小 Cordis 上下文，验证拦截器把测试请求脱敏后再交给 adapter。
// 运行：node test/self-test.js
import { apply } from '../lib/index.js';
test('dsh-privmask self-test', async () => {

// 测试数据（码点构造，避免源文件含真实敏感串）
const cn = (...cps) => String.fromCharCode(...cps);
const T = {
  email: 'alice.wang@' + 'privmask-test.com',
  phone: '+86 139' + ' 0013 8000',
  ipv4: '203.0.113' + '.77',
  skKey: 'sk-test123' + '4567890abcdef',
  ghp: 'ghp_abcdefghijklmno' + 'pqrstuvwxyz123456',
  longHex: 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56',
  zhangsan: cn(0x5f20, 0x4e09),
  wangxiaoming: cn(0x738b, 0x5c0f, 0x660e),
  yuangao: cn(0x539f, 0x544a),
  beigao: cn(0x88ab, 0x544a),
  lianxiren: cn(0x8054, 0x7cfb, 0x4eba, 0xff1a),
  court: cn(0x5317, 0x4eac, 0x5e02, 0x7b2c, 0x4e00, 0x4e2d, 0x7ea7, 0x4eba, 0x6c11, 0x6cd5, 0x9662),
  company: cn(0x6df1, 0x5733, 0x5e02, 0x5357, 0x5c71, 0x79d1, 0x6280, 0x6709, 0x9650, 0x516c, 0x53f8),
  addrFull: cn(0x5e7f, 0x4e1c, 0x7701, 0x6df1, 0x5733, 0x5e02, 0x5357, 0x5c71, 0x533a, 0x7ca4, 0x6d77, 0x8857, 0x9053, 0x79d1, 0x6280, 0x56ed, 0x793e, 0x533a),
  zhu: cn(0x4f4f, 0x5740, 0xff1a),
  addrStandalone: cn(0x5e7f, 0x4e1c, 0x7701, 0x6df1, 0x5733, 0x5e02, 0x5357, 0x5c71, 0x533a, 0x7ca4, 0x6d77, 0x8857, 0x9053),
  safe: cn(0x539f, 0x544a) + cn(0x8ba4, 0x4e3a) + cn(0x88ab, 0x544a) + cn(0x7684) + cn(0x884c, 0x4e3a),
};

// 构造校验和正确的统一社会信用代码（运行时生成，避免源文件含完整代码）
const uscc = (() => {
  const p = '91110108MA01ABCDE';
  const cs = '0123456789ABCDEFGHJKLMNPQRTUWXY';
  const ws = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += cs.indexOf(p[i]) * ws[i];
  const r = sum % 31;
  return p + cs[r === 0 ? 0 : 31 - r];
})();

// 最小 Cordis 上下文
let listener = null;
let received = null;
const llmStub = {
  stream(options) {
    received = options;
    return (async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } };
    })();
  },
};
const ctx = {
  on(name, fn) {
    if (name === 'llm/stream') listener = fn;
    return () => { if (listener === fn) listener = null; };
  },
  get(name) {
    return name === 'llm' ? llmStub : undefined;
  },
};

// 全规则回归：默认隐私配置（姓名/公司/机关/地址/凭据/PII 均脱敏）
apply(ctx, { egressAudit: false });

const options = {
  provider: 'test',
  model: 'test-model',
  sessionId: 'session-1',
  system: '请联系 ' + T.email,
  messages: [
    { role: 'user', content: [
      { type: 'text', text: '联系 ' + T.email + ' 或 ' + T.phone + '，服务器 ' + T.ipv4 + '，密钥 ' + T.skKey + '，token ' + T.ghp },
      { type: 'text', text: T.yuangao + T.zhangsan + '，' + T.beigao + T.wangxiaoming + '，' + T.lianxiren + T.wangxiaoming },
      { type: 'text', text: T.zhu + T.addrFull },
      { type: 'text', text: T.court + '，' + T.company },
      { type: 'text', text: T.addrStandalone + '，统一社会信用代码 ' + uscc },
      { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: '校验和 ' + T.longHex }] },
      { type: 'text', text: T.safe },
    ] },
  ],
};

// 模拟水瀑调用：listener(options, next)；有脱敏时走 llmStub.stream，否则 next() 原样返回
async function run() {
  received = null;
  const result = listener(options, () => {
    received = options; // 未脱敏：adapter 收到原请求
    return (async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } };
    })();
  });
  for await (const _ of result) { /* drain */ }

  const all = (received.system ?? '') + '\n' + received.messages.map((m) => m.content.map((b) => b.type === 'text' ? b.text : '').join('')).join('\n');
  const checks = [
    ['邮箱', !all.includes(T.email) && all.includes('[REDACTED_EMAIL_1]')],
    ['电话', !all.includes(T.phone)],
    ['IPv4', !all.includes(T.ipv4)],
    ['sk-密钥', !all.includes(T.skKey)],
    ['ghp token', !all.includes(T.ghp)],
    ['长hex', !all.includes(T.longHex)],
    ['姓名', !all.includes(T.zhangsan) && all.includes('[REDACTED_NAME_')],
    ['司法机关', !all.includes(T.court) && all.includes('[REDACTED_ORG_')],
    ['公司', !all.includes(T.company) && all.includes('[REDACTED_COMPANY_')],
    ['地址', !all.includes(T.addrFull) && all.includes('[REDACTED_ADDR')],
    ['addr-chain', !all.includes(T.addrStandalone) && all.includes('[REDACTED_ADDR')],
    ['统一社会信用代码', !all.includes(uscc) && all.includes('[REDACTED_USCC_')],
    ['sessionId 移除', received.sessionId === undefined],
    ['防误伤(认为)', all.includes(T.safe)],
  ];
  let pass = 0, fail = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
    ok ? pass++ : fail++;
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail > 0 ? 1 : 0;
  if (fail > 0) throw new Error(fail + ' checks failed');
}

run();
});
