# 安装与升级

## 先确认你用的是哪种 DSH

- **DSH Desktop（桌面版）**：侧栏有「插件」入口。绝大多数用户是这种（当前桌面运行时
  0.2.1-rc.5 实测）。
- **dsh CLI / web profile**：在终端里跑 `dsh web` 的自部署或开发环境。

两种方式装的都是同一个 npm 包 `dsh-privmask`，区别只在装进哪个 profile。

## 方式一：插件市场「发现」（最省事）

DSH Desktop 的插件页支持插件市场索引（实验性组合包「自定义插件市场」）。本插件仓库已加 `dsh-plugin` topic，进入 [DSH.SO 插件注册表](https://www.dsh.so/)
的自动发现队列（收录审核与索引刷新由第三方控制，审核期间在「发现」里搜不到属正常）。

1. 侧栏**插件** → 实验性插件旁的**更多** → 启用**自定义插件市场**（插件页随后出现**发现**标签）；
2. 切到**发现**；若还没有索引源，点**添加索引源**，填其一：
   - **本项目自有索引**（随版本更新，不等第三方收录，推荐先用这个）：
     `https://cdn.jsdelivr.net/gh/JunyuZhan/dsh-privmask@main/market/index.json`
     （不可达时用 `https://raw.githubusercontent.com/JunyuZhan/dsh-privmask/main/market/index.json`）；
   - **DSH.SO 社区市场**（第三方，收录审核由对方控制）：`https://cdn.dsh.so/market/index.json`；
3. 搜索 `dsh-privmask` → **安装** → 确认 → **立即启用** → 重启 DSH Desktop。

该索引由第三方维护，收录与刷新时间不受我们控制；搜不到或急着用时，直接走
**方式二**（界面「添加插件」按包名装）或**方式三**（让 agent 装）。

## 方式二：DSH Desktop「添加插件」

1. 侧栏打开**插件** → **已安装**标签 → **添加插件**；
2. 输入包名 `dsh-privmask`（可带版本，如 `dsh-privmask@0.2.49`）；
3. 安装源保持默认即可（Host 会自动在 npm 官方源与国内镜像之间探测最快的一个，
   也可以手动切到「中国大陆镜像源」或自定义地址）；
4. 等**安装**完成，点**立即启用**；
5. 按提示**重启 DSH Desktop**；
6. 验证：**设置 → 插件**出现「隐私保护」页签，卡片底部显示 `v0.2.x`。

说明：

- 「安装成功」不等于「已启用」：必须点「立即启用」并重启，宿主才会挂载插件。
- 若 pnpm 拦下依赖的构建脚本，界面会列出包名并给「允许这些脚本并重试」——本插件没有
  安装期脚本，正常不会遇到；遇到时按提示允许即可。
- 内网镜像源还没同步新版本时，在安装源的选项里切到 npm 官方源再装。

## 方式三：让 agent 自行安装

适用：DSH 内置 agent（自带终端工具），或任何能执行命令的编码 agent。

DSH Desktop **自带 CLI 与运行时**（Node 24 + pnpm 11），只是不一定在 PATH 上；
用应用自带 CLI 即可，不需要用户另外装 node/pnpm：

| 平台 | 自带 CLI 路径 |
|---|---|
| Windows | `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd` |
| macOS | `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` |

> 安装位置不同时，在应用包内找 `resources/runtime/cli/bin/dsh`（Windows 为 `dsh.cmd`）。

可直接把下面这段发给 agent：

```text
请在这台机器上安装并验证 DeepSeek Harness 的本地脱敏插件 dsh-privmask：
1. 判断环境：读环境变量 DSH_PROFILE / DSH_HOME（默认 ~/.dsh），桌面版一般是 desktop。
2. 找 CLI：先试 `dsh --version`；桌面版不在 PATH 时用自带 CLI：
   Windows: "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
   macOS:   "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
   先用 --version 确认能跑（桌面版自带 node/pnpm，无需另装）。
3. 安装：<上面找到的 dsh> plugin --profile <profile> add dsh-privmask
4. 校验：读 ~/.dsh/profiles/<profile>/package.json，dependencies 里应有 dsh-privmask；
   用 `npm view dsh-privmask version` 记录实际版本。
5. 请用户重启 DSH Desktop，然后确认「设置 → 插件」出现「隐私保护」页签（卡片底部有版本号）。
6. 汇报：安装方式、版本、是否需要重启；失败时给出原因（镜像未同步 / pnpm 最小发布期拦截 /
   profile 无写权限 / CLI 不可用）并建议改用界面「插件 → 添加插件」。
```

注意事项：

- 安装只是把包装进 profile 并登记挂载，**不会读取或上传任何聊天内容**。
- **已在 DSH Desktop 0.2.1-rc.5 实测**：用自带 CLI 执行
  `plugin --profile <profile> add dsh-privmask` 会自动写入 profile 依赖、把 `dsh-privmask`
  加进 `dsh.profile.bundles`、并给 pnpm 的 `minimumReleaseAgeExclude` 加白名单；重启后插件挂载、
  卡片进入客户端模块表、profile 版本与 npm 一致（`node tools/smoke.mjs` 8/8 通过）。
- Desktop 正在运行时，CLI 写入 profile 后仍需重启才生效；若提示 profile 被占用，
  改用界面安装（界面会处理锁定、启用与失败回滚）。
- agent 报告「CLI 找不到」时，也可以让用户直接在界面里装（方式一），不必强求命令行。

agent 装完后的检查清单（也可以让用户自己看）：

- [ ] `~/.dsh/profiles/<profile>/package.json` 的 `dependencies` 含 `dsh-privmask`
- [ ] `~/.dsh/profiles/<profile>/cordis.patch.yml` 里有 `id: privmask` 条目（或由 bundle 自动挂载）
- [ ] 重启后「设置 → 插件」有「隐私保护」页签，卡片显示版本号
- [ ] 发一条含邮箱的消息，会话日志里 `user/message` 为 `[REDACTED_EMAIL_N]`（出站遮罩生效）

## 方式四：CLI（web profile / 无界面部署）

```sh
dsh plugin --profile web add dsh-privmask
```

包通过 `dsh.bundle` 声明自动挂载到 profile 层栈，安装后重启 `dsh web` 生效。

```sh
dsh plugin --profile web update dsh-privmask
dsh plugin --profile web remove dsh-privmask
```

只装到 web profile 时，桌面版的 `desktop` profile 不受影响；反之亦然。

## 方式五：npm（手动）

```sh
npm install dsh-privmask
```

只安装包不会自动挂进任何 profile；还需要按方式二/四/配置文件模式接入。

## 配置文件模式（无客户端界面的 profile）

headless / 没有插件页的宿主，直接在 profile 里挂载并配置：

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

前提是该 profile 的依赖里已经装了 `dsh-privmask`（方式一/二/三任一），否则先装包。

> 已核对过哪些宿主版本、设置 API 有哪些形态变化，见[兼容性与升级](compatibility.md)。

## 环境与安装排查

- **DSH Desktop 自带运行时**：`resources/runtime` 下有 Node 24 与 pnpm 11（界面安装走它），
  不需要用户单独装 node/pnpm；用户自己装的 node 只影响 CLI/开发用法。
- **Node 版本（CLI 用法）**：本包声明 `>=18`，CI 在 Node 18/20/22 运行，本仓库同时在 Node 24 手工验证。
- **官方包与开发线**：浏览器端同时适配官方 npm `@deepseek-ai/dsh`（0.1.0-rc.6 / 0.1.1-rc.2 旧线，
  与 0.1.5-rc.2 当前 latest）；若默认 registry 是镜像源且新版本未同步，更新时可显式指定官方源：
  `dsh plugin --profile web update dsh-privmask --registry=https://registry.npmjs.org`。
- **“Already up to date”或安装报“最小发布期”**：pnpm 11 供应链策略会拦截刚发布（未过发布期）的版本，
  把对应版本加入 profile 的 `pnpm-workspace.yaml` 白名单即可：
  `minimumReleaseAgeExclude: [dsh-privmask@<版本号>]`。
- **更新后必须重启**：`dsh plugin ... update` 与界面安装都只替换包文件，运行中的进程仍加载旧代码；
  重启后访问令牌会变化（dsh web 每次启动打印新地址），后台服务（如 LaunchAgent）请用
  `launchctl bootout/bootstrap` 重启，再打开启动日志末尾打印的带 token 地址。
- **profile 差异**：隐私保护卡片出现在任何提供 `slots` / `locale` / `settingsScope` 的客户端运行时里
  （`web` profile，以及 DSH Desktop 的 `desktop` profile；后者 0.2.43 起可用，见
  [issue #2](https://github.com/JunyuZhan/dsh-privmask/issues/2) 的根因修复）；
  headless/无客户端界面的 profile 使用同一套 host 规则与配置文件
  （`$DSH_HOME/profiles/<name>/cordis.patch.yml`），展示层还原、运行时开关等浏览器能力自动降级。
- **怎么确认装的是哪一版**：看「设置 → 插件」卡片底部的 `插件版本：vX.Y.Z`，或读
  `~/.dsh/profiles/<profile>/package.json` 里 `dsh-privmask` 的版本。
