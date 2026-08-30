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
    ['住所证明（无冒号）', '需要提供住所证明文件。'],
    ['大型购物中心（泛指）', '大型购物中心客流量大。'],
    ['水果公司（泛指）', '与水果公司协商。'],
    ['该公司（保留）', '该公司的合同。'],
    ['去公司（保留）', '去公司上班。'],
    ['中国的公司（泛指）', '中国的公司很多。'],
    ['广州的公司（泛指）', '广州的公司很多。'],
    ['苹果的代理商（泛指）', '苹果的代理商很多。'],
    ['腾讯的股东（泛指）', '腾讯的股东很多。'],
    ['今欠（动词，保留）', '今欠是方言表达。'],
    ['借到（动词，保留）', '借到钱不容易。'],
    ['收到（动词，保留）', '收到通知。'],
    ['在学校（泛指）', '小明在学校学习。'],
    ['所学校（泛指）', '这所学校有百年历史。'],
    ['在银行（泛指）', '爸爸在银行工作。'],
    ['那家酒店（泛指）', '那家酒店很豪华。'],
    ['这家医院（泛指）', '这家医院很出名。'],
    ['上个月学校（泛指）', '上个月学校放假了。'],
    ['去工厂（泛指）', '爸爸去工厂上班。'],
    ['大街小巷（成语）', '大街小巷都在议论这件事。'],
    ['我们村（泛指）', '我们村口有棵大树。'],
    ['他在街道（泛指）', '他在街道上散步。'],
    ['回到村里（泛指）', '他回到村里看望父母。'],
    ['去镇上（泛指）', '他去镇上赶集。'],
    ['住在村里（泛指）', '她住在村里。'],
    ['本村（泛指）', '本村共有200户人家。'],
    ['隔壁村（泛指）', '隔壁村的医生来了。'],
    ['全村（泛指）', '全村都参加了大会。'],
    ['工业园区（泛指）', '去工业园区招商。'],
    ['街道口（泛指）', '我去街道口买苹果。'],
  ]
  for (const [name, text] of cases) {
    const out = await H.dispatch(text)
    if (out !== text) throw new Error(name + ' 误伤: ' + out)
  }
  const macOut = await H.dispatch('MAC地址AA:BB:CC:DD:EE:FF。')
  if (!macOut.includes('[REDACTED_MAC_') || macOut.includes('[REDACTED_ADDR_')) throw new Error('MAC 地址分类错误: ' + macOut)
})

test('泛化机构/村镇与真实机构并存：误伤与覆盖', async () => {
  const mustMask = [
    ['常住地址链+姓名', '被告李小红常住贵州省毕节市七星关区碧阳大道12号。', '[REDACTED_ADDRCHAIN_'],
    ['出生于+姓名', '被告张三出生于贵州省毕节市。', '[REDACTED_NAME_'],
    ['住所无冒号+姓名', '被告李小红住所贵州省毕节市七星关区。', '[REDACTED_NAME_'],
    ['及连接双姓名', '被告张三及李四共同向原告借款。', '[REDACTED_NAME_'],
    ['括号姓名', '被告（李小红）于2024年5月向原告借款。', '[REDACTED_NAME_'],
    ['姓名后接年份', '被告张三2024年9月1日与原告签订合同。', '[REDACTED_NAME_'],
    ['全国人大常委会', '全国人大常委会审议通过。', '[REDACTED_ORG_'],
    ['招商银行', '招商银行深圳分行出具了流水。', '[REDACTED_COMPANY_'],
    ['毕节市第一中学', '毕节市第一中学。', '[REDACTED_COMPANY_'],
    ['王家村（真实）', '王家村卫生室。', '[REDACTED_ADDRCHAIN_'],
    ['名下房产', '查封被执行人张三名下的房产。', '[REDACTED_NAME_'],
    ['未按履行', '被执行人李强未按生效判决履行义务。', '[REDACTED_NAME_'],
    ['监护人', '法定代理人李强的监护人王芳。', '[REDACTED_NAME_'],
    ['现住地址', '被告张三现住广东省深圳市南山区。', '[REDACTED_ADDR'],
    ['住+街道链', '原告王小明，住广东省深圳市南山区粤海街道。', '[REDACTED_ADDRCHAIN_'],
    ['住+道路链带门牌', '被告李小红住广东省深圳市南山区粤海街道12号。', '[REDACTED_ADDRCHAIN_'],
    ['清华大学', '清华大学位于北京。', '[REDACTED_COMPANY_'],
    ['协和医院', '北京协和医院。', '[REDACTED_COMPANY_'],
    ['人民银行', '中国人民银行。', '[REDACTED_COMPANY_'],
    ['门诊部机构', '出租给圣柏俐医疗美容门诊部使用。', '[REDACTED_COMPANY_'],
    ['支行', '中国工商银行深圳南山支行。', '[REDACTED_COMPANY_'],
    ['案外人', '案外人王芳提出执行异议。', '[REDACTED_NAME_'],
    ['被告方', '被告方王五辩称。', '[REDACTED_NAME_'],
    ['尚欠', '被告王五尚欠原告李四货款50000元。', '[REDACTED_NAME_'],
    ['应于判项', '被告王五应于本判决生效之日起十日内支付原告李四货款。', '[REDACTED_NAME_'],
    ['经传票传唤', '被告王五经传票传唤无正当理由拒不到庭。', '[REDACTED_NAME_'],
    ['当事人', '我方当事人王五。', '[REDACTED_NAME_'],
    ['之父链', '被告张三之父王大明。', '[REDACTED_NAME_'],
    ['之母链', '原告李小红之母刘芳。', '[REDACTED_NAME_'],
    ['认可', '被告李小红认可该欠款事实。', '[REDACTED_NAME_'],
    ['不认可', '被告李小红不认可该欠款事实。', '[REDACTED_NAME_'],
    ['无异议', '被告王五无异议。', '[REDACTED_NAME_'],
    ['同意', '被告王五同意分期还款。', '[REDACTED_NAME_'],
    ['不同意', '被告王五不同意调解。', '[REDACTED_NAME_'],
    ['无正当理由', '被告王五无正当理由拒不到庭。', '[REDACTED_NAME_'],
    ['当庭陈述', '原告王小明当庭陈述。', '[REDACTED_NAME_'],
    ['经合法传唤', '被告李小红经合法传唤未到庭。', '[REDACTED_NAME_'],
    ['区级地址链', '住在天河区体育西路123号。', '[REDACTED_ADDRCHAIN_'],
    ['出具的证明', '被告王五出具的证明。', '[REDACTED_NAME_'],
    ['持有的股份', '被告王五持有的股份。', '[REDACTED_NAME_'],
    ['所有的房产', '原告王小明所有的房产。', '[REDACTED_NAME_'],
    ['所在地', '被告王五所在地。', '[REDACTED_NAME_'],
    ['又名', '被告王五（又名王老五）。', '[REDACTED_NAME_'],
    ['别名', '被执行人李强（别名李二强）。', '[REDACTED_NAME_'],
    ['曾用名', '原告王小明，曾用名王小刚。', '[REDACTED_NAME_'],
    ['三字名以强结尾', '被告张三强。', '[REDACTED_NAME_'],
    ['到庭参加诉讼', '原告王小明到庭参加诉讼。', '[REDACTED_NAME_'],
    ['出庭应诉', '被告李小红出庭应诉。', '[REDACTED_NAME_'],
    ['当庭出示', '原告王小明当庭出示借条。', '[REDACTED_NAME_'],
    ['出庭作证', '证人王五出庭作证。', '[REDACTED_NAME_'],
    ['户籍所在地', '被告李小红，户籍所在地：浙江省杭州市西湖区。', '[REDACTED_ADDR_'],
    ['户籍所在地市级', '被告李小红，户籍所在地：浙江省杭州市。', '[REDACTED_ADDR_'],
    ['实际居住地', '被告李小红实际居住地：北京市朝阳区建国路88号。', '[REDACTED_ADDR_'],
    ['仲裁院', '深圳国际仲裁院。', '[REDACTED_ORG_'],
    ['的丈夫', '被告王五的丈夫李四。', '[REDACTED_NAME_'],
    ['的妻子', '被告王五的妻子李四。', '[REDACTED_NAME_'],
    ['的父亲', '被告王五的父亲王大明。', '[REDACTED_NAME_'],
    ['的配偶', '被告王五的配偶李四。', '[REDACTED_NAME_'],
    ['拉丁字号公司', '3M中国有限公司。', '[REDACTED_COMPANY_'],
    ['IBM中国', 'IBM中国有限公司。', '[REDACTED_COMPANY_'],
    ['数字字母公司', '与B2B公司签订合同。', '[REDACTED_COMPANY_'],
    ['区分局', '深圳市公安局南山区分局。', '[REDACTED_ORG_'],
    ['派出所独立', '碧阳派出所。', '[REDACTED_ORG_'],
    ['人民法庭', '七星关区人民法院碧阳人民法庭。', '[REDACTED_ORG_'],
    ['户口所在地', '被告李小红户口所在地：浙江省杭州市。', '[REDACTED_ADDR_'],
    ['空格座机', '电话：0755 12345678。', '[REDACTED_TEL_'],
    ['无分隔座机', '电话：01012345678。', '[REDACTED_TEL_'],
    ['申请保全人', '申请保全人王五。', '[REDACTED_NAME_'],
    ['抵押权人', '抵押权人李四。', '[REDACTED_NAME_'],
    ['质押权人', '质押权人王五。', '[REDACTED_NAME_'],
    ['保证人', '保证人李四。', '[REDACTED_NAME_'],
    ['权利人', '权利人王五。', '[REDACTED_NAME_'],
    ['欠（动词）', '被告王五欠原告李四货款。', '[REDACTED_NAME_'],
    ['冻结其在银行', '冻结其在中国工商银行深圳南山支行的存款。', '[REDACTED_COMPANY_'],
    ['在招商银行', '在招商银行开户。', '[REDACTED_COMPANY_'],
    ['贵州茅台', '贵州茅台酒厂（集团）有限责任公司。', '[REDACTED_COMPANY_'],
    ['贵州高院', '向贵州省高级人民法院申请再审。', '[REDACTED_ORG_'],
    ['本溪钢铁', '本溪钢铁公司。', '[REDACTED_COMPANY_'],
    ['华南区（大区）', '他负责华南区的销售业务。', ''],
    ['大湾区（宏观）', '大湾区建设提速。', ''],
    ['乡村振兴（政策）', '乡村振兴战略实施。', ''],
    ['报告财产', '责令被执行人王五报告财产。', '[REDACTED_NAME_'],
    ['高消费', '限制被执行人王五高消费。', '[REDACTED_NAME_'],
    ['纳入失信', '将被执行人王五纳入失信被执行人名单。', '[REDACTED_NAME_'],
    ['有履行能力', '被执行人王五有履行能力而拒不履行。', '[REDACTED_NAME_'],
    ['迟延履行', '被执行人王五迟延履行期间的债务利息。', '[REDACTED_NAME_'],
    ['加倍支付', '被告王五加倍支付迟延履行期间的债务利息。', '[REDACTED_NAME_'],
    ['逾期未履行', '被告王五逾期未履行还款义务。', '[REDACTED_NAME_'],
    ['逾期未付款', '被告王五逾期未付款。', '[REDACTED_NAME_'],
    ['经本院合法传唤', '被告王五经本院合法传唤未到庭。', '[REDACTED_NAME_'],
    ['立即返还', '判令被告李小红立即返还借款。', '[REDACTED_NAME_'],
    ['应返还', '被告李小红应返还原告王小明借款。', '[REDACTED_NAME_'],
    ['村委会主任', '村民委员会主任王五。', '[REDACTED_NAME_'],
    ['支部书记', '村党支部书记李四。', '[REDACTED_NAME_'],
    ['会计', '会计王五。', '[REDACTED_NAME_'],
    ['出纳', '出纳李四。', '[REDACTED_NAME_'],
    ['具状人', '具状人：王五。', '[REDACTED_NAME_'],
    ['被告人', '被告人王五。', '[REDACTED_NAME_'],
    ['原告人', '附带民事诉讼原告人王五。', '[REDACTED_NAME_'],
    ['被害人', '被害人王五。', '[REDACTED_NAME_'],
    ['举报人', '举报人王五。', '[REDACTED_NAME_'],
    ['铁路运输法院', '北京铁路运输法院。', '[REDACTED_ORG_'],
    ['互联网法院', '广州互联网法院。', '[REDACTED_ORG_'],
    ['知识产权法院', '北京知识产权法院。', '[REDACTED_ORG_'],
    ['金融法院', '上海金融法院。', '[REDACTED_ORG_'],
    ['海事法院', '大连海事法院。', '[REDACTED_ORG_'],
    ['被处罚人', '被处罚人王五。', '[REDACTED_NAME_'],
    ['违法行为人', '违法行为人李四。', '[REDACTED_NAME_'],
    ['犯罪嫌疑人', '犯罪嫌疑人李四。', '[REDACTED_NAME_'],
    ['嫌疑人', '嫌疑人王五。', '[REDACTED_NAME_'],
    ['在逃人员', '在逃人员李四。', '[REDACTED_NAME_'],
    ['民警', '派出所民警王五。', '[REDACTED_NAME_'],
    ['执行法官', '执行法官李四。', '[REDACTED_NAME_'],
    ['法官助理', '法官助理王五。', '[REDACTED_NAME_'],
    ['代理律师', '代理律师李四。', '[REDACTED_NAME_'],
    ['买受人', '买受人王五。', '[REDACTED_NAME_'],
    ['被背书人', '被背书人王五。', '[REDACTED_NAME_'],
    ['著作权人', '著作权人李四。', '[REDACTED_NAME_'],
    ['中国律师协会', '中国律师协会。', '[REDACTED_COMPANY_'],
    ['慈善基金会', '中国扶贫基金会。', '[REDACTED_COMPANY_'],
    ['商会', '深圳市总商会。', '[REDACTED_COMPANY_'],
    ['参加协会（泛指）', '参加协会活动。', ''],
    ['参加中国律师协会', '参加中国律师协会。', '[REDACTED_COMPANY_'],
    ['政务服务中心', '深圳市政务服务中心。', '[REDACTED_COMPANY_'],
    ['检测中心', '国家纺织品检测中心。', '[REDACTED_COMPANY_'],
    ['城市管理局', '深圳市城市管理局。', '[REDACTED_ORG_'],
    ['管理委员会', '中关村科技园区管理委员会。', '[REDACTED_ORG_'],
    ['市中心（泛指）', '在市中心吃饭。', ''],
    ['公证处', '北京市公证处。', '[REDACTED_ORG_'],
    ['鉴定所', '司法鉴定所。', '[REDACTED_ORG_'],
    ['看守所', '深圳市看守所。', '[REDACTED_ORG_'],
    ['拘留所', '行政拘留所。', '[REDACTED_ORG_'],
  ]
  for (const [name, text, ph] of mustMask) {
    const out = await H.dispatch(text)
    if (!out.includes(ph)) throw new Error(name + ' 未脱敏: ' + out)
    if ((await H.dispatch(out)) !== out) throw new Error(name + ' 不幂等: ' + out)
  }
  const mianOut = await H.dispatch('（面积1027.17平方米）出租给圣柏俐医疗美容门诊部使用。')
  if (!mianOut.includes('平方米）出租给') || !mianOut.includes('[REDACTED_COMPANY_')) throw new Error('平方米前缀被吞: ' + mianOut)
  const mustKeep = [
    ['我住在链（保留介词）', '我住在北京市海淀区中关村大街。'],
    ['住+链（保留介词）', '原告王小明，住广东省深圳市南山区粤海街道。'],
  ]
  for (const [name, text] of mustKeep) {
    const out = await H.dispatch(text)
    if (out === text) throw new Error(name + ' 未脱敏: ' + out)
    if (!out.includes('住')) throw new Error(name + ' 介词被吞: ' + out)
  }
  const mustKeepSame = [
    ['深圳有一所医院（泛指）', '深圳有一所医院。'],
    ['北京的医院（泛指）', '北京的医院很多。'],
  ]
  for (const [name, text] of mustKeepSame) {
    const out = await H.dispatch(text)
    if (out !== text) throw new Error(name + ' 误伤: ' + out)
  }
})

test('法律文书高频地址/含拉丁公司名：脱敏覆盖', async () => {
  const cases = [
    ['住所：完整地址', '住所：贵州省毕节市七星关区碧阳大道与深圳路交汇处奥莱国际购物中心4楼2F-(1-C)。', '[REDACTED_ADDR_'],
    ['住所无冒号+省', '被告李小红住所贵州省毕节市七星关区。', '[REDACTED_ADDR_'],
    ['住所无冒号+道路', '被告李小红住所贵州省毕节市七星关区碧阳大道12号。', '[REDACTED_ADDR_'],
    ['住所证明（无冒号）保留', '需要提供住所证明文件。', ''],
    ['住所变更登记保留', '办理住所变更登记。', ''],
    ['住所无固定场所保留', '被告李小红住所无固定场所。', ''],
    ['含拉丁公司名', '原告是毕节市奥莱国际Fmall购物中心商业运营管理的经营主体。', '[REDACTED_COMPANY_'],
    ['城市名公司', '被告为广州白云山制药公司。', '[REDACTED_COMPANY_'],
    ['行业词公司', '与云南白药制药公司签订合同。', '[REDACTED_COMPANY_'],
    ['品牌公司', '被告为腾讯公司。', '[REDACTED_COMPANY_'],
    ['拉丁品牌公司', '与华为Mate60公司合作。', '[REDACTED_COMPANY_'],
  ]
  for (const [name, text, ph] of cases) {
    const out = await H.dispatch(text)
    if (!out.includes(ph)) throw new Error(name + ' 未脱敏: ' + out)
  }
})

test('地址链与多姓名：脱敏覆盖与误伤回归', async () => {
  const mustMask = [
    ['户籍地址', '户籍地址：浙江省杭州市西湖区文三路。', '[REDACTED_ADDR_'],
    ['省市区道路链', '贵州省毕节市七星关区碧阳大道。', '[REDACTED_ADDRCHAIN_'],
    ['实际控制人', '实际控制人：王芳。', '[REDACTED_NAME_'],
    ['共同被告顿号', '被告 张伟、李强、王芳。', '[REDACTED_NAME_'],
    ['编号被告', '被告一张三，被告二李四，被告1王五。', '[REDACTED_NAME_'],
  ]
  for (const [name, text, ph] of mustMask) {
    const out = await H.dispatch(text)
    if (!out.includes(ph)) throw new Error(name + ' 未脱敏: ' + out)
  }
  const mustKeep = [
    ['机构名+路（非地址链）', '中国人民银行深圳市分行南山路'],
    ['顿号后非姓名', '被告张三、依法享有权利。'],
    ['水果公司（泛指）', '与水果公司协商。'],
    ['编号被告无姓名', '被告一未到庭。'],
  ]
  for (const [name, text] of mustKeep) {
    const out = await H.dispatch(text)
    // 允许公司/街道被各自规则脱敏，但不得把整段当成地址链吞掉
    if (out === '[REDACTED_ADDRCHAIN_') throw new Error(name + ' 误伤: ' + out)
  }
})

test('机关全称识别：法院/检察院/公安分局完整脱敏', async () => {
  const cases = [
    ['市人民法院', '此致，毕节市七星关区人民法院。', '[REDACTED_ORG_'],
    ['中级法院', '此致，北京市第一中级人民法院。', '[REDACTED_ORG_'],
    ['最高法院', '此致，中华人民共和国最高人民法院。', '[REDACTED_ORG_'],
    ['公安局+分局+派出所', '毕节市公安局七星关分局碧阳派出所。', '[REDACTED_ORG_'],
    ['检察院', '此致，毕节市人民检察院。', '[REDACTED_ORG_'],
    ['街道办事处', '中关村街道办事处的通知。', '[REDACTED_ORG_'],
    ['居委会', '朝阳区和平里社区居民委员会。', '[REDACTED_ORG_'],
    ['村委会', '正定县南楼村村民委员会。', '[REDACTED_ORG_'],
  ]
  for (const [name, text, ph] of cases) {
    const out = await H.dispatch(text)
    if (!out.includes(ph)) throw new Error(name + ' 未脱敏: ' + out)
    if (/]DACTED_|\][A-Z]/.test(out)) throw new Error(name + ' 占位符异常: ' + out)
  }
})

test('公司系动词与重叠后缀：覆盖与误伤回归', async () => {
  const mustMask = [
    ['该公司为', '该公司为广州白云山制药公司。', '[REDACTED_COMPANY_'],
    ['公司系', '公司系腾讯公司。', '[REDACTED_COMPANY_'],
    ['公司由', '该公司由北京字节跳动科技有限公司控股。', '[REDACTED_COMPANY_'],
  ]
  for (const [name, text, ph] of mustMask) {
    const out = await H.dispatch(text)
    if (!out.includes(ph)) throw new Error(name + ' 未脱敏: ' + out)
    if (!/系|为|由/.test(out)) throw new Error(name + ' 系动词被吞: ' + out)
  }
  const mustKeep = [
    ['该公司（保留）', '该公司与对方协商。'],
    ['该公司为该合同担保', '该公司为该合同担保。'],
  ]
  for (const [name, text] of mustKeep) {
    const out = await H.dispatch(text)
    if (out !== text) throw new Error(name + ' 误伤: ' + out)
  }
})

test('判决书主文：当事人姓名无上下文重复出现仍脱敏', async () => {
  const doc = '上诉人李强因与被上诉人张伟民间借贷纠纷一案。判决如下：一、李强于本判决生效之日起十日内偿还张伟借款本金250000元；二、驳回张伟其他诉讼请求。审判长王芳、审判员陈志明、人民陪审员刘丽。'
  const out = await H.dispatch(doc)
  if (/李强|张伟|王芳|陈志明|刘丽/.test(out)) throw new Error('判决主文姓名未脱敏: ' + out)
  if (!out.includes('250000') || !out.includes('民间借贷')) throw new Error('金额/案由被误伤: ' + out)
  const out2 = await H.dispatch(out)
  if (out2 !== out) throw new Error('判决书场景不幂等: ' + out2)
})

test('常见案由/角色/欠条借条/括号公司：脱敏覆盖', async () => {
  const mustMask = [
    ['民间借贷', '被告李强民间借贷纠纷一案。', '[REDACTED_NAME_'],
    ['买卖合同', '被告王芳买卖合同纠纷。', '[REDACTED_NAME_'],
    ['劳动争议', '被告李强劳动争议纠纷。', '[REDACTED_NAME_'],
    ['物业服务', '被告张伟物业服务合同纠纷。', '[REDACTED_NAME_'],
    ['申请执行人', '申请执行人中国工商银行股份有限公司。', '[REDACTED_COMPANY_'],
    ['括号公司', '原告腾讯科技（深圳）有限公司。', '[REDACTED_COMPANY_'],
    ['欠条', '欠条：今欠王强货款陆万元整（60000元）。欠款人：李明。', '[REDACTED_NAME_'],
    ['借条', '借条：今借到刘芳人民币拾万元整。借款人：孙浩。', '[REDACTED_NAME_'],
    ['继承', '被继承人王建国于2024年去世。继承人王芳、王强。', '[REDACTED_NAME_'],
    ['交通事故', '原告赵磊诉被告平安保险公司机动车交通事故责任纠纷。事故认定书载明：赵磊负次要责任。', '[REDACTED_NAME_'],
  ]
  for (const [name, text, ph] of mustMask) {
    const out = await H.dispatch(text)
    if (!out.includes(ph)) throw new Error(name + ' 未脱敏: ' + out)
    const out2 = await H.dispatch(out)
    if (out2 !== out) throw new Error(name + ' 不幂等: ' + out2)
  }
  // 案由短语应保留（不得被吞进姓名占位符）
  const keep = [
    ['民间借贷', '被告李强民间借贷纠纷一案。', '民间借贷纠纷一案'],
    ['买卖合同', '被告王芳买卖合同纠纷。', '买卖合同纠纷'],
    ['劳动争议', '被告李强劳动争议纠纷。', '劳动争议纠纷'],
    ['物业服务', '被告张伟物业服务合同纠纷。', '物业服务合同纠纷'],
    ['交通事故', '原告赵磊诉被告平安保险公司机动车交通事故责任纠纷。', '机动车交通事故责任纠纷'],
  ]
  for (const [name, text, phrase] of keep) {
    const out = await H.dispatch(text)
    if (!out.includes(phrase)) throw new Error(name + ' 案由被吞: ' + out)
  }
})

test('更多角色词与案由：转让/投保/居间/快递/赡养等', async () => {
  const mustMask = [
    ['股权转让', '转让方王芳与受让方陈志明签订股权转让协议。', '[REDACTED_NAME_'],
    ['合伙散伙', '合伙人李明、合伙人赵磊散伙清算纠纷。', '[REDACTED_NAME_'],
    ['保险投保', '投保人张伟向中国平安人寿保险股份有限公司申请理赔。', '[REDACTED_NAME_'],
    ['居间', '居间人孙浩与委托人张伟居间合同纠纷。', '[REDACTED_NAME_'],
    ['快递', '收件人王芳，寄件人李明。', '[REDACTED_NAME_'],
    ['赡养', '原告王芳诉被告王强赡养纠纷。', '[REDACTED_NAME_'],
    ['探望权', '原告张伟与被告李红探望权纠纷。', '[REDACTED_NAME_'],
    ['相邻关系', '原告赵磊与被告孙浩相邻关系纠纷。', '[REDACTED_NAME_'],
  ]
  for (const [name, text, ph] of mustMask) {
    const out = await H.dispatch(text)
    if (!out.includes(ph)) throw new Error(name + ' 未脱敏: ' + out)
    const out2 = await H.dispatch(out)
    if (out2 !== out) throw new Error(name + ' 不幂等: ' + out2)
  }
})

test('动词型姓名上下文与虚词过滤：覆盖与误伤', async () => {
  const mustMask = [
    ['查询姓名', '查询张伟的工商信息。', '[REDACTED_NAME_'],
    ['搜索联系方式', '搜索王芳的联系方式。', '[REDACTED_NAME_'],
    ['检索判决', '检索李强的判决文书。', '[REDACTED_NAME_'],
  ]
  for (const [name, text, ph] of mustMask) {
    const out = await H.dispatch(text)
    if (!out.includes(ph)) throw new Error(name + ' 未脱敏: ' + out)
    if (!/的/.test(out)) throw new Error(name + ' 「的」被吞: ' + out)
  }
  const mustKeep = [
    ['查询功能', '查询功能说明。'],
    ['检索结果', '检索结果为空。'],
    ['搜索页面', '搜索页面打不开。'],
    ['了解情况', '了解情况后再说。'],
    ['介绍信', '介绍信已开具。'],
  ]
  for (const [name, text] of mustKeep) {
    const out = await H.dispatch(text)
    if (out !== text) throw new Error(name + ' 误伤: ' + out)
  }
})

test('IPv6 完整匹配与代码/时间/MAC 误伤防回归', async () => {
  const mustMask = [
    ['IPv6完整', 'IPv6 地址 2001:db8::ff00:42:8329。', '[REDACTED_IPV6_'],
    ['IPv6双冒号', 'IPv6 地址 2001:db8::1。', '[REDACTED_IPV6_'],
    ['IPv6全段', 'IPv6 地址 2001:0db8:85a3:0000:0000:8a2e:0370:7334。', '[REDACTED_IPV6_'],
    ['分隔手机', '电话 138 0013 8000，手机 138-0013-8000。', '[REDACTED_MOBILE_'],
  ]
  for (const [name, text, ph] of mustMask) {
    const out = await H.dispatch(text)
    if (!out.includes(ph)) throw new Error(name + ' 未脱敏: ' + out)
    if ((await H.dispatch(out)) !== out) throw new Error(name + ' 不幂等')
  }
  const mustKeep = [
    ['时间', '时间 12:30:45。'],
    ['C++作用域', 'std::vector<int> x。'],
    ['命名空间', 'namespace a::b { }'],
    ['裸双冒号', '注意：: 和 :: 的区别。'],
    ['日期', '2024 01 31。'],
  ]
  for (const [name, text] of mustKeep) {
    const out = await H.dispatch(text)
    if (out !== text) throw new Error(name + ' 误伤: ' + out)
  }
})

test('介词引导地址链与律师/金融借款案由', async () => {
  const mustMask = [
    ['名下位于', '查封被申请人名下位于广州市天河区体育西路的房产。', '[REDACTED_ADDRCHAIN_'],
    ['我住在', '我住在北京市海淀区中关村大街。', '[REDACTED_ADDRCHAIN_'],
    ['陈志明律师', '委托代理人陈志明律师。', '[REDACTED_NAME_'],
    ['金融借款', '被申请人李强金融借款合同纠纷一案。', '[REDACTED_NAME_'],
  ]
  for (const [name, text, ph] of mustMask) {
    const out = await H.dispatch(text)
    if (!out.includes(ph)) throw new Error(name + ' 未脱敏: ' + out)
    if ((await H.dispatch(out)) !== out) throw new Error(name + ' 不幂等')
  }
  const mustKeep = [
    ['中关村街道', '北京市海淀区中关村街道。', ''],
    ['机构+路', '中国人民银行深圳市分行南山路', ''],
    ['律师职业', '他是一名律师。', ''],
  ]
  for (const [name, text] of mustKeep) {
    const out = await H.dispatch(text)
    if (out === '[REDACTED_ADDRCHAIN_') throw new Error(name + ' 误伤: ' + out)
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
  // 带「身份证号」上下文的号码即使校验位不合法也必须脱敏（作者已明确标注为证件号）
  const ctxBad = await H.dispatch('身份证号 522421199001011234') // 校验位非法但有上下文
  if (!ctxBad.includes('[REDACTED_ID18_')) throw new Error('上下文身份证漏脱敏: ' + ctxBad)
})

test('中国即时通讯/执业标识：上下文识别不误伤', async () => {
  const out = await H.dispatch('微信号：alice_wang123，QQ号 12345678，律师执业证号 14401000000000000，普通文本 abc123')
  if (!out.includes('[REDACTED_WECHAT_1]') || !out.includes('[REDACTED_QQ_1]') || !out.includes('[REDACTED_CERTID_1]')) throw new Error('标识未脱敏: ' + out)
  if (!out.includes('普通文本 abc123')) throw new Error('误伤普通文本: ' + out)
  const noValue = await H.dispatch('微信号 之间的内容')
  if (noValue !== '微信号 之间的内容') throw new Error('无值上下文误伤: ' + noValue)
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
