'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const { query } = require('../config/database');
const { unauthorized, forbidden } = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * Verify JWT from Authorization: Bearer <token> header.
 */
const authenticateJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return unauthorized(res, 'Missing or malformed Authorization header');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret);

    // Fetch fresh user data (catches deactivated accounts mid-session)
    const result = await query(
      'SELECT id, email, name, role, is_active FROM users WHERE id = $1',
      [decoded.sub]
    );

    if (!result.rows.length) return unauthorized(res, 'User not found');
    const user = result.rows[0];
    if (!user.is_active) return forbidden(res, 'Account is deactivated');

    req.user = user;
    req.authType = 'jwt';
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return unauthorized(res, 'Token has expired');
    if (err.name === 'JsonWebTokenError') return unauthorized(res, 'Invalid token');
    logger.error('JWT auth error', { error: err.message });
    return unauthorized(res, 'Authentication failed');
  }
};

/**
 * Verify API key from X-API-Key header.
 * Keys are stored as SHA-256 hashes; only prefix is stored in plaintext for display.
 */
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return unauthorized(res, 'Missing X-API-Key header');

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const result = await query(
      `SELECT ak.id, ak.user_id, ak.name, ak.is_active,
              u.id as uid, u.email, u.name as user_name, u.role, u.is_active as user_active
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
       WHERE ak.key_hash = $1`,
      [keyHash]
    );

    if (!result.rows.length) return unauthorized(res, 'Invalid API key');
    const row = result.rows[0];

    if (!row.is_active) return forbidden(res, 'API key is revoked');
    if (!row.user_active) return forbidden(res, 'Account is deactivated');

    // Update last_used_at asynchronously (fire-and-forget)
    query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => {});

    req.user = { id: row.uid, email: row.email, name: row.user_name, role: row.role };
    req.apiKeyId = row.id;
    req.authType = 'api_key';
    next();
  } catch (err) {
    logger.error('API key auth error', { error: err.message });
    return unauthorized(res, 'Authentication failed');
  }
};

/**
 * Accepts EITHER JWT or API key — tries API key first, then JWT.
 * This is the main middleware for protected endpoints.
 */
const authenticate = async (req, res, next) => {
  if (req.headers['x-api-key']) {
    return authenticateApiKey(req, res, next);
  }
  return authenticateJWT(req, res, next);
};

/**
 * Role-based access control. Must be used after authenticate().
 * @param {...string} roles - allowed roles
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return unauthorized(res);
  if (!roles.includes(req.user.role)) {
    return forbidden(res, `Required role: ${roles.join(' or ')}`);
  }
  next();
};

module.exports = { authenticate, authenticateJWT, authenticateApiKey, requireRole };
