'use strict';

/**
 * Integration tests for auth routes.
 *
 * These tests use supertest against the real Express app, but mock
 * all database and Redis calls so no live infrastructure is needed.
 */

// Mock infrastructure dependencies before loading app
jest.mock('../../src/config/database', () => ({ query: jest.fn(), healthCheck: jest.fn().mockResolvedValue({ time: new Date() }) }));
jest.mock('../../src/config/redis', () => ({
  getRedisClient: jest.fn().mockReturnValue({
    ping: jest.fn().mockResolvedValue('PONG'),
    // rate-limit-redis uses SCRIPT LOAD and EVALSHA — return plausible values
    call: jest.fn().mockImplementation((cmd, ...args) => {
      if (cmd === 'SCRIPT' && args[0] === 'LOAD') return Promise.resolve('abc123sha');
      if (cmd === 'EVALSHA') return Promise.resolve([0, 1]);
      return Promise.resolve(null);
    }),
  }),
  healthCheck: jest.fn().mockResolvedValue({ status: 'ok' }),
  closeRedis: jest.fn(),
}));

// Also mock rate-limit-redis to use a simple in-memory store in tests
jest.mock('rate-limit-redis', () => ({
  RedisStore: class {
    constructor() {}
    async increment() { return { totalHits: 1, resetTime: new Date() }; }
    async decrement() {}
    async resetKey() {}
  },
}));
jest.mock('../../src/services/queue.service', () => ({
  getQueue: jest.fn().mockReturnValue({ on: jest.fn(), process: jest.fn(), getJobCounts: jest.fn().mockResolvedValue({}) }),
  enqueueTranscription: jest.fn().mockResolvedValue('bull-job-1'),
  closeQueue: jest.fn(),
  healthCheck: jest.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
}));

const request = require('supertest');
const { createApp } = require('../../src/app');
const { query } = require('../../src/config/database');
const bcrypt = require('bcryptjs');

const app = createApp();

describe('Auth routes — integration', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── POST /api/v1/auth/register ───────────────────────────────
  describe('POST /api/v1/auth/register', () => {
    const validPayload = { name: 'Kamal Perera', email: 'kamal@example.com', password: 'Secure123' };

    it('returns 201 with token on successful registration', async () => {
      // First query: check existing user → empty
      query.mockResolvedValueOnce({ rows: [] });
      // Second query: INSERT → return new user
      query.mockResolvedValueOnce({
        rows: [{ id: 'user-uuid', name: 'Kamal Perera', email: 'kamal@example.com', role: 'user', is_active: true, created_at: new Date() }],
      });

      const res = await request(app).post('/api/v1/auth/register').send(validPayload);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data.user.email).toBe('kamal@example.com');
    });

    it('returns 409 when email already exists', async () => {
      query.mockResolvedValueOnce({
        rows: [{ id: 'existing', email: 'kamal@example.com' }],
      });

      const res = await request(app).post('/api/v1/auth/register').send(validPayload);
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('returns 422 for invalid email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...validPayload, email: 'not-an-email' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 422 for weak password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...validPayload, password: 'weak' });
      expect(res.status).toBe(422);
    });

    it('returns 422 when name is missing', async () => {
      const { name: _, ...noName } = validPayload;
      const res = await request(app).post('/api/v1/auth/register').send(noName);
      expect(res.status).toBe(422);
    });
  });

  // ─── POST /api/v1/auth/login ─────────────────────────────────
  describe('POST /api/v1/auth/login', () => {
    it('returns 200 with token on valid credentials', async () => {
      const hash = await bcrypt.hash('Secure123', 1); // fast rounds for tests
      query.mockResolvedValueOnce({
        rows: [{ id: 'u1', name: 'Kamal', email: 'kamal@example.com', password_hash: hash, role: 'user', is_active: true }],
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'kamal@example.com', password: 'Secure123' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('token');
    });

    it('returns 401 for wrong password', async () => {
      const hash = await bcrypt.hash('Secure123', 1);
      query.mockResolvedValueOnce({
        rows: [{ id: 'u1', email: 'kamal@example.com', password_hash: hash, role: 'user', is_active: true }],
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'kamal@example.com', password: 'WrongPass99' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 for non-existent email', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'Secure123' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for deactivated account', async () => {
      const hash = await bcrypt.hash('Secure123', 1);
      query.mockResolvedValueOnce({
        rows: [{ id: 'u1', email: 'k@example.com', password_hash: hash, role: 'user', is_active: false }],
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'k@example.com', password: 'Secure123' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
    });
  });

  // ─── GET /api/v1/auth/me ─────────────────────────────────────
  describe('GET /api/v1/auth/me', () => {
    it('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns 401 with malformed token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not.a.real.token');
      expect(res.status).toBe(401);
    });
  });

  // ─── Health check ─────────────────────────────────────────────
  describe('GET /api/v1/health/live', () => {
    it('returns 200 alive', async () => {
      const res = await request(app).get('/api/v1/health/live');
      expect(res.status).toBe(200);
      expect(res.body.data.alive).toBe(true);
    });
  });

  // ─── 404 handler ─────────────────────────────────────────────
  describe('Unknown routes', () => {
    it('returns 404 for undefined routes', async () => {
      const res = await request(app).get('/api/v1/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
