#!/usr/bin/env bash
set -euo pipefail

FILE="nextlevelapex/core/logger.py"

echo "⇒ Widening handler list typing in $FILE …"

python3 - <<'PY'
import re
from pathlib import Path

p = Path("nextlevelapex/core/logger.py")
src = p.read_text()

changed = False

# 1) Replace typed assignment like:
#    handlers: list[RichHandler] = []
#    handlers: List[RichHandler] = []
pat_eq = re.compile(
    r"^(?P<indent>\s*)handlers\s*:\s*([^\n=]+?)\s*=\s*\[\s*\](?P<trail>.*)$",
    re.MULTILINE,
)
def repl_eq(m):
    return f"{m.group('indent')}handlers: list[logging.Handler] = []{m.group('trail')}"

new = pat_eq.sub(repl_eq, src)
if new != src:
    src = new
    changed = True

# 2) If the annotation is on its own line (and the assignment is elsewhere):
#    handlers: list[RichHandler]
if not changed:
    pat_anno = re.compile(
        r"^(?P<indent>\s*)handlers\s*:\s*([^\n=]+?)\s*$",
        re.MULTILINE,
    )
    def repl_anno(m):
        return f"{m.group('indent')}handlers: list[logging.Handler]"
    new = pat_anno.sub(repl_anno, src)
    if new != src:
        src = new
        changed = True

# 3) Ensure `import logging` exists (harmless if already present)
if "import logging" not in src.splitlines()[0:50]:
    src = "import logging\n" + src
    changed = True

if changed:
    p.write_text(src)
    print("  • updated annotation/imports")
else:
    print("  • no change made (pattern not found)")

PY

echo "⇒ Formatting & running checks…"
poetry run ruff check . --fix
poetry run mypy
echo "✅ Done."
