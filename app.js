const express = require("express");
const hbs = require("express-handlebars");
const { createLogger, transports, format } = require("winston");
const pxyResource = require("./handlers/pxy-resource.js");
const dlProxyPDF = require("./handlers/dl-proxy-pdf.js");
const pxyHTML = require("./handlers/pxy-html.js");

require("dotenv").config(); // Load environment variables from .env

// Set up logging (error, warn, info, http, verbose, debug, silly)
const logger = createLogger({
  level: process.env.LOG_LEVEL || "info", // Default to "info" if LOG_LEVEL is not set
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

logger.info(`Logging level: ${logger.level}`);
const port = process.env.PORT || 8080;

const app = express();
app.set("trust proxy", 1);
app.use(express.static("public"));
app.engine("hbs", hbs.engine({
  extname: ".hbs",
  partialsDir: "views/partials/", // Specify the partials directory
  helpers: {
    // Custom helper to replace semicolons with semicolon and line break
    breakLines: function (text) {
      return text.replace(/;/g, ";<br>");
    },
    decodeURIComponent: function (text) {
      return decodeURIComponent(text);
    }
  }
}));
app.set("view engine", "hbs");
app.set("views", "./views");

// Custom error handler middleware
app.use((err, req, res, next) => {
  logger.error(`Error encountered: ${err.message}`);
  res.status(err.status || 500).send(`Internal Server Error: ${err.message}`);
});

// Useful for keepalive 
app.get("/ping", (req, res) => {
  res.render("headers", { 
    headers: req.headers,  layout: false });
});

// Define a simple route
app.get("/pxy", (req, res) => {
  const country = req.get("CF-IPCountry");
  logger.info(`Request Headers to /pxy (${country}): ${JSON.stringify(req.headers, null, 2)}`);
  
  return res.status(200).send(`Welcome to HTTP 305 (${country})`);
});

// Handle HTML and resource proxying
app.get("/pxy/html", (req, res) => {
  const country = req.get("CF-IPCountry");
  const url = req.query.url ? req.query.url.trim() : "";
  const jsDisabled = req.query.js === "0" || req.query.js === "false";
  const gbRedirect = req.query.ukred === "1" || req.query.ukred === "true";

  logger.debug(`jsDisabled: ${jsDisabled}, gbRedirect: ${gbRedirect}`);

  if (!url) {
    return res.status(400).send("Please provide a URL");
  }

  if(country && country.toLowerCase() == "gb" && gbRedirect){
    res.set("Referrer-Policy", "no-referrer");
    res.redirect(url);
    return;
  }

  return pxyHTML(req, res, url, jsDisabled);
});

// This has to come first
app.get("/pxy/html/nojs/*", (req, res) => {
  const url = req.params[0] ? req.params[0].trim() : "";
  if (!url) {
    return res.status(400).send("Please provide a URL");
  }
  return pxyHTML(req, res, url, true);
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