// dsh-privmask 可靠性测试（数据全部码点/碎片构造，源码无敏感字面）
import { apply } from '../lib/index.js';

const cn = (...cps) => String.fromCharCode(...cps);
const P = (cat, n) => '[REDACTED_' + cat + '_' + n + ']';
const S = {
  email: "alice.wang@privmask-test.com",
  phone: "+86 139 0013 8000",
  sk: "sk-test1234567890abcdef",
  hex40: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718",
  name1: "张三",
  name2: "李四",
  yg: "原告",
  bg: "被告",
  rw: "认为",
  gs: "公司",
  g: "该",
  b: "本",
  xy: "协商",
  yx: "向",
  rmfy: "人民法院",
  qs: "起诉",
  sfz: "身份证号 ",
  idFake: "12345678901234567X",
  id17: "12345678901234567",
  id20: "12345678901234567890",
  id15: "110105491231002",
  no1: "10086",
  time: "12:30:45",
  ver: "v1.2.3",
  date: "2024-01-15",
  url: "https://example.com/a",
  cpp: "std::vector<int> x",
  emoji: "😀🎉🚀 test",
};

function makeHarness(config) {
  let listener = null;
  let received = null;
  const llmStub = {
    stream(options) { received = options; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); },
  };
  const ctx = {
    on(name, fn) { if (name === 'llm/stream') listener = fn; return () => {}; },
    get(name) { return name === 'llm' ? llmStub : undefined; },
  };
  apply(ctx, config);
  async function dispatch(text, opts) {
    received = null;
    const options = { provider: 't', model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text }] }], ...(opts || {}) };
    const result = listener(options, () => { received = options; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); });
    for await (const _ of result) { /* drain */ }
    return received.messages.map((m) => m.content).flat().map((b) => (b.type === 'text' ? b.text : b.type)).join('\n');
  }
  return { dispatch, get received() { return received; } };
}

let pass = 0, fail = 0;
const t = (name, cond, detail) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + detail : '')); cond ? pass++ : fail++; };

const H = makeHarness({});

// A. 边界输入
t('A1 空字符串', (await H.dispatch('')) === '');
t('A2 纯标点', (await H.dispatch('！？，。；：、（）「」')) === '！？，。；：、（）「」');
t('A3 emoji', (await H.dispatch(S.emoji)) === S.emoji);
t('A4 单字符', (await H.dispatch('a')) === 'a');
t('A5 超长文本不崩', (await H.dispatch('x'.repeat(200000))).length === P('B64', 1).length);

// B. 幂等性
const idem1 = await H.dispatch('联系 ' + S.email + ' 或 ' + S.phone + ' 密钥 ' + S.sk);
const idem2 = await H.dispatch(idem1);
t('B1 幂等-第二次不变', idem1 === idem2);

// C. 防误伤回归
t('C1 认为', (await H.dispatch(S.yg + S.rw + S.bg + '的' + '行为构成侵权')) === S.yg + S.rw + S.bg + '的' + '行为构成侵权');
t('C2 该公司', (await H.dispatch(S.g + S.gs + '与' + S.b + S.gs + S.xy)) === S.g + S.gs + '与' + S.b + S.gs + S.xy);
t('C3 向人民法院', (await H.dispatch(S.yx + S.rmfy + S.qs)) === S.yx + S.rmfy + S.qs);
t('C4 C++作用域', (await H.dispatch(S.cpp)) === S.cpp);
t('C5 时间', (await H.dispatch('at ' + S.time)) === 'at ' + S.time);
t('C6 版本号', (await H.dispatch(S.ver)) === S.ver);
t('C7 日期无上下文', (await H.dispatch(S.date)) === S.date);
t('C8 短数字', (await H.dispatch('订单号 ' + S.no1)) === '订单号 ' + S.no1);
t('C9 URL', (await H.dispatch('visit ' + S.url)) === 'visit ' + S.url);

// D. 校验拒绝
t('D1 伪造身份证18', (await H.dispatch(S.sfz + S.idFake)).includes(S.idFake));
t('D2 17位数字', (await H.dispatch('编号 ' + S.id17)) === '编号 ' + S.id17);
t('D3 20位数字', (await H.dispatch('编号 ' + S.id20)) === '编号 ' + S.id20);
t('D4 15位无上下文', (await H.dispatch('编号 ' + S.id15)) === '编号 ' + S.id15);

// E. 同值映射
const same = await H.dispatch(S.email + ' 与 ' + S.email + ' 相同，还有 ' + S.email);
const unique = [...new Set((same.match(/\[REDACTED_EMAIL_\d+\]/g) || []))];
t('E1 同值映射', unique.length === 1, same);

// F. 配置组合
const H2 = makeHarness({ cnEntities: false });
t('F1 关中文实体', (await H2.dispatch(S.yg + S.name1 + ' 密钥 ' + S.sk)).includes(P('NAME', 1)) === false);
const H3 = makeHarness({ longTokens: false });
t('F2 关长Token', (await H3.dispatch('hash ' + S.hex40)).includes(P('HEX', 1)) === false);
const H4 = makeHarness({ dropSessionId: false });
await H4.dispatch('x', { sessionId: 'sess-1' });
t('F3 保留sessionId', H4.received.sessionId === 'sess-1');
const H5 = makeHarness({ enabled: false });
t('F4 总开关关', (await H5.dispatch('密钥 ' + S.sk)).includes(S.sk));
const H6 = makeHarness({ redactPaths: true });
t('F5 路径脱敏开', (await H6.dispatch('/Users/alice/secret.txt')).includes('secret.txt') === false);

// G. 多请求交替
const HA = makeHarness({});
const g1 = await HA.dispatch('邮箱 ' + S.email);
const g2 = await HA.dispatch('邮箱 ' + 'bob.wang@' + 'privmask-test.com');
t('G1 同会话顺序编号', g1.includes(P('EMAIL', 1)) && g2.includes(P('EMAIL', 2)));
const g3 = await HA.dispatch('邮箱 ' + S.email);
t('G2 同值复现同号', g3.includes(P('EMAIL', 1)));
const HB = makeHarness({ persistMapping: false });
const gb1 = await HB.dispatch('邮箱 ' + S.email);
const gb2 = await HB.dispatch('邮箱 ' + 'bob.wang@' + 'privmask-test.com');
t('G3 关闭持久映射-各自重新编号', gb1.includes(P('EMAIL', 1)) && gb2.includes(P('EMAIL', 1)));

// H. 性能
const big = ('联系 ' + S.email + ' 和 ' + S.phone + ' 密钥 ' + S.sk + '\n').repeat(5000);
const t0 = Date.now();
await H.dispatch(big);
const cost = Date.now() - t0;
t('H1 性能-150KB', cost < 5000, cost + 'ms');

// I. 姓名边界回归（漏检 / 吞字）
const sfName = cn(0x5f20, 0x4e09, 0x4e30); // 张三丰
const legal = await H.dispatch(S.yg + S.name1 + S.rw + S.bg + S.name2 + '的' + '行为违法');
t('I1 姓名不吞字-认为/的行为保留', legal.includes(S.rw) && legal.includes('的' + '行为') && legal.includes('[REDACTED_NAME_') && !legal.includes(S.name1) && !legal.includes(S.name2), legal);
const sanfeng = await H.dispatch('被告' + sfName + '的合同');
t('I2 三字名+的（不漏检不吞的）', sanfeng.includes('[REDACTED_NAME_') && !sanfeng.includes(sfName) && sanfeng.includes('的'), sanfeng);
const zsOnly = await H.dispatch(S.yg + S.name1 + '与' + '被告' + S.name2 + '协商');
t('I3 姓名+与', zsOnly.includes('[REDACTED_NAME_') && zsOnly.includes('与') && !zsOnly.includes(S.name1) && !zsOnly.includes(S.name2), zsOnly);

// J. 工具元信息脱敏配置
const coName = cn(0x6df1, 0x5733, 0x5e02, 0x5357, 0x5c71, 0x79d1, 0x6280, 0x6709, 0x9650, 0x516c, 0x53f8); // 深圳市南山科技有限公司
const toolWithMeta = (desc) => [{ type: 'function', name: 'lookup', description: desc, parameters: { type: 'object', properties: { q: { type: 'string', description: '公司名' } } } }];
const H8 = makeHarness({});
await H8.dispatch('查', { tools: toolWithMeta('查询' + coName + '的工商信息') });
t('J1 默认脱敏工具描述-查询保留', H8.received.tools[0].description.includes('查询') && H8.received.tools[0].description.includes('[REDACTED_COMPANY_') && !H8.received.tools[0].description.includes(coName), H8.received.tools[0].description);
const H9 = makeHarness({ redactToolMeta: false });
await H9.dispatch('查', { tools: toolWithMeta('查询' + coName + '的工商信息') });
t('J2 关闭工具元信息脱敏', H9.received.tools[0].description.includes(coName), H9.received.tools[0].description);

// K. 动词不吞（公司/机关）+ AWS 密钥
const courtName = cn(0x5317, 0x4eac, 0x5e02, 0x7b2c, 0x4e00, 0x4e2d, 0x7ea7, 0x4eba, 0x6c11, 0x6cd5, 0x9662); // [司法机关_1]
const rk1 = await H.dispatch('查询' + coName + '的工商信息');
t('K1 公司名不吞查询', rk1.includes('查询') && rk1.includes('[REDACTED_COMPANY_') && !rk1.includes(coName), rk1);
const rk2 = await H.dispatch('委托' + courtName + '代理');
t('K2 机关不吞委托', rk2.includes('委托') && rk2.includes('[REDACTED_ORG_') && !rk2.includes(courtName), rk2);
const rk3 = await H.dispatch('aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
t('K3 AWS secret key', rk3.includes('[REDACTED_KEY_') && !rk3.includes('wJalrXUtnFEMI'), rk3);

// L. 跨请求占位符一致性（同会话同值同号）
const email2 = 'bob.wang@' + 'privmask-test.com';
const HL = makeHarness({});
await HL.dispatch('邮箱 ' + S.email, { sessionId: 'sess-L' });
const rl1 = await HL.dispatch('新邮箱 ' + email2 + ' 旧邮箱 ' + S.email, { sessionId: 'sess-L' });
t('L1 同会话跨请求同值同号', rl1.includes('旧邮箱 [REDACTED_EMAIL_1]') && rl1.includes('新邮箱 [REDACTED_EMAIL_2]') && !rl1.includes(S.email) && !rl1.includes(email2), rl1);
const rl2 = await HL.dispatch('邮箱 ' + S.email, { sessionId: 'sess-L2' });
t('L2 不同会话独立编号', rl2.includes('[REDACTED_EMAIL_1]'), rl2);
const HN = makeHarness({ persistMapping: false });
await HN.dispatch('邮箱 ' + S.email, { sessionId: 'sess-N' });
const rl3 = await HN.dispatch('新邮箱 ' + email2 + ' 旧邮箱 ' + S.email, { sessionId: 'sess-N' });
t('L3 关闭持久映射-重新编号', rl3.includes('新邮箱 [REDACTED_EMAIL_1]') && rl3.includes('旧邮箱 [REDACTED_EMAIL_2]'), rl3);

// M. 非文本内容策略（图片/文件块）
const mB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function imageHarness(config) {
  let listener = null;
  let received = null;
  const llmStub = { stream(o) { received = o; return (async function* () { yield { type: 'finish', reason: { kind: 'stop', via: 'stream' } }; })(); } };
  const ctx = { on(n, f) { if (n === 'llm/stream') listener = f; return () => {}; }, get(n) { return n === 'llm' ? llmStub : undefined; } };
  apply(ctx, config);
  return {
    async run(content) {
      received = null;
      const options = { provider: 't', model: 'm', messages: [{ role: 'user', content }] };
      const gen = listener(options, () => { received = options; return (async function* () { yield { type: 'finish', reason: { kind: 'stop', via: 'next' } }; })(); });
      let reason = null;
      for await (const ev of gen) { if (ev.type === 'finish') reason = ev.reason; }
      return { reason, received };
    },
  };
}
const Hi = imageHarness({});
const ri1 = await Hi.run([{ type: 'text', text: '描述图片' }, { type: 'image', image: mB64 }]);
t('M1 默认拦截图片块', ri1.reason.kind === 'error' && ri1.reason.failure && ri1.reason.failure.code === 'PRIVMASK_NON_TEXT_BLOCKED' && ri1.received === null, JSON.stringify(ri1.reason));
const ri2 = await Hi.run([{ type: 'file', name: 'x.pdf', content: mB64 }]);
t('M2 file 块同样拦截', ri2.reason.kind === 'error' && ri2.received === null, JSON.stringify(ri2.reason));
const Hs = imageHarness({ nonTextPolicy: 'strip' });
const rs1 = await Hs.run([{ type: 'text', text: '描述图片' }, { type: 'image', image: mB64 }]);
t('M3 strip-移除图片块只留文本', rs1.received !== null && rs1.received.messages[0].content.length === 1 && rs1.received.messages[0].content[0].type === 'text', JSON.stringify(rs1.received.messages[0].content));
const Ha = imageHarness({ nonTextPolicy: 'allow' });
const ra1 = await Ha.run([{ type: 'text', text: '描述图片' }, { type: 'image', image: mB64 }]);
t('M4 allow-图片原样放行', ra1.received !== null && ra1.received.messages[0].content.length === 2, JSON.stringify(ra1.received.messages[0].content.map((b) => b.type)));
const rt1 = await Hi.run([{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'image', image: mB64 }] }]);
t('M5 tool-result 内图片拦截', rt1.reason.kind === 'error' && rt1.received === null, JSON.stringify(rt1.reason));

// N. 严格模式：未检查字段/异常默认拦截（failClosed 与 strictUnknown 默认开）
function rawHarness(config) {
  let listener = null;
  let received = null;
  const llmStub = { stream(o) { received = o; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); } };
  const ctx = { on(n, f) { if (n === 'llm/stream') listener = f; return () => {}; }, get(n) { return n === 'llm' ? llmStub : undefined; } };
  apply(ctx, config);
  return {
    async run(options) {
      received = null;
      let reason = null;
      const gen = listener(options, () => { received = options; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); });
      for await (const ev of gen) { if (ev.type === 'finish') reason = ev.reason; }
      return { reason, received };
    },
  };
}
const HR = rawHarness({});
const baseOpts = () => ({ provider: 't', model: 'm', sessionId: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
const nr1 = await HR.run({ ...baseOpts(), mystery: new (class UnknownThing {})() });
t('N1 默认拦截未知非普通字段', nr1.reason.kind === 'error' && nr1.reason.failure && nr1.reason.failure.code === 'PRIVMASK_REDACTION_FAILED' && nr1.received === null, JSON.stringify(nr1.reason));
const nr2 = await HR.run({ ...baseOpts(), extra: { note: '邮箱 ' + S.email } });
t('N2 额外字段内容脱敏', nr2.received !== null && nr2.received.extra && nr2.received.extra.note.includes('[REDACTED_EMAIL_') && !nr2.received.extra.note.includes(S.email), JSON.stringify(nr2.received.extra));
const HR2 = rawHarness({ strictUnknown: false });
const nr3 = await HR2.run({ ...baseOpts(), mystery: new (class UnknownThing {})() });
t('N3 strictUnknown=false 跳过未知字段', nr3.received !== null, JSON.stringify(nr3.reason));
const nr4 = await HR.run({ ...baseOpts(), extraList: [S.email, '普通文本'] });
t('N4 额外数组字段脱敏', nr4.received !== null && !nr4.received.extraList.includes(S.email) && nr4.received.extraList[0].includes('[REDACTED_EMAIL_'), JSON.stringify(nr4.received.extraList));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail > 0 ? 1 : 0;
