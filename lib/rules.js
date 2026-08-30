/**
 * dsh-privmask 规则层：通用/中文实体规则表、校验器与活动规则构建。
 * 纯模块，不依赖引擎与插件上下文（规则 fn 通过 engine 参数访问映射与白名单）。
 * @module dsh-privmask/rules
 */

// ─────────────────────────── 通用规则 ───────────────────────────

export const RULES = [
  { cat: 'pem', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { cat: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { cat: 'key', re: /\b(sk-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9\-]{10,})\b/g },
  { cat: 'key', re: /(Bearer|Basic)\s+([A-Za-z0-9\-._~+/=]{16,})/gi, secretGroup: 2 },
  { cat: 'key', re: /\b(api[_-]?key|(?:aws[_-]?)?secret[_-]?access[_-]?key|access[_-]?key|secret[_-]?key|token|secret|password|passwd|authorization)\b\s*[:=]\s*["']?([A-Za-z0-9\-._~+/=]{8,})["']?/gi, secretGroup: 2 },
  { cat: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { cat: 'phone', re: /\+\d{1,3}(?:[\s\-()]*\d){7,14}/g },
  { cat: 'ipv4', re: /\b(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/g },
  // IPv6：8 组全写，或含「::」且至少 3 个 hex 段（排除 MAC/时间/C++ 作用域/命名空间）
  { cat: 'ipv6', re: /(?<![0-9a-fA-F:])(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}(?![0-9a-fA-F:])|(?<![0-9a-fA-F:])(?:(?:[0-9a-fA-F]{1,4}:){1,6}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7})::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}(?![0-9a-fA-F:])/g },
  // MAC 地址：6 组 2 位 hex，冒号分隔（设备标识，避免被「MAC地址」上下文误当成住址）
  { cat: 'mac', re: /(?<![0-9a-fA-F:])[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}(?![0-9a-fA-F:])/g },
  { cat: 'hex', re: /\b[0-9a-fA-F]{40,}\b/g },
  { cat: 'b64', re: /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{32,}={0,2}(?![A-Za-z0-9+/])/g },
];

export const PATH_RULES = [
  { cat: 'path', re: /\/(?:Users|home|private|var|etc|usr|opt|tmp|root|Applications|Library|System|Volumes|mnt|media)\/[^\s"'`<>[\]{};]{1,200}/g },
  { cat: 'path', re: /[A-Za-z]:\\[^"'\n\s]{1,200}/g },
];

// ─────────────────────────── 中文实体规则 ───────────────────────────

/** 汉字范围（U+4E00..U+9FA5 的实际字符），规避 \u 转义在不同传输层级的差异 */
export const HAN = '一-龥';
export const hanRe = new RegExp('[' + HAN + ']');
export const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤詹傅萧欧区湛戚左卓席麦米柳苗俞谷屈庞康阎涂桂翁谈邢易童路舒解樊鲁乐祁霍纪单尚穆滕娄牟卞瞿章乔文关管应古蓝明邬赖安温洪齐尤项池甄焦桑芦栗';
export const NAME_CTX = ['法定代表人', '委托代理人', '申请执行人', '申请保全人', '保全申请人', '被申请人', '被执行人', '申请人', '审判长', '审判员', '人民陪审员', '书记员', '书记', '检察员', '检察官', '联系人', '收货人', '代理人', '辩护人', '监护人', '案外人', '异议人', '利害关系人', '当事人', '被告人', '原告人', '原告', '被告', '第三人', '债务人', '债权人', '担保人', '保证人', '抵押权人', '抵押人', '质押权人', '质押人', '出质人', '质权人', '留置权人', '权利人', '义务人', '保全人', '出借人', '借款人', '出租人', '承租人', '户主', '董事长', '总经理', '监事', '董事', '股东', '负责人', '主任', '副主任', '村长', '组长', '会计', '出纳', '姓名', '名字', '签字', '签名', '签章', '经理', '委托人', '被委托人', '委托方', '受托方', '受托人', '证人', '鉴定人', '经办人', '收件人', '收款人', '付款人', '合伙人', '投资人', '实际控制人', '控股股东', '一致行动人', '上诉人', '被上诉人', '原审原告', '原审被告', '再审申请人', '申诉人', '具状人', '起诉人', '被害人', '受害人', '举报人', '控告人', '报案人', '被处罚人', '违法行为人', '行为人', '犯罪嫌疑人', '嫌疑人', '在逃人员', '被拘留人', '被羁押人', '执行法官', '承办法官', '法官助理', '法官', '民警', '法警', '代理律师', '辩护律师', '委托律师', '律师', '买受人', '出卖人', '保管人', '被背书人', '背书人', '出票人', '承兑人', '著作权人', '专利权人', '商标权人', '被许可人', '许可人', '中介人', '行纪人', '欠款人', '欠款方', '欠条', '借条', '被继承人', '继承人', '遗赠人', '受遗赠人', '转让方', '受让方', '出让方', '居间人', '寄件人', '投保人', '被保险人', '受益人', '买方', '卖方', '甲方', '乙方', '丙方', '发包人', '承包人', '托运人', '承运人', '出租方', '承租方', '又名', '别名', '曾用名', '查询', '检索', '查找', '搜索', '了解', '介绍'];
/** 姓名后允许直接出现的助词/虚词（视为边界，避免漏掉"张三丰的合同"这类三字名） */
export const NAME_PARTICLES = '的了着过呢吧嘛啊呀在把被与和及或为从对向于诉系因';
/** 姓名后常见动词/助词短语：从候选名尾部裁掉，避免把「认为/行为」等词吞进占位符（按长度降序匹配） */
export const NAME_TAILS = ['请求', '要求', '表示', '提出', '指出', '强调', '主张', '委托', '担任', '负责', '涉嫌', '离婚', '起诉', '上诉', '反诉', '签订', '签署', '结婚', '借款', '拖欠', '抚养', '继承', '经营', '死亡', '失踪', '诉称', '诉请', '民间借贷纠纷一案', '借款纠纷一案', '借贷纠纷一案', '合同纠纷一案', '金融借款合同纠纷', '金融借款合同纠纷一案', '物业服务合同纠纷', '物业服务合同纠纷一案', '服务合同纠纷', '服务合同纠纷一案', '买卖合同纠纷', '租赁合同纠纷', '劳动合同纠纷', '劳动争议纠纷', '交通事故责任纠纷', '机动车交通事故责任纠纷', '侵权责任纠纷', '赡养纠纷', '探望权纠纷', '相邻关系纠纷', '散伙清算纠纷', '股权转让协议', '居间合同纠纷', '借款纠纷', '借贷纠纷', '合同纠纷', '物业服务合同', '服务合同', '纠纷一案', '一案', '民间借贷', '劳动争议', '赡养', '探望权', '相邻关系', '散伙清算', '律师', '还款', '清偿', '支付', '偿还', '拖欠货款', '货款', '欠款', '借款人民币', '人民币', '买卖合同', '租赁合同', '劳动合同', '交通事故', '侵权责任', '不当得利', '无因管理', '判决', '裁定', '调解', '立案', '审理', '宣判', '上诉状', '答辩状', '起诉状', '代理词', '证据', '举证', '质证', '保全', '执行', '仲裁', '公证', '担保', '保证', '抵押', '质押', '利息', '违约金', '诉讼费', '案件受理费', '公告费', '送达',
  // 身份/联系方式/地址等字段标签：姓名后紧跟这些词时，词属于字段名而非姓名（否则会吞掉标签并破坏后续地址/证件规则）
  '住址', '住所地', '户籍地址', '户籍地', '户籍', '联系地址', '注册地址', '送达地址', '现住址', '现住', '现居住地', '居住地', '常住地址', '常住', '居住', '住所', '地址', '住',
  '出生日期', '出生年月', '出生时间', '出生于', '出生', '生日', '生于',
  '身份证号码', '身份证号', '身份证',
  '联系电话', '电话号码', '手机号码', '手机号', '手机', '联系方式', '打电话', '电话',
  '微信号', '微信', 'QQ号', 'QQ',
  '银行卡号', '银行卡', '银行账户', '开户行', '卡号', '账号',
  '律师执业证号', '律师执业证', '执业证号', '执业证编号', '执业证',
  // 姓名后接的并列/共同状语（「被告张三及李四共同向原告借款」）
  '共同', '一起', '分别', '均',
  // 亲属/归属/人数短语（「李小红之父」「张三名下房产」「李四等人」）
  '之父', '之母', '之妻', '之夫', '之子', '之女', '名下',
  '等人', '三人', '二人', '两人', '四人', '五人', '数人', '等',
  // 履行/到庭否定短语（「李强未按生效判决履行」「李强拒不履行」）
  '未按', '未到', '未履行', '未支付', '未偿还', '未归还', '拒不履行', '拒不',
  // 欠款/履行/送达高频短语（「王五尚欠」「王五应于本判决生效后」「王五经传票传唤」）
  '尚欠', '欠付', '欠', '应于', '应支付', '应偿还', '应赔偿', '应承担', '经传票传唤', '下落不明',
  // 答辩表述（「王五辩称」「王五答辩称」）
  '辩称', '答辩称',
  // 答辩/质证/出庭高频短语（「李小红认可」「王五无异议」「经合法传唤」）
  '认可', '不认可', '无异议', '有异议', '同意', '不同意', '无正当理由', '当庭陈述', '陈述', '经合法传唤',
  // 权属/行为动词（「王五出具」「王小明所有」「王五持有的股份」）
  '出具', '持有', '所有', '所在地',
  // 庭审到庭/出庭/当庭短语（「王小明到庭参加诉讼」「李小红出庭应诉」）
  '到庭参加诉讼', '出庭应诉', '当庭出示', '当庭提交', '到庭', '出庭', '当庭',
  // 居住地字段（「李小红户籍所在地」「实际居住地」）
  '户籍所在地', '实际居住地', '实际居住', '户口所在地',
  // 执行/失信阶段短语（「王五报告财产」「王五高消费」「纳入失信被执行人名单」）
  '报告财产', '高消费', '纳入失信被执行人名单', '纳入失信', '无财产', '无可供执行财产',
  '采取限制消费措施', '应当', '迟延履行', '迟延', '履行',
  // 判决主文利息/履行短语（「王五加倍支付」「王五逾期未履行」「经本院合法传唤」）
  '加倍支付', '加倍', '逾期未付款', '逾期未履行', '逾期未', '逾期', '经本院合法传唤',
  // 诉请返还/支付短语（「李小红立即返还」「李小红应返还」）
  '立即返还', '立即支付', '立即', '应返还', '返还'];
/** 姓名后应保留（不吞入占位符）的动词/助词：命中即视为姓名边界，词留在原文 */
export const NAME_KEEP_TAILS = ['认为', '以为', '因', '诉'];
/** 姓名后允许出现的单字助词/虚词（候选名尾部的这些字会被裁掉；含多字尾词首字，避免「认为」被截断后残留「认」） */
export const NAME_TAIL_CHARS = '的了着过呢吧嘛啊呀在把被与和及或为从对向于是有等称说认请要表提指主声委担负涉行';
export const ORG_KEYS = ['有限责任公司', '股份有限公司', '集团有限公司', '有限公司', '集团', '控股', '事务所', '研究所', '研究院', '合作社', '出版社', '银行', '医院', '学校', '学院', '大学', '公司', '工厂', '饭店', '酒店', '购物中心', '商场', '中学', '小学', '幼儿园', '门诊部', '诊所', '卫生院', '卫生室', '分行', '支行', '协会', '基金会', '联合会', '商会', '学会', '中心'];
/** 强标识后缀：公司名前缀无需地区/行业词佐证（避免漏掉「阿里巴巴集团」「华为技术有限公司」这类常见公司） */
export const ORG_STRONG = new Set(['集团', '控股', '事务所', '研究所', '研究院', '出版社', '银行', '医院', '学校', '学院', '大学', '工厂', '饭店', '酒店', '中学', '小学', '幼儿园', '门诊部', '诊所', '卫生院', '卫生室', '分行', '支行', '协会', '基金会', '联合会', '商会', '学会', '中心']);
/** 常见生活名词类机构后缀：泛化语境（在学校/那家酒店/爸爸去工厂）中需区分泛指与机构名 */
export const ORG_COMMON_STRONG = ['学校', '医院', '银行', '酒店', '饭店', '工厂', '大学', '学院', '中学', '小学', '幼儿园', '门诊部', '诊所', '卫生院', '卫生室', '分行', '支行', '协会', '基金会', '联合会', '商会', '学会', '中心'];
/** 泛指前缀：命中即视为普通名词而非机构名（如「小明在学校」「那家酒店」「上个月学校放假」） */
export function isGenericOrgPrefix(t) {
  if (ORG_COMMON_STRONG.includes(t)) return true;
  if (/^(上个月|这个月|下个月|今年|去年|明年|前年|后年|今天|昨天|明天|每天|每周|每月|周末|星期)$/.test(t)) return true;
  if (/^(参加|加入)$/.test(t)) return true;
  if (/^(大型|中型|小型)(购物)?$/.test(t)) return true;
  // 「附近有一所医院」「这附近有家医院」：短词 + 有 + 量词短语是泛指
  if (/^.{1,3}有(一所|一家|这家|那家|两所|几所|数个|一个|某个|这个|那个|家|所)$/.test(t)) return true;
  if (/^.{1,4}有$/.test(t)) return true;
  // 「北京的医院」「南山区的银行」：地名 + 的 + 生活名词是泛指
  if (/^.{1,4}的$/.test(t)) return true;
  if (/^(爸爸|妈妈|爷爷|奶奶|哥哥|姐姐|弟弟|妹妹|叔叔|阿姨|老师|同学|朋友|邻居|同事|学生|校长|家长)$/.test(t)) return true;
  if (t.length > 4) return false;
  if (/^(我|你|他|她|它|咱|这|那|某|每|各|全|本|一|两|几|有)(们)?(一|两|几|数)?(所|家|个|座)?$/.test(t)) return true;
  if (/^.{1,3}[在去走到上回进出]$/.test(t)) return true;
  return false;
}
/** 代词剥离（该公司/本公司/其在中国工商银行…）：本/贵/各/双 可能与地名冲突（本溪/贵州），
 * 仅在后接机构后缀词首字时剥离；该/我/你/他/她/它/其/们 为安全单字 */
export function stripPronounPrefix(trimmed, start) {
  for (const ch of PRONOUN) {
    if (trimmed.length < 2 || !trimmed.startsWith(ch)) continue;
    const safe = '该我你他她它其们'.includes(ch);
    const followedOrg = ORG_KEYS.some((k) => trimmed.startsWith(ch + k[0]));
    if (!safe && !followedOrg) continue;
    trimmed = trimmed.slice(ch.length);
    start += ch.length;
  }
  return { trimmed, start };
}
export const REGION_CHARS = '省市自治区县';
export const INDUSTRY_WORDS = ['科技', '技术', '网络', '信息', '贸易', '实业', '建设', '工程', '投资', '金融', '咨询', '文化', '传媒', '物流', '医药', '食品', '服装', '机械', '电子', '软件', '地产', '物业', '装饰', '广告', '管理', '服务', '生物', '能源', '材料', '设计', '教育', '医疗', '汽车', '建筑', '环保', '农业', '旅游', '餐饮', '百货', '置业', '智能', '数据', '互联', '供应链', '制药', '化妆品', '保险', '证券', '期货', '矿业', '纺织', '印刷', '包装', '家具', '珠宝', '体育', '娱乐', '游戏', '影视', '动漫', '培训', '健康', '养老', '电力', '水务', '燃气', '通讯', '电信', '化工', '仪器', '家电', '半导体', '芯片', '光伏', '电池', '新能源', '仓储', '运输', '航空', '酒店', '饮料', '酒业', '烟草', '渔业', '养殖', '鞋业', '皮革', '建材', '装修', '零售', '医疗美容', '美容', '整形', '医美', '钢铁', '煤炭', '煤业', '石油', '天然气', '水泥', '玻璃', '陶瓷', '造纸', '检测', '鉴定', '认证', '艺术'];
/** 常见城市/地域名：作为公司名前缀时无需行业词佐证（如「广州白云山制药公司」） */
export const CITY_WORDS = ['北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '重庆', '武汉', '西安', '长沙', '郑州', '济南', '青岛', '大连', '宁波', '厦门', '福州', '合肥', '南昌', '昆明', '贵阳', '南宁', '兰州', '太原', '石家庄', '哈尔滨', '长春', '沈阳', '呼和浩特', '乌鲁木齐', '拉萨', '西宁', '银川', '海口', '三亚', '无锡', '常州', '南通', '徐州', '温州', '嘉兴', '绍兴', '金华', '台州', '佛山', '东莞', '珠海', '中山', '惠州', '汕头', '湛江', '泉州', '漳州', '烟台', '威海', '潍坊', '淄博', '洛阳', '南阳', '襄阳', '宜昌', '岳阳', '株洲', '湘潭', '赣州', '九江', '桂林', '柳州', '绵阳', '德阳', '宜宾', '泸州', '毕节', '六盘水', '安顺', '铜仁', '大理', '丽江'];
/** 知名品牌/字号：后跟公司后缀时直接脱敏（如「腾讯公司」「华为Mate60公司」） */
export const BRAND_WORDS = ['华为', '腾讯', '百度', '小米', '阿里巴巴', '阿里', '京东', '网易', '美团', '滴滴', '字节跳动', '大疆', '比亚迪', '格力', '美的', '海尔', '联想', '中兴', 'OPPO', 'vivo', '三星', '苹果', '微软', '谷歌', '亚马逊', '特斯拉', '丰田', '本田', '日产', '大众', '宝马', '奔驰', '奥迪', '耐克', '阿迪达斯', '安踏', '李宁', '海底捞', '瑞幸', '星巴克', '麦当劳', '肯德基', '中国石油', '中国石化', '中国移动', '中国联通', '中国电信', '工商银行', '建设银行', '农业银行', '中国银行', '招商银行', '浦发银行', '平安银行', '中国人寿', '中国平安', '中信证券', '中金公司', '茅台', '五粮液', '农夫山泉', '哇哈哈', '伊利', '蒙牛'];
export const PRONOUN = '该本我你他她它我们你们他们贵各双其';
export const CONJUNCTIONS = '与和及或';
/** 公司/机关名前常见动词/介词：从候选前缀头部裁掉，避免「查询/委托/向」被吞进占位符 */
export const ORG_PREFIX_VERBS = ['查询', '委托', '联系', '起诉', '控告', '报案', '走访', '前往', '来到', '请求', '要求', '提交', '发送', '交付', '出租给', '交付给', '转让给', '出售给', '冻结', '查封', '扣押', '划拨', '扣划', '变卖', '拍卖', '参加', '加入', '寄送', '递交', '办理', '协助'];
export const ORG_PREFIX_SINGLES = '请将把由向为系是给';
/** 公司名前缀允许的字符：汉字 + 拉丁字母 + 数字 + 全角/半角括号（覆盖「腾讯科技（深圳）有限公司」） */
export const ORG_NAME_CHARS = new RegExp('[' + HAN + 'A-Za-z0-9（）()]');
export function trimOrgPrefix(prefix) {
  let p = prefix;
  // 未配对的右括号是句子级标点（「平方米）出租给圣柏俐门诊部」）：连同其前内容一并裁掉；
  // 「腾讯科技（深圳）有限公司」中的右括号与左括号配对，不受影响
  const fc = Math.min(...['）', ')'].map((c) => {
    const i = p.indexOf(c);
    return i === -1 ? Infinity : i;
  }));
  const lo = Math.max(p.lastIndexOf('（'), p.lastIndexOf('('));
  if (fc !== Infinity && (lo === -1 || lo > fc)) {
    p = p.slice(fc + 1);
  }
  for (const v of ORG_PREFIX_VERBS) {
    if (p.startsWith(v) && p.length - v.length >= 2) return p.slice(v.length);
  }
  // 「公司为/公司系/公司是/公司由」：前置公司名 + 系动词，只取系动词后的主体
  for (const k of ORG_KEYS) {
    const m = p.match(new RegExp('^' + k + '(为|系|是|由)'));
    if (m !== null && p.length - m[0].length >= 2) return p.slice(m[0].length);
  }
  const head = p[0];
  if (ORG_PREFIX_SINGLES.includes(head) && p.length >= 3) return p.slice(1);
  return p;
}
/** 地址链前常出现的代词/介词/动词：从链首整体剥离（「我住在…」「位于上海市…」），介词保留在原文 */
const CHAIN_PREPS = '我你他她它咱们住在去回到进出走来位于现常户籍';
function stripChainPrep(span) {
  let start = 0;
  while (start < span.length && CHAIN_PREPS.includes(span[start])) start += 1;
  if (start === 0) return 0;
  const rest = span.slice(start);
  // 剩余部分必须像地名：足够长（≥4），或为 2-8 字前缀 + 镇乡村（王家村）；
  // 裸「街道/镇上」等碎片不算（避免「他在街道」被剥成「街道」后误脱敏）
  const placeOk = rest.length >= 4 || /^[一-龥]{2,8}(?:镇|乡|街道|村)$/.test(rest);
  return placeOk ? start : 0;
}
export const ORG_WORDS = ['人民法院', '人民法庭', '铁路运输法院', '互联网法院', '知识产权法院', '金融法院', '海事法院', '军事法院', '人民检察院', '人大常委会', '纪律检查委员会', '监察委员会', '市场监督管理局', '仲裁委员会', '仲裁院', '人民政府', '律师事务所', '公证处', '鉴定所', '看守所', '拘留所', '公安厅', '公安分局', '公安局', '检察院', '派出所', '分局', '仲裁委', '司法局', '司法所', '税务局', '管理局', '管理委员会', '管委会', '人大', '政协', '办事处', '街道办事处', '居民委员会', '村民委员会', '村委会', '居委会'];
export const ORG_LIMIT = '中级高级基层第一第二铁路海事知识产权互联网金融监察纪律检查人民审判全国中央';
export const PROVINCES = '京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼';
export const ADDR_CTX = ['户籍所在地', '户口所在地', '户籍地址', '经常居住地', '实际居住地', '住所地', '户籍地', '联系地址', '注册地址', '送达地址', '现住址', '现住', '居住地', '住址', '地址'];
export const DOB_CTX = ['出生日期', '出生年月', '出生时间', '出生', '生日', '生于'];
/** 银行卡上下文词（出现时对 16-19 位数字做宽松识别） */
export const BANK_CTX = ['银行卡号', '卡号', '账号', '开户行', '收款账户', '储蓄卡', '信用卡', '借记卡', '银行账户'];

export function validId18(s) {
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(s[i]) * w[i];
  return codes[sum % 11] === s[17].toUpperCase();
}
/** 18 位号码中段是否为合理出生日期（YYYYMMDD）——用于「长得像身份证」的宽松识别 */
export function looksLikeId18(s) {
  const d = s.slice(6, 14);
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(d);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}
export function validLuhn(s) {
  let sum = 0, alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = Number(s[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
const USCC_DIGITS = '0123456789';
const USCC_CHARS = USCC_DIGITS + 'ABCDEFGHJKLMNPQRTUWXY';
const USCC_W = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
export function validUscc(s) {
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += USCC_CHARS.indexOf(s[i]) * USCC_W[i];
  const r = sum % 31;
  const check = r === 0 ? 0 : 31 - r;
  return USCC_CHARS[check] === s[17];
}

export const CN_RULES = [
  { cat: 'id18', re: /(?<![0-9])\d{17}[\dXx](?![0-9])/g, validator: (s) => validId18(s) },
  { cat: 'id15', re: new RegExp('(身份证号码|身份证号|身份证|证件号码|证件号|身份证明号码)\\s*[:：]?\\s*([0-9]{15})(?!\\d)', 'g'), secretGroup: 2 },
  { cat: 'uscc', re: /(?<![0-9A-Za-z])[0-9A-HJ-NPQRTUWXY]{18}(?![0-9A-Za-z])/g, validator: (s) => validUscc(s) },
  { cat: 'mobile', re: /(?<![0-9])(1[3-9]\d{9})(?![0-9])/g },
  // 带空格/横线分隔的手机号（138 0013 8000 / 138-0013-8000）
  { cat: 'mobile', re: /(?<![0-9])1[3-9]\d[\s-]\d{4}[\s-]\d{4}(?![0-9])/g },
  { cat: 'tel', re: /(?<![0-9])(0\d{2,3}[\s-]?\d{7,8})(?![0-9])/g },
  // 中国即时通讯/执业标识（上下文识别，避免误伤普通字母数字串）
  { cat: 'wechat', re: /(?:微信号|微信|WeChat|Wechat|wechat|weixin|Weixin|VX)\s*[:：]?\s*([A-Za-z][A-Za-z0-9_-]{4,19})(?![A-Za-z0-9_-])/g, secretGroup: 1 },
  { cat: 'qq', re: /(?:QQ|qq|扣扣|QQ号|qq号|Q号|企鹅号)\s*[:：]?\s*([1-9]\d{4,11})(?!\d)/g, secretGroup: 1 },
  { cat: 'certid', re: /(?:律师执业证|执业证号|执业证书号|执业证编号|法律职业资格证)\s*[:：]?\s*([A-Za-z0-9-]{8,20})(?![A-Za-z0-9-])/g, secretGroup: 1 },
  // 银行卡：有上下文词时 16-19 位 + Luhn；无上下文时仅 16/19 位 + Luhn（17/18 位更可能是身份证/订单号，避免误伤）
  // 有银行卡上下文词时 16-19 位即脱敏（用户已明确标注为卡号，不再校验 Luhn）
  { cat: 'bank', re: new RegExp('(' + BANK_CTX.join('|') + ')\\s*[:：]?\\s*(\\d{16,19})', 'g'), secretGroup: 2 },
  { cat: 'bank', re: /(?<![0-9])(?:\d{16}|\d{19})(?![0-9])/g, validator: (s) => validLuhn(s) },
  { cat: 'case', re: /[（(]\s*\d{4}\s*[）)]\s*[^\s（）()]{2,14}\d{1,8}\s*号/g },
  { cat: 'plate', re: new RegExp('(?<![0-9A-Za-z])[' + PROVINCES + '][A-Z](?:[DF][A-HJ-NP-Z0-9]{5}|[A-HJ-NP-Z0-9]{5})(?![0-9A-Za-z])', 'g') },
  { cat: 'passport', re: /(?<![0-9A-Za-z])([EGCHT]\d{8})(?![0-9A-Za-z])/g },
  { cat: 'dob', re: new RegExp('(' + DOB_CTX.join('|') + ')\\s*[:：]?\\s*(\\d{4}\\s*[年./-]\\s*\\d{1,2}\\s*[月./-]\\s*\\d{1,2}\\s*[日号]?)', 'g'), secretGroup: 2 },
  { cat: 'addr', re: new RegExp('(' + ADDR_CTX.join('|') + ')\\s*[:：]?\\s*([^\\n。；;，,\\[]{4,60})', 'g'), secretGroup: 2 },
  // 「住所：」是法律文书高频地址前缀（不在 ADDR_CTX，避免「住所证明」等无冒号场景误伤）
  { cat: 'addr', re: /住所\s*[:：]\s*([^\n。；;，,\[]{4,60})/g, secretGroup: 1 },
  {
    cat: 'org', fn: (text, engine, rctx) => {
      const keyRe = new RegExp('(?:' + ORG_WORDS.join('|') + ')', 'g');
      let out = text;
      let changed = false;
      const found = [];
      let m;
      keyRe.lastIndex = 0;
      while ((m = keyRe.exec(out)) !== null) {
        const key = m[0];
        let start = m.index;
        let prefix = '';
        while (start > 0 && m.index - start < 14 && hanRe.test(out[start - 1])) {
          // 「和」不截断：机关名常含「中华人民共和国」；仅「与/及/或」作为并列机关边界
          if ('与及或'.includes(out[start - 1])) break;
          start--;
          prefix = out.slice(start, m.index);
        }
        if (prefix.length === 0) continue;
        const trimmedPrefix = trimOrgPrefix(prefix);
        if (trimmedPrefix.length === 0) continue;
        const trimLen = prefix.length - trimmedPrefix.length;
        start += trimLen;
        let trimmed = trimmedPrefix;
        // 代词剥离（「冻结其在毕节市公安局」→「毕节市公安局」）
        const stripped = stripPronounPrefix(trimmed, start);
        trimmed = stripped.trimmed;
        start = stripped.start;
        if (trimmed.length === 0) continue;
        // 单字介词剥离（「在/去/从/到」），与公司规则保持一致
        while (trimmed.length >= 2 && '在去从到'.includes(trimmed[0])) {
          start += 1;
          trimmed = trimmed.slice(1);
        }
        prefix = trimmed;
        const limited = [...ORG_LIMIT].some((c) => prefix.includes(c));
        if (!limited && prefix.length < 2) continue;
        const spanText = out.slice(start, m.index + key.length);
        if (engine.isPreserved(spanText)) continue;
        found.push({ start, len: m.index + key.length - start, text: spanText });
      }
      // 相邻机关名（公安局/分局/派出所）前缀回溯会重叠：按 start 升序、len 降序排序，
      // 只保留互不重叠的最长 span（后面的短项若被覆盖则丢弃），避免占位符错位拼接
      found.sort((a, b) => a.start - b.start || b.len - a.len);
      const merged = [];
      for (const f of found) {
        const last = merged[merged.length - 1];
        if (last !== undefined && f.start < last.start + last.len) continue;
        merged.push(f);
      }
      for (const f of merged) f.placeholder = engine.placeholder('org', f.text, rctx);
      for (let i = merged.length - 1; i >= 0; i--) {
        const f = merged[i];
        out = out.slice(0, f.start) + f.placeholder + out.slice(f.start + f.len);
        changed = true;
      }
      return { changed, text: out };
    },
  },
  // 左边界把「占位符结尾 ]」也视为汉字：前序规则替换后的文本在第一轮与第二轮
  // 保持一致，避免地址/街道规则在第二轮产生新匹配（破坏幂等性）
  // 镇乡村结尾的地址链：后不能跟道路字（避免「中关村大街」被截成「中关村」）
  {
    cat: 'addrchain', fn: (text, engine, rctx) => {
      const re = new RegExp('(?:(?<=位于|在|名下|住址|住所|地址|居住|常住|家住|现住|住)|(?<![' + HAN + '\\]]))(?:[' + HAN + ']{1,6}?(?:省|市))?(?:[' + HAN + ']{1,8}?(?:市|自治州|地区|盟))?(?:[' + HAN + ']{1,8}?(?:区|县|旗|市))?[' + HAN + ']{1,8}?(?:镇|乡|街道|村)(?![号大道路街巷])', 'g');
      let out = text;
      const found = [];
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(out)) !== null) {
        let start = m.index;
        let span = m[0];
        // 剥离链首介词（「住广东省…」「位于上海市…」），介词保留在原文
        const pre = stripChainPrep(span);
        if (pre > 0) {
          start += pre;
          span = span.slice(pre);
        }
        // 剔除「我们村/本村/回村/去镇上/在街道」等泛指用法（王家村/碧阳街道等真实地址链保留）
        const mm = /^(.*?)(?:镇|乡|街道|村)$/.exec(span);
        if (mm !== null) {
          const local = mm[1];
          if (/^(我|你|他|她|它|咱)[们]?$/.test(local)
            || /^(本|邻|各|全|回|进|出|去|在|到|住|走|来|某|该|这|那|隔壁|乡)$/.test(local)
            || /^[一-龥]{1,3}[在去回到上进出来走住]$/.test(local)) {
            re.lastIndex = m.index + m[0].length;
            continue;
          }
        }
        if (engine.isPreserved(span)) {
          re.lastIndex = m.index + m[0].length;
          continue;
        }
        found.push({ start, len: span.length, text: span });
        re.lastIndex = m.index + m[0].length;
      }
      if (found.length === 0) return { changed: false, text: out };
      for (const f of found) f.placeholder = engine.placeholder('addrchain', f.text, rctx);
      for (let i = found.length - 1; i >= 0; i--) {
        const f = found[i];
        out = out.slice(0, f.start) + f.placeholder + out.slice(f.start + f.len);
      }
      return { changed: true, text: out };
    },
  },
  // 省市区 + 道路的完整地址链（「贵州省…七星关区碧阳大道」「位于广州市天河区体育西路」）；
  // 要求省市前缀 + 区县级，左边界允许「位于/在/名下/住址/住所」等介词（避免机构名+路名误吞）
  {
    cat: 'addrchain', fn: (text, engine, rctx) => {
      const re = new RegExp('(?:(?<=位于|在|名下|住址|住所|地址|居住|常住|家住|现住|住)|(?<![' + HAN + '\\]]))(?:[' + HAN + ']{1,6}?(?:省|市))?(?:[' + HAN + ']{1,8}?(?:市|自治州|地区|盟))?[' + HAN + ']{1,8}?(?:区|县|旗)[' + HAN + ']{1,8}?(?:大道|路|街|巷)', 'g');
      let out = text;
      const found = [];
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(out)) !== null) {
        let start = m.index;
        let span = m[0];
        const pre = stripChainPrep(span);
        if (pre > 0) {
          start += pre;
          span = span.slice(pre);
        }
        if (engine.isPreserved(span)) {
          re.lastIndex = m.index + m[0].length;
          continue;
        }
        found.push({ start, len: span.length, text: span });
        re.lastIndex = m.index + m[0].length;
      }
      if (found.length === 0) return { changed: false, text: out };
      for (const f of found) f.placeholder = engine.placeholder('addrchain', f.text, rctx);
      for (let i = found.length - 1; i >= 0; i--) {
        const f = found[i];
        out = out.slice(0, f.start) + f.placeholder + out.slice(f.start + f.len);
      }
      return { changed: true, text: out };
    },
  },
  { cat: 'street', re: new RegExp('(?<![' + HAN + '\\]])[' + HAN + ']{2,8}(?:区|街道|路|大道|街|巷)[' + HAN + '\\d]{0,12}号?(?![0-9])', 'g'), validator: (s) => {
    // 成语/泛指（大街小巷、走街串巷、街头巷尾）与生活名词（园区/小区/高速公路）不是街道名
    if (/^(大街小巷|走街串巷|街头巷尾)/.test(s)) return false;
    if (s.includes('园区')) return false;
    if (/^(该|某|本|这|那|一|各|全|住宅|商品|回迁|安置|大型|小型|高档|老旧)(个)?小区$/.test(s)) return false;
    if (/^高速/.test(s)) return false;
    if (/工业区$/.test(s)) return false;
    // 大区/大湾区等宏观区域不是街道名（「华南区」「大湾区」）；「西南路」等真实路名不受影响
    if (/(华北|华南|华东|华中|西南|西北|东北)区|大湾区/.test(s)) return false;
    // 代词/人称/短词 + 介词（我在街道、爸爸去马路、走在路上）是泛指用法
    if (/^[一-龥]{1,3}[在去走到上回进出]/.test(s)) return false;
    return true;
  } },
  {
    cat: 'name', fn: (text, engine, rctx) => {
      // 「被告一/被告二/被告1」等编号被告在诉讼文书中常见：上下文词后允许中文数字/阿拉伯数字编号
      const numberedCtx = '(?:' + NAME_CTX.join('|') + ')(?:[一二三四五六七八九十百0-9]+)?';
      const ctxRe = new RegExp('(' + numberedCtx + ')\\s*[:：]?\\s*(?:是|为|系|叫)?\\s*', 'g');
      // 上限 12：让长动词短语（物业服务合同纠纷/借款纠纷一案等）进入候选后由 NAME_TAILS 剥离
      const nameRe = new RegExp('^[' + HAN + ']{2,12}');
      // 从上下文后最多取 6 个汉字（含可能粘连的动词/助词），
      // 逐段裁掉尾部虚词后取第一个 2-4 字、以常见姓开头的候选；
      // 裁掉过虚词视为自然边界，否则下一个字符必须是助词/标点/结尾。
      function pickName(rest) {
        const max = (rest.match(nameRe) || [''])[0];
        // 诉讼格式「原告X诉被告Y」：X后紧跟「诉」时直接识别 X，保留「诉」
        const sue = rest.match(/^([一-龥]{2,4})(诉)/);
        if (sue !== null && SURNAMES.includes(sue[1][0])) {
          return sue[1];
        }
        for (let len = max.length; len >= 2; len--) {
          let name = rest.slice(0, len);
          let tail = 0;
          // 多轮交替剥离：字段标签（住址/出生日期/微信号/常住…）可能叠在助词之后
          // （「李小红常住」「王小明住在」），逐轮裁 NAME_TAILS 与单字虚词直到无变化，
          // 避免「张三生日是」裁掉「是」后暴露「生日」仍被吞（漏裁）或「王小明住在」吞掉「住」
          for (let round = 0; round < 8; round++) {
            let progressed = false;
            // 先尝试多字尾词（认为/主张/诉称/借款纠纷/住址/出生日期…）再逐字裁单字虚词；
            // 优先匹配最长尾词（避免「合同纠纷」先于「服务合同纠纷」匹配，吞掉「服务」）
            let bestT = null;
            for (const t of NAME_TAILS) {
              if (name.length - t.length >= 2 && name.endsWith(t) && (bestT === null || t.length > bestT.length)) {
                bestT = t;
              }
            }
            if (bestT !== null) {
              name = name.slice(0, -bestT.length);
              tail += bestT.length;
              progressed = true;
            }
            // 保留边界词（认为/以为/因/诉）：命中则不再往下裁，姓名与动词分别保留
            for (const t of NAME_KEEP_TAILS) {
              if (name.length - t.length >= 2 && name.endsWith(t)) {
                name = name.slice(0, -t.length);
                progressed = true;
                break;
              }
            }
            // 尾字虚词裁剪：2 字名不进入（length>2 保证「李强」的「强」不被裁）
            if (name.length > 2 && NAME_TAIL_CHARS.includes(name[name.length - 1])) {
              name = name.slice(0, -1);
              tail += 1;
              progressed = true;
            }
            if (!progressed) break;
          }
          if (name.length < 2 || name.length > 4) continue;
          // 候选名内含虚词（的/了/与/和/或…）不是合法姓名（如「王芳的联」），跳过该长度
          if ([...NAME_PARTICLES].some((ch) => name.includes(ch))) continue;
          const first = name[0];
          if (!SURNAMES.includes(first)) continue;
          const next = rest.slice(name.length)[0];
          const boundary = !next
            || !/[\u4e00-\u9fa5A-Za-z]/.test(next)
            || NAME_PARTICLES.includes(next)
            || NAME_TAILS.some((t) => rest.startsWith(name + t))
            || NAME_KEEP_TAILS.some((t) => rest.startsWith(name + t))
            || '，,。；;、：:（()）"\' '.includes(next);
          if (boundary || tail > 0) return name;
        }
        return null;
      }
      let out = text;
      let changed = false;
      const found = [];
      let m;
      let consumedUntil = -1;
      ctxRe.lastIndex = 0;
      while ((m = ctxRe.exec(out)) !== null) {
        // 跳过已被更长上下文词覆盖的位置（如「控股股东」已含「股东」）
        if (m.index < consumedUntil) {
          ctxRe.lastIndex = m.index + 1;
          continue;
        }
        let idx = m.index + m[0].length;
        let rest = out.slice(idx);
        // 支持「被告（李小红）」「被告 (李小红)」括号包裹：括号本身不入姓名
        const bracket = rest.match(/^[（(]\s*/);
        if (bracket !== null) {
          idx += bracket[0].length;
          rest = rest.slice(bracket[0].length);
        }
        // 「被告方王五」：方 是角色词后缀；若剥离后能取到姓名则优先取（「方明」等方姓姓名走回退保留）
        if (rest[0] === '方' && SURNAMES.includes(rest[1]) && pickName(rest.slice(1)) !== null) {
          idx += 1;
          rest = rest.slice(1);
        }
        // 上下文后支持顿号/逗号分隔的连续姓名（如「被告张三、李四、王五」）
        let name = pickName(rest);
        while (name !== null) {
          found.push({ start: idx, name });
          const after = rest.slice(name.length);
          // 及/和/与 也作为并列分隔（「被告张三及李四共同…」）；其后非姓名时 pickName 返回 null 自动停止
          const sep = /^[、，,及和与]\s*/.exec(after);
          if (sep !== null) {
            idx += name.length + sep[0].length;
            rest = after.slice(sep[0].length);
          } else {
            // 亲属关系链（「被告张三之父王大明」「被告王五的妻子李四」）后的姓名继续识别
            const kin = /^(之父|之母|之妻|之夫|之子|之女|的丈夫|的妻子|的儿子|的女儿|的父亲|的母亲|的配偶)\s*/.exec(after);
            if (kin === null) break;
            idx += name.length + kin[0].length;
            rest = after.slice(kin[0].length);
          }
          name = pickName(rest);
        }
        consumedUntil = idx;
        ctxRe.lastIndex = m.index + 1;
      }
      // 白名单：命中的值即使符合规则也保留原文
      for (let i = found.length - 1; i >= 0; i--) {
        if (engine.isPreserved(found[i].name)) found.splice(i, 1);
      }
      // 本次已识别的姓名（当事人）在文档后续无上下文出现时（如判决主文）也脱敏
      const knownNames = [...new Set(found.map((f) => f.name))];
      for (const name of knownNames) {
        if (engine.isPreserved(name)) continue;
        let idx = 0;
        while ((idx = out.indexOf(name, idx)) >= 0) {
          // 跳过已替换区间（start 在 found 覆盖范围内的位置由后续统一替换处理；此处只补未覆盖的）
          const covered = found.some((f) => idx >= f.start && idx < f.start + f.name.length);
          if (!covered) {
            found.push({ start: idx, name });
            idx += name.length;
          } else {
            idx += name.length;
          }
        }
      }
      // 按文档顺序排序编号，保证占位符序号与出现顺序一致；从后往前替换避免错位
      found.sort((a, b) => a.start - b.start);
      for (const f of found) f.placeholder = engine.placeholder('name', f.name, rctx);
      for (let i = found.length - 1; i >= 0; i--) {
        const f = found[i];
        out = out.slice(0, f.start) + f.placeholder + out.slice(f.start + f.name.length);
        changed = true;
      }
      return { changed, text: out };
    },
  },
  {
    cat: 'company', fn: (text, engine, rctx) => {
      const keyRe = new RegExp('(?:' + ORG_KEYS.join('|') + ')', 'g');
      let out = text;
      let changed = false;
      const found = [];
      let m;
      keyRe.lastIndex = 0;
      while ((m = keyRe.exec(out)) !== null) {
        const key = m[0];
        let start = m.index;
        let prefix = '';
        while (start > 0 && m.index - start < 12 && ORG_NAME_CHARS.test(out[start - 1])) {
          // 「和」不截断：公司名可含「和」（如「和记黄埔」）；仅「与/及/或」作为并列边界
          if ('与及或'.includes(out[start - 1])) break;
          start--;
          prefix = out.slice(start, m.index);
        }
        if (prefix.length < 2) continue;
        // 从头部裁掉「查询/委托/向」等动词/介词，避免被吞进占位符
        const trimmedPrefix = trimOrgPrefix(prefix);
        if (trimmedPrefix.length < 2) continue;
        const trimLen = prefix.length - trimmedPrefix.length;
        start += trimLen;
        let trimmed = trimmedPrefix;
        const stripped = stripPronounPrefix(trimmed, start);
        trimmed = stripped.trimmed;
        start = stripped.start;
        prefix = trimmed;
        // 裁掉代词后再剥离「公司为/公司系/公司是/公司由」（如「该公司为广州…公司」）
        for (const k of ORG_KEYS) {
          const m2 = trimmed.match(new RegExp('^' + k + '(为|系|是|由)'));
          if (m2 !== null && trimmed.length - m2[0].length >= 2) {
            start += m2[0].length;
            trimmed = trimmed.slice(m2[0].length);
            break;
          }
        }
        if (trimmed.length < 2) continue;
        // 组合后缀（集团有限公司/控股有限公司/银行股份公司）或前缀含强标识词即视为强后缀
        let strongSuffix = [...ORG_STRONG].some((w) => key.includes(w) || trimmed.includes(w));
        // 常见生活名词（学校/医院/银行/酒店/工厂/大学/中学…）需排除泛指前缀：
        // 「小明在学校」「那家酒店」「上个月学校放假」「深圳有一所医院」不是机构名
        // （招商银行/清华大学/深圳市第一人民医院等真实机构不受影响）
        if (strongSuffix && ORG_COMMON_STRONG.some((w) => key.includes(w) || trimmed.includes(w)) && isGenericOrgPrefix(trimmed)) continue;
        const cityHit = CITY_WORDS.some((w) => {
          const i = trimmed.indexOf(w);
          const next = trimmed[i + w.length];
          return i >= 0 && (next === undefined || !'的与和及或'.includes(next));
        });
        const brandHit = BRAND_WORDS.some((w) => {
          const i = trimmed.indexOf(w);
          const next = trimmed[i + w.length];
          return i >= 0 && (next === undefined || !'的与和及或'.includes(next));
        });
        // 拉丁字母/数字组合前缀（3M中国/IBM中国/华为Mate60）：结构化字号，视为专名
        const latinHit = /[A-Za-z]{2,}/.test(trimmed) || /[A-Za-z][0-9]|[0-9][A-Za-z]/.test(trimmed);
        if (!strongSuffix
          && !new RegExp('[' + REGION_CHARS + ']').test(trimmed)
          && !INDUSTRY_WORDS.some((w) => trimmed.includes(w))
          && !cityHit
          && !brandHit
          && !latinHit) continue;
        // 泛指判定通过后，剥离前缀中的单字介词（在/去/从/到），
        // 避免「冻结其在中国工商银行」把「在」吞进公司占位符（不影响「小明在学校」等泛指判定）
        while (trimmed.length >= 2 && '在去从到'.includes(trimmed[0])) {
          start += 1;
          trimmed = trimmed.slice(1);
        }
        const spanText = out.slice(start, m.index + key.length);
        // 市中心/县城中心/镇中心 等泛指不是机构名
        if (/^(市|县|镇|村)中心$/.test(spanText)) continue;
        if (engine.isPreserved(spanText)) continue;
        found.push({ start, len: m.index + key.length - start, text: spanText });
      }
      for (const f of found) f.placeholder = engine.placeholder('company', f.text, rctx);
      // 相邻公司后缀回溯会重叠（如「科技有限公司」+「控股」）：按 start 升序、len 降序排序，
      // 丢弃被覆盖的短项，避免占位符错位拼接
      found.sort((a, b) => a.start - b.start || b.len - a.len);
      const merged = [];
      for (const f of found) {
        const last = merged[merged.length - 1];
        if (last !== undefined && f.start < last.start + last.len) continue;
        merged.push(f);
      }
      for (const f of merged) f.placeholder = engine.placeholder('company', f.text, rctx);
      for (let i = merged.length - 1; i >= 0; i--) {
        const f = merged[i];
        out = out.slice(0, f.start) + f.placeholder + out.slice(f.start + f.len);
        changed = true;
      }
      return { changed, text: out };
    },
  },
];

/**
 * 按配置构建活动规则列表（规则顺序即替换顺序，幂等性依赖此顺序稳定）。
 */
export function buildActiveRules(cfg) {
  const list = [];
  // 自定义词表优先：精确匹配，不被后续通用规则干扰
  if (cfg.customTerms.length > 0) {
    list.push({
      cat: 'custom', fn: (text, engine, rctx) => {
        let out = text;
        let changed = false;
        for (const term of cfg.customTerms) {
          if (term === '') continue;
          let idx = 0;
          while (idx < out.length) {
            const i = out.indexOf(term, idx);
            if (i < 0) break;
            // 精确子串匹配：词表由用户维护，命中即脱敏（含于长词时同样命中）
            if (engine.isPreserved(term)) { idx = i + term.length; continue; }
            const p = engine.placeholder('custom', term, rctx);
            out = out.slice(0, i) + p + out.slice(i + term.length);
            changed = true;
            idx = i + p.length;
          }
        }
        return { changed, text: out };
      },
    });
  }
  for (const rule of RULES) {
    if (rule.cat === 'pem' || rule.cat === 'jwt' || rule.cat === 'key') {
      if (cfg.redactCredentials) list.push(rule);
    } else if (rule.cat === 'hex' || rule.cat === 'b64') {
      if (cfg.longTokens) list.push(rule);
    } else {
      list.push(rule); // email/phone/ipv4/ipv6（PII，默认始终脱敏）
    }
  }
  if (cfg.redactPaths) list.push(...PATH_RULES);
  if (cfg.cnEntities) {
    for (const rule of CN_RULES) {
      if (rule.cat === 'addr' || rule.cat === 'addrchain' || rule.cat === 'street') {
        if (cfg.redactAddress) list.push(rule);
      } else if (rule.cat === 'name') {
        if (cfg.redactNames) list.push(rule);
      } else if (rule.cat === 'company') {
        if (cfg.redactCompanies) list.push(rule);
      } else if (rule.cat === 'org') {
        if (cfg.redactOrgs) list.push(rule);
      } else if (rule.cat === 'case') {
        if (cfg.redactCaseNumbers) list.push(rule);
      } else if (rule.cat === 'dob') {
        if (cfg.redactDob) list.push(rule);
      } else {
        list.push(rule); // id18/id15/uscc/mobile/tel/bank/plate/passport（证件/PII，默认始终脱敏）
      }
    }
    // 带「身份证号/证件号」上下文的 18 位号码始终脱敏：作者已明确标注为证件号，
    // 不依赖校验位（修复校验位不合法的身份证在严格模式下明文漏出的问题）
    list.push({ cat: 'id18', re: /(身份证号码|身份证号|身份证|证件号码|证件号|身份证明号码)\s*[:：]?\s*(\d{17}[\dXx])(?!\d)/g, secretGroup: 2 });
    // 宽松身份证识别（strictId18=false）：无上下文的号码日期段合理也脱敏
    if (!cfg.strictId18) {
      list.push({ cat: 'id18', re: /(?<![0-9])\d{17}[\dXx](?![0-9])/g, validator: (s) => validId18(s) || looksLikeId18(s) });
    }
  }
  return list;
}
