# dsh-privmask

[![npm version](https://img.shields.io/npm/v/dsh-privmask)](https://www.npmjs.com/package/dsh-privmask)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/JunyuZhan/dsh-privmask/actions/workflows/test.yml/badge.svg)](https://github.com/JunyuZhan/dsh-privmask/actions/workflows/test.yml)

DeepSeek Harness 本地脱敏插件：请求发往云端大模型之前，把密钥、PII 与中文实体替换为
`[REDACTED_类别_N]` 占位符；云端只看到脱敏内容，落盘日志同样遮罩，模型返回的占位符在本地还原。

> Local redaction for DeepSeek Harness — secrets, PII and Chinese entities are masked before
> requests leave your machine, and restored locally in model output.

## 特性

- **出站脱敏**：PEM/JWT/API Key、邮箱/电话、身份证、统一社会信用代码、银行卡、车牌、地址、
  公司名、机关名等；**法院/案号/出生日期/涉案金额默认保留**，办案判断需要真值。
- **入站还原**：模型输出与工具调用参数中的占位符在本地还原为原值，再次出站时重新脱敏；
  展示层在服务可见时把用户消息还原为原文显示。
- **落盘遮罩**：用户输入、工具结果、`run_code` 子派发在写入会话日志前替换为占位符。
- **流式与一致性**：占位符被切分到多个 delta 也能跨分片还原；同一会话内同值同号。
- **严格模式**：脱敏异常 / 未知字段默认拒绝请求，非文本内容默认剥离，绝不静默放行明文。
- **离境审计**：每笔发往云端的请求在本地记一行 JSONL，可用 `audit-summary` 汇总巡检。
- **本地文件工具**：docx / 纯文本脱敏、PDF 预检与覆写式脱敏、图片本地 OCR（默认关）。
- **多版本兼容**：对宿主事件/服务软探测、自动降级；0.1.1-rc.2 → 0.2.2-alpha.2 已逐缝核对。

## 安装

**DSH Desktop（推荐，绝大多数用户）**：打开侧栏「插件」→「添加插件」→ 输入 `dsh-privmask`
→「安装」→「立即启用」，然后按提示重启 DSH Desktop；「设置 → 插件」里会出现「隐私保护」页签。

**让 agent 帮你装**：把下面这句发给你的 agent（DSH 内置 agent，或任何能执行命令的编码 agent）：

> 帮我安装 DeepSeek Harness 脱敏插件 `dsh-privmask` 并验证：「设置 → 插件」出现「隐私保护」页签、
> 卡片显示版本号；按 https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/install.md#方式二让-agent-自行安装
> 的步骤做，装完告诉我版本和是否需要重启。

**命令行（web profile / 无界面部署）**：

```sh
dsh plugin --profile web add dsh-privmask
```

装完重启宿主生效；镜像源、pnpm 最小发布期、Desktop 自带 CLI、无界面 profile 的配置文件模式
等排查项见[安装与升级](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/install.md)。

## 快速开始

默认配置即「隐私优先」：凭据、地址、姓名、公司/单位名与 PII 脱敏，案号/出生日期/金额保留。
按需在 profile 的 `cordis.patch.yml` 里覆盖，或在客户端卡片上直接改（live 生效）：

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- id: privmask
  config:
    enabled: true
    redactNames: true
    redactCompanies: true
    redactOrgs: true
    customTerms: [张三, 某某公司]
```

完整配置键与默认值见[配置](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/configuration.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [安装与升级](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/install.md) | DSH Desktop 界面安装、让 agent 自行安装、CLI/配置文件模式、升级卸载、排查 |
| [配置](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/configuration.md) | 全部配置键与默认值、快速开始、自定义词表与白名单 |
| [脱敏机制](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/how-it-works.md) | 出站水瀑、落盘遮罩、入站还原、展示层还原、会话一致性 |
| [安全模型与边界](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/security-model.md) | 按类别的默认策略、出站/日志/展示边界、责任声明 |
| [兼容性与升级](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/compatibility.md) | 已核对宿主版本、设置 API 三代形态、跨平台差异、升级建议、上游监控 |
| [命令行工具](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/tools.md) | 脱敏对照、docx/纯文本、PDF 预检与覆写、审计摘要、工具依赖 |
| [诊断与统计](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/diagnostics.md) | 控制台日志、结构化事件、诊断文件、适配检查 |
| [已知限制](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/limitations.md) | 图片、启发式识别、内存映射、日志边界等 |
| [开发与发布](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/development.md) | 开发环境、五套测试、CI、宿主适配自检、发版流程 |
| [更新日志](https://github.com/JunyuZhan/dsh-privmask/blob/main/CHANGELOG.md) | 每个版本的变更、兼容性核对与修复记录 |

## 安全

目标是「云端与日志不见明文」，但脱敏基于启发式规则，**不保证零漏检、零误伤**；
高保证合规场景请自行抽样验证并保留可信原文副本。各类别默认策略与边界见
[安全模型与边界](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/security-model.md)，
覆盖不到的场景见[已知限制](https://github.com/JunyuZhan/dsh-privmask/blob/main/docs/limitations.md)。
发现隐私泄漏、绕过脱敏或安全缺陷，请按 [SECURITY.md](https://github.com/JunyuZhan/dsh-privmask/blob/main/SECURITY.md)
报告，不要在公开 Issue 里贴真实敏感数据。

## 贡献

- 开发/提交流程与编码约定见 [CONTRIBUTING.md](https://github.com/JunyuZhan/dsh-privmask/blob/main/CONTRIBUTING.md)
- 提交前跑 `npm test`；改了 `client-src/` 再跑 `npm run build:check`
- 机制研究与上游版本适配的复核记录在 [docs/dev/](https://github.com/JunyuZhan/dsh-privmask/tree/main/docs/dev)（开发记录，非用户文档）
- 参与本项目即表示同意 [CODE_OF_CONDUCT.md](https://github.com/JunyuZhan/dsh-privmask/blob/main/CODE_OF_CONDUCT.md)

## 许可证

MIT © 2026 JunyuZhan。详见 [LICENSE](LICENSE)。
