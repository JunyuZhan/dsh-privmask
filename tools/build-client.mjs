#!/usr/bin/env node
/**
 * 浏览器端产物构建：client-src/index.ts → lib/client.js。
 *
 * 产物形态由 dsh 客户端模块加载器约定（`window.__ModuleLoader__.load({ id, factory(require) })`，
 * 与宿主模块表 `dsh-client-modules` 一致），所以这里把 esbuild 的 CJS bundle 包进 factory：
 * 只外置 `react` / `react/jsx-runtime`（宿主 shell 提供的静态种子模块），其余全部内联。
 *
 * 用法：
 *   node tools/build-client.mjs          # 生成 lib/client.js
 *   node tools/build-client.mjs --check  # 只校验产物与源码一致（CI / prepublishOnly）
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'client-src', 'index.ts');
const OUTPUT = join(ROOT, 'lib', 'client.js');
const MODULE_ID = 'dsh-privmask';

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  legalComments: 'none',
  sourcemap: false,
  charset: 'utf8',
  logLevel: 'silent',
});

/** esbuild 的 CJS 产物（去掉行尾空白，统一由本脚本加缩进与包裹）。 */
let code = result.outputFiles[0].text.trimEnd();
// 工厂函数体里的 "use strict" 由宿主 loader 的模块语义决定，这里不需要重复；
// 去掉它可以让产物与手写版本保持同构（不含 sourceMappingURL 之类构建器痕迹）。
code = code.replace(/^"use strict";\r?\n/, '');
code = code
  .split('\n')
  .map((line) => (line.length > 0 ? '\t\t' + line : line))
  .join('\n');

// 与手写产物一致的包裹层：模块 id、module/exports 垫片、模板导出的 toStringTag。
const output = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(MODULE_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${code}
\t\treturn module.exports;
\t}
});
`;

const normalize = (text) => text.replace(/\r\n/g, '\n');

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error('[build-client] 缺少 lib/client.js：请运行 npm run build');
    process.exit(1);
  }
  if (normalize(current) !== output) {
    console.error('[build-client] lib/client.js 与 client-src 不一致：请运行 npm run build 并提交产物');
    process.exit(1);
  }
  console.log('[build-client] lib/client.js 与 client-src 一致');
} else {
  writeFileSync(OUTPUT, output);
  console.log('[build-client] 已生成 lib/client.js（' + output.length + ' 字节）');
}
