# nextlevelapex/core/task.py

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Tuple, TypedDict


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
