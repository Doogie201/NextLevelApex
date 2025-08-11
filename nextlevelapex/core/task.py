# nextlevelapex/core/task.py
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, TypedDict


class TaskContext(TypedDict):
    """Runtime context passed to every task function."""

    config: dict[str, Any]
    dry_run: bool
    verbose: bool


class Severity(Enum):
    """
    Represents the severity levels for logging or messaging.

    Provides a mapping between severity levels and their corresponding
    logger method names.
    """

    DEBUG = "debug"
    HINT = "hint"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"

    def log_method(self) -> str:
        """
        Determine the appropriate logger method name based on the severity level.

        Returns:
            str: The logger method name corresponding to the severity level.
        """
        # Map our enum to logger method names
        if self in (Severity.INFO, Severity.HINT):
            return "info"
        return self.value


@dataclass
class TaskResult:
    name: str
    success: bool
    changed: bool = False
    messages: list[tuple[Severity, str]] = field(
        default_factory=list
    )  # Using built-in list and tuple
    details: Any | None = None  # Flexible detail container for task-specific metadata

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "success": self.success,
            "changed": self.changed,
            "messages": [(sev.value, msg) for sev, msg in self.messages],
            "details": self.details.__dict__ if self.details else None,
        }

    def __str__(self) -> str:
        status = "✔️" if self.success else "❌"
        return f"[{status}] {self.name}: {self.messages[-1][1] if self.messages else 'No message'}"
