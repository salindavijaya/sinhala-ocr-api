'use strict';

const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedisClient } = require('../config/redis');
const config = require('../config');
const { tooManyRequests } = require('../utils/apiResponse');

const buildStore = (prefix) =>
  new RedisStore({
    sendCommand: (...args) => getRedisClient().call(...args),
    prefix: `rl:${prefix}:`,
  });

/**
 * General API rate limiter — 100 req / 15 min per IP.
 */
const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore('general'),
  handler: (req, res) => tooManyRequests(res, 'Too many requests. Please slow down.'),
  skip: () => config.isTest,
});

/**
 * Transcription endpoint limiter — 20 uploads / hr per user or IP.
 * Keyed by user ID if authenticated, IP otherwise.
 */
const transcribeLimiter = rateLimit({
  windowMs: config.rateLimit.transcribeWindowMs,
  max: config.rateLimit.transcribeMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore('transcribe'),
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) =>
    tooManyRequests(res, `Transcription limit: max ${config.rateLimit.transcribeMax} uploads per hour.`),
  skip: () => config.isTest,
});

/**
 * Auth endpoint limiter — 10 attempts / 15 min per IP (brute force protection).
 */
const authLimiter = rateLimit({
  windowMs: 900000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore('auth'),
  handler: (req, res) => tooManyRequests(res, 'Too many auth attempts. Try again in 15 minutes.'),
  skip: () => config.isTest,
});

module.exports = { generalLimiter, transcribeLimiter, authLimiter };
