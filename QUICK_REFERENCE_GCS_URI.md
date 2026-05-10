# GCS URI Vision API - Quick Reference Guide

## For Developers: How to Use the New Functions

### Installation

No installation needed - functions are already in place. Just import and use:

```javascript
const { transcribeUri, ocrImageUri, ocrPdfUri } = require('../services/ocr.service');
const { buildGcsUri } = require('../services/storage.service');
```

## API Reference

### `buildGcsUri(gcsPath, bucketType)`

Constructs a GCS URI from a path string.

**Parameters**:
- `gcsPath` (string): GCS object path, e.g., `uploads/user-1/job-1/file.jpg`
- `bucketType` (string, optional): `'input'` or `'output'`, defaults to `'input'`

**Returns**: Full GCS URI, e.g., `gs://sinhala-ocr-uploads/uploads/user-1/job-1/file.jpg`

**Examples**:
```javascript
// Build input bucket URI
const inputUri = buildGcsUri('uploads/user-123/job-456/document.jpg', 'input');
// Returns: 'gs://sinhala-ocr-uploads/uploads/user-123/job-456/document.jpg'

// Build output bucket URI
const outputUri = buildGcsUri('outputs/user-123/job-456/transcription.docx', 'output');
// Returns: 'gs://sicript_bucket_output/outputs/user-123/job-456/transcription.docx'

// Default to input bucket
const uri = buildGcsUri('uploads/user-123/job-456/file.png');
// Returns: 'gs://sinhala-ocr-uploads/uploads/user-123/job-456/file.png'
```

---

### `transcribeUri(gcsInputPath, mimeType, languageHint, bucketType)`

Main OCR entry point using GCS URIs. Automatically routes to image or PDF handler.

**Parameters**:
- `gcsInputPath` (string, required): GCS path to input file
- `mimeType` (string, required): File MIME type (`image/jpeg`, `image/png`, `application/pdf`)
- `languageHint` (string, optional): BCP-47 language code, defaults to `'si'` (Sinhala)
- `bucketType` (string, optional): `'input'` or `'output'`, defaults to `'input'`

**Returns**: Promise resolving to OCR result object
```javascript
{
  extractedText: string,           // Normalized Sinhala text
  pages: Array<string>,            // Text per page
  pageCount: number,               // Total pages
  visionConfidence: number,        // Vision API confidence (0-1)
  sinhalaRatio: number,            // Ratio of Sinhala characters
  overallConfidence: string,       // 'low' | 'medium' | 'high'
}
```

**Examples**:
```javascript
// Basic image OCR (Sinhala)
const result = await transcribeUri(
  'uploads/user-1/job-1/invoice.jpg',
  'image/jpeg'
);
// Returns: { extractedText: '...', pages: [...], pageCount: 2, ... }

// Image OCR with English language hint
const result = await transcribeUri(
  'uploads/user-1/job-1/passport.jpg',
  'image/jpeg',
  'en'                             // English language hint
);

// PDF OCR
const result = await transcribeUri(
  'uploads/user-1/job-1/report.pdf',
  'application/pdf'
);

// Handle errors
try {
  const result = await transcribeUri(path, mimeType);
  console.log(`Extracted ${result.pageCount} pages`);
} catch (error) {
  console.error('OCR failed:', error.message);
}
```

---

### `ocrImageUri(gcsImageUri, languageHint)`

Low-level function for image OCR using GCS URI.

**Parameters**:
- `gcsImageUri` (string, required): Full GCS URI, e.g., `gs://bucket/path/file.jpg`
- `languageHint` (string, optional): BCP-47 language code, defaults to `'si'`

**Returns**: Promise resolving to raw OCR result
```javascript
{
  rawText: string,                 // Raw text from Vision API
  pageTexts: Array<string>,        // Text per page
  visionConfidence: number,        // Confidence (0-1)
}
```

**Examples**:
```javascript
// Construct URI manually
const uri = buildGcsUri('uploads/user-1/job-1/image.jpg');
const result = await ocrImageUri(uri);
// Same as: transcribeUri('uploads/user-1/job-1/image.jpg', 'image/jpeg')

// Or directly
const result = await ocrImageUri(
  'gs://sinhala-ocr-uploads/uploads/user-1/job-1/image.jpg'
);
```

---

### `ocrPdfUri(gcsImageUri, languageHint)`

Low-level function for PDF OCR using GCS URI.

**Parameters**:
- `gcsImageUri` (string, required): Full GCS URI to PDF file
- `languageHint` (string, optional): BCP-47 language code, defaults to `'si'`

**Returns**: Promise resolving to raw OCR result (same structure as `ocrImageUri()`)

**Example**:
```javascript
const uri = buildGcsUri('uploads/user-1/job-1/document.pdf');
const result = await ocrPdfUri(uri);
```

---

## Comparison: Old vs New

### Old Approach (Buffer-Based)

```javascript
// Import
const { transcribe } = require('../services/ocr.service');
const { downloadBuffer } = require('../services/storage.service');

// Usage
const fileBuffer = await downloadBuffer(gcsInputPath, 'input');  // Download file
const result = await transcribe(fileBuffer, mimeType);           // OCR buffer

// Time: ~10s download + ~40s OCR = ~50s
// Memory: ~200MB buffer allocation
```

### New Approach (URI-Based) ✅

```javascript
// Import
const { transcribeUri } = require('../services/ocr.service');

// Usage
const result = await transcribeUri(gcsInputPath, mimeType);      // Direct OCR

// Time: ~40s OCR only (20-30% faster)
// Memory: ~100 bytes URI string (-99% memory)
```

---

## Migration Guide

### For Worker Code

**Before**:
```javascript
const { transcribe } = require('../services/ocr.service');
const { downloadBuffer } = require('../services/storage.service');

const fileBuffer = await downloadBuffer(gcsInputPath, 'input');
const ocrResult = await transcribe(fileBuffer, mimeType, languageHint);
```

**After**:
```javascript
const { transcribeUri } = require('../services/ocr.service');

const ocrResult = await transcribeUri(gcsInputPath, mimeType, languageHint, 'input');
```

### For Other Code (Optional)

You can migrate other code using OCR, or keep the old approach. Both work:

```javascript
// ✅ New approach (recommended)
const result = await transcribeUri(gcsPath, mimeType);

// ✅ Old approach still works
const buffer = await downloadBuffer(gcsPath);
const result = await transcribe(buffer, mimeType);
```

---

## Error Handling

Both old and new approaches throw the same errors:

```javascript
try {
  const result = await transcribeUri('uploads/user-1/job-1/file.jpg', 'image/jpeg');
} catch (error) {
  // Vision API errors (unchanged)
  if (error.message.includes('INVALID_ARGUMENT')) {
    console.error('Invalid image format');
  }
  
  // GCS errors (new)
  if (error.message.includes('Not Found')) {
    console.error('File not found in GCS');
  }
  
  // Permission errors (same as before)
  if (error.message.includes('Permission denied')) {
    console.error('Service account lacks permissions');
  }
}
```

---

## Testing

### Unit Tests

```javascript
describe('transcribeUri()', () => {
  it('extracts text from URI', async () => {
    const result = await transcribeUri(
      'uploads/user/job/file.jpg',
      'image/jpeg'
    );
    expect(result).toHaveProperty('extractedText');
    expect(result).toHaveProperty('pageCount');
  });
  
  it('handles PDFs', async () => {
    const result = await transcribeUri(
      'uploads/user/job/file.pdf',
      'application/pdf'
    );
    expect(result.pageCount).toBeGreaterThan(0);
  });
});
```

### Integration Tests

```javascript
describe('Worker with transcribeUri', () => {
  it('processes jobs using URI approach', async () => {
    const bullJob = {
      data: {
        jobId: 'job-123',
        gcsInputPath: 'uploads/user-1/job-123/document.jpg',
        mimeType: 'image/jpeg',
      }
    };
    
    await processJob(bullJob);
    
    // Verify transcribeUri was called
    expect(transcribeUri).toHaveBeenCalledWith(
      'uploads/user-1/job-123/document.jpg',
      'image/jpeg',
      expect.any(String),
      'input'
    );
  });
});
```

---

## Performance Tips

### 1. Pre-compute URIs if Needed

```javascript
// If you need to use the same URI multiple times
const uri = buildGcsUri(gcsPath);
const result1 = await ocrImageUri(uri);
const result2 = await someOtherFunction(uri);
```

### 2. Leverage Async Processing

```javascript
// ✅ Process multiple jobs in parallel
const results = await Promise.all([
  transcribeUri(path1, 'image/jpeg'),
  transcribeUri(path2, 'image/jpeg'),
  transcribeUri(path3, 'image/jpeg'),
]);

// ❌ Don't await in sequence if not necessary
// const result1 = await transcribeUri(path1);
// const result2 = await transcribeUri(path2);
```

### 3. Monitor Processing Time

```javascript
const startTime = Date.now();
const result = await transcribeUri(gcsPath, mimeType);
const processingTime = Date.now() - startTime;

logger.info('OCR completed', {
  jobId,
  processingTime,
  pageCount: result.pageCount,
  confidence: result.overallConfidence,
});
```

---

## Backward Compatibility

The old functions still work and will continue to work:

```javascript
// ✅ Still valid
const buffer = await downloadBuffer(gcsPath);
const result = await transcribe(buffer, mimeType);

// ✅ New way
const result = await transcribeUri(gcsPath, mimeType);

// Both return identical result structures
```

---

## FAQ

**Q: Should I use the new functions?**  
A: Yes, for new code. Old functions still work but are slower.

**Q: Can I mix old and new approaches?**  
A: Yes, both work independently. Good for gradual migration.

**Q: Will old functions be removed?**  
A: Not soon. They'll be kept for at least 2-3 releases for backward compatibility.

**Q: What if the Vision API changes?**  
A: The refactoring is transparent - Vision API changes affect both approaches equally.

**Q: How do I debug if OCR fails?**  
A: Check logs for "Vision API" errors or "GCS" errors. Both throw appropriate exceptions.

**Q: Does this work with all file types?**  
A: Yes - same MIME types as before: JPEG, PNG, TIFF, PDF

**Q: What about very large files?**  
A: New approach handles large files better (no buffer allocation).

---

## Support

- **Technical Details**: See `IMPLEMENTATION_NOTES_GCS_URI.md`
- **Deployment Guide**: See `DEPLOYMENT_GCS_URI.md`
- **Source Code**: `src/services/ocr.service.js`, `src/services/storage.service.js`
- **Tests**: `tests/unit/ocr.service.test.js`, `tests/integration/transcription.worker.test.js`
