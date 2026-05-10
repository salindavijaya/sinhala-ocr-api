'use strict';

require('dotenv').config();

const required = (key) => {
  const val = process.env[key];
  if (!val && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
};
const GCP_KEY = {
  type: "service_account",
  project_id: "supple-defender-421716",
  private_key_id: "fe4c87d21cdf90a51e4468e1ab13f0d62df7d5b6",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDhT+zi79T106jU\ntsvzOEzMxEfrAD+Md2udWvLK1lmVEEG3Auy1Ihwy10gXtbAy07dPzprhQY818ZYW\nwvwJXa7lPHdMhR5t0xC7+aCv0jaEfvF29XABNYe75XZmcMCuKe6py8+/nQXDSfHm\nvcFfkXHXtsMxrmoJptnvsR8cWu1ASmoBRNcUmiH3+BnPidF9Gjicg6JQkEKaqFBM\npSnSnJ7Wzby9YJP/tcovjXjWViEkS0aWgY/gD0NybylccTBktNtfnT9JCqnJRPKs\nhM88nmP7uQh8ZcgDHDqTsMBLGNDTJWKgueqbfwNXugPkUtHu4tXczZoiehIWLXpO\nhS53sOOzAgMBAAECggEAaObegvZo75+BXrBRGseeskO8vERcUhkTyKqcmiXchZOR\nFRVOgjMEcANdtHRKOg/qrESkRbZRaCs31xcnY3DzyhUx8jWUaku34d0inFnCOkQk\nRl+Vq2px7OC0FJPwkeZCEVosOqlwEnGuJ+E3VDiSiX21Ob9b7Wx60adktb378k8T\nZolEbb3IoLKvhHTkzCu3r+bMb3MZ8a+66tVYmihl3Af6VMYrrYeQQfTWamHsy06p\nFyMqMjx1sLMRfoL+d5ZwJNDHURN1+zuDy4ADaF7f8Nx590B64eIhshCwOqmQFkK+\n1S3JDkoaFZ2fXwWHnj1GZta3VHySH4S72WjaPXeQQQKBgQD5vJtzUmJI2hlsmmOP\nxmM2OaYyC1CpBiP5JzC/+XNYaQvM63yq9Sa+k4regNuZPfei0H1pe2pwxU5Vlu+H\nu5/J5GMPz5xCddpRdyUDd8/cbiQLtnt8XzRPSQexcRAr6B8fJTNTww7Z9AJN2a1u\nMQmuaLfhoT0IE25ArcBhDAYVIQKBgQDm9oEkzzZX3eLWDoK6SLG5kuBJzQaJgcbX\ngayHlgz516oKFzQBLEras1VMdRJvsWhzoDFLBRpZTHqfUlOIEcFMN3isDF1nv3cn\n0uMdbJOYsh3JHnVH51oZr5qiJCj0qCZ2j4fHVHKKkDYnptlzppWEnROlomM7qUUu\n2q2ZV4zKUwKBgQCCCpIvtMB1CwyeHq6lWTqkK9S8zmOMACSPQrcB4BUN/nUkmaLr\nKoioSA/R2OuAmmHup/4GBTvhyPwHWXcVCMAl0wU6YHMPsGqkbRQbADJ+p+OhLb6T\nfsewWWjmHue61T4Pa8GUZke/em4Qt761WFegN+s4VEuBfwy0JUW9wxMPwQKBgD6z\nrVvQ5W/1TR/P0K3CDn3S4hEnGB88nD7ldXFZyywI4KDcq8GlxKybAw0+u0KXZ0P8\nuWUkfYLAwImAUC0gpNmMNbZ/pNwFntOw7PeQAoHx2SRAoJZkuJFAmzpplrTU8Zw+\nWx5CTtZPUGRzZ5V+JBlci3jsHQSVb7LIq1h17EMBAoGAQ3Nw9PWjuPbREgCC7IGB\noxpC0fuQOOhfWgRdtV+0zbPrcpPmeFufRuQ61dShi4yFudvgmI58PQ/Bep63p4Re\nlp0jFQDuY3GtTA8NLL+OJi1MBYFPdDLkQ28lQg8SFZkrHWQnSGEEJ3W2LIZO7ukd\ntsSmTy481EjckEkly+U7V3E=\n-----END PRIVATE KEY-----\n",
  client_email: "sicript-service@supple-defender-421716.iam.gserviceaccount.com",
  client_id: "111922505298573552918",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/sicript-service%40supple-defender-421716.iam.gserviceaccount.com",
  universe_domain: "googleapis.com"
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
    keyFile: process.env.GCP_KEY_FILE || process.env.GCP_SA_KEY || JSON.stringify(GCP_KEY),
    storage: {
      inputBucket: process.env.GCS_BUCKET_NAME || 'sinhala-ocr-uploads',
      outputBucket: 'sicript_bucket_output' || process.env.GCS_OUTPUT_BUCKET_NAME || 'sinhala-ocr-outputs',
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
