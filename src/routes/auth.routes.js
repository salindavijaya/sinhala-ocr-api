'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { validate, registerSchema, loginSchema, createApiKeySchema } = require('../utils/validators');
//const { authLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../middleware/errorHandler');

// Public routes
router.post('/register', /*authLimiter,*/ validate(registerSchema), asyncHandler(ctrl.register));
router.post('/login',   /* authLimiter,*/ validate(loginSchema),    asyncHandler(ctrl.login));

// Protected routes
router.get('/me',                     authenticate, asyncHandler(ctrl.getMe));
router.post('/api-keys',              authenticate, validate(createApiKeySchema), asyncHandler(ctrl.createApiKey));
router.get('/api-keys',               authenticate, asyncHandler(ctrl.listApiKeys));
router.delete('/api-keys/:keyId',     authenticate, asyncHandler(ctrl.revokeApiKey));

module.exports = router;
