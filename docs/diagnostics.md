# 诊断与统计

- **控制台日志**：所有关键动作以 `[privmask]` 前缀输出，如启动配置、每次脱敏统计（类别与次数）、
  非文本拦截原因、运行时设置 live 更新等；`logRedactions: false` 时仅保留错误与告警。
- **结构化事件**：每次请求/落盘遮罩/拦截/还原未命中都会发出 `privmask/stats` 事件
  （`ctx.emit`），`kind` 为 `redacted / logRedacted / blocked / error / restoreMiss / settingsUpdated` 等。
- **还原未命中**：模型返回无法还原的占位符时（映射被逐出或模型改写），日志会给出 sessionId、
  未命中数量与最多 3 个占位符样例，便于判断是否因会话超长逐出导致。
- **诊断文件**：启动与还原关键路径另写一份 `$DSH_HOME/privmask-restore.log`（默认 `~/.dsh/`），
  超过 5MB 轮转为 `.1`；用于在无控制台可读的真实环境（如 LaunchAgent）排查入站还原问题。
- **离境审计**：`$DSH_HOME/privmask-egress.jsonl` 每行一笔发往云端的请求（超过 10MB 轮转为 `.1`），
  用 `node tools/audit-summary.mjs` 汇总，见[命令行工具](tools.md)。
- **适配检查**：插件启动时会打印一行 `[privmask] 适配检查: ...`，明确列出 llm/settings/模块表条目/
  sessionController 可见性与降级项；升级宿主后先看这一行，能立刻判断哪些能力降级了。
