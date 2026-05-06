'use strict';

const logger = require('../utils/logger');
const config = require('../config');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const isServerError = statusCode >= 500;

  if (isServerError) {
    logger.error('Unhandled server error', {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      userId: req.user?.id,
    });
  } else {
    logger.warn('Handled client error', {
      message: err.message,
      path: req.path,
      statusCode,
    });
  }

  const response = {
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: isServerError && config.isProd ? 'Internal server error' : err.message,
    },
  };

  if (!config.isProd && err.stack) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

/**
 * Catches async errors in Express route handlers.
 * Wrap route handler: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { errorHandler, asyncHandler };
