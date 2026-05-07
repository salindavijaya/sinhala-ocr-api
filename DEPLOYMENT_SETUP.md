# Production Deployment Setup Guide

This guide walks through the setup required to enable automated production deployments to Google Cloud Run.

## Prerequisites

- GCP Project with billing enabled
- `gcloud` CLI installed and authenticated
- GitHub account with admin access to the repository
- Docker installed locally

---

## Step 1: Create GCP Service Account

### 1.1 Create Service Account

```bash
# Set variables
PROJECT_ID="your-project-id"
SERVICE_ACCOUNT_NAME="sinhala-ocr-ci"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Create the service account
gcloud iam service-accounts create ${SERVICE_ACCOUNT_NAME} \
  --display-name="CI/CD for Sinhala OCR API" \
  --project=${PROJECT_ID}
```

### 1.2 Grant Required Roles

```bash
# Cloud Run admin
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member=serviceAccount:${SERVICE_ACCOUNT_EMAIL} \
  --role=roles/run.admin \
  --condition=None

# Use service accounts
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member=serviceAccount:${SERVICE_ACCOUNT_EMAIL} \
  --role=roles/iam.serviceAccountUser \
  --condition=None

# Storage admin (for Docker images and buckets)
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member=serviceAccount:${SERVICE_ACCOUNT_EMAIL} \
  --role=roles/storage.admin \
  --condition=None

# Secret Manager secret accessor
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member=serviceAccount:${SERVICE_ACCOUNT_EMAIL} \
  --role=roles/secretmanager.secretAccessor \
  --condition=None

# Service account user (for running services)
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member=serviceAccount:${SERVICE_ACCOUNT_EMAIL} \
  --role=roles/iam.serviceAccountUser \
  --condition=None

# Container Registry service agent (for pushing images)
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member=serviceAccount:${SERVICE_ACCOUNT_EMAIL} \
  --role=roles/storage.admin \
  --condition=None
```

### 1.3 Create Service Account Key

```bash
# Create JSON key
gcloud iam service-accounts keys create ~/sinhala-ocr-ci-key.json \
  --iam-account=${SERVICE_ACCOUNT_EMAIL} \
  --project=${PROJECT_ID}

# Store the key securely (you'll need it for GitHub secrets)
cat ~/sinhala-ocr-ci-key.json
```

---

## Step 2: Create GCP Resources

### 2.1 Create Storage Buckets

```bash
# Input bucket (for uploaded documents)
gsutil mb -p ${PROJECT_ID} \
  -c STANDARD \
  -l asia-south1 \
  gs://sinhala-ocr-uploads-${PROJECT_ID}

# Output bucket (for transcribed documents)
gsutil mb -p ${PROJECT_ID} \
  -c STANDARD \
  -l asia-south1 \
  gs://sinhala-ocr-outputs-${PROJECT_ID}

# Set bucket lifecycle policies (optional: auto-delete old files)
cat > /tmp/lifecycle.json <<EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 90}
      }
    ]
  }
}
EOF

gsutil lifecycle set /tmp/lifecycle.json gs://sinhala-ocr-uploads-${PROJECT_ID}
gsutil lifecycle set /tmp/lifecycle.json gs://sinhala-ocr-outputs-${PROJECT_ID}
```

### 2.2 Create Secret Manager Secrets

```bash
# Generate JWT secret (64 random characters)
JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '=')
echo $JWT_SECRET | gcloud secrets create jwt-secret \
  --data-file=- \
  --project=${PROJECT_ID}

# Create database password secret (replace with actual password)
DB_PASSWORD="your-secure-db-password-here"
echo $DB_PASSWORD | gcloud secrets create db-password \
  --data-file=- \
  --project=${PROJECT_ID}

# Create Redis URL secret
REDIS_URL="redis://redis-instance.c.${PROJECT_ID}.internal:6379"
echo $REDIS_URL | gcloud secrets create redis-url \
  --data-file=- \
  --project=${PROJECT_ID}
```

### 2.3 Create Cloud SQL Database (if needed)

```bash
# Create Cloud SQL instance (PostgreSQL)
gcloud sql instances create sinhala-ocr-postgres \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=asia-south1 \
  --availability-type=zonal \
  --project=${PROJECT_ID}

# Create database
gcloud sql databases create sinhala_ocr \
  --instance=sinhala-ocr-postgres \
  --project=${PROJECT_ID}

# Create database user
gcloud sql users create ocr_user \
  --instance=sinhala-ocr-postgres \
  --password="your-db-password" \
  --project=${PROJECT_ID}
```

### 2.4 Create Cloud Run Service Account

This is different from the CI/CD service account - it's used by the deployed service.

```bash
SERVICE_ACCOUNT_RUNTIME="${SERVICE_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create sicript-service \
  --display-name="Sinhala OCR API Runtime" \
  --project=${PROJECT_ID}

# Grant permissions for storage and secrets
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member=serviceAccount:${SERVICE_ACCOUNT_RUNTIME} \
  --role=roles/storage.admin

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member=serviceAccount:${SERVICE_ACCOUNT_RUNTIME} \
  --role=roles/secretmanager.secretAccessor
```

---

## Step 3: Configure GitHub Secrets

### 3.1 Add Required Secrets to GitHub

1. **Go to Repository Settings**
   - Navigate to `Settings` → `Secrets and variables` → `Actions`

2. **Create the following secrets:**

   | Secret Name | Value | Source |
   |------------|-------|--------|
   | `GCP_SA_KEY` | Contents of `~/sinhala-ocr-ci-key.json` | From Step 1.3 |
   | `GCP_PROJECT_ID` | `your-project-id` | Your GCP project ID |
   | `GCS_BUCKET_NAME` | `sinhala-ocr-uploads-{PROJECT_ID}` | From Step 2.1 |
   | `GCS_OUTPUT_BUCKET_NAME` | `sinhala-ocr-outputs-{PROJECT_ID}` | From Step 2.1 |

### 3.2 Verify Secrets Setup

```bash
# Test authentication by checking if GitHub workflow can access GCP
gh secret list
```

---

## Step 4: Configure Environment Variables

Create a `.env.production` file (DO NOT commit to GitHub):

```env
# Cloud Run Configuration
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# GCP Configuration
GCP_PROJECT_ID=your-project-id
GCS_BUCKET_NAME=sinhala-ocr-uploads-your-project-id
GCS_OUTPUT_BUCKET_NAME=sinhala-ocr-outputs-your-project-id

# Database Configuration (Cloud SQL Proxy)
DB_HOST=/cloudsql/your-project-id:asia-south1:sinhala-ocr-postgres
DB_NAME=sinhala_ocr
DB_USER=ocr_user
DB_PASSWORD=your-db-password
DB_PORT=5432

# Redis Configuration
REDIS_URL=redis://redis-instance:6379

# API Configuration
API_BASE_URL=https://api.yourdomain.com
API_VERSION=v1

# Transcription Settings
MAX_DOCUMENT_SIZE=52428800  # 50MB
QUEUE_CONCURRENCY=3
TRANSCRIPTION_TIMEOUT=3600

# Secrets (from Secret Manager - NOT here)
# JWT_SECRET - loaded from Secret Manager
# DB_PASSWORD - loaded from Secret Manager
# REDIS_URL - loaded from Secret Manager
```

---

## Step 5: Enable Required Google Cloud APIs

```bash
# Service account and authentication
gcloud services enable iam.googleapis.com \
  --project=${PROJECT_ID}

# Cloud Run
gcloud services enable run.googleapis.com \
  --project=${PROJECT_ID}

# Container Registry
gcloud services enable containerregistry.googleapis.com \
  --project=${PROJECT_ID}

# Cloud Storage
gcloud services enable storage-api.googleapis.com \
  --project=${PROJECT_ID}

# Secret Manager
gcloud services enable secretmanager.googleapis.com \
  --project=${PROJECT_ID}

# Cloud SQL (if needed)
gcloud services enable sqladmin.googleapis.com \
  --project=${PROJECT_ID}

# Cloud Build (optional, for more advanced CI/CD)
gcloud services enable cloudbuild.googleapis.com \
  --project=${PROJECT_ID}
```

---

## Step 6: Test the Setup

### 6.1 Local Docker Build

```bash
# Build image locally
docker build --platform linux/amd64 -t sinhala-ocr-api:test .

# Test the container locally
docker run -it \
  -p 3000:3000 \
  -e NODE_ENV=development \
  -e GCP_PROJECT_ID=${PROJECT_ID} \
  sinhala-ocr-api:test

# Test health endpoint
curl http://localhost:3000/api/v1/health/live
```

### 6.2 Test Manual Deployment

```bash
# Set environment variables
export GCP_PROJECT_ID="your-project-id"
export GCS_BUCKET_NAME="sinhala-ocr-uploads-your-project-id"
export GCS_OUTPUT_BUCKET_NAME="sinhala-ocr-outputs-your-project-id"
export REGION="asia-south1"

# Authenticate to GCP
gcloud auth application-default login

# Run deployment script
bash scripts/deploy-cloud-run.sh
```

### 6.3 Verify Cloud Run Service

```bash
# Get service URL
SERVICE_URL=$(gcloud run services describe sicript-service \
  --region=asia-south1 \
  --format="value(status.url)" \
  --project=${PROJECT_ID})

# Test health endpoint
curl ${SERVICE_URL}/api/v1/health/live

# Stream logs
gcloud run logs read sicript-service \
  --region=asia-south1 \
  --project=${PROJECT_ID} \
  --follow
```

---

## Step 7: Configure Monitoring & Alerts (Optional)

### 7.1 Set Up Cloud Logging

```bash
# Create a log sink for application errors
gcloud logging sinks create production-errors \
  bigquery.googleapis.com/projects/${PROJECT_ID}/datasets/ocr_logs \
  --log-filter='resource.type="cloud_run_revision" AND severity="ERROR"' \
  --project=${PROJECT_ID}
```

### 7.2 Create Alert Policy

```bash
# High error rate alert
gcloud alpha monitoring policies create \
  --notification-channels=YOUR_CHANNEL_ID \
  --display-name="OCR API High Error Rate" \
  --condition-display-name="Error rate > 5%" \
  --condition-threshold-value=0.05
```

---

## Verification Checklist

Before running the first deployment, verify:

- [ ] GCP Project created and billing enabled
- [ ] Service account created with all required roles
- [ ] Service account key saved securely
- [ ] GitHub secrets configured (GCP_SA_KEY, GCP_PROJECT_ID, bucket names)
- [ ] Storage buckets created
- [ ] Secret Manager secrets created (jwt-secret, db-password, redis-url)
- [ ] Cloud Run API enabled
- [ ] Cloud SQL instance created (if using database)
- [ ] Service account for runtime created
- [ ] Local Docker build works
- [ ] Manual deployment test successful
- [ ] Health endpoint returns 200 OK

---

## Post-Deployment Configuration

### 7.1 Set Up Custom Domain (Optional)

```bash
# Map custom domain to Cloud Run service
gcloud run domain-mappings create \
  --service=sicript-service \
  --domain=api.yourdomain.com \
  --region=asia-south1
```

### 7.2 Configure Cloud Armor (Optional)

```bash
# Protect against DDoS and provide WAF
gcloud compute security-policies create ocr-api-policy \
  --description="Security policy for OCR API"

gcloud compute security-policies rules create 100 \
  --security-policy=ocr-api-policy \
  --action=allow
```

---

## Troubleshooting Setup Issues

### "Permission denied" errors
- Check service account has all required roles
- Verify gcloud auth is using correct account
- Check role binding applied successfully

### "Container not found" errors
- Verify Docker image built and pushed successfully
- Check Container Registry is enabled
- Verify registry path matches project ID

### "Secret not found" errors
- Verify secrets created in Secret Manager
- Check secret names match deployment script
- Verify service account has secretmanager.secretAccessor role

### "Database connection failed" errors
- Verify Cloud SQL instance is running
- Check database credentials are correct
- Verify network access is configured (Cloud SQL Proxy)

---

## Next Steps

1. ✅ Complete all setup steps above
2. ✅ Verify checklist items
3. ✅ Push code to main branch
4. ✅ Monitor GitHub Actions workflow
5. ✅ Verify deployment successful
6. ✅ Check Cloud Run service is healthy
7. ✅ Test API endpoints
8. 📖 Read [DEPLOYMENT.md](./DEPLOYMENT.md) for operational procedures

---

**Document Version**: 1.0
**Last Updated**: 2024-05-07
