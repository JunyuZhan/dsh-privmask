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
- [发布](#发布)
- [许可证](#许可证)

## 特性

- **出站脱敏**：PEM/JWT/API Key、Bearer/Authorization、邮箱、电话、IPv4/IPv6、身份证（18/15 位）、统一社会信用代码、手机/座机、银行卡（Luhn 校验）、案号、车牌、护照/证件、微信号/QQ 号/律师执业证号（上下文识别）、出生日期、地址、公司名、司法机关
- **入站还原**：模型输出文本与工具调用参数中的占位符在本地还原为原值；浏览器展示层（`sessionController.page/follow`）同样还原，界面显示原文而日志保持占位符；还原值再次出站时重新脱敏，云端始终只看到占位符
- **流式重组**：占位符被网络切分到多个 delta 时，尾部缓冲跨分片还原，流式显示不残留前缀；还原未命中（映射被逐出/模型改写）有统计与日志可见
- **全面脱敏档**：隐私保护卡片可一键开启「全面脱敏（姓名/公司/机关）」，涉案金额、日期、案号仍保留（便于金额核算与时效判断）
- **自定义敏感词编辑**：卡片内直接添加/删除当事人姓名、别名、机构简称，live 生效并持久化
- **脱敏对照工具**：`npm run mask:preview -- <文件> [--redactFacts]` 输出原文 / 脱敏后（发往云端）/ 还原后三份对照，纯本地不发送数据
- **日志脱敏**：用户输入（`agent/pre-step`）与工具结果（`tools/post-execute`）在写入会话日志前遮罩，日志不落明文；模型回复仍由入站还原为真值
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

### 通过 npm

```sh
npm install dsh-privmask
```

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
| `customTerms` | `[]` | 自定义敏感词表：精确子串匹配即脱敏，不受角色上下文限制（当事人姓名/别名/机构简称） |
| `preserveValues` | `[]` | 白名单：命中规则的值也原样保留（标记放行误报） |
| `strictId18` | `true` | 身份证 18 位严格校验：仅校验位合法的号码脱敏；关闭后日期段合理或带「身份证号」上下文的号码也脱敏 |
| `restoreInbound` | `true` | 入站还原：云端返回的占位符在本地还原为原值（响应显示、工具执行），下次出站重新脱敏 |
| `nonTextPolicy` | `strip` | 非文本内容策略：`strip`=移除后放行、`block`=拒绝请求、`allow`=原样透传 |
| `longTokens` | `true` | 长 hex/base64 串脱敏 |
| `redactToolMeta` | `true` | 工具描述/参数 schema 脱敏（关闭可避免影响模型对工具用途的理解） |
| `redactPaths` | `false` | 绝对路径脱敏（开启会破坏文件工具的路径回传） |
| `persistMapping` | `true` | 同一会话内跨请求保持同一值映射同一占位符；关闭则每请求重新编号 |
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
- **展示层还原**：浏览器通过 `sessionController.page/follow` 读取会话；插件包装这两个方法，在返回浏览器前按会话映射把占位符还原为原值——界面显示原文，落盘日志仍是占位符（`restoreInbound: false` 时关闭）。
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
- **身份证严格校验**：默认仅校验位合法的 18 位号码被脱敏；校验位错误的号码会被放行（避免误伤订单号），若来源数据可能被抄错/OCR 错位，可关闭 `strictId18`。
- **文件名与路径默认保留**（`redactPaths: false`），开启后文件类工具链会断裂。
- **日志中模型回复为真值**：方案取舍下 assistant 消息（模型回显的姓名/公司等）与工具调用参数在日志中为真值；如需日志完全无明文，需关闭入站还原或使用更严格的落盘方案。
- **`nonTextPolicy: block` 时用户消息会被整体拒绝**：图片/文件块在 `agent/pre-step` 即触发步骤拒绝（`reject`），不写入日志也不上云。
- **内存映射**：占位符映射仅存于内存，进程重启后会话内映射即失效；单类别超过 2000 个不同值后最旧映射被逐出（编号不复用），被逐出的旧占位符不再还原；云端侧不可逆，无法还原。

## 测试与 CI

```sh
node test/self-test.js        # 14 项功能回归（端到端拦截 + 中文实体）
node test/reliability-test.js # 129 项可靠性（边界/幂等/防误伤/校验/配置/姓名边界/图片策略/严格模式/入站还原/类别策略/性能/编号单调/交叉规则/日志遮罩/展示层还原/词表白名单/delta重组/兼容矩阵/settings惰性注册/词表热更新）
node test/accuracy-test.js    # 11 项准确性（法律文档矩阵/凭据/PII校验/边界/配置/幂等/性能）
node test/fuzz-test.js        # 300 例随机文本 × 2 断言（不崩 + 幂等，共 600 断言）
```

CI（GitHub Actions，Node 18/20/22）在每次 push / PR 时自动运行全部测试（`node:test` 结构化报告）。

## 脱敏对照工具

本地检查一份文本在脱敏前后的样子（不会发送任何数据）：

```sh
npm run mask:preview -- 案情.txt            # 默认档：隐私实体脱敏，金额/日期/案号保留
npm run mask:preview -- 案情.txt --redactFacts   # 全面档：姓名/公司/机关也脱敏
```

输出三份：原文 / 脱敏后（发往云端的样子）/ 还原后（模型产出经本地还原的样子），以及占位符统计。

## 贡献

- 发现漏检/误伤或功能建议：提交 [Issue](https://github.com/JunyuZhan/dsh-privmask/issues)
- 改进规则或修复 bug：提交 [PR](https://github.com/JunyuZhan/dsh-privmask/pulls)
- 提交前请确保三套测试全部通过

## 发布

```sh
npm login
npm publish
```

`prepublishOnly` 会先运行全部测试，通过才允许发布。版本变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT © 2026 JunyuZhan。详见 [LICENSE](LICENSE)。
