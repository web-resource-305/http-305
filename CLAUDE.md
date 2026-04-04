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
npm test           # Run Jest test suite
npm run test:watch # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm install        # Install/update dependencies + download curl-impersonate binaries
```

## Architecture

### Request Flow

All proxying starts in `app.js` which defines routes and delegates to handlers:

```
GET /pxy/html?url=<URL>&js=0|1&ukred=0|1  →  handlers/pxy-html.js
GET /pxy/html/<URL>                        →  handlers/pxy-html.js
GET /pxy/resource/<URL>                    →  handlers/pxy-resource.js
GET /pxy/auto/<URL>                        →  handlers/pxy-auto.js
GET /pxy/dl/<URL>                          →  handlers/pxy-dl.js
GET /pxy/dl/hash/<key>                     →  handlers/pxy-dl.js (hashHandler)
GET /api/cache?url=<URL>                   →  handlers/pxy-dl.js (cacheHandler)
GET /upload                                →  handlers/upload.js (formHandler)
POST /upload                               →  handlers/upload.js (uploadHandler)
GET /delete                                →  handlers/delete.js (formHandler)
POST /delete                               →  handlers/delete.js (deleteHandler)
GET /ping                                  →  inline (renders views/headers.hbs)
GET /pxy                                   →  inline (returns 305 status info)
```

### HTML Proxy Pipeline (`handlers/pxy-html.js`)

The core of the project. For each proxied HTML request:
1. Fetches the target URL via `lib/fetch-url.js` (rotating user-agents)
2. Delegates to `lib/html-rewriter.js` which parses HTML with JSDOM and rewrites all URLs in the DOM:
   - `<img src>`, `<link href>`, `<script src>` → `/pxy/resource/<encoded-url>`
   - `<a href>`, `<iframe src>` → `/pxy/auto/<encoded-url>` (server-side content-type detection)
   - `<link rel="canonical">` → `/pxy/auto/<encoded-url>` (preserves correct share URL on mobile)
   - `<form action>` → left as absolute URL (forms bypass the proxy)
3. Returns the modified HTML

Upstream errors (non-2xx) are rendered as a themed error page (`views/upstream-error.hbs`) that clearly indicates the error came from the upstream site, not the proxy.

**Query params:**
- `js=0` — strips all `<script>` tags; `<a>` links get `?js=0` appended for propagation
- `ukred=1` — if `CF-IPCountry` header is `GB`, redirect directly to the target URL instead of proxying

### Auto-Detection Proxy (`handlers/pxy-auto.js`)

Fetches the upstream URL, inspects the `Content-Type` response header, and routes automatically:
- `text/html` → rewrites URLs (same as pxy-html) and returns modified HTML
- Downloadable types (PDF, DOCX, PPTX, XLSX, etc.) → redirects to `/pxy/dl/` for cached download
- Everything else → streams directly with upstream Content-Type

Upstream errors render the themed `upstream-error` view.

### Resource Proxy (`handlers/pxy-resource.js`)

Streams static assets (CSS, JS, images, fonts, etc.) with MIME types from `lib/content-types.js`. No DOM manipulation — pure pass-through stream.

### Download Proxy (`handlers/pxy-dl.js`)

Fetches downloadable files (PDF, DOCX, DOC, PPTX, PPT, XLSX, XLS) and serves them as `Content-Disposition: attachment`. Uses a tiered cache strategy with `X-Cache` and `X-Cached-At` response headers:

- **Tier 1 (Local)**: `.cache/` directory, SHA256(url)+extension filenames. Fastest, but ephemeral on Render deploys.
- **Tier 2 (R2)**: Cloudflare R2 bucket via `lib/r2-cache.js`, same key naming. Persistent across deploys. Optional — requires R2 env vars.
- **Tier 3 (Upstream)**: Fresh fetch from the original URL. Saves to both tiers.

On R2 hit, the file is restored to local cache for future fast access.

**Cloudflare / bot-protection fallback**: On a `403` from the upstream fetch, both `/pxy/dl/` and `/api/cache` retry once using `lib/fetch-curl.js` (curl-impersonate with a random Chrome/Firefox TLS fingerprint). If curl-impersonate is unavailable or also fails, the original 403 is returned cleanly. The `/api/cache` JSON response includes `fetchMethod` and `curlProfile` fields to indicate which method was used.

**Cache API** (`/api/cache`): CIDR-gated endpoint that primes the cache and returns JSON metadata (hash, mime, size, URLs) rather than streaming the file. Intended for server-side pre-caching. Cached files can then be served via `/pxy/dl/hash/<sha256>` with no upstream fetch.

### Upload (`handlers/upload.js`)

Manual file upload to the proxy cache via a browser form. Uses **strict CIDR gating** — the endpoint is blocked entirely when `DL_ALLOWED_CIDRS` is not configured (unlike download endpoints which allow all when unset). Requires `multer` for multipart form parsing.

- Accepts files restricted to the `DOWNLOAD_TYPES` whitelist and `MAX_DOWNLOAD_SIZE` limit
- Optional canonical URL field: if provided, the cache key is `SHA256(normalized URL)` (same as `getCachePath` in pxy-dl), making the file immediately servable via `/pxy/dl/<URL>`. If omitted, the cache key is `SHA256(file contents)`.
- Always overwrites existing cache entries (manual upload = intentional replacement)
- Writes to local cache + R2, stores `fileHash` (content SHA256) in `.meta` sidecar
- Returns a styled HTML result page with hash, permalink, and file details

All cache writes across the project (upload, download, cache API) now include a `fileHash` field in `.meta` sidecar files — the SHA256 of the file content, distinct from the URL-based cache key.

### Delete (`handlers/delete.js`)

Manual cache entry deletion via a browser form. Uses **strict CIDR gating** — same as upload, blocked when `DL_ALLOWED_CIDRS` is not configured.

- Accepts a SHA256 hash directly, or a URL to hash (same normalization as `getCachePath`)
- If hash is provided, it takes priority over URL
- Scans local `.cache/` directory for matching files (glob by hash prefix)
- Deletes matching files + `.meta` sidecars from local cache
- Deletes matching objects from R2 (discovers keys via local filenames or R2 prefix listing)
- Returns a styled result page showing what was deleted and metadata from the `.meta` sidecar

### Shared Libraries

- `lib/content-types.js` — single source of truth for MIME type ↔ extension mappings (both resource and download types)
- `lib/html-rewriter.js` — JSDOM-based URL rewriting, shared by `pxy-html` and `pxy-auto`
- `lib/fetch-url.js` — upstream fetch wrapper with rotating browser user-agents and network error → HTTP status mapping
- `lib/fetch-curl.js` — curl-impersonate fallback fetcher; uses binaries in `./bin/` downloaded at build time; exports `enabled` flag and `fetchWithCurl(url)`
- `lib/r2-cache.js` — optional R2 backup cache layer, active only when `R2_ACCESS_KEY_ID` is set; exports `put`, `get`, `del`, `list`
- `lib/cidr.js` — IPv4 CIDR allowlist checker for download endpoints

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
| `DL_ALLOWED_CIDRS` | (none) | Comma-separated IPv4 CIDRs allowed to write to the download cache (unset = allow all) |
| `GITHUB_TOKEN` | (none) | GitHub PAT (no scopes needed) for curl-impersonate binary download — required on shared-IP hosts like Render where the unauthenticated GitHub API rate limit is quickly exhausted |
| `SKIP_CURL_IMPERSONATE` | (none) | Set to `true` to skip curl-impersonate binary download entirely |
| `CURL_IMPERSONATE_VERSION` | (none) | Pin curl-impersonate to a specific release tag (e.g. `v1.5.2`) instead of fetching latest |

## Testing

Jest test suite with supertest for integration tests. Tests live in `tests/` mirroring the source tree. Run `npm test` before committing.

### Test Structure

```
tests/
  setup.js                    — Sets LOG_LEVEL=error to silence Winston during tests
  app.test.js                 — Integration tests (supertest)
  lib/
    content-types.test.js     — Unit tests for MIME/extension utilities
    validate-url.test.js      — Unit tests for URL validation + SSRF protection
    cidr.test.js              — Unit tests for CIDR allowlist logic
    html-rewriter.test.js     — Unit tests for JSDOM-based URL rewriting
```

### What Each Test File Covers

**`tests/lib/content-types.test.js`** — Tests all 6 exports from `lib/content-types.js`:
- `DOWNLOAD_TYPES` registry shape and key entries
- `parseMime()` — Content-Type header parsing, charset stripping, null/empty handling
- `isDownloadable()` — download MIME detection with and without params
- `isHTML()` — HTML MIME detection
- `getExtensionForMime()` — MIME to extension mapping for download types
- `getMimeForExtension()` — extension to MIME mapping (resource + download types), case insensitivity, fallback to octet-stream

**`tests/lib/validate-url.test.js`** — Tests the SSRF-safe URL validator:
- Valid URLs (http/https with paths, ports, query strings, fragments)
- Rejected schemes (ftp, javascript, data, file)
- Loopback protection (localhost, 127.0.0.1, [::1], 0.0.0.0)
- Private range protection (10.x, 172.16.x, 192.168.x, 169.254.x AWS metadata)
- Internal TLD protection (.local, .internal)
- Malformed input (null, undefined, empty string, plain text)

**`tests/lib/cidr.test.js`** — Tests `lib/cidr.js` pure functions and module-level behavior:
- `ipToInt()` — IPv4 parsing, ::ffff: prefix stripping, invalid input rejection
- `parseCidr()` — CIDR notation parsing, /0 to /32, bare IP as /32, host bit masking
- Module with `DL_ALLOWED_CIDRS` unset — `enabled` is false, `isAllowed()` permits all
- Module with `DL_ALLOWED_CIDRS` set — CIDR range matching, /32 exact match, IPv6 literal match, IPv4-mapped IPv6 handling, null/empty rejection
- Uses `jest.resetModules()` to re-require the module with different env var states

**`tests/lib/html-rewriter.test.js`** — Tests `lib/html-rewriter.js` URL rewriting:
- `rewriteCSSUrls()` — relative/absolute `url()` rewriting, data: URL skipping, quote preservation
- `rewriteHTML()` anchors — proxied through `/pxy/`, relative URL resolution, `?js=0` propagation, skip mailto/javascript/tel/fragment
- `rewriteHTML()` images — proxied through `/pxy/resource/`, relative src resolution
- `rewriteHTML()` scripts — proxied through `/pxy/resource/`, cleared when JS disabled
- `rewriteHTML()` stylesheets — link[href] proxied through `/pxy/resource/`
- `rewriteHTML()` canonical links — proxied through `/pxy/` (navigable, not resource)
- `rewriteHTML()` forms — action resolved to absolute but not proxied
- `rewriteHTML()` iframes — proxied through `/pxy/` (navigable)
- `rewriteHTML()` srcset — all entries rewritten with descriptors preserved
- `rewriteHTML()` inline styles — `url()` in `<style>` elements rewritten
- `rewriteHTML()` meta refresh — redirect URL proxied
- `rewriteHTML()` manifest removal — `<link rel="manifest">` stripped
- `rewriteHTML()` charset — forced to utf-8
- `rewriteHTML()` JS disabled mode — event handlers removed, inline script content cleared

**`tests/app.test.js`** — Integration tests using supertest against the Express app:
- `GET /` returns 200 and serves index.html
- `GET /ping` returns 200
- `GET /nonexistent` returns 404
- `GET /pxy/html`, `/pxy/resource/`, `/pxy/dl/` without URL return 400
- Trust proxy: `X-Forwarded-For` with multiple hops resolves to the real client IP

### Configuration

- `jest.config.js` — test matching, Node environment, setup file, coverage config
- `tests/setup.js` — sets `LOG_LEVEL=error` before any module loads (silences Winston)
- `eslint.config.js` — includes Jest globals (`describe`, `test`, `expect`, etc.) for test files
- `app.js` — exports the Express app; `app.listen()` is guarded behind `require.main === module` so tests can import without starting the server

### Writing New Tests

- Pure-function libs (no I/O): test directly, no mocking needed
- Modules reading env vars at require-time (e.g. `cidr.js`): use `jest.resetModules()` + fresh `require()` in `beforeEach`
- Integration tests: use `supertest` with the exported `app`
- Follow existing style: `describe` blocks per function/feature, `test` per case

## Code Style

ESLint enforces: semicolons required, double quotes, 2-space indentation. Prettier is integrated. Run `npm run lint` before committing.
