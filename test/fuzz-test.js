// dsh-privmask fuzz 测试：随机文本不崩、输出为字符串、幂等。
import { apply } from '../lib/index.js';
let listener, received;
const llmStub = { stream(o) { received = o; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); } };
const ctx = { on(n, f) { if (n === 'llm/stream') listener = f; return () => {}; }, get(n) { return n === 'llm' ? llmStub : undefined; } };
apply(ctx, {});
const POOL = ['a','b','0','9',' ','-','@','.','/',':','中','国','北','京','深','圳','张','三','李','四','王','五','元','电','话','邮','箱','信','用','卡','身','份','证','号','码','公','司','银','行','住','址','路','号','案','车','牌','' ];
async function run(text) {
  received = null;
  const opts = { provider: 't', model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text }] }] };
  const result = listener(opts, () => { received = opts; return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })(); });
  for await (const _ of result) {}
  return received.messages[0].content[0].text;
}
let pass = 0, fail = 0;
const t = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n); c ? pass++ : fail++; };
// 确定性伪随机（seed）
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
for (let i = 0; i < 300; i++) {
  const len = 1 + Math.floor(rnd() * 200);
  let s = '';
  for (let j = 0; j < len; j++) s += POOL[Math.floor(rnd() * POOL.length)];
  try {
    const out = await run(s);
    t('fuzz#' + i + ' 不崩且字符串', typeof out === 'string');
    const out2 = await run(out);
    t('fuzz#' + i + ' 幂等', out === out2);
  } catch (e) {
    t('fuzz#' + i + ' 不抛异常: ' + e.message, false);
  }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail > 0 ? 1 : 0;
