#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Widening handler list typing in core/logger.py …"

python3 - <<'PY'
import re
from pathlib import Path

p = Path("nextlevelapex/core/logger.py")
src = p.read_text()

def widen(line: str) -> str:
    # Replace `handlers: list[RichHandler] = []` or `List[RichHandler]`
    line = re.sub(
        r"(handlers\s*:\s*)(?:list|List)\s*\[\s*RichHandler[^\]]*\](\s*=\s*\[\])",
        r"\1list[logging.Handler]\2",
        line,
    )
    return line

lines = src.splitlines(keepends=True)
for i, L in enumerate(lines):
    if "handlers" in L and ":" in L and "[" in L and "RichHandler" in L:
        lines[i] = widen(L)

new = "".join(lines)
if new != src:
    p.write_text(new)
    print("  • updated annotation in", p)
else:
    print("  • no change made (pattern not found)")

# Safety: ensure we actually import logging (should already be there)
t = Path("nextlevelapex/core/logger.py").read_text()
if "import logging" not in t:
    t = "import logging\n" + t
    Path("nextlevelapex/core/logger.py").write_text(t)
    print("  • added 'import logging'")

PY

echo "⇒ Formatting & running checks…"
poetry run ruff check . --fix
poetry run mypy
echo "✅ Done."
