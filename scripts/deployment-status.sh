#!/bin/bash
# ============================================================
# deployment-status.sh
# Check Cloud Run deployment status and health
# Usage: ./scripts/deployment-status.sh
# ============================================================

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────
GCP_PROJECT_ID="${GCP_PROJECT_ID:?GCP_PROJECT_ID env var required}"
REGION="${REGION:-asia-south1}"
SERVICE_NAME="${SERVICE_NAME:-sicript-service}"
WORKER_SERVICE="${WORKER_SERVICE:-sinhala-ocr-worker}"

# ─── Helper functions ───────────────────────────────────────
log_section() {
  echo ""
  echo "┌────────────────────────────────────────────────────────┐"
  echo "│  $1"
  echo "└────────────────────────────────────────────────────────┘"
}

check_service() {
  local service=$1
  local service_type=${2:-API}
  
  log_section "Service: $service ($service_type)"
  
  if ! gcloud run services describe "$service" \
    --project="${GCP_PROJECT_ID}" \
    --region="${REGION}" \
    --format="table(
      metadata.name,
      status.url,
      status.conditions[0].status,
      metadata.generation,
      status.observedGeneration
    )" 2>/dev/null; then
    echo "❌ Service '$service' not found"
    return 1
  fi
  
  # Get more details
  TRAFFIC=$(gcloud run services describe "$service" \
    --project="${GCP_PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(status.traffic[].percent)" 2>/dev/null || echo "N/A")
  
  echo ""
  echo "Traffic distribution: $TRAFFIC%"
  
  # Get revisions
  echo ""
  echo "Recent revisions:"
  gcloud run revisions list \
    --service="$service" \
    --project="${GCP_PROJECT_ID}" \
    --region="${REGION}" \
    --format="table(
      ACTIVE,
      metadata.name:label=REVISION,
      status.createTime,
      status.conditions[type=Active].status:label=STATUS,
      status.conditions[type=Ready].status:label=READY
    )" \
    --limit=5 2>/dev/null || echo "Could not retrieve revisions"
}

health_check() {
  local service=$1
  
  log_section "Health Check: $service"
  
  local api_url=$(gcloud run services describe "$service" \
    --project="${GCP_PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(status.url)" 2>/dev/null || echo "")
  
  if [[ -z "$api_url" ]]; then
    echo "❌ Could not get service URL"
    return 1
  fi
  
  echo "Service URL: $api_url"
  echo ""
  echo "Testing endpoints:"
  echo ""
  
  # Test live health endpoint
  echo "  /api/v1/health/live:"
  HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/health_response.txt \
    "${api_url}/api/v1/health/live" 2>/dev/null || echo "000")
  
  if [[ "$HTTP_CODE" == "200" ]]; then
    echo "    ✓ HTTP $HTTP_CODE - Service is alive"
    cat /tmp/health_response.txt | head -5
  else
    echo "    ❌ HTTP $HTTP_CODE - Service health check failed"
  fi
  
  echo ""
  echo ""
  
  # Test ready endpoint
  echo "  /api/v1/health/ready:"
  HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/ready_response.txt \
    "${api_url}/api/v1/health/ready" 2>/dev/null || echo "000")
  
  if [[ "$HTTP_CODE" == "200" ]]; then
    echo "    ✓ HTTP $HTTP_CODE - Service is ready"
    cat /tmp/ready_response.txt | head -5
  else
    echo "    ❌ HTTP $HTTP_CODE - Service readiness check failed"
  fi
}

logs_summary() {
  local service=$1
  
  log_section "Recent Logs: $service (last 20 lines)"
  
  echo ""
  gcloud run logs read "$service" \
    --project="${GCP_PROJECT_ID}" \
    --region="${REGION}" \
    --limit=20 \
    --format="table(
      severity,
      timestamp.date(tz=LOCAL),
      jsonPayload.message:wrap
    )" 2>/dev/null || echo "Could not retrieve logs"
}

resource_usage() {
  local service=$1
  
  log_section "Configuration: $service"
  
  gcloud run services describe "$service" \
    --project="${GCP_PROJECT_ID}" \
    --region="${REGION}" \
    --format="text(
      spec.template.spec.containerConcurrency,
      spec.template.spec.timeoutSeconds,
      spec.template.spec.serviceAccountName,
      spec.template.spec.containers[0].resources.limits.memory,
      spec.template.spec.containers[0].resources.limits.cpu
    )" 2>/dev/null | sed 's/^/  /' || echo "Could not retrieve configuration"
}

# ─── Main execution ─────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  Cloud Run Deployment Status                          ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "Project: ${GCP_PROJECT_ID}"
echo "Region:  ${REGION}"

# Check API service
check_service "$SERVICE_NAME" "API"
health_check "$SERVICE_NAME"
resource_usage "$SERVICE_NAME"
logs_summary "$SERVICE_NAME"

# Check Worker service
check_service "$WORKER_SERVICE" "WORKER"
resource_usage "$WORKER_SERVICE"
logs_summary "$WORKER_SERVICE"

# Summary
log_section "Summary"
echo ""
echo "✓ Deployment status check complete"
echo ""
echo "Useful commands:"
echo "  • Stream logs:      gcloud run logs read ${SERVICE_NAME} --region=${REGION} --follow"
echo "  • Worker logs:      gcloud run logs read ${WORKER_SERVICE} --region=${REGION} --follow"
echo "  • Describe service: gcloud run services describe ${SERVICE_NAME} --region=${REGION}"
echo "  • Manual rollback:  ./scripts/rollback-cloud-run.sh ${SERVICE_NAME} <TAG>"
echo ""
