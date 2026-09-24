#!/usr/bin/env node
/**
 * dsh 版本适配自检 / 本地源码留存。
 *
 * 按版本把 privmask 依赖的「缝」所在包下载解压到 `<repo>/.dsh-versions/<版本>/`
 * （已 gitignore，只在本机留存，不进提交），逐个断言缝字符串仍存在，打印
 * 「版本 × 缝」矩阵；必需缝缺失时退出码 1。同一份缓存以后要做版本 diff，
 * 直接解两个版本对比即可，不用重新下载。
 *
 * 用法：
 *   node tools/dsh-compat-check.mjs                 # 默认核对旧官方线与当前 latest
 *   node tools/dsh-compat-check.mjs 0.1.6-alpha.2   # 指定版本
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.dsh-versions');

/** 默认核对：旧官方线（客户端 inject 声明的 runtime 只在这条线上存在）+ 当前 latest。 */
const DEFAULT_VERSIONS = ['0.1.1-rc.2', '0.1.5-rc.2'];

/** 需要留存的包：每个缝的归属包，以及浏览器端模块表相关包。 */
const PACKAGES = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-attachment-local',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
];

/**
 * 缝断言。required=true 表示缺失即视为插件在该版本上不可用（退出码 1）；
 * required=false 表示该版本没有这个能力时插件按设计降级，仅记录。
 */
const SEAMS = [
  { id: 'llm/stream', pkg: '@deepseek-ai/dsh-llm', needle: 'llm/stream', required: true, note: '出站脱敏唯一请求边界' },
  { id: 'llm.prepareCall', pkg: '@deepseek-ai/dsh-llm', needle: 'prepareCall', required: true, note: '适配器准备调用（重入水瀑时复用）' },
  { id: 'agent/pre-step', pkg: '@deepseek-ai/dsh-agent', needle: 'agent/pre-step', required: true, note: '用户消息落盘前遮罩' },
  { id: 'tools/post-execute', pkg: '@deepseek-ai/dsh-tools', needle: 'tools/post-execute', required: true, note: '工具结果落盘前遮罩' },
  { id: 'agent-loop 请求标记', pkg: '@deepseek-ai/dsh-agent-loop', needle: 'markAgentLoopRequest', required: true, note: '脱敏副本重入水瀑的放行前提' },
  { id: 'llm.resolveModelInfo', pkg: '@deepseek-ai/dsh-llm', needle: 'resolveModelInfo', required: false, note: 'localOcr 的图片模态改写' },
  { id: 'tools/ptc-dispatch-log', pkg: '@deepseek-ai/dsh-tools', needle: 'tools/ptc-dispatch-log', required: false, note: 'run_code 子派发日志遮罩（≥0.1.2）' },
  // 设置 API 是「卡片开关 live 生效」的命脉，且上游改过两次（0.1.2 前的 remote.settings →
  // settingsScope → 0.1.7 又改回 remote.settings + host 的 SettingsForms）。任一形态都在即可，
  // 但全都找不到就说明这条链路断了，必须报红：critical
  {
    id: 'host 设置 API',
    critical: true,
    note: '注册命名空间（旧 register）或表单页（新 configure）都没有时，开关只能靠配置文件',
    any: [
      { pkg: '@deepseek-ai/dsh-settings', needle: 'register(ns, schema' },
      { pkg: '@deepseek-ai/dsh-settings', needle: 'configure(presentation' },
    ],
  },
  {
    id: '客户端设置 API',
    critical: true,
    note: 'settingsScope（0.1.2–0.1.5）与 remote.settings（0.1.7+）都没有时，卡片开关无法读写',
    any: [
      { pkg: '@deepseek-ai/dsh-client-ui-settings', needle: 'settingsScope' },
      { pkg: '@deepseek-ai/dsh-api-remotes', needle: 'settings/update' },
    ],
  },
  { id: 'session-id 请求头', pkg: '@deepseek-ai/dsh-llm-deepseek', needle: 'x-deepseek-harness-session-id', required: false, note: 'dropSessionId 的移除对象' },
  { id: 'attachments.readImage', pkg: '@deepseek-ai/dsh-attachment-local', needle: 'readImage', required: false, note: 'localOcr 读取图片字节' },
  { id: 'pluginInventory', pkg: '@deepseek-ai/dsh-api-remotes', needle: 'pluginInventory', required: false, note: '卡片读取插件清单' },
];

/** 递归收集文本文件（只扫源码/类型，跳过大目录）。 */
function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      collectFiles(full, out);
    } else if (/\.(js|mjs|cjs|ts|d\.ts|json|md)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 在某包目录里找 needle，返回命中文件（相对仓库根，便于人工复查）。 */
function grepPackage(pkgDir, needle) {
  const srcRoot = join(pkgDir, 'package');
  if (!existsSync(srcRoot)) return [];
  const hits = [];
  for (const file of collectFiles(srcRoot)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes(needle)) hits.push(relative(ROOT, file));
  }
  // 证据优先指向真实代码（lib/），README/类型声明排在后面
  return hits.sort((a, b) => (a.includes('/lib/') ? 0 : 1) - (b.includes('/lib/') ? 0 : 1) || a.localeCompare(b));
}

/** 按需下载并解压一个包到 <cache>/<版本>/<包名>；已有缓存直接复用。 */
async function ensurePackage(name, version, versionDir) {
  const target = join(versionDir, name.replace('/', '__'));
  if (existsSync(join(target, 'package', 'package.json'))) return { ok: true, cached: true, dir: target };
  const short = name.split('/').pop();
  const url = `https://registry.npmjs.org/${name}/-/${short}-${version}.tgz`;
  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (error) {
    return { ok: false, reason: '网络失败: ' + (error && error.message ? error.message : error) };
  }
  if (!res.ok) return { ok: false, reason: '该版本无此包 (HTTP ' + res.status + ')' };
  const tgz = join(versionDir, short + '.tgz');
  mkdirSync(target, { recursive: true });
  try {
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    execFileSync('tar', ['-xzf', tgz, '-C', target], { stdio: 'pipe' });
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    if (error && error.code === 'ENOENT') {
      return { ok: false, reason: '未找到 tar 命令（Windows 需 Win10 1803+ 自带 tar，或改用 git bash/WSL）' };
    }
    return { ok: false, reason: '解压失败: ' + (error && error.message ? error.message : error) };
  } finally {
    rmSync(tgz, { force: true });
  }
  return { ok: true, cached: false, dir: target };
}

/** 我们已经逐缝核对过、并写进 README 的宿主版本；`--upstream` 用它判断「上游是否出现未核对版本」。 */
const VERIFIED_VERSIONS = ['0.1.1-rc.2', '0.1.5-rc.2', '0.1.5-rc.3', '0.1.6-alpha.2', '0.1.7-alpha.2', '0.1.7-rc.2'];

const upstreamOnly = process.argv.includes('--upstream');
const alsoCheck = process.argv.includes('--check');
const versions = process.argv.slice(2).filter((a) => !a.startsWith('-'));

/** 上游有没有出现我们没核对过的版本（latest / next / alpha 三个 tag）。 */
async function upstreamDrift() {
  const res = await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('查询上游版本失败：HTTP ' + res.status);
  const meta = await res.json();
  const tags = meta['dist-tags'] || {};
  const drifted = [];
  console.log('[privmask] 上游 dist-tags: ' + JSON.stringify(tags));
  for (const [tag, version] of Object.entries(tags)) {
    if (VERIFIED_VERSIONS.includes(version)) {
      console.log('  ✓ ' + tag + ' = ' + version + '（已核对）');
    } else {
      drifted.push({ tag, version });
      console.log('  ⚠ ' + tag + ' = ' + version + '（未核对：不在已验证清单里）');
    }
  }
  return drifted;
}

let targets = versions.length > 0 ? versions : DEFAULT_VERSIONS;
let driftFound = false;
if (upstreamOnly) {
  const drifted = await upstreamDrift().catch((error) => {
    console.error('[privmask] ' + (error && error.message ? error.message : error));
    process.exitCode = 1;
    return [];
  });
  if (drifted.length > 0) {
    if (alsoCheck) {
      driftFound = true;
      targets = [...new Set(drifted.map((d) => d.version))];
      console.log('\n对未核对版本跑逐缝核对：' + targets.join(', '));
    } else {
      console.error('\n[privmask] 上游出现未核对版本：' + drifted.map((d) => d.tag + '=' + d.version).join(', ')
        + '\n  处理：node tools/dsh-compat-check.mjs ' + drifted.map((d) => d.version).join(' ')
        + '，核对通过后把版本加进本脚本的 VERIFIED_VERSIONS 与 README 的版本适配段');
      process.exit(1);
    }
  } else {
    console.log('[privmask] 上游三个 tag 都在已验证清单内');
    if (!alsoCheck) process.exit(0);
  }
}

mkdirSync(CACHE_DIR, { recursive: true });
console.log('[privmask] dsh 适配自检：版本 ' + targets.join(', ') + '，源码留存目录 ' + relative(ROOT, CACHE_DIR) + '/');

const pkgManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const declaredInject = (pkgManifest.dsh && pkgManifest.dsh.client && pkgManifest.dsh.client.inject) || [];

let failures = 0;
for (const version of targets) {
  const versionDir = join(CACHE_DIR, version);
  mkdirSync(versionDir, { recursive: true });
  const present = new Map();
  for (const name of PACKAGES) {
    const r = await ensurePackage(name, version, versionDir);
    present.set(name, r);
    if (!r.ok) console.log('  · ' + name + '@' + version + '：' + r.reason);
  }
  console.log('\n=== dsh ' + version + ' ===');
  for (const seam of SEAMS) {
    // 一条「缝」可以有多种可接受形态（上游改过 API 名的地方），任一形态命中即算通过
    const parts = seam.any ?? [{ pkg: seam.pkg, needle: seam.needle }];
    const found = [];
    const missing = [];
    for (const part of parts) {
      const pkg = present.get(part.pkg);
      if (!pkg || !pkg.ok) { missing.push(part.pkg); continue; }
      const hits = grepPackage(pkg.dir, part.needle);
      if (hits.length > 0) found.push({ pkg: part.pkg, hits, index: parts.indexOf(part) });
      else missing.push(part.pkg.replace('@deepseek-ai/', '') + '#' + part.needle);
    }
    const must = seam.required === true || seam.critical === true;
    if (found.length > 0) {
      const f = found[0];
      console.log('  ✓ ' + seam.id + '  ' + f.hits[0] + (f.hits.length > 1 ? ' 等 ' + f.hits.length + ' 处' : '')
        + (seam.any && f.index > 0 ? '（该版本用的是新版形态）' : ''));
    } else if (must) {
      failures += 1;
      console.log('  ✗ ' + seam.id + ' 缺失（' + missing.join(', ') + '）：' + seam.note);
    } else {
      console.log('  – ' + seam.id + ' 该版本没有（降级）：' + seam.note);
    }
  }
  // 声明的浏览器端模块依赖：某条线上不存在时不报错（宿主模块表按「未知条目跳过」处理），
  // 但要打印出来，避免声明悄悄腐烂。
  for (const id of declaredInject) {
    const r = present.get(id);
    if (!r) {
      console.log('  ? ' + id + '（未纳入本脚本采集范围）');
    } else if (!r.ok) {
      console.log('  ⚠ ' + id + ' 在 ' + version + ' 不存在：' + r.reason + '（宿主按未知条目跳过，卡片仍加载；已核对 dsh-client-modules 实现）');
    } else {
      console.log('  ✓ 声明模块 ' + id);
    }
  }
}

if (failures > 0) {
  console.error('\n[privmask] 适配自检失败：' + failures + ' 个必需缝缺失，插件需要适配后再发布');
  process.exitCode = 1;
} else if (driftFound) {
  // 缝都在 = 新版本可以直接用，但清单还没更新；仍然报红，提醒把版本补进 VERIFIED_VERSIONS 与 README
  console.error('\n[privmask] 上游新版本的宿主缝都在（可直接用），但版本尚未纳入已验证清单：'
    + targets.join(', ') + '\n  处理：把版本加进 tools/dsh-compat-check.mjs 的 VERIFIED_VERSIONS 与 README 的版本适配段');
  process.exitCode = 1;
} else {
  console.log('\n[privmask] 适配自检通过：必需缝全部存在；源码已留存于 ' + relative(ROOT, CACHE_DIR) + '/（不进提交）');
}
