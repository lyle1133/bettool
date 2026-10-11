# BetTool 押注解析与统计

- 正式网站：https://lyle1133.github.io/bettool/
- 私人云同步测试网站：https://bettool-private-learning-test.pages.dev/
- 代码审查：https://github.com/lyle1133/bettool/pull/3（Draft，未合并到 main）

## 本次 UI V2 更新

- 手机优先的输入首页：把输入、解析、核对和添加记录作为主要流程。
- 解析结果按玩法显示成卡片，突出组数、金额、小计，并可展开查看完整标准化文本。
- AI 错误采用中文解释卡片，保留本地解析结果和原始输入，提供技术详情与重试入口。
- 汇总页增加记录笔数、记录总额和分组数量；表格在手机端支持横向滚动。
- AI 学习库、云同步和备份功能收纳到折叠区，避免挤占主要输入页面。
- 保留原有底部导航、赔率/回水设置、记录数据结构和学习库格式。

## AI 长文本与 Token 限额恢复

- 检测 Groq 413 / rate_limit_exceeded 且明确属于 TPM（每分钟 Token）限额的错误。
- 首次超限后先移除历史示例并使用较短提示词重试，以减少重复提示词开销。
- 仍超限时按原文顺序分段解析；多行玩法标题可作为分段上下文提示，分段结果最后按顺序合并。
- 如果仍处于限额窗口，会在界面提示等待并重试；特别长的内容仍可能需要等待或由用户按玩法区块拆分。
- 分段结果会提示用户重点核对边界处的玩法、号码和金额；AI 不保证每种输入都能自动正确识别。添加记录前仍需人工核对。

## 主要文件

- index.html：响应式 UI、输入页、解析预览卡片、汇总/风险/设置页面。
- app.js：界面状态、AI 调用、Groq 错误恢复、预览展示与统计交互。
- learning.js：本地学习案例、人工纠错、相似检索、导入导出、私人云端同步。
- core.py：解析与统计内核。
- main.py / buildozer.spec：Kivy 移动应用与 Android 打包。
- tests/：解析、学习库与 AI 长文本回归测试。
- worker/：可选 Cloudflare Worker + D1 私人学习库同步接口。

## 基本测试

    python -m py_compile core.py
    node --check app.js
    node --check learning.js
    node tests/test_learning_logic.js
    node tests/test_ai_resilience.js
    python -m unittest discover -s tests -v

Worker 的本地测试与部署说明见 worker/README.md。云同步密钥只应配置在 Cloudflare Worker Secret 和你本人设备的浏览器中；不要把同步令牌或 Groq API Key 提交到代码仓库。

## 数据与发布安全

- 变更保留在 feat/private-cloud-learning-sync 测试分支和 Draft PR 中，尚未合并到 main。
- 首次同步或进行大规模导入前，请导出学习库 JSON 备份。
- 云同步范围为学习案例、待处理样本、删除标记和学习计数；不包括下注记录、赔率、开奖号码或 Groq API Key。
- 修改过的解析和 AI 恢复逻辑应在测试网站进行实测；新增测试通过并不等于覆盖了所有下注格式。
