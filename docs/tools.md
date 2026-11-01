# 命令行工具

所有工具都是纯本地运行，不发送任何数据。

## 脱敏对照（预览云端会看到什么）

```sh
npm run mask:preview -- 案情.txt            # 默认档：隐私实体脱敏，金额/日期/案号保留
npm run mask:preview -- 案情.txt --redactFacts   # 全面档：姓名/公司/机关也脱敏
```

输出三份：原文 / 脱敏后（发往云端的样子）/ 还原后（模型产出经本地还原的样子），以及占位符统计。

## docx 脱敏（0.2.39+）

纯本地、保留原格式，输出“脱敏副本”，不修改原文件：

```sh
node tools/redact-docx.mjs input.docx                # 生成 input.redacted.docx
node tools/redact-docx.mjs input.docx output.docx    # 指定输出路径
node tools/redact-docx.mjs input.docx --whole-paragraph  # 按整段合并识别跨 run 敏感值
node tools/redact-docx.mjs input.docx --config cfg.json   # 按任务配置脱敏类别（键同[配置](configuration.md)）
node tools/redact-docx.mjs a.docx b.docx --out-dir out --report report.json  # 批量 + 报告
node tools/redact-docx.mjs a.docx b.docx --out-dir out --html-report 汇总.html # 批量 + HTML 汇总
```

占位符编号在整个文档中单调递增。默认按 Word 文本节点（`<w:t>`）处理；若敏感值被 Word 拆到多个 run
（如“邮箱 alice.”与“wang@…”分属两段），请加 `--whole-paragraph`（会把段落格式并入首个 run，
输出前用 Word 抽查）。涉密/合规场景请抽样核对后再使用。

## 纯文本（.txt / .md / 导出文本）

```sh
node tools/redact-text.mjs input.txt                # 生成 input.redacted.txt
node tools/redact-text.mjs input.txt out.txt --config cfg.json
```

## PDF 脱敏预检

```sh
node tools/pdf-preflight.mjs <输入.pdf> --report out.json [--ocr]
```

逐页提取文本层（扫描页可本地 OCR），走同一套脱敏规则后导出 `.redacted.txt` 预览与命中报告，
原 PDF 不被改写；预览即“云端会读到的内容”，用于上云前核对。

## PDF 覆写式脱敏（原型）

```sh
node tools/redact-pdf.mjs <输入.pdf> --report out.json
```

按文本层定位敏感片段 → gs 栅格化 → 像素涂黑 → 重组为图片型脱敏 PDF（无文本层，适合外发/留档）；
输出文件较大且不可再选字，属有损但有保障的覆写方案。保留文本层的原样编辑型 PDF 脱敏仍属长期规划。

## 审计摘要

```sh
node tools/audit-summary.mjs
```

汇总离境审计 JSONL（决策/媒体/脱敏类别 Top）；存在 `rawMedia`（有媒体原样离境）时打印告警
并以退出码 2 提示，便于日常巡检与 CI 告警；纯本地读取。

## 工具依赖与平台

| 工具 | 依赖 | 平台差异 |
|---|---|---|
| `pdf-preflight.mjs`、`redact-pdf.mjs` | poppler（`pdftotext`/`pdfinfo`）+ ghostscript | POSIX 下 ghostscript 叫 `gs`，Windows 下是 `gswin64c` / `gswin32c`；0.2.44 起按平台自动探测，缺失时给出对应安装指引（`choco` / `scoop` / `brew` / `apt`） |
| `--ocr` / `localOcr`（默认关） | `~/.ocr-tool` 本地视觉服务 | Python venv 布局不同：Windows 是 `venv\Scripts\python.exe`，POSIX 是 `venv/bin/python`；0.2.44 起自动选择（也可用 `localOcrCommand` 完全接管） |
| docx / 纯文本 / 审计摘要 / 对照工具 | 无外部依赖 | 纯 JS，跨平台一致 |

## 处理边界

对话与工具文本在出站前脱敏；docx 自 0.2.39 起提供本地文本层脱敏工具（不跨分段识别，见上）；
base64 文本预检自 0.2.42 起可对“文本编码成 base64”的载荷做解码脱敏（默认关）；
图片自 0.2.42 起可通过 `localOcr` 在本地 OCR 成文本后脱敏上云（默认关，依赖 `~/.ocr-tool`）；
PDF 自 0.2.42 起提供预检与覆写式脱敏（依赖 poppler+ghostscript，有损）。
其余覆盖不到的场景见[已知限制](limitations.md)。
