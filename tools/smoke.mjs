#!/usr/bin/env node
/**
 * 发版冒烟：起一次真实 `dsh web`，断言插件真的挂上了、并且装的是当前这份代码。
 *
 * 覆盖的都是实际踩过的坑：
 * - 插件没挂载（profile 没声明 / 宿主启动报错）→ 日志里没有 `[privmask] 适配检查`
 * - 设置命名空间没注册（卡片开关会失效）→ 日志里没有 `运行时设置已注册`
 * - 客户端模块没进模块表（界面看不到「隐私保护」页签）→ 首页里没有 `dsh-privmask/client.js`
 * - 装的是旧版本（改完代码忘了更新 profile）→ profile 内版本与仓库 package.json 不一致
 *
 * 不调用模型、不产生费用、不需要浏览器。用法：
 *   node tools/smoke.mjs [--profile web] [--allow-version-drift] [--keep-open]
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PROFILE = value('--profile', 'web');
/** 允许指定 dsh 可执行文件（例如用临时安装的 0.1.7 验证新版宿主，而不动全局安装）。 */
const DSH_BIN = value('--dsh', 'dsh');
const ALLOW_DRIFT = flag('--allow-version-drift');
const KEEP_OPEN = flag('--keep-open');
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE);
const START_TIMEOUT_MS = 60_000;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''));
  return ok;
};

/** 浏览器信任流：先拿 303 的 cookie，再带 cookie 取首页（与真实浏览器一致，不依赖任何插件补丁）。 */
async function fetchIndex(url) {
  const first = await fetch(url, { redirect: 'manual' });
  if (first.status === 200) return first.text();
  const cookie = (first.headers.get('set-cookie') || '').split(';')[0];
  const location = new URL(first.headers.get('location') || '/', url).toString();
  const second = await fetch(location, { headers: cookie ? { cookie } : {} });
  return second.text();
}

const child = spawn(DSH_BIN, ['--profile', PROFILE, '--no-open', '--port', '0'], {
  cwd: ROOT,
  detached: true, // 单独进程组，退出时整组清掉，避免留孤儿
  stdio: ['ignore', 'pipe', 'pipe'],
});

let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });
let exited = null;
child.on('exit', (code, signal) => { exited = { code, signal }; });

function stopChild() {
  if (exited !== null || child.pid === undefined) return;
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    try { process.kill(-child.pid, sig); } catch { /* 已退出 */ }
    if (exited !== null) return;
    // 给 SIGTERM 一点时间，再补 SIGKILL
    if (sig === 'SIGTERM') {
      const until = Date.now() + 3000;
      while (Date.now() < until && exited === null) {
        try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } catch { /* ignore */ }
      }
    }
  }
}

async function waitForUrl() {
  const until = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < until) {
    const m = log.match(/http:\/\/[^\s]*token=[A-Za-z0-9_-]+/);
    if (m) return m[0];
    if (exited !== null) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

let failed = 0;
try {
  const url = await waitForUrl();
  if (!check('宿主启动并打印访问地址', url !== null, url || '超时未出现（日志末尾：' + log.slice(-200).replace(/\n/g, ' ') + '）')) failed += 1;

  if (url !== null) {
    const adapt = log.match(/\[privmask\] 适配检查: .*/)?.[0] || '';
    check('插件已挂载（打印适配检查）', adapt !== '', adapt || '未找到 [privmask] 适配检查 行');
    check('llm 服务可用', /llm=✓/.test(adapt), adapt);
    check('settings 命名空间已注册（卡片开关可 live 生效）', /\[privmask\] 运行时设置已注册/.test(log));

    let html = '';
    try {
      html = await fetchIndex(url);
    } catch (error) {
      check('取回首页', false, String(error && error.message ? error.message : error));
    }
    if (html !== '') {
      check('客户端模块表含 dsh-privmask/client.js（界面能看到卡片）', html.includes('dsh-privmask/client.js'), 'index ' + html.length + ' 字节');
    }
  }

  // 版本一致性：profile 里实际装的，必须就是仓库里这份代码
  const repoVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  let profileSpec = null;
  let installed = null;
  try {
    const profilePkg = JSON.parse(readFileSync(join(PROFILE_DIR, 'package.json'), 'utf8'));
    profileSpec = profilePkg.dependencies?.['dsh-privmask'] ?? null;
    const bundle = profilePkg.dsh?.profile?.bundles ?? [];
    check('profile 的 bundles 含 dsh-privmask', bundle.includes('dsh-privmask'), JSON.stringify(bundle));
    installed = JSON.parse(readFileSync(join(PROFILE_DIR, 'node_modules', 'dsh-privmask', 'package.json'), 'utf8')).version;
  } catch (error) {
    check('读取 profile 安装信息', false, String(error && error.message ? error.message : error));
  }
  check('profile 已安装插件', installed !== null, '声明 ' + profileSpec + ' / 实装 ' + installed);
  if (installed !== null) {
    const same = installed === repoVersion;
    const detail = '仓库 ' + repoVersion + ' / profile 实装 ' + installed;
    if (same) check('profile 装的就是当前代码版本', true, detail);
    else if (ALLOW_DRIFT) console.log('SKIP profile 版本与仓库不一致（--allow-version-drift）：' + detail);
    else { check('profile 装的就是当前代码版本', false, detail + '（先 dsh plugin --profile ' + PROFILE + ' add dsh-privmask）'); failed += 1; }
  }
} catch (error) {
  check('冒烟执行', false, String(error && error.stack ? error.stack : error));
  failed += 1;
} finally {
  if (KEEP_OPEN) console.log('\n--keep-open：保留进程 pid=' + child.pid + '，日志见下方');
  else stopChild();
}

const failedChecks = results.filter((r) => !r.ok).length;
if (failedChecks > 0 || failed > 0) {
  console.error('\n[privmask] 冒烟失败：' + failedChecks + ' 项不通过。宿主日志（末尾 1500 字）：\n' + log.slice(-1500));
  process.exitCode = 1;
} else {
  console.log('\n[privmask] 冒烟通过：插件已挂载、卡片进入模块表、profile 版本与仓库一致（' + results.length + ' 项）');
}
