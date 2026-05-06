'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/job.controller');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/',    authenticate, asyncHandler(ctrl.listJobs));
router.get('/:id', authenticate, asyncHandler(ctrl.getJobStatus));

module.exports = router;
