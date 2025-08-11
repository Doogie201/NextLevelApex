#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Ensuring repo root…"
test -f pyproject.toml || { echo "Run from project root"; exit 1; }

echo "⇒ Backing up pyproject.toml to pyproject.toml.bak …"
cp -f pyproject.toml pyproject.toml.bak

python3 - <<'PY'
from pathlib import Path
import re

pp = Path("pyproject.toml")
s = pp.read_text()

# Remove ANY existing [tool.pytest.ini_options] block(s)
s = re.sub(r'(?ms)^\[tool\.pytest\.ini_options\][^\[]*', '', s).rstrip() + "\n\n"

# Canonical pytest block — use a TOML list (less quoting pain)
block = """[tool.pytest.ini_options]
addopts = [
  "-q",
  "-n=auto",
  "--cov=nextlevelapex/utils/sanitizer.py",
  "--cov=nextlevelapex/core/registry.py",
  "--cov=nextlevelapex/core/smartconfig.py",
  "--cov=nextlevelapex/core/types.py",
  "--cov=nextlevelapex/tasks/shared",
  "--cov-report=term-missing:skip-covered",
  "--cov-config=.coveragerc",
  "--cov-fail-under=85",
]
"""

pp.write_text(s + block)
print("  • Rewrote [tool.pytest.ini_options] cleanly")
PY

echo "⇒ Lint & typecheck quick pass…"
poetry run ruff check . --fix
poetry run mypy

echo "⇒ Full CI…"
poetry run poe ci
