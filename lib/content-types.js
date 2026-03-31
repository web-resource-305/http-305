/**
 * @module content-types
 * MIME type and file extension registry for the proxy.
 * Single source of truth for download vs. resource classification.
 */

/** @type {Object<string, string>} MIME type → file extension for downloadable types */
const DOWNLOAD_TYPES = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

/** @type {Object<string, string>} File extension → MIME type for streamable resources */
const RESOURCE_TYPES = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".otf": "font/otf",
  ".ico": "image/x-icon",
};

// Build reverse map: extension -> MIME (download types)
const EXT_TO_MIME = {};
for (const [mime, ext] of Object.entries(DOWNLOAD_TYPES)) {
  EXT_TO_MIME[ext] = mime;
}

/**
 * Extract the MIME type from a Content-Type header, stripping charset/params.
 * @param {string|null} contentTypeHeader - Raw Content-Type header value
 * @returns {string|null} Normalized MIME type (e.g. "text/html") or null
 */
const parseMime = (contentTypeHeader) => {
  if (!contentTypeHeader) return null;
  return contentTypeHeader.split(";")[0].trim().toLowerCase();
};

/**
 * @param {string} mime - MIME type or raw Content-Type header
 * @returns {boolean} True if the type should be served as a download attachment
 */
const isDownloadable = (mime) => {
  const parsed = parseMime(mime) || mime;
  return parsed in DOWNLOAD_TYPES;
};

/**
 * @param {string} mime - MIME type or raw Content-Type header
 * @returns {boolean} True if the type is HTML
 */
const isHTML = (mime) => {
  const parsed = parseMime(mime) || mime;
  return parsed === "text/html";
};

/**
 * @param {string} mime - MIME type
 * @returns {string|null} File extension (e.g. ".pdf") or null if not a download type
 */
const getExtensionForMime = (mime) => {
  const parsed = parseMime(mime) || mime;
  return DOWNLOAD_TYPES[parsed] || null;
};

/**
 * @param {string} ext - File extension (e.g. ".css", ".pdf")
 * @returns {string} MIME type, or "application/octet-stream" if unknown
 */
const getMimeForExtension = (ext) => {
  const lower = ext.toLowerCase();
  return RESOURCE_TYPES[lower] || EXT_TO_MIME[lower] || "application/octet-stream";
};

module.exports = {
  DOWNLOAD_TYPES,
  parseMime,
  isDownloadable,
  isHTML,
  getExtensionForMime,
  getMimeForExtension,
};
