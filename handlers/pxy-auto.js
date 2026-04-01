/**
 * @module pxy-auto
 * Auto-detection proxy handler. Fetches the upstream URL, inspects the
 * Content-Type header, and serves as HTML (with rewriting), download
 * (with caching), or streamed resource accordingly.
 */
const { Readable } = require("stream");
const logger = require("../lib/logger");
const fetchUrl = require("../lib/fetch-url");
const isValidUrl = require("../lib/validate-url");
const { parseMime, isDownloadable, isHTML } = require("../lib/content-types");
const { rewriteHTML } = require("../lib/html-rewriter");
const { serveDownload } = require("./pxy-dl");
const cidr = require("../lib/cidr");

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} urlToProxy - The upstream URL to fetch and auto-detect
 */
module.exports = async (req, res, urlToProxy) => {
  if (!urlToProxy) {
    logger.warn("Request missing URL parameter");
    return res.status(400).send("URL parameter is required");
  }

  try {
    urlToProxy = decodeURIComponent(urlToProxy);
  } catch (e) {
    logger.error("Error decoding URI:", e);
    return res.status(400).send("Invalid URL encoding");
  }

  if (!isValidUrl(urlToProxy)) {
    logger.error(`Invalid URL provided: ${urlToProxy}`);
    return res.status(400).send("Invalid URL");
  }

  const parsedUrl = new URL(urlToProxy);
  logger.info(`Auto-detecting content type for: ${parsedUrl.href}`);

  try {
    const response = await fetchUrl(parsedUrl.href);

    if (!response.ok) {
      logger.error(`Failed to fetch URL: ${parsedUrl.href}, Status: ${response.status}`);
      return res
        .status(response.status)
        .send(`Failed to fetch URL: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    const mime = parseMime(contentType);
    logger.debug(`Detected Content-Type: ${contentType} (parsed: ${mime})`);

    if (isHTML(mime)) {
      // Serve as proxied HTML with URL rewriting
      const protocol = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.get("host");
      const appHttpAddress = `${protocol}://${host}`;
      const jsDisabled = req.query.js === "0" || req.query.js === "false";

      const html = await response.text();
      const rewritten = rewriteHTML(html, response.url, appHttpAddress, jsDisabled);
      res.set({
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'self'; img-src *; media-src *; style-src 'self' 'unsafe-inline' *; font-src *; frame-src 'self'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      return res.send(rewritten);
    }

    if (isDownloadable(mime)) {
      // Serve as attachment download; only write to cache if IP is allowed
      const canWrite = cidr.isAllowed(req.ip);
      if (!canWrite) {
        logger.info(`CIDR read-only: ${req.ip} on auto-download`);
      }
      return await serveDownload(res, urlToProxy, response, mime, canWrite);
    }

    // Default: stream as resource with upstream Content-Type
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    return Readable.fromWeb(response.body).pipe(res).on("error", (err) => {
      logger.error("Stream error:", err);
      if (!res.headersSent) {
        res.status(500).send("Internal Server Error");
      }
    });
  } catch (error) {
    logger.error("Error in auto-detection handler:", error);
    if (!res.headersSent) {
      res.status(error.status || 500)
        .send(error.status ? error.message : "Internal Server Error");
    }
    return;
  }
};
