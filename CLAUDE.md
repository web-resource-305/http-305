# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HTTP-305 is a "12 Foot Ladder style" HTTP proxy — a Node.js/Express server that fetches web pages and rewrites all internal URLs to route through itself, enabling transparent proxying of HTML, static resources, and downloadable files (PDF, DOCX, PPTX, XLSX, etc.).

Deployed on Render.com: https://http-305.onrender.com
GitHub: https://github.com/web-resource-305/http-305

## Commands

```bash
node setup.js      # Create .env with default LOG_LEVEL=debug (run once)
npm run dev        # Start with nodemon (hot-reload)
npm start          # Production start
npm run lint       # Run ESLint
npm install        # Install/update dependencies
```

No test suite is defined.

## Architecture

### Request Flow

All proxying starts in `app.js` which defines routes and delegates to handlers:

```
GET /pxy/html?url=<URL>&js=0|1&ukred=0|1  →  handlers/pxy-html.js
GET /pxy/html/<URL>                        →  handlers/pxy-html.js
GET /pxy/html/nojs/<URL>                   →  handlers/pxy-html.js
GET /pxy/resource/<URL>                    →  handlers/pxy-resource.js
GET /pxy/auto/<URL>                        →  handlers/pxy-auto.js
GET /pxy/dl/<URL>                          →  handlers/pxy-dl.js
GET /ping                                  →  inline (renders views/headers.hbs)
GET /pxy                                   →  inline (returns 305 status info)
```

### HTML Proxy Pipeline (`handlers/pxy-html.js`)

The core of the project. For each proxied HTML request:
1. Fetches the target URL using `node-fetch` with a Googlebot user-agent
2. Delegates to `lib/html-rewriter.js` which parses HTML with JSDOM and rewrites all URLs in the DOM:
   - `<img src>`, `<link href>`, `<script src>` → `/pxy/resource/<encoded-url>`
   - `<a href>` → `/pxy/auto/<encoded-url>` (server-side content-type detection)
   - `<form action>` → left as absolute URL (forms bypass the proxy)
3. Returns the modified HTML

**Query params:**
- `js=0` — strips all `<script>` tags; `<a>` links get `?js=0` appended for propagation
- `ukred=1` — if `CF-IPCountry` header is `GB`, redirect directly to the target URL instead of proxying

### Auto-Detection Proxy (`handlers/pxy-auto.js`)

Fetches the upstream URL, inspects the `Content-Type` response header, and routes automatically:
- `text/html` → rewrites URLs (same as pxy-html) and returns modified HTML
- Downloadable types (PDF, DOCX, PPTX, XLSX, etc.) → serves as attachment download with caching
- Everything else → streams directly with upstream Content-Type

### Resource Proxy (`handlers/pxy-resource.js`)

Streams static assets (CSS, JS, images, fonts, etc.) with MIME types from `lib/content-types.js`. No DOM manipulation — pure pass-through stream.

### Download Proxy (`handlers/pxy-dl.js`)

Fetches downloadable files (PDF, DOCX, DOC, PPTX, PPT, XLSX, XLS) and serves them as `Content-Disposition: attachment`. Uses a tiered cache strategy with `X-Cache` and `X-Cached-At` response headers:

- **Tier 1 (Local)**: `.cache/` directory, SHA256(url)+extension filenames. Fastest, but ephemeral on Render deploys.
- **Tier 2 (R2)**: Cloudflare R2 bucket via `lib/r2-cache.js`, same key naming. Persistent across deploys. Optional — requires R2 env vars.
- **Tier 3 (Upstream)**: Fresh fetch from the original URL. Saves to both tiers.

On R2 hit, the file is restored to local cache for future fast access.

### Shared Libraries

- `lib/content-types.js` — single source of truth for MIME type ↔ extension mappings (both resource and download types)
- `lib/html-rewriter.js` — JSDOM-based URL rewriting, shared by `pxy-html` and `pxy-auto`
- `lib/r2-cache.js` — optional R2 backup cache layer, active only when `R2_ACCESS_KEY_ID` is set

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | Server listen port |
| `LOG_LEVEL` | `debug` | Winston log level |
| `MAX_DOWNLOAD_SIZE` | `10485760` | Max download file size in bytes (10MB) |
| `FETCH_TIMEOUT` | `10000` | Upstream fetch timeout in ms |
| `R2_ACCOUNT_ID` | (none) | Cloudflare R2 account ID (used to build S3 endpoint) |
| `R2_ACCESS_KEY_ID` | (none) | R2 access key (enables R2 cache when set) |
| `R2_SECRET_ACCESS_KEY` | (none) | R2 secret key |
| `R2_BUCKET_NAME` | (none) | R2 bucket name for cached files |

## Code Style

ESLint enforces: semicolons required, double quotes, 2-space indentation. Prettier is integrated. Run `npm run lint` before committing.
