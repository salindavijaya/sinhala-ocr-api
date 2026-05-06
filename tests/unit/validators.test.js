'use strict';

const { registerSchema, loginSchema, transcribeSchema, createApiKeySchema } = require('../../src/utils/validators');

// Helper: validate against a Joi schema
const validateSchema = (schema, data) =>
  schema.validate(data, { abortEarly: false, stripUnknown: true, allowUnknown: false });

describe('validators', () => {
  // ─── registerSchema ──────────────────────────────────────────
  describe('registerSchema', () => {
    const valid = { name: 'Kamal Perera', email: 'kamal@example.com', password: 'Secure123' };

    it('accepts valid registration data', () => {
      const { error } = validateSchema(registerSchema, valid);
      expect(error).toBeUndefined();
    });

    it('rejects missing name', () => {
      const { error } = validateSchema(registerSchema, { ...valid, name: undefined });
      expect(error).toBeDefined();
      expect(error.details.some((d) => d.path[0] === 'name')).toBe(true);
    });

    it('rejects name shorter than 2 characters', () => {
      const { error } = validateSchema(registerSchema, { ...valid, name: 'A' });
      expect(error).toBeDefined();
    });

    it('rejects invalid email', () => {
      const { error } = validateSchema(registerSchema, { ...valid, email: 'not-an-email' });
      expect(error).toBeDefined();
    });

    it('lowercases email', () => {
      const { value } = validateSchema(registerSchema, { ...valid, email: 'KAMAL@EXAMPLE.COM' });
      expect(value.email).toBe('kamal@example.com');
    });

    it('rejects password shorter than 8 characters', () => {
      const { error } = validateSchema(registerSchema, { ...valid, password: 'Ab1' });
      expect(error).toBeDefined();
    });

    it('rejects password without uppercase letter', () => {
      const { error } = validateSchema(registerSchema, { ...valid, password: 'secure123' });
      expect(error).toBeDefined();
    });

    it('rejects password without lowercase letter', () => {
      const { error } = validateSchema(registerSchema, { ...valid, password: 'SECURE123' });
      expect(error).toBeDefined();
    });

    it('rejects password without digit', () => {
      const { error } = validateSchema(registerSchema, { ...valid, password: 'SecurePass' });
      expect(error).toBeDefined();
    });

    it('accepts strong password', () => {
      const { error } = validateSchema(registerSchema, { ...valid, password: 'Str0ng!Pass' });
      expect(error).toBeUndefined();
    });
  });

  // ─── loginSchema ─────────────────────────────────────────────
  describe('loginSchema', () => {
    const valid = { email: 'kamal@example.com', password: 'anypassword' };

    it('accepts valid login data', () => {
      const { error } = validateSchema(loginSchema, valid);
      expect(error).toBeUndefined();
    });

    it('rejects missing email', () => {
      const { error } = validateSchema(loginSchema, { password: 'pass' });
      expect(error).toBeDefined();
    });

    it('rejects missing password', () => {
      const { error } = validateSchema(loginSchema, { email: 'a@b.com' });
      expect(error).toBeDefined();
    });

    it('lowercases email on login', () => {
      const { value } = validateSchema(loginSchema, { ...valid, email: 'KAMAL@EXAMPLE.COM' });
      expect(value.email).toBe('kamal@example.com');
    });
  });

  // ─── transcribeSchema ────────────────────────────────────────
  describe('transcribeSchema', () => {
    it('uses defaults when body is empty', () => {
      const { error, value } = validateSchema(transcribeSchema, {});
      expect(error).toBeUndefined();
      expect(value.output_format).toBe('all');
      expect(value.language_hint).toBe('si');
      expect(value.preserve_layout).toBe(false);
    });

    it('accepts valid output_format values', () => {
      for (const fmt of ['json', 'docx', 'pdf', 'all']) {
        const { error } = validateSchema(transcribeSchema, { output_format: fmt });
        expect(error).toBeUndefined();
      }
    });

    it('rejects invalid output_format', () => {
      const { error } = validateSchema(transcribeSchema, { output_format: 'xlsx' });
      expect(error).toBeDefined();
    });

    it('accepts valid language_hint values', () => {
      for (const lang of ['si', 'si-LK']) {
        const { error } = validateSchema(transcribeSchema, { language_hint: lang });
        expect(error).toBeUndefined();
      }
    });

    it('rejects unknown language_hint', () => {
      const { error } = validateSchema(transcribeSchema, { language_hint: 'en' });
      expect(error).toBeDefined();
    });

    it('accepts preserve_layout as boolean', () => {
      const { error, value } = validateSchema(transcribeSchema, { preserve_layout: true });
      expect(error).toBeUndefined();
      expect(value.preserve_layout).toBe(true);
    });

    it('strips unknown fields', () => {
      const { value } = validateSchema(transcribeSchema, { output_format: 'json', unknown_field: 'x' });
      expect(value).not.toHaveProperty('unknown_field');
    });
  });

  // ─── createApiKeySchema ───────────────────────────────────────
  describe('createApiKeySchema', () => {
    it('accepts a valid key name', () => {
      const { error } = validateSchema(createApiKeySchema, { name: 'My integration' });
      expect(error).toBeUndefined();
    });

    it('rejects name shorter than 2 chars', () => {
      const { error } = validateSchema(createApiKeySchema, { name: 'A' });
      expect(error).toBeDefined();
    });

    it('rejects missing name', () => {
      const { error } = validateSchema(createApiKeySchema, {});
      expect(error).toBeDefined();
    });

    it('rejects name longer than 100 chars', () => {
      const { error } = validateSchema(createApiKeySchema, { name: 'A'.repeat(101) });
      expect(error).toBeDefined();
    });
  });
});
