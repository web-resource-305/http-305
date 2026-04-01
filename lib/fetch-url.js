/**
 * @module fetch-url
 * Wrapper around native fetch with Googlebot user-agent, 10s timeout,
 * and network error → HTTP status code mapping.
 */
const logger = require("./logger");

const USER_AGENTS = [
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
];

const buildHeaders = () => ({
  "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
});

const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT) || 10000;

/**
 * Fetch a URL with Googlebot headers and a configurable timeout.
 * @param {string} url - Absolute URL to fetch
 * @returns {Promise<Response>} The fetch response
 * @throws {{ status: number, message: string }} Mapped HTTP error on network failure
 */
module.exports = async (url) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  let response;
  try {
    response = await fetch(url, {
      headers: buildHeaders(),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    const error = new Error();

    if (fetchErr.name === "AbortError") {
      error.status = 504;
      error.message = "The remote server took too long to respond";
    } else if (fetchErr.cause) {
      const code = fetchErr.cause.code || "";
      if (code === "ENOTFOUND") {
        error.status = 502;
        error.message = "Could not resolve the remote host";
      } else if (code === "ECONNREFUSED") {
        error.status = 502;
        error.message = "The remote server refused the connection";
      } else if (code === "ECONNRESET") {
        error.status = 502;
        error.message = "The remote server reset the connection";
      } else {
        error.status = 502;
        error.message = "Could not reach the remote server";
      }
    } else {
      error.status = 502;
      error.message = "Could not reach the remote server";
    }
    logger.error(`Fetch failed for ${url}: ${error.message}`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  return response;
};
