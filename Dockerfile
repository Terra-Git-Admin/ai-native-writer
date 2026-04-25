FROM node:20-slim AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Build the application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/data
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application (Next.js standalone output)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle

# Copy the GCS bootstrap script. It runs before server.js to pull the
# canonical writer.db from GCS into /tmp. Standalone trace already
# includes @google-cloud/storage in node_modules because persistence.ts
# imports it.
COPY --chown=nextjs:nodejs scripts/db-bootstrap.mjs /app/db-bootstrap.mjs

# Legacy gcsfuse mount path is still created so a one-time migration from
# /app/data/writer.db can run if the GCS object doesn't exist yet.
RUN mkdir -p /app/data /tmp && chown nextjs:nodejs /app/data /tmp

USER nextjs

EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# DATABASE_PATH defaults to /tmp on Cloud Run; can be overridden via env.
# The bootstrap script downloads the canonical writer.db.gz from GCS to
# DATABASE_PATH BEFORE the Next.js server starts. If GCS download fails
# AND no legacy /app/data/writer.db exists, the server starts with an
# empty db (or aborts if BOOTSTRAP_REQUIRED=true).
ENV DATABASE_PATH=/tmp/writer.db

CMD ["sh", "-c", "node /app/db-bootstrap.mjs && node server.js"]
