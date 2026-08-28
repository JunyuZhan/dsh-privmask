# dsh-privmask

[![npm version](https://img.shields.io/npm/v/dsh-privmask)](https://www.npmjs.com/package/dsh-privmask)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/JunyuZhan/dsh-privmask/actions/workflows/test.yml/badge.svg)](https://github.com/JunyuZhan/dsh-privmask/actions/workflows/test.yml)

DeepSeek Harness **本地脱敏插件**（Host-only 静态版）：在 `llm/stream` 出口拦截每一次发往云端大模型的请求，把密钥、PII、中文实体替换为 `[REDACTED_类别_N]` 占位符后再放行。**本地会话日志与工具执行不受影响**——云端只看到脱敏内容。

## 功能

| 类别 | 说明 |
|---|---|
| 密钥/Token | PEM 私钥、JWT、`sk-`/`ghp_`/`AKIA`/`xox`、`Bearer`/`Basic`、`API_KEY=xxx` 等 |
| PII | 邮箱、电话（含 `+86` 国际格式）、IPv4、IPv6、长 hex/base64 串 |
| 中文实体 | 姓名（角色上下文+姓氏库）、身份证 18/15 位、统一社会信用代码、手机/座机、银行卡（Luhn）、案号、车牌、护照/证件、出生日期、地址、公司名、司法机关 |
| 防误伤 | `认为/请求` 不当姓名、`该公司/企业` 泛称不脱敏、`向[司法机关_6]` 介词结构不误伤 |
| 会话关联 | 移除 `x-deepseek-harness-session-id` 请求头（可关） |
| 入站还原 | 云端返回的占位符在本地还原为原值（模型回复显示、工具执行参数），下次出站重新脱敏 |

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add dsh-privmask
```

包通过 `dsh.bundle` 声明自动挂载到 profile 层栈（无需手动编辑
`cordis.patch.yml`）；安装后重启 `dsh web` 生效。

已有旧版本需要升级激活 bundle 时：

```sh
dsh plugin --profile web update dsh-privmask
```

或作为依赖直接安装：

```sh
npm install dsh-privmask
```

### 从 GitHub 安装（备选）

```sh
dsh plugin --profile web add github:JunyuZhan/dsh-privmask
```

### 卸载

```sh
dsh plugin --profile web remove dsh-privmask
```

卸载后重启 Web 服务生效；若你曾在 `cordis.patch.yml` 中手动挂载过本插件，请同时删除对应行。

如需调整配置，在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中按 `id: privmask`
覆盖对应行（整行 config 替换）。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `cnEntities` | `true` | 中文实体识别 |
| `redactPaths` | `false` | 绝对路径脱敏（会破坏文件工具的路径回传） |
| `redactToolMeta` | `true` | 工具描述/参数 schema 脱敏（关闭可避免工具描述被占位符替换，利于模型理解工具用途） |
| `persistMapping` | `true` | 同一会话内跨请求保持同一值映射同一占位符（利于模型跨轮关联实体；关闭则每请求重新编号） |
| `nonTextPolicy` | `strip` | 非文本内容（图片/文件块）策略：`strip`=移除后放行（默认，图片字节不出本地）、`block`=拒绝请求、`allow`=原样透传（仅本地 OCR 转文字的场景可考虑） |
| `longTokens` | `true` | 长 hex/base64 串脱敏 |
| `dropSessionId` | `true` | 移除会话关联头 |
| `failClosed` | `true` | 严格模式：脱敏异常时拒绝请求，绝不把未脱敏数据发往云端 |
| `strictId18` | `true` | 身份证 18 位严格校验：仅校验位合法的号码脱敏（避免误伤订单号）；关闭后日期段合理或带「身份证号」上下文的号码也脱敏 |
| `restoreInbound` | `true` | 入站还原：云端返回的占位符在本地还原为原值（响应显示/工具执行用）；下次出站会重新脱敏，云端始终看不到原值 |
| `redactCredentials` | `true` | 凭据类脱敏（PEM/JWT/API Key/密码等）：模型永远不需要，脱敏零损失 |
| `redactAddress` | `true` | 地址类脱敏（省市区乡/住址[地址_24]默认开）：当事人隐私核心，起草文书靠入站还原写回真值 |
| `redactFacts` | `false` | 事实类脱敏（姓名/案号/出生日期/公司/机关，默认关）：律师工作需真值保证精度；需要时可开启 |
| `strictUnknown` | `true` | 严格模式：发现未检查的未知字段时拒绝请求（确认字段无敏感数据可关） |
| `logRedactions` | `true` | 每次脱敏打印一行统计日志 |

## 脱敏后的语义可用性（已用真实模型验证）

把本插件实际输出的占位符文本交给大模型处理，验证结论：

- **结构级理解可用**：类别令牌（NAME/ID18/CASE…）+ 保留的角色词/上下文词（原告、身份证号、案号），模型能准确推断每类占位符的信息类型；
- **同值关联可用**：同一会话内同类值映射同一占位符（跨请求也保持），模型能据此建立跨句、跨轮实体关联（如两处 EMAIL_1 指向同一邮箱）；
- **精确值任务降级**：姓名、金额、案号等具体数值被脱敏后，任务从"精确执行"降级为"结构复述"，涉及身份核验、管辖判断的任务需人工补值；
- **工具链可用（入站还原）**：模型拿到的敏感值虽是占位符，但返回流会在**本地**还原——工具调用参数、模型回复中的占位符都还原为原值，写文件、查库等本地操作正常执行；还原后的值再次出站时重新脱敏，云端始终只见占位符。路径脱敏仍默认关闭（redactPaths: false）。
- **已实测验证**：在真实 dsh web 中发送手机号 → 云端模型只收到占位符；模型调用写文件工具时参数在本地还原为真值，文件写入真实号码。注意：模型可能「自称收到/写入了占位符」，属推测性表述，以会话日志与工具调用参数为准。

## 测试

```sh
node test/self-test.js        # 14 项功能回归（端到端拦截 + 中文实体）
node test/reliability-test.js # 69 项可靠性（边界/幂等/防误伤/校验/配置/姓名边界/图片策略/严格模式/入站还原/类别策略/性能）
node test/fuzz-test.js        # 600 例随机文本（不崩 + 幂等）
```

CI（GitHub Actions，Node 18/20/22）会在每次 push / PR 时自动运行全部测试。

## 工作机制（源码依据）

基于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 源码核对：

- **拦截点**：`llm/stream` 水瀑是 dsh 唯一的请求边界（`packages/llm/llm/src/index.ts`），本插件挂在这里，脱敏发生在请求到达 adapter（云端边界）之前。
- **上云范围**：adapter 序列化时只发送 `message.content` 内容块；消息的 `source` 元数据（notice 摘要、snapshot 片段、replayState）不会上云。
- **reasoning 内容会上云**：adapter 把 `reasoning` 块序列化为 `reasoning_content` 发送，本插件同样脱敏。
- **辅助调用也脱敏**：`purpose: compaction / session-title` 的请求同样经过 `llm/stream`，摘要生成等辅助调用同样被脱敏。
- **会话头真实存在**：adapter 会发送 `x-deepseek-harness-session-id` 请求头（`packages/llm/llm-deepseek/src/adapter.ts`），`dropSessionId` 默认移除它。
- **原请求保持不变**：agent-loop 的请求被深冻结并用 WeakSet 标记，本插件生成脱敏副本重入水瀑；原请求对象不修改，本地会话日志（session.events）保留原文。
- **入站还原**：云端返回流中的占位符会按会话映射在**本地**还原为原值（模型回复显示、工具执行参数），还原后的内容再次出站时会被重新脱敏；云端不可逆地只能看到占位符。

## 注意事项

- 脱敏对当前进程内**所有会话**的模型请求生效（`llm/stream` 是全局事件）。
- 同一会话内（跨请求）同一值映射到同一占位符，模型能理解引用关系。
- 路径脱敏默认关闭：agent 需要真实路径才能操作本地文件，开启后工具链会断裂。
- 本地会话日志始终保留原文，云端不可逆地只能看到占位符。
- **严格模式（默认）**：脱敏异常（failClosed）与未检查字段（strictUnknown）会**拒绝请求**；非文本内容默认**剥离**（nonTextPolicy=strip，图片字节不出本地，请求照常处理）。放宽选项均需显式配置。
- **律师模式（默认）**：凭据（redactCredentials）与地址（redactAddress）默认脱敏；事实类——姓名/案号/出生日期/公司/机关（redactFacts）默认**保留**，保证云端大模型能基于真值做金额核算、管辖判断等精确工作；涉案金额本就不脱敏。若需全面脱敏，将 `redactFacts: true`。
- **脱敏边界（务必知晓）**：本插件只处理**文本**内容。常规路径下 dsh 通过本地 OCR 把图片转成文字再发送，文字会被脱敏；若启用 DeepSeek 多模态（如 deepseek-v4-flash-vision-exp）直发图片，图片块会按 `nonTextPolicy` 处理（默认剥离，设 `allow` 才会原样上传）。文件名与路径默认保留（`redactPaths: false`）。
- 中文姓名/公司识别基于启发式规则，复杂句式下仍可能漏检或误伤，欢迎反馈用例。

## 开源协作

MIT 协议开源，代码仓库：[github.com/JunyuZhan/dsh-privmask](https://github.com/JunyuZhan/dsh-privmask)

- 发现漏检/误伤或功能建议：提交 [Issue](https://github.com/JunyuZhan/dsh-privmask/issues)
- 改进规则或修复 bug：提交 [PR](https://github.com/JunyuZhan/dsh-privmask/pulls)
- 已发布到 [npm](https://www.npmjs.com/package/dsh-privmask)；发布新版本：`npm login && npm publish`（`prepublishOnly` 会先跑全部测试，通过才允许发布）

## License

MIT © 2026 JunyuZhan
