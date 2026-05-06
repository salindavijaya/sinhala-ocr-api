'use strict';

/**
 * Unified API response format across all endpoints.
 *
 * Success:  { success: true,  data: {...}, meta?: {...} }
 * Error:    { success: false, error: { code, message, details? } }
 */

const success = (res, data = {}, statusCode = 200, meta = null) => {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
};

const created = (res, data = {}, meta = null) => success(res, data, 201, meta);

const noContent = (res) => res.status(204).send();

const error = (res, message, statusCode = 400, code = 'BAD_REQUEST', details = null) => {
  const body = {
    success: false,
    error: { code, message },
  };
  if (details) body.error.details = details;
  return res.status(statusCode).json(body);
};

const notFound = (res, message = 'Resource not found') =>
  error(res, message, 404, 'NOT_FOUND');

const unauthorized = (res, message = 'Authentication required') =>
  error(res, message, 401, 'UNAUTHORIZED');

const forbidden = (res, message = 'Access denied') =>
  error(res, message, 403, 'FORBIDDEN');

const serverError = (res, message = 'Internal server error') =>
  error(res, message, 500, 'INTERNAL_ERROR');

const validationError = (res, details) =>
  error(res, 'Validation failed', 422, 'VALIDATION_ERROR', details);

const tooManyRequests = (res, message = 'Too many requests') =>
  error(res, message, 429, 'RATE_LIMIT_EXCEEDED');

module.exports = {
  success,
  created,
  noContent,
  error,
  notFound,
  unauthorized,
  forbidden,
  serverError,
  validationError,
  tooManyRequests,
};
