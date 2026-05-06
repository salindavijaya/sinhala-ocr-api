'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/transcription.controller');
const { authenticate } = require('../middleware/auth');
const { transcribeLimiter } = require('../middleware/rateLimiter');
const { uploadSingle, requireFile } = require('../middleware/upload');
const { validate, transcribeSchema } = require('../utils/validators');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * POST /transcribe
 * multipart/form-data
 *   - document: file (required) — image/jpeg, image/png, image/tiff, application/pdf
 *   - output_format: 'json' | 'docx' | 'pdf' | 'all'  (default: 'all')
 *   - language_hint: 'si' | 'si-LK' (default: 'si')
 *   - preserve_layout: boolean (default: false)
 */
router.post(
  '/',
  authenticate,
  transcribeLimiter,
  uploadSingle('document'),
  requireFile,
  validate(transcribeSchema),
  asyncHandler(ctrl.transcribe)
);

module.exports = router;
