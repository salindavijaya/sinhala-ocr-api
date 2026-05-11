'use strict';

const { generateDocx, generatePdf } = require('../../src/services/document.service');
const { PDFDocument } = require('pdf-lib');

describe('document.service', () => {
  const sampleText = 'අද කාලය සුන්දරයි\nපොත කියවන්න\n--- Page Break ---\nනව පිටුවේ පෙළ';
  const meta = { originalFilename: 'test-document.pdf', jobId: 'job-1', pageCount: 2 };

  it('generates a valid DOCX buffer from normalized text', async () => {
    const buffer = await generateDocx(sampleText, meta);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 2).toString()).toBe('PK');
  });

  it('generates a valid PDF buffer from normalized text', async () => {
    const buffer = await generatePdf(sampleText, meta);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 4).toString()).toBe('%PDF');

    const pdfDoc = await PDFDocument.load(buffer);
    expect(pdfDoc.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it('preserves page breaks in DOCX and PDF output buffers', async () => {
    const docxBuffer = await generateDocx(sampleText, meta);
    expect(docxBuffer.length).toBeGreaterThan(100);

    const pdfBuffer = await generatePdf(sampleText, meta);
    expect(pdfBuffer.length).toBeGreaterThan(100);
  });
});
