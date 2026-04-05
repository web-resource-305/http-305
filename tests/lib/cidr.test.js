// cidr.js reads DL_ALLOWED_CIDRS at require-time, so we use
// jest.resetModules() + fresh require() for each env configuration.

// Load a copy with no env var set to test pure functions.
const { ipToInt, parseCidr } = require("../../lib/cidr");

describe("ipToInt", () => {
  test("converts 0.0.0.0 to 0", () => {
    expect(ipToInt("0.0.0.0")).toBe(0);
  });

  test("converts 255.255.255.255 to 4294967295", () => {
    expect(ipToInt("255.255.255.255")).toBe(4294967295);
  });

  test("converts 192.168.1.1 correctly", () => {
    expect(ipToInt("192.168.1.1")).toBe(3232235777);
  });

  test("converts 10.0.0.1 correctly", () => {
    expect(ipToInt("10.0.0.1")).toBe(167772161);
  });

  test("strips ::ffff: prefix (IPv4-mapped IPv6)", () => {
    expect(ipToInt("::ffff:127.0.0.1")).toBe(ipToInt("127.0.0.1"));
  });

  test("returns null for too few octets", () => {
    expect(ipToInt("1.2.3")).toBeNull();
  });

  test("returns null for octet > 255", () => {
    expect(ipToInt("256.0.0.0")).toBeNull();
  });

  test("returns null for non-numeric octets", () => {
    expect(ipToInt("abc.def.ghi.jkl")).toBeNull();
  });

  test("returns null for IPv6 address", () => {
    expect(ipToInt("::1")).toBeNull();
  });
});

describe("parseCidr", () => {
  test("parses /24 CIDR", () => {
    const result = parseCidr("192.168.1.0/24");
    expect(result).not.toBeNull();
    expect(result.network).toBe(ipToInt("192.168.1.0"));
    expect(result.mask).toBe(0xffffff00 >>> 0);
  });

  test("treats bare IP as /32", () => {
    const result = parseCidr("10.0.0.5");
    expect(result).not.toBeNull();
    expect(result.network).toBe(ipToInt("10.0.0.5"));
    expect(result.mask).toBe(0xffffffff >>> 0);
  });

  test("parses /0 (match all)", () => {
    const result = parseCidr("0.0.0.0/0");
    expect(result).not.toBeNull();
    expect(result.mask).toBe(0);
  });

  test("parses /32 (exact match)", () => {
    const result = parseCidr("1.2.3.4/32");
    expect(result).not.toBeNull();
    expect(result.mask).toBe(0xffffffff >>> 0);
  });

  test("returns null for invalid prefix > 32", () => {
    expect(parseCidr("10.0.0.0/33")).toBeNull();
  });

  test("returns null for non-IPv4", () => {
    expect(parseCidr("::1/128")).toBeNull();
  });

  test("masks host bits correctly", () => {
    const result = parseCidr("192.168.1.55/24");
    // Host bits should be zeroed
    expect(result.network).toBe(ipToInt("192.168.1.0"));
  });
});

describe("module behavior — CIDRS unset", () => {
  let cidr;

  beforeEach(() => {
    jest.resetModules();
    process.env.DL_ALLOWED_CIDRS = "";
    cidr = require("../../lib/cidr");
  });

  afterEach(() => {
    delete process.env.DL_ALLOWED_CIDRS;
  });

  test("enabled is false", () => {
    expect(cidr.enabled).toBe(false);
  });

  test("isAllowed returns true for any IP (allow all)", () => {
    expect(cidr.isAllowed("1.2.3.4")).toBe(true);
    expect(cidr.isAllowed("10.0.0.1")).toBe(true);
  });
});

describe("module behavior — CIDRS set", () => {
  let cidr;

  beforeEach(() => {
    jest.resetModules();
    process.env.DL_ALLOWED_CIDRS = "192.168.1.0/24,10.0.0.5,::1";
    cidr = require("../../lib/cidr");
  });

  afterEach(() => {
    delete process.env.DL_ALLOWED_CIDRS;
  });

  test("enabled is true", () => {
    expect(cidr.enabled).toBe(true);
  });

  test("allows IP within CIDR range", () => {
    expect(cidr.isAllowed("192.168.1.50")).toBe(true);
    expect(cidr.isAllowed("192.168.1.255")).toBe(true);
  });

  test("rejects IP outside CIDR range", () => {
    expect(cidr.isAllowed("192.168.2.1")).toBe(false);
    expect(cidr.isAllowed("172.16.0.1")).toBe(false);
  });

  test("allows exact /32 match", () => {
    expect(cidr.isAllowed("10.0.0.5")).toBe(true);
  });

  test("rejects IP near /32 entry", () => {
    expect(cidr.isAllowed("10.0.0.6")).toBe(false);
  });

  test("allows literal IPv6 match", () => {
    expect(cidr.isAllowed("::1")).toBe(true);
  });

  test("rejects unrecognized IPv6", () => {
    expect(cidr.isAllowed("::2")).toBe(false);
  });

  test("rejects null", () => {
    expect(cidr.isAllowed(null)).toBe(false);
  });

  test("rejects empty string", () => {
    expect(cidr.isAllowed("")).toBe(false);
  });

  test("handles IPv4-mapped IPv6 addresses", () => {
    expect(cidr.isAllowed("::ffff:192.168.1.50")).toBe(true);
  });
});

describe("clientIp", () => {
  const { clientIp } = require("../../lib/cidr");

  test("prefers CF-Connecting-IP over req.ip", () => {
    const req = { ip: "10.0.0.1", headers: { "cf-connecting-ip": "86.150.91.139" } };
    expect(clientIp(req)).toBe("86.150.91.139");
  });

  test("falls back to req.ip when CF-Connecting-IP is absent", () => {
    const req = { ip: "203.0.113.50", headers: {} };
    expect(clientIp(req)).toBe("203.0.113.50");
  });

  test("falls back to req.ip when headers is undefined", () => {
    const req = { ip: "203.0.113.50" };
    expect(clientIp(req)).toBe("203.0.113.50");
  });
});
