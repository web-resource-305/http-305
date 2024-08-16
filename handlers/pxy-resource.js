const fetch = require("node-fetch");
const { createLogger, transports, format } = require("winston");
const path = require("path");
const url = require("url");

require("dotenv").config(); // Load environment variables from .env

// Set up logging (info, debug)
const logger = createLogger({
  level: process.env.LOG_LEVEL || "info", // Default to "info" if LOG_LEVEL is not set
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

const isValidUrl = (urlString) => {
  try {
    new URL(urlString);
    return true;
  } catch (_) {
    return false;
  }
};

module.exports = async (req, res, resourceToProxy, data) => {
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

    try {
      // Fetch the file from the provided URL
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
        logger.error(`Failed to fetch URL: ${urlToProxy.href}, Status: ${response.status}`);
        return res
          .status(response.status)
          .send(`Failed to fetch URL: ${response.statusText}`);
      }

      // Extract the filename from the URI
      const filename = path.basename(urlToProxy.pathname) || "web-resource";

      const ext = path.extname(filename).toLowerCase();
      switch (ext) {
      case ".css":
        res.setHeader("Content-Type", "text/css");
        break;
      case ".js":
        res.setHeader("Content-Type", "application/javascript");
        break;
      case ".json":
        res.setHeader("Content-Type", "application/json");
        break;
      case ".png":
        res.setHeader("Content-Type", "image/png");
        break;
      case ".jpg":
      case ".jpeg":
        res.setHeader("Content-Type", "image/jpeg");
        break;
      case ".gif":
        res.setHeader("Content-Type", "image/gif");
        break;
      case ".svg":
        res.setHeader("Content-Type", "image/svg+xml");
        break;
      case ".woff":
        res.setHeader("Content-Type", "font/woff");
        break;
      case ".woff2":
        res.setHeader("Content-Type", "font/woff2");
        break;
      case ".ttf":
        res.setHeader("Content-Type", "font/ttf");
        break;
      case ".eot":
        res.setHeader("Content-Type", "application/vnd.ms-fontobject");
        break;
      case ".otf":
        res.setHeader("Content-Type", "font/otf");
        break;
      case ".ico":
        res.setHeader("Content-Type", "image/x-icon");
        break;
      default:
        res.setHeader("Content-Type", "application/octet-stream");
      }

      return response.body.pipe(res).on("error", (err) => {
        logger.error("Stream error:", err);
        res.status(500).send("Internal Server Error");
      });
    } catch (error) {
      logger.error("Error fetching or streaming resource:", error);
      return res.status(500).send("Internal Server Error");
    }
  } else {
    logger.error(`Invalid Resource URL provided: ${resourceToProxy}`);
    return res.status(400).send("Invalid Resource URL");
  }
};
