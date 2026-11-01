# 兼容性与升级

## 已实测核对的宿主版本

按 `npm run dsh:compat` 核对过的 `@deepseek-ai/dsh` 版本：

- 0.1.0-rc.6 / 0.1.1-rc.2（旧官方线）
- 0.1.5-rc.2 / 0.1.5-rc.3、0.1.6-alpha.2、0.1.7-rc.2
- 0.2.1-rc.5（当前 latest/next）与 0.2.2-alpha.2（alpha）

核心出站脱敏、落盘遮罩、设置开关在各线上均可用。

> run_code 子派发日志遮罩仅在宿主提供 `tools/ptc-dispatch-log`（dsh ≥ 0.1.2）时自动启用——
> 0.2.2-alpha.2 起该水瀑随 PTC 执行器搬到 `@deepseek-ai/dsh-tool-executor-ptc`，水瀑名与签名不变
> （插件按事件名软注册，照常生效）；旧官方版无此事件属宿主能力差异。
> 客户端模块依赖里 `@deepseek-ai/dsh-client-runtime` 自 0.1.2 起已不存在（后继为
> `@deepseek-ai/dsh-client-modules`），该条目在新版按未知依赖跳过，卡片仍正常加载。

## 设置 API 有三代形态，插件全部软探测

`settingsScope`（0.1.2–0.1.5）与 `remote.settings`（0.1.7+ 又改回来）在客户端二选一；
宿主侧 `settings.register`（旧）与 `settings.configure`（0.1.7 的 SettingsForms）二选一。
两代都没有时卡片仍注册，只在卡片内提示改用配置文件模式。客户端模块级 `inject` 因此只剩
`slots` / `locale` 两个各宿主都有的服务——硬依赖某个设置服务会让卡片整块停在 PENDING
（issue #2 的教训，0.1.7 差点再犯一次）。

## 0.1.7 的 `volatile` 字段是活引用

0.1.7 只把标了 `.volatile()` 的字段放进设置表单，而且把它们传成 `{ get(), [write] }` 盒子
（不是普通值）。插件按能力派生 volatile 标记（老 schemastery 没有该方法），校验前解盒、
并在每个钩子入口探测一次变更——用户在卡片上改开关**无需重启进程**即可生效。已在 dsh 0.1.7-rc.2
真机验证读写与落盘。

核对方式是 `npm run dsh:compat`：按版本下载缝所在包到本机 `.dsh-versions/`（已 gitignore，
只留存不提交），逐个断言缝仍存在并打印「版本 × 缝」矩阵，必需缝缺失即退出码 1；
同一份缓存也可直接解两个版本做 diff。

## 0.1.5 / 0.1.6 / 0.2.x 复核结论

- **0.1.5-rc.2 / 0.1.6-alpha.2**：`llm/stream`、`prepareCall`、`resolveModelInfo`、`agent/pre-step`、
  `tools/post-execute`、`tools/ptc-dispatch-log`、`settings.register`、`attachments.readImage`、
  `x-deepseek-harness-session-id` 全部仍在且签名兼容；`GenerateOptions` 全 12 个字段
  （含 `reasoningEffort` / `temperature` / `maxTokens` / `stop` / `purpose`，0.1.1 起即存在）
  被脱敏管线原样保留，其中 `stop` 内的敏感值与消息共用同一占位符（模型只见占位符，
  停止串必须同步改写才匹配得上），回归见可靠性测试 AF1-AF5。
- **0.2.1-rc.5 / 0.2.2-alpha.2（0.2.48）**：押注的缝全部仍在，设置 API 沿用 0.1.7 的
  `SettingsForms` + volatile 活引用形态，**插件无需改代码**；客户端侧仍是 `remote.settings`
  （`settingsScope` 已随 0.1.5 线退场），`sessionController` 的可见性判定与降级声明不变。
  唯一结构变化是 `tools/ptc-dispatch-log` 在 0.2.2-alpha.2 随 PTC 执行器搬到新包
  `@deepseek-ai/dsh-tool-executor-ptc`（水瀑名与签名不变），自检脚本已按「两种归属任一命中」处理。
  另外 0.2.2 删除了 `dsh-tools.mode`，PTC 由挂载 `dsh-tool-executor-ptc` 决定；旧 profile 写死
  `mode: ptc` 的配置需改挂载方式，否则 `run_code` 不存在、PTC 缝静默不触发。

详细证据与逐缝矩阵见 [docs/dev/dsh-research.md](dev/dsh-research.md)（开发记录，非用户文档）。

## 软探测与自动降级

- 插件对 dsh 内部能力采用**软探测/自动降级**：不存在的宿主事件（如旧版没有
  `tools/ptc-dispatch-log`）不注册不报错；设置、展示层等服务不可见时退化为配置文件模式。
- manifest 依赖行只保留各版本模块表都存在的公共模块，并有自动化回归防止误加回版本专属依赖；
  `dsh.client.inject` 里已不存在的条目由 `npm run dsh:compat` 显式列出（宿主按未知条目跳过）。

## dsh 升级建议

升级宿主前先跑 `npm run dsh:compat <新版本>` 看缝是否还齐，再跑仓库测试（`npm test`）；
若 dsh 客户端模块表/事件名发生变化，优先检查卡片是否正常出现、控制台是否有
`展示层还原未安装` 类告警，再按告警决定是否等新版本插件。

## 上游监控

`.github/workflows/watch-upstream.yml` 每天 09:00（北京时间）跑一次 `--upstream --check`——
上游出现未核对版本、或关键宿主缝/设置 API 消失时，CI 报红并自动开（或追加评论到）一条 issue。
已核对的版本清单维护在 `tools/dsh-compat-check.mjs` 的 `VERIFIED_VERSIONS` 里。

## 跨平台支持

核心链路（出站脱敏、入站还原、落盘遮罩、词表/开关、文本与 docx CLI、`npm run dsh:compat`）
是纯 Node 实现，macOS / Linux / Windows 无差异，只依赖 Node ≥18。

只有「本地 PDF / OCR」这类必须借外部程序的工具存在平台差异，0.2.44 起已按平台自动适配
（依赖与安装指引见[命令行工具](tools.md)）：

| 能力 | 依赖 | 平台差异与处理 |
|---|---|---|
| `tools/pdf-preflight.mjs`、`tools/redact-pdf.mjs` | poppler（`pdftotext`/`pdfinfo`）+ ghostscript | POSIX 下 ghostscript 叫 `gs`，Windows 下是 `gswin64c` / `gswin32c`；0.2.44 起按平台自动探测并在缺失时给出对应安装指引（`choco` / `scoop` / `brew` / `apt`） |
| `localOcr`（默认关） | `~/.ocr-tool` 本地视觉服务 | Python venv 布局不同：Windows 是 `venv\Scripts\python.exe`，POSIX 是 `venv/bin/python`；0.2.44 起自动选择（也可用 `localOcrCommand` 完全接管） |
| docx / 纯文本 / 审计摘要 / 对照工具 | 无外部依赖 | 纯 JS，跨平台一致 |

文本保真方面，Windows 的 CRLF 换行在脱敏后原样保留（0.2.43 及以前，地址规则会把行尾的 `\r`
一起吞掉，导致整行从 `\r\n` 变成 `\n`；0.2.44 修正，回归见 reliability AG1/AG1b）。

宿主侧：`web` profile 与 DSH Desktop（`desktop` profile）都可用。Desktop 的客户端运行时没有
`remote.pluginInventory`，卡片会改用 `settingsScope` 命名空间的可用性推断状态（就绪 = 插件已启用），
因此状态行同样有值，不再显示「未知」；其余开关照常
（见 [issue #2](https://github.com/JunyuZhan/dsh-privmask/issues/2)）。

诚实声明：Windows 上的行为由代码审查 + 跨平台回归（AG1–AG4）保证，**尚未在 Windows 真机跑过**；
遇到问题请附平台与复现步骤提 issue。
