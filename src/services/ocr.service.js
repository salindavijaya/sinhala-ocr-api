'use strict';

const vision = require('@google-cloud/vision');
const config = require('../config');
const logger = require('../utils/logger');
const { normalizePages } = require('./sinhala.service');
const { buildGcsUri } = require('./storage.service');

const client = new vision.ImageAnnotatorClient({
  projectId: config.gcp.projectId,
  ...(config.gcp.keyFile && { keyFilename: config.gcp.keyFile }),
});

/**
 * Perform OCR on an image buffer using Google Cloud Vision.
 * Uses DOCUMENT_TEXT_DETECTION which is optimised for dense text and documents.
 *
 * @param {Buffer} imageBuffer - Raw image bytes (JPEG, PNG, TIFF)
 * @param {string} languageHint - BCP-47 language code, default 'si' (Sinhala)
 * @returns {Promise<{ rawText: string, pages: Array, confidence: number }>}
 */
const ocrImage = async (imageBuffer, languageHint = 'si') => {
  logger.info('Starting OCR on image buffer', { size: imageBuffer.length, languageHint });

  const [result] = await client.documentTextDetection({
    image: { content: imageBuffer.toString('base64') },
    imageContext: {
      languageHints: [languageHint, 'si-LK'],
    },
  });

  const fullTextAnnotation = result.fullTextAnnotation;

  if (!fullTextAnnotation) {
    logger.warn('Vision API returned no text annotation');
    return { rawText: '', pages: [], confidence: 0 };
  }

  const rawText = fullTextAnnotation.text || '';

  // Extract per-page text for multi-page awareness
  const pageTexts = (fullTextAnnotation.pages || []).map((page) => {
    return page.blocks
      .flatMap((block) => block.paragraphs)
      .flatMap((para) => para.words)
      .map((word) => word.symbols.map((s) => s.text).join(''))
      .join(' ');
  });

  // Calculate average confidence from blocks
  let totalConf = 0;
  let confCount = 0;
  (fullTextAnnotation.pages || []).forEach((page) => {
    page.blocks.forEach((block) => {
      if (block.confidence != null) {
        totalConf += block.confidence;
        confCount++;
      }
    });
  });

  const avgConfidence = confCount > 0 ? totalConf / confCount : 0;

  logger.info('OCR completed', {
    charCount: rawText.length,
    pageCount: pageTexts.length,
    avgConfidence: avgConfidence.toFixed(2),
  });

  return {
    rawText,
    pageTexts: pageTexts.length > 0 ? pageTexts : [rawText],
    visionConfidence: avgConfidence,
  };
};

/**
 * Perform OCR on a PDF buffer.
 * For PDFs, Vision API's async batch processing is more reliable,
 * but for MVP we use the sync API with a single-page limit and recommend
 * users split large PDFs. Multi-page async support is a Phase 2 feature.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{ rawText: string, pageTexts: string[], visionConfidence: number }>}
 */
const ocrPdf = async (pdfBuffer, languageHint = 'si') => {
  logger.info('Starting OCR on PDF buffer', { size: pdfBuffer.length });

  // Vision supports PDF via base64 in the sync API (up to ~5MB, single page rendered)
  const [result] = await client.documentTextDetection({
    image: { content: pdfBuffer.toString('base64') },
    imageContext: {
      languageHints: [languageHint, 'si-LK'],
    },
  });

  const fullTextAnnotation = result.fullTextAnnotation;
  if (!fullTextAnnotation) {
    return { rawText: '', pageTexts: [''], visionConfidence: 0 };
  }

  const rawText = fullTextAnnotation.text || '';
  return { rawText, pageTexts: [rawText], visionConfidence: 0.8 };
};

/**
 * Main OCR entry point. Dispatches to image or PDF handler based on MIME type.
 * Returns fully normalised Sinhala text plus metadata.
 *
 * @param {Buffer} fileBuffer
 * @param {string} mimeType
 * @param {string} [languageHint='si']
 * @returns {Promise<OcrResult>}
 */
const transcribe = async (fileBuffer, mimeType, languageHint = 'si') => {
  let rawResult;

  if (mimeType === 'application/pdf') {
    rawResult = await ocrPdf(fileBuffer, languageHint);
  } else {
    rawResult = await ocrImage(fileBuffer, languageHint);
  }

  const normalised = normalizePages(rawResult.pageTexts);

  return {
    extractedText: normalised.combinedText,
    pages: normalised.pages,
    pageCount: normalised.pageCount,
    visionConfidence: rawResult.visionConfidence,
    sinhalaRatio: normalised.averageSinhalaRatio,
    overallConfidence: normalised.overallConfidence,
  };
};

/**
 * Shared result processor for both buffer and URI approaches.
 * Extracts text, pages, and confidence from Vision API response.
 *
 * @private
 * @param {Object} fullTextAnnotation - Vision API fullTextAnnotation object
 * @returns {Object} - { rawText, pageTexts, visionConfidence }
 */
const _processVisionResult = (fullTextAnnotation) => {
  if (!fullTextAnnotation) {
    logger.warn('Vision API returned no text annotation');
    return { rawText: '', pageTexts: [], visionConfidence: 0 };
  }

  const rawText = fullTextAnnotation.text || '';

  // Extract per-page text for multi-page awareness
  const pageTexts = (fullTextAnnotation.pages || []).map((page) => {
    return page.blocks
      .flatMap((block) => block.paragraphs)
      .flatMap((para) => para.words)
      .map((word) => word.symbols.map((s) => s.text).join(''))
      .join(' ');
  });

  // Calculate average confidence from blocks
  let totalConf = 0;
  let confCount = 0;
  (fullTextAnnotation.pages || []).forEach((page) => {
    page.blocks.forEach((block) => {
      if (block.confidence != null) {
        totalConf += block.confidence;
        confCount++;
      }
    });
  });

  const avgConfidence = confCount > 0 ? totalConf / confCount : 0;

  return {
    rawText,
    pageTexts: pageTexts.length > 0 ? pageTexts : [rawText],
    visionConfidence: avgConfidence,
  };
};

/**
 * Perform OCR on an image using GCS bucket URI.
 * Uses DOCUMENT_TEXT_DETECTION which is optimised for dense text and documents.
 *
 * @param {string} gcsImageUri - GCS URI (e.g., "gs://bucket/path/to/image.jpg")
 * @param {string} languageHint - BCP-47 language code, default 'si' (Sinhala)
 * @returns {Promise<{ rawText: string, pageTexts: Array, visionConfidence: number }>}
 */
const ocrImageUri = async (gcsImageUri, languageHint = 'si') => {
  logger.info('Starting OCR on image URI', { gcsImageUri, languageHint });

  const [result] = await client.documentTextDetection({
    image: { source: { gcsImageUri } },
    imageContext: {
      languageHints: [languageHint, 'si-LK'],
    },
  });
logger.info('OCR raw response data (URI)', {
    rawResult: result
    
  });
  const processedResult = _processVisionResult(result.fullTextAnnotation);

  logger.info('OCR completed (URI)', {
    charCount: processedResult.rawText.length,
    pageCount: processedResult.pageTexts.length,
    avgConfidence: processedResult.visionConfidence.toFixed(2),
  });

  return processedResult;
};

/**
 * Perform OCR on a PDF using GCS bucket URI.
 *
 * @param {string} gcsImageUri - GCS URI to PDF file
 * @param {string} languageHint - BCP-47 language code, default 'si' (Sinhala)
 * @returns {Promise<{ rawText: string, pageTexts: Array, visionConfidence: number }>}
 */
const ocrPdfUri = async (gcsImageUri, languageHint = 'si') => {
  logger.info('Starting OCR on PDF URI', { gcsImageUri });

  const [result] = await client.documentTextDetection({
    image: { source: { gcsImageUri } },
    imageContext: {
      languageHints: [languageHint, 'si-LK'],
    },
  });

  const processedResult = _processVisionResult(result.fullTextAnnotation);
  return processedResult;
};

/**
 * Main OCR entry point using GCS URIs. Dispatches to image or PDF handler based on MIME type.
 * Returns fully normalised Sinhala text plus metadata.
 *
 * @param {string} gcsInputPath - GCS path (e.g., "uploads/userId/jobId/file.jpg")
 * @param {string} mimeType - File MIME type
 * @param {string} [languageHint='si'] - BCP-47 language code
 * @param {'input'|'output'} [bucketType='input'] - Which bucket to use
 * @returns {Promise<OcrResult>}
 */
const transcribeUri = async (gcsInputPath, mimeType, languageHint = 'si', bucketType = 'input') => {
  const gcsImageUri = buildGcsUri(gcsInputPath, bucketType);
  let rawResult;

  if (mimeType === 'application/pdf') {
    rawResult = await ocrPdfUri(gcsImageUri, languageHint);
  } else {
    rawResult = await ocrImageUri(gcsImageUri, languageHint);
  }

  const normalised = normalizePages(rawResult.pageTexts);

  return {
    extractedText: normalised.combinedText,
    pages: normalised.pages,
    pageCount: normalised.pageCount,
    visionConfidence: rawResult.visionConfidence,
    sinhalaRatio: normalised.averageSinhalaRatio,
    overallConfidence: normalised.overallConfidence,
  };
};

module.exports = { transcribe, ocrImage, ocrPdf, transcribeUri, ocrImageUri, ocrPdfUri };
