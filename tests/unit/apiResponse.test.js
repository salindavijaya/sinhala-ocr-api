'use strict';

const {
  success, created, noContent, error,
  notFound, unauthorized, forbidden,
  serverError, validationError, tooManyRequests,
} = require('../../src/utils/apiResponse');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  res.send   = jest.fn().mockReturnValue(res);
  return res;
};

describe('apiResponse helpers', () => {
  describe('success()', () => {
    it('returns 200 with success:true and data', () => {
      const res = mockRes();
      success(res, { id: 1 });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 1 } });
    });

    it('accepts custom status code', () => {
      const res = mockRes();
      success(res, {}, 202);
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('includes meta when provided', () => {
      const res = mockRes();
      success(res, {}, 200, { total: 5 });
      const call = res.json.mock.calls[0][0];
      expect(call.meta).toEqual({ total: 5 });
    });

    it('omits meta when not provided', () => {
      const res = mockRes();
      success(res, {});
      const call = res.json.mock.calls[0][0];
      expect(call).not.toHaveProperty('meta');
    });
  });

  describe('created()', () => {
    it('returns 201', () => {
      const res = mockRes();
      created(res, { id: 'abc' });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, data: { id: 'abc' } });
    });
  });

  describe('noContent()', () => {
    it('returns 204 with no body', () => {
      const res = mockRes();
      noContent(res);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe('error()', () => {
    it('returns structured error response', () => {
      const res = mockRes();
      error(res, 'Something went wrong', 400, 'BAD_REQUEST');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Something went wrong' },
      });
    });

    it('includes details when provided', () => {
      const res = mockRes();
      error(res, 'Validation failed', 422, 'VALIDATION_ERROR', [{ field: 'email' }]);
      const body = res.json.mock.calls[0][0];
      expect(body.error.details).toEqual([{ field: 'email' }]);
    });

    it('omits details when not provided', () => {
      const res = mockRes();
      error(res, 'Bad', 400);
      const body = res.json.mock.calls[0][0];
      expect(body.error).not.toHaveProperty('details');
    });
  });

  describe('notFound()', () => {
    it('returns 404 with NOT_FOUND code', () => {
      const res = mockRes();
      notFound(res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].error.code).toBe('NOT_FOUND');
    });

    it('uses custom message', () => {
      const res = mockRes();
      notFound(res, 'Job not found');
      expect(res.json.mock.calls[0][0].error.message).toBe('Job not found');
    });
  });

  describe('unauthorized()', () => {
    it('returns 401 with UNAUTHORIZED code', () => {
      const res = mockRes();
      unauthorized(res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json.mock.calls[0][0].error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('forbidden()', () => {
    it('returns 403 with FORBIDDEN code', () => {
      const res = mockRes();
      forbidden(res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].error.code).toBe('FORBIDDEN');
    });
  });

  describe('serverError()', () => {
    it('returns 500 with INTERNAL_ERROR code', () => {
      const res = mockRes();
      serverError(res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json.mock.calls[0][0].error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('validationError()', () => {
    it('returns 422 with VALIDATION_ERROR code and details', () => {
      const res = mockRes();
      const details = [{ field: 'email', message: 'must be valid email' }];
      validationError(res, details);
      expect(res.status).toHaveBeenCalledWith(422);
      const body = res.json.mock.calls[0][0];
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toEqual(details);
    });
  });

  describe('tooManyRequests()', () => {
    it('returns 429 with RATE_LIMIT_EXCEEDED code', () => {
      const res = mockRes();
      tooManyRequests(res);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json.mock.calls[0][0].error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});
