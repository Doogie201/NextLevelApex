#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Fixing remaining mypy issues (pass 2)…"

root="nextlevelapex"
py() { python3 - "$@"; }

patch() {
  local file="$1"; shift
  py <<'PY' "$file" "$@"
import os, re, sys
path = sys.argv[1]
pairs = sys.argv[2:]
src0 = open(path, "r", encoding="utf-8").read()
src = src0
for i in range(0, len(pairs), 2):
    pat = re.compile(pairs[i], re.M)
    repl = pairs[i+1]
    src = pat.sub(repl, src)
if src != src0:
    open(path, "w", encoding="utf-8").write(src)
    print(f"  • patched {os.path.relpath(path)}")
else:
    print(f"  • no change {os.path.relpath(path)}")
PY
}

ensure_imports() {
  local file="$1"; shift
  py <<'PY' "$file" "$@"
import re, sys
path = sys.argv[1]
imports = sys.argv[2:]
src = open(path, "r", encoding="utf-8").read()
lines = src.splitlines()
ins = 0
for i,l in enumerate(lines[:8]):
    if "__future__" in l:
        ins = i+1
added=False
for imp in imports:
    if re.search(rf"^\s*{re.escape(imp)}\s*$", src, re.M) is None:
        lines.insert(ins, imp); ins += 1; added=True
if added:
    with open(path,"w",encoding="utf-8") as f: f.write("\n".join(lines)+"\n")
    print(f"  • added imports in {path}")
else:
    print(f"  • imports OK in {path}")
PY
}

# core/task.py
ensure_imports "$root/core/task.py" "from typing import Any"
patch "$root/core/task.py" \
  r'(^\s*config\s*:\s*)dict(?!\[)' r'\1dict[str, Any]' \
  r'(^\s*def\s+as_dict\(\s*self\s*\)\s*->\s*)dict\s*:' r'\1dict[str, Any]:' \
  r'(^\s*def\s+__str__\(\s*self\s*\)\s*:)' r'\1 -> str:'

# core/registry.py
ensure_imports "$root/core/registry.py" "from typing import Any, Callable, Dict"
patch "$root/core/registry.py" \
  r'(^\s*config\s*:\s*)dict(?!\[)' r'\1dict[str, Any]' \
  r'(fn\._task_name\s*=\s*name)(?!.*type:\s*ignore\[attr-defined\])' r'\1  # type: ignore[attr-defined]' \
  r'(^\s*def\s+clear_registry\(\s*\)\s*:)' r'\1 -> None:'

# core/report.py
ensure_imports "$root/core/report.py" "from typing import Any" "from pathlib import Path"
patch "$root/core/report.py" \
  r'^\s*def\s+generate_report\s*\(.*\)\s*:' \
  'def generate_report(state: dict[str, Any], out_dir: Path, as_html: bool = True, as_md: bool = True) -> tuple[Path | None, Path | None]:'

# core/state.py
ensure_imports "$root/core/state.py" "from typing import Any, cast"
patch "$root/core/state.py" \
  r'(^\s*)return\s+json\.load\(\s*f\s*\)' r'\1data = json.load(f)\n\1return cast(dict[str, Any], data)' \
  r'(^\s*)return\s+current_hash\s*!=\s*previous_hash' r'\1return bool(current_hash != previous_hash)' \
  r'return\s+state\.get\("health_history",\s*\{\}\)\.get\(task,\s*\[\]\)' \
  'return cast(list[dict[str, Any]], state.get("health_history", {}).get(task, []))' \
  r'return\s+state\.get\("service_versions",\s*\{\}\)' \
  'return cast(dict[str, str], state.get("service_versions", {}))'

# core/logger.py
ensure_imports "$root/core/logger.py" "import logging" "from typing import Any"
patch "$root/core/logger.py" \
  r'(^\s*def\s+_get_logger\(\s*self\s*\)\s*:)' r'\1 -> logging.Logger:' \
  r'(^\s*def\s+__getattr__\(\s*self\s*,\s*item\s*\)\s*:)' r'\1 -> Any:' \
  r'(^\s*def\s+setup_logging\(\s*config:\s*dict\[str,\s*Any\],\s*verbose:\s*bool\s*=\s*False\s*\)\s*:)' \
  r'\1 -> None:' \
  r'handlers:\s*list\[.*?\]' 'handlers: list[logging.Handler]'

# core/config.py
ensure_imports "$root/core/config.py" "from typing import Any"
patch "$root/core/config.py" \
  r'^(\s*)def\s+_deep_update\(\s*base:\s*dict(?:\[.*?\])?\s*,\s*updates:\s*dict(?:\[.*?\])?\s*\)\s*:' \
  r'\1def _deep_update(base: dict[str, Any], updates: dict[str, Any]) -> None:'

# core/command.py
ensure_imports "$root/core/command.py" "from typing import Any, Mapping"
patch "$root/core/command.py" \
  r'(^\s*def\s+__bool__\(\s*self\s*\)\s*:)' r'\1 -> bool:' \
  r'env:\s*dict(?:\[.*?\])?\s*\|\s*None\s*=\s*None' 'env: Mapping[str, str] | None = None'

# core/smartconfig.py
ensure_imports "$root/core/smartconfig.py" "from typing import Any"
patch "$root/core/smartconfig.py" \
  r'(^\s*def\s+summary\(\s*self\s*\)\s*->\s*)dict\s*:' r'\1dict[str, Any]:' \
  r'(^\s*def\s+get_bloat_limits\(\s*\)\s*->\s*)dict\s*:' r'\1dict[str, Any]:'

# utils/sanitizer.py
ensure_imports "$root/utils/sanitizer.py" "from typing import Any"
patch "$root/utils/sanitizer.py" \
  r'^(\s*)def\s+trim_large_fields\(\s*d:\s*dict\s*,\s*path\s*=\s*\(\)\s*,\s*stats\s*=\s*None\s*\)\s*->\s*tuple\[dict,\s*dict\]\s*:' \
  r'\1def trim_large_fields(d: dict[str, Any], path: tuple[str, ...] = (), stats: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:' \
  r'^(\s*)trimmed\s*=\s*\{\}' r'\1trimmed: dict[str, Any] = {}' \
  r'(^\s*stats\s*=\s*stats\s*or\s*\{\}\s*$)' r'\1  # type: ignore[assignment]'

echo "⇒ Formatting & re-checking…"
poetry run ruff format . >/dev/null
poetry run ruff check . --fix >/dev/null || true

echo "⇒ mypy…"
poetry run mypy || true

echo "⇒ Done. Paste any remaining mypy lines if they persist."
