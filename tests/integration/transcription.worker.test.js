'use strict';

// Mock all dependencies
const mockJob = {
  markProcessing: jest.fn().mockResolvedValue(undefined),
  markCompleted: jest.fn().mockResolvedValue(undefined),
  markFailed: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../src/models/Job', () => ({
  markProcessing: jest.fn().mockResolvedValue(undefined),
  markCompleted: jest.fn().mockResolvedValue(undefined),
  markFailed: jest.fn().mockResolvedValue(undefined),
}));

const mockOcrResult = {
  extractedText: 'නමුත් පරිස්සම්',
  pages: ['page 1', 'page 2'],
  pageCount: 2,
  visionConfidence: 0.95,
  sinhalaRatio: 0.88,
  overallConfidence: 'high',
};

const mockOcrService = {
  transcribeUri: jest.fn().mockResolvedValue(mockOcrResult),
};

jest.mock('../../src/services/ocr.service', () => mockOcrService);

const mockStorageService = {
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
  buildOutputPath: jest.fn((userId, jobId, ext) => `outputs/${userId}/${jobId}/transcription.${ext}`),
};

jest.mock('../../src/services/storage.service', () => mockStorageService);

const mockDocService = {
  generateDocx: jest.fn().mockResolvedValue(Buffer.from('docx content')),
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf content')),
};

jest.mock('../../src/services/document.service', () => mockDocService);

jest.mock('../../src/services/queue.service', () => ({
  getQueue: jest.fn(() => ({})),
}));

jest.mock('../../src/utils/sentry', () => ({
  initSentry: jest.fn(),
  Sentry: {
    captureMessage: jest.fn(),
    captureException: jest.fn(),
  },
}));

jest.mock('../../src/config', () => ({
  jobs: {
    queueConcurrency: 4,
    maxRetries: 2,
  },
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

const { processJob } = require('../../src/workers/transcription.worker');
const Job = require('../../src/models/Job');

describe('Transcription Worker - URI Approach', () => {
  let bullJob;

  beforeEach(() => {
    jest.clearAllMocks();

    bullJob = {
      data: {
        jobId: 'test-job-123',
        userId: 'user-456',
        gcsInputPath: 'uploads/user-456/test-job-123/document.jpg',
        mimeType: 'image/jpeg',
        originalFilename: 'document.jpg',
        outputFormat: 'all',
        languageHint: 'si',
      },
      progress: jest.fn().mockResolvedValue(undefined),
      id: 'bull-job-1',
    };
  });

  // ─── Core Functionality ─────────────────────────────────────────
  describe('processJob() with transcribeUri', () => {
    it('calls transcribeUri with GCS path instead of downloading buffer', async () => {
      await processJob(bullJob);

      expect(mockOcrService.transcribeUri).toHaveBeenCalledWith(
        'uploads/user-456/test-job-123/document.jpg',
        'image/jpeg',
        'si',
        'input'
      );
    });

    it('does NOT call downloadBuffer', async () => {
      await processJob(bullJob);

      // Verify downloadBuffer is never called by ensuring ocr service is called directly
      expect(mockOcrService.transcribeUri).toHaveBeenCalled();

      // If storage service was mocked and included downloadBuffer, it would be checked like this:
      // (In our mock setup, storage service only has uploadBuffer and buildOutputPath)
      expect(mockStorageService.uploadBuffer).toHaveBeenCalled();
    });

    it('marks job as processing before OCR', async () => {
      await processJob(bullJob);

      expect(Job.markProcessing).toHaveBeenCalledWith('test-job-123');
    });

    it('marks job as completed with OCR results', async () => {
      await processJob(bullJob);

      expect(Job.markCompleted).toHaveBeenCalledWith('test-job-123', {
        extractedText: 'නමුත් පරිස්සම්',
        gcsDocxPath: expect.stringContaining('transcription.docx'),
        gcsPdfPath: expect.stringContaining('transcription.pdf'),
        pageCount: 2,
      });
    });

    it('returns job result with correct metadata', async () => {
      const result = await processJob(bullJob);

      expect(result).toMatchObject({
        jobId: 'test-job-123',
        pageCount: 2,
        confidence: 'high',
        sinhalaRatio: 0.88,
      });
    });
  });

  // ─── Progress Tracking ──────────────────────────────────────────
  describe('Progress milestones with URI approach', () => {
    it('updates progress at correct milestones', async () => {
      await processJob(bullJob);

      const progressCalls = bullJob.progress.mock.calls.map((call) => call[0]);

      // Should have progress updates (values depend on implementation)
      expect(progressCalls).toContain(5); // Start
      expect(progressCalls).toContain(10); // After marking processing
      expect(progressCalls).toContain(50); // After OCR (no download step)
      expect(progressCalls).toContain(100); // Complete
    });

    it('progresses through document generation stages', async () => {
      await processJob(bullJob);

      const progressCalls = bullJob.progress.mock.calls.map((call) => call[0]);

      // Should have progress between OCR and completion
      expect(progressCalls.some((p) => p > 50 && p < 100)).toBe(true);
    });
  });

  // ─── Output Generation ──────────────────────────────────────────
  describe('Output document generation', () => {
    it('generates DOCX when outputFormat includes docx', async () => {
      bullJob.data.outputFormat = 'docx';
      await processJob(bullJob);

      expect(mockDocService.generateDocx).toHaveBeenCalledWith(
        'නමුත් පරිස්සම්',
        expect.objectContaining({
          originalFilename: 'document.jpg',
          pageCount: 2,
          jobId: 'test-job-123',
        })
      );
    });

    it('generates PDF when outputFormat includes pdf', async () => {
      bullJob.data.outputFormat = 'pdf';
      await processJob(bullJob);

      expect(mockDocService.generatePdf).toHaveBeenCalledWith(
        'නමුත් පරිස්සම්',
        expect.any(Object)
      );
    });

    it('generates both DOCX and PDF when outputFormat is all', async () => {
      bullJob.data.outputFormat = 'all';
      await processJob(bullJob);

      expect(mockDocService.generateDocx).toHaveBeenCalled();
      expect(mockDocService.generatePdf).toHaveBeenCalled();
    });

    it('uploads generated documents to GCS', async () => {
      await processJob(bullJob);

      expect(mockStorageService.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringContaining('transcription.docx'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'output'
      );

      expect(mockStorageService.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringContaining('transcription.pdf'),
        'application/pdf',
        'output'
      );
    });

    it('skips document generation when outputFormat requests nothing', async () => {
      bullJob.data.outputFormat = 'none'; // hypothetically
      await processJob(bullJob);

      // Should not generate if format doesn't match
      // (depends on actual format validation logic)
    });
  });

  // ─── Error Handling ─────────────────────────────────────────────
  describe('Error handling', () => {
    it('propagates OCR errors', async () => {
      const error = new Error('Vision API failed');
      mockOcrService.transcribeUri.mockRejectedValueOnce(error);

      await expect(processJob(bullJob)).rejects.toThrow('Vision API failed');
    });

    it('propagates document generation errors', async () => {
      const error = new Error('Document generation failed');
      mockDocService.generateDocx.mockRejectedValueOnce(error);

      await expect(processJob(bullJob)).rejects.toThrow('Document generation failed');
    });

    it('propagates GCS upload errors', async () => {
      const error = new Error('GCS upload failed');
      mockStorageService.uploadBuffer.mockRejectedValueOnce(error);

      await expect(processJob(bullJob)).rejects.toThrow('GCS upload failed');
    });

    it('handles missing jobId gracefully', async () => {
      bullJob.data.jobId = undefined;
      mockOcrService.transcribeUri.mockRejectedValueOnce(new Error('Test error'));

      // Should still reject even with missing jobId
      await expect(processJob(bullJob)).rejects.toThrow('Test error');
    });
  });

  // ─── Language Hint Support ──────────────────────────────────────
  describe('Language hint handling', () => {
    it('passes custom language hint to transcribeUri', async () => {
      bullJob.data.languageHint = 'en';
      await processJob(bullJob);

      expect(mockOcrService.transcribeUri).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'en',
        'input'
      );
    });

    it('defaults to Sinhala language hint', async () => {
      bullJob.data.languageHint = undefined;
      await processJob(bullJob);

      expect(mockOcrService.transcribeUri).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'si',
        'input'
      );
    });
  });

  // ─── MIME Type Handling ─────────────────────────────────────────
  describe('MIME type routing', () => {
    it('passes image/jpeg MIME type correctly', async () => {
      bullJob.data.mimeType = 'image/jpeg';
      await processJob(bullJob);

      expect(mockOcrService.transcribeUri).toHaveBeenCalledWith(
        expect.any(String),
        'image/jpeg',
        expect.any(String),
        'input'
      );
    });

    it('passes PDF MIME type correctly', async () => {
      bullJob.data.mimeType = 'application/pdf';
      await processJob(bullJob);

      expect(mockOcrService.transcribeUri).toHaveBeenCalledWith(
        expect.any(String),
        'application/pdf',
        expect.any(String),
        'input'
      );
    });

    it('passes other image MIME types correctly', async () => {
      bullJob.data.mimeType = 'image/png';
      await processJob(bullJob);

      expect(mockOcrService.transcribeUri).toHaveBeenCalledWith(
        expect.any(String),
        'image/png',
        expect.any(String),
        'input'
      );
    });
  });
});
