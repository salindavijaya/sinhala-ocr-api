'use strict';

require('dotenv').config();

const required = (key) => {
  const val = process.env[key];
  if (!val && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  appName: process.env.APP_NAME || 'sinhala-ocr-api',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-prod',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  db: {
    host: 'ep-gentle-waterfall-a7kok202-pooler.ap-southeast-2.aws.neon.tech', // '/cloudsql/supple-defender-421716:asia-south1:sicript-db-v1' , // '34.14.165.235', // process.env.DB_HOST || 'localhost',
    port: 5432, // parseInt(process.env.DB_PORT, 10) || 5432,
    name: 'neondb' || process.env.DB_NAME || 'sicript-db-v1',
    user: 'neondb_owner' ||process.env.DB_USER || 'postgres',
    password: 'npg_4HYorb9lfyKj' || process.env.DB_PASSWORD || 'Sicript-db-v1',
    ssl: true || process.env.DB_SSL === 'true',
    poolMin: parseInt(process.env.DB_POOL_MIN, 10) || 2,
    poolMax: parseInt(process.env.DB_POOL_MAX, 10) || 10,
  },

  redis: {
    url: 'rediss://default:gQAAAAAAAdO0AAIgcDJmN2I2ZjNkN2E3MTI0YjBkOWQ5YWQ0MzVjYjcyMGEzMA@united-peacock-119732.upstash.io:6379', // 'redis://10.228.118.12:6379',//  process.env.REDIS_URL || 'redis://localhost:6379',
    password: 'gQAAAAAAAdO0AAIgcDJmN2I2ZjNkN2E3MTI0YjBkOWQ5YWQ0MzVjYjcyMGEzMA',//process.env.REDIS_PASSWORD || undefined,
    tls: true // process.env.REDIS_TLS === 'true',
  },
  gcp: {
    projectId: process.env.GCP_PROJECT_ID || '',
    keyFile: process.env.GCP_KEY_FILE || process.env.GCP_SA_KEY,
    storage: {
      inputBucket: process.env.GCS_BUCKET_NAME || 'sicript_bucket',
      outputBucket: 'sicript_bucket_output' || process.env.GCS_OUTPUT_BUCKET_NAME,
      signedUrlExpiry: parseInt(process.env.GCS_SIGNED_URL_EXPIRY, 10) || 259200, // 72hrs
    },
  },

  upload: {
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 20,
    allowedMimeTypes: (process.env.ALLOWED_MIME_TYPES || 'image/jpeg,image/png,image/tiff,application/pdf').split(','),
  },

  jobs: {
    ttlHours: parseInt(process.env.JOB_TTL_HOURS, 10) || 72,
    queueConcurrency: 1 , // parseInt(process.env.QUEUE_CONCURRENCY, 10) || 3,
    maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES, 10) || 2,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    transcribeWindowMs: parseInt(process.env.TRANSCRIBE_RATE_LIMIT_WINDOW_MS, 10) || 3600000,
    transcribeMax: parseInt(process.env.TRANSCRIBE_RATE_LIMIT_MAX, 10) || 20,
  },

  cors: {
    origins: ('https://akuru-frontend.vercel.app' || process.env.CORS_ORIGINS || 'http://localhost:5173').split(','),
  },

  logging: {
    //level: process.env.LOG_LEVEL || 'info',
    level: 'debug',
    dir: process.env.LOG_DIR || './logs',
  },

  sentry: {
    dsn: "https://d74606e23dd7e3ab68d556f41f3096d8@o4511353159090176.ingest.de.sentry.io/4511353168003152",//process.env.SENTRY_DSN || '',
    release: process.env.SENTRY_RELEASE || `${process.env.APP_NAME || 'sinhala-ocr-api'}@${require('../../package.json').version}`,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.0,
    debug: "true",// process.env.SENTRY_DEBUG === 'true',
  },
};

module.exports = config;
