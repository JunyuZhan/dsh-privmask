import test from 'node:test';
// dsh-privmask 可靠性测试（数据全部码点/碎片构造，源码无敏感字面）
import { apply } from '../lib/index.js';
test('dsh-privmask reliability', async () => {

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
t('D1 伪造身份证18-上下文仍脱敏', (await H.dispatch(S.sfz + S.idFake)).includes('[REDACTED_ID18_'));
t('D1b 伪造身份证18-无上下文严格放行', (await H.dispatch(S.idFake)).includes(S.idFake));
t('D2 17位数字', (await H.dispatch('编号 ' + S.id17)) === '编号 ' + S.id17);
t('D3 20位数字', (await H.dispatch('编号 ' + S.id20)) === '编号 ' + S.id20);
t('D4 15位无上下文', (await H.dispatch('编号 ' + S.id15)) === '编号 ' + S.id15);
// 严格模式（默认）：校验位错误 → 放行（避免误伤订单号等）
// 宽松模式（strictId18=false）：校验位错误但日期段合理、或带「身份证号」上下文 → 脱敏
const idShaped = '522424198502122536'; // 校验位错误（应为 8，实际 6），日期段 19850212 合法
const Hr = makeHarness({ strictId18: false });
const d5 = await Hr.dispatch('号码 ' + idShaped);
t('D5 宽松-校验位错但日期合理仍脱敏', d5.includes('[REDACTED_ID18_') && !d5.includes(idShaped), d5);
const d6 = await Hr.dispatch('身份证号 ' + idShaped);
t('D6 宽松-上下文明确-校验位错仍脱敏', d6.includes('[REDACTED_ID18_') && !d6.includes(idShaped), d6);
const d7 = await Hr.dispatch('号码 12345678901234567X'); // 日期段 78901234 不合法
t('D7 宽松-非身份证形态不脱敏', d7.includes('12345678901234567X'), d7);

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
t('H1 性能-150KB敏感文本', cost < 1000, cost + 'ms');
const t0b = Date.now();
await H.dispatch('这是一段没有任何敏感信息的普通法律文书文本，反复出现以填充长度。'.repeat(4000));
const costPlain = Date.now() - t0b;
t('H2 性能-纯文本100KB快速路径', costPlain < 500, costPlain + 'ms');

// I. 姓名边界回归（漏检 / 吞字）
const Hf = makeHarness({}); // 默认隐私配置（姓名/公司/机关脱敏）下测试
const sfName = cn(0x5f20, 0x4e09, 0x4e30); // 张三丰
const legal = await Hf.dispatch(S.yg + S.name1 + S.rw + S.bg + S.name2 + '的' + '行为违法');
t('I1 姓名不吞字-认为/的行为保留', legal.includes(S.rw) && legal.includes('的' + '行为') && legal.includes('[REDACTED_NAME_') && !legal.includes(S.name1) && !legal.includes(S.name2), legal);
const sanfeng = await Hf.dispatch('被告' + sfName + '的合同');
t('I2 三字名+的（不漏检不吞的）', sanfeng.includes('[REDACTED_NAME_') && !sanfeng.includes(sfName) && sanfeng.includes('的'), sanfeng);
const zsOnly = await Hf.dispatch(S.yg + S.name1 + '与' + '被告' + S.name2 + '协商');
t('I3 姓名+与', zsOnly.includes('[REDACTED_NAME_') && zsOnly.includes('与') && !zsOnly.includes(S.name1) && !zsOnly.includes(S.name2), zsOnly);
// 姓名排除判断曾使用 NAME_EXCLUDE.startsWith(first)（死代码），回归：方/任 等常见姓不得被误排除
const rn1 = await Hf.dispatch('原告' + cn(0x65b9, 0x660e) + '的合同'); // 方明
t('I4 姓氏方不误排除', rn1.includes('[REDACTED_NAME_') && !rn1.includes(cn(0x65b9, 0x660e)), rn1);
const rn2 = await Hf.dispatch('被告' + cn(0x4efb, 0x5f3a) + '违约'); // 任强
t('I5 姓氏任不误排除', rn2.includes('[REDACTED_NAME_') && !rn2.includes(cn(0x4efb, 0x5f3a)), rn2);
const rn3 = await Hf.dispatch('原告 ' + S.name1 + ' 的合同');
t('I6 上下文后带空格', rn3.includes('[REDACTED_NAME_') && !rn3.includes(S.name1), rn3);
const rn4 = await Hf.dispatch('法定代表人是' + sfName);
t('I7 系动词衔接', rn4.includes('[REDACTED_NAME_') && !rn4.includes(sfName), rn4);
const rn5 = await Hf.dispatch('委托人：' + S.name2);
t('I8 委托人角色词', rn5.includes('[REDACTED_NAME_') && !rn5.includes(S.name2), rn5);
// 常见姓缺失（詹）与 2 字名+动词边界（离婚/诉）回归
const zhanYongfei = cn(0x8a79, 0x6c38, 0x98de); // 詹永飞
const liLi = cn(0x674e, 0x4e3d); // 李丽
const rn6 = await Hf.dispatch('原告' + zhanYongfei + '与被告' + liLi + '离婚纠纷一案');
t('I9 詹姓识别+离婚边界', rn6.includes('[REDACTED_NAME_') && !rn6.includes(zhanYongfei) && !rn6.includes(liLi), rn6);
const rn7 = await Hf.dispatch('原告' + zhanYongfei + '诉被告' + liLi + '离婚');
t('I10 诉/离婚边界', rn7.includes('[REDACTED_NAME_') && !rn7.includes(zhanYongfei) && !rn7.includes(liLi), rn7);

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
const rk1 = await Hf.dispatch('查询' + coName + '的工商信息');
t('K1 公司名不吞查询', rk1.includes('查询') && rk1.includes('[REDACTED_COMPANY_') && !rk1.includes(coName), rk1);
const rk2 = await Hf.dispatch('委托' + courtName + '代理');
t('K2 机关不吞委托', rk2.includes('委托') && rk2.includes('[REDACTED_ORG_') && !rk2.includes(courtName), rk2);
const rk3 = await H.dispatch('aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
t('K3 AWS secret key', rk3.includes('[REDACTED_KEY_') && !rk3.includes('wJalrXUtnFEMI'), rk3);
// 公司识别：无地区/行业关键词的常见大公司（集团后缀 / 技术行业词）
const coAlibaba = cn(0x963f, 0x91cc, 0x5df4, 0x5df4, 0x96c6, 0x56e2); // 阿里巴巴集团
const coHuawei = cn(0x534e, 0x4e3a, 0x6280, 0x672f, 0x6709, 0x9650, 0x516c, 0x53f8); // 华为技术有限公司
const rk4 = await Hf.dispatch('与' + coAlibaba + '签订合同');
t('K4 集团后缀公司识别', rk4.includes('[REDACTED_COMPANY_') && !rk4.includes(coAlibaba), rk4);
const rk5 = await Hf.dispatch('与' + coHuawei + '签订合同');
t('K5 技术行业词公司识别', rk5.includes('[REDACTED_COMPANY_') && !rk5.includes(coHuawei), rk5);

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
t('M1 默认剥离图片块只留文本', ri1.received !== null && ri1.received.messages[0].content.length === 1 && ri1.received.messages[0].content[0].type === 'text' && !JSON.stringify(ri1.received).includes(mB64), JSON.stringify(ri1.received.messages[0].content));
const Hblk = imageHarness({ nonTextPolicy: 'block' });
const rb1 = await Hblk.run([{ type: 'image', image: mB64 }]);
t('M2 block 策略拦截图片', rb1.reason.kind === 'error' && rb1.reason.failure && rb1.reason.failure.code === 'PRIVMASK_NON_TEXT_BLOCKED' && rb1.received === null, JSON.stringify(rb1.reason));
const ri2 = await Hi.run([{ type: 'file', name: 'x.pdf', content: mB64 }]);
t('M3 file 块默认剥离', ri2.received !== null && !JSON.stringify(ri2.received).includes(mB64), JSON.stringify(ri2.received.messages[0].content));
const Hs = imageHarness({ nonTextPolicy: 'strip' });
const rs1 = await Hs.run([{ type: 'text', text: '描述图片' }, { type: 'image', image: mB64 }]);
t('M4 strip-显式移除图片块只留文本', rs1.received !== null && rs1.received.messages[0].content.length === 1 && rs1.received.messages[0].content[0].type === 'text', JSON.stringify(rs1.received.messages[0].content));
const Ha = imageHarness({ nonTextPolicy: 'allow' });
const ra1 = await Ha.run([{ type: 'text', text: '描述图片' }, { type: 'image', image: mB64 }]);
t('M5 allow-图片原样放行', ra1.received !== null && ra1.received.messages[0].content.length === 2, JSON.stringify(ra1.received.messages[0].content.map((b) => b.type)));
const rt1 = await Hi.run([{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'image', image: mB64 }] }]);
t('M6 tool-result 内图片默认剥离', rt1.received !== null && !JSON.stringify(rt1.received).includes(mB64), JSON.stringify(rt1.received.messages[0].content));

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
const nr5 = await HR.run({ ...baseOpts(), extra: { buf: Buffer.from('sk-supersecretvalue123') } });
t('N5 默认拦截嵌套非普通对象', nr5.reason.kind === 'error' && nr5.reason.failure && nr5.reason.failure.code === 'PRIVMASK_REDACTION_FAILED' && nr5.received === null, JSON.stringify(nr5.reason));
const HR3 = rawHarness({ strictUnknown: false });
const nr6 = await HR3.run({ ...baseOpts(), extra: { buf: Buffer.from('sk-supersecretvalue123') } });
t('N6 strictUnknown=false 跳过嵌套非普通对象', nr6.received !== null, JSON.stringify(nr6.reason));

// O. 模拟真实 dsh 环境（深冻结 + agent-loop WeakSet 标记 + 不变式 + checkpoint 水瀑）
function dshSimHarness(config) {
  const hooks = [];
  const AGENT_LOOP = new WeakSet();
  let received = null;
  let checkpointCount = 0;
  let invariantFailures = [];

  function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof AbortSignal || seen.has(value)) return value;
    seen.add(value);
    Object.freeze(value);
    for (const k of Object.keys(value)) deepFreeze(value[k], seen);
    return value;
  }

  const llmStub = {
    stream(options) {
      // 只有真正到达 adapter（最内层）才记录，用于断言「未触达适配器」
      const inner = () => {
        received = options;
        return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })();
      };
      const cbs = hooks.slice().map((r) => r.callback);
      const runNext = () => {
        const cb = cbs.shift();
        return cb ? cb.call(null, options, runNext) : inner();
      };
      return runNext();
    },
  };
  const ctx = {
    on(name, fn, opts = {}) {
      if (name !== 'llm/stream') return () => {};
      const rec = { callback: fn };
      if (opts.prepend) hooks.unshift(rec); else hooks.push(rec);
      return () => {
        const i = hooks.indexOf(rec);
        if (i >= 0) hooks.splice(i, 1);
      };
    },
    get(name) { return name === 'llm' ? llmStub : undefined; },
  };
  // 模拟 agent-loop/llm 不变式（prepend+global）：只校验被标记的原请求
  ctx.on('llm/stream', (options, next) => {
    if (!AGENT_LOOP.has(options)) return next();
    if (!Object.isFrozen(options)) invariantFailures.push('request not frozen');
    if (!Object.isFrozen(options.messages)) invariantFailures.push('messages not frozen');
    return next();
  }, { prepend: true });
  // 模拟 checkpoint（在插件之前注册，带 sessionId 时包装 next）
  ctx.on('llm/stream', (options, next) => {
    if (options.sessionId === undefined) return next();
    checkpointCount += 1;
    return (async function* () { yield* next(); })();
  });
  apply(ctx, config);

  return {
    async run(options) {
      received = null;
      checkpointCount = 0;
      invariantFailures = [];
      const frozen = deepFreeze(options);
      AGENT_LOOP.add(frozen);
      const gen = llmStub.stream(frozen);
      let reason = null;
      for await (const ev of gen) { if (ev.type === 'finish') reason = ev.reason; }
      return { reason, received, checkpointCount, invariantFailures, original: frozen };
    },
  };
}
const DS = dshSimHarness({});
const baseDsh = () => ({ provider: 't', model: 'm', sessionId: 'sess-dsh', messages: [{ role: 'user', content: [{ type: 'text', text: '邮箱 ' + S.email }] }] });
const od1 = await DS.run(baseDsh());
t('O1 冻结原请求不变式通过', od1.invariantFailures.length === 0, JSON.stringify(od1.invariantFailures));
t('O2 适配器收到脱敏副本', od1.received !== null && od1.received !== od1.original && od1.received.messages[0].content[0].text.includes('[REDACTED_EMAIL_') && !od1.received.messages[0].content[0].text.includes(S.email), JSON.stringify(od1.received.messages[0].content[0].text));
t('O3 会话头被移除', od1.received.sessionId === undefined);
t('O4 checkpoint 只跑一次', od1.checkpointCount === 1, 'count=' + od1.checkpointCount);
t('O5 原请求保持原文且仍冻结', od1.original.messages[0].content[0].text.includes(S.email) && Object.isFrozen(od1.original) && Object.isFrozen(od1.original.messages), od1.original.messages[0].content[0].text);
const od2 = await DS.run({ ...baseDsh(), purpose: 'compaction' });
t('O6 compaction 调用同样脱敏', od2.received !== null && od2.received.messages[0].content[0].text.includes('[REDACTED_EMAIL_'), od2.received.messages[0].content[0].text);
const DS2 = dshSimHarness({});
const od3 = await DS2.run({ ...baseDsh(), mystery: new (class UnknownThing {})() });
t('O7 严格模式异常→错误流且不触达适配器', od3.reason.kind === 'error' && od3.reason.failure && od3.reason.failure.code === 'PRIVMASK_REDACTION_FAILED' && od3.received === null, JSON.stringify(od3.reason));

// P. 入站还原：云端返回的占位符在本地还原为原值（响应/工具参数）
function inboundHarness(config, cannedChunks) {
  let listener = null;
  let received = null;
  const llmStub = {
    stream(options) {
      received = options;
      return (async function* () {
        for (const c of cannedChunks) yield c;
      })();
    },
  };
  const ctx = { on(n, f) { if (n === 'llm/stream') listener = f; return () => {}; }, get(n) { return n === 'llm' ? llmStub : undefined; } };
  apply(ctx, config);
  return {
    async run(text, opts) {
      received = null;
      const options = { provider: 't', model: 'm', sessionId: 's', messages: [{ role: 'user', content: [{ type: 'text', text }] }], ...(opts || {}) };
      const gen = listener(options, () => (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })());
      const out = [];
      for await (const ev of gen) out.push(ev);
      return { out, received };
    },
  };
}
const P_EMAIL = 'restore@privmask-test.com';
const P_PH = '[REDACTED_EMAIL_1]';
const P_canned = [
  { type: 'text-delta', index: 0, text: '好的，邮箱 ' + P_PH + ' 已记住' },
  { type: 'block-end', index: 0, block: { type: 'text', text: '好的，邮箱 ' + P_PH + ' 已记住' } },
  { type: 'tool-call-delta', index: 1, id: 'c1', name: 'write_file', argumentsDelta: '{"content":"邮箱 ' + P_PH + '"}' },
  { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'c1', name: 'write_file', arguments: '{"content":"邮箱 ' + P_PH + '"}' } },
  { type: 'finish', reason: { kind: 'stop' } },
];
const HI = inboundHarness({}, P_canned);
const pi1 = await HI.run('邮箱 ' + P_EMAIL);
const joined1 = pi1.out.map((c) => c.text || (c.block ? (c.block.text || c.block.arguments || '') : '')).join('|');
t('P1 默认还原响应文本', !joined1.includes(P_PH) && joined1.includes(P_EMAIL), joined1);
const toolArgs1 = pi1.out.find((c) => c.type === 'block-end' && c.block.type === 'tool-call').block.arguments;
t('P2 默认还原工具参数', !toolArgs1.includes(P_PH) && toolArgs1.includes(P_EMAIL), toolArgs1);
const HI2 = inboundHarness({ restoreInbound: false }, P_canned);
const pi2 = await HI2.run('邮箱 ' + P_EMAIL);
const joined2 = pi2.out.map((c) => c.text || (c.block ? (c.block.text || c.block.arguments || '') : '')).join('|');
t('P3 关闭还原-保留占位符', joined2.includes(P_PH) && !joined2.includes(P_EMAIL), joined2);
// P4/P5：字符串 content（非块数组）的展示层还原（历史记录/tool-result 兼容路径）
const { restoreWireData, restoreBlocksForDisplay } = await import('../lib/restore.js');
const P_entries = [[P_PH, P_EMAIL]];
const P_wireStr = restoreWireData({ message: { role: 'user', content: '邮箱 ' + P_PH } }, P_entries);
t('P4 字符串 content 还原', P_wireStr.message.content === '邮箱 ' + P_EMAIL, JSON.stringify(P_wireStr));
const P_toolStr = restoreBlocksForDisplay([{ type: 'tool-result', toolCallId: 'c1', content: '结果 ' + P_PH }], P_entries);
t('P5 tool-result 字符串 content 还原', P_toolStr[0].content === '结果 ' + P_EMAIL, JSON.stringify(P_toolStr));

// Q. 类别级脱敏策略（默认：凭据/地址/姓名/公司/机关脱敏；案号/出生日期/金额保留）
const q1 = await H.dispatch('原告 ' + S.name1 + ' 与 被告 ' + S.name2 + ' 的合同纠纷');
t('Q1 默认姓名脱敏', q1.includes('[REDACTED_NAME_') && !q1.includes(S.name1) && !q1.includes(S.name2), q1);
const q2 = await H.dispatch('密钥 ' + S.sk);
t('Q2 默认凭据脱敏', q2.includes('[REDACTED_KEY_') && !q2.includes(S.sk), q2);
const qAddr = cn(0x4f4f, 0x5740, 0xff1a) + cn(0x5e7f, 0x4e1c, 0x7701, 0x6df1, 0x5733, 0x5e02, 0x5357, 0x5c71, 0x533a, 0x7ca4, 0x6d77, 0x8857, 0x9053); // 住址：广东省深圳市南山区粤海街道
const q3 = await H.dispatch(qAddr);
t('Q3 默认地址脱敏', q3.includes('[REDACTED_ADDR') && !q3.includes(cn(0x5e7f, 0x4e1c, 0x7701)), q3);
const Hq4 = makeHarness({ redactAddress: false });
const q4 = await Hq4.dispatch(qAddr);
t('Q4 关闭地址脱敏-保留地址', q4.includes(cn(0x5e7f, 0x4e1c, 0x7701)), q4);
const Hq5 = makeHarness({ redactCredentials: false });
const q5 = await Hq5.dispatch('密钥 ' + S.sk);
t('Q5 关闭凭据脱敏-保留密钥', q5.includes(S.sk), q5);
const Hq6 = makeHarness({ redactNames: false });
const q6 = await Hq6.dispatch('原告 ' + S.name1 + '，被告 ' + S.name2);
t('Q6 关闭姓名脱敏-保留姓名', q6.includes(S.name1) && q6.includes(S.name2), q6);
const q7 = await H.dispatch('与' + coName + '签订合同');
t('Q7 默认公司脱敏', q7.includes('[REDACTED_COMPANY_') && !q7.includes(coName), q7);
const q8 = await H.dispatch('向' + courtName + '起诉');
t('Q8 默认机关脱敏', q8.includes('[REDACTED_ORG_') && !q8.includes(courtName), q8);
const qCase = '（2024）粤01民初123号';
const q9 = await H.dispatch(qCase);
t('Q9 默认案号保留', q9.includes(qCase), q9);
const Hq9 = makeHarness({ redactCaseNumbers: true });
const q9b = await Hq9.dispatch(qCase);
t('Q10 开启案号脱敏', q9b.includes('[REDACTED_CASE_') && !q9b.includes(qCase), q9b);
const qDob = '出生日期：1985年2月12日';
const q10 = await H.dispatch(qDob);
t('Q11 默认出生日期保留', q10.includes(qDob), q10);
const Hq10 = makeHarness({ redactDob: true });
const q10b = await Hq10.dispatch(qDob);
t('Q12 开启出生日期脱敏', q10b.includes('[REDACTED_DOB_') && !q10b.includes('1985年2月12日'), q10b);

// R. 占位符编号单调：单类别超过上限（2000）逐出最旧条目，编号绝不复用
const HM = makeHarness({ logRedactions: false });
const rEmail = (i) => 'mono' + i + '@privmask-test.com';
let rlast = '';
for (let i = 1; i <= 2001; i++) rlast = await HM.dispatch('邮箱 ' + rEmail(i));
t('R1 超限后编号不复用', rlast.includes('[REDACTED_EMAIL_2001]') && !rlast.includes('[REDACTED_EMAIL_1]'), rlast);
const rAgain = await HM.dispatch('邮箱 ' + rEmail(1));
t('R2 旧值重新编号仍唯一', rAgain.includes('[REDACTED_EMAIL_2002]') && !rAgain.includes('[REDACTED_EMAIL_1]'), rAgain);

// S. 交叉规则幂等：公司占位符紧邻街道时，第二轮不得产生新匹配（曾因左边界环视被替换文本改变而破坏幂等）
const HS = makeHarness({ logRedactions: false });
const s1 = await HS.dispatch('中国人民银行深圳市分行南山路');
const s2 = await HS.dispatch(s1);
t('S1 公司+街道交叉幂等', s1 === s2 && s1.includes('[REDACTED_COMPANY_') && !s1.includes('中国人民银行') && !s1.includes('[REDACTED_STREET_'), s1);
const s3 = await HS.dispatch('南山路12号');
t('S2 街道独立识别不受影响', s3.includes('[REDACTED_STREET_') && !s3.includes('南山路12号'), s3);

// T. 日志脱敏（方案2）：agent/pre-step 用户消息 + tools/post-execute 工具结果在落盘前遮罩
function logMaskHarness(config) {
  let preStep = null, postExec = null, ptcLog = null, llmFn = null, received = null;
  const llmStub = { stream(o) { received = o; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); } };
  const ctx = {
    on(name, fn) {
      if (name === 'agent/pre-step') preStep = fn;
      else if (name === 'tools/post-execute') postExec = fn;
      else if (name === 'tools/ptc-dispatch-log') ptcLog = fn;
      else if (name === 'llm/stream') llmFn = fn;
      return () => {};
    },
    get(n) { return n === 'llm' ? llmStub : undefined; },
  };
  apply(ctx, config);
  return {
    async preStep(sessionId, messages) {
      return preStep({ agent: { session: { id: sessionId } }, messages: [] }, async () => ({ kind: 'enter', messages }));
    },
    async postExecute(sessionId, name, content) {
      return postExec({ name, agent: { session: { id: sessionId } } }, {}, async () => ({ kind: 'accept', content }));
    },
    async ptcDispatch(sessionId, name, content) {
      return ptcLog({ name, agent: { session: { id: sessionId } }, exec: { agent: { session: { id: sessionId } } }, content }, async () => content);
    },
    async llm(text, sessionId, extra = {}) {
      received = null;
      const opts = { provider: 't', model: 'm', sessionId, messages: [{ role: 'user', content: [{ type: 'text', text }] }], ...extra };
      const gen = llmFn(opts, () => { received = opts; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); });
      for await (const _ of gen) {}
      return received;
    },
  };
}
const LT = logMaskHarness({ logRedactions: false });
const tMsg = [{ role: 'user', content: [{ type: 'text', text: '邮箱 ' + S.email + '，电话 ' + S.phone }] }];
const td1 = await LT.preStep('sess-T', tMsg);
t('T1 pre-step 用户消息落盘遮罩', td1.kind === 'enter' && td1.messages[0].content[0].text.includes('[REDACTED_EMAIL_') && !td1.messages[0].content[0].text.includes(S.email) && !td1.messages[0].content[0].text.includes(S.phone), td1.messages[0].content[0].text);
const tNoPii = [{ role: 'user', content: [{ type: 'text', text: '普通文本' }] }];
const td2 = await LT.preStep('sess-T', tNoPii);
t('T2 无敏感内容-决策原样返回', td2.messages === tNoPii, 'identity=' + (td2.messages === tNoPii));
const LTstrip = logMaskHarness({ logRedactions: false });
const td3 = await LTstrip.preStep('sess-T', [{ role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image', image: 'aGVsbG8=' }] }]);
t('T3 strip-图片块不入日志', td3.messages[0].content.length === 1 && td3.messages[0].content[0].type === 'text', JSON.stringify(td3.messages[0].content));
const LTblock = logMaskHarness({ logRedactions: false, nonTextPolicy: 'block' });
const td4 = await LTblock.preStep('sess-T', [{ role: 'user', content: [{ type: 'image', image: 'aGVsbG8=' }] }]);
t('T4 block-拒绝步骤', td4.kind === 'reject', JSON.stringify(td4));
const td5 = await LT.postExecute('sess-T', 'write_file', [{ type: 'text', text: '写入 ' + S.email }]);
t('T5 工具结果落盘遮罩', td5.kind === 'accept' && td5.content[0].text.includes('[REDACTED_EMAIL_') && !td5.content[0].text.includes(S.email), JSON.stringify(td5.content));
const LTstrip2 = logMaskHarness({ logRedactions: false });
const td6 = await LTstrip2.postExecute('sess-T', 'lookup', [{ type: 'text', text: '结果' }, { type: 'image', image: 'aGVsbG8=' }]);
t('T6 工具结果 strip-图片移除', td6.content.length === 1 && td6.content[0].type === 'text', JSON.stringify(td6.content));
// 映射一致性：pre-step 与 llm/stream 共用会话映射，同值同号
const LT2 = logMaskHarness({ logRedactions: false });
const td7 = await LT2.preStep('sess-T2', [{ role: 'user', content: [{ type: 'text', text: '邮箱 ' + S.email }] }]);
const masked = td7.messages[0].content[0].text;
const td8 = await LT2.llm(masked, 'sess-T2', { system: '联系 ' + S.email });
t('T7 跨钩子同值同号', td8.system.includes('[REDACTED_EMAIL_1]') && td8.messages[0].content[0].text.includes('[REDACTED_EMAIL_1]') && !td8.system.includes(S.email), JSON.stringify(td8.system));
const td9 = await LT2.llm('绕过 pre-step 的调用 ' + S.email, 'sess-T2');
t('T8 llm/stream 兜底仍脱敏', td9.messages[0].content[0].text.includes('[REDACTED_EMAIL_') && !td9.messages[0].content[0].text.includes(S.email), td9.messages[0].content[0].text);
const td10 = await LT.ptcDispatch('sess-T', 'run_code', [{ type: 'text', text: '子派发结果 ' + S.email }]);
t('T9 ptc-dispatch-log 子派发落盘遮罩', td10[0].text.includes('[REDACTED_EMAIL_') && !td10[0].text.includes(S.email), JSON.stringify(td10));
const LTptc = logMaskHarness({ logRedactions: false });
const td11 = await LTptc.ptcDispatch('sess-T', 'run_code', [{ type: 'text', text: '结果' }, { type: 'image', image: 'aGVsbG8=' }]);
t('T10 ptc-dispatch-log strip-图片移除', td11.length === 1 && td11[0].type === 'text', JSON.stringify(td11));
const LTptcB = logMaskHarness({ logRedactions: false, nonTextPolicy: 'block' });
const td12 = await LTptcB.ptcDispatch('sess-T', 'run_code', [{ type: 'image', image: 'aGVsbG8=' }]);
t('T11 ptc-dispatch-log block-安全标记替换', td12.length === 1 && td12[0].text.includes('已拦截') && !td12[0].text.includes('aGVsbG8='), JSON.stringify(td12));

// U. 展示层还原：包装 sessionController.page/follow，浏览器读取时还原占位符（日志仍为占位符）
function displayHarness(config) {
  let preStep = null;
  const records = () => [
    { type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '邮箱 [REDACTED_EMAIL_1]' }] } } },
    { type: 'event', event: { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text: '已记住 [REDACTED_EMAIL_1]' }] } } } },
  ];
  const fakeSC = {
    page: async () => ({ records: records(), hasMore: false }),
    follow: async function* () { yield { type: 'snapshot', records: records(), cursor: 0, header: {}, hasMore: false, projections: {} }; },
    control: async function* () {
      yield { type: 'baseline', value: { queues: { 'sess-U': [{ id: 'q1', placement: 'queued', message: { id: 'q1', content: [{ type: 'text', text: '邮箱 [REDACTED_EMAIL_1]' }] } }] }, jobs: {}, projections: {} } };
      yield { type: 'queue', sessionId: 'sess-U', items: [{ id: 'q2', placement: 'queued', message: { id: 'q2', content: [{ type: 'text', text: '邮箱 [REDACTED_EMAIL_1]' }] } }] };
    },
  };
  const ctx = {
    on(name, fn) { if (name === 'agent/pre-step') preStep = fn; return () => {}; },
    get(n) { return n === 'llm' ? { stream() { return (async function* () {})(); } } : n === 'sessionController' ? fakeSC : undefined; },
  };
  apply(ctx, config);
  return {
    async mask(sessionId, text) {
      await preStep({ agent: { session: { id: sessionId } }, messages: [] }, async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text }] }] }));
    },
    get sc() { return fakeSC; },
  };
}
const DU = displayHarness({ logRedactions: false });
await DU.mask('sess-U', '邮箱 display@privmask-test.com');
const du1 = await DU.sc.page({ address: { kind: 'session', sessionId: 'sess-U' }, throughSeq: 0 });
t('U1 展示层还原-用户消息', du1.records[0].event.data.content[0].text.includes('display@privmask-test.com') && !du1.records[0].event.data.content[0].text.includes('REDACTED_EMAIL_1'), JSON.stringify(du1.records[0].event.data.content[0].text));
t('U2 展示层还原-assistant消息', du1.records[1].event.data.message.content[0].text.includes('display@privmask-test.com') && !du1.records[1].event.data.message.content[0].text.includes('REDACTED_EMAIL_1'), JSON.stringify(du1.records[1].event.data.message.content[0].text));
let u3ok = false;
for await (const f of DU.sc.follow({ address: { kind: 'session', sessionId: 'sess-U' } })) {
  if (f.type === 'snapshot') u3ok = f.records[0].event.data.content[0].text.includes('display@privmask-test.com') && !f.records[0].event.data.content[0].text.includes('REDACTED_EMAIL_1');
}
t('U3 展示层还原-follow快照', u3ok);
const DU2 = displayHarness({ logRedactions: false, restoreInbound: false });
await DU2.mask('sess-U2', '邮箱 display@privmask-test.com');
const du2 = await DU2.sc.page({ address: { kind: 'session', sessionId: 'sess-U2' }, throughSeq: 0 });
t('U4 restoreInbound=false 展示不还原', du2.records[0].event.data.content[0].text.includes('REDACTED_EMAIL_1') && !du2.records[0].event.data.content[0].text.includes('display@privmask-test.com'), JSON.stringify(du2.records[0].event.data.content[0].text));
let u5ok = false, u6ok = false;
for await (const f of DU.sc.control()) {
  if (f.type === 'baseline') u5ok = f.value.queues['sess-U'][0].message.content[0].text.includes('display@privmask-test.com');
  if (f.type === 'queue') u6ok = f.items[0].message.content[0].text.includes('display@privmask-test.com') && !f.items[0].message.content[0].text.includes('REDACTED_EMAIL_1');
}
t('U5 展示层还原-control baseline队列', u5ok);
t('U6 展示层还原-control queue帧', u6ok);

// W. 评审修复回归：Config 校验 / 自定义词表 / 白名单 / delta 跨分片重组
let w1 = false;
try { apply({}, { nonTextPolicy: 'x' }); } catch { w1 = true; }
t('W1 非法配置响亮失败', w1);
let w2 = false;
try { apply({}, { enabled: 'false' }); } catch { w2 = true; }
t('W2 字符串布尔拒绝', w2);
const HW = makeHarness({ logRedactions: false, customTerms: ['欧阳雪'] });
const w3 = await HW.dispatch('欧阳雪今天来访');
t('W3 自定义词表无上下文脱敏', w3.includes('[REDACTED_CUSTOM_') && !w3.includes('欧阳雪'), w3);
const w4 = await HW.dispatch('欧阳雪儿是另一个名字');
t('W4 词表精确子串命中长词', w4.includes('[REDACTED_CUSTOM_') && !w4.includes('欧阳雪'), w4);
const HW2 = makeHarness({ logRedactions: false, preserveValues: ['test@example.com'] });
const w5 = await HW2.dispatch('联系 test@example.com');
t('W5 白名单放行', w5.includes('test@example.com') && !w5.includes('REDACTED_EMAIL_'), w5);
const W_SPLIT = [
  { type: 'text-delta', index: 0, text: '好的，邮箱 [REDACTED_EMA' },
  { type: 'text-delta', index: 0, text: 'IL_1] 已记住' },
  { type: 'block-end', index: 0, block: { type: 'text', text: '好的，邮箱 [REDACTED_EMAIL_1] 已记住' } },
  { type: 'finish', reason: { kind: 'stop' } },
];
const HW3 = inboundHarness({}, W_SPLIT);
const w6 = await HW3.run('邮箱 restore@privmask-test.com');
const joinedW = w6.out.filter((c) => c.type === 'text-delta').map((c) => c.text).join('');
t('W6 delta 跨分片重组还原', joinedW.includes('restore@privmask-test.com') && !joinedW.includes('REDACTED_EMA'), joinedW);

// V. 版本/载荷兼容矩阵：钩子对异形 payload 优雅降级 + emit 缝
function compatHarness(config, extraGet) {
  let preStep = null, postExec = null, llmFn = null;
  const emitted = [];
  const ctx = {
    on(n, f) {
      if (n === 'agent/pre-step') preStep = f;
      else if (n === 'tools/post-execute') postExec = f;
      else if (n === 'llm/stream') llmFn = f;
      return () => {};
    },
    get(n) {
      if (n === 'llm') return { stream() { return (async function* () {})(); } };
      return extraGet ? extraGet(n) : undefined;
    },
    emit(n, p) { emitted.push([n, p]); },
  };
  apply(ctx, config);
  return { preStep, postExec, llmFn, emitted };
}
const VC = compatHarness({ logRedactions: false });
const vDecision = { kind: 'accept', value: { ok: 1 } };
const v1 = await VC.postExec({ name: 't', agent: { session: { id: 's' } } }, {}, async () => vDecision);
t('V1 value型工具决策原样放行', v1 === vDecision);
const vReject = { kind: 'reject' };
const v2 = await VC.preStep({ agent: { session: { id: 's' } }, messages: [] }, async () => vReject);
t('V2 reject决策原样放行', v2 === vReject);
const VC2 = compatHarness({ logRedactions: false }, (n) => n === 'sessionController' ? { page: async () => ({}), follow: async function* () {} } : undefined);
t('V3 旧版 sessionController 无 control 优雅跳过', true);
// emit 缝：脱敏后发出结构化事件
const VC3 = compatHarness({ logRedactions: false });
const v3 = await VC3.llmFn({ provider: 't', model: 'm', sessionId: 's', messages: [{ role: 'user', content: [{ type: 'text', text: '邮箱 ' + S.email }] }] }, () => (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })());
for await (const _ of v3) {}
t('V4 emit 结构化事件', VC3.emitted.some(([name, p]) => name === 'privmask/stats' && p.kind === 'redacted' && p.fields >= 1), JSON.stringify(VC3.emitted));

// X. 运行时设置：dsh-settings 命名空间注册 + live 生效（引擎重建）
function settingsHarness(config) {
  let listener = null, received = null;
  let registered = null;
  let watchCb = null;
  let injectCb = null;
  const settings = {
    register(ns, schema, options) {
      registered = { ns, schema, options };
      return {
        get: () => options.base,
        watch: (cb) => { watchCb = cb; return () => {}; },
        update: async () => {},
      };
    },
  };
  const llmStub = { stream(o) { received = o; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); } };
  const ctx = {
    on(n, f) { if (n === 'llm/stream') listener = f; return () => {}; },
    get(n) { return n === 'llm' ? llmStub : n === 'settings' ? settings : undefined; },
    inject(deps, cb) { if (Array.isArray(deps) && deps.includes('settings')) injectCb = cb; return () => {}; },
    settings,
    emit() {},
  };
  apply(ctx, config);
  if (injectCb) injectCb({ settings });
  return {
    get registered() { return registered; },
    get watchCb() { return watchCb; },
    async dispatch(text) {
      received = null;
      const opts = { provider: 't', model: 'm', sessionId: 's', messages: [{ role: 'user', content: [{ type: 'text', text }] }] };
      const gen = listener(opts, () => { received = opts; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); });
      for await (const _ of gen) {}
      return received.messages[0].content[0].text;
    },
  };
}
const XH = settingsHarness({ logRedactions: false });
t('X1 settings 命名空间注册', XH.registered !== null && XH.registered.ns === 'privmask' && XH.registered.options.applies === 'live' && typeof XH.watchCb === 'function', JSON.stringify(XH.registered && XH.registered.ns));
const x1 = await XH.dispatch('邮箱 ' + S.email);
t('X2 初始配置生效-脱敏', x1.includes('[REDACTED_EMAIL_') && !x1.includes(S.email), x1);
// 模拟用户在界面关掉总开关：watch 触发 → 引擎重建 → 不再脱敏
await XH.watchCb({ enabled: false, redactNames: true, redactCompanies: true, redactOrgs: true, redactAddress: true, redactCredentials: true, logRedactions: false });
const x2 = await XH.dispatch('邮箱 ' + S.email);
t('X3 live 关闭总开关-不再脱敏', x2.includes(S.email) && !x2.includes('REDACTED_EMAIL_'), x2);
// 再打开
await XH.watchCb({ enabled: true, redactNames: true, redactCompanies: true, redactOrgs: true, redactAddress: true, redactCredentials: true, logRedactions: false });
const x3 = await XH.dispatch('邮箱 ' + S.email);
t('X4 live 重新开启-恢复脱敏', x3.includes('[REDACTED_EMAIL_') && !x3.includes(S.email), x3);
// X6: settings 更新带入 customTerms → 引擎重建 → 新词立即脱敏（词表热更新）
await XH.watchCb({ enabled: true, redactNames: true, redactCompanies: true, redactOrgs: true, redactAddress: true, redactCredentials: true, customTerms: ['欧阳雪'], logRedactions: false });
const x6 = await XH.dispatch('欧阳雪今天来访');
t('X6 词表热更新-新增词立即脱敏', x6.includes('[REDACTED_CUSTOM_') && !x6.includes('欧阳雪'), x6);

// X5: settings 服务晚于插件加载时，惰性重试注册命名空间
function lazySettingsHarness() {
  let llmFn = null;
  let settings = undefined;
  let registered = null;
  let watchCb = null;
  let injectCb = null;
  const ctx = {
    on(n, f) { if (n === 'llm/stream') llmFn = f; return () => {}; },
    get(n) {
      if (n === 'llm') return { stream() { return (async function* () {})(); } };
      if (n === 'settings') return settings;
      return undefined;
    },
    inject(deps, cb) { if (Array.isArray(deps) && deps.includes('settings')) injectCb = cb; return () => {}; },
    emit() {},
  };
  apply(ctx, { logRedactions: false });
  return {
    provideSettings() {
      settings = {
        register(ns, schema, options) {
          registered = { ns, options };
          return { get: () => options.base, watch: (cb) => { watchCb = cb; return () => {}; }, update: async () => {} };
        },
      };
      if (injectCb) injectCb({ settings });
    },
    get registered() { return registered; },
    get watchCb() { return watchCb; },
  };
}
const XL = lazySettingsHarness();
t('X5a apply 时 settings 不可用-未注册', XL.registered === null);
XL.provideSettings();
t('X5b 服务就绪后惰性注册', XL.registered !== null && XL.registered.ns === 'privmask' && XL.registered.options.applies === 'live' && typeof XL.watchCb === 'function', JSON.stringify(XL.registered && XL.registered.ns));

// Y. 入站还原与请求脱敏路径解耦：早退路径（无脱敏内容、保留 sessionId）也必须还原回复
function restoreEarlyPathHarness(config) {
  let preStep = null, llmFn = null;
  let cannedReply = null;
  const llmStub = { stream() { return (async function* () { for (const c of cannedReply) yield c; })(); } };
  const ctx = {
    on(n, f) { if (n === 'agent/pre-step') preStep = f; else if (n === 'llm/stream') llmFn = f; return () => {}; },
    get(n) { return n === 'llm' ? llmStub : undefined; },
  };
  apply(ctx, config);
  return {
    async mask(text) {
      const d = await preStep({ agent: { session: { id: 'sess-Y' } }, messages: [] }, async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text }] }] }));
      return d.messages[0].content[0].text;
    },
    async dispatch(maskedText) {
      const opts = { provider: 't', model: 'm', sessionId: 'sess-Y', messages: [{ role: 'user', content: [{ type: 'text', text: maskedText }] }] };
      const gen = llmFn(opts, () => (async function* () { for (const c of cannedReply) yield c; })());
      const out = [];
      for await (const c of gen) out.push(c);
      return out.map((c) => c.text || (c.block && c.block.text) || '').join('|');
    },
    setReply(r) { cannedReply = r; },
  };
}
const YH = restoreEarlyPathHarness({ logRedactions: false, dropSessionId: false });
const ymasked = await YH.mask('邮箱 ' + S.email);
YH.setReply([
  { type: 'text-delta', index: 0, text: '已记住 [REDACTED_EMAIL_1]' },
  { type: 'block-end', index: 0, block: { type: 'text', text: '已记住 [REDACTED_EMAIL_1]' } },
  { type: 'finish', reason: { kind: 'stop' } },
]);
const y1 = await YH.dispatch(ymasked);
t('Y1 早退路径仍还原回复', y1.includes(S.email) && !y1.includes('REDACTED_EMAIL_'), y1);

// Z. 本地脱敏对照工具：原文 → 脱敏 → 还原 三份对照
const { execSync } = await import('node:child_process');
const { writeFileSync, mkdtempSync } = await import('node:fs');
const { join } = await import('node:path');
const { tmpdir } = await import('node:os');
let zOut = '';
try {
  const ztmp = mkdtempSync(join(tmpdir(), 'privmask-test-'));
  const zfile = join(ztmp, 'sample.txt');
  writeFileSync(zfile, '原告 王小明，电话 13800138000，涉案金额 1200000 元。');
  zOut = execSync('node tools/mask-preview.mjs ' + zfile, { encoding: 'utf8' });
} catch (e) {
  zOut = '';
}
t('Z1 对照工具输出三份', zOut.includes('=== 1. 原文 ===') && zOut.includes('=== 2. 脱敏后') && zOut.includes('=== 3. 还原后'), zOut.slice(0, 40));
const zMasked = (zOut.match(/=== 2\. 脱敏后[\s\S]*?===\s*\n([\s\S]*?)\n=== 3\./) || [])[1] || '';
const zRestored = (zOut.match(/=== 3\. 还原后[\s\S]*?===\s*\n([\s\S]*?)\n\n占位符/) || [])[1] || '';
t('Z2 脱敏后含占位符、金额保留', zMasked.includes('[REDACTED_NAME_1]') && zMasked.includes('1200000') && !zMasked.includes('王小明'), zMasked.slice(0, 80));
t('Z3 还原后恢复原文', zRestored.includes('原告 王小明') && !zRestored.includes('[REDACTED_NAME_'), zRestored.slice(0, 80));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail > 0 ? 1 : 0;

  if (fail > 0) throw new Error(fail + ' checks failed');
});
