# Production Deployment Audit & Fixes

## Overview

This document outlines the production deployment issues found in the GitHub Actions workflow and the fixes applied to resolve them.

## Issues Found & Fixed

### ✅ Critical Issues Resolved

#### 1. **No Secret Validation**
- **Problem**: Workflow would fail mid-deployment if GCP secrets were missing
- **Fix**: Added `validate-secrets` job that checks all required GitHub secrets exist before deployment
- **Impact**: Early failure detection prevents wasted resources and deployment time

#### 2. **No Health Check After Deployment**
- **Problem**: Service deployed but never verified as healthy or ready
- **Fix**: Added `verify-deployment` job that polls `/api/v1/health/live` endpoint with retry logic
- **Impact**: Catches broken deployments immediately instead of discovering issues later

#### 3. **Missing Pre-deployment Validation**
- **Problem**: No verification of GCP resources, permissions, or infrastructure
- **Fix**: Added `pre-deploy-validation` job that checks:
  - GCP project access
  - Storage buckets exist
  - Secret Manager secrets configured
  - Cloud Run API enabled
- **Impact**: Early error detection with clear messages

#### 4. **No Rollback Strategy**
- **Problem**: Failed deployments couldn't automatically recover
- **Fixes**:
  - Updated deploy script with `on_error` trap that auto-rollbacks on failure
  - Created `rollback-cloud-run.sh` for manual emergency rollbacks
  - Saves previous image before deployment for quick rollback
- **Impact**: Faster incident recovery with automated safety nets

#### 5. **Inconsistent Docker Builds**
- **Problem**: CI build didn't use `--platform linux/amd64` like deploy script
- **Fix**: Updated CI build to use Docker Buildx with explicit `linux/amd64` platform
- **Impact**: Guarantees binary compatibility between CI verification and production

### ✅ High Priority Issues Resolved

#### 6. **No Service Account Verification**
- **Problem**: Script assumed service account existed without checking
- **Fix**: Deploy script now validates service account exists before use
- **Impact**: Clear error messages instead of cryptic gcloud failures

#### 7. **Missing GCP Infrastructure Setup Verification**
- **Problem**: Script didn't verify Secret Manager secrets were properly configured
- **Fix**: Pre-deployment validation checks all required secrets (jwt-secret, db-password, redis-url)
- **Impact**: Prevents deployment failures due to missing secrets

#### 8. **Worker Service Deployment Issues**
- **Problem**: Worker command syntax could fail silently
- **Fix**: Changed from `--command="node,src/workers/..."` to `--args="src/workers/..."`
- **Impact**: Correct worker service startup

#### 9. **Timeout Too Short**
- **Problem**: 60s timeout for transcription API insufficient for real workloads
- **Fixes**:
  - API timeout: 60s → 3600s (1 hour)
  - Worker timeout: 300s → 3600s (1 hour)
- **Impact**: Long-running transcription jobs won't be terminated prematurely

#### 10. **No Concurrent Deployment Safety**
- **Problem**: Multiple pushes could cause race conditions
- **Fix**: Added `concurrency` group to deploy job to serialize deployments
- **Impact**: Prevents simultaneous deployments from conflicting

### ✅ Medium Priority Issues Resolved

#### 11. **Incomplete Error Messages**
- **Problem**: Deploy failures didn't indicate root cause
- **Fix**: Enhanced error handling with:
  - Detailed error context logging
  - Pre-flight validation with clear error messages
  - Structured deployment logs
- **Impact**: Faster debugging and issue resolution

#### 12. **No Deployment Status Tracking**
- **Problem**: No way to quickly check deployment status
- **Fix**: Created `deployment-status.sh` script that provides:
  - Service status and URL
  - Recent revisions
  - Health check results
  - Recent logs
  - Resource configuration
- **Impact**: Quick visibility into deployment state

#### 13. **Missing Readiness Probes**
- **Problem**: Cloud Run startup time not accounted for
- **Fix**: Health check with exponential backoff (15 retries × 5s = 75s total wait)
- **Impact**: Accounts for cold starts and gradual readiness

#### 14. **Improved Error Handling**
- **Problem**: Deploy script had minimal error handling
- **Fixes**:
  - `set -euo pipefail` for strict error handling
  - `trap 'on_error'` for graceful error recovery
  - Logging at each step
- **Impact**: Better visibility and safer failure modes

---

## New Deployment Features

### 1. **Enhanced CI/CD Workflow** (`.github/workflows/ci.yml`)

```
validate-secrets → test ↓
                     build ↓
              pre-deploy-validation → deploy → verify-deployment
```

**New Jobs:**
- `validate-secrets`: Ensures all required GitHub secrets are configured
- `pre-deploy-validation`: Validates GCP infrastructure before deployment
- `verify-deployment`: Post-deployment health checks and service verification

### 2. **Improved Deploy Script** (`scripts/deploy-cloud-run.sh`)

**New Features:**
- Pre-deployment validation (project access, buckets, secrets, API enabled)
- Rollback capability (saves previous image)
- Health check verification (with retries)
- Better error handling and logging
- Detailed deployment summary
- Auto-rollback on error

### 3. **Emergency Rollback Script** (`scripts/rollback-cloud-run.sh`)

Quick manual rollback for emergencies:
```bash
./scripts/rollback-cloud-run.sh PREVIOUS_TAG
```

### 4. **Status Monitor Script** (`scripts/deployment-status.sh`)

Check deployment health and status:
```bash
./scripts/deployment-status.sh
```

Shows:
- Service status and URL
- Recent revisions
- Health check results
- Resource configuration
- Recent logs

---

## Setup Requirements

### GitHub Secrets Required

Before the first deployment, configure these secrets in GitHub:

1. **GCP_SA_KEY**: GCP Service Account JSON key
2. **GCP_PROJECT_ID**: GCP Project ID (e.g., `my-project-123456`)
3. **GCS_BUCKET_NAME**: Input documents bucket name
4. **GCS_OUTPUT_BUCKET_NAME**: Output documents bucket name

### GCP Secret Manager Secrets Required

Create these in GCP Secret Manager:

```bash
# JWT secret (generate a random 64+ character string)
echo "your-jwt-secret-64-chars-or-longer" | \
  gcloud secrets create jwt-secret --data-file=-

# Database password
echo "your-db-password" | \
  gcloud secrets create db-password --data-file=-

# Redis connection URL
echo "redis://redis-instance:6379" | \
  gcloud secrets create redis-url --data-file=-
```

### GCP Service Account Permissions

The service account needs these roles:
- `roles/run.admin` - Deploy to Cloud Run
- `roles/iam.serviceAccountUser` - Use service accounts
- `roles/storage.admin` - Access GCS buckets
- `roles/secretmanager.secretAccessor` - Read secrets

---

## Deployment Workflow

### Automatic (via GitHub Actions)

1. **Push to `main` branch**
   ```bash
   git push origin main
   ```

2. **GitHub Actions automatically:**
   - Validates secrets exist
   - Runs tests
   - Builds Docker image
   - Validates GCP resources
   - Deploys to Cloud Run
   - Verifies health
   - Posts results

3. **Monitor deployment:**
   - Check GitHub Actions tab in repository
   - View logs in each job

### Manual Deployment

If you need to deploy manually:

```bash
# Set environment variables
export GCP_PROJECT_ID="your-project-id"
export GCS_BUCKET_NAME="uploads-bucket"
export GCS_OUTPUT_BUCKET_NAME="outputs-bucket"
export REGION="asia-south1"

# Authenticate to GCP
gcloud auth login
gcloud config set project $GCP_PROJECT_ID

# Deploy
bash scripts/deploy-cloud-run.sh
```

### Emergency Rollback

If deployment has critical issues:

```bash
# Option 1: Quick rollback to previous version
bash scripts/rollback-cloud-run.sh sicript-service previous

# Option 2: Manual rollback with specific image tag
gcloud run deploy sicript-service \
  --image=gcr.io/PROJECT_ID/sicript-service:OLD_TAG \
  --region=asia-south1
```

### Check Deployment Status

```bash
# Quick status check
bash scripts/deployment-status.sh

# Stream logs in real-time
gcloud run logs read sicript-service --region=asia-south1 --follow

# Check specific revision
gcloud run revisions list --service=sicript-service --region=asia-south1
```

---

## Environment Variables

### API Service (`sicript-service`)

| Variable | Source | Purpose |
|----------|--------|---------|
| `NODE_ENV` | Hardcoded | `production` |
| `GCP_PROJECT_ID` | GitHub secret | GCP project for cloud services |
| `GCS_BUCKET_NAME` | GitHub secret | Input documents bucket |
| `GCS_OUTPUT_BUCKET_NAME` | GitHub secret | Output documents bucket |
| `QUEUE_CONCURRENCY` | Environment var | Queue processing parallelism |

**Secrets (from Secret Manager):**
- `JWT_SECRET` - Authentication token secret
- `DB_PASSWORD` - PostgreSQL password
- `REDIS_URL` - Redis connection string

### Worker Service (`sinhala-ocr-worker`)

Same as API service plus:
| Variable | Value | Purpose |
|----------|-------|---------|
| `QUEUE_CONCURRENCY` | `3` | Number of parallel jobs |
| `LOG_LEVEL` | `info` | Logging verbosity |

---

## Monitoring & Troubleshooting

### Common Issues

#### Deployment Fails: "Secret Manager secret not found"
```bash
# Check which secrets are missing
gcloud secrets list

# Create the missing secret
echo "secret-value" | gcloud secrets create secret-name --data-file=-
```

#### Deployment Fails: "Cloud Run API not enabled"
```bash
# Enable Cloud Run API
gcloud services enable run.googleapis.com
```

#### Health Check Times Out
- Check logs: `gcloud run logs read sicript-service --limit=50`
- Verify database connectivity
- Check Redis availability
- Ensure all required secrets are configured

#### Worker Service Not Processing Jobs
- Check worker logs: `gcloud run logs read sinhala-ocr-worker`
- Verify Redis queue connection
- Check worker resource limits (may need more CPU/memory)

### Useful Monitoring Commands

```bash
# Stream service logs
gcloud run logs read sicript-service --follow

# Get detailed service info
gcloud run services describe sicript-service

# List revisions
gcloud run revisions list --service=sicript-service

# Get traffic split details
gcloud run services describe sicript-service --format=json | jq '.status.traffic'

# Monitor in Cloud Console
echo "https://console.cloud.google.com/run/detail/$REGION/sicript-service"
```

---

## Best Practices

1. **Always test locally first**
   ```bash
   npm run test:coverage
   docker build -t test .
   ```

2. **Use meaningful commit messages**
   - Helps track what changed in each deployment

3. **Monitor after deployment**
   - Run `deployment-status.sh` immediately after deployment
   - Stream logs for first few minutes
   - Check metrics in Cloud Console

4. **Keep previous images available**
   - Don't delete old image tags
   - Makes rollback easier

5. **Plan maintenance windows**
   - Schedule database migrations during low-traffic times
   - Coordinate with dependent services

6. **Document infrastructure changes**
   - Update this guide when adding secrets or services
   - Keep deployment runbooks up to date

---

## Rollback Decision Tree

```
Is service down/failing?
├─ YES: Check logs with deployment-status.sh
│  ├─ Obvious fix available? → Fix code, push to main
│  └─ Rollback needed? → Run rollback script (immediate recovery)
└─ NO: Monitor and observe
```

---

## Support & Contact

For deployment issues:
1. Check logs: `gcloud run logs read <service>`
2. Run status check: `./scripts/deployment-status.sh`
3. Review this guide's troubleshooting section
4. If critical: Initiate rollback while investigating

---

**Last Updated**: 2024-05-07
**Deployment Infrastructure**: Google Cloud Run
**Region**: asia-south1
