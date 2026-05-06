'use strict';

const Bull = require('bull');
const config = require('../config');
const logger = require('../utils/logger');

const QUEUE_NAME = 'sinhala-transcription';

let transcriptionQueue;

const getQueue = () => {
  if (!transcriptionQueue) {
    const redisOpts = (() => {
      // Bull accepts either a redis URL string or connection options
      if (config.redis.password) {
        return {
          redis: {
            host: new URL(config.redis.url).hostname,
            port: parseInt(new URL(config.redis.url).port, 10) || 6379,
            password: config.redis.password,
            tls: config.redis.tls ? {} : undefined,
          },
        };
      }
      return { redis: config.redis.url };
    })();

    transcriptionQueue = new Bull(QUEUE_NAME, redisOpts);

    transcriptionQueue.on('error', (err) => {
      logger.error('Bull queue error', { error: err.message });
    });

    transcriptionQueue.on('waiting', (jobId) => {
      logger.debug('Job waiting', { jobId });
    });

    transcriptionQueue.on('active', (job) => {
      logger.info('Job started', { jobId: job.id, dbJobId: job.data.jobId });
    });

    transcriptionQueue.on('completed', (job) => {
      logger.info('Job completed', { jobId: job.id, dbJobId: job.data.jobId });
    });

    transcriptionQueue.on('failed', (job, err) => {
      logger.error('Job failed', { jobId: job.id, dbJobId: job.data.jobId, error: err.message });
    });
  }

  return transcriptionQueue;
};

/**
 * Enqueue a transcription job.
 * @param {object} payload
 * @param {string} payload.jobId - DB job UUID
 * @param {string} payload.userId
 * @param {string} payload.gcsInputPath
 * @param {string} payload.mimeType
 * @param {string} payload.originalFilename
 * @param {string} payload.outputFormat - 'json' | 'docx' | 'pdf' | 'all'
 * @param {string} payload.languageHint
 */
const enqueueTranscription = async (payload) => {
  const queue = getQueue();
  const job = await queue.add(payload, {
    attempts: config.jobs.maxRetries + 1,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,  // keep last 100 completed jobs in Redis
    removeOnFail: 200,
    timeout: 120000,        // 2 min max per job
  });

  logger.info('Transcription job enqueued', { bullJobId: job.id, dbJobId: payload.jobId });
  return job.id;
};

const closeQueue = async () => {
  if (transcriptionQueue) {
    await transcriptionQueue.close();
    transcriptionQueue = null;
  }
};

const healthCheck = async () => {
  const queue = getQueue();
  const counts = await queue.getJobCounts();
  return { queue: QUEUE_NAME, ...counts };
};

module.exports = { getQueue, enqueueTranscription, closeQueue, healthCheck };
