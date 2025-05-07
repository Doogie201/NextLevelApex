from dataclasses import dataclass
from enum import Enum


class Severity(Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


@dataclass
class TaskResult:
    name: str
    success: bool
    changed: bool = False
    messages: list[tuple[Severity, str]] = None
