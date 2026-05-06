# Sinhala OCR API

Production-ready REST API that transcribes Sinhala handwritten documents (photos, scans) into Unicode text, DOCX, and PDF using Google Cloud Vision.

---

## Architecture

```
Client (Web UI / B2B API key)
        │
        ▼
Express.js Gateway  ←── JWT / API Key auth, rate limiting, Joi validation
        │
        ├── POST /transcribe  ──► GCS Upload ──► Bull Queue (Redis)
        │                                              │
        │                                              ▼
        │                                    Transcription Worker
        │                                    (OCR → Normalise → DOCX/PDF → GCS)
        │
        └── GET  /jobs/:id    ──► DB lookup + signed GCS download URLs

PostgreSQL  — users, api_keys, jobs
Redis       — Bull queue + rate limit store
GCS         — input files + output files (72hr TTL, hourly purge)
```

---

## Quick Start

### 1. Prerequisites
- Node.js ≥ 18
- Docker + Docker Compose
- GCP project with Cloud Vision API and Cloud Storage enabled
- GCP service account JSON with roles: `storage.objectAdmin`, `vision.user`

### 2. Local development

```bash
# Clone and install
git clone <repo>
cd sinhala-ocr-api
npm install

# Configure environment
cp .env.example .env
# → Fill in GCP_PROJECT_ID, JWT_SECRET, DB_PASSWORD etc.

# Place your GCP service account key
cp /path/to/key.json ./gcp-service-account.json

# Start all services (Postgres + Redis + API + Worker)
docker-compose up -d

# Run DB migrations
npm run migrate

# Start in dev mode (with nodemon hot reload)
npm run dev

# Start worker separately
npm run worker
```

### 3. Run tests

```bash
npm test                  # all tests
npm run test:unit         # unit tests only
npm run test:coverage     # with coverage report
```

---

## API Reference

### Authentication

All protected endpoints accept either:
- `Authorization: Bearer <jwt>` — issued on login
- `X-API-Key: sk_<key>` — created via /auth/api-keys

---

### Endpoints

#### `POST /api/v1/auth/register`
```json
{ "name": "Kamal Perera", "email": "kamal@example.com", "password": "Secure123" }
```
Returns `{ user, token }`

#### `POST /api/v1/auth/login`
```json
{ "email": "kamal@example.com", "password": "Secure123" }
```
Returns `{ user, token, expiresIn }`

#### `POST /api/v1/auth/api-keys`
```json
{ "name": "My integration" }
```
Returns `{ id, key, prefix }` — key shown once only.

#### `POST /api/v1/transcribe`  *(multipart/form-data)*
| Field | Type | Required | Default |
|---|---|---|---|
| `document` | File | ✅ | — |
| `output_format` | `json\|docx\|pdf\|all` | — | `all` |
| `language_hint` | `si\|si-LK` | — | `si` |
| `preserve_layout` | boolean | — | `false` |

Returns `202 Accepted`:
```json
{
  "job_id": "uuid",
  "status": "pending",
  "poll_url": "/api/v1/jobs/uuid",
  "expires_at": "2024-..."
}
```

#### `GET /api/v1/jobs/:id`
Returns job status. When `status === "completed"`:
```json
{
  "job": {
    "id": "uuid",
    "status": "completed",
    "extracted_text": "සිංහල යුනිකෝඩ් පෙළ...",
    "page_count": 2,
    "downloads": {
      "docx": "https://signed-gcs-url.../transcription.docx",
      "pdf":  "https://signed-gcs-url.../transcription.pdf"
    },
    "download_url_expiry_seconds": 259200
  }
}
```

#### `GET /api/v1/health` — Readiness probe (DB + Redis + Queue)
#### `GET /api/v1/health/live` — Liveness probe (always 200)

---

## Deployment (GCP Cloud Run)

```bash
# Set required env vars
export GCP_PROJECT_ID=your-project
export GCS_BUCKET_NAME=sinhala-ocr-uploads
export GCS_OUTPUT_BUCKET_NAME=sinhala-ocr-outputs

# Store secrets in Secret Manager
echo -n "your-jwt-secret" | gcloud secrets create jwt-secret --data-file=-
echo -n "your-db-password" | gcloud secrets create db-password --data-file=-
echo -n "redis://..." | gcloud secrets create redis-url --data-file=-

# Deploy
bash scripts/deploy-cloud-run.sh
```

CI/CD via GitHub Actions automatically deploys on push to `main`.

---

## Sinhala OCR Notes

Google Cloud Vision has **basic handwriting support for Sinhala** (`si` / `si-LK` language hint). The API includes a post-processing normalisation pipeline that:

1. Removes OCR noise (control chars, zero-width spaces, BOM)
2. Applies a glyph correction map (known Vision API misidentifications)
3. Normalises to Unicode NFC form (correct for Sinhala rendering)
4. Cleans whitespace artefacts

**Confidence scoring** is returned per job:
- `high` — >60% Sinhala characters detected
- `medium` — 20–60% Sinhala characters
- `low` — <20% Sinhala characters (may indicate wrong language or poor scan quality)

---

## Project Structure

```
src/
├── config/          # DB, Redis, app config
├── middleware/       # Auth, rate limiter, upload, error handler
├── models/          # User, ApiKey, Job (DB queries)
├── routes/          # Express routers
├── controllers/     # Request handlers
├── services/        # OCR, Storage, Queue, Sinhala normaliser, Document gen
├── workers/         # Bull transcription worker
├── cron/            # 72hr TTL purge job
└── utils/           # Logger, validators, API response helpers

tests/
├── unit/            # 7 suites, 123 tests (no live infra needed)
└── integration/     # 1 suite, 13 tests (mocked infra)

migrations/          # SQL migration files + runner script
scripts/             # Cloud Run deploy script
```

---

## Phase 2 Roadmap

| Feature | Notes |
|---|---|
| Embedded Sinhala font in PDF | fontkit + Noto Sans Sinhala for correct glyph rendering |
| Async Vision batch API for PDFs | GCS-to-GCS batch for multi-page PDFs (>5MB) |
| Subscription billing | Stripe integration, usage metering per user |
| Webhook callbacks | POST result to caller URL instead of polling |
| Admin dashboard | Bull Board UI, job analytics, user management |
| Custom OCR fine-tuning | Document AI custom processor trained on Sinhala corpus |
| SDK packages | npm/PyPI client SDKs for B2B integrators |
