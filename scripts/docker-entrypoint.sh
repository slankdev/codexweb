#!/bin/sh
# codexweb container entrypoint.
#
# If `OPENAI_API_KEY` is set and there's no existing auth.json yet, run
# `codex login --with-api-key` so codex has a populated `~/.codex/auth.json`
# before the Next.js server starts. The OpenAI Responses WebSocket
# endpoint (the one codex uses) refuses the bare `OPENAI_API_KEY` env var
# auth path — it needs the key baked into auth.json.
#
# If you bind-mount `~/.codex` from the host (with existing credentials)
# we leave it alone.

set -e

CODEX_HOME="${CODEX_HOME:-/root/.codex}"
AUTH_FILE="$CODEX_HOME/auth.json"

if [ -n "$OPENAI_API_KEY" ] && [ ! -s "$AUTH_FILE" ]; then
  mkdir -p "$CODEX_HOME"
  echo "[entrypoint] Logging codex in via OPENAI_API_KEY ..."
  if printf '%s\n' "$OPENAI_API_KEY" | codex login --with-api-key; then
    echo "[entrypoint] codex login OK -> $AUTH_FILE"
  else
    echo "[entrypoint] codex login failed (continuing; the server will surface the error on first request)" >&2
  fi
fi

exec "$@"
