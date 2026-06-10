# syntax=docker/dockerfile:1

# ── Stage 1: install dependencies ──────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Needed by some native modules (e.g. sharp) on Alpine
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars (non-secret). Secret keys are NOT needed at build time;
# they're injected at runtime via docker-compose / -e flags.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ── Stage 3: runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Default port; override with PORT env var if needed.
ENV PORT=3000
# Bind to all interfaces. Docker sets HOSTNAME to the container id by default, and
# Next's standalone server binds to process.env.HOSTNAME — without this override it
# would bind to the wrong interface and the published port would serve nothing.
ENV HOSTNAME=0.0.0.0

# Run as non-root
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# `output: "standalone"` (next.config.ts) emits a minimal server bundle with its
# own pruned node_modules. Static assets and public/ are NOT included, so copy
# them in separately.
COPY --from=builder /app/public ./public

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# The home page ("/") is statically prerendered, so this probe is cheap and never
# touches the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

# All runtime logic (route handlers, the Inngest serve endpoint) lives in server.js
CMD ["node", "server.js"]
