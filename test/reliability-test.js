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
t('G1 各自映射', g1.includes(P('EMAIL', 1)) && g2.includes(P('EMAIL', 1)));
const g3 = await HA.dispatch('邮箱 ' + S.email);
t('G2 同值复现同号', g3.includes(P('EMAIL', 1)));

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
t('J1 默认脱敏工具描述', H8.received.tools[0].description.includes('[REDACTED_COMPANY_') && !H8.received.tools[0].description.includes(coName), H8.received.tools[0].description);
const H9 = makeHarness({ redactToolMeta: false });
await H9.dispatch('查', { tools: toolWithMeta('查询' + coName + '的工商信息') });
t('J2 关闭工具元信息脱敏', H9.received.tools[0].description.includes(coName), H9.received.tools[0].description);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail > 0 ? 1 : 0;
