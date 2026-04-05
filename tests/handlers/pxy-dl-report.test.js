"use strict";

jest.mock("fs", () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  createReadStream: jest.fn(),
  unlinkSync: jest.fn(),
}));

jest.mock("../../lib/cidr", () => ({
  enabled: false,
  isAllowed: jest.fn(),
}));

jest.mock("../../lib/fetch-curl", () => ({
  enabled: false,
  fetchWithCurl: jest.fn(),
}));

jest.mock("../../lib/r2-cache", () => ({
  enabled: false,
  listAll: jest.fn(),
  put: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  list: jest.fn(),
}));

const fs = require("fs");
const cidr = require("../../lib/cidr");
const r2Cache = require("../../lib/r2-cache");
const { reportHandler } = require("../../handlers/pxy-dl");

const mockReq = (ip = "127.0.0.1") => ({ ip });
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  cidr.isAllowed.mockReturnValue(true);
  fs.existsSync.mockReturnValue(true);
  fs.readdirSync.mockReturnValue([]);
  r2Cache.enabled = false;
});

describe("reportHandler — GET /api/cache/report", () => {
  test("returns 403 when IP is not in CIDR allowlist", async () => {
    cidr.isAllowed.mockReturnValue(false);
    const res = mockRes();

    await reportHandler(mockReq("1.2.3.4"), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" });
  });

  test("returns empty local stats when cache dir does not exist", async () => {
    fs.existsSync.mockReturnValue(false);
    const res = mockRes();

    await reportHandler(mockReq(), res);

    expect(res.json).toHaveBeenCalledWith({
      local: { fileCount: 0, totalSizeBytes: 0, byExtension: {} },
      r2: { enabled: false },
    });
    expect(fs.readdirSync).not.toHaveBeenCalled();
  });

  test("returns zero counts when cache dir exists but is empty", async () => {
    fs.readdirSync.mockReturnValue([]);
    const res = mockRes();

    await reportHandler(mockReq(), res);

    expect(res.json).toHaveBeenCalledWith({
      local: { fileCount: 0, totalSizeBytes: 0, byExtension: {} },
      r2: { enabled: false },
    });
  });

  test("counts files, sums sizes, and groups by extension", async () => {
    fs.readdirSync.mockReturnValue(["abc.pdf", "def.docx", "ghi.pdf"]);
    fs.statSync
      .mockReturnValueOnce({ size: 1000 })  // abc.pdf
      .mockReturnValueOnce({ size: 2000 })  // def.docx
      .mockReturnValueOnce({ size: 500 });  // ghi.pdf
    const res = mockRes();

    await reportHandler(mockReq(), res);

    expect(res.json).toHaveBeenCalledWith({
      local: {
        fileCount: 3,
        totalSizeBytes: 3500,
        byExtension: {
          ".pdf": { count: 2, sizeBytes: 1500 },
          ".docx": { count: 1, sizeBytes: 2000 },
        },
      },
      r2: { enabled: false },
    });
  });

  test("skips .meta sidecar files in local cache", async () => {
    fs.readdirSync.mockReturnValue(["abc.pdf", "abc.pdf.meta"]);
    fs.statSync.mockReturnValue({ size: 1000 });
    const res = mockRes();

    await reportHandler(mockReq(), res);

    const result = res.json.mock.calls[0][0];
    expect(result.local.fileCount).toBe(1);
    expect(result.local.totalSizeBytes).toBe(1000);
    expect(fs.statSync).toHaveBeenCalledTimes(1);
  });

  test("includes R2 stats when R2 is enabled", async () => {
    r2Cache.enabled = true;
    r2Cache.listAll.mockResolvedValue([
      { key: "abc.pdf", size: 3000 },
      { key: "def.xlsx", size: 1500 },
    ]);
    const res = mockRes();

    await reportHandler(mockReq(), res);

    const result = res.json.mock.calls[0][0];
    expect(result.r2).toEqual({
      enabled: true,
      fileCount: 2,
      totalSizeBytes: 4500,
      byExtension: {
        ".pdf": { count: 1, sizeBytes: 3000 },
        ".xlsx": { count: 1, sizeBytes: 1500 },
      },
    });
  });

  test("skips .meta sidecar files in R2 listing", async () => {
    r2Cache.enabled = true;
    r2Cache.listAll.mockResolvedValue([
      { key: "abc.pdf", size: 3000 },
      { key: "abc.pdf.meta", size: 100 },
    ]);
    const res = mockRes();

    await reportHandler(mockReq(), res);

    const result = res.json.mock.calls[0][0];
    expect(result.r2.fileCount).toBe(1);
    expect(result.r2.totalSizeBytes).toBe(3000);
  });

  test("returns 500 when reading local cache throws", async () => {
    fs.readdirSync.mockImplementation(() => { throw new Error("disk failure"); });
    const res = mockRes();

    await reportHandler(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
  });

  test("returns 500 when R2 listAll rejects", async () => {
    r2Cache.enabled = true;
    r2Cache.listAll.mockRejectedValue(new Error("R2 unavailable"));
    const res = mockRes();

    await reportHandler(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
  });
});
