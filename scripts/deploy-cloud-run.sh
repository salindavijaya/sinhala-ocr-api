#!/bin/bash
# ============================================================
# deploy-cloud-run.sh
# Builds and deploys the Sinhala OCR API to GCP Cloud Run.
#
# Prerequisites:
#   - gcloud CLI authenticated (gcloud auth login)
#   - GCP_PROJECT_ID, REGION, SERVICE_NAME set below or as env vars
# ============================================================

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────
GCP_PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${REGION:-asia-south1}"           # Mumbai — closest to Sri Lanka
SERVICE_NAME="${SERVICE_NAME:-sinhala-ocr-api}"
WORKER_SERVICE="${WORKER_SERVICE:-sinhala-ocr-worker}"
IMAGE_NAME="gcr.io/${GCP_PROJECT_ID}/${SERVICE_NAME}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"
IMAGE="${IMAGE_NAME}:${TAG}"

echo "=== Sinhala OCR API — Cloud Run Deployment ==="
echo "Project:  ${GCP_PROJECT_ID}"
echo "Region:   ${REGION}"
echo "Image:    ${IMAGE}"
echo "Service:  ${SERVICE_NAME}"
echo ""

# ─── Step 1: Build & push Docker image ───────────────────────
echo ">>> Building Docker image..."
docker build --platform linux/amd64 -t "${IMAGE}" .
echo ">>> Pushing to Google Container Registry..."
docker push "${IMAGE}"

# ─── Step 2: Deploy API service ──────────────────────────────
echo ">>> Deploying API service to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=3000 \
  --min-instances=0 \
  --max-instances=10 \
  --concurrency=80 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=60s \
  --set-env-vars="NODE_ENV=production" \
  --set-env-vars="GCP_PROJECT_ID=${GCP_PROJECT_ID}" \
  --set-env-vars="GCS_BUCKET_NAME=${GCS_BUCKET_NAME:?Set GCS_BUCKET_NAME}" \
  --set-env-vars="GCS_OUTPUT_BUCKET_NAME=${GCS_OUTPUT_BUCKET_NAME:?Set GCS_OUTPUT_BUCKET_NAME}" \
  --set-secrets="JWT_SECRET=jwt-secret:latest" \
  --set-secrets="DB_PASSWORD=db-password:latest" \
  --set-secrets="REDIS_URL=redis-url:latest" \
  --service-account="${SERVICE_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

# ─── Step 3: Deploy Worker service ───────────────────────────
echo ">>> Deploying Worker service to Cloud Run..."
gcloud run deploy "${WORKER_SERVICE}" \
  --image="${IMAGE}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --no-allow-unauthenticated \
  --command="node" \
  --args="src/workers/transcription.worker.js" \
  --port=3000 \
  --min-instances=1 \
  --max-instances=5 \
  --concurrency=1 \
  --memory=1Gi \
  --cpu=2 \
  --timeout=300s \
  --set-env-vars="NODE_ENV=production" \
  --set-env-vars="GCP_PROJECT_ID=${GCP_PROJECT_ID}" \
  --set-env-vars="QUEUE_CONCURRENCY=3" \
  --set-secrets="JWT_SECRET=jwt-secret:latest" \
  --set-secrets="DB_PASSWORD=db-password:latest" \
  --set-secrets="REDIS_URL=redis-url:latest" \
  --service-account="${SERVICE_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

# ─── Step 4: Run DB migrations ───────────────────────────────
echo ">>> Running database migrations..."
gcloud run jobs execute migrate-job \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --wait || echo "Note: migration job not configured yet — run manually"

echo ""
echo "=== Deployment complete! ==="
API_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")
echo "API URL: ${API_URL}"
echo "Health:  ${API_URL}/api/v1/health"
