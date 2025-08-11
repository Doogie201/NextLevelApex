#!/usr/bin/env bash
set -euo pipefail

echo "⇒ Ensuring repo root…"
test -f pyproject.toml || { echo "Run from project root"; exit 1; }

COVRC=".coveragerc"
echo "⇒ Writing/merging $COVRC (idempotent)…"
python3 - <<'PY'
from pathlib import Path
import configparser

p = Path(".coveragerc")
cfg = configparser.ConfigParser()
if p.exists():
    cfg.read(p)

if "run" not in cfg: cfg["run"] = {}
cfg["run"]["branch"] = "True"

omit = set(x.strip() for x in cfg["run"].get("omit","").splitlines() if x.strip())
omit.update({
    "nextlevelapex/main.py",
    "nextlevelapex/tasks/*",
    "nextlevelapex/core/logger.py",
})
cfg["run"]["omit"] = "\n\t" + "\n\t".join(sorted(omit)) + "\n"

if "report" not in cfg: cfg["report"] = {}
ex = set(x.strip() for x in cfg["report"].get("exclude_lines","").splitlines() if x.strip())
ex.update({
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "if __name__ == .__main__.:",
})
cfg["report"]["exclude_lines"] = "\n\t" + "\n\t".join(sorted(ex)) + "\n"

with p.open("w") as f:
    cfg.write(f)
print("  • run/omit + report/exclude_lines ensured")
PY

echo "⇒ Ensuring pytest uses .coveragerc via pyproject (idempotent)…"
python3 - <<'PY'
from pathlib import Path
import re

pp = Path("pyproject.toml")
s = pp.read_text()

# Ensure [tool.pytest.ini_options] section exists
if "[tool.pytest.ini_options]" not in s:
    s += "\n[tool.pytest.ini_options]\naddopts = \"\"\n"

# Add --cov-config=.coveragerc to addopts if missing
s = re.sub(
    r'(\[tool\.pytest\.ini_options\][^\[]*?addopts\s*=\s*")([^"]*)(")',
    lambda m: m.group(1) + (
        m.group(2) if "--cov-config=.coveragerc" in m.group(2)
        else (m.group(2) + " --cov-config=.coveragerc")
    ) + m.group(3),
    s,
    flags=re.S
)

pp.write_text(s)
print("  • addopts updated")
PY

echo "⇒ Lint & typecheck…"
poetry run ruff check . --fix
poetry run mypy

echo "⇒ Full CI…"
poetry run poe ci
