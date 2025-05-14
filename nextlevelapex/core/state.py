# ~/Projects/NextLevelApex/nextlevelapex/core/state.py

import json
import logging
from pathlib import Path
from typing import Any, Dict

from nextlevelapex.core.logger import LoggerProxy

log = LoggerProxy(__name__)

STATE_SCHEMA_VERSION = "1.0"

DEFAULT_STATE: Dict[str, Any] = {
    "version": STATE_SCHEMA_VERSION,
    "last_run_status": "UNKNOWN",  # Possible values: SUCCESS, FAILED, INCOMPLETE
    "completed_sections": [],
    "failed_section": None,
}


def load_state(path: Path) -> Dict[str, Any]:
    log.info(f"Loading state from {path}")
    if not path.exists():
        log.warning("No state file found. Using default state.")
        return DEFAULT_STATE.copy()

    try:
        with path.open("r") as f:
            data = json.load(f)

        if "completed_sections" not in data:
            log.warning(
                "Invalid state file. Missing 'completed_sections'. Resetting state."
            )
            return DEFAULT_STATE.copy()

        log.info("State loaded successfully.")
        return data
    except json.JSONDecodeError as e:
        log.error(f"Failed to parse state JSON: {e}")
    except Exception as e:
        log.exception(f"Unexpected error loading state: {e}")

    return DEFAULT_STATE.copy()


def save_state(data: Dict[str, Any], path: Path, dry_run: bool = False) -> bool:
    log.info(f"Saving state to {path}")
    if dry_run:
        log.info("DRYRUN: Would write state:")
        print(json.dumps(data, indent=2))
        return True

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w") as f:
            json.dump(data, f, indent=4)
        log.info("State saved successfully.")
        return True
    except Exception as e:
        log.exception(f"Failed to write state: {e}")
        return False


def mark_section_complete(name: str, data: Dict[str, Any]) -> None:
    sections = set(data.get("completed_sections", []))
    if name not in sections:
        sections.add(name)
        data["completed_sections"] = sorted(sections)
        data["failed_section"] = None
        log.debug(f"Section marked complete: {name}")
    else:
        log.debug(f"Section already complete: {name}")


def is_section_complete(name: str, data: Dict[str, Any]) -> bool:
    result = name in data.get("completed_sections", [])
    log.debug(f"Is section '{name}' complete? {result}")
    return result


def mark_run_failed(section: str, data: Dict[str, Any]) -> None:
    data["last_run_status"] = "FAILED"
    data["failed_section"] = section
    log.debug(f"Run marked as FAILED at: {section}")


def mark_run_success(data: Dict[str, Any]) -> None:
    data["last_run_status"] = "SUCCESS"
    data["failed_section"] = None
    log.debug("Run marked as SUCCESS")


def reset_section_state(name: str, data: Dict[str, Any]) -> None:
    sections = set(data.get("completed_sections", []))
    if name in sections:
        sections.remove(name)
        data["completed_sections"] = sorted(sections)
        log.info(f"Section reset: {name}")
    if data.get("failed_section") == name:
        data["failed_section"] = None


def reset_all_state(data: Dict[str, Any]) -> None:
    log.info("Resetting all state to defaults.")
    data.update(
        {
            "last_run_status": DEFAULT_STATE["last_run_status"],
            "completed_sections": [],
            "failed_section": None,
        }
    )
