const pool = require('../config/db');

/**
 * Check if an idempotency key already exists.
 * @param {string} key
 * @returns {object|null} stored idempotency record or null
 */
async function checkIdempotencyKey(key) {
  const [rows] = await pool.execute(
    'SELECT * FROM idempotency_keys WHERE `key` = ?',
    [key]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Save a new idempotency key with the response body.
 * @param {string} key
 * @param {string} targetType
 * @param {number} targetId
 * @param {string} status
 * @param {object} responseBody
 */
async function saveIdempotencyKey(key, targetType, targetId, status, responseBody) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  await pool.execute(
    'INSERT INTO idempotency_keys (`key`, target_type, target_id, status, response_body, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [key, targetType, targetId, status, JSON.stringify(responseBody), expiresAt]
  );
}

module.exports = { checkIdempotencyKey, saveIdempotencyKey };
