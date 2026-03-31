/**
 * Check whether a string is a valid, proxiable URL.
 * Rejects non-HTTP schemes, private/internal IPs, and loopback addresses
 * to prevent SSRF attacks.
 * @param {string} urlString - The string to validate
 * @returns {boolean} True if the URL is safe to proxy
 */
module.exports = (urlString) => {
  try {
    const url = new URL(urlString);

    // Only allow http and https
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    const host = url.hostname.toLowerCase();

    // Reject empty hostname
    if (!host) {
      return false;
    }

    // Reject loopback and localhost
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host === "0.0.0.0"
    ) {
      return false;
    }

    // Reject private and reserved IP ranges
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
    if (
      /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host)
    ) {
      return false;
    }

    // Reject common internal/local TLDs
    if (host.endsWith(".local") || host.endsWith(".internal")) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};
