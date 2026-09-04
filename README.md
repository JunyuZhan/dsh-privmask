# dsh-privmask

[![npm version](https://img.shields.io/npm/v/dsh-privmask)](https://www.npmjs.com/package/dsh-privmask)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/JunyuZhan/dsh-privmask/actions/workflows/test.yml/badge.svg)](https://github.com/JunyuZhan/dsh-privmask/actions/workflows/test.yml)

DeepSeek Harness 本地脱敏插件：在请求发往云端大模型之前，将密钥、个人身份信息与中文实体替换为 `[REDACTED_类别_N]` 占位符；云端只看到脱敏内容，用户输入与工具结果在写入本地会话日志前同样遮罩。支持入站还原，模型返回的占位符在本地还原为原值，保证工具链与文档起草的精度。

## 目录

- [特性](#特性)
- [安装](#安装)
- [快速开始](#快速开始)
- [配置](#配置)
- [脱敏机制](#脱敏机制)
- [安全模型](#安全模型)
- [已知限制](#已知限制)
- [测试与 CI](#测试与-ci)
- [贡献](#贡献)
- [安全](#安全)
- [行为准则](#行为准则)
- [发布](#发布)
- [许可证](#许可证)

## 特性

- **出站脱敏**：PEM/JWT/API Key、Bearer/Authorization、邮箱、电话、IPv4/IPv6、身份证（18/15 位）、统一社会信用代码、手机/座机、银行卡（Luhn 校验）、案号、车牌、护照/证件、微信号/QQ 号/律师执业证号（上下文识别）、出生日期、地址、公司名、司法机关
- **入站还原**：模型输出文本与工具调用参数中的占位符在本地还原为原值；用户消息在日志中为占位符、经展示层（`sessionController.page/follow`）还原为原文显示，模型回复与工具调用参数以真值显示并落盘；还原值再次出站时重新脱敏，云端始终只看到占位符
- **流式重组**：占位符被网络切分到多个 delta 时，尾部缓冲跨分片还原，流式显示不残留前缀；还原未命中（映射被逐出/模型改写）有统计与日志可见
- **全面脱敏档**：隐私保护卡片可一键开启「全面脱敏（姓名/公司/机关）」，涉案金额、日期、案号仍保留（便于金额核算与时效判断）
- **自定义敏感词编辑**：卡片内直接添加/删除当事人姓名、别名、机构简称，live 生效并持久化
- **脱敏对照工具**：`npm run mask:preview -- <文件> [--redactFacts]` 输出原文 / 脱敏后（发往云端）/ 还原后三份对照，纯本地不发送数据
- **日志脱敏**：用户输入（`agent/pre-step`）与工具结果（`tools/post-execute`）在写入会话日志前遮罩，原则上不落明文（dsh 个别内部事件会保留原文副本，见[已知限制](#已知限制)）；模型回复仍由入站还原为真值
- **严格模式**：脱敏异常（failClosed）、未检查字段（strictUnknown）默认拒绝请求；非文本内容默认剥离（nonTextPolicy=strip），图片字节不出本地
- **隐私优先（默认）**：姓名、身份证、联系方式、地址、公司/单位名称等能唯一锁定对象的信息默认脱敏；案号、出生日期、涉案金额等公开可查或办案所需信息默认保留
- **会话一致性**：同一会话内同一值跨请求映射到同一占位符，模型可跨轮关联实体；不同会话相互隔离
- **类别化配置**：凭据 / 地址 / 姓名 / 公司 / 机关 / 案号 / 出生日期 分别开关，按场景组合

## 安装

### 通过 dsh CLI（推荐）

```sh
dsh plugin --profile web add dsh-privmask
```

包通过 `dsh.bundle` 声明自动挂载到 profile 层栈，安装后重启 `dsh web` 生效。

升级与卸载：

```sh
dsh plugin --profile web update dsh-privmask
dsh plugin --profile web remove dsh-privmask
```

> **兼容性**：0.2.27 起浏览器端同时适配官方 npm 包
> （`@deepseek-ai/dsh` 0.1.0-rc.6 / 0.1.1-rc.2，即 `npx @deepseek-ai/dsh web` 安装的版本）
> 与 0.1.2-alpha.1 开发线。run_code 子派发日志遮罩仅在宿主提供
> `tools/ptc-dispatch-log`（dsh ≥ 0.1.2）时自动启用，旧官方版无此事件属宿主能力差异，
> 核心出站脱敏与卡片开关在两线上均可用。

### 通过 npm

```sh
npm install dsh-privmask
```

### 环境与安装排查

- **Node 版本**：声明 `>=18`，CI 在 Node 18/20/22 运行，本仓库同时在 Node 24 手工验证。
- **官方包与开发线**：浏览器端同时适配官方 npm `@deepseek-ai/dsh`
  （0.1.0-rc.6 / 0.1.1-rc.2）与 0.1.2-alpha.1 开发线；若默认 registry 是镜像源且新版本未同步，
  更新时可显式指定官方源：`dsh plugin --profile web update dsh-privmask --registry=https://registry.npmjs.org`。
- **“Already up to date”或安装报“最小发布期”**：pnpm 11 供应链策略会拦截刚发布（未过发布期）的版本，
  把对应版本加入 profile 的 `pnpm-workspace.yaml` 白名单即可：
  `minimumReleaseAgeExclude: [dsh-privmask@<版本号>]`。
- **更新后必须重启**：`dsh plugin ... update` 只替换包文件，运行中的进程仍加载旧代码；
  重启后访问令牌会变化（dsh web 每次启动打印新地址），后台服务（如 LaunchAgent）请用
  `launchctl bootout/bootstrap` 重启，再打开启动日志末尾打印的带 token 地址。
- **profile 差异**：隐私保护卡片只在 `web` profile 的“设置 → 插件”里出现；
  headless/其它 profile 使用同一套 host 规则与配置文件（`$DSH_HOME/profiles/<name>/cordis.patch.yml`），
  展示层还原、运行时开关等浏览器能力自动降级。

## 快速开始

默认配置即「隐私优先」：密钥凭据、地址、姓名、公司/单位名称与 PII 脱敏；案号、出生日期、涉案金额保留（公开可查或办案所需）。

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml 中按 id 覆盖
- id: privmask
  config:
    enabled: true
    redactCredentials: true
    redactAddress: true
    redactNames: true
    redactCompanies: true
    redactOrgs: true
    redactCaseNumbers: false
    redactDob: false
    nonTextPolicy: strip
    failClosed: true
```

需要案号/出生日期也脱敏时，将 `redactCaseNumbers: true` / `redactDob: true`；需要严格身份证校验时保持 `strictId18: true`（默认）。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `cnEntities` | `true` | 中文实体识别总开关 |
| `redactCredentials` | `true` | 凭据类脱敏：PEM、JWT、API Key、Bearer/Authorization、密码等 |
| `redactAddress` | `true` | 地址类脱敏：省市区乡、住址、户籍地、送达地址等 |
| `redactNames` | `true` | 姓名脱敏：姓名是能唯一锁定当事人的信息 |
| `redactCompanies` | `true` | 公司名称脱敏：法人唯一标识 |
| `redactOrgs` | `true` | 机关/单位名称脱敏 |
| `redactCaseNumbers` | `false` | 案号脱敏：默认保留（公开案件标识，管辖/关联判断需要真值） |
| `redactDob` | `false` | 出生日期脱敏：默认保留（非唯一信息，年龄/时效计算需要真值） |
| `customTerms` | `[]` | 自定义敏感词表：精确子串匹配即脱敏，不受角色上下文限制（当事人姓名/别名/机构简称）；面板输入框支持用分号/逗号/顿号分隔一次添加多个 |
| `preserveValues` | `[]` | 白名单：命中规则的值也原样保留（标记放行误报） |
| `strictId18` | `true` | 身份证 18 位严格校验：仅校验位合法的号码脱敏；关闭后日期段合理或带「身份证号」上下文的号码也脱敏 |
| `restoreInbound` | `true` | 入站还原：云端返回的占位符在本地还原为原值（响应显示、工具执行），下次出站重新脱敏；历史展示层还原依赖 `persistMapping: true` |
| `nonTextPolicy` | `strip` | 非文本内容策略：`strip`=移除后放行、`block`=拒绝请求、`allow`=原样透传 |
| `longTokens` | `true` | 长 hex/base64 串脱敏 |
| `redactToolMeta` | `true` | 工具描述/参数 schema 脱敏（关闭可避免影响模型对工具用途的理解） |
| `redactPaths` | `false` | 绝对路径脱敏（开启会破坏文件工具的路径回传） |
| `persistMapping` | `true` | 同一会话内跨请求保持同一值映射同一占位符；关闭则每请求重新编号，且浏览器历史展示层无法还原已落盘的占位符（流内实时还原不受影响） |
| `dropSessionId` | `true` | 移除 `x-deepseek-harness-session-id` 请求头 |
| `failClosed` | `true` | 严格模式：脱敏异常时拒绝请求，绝不把未脱敏数据发往云端 |
| `strictUnknown` | `true` | 严格模式：发现未检查的未知字段（含嵌套的非普通对象，如 Buffer/类实例）时拒绝请求 |
| `logRedactions` | `true` | 每次脱敏打印一行统计日志 |

## 脱敏机制

插件挂载在 `llm/stream` 水瀑（dsh 唯一的请求边界），拦截发生在请求到达 adapter（云端边界）之前。机制要点：

- **只处理会真正上云的内容**：adapter 序列化时只发送 `message.content` 内容块；消息的 `source` 元数据（notice 摘要、snapshot 片段、replayState）不会上云，因此不在此列。
- **reasoning 内容会上云**：adapter 将 `reasoning` 块序列化为 `reasoning_content` 发送，本插件同样脱敏。
- **辅助调用同样脱敏**：`purpose: compaction / session-title` 的请求同样经过 `llm/stream`。
- **原请求保持不变**：agent-loop 构建的请求被深冻结并用 WeakSet 标记；本插件生成脱敏副本重入水瀑，原请求对象不修改；用户输入在落盘前已由 `agent/pre-step` 遮罩。
- **日志落盘前遮罩**：`agent/pre-step` 改写进入步骤的用户消息，`tools/post-execute` 改写工具结果，`tools/ptc-dispatch-log`（dsh ≥ 0.1.2）改写 run_code 子派发日志——在写入 `user/message` / `tool/result` / `tool/code-dispatch` 事件前即替换为占位符；与 `llm/stream` 共用同一会话映射，编号一致，且 `llm/stream` 仍作为辅助调用（compaction/session-title）的兜底。
- **展示层还原**：浏览器通过 `sessionController.page/follow` 读取会话；插件包装这两个方法，在返回浏览器前按会话映射把占位符还原为原值——用户消息的界面显示为原文（其落盘副本仍为占位符），模型回复与工具调用参数因入站还原以真值显示并落盘（`restoreInbound: false` 时关闭）。
- **入站还原**：模型返回流中的占位符按会话映射在本地还原为原值；还原内容再次出站时重新脱敏。
- **会话头**：adapter 会发送 `x-deepseek-harness-session-id` 请求头，`dropSessionId` 默认移除。

## 安全模型

本插件以「敏感数据不出本地」为目标，按数据类别区分策略：

| 类别 | 默认 | 理由 |
|---|---|---|
| 密钥凭据 | 脱敏 | 模型永远不需要，脱敏零损失 |
| 地址（省市区乡/住址） | 脱敏 | 当事人隐私核心；起草文书时由入站还原写回真值 |
| 姓名 | 脱敏 | 能唯一锁定当事人的信息 |
| 公司/单位名称 | 脱敏 | 法人/单位唯一标识 |
| 案号 | 保留 | 公开案件标识，不指向个人；管辖/关联判断需要真值 |
| 出生日期 | 保留 | 非唯一信息；年龄/时效计算需要真值 |
| 涉案金额 | 保留 | 诉讼费、违约金、利息计算依赖金额 |
| 邮箱/电话/身份证等 PII | 脱敏 | 高敏感身份信息 |

出站边界：云端不可逆地只能看到占位符。日志边界：用户输入与工具结果落盘前已遮罩为占位符；模型回复（含工具调用参数）经入站还原以真值落盘——这是方案取舍（保证工具执行与界面显示真值）。展示边界：浏览器读取会话时经 `sessionController.page/follow` 还原为原文（用户自己的消息也能显示真值）。入站还原仅发生在本地内存与会话日志，还原值一旦再次出站即被重新脱敏。

## 已知限制

- **仅文本脱敏**：图片/文件等非文本内容默认剥离（不发送），不进行 OCR 或像素级处理；若启用 DeepSeek 多模态直发图片，需显式设置 `nonTextPolicy: allow` 并自行评估风险。
- **启发式识别**：姓名/公司/地址等基于角色上下文、姓氏库与正则规则，复杂句式下可能漏检或误伤。
- **自定义词表为精确子串匹配**：`customTerms` 中的词命中即脱敏，包含该词的长词同样命中（如词表含「张三」时「张三丰」也会被命中）；误报可用 `preserveValues` 标记放行。
- **证件/信用代码校验**：带「身份证号/统一社会信用代码」等明确标注的号码**始终脱敏**（不依赖校验位）；
  无上下文的号码默认仅校验位合法者脱敏（避免误伤订单号），可关闭 `strictId18` 或加入自定义词表兜底。
- **文件名与路径默认保留**（`redactPaths: false`），开启后文件类工具链会断裂。
- **日志中模型回复为真值**：方案取舍下 assistant 消息（模型回显的姓名/公司等）与工具调用参数在日志中为真值；如需日志完全无明文，需关闭入站还原或使用更严格的落盘方案。
- **`agent/inbox/spliced` 事件保留用户消息原文**：dsh 在用户消息进入 inbox 队列时以原文落盘该会话事件，该事件早于 `agent/pre-step` 且无插件改写缝（`session/event` 为只读观察），privmask 无法遮罩这一份日志副本；模型上下文与出站请求仍使用遮罩后的 `user/message`，不受影响。
- **`nonTextPolicy: block` 时用户消息会被整体拒绝**：图片/文件块在 `agent/pre-step` 即触发步骤拒绝（`reject`），不写入日志也不上云。
- **内存映射**：占位符映射仅存于内存，进程重启后会话内映射即失效；单类别超过 2000 个不同值后最旧映射被逐出（编号不复用），被逐出的旧占位符不再还原；引擎另有 200 个会话上限（超限淘汰最旧会话），极端规模下内存占用可能仍较大；云端侧不可逆，无法还原。

## 测试与 CI

```sh
node test/self-test.js        # 14 项功能回归（端到端拦截 + 中文实体）
node test/reliability-test.js # 137 项可靠性（边界/幂等/防误伤/校验/配置/姓名边界/图片策略/严格模式/入站还原/类别策略/性能/编号单调/交叉规则/日志遮罩/展示层还原/词表白名单/delta重组/兼容矩阵/settings惰性注册/词表热更新/字符串 content 还原/出站脱敏）
node test/accuracy-test.js    # 26 项准确性（法律文档矩阵/凭据/PII校验/证件与信用代码上下文/复姓/泛化机构与村镇/姓名标签边界/客户端版本一致性）
node test/fuzz-test.js        # 300 例随机文本 × 2 断言（不崩 + 幂等，共 600 断言）
```

CI（GitHub Actions，Node 18/20/22）在每次 push / PR 时自动运行全部测试（`node:test` 结构化报告）。

## 诊断与统计

- **控制台日志**：所有关键动作以 `[privmask]` 前缀输出，如启动配置、每次脱敏统计
  （类别与次数）、非文本拦截原因、运行时设置 live 更新等；`logRedactions: false` 时仅保留错误与告警。
- **结构化事件**：每次请求/落盘遮罩/拦截/还原未命中都会发出 `privmask/stats` 事件
  （`ctx.emit`），`kind` 为 `redacted / logRedacted / blocked / error / restoreMiss / settingsUpdated` 等。
- **还原未命中**：模型返回无法还原的占位符时（映射被逐出或模型改写），日志会给出
  sessionId、未命中数量与最多 3 个占位符样例，便于判断是否因会话超长逐出导致。
- **诊断文件**：启动与还原关键路径另写一份 `$DSH_HOME/privmask-restore.log`（默认 `~/.dsh/`），
  用于在无控制台可读的真实环境（如 LaunchAgent）排查入站还原问题。

## 脱敏对照工具

本地检查一份文本在脱敏前后的样子（不会发送任何数据）：

```sh
npm run mask:preview -- 案情.txt            # 默认档：隐私实体脱敏，金额/日期/案号保留
npm run mask:preview -- 案情.txt --redactFacts   # 全面档：姓名/公司/机关也脱敏
```

输出三份：原文 / 脱敏后（发往云端的样子）/ 还原后（模型产出经本地还原的样子），以及占位符统计。

## 贡献

- 开发/提交流程见 [CONTRIBUTING.md](CONTRIBUTING.md)
- 发现漏检/误伤或功能建议：提交 [Issue](https://github.com/JunyuZhan/dsh-privmask/issues)（附测试样例，便于回归）
- 改进规则或修复 bug：提交 [PR](https://github.com/JunyuZhan/dsh-privmask/pulls)
- 提交前请确保四套测试全部通过（`self/accuracy/reliability/fuzz`）

## 安全

本插件以「云端与日志不见明文」为安全目标。发现隐私泄漏、绕过脱敏或安全缺陷时，
请按 [SECURITY.md](SECURITY.md) 报告（不要在公开 Issue 中贴真实敏感数据）。

## 行为准则

参与本项目即表示同意 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 发布

```sh
npm login
npm publish
```

`prepublishOnly` 会先运行全部测试，通过才允许发布。版本变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT © 2026 JunyuZhan。详见 [LICENSE](LICENSE)。
