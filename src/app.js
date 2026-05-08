'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const config = require('./config');
const logger = require('./utils/logger');
const { initSentry, Sentry } = require('./utils/sentry');
const { errorHandler } = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimiter');
const { notFound } = require('./utils/apiResponse');

initSentry();

// Routes
const authRoutes         = require('./routes/auth.routes');
const transcriptionRoutes = require('./routes/transcription.routes');
const jobRoutes          = require('./routes/job.routes');
const healthRoutes       = require('./routes/health.routes');

const createApp = () => {
  const app = express();

  // Initialize Sentry request instrumentation before any other middleware.
  if (config.sentry.dsn) {
    app.use(Sentry.Handlers.requestHandler());
    if (config.sentry.tracesSampleRate > 0) {
      app.use(Sentry.Handlers.tracingHandler());
    }
  }

app.set('trust proxy', 1);
  // ── Security headers ────────────────────────────────────────────────────────
  app.use(helmet());
  app.disable('x-powered-by');

  // ── CORS ────────────────────────────────────────────────────────────────────
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, curl)
      if (!origin) return callback(null, true);
      if (config.cors.origins.includes(origin) || !config.isProd) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    methods: ['GET', 'POST', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: true,
  }));

  // ── Compression ─────────────────────────────────────────────────────────────
  app.use(compression());

  // ── Body parsers ────────────────────────────────────────────────────────────
  // Note: multipart/form-data is handled by multer per-route; NOT here.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── Request logging ─────────────────────────────────────────────────────────
  if (!config.isTest) {
    app.use(
      morgan('combined', {
        stream: { write: (msg) => logger.info(msg.trim()) },
        skip: (req) => req.path === '/api/v1/health/live',
      })
    );
  }

  // ── General rate limiter ─────────────────────────────────────────────────────
  app.use(generalLimiter);

  // ── Routes ───────────────────────────────────────────────────────────────────
  const API_PREFIX = '/api/v1';

  app.use(`${API_PREFIX}/health`,     healthRoutes);
  app.use(`${API_PREFIX}/auth`,       authRoutes);
  app.use(`${API_PREFIX}/transcribe`, transcriptionRoutes);
  app.use(`${API_PREFIX}/jobs`,       jobRoutes);

  // ── 404 handler ──────────────────────────────────────────────────────────────
  app.use((req, res) => {
    notFound(res, `Route ${req.method} ${req.path} not found`);
  });

  // ── Global error handler ─────────────────────────────────────────────────────
  if (config.sentry.dsn) {
    app.use(Sentry.Handlers.errorHandler());
  }
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
