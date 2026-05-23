/**
 * @module pxy-auto
 * Auto-detection proxy handler. Fetches the upstream URL, inspects the
 * Content-Type header, and serves as HTML (with rewriting), download
 * (with caching), or streamed resource accordingly.
 */
const { Readable } = require("stream");
const logger = require("../lib/logger");
const fetchUrl = require("../lib/fetch-url");
const { enabled: curlEnabled, fetchWithCurl, LATEST_CHROME_VERSION } = require("../lib/fetch-curl");
const isValidUrl = require("../lib/validate-url");
const { parseMime, isDownloadable, isHTML } = require("../lib/content-types");
const { rewriteHTML } = require("../lib/html-rewriter");

const MOBILE_UA_RE = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

const buildGooglebotUA = (isMobile) => {
  const v = `${LATEST_CHROME_VERSION}.0.0.0`;
  return isMobile
    ? `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`
    : `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/${v} Safari/537.36`;
};

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

  const isMobile = MOBILE_UA_RE.test(req.headers["user-agent"] || "");
  const googlebotUA = buildGooglebotUA(isMobile);
  logger.debug(`Using ${isMobile ? "mobile" : "desktop"} Googlebot UA, curl-impersonate: ${curlEnabled}`);

  try {
    const response = curlEnabled
      ? await fetchWithCurl(parsedUrl.href, googlebotUA)
      : await fetchUrl(parsedUrl.href, googlebotUA);

    if (!response.ok) {
      logger.error(`Failed to fetch URL: ${parsedUrl.href}, Status: ${response.status}`);
      return res.status(response.status).render("upstream-error", {
        statusCode: response.status,
        statusText: response.statusText,
        url: parsedUrl.href,
        layout: false,
      });
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
      // Redirect to /pxy/dl/ so the download goes through the rate-limited endpoint
      return res.redirect(`/pxy/dl/${encodeURIComponent(urlToProxy)}`);
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
