/**
 * Check whether a string is a valid, parseable URL.
 * @param {string} urlString - The string to validate
 * @returns {boolean} True if the string can be parsed as a URL
 */
module.exports = (urlString) => {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
};
