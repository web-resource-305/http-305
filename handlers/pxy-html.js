const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");
const { createLogger, transports, format } = require("winston");
const url = require("url");

// Set up logging (error, warn, info, http, verbose, debug, silly)
const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp(),
    format.printf(
      ({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`,
    ),
  ),
  transports: [
    new transports.Console(),
    // Optionally, add more transports such as File or other logging services
  ],
});

const modifyURLs = (
  elements,
  attribute,
  proxiedUrl,
  appHttpAddress,
  jsEnabled = true
) => {
  elements.forEach((el) => {
    const resourceUrl = el.getAttribute(attribute);
    let rewrittenUrl = null;

    if (resourceUrl && !resourceUrl.startsWith("data:")) {
      
      // Convert relative URL to absolute
      if (
        !resourceUrl.startsWith("http://") &&
        !resourceUrl.startsWith("https://")
      ) {  
        rewrittenUrl = new url.URL(resourceUrl, proxiedUrl).href;
        logger.log("silly", `Relative URL detected.  Converting to absolute: (${resourceUrl} to ${rewrittenUrl})`);
      } else if (resourceUrl.startsWith(appHttpAddress)) {
        logger.log("silly", `Site uses absolute URls for its resources: ${resourceUrl}`);
        // Absolute URL that matches siteBaseDomain: Proxy it
        rewrittenUrl = resourceUrl;
      }

      if (rewrittenUrl) {
        logger.log("silly", `Cleaned Resource URL: ${rewrittenUrl}}`);
        const tagName = el.tagName.toLowerCase();
        let apiSlug;
        
        // I don't want to handle proxying forms.  
        // So make sure the method goes to the original site (see relative to absolute above)
        if (tagName === "form") {
          el.setAttribute(
            attribute,
            rewrittenUrl
          );
          return;
        }
        
        if (tagName === "a") {
          apiSlug = jsEnabled ? "pxy/html" : "pxy/html/nojs";
        } else {
          apiSlug = "pxy/resource";
        } 

        if (rewrittenUrl && rewrittenUrl.endsWith(".pdf")) {
          apiSlug = "dl/pdf";
        }

        const proxiedResource =  `${appHttpAddress}/${apiSlug}/${encodeURIComponent(rewrittenUrl)}`;
        logger.silly(`Proxied resource: ${proxiedResource}`);

        if (tagName == "script" && !jsEnabled) {
          logger.debug(`Disabling script: ${rewrittenUrl}`);
          el.setAttribute(
            attribute,
            ""
          );
          return;
        } 
        
        el.setAttribute(
          attribute, proxiedResource
        );

      }
    }
  });
};

const isValidUrl = (urlString) => {
  try {
    new URL(urlString);
    return true;
  } catch (_) {
    return false;
  }
};

module.exports = async (req, res, addressToProxy, jsEnabled) => {
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
      // Fetch the HTML content from the provided URL
      const response = await fetch(urlToProxy.href, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          "Accept-Language": "en-US",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          From: "googlebot(at)googlebot.com",
          "Accept-Encoding": "gzip, deflate, br",
        },
      });

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
      // Modify the HTML content to proxy resource URLs
      const dom = new JSDOM(html);
      const document = dom.window.document;

      modifyURLs(
        document.querySelectorAll("img"),
        "src",
        response.url,
        appHttpAddress
      );

      modifyURLs(
        // eslint-disable-next-line quotes
        document.querySelectorAll('link[rel="stylesheet"]'),
        "href",
        response.url,
        appHttpAddress,
      );

      modifyURLs(
        document.querySelectorAll("script"),
        "src",
        response.url,
        appHttpAddress,
        jsEnabled
      );

      modifyURLs(
        document.querySelectorAll("a"),
        "href",
        response.url,
        appHttpAddress,
        jsEnabled
      );

      // convert relative to absolute to break out of the proxy for forms
      modifyURLs(
        document.querySelectorAll("form"),
        "action",
        response.url,
        appHttpAddress
      );

      return res.send(dom.serialize());
    } catch (error) {
      logger.error("Error fetching or modifying HTML:", error);
      if (!res.headersSent) {
        return res.status(500).send("Internal Server Error");
      } 
    }

  } else {
    logger.error("Invalid URL provided:", addressToProxy);
    return res.status(400).send("Invalid URL");
  }
};
