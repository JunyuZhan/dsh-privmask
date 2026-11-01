# 开发与发布

## 开发环境

Node ≥ 18：

```sh
npm install        # 运行时依赖 + peer + 构建/测试工具
npm run build      # client-src → lib/client.js（产物由源码生成，不要手改）
npm test           # 五套测试：self / accuracy / reliability / fuzz / docx
```

编码约定、规则改动要求与提交信息风格见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 测试

单套运行（定位问题用）：

```sh
node test/self-test.js        # 15 项功能回归（端到端拦截 + 中文实体 + 法院保留/检察机关脱敏）
node test/reliability-test.js # 201 项可靠性（边界/幂等/防误伤/校验/配置/姓名边界/图片策略/base64文本预检/本地OCR兜底/严格模式/入站还原/类别策略/性能/编号单调/交叉规则/日志遮罩（含 post-execute 宿主默认决策）/展示层还原/词表白名单/delta重组/兼容矩阵/settings惰性注册/settings-forms新形态/volatile活引用/词表热更新/字符串 content 还原/出站脱敏/离境审计/审计摘要CLI/PDF预检CLI/PDF覆写脱敏/dsh0.1.5请求形态/跨平台CRLF与路径/病理输入时间上限）
node test/accuracy-test.js    # 26 项准确性（法律文档矩阵/凭据/PII校验/证件与信用代码上下文/复姓/泛化机构与村镇/姓名标签边界/客户端版本一致性）
node test/docx-test.js        # docx 本地脱敏（格式保留/非文本条目原样/占位符写入）
node test/fuzz-test.js        # 300 例随机文本 × 2 断言（不崩 + 幂等，共 600 断言）
```

## CI

GitHub Actions 在每次 push / PR 时跑三个 job：

- **test**：ubuntu，Node 18/20/22 三档，`npm ci` → `npm run build:check`（产物与源码一致）→ `npm test`；
- **cross-platform**：macOS + Windows 真机跑同一套测试（Windows 上的 CRLF/路径/venv 布局只有真机跑才算数）；
- **compat**：`node tools/dsh-compat-check.mjs` 巡检 0.1.1-rc.2 / 0.1.5-rc.3 / 0.1.7-rc.2 /
  0.2.1-rc.5 / 0.2.2-alpha.2 的宿主缝，上游改事件名/服务名/客户端模块时在这里报警，
  而不是等用户发现。

## 宿主适配自检

需要联网，不进 `prepublishOnly`（发布必须能离线跑通）：

```sh
npm run dsh:compat                 # 核对 0.1.1-rc.2 与当前 latest/alpha（0.2.1-rc.5 / 0.2.2-alpha.2）
npm run dsh:compat -- 0.1.7-rc.2   # 核对指定版本（已核对，结论同上）
npm run dsh:compat -- --upstream   # 只看上游 dist-tags 是否出现未核对的新版本（定时监控用）
```

上游监控与版本清单维护方式见[兼容性与升级](compatibility.md#上游监控)。

## 发版冒烟

需要本机已装 dsh 且 profile 里装了本插件；不调模型、不花钱：

```sh
npm run smoke                      # 默认 --profile web
npm run smoke -- --profile desktop # 指定 profile
```

桌面版（Windows 上 `dsh` 只有 `.cmd`，用应用自带 CLI 显式指定；0.2.50 起支持 `.cmd`/`.bat`）：

```sh
# Windows（PowerShell）
node tools/smoke.mjs --profile desktop --dsh "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
# macOS
node tools/smoke.mjs --profile desktop --dsh "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
```

它断言四件实际踩过坑的事：插件确实挂载（`[privmask] 适配检查`）、设置命名空间已注册、
客户端模块表含 `dsh-privmask/client.js`（界面能看到卡片）、profile 里装的就是仓库这份代码
（版本一致，可用 `--allow-version-drift` 放宽）。退出码 0/1，可直接进 CI 或发版清单。

## 发布（维护者）

打 tag 即发布，`.github/workflows/publish.yml` 会校验 tag 与 `package.json` 一致、
校验产物、跑测试，再 `npm publish --provenance`（npm Trusted Publishing/OIDC，无需 2FA；
版本已存在时自动跳过，tag 可安全重放）：

```sh
git tag v<版本> && git push origin v<版本>
```

完整发布步骤（版本号/CHANGELOG/Release/用户侧升级）见
[CONTRIBUTING.md「发布流程」](../CONTRIBUTING.md#发布流程维护者)。

手动兜底（Trusted Publishing 未配置或 CI 不可用时）：

```sh
npm login
npm publish --registry=https://registry.npmjs.org --auth-type=web
```

`prepublishOnly` 会先校验产物并运行全部测试，通过才允许发布。
版本变更记录见 [CHANGELOG.md](../CHANGELOG.md)。
