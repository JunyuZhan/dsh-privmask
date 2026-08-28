/**
 * dsh-privmask — DeepSeek Harness 本地脱敏插件（Host-only 静态版）。
 *
 * 在 `llm/stream` 水瀑拦截每次发往云端大模型的请求：把密钥、PII、中文实体
 * （姓名/身份证/统一社会信用代码/手机/座机/银行卡/案号/车牌/证件/出生日期/
 * 公司/司法机关/地址
 *
 * 本地会话日志与工具执行不受影响；云端只看到 `[REDACTED_类别_N]` 占位符
 * （同一次请求内同类值映射同一占位符）。
 *
 * @module dsh-privmask
 */
import z from '@deepseek-ai/schemastery';

export const name = 'privmask';

/** 插件名（用于 cordis.yml 挂载行的 id，与 name 一致）。 */
/** 等待 llm 服务就绪后再 apply，否则 ctx.get('llm') 为空导致拦截钩子静默不注册。 */
export const inject = ['llm'];

/** 运行时配置 schema。 */
export const Config = z.object({
  /** 总开关 */
  enabled: z.boolean().default(true),
  /** 路径脱敏（会破坏文件类工具的路径回传，默认关） */
  redactPaths: z.boolean().default(false),
  /** 工具描述/参数 schema 中的敏感信息脱敏（关闭可避免影响模型对工具用途的理解） */
  redactToolMeta: z.boolean().default(true),
  /** 同一会话内跨请求保持同一值映射同一占位符（利于模型跨轮关联实体） */
  persistMapping: z.boolean().default(true),
  /** 非文本内容（图片/文件块）策略：strip=移除后放行(默认), block=拒绝请求, allow=原样透传 */
  nonTextPolicy: z.string().default('strip'),
  /** 长 hex/base64 串脱敏 */
  longTokens: z.boolean().default(true),
  /** 移除 x-deepseek-harness-session-id 关联头 */
  dropSessionId: z.boolean().default(true),
  /** 中文实体识别 */
  cnEntities: z.boolean().default(true),
  /** 身份证 18 位严格校验（默认开）：仅校验位合法的号码脱敏；关闭后日期段合理或带「身份证号」上下文的号码也脱敏 */
  strictId18: z.boolean().default(true),
  /** 入站还原（默认开）：云端返回的占位符在本地还原为原值（响应显示/工具执行用），下次出站会重新脱敏 */
  restoreInbound: z.boolean().default(true),
  /** 凭据类脱敏（密钥/token/密码等，默认开）：模型永远不需要，脱敏零损失 */
  redactCredentials: z.boolean().default(true),
  /** 地址类脱敏（省市区乡/住址，默认开）：当事人隐私核心，起草文书靠入站还原写回真值 */
  redactAddress: z.boolean().default(true),
  /** 姓名脱敏（默认开）：姓名是对象唯一性信息 */
  redactNames: z.boolean().default(true),
  /** 公司名称脱敏（默认开）：法人唯一标识 */
  redactCompanies: z.boolean().default(true),
  /** 机关/单位名称脱敏（默认开）：单位唯一标识 */
  redactOrgs: z.boolean().default(true),
  /** 案号脱敏（默认关）：公开案件标识，不涉及个人隐私，管辖/关联判断需要真值 */
  redactCaseNumbers: z.boolean().default(false),
  /** 出生日期脱敏（默认关）：非唯一信息，年龄/时效计算需要真值 */
  redactDob: z.boolean().default(false),
  /** 严格模式：脱敏异常时拒绝请求（true），绝不把未脱敏数据发往云端 */
  failClosed: z.boolean().default(true),
  /** 严格模式：发现未检查的未知字段（非普通对象/函数等）时拒绝请求 */
  strictUnknown: z.boolean().default(true),
  /** 每次脱敏打印一行统计日志 */
  logRedactions: z.boolean().default(true),
});

// ─────────────────────────── 通用规则 ───────────────────────────

const RULES = [
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

const PATH_RULES = [
  { cat: 'path', re: /\/(?:Users|home|private|var|etc|usr|opt|tmp|root|Applications|Library|System|Volumes|mnt|media)\/[^\s"'`<>[\]{};]{1,200}/g },
  { cat: 'path', re: /[A-Za-z]:\\[^"'\n\s]{1,200}/g },
];

// ─────────────────────────── 中文实体规则 ───────────────────────────

/** 汉字范围（U+4E00..U+9FA5 的实际字符），规避 \u 转义在不同传输层级的差异 */
const HAN = '一-龥';
const hanRe = new RegExp('[' + HAN + ']');
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const NAME_CTX = ['法定代表人', '委托代理人', '申请执行人', '被申请人', '被执行人', '申请人', '审判长', '审判员', '人民陪审员', '书记员', '检察员', '检察官', '联系人', '收货人', '代理人', '辩护人', '原告', '被告', '第三人', '债务人', '债权人', '担保人', '出借人', '借款人', '出租人', '承租人', '户主', '董事长', '总经理', '监事', '董事', '股东', '负责人', '姓名', '名字', '签字', '签名', '签章', '经理', '委托人', '被委托人', '委托方', '受托方', '证人', '鉴定人', '经办人', '收件人', '收款人', '付款人', '合伙人', '投资人'];
/** 姓名后允许直接出现的助词/虚词（视为边界，避免漏掉"张三丰的合同"这类三字名） */
const NAME_PARTICLES = '的了着过呢吧嘛啊呀在把被与和及或为从对向于';
/** 姓名后常见动词/助词短语：从候选名尾部裁掉，避免把「认为/行为」等词吞进占位符（按长度降序匹配） */
const NAME_TAILS = ['请求', '要求', '表示', '提出', '指出', '强调', '主张', '委托', '担任', '负责', '涉嫌'];
/** 姓名后允许出现的单字助词/虚词（候选名尾部的这些字会被裁掉；含多字尾词首字，避免「认为」被截断后残留「认」） */
const NAME_TAIL_CHARS = '的了着过呢吧嘛啊呀在把被与和及或为从对向于是有等称说认请要表提指强主声委担负涉行';
const ORG_KEYS = ['有限责任公司', '股份有限公司', '集团有限公司', '有限公司', '集团', '控股', '事务所', '研究所', '研究院', '合作社', '出版社', '银行', '医院', '学校', '学院', '大学', '公司', '工厂', '饭店', '酒店'];
/** 强标识后缀：公司名前缀无需地区/行业词佐证（避免漏掉「阿里巴巴集团」「华为技术有限公司」这类常见公司） */
const ORG_STRONG = new Set(['集团', '控股', '事务所', '研究所', '研究院', '出版社', '银行', '医院', '学校', '学院', '大学', '工厂', '饭店', '酒店']);
const REGION_CHARS = '省市自治区县';
const INDUSTRY_WORDS = ['科技', '技术', '网络', '信息', '贸易', '实业', '建设', '工程', '投资', '金融', '咨询', '文化', '传媒', '物流', '医药', '食品', '服装', '机械', '电子', '软件', '地产', '物业', '装饰', '广告', '管理', '服务', '生物', '能源', '材料', '设计', '教育', '医疗', '汽车', '建筑', '环保', '农业', '旅游', '餐饮', '百货', '置业', '智能', '数据', '互联', '供应链'];
const PRONOUN = '该本我你他她它我们你们他们贵各双';
const CONJUNCTIONS = '与和及或';
/** 公司/机关名前常见动词/介词：从候选前缀头部裁掉，避免「查询/委托/向」被吞进占位符 */
const ORG_PREFIX_VERBS = ['查询', '委托', '联系', '起诉', '控告', '报案', '走访', '前往', '来到', '请求', '要求', '提交', '发送', '交付', '寄送', '递交', '申请', '办理', '协助'];
const ORG_PREFIX_SINGLES = '请将把由向';
function trimOrgPrefix(prefix) {
  for (const v of ORG_PREFIX_VERBS) {
    if (prefix.startsWith(v) && prefix.length - v.length >= 2) return prefix.slice(v.length);
  }
  const head = prefix[0];
  if (ORG_PREFIX_SINGLES.includes(head) && prefix.length >= 3) return prefix.slice(1);
  return prefix;
}
const ORG_WORDS = ['人民法院', '人民检察院', '纪律检查委员会', '监察委员会', '市场监督管理局', '仲裁委员会', '人民政府', '律师事务所', '公安厅', '公安局', '检察院', '派出所', '仲裁委', '司法局', '司法所', '税务局', '人大', '政协'];
const ORG_LIMIT = '中级高级基层第一第二铁路海事知识产权互联网金融监察纪律检查人民审判';
const PROVINCES = '京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼';
const ADDR_CTX = ['住所地', '户籍地', '联系地址', '注册地址', '送达地址', '现住址', '居住地', '住址', '地址'];
const DOB_CTX = ['出生日期', '出生年月', '出生时间', '出生', '生日', '生于'];
/** 银行卡上下文词（出现时对 16-19 位数字做宽松识别） */
const BANK_CTX = ['银行卡号', '卡号', '账号', '开户行', '收款账户', '储蓄卡', '信用卡', '借记卡', '银行账户'];

function validId18(s) {
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(s[i]) * w[i];
  return codes[sum % 11] === s[17].toUpperCase();
}
/** 18 位号码中段是否为合理出生日期（YYYYMMDD）——用于「长得像身份证」的宽松识别 */
function looksLikeId18(s) {
  const d = s.slice(6, 14);
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(d);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}
function validLuhn(s) {
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
function validUscc(s) {
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += USCC_CHARS.indexOf(s[i]) * USCC_W[i];
  const r = sum % 31;
  const check = r === 0 ? 0 : 31 - r;
  return USCC_CHARS[check] === s[17];
}

const CN_RULES = [
  { cat: 'id18', re: /(?<![0-9])\d{17}[\dXx](?![0-9])/g, validator: (s) => validId18(s) },
  { cat: 'id15', re: new RegExp('(身份证号码|身份证号|身份证|证件号码|证件号|身份证明号码)\\s*[:：]?\\s*([0-9]{15})(?!\\d)', 'g'), secretGroup: 2 },
  { cat: 'uscc', re: /(?<![0-9A-Za-z])[0-9A-HJ-NPQRTUWXY]{18}(?![0-9A-Za-z])/g, validator: (s) => validUscc(s) },
  { cat: 'mobile', re: /(?<![0-9])(1[3-9]\d{9})(?![0-9])/g },
  { cat: 'tel', re: /(?<![0-9])(0\d{2,3}-?\d{7,8})(?![0-9])/g },
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
    cat: 'name', fn: (text, engine) => {
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
      // 按文档顺序编号，保证占位符序号与出现顺序一致
      for (const f of found) f.placeholder = engine.placeholder('name', f.name);
      for (let i = found.length - 1; i >= 0; i--) {
        const f = found[i];
        out = out.slice(0, f.start) + f.placeholder + out.slice(f.start + f.name.length);
        changed = true;
      }
      return { changed, text: out };
    },
  },
  {
    cat: 'company', fn: (text, engine) => {
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
        found.push({ start, len: m.index + key.length - start, text: out.slice(start, m.index + key.length) });
      }
      for (const f of found) f.placeholder = engine.placeholder('company', f.text);
      for (let i = found.length - 1; i >= 0; i--) {
        const f = found[i];
        out = out.slice(0, f.start) + f.placeholder + out.slice(f.start + f.len);
        changed = true;
      }
      return { changed, text: out };
    },
  },
  {
    cat: 'org', fn: (text, engine) => {
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
        found.push({ start, len: m.index + key.length - start, text: out.slice(start, m.index + key.length) });
      }
      for (const f of found) f.placeholder = engine.placeholder('org', f.text);
      for (let i = found.length - 1; i >= 0; i--) {
        const f = found[i];
        out = out.slice(0, f.start) + f.placeholder + out.slice(f.start + f.len);
        changed = true;
      }
      return { changed, text: out };
    },
  },
];

// ─────────────────────────── 引擎（实例级状态） ───────────────────────────

function createEngine(cfg) {
  // 会话级映射：sessionId -> Map<类别, Map<值, 占位符>>；同一会话跨请求保持同值同号
  const sessions = new Map();
  const MAX_SESSIONS = 200;
  const MAX_CAT_ENTRIES = 2000;
  let req = null; // 当前请求状态：{ maps, counts, fields }
  let rulesCache = null;

  function activeRules() {
    if (rulesCache === null) {
      const list = [];
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
      rulesCache = list;
    }
    return rulesCache;
  }

  function beginRequest(sessionId) {
    let maps;
    let seq;
    if (cfg.persistMapping) {
      const key = sessionId ?? '__default__';
      let rec = sessions.get(key);
      if (rec === undefined) {
        rec = { maps: new Map(), seq: new Map() };
        sessions.set(key, rec);
        if (sessions.size > MAX_SESSIONS) {
          // 防止无限会话撑爆内存：淘汰最早的一个
          const oldest = sessions.keys().next().value;
          sessions.delete(oldest);
        }
      }
      maps = rec.maps;
      seq = rec.seq;
    } else {
      maps = new Map();
      seq = new Map();
    }
    req = { maps, counts: new Map(), seq, fields: 0 };
  }

  function placeholder(cat, key) {
    let map = req.maps.get(cat);
    if (map === undefined) { map = new Map(); req.maps.set(cat, map); }
    let p = map.get(key);
    if (p === undefined) {
      // 超限时逐出最旧条目（而非整体清空）：编号单调递增，绝不复用，
      // 保证同会话内占位符语义唯一（旧占位符失效可预期，与入站还原一致）
      while (map.size >= MAX_CAT_ENTRIES) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      const n = (req.seq.get(cat) ?? 0) + 1;
      req.seq.set(cat, n);
      p = '[REDACTED_' + cat.toUpperCase() + '_' + n + ']';
      map.set(key, p);
    }
    req.counts.set(cat, (req.counts.get(cat) ?? 0) + 1);
    return p;
  }

  /** 构建「占位符 → 原值」反向映射（入站还原用，仅本地内存） */
  function reverseMap() {
    const rev = new Map();
    if (!req) return rev;
    for (const catMap of req.maps.values()) {
      for (const [value, ph] of catMap) rev.set(ph, value);
    }
    return rev;
  }

  /** 按会话取「占位符 → 原值」反向映射（展示层还原用，不触碰当前请求状态） */
  function sessionReverseMap(sessionId) {
    const rev = new Map();
    const rec = sessions.get(sessionId ?? '__default__');
    if (rec === undefined) return rev;
    for (const catMap of rec.maps.values()) {
      for (const [value, ph] of catMap) rev.set(ph, value);
    }
    return rev;
  }

  function redactText(text) {
    if (typeof text !== 'string' || text === '') return { changed: false, text };
    let out = text;
    let changed = false;
    for (const rule of activeRules()) {
      if (rule.fn) {
        const r = rule.fn(out, engine);
        if (r.changed) { out = r.text; changed = true; }
        continue;
      }
      rule.re.lastIndex = 0;
      if (!rule.re.test(out)) continue;
      rule.re.lastIndex = 0;
      out = out.replace(rule.re, (...args) => {
        const match = args[0];
        const groups = args.slice(1, args.length - 2);
        const grp = rule.secretGroup;
        const secret = grp !== undefined ? groups[grp - 1] : undefined;
        const key = secret !== undefined ? secret : match;
        if (rule.validator && !rule.validator(key)) return match;
        const p = placeholder(rule.cat, key);
        changed = true;
        return secret !== undefined ? match.replace(secret, p) : p;
      });
    }
    return { changed, text: out };
  }

  function walkBlocks(blocks) {
    let changed = false;
    let blocked = null;
    const out = [];
    for (const block of blocks) {
      if (block.type === 'text' || block.type === 'reasoning') {
        const r = redactText(block.text);
        if (r.changed) { changed = true; req.fields += 1; out.push({ ...block, text: r.text }); }
        else out.push(block);
      } else if (block.type === 'tool-call') {
        const r = redactText(block.arguments);
        if (r.changed) { changed = true; req.fields += 1; out.push({ ...block, arguments: r.text }); }
        else out.push(block);
      } else if (block.type === 'tool-result') {
        const inner = walkBlocks(block.content);
        if (inner.blocked && blocked === null) blocked = inner.blocked;
        if (inner.changed) { changed = true; out.push({ ...block, content: inner.blocks }); }
        else out.push(block);
      } else {
        // 非文本块：image/file/audio/video/未知类型——脱敏插件无法处理，按策略处置
        if (cfg.nonTextPolicy === 'block' && blocked === null) {
          blocked = '检测到非文本内容块（type=' + String(block.type || 'unknown') + '）';
        } else if (cfg.nonTextPolicy === 'strip') {
          changed = true; // 丢弃该块
          continue;
        }
        out.push(block);
      }
    }
    return { changed, blocks: changed ? out : blocks, blocked };
  }

  function walkJson(value, depth) {
    if (depth > 12) {
      // 超出递归深度限制：无法确认深层内容，严格模式下拒绝而非静默透传
      if (cfg.strictUnknown) {
        throw new Error('检测到超出递归深度限制的嵌套字段：为满足「敏感数据不出本地」已拦截请求；若确认该字段不含敏感数据，可设置 strictUnknown=false');
      }
      return { changed: false, value };
    }
    if (typeof value === 'string') {
      const r = redactText(value);
      if (!r.changed) return { changed: false, value };
      req.fields += 1;
      return { changed: true, value: r.text };
    }
    if (Array.isArray(value)) {
      let changed = false;
      const out = value.map((v) => {
        const r = walkJson(v, depth + 1);
        if (r.changed) changed = true;
        return r.value;
      });
      return { changed, value: changed ? out : value };
    }
    if (value !== null && typeof value === 'object') {
      // 非普通对象（Buffer/Date/Map/Set/类实例等）：序列化内容无法确认，
      // 严格模式下拒绝，避免字节/内部字段绕过脱敏原样上云
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        if (cfg.strictUnknown) {
          const name = (value.constructor && value.constructor.name) || Object.prototype.toString.call(value);
          throw new Error('检测到未检查的嵌套对象字段（类型 ' + String(name) + '）：为满足「敏感数据不出本地」已拦截请求；若确认该字段不含敏感数据，可设置 strictUnknown=false');
        }
        return { changed: false, value };
      }
      let changed = false;
      const out = {};
      for (const k of Object.keys(value)) {
        const r = walkJson(value[k], depth + 1);
        if (r.changed) changed = true;
        out[k] = r.value;
      }
      return { changed, value: changed ? out : value };
    }
    return { changed: false, value };
  }

  function walkTools(tools) {
    if (!cfg.redactToolMeta) return { changed: false, tools };
    let changed = false;
    const out = tools.map((tool) => {
      let tChanged = false;
      let description = tool.description;
      if (typeof description === 'string') {
        const r = redactText(description);
        if (r.changed) { tChanged = true; req.fields += 1; description = r.text; }
      }
      const params = walkJson(tool.parameters, 0);
      if (params.changed) tChanged = true;
      if (!tChanged) return tool;
      changed = true;
      const copy = { ...tool };
      if (description !== tool.description) copy.description = description;
      if (params.changed) copy.parameters = params.value;
      return copy;
    });
    return { changed, tools: changed ? out : tools };
  }

  function sanitizeRequest(options) {
    beginRequest(options.sessionId);
    let changed = false;
    let blocked = null;

    const messages = options.messages.map((m) => {
      const r = walkBlocks(m.content);
      if (r.blocked && blocked === null) blocked = r.blocked;
      if (!r.changed) return m;
      changed = true;
      return { ...m, content: r.blocks };
    });

    let system = options.system;
    if (system !== undefined) {
      const r = redactText(system);
      if (r.changed) { changed = true; req.fields += 1; system = r.text; }
    }

    let tools = options.tools;
    if (tools !== undefined && tools.length > 0) {
      const t = walkTools(tools);
      if (t.changed) { changed = true; tools = t.tools; }
    }

    if (blocked !== null) return { blocked };

    const dropSession = cfg.dropSessionId && options.sessionId !== undefined;
    const projected = { ...options };

    // 严格模式：检查并脱敏白名单之外的顶层字段（未来 dsh 新增的附件/元数据等不能静默透传）
    const EXTRA_ALLOW = new Set(['provider', 'model', 'sessionId', 'messages', 'system', 'tools', 'signal']);
    for (const key of Object.keys(options)) {
      if (EXTRA_ALLOW.has(key)) continue;
      const v = options[key];
      if (v === undefined || v === null) continue;
      const t = typeof v;
      if (t === 'string') {
        const r = redactText(v);
        if (r.changed) { changed = true; req.fields += 1; projected[key] = r.text; }
      } else if (t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') {
        // 基础类型不包含可脱敏文本，跳过
      } else if (Array.isArray(v) || (t === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null))) {
        const r = walkJson(v, 0);
        if (r.changed) { changed = true; projected[key] = r.value; }
      } else if (cfg.strictUnknown) {
        throw new Error('检测到未检查的字段 ' + key + '（类型 ' + t + '）：为满足「敏感数据不出本地」已拦截请求；若确认该字段不含敏感数据，可设置 strictUnknown=false');
      }
    }

    if (!changed && !dropSession) return options;
    if (changed) {
      projected.messages = messages;
      if (system !== options.system) projected.system = system;
      if (tools !== options.tools) projected.tools = tools;
    }
    if (dropSession) delete projected.sessionId;
    return projected;
  }

  /** agent/pre-step 落盘遮罩：用户消息在写入会话日志前脱敏（与 llm/stream 共用会话映射） */
  function maskPreStep(sessionId, messages) {
    beginRequest(sessionId);
    let changed = false;
    let blocked = null;
    const out = messages.map((m) => {
      if (m === null || typeof m !== 'object' || !Array.isArray(m.content)) return m;
      const r = walkBlocks(m.content);
      if (r.blocked && blocked === null) blocked = r.blocked;
      if (!r.changed) return m;
      changed = true;
      return { ...m, content: r.blocks };
    });
    return { changed, messages: changed ? out : messages, blocked };
  }

  /** tools/post-execute 落盘遮罩：工具结果在写入会话日志前脱敏 */
  function maskToolResult(sessionId, content) {
    beginRequest(sessionId);
    const r = walkBlocks(content);
    return { changed: r.changed, content: r.blocks, blocked: r.blocked };
  }

  const engine = {
    placeholder, activeRules, redactText, walkBlocks, walkJson, walkTools, sanitizeRequest, maskPreStep, maskToolResult, reverseMap, sessionReverseMap,
    get fields() { return req ? req.fields : 0; },
    get counts() { return req ? req.counts : new Map(); },
  };
  return engine;
}

// ─────────────────────────── 插件主体 ───────────────────────────

export function apply(ctx, config = {}) {
  if (config.nonTextPolicy !== undefined && !['block', 'strip', 'allow'].includes(config.nonTextPolicy)) {
    console.warn('[privmask] 无效的 nonTextPolicy=' + JSON.stringify(config.nonTextPolicy) + '，已回退为 strip（可选值: block/strip/allow）');
  }
  const cfg = {
    enabled: config.enabled ?? true,
    redactPaths: config.redactPaths ?? false,
    redactToolMeta: config.redactToolMeta ?? true,
    persistMapping: config.persistMapping ?? true,
    nonTextPolicy: ['block', 'strip', 'allow'].includes(config.nonTextPolicy) ? config.nonTextPolicy : 'strip',
    longTokens: config.longTokens ?? true,
    dropSessionId: config.dropSessionId ?? true,
    cnEntities: config.cnEntities ?? true,
    strictId18: config.strictId18 ?? true,
    restoreInbound: config.restoreInbound ?? true,
    redactCredentials: config.redactCredentials ?? true,
    redactAddress: config.redactAddress ?? true,
    redactNames: config.redactNames ?? true,
    redactCompanies: config.redactCompanies ?? true,
    redactOrgs: config.redactOrgs ?? true,
    redactCaseNumbers: config.redactCaseNumbers ?? false,
    redactDob: config.redactDob ?? false,
    failClosed: config.failClosed ?? true,
    strictUnknown: config.strictUnknown ?? true,
    logRedactions: config.logRedactions ?? true,
  };

  const llm = ctx.get('llm');
  if (llm === undefined) {
    // 理论上 inject: ['llm'] 已保证服务存在；这里仅作兜底并明确告警
    console.warn('[privmask] llm 服务不可用，脱敏拦截未注册（请确认 dsh-llm 已加载）');
    return;
  }

  const engine = createEngine(cfg);
  const SEEN = new WeakSet();
  const stats = { requests: 0, redacted: 0, fields: 0, blocked: 0, errors: 0, lastError: null };

  function failClosedStream(error) {
    const message = 'privmask: 脱敏失败，请求已被拦截: ' + String(error && error.message ? error.message : error);
    return (async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { message, code: 'PRIVMASK_REDACTION_FAILED' } } };
    })();
  }

  function blockedStream(reason) {
    const message = 'privmask: ' + reason + '（nonTextPolicy=block；如需发送图片/文件请配置为 strip 或 allow）';
    return (async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { message, code: 'PRIVMASK_NON_TEXT_BLOCKED' } } };
    })();
  }

  // 入站还原：把云端返回流里的占位符按会话映射还原为原值（仅本地）。
  // 替换按占位符长度降序，避免 EMAIL_1 与 EMAIL_10 部分匹配；
  // text/reasoning 的 delta 尽力还原，block-end 为权威结果（工具参数以块为准）。
  // 排序在每条流只做一次；无占位符的 chunk 直接短路，避免大映射下的无谓开销。
  function restoreChunkText(text, entries) {
    if (typeof text !== 'string' || text === '' || entries.length === 0 || !text.includes('REDACTED_')) return text;
    let out = text;
    for (const [ph, value] of entries) out = out.split(ph).join(value);
    return out;
  }

  function restoreStream(stream, rev) {
    const entries = [...rev.entries()].sort((a, b) => b[0].length - a[0].length);
    return (async function* () {
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          yield { ...chunk, text: restoreChunkText(chunk.text, entries) };
        } else if (chunk.type === 'block-end') {
          const block = chunk.block;
          if (block.type === 'text' || block.type === 'reasoning') {
            yield { ...chunk, block: { ...block, text: restoreChunkText(block.text, entries) } };
          } else if (block.type === 'tool-call') {
            yield { ...chunk, block: { ...block, arguments: restoreChunkText(block.arguments, entries) } };
          } else {
            yield chunk;
          }
        } else {
          yield chunk;
        }
      }
    })();
  }

  // 核心拦截：llm/stream 水瀑（dsh 唯一请求边界，在 agent-loop 不变式之后运行）。
  //
  // 架构约束（来自 dsh 源码）：
  // 1. agent-loop 构建的请求被 deepFreeze 冻结，且用 WeakSet 标记（isAgentLoopRequest），
  //    因此无法原地修改 options，也无法把脱敏副本塞回原水瀑（next() 只传原参数）。
  // 2. adapter 会按 options.sessionId 发送 x-deepseek-harness-session-id 头，
  //    所以脱敏副本必须删除 sessionId 才能真正去掉该头。
  // 3. 因此脱敏后只能「重入水瀑」：llm.stream(projected) 重新跑一遍水瀑，
  //    我们的 hook 通过 SEEN 放行，其余 hook 只看到脱敏副本；
  //    projected 未被打上 agent-loop 标记，不变式会跳过它，不会误触发校验失败。
  // 4. checkpoint 等前置 hook 在原水瀑中先于我们执行（带 sessionId），
  //    所以会话持久化仍正常；重入后的 checkpoint 因 sessionId 已删而跳过，不会重复。
  // 5. 只有 message.content 会上云（source 元数据不序列化）；reasoning 会上云
  //    （reasoning_content），compaction/session-title 等辅助调用也经过本水瀑——
  //    它们都会被脱敏，本地会话日志（session.events）不受影响，保留原文。
  ctx.on('llm/stream', (options, next) => {
    if (!cfg.enabled || SEEN.has(options)) return next();
    // 展示层还原惰性安装：web profile 中 sessionController 可能晚于插件加载
    if (cfg.restoreInbound) installDisplayRestore();
    try {
      const result = engine.sanitizeRequest(options);
      if (result !== null && typeof result === 'object' && result.blocked !== undefined) {
        stats.requests += 1;
        stats.blocked += 1;
        if (cfg.logRedactions) {
          console.log('[privmask] 已拦截请求 provider=' + options.provider + ' model=' + options.model + ' 原因=' + result.blocked);
        }
        return blockedStream(result.blocked);
      }
      const projected = result;
      if (projected === options) {
        stats.requests += 1;
        return next();
      }
      SEEN.add(projected);
      stats.requests += 1;
      stats.redacted += 1;
      stats.fields += engine.fields;
      if (cfg.logRedactions) {
        console.log('[privmask] 已脱敏请求 provider=' + options.provider + ' model=' + options.model + ' 字段=' + engine.fields + ' ' + JSON.stringify(Object.fromEntries(engine.counts)));
      }
      // 用脱敏后的请求发起流式调用（内层水瀑由 SEEN 放行），并对返回流做本地还原
      const stream = llm.stream(projected);
      if (cfg.restoreInbound) {
        const rev = engine.reverseMap();
        return rev.size > 0 ? restoreStream(stream, rev) : stream;
      }
      return stream;
    } catch (error) {
      stats.errors += 1;
      stats.lastError = String(error && error.message ? error.message : error);
      console.error('[privmask] 脱敏失败（failClosed=' + cfg.failClosed + '）', error);
      stats.requests += 1;
      if (cfg.failClosed) return failClosedStream(error);
      return next();
    }
  });

  // 日志脱敏（方案2）：用户输入与工具结果在写入会话日志前遮罩。
  // agent/pre-step 是 dsh 唯一能在消息落盘前改写内容的水瀑；改写后的消息
  // 同时进入会话日志与 llm/stream（llm/stream 兜底见上，幂等）。
  // 模型回复与工具调用参数仍由 llm/stream 入站还原为真值（方案2 取舍）。
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (!cfg.enabled) return next();
    try {
      const sessionId = agent && agent.session ? agent.session.id : undefined;
      if (sessionId === undefined || sessionId === null || sessionId === '') return next();
      const decision = await next();
      if (decision.kind !== 'enter') return decision;
      const result = engine.maskPreStep(sessionId, decision.messages);
      if (result.blocked !== null) {
        stats.requests += 1;
        stats.blocked += 1;
        if (cfg.logRedactions) {
          console.log('[privmask] 已拒绝用户消息 session=' + sessionId + ' 原因=' + result.blocked);
        }
        return { kind: 'reject' };
      }
      if (!result.changed) return decision;
      stats.requests += 1;
      stats.redacted += 1;
      stats.fields += engine.fields;
      if (cfg.logRedactions) {
        console.log('[privmask] 已脱敏用户消息 session=' + sessionId + ' 字段=' + engine.fields + ' ' + JSON.stringify(Object.fromEntries(engine.counts)));
      }
      return { ...decision, messages: result.messages };
    } catch (error) {
      stats.errors += 1;
      stats.lastError = String(error && error.message ? error.message : error);
      console.error('[privmask] 用户消息脱敏失败（failClosed=' + cfg.failClosed + '）', error);
      if (cfg.failClosed) return { kind: 'reject' };
      return next();
    }
  });

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    if (!cfg.enabled) return next();
    try {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : undefined;
      if (sessionId === undefined || sessionId === null || sessionId === '') return next();
      const decision = await next();
      if (decision.kind !== 'accept' || decision.content === undefined) return decision;
      const result = engine.maskToolResult(sessionId, decision.content);
      if (result.blocked !== null) {
        stats.requests += 1;
        stats.blocked += 1;
        if (cfg.logRedactions) {
          console.log('[privmask] 已拒绝工具结果 tool=' + exec.name + ' 原因=' + result.blocked);
        }
        return { kind: 'block', feedback: [{ type: 'text', text: 'privmask: ' + result.blocked + '（nonTextPolicy=block）' }] };
      }
      if (!result.changed) return decision;
      stats.requests += 1;
      stats.redacted += 1;
      stats.fields += engine.fields;
      if (cfg.logRedactions) {
        console.log('[privmask] 已脱敏工具结果 tool=' + exec.name + ' 字段=' + engine.fields + ' ' + JSON.stringify(Object.fromEntries(engine.counts)));
      }
      return { ...decision, content: result.content };
    } catch (error) {
      stats.errors += 1;
      stats.lastError = String(error && error.message ? error.message : error);
      console.error('[privmask] 工具结果脱敏失败（failClosed=' + cfg.failClosed + '）', error);
      if (cfg.failClosed) return { kind: 'block', feedback: [{ type: 'text', text: 'privmask: 工具结果脱敏失败，已拒绝（failClosed=true）' }] };
      return next();
    }
  });

  // run_code 子派发落盘遮罩（dsh >= 0.1.2 的 tools/ptc-dispatch-log 缝）：
  // PTC 模式下每个 run_code 子派发的 tool/code-dispatch 事件走此水瀑，
  // 与 tools/post-execute 相互独立，需单独遮罩，否则子派发结果以明文落盘
  // （该落盘副本后续会进入会话投影，回到模型上下文）。
  ctx.on('tools/ptc-dispatch-log', async (dispatch, next) => {
    if (!cfg.enabled) return next();
    try {
      const sessionId = (dispatch.agent && dispatch.agent.session
        ? dispatch.agent.session.id
        : dispatch.exec && dispatch.exec.agent && dispatch.exec.agent.session
          ? dispatch.exec.agent.session.id
          : undefined);
      if (sessionId === undefined || sessionId === null || sessionId === '') return next();
      const content = await next();
      const result = engine.maskToolResult(sessionId, content);
      if (result.blocked !== null) {
        // 日志专用缝没有拒绝决策：以安全标记替换落盘副本，程序已拿到原始值
        stats.requests += 1;
        stats.blocked += 1;
        if (cfg.logRedactions) {
          console.log('[privmask] 已拦截 run_code 子派发日志 tool=' + dispatch.name + ' 原因=' + result.blocked);
        }
        return [{ type: 'text', text: '[privmask: 非文本内容已拦截，未写入日志]' }];
      }
      if (!result.changed) return content;
      stats.requests += 1;
      stats.redacted += 1;
      stats.fields += engine.fields;
      if (cfg.logRedactions) {
        console.log('[privmask] 已脱敏 run_code 子派发日志 tool=' + dispatch.name + ' 字段=' + engine.fields + ' ' + JSON.stringify(Object.fromEntries(engine.counts)));
      }
      return result.content;
    } catch (error) {
      stats.errors += 1;
      stats.lastError = String(error && error.message ? error.message : error);
      console.error('[privmask] run_code 子派发日志脱敏失败（failClosed=' + cfg.failClosed + '）', error);
      if (cfg.failClosed) return [{ type: 'text', text: '[privmask: 子派发日志脱敏失败，已拦截（failClosed=true）]' }];
      return next();
    }
  });

  // ── 展示层还原：包装 sessionController.page/follow，在返回浏览器前把占位符
  // 还原为原值（仅本地内存映射；日志仍保持占位符）。
  // dsh gateway 在每次 RPC 调用时用 Reflect.get(receiver, method) 解析方法，
  // 因此实例上的包装方法会生效；若服务不可用（非 web profile 或加载顺序问题）
  // 则静默跳过，不影响脱敏主链路。re-apply/HMR 时用符号保存的原始方法重建包装。
  const DISPLAY_WRAP = Symbol('privmask.displayWrap');
  const DISPLAY_ORIG = Symbol('privmask.displayOrig');

  function displayEntries(sessionId) {
    return [...engine.sessionReverseMap(sessionId).entries()].sort((a, b) => b[0].length - a[0].length);
  }

  function sessionIdOfAddress(address) {
    if (!address || typeof address !== 'object') return undefined;
    if (address.kind === 'session') return address.sessionId;
    if (address.kind === 'subagent') return address.childSessionId;
    return undefined;
  }

  function restoreBlocksForDisplay(blocks, entries) {
    if (!Array.isArray(blocks)) return blocks;
    let changed = false;
    const out = blocks.map((block) => {
      if (block === null || typeof block !== 'object') return block;
      if (block.type === 'text' || block.type === 'reasoning') {
        const t = restoreChunkText(block.text, entries);
        if (t !== block.text) { changed = true; return { ...block, text: t }; }
        return block;
      }
      if (block.type === 'tool-call') {
        const a = restoreChunkText(block.arguments, entries);
        if (a !== block.arguments) { changed = true; return { ...block, arguments: a }; }
        return block;
      }
      if (block.type === 'tool-result') {
        const inner = restoreBlocksForDisplay(block.content, entries);
        if (inner !== block.content) { changed = true; return { ...block, content: inner }; }
        return block;
      }
      return block;
    });
    return changed ? out : blocks;
  }

  function restoreWireData(data, entries) {
    if (data === null || typeof data !== 'object') return data;
    if (data.message && Array.isArray(data.message.content)) {
      const c = restoreBlocksForDisplay(data.message.content, entries);
      if (c !== data.message.content) return { ...data, message: { ...data.message, content: c } };
      return data;
    }
    if (Array.isArray(data.content)) {
      const looksBlocks = data.content.every((b) => b !== null && typeof b === 'object' && typeof b.type === 'string');
      if (looksBlocks) {
        const c = restoreBlocksForDisplay(data.content, entries);
        if (c !== data.content) return { ...data, content: c };
      }
    }
    return data;
  }

  function restoreRecord(record, entries) {
    if (record === null || typeof record !== 'object' || record.type !== 'event') return record;
    const ev = record.event;
    if (!ev || typeof ev !== 'object') return record;
    const data = restoreWireData(ev.data, entries);
    if (data === ev.data) return record;
    return { ...record, event: { ...ev, data } };
  }

  function restoreRecords(records, entries) {
    if (!Array.isArray(records) || records.length === 0 || entries.length === 0) return records;
    let changed = false;
    const out = records.map((r) => {
      const nr = restoreRecord(r, entries);
      if (nr !== r) changed = true;
      return nr;
    });
    return changed ? out : records;
  }

  function installDisplayRestore() {
    if (!cfg.restoreInbound) return;
    let sc;
    try { sc = ctx.get ? ctx.get('sessionController') : ctx.sessionController; } catch { sc = undefined; }
    if (!sc || typeof sc.page !== 'function' || typeof sc.follow !== 'function') return;
    const orig = sc[DISPLAY_ORIG];
    const origPage = orig ? orig.page : sc.page;
    const origFollow = orig ? orig.follow : sc.follow;
    sc[DISPLAY_ORIG] = { page: origPage, follow: origFollow };
    sc[DISPLAY_WRAP] = true;

    sc.page = async (request, signal) => {
      const page = await origPage.call(sc, request, signal);
      if (!page || !Array.isArray(page.records)) return page;
      const entries = displayEntries(sessionIdOfAddress(request && request.address));
      const records = restoreRecords(page.records, entries);
      return records === page.records ? page : { ...page, records };
    };

    sc.follow = async function* (request, signal) {
      const frames = origFollow.call(sc, request, signal);
      const entries = displayEntries(sessionIdOfAddress(request && request.address));
      for await (const frame of frames) {
        if (frame && frame.type === 'snapshot' && Array.isArray(frame.records)) {
          const records = restoreRecords(frame.records, entries);
          if (records !== frame.records) yield { ...frame, records };
          else yield frame;
        } else if (frame && frame.type === 'event' && frame.event && typeof frame.event === 'object') {
          const data = restoreWireData(frame.event.data, entries);
          if (data !== frame.event.data) yield { ...frame, event: { ...frame.event, data } };
          else yield frame;
        } else {
          yield frame;
        }
      }
    };
  }

  installDisplayRestore();
}

export default { name, inject, Config, apply };
