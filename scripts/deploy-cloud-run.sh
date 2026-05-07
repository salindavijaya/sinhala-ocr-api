#!/bin/bash
# ============================================================
# deploy-cloud-run.sh
# Builds and deploys Sinhala OCR API to GCP Cloud Run with
# comprehensive error handling, validation, and rollback support.
# ============================================================

set -euo pipefail

# ── Error handling ──────────────────────────────────────────
trap 'on_error $? $LINENO' ERR

on_error() {
  local exit_code=$1
  local line_number=$2
  echo ""
  echo "❌ ERROR: Deployment failed at line $line_number with exit code $exit_code"
  echo ""
  echo "⏮️  Attempting rollback to previous stable version..."
  rollback_deployment || echo "⚠️  Could not complete rollback. Manual intervention may be required."
  exit "$exit_code"
}

# ── Configuration ───────────────────────────────────────────
GCP_PROJECT_ID="${GCP_PROJECT_ID:?GCP_PROJECT_ID env var required}"
GCS_BUCKET_NAME="${GCS_BUCKET_NAME:?GCS_BUCKET_NAME env var required}"
GCS_OUTPUT_BUCKET_NAME="${GCS_OUTPUT_BUCKET_NAME:?GCS_OUTPUT_BUCKET_NAME env var required}"

REGION="${REGION:-asia-south1}"
SERVICE_NAME="${SERVICE_NAME:-sicript-service}"
WORKER_SERVICE="${WORKER_SERVICE:-sinhala-ocr-worker}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"

# Service account (derive from service name if not provided)
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-${SERVICE_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com}"

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
PREVIOUS_IMAGE=""

# ── Helper functions ────────────────────────────────────────
log_info() {
  echo "ℹ️  $*"
}

log_step() {
  echo ""
  echo "📍 $*"
}

log_success() {
  echo "✓ $*"
}

log_error() {
  echo "❌ $*"
}

# Get current running image for potential rollback
get_current_image() {
  local service=$1
  gcloud run services describe "$service" \
    --project="${GCP_PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(spec.template.spec.containers[0].image)" 2>/dev/null || echo ""
}

# Rollback deployment to previous image
rollback_deployment() {
  if [[ -z "$PREVIOUS_IMAGE" ]]; then
    log_info "No previous image saved for rollback"
    return 1
  fi
  
  log_info "Rolling back $SERVICE_NAME to $PREVIOUS_IMAGE..."
  gcloud run deploy "${SERVICE_NAME}" \
    --image="${PREVIOUS_IMAGE}" \
    --project="${GCP_PROJECT_ID}" \
    --region="${REGION}" \
    --no-traffic-split \
    --quiet || return 1
  
  log_success "Rollback completed"
}

# ── Start deployment ────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  Sinhala OCR API — Cloud Run Deployment              ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📦 Deployment Configuration:"
echo "   Project:  ${GCP_PROJECT_ID}"
echo "   Region:   ${REGION}"
echo "   Registry: ${REGISTRY}"
echo "   API:      ${SERVICE_NAME}"
echo "   Worker:   ${WORKER_SERVICE}"
echo "   Image:    ${IMAGE}"
echo ""

# ─── Step 0: Pre-deployment validation ──────────────────────
log_step "Validating prerequisites..."

# Check gcloud is available
if ! command -v gcloud &> /dev/null; then
  log_error "gcloud CLI not found"
  exit 1
fi

# Verify we can access the project
if ! gcloud projects describe "${GCP_PROJECT_ID}" --quiet &>/dev/null; then
  log_error "Cannot access GCP project: ${GCP_PROJECT_ID}"
  exit 1
fi
log_success "GCP project access verified"

# Verify Cloud Run API is enabled
if ! gcloud services list --enabled --project="${GCP_PROJECT_ID}" --filter="name:run.googleapis.com" --quiet &>/dev/null | grep -q run.googleapis.com; then
  log_info "Enabling Cloud Run API..."
  gcloud services enable run.googleapis.com --project="${GCP_PROJECT_ID}" --quiet
fi
log_success "Cloud Run API enabled"

# Verify storage buckets exist
if ! gsutil ls "gs://${GCS_BUCKET_NAME}" &>/dev/null; then
  log_error "GCS bucket not found: ${GCS_BUCKET_NAME}"
  exit 1
fi
log_success "Input bucket verified: ${GCS_BUCKET_NAME}"

if ! gsutil ls "gs://${GCS_OUTPUT_BUCKET_NAME}" &>/dev/null; then
  log_error "GCS bucket not found: ${GCS_OUTPUT_BUCKET_NAME}"
  exit 1
fi
log_success "Output bucket verified: ${GCS_OUTPUT_BUCKET_NAME}"

# Check required Secret Manager secrets exist
for SECRET in jwt-secret db-password redis-url; do
  if ! gcloud secrets describe "$SECRET" --project="${GCP_PROJECT_ID}" &>/dev/null; then
    log_error "Secret Manager secret not found: $SECRET"
    echo "   Create it with: gcloud secrets create $SECRET --data-file=secret.txt"
    exit 1
  fi
done
log_success "All Secret Manager secrets verified"

# ─── Step 1: Save current image for rollback ────────────────
log_step "Preparing rollback information..."
PREVIOUS_IMAGE=$(get_current_image "$SERVICE_NAME")
if [[ -n "$PREVIOUS_IMAGE" ]]; then
  log_success "Current image saved: ${PREVIOUS_IMAGE}"
else
  log_info "No previous image found (first deployment)"
fi

# ─── Step 2: Configure Docker auth ─────────────────────────
log_step "Configuring Docker authentication..."
gcloud auth configure-docker "${REGISTRY}" --quiet --project="${GCP_PROJECT_ID}"
log_success "Docker authentication configured"

# ─── Step 3: Build & push Docker image ──────────────────────
log_step "Building Docker image..."
if docker build --platform linux/amd64 -t "${IMAGE}" -t "${IMAGE_LATEST}" .; then
  log_success "Docker image built successfully"
else
  log_error "Docker build failed"
  exit 1
fi

log_step "Pushing image to registry..."
if docker push "${IMAGE}" && docker push "${IMAGE_LATEST}"; then
  log_success "Image pushed to ${REGISTRY}"
else
  log_error "Docker push failed"
  exit 1
fi

# ─── Step 4: Deploy API service ─────────────────────────────
log_step "Deploying API service to Cloud Run..."

if gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --port="${PORT}" \
  --min-instances=0 \
  --max-instances=10 \
  --concurrency=80 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=3600s \
  --cpu-boost \
  --session-affinity \
  --set-env-vars="NODE_ENV=production,GCP_PROJECT_ID=${GCP_PROJECT_ID},GCS_BUCKET_NAME=${GCS_BUCKET_NAME},GCS_OUTPUT_BUCKET_NAME=${GCS_OUTPUT_BUCKET_NAME}" \
  --set-secrets="JWT_SECRET=jwt-secret:latest,DB_PASSWORD=db-password:latest,REDIS_URL=redis-url:latest" \
  --service-account="${SERVICE_ACCOUNT}" \
  --quiet 2>&1 | tee /tmp/deploy-api.log; then
  log_success "API service deployed successfully"
else
  log_error "API service deployment failed"
  exit 1
fi

# ─── Step 5: Deploy Worker service ──────────────────────────
log_step "Deploying Worker service to Cloud Run..."

# Extract Worker command to array format (gcloud requires this)
if gcloud run deploy "${WORKER_SERVICE}" \
  --image="${IMAGE}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --no-allow-unauthenticated \
  --args="src/workers/transcription.worker.js" \
  --port="${PORT}" \
  --min-instances=1 \
  --max-instances=5 \
  --concurrency=1 \
  --memory=1Gi \
  --cpu=2 \
  --timeout=3600s \
  --cpu-boost \
  --set-env-vars="NODE_ENV=production,GCP_PROJECT_ID=${GCP_PROJECT_ID},QUEUE_CONCURRENCY=3,LOG_LEVEL=info" \
  --set-secrets="JWT_SECRET=jwt-secret:latest,DB_PASSWORD=db-password:latest,REDIS_URL=redis-url:latest" \
  --service-account="${SERVICE_ACCOUNT}" \
  --quiet 2>&1 | tee /tmp/deploy-worker.log; then
  log_success "Worker service deployed successfully"
else
  log_error "Worker service deployment failed"
  exit 1
fi

# ─── Step 6: Health verification ───────────────────────────
log_step "Verifying deployment health..."

API_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")

if [[ -z "$API_URL" ]]; then
  log_error "Could not retrieve API URL after deployment"
  exit 1
fi

# Wait for Cloud Run to be ready and check health
MAX_RETRIES=15
RETRY_COUNT=0
HEALTH_CHECK_PASSED=0

while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_URL}/api/v1/health/live" 2>/dev/null || echo "000")
  
  if [[ "$HTTP_CODE" == "200" ]]; then
    log_success "Health check passed (HTTP $HTTP_CODE)"
    HEALTH_CHECK_PASSED=1
    break
  fi
  
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
    log_info "Health check retry $RETRY_COUNT/$MAX_RETRIES (HTTP $HTTP_CODE)..."
    sleep 5
  fi
done

if [[ $HEALTH_CHECK_PASSED -eq 0 ]]; then
  log_error "API health check failed after $MAX_RETRIES attempts"
  exit 1
fi

# ─── Success ────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  ✅ Deployment Successful!                            ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📋 Deployment Summary:"
echo "   Service:  ${SERVICE_NAME}"
echo "   Worker:   ${WORKER_SERVICE}"
echo "   Region:   ${REGION}"
echo "   Image:    ${TAG}"
echo "   URL:      ${API_URL}"
echo "   Health:   ${API_URL}/api/v1/health"
echo ""
echo "🚀 Next steps:"
echo "   • Monitor logs: gcloud run logs read ${SERVICE_NAME} --region=${REGION}"
echo "   • Test API:    curl ${API_URL}/api/v1/health"
echo "   • Rollback:    gcloud run deploy ${SERVICE_NAME} --image=<PREVIOUS_IMAGE>"
echo ""
