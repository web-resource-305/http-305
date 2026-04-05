/* eslint-disable no-console */
const fs = require("fs");
const path = ".env";

const envContent = `# HTTP-305 Environment Configuration

# Server
PORT=8080
LOG_LEVEL=debug
TRUST_PROXY=1

# Maximum download file size in bytes (default: 10MB)
# MAX_DOWNLOAD_SIZE=10485760

# Cloudflare R2 cache (optional - leave blank to disable)
# Get these from: https://dash.cloudflare.com/profile/api-tokens
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET_NAME=

# IP allowlist for cache writes and /upload (comma-separated CIDRs, e.g. 1.2.3.0/24,5.6.7.8/32)
# When set, only matching IPs can trigger download caching. Unset = allow all for /pxy/dl and /api/cache.
# The /upload endpoint requires this to be set — it is blocked entirely when unset.
DL_ALLOWED_CIDRS=127.0.0.1/32,::1
`;

if (!fs.existsSync(path)) {
  fs.writeFileSync(path, envContent, { flag: "wx" });
  console.log(".env file created successfully.");
} else {
  console.log(".env file already exists.");
}
