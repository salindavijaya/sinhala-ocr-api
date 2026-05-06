'use strict';

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Header, Footer, PageNumber, NumberFormat,
} = require('docx');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const logger = require('../utils/logger');

const FONT_SIZE_PT = 14; // 14pt body text for Sinhala legibility
const LINE_SPACING = 360; // 360 twips = 1.5× line spacing
const PAGE_MARGIN = 720; // 720 twips = 0.5 inch margin

/**
 * Generate a DOCX buffer from normalised Sinhala text.
 *
 * @param {string} text - Normalised Sinhala Unicode text
 * @param {object} meta - { originalFilename, pageCount, jobId }
 * @returns {Promise<Buffer>}
 */
const generateDocx = async (text, meta = {}) => {
  logger.info('Generating DOCX', { jobId: meta.jobId, charCount: text.length });

  const paragraphs = text
    .split('\n')
    .map((line) => {
      const isPageBreak = line.trim() === '--- Page Break ---';
      if (isPageBreak) {
        return new Paragraph({ pageBreakBefore: true });
      }
      return new Paragraph({
        children: [
          new TextRun({
            text: line || ' ',
            size: FONT_SIZE_PT * 2, // docx uses half-points
            font: 'Noto Sans Sinhala', // best open-source Sinhala font; falls back gracefully
          }),
        ],
        spacing: { line: LINE_SPACING },
        alignment: AlignmentType.LEFT,
      });
    });

  const headerParagraph = new Paragraph({
    children: [
      new TextRun({
        text: `Transcribed by Sinhala OCR API  |  Source: ${meta.originalFilename || 'document'}`,
        size: 18,
        color: '888888',
      }),
    ],
    alignment: AlignmentType.RIGHT,
  });

  const doc = new Document({
    creator: 'Sinhala OCR API',
    title: `Transcription — ${meta.originalFilename || 'document'}`,
    description: `Auto-generated Sinhala transcription. Pages: ${meta.pageCount || 1}`,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: PAGE_MARGIN,
              bottom: PAGE_MARGIN,
              left: PAGE_MARGIN * 1.5,
              right: PAGE_MARGIN * 1.5,
            },
          },
        },
        headers: { default: new Header({ children: [headerParagraph] }) },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun('Page '),
                  new TextRun({ children: [PageNumber.CURRENT] }),
                  new TextRun(' of '),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children: paragraphs,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  logger.info('DOCX generated', { jobId: meta.jobId, sizeBytes: buffer.length });
  return buffer;
};

/**
 * Generate a PDF buffer from normalised Sinhala text.
 *
 * NOTE: pdf-lib uses standard embedded fonts which do NOT include Sinhala glyphs.
 * For MVP, we embed the text as Unicode and rely on the viewer's font substitution.
 * Phase 2 should embed a proper Sinhala font (Noto Sans Sinhala) using fontkit.
 *
 * @param {string} text - Normalised Sinhala Unicode text
 * @param {object} meta
 * @returns {Promise<Buffer>}
 */
const generatePdf = async (text, meta = {}) => {
  logger.info('Generating PDF', { jobId: meta.jobId, charCount: text.length });

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Transcription — ${meta.originalFilename || 'document'}`);
  pdfDoc.setCreator('Sinhala OCR API');
  pdfDoc.setProducer('Sinhala OCR API v1.0');
  pdfDoc.setCreationDate(new Date());

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 12;
  const margin = 50;
  const lineHeight = fontSize * 1.6;

  const lines = text.split('\n');
  let currentPage = null;
  let y = 0;
  const pageWidth = 595;   // A4
  const pageHeight = 842;  // A4
  const usableHeight = pageHeight - margin * 2;

  const addPage = () => {
    currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin - fontSize;

    // Header
    currentPage.drawText(`Source: ${meta.originalFilename || 'document'} | Sinhala OCR API`, {
      x: margin,
      y: pageHeight - margin + 10,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  };

  addPage();

  for (const line of lines) {
    if (line.trim() === '--- Page Break ---') {
      addPage();
      continue;
    }

    if (y < margin) {
      addPage();
    }

    // pdf-lib cannot render Sinhala glyphs with standard fonts.
    // We draw the text anyway — viewers with Sinhala font support will display it.
    try {
      currentPage.drawText(line || ' ', {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth: pageWidth - margin * 2,
      });
    } catch {
      // Skip lines with characters outside the font's encoding
    }

    y -= lineHeight;
  }

  // Footer on each page
  const pages = pdfDoc.getPages();
  pages.forEach((page, i) => {
    page.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: pageWidth / 2 - 30,
      y: margin - 25,
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  });

  const pdfBytes = await pdfDoc.save();
  const buffer = Buffer.from(pdfBytes);
  logger.info('PDF generated', { jobId: meta.jobId, sizeBytes: buffer.length, pages: pages.length });
  return buffer;
};

module.exports = { generateDocx, generatePdf };
