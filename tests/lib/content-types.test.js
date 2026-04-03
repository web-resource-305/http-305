const {
  DOWNLOAD_TYPES,
  parseMime,
  isDownloadable,
  isHTML,
  getExtensionForMime,
  getMimeForExtension,
} = require("../../lib/content-types");

describe("DOWNLOAD_TYPES", () => {
  test("is a non-empty object", () => {
    expect(Object.keys(DOWNLOAD_TYPES).length).toBeGreaterThan(0);
  });

  test("contains expected entries", () => {
    expect(DOWNLOAD_TYPES["application/pdf"]).toBe(".pdf");
    expect(DOWNLOAD_TYPES["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]).toBe(".docx");
    expect(DOWNLOAD_TYPES["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]).toBe(".xlsx");
    expect(DOWNLOAD_TYPES["application/vnd.openxmlformats-officedocument.presentationml.presentation"]).toBe(".pptx");
  });
});

describe("parseMime", () => {
  test("extracts MIME type from Content-Type with charset", () => {
    expect(parseMime("text/html; charset=utf-8")).toBe("text/html");
  });

  test("returns MIME type as-is when no params", () => {
    expect(parseMime("application/pdf")).toBe("application/pdf");
  });

  test("lowercases the result", () => {
    expect(parseMime("Text/HTML")).toBe("text/html");
  });

  test("returns null for null input", () => {
    expect(parseMime(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(parseMime(undefined)).toBeNull();
  });

  test("returns null for empty string input", () => {
    expect(parseMime("")).toBeNull();
  });

  test("handles extra whitespace", () => {
    expect(parseMime("  text/html ; charset=utf-8 ")).toBe("text/html");
  });
});

describe("isDownloadable", () => {
  test("returns true for PDF", () => {
    expect(isDownloadable("application/pdf")).toBe(true);
  });

  test("returns true for MIME with charset params", () => {
    expect(isDownloadable("application/pdf; charset=utf-8")).toBe(true);
  });

  test("returns false for HTML", () => {
    expect(isDownloadable("text/html")).toBe(false);
  });

  test("returns false for images", () => {
    expect(isDownloadable("image/png")).toBe(false);
  });

  test("returns true for DOCX", () => {
    expect(isDownloadable("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
  });
});

describe("isHTML", () => {
  test("returns true for text/html", () => {
    expect(isHTML("text/html")).toBe(true);
  });

  test("returns true for text/html with charset", () => {
    expect(isHTML("text/html; charset=utf-8")).toBe(true);
  });

  test("returns false for application/json", () => {
    expect(isHTML("application/json")).toBe(false);
  });

  test("returns false for null", () => {
    expect(isHTML(null)).toBe(false);
  });
});

describe("getExtensionForMime", () => {
  test("returns .pdf for application/pdf", () => {
    expect(getExtensionForMime("application/pdf")).toBe(".pdf");
  });

  test("returns .docx for DOCX MIME type", () => {
    expect(getExtensionForMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(".docx");
  });

  test("returns null for non-download MIME types", () => {
    expect(getExtensionForMime("text/html")).toBeNull();
  });

  test("returns null for image MIME types", () => {
    expect(getExtensionForMime("image/png")).toBeNull();
  });

  test("handles Content-Type with params", () => {
    expect(getExtensionForMime("application/pdf; charset=binary")).toBe(".pdf");
  });
});

describe("getMimeForExtension", () => {
  test("returns text/css for .css", () => {
    expect(getMimeForExtension(".css")).toBe("text/css");
  });

  test("returns application/pdf for .pdf (from download types)", () => {
    expect(getMimeForExtension(".pdf")).toBe("application/pdf");
  });

  test("returns image/png for .png", () => {
    expect(getMimeForExtension(".png")).toBe("image/png");
  });

  test("is case insensitive", () => {
    expect(getMimeForExtension(".CSS")).toBe("text/css");
    expect(getMimeForExtension(".PDF")).toBe("application/pdf");
  });

  test("returns application/octet-stream for unknown extensions", () => {
    expect(getMimeForExtension(".xyz")).toBe("application/octet-stream");
  });

  test("returns font/woff2 for .woff2", () => {
    expect(getMimeForExtension(".woff2")).toBe("font/woff2");
  });
});
