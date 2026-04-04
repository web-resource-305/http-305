/**
 * @module r2-cache
 * Optional Cloudflare R2 (S3-compatible) cache layer.
 * Active only when R2_ACCESS_KEY_ID environment variable is set.
 */
const logger = require("./logger");

const R2_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
];
const missing = R2_VARS.filter((v) => !process.env[v]);
const enabled = missing.length === 0;

if (!enabled) {
  if (missing.length < R2_VARS.length && missing.length > 0) {
    logger.warn(`R2 cache layer disabled (missing: ${missing.join(", ")})`);
  } else {
    logger.info("R2 cache layer disabled (no credentials)");
  }
  module.exports = {
    enabled: false,
    put: async () => false,
    get: async () => null,
    del: async () => false,
    list: async () => [],
  };
} else {
  const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
  } = require("@aws-sdk/client-s3");

  const BUCKET = process.env.R2_BUCKET_NAME;

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  logger.info("R2 cache layer enabled");

  /**
   * Convert a readable stream to a Buffer.
   */
  const streamToBuffer = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };

  /**
   * Upload a buffer to R2.
   * @param {string} key - Object key (e.g. "abc123.pdf")
   * @param {Buffer} buffer - File contents
   * @param {object} metadata - Custom metadata (x-source-url, x-cached-at, x-mime)
   * @returns {Promise<boolean>} true on success
   */
  const put = async (key, buffer, metadata = {}) => {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: buffer,
          Metadata: metadata,
        }),
      );
      logger.info(`R2 upload OK: ${key} (${buffer.length} bytes)`);
      return true;
    } catch (err) {
      logger.warn(`R2 upload failed for ${key}: ${err.message}`);
      return false;
    }
  };

  /**
   * Download an object from R2.
   * @param {string} key - Object key
   * @returns {Promise<{buffer: Buffer, metadata: object}|null>} null on miss or error
   */
  const get = async (key) => {
    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: key,
        }),
      );
      const buffer = await streamToBuffer(response.Body);
      logger.info(`R2 download OK: ${key} (${buffer.length} bytes)`);
      return { buffer, metadata: response.Metadata || {} };
    } catch (err) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      logger.warn(`R2 download failed for ${key}: ${err.message}`);
      return null;
    }
  };

  /**
   * Delete an object from R2.
   * @param {string} key - Object key
   * @returns {Promise<boolean>} true on success
   */
  const del = async (key) => {
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: key,
        }),
      );
      logger.info(`R2 delete OK: ${key}`);
      return true;
    } catch (err) {
      logger.warn(`R2 delete failed for ${key}: ${err.message}`);
      return false;
    }
  };

  /**
   * List objects by key prefix.
   * @param {string} prefix - Key prefix (e.g. a SHA256 hash)
   * @returns {Promise<string[]>} matching keys
   */
  const list = async (prefix) => {
    try {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: prefix,
          MaxKeys: 20,
        }),
      );
      return (response.Contents || []).map((obj) => obj.Key);
    } catch (err) {
      logger.warn(`R2 list failed for prefix ${prefix}: ${err.message}`);
      return [];
    }
  };

  module.exports = { enabled: true, put, get, del, list };
}
