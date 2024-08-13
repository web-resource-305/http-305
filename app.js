const express = require("express");
const { createLogger, transports, format } = require("winston");
const pxyResource = require("./handlers/pxy-resource.js");
const dlProxyPDF = require("./handlers/dl-proxy-pdf.js");
const pxyHTML = require("./handlers/pxy-html.js");

// Set up logging (error, warn, info, http, verbose, debug, silly)
const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp(),
    format.printf(
      ({ timestamp, level, message }) => `[${level}]: ${message}`,
    ),
  ),
  transports: [
    new transports.Console(),
    // Optionally, add more transports such as File or other logging services
  ],
});

const app = express();
app.set("trust proxy", 1);
const port = process.env.PORT || 8080;
app.use(express.static("public"));

// Define a simple route
app.get("/pxy", (req, res) => {
  const country = req.get("CF-IPCountry");
  logger.info(`Request Headers to /pxy (${country})`);
  logger.info(req.headers);
  
  return res.status(200).send(`Welcome to HTTP 305 (${country})`);
});

// Handle HTML and resource proxying
app.get("/pxy/html", (req, res) => {
  const country = req.get("CF-IPCountry");
  const url = req.query.url ? req.query.url.trim() : "";
  const jsEnabled = req.query.js === "1" || req.query.js === "true";
  const gbRedirect = req.query.ukred === "1" || req.query.ukred === "true";

  if(country && country.toLowerCase() == "gb" && gbRedirect){
    res.set("Referrer-Policy", "no-referrer");
    res.redirect(url);
  }

  if (!url) {
    return res.status(400).send("Please provide a URL");
  }
  return pxyHTML(req, res, url, jsEnabled);
});

// This has to come first
app.get("/pxy/html/nojs/*", (req, res) => {
  const url = req.params[0] ? req.params[0].trim() : "";
  if (!url) {
    return res.status(400).send("Please provide a URL");
  }
  return pxyHTML(req, res, url, false);
});
// and this second
app.get("/pxy/html/*", (req, res) => {
  const url = req.params[0] ? req.params[0].trim() : "";
  if (!url) {
    return res.status(400).send("Please provide a URL");
  }
  return pxyHTML(req, res, url);
});
  
// Use wildcard route to capture the full URL for resource proxying
app.get("/pxy/resource/*", async (req, res) => {
  const url = req.params[0] ? req.params[0].trim() : "";
  if (!url) {
    return res.status(400).send("Please provide a URL");
  }
  return pxyResource(req, res, url, req.body);
});
  
// Use wildcard route to capture the full URL for the PDF
app.get("/dl/pdf/*", (req, res) => {
  logger.info("Invoked downloader");
  const uri = req.params[0]; // Capture the full URL after /dl/pdf/
  if (!uri) {
    return res.status(400).send("Please provide a URL");
  }
  return dlProxyPDF(req, res, uri, req.body);
});

// Start the server
const server = app.listen(port, () => logger.info(`http://localhost:${port}`));

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;