'use strict';

const { createApp } = require('./app');
const { closePool } = require('./config/database');
const { closeRedis } = require('./config/redis');
const { closeQueue } = require('./services/queue.service');
const { startPurgeCron } = require('./cron/purge.cron');
const config = require('./config');
const logger = require('./utils/logger');
const { initSentry, Sentry } = require('./utils/sentry');

initSentry();

const start = async () => {
  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info(`${config.appName} started`, {
      port: config.port,
      env: config.env,
      pid: process.pid,
    });
  });

  // Start the purge cron (not in test mode)
  if (!config.isTest) {
    startPurgeCron();
  }

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    server.close(async () => {
      try {
        await Promise.allSettled([closePool(), closeRedis(), closeQueue()]);
        if (config.sentry.dsn) {
          await Sentry.flush(2000);
        }
        logger.info('All connections closed. Exiting.');
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown', { error: err.message });
        process.exit(1);
      }
    });

    // Force exit after 15s if graceful shutdown stalls
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection', { reason: String(reason) });
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
    Sentry.captureException(err);
    Sentry.flush(2000).then(() => process.exit(1));
  });

  return server;
};

start();
