# ─── Stage 1: dependency installation ─────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install only production deps for final image
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ─── Stage 2: production image ────────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY src/          ./src/
COPY migrations/   ./migrations/
COPY package.json  ./

# Create logs directory with correct ownership
RUN mkdir -p logs && chown -R appuser:appgroup /app

USER appuser

# Expose API port
EXPOSE 3000

# Health check for Cloud Run / K8s
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health/live || exit 1

# Default command: start API server
CMD ["node", "src/server.js"]
