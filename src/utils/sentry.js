'use strict';

const path = require('path');
const Sentry = require('@sentry/node');
const config = require('../config');
const pkg = require(path.join(__dirname, '../../package.json'));

/**
 * Initializes Sentry for the application.
 * Note: @sentry/tracing is no longer required in v8.x.
 */
const initSentry = () => {
  if (!config.sentry.dsn) {
    return Sentry;
  }

  // In v8, check if a client is already initialized directly on Sentry
  if (Sentry.getClient()) {
    return Sentry;
  }
// Import with `import * as Sentry from "@sentry/node"` if you are using ESM
const Sentry = require("@sentry/node");

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.env,
    // Uses the version from package.json or a custom release tag
    release: config.sentry.release || `${config.appName}@${pkg.version}`,
    tracesSampleRate: config.sentry.tracesSampleRate || 1.0,
    attachStacktrace: true,
    debug: config.sentry.debug,
    sendDefaultPii: true,
    // v8 uses functional integrations instead of class constructors
    integrations: [
      Sentry.httpIntegration({ tracing: true }),
    ],
  });

  return Sentry;
};

module.exports = { Sentry, initSentry };
