'use strict';

const Job = require('../models/Job');
const { getSignedUrl } = require('../services/storage.service');
const { success, notFound, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * GET /jobs/:id
 *
 * Returns full job status. When completed, generates fresh signed URLs for downloads.
 * Signed URLs are regenerated per-request and are valid for 72hrs (config.gcp.storage.signedUrlExpiry).
 */
const getJobStatus = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  const job = await Job.findById(id, isAdmin ? null : userId);
  if (!job) return notFound(res, 'Job not found');

  // Check if job has expired (purged)
  if (job.status === 'purged') {
    return error(res, 'This job has expired and its files have been deleted.', 410, 'JOB_EXPIRED');
  }

  const responseData = {
    id: job.id,
    status: job.status,
    original_filename: job.original_filename,
    mime_type: job.mime_type,
    page_count: job.page_count,
    created_at: job.created_at,
    updated_at: job.updated_at,
    expires_at: job.expires_at,
    completed_at: job.completed_at || null,
    error_message: job.status === 'failed' ? job.error_message : null,
  };

  // For completed jobs: include text + signed download URLs
  if (job.status === 'completed') {
    responseData.extracted_text = job.extracted_text;

    const downloads = {};
    if (job.gcs_output_docx_path) {
      try {
        downloads.docx = await getSignedUrl(job.gcs_output_docx_path, 'output');
      } catch (err) {
        logger.error('Failed to generate DOCX signed URL', { jobId: id, error: err.message });
        downloads.docx = null;
      }
    }
    if (job.gcs_output_pdf_path) {
      try {
        downloads.pdf = await getSignedUrl(job.gcs_output_pdf_path, 'output');
      } catch (err) {
        logger.error('Failed to generate PDF signed URL', { jobId: id, error: err.message });
        downloads.pdf = null;
      }
    }

    responseData.downloads = downloads;
    responseData.download_url_expiry_seconds = 259200; // 72hrs
  }

  return success(res, { job: responseData });
};

/**
 * GET /jobs — List jobs for the authenticated user
 */
const listJobs = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = parseInt(req.query.offset, 10) || 0;

  const jobs = await Job.findByUserId(req.user.id, { limit, offset });
  return success(res, { jobs, limit, offset });
};

module.exports = { getJobStatus, listJobs };
