'use strict';

const path = require('path');
const Sentry = require('@sentry/node');
const Tracing = require('@sentry/tracing');
const config = require('../config');
const pkg = require(path.join(__dirname, '../../package.json'));

const initSentry = () => {
  if (!config.sentry.dsn) {
    return Sentry;
  }

  if (Sentry.getCurrentHub().getClient()) {
    return Sentry;
  }

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.env,
    release: config.sentry.release || `${config.appName}@${pkg.version}`,
    tracesSampleRate: config.sentry.tracesSampleRate,
    attachStacktrace: true,
    debug: config.sentry.debug,
    integrations: [new Sentry.Integrations.Http({ tracing: true })],
  });

  return Sentry;
};

module.exports = { Sentry, initSentry };
