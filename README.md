# BetTool 押注自动统计

网页版本：[在线使用](https://lyle1133.github.io/bettool/)

主要文件：

- index.html / app.js：网页交互、AI 解析流程和统计页面
- learning.js：本地学习案例、人工纠错、备份和可选云端同步
- core.py：解析与统计内核
- main.py / buildozer.spec：Kivy 移动应用与 Android 打包配置
- tests/：解析、学习库回归测试
- worker/：可选的私人 Cloudflare Worker + D1 学习库同步服务

## 基本测试

    python -m py_compile core.py
    node --check app.js
    node --check learning.js
    node tests/test_learning_logic.js
    python -m unittest discover -s tests -v

Worker 的本地测试和部署说明见 worker/README.md。云同步默认不会自动启用；须先自行创建 D1、配置 Worker Secret 并部署，然后在网页填写地址和随机同步令牌。不要在代码仓库公开同步令牌或 AI API Key。

## 发布安全

功能在独立分支和 Draft PR 中验证；未审查的代码不要直接合并至 main。首次云同步前请先导出学习库 JSON 备份。
