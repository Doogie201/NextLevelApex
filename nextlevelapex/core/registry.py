# nextlevelapex/core/registry.py

from typing import Callable, Dict, TypedDict

from nextlevelapex.core.task import TaskResult


class TaskContext(TypedDict):
    config: dict
    dry_run: bool
    verbose: bool


TaskFunc = Callable[[TaskContext], TaskResult]
_TASK_REGISTRY: Dict[str, TaskFunc] = {}


def task(name: str) -> Callable[[TaskFunc], TaskFunc]:
    """
    Decorator to register a task with a name and attach metadata.
    """

    def _decorator(fn: TaskFunc) -> TaskFunc:
        if name in _TASK_REGISTRY:
            raise RuntimeError(f"Duplicate task name: {name}")

        setattr(fn, "_task_name", name)  # 🔥 Use setattr for reliability
        _TASK_REGISTRY[name] = fn
        return fn

    return _decorator


def get_task_registry() -> Dict[str, TaskFunc]:
    return dict(_TASK_REGISTRY)


def clear_registry():
    _TASK_REGISTRY.clear()
