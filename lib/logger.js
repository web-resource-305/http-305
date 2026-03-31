/**
 * @module logger
 * Winston logger instance. Level controlled by LOG_LEVEL env var (default: "info").
 */
const { createLogger, transports, format } = require("winston");

require("dotenv").config();

module.exports = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp(),
    format.printf(
      ({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`,
    ),
  ),
  transports: [new transports.Console()],
});
