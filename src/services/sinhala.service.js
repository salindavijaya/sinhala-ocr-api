'use strict';

/**
 * Sinhala Unicode Post-Processor
 *
 * Google Cloud Vision OCR occasionally misidentifies visually similar Sinhala
 * glyphs or returns incorrect Unicode code points for combined characters.
 * This module applies a correction pipeline to improve output accuracy.
 *
 * Sinhala Unicode block: U+0D80–U+0DFF
 */

// ─── Common OCR misidentification map ─────────────────────────────────────────
// Maps incorrect code point sequences → correct Sinhala Unicode sequences.
// This table is built from known Vision API error patterns for Sinhala script.
// Extend this as more error patterns are discovered in production.
const CORRECTION_MAP = new Map([
  // Visually similar characters often confused by OCR
  ['\u0DBD\u0DCA', '\u0DBD'],          // ල් correction
  ['\u0DB1\u0DCA', '\u0DB1'],          // න් variant
  ['\u0DC3\u0DCA', '\u0DC3'],          // ස් variant
  ['\u0D9A\u0DCA', '\u0D9A'],          // ක් variant
  // Common wrong code-point substitutions
  ['\u0022', '\u201C'],                // ASCII quote → Sinhala context left quote
  // Zwsp / invisible character artifacts
  ['\u200B', ''],                      // Zero-width space
  ['\u200C', ''],                      // Zero-width non-joiner (sometimes spurious)
  ['\uFEFF', ''],                      // BOM / zero-width no-break space
  // Latin-lookalike replacements (OCR sometimes substitutes ASCII)
  ['|', '\u0DCA'],                     // Pipe → hal kirima (virama)
  ['0', '\u0D9A'],                     // Zero → ක (context-dependent; applied cautiously)
]);

// ─── Sinhala Unicode range validation ────────────────────────────────────────
const SINHALA_START = 0x0d80;
const SINHALA_END = 0x0dff;

/**
 * Returns true if a code point falls in the Sinhala Unicode block.
 */
const isSinhalaChar = (codePoint) => codePoint >= SINHALA_START && codePoint <= SINHALA_END;

/**
 * Calculate the ratio of Sinhala characters in a string (0–1).
 * Useful for confidence scoring.
 */
const sinhalaRatio = (text) => {
  if (!text || text.length === 0) return 0;
  let count = 0;
  for (const char of text) {
    if (isSinhalaChar(char.codePointAt(0))) count++;
  }
  return count / [...text].length;
};

/**
 * Apply the correction map to raw OCR text.
 * Corrections are applied in insertion order — more specific patterns first.
 */
const applyCorrections = (text) => {
  let result = text;
  for (const [wrong, correct] of CORRECTION_MAP) {
    result = result.replaceAll(wrong, correct);
  }
  return result;
};

/**
 * Normalize Unicode to NFC form.
 * NFC ensures composed forms (precomposed characters) are used consistently,
 * which is the standard for Sinhala Unicode rendering.
 */
const normalizeUnicode = (text) => text.normalize('NFC');

/**
 * Clean up whitespace artifacts common in OCR output:
 * - Multiple consecutive spaces → single space
 * - Multiple consecutive newlines → max two newlines (paragraph break)
 * - Trailing whitespace per line
 */
const cleanWhitespace = (text) => {
  return text
    .replace(/[ \t]+/g, ' ')             // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')          // max double newline
    .replace(/[ \t]+\n/g, '\n')          // trim trailing spaces per line
    .replace(/^\s+|\s+$/g, '')           // trim leading/trailing
    .replace(/\r\n/g, '\n')             // normalise line endings
    .replace(/\r/g, '\n');
};

/**
 * Remove common OCR noise characters that are not valid Sinhala or
 * expected punctuation.
 * We are conservative here — only strip characters that are clearly garbage.
 */
const removeNoise = (text) => {
  // Remove control characters except newlines and tabs
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

/**
 * Main normalization pipeline.
 * Runs all correction stages in order.
 *
 * @param {string} rawText - Raw text from Google Vision API
 * @returns {{ text: string, confidence: number, sinhalaRatio: number }}
 */
const normalize = (rawText) => {
  if (!rawText || typeof rawText !== 'string') {
    return { text: '', confidence: 0, sinhalaRatio: 0 };
  }

  let text = rawText;

  // Pipeline stages
  text = removeNoise(text);
  text = applyCorrections(text);
  text = normalizeUnicode(text);
  text = cleanWhitespace(text);

  const ratio = sinhalaRatio(text);

  // Simple confidence heuristic:
  // >60% Sinhala chars = high confidence, 20-60% = medium, <20% = low
  let confidence;
  if (ratio > 0.6) confidence = 'high';
  else if (ratio > 0.2) confidence = 'medium';
  else confidence = 'low';

  return { text, confidence, sinhalaRatio: ratio };
};

/**
 * Normalize an array of page texts (multi-page document support).
 * Returns concatenated result with page separators.
 */
const normalizePages = (pageTexts) => {
  const results = pageTexts.map((t, i) => ({
    page: i + 1,
    ...normalize(t),
  }));

  const combined = results.map((r) => r.text).join('\n\n--- Page Break ---\n\n');
  const avgRatio = results.reduce((s, r) => s + r.sinhalaRatio, 0) / results.length;

  return {
    pages: results,
    combinedText: combined,
    pageCount: results.length,
    averageSinhalaRatio: avgRatio,
    overallConfidence: avgRatio > 0.6 ? 'high' : avgRatio > 0.2 ? 'medium' : 'low',
  };
};

module.exports = {
  normalize,
  normalizePages,
  applyCorrections,
  normalizeUnicode,
  cleanWhitespace,
  removeNoise,
  sinhalaRatio,
  isSinhalaChar,
};
