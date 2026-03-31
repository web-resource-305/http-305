/**
 * @module html-rewriter
 * JSDOM-based URL rewriter. Parses HTML and rewrites element URLs to
 * route through the proxy: <a> → /pxy/, resources → /pxy/resource/.
 */
const { JSDOM } = require("jsdom");
const logger = require("./logger");

/**
 * Non-HTTP schemes that should never be rewritten.
 */
const SKIP_SCHEMES = ["javascript:", "mailto:", "tel:", "data:", "#"];

/**
 * Rewrite `url()` references inside CSS text to route through the proxy.
 * @param {string} cssText - Raw CSS string
 * @param {string} proxiedUrl - The page URL (for resolving relative URLs)
 * @param {string} appHttpAddress - This proxy's base URL
 * @returns {string} CSS with rewritten url() references
 */
const rewriteCSSUrls = (cssText, proxiedUrl, appHttpAddress) => {
  return cssText.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
    (match, quote, url) => {
      if (SKIP_SCHEMES.some((s) => url.startsWith(s))) return match;
      let absolute;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        absolute = new URL(url, proxiedUrl).href;
      } else {
        absolute = url;
      }
      const proxied = `${appHttpAddress}/pxy/resource/${encodeURIComponent(absolute)}`;
      return `url(${quote}${proxied}${quote})`;
    }
  );
};

/**
 * Rewrite URLs on a set of DOM elements to route through the proxy.
 * @param {NodeList} elements - DOM elements to process
 * @param {string} attribute - Attribute name containing the URL (e.g. "src", "href")
 * @param {string} proxiedUrl - The original page URL (for resolving relative URLs)
 * @param {string} appHttpAddress - This proxy's base URL (e.g. "https://host")
 * @param {boolean} [jsDisabled=false] - Whether JS is disabled (affects script/link routing)
 */
const modifyURLs = (
  elements,
  attribute,
  proxiedUrl,
  appHttpAddress,
  jsDisabled = false
) => {
  elements.forEach((el) => {
    const resourceUrl = el.getAttribute(attribute);
    let rewrittenUrl = null;

    if (!resourceUrl) return;

    // Skip non-HTTP schemes and fragment-only URLs
    if (SKIP_SCHEMES.some((s) => resourceUrl.startsWith(s))) return;

    // Resolve to absolute URL
    if (
      !resourceUrl.startsWith("http://") &&
      !resourceUrl.startsWith("https://")
    ) {
      rewrittenUrl = new URL(resourceUrl, proxiedUrl).href;
      logger.debug(`Relative URL detected. Converting to absolute: (${resourceUrl} to ${rewrittenUrl})`);
    } else {
      // Proxy ALL absolute URLs (including cross-origin)
      rewrittenUrl = resourceUrl;
    }

    const tagName = el.tagName.toLowerCase();

    // Forms bypass the proxy — just ensure the action is absolute
    if (tagName === "form") {
      el.setAttribute(attribute, rewrittenUrl);
      return;
    }

    const apiSlug = (tagName === "a" || tagName === "iframe") ? "pxy" : "pxy/resource";
    let proxiedResource = `${appHttpAddress}/${apiSlug}/${encodeURIComponent(rewrittenUrl)}`;

    // Propagate jsDisabled state for auto-detected links
    if (tagName === "a" && jsDisabled) {
      proxiedResource += "?js=0";
    }

    logger.debug(`Proxied resource: ${proxiedResource}`);

    if (tagName === "script" && jsDisabled) {
      logger.debug(`Disabling script: ${rewrittenUrl}`);
      el.setAttribute(attribute, "");
      return;
    }

    el.setAttribute(attribute, proxiedResource);
  });
};

/**
 * Rewrite srcset attributes (comma-separated "url descriptor" pairs).
 * @param {NodeList} elements - DOM elements with srcset
 * @param {string} proxiedUrl - The page URL (for resolving relative URLs)
 * @param {string} appHttpAddress - This proxy's base URL
 */
const rewriteSrcset = (elements, proxiedUrl, appHttpAddress) => {
  elements.forEach((el) => {
    const srcset = el.getAttribute("srcset");
    if (!srcset) return;
    const rewritten = srcset.split(",").map((entry) => {
      const parts = entry.trim().split(/\s+/);
      const url = parts[0];
      if (!url || SKIP_SCHEMES.some((s) => url.startsWith(s))) {
        return entry;
      }
      let absolute;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        absolute = new URL(url, proxiedUrl).href;
      } else {
        absolute = url;
      }
      parts[0] = `${appHttpAddress}/pxy/resource/${encodeURIComponent(absolute)}`;
      return parts.join(" ");
    }).join(", ");
    el.setAttribute("srcset", rewritten);
  });
};

/**
 * Event handler attributes to strip when JS is disabled.
 */
const EVENT_HANDLER_ATTRS = [
  "onclick", "ondblclick", "onmousedown", "onmouseup", "onmouseover",
  "onmouseout", "onmousemove", "onkeydown", "onkeyup", "onkeypress",
  "onfocus", "onblur", "onchange", "onsubmit", "onreset", "onload",
  "onerror", "onresize", "onscroll", "oninput", "ontouchstart",
  "ontouchend", "ontouchmove",
];

/**
 * Parse an HTML string and rewrite all resource/link URLs to route through the proxy.
 * @param {string} html - Raw HTML string
 * @param {string} responseUrl - The URL the HTML was fetched from (after redirects)
 * @param {string} appHttpAddress - This proxy's base URL
 * @param {boolean} [jsDisabled=false] - Whether to disable scripts and propagate js=0
 * @returns {string} Serialized HTML with rewritten URLs
 */
const rewriteHTML = (html, responseUrl, appHttpAddress, jsDisabled = false) => {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // --- Images ---
  modifyURLs(
    document.querySelectorAll("img"),
    "src",
    responseUrl,
    appHttpAddress
  );

  // --- Strip manifest links (relative URLs inside manifests can't be proxied) ---
  document.querySelectorAll("link[rel='manifest']").forEach((el) => el.remove());

  // --- All link tags (stylesheets, icons, preloads, etc.) ---
  modifyURLs(
    document.querySelectorAll("link[href]"),
    "href",
    responseUrl,
    appHttpAddress
  );

  // --- Scripts ---
  modifyURLs(
    document.querySelectorAll("script"),
    "src",
    responseUrl,
    appHttpAddress,
    jsDisabled
  );

  // --- Anchors ---
  modifyURLs(
    document.querySelectorAll("a"),
    "href",
    responseUrl,
    appHttpAddress,
    jsDisabled
  );

  // --- Forms (resolve to absolute, bypass proxy) ---
  modifyURLs(
    document.querySelectorAll("form"),
    "action",
    responseUrl,
    appHttpAddress
  );

  // --- Media & embedded elements ---
  modifyURLs(document.querySelectorAll("source"), "src", responseUrl, appHttpAddress);
  modifyURLs(document.querySelectorAll("video"), "src", responseUrl, appHttpAddress);
  modifyURLs(document.querySelectorAll("video"), "poster", responseUrl, appHttpAddress);
  modifyURLs(document.querySelectorAll("audio"), "src", responseUrl, appHttpAddress);
  modifyURLs(document.querySelectorAll("iframe"), "src", responseUrl, appHttpAddress);

  // --- Responsive image srcset ---
  rewriteSrcset(document.querySelectorAll("img[srcset]"), responseUrl, appHttpAddress);
  rewriteSrcset(document.querySelectorAll("source[srcset]"), responseUrl, appHttpAddress);

  // --- Inline CSS url() references ---
  document.querySelectorAll("style").forEach((el) => {
    el.textContent = rewriteCSSUrls(el.textContent, responseUrl, appHttpAddress);
  });

  // --- Meta refresh redirects ---
  document.querySelectorAll("meta[http-equiv=\"refresh\"]").forEach((el) => {
    const content = el.getAttribute("content");
    if (!content) return;
    const match = content.match(/^(\d+;\s*url=)(.+)$/i);
    if (match) {
      const url = match[2].trim();
      let absolute;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        absolute = new URL(url, responseUrl).href;
      } else {
        absolute = url;
      }
      const proxied = `${appHttpAddress}/pxy/${encodeURIComponent(absolute)}`;
      el.setAttribute("content", `${match[1]}${proxied}`);
    }
  });

  // --- Fix charset to match JSDOM's UTF-8 output ---
  const charsetMeta = document.querySelector("meta[charset]");
  if (charsetMeta) {
    charsetMeta.setAttribute("charset", "utf-8");
  }
  const httpEquivMeta = document.querySelector("meta[http-equiv=\"Content-Type\"]");
  if (httpEquivMeta) {
    httpEquivMeta.setAttribute("content", "text/html; charset=utf-8");
  }

  // --- Full JS disabling: clear inline scripts + event handlers ---
  if (jsDisabled) {
    document.querySelectorAll("script").forEach((el) => {
      el.textContent = "";
      el.removeAttribute("src");
    });
    const selector = EVENT_HANDLER_ATTRS.map((a) => `[${a}]`).join(",");
    document.querySelectorAll(selector).forEach((el) => {
      EVENT_HANDLER_ATTRS.forEach((attr) => el.removeAttribute(attr));
    });
  }

  return dom.serialize();
};

module.exports = { rewriteHTML, rewriteCSSUrls };
