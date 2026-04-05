/**
 * @module cidr
 * IPv4 CIDR allowlist checker for download endpoints.
 * Parses DL_ALLOWED_CIDRS env var at startup and exposes an isAllowed() check.
 * No external dependencies — uses bitwise arithmetic for subnet matching.
 * Also supports literal IPv6 entries (e.g. "::1") for localhost.
 */
const logger = require("./logger");

/**
 * Parse an IPv4 address string into a 32-bit unsigned integer.
 * Strips ::ffff: prefix (IPv4-mapped IPv6) before parsing.
 * @param {string} ip
 * @returns {number|null} 32-bit unsigned int, or null if not valid IPv4
 */
const ipToInt = (ip) => {
  const clean = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = clean.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
};

/**
 * Parse a CIDR string into network and mask integers.
 * A bare IP (no slash) is treated as /32.
 * @param {string} cidr - e.g. "192.168.1.0/24" or "10.0.0.5"
 * @returns {{ network: number, mask: number }|null}
 */
const parseCidr = (cidr) => {
  const [ipStr, prefixStr] = cidr.trim().split("/");
  const ip = ipToInt(ipStr);
  if (ip === null) return null;
  const prefix = prefixStr !== undefined ? Number(prefixStr) : 32;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return { network: (ip & mask) >>> 0, mask };
};

const raw = process.env.DL_ALLOWED_CIDRS || "";
const allowedRanges = [];
const allowedLiterals = new Set();

if (raw.trim()) {
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    const parsed = parseCidr(trimmed);
    if (parsed) {
      allowedRanges.push(parsed);
    } else if (trimmed) {
      // Store as literal (e.g. "::1") for exact-match against IPv6 addresses
      allowedLiterals.add(trimmed);
    }
  }
  const total = allowedRanges.length + allowedLiterals.size;
  logger.info(`CIDR allowlist active: ${total} entry/entries loaded from DL_ALLOWED_CIDRS=${raw}`);
} else {
  logger.info("CIDR allowlist disabled (DL_ALLOWED_CIDRS not set)");
}

const enabled = allowedRanges.length > 0 || allowedLiterals.size > 0;

/**
 * Check whether an IP address is within the allowed ranges.
 * Returns true (allow all) when DL_ALLOWED_CIDRS is not configured.
 * Supports IPv4 CIDR matching and literal IPv6 matching (e.g. ::1).
 * @param {string} ip - Client IP address (from req.ip)
 * @returns {boolean}
 */
const isAllowed = (ip) => {
  if (!enabled) return true;
  if (!ip || typeof ip !== "string") return false;
  // Literal match first (covers ::1 and any non-CIDR entries)
  if (allowedLiterals.has(ip)) return true;
  const addr = ipToInt(ip);
  if (addr === null) return false;
  return allowedRanges.some((r) => ((addr & r.mask) >>> 0) === r.network);
};

/**
 * Extract the real client IP from a request.
 * Prefers CF-Connecting-IP (set by Cloudflare, not spoofable) over req.ip,
 * which is unreliable when the number of proxy hops varies.
 * @param {import('express').Request} req
 * @returns {string}
 */
const clientIp = (req) => (req.headers && req.headers["cf-connecting-ip"]) || req.ip;

module.exports = { enabled, isAllowed, clientIp, ipToInt, parseCidr };
