const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const logger = require("../lib/logger");
const isValidUrl = require("../lib/validate-url");
const r2Cache = require("../lib/r2-cache");
const cidr = require("../lib/cidr");

const CACHE_DIR = path.join(__dirname, "..", ".cache");

const readMetadata = (cachePath) => {
  try {
    const metaPath = cachePath + ".meta";
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, "utf8"));
    }
  } catch (err) {
    logger.warn(`Failed to read metadata: ${err.message}`);
  }
  return null;
};

/**
 * Strict CIDR gate for delete — same logic as upload, renders delete-result on deny.
 */
const strictCidrGate = (req, res, next) => {
  if (!cidr.enabled) {
    logger.warn(`Delete CIDR deny: no allowlist configured (DL_ALLOWED_CIDRS not set). Client IP: ${req.ip}`);
    return res.status(403).render("delete-result", {
      layout: false,
      error: "Forbidden",
    });
  }
  if (!cidr.isAllowed(req.ip)) {
    logger.warn(`Delete CIDR deny: ${req.ip} not in allowlist`);
    return res.status(403).render("delete-result", {
      layout: false,
      error: "Forbidden",
    });
  }
  next();
};

/**
 * GET /delete — render the delete form.
 */
const formHandler = (req, res) => {
  res.render("delete", { layout: false });
};

/**
 * POST /delete — delete a cached file by hash or URL.
 */
const deleteHandler = async (req, res) => {
  const rawHash = req.body.hash ? req.body.hash.trim() : "";
  const rawUrl = req.body.url ? req.body.url.trim() : "";
  let hash;
  let inputUrl = null;

  // Determine hash from input
  if (rawHash) {
    if (!/^[a-f0-9]{64}$/i.test(rawHash)) {
      return res.status(400).render("delete-result", {
        layout: false,
        error: "Invalid hash",
        errorDetail: "Hash must be exactly 64 hexadecimal characters.",
      });
    }
    hash = rawHash.toLowerCase();
  } else if (rawUrl) {
    if (!isValidUrl(rawUrl)) {
      return res.status(400).render("delete-result", {
        layout: false,
        error: "Invalid URL",
        errorDetail: "The provided URL failed validation. It must be a public HTTP/HTTPS URL.",
      });
    }
    const normalized = new URL(rawUrl).href;
    hash = crypto.createHash("sha256").update(normalized).digest("hex");
    inputUrl = normalized;
  } else {
    return res.status(400).render("delete-result", {
      layout: false,
      error: "Nothing to delete",
      errorDetail: "Please provide a cache hash or a URL.",
    });
  }

  // Find matching local files
  let localFiles = [];
  try {
    if (fs.existsSync(CACHE_DIR)) {
      localFiles = fs.readdirSync(CACHE_DIR)
        .filter((f) => f.startsWith(hash) && !f.endsWith(".meta"));
    }
  } catch (err) {
    logger.warn(`Failed to scan cache dir: ${err.message}`);
  }

  // Read metadata before deleting
  let meta = null;
  if (localFiles.length > 0) {
    meta = readMetadata(path.join(CACHE_DIR, localFiles[0]));
  }

  // Delete local files + meta sidecars
  const deletedLocal = [];
  for (const file of localFiles) {
    try {
      const filePath = path.join(CACHE_DIR, file);
      fs.unlinkSync(filePath);
      deletedLocal.push(file);
      logger.info(`Deleted local cache: ${file}`);

      // Remove .meta sidecar
      const metaPath = filePath + ".meta";
      if (fs.existsSync(metaPath)) {
        fs.unlinkSync(metaPath);
        logger.info(`Deleted local meta: ${file}.meta`);
      }
    } catch (err) {
      logger.warn(`Failed to delete local file ${file}: ${err.message}`);
    }
  }

  // Delete from R2
  const deletedR2 = [];
  if (r2Cache.enabled) {
    // Use local filenames as R2 keys if available, otherwise list by prefix
    const r2Keys = localFiles.length > 0
      ? localFiles
      : await r2Cache.list(hash);

    for (const key of r2Keys) {
      const ok = await r2Cache.del(key);
      if (ok) deletedR2.push(key);
    }
  }

  const totalDeleted = deletedLocal.length + deletedR2.length;
  if (totalDeleted === 0) {
    return res.status(404).render("delete-result", {
      layout: false,
      error: "Not found",
      errorDetail: "No cached file matches this hash.",
    });
  }

  return res.render("delete-result", {
    layout: false,
    hash,
    sourceUrl: (meta && meta.sourceUrl) || inputUrl || null,
    originalName: meta && meta.originalName || null,
    localCount: deletedLocal.length,
    r2Count: deletedR2.length,
  });
};

module.exports = { strictCidrGate, formHandler, deleteHandler };
