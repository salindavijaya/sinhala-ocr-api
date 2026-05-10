'use strict';

// Mock Vision API client
const mockVisionResult = {
  fullTextAnnotation: {
    text: 'නමුත් පරිස්සම්',
    pages: [
      {
        blocks: [
          {
            confidence: 0.95,
            paragraphs: [
              {
                words: [
                  {
                    symbols: [
                      { text: 'න' },
                      { text: 'ම' },
                      { text: 'ු' },
                      { text: 'ත' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

const mockVisionClient = {
  documentTextDetection: jest.fn().mockResolvedValue([mockVisionResult]),
};

jest.mock('@google-cloud/vision', () => ({
  ImageAnnotatorClient: jest.fn().mockImplementation(() => mockVisionClient),
}));

jest.mock('../../src/services/storage.service', () => ({
  buildGcsUri: jest.fn((path, bucketType) => {
    const bucket = bucketType === 'output' ? 'test-output-bucket' : 'test-input-bucket';
    return `gs://${bucket}/${path}`;
  }),
}));

const {
  transcribe,
  ocrImage,
  ocrPdf,
  transcribeUri,
  ocrImageUri,
  ocrPdfUri,
} = require('../../src/services/ocr.service');

describe('ocrService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVisionClient.documentTextDetection.mockResolvedValue([mockVisionResult]);
  });

  // ─── ocrImageUri() ─────────────────────────────────────────────
  describe('ocrImageUri()', () => {
    it('calls Vision API with gcsImageUri parameter', async () => {
      const uri = 'gs://test-bucket/uploads/user-1/job-1/file.jpg';
      await ocrImageUri(uri);

      expect(mockVisionClient.documentTextDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          image: { source: { gcsImageUri: uri } },
          imageContext: expect.any(Object),
        })
      );
    });

    it('includes language hints in request', async () => {
      await ocrImageUri('gs://bucket/file.jpg', 'si');

      const call = mockVisionClient.documentTextDetection.mock.calls[0][0];
      expect(call.imageContext.languageHints).toContain('si');
      expect(call.imageContext.languageHints).toContain('si-LK');
    });

    it('returns processed result with visionConfidence', async () => {
      const result = await ocrImageUri('gs://bucket/file.jpg');

      expect(result).toHaveProperty('rawText');
      expect(result).toHaveProperty('pageTexts');
      expect(result).toHaveProperty('visionConfidence');
      expect(typeof result.visionConfidence).toBe('number');
    });

    it('extracts rawText from Vision API response', async () => {
      const result = await ocrImageUri('gs://bucket/file.jpg');
      expect(result.rawText).toBe('නමුත් පරිස්සම්');
    });

    it('defaults to Sinhala language hint', async () => {
      await ocrImageUri('gs://bucket/file.jpg');

      const call = mockVisionClient.documentTextDetection.mock.calls[0][0];
      expect(call.imageContext.languageHints[0]).toBe('si');
    });

    it('handles custom language hints', async () => {
      await ocrImageUri('gs://bucket/file.jpg', 'en');

      const call = mockVisionClient.documentTextDetection.mock.calls[0][0];
      expect(call.imageContext.languageHints[0]).toBe('en');
    });

    it('returns empty text when Vision API returns no annotation', async () => {
      mockVisionClient.documentTextDetection.mockResolvedValueOnce([{
        fullTextAnnotation: null,
      }]);

      const result = await ocrImageUri('gs://bucket/file.jpg');
      expect(result.rawText).toBe('');
      expect(result.visionConfidence).toBe(0);
    });
  });

  // ─── ocrPdfUri() ──────────────────────────────────────────────
  describe('ocrPdfUri()', () => {
    it('calls Vision API with gcsImageUri parameter for PDF', async () => {
      const uri = 'gs://test-bucket/uploads/user-1/job-1/document.pdf';
      await ocrPdfUri(uri);

      expect(mockVisionClient.documentTextDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          image: { source: { gcsImageUri: uri } },
        })
      );
    });

    it('returns processed result with visionConfidence', async () => {
      const result = await ocrPdfUri('gs://bucket/file.pdf');

      expect(result).toHaveProperty('rawText');
      expect(result).toHaveProperty('pageTexts');
      expect(result).toHaveProperty('visionConfidence');
    });

    it('handles PDF-specific Vision API responses', async () => {
      const pdfResult = {
        fullTextAnnotation: {
          text: 'Multi-page PDF content',
          pages: [
            {
              blocks: [
                {
                  confidence: 0.92,
                  paragraphs: [
                    {
                      words: [
                        { symbols: [{ text: 'T' }, { text: 'e' }, { text: 'x' }, { text: 't' }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
      mockVisionClient.documentTextDetection.mockResolvedValueOnce([pdfResult]);

      const result = await ocrPdfUri('gs://bucket/file.pdf');
      expect(result.rawText).toBe('Multi-page PDF content');
    });
  });

  // ─── transcribeUri() ───────────────────────────────────────────
  describe('transcribeUri()', () => {
    it('calls Vision API with gcsImageUri parameter for image requests', async () => {
      await transcribeUri('uploads/user-1/job-1/file.jpg', 'image/jpeg');

      expect(mockVisionClient.documentTextDetection).toHaveBeenCalled();
      // Verify gcsImageUri was used instead of content
      const call = mockVisionClient.documentTextDetection.mock.calls[0][0];
      expect(call.image).toHaveProperty('gcsImageUri');
      expect(call.image).not.toHaveProperty('content');
    });

    it('routes PDF MIME type correctly', async () => {
      await transcribeUri('uploads/user-1/job-1/file.pdf', 'application/pdf');

      expect(mockVisionClient.documentTextDetection).toHaveBeenCalled();
      const call = mockVisionClient.documentTextDetection.mock.calls[0][0];
      expect(call.image).toHaveProperty('gcsImageUri');
    });

    it('constructs correct GCS URI from path and bucketType', async () => {
      const { buildGcsUri } = require('../../src/services/storage.service');

      await transcribeUri('uploads/user-1/job-1/file.jpg', 'image/jpeg', 'si', 'input');

      expect(buildGcsUri).toHaveBeenCalledWith('uploads/user-1/job-1/file.jpg', 'input');
    });

    it('defaults to input bucket when bucketType not specified', async () => {
      const { buildGcsUri } = require('../../src/services/storage.service');

      await transcribeUri('uploads/user/job/file.jpg', 'image/jpeg');

      expect(buildGcsUri).toHaveBeenCalledWith('uploads/user/job/file.jpg', 'input');
    });

    it('returns OcrResult with normalised text properties', async () => {
      const result = await transcribeUri('uploads/user/job/file.jpg', 'image/jpeg');

      expect(result).toHaveProperty('extractedText');
      expect(result).toHaveProperty('pages');
      expect(result).toHaveProperty('pageCount');
      expect(result).toHaveProperty('visionConfidence');
      expect(result).toHaveProperty('sinhalaRatio');
      expect(result).toHaveProperty('overallConfidence');
    });

    it('applies Sinhala normalization to extracted text', async () => {
      const result = await transcribeUri('uploads/user/job/file.jpg', 'image/jpeg');

      // Result should have normalized sinhala text properties
      expect(typeof result.extractedText).toBe('string');
      expect(Array.isArray(result.pages)).toBe(true);
      expect(typeof result.pageCount).toBe('number');
    });
  });

  // ─── Backward Compatibility Tests ──────────────────────────────
  describe('Backward compatibility - buffer variant still works', () => {
    it('transcribe() still works with Buffer input', async () => {
      // Create a simple JPEG header buffer for testing
      const buffer = Buffer.from('fake image data');

      // Note: Will fail at Vision API call but that's ok - we're testing the function is callable
      mockVisionClient.documentTextDetection.mockResolvedValueOnce([mockVisionResult]);

      const result = await transcribe(buffer, 'image/jpeg');

      expect(result).toHaveProperty('extractedText');
      expect(result).toHaveProperty('visionConfidence');
    });

    it('ocrImage() still works with Buffer input', async () => {
      const buffer = Buffer.from('fake image data');

      const result = await ocrImage(buffer);

      expect(result).toHaveProperty('rawText');
      expect(result).toHaveProperty('pageTexts');
      expect(result).toHaveProperty('visionConfidence');
    });

    it('ocrPdf() still works with Buffer input', async () => {
      const buffer = Buffer.from('fake pdf data');

      const result = await ocrPdf(buffer);

      expect(result).toHaveProperty('rawText');
      expect(result).toHaveProperty('pageTexts');
      expect(result).toHaveProperty('visionConfidence');
    });
  });

  // ─── Error Handling ─────────────────────────────────────────────
  describe('Error handling', () => {
    it('propagates Vision API errors', async () => {
      const error = new Error('Vision API error');
      mockVisionClient.documentTextDetection.mockRejectedValueOnce(error);

      await expect(
        ocrImageUri('gs://bucket/file.jpg')
      ).rejects.toThrow('Vision API error');
    });

    it('handles missing GCS bucket gracefully', async () => {
      const error = new Error('Bucket not found');
      error.code = 404;
      mockVisionClient.documentTextDetection.mockRejectedValueOnce(error);

      await expect(
        transcribeUri('uploads/user/job/file.jpg', 'image/jpeg')
      ).rejects.toThrow();
    });
  });
});
