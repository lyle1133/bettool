# BetTool 私人云端学习库同步

这是可选的单人多设备同步服务。它不自动部署，也不会在 GitHub Pages 上运行 Python 解析内核。

## 安全模型

- 只有持有 BETTOOL_SYNC_TOKEN 的设备才能读写云端学习库。
- 请生成至少 32 字符、推荐 64 个十六进制字符的随机令牌；令牌只通过 Cloudflare Worker Secret 配置，不写进仓库。
- 前端只向 HTTPS Worker 地址发送 Bearer 令牌；每个浏览器将令牌保存于本地存储。不要把令牌分享给他人。
- `ALLOWED_ORIGIN` 配置正式站和测试站固定域名；Worker 代码另外允许 `*.bettool-private-learning-test.pages.dev` 中仅有一层子域名的 HTTPS 预览地址，以兼容 Cloudflare Pages 每次部署生成的预览链接。其他 `pages.dev` 网站仍会被拒绝。修改 Worker 后需要从 `worker/` 目录重新部署，单独部署 Pages 前端不会更新 Worker。
- 数据在 D1 中以版本号进行 compare-and-swap 保存。多设备同时写入时返回 409，浏览器合并新旧案例后重试。
- 当前同步大小上限约 850 KB。上线前请先导出本地 JSON 备份。

## 部署步骤

需要一个 Cloudflare 账户，并使用 Node.js 当前受支持版本。

1. 在 Cloudflare Dashboard 的 D1 中创建数据库，名称使用 bettool-learning-sync。
2. 记下数据库 ID，替换 wrangler.toml 内 database_id 的全零占位符。
3. 进入本目录，安装依赖：npm install
4. 应用迁移：npx wrangler d1 migrations apply bettool-learning-sync --remote
5. 生成随机令牌（Node.js 命令）：
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
6. 将命令输出保存到密码管理器，并设置 Worker Secret：
   npx wrangler secret put BETTOOL_SYNC_TOKEN
   按提示粘贴令牌。不要将此值写入 .env、配置文件、截图或 Git。
7. 测试并部署：npm test；然后 npx wrangler deploy
8. 打开 Worker 的 /health，预期返回 JSON 中 ok=true。这只检查服务；实际同步还需要验证身份和 D1。

## 在 BetTool 网页配置

1. 先在当前设备点击“导出学习库”，保存备份。
2. 打开 BetTool 的输入页，在“私人云端学习库同步”中填入 Worker 根地址（例如 https://bettool-private-learning-sync.<你的子域>.workers.dev）和刚生成的令牌。
3. 点击“保存云端配置”，再点击“立即同步”。成功后，同一份令牌和 Worker 地址可在你自己的另一台设备配置。
4. 首次同步会合并本地与云端案例；相同年份、相同标准化原文只保留更新时间较新的版本。请核对总案例数并保留备份。

## 本地测试 / 限制

- `npm test` 覆盖身份验证、CORS（正式站和测试站的 OPTIONS 预检）、快照保存和版本冲突。
- Worker 不含任何密钥；database_id 必须由部署者填写。
- 首次部署前不要在生产账户上运行未经核对的写入测试。可使用单独的测试 D1 数据库和 Worker 名称验证。
- 数据库中的学习内容属于用户数据。请定期导出 JSON 并在 Cloudflare 中备份 D1。
- 目前服务同步的是学习案例、待处理样本和学习计数，不同步下注记录、赔率、开奖号码或 Groq API Key。
