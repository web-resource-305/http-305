const express = require("express");
const hbs = require("express-handlebars");
const rateLimit = require("express-rate-limit");
const logger = require("./lib/logger");
const pxyResource = require("./handlers/pxy-resource.js");
const pxyDl = require("./handlers/pxy-dl.js");
const pxyAuto = require("./handlers/pxy-auto.js");
const pxyHTML = require("./handlers/pxy-html.js");
const { upload, strictCidrGate, formHandler, uploadHandler } = require("./handlers/upload.js");
const { strictCidrGate: deleteCidrGate, formHandler: deleteFormHandler, deleteHandler } = require("./handlers/delete.js");

logger.info(`Logging level: ${logger.level}`);
const port = process.env.PORT || 8080;

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY || true));
app.use("/pxy/dl", rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
}));
app.use(express.static("public"));
app.engine("hbs", hbs.engine({
  extname: ".hbs",
  partialsDir: "views/partials/",
  helpers: {
    breakLines: function (text) {
      return text.replace(/;/g, ";\n");
    },
    decodeURIComponent: function (text) {
      return decodeURIComponent(text);
    }
  }
}));
app.set("view engine", "hbs");
app.set("views", "./views");

// Handle HTML and resource proxying
app.get("/pxy/html", async (req, res) => {
  try {
    const country = req.get("CF-IPCountry");
    const url = req.query.url ? req.query.url.trim() : "";
    const jsDisabled = req.query.js === "0" || req.query.js === "false";
    const gbRedirect = req.query.ukred === "1" || req.query.ukred === "true";

    logger.debug(`jsDisabled: ${jsDisabled}, gbRedirect: ${gbRedirect}`);

    if (!url) {
      return res.status(400).send("Please provide a URL");
    }

    if (country && country.toLowerCase() === "gb" && gbRedirect) {
      res.set("Referrer-Policy", "no-referrer");
      return res.redirect(url);
    }

    return await pxyHTML(req, res, url, jsDisabled);
  } catch (err) {
    logger.error(`Error: ${err.message}`);
    if (!res.headersSent) {
      res.status(err.status || 500)
        .send(err.status ? err.message : "Internal Server Error");
    }
  }
});

app.get("/pxy/html/*", async (req, res) => {
  try {
    const url = req.params[0] ? req.params[0].trim() : "";
    if (!url) {
      return res.status(400).send("Please provide a URL");
    }
    return await pxyHTML(req, res, url);
  } catch (err) {
    logger.error(`Error: ${err.message}`);
    if (!res.headersSent) {
      res.status(err.status || 500)
        .send(err.status ? err.message : "Internal Server Error");
    }
  }
});

// Use wildcard route to capture pass-through static asset (CSS, JS, image, font, etc.)
// and streams them with the correct MIME type (No parsing, no rewriting).
app.get("/pxy/resource/*", async (req, res) => {
  try {
    const url = req.params[0] ? req.params[0].trim() : "";
    if (!url) {
      return res.status(400).send("Please provide a URL");
    }
    return await pxyResource(req, res, url);
  } catch (err) {
    logger.error(`Error: ${err.message}`);
    if (!res.headersSent) {
      res.status(err.status || 500)
        .send(err.status ? err.message : "Internal Server Error");
    }
  }
});

// Download by cache hash key (read-only, no upstream fetch)
app.get("/pxy/dl/hash/*", async (req, res) => {
  try {
    const key = req.params[0] ? req.params[0].trim() : "";
    logger.debug(`Hash download route hit, key: ${key}`);
    if (!key) {
      return res.status(400).send("Please provide a cache key");
    }
    return await pxyDl.hashHandler(req, res, key);
  } catch (err) {
    logger.error(`Error: ${err.message}`);
    if (!res.headersSent) {
      res.status(err.status || 500)
        .send(err.status ? err.message : "Internal Server Error");
    }
  }
});

// Download handler for files (PDF, DOCX, PPTX, XLSX, etc.)
app.get("/pxy/dl/*", async (req, res) => {
  try {
    logger.info("Invoked downloader");
    const uri = req.params[0] ? req.params[0].trim() : "";
    if (!uri) {
      return res.status(400).send("Please provide a URL");
    }
    return await pxyDl(req, res, uri);
  } catch (err) {
    logger.error(`Error: ${err.message}`);
    if (!res.headersSent) {
      res.status(err.status || 500)
        .send(err.status ? err.message : "Internal Server Error");
    }
  }
});

// Auto-detect content type and serve accordingly (HTML, download, or stream)
// Catch-all: must come after /pxy/html, /pxy/resource, /pxy/dl
app.get("/pxy/*", async (req, res) => {
  try {
    const url = req.params[0] ? req.params[0].trim() : "";
    if (!url) {
      return res.status(400).send("Please provide a URL");
    }
    return await pxyAuto(req, res, url);
  } catch (err) {
    logger.error(`Error: ${err.message}`);
    if (!res.headersSent) {
      res.status(err.status || 500)
        .send(err.status ? err.message : "Internal Server Error");
    }
  }
});

// Cache API — ensure a downloadable is cached and return JSON metadata (CIDR-protected)
app.get("/api/cache/report", pxyDl.reportHandler);
app.get("/api/cache", pxyDl.cacheHandler);

// Upload — manual file upload to cache (strict CIDR: blocked when allowlist is unset)
app.get("/upload", strictCidrGate, formHandler);
app.post("/upload", strictCidrGate, upload.single("file"), uploadHandler);

// Delete — remove cached file (strict CIDR: blocked when allowlist is unset)
app.get("/delete", deleteCidrGate, deleteFormHandler);
app.post("/delete", deleteCidrGate, express.urlencoded({ extended: false }), deleteHandler);

// Useful for keepalive
app.get("/ping", (req, res) => {
  res.render("headers", {
    headers: req.headers, layout: false });
});

// 404 catch-all (must be after all routes, before error handler)
app.use((req, res) => {
  res.status(404).sendFile("404.html", { root: "public" });
});

// Custom error handler middleware (must be after routes — Express requires all 4 params)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error(`Error encountered: ${err.message}`);
  res.status(err.status || 500).send("Internal Server Error");
});

// Start the server (guarded so the app can be imported for testing)
if (require.main === module) {
  const server = app.listen(port, () => logger.info(`http://localhost:${port}`));
  server.keepAliveTimeout = 120 * 1000;
  server.headersTimeout = 120 * 1000;
}

module.exports = app;
