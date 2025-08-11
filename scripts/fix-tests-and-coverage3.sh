#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Ensuring repo root…"
test -f pyproject.toml || { echo "Run from project root"; exit 1; }

FILE="nextlevelapex/core/diagnostics.py"
echo "⇒ Patching top-level re-export in $FILE (idempotent)…"

python3 - <<'PY'
from pathlib import Path
import re

p = Path("nextlevelapex/core/diagnostics.py")
s = p.read_text()

# 1) Ensure a truly top-level import with noqa so Ruff doesn't delete it
pat = re.compile(r'^from nextlevelapex\.utils\.sanitizer import trim_large_fields.*$', re.M)
if pat.search(s):
    # Make sure it has the noqa tag
    s = pat.sub("from nextlevelapex.utils.sanitizer import trim_large_fields  # noqa: F401  # re-export for tests", s)
else:
    # Insert after last top-level import
    imports = list(re.finditer(r'^(?:from|import)\s.+$', s, re.M))
    insert_at = imports[-1].end() if imports else 0
    line = "\n# Re-export for tests importing from core.diagnostics\nfrom nextlevelapex.utils.sanitizer import trim_large_fields  # noqa: F401  # re-export for tests\n"
    s = s[:insert_at] + line + s[insert_at:]

# 2) Ensure __all__ contains "trim_large_fields"
all_pat = re.compile(r'^__all__\s*=\s*\[(.*?)\]', re.M | re.S)
m = all_pat.search(s)
if m:
    entries = m.group(1)
    if "trim_large_fields" not in entries:
        new_entries = (entries + (", " if entries.strip() else "") + "'trim_large_fields'")
        s = s[:m.start(1)] + new_entries + s[m.end(1):]
else:
    # Place __all__ near the re-export
    s = s.replace(
        "from nextlevelapex.utils.sanitizer import trim_large_fields  # noqa: F401  # re-export for tests\n",
        "from nextlevelapex.utils.sanitizer import trim_large_fields  # noqa: F401  # re-export for tests\n__all__ = ['trim_large_fields']\n",
        1
    )

p.write_text(s)
print("  • re-export + __all__ ensured")
PY

echo "⇒ Lint & typecheck…"
poetry run ruff check . --fix
poetry run mypy

echo "⇒ Smoke-test the trim test (single-process)…"
poetry run pytest -q -k test_trim -n 0

echo "⇒ Full CI…"
poetry run poe ci
