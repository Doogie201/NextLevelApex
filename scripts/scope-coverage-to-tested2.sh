#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Ensuring repo root…"
test -f pyproject.toml || { echo "Run from project root"; exit 1; }

python3 - <<'PY'
from pathlib import Path
import re

pp = Path("pyproject.toml")
s = pp.read_text()

# Ensure the pytest section exists
if "[tool.pytest.ini_options]" not in s:
    s = s.rstrip() + "\n\n[tool.pytest.ini_options]\n"

# Build targeted coverage flags (tweak as you add tests)
flags = [
    "-q", "-n", "auto",
    "--cov=nextlevelapex/utils/sanitizer.py",
    "--cov=nextlevelapex/core/registry.py",
    "--cov=nextlevelapex/core/smartconfig.py",
    "--cov=nextlevelapex/core/types.py",
    "--cov=nextlevelapex/tasks/shared",
    "--cov-report=term-missing:skip-covered",
    "--cov-config=.coveragerc",
    "--cov-fail-under=85",
]
addopts_value = " ".join(flags)

# Grab pytest section block
sec_re = re.compile(r'(?ms)^\[tool\.pytest\.ini_options\]\s*(.*?)^(?=\[|\Z)')
m = sec_re.search(s)
if not m:
    raise SystemExit("could not locate pytest ini_options section after creation")

block = m.group(0)

# Remove any existing addopts line(s)
block = re.sub(r'(?m)^\s*addopts\s*=.*\n', '', block).rstrip() + "\n"

# Insert our addopts
block += f'addopts = "{addopts_value}"\n'

# Splice back
s2 = s[:m.start()] + block + s[m.end():]
pp.write_text(s2)
print("  • [tool.pytest.ini_options].addopts written")
PY

echo "⇒ Lint & typecheck…"
poetry run ruff check . --fix
poetry run mypy

echo "⇒ Full CI…"
poetry run poe ci
