# nextlevelapex/core/smartconfig.py

from __future__ import annotations

import threading
from typing import Any

from nextlevelapex.core.config import load_config


class SmartConfig:
    _instance: SmartConfig | None = None
    _lock = threading.Lock()

    def __new__(cls) -> SmartConfig:
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialize()
            return cls._instance

    def _initialize(self) -> None:
        config = load_config()
        script_behavior = config.get("script_behavior", {})

        # Global smart anti-bloat toggles
        self.enable_bloat_protection: bool = script_behavior.get("enable_bloat_protection", True)
        self.max_string_len: int = script_behavior.get("max_string_len", 3000)
        self.max_log_lines: int = script_behavior.get("max_log_lines", 100)
        self.max_list_items: int = script_behavior.get("max_list_items", 50)
        self.smart_bloat_profile: str = script_behavior.get(
            "smart_bloat_profile", "balanced"
        )  # minimal, aggressive

    def refresh(self) -> None:
        self._initialize()

    def summary(self) -> dict[str, Any]:
        return {
            "bloat_protection": self.enable_bloat_protection,
            "profile": self.smart_bloat_profile,
            "max_string_len": self.max_string_len,
            "max_log_lines": self.max_log_lines,
            "max_list_items": self.max_list_items,
        }

    def get_limit(self, key: str, default: int) -> int:
        return {
            "max_string_len": self.max_string_len,
            "max_log_lines": self.max_log_lines,
            "max_list_items": self.max_list_items,
        }.get(key, default)


# Global instance available across app
global_config = SmartConfig()


# Optional helper functions for convenience
def is_bloat_protection_enabled() -> bool:
    return global_config.enable_bloat_protection


def get_bloat_limits() -> dict[str, Any]:
    return global_config.summary()


def get_bloat_limit(key: str, fallback: int = 0) -> int:
    return global_config.get_limit(key, fallback)
