# dsh-privmask

DeepSeek Harness **本地脱敏插件**（Host-only 静态版）：在 `llm/stream` 出口拦截每一次发往云端大模型的请求，把密钥、PII、中文实体替换为 `[REDACTED_类别_N]` 占位符后再放行。**本地会话日志与工具执行不受影响**——云端只看到脱敏内容。

## 功能

| 类别 | 说明 |
|---|---|
| 密钥/Token | PEM 私钥、JWT、`sk-`/`ghp_`/`AKIA`/`xox`、`Bearer`/`Basic`、`API_KEY=xxx` 等 |
| PII | 邮箱、电话（含 `+86` 国际格式）、IPv4、IPv6、长 hex/base64 串 |
| 中文实体 | 姓名（角色上下文+姓氏库）、身份证 18/15 位、统一社会信用代码、手机/座机、银行卡（Luhn）、案号、车牌、护照/证件、出生日期、地址、公司名、司法机关 |
| 防误伤 | `认为/请求` 不当姓名、`该公司/企业` 泛称不脱敏、`向人民法院` 介词结构不误伤 |
| 会话关联 | 移除 `x-deepseek-harness-session-id` 请求头（可关） |

## 安装

npm 包发布后：

```sh
dsh plugin --profile web add dsh-privmask
# 或直接从 GitHub 安装
dsh plugin --profile web add github:yourname/dsh-privmask
```

然后编辑 `$DSH_HOME/profiles/web/cordis.patch.yml` 挂载：

```yaml
- id: privmask
  name: dsh-privmask
  config:
    enabled: true
    cnEntities: true
    redactPaths: false   # 开启会替换绝对路径，但会破坏文件类工具，默认关
    dropSessionId: true
    failClosed: false
```

重启 `dsh web` 生效。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `cnEntities` | `true` | 中文实体识别 |
| `redactPaths` | `false` | 绝对路径脱敏（会破坏文件工具的路径回传） |
| `redactToolMeta` | `true` | 工具描述/参数 schema 脱敏（关闭可避免工具描述被占位符替换，利于模型理解工具用途） |
| `longTokens` | `true` | 长 hex/base64 串脱敏 |
| `dropSessionId` | `true` | 移除会话关联头 |
| `failClosed` | `false` | 脱敏异常时拒绝请求（true）或放行原文（false） |
| `logRedactions` | `true` | 每次脱敏打印一行统计日志 |

## 测试

```sh
node test/self-test.js
```

自测脚本模拟最小 Cordis 上下文，验证拦截器把测试请求脱敏后再交给 adapter（云端边界）。

## 注意事项

- 脱敏对当前进程内**所有会话**的模型请求生效（`llm/stream` 是全局事件）。
- 同一次请求内，同一密钥映射到同一占位符，模型仍能理解引用关系。
- 路径脱敏默认关闭：agent 需要真实路径才能操作本地文件，开启后工具链会断裂。
- 本地会话日志始终保留原文，云端不可逆地只能看到占位符。

## License

MIT

## 脱敏后的语义可用性（已用真实模型验证）

把本插件实际输出的占位符文本交给大模型处理，验证结论：

- **结构级理解可用**：类别令牌（NAME/ID18/CASE…）+ 保留的角色词/上下文词（原告、身份证号、案号），模型能准确推断每类占位符的信息类型；
- **同值关联可用**：同一请求内同类值映射同一占位符，模型能据此建立跨句实体关联（如两处 EMAIL_1 指向同一邮箱）；
- **精确值任务降级**：姓名、金额、案号等具体数值被脱敏后，任务从"精确执行"降级为"结构复述"，涉及身份核验、管辖判断的任务需人工补值；
- **工具链边界**：模型无法回传真实路径执行本地操作，故默认关闭（redactPaths: false）；若工具描述含敏感词影响函数调用，可关闭 redactToolMeta。

## 测试

```sh
node test/self-test.js       # 14 项功能回归（端到端拦截 + 中文实体）
node test/reliability-test.js # 28 项可靠性（边界/幂等/防误伤/校验拒绝/配置/并发/性能）
node test/fuzz-test.js        # 600 例随机文本（不崩 + 幂等）
```

## npm 发布（可选，GitHub 直装已够用）

```sh
npm login        # 若提示需要 2FA：先在 npmjs.com 账户设置启用二次验证
npm publish      # 包名 dsh-privmask（已确认未被占用）
```
发布后使用方改为：`dsh plugin --profile web add dsh-privmask`
