#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Fixing core typing issues (idempotent)…"

root="nextlevelapex"
py() { python3 - "$@"; }

# --- helper: apply a Python-powered regex patch to a file ---
patch() {
  local file="$1"; shift
  py <<'PY' "$file" "$@"
import io, os, re, sys, textwrap
path = sys.argv[1]
pairs = sys.argv[2:]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()
orig = src
for i in range(0, len(pairs), 2):
    pat = re.compile(pairs[i], re.M)
    repl = pairs[i+1]
    src = pat.sub(repl, src)
if src != orig:
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"  • patched {os.path.relpath(path)}")
else:
    print(f"  • no change {os.path.relpath(path)}")
PY
}

# --- helper: ensure imports exist ---
ensure_imports() {
  local file="$1"; shift
  py <<'PY' "$file" "$@"
import sys, re
path = sys.argv[1]
imports = sys.argv[2:]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()
added = False
def has(line): return re.search(rf"^\s*{re.escape(line)}\s*$", src, re.M)
lines = src.splitlines()
insert_at = 0
# keep future import at very top if present
for i,l in enumerate(lines[:5]):
    if "__future__" in l:
        insert_at = i+1
for imp in imports:
    if not has(imp):
        lines.insert(insert_at, imp)
        insert_at += 1
        added = True
if added:
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + ("\n" if not lines[-1].endswith("\n") else ""))
    print(f"  • added imports in {path}")
else:
    print(f"  • imports OK in {path}")
PY
}

# 1) core/task.py — precise type params and annotations
ensure_imports "$root/core/task.py" "from typing import Any"
patch "$root/core/task.py" \
  r'\bconfig:\s*dict\b' 'config: dict[str, Any]' \
  r'def\s+as_dict\(\s*self\s*\)\s*->\s*dict\s*:' 'def as_dict(self) -> dict[str, Any]:' \
  r'def\s+__str__\(\s*self\s*\)\s*:' 'def __str__(self) -> str:'

# 2) core/registry.py — type params, ignore on dynamic attribute, return type
ensure_imports "$root/core/registry.py" "from typing import Any, Callable, Dict"
patch "$root/core/registry.py" \
  r'\bconfig:\s*dict\b' 'config: dict[str, Any]' \
  r'(fn\._task_name\s*=\s*name)(\s*)$' r'\1  # type: ignore[attr-defined]\2' \
  r'def\s+clear_registry\(\s*\):' 'def clear_registry() -> None:'

# 3) core/report.py — return type + bool params
ensure_imports "$root/core/report.py" "from typing import Any" "from pathlib import Path"
patch "$root/core/report.py" \
  r'def\s+generate_report\(' \
  'def generate_report(state: dict[str, Any], out_dir: Path, as_html: bool = True, as_md: bool = True) -> tuple[Path | None, Path | None]:'

# 4) core/state.py — casts and bool, plus imports
ensure_imports "$root/core/state.py" "from typing import Any, cast"
# json.load cast
patch "$root/core/state.py" \
  r'return\s+json\.load\(\s*f\s*\)' 'data = json.load(f)\n        return cast(dict[str, Any], data)'
# bool return
patch "$root/core/state.py" \
  r'return\s+current_hash\s*!=\s*previous_hash' 'return bool(current_hash != previous_hash)'
# history cast
patch "$root/core/state.py" \
  r'return\s+state\.get\("health_history",\s*\{\}\)\.get\(task,\s*\[\]\)' \
  'return cast(list[dict[str, Any]], state.get("health_history", {}).get(task, []))'
# versions cast
patch "$root/core/state.py" \
  r'return\s+state\.get\("service_versions",\s*\{\}\)' \
  'return cast(dict[str, str], state.get("service_versions", {}))'

# 5) core/logger.py — function annotations and handler type
ensure_imports "$root/core/logger.py" "from typing import Any" "import logging"
patch "$root/core/logger.py" \
  r'def\s+_get_logger\(\s*self\s*\):' 'def _get_logger(self) -> logging.Logger:' \
  r'def\s+__getattr__\(\s*self\s*,\s*item\s*\):' 'def __getattr__(self, item: str) -> Any:' \
  r'def\s+setup_logging\(\s*config:\s*dict\[str,\s*Any\],\s*verbose:\s*bool\s*=\s*False\s*\):' \
  'def setup_logging(config: dict[str, Any], verbose: bool = False) -> None:' \
  r'handlers:\s*list\[.*?\]' 'handlers: list[logging.Handler]'

# 6) core/config.py — deep_update type params
ensure_imports "$root/core/config.py" "from typing import Any"
patch "$root/core/config.py" \
  r'def\s+_deep_update\(\s*base:\s*dict\s*,\s*updates:\s*dict\s*\):' \
  'def _deep_update(base: dict[str, Any], updates: dict[str, Any]) -> None:'

# 7) core/command.py — __bool__ and env type params
ensure_imports "$root/core/command.py" "from typing import Any, Mapping"
patch "$root/core/command.py" \
  r'def\s+__bool__\(\s*self\s*\):' 'def __bool__(self) -> bool:' \
  r'env:\s*dict\s*\|\s*None\s*=\s*None' 'env: dict[str, str] | None = None'

# 8) core/smartconfig.py — looser return types
ensure_imports "$root/core/smartconfig.py" "from typing import Any"
patch "$root/core/smartconfig.py" \
  r'def\s+summary\(\s*self\s*\)\s*->\s*dict\s*:' 'def summary(self) -> dict[str, Any]:' \
  r'def\s+get_bloat_limits\(\s*\)\s*->\s*dict\s*:' 'def get_bloat_limits() -> dict[str, Any]:'

# 9) utils/sanitizer.py — full typing and consistent internal types
ensure_imports "$root/utils/sanitizer.py" "from typing import Any, Tuple"
patch "$root/utils/sanitizer.py" \
  r'def\s+trim_large_fields\(\s*d:\s*dict.*\):' \
  'def trim_large_fields(d: dict[str, Any], path: tuple[str, ...] = (), stats: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:' \
  r'^\s*trimmed\s*=\s*\{\}' '    trimmed: dict[str, Any] = {}' \
  r'^\s*stats\s*=\s*stats\s*or\s*\{\}' '    stats = stats or {}  # type: ignore[assignment]'

# In sanitizer, some assignments inferred as str earlier; help mypy by hinting dict[str, Any]
# Also normalize a couple of common lines if present
patch "$root/utils/sanitizer.py" \
  r'trimmed\[key\]\s*=\s*value\[:max_list_items\]\s*\+\s*\[\"\.{3} \(list trimmed\)\"\]' \
  'trimmed[key] = value[:max_list_items] + ["... (list trimmed)"]' \
  r'trimmed\[key\]\s*=\s*value\s*$' \
  'trimmed[key] = value' \
  r'trimmed\[key\],\s*_\s*=\s*trim_large_fields\(' \
  'trimmed[key], _ = trim_large_fields('

echo "⇒ Formatting…"
poetry run ruff format . >/dev/null
poetry run ruff check . --fix >/dev/null || true

echo "⇒ Running mypy…"
poetry run mypy || true

echo "⇒ Done. If a couple of mypy errors remain, paste them and I’ll give a tiny patch."
