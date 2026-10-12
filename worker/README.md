# BetTool 私人云端学习库同步

这是可选的单人多设备同步服务。它不自动部署，也不会在 GitHub Pages 上运行 Python 解析内核。

## 安全模型

- 只有持有 BETTOOL_SYNC_TOKEN 的设备才能读写云端学习库。
- 请生成至少 32 字符、推荐 64 个十六进制字符的随机令牌；令牌只通过 Cloudflare Worker Secret 配置，不写进仓库。
- 前端只向 HTTPS Worker 地址发送 Bearer 令牌；每个浏览器将令牌保存于本地存储。不要把令牌分享给他人。
- ALLOWED_ORIGIN 限制浏览器来源为本项目 GitHub Pages 域名。
- 数据在 D1 中以版本号进行 compare-and-swap 保存。多设备同时写入时返回 409，浏览器合并新旧案例后重试。
- 当前同步大小上限约 850 KB。上线前请先导出本地 JSON 备份。

## 部署步骤

需要一个 Cloudflare 账户，并使用 Node.js 当前受支持版本。

1. 打开 Cloudflare Dashboard → **Workers & Pages → D1 SQL Database**，确认存在名为 bettool-learning-sync 的数据库。
2. 打开该数据库详情页，核对数据库 ID 与 worker/wrangler.toml 中的 database_id 一致。当前配置文件已有 ID，不是全零占位符；如果数据库不存在或 ID 不匹配，请先确认账户和目标数据库，**不要随意替换现有 ID**。
3. 在 Cloudflare Dashboard 创建 API Token，并限制在目标账户和对应资源。该流程需要 D1 Read（工作流会先校验数据库 ID/名称）与 D1 Edit；部署需要目标 Worker 的编辑权限。如果 Worker 还不存在，为了避免授予整个账户的创建权限，可以先在 Dashboard 创建同名 Worker `bettool-private-learning-sync`，然后将 token 的 Workers Editor 权限限制到该 Worker。
4. 在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加以下 3 个 Repository secrets：
   - CLOUDFLARE_ACCOUNT_ID：Cloudflare 账户 ID
   - CLOUDFLARE_API_TOKEN：上一步创建的 API Token
   - BETTOOL_SYNC_TOKEN：强随机令牌，至少 32 字符。可在本机 Node.js 运行：
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   把同步令牌保存到密码管理器；不要写进源代码、提交、截图或聊天记录。前端设置页中也要使用同一个 BETTOOL_SYNC_TOKEN。
5. 打开 GitHub 仓库的 Actions → **Deploy BetTool Cloud Sync Worker**，点击 Run workflow，选择 `main` 分支，并在确认框输入大写 `DEPLOY`。工作流会先运行 `npm test`，再通过 Cloudflare API 校验配置的 D1 ID 确实对应同账户中名为 `bettool-learning-sync` 的数据库；校验通过后才应用迁移、部署 Worker 并设置 `BETTOOL_SYNC_TOKEN`。
6. 在工作流运行详情的 Summary 中复制 Worker URL，再打开该 URL 后加 /health；预期返回 JSON 中 ok=true。随后再用 BetTool 页面实际测试同步。
   
   工作流只会在手动触发且确认框输入 DEPLOY 时执行。不要在未核对数据库 ID、账户 ID 和备份的情况下运行。

## 在 BetTool 网页配置

1. 先在当前设备点击“导出学习库”，保存备份。
2. 打开 BetTool 的输入页，在“私人云端学习库同步”中填入 Worker 根地址（例如 https://bettool-private-learning-sync.<你的子域>.workers.dev）和刚生成的令牌。
3. 点击“保存云端配置”，再点击“立即同步”。成功后，同一份令牌和 Worker 地址可在你自己的另一台设备配置。
4. 首次同步会合并本地与云端案例；相同年份、相同标准化原文只保留更新时间较新的版本。请核对总案例数并保留备份。

## 本地测试 / 限制

- `npm test` 覆盖身份验证、CORS（正式站和测试站的 OPTIONS 预检）、快照保存和版本冲突。
- Worker 代码不含任何密钥；D1 ID 必须属于目标 Cloudflare 账户。部署工作流会在执行迁移前校验该 ID 与数据库名称。
- 首次部署前不要在生产账户上运行未经核对的写入测试。可使用单独的测试 D1 数据库和 Worker 名称验证。
- 数据库中的学习内容属于用户数据。请定期导出 JSON 并在 Cloudflare 中备份 D1。
- 目前服务同步的是学习案例、待处理样本和学习计数，不同步下注记录、赔率、开奖号码或 Groq API Key。
