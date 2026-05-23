/**
 * @module pxy-html
 * HTML proxy handler. Fetches a page, rewrites all URLs via html-rewriter,
 * and returns the modified HTML. Use when the caller knows the target is HTML.
 */
const logger = require("../lib/logger");
const fetchUrl = require("../lib/fetch-url");
const { enabled: curlEnabled, fetchWithCurl, LATEST_CHROME_VERSION } = require("../lib/fetch-curl");
const isValidUrl = require("../lib/validate-url");
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
 * @param {string} addressToProxy - The HTML page URL to fetch and rewrite
 * @param {boolean} [jsDisabled] - Whether to strip scripts and propagate js=0
 */
module.exports = async (req, res, addressToProxy, jsDisabled) => {
  if (!addressToProxy) {
    logger.warn("Request missing URL parameter");
    return res.status(400).send("URL parameter is required");
  }

  // Decode the URL if it was encoded
  try {
    addressToProxy = decodeURIComponent(addressToProxy);
  } catch (e) {
    logger.error("Error decoding URI:", e);
    return res.status(400).send("Invalid URL encoding");
  }

  if (isValidUrl(addressToProxy)) {
    const urlToProxy = new URL(addressToProxy);
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.get("host");
    const appHttpAddress = `${protocol}://${host}`;

    logger.debug(`App Address: ${appHttpAddress}`);
    logger.info(`Fetching URL: ${urlToProxy.href}`);

    const isMobile = MOBILE_UA_RE.test(req.headers["user-agent"] || "");
    const googlebotUA = buildGooglebotUA(isMobile);
    logger.debug(`Using ${isMobile ? "mobile" : "desktop"} Googlebot UA, curl-impersonate: ${curlEnabled}`);

    try {
      const response = curlEnabled
        ? await fetchWithCurl(urlToProxy.href, googlebotUA)
        : await fetchUrl(urlToProxy.href, googlebotUA);

      // Handle non-OK responses with a themed error page
      if (!response.ok) {
        logger.error(
          `Failed to fetch URL: ${urlToProxy.href}, Status: ${response.status}`,
        );
        return res.status(response.status).render("upstream-error", {
          statusCode: response.status,
          statusText: response.statusText,
          url: urlToProxy.href,
          layout: false,
        });
      }
      logger.debug(`Address after any redirects: ${response.url}`);

      // Fetch the HTML content
      const html = await response.text();
      const rewritten = rewriteHTML(html, response.url, appHttpAddress, jsDisabled);

      res.set({
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'self'; img-src *; media-src *; style-src 'self' 'unsafe-inline' *; font-src *; frame-src 'self'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      return res.send(rewritten);
    } catch (error) {
      logger.error("Error fetching or modifying HTML:", error);
      if (!res.headersSent) {
        return res
          .status(error.status || 500)
          .send(error.status ? error.message : "Internal Server Error");
      }
    }

  } else {
    logger.error("Invalid URL provided:", addressToProxy);
    return res.status(400).send("Invalid URL");
  }
};
