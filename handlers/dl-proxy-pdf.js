const fetch = require("node-fetch");
const { PassThrough } = require("stream");
const { createLogger, transports, format } = require("winston");
const path = require("path");
const url = require("url");

require("dotenv").config(); // Load environment variables from .env

// Set up logging
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

module.exports = async (req, res, pefToProxy, data) => {
  if (!pefToProxy) {
    logger.warn("Request missing URL parameter");
    return res.status(400).send("URL parameter is required");
  }

  // Decode the URL if it was encoded
  try {
    pefToProxy = decodeURIComponent(pefToProxy);
  } catch (e) {
    logger.error("Error decoding resource URL:", e);
    return res.status(400).send("Invalid resource URL encoding");
  }

  try {
    // Log the incoming request
    logger.info(`Fetching URL: ${pefToProxy}`);

    // Fetch the file from the provided URL
    const response = await fetch(pefToProxy, {
      headers: {
        // Add any required headers here
      },
    });

    // Handle non-OK responses
    if (!response.ok) {
      logger.error(`Failed to fetch URL: ${pefToProxy}, Status: ${response.status}`);
      return res
        .status(response.status)
        .send(`Failed to fetch URL: ${response.statusText}`);
    }

    // Extract the filename from the URI
    const parsedUrl = url.parse(pefToProxy);
    let filename = path.basename(parsedUrl.pathname) || "downloaded-file.pdf";

    // Ensure the filename has a .pdf extension
    if (path.extname(filename).toLowerCase() !== ".pdf") {
      filename += ".pdf";
    }

    // Set headers for the response
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");

    // Create a passthrough stream
    const stream = new PassThrough();

    // Pipe the response body to the passthrough stream and then to the response
    response.body.pipe(stream).on("error", (err) => {
      logger.error("Stream error:", err);
      res.status(500).send("Internal Server Error");
    });

    stream.pipe(res);
    return; // Ensure a consistent return value
  } catch (error) {
    logger.error("Error fetching or streaming PDF:", error);
    res.status(500).send("Internal Server Error");
    return; // Ensure a consistent return value
  }
};
