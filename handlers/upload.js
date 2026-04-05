const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const logger = require("../lib/logger");
const isValidUrl = require("../lib/validate-url");
const { DOWNLOAD_TYPES, getExtensionForMime, getMimeForExtension } = require("../lib/content-types");
const r2Cache = require("../lib/r2-cache");
const cidr = require("../lib/cidr");

const CACHE_DIR = path.join(__dirname, "..", ".cache");
const MAX_DOWNLOAD_SIZE = Number(process.env.MAX_DOWNLOAD_SIZE) || 15 * 1024 * 1024;

// Build accept list from DOWNLOAD_TYPES for the form and for validation
const ALLOWED_MIMES = new Set(Object.keys(DOWNLOAD_TYPES));
const ALLOWED_EXTENSIONS = Object.values(DOWNLOAD_TYPES);

const ensureCacheDir = () => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
};

const writeToLocalCache = (cachePath, buffer) => {
  ensureCacheDir();
  const tmpPath = cachePath + ".tmp";
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, cachePath);
};

const writeMetadata = (cachePath, metadata) => {
  try {
    fs.writeFileSync(cachePath + ".meta", JSON.stringify(metadata));
  } catch (err) {
    logger.warn(`Failed to write metadata: ${err.message}`);
  }
};

/**
 * Multer configuration: store in memory (buffer), enforce size limit.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOWNLOAD_SIZE },
});

/**
 * Strict CIDR gate — blocks when no allowlist is configured OR when
 * the client IP is not in the allowlist. This is intentionally stricter
 * than the download endpoints (which allow all when unset).
 */
const strictCidrGate = (req, res, next) => {
  if (!cidr.enabled) {
    logger.warn(`Upload CIDR deny: no allowlist configured (DL_ALLOWED_CIDRS not set). Client IP: ${req.ip}`);
    return res.status(403).render("upload-result", {
      layout: false,
      error: "Forbidden",
    });
  }
  if (!cidr.isAllowed(req.ip)) {
    logger.warn(`Upload CIDR deny: ${req.ip} not in allowlist`);
    return res.status(403).render("upload-result", {
      layout: false,
      error: "Forbidden",
    });
  }
  next();
};

/**
 * GET /upload — render the upload form.
 */
const formHandler = (req, res) => {
  res.render("upload", {
    layout: false,
    extensions: ALLOWED_EXTENSIONS,
    acceptTypes: ALLOWED_EXTENSIONS.join(","),
    maxSizeMB: Math.round(MAX_DOWNLOAD_SIZE / 1024 / 1024),
  });
};

/**
 * Resolve the MIME type and extension for an uploaded file.
 * Checks both the reported MIME and the file extension against
 * the DOWNLOAD_TYPES whitelist.
 */
const resolveUploadType = (file) => {
  // Try reported MIME first
  if (file.mimetype && ALLOWED_MIMES.has(file.mimetype)) {
    return { mime: file.mimetype, ext: DOWNLOAD_TYPES[file.mimetype] };
  }

  // Fall back to file extension
  const extFromName = path.extname(file.originalname).toLowerCase();
  if (extFromName) {
    const mimeFromExt = getMimeForExtension(extFromName);
    const extCheck = getExtensionForMime(mimeFromExt);
    if (extCheck) return { mime: mimeFromExt, ext: extCheck };
  }

  return null;
};

/**
 * POST /upload — handle the file upload.
 */
const uploadHandler = (req, res) => {
  if (!req.file) {
    return res.status(400).render("upload-result", {
      layout: false,
      error: "No file provided",
      errorDetail: "Please select a file to upload.",
    });
  }

  const file = req.file;
  const fileBuffer = file.buffer;

  // Validate file type
  const resolved = resolveUploadType(file);
  if (!resolved) {
    return res.status(415).render("upload-result", {
      layout: false,
      error: "Unsupported file type",
      errorDetail: `"${file.mimetype}" is not an allowed document type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
    });
  }

  const { mime, ext } = resolved;

  // Compute file content hash (always, for metadata)
  const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  // Compute cache key hash: URL-based if provided, file-content-based otherwise
  const rawUrl = req.body.url ? req.body.url.trim() : "";
  let sourceUrl = null;
  let cacheHash;

  if (rawUrl) {
    if (!isValidUrl(rawUrl)) {
      return res.status(400).render("upload-result", {
        layout: false,
        error: "Invalid URL",
        errorDetail: "The provided URL failed validation. It must be a public HTTP/HTTPS URL.",
      });
    }
    // Standardize using same normalization as getCachePath in pxy-dl
    const normalized = new URL(rawUrl).href;
    cacheHash = crypto.createHash("sha256").update(normalized).digest("hex");
    sourceUrl = normalized;
  } else {
    cacheHash = fileHash;
  }

  const filename = `${cacheHash}${ext}`;
  const cachePath = path.join(CACHE_DIR, filename);
  const cachedAt = new Date().toISOString();

  try {
    // Always overwrite — user explicitly chose to upload
    writeToLocalCache(cachePath, fileBuffer);
    writeMetadata(cachePath, { sourceUrl, fileHash, originalName: file.originalname });
    logger.info(`Upload cached: ${filename} (${fileBuffer.length} bytes)`);
  } catch (err) {
    logger.error(`Upload cache write failed: ${err.message}`);
    return res.status(500).render("upload-result", {
      layout: false,
      error: "Cache write failed",
      errorDetail: err.message,
    });
  }

  // Fire-and-forget R2 upload
  if (r2Cache.enabled) {
    r2Cache
      .put(filename, fileBuffer, {
        "x-source-url": sourceUrl || "",
        "x-cached-at": cachedAt,
        "x-mime": mime,
        "x-file-hash": fileHash,
        "x-original-name": file.originalname || "",
      })
      .catch((err) => {
        logger.warn(`R2 upload failed for ${filename}: ${err.message}`);
      });
  }

  // Derive display name from original upload filename
  let displayName = file.originalname || filename;
  const currentExt = path.extname(displayName).toLowerCase();
  if (ext && currentExt !== ext) {
    displayName += ext;
  }
  displayName = displayName.replace(/[^\w.\-]/g, "_");

  const sizeBytes = fileBuffer.length;
  const sizeFormatted = sizeBytes >= 1024 * 1024
    ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(sizeBytes / 1024).toFixed(1)} KB`;

  return res.render("upload-result", {
    layout: false,
    hash: cacheHash,
    fileHash,
    filename: displayName,
    hashUrl: `/pxy/dl/hash/${cacheHash}${ext}`,
    downloadUrl: sourceUrl ? `/pxy/dl/${encodeURIComponent(sourceUrl)}` : null,
    sourceUrl,
    mime,
    ext,
    sizeFormatted,
  });
};

module.exports = { upload, strictCidrGate, formHandler, uploadHandler };
