'use strict';

const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');
const { Sentry } = require('../utils/sentry');
let client;

const getRedisClient = () => {
  if (!client) {
    try { 
    const options = {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy(times) {
        if (times > 10) return null; // stop retrying
        return Math.min(times * 200, 3000);
      },
      ...(config.redis.password && { password: config.redis.password }),
      ...(config.redis.tls && { tls: {} }),
      lazyConnect: false,
    };
      client = new Redis(config.redis.url, options);
    } catch (err) { Sentry.captureException(err); }
    

    client.on('connect', () => logger.info('Redis connected'));
    client.on('ready', () => logger.info('Redis ready'));
    client.on('error', (err) => {logger.error('Redis error', { error: err.message });Sentry.captureException(err); });
    client.on('close', () => logger.warn('Redis connection closed'));
    client.on('reconnecting', () => logger.warn('Redis reconnecting'));
  }
  return client;
};

const closeRedis = async () => {
  if (client) {
    await client.quit();
    client = null;
    logger.info('Redis connection closed');
  }
};

const healthCheck = async () => {
  const pong = await getRedisClient().ping();
  return { status: pong === 'PONG' ? 'ok' : 'error' };
};

module.exports = { getRedisClient, closeRedis, healthCheck };
