/**
 * dsh-privmask 还原层：占位符→原值替换（入站流与展示层共用），纯函数。
 * @module dsh-privmask/restore
 */

/**
 * 替换一段文本中的占位符。排序由调用方一次性完成（按占位符长度降序，
 * 避免 EMAIL_1 与 EMAIL_10 部分匹配）；无占位符的输入直接短路。
 * @param {string} text - 待还原文本。
 * @param {Array<[string, string]>} entries - 已排序的 [占位符, 原值] 列表。
 * @returns {string} 还原后的文本。
 */
const compiledCache = new WeakMap();

/** 把排序后的 [占位符, 原值] 列表编译成一次匹配的替换（按条目顺序，长占位符在前） */
function compiledEntries(entries) {
  let c = compiledCache.get(entries);
  if (c === undefined) {
    const map = new Map(entries);
    const source = entries.map(([ph]) => ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    c = { map, re: new RegExp(source, 'g') };
    compiledCache.set(entries, c);
  }
  return c;
}

export function restoreChunkText(text, entries) {
  if (typeof text !== 'string' || text === '' || entries.length === 0 || !text.includes('REDACTED_')) return text;
  if (entries.length === 1) {
    const [ph, value] = entries[0];
    return text.split(ph).join(value);
  }
  const { map, re } = compiledEntries(entries);
  re.lastIndex = 0;
  // 单遍替换：还原值若恰好包含占位符形态的文本，不会被二次替换（避免嵌套展开）
  return text.replace(re, (ph) => (map.get(ph) === undefined ? ph : map.get(ph)));
}

/** 占位符最长形态 [REDACTED_类别_N] */
const MAX_PH_LEN = 48;

/** 从还原后的文本尾部提取「可能是占位符前缀」的未完成片段（跨 delta 重组用） */
export function splitPlaceholderTail(text) {
  const lastBracket = text.lastIndexOf('[');
  if (lastBracket < 0) return { head: text, tail: '' };
  const tail = text.slice(lastBracket);
  if (tail.length <= MAX_PH_LEN && /^\[(?:REDACTED_)?[A-Z0-9_]*$/.test(tail)) {
    return { head: text.slice(0, lastBracket), tail };
  }
  return { head: text, tail: '' };
}

/** 统计文本中残留的占位符数量（还原未命中，供可见性统计） */
export function countPlaceholderMisses(text) {
  if (typeof text !== 'string') return 0;
  let n = 0;
  let i = 0;
  while ((i = text.indexOf('REDACTED_', i)) !== -1) {
    n += 1;
    i += 9;
  }
  return n;
}

/** 还原内容块数组（text/reasoning/tool-call/tool-result 递归） */
export function restoreBlocksForDisplay(blocks, entries) {
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
      if (Array.isArray(block.content)) {
        const inner = restoreBlocksForDisplay(block.content, entries);
        if (inner !== block.content) { changed = true; return { ...block, content: inner }; }
        return block;
      }
      if (typeof block.content === 'string') {
        const t = restoreChunkText(block.content, entries);
        if (t !== block.content) { changed = true; return { ...block, content: t }; }
      }
      return block;
    }
    return block;
  });
  return changed ? out : blocks;
}

/** 还原会话事件 data（message.content 或内容块数组），不可变重建 */
export function restoreWireData(data, entries) {
  if (data === null || typeof data !== 'object') return data;
  if (data.message && Array.isArray(data.message.content)) {
    const c = restoreBlocksForDisplay(data.message.content, entries);
    if (c !== data.message.content) return { ...data, message: { ...data.message, content: c } };
    return data;
  }
  if (data.message && typeof data.message.content === 'string') {
    const t = restoreChunkText(data.message.content, entries);
    if (t !== data.message.content) return { ...data, message: { ...data.message, content: t } };
    return data;
  }
  if (Array.isArray(data.content)) {
    const looksBlocks = data.content.every((b) => b !== null && typeof b === 'object' && typeof b.type === 'string');
    if (looksBlocks) {
      const c = restoreBlocksForDisplay(data.content, entries);
      if (c !== data.content) return { ...data, content: c };
    }
    return data;
  }
  if (typeof data.content === 'string') {
    const t = restoreChunkText(data.content, entries);
    if (t !== data.content) return { ...data, content: t };
  }
  return data;
}

/** 还原一条历史记录（仅 type === 'event' 的记录，chunk 行跳过） */
export function restoreRecord(record, entries) {
  if (record === null || typeof record !== 'object' || record.type !== 'event') return record;
  const ev = record.event;
  if (!ev || typeof ev !== 'object') return record;
  const data = restoreWireData(ev.data, entries);
  if (data === ev.data) return record;
  return { ...record, event: { ...ev, data } };
}

/** 还原历史记录数组；无变化时返回原引用 */
export function restoreRecords(records, entries) {
  if (!Array.isArray(records) || records.length === 0 || entries.length === 0) return records;
  let changed = false;
  const out = records.map((r) => {
    const nr = restoreRecord(r, entries);
    if (nr !== r) changed = true;
    return nr;
  });
  return changed ? out : records;
}
