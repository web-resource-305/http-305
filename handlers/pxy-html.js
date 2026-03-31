/**
 * @module pxy-html
 * HTML proxy handler. Fetches a page, rewrites all URLs via html-rewriter,
 * and returns the modified HTML. Use when the caller knows the target is HTML.
 */
const logger = require("../lib/logger");
const fetchUrl = require("../lib/fetch-url");
const isValidUrl = require("../lib/validate-url");
const { rewriteHTML } = require("../lib/html-rewriter");

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

    try {
      const response = await fetchUrl(urlToProxy.href);

      // Handle non-OK responses
      if (!response.ok) {
        logger.error(
          `Failed to fetch URL: ${urlToProxy.href}, Status: ${response.status}`,
        );
        return res
          .status(response.status)
          .send(`Failed to fetch URL: ${response.statusText}`);
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
