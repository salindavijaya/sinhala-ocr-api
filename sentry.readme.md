# Sentry Integration Guide

## Overview

This project now includes Sentry integration for centralized error monitoring and performance tracing.

Sentry is configured to capture:
- unhandled exceptions in the API process
- unhandled promise rejections in the API process
- Express request context and HTTP transaction data
- background worker errors and unhandled failures
- server shutdown events with flush semantics

## Implementation details

### API server

- `src/utils/sentry.js`
  - initializes Sentry only when `SENTRY_DSN` is present
  - configures environment, release, trace sampling, and debug mode

- `src/app.js`
  - initializes Sentry before middleware registration
  - attaches `Sentry.Handlers.requestHandler()` for request context
  - attaches `Sentry.Handlers.tracingHandler()` when trace collection is enabled
  - attaches `Sentry.Handlers.errorHandler()` before the custom error handler

- `src/middleware/errorHandler.js`
  - sends server-side errors (`>= 500`) to Sentry via `Sentry.captureException(err)`

- `src/server.js`
  - initializes Sentry when the process starts
  - reports `unhandledRejection` and `uncaughtException`
  - flushes pending events during graceful shutdown or fatal exits

### Worker process

- `src/workers/transcription.worker.js`
  - initializes Sentry for worker execution
  - sends job processing errors to Sentry
  - reports worker-level `unhandledRejection` and `uncaughtException`

## Configuration

Add the following environment variables to enable and tune Sentry:

```env
SENTRY_DSN=
SENTRY_RELEASE=sinhala-ocr-api@1.0.0
SENTRY_TRACES_SAMPLE_RATE=0.0
SENTRY_DEBUG=false
```

### Key variables

- `SENTRY_DSN`
  - required to enable Sentry
  - if missing, Sentry will remain disabled and the app will continue to function normally

- `SENTRY_RELEASE`
  - optional release identifier used for grouping and version tracking
  - defaults to `${APP_NAME}@${package.json.version}`

- `SENTRY_TRACES_SAMPLE_RATE`
  - controls performance tracing capture rate
  - set to `0.0` to disable tracing, or a value between `0.0` and `1.0`

- `SENTRY_DEBUG`
  - set to `true` to enable Sentry debug logs
  - useful for setup verification in staging or development

## Deployment notes

- Do not commit the DSN to source control.
- In production, use a secure secrets manager or environment management system.
- Ensure the same `SENTRY_DSN` is configured for both the API service and the worker service.

## Verification

1. Deploy with `SENTRY_DSN` configured.
2. Trigger an error in the API or worker.
3. Confirm the event appears in your Sentry project.

## Additional notes

- Existing logging with `winston` remains intact.
- The production logger still writes to rotating logs and stdout in JSON format.
- Sentry is additive: it does not replace local log files or the current logging pipeline.
