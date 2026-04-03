const { JSDOM } = require("jsdom");
const { rewriteHTML, rewriteCSSUrls } = require("../../lib/html-rewriter");

const APP = "http://localhost:8080";
const PAGE = "https://example.com/articles/page.html";

/** Parse rewritten HTML and return the document for assertions. */
const parse = (html) => new JSDOM(html).window.document;

describe("rewriteCSSUrls", () => {
  test("rewrites relative url()", () => {
    const css = "body { background: url(bg.png); }";
    const result = rewriteCSSUrls(css, PAGE, APP);
    expect(result).toContain("/pxy/resource/");
    expect(result).toContain(encodeURIComponent("https://example.com/articles/bg.png"));
  });

  test("rewrites absolute url()", () => {
    const css = "body { background: url(https://cdn.example.com/bg.jpg); }";
    const result = rewriteCSSUrls(css, PAGE, APP);
    expect(result).toContain("/pxy/resource/");
    expect(result).toContain(encodeURIComponent("https://cdn.example.com/bg.jpg"));
  });

  test("skips data: URLs", () => {
    const css = "body { background: url(data:image/png;base64,abc); }";
    const result = rewriteCSSUrls(css, PAGE, APP);
    expect(result).toBe(css);
  });

  test("preserves single quotes", () => {
    const css = "body { background: url('image.png'); }";
    const result = rewriteCSSUrls(css, PAGE, APP);
    expect(result).toMatch(/url\('/);
  });

  test("preserves double quotes", () => {
    const css = "body { background: url(\"image.png\"); }";
    const result = rewriteCSSUrls(css, PAGE, APP);
    expect(result).toMatch(/url\("/);
  });
});

describe("rewriteHTML", () => {
  describe("anchors", () => {
    test("rewrites absolute href through /pxy/", () => {
      const html = "<html><body><a href=\"https://other.com/page\">link</a></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const href = doc.querySelector("a").getAttribute("href");
      expect(href).toBe(`${APP}/pxy/${encodeURIComponent("https://other.com/page")}`);
    });

    test("resolves relative href to absolute then proxies", () => {
      const html = "<html><body><a href=\"../other.html\">link</a></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const href = doc.querySelector("a").getAttribute("href");
      expect(href).toContain("/pxy/");
      expect(href).toContain(encodeURIComponent("https://example.com/other.html"));
    });

    test("appends ?js=0 when jsDisabled", () => {
      const html = "<html><body><a href=\"https://other.com\">link</a></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP, true));
      const href = doc.querySelector("a").getAttribute("href");
      expect(href).toEndWith("?js=0");
    });

    test("skips mailto links", () => {
      const html = "<html><body><a href=\"mailto:x@y.com\">email</a></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      expect(doc.querySelector("a").getAttribute("href")).toBe("mailto:x@y.com");
    });

    test("skips javascript: links", () => {
      const html = "<html><body><a href=\"javascript:void(0)\">click</a></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      expect(doc.querySelector("a").getAttribute("href")).toBe("javascript:void(0)");
    });

    test("skips tel: links", () => {
      const html = "<html><body><a href=\"tel:+1234567890\">call</a></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      expect(doc.querySelector("a").getAttribute("href")).toBe("tel:+1234567890");
    });

    test("skips fragment-only links", () => {
      const html = "<html><body><a href=\"#section\">jump</a></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      expect(doc.querySelector("a").getAttribute("href")).toBe("#section");
    });
  });

  describe("images", () => {
    test("rewrites src through /pxy/resource/", () => {
      const html = "<html><body><img src=\"https://cdn.example.com/photo.jpg\"></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const src = doc.querySelector("img").getAttribute("src");
      expect(src).toContain("/pxy/resource/");
      expect(src).toContain(encodeURIComponent("https://cdn.example.com/photo.jpg"));
    });

    test("resolves relative image src", () => {
      const html = "<html><body><img src=\"images/photo.jpg\"></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const src = doc.querySelector("img").getAttribute("src");
      expect(src).toContain(encodeURIComponent("https://example.com/articles/images/photo.jpg"));
    });
  });

  describe("scripts", () => {
    test("rewrites src through /pxy/resource/", () => {
      const html = "<html><body><script src=\"https://cdn.example.com/app.js\"></script></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const src = doc.querySelector("script").getAttribute("src");
      expect(src).toContain("/pxy/resource/");
    });

    test("clears src and content when jsDisabled", () => {
      const html = "<html><body><script src=\"app.js\">console.log('hi');</script></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP, true));
      const script = doc.querySelector("script");
      expect(script.getAttribute("src")).toBeFalsy();
      expect(script.textContent).toBe("");
    });
  });

  describe("stylesheets", () => {
    test("rewrites link[href] through /pxy/resource/", () => {
      const html = "<html><head><link rel=\"stylesheet\" href=\"style.css\"></head><body></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const href = doc.querySelector("link").getAttribute("href");
      expect(href).toContain("/pxy/resource/");
      expect(href).toContain(encodeURIComponent("https://example.com/articles/style.css"));
    });
  });

  describe("canonical links", () => {
    test("rewrites canonical through /pxy/ (navigable, not resource)", () => {
      const html = "<html><head><link rel=\"canonical\" href=\"https://example.com/canonical\"></head><body></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const href = doc.querySelector("link[rel='canonical']").getAttribute("href");
      expect(href).toContain(`${APP}/pxy/`);
      expect(href).not.toContain("/pxy/resource/");
    });
  });

  describe("forms", () => {
    test("resolves action to absolute but does not proxy", () => {
      const html = "<html><body><form action=\"/submit\"></form></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const action = doc.querySelector("form").getAttribute("action");
      expect(action).toBe("https://example.com/submit");
      expect(action).not.toContain("/pxy/");
    });
  });

  describe("iframes", () => {
    test("rewrites src through /pxy/ (navigable)", () => {
      const html = "<html><body><iframe src=\"https://embed.example.com/widget\"></iframe></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const src = doc.querySelector("iframe").getAttribute("src");
      expect(src).toContain("/pxy/");
      expect(src).not.toContain("/pxy/resource/");
    });
  });

  describe("srcset", () => {
    test("rewrites all entries in srcset", () => {
      const html = "<html><body><img src=\"a.jpg\" srcset=\"small.jpg 480w, large.jpg 1024w\"></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const srcset = doc.querySelector("img").getAttribute("srcset");
      expect(srcset).toContain("/pxy/resource/");
      expect(srcset).toContain("480w");
      expect(srcset).toContain("1024w");
    });
  });

  describe("inline styles", () => {
    test("rewrites url() in style elements", () => {
      const html = "<html><head><style>body { background: url(bg.png); }</style></head><body></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const style = doc.querySelector("style").textContent;
      expect(style).toContain("/pxy/resource/");
    });
  });

  describe("meta refresh", () => {
    test("rewrites refresh URL through /pxy/", () => {
      const html = "<html><head><meta http-equiv=\"refresh\" content=\"5;url=https://other.com/page\"></head><body></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const content = doc.querySelector("meta[http-equiv='refresh']").getAttribute("content");
      expect(content).toContain("/pxy/");
      expect(content).toContain(encodeURIComponent("https://other.com/page"));
      expect(content).toMatch(/^5;\s*url=/i);
    });
  });

  describe("manifest links", () => {
    test("removes manifest link elements", () => {
      const html = "<html><head><link rel=\"manifest\" href=\"/manifest.json\"></head><body></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      expect(doc.querySelector("link[rel='manifest']")).toBeNull();
    });
  });

  describe("charset", () => {
    test("forces charset to utf-8", () => {
      const html = "<html><head><meta charset=\"iso-8859-1\"></head><body></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      expect(doc.querySelector("meta[charset]").getAttribute("charset")).toBe("utf-8");
    });

    test("fixes Content-Type meta to utf-8", () => {
      const html = "<html><head><meta http-equiv=\"Content-Type\" content=\"text/html; charset=iso-8859-1\"></head><body></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP));
      const content = doc.querySelector("meta[http-equiv='Content-Type']").getAttribute("content");
      expect(content).toBe("text/html; charset=utf-8");
    });
  });

  describe("JS disabled mode", () => {
    test("removes event handler attributes", () => {
      const html = "<html><body><div onclick=\"alert(1)\" onmouseover=\"foo()\">text</div></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP, true));
      const div = doc.querySelector("div");
      expect(div.getAttribute("onclick")).toBeNull();
      expect(div.getAttribute("onmouseover")).toBeNull();
    });

    test("clears inline script content", () => {
      const html = "<html><body><script>alert('xss');</script></body></html>";
      const doc = parse(rewriteHTML(html, PAGE, APP, true));
      expect(doc.querySelector("script").textContent).toBe("");
    });
  });
});

expect.extend({
  toEndWith(received, suffix) {
    const pass = typeof received === "string" && received.endsWith(suffix);
    return {
      message: () => `expected "${received}" to end with "${suffix}"`,
      pass,
    };
  },
});
