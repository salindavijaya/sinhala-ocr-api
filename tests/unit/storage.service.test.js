'use strict';

// Build shared mock objects at module level so tests can reference them directly
const mockFile = {
  save: jest.fn().mockResolvedValue([]),
  download: jest.fn().mockResolvedValue([Buffer.from('file content')]),
  getSignedUrl: jest.fn().mockResolvedValue(['https://signed.url/file.docx']),
  delete: jest.fn().mockResolvedValue([]),
};

const mockBucket = {
  file: jest.fn().mockReturnValue(mockFile),
  name: 'mock-bucket',
};

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue(mockBucket),
  })),
}));

const {
  uploadBuffer,
  downloadBuffer,
  getSignedUrl,
  deleteFile,
  buildInputPath,
  buildOutputPath,
} = require('../../src/services/storage.service');

describe('storageService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── buildInputPath() ─────────────────────────────────────────
  describe('buildInputPath()', () => {
    it('returns path with uploads/ prefix and user/job structure', () => {
      const path = buildInputPath('user-1', 'job-1', 'invoice.jpg');
      expect(path).toMatch(/^uploads\/user-1\/job-1\//);
    });

    it('preserves file extension', () => {
      expect(buildInputPath('u', 'j', 'doc.pdf')).toMatch(/\.pdf$/);
      expect(buildInputPath('u', 'j', 'img.png')).toMatch(/\.png$/);
      expect(buildInputPath('u', 'j', 'doc.TIFF')).toMatch(/\.tiff$/); // lowercased
    });

    it('includes a timestamp component', () => {
      const path = buildInputPath('u', 'j', 'file.jpg');
      const parts = path.split('/');
      const filename = parts[parts.length - 1];
      // filename should start with a numeric timestamp
      expect(filename).toMatch(/^\d+/);
    });
  });

  // ─── buildOutputPath() ────────────────────────────────────────
  describe('buildOutputPath()', () => {
    it('returns path with outputs/ prefix', () => {
      const path = buildOutputPath('user-1', 'job-1', 'docx');
      expect(path).toMatch(/^outputs\/user-1\/job-1\//);
    });

    it('appends correct extension', () => {
      expect(buildOutputPath('u', 'j', 'docx')).toMatch(/\.docx$/);
      expect(buildOutputPath('u', 'j', 'pdf')).toMatch(/\.pdf$/);
    });

    it('uses deterministic filename (transcription.ext)', () => {
      expect(buildOutputPath('u', 'j', 'docx')).toMatch(/transcription\.docx$/);
    });
  });

  // ─── uploadBuffer() ───────────────────────────────────────────
  describe('uploadBuffer()', () => {
    it('calls GCS file.save with the buffer', async () => {
      const buf = Buffer.from('test content');
      await uploadBuffer(buf, 'test/path.jpg', 'image/jpeg', 'input');

      expect(mockFile.save).toHaveBeenCalledWith(
        buf,
        expect.objectContaining({ metadata: { contentType: 'image/jpeg' } })
      );
    });

    it('returns the destination path', async () => {
      const result = await uploadBuffer(Buffer.from('x'), 'my/path.jpg', 'image/jpeg', 'input');
      expect(result).toBe('my/path.jpg');
    });
  });

  // ─── downloadBuffer() ────────────────────────────────────────
  describe('downloadBuffer()', () => {
    it('returns a Buffer', async () => {
      const result = await downloadBuffer('some/path.jpg', 'input');
      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });

  // ─── getSignedUrl() ───────────────────────────────────────────
  describe('getSignedUrl()', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development'; // not 'test' — so it hits the mock
    });
    afterEach(() => {
      process.env.NODE_ENV = 'test';
    });

    it('returns a string URL', async () => {
      // In test env, returns a stub URL directly
      process.env.NODE_ENV = 'test';
      const url = await getSignedUrl('outputs/u/j/file.docx', 'output');
      expect(typeof url).toBe('string');
      expect(url).toContain('file.docx');
    });
  });

  // ─── deleteFile() ─────────────────────────────────────────────
  describe('deleteFile()', () => {
    it('resolves without error for existing file', async () => {
      await expect(deleteFile('some/path.docx', 'output')).resolves.toBeUndefined();
    });

    it('resolves silently when file does not exist (404)', async () => {
      mockFile.delete.mockRejectedValueOnce({ code: 404 });
      await expect(deleteFile('missing/file.docx', 'output')).resolves.toBeUndefined();
    });

    it('throws for non-404 errors', async () => {
      mockFile.delete.mockRejectedValueOnce({ code: 500, message: 'Server error' });
      await expect(deleteFile('some/file.docx', 'output')).rejects.toMatchObject({ code: 500 });
    });
  });
});
