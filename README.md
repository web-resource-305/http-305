# HTTP 305

A "12 Foot Ladder" style HTTP proxy that fetches web pages and rewrites URLs to route through itself. Supports HTML rewriting, static resource streaming, and file downloads (PDF, DOCX, PPTX, XLSX, etc.) with automatic content-type detection.

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
| `/pxy/dl/<URL>` | Force download (PDF, DOCX, PPTX, XLSX, etc.) |
| `/ping` | Health check |

## Architecture

See [CLAUDE.md](CLAUDE.md) for full architecture documentation, handler details, and environment variables.
