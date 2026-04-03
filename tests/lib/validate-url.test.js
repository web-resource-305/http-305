const isValidUrl = require("../../lib/validate-url");

describe("isValidUrl", () => {
  describe("valid URLs", () => {
    test("accepts https URL", () => {
      expect(isValidUrl("https://example.com")).toBe(true);
    });

    test("accepts http URL", () => {
      expect(isValidUrl("http://example.com")).toBe(true);
    });

    test("accepts URL with path and query", () => {
      expect(isValidUrl("https://example.com/path?q=1&lang=en")).toBe(true);
    });

    test("accepts URL with port", () => {
      expect(isValidUrl("https://example.com:8080/path")).toBe(true);
    });

    test("accepts URL with fragment", () => {
      expect(isValidUrl("https://example.com/page#section")).toBe(true);
    });
  });

  describe("invalid schemes", () => {
    test("rejects ftp", () => {
      expect(isValidUrl("ftp://example.com")).toBe(false);
    });

    test("rejects javascript", () => {
      expect(isValidUrl("javascript:alert(1)")).toBe(false);
    });

    test("rejects data URI", () => {
      expect(isValidUrl("data:text/html,<h1>Hi</h1>")).toBe(false);
    });

    test("rejects file protocol", () => {
      expect(isValidUrl("file:///etc/passwd")).toBe(false);
    });
  });

  describe("SSRF protection — loopback", () => {
    test("rejects localhost", () => {
      expect(isValidUrl("http://localhost")).toBe(false);
    });

    test("rejects 127.0.0.1", () => {
      expect(isValidUrl("http://127.0.0.1")).toBe(false);
    });

    test("rejects [::1]", () => {
      expect(isValidUrl("http://[::1]")).toBe(false);
    });

    test("rejects 0.0.0.0", () => {
      expect(isValidUrl("http://0.0.0.0")).toBe(false);
    });
  });

  describe("SSRF protection — private ranges", () => {
    test("rejects 10.x.x.x", () => {
      expect(isValidUrl("http://10.0.0.1")).toBe(false);
    });

    test("rejects 172.16.x.x", () => {
      expect(isValidUrl("http://172.16.0.1")).toBe(false);
    });

    test("rejects 192.168.x.x", () => {
      expect(isValidUrl("http://192.168.1.1")).toBe(false);
    });

    test("rejects link-local 169.254.x.x (AWS metadata)", () => {
      expect(isValidUrl("http://169.254.169.254")).toBe(false);
    });
  });

  describe("SSRF protection — internal TLDs", () => {
    test("rejects .local domains", () => {
      expect(isValidUrl("http://server.local")).toBe(false);
    });

    test("rejects .internal domains", () => {
      expect(isValidUrl("http://server.internal")).toBe(false);
    });
  });

  describe("malformed input", () => {
    test("rejects empty string", () => {
      expect(isValidUrl("")).toBe(false);
    });

    test("rejects null", () => {
      expect(isValidUrl(null)).toBe(false);
    });

    test("rejects undefined", () => {
      expect(isValidUrl(undefined)).toBe(false);
    });

    test("rejects plain text", () => {
      expect(isValidUrl("not a url")).toBe(false);
    });

    test("rejects missing scheme", () => {
      expect(isValidUrl("://missing-scheme")).toBe(false);
    });
  });
});
