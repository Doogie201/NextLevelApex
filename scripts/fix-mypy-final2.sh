#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Finalizing mypy fixes (logger handler typing + command env typing)…"

python3 - <<'PY'
import re
from pathlib import Path

def patch(path: Path, desc: str, fn):
    if not path.exists():
        print(f"  • skip (missing) {path}")
        return
    before = path.read_text()
    after  = fn(before)
    if after != before:
        path.write_text(after)
        print(f"  • {desc} in {path}")
    else:
        print(f"  • no change {path}")

# --- nextlevelapex/core/logger.py ---
def fix_logger(text: str) -> str:
    t = text
    # Ensure we import typing + logging already (usually present)
    if "from typing import Any" not in t and "from typing import Any, Optional" not in t:
        t = t.replace("import logging", "import logging\nfrom typing import Any, Optional")

    # handlers should accept mixed handler types → annotate as logging.Handler
    # Handle common variants (list[...] and List[...])
    t = re.sub(r"handlers:\s*list\s*\[\s*RichHandler\s*\]\s*=\s*\[\]",
               "handlers: list[logging.Handler] = []", t)
    t = re.sub(r"handlers:\s*List\s*\[\s*RichHandler\s*\]\s*=\s*\[\]",
               "handlers: list[logging.Handler] = []", t)

    # In case someone constrained it elsewhere, widen 'RichHandler' item appends are fine,
    # but mypy complained specifically because list type was RichHandler-only.

    return t

# --- nextlevelapex/core/command.py ---
def fix_command(text: str) -> str:
    t = text
    # Ensure generics are present for env parameter
    # env: dict | None = None  ->  env: dict[str, str] | None = None
    t = re.sub(r"env:\s*dict\s*\|\s*None\s*=\s*None",
               "env: dict[str, str] | None = None", t)
    # Also catch if there's a type comment variant
    t = re.sub(r"env:\s*dict\s*=\s*None", "env: dict[str, str] | None = None", t)
    return t

patch(Path("nextlevelapex/core/logger.py"), "widen handler list typing", fix_logger)
patch(Path("nextlevelapex/core/command.py"), "add generics to env typing", fix_command)
PY

echo "⇒ Formatting & running checks…"
poetry run ruff check . --fix
poetry run mypy || true

echo "⇒ Done. If anything still fails, paste the 1–2 remaining mypy lines."
