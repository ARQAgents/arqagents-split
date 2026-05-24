# 🏃 Split — AI Running Training Plan Generator

Free, AI-powered training plan generator. Tuned for tropical-heat races like the **Pattaya Marathon 2026** (July 19).

Live at: **https://split.arqagents.com**

## Architecture

- **Pages** — static HTML at `split.arqagents.com`
- **Worker** — secure proxy + 3/day quota at `/api/coach`
- **KV** — Cloudflare KV for per-IP quota tracking
- **AI** — Claude with web_search tool for real weather/route research

## Quick start

See [`DEPLOY_GUIDE.md`](./DEPLOY_GUIDE.md) for the full step-by-step.

## Files

| File | Purpose |
|---|---|
| `index.html` | Split UI with Pattaya Marathon banner |
| `_headers` | Cloudflare Pages security headers |
| `_redirects` | Routes `/api/coach` to the Worker |
| `worker/worker.js` | Secure Claude proxy + KV quota |
| `worker/wrangler.toml` | Worker config (KV binding) |

Built by [ARQAgents](https://arqagents.com).
