/**
 * Cache lifecycle integration test.
 *
 * Mirrors the manual testing workflow:
 *   1. /api/cache   — prime the cache from upstream
 *   2. /api/cache   — verify local cache hit (no upstream fetch)
 *   3. delete local — /api/cache restores from R2
 *   4. /pxy/dl      — download from local cache
 *   5. /upload      — overwrite the cached file
 *   6. /pxy/dl      — verify the overwritten content is served
 *   7. /delete       — remove the cache entry
 *   8. /api/cache   — verify deletion, re-fetches from upstream
 *
 * External dependencies are mocked:
 *   - fetch-url   → returns fake PDF buffers (no real HTTP)
 *   - r2-cache    → in-memory Map (no real S3/R2)
 *   - fetch-curl  → disabled (no curl-impersonate binaries)
 */

/* ------------------------------------------------------------------ */
/*  Mocks — must be declared before any require() that loads them     */
/* ------------------------------------------------------------------ */

// In-memory R2 store shared across all tests
// (Jest requires variables referenced inside jest.mock() to start with "mock")
const mockR2Store = new Map();

jest.mock("../lib/fetch-url", () => {
  const fn = jest.fn();
  fn.GOOGLEBOT_UA = "test-agent";
  return fn;
});

jest.mock("../lib/r2-cache", () => ({
  enabled: true,
  put: jest.fn(async (key, buffer, metadata) => {
    mockR2Store.set(key, { buffer: Buffer.from(buffer), metadata });
    return true;
  }),
  get: jest.fn(async (key) => {
    const entry = mockR2Store.get(key);
    return entry ? { buffer: Buffer.from(entry.buffer), metadata: entry.metadata } : null;
  }),
  del: jest.fn(async (key) => mockR2Store.delete(key)),
  list: jest.fn(async (prefix) =>
    [...mockR2Store.keys()].filter((k) => k.startsWith(prefix))
  ),
}));

jest.mock("../lib/fetch-curl", () => ({
  enabled: false,
  fetchWithCurl: jest.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Imports (after mocks are declared)                                */
/* ------------------------------------------------------------------ */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../app");
const fetchUrl = require("../lib/fetch-url");
const r2Cache = require("../lib/r2-cache");

/* ------------------------------------------------------------------ */
/*  Test constants                                                    */
/* ------------------------------------------------------------------ */

const TEST_URL = "https://example.com/test-document.pdf";
const NORMALIZED_URL = new URL(TEST_URL).href;
const EXPECTED_HASH = crypto
  .createHash("sha256")
  .update(NORMALIZED_URL)
  .digest("hex");
const CACHE_DIR = path.join(__dirname, "..", ".cache");
const CACHE_FILE = path.join(CACHE_DIR, `${EXPECTED_HASH}.pdf`);
const META_FILE = CACHE_FILE + ".meta";

const ORIGINAL_PDF = Buffer.from("%PDF-1.0 original test content");
const UPDATED_PDF = Buffer.from("%PDF-1.0 updated content after upload");

/**
 * Build a mock Response object that looks like what fetch() returns.
 * The handlers call response.headers.get(), response.arrayBuffer(), etc.
 */
const createMockResponse = (buffer, contentType = "application/pdf") => {
  const headers = new Map([
    ["content-type", contentType],
    ["content-length", String(buffer.length)],
  ]);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers,
    arrayBuffer: jest.fn(async () => {
      // Convert Buffer to a proper ArrayBuffer
      const ab = new ArrayBuffer(buffer.length);
      new Uint8Array(ab).set(buffer);
      return ab;
    }),
  };
};

/* ------------------------------------------------------------------ */
/*  Cleanup                                                           */
/* ------------------------------------------------------------------ */

// Remove any leftover test files before AND after the suite
const cleanup = () => {
  if (!fs.existsSync(CACHE_DIR)) return;
  fs.readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith(EXPECTED_HASH))
    .forEach((f) => fs.unlinkSync(path.join(CACHE_DIR, f)));
};

beforeAll(cleanup);
afterAll(cleanup);

/* ------------------------------------------------------------------ */
/*  Tests — run in order, each step builds on the previous one        */
/* ------------------------------------------------------------------ */

describe("cache lifecycle (mirrors manual test workflow)", () => {
  beforeEach(() => {
    fetchUrl.mockClear();
    r2Cache.put.mockClear();
    r2Cache.get.mockClear();
    r2Cache.del.mockClear();
  });

  // ── Step 1 ────────────────────────────────────────────────────────
  test("1. /api/cache primes the cache from upstream", async () => {
    fetchUrl.mockResolvedValueOnce(createMockResponse(ORIGINAL_PDF));

    const res = await request(app)
      .get("/api/cache")
      .query({ url: TEST_URL });

    expect(res.status).toBe(200);
    expect(res.body.hash).toBe(EXPECTED_HASH);
    expect(res.body.ext).toBe(".pdf");
    expect(res.body.mime).toBe("application/pdf");
    expect(res.body.source).toBe("upstream");

    // File should now exist on disk
    expect(fs.existsSync(CACHE_FILE)).toBe(true);

    // Upstream fetch was called exactly once
    expect(fetchUrl).toHaveBeenCalledTimes(1);

    // R2 backup was triggered
    expect(r2Cache.put).toHaveBeenCalledWith(
      `${EXPECTED_HASH}.pdf`,
      expect.any(Buffer),
      expect.objectContaining({ "x-source-url": TEST_URL }),
    );
    expect(mockR2Store.has(`${EXPECTED_HASH}.pdf`)).toBe(true);
  });

  // ── Step 2 ────────────────────────────────────────────────────────
  test("2. /api/cache returns local cache hit (no upstream fetch)", async () => {
    const res = await request(app)
      .get("/api/cache")
      .query({ url: TEST_URL });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("local");

    // No upstream fetch needed — served from disk
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  // ── Step 3 ────────────────────────────────────────────────────────
  test("3. delete local file → /api/cache restores from R2", async () => {
    // Simulate: user manually deletes the local file
    fs.unlinkSync(CACHE_FILE);
    if (fs.existsSync(META_FILE)) fs.unlinkSync(META_FILE);
    expect(fs.existsSync(CACHE_FILE)).toBe(false);

    const res = await request(app)
      .get("/api/cache")
      .query({ url: TEST_URL });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("r2");

    // File should be restored to local cache from R2
    expect(fs.existsSync(CACHE_FILE)).toBe(true);

    // Still no upstream fetch — R2 had it
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  // ── Step 4 ────────────────────────────────────────────────────────
  test("4. /pxy/dl serves download from local cache", async () => {
    const res = await request(app)
      .get(`/pxy/dl/${encodeURIComponent(TEST_URL)}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["x-cache"]).toBe("local");

    // Content should match what was cached
    expect(res.body.toString()).toContain("original test content");

    // No upstream fetch — served from local cache
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  // ── Step 5 ────────────────────────────────────────────────────────
  test("5. /upload overwrites the cached file", async () => {
    const res = await request(app)
      .post("/upload")
      .attach("file", UPDATED_PDF, {
        filename: "test.pdf",
        contentType: "application/pdf",
      })
      .field("url", TEST_URL);

    expect(res.status).toBe(200);
    expect(res.text).toContain("Cached");

    // Local file should now contain the updated content
    const content = fs.readFileSync(CACHE_FILE);
    expect(content.toString()).toContain("updated content after upload");
  });

  // ── Step 6 ────────────────────────────────────────────────────────
  test("6. /pxy/dl serves the overwritten file", async () => {
    const res = await request(app)
      .get(`/pxy/dl/${encodeURIComponent(TEST_URL)}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("local");

    // Content should be the UPDATED file, not the original
    expect(res.body.toString()).toContain("updated content after upload");
    expect(res.body.toString()).not.toContain("original test content");
  });

  // ── Step 7 ────────────────────────────────────────────────────────
  test("7. /delete removes the cache entry", async () => {
    const res = await request(app)
      .post("/delete")
      .send(`hash=${EXPECTED_HASH}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("Deleted");

    // Local file should be gone
    expect(fs.existsSync(CACHE_FILE)).toBe(false);
    expect(fs.existsSync(META_FILE)).toBe(false);

    // R2 entry should also be gone
    expect(r2Cache.del).toHaveBeenCalled();
    expect(mockR2Store.has(`${EXPECTED_HASH}.pdf`)).toBe(false);
  });

  // ── Step 8 ────────────────────────────────────────────────────────
  test("8. /api/cache re-fetches from upstream after deletion", async () => {
    fetchUrl.mockResolvedValueOnce(createMockResponse(ORIGINAL_PDF));

    const res = await request(app)
      .get("/api/cache")
      .query({ url: TEST_URL });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("upstream");

    // Upstream fetch was needed — both local and R2 were empty
    expect(fetchUrl).toHaveBeenCalledTimes(1);
  });
});
