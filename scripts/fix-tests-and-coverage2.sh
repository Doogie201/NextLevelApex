#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Ensuring we're at the project root with pyproject.toml…"
test -f pyproject.toml || { echo "Run this from the repo root."; exit 1; }

FILE="nextlevelapex/core/diagnostics.py"
echo "⇒ Inserting a TOP-LEVEL re-export of trim_large_fields in $FILE (idempotent)…"

python3 - <<'PY'
from pathlib import Path
import re

p = Path("nextlevelapex/core/diagnostics.py")
s = p.read_text()

# Only count a truly top-level import (no leading spaces).
has_top = re.search(
    r'^from nextlevelapex\.utils\.sanitizer import trim_large_fields\b', s, re.M
)

if has_top:
    print("  • top-level re-export already present")
else:
    # Find the last top-level import before the first def/class and insert after it.
    imports = list(re.finditer(r'^(?:from|import)\s.+$', s, re.M))
    defs = list(re.finditer(r'^(?:def|class)\s', s, re.M))
    insert_at = 0
    if imports and (not defs or imports[-1].start() < defs[0].start()):
        insert_at = imports[-1].end()
    line = "\n# Re-export for tests that import from core.diagnostics\nfrom nextlevelapex.utils.sanitizer import trim_large_fields\n"
    s = s[:insert_at] + line + s[insert_at:]
    p.write_text(s)
    print("  • inserted module-level re-export")
PY

echo "⇒ Quick lint & typecheck…"
poetry run ruff check . --fix
poetry run mypy

echo "⇒ Smoke-test the trim test (no xdist to simplify output)…"
poetry run pytest -q -k test_trim -n 0

echo "⇒ Run your full CI now…"
poetry run poe ci
