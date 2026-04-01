# HTTP 305

A "12 Foot Ladder" style HTTP proxy that fetches web pages and rewrites URLs to route through itself. Supports HTML rewriting, static resource streaming, and file downloads (PDF, DOCX, DOC, PPTX, PPT, XLSX, XLS, RTF, ODT, ODP, ODS, EPUB) with automatic content-type detection.

Deployed on [Render.com](https://render.com) (free tier).

## Setup

```bash
npm install
node setup.js      # Creates .env with defaults
```

## Run

```bash
npm run dev        # Development (hot-reload via nodemon)
npm start          # Production
npm run lint       # ESLint
```

## Routes

| Route | Purpose |
|-------|---------|
| `/pxy/html?url=<URL>&js=0\|1&ukred=0\|1` | Proxy HTML with URL rewriting (query params) |
| `/pxy/html/<URL>` | Proxy HTML with URL rewriting (path) |
| `/pxy/html/nojs/<URL>` | Proxy HTML with JS stripped |
| `/pxy/resource/<URL>` | Stream static assets (CSS, JS, images, fonts) |
| `/pxy/auto/<URL>` | Auto-detect content type and serve accordingly |
| `/pxy/dl/<URL>` | Force download with tiered caching (rate-limited) |
| `/pxy/dl/hash/<key>` | Download a cached file by its SHA-256 hash key |
| `/api/cache?url=<URL>` | Cache API — ensure a file is cached and return JSON metadata |
| `/ping` | Health check |

## Security

- **SSRF protection** — URL validation rejects private/internal IPs, loopback addresses, non-HTTP schemes, and `.local`/`.internal` TLDs.
- **CIDR allowlist** — Download cache writes and the `/api/cache` endpoint can be restricted to specific IPv4 ranges via the `DL_ALLOWED_CIDRS` env var. Unset = allow all.
- **Rate limiting** — `/pxy/dl` endpoints are rate-limited to 60 requests per minute per IP.
- **MIME validation** — The download handler rejects non-document MIME types (415 response).

## Caching

Downloads use a tiered cache strategy:

1. **Local** — `.cache/` directory, SHA-256(normalized URL) + extension filenames. Fast but ephemeral on Render deploys.
2. **R2** — Cloudflare R2 bucket (optional, requires R2 env vars). Persistent across deploys. On R2 hit, the file is restored to local cache.
3. **Upstream** — Fresh fetch from the original URL. Saves to both tiers.

Cached files include `.meta` sidecar files to preserve the original source URL for human-readable download filenames. ETag headers enable `304 Not Modified` responses for repeat requests.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | Server listen port |
| `LOG_LEVEL` | `debug` | Winston log level |
| `MAX_DOWNLOAD_SIZE` | `10485760` | Max download file size in bytes (10 MB) |
| `FETCH_TIMEOUT` | `10000` | Upstream fetch timeout in ms |
| `R2_ACCOUNT_ID` | — | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | — | R2 access key (enables R2 cache when set) |
| `R2_SECRET_ACCESS_KEY` | — | R2 secret key |
| `R2_BUCKET_NAME` | — | R2 bucket name for cached files |
| `DL_ALLOWED_CIDRS` | — | Comma-separated IPv4 CIDRs allowed to write to the download cache (unset = allow all) |

## Architecture

See [CLAUDE.md](CLAUDE.md) for full architecture documentation and handler details.
