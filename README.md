# dsh-privmask

[![npm version](https://img.shields.io/npm/v/dsh-privmask)](https://www.npmjs.com/package/dsh-privmask)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/JunyuZhan/dsh-privmask/actions/workflows/test.yml/badge.svg)](https://github.com/JunyuZhan/dsh-privmask/actions/workflows/test.yml)

DeepSeek Harness 本地脱敏插件：在请求发往云端大模型之前，将密钥、个人身份信息与中文实体替换为 `[REDACTED_类别_N]` 占位符；云端只看到脱敏内容，本地会话日志与工具执行保留原文。支持入站还原，模型返回的占位符在本地还原为原值，保证工具链与文档起草的精度。

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

- **出站脱敏**：PEM/JWT/API Key、Bearer/Authorization、邮箱、电话、IPv4/IPv6、身份证（18/15 位）、统一社会信用代码、手机/座机、银行卡（Luhn 校验）、案号、车牌、护照/证件、出生日期、地址、公司名、司法机关
- **入站还原**：模型输出文本与工具调用参数中的占位符在本地还原为原值；还原值再次出站时重新脱敏，云端始终只看到占位符
- **严格模式**：脱敏异常（failClosed）、未检查字段（strictUnknown）默认拒绝请求；非文本内容默认剥离（nonTextPolicy=strip），图片字节不出本地
- **律师模式（默认）**：凭据与地址脱敏，案件事实（姓名/案号/出生日期/公司/机关）默认保留，保证模型可做金额核算、管辖判断等精确工作；涉案金额不脱敏
- **会话一致性**：同一会话内同一值跨请求映射到同一占位符，模型可跨轮关联实体；不同会话相互隔离
- **类别化配置**：凭据 / 地址 / 事实类 分别开关，按场景组合

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

默认配置即「律师模式」：密钥凭据与地址脱敏，案件事实保留。

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml 中按 id 覆盖
- id: privmask
  config:
    enabled: true
    redactCredentials: true
    redactAddress: true
    redactFacts: false
    nonTextPolicy: strip
    failClosed: true
```

需要全面脱敏时，将 `redactFacts: true`；需要严格身份证校验时保持 `strictId18: true`（默认）。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `cnEntities` | `true` | 中文实体识别总开关 |
| `redactCredentials` | `true` | 凭据类脱敏：PEM、JWT、API Key、Bearer/Authorization、密码等 |
| `redactAddress` | `true` | 地址类脱敏：省市区乡、住址、户籍地、送达地址等 |
| `redactFacts` | `false` | 事实类脱敏：姓名、案号、出生日期、公司、司法机关（律师模式默认保留） |
| `strictId18` | `true` | 身份证 18 位严格校验：仅校验位合法的号码脱敏；关闭后日期段合理或带「身份证号」上下文的号码也脱敏 |
| `restoreInbound` | `true` | 入站还原：云端返回的占位符在本地还原为原值（响应显示、工具执行），下次出站重新脱敏 |
| `nonTextPolicy` | `strip` | 非文本内容策略：`strip`=移除后放行、`block`=拒绝请求、`allow`=原样透传 |
| `longTokens` | `true` | 长 hex/base64 串脱敏 |
| `redactToolMeta` | `true` | 工具描述/参数 schema 脱敏（关闭可避免影响模型对工具用途的理解） |
| `redactPaths` | `false` | 绝对路径脱敏（开启会破坏文件工具的路径回传） |
| `persistMapping` | `true` | 同一会话内跨请求保持同一值映射同一占位符；关闭则每请求重新编号 |
| `dropSessionId` | `true` | 移除 `x-deepseek-harness-session-id` 请求头 |
| `failClosed` | `true` | 严格模式：脱敏异常时拒绝请求，绝不把未脱敏数据发往云端 |
| `strictUnknown` | `true` | 严格模式：发现未检查的未知字段（非普通对象/函数等）时拒绝请求 |
| `logRedactions` | `true` | 每次脱敏打印一行统计日志 |

## 脱敏机制

插件挂载在 `llm/stream` 水瀑（dsh 唯一的请求边界），拦截发生在请求到达 adapter（云端边界）之前。机制要点：

- **只处理会真正上云的内容**：adapter 序列化时只发送 `message.content` 内容块；消息的 `source` 元数据（notice 摘要、snapshot 片段、replayState）不会上云，因此不在此列。
- **reasoning 内容会上云**：adapter 将 `reasoning` 块序列化为 `reasoning_content` 发送，本插件同样脱敏。
- **辅助调用同样脱敏**：`purpose: compaction / session-title` 的请求同样经过 `llm/stream`。
- **原请求保持不变**：agent-loop 构建的请求被深冻结并用 WeakSet 标记；本插件生成脱敏副本重入水瀑，原请求对象不修改，本地会话日志保留原文。
- **入站还原**：模型返回流中的占位符按会话映射在本地还原为原值；还原内容再次出站时重新脱敏。
- **会话头**：adapter 会发送 `x-deepseek-harness-session-id` 请求头，`dropSessionId` 默认移除。

## 安全模型

本插件以「敏感数据不出本地」为目标，按数据类别区分策略：

| 类别 | 默认 | 理由 |
|---|---|---|
| 密钥凭据 | 脱敏 | 模型永远不需要，脱敏零损失 |
| 地址（省市区乡/住址） | 脱敏 | 当事人隐私核心；起草文书时由入站还原写回真值 |
| 案件事实（姓名/案号/日期/公司） | 保留 | 模型需基于真值做金额核算、管辖判断等精确工作 |
| 涉案金额 | 保留 | 诉讼费、违约金、利息计算依赖金额 |
| 邮箱/电话/身份证等 PII | 脱敏 | 高敏感身份信息 |

出站边界：云端不可逆地只能看到占位符。入站还原仅发生在本地内存与会话日志，还原值一旦再次出站即被重新脱敏。

## 已知限制

- **仅文本脱敏**：图片/文件等非文本内容默认剥离（不发送），不进行 OCR 或像素级处理；若启用 DeepSeek 多模态直发图片，需显式设置 `nonTextPolicy: allow` 并自行评估风险。
- **启发式识别**：姓名/公司/地址等基于角色上下文、姓氏库与正则规则，复杂句式下可能漏检或误伤。
- **身份证严格校验**：默认仅校验位合法的 18 位号码被脱敏；校验位错误的号码会被放行（避免误伤订单号），若来源数据可能被抄错/OCR 错位，可关闭 `strictId18`。
- **文件名与路径默认保留**（`redactPaths: false`），开启后文件类工具链会断裂。
- **内存映射**：占位符映射仅存于内存，进程重启后会话内映射即失效；云端侧不可逆，无法还原。

## 测试与 CI

```sh
node test/self-test.js        # 14 项功能回归（端到端拦截 + 中文实体）
node test/reliability-test.js # 69 项可靠性（边界/幂等/防误伤/校验/配置/姓名边界/图片策略/严格模式/入站还原/类别策略/性能）
node test/fuzz-test.js        # 600 例随机文本（不崩 + 幂等）
```

CI（GitHub Actions，Node 18/20/22）在每次 push / PR 时自动运行全部测试。

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
