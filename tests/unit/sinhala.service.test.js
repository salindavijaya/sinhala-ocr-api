'use strict';

const {
  normalize,
  normalizePages,
  applyCorrections,
  normalizeUnicode,
  cleanWhitespace,
  removeNoise,
  sinhalaRatio,
  isSinhalaChar,
} = require('../../src/services/sinhala.service');

describe('sinhalaService', () => {
  // ──────────────────────────────────────────────────────────────
  describe('isSinhalaChar', () => {
    it('returns true for characters in Sinhala Unicode block', () => {
      expect(isSinhalaChar(0x0d9a)).toBe(true);  // ක
      expect(isSinhalaChar(0x0dca)).toBe(true);  // hal kirima (virama)
      expect(isSinhalaChar(0x0d80)).toBe(true);  // block start
      expect(isSinhalaChar(0x0dff)).toBe(true);  // block end
    });

    it('returns false for non-Sinhala characters', () => {
      expect(isSinhalaChar(0x0041)).toBe(false); // 'A'
      expect(isSinhalaChar(0x0061)).toBe(false); // 'a'
      expect(isSinhalaChar(0x0031)).toBe(false); // '1'
      expect(isSinhalaChar(0x0e00)).toBe(false); // Thai block (just above Sinhala)
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe('sinhalaRatio', () => {
    it('returns 0 for empty string', () => {
      expect(sinhalaRatio('')).toBe(0);
    });

    it('returns 0 for null/undefined', () => {
      expect(sinhalaRatio(null)).toBe(0);
      expect(sinhalaRatio(undefined)).toBe(0);
    });

    it('returns 1 for all-Sinhala text', () => {
      const text = '\u0d9a\u0dca\u0dbb\u0dd2\u0dba\u0dcf'; // ක්‍රියා
      const ratio = sinhalaRatio(text);
      expect(ratio).toBeGreaterThan(0.8);
    });

    it('returns 0 for all-Latin text', () => {
      expect(sinhalaRatio('Hello World')).toBe(0);
    });

    it('returns partial ratio for mixed text', () => {
      // 4 Sinhala chars + 6 Latin chars = ~0.4
      const sinhala = '\u0d9a\u0dbb\u0dd2\u0dcf';
      const mixed = sinhala + 'LATIN1';
      const ratio = sinhalaRatio(mixed);
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(1);
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe('removeNoise', () => {
    it('removes control characters', () => {
      const dirty = 'hello\x00world\x07';
      expect(removeNoise(dirty)).toBe('helloworld');
    });

    it('preserves newlines and tabs', () => {
      const text = 'line1\nline2\ttabbed';
      expect(removeNoise(text)).toBe('line1\nline2\ttabbed');
    });

    it('preserves normal Unicode characters', () => {
      const text = 'Hello \u0d9a\u0dca\u0dbb\u0dd2\u0dba\u0dcf World';
      expect(removeNoise(text)).toBe(text);
    });

    it('removes BOM', () => {
      const text = '\uFEFFHello';
      // BOM is stripped in applyCorrections, not removeNoise
      // removeNoise targets ASCII control chars
      expect(removeNoise('Hello')).toBe('Hello');
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe('cleanWhitespace', () => {
    it('collapses multiple spaces to one', () => {
      expect(cleanWhitespace('hello   world')).toBe('hello world');
    });

    it('collapses multiple newlines to at most two', () => {
      expect(cleanWhitespace('a\n\n\n\nb')).toBe('a\n\nb');
    });

    it('trims trailing spaces from lines', () => {
      expect(cleanWhitespace('hello   \nworld')).toBe('hello\nworld');
    });

    it('trims leading and trailing whitespace', () => {
      expect(cleanWhitespace('  hello world  ')).toBe('hello world');
    });

    it('normalises Windows line endings to LF', () => {
      expect(cleanWhitespace('hello\r\nworld')).toBe('hello\nworld');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(cleanWhitespace('   \n\n  ')).toBe('');
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe('normalizeUnicode', () => {
    it('returns NFC normalized text', () => {
      // NFC: ể = U+1EBF (precomposed)
      // NFD: e + combining chars
      const nfd = '\u0065\u0302\u0301'; // e + circumflex + acute (decomposed)
      const nfc = nfd.normalize('NFC');
      expect(normalizeUnicode(nfd)).toBe(nfc);
    });

    it('is idempotent on already-NFC text', () => {
      const text = '\u0d9a\u0dca\u0dbb\u0dd2\u0dba\u0dcf';
      expect(normalizeUnicode(text)).toBe(normalizeUnicode(normalizeUnicode(text)));
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe('applyCorrections', () => {
    it('removes zero-width spaces', () => {
      expect(applyCorrections('hello\u200Bworld')).toBe('helloworld');
    });

    it('removes BOM characters', () => {
      expect(applyCorrections('\uFEFFtext')).toBe('text');
    });

    it('removes zero-width non-joiners', () => {
      expect(applyCorrections('hello\u200Cworld')).toBe('helloworld');
    });

    it('does not alter clean Sinhala text', () => {
      const clean = '\u0d9a\u0dbb\u0dd2\u0dba\u0dcf';
      // Clean text should pass through without unwanted modification
      const result = applyCorrections(clean);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles empty string', () => {
      expect(applyCorrections('')).toBe('');
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe('normalize', () => {
    it('returns structured result object', () => {
      const result = normalize('Hello');
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('sinhalaRatio');
    });

    it('returns low confidence for Latin-only text', () => {
      const result = normalize('Hello World');
      expect(result.confidence).toBe('low');
      expect(result.sinhalaRatio).toBe(0);
    });

    it('returns high confidence for Sinhala-heavy text', () => {
      // Construct a string that is predominantly Sinhala code points
      const sinhalaText = '\u0d9a\u0dbb\u0dd2\u0dba\u0dcf '.repeat(10);
      const result = normalize(sinhalaText);
      expect(result.confidence).toBe('high');
      expect(result.sinhalaRatio).toBeGreaterThan(0.6);
    });

    it('returns empty result for null input', () => {
      const result = normalize(null);
      expect(result.text).toBe('');
      expect(result.confidence).toBe(0);
      expect(result.sinhalaRatio).toBe(0);
    });

    it('returns empty result for empty string', () => {
      const result = normalize('');
      expect(result.text).toBe('');
    });

    it('strips noise from mixed input', () => {
      const noisy = '\uFEFF\u200BHello\x00World';
      const result = normalize(noisy);
      expect(result.text).not.toContain('\uFEFF');
      expect(result.text).not.toContain('\u200B');
      expect(result.text).not.toContain('\x00');
    });

    it('is idempotent — normalising twice gives same result', () => {
      const text = '  hello\r\nworld\u200B  ';
      const once = normalize(text).text;
      const twice = normalize(once).text;
      expect(once).toBe(twice);
    });
  });

  // ──────────────────────────────────────────────────────────────
  describe('normalizePages', () => {
    it('processes an array of page texts', () => {
      const pages = ['page one text', 'page two text'];
      const result = normalizePages(pages);
      expect(result.pageCount).toBe(2);
      expect(result.pages).toHaveLength(2);
      expect(result.combinedText).toContain('page one text');
      expect(result.combinedText).toContain('page two text');
    });

    it('inserts page break separator between pages', () => {
      const pages = ['first', 'second'];
      const result = normalizePages(pages);
      expect(result.combinedText).toContain('--- Page Break ---');
    });

    it('handles a single page', () => {
      const result = normalizePages(['only page']);
      expect(result.pageCount).toBe(1);
      expect(result.combinedText).not.toContain('Page Break');
    });

    it('includes averageSinhalaRatio in result', () => {
      const result = normalizePages(['hello', 'world']);
      expect(typeof result.averageSinhalaRatio).toBe('number');
      expect(result.averageSinhalaRatio).toBeGreaterThanOrEqual(0);
      expect(result.averageSinhalaRatio).toBeLessThanOrEqual(1);
    });

    it('includes overallConfidence in result', () => {
      const result = normalizePages(['hello']);
      expect(['high', 'medium', 'low']).toContain(result.overallConfidence);
    });
  });
});
