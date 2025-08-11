#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Patching remaining mypy issues (state/logger/command/sanitizer)…"

python3 - <<'PY'
import re
from pathlib import Path

def patch(path: Path, replacers):
    if not path.exists():
        print(f"  • skip (missing) {path}")
        return
    text = path.read_text()
    orig = text
    for desc, func in replacers:
        new = func(text)
        if new != text:
            print(f"  • {desc} in {path}")
            text = new
    if text != orig:
        path.write_text(text)
    else:
        print(f"  • no change {path}")

def ensure_imports(text: str, module: str, names: list[str]) -> str:
    """
    Ensure `from module import name1, name2` exists (idempotent).
    """
    lines = text.splitlines()
    import_line = f"from {module} import " + ", ".join(names)
    if import_line in text:
        return text
    # place after future imports / stdlib imports
    insert_at = 0
    for i, ln in enumerate(lines[:50]):
        if ln.startswith("from __future__ import"):
            insert_at = i + 1
        elif ln.strip() == "" and insert_at:
            insert_at = i + 1
    lines.insert(insert_at, import_line)
    return "\n".join(lines)

# ---------- nextlevelapex/core/state.py ----------
state_py = Path("nextlevelapex/core/state.py")
def patch_state(text: str) -> str:
    t = text
    t = ensure_imports(t, "typing", ["Any", "Dict", "List", "cast"])
    # return json.load(f)  ->  return cast(Dict[str, Any], json.load(f))
    t = re.sub(
        r"return\s+json\.load\(\s*f\s*\)",
        r"return cast(Dict[str, Any], json.load(f))",
        t,
        flags=re.M,
    )
    # return current_hash != previous_hash -> bool(...)
    t = re.sub(
        r"return\s+current_hash\s*!=\s*previous_hash",
        r"return bool(current_hash != previous_hash)",
        t,
        flags=re.M,
    )
    # get_health_history typing
    t = re.sub(
        r'return\s+state\.get\("health_history",\s*\{\}\)\.get\(\s*task\s*,\s*\[\]\s*\)',
        r'return cast(List[Dict[str, Any]], state.get("health_history", {}).get(task, []))',
        t,
        flags=re.M,
    )
    # service_versions typing
    t = re.sub(
        r'return\s+state\.get\("service_versions",\s*\{\}\)',
        r'return cast(Dict[str, str], state.get("service_versions", {}))',
        t,
        flags=re.M,
    )
    return t

# ---------- nextlevelapex/core/logger.py ----------
logger_py = Path("nextlevelapex/core/logger.py")
def patch_logger(text: str) -> str:
    t = text
    t = ensure_imports(t, "typing", ["Any", "Optional"])
    # self._logger = None  -> self._logger: Optional[logging.Logger] = None
    t = re.sub(
        r"(self\._logger\s*=\s*)None",
        r"self._logger: Optional[logging.Logger] = None",
        t,
        count=1,
    )
    # def _get_logger(self) -> logging.Logger:
    t = re.sub(
        r"def\s+_get_logger\s*\(\s*self\s*\)\s*:",
        r"def _get_logger(self) -> logging.Logger:",
        t,
    )
    # ensure assert before returning _logger to satisfy mypy
    t = re.sub(
        r"return\s+self\._logger",
        "assert self._logger is not None\n        return self._logger",
        t,
    )
    # def __getattr__(self, item) -> Any:
    t = re.sub(
        r"def\s+__getattr__\s*\(\s*self\s*,\s*item\s*\)\s*->\s*Any\s*:",
        r"def __getattr__(self, item: str) -> Any:",
        t,
    )
    # handlers: list[RichHandler] = []  -> list[logging.Handler] = []
    t = re.sub(
        r"handlers:\s*list\[[^\]]+\]\s*=\s*\[\]",
        r"handlers: list[logging.Handler] = []",
        t,
    )
    return t

# ---------- nextlevelapex/core/command.py ----------
command_py = Path("nextlevelapex/core/command.py")
def patch_command(text: str) -> str:
    t = text
    t = ensure_imports(t, "typing", ["Any", "Dict"])
    # env: dict | None = None  -> env: dict[str, str] | None = None
    t = re.sub(
        r"(,\s*env:\s*)dict\s*\|\s*None(\s*=\s*None)",
        r"\1dict[str, str] | None\2",
        t,
    )
    return t

# ---------- nextlevelapex/utils/sanitizer.py ----------
san_py = Path("nextlevelapex/utils/sanitizer.py")
def patch_sanitizer(text: str) -> str:
    t = text
    t = ensure_imports(t, "typing", ["Any", "Dict", "Tuple"])
    # robust function signature with concrete generics
    t = re.sub(
        r"def\s+trim_large_fields\s*\(\s*d:\s*dict\s*,\s*path=\(\)\s*,\s*stats=None\s*\)\s*->\s*tuple\[dict,\s*dict\]\s*:",
        r"def trim_large_fields(d: Dict[str, Any], path: tuple[Any, ...] = (), stats: Dict[str, Any] | None = None) -> tuple[Dict[str, Any], Dict[str, Any]]:",
        t,
    )
    # if signature had slightly different formatting, try a more permissive patch
    t = re.sub(
        r"def\s+trim_large_fields\s*\(\s*d:\s*dict[^\)]*\)\s*->\s*tuple\[dict,\s*dict\]\s*:",
        r"def trim_large_fields(d: Dict[str, Any], path: tuple[Any, ...] = (), stats: Dict[str, Any] | None = None) -> tuple[Dict[str, Any], Dict[str, Any]]:",
        t,
    )
    # ensure trimmed is typed as Dict[str, Any]
    t = re.sub(
        r"trimmed:\s*dict\[.*?\]",
        r"trimmed: Dict[str, Any]",
        t,
    )
    # if trimmed not declared, ensure an annotation on assignment
    t = re.sub(
        r"\btrimmed\s*=\s*\{\}",
        r"trimmed: Dict[str, Any] = {}",
        t,
    )
    return t

patch(state_py, [
    ("cast returns & add imports", patch_state),
])

patch(logger_py, [
    ("fix Optional logger & typing", patch_logger),
])

patch(command_py, [
    ("narrow env typing", patch_command),
])

patch(san_py, [
    ("harden sanitizer typing", patch_sanitizer),
])
PY

echo "⇒ Formatting & running checks…"
poetry run ruff check . --fix || true
poetry run mypy || true

echo "⇒ Done. If a couple mypy lines remain, paste them and I’ll give you the tiny follow-up patches."
