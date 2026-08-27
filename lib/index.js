/**
 * dsh-privmask — DeepSeek Harness 本地脱敏插件（Host-only 静态版）。
 *
 * 在 `llm/stream` 水瀑拦截每次发往云端大模型的请求：把密钥、PII、中文实体
 * （姓名/身份证/统一社会信用代码/手机/座机/银行卡/案号/车牌/证件/出生日期/
 * 公司/司法机关/地址。
 *
 * 本地会话日志与工具执行不受影响；云端只看到 `[REDACTED_类别_N]` 占位符。
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
  { cat: 'key', re: /\b(api[_-]?key|token|secret|password|passwd|authorization)\b\s*[:=]\s*["']?([A-Za-z0-9\-._~+/=]{8,})["']?/gi, secretGroup: 2 },
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

/** 汉字范围（U+4E00..U+9FA5 的实际字符），规避 \\u 转义在不同传输层级的差异 */
const HAN = '一-龥';
const hanRe = new RegExp('[' + HAN + ']');
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const NAME_CTX = ['法定代表人', '委托代理人', '申请执行人', '被申请人', '被执行人', '申请人', '审判长', '审判员', '人民陪审员', '书记员', '检察员', '检察官', '联系人', '收货人', '代理人', '辩护人', '原告', '被告', '第三人', '债务人', '债权人', '担保人', '出借人', '借款人', '出租人', '承租人', '户主', '董事长', '总经理', '监事', '董事', '股东', '负责人', '姓名', '名字', '签字', '签名', '签章', '经理'];
const NAME_EXCLUDE = '认为请求要求行为人员之间方面表示提出作为担任位于存在关系情况内容项目任务工作公司企业单位组织机构产品问题服务系统数据文件信息设计开发测试用户客户平台中心机构部门公安警察律师法官主任副主任';
const ORG_KEYS = ['有限责任公司', '股份有限公司', '集团有限公司', '有限公司', '集团', '控股', '事务所', '研究所', '研究院', '合作社', '出版社', '银行', '医院', '学校', '学院', '大学', '公司', '工厂', '饭店', '酒店'];
const INDUSTRY_WORDS = ['科技', '网络', '信息', '贸易', '实业', '建设', '工程', '投资', '金融', '咨询', '文化', '传媒', '物流', '医药', '食品', '服装', '机械', '电子', '软件', '地产', '物业', '装饰', '广告', '管理', '服务', '生物', '能源', '材料', '设计', '教育', '医疗', '汽车', '建筑', '环保', '农业', '旅游', '餐饮', '百货', '置业', '智能', '数据', '互联', '供应链'];
const PRONOUN = '该本我你他她它我们你们他们贵各双';
const CONJUNCTIONS = '与和及或';
const ORG_WORDS = ['人民法院', '人民检察院', '纪律检查委员会', '监察委员会', '市场监督管理局', '仲裁委员会', '人民政府', '律师事务所', '公安厅', '公安局', '检察院', '派出所', '仲裁委', '司法局', '司法所', '税务局', '人大', '政协'];
const ORG_LIMIT = '市省区县中级高级基层第一第二铁路海事知识产权互联网金融监察纪律检查人民审判';
const PROVINCES = '京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼';
const DZ = '地' + '址';
const ADDR_CTX = ['住所地', '户籍地', '联系地址', '注册地址', '送达地址', '现住址', '居住地', '住址', DZ];
const DOB_CTX = ['出生日期', '出生年月', '出生时间', '出生', '生日', '生于'];

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
const USCC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY';
const USCC_W = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
function validUscc(s) {
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += USCC_CHARS.indexOf(s[i]) * USCC_W[i];
  const r = sum % 31;
  const check = r === 0 ? 0 : 31 - r;
  return USCC_CHARS[check] === s[17];
}

// 脱敏状态（模块级，供规则引擎与 fn 规则共享；单进程建议只挂载一个实例）
const per = { maps: new Map(), counts: new Map(), fields: 0 };

function placeholder(cat, key) {
  let map = per.maps.get(cat);
  if (map === undefined) { map = new Map(); per.maps.set(cat, map); }
  let p = map.get(key);
  if (p === undefined) { p = '[REDACTED_' + cat.toUpperCase() + '_' + (map.size + 1) + ']'; map.set(key, p); }
  per.counts.set(cat, (per.counts.get(cat) ?? 0) + 1);
  return p;
}

const CN_RULES = [
  { cat: 'id18', re: /(?<![0-9])\d{17}[\dXx](?![0-9])/g, validator: (s) => validId18(s) },
  { cat: 'id15', re: new RegExp('(身份证号码|身份证号|身份证|证件号码|证件号|身份证明号码)\\s*[:：]?\\s*([0-9]{15})(?!\\d)', 'g'), secretGroup: 2 },
  { cat: 'uscc', re: /(?<![0-9A-Za-z])[0-9A-HJ-NPQRTUWXY]{18}(?![0-9A-Za-z])/g, validator: (s) => validUscc(s) },
  { cat: 'mobile', re: /(?<![0-9])(1[3-9]\d{9})(?![0-9])/g },
  { cat: 'tel', re: /(?<![0-9])(0\d{2,3}-?\d{7,8})(?![0-9])/g },
  { cat: 'bank', re: /(?<![0-9])\d{16,19}(?![0-9])/g, validator: (s) => validLuhn(s) },
  { cat: 'case', re: /[（(]\s*\d{4}\s*[）)]\s*[^\s（）()]{2,14}\d{1,8}\s*号/g },
  { cat: 'plate', re: new RegExp('(?<![0-9A-Za-z])[' + PROVINCES + '][A-Z](?:[DF][A-HJ-NP-Z0-9]{5}|[A-HJ-NP-Z0-9]{5})(?![0-9A-Za-z])', 'g') },
  { cat: 'passport', re: /(?<![0-9A-Za-z])([EGCHT]\d{8})(?![0-9A-Za-z])/g },
  { cat: 'dob', re: new RegExp('(' + DOB_CTX.join('|') + ')\\s*[:：]?\\s*(\\d{4}\\s*[年./-]\\s*\\d{1,2}\\s*[月./-]\\s*\\d{1,2}\\s*[日号]?)', 'g'), secretGroup: 2 },
  { cat: 'addr', re: new RegExp('(' + ADDR_CTX.join('|') + ')\\s*[:：]?\\s*([^\\n。；;，,]{4,60})', 'g'), secretGroup: 2 },
  { cat: 'addrchain', re: new RegExp('(?<![' + HAN + '])(?:[' + HAN + ']{1,6}?(?:省|市))?(?:[' + HAN + ']{1,8}?(?:市|自治州|地区|盟))?(?:[' + HAN + ']{1,8}?(?:区|县|旗|市))?[' + HAN + ']{1,8}?(?:镇|乡|街道|村)(?![号])', 'g') },
  { cat: 'street', re: new RegExp('(?<![' + HAN + '])[' + HAN + ']{2,8}(?:区|街道|路|大道|街|巷)[' + HAN + '\\d]{0,12}号?(?![0-9])', 'g') },
  {
    cat: 'name', fn: (text) => {
      const ctxRe = new RegExp('(' + NAME_CTX.join('|') + ')\\s*[:：]?\\s*', 'g');
      let out = text;
      let changed = false;
      const found = [];
      let m;
      ctxRe.lastIndex = 0;
      while ((m = ctxRe.exec(out)) !== null) {
        const idx = m.index + m[0].length;
        const rest = out.slice(idx);
        const mm = rest.match(new RegExp('^([' + HAN + ']{2,4})'));
        if (mm) {
          const name = mm[1];
          const first = name[0];
          if (!SURNAMES.includes(first)) { ctxRe.lastIndex = m.index + 1; continue; }
          if (NAME_EXCLUDE.startsWith(name) || NAME_EXCLUDE.startsWith(first)) { ctxRe.lastIndex = m.index + 1; continue; }
          const next = rest.slice(name.length)[0];
          if (next && /[\u4e00-\u9fa5A-Za-z0-9]/.test(next) && !'，,。；;、：:（()）"\' '.includes(next)) { ctxRe.lastIndex = m.index + 1; continue; }
          found.push({ start: idx, name });
        }
        ctxRe.lastIndex = m.index + 1;
      }
      for (let i = found.length - 1; i >= 0; i--) {
        const f = found[i];
        out = out.slice(0, f.start) + placeholder('name', f.name) + out.slice(f.start + f.name.length);
        changed = true;
      }
      return { changed, text: out };
    },
  },
  {
    cat: 'company', fn: (text) => {
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
        let trimmed = prefix;
        for (const ch of PRONOUN) trimmed = trimmed.replace(new RegExp('^' + ch), '');
        if (trimmed.length < 2) continue;
        if (!/[市省区县州]/.test(trimmed) && !INDUSTRY_WORDS.some((w) => trimmed.includes(w))) continue;
        found.push({ start, len: m.index + key.length - start, text: out.slice(start, m.index + key.length) });
      }
      for (let i = found.length - 1; i >= 0; i--) {
        const f = found[i];
        out = out.slice(0, f.start) + placeholder('company', f.text) + out.slice(f.start + f.len);
        changed = true;
      }
      return { changed, text: out };
    },
  },
  {
    cat: 'org', fn: (text) => {
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
        while (start > 0 && m.index - start < 14 && hanRe.test(out[start - 1])) { start--; prefix = out.slice(start, m.index); }
        if (prefix.length === 0) continue;
        const limited = [...ORG_LIMIT].some((c) => prefix.includes(c));
        if (!limited && prefix.length < 3) continue;
        found.push({ start, len: m.index + key.length - start, text: out.slice(start, m.index + key.length) });
      }
      for (let i = found.length - 1; i >= 0; i--) {
        const f = found[i];
        out = out.slice(0, f.start) + placeholder('org', f.text) + out.slice(f.start + f.len);
        changed = true;
      }
      return { changed, text: out };
    },
  },
];

// ─────────────────────────── 插件主体 ───────────────────────────

export function apply(ctx, config = {}) {
  const cfg = {
    enabled: config.enabled ?? true,
    redactPaths: config.redactPaths ?? false,
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

  const SEEN = new WeakSet();
  const stats = { requests: 0, redacted: 0, fields: 0, errors: 0 };

  function activeRules() {
    const list = RULES.slice();
    if (cfg.redactPaths) list.push(...PATH_RULES);
    if (cfg.cnEntities) list.push(...CN_RULES);
    return list;
  }

  function redactText(text) {
    if (typeof text !== 'string' || text === '') return { changed: false, text };
    let out = text;
    let changed = false;
    for (const rule of activeRules()) {
      if (rule.fn) {
        const r = rule.fn(out);
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
    const out = [];
    for (const block of blocks) {
      if (block.type === 'text' || block.type === 'reasoning') {
        const r = redactText(block.text);
        if (r.changed) { changed = true; per.fields += 1; out.push({ ...block, text: r.text }); }
        else out.push(block);
      } else if (block.type === 'tool-call') {
        const r = redactText(block.arguments);
        if (r.changed) { changed = true; per.fields += 1; out.push({ ...block, arguments: r.text }); }
        else out.push(block);
      } else if (block.type === 'tool-result') {
        const inner = walkBlocks(block.content);
        if (inner.changed) { changed = true; out.push({ ...block, content: inner.blocks }); }
        else out.push(block);
      } else {
        out.push(block);
      }
    }
    return { changed, blocks: changed ? out : blocks };
  }

  function walkJson(value, depth) {
    if (depth > 12) return { changed: false, value };
    if (typeof value === 'string') {
      const r = redactText(value);
      if (!r.changed) return { changed: false, value };
      per.fields += 1;
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
    let changed = false;
    const out = tools.map((tool) => {
      let tChanged = false;
      let description = tool.description;
      if (typeof description === 'string') {
        const r = redactText(description);
        if (r.changed) { tChanged = true; per.fields += 1; description = r.text; }
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
    per.maps.clear();
    per.counts.clear();
    per.fields = 0;
    let changed = false;

    const messages = options.messages.map((m) => {
      const r = walkBlocks(m.content);
      if (!r.changed) return m;
      changed = true;
      return { ...m, content: r.blocks };
    });

    let system = options.system;
    if (system !== undefined) {
      const r = redactText(system);
      if (r.changed) { changed = true; per.fields += 1; system = r.text; }
    }

    let tools = options.tools;
    if (tools !== undefined && tools.length > 0) {
      const t = walkTools(tools);
      if (t.changed) { changed = true; tools = t.tools; }
    }

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

  function failClosedStream(error) {
    const message = 'privmask: 脱敏失败，请求已被拦截: ' + String(error && error.message ? error.message : error);
    return (async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { message, code: 'PRIVMASK_REDACTION_FAILED' } } };
    })();
  }

  // 核心拦截：llm/stream 水瀑（在 agent-loop 不变式校验之后运行）
  return ctx.on('llm/stream', (options, next) => {
    if (!cfg.enabled || SEEN.has(options)) return next();
    try {
      const projected = sanitizeRequest(options);
      if (projected === options) {
        stats.requests += 1;
        return next();
      }
      SEEN.add(projected);
      stats.requests += 1;
      stats.redacted += 1;
      stats.fields += per.fields;
      if (cfg.logRedactions) {
        console.log('[privmask] 已脱敏请求 provider=' + options.provider + ' model=' + options.model + ' 字段=' + per.fields + ' ' + JSON.stringify(Object.fromEntries(per.counts)));
      }
      // 用脱敏后的请求直接发起流式调用（内层水瀑由 SEEN 放行）
      return llm.stream(projected);
    } catch (error) {
      stats.errors += 1;
      console.error('[privmask] 脱敏失败（failClosed=' + cfg.failClosed + '）', error);
      if (cfg.failClosed) return failClosedStream(error);
      stats.requests += 1;
      return next();
    }
  });
}

export default { name, inject, Config, apply };
