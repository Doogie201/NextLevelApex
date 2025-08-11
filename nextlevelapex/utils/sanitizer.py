from typing import Any

from nextlevelapex.core.logger import LoggerProxy
from nextlevelapex.core.smartconfig import (
    get_bloat_limit,
    is_bloat_protection_enabled,
)

log = LoggerProxy(__name__)


def trim_large_fields(
    d: dict[str, Any], path: tuple[Any, ...] = (), stats: dict[str, Any] | None = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    if stats is None:
        stats = {
            "fields_trimmed": 0,
            "string_fields_trimmed": 0,
            "chars_removed": 0,
            "lines_removed": 0,
            "lists_trimmed": 0,
            "total_nested_paths_touched": 0,
        }

    trimmed: dict[str, Any] = {}
    max_str_len = get_bloat_limit("max_string_len")
    max_list_items = get_bloat_limit("max_list_items")
    max_log_lines = get_bloat_limit("max_log_lines")
    bloat_guard_enabled = is_bloat_protection_enabled()

    for key, value in d.items():
        full_path = " -> ".join((*path, key))
        stats["total_nested_paths_touched"] += 1

        if isinstance(value, str):
            if bloat_guard_enabled and value.count("\n") > max_log_lines:
                lines = value.splitlines()
                stats["fields_trimmed"] += 1
                stats["string_fields_trimmed"] += 1
                stats["lines_removed"] += len(lines) - max_log_lines
                trimmed[key] = (
                    "\n".join(lines[:max_log_lines]) + f"\n... (trimmed @ {max_log_lines} lines)"
                )
                log.debug(f"BloatGuard: Trimmed string field at '{full_path}'")
            elif bloat_guard_enabled and len(value) > max_str_len:
                stats["fields_trimmed"] += 1
                stats["string_fields_trimmed"] += 1
                stats["chars_removed"] += len(value) - max_str_len
                trimmed[key] = value[:max_str_len] + f"\n... (trimmed @ {max_str_len} chars)"
                log.debug(f"BloatGuard: Trimmed multiline string at '{full_path}'")
            else:
                trimmed[key] = value

        elif isinstance(value, list):
            if bloat_guard_enabled and len(value) > max_list_items:
                stats["fields_trimmed"] += 1
                stats["lists_trimmed"] += 1
                trimmed[key] = value[:max_list_items] + ["... (list trimmed)"]
                log.debug(f"BloatGuard: Trimmed list at '{full_path}'")
            else:
                trimmed[key] = value

        elif isinstance(value, dict):
            trimmed[key], _ = trim_large_fields(value, path=(*path, key), stats=stats)
        else:
            trimmed[key] = value

    return trimmed, stats
