'use strict';

const cron = require('node-cron');
const Job = require('../models/Job');
const { deleteFile } = require('../services/storage.service');
const logger = require('../utils/logger');

/**
 * Purge all jobs that have exceeded their TTL:
 * 1. Find expired job rows from DB
 * 2. Delete their files from GCS (input + output buckets)
 * 3. Mark the job row as 'purged' and null out file paths
 */
const runPurge = async () => {
  logger.info('Purge cron: starting');
  let purged = 0;
  let errors = 0;

  try {
    const expiredJobs = await Job.findExpired();
    logger.info('Purge cron: found expired jobs', { count: expiredJobs.length });

    for (const job of expiredJobs) {
      try {
        const deletions = [];

        if (job.gcs_input_path) {
          deletions.push(deleteFile(job.gcs_input_path, 'input'));
        }
        if (job.gcs_output_docx_path) {
          deletions.push(deleteFile(job.gcs_output_docx_path, 'output'));
        }
        if (job.gcs_output_pdf_path) {
          deletions.push(deleteFile(job.gcs_output_pdf_path, 'output'));
        }

        await Promise.allSettled(deletions); // don't fail if one file already gone
        await Job.markPurged(job.id);
        purged++;
        logger.debug('Purged job', { jobId: job.id });
      } catch (err) {
        errors++;
        logger.error('Failed to purge job', { jobId: job.id, error: err.message });
      }
    }
  } catch (err) {
    logger.error('Purge cron: failed to fetch expired jobs', { error: err.message });
    errors++;
  }

  logger.info('Purge cron: completed', { purged, errors });
  return { purged, errors };
};

/**
 * Start the cron schedule. Runs at the top of every hour.
 */
const startPurgeCron = () => {
  // '0 * * * *' = every hour at :00
  const task = cron.schedule('0 * * * *', async () => {
    try {
      await runPurge();
    } catch (err) {
      logger.error('Purge cron: unhandled error', { error: err.message });
    }
  });

  logger.info('Purge cron scheduled', { schedule: 'every hour' });
  return task;
};

module.exports = { startPurgeCron, runPurge };
