# ── Stage 1: Build ────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Copy only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy Prisma schema and generated client
COPY prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built application
COPY --from=builder /app/dist ./dist

# Run Prisma migrations on startup, then start the app
COPY <<'EOF' /app/entrypoint.sh
#!/bin/sh
set -e
npx prisma migrate deploy
node dist/index.js
EOF
RUN chmod +x /app/entrypoint.sh

# Switch to non-root user
USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["/app/entrypoint.sh"]
