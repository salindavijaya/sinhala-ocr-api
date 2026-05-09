'use strict';

/**
 * Transcription Worker
 *
 * Runs as a separate process (or alongside the API in development).
 * Picks jobs from the Bull queue and executes the full pipeline:
 *   GCS download → Vision OCR → Sinhala normalization → DOCX/PDF gen → GCS upload → DB update
 */

require('dotenv').config();

const { getQueue } = require('../services/queue.service');
const { transcribe } = require('../services/ocr.service');
const { generateDocx, generatePdf } = require('../services/document.service');
const { downloadBuffer, uploadBuffer, buildOutputPath } = require('../services/storage.service');
const Job = require('../models/Job');
const config = require('../config');
const logger = require('../utils/logger');
const { initSentry, Sentry } = require('../utils/sentry');

initSentry();
const http = require('http');

const processJob = async (bullJob) => {
  const {
    jobId,
    userId,
    gcsInputPath,
    mimeType,
    originalFilename,
    outputFormat = 'all',
    languageHint = 'si',
  } = bullJob.data;

  logger.info('Worker: starting transcription', { jobId, mimeType, outputFormat });
  await bullJob.progress(5);

  // ── Step 1: mark DB job as processing ────────────────────────────────────
  await Job.markProcessing(jobId);
  await bullJob.progress(10);

  // ── Step 2: download input file from GCS ─────────────────────────────────
 try {
  logger.info('Worker: downloading input from GCS', { gcsInputPath });
  const fileBuffer = await downloadBuffer(gcsInputPath, 'input');
  await bullJob.progress(25); } catch (err) { Sentry.captureException(err,{
  tags: { section: "documenting", priority: "high" }
}); }

  // ── Step 3: OCR + Sinhala normalisation ──────────────────────────────────
 try {
  logger.info('Worker: running OCR', { jobId });
  const ocrResult = await transcribe(fileBuffer, mimeType, languageHint);
  await bullJob.progress(60); } catch (err) { Sentry.captureException(err, {
  tags: { section: "transcribe", priority: "high" }
});
}

  logger.info('Worker: OCR result', {
    jobId,
    charCount: ocrResult.extractedText.length,
    sinhalaRatio: ocrResult.sinhalaRatio.toFixed(2),
    confidence: ocrResult.overallConfidence,
  });

  // ── Step 4: generate output documents ────────────────────────────────────
 try {
const meta = { originalFilename, pageCount: ocrResult.pageCount, jobId };
  let gcsDocxPath = null;
  let gcsPdfPath = null;

  const shouldGenDocx = ['docx', 'all'].includes(outputFormat);
  const shouldGenPdf = ['pdf', 'all'].includes(outputFormat);

  if (shouldGenDocx) {
    logger.info('Worker: generating DOCX', { jobId });
    const docxBuffer = await generateDocx(ocrResult.extractedText, meta);
    gcsDocxPath = buildOutputPath(userId, jobId, 'docx');
    await uploadBuffer(docxBuffer, gcsDocxPath, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'output');
    await bullJob.progress(75);
  }

  if (shouldGenPdf) {
    logger.info('Worker: generating PDF', { jobId });
    const pdfBuffer = await generatePdf(ocrResult.extractedText, meta);
    gcsPdfPath = buildOutputPath(userId, jobId, 'pdf');
    await uploadBuffer(pdfBuffer, gcsPdfPath, 'application/pdf', 'output');
    await bullJob.progress(90);
  }
} catch (err) { Sentry.captureException(err, {
  tags: { section: "documenting", priority: "high" }
});
              }

  // ── Step 5: mark DB job as completed ─────────────────────────────────────
  await Job.markCompleted(jobId, {
    extractedText: ocrResult.extractedText,
    gcsDocxPath,
    gcsPdfPath,
    pageCount: ocrResult.pageCount,
  });

  await bullJob.progress(100);

  logger.info('Worker: job completed successfully', {
    jobId,
    pageCount: ocrResult.pageCount,
    docxUploaded: !!gcsDocxPath,
    pdfUploaded: !!gcsPdfPath,
  });

  return {
    jobId,
    pageCount: ocrResult.pageCount,
    confidence: ocrResult.overallConfidence,
    sinhalaRatio: ocrResult.sinhalaRatio,
  };
};

// ─── Worker startup ────────────────────────────────────────────────────────────
const startWorker = () => {
  const queue = getQueue();

  queue.process(config.jobs.queueConcurrency, async (job) => {
    try {
      return await processJob(job);
    } catch (err) {
      Sentry.captureException(err);
      logger.error('Worker: job processing error', {
        dbJobId: job.data.jobId,
        bullJobId: job.id,
        error: err.message,
        stack: err.stack,
      });

      // Update DB job status to failed
      if (job.data.jobId) {
        await Job.markFailed(job.data.jobId, err.message).catch(() => {});
      }

      throw err; // rethrow so Bull marks job as failed and retries
    }
  });

  logger.info('Transcription worker started', {
    concurrency: config.jobs.queueConcurrency,
    maxRetries: config.jobs.maxRetries,
  });
  const port = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200);
      res.end('Worker is healthy and processing jobs');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info(`Cloud Run health check server listening on port ${port}`);
  });
};

// Start worker if run directly
if (require.main === module) {
  process.on('unhandledRejection', (reason) => {
    logger.error('Worker unhandled Promise rejection', { reason: String(reason) });
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  });

  process.on('uncaughtException', (err) => {
    logger.error('Worker uncaught exception', { error: err.message, stack: err.stack });
    Sentry.captureException(err);
    Sentry.flush(2000).then(() => process.exit(1));
  });

  startWorker();
}

module.exports = { startWorker, processJob };
