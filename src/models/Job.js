'use strict';

const { query } = require('../config/database');
const config = require('../config');

const JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

const Job = {
  JOB_STATUS,

  /**
   * Create a new transcription job record.
   */
  async create({ userId, originalFilename, gcsInputPath, mimeType }) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + config.jobs.ttlHours);

    const result = await query(
      `INSERT INTO jobs (user_id, original_filename, gcs_input_path, mime_type, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, status, original_filename, created_at, expires_at`,
      [userId, originalFilename, gcsInputPath, mimeType, JOB_STATUS.PENDING, expiresAt]
    );
    return result.rows[0];
  },

  /**
   * Fetch a job by ID and validate ownership (unless user is admin).
   */
  async findById(id, userId = null) {
    const params = [id];
    let ownershipClause = '';
    if (userId) {
      params.push(userId);
      ownershipClause = `AND user_id = $2`;
    }
    const result = await query(
      `SELECT id, user_id, status, original_filename, mime_type,
              gcs_input_path, gcs_output_docx_path, gcs_output_pdf_path,
              extracted_text, page_count, error_message,
              created_at, updated_at, expires_at,
              processing_started_at, completed_at
       FROM jobs WHERE id = $1 ${ownershipClause}`,
      params
    );
    return result.rows[0] || null;
  },

  /**
   * List jobs for a user with pagination.
   */
  async findByUserId(userId, { limit = 20, offset = 0 } = {}) {
    const result = await query(
      `SELECT id, status, original_filename, page_count, created_at, completed_at, expires_at
       FROM jobs WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  },

  /**
   * Mark job as processing.
   */
  async markProcessing(id) {
    const result = await query(
      `UPDATE jobs SET status = $1, processing_started_at = NOW(), updated_at = NOW()
       WHERE id = $2 RETURNING id, status`,
      [JOB_STATUS.PROCESSING, id]
    );
    return result.rows[0];
  },

  /**
   * Mark job as completed with output paths and extracted text.
   */
  async markCompleted(id, { extractedText, gcsDocxPath, gcsPdfPath, pageCount = 1 }) {
    const result = await query(
      `UPDATE jobs SET
         status = $1,
         extracted_text = $2,
         gcs_output_docx_path = $3,
         gcs_output_pdf_path = $4,
         page_count = $5,
         completed_at = NOW(),
         updated_at = NOW()
       WHERE id = $6
       RETURNING id, status, completed_at`,
      [JOB_STATUS.COMPLETED, extractedText, gcsDocxPath, gcsPdfPath, pageCount, id]
    );
    return result.rows[0];
  },

  /**
   * Mark job as failed with error message.
   */
  async markFailed(id, errorMessage) {
    const result = await query(
      `UPDATE jobs SET status = $1, error_message = $2, updated_at = NOW()
       WHERE id = $3 RETURNING id, status`,
      [JOB_STATUS.FAILED, errorMessage, id]
    );
    return result.rows[0];
  },

  /**
   * Find all expired jobs that need purging.
   */
  async findExpired() {
    const result = await query(
      `SELECT id, gcs_input_path, gcs_output_docx_path, gcs_output_pdf_path
       FROM jobs WHERE expires_at < NOW() AND status != 'purged'`
    );
    return result.rows;
  },

  /**
   * Mark a job as purged after files deleted from GCS.
   */
  async markPurged(id) {
    await query(
      `UPDATE jobs SET status = 'purged', gcs_input_path = NULL,
       gcs_output_docx_path = NULL, gcs_output_pdf_path = NULL,
       extracted_text = NULL, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  },
};

module.exports = Job;
