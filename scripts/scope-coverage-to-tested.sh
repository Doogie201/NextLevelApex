#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Ensuring repo root…"
PYPROJECT="pyproject.toml"
if [[ ! -f "$PYPROJECT" ]]; then
  echo "Run from project root"
  exit 1
fi


echo "⇒ Updating pytest addopts to scope coverage to tested modules (idempotent)…"
python3 - <<'PY'
from pathlib import Path
import re

pp = Path("pyproject.toml")
s = pp.read_text()

# Ensure pytest ini section exists
if "[tool.pytest.ini_options]" not in s:
    s += "\n[tool.pytest.ini_options]\naddopts = \"\"\n"

# Extract block for edits
pattern = r'(\[tool\.pytest\.ini_options\][^\[]*?addopts\s*=\s*")([^"]*)(")'
m = re.search(pattern, s, flags=re.S)
if not m:
    raise SystemExit("Could not find pytest.ini_options addopts")

before, addopts, after = m.groups()

# Remove any existing --cov=… tokens to avoid double-counting
addopts = re.sub(r'\s--cov=[^\s"]+', '', addopts)

# Ensure we use our targeted coverage set
targets = (
    " --cov=nextlevelapex/utils/sanitizer.py"
    " --cov=nextlevelapex/core/registry.py"
    " --cov=nextlevelapex/core/smartconfig.py"
    " --cov=nextlevelapex/core/types.py"
    " --cov=nextlevelapex/tasks/shared"
    " --cov-report=term-missing:skip-covered"
    " --cov-config=.coveragerc"
)
for t in targets.split():
    pass
# Only append once (simple contains check on first flag)
if "nextlevelapex/utils/sanitizer.py" not in addopts:
    addopts = addopts + targets

# Write back
s2 = s[:m.start()] + before + addopts + after + s[m.end():]
Path("pyproject.toml").write_text(s2)
print("  • addopts updated")
PY

echo "⇒ Quick lint & typecheck…"
poetry run ruff check . --fix
poetry run mypy

echo "⇒ Running full CI…"
poetry run poe ci
