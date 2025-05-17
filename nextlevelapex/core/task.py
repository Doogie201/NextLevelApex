# nextlevelapex/core/task.py

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, TypedDict


class TaskContext(TypedDict):
    """Runtime context passed to every task function."""

    config: Dict
    dry_run: bool
    verbose: bool


class Severity(Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


@dataclass
class TaskResult:
    name: str
    success: bool
    changed: bool = False
    messages: List[Tuple[Severity, str]] = field(default_factory=list)
    details: Optional[Any] = (
        None  # Flexible detail container for task-specific metadata
    )

    def as_dict(self) -> Dict:
        return {
            "name": self.name,
            "success": self.success,
            "changed": self.changed,
            "messages": [(sev.value, msg) for sev, msg in self.messages],
            "details": self.details.__dict__ if self.details else None,
        }

    def __str__(self):
        status = "✔️" if self.success else "❌"
        return f"[{status}] {self.name}: {self.messages[-1][1] if self.messages else 'No message'}"
