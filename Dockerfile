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
RUN apk add --no-cache libc6-compat git tini bash curl

# codex's shell_snapshot feature dumps shell state with bash (`declare`
# etc.) and then validates the snapshot by re-parsing it with /bin/sh.
# On Alpine /bin/sh is busybox ash, which chokes on bash-only syntax
# (e.g. function bodies, arrays) and logs:
#   ERROR codex_core::shell_snapshot: Shell snapshot validation failed:
#     ... line N: syntax error: unterminated quoted string
# Point /bin/sh at bash so the validation step parses the same syntax
# that was emitted.
RUN ln -sf /bin/bash /bin/sh

# Pre-install the codex CLI globally so spawning `codex` works out of the
# box. Override at runtime by setting CODEX_BIN, or skip the install with
# `--build-arg INSTALL_CODEX=false`.
ARG INSTALL_CODEX=true
RUN if [ "$INSTALL_CODEX" = "true" ]; then \
      npm install -g @openai/codex \
      || echo "[warn] @openai/codex not installed; set CODEX_BIN at runtime"; \
    fi

# Next.js standalone output bundles only the necessary runtime files.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Default to running as root. This image is meant to be self-hosted as a
# dev tool with bind-mounted project directories — running as root makes
# host bind mounts "just work" under both Docker and rootless Podman
# (where the host user maps to container UID 0). Override with `--user`
# if you need a different UID, but make sure the bind mount is readable
# for that UID.
ENV HOME=/root
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]
CMD ["node", "server.js"]
