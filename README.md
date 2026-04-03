# HTTP 305

A "12 Foot Ladder" style HTTP proxy that fetches web pages and rewrites URLs to route through itself. Supports HTML rewriting, static resource streaming, and file downloads (PDF, DOCX, DOC, PPTX, PPT, XLSX, XLS, RTF, ODT, ODP, ODS, EPUB) with automatic content-type detection.

Deployed on [Render.com](https://render.com) (free tier).

## Requirements

- Node.js v24+

## Setup

```bash
npm install       # Also downloads curl-impersonate binaries (see below)
node setup.js     # Creates .env with defaults
```

## Run

```bash
npm run dev        # Development (hot-reload via nodemon)
npm start          # Production
npm test           # Run Jest test suite
npm run test:watch # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run lint       # ESLint
```

## Routes

| Route | Purpose |
|-------|---------|
| `/pxy/html?url=<URL>&js=0\|1&ukred=0\|1` | Proxy HTML with URL rewriting (query params) |
| `/pxy/html/<URL>` | Proxy HTML with URL rewriting (path) |
| `/pxy/resource/<URL>` | Stream static assets (CSS, JS, images, fonts) |
| `/pxy/auto/<URL>` | Auto-detect content type and serve accordingly |
| `/pxy/dl/<URL>` | Force download with tiered caching (rate-limited) |
| `/pxy/dl/hash/<key>` | Download a cached file by its SHA-256 hash key |
| `/api/cache?url=<URL>` | Cache API — ensure a file is cached and return JSON metadata |
| `GET /upload` | Upload form — manual file upload to cache (strict CIDR) |
| `POST /upload` | Upload handler — process file upload (strict CIDR) |
| `/ping` | Health check — renders request headers |

## Security

- **SSRF protection** — URL validation rejects private/internal IPs, loopback addresses, non-HTTP schemes, and `.local`/`.internal` TLDs.
- **CIDR allowlist** — Download cache writes and the `/api/cache` endpoint can be restricted to specific IPv4 ranges via `DL_ALLOWED_CIDRS`. Unset = allow all. Use `/32` for a single IP (e.g. `1.2.3.4/32`), or comma-separate multiple entries (`1.2.3.4/32,5.6.7.8/32`).
- **Strict CIDR (upload)** — The `/upload` endpoint uses strict CIDR gating: it is **blocked entirely** when `DL_ALLOWED_CIDRS` is not set. A valid allowlist is required to access the upload form and submit files.
- **Rate limiting** — `/pxy/dl` endpoints are rate-limited to 60 requests per minute per IP.
- **MIME validation** — The download and upload handlers reject non-document MIME types (415 response).

## Caching

Downloads use a tiered cache strategy:

1. **Local** — `.cache/` directory, SHA-256(normalized URL) + extension filenames. Fast but ephemeral on Render deploys.
2. **R2** — Cloudflare R2 bucket (optional, requires R2 env vars). Persistent across deploys. On R2 hit, the file is restored to local cache.
3. **Upstream** — Fresh fetch from the original URL. Saves to both tiers.

Cached files include `.meta` sidecar files storing the original source URL (for human-readable download filenames) and a `fileHash` (SHA-256 of file contents). ETag headers enable `304 Not Modified` responses for repeat requests.

Cached files via `/api/cache` can be served by hash key (`/pxy/dl/hash/<sha256>`), which is stable and linkable regardless of the original URL.

## Upload

The `/upload` endpoint provides a browser-based form for manually uploading document files to the proxy cache. It requires strict CIDR authorization (`DL_ALLOWED_CIDRS` must be configured and the client IP must be in the allowlist).

- **Allowed types**: Same whitelist as downloads (PDF, DOCX, DOC, PPTX, PPT, XLSX, XLS, RTF, ODT, ODP, ODS, EPUB)
- **Size limit**: Same `MAX_DOWNLOAD_SIZE` as downloads (default 10 MB)
- **Optional URL**: If a canonical URL is provided, the cache key is `SHA-256(normalized URL)` — identical to how `/api/cache` and `/pxy/dl` work, so the file is immediately servable from those routes. If omitted, the cache key is `SHA-256(file contents)`.
- **Always overwrites**: Manual upload always replaces existing cache entries for the same hash key.
- **R2 backup**: Uploaded files are backed up to R2 (if configured), same as fetched downloads.

## Upstream Fetch

HTML and resource requests use a rotating pool of browser user-agents to reduce upstream rate-limiting. The pool includes Chrome, Firefox, and Safari across Windows, macOS, and Linux.

### Cloudflare / Bot Protection Fallback

Both `/pxy/dl/` and `/api/cache` support a TLS fingerprint fallback via [curl-impersonate](https://github.com/lexiforest/curl-impersonate). If a normal fetch returns `403`, the request is retried using a real browser's TLS fingerprint (Chrome or Firefox), which bypasses Cloudflare Turnstile and similar bot-detection systems. If curl-impersonate also fails or is unavailable, the original 403 is returned cleanly.

For `/api/cache`, the fallback result is reported in the JSON response:

```json
{
  "fetchMethod": "curl-impersonate",
  "curlProfile": "chrome124"
}
```

### curl-impersonate setup

Binaries are downloaded automatically during `npm install` via `scripts/install-curl-impersonate.js` and stored in `./bin/` (gitignored).

On shared-IP environments (e.g. Render.com), the GitHub API rate limit is easily exhausted. Set `GITHUB_TOKEN` to a GitHub personal access token (classic, no scopes required) to authenticate the version-discovery API call:

```
GITHUB_TOKEN=ghp_...
```

Optional overrides:

| Variable | Purpose |
|----------|---------|
| `SKIP_CURL_IMPERSONATE=true` | Skip binary download entirely |
| `CURL_IMPERSONATE_VERSION=v1.5.2` | Pin to a specific release instead of latest |

## Error Pages

Upstream errors (403, 429, 404, 500, etc.) are rendered as themed error pages matching the site UI, clearly indicating the error came from the upstream website rather than the proxy itself.

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
| `GITHUB_TOKEN` | — | GitHub PAT for curl-impersonate binary download (needed on shared IPs like Render) |
| `SKIP_CURL_IMPERSONATE` | — | Set to `true` to skip curl-impersonate binary download |
| `CURL_IMPERSONATE_VERSION` | — | Pin curl-impersonate to a specific version tag (e.g. `v1.5.2`) |

## Testing

The test suite uses [Jest](https://jestjs.io/) for unit tests and [supertest](https://github.com/ladjs/supertest) for HTTP integration tests.

```
tests/
  setup.js                    — Test environment setup (silences logger)
  app.test.js                 — Integration tests (supertest)
  lib/
    content-types.test.js     — MIME type / extension utilities
    validate-url.test.js      — URL validation + SSRF protection
    cidr.test.js              — IPv4 CIDR allowlist logic
    html-rewriter.test.js     — JSDOM-based URL rewriting
```

### Unit Tests

**content-types** — `parseMime()`, `isDownloadable()`, `isHTML()`, `getExtensionForMime()`, `getMimeForExtension()`, and the `DOWNLOAD_TYPES` registry.

**validate-url** — SSRF-safe URL validation: accepted schemes, loopback/private IP rejection, internal TLD blocking, and malformed input handling.

**cidr** — Pure function tests for `ipToInt()` and `parseCidr()`, plus module-level behavior tests that verify the CIDR allowlist with different `DL_ALLOWED_CIDRS` configurations (unset = allow all, set = enforce ranges/literals including IPv4-mapped IPv6).

**html-rewriter** — URL rewriting for all element types: anchors, images, scripts, stylesheets, canonical links, forms, iframes, srcset, inline CSS `url()`, meta refresh, manifest removal, charset normalization, and full JS-disabled mode (script clearing, event handler stripping, `?js=0` propagation).

### Integration Tests

**app** — Smoke tests via supertest: static file serving, `/ping` health check, 404 handling, 400 responses for missing proxy URL parameters, and `X-Forwarded-For` trust proxy resolution through multiple hops.

## Architecture

See [CLAUDE.md](CLAUDE.md) for full architecture documentation and handler details.
