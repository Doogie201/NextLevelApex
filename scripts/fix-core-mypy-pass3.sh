#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Final pass: patching mypy type issues in core/* and utils/* …"
root="nextlevelapex"

py() { python3 - "$@"; }

apply_patch() {
  local file="$1"
  shift
  py <<'PY' "$file" "$@"
import re, sys, pathlib, typing

path = pathlib.Path(sys.argv[1])
pairs = sys.argv[2:]

src0 = path.read_text(encoding="utf-8")
src = src0

def sub(pat, repl):
    global src
    src = re.sub(pat, repl, src, flags=re.M)

for i in range(0, len(pairs), 2):
    sub(pairs[i], pairs[i+1])

if src != src0:
    path.write_text(src, encoding="utf-8")
    print(f"  • patched {path}")
else:
    print(f"  • no change {path}")
PY
}

ensure_imports() {
  local file="$1"; shift
  py <<'PY' "$file" "$@"
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
want = sys.argv[2:]

src = p.read_text(encoding="utf-8")
lines = src.splitlines()

# insert after __future__ import if present, else after shebang/docstring
ins = 0
for i,l in enumerate(lines[:15]):
    if "__future__" in l:
        ins = i+1

added = False
for imp in want:
    pat = rf"^\s*{imp}\s*$"
    if re.search(pat, src, re.M) is None:
        lines.insert(ins, imp); ins += 1; added = True

if added:
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"  • added imports in {p}")
else:
    print(f"  • imports OK in {p}")
PY
}

# ---------- core/task.py ----------
ensure_imports "$root/core/task.py" "from typing import Any"
apply_patch "$root/core/task.py" \
  r'(^\s*config\s*:\s*)dict(?!\[)' r'\1dict[str, Any]' \
  r'(^\s*def\s+as_dict\(\s*self\s*\)\s*->\s*)dict\s*:' r'\1dict[str, Any]:' \
  r'(^\s*def\s+__str__\(\s*self\s*\)\s*:)' r'\1 -> str:'

# ---------- core/registry.py ----------
ensure_imports "$root/core/registry.py" "from typing import Any, Callable, Dict"
apply_patch "$root/core/registry.py" \
  r'(^\s*config\s*:\s*)dict(?!\[)' r'\1dict[str, Any]' \
  r'(fn\._task_name\s*=\s*name)(?!.*type:\s*ignore\[attr-defined\])' r'\1  # type: ignore[attr-defined]' \
  r'(^\s*def\s+clear_registry\(\s*\)\s*:)' r'\1 -> None:'

# ---------- core/report.py ----------
ensure_imports "$root/core/report.py" "from typing import Any" "from pathlib import Path"
apply_patch "$root/core/report.py" \
  r'^\s*def\s+generate_report\s*\(\s*state\s*:\s*dict\[str,\s*Any\]\s*,\s*out_dir\s*:\s*Path\s*(?:,\s*as_html[^)]*)?\)\s*:' \
  'def generate_report(state: dict[str, Any], out_dir: Path, as_html: bool = True, as_md: bool = True) -> tuple[Path | None, Path | None]:' \
  r'^\s*def\s+generate_report\s*\(\s*state\s*,\s*out_dir\s*,\s*as_html\s*=\s*True\s*,\s*as_md\s*=\s*True\s*\)\s*:' \
  'def generate_report(state: dict[str, Any], out_dir: Path, as_html: bool = True, as_md: bool = True) -> tuple[Path | None, Path | None]:'

# ---------- core/state.py ----------
ensure_imports "$root/core/state.py" "from typing import Any, cast"
apply_patch "$root/core/state.py" \
  r'^\s*return\s+json\.load\(\s*f\s*\)\s*$' '    data = json.load(f)\n    return cast(dict[str, Any], data)' \
  r'^\s*return\s+current_hash\s*!=\s*previous_hash\s*$' '    return bool(current_hash != previous_hash)' \
  r'return\s+state\.get\("health_history",\s*\{\}\)\.get\(task,\s*\[\]\)' \
  'return cast(list[dict[str, Any]], state.get("health_history", {}).get(task, []))' \
  r'return\s+state\.get\("service_versions",\s*\{\}\)' \
  'return cast(dict[str, str], state.get("service_versions", {}))'

# ---------- core/logger.py ----------
ensure_imports "$root/core/logger.py" "import logging" "from typing import Any"
apply_patch "$root/core/logger.py" \
  r'(^\s*def\s+_get_logger\(\s*self\s*\)\s*:)' r'\1 -> logging.Logger:' \
  r'(^\s*def\s+__getattr__\(\s*self\s*,\s*item\s*\)\s*:)' r'\1 -> Any:' \
  r'(^\s*def\s+setup_logging\(\s*config:\s*dict\[str,\s*Any\],\s*verbose:\s*bool\s*=\s*False\s*\)\s*:)' r'\1 -> None:' \
  r'handlers:\s*list\[[^\]]*RichHandler[^\]]*\]' 'handlers: list[logging.Handler]' \
  r'handlers:\s*list\[[^\]]*\]' 'handlers: list[logging.Handler]'

# ---------- core/config.py ----------
ensure_imports "$root/core/config.py" "from typing import Any"
apply_patch "$root/core/config.py" \
  r'^\s*def\s+_deep_update\(\s*base\s*:\s*dict\s*,\s*updates\s*:\s*dict\s*\)\s*:' \
  'def _deep_update(base: dict[str, Any], updates: dict[str, Any]) -> None:'

# ---------- core/command.py ----------
ensure_imports "$root/core/command.py" "from typing import Any, Mapping"
apply_patch "$root/core/command.py" \
  r'(^\s*def\s+__bool__\(\s*self\s*\)\s*:)' r'\1 -> bool:' \
  r'env:\s*dict\s*\|\s*None\s*=\s*None' 'env: Mapping[str, str] | None = None' \
  r'env:\s*dict(?!\[)' 'env: Mapping[str, str]'

# ---------- core/smartconfig.py ----------
ensure_imports "$root/core/smartconfig.py" "from typing import Any"
apply_patch "$root/core/smartconfig.py" \
  r'(^\s*def\s+summary\(\s*self\s*\)\s*->\s*)dict\s*:' r'\1dict[str, Any]:' \
  r'(^\s*def\s+get_bloat_limits\(\s*\)\s*->\s*)dict\s*:' r'\1dict[str, Any]:'

# ---------- utils/sanitizer.py ----------
ensure_imports "$root/utils/sanitizer.py" "from typing import Any, cast"
apply_patch "$root/utils/sanitizer.py" \
  r'^\s*def\s+trim_large_fields\(\s*d:\s*dict\s*,\s*path\s*=\s*\(\)\s*,\s*stats\s*=\s*None\s*\)\s*->\s*tuple\[dict,\s*dict\]\s*:' \
  'def trim_large_fields(d: dict[str, Any], path: tuple[str, ...] = (), stats: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:' \
  r'^\s*trimmed\s*=\s*\{\}\s*$' '    trimmed: dict[str, Any] = {}' \
  r'^\s*stats\s*=\s*stats\s*or\s*\{\}\s*$' '    if stats is None:\n        stats = {}' \
  r'^\s*return\s+\(trimmed,\s*stats\)\s+if\s+path\s*==\s*\(\)\s+else\s+\(trimmed,\s*stats\)\s*$' '    return (trimmed, stats)'

echo "⇒ Formatting & re-running checks…"
poetry run ruff format . >/dev/null || true
poetry run ruff check . --fix >/dev/null || true
poetry run mypy || true

echo "⇒ Done. If a couple of mypy lines remain, paste them and we’ll patch those surgically."
