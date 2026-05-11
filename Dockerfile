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

# Optionally pre-install the codex CLI globally so spawning `codex` works
# out of the box. If the package can't be fetched we still produce a usable
# image — the operator can mount a binary and point CODEX_BIN at it.
ARG INSTALL_CODEX=true
RUN if [ "$INSTALL_CODEX" = "true" ]; then \
      npm install -g @openai/codex || echo "[warn] @openai/codex not installed; set CODEX_BIN at runtime"; \
    fi

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next.js standalone output bundles only the necessary runtime files.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
