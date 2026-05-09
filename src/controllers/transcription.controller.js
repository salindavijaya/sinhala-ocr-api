'use strict';

const { v4: uuidv4 } = require('uuid');
const Job = require('../models/Job');
const { uploadBuffer, buildInputPath } = require('../services/storage.service');
const { enqueueTranscription } = require('../services/queue.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { Sentry } = require('../utils/sentry');
/**
 * POST /transcribe
 *
 * Accepts a document upload, saves to GCS, creates a DB job, enqueues for processing.
 * Returns job ID immediately — client polls GET /jobs/:id for result.
 */
const transcribe = async (req, res) => {
  const { output_format = 'all', language_hint = 'si', preserve_layout = false } = req.body;
  const file = req.file;
  const userId = req.user.id;

  // Pre-flight: validate file presence (belt-and-suspenders; middleware also checks)
  if (!file || !file.buffer) {
    return error(res, 'No file attached', 400, 'NO_FILE');
  }

  // Reject files that are clearly too small to be real documents
  if (file.size < 1000) {
    return error(res, 'File appears to be empty or corrupt (< 1KB)', 400, 'FILE_TOO_SMALL');
  }

  // Generate a job ID upfront so we can use it in the GCS path
  const jobId = uuidv4();
  const gcsInputPath = buildInputPath(userId, jobId, file.originalname);

  logger.info('Transcription request received', {
    userId,
    jobId,
    filename: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    outputFormat: output_format,
  });

  try {
    // 1. Upload to GCS
    await uploadBuffer(file.buffer, gcsInputPath, file.mimetype, 'input');

    // 2. Persist job record to DB
    const job = await Job.create({
      userId,
      originalFilename: file.originalname,
      gcsInputPath,
      mimeType: file.mimetype,
    });

    // 3. Enqueue for async processing
    await enqueueTranscription({
      jobId: job.id,
      userId,
      gcsInputPath,
      mimeType: file.mimetype,
      originalFilename: file.originalname,
      outputFormat: output_format,
      languageHint: language_hint,
      preserveLayout: preserve_layout,
    });

    logger.info('Job enqueued', { jobId: job.id, userId });

    return success(res, {
      job_id: job.id,
      status: job.status,
      message: 'Transcription queued. Poll the job status endpoint for results.',
      poll_url: `/api/v1/jobs/${job.id}`,
      expires_at: job.expires_at,
    }, 202); // 202 Accepted

  } catch (err) {
    Sentry.captureException(err);
    logger.error('Failed to queue transcription', { userId, jobId, error: err.message });
    // Attempt cleanup of any partially uploaded file
    // (fire-and-forget, best effort)
    try {
      const { deleteFile } = require('../services/storage.service');
      await deleteFile(gcsInputPath, 'input');
    } catch (_) { /* ignore */ }

    throw err; // passed to global error handler
  }
};

module.exports = { transcribe };
