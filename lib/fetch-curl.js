/**
 * @module fetch-curl
 * Fallback fetcher using cuimp (curl-impersonate) for Cloudflare-protected URLs.
 * Impersonates real browser TLS fingerprints (JA3/JA4) to bypass bot detection.
 *
 * Binaries are downloaded to ./bin/ at build time by scripts/install-curl-impersonate.js.
 * autoDownload is disabled — no GitHub API calls at runtime.
 */
const { createCuimpHttp } = require("cuimp");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const BIN_DIR = path.join(__dirname, "..", "bin");
const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT) || 10000;

const ALL_PROFILES = [
  { name: "chrome124", bin: "curl_chrome124", descriptor: { browser: "chrome", version: "124" } },
  { name: "chrome120", bin: "curl_chrome120", descriptor: { browser: "chrome", version: "120" } },
  { name: "firefox135", bin: "curl_firefox135", descriptor: { browser: "firefox", version: "135" } },
  { name: "firefox133", bin: "curl_firefox133", descriptor: { browser: "firefox", version: "133" } },
];

// Highest Chrome version available — used by callers to build matching user-agent strings
const LATEST_CHROME_VERSION = "124";

// Only include profiles whose binary is actually present in ./bin/
const availableProfiles = ALL_PROFILES.filter((p) =>
  fs.existsSync(path.join(BIN_DIR, p.bin))
);

const enabled = availableProfiles.length > 0;

if (enabled) {
  logger.info(`curl-impersonate ready: ${availableProfiles.map((p) => p.name).join(", ")}`);
} else {
  logger.info("curl-impersonate not available — TLS fingerprint fallback disabled (binaries not found in ./bin/)");
}

/**
 * Fetch a URL using cuimp (curl-impersonate) with a random available browser profile.
 * Returns a minimal fetch-Response-compatible object.
 * HTTP error responses (4xx/5xx) are returned normally; network errors throw.
 *
 * @param {string} url - Absolute URL to fetch
 * @param {string} [userAgent] - Optional User-Agent header override
 * @returns {Promise<{ok, status, statusText, profile, headers: {get}, arrayBuffer}>}
 * @throws {{ status: number, message: string }} on network/spawn failure
 */
const fetchWithCurl = async (url, userAgent) => {
  if (!enabled) {
    const err = new Error("curl-impersonate is not available");
    err.status = 502;
    throw err;
  }

  const profile = availableProfiles[Math.floor(Math.random() * availableProfiles.length)];
  const binaryPath = path.join(BIN_DIR, profile.bin);

  logger.debug(`curl-impersonate [${profile.name}]: ${url}`);

  const client = createCuimpHttp({
    descriptor: profile.descriptor,
    path: binaryPath,
    autoDownload: false,
  });

  const requestOptions = { timeout: FETCH_TIMEOUT };
  if (userAgent) {
    requestOptions.headers = { "User-Agent": userAgent };
  }

  let cuimpRes;
  try {
    cuimpRes = await client.get(url, requestOptions);
  } catch (cuimpErr) {
    const err = new Error(`curl-impersonate failed: ${cuimpErr.message}`);
    err.status = 502;
    throw err;
  }

  const buf = cuimpRes.rawBody;

  return {
    ok: cuimpRes.status >= 200 && cuimpRes.status < 300,
    status: cuimpRes.status,
    statusText: cuimpRes.statusText,
    profile: profile.name,
    url, // original URL (curl-impersonate does not expose the post-redirect URL)
    headers: {
      get: (name) => {
        const key = name.toLowerCase();
        return cuimpRes.headers[key] ?? cuimpRes.headers[name] ?? null;
      },
    },
    text: () => Promise.resolve(buf.toString("utf-8")),
    arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(buf));
        controller.close();
      },
    }),
  };
};

module.exports = { enabled, fetchWithCurl, LATEST_CHROME_VERSION };
