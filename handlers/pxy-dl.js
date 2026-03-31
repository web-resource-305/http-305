const crypto = require("crypto");
const fs = require("fs");
const logger = require("../lib/logger");
const fetchUrl = require("../lib/fetch-url");
const isValidUrl = require("../lib/validate-url");
const path = require("path");
const { parseMime, getExtensionForMime, getMimeForExtension } = require("../lib/content-types");
const r2Cache = require("../lib/r2-cache");

const CACHE_DIR = path.join(__dirname, "..", ".cache");
const MAX_DOWNLOAD_SIZE = Number(process.env.MAX_DOWNLOAD_SIZE) || 10 * 1024 * 1024;

const ensureCacheDir = () => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
};

const getCachePath = (url, ext) => {
  const normalized = new URL(url).href;
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");
  return path.join(CACHE_DIR, `${hash}${ext}`);
};

const getR2Key = (cachePath) => path.basename(cachePath);

/**
 * Atomically write a buffer to the local cache directory.
 */
const writeToLocalCache = (cachePath, buffer) => {
  ensureCacheDir();
  const tmpPath = cachePath + ".tmp";
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, cachePath);
};

const resolveDownloadMime = (url, responseMime) => {
  // Prefer the upstream Content-Type if it maps to a known download type
  const ext = getExtensionForMime(responseMime);
  if (ext) return { mime: responseMime, ext };

  // Fall back to extension from URL path
  const urlExt = path.extname(new URL(url).pathname).toLowerCase();
  if (urlExt) {
    const mimeFromExt = getMimeForExtension(urlExt);
    const extCheck = getExtensionForMime(mimeFromExt);
    if (extCheck) return { mime: mimeFromExt, ext: extCheck };
  }

  // Default to octet-stream
  return { mime: "application/octet-stream", ext: "" };
};

/**
 * Serve a download using tiered cache: local .cache/ → R2 → upstream.
 * Can be called directly by pxy-auto to avoid re-fetching.
 */
const serveDownload = async (res, url, response, detectedMime) => {
  const { mime, ext } = resolveDownloadMime(url, detectedMime);
  const cachePath = getCachePath(url, ext);
  const r2Key = getR2Key(cachePath);
  let fileBuffer;

  if (fs.existsSync(cachePath)) {
    // Tier 1: Local cache hit
    logger.info(`Local cache hit for: ${url}`);
    if (!res.getHeader("X-Cache")) {
      const stat = fs.statSync(cachePath);
      res.setHeader("X-Cache", "local");
      res.setHeader("X-Cached-At", stat.mtime.toISOString());
    }
  } else if (r2Cache.enabled) {
    // Tier 2: Try R2 before consuming upstream response
    try {
      const r2Result = await r2Cache.get(r2Key);
      if (r2Result) {
        logger.info(`R2 cache hit for: ${url}`);
        fileBuffer = r2Result.buffer;
        res.setHeader("X-Cache", "r2");
        if (r2Result.metadata["x-cached-at"]) {
          res.setHeader("X-Cached-At", r2Result.metadata["x-cached-at"]);
        }

        // Restore to local cache
        try {
          writeToLocalCache(cachePath, fileBuffer);
          logger.info(`Restored from R2 to local cache: ${cachePath}`);
        } catch (restoreErr) {
          logger.warn(`Failed to restore to local cache: ${restoreErr.message}`);
        }
      }
    } catch (r2Err) {
      logger.warn(`R2 retrieval failed, falling through to upstream: ${r2Err.message}`);
    }
  }

  // Tier 3: Upstream fetch (if no cache hit from either tier)
  if (!fileBuffer && !fs.existsSync(cachePath)) {
    const contentLength = Number(response.headers.get("content-length"));
    if (contentLength && contentLength > MAX_DOWNLOAD_SIZE) {
      logger.warn(`File too large (${contentLength} bytes): ${url}`);
      return res.status(413).send("File exceeds maximum download size");
    }

    logger.info(`Cache miss, fetching: ${url}`);
    fileBuffer = Buffer.from(await response.arrayBuffer());
    const cachedAt = new Date().toISOString();
    res.setHeader("X-Cache", "miss");
    res.setHeader("X-Cached-At", cachedAt);

    try {
      writeToLocalCache(cachePath, fileBuffer);
      logger.info(`Cached file: ${cachePath}`);
    } catch (cacheErr) {
      logger.warn(`Failed to cache file: ${cacheErr.message}`);
    }

    // Fire-and-forget R2 upload
    if (r2Cache.enabled) {
      r2Cache
        .put(r2Key, fileBuffer, {
          "x-source-url": url,
          "x-cached-at": cachedAt,
          "x-mime": mime,
        })
        .catch(() => {});
    }
  }

  // Extract and sanitize filename
  const parsedUrl = new URL(url);
  let filename = path.basename(parsedUrl.pathname) || `downloaded-file${ext}`;
  const currentExt = path.extname(filename).toLowerCase();
  if (ext && currentExt !== ext) {
    filename += ext;
  }
  filename = filename.replace(/[^\w.\-]/g, "_");

  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  if (fileBuffer) {
    res.setHeader("Content-Length", fileBuffer.length);
    return res.end(fileBuffer);
  } else {
    const stat = fs.statSync(cachePath);
    res.setHeader("Content-Length", stat.size);
    const readStream = fs.createReadStream(cachePath);
    readStream.on("error", (err) => {
      logger.error("Cache read error:", err);
      if (!res.headersSent) {
        res.status(500).send("Internal Server Error");
      }
    });
    return readStream.pipe(res);
  }
};

/**
 * Route handler for /pxy/dl/* — fetches and serves as download.
 */
const handler = async (req, res, urlToDownload) => {
  if (!urlToDownload) {
    logger.warn("Request missing URL parameter");
    return res.status(400).send("URL parameter is required");
  }

  try {
    urlToDownload = decodeURIComponent(urlToDownload);
  } catch (e) {
    logger.error("Error decoding resource URL:", e);
    return res.status(400).send("Invalid resource URL encoding");
  }

  if (!isValidUrl(urlToDownload)) {
    logger.error(`Invalid download URL provided: ${urlToDownload}`);
    return res.status(400).send("Invalid download URL");
  }

  const parsedUrl = new URL(urlToDownload);

  try {
    // Check cache first using URL extension as hint
    const urlExt = path.extname(parsedUrl.pathname).toLowerCase();
    const hintMime = getMimeForExtension(urlExt);
    const hintExt = getExtensionForMime(hintMime);
    const cachePath = hintExt ? getCachePath(urlToDownload, hintExt) : null;

    if (cachePath && fs.existsSync(cachePath)) {
      // Tier 1: Serve from local cache without fetching
      return await serveDownload(res, urlToDownload, null, hintMime);
    }

    // Tier 2: Check R2 before fetching upstream (avoids slow upstream fetch)
    if (cachePath && r2Cache.enabled) {
      try {
        const r2Result = await r2Cache.get(getR2Key(cachePath));
        if (r2Result) {
          try {
            writeToLocalCache(cachePath, r2Result.buffer);
            logger.info(`R2 early restore: ${cachePath}`);
          } catch (restoreErr) {
            logger.warn(`R2 early restore failed: ${restoreErr.message}`);
          }
          res.setHeader("X-Cache", "r2");
          if (r2Result.metadata["x-cached-at"]) {
            res.setHeader("X-Cached-At", r2Result.metadata["x-cached-at"]);
          }
          return await serveDownload(res, urlToDownload, null, hintMime);
        }
      } catch (r2Err) {
        logger.warn(`R2 early check failed: ${r2Err.message}`);
      }
    }

    const response = await fetchUrl(parsedUrl.href);

    if (!response.ok) {
      logger.error(`Failed to fetch URL: ${urlToDownload}, Status: ${response.status}`);
      return res
        .status(response.status)
        .send(`Failed to fetch URL: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    const mime = parseMime(contentType) || hintMime;

    return await serveDownload(res, urlToDownload, response, mime);
  } catch (error) {
    logger.error("Error fetching or streaming download:", error);
    if (!res.headersSent) {
      res.status(error.status || 500)
        .send(error.status ? error.message : "Internal Server Error");
    }
    return;
  }
};

module.exports = handler;
module.exports.serveDownload = serveDownload;
