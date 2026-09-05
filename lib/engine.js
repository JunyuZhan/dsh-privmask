/**
 * dsh-privmask 引擎层：会话映射、占位符编号、脱敏管线与请求/落盘遮罩入口。
 * 所有状态都通过显式 rctx（请求上下文）线程化，引擎不持有跨请求共享的可变槽。
 * @module dsh-privmask/engine
 */

import { buildActiveRules, hanRe } from './rules.js';

/** 单个连续无空白 ASCII 运行的上限：超过后 V8 正则（含 \b / {32,}）会栈溢出 */
const MAX_ASCII_RUN = 4 * 1024 * 1024;
function maxAsciiRunLength(text) {
  let best = 0;
  let cur = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const isAsciiNonSpace = c < 128 && c !== 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12;
    if (isAsciiNonSpace) { cur += 1; if (cur > best) best = cur; }
    else cur = 0;
  }
  return best;
}

/**
 * base64 文本预检（默认关，见 cfg.preflightBase64）：
 * 媒体/文件块载荷若携带 base64 字符串，尝试按 UTF-8 解码；只有能判定为“文本”的内容
 * 才允许在本地脱敏后回编码上云；二进制（如图片像素）与超长内容一律不判定，仍交回
 * nonTextPolicy 处置。该功能是 M3（本地脱敏后再上云）的文本侧前置，不是 OCR。
 */
const B64_PREFLIGHT_MIN = 64;
const B64_PREFLIGHT_MAX_INPUT = 8 * 1024 * 1024;
const B64_PREFLIGHT_MAX_DECODED = 2 * 1024 * 1024;
const B64_PREFLIGHT_MAX_DEPTH = 4;
const utf8Fatal = new TextDecoder('utf-8', { fatal: true });

/** 字符串若像 base64 载荷则返回 { body, prefix }（prefix 为 dataURL 前缀，可能为空串） */
function base64PayloadOf(value) {
  if (typeof value !== 'string' || value.length < B64_PREFLIGHT_MIN) return null;
  let s = value;
  let prefix = '';
  if (s.startsWith('data:')) {
    const comma = s.indexOf(',');
    if (comma === -1) return null;
    if (!/;base64$/i.test(s.slice(5, comma))) return null;
    prefix = s.slice(0, comma + 1);
    s = s.slice(comma + 1);
  }
  const compact = s.replace(/\s+/g, '');
  if (compact.length < B64_PREFLIGHT_MIN || compact.length > B64_PREFLIGHT_MAX_INPUT) return null;
  if (compact.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;
  return { body: compact, prefix };
}

/** base64 解码后仅当看起来像 UTF-8 文本才返回文本，否则 null（二进制/不可判定） */
function decodeTextLike(compact) {
  let bin;
  try {
    bin = Buffer.from(compact, 'base64');
  } catch {
    return null;
  }
  if (bin.length === 0 || bin.length > B64_PREFLIGHT_MAX_DECODED) return null;
  let text;
  try {
    text = utf8Fatal.decode(bin);
  } catch {
    return null;
  }
  let total = 0;
  let meaningful = 0;
  let control = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0) return null;
    total += 1;
    const ws = cp === 9 || cp === 10 || cp === 12 || cp === 13 || cp === 32;
    if (cp < 32 && !ws) control += 1;
    const isHan = cp >= 0x4e00 && cp <= 0x9fff;
    const isAlnum = (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
    if (isHan || isAlnum) meaningful += 1;
  }
  if (total === 0 || meaningful === 0) return null;
  if (control / total > 0.05) return null;
  return text;
}

export function createEngine(cfg) {
  // 会话级映射：sessionId -> { maps: Map<类别, Map<值, 占位符>>, seq: Map<类别, 编号> }
  const sessions = new Map();
  const MAX_SESSIONS = 200;
  const MAX_CAT_ENTRIES = 2000;
  let rulesCache = null;

  function activeRules() {
    if (rulesCache === null) rulesCache = buildActiveRules(cfg);
    return rulesCache;
  }

  /** 开启一次请求：返回请求上下文（映射/计数/编号），与会话级持久映射共用同一份 */
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
    return { maps, counts: new Map(), seq, fields: 0 };
  }

  function placeholder(cat, key, rctx) {
    let map = rctx.maps.get(cat);
    if (map === undefined) { map = new Map(); rctx.maps.set(cat, map); }
    let p = map.get(key);
    if (p === undefined) {
      // 超限时逐出最旧条目（而非整体清空）：编号单调递增，绝不复用，
      // 保证同会话内占位符语义唯一（旧占位符失效可预期，与入站还原一致）
      while (map.size >= MAX_CAT_ENTRIES) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      const n = (rctx.seq.get(cat) ?? 0) + 1;
      rctx.seq.set(cat, n);
      p = '[REDACTED_' + cat.toUpperCase() + '_' + n + ']';
      map.set(key, p);
    }
    rctx.counts.set(cat, (rctx.counts.get(cat) ?? 0) + 1);
    return p;
  }

  /** 构建「占位符 → 原值」反向映射（入站还原用，仅本地内存） */
  function reverseMap(rctx) {
    const rev = new Map();
    if (!rctx) return rev;
    for (const catMap of rctx.maps.values()) {
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

  function redactText(text, rctx) {
    if (typeof text !== 'string' || text === '') return { changed: false, text };
    if (text.length > MAX_ASCII_RUN && maxAsciiRunLength(text) > MAX_ASCII_RUN) {
      throw new Error('检测到超长无空白 ASCII 连续串（>4MB）：为避免宿主正则栈溢出已拒绝请求，请拆分输入后再发送');
    }
    let out = text;
    let changed = false;
    for (const rule of activeRules()) {
      if (rule.fn) {
        // 中文实体规则都需要汉字上下文：纯 ASCII/代码文本直接跳过，避免空跑启发式扫描
        // （custom 词表可能含 ASCII 敏感词，不能跳过）
        if (rule.cat !== 'custom' && !hanRe.test(out)) continue;
        const r = rule.fn(out, engine, rctx);
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
        if (cfg.preserveValues.includes(key)) return match;
        if (rule.validator && !rule.validator(key)) return match;
        const p = placeholder(rule.cat, key, rctx);
        changed = true;
        return secret !== undefined ? match.replace(secret, p) : p;
      });
    }
    return { changed, text: out };
  }

  /** 预检一个非文本块：全部 base64 载荷可解码为文本则返回 { ok:true, block, changed }，否则 null */
  function preflightMediaBlock(block, rctx) {
    if (!cfg.preflightBase64) return null;
    let sawPayload = false;
    let changed = false;
    const visit = (value, depth) => {
      if (depth > B64_PREFLIGHT_MAX_DEPTH) return { verifiable: false, value };
      if (typeof value === 'string') {
        const p = base64PayloadOf(value);
        if (p) {
          sawPayload = true;
          const text = decodeTextLike(p.body);
          if (text === null) return { verifiable: false, value };
          const r = redactText(text, rctx);
          if (!r.changed) return { verifiable: true, value };
          changed = true;
          return { verifiable: true, value: p.prefix + Buffer.from(r.text, 'utf8').toString('base64') };
        }
        // 非 base64 载荷的普通字符串（文件名/附件描述等）也走常规脱敏：
        // 预检放行整个块时，不能只遮正文、漏掉同块元数据里的明文。
        if (value.length > 64 * 1024) return { verifiable: false, value };
        const m = redactText(value, rctx);
        if (m.changed) {
          changed = true;
          return { verifiable: true, value: m.text };
        }
        return { verifiable: true, value };
      }
      if (Array.isArray(value)) {
        let outChanged = false;
        const out = [];
        for (const v of value) {
          const rr = visit(v, depth + 1);
          if (!rr.verifiable) return { verifiable: false, value };
          out.push(rr.value);
          if (rr.value !== v) outChanged = true;
        }
        return { verifiable: true, value: outChanged ? out : value };
      }
      if (value !== null && typeof value === 'object') {
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) return { verifiable: false, value };
        let outChanged = false;
        const out = {};
        for (const k of Object.keys(value)) {
          const rr = visit(value[k], depth + 1);
          if (!rr.verifiable) return { verifiable: false, value };
          Object.defineProperty(out, k, { value: rr.value, enumerable: true, writable: true, configurable: true });
          if (rr.value !== value[k]) outChanged = true;
        }
        return { verifiable: true, value: outChanged ? out : value };
      }
      return { verifiable: true, value };
    };
    const res = visit(block, 0);
    if (!sawPayload || !res.verifiable) return null;
    return { ok: true, changed, block: changed ? res.value : block };
  }

  function walkBlocks(blocks, rctx) {
    // 部分 dsh 形态的消息/工具结果 content 是字符串而非块数组：
    // 直接走文本脱敏（字符串 in → 字符串 out），绝不能逐字符当非文本块丢弃。
    if (typeof blocks === 'string') {
      const r = redactText(blocks, rctx);
      if (!r.changed) return { changed: false, blocks, blocked: null };
      rctx.fields += 1;
      return { changed: true, blocks: r.text, blocked: null };
    }
    let changed = false;
    let blocked = null;
    const out = [];
    for (const block of blocks) {
      if (block.type === 'text' || block.type === 'reasoning') {
        const r = redactText(block.text, rctx);
        if (r.changed) { changed = true; rctx.fields += 1; out.push({ ...block, text: r.text }); }
        else out.push(block);
      } else if (block.type === 'tool-call') {
        if (typeof block.arguments === 'string') {
          const r = redactText(block.arguments, rctx);
          if (r.changed) { changed = true; rctx.fields += 1; out.push({ ...block, arguments: r.text }); }
          else out.push(block);
        } else if (block.arguments !== undefined && block.arguments !== null) {
          // 结构化工具参数（对象/数组形态）：递归遮罩其中的字符串，避免未来 dsh 形态变化导致漏脱敏
          const r = walkJson(block.arguments, 0, rctx);
          if (r.changed) { changed = true; out.push({ ...block, arguments: r.value }); }
          else out.push(block);
        } else {
          out.push(block);
        }
      } else if (block.type === 'tool-result') {
        const inner = walkBlocks(block.content, rctx);
        if (inner.blocked && blocked === null) blocked = inner.blocked;
        if (inner.changed) { changed = true; out.push({ ...block, content: inner.blocks }); }
        else out.push(block);
      } else {
        // 非文本块：image/file/audio/video/未知类型——脱敏插件无法处理，按策略处置。
        // 先做 base64 文本预检（默认关）：若载荷可判定为 UTF-8 文本并已在本地脱敏，
        // 视为已处理放行；无法判定的二进制仍回到下方 nonTextPolicy 门禁。
        const pre = preflightMediaBlock(block, rctx);
        if (pre && pre.ok) {
          if (pre.changed) { changed = true; rctx.fields += 1; }
          out.push(pre.block);
          continue;
        }
        if (cfg.nonTextPolicy === 'block' && blocked === null) {
          blocked = '检测到非文本内容块（type=' + String(block.type || 'unknown') + '）';
        } else if (cfg.nonTextPolicy === 'strip') {
          changed = true; // 丢弃该块
          continue;
        } else if (cfg.nonTextPolicy === 'allow' && cfg.allowRawMedia !== true) {
          // 总目标：凡离境必先脱敏。allow 不再默认原样透传——必须先经本地 OCR/脱敏；
          // 确需承担原样发送风险的用户可显式设置 allowRawMedia=true。
          if (blocked === null) {
            blocked = '检测到非文本内容块（type=' + String(block.type || 'unknown') + '）：allow 默认拒绝原样透传，请先本地 OCR/脱敏；确需原样发送请显式设置 allowRawMedia=true';
          }
        }
        out.push(block);
      }
    }
    return { changed, blocks: changed ? out : blocks, blocked };
  }

  function walkJson(value, depth, rctx) {
    if (depth > 12) {
      // 超出递归深度限制：无法确认深层内容，严格模式下拒绝而非静默透传
      if (cfg.strictUnknown) {
        throw new Error('检测到超出递归深度限制的嵌套字段：为满足「敏感数据不出本地」已拦截请求；若确认该字段不含敏感数据，可设置 strictUnknown=false');
      }
      return { changed: false, value };
    }
    if (typeof value === 'string') {
      const r = redactText(value, rctx);
      if (!r.changed) return { changed: false, value };
      rctx.fields += 1;
      return { changed: true, value: r.text };
    }
    if (Array.isArray(value)) {
      let changed = false;
      const out = value.map((v) => {
        const r = walkJson(v, depth + 1, rctx);
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
        const r = walkJson(value[k], depth + 1, rctx);
        if (r.changed) changed = true;
        // 用 defineProperty 写入：字段名可能是 __proto__/constructor，赋值会走原型 setter
        Object.defineProperty(out, k, { value: r.value, enumerable: true, writable: true, configurable: true });
      }
      return { changed, value: changed ? out : value };
    }
    return { changed: false, value };
  }

  function walkTools(tools, rctx) {
    if (!cfg.redactToolMeta) return { changed: false, tools };
    let changed = false;
    const out = tools.map((tool) => {
      let tChanged = false;
      let description = tool.description;
      if (typeof description === 'string') {
        const r = redactText(description, rctx);
        if (r.changed) { tChanged = true; rctx.fields += 1; description = r.text; }
      }
      const params = walkJson(tool.parameters, 0, rctx);
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

  /** 出站请求脱敏：返回 { result, rctx }（result 为 { blocked } | 原 options | 脱敏副本） */
  function sanitizeRequest(options) {
    if (options === null || typeof options !== 'object' || !Array.isArray(options.messages)) {
      throw new Error('检测到请求 messages 缺失或非数组（类型 ' + String(options === null ? 'null' : typeof options) + '）：dsh 请求形态可能已变化，为满足「敏感数据不出本地」已拒绝');
    }
    const rctx = beginRequest(options.sessionId);
    let changed = false;
    let blocked = null;

    const messages = options.messages.map((m) => {
      const r = walkBlocks(m.content, rctx);
      if (r.blocked && blocked === null) blocked = r.blocked;
      if (!r.changed) return m;
      changed = true;
      return { ...m, content: r.blocks };
    });

    let system = options.system;
    if (system !== undefined) {
      const r = redactText(system, rctx);
      if (r.changed) { changed = true; rctx.fields += 1; system = r.text; }
    }

    let tools = options.tools;
    if (tools !== undefined && tools.length > 0) {
      const t = walkTools(tools, rctx);
      if (t.changed) { changed = true; tools = t.tools; }
    }

    if (blocked !== null) return { result: { blocked }, rctx };

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
        const r = redactText(v, rctx);
        if (r.changed) { changed = true; rctx.fields += 1; projected[key] = r.text; }
      } else if (t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') {
        // 基础类型不包含可脱敏文本，跳过
      } else if (Array.isArray(v) || (t === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null))) {
        const r = walkJson(v, 0, rctx);
        if (r.changed) { changed = true; projected[key] = r.value; }
      } else if (cfg.strictUnknown) {
        throw new Error('检测到未检查的字段 ' + key + '（类型 ' + t + '）：为满足「敏感数据不出本地」已拦截请求；若确认该字段不含敏感数据，可设置 strictUnknown=false');
      }
    }

    if (!changed && !dropSession) return { result: options, rctx };
    if (changed) {
      projected.messages = messages;
      if (system !== options.system) projected.system = system;
      if (tools !== options.tools) projected.tools = tools;
    }
    if (dropSession) delete projected.sessionId;
    return { result: projected, rctx };
  }

  /** agent/pre-step 落盘遮罩：用户消息在写入会话日志前脱敏（与 llm/stream 共用会话映射） */
  function maskPreStep(sessionId, messages) {
    const rctx = beginRequest(sessionId);
    let changed = false;
    let blocked = null;
    const out = messages.map((m) => {
      if (m === null || typeof m !== 'object' || !Array.isArray(m.content)) return m;
      const r = walkBlocks(m.content, rctx);
      if (r.blocked && blocked === null) blocked = r.blocked;
      if (!r.changed) return m;
      changed = true;
      return { ...m, content: r.blocks };
    });
    return { changed, messages: changed ? out : messages, blocked, rctx };
  }

  /** tools/post-execute 落盘遮罩：工具结果在写入会话日志前脱敏 */
  function maskToolResult(sessionId, content) {
    const rctx = beginRequest(sessionId);
    const r = walkBlocks(content, rctx);
    return { changed: r.changed, content: r.blocks, blocked: r.blocked, rctx };
  }

  const engine = {
    placeholder, activeRules, redactText, walkBlocks, walkJson, walkTools, sanitizeRequest, maskPreStep, maskToolResult, reverseMap, sessionReverseMap,
    isPreserved: (value) => cfg.preserveValues.includes(value),
  };
  return engine;
}
