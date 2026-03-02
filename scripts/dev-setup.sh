#!/usr/bin/env bash
# dev-setup.sh — One-command development environment setup.
#
# Safe to run in any checkout or git worktree. Idempotent.
# Installs Python (Poetry) and dashboard (npm) dependencies.
#
# Usage:
#   bash scripts/dev-setup.sh                 # full setup (network required for first run)
#   bash scripts/dev-setup.sh --offline       # skip network-dependent steps
#   bash scripts/dev-setup.sh --repair-env    # force clean venv rebuild
set -euo pipefail

OFFLINE=false
REPAIR_ENV=false
for arg in "$@"; do
  case "$arg" in
    --offline) OFFLINE=true ;;
    --repair-env) REPAIR_ENV=true ;;
  esac
done

# Resolve repo root even inside a git worktree
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Detect worktree context
IS_WORKTREE=false
if command -v git >/dev/null 2>&1; then
  GIT_COMMON="$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
  GIT_DIR="$(git -C "$REPO_ROOT" rev-parse --git-dir 2>/dev/null || true)"
  if [ -n "$GIT_COMMON" ] && [ -n "$GIT_DIR" ] && [ "$GIT_COMMON" != "$GIT_DIR" ]; then
    IS_WORKTREE=true
  fi
fi

echo "=== NextLevelApex dev-setup ==="
echo "Repo root:  $REPO_ROOT"
echo "Worktree:   $IS_WORKTREE"
echo "Offline:    $OFFLINE"
echo "Repair env: $REPAIR_ENV"

# 0) Scrub AppleDouble metadata from generated directories.
echo ""
echo "[0/2] Scrubbing generated artifact metadata..."
bash "$REPO_ROOT/scripts/env-integrity.sh" scrub

# Decide whether the local virtualenv must be rebuilt.
VENV_REBUILD_REQUIRED=false
if [ "$REPAIR_ENV" = true ]; then
  VENV_REBUILD_REQUIRED=true
fi

if [ -d "$REPO_ROOT/.venv" ]; then
  if find "$REPO_ROOT/.venv" -type f -name '._*' -print -quit 2>/dev/null | grep -q .; then
    echo "[dev-setup] detected AppleDouble metadata in .venv; scheduling rebuild."
    VENV_REBUILD_REQUIRED=true
  fi

  if ! (cd "$REPO_ROOT" && ./.venv/bin/python -I -W ignore -c 'import sys; print(sys.prefix)' >/dev/null 2>&1); then
    echo "[dev-setup] .venv isolated startup failed; scheduling rebuild."
    VENV_REBUILD_REQUIRED=true
  fi
fi

if [ "$VENV_REBUILD_REQUIRED" = true ]; then
  if [ "$OFFLINE" = true ]; then
    echo "[dev-setup] cannot rebuild .venv in --offline mode." >&2
    exit 3
  fi
  echo "[dev-setup] rebuilding .venv..."
  rm -rf "$REPO_ROOT/.venv"
fi

# 1) Poetry: install Python deps + register nlx entrypoint
echo ""
if [ "$OFFLINE" = true ]; then
  echo "[1/2] Skipping Poetry install (--offline)."
else
  echo "[1/2] Installing Python dependencies (poetry install)..."
  cd "$REPO_ROOT"
  poetry install
  echo "  Poetry install complete."
fi

# 2) Dashboard: install Node dependencies
echo ""
if [ "$OFFLINE" = true ]; then
  echo "[2/2] Skipping npm ci (--offline)."
else
  echo "[2/2] Installing dashboard dependencies (npm ci)..."
  npm --prefix "$REPO_ROOT/dashboard" ci
  echo "  Dashboard install complete."
fi

echo ""
echo "[post] Scrubbing generated artifact metadata..."
bash "$REPO_ROOT/scripts/env-integrity.sh" scrub

echo ""
echo "[post] Validating environment integrity..."
bash "$REPO_ROOT/scripts/env-integrity.sh" check

# Summary
echo ""
echo "=== Setup complete ==="
echo "  CLI:       poetry run nlx --help"
echo "  Dashboard: npm --prefix dashboard run dev"
