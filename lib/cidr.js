/**
 * @module cidr
 * IPv4 CIDR allowlist checker for download endpoints.
 * Parses DL_ALLOWED_CIDRS env var at startup and exposes an isAllowed() check.
 * No external dependencies — uses bitwise arithmetic for subnet matching.
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

if (raw.trim()) {
  for (const entry of raw.split(",")) {
    const parsed = parseCidr(entry);
    if (parsed) {
      allowedRanges.push(parsed);
    } else {
      logger.warn(`Invalid CIDR in DL_ALLOWED_CIDRS, skipping: "${entry.trim()}"`);
    }
  }
  logger.info(`CIDR allowlist active: ${allowedRanges.length} range(s) loaded`);
} else {
  logger.info("CIDR allowlist disabled (DL_ALLOWED_CIDRS not set)");
}

const enabled = allowedRanges.length > 0;

/**
 * Check whether an IPv4 address is within the allowed CIDR ranges.
 * Returns true (allow all) when DL_ALLOWED_CIDRS is not configured.
 * @param {string} ip - Client IP address (from req.ip)
 * @returns {boolean}
 */
const isAllowed = (ip) => {
  if (!enabled) return true;
  if (!ip || typeof ip !== "string") return false;
  const addr = ipToInt(ip);
  if (addr === null) return false;
  return allowedRanges.some((r) => ((addr & r.mask) >>> 0) === r.network);
};

module.exports = { enabled, isAllowed, ipToInt, parseCidr };
