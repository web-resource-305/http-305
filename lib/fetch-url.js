/**
 * @module fetch-url
 * Wrapper around native fetch with Googlebot user-agent, 10s timeout,
 * and network error → HTTP status code mapping.
 */
const logger = require("./logger");

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Accept-Language": "en-US",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "From": "googlebot(at)googlebot.com",
  "Accept-Encoding": "gzip, deflate, br",
};

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
      headers: FETCH_HEADERS,
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
