'use strict';

const { Storage } = require('@google-cloud/storage');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const storageClient = new Storage({
  projectId: config.gcp.projectId,
  ...(config.gcp.keyFile && { keyFilename: config.gcp.keyFile }),
});

const inputBucket = storageClient.bucket(config.gcp.storage.inputBucket);
const outputBucket = storageClient.bucket(config.gcp.storage.outputBucket);

/**
 * Upload a buffer to GCS. Returns the GCS object path.
 * @param {Buffer} buffer - File content
 * @param {string} destination - Object path within the bucket
 * @param {string} contentType - MIME type
 * @param {'input'|'output'} bucketType
 */
const uploadBuffer = async (buffer, destination, contentType, bucketType = 'input') => {
  const bucket = bucketType === 'output' ? outputBucket : inputBucket;
  const file = bucket.file(destination);

  await file.save(buffer, {
    metadata: { contentType },
    resumable: false, // for files < 5MB; use true for larger
  });

  logger.info('File uploaded to GCS', { destination, bucket: bucket.name, size: buffer.length });
  return destination;
};

/**
 * Download a file from GCS as a Buffer.
 */
const downloadBuffer = async (gcsPath, bucketType = 'input') => {
  const bucket = bucketType === 'input' ? inputBucket : outputBucket;
  const [buffer] = await bucket.file(gcsPath).download();
  return buffer;
};

/**
 * Generate a signed download URL valid for config.gcp.storage.signedUrlExpiry seconds.
 */
const getSignedUrl = async (gcsPath, bucketType = 'output') => {
  if (config.isTest) return `https://storage.example.com/${gcsPath}`;

  const bucket = bucketType === 'output' ? outputBucket : inputBucket;
  const expiresAt = Date.now() + config.gcp.storage.signedUrlExpiry * 1000;

  const [url] = await bucket.file(gcsPath).getSignedUrl({
    action: 'read',
    expires: expiresAt,
  });
  return url;
};

/**
 * Delete a file from GCS. Silently ignores 404s.
 */
const deleteFile = async (gcsPath, bucketType = 'output') => {
  try {
    const bucket = bucketType === 'output' ? outputBucket : inputBucket;
    await bucket.file(gcsPath).delete();
    logger.debug('Deleted GCS file', { gcsPath });
  } catch (err) {
    if (err.code === 404) return; // already gone
    throw err;
  }
};

/**
 * Build a deterministic GCS path for an uploaded document.
 * Pattern: uploads/{userId}/{jobId}/{timestamp}_{filename}
 */
const buildInputPath = (userId, jobId, originalname) => {
  const ext = path.extname(originalname).toLowerCase();
  return `uploads/${userId}/${jobId}/${Date.now()}${ext}`;
};

/**
 * Build a deterministic GCS path for a processed output file.
 * Pattern: outputs/{userId}/{jobId}/transcription.{ext}
 */
const buildOutputPath = (userId, jobId, ext) => {
  return `outputs/${userId}/${jobId}/transcription.${ext}`;
};

module.exports = {
  uploadBuffer,
  downloadBuffer,
  getSignedUrl,
  deleteFile,
  buildInputPath,
  buildOutputPath,
};
