/* eslint-disable no-console */
/**
 * Postinstall script: downloads curl-impersonate binaries from GitHub Releases
 * into ./bin/ for use by lib/fetch-curl.js.
 *
 * Skips automatically when:
 *   - Not running on Linux (dev machines)
 *   - Binaries are already present
 *   - SKIP_CURL_IMPERSONATE=true is set
 *
 * Version can be overridden with CURL_IMPERSONATE_VERSION env var.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const VERSION = process.env.CURL_IMPERSONATE_VERSION || "0.6.1";
const BIN_DIR = path.join(__dirname, "..", "bin");

// Binaries we want from the chrome tarball
const WANTED_BINS = [
  "curl_chrome123",
  "curl_chrome124",
  "curl_ff117",
  "curl_ff120",
  "curl_safari17_0",
];

const alreadyInstalled = () =>
  WANTED_BINS.some((bin) => fs.existsSync(path.join(BIN_DIR, bin)));

const skip = (reason) => {
  console.log(`curl-impersonate install: skipping — ${reason}`);
  process.exit(0);
};

if (process.platform !== "linux") skip("not Linux");
if (process.env.SKIP_CURL_IMPERSONATE === "true") skip("SKIP_CURL_IMPERSONATE=true");
if (alreadyInstalled()) skip("binaries already present in ./bin/");

fs.mkdirSync(BIN_DIR, { recursive: true });

const ARCH = process.arch === "x64" ? "x86_64" : process.arch;
const TARBALL = `curl-impersonate-chrome.${ARCH}-linux-gnu.tar.gz`;
const URL = `https://github.com/lwthiker/curl-impersonate/releases/download/v${VERSION}/${TARBALL}`;
const TMP_TAR = path.join(BIN_DIR, TARBALL);

console.log(`curl-impersonate install: downloading v${VERSION} (${ARCH}) from GitHub...`);

const download = (url, dest, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many redirects"));
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return resolve(download(res.headers.location, dest, redirectCount + 1));
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    }).on("error", reject);
  });

download(URL, TMP_TAR)
  .then(() => {
    console.log(`curl-impersonate install: extracting...`);
    execSync(`tar -xzf ${TMP_TAR} -C ${BIN_DIR}`);
    fs.unlinkSync(TMP_TAR);

    let installed = 0;
    for (const bin of WANTED_BINS) {
      const binPath = path.join(BIN_DIR, bin);
      if (fs.existsSync(binPath)) {
        fs.chmodSync(binPath, 0o755);
        installed++;
      }
    }
    console.log(`curl-impersonate install: done — ${installed}/${WANTED_BINS.length} binaries ready in ./bin/`);
  })
  .catch((err) => {
    // Non-fatal: log and continue. The proxy works without curl-impersonate.
    console.warn(`curl-impersonate install: failed — ${err.message}`);
    console.warn("curl-impersonate install: TLS fingerprint fallback will be disabled at runtime");
    try { if (fs.existsSync(TMP_TAR)) fs.unlinkSync(TMP_TAR); } catch {}
    process.exit(0); // exit 0 so npm install doesn't fail
  });
