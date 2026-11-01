# 脱敏机制

插件挂载在 `llm/stream` 水瀑（dsh 唯一的请求边界），拦截发生在请求到达 adapter（云端边界）之前。
机制要点：

- **只处理会真正上云的内容**：adapter 序列化时只发送 `message.content` 内容块；消息的 `source`
  元数据（notice 摘要、snapshot 片段、replayState）不会上云，因此不在此列。
- **reasoning 内容会上云**：adapter 将 `reasoning` 块序列化为 `reasoning_content` 发送，本插件同样脱敏。
- **辅助调用同样脱敏**：`purpose: compaction / session-title` 的请求同样经过 `llm/stream`。
- **原请求保持不变**：agent-loop 构建的请求被深冻结并用 WeakSet 标记；本插件生成脱敏副本重入水瀑，
  原请求对象不修改；用户输入在落盘前已由 `agent/pre-step` 遮罩。
- **日志落盘前遮罩**：`agent/pre-step` 改写进入步骤的用户消息，`tools/post-execute` 改写工具结果，
  `tools/ptc-dispatch-log`（dsh ≥ 0.1.2）改写 run_code 子派发日志——在写入 `user/message` /
  `tool/result` / `tool/code-dispatch` 事件前即替换为占位符；与 `llm/stream` 共用同一会话映射，
  编号一致，且 `llm/stream` 仍作为辅助调用（compaction/session-title）的兜底。
- **展示层还原**：浏览器通过 `sessionController.page/follow` 读取会话；host 侧服务可见时插件包装
  这两个方法，在返回浏览器前按会话映射把占位符还原为原值——用户消息的界面显示为原文
  （其落盘副本仍为占位符），模型回复与工具调用参数因入站还原以真值显示并落盘
  （`restoreInbound: false` 时关闭；服务不可见时界面与日志一致为占位符，见[已知限制](limitations.md)）。
- **入站还原**：模型返回流中的占位符按会话映射在本地还原为原值；还原内容再次出站时重新脱敏。
- **会话头**：adapter 会发送 `x-deepseek-harness-session-id` 请求头，`dropSessionId` 默认移除。

## 会话一致性与流式还原

- 同一会话内同一值跨请求映射到同一占位符，模型可跨轮关联实体；不同会话相互隔离。
- 占位符被网络切分到多个 delta 时，尾部缓冲跨分片还原，流式显示不残留前缀。
- 还原未命中（映射被逐出或模型改写）有统计与日志可见，见[诊断与统计](diagnostics.md)。

## 相关配置

出站/落盘/还原分别由 `restoreInbound`、`persistMapping`、`failClosed`、`strictUnknown`、
`nonTextPolicy` 等键控制，完整列表见[配置](configuration.md)。
