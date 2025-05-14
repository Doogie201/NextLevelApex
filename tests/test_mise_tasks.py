import pytest

from nextlevelapex.core.registry import task
from nextlevelapex.main import get_task_registry

# Import the wrapper you created in mise.py
from nextlevelapex.tasks.mise import setup_mise_globals_task


class DummyCtx(dict):
    def __init__(self, dry_run=True):
        super().__init__()
        self["dry_run"] = dry_run
        self["config"] = {}


def test_mise_task_in_registry():
    task_registry = get_task_registry()
    names = [
        task_registry[name]._task_name for name in task_registry
    ]  # Access _task_name via the key
    assert "Mise Globals" in names


def test_mise_task_behavior(monkeypatch):
    from nextlevelapex.core.task import Severity, TaskResult

    # Dummy context to mimic real run
    class DummyCtx(dict):
        def __init__(self, dry_run):
            super().__init__()
            self["dry_run"] = dry_run
            self["config"] = {
                "developer_tools": {"mise": {"global_tools": {"python": "3.11.9"}}}
            }

    # Force the underlying function to succeed/fail
    monkeypatch.setattr(
        "nextlevelapex.tasks.mise.setup_mise_globals",
        lambda tools, dry_run: True,
    )

    ctx = DummyCtx(dry_run=False)
    result: TaskResult = setup_mise_globals_task(ctx)
    assert result.success is True
    assert result.changed is True

    # Now simulate failure
    monkeypatch.setattr(
        "nextlevelapex.tasks.mise.setup_mise_globals",
        lambda tools, dry_run: False,
    )

    ctx = DummyCtx(dry_run=False)
    result_fail: TaskResult = setup_mise_globals_task(ctx)
    assert result_fail.success is False
    assert any(sev == Severity.ERROR for sev, _ in result_fail.messages)
