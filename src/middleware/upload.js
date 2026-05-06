'use strict';

const multer = require('multer');
const path = require('path');
const config = require('../config');
const { error } = require('../utils/apiResponse');

// Use memory storage — we stream directly to GCS without temp files on disk
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!config.upload.allowedMimeTypes.includes(file.mimetype)) {
    return cb(
      new multer.MulterError(
        'LIMIT_UNEXPECTED_FILE',
        `File type '${file.mimetype}' is not allowed. Accepted: ${config.upload.allowedMimeTypes.join(', ')}`
      ),
      false
    );
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: {
    fileSize: config.upload.maxFileSizeMb * 1024 * 1024,
    files: 1,
  },
  fileFilter,
});

/**
 * Middleware that wraps multer.single() and converts multer errors to our standard format.
 */
const uploadSingle = (fieldName) => (req, res, next) => {
  upload.single(fieldName)(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return error(res, `File too large. Maximum allowed size is ${config.upload.maxFileSizeMb}MB.`, 413, 'FILE_TOO_LARGE');
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return error(res, err.field || 'Invalid file type', 415, 'UNSUPPORTED_MEDIA_TYPE');
      }
      return error(res, err.message, 400, 'UPLOAD_ERROR');
    }
    next(err);
  });
};

/**
 * Validate that a file was actually attached to the request.
 */
const requireFile = (req, res, next) => {
  if (!req.file) {
    return error(res, 'No file uploaded. Please attach a file under the "document" field.', 400, 'NO_FILE');
  }
  next();
};

module.exports = { uploadSingle, requireFile };
