# nextlevelapex/tasks/base_task.py

from collections.abc import Callable
from typing import Any


class BaseTask:
    """
    All orchestrator tasks should inherit from BaseTask for dynamic discovery.
    Implements standard run(), health_check(), and task_name() methods.
    """

    # Human-friendly unique name (override if needed)
    TASK_NAME: str = None

    def __init__(self):
        # Optionally add other runtime context as needed
        pass

    @classmethod
    def task_name(cls) -> str:
        return cls.TASK_NAME or cls.__name__

    def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """
        Run the main orchestration logic for the task.
        Returns a dict with result status/details.
        """
        raise NotImplementedError("run() must be implemented by the task.")

    def health_check(self, context: dict[str, Any]) -> dict[str, Any]:
        """
        Run health/diagnostic check for the task.
        Returns a dict: { 'status': 'PASS'|'FAIL'|'WARN', 'details': ... }
        """
        raise NotImplementedError("health_check() must be implemented by the task.")


# --- (Optional) Decorator for Function-based Tasks ---
_registered_tasks = []


def register_task(func: Callable) -> Callable:
    """
    Decorator to register function-based tasks for dynamic discovery.
    """
    _registered_tasks.append(func)
    return func


def get_registered_tasks() -> list:
    """
    Return all registered function-based tasks.
    """
    return list(_registered_tasks)
