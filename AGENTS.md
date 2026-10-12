# BetTool project agent instructions

For Cloudflare work, prefer the Cloudflare MCP tools and the current Cloudflare docs. Since this repository has a Wrangler configuration at `worker/wrangler.toml`, use Wrangler for this Worker rather than the optional generic `cf` CLI.

Before changing cloud sync:
1. Read `worker/README.md`, `worker/src/index.js`, and `worker/wrangler.toml`.
2. Keep `BETTOOL_SYNC_TOKEN` as a Cloudflare Worker Secret; never add the value to code.
3. Preserve the current D1 database and run Worker tests from `worker/`.
4. Do not deploy or merge into production `main` without explicit authorization.
