#!/bin/bash
# ============================================================
# deploy-cloud-run.sh
# Builds and deploys Sinhala OCR API to GCP Cloud Run.
# Supports both Container Registry (gcr.io) and
# Artifact Registry (REGION-docker.pkg.dev).
# ============================================================

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────
GCP_PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID env var}"
REGION="${REGION:-asia-south1}"
SERVICE_NAME="${SERVICE_NAME:-sinhala-ocr-api}"
WORKER_SERVICE="${WORKER_SERVICE:-sinhala-ocr-worker}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"

# Detect registry: use Artifact Registry if AR_REPO is set, else GCR
if [[ -n "${AR_REPO:-}" ]]; then
  IMAGE_BASE="${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}"
  REGISTRY="${REGION}-docker.pkg.dev"
else
  IMAGE_BASE="gcr.io/${GCP_PROJECT_ID}/${SERVICE_NAME}"
  REGISTRY="gcr.io"
fi

IMAGE="${IMAGE_BASE}:${TAG}"
IMAGE_LATEST="${IMAGE_BASE}:latest"

echo "=== Sinhala OCR API — Cloud Run Deployment ==="
echo "Project  : ${GCP_PROJECT_ID}"
echo "Region   : ${REGION}"
echo "Registry : ${REGISTRY}"
echo "Image    : ${IMAGE}"
echo "Service  : ${SERVICE_NAME}"
echo ""

# ─── Step 1: Configure Docker auth ───────────────────────────
echo ">>> Configuring Docker authentication..."
gcloud auth configure-docker "${REGISTRY}" --quiet

# ─── Step 2: Build & push Docker image ───────────────────────
echo ">>> Building Docker image (linux/amd64)..."
docker build --platform linux/amd64 -t "${IMAGE}" -t "${IMAGE_LATEST}" .

echo ">>> Pushing image to ${REGISTRY}..."
docker push "${IMAGE}"
docker push "${IMAGE_LATEST}"

# ─── Step 3: Deploy API service ──────────────────────────────
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
  --set-env-vars="NODE_ENV=production,GCP_PROJECT_ID=${GCP_PROJECT_ID},GCS_BUCKET_NAME=${GCS_BUCKET_NAME:?Set GCS_BUCKET_NAME},GCS_OUTPUT_BUCKET_NAME=${GCS_OUTPUT_BUCKET_NAME:?Set GCS_OUTPUT_BUCKET_NAME}" \
  --set-secrets="JWT_SECRET=jwt-secret:latest,DB_PASSWORD=db-password:latest,REDIS_URL=redis-url:latest" \
  --service-account="${SERVICE_ACCOUNT:-${SERVICE_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com}"

# ─── Step 4: Deploy Worker service ───────────────────────────
echo ">>> Deploying Worker service to Cloud Run..."
gcloud run deploy "${WORKER_SERVICE}" \
  --image="${IMAGE}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --no-allow-unauthenticated \
  --command="node,src/workers/transcription.worker.js" \
  --port=3000 \
  --min-instances=1 \
  --max-instances=5 \
  --concurrency=1 \
  --memory=1Gi \
  --cpu=2 \
  --timeout=300s \
  --set-env-vars="NODE_ENV=production,GCP_PROJECT_ID=${GCP_PROJECT_ID},QUEUE_CONCURRENCY=3" \
  --set-secrets="JWT_SECRET=jwt-secret:latest,DB_PASSWORD=db-password:latest,REDIS_URL=redis-url:latest" \
  --service-account="${SERVICE_ACCOUNT:-${SERVICE_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com}"

# ─── Step 5: Print live URL ───────────────────────────────────
echo ""
echo "=== Deployment complete! ==="
API_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")
echo "API URL: ${API_URL}"
echo "Health:  ${API_URL}/api/v1/health"
