import pytest

from nextlevelapex.core.task import Severity, TaskResult
from nextlevelapex.main import get_task_registry
from nextlevelapex.tasks.ollama import setup_ollama_task


class DummyCtx(dict):
    """Simulate the CLI context passed into each task."""

    def __init__(self, dry_run=True):
        super().__init__()
        self["dry_run"] = dry_run
        self["config"] = {"local_ai": {}}


def test_ollama_task_missing_config(monkeypatch):
    # Under the hood, setup_ollama reads ctx["config"]["ollama"], so let's see if missing.
    monkeypatch.setattr("nextlevelapex.tasks.ollama.setup_ollama", lambda cfg, dry_run: True)
    ctx = {"dry_run": False, "config": {}}  # no "local_ai" key
    result: TaskResult = setup_ollama_task(ctx)
    # It should still succeed because our lambda doesn't care about cfg
    assert isinstance(result, TaskResult)
    assert result.success is True


def test_registry_contains_tasks():
    """Make sure our @task decorators actually registered them."""
    tasks = get_task_registry()
    assert "Ollama Setup" in tasks
    assert "Homebrew Install" in tasks
    assert "Homebrew Shellenv" in tasks


@pytest.mark.parametrize("dry_run", [True, False])
def test_ollama_task_returns_taskresult(dry_run, monkeypatch):
    # Monkey-patch the real setup_ollama() to control its return
    monkeypatch.setattr("nextlevelapex.tasks.ollama.setup_ollama", lambda cfg, dry_run: not dry_run)
    ctx = DummyCtx(dry_run=dry_run)
    result: TaskResult = setup_ollama_task(ctx)
    # Validate the TaskResult fields
    assert isinstance(result, TaskResult)
    assert result.success == (not dry_run)
    assert result.changed == (not dry_run and not ctx["dry_run"])
    if not result.success:
        # When it fails, there should be an ERROR message
        assert any(sev == Severity.ERROR for sev, _ in result.messages)
