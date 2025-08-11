#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Ensuring we're at the project root with pyproject.toml…"
test -f pyproject.toml || { echo "Run this from the repo root."; exit 1; }

FILE="nextlevelapex/core/diagnostics.py"
echo "⇒ Patching module-level re-export in $FILE (idempotent)…"

python3 - <<'PY'
from pathlib import Path
import re

p = Path("nextlevelapex/core/diagnostics.py")
src = p.read_text()

# already exported at module scope?
if re.search(r'^\s*from\s+nextlevelapex\.utils\.sanitizer\s+import\s+trim_large_fields\b', src, re.M):
    print("  • re-export already present")
else:
    # find the last top-level import and insert right after it
    m = list(re.finditer(r'^(?:from|import)\s.+$', src, re.M))
    insert_at = m[-1].end() if m else 0
    shim = "\n# Re-export for tests that import from core.diagnostics\nfrom nextlevelapex.utils.sanitizer import trim_large_fields\n"
    new_src = src[:insert_at] + shim + src[insert_at:]
    p.write_text(new_src)
    print("  • added: from nextlevelapex.utils.sanitizer import trim_large_fields")
PY

echo "⇒ Verifying pytest-cov is available for xdist workers…"
if ! poetry run python -c "import pytest_cov" >/dev/null 2>&1; then
  echo "  • installing pytest-cov (dev dep)…"
  poetry add --group dev pytest-cov >/dev/null
else
  echo "  • pytest-cov already present"
fi

echo "⇒ Lint & typecheck quick pass…"
poetry run ruff check . --fix
poetry run mypy

echo "⇒ Smoke-test the previously failing test without xdist…"
poetry run pytest -q -k test_trim -n 0 || {
  echo "❌ Trim test still failing — open tests/core/diagnostics/test_trim.py and diagnostics.py to inspect."
  exit 1
}

echo "✅ Trim import fixed. You can now run your normal CI."
