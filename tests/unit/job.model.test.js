'use strict';

jest.mock('../../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../../src/config/database');
const Job = require('../../src/models/Job');

const makeJobRow = (overrides = {}) => ({
  id: 'job-uuid-1',
  user_id: 'user-uuid-1',
  status: 'pending',
  original_filename: 'invoice.jpg',
  mime_type: 'image/jpeg',
  gcs_input_path: 'uploads/u1/j1/file.jpg',
  gcs_output_docx_path: null,
  gcs_output_pdf_path: null,
  extracted_text: null,
  page_count: 1,
  error_message: null,
  created_at: new Date(),
  updated_at: new Date(),
  expires_at: new Date(Date.now() + 72 * 3600 * 1000),
  ...overrides,
});

describe('Job model', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── JOB_STATUS constants ─────────────────────────────────────
  describe('JOB_STATUS', () => {
    it('exports all required status constants', () => {
      expect(Job.JOB_STATUS.PENDING).toBe('pending');
      expect(Job.JOB_STATUS.PROCESSING).toBe('processing');
      expect(Job.JOB_STATUS.COMPLETED).toBe('completed');
      expect(Job.JOB_STATUS.FAILED).toBe('failed');
    });
  });

  // ─── create() ────────────────────────────────────────────────
  describe('create()', () => {
    it('inserts a new job and returns row', async () => {
      const row = makeJobRow({ status: 'pending' });
      query.mockResolvedValueOnce({ rows: [row] });

      const result = await Job.create({
        userId: 'user-uuid-1',
        originalFilename: 'invoice.jpg',
        gcsInputPath: 'uploads/u1/j1/file.jpg',
        mimeType: 'image/jpeg',
      });

      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][0]).toContain('INSERT INTO jobs');
      expect(result.status).toBe('pending');
      expect(result.original_filename).toBe('invoice.jpg');
    });

    it('sets expires_at based on JOB_TTL_HOURS config', async () => {
      const row = makeJobRow();
      query.mockResolvedValueOnce({ rows: [row] });
      await Job.create({ userId: 'u1', originalFilename: 'f.jpg', gcsInputPath: 'p', mimeType: 'image/jpeg' });

      const params = query.mock.calls[0][1];
      const expiresAt = params[5]; // 6th parameter
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  // ─── findById() ───────────────────────────────────────────────
  describe('findById()', () => {
    it('returns job when found', async () => {
      const row = makeJobRow();
      query.mockResolvedValueOnce({ rows: [row] });
      const result = await Job.findById('job-uuid-1', 'user-uuid-1');
      expect(result.id).toBe('job-uuid-1');
    });

    it('returns null when job not found', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const result = await Job.findById('no-such-id', 'user-uuid-1');
      expect(result).toBeNull();
    });

    it('adds user ownership clause when userId is provided', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      await Job.findById('job-1', 'user-1');
      expect(query.mock.calls[0][0]).toContain('user_id');
      expect(query.mock.calls[0][1]).toContain('user-1');
    });

    it('omits user ownership clause when userId is null (admin)', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      await Job.findById('job-1', null);
      // Should only have one parameter (the job id)
      expect(query.mock.calls[0][1]).toHaveLength(1);
    });
  });

  // ─── markProcessing() ────────────────────────────────────────
  describe('markProcessing()', () => {
    it('sets status to processing', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 'j1', status: 'processing' }] });
      const result = await Job.markProcessing('j1');
      expect(query.mock.calls[0][0]).toContain("status = $1");
      expect(query.mock.calls[0][1][0]).toBe('processing');
      expect(result.status).toBe('processing');
    });
  });

  // ─── markCompleted() ─────────────────────────────────────────
  describe('markCompleted()', () => {
    it('sets status to completed with all output fields', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 'j1', status: 'completed', completed_at: new Date() }] });
      const result = await Job.markCompleted('j1', {
        extractedText: 'Sinhala text here',
        gcsDocxPath: 'outputs/u1/j1/transcription.docx',
        gcsPdfPath: 'outputs/u1/j1/transcription.pdf',
        pageCount: 2,
      });
      expect(query.mock.calls[0][1][0]).toBe('completed');
      expect(query.mock.calls[0][1][1]).toBe('Sinhala text here');
      expect(result.status).toBe('completed');
    });

    it('defaults pageCount to 1 when not provided', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 'j1', status: 'completed', completed_at: new Date() }] });
      await Job.markCompleted('j1', { extractedText: 'text', gcsDocxPath: null, gcsPdfPath: null });
      const params = query.mock.calls[0][1];
      expect(params[4]).toBe(1); // pageCount param
    });
  });

  // ─── markFailed() ────────────────────────────────────────────
  describe('markFailed()', () => {
    it('sets status to failed with error message', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 'j1', status: 'failed' }] });
      const result = await Job.markFailed('j1', 'Vision API quota exceeded');
      expect(query.mock.calls[0][1][0]).toBe('failed');
      expect(query.mock.calls[0][1][1]).toBe('Vision API quota exceeded');
      expect(result.status).toBe('failed');
    });
  });

  // ─── findExpired() ────────────────────────────────────────────
  describe('findExpired()', () => {
    it('returns array of expired jobs', async () => {
      const expiredRows = [
        { id: 'j1', gcs_input_path: 'up/j1', gcs_output_docx_path: 'out/j1.docx', gcs_output_pdf_path: null },
        { id: 'j2', gcs_input_path: 'up/j2', gcs_output_docx_path: null, gcs_output_pdf_path: 'out/j2.pdf' },
      ];
      query.mockResolvedValueOnce({ rows: expiredRows });
      const result = await Job.findExpired();
      expect(result).toHaveLength(2);
      expect(query.mock.calls[0][0]).toContain('expires_at < NOW()');
    });

    it('returns empty array when no expired jobs', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const result = await Job.findExpired();
      expect(result).toEqual([]);
    });
  });

  // ─── markPurged() ────────────────────────────────────────────
  describe('markPurged()', () => {
    it('sets status to purged and nulls out file paths', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      await Job.markPurged('j1');
      expect(query.mock.calls[0][0]).toContain("status = 'purged'");
      expect(query.mock.calls[0][0]).toContain('gcs_input_path = NULL');
    });
  });
});
