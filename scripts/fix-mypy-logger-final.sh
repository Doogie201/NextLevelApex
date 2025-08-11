#!/usr/bin/env bash
set -euo pipefail

FILE="nextlevelapex/core/logger.py"

echo "⇒ Ensuring handler list is typed as list[logging.Handler] in $FILE …"

python3 - <<'PY'
import re
from pathlib import Path

p = Path("nextlevelapex/core/logger.py")
src = p.read_text()

changed = False

# 1) If it's already correctly annotated, bail early.
if re.search(r'^\s*handlers\s*:\s*list\[logging\.Handler\]\s*=\s*\[\s*\]', src, re.M):
    print("  • already annotated correctly")
else:
    # 2) Convert a plain 'handlers = []' into a typed list.
    new = re.sub(
        r'^(\s*)handlers\s*=\s*\[\s*\](.*)$',
        r'\1handlers: list[logging.Handler] = []\2',
        src,
        flags=re.M,
    )
    if new != src:
        src = new
        changed = True

    # 3) If there was some other annotation, normalize it to logging.Handler.
    new = re.sub(
        r'^(\s*)handlers\s*:\s*.+?\s*=\s*\[\s*\](.*)$',
        r'\1handlers: list[logging.Handler] = []\2',
        src,
        flags=re.M,
    )
    if new != src:
        src = new
        changed = True

    # 4) Ensure we have 'import logging' near the top (should already exist).
    if "import logging" not in src.splitlines()[:40]:
        src = "import logging\n" + src
        changed = True

    if changed:
        p.write_text(src)
        print("  • updated annotation/imports")
    else:
        print("  • no matching 'handlers = []' line found; nothing changed")

PY

echo "⇒ Formatting & running checks…"
poetry run ruff check . --fix
poetry run mypy
echo "✅ Done."
