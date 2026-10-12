# Project-local Cloudflare skills

This directory vendors a focused subset of the official [Cloudflare Skills](https://github.com/cloudflare/skills) repository for BetTool's Cloudflare Worker + D1 project.

Included:
- `wrangler`: Wrangler development, deployment, and resource-management guidance.
- `workers-best-practices`: security, runtime, configuration, and testing guidance.

The skill files are sourced from the Cloudflare Skills repository's `main` branch. See `LICENSE` for the upstream Apache-2.0 license. This project-local subset is not the same as installing every Cloudflare skill globally; it is scoped to this repository and intended to load when a compatible agent opens the project.

Cloudflare MCP endpoints are configured separately in `.vscode/mcp.json` and `.cursor/mcp.json`. First-use OAuth approval is still required in the coding agent's own UI.
