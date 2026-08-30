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
  { cat: 'ipv6', re: /\b[0-9a-fA-F]{2,4}(?::[0-9a-fA-F]{1,4})*::(?:[0-9a-fA-F]{1,4})*\b/g },
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
export const NAME_CTX = ['法定代表人', '委托代理人', '申请执行人', '被申请人', '被执行人', '申请人', '审判长', '审判员', '人民陪审员', '书记员', '检察员', '检察官', '联系人', '收货人', '代理人', '辩护人', '原告', '被告', '第三人', '债务人', '债权人', '担保人', '出借人', '借款人', '出租人', '承租人', '户主', '董事长', '总经理', '监事', '董事', '股东', '负责人', '姓名', '名字', '签字', '签名', '签章', '经理', '委托人', '被委托人', '委托方', '受托方', '证人', '鉴定人', '经办人', '收件人', '收款人', '付款人', '合伙人', '投资人'];
/** 姓名后允许直接出现的助词/虚词（视为边界，避免漏掉"张三丰的合同"这类三字名） */
export const NAME_PARTICLES = '的了着过呢吧嘛啊呀在把被与和及或为从对向于诉';
/** 姓名后常见动词/助词短语：从候选名尾部裁掉，避免把「认为/行为」等词吞进占位符（按长度降序匹配） */
export const NAME_TAILS = ['请求', '要求', '表示', '提出', '指出', '强调', '主张', '委托', '担任', '负责', '涉嫌', '离婚', '起诉', '上诉', '反诉', '签订', '签署', '结婚', '借款', '拖欠', '抚养', '继承', '经营', '死亡', '失踪'];
/** 姓名后允许出现的单字助词/虚词（候选名尾部的这些字会被裁掉；含多字尾词首字，避免「认为」被截断后残留「认」） */
export const NAME_TAIL_CHARS = '的了着过呢吧嘛啊呀在把被与和及或为从对向于是有等称说认请要表提指强主声委担负涉行';
export const ORG_KEYS = ['有限责任公司', '股份有限公司', '集团有限公司', '有限公司', '集团', '控股', '事务所', '研究所', '研究院', '合作社', '出版社', '银行', '医院', '学校', '学院', '大学', '公司', '工厂', '饭店', '酒店'];
/** 强标识后缀：公司名前缀无需地区/行业词佐证（避免漏掉「阿里巴巴集团」「华为技术有限公司」这类常见公司） */
export const ORG_STRONG = new Set(['集团', '控股', '事务所', '研究所', '研究院', '出版社', '银行', '医院', '学校', '学院', '大学', '工厂', '饭店', '酒店']);
export const REGION_CHARS = '省市自治区县';
export const INDUSTRY_WORDS = ['科技', '技术', '网络', '信息', '贸易', '实业', '建设', '工程', '投资', '金融', '咨询', '文化', '传媒', '物流', '医药', '食品', '服装', '机械', '电子', '软件', '地产', '物业', '装饰', '广告', '管理', '服务', '生物', '能源', '材料', '设计', '教育', '医疗', '汽车', '建筑', '环保', '农业', '旅游', '餐饮', '百货', '置业', '智能', '数据', '互联', '供应链'];
export const PRONOUN = '该本我你他她它我们你们他们贵各双';
export const CONJUNCTIONS = '与和及或';
/** 公司/机关名前常见动词/介词：从候选前缀头部裁掉，避免「查询/委托/向」被吞进占位符 */
export const ORG_PREFIX_VERBS = ['查询', '委托', '联系', '起诉', '控告', '报案', '走访', '前往', '来到', '请求', '要求', '提交', '发送', '交付', '寄送', '递交', '申请', '办理', '协助'];
export const ORG_PREFIX_SINGLES = '请将把由向';
export function trimOrgPrefix(prefix) {
  for (const v of ORG_PREFIX_VERBS) {
    if (prefix.startsWith(v) && prefix.length - v.length >= 2) return prefix.slice(v.length);
  }
  const head = prefix[0];
  if (ORG_PREFIX_SINGLES.includes(head) && prefix.length >= 3) return prefix.slice(1);
  return prefix;
}
export const ORG_WORDS = ['人民法院', '人民检察院', '纪律检查委员会', '监察委员会', '市场监督管理局', '仲裁委员会', '人民政府', '律师事务所', '公安厅', '公安局', '检察院', '派出所', '仲裁委', '司法局', '司法所', '税务局', '人大', '政协'];
export const ORG_LIMIT = '中级高级基层第一第二铁路海事知识产权互联网金融监察纪律检查人民审判';
export const PROVINCES = '京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼';
export const ADDR_CTX = ['住所地', '户籍地', '联系地址', '注册地址', '送达地址', '现住址', '居住地', '住址', '地址'];
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
  { cat: 'tel', re: /(?<![0-9])(0\d{2,3}-?\d{7,8})(?![0-9])/g },
  // 中国即时通讯/执业标识（上下文识别，避免误伤普通字母数字串）
  { cat: 'wechat', re: /(?:微信号|微信|WeChat|Wechat|wechat|weixin|Weixin|VX)\s*[:：]?\s*([A-Za-z][A-Za-z0-9_-]{4,19})(?![A-Za-z0-9_-])/g, secretGroup: 1 },
  { cat: 'qq', re: /(?:QQ|qq|扣扣|QQ号|qq号|Q号|企鹅号)\s*[:：]?\s*([1-9]\d{4,11})(?!\d)/g, secretGroup: 1 },
  { cat: 'certid', re: /(?:律师执业证|执业证号|执业证书号|执业证编号|法律职业资格证)\s*[:：]?\s*([A-Za-z0-9-]{8,20})(?![A-Za-z0-9-])/g, secretGroup: 1 },
  // 银行卡：有上下文词时 16-19 位 + Luhn；无上下文时仅 16/19 位 + Luhn（17/18 位更可能是身份证/订单号，避免误伤）
  { cat: 'bank', re: new RegExp('(' + BANK_CTX.join('|') + ')\\s*[:：]?\\s*(\\d{16,19})', 'g'), secretGroup: 2, validator: (s) => validLuhn(s) },
  { cat: 'bank', re: /(?<![0-9])(?:\d{16}|\d{19})(?![0-9])/g, validator: (s) => validLuhn(s) },
  { cat: 'case', re: /[（(]\s*\d{4}\s*[）)]\s*[^\s（）()]{2,14}\d{1,8}\s*号/g },
  { cat: 'plate', re: new RegExp('(?<![0-9A-Za-z])[' + PROVINCES + '][A-Z](?:[DF][A-HJ-NP-Z0-9]{5}|[A-HJ-NP-Z0-9]{5})(?![0-9A-Za-z])', 'g') },
  { cat: 'passport', re: /(?<![0-9A-Za-z])([EGCHT]\d{8})(?![0-9A-Za-z])/g },
  { cat: 'dob', re: new RegExp('(' + DOB_CTX.join('|') + ')\\s*[:：]?\\s*(\\d{4}\\s*[年./-]\\s*\\d{1,2}\\s*[月./-]\\s*\\d{1,2}\\s*[日号]?)', 'g'), secretGroup: 2 },
  { cat: 'addr', re: new RegExp('(' + ADDR_CTX.join('|') + ')\\s*[:：]?\\s*([^\\n。；;，,\\[]{4,60})', 'g'), secretGroup: 2 },
  // 左边界把「占位符结尾 ]」也视为汉字：前序规则替换后的文本在第一轮与第二轮
  // 保持一致，避免地址/街道规则在第二轮产生新匹配（破坏幂等性）
  { cat: 'addrchain', re: new RegExp('(?<![' + HAN + '\\]])(?:[' + HAN + ']{1,6}?(?:省|市))?(?:[' + HAN + ']{1,8}?(?:市|自治州|地区|盟))?(?:[' + HAN + ']{1,8}?(?:区|县|旗|市))?[' + HAN + ']{1,8}?(?:镇|乡|街道|村)(?![号])', 'g') },
  { cat: 'street', re: new RegExp('(?<![' + HAN + '\\]])[' + HAN + ']{2,8}(?:区|街道|路|大道|街|巷)[' + HAN + '\\d]{0,12}号?(?![0-9])', 'g') },
  {
    cat: 'name', fn: (text, engine, rctx) => {
      const ctxRe = new RegExp('(' + NAME_CTX.join('|') + ')\\s*[:：]?\\s*(?:是|为|系|叫)?\\s*', 'g');
      const nameRe = new RegExp('^[' + HAN + ']{2,6}');
      // 从上下文后最多取 6 个汉字（含可能粘连的动词/助词），
      // 逐段裁掉尾部虚词后取第一个 2-4 字、以常见姓开头的候选；
      // 裁掉过虚词视为自然边界，否则下一个字符必须是助词/标点/结尾。
      function pickName(rest) {
        const max = (rest.match(nameRe) || [''])[0];
        for (let len = max.length; len >= 2; len--) {
          let name = rest.slice(0, len);
          let tail = 0;
          // 先逐字裁掉尾部单字虚词（的/了/为/认…），再尝试裁多字动词短语（认为/主张/委托…）
          while (name.length > 2 && NAME_TAIL_CHARS.includes(name[name.length - 1])) {
            name = name.slice(0, -1);
            tail += 1;
          }
          for (const t of NAME_TAILS) {
            if (name.length - t.length >= 2 && name.endsWith(t)) {
              name = name.slice(0, -t.length);
              tail += t.length;
              break;
            }
          }
          if (name.length < 2 || name.length > 4) continue;
          const first = name[0];
          if (!SURNAMES.includes(first)) continue;
          const next = rest.slice(name.length)[0];
          const boundary = !next
            || !/[\u4e00-\u9fa5A-Za-z0-9]/.test(next)
            || NAME_PARTICLES.includes(next)
            || NAME_TAILS.some((t) => rest.startsWith(name + t))
            || '，,。；;、：:（()）"\' '.includes(next);
          if (boundary || tail > 0) return name;
        }
        return null;
      }
      let out = text;
      let changed = false;
      const found = [];
      let m;
      ctxRe.lastIndex = 0;
      while ((m = ctxRe.exec(out)) !== null) {
        const idx = m.index + m[0].length;
        const rest = out.slice(idx);
        const name = pickName(rest);
        if (name !== null) found.push({ start: idx, name });
        ctxRe.lastIndex = m.index + 1;
      }
      // 白名单：命中的值即使符合规则也保留原文
      for (let i = found.length - 1; i >= 0; i--) {
        if (engine.isPreserved(found[i].name)) found.splice(i, 1);
      }
      // 按文档顺序编号，保证占位符序号与出现顺序一致
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
        while (start > 0 && m.index - start < 12 && hanRe.test(out[start - 1])) {
          if (CONJUNCTIONS.includes(out[start - 1])) break;
          start--;
          prefix = out.slice(start, m.index);
        }
        if (prefix.length < 2) continue;
        // 从头部裁掉「查询/委托/向」等动词/介词，避免被吞进占位符
        const trimmedPrefix = trimOrgPrefix(prefix);
        if (trimmedPrefix.length < 2) continue;
        const trimLen = prefix.length - trimmedPrefix.length;
        start += trimLen;
        prefix = trimmedPrefix;
        let trimmed = prefix;
        for (const ch of PRONOUN) trimmed = trimmed.replace(new RegExp('^' + ch), '');
        if (trimmed.length < 2) continue;
        const strongSuffix = ORG_STRONG.has(key);
        if (!strongSuffix && !new RegExp('[' + REGION_CHARS + ']').test(trimmed) && !INDUSTRY_WORDS.some((w) => trimmed.includes(w))) continue;
        const spanText = out.slice(start, m.index + key.length);
        if (engine.isPreserved(spanText)) continue;
        found.push({ start, len: m.index + key.length - start, text: spanText });
      }
      for (const f of found) f.placeholder = engine.placeholder('company', f.text, rctx);
      for (let i = found.length - 1; i >= 0; i--) {
        const f = found[i];
        out = out.slice(0, f.start) + f.placeholder + out.slice(f.start + f.len);
        changed = true;
      }
      return { changed, text: out };
    },
  },
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
          if (CONJUNCTIONS.includes(out[start - 1])) break;
          start--;
          prefix = out.slice(start, m.index);
        }
        if (prefix.length === 0) continue;
        const trimmedPrefix = trimOrgPrefix(prefix);
        if (trimmedPrefix.length === 0) continue;
        const trimLen = prefix.length - trimmedPrefix.length;
        start += trimLen;
        prefix = trimmedPrefix;
        const limited = [...ORG_LIMIT].some((c) => prefix.includes(c));
        if (!limited && prefix.length < 3) continue;
        const spanText = out.slice(start, m.index + key.length);
        if (engine.isPreserved(spanText)) continue;
        found.push({ start, len: m.index + key.length - start, text: spanText });
      }
      for (const f of found) f.placeholder = engine.placeholder('org', f.text, rctx);
      for (let i = found.length - 1; i >= 0; i--) {
        const f = found[i];
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
    // 宽松身份证识别（strictId18=false）：日期段合理或带「身份证号」上下文也脱敏
    if (!cfg.strictId18) {
      list.push({ cat: 'id18', re: /(?<![0-9])\d{17}[\dXx](?![0-9])/g, validator: (s) => validId18(s) || looksLikeId18(s) });
      list.push({ cat: 'id18', re: /(身份证号码|身份证号|身份证|证件号码|证件号|身份证明号码)\s*[:：]?\s*(\d{17}[\dXx])(?!\d)/g, secretGroup: 2 });
    }
  }
  return list;
}
