'use strict';

const bcrypt = require('bcryptjs');
const { query } = require('../config/database');

const BCRYPT_ROUNDS = 12;

const User = {
  /**
   * Create a new user. Returns the created user (without password_hash).
   */
  async create({ name, email, password }) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, role, is_active, created_at`,
      [name, email.toLowerCase(), passwordHash]
    );
    return result.rows[0];
  },

  /**
   * Find a user by email (includes password_hash for login checks).
   */
  async findByEmail(email) {
    const result = await query(
      'SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    return result.rows[0] || null;
  },

  /**
   * Find a user by ID (excludes password_hash).
   */
  async findById(id) {
    const result = await query(
      'SELECT id, name, email, role, is_active, created_at FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  },

  /**
   * Verify a plain-text password against the stored hash.
   */
  async verifyPassword(plainPassword, hash) {
    return bcrypt.compare(plainPassword, hash);
  },

  /**
   * Soft-deactivate a user.
   */
  async deactivate(id) {
    const result = await query(
      'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rows[0] || null;
  },
};

module.exports = User;
