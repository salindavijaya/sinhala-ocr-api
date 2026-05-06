'use strict';

const { Pool } = require('pg');
const config = require('./index');
const logger = require('../utils/logger');

let pool;

const getPool = () => {
  if (!pool) {
    pool = new Pool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.name,
      user: config.db.user,
      password: config.db.password,
      min: config.db.poolMin,
      max: config.db.poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
    });

    pool.on('error', (err) => {
      logger.error('Unexpected PostgreSQL pool error', { error: err.message });
    });

    pool.on('connect', () => {
      logger.debug('New PostgreSQL client connected to pool');
    });
  }
  return pool;
};

/**
 * Execute a query with automatic connection management.
 * @param {string} text - SQL query string
 * @param {Array} params - Query parameters
 */
const query = async (text, params = []) => {
  const start = Date.now();
  try {
    const result = await getPool().query(text, params);
    const duration = Date.now() - start;
    logger.debug('DB query executed', { query: text.substring(0, 80), duration, rows: result.rowCount });
    return result;
  } catch (err) {
    logger.error('DB query failed', { query: text.substring(0, 80), error: err.message });
    throw err;
  }
};

/**
 * Get a client for transactions. Caller MUST call client.release() in finally block.
 */
const getClient = async () => {
  const client = await getPool().connect();
  const originalQuery = client.query.bind(client);

  // Wrap query for logging
  client.query = async (...args) => {
    const start = Date.now();
    try {
      const result = await originalQuery(...args);
      logger.debug('TX query', { duration: Date.now() - start });
      return result;
    } catch (err) {
      logger.error('TX query failed', { error: err.message });
      throw err;
    }
  };

  return client;
};

/**
 * Gracefully close the pool (used on shutdown).
 */
const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
};

/**
 * Check if DB is reachable.
 */
const healthCheck = async () => {
  const result = await query('SELECT NOW() as time');
  return result.rows[0];
};

module.exports = { query, getClient, closePool, healthCheck, getPool };
