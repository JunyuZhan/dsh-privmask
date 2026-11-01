#!/usr/bin/env node
/**
 * 生成项目自有的插件市场索引：market/index.json（DSH 插件市场索引格式 1）。
 *
 * 第三方市场（DSH.SO 等）收录由对方控制；这份自有索引让用户「添加索引源」后即可在
 * DSH Desktop 插件页的「发现」里一键安装本插件，不依赖第三方审核。
 *
 * 数据来源：
 * - 版本与发布时间：npm registry（`npm view` / HTTPS API）
 * - 展示信息：仓库 README/包描述
 *
 * 用法（维护者在发版后运行，提交生成结果）：
 *   node tools/build-market-index.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'market', 'index.json');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const NAME = PKG.name;

/** 索引里保留的版本数：够回退几个小版本即可，避免索引无限增长。 */
const KEEP_VERSIONS = 8;

const res = await fetch(`https://registry.npmjs.org/${NAME.replace('/', '%2F')}`, {
  headers: { accept: 'application/json' },
});
if (!res.ok) {
  console.error('[market-index] 查询 npm registry 失败：HTTP ' + res.status);
  process.exit(1);
}
const meta = await res.json();
const times = meta.time || {};
const published = Object.keys(meta.versions || {})
  .filter((v) => times[v])
  .sort((a, b) => new Date(times[b]) - new Date(times[a]))
  .slice(0, KEEP_VERSIONS);

const plugin = {
  name: NAME,
  title: {
    en: 'dsh-privmask',
    zh: '隐私保护 dsh-privmask',
  },
  description: {
    en: 'Local redaction for DeepSeek Harness: masks secrets, PII and Chinese entities before requests leave the machine; sessions and tool results are masked too, with local restore in model output.',
    zh: 'DeepSeek Harness 本地脱敏插件：请求上云前遮罩密钥、PII 与中文实体，用户输入与工具结果落盘前同样遮罩，模型输出里的占位符在本地还原。',
  },
  author: 'JunyuZhan',
  homepage: 'https://github.com/JunyuZhan/dsh-privmask#readme',
  repository: { url: 'https://github.com/JunyuZhan/dsh-privmask' },
  metadata: {
    category: 'tools',
    keywords: ['privacy', 'pii', 'redaction', 'security', 'desensitization', 'deepseek-harness'],
    labels: [],
    sortKeys: {},
  },
  versions: published.map((version) => ({
    version,
    publishTimestamp: Math.floor(new Date(times[version]).getTime() / 1000),
    source: { type: 'npm' },
    engines: {},
  })),
};

const index = {
  format: 1,
  title: { en: 'dsh-privmask', zh: 'dsh-privmask 插件市场索引' },
  description: {
    en: 'Market index for dsh-privmask (DeepSeek Harness local redaction plugin).',
    zh: 'dsh-privmask（DeepSeek Harness 本地脱敏插件）的市场索引。',
  },
  metadata: {
    categories: { tools: { title: { en: 'Tools', zh: '工具' } } },
    labels: {},
    sortKeys: {},
  },
  plugins: [plugin],
};

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(index, null, 2) + '\n');
console.log('[market-index] 已生成 market/index.json：' + NAME + ' ' + published.join(', '));
