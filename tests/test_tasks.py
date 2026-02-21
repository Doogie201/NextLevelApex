import pytest

from nextlevelapex.core.registry import get_task_registry
from nextlevelapex.core.task import Severity, TaskResult
from nextlevelapex.tasks.brew import ensure_brew_shellenv_task, install_brew_task
from nextlevelapex.tasks.ollama import setup_ollama_task


class DummyCtx(dict):
    """Simulate the CLI context passed into each task."""

    def __init__(self, dry_run=True):
        super().__init__()
        self["dry_run"] = dry_run
        self["config"] = {"local_ai": {}}


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


def test_brew_tasks(monkeypatch):
    # Patch install_brew() to succeed and shellenv to fail
    monkeypatch.setattr("nextlevelapex.tasks.brew.install_brew", lambda dry_run: True)
    monkeypatch.setattr("nextlevelapex.tasks.brew.ensure_brew_shellenv", lambda dry_run: False)
    ctx = DummyCtx(dry_run=False)
    install_res = install_brew_task(ctx)
    shellenv_res = ensure_brew_shellenv_task(ctx)

    assert install_res.success is True
    assert install_res.changed is True

    assert shellenv_res.success is False
    assert any(sev == Severity.ERROR for sev, _ in shellenv_res.messages)


def test_registry_contains_tasks():
    """Make sure our @task decorators actually registered them."""
    from nextlevelapex.main2 import discover_tasks

    discover_tasks()
    tasks = get_task_registry()
    names = [getattr(fn, "_task_name", None) for fn in tasks.values()]

    assert "Ollama Setup" in names
    assert "Homebrew Install" in names
    assert "Homebrew Shellenv" in names
    assert "Colima Setup" in names  # ← ✅ added
