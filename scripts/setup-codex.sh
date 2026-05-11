#!/usr/bin/env bash
# Adds the upstream openai/codex repository as a git submodule under vendor/codex.
# Re-run idempotently — does nothing if the submodule is already present.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SUBMODULE_PATH="vendor/codex"
SUBMODULE_URL="${CODEX_SUBMODULE_URL:-https://github.com/openai/codex.git}"

if [ -d "$SUBMODULE_PATH/.git" ] || [ -f "$SUBMODULE_PATH/.git" ]; then
  echo "[setup-codex] $SUBMODULE_PATH already present — pulling latest."
  git submodule update --init --remote -- "$SUBMODULE_PATH"
  exit 0
fi

echo "[setup-codex] Adding $SUBMODULE_URL at $SUBMODULE_PATH"
git submodule add "$SUBMODULE_URL" "$SUBMODULE_PATH"
git submodule update --init --recursive -- "$SUBMODULE_PATH"

echo
echo "[setup-codex] Done. Next steps:"
echo "  1. Install / build the codex CLI from $SUBMODULE_PATH following its README."
echo "  2. Either add the produced binary to PATH or set CODEX_BIN=/abs/path/to/codex."
echo "  3. Set OPENAI_API_KEY (or whatever the codex CLI requires) in your environment."
