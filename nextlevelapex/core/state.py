# nextlevelapex/core/state.py
import hashlib
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, cast

from pydantic import BaseModel, Field, ValidationError

STATE_SCHEMA_VERSION = "2.0"

DEFAULT_STATE: dict[str, Any] = {
    "version": STATE_SCHEMA_VERSION,
    "last_run_status": "UNKNOWN",  # Possible: SUCCESS, FAILED, INCOMPLETE
    "completed_sections": [],
    "failed_sections": [],
    "task_status": {},  # e.g., { "dns_stack": {"status": "SUCCESS", "last_healthy": "..."} }
    "file_hashes": {},  # e.g., { "/path/to/file": "sha256:..." }
    "health_history": {},  # e.g., { "dns_stack": [ { "timestamp": "...", "status": "PASS", ... }, ... ] }
    "service_versions": {},  # e.g., { "docker": "24.0.7", ... }
    "last_report_path": None,
}

STATE_HISTORY_DEPTH = 10  # How many historic health results to store


class TaskStatus(BaseModel):
    status: str
    last_update: str | None = None
    last_healthy: str | None = None


class HealthEntry(BaseModel):
    timestamp: str
    status: str
    message: str | None = None
    error: str | None = None
    explanation: str | None = None
    model_config = {"extra": "allow"}


class StateSchema(BaseModel):
    version: str = STATE_SCHEMA_VERSION
    last_run_status: str = "UNKNOWN"
    completed_sections: list[str] = Field(default_factory=list)
    failed_sections: list[str] = Field(default_factory=list)
    task_status: dict[str, TaskStatus] = Field(default_factory=dict)
    file_hashes: dict[str, str] = Field(default_factory=dict)
    health_history: dict[str, list[HealthEntry]] = Field(default_factory=dict)
    service_versions: dict[str, str] = Field(default_factory=dict)
    last_report_path: str | None = None


def _safe_json_load(path: Path) -> dict[str, Any]:
    try:
        with path.open("r") as f:
            return cast(dict[str, Any], json.load(f))
    except Exception:
        return {}


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return DEFAULT_STATE.copy()
    data = _safe_json_load(path)
    merged = DEFAULT_STATE.copy()
    merged.update(data)

    try:
        # Strict validation against schema to prevent payload injection
        validated = StateSchema.model_validate(merged)
        return validated.model_dump()
    except ValidationError as e:
        logging.warning(
            f"State file failed validation (potential poisoning). Resetting. Error: {e}"
        )
        return DEFAULT_STATE.copy()


def save_state(data: dict[str, Any], path: Path, dry_run: bool = False) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if dry_run:
            print("[DRYRUN] Would write state:", json.dumps(data, indent=2))
            return True

        import os

        # Safely create or truncate the file with strict permissions (0o600)
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        mode = 0o600
        with open(os.open(path, flags, mode), "w") as f:
            json.dump(data, f, indent=2)

        # Guarantee permissions in case the file already existed with wider permissions
        path.chmod(0o600)
        return True
    except Exception as e:
        logging.exception(f"Failed to write state: {e}")
        return False


def hash_file(path: Path) -> str | None:
    if not path.exists() or not path.is_file():
        return None
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            buf = f.read(4096)
            if not buf:
                break
            hasher.update(buf)
    return "sha256:" + hasher.hexdigest()


def update_file_hashes(state: dict[str, Any], files: list[Path]) -> dict[str, Any]:
    hashes = {}
    for file in files:
        file_hash = hash_file(file)
        if file_hash:
            hashes[str(file)] = file_hash
    state["file_hashes"] = hashes
    return state


def file_hash_changed(state: dict[str, Any], file: Path) -> bool:
    current_hash = hash_file(file)
    previous_hash = state["file_hashes"].get(str(file))
    return bool(current_hash != previous_hash)


def mark_section_complete(section: str, state: dict[str, Any]) -> None:
    sections = set(state.get("completed_sections", []))
    if section not in sections:
        sections.add(section)
        state["completed_sections"] = list(sections)
    # Remove from failed_sections if previously failed
    state["failed_sections"] = [s for s in state.get("failed_sections", []) if s != section]


def mark_section_failed(section: str, state: dict[str, Any]) -> None:
    failed = set(state.get("failed_sections", []))
    failed.add(section)
    state["failed_sections"] = list(failed)
    # Remove from completed if previously complete
    state["completed_sections"] = [s for s in state.get("completed_sections", []) if s != section]


def update_task_health(
    task: str,
    status: str,
    details: dict[str, Any] | None = None,
    state: dict[str, Any] | None = None,
) -> None:
    now = datetime.utcnow().isoformat()
    if state is None:
        return
    if "health_history" not in state:
        state["health_history"] = {}
    if task not in state["health_history"]:
        state["health_history"][task] = []
    history = state["health_history"][task]
    entry = {"timestamp": now, "status": status}
    if details:
        entry.update(details)
    history.append(entry)
    # Keep only last N results
    state["health_history"][task] = history[-STATE_HISTORY_DEPTH:]
    # Set per-task status/last healthy
    if "task_status" not in state:
        state["task_status"] = {}
    state["task_status"][task] = {"status": status, "last_update": now}
    if status == "PASS":
        state["task_status"][task]["last_healthy"] = now


def get_task_health_trend(task: str, state: dict[str, Any]) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], state.get("health_history", {}).get(task, []))


def clear_section_on_failed_health(state: dict[str, Any], section: str) -> None:
    # If health failed, clear section complete to trigger re-run
    mark_section_failed(section, state)


def update_service_versions(state: dict[str, Any], versions: dict[str, str]) -> None:
    state["service_versions"] = versions


def get_service_versions(state: dict[str, Any]) -> dict[str, str]:
    return cast(dict[str, str], state.get("service_versions", {}))


def set_last_report_path(state: dict[str, Any], path: str) -> None:
    state["last_report_path"] = path
