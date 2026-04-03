/**
 * @module fetch-curl
 * Fallback fetcher using cuimp (curl-impersonate) for Cloudflare-protected URLs.
 * Impersonates real browser TLS fingerprints (JA3/JA4) to bypass bot detection.
 * Binaries are managed automatically by cuimp (~/.cuimp/binaries/).
 */
const { get: cuimpGet, downloadBinary } = require("cuimp");
const logger = require("./logger");

const PROFILES = [
  { name: "chrome124", descriptor: { browser: "chrome", version: "124" } },
  { name: "chrome131", descriptor: { browser: "chrome", version: "131" } },
  { name: "firefox135", descriptor: { browser: "firefox", version: "135" } },
  { name: "chrome120", descriptor: { browser: "chrome", version: "120" } },
];

const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT) || 10000;

// Pre-download a binary in the background so it's ready before the first request needs it
downloadBinary({ descriptor: PROFILES[0].descriptor })
  .then(() => logger.info(`curl-impersonate ready (cuimp — ${PROFILES[0].name})`))
  .catch((err) => logger.warn(`curl-impersonate pre-download failed: ${err.message}`));

const enabled = true;

/**
 * Fetch a URL using cuimp (curl-impersonate) with a random browser TLS profile.
 * Returns a minimal fetch-Response-compatible object.
 * HTTP error responses (4xx/5xx) are returned as-is; network errors throw.
 *
 * @param {string} url - Absolute URL to fetch
 * @returns {Promise<{ok, status, statusText, profile, headers: {get}, arrayBuffer}>}
 * @throws {{ status: number, message: string }} on network/spawn failure
 */
const fetchWithCurl = async (url) => {
  const profile = PROFILES[Math.floor(Math.random() * PROFILES.length)];

  logger.debug(`curl-impersonate [${profile.name}]: ${url}`);

  let cuimpRes;
  try {
    cuimpRes = await cuimpGet(url, {
      descriptor: profile.descriptor,
      timeout: FETCH_TIMEOUT,
    });
  } catch (cuimpErr) {
    const err = new Error(`curl-impersonate failed: ${cuimpErr.message}`);
    err.status = 502;
    throw err;
  }

  return {
    ok: cuimpRes.status >= 200 && cuimpRes.status < 300,
    status: cuimpRes.status,
    statusText: cuimpRes.statusText,
    profile: profile.name,
    headers: {
      get: (name) => {
        const key = name.toLowerCase();
        return cuimpRes.headers[key] ?? cuimpRes.headers[name] ?? null;
      },
    },
    arrayBuffer: () => {
      const buf = cuimpRes.rawBody;
      return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    },
  };
};

module.exports = { enabled, fetchWithCurl };
