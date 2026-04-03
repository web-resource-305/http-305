/* eslint-disable no-console */
/**
 * Postinstall script: downloads curl-impersonate binaries from the
 * lexiforest/curl-impersonate GitHub release into ./bin/.
 *
 * Uses GITHUB_TOKEN if set — required on shared-IP environments (e.g. Render)
 * where the unauthenticated GitHub API rate limit (60 req/h per IP) is shared
 * across all tenants and quickly exhausted.
 *
 * Skips when:
 *   - Not running on Linux
 *   - Binaries already present in ./bin/
 *   - SKIP_CURL_IMPERSONATE=true
 *
 * Version can be overridden with CURL_IMPERSONATE_VERSION env var.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = "lexiforest/curl-impersonate";
const BIN_DIR = path.join(__dirname, "..", "bin");
const WANTED_BINS = ["curl_chrome124", "curl_chrome120", "curl_firefox135", "curl_firefox133"];

const skip = (reason) => {
  console.log(`curl-impersonate install: skipping — ${reason}`);
  process.exit(0);
};

if (process.platform !== "linux") skip("not Linux");
if (process.env.SKIP_CURL_IMPERSONATE === "true") skip("SKIP_CURL_IMPERSONATE=true");
if (WANTED_BINS.every((b) => fs.existsSync(path.join(BIN_DIR, b)))) skip("all binaries already present");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const authHeaders = GITHUB_TOKEN
  ? { Authorization: `token ${GITHUB_TOKEN}` }
  : {};

if (!GITHUB_TOKEN) {
  console.warn("curl-impersonate install: GITHUB_TOKEN not set — GitHub API rate limit may apply");
}

/**
 * GET a URL, following redirects, returning the final response.
 * For binary downloads, set `binary: true` to collect a Buffer.
 */
const httpsGet = (url, extraHeaders = {}, binary = false) =>
  new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "http-305-build-script",
      "Accept": binary ? "application/octet-stream" : "application/json",
      ...authHeaders,
      ...extraHeaders,
    };
    https.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect — strip auth on cross-domain (e.g. GitHub → objects.githubusercontent.com)
        const nextHeaders = res.headers.location.startsWith("https://github.com") ? extraHeaders : {};
        return resolve(httpsGet(res.headers.location, nextHeaders, binary));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(binary ? Buffer.concat(chunks) : JSON.parse(Buffer.concat(chunks).toString())));
      res.on("error", reject);
    }).on("error", reject);
  });

const ARCH = process.arch === "x64" ? "x86_64" : "aarch64";

(async () => {
  try {
    // Discover version — use env override or query GitHub API
    let version = process.env.CURL_IMPERSONATE_VERSION;
    if (!version) {
      console.log(`curl-impersonate install: fetching latest release from ${REPO}...`);
      const release = await httpsGet(`https://api.github.com/repos/${REPO}/releases/latest`);
      version = release.tag_name; // e.g. "v0.8.0"
      console.log(`curl-impersonate install: latest version is ${version}`);
    } else {
      if (!version.startsWith("v")) version = `v${version}`;
      console.log(`curl-impersonate install: using pinned version ${version}`);
    }

    // Detect glibc vs musl
    let spec = "gnu";
    try {
      const ldd = execSync("ldd --version 2>&1 || true").toString();
      if (ldd.toLowerCase().includes("musl")) spec = "musl";
    } catch {}

    const tarball = `curl-impersonate-${version}.${ARCH}-linux-${spec}.tar.gz`;
    const downloadUrl = `https://github.com/${REPO}/releases/download/${version}/${tarball}`;

    console.log(`curl-impersonate install: downloading ${tarball}...`);
    const tarBuffer = await httpsGet(downloadUrl, {}, true);

    // Write to a temp file then extract
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const tmpTar = path.join(os.tmpdir(), tarball);
    fs.writeFileSync(tmpTar, tarBuffer);

    console.log("curl-impersonate install: extracting...");
    execSync(`tar -xzf ${tmpTar} -C ${BIN_DIR}`);
    fs.unlinkSync(tmpTar);

    let installed = 0;
    for (const bin of WANTED_BINS) {
      const binPath = path.join(BIN_DIR, bin);
      if (fs.existsSync(binPath)) {
        fs.chmodSync(binPath, 0o755);
        installed++;
      }
    }

    console.log(`curl-impersonate install: done — ${installed}/${WANTED_BINS.length} binaries ready in ./bin/`);
  } catch (err) {
    console.warn(`curl-impersonate install: failed — ${err.message}`);
    console.warn("curl-impersonate install: TLS fingerprint fallback will be disabled at runtime");
    try { fs.rmSync(path.join(os.tmpdir(), "*.tar.gz"), { force: true }); } catch {}
    process.exit(0); // non-fatal — don't break npm install
  }
})();
