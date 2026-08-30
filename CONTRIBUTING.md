# 贡献指南

感谢参与 dsh-privmask。本插件处理隐私数据，规则改动需要**可解释、可回归**。

## 开发环境

- Node.js >= 18
- 依赖：`@deepseek-ai/schemastery`、`@deepseek-ai/cordis`（测试可直接 `npm install --no-save`）

```sh
npm install --no-save @deepseek-ai/schemastery@^3.18.1 @deepseek-ai/cordis@^4.0.1
```

## 运行测试

提交前必须跑通全部四套：

```sh
node test/self-test.js        # 端到端拦截 + 中文实体
node test/accuracy-test.js    # 准确性：法律文书矩阵/证件上下文/复姓/误伤/客户端版本一致性
node test/reliability-test.js # 可靠性：边界/幂等/还原/流式/配置/严格模式
node test/fuzz-test.js        # 随机文本：不崩 + 幂等
```

`npm publish` 的 `prepublishOnly` 会自动执行以上全部测试。

## 代码结构

- `lib/rules.js` — 脱敏规则（词表/正则/校验器/泛指判定），**改动核心**
- `lib/engine.js` — 会话映射、占位符编号、脱敏管线
- `lib/restore.js` — 占位符→原值还原（含流式重组）
- `lib/index.js` — 插件入口（llm/stream 拦截、pre-step/工具落盘遮罩、展示层还原、settings）
- `lib/client.js` — 浏览器端隐私保护卡片
- `test/*.js` — 四套测试
- `tools/mask-preview.mjs` — 脱敏对照 CLI

## 规则改动约定

1. **新增识别**：在 `rules.js` 对应词表/正则补充，并在 `accuracy-test.js` 加回归用例
   （样例用虚构数据，标注预期结果）。
2. **修复误伤**：先写「必须保留」的回归用例，再改规则；误伤与漏检同等重要。
3. **幂等**：任何规则都必须保证「脱敏结果再次脱敏不变」——reliability/fuzz 会检查。
4. **还原对称**：新增占位符类别时确认 `restore.js` 无需改动（类别无关），并在还原测试中覆盖。
5. **版本同步**：改动 `package.json` 版本时，同步更新：
   - `lib/client.js` 的 `PLUGIN_VERSION`（有测试强制一致）
   - `CHANGELOG.md`（Keep a Changelog 格式）
   - `README.md` 的测试计数（如涉及）

## 提交信息

沿用仓库现有风格（中文、前缀标注类型）：

```text
fix: 修复……（0.2.x）
feat: 新增……（0.2.x）
test: 新增……回归
chore: 发布准备
```

## 发布流程（维护者）

1. 确认四套测试全绿、`PLUGIN_VERSION` 与 `package.json` 一致
2. `npm publish --registry=https://registry.npmjs.org`（`prepublishOnly` 自动跑测试）
3. 推送 GitHub `main`
4. 用户侧：`dsh plugin --profile web update dsh-privmask` 后**重启 dsh web**

## PR 检查清单

- [ ] 四套测试通过
- [ ] 新增/修改的规则有对应回归用例（虚构数据）
- [ ] 幂等与还原往返未破坏
- [ ] CHANGELOG 与 README 计数同步
- [ ] 提交信息符合仓库风格
