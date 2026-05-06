'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiKey = require('../models/ApiKey');
const config = require('../config');
const { success, created, error, notFound, unauthorized } = require('../utils/apiResponse');
const logger = require('../utils/logger');

const signToken = (userId, role) =>
  jwt.sign({ sub: userId, role }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

/**
 * POST /auth/register
 */
const register = async (req, res) => {
  const { name, email, password } = req.body;

  // Check for duplicate email
  const existing = await User.findByEmail(email);
  if (existing) {
    return error(res, 'An account with this email already exists.', 409, 'EMAIL_TAKEN');
  }

  const user = await User.create({ name, email, password });
  const token = signToken(user.id, user.role);

  logger.info('New user registered', { userId: user.id, email: user.email });

  return created(res, {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    token,
  });
};

/**
 * POST /auth/login
 */
const login = async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findByEmail(email);
  if (!user) return unauthorized(res, 'Invalid credentials');

  const valid = await User.verifyPassword(password, user.password_hash);
  if (!valid) return unauthorized(res, 'Invalid credentials');

  if (!user.is_active) return error(res, 'Account is deactivated', 403, 'ACCOUNT_INACTIVE');

  const token = signToken(user.id, user.role);

  logger.info('User logged in', { userId: user.id });

  return success(res, {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    token,
    expiresIn: config.jwt.expiresIn,
  });
};

/**
 * GET /auth/me
 */
const getMe = async (req, res) => {
  return success(res, { user: req.user });
};

/**
 * POST /auth/api-keys — Create a new API key
 */
const createApiKey = async (req, res) => {
  const { name } = req.body;
  const apiKey = await ApiKey.create({ userId: req.user.id, name });

  logger.info('API key created', { userId: req.user.id, keyId: apiKey.id });

  // plainKey shown ONCE — never stored
  return created(res, {
    id: apiKey.id,
    name: apiKey.name,
    key: apiKey.plainKey,          // ← return once only
    prefix: apiKey.key_prefix,
    created_at: apiKey.created_at,
    warning: 'Store this key securely. It will not be shown again.',
  });
};

/**
 * GET /auth/api-keys — List all API keys for the authenticated user
 */
const listApiKeys = async (req, res) => {
  const keys = await ApiKey.findByUserId(req.user.id);
  return success(res, { keys });
};

/**
 * DELETE /auth/api-keys/:keyId — Revoke an API key
 */
const revokeApiKey = async (req, res) => {
  const revoked = await ApiKey.revoke({ keyId: req.params.keyId, userId: req.user.id });
  if (!revoked) return notFound(res, 'API key not found');

  logger.info('API key revoked', { userId: req.user.id, keyId: req.params.keyId });
  return success(res, { message: 'API key revoked successfully' });
};

module.exports = { register, login, getMe, createApiKey, listApiKeys, revokeApiKey };
