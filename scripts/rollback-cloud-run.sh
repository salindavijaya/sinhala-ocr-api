#!/bin/bash
# ============================================================
# rollback-cloud-run.sh
# Emergency rollback script for Cloud Run deployments
# Usage: ./scripts/rollback-cloud-run.sh [SERVICE_NAME] [PREVIOUS_IMAGE_TAG]
# ============================================================

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────
GCP_PROJECT_ID="${GCP_PROJECT_ID:?GCP_PROJECT_ID env var required}"
REGION="${REGION:-asia-south1}"
SERVICE_NAME="${1:-sicript-service}"
PREVIOUS_TAG="${2:-previous}"

# Detect registry
if [[ -n "${AR_REPO:-}" ]]; then
  IMAGE_BASE="${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}"
  REGISTRY="${REGION}-docker.pkg.dev"
else
  IMAGE_BASE="gcr.io/${GCP_PROJECT_ID}/${SERVICE_NAME}"
  REGISTRY="gcr.io"
fi

ROLLBACK_IMAGE="${IMAGE_BASE}:${PREVIOUS_TAG}"

# ─── Helper functions ───────────────────────────────────────
log_info() {
  echo "ℹ️  $*"
}

log_warn() {
  echo "⚠️  $*"
}

log_success() {
  echo "✓ $*"
}

log_error() {
  echo "❌ $*"
}

# ─── Validation ─────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  Cloud Run Emergency Rollback                         ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "⚠️  WARNING: This will rollback the service!"
echo ""
echo "📋 Rollback Configuration:"
echo "   Service:  ${SERVICE_NAME}"
echo "   Region:   ${REGION}"
echo "   Image:    ${ROLLBACK_IMAGE}"
echo ""

# Confirm rollback
read -p "Are you sure you want to proceed? (yes/no): " CONFIRMATION
if [[ "$CONFIRMATION" != "yes" ]]; then
  log_warn "Rollback cancelled"
  exit 0
fi

echo ""

# ─── Step 1: Verify image exists ────────────────────────────
log_info "Verifying rollback image exists..."

# Try to get image manifest
if docker pull "${ROLLBACK_IMAGE}" &>/dev/null; then
  log_success "Image verified: ${ROLLBACK_IMAGE}"
else
  log_error "Cannot access image: ${ROLLBACK_IMAGE}"
  echo "   Make sure the tag/image exists in ${REGISTRY}"
  exit 1
fi

# ─── Step 2: Get current image for reference ────────────────
log_info "Saving current deployment info..."
CURRENT_IMAGE=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(spec.template.spec.containers[0].image)" 2>/dev/null || echo "unknown")

echo "   Current image: ${CURRENT_IMAGE}"

# ─── Step 3: Perform rollback ────────────────────────────────
log_info "Starting rollback..."
echo ""

if gcloud run deploy "${SERVICE_NAME}" \
  --image="${ROLLBACK_IMAGE}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --quiet; then
  log_success "Rollback deployment completed"
else
  log_error "Rollback deployment failed"
  exit 1
fi

# ─── Step 4: Verify new image ───────────────────────────────
log_info "Verifying rollback..."

DEPLOYED_IMAGE=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(spec.template.spec.containers[0].image)")

if [[ "$DEPLOYED_IMAGE" == "$ROLLBACK_IMAGE"* ]]; then
  log_success "Deployment using rollback image confirmed"
else
  log_warn "Image mismatch - verification may need manual check"
fi

# ─── Step 5: Health check ────────────────────────────────────
log_info "Running health check..."

API_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")

MAX_RETRIES=10
RETRY_COUNT=0

while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_URL}/api/v1/health/live" 2>/dev/null || echo "000")
  
  if [[ "$HTTP_CODE" == "200" ]]; then
    log_success "Health check passed"
    break
  fi
  
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
    log_info "Health check retry $RETRY_COUNT/$MAX_RETRIES (HTTP $HTTP_CODE)..."
    sleep 3
  fi
done

if [[ $RETRY_COUNT -eq $MAX_RETRIES ]]; then
  log_warn "Health check did not pass. Service may need additional time to start."
fi

# ─── Success ────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  ✅ Rollback Completed!                               ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📋 Rollback Summary:"
echo "   Service:      ${SERVICE_NAME}"
echo "   Previous:     ${CURRENT_IMAGE}"
echo "   Rollback to:  ${ROLLBACK_IMAGE}"
echo "   URL:          ${API_URL}"
echo ""
echo "🔍 Monitoring:"
echo "   Logs:   gcloud run logs read ${SERVICE_NAME} --region=${REGION} --limit=50"
echo "   Health: curl ${API_URL}/api/v1/health"
echo ""
