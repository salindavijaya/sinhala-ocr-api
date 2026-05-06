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
  logger.info('Worker: downloading input from GCS', { gcsInputPath });
  const fileBuffer = await downloadBuffer(gcsInputPath, 'input');
  await bullJob.progress(25);

  // ── Step 3: OCR + Sinhala normalisation ──────────────────────────────────
  logger.info('Worker: running OCR', { jobId });
  const ocrResult = await transcribe(fileBuffer, mimeType, languageHint);
  await bullJob.progress(60);

  logger.info('Worker: OCR result', {
    jobId,
    charCount: ocrResult.extractedText.length,
    sinhalaRatio: ocrResult.sinhalaRatio.toFixed(2),
    confidence: ocrResult.overallConfidence,
  });

  // ── Step 4: generate output documents ────────────────────────────────────
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
};

// Start worker if run directly (not imported as a module)
if (require.main === module) {
  startWorker();
}

module.exports = { startWorker, processJob };
