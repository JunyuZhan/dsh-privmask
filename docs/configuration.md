# 配置

## 快速开始

默认配置即「隐私优先」：密钥凭据、地址、姓名、公司/单位名称与 PII 脱敏；案号、出生日期、
涉案金额保留（公开可查或办案所需）。

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

需要案号/出生日期也脱敏时，将 `redactCaseNumbers: true` / `redactDob: true`；
需要严格身份证校验时保持 `strictId18: true`（默认）。

在提供客户端设置界面的宿主里（`web` profile、DSH Desktop），改动也可以直接在「设置 → 插件 →
隐私保护」卡片上完成：标了 volatile 的字段由宿主写回 profile，**无需重启进程**即生效。

## 全部配置键

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `cnEntities` | `true` | 中文实体识别总开关 |
| `redactCredentials` | `true` | 凭据类脱敏：PEM、JWT、API Key、Bearer/Authorization、密码等 |
| `redactAddress` | `true` | 地址类脱敏：省市区乡、住址、户籍地、送达地址等 |
| `redactNames` | `true` | 姓名脱敏：姓名是能唯一锁定当事人的信息 |
| `redactCompanies` | `true` | 公司名称脱敏：法人唯一标识 |
| `redactOrgs` | `true` | 机关/单位名称脱敏；**法院/法庭名称默认保留**（公开审判机关名，且案号代字已写明法院；确需遮罩某个法院时把它的全称加入 `customTerms`） |
| `redactCaseNumbers` | `false` | 案号脱敏：默认保留（公开案件标识，管辖/关联判断需要真值） |
| `redactDob` | `false` | 出生日期脱敏：默认保留（非唯一信息，年龄/时效计算需要真值） |
| `customTerms` | `[]` | 自定义敏感词表：精确子串匹配即脱敏，不受角色上下文限制（当事人姓名/别名/机构简称）；面板输入框支持用分号/逗号/顿号分隔一次添加多个 |
| `preserveValues` | `[]` | 白名单：命中规则的值也原样保留（标记放行误报） |
| `strictId18` | `true` | 身份证 18 位严格校验：仅校验位合法的号码脱敏；关闭后日期段合理或带「身份证号」上下文的号码也脱敏 |
| `restoreInbound` | `true` | 入站还原：云端返回的占位符在本地还原为原值（响应显示、工具执行），下次出站重新脱敏；历史展示层还原依赖 `persistMapping: true` |
| `nonTextPolicy` | `strip` | 非文本内容策略：`strip`=移除后放行、`block`=拒绝请求、`allow`=透传（0.2.41 起默认仍需 `allowRawMedia: true` 才真正放行） |
| `allowRawMedia` | `false` | 显式承担风险后才允许图片/文件原样透传（默认 false：`allow` 也拒绝，先本地 OCR/脱敏再发送更符合“凡离境必先脱敏”） |
| `preflightBase64` | `false` | base64 文本预检：媒体/文件块中可判定为 UTF-8 文本的 base64 载荷，先本地解码脱敏再回编码上云；二进制（如图片像素）与不可判定内容仍按 `nonTextPolicy` 处置（不是 OCR） |
| `longTokens` | `true` | 长 hex/base64 串脱敏 |
| `redactToolMeta` | `true` | 工具描述/参数 schema 中的敏感信息脱敏（担心遮罩影响模型理解工具时可设 false） |
| `redactPaths` | `false` | 绝对路径脱敏（开启会破坏文件工具的路径回传） |
| `persistMapping` | `true` | 同一会话内跨请求保持同一值映射同一占位符；关闭则每请求重新编号，且浏览器历史展示层无法还原已落盘的占位符（流内实时还原不受影响） |
| `dropSessionId` | `true` | 移除 `x-deepseek-harness-session-id` 请求头 |
| `failClosed` | `true` | 严格模式：脱敏异常时拒绝请求，绝不把未脱敏数据发往云端 |
| `strictUnknown` | `true` | 严格模式：发现未检查的未知字段（含嵌套的非普通对象，如 Buffer/类实例）时拒绝请求 |
| `egressAudit` | `true` | 离境审计：每笔发往云端的 llm 请求写一行本地 JSONL（`$DSH_HOME/privmask-egress.jsonl`，超过 10MB 轮转为 `.1`）；只记决策与计数，不记消息原文 |
| `localOcr` | `false` | 本地 OCR 兜底：启用后图片附件在 llm 水瀑前用 `~/.ocr-tool` 转成本地 OCR 文本，再走常规脱敏后上云（图片字节不出本地）；与 dsh-image-text-fallback 可叠加。关闭时图片仍按 `nonTextPolicy` 处置 |
| `localOcrCommand` | `[]` | 高级/测试：自定义 OCR 命令 argv（空则使用默认 `~/.ocr-tool/ocr.py` 调用） |
| `logRedactions` | `true` | 每次脱敏打印一行统计日志 |

各键在隐私上的取舍见[安全模型与边界](security-model.md)；CLI 工具也接受同一份配置键
（`--config`），见[命令行工具](tools.md)。
