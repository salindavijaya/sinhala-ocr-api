'use strict';

const express = require('express');
const router = express.Router();
const { healthCheck: dbHealth } = require('../config/database');
const { healthCheck: redisHealth } = require('../config/redis');
const { healthCheck: queueHealth } = require('../services/queue.service');
const { success, serverError } = require('../utils/apiResponse');
const config = require('../config');
const { Sentry } = require('../utils/sentry');

/**
 * GET /health — readiness probe (checks all dependencies)
 */
router.get('/', async (req, res) => {
  const checks = {};

  try {
    checks.database = await dbHealth();
    checks.database.status = 'ok';
  } catch (err) {
    Sentry.captureException(err);
    checks.database = { status: 'error', message: err.message };
  }

  try {
    checks.redis = await redisHealth();
  } catch (err) {
    Sentry.captureException(err);
    checks.redis = { status: 'error', message: err.message };
  }

  try {
    checks.queue = await queueHealth();
    checks.queue.status = 'ok';
  } catch (err) {
    Sentry.captureException(err);
    checks.queue = { status: 'error', message: err.message };
  }

  const allHealthy = Object.values(checks).every((c) => c.status === 'ok');

  const statusCode = allHealthy ? 200 : 503;
  const response = {
    status: allHealthy ? 'healthy' : 'degraded',
    version: process.env.npm_package_version || '1.0.0',
    environment: config.env,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    checks,
  };

  return res.status(statusCode).json({ success: allHealthy, data: response });
});

/**
 * GET /health/live — lightweight liveness probe (just 200 OK)
 */
router.get('/live', (req, res) => {
  res.status(200).json({ success: true, data: { alive: true } });
});

module.exports = router;
