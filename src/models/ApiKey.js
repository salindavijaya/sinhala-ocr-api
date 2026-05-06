'use strict';

const crypto = require('crypto');
const { query } = require('../config/database');

const API_KEY_PREFIX = 'sk_';

const ApiKey = {
  /**
   * Generate a new API key.
   * Returns { plainKey, prefix, hash } — plainKey must be shown ONCE to the user.
   */
  generate() {
    const raw = crypto.randomBytes(32).toString('hex');
    const plainKey = `${API_KEY_PREFIX}${raw}`;
    const prefix = plainKey.substring(0, 12) + '...'; // display only
    const hash = crypto.createHash('sha256').update(plainKey).digest('hex');
    return { plainKey, prefix, hash };
  },

  /**
   * Persist a new API key. Returns the row (without hash).
   */
  async create({ userId, name }) {
    const { plainKey, prefix, hash } = ApiKey.generate();
    const result = await query(
      `INSERT INTO api_keys (user_id, name, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, key_prefix, is_active, created_at`,
      [userId, name, prefix, hash]
    );
    // Attach plainKey to result so controller can return it once
    return { ...result.rows[0], plainKey };
  },

  /**
   * List all keys for a user (never exposes hash).
   */
  async findByUserId(userId) {
    const result = await query(
      `SELECT id, name, key_prefix, is_active, last_used_at, created_at
       FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  },

  /**
   * Revoke (soft-delete) a key. Validates ownership.
   */
  async revoke({ keyId, userId }) {
    const result = await query(
      `UPDATE api_keys SET is_active = false
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [keyId, userId]
    );
    return result.rows[0] || null;
  },
};

module.exports = ApiKey;
