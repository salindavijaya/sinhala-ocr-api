'use strict';

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config');

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const devFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level}]: ${message}${metaStr}`;
});

const buildTransports = () => {
  const transports = [];

  if (config.isTest) {
    // Silent during tests unless LOG_LEVEL=debug
    transports.push(new winston.transports.Console({ silent: config.logging.level !== 'debug' }));
    return transports;
  }

  if (!config.isProd) {
    transports.push(
      new winston.transports.Console({
        format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), devFormat),
      })
    );
    return transports;
  }

  // Production: structured JSON + daily rotating files
  transports.push(
    new winston.transports.Console({ format: combine(timestamp(), errors({ stack: true }), json()) })
  );

  transports.push(
    new DailyRotateFile({
      filename: path.join(config.logging.dir, 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: combine(timestamp(), errors({ stack: true }), json()),
    })
  );

  transports.push(
    new DailyRotateFile({
      filename: path.join(config.logging.dir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
      format: combine(timestamp(), errors({ stack: true }), json()),
    })
  );

  return transports;
};

const logger = winston.createLogger({
  level: config.logging.level,
  format: combine(timestamp(), errors({ stack: true }), json()),
  defaultMeta: { service: config.appName },
  transports: buildTransports(),
  exitOnError: false,
});

module.exports = logger;
