'use strict';

// Mock the DB module so model tests don't need a live PostgreSQL connection
jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../../src/config/database');
const ApiKey = require('../../src/models/ApiKey');

describe('ApiKey model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── generate() ──────────────────────────────────────────────
  describe('generate()', () => {
    it('returns a plainKey, prefix, and hash', () => {
      const { plainKey, prefix, hash } = ApiKey.generate();
      expect(typeof plainKey).toBe('string');
      expect(typeof prefix).toBe('string');
      expect(typeof hash).toBe('string');
    });

    it('plainKey starts with sk_ prefix', () => {
      const { plainKey } = ApiKey.generate();
      expect(plainKey.startsWith('sk_')).toBe(true);
    });

    it('hash is 64 hex characters (SHA-256)', () => {
      const { hash } = ApiKey.generate();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('prefix ends with ...', () => {
      const { prefix } = ApiKey.generate();
      expect(prefix.endsWith('...')).toBe(true);
    });

    it('generates unique keys on each call', () => {
      const { plainKey: k1 } = ApiKey.generate();
      const { plainKey: k2 } = ApiKey.generate();
      expect(k1).not.toBe(k2);
    });

    it('generates unique hashes on each call', () => {
      const { hash: h1 } = ApiKey.generate();
      const { hash: h2 } = ApiKey.generate();
      expect(h1).not.toBe(h2);
    });

    it('same plainKey always produces same hash', () => {
      const crypto = require('crypto');
      const key = 'sk_test_deterministic';
      const h1 = crypto.createHash('sha256').update(key).digest('hex');
      const h2 = crypto.createHash('sha256').update(key).digest('hex');
      expect(h1).toBe(h2);
    });
  });

  // ─── create() ────────────────────────────────────────────────
  describe('create()', () => {
    it('inserts key and returns row with plainKey attached', async () => {
      query.mockResolvedValueOnce({
        rows: [{
          id: 'uuid-123',
          name: 'Test Key',
          key_prefix: 'sk_abcdefghij...',
          is_active: true,
          created_at: new Date(),
        }],
      });

      const result = await ApiKey.create({ userId: 'user-123', name: 'Test Key' });

      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][0]).toContain('INSERT INTO api_keys');
      expect(result).toHaveProperty('plainKey');
      expect(result.plainKey).toMatch(/^sk_/);
      expect(result.name).toBe('Test Key');
      expect(result.id).toBe('uuid-123');
    });

    it('stores a hash, not the plain key', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 'x', name: 'k', key_prefix: 'sk_...', is_active: true, created_at: new Date() }] });
      await ApiKey.create({ userId: 'u1', name: 'k' });

      const insertCall = query.mock.calls[0];
      const insertedHash = insertCall[1][3]; // 4th param is key_hash
      expect(insertedHash).toMatch(/^[a-f0-9]{64}$/);
      // Confirm it's NOT the plain key
      expect(insertedHash).not.toMatch(/^sk_/);
    });
  });

  // ─── findByUserId() ───────────────────────────────────────────
  describe('findByUserId()', () => {
    it('queries with correct user_id', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      await ApiKey.findByUserId('user-abc');
      expect(query.mock.calls[0][1]).toContain('user-abc');
    });

    it('returns array of keys', async () => {
      const mockKeys = [
        { id: '1', name: 'Key A', key_prefix: 'sk_aaaa...' },
        { id: '2', name: 'Key B', key_prefix: 'sk_bbbb...' },
      ];
      query.mockResolvedValueOnce({ rows: mockKeys });
      const result = await ApiKey.findByUserId('user-abc');
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Key A');
    });
  });

  // ─── revoke() ────────────────────────────────────────────────
  describe('revoke()', () => {
    it('updates is_active = false for matching key + user', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 'key-123' }] });
      const result = await ApiKey.revoke({ keyId: 'key-123', userId: 'user-123' });
      expect(result).toEqual({ id: 'key-123' });
      expect(query.mock.calls[0][0]).toContain('is_active = false');
    });

    it('returns null when key not found or wrong owner', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const result = await ApiKey.revoke({ keyId: 'wrong', userId: 'user-123' });
      expect(result).toBeNull();
    });
  });
});
