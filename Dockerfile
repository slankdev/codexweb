# syntax=docker/dockerfile:1.7

# ----- deps -------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN \
  if [ -f package-lock.json ]; then npm ci; \
  else npm install; fi

# ----- builder ----------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ----- runner -----------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Tools needed at runtime: git for codex submodule operations, tini for
# clean signal handling so SIGTERM stops codex children.
RUN apk add --no-cache libc6-compat git tini

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --home /home/nextjs --shell /bin/sh nextjs \
  && mkdir -p /home/nextjs/.codex \
  && chown -R nextjs:nodejs /home/nextjs

# Optionally pre-install the codex CLI globally so spawning `codex` works
# out of the box. We aggressively normalise execute bits because npm
# packages sometimes ship binaries that aren't world-executable, which
# would trip up the non-root `nextjs` user with EACCES.
ARG INSTALL_CODEX=true
RUN if [ "$INSTALL_CODEX" = "true" ]; then \
      set -eu; \
      if npm install -g @openai/codex 2>&1; then \
        if command -v codex >/dev/null 2>&1; then \
          CODEX_PATH="$(command -v codex)"; \
          REAL="$(readlink -f "$CODEX_PATH")"; \
          chmod -R a+rX /usr/local/lib/node_modules 2>/dev/null || true; \
          chmod a+rx "$CODEX_PATH" 2>/dev/null || true; \
          [ -n "$REAL" ] && chmod a+rx "$REAL" 2>/dev/null || true; \
          echo "[setup] codex installed at $CODEX_PATH -> $REAL"; \
        else \
          echo "[warn] codex command not on PATH after install"; \
        fi; \
      else \
        echo "[warn] @openai/codex not installed; set CODEX_BIN at runtime"; \
      fi; \
    fi

# Next.js standalone output bundles only the necessary runtime files.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
ENV HOME=/home/nextjs
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
