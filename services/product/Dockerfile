# ── Stage 1: Build ────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist

COPY <<'EOF' /app/entrypoint.sh
#!/bin/sh
set -e
npx prisma migrate deploy
node dist/index.js
EOF
RUN chmod +x /app/entrypoint.sh

USER appuser

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

CMD ["/app/entrypoint.sh"]
