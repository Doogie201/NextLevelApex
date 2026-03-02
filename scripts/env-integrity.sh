#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="${1:-check}"

GENERATED_DIRS=(
  ".venv"
  "dashboard/node_modules"
  "dashboard/.next"
)

SOURCE_METADATA_GLOBS=(
  "--hidden"
  "-g" "._*"
  "-g" "!.git/**"
  "-g" "!artifacts/**"
  "-g" "!.agent_state/**"
  "-g" "!dashboard/node_modules/**"
  "-g" "!dashboard/.next/**"
  "-g" "!.venv/**"
)

count_appledouble() {
  local rel_dir="$1"
  local abs_dir="$REPO_ROOT/$rel_dir"

  if [[ ! -d "$abs_dir" ]]; then
    echo "0"
    return 0
  fi

  find "$abs_dir" -type f -name '._*' 2>/dev/null | wc -l | tr -d ' '
}

first_appledouble() {
  local rel_dir="$1"
  local abs_dir="$REPO_ROOT/$rel_dir"

  if [[ ! -d "$abs_dir" ]]; then
    return 0
  fi

  find "$abs_dir" -type f -name '._*' -print -quit 2>/dev/null || true
}

scrub_appledouble() {
  local rel_dir="$1"
  local abs_dir="$REPO_ROOT/$rel_dir"

  if [[ ! -d "$abs_dir" ]]; then
    echo "[env-integrity] skip scrub: $rel_dir (missing)"
    return 0
  fi

  local before_count
  before_count="$(count_appledouble "$rel_dir")"
  if [[ "$before_count" == "0" ]]; then
    echo "[env-integrity] scrub: $rel_dir clean"
    return 0
  fi

  find "$abs_dir" -type f -name '._*' -delete 2>/dev/null
  local after_count
  after_count="$(count_appledouble "$rel_dir")"
  local removed_count=$(( before_count - after_count ))
  echo "[env-integrity] scrub: $rel_dir removed=$removed_count remaining=$after_count"
}

check_venv_startup() {
  if ! (cd "$REPO_ROOT" && ./.venv/bin/python -I -W ignore -c 'import sys; print(sys.prefix)' >/dev/null 2>&1); then
    echo "[env-integrity] failure: .venv isolated Python startup failed"
    return 1
  fi

  return 0
}

check_poetry_runtime() {
  if ! (cd "$REPO_ROOT" && poetry run python -I -W ignore -c 'import pydantic, typer' >/dev/null 2>&1); then
    echo "[env-integrity] failure: Poetry runtime smoke failed (pydantic/typer import)."
    return 1
  fi

  return 0
}

check_repo_metadata() {
  local first_match=""
  if ! first_match="$(cd "$REPO_ROOT" && rg --files "${SOURCE_METADATA_GLOBS[@]}" | head -n 1)"; then
    first_match=""
  fi
  if [[ -n "$first_match" ]]; then
    echo "[env-integrity] failure: AppleDouble metadata detected in active source scope (example: $first_match)"
    return 1
  fi

  echo "[env-integrity] check: active source scope clean"
  return 0
}

scrub_repo_metadata() {
  local matches=""
  if ! matches="$(cd "$REPO_ROOT" && rg --files "${SOURCE_METADATA_GLOBS[@]}")"; then
    matches=""
  fi
  if [[ -z "$matches" ]]; then
    echo "[env-integrity] scrub: active source scope clean"
    return 0
  fi

  local removed=0
  while IFS= read -r rel_path; do
    [[ -z "$rel_path" ]] && continue
    rm -f "$REPO_ROOT/$rel_path"
    removed=$((removed + 1))
  done <<< "$matches"
  echo "[env-integrity] scrub: active source scope removed=$removed"
}

run_check() {
  local status=0

  for rel_dir in "${GENERATED_DIRS[@]}"; do
    local first_match
    first_match="$(first_appledouble "$rel_dir")"
    if [[ -n "$first_match" ]]; then
      local rel_path="${first_match#"$REPO_ROOT"/}"
      if [[ "$rel_dir" == ".venv" ]]; then
        echo "[env-integrity] failure: AppleDouble metadata detected under $rel_dir (example: $rel_path)"
        status=1
      else
        echo "[env-integrity] warning: AppleDouble metadata detected under $rel_dir (example: $rel_path)"
      fi
    else
      echo "[env-integrity] check: $rel_dir clean"
    fi
  done

  if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
    if ! check_venv_startup; then
      status=1
    else
      echo "[env-integrity] check: .venv isolated startup ok"
    fi
  else
    echo "[env-integrity] check: .venv/bin/python missing (ok: using Poetry-managed env)"
  fi

  if ! check_poetry_runtime; then
    status=1
  else
    echo "[env-integrity] check: poetry runtime smoke ok"
  fi

  if ! check_repo_metadata; then
    status=1
  fi

  return "$status"
}

run_scrub() {
  for rel_dir in "${GENERATED_DIRS[@]}"; do
    scrub_appledouble "$rel_dir"
  done
  scrub_repo_metadata
}

case "$MODE" in
  check)
    run_check
    ;;
  scrub)
    run_scrub
    ;;
  *)
    echo "usage: scripts/env-integrity.sh [check|scrub]" >&2
    exit 2
    ;;
esac
