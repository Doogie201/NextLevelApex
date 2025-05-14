# nextlevelapex/core/task.py

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Tuple


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
