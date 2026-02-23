#!/usr/bin/env bash
# dev-setup.sh — One-command development environment setup.
#
# Safe to run in any checkout or git worktree. Idempotent.
# Installs Python (Poetry) and dashboard (npm) dependencies.
#
# Usage:
#   bash scripts/dev-setup.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== NextLevelApex dev-setup ==="
echo "Repo root: $REPO_ROOT"

# 1) Poetry: install Python deps + register nlx entrypoint
echo ""
echo "[1/2] Installing Python dependencies (poetry install)..."
cd "$REPO_ROOT"
poetry install
echo "  Poetry install complete."

# 2) Dashboard: install Node dependencies
echo ""
echo "[2/2] Installing dashboard dependencies (npm ci)..."
npm --prefix "$REPO_ROOT/dashboard" ci
echo "  Dashboard install complete."

# Summary
echo ""
echo "=== Setup complete ==="
echo "  CLI:       poetry run nlx --help"
echo "  Dashboard: npm --prefix dashboard run dev"
