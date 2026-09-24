# dsh 机制研究与 privmask 插件接入分析

> 基于本地源码线（`dsh-main`，0.1.2-alpha.1）、官方 npm 包
> （`@deepseek-ai/dsh` 0.1.1-rc.2 / 0.1.0-rc.6）与真实运行日志归纳。
> 目的：明确 dsh 的加载、请求、展示与设置机制，指导 privmask 后续改进与 UX 决策。

## 1. 组合加载架构：为什么“插件看不到 session-controller”

### 机制
- `dsh web` 启动 profile 时，把若干“组合包”（bundle）按 `dsh.profile.bundles` 顺序
  应用 patch，patch 是 `cordis.yml` 风格的插件条目列表（见
  `apps/cli/src/plugin.ts`、`packages/bundle/*/cordis.patch.yml`、vendor
  `cordis-plugin-include`）。
- 每个 bundle 可以是一个 include 组（组内再挂一批插件条目）。web 功能大量插件
  （session-controller、settings-controller、ui-* 等）挂在 web-app include 组内层。
- Cordis loader 以 entry/fiber 为粒度启动插件；服务的可见性取决于插件所在 include
  组的上下文层级。**外层 profile 条目看不到内层 include 组里注册的服务**——
  除非 dsh 把该服务显式提升到共享层。
- 实测：privmask 在 profile 外层，loader 可枚举 137（官方 0.1.1）/147（本地 0.1.2）
  个条目，但两个环境里都没有 `session-controller` 条目；运行日志稳定输出
  `展示层还原未安装：sessionController 服务不可用`。

### 对插件的结论
- host 侧“包装 sessionController.page/follow/control 做展示还原”在当前两种宿主组合
  下**都不可达**，这不是探测代码写错，而是 include 可见性限制。
- 想在浏览器端还原用户消息，要么 dsh 官方开放会话读取/改写缝（把控制器提升到
  profile 可见层或提供事件改写缝），要么提供 host→browser 的占位符映射 RPC。
  在官方能力落地前，privmask 保持“日志与界面一致为占位符”并如实声明（README 已知限制）。

## 2. 请求管线与插件可挂接的缝

### 机制
- agent-loop 构造请求后冻结请求对象，并以内部标记（WeakSet）区分“agent-loop 原请求”，
  再走 `llm/stream` 水瀑。水瀑由一串 hook 组成，最内层是 adapter（真正发往云端）。
- adapter 序列化时只发送 `message.content` 块；`reasoning` 块作为
  `reasoning_content` 发送；辅助调用（compaction、session-title）也走同一水瀑。
- 会话头 `x-deepseek-harness-session-id` 由 adapter 按 `options.sessionId` 生成。

### 插件已验证/使用的缝
| 缝 | 作用 | privmask 用途 |
|---|---|---|
| `llm/stream` | 唯一请求边界 | 出站脱敏 + 入站还原；重入水瀑的副本以 SEEN 放行 |
| `agent/pre-step` | 用户消息落盘/入上下文前 | 落盘前遮罩用户消息 |
| `tools/post-execute` | 工具结果落盘/回填前 | 工具结果遮罩 |
| `tools/ptc-dispatch-log` | run_code 子派发日志（≥0.1.2） | 子派发日志遮罩 |
| `session/event` 等 | 只读观察 | 不用于改写（inbox/spliced 原文副本无法遮罩，已列为已知限制） |

### 版本差异
- 官方 npm 0.1.1-rc.2（npx 实际安装版本）没有 `tools/ptc-dispatch-log` 事件，
  该功能按宿主能力自动缺省；官方 0.1.0-rc.6 的客户端模块表同样缺少部分 0.1.2 模块。
- 出站脱敏主链路（llm/stream）在两代宿主均可用（官方临时环境实测日志命中
  key/email/id18/mobile/addr/company）。

## 3. 浏览器端数据流与展示层

### 机制
- 浏览器端模块表：每个带 `dsh.client.platform: 'web'` 的包是模块表一行，`inject`
  字段声明模块级依赖边（包行 id 列表），模块系统按边保证加载顺序并组合
  `window.__DSH_BOOT__`。
- 聊天 UI（ui-chat）通过 `uiConversation.binding(binding).target('chat')` 订阅会话快照，
  依赖服务含 `remote.session`；设置插件页由 `slots` 服务注册标签页（in-box 卡片同样走
  `settings.plugins.tab` slot）。
- 设置系统：host 侧 `dsh-settings` 提供命名空间 register/watch（live 生效）；
  浏览器侧 `dsh-client-ui-settings` 提供 `settingsScope` 作用域
  （`bind({namespace})`，`set/unset` 带 expectedRevision 并发控制）。

### 对插件的结论
- privmask 浏览器卡片用 `settingsScope` 读写是官方推荐的扩展路径，两代宿主通用；
  卡片开关写入已真机验证（live 生效日志）。
- “用户自己消息显示占位符”的根因在展示层读取链路上，浏览器卡片本身可正常工作。

## 4. 设置与会话一致性

- privmask host 在 settings 命名空间 `privmask` 注册 Config，watch 到变更即重建引擎，
  实现开关 live 生效；浏览器卡片与 host 共用该命名空间，读、写、版本冲突处理闭环。
- 占位符映射按会话保存在 host 内存；同一会话跨请求保持映射，供入站还原与展示还原。
  浏览器拿不到该映射，是展示还原方案绕不开的缺口（见 §1）。

## 5. dsh 升级应对

- privmask 不写死 dsh 内部实现名：模块 manifest 只声明各版本都有的公共行，
  并有 accuracy 回归防止误加版本专属依赖；host 缝全部软探测/降级。
- 升级宿主后建议按序检查：四套测试 → 卡片是否出现 → 控制台是否有展示层告警 →
  实际发一条敏感消息核对出站遮罩与入站还原。
- 若 dsh 新版本改了 `llm/stream` 载荷形状，privmask 的 fail-closed 守卫会先给出明确
  错误而不是静默透传（已覆盖 messages 非数组、非文本策略、超长 ASCII 等）。

## 5.1 0.1.5-rc.2 复核（2026-09-22）

上游在 0.1.2-alpha.1 之后连发 0.1.2-rc.1 / 0.1.3-alpha.2 / 0.1.5-rc.2（当前 latest）
与 0.1.6-alpha.2（alpha）。用 `npm run dsh:compat 0.1.5-rc.2 0.1.6-alpha.2` 拉下缝所在包
逐条核对，两条线结论一致：**插件依赖的接口没有断**，逐项证据：

| 缝 | 0.1.5-rc.2 证据 |
|---|---|
| `llm/stream` 水瀑 | `dsh-llm/lib/index.js`：`waterfall(this, "llm/stream", options, () => this.adapterStream(...))` |
| 脱敏副本重入水瀑的前提 | `dsh-llm/lib/index.js`：`AGENT_LOOP_REQUESTS` WeakSet + `markAgentLoopRequest`；副本未标记，按对象身份判定，行为不变 |
| 载荷投影时机 | `file`/`image` 投影成文本在 `adapterStream` 内（水瀑**之后**），因此 `nonTextPolicy` 仍决定媒体块处置——文件字节不会绕道明文上云 |
| `llm.prepareCall` / `resolveModelInfo` | `dsh-llm/lib/index.js`（localOcr 的图片模态改写仍然有效） |
| `agent/pre-step` | `dsh-agent/lib/types/runtime-types.d.ts`：`{ agent, messages, turn, step }` → `PreStepDecision{kind:'enter'|'reject'}` |
| `tools/post-execute` | `dsh-tools/lib/index.js`：waterfall，`PostToolDecision{kind:'accept'|'block'}` |
| `tools/ptc-dispatch-log` | `dsh-tools/lib/index.js`：`(dispatch, next) => ContentBlock[]` |
| `settings.register` + `watch` | `dsh-settings/lib/index.js:281`、`types/index.d.ts:96` |
| `attachments.readImage` | `dsh-attachment-local`：`readImage(ref, signal) => { ref, data: Uint8Array }` |
| `x-deepseek-harness-session-id` | `dsh-llm-deepseek/lib/index.js:1666` |
| 客户端 `settingsScope` / `pluginInventory` | `dsh-client-ui-settings/lib/client.js`、`dsh-api-remotes/lib/client.js`（namespace `pluginInventory`） |
| 内容块词表 | `text/reasoning/image/file/tool-call/tool-result` 未变（`dsh-llm/lib/types/types.d.ts`） |
| 展示层还原 | `session-controller` 仍排在 web-app bundle 的嵌套 include 里 → 对 profile 层插件仍不可达，降级声明继续成立 |

宿主事件面（按各包 `lib/types/**/*.d.ts` 的 `interface Events` 声明口径）实测：
0.1.1 有 25 个事件、0.1.5 与 0.1.6-alpha.2 各 26 个，三线共有 20 个；
privmask 依赖的 `llm/stream`、`agent/pre-step`、`tools/post-execute` 三线都在，
`tools/ptc-dispatch-log` 是 0.1.1 的 `tools/code-dispatch-log` 改名而来（旧线自动降级）。
也就是说：**上游每 1-2 天发一版，但被我们押注的那几个缝一直没动**——
紧跟版本号没有收益，定期跑一次核对就够。

两个变化点值得记住：

1. **`GenerateOptions` 的字段口径**：全 12 个字段（`reasoningEffort` / `temperature` / `maxTokens` /
   `stop` / `purpose` 等）在 0.1.1 / 0.1.5 / 0.1.6-alpha.2 三线上**完全一致**。
   privmask 的白名单外严格检查对它们走「原样保留基础类型、字符串/数组走脱敏」的兜底，
   因此既不会触发 failClosed 也不会被吞掉；`stop` 里的敏感值与消息共用同一占位符
   （模型只见占位符，停止串必须同步改写才匹配得上），回归见可靠性测试 AF1-AF5。
2. **`@deepseek-ai/dsh-client-runtime` 消失了**（版本止于 0.1.1-rc.2），0.1.2 起由新增的
   `@deepseek-ai/dsh-client-modules` 承担模块表职责。新模块表对**未知 inject 条目直接跳过**
   （`dsh-client-modules/lib/client.js` 的 `arriveGraphRow`：`if (dependency !== void 0)`），
   所以 privmask manifest 里保留旧条目不会让卡片停在 PENDING；`npm run dsh:compat` 会把
   这类「声明了但该版本没有」的条目打印出来，避免声明悄悄腐烂。

`agent/inbox/spliced` 落盘原文副本的已知限制在 0.1.5 依旧存在：该事件在
`dsh-agent-loop` 内由 `session.append("agent/inbox/spliced", splice)` 写入，
没有可改写的水瀑缝，privmask 仍无法遮罩这一份日志副本。

### 5.2 浏览器端「可选依赖」怎么写（2026-09-22 真机实测）

DSH Desktop（`desktop` profile）的客户端运行时没有 `remote.pluginInventory`，
把它写进模块级 `inject` 会让整个客户端模块停在 PENDING——卡片永不注册
（GitHub issue #2）。要按能力取用这种宿主专属服务，实测结论：

1. 模块级 `inject` 只留**各宿主都提供**的服务（本插件：`slots` / `locale` / `settingsScope`）；
2. 可选服务用 `ctx.inject([...], cb)` 软注入 —— **客户端 ctx 上确实有这个方法**；
3. 嵌套服务要把父命名空间一起写：`ctx.inject(['remote','remote.pluginInventory'], cb)`。
   只写 `'remote.pluginInventory'` 时回调仍会触发，但回调里 `sctx.remote` 会被 cordis
   以 `cannot get property "remote" without inject` 拦下（真机探针验证）；
4. 软注入回调是**异步**落地的，而卡片挂载即读服务，所以要 await 一个带超时的
   ready promise（本插件 2 秒），否则会在 web 上误报「插件状态未知」；
5. 宿主一直没有该服务时（desktop），回调不触发 → 超时后按降级路径显示「状态未知」，
   卡片其余能力不受影响。

## 5.3 设置 API 的三代形态与我们的适配（2026-09-24）

上游在 09-22～09-24 连发 5 个版本（0.1.5-rc.3、0.1.7-alpha.1/2、0.1.7-rc.1/2），
其中 0.1.7 线**把设置 API 换掉了**——这是插件最容易被打断的一条链路，因为它决定
「卡片能不能注册」和「开关能不能 live 生效」两件事。

| 代次 | 宿主侧 | 客户端侧 |
|---|---|---|
| 0.1.0–0.1.1（旧官方线） | `ctx.settings.register(ns, schema, opts)` + `scope.watch` | `remote.settings`（当时未采用） |
| 0.1.2–0.1.5 | 同上 | `settingsScope.bind({namespace})` → getSnapshot/subscribe/set |
| 0.1.7+ | `ctx.settings.configure({auto})`（`SettingsForms`：describe/update/mutate/replace） | `remote.settings.describe()/update(ns, patch, revision)` |

适配策略（0.2.47 起）：

1. **客户端模块级 `inject` 只保留 `slots` + `locale`**——硬依赖设置服务的代价是整块 PENDING、
   卡片直接消失（issue #2 的失败模式）。`settingsScope` 与 `remote.settings` 都改为 `ctx.inject`
   软探测，先到先用；两代都没有时卡片仍注册，`describe()` 抛「请改用配置文件模式」的可操作错误。
2. **两代客户端 API 适配成同一个最小接口**（getSnapshot/subscribe/set）：旧形态直接包
   `settingsScope`；新形态用 `remote.settings.describe()`（返回 `{writable, namespaces[]}`，
   与旧快照结构天然兼容）读、`update(ns, patch, revision)` 写，写完刷新快照。
   卡片组件代码因此一行未改。
3. **宿主侧双栈**：`settings.register` 在就调用（旧线，带 `watch` 做 live 重建引擎）；
   否则若 `settings.configure` 在，就 `configure({ auto: true })` 声明自动页——新形态下
   配置写回 profile 后由 loader 重新 apply 插件，等价于 live 生效。
4. **监控**：`tools/dsh-compat-check.mjs` 把设置 API 标为 `critical`（用 `any` 表达
   「任一形态命中即通过」），并新增 `--upstream` 漂移检查；`.github/workflows/watch-upstream.yml`
   每天跑一次，发现未核对版本或关键 API 消失就开 issue。

这条链路的教训值得记住：**上游不保证服务名稳定**（`settingsScope` 活了三个小版本就没了），
所以插件对宿主服务一律「软探测 + 可降级」，只有真的两个宿主都提供的服务才进模块级 `inject`。

## 6. 后续改进方向（按优先级）

1. **展示还原**：推动 dsh 官方提供外层可见的会话读取/改写缝或映射 RPC；
   在此之前保持界面占位符并如实声明，避免“看似还原实则不还原”。
2. **推理友好**：保持默认“保留案号/日期/金额/路径”，工具 schema 遮罩提供开关；
   避免把长 hex/SHA、内网 IP 等对编码任务有语义的内容默认吞掉造成推理降级
   （现有 `longTokens`/`redactPaths` 开关可调，README 已给取舍说明）。
3. **文件脱敏**：docx 本地脱敏 MVP 已落地（见 README）；
   PDF 与图片 OCR 作为独立里程碑，继续前先明确“抽取→遮罩→回写/生成副本”的
   保真与不可逆边界。
4. **UX**：卡片已标注适配版本与简版责任声明；按钮真实可用性由数据层单测、
   首帧渲染断言与真机 live 日志三重覆盖。

## 7. 关键源码参考

- 本地 0.1.2 线：
  - `packages/api/session-controller/src/index.ts`（SessionController 服务定义）
  - `packages/api/session-controller/src/{history,control}.ts`（page/follow/control）
  - `packages/client/ui-chat/src/client/apply.ts`（聊天订阅与注入服务）
  - `packages/client/ui-settings/src/client/settings-scope.ts`（settingsScope）
  - `packages/bundle/web-app/cordis.patch.yml`（web include 组编排）
  - `apps/cli/src/plugin.ts`、`vendor/cordis-plugin-include`（bundle patch/include）
- 官方 npm 0.1.1-rc.2（`node_modules/@deepseek-ai/dsh`）：同一套 web/客户端机制，
  模块表行与事件集合略少；可对照 `dsh-web-app` 与各 `dsh-client-*` 包。
- 本机留存：`npm run dsh:compat [版本...]` 会把各版本缝所在包解压到仓库根的
  `.dsh-versions/<版本>/`（已 gitignore，只在本机留存、不进提交），
  上面 0.1.5 一节的证据路径即取自此目录，可直接 `rg` 复查或跨版本 diff。
