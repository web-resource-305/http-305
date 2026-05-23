/**
 * @module pxy-resource
 * Resource proxy handler. Streams static assets (CSS, JS, images, fonts)
 * with MIME type set from the file extension. No DOM parsing or rewriting.
 */
const { Readable } = require("stream");
const logger = require("../lib/logger");
const fetchUrl = require("../lib/fetch-url");
const { enabled: curlEnabled, fetchWithCurl, LATEST_CHROME_VERSION } = require("../lib/fetch-curl");
const isValidUrl = require("../lib/validate-url");
const path = require("path");
const { getMimeForExtension } = require("../lib/content-types");
const { rewriteCSSUrls } = require("../lib/html-rewriter");

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
 * @param {string} resourceToProxy - The resource URL to fetch and stream
 */
module.exports = async (req, res, resourceToProxy) => {
  if (!resourceToProxy) {
    logger.warn("Request missing URL parameter");
    return res.status(400).send("URL parameter is required");
  }

  // Decode the URI if it was encoded
  try {
    resourceToProxy = decodeURIComponent(resourceToProxy);
  } catch (e) {
    logger.error("Error decoding URI:", e);
    return res.status(400).send("Invalid URL encoding");
  }

  if (isValidUrl(resourceToProxy)) {
    const urlToProxy = new URL(resourceToProxy);
    logger.debug(`Fetching resource: ${urlToProxy.href}`);

    const isMobile = MOBILE_UA_RE.test(req.headers["user-agent"] || "");
    const googlebotUA = buildGooglebotUA(isMobile);

    try {
      const response = curlEnabled
        ? await fetchWithCurl(urlToProxy.href, googlebotUA)
        : await fetchUrl(urlToProxy.href, googlebotUA);

      // Handle non-OK responses
      if (!response.ok) {
        logger.error(`Failed to fetch URL: ${urlToProxy.href}, Status: ${response.status}`);
        return res
          .status(response.status)
          .send(`Failed to fetch URL: ${response.statusText}`);
      }

      // Extract the filename from the URI
      const filename = path.basename(urlToProxy.pathname) || "web-resource";
      const ext = path.extname(filename).toLowerCase();
      const mime = getMimeForExtension(ext);
      res.setHeader("Content-Type", mime);

      // Rewrite url() references inside CSS files so background images/fonts route through the proxy
      if (mime === "text/css") {
        const protocol = req.headers["x-forwarded-proto"] || req.protocol;
        const host = req.get("host");
        const appHttpAddress = `${protocol}://${host}`;
        const cssText = await response.text();
        return res.send(rewriteCSSUrls(cssText, resourceToProxy, appHttpAddress));
      }

      return Readable.fromWeb(response.body).pipe(res).on("error", (err) => {
        logger.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).send("Internal Server Error");
        }
      });
    } catch (error) {
      logger.error("Error fetching or streaming resource:", error);
      if (!res.headersSent) {
        return res
          .status(error.status || 500)
          .send(error.status ? error.message : "Internal Server Error");
      }
    }
  } else {
    logger.error(`Invalid Resource URL provided: ${resourceToProxy}`);
    return res.status(400).send("Invalid Resource URL");
  }
};
