/**
 * @module fetch-curl
 * Fallback fetcher using curl-impersonate for Cloudflare-protected URLs.
 * Impersonates real browser TLS fingerprints (JA3/JA4) to bypass bot detection.
 *
 * curl-impersonate uses separate per-browser binaries (curl_chrome124, curl_ff120, etc.)
 * installed into ./bin/ by scripts/install-curl-impersonate.js at build time.
 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const logger = require("./logger");

const BIN_DIR = path.join(__dirname, "..", "bin");
const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT) || 10000;

// Per-browser binaries — each impersonates a specific browser at the TLS level
const PROFILES = [
  { name: "chrome124", bin: "curl_chrome124" },
  { name: "chrome123", bin: "curl_chrome123" },
  { name: "firefox120", bin: "curl_ff120" },
  { name: "firefox117", bin: "curl_ff117" },
  { name: "safari17_0", bin: "curl_safari17_0" },
];

/**
 * Resolve the full path for a binary: checks ./bin/ first, then PATH.
 * @param {string} bin - Binary filename
 * @returns {string|null} Resolved path or null if not found
 */
const resolveBin = (bin) => {
  const local = path.join(BIN_DIR, bin);
  if (fs.existsSync(local)) return local;
  try {
    execSync(`which ${bin}`, { stdio: "ignore" });
    return bin;
  } catch {
    return null;
  }
};

// Resolve available profiles at startup
const availableProfiles = PROFILES
  .map((p) => ({ ...p, path: resolveBin(p.bin) }))
  .filter((p) => p.path !== null);

const enabled = availableProfiles.length > 0;

if (enabled) {
  logger.info(`curl-impersonate ready: ${availableProfiles.map((p) => p.name).join(", ")}`);
} else {
  logger.info("curl-impersonate not found in ./bin/ or PATH — TLS fingerprint fallback disabled");
}

/**
 * Fetch a URL using curl-impersonate with a random available browser profile.
 * Returns a minimal fetch-Response-compatible object.
 *
 * @param {string} url - Absolute URL to fetch
 * @returns {Promise<{ok, status, statusText, profile, headers: {get}, arrayBuffer}>}
 * @throws {{ status: number, message: string }} on spawn/read failure
 */
const fetchWithCurl = (url) => {
  if (!enabled) {
    const err = new Error("curl-impersonate is not available");
    err.status = 502;
    return Promise.reject(err);
  }

  const profile = availableProfiles[Math.floor(Math.random() * availableProfiles.length)];
  const tmpFile = path.join(
    os.tmpdir(),
    `pxy-curl-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const timeoutSec = Math.max(1, Math.ceil(FETCH_TIMEOUT / 1000));

  // Write-out format: status\ncontentType\ndownloadSize — written to stdout
  // Body goes to tmpFile via -o, keeping stdout clean for write-out parsing
  const args = [
    "-s",
    "-L",
    "--max-time", String(timeoutSec),
    "-w", "%{http_code}\n%{content_type}\n%{size_download}",
    "-o", tmpFile,
    url,
  ];

  logger.debug(`curl-impersonate [${profile.name}]: ${url}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(profile.path, args);
    let stdout = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });

    proc.on("error", (spawnErr) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      const err = new Error(`Failed to spawn ${profile.bin}: ${spawnErr.message}`);
      err.status = 502;
      reject(err);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        try { fs.unlinkSync(tmpFile); } catch {}
        const err = new Error(`${profile.bin} exited with code ${code}`);
        err.status = 502;
        return reject(err);
      }

      // Parse write-out lines: http_code\ncontent_type\nsize_download
      const lines = stdout.trim().split("\n");
      const httpCode = parseInt(lines[0], 10) || 0;
      const contentType = (lines[1] || "").trim() || null;
      const sizeDownload = parseInt(lines[2], 10) || null;

      let body;
      try {
        body = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);
      } catch (readErr) {
        const err = new Error(`Failed to read curl-impersonate output: ${readErr.message}`);
        err.status = 502;
        return reject(err);
      }

      const STATUS_TEXTS = {
        200: "OK", 201: "Created", 204: "No Content",
        301: "Moved Permanently", 302: "Found", 304: "Not Modified",
        400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
        404: "Not Found", 410: "Gone", 429: "Too Many Requests",
        500: "Internal Server Error", 502: "Bad Gateway",
        503: "Service Unavailable", 504: "Gateway Timeout",
      };

      resolve({
        ok: httpCode >= 200 && httpCode < 300,
        status: httpCode,
        statusText: STATUS_TEXTS[httpCode] || String(httpCode),
        profile: profile.name,
        headers: {
          get: (name) => {
            switch (name.toLowerCase()) {
              case "content-type": return contentType;
              case "content-length": return sizeDownload !== null ? String(sizeDownload) : null;
              default: return null;
            }
          },
        },
        arrayBuffer: () =>
          Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
      });
    });
  });
};

module.exports = { enabled, fetchWithCurl };
