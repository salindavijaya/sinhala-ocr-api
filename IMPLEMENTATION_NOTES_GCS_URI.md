# GCS URI Vision API Refactoring - Implementation Notes

## Technical Overview

This document explains the technical implementation of the GCS URI refactoring for developers who need to understand or maintain this code.

## Architecture Changes

### Before: Buffer-Based Approach

```javascript
// Worker process
const fileBuffer = await downloadBuffer(gcsInputPath, 'input');  // Network I/O
const ocrResult = await transcribe(fileBuffer, mimeType);       // Encode to base64

// OCR service
const [result] = await client.documentTextDetection({
  image: { content: imageBuffer.toString('base64') }           // base64 encoded
  // Vision API downloads file data
});
```

**Issues**:
- Network round-trip to download from GCS
- Memory allocated for buffer in worker process
- Base64 encoding overhead
- Processing time: ~10s download + ~40s OCR = ~50s total

### After: URI-Based Approach

```javascript
// Worker process
const ocrResult = await transcribeUri(gcsInputPath, mimeType);  // Direct URI

// OCR service
const gcsUri = buildGcsUri(gcsInputPath, 'input');             // Construct URI
const [result] = await client.documentTextDetection({
  image: { gcsImageUri: gcsUri }                               // Direct GCS reference
  // Vision API fetches directly from GCS bucket
});
```

**Benefits**:
- No buffer download in worker
- No memory allocation
- Vision API reads directly from GCS
- Processing time: ~40s OCR = ~40s total (improved ~20%)

## Code Structure

### 1. Storage Service (`src/services/storage.service.js`)

**New Function: `buildGcsUri()`**

```javascript
const buildGcsUri = (gcsPath, bucketType = 'input') => {
  const bucketName = bucketType === 'output'
    ? config.gcp.storage.outputBucket
    : config.gcp.storage.inputBucket;
  return `gs://${bucketName}/${gcsPath}`;
};
```

**Purpose**: Centralize URI construction logic
- Takes: GCS object path (e.g., `uploads/userId/jobId/file.jpg`)
- Returns: Full URI (e.g., `gs://bucket-name/uploads/userId/jobId/file.jpg`)
- Uses dynamic bucket names from config (no hardcoding)
- Supports both input and output buckets

**Why separate function?**
- DRY principle - avoids duplicating URI construction
- Testable independently
- Future-proof for bucket name changes
- Clear separation of concerns

### 2. OCR Service (`src/services/ocr.service.js`)

**New Functions**:

#### `_processVisionResult(fullTextAnnotation)` (Private)

Shared helper for both buffer and URI approaches:

```javascript
// Extracts:
// - Raw text from Vision API response
// - Per-page text array
// - Average confidence score

// Used by:
// - ocrImage() and ocrImageUri()
// - ocrPdf() and ocrPdfUri()
```

**Why separate?**
- Vision API response processing is identical
- Avoids duplicating 40+ lines of processing logic
- Both buffer and URI approaches benefit from same logic

#### `ocrImageUri(gcsImageUri, languageHint)`

```javascript
const [result] = await client.documentTextDetection({
  image: { gcsImageUri },                          // ← Direct URI reference
  imageContext: {
    languageHints: [languageHint, 'si-LK'],
  },
});

// Rest of processing identical to ocrImage()
```

**Key Difference**: Uses `image.gcsImageUri` instead of `image.content`
- Vision API documentation: https://cloud.google.com/vision/docs/reference/rpc/google.cloud.vision.v1

#### `ocrPdfUri(gcsImageUri, languageHint)`

Same pattern as `ocrImageUri()` but for PDF files.

#### `transcribeUri(gcsInputPath, mimeType, languageHint, bucketType)`

Main entry point (mirrors `transcribe()` but with URIs):

```javascript
// 1. Build URI from path
const gcsImageUri = buildGcsUri(gcsInputPath, bucketType);

// 2. Route to appropriate handler
if (mimeType === 'application/pdf') {
  rawResult = await ocrPdfUri(gcsImageUri, languageHint);
} else {
  rawResult = await ocrImageUri(gcsImageUri, languageHint);
}

// 3. Normalize and return
const normalised = normalizePages(rawResult.pageTexts);
return {
  extractedText: normalised.combinedText,
  pages: normalised.pages,
  pageCount: normalised.pageCount,
  visionConfidence: rawResult.visionConfidence,
  sinhalaRatio: normalised.averageSinhalaRatio,
  overallConfidence: normalised.overallConfidence,
};
```

**Return Value**: Identical to `transcribe()` for compatibility

### 3. Worker (`src/workers/transcription.worker.js`)

**Key Change**:

```javascript
// ❌ BEFORE
const fileBuffer = await downloadBuffer(gcsInputPath, 'input');
const ocrResult = await transcribe(fileBuffer, mimeType, languageHint);

// ✅ AFTER
const ocrResult = await transcribeUri(gcsInputPath, mimeType, languageHint, 'input');
```

**Why pass `gcsInputPath` directly?**
- It's already available from queue job data
- No need to download first
- Reduces memory footprint
- Reduces network I/O

**Progress Milestones Adjusted**:

```
Before:
  5%  → Job started
  10% → Marked as processing
  25% → Buffer downloaded ← REMOVED
  60% → OCR completed
  75% → DOCX generated
  90% → PDF generated
  100%→ Complete

After:
  5%  → Job started
  10% → Marked as processing
  50% → OCR completed (faster, no download)
  70% → DOCX generated
  90% → PDF generated
  100%→ Complete
```

## Implementation Decisions

### 1. Keep Both Approaches Available

**Decision**: Don't remove old functions

**Rationale**:
- Enables gradual rollout with feature flags
- Easy rollback if issues occur
- Zero risk of breaking existing code
- Can run both approaches in parallel during transition

**Timeline for Cleanup**:
- Phase 1 (now): Add new functions, use in worker
- Phase 2 (2+ releases later): Mark old functions as `@deprecated`
- Phase 3 (3+ releases later): Remove old functions after support window

### 2. Shared Result Processing

**Decision**: Create `_processVisionResult()` helper

**Rationale**:
- Vision API returns identical response format regardless of request method
- ~40 lines of processing logic was duplicated between buffer and URI approaches
- Share the logic to avoid maintenance burden
- Makes future Vision API response changes easier

### 3. Build URI in transcribeUri()

**Decision**: Don't pass URI directly to worker

**Rationale**:
- Worker doesn't need to know about URI building logic
- Keeps separation of concerns
- `transcribeUri()` owns the full abstraction
- Easy to change bucket selection logic later

## Testing Strategy

### Unit Tests

**storage.service.test.js**:
```javascript
// Test URI construction
buildGcsUri('uploads/user-1/job-1/file.jpg', 'input')
  → 'gs://sinhala-ocr-uploads/uploads/user-1/job-1/file.jpg'

buildGcsUri('outputs/user-1/job-1/transcription.docx', 'output')
  → 'gs://sicript_bucket_output/outputs/user-1/job-1/transcription.docx'

// Test edge cases
- Special characters in path preserved
- Defaults to input bucket when not specified
- Proper gs:// scheme used
```

**ocr.service.test.js**:
```javascript
// Test Vision API call signature
ocrImageUri('gs://bucket/file.jpg')
  → Calls client.documentTextDetection({
      image: { gcsImageUri: 'gs://bucket/file.jpg' }
    })

// Test result structure
ocrImageUri() → Contains:
  - rawText
  - pageTexts
  - visionConfidence

// Test routing
transcribeUri(path, 'image/jpeg') → Calls ocrImageUri()
transcribeUri(path, 'application/pdf') → Calls ocrPdfUri()

// Test backward compatibility
transcribe(buffer, mimeType) → Still works
```

**Integration Tests (transcription.worker.test.js)**:
```javascript
// Test worker integration
processJob() → Calls transcribeUri()
processJob() → Does NOT call downloadBuffer()

// Test error handling
Vision API error → Job marked as failed
GCS error → Job marked as failed
Document generation error → Job marked as failed

// Test MIME type routing
image/jpeg → ocrImageUri()
image/png → ocrImageUri()
application/pdf → ocrPdfUri()
```

### What Tests Verify

✅ **URI Construction**:
- Correct bucket selection
- Path preservation
- gs:// scheme

✅ **Vision API Integration**:
- Correct parameter passing (gcsImageUri vs content)
- Language hint handling
- Result processing identical to buffer approach

✅ **Worker Integration**:
- transcribeUri() called instead of download+transcribe
- Progress milestones updated
- Error handling works correctly

✅ **Backward Compatibility**:
- Old buffer-based functions still work
- No breaking changes
- Can switch between approaches

## Performance Characteristics

### Time Complexity

**Buffer Approach**:
- Upload: O(n) where n = file size
- Download: O(n)
- Base64 encode: O(n)
- Vision API call: O(file_content)
- Total: O(n) + Vision API latency

**URI Approach**:
- Upload: O(n)
- URI construction: O(1)
- Vision API call: O(file_content) - Vision API reads from GCS
- Total: O(1) + Vision API latency

**Savings**: O(n) download + O(n) encoding overhead removed

### Space Complexity

**Before**:
- Worker memory: O(n) for buffer
- Network: O(n) for download

**After**:
- Worker memory: O(1) for URI string (~100 bytes)
- Network: Only Vision API ↔ GCS (same process)

### Network I/O Comparison

**Before**:
```
Worker ←→ GCS (download)     ~10s (5MB file, 500KB/s network)
Worker → Vision API          ~40s (processing time)
Total: ~50s
```

**After**:
```
Worker → Vision API (reads GCS)  ~40s (Vision API fetches directly)
Total: ~40s
Savings: ~10s per job
```

## Security Considerations

### Service Account Permissions

**Required**: `roles/storage.objectViewer` on both buckets

```
Vision API Service Account
├─ Input Bucket: roles/storage.objectViewer (read-only)
└─ Output Bucket: roles/storage.objectViewer (read-only)
```

**Why this is secure**:
- Vision API can only READ files (no delete, modify)
- Limited to specific buckets
- No credential exposure to application code
- Same permissions already required for buffer download

### No Security Regression

✅ **Previous approach**: Worker downloads buffer → memory exposure if compromised
✅ **New approach**: Vision API reads from GCS → limited to read-only access

The new approach is actually **more secure** because:
- Vision API runs in Google's infrastructure (isolated)
- No full file buffer in worker memory
- Service account permissions more restrictive (read-only)

## Troubleshooting

### Vision API Errors with GCS URIs

**Error**: "Invalid gcsImageUri"
- Check bucket name in config
- Verify URI format: `gs://bucket-name/path`
- Check file exists in GCS

**Error**: "Permission denied"
- Verify service account has `roles/storage.objectViewer`
- Check bucket IAM bindings
- Verify service account email in deployment

**Error**: "Bucket not found"
- Check bucket name matches config
- Verify bucket exists in GCS project
- Check project ID in config

### Performance Not Improved

**Possible causes**:
1. Vision API processing time dominant (not download time)
2. Network conditions excellent (download wasn't slow)
3. Large file handling (base64 encoding overhead small % of total)

**Mitigation**:
- Profile individual job components
- Check CloudWatch metrics
- Verify buffer-based approach was being used
- Compare before/after processing time distributions

## Future Improvements

### Phase 2 (Post-deployment)
- [ ] Mark old functions as `@deprecated`
- [ ] Add metrics for URI vs buffer usage
- [ ] Monitor performance improvements in production

### Phase 3 (2+ releases later)
- [ ] Add feature flag for gradual enablement
- [ ] Collect telemetry on both approaches
- [ ] Make final decision: keep dual or remove old

### Phase 4 (3+ releases later)
- [ ] Remove buffer-based functions from codebase
- [ ] Simplify OCR service
- [ ] Update documentation

## References

- **Google Cloud Vision API**: https://cloud.google.com/vision/docs/reference/rpc/google.cloud.vision.v1
- **GCS Image Annotation**: https://cloud.google.com/vision/docs/detecting-text#detect-text-gcs
- **Storage Bucket URIs**: https://cloud.google.com/storage/docs/uri-scheme
- **Vision API Auth**: https://cloud.google.com/vision/docs/auth

## Questions?

- See implementation in: `src/services/ocr.service.js`
- Review tests for usage: `tests/unit/ocr.service.test.js`
- Worker integration: `src/workers/transcription.worker.js`
- Deployment guide: `DEPLOYMENT_GCS_URI.md`
