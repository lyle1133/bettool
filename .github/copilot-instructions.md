# BetTool Cloudflare development instructions

- This repository has a Cloudflare Worker in `worker/` backed by D1 and configured with Wrangler.
- For Worker development, inspect `worker/README.md`, `worker/wrangler.toml`, migrations, and tests first.
- Prefer current Cloudflare documentation and the configured Cloudflare MCP servers over memory for changing Wrangler, Workers, D1, secrets, and deployments.
- Use Wrangler for the existing Worker project. Do not replace the configured D1 database or run destructive migrations without explicit approval.
- Never print, commit, or place `BETTOOL_SYNC_TOKEN`, Cloudflare API tokens, or other credentials in repository files.
- Keep allowed web origins narrowly scoped to the production site and approved test site. Do not use wildcard CORS.
- Before deployment, run `npm test` from `worker/`. Verify the deployed Worker endpoint and cross-device sync after a deployment.
- Do not deploy to production or change the production `main` branch unless explicitly requested.
