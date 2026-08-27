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
export const inject = [];

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
  /** 非文本内容（图片/文件块）策略：block=拒绝请求, strip=移除后放行, allow=原样透传 */
  nonTextPolicy: z.string().default('block'),
  /** 长 hex/base64 串脱敏 */
  longTokens: z.boolean().default(true),
  /** 移除 x-deepseek-harness-session-id 关联头 */
  dropSessionId: z.boolean().default(true),
  /** 中文实体识别 */
  cnEntities: z.boolean().default(true),
  /** 脱敏异常时 true=拒绝请求, false=放行原请求 */
  failClosed: z.boolean().default(false),
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
const NAME_CTX = ['法定代表人', '委托代理人', '申请执行人', '被申请人', '被执行人', '申请人', '审判长', '审判员', '人民陪审员', '书记员', '检察员', '检察官', '联系人', '收货人', '代理人', '辩护人', '原告', '被告', '第三人', '债务人', '债权人', '担保人', '出借人', '借款人', '出租人', '承租人', '户主', '董事长', '总经理', '监事', '董事', '股东', '负责人', '姓名', '名字', '签字', '签名', '签章', '经理'];
const NAME_EXCLUDE = '认为请求要求行为人员之间方面表示提出作为担任位于存在关系情况内容项目任务工作公司企业单位组织机构产品问题服务系统数据文件信息设计开发测试用户客户平台中心机构部门公安警察律师法官主任副主任';
/** 姓名后允许直接出现的助词/虚词（视为边界，避免漏掉"张三丰的合同"这类三字名） */
const NAME_PARTICLES = '的了着过呢吧嘛啊呀在把被与和及或为从对向于';
/** 姓名后常见动词/助词短语：从候选名尾部裁掉，避免把「认为/行为」等词吞进占位符（按长度降序匹配） */
const NAME_TAILS = ['认为', '请求', '要求', '表示', '提出', '指出', '强调', '主张', '声称', '委托', '担任', '负责', '涉嫌', '行为'];
/** 姓名后允许出现的单字助词/虚词（候选名尾部的这些字会被裁掉；含多字尾词首字，避免「认为」被截断后残留「认」） */
const NAME_TAIL_CHARS = '的了着过呢吧嘛啊呀在把被与和及或为从对向于是有等称说认请要表提指强主声委担负涉行';
const ORG_KEYS = ['有限责任公司', '股份有限公司', '集团有限公司', '有限公司', '集团', '控股', '事务所', '研究所', '研究院', '合作社', '出版社', '银行', '医院', '学校', '学院', '大学', '公司', '工厂', '饭店', '酒店'];
const REGION_CHARS = '省市自治区县';
const INDUSTRY_WORDS = ['科技', '网络', '信息', '贸易', '实业', '建设', '工程', '投资', '金融', '咨询', '文化', '传媒', '物流', '医药', '食品', '服装', '机械', '电子', '软件', '地产', '物业', '装饰', '广告', '管理', '服务', '生物', '能源', '材料', '设计', '教育', '医疗', '汽车', '建筑', '环保', '农业', '旅游', '餐饮', '百货', '置业', '智能', '数据', '互联', '供应链'];
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
const DZ = '地' + '址';
const ADDR_CTX = ['住所地', '户籍地', '联系地址', '注册地址', '送达地址', '现住址', '居住地', '住址', DZ];
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
  { cat: 'addrchain', re: new RegExp('(?<![' + HAN + '])(?:[' + HAN + ']{1,6}?(?:省|市))?(?:[' + HAN + ']{1,8}?(?:市|自治州|地区|盟))?(?:[' + HAN + ']{1,8}?(?:区|县|旗|市))?[' + HAN + ']{1,8}?(?:镇|乡|街道|村)(?![号])', 'g') },
  { cat: 'street', re: new RegExp('(?<![' + HAN + '])[' + HAN + ']{2,8}(?:区|街道|路|大道|街|巷)[' + HAN + '\\d]{0,12}号?(?![0-9])', 'g') },
  {
    cat: 'name', fn: (text, engine) => {
      const ctxRe = new RegExp('(' + NAME_CTX.join('|') + ')\\s*[:：]?\\s*', 'g');
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
          if (NAME_EXCLUDE.startsWith(name) || NAME_EXCLUDE.startsWith(first)) continue;
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
        if (!new RegExp('[' + REGION_CHARS + ']').test(trimmed) && !INDUSTRY_WORDS.some((w) => trimmed.includes(w))) continue;
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
      const list = RULES.slice();
      if (cfg.redactPaths) list.push(...PATH_RULES);
      if (cfg.cnEntities) list.push(...CN_RULES);
      rulesCache = list;
    }
    return rulesCache;
  }

  function beginRequest(sessionId) {
    let maps;
    if (cfg.persistMapping) {
      const key = sessionId ?? '__default__';
      maps = sessions.get(key);
      if (maps === undefined) {
        maps = new Map();
        sessions.set(key, maps);
        if (sessions.size > MAX_SESSIONS) {
          // 防止无限会话撑爆内存：淘汰最早的一个
          const oldest = sessions.keys().next().value;
          sessions.delete(oldest);
        }
      }
    } else {
      maps = new Map();
    }
    req = { maps, counts: new Map(), fields: 0 };
  }

  function placeholder(cat, key) {
    let map = req.maps.get(cat);
    if (map === undefined) { map = new Map(); req.maps.set(cat, map); }
    if (map.size >= MAX_CAT_ENTRIES) map.clear(); // 极端场景防内存膨胀
    let p = map.get(key);
    if (p === undefined) { p = '[REDACTED_' + cat.toUpperCase() + '_' + (map.size + 1) + ']'; map.set(key, p); }
    req.counts.set(cat, (req.counts.get(cat) ?? 0) + 1);
    return p;
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
      if (!cfg.longTokens && (rule.cat === 'hex' || rule.cat === 'b64')) continue;
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
    if (depth > 12) return { changed: false, value };
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
    if (!changed && !dropSession) return options;

    const projected = { ...options };
    if (changed) {
      projected.messages = messages;
      if (system !== options.system) projected.system = system;
      if (tools !== options.tools) projected.tools = tools;
    }
    if (dropSession) delete projected.sessionId;
    return projected;
  }

  const engine = {
    placeholder, activeRules, redactText, walkBlocks, walkJson, walkTools, sanitizeRequest,
    get fields() { return req ? req.fields : 0; },
    get counts() { return req ? req.counts : new Map(); },
  };
  return engine;
}

// ─────────────────────────── 插件主体 ───────────────────────────

export function apply(ctx, config = {}) {
  const cfg = {
    enabled: config.enabled ?? true,
    redactPaths: config.redactPaths ?? false,
    redactToolMeta: config.redactToolMeta ?? true,
    persistMapping: config.persistMapping ?? true,
    nonTextPolicy: ['block', 'strip', 'allow'].includes(config.nonTextPolicy) ? config.nonTextPolicy : 'block',
    longTokens: config.longTokens ?? true,
    dropSessionId: config.dropSessionId ?? true,
    cnEntities: config.cnEntities ?? true,
    failClosed: config.failClosed ?? false,
    logRedactions: config.logRedactions ?? true,
  };

  const llm = ctx.get('llm');
  if (llm === undefined) {
    // llm 服务不存在时静默退出（无模型调用可拦截）
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

  // 核心拦截：llm/stream 水瀑（在 agent-loop 不变式校验之后运行）
  return ctx.on('llm/stream', (options, next) => {
    if (!cfg.enabled || SEEN.has(options)) return next();
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
      // 用脱敏后的请求直接发起流式调用（内层水瀑由 SEEN 放行）
      return llm.stream(projected);
    } catch (error) {
      stats.errors += 1;
      stats.lastError = String(error && error.message ? error.message : error);
      console.error('[privmask] 脱敏失败（failClosed=' + cfg.failClosed + '）', error);
      if (cfg.failClosed) return failClosedStream(error);
      stats.requests += 1;
      return next();
    }
  });
}

export default { name, inject, Config, apply };
