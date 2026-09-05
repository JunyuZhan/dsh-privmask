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
