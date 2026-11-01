# 安装与升级

## 通过 dsh CLI（推荐）

```sh
dsh plugin --profile web add dsh-privmask
```

包通过 `dsh.bundle` 声明自动挂载到 profile 层栈，安装后重启 `dsh web` 生效。

DSH Desktop（`desktop` profile）同理，把 `web` 换成 `desktop` 即可：

```sh
dsh plugin --profile desktop add dsh-privmask
```

`desktop` 下卡片出现在「设置 → 插件」的页签里（0.2.43 起；此前因客户端硬依赖宿主不存在的
`remote.pluginInventory` 而停在 PENDING，见 [issue #2](https://github.com/JunyuZhan/dsh-privmask/issues/2)）。

若该宿主没有客户端设置界面，则用配置文件模式：

```yaml
# $DSH_HOME/profiles/desktop/cordis.patch.yml
- id: privmask
  config:
    enabled: true
    redactNames: true
    redactCompanies: true
    redactOrgs: true
    redactAddress: true
    redactCredentials: true
    customTerms: [张三, 某某公司]
```

## 升级与卸载

```sh
dsh plugin --profile web update dsh-privmask
dsh plugin --profile web remove dsh-privmask
```

> 已核对过哪些宿主版本、设置 API 有哪些形态变化，见[兼容性与升级](compatibility.md)。

## 通过 npm

```sh
npm install dsh-privmask
```

只安装包不会自动挂进 profile；需要按上面的 `dsh plugin add` 或配置文件模式接入。

## 环境与安装排查

- **Node 版本**：声明 `>=18`，CI 在 Node 18/20/22 运行，本仓库同时在 Node 24 手工验证。
- **官方包与开发线**：浏览器端同时适配官方 npm `@deepseek-ai/dsh`（0.1.0-rc.6 / 0.1.1-rc.2 旧线，
  与 0.1.5-rc.2 当前 latest）；若默认 registry 是镜像源且新版本未同步，更新时可显式指定官方源：
  `dsh plugin --profile web update dsh-privmask --registry=https://registry.npmjs.org`。
- **“Already up to date”或安装报“最小发布期”**：pnpm 11 供应链策略会拦截刚发布（未过发布期）的版本，
  把对应版本加入 profile 的 `pnpm-workspace.yaml` 白名单即可：
  `minimumReleaseAgeExclude: [dsh-privmask@<版本号>]`。
- **更新后必须重启**：`dsh plugin ... update` 只替换包文件，运行中的进程仍加载旧代码；
  重启后访问令牌会变化（dsh web 每次启动打印新地址），后台服务（如 LaunchAgent）请用
  `launchctl bootout/bootstrap` 重启，再打开启动日志末尾打印的带 token 地址。
- **profile 差异**：隐私保护卡片出现在任何提供 `slots` / `locale` / `settingsScope` 的客户端运行时里
  （`web` profile，以及 DSH Desktop 的 `desktop` profile；后者 0.2.43 起可用，见
  [issue #2](https://github.com/JunyuZhan/dsh-privmask/issues/2) 的根因修复）；
  headless/无客户端界面的 profile 使用同一套 host 规则与配置文件
  （`$DSH_HOME/profiles/<name>/cordis.patch.yml`），展示层还原、运行时开关等浏览器能力自动降级。
