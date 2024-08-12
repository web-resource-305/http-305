const express = require('express');
const pxyResource = require("./handlers/pxy-resource.js");
const dlProxyPDF = require("./handlers/dl-proxy-pdf.js");
const pxyHTML = require("./handlers/pxy-html.js");

const app = express();
app.set("trust proxy", 1);
const port = process.env.PORT || 3001;

app.use(express.static('public'));

// Define a simple route
app.get('/pxy', (req, res) => {
  const country = req.get("CF-IPCountry");
  return res.status(200).send(`Welcome to HTTP 305 (${country})`);
});

// Handle HTML and resource proxying
app.get("/pxy/html", (req, res) => {
    const url = req.query.url;
    const jsParam = req.query.js;
    const jsEnabled = jsParam !== '0';
    if (!url) {
        return res.status(400).send("Please provide a URL");
    }
    return pxyHTML(req, res, url, jsEnabled);
});

// This has to come first
app.get("/pxy/html/nojs/*", (req, res) => {
    const uri = req.params[0];
    if (!uri) {
        return res.status(400).send("Please provide a URL");
    }
    console.log("No JS uri: "+ uri)
    return pxyHTML(req, res, uri, false);
});
// and this second
app.get("/pxy/html/*", (req, res) => {
    const uri = req.params[0];
    if (!uri) {
      return res.status(400).send("Please provide a URL");
    }
    return pxyHTML(req, res, uri);
});
  
// Use wildcard route to capture the full URL for resource proxying
app.get("/pxy/resource/*", async (req, res) => {
    const uri = req.params[0]; 
    if (!uri) {
        return res.status(400).send("Please provide a URL");
    }
    return pxyResource(req, res, uri, req.body);
});
  
// Use wildcard route to capture the full URL for the PDF
app.get("/dl/pdf/*", (req, res) => {
    console.log("Invoked downloader");
    const uri = req.params[0]; // Capture the full URL after /dl/pdf/
    console.log("Captured URI:", uri);
    if (!uri) {
        return res.status(400).send("Please provide a URL");
    }

    return dlProxyPDF(req, res, uri, req.body);
});

// Start the server
const server = app.listen(port, () => console.log(`http://localhost:${port}`));

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;