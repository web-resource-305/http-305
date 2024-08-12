const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");
const { createLogger, transports, format } = require("winston");
const url = require("url");

// Set up logging
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
      } else if (resourceUrl.startsWith(appHttpAddress)) {
        // Absolute URL that matches siteBaseDomain: Proxy it
        rewrittenUrl = resourceUrl;
      }

      if (rewrittenUrl) {
        const tagName = el.tagName.toLowerCase();
        let pxySlug;
        
        if (tagName === "a") {
          pxySlug = jsEnabled ? "html" : "html/nojs";
        } else {
          pxySlug = "resource";
        }        

        if (tagName == "script" && !jsEnabled) {
          console.log(`Disabling script: ${resourceUrl}`);
          el.setAttribute(
            attribute,
            ``,
          );
        } else {
          el.setAttribute(
            attribute,
            `/pxy/${pxySlug}/${encodeURIComponent(rewrittenUrl)}`,
          );
        }
      }
    }
  });
};

module.exports = async (req, res, addressToProxy, jsEnabled) => {
  if (!addressToProxy) {
    logger.warn("Request missing URL parameter");
    return res.status(400).send("URL parameter is required");
  }

  console.log(`JavaScript: ${jsEnabled}`);

  // Decode the URI if it was encoded
  try {
    addressToProxy = decodeURIComponent(addressToProxy);
  } catch (e) {
    logger.error("Error decoding URI:", e);
    return res.status(400).send("Invalid URL encoding");
  }

  const urlToProxy = new URL(addressToProxy);
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const appHttpAddress = `${protocol}//${urlToProxy.hostname}`;

  try {
    logger.info(`Fetching URL: ${urlToProxy.href}`);

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

    // Fetch the HTML content
    const html = await response.text();
    const proxiedUrl = response.url; // The value after any redirects
    // Modify the HTML content to proxy resource URLs
    const dom = new JSDOM(html);
    const document = dom.window.document;

    modifyURLs(
      document.querySelectorAll("img"),
      "src",
      proxiedUrl,
      appHttpAddress
    );
    modifyURLs(
      // eslint-disable-next-line quotes
      document.querySelectorAll('link[rel="stylesheet"]'),
      "href",
      proxiedUrl,
      appHttpAddress,
    );
    modifyURLs(
      document.querySelectorAll("script"),
      "src",
      proxiedUrl,
      appHttpAddress,
      jsEnabled
    );

    modifyURLs(
      document.querySelectorAll("a"),
      "href",
      proxiedUrl,
      appHttpAddress,
      jsEnabled
    );

    return res.send(dom.serialize());
  } catch (error) {
    logger.error("Error fetching or modifying HTML:", error);

    return res.status(500).send("Internal Server Error");
  }
};
