#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Repairing bad annotation placement introduced in pass4…"

FILES=(
  "nextlevelapex/core/command.py"
  "nextlevelapex/core/config.py"
  "nextlevelapex/core/logger.py"
  "nextlevelapex/core/registry.py"
  "nextlevelapex/core/task.py"
)

fix_file() {
  local f="$1"
  [[ -f "$f" ]] || { echo "  • skip (missing) $f"; return; }

  cp "$f" "$f.bak"

  # Fix patterns like:  def name(args): -> ReturnType:   →   def name(args) -> ReturnType:
  # Only touch function definitions; keep it simple and line-based.
  perl -0777 -pe '
    s/(\bdef\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\))\s*:\s*->\s*/$1 -> /g;
  ' -i "$f"

  echo "  • fixed $f"
}

for f in "${FILES[@]}"; do
  fix_file "$f"
done

echo "⇒ Formatting & running checks…"
poetry run ruff check . --fix || true
poetry run mypy || true

echo "⇒ Done. If mypy still reports a few errors, paste them and I’ll give you a final tiny patch."
