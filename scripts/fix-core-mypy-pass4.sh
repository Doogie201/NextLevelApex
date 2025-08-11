#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Pass 4: final mypy patches for core/* and utils/* …"
root="nextlevelapex"

py() { python3 - "$@"; }

patch_file() {
  local file="$1"
  shift
  py <<'PY' "$file" "$@"
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
pairs = list(zip(sys.argv[2::2], sys.argv[3::2]))

src0 = p.read_text(encoding="utf-8")
src = src0

def sub(pat, repl, flags=re.M):
    global src
    src = re.sub(pat, repl, src, flags=flags)

for pat, repl in pairs:
    sub(pat, repl)

if src != src0:
    p.write_text(src, encoding="utf-8")
    print(f"  • patched {p}")
else:
    print(f"  • no change {p}")
PY
}

ensure_imports() {
  local file="$1"; shift
  py <<'PY' "$file" "$@"
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
wants = sys.argv[2:]

src = p.read_text(encoding="utf-8")
lines = src.splitlines()

# insert after __future__ import if present, else at top
ins = 0
for i,l in enumerate(lines[:20]):
    if "__future__" in l:
        ins = i+1

added=False
for imp in wants:
    if re.search(rf"^\s*{re.escape(imp)}\s*$", src, re.M) is None:
        lines.insert(ins, imp); ins += 1; added=True

if added:
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"  • added imports in {p}")
else:
    print(f"  • imports OK in {p}")
PY
}

# ---------------- core/task.py ----------------
ensure_imports "$root/core/task.py" "from typing import Any"
patch_file "$root/core/task.py" \
  '(^\s*config\s*:\s*)dict(?!\[)' '\1dict[str, Any]' \
  '(^\s*def\s+as_dict\(\s*self\s*\)\s*->\s*)dict\s*:' '\1dict[str, Any]:' \
  '(^\s*def\s+__str__\(\s*self\s*\)\s*:)' '\1 -> str:'

# ---------------- core/registry.py ----------------
ensure_imports "$root/core/registry.py" "from typing import Any, Callable"
patch_file "$root/core/registry.py" \
  '(^\s*config\s*:\s*)dict(?!\[)' '\1dict[str, Any]' \
  '(fn\._task_name\s*=\s*name)(?!.*type:\s*ignore\[attr-defined\])' '\1  # type: ignore[attr-defined]' \
  '(^\s*def\s+clear_registry\(\s*\)\s*:)' '\1 -> None:'

# ---------------- core/report.py ----------------
ensure_imports "$root/core/report.py" "from pathlib import Path" "from typing import Any"
# Normalize the generate_report signature completely (safe canonical form).
py <<'PY'
from pathlib import Path
import re, pathlib
p = pathlib.Path("nextlevelapex/core/report.py")
s = p.read_text(encoding="utf-8").splitlines()
for i,line in enumerate(s):
    if line.strip().startswith("def generate_report("):
        s[i] = "def generate_report(state: dict[str, Any], out_dir: Path, as_html: bool = True, as_md: bool = True) -> tuple[Path | None, Path | None]:"
        break
p.write_text("\n".join(s) + "\n", encoding="utf-8")
print("  • normalized signature in nextlevelapex/core/report.py")
PY

# ---------------- core/state.py ----------------
ensure_imports "$root/core/state.py" "from typing import Any, cast"
patch_file "$root/core/state.py" \
  r'^\s*return\s+json\.load\(\s*f\s*\)\s*$' '    data = json.load(f)\n    return cast(dict[str, Any], data)' \
  r'^\s*return\s+current_hash\s*!=\s*previous_hash\s*$' '    return bool(current_hash != previous_hash)' \
  r'return\s+state\.get\("health_history",\s*\{\}\)\.get\(task,\s*\[\]\)' 'return cast(list[dict[str, Any]], state.get("health_history", {}).get(task, []))' \
  r'return\s+state\.get\("service_versions",\s*\{\}\)' 'return cast(dict[str, str], state.get("service_versions", {}))'

# ---------------- core/logger.py ----------------
ensure_imports "$root/core/logger.py" "import logging" "from typing import Any"
patch_file "$root/core/logger.py" \
  '(^\s*def\s+_get_logger\(\s*self\s*\)\s*:)' '\1 -> logging.Logger:' \
  '(^\s*def\s+__getattr__\(\s*self\s*,\s*item\s*\)\s*:)' '\1 -> Any:' \
  '(^\s*def\s+setup_logging\(\s*config:\s*dict\[str,\s*Any\],\s*verbose:\s*bool\s*=\s*False\s*\)\s*:)' '\1 -> None:' \
  'handlers:\s*list\[[^\]]*RichHandler[^\]]*\]' 'handlers: list[logging.Handler]' \
  'handlers:\s*list\[[^\]]*\]' 'handlers: list[logging.Handler]'

# ---------------- core/config.py ----------------
ensure_imports "$root/core/config.py" "from typing import Any"
patch_file "$root/core/config.py" \
  '(^\s*def\s+_deep_update\(\s*base\s*:\s*)dict(?!\[)' '\1dict[str, Any]' \
  '(^\s*def\s+_deep_update\(\s*base\s*:\s*dict\[str,\s*Any\]\s*,\s*updates\s*:\s*)dict(?!\[)' '\1dict[str, Any]' \
  '(^\s*def\s+_deep_update\([^\)]*\)\s*:)' '\1 -> None:'

# ---------------- core/command.py ----------------
ensure_imports "$root/core/command.py" "from typing import Mapping"
patch_file "$root/core/command.py" \
  '(^\s*def\s+__bool__\(\s*self\s*\)\s*:)' '\1 -> bool:' \
  r'env:\s*dict\s*\|\s*None\s*=\s*None' 'env: Mapping[str, str] | None = None' \
  r'env:\s*dict(?!\[)' 'env: Mapping[str, str]'

# ---------------- core/smartconfig.py ----------------
ensure_imports "$root/core/smartconfig.py" "from typing import Any"
patch_file "$root/core/smartconfig.py" \
  '(^\s*def\s+summary\(\s*self\s*\)\s*->\s*)dict\s*:' '\1dict[str, Any]:' \
  '(^\s*def\s+get_bloat_limits\(\s*\)\s*->\s*)dict\s*:' '\1dict[str, Any]:'

# ---------------- utils/sanitizer.py ----------------
ensure_imports "$root/utils/sanitizer.py" "from typing import Any"
patch_file "$root/utils/sanitizer.py" \
  r'^\s*def\s+trim_large_fields\(\s*d\s*:\s*dict[^\)]*\)\s*->\s*tuple\[dict,\s*dict\]\s*:' \
  'def trim_large_fields(d: dict[str, Any], path: tuple[str, ...] = (), stats: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:' \
  r'^\s*trimmed\s*=\s*\{\}\s*$' '    trimmed: dict[str, Any] = {}' \
  r'^\s*stats\s*=\s*stats\s*or\s*\{\}\s*$' '    if stats is None:\n        stats = {}' \
  r'^\s*return\s+\(trimmed,\s*stats\)\s*$' '    return (trimmed, stats)'

echo "⇒ Formatting & running checks…"
poetry run ruff check . --fix >/dev/null
poetry run mypy || true

echo "⇒ Done. Re-run: poetry run poe ci"
